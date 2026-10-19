import { safeText } from '../redact';
import { decodeSegment } from '../path-segment';
import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from '../reviewer-routes';
import { probeHostedReadiness, sanitizeHostedStatus } from './hosted-readiness';
import { sanitizeHostedRun, type HostedRunRecord } from './hosted-run-record';

/**
 * THE HOSTED CODING AGENT CONTROL PLANE.
 *
 * Six routes, and the asymmetry between them is the design:
 *
 *   GET  /hosted-coding/readiness      readable by a paired browser. Offline,
 *                                      free, and makes no provider request.
 *   GET  /hosted-coding/status/:id     readable by a paired browser.
 *   GET  /hosted-coding/inspect/:id    readable by a paired browser.
 *   POST /hosted-coding/start          OPERATOR ONLY, and refuses even an
 *                                      operator without explicit authorization.
 *   POST /hosted-coding/stop/:id       OPERATOR ONLY.
 *   POST /hosted-coding/retry          OPERATOR ONLY, fresh authorization.
 *
 * The split is not stylistic. `start` and `retry` spend money on a provider;
 * `stop` changes a run in flight. A browser session is read-only precisely so
 * that a paired tab — or anything that steals one — cannot bill the founder.
 * Reaching a route is never consent to spend, which is why `authorized: true`
 * is required on top of operator authentication.
 */

export const HOSTED_PREFIX = '/hosted-coding/';

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { kind, error: message } });

export function isHostedCodingRoute(path: string): boolean {
  return path.startsWith(HOSTED_PREFIX);
}

/**
 * The engine behind the routes. Injected so this module stays a control plane
 * and never itself launches anything.
 */
export interface HostedCodingRunPort {
  /** Starts exactly one run, or returns the existing one for a repeated key. */
  start(input: {
    missionId: string;
    idempotencyKey: string;
    requestedModel: string | null;
  }): Promise<{ ok: true; record: HostedRunRecord } | { ok: false; status: number; kind: string; message: string }>;
  get(runId: string): Promise<HostedRunRecord | null>;
  /** Full record for operator inspection. */
  inspect(runId: string): Promise<HostedRunRecord | null>;
  stop(runId: string): Promise<{ ok: true; record: HostedRunRecord } | { ok: false; status: number; kind: string; message: string }>;
  retry(input: {
    priorRunId: string;
    idempotencyKey: string;
  }): Promise<{ ok: true; record: HostedRunRecord } | { ok: false; status: number; kind: string; message: string }>;
}

export interface HostedRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  readonly now: string;
  /**
   * Decides WHO is calling. Injected so this module knows nothing about
   * sessions: it asks, and enforces the answer.
   */
  readonly authorize?: () => { kind: 'operator' } | { kind: 'browser' }
    | { kind: 'rejected'; status: number; message: string };
}

const requiredString = (body: unknown, field: string): string | null => {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

/** Routes a browser session may read. Everything else is operator-only. */
export function browserMayReadHostedRoute(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return /^\/hosted-coding\/readiness$/.test(path)
    || /^\/hosted-coding\/status\/[^/]+$/.test(path)
    || /^\/hosted-coding\/inspect\/[^/]+$/.test(path);
}

export async function handleHostedCodingRoute(
  request: HostedRouteRequest,
  runs: HostedCodingRunPort | null,
): Promise<ReviewerRouteResult | null> {
  const { method, path, env } = request;
  if (!isHostedCodingRoute(path)) return null;

  // EVERY hosted route is authenticated, including readiness: what is
  // installed on the host is operational detail, and an unauthenticated probe
  // would disclose it.
  const decision = request.authorize?.()
    ?? (bearerMatches(request.authorization, env[BRIDGE_TOKEN_ENV])
      ? { kind: 'operator' as const }
      : { kind: 'rejected' as const, status: 401, message: 'Authentication is required for hosted Coding Agent operations.' });
  if (decision.kind === 'rejected') {
    return err(
      decision.status,
      decision.status === 403 ? 'authorization_required' : 'authentication_failed',
      decision.message,
    );
  }

  const operatorOnly = (): ReviewerRouteResult => err(
    403, 'authorization_required',
    'A browser session may only read hosted Coding Agent state. This action requires an operator.',
  );

  /* ------------------------------------------ readiness (free, offline) --- */
  if (method === 'GET' && path === '/hosted-coding/readiness') {
    // No provider request. This is the one route a status page may poll.
    const readiness = probeHostedReadiness({ env, now: request.now });
    return ok({
      ...sanitizeHostedStatus(readiness),
      // Readiness can never assert a working credential — only a run can.
      connectionVerified: false,
      modelVerified: false,
    });
  }

  /* ----------------------------------------------------- run lifecycle --- */
  /**
   * No STANDALONE hosted run engine, and that is a decision rather than a gap.
   *
   * The hosted Coding Agent is real and reachable: `mission.ts` constructs the
   * hosted invoker and the coding leg runs it inside a prepared workspace. What
   * does not exist is a second lifecycle that starts one OUTSIDE a mission,
   * because a hosted run needs a prompt and a workspace and this route carries
   * neither — only ids.
   *
   * The old message said the engine was "not configured", which describes a
   * variable an operator could set. There is none, so it says what is true and
   * where the working path is. Readiness above still answers everywhere.
   */
  if (runs === null) {
    return err(
      503, 'hosted_coding_not_ready',
      'This Relay Bridge runs the hosted Coding Agent as the coding leg of a mission, not as a '
      + 'standalone run, so there is nothing here to start, inspect or stop. No configuration '
      + 'enables this route — a hosted run needs a prompt and a workspace, which a mission '
      + 'supplies and this request does not. Run the mission instead.',
    );
  }

  const statusMatch = /^\/hosted-coding\/(status|inspect)\/(.+)$/.exec(path);
  if (statusMatch !== null && method === 'GET') {
    // A malformed escape is a client error and names no run, so it is a 404.
    // Bare `decodeURIComponent` threw a URIError out of this handler and the
    // server's generic catch turned it into 500 — a server fault reported for
    // a request the client got wrong.
    const runId = decodeSegment(statusMatch[2]);
    if (runId === null) return err(404, 'not_found', 'No hosted Coding Agent run with that id.');
    const record = statusMatch[1] === 'inspect'
      ? await runs.inspect(runId)
      : await runs.get(runId);
    if (record === null) return err(404, 'not_found', 'No hosted Coding Agent run with that id.');
    // A browser gets the sanitized projection even from `inspect`; only an
    // operator sees the full record, which carries workspace paths.
    return ok(decision.kind === 'operator' && statusMatch[1] === 'inspect'
      ? record
      : sanitizeHostedRun(record));
  }

  if (method === 'POST' && path === '/hosted-coding/start') {
    if (decision.kind !== 'operator') return operatorOnly();
    const missionId = requiredString(request.body, 'missionId');
    const idempotencyKey = requiredString(request.body, 'idempotencyKey');
    const authorized = (request.body as { authorized?: unknown } | null)?.authorized === true;
    const rawModel = (request.body as { requestedModel?: unknown } | null)?.requestedModel;
    const requestedModel = typeof rawModel === 'string' && rawModel.trim() !== '' ? rawModel.trim() : null;

    if (missionId === null || idempotencyKey === null) {
      return err(422, 'validation_failed', 'start requires missionId and idempotencyKey.');
    }
    if (!authorized) {
      // Reaching this route is not consent to spend.
      return err(403, 'authorization_required', 'A hosted Coding Agent run requires explicit authorization.');
    }
    const started = await runs.start({ missionId, idempotencyKey, requestedModel });
    return started.ok
      ? ok(sanitizeHostedRun(started.record))
      : err(started.status, started.kind, safeText(started.message));
  }

  const stopMatch = /^\/hosted-coding\/stop\/(.+)$/.exec(path);
  if (stopMatch !== null && method === 'POST') {
    if (decision.kind !== 'operator') return operatorOnly();
    const stopId = decodeSegment(stopMatch[1]);
    if (stopId === null) return err(404, 'not_found', 'No hosted Coding Agent run with that id.');
    const stopped = await runs.stop(stopId);
    return stopped.ok
      ? ok(sanitizeHostedRun(stopped.record))
      : err(stopped.status, stopped.kind, safeText(stopped.message));
  }

  if (method === 'POST' && path === '/hosted-coding/retry') {
    if (decision.kind !== 'operator') return operatorOnly();
    const priorRunId = requiredString(request.body, 'priorRunId');
    const idempotencyKey = requiredString(request.body, 'idempotencyKey');
    const authorized = (request.body as { authorized?: unknown } | null)?.authorized === true;
    if (priorRunId === null || idempotencyKey === null) {
      return err(422, 'validation_failed', 'retry requires priorRunId and idempotencyKey.');
    }
    if (!authorized) {
      // A retry is a NEW paid run; the previous authorization does not carry.
      return err(403, 'authorization_required', 'A hosted Coding Agent retry requires fresh explicit authorization.');
    }
    const retried = await runs.retry({ priorRunId, idempotencyKey });
    return retried.ok
      ? ok(sanitizeHostedRun(retried.record))
      : err(retried.status, retried.kind, safeText(retried.message));
  }

  return err(422, 'validation_failed', 'Unknown hosted Coding Agent operation.');
}

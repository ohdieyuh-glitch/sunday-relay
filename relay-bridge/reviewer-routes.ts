/**
 * THE REVIEWER HTTP BOUNDARY.
 *
 * The seven Reviewer operations, behind bearer authentication, in the existing
 * `/relay-api` family. Everything the CLI can do to a Reviewer run, it does
 * through here — which is why the CLI never needs to import a process adapter,
 * a provider client or a credential.
 *
 * READ-ONLY ROUTES ARE ACTUALLY READ-ONLY. `readiness`, `status` and `inspect`
 * start no Hermes process, perform no model discovery, run no inference and
 * consume no usage. Only `test-connection` may contact the provider, and only
 * because a human explicitly asked it to.
 *
 * NOTHING HERE DECIDES A VERDICT. Routes validate, delegate to the canonical
 * operation and sanitize. A credential, a raw provider body, a process
 * environment and a stack trace can none of them reach a response.
 */

import { bearerMatches } from './bearer-auth';
import { decodeSegment } from './path-segment';
import { isProductionDeployment } from './deployment-environment';
import { buildHermesTransport } from './reviewer-harness/hermes/transport-factory';
import { NO_RUNTIME_EVIDENCE } from '../src/relay/mission/reviewer-harness/harness-readiness';
import { safeText } from './redact';

export const BRIDGE_TOKEN_ENV = 'RELAY_BRIDGE_API_TOKEN';

export interface ReviewerRouteResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { kind, error: message } });

/**
 * Constant-time bearer comparison — the SHARED server-only implementation,
 * re-exported so existing importers of this module are unaffected.
 *
 * This used to be one of two copies. The Hermes service carried the other, and
 * described it as "matching the bridge's own implementation" while differing
 * in scheme casing, separator handling and secret trimming. Both fail closed,
 * so no wrong secret was ever accepted — but a comment asserting a parity that
 * does not hold is the kind of thing the next change relies on. See
 * `relay-bridge/bearer-auth.ts`.
 */
export { bearerMatches };

export interface ReviewerRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  /**
   * Decides WHO is calling. Injected so this module keeps knowing nothing
   * about sessions: it asks, and enforces the answer.
   *
   * Absent = operator-token-only, the behaviour before browser pairing
   * existed, which is what the CLI and every existing test rely on.
   */
  readonly authorize?: () => { kind: 'operator' } | { kind: 'browser' }
    | { kind: 'rejected'; status: number; message: string };
}

/** Reviewer run state the bridge can serve without a live run engine yet. */
export interface ReviewerRunPort {
  start(input: {
    missionId: string; reviewGeneration: string; requestedHarness: string;
    requestedModel: string | null; idempotencyKey: string;
    limits: Record<string, number>;
  }): Promise<ReviewerRouteResult>;
  status(missionId: string): Promise<ReviewerRouteResult>;
  inspect(missionId: string): Promise<ReviewerRouteResult>;
  stop(missionId: string): Promise<ReviewerRouteResult>;
  retry(input: {
    missionId: string; priorRunId: string; idempotencyKey: string;
  }): Promise<ReviewerRouteResult>;
}

const REVIEWER_PREFIX = '/reviewer/';

export function isReviewerRoute(path: string): boolean {
  return path === '/reviewer/readiness' || path.startsWith(REVIEWER_PREFIX);
}

function requiredString(body: unknown, field: string): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function limitsFrom(body: unknown): Record<string, number> | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = (body as Record<string, unknown>).limits;
  if (raw === null || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const key of ['timeoutMs', 'maxOutputBytes', 'maxTurns', 'maxPromptBytes']) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    out[key] = value;
  }
  return out;
}

/**
 * Handles a Reviewer route. Returns `null` when the path is not one of ours,
 * so the caller can fall through to the rest of the bridge.
 */
export async function handleReviewerRoute(
  request: ReviewerRouteRequest,
  runs: ReviewerRunPort | null,
): Promise<ReviewerRouteResult | null> {
  const { method, path, env } = request;
  if (!isReviewerRoute(path)) return null;

  // EVERY Reviewer route is authenticated, including the read-only ones: run
  // state is operational detail, and an unauthenticated readiness probe would
  // still disclose what is installed on the host.
  //
  // An operator may call anything. A paired browser session may call only the
  // read-only subset — the decision belongs to the injected authorizer, and
  // this module simply refuses whatever it rejects.
  const decision = request.authorize?.()
    ?? (bearerMatches(request.authorization, env[BRIDGE_TOKEN_ENV])
      ? { kind: 'operator' as const }
      : { kind: 'rejected' as const, status: 401, message: 'Authentication is required for Reviewer operations.' });
  if (decision.kind === 'rejected') {
    return err(
      decision.status,
      decision.status === 403 ? 'authorization_required' : 'authentication_failed',
      decision.message,
    );
  }

  /* --------------------------------------- readiness (via transport) --- */
  if (method === 'GET' && path === '/reviewer/readiness') {
    // The bridge no longer probes its OWN container. It asks whichever
    // transport is configured — which on a hosted deployment is a dedicated
    // Hermes service, and never this process's PATH.
    const built = await buildHermesTransport({ env, production: isProductionDeployment(env) });
    if (!built.ok) {
      return ok({
        harness: 'hermes',
        evidence: { ...NO_RUNTIME_EVIDENCE, bridgeAvailable: true, failureReason: built.safeMessage },
        failureKind: built.kind,
      });
    }
    const evidence = await built.transport.readiness();
    return ok({
      harness: 'hermes',
      // A binary path is host layout and never leaves the server.
      evidence: { ...evidence, binaryPath: null },
      mode: built.transport.mode,
    });
  }

  /* ------------------------- test connection (via transport, may contact) --- */
  if (method === 'POST' && path === '/reviewer/test-connection') {
    const built = await buildHermesTransport({ env, production: isProductionDeployment(env) });
    if (!built.ok) {
      return ok({
        harness: 'hermes',
        connected: false,
        runCreated: false,
        reason: safeText(built.safeMessage),
        failureKind: built.kind,
      });
    }
    const evidence = await built.transport.testConnection();
    return ok({
      harness: 'hermes',
      mode: built.transport.mode,
      connected: evidence.connected,
      // Verifying a connection never creates a run.
      runCreated: false,
      // Harness, provider and model are three identities and stay separate.
      provider: evidence.identity?.provider ?? null,
      requestedModel: evidence.identity?.requestedModel ?? null,
      // Server proof only; absent stays null and renders Unknown.
      verifiedModelId: evidence.identity?.verifiedModelId ?? null,
      checkedAt: evidence.checkedAt,
      failureKind: evidence.failureKind,
      reason: evidence.connected ? null : safeText(evidence.safeMessage ?? 'The Reviewer harness is not ready.'),
    });
  }

  /**
   * The remaining operations need a run engine, and this bridge does not have
   * a STANDALONE one — by design, not by omission.
   *
   * The message this used to carry said the engine was "not configured", which
   * sends an operator looking for a variable that does not exist. Relay reviews
   * inside the mission leg: the coding leg produces the diff, `mission.ts`
   * builds the review packet from that evidence, and the configured transport
   * — local Hermes, a remote Hermes service, or the provider Reviewer — runs
   * it. A second run engine here would review the same artifact twice under
   * separate run state, which is the duplicate nobody wants.
   *
   * So the refusal names the path that works rather than a setting that would
   * not help. Readiness and test-connection above are unaffected: they answer
   * on every bridge, because they describe the transport rather than a run.
   */
  if (runs === null) {
    return err(
      503, 'reviewer_not_ready',
      'This Relay Bridge runs reviews as part of a mission, not as standalone Reviewer runs, '
      + 'so there is nothing here to start, inspect or stop. No configuration enables this route. '
      + 'Run the mission instead — its review leg uses the Reviewer transport this bridge already '
      + 'reports through /reviewer/readiness.',
    );
  }

  if (method === 'POST' && path === '/reviewer/start') {
    const body = request.body;
    const missionId = requiredString(body, 'missionId');
    const reviewGeneration = requiredString(body, 'reviewGeneration');
    const requestedHarness = requiredString(body, 'requestedHarness');
    const idempotencyKey = requiredString(body, 'idempotencyKey');
    const limits = limitsFrom(body);
    const authorized = (body as { authorized?: unknown } | null)?.authorized === true;
    const rawModel = (body as { requestedModel?: unknown } | null)?.requestedModel;
    const requestedModel = typeof rawModel === 'string' && rawModel.trim() !== '' ? rawModel.trim() : null;

    if (missionId === null || reviewGeneration === null || requestedHarness === null
      || idempotencyKey === null || limits === null) {
      return err(
        422, 'validation_failed',
        'start requires missionId, reviewGeneration, requestedHarness, idempotencyKey and complete limits.',
      );
    }
    if (!authorized) {
      return err(403, 'authorization_required', 'A Reviewer run requires explicit authorization.');
    }
    return await runs.start({
      missionId, reviewGeneration, requestedHarness, requestedModel, idempotencyKey, limits,
    });
  }

  const statusMatch = /^\/reviewer\/(status|inspect|stop)\/(.+)$/.exec(path);
  if (statusMatch !== null) {
    const action = statusMatch[1];
    // `decodeSegment`, not a bare `decodeURIComponent`: `%ZZ` in the path is a
    // malformed client request, and letting the URIError escape made this
    // route answer 500 through the server's generic catch.
    const missionId = decodeSegment(statusMatch[2]);
    if (missionId === null) {
      return err(422, 'validation_failed', 'A mission id is required.');
    }
    if (method === 'GET' && action === 'status') return await runs.status(missionId);
    if (method === 'GET' && action === 'inspect') return await runs.inspect(missionId);
    if (method === 'POST' && action === 'stop') return await runs.stop(missionId);
    return err(422, 'validation_failed', 'Unsupported method for this Reviewer route.');
  }

  if (method === 'POST' && path === '/reviewer/retry') {
    const missionId = requiredString(request.body, 'missionId');
    const priorRunId = requiredString(request.body, 'priorRunId');
    const idempotencyKey = requiredString(request.body, 'idempotencyKey');
    const authorized = (request.body as { authorized?: unknown } | null)?.authorized === true;
    if (missionId === null || priorRunId === null || idempotencyKey === null) {
      return err(422, 'validation_failed', 'retry requires missionId, priorRunId and idempotencyKey.');
    }
    if (!authorized) {
      // A retry is a NEW paid call; prior authorization does not carry over.
      return err(403, 'authorization_required', 'A Reviewer retry requires fresh explicit authorization.');
    }
    return await runs.retry({ missionId, priorRunId, idempotencyKey });
  }

  return err(422, 'validation_failed', 'Unknown Reviewer operation.');
}

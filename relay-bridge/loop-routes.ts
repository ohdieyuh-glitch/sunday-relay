import { safeText } from './redact';
import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from './reviewer-routes';
import { cronEnabled } from './cron-routes';
import type {
  LoopHistoryEntry,
  LoopInspectionProjection,
  LoopStatusProjection,
  RelayLoopControlAction,
} from '../src/relay/mission/loop/runtime';

/**
 * THE LOOP CONTROL PLANE.
 *
 * Seven routes over one durable run, split the same way the hosted Coding Agent
 * control plane is split, and for the same reason:
 *
 *   GET  /loop/status/:runId     read-only, free, side-effect free
 *   GET  /loop/inspect/:runId    read-only, richer, still free
 *   GET  /loop/history/:loopId   read-only, one Loop's runs
 *   POST /loop/confirm           OPERATOR ONLY — creates a run that will spend
 *   POST /loop/pause/:runId      OPERATOR ONLY
 *   POST /loop/resume/:runId     OPERATOR ONLY — resuming is authorizing more work
 *   POST /loop/stop/:runId       OPERATOR ONLY
 *
 * A READ NEVER STARTS ANYTHING. `status`, `inspect` and `history` reduce the
 * journal and return a projection. They start no iteration, reserve no budget,
 * take no lock and call no provider. That is what makes them safe to poll from
 * a browser once a second, which is exactly how a surface will use them.
 *
 * REACHING A ROUTE IS NOT CONSENT TO SPEND. `confirm` and `resume` both lead to
 * paid work, so both require an operator AND an explicit `authorized: true`.
 * A browser session may read a Loop and may not start one — if a paired tab is
 * stolen, the thief can watch, not bill.
 *
 * THE FEATURE FLAG IS EVALUATED HERE, SERVER-SIDE, AND DEFAULTS OFF. The
 * browser is told whether the capability is enabled; it cannot assert that it
 * is. A client-supplied flag would be a gate with the lock on the outside.
 *
 * This module is a control plane. It never touches a filesystem, a lock or an
 * adapter — every one of those arrives through `LoopRunPort`.
 */

export const LOOP_PREFIX = '/loop/';

/** The one environment variable production reads to enable the Loop engine. */
export const LOOP_ENGINE_ENV = 'RELAY_LOOP_ENGINE_ENABLED';

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { kind, error: message } });

export function isLoopRoute(path: string): boolean {
  return path.startsWith(LOOP_PREFIX);
}

/**
 * Is the Loop engine on?
 *
 * FAIL-CLOSED BY CONSTRUCTION. Only the exact string `1` enables it. An unset
 * variable, an empty one, `true`, `yes`, `TRUE`, whitespace — all off. A flag
 * that can be switched on by a plausible-looking value is not a gate, and this
 * one guards work that spends money.
 */
export function loopEngineEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[LOOP_ENGINE_ENV] === '1';
}

/* ------------------------------------------------------------------ port */

/** What the routes need done. Injected, so this module orchestrates nothing. */
export interface LoopRunPort {
  confirm(input: {
    readonly principal: string;
    readonly workspaceId: string | null;
    readonly projectId: string;
    readonly loopId: string;
    readonly contractRef: string;
    readonly contractVersion: number;
    readonly contractBindingDigest: string;
    readonly confirmationRequestId: string;
    readonly objective: string;
    readonly targetExpression: string;
    readonly creationSource: 'cli' | 'website' | 'api';
  }): Promise<
    | { readonly ok: true; readonly status: LoopStatusProjection; readonly duplicate: boolean }
    | { readonly ok: false; readonly status: number; readonly kind: string; readonly message: string }
  >;
  status(runId: string): Promise<LoopStatusProjection | null>;
  inspect(runId: string): Promise<LoopInspectionProjection | null>;
  history(loopId: string): Promise<readonly LoopHistoryEntry[] | null>;
  control(input: {
    readonly runId: string;
    readonly action: RelayLoopControlAction;
    readonly requestId: string;
    readonly requestedBy: string;
    readonly reason: string | null;
  }): Promise<
    | { readonly ok: true; readonly status: LoopStatusProjection; readonly duplicate: boolean }
    | { readonly ok: false; readonly status: number; readonly kind: string; readonly message: string }
  >;
}

export interface LoopRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  readonly now: string;
  /**
   * Whether a cron scheduler OBJECT actually exists on this server.
   *
   * Injected by the composition root, because only it knows: the flags are
   * necessary but not sufficient — the timer also needs a mounted state root,
   * and a bridge without one starts anyway. Absent means no, which is the
   * safe answer for every host that does not construct a scheduler.
   */
  readonly cronSchedulerRunning?: boolean;
  /** Decides WHO is calling. Injected — this module asks and enforces. */
  readonly authorize?: () => { kind: 'operator'; principal: string } | { kind: 'browser'; principal: string }
    | { kind: 'rejected'; status: number; message: string };
  /**
   * Decides whether the caller may act in this workspace and project.
   * Injected for the same reason authentication is: the routes enforce an
   * answer they do not compute.
   */
  readonly authorizeScope?: (scope: {
    readonly principal: string;
    readonly workspaceId: string | null;
    readonly projectId: string;
  }) => { readonly allowed: true } | { readonly allowed: false; readonly status: number; readonly message: string };
}

/* ------------------------------------------------------------- helpers */

const trimmed = (body: unknown, field: string): string | null => {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

/**
 * A path identifier that is safe to use.
 *
 * Refused before anything reads it: an id carrying a separator or traversal is
 * a malformed CLIENT input and gets a sanitized 422, never an exception that
 * would surface a stack trace or a path.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

function safeIdentifier(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return SAFE_ID.test(decoded) ? decoded : null;
}

/** Routes a browser session may read. Everything else is operator-only. */
export function browserMayReadLoopRoute(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return /^\/loop\/(status|inspect)\/[^/]+$/.test(path) || /^\/loop\/history\/[^/]+$/.test(path);
}

/* -------------------------------------------------------------- handler */

export async function handleLoopRoute(
  request: LoopRouteRequest,
  runs: LoopRunPort | null,
): Promise<ReviewerRouteResult | null> {
  const { method, path, env } = request;
  if (!isLoopRoute(path)) return null;

  const decision = request.authorize?.()
    ?? (bearerMatches(request.authorization, env[BRIDGE_TOKEN_ENV])
      ? { kind: 'operator' as const, principal: 'operator' }
      : {
          kind: 'rejected' as const,
          status: 401,
          message: 'Authentication is required for Loop operations.',
        });
  if (decision.kind === 'rejected') {
    return err(
      decision.status,
      decision.status === 403 ? 'authorization_required' : 'authentication_failed',
      decision.message,
    );
  }

  // The capability route is readable by anyone authenticated: knowing whether
  // the button will work is not itself a privileged fact, and a surface needs
  // it before it can decide what to render.
  if (method === 'GET' && path === '/loop/capability') {
    return ok({
      loopEngineEnabled: loopEngineEnabled(env),
      // Stage 2 executes exactly one role through one adapter. Saying so lets a
      // surface disable what it must not offer instead of discovering it by
      // being refused.
      supportedTargets: ['exact_roles'],
      supportedRoles: ['coding_agent'],
      multiRoleSupported: false,
      // An authenticated operator MAY call the cron tick when the flag is on.
      cronSupported: cronEnabled(env),
      /**
       * …and whether anything CALLS it on a schedule is now a real question
       * rather than a flat no.
       *
       * IT REPORTS THE SCHEDULER THAT EXISTS, NOT THE FLAGS THAT ASK FOR ONE.
       * The first version read two env vars, and review found the gap: the
       * timer is only created when a state root is mounted, and an absent
       * volume is deliberately NOT fatal — so a bridge with both flags set and
       * no volume boots, runs no timer, answers 503 on the tick, and told
       * every surface `cronScheduled: true`. This field exists to be believed
       * without checking the deployment, which is exactly why it may not
       * assert a recurrence that cannot happen.
       *
       * A surface must still not infer EXECUTION from it: a scheduled run is
       * created and never advanced, whoever asked.
       */
      cronScheduled: request.cronSchedulerRunning === true,
      swarmSupported: false,
    });
  }

  if (!loopEngineEnabled(env)) {
    // Default OFF. Nothing below this line runs without the server saying so.
    return err(
      403, 'loop_engine_disabled',
      'The Loop engine is not enabled on this server. No Loop run was created, read or changed.',
    );
  }

  if (runs === null) {
    return err(
      503, 'loop_engine_not_ready',
      'This Relay Bridge has no Loop run engine configured, so no Loop run can be created or inspected.',
    );
  }

  const operatorOnly = (): ReviewerRouteResult => err(
    403, 'authorization_required',
    'A browser session may only read Loop state. This action requires an operator.',
  );

  /* ------------------------------------------------------------- reads --- */

  const readMatch = /^\/loop\/(status|inspect)\/(.+)$/.exec(path);
  if (readMatch !== null && method === 'GET') {
    const runId = safeIdentifier(readMatch[2]);
    if (runId === null) return err(422, 'validation_failed', 'That is not a valid Loop run id.');
    const projection = readMatch[1] === 'inspect'
      ? await runs.inspect(runId)
      : await runs.status(runId);
    if (projection === null) return err(404, 'not_found', 'No Loop run with that id.');
    return ok(projection);
  }

  const historyMatch = /^\/loop\/history\/(.+)$/.exec(path);
  if (historyMatch !== null && method === 'GET') {
    const loopId = safeIdentifier(historyMatch[1]);
    if (loopId === null) return err(422, 'validation_failed', 'That is not a valid Loop id.');
    const entries = await runs.history(loopId);
    if (entries === null) return err(404, 'not_found', 'No Loop with that id.');
    return ok({ loopId, runs: entries });
  }

  /* ----------------------------------------------------------- confirm --- */

  if (method === 'POST' && path === '/loop/confirm') {
    if (decision.kind !== 'operator') return operatorOnly();

    const projectId = trimmed(request.body, 'projectId');
    const loopId = trimmed(request.body, 'loopId');
    const contractRef = trimmed(request.body, 'contractRef');
    const contractBindingDigest = trimmed(request.body, 'contractBindingDigest');
    const confirmationRequestId = trimmed(request.body, 'confirmationRequestId');
    const objective = trimmed(request.body, 'objective');
    const targetExpression = trimmed(request.body, 'targetExpression');
    const workspaceId = trimmed(request.body, 'workspaceId');
    const rawVersion = (request.body as { contractVersion?: unknown } | null)?.contractVersion;
    const contractVersion = typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion > 0
      ? rawVersion
      : null;
    const authorized = (request.body as { authorized?: unknown } | null)?.authorized === true;

    if (
      projectId === null || loopId === null || contractRef === null || contractBindingDigest === null
      || confirmationRequestId === null || objective === null || targetExpression === null
      || contractVersion === null
    ) {
      return err(
        422, 'validation_failed',
        'confirm requires projectId, loopId, contractRef, contractVersion, contractBindingDigest, '
        + 'confirmationRequestId, objective and targetExpression.',
      );
    }
    if (!authorized) {
      // Compiling and previewing a contract is free. Confirming it is what
      // authorizes work, and it has to be said explicitly.
      return err(403, 'authorization_required', 'Starting a Loop run requires explicit confirmation.');
    }

    const scope = request.authorizeScope?.({ principal: decision.principal, workspaceId, projectId })
      ?? { allowed: true as const };
    if (!scope.allowed) {
      return err(scope.status, 'authorization_required', safeText(scope.message));
    }

    const created = await runs.confirm({
      principal: decision.principal,
      workspaceId,
      projectId,
      loopId,
      contractRef,
      contractVersion,
      contractBindingDigest,
      confirmationRequestId,
      objective,
      targetExpression,
      creationSource: 'api',
    });
    return created.ok
      ? ok({ ...created.status, duplicate: created.duplicate })
      : err(created.status, created.kind, safeText(created.message));
  }

  /* ----------------------------------------------------------- control --- */

  const controlMatch = /^\/loop\/(pause|resume|stop)\/(.+)$/.exec(path);
  if (controlMatch !== null && method === 'POST') {
    if (decision.kind !== 'operator') return operatorOnly();
    const action = controlMatch[1] as RelayLoopControlAction;
    const runId = safeIdentifier(controlMatch[2]);
    if (runId === null) return err(422, 'validation_failed', 'That is not a valid Loop run id.');

    const requestId = trimmed(request.body, 'requestId');
    if (requestId === null) {
      return err(
        422, 'validation_failed',
        `A ${action} needs its own requestId, so a retry can be recognised as the same request.`,
      );
    }
    if (action === 'resume' && (request.body as { authorized?: unknown } | null)?.authorized !== true) {
      // Resuming authorizes MORE work. The original confirmation does not carry.
      return err(403, 'authorization_required', 'Resuming a Loop run requires explicit authorization.');
    }

    const controlled = await runs.control({
      runId,
      action,
      requestId,
      requestedBy: decision.principal,
      reason: trimmed(request.body, 'reason'),
    });
    return controlled.ok
      ? ok({ ...controlled.status, duplicate: controlled.duplicate })
      : err(controlled.status, controlled.kind, safeText(controlled.message));
  }

  return err(422, 'validation_failed', 'Unknown Loop operation.');
}

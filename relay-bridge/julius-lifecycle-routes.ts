import type {
  JuliusApiIdentity,
  JuliusApiResult,
  JuliusLifecycleOutcome,
  JuliusRuntimeApi,
} from '../src/relay/mission/julius';

/**
 * THE OPERATOR LIFECYCLE CHANNEL: PAUSE, RESUME AND CANCEL A JULIUS RUN OVER HTTP.
 *
 * THE GAP. `pauseJuliusRun`, `resumeJuliusRun` and `cancelJuliusRun` existed,
 * `JuliusRuntimeApi` exposed them behind the `run:control` scope, and
 * `JuliusLifecyclePostgresRepository` persisted who asked and why — and nothing
 * served any of it. The only way to stop a run was to kill the process driving
 * it, which records nothing and leaves the run claiming it is EXECUTING.
 *
 * WHAT IT IS. One path, `POST /julius/runs/<runId>/lifecycle`, body
 * `{ "action": "pause" | "resume" | "cancel", "reason": "<why>" }`, operator
 * Bearer only, scoped by the same `x-relay-tenant` / `x-relay-project` headers as
 * the read routes. It maps the action to the API's own method on the SAME
 * composed API the read routes serve (`composeJuliusStateApi`), over the same
 * PostgreSQL store the mission job writes, and maps the kernel's answer to a
 * status. It computes nothing about a run: legality, idempotency and the
 * record are the lifecycle runtime's.
 *
 * WHAT IT DELIBERATELY IS NOT — A DRIVER. It never ticks the loop, never
 * composes a provider and never spends. It records operator INTENT in the one
 * place every driver reads — the run's state — and the run loop honours it:
 *
 *   - PAUSE: the claim query refuses a PAUSED run, and `advanceRun` leaves one
 *     where it is, so a driver claims nothing and stops, naming the pause as the
 *     cause. Work already in flight finishes and its paid-for result is kept —
 *     the kernel's stated rule — but nothing new starts.
 *   - RESUME: PAUSED -> READY and nothing else. The run continues when the
 *     mission job (the process that holds the credentials) drives it again.
 *   - CANCEL: the run ends CANCELLED with the operator's reason on the record,
 *     every unfinished task is cancelled, and a late result is refused
 *     (`result_after_cancellation`). Idempotent: cancelling a cancelled run
 *     reports success with `duplicate: true`.
 *
 * DURABLE. Each applied change writes the run transition (with the reason in
 * its summary), the actor and reason on the run row (`lifecycle_reason`,
 * `lifecycle_actor`, `lifecycle_at`, migration 018), and a `run.paused` /
 * `run.resumed` / `run.cancelled` event on the run's ledger — the stream the
 * timeline view reads.
 *
 * WHO IS RECORDED. The operator credential is one shared Bearer; it names no
 * person, so the actor recorded is `operator` rather than a name the client
 * asserts in the body. A client-supplied actor would be a signature nobody
 * checked.
 */

export interface JuliusLifecycleRouteResult {
  readonly status: number;
  readonly body: unknown;
}

const ok = (data: unknown): JuliusLifecycleRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): JuliusLifecycleRouteResult =>
  ({ status, body: { error: { kind, message } } });

/** `/julius/runs/<runId>/lifecycle` — the only shape this family serves. */
const LIFECYCLE_PATH = /^\/julius\/runs\/([^/]{1,400})\/lifecycle$/u;
const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/u;

/** Claimed BEFORE the read family, which would answer a POST here with 405. */
export function isJuliusLifecycleRoute(path: string): boolean {
  return LIFECYCLE_PATH.test(path);
}

export const JULIUS_LIFECYCLE_ACTIONS = ['pause', 'resume', 'cancel'] as const;
export type JuliusLifecycleAction = (typeof JULIUS_LIFECYCLE_ACTIONS)[number];

/** Longest reason accepted; the store keeps 500 characters and the event 200. */
const MAX_REASON = 500;

export interface JuliusLifecycleRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  /** True only for a verified OPERATOR credential. */
  readonly operator: boolean;
  readonly projectId: string | undefined;
  readonly tenantId: string | undefined;
  /** The raw JSON body. */
  readonly body: string | undefined;
}

/**
 * The same shape as the read family's ports, and in production the same object:
 * `api` is null when the process has no database, and the family answers 503
 * naming the variable rather than pretending a run was paused.
 */
export interface JuliusLifecycleRoutePorts {
  readonly api: JuliusRuntimeApi | null;
  readonly missingConfig: readonly string[];
}

/**
 * HOW THE KERNEL'S REFUSALS BECOME STATUS CODES. Every refusal keeps the
 * kernel's own reason code as its `kind`, lower-cased, so a client matches on
 * the name the runtime gave it.
 */
const KERNEL_REFUSAL_STATUS: Readonly<Record<string, number>> = {
  RUN_NOT_FOUND: 404,
  ACTOR_AND_REASON_REQUIRED: 400,
  // The run is somewhere the action cannot take it from — resume after cancel,
  // pause after completion. The request was well formed; the run's state says no.
  TRANSITION_NOT_LEGAL: 409,
  RUN_NOT_PAUSED: 409,
  CONCURRENT_LIFECYCLE_CHANGE: 409,
};

const API_REFUSAL_STATUS: Readonly<Record<string, number>> = {
  identity_incomplete: 400,
  scope_missing: 403,
  run_not_found: 404,
  not_authorized_for_project: 404,
};

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export async function handleJuliusLifecycleRoute(
  request: JuliusLifecycleRouteRequest,
  ports: JuliusLifecycleRoutePorts,
): Promise<JuliusLifecycleRouteResult | null> {
  const match = LIFECYCLE_PATH.exec(request.path);
  if (match === null) return null;
  if (request.method !== 'POST') {
    return err(405, 'method_not_allowed', 'A lifecycle change is made with POST.');
  }
  // REFUSED BEFORE ANYTHING IS READ: no operator, no parse, no lookup.
  if (!request.operator) {
    return err(401, 'operator_required', 'Pausing, resuming or cancelling a Julius run requires operator authentication.');
  }
  if (ports.api === null) {
    return err(503, 'julius_state_unavailable',
      `No durable Julius state is reachable from this process: ${ports.missingConfig.join(', ')} is not set. `
      + 'Nothing was changed.');
  }
  if (request.projectId === undefined || request.tenantId === undefined) {
    return err(400, 'project_required', 'A lifecycle change names its tenant and project.');
  }

  let runId: string;
  try {
    runId = decodeURIComponent(match[1] as string);
  } catch {
    return err(404, 'run_not_found', 'The run id in the path is not a valid percent-encoding.');
  }
  if (!RUN_ID.test(runId)) return err(404, 'run_not_found', 'No such run in this project.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body ?? '');
  } catch {
    return err(400, 'malformed_lifecycle_request', 'The body must be JSON: {"action":"pause"|"resume"|"cancel","reason":"..."}.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err(400, 'malformed_lifecycle_request', 'The body must be a JSON object: {"action":"pause"|"resume"|"cancel","reason":"..."}.');
  }
  const { action, reason } = parsed as { action?: unknown; reason?: unknown };
  if (typeof action !== 'string' || !(JULIUS_LIFECYCLE_ACTIONS as readonly string[]).includes(action)) {
    return err(400, 'unknown_lifecycle_action', `"action" must be one of ${JULIUS_LIFECYCLE_ACTIONS.join(', ')}.`);
  }
  // A CHANGE WITH NO REASON IS REFUSED BY NAME, here as in the kernel: an
  // operator reading a paused run must be able to see why it is paused.
  if (typeof reason !== 'string' || reason.trim() === '') {
    return err(400, 'reason_required', 'A lifecycle change records why it was made; "reason" may not be blank.');
  }
  if (reason.length > MAX_REASON) {
    return err(400, 'reason_too_long', `"reason" is at most ${String(MAX_REASON)} characters.`);
  }

  const identity: JuliusApiIdentity = {
    tenantId: request.tenantId, projectId: request.projectId,
    actorId: 'operator', scopes: ['run:control'],
  };
  const api = ports.api;
  const result: JuliusApiResult<JuliusLifecycleOutcome> = action === 'pause'
    ? await api.pause(identity, runId, reason.trim())
    : action === 'resume'
      ? await api.resume(identity, runId, reason.trim())
      : await api.cancel(identity, runId, reason.trim());

  if (!result.ok) return err(API_REFUSAL_STATUS[result.reason] ?? 400, result.reason, result.safeMessage);
  const outcome = result.value;
  if (!outcome.applied) {
    return err(KERNEL_REFUSAL_STATUS[outcome.reasonCode] ?? 409, outcome.reasonCode.toLowerCase(), outcome.safeMessage);
  }
  return ok({
    runId,
    action,
    from: outcome.from,
    state: outcome.to,
    duplicate: outcome.duplicate,
    cancelledTasks: outcome.cancelledTasks,
    // WHAT WAS NOT DONE, on the wire: this route records intent and drives
    // nothing, so a client must not draw a resumed run as running.
    dispatched: false,
    next: TERMINAL.has(outcome.to)
      ? `The run is ${outcome.to}; its state is final and nothing will be dispatched for it.`
      : outcome.to === 'PAUSED'
        ? 'The run is PAUSED: it claims no new work. Work already in flight finishes; nothing new starts until it is resumed.'
        : `The run is ${outcome.to}. It continues when the Julius mission job drives it; this route dispatches nothing.`,
  });
}

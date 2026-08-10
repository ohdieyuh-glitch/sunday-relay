import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HERMES_SERVICE_PROTOCOL } from '../relay-bridge/reviewer-harness/hermes/hermes-transport';
import type { HermesReviewerTransport } from '../relay-bridge/reviewer-harness/hermes/hermes-transport';
import { bearerMatches } from '../relay-bridge/bearer-auth';
import { decodeSegment } from '../relay-bridge/path-segment';

/**
 * THE HERMES REVIEWER SERVICE.
 *
 * A dedicated execution boundary, not a second Relay. It owns the Hermes
 * binary, the provider credential and the per-run isolated profile; it does
 * NOT own mission state, review verdict semantics or run truth. Those stay in
 * Relay Core, which is why this API is six small routes and no more.
 *
 * The reason it exists: readiness used to be answered by probing the PATH of
 * whatever container asked. On a laptop that is right; on Railway it is
 * nonsense, and it produced the one instruction a founder could not act on —
 * "install Hermes and put it on PATH" — for a bridge that will never have it.
 * Moving execution here makes the honest answer available from a box that
 * really does have the binary.
 *
 * The engine is injected as a `HermesReviewerTransport`, so the same local
 * implementation the bridge uses in development runs inside the service in
 * production, and the whole pipeline is testable against a fake executable
 * without a provider call.
 */

export const SERVICE_TOKEN_ENV = 'RELAY_HERMES_SERVICE_TOKEN';

/**
 * Process lifecycle. `/healthz` reports it, and review creation is refused
 * once draining begins — a platform restarting a container must not be able to
 * start work it is about to kill.
 */
export type LifecycleState = 'starting' | 'ready' | 'shutting_down';

/**
 * THE ONE LIFECYCLE VALUE THAT MEANS "SERVING", exported so the Relay Bridge
 * checks against what this service ACTUALLY emits.
 *
 * It did not, and the mismatch blocked the first real hosted mission. The
 * bridge refused any lifecycle that was not `running` — a value this service
 * has never emitted — and produced the self-contradicting refusal "the
 * Reviewer service is not ready: service lifecycle is ready".
 *
 * Nothing caught it because the bridge's test fixture supplied `running` too:
 * a test that invents the value it asserts on proves the two halves of one
 * invention agree. The vocabulary now has a single owner, and the bridge
 * imports it.
 */
export const LIFECYCLE_SERVING: LifecycleState = 'ready';
let lifecycle: LifecycleState = 'starting';

export function setLifecycleState(state: LifecycleState): void {
  lifecycle = state;
}

export function lifecycleState(): LifecycleState {
  return lifecycle;
}

/** Request bodies are capped before parsing; a client cannot flood the service. */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Bearer authentication is the SHARED server-only implementation.
 *
 * It used to be a second copy whose docstring claimed it matched the bridge's.
 * It did not — different scheme casing, different separator handling, and a
 * different rule for a configured secret carrying whitespace. Both copies
 * failed closed, so no wrong secret was ever accepted; the defect was a stated
 * parity that was not real. There is now one implementation, so the statement
 * is true by construction rather than by assertion.
 *
 * Re-exported here for exactly one caller: the parity test, which asserts the
 * two surfaces resolve to the same function object. Saying that plainly beats
 * the earlier justification — "the callers that already import it from this
 * module" — which named a set that was empty.
 */
export { bearerMatches };

/**
 * Path-segment decoding is the SHARED server-only implementation too, for the
 * same reason and re-exported on the same terms. See
 * `../relay-bridge/path-segment.ts`.
 */
export { decodeSegment };

export interface ServiceResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const ok = (extra: Record<string, unknown>): ServiceResult =>
  ({ status: 200, body: { protocol: HERMES_SERVICE_PROTOCOL, ...extra } });

const err = (status: number, kind: string, message: string): ServiceResult =>
  ({ status, body: { protocol: HERMES_SERVICE_PROTOCOL, kind, error: message } });

/* ------------------------------------------------------------- schemas --- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const REVIEW_FIELDS = new Set(['runId', 'idempotencyKey', 'prompt', 'limits']);
const LIMIT_FIELDS = new Set(['timeoutMs', 'maxOutputBytes', 'maxTurns', 'maxPromptBytes']);

/**
 * SERVER-OWNED CEILINGS. THE CLIENT MAY ONLY ASK FOR LESS.
 *
 * The limits used to be taken from the request with nothing but a `> 0`
 * check, and the runner merged them OVER its defaults — so an authenticated
 * caller could ask for a 24-hour wall clock and a 1 GB output cap on a box
 * that owns the provider credential and pays for every run. "The bridge is
 * authenticated" is not a reason to trust a number: the service is the trust
 * boundary, and a bounded run is the product.
 *
 * Effective limit = min(requested, ceiling). Asking for more is not an error,
 * it is simply clamped, and the effective values are returned so a caller can
 * see exactly what it got.
 */
export const SERVICE_LIMIT_CEILINGS = Object.freeze({
  timeoutMs: 600_000,          // 10 minutes of wall clock, never a day
  maxOutputBytes: 1_048_576,   // 1 MiB of captured stdout
  maxPromptBytes: 262_144,     // 256 KiB, under the 512 KiB body cap
});

/**
 * The adapter runs Hermes with `-z/--oneshot`: a single prompt, a single final
 * response. There is no turn-limit flag, and the isolated profile pins
 * `agent.max_turns: 1`. Accepting any other number and silently running one
 * turn would be a fake control, so the contract states the real one.
 */
export const SERVICE_MAX_TURNS = 1;

export type ReviewBody = {
  runId: string; idempotencyKey: string; prompt: string;
  limits: { timeoutMs: number; maxOutputBytes: number; maxTurns: number; maxPromptBytes: number };
};

/**
 * Strict validation. Unknown properties are REJECTED rather than ignored: a
 * caller sending a field this service does not understand is a version skew or
 * an injection attempt, and silently dropping it would hide both.
 */
export function parseReviewBody(raw: unknown): { ok: true; value: ReviewBody } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: 'A JSON object body is required.' };
  for (const key of Object.keys(raw)) {
    if (!REVIEW_FIELDS.has(key)) return { ok: false, message: 'The request contained an unsupported field.' };
  }
  const str = (k: string): string | null => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  const runId = str('runId');
  const idempotencyKey = str('idempotencyKey');
  const prompt = typeof raw.prompt === 'string' && raw.prompt !== '' ? raw.prompt : null;
  if (runId === null || idempotencyKey === null || prompt === null) {
    return { ok: false, message: 'runId, idempotencyKey and prompt are required.' };
  }
  if (!isRecord(raw.limits)) return { ok: false, message: 'limits is required.' };
  for (const key of Object.keys(raw.limits)) {
    if (!LIMIT_FIELDS.has(key)) return { ok: false, message: 'limits contained an unsupported field.' };
  }
  // A limit must be a positive, finite, safe INTEGER. A fraction, an
  // overflowing float and a numeric string are all rejected rather than
  // coerced into something that looks like a bound.
  const num = (k: string): number | null => {
    const v = (raw.limits as Record<string, unknown>)[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if (!Number.isSafeInteger(v) || v <= 0) return null;
    return v;
  };
  const timeoutMs = num('timeoutMs');
  const maxOutputBytes = num('maxOutputBytes');
  const maxTurns = num('maxTurns');
  const maxPromptBytes = num('maxPromptBytes');
  if (timeoutMs === null || maxOutputBytes === null || maxTurns === null || maxPromptBytes === null) {
    return { ok: false, message: 'limits must be positive safe integers.' };
  }
  // The adapter is one-shot. Any other turn count is refused rather than
  // accepted and quietly ignored.
  if (maxTurns !== SERVICE_MAX_TURNS) {
    return {
      ok: false,
      message: `maxTurns must be ${SERVICE_MAX_TURNS}; the Hermes Reviewer adapter is one-shot.`,
    };
  }
  // Clamped, never trusted. Asking for more is allowed; getting more is not.
  const clamp = (requested: number, ceiling: number) => Math.min(requested, ceiling);
  return {
    ok: true,
    value: {
      runId, idempotencyKey, prompt,
      limits: {
        timeoutMs: clamp(timeoutMs, SERVICE_LIMIT_CEILINGS.timeoutMs),
        maxOutputBytes: clamp(maxOutputBytes, SERVICE_LIMIT_CEILINGS.maxOutputBytes),
        maxTurns: SERVICE_MAX_TURNS,
        maxPromptBytes: clamp(maxPromptBytes, SERVICE_LIMIT_CEILINGS.maxPromptBytes),
      },
    },
  };
}

/* -------------------------------------------------------------- routing --- */

/**
 * THERE IS NO `Retry-After` ON A CAPACITY REFUSAL, ON PURPOSE.
 *
 * There was: a constant 30 seconds, published in the body as
 * `retryAfterSeconds`, in the header as `Retry-After`, and in the README as
 * "how long a client should wait". The service cannot know that. A slot frees
 * when a run ends, and an admitted run may hold its slot for up to the full
 * clamped `timeoutMs` — ten minutes. Thirty was a guess wearing the clothes of
 * an answer, which is the one thing this codebase does not ship: a missing
 * value is Unknown, never a plausible default.
 *
 * Computing an honest one is possible in principle (the minimum remaining
 * reserved wall clock across active runs) and is deliberately not done here:
 * it would disclose another caller's run timing to whoever asked, and a
 * capacity message tells you only that you were not admitted.
 *
 * The 503 status already says "temporary, try again"; `capacity_exhausted`
 * already says why. Neither invents a number.
 */

export interface ServiceRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
}

export async function handleServiceRoute(
  request: ServiceRequest,
  engine: HermesReviewerTransport,
): Promise<ServiceResult> {
  const { method, path } = request;

  // Health is unauthenticated by design: a platform health check must reach
  // it. It therefore discloses nothing but liveness — no version, no host, no
  // configuration, and it never contacts a provider.
  if (method === 'GET' && path === '/healthz') {
    // Deterministic, provider-free, and it discloses nothing but liveness:
    // no version, no model, no credential state, no executable path. A
    // platform health check must never depend on a paid request.
    if (lifecycle === 'ready') return { status: 200, body: { status: 'ok' } };
    return {
      status: 503,
      body: { status: lifecycle === 'shutting_down' ? 'shutting_down' : 'starting' },
    };
  }

  if (!bearerMatches(request.authorization, request.env[SERVICE_TOKEN_ENV])) {
    return err(401, 'authentication_failed', 'Authentication is required for the Hermes Reviewer service.');
  }

  if (method === 'GET' && path === '/v1/readiness') {
    // Offline. No provider contact, no run created.
    const evidence = await engine.readiness();
    return ok({
      lifecycle,
      evidence: {
        installed: evidence.installed,
        version: evidence.version,
        compatible: evidence.compatible,
        machineInterface: evidence.machineInterface,
        machineInterfaceVerified: evidence.machineInterfaceVerified,
        // Presence only — never the value, the length, or a hash.
        credentialPresent: evidence.credentialPresent,
        modelVerified: evidence.modelVerified,
        requestedModel: evidence.requestedModel,
        verifiedModelId: evidence.verifiedModelId,
        readOnlyEnforceable: evidence.readOnlyEnforceable,
        failureReason: evidence.failureReason,
        // binaryPath is deliberately NOT included: it is host layout.
      },
      /**
       * The aggregate ceilings the RUNNING ENGINE enforces, so a caller can
       * see the bound rather than discover it as a 503. Ceilings only — never
       * the current occupancy, which would tell one caller what other callers
       * are doing.
       *
       * Read from the engine, not from the module constant this file imports.
       * The ceilings are constructor-injectable, so publishing the constant
       * was a claim about configuration rather than a report about what is
       * running — and an engine that enforces nothing would have published
       * them anyway. `null` when the engine enforces none: Unknown stays
       * Unknown and never becomes a default.
       */
      capacity: engine.ceilings ?? null,
      runCreated: false,
    });
  }

  if (method === 'POST' && path === '/v1/test-connection') {
    const evidence = await engine.testConnection();
    return ok({
      connected: evidence.connected,
      runCreated: false,
      identity: evidence.identity,
      failureKind: evidence.failureKind,
      safeMessage: evidence.safeMessage,
    });
  }

  if (method === 'POST' && path === '/v1/reviews') {
    if (lifecycle === 'shutting_down') {
      // Refused, not queued. Work started now would be killed moments later.
      return err(503, 'shutting_down', 'The Hermes Reviewer service is shutting down and is not accepting new reviews.');
    }
    const parsed = parseReviewBody(request.body);
    if (!parsed.ok) return err(422, 'validation_failed', parsed.message);
    const started = await engine.startReview(parsed.value);
    if (started.accepted) {
      // The EFFECTIVE limits are returned, so a caller can see what it
      // actually got rather than assuming it got what it asked for.
      return ok({
        accepted: true, runId: started.runId, duplicate: started.duplicate,
        limits: parsed.value.limits,
      });
    }
    // CAPACITY IS NOT A REFUSAL, AND NEITHER IS AN OUTAGE.
    //
    // A refusal is a decision about THIS request: it will not resolve itself,
    // and retrying is a new paid call — 409. Capacity is a statement about the
    // service's current load: the same request will succeed once a run
    // finishes — 503. Collapsing the two would send an operator to change a
    // request that was never the problem.
    //
    // 503 and the kind, and no invented wait. See CAPACITY notes above.
    //
    // A DRAINING ENGINE IS TEMPORARY TOO. The lifecycle check above answers
    // 503 for `shutting_down`; the ENGINE can also report it, from its own
    // `draining` flag, and that path used to fall through to 409 — the status
    // this service reserves for "will not resolve itself, retrying is a new
    // paid call". Two codes for one condition, differing only by which of two
    // lines in `main.ts` ran first. The whole reason the engine owns a drain
    // flag is that this ordering must not be what the answer depends on.
    if (started.failureKind === 'capacity_exhausted' || started.failureKind === 'shutting_down') {
      // The default follows the KIND. One shared fallback would tell a caller
      // refused by a draining service that it was at capacity.
      const fallback = started.failureKind === 'shutting_down'
        ? 'The Hermes Reviewer service is shutting down and is not accepting new reviews.'
        : 'The Hermes Reviewer service is at capacity.';
      return err(503, started.failureKind, started.safeMessage ?? fallback);
    }
    // A request the service understood and found malformed is 422, not 409:
    // 409 says "the service decided against this"; 422 says "this could not
    // be a valid request", and only one of them is worth re-sending changed.
    if (started.failureKind === 'validation_failed') {
      return err(422, 'validation_failed', started.safeMessage ?? 'The review request was not usable.');
    }
    return err(409, started.failureKind ?? 'review_refused', started.safeMessage ?? 'The review was refused.');
  }

  const stateMatch = /^\/v1\/reviews\/([^/]+)$/.exec(path);
  if (stateMatch !== null && method === 'GET') {
    const runId = decodeSegment(stateMatch[1]);
    // NOT the unknown-route message. The operation is perfectly well known —
    // it is the run id that cannot be read. Answering both with one sentence
    // tells an operator to check the URL shape when the URL shape was right.
    if (runId === null) return err(404, 'not_found', 'That run id could not be read as a run id.');
    const state = await engine.getReview(runId);
    return ok({
      runId: state.runId,
      status: state.status,
      reviewText: state.reviewText,
      usage: state.usage,
      failureKind: state.failureKind,
      safeMessage: state.safeMessage,
    });
  }

  const cancelMatch = /^\/v1\/reviews\/([^/]+)\/cancel$/.exec(path);
  if (cancelMatch !== null && method === 'POST') {
    const cancelId = decodeSegment(cancelMatch[1]);
    if (cancelId === null) return err(404, 'not_found', 'That run id could not be read as a run id.');
    const result = await engine.cancelReview(cancelId);
    return ok({
      requested: result.requested,
      terminationConfirmed: result.terminationConfirmed,
      safeMessage: result.safeMessage,
    });
  }

  return err(404, 'not_found', 'Unknown Hermes Reviewer operation.');
}

/* --------------------------------------------------------------- server --- */

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      // Over-cap bodies are dropped rather than buffered.
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) { resolve(undefined); return; }
      if (chunks.length === 0) { resolve(undefined); return; }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

export function createHermesService(engine: HermesReviewerTransport): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0];
      const method = req.method ?? 'GET';
      let result: ServiceResult;
      try {
        result = await handleServiceRoute({
          method,
          path,
          authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
          body: method === 'POST' ? await readBody(req) : undefined,
          env: process.env,
        }, engine);
      } catch {
        // An internal fault is reported as one. The cause is never reflected:
        // it can carry a prompt, a path, or a credential.
        result = err(500, 'internal_error', 'The Hermes Reviewer service could not complete the request.');
      }
      const payload = JSON.stringify(result.body);
      res.writeHead(result.status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        // This is a private machine API. No browser may reach it directly.
        'cache-control': 'no-store',
        // No `Retry-After`. The service does not know when a slot frees, and
        // the constant that used to be sent here was a guess published as an
        // answer. See the CAPACITY note above `handleServiceRoute`.
      });
      res.end(payload);
    })();
  });
}

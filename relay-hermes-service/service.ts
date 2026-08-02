import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HERMES_SERVICE_PROTOCOL } from '../relay-bridge/reviewer-harness/hermes/hermes-transport';
import type { HermesReviewerTransport } from '../relay-bridge/reviewer-harness/hermes/hermes-transport';

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
 * Constant-time bearer comparison, matching the bridge's own implementation.
 * A length mismatch still performs a comparison so the reply time does not
 * distinguish "wrong length" from "wrong value".
 */
export function bearerMatches(header: string | undefined, expected: string | undefined): boolean {
  if (typeof expected !== 'string' || expected.trim() === '') return false;
  const presented = Buffer.from(
    typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '',
    'utf8',
  );
  const secret = Buffer.from(expected, 'utf8');
  if (presented.length !== secret.length) {
    timingSafeEqual(secret, secret);
    return false;
  }
  return timingSafeEqual(presented, secret);
}

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
  const num = (k: string): number | null => {
    const v = (raw.limits as Record<string, unknown>)[k];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  };
  const timeoutMs = num('timeoutMs');
  const maxOutputBytes = num('maxOutputBytes');
  const maxTurns = num('maxTurns');
  const maxPromptBytes = num('maxPromptBytes');
  if (timeoutMs === null || maxOutputBytes === null || maxTurns === null || maxPromptBytes === null) {
    return { ok: false, message: 'limits must be positive numbers.' };
  }
  return { ok: true, value: { runId, idempotencyKey, prompt, limits: { timeoutMs, maxOutputBytes, maxTurns, maxPromptBytes } } };
}

/* -------------------------------------------------------------- routing --- */

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
    return started.accepted
      ? ok({ accepted: true, runId: started.runId, duplicate: started.duplicate })
      : err(409, started.failureKind ?? 'malformed_response', started.safeMessage ?? 'The review was refused.');
  }

  const stateMatch = /^\/v1\/reviews\/([^/]+)$/.exec(path);
  if (stateMatch !== null && method === 'GET') {
    const state = await engine.getReview(decodeURIComponent(stateMatch[1]));
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
    const result = await engine.cancelReview(decodeURIComponent(cancelMatch[1]));
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
      });
      res.end(payload);
    })();
  });
}

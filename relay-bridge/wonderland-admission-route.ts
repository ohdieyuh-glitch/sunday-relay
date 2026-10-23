/**
 * WONDERLAND → JULIUS ADMISSION ROUTE.
 *
 * POST /relay-api/wonderland/julius/dispatch reserves one run for a client
 * (run id, idempotency key) pair. The flag JULIUS_WONDERLAND_ADMISSION must be
 * exactly `1`. Off, the route answers 503 julius_dispatch_disabled and
 * reserves nothing. On, the route answers 503 julius_dispatch_unavailable
 * unless JULIUS_WONDERLAND_ADMISSION_STORE is a local absolute writable path.
 * Tests pass a ledger. Production does not construct the in-memory ledger.
 *
 * This is not the paid workflow. confirmLive is empty, submitted is false,
 * and no provider, GitHub dispatch, or retry is reachable from here.
 *
 * JULIUS_WONDERLAND_ADMISSION_STORE, when set, is a file on this machine.
 * A URL is not a store: admission stays unconfigured and reserves nothing.
 * The operator claim tool reads that same file. This route does not start
 * a paid run.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bearerMatches } from './bearer-auth';
import { sessionTokenFrom } from './browser-session/routes';
import {
  CANONICAL_UUID_V4,
  CLIENT_TRIGGER_ID,
  J1_IDEMPOTENCY_KEY,
  JULIUS_BOOTSTRAP_RUN_ID,
  MISSION_SLUG,
  SHA256_HEX,
  createWonderlandAdmissionStore,
  parseWorkflowModelPins,
  type AdmissionLedger,
  type AdmissionOutcome,
  type AdmissionRun,
  type ReviewedModelPins,
} from '../src/relay/integration/wonderland-admission';
import {
  AdmissionFileClosedError,
  createFileAdmissionLedger,
  isAdmissionFileClosed,
  isLocalStorePath,
  readAdmissionDocument,
  recordAdmissionOwner,
  resolveAdmissionStorePath,
  type ClaimEvent,
  type OperatorDocument,
  type StoredAdmission,
} from '../src/relay/integration/wonderland-admission/admission-file';

export const WONDERLAND_ADMISSION_PATH = '/wonderland/julius/dispatch';
export const WONDERLAND_STATUS_PATH = '/wonderland/julius/status';
export const WONDERLAND_ADMISSION_FLAG = 'JULIUS_WONDERLAND_ADMISSION';
export const WONDERLAND_ADMISSION_STORE = 'JULIUS_WONDERLAND_ADMISSION_STORE';

const EMPTY_PINS: ReviewedModelPins = {
  architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null,
};

/**
 * Pathname of a bridge path. A query is not part of the route. A trailing
 * slash is, so `/wonderland/julius/dispatch/` is not this route.
 */
export function wonderlandAdmissionPathname(path: string): string {
  try {
    return new URL(path, 'http://relay.invalid').pathname;
  } catch {
    return path.split('?')[0] || '/';
  }
}

export function isWonderlandAdmissionRoute(path: string): boolean {
  return wonderlandAdmissionPathname(path) === WONDERLAND_ADMISSION_PATH;
}

export function isWonderlandStatusRoute(path: string): boolean {
  return wonderlandAdmissionPathname(path) === WONDERLAND_STATUS_PATH;
}

/** Map a mission-handler request onto this route. The raw key is hashed later. */
export function wonderlandAdmissionRequestFrom(request: {
  readonly method: string;
  readonly path: string;
  readonly url?: string | undefined;
  readonly authorization?: string | undefined;
  readonly origin?: string | undefined;
  readonly body?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly remoteAddress?: string | undefined;
  readonly host?: string | undefined;
  readonly forwarded?: boolean | undefined;
  readonly nowIso?: string | undefined;
  readonly nowMs?: number | undefined;
}): WonderlandAdmissionRouteRequest {
  return {
    method: request.method,
    path: request.path,
    url: request.url ?? '',
    authorization: request.authorization,
    origin: request.origin,
    rawBody: request.body,
    idempotencyKey: request.idempotencyKey,
    remoteAddress: request.remoteAddress,
    host: request.host,
    forwarded: request.forwarded ?? true,
    nowIso: request.nowIso ?? '',
    nowMs: request.nowMs ?? Number.NaN,
  };
}

export function createWonderlandStatusBridge(ports: WonderlandAdmissionRoutePorts): {
  readonly path: string;
  handle(request: {
    readonly method: string;
    readonly path: string;
    readonly url?: string | undefined;
    readonly authorization?: string | undefined;
    readonly origin?: string | undefined;
    readonly body?: string | undefined;
    readonly idempotencyKey?: string | undefined;
    readonly remoteAddress?: string | undefined;
    readonly host?: string | undefined;
    readonly forwarded?: boolean | undefined;
    readonly nowIso?: string | undefined;
    readonly nowMs?: number | undefined;
  }): Promise<{ status: number; body: unknown } | null>;
} {
  return {
    path: WONDERLAND_STATUS_PATH,
    handle: (request) => handleWonderlandStatusRoute(wonderlandAdmissionRequestFrom(request), ports),
  };
}

export function createWonderlandAdmissionBridge(ports: WonderlandAdmissionRoutePorts): {
  readonly path: string;
  handle(request: {
    readonly method: string;
    readonly path: string;
    readonly url?: string | undefined;
    readonly authorization?: string | undefined;
    readonly origin?: string | undefined;
    readonly body?: string | undefined;
    readonly idempotencyKey?: string | undefined;
    readonly remoteAddress?: string | undefined;
    readonly host?: string | undefined;
    readonly forwarded?: boolean | undefined;
    readonly nowIso?: string | undefined;
    readonly nowMs?: number | undefined;
  }): Promise<{ status: number; body: unknown } | null>;
} {
  return {
    path: WONDERLAND_ADMISSION_PATH,
    handle: (request) => handleWonderlandAdmissionRoute(wonderlandAdmissionRequestFrom(request), ports),
  };
}

export function isLoopbackPeer(remoteAddress: string | undefined, host: string | undefined, forwarded: boolean): boolean {
  if (forwarded) return false;
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') return false;
  if (host === undefined) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

export interface WonderlandAdmissionRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly rawBody: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly remoteAddress: string | undefined;
  readonly host: string | undefined;
  readonly forwarded: boolean;
  readonly nowIso: string;
  readonly nowMs: number;
}

export interface WonderlandNativeSession {
  readonly playerId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

export interface WonderlandAdmissionRoutePorts {
  readonly env: Record<string, string | undefined>;
  readonly operatorToken: string | undefined;
  readonly verifyNativeSession: (input: { token: string; now: number }) => WonderlandNativeSession | null;
  readonly readWorkflowText: () => string | null;
  readonly admit: (request: {
    readonly runId: string;
    readonly keyHash: string;
    readonly dispatchId: string;
    readonly missionId: string | null;
    readonly requestId: string;
    readonly clientLogSha256: string;
    readonly clientUiActionUtc: string;
    readonly receivedAt: string;
    readonly modelPins: ReviewedModelPins;
    readonly ownerPlayerId?: string;
  }) => Promise<AdmissionOutcome>;
  /** False when caps or the mission slug could not be read. No store exists. */
  readonly configured: boolean;
  /**
   * False when production has no local absolute writable store path, or the
   * file is corrupt, locked, or unreadable. Tests that pass a ledger are ready.
   */
  readonly admissionStoreReady: boolean;
  /** Releases the file lock. A memory ledger has nothing to release. */
  close(): void;
}

const err = (status: number, kind: string, message: string) => ({ status, body: { error: { kind, message } } });

const STATUS_NOT_FOUND = {
  status: 404,
  body: { error: { kind: 'not_found', message: 'Not found.' } },
} as const;

/**
 * The guards shared with admission. A status read uses this function and then
 * only reads the admission file. It does not admit, claim, or start a process.
 */
function juliusLoopbackGuard(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandAdmissionRoutePorts,
): { readonly native: WonderlandNativeSession } | { readonly status: number; readonly body: unknown } {
  if (!isLoopbackPeer(request.remoteAddress, request.host, request.forwarded)) {
    return err(403, 'julius_dispatch_not_loopback', 'Mission dispatch is only served to the same machine.');
  }
  if (ports.env[WONDERLAND_ADMISSION_FLAG] !== '1') {
    return err(503, 'julius_dispatch_disabled', 'Mission dispatch is switched off.');
  }
  if (!ports.admissionStoreReady) {
    return Promise.resolve(err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.'));
  }
  if (request.origin !== undefined) {
    return err(403, 'julius_dispatch_browser_refused', 'Only the paired game client may use this route.');
  }
  if (bearerMatches(request.authorization, ports.operatorToken)) {
    return err(403, 'julius_dispatch_operator_is_not_the_game', 'The in-game trigger must come from the paired game client.');
  }
  const token = sessionTokenFrom(request.authorization);
  const native = token === null ? null : ports.verifyNativeSession({ token, now: request.nowMs });
  if (native === null) return err(401, 'sign_in_required', 'Mission dispatch needs a paired Wonderland session.');
  const project = (ports.env.JULIUS_J1_PROJECT_ID ?? '').trim();
  const founder = (ports.env.JULIUS_J1_FOUNDER_PLAYER_ID ?? '').trim();
  if (!ports.configured || project === '' || founder === '') {
    return err(503, 'julius_dispatch_not_configured', 'Wonderland admission is not configured. Nothing was reserved.');
  }
  let projectId = '';
  try {
    projectId = new URL(request.url, 'http://relay.invalid').searchParams.get('projectId') ?? '';
  } catch {
    projectId = '';
  }
  if (projectId === '' || native.projectId !== projectId || projectId !== project) {
    return err(403, 'julius_dispatch_wrong_project', 'This session was not paired for that project.');
  }
  if (native.playerId !== founder) {
    return err(403, 'julius_dispatch_founder_only', 'Only the founder player may admit a Wonderland mission.');
  }
  return { native };
}

function guardPassed(
  result: { readonly native: WonderlandNativeSession } | { readonly status: number; readonly body: unknown },
): result is { readonly native: WonderlandNativeSession } {
  return 'native' in result;
}

export function handleWonderlandAdmissionRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandAdmissionRoutePorts,
): Promise<{ status: number; body: unknown } | null> {
  if (!isWonderlandAdmissionRoute(request.path)) return Promise.resolve(null);
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return Promise.resolve(guarded);
  if (request.method !== 'POST') return Promise.resolve(err(405, 'method_not_allowed', 'Dispatch is a POST.'));
  if (request.idempotencyKey === undefined || !J1_IDEMPOTENCY_KEY.test(request.idempotencyKey) || !CANONICAL_UUID_V4.test(request.idempotencyKey)) {
    return Promise.resolve(err(400, 'julius_dispatch_idempotency_key_invalid', 'x-relay-idempotency-key is required.'));
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(request.rawBody ?? '');
    body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  if (body === null) return Promise.resolve(err(400, 'julius_dispatch_body_invalid', 'The body must be JSON.'));
  const runId = body.runId;
  if (typeof runId !== 'string') return Promise.resolve(err(400, 'julius_dispatch_run_invalid', 'runId is required.'));
  const clientTriggerId = body.clientTriggerId;
  const clientLogSha256 = body.clientLogSha256;
  const clientUiActionUtc = body.clientUiActionUtc;
  if (typeof clientTriggerId !== 'string' || !CLIENT_TRIGGER_ID.test(clientTriggerId)
    || typeof clientLogSha256 !== 'string' || !SHA256_HEX.test(clientLogSha256)
    || typeof clientUiActionUtc !== 'string' || !Number.isFinite(Date.parse(clientUiActionUtc))) {
    return Promise.resolve(err(400, 'julius_dispatch_client_log_binding_required',
      'clientTriggerId, clientLogSha256 (the hash of the client log line written before this request) and clientUiActionUtc are required.'));
  }
  const clientOffsetMs = body.clientOffsetMs;
  const echoId = body.echoId;
  if ((clientOffsetMs !== undefined && (typeof clientOffsetMs !== 'number' || !Number.isFinite(clientOffsetMs)))
    || (echoId !== undefined && (typeof echoId !== 'string' || echoId.length > 128))) {
    return Promise.resolve(err(400, 'julius_dispatch_clock_binding_invalid', 'clientOffsetMs must be a number and echoId a string.'));
  }
  const keyHash = createHash('sha256').update(request.idempotencyKey).digest('hex');
  const dispatchId = `adm_${createHash('sha256').update(`${runId}\0${request.idempotencyKey}`).digest('hex').slice(0, 32)}`;
  const missionRaw = (ports.env.JULIUS_WONDERLAND_MISSION ?? '').trim();
  const missionId = missionRaw === '' ? null : missionRaw;
  return ports.admit({
    runId,
    keyHash,
    dispatchId,
    missionId,
    requestId: clientTriggerId,
    clientLogSha256,
    clientUiActionUtc,
    receivedAt: request.nowIso,
    modelPins: readPins(ports.readWorkflowText),
    ownerPlayerId: guarded.native.playerId,
  }).then((outcome) => {
    if (outcome.ok) {
      recordAdmissionOwner(ports.env.JULIUS_WONDERLAND_ADMISSION_STORE, outcome.run.serverRunId, guarded.native.playerId);
    }
    return toHttp(outcome);
  }, (error: unknown) => (
    isAdmissionFileClosed(error)
      ? err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.')
      : { status: 500, body: {} }
  ));
}

/**
 * GET /wonderland/julius/status?runId=<run:24hex>&projectId=
 * Reads the admission file. A missing file is an unknown run. A held row
 * stays held. Progress is returned only when the file already holds it.
 */
export function handleWonderlandStatusRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandAdmissionRoutePorts,
): Promise<{ status: number; body: unknown } | null> {
  if (!isWonderlandStatusRoute(request.path)) return Promise.resolve(null);
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return Promise.resolve(guarded);
  if (request.method !== 'GET') return Promise.resolve(err(405, 'method_not_allowed', 'Status is a GET.'));
  const storePath = (ports.env.JULIUS_WONDERLAND_ADMISSION_STORE ?? '').trim();
  if (storePath === '' || !isLocalStorePath(storePath)) {
    return Promise.resolve(err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.'));
  }
  let runId = '';
  try {
    runId = new URL(request.url, 'http://relay.invalid').searchParams.get('runId') ?? '';
  } catch {
    runId = '';
  }
  if (!JULIUS_BOOTSTRAP_RUN_ID.test(runId)) return Promise.resolve(STATUS_NOT_FOUND);
  let document: OperatorDocument;
  try {
    document = readAdmissionDocument(storePath);
  } catch (error) {
    if (isAdmissionFileClosed(error)) {
      return Promise.resolve(err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.'));
    }
    return Promise.resolve({ status: 500, body: {} });
  }
  const admission = document.admissions.find((row) => row.serverRunId === runId) ?? null;
  if (admission === null) return Promise.resolve(STATUS_NOT_FOUND);
  const owner = admission.ownerPlayerId ?? (ports.env.JULIUS_J1_FOUNDER_PLAYER_ID ?? '').trim();
  if (owner === '' || owner !== guarded.native.playerId) return Promise.resolve(STATUS_NOT_FOUND);
  const view = statusView(admission, document, runId);
  if (view === null) return Promise.resolve(STATUS_NOT_FOUND);
  return Promise.resolve({ status: 200, body: view });
}

function statusView(admission: StoredAdmission, document: OperatorDocument, serverRunId: string): Record<string, string> | null {
  const progress = [...(document.progress ?? [])].reverse().find((note) => note.serverRunId === serverRunId) ?? null;
  if (progress !== null) return statusBody(admission.runId, serverRunId, progress.state, progress.cause, progress.updatedAt);
  const claim = [...document.claims].reverse().find((event) => event.serverRunId === serverRunId && event.wonderlandRunId === admission.runId) ?? null;
  if (claim !== null) return statusBody(admission.runId, serverRunId, claim.state, claimCause(claim), claim.at);
  if (admission.admissionState !== 'ADMISSION_HELD') return null;
  return statusBody(admission.runId, serverRunId, 'held', null, admission.receivedAt);
}

function claimCause(claim: ClaimEvent): string | null {
  if (claim.halt !== null) return claim.halt;
  return claim.dispatchError;
}

function statusBody(
  wljRunId: string,
  serverRunId: string,
  state: string,
  cause: string | null,
  updatedAt: string,
): Record<string, string> {
  const body: Record<string, string> = { wljRunId, serverRunId, state };
  if (cause !== null && cause !== '') body.cause = cause;
  body.updatedAt = updatedAt;
  return body;
}

export function toHttp(outcome: AdmissionOutcome): { status: number; body: unknown } {
  if (!outcome.ok) return err(outcome.httpStatus, outcome.kind, outcome.message);
  const run: AdmissionRun = outcome.run;
  return {
    status: outcome.httpStatus,
    body: {
      data: {
        runId: run.runId,
        serverRunId: run.serverRunId,
        dispatchId: run.dispatchId,
        state: run.state,
        replayed: outcome.replayed,
        ledgerRef: run.ledgerRef,
        mode: 'admission',
        dispatched: false,
        confirmLive: run.paidWorkflow.confirmLive,
        submittedToPaidWorkflow: run.paidWorkflow.submitted,
        correlation: {
          runId: run.runId,
          requestId: run.requestId,
          idempotencyKeyHash: run.keyHash,
          clientUiActionUtc: run.clientUiActionUtc,
          receivedAt: run.receivedAt,
          ledgerRef: run.ledgerRef,
          resultSha256: run.resultSha256,
        },
        modelPins: run.modelPins,
        gatesRemaining: run.paidWorkflow.gatesRemaining,
      },
    },
  };
}

function readPins(readWorkflowText: () => string | null): ReviewedModelPins {
  try {
    const text = readWorkflowText();
    if (text === null || text.trim() === '') return EMPTY_PINS;
    return parseWorkflowModelPins(text).pins;
  } catch {
    return EMPTY_PINS;
  }
}

function positiveInt(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[1-9]\d{0,8}$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function createWonderlandAdmissionService(input: {
  readonly env: Record<string, string | undefined>;
  readonly verifyNativeSession: (value: { token: string; now: number }) => WonderlandNativeSession | null;
  readonly readWorkflowText?: () => string | null;
  /**
   * Test seam. Production leaves this unset and opens
   * `JULIUS_WONDERLAND_ADMISSION_STORE`. There is no in-memory fallback.
   */
  readonly ledger?: AdmissionLedger;
  readonly operatorToken?: string | undefined;
  /**
   * CSPRNG for the server `run:` id. The default is 12 `randomBytes`, which
   * is `run:` plus 24 lowercase hex, the Julius bootstrap run-id shape.
   * A replay does not call it.
   */
  readonly mintServerRunId?: () => string;
}): WonderlandAdmissionRoutePorts {
  const missionRaw = (input.env.JULIUS_WONDERLAND_MISSION ?? '').trim();
  const missionOk = missionRaw === '' || MISSION_SLUG.test(missionRaw);
  const dailyCap = positiveInt(input.env.JULIUS_J1_DAILY_CAP, 2);
  const missionCap = positiveInt(input.env.JULIUS_J1_MAX_RUNS_PER_MISSION, 2);
  const configured = missionOk && dailyCap !== null && missionCap !== null;
  const mintServerRunId = input.mintServerRunId ?? (() => `run:${randomBytes(12).toString('hex')}`);
  const opened = openAdmissionLedger(input);
  const store = configured && opened.ledger !== null
    ? createWonderlandAdmissionStore({
      ledger: opened.ledger,
      dailyCap: dailyCap ?? 2,
      missionCap: missionCap ?? 2,
      mintServerRunId,
    })
    : null;
  return {
    env: input.env,
    operatorToken: input.operatorToken,
    verifyNativeSession: input.verifyNativeSession,
    readWorkflowText: input.readWorkflowText ?? defaultWorkflowText,
    configured,
    admissionStoreReady: opened.ready,
    close: opened.close,
    admit: (request) => {
      if (!opened.ready) return Promise.reject(new AdmissionFileClosedError('unwritable'));
      if (store === null) return Promise.reject(new Error('admission_not_configured'));
      return store.admit(request);
    },
  };
}

function openAdmissionLedger(input: {
  readonly env: Record<string, string | undefined>;
  readonly ledger?: AdmissionLedger;
}): { readonly ledger: AdmissionLedger | null; readonly ready: boolean; close(): void } {
  if (input.ledger !== undefined) {
    return { ledger: input.ledger, ready: true, close() {} };
  }
  const located = resolveAdmissionStorePath(input.env.JULIUS_WONDERLAND_ADMISSION_STORE);
  if (WONDERLAND_ADMISSION_STORE !== 'JULIUS_WONDERLAND_ADMISSION_STORE') {
    return { ledger: null, ready: false, close() {} };
  }
  if (!located.ok) return { ledger: null, ready: false, close() {} };
  try {
    const file = createFileAdmissionLedger(located.path);
    return { ledger: file, ready: true, close: () => file.close() };
  } catch {
    return { ledger: null, ready: false, close() {} };
  }
}

function defaultWorkflowText(): string | null {
  try {
    return readFileSync(join(process.cwd(), '.github/workflows/julius-first-live-mission.yml'), 'utf8');
  } catch {
    return null;
  }
}

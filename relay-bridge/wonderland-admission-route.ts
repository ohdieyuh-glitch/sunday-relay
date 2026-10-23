/**
 * WONDERLAND → JULIUS ADMISSION ROUTE.
 *
 * POST /relay-api/wonderland/julius/dispatch reserves one run for a client
 * (run id, idempotency key) pair. The flag JULIUS_WONDERLAND_ADMISSION must be
 * exactly `1`. Off, the route answers 503 julius_dispatch_disabled and
 * reserves nothing.
 *
 * This is not the paid workflow. confirmLive is empty, submitted is false,
 * and no provider, GitHub dispatch, or retry is reachable from here.
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
  MISSION_SLUG,
  SHA256_HEX,
  createWonderlandAdmissionStore,
  parseWorkflowModelPins,
  type AdmissionLedger,
  type AdmissionLedgerRow,
  type AdmissionOutcome,
  type AdmissionRun,
  type ReviewedModelPins,
} from '../src/relay/integration/wonderland-admission';

export const WONDERLAND_ADMISSION_PATH = '/wonderland/julius/dispatch';
export const WONDERLAND_ADMISSION_FLAG = 'JULIUS_WONDERLAND_ADMISSION';

const EMPTY_PINS: ReviewedModelPins = {
  architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null,
};

export function isWonderlandAdmissionRoute(path: string): boolean {
  return path === WONDERLAND_ADMISSION_PATH;
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
  }) => Promise<AdmissionOutcome>;
  /** False when caps or the mission slug could not be read. No store exists. */
  readonly configured: boolean;
}

const err = (status: number, kind: string, message: string) => ({ status, body: { error: { kind, message } } });

export function handleWonderlandAdmissionRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandAdmissionRoutePorts,
): Promise<{ status: number; body: unknown } | null> {
  if (!isWonderlandAdmissionRoute(request.path)) return Promise.resolve(null);
  if (!isLoopbackPeer(request.remoteAddress, request.host, request.forwarded)) {
    return Promise.resolve(err(403, 'julius_dispatch_not_loopback', 'Mission dispatch is only served to the same machine.'));
  }
  if (ports.env[WONDERLAND_ADMISSION_FLAG] !== '1') {
    return Promise.resolve(err(503, 'julius_dispatch_disabled', 'Mission dispatch is switched off.'));
  }
  if (request.origin !== undefined) {
    return Promise.resolve(err(403, 'julius_dispatch_browser_refused', 'Only the paired game client may use this route.'));
  }
  if (bearerMatches(request.authorization, ports.operatorToken)) {
    return Promise.resolve(err(403, 'julius_dispatch_operator_is_not_the_game', 'The in-game trigger must come from the paired game client.'));
  }
  const token = sessionTokenFrom(request.authorization);
  const native = token === null ? null : ports.verifyNativeSession({ token, now: request.nowMs });
  if (native === null) return Promise.resolve(err(401, 'sign_in_required', 'Mission dispatch needs a paired Wonderland session.'));

  const project = (ports.env.JULIUS_J1_PROJECT_ID ?? '').trim();
  const founder = (ports.env.JULIUS_J1_FOUNDER_PLAYER_ID ?? '').trim();
  if (!ports.configured || project === '' || founder === '') {
    return Promise.resolve(err(503, 'julius_dispatch_not_configured', 'Wonderland admission is not configured. Nothing was reserved.'));
  }
  let projectId = '';
  try {
    projectId = new URL(request.url, 'http://relay.invalid').searchParams.get('projectId') ?? '';
  } catch {
    projectId = '';
  }
  if (projectId === '' || native.projectId !== projectId || projectId !== project) {
    return Promise.resolve(err(403, 'julius_dispatch_wrong_project', 'This session was not paired for that project.'));
  }
  if (native.playerId !== founder) {
    return Promise.resolve(err(403, 'julius_dispatch_founder_only', 'Only the founder player may admit a Wonderland mission.'));
  }
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
  }).then(toHttp, () => ({ status: 500, body: {} }));
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
  const store = configured
    ? createWonderlandAdmissionStore({
      ledger: input.ledger ?? memoryLedger(),
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
    admit: (request) => {
      if (store === null) return Promise.reject(new Error('admission_not_configured'));
      return store.admit(request);
    },
  };
}

function memoryLedger(): AdmissionLedger {
  const held: AdmissionLedgerRow[] = [];
  return {
    async rows() { return held.slice(); },
    async append(row) { held.push(row); },
  };
}

function defaultWorkflowText(): string | null {
  try {
    return readFileSync(join(process.cwd(), '.github/workflows/julius-first-live-mission.yml'), 'utf8');
  } catch {
    return null;
  }
}

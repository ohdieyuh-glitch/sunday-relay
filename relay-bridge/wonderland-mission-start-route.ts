/**
 * POST /relay-api/wonderland/julius/missions/{wljRunId}/start?projectId=
 *
 * THE FOUNDER'S START, FROM INSIDE WONDERLAND. The Julius Mission Terminal
 * sends this once, on the founder's explicit Start, carrying the fixed
 * confirmation `RUN LIVE MISSION`. The bridge then runs the EXISTING operator
 * claim core (operator-claim.ts) for that admission with `--dispatch`: the
 * lane grant, workflow and contract read at main, the spent-tag absence check,
 * the `dispatching` reservation under the write lock, the exact `gh` argv, and
 * the same idempotency. Nothing here re-implements a spend gate; the paid
 * workflow stays the spend authority ($30, 3 repair cycles, from the contract).
 *
 * Guarded exactly like /status and /events (loopback, a paired native session,
 * the J1 project, the founder player) and the admission row must be owned by
 * that player. Off unless JULIUS_WONDERLAND_START is exactly `1`, and unusable
 * unless the repository (JULIUS_WONDERLAND_GITHUB_REPO) and the lane
 * (JULIUS_WONDERLAND_START_LANE) are set on the bridge. The client never sends
 * a lane, a budget, a repository, a mission or a ref.
 *
 * ONE PAID RUN PER ADMISSION. A repeat for an admission that is already
 * dispatching or dispatched never runs `gh` again: it answers 200 with the
 * recorded state and workflowRunId and `replayed: true`. Two requests at once
 * are serialized by the claim core; the second replays.
 *
 * `gh` runs under the founder's own login on this machine. No credential is
 * read here, and none is sent to or from the client. The response carries only
 * the wlj, the state, the workflowRunId, dispatchedAt and replayed.
 *
 * THE SECOND PHRASE. When either count the paid workflow gates on for this
 * mission (its attempted markers, or its step-9 completed markers plus the
 * recorded constant) is PROVEN above zero, the claim core refuses
 * (`julius_rerun_consent_required`, 409, nothing claimed or dispatched, the
 * admission still held) unless this body also carries
 * `acknowledgeRerun: "RERUN PAID MISSION"`, typed by the founder for THIS
 * admission. Any other value of that key is a 400 before any claim. An
 * UNKNOWN count is refused whatever the body says
 * (`julius_prior_attempts_unknown`). A count of 0 ignores the key. The phrase
 * comes only from this body: never from the environment, a config, a default
 * or a replay. A replay of a started admission never runs `gh` again, so it
 * never re-sends it.
 *
 * V2 (JULIUS_WONDERLAND_START_V2 exactly `1`, with JULIUS_WONDERLAND_START).
 * The claim core runs over {@link ghClaimSpawnerAsync}: the same argv, order
 * and timeout, in a child the event loop does not wait on, so /status,
 * /events and /result keep answering while `gh` runs. The claim also records
 * the Start binding: sha256 of `x-relay-idempotency-key` and the body's
 * `clientTriggerId`, on the `dispatching` reservation before
 * `gh workflow run`. The binding opens no gate; a retried Start still replays
 * the recorded claim whatever key it carries. Unset, nothing here changes.
 */

import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { CANONICAL_UUID_V4, CLIENT_TRIGGER_ID, J1_IDEMPOTENCY_KEY } from '../src/relay/integration/wonderland-admission';
import { parseJuliusAdmissionRunId } from '../src/relay/integration/wonderland-admission/admission-run-id';
import {
  ghResultFromChildExit,
  OPERATOR_DISPATCH_CONFIRMATION,
  OPERATOR_LANES,
  openOperatorClaimTool,
  RERUN_PAID_MISSION_CONFIRMATION,
  type AwaitableGhSpawner,
  type ClaimResult,
  type GhResult,
  type GhSpawner,
  type OperatorClaimTool,
  type OperatorView,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import {
  guardPassed,
  juliusLoopbackGuard,
  readAdmittedWonderlandStatus,
  wonderlandAdmissionPathname,
  wonderlandAdmissionRequestFrom,
  type WonderlandAdmissionRoutePorts,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { createGhPriorAttemptReader } from './wonderland-prior-attempts';

const START_PATH = /^\/wonderland\/julius\/missions\/([^/]+)\/start$/u;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
export const WONDERLAND_START_FLAG = 'JULIUS_WONDERLAND_START';
/** The v2 Start: an awaitable `gh` and a recorded Start binding. Off unless exactly `1`. */
export const WONDERLAND_START_V2_FLAG = 'JULIUS_WONDERLAND_START_V2';
/** A `gh` call from the claim core that takes longer than this is a failure, not waited on. */
export const GH_CLAIM_TIMEOUT_MS = 120_000;

/** The claim core's states that mean a paid dispatch was reserved or made: a start never runs `gh` past these. */
const STARTED_STATES: ReadonlySet<string> = new Set(['dispatching', 'dispatched']);

export interface WonderlandMissionStartBridge {
  matches(path: string): boolean;
  handle(request: Parameters<typeof wonderlandAdmissionRequestFrom>[0]): Promise<{ status: number; body: unknown } | null>;
}

export interface WonderlandMissionStartDeps {
  /** The claim core for the admission file. Production opens it once, over the founder's own `gh`; tests pass a fake. */
  readonly claimTool: (storePath: string) => OperatorClaimTool;
  /** V2 only: the claim core over an awaitable `gh`. Absent, v2 uses `claimTool`. */
  readonly claimToolV2?: (storePath: string) => OperatorClaimTool;
  /** V2 only: the Starts this process is running, so /status can say a Start was received. */
  readonly startsInFlight?: WonderlandStartsInFlight;
}

/** The wlj ids whose Start request this process is still running. In memory only. */
export interface WonderlandStartsInFlight {
  has(wljRunId: string): boolean;
  enter(wljRunId: string): void;
  leave(wljRunId: string): void;
}

export function createWonderlandStartsInFlight(): WonderlandStartsInFlight {
  const counts = new Map<string, number>();
  return {
    has: (wlj) => (counts.get(wlj) ?? 0) > 0,
    enter: (wlj) => { counts.set(wlj, (counts.get(wlj) ?? 0) + 1); },
    leave: (wlj) => {
      const next = (counts.get(wlj) ?? 0) - 1;
      if (next > 0) counts.set(wlj, next);
      else counts.delete(wlj);
    },
  };
}

/** `gh`, with the claim core's argv as given: no shell, a timeout, the founder's own login. */
export const ghClaimSpawner: GhSpawner = {
  run(args): GhResult {
    try {
      const result = spawnSync('gh', [...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GH_CLAIM_TIMEOUT_MS,
        windowsHide: true,
      });
      // A timeout, a signal kill or a failed spawn is reported as such, never as an ordinary non-zero exit.
      return ghResultFromChildExit(result);
    } catch {
      return { code: 127, stdout: '', stderr: '', failure: 'spawn_failed' };
    }
  },
};

/**
 * An `execFile` callback's answer as a {@link GhResult}. A numeric `code` is
 * the child's own exit. A child `execFile` killed (its timeout) is
 * `timeout`; a child killed by any other signal is `signal`; an error with no
 * exit and no signal (ENOENT, EACCES) is `spawn_failed`, with code 127 for a
 * missing `gh`. Those three are outcome-unknown, never an ordinary non-zero
 * exit (see {@link ghResultFromChildExit} for the `spawnSync` reading).
 */
export function ghResultFromExecFile(error: unknown, stdout: unknown, stderr: unknown): GhResult {
  const out = typeof stdout === 'string' ? stdout : '';
  const err = typeof stderr === 'string' ? stderr : '';
  if (error === null || error === undefined) return { code: 0, stdout: out, stderr: err };
  const failed = error as { code?: unknown; killed?: unknown; signal?: unknown };
  if (typeof failed.code === 'number') return { code: failed.code, stdout: out, stderr: err };
  if (failed.killed === true) return { code: 1, stdout: out, stderr: err, failure: 'timeout' };
  if (typeof failed.signal === 'string' && failed.signal !== '') return { code: 1, stdout: out, stderr: err, failure: 'signal' };
  return { code: failed.code === 'ENOENT' ? 127 : 1, stdout: out, stderr: err, failure: 'spawn_failed' };
}

/**
 * {@link ghClaimSpawner}'s argv and timeout, in a child the event loop does
 * not wait on. No shell, no stdin, the founder's own login. A timeout, a
 * signal or a `gh` that never started carries its `failure`
 * ({@link ghResultFromExecFile}), so the claim records it as outcome-unknown.
 */
export const ghClaimSpawnerAsync: AwaitableGhSpawner = {
  run(args): Promise<GhResult> {
    return new Promise((resolve) => {
      try {
        const child = execFile('gh', [...args], {
          encoding: 'utf8',
          timeout: GH_CLAIM_TIMEOUT_MS,
          windowsHide: true,
        }, (error, stdout, stderr) => {
          resolve(ghResultFromExecFile(error, stdout, stderr));
        });
        child.stdin?.end();
      } catch {
        resolve({ code: 127, stdout: '', stderr: '', failure: 'spawn_failed' });
      }
    });
  },
};

/** sha256 of the Start's idempotency key, as recorded on the claim. */
export function startKeyHash(startKey: string): string {
  return createHash('sha256').update(startKey, 'utf8').digest('hex');
}

export function isWonderlandMissionStartRoute(path: string): boolean {
  return START_PATH.test(wonderlandAdmissionPathname(path));
}

export function createWonderlandMissionStartBridge(
  ports: WonderlandAdmissionRoutePorts,
  deps: WonderlandMissionStartDeps = { claimTool: productionClaimTool(), claimToolV2: productionClaimTool(ghClaimSpawnerAsync) },
): WonderlandMissionStartBridge {
  return {
    matches: (path) => isWonderlandMissionStartRoute(path),
    handle: (request) => handleWonderlandMissionStartRoute(wonderlandAdmissionRequestFrom(request), ports, deps),
  };
}

/** One claim core per store path for the life of the process, so its claims run one after another. */
export function productionClaimTool(spawn: GhSpawner | AwaitableGhSpawner = ghClaimSpawner): (storePath: string) => OperatorClaimTool {
  const tools = new Map<string, OperatorClaimTool>();
  return (storePath) => {
    let tool = tools.get(storePath);
    if (tool === undefined) {
      tool = openOperatorClaimTool(storePath, spawn, undefined, createGhPriorAttemptReader());
      tools.set(storePath, tool);
    }
    return tool;
  };
}

const err = (status: number, kind: string, message: string) => ({ status, body: { error: { kind, message } } });

export async function handleWonderlandMissionStartRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandAdmissionRoutePorts,
  deps: WonderlandMissionStartDeps,
): Promise<{ status: number; body: unknown } | null> {
  const match = START_PATH.exec(wonderlandAdmissionPathname(request.path));
  if (match === null) return null;
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return guarded;
  if (request.method !== 'POST') return err(405, 'method_not_allowed', 'Start is a POST.');
  if (ports.env[WONDERLAND_START_FLAG] !== '1') {
    return err(503, 'julius_start_disabled', 'Starting a mission from Wonderland is switched off. Nothing was dispatched.');
  }
  const repo = (ports.env.JULIUS_WONDERLAND_GITHUB_REPO ?? '').trim();
  const lane = (ports.env.JULIUS_WONDERLAND_START_LANE ?? '').trim();
  if (!REPO.test(repo) || !(OPERATOR_LANES as readonly string[]).includes(lane)) {
    return err(503, 'julius_start_not_configured', 'The bridge has no repository or lane for a start. Nothing was dispatched.');
  }
  const startKey = request.idempotencyKey;
  if (startKey === undefined || !J1_IDEMPOTENCY_KEY.test(startKey) || !CANONICAL_UUID_V4.test(startKey)) {
    return err(400, 'julius_start_idempotency_key_invalid', 'x-relay-idempotency-key is required.');
  }
  let raw = match[1] ?? '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return err(404, 'not_found', 'Not found.');
  }
  const parsed = parseJuliusAdmissionRunId(raw);
  if (!parsed.ok || parsed.form !== 'wlj') return err(404, 'not_found', 'Not found.');
  let body: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(request.rawBody ?? '');
    body = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    body = null;
  }
  if (body === null) return err(400, 'julius_start_body_invalid', 'The body must be JSON.');
  if (body.wljRunId !== parsed.runId) return err(400, 'julius_start_run_mismatch', 'wljRunId must be the run in the path.');
  if (body.confirm !== OPERATOR_DISPATCH_CONFIRMATION) {
    return err(400, 'julius_start_confirmation_required', `The founder's Start must carry confirm: "${OPERATOR_DISPATCH_CONFIRMATION}". Nothing was dispatched.`);
  }
  // The founder's second phrase: absent, or exactly the phrase. It is read from this body only.
  let rerunConfirmation: string | null = null;
  if (Object.hasOwn(body, 'acknowledgeRerun')) {
    if (body.acknowledgeRerun !== RERUN_PAID_MISSION_CONFIRMATION) {
      return err(400, 'julius_rerun_ack_invalid', `acknowledgeRerun must be absent or exactly "${RERUN_PAID_MISSION_CONFIRMATION}". Nothing was claimed or dispatched.`);
    }
    rerunConfirmation = RERUN_PAID_MISSION_CONFIRMATION;
  }
  if (typeof body.clientTriggerId !== 'string' || !CLIENT_TRIGGER_ID.test(body.clientTriggerId)
    || typeof body.clientUiActionUtc !== 'string' || !Number.isFinite(Date.parse(body.clientUiActionUtc))) {
    return err(400, 'julius_start_client_binding_required', 'clientTriggerId and clientUiActionUtc are required.');
  }
  // The same existence and owner checks as /status: a run this player does not own is the uniform 404.
  const status = await readAdmittedWonderlandStatus(request, ports, parsed.runId, guarded.native.playerId);
  if (status.status !== 200) return status;
  const serverRunId = (status.body as { serverRunId?: unknown }).serverRunId;
  if (typeof serverRunId !== 'string') return err(404, 'not_found', 'Not found.');
  const storePath = (ports.env.JULIUS_WONDERLAND_ADMISSION_STORE ?? '').trim();
  if (ports.env[WONDERLAND_START_V2_FLAG] === '1') {
    return startV2(parsed.runId, serverRunId, repo, lane, storePath, rerunConfirmation, startKey, body.clientTriggerId, deps);
  }
  let result: ClaimResult;
  try {
    result = await deps.claimTool(storePath).claim({
      wonderlandRunId: parsed.runId,
      serverRunId,
      repo,
      lane,
      workflowSource: '',
      dispatch: true,
      confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      rerunConfirmation,
    });
  } catch {
    return err(503, 'julius_start_unavailable', 'The claim could not run. Check /status before trying again.');
  }
  return startHttp(parsed.runId, result);
}

/** The same claim, over the awaitable claim core, carrying the Start binding. */
async function startV2(
  wljRunId: string,
  serverRunId: string,
  repo: string,
  lane: string,
  storePath: string,
  rerunConfirmation: string | null,
  startKey: string,
  clientTriggerId: string,
  deps: WonderlandMissionStartDeps,
): Promise<{ status: number; body: unknown }> {
  const tool = (deps.claimToolV2 ?? deps.claimTool)(storePath);
  deps.startsInFlight?.enter(wljRunId);
  let result: ClaimResult;
  try {
    result = await tool.claim({
      wonderlandRunId: wljRunId,
      serverRunId,
      repo,
      lane,
      workflowSource: '',
      dispatch: true,
      confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      rerunConfirmation,
      start: { startKeyHash: startKeyHash(startKey), clientTriggerId },
    });
  } catch {
    return err(503, 'julius_start_unavailable', 'The claim could not run. Check /status before trying again.');
  } finally {
    deps.startsInFlight?.leave(wljRunId);
  }
  return startHttp(wljRunId, result);
}

function startBody(wljRunId: string, record: OperatorView, replayed: boolean): Record<string, unknown> {
  return {
    wljRunId,
    state: record.state,
    workflowRunId: record.workflowRunId,
    dispatchedAt: record.claimedAt,
    replayed,
  };
}

/** The claim core's answer, as the client may see it: no gh command, no store path, no credential. */
export function startHttp(wljRunId: string, result: ClaimResult): { status: number; body: unknown } {
  if (result.ok) {
    if (result.dispatchedWorkflow && !result.replayed) return { status: 202, body: startBody(wljRunId, result.record, false) };
    if (STARTED_STATES.has(result.record.state)) return { status: 200, body: startBody(wljRunId, result.record, true) };
    return { status: 409, body: { error: { kind: 'julius_start_not_dispatched', message: 'The admission was not dispatched.' }, ...startBody(wljRunId, result.record, result.replayed) } };
  }
  if (result.record !== null && STARTED_STATES.has(result.record.state)) {
    // `dispatch_outcome_unknown`: this Start's own `gh workflow run` gave no answer. Not a replay; the record says `dispatching`.
    return { status: 200, body: startBody(wljRunId, result.record, result.kind !== 'dispatch_outcome_unknown') };
  }
  // A paid run of the same mission still in flight is the one refusal the founder can retry, once it has finished.
  const body: Record<string, unknown> = { error: { kind: result.kind, message: result.message }, retry: result.kind === 'julius_paid_run_in_flight' };
  if (result.record !== null) Object.assign(body, startBody(wljRunId, result.record, false));
  if (result.priorAttempted !== undefined) body.priorAttempted = result.priorAttempted;
  if (result.priorCompleted !== undefined) body.priorCompleted = result.priorCompleted;
  if (result.inFlightWljRunId !== undefined) body.inFlightWljRunId = result.inFlightWljRunId;
  return { status: 409, body };
}

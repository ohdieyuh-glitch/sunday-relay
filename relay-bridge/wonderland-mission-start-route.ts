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
 */

import { spawnSync } from 'node:child_process';

import { CANONICAL_UUID_V4, CLIENT_TRIGGER_ID, J1_IDEMPOTENCY_KEY } from '../src/relay/integration/wonderland-admission';
import { parseJuliusAdmissionRunId } from '../src/relay/integration/wonderland-admission/admission-run-id';
import {
  OPERATOR_DISPATCH_CONFIRMATION,
  OPERATOR_LANES,
  openOperatorClaimTool,
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

const START_PATH = /^\/wonderland\/julius\/missions\/([^/]+)\/start$/u;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
export const WONDERLAND_START_FLAG = 'JULIUS_WONDERLAND_START';
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
      return {
        code: typeof result.status === 'number' ? result.status : 1,
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
      };
    } catch {
      return { code: 127, stdout: '', stderr: '' };
    }
  },
};

export function isWonderlandMissionStartRoute(path: string): boolean {
  return START_PATH.test(wonderlandAdmissionPathname(path));
}

export function createWonderlandMissionStartBridge(
  ports: WonderlandAdmissionRoutePorts,
  deps: WonderlandMissionStartDeps = { claimTool: productionClaimTool() },
): WonderlandMissionStartBridge {
  return {
    matches: (path) => isWonderlandMissionStartRoute(path),
    handle: (request) => handleWonderlandMissionStartRoute(wonderlandAdmissionRequestFrom(request), ports, deps),
  };
}

/** One claim core per store path for the life of the process, so its claims run one after another. */
function productionClaimTool(): (storePath: string) => OperatorClaimTool {
  const tools = new Map<string, OperatorClaimTool>();
  return (storePath) => {
    let tool = tools.get(storePath);
    if (tool === undefined) {
      tool = openOperatorClaimTool(storePath, ghClaimSpawner);
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
    });
  } catch {
    return err(503, 'julius_start_unavailable', 'The claim could not run. Check /status before trying again.');
  }
  return startHttp(parsed.runId, result);
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
    return { status: 200, body: startBody(wljRunId, result.record, true) };
  }
  const body: Record<string, unknown> = { error: { kind: result.kind, message: result.message }, retry: false };
  if (result.record !== null) Object.assign(body, startBody(wljRunId, result.record, false));
  return { status: 409, body };
}

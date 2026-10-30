/**
 * GET /relay-api/wonderland/julius/missions/{wljRunId}/status?projectId=
 *
 * ONE READ FOR THE JULIUS MISSION TERMINAL. Served only with
 * JULIUS_WONDERLAND_START_V2=1; unset, the bridge does not route this path
 * here and this handler answers 404. Loopback only, behind the same guard and
 * owner check as /status, /events and /result. Schema
 * `wonderland-mission-status.v1`.
 *
 * It only reads. It composes what the bridge already serves: the admission
 * journal's /status projection, the /events view of the bound run, /result's
 * checker verdict, and the dispatching recovery's last view. It never
 * dispatches, it writes neither the admission store nor its journal (the
 * recovery it starts only reads GitHub and reports), and there is no input
 * that fakes or simulates a state.
 *
 * - `admission.state` is the /status word, unchanged (lowercase).
 * - `phase` is derived here, in this order: a verified completion
 *   (`/result` state `completed`) is `completed`; with a bound run, the run's
 *   own execution (`queued`, `starting`, `executing`, `grading` once the LIVE
 *   step succeeded and no verdict is in, `interrupted`, `did_not_start`);
 *   else the journal (`admitted`, `starting` while this process runs a Start
 *   that has not reserved yet, `dispatching`, `dispatched` with no run read,
 *   `failed`, `expired`, `interrupted`, `unknown`).
 * - `stage` and `workflowProgress` come only from the run's reported events
 *   (wonderland-mission-progress.ts). Without them they are null and
 *   `basis` is `none`; nothing is estimated. `progress` is MISSION progress:
 *   100 (`verified_completion`) only for a completed run whose checker
 *   verdict is PASS, else null (`none`). Workflow steps never feed it.
 * - `start.workflowRunIdSource` is `gh_output` (the claim's own spawn),
 *   `reconcile` (written by reconcile from GitHub), `dispatch_key` (found by
 *   the recovery, not written), or null.
 */

import { isLocalStorePath, readAdmissionDocument, type ClaimEvent } from '../src/relay/integration/wonderland-admission/admission-file';
import { parseJuliusAdmissionRunId } from '../src/relay/integration/wonderland-admission/admission-run-id';
import type { AwaitableGhSpawner, OperatorClaimTool } from '../src/relay/integration/wonderland-admission/operator-claim';
import type { JuliusRunJobsReader } from './julius-mission-github-gh';
import {
  createWonderlandDispatchingRecovery,
  isRepoName,
  NO_RECOVERY,
  type WonderlandDispatchingRecovery,
  type WonderlandRecoveryView,
} from './wonderland-dispatching-recovery';
import {
  createWonderlandMissionEventsBridge,
  type WonderlandMissionEvent,
  type WonderlandMissionEventsBridge,
} from './wonderland-mission-events-route';
import { createWonderlandMissionReadBridge } from './wonderland-mission-result-route';
import { missionProgress, missionStage, NO_WORKFLOW_PROGRESS, workflowProgress } from './wonderland-mission-progress';
import {
  guardPassed,
  juliusLoopbackGuard,
  readAdmittedWonderlandStatus,
  wonderlandAdmissionPathname,
  wonderlandAdmissionRequestFrom,
  type WonderlandAdmissionRoutePorts,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import {
  createWonderlandMissionStartBridge,
  createWonderlandStartsInFlight,
  ghClaimSpawnerAsync,
  productionClaimTool,
  WONDERLAND_START_V2_FLAG,
  type WonderlandMissionStartBridge,
  type WonderlandStartsInFlight,
} from './wonderland-mission-start-route';

export const MISSION_STATUS_SCHEMA = 'wonderland-mission-status.v1';
const STATUS_PATH = /^\/wonderland\/julius\/missions\/([^/]+)\/status$/u;
/** Polling hints. Null on a terminal phase: there is nothing more to read. */
export const STATUS_POLL_ACTIVE_MS = 2_000;
export const STATUS_POLL_IDLE_MS = 10_000;
const EVENT_PAGES_MAX = 10;

export type WonderlandMissionPhase =
  | 'admitted' | 'starting' | 'dispatching' | 'dispatched' | 'queued' | 'executing' | 'grading'
  | 'completed' | 'failed' | 'did_not_start' | 'interrupted' | 'expired' | 'unknown';

const TERMINAL_PHASES: ReadonlySet<WonderlandMissionPhase> = new Set(['completed', 'failed', 'did_not_start', 'interrupted', 'expired']);

type RouteRequest = Parameters<typeof wonderlandAdmissionRequestFrom>[0];
type RouteHandler = (request: RouteRequest) => Promise<{ status: number; body: unknown } | null>;

export interface WonderlandMissionStatusDeps {
  /** The /events bridge's handler: the same instance, so the same cache and GitHub budget. */
  readonly events: RouteHandler;
  /** The /result bridge's handler. */
  readonly result: RouteHandler;
  readonly recovery?: WonderlandDispatchingRecovery;
  readonly startsInFlight?: WonderlandStartsInFlight;
}

export interface WonderlandMissionStatusBridge {
  matches(path: string): boolean;
  handle(request: RouteRequest): Promise<{ status: number; body: unknown } | null>;
}

export function isWonderlandMissionStatusRoute(path: string): boolean {
  return STATUS_PATH.test(wonderlandAdmissionPathname(path));
}

export function createWonderlandMissionStatusBridge(
  ports: WonderlandAdmissionRoutePorts,
  deps: WonderlandMissionStatusDeps,
): WonderlandMissionStatusBridge {
  return {
    matches: (path) => isWonderlandMissionStatusRoute(path),
    handle: (request) => handleWonderlandMissionStatusRoute(wonderlandAdmissionRequestFrom(request), request, ports, deps),
  };
}

const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

export async function handleWonderlandMissionStatusRoute(
  request: WonderlandAdmissionRouteRequest,
  raw: RouteRequest,
  ports: WonderlandAdmissionRoutePorts,
  deps: WonderlandMissionStatusDeps,
): Promise<{ status: number; body: unknown } | null> {
  const match = STATUS_PATH.exec(wonderlandAdmissionPathname(request.path));
  if (match === null) return null;
  if (ports.env[WONDERLAND_START_V2_FLAG] !== '1') return NOT_FOUND;
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return guarded;
  if (request.method !== 'GET') return { status: 405, body: { error: { kind: 'method_not_allowed', message: 'Status is a GET.' } } };
  let id = match[1] ?? '';
  try {
    id = decodeURIComponent(id);
  } catch {
    return NOT_FOUND;
  }
  const parsed = parseJuliusAdmissionRunId(id);
  if (!parsed.ok || parsed.form !== 'wlj') return NOT_FOUND;
  const wlj = parsed.runId;
  const admitted = await readAdmittedWonderlandStatus(request, ports, wlj, guarded.native.playerId);
  if (admitted.status !== 200) return admitted;
  const admission = asRecord(admitted.body) ?? {};
  const storePath = (ports.env.JULIUS_WONDERLAND_ADMISSION_STORE ?? '').trim();
  const repo = (ports.env.JULIUS_WONDERLAND_GITHUB_REPO ?? '').trim();
  const claim = latestClaim(storePath, wlj, text(admission.serverRunId));

  // Recovery runs in the background; this read takes its last view and never waits on GitHub for it.
  // An invalid or unset repo is passed as null: the recovery then makes no GitHub read at all, still reports an
  // outcome-unknown or stuck `dispatching` claim from the journal, and says `repo_unconfigured` where it would read GitHub.
  if (deps.recovery !== undefined && claim !== null) {
    deps.recovery.poke({ wljRunId: wlj, storePath, repo: isRepoName(repo) ? repo : null, nowMs: request.nowMs });
  }
  const recovery: WonderlandRecoveryView = deps.recovery?.view(wlj) ?? NO_RECOVERY;

  const sibling = (leaf: 'events' | 'result', query: Record<string, string> = {}): RouteRequest => {
    const url = new URL(raw.url ?? request.url ?? '/', 'http://relay.invalid');
    const path = `/wonderland/julius/missions/${encodeURIComponent(wlj)}/${leaf}`;
    const params = new URLSearchParams();
    const projectId = url.searchParams.get('projectId');
    if (projectId !== null) params.set('projectId', projectId);
    for (const [key, value] of Object.entries(query)) params.set(key, value);
    const search = params.toString();
    return { ...raw, method: 'GET', path, url: search === '' ? path : `${path}?${search}`, body: undefined };
  };

  const events = await readAllEvents(deps.events, sibling);
  const resultRead = await deps.result(sibling('result'));
  const result = resultRead !== null && resultRead.status === 200 ? asRecord(resultRead.body) : null;

  const admissionState = text(admission.state) ?? 'unknown';
  const admissionCause = text(admission.cause);
  const bound = events !== null && events.source !== 'none';
  const completed = result !== null && result.state === 'completed';
  const runStatus = bound ? text(events.runStatus) : null;
  const execution = bound ? text(events.execution) : null;
  const inFlight = deps.startsInFlight?.has(wlj) === true;
  // G8: `gh workflow run` exited non-zero, so the run may exist, until the recovery has read GitHub and says otherwise.
  const ghFailed = claim !== null && claim.state === 'dispatch_failed' && claim.dispatchError === 'gh_workflow_run_failed';
  // The child timed out, was killed or never started: unknown until the founder's reconcile moves the record.
  const dispatchUnknown = claim !== null && claim.state === 'dispatching' && claim.dispatchAttempted;
  const outcomeUnknown = dispatchUnknown || (ghFailed && (recovery.checkedAtMs === null || recovery.outcomeUnknown));
  const phase = phaseOf({ admissionState, admissionCause, completed, bound, runStatus, execution, inFlight, outcomeUnknown });
  const terminal = TERMINAL_PHASES.has(phase);

  const journalRunId = claim?.workflowRunId ?? null;
  const workflowRunId = journalRunId ?? recovery.workflowRunId;
  const workflowRunIdSource = journalRunId !== null
    ? (claim !== null && writtenByReconcile(claim) ? 'reconcile' : 'gh_output')
    : recovery.workflowRunId !== null ? 'dispatch_key' : null;
  const list = bound ? events.events : [];

  return {
    status: 200,
    body: {
      schema: MISSION_STATUS_SCHEMA,
      wljRunId: wlj,
      serverRunId: text(admission.serverRunId),
      phase,
      terminal,
      admission: { state: admissionState, cause: admissionCause, updatedAt: text(admission.updatedAt) },
      start: {
        requested: claim !== null || inFlight,
        startKeyHash: claim?.startKeyHash ?? null,
        clientTriggerId: claim?.clientTriggerId ?? null,
        dispatchedAt: text(admission.dispatchedAt),
        workflowRunId,
        workflowRunIdSource,
        // A Start sent now replays the recorded claim (or joins the one running): no second dispatch.
        retryStartSafe: claim !== null || inFlight,
        recovery: recovery.recovery,
        ...(recovery.reason === null ? {} : { recoveryReason: recovery.reason }),
        ...(recovery.spentTag === null ? {} : { spentTag: recovery.spentTag }),
      },
      run: bound
        ? {
          status: runStatus,
          conclusion: text(events.runConclusion),
          live: events.live === true,
          execution,
          executionStartedAt: text(events.executionStartedAt),
          stoppedAt: events.stoppedAt ?? null,
          stale: events.stale === true,
          fetchedAt: text(events.fetchedAt),
        }
        : null,
      ...(events !== null && events.source === 'none' && typeof events.reason === 'string' ? { runReason: events.reason } : {}),
      stage: bound ? missionStage(list) : null,
      // Mission progress: a PASS-checked completion or null. Never from workflow steps (they are `workflowProgress`, labelled).
      progress: missionProgress(result),
      workflowProgress: bound ? workflowProgress(list) : NO_WORKFLOW_PROGRESS,
      result: {
        checkerVerdict: result === null ? null : text(result.checkerVerdict),
        outcomeUnknown: outcomeUnknown || (result !== null && result.outcomeUnknown !== null && result.outcomeUnknown !== undefined),
      },
      eventsCursor: bound ? text(events.next) : null,
      nextPollMs: terminal ? null : bound || phase === 'starting' || phase === 'dispatching' || phase === 'dispatched' ? STATUS_POLL_ACTIVE_MS : STATUS_POLL_IDLE_MS,
      serverTime: new Date(request.nowMs).toISOString(),
    },
  };
}

interface EventsRead {
  readonly source: string;
  readonly reason?: unknown;
  readonly runStatus?: unknown;
  readonly runConclusion?: unknown;
  readonly live?: unknown;
  readonly execution?: unknown;
  readonly executionStartedAt?: unknown;
  readonly stoppedAt?: unknown;
  readonly stale?: unknown;
  readonly fetchedAt?: unknown;
  readonly next?: unknown;
  readonly events: readonly WonderlandMissionEvent[];
}

/** Every cached event of the bound run, paged with /events' own cursor. Null when /events did not answer 200. */
async function readAllEvents(
  handler: RouteHandler,
  sibling: (leaf: 'events', query?: Record<string, string>) => RouteRequest,
): Promise<EventsRead | null> {
  const first = await handler(sibling('events'));
  const body = first !== null && first.status === 200 ? asRecord(first.body) : null;
  if (body === null || typeof body.source !== 'string' || !Array.isArray(body.events)) return null;
  const all: WonderlandMissionEvent[] = [...(body.events as WonderlandMissionEvent[])];
  let last = body;
  for (let page = 1; page < EVENT_PAGES_MAX && typeof last.next === 'string' && Array.isArray(last.events) && last.events.length > 0; page += 1) {
    const more = await handler(sibling('events', { after: last.next }));
    const next = more !== null && more.status === 200 ? asRecord(more.body) : null;
    if (next === null || !Array.isArray(next.events) || next.events.length === 0 || next.reset === true) break;
    all.push(...(next.events as WonderlandMissionEvent[]));
    last = next;
  }
  return { ...(body as unknown as EventsRead), next: last.next, events: all };
}

function phaseOf(input: {
  readonly admissionState: string;
  readonly admissionCause: string | null;
  readonly completed: boolean;
  readonly bound: boolean;
  readonly runStatus: string | null;
  readonly execution: string | null;
  readonly inFlight: boolean;
  readonly outcomeUnknown: boolean;
}): WonderlandMissionPhase {
  if (input.completed) return 'completed';
  if (input.bound) {
    switch (input.execution) {
      case 'executing': return 'executing';
      case 'finished': return 'grading';
      case 'interrupted': return 'interrupted';
      case 'did_not_start': return 'did_not_start';
      case 'starting':
        return input.runStatus === 'in_progress' ? 'starting' : 'queued';
      default: return 'unknown';
    }
  }
  switch (input.admissionState) {
    case 'held':
    case 'reserved':
    case 'awaiting_operator':
      return input.inFlight ? 'starting' : 'admitted';
    case 'dispatching': return 'dispatching';
    case 'dispatched': return 'dispatched';
    case 'failed': return input.admissionCause === 'AWAITING_OPERATOR_EXPIRED' ? 'expired' : 'failed';
    case 'interrupted': return 'interrupted';
    case 'dispatch_failed':
      // OUTCOME-UNKNOWN: the run may exist. Not terminal until GitHub has been read.
      return input.outcomeUnknown ? 'unknown' : 'failed';
    case 'ledger_unwritten':
    case 'already_spent':
      return 'failed';
    default: return 'unknown';
  }
}

/**
 * Whether reconcile, not the claim's own `gh workflow run` output, wrote this
 * event's run id: a `dispatched` it bound through the spent tag, or a
 * `dispatch_failed` (`workflow_run_unspent`) naming the run that ended
 * before it spent the id.
 */
function writtenByReconcile(claim: ClaimEvent): boolean {
  return (claim.state === 'dispatched' && claim.spentTagState === 'present')
    || (claim.state === 'dispatch_failed' && claim.dispatchError === 'workflow_run_unspent');
}

/** The latest claim event for this admission, or null. Unreadable is null: /status already answered for the row. */
function latestClaim(storePath: string, wlj: string, serverRunId: string | null): ClaimEvent | null {
  if (serverRunId === null || !isLocalStorePath(storePath)) return null;
  try {
    const document = readAdmissionDocument(storePath);
    return document.claims.filter((event) => event.wonderlandRunId === wlj && event.serverRunId === serverRunId).at(-1) ?? null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The JULIUS_WONDERLAND_START_V2 composition, for server.ts: ONE claim core
 * per store over the awaitable `gh` (Start claims on it; the recovery only
 * reads, through its own read-only `gh`), the /events bridge bound to the
 * recovery's dispatch-key runs, and this route over both.
 */
export function createWonderlandStartV2Wiring(
  ports: WonderlandAdmissionRoutePorts,
  live: { readonly runReader: JuliusRunJobsReader | undefined; readonly evidenceReader: Parameters<typeof createWonderlandMissionReadBridge>[1] },
  /** Tests only: a fake `gh`, and a claim core over it. Production passes neither. */
  overrides: { readonly spawn?: AwaitableGhSpawner; readonly claimTool?: (storePath: string) => OperatorClaimTool } = {},
): {
  readonly startBridge: WonderlandMissionStartBridge;
  readonly eventsBridge: WonderlandMissionEventsBridge;
  readonly statusBridge: WonderlandMissionStatusBridge;
  readonly recovery: WonderlandDispatchingRecovery;
} {
  const spawn = overrides.spawn ?? ghClaimSpawnerAsync;
  const claimToolV2 = overrides.claimTool ?? productionClaimTool(spawn);
  const startsInFlight = createWonderlandStartsInFlight();
  const recovery = createWonderlandDispatchingRecovery({ spawn });
  const startBridge = createWonderlandMissionStartBridge(ports, { claimTool: claimToolV2, claimToolV2, startsInFlight });
  const eventsBridge = createWonderlandMissionEventsBridge(ports, live.runReader, { recoveredRunId: (wlj) => recovery.boundRunId(wlj) });
  const readBridge = createWonderlandMissionReadBridge(ports, live.evidenceReader);
  const statusBridge = createWonderlandMissionStatusBridge(ports, {
    events: (request) => eventsBridge.handle(request),
    result: (request) => readBridge.handle(request),
    recovery,
    startsInFlight,
  });
  return { startBridge, eventsBridge, statusBridge, recovery };
}

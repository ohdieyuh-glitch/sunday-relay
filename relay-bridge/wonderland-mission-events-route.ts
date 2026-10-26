/**
 * GET /relay-api/wonderland/julius/missions/{wljRunId}/events?projectId=&after=
 *
 * THE LIVE VIEW OF A PAID RUN, AND NOTHING THAT CAN START ONE. Loopback only,
 * behind the same guard as the Wonderland status route (paired session, the
 * J1 project, the founder player). It only reads: the admission journal on
 * this machine, and GitHub through the founder's own `gh` (GET only). There
 * is no dispatch path here, so a refresh or reconnect can only read again.
 *
 * BOUND TO ONE RUN. The run read is the one the operator claim recorded for
 * this `wlj_` id, and only once the claim is `dispatched`. It must be a
 * `workflow_dispatch` of the paid workflow on `main`, at attempt 1, whose run
 * name ends ` mode=paid key=<this admission's dispatch key>` (reconcile's
 * rules). Anything else is `source: "none"` with a reason, and no events.
 *
 * WHAT GOES OUT is names and states only:
 * - `job` and `step` events from the run's jobs (workflow-defined names,
 *   status, conclusion, times);
 * - `phase` events from the run's `julius-live-progress` commit statuses,
 *   accepted only from github-actions[bot], in the exact v1 grammar, bound to
 *   this run, attempt 1 and this wlj. They are SAMPLES of the active task
 *   (`sampled: true`), never a complete log.
 * No log, no step output, no task text, no provider body, no secret.
 *
 * `live` is the server's fact: bound, and the run queued or in progress. It is
 * NOT "Julius is executing": the gates run inside a live run. `execution` is:
 * - `starting`: the run is live and its LIVE step has not started (the gates,
 *   the preflight, the attempted marker);
 * - `executing`: the LIVE step ("LIVE: run the first real Julius mission" in
 *   the job "Preflight, then the live mission") has been seen in progress, or a
 *   phase sample with a task (marker null) has arrived, and the run is live;
 * - `finished`: the LIVE step succeeded. This is not an outcome: /result's
 *   checkerVerdict is;
 * - `interrupted`: Julius started and then its LIVE step failed, was cancelled
 *   or timed out, or the run ended without the LIVE step succeeding. This is a
 *   confirmed failure or cancellation, reported as soon as GitHub does;
 *   `stoppedAt` names the step (the LIVE step itself when that is what stopped);
 * - `did_not_start`: the run finished and the LIVE step never ran. `stoppedAt`
 *   names the first job or step that failed, was cancelled, or timed out (null
 *   when none did), so a gate refusal is never shown as a Julius failure.
 * `executionStartedAt` is when the LIVE step (or else the first task sample)
 * was first seen started; null when unknown. Read from the cached events of the
 * whole run, not from the page.
 * `stale` is true when the last good GitHub read is older than 30 s; the last
 * state is kept and nothing is inferred. A finished run is never `live`, and
 * nothing here reports completion or a verdict: /result does, from the
 * evidence reader and the hidden checker's grade.
 *
 * REHEARSAL. `JULIUS_WONDERLAND_EVENTS_REHEARSAL_RUN_ID` binds a PREFLIGHT run
 * (` mode=preflight`), and only while this admission has no dispatched claim.
 * A finished rehearsal run is `github_actions_recorded` and never live; a
 * running one is live with `mode: "preflight"`. A paid run is never bound
 * this way.
 */

import { randomUUID } from 'node:crypto';

import { parseJuliusAdmissionRunId } from '../src/relay/integration/wonderland-admission/admission-run-id';
import { isLocalStorePath, readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import type { JuliusCommitStatus, JuliusRunJob, JuliusRunJobsReader, JuliusRunSummary } from './julius-mission-github-gh';
import {
  guardPassed,
  juliusLoopbackGuard,
  readAdmittedWonderlandStatus,
  wonderlandAdmissionPathname,
  wonderlandAdmissionRequestFrom,
  type WonderlandAdmissionRoutePorts,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';

const EVENTS_PATH = /^\/wonderland\/julius\/missions\/([^/]+)\/events$/u;
const PAID_WORKFLOW_PATH = '.github/workflows/julius-first-live-mission.yml';
export const LIVE_PROGRESS_CONTEXT = 'julius-live-progress';
const LIVE_PROGRESS_CREATOR = 'github-actions[bot]';
/** REVIEW's v1 grammar, exactly. */
export const LIVE_PROGRESS_GRAMMAR = /^v1 r(\d{1,20})\.a1\.([0-9a-f]{8}) s(\d{1,6}) (idle|ended|(architect|coder|reviewer|other):(plan|build|review|research|repair_plan|repair_build|repair_guidance|repair_rebuttal|repair_audit|other):(blocked|runnable|active|succeeded|failed|cancelled|skipped|other) o(\d{1,4}) c([0-3x]))$/u;
const LIVE_PROGRESS_MAX = 140;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;

/** One GitHub refresh per run per this many ms; reads in between are served from the cache. */
export const EVENTS_REFRESH_MS = 5_000;
/** The last good read older than this is `stale`. */
export const EVENTS_STALE_MS = 30_000;
const EVENTS_PER_RESPONSE = 500;
const EVENTS_PER_RUN = 5_000;

/** The job and the step that ARE the Julius run, as the client receives their names. */
export const LIVE_MISSION_JOB = 'Preflight, then the live mission';
export const LIVE_MISSION_STEP = 'LIVE: run the first real Julius mission';

export type WonderlandExecution = 'starting' | 'executing' | 'finished' | 'interrupted' | 'did_not_start';

export type WonderlandEventsReason = 'not_dispatched' | 'run_unbound' | 'run_mismatch' | 'github_unreadable' | 'live_view_unconfigured';

export interface WonderlandMissionEvent {
  readonly seq: number;
  readonly at: string | null;
  readonly kind: 'job' | 'step' | 'phase';
  readonly job?: string;
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly sampled?: true;
  readonly marker?: 'idle' | 'ended' | null;
  readonly role?: string | null;
  readonly taskType?: string | null;
  readonly state?: string | null;
  readonly ordinal?: number | null;
  readonly repairCycle?: number | null;
}

interface RunCache {
  readonly runId: string;
  readonly events: WonderlandMissionEvent[];
  readonly seen: Set<string>;
  summary: JuliusRunSummary | null;
  lastFetchMs: number;
  lastOkMs: number | null;
  inflight: Promise<void> | null;
}

export interface WonderlandMissionEventsBridge {
  matches(path: string): boolean;
  handle(request: Parameters<typeof wonderlandAdmissionRequestFrom>[0]): Promise<{ status: number; body: unknown } | null>;
}

export function isWonderlandMissionEventsRoute(path: string): boolean {
  return EVENTS_PATH.test(wonderlandAdmissionPathname(path));
}

export function createWonderlandMissionEventsBridge(
  ports: WonderlandAdmissionRoutePorts,
  reader: JuliusRunJobsReader | undefined,
): WonderlandMissionEventsBridge {
  const epoch = randomUUID().slice(0, 8);
  const caches = new Map<string, RunCache>();
  return {
    matches: (path) => isWonderlandMissionEventsRoute(path),
    handle: (request) => handleWonderlandMissionEventsRoute(wonderlandAdmissionRequestFrom(request), ports, reader, { epoch, caches }),
  };
}

export async function handleWonderlandMissionEventsRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandAdmissionRoutePorts,
  reader: JuliusRunJobsReader | undefined,
  state: { readonly epoch: string; readonly caches: Map<string, RunCache> },
): Promise<{ status: number; body: unknown } | null> {
  const match = EVENTS_PATH.exec(wonderlandAdmissionPathname(request.path));
  if (match === null) return null;
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return guarded;
  if (request.method !== 'GET') return { status: 405, body: { error: { kind: 'method_not_allowed', message: 'Events is a GET.' } } };
  let raw = match[1] ?? '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return notFound();
  }
  const parsed = parseJuliusAdmissionRunId(raw);
  if (!parsed.ok || parsed.form !== 'wlj') return notFound();
  // The same owner and existence checks as /status: a run this player may not see is the status route's 404.
  const status = await readAdmittedWonderlandStatus(request, ports, parsed.runId, guarded.native.playerId);
  if (status.status !== 200) return status;
  const wlj = parsed.runId;
  const empty = (reason: WonderlandEventsReason) => ({ status: 200, body: noneBody(wlj, reason, request.nowMs) });
  if (reader === undefined) return empty('live_view_unconfigured');

  const binding = bindingFor(ports, wlj);
  if (binding.kind === 'none') return empty(binding.reason);
  const cache = cacheFor(state.caches, binding.runId);
  await refresh(cache, reader, binding, request.nowMs);
  const summary = cache.summary;
  if (cache.lastOkMs === null || summary === null) return empty('github_unreadable');
  const bound = binding.kind === 'claim' ? runMatchesClaim(summary, binding) : runMatchesRehearsal(summary);
  if (!bound) return empty('run_mismatch');

  const mode = modeOf(summary.displayTitle);
  const running = summary.status === 'queued' || summary.status === 'in_progress' || summary.status === 'waiting' || summary.status === 'pending';
  const recorded = binding.kind === 'rehearsal' && !running;
  const after = cursorAfter(request.url, state.epoch);
  const from = after.reset ? 0 : after.seq;
  const page = cache.events.filter((event) => event.seq > from).slice(0, EVENTS_PER_RESPONSE);
  const last = page.at(-1)?.seq ?? from;
  return {
    status: 200,
    body: {
      wljRunId: wlj,
      workflowRunId: summary.id,
      source: recorded ? 'github_actions_recorded' : 'github_actions',
      mode,
      runStatus: summary.status,
      runConclusion: summary.conclusion,
      live: !recorded && running,
      ...executionOf(cache.events, running),
      stale: request.nowMs - cache.lastOkMs > EVENTS_STALE_MS,
      fetchedAt: new Date(cache.lastOkMs).toISOString(),
      events: page,
      next: `${state.epoch}.${last}`,
      ...(after.reset ? { reset: true } : {}),
    },
  };
}

type Binding =
  | { readonly kind: 'none'; readonly reason: WonderlandEventsReason }
  | { readonly kind: 'claim'; readonly runId: string; readonly keyHash: string; readonly wlj8: string; readonly githubDateMs: number | null }
  | { readonly kind: 'rehearsal'; readonly runId: string; readonly wlj8: null; readonly githubDateMs: null };

function bindingFor(ports: WonderlandAdmissionRoutePorts, wlj: string): Binding {
  const storePath = (ports.env.JULIUS_WONDERLAND_ADMISSION_STORE ?? '').trim();
  if (storePath === '' || !isLocalStorePath(storePath)) return { kind: 'none', reason: 'github_unreadable' };
  let document;
  try {
    document = readAdmissionDocument(storePath);
  } catch {
    return { kind: 'none', reason: 'github_unreadable' };
  }
  const admission = document.admissions.find((row) => row.runId === wlj) ?? null;
  if (admission === null) return { kind: 'none', reason: 'not_dispatched' };
  const claims = document.claims.filter((event) => event.wonderlandRunId === wlj && event.serverRunId === admission.serverRunId);
  const latest = claims.at(-1) ?? null;
  if (latest !== null && latest.state === 'dispatched') {
    if (latest.workflowRunId === null || !RUN_ID.test(latest.workflowRunId)) return { kind: 'none', reason: 'run_unbound' };
    const githubDate = claims.find((event) => event.githubDate !== null)?.githubDate ?? null;
    return {
      kind: 'claim',
      runId: latest.workflowRunId,
      keyHash: admission.keyHash,
      wlj8: wlj.slice('wlj_'.length, 'wlj_'.length + 8),
      githubDateMs: githubDate === null ? null : Date.parse(githubDate),
    };
  }
  if (latest !== null) return { kind: 'none', reason: latest.state === 'dispatching' ? 'run_unbound' : 'not_dispatched' };
  const rehearsal = (ports.env.JULIUS_WONDERLAND_EVENTS_REHEARSAL_RUN_ID ?? '').trim();
  if (RUN_ID.test(rehearsal)) return { kind: 'rehearsal', runId: rehearsal, wlj8: null, githubDateMs: null };
  return { kind: 'none', reason: 'not_dispatched' };
}

function runMatchesClaim(run: JuliusRunSummary, binding: Extract<Binding, { kind: 'claim' }>): boolean {
  return run.id === binding.runId
    && run.path === PAID_WORKFLOW_PATH
    && run.event === 'workflow_dispatch'
    && run.headBranch === 'main'
    && run.attempt === 1
    && run.displayTitle.endsWith(` mode=paid key=${binding.keyHash}`);
}

function runMatchesRehearsal(run: JuliusRunSummary): boolean {
  return run.path === PAID_WORKFLOW_PATH
    && run.event === 'workflow_dispatch'
    && run.headBranch === 'main'
    && run.attempt === 1
    && / mode=preflight key=[A-Za-z0-9]+$/u.test(run.displayTitle);
}

function modeOf(title: string): 'paid' | 'preflight' | null {
  if (/ mode=paid key=[A-Za-z0-9]+$/u.test(title)) return 'paid';
  if (/ mode=preflight key=[A-Za-z0-9]+$/u.test(title)) return 'preflight';
  return null;
}

function cacheFor(caches: Map<string, RunCache>, runId: string): RunCache {
  let cache = caches.get(runId);
  if (cache === undefined) {
    cache = { runId, events: [], seen: new Set(), summary: null, lastFetchMs: Number.NEGATIVE_INFINITY, lastOkMs: null, inflight: null };
    caches.set(runId, cache);
  }
  return cache;
}

/** At most one GitHub read per run per EVENTS_REFRESH_MS, and one at a time. A failed read keeps the last state. */
async function refresh(cache: RunCache, reader: JuliusRunJobsReader, binding: Exclude<Binding, { kind: 'none' }>, nowMs: number): Promise<void> {
  if (cache.inflight !== null) return cache.inflight;
  if (nowMs - cache.lastFetchMs < EVENTS_REFRESH_MS) return;
  cache.lastFetchMs = nowMs;
  cache.inflight = (async () => {
    try {
      const summary = await reader.readRun(cache.runId);
      if (summary === null) return;
      const jobs = await reader.readRunJobs(cache.runId, 1);
      if (jobs === null) return;
      const statuses = binding.kind === 'claim' ? await reader.readCommitStatuses(summary.headSha) : [];
      cache.summary = summary;
      appendJobEvents(cache, jobs);
      if (binding.kind === 'claim' && statuses !== null) appendPhaseEvents(cache, statuses, binding);
      cache.lastOkMs = nowMs;
    } catch {
      // Unreadable: the cache keeps its last good state, and `stale` says so.
    } finally {
      cache.inflight = null;
    }
  })();
  return cache.inflight;
}

/** The client reads printable ASCII only. A workflow name is folded to it: typographic punctuation to its ASCII form, anything else to `?`, at most 120 characters. */
const ASCII_FOLD: Readonly<Record<string, string>> = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...' };
export const EVENT_NAME_MAX = 120;

export function printableName(name: string): string {
  const folded = [...name].map((ch) => ASCII_FOLD[ch] ?? (/^[\x20-\x7e]$/u.test(ch) ? ch : '?')).join('');
  return folded.length > EVENT_NAME_MAX ? `${folded.slice(0, EVENT_NAME_MAX - 3)}...` : folded;
}

function push(cache: RunCache, key: string, event: Omit<WonderlandMissionEvent, 'seq'>): void {
  if (cache.seen.has(key) || cache.events.length >= EVENTS_PER_RUN) return;
  cache.seen.add(key);
  cache.events.push({ seq: cache.events.length + 1, ...event });
}

function appendJobEvents(cache: RunCache, jobs: readonly JuliusRunJob[]): void {
  for (const job of jobs) {
    push(cache, `job:${job.id}:${job.status}`, {
      kind: 'job',
      job: printableName(job.name),
      name: printableName(job.name),
      status: job.status,
      conclusion: job.status === 'completed' ? job.conclusion : null,
      at: job.status === 'completed' ? job.completedAt : job.startedAt,
    });
    for (const step of job.steps) {
      push(cache, `step:${job.id}:${step.number}:${step.status}`, {
        kind: 'step',
        job: printableName(job.name),
        name: printableName(step.name),
        status: step.status,
        conclusion: step.status === 'completed' ? step.conclusion : null,
        at: step.status === 'completed' ? step.completedAt : step.startedAt,
      });
    }
  }
}

/**
 * A `julius-live-progress` status becomes a phase event only when every rule holds:
 * the exact context, github-actions[bot], ≤140 characters in the v1 grammar, this
 * run, attempt 1, this wlj, and created no earlier than the dispatch's GitHub clock
 * less 2 s. The `ended` marker is not a completion and carries no outcome.
 */
function appendPhaseEvents(cache: RunCache, statuses: readonly JuliusCommitStatus[], binding: Extract<Binding, { kind: 'claim' }>): void {
  const accepted = statuses
    .map((status) => ({ status, parsed: parseLiveProgress(status, binding) }))
    .filter((entry): entry is { status: JuliusCommitStatus; parsed: ParsedProgress } => entry.parsed !== null)
    .sort((a, b) => a.parsed.seq - b.parsed.seq);
  for (const { status, parsed } of accepted) {
    push(cache, `phase:${parsed.seq}`, {
      kind: 'phase',
      sampled: true,
      at: status.createdAt,
      marker: parsed.marker,
      role: parsed.role,
      taskType: parsed.taskType,
      state: parsed.state,
      ordinal: parsed.ordinal,
      repairCycle: parsed.repairCycle,
    });
  }
}

interface ParsedProgress {
  readonly seq: number;
  readonly marker: 'idle' | 'ended' | null;
  readonly role: string | null;
  readonly taskType: string | null;
  readonly state: string | null;
  readonly ordinal: number | null;
  readonly repairCycle: number | null;
}

export function parseLiveProgress(
  status: JuliusCommitStatus,
  binding: { readonly runId: string; readonly wlj8: string; readonly githubDateMs: number | null },
): ParsedProgress | null {
  if (status.context !== LIVE_PROGRESS_CONTEXT || status.creator !== LIVE_PROGRESS_CREATOR) return null;
  if (status.description.length > LIVE_PROGRESS_MAX) return null;
  const m = LIVE_PROGRESS_GRAMMAR.exec(status.description);
  if (m === null || m[1] !== binding.runId || m[2] !== binding.wlj8) return null;
  if (binding.githubDateMs === null || status.createdAt === null) return null;
  if (!(Date.parse(status.createdAt) >= binding.githubDateMs - 2_000)) return null;
  const seq = Number(m[3]);
  if (m[4] === 'idle' || m[4] === 'ended') {
    return { seq, marker: m[4], role: null, taskType: null, state: null, ordinal: null, repairCycle: null };
  }
  return {
    seq,
    marker: null,
    role: m[5] ?? null,
    taskType: m[6] ?? null,
    state: m[7] ?? null,
    ordinal: Number(m[8]),
    repairCycle: m[9] === 'x' ? null : Number(m[9]),
  };
}

function cursorAfter(url: string | undefined, epoch: string): { readonly reset: boolean; readonly seq: number } {
  let after = '';
  try {
    after = new URL(url ?? '/', 'http://relay.invalid').searchParams.get('after') ?? '';
  } catch {
    after = '';
  }
  if (after === '') return { reset: false, seq: 0 };
  const m = /^([0-9a-f]{8})\.(\d{1,9})$/u.exec(after);
  if (m === null || m[1] !== epoch) return { reset: true, seq: 0 };
  return { reset: false, seq: Number(m[2]) };
}

const STOPPED = new Set(['failure', 'cancelled', 'timed_out']);

/** What the run's own job, step and phase events say about Julius, never the run status alone. */
export function executionOf(events: readonly WonderlandMissionEvent[], running: boolean): {
  readonly execution: WonderlandExecution;
  readonly executionStartedAt: string | null;
  readonly stoppedAt: { readonly job: string; readonly step: string | null } | null;
} {
  const live = events.filter((event) => event.kind === 'step' && event.job === LIVE_MISSION_JOB && event.name === LIVE_MISSION_STEP);
  const stepStarted = live.find((event) => event.status === 'in_progress') ?? null;
  const stepRan = live.some((event) => event.status === 'in_progress' || (event.status === 'completed' && event.conclusion !== 'skipped'));
  const stepSucceeded = live.some((event) => event.status === 'completed' && event.conclusion === 'success');
  const stepStopped = live.some((event) => event.status === 'completed' && typeof event.conclusion === 'string' && STOPPED.has(event.conclusion));
  const task = events.find((event) => event.kind === 'phase' && event.marker === null) ?? null;
  const started = stepRan || task !== null;
  const executionStartedAt = stepStarted?.at ?? task?.at ?? null;
  const halted = (kind: 'step' | 'job') => events.find((event) => event.kind === kind
    && event.status === 'completed' && typeof event.conclusion === 'string' && STOPPED.has(event.conclusion)) ?? null;
  // The step that stopped, when GitHub names one; else the job.
  const stoppedAt = () => {
    const stopped = halted('step') ?? halted('job');
    return stopped === null ? null : { job: stopped.job ?? '', step: stopped.kind === 'step' ? stopped.name ?? null : null };
  };
  if (!started) {
    if (running) return { execution: 'starting', executionStartedAt: null, stoppedAt: null };
    return { execution: 'did_not_start', executionStartedAt: null, stoppedAt: stoppedAt() };
  }
  // A confirmed failure or cancellation of Julius itself, as soon as GitHub reports it.
  if (stepStopped) return { execution: 'interrupted', executionStartedAt, stoppedAt: { job: LIVE_MISSION_JOB, step: LIVE_MISSION_STEP } };
  if (stepSucceeded) return { execution: 'finished', executionStartedAt, stoppedAt: null };
  if (running) return { execution: 'executing', executionStartedAt, stoppedAt: null };
  // The run ended while Julius was running and the LIVE step never reported success.
  return { execution: 'interrupted', executionStartedAt, stoppedAt: stoppedAt() };
}

function noneBody(wlj: string, reason: WonderlandEventsReason, nowMs: number) {
  return {
    wljRunId: wlj,
    workflowRunId: null,
    source: 'none',
    mode: null,
    runStatus: null,
    runConclusion: null,
    live: false,
    // Unknown, not "not started": with no bound run there is nothing to read it from.
    execution: null,
    executionStartedAt: null,
    stoppedAt: null,
    stale: false,
    fetchedAt: new Date(nowMs).toISOString(),
    events: [],
    next: null,
    reason,
  };
}

function notFound() {
  return { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };
}

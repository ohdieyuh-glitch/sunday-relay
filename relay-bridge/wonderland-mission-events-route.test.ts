import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import type { JuliusCommitStatus, JuliusRunJob, JuliusRunJobsReader, JuliusRunSummary } from './julius-mission-github-gh';
import {
  createWonderlandAdmissionService,
  handleWonderlandAdmissionRoute,
  WONDERLAND_ADMISSION_PATH,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import {
  EVENTS_REFRESH_MS,
  EVENTS_STALE_MS,
  LIVE_MISSION_JOB,
  LIVE_MISSION_STEP,
  LIVE_PROGRESS_CONTEXT,
  createWonderlandMissionEventsBridge,
  isWonderlandMissionEventsRoute,
  parseLiveProgress,
  printableName,
} from './wonderland-mission-events-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const WLJ8 = '0b7a1c2e';
const KEY = '11111111-2222-4333-8444-555555555555';
const WHEN = '2026-10-23T17:18:00.000Z';
const T0 = Date.parse(WHEN);
const PROJECT = 'project-1';
const SHA = 'c'.repeat(40);
const WORKFLOW_RUN = '36568129865';
const GITHUB_DATE = '2026-10-23T17:18:05Z';

function env(storePath: string, over: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: 'julius-inworld-data-1',
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
    ...over,
  };
}

function service(storePath: string, over: Record<string, string> = {}) {
  return createWonderlandAdmissionService({
    env: env(storePath, over),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => {
      if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
      if (token === 'other-token') return { playerId: 'other-player', projectId: PROJECT, sessionId: 'sess-2' };
      return null;
    },
    readWorkflowText: () => null,
  });
}

function request(over: Partial<WonderlandAdmissionRouteRequest> & { after?: string } = {}): WonderlandAdmissionRouteRequest {
  const pathname = `/wonderland/julius/missions/${RUN}/events`;
  const { after, ...rest } = over;
  return {
    method: 'GET',
    path: pathname,
    url: `${pathname}?projectId=${PROJECT}${after === undefined ? '' : `&after=${after}`}`,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: undefined,
    idempotencyKey: undefined,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: T0,
    ...rest,
  };
}

async function admitted(over: Record<string, string> = {}): Promise<{ storePath: string; dir: string; keyHash: string; ports: ReturnType<typeof service> }> {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-events-'));
  const storePath = join(dir, 'admission.json');
  const created = service(storePath);
  const response = await handleWonderlandAdmissionRoute({
    method: 'POST',
    path: WONDERLAND_ADMISSION_PATH,
    url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: JSON.stringify({ runId: RUN, clientTriggerId: 'trigger_01', clientLogSha256: 'ab'.repeat(32), clientUiActionUtc: WHEN }),
    idempotencyKey: KEY,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: T0,
  }, created);
  expect(response?.status).toBe(202);
  created.close();
  const keyHash = readAdmissionDocument(storePath).admissions[0]?.keyHash ?? '';
  return { storePath, dir, keyHash, ports: service(storePath, over) };
}

function claim(storePath: string, over: Record<string, unknown> = {}): void {
  const journalPath = `${storePath}.operator.json`;
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { claims: unknown[] };
  const base = {
    wonderlandRunId: RUN, serverRunId: RUN, spentTag: `julius-run-spent-0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d`,
    spentTagState: 'absent', at: WHEN, dispatchError: null, halt: null, githubDate: GITHUB_DATE,
  };
  journal.claims = [
    { ...base, state: 'dispatching', dispatchAttempted: false, workflowRunId: null },
    { ...base, state: 'dispatched', dispatchAttempted: true, workflowRunId: WORKFLOW_RUN, ...over },
  ];
  writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
}

function summary(keyHash: string, over: Partial<JuliusRunSummary> = {}): JuliusRunSummary {
  return {
    id: WORKFLOW_RUN,
    attempt: 1,
    status: 'in_progress',
    conclusion: null,
    event: 'workflow_dispatch',
    headBranch: 'main',
    headSha: SHA,
    path: '.github/workflows/julius-first-live-mission.yml',
    displayTitle: `julius mission=julius-inworld-data-1 lane=lab mode=paid key=${keyHash}`,
    createdAt: '2026-10-23T17:18:06Z',
    ...over,
  };
}

const JOBS: readonly JuliusRunJob[] = [{
  id: '901',
  name: 'Preflight, then the live mission',
  status: 'in_progress',
  conclusion: null,
  startedAt: '2026-10-23T17:18:30Z',
  completedAt: null,
  steps: [
    { number: 1, name: "Gate: a paid run is attempt 1 only", status: 'completed', conclusion: 'success', startedAt: '2026-10-23T17:18:31Z', completedAt: '2026-10-23T17:18:32Z' },
    { number: 2, name: 'LIVE: run the first real Julius mission', status: 'in_progress', conclusion: null, startedAt: '2026-10-23T17:20:00Z', completedAt: null },
  ],
}];

function status(description: string, over: Partial<JuliusCommitStatus> = {}): JuliusCommitStatus {
  return {
    id: String(5000 + description.length),
    context: LIVE_PROGRESS_CONTEXT,
    state: 'pending',
    description,
    creator: 'github-actions[bot]',
    createdAt: '2026-10-23T17:20:10Z',
    ...over,
  };
}

function fakeReader(state: {
  run: JuliusRunSummary | null | 'throw';
  jobs?: readonly JuliusRunJob[];
  statuses?: readonly JuliusCommitStatus[];
}): JuliusRunJobsReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async readRun(id) {
      calls.push(`run ${id}`);
      if (state.run === 'throw') throw new Error('github_unreadable');
      return state.run;
    },
    async readRunJobs(id, attempt) {
      calls.push(`jobs ${id} ${attempt}`);
      return state.jobs ?? JOBS;
    },
    async readCommitStatuses(sha) {
      calls.push(`statuses ${sha}`);
      return state.statuses ?? [];
    },
  };
}

async function withAdmission(run: (ctx: Awaited<ReturnType<typeof admitted>>) => Promise<void>, over: Record<string, string> = {}): Promise<void> {
  const ctx = await admitted(over);
  try {
    await run(ctx);
  } finally {
    ctx.ports.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  }
}

type Body = Record<string, unknown> & { events: Array<Record<string, unknown>> };

describe('the events path', () => {
  it('is its own exact route, off the native-refusing catch-all; a slash, a child or another case stays on it', () => {
    const pathname = `/wonderland/julius/missions/${RUN}/events`;
    const queried = `${pathname}?projectId=${PROJECT}`;
    expect(isWonderlandMissionEventsRoute(queried)).toBe(true);
    expect(isWonderlandRoute(queried)).toBe(false);
    expect(classifyWonderlandDispatchPath(pathname, queried).exactMissionEvents).toBe(true);
    for (const raw of [`${pathname}/`, `${pathname}/extra`, `/Wonderland/Julius/Missions/${RUN}/Events`]) {
      expect(isWonderlandMissionEventsRoute(raw), raw).toBe(false);
      expect(isWonderlandRoute(raw), raw).toBe(true);
    }
  });
});

describe('the live events route', () => {
  it('serves nothing before dispatch, and reads no GitHub', async () => {
    await withAdmission(async ({ ports }) => {
      const reader = fakeReader({ run: null });
      const response = await createWonderlandMissionEventsBridge(ports, reader).handle(request());
      expect(response?.status).toBe(200);
      expect(response?.body).toMatchObject({ source: 'none', reason: 'not_dispatched', live: false, events: [], workflowRunId: null });
      expect(reader.calls).toEqual([]);
    });
  });

  it('says the live view is unconfigured when the bridge has no GitHub reads', async () => {
    await withAdmission(async ({ ports, storePath }) => {
      claim(storePath);
      const response = await createWonderlandMissionEventsBridge(ports, undefined).handle(request());
      expect(response?.body).toMatchObject({ source: 'none', reason: 'live_view_unconfigured', live: false });
    });
  });

  it('a dispatched claim with no recorded run id is unbound, never a guessed run', async () => {
    await withAdmission(async ({ ports, storePath }) => {
      claim(storePath, { workflowRunId: null });
      const reader = fakeReader({ run: null });
      const response = await createWonderlandMissionEventsBridge(ports, reader).handle(request());
      expect(response?.body).toMatchObject({ source: 'none', reason: 'run_unbound' });
      expect(reader.calls).toEqual([]);
    });
  });

  it('streams the bound run\'s job and step states, LIVE while it runs, mode from the run name', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const reader = fakeReader({ run: summary(keyHash) });
      const response = await createWonderlandMissionEventsBridge(ports, reader).handle(request());
      const body = response?.body as Body;
      expect(body).toMatchObject({ source: 'github_actions', mode: 'paid', live: true, stale: false, workflowRunId: WORKFLOW_RUN, runStatus: 'in_progress' });
      expect(body.events.map((event) => [event.kind, event.name, event.status])).toEqual([
        ['job', 'Preflight, then the live mission', 'in_progress'],
        ['step', 'Gate: a paid run is attempt 1 only', 'completed'],
        ['step', 'LIVE: run the first real Julius mission', 'in_progress'],
      ]);
      expect(body.events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(reader.calls).toEqual([`run ${WORKFLOW_RUN}`, `jobs ${WORKFLOW_RUN} 1`, `statuses ${SHA}`]);
      expect(body).not.toHaveProperty('completion');
      expect(body).not.toHaveProperty('checkerVerdict');
    });
  });

  it('a run that is not this claim\'s paid dispatch is a mismatch with no events', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      for (const over of [
        { displayTitle: `julius mission=julius-inworld-data-1 lane=lab mode=paid key=${'f'.repeat(64)}` },
        { displayTitle: `julius mission=julius-inworld-data-1 lane=lab mode=preflight key=${keyHash}` },
        { headBranch: 'feature' },
        { attempt: 2 },
        { event: 'push' },
        { path: '.github/workflows/other.yml' },
        { id: '4242' },
      ] as const) {
        const reader = fakeReader({ run: summary(keyHash, over) });
        const response = await createWonderlandMissionEventsBridge(ports, reader).handle(request());
        expect(response?.body, JSON.stringify(over)).toMatchObject({ source: 'none', reason: 'run_mismatch', live: false, events: [] });
      }
    });
  });

  it('a finished run is never live, and the route still reports no completion or verdict', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const reader = fakeReader({ run: summary(keyHash, { status: 'completed', conclusion: 'success' }) });
      const body = (await createWonderlandMissionEventsBridge(ports, reader).handle(request()))?.body as Body;
      expect(body).toMatchObject({ live: false, runStatus: 'completed', runConclusion: 'success', source: 'github_actions' });
      expect(JSON.stringify(body)).not.toMatch(/checkerVerdict|completion|PASS/u);
    });
  });

  it('reads GitHub at most once per refresh window; a cursor returns only new events; another epoch resets', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const state = { run: summary(keyHash) as JuliusRunSummary, jobs: JOBS };
      const reader = fakeReader(state);
      const bridge = createWonderlandMissionEventsBridge(ports, reader);
      const first = (await bridge.handle(request()))?.body as Body;
      const again = (await bridge.handle(request({ nowMs: T0 + EVENTS_REFRESH_MS - 1 })))?.body as Body;
      expect(reader.calls.filter((call) => call.startsWith('run '))).toHaveLength(1);
      expect(again.events).toEqual(first.events);
      // The LIVE step finishes; the next window reads it.
      state.jobs = [{ ...JOBS[0]!, steps: [JOBS[0]!.steps[0]!, { ...JOBS[0]!.steps[1]!, status: 'completed', conclusion: 'success', completedAt: '2026-10-23T17:40:00Z' }] }];
      const later = (await bridge.handle(request({ nowMs: T0 + EVENTS_REFRESH_MS, after: String(first.next) })))?.body as Body;
      expect(later.events.map((event) => [event.seq, event.name, event.status])).toEqual([[4, 'LIVE: run the first real Julius mission', 'completed']]);
      expect(reader.calls.filter((call) => call.startsWith('run '))).toHaveLength(2);
      const stranger = (await bridge.handle(request({ nowMs: T0 + EVENTS_REFRESH_MS, after: 'deadbeef.3' })))?.body as Body;
      expect(stranger.reset).toBe(true);
      expect(stranger.events).toHaveLength(4);
    });
  });

  it('a GitHub read that fails keeps the last state and turns stale; none ever read is unreadable', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const state: { run: JuliusRunSummary | 'throw' } = { run: summary(keyHash) };
      const reader = fakeReader(state);
      const bridge = createWonderlandMissionEventsBridge(ports, reader);
      const first = (await bridge.handle(request()))?.body as Body;
      state.run = 'throw';
      const soon = (await bridge.handle(request({ nowMs: T0 + EVENTS_REFRESH_MS })))?.body as Body;
      expect(soon).toMatchObject({ stale: false, live: true });
      const late = (await bridge.handle(request({ nowMs: T0 + EVENTS_STALE_MS + 1 })))?.body as Body;
      expect(late).toMatchObject({ stale: true, live: true });
      expect(late.events).toEqual(first.events);
      const fresh = createWonderlandMissionEventsBridge(ports, fakeReader({ run: 'throw' }));
      expect((await fresh.handle(request()))?.body).toMatchObject({ source: 'none', reason: 'github_unreadable', live: false });
    });
  });

  it('is the status route\'s guard: another player gets the 404, and only GET is served', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const reader = fakeReader({ run: summary(keyHash) });
      const bridge = createWonderlandMissionEventsBridge(ports, reader);
      expect((await bridge.handle(request({ authorization: 'Relay-Session other-token' })))?.status).toBe(403);
      expect((await bridge.handle(request({ method: 'POST' })))?.status).toBe(405);
      expect((await bridge.handle(request({ remoteAddress: '10.0.0.5' })))?.status).toBe(403);
      expect(reader.calls).toEqual([]);
    });
  });
});

describe('names reach the client as printable ASCII', () => {
  it('folds the real em-dash step name and anything else non-ASCII, and caps the length', () => {
    expect(printableName('Preflight complete — stopping here (no confirm_live given)')).toBe('Preflight complete - stopping here (no confirm_live given)');
    expect(printableName('‘a’ “b” – c… é\u{1F600}')).toBe(`'a' "b" - c... ??`);
    const long = printableName('x'.repeat(300));
    expect(long).toHaveLength(120);
    expect(long.endsWith('...')).toBe(true);
    expect(printableName('Gate: one spent tag for this admission run id, before any provider call')).toBe('Gate: one spent tag for this admission run id, before any provider call');
  });
});

describe('phase events from the julius-live-progress status', () => {
  const binding = { runId: WORKFLOW_RUN, wlj8: WLJ8, githubDateMs: Date.parse(GITHUB_DATE) };

  it('accepts only github-actions[bot], the exact context and grammar, this run, attempt 1 and this wlj, after the dispatch', () => {
    const good = `v1 r${WORKFLOW_RUN}.a1.${WLJ8} s3 coder:repair_build:active o7 c1`;
    expect(parseLiveProgress(status(good), binding)).toEqual({
      seq: 3, marker: null, role: 'coder', taskType: 'repair_build', state: 'active', ordinal: 7, repairCycle: 1,
    });
    expect(parseLiveProgress(status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s9 ended`), binding)).toMatchObject({ marker: 'ended', role: null });
    expect(parseLiveProgress(status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s4 coder:build:active o2 cx`), binding)?.repairCycle).toBeNull();
    for (const [label, refused] of [
      ['another creator', status(good, { creator: 'someone' })],
      ['another context', status(good, { context: 'Verify Relay' })],
      ['another run', status(`v1 r4242.a1.${WLJ8} s3 coder:build:active o7 c1`)],
      ['another wlj', status(`v1 r${WORKFLOW_RUN}.a1.deadbeef s3 coder:build:active o7 c1`)],
      ['attempt 2', status(`v1 r${WORKFLOW_RUN}.a2.${WLJ8} s3 coder:build:active o7 c1`)],
      ['a cycle above 3', status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s3 coder:build:active o7 c4`)],
      ['an unknown role', status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s3 wizard:build:active o7 c1`)],
      ['free text', status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s3 coder:build:active o7 c1 hello`)],
      ['before the dispatch', status(good, { createdAt: '2026-10-23T17:18:02Z' })],
      ['no creation time', status(good, { createdAt: null })],
      ['too long', status(`${good}${' '.repeat(140)}`)],
    ] as const) {
      expect(parseLiveProgress(refused, binding), label).toBeNull();
    }
    expect(parseLiveProgress(status(good), { ...binding, githubDateMs: null })).toBeNull();
  });

  it('a bound run\'s accepted statuses become sampled phase events in seq order; a forged or foreign one does not', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const reader = fakeReader({
        run: summary(keyHash),
        statuses: [
          status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s2 reviewer:review:active o3 c0`, { id: '7002' }),
          status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s1 coder:build:active o2 c0`, { id: '7001' }),
          status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s3 coder:build:succeeded o2 c0`, { id: '7003', creator: 'mallory' }),
          status('success', { id: '7004', context: 'Verify Relay', state: 'success' }),
        ],
      });
      const body = (await createWonderlandMissionEventsBridge(ports, reader).handle(request()))?.body as Body;
      const phases = body.events.filter((event) => event.kind === 'phase');
      expect(phases.map((event) => [event.role, event.taskType, event.state, event.sampled])).toEqual([
        ['coder', 'build', 'active', true],
        ['reviewer', 'review', 'active', true],
      ]);
    });
  });

  it('an `ended` sample is a marker, never a completion', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const reader = fakeReader({
        run: summary(keyHash, { status: 'completed', conclusion: 'success' }),
        statuses: [status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s5 ended`, { state: 'success' })],
      });
      const body = (await createWonderlandMissionEventsBridge(ports, reader).handle(request()))?.body as Body;
      expect(body.events.find((event) => event.kind === 'phase')).toMatchObject({ marker: 'ended', role: null, state: null });
      expect(JSON.stringify(body)).not.toMatch(/checkerVerdict|completion|PASS/u);
    });
  });
});

describe('rehearsal binds only a preflight run, and only before a real dispatch', () => {
  const PREFLIGHT_RUN = '36500000001';
  const preflight = (over: Partial<JuliusRunSummary> = {}): JuliusRunSummary => summary('x', {
    id: PREFLIGHT_RUN,
    displayTitle: 'julius mission=julius-inworld-data-1 lane=lab mode=preflight key=none',
    ...over,
  });

  it('a running preflight is live with mode preflight; a finished one is recorded and never live; a paid run is refused', async () => {
    await withAdmission(async ({ ports }) => {
      const running = (await createWonderlandMissionEventsBridge(ports, fakeReader({ run: preflight() })).handle(request()))?.body as Body;
      expect(running).toMatchObject({ source: 'github_actions', mode: 'preflight', live: true, workflowRunId: PREFLIGHT_RUN });
      const done = (await createWonderlandMissionEventsBridge(ports, fakeReader({ run: preflight({ status: 'completed', conclusion: 'success' }) })).handle(request()))?.body as Body;
      expect(done).toMatchObject({ source: 'github_actions_recorded', live: false });
      const paid = (await createWonderlandMissionEventsBridge(ports, fakeReader({
        run: preflight({ displayTitle: 'julius mission=julius-inworld-data-1 lane=lab mode=paid key=abc' }),
      })).handle(request()))?.body as Body;
      expect(paid).toMatchObject({ source: 'none', reason: 'run_mismatch' });
    }, { JULIUS_WONDERLAND_EVENTS_REHEARSAL_RUN_ID: PREFLIGHT_RUN });
  });

  it('once the admission is dispatched, the claim\'s run wins and the rehearsal id is ignored', async () => {
    await withAdmission(async ({ ports, storePath, keyHash }) => {
      claim(storePath);
      const reader = fakeReader({ run: summary(keyHash) });
      await createWonderlandMissionEventsBridge(ports, reader).handle(request());
      expect(reader.calls[0]).toBe(`run ${WORKFLOW_RUN}`);
    }, { JULIUS_WONDERLAND_EVENTS_REHEARSAL_RUN_ID: PREFLIGHT_RUN });
  });
});

describe('execution is read from the LIVE step and task samples, never from the run status alone', () => {
  const step = (number: number, name: string, status: string, conclusion: string | null, startedAt: string | null = '2026-10-23T17:19:00Z') => ({
    number, name, status, conclusion, startedAt, completedAt: status === 'completed' ? '2026-10-23T17:19:30Z' : null,
  });
  const job = (name: string, status: string, conclusion: string | null, steps: ReturnType<typeof step>[], id = '901'): JuliusRunJob => ({
    id, name, status, conclusion, startedAt: '2026-10-23T17:18:30Z', completedAt: status === 'completed' ? '2026-10-23T17:25:00Z' : null, steps,
  });
  const read = async (ctx: Awaited<ReturnType<typeof admitted>>, state: Parameters<typeof fakeReader>[0]) => (
    (await createWonderlandMissionEventsBridge(ctx.ports, fakeReader(state)).handle(request()))?.body as Body
  );

  it('a live run still in its gates is starting, not executing', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const body = await read(ctx, {
        run: summary(ctx.keyHash),
        jobs: [job('spend-tag', 'completed', 'success', []), job('paid-slot', 'in_progress', null, [step(4, 'Gate: admission runs only reviewed, current, not rolled-back code', 'in_progress', null)], '902')],
      });
      expect(body).toMatchObject({ live: true, execution: 'starting', executionStartedAt: null, stoppedAt: null });
    });
  });

  it('the LIVE step in progress is executing, with when it started', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const body = await read(ctx, { run: summary(ctx.keyHash) });
      expect(body).toMatchObject({ live: true, execution: 'executing', executionStartedAt: '2026-10-23T17:20:00Z', stoppedAt: null });
    });
  });

  it('a task sample before the LIVE step is seen is executing; an idle marker alone is not', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const gates = [job(LIVE_MISSION_JOB, 'in_progress', null, [step(1, 'Gate: a paid run is attempt 1 only', 'completed', 'success')])];
      const idle = await read(ctx, { run: summary(ctx.keyHash), jobs: gates, statuses: [status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s1 idle`)] });
      expect(idle.execution).toBe('starting');
    });
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const gates = [job(LIVE_MISSION_JOB, 'in_progress', null, [step(1, 'Gate: a paid run is attempt 1 only', 'completed', 'success')])];
      const task = await read(ctx, { run: summary(ctx.keyHash), jobs: gates, statuses: [status(`v1 r${WORKFLOW_RUN}.a1.${WLJ8} s2 architect:plan:active o1 c0`)] });
      expect(task).toMatchObject({ execution: 'executing', executionStartedAt: '2026-10-23T17:20:10Z' });
    });
  });

  it('a run that finished before the LIVE step is did_not_start, naming the gate that refused (40258482240)', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const body = await read(ctx, {
        run: summary(ctx.keyHash, { status: 'completed', conclusion: 'failure' }),
        jobs: [
          job('spend-tag', 'completed', 'success', [step(3, 'Gate: one spent tag for this admission run id, before any provider call', 'completed', 'success')], '900'),
          job('paid-slot', 'completed', 'failure', [step(4, 'Gate: admission runs only reviewed, current, not rolled-back code', 'completed', 'failure')], '902'),
          job(LIVE_MISSION_JOB, 'completed', 'skipped', [], '903'),
        ],
      });
      expect(body).toMatchObject({
        live: false, runConclusion: 'failure', execution: 'did_not_start', executionStartedAt: null,
        stoppedAt: { job: 'paid-slot', step: 'Gate: admission runs only reviewed, current, not rolled-back code' },
      });
    });
  });

  it('a skipped LIVE step never counts as started', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const body = await read(ctx, {
        run: summary(ctx.keyHash, { status: 'completed', conclusion: 'cancelled' }),
        jobs: [job(LIVE_MISSION_JOB, 'completed', 'cancelled', [step(32, LIVE_MISSION_STEP, 'completed', 'skipped', null), step(3, 'Run actions/checkout', 'completed', 'cancelled')])],
      });
      expect(body).toMatchObject({ execution: 'did_not_start', stoppedAt: { job: LIVE_MISSION_JOB, step: 'Run actions/checkout' } });
    });
  });

  it('a finished LIVE step is finished, which is not an outcome', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const jobs = [job(LIVE_MISSION_JOB, 'in_progress', null, [step(32, LIVE_MISSION_STEP, 'completed', 'success')])];
      const running = await read(ctx, { run: summary(ctx.keyHash), jobs });
      expect(running).toMatchObject({ live: true, execution: 'finished' });
      expect(JSON.stringify(running)).not.toMatch(/checkerVerdict|completion|PASS/u);
    });
  });

  it('a LIVE step that fails or is cancelled is interrupted at once, even while the run still runs', async () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
      await withAdmission(async (ctx) => {
        claim(ctx.storePath);
        const jobs = [job(LIVE_MISSION_JOB, 'in_progress', null, [step(32, LIVE_MISSION_STEP, 'completed', conclusion)])];
        const body = await read(ctx, { run: summary(ctx.keyHash), jobs });
        expect(body, conclusion).toMatchObject({ live: true, execution: 'interrupted', stoppedAt: { job: LIVE_MISSION_JOB, step: LIVE_MISSION_STEP } });
      });
    }
  });

  it('a run that ends while Julius runs, with no LIVE success, is interrupted, naming what stopped', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const bridge = createWonderlandMissionEventsBridge(ctx.ports, fakeReader({
        run: summary(ctx.keyHash, { status: 'completed', conclusion: 'cancelled' }),
        jobs: [job(LIVE_MISSION_JOB, 'completed', 'cancelled', [step(32, LIVE_MISSION_STEP, 'in_progress', null)])],
      }));
      const body = (await bridge.handle(request()))?.body as Body;
      expect(body).toMatchObject({ live: false, execution: 'interrupted', stoppedAt: { job: LIVE_MISSION_JOB, step: null } });
    });
  });

  it('the in-progress sighting is kept after the step completes, so executionStartedAt survives', async () => {
    await withAdmission(async (ctx) => {
      claim(ctx.storePath);
      const state: Parameters<typeof fakeReader>[0] = { run: summary(ctx.keyHash) };
      const bridge = createWonderlandMissionEventsBridge(ctx.ports, fakeReader(state));
      const first = (await bridge.handle(request()))?.body as Body;
      expect(first.execution).toBe('executing');
      state.run = summary(ctx.keyHash, { status: 'completed', conclusion: 'success' });
      state.jobs = [job(LIVE_MISSION_JOB, 'completed', 'success', [step(32, LIVE_MISSION_STEP, 'completed', 'success')])];
      const later = (await bridge.handle(request({ nowMs: T0 + EVENTS_REFRESH_MS + 1 })))?.body as Body;
      expect(later).toMatchObject({ execution: 'finished', executionStartedAt: '2026-10-23T17:20:00Z' });
    });
  });

  it('with no bound run, execution is unknown (null), never "not started"', async () => {
    await withAdmission(async (ctx) => {
      const body = await read(ctx, { run: null });
      expect(body).toMatchObject({ source: 'none', execution: null, executionStartedAt: null, stoppedAt: null });
    });
  });
});

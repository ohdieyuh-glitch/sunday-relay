/**
 * JULIUS_WONDERLAND_START_V2: the awaitable Start, the mission status read,
 * and /events bound by dispatch key. A real admission file and the real claim
 * core over a recording fake `gh`; nothing here reaches GitHub.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_WORKFLOW_FILE } from '../src/relay/integration/wonderland-admission/admission-contract';
import { openAdmissionFile, operatorJournalPath, readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  LANE_GRANT_SOURCE,
  createOperatorClaimTool,
  missionContractPath,
  type AwaitableGhSpawner,
  type GhResult,
  type OperatorClaimTool,
  type PriorAttemptReader,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import type { JuliusRunJob, JuliusRunJobsReader, JuliusRunSummary } from './julius-mission-github-gh';
import { createWonderlandAdmissionService, createWonderlandStatusBridge, handleWonderlandAdmissionRoute, WONDERLAND_ADMISSION_PATH, WONDERLAND_STATUS_PATH, wonderlandAdmissionRequestFrom } from './wonderland-admission-route';
import { createWonderlandMissionReadBridge } from './wonderland-mission-result-route';
import { NO_WORKFLOW_PROGRESS, WORKFLOW_PROGRESS_LABEL } from './wonderland-mission-progress';
import { createWonderlandMissionEventsBridge } from './wonderland-mission-events-route';
import { ghResultFromExecFile, startKeyHash } from './wonderland-mission-start-route';
import { createWonderlandStartV2Wiring, handleWonderlandMissionStatusRoute, isWonderlandMissionStatusRoute, MISSION_STATUS_SCHEMA } from './wonderland-mission-status-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const ADMIT_KEY = '11111111-2222-4333-8444-555555555555';
const ADMIT_KEY_HASH = createHash('sha256').update(ADMIT_KEY).digest('hex');
const START_KEY = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const RETRY_KEY = '12345678-1234-4234-8234-123456789abc';
const TRIGGER = 'c'.repeat(32);
const WHEN = '2026-10-23T17:18:00.000Z';
const PROJECT = 'project-1';
const REPO = 'founder/sunday-relay';
const MISSION = 'julius-inworld-data-1';
const WORKFLOW_RUN = '40250000001';
const PATH = (leaf: string) => `/wonderland/julius/missions/${RUN}/${leaf}`;

const LANES = JSON.parse(readFileSync(join(__dirname, '../src/relay/integration/wonderland-admission/fixtures/pr459-lane-grants.json'), 'utf8')) as {
  readonly laneGrantExcerpt: string;
  readonly contractMarkerNamespace: string;
};
const WORKFLOW = `
name: fixture
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        default: ''
      mission:
        description: 'slug'
      lane:
        description: 'lane'
      dispatch_key:
        description: 'key'
      run_id:
        default: ''
jobs:
  paid:
    steps:
      - run: |
          case "$MARKER_NAMESPACE" in
            *)                 RECORDED_PAID_ATTEMPTS=0 ;;
          esac
`;
const ABSENT: GhResult = { code: 1, stdout: 'HTTP/2.0 404 Not Found\nDate: Fri, 23 Oct 2026 17:18:05 GMT\n\n{"message":"Not Found"}\n', stderr: '' };
const CONTENTS = `repos/${REPO}/contents/`;
const ZERO_PRIOR: PriorAttemptReader = { read: () => Promise.resolve({ readable: true, counted: 0 }), readCompleted: () => Promise.resolve({ readable: true, counted: 0 }) };

/**
 * An awaitable `gh` that answers on a later macrotask. `gh workflow run` waits
 * on `release()` when `hold` is set, and answers `dispatch` (a run URL, no
 * URL as gh < 2.87.0 prints, or a timeout's exit).
 */
function deferredGh(opts: { hold?: boolean; dispatch?: GhResult; runs?: readonly number[]; runState?: { status: string; conclusion: string | null } } = {}) {
  const calls: string[][] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  if (opts.hold !== true) release();
  let reachedWorkflow: () => void = () => undefined;
  const atWorkflow = new Promise<void>((resolve) => { reachedWorkflow = resolve; });
  const answer = (args: readonly string[]): GhResult => {
    const target = args.find((arg) => arg.startsWith(CONTENTS));
    if (args[0] === 'api' && target !== undefined) {
      const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
      const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? WORKFLOW
        : path === missionContractPath(MISSION) ? JSON.stringify({ markerNamespace: LANES.contractMarkerNamespace })
          : path === LANE_GRANT_SOURCE ? LANES.laneGrantExcerpt : null;
      return text === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: text, stderr: '' };
    }
    if (args[0] === 'api') return ABSENT;
    if (args[0] === 'run' && args[1] === 'list') {
      return {
        code: 0,
        stdout: JSON.stringify((opts.runs ?? []).map((id) => ({ databaseId: id, attempt: 1, ...(opts.runState ?? { status: 'in_progress', conclusion: null }), displayTitle: `Julius first live mission mode=paid key=${ADMIT_KEY_HASH}`, event: 'workflow_dispatch', headBranch: 'main' }))),
        stderr: '',
      };
    }
    if (args[0] === 'workflow') return opts.dispatch ?? { code: 0, stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\n`, stderr: '' };
    return { code: 99, stdout: '', stderr: '' };
  };
  const spawn: AwaitableGhSpawner = {
    async run(args) {
      calls.push([...args]);
      if (args[0] === 'workflow') {
        reachedWorkflow();
        await held;
      }
      await new Promise((resolve) => { setTimeout(resolve, 2); });
      return answer(args);
    },
  };
  return { spawn, calls, release: () => release(), atWorkflow };
}

function env(storePath: string, over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: MISSION,
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
    JULIUS_WONDERLAND_START: '1',
    JULIUS_WONDERLAND_START_V2: '1',
    JULIUS_WONDERLAND_GITHUB_REPO: REPO,
    JULIUS_WONDERLAND_START_LANE: 'lab',
    ...over,
  };
}

type Raw = {
  method: string; path: string; url: string; authorization?: string; body?: string; idempotencyKey?: string;
  remoteAddress: string; host: string; forwarded: boolean; nowIso: string; nowMs: number;
};
const raw = (over: Partial<Raw>): Raw => ({
  method: 'GET', path: PATH('status'), url: `${PATH('status')}?projectId=${PROJECT}`, authorization: 'Relay-Session native-token',
  remoteAddress: '127.0.0.1', host: 'localhost', forwarded: false, nowIso: WHEN, nowMs: Date.parse(WHEN), ...over,
});
const statusRequest = (over: Partial<Raw> = {}) => raw(over);
const startRequest = (key = START_KEY) => raw({
  method: 'POST', path: PATH('start'), url: `${PATH('start')}?projectId=${PROJECT}`, idempotencyKey: key,
  body: JSON.stringify({ wljRunId: RUN, confirm: 'RUN LIVE MISSION', clientTriggerId: TRIGGER, clientUiActionUtc: WHEN }),
});

async function admitted(over: Record<string, string | undefined> = {}, gh = deferredGh(), reader?: JuliusRunJobsReader) {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-status-'));
  const storePath = join(dir, 'admission.json');
  const ports = createWonderlandAdmissionService({
    env: env(storePath, over),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => (token === 'native-token' ? { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' } : null),
    readWorkflowText: () => null,
  });
  const created = await handleWonderlandAdmissionRoute({
    method: 'POST', path: WONDERLAND_ADMISSION_PATH, url: `${WONDERLAND_ADMISSION_PATH}?projectId=${PROJECT}`,
    authorization: 'Relay-Session native-token', origin: undefined, idempotencyKey: ADMIT_KEY,
    rawBody: JSON.stringify({ runId: RUN, clientTriggerId: 'trigger_01', clientLogSha256: 'ab'.repeat(32), clientUiActionUtc: WHEN }),
    remoteAddress: '127.0.0.1', host: 'localhost', forwarded: false, nowIso: WHEN, nowMs: Date.parse(WHEN),
  }, ports);
  expect(created?.status).toBe(202);
  const tool = createOperatorClaimTool(openAdmissionFile(storePath), gh.spawn, { nowIso: () => WHEN }, ZERO_PRIOR);
  const claimTool = (_path: string): OperatorClaimTool => tool;
  const wiring = createWonderlandStartV2Wiring(ports, { runReader: reader, evidenceReader: undefined }, { spawn: gh.spawn, claimTool });
  return {
    storePath, ports, gh, tool, wiring,
    status: async (over: Partial<Raw> = {}) => wiring.statusBridge.handle(statusRequest(over)),
    start: async (key?: string) => wiring.startBridge.handle(startRequest(key)),
    cleanup() { ports.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

const workflowRuns = (calls: readonly string[][]) => calls.filter((args) => args[0] === 'workflow');
type StatusBody = Record<string, unknown> & { start: Record<string, unknown>; progress: Record<string, unknown>; admission: Record<string, unknown> };
const bodyOf = (result: { body: unknown } | null) => result?.body as StatusBody;

describe('mission status v2: routing behind the flag', () => {
  const pathname = PATH('status');
  it('without the option the status path stays on the catch-all, as on main', () => {
    expect(isWonderlandMissionStatusRoute(`${pathname}?projectId=${PROJECT}`)).toBe(true);
    expect(isWonderlandRoute(pathname)).toBe(true);
    const classified = classifyWonderlandDispatchPath(pathname, `${pathname}?projectId=${PROJECT}`);
    expect(Object.hasOwn(classified, 'exactMissionStatus')).toBe(false);
  });

  it('with the option it is its own exact route; a slash, a child or another case stays on the catch-all', () => {
    expect(isWonderlandRoute(pathname, { missionStatus: true })).toBe(false);
    expect(classifyWonderlandDispatchPath(pathname, `${pathname}?projectId=${PROJECT}`, { missionStatus: true }).exactMissionStatus).toBe(true);
    for (const other of [`${pathname}/`, pathname.toUpperCase(), `${pathname}/x`]) {
      expect(isWonderlandMissionStatusRoute(other), other).toBe(false);
      expect(isWonderlandRoute(other, { missionStatus: true }), other).toBe(true);
    }
  });

  it('answers 404 with the flag unset, before any read', async () => {
    const fx = await admitted({ JULIUS_WONDERLAND_START_V2: undefined });
    try {
      const result = await fx.status();
      expect(result?.status).toBe(404);
      expect(fx.gh.calls).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it('keeps the loopback guard: a forwarded request or another host is refused', async () => {
    const fx = await admitted();
    try {
      expect((await fx.status({ forwarded: true }))?.status).not.toBe(200);
      expect((await fx.status({ host: 'relay.example.com' }))?.status).not.toBe(200);
      expect((await fx.status({ remoteAddress: '10.0.0.4' }))?.status).not.toBe(200);
      expect((await fx.status({ method: 'POST' }))?.status).toBe(405);
    } finally {
      fx.cleanup();
    }
  });
});

describe('mission status v2: the body', () => {
  it('an admitted mission before Start: the schema, lowercase words, and null stage and progress without data', async () => {
    const fx = await admitted();
    try {
      const result = await fx.status();
      expect(result?.status).toBe(200);
      const body = bodyOf(result);
      expect(body).toMatchObject({
        schema: MISSION_STATUS_SCHEMA, wljRunId: RUN, phase: 'admitted', terminal: false, run: null, stage: null,
        progress: { percent: null, basis: 'none' },
        workflowProgress: NO_WORKFLOW_PROGRESS,
        start: { requested: false, startKeyHash: null, clientTriggerId: null, workflowRunId: null, workflowRunIdSource: null, recovery: 'none' },
        nextPollMs: 10_000,
      });
      expect(body.progress).toEqual({ percent: null, basis: 'none' });
      expect(body.admission.state).toMatch(/^[a-z_]+$/u);
      expect(fx.gh.calls).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it('after a Start: dispatched, the recorded Start binding, the run id from gh, and still no invented progress', async () => {
    const fx = await admitted();
    try {
      expect((await fx.start())?.status).toBe(202);
      const body = bodyOf(await fx.status());
      expect(body).toMatchObject({
        phase: 'dispatched', terminal: false, stage: null, progress: { percent: null, basis: 'none' },
        start: { requested: true, startKeyHash: startKeyHash(START_KEY), clientTriggerId: TRIGGER, workflowRunId: WORKFLOW_RUN, workflowRunIdSource: 'gh_output', retryStartSafe: true },
        nextPollMs: 2_000,
      });
      expect(JSON.stringify(body)).not.toMatch(/gh |--repo|admission\.json|token/u);
    } finally {
      fx.cleanup();
    }
  });
});

describe('mission status v2: Start does not block, and never dispatches twice', () => {
  it('a /status read answers while Start is waiting on gh workflow run', async () => {
    const gh = deferredGh({ hold: true });
    const fx = await admitted({}, gh);
    try {
      const start = fx.start();
      await gh.atWorkflow;
      const during = bodyOf(await fx.status());
      expect(during).toMatchObject({ phase: 'dispatching', start: { requested: true, startKeyHash: startKeyHash(START_KEY), clientTriggerId: TRIGGER, retryStartSafe: true } });
      gh.release();
      expect((await start)?.status).toBe(202);
      expect(workflowRuns(gh.calls)).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  it('a retried Start, concurrent or after, with any key, replays and spawns no second workflow', async () => {
    const gh = deferredGh({ hold: true });
    const fx = await admitted({}, gh);
    try {
      const first = fx.start();
      await gh.atWorkflow;
      const concurrent = fx.start(RETRY_KEY);
      gh.release();
      expect((await first)?.status).toBe(202);
      expect((await concurrent)?.status).toBe(200);
      const later = await fx.start(RETRY_KEY);
      expect(later?.status).toBe(200);
      expect(later?.body).toMatchObject({ state: 'dispatched', replayed: true });
      expect(workflowRuns(gh.calls)).toHaveLength(1);
      expect(readAdmissionDocument(fx.storePath).claims.filter((event) => event.state === 'dispatched')).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  it('after a plain non-zero gh workflow run exit, a retried Start replays the failure, dispatches nothing more, and status is unknown, not failed', async () => {
    const gh = deferredGh({ dispatch: { code: 1, stdout: '', stderr: 'HTTP 502' } });
    const fx = await admitted({}, gh);
    try {
      const first = await fx.start();
      expect(first?.status).not.toBe(202);
      const retried = await fx.start(RETRY_KEY);
      expect(retried?.status).toBe(first?.status);
      expect(workflowRuns(gh.calls)).toHaveLength(1);
      const body = bodyOf(await fx.status());
      expect(body.admission.state).toBe('dispatch_failed');
      expect(body).toMatchObject({ phase: 'unknown', terminal: false, result: { outcomeUnknown: true } });
      expect(workflowRuns(gh.calls)).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });
});

describe('mission status v2: a null workflowRunId is bound by dispatch key', () => {
  const JOBS: readonly JuliusRunJob[] = [];
  function reader(run: JuliusRunSummary): JuliusRunJobsReader & { reads: string[] } {
    const reads: string[] = [];
    return {
      reads,
      async readRun(id) { reads.push(id); return id === run.id ? run : null; },
      async readRunJobs() { return JOBS; },
      async readCommitStatuses() { return []; },
    };
  }

  it('gh < 2.87.0 printed no run URL: the recovery finds the run by key and /events serves it', async () => {
    const gh = deferredGh({ dispatch: { code: 0, stdout: '', stderr: '' }, runs: [Number(WORKFLOW_RUN)] });
    const run: JuliusRunSummary = {
      id: WORKFLOW_RUN, attempt: 1, status: 'queued', conclusion: null, event: 'workflow_dispatch', headBranch: 'main',
      headSha: 'f'.repeat(40), path: '.github/workflows/julius-first-live-mission.yml',
      displayTitle: `Julius first live mission mode=paid key=${ADMIT_KEY_HASH}`, createdAt: '2026-10-23T17:18:01Z',
    };
    const runs = reader(run);
    const fx = await admitted({}, gh, runs);
    try {
      expect((await fx.start())?.status).toBe(202);
      expect(readAdmissionDocument(fx.storePath).claims.at(-1)).toMatchObject({ state: 'dispatched', workflowRunId: null });
      const before = bodyOf(await fx.status());
      expect(before.start).toMatchObject({ workflowRunId: null, workflowRunIdSource: null });
      expect(before.run).toBeNull();
      await fx.wiring.recovery.check({ wljRunId: RUN, storePath: fx.storePath, repo: REPO, nowMs: Date.parse(WHEN) });
      const after = bodyOf(await fx.status({ nowMs: Date.parse(WHEN) + 20_000 }));
      expect(after.start).toMatchObject({ workflowRunId: WORKFLOW_RUN, workflowRunIdSource: 'dispatch_key' });
      expect(after.run).toMatchObject({ status: 'queued' });
      expect(after.phase).toBe('queued');
      expect(runs.reads).toContain(WORKFLOW_RUN);
      expect(workflowRuns(gh.calls)).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  it('a run found by key that fails runMatchesClaim is not served', async () => {
    const gh = deferredGh({ dispatch: { code: 0, stdout: '', stderr: '' }, runs: [Number(WORKFLOW_RUN)] });
    const run: JuliusRunSummary = {
      id: WORKFLOW_RUN, attempt: 1, status: 'queued', conclusion: null, event: 'workflow_dispatch', headBranch: 'feature',
      headSha: 'f'.repeat(40), path: '.github/workflows/julius-first-live-mission.yml',
      displayTitle: `Julius first live mission mode=paid key=${ADMIT_KEY_HASH}`, createdAt: '2026-10-23T17:18:01Z',
    };
    const fx = await admitted({}, gh, reader(run));
    try {
      expect((await fx.start())?.status).toBe(202);
      await fx.wiring.recovery.check({ wljRunId: RUN, storePath: fx.storePath, repo: REPO, nowMs: Date.parse(WHEN) });
      const after = bodyOf(await fx.status({ nowMs: Date.parse(WHEN) + 20_000 }));
      expect(after.run).toBeNull();
      expect(after.progress).toMatchObject({ percent: null });
    } finally {
      fx.cleanup();
    }
  });
});

describe('mission status v2: a gh workflow run with no answer (timeout, signal, not started)', () => {
  it('Start answers dispatching (not a replay), a retry replays it with no second workflow, and /status reports outcome-unknown and reconcile_required', async () => {
    for (const failure of ['timeout', 'signal', 'spawn_failed'] as const) {
      const gh = deferredGh({ dispatch: { code: 1, stdout: '', stderr: '', failure } });
      const fx = await admitted({}, gh);
      try {
        const first = await fx.start();
        expect(first?.status, failure).toBe(200);
        expect(first?.body).toMatchObject({ state: 'dispatching', workflowRunId: null, replayed: false });
        const retried = await fx.start(RETRY_KEY);
        expect(retried?.body).toMatchObject({ state: 'dispatching', replayed: true });
        expect(workflowRuns(gh.calls)).toHaveLength(1);
        const error = readAdmissionDocument(fx.storePath).claims.at(-1)?.dispatchError;
        expect(error).toBe({ timeout: 'gh_workflow_run_timeout', signal: 'gh_workflow_run_signal', spawn_failed: 'gh_spawn_failed' }[failure]);
        const body = bodyOf(await fx.status());
        expect(body).toMatchObject({ phase: 'dispatching', terminal: false, admission: { state: 'dispatching' }, result: { outcomeUnknown: true } });
        await fx.wiring.recovery.check({ wljRunId: RUN, storePath: fx.storePath, repo: REPO, nowMs: Date.parse(WHEN) + 1_000 });
        const after = bodyOf(await fx.status({ nowMs: Date.parse(WHEN) + 20_000 }));
        expect(after.start).toMatchObject({ recovery: 'operator_reconcile_required', recoveryReason: error });
        expect(workflowRuns(gh.calls)).toHaveLength(1);
      } finally {
        fx.cleanup();
      }
    }
  });
});

describe('mission status v2: GET status is read-only (A-2)', () => {
  const bytes = (storePath: string) => [readFileSync(storePath), readFileSync(operatorJournalPath(storePath))];

  it('polling a reservation stuck in dispatching past 300 s, with GitHub showing the run, changes no byte of the store or journal', async () => {
    const gh = deferredGh({ hold: true, runs: [Number(WORKFLOW_RUN)] });
    const fx = await admitted({}, gh);
    try {
      const start = fx.start();
      await gh.atWorkflow;
      const before = bytes(fx.storePath);
      const late = Date.parse(WHEN) + 301_000;
      for (const nowMs of [late, late + 16_000, late + 32_000]) {
        await fx.status({ nowMs });
        await fx.wiring.recovery.check({ wljRunId: RUN, storePath: fx.storePath, repo: REPO, nowMs });
      }
      const body = bodyOf(await fx.status({ nowMs: late + 48_000 }));
      expect(body).toMatchObject({ phase: 'dispatching', start: { recovery: 'operator_reconcile_required', recoveryReason: 'dispatching_stuck' } });
      expect(bytes(fx.storePath)).toEqual(before);
      expect(workflowRuns(gh.calls)).toHaveLength(1);
      gh.release();
      await start;
    } finally {
      fx.cleanup();
    }
  });

  it('polling a gh_workflow_run_failed claim (G8) or a dispatched claim with no run id (G5) changes no byte either', async () => {
    for (const dispatch of [{ code: 1, stdout: '', stderr: 'HTTP 502' }, { code: 0, stdout: '', stderr: '' }]) {
      const gh = deferredGh({ dispatch, runs: [Number(WORKFLOW_RUN)] });
      const fx = await admitted({}, gh);
      try {
        await fx.start();
        const before = bytes(fx.storePath);
        for (const nowMs of [Date.parse(WHEN) + 1_000, Date.parse(WHEN) + 400_000, Date.parse(WHEN) + 3_600_000]) {
          await fx.status({ nowMs });
          await fx.wiring.recovery.check({ wljRunId: RUN, storePath: fx.storePath, repo: REPO, nowMs });
        }
        expect(bytes(fx.storePath)).toEqual(before);
      } finally {
        fx.cleanup();
      }
    }
  });
});

describe('mission status v2: workflowRunIdSource (A-5)', () => {
  it('a run id reconcile wrote on dispatch_failed (workflow_run_unspent) is labelled reconcile, not gh_output', async () => {
    const gh = deferredGh({ hold: true, runs: [Number(WORKFLOW_RUN)], runState: { status: 'completed', conclusion: 'failure' } });
    const fx = await admitted({}, gh);
    try {
      const start = fx.start();
      await gh.atWorkflow;
      // The founder's reconcile, from a second claim core (as the CLI is), while the first Start's child never answers.
      const cli = createOperatorClaimTool(openAdmissionFile(fx.storePath), gh.spawn, { nowIso: () => WHEN }, ZERO_PRIOR);
      const reconciled = await cli.reconcile({ wonderlandRunId: RUN, serverRunId: RUN, repo: REPO });
      expect(reconciled.ok).toBe(true);
      expect(readAdmissionDocument(fx.storePath).claims.at(-1)).toMatchObject({ state: 'dispatch_failed', dispatchError: 'workflow_run_unspent', workflowRunId: WORKFLOW_RUN });
      const body = bodyOf(await fx.status());
      expect(body.start).toMatchObject({ workflowRunId: WORKFLOW_RUN, workflowRunIdSource: 'reconcile' });
      gh.release();
      await start;
    } finally {
      fx.cleanup();
    }
  });
});

describe('Start with JULIUS_WONDERLAND_START_V2 unset stays on v1 (A-1)', () => {
  it('dispatches once through the v1 claim and records no startKeyHash or clientTriggerId', async () => {
    const gh = deferredGh();
    const fx = await admitted({ JULIUS_WONDERLAND_START_V2: undefined }, gh);
    try {
      const result = await fx.start();
      expect(result?.status).toBe(202);
      expect(workflowRuns(gh.calls)).toHaveLength(1);
      const claims = readAdmissionDocument(fx.storePath).claims;
      expect(claims.length).toBeGreaterThan(0);
      for (const event of claims) {
        expect(Object.hasOwn(event, 'startKeyHash') || Object.hasOwn(event, 'clientTriggerId')).toBe(false);
      }
      expect(readFileSync(operatorJournalPath(fx.storePath), 'utf8')).not.toMatch(/startKeyHash|clientTriggerId/u);
    } finally {
      fx.cleanup();
    }
  });
});

describe('/events binds the dispatch-key run only when the journal has none (A-4)', () => {
  it('a journal run id wins over a recovered one, and the recovery is not asked', async () => {
    const OTHER = '40250000999';
    const fx = await admitted();
    try {
      expect((await fx.start())?.status).toBe(202);
      const reads: string[] = [];
      const asked: string[] = [];
      const summary = (id: string): JuliusRunSummary => ({
        id, attempt: 1, status: 'queued', conclusion: null, event: 'workflow_dispatch', headBranch: 'main',
        headSha: 'f'.repeat(40), path: '.github/workflows/julius-first-live-mission.yml',
        displayTitle: `Julius first live mission mode=paid key=${ADMIT_KEY_HASH}`, createdAt: '2026-10-23T17:18:01Z',
      });
      const reader: JuliusRunJobsReader = {
        async readRun(id) { reads.push(id); return summary(id); },
        async readRunJobs() { return []; },
        async readCommitStatuses() { return []; },
      };
      const events = createWonderlandMissionEventsBridge(fx.ports, reader, { recoveredRunId: (wlj) => { asked.push(wlj); return OTHER; } });
      const answer = await events.handle(raw({ path: PATH('events'), url: `${PATH('events')}?projectId=${PROJECT}` }));
      expect(answer?.status).toBe(200);
      expect(reads).toContain(WORKFLOW_RUN);
      expect(reads).not.toContain(OTHER);
      expect(asked).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe('the awaitable Start spawner reads a real execFile answer', () => {
  const run = (file: string, args: readonly string[], timeout = 0) => new Promise<GhResult>((resolve) => {
    execFile(file, [...args], { encoding: 'utf8', timeout, windowsHide: true }, (error, stdout, stderr) => resolve(ghResultFromExecFile(error, stdout, stderr)));
  });

  it('an ordinary exit, zero or not, is the child\'s own code with no failure', async () => {
    expect(await run(process.execPath, ['-e', 'process.stdout.write("ok")'])).toEqual({ code: 0, stdout: 'ok', stderr: '' });
    expect(await run(process.execPath, ['-e', 'process.exit(3)'])).toEqual({ code: 3, stdout: '', stderr: '' });
  });

  it('a child killed at the timeout is timeout, one killed by a signal is signal, and a missing binary is spawn_failed (127)', async () => {
    expect(await run(process.execPath, ['-e', 'setTimeout(() => undefined, 10000)'], 200)).toMatchObject({ code: 1, failure: 'timeout' });
    expect(await run(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'])).toMatchObject({ code: 1, failure: 'signal' });
    expect(await run(join(tmpdir(), 'no-such-gh-binary-for-this-test'), ['--version'])).toMatchObject({ code: 127, failure: 'spawn_failed' });
  });
});

describe('the status read never reads GitHub for an invalid repo, and says repo_unconfigured', () => {
  type Poked = { repo: string | null };
  /** Record every recovery poke the status read makes, passing it on unchanged. */
  function spyPokes(fx: Awaited<ReturnType<typeof admitted>>): Poked[] {
    const poked: Poked[] = [];
    const recovery = fx.wiring.recovery;
    const poke = recovery.poke.bind(recovery);
    recovery.poke = (target) => { poked.push({ repo: target.repo }); poke(target); };
    return poked;
  }
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });
  const setRepo = (fx: Awaited<ReturnType<typeof admitted>>, repo: string) => {
    (fx.ports.env as Record<string, string | undefined>).JULIUS_WONDERLAND_GITHUB_REPO = repo;
  };
  const BAD_REPOS = ['./x', '../x', 'x/.', 'x/..', '', 'no-slash', 'a/b/c'];

  it('a dispatched claim with no run id: no recovery is started with a repo (no GitHub read is even built), and it says repo_unconfigured', async () => {
    for (const repo of BAD_REPOS) {
      const gh = deferredGh({ dispatch: { code: 0, stdout: '', stderr: '' }, runs: [Number(WORKFLOW_RUN)] });
      const fx = await admitted({}, gh);
      try {
        expect((await fx.start())?.status).toBe(202);
        const before = gh.calls.length;
        const poked = spyPokes(fx);
        setRepo(fx, repo);
        await fx.status({ nowMs: Date.parse(WHEN) + 1_000 });
        await settle();
        // Not merely refused by the allow-list: the recovery is never handed a repo to read.
        expect(poked.length, repo).toBeGreaterThan(0);
        expect(poked.every((target) => target.repo === null), repo).toBe(true);
        expect(gh.calls.length, repo).toBe(before);
        expect(bodyOf(await fx.status({ nowMs: Date.parse(WHEN) + 20_000 })).start, repo).toMatchObject({ recovery: 'reconciling', recoveryReason: 'repo_unconfigured' });
      } finally {
        fx.cleanup();
      }
    }
  });

  it('an outcome-unknown dispatching claim is still operator_reconcile_required from the journal, with no GitHub read', async () => {
    for (const repo of ['./x', '']) {
      const gh = deferredGh({ dispatch: { code: 1, stdout: '', stderr: '', failure: 'timeout' } });
      const fx = await admitted({}, gh);
      try {
        expect((await fx.start())?.status).toBe(200);
        const before = gh.calls.length;
        const poked = spyPokes(fx);
        setRepo(fx, repo);
        expect(bodyOf(await fx.status({ nowMs: Date.parse(WHEN) + 1_000 }))).toMatchObject({ phase: 'dispatching', result: { outcomeUnknown: true } });
        await settle();
        const after = bodyOf(await fx.status({ nowMs: Date.parse(WHEN) + 20_000 }));
        expect(after, repo).toMatchObject({ phase: 'dispatching', result: { outcomeUnknown: true } });
        expect(after.start, repo).toMatchObject({ recovery: 'operator_reconcile_required', recoveryReason: 'gh_workflow_run_timeout' });
        expect(poked.every((target) => target.repo === null), repo).toBe(true);
        expect(gh.calls.length, repo).toBe(before);
      } finally {
        fx.cleanup();
      }
    }
  });

  it('a gh_workflow_run_failed claim stays outcome-unknown and says repo_unconfigured, with no GitHub read', async () => {
    const gh = deferredGh({ dispatch: { code: 1, stdout: '', stderr: 'HTTP 500' } });
    const fx = await admitted({}, gh);
    try {
      await fx.start();
      expect(readAdmissionDocument(fx.storePath).claims.at(-1)).toMatchObject({ state: 'dispatch_failed', dispatchError: 'gh_workflow_run_failed' });
      const before = gh.calls.length;
      setRepo(fx, '../x');
      await fx.status({ nowMs: Date.parse(WHEN) + 1_000 });
      await settle();
      const after = bodyOf(await fx.status({ nowMs: Date.parse(WHEN) + 20_000 }));
      expect(after).toMatchObject({ result: { outcomeUnknown: true }, start: { recovery: 'reconciling', recoveryReason: 'repo_unconfigured' } });
      expect(gh.calls.length).toBe(before);
    } finally {
      fx.cleanup();
    }
  });

  it('a valid repo is handed to the recovery unchanged (control)', async () => {
    const gh = deferredGh({ dispatch: { code: 0, stdout: '', stderr: '' }, runs: [Number(WORKFLOW_RUN)] });
    const fx = await admitted({}, gh);
    try {
      expect((await fx.start())?.status).toBe(202);
      const poked = spyPokes(fx);
      await fx.status({ nowMs: Date.parse(WHEN) + 1_000 });
      await settle();
      expect(poked).toEqual([{ repo: REPO }]);
    } finally {
      fx.cleanup();
    }
  });
});

describe('A-6: mission percent is never derived from workflow steps', () => {
  const STEPS = [
    { seq: 1, at: null, kind: 'job', job: 'Paid', name: 'Paid', status: 'completed', conclusion: 'success' },
    { seq: 2, at: null, kind: 'step', job: 'Paid', name: 'checkout', status: 'completed', conclusion: 'success' },
    { seq: 3, at: null, kind: 'step', job: 'Paid', name: 'LIVE', status: 'completed', conclusion: 'success' },
  ];
  async function statusWith(result: Record<string, unknown> | null) {
    const fx = await admitted();
    try {
      const deps = {
        events: async () => ({ status: 200, body: { source: 'run', runStatus: 'completed', runConclusion: 'success', execution: 'finished', live: false, next: null, events: STEPS } }),
        result: async () => (result === null ? null : { status: 200, body: result }),
      };
      const request = statusRequest();
      return bodyOf(await handleWonderlandMissionStatusRoute(wonderlandAdmissionRequestFrom(request), request, fx.ports, deps));
    } finally {
      fx.cleanup();
    }
  }

  it('every workflow step completed (100% of steps) is NOT mission progress: percent stays null', async () => {
    for (const result of [null, { state: 'dispatched', checkerVerdict: 'NOT_RUN' }]) {
      const body = await statusWith(result);
      expect(body.workflowProgress).toEqual({ label: WORKFLOW_PROGRESS_LABEL, percent: 100, basis: 'workflow_steps', stepsCompleted: 2, stepsTotal: 2 });
      expect(body.progress).toEqual({ percent: null, basis: 'none' });
      expect(body.schema).toBe('wonderland-mission-status.v1');
    }
  });

  it('a completed run whose checker did not pass has null mission percent', async () => {
    for (const verdict of ['FAIL', 'NOT_RUN']) {
      const body = await statusWith({ state: 'completed', checkerVerdict: verdict });
      expect(body.phase, verdict).toBe('completed');
      expect(body.progress, verdict).toEqual({ percent: null, basis: 'none' });
    }
  });

  it('only a completed run with a PASS verdict is 100, basis verified_completion', async () => {
    const body = await statusWith({ state: 'completed', checkerVerdict: 'PASS' });
    expect(body.progress).toEqual({ percent: 100, basis: 'verified_completion' });
    expect(body.workflowProgress).toMatchObject({ label: WORKFLOW_PROGRESS_LABEL, basis: 'workflow_steps' });
  });
});

describe('A5 changes no route or field already served on main', () => {
  type Ports = Awaited<ReturnType<typeof admitted>>['ports'];
  const get = (path: string, url: string) => ({
    method: 'GET', path, url, authorization: 'Relay-Session native-token',
    remoteAddress: '127.0.0.1', host: 'localhost', forwarded: false, nowIso: WHEN, nowMs: Date.parse(WHEN),
  });
  const mainStatus = (ports: Ports) => createWonderlandStatusBridge(ports).handle(get(WONDERLAND_STATUS_PATH, `${WONDERLAND_STATUS_PATH}?projectId=${PROJECT}&runId=${encodeURIComponent(RUN)}`));
  const mainRead = (ports: Ports, leaf: 'progress' | 'result') => createWonderlandMissionReadBridge(ports).handle(get(PATH(leaf), `${PATH(leaf)}?projectId=${PROJECT}`));

  it('/wonderland/julius/status, /missions/{id}/progress and /result answer byte-identical bodies with the v2 flag off and on', async () => {
    const off = await admitted({ JULIUS_WONDERLAND_START_V2: undefined });
    const on = await admitted();
    try {
      const reads = [(p: Ports) => mainStatus(p), (p: Ports) => mainRead(p, 'progress'), (p: Ports) => mainRead(p, 'result')];
      for (const read of reads) {
        const a = await read(off.ports);
        const b = await read(on.ports);
        expect(a?.status).toBe(200);
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }
      // main's status body has no progress or percent field, and nothing of the mission status leaks into it.
      expect(JSON.stringify((await mainStatus(on.ports))?.body)).not.toMatch(/workflowProgress|verified_completion|"percent"|wonderland-mission-status/u);
    } finally {
      off.cleanup();
      on.cleanup();
    }
  });
});

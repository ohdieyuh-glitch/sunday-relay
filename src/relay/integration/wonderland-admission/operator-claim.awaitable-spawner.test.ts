/**
 * The claim core over a spawner whose `gh` answers later (the bridge's
 * non-blocking spawner). Same argv, same order, same gates, same journal as
 * the synchronous spawner; the Start binding is on the reservation before
 * `gh workflow run`; a retried claim replays without a second spawn.
 * Offline: every `gh` here is a recording fake.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_WORKFLOW_FILE } from './admission-contract';
import { openAdmissionFile, operatorJournalPath, readAdmissionDocument, type ClaimEvent } from './admission-file';
import { createWonderlandAdmissionStore, type AdmissionRequest } from './admission-store';
import {
  LANE_GRANT_SOURCE,
  OPERATOR_DISPATCH_CONFIRMATION,
  createOperatorClaimTool,
  ghResultFromChildExit,
  inFlightPeers,
  legalTransition,
  missionContractPath,
  type AwaitableGhSpawner,
  type ClaimInput,
  type GhResult,
  type GhSpawnFailure,
  type GhSpawner,
  type PriorAttemptReader,
} from './operator-claim';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = 'a'.repeat(64);
const WHEN = '2026-10-23T17:18:00.000Z';
const REPO = 'founder/sunday-relay';
const LANE = 'lab';
const MISSION = 'julius-inworld-data-1';
const HEX = '0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d';
const START_KEY_HASH = 'b'.repeat(64);
const START_TRIGGER = 'trigger_start_01';
const WORKFLOW_RUN = '40698923582';

const WORKFLOW = `
name: fixture
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        description: 'phrase'
        required: false
        default: ''
      mission:
        description: 'slug'
      lane:
        description: 'lane'
      dispatch_key:
        description: 'key'
      run_id:
        description: 'Julius bootstrap run id'
        required: false
        default: ''
jobs:
  paid:
    steps:
      - run: |
          case "$MARKER_NAMESPACE" in
            *)                 RECORDED_PAID_ATTEMPTS=0 ;;
          esac
`;

const LANES = JSON.parse(readFileSync(join(__dirname, 'fixtures/pr459-lane-grants.json'), 'utf8')) as {
  readonly laneGrantExcerpt: string;
  readonly contractMarkerNamespace: string;
};

const DATE_HEADER = 'Fri, 23 Oct 2026 17:18:05 GMT';
const LATER_HEADER = 'Fri, 23 Oct 2026 17:40:05 GMT';
const ABSENT: GhResult = { code: 1, stdout: `HTTP/2.0 404 Not Found\nDate: ${DATE_HEADER}\n\n{"message":"Not Found"}\n`, stderr: '' };
const TAG_SHA = 'ab'.repeat(20);
const PRESENT_LATER: GhResult = {
  code: 0,
  stdout: `HTTP/2.0 200 OK\nDate: ${LATER_HEADER}\n\n{"ref":"refs/tags/julius-run-spent-${HEX}","object":{"type":"tag","sha":"${TAG_SHA}"}}\n`,
  stderr: '',
};
const CONTENTS = `repos/${REPO}/contents/`;
const ZERO_PRIOR: PriorAttemptReader = {
  read: () => Promise.resolve({ readable: true, counted: 0 }),
  readCompleted: () => Promise.resolve({ readable: true, counted: 0 }),
};

function request(over: Partial<AdmissionRequest> = {}): AdmissionRequest {
  return {
    runId: RUN,
    keyHash: KEY,
    dispatchId: 'adm_fixed',
    missionId: MISSION,
    requestId: 'trigger_01',
    clientLogSha256: 'c'.repeat(64),
    clientUiActionUtc: WHEN,
    receivedAt: WHEN,
    modelPins: { architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null },
    ...over,
  };
}

function claimInput(over: Partial<ClaimInput> = {}): ClaimInput {
  return {
    wonderlandRunId: RUN,
    serverRunId: RUN,
    repo: REPO,
    lane: LANE,
    workflowSource: '',
    dispatch: true,
    confirmation: OPERATOR_DISPATCH_CONFIRMATION,
    ...over,
  };
}

/** What GitHub answers, by argv: main's files, the spent tag, the run list, the tag object, the dispatch. */
function github(args: readonly string[], phase: { spent: boolean }): GhResult {
  const target = args.find((arg) => arg.startsWith(CONTENTS));
  if (args[0] === 'api' && target !== undefined) {
    const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
    const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? WORKFLOW
      : path === missionContractPath(MISSION) ? JSON.stringify({ markerNamespace: LANES.contractMarkerNamespace })
        : path === LANE_GRANT_SOURCE ? LANES.laneGrantExcerpt : null;
    return text === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: text, stderr: '' };
  }
  if (args[0] === 'api' && args.some((arg) => arg.includes('/git/tags/'))) {
    return {
      code: 0,
      stdout: JSON.stringify({ message: `julius-run-spent.v1\nrun=${RUN}\nworkflow_run_id=${WORKFLOW_RUN}\n` }),
      stderr: '',
    };
  }
  if (args[0] === 'api') return phase.spent ? PRESENT_LATER : ABSENT;
  if (args[0] === 'run') {
    return {
      code: 0,
      stdout: JSON.stringify([{ databaseId: Number(WORKFLOW_RUN), attempt: 1, status: 'in_progress', conclusion: null, displayTitle: `Julius first live mission mode=paid key=${KEY}`, event: 'workflow_dispatch', headBranch: 'main' }]),
      stderr: '',
    };
  }
  if (args[0] === 'workflow') return { code: 0, stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\n`, stderr: '' };
  return { code: 99, stdout: '', stderr: '' };
}

interface Recording {
  readonly calls: string[][];
  readonly phase: { spent: boolean };
  /** The journal's latest claim for RUN at the moment `gh workflow run` was spawned. */
  readonly atDispatch: Record<string, unknown>[];
}

function syncGh(path: string): { spawn: GhSpawner } & Recording {
  const calls: string[][] = [];
  const phase = { spent: false };
  const atDispatch: Record<string, unknown>[] = [];
  return {
    calls, phase, atDispatch,
    spawn: {
      run(args) {
        calls.push([...args]);
        if (args[0] === 'workflow') atDispatch.push(latest(path));
        return github(args, phase);
      },
    },
  };
}

/** Answers on a later macrotask, the way an execFile child does. */
function laterGh(path: string): { spawn: AwaitableGhSpawner } & Recording {
  const calls: string[][] = [];
  const phase = { spent: false };
  const atDispatch: Record<string, unknown>[] = [];
  return {
    calls, phase, atDispatch,
    spawn: {
      run(args) {
        calls.push([...args]);
        if (args[0] === 'workflow') atDispatch.push(latest(path));
        return new Promise<GhResult>((resolve) => { setTimeout(() => resolve(github(args, phase)), 5); });
      },
    },
  };
}

function latest(path: string): Record<string, unknown> {
  const claims = readAdmissionDocument(path).claims.filter((event) => event.wonderlandRunId === RUN);
  return { ...(claims[claims.length - 1] ?? {}) };
}

async function withStore(run: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-await-'));
  try {
    const path = join(dir, 'admission.json');
    const admitted = await createWonderlandAdmissionStore({ ledger: openAdmissionFile(path).ledger, dailyCap: 2, missionCap: 2 }).admit(request());
    if (!admitted.ok) throw new Error('expected an admission');
    await run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tool = (path: string, spawn: GhSpawner | AwaitableGhSpawner) =>
  createOperatorClaimTool(openAdmissionFile(path), spawn, { nowIso: () => WHEN }, ZERO_PRIOR);

/** The journal minus nothing: what each spawner leaves behind must be the same bytes. */
const journal = (path: string) => readAdmissionDocument(path).claims;

describe('operator claim over an awaitable gh spawner', () => {
  it('a full claim records the identical argv vectors, in the same order, as the synchronous spawner, and the same journal', async () => {
    let syncCalls: string[][] = [];
    let syncClaims: unknown = null;
    let syncResult: unknown = null;
    await withStore(async (path) => {
      const gh = syncGh(path);
      syncResult = await tool(path, gh.spawn).claim(claimInput());
      syncCalls = gh.calls;
      syncClaims = journal(path);
    });
    await withStore(async (path) => {
      const gh = laterGh(path);
      const result = await tool(path, gh.spawn).claim(claimInput());
      expect(gh.calls).toEqual(syncCalls);
      expect(result).toEqual(syncResult);
      expect(journal(path)).toEqual(syncClaims);
    });
    expect(syncCalls.map((args) => args[0])).toEqual(['api', 'api', 'api', 'api', 'workflow']);
    expect(syncCalls.at(-1)).toEqual([
      'workflow', 'run', PAID_WORKFLOW_FILE,
      '--repo', REPO, '--ref', 'main',
      '-f', `mission=${MISSION}`,
      '-f', `lane=${LANE}`,
      '-f', `dispatch_key=${KEY}`,
      '-f', `confirm_live=${OPERATOR_DISPATCH_CONFIRMATION}`,
      '-f', `run_id=${RUN}`,
    ]);
  });

  it('a Start binding changes no argv and no gate: the same vectors with and without it', async () => {
    let plain: string[][] = [];
    await withStore(async (path) => {
      const gh = laterGh(path);
      await tool(path, gh.spawn).claim(claimInput());
      plain = gh.calls;
    });
    await withStore(async (path) => {
      const gh = laterGh(path);
      await tool(path, gh.spawn).claim(claimInput({ start: { startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER } }));
      expect(gh.calls).toEqual(plain);
    });
  });

  it('the Start key hash and clientTriggerId are on the durable reservation before gh workflow run is spawned', async () => {
    await withStore(async (path) => {
      const gh = laterGh(path);
      const result = await tool(path, gh.spawn).claim(claimInput({ start: { startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER } }));
      expect(gh.atDispatch).toHaveLength(1);
      expect(gh.atDispatch[0]).toMatchObject({ state: 'dispatching', dispatchAttempted: false, startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.record).toMatchObject({ state: 'dispatched', workflowRunId: WORKFLOW_RUN, startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER });
      // Every event of the claim carries the same binding, and a fresh read of the file accepts it.
      for (const event of journal(path)) expect(event).toMatchObject({ startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER });
    });
  });

  it('a claim without a Start binding writes no binding keys (the CLI and main journal shape)', async () => {
    await withStore(async (path) => {
      const gh = laterGh(path);
      await tool(path, gh.spawn).claim(claimInput());
      for (const event of journal(path)) {
        expect(Object.hasOwn(event, 'startKeyHash')).toBe(false);
        expect(Object.hasOwn(event, 'clientTriggerId')).toBe(false);
      }
      const raw = readFileSync(operatorJournalPath(path), 'utf8');
      expect(raw).toContain('"state":"dispatched"');
      expect(raw).not.toContain('startKeyHash');
      expect(raw).not.toContain('clientTriggerId');
    });
  });

  it('a journal claim carrying half a Start binding, or a malformed one, is read as corrupt', async () => {
    await withStore(async (path) => {
      const gh = laterGh(path);
      await tool(path, gh.spawn).claim(claimInput({ start: { startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER } }));
      const good = readFileSync(operatorJournalPath(path), 'utf8');
      expect(() => readAdmissionDocument(path)).not.toThrow();
      for (const bad of [
        good.replaceAll(`,"clientTriggerId":"${START_TRIGGER}"`, ''),
        good.replaceAll(START_KEY_HASH, 'B'.repeat(64)),
        good.replaceAll(START_TRIGGER, 'bad trigger!'),
      ]) {
        expect(bad).not.toBe(good);
        writeFileSync(operatorJournalPath(path), bad);
        expect(() => readAdmissionDocument(path)).toThrow();
      }
    });
  });

  it('a malformed Start binding is refused before any gh call or write', async () => {
    await withStore(async (path) => {
      const gh = laterGh(path);
      const result = await tool(path, gh.spawn).claim(claimInput({ start: { startKeyHash: 'not-a-hash', clientTriggerId: START_TRIGGER } }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe('start_binding_invalid');
      expect(gh.calls).toEqual([]);
      expect(journal(path)).toEqual([]);
    });
  });

  it('a retried claim replays the recorded state and spawns nothing more, concurrent or after', async () => {
    await withStore(async (path) => {
      const gh = laterGh(path);
      const claims = tool(path, gh.spawn);
      const start = { startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER };
      const [first, concurrent] = await Promise.all([claims.claim(claimInput({ start })), claims.claim(claimInput({ start }))]);
      const callsAfterFirst = gh.calls.length;
      const later = await claims.claim(claimInput({ start: { startKeyHash: 'c'.repeat(64), clientTriggerId: 'trigger_retry_02' } }));
      expect(first.ok && first.dispatchedWorkflow && !first.replayed).toBe(true);
      for (const replayed of [concurrent, later]) {
        expect(replayed.ok).toBe(true);
        if (!replayed.ok) continue;
        expect(replayed.replayed).toBe(true);
        expect(replayed.dispatchedWorkflow).toBe(false);
        expect(replayed.record.state).toBe('dispatched');
        // The replay shows the binding of the Start that dispatched, not the retry's.
        expect(replayed.record.startKeyHash).toBe(START_KEY_HASH);
      }
      expect(gh.calls.length).toBe(callsAfterFirst);
      expect(gh.calls.filter((args) => args[0] === 'workflow')).toHaveLength(1);
    });
  });

  it('reconcile awaits the same reads in the same order and carries the binding onto its outcome', async () => {
    const stuck = async (spawnFor: (path: string) => { spawn: GhSpawner | AwaitableGhSpawner } & Recording) => {
      let calls: string[][] = [];
      let outcome: unknown = null;
      await withStore(async (path) => {
        // A bridge that stopped after the reservation: the dispatch child never returned.
        const dead: AwaitableGhSpawner = {
          run: (args) => (args[0] === 'workflow' ? new Promise<GhResult>(() => undefined) : github(args, { spent: false })),
        };
        void tool(path, dead).claim(claimInput({ start: { startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER } }));
        for (let i = 0; i < 200 && latest(path).state !== 'dispatching'; i += 1) await new Promise((resolve) => { setTimeout(resolve, 5); });
        expect(latest(path).state).toBe('dispatching');
        const gh = spawnFor(path);
        gh.phase.spent = true;
        outcome = await tool(path, gh.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: RUN, repo: REPO });
        calls = gh.calls;
      });
      return { calls, outcome };
    };
    const sync = await stuck(syncGh);
    const later = await stuck(laterGh);
    expect(later.calls).toEqual(sync.calls);
    expect(later.outcome).toEqual(sync.outcome);
    expect(sync.calls.map((args) => args[0])).toEqual(['run', 'api', 'api']);
    expect(sync.calls.some((args) => args[0] === 'workflow')).toBe(false);
    expect(later.outcome).toMatchObject({ ok: true, reconciled: true, record: { state: 'dispatched', workflowRunId: WORKFLOW_RUN, startKeyHash: START_KEY_HASH } });
  });
});

describe('two different runs of the same mission, both claimed through a deferred spawner', () => {
  const RUN2 = 'wlj_1c8b2d3f-5a4e-4b7c-9d3e-4f5a6b7c8d9e';
  const KEY2 = 'd'.repeat(64);

  /** `gh workflow run` waits until released; every other read answers on a later macrotask. */
  function deferredGh(): { spawn: AwaitableGhSpawner; calls: string[][]; reached: Promise<void>; release: () => void } {
    const calls: string[][] = [];
    let release = (): void => undefined;
    let reachedWorkflow = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { reachedWorkflow = resolve; });
    return {
      calls, reached, release: () => release(),
      spawn: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === 'workflow') { reachedWorkflow(); await held; }
          await new Promise((resolve) => { setTimeout(resolve, 2); });
          return github(args, { spent: false });
        },
      },
    };
  }

  async function withTwoAdmissions(run: (path: string) => Promise<void>): Promise<void> {
    await withStore(async (path) => {
      const second = await createWonderlandAdmissionStore({ ledger: openAdmissionFile(path).ledger, dailyCap: 2, missionCap: 2 })
        .admit(request({ runId: RUN2, keyHash: KEY2, dispatchId: 'adm_fixed_2', requestId: 'trigger_02' }));
      if (!second.ok) throw new Error('expected a second admission');
      await run(path);
    });
  }

  const claimOf = (runId: string) => claimInput({ wonderlandRunId: runId, serverRunId: runId });
  const workflowRuns = (calls: string[][]) => calls.filter((args) => args[0] === 'workflow' && args[1] === 'run');

  for (const shape of ['one claim tool (one bridge)', 'two claim tools on the same file (two bridges)'] as const) {
    it(`${shape}: exactly one gh workflow run and one julius_paid_run_in_flight refusal`, async () => {
      await withTwoAdmissions(async (path) => {
        const gh = deferredGh();
        const first = tool(path, gh.spawn);
        const second = shape === 'one claim tool (one bridge)' ? first : tool(path, gh.spawn);
        const claims = [first.claim(claimOf(RUN)), second.claim(claimOf(RUN2))];
        await gh.reached;
        if (shape === 'two claim tools on the same file (two bridges)') {
          // While the winner's `gh workflow run` is still held, the other bridge's claim is already refused.
          // (Inside one bridge the claim chain queues the second claim behind the first's dispatch instead.)
          const settled = await Promise.race([
            Promise.any(claims.map((claim) => claim.then((result) => (result.ok ? Promise.reject(new Error('ok')) : result)))),
            new Promise<null>((resolve) => { setTimeout(() => resolve(null), 2_000); }),
          ]);
          expect(settled).not.toBeNull();
        }
        expect(workflowRuns(gh.calls)).toHaveLength(1);
        gh.release();
        const results = await Promise.all(claims);
        expect(workflowRuns(gh.calls)).toHaveLength(1);
        const won = results.filter((result) => result.ok && result.dispatchedWorkflow);
        const refused = results.filter((result) => !result.ok && result.kind === 'julius_paid_run_in_flight');
        expect(won).toHaveLength(1);
        expect(refused).toHaveLength(1);
        const winner = results.indexOf(won[0]!) === 0 ? RUN : RUN2;
        const loser = winner === RUN ? RUN2 : RUN;
        expect(refused[0]).toMatchObject({ inFlightWljRunId: winner });
        expect(workflowRuns(gh.calls)[0]).toContain(`run_id=${winner}`);
        // The loser wrote nothing: no claim event, so its admission is still held and claimable.
        expect(journal(path).filter((event) => event.wonderlandRunId === loser)).toEqual([]);
      });
    });
  }
});

describe('a gh workflow run with no answer of its own (timeout, signal, not started) is outcome-unknown and in flight', () => {
  const RUN2 = 'wlj_1c8b2d3f-5a4e-4b7c-9d3e-4f5a6b7c8d9e';
  const KEY2 = 'd'.repeat(64);
  const START = { startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER };
  const ABSENT_LATER: GhResult = { code: 1, stdout: `HTTP/2.0 404 Not Found\nDate: ${LATER_HEADER}\n\n{"message":"Not Found"}\n`, stderr: '' };
  const CASES: ReadonlyArray<readonly [GhSpawnFailure, string]> = [
    ['timeout', 'gh_workflow_run_timeout'],
    ['signal', 'gh_workflow_run_signal'],
    ['spawn_failed', 'gh_spawn_failed'],
  ];

  async function withTwoAdmissions(run: (path: string) => Promise<void>): Promise<void> {
    await withStore(async (path) => {
      const second = await createWonderlandAdmissionStore({ ledger: openAdmissionFile(path).ledger, dailyCap: 2, missionCap: 2 })
        .admit(request({ runId: RUN2, keyHash: KEY2, dispatchId: 'adm_fixed_2', requestId: 'trigger_02' }));
      if (!second.ok) throw new Error('expected a second admission');
      await run(path);
    });
  }

  /** GitHub as `github()` answers it, except where overridden; every call is recorded. */
  function recordingGh(over: { workflow?: GhResult; runs?: readonly Record<string, unknown>[]; tag?: GhResult } = {}): { spawn: AwaitableGhSpawner; calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      spawn: {
        run(args) {
          calls.push([...args]);
          let answer = github(args, { spent: false });
          if (args[0] === 'workflow' && over.workflow !== undefined) answer = over.workflow;
          if (args[0] === 'run' && over.runs !== undefined) answer = { code: 0, stdout: JSON.stringify(over.runs), stderr: '' };
          if (args[0] === 'api' && over.tag !== undefined && args.some((arg) => arg.includes('/git/ref')) && !args.some((arg) => arg.startsWith(CONTENTS))) answer = over.tag;
          return new Promise<GhResult>((resolve) => { setTimeout(() => resolve(answer), 2); });
        },
      },
    };
  }

  const claimOf = (runId: string, start?: typeof START) => claimInput({ wonderlandRunId: runId, serverRunId: runId, ...(start === undefined ? {} : { start }) });
  const workflowRuns = (calls: string[][]) => calls.filter((args) => args[0] === 'workflow');
  const latestOf = (path: string, runId: string) => journal(path).filter((event) => event.wonderlandRunId === runId).at(-1) ?? null;
  const killed = (failure: GhSpawnFailure): GhResult => ({ code: failure === 'spawn_failed' ? 127 : 1, stdout: '', stderr: '', failure });

  for (const [failure, dispatchError] of CASES) {
    it(`${failure}: the claim stays dispatching with ${dispatchError}, and a second Start of the same mission is refused with no gh workflow run`, async () => {
      await withTwoAdmissions(async (path) => {
        const first = recordingGh({ workflow: killed(failure) });
        const result = await tool(path, first.spawn).claim(claimOf(RUN, START));
        expect(result).toMatchObject({ ok: false, kind: 'dispatch_outcome_unknown', record: { state: 'dispatching', dispatchAttempted: true, dispatchError } });
        expect(workflowRuns(first.calls)).toHaveLength(1);
        expect(latestOf(path, RUN)).toMatchObject({ state: 'dispatching', dispatchAttempted: true, dispatchError, spentTagState: 'absent', workflowRunId: null, ...START });
        // Never an ordinary failure: nothing frees the mission.
        expect(journal(path).some((event) => event.state === 'dispatch_failed')).toBe(false);
        expect(inFlightPeers(readAdmissionDocument(path), { ...readAdmissionDocument(path).admissions.find((row) => row.runId === RUN2)! }).map((peer) => peer.runId)).toEqual([RUN]);

        // The same admission again: a replay, no gh call at all.
        const again = recordingGh();
        const replayed = await tool(path, again.spawn).claim(claimOf(RUN, START));
        expect(replayed).toMatchObject({ ok: true, replayed: true, dispatchedWorkflow: false, record: { state: 'dispatching', dispatchError } });
        expect(again.calls).toEqual([]);

        // Another admission of the same mission: refused as in flight, naming the first, and no workflow run.
        // Both with GitHub showing the run still going and with GitHub showing no run for its key at all.
        for (const runs of [undefined, []] as const) {
          const second = recordingGh(runs === undefined ? {} : { runs });
          const refused = await tool(path, second.spawn).claim(claimOf(RUN2));
          expect(refused).toMatchObject({ ok: false, kind: 'julius_paid_run_in_flight', inFlightWljRunId: RUN });
          expect(workflowRuns(second.calls)).toEqual([]);
          expect(second.calls.every((args) => args[0] === 'api' || (args[0] === 'run' && args[1] === 'list'))).toBe(true);
          expect(journal(path).filter((event) => event.wonderlandRunId === RUN2)).toEqual([]);
        }
      });
    });
  }

  it('an ordinary non-zero exit (GitHub refused the dispatch) is still dispatch_failed with gh_workflow_run_failed, and frees the mission', async () => {
    await withTwoAdmissions(async (path) => {
      const first = recordingGh({ workflow: { code: 1, stdout: '', stderr: 'HTTP 422: Unprocessable Entity' } });
      const result = await tool(path, first.spawn).claim(claimOf(RUN));
      expect(result).toMatchObject({ ok: false, kind: 'dispatch_failed', record: { state: 'dispatch_failed', dispatchError: 'gh_workflow_run_failed' } });
      const second = recordingGh();
      const next = await tool(path, second.spawn).claim(claimOf(RUN2));
      expect(next).toMatchObject({ ok: true, dispatchedWorkflow: true });
      expect(workflowRuns(second.calls)).toHaveLength(1);
      expect(workflowRuns(second.calls)[0]).toContain(`run_id=${RUN2}`);
    });
  });

  it('a timed-out claim that reconcile resolves as unspent (the run ended, no spent tag) frees the mission', async () => {
    await withTwoAdmissions(async (path) => {
      await tool(path, recordingGh({ workflow: killed('timeout') }).spawn).claim(claimOf(RUN, START));
      const ended = [{ databaseId: Number(WORKFLOW_RUN), attempt: 1, status: 'completed', conclusion: 'failure', displayTitle: `Julius first live mission mode=paid key=${KEY}`, event: 'workflow_dispatch', headBranch: 'main' }];
      const reconciler = recordingGh({ runs: ended });
      const resolved = await tool(path, reconciler.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: RUN, repo: REPO });
      expect(resolved).toMatchObject({ ok: true, reconciled: true, record: { state: 'dispatch_failed', dispatchError: 'workflow_run_unspent', workflowRunId: WORKFLOW_RUN } });
      expect(workflowRuns(reconciler.calls)).toEqual([]);
      // The binding is carried onto reconcile's outcome unchanged.
      expect(latestOf(path, RUN)).toMatchObject({ state: 'dispatch_failed', ...START });
      const second = recordingGh();
      const next = await tool(path, second.spawn).claim(claimOf(RUN2));
      expect(next).toMatchObject({ ok: true, dispatchedWorkflow: true });
      expect(workflowRuns(second.calls)).toHaveLength(1);
    });
  });

  it('a gh that never started, resolved by reconcile as absent (no run, no tag, past the grace on GitHub\'s clock), frees the mission', async () => {
    await withTwoAdmissions(async (path) => {
      await tool(path, recordingGh({ workflow: killed('spawn_failed') }).spawn).claim(claimOf(RUN));
      const resolved = await tool(path, recordingGh({ runs: [], tag: ABSENT_LATER }).spawn).reconcile({ wonderlandRunId: RUN, serverRunId: RUN, repo: REPO });
      expect(resolved).toMatchObject({ ok: true, reconciled: true, record: { state: 'dispatch_failed', dispatchError: 'workflow_run_absent', workflowRunId: null } });
      const next = await tool(path, recordingGh().spawn).claim(claimOf(RUN2));
      expect(next).toMatchObject({ ok: true, dispatchedWorkflow: true });
    });
  });

  it('a timed-out claim that reconcile finds dispatched (spent tag names the run) stays in flight', async () => {
    await withTwoAdmissions(async (path) => {
      await tool(path, recordingGh({ workflow: killed('timeout') }).spawn).claim(claimOf(RUN));
      const resolved = await tool(path, recordingGh({ tag: PRESENT_LATER }).spawn).reconcile({ wonderlandRunId: RUN, serverRunId: RUN, repo: REPO });
      expect(resolved).toMatchObject({ ok: true, reconciled: true, record: { state: 'dispatched', workflowRunId: WORKFLOW_RUN } });
      const second = recordingGh();
      expect(await tool(path, second.spawn).claim(claimOf(RUN2))).toMatchObject({ ok: false, kind: 'julius_paid_run_in_flight', inFlightWljRunId: RUN });
      expect(workflowRuns(second.calls)).toEqual([]);
    });
  });

  it('the outcome-unknown error round-trips through the journal parser, and every other combination is corrupt', async () => {
    for (const [failure, dispatchError] of CASES) {
      await withStore(async (path) => {
        await tool(path, recordingGh({ workflow: killed(failure) }).spawn).claim(claimInput({ start: START }));
        const good = readFileSync(operatorJournalPath(path), 'utf8');
        expect(readAdmissionDocument(path).claims.at(-1)).toMatchObject({ state: 'dispatching', dispatchAttempted: true, dispatchError, ...START });
        const withLast = (edit: Record<string, unknown>): string => {
          const body = JSON.parse(good) as { claims: Record<string, unknown>[] };
          body.claims[body.claims.length - 1] = { ...body.claims[body.claims.length - 1], ...edit };
          return `${JSON.stringify(body)}\n`;
        };
        expect(withLast({})).toBe(good);
        for (const bad of [
          withLast({ dispatchError: null }),
          withLast({ dispatchError: 'gh_workflow_run_failed' }),
          withLast({ dispatchAttempted: false }),
          withLast({ state: 'dispatch_failed' }),
          withLast({ state: 'dispatched' }),
          withLast({ dispatchError: 'gh_workflow_run_lost' }),
        ]) {
          writeFileSync(operatorJournalPath(path), bad);
          expect(() => readAdmissionDocument(path)).toThrow();
        }
        writeFileSync(operatorJournalPath(path), good);
        expect(() => readAdmissionDocument(path)).not.toThrow();
      });
    }
  });

  it('legalTransition: outcome-unknown follows only the reservation, once, and only reconcile\'s evidence outcomes follow it', () => {
    const reservation: ClaimEvent = {
      wonderlandRunId: RUN, serverRunId: RUN, spentTag: `julius-run-spent-${HEX}`, state: 'dispatching', spentTagState: 'absent', at: WHEN,
      dispatchAttempted: false, dispatchError: null, halt: null, workflowRunId: null, githubDate: '2026-10-23T17:18:05Z', ...START,
    };
    const unknown: ClaimEvent = { ...reservation, dispatchAttempted: true, dispatchError: 'gh_workflow_run_timeout' };
    expect(legalTransition(reservation, unknown)).toBe(true);
    expect(legalTransition(null, unknown)).toBe(false);
    expect(legalTransition(unknown, { ...unknown, dispatchError: 'gh_workflow_run_signal' })).toBe(false);
    expect(legalTransition(reservation, { ...unknown, dispatchError: 'gh_workflow_run_failed' })).toBe(false);
    expect(legalTransition(reservation, { ...reservation, dispatchError: 'gh_workflow_run_timeout' })).toBe(false);
    expect(legalTransition(unknown, { ...unknown, state: 'dispatched', dispatchError: null, workflowRunId: WORKFLOW_RUN })).toBe(true);
    expect(legalTransition(unknown, { ...unknown, state: 'dispatch_failed', dispatchError: 'workflow_run_unspent', workflowRunId: WORKFLOW_RUN })).toBe(true);
    expect(legalTransition(unknown, { ...unknown, state: 'dispatch_failed', dispatchError: 'workflow_run_absent' })).toBe(true);
    // The child's own answer is gone: an ordinary failure cannot be written over an unknown outcome.
    expect(legalTransition(unknown, { ...unknown, state: 'dispatch_failed', dispatchError: 'gh_workflow_run_failed' })).toBe(false);
  });

  it('ghResultFromChildExit keeps an ordinary exit as is and names a timeout, a signal and a failed spawn', () => {
    const io = { stdout: 'out', stderr: 'err' };
    expect(ghResultFromChildExit({ status: 0, signal: null, ...io })).toEqual({ code: 0, ...io });
    expect(ghResultFromChildExit({ status: 1, signal: null, ...io })).toEqual({ code: 1, ...io });
    expect(ghResultFromChildExit({ status: 127, signal: null, ...io })).toEqual({ code: 127, ...io });
    const timedOut = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(ghResultFromChildExit({ status: null, signal: 'SIGTERM', error: timedOut, ...io })).toEqual({ code: 1, ...io, failure: 'timeout' });
    expect(ghResultFromChildExit({ status: null, signal: 'SIGKILL', ...io })).toEqual({ code: 1, ...io, failure: 'signal' });
    const missing = Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
    expect(ghResultFromChildExit({ status: null, signal: null, error: missing })).toEqual({ code: 127, stdout: '', stderr: '', failure: 'spawn_failed' });
    const denied = Object.assign(new Error('spawnSync gh EACCES'), { code: 'EACCES' });
    expect(ghResultFromChildExit({ status: null, signal: null, error: denied })).toEqual({ code: 1, stdout: '', stderr: '', failure: 'spawn_failed' });
  });
});

describe('B-2: the Start binding is carried unchanged from one claim event to the next', () => {
  const START = { startKeyHash: START_KEY_HASH, clientTriggerId: START_TRIGGER };
  const reservation: ClaimEvent = {
    wonderlandRunId: RUN, serverRunId: RUN, spentTag: `julius-run-spent-${HEX}`, state: 'dispatching', spentTagState: 'absent', at: WHEN,
    dispatchAttempted: false, dispatchError: null, halt: null, workflowRunId: null, githubDate: '2026-10-23T17:18:05Z', ...START,
  };
  const dispatched: ClaimEvent = { ...reservation, state: 'dispatched', dispatchAttempted: true, workflowRunId: WORKFLOW_RUN };

  it('an outcome carrying the reservation\'s binding is legal; a changed, dropped or added binding is not', () => {
    expect(legalTransition(reservation, dispatched)).toBe(true);
    expect(legalTransition(reservation, { ...dispatched, startKeyHash: 'c'.repeat(64) })).toBe(false);
    expect(legalTransition(reservation, { ...dispatched, clientTriggerId: 'trigger_other_9' })).toBe(false);
    const { startKeyHash: _key, clientTriggerId: _trigger, ...unbound } = dispatched;
    expect(legalTransition(reservation, unbound)).toBe(false);
    const { startKeyHash: _k2, clientTriggerId: _t2, ...plainReservation } = reservation;
    expect(legalTransition(plainReservation, dispatched)).toBe(false);
    expect(legalTransition(plainReservation, unbound)).toBe(true);
    // The same rule for the outcome-unknown event.
    const unknown: ClaimEvent = { ...reservation, dispatchAttempted: true, dispatchError: 'gh_workflow_run_timeout' };
    expect(legalTransition(reservation, unknown)).toBe(true);
    expect(legalTransition(reservation, { ...unknown, startKeyHash: 'c'.repeat(64) })).toBe(false);
  });

  it('every event a claim writes, through dispatch and through reconcile after an unknown outcome, carries the same binding', async () => {
    await withStore(async (path) => {
      const dead: AwaitableGhSpawner = {
        run: (args) => Promise.resolve(args[0] === 'workflow' ? { code: 1, stdout: '', stderr: '', failure: 'timeout' as const } : github(args, { spent: false })),
      };
      await tool(path, dead).claim(claimInput({ start: START }));
      await tool(path, { run: (args) => github(args, { spent: true }) }).reconcile({ wonderlandRunId: RUN, serverRunId: RUN, repo: REPO });
      const events = journal(path);
      expect(events.map((event) => [event.state, event.dispatchAttempted])).toEqual([['dispatching', false], ['dispatching', true], ['dispatched', true]]);
      for (const event of events) expect(event).toMatchObject(START);
    });
  });
});

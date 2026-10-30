/**
 * The dispatching recovery over the real claim core and a real admission
 * file, with a recording fake `gh`. It never runs `gh workflow run`.
 * Offline: no `gh` here reaches GitHub.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PAID_WORKFLOW_FILE } from '../src/relay/integration/wonderland-admission/admission-contract';
import { openAdmissionFile, operatorJournalPath, readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import { createWonderlandAdmissionStore, type AdmissionRequest } from '../src/relay/integration/wonderland-admission/admission-store';
import {
  LANE_GRANT_SOURCE,
  OPERATOR_DISPATCH_CONFIRMATION,
  createOperatorClaimTool,
  missionContractPath,
  paidRunListArgs,
  spentTagApiArgs,
  type AwaitableGhSpawner,
  type ClaimInput,
  type GhResult,
  type OperatorClaimTool,
  type PriorAttemptReader,
} from '../src/relay/integration/wonderland-admission/operator-claim';
import { createWonderlandDispatchingRecovery, DISPATCHING_STUCK_MS, readOnlyGhSpawner } from './wonderland-dispatching-recovery';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const KEY = 'a'.repeat(64);
const WHEN = '2026-10-23T17:18:00.000Z';
const WHEN_MS = Date.parse(WHEN);
const REPO = 'founder/sunday-relay';
const MISSION = 'julius-inworld-data-1';
const HEX = '0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d';
const WORKFLOW_RUN = '40698923582';
const START = { startKeyHash: 'b'.repeat(64), clientTriggerId: 'trigger_start_01' };

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
const LANES = JSON.parse(readFileSync(join(__dirname, '../src/relay/integration/wonderland-admission/fixtures/pr459-lane-grants.json'), 'utf8')) as {
  readonly laneGrantExcerpt: string;
  readonly contractMarkerNamespace: string;
};
const ABSENT = (date: string): GhResult => ({ code: 1, stdout: `HTTP/2.0 404 Not Found\nDate: ${date}\n\n{"message":"Not Found"}\n`, stderr: '' });
const PRESENT = (date: string): GhResult => ({
  code: 0,
  stdout: `HTTP/2.0 200 OK\nDate: ${date}\n\n{"ref":"refs/tags/julius-run-spent-${HEX}","object":{"type":"tag","sha":"${'ab'.repeat(20)}"}}\n`,
  stderr: '',
});
const EARLY = 'Fri, 23 Oct 2026 17:18:05 GMT';
const LATE = 'Fri, 23 Oct 2026 17:40:05 GMT';
const CONTENTS = `repos/${REPO}/contents/`;
const ZERO_PRIOR: PriorAttemptReader = { read: () => Promise.resolve({ readable: true, counted: 0 }), readCompleted: () => Promise.resolve({ readable: true, counted: 0 }) };

interface World {
  /** What `gh workflow run` answers. */
  dispatch: GhResult | 'hang';
  spent: 'absent' | 'present' | 'present_unverified' | 'unreadable';
  tagDate: string;
  runs: readonly { databaseId: number; attempt: number }[] | 'unreadable';
}

function github(args: readonly string[], world: World): GhResult | 'hang' {
  const target = args.find((arg) => arg.startsWith(CONTENTS));
  if (args[0] === 'api' && target !== undefined) {
    const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
    const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}` ? WORKFLOW
      : path === missionContractPath(MISSION) ? JSON.stringify({ markerNamespace: LANES.contractMarkerNamespace })
        : path === LANE_GRANT_SOURCE ? LANES.laneGrantExcerpt : null;
    return text === null ? { code: 1, stdout: '', stderr: 'HTTP 404' } : { code: 0, stdout: text, stderr: '' };
  }
  if (args[0] === 'api' && args.some((arg) => arg.includes('/git/tags/'))) {
    const message = world.spent === 'present_unverified' ? 'not a spent tag' : `julius-run-spent.v1\nrun=${RUN}\nworkflow_run_id=${WORKFLOW_RUN}\n`;
    return { code: 0, stdout: JSON.stringify({ message }), stderr: '' };
  }
  if (args[0] === 'api') {
    if (world.spent === 'unreadable') return { code: 1, stdout: '', stderr: 'HTTP 502' };
    return world.spent === 'absent' ? ABSENT(world.tagDate) : PRESENT(world.tagDate);
  }
  if (args[0] === 'run' && args[1] === 'list') {
    if (world.runs === 'unreadable') return { code: 1, stdout: '', stderr: 'HTTP 502' };
    return {
      code: 0,
      stdout: JSON.stringify(world.runs.map((run) => ({ ...run, status: 'in_progress', conclusion: null, displayTitle: `Julius first live mission mode=paid key=${KEY}`, event: 'workflow_dispatch', headBranch: 'main' }))),
      stderr: '',
    };
  }
  if (args[0] === 'workflow') return world.dispatch;
  return { code: 99, stdout: '', stderr: '' };
}

function fakeGh(world: World): { spawn: AwaitableGhSpawner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: {
      run(args) {
        calls.push([...args]);
        const answer = github(args, world);
        if (answer === 'hang') return new Promise<GhResult>(() => undefined);
        return new Promise<GhResult>((resolve) => { setTimeout(() => resolve(answer), 2); });
      },
    },
  };
}

function admissionRequest(): AdmissionRequest {
  return {
    runId: RUN, keyHash: KEY, dispatchId: 'adm_fixed', missionId: MISSION, requestId: 'trigger_01',
    clientLogSha256: 'c'.repeat(64), clientUiActionUtc: WHEN, receivedAt: WHEN,
    modelPins: { architectModel: null, codingModel: null, reviewerProvider: null, reviewerModel: null },
  };
}

const claimInput: ClaimInput = {
  wonderlandRunId: RUN, serverRunId: RUN, repo: REPO, lane: 'lab', workflowSource: '', dispatch: true,
  confirmation: OPERATOR_DISPATCH_CONFIRMATION, start: START,
};

async function withStore(run: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-recover-'));
  try {
    const path = join(dir, 'admission.json');
    const admitted = await createWonderlandAdmissionStore({ ledger: openAdmissionFile(path).ledger, dailyCap: 2, missionCap: 2 }).admit(admissionRequest());
    if (!admitted.ok) throw new Error('expected an admission');
    await run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tool = (path: string, spawn: AwaitableGhSpawner): OperatorClaimTool =>
  createOperatorClaimTool(openAdmissionFile(path), spawn, { nowIso: () => WHEN }, ZERO_PRIOR);
const latest = (path: string) => readAdmissionDocument(path).claims.filter((event) => event.wonderlandRunId === RUN).at(-1);
/** The admission store and its operator journal, byte for byte. */
const storeBytes = (path: string) => [readFileSync(path), readFileSync(operatorJournalPath(path))];
const workflowRuns = (calls: readonly string[][]) => calls.filter((args) => args[0] === 'workflow');
const world = (over: Partial<World> = {}): World => ({ dispatch: { code: 0, stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\n`, stderr: '' }, spent: 'absent', tagDate: EARLY, runs: [], ...over });

/** A bridge that stopped after the reservation: its `gh workflow run` child never returned. */
async function stuckInDispatching(path: string): Promise<void> {
  const dead = fakeGh(world({ dispatch: 'hang' }));
  void tool(path, dead.spawn).claim(claimInput);
  for (let i = 0; i < 400 && latest(path)?.state !== 'dispatching'; i += 1) await new Promise((resolve) => { setTimeout(resolve, 5); });
  expect(latest(path)?.state).toBe('dispatching');
}

const target = (path: string, nowMs: number) => ({ wljRunId: RUN, storePath: path, repo: REPO, nowMs });

describe('wonderland dispatching recovery', () => {
  it('G4: a claim stuck in dispatching past the threshold is reported, not resolved: no GitHub read and no byte of the store or journal changes', async () => {
    await withStore(async (path) => {
      await stuckInDispatching(path);
      const before = storeBytes(path);
      const gh = fakeGh(world({ spent: 'present', tagDate: LATE, runs: [{ databaseId: Number(WORKFLOW_RUN), attempt: 1 }] }));
      const recovery = createWonderlandDispatchingRecovery({ spawn: gh.spawn });
      const view = await recovery.check(target(path, WHEN_MS + DISPATCHING_STUCK_MS + 1_000));
      expect(view).toMatchObject({ recovery: 'operator_reconcile_required', reason: 'dispatching_stuck', workflowRunId: null });
      expect(gh.calls).toEqual([]);
      expect(storeBytes(path)).toEqual(before);
      // The founder's reconcile (the claim core, not this view) is what moves it, from GitHub evidence.
      const reconciled = await tool(path, gh.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: RUN, repo: REPO });
      expect(reconciled.ok).toBe(true);
      expect(latest(path)).toMatchObject({ state: 'dispatched', workflowRunId: WORKFLOW_RUN, startKeyHash: START.startKeyHash });
      expect(workflowRuns(gh.calls)).toEqual([]);
    });
  });

  it('G4: under the threshold nothing is read and nothing is written (a Start may still be running)', async () => {
    await withStore(async (path) => {
      await stuckInDispatching(path);
      const before = storeBytes(path);
      const gh = fakeGh(world({ spent: 'present', tagDate: LATE, runs: [{ databaseId: Number(WORKFLOW_RUN), attempt: 1 }] }));
      const recovery = createWonderlandDispatchingRecovery({ spawn: gh.spawn });
      const view = await recovery.check(target(path, WHEN_MS + DISPATCHING_STUCK_MS - 1_000));
      expect(view.recovery).toBe('none');
      expect(gh.calls).toEqual([]);
      expect(storeBytes(path)).toEqual(before);
    });
  });

  it('G4: a gh workflow run that timed out, was killed or never started is reported at once as outcome-unknown, and nothing is written', async () => {
    for (const failure of ['timeout', 'signal', 'spawn_failed'] as const) {
      await withStore(async (path) => {
        const first = await tool(path, fakeGh(world({ dispatch: { code: 1, stdout: '', stderr: '', failure } })).spawn).claim(claimInput);
        expect(first.ok).toBe(false);
        expect(latest(path)).toMatchObject({ state: 'dispatching', dispatchAttempted: true });
        const error = latest(path)?.dispatchError;
        const before = storeBytes(path);
        const gh = fakeGh(world({ spent: 'present', tagDate: LATE, runs: [{ databaseId: Number(WORKFLOW_RUN), attempt: 1 }] }));
        const view = await createWonderlandDispatchingRecovery({ spawn: gh.spawn }).check(target(path, WHEN_MS + 1_000));
        expect(view).toMatchObject({ recovery: 'operator_reconcile_required', reason: error, outcomeUnknown: true });
        expect(gh.calls).toEqual([]);
        expect(storeBytes(path)).toEqual(before);
      });
    }
  });

  it('G5: a dispatched claim with a null workflowRunId (gh < 2.87.0 printed no URL) is bound by dispatch key, in memory only', async () => {
    await withStore(async (path) => {
      const old = fakeGh(world({ dispatch: { code: 0, stdout: '', stderr: '' } }));
      const claimed = await tool(path, old.spawn).claim(claimInput);
      expect(claimed.ok && claimed.record.state === 'dispatched' && claimed.record.workflowRunId === null).toBe(true);
      const before = JSON.stringify(readAdmissionDocument(path).claims);
      const gh = fakeGh(world({ runs: [{ databaseId: Number(WORKFLOW_RUN), attempt: 1 }] }));
      const recovery = createWonderlandDispatchingRecovery({ spawn: gh.spawn });
      const view = await recovery.check(target(path, WHEN_MS + 1_000));
      expect(view).toMatchObject({ recovery: 'none', workflowRunId: WORKFLOW_RUN, workflowRunIdSource: 'dispatch_key' });
      expect(recovery.boundRunId(RUN)).toBe(WORKFLOW_RUN);
      expect(gh.calls.map((args) => args.slice(0, 2))).toEqual([['run', 'list']]);
      expect(JSON.stringify(readAdmissionDocument(path).claims)).toBe(before);
    });
  });

  it('G5: two runs for the key, or a re-run attempt, are not bound', async () => {
    for (const runs of [[{ databaseId: 1, attempt: 1 }, { databaseId: 2, attempt: 1 }], [{ databaseId: Number(WORKFLOW_RUN), attempt: 2 }]]) {
      await withStore(async (path) => {
        await tool(path, fakeGh(world({ dispatch: { code: 0, stdout: '', stderr: '' } })).spawn).claim(claimInput);
        const gh = fakeGh(world({ runs }));
        const recovery = createWonderlandDispatchingRecovery({ spawn: gh.spawn });
        const view = await recovery.check(target(path, WHEN_MS + 1_000));
        expect(view.workflowRunId).toBeNull();
        expect(view.recovery).toBe('operator_reconcile_required');
      });
    }
  });

  describe('G8: gh workflow run exited non-zero (gh_workflow_run_failed) is read as OUTCOME-UNKNOWN', () => {
    const ghFailed = async (path: string) => {
      const first = await tool(path, fakeGh(world({ dispatch: { code: 1, stdout: '', stderr: 'HTTP 502' } })).spawn).claim(claimInput);
      expect(first.ok).toBe(false);
      expect(latest(path)).toMatchObject({ state: 'dispatch_failed', dispatchError: 'gh_workflow_run_failed' });
    };

    it('a verified spent tag reads RUN_ID_ALREADY_SPENT, binds the run by key, and never dispatches', async () => {
      await withStore(async (path) => {
        await ghFailed(path);
        const gh = fakeGh(world({ spent: 'present', tagDate: LATE, runs: [{ databaseId: Number(WORKFLOW_RUN), attempt: 1 }] }));
        const recovery = createWonderlandDispatchingRecovery({ spawn: gh.spawn });
        const view = await recovery.check(target(path, WHEN_MS + 60_000));
        expect(view).toMatchObject({ recovery: 'operator_reconcile_required', spentTag: 'RUN_ID_ALREADY_SPENT', outcomeUnknown: true, workflowRunId: WORKFLOW_RUN });
        expect(workflowRuns(gh.calls)).toEqual([]);
        expect(latest(path)?.state).toBe('dispatch_failed');
      });
    });

    it('a tag that names no run reads SPENT_TAG_UNVERIFIED', async () => {
      await withStore(async (path) => {
        await ghFailed(path);
        const gh = fakeGh(world({ spent: 'present_unverified', tagDate: LATE }));
        const view = await createWonderlandDispatchingRecovery({ spawn: gh.spawn }).check(target(path, WHEN_MS + 60_000));
        expect(view).toMatchObject({ recovery: 'operator_reconcile_required', spentTag: 'SPENT_TAG_UNVERIFIED', outcomeUnknown: true });
        expect(workflowRuns(gh.calls)).toEqual([]);
      });
    });

    it('an unreadable tag, or no run yet within the grace period, stays unknown', async () => {
      for (const over of [{ spent: 'unreadable' as const }, { spent: 'absent' as const, tagDate: EARLY, runs: [] }]) {
        await withStore(async (path) => {
          await ghFailed(path);
          const gh = fakeGh(world(over));
          const view = await createWonderlandDispatchingRecovery({ spawn: gh.spawn }).check(target(path, WHEN_MS + 60_000));
          expect(view).toMatchObject({ recovery: 'reconciling', outcomeUnknown: true });
          expect(workflowRuns(gh.calls)).toEqual([]);
        });
      }
    });

    it('no tag and no run past the grace period on GitHub\'s clock: known not run', async () => {
      await withStore(async (path) => {
        await ghFailed(path);
        const gh = fakeGh(world({ spent: 'absent', tagDate: LATE, runs: [] }));
        const view = await createWonderlandDispatchingRecovery({ spawn: gh.spawn }).check(target(path, WHEN_MS + 60 * 60_000));
        expect(view).toMatchObject({ recovery: 'none', outcomeUnknown: false, spentTag: 'absent', reason: 'workflow_run_absent' });
      });
    });
  });

  it('the read-only gh refuses a workflow run and any api write before it reaches gh, and passes the reads', async () => {
    const calls: string[][] = [];
    const inner: AwaitableGhSpawner = { run: (args) => { calls.push([...args]); return Promise.resolve({ code: 0, stdout: 'ok', stderr: '' }); } };
    const read = readOnlyGhSpawner(inner);
    for (const args of [
      ['workflow', 'run', PAID_WORKFLOW_FILE, '--repo', REPO],
      ['api', '-X', 'POST', `repos/${REPO}/git/refs`],
      ['api', '--method', 'DELETE', `repos/${REPO}/git/refs/tags/x`],
      ['api', `repos/${REPO}/git/refs`, '-f', 'ref=refs/tags/x'],
      ['api', `repos/${REPO}/git/refs`, '--input', 'body.json'],
      ['run', 'rerun', WORKFLOW_RUN],
    ]) {
      expect(await read.run(args)).toMatchObject({ code: 1, stderr: 'refused: recovery reads only' });
    }
    expect(calls).toEqual([]);
    expect(await read.run(paidRunListArgs(REPO))).toMatchObject({ code: 0 });
    expect(await read.run(spentTagApiArgs(REPO, RUN))).toMatchObject({ code: 0 });
    expect(await read.run(['api', `repos/${REPO}/git/tags/${'c'.repeat(40)}`])).toMatchObject({ code: 0 });
    expect(calls).toHaveLength(3);
  });

  it('the read-only gh is an allow-list: a method or a body in any spelling, an extra token, or another read is refused', async () => {
    const calls: string[][] = [];
    const read = readOnlyGhSpawner({ run: (args) => { calls.push([...args]); return { code: 0, stdout: '', stderr: '' }; } });
    const tagRef = [...spentTagApiArgs(REPO, RUN)];
    const tagObject = ['api', `repos/${REPO}/git/tags/${'c'.repeat(40)}`];
    const runList = [...paidRunListArgs(REPO)];
    const writes = [
      ['-X', 'POST'], ['-XPOST'], ['-X=POST'], ['-xPOST'], ['--method', 'POST'], ['--method=POST'], ['--method=GET'], ['-X', 'GET'],
      ['-f', 'ref=refs/tags/x'], ['-fref=refs/tags/x'], ['-F', 'sha=@sha'], ['-Fsha=1'], ['--field', 'a=b'], ['--field=a=b'],
      ['--raw-field', 'a=b'], ['--raw-field=a=b'], ['--input', 'body.json'], ['--input=body.json'], ['--input', '-'],
      ['-H', 'X-HTTP-Method-Override: DELETE'], ['--paginate'],
    ];
    const refused: string[][] = [];
    // The path itself, for each of the three reads: a query, a trailing newline, a prefix, uppercase hex, `.`/`..` repos.
    const TAG_HEX = tagRef[2].slice(tagRef[2].lastIndexOf('-') + 1);
    const SHA = 'c'.repeat(40);
    const runListWith = (repo: string) => runList.map((token, index) => (index === 3 ? repo : token));
    for (const [path, build] of [
      [tagRef[2], (p: string) => ['api', '--include', p]],
      [tagObject[1], (p: string) => ['api', p]],
    ] as const) {
      refused.push(build(`${path}?x=y`), build(`${path}\n`), build(`/${path}`), build(`x${path}`), build(`api/${path}`));
      for (const repo of ['./x', '../x', 'x/.', 'x/..', '.x/..']) refused.push(build(path.replace(REPO, repo)));
    }
    refused.push(
      ['api', '--include', tagRef[2].replace(TAG_HEX, TAG_HEX.toUpperCase())],
      ['api', '--include', tagRef[2].replace(TAG_HEX, `${TAG_HEX.slice(0, -1)}A`)],
      ['api', `repos/${REPO}/git/tags/${SHA.toUpperCase()}`],
      ['api', `repos/${REPO}/git/tags/${SHA.slice(0, -1)}C`],
      runListWith(`${REPO}?x=y`), runListWith(`${REPO}\n`), runListWith(`/${REPO}`),
      runListWith('./x'), runListWith('../x'), runListWith('x/.'), runListWith('x/..'),
    );
    expect(TAG_HEX).toMatch(/^[0-9a-f]{32}$/u);
    for (const extra of writes) {
      refused.push([...tagRef, ...extra], [...tagRef.slice(0, 1), ...extra, ...tagRef.slice(1)], [...tagObject, ...extra], [tagObject[0], ...extra, tagObject[1]], [...runList, ...extra]);
    }
    refused.push(
      ['workflow', 'run', PAID_WORKFLOW_FILE, '--repo', REPO],
      ['run', 'rerun', WORKFLOW_RUN],
      ['run', 'cancel', WORKFLOW_RUN],
      ['run', 'view', WORKFLOW_RUN, '--repo', REPO],
      ['run', 'list', '--repo', REPO],
      ['api', 'graphql', '-f', 'query=mutation{x}'],
      ['api', `repos/${REPO}/git/refs`],
      ['api', '--include', `repos/${REPO}/git/ref/tags/x`],
      ['api', '--include', 'repos/../x/git/ref/tags/julius-run-spent-' + HEX],
      ['api', `repos/${REPO}/git/tags/${'c'.repeat(39)}`],
      [],
    );
    for (const args of refused) {
      expect(await read.run(args), args.join(' ')).toMatchObject({ code: 1, stderr: 'refused: recovery reads only' });
    }
    expect(calls).toEqual([]);
  });

  it('poke never waits, runs one check at a time, and throttles', async () => {
    await withStore(async (path) => {
      await tool(path, fakeGh(world({ dispatch: { code: 0, stdout: '', stderr: '' } })).spawn).claim(claimInput);
      const gh = fakeGh(world({ runs: [{ databaseId: Number(WORKFLOW_RUN), attempt: 1 }] }));
      const recovery = createWonderlandDispatchingRecovery({ spawn: gh.spawn, recheckMs: 15_000 });
      recovery.poke(target(path, WHEN_MS));
      recovery.poke(target(path, WHEN_MS));
      expect(recovery.view(RUN).checkedAtMs).toBeNull();
      await recovery.check(target(path, WHEN_MS));
      recovery.poke(target(path, WHEN_MS + 1_000));
      expect(gh.calls.filter((args) => args[0] === 'run')).toHaveLength(1);
      expect(recovery.view(RUN).workflowRunId).toBe(WORKFLOW_RUN);
    });
  });
});

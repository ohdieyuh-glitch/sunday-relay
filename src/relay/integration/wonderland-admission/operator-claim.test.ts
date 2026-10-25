import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AWAITING_OPERATOR_WINDOW_MS, PAID_WORKFLOW_FILE } from './admission-contract';
import { ADMISSION_LOCK_WAIT_MS, admissionWriteLockPath, createFileAdmissionLedger, openAdmissionFile, readAdmissionDocument, noteAwaitingOperatorExpiry, recordAdmissionOwner, AdmissionFileClosedError, isAdmissionFileClosed } from './admission-file';
import { createWonderlandAdmissionStore, type AdmissionRequest } from './admission-store';
import { runOperatorClaimCli } from './operator-claim-cli';
import {
  OPERATOR_DISPATCH_CONFIRMATION,
  WORKFLOW_RUN_ID_INPUT,
  DISPATCH_INPUTS,
  undeclaredDispatchInputs,
  concurrencyGroupName,
  createOperatorClaimTool,
  formatGhCommand,
  interpretSpentTagResponse,
  interpretWorkflowHalt,
  learnWorkflowRunId,
  spentTagApiArgs,
  spentTagName,
  workflowDeclaresRunIdInput,
  workflowDispatchArgs,
  workflowDispatchInputNames,
  githubDateFromResponse,
  legalTransition,
  spentTagWorkflowRunId,
  grantedLanes,
  LANE_GRANT_SOURCE,
  mainContentsArgs,
  missionContractPath,
  paidRunListArgs,
  parseLaneGrants,
  type ClaimInput,
  type GhResult,
  type GhSpawner,
} from './operator-claim';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const OTHER = 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const KEY = 'a'.repeat(64);
const SERVER = RUN;
const OTHER_SERVER = OTHER;
const WHEN = '2026-10-23T17:18:00.000Z';
const REPO = 'founder/sunday-relay';
const LANE = 'lab';
const MISSION = 'julius-inworld-data-1';
const HEX = '0b7a1c2e4f3d4a6b8c2d3e4f5a6b7c8d';
const LEGACY_HEX = 'a'.repeat(24);
const LEGACY_SERVER = `run:${LEGACY_HEX}`;

const WORKFLOW_WITH_INPUT = `
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
`;

const WORKFLOW_WITHOUT_INPUT = `
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
`;

/** GitHub's clock on the spent-tag read, as `gh api --include` prints it, and as the claim stores it. */
const GITHUB_DATE_HEADER = 'Fri, 23 Oct 2026 17:18:05 GMT';
const GITHUB_DATE = '2026-10-23T17:18:05Z';
const ABSENT: GhResult = {
  code: 1,
  stdout: `HTTP/2.0 404 Not Found\nDate: ${GITHUB_DATE_HEADER}\n\n{"message":"Not Found"}\n`,
  stderr: '',
};
const PRESENT: GhResult = {
  code: 0,
  stdout: `HTTP/2.0 200 OK\nDate: ${GITHUB_DATE_HEADER}\n\n{"ref":"refs/tags/julius-run-spent-${HEX}","object":{"type":"commit","sha":"${'ab'.repeat(20)}"}}\n`,
  stderr: '',
};
const WORKFLOW_OK: GhResult = { code: 0, stdout: '', stderr: '' };
const WORKFLOW_FAIL: GhResult = { code: 1, stdout: '', stderr: '' };

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
    serverRunId: SERVER,
    repo: REPO,
    lane: LANE,
    workflowSource: WORKFLOW_WITH_INPUT,
    dispatch: false,
    confirmation: null,
    ...over,
  };
}

function claimTool(path: string, spawn: GhSpawner, nowIso: () => string = () => WHEN) {
  return createOperatorClaimTool(openAdmissionFile(path), spawn, { nowIso });
}

/**
 * PR #459's lane grant (`DEFAULT_LANES` and `MISSION_LANES`, verbatim) and the
 * J1 contract's namespace, generated from the git objects, never hand-copied.
 */
const PR459_LANES = JSON.parse(readFileSync(join(__dirname, 'fixtures/pr459-lane-grants.json'), 'utf8')) as {
  readonly sourceCommit: string;
  readonly checkerBlob: string;
  readonly checkerSha256: string;
  readonly laneGrantExcerpt: string;
  readonly contractBlob: string;
  readonly contractMarkerNamespace: string;
};

/** What `main` serves. A field set to null is a file `main` does not have. */
interface MainFiles {
  readonly workflow?: string | null;
  readonly contract?: string | null;
  readonly checker?: string | null;
}

const CONTENTS = `repos/${REPO}/contents/`;

/** Serve `gh api .../contents/<path>?ref=main` from `main`; hand every other call to `spawn`. */
function servingMain(spawn: GhSpawner, main: MainFiles = {}): GhSpawner {
  const pick = (key: keyof MainFiles, fallback: string): string | null => (key in main ? main[key] ?? null : fallback);
  return {
    run(args) {
      const target = args.find((arg) => arg.startsWith(CONTENTS));
      if (args[0] !== 'api' || target === undefined) return spawn.run(args);
      const path = target.slice(CONTENTS.length).replace(/\?ref=main$/u, '');
      const text = path === `.github/workflows/${PAID_WORKFLOW_FILE}`
        ? pick('workflow', WORKFLOW_WITH_INPUT)
        : path === missionContractPath(MISSION)
          ? pick('contract', JSON.stringify({ markerNamespace: PR459_LANES.contractMarkerNamespace }))
          : path === LANE_GRANT_SOURCE ? pick('checker', PR459_LANES.laneGrantExcerpt) : null;
      return text === null ? { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' } : { code: 0, stdout: text, stderr: '' };
    },
  };
}

function recorder(behavior: (args: readonly string[]) => GhResult, main: MainFiles = {}): { spawn: GhSpawner; calls: string[][] } {
  const calls: string[][] = [];
  const served = servingMain({ run: (args) => behavior(args) }, main);
  return {
    calls,
    spawn: {
      run(args) {
        const copy = [...args];
        calls.push(copy);
        return served.run(copy);
      },
    },
  };
}

function scripted(api: GhResult, workflow: GhResult, main: MainFiles = {}): { spawn: GhSpawner; calls: string[][] } {
  return recorder((args) => {
    if (args[0] === 'api') return api;
    if (args[0] === 'workflow') return workflow;
    return { code: 99, stdout: '', stderr: '' };
  }, main);
}

/** Each gh call by what it is: a read at `main`, the spent-tag read, or the workflow run. */
function ghKinds(calls: readonly (readonly string[])[]): string[] {
  return calls.map((args) => {
    if (args[0] !== 'api') return args[0] ?? '';
    return args.some((arg) => arg.startsWith(CONTENTS)) ? 'main' : 'tag';
  });
}

/** A dispatch reads the workflow, the mission contract and the lane grant at main, in that order. */
const MAIN_READS = ['main', 'main', 'main'] as const;

function dispatchCall(calls: readonly (readonly string[])[]): readonly string[] | undefined {
  return calls.find((args) => args[0] === 'workflow');
}

async function withStore(run: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'wlj-claim-'));
  try {
    await run(join(dir, 'admission.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function admit(path: string): Promise<void> {
  const admitted = await createWonderlandAdmissionStore({
    ledger: openAdmissionFile(path).ledger,
    dailyCap: 2,
    missionCap: 2,
  }).admit(request());
  if (!admitted.ok) throw new Error('expected an admission');
}

function expectedCommand(): string {
  return formatGhCommand(workflowDispatchArgs({
    repo: REPO,
    mission: MISSION,
    lane: LANE,
    dispatchKey: KEY,
    serverRunId: SERVER,
  }));
}

/**
 * Generated from the git object of PR #459's workflow, never hand-copied. The
 * file names its source commit, blob id, and sha256, and how to regenerate it.
 */
const PR459_INPUTS = JSON.parse(readFileSync(join(__dirname, 'fixtures/pr459-workflow-dispatch-inputs.json'), 'utf8')) as {
  readonly sourceCommit: string;
  readonly sourceBlob: string;
  readonly sourceSha256: string;
  readonly workflowDispatchInputs: readonly string[];
};

/** A workflow that declares exactly the fixture's inputs, so a claim reads #459's surface. */
function workflowFromFixture(names: readonly string[]): string {
  return [
    'name: fixture',
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    ...names.flatMap((name) => [`      ${name}:`, `        description: '${name}'`, '        required: false', "        default: ''"]),
    'jobs: {}',
    '',
  ].join('\n');
}

describe('workflow inputs', () => {
  it('the fixture is PR #459\'s declared workflow_dispatch inputs, and it declares run_id, not server_run_id', () => {
    expect(PR459_INPUTS.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(PR459_INPUTS.sourceBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(PR459_INPUTS.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PR459_INPUTS.workflowDispatchInputs).toContain(WORKFLOW_RUN_ID_INPUT);
    expect(PR459_INPUTS.workflowDispatchInputs).not.toContain('server_run_id');
    expect(WORKFLOW_RUN_ID_INPUT).toBe('run_id');
    for (const name of DISPATCH_INPUTS) expect(PR459_INPUTS.workflowDispatchInputs, name).toContain(name);
    expect(undeclaredDispatchInputs(workflowFromFixture(PR459_INPUTS.workflowDispatchInputs))).toEqual([]);
  });

  it('drift: the in-tree paid workflow either matches the #459 fixture or the claim refuses before the spent tag is read', async () => {
    const source = readFileSync(join(__dirname, '../../../../.github/workflows/julius-first-live-mission.yml'), 'utf8');
    const names = workflowDispatchInputNames(source);
    if (names.includes(WORKFLOW_RUN_ID_INPUT)) {
      // #459 has landed in this tree: its inputs must be exactly the fixture's,
      // so a later workflow change breaks this test, not the paid dispatch.
      expect(names).toEqual(PR459_INPUTS.workflowDispatchInputs);
      expect(undeclaredDispatchInputs(source)).toEqual([]);
      return;
    }
    // #459 has not landed in this tree: the claim tool must refuse to dispatch.
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK, { workflow: source });
      const claims = claimTool(path, fake.spawn);
      for (const input of [
        claimInput({ workflowSource: source }),
        claimInput({ workflowSource: source, dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }),
      ]) {
        const refused = await claims.claim(input);
        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.kind).toBe('workflow_run_id_input_missing');
        expect(refused.record?.state).toBe('admitted');
      }
      // The dry run reads nothing; the dispatch reads only the workflow at main.
      expect(ghKinds(fake.calls)).toEqual(['main']);
      expect(readAdmissionDocument(path).claims).toEqual([]);
    });
  });

  it('the dispatch argv carries run_id, mission, lane, dispatch_key, and confirm_live only with the confirmation', async () => {
    const base = { repo: REPO, mission: MISSION, lane: LANE, dispatchKey: KEY, serverRunId: SERVER };
    expect(workflowDispatchArgs({ ...base, confirmLive: true })).toEqual([
      'workflow', 'run', PAID_WORKFLOW_FILE,
      '--repo', REPO, '--ref', 'main',
      '-f', `mission=${MISSION}`,
      '-f', `lane=${LANE}`,
      '-f', `dispatch_key=${KEY}`,
      '-f', `confirm_live=${OPERATOR_DISPATCH_CONFIRMATION}`,
      '-f', `run_id=${SERVER}`,
    ]);
    const unconfirmed = workflowDispatchArgs(base);
    expect(unconfirmed.some((arg) => arg.startsWith('confirm_live='))).toBe(false);
    expect(unconfirmed.some((arg) => arg.startsWith('server_run_id='))).toBe(false);
    expect(unconfirmed).toContain(`run_id=${SERVER}`);
    const workflow = workflowFromFixture(PR459_INPUTS.workflowDispatchInputs);
    await withStore(async (path) => {
      await admit(path);
      const dry = await claimTool(path, { run() { throw new Error('spawned'); } }).claim(claimInput({ workflowSource: workflow }));
      expect(dry.ok && dry.command).toBe(formatGhCommand(unconfirmed));
      const dryConfirmed = await claimTool(path, { run() { throw new Error('spawned'); } }).claim(claimInput({
        workflowSource: workflow,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(dryConfirmed.ok && dryConfirmed.command).toBe(formatGhCommand(workflowDispatchArgs({ ...base, confirmLive: true })));
      const fake = scripted(ABSENT, WORKFLOW_OK, { workflow });
      const live = await claimTool(path, fake.spawn).claim(claimInput({
        workflowSource: workflow,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(live.ok && live.dispatchedWorkflow).toBe(true);
      expect(dispatchCall(fake.calls)).toEqual(workflowDispatchArgs({ ...base, confirmLive: true }));
    });
  });

  it('refuses to claim or dispatch when the workflow on main lacks run_id, reading nothing past it', async () => {
    const withoutRunId = workflowFromFixture(PR459_INPUTS.workflowDispatchInputs.filter((name) => name !== WORKFLOW_RUN_ID_INPUT));
    const withServerRunId = workflowFromFixture([
      ...PR459_INPUTS.workflowDispatchInputs.filter((name) => name !== WORKFLOW_RUN_ID_INPUT),
      'server_run_id',
    ]);
    for (const workflowSource of [withoutRunId, withServerRunId, WORKFLOW_WITHOUT_INPUT]) {
      await withStore(async (path) => {
        await admit(path);
        const fake = scripted(ABSENT, WORKFLOW_OK, { workflow: workflowSource });
        const refused = await claimTool(path, fake.spawn).claim(claimInput({
          workflowSource,
          dispatch: true,
          confirmation: OPERATOR_DISPATCH_CONFIRMATION,
        }));
        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.kind).toBe('workflow_run_id_input_missing');
        expect(refused.requiredInput).toContain('      run_id:');
        expect(ghKinds(fake.calls)).toEqual(['main']);
        expect(readAdmissionDocument(path).claims).toEqual([]);
      });
    }
    await withStore(async (path) => {
      await admit(path);
      const noKey = workflowFromFixture(PR459_INPUTS.workflowDispatchInputs.filter((name) => name !== 'dispatch_key'));
      const fake = scripted(ABSENT, WORKFLOW_OK, { workflow: noKey });
      const refused = await claimTool(path, fake.spawn).claim(claimInput({
        workflowSource: noKey,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(refused.ok === false && refused.kind).toBe('workflow_dispatch_input_missing');
      expect(ghKinds(fake.calls)).toEqual(['main']);
    });
  });

  it('a description that mentions the name is not a declaration', () => {
    const decoy = `
on:
  workflow_dispatch:
    inputs:
      confirm_live:
        description: 'server_run_id: must not count'
jobs:
  paid:
    steps:
      - run: echo server_run_id
`;
    expect(workflowDispatchInputNames(decoy)).toEqual(['confirm_live']);
    expect(workflowDeclaresRunIdInput(WORKFLOW_WITH_INPUT)).toBe(true);
  });
});

describe('spent tag', () => {
  it('names a 32-hex lock for a wlj id and a 24-hex lock for a legacy id', () => {
    expect(HEX).toMatch(/^[0-9a-f]{32}$/);
    expect(spentTagName(SERVER)).toBe(`julius-run-spent-${HEX}`);
    expect(concurrencyGroupName(SERVER)).toBe(`julius-paid-${HEX}`);
    expect(spentTagApiArgs(REPO, SERVER)).toEqual([
      'api', '--include', `repos/${REPO}/git/ref/tags/julius-run-spent-${HEX}`,
    ]);
    expect(spentTagApiArgs(REPO, SERVER).join(' ')).not.toContain('run:');
    expect(spentTagName(LEGACY_SERVER)).toBe(`julius-run-spent-${LEGACY_HEX}`);
    expect(concurrencyGroupName(LEGACY_SERVER)).toBe(`julius-paid-${LEGACY_HEX}`);
    const spentTagSource = readFileSync(join(__dirname, 'operator-claim.ts'), 'utf8');
    const spentTagFn = spentTagSource.slice(
      spentTagSource.indexOf('export function spentTagName'),
      spentTagSource.indexOf('export function concurrencyGroupName'),
    );
    expect(spentTagFn).toContain('deriveJuliusSpentTag');
    expect(spentTagFn).not.toMatch(/\[0-9a-f\]\{24\}/);
    const command = workflowDispatchArgs({
      repo: REPO,
      mission: MISSION,
      lane: LANE,
      dispatchKey: KEY,
      serverRunId: SERVER,
    });
    expect(command).toContain(`run_id=${SERVER}`);
    expect(() => workflowDispatchArgs({
      repo: REPO, mission: MISSION, lane: LANE, dispatchKey: KEY, serverRunId: LEGACY_SERVER,
    })).toThrow('run_id_invalid');
    const refused = [
      HEX,
      LEGACY_HEX,
      `RUN:${LEGACY_HEX}`,
      `run:${'A'.repeat(24)}`,
      `run:${'a'.repeat(23)}`,
      `run:${'a'.repeat(25)}`,
      `run:${'g'.repeat(24)}`,
      'not-an-id',
    ];
    for (const serverRunId of refused) {
      expect(() => spentTagName(serverRunId), serverRunId).toThrow('run_id_invalid');
      expect(() => concurrencyGroupName(serverRunId), serverRunId).toThrow('run_id_invalid');
      expect(() => spentTagApiArgs(REPO, serverRunId), serverRunId).toThrow('run_id_invalid');
      expect(() => workflowDispatchArgs({
        repo: REPO, mission: MISSION, lane: LANE, dispatchKey: KEY, serverRunId,
      }), serverRunId).toThrow('run_id_invalid');
    }
  });

  it('reads a present ref and a 404, and nothing else', () => {
    expect(interpretSpentTagResponse(PRESENT)).toBe('present');
    expect(interpretSpentTagResponse(ABSENT)).toBe('absent');
    expect(interpretSpentTagResponse({ code: 1, stdout: '', stderr: 'temporary failure' })).toBe('unreadable');
  });

  it('maps a visible workflow halt, including one printed on a zero exit', () => {
    expect(interpretWorkflowHalt({ code: 1, stdout: '', stderr: 'RUN_ID_ALREADY_SPENT' })).toBe('RUN_ID_ALREADY_SPENT');
    expect(interpretWorkflowHalt({ code: 0, stdout: 'halt RUN_ID_ALREADY_SPENT\n', stderr: '' })).toBe('RUN_ID_ALREADY_SPENT');
    expect(interpretWorkflowHalt({ code: 1, stdout: 'SPENT_TAG_UNVERIFIED', stderr: '' })).toBe('SPENT_TAG_UNVERIFIED');
    expect(interpretWorkflowHalt({ code: 0, stdout: '', stderr: 'error: SPENT_TAG_UNVERIFIED' })).toBe('SPENT_TAG_UNVERIFIED');
    expect(interpretWorkflowHalt({
      code: 1,
      stdout: 'SPENT_TAG_UNVERIFIED',
      stderr: 'RUN_ID_ALREADY_SPENT',
    })).toBe('RUN_ID_ALREADY_SPENT');
    expect(interpretWorkflowHalt({ code: 1, stdout: 'NOT_RUN_ID_ALREADY_SPENT', stderr: '' })).toBeNull();
    expect(interpretWorkflowHalt(WORKFLOW_FAIL)).toBeNull();
  });
});

describe('operator claim', () => {
  it('claims an admitted record once and a second claim does not dispatch', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const first = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      const second = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(first.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.claimed).toBe(true);
      expect(first.replayed).toBe(false);
      expect(first.dispatchedWorkflow).toBe(true);
      expect(first.record.state).toBe('dispatched');
      expect(first.record.serverRunId).toBe(SERVER);
      expect(first.record.spentTagState).toBe('absent');
      expect(first.record.concurrencyGroup).toBe(`julius-paid-${HEX}`);
      expect(first.record.halt).toBeNull();
      expect(first.record.dispatchAttempted).toBe(true);
      expect(second.replayed).toBe(true);
      expect(second.claimed).toBe(false);
      expect(second.record.state).toBe('dispatched');
      expect(second.command).toBeNull();
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag', 'workflow']);
      expect(dispatchCall(fake.calls)).toEqual([
        'workflow', 'run', PAID_WORKFLOW_FILE,
        '--repo', REPO, '--ref', 'main',
        '-f', `mission=${MISSION}`,
        '-f', `lane=${LANE}`,
        '-f', `dispatch_key=${KEY}`,
        '-f', `confirm_live=${OPERATOR_DISPATCH_CONFIRMATION}`,
        '-f', `run_id=${SERVER}`,
      ]);
    });
  });

  it('a concurrent double claim has one winner', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const input = claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION });
      const [left, right] = await Promise.all([claims.claim(input), claims.claim(input)]);
      const results = [left, right];
      expect(results.filter((result) => result.ok && result.claimed)).toHaveLength(1);
      expect(results.filter((result) => result.ok && result.replayed)).toHaveLength(1);
      expect(ghKinds(fake.calls).filter((kind) => kind === 'tag')).toHaveLength(1);
      expect(fake.calls.filter((args) => args[0] === 'workflow')).toHaveLength(1);
      for (const result of results) {
        if (!result.ok) throw new Error('expected both claims to resolve');
        expect(result.record.state).toBe('dispatched');
        expect(result.record.serverRunId).toBe(SERVER);
        expect(result.record.wonderlandRunId).toBe(RUN);
      }
    });
  });

  it('a mismatched server run id or wlj_ is refused', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const wrongServer = await claims.claim(claimInput({ serverRunId: OTHER_SERVER }));
      const wrongWonderland = await claims.claim(claimInput({ wonderlandRunId: OTHER }));
      expect(wrongServer.ok).toBe(false);
      expect(wrongWonderland.ok).toBe(false);
      if (wrongServer.ok || wrongWonderland.ok) return;
      expect(wrongServer.kind).toBe('server_run_mismatch');
      expect(wrongWonderland.kind).toBe('wonderland_run_mismatch');
      expect(fake.calls).toEqual([]);
      const status = await claims.status(RUN, SERVER);
      expect(status.ok && status.record.state).toBe('admitted');
    });
  });

  it('a document that is not the durable schema fails closed and is left untouched', async () => {
    await withStore(async (path) => {
      const sample = `${JSON.stringify({ version: 1, revision: 1, admissions: [], claims: [] })}\n`;
      writeFileSync(path, sample);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      await expect(claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }))).rejects.toBeInstanceOf(AdmissionFileClosedError);
      expect(readFileSync(path, 'utf8')).toBe(sample);
      expect(fake.calls).toEqual([]);
      try {
        readAdmissionDocument(path);
        throw new Error('corrupt document was read');
      } catch (error) {
        expect(isAdmissionFileClosed(error)).toBe(true);
        if (isAdmissionFileClosed(error)) expect(error.code).toBe('corrupt');
      }
    });
  });

  it('dry-run claims, prints the exact command, and spawns nothing', async () => {
    await withStore(async (path) => {
      await admit(path);
      const claims = claimTool(path, {
        run() { throw new Error('spawned'); },
      });
      const journalBefore = readAdmissionDocument(path);
      const result = await claims.claim(claimInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.claimed).toBe(false);
      expect(result.dispatchedWorkflow).toBe(false);
      expect(result.record.state).toBe('admitted');
      expect(result.record.claimedAt).toBeNull();
      expect(result.record.dispatchAttempted).toBe(false);
      expect(result.command).toBe(expectedCommand());
      expect(result.command?.startsWith(`gh workflow run ${PAID_WORKFLOW_FILE} `)).toBe(true);
      expect(readAdmissionDocument(path)).toEqual(journalBefore);
      expect(readAdmissionDocument(path).claims).toEqual([]);
      const status = await claims.status(RUN, SERVER);
      expect(status.ok && status.record.state).toBe('admitted');
      expect(status.ok && status.phase?.projection.state).toBe('awaiting_operator');
    });
  });

  it('a real --dispatch after a dry run dispatches', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const dry = await claims.claim(claimInput());
      expect(dry.ok && !dry.claimed && !dry.dispatchedWorkflow).toBe(true);
      expect(fake.calls).toEqual([]);
      const live = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(live.ok).toBe(true);
      if (!live.ok) return;
      expect(live.replayed).toBe(false);
      expect(live.dispatchedWorkflow).toBe(true);
      expect(live.record.state).toBe('dispatched');
      expect(live.record.dispatchAttempted).toBe(true);
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag', 'workflow']);
      expect(readAdmissionDocument(path).claims.map((event) => event.state)).toEqual(['dispatching', 'dispatched']);
    });
  });

  it('dispatched is written only after the spawned workflow child returned, and no lock is held while it runs', async () => {
    await withStore(async (path) => {
      await admit(path);
      const seen: { state: string | undefined; lock: boolean; status: string | false }[] = [];
      const spawn: GhSpawner = servingMain({
        run(args) {
          if (args[0] === 'api') return ABSENT;
          const saved = readAdmissionDocument(path);
          seen.push({
            state: saved.claims.at(-1)?.state,
            lock: existsSync(`${path}.lock`),
            status: (() => {
              // A bridge writer can take the lock during the spawn.
              recordAdmissionOwner(path, SERVER, 'founder');
              return 'owner_written';
            })(),
          });
          return WORKFLOW_OK;
        },
      });
      const result = await claimTool(path, spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(seen).toEqual([{ state: 'dispatching', lock: false, status: 'owner_written' }]);
      expect(result.ok && result.record.state).toBe('dispatched');
      const saved = readAdmissionDocument(path);
      expect(saved.claims.map((event) => [event.state, event.dispatchAttempted])).toEqual([['dispatching', false], ['dispatched', true]]);
      expect(saved.admissions[0]?.ownerPlayerId).toBe('founder');
    });
  });

  it('a stop between the reservation and the outcome leaves dispatching: never reported dispatched, never re-spawned', async () => {
    await withStore(async (path) => {
      await admit(path);
      const crashing = recorder((args) => {
        if (args[0] === 'api') return ABSENT;
        throw new Error('operator_process_killed');
      });
      await expect(claimTool(path, crashing.spawn).claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }))).rejects.toThrow('operator_process_killed');
      const saved = readAdmissionDocument(path);
      expect(saved.claims.map((event) => event.state)).toEqual(['dispatching']);
      expect(saved.claims[0]?.dispatchAttempted).toBe(false);
      const again = recorder(() => WORKFLOW_OK);
      const claims = claimTool(path, again.spawn);
      const replayed = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(replayed.ok && replayed.replayed && replayed.record.state).toBe('dispatching');
      expect(again.calls).toEqual([]);
      const status = await claims.status(RUN, SERVER);
      expect(status.ok && status.record.state).toBe('dispatching');
    });
  });

  it('a stored dispatched claim that never spawned (the old dry-run record) fails closed', async () => {
    await withStore(async (path) => {
      await admit(path);
      writeFileSync(`${path}.operator.json`, `${JSON.stringify({
        schemaVersion: 3,
        revision: 1,
        progress: [],
        owners: {},
        claims: [{
          wonderlandRunId: RUN,
          serverRunId: SERVER,
          state: 'dispatched',
          spentTag: `julius-run-spent-${HEX}`,
          spentTagState: 'unknown',
          at: WHEN,
          dispatchAttempted: false,
          dispatchError: null,
          halt: null,
          workflowRunId: null,
        }],
      })}\n`);
      const before = readFileSync(`${path}.operator.json`, 'utf8');
      try {
        readAdmissionDocument(path);
        throw new Error('read a dispatched claim that never spawned');
      } catch (error) {
        expect(isAdmissionFileClosed(error) && error.code).toBe('corrupt');
      }
      const fake = scripted(ABSENT, WORKFLOW_OK);
      await expect(claimTool(path, fake.spawn).claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }))).rejects.toBeInstanceOf(AdmissionFileClosedError);
      expect(fake.calls).toEqual([]);
      expect(readFileSync(`${path}.operator.json`, 'utf8')).toBe(before);
    });
  });

  it('a dispatch failure moves the record to dispatch_failed and does not retry', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_FAIL);
      const claims = claimTool(path, fake.spawn);
      const failed = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.kind).toBe('dispatch_failed');
      expect(failed.record?.state).toBe('dispatch_failed');
      expect(failed.record?.state).not.toBe('admitted');
      const again = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.replayed).toBe(true);
      expect(again.record.state).toBe('dispatch_failed');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag', 'workflow']);
      const saved = readAdmissionDocument(path);
      expect(saved.claims.map((event) => event.state)).toEqual(['dispatching', 'dispatch_failed']);
      expect(saved.claims.some((event) => (event.state as string) === 'admitted')).toBe(false);
      const rows = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion: number; claims?: unknown };
      expect(rows.schemaVersion).toBe(3);
      expect(rows.claims).toBeUndefined();
      const reloaded = claimTool(path, {
        run() { throw new Error('spawned'); },
      });
      const status = await reloaded.status(RUN, SERVER);
      expect(status.ok && status.record.state).toBe('dispatch_failed');
      expect(status.ok && status.record.serverRunId).toBe(SERVER);
      expect(status.ok && status.record.dispatchError).toBe('gh_workflow_run_failed');
      expect(status.ok && status.record.halt).toBeNull();
    });
  });

  it('a visible RUN_ID_ALREADY_SPENT halt is already_spent and is not retried', async () => {
    await withStore(async (path) => {
      await admit(path);
      const halted = { code: 0, stdout: '::error::RUN_ID_ALREADY_SPENT\n', stderr: '' };
      const fake = scripted(ABSENT, halted);
      const claims = claimTool(path, fake.spawn);
      const spent = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(spent.ok).toBe(false);
      if (spent.ok) return;
      expect(spent.kind).toBe('RUN_ID_ALREADY_SPENT');
      expect(spent.record?.state).toBe('already_spent');
      expect(spent.record?.halt).toBe('RUN_ID_ALREADY_SPENT');
      expect(spent.record?.state).not.toBe('admitted');
      expect(spent.record?.dispatchAttempted).toBe(true);
      const again = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(again.ok && again.replayed && again.record.state).toBe('already_spent');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag', 'workflow']);
      const saved = readAdmissionDocument(path);
      expect(saved.claims.map((event) => event.state)).toEqual(['dispatching', 'already_spent']);
      expect(saved.claims.some((event) => (event.state as string) === 'admitted')).toBe(false);
      expect(JSON.parse(readFileSync(path, 'utf8'))).not.toHaveProperty('claims');
    });
  });

  it('a visible SPENT_TAG_UNVERIFIED halt is dispatch_failed and is not retried', async () => {
    await withStore(async (path) => {
      await admit(path);
      const halted = { code: 1, stdout: '', stderr: 'SPENT_TAG_UNVERIFIED\n' };
      const fake = scripted(ABSENT, halted);
      const claims = claimTool(path, fake.spawn);
      const failed = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(failed.ok).toBe(false);
      if (failed.ok) return;
      expect(failed.kind).toBe('SPENT_TAG_UNVERIFIED');
      expect(failed.record?.state).toBe('dispatch_failed');
      expect(failed.record?.halt).toBe('SPENT_TAG_UNVERIFIED');
      expect(failed.record?.dispatchError).toBe('SPENT_TAG_UNVERIFIED');
      expect(failed.record?.state).not.toBe('admitted');
      const again = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(again.ok && again.replayed && again.record.state).toBe('dispatch_failed');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag', 'workflow']);
      const saved = readAdmissionDocument(path);
      expect(saved.admissions[0]?.admissionState).toBe('ADMISSION_HELD');
      expect(saved.claims.at(-1)?.state).toBe('dispatch_failed');
      expect(saved.claims.some((event) => (event.state as string) === 'admitted')).toBe(false);
      expect(JSON.parse(readFileSync(path, 'utf8'))).not.toHaveProperty('claims');
    });
  });

  it('an existing spent tag refuses dispatch and marks already_spent', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(PRESENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const spent = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(spent.ok).toBe(false);
      if (spent.ok) return;
      expect(spent.kind).toBe('RUN_ID_ALREADY_SPENT');
      expect(spent.record?.state).toBe('already_spent');
      expect(spent.record?.spentTag).toBe(`julius-run-spent-${HEX}`);
      expect(spent.record?.spentTagState).toBe('present');
      expect(spent.record?.dispatchAttempted).toBe(false);
      expect(spent.record?.halt).toBe('RUN_ID_ALREADY_SPENT');
      expect(spent.record?.concurrencyGroup).toBe(`julius-paid-${HEX}`);
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag']);
      const again = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(again.ok && again.replayed && again.record.state).toBe('already_spent');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag']);
    });
  });

  it('an absent spent tag is the only case that dispatches', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const result = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(result.ok && result.dispatchedWorkflow).toBe(true);
      if (!result.ok) return;
      expect(result.record.spentTagState).toBe('absent');
      expect(result.record.state).toBe('dispatched');
      expect(result.record.workflowRunId).toBeNull();
      expect(fake.calls.find((args) => args.includes('--include'))).toEqual([
        'api', '--include', `repos/${REPO}/git/ref/tags/julius-run-spent-${HEX}`,
      ]);
      expect(HEX).toHaveLength(32);
      expect(LEGACY_HEX).toHaveLength(24);
      const status = await claims.status(RUN, SERVER);
      expect(status.ok && status.record.spentTagState).toBe('absent');
      expect(status.ok && status.record.serverRunId).toBe(SERVER);
      expect(status.ok && status.record.wonderlandRunId).toBe(RUN);
    });
  });

  it('an unreadable spent tag does not claim and does not dispatch', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted({ code: 1, stdout: '', stderr: 'temporary failure' }, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const result = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe('spent_tag_unreadable');
      expect(result.record?.state).toBe('admitted');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag']);
    });
  });

  it('fixture YAML with run_id dispatches, and fixture YAML without it refuses', async () => {
    expect(workflowDeclaresRunIdInput(WORKFLOW_WITH_INPUT)).toBe(true);
    expect(workflowDeclaresRunIdInput(WORKFLOW_WITHOUT_INPUT)).toBe(false);
    await withStore(async (path) => {
      await admit(path);
      const absent = scripted(ABSENT, WORKFLOW_OK, { workflow: WORKFLOW_WITHOUT_INPUT });
      const claims = claimTool(path, absent.spawn);
      const refused = await claims.claim(claimInput({
        workflowSource: WORKFLOW_WITHOUT_INPUT,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.kind).toBe('workflow_run_id_input_missing');
      expect(refused.record?.state).toBe('admitted');
      expect(ghKinds(absent.calls)).toEqual(['main']);
      const present = scripted(ABSENT, WORKFLOW_OK);
      const allowed = await claimTool(path, present.spawn).claim(claimInput({
        workflowSource: WORKFLOW_WITH_INPUT,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(allowed.ok && allowed.dispatchedWorkflow).toBe(true);
      if (!allowed.ok) return;
      expect(allowed.record.state).toBe('dispatched');
      expect(dispatchCall(present.calls)).toContain(`run_id=${SERVER}`);
    });
  });

  it('the run_id refusal prints what the workflow must declare', async () => {
    await withStore(async (path) => {
      await admit(path);
      const source = WORKFLOW_WITHOUT_INPUT;
      const fake = scripted(ABSENT, WORKFLOW_OK, { workflow: source });
      const claims = claimTool(path, fake.spawn);
      const refused = await claims.claim(claimInput({
        workflowSource: source,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.kind).toBe('workflow_run_id_input_missing');
      expect(refused.requiredInput).toContain('      run_id:');
      expect(refused.requiredInput).not.toContain('server_run_id');
      expect(refused.requiredInput).toContain('^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
      expect(refused.requiredInput).toContain('julius-run-spent-<32hex>');
      // julius-paid-<hex> is not the workflow's concurrency group, and the YAML no longer says it is.
      expect(refused.requiredInput).not.toContain('concurrency group julius-paid');
      expect(refused.requiredInput).toContain('julius-run-spent-<24hex>');
      expect(refused.requiredInput).toContain('RUN_ID_ALREADY_SPENT');
      expect(refused.requiredInput).toContain('SPENT_TAG_UNVERIFIED');
      expect(refused.record?.state).toBe('admitted');
      expect(ghKinds(fake.calls)).toEqual(['main']);
      const dry = await claims.claim(claimInput({ workflowSource: source }));
      expect(dry.ok).toBe(false);
      if (dry.ok) return;
      expect(dry.kind).toBe('workflow_run_id_input_missing');
    });
  });

  it('an expired held phase cannot be claimed or dispatched, and a back-dated clock cannot revive it', async () => {
    const openAt = new Date(Date.parse(WHEN) + AWAITING_OPERATOR_WINDOW_MS).toISOString();
    const expiredAt = new Date(Date.parse(WHEN) + AWAITING_OPERATOR_WINDOW_MS + 1).toISOString();
    const expiryNote = {
      serverRunId: SERVER,
      state: 'failed',
      cause: 'AWAITING_OPERATOR_EXPIRED',
      updatedAt: expiredAt,
    };

    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn, () => openAt);
      const open = await claims.claim(claimInput());
      expect(open.ok).toBe(true);
      if (!open.ok) return;
      expect(open.claimed).toBe(false);
      expect(open.dispatchedWorkflow).toBe(false);
      expect(fake.calls).toEqual([]);
      expect(readAdmissionDocument(path).progress.some((note) => note.cause === 'AWAITING_OPERATOR_EXPIRED')).toBe(false);
    });

    await withStore(async (path) => {
      await admit(path);
      const before = readFileSync(path, 'utf8');
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn, () => expiredAt);
      const dry = await claims.claim(claimInput());
      expect(dry.ok).toBe(false);
      if (dry.ok) return;
      expect(dry.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(dry.record?.state).toBe('admitted');
      const live = await claims.claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(live.ok).toBe(false);
      if (live.ok) return;
      expect(live.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(live.record?.state).toBe('admitted');
      expect(fake.calls).toEqual([]);
      expect(readAdmissionDocument(path).claims).toEqual([]);
      expect(readAdmissionDocument(path).progress).toEqual([expiryNote]);
      expect(readFileSync(path, 'utf8')).toBe(before);
      const stored = JSON.parse(before) as { rows: { state: string }[] };
      expect(stored.rows[0]?.state).toBe('ADMISSION_HELD');

      const revived = claimTool(path, fake.spawn, () => WHEN);
      const again = await revived.claim(claimInput());
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      const againLive = await revived.claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(againLive.ok).toBe(false);
      if (againLive.ok) return;
      expect(againLive.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(fake.calls).toEqual([]);
      expect(readAdmissionDocument(path).claims).toEqual([]);
      expect(readAdmissionDocument(path).progress).toEqual([expiryNote]);
      expect(readFileSync(path, 'utf8')).toBe(before);
    });
  });

  it('dispatch without the exact confirmation does not claim or spawn', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const refused = await claims.claim(claimInput({ dispatch: true, confirmation: 'run live mission' }));
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.kind).toBe('dispatch_confirmation_required');
      expect(refused.record?.state).toBe('admitted');
      expect(fake.calls).toEqual([]);
    });
  });

  it('the store survives a reload', async () => {
    await withStore(async (path) => {
      await admit(path);
      const first = claimTool(path, scripted(ABSENT, WORKFLOW_OK).spawn);
      const claimed = await first.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(claimed.ok && claimed.record.state).toBe('dispatched');
      const second = claimTool(path, {
        run() { throw new Error('spawned'); },
      });
      const status = await second.status(RUN, SERVER);
      expect(status.ok).toBe(true);
      if (!status.ok) return;
      expect(status.record.state).toBe('dispatched');
      expect(status.record.serverRunId).toBe(SERVER);
      expect(status.record.wonderlandRunId).toBe(RUN);
      expect(status.record.spentTag).toBe(`julius-run-spent-${HEX}`);
      expect(status.record.spentTagState).toBe('absent');
      const reloaded = createWonderlandAdmissionStore({
        ledger: openAdmissionFile(path).ledger,
        dailyCap: 2,
        missionCap: 2,
      });
      const replay = await reloaded.admit(request());
      expect(replay.ok && replay.replayed).toBe(true);
      if (!replay.ok) return;
      expect(replay.run.serverRunId).toBe(SERVER);
      expect(reloaded.admissionCount()).toBe(1);
    });
  });

  it('claims and dispatches while the bridge holds the store open, and the bridge keeps writing after', async () => {
    await withStore(async (path) => {
      const bridge = createFileAdmissionLedger(path);
      try {
        const store = createWonderlandAdmissionStore({ ledger: bridge, dailyCap: 2, missionCap: 2 });
        const admitted = await store.admit(request());
        expect(admitted.ok && admitted.run.state).toBe('ADMISSION_HELD');
        recordAdmissionOwner(path, SERVER, 'founder');
        const fake = scripted(ABSENT, WORKFLOW_OK);
        const result = await claimTool(path, fake.spawn).claim(claimInput({
          dispatch: true,
          confirmation: OPERATOR_DISPATCH_CONFIRMATION,
        }));
        expect(result.ok && result.dispatchedWorkflow).toBe(true);
        expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag', 'workflow']);
        const status = await claimTool(path, fake.spawn).status(RUN, SERVER);
        expect(status.ok && status.record.state).toBe('dispatched');
        const second = await store.admit(request({ runId: OTHER, keyHash: 'b'.repeat(64), dispatchId: 'adm_other' }));
        expect(second.ok && second.run.state).toBe('ADMISSION_HELD');
        recordAdmissionOwner(path, OTHER_SERVER, 'founder');
        const saved = readAdmissionDocument(path);
        expect(saved.admissions.map((row) => row.runId)).toEqual([RUN, OTHER]);
        expect(saved.claims.at(-1)?.state).toBe('dispatched');
        expect(saved.admissions.map((row) => row.ownerPlayerId)).toEqual(['founder', 'founder']);
        expect(existsSync(`${path}.lock`)).toBe(false);
        expect(existsSync(`${path}.bridge.lock`)).toBe(true);
      } finally {
        bridge.close();
      }
    });
  });
});

describe('an expiry note is terminal while the row stays held', () => {
  const NOTED_AT = '2026-10-23T17:18:01.000Z';

  function plantExpiredRow(path: string): string {
    const before = readFileSync(path);
    noteAwaitingOperatorExpiry(path, SERVER, NOTED_AT);
    const journalPath = `${path}.operator.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { revision: number; progress: unknown[] };
    journal.progress.push({
      serverRunId: SERVER,
      state: 'held',
      cause: 'still_open',
      updatedAt: '2026-10-23T17:19:00.000Z',
    });
    journal.revision += 1;
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`);
    const row = JSON.parse(before.toString()) as { rows: { state: string }[] };
    expect(row.rows[0]?.state).toBe('ADMISSION_HELD');
    expect(readFileSync(path).equals(before)).toBe(true);
    return before.toString();
  }

  it('workflowDispatchArgs refuses when the journal note is present and the row is still held', async () => {
    await withStore(async (path) => {
      await admit(path);
      const before = plantExpiredRow(path);
      const input = {
        repo: REPO,
        mission: MISSION,
        lane: LANE,
        dispatchKey: KEY,
        serverRunId: SERVER,
      };
      expect(() => workflowDispatchArgs({ ...input, storePath: path })).toThrow('AWAITING_OPERATOR_EXPIRED');
      expect(() => workflowDispatchArgs({
        ...input,
        progress: readAdmissionDocument(path).progress,
      })).toThrow('AWAITING_OPERATOR_EXPIRED');
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(JSON.parse(before).rows[0].state).toBe('ADMISSION_HELD');
    });
  });

  it('the operator claim refuses while the clock is still inside the window', async () => {
    await withStore(async (path) => {
      await admit(path);
      const before = plantExpiredRow(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn, () => WHEN);
      const dry = await claims.claim(claimInput());
      expect(dry.ok).toBe(false);
      if (dry.ok) return;
      expect(dry.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      const live = await claims.claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(live.ok).toBe(false);
      if (live.ok) return;
      expect(live.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(fake.calls).toEqual([]);
      expect(readAdmissionDocument(path).claims).toEqual([]);
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(JSON.parse(before).rows[0].state).toBe('ADMISSION_HELD');
    });
  });

  it('CLI status reports the note as failed while the clock is still inside the window', async () => {
    await withStore(async (path) => {
      await admit(path);
      const before = plantExpiredRow(path);
      const out: string[] = [];
      const code = await runOperatorClaimCli([
        'status', '--store', path, '--wonderland-run', RUN, '--server-run', SERVER,
      ], {
        out: (line) => { out.push(line); },
        err: () => {},
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => WHEN,
        readWorkflow: () => { throw new Error('status reads no workflow'); },
      });
      expect(code).toBe(0);
      const body = JSON.parse(out[0] ?? '{}') as { state: string; cause: string; updatedAt: string; retry: boolean };
      expect(body.state).toBe('failed');
      expect(body.cause).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(body.updatedAt).toBe(NOTED_AT);
      expect(body.retry).toBe(false);
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(JSON.parse(before).rows[0].state).toBe('ADMISSION_HELD');
    });
  });
});

describe('workflow run id', () => {
  const WORKFLOW_RUN = '36568129865';

  function printed(id: string, repo = REPO): GhResult {
    return { code: 0, stdout: `https://github.com/${repo}/actions/runs/${id}\n`, stderr: '' };
  }

  it('learns one workflow run URL for this repo', () => {
    expect(learnWorkflowRunId(printed(WORKFLOW_RUN), REPO)).toBe(WORKFLOW_RUN);
    expect(learnWorkflowRunId(WORKFLOW_OK, REPO)).toBeNull();
    expect(learnWorkflowRunId({
      code: 0,
      stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\nhttps://github.com/${REPO}/actions/runs/4242\n`,
      stderr: '',
    }, REPO)).toBeNull();
    expect(learnWorkflowRunId(printed(WORKFLOW_RUN, 'other/repo'), REPO)).toBeNull();
    expect(learnWorkflowRunId(printed('0'), REPO)).toBeNull();
    expect(learnWorkflowRunId({
      code: 0,
      stdout: `https://github.com/${REPO}/actions/runs/01\n`,
      stderr: '',
    }, REPO)).toBeNull();
    expect(learnWorkflowRunId({
      code: 0,
      stdout: `https://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\nhttps://github.com/${REPO}/actions/runs/${WORKFLOW_RUN}\n`,
      stderr: '',
    }, REPO)).toBe(WORKFLOW_RUN);
  });

  it('stores the id when dispatch prints it, and leaves the claim null until then', async () => {
    await withStore(async (path) => {
      await admit(path);
      const quiet = scripted(ABSENT, WORKFLOW_OK);
      const unknown = await claimTool(path, quiet.spawn).claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(unknown.ok && unknown.record.workflowRunId).toBeNull();
      expect(readAdmissionDocument(path).claims.at(-1)?.workflowRunId).toBeNull();
    });
    await withStore(async (path) => {
      await admit(path);
      const dry = await claimTool(path, { run() { throw new Error('dry-run must not spawn'); } }).claim(claimInput());
      expect(dry.ok && dry.record.workflowRunId).toBeNull();
    });
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, printed(WORKFLOW_RUN));
      const result = await claimTool(path, fake.spawn).claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(result.ok && result.dispatchedWorkflow && result.record.workflowRunId).toBe(WORKFLOW_RUN);
      const saved = readAdmissionDocument(path);
      expect(saved.claims[0]?.workflowRunId).toBeNull();
      expect(saved.claims.at(-1)?.workflowRunId).toBe(WORKFLOW_RUN);
      const status = await claimTool(path, fake.spawn).status(RUN, SERVER);
      expect(status.ok && status.record.workflowRunId).toBe(WORKFLOW_RUN);
      expect(fake.calls[MAIN_READS.length]).toEqual(spentTagApiArgs(REPO, SERVER));
    });
  });

  it('a caller env value does not replace the id printed by the spawned workflow run', async () => {
    const previousRun = process.env.GITHUB_RUN_ID;
    const previousWorkflow = process.env.WORKFLOW_RUN_ID;
    process.env.GITHUB_RUN_ID = '111';
    process.env.WORKFLOW_RUN_ID = '222';
    try {
      await withStore(async (path) => {
        await admit(path);
        const fake = scripted(ABSENT, printed(WORKFLOW_RUN));
        const result = await claimTool(path, fake.spawn).claim(claimInput({
          dispatch: true,
          confirmation: OPERATOR_DISPATCH_CONFIRMATION,
        }));
        expect(result.ok && result.record.workflowRunId).toBe(WORKFLOW_RUN);
        expect(readAdmissionDocument(path).claims.at(-1)?.workflowRunId).toBe(WORKFLOW_RUN);
        expect(JSON.stringify(readAdmissionDocument(path).claims)).not.toContain('111');
        expect(JSON.stringify(readAdmissionDocument(path).claims)).not.toContain('222');
      });
    } finally {
      if (previousRun === undefined) delete process.env.GITHUB_RUN_ID;
      else process.env.GITHUB_RUN_ID = previousRun;
      if (previousWorkflow === undefined) delete process.env.WORKFLOW_RUN_ID;
      else process.env.WORKFLOW_RUN_ID = previousWorkflow;
    }
  });
});

describe('operator claim cli', () => {
  it('dry-run prints the command and does not spawn', async () => {
    await withStore(async (path) => {
      await admit(path);
      const out: string[] = [];
      const code = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
      ], {
        out: (line) => { out.push(line); },
        err: () => {},
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => WHEN,
        readWorkflow: () => WORKFLOW_WITH_INPUT,
      });
      expect(code).toBe(0);
      expect(out.at(-1)).toBe(expectedCommand());
      const body = JSON.parse(out[0] ?? '{}') as { state: string; spentTagState: string; serverRunId: string };
      expect(body.state).toBe('admitted');
      expect(body.spentTagState).toBe('unknown');
      expect(body.serverRunId).toBe(SERVER);
    });
  });

  it('dispatch follows the YAML on main, not the checked-out file: absent refuses, present runs once', async () => {
    await withStore(async (path) => {
      await admit(path);
      const calls: string[][] = [];
      const refusedOut: string[] = [];
      const refused = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
        '--dispatch', '--confirm', OPERATOR_DISPATCH_CONFIRMATION,
      ], {
        out: (line) => { refusedOut.push(line); },
        err: () => {},
      }, {
        spawn: servingMain({ run() { throw new Error('spawned past main'); } }, { workflow: WORKFLOW_WITHOUT_INPUT }),
        nowIso: () => WHEN,
        readWorkflow: () => { throw new Error('a dispatch reads main, not the checkout'); },
      });
      expect(refused).toBe(1);
      expect((JSON.parse(refusedOut[0] ?? '{}') as { kind?: string }).kind).toBe('workflow_run_id_input_missing');
      const code = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
        '--dispatch', '--confirm', OPERATOR_DISPATCH_CONFIRMATION,
      ], {
        out: () => {},
        err: () => {},
      }, {
        spawn: (() => {
          const served = servingMain({ run: (args) => (args[0] === 'api' ? ABSENT : WORKFLOW_OK) });
          return { run(args: readonly string[]) { calls.push([...args]); return served.run(args); } };
        })(),
        nowIso: () => WHEN,
        readWorkflow: () => { throw new Error('a dispatch reads main, not the checkout'); },
      });
      expect(code).toBe(0);
      expect(ghKinds(calls)).toEqual([...MAIN_READS, 'tag', 'workflow']);
      expect(dispatchCall(calls)).toContain(`run_id=${SERVER}`);
    });
  });

  it('status reports the spent-tag state without spawning', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(PRESENT, WORKFLOW_OK);
      await claimTool(path, fake.spawn).claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      const out: string[] = [];
      const code = await runOperatorClaimCli([
        'status', '--store', path, '--wonderland-run', RUN, '--server-run', SERVER,
      ], {
        out: (line) => { out.push(line); },
        err: () => {},
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => WHEN,
        readWorkflow: () => { throw new Error('status reads no workflow'); },
      });
      expect(code).toBe(0);
      const body = JSON.parse(out[0] ?? '{}') as {
        state: string; spentTagState: string; serverRunId: string; spentTag: string;
        concurrencyGroup: string; halt: string; retry: boolean;
      };
      expect(body.state).toBe('already_spent');
      expect(body.spentTagState).toBe('present');
      expect(body.spentTag).toBe(`julius-run-spent-${HEX}`);
      expect(body.concurrencyGroup).toBe(`julius-paid-${HEX}`);
      expect(body.halt).toBe('RUN_ID_ALREADY_SPENT');
      expect(body.serverRunId).toBe(SERVER);
      expect(body.retry).toBe(false);
    });
  });

  it('status reports an expired held phase the same way the HTTP route does', async () => {
    const expiredAt = new Date(Date.parse(WHEN) + AWAITING_OPERATOR_WINDOW_MS + 1).toISOString();
    await withStore(async (path) => {
      await admit(path);
      const before = readFileSync(path, 'utf8');
      const out: string[] = [];
      const code = await runOperatorClaimCli([
        'status', '--store', path, '--wonderland-run', RUN, '--server-run', SERVER,
      ], {
        out: (line) => { out.push(line); },
        err: () => {},
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => expiredAt,
        readWorkflow: () => { throw new Error('status reads no workflow'); },
      });
      expect(code).toBe(0);
      const body = JSON.parse(out[0] ?? '{}') as {
        state: string; cause: string; updatedAt: string; retry: boolean; serverRunId: string;
      };
      expect(body.state).toBe('failed');
      expect(body.cause).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(body.updatedAt).toBe(expiredAt);
      expect(body.retry).toBe(false);
      expect(body.serverRunId).toBe(SERVER);
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(readAdmissionDocument(path).claims).toEqual([]);
      expect(readAdmissionDocument(path).progress).toEqual([{
        serverRunId: SERVER,
        state: 'failed',
        cause: 'AWAITING_OPERATOR_EXPIRED',
        updatedAt: expiredAt,
      }]);

      const fake = scripted(ABSENT, WORKFLOW_OK);
      const revived = claimTool(path, fake.spawn, () => WHEN);
      const dry = await revived.claim(claimInput());
      expect(dry.ok).toBe(false);
      if (dry.ok) return;
      expect(dry.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      const live = await revived.claim(claimInput({
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(live.ok).toBe(false);
      if (live.ok) return;
      expect(live.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(fake.calls).toEqual([]);
      expect(readAdmissionDocument(path).progress).toHaveLength(1);
      expect(readFileSync(path, 'utf8')).toBe(before);

      const laterOut: string[] = [];
      const later = await runOperatorClaimCli([
        'status', '--store', path, '--wonderland-run', RUN, '--server-run', SERVER,
      ], {
        out: (line) => { laterOut.push(line); },
        err: () => {},
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => WHEN,
        readWorkflow: () => { throw new Error('status reads no workflow'); },
      });
      expect(later).toBe(0);
      const laterBody = JSON.parse(laterOut[0] ?? '{}') as { state: string; cause: string; updatedAt: string; retry: boolean };
      expect(laterBody.state).toBe('failed');
      expect(laterBody.cause).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(laterBody.updatedAt).toBe(expiredAt);
      expect(laterBody.retry).toBe(false);
    });
  });

  it('a workflow run id flag is rejected before the store is opened', async () => {
    await withStore(async (path) => {
      await admit(path);
      const before = readFileSync(path, 'utf8');
      let clockReads = 0;
      const err: string[] = [];
      const code = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
        '--workflow-run-id', '36568129865',
      ], {
        out: () => {},
        err: (line) => { err.push(line); },
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => { clockReads += 1; return WHEN; },
        readWorkflow: () => WORKFLOW_WITH_INPUT,
      });
      expect(code).toBe(2);
      expect(clockReads).toBe(0);
      expect(err[0]).toBe('usage');
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(readAdmissionDocument(path).claims).toEqual([]);
    });
  });

  it('a clock flag is rejected before the server clock is read', async () => {
    await withStore(async (path) => {
      await admit(path);
      const before = readFileSync(path, 'utf8');
      let clockReads = 0;
      const err: string[] = [];
      const code = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
        '--now', WHEN,
      ], {
        out: () => {},
        err: (line) => { err.push(line); },
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => { clockReads += 1; return WHEN; },
        readWorkflow: () => WORKFLOW_WITH_INPUT,
      });
      expect(code).toBe(2);
      expect(clockReads).toBe(0);
      expect(err[0]).toBe('usage');
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(readAdmissionDocument(path).claims).toEqual([]);
      expect(readAdmissionDocument(path).progress).toEqual([]);
    });
  });

  it('refuses a remote store path', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runOperatorClaimCli([
      'claim', '--store', 'https://example.test/store',
      '--wonderland-run', RUN, '--server-run', SERVER,
      '--repo', REPO, '--lane', LANE,
    ], {
      out: (line) => { out.push(line); },
      err: (line) => { err.push(line); },
    }, {
      spawn: { run() { throw new Error('spawned'); } },
      nowIso: () => WHEN,
      readWorkflow: () => WORKFLOW_WITH_INPUT,
    });
    expect(code).toBe(1);
    expect(err).toEqual(['operator_store_not_local']);
    expect(out).toEqual([]);
  });
});

describe('the dispatch reads main and the lane grant before anything is written', () => {
  it('the lane-grant fixture is PR #459\'s, and J1 is granted lab only', () => {
    expect(PR459_LANES.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(PR459_LANES.checkerBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(PR459_LANES.checkerSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PR459_LANES.contractMarkerNamespace).toBe(MISSION);
    const grants = parseLaneGrants(PR459_LANES.laneGrantExcerpt);
    expect(grants).not.toBeNull();
    if (grants === null) return;
    expect(grants.defaults).toEqual(['lab']);
    expect(grants.byNamespace.get('julius-continuous-1')).toEqual(['qualification', 'qualification-repair']);
    expect(grants.byNamespace.get('julius-first-live')).toEqual(['regression']);
    expect(grants.byNamespace.has(MISSION)).toBe(false);
    expect(grantedLanes(JSON.stringify({ markerNamespace: MISSION }), grants)).toEqual(['lab']);
    expect(grantedLanes(JSON.stringify({ markerNamespace: 'julius-continuous-1' }), grants)).toEqual(['qualification', 'qualification-repair']);
    expect(grantedLanes(JSON.stringify({}), grants)).toEqual(['lab']);
    expect(grantedLanes('not json', grants)).toBeNull();
    expect(grantedLanes('[]', grants)).toBeNull();
  });

  it('the in-tree checker, when it has a grant table, reads the same as #459\'s', () => {
    const source = readFileSync(join(__dirname, '../../../../', LANE_GRANT_SOURCE), 'utf8');
    if (!source.includes('const MISSION_LANES = ')) return;
    expect(parseLaneGrants(source)).toEqual(parseLaneGrants(PR459_LANES.laneGrantExcerpt));
  });

  it('a grant table this cannot read line by line is no grant', () => {
    const excerpt = PR459_LANES.laneGrantExcerpt;
    for (const garbled of [
      '',
      excerpt.replace("const DEFAULT_LANES = Object.freeze(['lab']);", ''),
      excerpt.replace("Object.freeze(['lab'])", "Object.freeze(['lab', 'vip'])"),
      excerpt.replace("  'julius-first-live': Object.freeze(['regression']),", "  ...EXTRA,"),
      excerpt.replace("  'julius-live-mission-2': Object.freeze(['regression']),", "  'julius-first-live': Object.freeze(['lab']),"),
      `${excerpt}${excerpt}`,
    ]) {
      expect(parseLaneGrants(garbled), garbled.slice(0, 60)).toBeNull();
    }
    expect(parseLaneGrants(excerpt.replaceAll('\n', '\r\n'))).toEqual(parseLaneGrants(excerpt));
  });

  it('reads the workflow, the contract and the grant at main, in that order, before the spent tag', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const result = await claimTool(path, fake.spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(result.ok && result.dispatchedWorkflow).toBe(true);
      expect(fake.calls.slice(0, 3)).toEqual([
        mainContentsArgs(REPO, `.github/workflows/${PAID_WORKFLOW_FILE}`),
        mainContentsArgs(REPO, missionContractPath(MISSION)),
        mainContentsArgs(REPO, LANE_GRANT_SOURCE),
      ]);
      for (const args of fake.calls.slice(0, 3)) expect(args.at(-1)).toMatch(/\?ref=main$/u);
      expect(fake.calls[3]).toEqual(spentTagApiArgs(REPO, SERVER));
    });
  });

  it('main decides, not the checkout: a checkout without run_id still dispatches, a main without it does not', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const result = await claimTool(path, fake.spawn).claim(claimInput({
        workflowSource: WORKFLOW_WITHOUT_INPUT,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(result.ok && result.dispatchedWorkflow).toBe(true);
    });
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted(ABSENT, WORKFLOW_OK, { workflow: WORKFLOW_WITHOUT_INPUT });
      const result = await claimTool(path, fake.spawn).claim(claimInput({
        workflowSource: WORKFLOW_WITH_INPUT,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(result.ok === false && result.kind).toBe('workflow_run_id_input_missing');
      expect(ghKinds(fake.calls)).toEqual(['main']);
      expect(readAdmissionDocument(path).claims).toEqual([]);
    });
  });

  it('a lane the mission is not granted on main is refused before the spent tag is read, and the id is not burned', async () => {
    for (const lane of ['qualification', 'qualification-repair', 'regression']) {
      await withStore(async (path) => {
        await admit(path);
        const fake = scripted(ABSENT, WORKFLOW_OK);
        const claims = claimTool(path, fake.spawn);
        const refused = await claims.claim(claimInput({ lane, dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
        expect(refused.ok === false && refused.kind, lane).toBe('lane_not_granted');
        if (refused.ok) return;
        expect(refused.message).toContain('it may claim lab');
        expect(refused.record?.state).toBe('admitted');
        expect(ghKinds(fake.calls), lane).toEqual(MAIN_READS);
        expect(readAdmissionDocument(path).claims).toEqual([]);
        // The operator can still claim the right lane.
        const allowed = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
        expect(allowed.ok && allowed.dispatchedWorkflow).toBe(true);
      });
    }
  });

  it('a workflow, contract or grant main cannot serve dispatches nothing', async () => {
    const cases: readonly [MainFiles, string, readonly string[]][] = [
      [{ workflow: null }, 'main_workflow_unreadable', ['main']],
      [{ contract: null }, 'lane_grant_unreadable', ['main', 'main']],
      [{ contract: 'not json' }, 'lane_grant_unreadable', MAIN_READS],
      [{ checker: null }, 'lane_grant_unreadable', MAIN_READS],
      [{ checker: 'export {};\n' }, 'lane_grant_unreadable', MAIN_READS],
    ];
    for (const [main, kind, kinds] of cases) {
      await withStore(async (path) => {
        await admit(path);
        const fake = scripted(ABSENT, WORKFLOW_OK, main);
        const refused = await claimTool(path, fake.spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
        expect(refused.ok === false && refused.kind, kind).toBe(kind);
        expect(ghKinds(fake.calls), kind).toEqual(kinds);
        expect(readAdmissionDocument(path).claims).toEqual([]);
      });
    }
  });

  it('the cli --dispatch never reads the checked-out workflow', async () => {
    await withStore(async (path) => {
      await admit(path);
      let localReads = 0;
      const code = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
        '--dispatch', '--confirm', OPERATOR_DISPATCH_CONFIRMATION,
      ], { out: () => {}, err: () => {} }, {
        spawn: scripted(ABSENT, WORKFLOW_OK).spawn,
        nowIso: () => WHEN,
        readWorkflow: () => { localReads += 1; return WORKFLOW_WITHOUT_INPUT; },
      });
      expect(code).toBe(0);
      expect(localReads).toBe(0);
    });
  });
});

describe('the pieces reconcile and the claim stand on', () => {
  const event = (over: Record<string, unknown>) => ({
    wonderlandRunId: RUN, serverRunId: SERVER, spentTag: `julius-run-spent-${HEX}`, at: WHEN,
    state: 'dispatching', spentTagState: 'absent', dispatchAttempted: false, dispatchError: null, halt: null,
    workflowRunId: null, githubDate: GITHUB_DATE, ...over,
  }) as Parameters<typeof legalTransition>[1];

  it('D4: an outcome must keep the reservation\'s GitHub clock', () => {
    const reservation = event({});
    expect(legalTransition(null, reservation)).toBe(true);
    const dispatched = event({ state: 'dispatched', dispatchAttempted: true });
    expect(legalTransition(reservation, dispatched)).toBe(true);
    expect(legalTransition(reservation, event({ state: 'dispatched', dispatchAttempted: true, githubDate: '2026-10-23T17:18:06Z' }))).toBe(false);
    expect(legalTransition(reservation, event({ state: 'dispatched', dispatchAttempted: true, githubDate: null }))).toBe(false);
    const unspent = event({ state: 'dispatch_failed', dispatchAttempted: true, dispatchError: 'workflow_run_unspent' });
    expect(legalTransition(reservation, unspent)).toBe(true);
    expect(legalTransition(reservation, { ...unspent, githubDate: null })).toBe(false);
    expect(legalTransition(null, unspent)).toBe(false);
  });

  it('R8/R9: a tag message with a repeated key or another schema line names no workflow run', () => {
    const tag = (message: string): GhResult => ({ code: 0, stdout: `${JSON.stringify({ message })}\n`, stderr: '' });
    const lines = ['julius-run-spent.v1', `run=${SERVER}`, 'workflow_run_id=36568129865', 'workflow_run_attempt=1'];
    expect(spentTagWorkflowRunId(tag(`${lines.join('\n')}\n`), SERVER)).toBe('36568129865');
    expect(spentTagWorkflowRunId(tag(`${[...lines, 'workflow_run_id=4242'].join('\n')}\n`), SERVER)).toBeNull();
    expect(spentTagWorkflowRunId(tag(`${[...lines, `run=${SERVER}`].join('\n')}\n`), SERVER)).toBeNull();
    for (const schema of ['julius-run-spent.v2', 'JULIUS-RUN-SPENT.V1', ' julius-run-spent.v1', '']) {
      expect(spentTagWorkflowRunId(tag(`${[schema, ...lines.slice(1)].join('\n')}\n`), SERVER), schema).toBeNull();
    }
    expect(spentTagWorkflowRunId(tag(`${lines.join('\n')}\n`), OTHER_SERVER)).toBeNull();
    expect(spentTagWorkflowRunId({ code: 1, stdout: '', stderr: '' }, SERVER)).toBeNull();
  });

  it('L3b: a lane listed twice, in the defaults or a mission\'s grant, is no grant', () => {
    const excerpt = PR459_LANES.laneGrantExcerpt;
    expect(parseLaneGrants(excerpt.replace("Object.freeze(['lab']);", "Object.freeze(['lab', 'lab']);"))).toBeNull();
    expect(parseLaneGrants(excerpt.replace(
      "Object.freeze(['qualification', 'qualification-repair'])",
      "Object.freeze(['qualification', 'qualification'])",
    ))).toBeNull();
  });
});

describe('GitHub\'s clock is the dispatch time the bridge orders against', () => {
  it('reads one IMF-fixdate Date header that names a real instant', () => {
    expect(githubDateFromResponse(ABSENT)).toBe(GITHUB_DATE);
    expect(githubDateFromResponse(PRESENT)).toBe(GITHUB_DATE);
    expect(githubDateFromResponse({ code: 1, stdout: 'HTTP/2.0 404 Not Found\ndate: Fri, 23 Oct 2026 17:18:05 GMT\r\n', stderr: '' })).toBe(GITHUB_DATE);
    for (const stdout of [
      'HTTP/2.0 404 Not Found\n',
      `HTTP/2.0 404 Not Found\nDate: ${GITHUB_DATE_HEADER}\nDate: ${GITHUB_DATE_HEADER}\n`,
      'HTTP/2.0 404 Not Found\nDate: Thu, 23 Oct 2026 17:18:05 GMT\n',
      'HTTP/2.0 404 Not Found\nDate: Fri, 31 Oct 2026 25:18:05 GMT\n',
      'HTTP/2.0 404 Not Found\nDate: 2026-10-23T17:18:05Z\n',
      'HTTP/2.0 404 Not Found\nDate: Fri, 23 Oct 2026 17:18:05 +0000\n',
      'HTTP/2.0 404 Not Found\nX-Date: Fri, 23 Oct 2026 17:18:05 GMT\n',
    ]) {
      expect(githubDateFromResponse({ code: 1, stdout, stderr: '' }), stdout).toBeNull();
    }
  });

  it('stores the spent-tag read\'s Date on the reservation and keeps it on the outcome, never the local clock', async () => {
    await withStore(async (path) => {
      await admit(path);
      const result = await claimTool(path, scripted(ABSENT, WORKFLOW_OK).spawn, () => '2026-10-23T17:30:00.000Z')
        .claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(result.ok && result.dispatchedWorkflow).toBe(true);
      const claims = readAdmissionDocument(path).claims;
      expect(claims.map((event) => [event.state, event.githubDate, event.at])).toEqual([
        ['dispatching', GITHUB_DATE, '2026-10-23T17:30:00.000Z'],
        ['dispatched', GITHUB_DATE, '2026-10-23T17:30:00.000Z'],
      ]);
    });
  });

  it('an absent tag read without a readable Date claims nothing and dispatches nothing', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = scripted({ code: 1, stdout: 'HTTP/2.0 404 Not Found\n{"message":"Not Found"}\n', stderr: '' }, WORKFLOW_OK);
      const refused = await claimTool(path, fake.spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(refused.ok === false && refused.kind).toBe('github_clock_unreadable');
      expect(refused.ok === false && refused.record?.state).toBe('admitted');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag']);
      expect(readAdmissionDocument(path).claims).toEqual([]);
    });
  });
});

describe('the write lock is taken by claim and status', () => {
  it('a held write lock: claim and status wait, then fail lock_held; nothing is written and nothing is spawned', async () => {
    await withStore(async (path) => {
      await admit(path);
      const lock = admissionWriteLockPath(path);
      const foreign = JSON.stringify({ pid: 999_999, purpose: 'wonderland-admission' });
      writeFileSync(lock, foreign, { flag: 'wx', mode: 0o600 });
      const before = readFileSync(path, 'utf8');
      const journalPath = `${path}.operator.json`;
      const journalBefore = existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : null;
      try {
        const fake = scripted(ABSENT, WORKFLOW_OK);
        const claims = claimTool(path, fake.spawn);
        for (const input of [claimInput(), claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION })]) {
          const started = Date.now();
          await expect(claims.claim(input)).rejects.toMatchObject({ code: 'lock_held' });
          expect(Date.now() - started).toBeGreaterThanOrEqual(ADMISSION_LOCK_WAIT_MS - 50);
        }
        const started = Date.now();
        await expect(claims.status(RUN, SERVER)).rejects.toMatchObject({ code: 'lock_held' });
        expect(Date.now() - started).toBeGreaterThanOrEqual(ADMISSION_LOCK_WAIT_MS - 50);
        expect(fake.calls).toEqual([]);
        expect(readFileSync(path, 'utf8')).toBe(before);
        expect(existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : null).toBe(journalBefore);
        expect(readFileSync(lock, 'utf8')).toBe(foreign);
      } finally {
        unlinkSync(lock);
      }
      // Released, the same claim goes through.
      const after = await claimTool(path, scripted(ABSENT, WORKFLOW_OK).spawn)
        .claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(after.ok && after.dispatchedWorkflow).toBe(true);
    });
  }, 30_000);
});

describe('the reservation re-checks the record after the spent tag is read', () => {
  it('an expiry noted while the tag was read refuses the reservation and spawns no workflow', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = recorder((args) => {
        if (args[0] === 'api') {
          noteAwaitingOperatorExpiry(path, SERVER, '2026-10-23T17:18:01.000Z');
          return ABSENT;
        }
        return WORKFLOW_OK;
      });
      const refused = await claimTool(path, fake.spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(refused.ok === false && refused.kind).toBe('AWAITING_OPERATOR_EXPIRED');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag']);
      expect(readAdmissionDocument(path).claims).toEqual([]);
    });
  });

  it('a claim another tool wrote while the tag was read is replayed, not reserved twice', async () => {
    await withStore(async (path) => {
      await admit(path);
      const journalPath = `${path}.operator.json`;
      const fake = recorder((args) => {
        if (args.includes('--include')) {
          // Another claim tool reserves the pair while this one reads the spent tag.
          const journal = (existsSync(journalPath)
            ? JSON.parse(readFileSync(journalPath, 'utf8'))
            : { schemaVersion: 3, revision: 0, claims: [], progress: [], owners: {} }) as { revision: number; claims: unknown[] };
          journal.claims.push({
            wonderlandRunId: RUN, serverRunId: SERVER, state: 'dispatching', spentTag: `julius-run-spent-${HEX}`,
            spentTagState: 'absent', at: WHEN, dispatchAttempted: false, dispatchError: null, halt: null,
            workflowRunId: null, githubDate: GITHUB_DATE,
          });
          journal.revision += 1;
          writeFileSync(journalPath, `${JSON.stringify(journal)}
`);
          return ABSENT;
        }
        return WORKFLOW_OK;
      });
      const result = await claimTool(path, fake.spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(result.ok && result.replayed && result.record.state).toBe('dispatching');
      expect(ghKinds(fake.calls)).toEqual([...MAIN_READS, 'tag']);
      expect(readAdmissionDocument(path).claims.map((event) => event.state)).toEqual(['dispatching']);
    });
  });
});

describe('reconcile moves a stuck dispatching record from GitHub evidence only', () => {
  const RUN_ID = '36568129865';
  const TAG_OBJECT = 'cd'.repeat(20);
  const PRESENT_ANNOTATED: GhResult = {
    code: 0,
    stdout: `HTTP/2.0 200 OK\nDate: ${GITHUB_DATE_HEADER}\n\n{"ref":"refs/tags/julius-run-spent-${HEX}","object":{"type":"tag","sha":"${TAG_OBJECT}"}}\n`,
    stderr: '',
  };
  const tagMessage = (run: string, workflowRunId: string): GhResult => ({
    code: 0,
    stdout: `${JSON.stringify({
      sha: TAG_OBJECT,
      message: `julius-run-spent.v1\nrun=${run}\nnamespace=julius-inworld-data-1\nreservedUsdMicros=30000000\nworkflow_run_id=${workflowRunId}\nworkflow_run_attempt=1\nhead_sha=${'e'.repeat(40)}\n`,
    })}\n`,
    stderr: '',
  });
  const runList = (rows: readonly {
    id: number; status: string; conclusion: string; key?: string; mode?: string; attempt?: number; branch?: string;
  }[]): GhResult => ({
    code: 0,
    stdout: `${JSON.stringify(rows.map((row) => ({
      databaseId: row.id,
      displayTitle: `julius mission=${MISSION} lane=${LANE} mode=${row.mode ?? 'paid'} key=${row.key ?? KEY}`,
      status: row.status,
      conclusion: row.conclusion,
      event: 'workflow_dispatch',
      headBranch: row.branch ?? 'main',
      attempt: row.attempt ?? 1,
    })))}\n`,
    stderr: '',
  });

  /** Leave the pair `dispatching`: the operator process dies while the workflow child runs. */
  async function stuck(path: string): Promise<void> {
    await admit(path);
    const crashing = recorder((args) => {
      if (args[0] === 'api') return ABSENT;
      throw new Error('operator_process_killed');
    });
    await expect(claimTool(path, crashing.spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION })))
      .rejects.toThrow('operator_process_killed');
    expect(readAdmissionDocument(path).claims.map((event) => event.state)).toEqual(['dispatching']);
  }

  function github(tag: GhResult, message: GhResult | null, runs: GhResult): { spawn: GhSpawner; calls: string[][] } {
    return recorder((args) => {
      if (args.includes('--include')) return tag;
      if (args[0] === 'api' && args[1] === `repos/${REPO}/git/tags/${TAG_OBJECT}` && message !== null) return message;
      if (args[0] === 'run') return runs;
      return { code: 99, stdout: '', stderr: 'unexpected gh call' };
    });
  }

  it('the spent tag naming the one paid run for the key is dispatched, keeping the reservation\'s time and GitHub clock', async () => {
    await withStore(async (path) => {
      await stuck(path);
      const reservation = readAdmissionDocument(path).claims[0];
      const fake = github(PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([{ id: Number(RUN_ID), status: 'in_progress', conclusion: '' }]));
      const result = await claimTool(path, fake.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
      expect(result.ok && result.reconciled).toBe(true);
      if (!result.ok) return;
      expect(result.record.state).toBe('dispatched');
      expect(result.record.workflowRunId).toBe(RUN_ID);
      // The runs are listed BEFORE the tag is read.
      expect(fake.calls).toEqual([
        paidRunListArgs(REPO),
        spentTagApiArgs(REPO, SERVER),
        ['api', `repos/${REPO}/git/tags/${TAG_OBJECT}`],
      ]);
      expect(paidRunListArgs(REPO)).toEqual(expect.arrayContaining(['--branch', 'main']));
      const claims = readAdmissionDocument(path).claims;
      expect(claims.map((event) => event.state)).toEqual(['dispatching', 'dispatched']);
      expect(claims[1]).toMatchObject({ at: reservation?.at, githubDate: GITHUB_DATE, dispatchAttempted: true, spentTagState: 'present', workflowRunId: RUN_ID });
      // Reconciled once; a second reconcile reads nothing and writes nothing.
      const again = github(PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([]));
      const second = await claimTool(path, again.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
      expect(second.ok && second.reconciled).toBe(false);
      expect(again.calls).toEqual([]);
    });
  });

  it('no spent tag and the one paid run completed without success is dispatch_failed (workflow_run_unspent)', async () => {
    await withStore(async (path) => {
      await stuck(path);
      const fake = github(ABSENT, null, runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'failure' }]));
      const result = await claimTool(path, fake.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
      expect(result.ok && result.record.state).toBe('dispatch_failed');
      expect(result.ok && result.record.dispatchError).toBe('workflow_run_unspent');
      const status = await claimTool(path, { run() { throw new Error('spawned'); } }).status(RUN, SERVER);
      expect(status.ok && status.record.state).toBe('dispatch_failed');
      // Terminal: a claim replays it and dispatches nothing.
      const replay = scripted(ABSENT, WORKFLOW_OK);
      const claimed = await claimTool(path, replay.spawn).claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(claimed.ok && claimed.replayed && claimed.record.state).toBe('dispatch_failed');
      expect(replay.calls).toEqual([]);
    });
  });

  it('anything short of agreeing evidence leaves dispatching and writes nothing', async () => {
    const cases: readonly [string, GhResult, GhResult | null, GhResult, string][] = [
      ['no run yet', ABSENT, null, runList([]), 'reconcile_indeterminate'],
      ['run still going, no tag', ABSENT, null, runList([{ id: Number(RUN_ID), status: 'in_progress', conclusion: '' }]), 'reconcile_indeterminate'],
      ['run succeeded, no tag', ABSENT, null, runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success' }]), 'reconcile_indeterminate'],
      ['two runs for the key', PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([
        { id: Number(RUN_ID), status: 'completed', conclusion: 'success' },
        { id: 4242, status: 'completed', conclusion: 'success' },
      ]), 'reconcile_indeterminate'],
      ['tag names another workflow run', PRESENT_ANNOTATED, tagMessage(SERVER, '4242'), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success' }]), 'reconcile_indeterminate'],
      ['a preflight run with the key', PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success', mode: 'preflight' }]), 'reconcile_indeterminate'],
      ['another key\'s run', PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success', key: 'b'.repeat(64) }]), 'reconcile_indeterminate'],
      ['tag message for another run', PRESENT_ANNOTATED, tagMessage(OTHER_SERVER, RUN_ID), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success' }]), 'spent_tag_unverified'],
      ['lightweight tag', PRESENT, null, runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success' }]), 'spent_tag_unverified'],
      // R12: the tag names another workflow run while the one run for the key failed: not unspent.
      ['tag names another run, one run failed', PRESENT_ANNOTATED, tagMessage(SERVER, '4242'), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'failure' }]), 'reconcile_indeterminate'],
      // A Re-run keeps the id and raises the attempt: never this dispatch's outcome.
      ['re-run attempt 2 failed, no tag', ABSENT, null, runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'failure', attempt: 2 }]), 'reconcile_indeterminate'],
      ['re-run attempt 2 tagged', PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success', attempt: 2 }]), 'reconcile_indeterminate'],
      ['a run on another branch', ABSENT, null, runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'failure', branch: 'feature' }]), 'reconcile_indeterminate'],
      ['tag unreadable', { code: 1, stdout: '', stderr: 'temporary failure' }, null, runList([]), 'spent_tag_unreadable'],
      ['runs unreadable', ABSENT, null, { code: 1, stdout: '', stderr: 'boom' }, 'workflow_runs_unreadable'],
    ];
    for (const [name, tag, message, runs, kind] of cases) {
      await withStore(async (path) => {
        await stuck(path);
        const journal = readFileSync(`${path}.operator.json`, 'utf8');
        const result = await claimTool(path, github(tag, message, runs).spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
        expect(result.ok === false && result.kind, name).toBe(kind);
        expect(result.ok === false && result.record?.state, name).toBe('dispatching');
        expect(readFileSync(`${path}.operator.json`, 'utf8'), name).toBe(journal);
      });
    }
  });

  it('a record that moved while GitHub was read is left as the other writer left it', async () => {
    await withStore(async (path) => {
      await stuck(path);
      const journalPath = `${path}.operator.json`;
      const listed = runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success' }]);
      const fake = github(PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), listed);
      const moving: GhSpawner = {
        run(args) {
          if (args[0] === 'run') {
            // Another reconcile finishes first, recording a different run id.
            const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { revision: number; claims: Record<string, unknown>[] };
            const reservation = journal.claims[0] ?? {};
            journal.claims.push({ ...reservation, state: 'dispatched', spentTagState: 'present', dispatchAttempted: true, workflowRunId: '4242' });
            journal.revision += 1;
            writeFileSync(journalPath, `${JSON.stringify(journal)}
`);
          }
          return fake.spawn.run(args);
        },
      };
      const result = await claimTool(path, moving).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
      expect(result.ok === false && result.kind).toBe('record_moved');
      expect(result.ok === false && result.record?.workflowRunId).toBe('4242');
      expect(readAdmissionDocument(path).claims.map((event) => [event.state, event.workflowRunId])).toEqual([
        ['dispatching', null],
        ['dispatched', '4242'],
      ]);
    });
  });

  it('a run that tags between the run list and the tag read is not called unspent', async () => {
    await withStore(async (path) => {
      await stuck(path);
      // Listed: completed, failed. By the tag read, the tag exists. The order makes that safe.
      const fake = github(PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'failure' }]));
      const result = await claimTool(path, fake.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
      expect(result.ok && result.record.state).toBe('dispatched');
      expect(ghKinds(fake.calls)[0]).toBe('run');
    });
  });

  it('the evidence records each run\'s attempt', async () => {
    await withStore(async (path) => {
      await stuck(path);
      const fake = github(ABSENT, null, runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'failure', attempt: 2 }]));
      const result = await claimTool(path, fake.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
      expect(result.evidence?.matchedRuns).toEqual([{ workflowRunId: RUN_ID, attempt: 2, status: 'completed', conclusion: 'failure' }]);
    });
  });

  it('a run list without a usable attempt is unreadable, not a first attempt', async () => {
    await withStore(async (path) => {
      await stuck(path);
      const rows = [{
        databaseId: Number(RUN_ID), displayTitle: `julius mission=${MISSION} lane=${LANE} mode=paid key=${KEY}`,
        status: 'completed', conclusion: 'failure', event: 'workflow_dispatch', headBranch: 'main',
      }];
      for (const attempt of [undefined, 0, '1', 1.5]) {
        const listed = { code: 0, stdout: `${JSON.stringify(rows.map((row) => ({ ...row, attempt })))}\n`, stderr: '' };
        const result = await claimTool(path, github(ABSENT, null, listed).spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
        expect(result.ok === false && result.kind, String(attempt)).toBe('workflow_runs_unreadable');
      }
    });
  });

  it('a held write lock: reconcile waits, then fails lock_held, reading and writing nothing', async () => {
    await withStore(async (path) => {
      await stuck(path);
      const lock = admissionWriteLockPath(path);
      const journal = readFileSync(`${path}.operator.json`, 'utf8');
      writeFileSync(lock, JSON.stringify({ pid: 999_999, purpose: 'wonderland-admission' }), { flag: 'wx', mode: 0o600 });
      try {
        const fake = github(ABSENT, null, runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'failure' }]));
        const started = Date.now();
        await expect(claimTool(path, fake.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO }))
          .rejects.toMatchObject({ code: 'lock_held' });
        expect(Date.now() - started).toBeGreaterThanOrEqual(ADMISSION_LOCK_WAIT_MS - 50);
        expect(fake.calls).toEqual([]);
        expect(readFileSync(`${path}.operator.json`, 'utf8')).toBe(journal);
      } finally {
        unlinkSync(lock);
      }
    });
  }, 30_000);

  it('refuses a pair that was never claimed and reads nothing for a settled one', async () => {
    await withStore(async (path) => {
      await admit(path);
      const fake = github(ABSENT, null, runList([]));
      const never = await claimTool(path, fake.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: REPO });
      expect(never.ok === false && never.kind).toBe('not_claimed');
      const bad = await claimTool(path, fake.spawn).reconcile({ wonderlandRunId: RUN, serverRunId: SERVER, repo: 'not a repo' });
      expect(bad.ok === false && bad.kind).toBe('repo_invalid');
      expect(fake.calls).toEqual([]);
    });
  });

  it('the cli reconcile prints the outcome and what GitHub showed', async () => {
    await withStore(async (path) => {
      await stuck(path);
      const out: string[] = [];
      const code = await runOperatorClaimCli([
        'reconcile', '--store', path, '--wonderland-run', RUN, '--server-run', SERVER, '--repo', REPO,
      ], { out: (line) => { out.push(line); }, err: () => {} }, {
        spawn: github(PRESENT_ANNOTATED, tagMessage(SERVER, RUN_ID), runList([{ id: Number(RUN_ID), status: 'completed', conclusion: 'success' }])).spawn,
        nowIso: () => WHEN,
        readWorkflow: () => { throw new Error('reconcile reads no workflow'); },
      });
      expect(code).toBe(0);
      const body = JSON.parse(out[0] ?? '{}') as { reconciled: boolean; state: string; evidence: { tagWorkflowRunId: string } };
      expect(body.reconciled).toBe(true);
      expect(body.state).toBe('dispatched');
      expect(body.evidence.tagWorkflowRunId).toBe(RUN_ID);
      for (const extra of [['--lane', LANE], ['--dispatch'], ['--confirm', OPERATOR_DISPATCH_CONFIRMATION]]) {
        const refused = await runOperatorClaimCli([
          'reconcile', '--store', path, '--wonderland-run', RUN, '--server-run', SERVER, '--repo', REPO, ...extra,
        ], { out: () => {}, err: () => {} }, {
          spawn: { run() { throw new Error('spawned'); } },
          nowIso: () => WHEN,
          readWorkflow: () => { throw new Error('reconcile reads no workflow'); },
        });
        expect(refused, extra.join(' ')).toBe(2);
      }
    });
  });
});

describe('static scan', () => {
  const files = ['admission-file.ts', 'operator-claim.ts', 'operator-claim-cli.ts'] as const;

  it('spawns only gh, and only from the cli, and does not fetch or read a credential', () => {
    const sources = new Map(files.map((name) => [name, readFileSync(join(__dirname, name), 'utf8')]));
    const combined = [...sources.values()].join('\n');
    expect(combined).not.toMatch(/_API_KEY|GH_TOKEN|GITHUB_TOKEN|process\.env/);
    expect(combined).not.toMatch(/\bfetch\s*\(/);
    expect(combined).not.toMatch(/from ['"]node:(https?|http|net|tls)['"]/);
    expect(combined).not.toMatch(/from ['"](https?|undici|axios|node-fetch|openai|pg)['"]/);
    expect(combined).not.toMatch(/@anthropic-ai|claude-agent-sdk/);
    expect(combined).not.toMatch(/\bexecFile(Sync)?\s*\(|\bexecSync\s*\(|(?<!\.)\bspawn\s*\(/);
    expect(sources.get('admission-file.ts')).not.toContain('child_process');
    expect(sources.get('operator-claim.ts')).not.toContain('child_process');
    expect(sources.get('operator-claim.ts')).not.toContain('spawnSync');
    const cli = sources.get('operator-claim-cli.ts') ?? '';
    expect(cli).toContain("from 'node:child_process'");
    const spawned = [...cli.matchAll(/spawnSync\s*\(\s*(['"])(.*?)\1/g)].map((match) => match[2]);
    expect(spawned).toEqual(['gh']);
    expect(cli).not.toMatch(/setTimeout|setInterval/);
    expect(sources.get('operator-claim.ts')).not.toMatch(/setTimeout|setInterval/);
    const route = readFileSync(join(__dirname, '../../../../relay-bridge/wonderland-admission-route.ts'), 'utf8');
    expect(route).not.toContain('operator-claim');
    expect(route).not.toContain('child_process');
    expect(route).toContain('admission-file');
  });
});

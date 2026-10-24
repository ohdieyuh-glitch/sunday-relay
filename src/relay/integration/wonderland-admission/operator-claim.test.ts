import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AWAITING_OPERATOR_WINDOW_MS, PAID_WORKFLOW_FILE } from './admission-contract';
import { openAdmissionFile, readAdmissionDocument, AdmissionFileClosedError, isAdmissionFileClosed } from './admission-file';
import { createWonderlandAdmissionStore, type AdmissionRequest } from './admission-store';
import { runOperatorClaimCli } from './operator-claim-cli';
import {
  OPERATOR_DISPATCH_CONFIRMATION,
  SERVER_RUN_ID_INPUT,
  concurrencyGroupName,
  createOperatorClaimTool,
  formatGhCommand,
  interpretSpentTagResponse,
  interpretWorkflowHalt,
  learnWorkflowRunId,
  spentTagApiArgs,
  spentTagName,
  workflowDeclaresServerRunId,
  workflowDispatchArgs,
  workflowDispatchInputNames,
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
      server_run_id:
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

const ABSENT: GhResult = {
  code: 1,
  stdout: 'HTTP/2.0 404 Not Found\n{"message":"Not Found"}\n',
  stderr: '',
};
const PRESENT: GhResult = {
  code: 0,
  stdout: `{"ref":"refs/tags/julius-run-spent-${HEX}","object":{"type":"commit","sha":"${'ab'.repeat(20)}"}}\n`,
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

function recorder(behavior: (args: readonly string[]) => GhResult): { spawn: GhSpawner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: {
      run(args) {
        const copy = [...args];
        calls.push(copy);
        return behavior(copy);
      },
    },
  };
}

function scripted(api: GhResult, workflow: GhResult): { spawn: GhSpawner; calls: string[][] } {
  return recorder((args) => {
    if (args[0] === 'api') return api;
    if (args[0] === 'workflow') return workflow;
    return { code: 99, stdout: '', stderr: '' };
  });
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

describe('workflow inputs', () => {
  it('the paid workflow has no server run id input', () => {
    const source = readFileSync(join(__dirname, '../../../../.github/workflows/julius-first-live-mission.yml'), 'utf8');
    expect(workflowDispatchInputNames(source)).toEqual([
      'confirm_live',
      'acknowledge_rerun',
      'max_ticks',
      'hermes_ref',
      'mission',
      'lane',
      'subscription_smoke',
      'dispatch_key',
      'learning_without_run',
    ]);
    expect(workflowDeclaresServerRunId(source)).toBe(false);
    expect(source).not.toContain(SERVER_RUN_ID_INPUT);
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
    expect(workflowDeclaresServerRunId(WORKFLOW_WITH_INPUT)).toBe(true);
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
    expect(command).toContain(`server_run_id=${SERVER}`);
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
      expect(fake.calls.map((args) => args[0])).toEqual(['api', 'workflow']);
      expect(fake.calls[1]).toEqual([
        'workflow', 'run', PAID_WORKFLOW_FILE,
        '--repo', REPO, '--ref', 'main',
        '-f', `mission=${MISSION}`,
        '-f', `lane=${LANE}`,
        '-f', `dispatch_key=${KEY}`,
        '-f', `confirm_live=${OPERATOR_DISPATCH_CONFIRMATION}`,
        '-f', `server_run_id=${SERVER}`,
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
      expect(fake.calls.filter((args) => args[0] === 'api')).toHaveLength(1);
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
      const result = await claims.claim(claimInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.claimed).toBe(true);
      expect(result.dispatchedWorkflow).toBe(false);
      expect(result.record.state).toBe('dispatched');
      expect(result.record.spentTagState).toBe('unknown');
      expect(result.record.dispatchAttempted).toBe(false);
      expect(result.command).toBe(expectedCommand());
      expect(result.command?.startsWith(`gh workflow run ${PAID_WORKFLOW_FILE} `)).toBe(true);
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
      expect(fake.calls.map((args) => args[0])).toEqual(['api', 'workflow']);
      const saved = readAdmissionDocument(path);
      expect(saved.claims.map((event) => event.state)).toEqual(['dispatched', 'dispatch_failed']);
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
      expect(fake.calls.map((args) => args[0])).toEqual(['api', 'workflow']);
      const saved = readAdmissionDocument(path);
      expect(saved.claims.map((event) => event.state)).toEqual(['dispatched', 'already_spent']);
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
      expect(fake.calls.map((args) => args[0])).toEqual(['api', 'workflow']);
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
      expect(fake.calls.map((args) => args[0])).toEqual(['api']);
      const again = await claims.claim(claimInput({ dispatch: true, confirmation: OPERATOR_DISPATCH_CONFIRMATION }));
      expect(again.ok && again.replayed && again.record.state).toBe('already_spent');
      expect(fake.calls.map((args) => args[0])).toEqual(['api']);
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
      expect(fake.calls[0]).toEqual([
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
      expect(fake.calls.map((args) => args[0])).toEqual(['api']);
    });
  });

  it('fixture YAML with server_run_id dispatches, and fixture YAML without it refuses', async () => {
    expect(workflowDeclaresServerRunId(WORKFLOW_WITH_INPUT)).toBe(true);
    expect(workflowDeclaresServerRunId(WORKFLOW_WITHOUT_INPUT)).toBe(false);
    await withStore(async (path) => {
      await admit(path);
      const absent = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, absent.spawn);
      const refused = await claims.claim(claimInput({
        workflowSource: WORKFLOW_WITHOUT_INPUT,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.kind).toBe('workflow_server_run_id_undeclared');
      expect(refused.record?.state).toBe('admitted');
      expect(absent.calls).toEqual([]);
      const present = scripted(ABSENT, WORKFLOW_OK);
      const allowed = await claimTool(path, present.spawn).claim(claimInput({
        workflowSource: WORKFLOW_WITH_INPUT,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(allowed.ok && allowed.dispatchedWorkflow).toBe(true);
      if (!allowed.ok) return;
      expect(allowed.record.state).toBe('dispatched');
      expect(present.calls[1]).toContain(`server_run_id=${SERVER}`);
    });
  });

  it('refuses --dispatch until the workflow declares server_run_id', async () => {
    await withStore(async (path) => {
      await admit(path);
      const source = readFileSync(join(__dirname, '../../../../.github/workflows/julius-first-live-mission.yml'), 'utf8');
      const fake = scripted(ABSENT, WORKFLOW_OK);
      const claims = claimTool(path, fake.spawn);
      const refused = await claims.claim(claimInput({
        workflowSource: source,
        dispatch: true,
        confirmation: OPERATOR_DISPATCH_CONFIRMATION,
      }));
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.kind).toBe('workflow_server_run_id_undeclared');
      expect(refused.requiredInput).toContain('server_run_id:');
      expect(refused.requiredInput).toContain('^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
      expect(refused.requiredInput).toContain('julius-run-spent-<32hex>');
      expect(refused.requiredInput).toContain('julius-paid-<32hex>');
      expect(refused.requiredInput).toContain('julius-run-spent-<24hex>');
      expect(refused.requiredInput).toContain('RUN_ID_ALREADY_SPENT');
      expect(refused.requiredInput).toContain('SPENT_TAG_UNVERIFIED');
      expect(refused.record?.state).toBe('admitted');
      expect(fake.calls).toEqual([]);
      const dry = await claims.claim(claimInput({ workflowSource: source }));
      expect(dry.ok).toBe(false);
      if (dry.ok) return;
      expect(dry.kind).toBe('workflow_server_run_id_undeclared');
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
      expect(open.claimed).toBe(true);
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
      const first = claimTool(path, {
        run() { throw new Error('spawned'); },
      });
      const claimed = await first.claim(claimInput());
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
      expect(status.record.spentTagState).toBe('unknown');
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
      expect(fake.calls[0]).toEqual(spentTagApiArgs(REPO, SERVER));
    });
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
      expect(body.state).toBe('dispatched');
      expect(body.spentTagState).toBe('unknown');
      expect(body.serverRunId).toBe(SERVER);
    });
  });

  it('dispatch follows fixture YAML: absent refuses, present runs once', async () => {
    await withStore(async (path) => {
      await admit(path);
      const calls: string[][] = [];
      const refused = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
        '--dispatch', '--confirm', OPERATOR_DISPATCH_CONFIRMATION,
      ], {
        out: () => {},
        err: () => {},
      }, {
        spawn: { run() { throw new Error('spawned'); } },
        nowIso: () => WHEN,
        readWorkflow: () => WORKFLOW_WITHOUT_INPUT,
      });
      expect(refused).toBe(1);
      const code = await runOperatorClaimCli([
        'claim', '--store', path,
        '--wonderland-run', RUN, '--server-run', SERVER,
        '--repo', REPO, '--lane', LANE,
        '--dispatch', '--confirm', OPERATOR_DISPATCH_CONFIRMATION,
      ], {
        out: () => {},
        err: () => {},
      }, {
        spawn: {
          run(args) {
            calls.push([...args]);
            if (args[0] === 'api') return ABSENT;
            return WORKFLOW_OK;
          },
        },
        nowIso: () => WHEN,
        readWorkflow: () => WORKFLOW_WITH_INPUT,
      });
      expect(code).toBe(0);
      expect(calls.map((args) => args[0])).toEqual(['api', 'workflow']);
      expect(calls[1]).toContain(`server_run_id=${SERVER}`);
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { admitLiveJuliusRunId } from './julius-live-mission';
import { createLiveJuliusBootstrapPort, planTaskId } from './julius/bootstrap';
import { compileBootstrapRequest } from './julius/mission-contract';

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const OTHER = 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LEGACY = 'run:0123456789abcdef01234567';

const request = () => compileBootstrapRequest({
  missionId: 'mission-live-1', markerNamespace: 'test-namespace', projectId: 'prj-live', tenantId: 'tenant-live',
  objective: 'Prove the live chain with a tiny fixture.',
  requirements: ['Normalize a mission label.'], constraints: ['Touch only the fixture.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The fixture test passes.', blocking: true }],
  testCommand: 'npm run mission-test', workspacePath: '/workspace/mission',
  // Stated, so this case still reaches createRun once an omitted ceiling is a
  // refusal rather than a filled-in 5 dollars and 1 repair. The assertion is
  // the admitted id.
  limits: { spendUsd: 5, repairCycles: 1 },
}, [
  { role: 'PROMPT_ARCHITECT', integrationId: 'a', adapterId: 'openai-architect-live', independenceGroup: 'openai', requiredCapabilities: ['plan'] },
  { role: 'CODING_AGENT', integrationId: 'b', adapterId: 'claude-agent-sdk-hosted-live', independenceGroup: 'anthropic', requiredCapabilities: ['implement'] },
  { role: 'INDEPENDENT_REVIEWER', integrationId: 'c', adapterId: 'hermes-local-live', independenceGroup: 'xai', requiredCapabilities: ['review'] },
], 'card-test-1');

function portFor(calls: Array<Record<string, unknown>>, admittedRunId: string) {
  let version = 0;
  return createLiveJuliusBootstrapPort({
    runs: {
      async loadRun() { return null; },
      async createRun(input: { runId: string }) {
        version = 1;
        calls.push({ createRun: input });
        return { runId: input.runId, state: 'CREATED', version };
      },
      async addTask() { return true; },
      async transition(input: { to: string }) {
        version += 1;
        return { state: input.to, version };
      },
      async putTaskContract() { return true; },
    } as never,
    seeds: {
      async ensureBase() { calls.push({ ensureBase: true }); },
      async insertCriteria() {},
      async insertBrainEntries() {},
    },
    tenantId: 'tenant-live',
    executionId: 'execution-live',
    admittedRunId,
  });
}

describe('admitLiveJuliusRunId', () => {
  it('admits one canonical wlj_ id when both spend-tag outputs are that id', () => {
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: WLJ, JULIUS_SERVER_RUN_ID: WLJ })).toEqual({ ok: true, runId: WLJ });
  });

  it('refuses a missing id, and does not trim a blank into one', () => {
    expect(admitLiveJuliusRunId({})).toEqual({ ok: false, reason: 'admission_run_id_required' });
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: '', JULIUS_SERVER_RUN_ID: WLJ })).toEqual({ ok: false, reason: 'admission_run_id_required' });
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: WLJ, JULIUS_SERVER_RUN_ID: '' })).toEqual({ ok: false, reason: 'admission_run_id_required' });
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: ` ${WLJ}`, JULIUS_SERVER_RUN_ID: WLJ })).toEqual({ ok: false, reason: 'admission_run_id_malformed' });
  });

  it('refuses a malformed id', () => {
    for (const value of [
      'not-an-id',
      'wlj_01234567-89AB-4CDE-8FAB-0123456789AB',
      'wlj_01234567-89ab-1cde-8fab-0123456789ab',
      'wlj_01234567-89ab-7cde-8fab-0123456789ab',
      `run:${'A'.repeat(24)}`,
    ]) {
      expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: value, JULIUS_SERVER_RUN_ID: value }), value)
        .toEqual({ ok: false, reason: 'admission_run_id_malformed' });
    }
  });

  it('refuses when the two spend-tag outputs are not the same id', () => {
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: WLJ, JULIUS_SERVER_RUN_ID: OTHER })).toEqual({ ok: false, reason: 'admission_run_id_mismatch' });
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: WLJ, JULIUS_SERVER_RUN_ID: 'not-an-id' })).toEqual({ ok: false, reason: 'admission_run_id_mismatch' });
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: WLJ, JULIUS_SERVER_RUN_ID: LEGACY })).toEqual({ ok: false, reason: 'admission_run_id_mismatch' });
  });

  it('refuses to start on a legacy run: id', () => {
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: LEGACY, JULIUS_SERVER_RUN_ID: LEGACY }))
      .toEqual({ ok: false, reason: 'admission_run_id_legacy_read_only' });
  });
});

describe('the live bootstrap keys the run row on the admitted wlj_ id', () => {
  it('creates the run, the plan task and the accepted id on the canonical id and does not mint', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const outcome = await portFor(calls, WLJ).submit(request());
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) return;
    expect(outcome.runId).toBe(WLJ);
    expect(outcome.runId).not.toMatch(/^run:/u);
    const created = calls.find((call) => 'createRun' in call)?.createRun as { runId: string } | undefined;
    expect(created?.runId).toBe(WLJ);
    expect(planTaskId(WLJ)).toBe(`${WLJ}:plan`);
  });

  it('refuses a legacy or malformed admitted id before creating a run', async () => {
    for (const [admittedRunId, reason] of [
      [LEGACY, 'admission_run_id_legacy_read_only'],
      ['not-an-id', 'admission_run_id_malformed'],
      ['', 'admission_run_id_required'],
    ] as const) {
      const calls: Array<Record<string, unknown>> = [];
      const outcome = await portFor(calls, admittedRunId).submit(request());
      expect(outcome.accepted, admittedRunId).toBe(false);
      if (!outcome.accepted) expect(outcome.reasonCode, admittedRunId).toBe(reason);
      expect(calls, admittedRunId).toEqual([]);
    }
  });

  it('refuses a missing admission id before creating a run', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const outcome = await portFor(calls, '').submit(request());
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) expect(outcome.reasonCode).toBe('admission_run_id_required');
    expect(calls).toEqual([]);
  });
});

describe('the live entry refuses a start that is not an admitted wlj_ id', () => {
  const entry = readFileSync(join(process.cwd(), 'relay-bridge/julius-live-mission.ts'), 'utf8');

  it('admits the env id before preflight and passes that id into bootstrap before submit', () => {
    const admit = entry.indexOf('const admittedRun = admitLiveJuliusRunId(env);');
    const preflight = entry.indexOf('const preflight = resolveLiveWorkers({');
    const banner = entry.indexOf("out('JULIUS LIVE MISSION — preflight');");
    const submit = entry.indexOf('const submitted = await bootstrap.submit(request);');
    expect(admit).toBeGreaterThan(0);
    expect(admit).toBeLessThan(preflight);
    expect(admit).toBeLessThan(banner);
    expect(entry.indexOf('admittedRunId: admittedRun.runId')).toBeGreaterThan(banner);
    expect(entry.indexOf('admittedRunId: admittedRun.runId')).toBeLessThan(submit);
    expect(entry).not.toMatch(/randomUUID|juliusBootstrapRunId\(|`run:\$\{identity\}`/u);
    expect(readFileSync(join(process.cwd(), 'relay-bridge/julius/bootstrap.ts'), 'utf8')).not.toMatch(/juliusBootstrapRunId|`run:\$\{identity\}`/u);
  });
});

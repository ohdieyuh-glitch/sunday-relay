import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  J1_INWORLD_DATA_1_MISSION_ID,
  J1_MISSION_SPEND_CEILINGS,
  decideCombinedCeiling,
  priorSpendFromLedger,
  repeatWorstCaseUsdMicros,
  resolveMissionCeilings,
  verifyRun1Spend,
} from './julius-dispatch-repeat-ceiling';
import {
  createJuliusDispatch,
  createMemoryDispatchLedger,
  type DispatchLedger,
  type DispatchProviders,
  type FrozenMission,
  type RoleCallInput,
  type RoleCallOutput,
  type RoleProvider,
} from './julius-dispatch';

/**
 * The mission seed `relay-bridge/julius-inworld-mission/julius-inworld-data-1/seed/format.test.mjs`
 * is a node:test file. Vitest loads it and fails because `seed/out/normalized.json` is absent.
 * Keeping it out of Vitest means changing `vite.config.mts`, which is outside `relay-bridge/**`
 * and `src/**`. This change does not do that.
 */

const PER_RUN_USD_MICROS = 30_000_000;
const COMBINED_USD_MICROS = 60_000_000;
const CENT_USD_MICROS = 10_000;
const MISSION = J1_INWORLD_DATA_1_MISSION_ID;

const caps = { perRunCapUsdMicros: PER_RUN_USD_MICROS, combinedCapUsdMicros: COMBINED_USD_MICROS };

describe('combined initial+repeat ceiling for julius-inworld-data-1', () => {
  it('freezes $30 per run, $60 combined, and 3 repair cycles on the mission id', () => {
    expect(J1_MISSION_SPEND_CEILINGS[MISSION]).toEqual({
      perRunUsdMicros: PER_RUN_USD_MICROS,
      combinedInitialRepeatUsdMicros: COMBINED_USD_MICROS,
      repairCycles: 3,
    });
    expect(Object.isFrozen(J1_MISSION_SPEND_CEILINGS)).toBe(true);
    expect(Object.isFrozen(J1_MISSION_SPEND_CEILINGS[MISSION])).toBe(true);
    expect(J1_MISSION_SPEND_CEILINGS['mission-j1-frozen']).toBeUndefined();
  });

  it('env may lower the frozen ceilings and may not raise them', () => {
    expect(resolveMissionCeilings(MISSION, { perRunUsd: 100, combinedUsd: 100, combinedProvided: true })).toEqual({
      applicable: true, invalidEnv: false, perRunUsdMicros: PER_RUN_USD_MICROS, combinedUsdMicros: COMBINED_USD_MICROS,
    });
    expect(resolveMissionCeilings(MISSION, { perRunUsd: 10, combinedUsd: 40, combinedProvided: true })).toEqual({
      applicable: true, invalidEnv: false, perRunUsdMicros: 10_000_000, combinedUsdMicros: 40_000_000,
    });
    expect(resolveMissionCeilings(MISSION, { perRunUsd: 10, combinedUsd: null, combinedProvided: false })).toEqual({
      applicable: true, invalidEnv: false, perRunUsdMicros: 10_000_000, combinedUsdMicros: COMBINED_USD_MICROS,
    });
    expect(resolveMissionCeilings('mission-j1-frozen', { perRunUsd: 100, combinedUsd: 100, combinedProvided: true })).toEqual({ applicable: false });
    expect(resolveMissionCeilings(MISSION, { perRunUsd: 10, combinedUsd: null, combinedProvided: true })).toEqual({ applicable: true, invalidEnv: true });
  });

  it('the repeat worst-case bound is the per-run cap; leg estimates cannot raise or lower it', () => {
    expect(repeatWorstCaseUsdMicros({ perRunCapUsdMicros: PER_RUN_USD_MICROS, legEstimateUsd: 0.01, roleCount: 3 })).toBe(PER_RUN_USD_MICROS);
    expect(repeatWorstCaseUsdMicros({ perRunCapUsdMicros: PER_RUN_USD_MICROS, legEstimateUsd: 100, roleCount: 3 })).toBe(PER_RUN_USD_MICROS);
    expect(repeatWorstCaseUsdMicros({ perRunCapUsdMicros: 10_000_000, legEstimateUsd: 1, roleCount: 3 })).toBe(10_000_000);
    expect(repeatWorstCaseUsdMicros({ perRunCapUsdMicros: PER_RUN_USD_MICROS, legEstimateUsd: Number.NaN, roleCount: 3 })).toBeNull();
    expect(repeatWorstCaseUsdMicros({ perRunCapUsdMicros: PER_RUN_USD_MICROS, legEstimateUsd: 1, roleCount: 0 })).toBeNull();
  });

  it('$30.00 of verified run-1 actual is admitted', () => {
    expect(decideCombinedCeiling({ actualUsdMicros: PER_RUN_USD_MICROS, repeatWorstCaseUsdMicros: 1, ...caps })).toEqual({
      admit: true, actualUsdMicros: PER_RUN_USD_MICROS, repeatWorstCaseUsdMicros: 1, ...caps,
    });
  });

  it('$30.01 of verified run-1 actual is refused', () => {
    expect(decideCombinedCeiling({ actualUsdMicros: PER_RUN_USD_MICROS + CENT_USD_MICROS, repeatWorstCaseUsdMicros: 1, ...caps })).toEqual({
      admit: false, reason: 'run1_actual_above_per_run',
    });
  });

  it('run-1 actual plus the repeat worst-case bound of exactly $60 is admitted', () => {
    expect(decideCombinedCeiling({
      actualUsdMicros: PER_RUN_USD_MICROS, repeatWorstCaseUsdMicros: PER_RUN_USD_MICROS, ...caps,
    })).toEqual({
      admit: true, actualUsdMicros: PER_RUN_USD_MICROS, repeatWorstCaseUsdMicros: PER_RUN_USD_MICROS, ...caps,
    });
  });

  it('run-1 actual plus the repeat worst-case bound of $60.01 is refused', () => {
    expect(decideCombinedCeiling({
      actualUsdMicros: PER_RUN_USD_MICROS, repeatWorstCaseUsdMicros: PER_RUN_USD_MICROS + CENT_USD_MICROS, ...caps,
    })).toEqual({ admit: false, reason: 'combined_ceiling_exceeded' });
  });

  it('unknown spend is refused, including a contacted leg with no dollar receipt', () => {
    const opened = ['architect'];
    expect(verifyRun1Spend({
      sealed: true, orderOk: true, spendUnknownLegs: 1, openedRoles: opened,
      legs: [{ role: 'architect', spend: 'spend_unknown', costUsdMicros: null, providerResponseId: 'resp_a' }],
    })).toEqual({ verified: false, reason: 'unknown_spend' });
    expect(verifyRun1Spend({
      sealed: true, orderOk: true, spendUnknownLegs: 0, openedRoles: opened,
      legs: [{ role: 'architect', spend: 'usage_reported', costUsdMicros: null, providerResponseId: 'resp_a' }],
    })).toEqual({ verified: false, reason: 'unknown_spend' });
    expect(verifyRun1Spend({
      sealed: true, orderOk: true, spendUnknownLegs: 0, openedRoles: opened,
      legs: [{ role: 'architect', spend: 'spend_unknown', costUsdMicros: null, providerResponseId: null }],
    })).toEqual({ verified: false, reason: 'unknown_spend' });
  });

  it('a missing receipt is refused', () => {
    expect(verifyRun1Spend({
      sealed: false, orderOk: false, spendUnknownLegs: 0, openedRoles: ['architect'],
      legs: [{ role: 'architect', spend: 'usage_reported', costUsdMicros: 1, providerResponseId: 'resp_a' }],
    })).toEqual({ verified: false, reason: 'missing_receipt' });
    expect(verifyRun1Spend({
      sealed: true, orderOk: true, spendUnknownLegs: 0, openedRoles: ['architect', 'coder'],
      legs: [{ role: 'architect', spend: 'usage_reported', costUsdMicros: 1, providerResponseId: 'resp_a' }],
    })).toEqual({ verified: false, reason: 'missing_receipt' });
    expect(verifyRun1Spend({
      sealed: true, orderOk: true, spendUnknownLegs: 0, openedRoles: ['architect'],
      legs: [{ role: 'architect', spend: 'usage_reported', costUsdMicros: 1, providerResponseId: '' }],
    })).toEqual({ verified: false, reason: 'missing_receipt' });
    expect(verifyRun1Spend({
      sealed: true, orderOk: false, spendUnknownLegs: 0, openedRoles: ['architect'],
      legs: [{ role: 'architect', spend: 'usage_reported', costUsdMicros: 1, providerResponseId: 'resp_a' }],
    })).toEqual({ verified: false, reason: 'missing_receipt' });
  });

  it('sums only integer provider receipts and treats not_contacted as zero', () => {
    expect(verifyRun1Spend({
      sealed: true, orderOk: true, spendUnknownLegs: 0, openedRoles: ['architect', 'coder'],
      legs: [
        { role: 'architect', spend: 'usage_reported', costUsdMicros: 12_000_000, providerResponseId: 'resp_a' },
        { role: 'coder', spend: 'not_contacted', costUsdMicros: null, providerResponseId: null },
      ],
    })).toEqual({ verified: true, actualUsdMicros: 12_000_000 });
  });

  it('reads run-1 from ledger rows and refuses a second prior run', () => {
    expect(priorSpendFromLedger([], MISSION)).toEqual({ kind: 'no_prior_run' });
    expect(priorSpendFromLedger([
      { phase: 'run_start', missionId: MISSION, runId: 'run-1' },
      { phase: 'pre_call', runId: 'run-1', role: 'architect' },
      { phase: 'result', runId: 'run-1', role: 'architect', spend: 'usage_reported', costUsdMicros: PER_RUN_USD_MICROS, providerResponseId: 'resp_a' },
      { phase: 'result', runId: 'run-1', role: 'final', orderOk: true, spendUnknownLegs: 0 },
    ], MISSION)).toEqual({ kind: 'verified', actualUsdMicros: PER_RUN_USD_MICROS });
    expect(priorSpendFromLedger([
      { phase: 'run_start', missionId: MISSION, runId: 'run-1' },
      { phase: 'pre_call', runId: 'run-1', role: 'architect' },
      { phase: 'result', runId: 'run-1', role: 'architect', spend: 'spend_unknown', costUsdMicros: null, providerResponseId: null },
      { phase: 'result', runId: 'run-1', role: 'final', orderOk: true, spendUnknownLegs: 1 },
    ], MISSION)).toEqual({ kind: 'unverified', reason: 'unknown_spend' });
    expect(priorSpendFromLedger([
      { phase: 'run_start', missionId: MISSION, runId: 'run-1' },
      { phase: 'pre_call', runId: 'run-1', role: 'architect' },
      { phase: 'result', runId: 'run-1', role: 'final', orderOk: true, spendUnknownLegs: 0 },
    ], MISSION)).toEqual({ kind: 'unverified', reason: 'missing_receipt' });
    expect(priorSpendFromLedger([
      { phase: 'run_start', missionId: MISSION, runId: 'run-1' },
      { phase: 'run_start', missionId: MISSION, runId: 'run-2' },
    ], MISSION)).toEqual({ kind: 'repeat_already_used' });
    expect(priorSpendFromLedger([
      { phase: 'run_start', missionId: 'mission-j1-frozen', runId: 'run-1' },
    ], MISSION)).toEqual({ kind: 'no_prior_run' });
  });
});

const sha = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const FOUNDER = 'player-founder';
const PROJECT = 'proj-1';
const UI_UTC = '2026-10-22T11:59:30.000Z';
const baseFrozen = (missionId: string): FrozenMission => ({
  missionId, contractSha256: sha('contract'), checkerSha256: sha('checker'),
  missionAuthor: 'author-a', checkerAuthor: 'author-b', seededDefect: false, preregId: 'prereg-1',
});

const ROLE_MODEL = { architect: 'gpt-fake', coder: 'claude-fake', reviewer: 'grok-fake' } as const;
function provider(role: 'architect' | 'coder' | 'reviewer', providerId: string, calls: RoleCallInput[], costUsdMicros: number | null): RoleProvider {
  const model = ROLE_MODEL[role];
  return {
    providerId, keyEnv: null, model, fake: true, servedModelAllow: [model],
    async call(input) {
      calls.push(input);
      const common: RoleCallOutput = {
        ok: true, responseId: `resp_${role}_00112233445566`, model, usage: { input: 1, output: 1, total: 2 },
        ...(costUsdMicros === null ? {} : { costUsdMicros }),
      };
      if (role === 'architect') return { ...common, text: 'PLAN' };
      if (role === 'coder') return { ...common, text: 'artifact', changedPaths: 1 };
      return { ...common, text: 'approve', verdict: 'approve' };
    },
  };
}

function routeHarness(options: {
  readonly missionId: string;
  readonly costUsdMicros: number | null | readonly [number, number, number];
  readonly env?: Record<string, string | undefined>;
  readonly ledger?: DispatchLedger;
}) {
  const calls: RoleCallInput[] = [];
  const costs = Array.isArray(options.costUsdMicros) ? options.costUsdMicros : [options.costUsdMicros, options.costUsdMicros, options.costUsdMicros];
  const providers: DispatchProviders = {
    architect: provider('architect', 'openai', calls, costs[0]),
    coder: provider('coder', 'anthropic', calls, costs[1]),
    reviewer: provider('reviewer', 'xai', calls, costs[2]),
  };
  const env: Record<string, string | undefined> = {
    JULIUS_J1_ENABLED: '1', JULIUS_J1_FOUNDER_PLAYER_ID: FOUNDER, JULIUS_J1_PROJECT_ID: PROJECT, JULIUS_J1_REVIEWER_PROVIDER: 'xai',
    JULIUS_J1_BUDGET_CAP_USD: '10', JULIUS_J1_LEG_ESTIMATE_USD: '1', ...options.env,
  };
  const frozen = baseFrozen(options.missionId);
  const ledger = options.ledger ?? createMemoryDispatchLedger();
  let clock = Date.parse('2026-10-22T12:00:00Z');
  let n = 0;
  const controller = createJuliusDispatch({
    providers, ledger, mode: 'fake', env: () => env, now: () => (clock += 1000), newId: () => `disp_${(n += 1)}`, frozen,
    checker: { check: async () => ({ pass: true }) },
    runs: { lookup: async () => ({ missionId: frozen.missionId, contractSha256: frozen.contractSha256, state: 'READY' }) },
  });
  const dispatch = (runId: string, key: string) => controller.dispatch({
    projectId: PROJECT, runId, callerPlayerId: FOUNDER, sessionId: 'sess-1', idempotencyKey: key,
    clientTriggerId: 'trig-00000001', clientLogSha256: sha('client line'), clientUiActionUtc: UI_UTC,
  });
  return { calls, ledger, controller, dispatch, env };
}

describe('J1 route admits a repeat only under the frozen ceiling', () => {
  it('clamps an env budget above $30 down to the frozen per-run cap on the initial run', async () => {
    const h = routeHarness({ missionId: MISSION, costUsdMicros: 1_000_000, env: { JULIUS_J1_BUDGET_CAP_USD: '100', JULIUS_J1_DAILY_CAP: '10' } });
    expect(await h.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true, status: 202 });
    await h.controller.whenIdle();
    const start = (await h.ledger.rows()).find((row) => row.phase === 'run_start');
    expect(start).toMatchObject({ budgetCapUsd: 30, perRunCapUsdMicros: PER_RUN_USD_MICROS, combinedCapUsdMicros: COMBINED_USD_MICROS, run1ActualUsdMicros: null });
  });

  it('admits the repeat when verified run-1 actual is $30.00 and the worst case keeps the sum at $60.00', async () => {
    const h = routeHarness({
      missionId: MISSION, costUsdMicros: [10_000_000, 10_000_000, 10_000_000],
      env: { JULIUS_J1_BUDGET_CAP_USD: '30', JULIUS_J1_LEG_ESTIMATE_USD: '1', JULIUS_J1_DAILY_CAP: '10', JULIUS_J1_MAX_RUNS_PER_MISSION: '10' },
    });
    expect(await h.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await h.controller.whenIdle();
    expect(await h.dispatch('run:2', 'key-0000002')).toMatchObject({ ok: true, status: 202 });
    await h.controller.whenIdle();
    const starts = (await h.ledger.rows()).filter((row) => row.phase === 'run_start');
    expect(starts).toHaveLength(2);
    expect(starts[1]).toMatchObject({
      run1ActualUsdMicros: PER_RUN_USD_MICROS, repeatWorstCaseUsdMicros: PER_RUN_USD_MICROS, combinedCapUsdMicros: COMBINED_USD_MICROS,
    });
    expect(h.calls).toHaveLength(6);
  });

  it('refuses the repeat at $30.01, on unknown spend, and on a missing receipt, with no second chain', async () => {
    const above = routeHarness({
      missionId: MISSION, costUsdMicros: [10_000_000, 10_000_000, 10_010_000],
      env: { JULIUS_J1_BUDGET_CAP_USD: '100', JULIUS_J1_DAILY_CAP: '10' },
    });
    expect(await above.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await above.controller.whenIdle();
    expect(await above.dispatch('run:2', 'key-0000002')).toMatchObject({ status: 409, code: 'julius_dispatch_repeat_above_per_run' });
    expect(above.calls).toHaveLength(3);

    const unknown = routeHarness({ missionId: MISSION, costUsdMicros: null, env: { JULIUS_J1_DAILY_CAP: '10' } });
    expect(await unknown.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await unknown.controller.whenIdle();
    expect(await unknown.dispatch('run:2', 'key-0000002')).toMatchObject({ status: 409, code: 'julius_dispatch_repeat_spend_unknown' });
    expect(unknown.calls).toHaveLength(3);

    const inner = createMemoryDispatchLedger();
    const hiding: DispatchLedger = {
      append: (row) => inner.append(row),
      async rows() { return (await inner.rows()).filter((row) => !(row.phase === 'result' && row.role === 'architect')); },
    };
    const missing = routeHarness({ missionId: MISSION, costUsdMicros: 1_000_000, env: { JULIUS_J1_DAILY_CAP: '10' }, ledger: hiding });
    expect(await missing.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await missing.controller.whenIdle();
    expect(await missing.dispatch('run:2', 'key-0000002')).toMatchObject({ status: 409, code: 'julius_dispatch_repeat_receipt_missing' });
    expect(missing.calls).toHaveLength(3);
  });

  it('refuses a sum above a lowered combined ceiling and ignores an env value that would raise $60', async () => {
    const lowered = routeHarness({
      missionId: MISSION, costUsdMicros: [10_000_000, 10_000_000, 10_000_000],
      env: { JULIUS_J1_BUDGET_CAP_USD: '30', JULIUS_J1_COMBINED_CAP_USD: '50', JULIUS_J1_DAILY_CAP: '10' },
    });
    expect(await lowered.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await lowered.controller.whenIdle();
    expect(await lowered.dispatch('run:2', 'key-0000002')).toMatchObject({ status: 409, code: 'julius_dispatch_repeat_combined_ceiling' });

    const raised = routeHarness({
      missionId: MISSION, costUsdMicros: [10_000_000, 10_000_000, 10_000_000],
      env: { JULIUS_J1_BUDGET_CAP_USD: '100', JULIUS_J1_COMBINED_CAP_USD: '100', JULIUS_J1_DAILY_CAP: '10' },
    });
    expect(await raised.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await raised.controller.whenIdle();
    expect(await raised.dispatch('run:2', 'key-0000002')).toMatchObject({ ok: true });
    const start = (await raised.ledger.rows()).filter((row) => row.phase === 'run_start')[1];
    expect(start).toMatchObject({ combinedCapUsdMicros: COMBINED_USD_MICROS, perRunCapUsdMicros: PER_RUN_USD_MICROS, budgetCapUsd: 30 });
  });

  it('refuses a third run of this mission even when the env run cap is higher', async () => {
    const h = routeHarness({
      missionId: MISSION, costUsdMicros: 0,
      env: { JULIUS_J1_BUDGET_CAP_USD: '30', JULIUS_J1_DAILY_CAP: '10', JULIUS_J1_MAX_RUNS_PER_MISSION: '10' },
    });
    expect(await h.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await h.controller.whenIdle();
    expect(await h.dispatch('run:2', 'key-0000002')).toMatchObject({ ok: true });
    await h.controller.whenIdle();
    expect(await h.dispatch('run:3', 'key-0000003')).toMatchObject({ status: 409, code: 'julius_dispatch_repeat_already_used' });
    expect(h.calls).toHaveLength(6);
  });

  it('leaves a different mission on the existing per-run cap', async () => {
    const h = routeHarness({ missionId: 'mission-j1-frozen', costUsdMicros: null, env: { JULIUS_J1_DAILY_CAP: '10', JULIUS_J1_BUDGET_CAP_USD: '10' } });
    expect(await h.dispatch('run:1', 'key-0000001')).toMatchObject({ ok: true });
    await h.controller.whenIdle();
    expect(await h.dispatch('run:2', 'key-0000002')).toMatchObject({ ok: true });
    await h.controller.whenIdle();
    expect(h.calls).toHaveLength(6);
    expect((await h.ledger.rows()).find((row) => row.phase === 'run_start')).toMatchObject({ budgetCapUsd: 10 });
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_DEFAULT_NAMESPACE_CEILING,
  JULIUS_NAMESPACE_CEILINGS,
  JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS,
  JULIUS_QUALIFYING_PAIR_DEFAULT_GRANT,
  JULIUS_QUALIFYING_PAIR_GRANTS,
  JULIUS_QUALIFYING_PAIR_NAMESPACES,
  JULIUS_RUN_ATTEMPTED_SCHEMA,
  JULIUS_RUN_RECORD_TAG_PREFIX,
  authorizeJuliusLiveSpend,
  classifyJuliusSpentTags,
  interpretJuliusSpentTags,
  juliusQualifyingPairGrant,
  juliusRunRecordSuffix,
  parseJuliusAttemptRecordTag,
  juliusSpentTagMessage,
  summarizeJuliusPriorRunSpend,
  type JuliusPriorRunProof,
  type JuliusPriorRunSpend,
  type JuliusSpendLedgerRead,
} from './julius-spend-ceiling';
import { juliusSpentTagRecord } from './julius-spent-tag-record';

const emptyLedger: JuliusSpendLedgerRead = { readable: true, priorRuns: [], durableRecord: 'ABSENT' };
const durableEmpty: JuliusSpendLedgerRead = { readable: true, priorRuns: [], durableRecord: 'PRESENT' };
const unreadable: JuliusSpendLedgerRead = { readable: false };

const verified = (runId: string, knownUsdMicros: number): JuliusPriorRunSpend => ({
  runId, knownUsdMicros, unknownCostComponents: 0, unverifiableApiSpend: false, spendVerified: true,
});

describe('the runtime refuses a contract above its namespace ceiling', () => {
  it('refuses a $31 mission-5 contract and does not claim the balance is verified', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 31, repairCycles: 3, ledger: emptyLedger,
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reasonCode).toBe('namespace_spend_ceiling_exceeded');
    expect(result.safeMessage).toContain('above the 30 ceiling');
    expect(result.safeMessage).toContain('no provider balance was verified');
  });

  it('ignores local rows when the read is not the durable record', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-unreal-mission-1', spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, priorRuns: [verified('run-1', 1)] },
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reasonCode).toBe('qualifying_pair_spend_absent');
  });

  it('refuses mission 5 when prior-spend facts are absent, and does not treat that as zero', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: emptyLedger,
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reasonCode).toBe('qualifying_pair_spend_absent');
    expect(result.safeMessage).toContain('julius-run-spent-');
    expect(result.safeMessage).toContain('not treated as zero');
    expect(result.safeMessage).toContain('no provider balance was verified');
  });

  it('authorizes mission 5 at its own $30 grant only when a durable record says there is no prior run', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: durableEmpty,
    });
    expect(result).toEqual({ authorized: true, spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3 });
  });

  it('does not substitute $5 when the contract states no ceiling', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: null, repairCycles: 3, ledger: emptyLedger,
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reasonCode).toBe('mission_spend_ceiling_unknown');
  });

  it('keeps continuous-1 $60, diagnostic $100, and a learning-pair arm outside the $60 pair cap', () => {
    expect(authorizeJuliusLiveSpend({
      namespace: 'julius-continuous-1', spendUsd: 60, repairCycles: 3, ledger: unreadable,
    })).toMatchObject({ authorized: true, spendCeilingUsdMicros: 60_000_000 });
    expect(authorizeJuliusLiveSpend({
      namespace: 'julius-diag-output-safety-1', spendUsd: 100, repairCycles: 3, ledger: unreadable,
    })).toMatchObject({ authorized: true, spendCeilingUsdMicros: 100_000_000 });
    const fourArms = authorizeJuliusLiveSpend({
      namespace: 'julius-learning-pair-2', spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, priorRuns: [verified('a', 30_000_000), verified('b', 30_000_000), verified('c', 30_000_000)] },
    });
    expect(fourArms).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
  });
});

describe('a durable prior-spend record can be compared with the $60 figure', () => {
  it('refuses a repeat whose known prior spend plus the new ceiling exceeds $60', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 30_000_001)] },
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reasonCode).toBe('qualifying_pair_spend_exceeded');
    expect(result.safeMessage).toContain('no provider balance was verified');
  });

  it('allows a repeat that lands exactly on $60', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-unreal-mission-1', spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 30_000_000)] },
    });
    expect(result).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
  });

  it('refuses a third run even when the known spend is inside the cap', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 1, repairCycles: 0,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 1), verified('run-2', 1)] },
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reasonCode).toBe('qualifying_pair_third_run_refused');
  });

  it('fails closed when the ledger cannot be read, or a prior bill is unknown, or the coder was not API-billed', () => {
    const unread = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: unreadable,
    });
    expect(unread.authorized).toBe(false);
    if (!unread.authorized) expect(unread.reasonCode).toBe('spend_ledger_unreadable');

    const unknown = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3,
      ledger: {
        readable: true,
        durableRecord: 'PRESENT',
        priorRuns: [{ runId: 'run-1', knownUsdMicros: 0, unknownCostComponents: 1, unverifiableApiSpend: false, spendVerified: false }],
      },
    });
    expect(unknown.authorized).toBe(false);
    if (!unknown.authorized) expect(unknown.reasonCode).toBe('qualifying_pair_spend_unverified');

    const subscription = summarizeJuliusPriorRunSpend('run-sub', [{
      taskId: 'build', role: 'CODING_AGENT', basis: 'NOT_APPLICABLE', usdMicros: null,
      estimatedUsdMicros: 5_000_000, billingPath: 'SUBSCRIPTION',
    }]);
    expect(subscription.unverifiableApiSpend).toBe(true);
    expect(subscription.spendVerified).toBe(false);
    expect(subscription.knownUsdMicros).toBe(0);
    const refused = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [subscription] },
    });
    expect(refused.authorized).toBe(false);
    if (!refused.authorized) {
      expect(refused.reasonCode).toBe('qualifying_pair_spend_unverified');
      expect(refused.safeMessage).not.toContain('balance verified');
    }
  });

  it('counts a provider-reported coder bill and does not treat an estimate as that bill', () => {
    const billed = summarizeJuliusPriorRunSpend('run-api', [
      { taskId: 'build', role: 'CODING_AGENT', basis: 'PROVIDER_REPORTED', usdMicros: 1_390_954, estimatedUsdMicros: null, billingPath: 'API_BILLED' },
      { taskId: 'review', role: 'INDEPENDENT_REVIEWER', basis: 'ESTIMATED', usdMicros: null, estimatedUsdMicros: 4_200, billingPath: null },
    ]);
    expect(billed.knownUsdMicros).toBe(1_390_954);
    expect(billed.spendVerified).toBe(false);
    expect(billed.unknownCostComponents).toBe(1);
  });
});

describe('J1 (julius-inworld-data-1) is $30 and 3 repairs per run, and $90 across its 3 granted runs', () => {
  const J1 = 'julius-inworld-data-1';

  it('is a qualifying-pair namespace with a $30 / 3-cycle grant', () => {
    expect(JULIUS_QUALIFYING_PAIR_NAMESPACES).toContain(J1);
    expect(JULIUS_NAMESPACE_CEILINGS[J1]).toEqual({ spendUsd: 30, repairCycles: 3 });
  });

  it('authorizes $30 and 3 repair cycles on a durable empty record', () => {
    const result = authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: durableEmpty });
    expect(result).toEqual({ authorized: true, spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3 });
  });

  it('refuses $30.01, and refuses a fourth repair cycle', () => {
    const over = authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30.01, repairCycles: 3, ledger: durableEmpty });
    expect(over).toMatchObject({ authorized: false, reasonCode: 'namespace_spend_ceiling_exceeded' });
    const cycles = authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 4, ledger: durableEmpty });
    expect(cycles).toMatchObject({ authorized: false, reasonCode: 'namespace_repair_ceiling_exceeded' });
  });

  it('never grants $60 to one run', () => {
    const result = authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 60, repairCycles: 3, ledger: durableEmpty });
    expect(result).toMatchObject({ authorized: false, reasonCode: 'namespace_spend_ceiling_exceeded' });
  });

  it('refuses J1 when the prior-spend record is absent or unreadable, and does not treat either as zero', () => {
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: emptyLedger }))
      .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_absent' });
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: unreadable }))
      .toMatchObject({ authorized: false, reasonCode: 'spend_ledger_unreadable' });
  });

  it('allows a run that lands exactly on $90, and refuses one micro over', () => {
    const exact = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 60_000_000)] },
    });
    expect(exact).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
    const over = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 60_000_001)] },
    });
    expect(over).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_exceeded' });
  });

  it('refuses a fourth J1 run, and a repeat whose first run has no verified bill', () => {
    const fourth = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 1, repairCycles: 0,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 1), verified('run-2', 1), verified('run-3', 1)] },
    });
    expect(fourth).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_third_run_refused' });
    const unknownBill = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [{ ...verified('run-1', 0), spendVerified: false }] },
    });
    expect(unknownBill).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_unverified' });
  });
});

describe('founder ruling 2026-10-30: J1 alone gets 3 runs / $90; every other pair namespace keeps 2 runs / $60', () => {
  const J1 = 'julius-inworld-data-1';
  const durable = (...priorRuns: JuliusPriorRunSpend[]): JuliusSpendLedgerRead => ({ readable: true, durableRecord: 'PRESENT', priorRuns });

  it('the grant table names J1 only, at exactly 3 runs and 90_000_000 micros; the default stays 2 runs and 60_000_000', () => {
    expect(Object.keys(JULIUS_QUALIFYING_PAIR_GRANTS)).toEqual([J1]);
    expect(juliusQualifyingPairGrant(J1)).toEqual({ runs: 3, capUsdMicros: 90_000_000 });
    expect(JULIUS_QUALIFYING_PAIR_DEFAULT_GRANT).toEqual({ runs: 2, capUsdMicros: 60_000_000 });
    expect(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS).toBe(60_000_000);
    for (const namespace of JULIUS_QUALIFYING_PAIR_NAMESPACES.filter((name) => name !== J1)) {
      expect(juliusQualifyingPairGrant(namespace), namespace).toEqual({ runs: 2, capUsdMicros: 60_000_000 });
    }
    expect(juliusQualifyingPairGrant(null)).toEqual({ runs: 2, capUsdMicros: 60_000_000 });
    // The per-run grant is unchanged: $30 and 3 repair cycles.
    expect(JULIUS_NAMESPACE_CEILINGS[J1]).toEqual({ spendUsd: 30, repairCycles: 3 });
  });

  it('(1) J1 with two counted prior runs at their $30 reservations allows a third $30 run, landing exactly on $90', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: durable(verified('run-1', 30_000_000), verified('run-2', 30_000_000)),
    });
    expect(result).toEqual({ authorized: true, spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3 });
  });

  it('(2) J1 with three counted prior runs refuses a fourth, whatever the spend', () => {
    for (const each of [1, 30_000_000]) {
      const result = authorizeJuliusLiveSpend({
        namespace: J1, spendUsd: 1, repairCycles: 0,
        ledger: durable(verified('run-1', each), verified('run-2', each), verified('run-3', each)),
      });
      expect(result).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_third_run_refused' });
      if (!result.authorized) expect(result.safeMessage).toContain('allows 3 runs in total');
    }
  });

  it('(3) J1 is refused when prior spend plus this run passes $90, by one micro', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: durable(verified('run-1', 30_000_000), verified('run-2', 30_000_001)),
    });
    expect(result).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_exceeded' });
    if (!result.authorized) expect(result.safeMessage).toContain('90000000 micro combined cap');
    const known = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: durable(verified('run-1', 61_000_000)),
    });
    expect(known).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_exceeded' });
  });

  it('(4) mission 5 and unreal-mission-1 still refuse a third run and still cap at $60', () => {
    for (const namespace of ['julius-live-mission-5', 'julius-unreal-mission-1']) {
      const third = authorizeJuliusLiveSpend({
        namespace, spendUsd: 30, repairCycles: 3,
        ledger: durable(verified('run-1', 30_000_000), verified('run-2', 30_000_000)),
      });
      expect(third, namespace).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_third_run_refused' });
      if (!third.authorized) expect(third.safeMessage).toContain('allows 2 runs in total');
      const over = authorizeJuliusLiveSpend({
        namespace, spendUsd: 30, repairCycles: 3, ledger: durable(verified('run-1', 30_000_001)),
      });
      expect(over, namespace).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_exceeded' });
      if (!over.authorized) expect(over.safeMessage).toContain('60000000 micro combined cap');
      const exact = authorizeJuliusLiveSpend({
        namespace, spendUsd: 30, repairCycles: 3, ledger: durable(verified('run-1', 30_000_000)),
      });
      expect(exact, namespace).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
    }
  });

  it('(5) an unverified J1 prior run still refuses and is never counted as $0, absent and unreadable still refuse', () => {
    const unknown: JuliusPriorRunSpend = { runId: 'run-2', knownUsdMicros: 0, unknownCostComponents: 1, unverifiableApiSpend: false, spendVerified: false };
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: durable(verified('run-1', 30_000_000), unknown) }))
      .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_unverified' });
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: durable(unknown) }))
      .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_unverified' });
    // A spent tag with no readable reservation is unverified, not $0.
    const bare = interpretJuliusSpentTags({ namespace: J1, tags: [{ ref: 'refs/tags/julius-run-spent-0123456789ab4cde8fab0123456789ab', message: null }] });
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: bare }))
      .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_unverified' });
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: emptyLedger }))
      .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_absent' });
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger: unreadable }))
      .toMatchObject({ authorized: false, reasonCode: 'spend_ledger_unreadable' });
  });

  /*
   * (6) THE REAL J1 LEDGER as run 40698923582 printed it (job 122855431394, log lines 910-914), plus
   * 40698923582's own tag. Run ids, wlj ids, workflow run ids and the two counted runs' head SHAs are
   * real (the GitHub run objects); the four NOT_EXECUTED runs' head SHA is a stand-in. Both counted runs
   * stay UNKNOWN and counted at their $30 reservation: nothing is reclassified or reset.
   */
  const REAL: readonly { wlj: string; workflowRunId: string; head: string; proof: Omit<JuliusPriorRunProof, 'binding'> | null }[] = [
    { wlj: 'wlj_0c96b0f9-2879-4426-b464-fb132ae658fa', workflowRunId: '40299692757', head: 'f5fe5e614a001c16d3b68b2c665cb7fcfebf2879',
      proof: { classification: 'UNKNOWN', basis: 'executed_charges_unreadable', knownChargesUsdMicros: null } },
    { wlj: 'wlj_1ed344d1-16f4-48fa-baa2-9f7cc8602e36', workflowRunId: '40258482240', head: 'a'.repeat(40),
      proof: { classification: 'NOT_EXECUTED', basis: 'no_provider_execution_live_never_ran', knownChargesUsdMicros: null } },
    { wlj: 'wlj_23f50bac-67d8-497c-b31f-1db02311ae93', workflowRunId: '40242149156', head: 'a'.repeat(40),
      proof: { classification: 'NOT_EXECUTED', basis: 'no_provider_execution_live_never_ran', knownChargesUsdMicros: null } },
    { wlj: 'wlj_309e375d-c2c6-4a63-8590-b417c07dd433', workflowRunId: '40278849833', head: 'a'.repeat(40),
      proof: { classification: 'NOT_EXECUTED', basis: 'no_provider_execution_zero_rows_not_run', knownChargesUsdMicros: null } },
    { wlj: 'wlj_7dd5ad76-ed4f-47c3-b3a6-5a2d9b38636a', workflowRunId: '40520432789', head: 'a'.repeat(40),
      proof: { classification: 'NOT_EXECUTED', basis: 'no_provider_execution_refused_before_provider', knownChargesUsdMicros: null } },
    // 40698923582: no evidence artifact (storage quota), so there is no proof: UNKNOWN, counted.
    { wlj: 'wlj_92f24bfc-3e6a-4e5f-a807-6c214fc19a42', workflowRunId: '40698923582', head: 'f88614da0445741642f10195ea08f2d6ad9e8815', proof: null },
  ];
  const realLedger = (extra: typeof REAL = []) => {
    const rows = [...REAL, ...extra];
    const tags = rows.map((row) => ({
      ref: `refs/tags/julius-run-spent-${row.wlj.slice('wlj_'.length).replaceAll('-', '')}`,
      message: juliusSpentTagRecord({
        runId: row.wlj, namespace: J1, reservedUsdMicros: 30_000_000,
        workflowRunId: row.workflowRunId, workflowRunAttempt: '1', headSha: row.head,
      }),
    }));
    const proofs = new Map<string, JuliusPriorRunProof>();
    for (const row of rows) {
      if (row.proof !== null) {
        proofs.set(row.wlj, { binding: { workflowRunId: row.workflowRunId, workflowRunAttempt: '1', headSha: row.head }, ...row.proof });
      }
    }
    return classifyJuliusSpentTags({ namespace: J1, tags, proofs });
  };

  it('(6) the real ledger: 40299692757 and 40698923582 stay counted UNKNOWN at $30 each, and exactly one more $30 J1 run is allowed', () => {
    const { ledger, audit } = realLedger();
    expect(tagsAllBuilt()).toBe(true);
    const counted = audit.filter((row) => row.counted);
    expect(counted.map((row) => [row.workflowRunId, row.classification, row.basis])).toEqual([
      ['40299692757', 'UNKNOWN', 'executed_charges_unreadable'],
      ['40698923582', 'UNKNOWN', 'proof_absent'],
    ]);
    expect(audit.filter((row) => !row.counted).map((row) => row.workflowRunId).sort())
      .toEqual(['40242149156', '40258482240', '40278849833', '40520432789']);
    expect(ledger.readable && ledger.priorRuns.map((run) => run.knownUsdMicros)).toEqual([30_000_000, 30_000_000]);
    expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger }))
      .toEqual({ authorized: true, spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3 });
    // The same two counted runs under any other pair namespace's grant would still be full.
    for (const namespace of ['julius-live-mission-5', 'julius-unreal-mission-1']) {
      expect(authorizeJuliusLiveSpend({ namespace, spendUsd: 30, repairCycles: 3, ledger }), namespace)
        .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_third_run_refused' });
    }
  });

  it('(6) once that one extra J1 run has its own spent tag, whatever its outcome, a fourth is refused', () => {
    for (const proof of [null, { classification: 'UNKNOWN' as const, basis: 'executed_charges_unreadable', knownChargesUsdMicros: null }]) {
      const { ledger, audit } = realLedger([{
        wlj: 'wlj_0b6f5d3e-2f4a-4c1d-9e8f-7a6b5c4d3e2f', workflowRunId: '40900000001', head: 'b'.repeat(40), proof,
      }]);
      expect(audit.filter((row) => row.counted)).toHaveLength(3);
      expect(authorizeJuliusLiveSpend({ namespace: J1, spendUsd: 30, repairCycles: 3, ledger }))
        .toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_third_run_refused' });
    }
  });

  function tagsAllBuilt(): boolean {
    return REAL.every((row) => juliusSpentTagRecord({
      runId: row.wlj, namespace: J1, reservedUsdMicros: 30_000_000,
      workflowRunId: row.workflowRunId, workflowRunAttempt: '1', headSha: row.head,
    }) !== null);
  }
});

describe('the runtime table matches the contract-check script', () => {
  it('copies every namespace grant and the default, and no other', () => {
    const source = readFileSync('scripts/julius-live-contract-check.mjs', 'utf8');
    const defaults = /const DEFAULT_LIMITS = Object\.freeze\(\{ spendUsd: (\d+), repairCycles: (\d+) \}\)/u.exec(source);
    expect(defaults, 'DEFAULT_LIMITS must stay parseable').not.toBeNull();
    expect(JULIUS_DEFAULT_NAMESPACE_CEILING).toEqual({
      spendUsd: Number(defaults?.[1]), repairCycles: Number(defaults?.[2]),
    });
    const found = new Map<string, { spendUsd: number; repairCycles: number }>();
    for (const match of source.matchAll(/'([a-z0-9-]+)': Object\.freeze\(\{ spendUsd: (\d+), repairCycles: (\d+) \}\)/gu)) {
      found.set(match[1] as string, { spendUsd: Number(match[2]), repairCycles: Number(match[3]) });
    }
    expect([...found.keys()].sort()).toEqual(Object.keys(JULIUS_NAMESPACE_CEILINGS).sort());
    for (const [namespace, ceiling] of found) {
      expect(JULIUS_NAMESPACE_CEILINGS[namespace], namespace).toEqual(ceiling);
    }
    expect(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS).toBe(60_000_000);
  });
});

const HEX_A = '0123456789abcdef01234567';
const HEX_B = 'abcdef0123456789abcdef01';
const RUN_A = `run:${HEX_A}`;
const RUN_B = `run:${HEX_B}`;

describe('julius-run-spent tags are the durable $60 record', () => {
  it('a successful empty listing is zero prior spend, and this run\'s own tag is not prior spend', () => {
    expect(interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5', tags: [],
    })).toEqual({ readable: true, priorRuns: [], durableRecord: 'PRESENT' });
    const ownLock = interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5',
      excludeRunId: RUN_A,
      tags: [{ ref: `refs/tags/julius-run-spent-${HEX_A}`, message: null }],
    });
    expect(ownLock).toEqual({ readable: true, priorRuns: [], durableRecord: 'PRESENT' });
    const authorized = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: ownLock,
    });
    expect(authorized).toEqual({ authorized: true, spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3 });
  });

  it('a reserved ceiling is the known prior figure, and a tag with no ceiling refuses', () => {
    const message = juliusSpentTagMessage({
      runId: RUN_A, namespace: 'julius-live-mission-5', reservedUsdMicros: 30_000_000,
    });
    expect(message).toContain('reservedUsdMicros=30000000');
    const bare = interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5',
      tags: [{ ref: `refs/tags/julius-run-spent-${HEX_B}`, message: null }],
    });
    expect(bare.readable).toBe(true);
    if (!bare.readable) return;
    expect(bare.priorRuns).toEqual([{
      runId: RUN_B, knownUsdMicros: 0, unknownCostComponents: 1, unverifiableApiSpend: false, spendVerified: false,
    }]);
    const refused = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: bare,
    });
    expect(refused.authorized).toBe(false);
    if (!refused.authorized) expect(refused.reasonCode).toBe('qualifying_pair_spend_unverified');
    const twoPrior = interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5',
      tags: [
        { ref: `refs/tags/julius-run-spent-${HEX_A}`, message },
        { ref: `refs/tags/julius-run-spent-${HEX_B}`, message },
      ],
    });
    const third = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 1, repairCycles: 0, ledger: twoPrior,
    });
    expect(third.authorized).toBe(false);
    if (!third.authorized) expect(third.reasonCode).toBe('qualifying_pair_third_run_refused');

    const verifiedOnly = interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5',
      tags: [{ ref: `refs/tags/julius-run-spent-${HEX_A}`, message }],
    });
    expect(authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: verifiedOnly,
    })).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
    const over = juliusSpentTagMessage({
      runId: RUN_A, namespace: 'julius-live-mission-5', reservedUsdMicros: 30_000_001,
    });
    const overLedger = interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5',
      tags: [{ ref: `refs/tags/julius-run-spent-${HEX_A}`, message: over }],
    });
    const exceeded = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: overLedger,
    });
    expect(exceeded.authorized).toBe(false);
    if (!exceeded.authorized) expect(exceeded.reasonCode).toBe('qualifying_pair_spend_exceeded');
  });

  it('a tag for another namespace is not this mission, and a foreign ref makes the listing unreadable', () => {
    const other = juliusSpentTagMessage({
      runId: RUN_A, namespace: 'julius-diag-output-safety-1', reservedUsdMicros: 50_000_000,
    });
    expect(interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5',
      tags: [{ ref: `refs/tags/julius-run-spent-${HEX_A}`, message: other }],
    })).toEqual({ readable: true, priorRuns: [], durableRecord: 'PRESENT' });
    expect(interpretJuliusSpentTags({
      namespace: 'julius-live-mission-5',
      tags: [{ ref: 'refs/tags/not-a-spent-tag', message: null }],
    })).toEqual({ readable: false });
  });
});

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const WLJ_HEX = '0123456789ab4cde8fab0123456789ab';
const PAIR = 'julius-live-mission-5';

describe('a wlj spent tag counts toward the $60 cap', () => {
  it('sums a wlj reservation into the cap at its reserved micros', () => {
    const message = juliusSpentTagMessage({
      runId: WLJ, namespace: PAIR, reservedUsdMicros: 30_000_000,
    });
    const ledger = interpretJuliusSpentTags({
      namespace: PAIR,
      tags: [{ ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message }],
    });
    expect(ledger).toEqual({
      readable: true,
      durableRecord: 'PRESENT',
      priorRuns: [{
        runId: WLJ,
        knownUsdMicros: 30_000_000,
        unknownCostComponents: 0,
        unverifiableApiSpend: false,
        spendVerified: true,
      }],
    });
    // 30_000_000 prior + 30_000_000 contract = 60_000_000. Equality stays inside the cap.
    expect(authorizeJuliusLiveSpend({
      namespace: PAIR, spendUsd: 30, repairCycles: 3, ledger,
    })).toEqual({ authorized: true, spendCeilingUsdMicros: 30_000_000, maxRepairRounds: 3 });
    expect(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS).toBe(60_000_000);
  });

  it('refuses when the wlj reservation plus this contract passes the cap', () => {
    const message = juliusSpentTagMessage({
      runId: WLJ, namespace: PAIR, reservedUsdMicros: 30_000_001,
    });
    const ledger = interpretJuliusSpentTags({
      namespace: PAIR,
      tags: [{ ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message }],
    });
    expect(ledger.readable).toBe(true);
    if (!ledger.readable) return;
    expect(ledger.priorRuns[0]?.knownUsdMicros).toBe(30_000_001);
    const refused = authorizeJuliusLiveSpend({
      namespace: PAIR, spendUsd: 30, repairCycles: 3, ledger,
    });
    expect(refused.authorized).toBe(false);
    if (!refused.authorized) {
      expect(refused.reasonCode).toBe('qualifying_pair_spend_exceeded');
      expect(refused.safeMessage).toContain('Known prior spend 30000001');
      expect(refused.safeMessage).toContain(String(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS));
    }
  });

  it('counts a mixed legacy and wlj listing, and does not drop either reservation', () => {
    const legacy = juliusSpentTagMessage({
      runId: RUN_A, namespace: PAIR, reservedUsdMicros: 20_000_000,
    });
    const wlj = juliusSpentTagMessage({
      runId: WLJ, namespace: PAIR, reservedUsdMicros: 10_000_000,
    });
    const mixed = interpretJuliusSpentTags({
      namespace: PAIR,
      tags: [
        { ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: wlj },
        { ref: `refs/tags/julius-run-spent-${HEX_A}`, message: legacy },
      ],
    });
    expect(mixed.readable).toBe(true);
    if (!mixed.readable) return;
    expect(mixed.priorRuns.map((run) => [run.runId, run.knownUsdMicros])).toEqual([
      [RUN_A, 20_000_000],
      [WLJ, 10_000_000],
    ]);
    expect(mixed.priorRuns.reduce((sum, run) => sum + run.knownUsdMicros, 0)).toBe(30_000_000);
    const third = authorizeJuliusLiveSpend({
      namespace: PAIR, spendUsd: 1, repairCycles: 0, ledger: mixed,
    });
    expect(third.authorized).toBe(false);
    if (!third.authorized) expect(third.reasonCode).toBe('qualifying_pair_third_run_refused');

    const legacyOver = juliusSpentTagMessage({
      runId: RUN_A, namespace: PAIR, reservedUsdMicros: 30_000_001,
    });
    const held = interpretJuliusSpentTags({
      namespace: PAIR,
      excludeRunId: WLJ,
      tags: [
        { ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: wlj },
        { ref: `refs/tags/julius-run-spent-${HEX_A}`, message: legacyOver },
      ],
    });
    expect(held.readable).toBe(true);
    if (!held.readable) return;
    expect(held.priorRuns).toEqual([{
      runId: RUN_A,
      knownUsdMicros: 30_000_001,
      unknownCostComponents: 0,
      unverifiableApiSpend: false,
      spendVerified: true,
    }]);
    const exceeded = authorizeJuliusLiveSpend({
      namespace: PAIR, spendUsd: 30, repairCycles: 3, ledger: held,
    });
    expect(exceeded.authorized).toBe(false);
    if (!exceeded.authorized) expect(exceeded.reasonCode).toBe('qualifying_pair_spend_exceeded');

    const unread = interpretJuliusSpentTags({
      namespace: PAIR,
      tags: [
        { ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: wlj },
        { ref: 'refs/tags/julius-run-spent-not-hex', message: wlj },
      ],
    });
    expect(unread).toEqual({ readable: false });
    const closed = authorizeJuliusLiveSpend({
      namespace: PAIR, spendUsd: 30, repairCycles: 3, ledger: unread,
    });
    expect(closed.authorized).toBe(false);
    if (!closed.authorized) expect(closed.reasonCode).toBe('spend_ledger_unreadable');

    const badBody = interpretJuliusSpentTags({
      namespace: PAIR,
      tags: [{ ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: 'server_run_id=nope' }],
    });
    expect(badBody.readable).toBe(true);
    if (!badBody.readable) return;
    expect(badBody.priorRuns).toEqual([{
      runId: WLJ,
      knownUsdMicros: 0,
      unknownCostComponents: 1,
      unverifiableApiSpend: false,
      spendVerified: false,
    }]);
    const unknown = authorizeJuliusLiveSpend({
      namespace: PAIR, spendUsd: 30, repairCycles: 3, ledger: badBody,
    });
    expect(unknown.authorized).toBe(false);
    if (!unknown.authorized) expect(unknown.reasonCode).toBe('qualifying_pair_spend_unverified');
  });
});

describe('X′ §1/§2: the record tags live outside the spend namespace, and parse fail-closed', () => {
  const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
  const HEX = '0123456789ab4cde8fab0123456789ab';
  const NS = 'julius-inworld-data-1';
  const body = (lines: readonly string[]) => `${lines.join('\n')}\n`;
  const good = [
    JULIUS_RUN_ATTEMPTED_SCHEMA, `run=${WLJ}`, `namespace=${NS}`, 'workflow_run_id=4242', 'workflow_run_attempt=1',
    `head_sha=${'a'.repeat(40)}`, 'attempted_at=2026-10-26T09:41:00Z', `contract_sha256=${'f'.repeat(64)}`,
  ];
  const ref = `${JULIUS_RUN_RECORD_TAG_PREFIX}${HEX}-attempted`;

  it('a julius-run-record ref fed to the SPENT-TAG listing would make it unreadable: that is why it has its own prefix', () => {
    const spent = { ref: `refs/tags/julius-run-spent-${HEX}`, message: `${juliusSpentTagMessage({ runId: WLJ, namespace: NS, reservedUsdMicros: 30_000_000 }) ?? ''}\n` };
    expect(interpretJuliusSpentTags({ namespace: NS, tags: [spent] }).readable).toBe(true);
    expect(interpretJuliusSpentTags({ namespace: NS, tags: [spent, { ref: `refs/tags/julius-run-spent-${HEX}-attempted`, message: body(good) }] })).toEqual({ readable: false });
    expect(JULIUS_RUN_RECORD_TAG_PREFIX.startsWith('refs/tags/julius-run-spent-')).toBe(false);
    expect('refs/tags/julius-run-spent-'.startsWith(JULIUS_RUN_RECORD_TAG_PREFIX)).toBe(false);
  });

  it('parses the workflow\'s body; a lightweight tag, an unreadable namespace or a foreign prefix is unreadable; a broken body of this namespace counts', () => {
    expect(parseJuliusAttemptRecordTag(ref, body(good), NS)).toEqual({ kind: 'bound', binding: { workflowRunId: '4242', workflowRunAttempt: '1', headSha: 'a'.repeat(40) } });
    expect(parseJuliusAttemptRecordTag(ref, null, NS)).toEqual({ kind: 'unreadable' });
    expect(parseJuliusAttemptRecordTag(`refs/tags/julius-run-spent-${HEX}`, body(good), NS)).toEqual({ kind: 'unreadable' });
    expect(parseJuliusAttemptRecordTag(ref, body(good.filter((line) => !line.startsWith('namespace='))), NS)).toEqual({ kind: 'unreadable' });
    expect(parseJuliusAttemptRecordTag(ref, body([...good, `namespace=${NS}`]), NS)).toEqual({ kind: 'unreadable' });
    expect(parseJuliusAttemptRecordTag(ref, body(good.slice(0, 7)), NS)).toEqual({ kind: 'counted_unbound', basis: 'record_tag_unparseable' });
    expect(parseJuliusAttemptRecordTag(ref, body(good.map((line) => (line.startsWith('head_sha=') ? 'head_sha=xyz' : line))), NS)).toEqual({ kind: 'counted_unbound', basis: 'record_tag_unparseable' });
    expect(parseJuliusAttemptRecordTag(`${JULIUS_RUN_RECORD_TAG_PREFIX}${'0'.repeat(32)}-attempted`, body(good), NS)).toEqual({ kind: 'counted_unbound', basis: 'record_tag_ref_mismatch' });
    expect(parseJuliusAttemptRecordTag(ref, body(good), 'julius-first-live')).toEqual({ kind: 'other_namespace' });
    expect(parseJuliusAttemptRecordTag(ref.replace(/-attempted$/u, '-result'), 'anything', NS)).toEqual({ kind: 'not_attempted' });
    expect(juliusRunRecordSuffix(WLJ)).toBe(HEX);
    expect(juliusRunRecordSuffix('run:0123456789abcdef01234567')).toBe('0123456789abcdef01234567');
    expect(juliusRunRecordSuffix('wlj_nope')).toBeNull();
  });
});

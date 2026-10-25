import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_DEFAULT_NAMESPACE_CEILING,
  JULIUS_NAMESPACE_CEILINGS,
  JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS,
  authorizeJuliusLiveSpend,
  interpretJuliusSpentTags,
  juliusSpentTagMessage,
  summarizeJuliusPriorRunSpend,
  type JuliusPriorRunSpend,
  type JuliusSpendLedgerRead,
} from './julius-spend-ceiling';

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

describe('J1 (julius-inworld-data-1) is $30 and 3 repairs per run, and $60 across the run and its repeat', () => {
  const J1 = 'julius-inworld-data-1';

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

  it('allows a repeat that lands exactly on $60, and refuses one micro over', () => {
    const exact = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 30_000_000)] },
    });
    expect(exact).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
    const over = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 30_000_001)] },
    });
    expect(over).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_exceeded' });
  });

  it('refuses a third J1 run, and a repeat whose first run has no verified bill', () => {
    const third = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 1, repairCycles: 0,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [verified('run-1', 1), verified('run-2', 1)] },
    });
    expect(third).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_third_run_refused' });
    const unknownBill = authorizeJuliusLiveSpend({
      namespace: J1, spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, durableRecord: 'PRESENT', priorRuns: [{ ...verified('run-1', 0), spendVerified: false }] },
    });
    expect(unknownBill).toMatchObject({ authorized: false, reasonCode: 'qualifying_pair_spend_unverified' });
  });
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

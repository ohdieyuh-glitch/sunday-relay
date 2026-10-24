import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_DEFAULT_NAMESPACE_CEILING,
  JULIUS_NAMESPACE_CEILINGS,
  JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS,
  JULIUS_QUALIFYING_PAIR_NAMESPACES,
  authorizeJuliusLiveSpend,
  summarizeJuliusPriorRunSpend,
  type JuliusPriorRunSpend,
  type JuliusSpendLedgerRead,
} from './julius-spend-ceiling';

const emptyLedger: JuliusSpendLedgerRead = { readable: true, priorRuns: [] };
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

  it('accepts mission 5 at its $30 and 3-cycle grant', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3, ledger: emptyLedger,
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

describe('the qualifying pair is initial plus one repeat, inside $60 of known spend', () => {
  it('refuses a repeat whose known prior spend plus the new ceiling exceeds $60', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, priorRuns: [verified('run-1', 30_000_001)] },
    });
    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.reasonCode).toBe('qualifying_pair_spend_exceeded');
    expect(result.safeMessage).toContain('no provider balance was verified');
  });

  it('allows a repeat that lands exactly on $60', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-unreal-mission-1', spendUsd: 30, repairCycles: 3,
      ledger: { readable: true, priorRuns: [verified('run-1', 30_000_000)] },
    });
    expect(result).toMatchObject({ authorized: true, spendCeilingUsdMicros: 30_000_000 });
  });

  it('refuses a third run even when the known spend is inside the cap', () => {
    const result = authorizeJuliusLiveSpend({
      namespace: 'julius-live-mission-5', spendUsd: 1, repairCycles: 0,
      ledger: { readable: true, priorRuns: [verified('run-1', 1), verified('run-2', 1)] },
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
      ledger: { readable: true, priorRuns: [subscription] },
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
    const installerGap = ['julius-inworld-data-1'];
    expect(source).not.toContain('julius-inworld-data-1');
    expect([...found.keys()].sort()).toEqual(
      Object.keys(JULIUS_NAMESPACE_CEILINGS).filter((namespace) => !installerGap.includes(namespace)).sort(),
    );
    expect(JULIUS_NAMESPACE_CEILINGS['julius-inworld-data-1']).toEqual({ spendUsd: 30, repairCycles: 3 });
    expect(JULIUS_QUALIFYING_PAIR_NAMESPACES).toContain('julius-inworld-data-1');
    for (const [namespace, ceiling] of found) {
      expect(JULIUS_NAMESPACE_CEILINGS[namespace], namespace).toEqual(ceiling);
    }
    expect(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS).toBe(60_000_000);
  });
});

/**
 * THE RUNTIME'S OWN SPEND CEILINGS.
 *
 * `scripts/julius-live-contract-check.mjs` refuses a contract above the
 * namespace grant, and the live entry used to trust whatever figure survived
 * that script — including the entry's own `$5` / one-cycle default when the
 * contract said nothing. This module is the same table, applied by the runtime
 * before a provider is contacted. A parity test holds the two copies equal.
 * This file does not import the script: the script runs its check on import.
 *
 * THE $60 PAIR CAP is the founder's bound on the initial qualifying mission
 * plus its one repeat: $30 and 3 repair cycles per run, and $60 of known
 * provider spend across those two runs. It applies only to the namespaces
 * whose grant is that founder limit. It does not apply to `julius-continuous-1`
 * (whose $60 figure is an allocator input, not this cap), the diagnostic
 * namespaces (whose grant is $100), or the learning-pair namespaces (whose
 * founder bound is $30 per arm and $120 across four arms).
 *
 * Unknown is not zero. A prior run whose settlements are missing, estimated,
 * unsettled, or a subscription/`NOT_APPLICABLE` coder charge is not a verified
 * bill. The Coding Agent is API-billed: a subscription or not-applicable coder
 * settlement does not prove the dollars. An unreadable ledger is not an empty
 * one. This module never claims a provider balance was verified.
 */

import { juliusCostComponent } from './julius-cost-accounting';

export interface JuliusNamespaceCeiling {
  readonly spendUsd: number;
  readonly repairCycles: number;
}

export const JULIUS_DEFAULT_NAMESPACE_CEILING: JuliusNamespaceCeiling = Object.freeze({
  spendUsd: 5,
  repairCycles: 1,
});

/** The per-namespace grant. Keys and numbers match `MISSION_LIMITS` in the contract-check script. */
export const JULIUS_NAMESPACE_CEILINGS: Readonly<Record<string, JuliusNamespaceCeiling>> = Object.freeze({
  'julius-live-mission-2': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-3': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-4': Object.freeze({ spendUsd: 20, repairCycles: 3 }),
  'julius-live-mission-5': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-continuous-1': Object.freeze({ spendUsd: 60, repairCycles: 3 }),
  'julius-unreal-mission-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-learning-pair-1': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-learning-pair-2': Object.freeze({ spendUsd: 30, repairCycles: 3 }),
  'julius-diag-output-safety-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-output-safety-2': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-audit-fixes-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
  'julius-diag-digest-evidence-1': Object.freeze({ spendUsd: 100, repairCycles: 3 }),
});

/**
 * Namespaces allowed one initial run and one repeat, together not above $60
 * of known provider spend.
 */
export const JULIUS_QUALIFYING_PAIR_NAMESPACES: readonly string[] = Object.freeze([
  'julius-live-mission-5',
  'julius-unreal-mission-1',
]);

/** $60, in USD micros. Equality is inside the cap; one micro over is not. */
export const JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS = 60_000_000;

export function juliusNamespaceCeiling(namespace: string | null): JuliusNamespaceCeiling {
  if (namespace !== null && Object.hasOwn(JULIUS_NAMESPACE_CEILINGS, namespace)) {
    return JULIUS_NAMESPACE_CEILINGS[namespace] as JuliusNamespaceCeiling;
  }
  return JULIUS_DEFAULT_NAMESPACE_CEILING;
}

export interface JuliusSettlementFact {
  readonly taskId: string;
  readonly role: string | null;
  readonly basis: unknown;
  readonly usdMicros: unknown;
  readonly estimatedUsdMicros: unknown;
  readonly billingPath: unknown;
}

/** What one earlier run of this mission cost, as far as its settlements can prove. */
export interface JuliusPriorRunSpend {
  readonly runId: string;
  readonly knownUsdMicros: number;
  readonly unknownCostComponents: number;
  /**
   * True when the Coding Agent settled as a subscription or as
   * `NOT_APPLICABLE`. That is not an API bill, and it is not zero.
   */
  readonly unverifiableApiSpend: boolean;
  /** True only when every settlement is a known provider or measured-usage bill. */
  readonly spendVerified: boolean;
}

export type JuliusSpendLedgerRead =
  | { readonly readable: false }
  | { readonly readable: true; readonly priorRuns: readonly JuliusPriorRunSpend[] };

export type JuliusSpendAuthorization =
  | {
    readonly authorized: true;
    readonly spendCeilingUsdMicros: number;
    readonly maxRepairRounds: number;
  }
  | { readonly authorized: false; readonly reasonCode: string; readonly safeMessage: string };

const USD_MICROS = 1_000_000;

function usdMicrosOf(spendUsd: number): number | null {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0) return null;
  const micros = Math.round(spendUsd * USD_MICROS);
  if (!Number.isSafeInteger(micros) || micros <= 0) return null;
  return micros;
}

/**
 * Fold `budget.settled` facts into one prior run. Estimated, unknown, and
 * unsettled components are counted and are not added as dollars. A coder
 * settlement that says the work was not API-billed is flagged, not zeroed.
 */
export function summarizeJuliusPriorRunSpend(
  runId: string,
  settlements: readonly JuliusSettlementFact[],
): JuliusPriorRunSpend {
  let knownUsdMicros = 0;
  let unknownCostComponents = 0;
  let spendBasisCount = 0;
  let unverifiableApiSpend = false;
  for (const settlement of settlements) {
    const component = juliusCostComponent({
      taskId: settlement.taskId,
      role: settlement.role,
      basis: settlement.basis,
      usdMicros: settlement.usdMicros,
      estimatedUsdMicros: settlement.estimatedUsdMicros,
    });
    if (component.knownUsdMicros !== null) {
      knownUsdMicros += component.knownUsdMicros;
      spendBasisCount += 1;
    } else {
      unknownCostComponents += 1;
    }
    if (
      component.role === 'CODING_AGENT'
      && (component.basis === 'NOT_APPLICABLE' || settlement.billingPath === 'SUBSCRIPTION')
    ) {
      unverifiableApiSpend = true;
    }
  }
  const spendVerified = settlements.length > 0
    && unknownCostComponents === 0
    && !unverifiableApiSpend
    && spendBasisCount === settlements.length
    && Number.isSafeInteger(knownUsdMicros);
  return {
    runId,
    knownUsdMicros: Number.isSafeInteger(knownUsdMicros) ? knownUsdMicros : 0,
    unknownCostComponents,
    unverifiableApiSpend,
    spendVerified,
  };
}

/**
 * Refuse a live contract the namespace does not grant, and refuse a qualifying
 * pair whose combined known spend cannot be shown to sit inside $60.
 * Authorized output is the contract's own ceiling, never a raised default.
 */
export function authorizeJuliusLiveSpend(input: {
  readonly namespace: string | null;
  readonly spendUsd: number | null;
  readonly repairCycles: number | null;
  readonly ledger: JuliusSpendLedgerRead;
}): JuliusSpendAuthorization {
  const ceiling = juliusNamespaceCeiling(input.namespace);
  const namespaceLabel = input.namespace ?? 'a mission with no declared namespace';
  if (input.spendUsd === null) {
    return {
      authorized: false,
      reasonCode: 'mission_spend_ceiling_unknown',
      safeMessage: 'limits.spendUsd is absent. The runtime does not substitute a default, and no provider balance was verified.',
    };
  }
  if (input.repairCycles === null) {
    return {
      authorized: false,
      reasonCode: 'mission_repair_rounds_unknown',
      safeMessage: 'limits.repairCycles is absent. The runtime does not substitute a default, and no provider balance was verified.',
    };
  }
  const spendCeilingUsdMicros = usdMicrosOf(input.spendUsd);
  if (spendCeilingUsdMicros === null) {
    return {
      authorized: false,
      reasonCode: 'mission_spend_ceiling_invalid',
      safeMessage: 'limits.spendUsd must be a positive finite number. No provider was contacted, and no provider balance was verified.',
    };
  }
  if (input.spendUsd > ceiling.spendUsd) {
    return {
      authorized: false,
      reasonCode: 'namespace_spend_ceiling_exceeded',
      safeMessage: `limits.spendUsd is ${String(input.spendUsd)}, above the ${String(ceiling.spendUsd)} ceiling for ${namespaceLabel}. No provider was contacted, and no provider balance was verified.`,
    };
  }
  if (!Number.isInteger(input.repairCycles) || input.repairCycles < 0) {
    return {
      authorized: false,
      reasonCode: 'mission_repair_rounds_invalid',
      safeMessage: 'limits.repairCycles must be a non-negative integer. No provider was contacted, and no provider balance was verified.',
    };
  }
  if (input.repairCycles > ceiling.repairCycles) {
    return {
      authorized: false,
      reasonCode: 'namespace_repair_ceiling_exceeded',
      safeMessage: `limits.repairCycles is ${String(input.repairCycles)}, above the ${String(ceiling.repairCycles)} allowed for ${namespaceLabel}. No provider was contacted, and no provider balance was verified.`,
    };
  }
  if (!JULIUS_QUALIFYING_PAIR_NAMESPACES.includes(input.namespace ?? '')) {
    return { authorized: true, spendCeilingUsdMicros, maxRepairRounds: input.repairCycles };
  }
  if (!input.ledger.readable) {
    return {
      authorized: false,
      reasonCode: 'spend_ledger_unreadable',
      safeMessage: 'The durable ledger of prior runs could not be read. The combined $60 cap is not treated as zero, and no provider balance was verified.',
    };
  }
  const priorRuns = input.ledger.priorRuns;
  if (priorRuns.length >= 2) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_third_run_refused',
      safeMessage: `This qualifying mission already has ${String(priorRuns.length)} runs. The founder cap allows the initial run and one repeat. No provider was contacted, and no provider balance was verified.`,
    };
  }
  const unverified = priorRuns.find((run) => !run.spendVerified || run.unknownCostComponents > 0 || run.unverifiableApiSpend);
  if (unverified !== undefined) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_unverified',
      safeMessage: `Prior run ${unverified.runId} has no complete API bill (unknown components ${String(unverified.unknownCostComponents)}, coder API spend unverifiable ${String(unverified.unverifiableApiSpend)}). Unknown is not zero, and no provider balance was verified.`,
    };
  }
  let priorKnown = 0;
  for (const run of priorRuns) {
    priorKnown += run.knownUsdMicros;
  }
  if (!Number.isSafeInteger(priorKnown) || priorKnown + spendCeilingUsdMicros > JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS) {
    return {
      authorized: false,
      reasonCode: 'qualifying_pair_spend_exceeded',
      safeMessage: `Known prior spend ${String(priorKnown)} micros plus this contract's ceiling ${String(spendCeilingUsdMicros)} micros exceeds the ${String(JULIUS_QUALIFYING_PAIR_CAP_USD_MICROS)} micro combined cap. No provider was contacted, and no provider balance was verified.`,
    };
  }
  return { authorized: true, spendCeilingUsdMicros, maxRepairRounds: input.repairCycles };
}

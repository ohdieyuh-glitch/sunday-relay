/**
 * Combined initial+repeat spend ceiling for julius-inworld-data-1.
 *
 * The dollar figures are frozen to that mission id. An environment value may only lower
 * them. Run-1 actual is the sum of provider cost receipts already on the dispatch ledger
 * (`costUsdMicros`). Token counts are not a dollar receipt, and a leg estimate is not one
 * either. A repeat starts only when that actual is verified, at or under the per-run
 * ceiling, and the actual plus the repeat's worst-case bound is at or under the combined
 * ceiling. Anything unverified refuses. Repair cycles stay 3; this module does not
 * re-decide them, and it does not edit the contract checker that owns that grant.
 */

export const J1_INWORLD_DATA_1_MISSION_ID = 'julius-inworld-data-1';

const USD_MICROS = 1_000_000;

export const J1_MISSION_SPEND_CEILINGS = Object.freeze({
  [J1_INWORLD_DATA_1_MISSION_ID]: Object.freeze({
    perRunUsdMicros: 30 * USD_MICROS,
    combinedInitialRepeatUsdMicros: 60 * USD_MICROS,
    repairCycles: 3,
  }),
});

export interface CeilingEnv {
  /** Positive dollars already accepted as the operator per-run budget. Null is not a usable cap. */
  readonly perRunUsd: number | null;
  /** Positive dollars when the operator set a combined cap. Null when the value is absent or unusable. */
  readonly combinedUsd: number | null;
  /** True when the operator set a combined-cap variable, including a value that does not parse. */
  readonly combinedProvided: boolean;
}

export type MissionCeilings =
  | { readonly applicable: false }
  | { readonly applicable: true; readonly invalidEnv: true }
  | {
    readonly applicable: true;
    readonly invalidEnv: false;
    readonly perRunUsdMicros: number;
    readonly combinedUsdMicros: number;
  };

function usdToMicros(usd: number): number | null {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return null;
  const micros = Math.round(usd * USD_MICROS);
  if (!Number.isSafeInteger(micros) || micros <= 0) return null;
  if (Math.abs(usd * USD_MICROS - micros) > 1e-3) return null;
  return micros;
}

/** Frozen ceilings for this mission, lowered by env when the env figure is smaller. Other missions are not applicable. */
export function resolveMissionCeilings(missionId: string, env: CeilingEnv): MissionCeilings {
  const frozen = J1_MISSION_SPEND_CEILINGS[missionId];
  if (frozen === undefined) return { applicable: false };
  const envPer = env.perRunUsd === null ? null : usdToMicros(env.perRunUsd);
  if (envPer === null) return { applicable: true, invalidEnv: true };
  let combined = frozen.combinedInitialRepeatUsdMicros;
  if (env.combinedProvided) {
    const envCombined = env.combinedUsd === null ? null : usdToMicros(env.combinedUsd);
    if (envCombined === null) return { applicable: true, invalidEnv: true };
    combined = Math.min(frozen.combinedInitialRepeatUsdMicros, envCombined);
  }
  return {
    applicable: true,
    invalidEnv: false,
    perRunUsdMicros: Math.min(frozen.perRunUsdMicros, envPer),
    combinedUsdMicros: combined,
  };
}

/**
 * Worst case the repeat is allowed to spend, in USD micros.
 *
 * The per-run cap is that bound. A contacted leg can bill more than its operator
 * estimate, so the estimate envelope does not lower the bound, and it cannot raise
 * the frozen cap. The estimate and the role count still have to be real positive
 * numbers; otherwise the bound is unverified and this returns null.
 */
export function repeatWorstCaseUsdMicros(input: {
  readonly perRunCapUsdMicros: number;
  readonly legEstimateUsd: number;
  readonly roleCount: number;
}): number | null {
  if (!Number.isSafeInteger(input.perRunCapUsdMicros) || input.perRunCapUsdMicros <= 0) return null;
  if (!Number.isSafeInteger(input.roleCount) || input.roleCount <= 0) return null;
  if (typeof input.legEstimateUsd !== 'number' || !Number.isFinite(input.legEstimateUsd) || input.legEstimateUsd <= 0) return null;
  const legMicros = Math.round(input.legEstimateUsd * USD_MICROS);
  if (!Number.isSafeInteger(legMicros) || legMicros <= 0) return null;
  if (Math.abs(input.legEstimateUsd * USD_MICROS - legMicros) > 1e-3) return null;
  const envelope = legMicros * input.roleCount;
  if (!Number.isSafeInteger(envelope)) return null;
  return input.perRunCapUsdMicros;
}

export interface CeilingLegReceipt {
  readonly role: string;
  readonly spend: string | null;
  readonly costUsdMicros: number | null;
  readonly providerResponseId: string | null;
}

export interface PriorRunLedgerView {
  readonly sealed: boolean;
  readonly orderOk: boolean;
  readonly spendUnknownLegs: number | null;
  readonly openedRoles: readonly string[];
  readonly legs: readonly CeilingLegReceipt[];
}

function legMicros(leg: CeilingLegReceipt): number | 'unknown_spend' | 'missing_receipt' {
  if (leg.spend === 'not_contacted') {
    if (leg.providerResponseId !== null && leg.providerResponseId.trim() !== '') return 'unknown_spend';
    if (leg.costUsdMicros === null || leg.costUsdMicros === 0) return 0;
    return 'unknown_spend';
  }
  if (leg.spend !== 'usage_reported') return 'unknown_spend';
  if (leg.providerResponseId === null || leg.providerResponseId.trim() === '') return 'missing_receipt';
  if (typeof leg.costUsdMicros !== 'number' || !Number.isSafeInteger(leg.costUsdMicros) || leg.costUsdMicros < 0) return 'unknown_spend';
  return leg.costUsdMicros;
}

/** Verified run-1 dollars from the receipts the route already ledgered. Missing or unknown refuses. */
export function verifyRun1Spend(prior: PriorRunLedgerView):
  | { readonly verified: true; readonly actualUsdMicros: number }
  | { readonly verified: false; readonly reason: 'unknown_spend' | 'missing_receipt' } {
  if (!prior.sealed || prior.orderOk !== true) return { verified: false, reason: 'missing_receipt' };
  if (typeof prior.spendUnknownLegs !== 'number' || !Number.isSafeInteger(prior.spendUnknownLegs) || prior.spendUnknownLegs < 0) {
    return { verified: false, reason: 'unknown_spend' };
  }
  if (prior.spendUnknownLegs > 0) return { verified: false, reason: 'unknown_spend' };
  if (new Set(prior.openedRoles).size !== prior.openedRoles.length) return { verified: false, reason: 'missing_receipt' };
  const byRole = new Map<string, CeilingLegReceipt>();
  for (const leg of prior.legs) {
    if (byRole.has(leg.role)) return { verified: false, reason: 'missing_receipt' };
    byRole.set(leg.role, leg);
  }
  if (byRole.size !== prior.openedRoles.length) return { verified: false, reason: 'missing_receipt' };
  let sum = 0;
  for (const role of prior.openedRoles) {
    const leg = byRole.get(role);
    if (leg === undefined) return { verified: false, reason: 'missing_receipt' };
    const spent = legMicros(leg);
    if (spent === 'unknown_spend') return { verified: false, reason: 'unknown_spend' };
    if (spent === 'missing_receipt') return { verified: false, reason: 'missing_receipt' };
    sum += spent;
    if (!Number.isSafeInteger(sum)) return { verified: false, reason: 'unknown_spend' };
  }
  return { verified: true, actualUsdMicros: sum };
}

const nonNegativeInt = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const positiveInt = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Pure admit/refuse for one repeat. `$30.00` actual passes the per-run check; `$30.01` does not.
 * Actual plus the repeat worst-case bound at exactly the combined ceiling passes; one cent over does not.
 */
export function decideCombinedCeiling(input: {
  readonly actualUsdMicros: number;
  readonly repeatWorstCaseUsdMicros: number;
  readonly perRunCapUsdMicros: number;
  readonly combinedCapUsdMicros: number;
}):
  | {
    readonly admit: true;
    readonly actualUsdMicros: number;
    readonly repeatWorstCaseUsdMicros: number;
    readonly perRunCapUsdMicros: number;
    readonly combinedCapUsdMicros: number;
  }
  | { readonly admit: false; readonly reason: 'run1_actual_above_per_run' | 'combined_ceiling_exceeded' | 'ceiling_unconfigured' } {
  if (!nonNegativeInt(input.actualUsdMicros) || !nonNegativeInt(input.repeatWorstCaseUsdMicros)
    || !positiveInt(input.perRunCapUsdMicros) || !positiveInt(input.combinedCapUsdMicros)) {
    return { admit: false, reason: 'ceiling_unconfigured' };
  }
  if (input.actualUsdMicros > input.perRunCapUsdMicros) return { admit: false, reason: 'run1_actual_above_per_run' };
  if (input.actualUsdMicros + input.repeatWorstCaseUsdMicros > input.combinedCapUsdMicros) {
    return { admit: false, reason: 'combined_ceiling_exceeded' };
  }
  return {
    admit: true,
    actualUsdMicros: input.actualUsdMicros,
    repeatWorstCaseUsdMicros: input.repeatWorstCaseUsdMicros,
    perRunCapUsdMicros: input.perRunCapUsdMicros,
    combinedCapUsdMicros: input.combinedCapUsdMicros,
  };
}

export interface LedgerSpendRow {
  readonly phase?: unknown;
  readonly role?: unknown;
  readonly runId?: unknown;
  readonly missionId?: unknown;
  readonly spend?: unknown;
  readonly costUsdMicros?: unknown;
  readonly providerResponseId?: unknown;
  readonly orderOk?: unknown;
  readonly spendUnknownLegs?: unknown;
}

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The prior runs of this mission on the ledger. Zero is the initial run. Two or more is already a used repeat. */
export function priorSpendFromLedger(rows: readonly LedgerSpendRow[], missionId: string):
  | { readonly kind: 'no_prior_run' }
  | { readonly kind: 'repeat_already_used' }
  | { readonly kind: 'unverified'; readonly reason: 'unknown_spend' | 'missing_receipt' }
  | { readonly kind: 'verified'; readonly actualUsdMicros: number } {
  const starts = rows.filter((row) => row.phase === 'run_start' && row.missionId === missionId);
  if (starts.length === 0) return { kind: 'no_prior_run' };
  if (starts.length > 1) return { kind: 'repeat_already_used' };
  const runId = asText(starts[0]?.runId);
  if (runId === null || runId === '') return { kind: 'unverified', reason: 'missing_receipt' };
  const mine = rows.filter((row) => row.runId === runId);
  const finalRow = mine.find((row) => row.phase === 'result' && row.role === 'final');
  const openedRoles = mine
    .filter((row) => row.phase === 'pre_call')
    .map((row) => asText(row.role))
    .filter((role): role is string => role !== null && role !== '');
  const legs = mine.filter((row) => row.phase === 'result' && row.role !== 'final').map((row) => ({
    role: asText(row.role) ?? '',
    spend: asText(row.spend),
    costUsdMicros: typeof row.costUsdMicros === 'number' ? row.costUsdMicros : null,
    providerResponseId: asText(row.providerResponseId),
  }));
  const verified = verifyRun1Spend({
    sealed: finalRow !== undefined,
    orderOk: finalRow?.orderOk === true,
    spendUnknownLegs: finalRow !== undefined && typeof finalRow.spendUnknownLegs === 'number' ? finalRow.spendUnknownLegs : null,
    openedRoles,
    legs,
  });
  if (!verified.verified) return { kind: 'unverified', reason: verified.reason };
  return { kind: 'verified', actualUsdMicros: verified.actualUsdMicros };
}

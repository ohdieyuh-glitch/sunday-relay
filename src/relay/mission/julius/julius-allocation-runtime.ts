import type { JuliusWorkerRole } from './julius-runtime';

/**
 * ALLOCATION — how much of the mission's money one dispatch may spend.
 *
 * Paid run 34037313976 authorised $20 and the hosted Coding Agent was refused
 * at 50 cents, AFTER it had done the work, by a constant no mission could
 * reach. The constant is not raised here. Instead the authority chain is made
 * real: the Mission Contract's `spendUsd` seeds the run budget, this evaluator
 * derives a per-dispatch allocation from it, the pipeline RESERVES exactly that
 * allocation, and the adapter is limited to exactly what was reserved.
 *
 * THE RULE: `EQUAL_SHARE_OVER_AUTHORIZED_ROUNDS`. The contract authorises one
 * build plus `repairCycles` repair rounds within the ceiling, so each Coding
 * Agent dispatch is allocated an equal share of the ceiling, bounded by what
 * remains. If every authorised round spends its whole share the mission spends
 * exactly its ceiling and never more. Nothing here is a fixed ratio between
 * roles: the Prompt Architect and the reviewer report no cost and keep their
 * fixed estimates.
 *
 * UNKNOWN IS NOT ZERO. When the remaining budget cannot be read the allocation
 * is the smaller of the share and the estimate — the conservative answer — and
 * the reservation still gates the dispatch. When the remaining budget is gone
 * the allocation is zero and the dispatch is denied before a provider is paid.
 *
 * ONE LEDGER, EVERY ROLE. The share is computed from the whole ceiling, and
 * the Prompt Architect and the Independent Reviewer draw from that same
 * ceiling — they report no cost at all, so their reservations settle at what
 * they held rather than at a zero nobody measured. A later Coding Agent round
 * therefore receives what REMAINS, which may be less than a share. That is the
 * share behaving as an upper bound per round rather than a reservation of one,
 * and under-spending an authorization is the safe direction; the alternative
 * is a ratio between roles, which would be a number nobody can justify.
 *
 * Pure: no I/O, no clock. The policy is versioned so a durable record can say
 * which rule produced a number.
 */

export const JULIUS_ALLOCATION_POLICY_VERSION = 'julius-allocation.v1' as const;
export const JULIUS_ALLOCATION_RULE = 'EQUAL_SHARE_OVER_AUTHORIZED_ROUNDS' as const;

export interface JuliusAllocationPolicy {
  readonly version: typeof JULIUS_ALLOCATION_POLICY_VERSION;
  readonly rule: typeof JULIUS_ALLOCATION_RULE;
  /** The mission's authorised spend, in micro-dollars. */
  readonly ceilingUsdMicros: number;
  /** The repair rounds the contract authorises beyond the first build. */
  readonly authorizedRepairRounds: number;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function juliusAllocationPolicy(input: {
  readonly ceilingUsdMicros: number;
  readonly authorizedRepairRounds: number;
}): JuliusAllocationPolicy {
  if (!isCount(input.ceilingUsdMicros)) throw new Error('allocation_ceiling_invalid');
  if (!isCount(input.authorizedRepairRounds)) throw new Error('allocation_repair_rounds_invalid');
  return Object.freeze({
    version: JULIUS_ALLOCATION_POLICY_VERSION, rule: JULIUS_ALLOCATION_RULE,
    ceilingUsdMicros: input.ceilingUsdMicros, authorizedRepairRounds: input.authorizedRepairRounds,
  });
}

/** One Coding Agent round's share of the ceiling. */
export function coderShareUsdMicros(policy: JuliusAllocationPolicy): number {
  return Math.floor(policy.ceilingUsdMicros / (1 + policy.authorizedRepairRounds));
}

export type JuliusAllocationBasis =
  /** The full share: the remaining budget covers it. */
  | 'CODER_SHARE'
  /** Less than a share: only the remainder of the mission budget is left. */
  | 'CODER_REMAINDER'
  /** Nothing remains. The dispatch must be denied. */
  | 'EXHAUSTED'
  /** The remaining budget could not be read; the smaller of share and estimate. */
  | 'BUDGET_UNKNOWN'
  /** Not a Coding Agent dispatch: the fixed estimate, as before. */
  | 'ESTIMATE';

export interface JuliusExecutionAllocation {
  readonly usdMicros: number;
  readonly basis: JuliusAllocationBasis;
  readonly shareUsdMicros: number | null;
  readonly remainingUsdMicros: number | null;
  readonly policyVersion: typeof JULIUS_ALLOCATION_POLICY_VERSION;
}

export function evaluateJuliusAllocation(input: {
  readonly policy: JuliusAllocationPolicy;
  readonly role: JuliusWorkerRole;
  /** Ceiling minus outstanding reservations and commitments. Null when unreadable. */
  readonly remainingUsdMicros: number | null;
  /** The fixed resource estimate the pipeline would otherwise reserve. */
  readonly estimateUsdMicros: number;
}): JuliusExecutionAllocation {
  const policyVersion = input.policy.version;
  const remaining = input.remainingUsdMicros;
  if (input.role !== 'CODING_AGENT') {
    return { usdMicros: input.estimateUsdMicros, basis: 'ESTIMATE', shareUsdMicros: null, remainingUsdMicros: remaining, policyVersion };
  }
  const share = coderShareUsdMicros(input.policy);
  if (remaining === null || !Number.isFinite(remaining)) {
    return { usdMicros: Math.min(share, input.estimateUsdMicros), basis: 'BUDGET_UNKNOWN', shareUsdMicros: share, remainingUsdMicros: null, policyVersion };
  }
  if (remaining <= 0) {
    return { usdMicros: 0, basis: 'EXHAUSTED', shareUsdMicros: share, remainingUsdMicros: remaining, policyVersion };
  }
  if (remaining >= share) {
    return { usdMicros: share, basis: 'CODER_SHARE', shareUsdMicros: share, remainingUsdMicros: remaining, policyVersion };
  }
  return { usdMicros: Math.floor(remaining), basis: 'CODER_REMAINDER', shareUsdMicros: share, remainingUsdMicros: remaining, policyVersion };
}

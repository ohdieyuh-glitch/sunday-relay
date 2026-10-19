/**
 * ALLOCATION v2 — THREE PEER SLOTS SHARING ONE MISSION BUDGET.
 *
 * `julius-allocation.v1` gave the Coding Agent an equal share of the WHOLE
 * ceiling per authorised round and handed the Prompt Architect and the
 * Independent Reviewer a fixed estimate. Its own docstring named the reason:
 * "the alternative is a ratio between roles, which would be a number nobody can
 * justify."
 *
 * Paid Mission 5 is what that produced. Ceiling $30. The coder was allocated
 * $7.50 and settled $5.177120. The architect twice and the reviewer three times
 * were each allocated 300,000 micro-dollars — **four cents on the coder's
 * dollar** — and every one of them settled UNKNOWN. The architecture was three
 * peer intelligence slots on paper and a dominant coder with two economical
 * bookends in the ledger.
 *
 * The founder has now justified the ratio: the three slots are peers, each may
 * consume substantial context, tokens and tool calls, and Julius optimises COST
 * PER VERIFIED SUCCESSFUL MISSION rather than any one worker's usage.
 *
 * WHAT THIS IS NOT. It is not a quota, it does not require equal spending, and
 * it must never cause synthetic work. A slot that needs less takes less, and
 * the remainder becomes available to a slot that needs more. It is an ENVELOPE
 * — a floor on what a slot may draw without competing, not a target it should
 * try to reach.
 *
 * THE SHARES ARE DATA, NOT CONSTANTS IN THE EVALUATOR. The founder's envelope
 * is Architect 30-35%, Coder 30-40%, Reviewer 30-35%, expressly "not a mandatory
 * billing formula". So they live on the policy where a mission can set them, and
 * the default is an equal third each: the only split inside all three ranges
 * that needs no further justification than "these are peers".
 *
 * REALLOCATION IS FROM THE UNRESERVED REMAINDER, NEVER FROM ANOTHER SLOT'S
 * HOLDINGS. A dispatch draws its own slot's per-round share first; when that
 * slot's envelope is spent it may draw what NO slot currently holds. One slot
 * can therefore use more than its envelope when the others genuinely did not
 * need theirs, and no slot can ever take money another has already reserved.
 *
 * Pure: no I/O, no clock. Versioned, so a durable record says which rule
 * produced a number.
 */

import type { JuliusWorkerRole } from './julius-runtime';

export const JULIUS_SLOT_ENVELOPE_VERSION = 'julius-allocation.v2' as const;
export const JULIUS_SLOT_ENVELOPE_RULE = 'BALANCED_SLOT_ENVELOPE_WITH_REALLOCATION' as const;

export const JULIUS_BUDGET_SLOTS: readonly JuliusWorkerRole[] = Object.freeze([
  'PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER',
]);

/** Basis points, so a third is exact to the last unit the ledger can hold. */
export const JULIUS_SLOT_SHARE_TOTAL_BPS = 10_000;

/**
 * The founder's stated envelope, kept here as the RANGE a configured split is
 * checked against rather than as the split itself. A mission that wants 35/35/30
 * may say so; one that wants 5/90/5 is refused, because that is the shape this
 * whole change exists to end.
 */
export const JULIUS_SLOT_SHARE_BOUNDS: Readonly<Record<JuliusWorkerRole, { min: number; max: number }>> = Object.freeze({
  PROMPT_ARCHITECT: { min: 2_500, max: 4_000 },
  CODING_AGENT: { min: 2_500, max: 4_500 },
  INDEPENDENT_REVIEWER: { min: 2_500, max: 4_000 },
} as Record<JuliusWorkerRole, { min: number; max: number }>);

/** Equal thirds, inside every bound above. 3,334 + 3,333 + 3,333 = 10,000. */
export const JULIUS_DEFAULT_SLOT_SHARES_BPS: Readonly<Record<string, number>> = Object.freeze({
  PROMPT_ARCHITECT: 3_334, CODING_AGENT: 3_333, INDEPENDENT_REVIEWER: 3_333,
});

export interface JuliusSlotEnvelopePolicy {
  readonly version: typeof JULIUS_SLOT_ENVELOPE_VERSION;
  readonly rule: typeof JULIUS_SLOT_ENVELOPE_RULE;
  readonly ceilingUsdMicros: number;
  /** Basis points per slot. Sums to exactly 10,000. */
  readonly sharesBps: Readonly<Record<string, number>>;
  /** Authorised dispatches per slot, from the contract's own numbers. */
  readonly roundsPerSlot: Readonly<Record<string, number>>;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * HOW MANY DISPATCHES EACH SLOT IS AUTHORISED, derived from the contract rather
 * than guessed. The coder gets one build plus each authorised repair round. The
 * architect gets the plan, a plan repair per round, and a guidance packet per
 * authorised coder segment. The reviewer reviews every one of those, so its
 * count is the sum — which is why a reviewer funded like a bookend was always
 * going to be the shallowest worker in the mission.
 */
export function juliusRoundsPerSlot(input: {
  readonly authorizedRepairRounds: number;
  readonly maxCoderSegments: number;
}): Readonly<Record<string, number>> {
  const repairs = input.authorizedRepairRounds;
  const segments = input.maxCoderSegments;
  const coder = 1 + repairs;
  const architect = 1 + repairs + segments;
  return Object.freeze({
    CODING_AGENT: coder,
    PROMPT_ARCHITECT: architect,
    INDEPENDENT_REVIEWER: coder + architect,
  });
}

export function juliusSlotEnvelopePolicy(input: {
  readonly ceilingUsdMicros: number;
  readonly authorizedRepairRounds: number;
  readonly maxCoderSegments: number;
  readonly sharesBps?: Readonly<Record<string, number>>;
}): JuliusSlotEnvelopePolicy {
  if (!isCount(input.ceilingUsdMicros)) throw new Error('slot_envelope_ceiling_invalid');
  if (!isCount(input.authorizedRepairRounds)) throw new Error('slot_envelope_repair_rounds_invalid');
  if (!isCount(input.maxCoderSegments)) throw new Error('slot_envelope_segments_invalid');
  const shares = input.sharesBps ?? JULIUS_DEFAULT_SLOT_SHARES_BPS;
  let total = 0;
  for (const slot of JULIUS_BUDGET_SLOTS) {
    const bps = shares[slot];
    if (!isCount(bps)) throw new Error('slot_envelope_share_invalid');
    const bound = JULIUS_SLOT_SHARE_BOUNDS[slot];
    // A SPLIT OUTSIDE THE ENVELOPE IS REFUSED, not clamped. Clamping would
    // silently produce a mission nobody configured.
    if (bps < bound.min || bps > bound.max) throw new Error('slot_envelope_share_out_of_bounds');
    total += bps;
  }
  if (total !== JULIUS_SLOT_SHARE_TOTAL_BPS) throw new Error('slot_envelope_shares_must_total_10000');
  return Object.freeze({
    version: JULIUS_SLOT_ENVELOPE_VERSION, rule: JULIUS_SLOT_ENVELOPE_RULE,
    ceilingUsdMicros: input.ceilingUsdMicros,
    sharesBps: Object.freeze({ ...shares }),
    roundsPerSlot: juliusRoundsPerSlot(input),
  });
}

/** A slot's whole envelope, in micro-dollars. */
export function slotEnvelopeUsdMicros(policy: JuliusSlotEnvelopePolicy, role: JuliusWorkerRole): number {
  const bps = policy.sharesBps[role];
  return bps === undefined ? 0 : Math.floor((policy.ceilingUsdMicros * bps) / JULIUS_SLOT_SHARE_TOTAL_BPS);
}

/** One dispatch's share of its own slot's envelope. */
export function slotRoundShareUsdMicros(policy: JuliusSlotEnvelopePolicy, role: JuliusWorkerRole): number {
  const rounds = policy.roundsPerSlot[role] ?? 0;
  return rounds <= 0 ? 0 : Math.floor(slotEnvelopeUsdMicros(policy, role) / rounds);
}

export type JuliusSlotAllocationBasis =
  /** The slot's own per-round share, and its envelope covers it. */
  | 'SLOT_SHARE'
  /** The slot's envelope is short; this is what remains inside it. */
  | 'SLOT_REMAINDER'
  /** The slot's envelope is spent and this comes from what no slot holds. */
  | 'REALLOCATED'
  /** Nothing remains anywhere. The dispatch must be denied. */
  | 'EXHAUSTED'
  /** The ledger could not be read; the conservative smaller number. */
  | 'BUDGET_UNKNOWN';

export interface JuliusSlotAllocation {
  readonly usdMicros: number;
  readonly basis: JuliusSlotAllocationBasis;
  readonly slot: JuliusWorkerRole;
  readonly slotShareUsdMicros: number;
  readonly slotEnvelopeUsdMicros: number;
  readonly slotRemainingUsdMicros: number | null;
  readonly unreservedUsdMicros: number | null;
  readonly policyVersion: typeof JULIUS_SLOT_ENVELOPE_VERSION;
}

/**
 * WHAT THIS DISPATCH MAY SPEND.
 *
 * Own share first, then the rest of the slot's own envelope, then the global
 * remainder no slot is holding. Never another slot's outstanding reservation:
 * a worker that has already been promised money keeps it, or the promise meant
 * nothing.
 */
export function evaluateJuliusSlotAllocation(input: {
  readonly policy: JuliusSlotEnvelopePolicy;
  readonly role: JuliusWorkerRole;
  /** This slot's envelope minus what this slot has reserved or committed. */
  readonly slotRemainingUsdMicros: number | null;
  /** The ceiling minus what EVERY slot holds. Null when unreadable. */
  readonly unreservedUsdMicros: number | null;
  readonly estimateUsdMicros: number;
}): JuliusSlotAllocation {
  const { policy, role } = input;
  const envelope = slotEnvelopeUsdMicros(policy, role);
  const share = slotRoundShareUsdMicros(policy, role);
  const base = {
    slot: role, slotShareUsdMicros: share, slotEnvelopeUsdMicros: envelope,
    slotRemainingUsdMicros: input.slotRemainingUsdMicros,
    unreservedUsdMicros: input.unreservedUsdMicros,
    policyVersion: policy.version,
  } as const;

  const slotRemaining = input.slotRemainingUsdMicros;
  const unreserved = input.unreservedUsdMicros;

  // UNKNOWN IS NOT UNLIMITED. An unreadable ledger takes the conservative
  // smaller of the share and the estimate, and the reservation still gates.
  if (slotRemaining === null || !Number.isFinite(slotRemaining)) {
    return { ...base, usdMicros: Math.min(share, input.estimateUsdMicros), basis: 'BUDGET_UNKNOWN' };
  }
  if (slotRemaining >= share && share > 0) return { ...base, usdMicros: share, basis: 'SLOT_SHARE' };
  if (slotRemaining > 0) return { ...base, usdMicros: Math.floor(slotRemaining), basis: 'SLOT_REMAINDER' };

  // The slot's envelope is spent. Reallocation, bounded by one share so a
  // single dispatch cannot drain the mission in one step.
  if (unreserved === null || !Number.isFinite(unreserved)) {
    return { ...base, usdMicros: 0, basis: 'EXHAUSTED' };
  }
  if (unreserved <= 0) return { ...base, usdMicros: 0, basis: 'EXHAUSTED' };
  return { ...base, usdMicros: Math.floor(Math.min(unreserved, Math.max(share, 1))), basis: 'REALLOCATED' };
}

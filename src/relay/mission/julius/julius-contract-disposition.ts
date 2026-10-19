import { safeReasonCode } from './julius-router';

/**
 * WHAT THE INDEPENDENT EVALUATOR DECIDED ABOUT THE TERMS — always, and as a
 * machine token.
 *
 * Live Run 3 reached VERIFIED COMPLETION and the word "challenge" appears
 * nowhere in its evidence bundle. There is no `julius.contract.challenged`
 * event, which is correct — nothing was challenged — and there is also no
 * record saying so. A reader cannot tell "the evaluator examined the terms and
 * had no objection" from "the challenge leg never ran", and those are different
 * facts about a paid run: the first is the cycle working, the second is a hole
 * in it. SILENCE IS NOT A DISPOSITION.
 *
 * The CHALLENGE half was already wired and durable — `contract.challenged`
 * records a state transition, which is what a challenge causes. This is the
 * other half: the evaluator's ANSWER, recorded on both branches, so the absence
 * of a challenge is an answer someone gave rather than an event that failed to
 * happen.
 *
 * TWO SEPARATE FACTS, TWO SEPARATE EVENTS, deliberately. `contract.challenged`
 * says the contract's STATE changed; `contract.disposition` says what the
 * evaluator DECIDED. A challenge that the store refused to write produces the
 * second without the first, and that difference is exactly what a reader
 * chasing a stalled cycle needs.
 */
export const JULIUS_CONTRACT_DISPOSITIONS = ['CHALLENGE', 'NO_CHALLENGE'] as const;
export type JuliusContractDisposition = (typeof JULIUS_CONTRACT_DISPOSITIONS)[number];

export interface JuliusContractDispositionRecord {
  readonly disposition: JuliusContractDisposition;
  /** The task whose contract this is about — the subject, not the review of it. */
  readonly contractTaskId: string;
  readonly contractId: string;
  readonly contractRevision: number;
  /** WHO decided. An evaluator that cannot be named has not decided. */
  readonly evaluatorId: string;
  /**
   * WHY, as a closed machine token and never the evaluator's prose. The same
   * narrowing every other durable reason code in this runtime passes, so a
   * provider sentence, a URL or a credential cannot arrive dressed as a reason.
   */
  readonly reasonCode: string;
  /**
   * WHAT IT POINTS AT: finding ids, never their text. `[]` on `NO_CHALLENGE`,
   * which is not an absence but the claim itself — the evaluator raised nothing.
   */
  readonly evidenceIds: readonly string[];
  /** How many, so a truncated list can never read as a complete one. */
  readonly evidenceCount: number;
}

export type JuliusContractDispositionOutcome =
  | { readonly outcome: 'RECORDED'; readonly record: JuliusContractDispositionRecord }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * BUILD THE DISPOSITION, or refuse it — the same shape the contract gate uses,
 * so a disposition nobody could stand behind is never written.
 *
 * ONE REFUSAL, NOT TWO, AND THE ASYMMETRY IS DELIBERATE.
 *
 *   NO_CHALLENGE while pointing at findings is refused: an evaluator saying it
 *   has no objection and naming its objections in the same breath has not
 *   decided. Dropping the ids quietly would publish the half that reads better.
 *
 *   CHALLENGE WITH NO FINDING IDS IS NOT REFUSED, and the first draft of this
 *   function got that wrong by copying `challengeJuliusTaskContract`'s
 *   `challenge_requires_objections` rule across. That rule is right where it
 *   is: a contract GATE needs something concrete to revise against. But Julius
 *   admits a repair round on the subject's own FAILED evidence as well as on a
 *   reviewer finding (`verifyTask` → `EVIDENCE_FAILED`), and such a round has
 *   no findings by construction. Refusing its disposition would leave exactly
 *   the silence this record exists to end, on the runs most in need of
 *   explaining. The `disposition` field and the reason code are what separate a
 *   challenge from an accept here; the finding ids say what it points at when
 *   there is anything to point at.
 */
export function juliusContractDisposition(input: {
  readonly disposition: JuliusContractDisposition;
  readonly contractTaskId: string;
  readonly contractId: string;
  readonly contractRevision: number;
  readonly evaluatorId: string;
  readonly reasonCode: string;
  readonly evidenceIds?: readonly string[];
}): JuliusContractDispositionOutcome {
  if (!(JULIUS_CONTRACT_DISPOSITIONS as readonly string[]).includes(input.disposition)) {
    return { outcome: 'REFUSED', reasonCode: 'disposition_unknown' };
  }
  if (!nonEmpty(input.evaluatorId)) return { outcome: 'REFUSED', reasonCode: 'evaluator_required' };
  if (!nonEmpty(input.contractTaskId) || !nonEmpty(input.contractId)) {
    return { outcome: 'REFUSED', reasonCode: 'contract_identity_required' };
  }
  if (!Number.isInteger(input.contractRevision) || input.contractRevision < 1) {
    return { outcome: 'REFUSED', reasonCode: 'contract_revision_invalid' };
  }
  const reasonCode = safeReasonCode(input.reasonCode);
  // A REASON THAT DID NOT SURVIVE NARROWING IS NOT A REASON. Writing the
  // disposition with a null reason would publish "the evaluator decided, for
  // reasons unavailable" — which is the shape this record exists to end.
  if (reasonCode === null) return { outcome: 'REFUSED', reasonCode: 'reason_code_invalid' };

  const evidenceIds = Object.freeze([...(input.evidenceIds ?? [])].filter(nonEmpty));
  if (input.disposition === 'NO_CHALLENGE' && evidenceIds.length > 0) {
    return { outcome: 'REFUSED', reasonCode: 'no_challenge_cannot_cite_objections' };
  }
  return {
    outcome: 'RECORDED',
    record: Object.freeze({
      disposition: input.disposition,
      contractTaskId: input.contractTaskId,
      contractId: input.contractId,
      contractRevision: input.contractRevision,
      evaluatorId: input.evaluatorId,
      reasonCode,
      evidenceIds,
      evidenceCount: evidenceIds.length,
    }),
  };
}

/**
 * THE DISPOSITION AS FLAT FACTS, because an operational event's facts are flat
 * by contract and the runtime's `recordEvent` adapter coerces a non-scalar with
 * `String(value)` — the defect that once reached a durable row as the literal
 * text `[object Object]`.
 *
 * The ids travel as a bounded comma-joined string beside their count, so a list
 * long enough to be cut still says how many there were. They are finding ids —
 * this repository's own identifiers — never a finding's prose.
 */
export function juliusContractDispositionFacts(
  record: JuliusContractDispositionRecord,
): Record<string, string | number | boolean | null> {
  const joined = record.evidenceIds.join(',');
  return {
    disposition: record.disposition,
    contractTaskId: record.contractTaskId,
    contractId: record.contractId,
    contractRevision: record.contractRevision,
    evaluatorId: record.evaluatorId,
    reasonCode: record.reasonCode,
    evidenceCount: record.evidenceCount,
    // Bounded. A row is a record, not a transport for an unbounded list.
    evidenceIds: joined.length <= 1_024 ? joined : `${joined.slice(0, 1_021)}...`,
  };
}

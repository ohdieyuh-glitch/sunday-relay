/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Partial output, final report, and completion claim REFERENCES (PURE).
 *
 * These three are deliberately separate records with separate truth classes,
 * because collapsing them is how a system starts believing agents:
 *
 *   PARTIAL OUTPUT   — recoverable work captured before completion,
 *                      cancellation, failure, timeout, or intervention.
 *   FINAL REPORT     — the structured report the ACTUAL agent supplied.
 *                      Not proof that any command or test actually ran.
 *   COMPLETION CLAIM — the agent's statement that it is done. An agent claim,
 *                      never Relay verification.
 *
 * Relay evidence and review results live elsewhere (`capsule-evidence.ts`,
 * the review service) precisely so a claim can never be mistaken for either.
 * Nothing here stores report bodies — capsules hold references, and the
 * reference's `truth` class travels with it.
 */

export const CAPSULE_REPORT_TRUTH_CLASSES = [
  'agent_claim',
  'relay_evidence',
  'supervisory_observation',
] as const;
export type CapsuleReportTruthClass = (typeof CAPSULE_REPORT_TRUTH_CLASSES)[number];

/** Recoverable work preserved when a run stops early. Counts are captured
    facts about what was seen, not a claim that the work was correct. */
export interface CapsulePartialOutputReference {
  readonly referenceId: string;
  readonly capturedAt: string;
  readonly capturedBy: string;
  readonly truth: CapsuleReportTruthClass;
  readonly changedFileCount: number;
  readonly commandCount: number;
  readonly testCount: number;
  readonly findingCount: number;
  readonly unresolvedQuestionCount: number;
  readonly summaryRef?: string;
}

/** The agent's final structured report. Always an agent claim. */
export interface CapsuleFinalReportReference {
  readonly referenceId: string;
  readonly receivedAt: string;
  readonly reportedBy: string;
  readonly truth: 'agent_claim';
  readonly reportFormat: string;
  /** Digest of the report body, which the capsule never stores inline. */
  readonly bodyDigest?: string;
}

/** "I finished." Distinct from the report, and never verification. */
export interface CapsuleCompletionClaimReference {
  readonly referenceId: string;
  readonly claimedAt: string;
  readonly claimedBy: string;
  readonly truth: 'agent_claim';
  readonly claimedStatus: 'completed' | 'blocked' | 'failed';
  readonly summaryRef?: string;
}

/**
 * A completion claim NEVER establishes outcome, verification, or release —
 * those come from evidence and independent review through Milestone 1. This
 * predicate exists so callers can state that in code instead of in a comment.
 */
export function completionClaimEstablishesVerification(): false {
  return false;
}

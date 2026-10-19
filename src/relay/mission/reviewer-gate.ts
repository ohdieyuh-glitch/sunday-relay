import {
  computeOutputVisibility, reviewerIsIndependent, type OutputVisibility, type RelayEntitlement,
} from './entitlement';
import {
  openBlockingFindings, projectReviewLedger, type ProjectReviewInput, type ReviewLedgerProjection,
} from './review-repair';

/**
 * Reviewer Gate composite (Prompt 8.3) — PURE, Relay-owned. This is the single
 * decision a live reviewer adapter (or any client) asks Relay to make after a
 * review: it computes STRUCTURAL independence, projects the finding/repair
 * ledger, and derives the output-visibility release state — so the adapter
 * NEVER decides independence, findings, or release itself. Autonomous cannot
 * bypass it (mode is not an input). It mirrors how the completion evaluator is
 * the single Relay decision the coding-agent live-runner asks for.
 */

export interface IndependenceParty {
  agentId: string;
  sessionId: string | null;
  adapterId: string;
  independenceGroup: string;
}

export interface ReviewerGateInput {
  entitlement: RelayEntitlement;
  verificationPassed: boolean;
  runStatus: string;
  reviewer: IndependenceParty;
  implementer: IndependenceParty;
  /** The neutral ledger projection input (findings mapped from the report). */
  ledger: ProjectReviewInput;
  completionPolicySatisfied: boolean;
}

export interface ReviewerGateResult {
  independent: boolean;
  ledger: ReviewLedgerProjection;
  blockingFindingsOpen: number;
  visibility: OutputVisibility;
  reason: string;
}

export function evaluateReviewerGate(input: ReviewerGateInput): ReviewerGateResult {
  const independent = reviewerIsIndependent({
    reviewerAgentId: input.reviewer.agentId, reviewerSessionId: input.reviewer.sessionId,
    reviewerAdapterId: input.reviewer.adapterId, reviewerIndependenceGroup: input.reviewer.independenceGroup,
    implementerAgentId: input.implementer.agentId, implementerSessionId: input.implementer.sessionId,
    implementerAdapterId: input.implementer.adapterId, implementerIndependenceGroup: input.implementer.independenceGroup,
  });

  const ledger = projectReviewLedger(input.ledger);
  const blockingFindingsOpen = openBlockingFindings(ledger.findings).length;

  // A review counts as approved only when the final review approved AND no
  // blocking finding is open.
  const lastReview = input.ledger.reviews[input.ledger.reviews.length - 1];
  const reviewApproved = lastReview?.verdict === 'approved' && blockingFindingsOpen === 0;

  const { visibility, reason } = computeOutputVisibility({
    entitlement: input.entitlement,
    substantiveCoding: true,
    implementationReported: true,
    verificationPassed: input.verificationPassed,
    reviewerRequired: true,
    reviewOccurred: true,
    blockingFindingOpen: blockingFindingsOpen > 0,
    reviewApproved,
    reviewerIsIndependent: independent,
    completionPolicySatisfied: input.completionPolicySatisfied,
    runStatus: input.runStatus,
  });

  return { independent, ledger, blockingFindingsOpen, visibility, reason };
}

import type { MissionCompletionRule, MissionVerdict, MissionVerdictResult, RelayFinding, RelayReview } from './contracts';
import { openBlockingFindings } from './review-repair';

/**
 * Deterministic mission verdict engine (Prompt 8.1) — PURE. The eight
 * verdicts are NOT aliases. A free-text agent claim is never evidence, and
 * reviewer approval never substitutes for a missing or failed required test.
 * verified_complete requires EVERY condition; the engine reaches its verdict
 * deterministically and explains why.
 */

export interface MissionVerdictInput {
  completionRule: MissionCompletionRule;
  runStatus: string;
  /** The implementer returned a completion report (a claim, not proof). */
  implementationReported: boolean;
  /** Relay-produced verification of the required tests all passed. */
  requiredTestsPassed: boolean;
  /** Required evidence exists AND validates (Relay-produced). */
  evidenceSatisfied: boolean;
  /** Evidence references all resolve to real records. */
  evidenceReferencesResolve: boolean;
  /** Every required task reached verified/completed status. */
  requiredTasksVerified: boolean;
  reviews: readonly RelayReview[];
  findings: readonly RelayFinding[];
  /** The required independent review occurred AND approved the reviewed state. */
  requiredReviewApproved: boolean;
  /** Identity-sensitive executions (implementer, reviewer) are attested. */
  requiredAttestationsPresent: boolean;
  /** Repair and review counts stayed within the mission limits. */
  withinRepairAndReviewLimits: boolean;
}

export function evaluateMissionVerdict(input: MissionVerdictInput): MissionVerdictResult {
  const requiresReview = input.completionRule === 'all_blocking_criteria_and_independent_review';
  const openBlocking = openBlockingFindings(input.findings);
  const reviewOccurred = input.reviews.length > 0;
  const reviewApproved = input.reviews.some((r) => r.verdict === 'approved');

  const checks: MissionVerdictResult['checks'] = [
    { requirement: 'run reached verified completion', passed: input.runStatus === 'completed', detail: `run status = ${input.runStatus}` },
    { requirement: 'required tests passed', passed: input.requiredTestsPassed, detail: input.requiredTestsPassed ? 'Relay-produced tests passed' : 'required tests did not all pass' },
    { requirement: 'required evidence validates', passed: input.evidenceSatisfied, detail: input.evidenceSatisfied ? 'evidence present and valid' : 'required evidence missing or invalid' },
    { requirement: 'evidence references resolve', passed: input.evidenceReferencesResolve, detail: input.evidenceReferencesResolve ? 'all references resolve' : 'dangling evidence references' },
    { requirement: 'required tasks verified', passed: input.requiredTasksVerified, detail: input.requiredTasksVerified ? 'tasks verified' : 'a required task is not verified' },
    { requirement: 'no open blocking findings', passed: openBlocking.length === 0, detail: `${openBlocking.length} open blocking finding(s)` },
    { requirement: 'required independent review approved', passed: !requiresReview || input.requiredReviewApproved, detail: requiresReview ? (input.requiredReviewApproved ? 'independent review approved' : 'required independent review not approved') : 'review not required by policy' },
    { requirement: 'identity-sensitive executions attested', passed: input.requiredAttestationsPresent, detail: input.requiredAttestationsPresent ? 'attestations present' : 'a required execution lacks an attestation' },
    { requirement: 'within repair/review limits', passed: input.withinRepairAndReviewLimits, detail: input.withinRepairAndReviewLimits ? 'within limits' : 'repair/review limit exceeded' },
  ];
  const allPass = checks.every((c) => c.passed);

  let verdict: MissionVerdict;
  const reasons: string[] = [];

  if (input.runStatus === 'failed') {
    verdict = 'failed'; reasons.push('The run failed.');
  } else if (input.runStatus === 'cancelled') {
    verdict = 'blocked'; reasons.push('The run was cancelled before verification.');
  } else if (input.runStatus === 'checkpoint_required') {
    verdict = 'needs_human'; reasons.push('A checkpoint requires a human decision.');
  } else if (openBlocking.length > 0) {
    verdict = 'blocked'; reasons.push(`${openBlocking.length} blocking finding(s) remain open.`);
  } else if (!input.withinRepairAndReviewLimits) {
    verdict = 'blocked'; reasons.push('Repair or review limits were exceeded.');
  } else if (allPass) {
    verdict = 'verified_complete'; reasons.push('Every blocking completion requirement is satisfied with Relay-produced evidence.');
  } else if (requiresReview && input.requiredReviewApproved) {
    // Approved but something required (tests / evidence / attestation) is
    // missing — approval NEVER substitutes for a missing required test.
    verdict = 'approved';
    for (const c of checks) if (!c.passed) reasons.push(c.detail);
  } else if (reviewApproved) {
    verdict = 'approved'; reasons.push('The reviewer approved, but verification is incomplete.');
  } else if (reviewOccurred) {
    verdict = 'reviewed'; reasons.push('A review occurred; approval and verification are not complete.');
  } else if (input.implementationReported) {
    verdict = 'claimed_complete'; reasons.push('The implementer reported completion — a claim, not evidence.');
  } else {
    verdict = 'partially_complete'; reasons.push('Work is in progress.');
  }

  return {
    verdict, reasons, checks,
    blockingFindingsOpen: openBlocking.length,
    requiredReviewsSatisfied: !requiresReview || input.requiredReviewApproved,
    requiredAttestationsPresent: input.requiredAttestationsPresent,
    evidenceSatisfied: input.evidenceSatisfied,
    withinRepairAndReviewLimits: input.withinRepairAndReviewLimits,
  };
}

/** The intermediate verdict at the "claimed complete" moment — before any
 * verification or review — used by the timeline and presentation. */
export function claimedCompleteVerdict(): MissionVerdict {
  return 'claimed_complete';
}

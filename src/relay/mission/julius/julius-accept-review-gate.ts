import type { JuliusEvidence, JuliusTask, JuliusVerificationDecision } from './julius-runtime';
import { juliusSegmentSubjectTaskId } from './julius-segment-lineage';

/**
 * AN ACCEPT CITES THE REVIEW THAT LET IT HAPPEN.
 *
 * Where the policy requires an independent review, an accepted task used to cite
 * only its own evidence: the plan its `ARTIFACT`, the build its tool runs, `DIFF`
 * and `TEST`. Paid run 37039013641 and qualification attempt 36915013287 both
 * accepted every reviewed task with no `REVIEW_FINDING` id in `evidence_ids`. The
 * review that gated each acceptance was on the record, but the decision did not
 * name it, so a reader could not tell "accepted because the reviewer passed it"
 * from "accepted with no review at all".
 *
 * THE GATING REVIEW is the one whose verdict Julius APPLIED to the subject, the
 * latest `review.verdict.applied` row naming it, because that is the judgement the
 * decision acts on. It must be one that lets the work proceed:
 *   CONTINUE (PROCEED) and WARNING (RETAIN);
 *   a CHALLENGE that is not material (RECORD), which by design is argued while the
 *     work proceeds;
 *   a material CHALLENGE (HOLD) only once Julius has resolved the disagreement as
 *     ARCHITECT_UPHELD. That resolution exists only because the rebuttal's
 *     re-review said CONTINUE or WARNING, so the gating review is then that
 *     re-review, never the challenge it overruled.
 * Anything stricter, an applied verdict of nothing at all, or a review whose
 * accepted attempt left no PASSED `REVIEW_FINDING` to cite, does not gate an
 * ACCEPT. The pipeline then writes a HALT that names why. The evidence is that
 * review's accepted attempt (`juliusCurrentAttemptEvidence`), so a row a lost lease
 * left behind is never cited.
 *
 * A task that needs no review (the policy does not require one, or the task IS a
 * review) is unchanged, and so is every decision that is not an ACCEPT.
 *
 * Pure: the ledger rows and the evidence are read by the caller.
 */

/** What one `review.verdict.applied` row says. */
export interface JuliusAppliedReviewRow {
  /** The dispatch whose verdict was applied: the review, or the research continuation that concluded it. */
  readonly reviewTaskId: string;
  readonly reviewedTaskId: string;
  readonly verdict: string | null;
  readonly route: string;
}

/** A material disagreement about the subject that Julius resolved ARCHITECT_UPHELD. */
export interface JuliusUpheldDisagreement {
  readonly subjectTaskId: string;
  /** The re-review that decided it: the head of its dispatch lineage. */
  readonly reReviewTaskId: string;
}

export const JULIUS_ACCEPT_REVIEW_REFUSALS = ['REVIEW_NOT_APPLIED', 'REVIEW_NOT_PASSING', 'REVIEW_EVIDENCE_MISSING'] as const;
export type JuliusAcceptReviewRefusal = (typeof JULIUS_ACCEPT_REVIEW_REFUSALS)[number];

export type JuliusAcceptReviewGate =
  | { readonly outcome: 'NOT_REQUIRED' }
  | { readonly outcome: 'CITED'; readonly reviewTaskId: string; readonly evidenceIds: readonly string[] }
  | {
    readonly outcome: 'REFUSED'; readonly reasonCode: JuliusAcceptReviewRefusal;
    /** The review the refusal is about, when there is one, and the review rows it left. */
    readonly reviewTaskId: string | null; readonly evidenceIds: readonly string[];
  };

/** Thrown at the decision write: an ACCEPT that needed a passing review and does not cite one. */
export class JuliusAcceptReviewRefused extends Error {
  constructor(readonly reasonCode: JuliusAcceptReviewRefusal | 'REVIEW_NOT_CITED', readonly subjectTaskId: string) {
    super(`julius_accept_review_refused:${reasonCode}`);
    this.name = 'JuliusAcceptReviewRefused';
  }
}

const PASSING_VERDICTS: ReadonlySet<string> = new Set(['CONTINUE', 'WARNING']);
const PROCEEDING_ROUTES: ReadonlySet<string> = new Set(['PROCEED', 'RETAIN']);

/**
 * Whether an applied verdict lets the work it judged be accepted. A re-review
 * gates only the held work Julius resolved for, so it passes only when it was
 * reached through that ARCHITECT_UPHELD resolution, never as a subject's own
 * applied row.
 */
function letsTheWorkProceed(row: JuliusAppliedReviewRow, throughResolution: boolean): boolean {
  if (row.route === 'RECORD') return row.verdict === 'CHALLENGE';
  if (row.route === 'RE_REVIEW') return throughResolution && row.verdict !== null && PASSING_VERDICTS.has(row.verdict);
  return PROCEEDING_ROUTES.has(row.route) && row.verdict !== null && PASSING_VERDICTS.has(row.verdict);
}

/** The head of a dispatch lineage, read from the id alone: `segment:<subject>:<n>:task` names its subject. */
function lineageHeadOf(taskId: string): string {
  let current = taskId;
  for (let subject = juliusSegmentSubjectTaskId(current); subject !== null; subject = juliusSegmentSubjectTaskId(current)) current = subject;
  return current;
}

export function juliusAcceptReviewGate(input: {
  readonly subject: Pick<JuliusTask, 'taskId' | 'role'>;
  /** The policy's `reviewerRequired`. */
  readonly reviewerRequired: boolean;
  /** Every `review.verdict.applied` row of the run, in ledger order. */
  readonly applied: readonly JuliusAppliedReviewRow[];
  readonly upheld: readonly JuliusUpheldDisagreement[];
  /** The run's evidence reduced to each task's accepted attempt. */
  readonly evidence: readonly Pick<JuliusEvidence, 'evidenceId' | 'taskId' | 'type' | 'status'>[];
}): JuliusAcceptReviewGate {
  if (!input.reviewerRequired || input.subject.role === 'INDEPENDENT_REVIEWER') return { outcome: 'NOT_REQUIRED' };
  const own = input.applied.filter((row) => row.reviewedTaskId === input.subject.taskId).at(-1);
  if (own === undefined) return { outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_APPLIED', reviewTaskId: null, evidenceIds: [] };

  let gating = own;
  let throughResolution = false;
  if (own.route === 'HOLD') {
    const reReviews = new Set(input.upheld.filter((item) => item.subjectTaskId === input.subject.taskId).map((item) => item.reReviewTaskId));
    const reReview = input.applied.filter((row) => row.route === 'RE_REVIEW' && reReviews.has(lineageHeadOf(row.reviewTaskId))).at(-1);
    if (reReview !== undefined) {
      gating = reReview;
      throughResolution = true;
    }
  }

  const rows = input.evidence.filter((item) => item.taskId === gating.reviewTaskId && item.type === 'REVIEW_FINDING');
  const refused = (reasonCode: JuliusAcceptReviewRefusal): JuliusAcceptReviewGate =>
    ({ outcome: 'REFUSED', reasonCode, reviewTaskId: gating.reviewTaskId, evidenceIds: rows.map((item) => item.evidenceId) });
  if (!letsTheWorkProceed(gating, throughResolution) || rows.some((item) => item.status === 'FAILED')) return refused('REVIEW_NOT_PASSING');
  const passed = rows.filter((item) => item.status === 'PASSED').map((item) => item.evidenceId);
  if (passed.length === 0) return refused('REVIEW_EVIDENCE_MISSING');
  return { outcome: 'CITED', reviewTaskId: gating.reviewTaskId, evidenceIds: passed };
}

/**
 * THE DECISION THE GATE ALLOWS. A cited ACCEPT carries the review's ids after
 * the subject's own; a refused one becomes a HALT naming the refusal and the
 * review it is about. Anything else passes through untouched.
 */
export function juliusDecisionUnderReviewGate(
  decision: JuliusVerificationDecision,
  gate: JuliusAcceptReviewGate,
  subjectTaskId: string,
): JuliusVerificationDecision {
  if (decision.action !== 'ACCEPT' || gate.outcome === 'NOT_REQUIRED') return decision;
  if (gate.outcome === 'CITED') {
    return { ...decision, evidenceIds: [...new Set([...decision.evidenceIds, ...gate.evidenceIds])] };
  }
  return {
    action: 'HALT', reasonCode: gate.reasonCode,
    evidenceIds: [...new Set([...decision.evidenceIds, ...gate.evidenceIds])],
    safeSummary: `Julius did not accept ${subjectTaskId}: it needs a passing independent review it can cite (${gate.reasonCode}${gate.reviewTaskId === null ? '' : `, review ${gate.reviewTaskId}`}).`,
  };
}

/**
 * THE LAST LINE, AT THE WRITE. However the decision was reached, an ACCEPT whose
 * subject needed a review is written only if the gate cited one and the decision
 * carries every id it cited.
 */
export function assertJuliusAcceptCitesReview(decision: JuliusVerificationDecision, gate: JuliusAcceptReviewGate, subjectTaskId: string): void {
  if (decision.action !== 'ACCEPT' || gate.outcome === 'NOT_REQUIRED') return;
  if (gate.outcome === 'REFUSED') throw new JuliusAcceptReviewRefused(gate.reasonCode, subjectTaskId);
  if (!gate.evidenceIds.every((id) => decision.evidenceIds.includes(id))) throw new JuliusAcceptReviewRefused('REVIEW_NOT_CITED', subjectTaskId);
}

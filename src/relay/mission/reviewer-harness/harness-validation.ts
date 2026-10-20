import {
  FORBIDDEN_REVIEWER_TOOLS, REVIEWER_TOOLS,
  type IndependenceAssessment, type ProposedFinding, type ProposedReviewResult,
  type ProposedVerdict, type ReviewerIdentityEvidence, type ReviewerTool,
} from './harness-contracts';

/**
 * WHAT RELAY DOES WITH WHAT A HARNESS SAYS.
 *
 * Three gates, each protecting a rule the product depends on:
 *   1. TOOLS — the Reviewer is read-only. Grants are an ALLOWLIST, so a
 *      write tool cannot be granted by adding it to a request.
 *   2. FINDINGS AND VERDICT — a malformed proposal is rejected outright. It
 *      never becomes a partial finding and never becomes an accepted verdict.
 *   3. INDEPENDENCE — unknown identity yields `unknown`, never `independent`.
 *      A different harness NAME proves nothing.
 */

/* ---------------------------------------------------------------- tools */

export interface ToolGrantResult {
  readonly granted: readonly ReviewerTool[];
  /** Anything requested that the Reviewer role may never hold. */
  readonly refused: readonly string[];
}

/**
 * Grant Reviewer tools by ALLOWLIST. Anything outside `REVIEWER_TOOLS` is
 * refused — including every write, deploy or permission-changing tool —
 * because the safe list is what is enumerated, not what is forbidden.
 */
export function grantReviewerTools(requested: readonly string[]): ToolGrantResult {
  const granted: ReviewerTool[] = [];
  const refused: string[] = [];
  for (const tool of requested) {
    if ((REVIEWER_TOOLS as readonly string[]).includes(tool)) {
      granted.push(tool as ReviewerTool);
    } else {
      refused.push(tool);
    }
  }
  return { granted, refused };
}

/** True when a tool name is one the Reviewer role must never hold. */
export const isForbiddenReviewerTool = (tool: string): boolean =>
  FORBIDDEN_REVIEWER_TOOLS.includes(tool) || !(REVIEWER_TOOLS as readonly string[]).includes(tool);

/* ------------------------------------------------------------- findings */

export type FindingValidation =
  | { readonly ok: true; readonly finding: ProposedFinding }
  | { readonly ok: false; readonly reason: string };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const stringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

export function validateProposedFinding(raw: unknown): FindingValidation {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'finding is not an object' };
  }
  const f = raw as Record<string, unknown>;
  if (!nonEmpty(f.proposedId)) return { ok: false, reason: 'finding has no id' };
  if (!nonEmpty(f.title)) return { ok: false, reason: 'finding has no title' };
  if (!nonEmpty(f.description)) return { ok: false, reason: 'finding has no description' };
  if (!nonEmpty(f.impact)) return { ok: false, reason: 'finding has no impact' };
  if (!nonEmpty(f.recommendedRepair)) return { ok: false, reason: 'finding has no recommended repair' };
  if (!['critical', 'high', 'major', 'minor'].includes(f.severity as string)) {
    return { ok: false, reason: `finding severity "${String(f.severity)}" is not a canonical severity` };
  }
  if (!stringArray(f.affectedFiles)) return { ok: false, reason: 'affectedFiles must be strings' };
  if (!stringArray(f.evidenceRefs)) return { ok: false, reason: 'evidenceRefs must be strings' };
  if (typeof f.blocking !== 'boolean') return { ok: false, reason: 'blocking must be a boolean' };
  return {
    ok: true,
    finding: {
      proposedId: f.proposedId,
      severity: f.severity as ProposedFinding['severity'],
      title: f.title,
      description: f.description,
      affectedFiles: f.affectedFiles,
      evidenceRefs: f.evidenceRefs,
      reproduction: nonEmpty(f.reproduction) ? f.reproduction : null,
      impact: f.impact,
      recommendedRepair: f.recommendedRepair,
      blocking: f.blocking,
    },
  };
}

export type ResultValidation =
  | { readonly ok: true; readonly result: ProposedReviewResult }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate the whole proposed result. A clean review with NO findings is
 * perfectly valid — Relay never requires a finding to make a review look
 * useful — but one malformed finding invalidates the result rather than
 * being quietly dropped.
 */
export function validateProposedResult(raw: unknown): ResultValidation {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'result is not an object' };
  }
  const r = raw as Record<string, unknown>;
  if (!(['passed', 'blocked', 'needs_changes', 'inconclusive'] as string[])
    .includes(r.verdict as string)) {
    return { ok: false, reason: `verdict "${String(r.verdict)}" is not a proposable verdict` };
  }
  if (!nonEmpty(r.summary)) return { ok: false, reason: 'result has no summary' };
  if (!Array.isArray(r.findings)) return { ok: false, reason: 'findings must be an array' };
  if (!stringArray(r.inspectedEvidenceRefs)) {
    return { ok: false, reason: 'inspectedEvidenceRefs must be strings' };
  }
  const findings: ProposedFinding[] = [];
  for (const candidate of r.findings) {
    const validated = validateProposedFinding(candidate);
    if (!validated.ok) return { ok: false, reason: `malformed finding: ${validated.reason}` };
    findings.push(validated.finding);
  }
  // A "passed" verdict carrying blocking findings contradicts itself.
  if (r.verdict === 'passed' && findings.some((f) => f.blocking)) {
    return { ok: false, reason: 'a passed verdict cannot carry blocking findings' };
  }
  return {
    ok: true,
    result: {
      verdict: r.verdict as ProposedVerdict,
      summary: r.summary,
      findings,
      inspectedEvidenceRefs: r.inspectedEvidenceRefs,
    },
  };
}

/**
 * TRANSLATE a validated proposal into Relay's canonical verdict — or refuse.
 *
 * A completed harness run is not automatically a passed review: only
 * `passed` with no blocking findings becomes `approved`, and `inconclusive`
 * becomes nothing at all, because Relay has learned nothing it can act on.
 */
export function validatedVerdictFor(
  result: ProposedReviewResult,
): 'approved' | 'changes_requested' | null {
  if (result.verdict === 'inconclusive') return null;
  if (result.findings.some((f) => f.blocking)) return 'changes_requested';
  if (result.verdict === 'passed') return 'approved';
  return 'changes_requested';
}

/** Blocking findings, the only kind that forces repair. */
export const blockingFindings = (result: ProposedReviewResult): readonly ProposedFinding[] =>
  result.findings.filter((f) => f.blocking);

/* --------------------------------------------------------- independence */

/**
 * Assess reviewer independence from IDENTITY EVIDENCE.
 *
 * Mirrors the existing `reviewerIsIndependent` rules, with one addition the
 * boolean cannot express: when the evidence is missing, the answer is
 * `unknown`. A different harness NAME is never, by itself, independence —
 * a reviewer harness driving the same authenticated session as the author is
 * the exact case this exists to catch, however differently it is branded.
 */
export function assessIndependence(input: {
  author: ReviewerIdentityEvidence;
  reviewer: ReviewerIdentityEvidence;
}): IndependenceAssessment {
  const { author, reviewer } = input;
  const reasons: string[] = [];

  const providerDiversity: IndependenceAssessment['providerDiversity'] =
    author.provider === null || reviewer.provider === null
      ? 'unknown'
      : author.provider === reviewer.provider ? 'same' : 'different';

  // Any positive match is disqualifying, whatever else differs.
  if (author.agentId !== null && author.agentId === reviewer.agentId) {
    reasons.push('the reviewer and the author are the same actual agent');
  }
  if (author.sessionId !== null && author.sessionId === reviewer.sessionId) {
    reasons.push('the reviewer and the author share one authenticated session');
  }
  if (author.adapterId !== null && author.adapterId === reviewer.adapterId) {
    reasons.push('the reviewer and the author use the same adapter');
  }
  if (author.independenceGroup !== null
    && author.independenceGroup === reviewer.independenceGroup) {
    reasons.push('the reviewer and the author are in the same independence group');
  }
  if (author.humanId !== null && author.humanId === reviewer.humanId) {
    reasons.push('the reviewer and the author are the same human');
  }
  if (reasons.length > 0) {
    return { verdict: 'not_independent', reasons, providerDiversity };
  }

  // Nothing disqualified it — but absent identity proves nothing either.
  const missing: string[] = [];
  for (const [label, pair] of [
    ['agent identity', [author.agentId, reviewer.agentId]],
    ['session identity', [author.sessionId, reviewer.sessionId]],
    ['adapter identity', [author.adapterId, reviewer.adapterId]],
  ] as const) {
    if (pair[0] === null || pair[1] === null) missing.push(label);
  }
  if (missing.length > 0) {
    return {
      verdict: 'unknown',
      reasons: [`independence cannot be established: ${missing.join(', ')} is unknown`],
      providerDiversity,
    };
  }

  return {
    verdict: 'independent',
    reasons: ['agent, session, adapter and independence group all differ'],
    providerDiversity,
  };
}

export const UNKNOWN_INDEPENDENCE: IndependenceAssessment = Object.freeze({
  verdict: 'unknown',
  reasons: ['no reviewer identity evidence has been recorded'],
  providerDiversity: 'unknown',
});

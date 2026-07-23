import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  REVIEW_REPORT_MARKER, type RelayReviewReport, type ReviewReportFinding,
  type ReviewReportVerdict, type ReviewFindingSeverity, type CodexReviewerLimits,
} from './contracts';

/**
 * Codex Reviewer report parser (Prompt 8.3) — PURE and STRICT. Extracts and
 * validates the RELAY_REVIEW_REPORT_V1 claim from either a schema-constrained
 * final message (JSON object directly) or a marked block. The report remains a
 * CLAIM until Relay attests the execution and accepts the verdict — this
 * parser NEVER invents an approved verdict, and rejects secret-shaped or
 * hidden-reasoning content, id/revision mismatches, and verdicts unsupported
 * by their findings.
 */

const SECRET_SHAPE = /(sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.|ya29\.[A-Za-z0-9_-]{10,})/;
const HIDDEN_REASONING = /(chain[_ -]?of[_ -]?thought|<thinking|hidden reasoning|internal monologue|system prompt:)/i;

const VERDICTS: ReviewReportVerdict[] = ['approved', 'changes_required', 'blocked', 'needs_human'];
const SEVERITIES: ReviewFindingSeverity[] = ['informational', 'low', 'medium', 'high', 'critical'];

export interface ExpectedReview {
  reviewId: string;
  missionId: string;
  taskId: string;
  missionRevision: number;
  taskRevision: number;
  workspaceRevision: string;
}

/** Locate the JSON object: prefer a direct parse (schema output), else the
 * LAST marker + a balanced-brace scan (marked output). */
function extractJson(finalText: string): RelayResult<Record<string, unknown>> {
  const direct = finalText.trim();
  if (direct.startsWith('{')) {
    try {
      const parsed = JSON.parse(direct);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return ok(parsed as Record<string, unknown>);
    } catch {
      /* fall through to marker scan */
    }
  }
  const markerIdx = finalText.lastIndexOf(REVIEW_REPORT_MARKER);
  if (markerIdx < 0) return fail(relayError('invalid-report', 'Review report marker not found.'));
  const braceStart = finalText.indexOf('{', markerIdx);
  if (braceStart < 0) return fail(relayError('invalid-report', 'No JSON object after the review report marker.'));
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < finalText.length; i += 1) {
    const ch = finalText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = finalText.slice(braceStart, i + 1);
        try {
          const parsed = JSON.parse(slice);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return ok(parsed as Record<string, unknown>);
          return fail(relayError('invalid-report', 'Review report is not a JSON object.'));
        } catch {
          return fail(relayError('invalid-report', 'Malformed JSON in the review report.'));
        }
      }
    }
  }
  return fail(relayError('invalid-report', 'Unclosed JSON object in the review report.'));
}

const asStringArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;

export function parseReviewReport(
  finalText: string | null,
  expected: ExpectedReview,
  limits: CodexReviewerLimits,
): RelayResult<RelayReviewReport> {
  if (!finalText || !finalText.trim()) {
    return fail(relayError('invalid-report', 'The reviewer produced no final report.'));
  }
  if (SECRET_SHAPE.test(finalText)) {
    return fail(relayError('invalid-report', 'Review report contains secret-shaped content — rejected.'));
  }
  if (HIDDEN_REASONING.test(finalText)) {
    return fail(relayError('invalid-report', 'Review report contains hidden-reasoning content — rejected.'));
  }

  const extracted = extractJson(finalText);
  if (!extracted.ok) return extracted;
  const obj = extracted.value;

  const verdict = obj.verdict;
  if (typeof verdict !== 'string' || !VERDICTS.includes(verdict as ReviewReportVerdict)) {
    return fail(relayError('invalid-report', 'Review verdict is missing or invalid.'));
  }
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) {
    return fail(relayError('invalid-report', 'Review summary is required.'));
  }

  // Identity + revision matching — a mismatch is a REJECTION, never a rewrite.
  if (obj.reviewId !== expected.reviewId) return fail(relayError('invalid-report', 'Review id does not match the assigned review.'));
  if (obj.missionId !== expected.missionId) return fail(relayError('invalid-report', 'Mission id mismatch.'));
  if (obj.taskId !== expected.taskId) return fail(relayError('invalid-report', 'Task id mismatch.'));
  if (obj.reviewedMissionRevision !== expected.missionRevision) return fail(relayError('invalid-report', 'Reviewed mission revision mismatch.'));
  if (obj.reviewedTaskRevision !== expected.taskRevision) return fail(relayError('invalid-report', 'Reviewed task revision mismatch.'));
  if (obj.reviewedWorkspaceRevision !== expected.workspaceRevision) return fail(relayError('invalid-report', 'Reviewed workspace revision mismatch.'));

  const rawFindings = Array.isArray(obj.findings) ? obj.findings : null;
  if (rawFindings === null) return fail(relayError('invalid-report', 'Review findings must be an array.'));
  if (rawFindings.length > limits.maxFindings) {
    return fail(relayError('invalid-report', `Review exceeds the maximum of ${limits.maxFindings} findings.`));
  }

  const findings: ReviewReportFinding[] = [];
  for (const rf of rawFindings) {
    if (!rf || typeof rf !== 'object') return fail(relayError('invalid-report', 'A finding is not an object.'));
    const f = rf as Record<string, unknown>;
    if (typeof f.severity !== 'string' || !SEVERITIES.includes(f.severity as ReviewFindingSeverity)) {
      return fail(relayError('invalid-report', 'A finding has an invalid severity.'));
    }
    if (typeof f.title !== 'string' || !f.title.trim()) return fail(relayError('invalid-report', 'A finding is missing a title.'));
    if (typeof f.description !== 'string') return fail(relayError('invalid-report', 'A finding is missing a description.'));
    if (f.description.length > limits.maxFindingDescriptionChars) {
      return fail(relayError('invalid-report', 'A finding description exceeds the size limit.'));
    }
    const evidence = asStringArray(f.evidence) ?? [];
    const affectedFiles = asStringArray(f.affectedFiles) ?? [];
    const affectedCriterionIds = asStringArray(f.affectedCriterionIds) ?? [];
    if (evidence.length > limits.maxEvidencePerFinding) {
      return fail(relayError('invalid-report', 'A finding has too many evidence references.'));
    }
    const blocking = f.blocking === true;
    const requiredAction = typeof f.requiredAction === 'string' ? f.requiredAction : '';

    // A blocking finding requires an affected criterion, evidence, and a
    // bounded required action.
    if (blocking) {
      if (affectedCriterionIds.length === 0) return fail(relayError('invalid-report', 'A blocking finding must identify an affected criterion.'));
      if (evidence.length === 0) return fail(relayError('invalid-report', 'A blocking finding must cite evidence.'));
      if (!requiredAction.trim()) return fail(relayError('invalid-report', 'A blocking finding must specify a required action.'));
    }

    findings.push({
      severity: f.severity as ReviewFindingSeverity,
      title: f.title, description: f.description, evidence, affectedFiles,
      affectedCriterionIds, requiredAction, blocking,
    });
  }

  const hasBlocking = findings.some((f) => f.blocking);
  const hasActionable = findings.length > 0;

  // Verdict/finding coherence.
  if (verdict === 'changes_required' && !hasActionable) {
    return fail(relayError('invalid-report', 'changes_required requires at least one actionable finding.'));
  }
  if (verdict === 'approved' && hasBlocking) {
    return fail(relayError('invalid-report', 'approved cannot carry a blocking finding.'));
  }

  const report: RelayReviewReport = {
    reviewId: expected.reviewId, missionId: expected.missionId, taskId: expected.taskId,
    reviewedMissionRevision: expected.missionRevision, reviewedTaskRevision: expected.taskRevision,
    reviewedWorkspaceRevision: expected.workspaceRevision,
    reviewerRole: typeof obj.reviewerRole === 'string' ? obj.reviewerRole : 'independent_coding_reviewer',
    verdict: verdict as ReviewReportVerdict,
    summary: obj.summary,
    findings,
    evidenceReviewed: asStringArray(obj.evidenceReviewed) ?? [],
    limitations: asStringArray(obj.limitations) ?? [],
  };
  return ok(report);
}

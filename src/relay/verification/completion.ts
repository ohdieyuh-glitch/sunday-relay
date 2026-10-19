import type { CompletionPolicy, EvidenceRecord, RelayTask, ReviewerVerdictRecord } from '../protocol/contracts';
import type { Enforcement, Provenance } from '../protocol/enums';
import { validateEvidenceFreshness } from '../coordination/checks';

/**
 * Low-risk CompletionPolicy evaluation (Prompt 3, PROTOCOL §3.5).
 * Consumes Relay-produced EvidenceRecords ONLY — agent claims can never
 * satisfy evidence requirements (they are not EvidenceRecords). Statuses
 * are honest: unavailable is never passed; unverified is neither passed nor
 * failed; simulated evidence satisfies only a policy that explicitly
 * accepts simulated provenance.
 */

export type CompletionOutcome = 'satisfied' | 'unsatisfied' | 'failed' | 'stale' | 'unsupported' | 'checkpoint_required';

export interface RequirementResult {
  requirement: string;
  status: 'satisfied' | 'missing' | 'failed' | 'stale' | 'unverified' | 'unavailable' | 'provenance-rejected' | 'verifier-rejected';
  evidenceId?: string;
  detail: string;
}

export interface CompletionPolicyResult {
  outcome: CompletionOutcome;
  requirements: RequirementResult[];
  satisfied: string[];
  missing: string[];
  failed: string[];
  stale: string[];
  unsupportedEnforcement: string[];
  reviewerIndependence: 'satisfied' | 'missing' | 'not-independent' | 'not-required';
  unresolvedBlockingFindings: string[];
  revisionMatch: boolean;
  recommendedAction: string;
  safeSummary: string;
}

export interface CompletionEvaluationInput {
  policy: CompletionPolicy;
  task: RelayTask;
  evidence: readonly EvidenceRecord[];
  reviewerVerdict?: ReviewerVerdictRecord;
  /** Findings resolved so far (by id) — blocking findings must be gone. */
  resolvedFindingIds?: readonly string[];
  currentRepositoryRevision?: string;
  currentTime: string;
  /** What the current adapter path can actually enforce (Decision 5). */
  enforcementCapabilities?: Readonly<Record<string, Enforcement>>;
}

const requirementLabel = (r: { evidenceType: string; command?: string }) =>
  r.command ? `${r.evidenceType}:${r.command}` : r.evidenceType;

export function evaluateCompletionPolicy(input: CompletionEvaluationInput): CompletionPolicyResult {
  const { policy, task, evidence, reviewerVerdict, resolvedFindingIds = [], currentRepositoryRevision, currentTime, enforcementCapabilities = {} } = input;
  const acceptedProvenance: readonly Provenance[] = policy.acceptedProvenance ?? ['live'];
  const requirements: RequirementResult[] = [];

  for (const req of policy.requiredEvidence) {
    const label = requirementLabel(req);
    const candidates = evidence.filter(
      (e) =>
        e.taskId === task.taskId &&
        e.runId === task.runId &&
        e.evidenceType === req.evidenceType &&
        (req.command === undefined || e.command === req.command),
    );
    if (candidates.length === 0) {
      requirements.push({ requirement: label, status: 'missing', detail: 'No matching Relay-produced evidence (agent claims never count).' });
      continue;
    }
    const record = candidates[candidates.length - 1];
    if (!acceptedProvenance.includes(record.provenance)) {
      requirements.push({
        requirement: label, status: 'provenance-rejected', evidenceId: record.evidenceId,
        detail: `Evidence provenance ${record.provenance} is not accepted by this ${acceptedProvenance.join('/')}-only policy.`,
      });
      continue;
    }
    if (policy.allowedVerifiers && !policy.allowedVerifiers.includes(record.verifier)) {
      requirements.push({ requirement: label, status: 'verifier-rejected', evidenceId: record.evidenceId, detail: `Verifier ${record.verifier} is not allowed by policy.` });
      continue;
    }
    const freshness = validateEvidenceFreshness(record, { baseRevision: currentRepositoryRevision, now: currentTime });
    if (freshness.status === 'stale_blocking') {
      requirements.push({ requirement: label, status: 'stale', evidenceId: record.evidenceId, detail: freshness.detail });
      continue;
    }
    switch (record.verificationStatus) {
      case 'passed':
        requirements.push({ requirement: label, status: 'satisfied', evidenceId: record.evidenceId, detail: 'Verified and passing.' });
        break;
      case 'failed':
        requirements.push({
          requirement: label,
          status: req.mustPass ? 'failed' : 'satisfied',
          evidenceId: record.evidenceId,
          detail: req.mustPass ? 'Required check failed.' : 'Check failed but is not required to pass.',
        });
        break;
      case 'unavailable':
        requirements.push({ requirement: label, status: 'unavailable', evidenceId: record.evidenceId, detail: 'Check unavailable — never treated as passed.' });
        break;
      case 'unverified':
      case 'pending':
      case 'requires_approval':
        requirements.push({ requirement: label, status: 'unverified', evidenceId: record.evidenceId, detail: `Evidence is ${record.verificationStatus} — neither passed nor failed.` });
        break;
    }
  }

  const unsupportedEnforcement = policy.enforcementRequirements
    .filter((req) => {
      const capability = enforcementCapabilities[req.control] ?? 'unsupported';
      const order: Enforcement[] = ['unsupported', 'advisory', 'enforced'];
      return order.indexOf(capability) < order.indexOf(req.minimumLevel);
    })
    .map((req) => req.control);

  let reviewerIndependence: CompletionPolicyResult['reviewerIndependence'] = 'not-required';
  const unresolvedBlockingFindings: string[] = [];
  if (policy.requiresIndependentReview) {
    if (!reviewerVerdict) reviewerIndependence = 'missing';
    else if (!reviewerVerdict.independent) reviewerIndependence = 'not-independent';
    else {
      reviewerIndependence = 'satisfied';
      for (const finding of reviewerVerdict.findings) {
        if (!resolvedFindingIds.includes(finding.id)) unresolvedBlockingFindings.push(finding.id);
      }
    }
  }

  const satisfied = requirements.filter((r) => r.status === 'satisfied').map((r) => r.requirement);
  const missing = requirements.filter((r) => ['missing', 'unverified', 'unavailable', 'provenance-rejected', 'verifier-rejected'].includes(r.status)).map((r) => r.requirement);
  const failed = requirements.filter((r) => r.status === 'failed').map((r) => r.requirement);
  const stale = requirements.filter((r) => r.status === 'stale').map((r) => r.requirement);
  const revisionMatch = stale.length === 0;

  let outcome: CompletionOutcome;
  if (unsupportedEnforcement.length > 0) outcome = policy.riskLevel === 'high' ? 'checkpoint_required' : 'unsupported';
  else if (failed.length > 0) outcome = 'failed';
  else if (stale.length > 0) outcome = 'stale';
  else if (missing.length > 0 || reviewerIndependence === 'missing' || reviewerIndependence === 'not-independent' || unresolvedBlockingFindings.length > 0) outcome = 'unsatisfied';
  else outcome = 'satisfied';

  const recommendedAction =
    outcome === 'satisfied' ? 'Proceed to completion.' :
    outcome === 'failed' ? 'Address the failing checks (repair or checkpoint).' :
    outcome === 'stale' ? 'Re-run verification at the current repository revision.' :
    outcome === 'unsupported' || outcome === 'checkpoint_required' ? 'Escalate: required enforcement is unsupported on this path.' :
    'Collect the missing evidence / independent review.';

  return {
    outcome, requirements, satisfied, missing, failed, stale, unsupportedEnforcement,
    reviewerIndependence, unresolvedBlockingFindings, revisionMatch, recommendedAction,
    safeSummary: `Completion ${outcome}: ${satisfied.length} satisfied, ${missing.length} missing, ${failed.length} failed, ${stale.length} stale.`,
  };
}

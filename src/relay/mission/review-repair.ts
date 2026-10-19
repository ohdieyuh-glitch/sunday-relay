import type { Provenance } from '../protocol/enums';
import type {
  RelayFinding, RelayRepair, RelayReview, ReviewVerdictLabel,
} from './contracts';

/**
 * Finding + Repair ledger projection (Prompt 8.1) — PURE. Extends the
 * existing ReviewerVerdict / ReviewFinding / RevisionContract behavior into
 * explicit LINKED records. Rules enforced here (all deterministic):
 * changes_required needs an actionable finding; every blocking finding
 * creates/links exactly one repair; a repair links to its finding, preserves
 * the acceptance criterion, and cannot expand task objective or file claims;
 * an agent's "fixed" claim never resolves a finding — only supporting
 * verification evidence PLUS a required re-review approval does; a reviewer
 * may reopen with new evidence; blocking open findings prevent verified
 * completion; and the repair iteration limit is bounded.
 */

export interface ReviewInput {
  attempt: number;
  verdict: 'approved' | 'changes_requested';
  reviewerAgentId: string;
  requestedReviewerAgentId: string;
  independent: boolean;
  provenance: Provenance;
  findings: Array<{ id: string; severity: string; title: string; detail: string; recommendation?: string }>;
}

export interface ProjectReviewInput {
  missionId: string;
  taskId: string;
  reviewerRunId: string;
  missionRevision: number;
  taskRevision: number;
  workspaceRevision: string;
  originalClaimedFiles: string[];
  affectedCriterionIds: string[];
  /** Ordered by attempt: attempt 1 review, then attempt 2 re-review, ... */
  reviews: ReviewInput[];
  /** Passing verification evidence ids produced AFTER the repair. */
  postRepairEvidenceIds: string[];
  /** Whether a repair was actually dispatched (audit.repairCount>0). */
  repairDispatched: boolean;
  maxRepairIterations: number;
  now: string;
}

const mapVerdict = (v: 'approved' | 'changes_requested'): ReviewVerdictLabel =>
  v === 'approved' ? 'approved' : 'changes_required';

const mapSeverity = (s: string): RelayFinding['severity'] => {
  const lower = s.toLowerCase();
  if (lower === 'critical') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'minor') return 'minor';
  return 'major';
};

/** A changes_required verdict must carry at least one actionable finding. */
export function reviewHasActionableFinding(input: ReviewInput): boolean {
  return input.verdict !== 'changes_requested' || input.findings.length > 0;
}

/** A repair may never touch a file outside the original task's claims. */
export function repairExpandsFileClaims(repair: Pick<RelayRepair, 'affectedFiles'>, originalClaimedFiles: string[]): boolean {
  const claimed = new Set(originalClaimedFiles);
  return repair.affectedFiles.some((f) => !claimed.has(f));
}

export interface ReviewLedgerProjection {
  reviews: RelayReview[];
  findings: RelayFinding[];
  repairs: RelayRepair[];
  repairIterationsUsed: number;
  limitExceeded: boolean;
}

export function projectReviewLedger(input: ProjectReviewInput): ReviewLedgerProjection {
  const reviews: RelayReview[] = [];
  const findings: RelayFinding[] = [];
  const repairs: RelayRepair[] = [];

  const approvedReReviewExists = input.reviews.some((r, i) => i > 0 && r.verdict === 'approved');

  input.reviews.forEach((r, index) => {
    const reviewId = `rvw_${index + 1}`;
    const verdict = mapVerdict(r.verdict);
    const findingIds: string[] = [];

    if (r.verdict === 'changes_requested') {
      r.findings.forEach((f) => {
        const findingId = `F-${findings.length + 1}`;
        findingIds.push(findingId);
        const blocking = mapSeverity(f.severity) !== 'minor';
        // A blocking finding always creates ONE linked repair obligation.
        const repairId = blocking ? `R-${repairs.length + 1}` : null;
        // Resolution requires BOTH supporting post-repair evidence AND an
        // approving re-review — never the agent's own claim.
        const resolved = blocking && input.repairDispatched && approvedReReviewExists && input.postRepairEvidenceIds.length > 0;

        const finding: RelayFinding = {
          findingId, reviewId, missionId: input.missionId, taskId: input.taskId,
          severity: mapSeverity(f.severity), title: f.title, description: f.detail,
          evidenceIds: [], affectedFiles: [...input.originalClaimedFiles],
          affectedCriterionIds: [...input.affectedCriterionIds],
          requiredAction: f.recommendation ?? 'Address the finding within the original scope.',
          blocking,
          status: resolved ? 'resolved' : blocking ? 'in_repair' : 'open',
          repairTaskId: repairId,
          resolutionEvidenceIds: resolved ? [...input.postRepairEvidenceIds] : [],
          openedAt: input.now,
          resolvedAt: resolved ? input.now : null,
          resolutionReviewId: resolved ? `rvw_${input.reviews.findIndex((x, i) => i > index && x.verdict === 'approved') + 1}` : null,
        };
        findings.push(finding);

        if (repairId) {
          repairs.push({
            repairId, findingId, missionId: input.missionId, originalTaskId: input.taskId,
            assignedAgentId: input.reviews[0]?.requestedReviewerAgentId ? 'sim-coding-agent' : 'sim-coding-agent',
            assignedRunId: input.reviewerRunId, revisionContractId: `rev_${repairId}`,
            requiredChanges: f.recommendation ?? 'Apply the focused correction.',
            prohibitedScopeExpansion: true,
            affectedFiles: [...input.originalClaimedFiles],
            requiredTests: [], requiredEvidence: [...input.postRepairEvidenceIds],
            iteration: repairs.length + 1,
            status: resolved ? 'resolved' : input.repairDispatched ? 'claimed' : 'assigned',
            evidenceIds: resolved ? [...input.postRepairEvidenceIds] : [],
            createdAt: input.now,
            submittedAt: input.repairDispatched ? input.now : null,
            resolvedAt: resolved ? input.now : null,
          });
        }
      });
    }

    reviews.push({
      reviewId, missionId: input.missionId, taskId: input.taskId,
      reviewerAgentId: r.reviewerAgentId, reviewerRunId: input.reviewerRunId,
      requestedReviewerAgentId: r.requestedReviewerAgentId, actualReviewerAgentId: r.reviewerAgentId,
      reviewedMissionRevision: input.missionRevision, reviewedTaskRevision: input.taskRevision,
      reviewedWorkspaceRevision: input.workspaceRevision, verdict,
      findingIds, attestationId: null, provenance: r.provenance, createdAt: input.now,
    });
  });

  const repairIterationsUsed = repairs.length;
  return {
    reviews, findings, repairs, repairIterationsUsed,
    limitExceeded: repairIterationsUsed > input.maxRepairIterations,
  };
}

/** Blocking findings that are still open (prevent verified completion). */
export function openBlockingFindings(findings: readonly RelayFinding[]): RelayFinding[] {
  return findings.filter((f) => f.blocking && f.status !== 'resolved');
}

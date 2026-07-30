import type { Provenance } from '../protocol/enums';
import { buildMissionContract, type BuildMissionInput } from './mission';
import { buildExecutionAttestation, hasAttestedExecutionBy } from './attestation';
import { projectReviewLedger, type ReviewInput } from './review-repair';
import { evaluateMissionVerdict } from './verdict';
import { buildMissionTimeline, type TimelineEventInput } from './timeline';
import type {
  MissionSpec, MissionVerdictResult, RelayExecutionAttestation, RelayFinding,
  RelayMissionContract, RelayRepair, RelayReview, TimelineEntry,
} from './contracts';

/**
 * Mission read-model bundle (Prompt 8.1) — PURE. Composes the mission
 * projections from plain data gathered from the EXISTING app read models
 * (status, events, review, evidence, audit, handoff, task). Serializable,
 * secret-free, ANSI-free — reusable by the CLI now and a graphical Mission
 * Control later. The CLI gathers the inputs; this module owns the projection
 * logic; Relay Core remains the source of truth.
 */

export interface MissionProjectionInput {
  spec: MissionSpec;
  missionId: string;
  projectId: string;
  taskId: string;
  runId: string;
  now: string;
  provenance: Provenance;
  /** Requested agents from the mission contract / handoff. */
  requestedImplementerId: string;
  requestedReviewerId: string;
  /** Actual agents that ran (from audit identities). */
  actualImplementerId: string;
  actualReviewerId: string | null;
  /** PSP Agent IDs, when the run carried them. Two roles sharing one PSP
      Agent ID are the same entitlement, however their adapter ids differ. */
  implementerPspId?: string | null;
  reviewerPspId?: string | null;
  /** Human identities, for a human-performed implementation or review. */
  implementerHumanId?: string | null;
  reviewerHumanId?: string | null;
  /** The run the reviewer executed in, when it differs from `runId`. Sharing
      a run is sharing a context, and is not an independent review. */
  reviewerRunId?: string | null;
  implementerAdapterProvenance: Provenance;
  reviewerAdapterProvenance: Provenance;
  /** Execution facts (derived from events/audit — never a live call here). */
  implementerLaunchVerified: boolean;
  implementerCompletionSignal: boolean;
  reviewerLaunchVerified: boolean;
  implementerSessionId: string | null;
  workspaceId: string | null;
  workspaceInspectionCompleted: boolean;
  verificationCompleted: boolean;
  runStatus: string;
  /** Ordered reviews (attempt 1, re-review, ...). */
  reviews: ReviewInput[];
  originalClaimedFiles: string[];
  affectedCriterionIds: string[];
  workspaceRevision: string;
  /** Relay-produced passing evidence ids after the repair. */
  postRepairEvidenceIds: string[];
  allEvidence: Array<{ evidenceId: string; status: string }>;
  requiredEvidenceCount: number;
  passedEvidenceCount: number;
  repairDispatched: boolean;
  implementationReported: boolean;
  events: TimelineEventInput[];
}

export interface MissionProjectionBundle {
  mission: RelayMissionContract;
  attestations: RelayExecutionAttestation[];
  reviews: RelayReview[];
  findings: RelayFinding[];
  repairs: RelayRepair[];
  verdict: MissionVerdictResult;
  timeline: TimelineEntry[];
  executionSummary: {
    requestedImplementer: string;
    actualImplementer: string;
    implementerLaunchVerified: boolean;
    requestedReviewer: string;
    actualReviewer: string | null;
    reviewerLaunchVerified: boolean;
    fallbackOccurred: boolean;
    /**
     * TRUE only when independence was PROVEN. Reviewer identity that cannot
     * be compared leaves this false and `reviewIndependence` `unknown`.
     */
    independentReviewComplete: boolean;
    reviewIndependence: RelayReviewIndependence;
    reviewIndependenceReason: string;
  };
  errors: string[];
}

/* ------------------------------------------------------- independence */

export type RelayReviewIndependence = 'independent' | 'not_independent' | 'unknown';

export interface ReviewIndependenceInput {
  actualImplementerId: string;
  actualReviewerId: string | null;
  implementerPspId?: string | null;
  reviewerPspId?: string | null;
  implementerHumanId?: string | null;
  reviewerHumanId?: string | null;
  implementerRunId?: string | null;
  reviewerRunId?: string | null;
}

const identity = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * REVIEWER INDEPENDENCE.
 *
 * `independentReviewComplete` used to mean only "a review was approved and the
 * reviewer was attested". Neither says the reviewer was a DIFFERENT party from
 * the author, so a run in which one agent implemented and then reviewed its
 * own work reported an independent review. Self-review is the single failure
 * this field exists to rule out.
 *
 * Independence is now DERIVED from whatever identity evidence the run carries,
 * and the three outcomes are kept distinct:
 *
 *   not_independent  a shared identity was found — same actual agent, same
 *                    PSP Agent ID, same human, or the same run;
 *   unknown          the identities cannot be compared. NOT independence:
 *                    absence of evidence is not evidence of separation;
 *   independent      every identity that BOTH sides carry differs.
 */
export function assessReviewIndependence(
  input: ReviewIndependenceInput,
): { independence: RelayReviewIndependence; reason: string } {
  const implementer = identity(input.actualImplementerId);
  const reviewer = identity(input.actualReviewerId);

  if (reviewer === null) {
    return { independence: 'unknown', reason: 'no reviewer identity was recorded — independence cannot be established' };
  }
  if (implementer === null) {
    return { independence: 'unknown', reason: 'no implementer identity was recorded — independence cannot be established' };
  }

  const shared: Array<[string, string]> = [];
  if (implementer === reviewer) shared.push(['actual agent', implementer]);

  const implementerPsp = identity(input.implementerPspId);
  const reviewerPsp = identity(input.reviewerPspId);
  if (implementerPsp !== null && reviewerPsp !== null && implementerPsp === reviewerPsp) {
    shared.push(['PSP Agent ID', implementerPsp]);
  }

  const implementerHuman = identity(input.implementerHumanId);
  const reviewerHuman = identity(input.reviewerHumanId);
  if (implementerHuman !== null && reviewerHuman !== null && implementerHuman === reviewerHuman) {
    shared.push(['human identity', implementerHuman]);
  }

  const implementerRun = identity(input.implementerRunId);
  const reviewerRun = identity(input.reviewerRunId);
  if (implementerRun !== null && reviewerRun !== null && implementerRun === reviewerRun) {
    shared.push(['run identity', implementerRun]);
  }

  if (shared.length > 0) {
    return {
      independence: 'not_independent',
      reason: `the reviewer shares the author's ${shared.map(([kind, value]) => `${kind} (${value})`).join(' and ')} — a reviewer cannot independently review work it authored`,
    };
  }
  return {
    independence: 'independent',
    reason: `the reviewer (${reviewer}) is a different party from the author (${implementer})`,
  };
}

export function projectMission(input: MissionProjectionInput): MissionProjectionBundle {
  const errors: string[] = [];

  const missionBuild = buildMissionContract({
    spec: input.spec, missionId: input.missionId, projectId: input.projectId,
    now: input.now, provenance: input.provenance,
    status: input.runStatus === 'completed' ? 'verified_complete' : 'in_progress',
  } satisfies BuildMissionInput);
  if (!missionBuild.ok) errors.push(...(missionBuild.error.details ?? [missionBuild.error.message]));
  const mission = missionBuild.ok ? missionBuild.value : buildFallbackMission(input);

  /* review / finding / repair projection */
  const ledger = projectReviewLedger({
    missionId: input.missionId, taskId: input.taskId, reviewerRunId: input.runId,
    missionRevision: mission.revision, taskRevision: 0, workspaceRevision: input.workspaceRevision,
    originalClaimedFiles: input.originalClaimedFiles, affectedCriterionIds: input.affectedCriterionIds,
    reviews: input.reviews, postRepairEvidenceIds: input.postRepairEvidenceIds,
    repairDispatched: input.repairDispatched, maxRepairIterations: input.spec.maximumRepairIterations,
    now: input.now,
  });

  /* attestations — requested vs actual, provenance from the adapter */
  const attestations: RelayExecutionAttestation[] = [];
  const implAtt = buildExecutionAttestation({
    attestationId: 'att_impl', projectId: input.projectId, missionId: input.missionId, taskId: input.taskId, runId: input.runId,
    requestedAgentId: input.requestedImplementerId, requestedAgentType: 'coding-agent', requestedRole: 'coding-agent',
    actualAgentId: input.actualImplementerId, actualAgentType: 'coding-agent', actualRole: 'coding-agent',
    adapterId: input.actualImplementerId, launchRequested: true, launchVerified: input.implementerLaunchVerified,
    completionSignalReceived: input.implementerCompletionSignal, workspaceInspectionCompleted: input.workspaceInspectionCompleted,
    verificationCompleted: input.verificationCompleted, externalSessionId: input.implementerSessionId, workspaceId: input.workspaceId,
    outputSummary: 'implementation report received (claim)', activitySummary: 'edit claimed file(s)',
    evidenceIds: input.postRepairEvidenceIds, provenance: input.implementerAdapterProvenance,
  });
  if (implAtt.ok) attestations.push(implAtt.value);
  if (input.actualReviewerId && input.reviewerLaunchVerified) {
    const revAtt = buildExecutionAttestation({
      attestationId: 'att_review', projectId: input.projectId, missionId: input.missionId, taskId: input.taskId, runId: input.runId,
      requestedAgentId: input.requestedReviewerId, requestedAgentType: 'reviewer', requestedRole: 'reviewer',
      actualAgentId: input.actualReviewerId, actualAgentType: 'reviewer', actualRole: 'reviewer',
      adapterId: input.actualReviewerId, launchRequested: true, launchVerified: input.reviewerLaunchVerified,
      completionSignalReceived: input.reviews.length > 0, workspaceInspectionCompleted: false,
      verificationCompleted: false, evidenceIds: [], provenance: input.reviewerAdapterProvenance,
    });
    if (revAtt.ok) attestations.push(revAtt.value);
  }

  /* required attestations present? implementer must be attested; reviewer
   * must be attested IF the completion rule requires independent review. */
  const requiresReview = input.spec.completionRule === 'all_blocking_criteria_and_independent_review';
  const implementerAttested = hasAttestedExecutionBy(attestations, input.actualImplementerId, 'coding-agent');
  const reviewerAttested = input.actualReviewerId ? hasAttestedExecutionBy(attestations, input.actualReviewerId, 'reviewer') : false;
  const requiredAttestationsPresent = implementerAttested && (!requiresReview || reviewerAttested);

  /* deterministic verdict */
  const requiredTestsPassed = input.passedEvidenceCount >= input.requiredEvidenceCount && input.requiredEvidenceCount > 0;
  const evidenceSatisfied = requiredTestsPassed;
  const evidenceReferencesResolve = input.allEvidence.length >= input.passedEvidenceCount;
  const requiredReviewApproved = input.reviews.some((r, i) => i > 0 && r.verdict === 'approved') ||
    (input.reviews.length === 1 && input.reviews[0].verdict === 'approved');

  /* independence — a reviewer that authored the work reviews nothing */
  const independence = assessReviewIndependence({
    actualImplementerId: input.actualImplementerId,
    actualReviewerId: input.actualReviewerId,
    implementerPspId: input.implementerPspId,
    reviewerPspId: input.reviewerPspId,
    implementerHumanId: input.implementerHumanId,
    reviewerHumanId: input.reviewerHumanId,
    implementerRunId: input.runId,
    reviewerRunId: input.reviewerRunId,
  });

  const verdict = evaluateMissionVerdict({
    completionRule: input.spec.completionRule, runStatus: input.runStatus,
    implementationReported: input.implementationReported, requiredTestsPassed,
    evidenceSatisfied, evidenceReferencesResolve, requiredTasksVerified: input.runStatus === 'completed',
    reviews: ledger.reviews, findings: ledger.findings,
    requiredReviewApproved: requiresReview ? (requiredReviewApproved && reviewerAttested) : requiredReviewApproved,
    requiredAttestationsPresent, withinRepairAndReviewLimits: !ledger.limitExceeded,
  });

  /* timeline */
  const timeline = buildMissionTimeline(input.events, {
    missionRevision: mission.revision, taskRevision: 0,
    requestedImplementer: input.requestedImplementerId, actualImplementer: input.actualImplementerId,
    requestedReviewer: input.requestedReviewerId, actualReviewer: input.actualReviewerId ?? input.requestedReviewerId,
    findings: ledger.findings, repairs: ledger.repairs,
  });

  return {
    mission, attestations, reviews: ledger.reviews, findings: ledger.findings, repairs: ledger.repairs,
    verdict, timeline,
    executionSummary: {
      requestedImplementer: input.requestedImplementerId, actualImplementer: input.actualImplementerId,
      implementerLaunchVerified: input.implementerLaunchVerified,
      requestedReviewer: input.requestedReviewerId, actualReviewer: input.actualReviewerId,
      reviewerLaunchVerified: input.reviewerLaunchVerified, fallbackOccurred: false,
      // An approved, attested review is necessary but NOT sufficient: the
      // reviewer must also be PROVEN to be a different party from the author.
      // `unknown` independence never reports a complete independent review.
      independentReviewComplete:
        independence.independence === 'independent'
        && (requiresReview ? (requiredReviewApproved && reviewerAttested) : requiredReviewApproved),
      reviewIndependence: independence.independence,
      reviewIndependenceReason: independence.reason,
    },
    errors,
  };
}

function buildFallbackMission(input: MissionProjectionInput): RelayMissionContract {
  // Only reached if validation failed — surfaced via bundle.errors; the
  // presentation shows the errors rather than a fake valid mission.
  const b = buildMissionContract({
    spec: { ...input.spec, objective: input.spec.objective || 'INVALID MISSION', requirements: input.spec.requirements.length ? input.spec.requirements : ['INVALID'], acceptanceCriteria: input.spec.acceptanceCriteria.length ? input.spec.acceptanceCriteria : [{ id: 'X', text: 'INVALID', blocking: true }], filesOutOfScope: input.spec.filesOutOfScope.length || input.spec.systemsOutOfScope.length ? input.spec.filesOutOfScope : ['INVALID'] },
    missionId: input.missionId, projectId: input.projectId, now: input.now, provenance: input.provenance, status: 'draft',
  });
  return b.ok ? { ...b.value, status: 'draft' } : ({} as RelayMissionContract);
}

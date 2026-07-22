import type { Provenance } from '../protocol/enums';

/**
 * Mission-layer projections (Prompt 8.1) — PURE types. These are SERIALIZABLE
 * read-model projections DERIVED from existing canonical Relay state
 * (Project Ledger, Blueprint, RelayTask, CompletionPolicy, budget/loop
 * policies, ReviewerVerdict, ReviewFinding, RevisionContract, evidence). They
 * are NOT a second source of truth and NOT a second workflow engine — the
 * ledger and Relay Core remain authoritative. Nothing here stores secrets,
 * hidden reasoning, raw streams, or credentials.
 */

/* --------------------------- mission contract ----------------------- */

export const MISSION_STATUSES = [
  'draft', 'locked', 'in_progress', 'blocked', 'verified_complete', 'cancelled',
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

/** The `completion rule` — how Relay decides the mission is done. */
export type MissionCompletionRule =
  | 'all_blocking_criteria_and_independent_review'
  | 'all_blocking_criteria';

/** Authored mission inputs (from a scenario or an operator). The validated,
 * revisioned RelayMissionContract is projected from this plus canonical
 * state. */
export interface MissionSpec {
  title: string;
  objective: string;
  requirements: string[];
  constraints: string[];
  acceptanceCriteria: Array<{ id: string; text: string; blocking: boolean }>;
  filesInScope: string[];
  filesOutOfScope: string[];
  systemsInScope: string[];
  systemsOutOfScope: string[];
  assumptions: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  requiredEvidence: string[];
  requiredReviewers: string[];
  implementerRequirement: string;
  reviewerRequirement: string;
  maximumRepairIterations: number;
  maximumReviewRuns: number;
  maximumCostUsd: number | null;
  maximumRuntimeMinutes: number | null;
  completionRule: MissionCompletionRule;
  createdBy: string;
}

export interface RelayMissionContract {
  missionId: string;
  projectId: string;
  title: string;
  objective: string;
  requirements: string[];
  constraints: string[];
  acceptanceCriteria: Array<{ id: string; text: string; blocking: boolean }>;
  filesInScope: string[];
  filesOutOfScope: string[];
  systemsInScope: string[];
  systemsOutOfScope: string[];
  assumptions: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  requiredEvidence: string[];
  requiredReviewers: string[];
  implementerRequirement: string;
  reviewerRequirement: string;
  maximumRepairIterations: number;
  maximumReviewRuns: number;
  maximumCostUsd: number | null;
  maximumRuntimeMinutes: number | null;
  completionRule: MissionCompletionRule;
  status: MissionStatus;
  revision: number;
  /** Deterministic digest of the BINDING fields — changes stale handoffs. */
  bindingDigest: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  provenance: Provenance;
}

/* --------------------------- attestation ---------------------------- */

export interface RelayExecutionAttestation {
  attestationId: string;
  projectId: string;
  missionId: string;
  taskId: string;
  requestedAgentId: string;
  requestedAgentType: string;
  requestedRole: string;
  actualAgentId: string;
  actualAgentType: string;
  actualRole: string;
  adapterId: string;
  adapterVersion: string | null;
  runtimeVersion: string | null;
  modelVersion: string | null;
  runId: string;
  externalSessionId: string | null;
  workspaceId: string | null;
  policyReference: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  launchRequested: boolean;
  launchVerified: boolean;
  completionSignalReceived: boolean;
  workspaceInspectionCompleted: boolean;
  verificationCompleted: boolean;
  fallbackOccurred: boolean;
  fallbackAgentId: string | null;
  fallbackReason: string | null;
  outputDigest: string | null;
  activityDigest: string | null;
  evidenceIds: string[];
  provenance: Provenance;
  immutable: true;
}

/* ----------------------- review / finding / repair ------------------ */

export type FindingStatus = 'open' | 'in_repair' | 'resolved' | 'reopened';
export type RepairStatus = 'assigned' | 'claimed' | 'verified' | 'resolved' | 'rejected';
export type ReviewVerdictLabel = 'approved' | 'changes_required';

export interface RelayReview {
  reviewId: string;
  missionId: string;
  taskId: string;
  reviewerAgentId: string;
  reviewerRunId: string;
  requestedReviewerAgentId: string;
  actualReviewerAgentId: string;
  reviewedMissionRevision: number;
  reviewedTaskRevision: number;
  reviewedWorkspaceRevision: string;
  verdict: ReviewVerdictLabel;
  findingIds: string[];
  attestationId: string | null;
  provenance: Provenance;
  createdAt: string;
}

export interface RelayFinding {
  findingId: string;
  reviewId: string;
  missionId: string;
  taskId: string;
  severity: 'critical' | 'high' | 'major' | 'minor';
  title: string;
  description: string;
  evidenceIds: string[];
  affectedFiles: string[];
  affectedCriterionIds: string[];
  requiredAction: string;
  blocking: boolean;
  status: FindingStatus;
  repairTaskId: string | null;
  resolutionEvidenceIds: string[];
  openedAt: string;
  resolvedAt: string | null;
  resolutionReviewId: string | null;
}

export interface RelayRepair {
  repairId: string;
  findingId: string;
  missionId: string;
  originalTaskId: string;
  assignedAgentId: string;
  assignedRunId: string;
  revisionContractId: string;
  requiredChanges: string;
  prohibitedScopeExpansion: true;
  affectedFiles: string[];
  requiredTests: string[];
  requiredEvidence: string[];
  iteration: number;
  status: RepairStatus;
  evidenceIds: string[];
  createdAt: string;
  submittedAt: string | null;
  resolvedAt: string | null;
}

/* --------------------------- verdicts ------------------------------- */

export const MISSION_VERDICTS = [
  'claimed_complete', 'reviewed', 'approved', 'verified_complete',
  'partially_complete', 'blocked', 'failed', 'needs_human',
] as const;
export type MissionVerdict = (typeof MISSION_VERDICTS)[number];

export interface MissionVerdictResult {
  verdict: MissionVerdict;
  /** Deterministic, human-readable reasons — no free-text agent claims. */
  reasons: string[];
  checks: Array<{ requirement: string; passed: boolean; detail: string }>;
  blockingFindingsOpen: number;
  requiredReviewsSatisfied: boolean;
  requiredAttestationsPresent: boolean;
  evidenceSatisfied: boolean;
  withinRepairAndReviewLimits: boolean;
}

/* --------------------------- timeline ------------------------------- */

export type TimelineKind =
  | 'mission_requested' | 'mission_validated' | 'mission_revision_locked'
  | 'task_created' | 'task_assigned' | 'handoff_compiled'
  | 'execution_requested' | 'execution_authorized' | 'launch_verified'
  | 'report_received' | 'completion_claimed' | 'verification_started'
  | 'verification_result' | 'review_requested' | 'review_launch_verified'
  | 'finding_created' | 'repair_created' | 'repair_assigned' | 'repair_claimed'
  | 'evidence_attached' | 're_review_completed' | 'finding_resolved'
  | 'completion_evaluated' | 'mission_verified' | 'other';

export interface TimelineEntry {
  sequence: number;
  at: string;
  kind: TimelineKind;
  summary: string;
  requestedAgent: string | null;
  actualAgent: string | null;
  role: string | null;
  provenance: Provenance;
  attempt: number | null;
  missionRevision: number | null;
  taskRevision: number | null;
  evidenceRefs: string[];
}

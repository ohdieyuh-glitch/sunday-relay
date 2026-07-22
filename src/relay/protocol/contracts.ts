import type {
  ApprovalId, ArtifactId, AssignmentId, AuditId, BlueprintId, BundleId,
  CheckpointId, ClaimId, CompilationRecordId, ContextVersion, DecisionId,
  DisagreementId, EvidenceId, FailureId, IdempotencyKey, LedgerVersion,
  PackageId, PolicyId, ProjectId, QuestionId, ReportId, RunId, SessionRefId,
  TaskId, UsageId, VerificationId, WorkspaceRefId,
} from './ids';
import type {
  AuditOutcome, Classification, Enforcement, EvidenceStatus, FindingSeverity,
  Provenance, ProvenanceProfile, ReportType, ReviewVerdict, RiskLevel, Role,
  RunMode, RunPhase, RunStatus, TaskStatus,
} from './enums';
import {
  arr, bool, freeId, id, iso, lit, metadata, num, objectOf, rejectHiddenReasoning,
  str, versionNum, type Check,
} from './validate';
import { ENFORCEMENT_LEVELS, EVIDENCE_STATUSES, FINDING_SEVERITIES, ROLES } from './enums';

/* ================================================================== */
/* A. FULLY IMPLEMENTED (Prompt 2) — internal entities                 */
/* Created by relay-core/ledger code, so invariants live in factories  */
/* and machines; runtime validators exist where a contract crosses an  */
/* external boundary (envelopes.ts, imported blueprints).              */
/* ================================================================== */

export interface RelayProject {
  projectId: ProjectId;
  name: string;
  createdAt: string;
  objective: string;
  ledgerVersion: LedgerVersion;
  repository?: { path: string; defaultBranch: string };
  constraints?: string[];
  securityNotes?: string;
}

/** Token + runtime policies fold into the budget contract (PROTOCOL §2.3);
 * stop-before-dispatch is evaluated against these ceilings. */
export interface BudgetPolicy {
  maxUsd?: number;
  maxTokens?: number;
  maxRuntimeMs?: number;
  /** Fraction of a ceiling that triggers a warning (0–1). */
  warningAtFraction?: number;
  /** How a missing cost estimate is handled (Prompt 3 budget evaluator). */
  missingEstimate?: 'allow' | 'checkpoint' | 'deny';
}

/** Decision 4: at most one automatic revision. */
export interface LoopPolicy {
  maxAutomaticRevisions: 0 | 1;
}

export interface Checkpoint {
  checkpointId: CheckpointId;
  runId: RunId;
  reason: string;
  requestedAt: string;
  respondedAt?: string;
  response?: 'approve' | 'reject';
  approvalId?: ApprovalId;
}

export interface RelayRun {
  runId: RunId;
  projectId: ProjectId;
  createdAt: string;
  status: RunStatus;
  phase: RunPhase;
  objective: string;
  mode: RunMode;
  taskIds: TaskId[];
  budget: BudgetPolicy;
  loopPolicy: LoopPolicy;
  repairCount: 0 | 1;
  /** Derived, never client-set (PROTOCOL §2.3). */
  provenanceProfile: ProvenanceProfile;
  blueprintId?: BlueprintId;
  verificationRefs: VerificationId[];
  reviewRefs: ReportId[];
  failureRefs: FailureId[];
  pausedAt?: string;
  completedAt?: string;
  checkpoint?: Checkpoint;
  finalAuditId?: AuditId;
}

export interface RelayTask {
  taskId: TaskId;
  projectId: ProjectId;
  runId: RunId;
  objective: string;
  category: string;
  status: TaskStatus;
  ownerAssignmentId: AssignmentId | null;
  dependencies: TaskId[];
  claimedFiles: string[];
  claimedResources: string[];
  acceptanceCriteria: string[];
  completionPolicyId: PolicyId;
  contextVersion: ContextVersion;
  baseRevision: string;
  createdAt: string;
  updatedAt: string;
  priority: number;
  /** Deterministic structured dedup key (Prompt 3) — NEVER a semantic
   * equivalence claim; duplicate detection compares these keys only. */
  equivalenceKey?: string;
  /** Marks this task as a revision of an existing one (not a duplicate). */
  revisionOf?: TaskId;
  leaseExpiresAt?: string;
  supersededBy?: TaskId;
  completionEvidenceRefs?: BundleId[];
  /** revision_required must reference what blocks it (finding/failure). */
  revisionRefs?: { findingIds: string[]; failureId?: FailureId };
}

export interface TaskAssignment {
  assignmentId: AssignmentId;
  taskId: TaskId;
  role: Role;
  adapterId: string;
  assignedAt: string;
  provenance: Provenance;
  sessionRef?: SessionRefId;
  leaseExpiresAt?: string;
  endedAt?: string;
  endReason?: string;
}

export interface FileClaim {
  claimId: ClaimId;
  taskId: TaskId;
  /** Normalized repository-relative path (coordination/claims.ts). */
  path: string;
  /** read = shared; write = exclusive. */
  mode: 'read' | 'write';
  claimedAt: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
}

export interface ResourceClaim {
  claimId: ClaimId;
  taskId: TaskId;
  /** Explicit stable resource key — never inferred from natural language. */
  resource: string;
  mode: 'exclusive' | 'shared';
  claimedAt: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
}

/** Static minimal form (PROTOCOL §6); capability observation deferred. */
export interface AgentProfile {
  adapterId: string;
  provider: string;
  roles: Role[];
  displayName: string;
}

/** Opaque references — NEVER credentials (SECURITY §2). */
export interface AgentSessionReference {
  sessionRefId: SessionRefId;
  adapterId: string;
  createdAt: string;
  description?: string;
}

export interface WorkspaceReference {
  workspaceRefId: WorkspaceRefId;
  kind: 'worktree' | 'managed';
  path?: string;
  description?: string;
}

export interface ArtifactReference {
  artifactId: ArtifactId;
  kind: string;
  uri?: string;
  sha256?: string;
  sizeBytes?: number;
  description?: string;
}

/* ----- blueprint & handoff ----- */

export interface BlueprintContent {
  objectiveRestatement: string;
  approach: string;
  taskBreakdown: string[];
  acceptanceCriteria: string[];
  risks: string[];
  constraints: string[];
}

export interface Blueprint {
  blueprintId: BlueprintId;
  projectId: ProjectId;
  runId: RunId;
  version: number;
  source: 'simulated' | 'imported' | 'live-adapter';
  architectIdentity: { adapterId?: string; displayName: string; sessionRef?: SessionRefId };
  submittedAt: string;
  content: BlueprintContent;
  provenance: Provenance;
  metadata?: Record<string, unknown>;
}

/** A restriction always carries its true enforcement level (Decision 5). */
export interface Restriction {
  value: string;
  enforcement: Enforcement;
}

/** Contract-only policy shapes (enforced by future runner/worktree phases). */
export interface CommandPolicy {
  allowlist: string[];
  enforcement: Enforcement;
}
export interface ProtectedPathRule {
  pattern: string;
  enforcement: Enforcement;
}
export interface PermissionPolicy {
  permittedTools: Restriction[];
  permittedFiles: Restriction[];
  prohibitedActions: Restriction[];
  protectedPaths: ProtectedPathRule[];
  commandPolicy?: CommandPolicy;
}
/** Contract-only (checkpoint engine wiring deferred). */
export interface CheckpointPolicy {
  budgetWarningAtFraction?: number;
}

export interface StoppingCondition {
  deadline?: string;
  maxRuntimeMs?: number;
  description: string;
}

export interface AgentHandoffPackage {
  packageId: PackageId;
  protocolVersion: string;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  targetAdapterId: string;
  role: Role;
  objective: string;
  responsibilityBoundary: string;
  contextRefs: string[];
  requiredInputs: string[];
  permittedTools: Restriction[];
  permittedFiles: Restriction[];
  prohibitedActions: Restriction[];
  dependencies: TaskId[];
  acceptanceCriteria: string[];
  requiredEvidence: string[];
  budget: BudgetPolicy;
  stoppingCondition: StoppingCondition;
  expectedReportType: ReportType;
  contextVersion: ContextVersion;
  ledgerVersion: LedgerVersion;
  /** Repository revision the package context was pinned to. */
  baseRevision: string;
  createdAt: string;
  /** Package freshness bound — dispatch after this is stale. */
  expiresAt?: string;
  correlationId?: string;
  idempotencyKey: IdempotencyKey;
}

export interface HandoffCompilationRecord {
  recordId: CompilationRecordId;
  packageId: PackageId;
  compiledAt: string;
  ledgerVersion: LedgerVersion;
  contextVersion: ContextVersion;
  inputRefs: string[];
  compilerVersion: string;
}

/** The 15 Guided-Mode conditions, recorded with their evaluations. */
export interface RevisionCondition {
  condition: string;
  satisfied: boolean;
}

export interface RevisionContract {
  packageId: PackageId;
  parentPackageId: PackageId;
  findingsTargeted: string[];
  narrowScope: { sameTask: true; sameFiles: true; sameAssignment: true };
  conditionsChecked: RevisionCondition[];
  /** Narrow-repair payload (Prompt 3 compiler) — never broadens the task. */
  taskId?: TaskId;
  failureEvidenceRefs?: EvidenceId[];
  requiredCorrection?: string;
  behaviorToPreserve?: string[];
  allowedFiles?: string[];
  protectedPaths?: string[];
  verificationToRerun?: string[];
  budgetRemaining?: BudgetPolicy;
  stoppingCondition?: StoppingCondition;
  ledgerVersion?: LedgerVersion;
  contextVersion?: ContextVersion;
  baseRevision?: string;
  provenance?: Provenance;
  expiresAt?: string;
  correlationId?: string;
  idempotencyKey?: IdempotencyKey;
}

/* ----- evidence & verification ----- */

export type EvidenceType = 'command' | 'diff' | 'artifact' | 'reviewer-verdict' | 'health-check';

export interface EvidenceRecord {
  evidenceId: EvidenceId;
  taskId: TaskId;
  runId: RunId;
  source: string;
  evidenceType: EvidenceType;
  command?: string;
  exitCode?: number;
  outputExcerpt: string;
  executedAt: string;
  environment: { os: string; node: string; cwd: string };
  repoRevision: string;
  verificationStatus: EvidenceStatus;
  verifier: string;
  provenance: Provenance;
  artifactRef?: ArtifactId;
  integrity?: { sha256?: string; sizeBytes?: number };
  expiresAt?: string;
}

export interface EvidenceBundle {
  bundleId: BundleId;
  taskId: TaskId;
  runId: RunId;
  evidenceIds: EvidenceId[];
  collectedAt: string;
  overallStatus: EvidenceStatus;
  repoRevision: string;
}

export interface VerificationCheck {
  id: string;
  label: string;
  status: EvidenceStatus;
  detail: string;
}

export interface VerificationRecord {
  verificationId: VerificationId;
  taskId: TaskId;
  runId: RunId;
  policyId: PolicyId;
  bundleId: BundleId;
  at: string;
  outcome: 'passed' | 'failed' | 'pending' | 'unavailable';
  checks: VerificationCheck[];
}

/** VerificationPolicy == CompletionPolicy (PROTOCOL §3.5). */
export interface CompletionPolicy {
  policyId: PolicyId;
  riskLevel: RiskLevel;
  requiredEvidence: Array<{ evidenceType: EvidenceType; command?: string; mustPass: boolean }>;
  requiresIndependentReview: boolean;
  requiresHumanApproval: boolean;
  enforcementRequirements: Array<{ control: string; minimumLevel: Enforcement }>;
  /** Which evidence provenance satisfies this policy. Absent = live only:
   * a live policy never silently accepts simulation evidence; a simulation
   * policy declares ['simulated'] explicitly. */
  acceptedProvenance?: Provenance[];
  /** Verifier identities allowed to produce satisfying evidence. */
  allowedVerifiers?: string[];
}

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  recommendation?: string;
}

export interface ReviewerVerdictRecord {
  reportId: ReportId;
  reviewerAssignmentId: AssignmentId;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  /** Computed by relay-core from assignment lineage — never self-declared. */
  independent: boolean;
  provenance: Provenance;
}

/* ----- ledger-side records ----- */

export interface RejectedAlternative {
  title: string;
  reason: string;
}

export interface DecisionRecord {
  decisionId: DecisionId;
  at: string;
  title: string;
  decision: string;
  rationale: string;
  rejectedAlternatives: RejectedAlternative[];
  decidedBy: string;
  supersededBy?: DecisionId;
}

export interface ApprovalRecord {
  approvalId: ApprovalId;
  checkpointId: CheckpointId;
  runId: RunId;
  at: string;
  actor: string;
  response: 'approve' | 'reject';
  note?: string;
}

export interface OpenQuestion {
  questionId: QuestionId;
  at: string;
  question: string;
  raisedBy: string;
  status: 'open' | 'answered';
  answerRef?: string;
}

export type FailureSignal =
  | 'repeated-command-failure'
  | 'repeated-test-failure'
  | 'no-progress'
  | 'agent-blocked'
  | 'session-unavailable'
  | 'tool-unavailable'
  | 'budget'
  | 'other';

export interface FailureRecord {
  failureId: FailureId;
  taskId: TaskId;
  runId: RunId;
  at: string;
  signal: FailureSignal;
  attempts: Array<{ at: string; packageId: PackageId; summaryRef?: string }>;
  commandRefs: string[];
  evidenceRefs: EvidenceId[];
  constraintsSnapshot: string[];
  stoppingCondition: string;
}

export interface UsageRecord {
  usageId: UsageId;
  runId: RunId;
  taskId?: TaskId;
  adapterId: string;
  at: string;
  kind: 'estimated' | 'actual';
  tokens?: number;
  usd?: number;
  runtimeMs?: number;
  /** Decision 1 hybrid paths — which pipe, when live. */
  dispatchPath?: 'local' | 'cloud';
}

export interface FinalAuditReport {
  auditId: AuditId;
  runId: RunId;
  projectId: ProjectId;
  at: string;
  outcome: AuditOutcome;
  objective: string;
  blueprintRef?: BlueprintId;
  taskRefs: TaskId[];
  verificationRefs: VerificationId[];
  reviewRefs: ReportId[];
  repairCount: 0 | 1;
  evidenceBundleRefs: BundleId[];
  usageSummary: { estimatedUsd?: number; actualUsd?: number; tokens?: number };
  checkpoints: Array<{ id: CheckpointId; reason: string; response?: 'approve' | 'reject' }>;
  provenanceProfile: ProvenanceProfile;
  unresolvedQuestions: QuestionId[];
}

/* ================================================================== */
/* B. SCHEMA-ONLY (Prompt 2) — typed shape, no engine                  */
/* ================================================================== */

export interface DisagreementRecord {
  disagreementId: DisagreementId;
  projectId: ProjectId;
  taskId?: TaskId;
  participants: string[];
  proposals: Array<{ by: string; summary: string; evidenceRefs: EvidenceId[] }>;
  category:
    | 'factual' | 'architectural' | 'cost' | 'security' | 'performance'
    | 'preference' | 'missing-context' | 'requirement-conflict';
  risk: RiskLevel;
  decisionAuthority: string;
  status: 'open' | 'resolved' | 'escalated';
  resolutionMethod?: string;
  finalDecisionRef?: DecisionId;
}

/* ================================================================== */
/* C. INTERFACE-ONLY / DOCUMENTED-FUTURE (PROTOCOL §6) — no validators,*/
/* no runtime use in Prompt 2. MVP-sufficient subset lives in          */
/* RelayProject.constraints / DecisionRecord / Blueprint content.      */
/* ================================================================== */

export interface ProjectRequirement {
  requirementId: string;
  kind: 'functional' | 'non-functional' | 'constraint' | 'security';
  statement: string;
  status: 'active' | 'superseded';
}

export interface ArchitectureRecord {
  architectureRecordId: string;
  at: string;
  summary: string;
  sourceBlueprintRef?: BlueprintId;
}

/* ================================================================== */
/* Claim records (ledger §3.1)                                         */
/* ================================================================== */

export interface ClaimRecord {
  claimId: ClaimId;
  reportId: ReportId;
  runId: RunId;
  taskId?: TaskId;
  recordedAt: string;
  source: string;
  provenance: Provenance;
  classification: Extract<Classification, 'unverified-claim'>;
  status: 'recorded' | 'promoted' | 'rejected';
  repoRevision?: string;
}

/* ================================================================== */
/* External-boundary validators                                        */
/* ================================================================== */

const restriction = objectOf({
  required: { value: str(), enforcement: lit(...ENFORCEMENT_LEVELS) },
});

export const checkBlueprintContent: Check = objectOf({
  required: {
    objectiveRestatement: str(),
    approach: str(),
    taskBreakdown: arr(str(), { minLen: 1 }),
    acceptanceCriteria: arr(str(), { minLen: 1 }),
    risks: arr(str()),
    constraints: arr(str()),
  },
});

/** Imported blueprints are untrusted external input (SECURITY §1). */
export function checkImportedBlueprintPayload(value: unknown, field: string): string[] {
  const shape = objectOf({
    required: {
      architectDisplayName: str({ max: 200 }),
      content: checkBlueprintContent,
    },
    optional: { metadata: metadata() },
  });
  return [...shape(value, field), ...rejectHiddenReasoning(value, field)];
}

export const checkVerificationCheck: Check = objectOf({
  required: {
    id: str(),
    label: str(),
    status: lit(...EVIDENCE_STATUSES),
    detail: str({ allowEmpty: true }),
  },
});

export const checkReviewFinding: Check = objectOf({
  required: {
    id: str(),
    severity: lit(...FINDING_SEVERITIES),
    title: str(),
    detail: str(),
  },
  optional: { recommendation: str() },
});

export const checkAgentHandoffPackage: Check = objectOf({
  required: {
    packageId: id('pkg'),
    protocolVersion: str(),
    projectId: id('prj'),
    runId: id('run'),
    taskId: id('tsk'),
    targetAdapterId: str(),
    role: lit(...ROLES),
    objective: str(),
    responsibilityBoundary: str(),
    contextRefs: arr(str()),
    requiredInputs: arr(str()),
    permittedTools: arr(restriction),
    permittedFiles: arr(restriction),
    prohibitedActions: arr(restriction),
    dependencies: arr(id('tsk')),
    acceptanceCriteria: arr(str(), { minLen: 1 }),
    requiredEvidence: arr(str()),
    budget: objectOf({
      required: {},
      optional: {
        maxUsd: num({ min: 0 }),
        maxTokens: num({ int: true, min: 0 }),
        maxRuntimeMs: num({ int: true, min: 0 }),
        warningAtFraction: num({ min: 0 }),
        missingEstimate: lit('allow', 'checkpoint', 'deny'),
      },
    }),
    stoppingCondition: objectOf({
      required: { description: str() },
      optional: { deadline: iso(), maxRuntimeMs: num({ int: true, min: 0 }) },
    }),
    expectedReportType: lit('blueprint', 'implementation', 'review', 'repair', 'verification-output'),
    contextVersion: versionNum(),
    ledgerVersion: versionNum(),
    baseRevision: str(),
    createdAt: iso(),
    idempotencyKey: freeId(),
  },
  optional: { expiresAt: iso(), correlationId: freeId() },
});

export const checkRevisionContract: Check = objectOf({
  required: {
    packageId: id('pkg'),
    parentPackageId: id('pkg'),
    findingsTargeted: arr(str(), { minLen: 1 }),
    narrowScope: objectOf({
      required: { sameTask: bool(), sameFiles: bool(), sameAssignment: bool() },
    }),
    conditionsChecked: arr(
      objectOf({ required: { condition: str(), satisfied: bool() } }),
      { minLen: 15 },
    ),
  },
});

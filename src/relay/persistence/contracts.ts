import type { RelayExecutionAttestation, RelayFinding, RelayRepair } from '../mission/contracts';
import type { OutputVisibility } from '../mission/entitlement';

/**
 * Durable local persistence contracts (Prompt 8.5) — PURE types + constants.
 * The append-only journal is the single durable authority; snapshots are
 * derived projections that must always be reconstructable by replay.
 *
 * NOTHING in these shapes may carry credentials, raw provider event streams,
 * hidden reasoning, full internal prompts, or account data — the redaction
 * module enforces this at write time and the security tests prove it on the
 * persisted artifacts.
 */

/* ------------------------------ schema ------------------------------ */

export const RELAY_STATE_SCHEMA_VERSION = 'relay-state.v1' as const;
/** Older schema this build can still migrate forward (fixture-backed). */
export const RELAY_STATE_SCHEMA_V0 = 'relay-state.v0' as const;
export const KNOWN_STATE_SCHEMA_VERSIONS = [RELAY_STATE_SCHEMA_V0, RELAY_STATE_SCHEMA_VERSION] as const;

/* -------------------------- journal events -------------------------- */

/** Durable journal event kinds — the supervised-workflow boundaries plus
 * administrative persistence records. These are JOURNAL kinds, not the Live
 * Terminal projection kinds. */
export const PERSISTED_EVENT_KINDS = [
  'run.initialized',
  'workspace.created',
  'provider_launch.authorized',        // payload carries the atomic budget consumption
  'implementer.initialization_verified',
  'reviewer.initialization_verified',
  'implementer.report_received',
  'workspace.inspected',
  'verification.completed',
  'review.received',
  'finding.created',
  'repair.created',
  'session_resume.authorized',         // exact-session resume (also consumes budget)
  'repair.received',
  're_verification.completed',
  're_review.received',
  'completion.evaluated',
  'run.verified_complete',
  'run.stopped_safely',
  'cleanup.completed',
  'run.recovery_required',
  'run.recovery_ready',
  'evidence.marked_stale',
  'run.archived',
  'run.quarantined',
] as const;
export type PersistedEventKind = (typeof PERSISTED_EVENT_KINDS)[number];

export interface PersistedEvent {
  schemaVersion: string;
  eventId: string;
  /** Monotonic, gap-free, starting at 1 per run. */
  sequence: number;
  at: string;
  projectId: string;
  missionId?: string;
  taskId?: string;
  runId: string;
  attemptId: string;
  kind: PersistedEventKind;
  /** Safe actor identity — an adapter/relay identity label, never an account. */
  actor: string;
  workspaceRevision?: string;
  /** Digest of the reduced state BEFORE this event was applied. */
  previousStateDigest: string;
  /** Digest of the reduced state AFTER this event was applied. */
  resultingStateDigest: string;
  /** Sanitized payload — passed through the redactor before write. */
  payload: Record<string, unknown>;
  /** sha256 over the deterministic serialization of every field above. */
  checksum: string;
}

export type PersistedEventInput = Omit<PersistedEvent,
  'schemaVersion' | 'eventId' | 'sequence' | 'previousStateDigest' | 'resultingStateDigest' | 'checksum'>;

/* --------------------------- lifecycle ------------------------------ */

export const RUN_LIFECYCLE_STATES = [
  'initialized', 'implementation_running', 'held_for_inspection',
  'held_for_verification', 'held_for_review', 'revision_required',
  'repair_authorized', 'repair_running', 'held_for_reverification',
  'held_for_rereview', 'approved_for_release', 'verified_complete',
  'released', 'stopped_safely', 'canceled', 'recovery_required',
  'corrupted', 'quarantined',
] as const;
export type RunLifecycleState = (typeof RUN_LIFECYCLE_STATES)[number];

export const TERMINAL_LIFECYCLE_STATES: readonly RunLifecycleState[] =
  ['verified_complete', 'released', 'stopped_safely', 'canceled', 'quarantined'];

/* --------------------------- call budget ---------------------------- */

export interface CallBudgetState {
  maxCalls: number;
  consumed: number;
  remaining: number;
  byProvider: Record<string, { max: number; consumed: number }>;
  /** Restart must never re-enable automatic retries. */
  automaticRetryProhibited: true;
}

export function freshCallBudget(maxCalls: number, byProvider: Record<string, number>): CallBudgetState {
  return {
    maxCalls, consumed: 0, remaining: maxCalls,
    byProvider: Object.fromEntries(Object.entries(byProvider).map(([k, max]) => [k, { max, consumed: 0 }])),
    automaticRetryProhibited: true,
  };
}

/** Pure authorization check — a restart can never reset consumption. */
export function callAuthorization(budget: CallBudgetState, provider: string):
  { authorized: boolean; reason: string } {
  if (budget.remaining <= 0) return { authorized: false, reason: 'Total live-call budget exhausted.' };
  const p = budget.byProvider[provider];
  if (!p) return { authorized: false, reason: `Unknown provider "${provider}" has no call budget.` };
  if (p.consumed >= p.max) return { authorized: false, reason: `Provider ${provider} call budget exhausted.` };
  return { authorized: true, reason: 'Within budget.' };
}

/* ---------------------- provider session refs ----------------------- */

export const PROVIDER_SESSION_READINESS = [
  'persisted_unverified', 'resume_ready', 'resume_unavailable',
  'invalid', 'expired', 'manual_action_required',
] as const;
export type ProviderSessionReadiness = (typeof PROVIDER_SESSION_READINESS)[number];

/** The MINIMUM safe reference needed to attempt an exact resume later.
 * NEVER transcripts, streams, credentials, cookies, prompts, or account
 * data. A persisted reference is NOT proof the provider session is still
 * available — after restart it is `persisted_unverified` until classified. */
export interface ProviderSessionReference {
  provider: 'claude' | 'codex';
  adapterId: string;
  relayRef: string;
  /** The provider session identifier required for exact resume. Never
   * displayed by default in UI output. */
  providerSessionId: string | null;
  projectId: string;
  missionId: string;
  taskId: string;
  runId: string;
  workspaceId: string;
  attempt: number;
  executionAuthor: string;
  independenceGroup: string;
  initializationVerified: boolean;
  createdAt: string;
  lastUsedAt: string;
  resumeEligible: boolean;
  invalidated: boolean;
  readiness: ProviderSessionReadiness;
}

/* ---------------------------- evidence ------------------------------ */

export interface EvidenceManifest {
  evidenceId: string;
  evidenceType: string;
  command: string;
  safeArgs: string[];
  exitStatus: number | null;
  workspaceRevision: string;
  /** Digest of the bounded sanitized result — never unrestricted output. */
  resultDigest: string;
  at: string;
  criterionIds: string[];
  sourceActor: string;
  verificationAuthority: string;
  status: 'current' | 'stale';
}

/* ---------------------------- snapshot ------------------------------ */

export interface WorkspaceAssociation {
  workspaceId: string;
  canonicalPath: string;
  sourceRepositoryPath: string;
  sourceRevision: string;
  worktreeBranch: string;
  claimedFiles: string[];
  protectedPaths: string[];
  lastInspectedRevision: string | null;
  lastVerifiedRevision: string | null;
  /** Content digests of the claimed files at last inspection — drift is
   * detected by digest mismatch, never by re-reading full contents into
   * the journal. */
  claimedFileDigests: Record<string, string>;
  cleanupStatus: 'active' | 'preserved' | 'cleaned' | 'missing';
}

export interface RunSnapshot {
  schemaVersion: string;
  runId: string;
  project: {
    projectId: string;
    displayName: string;
    missionIds: string[];
    ledgerRefs: string[];
  };
  mission: {
    missionId: string;
    objective: string;
    acceptanceCriteria: Array<{ id: string; text: string; blocking: boolean }>;
    policyRefs: string[];
    taskIds: string[];
    requestedWorkforce: string[];
  };
  task: {
    taskId: string;
    owner: string | null;
    status: string;
    fileClaims: string[];
    protectedPaths: string[];
    attemptLineage: number[];
  };
  run: {
    mode: string;
    lifecycle: RunLifecycleState;
    startedAt: string;
    updatedAt: string;
    phase: string;
    outputVisibility: OutputVisibility;
    stopReason: string | null;
    completionVerdict: string | null;
  };
  callBudget: CallBudgetState;
  workspace: WorkspaceAssociation | null;
  sessions: ProviderSessionReference[];
  attestations: RelayExecutionAttestation[];
  evidence: EvidenceManifest[];
  findings: RelayFinding[];
  repairs: RelayRepair[];
  pendingManualTasks: Array<{ title: string; reason: string }>;
  lastEventSequence: number;
  stateDigest: string;
}

/* ------------------------- recovery plans --------------------------- */

export const RECOVERY_PLAN_OUTCOMES = [
  'inspection_only', 'ready_for_verification', 'ready_for_review',
  'ready_for_repair_authorization', 'ready_for_exact_claude_resume',
  'ready_for_exact_codex_resume', 'waiting_for_user',
  'manual_action_required', 'stopped_safely', 'unrecoverable',
] as const;
export type RecoveryPlanOutcome = (typeof RECOVERY_PLAN_OUTCOMES)[number];

export type WorkspaceReconciliation = 'match' | 'drift' | 'missing' | 'source_changed' | 'not_applicable';

export interface RecoveryPlan {
  outcome: RecoveryPlanOutcome;
  lifecycle: RunLifecycleState;
  nextPermittedActions: string[];
  /** No provider launch may ever occur merely because a process restarted. */
  requiresFounderAuthorizationForLiveCalls: true;
  workspaceReconciliation: WorkspaceReconciliation;
  staleEvidenceIds: string[];
  openFindingIds: string[];
  pendingRepairIds: string[];
  sessionReadiness: Partial<Record<'claude' | 'codex', ProviderSessionReadiness>>;
  callBudget: CallBudgetState;
  snapshotSource: 'current' | 'previous' | 'replay_only';
  diagnostics: string[];
}

/* --------------------------- retention ------------------------------ */

export interface RetentionPolicy {
  completedRunRetention: 'preserve';
  stoppedRunRetention: 'preserve';
  /** Journal compaction is CONFIGURED only — no compaction (and no
   * deletion) is performed in this phase. */
  journalCompactionThresholdEvents: number;
  /** Write a snapshot after every N journal events (1 = every event). */
  snapshotIntervalEvents: number;
  archiveBehavior: 'move_within_state_root';
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  completedRunRetention: 'preserve',
  stoppedRunRetention: 'preserve',
  journalCompactionThresholdEvents: 10_000,
  snapshotIntervalEvents: 1,
  archiveBehavior: 'move_within_state_root',
};

export function validateRetentionPolicy(policy: RetentionPolicy): string[] {
  const problems: string[] = [];
  if (policy.completedRunRetention !== 'preserve') problems.push('completed-run retention must preserve evidence in this phase.');
  if (policy.stoppedRunRetention !== 'preserve') problems.push('stopped-run retention must preserve evidence in this phase.');
  if (!Number.isInteger(policy.snapshotIntervalEvents) || policy.snapshotIntervalEvents < 1) {
    problems.push('snapshotIntervalEvents must be a positive integer.');
  }
  if (!Number.isInteger(policy.journalCompactionThresholdEvents) || policy.journalCompactionThresholdEvents < 100) {
    problems.push('journalCompactionThresholdEvents must be >= 100.');
  }
  return problems;
}

/* --------------------------- run metadata --------------------------- */

export interface RunMetadata {
  schemaVersion: string;
  runId: string;
  projectId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  lifecycle: RunLifecycleState;
  archived: boolean;
}

export interface RunIndexEntry {
  runId: string;
  projectId: string;
  displayName: string;
  lifecycle: RunLifecycleState;
  phase: string;
  updatedAt: string;
  archived: boolean;
  recoveryRequired: boolean;
}

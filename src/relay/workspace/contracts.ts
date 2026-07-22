import type { EvidenceRecord } from '../protocol/contracts';
import type { EvidenceId, ProjectId, RunId, TaskId, WorkspaceRefId } from '../protocol/ids';
import type { EventDraft } from '../protocol/envelopes';
import type { RelayResult } from '../protocol/errors';

/**
 * Workspace contracts (Prompt 7) — provider-neutral types and ports for the
 * isolated worktree and safe local execution foundation. PURE module: no
 * Node imports. Relay Core and clients see only these shapes; the Node
 * implementation lives behind the ports (worktree-manager, command-runner)
 * and is composed ONLY by the workspace composition root (index.ts).
 *
 * This is LIVE LOCAL infrastructure (provenance 'live') — never confused
 * with live AI provider execution, which remains unavailable.
 */

export const WORKSPACE_STATUSES = [
  'requested', 'validating', 'creating', 'ready', 'active', 'dirty',
  'checkpoint_required', 'completed', 'failed', 'cancelled',
  'cleaning', 'preserved', 'removed',
] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const CLEANUP_POLICIES = [
  'preserve_always', 'preserve_on_failure', 'preserve_on_checkpoint',
  'remove_on_success', 'manual_cleanup',
] as const;
export type CleanupPolicy = (typeof CLEANUP_POLICIES)[number];

/** Orchestrator-facing profile lives in the browser-safe protocol layer so
 * Relay Core never imports workspace code. Re-exported here for cohesion. */
export { WORKSPACE_PROFILES } from '../protocol/enums';
export type { WorkspaceProfile } from '../protocol/enums';

export interface RelayWorkspace {
  workspaceId: WorkspaceRefId;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  /** Canonical (realpath) root of the SOURCE repository — never modified. */
  sourceRepositoryPath: string;
  /** Exact commit the workspace was created from. */
  sourceRevision: string;
  /** Base branch of the source at pin time ('(detached)' when headless). */
  baseBranch: string;
  /** Whether the source working tree was dirty at pin time (uncommitted
   * source changes are NEVER copied — the worktree starts from the commit). */
  sourceDirtyAtPin: boolean;
  workspacePath: string;
  branchName: string;
  status: WorkspaceStatus;
  createdAt: string;
  lastInspectedAt?: string;
  cleanupPolicy: CleanupPolicy;
  provenance: 'live';
}

/* ------------------------- path policy ------------------------------ */

/** Repository-specific protected paths — supplied as policy input, never
 * hardcoded into generic Relay code. All paths are repository-relative. */
export interface ProtectedPathPolicy {
  /** Never touched at all; any change is a protected_change. */
  forbidden: string[];
  /** Readable but never written; a write is a protected_change. */
  readOnly: string[];
}

export interface WorkspacePolicyInput {
  protectedPaths: ProtectedPathPolicy;
  /** The task's active write claims (repository-relative). */
  claimedWritePaths: string[];
}

export type ChangeAssessment =
  | 'clean'
  | 'allowed'
  | 'unclaimed_change'
  | 'protected_change'
  | 'outside_workspace'
  | 'symlink_escape'
  | 'unsupported_inspection';

export interface WorkspaceInspection {
  workspaceId: WorkspaceRefId;
  revision: string;
  branch: string;
  clean: boolean;
  changedFiles: string[];
  untrackedFiles: string[];
  claimedChanges: string[];
  unclaimedChanges: string[];
  protectedChanges: string[];
  symlinkEscapes: string[];
  conflictState: 'none' | 'merge-conflict' | 'unknown';
  /** Worst finding wins: symlink_escape > protected_change >
   * unclaimed_change > allowed > clean. */
  assessment: ChangeAssessment;
  inspectedAt: string;
}

export interface SourceInspection {
  revision: string;
  branch: string;
  dirty: boolean;
  changed: boolean;
  inspectedAt: string;
}

/* ------------------------ command execution ------------------------- */

export interface WorkspaceCommandRequest {
  commandId: string;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  workspaceId: WorkspaceRefId;
  /** Bare executable name resolved via PATH — never a path, never a shell. */
  executable: string;
  args: string[];
  /** Repository-relative; resolved and validated inside the workspace. */
  relativeWorkingDirectory?: string;
  /** Extra environment keys requested — intersected with the policy
   * allowlist, then filtered through the secret-name denylist. */
  environmentKeys?: string[];
  timeoutMs?: number;
  outputLimitBytes?: number;
  expectedPurpose: string;
  idempotencyKey?: string;
}

export type WorkspaceCommandStatus =
  | 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'output_limit' | 'rejected';

export type TerminationOutcome =
  | 'not_required' | 'termination_confirmed' | 'termination_unconfirmed';

export interface WorkspaceCommandResult {
  commandId: string;
  workspaceId: WorkspaceRefId;
  status: WorkspaceCommandStatus;
  executableLabel: string;
  redactedArgs: string[];
  exitCode: number | null;
  signal: string | null;
  /** Bounded and secret-sanitized — never raw unbounded output. */
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  termination: TerminationOutcome;
  /** Environment keys actually granted (names only, never values). */
  grantedEnvironmentKeys: string[];
  rejectionReasons?: string[];
  provenance: 'live';
  enforcement: 'enforced';
  evidenceRefs: EvidenceId[];
}

/** One approved executable and (optionally) its allowed first arguments. */
export interface ApprovedCommandRule {
  executable: string;
  description: string;
  /** When present, args[0] must be one of these. */
  allowedFirstArgs?: string[];
}

export interface WorkspaceCommandPolicy {
  rules: ApprovedCommandRule[];
  environmentAllowlist: string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  defaultOutputLimitBytes: number;
  maxOutputLimitBytes: number;
}

/* ----------------------------- cleanup ------------------------------ */

export type CleanupOutcome =
  | 'preserved' | 'cleanup_complete' | 'cleanup_failed' | 'cleanup_refused';

export interface CleanupResult {
  workspaceId: WorkspaceRefId;
  outcome: CleanupOutcome;
  detail: string;
  at: string;
}

/* ------------------------------ ports ------------------------------- */

export interface WorkspaceOperationOutput<T> {
  value: T;
  events: EventDraft[];
  evidence: EvidenceRecord[];
}

export interface PrepareWorkspaceRequest {
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  sourceRepositoryPath: string;
  /** Optional explicit branch (validated); default relay/run/<safe-run-id>. */
  branchName?: string;
  cleanupPolicy?: CleanupPolicy;
}

export interface WorkspaceManagerPort {
  prepareWorkspace(request: PrepareWorkspaceRequest):
    RelayResult<WorkspaceOperationOutput<{ workspace: RelayWorkspace; idempotent: boolean }>>;
  getWorkspace(workspaceId: WorkspaceRefId): RelayWorkspace | null;
  listWorkspaces(): readonly RelayWorkspace[];
  cleanupWorkspace(workspaceId: WorkspaceRefId, options?: { authorizeRemoval?: boolean }):
    RelayResult<WorkspaceOperationOutput<CleanupResult>>;
}

export interface WorkspaceInspectionPort {
  inspectWorkspace(workspaceId: WorkspaceRefId, policy: WorkspacePolicyInput):
    RelayResult<WorkspaceOperationOutput<WorkspaceInspection>>;
  verifySourceUnchanged(workspaceId: WorkspaceRefId):
    RelayResult<WorkspaceOperationOutput<SourceInspection>>;
}

export interface CommandExecutionPort {
  executeCommand(request: WorkspaceCommandRequest):
    Promise<RelayResult<WorkspaceOperationOutput<WorkspaceCommandResult>>>;
  cancelCommand(commandId: string): boolean;
}

export interface WorkspaceService
  extends WorkspaceManagerPort, WorkspaceInspectionPort, CommandExecutionPort {
  /** All evidence produced so far (live-local provenance). */
  collectEvidence(): readonly EvidenceRecord[];
  /** All normalized event drafts produced so far. */
  collectEvents(): readonly EventDraft[];
}

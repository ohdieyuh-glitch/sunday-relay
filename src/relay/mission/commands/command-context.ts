/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Mission command context — the typed, deterministic world a command is
 * validated against.
 *
 * These are the SMALLEST compatibility records Milestone 2 needs — they are
 * NOT the production types and NOT a second source of truth:
 *
 *   - `CommandAgentPassportRecord` is a compatibility record, not the full
 *     Agent Passport (that arrives with Per-Agent Execution Capsules,
 *     Milestone 3, alongside a RunStatus/TaskStatus adapter).
 *   - `CommandAgentRunContext.childProcessRefs` are opaque DOMAIN references;
 *     Milestone 2 never inspects or controls a real process.
 *   - Budget records gain real economics in Milestone 5; the trace ledger
 *     (Milestone 4) will make command events hash-chained and durable.
 *   - The context is assembled by callers (fixtures today, the Mission
 *     Operations interface in Milestone 6) — the domain never reads a clock,
 *     which is why `evaluationTime` is caller-supplied.
 *
 * Independence semantics intentionally reuse the production structural rule
 * (`reviewerIsIndependent`, src/relay/mission/entitlement.ts): identity is
 * the execution identity — a new session of the same identity is the SAME
 * party.
 */

import type { AqualaOutcomeStatus, AqualaReleasePolicy } from '../status/status-model';

/* ------------------------------------------------------------- mission */

/** Binding Mission Contract restrictions a command may collide with. A
    conflict is never silently bypassed: amendable contracts route through
    explicit authorized approval; non-amendable contracts reject. */
export interface CommandMissionContractSummary {
  productionWritesProhibited: boolean;
  deploymentProhibited: boolean;
  networkAccessProhibited: boolean;
  maximumRepairAttempts: number;
  independentReviewRequired: boolean;
  protectedFiles: string[];
  maximumBudgetUsd: number | null;
  humanReleaseApprovalRequired: boolean;
  /** Whether an explicit authorized approval may amend contract policy. */
  amendable: boolean;
}

export interface CommandBudgetContext {
  currentSpendUsd: number;
  maximumSpendUsd: number | null;
  categoryLimitsUsd: Record<string, number>;
  approvalPolicy: 'auto_within_limits' | 'human_approval_over_limit' | 'hard_limit';
  /** Fraction of the current maximum treated as a MATERIAL increase. */
  materialIncreaseFraction: number;
}

export interface CommandMissionContext {
  projectId: string;
  missionId: string;
  missionRevision: number;
  /** The mission's current artifact revision (stale-review detection). */
  artifactRevision: string;
  /** Caller-supplied evaluation instant (ISO) — the domain never reads a clock. */
  evaluationTime: string;
  contract: CommandMissionContractSummary;
  /** Milestone 1 four-status model at mission scope. */
  status: AqualaOutcomeStatus;
  releasePolicy?: AqualaReleasePolicy;
  budget: CommandBudgetContext;
  /** Deterministic mission-scoped notations (e.g. escalation target). */
  annotations: Record<string, string>;
}

/* --------------------------------------------------------------- tasks */

export type CommandTaskResponsibility =
  | 'implementation'
  | 'review'
  | 'repair'
  | 'architecture'
  | 'operations';

export interface CommandTaskContext {
  taskId: string;
  title: string;
  taskRevision: number;
  responsibility: CommandTaskResponsibility;
  /** Current owner (write responsibility), or null when unassigned. */
  ownerAgentId: string | null;
  /** Milestone 1 four-status model at task scope. */
  status: AqualaOutcomeStatus;
  /** Prerequisite task ids this task depends on. */
  dependsOn: string[];
  unresolvedFindingIds: string[];
  workspaceId: string | null;
  priority: number;
  /** Whether this task's changes may touch production-designated paths. */
  touchesProduction: boolean;
  /** Where this task's output is consumed ('default' = its dependents). */
  outputTarget: string;
}

/* ---------------------------------------------------------- agent runs */

export type CommandAgentRunState =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /** A user asked for a retry of a failed run; a NEW run performs it. */
  | 'retry_requested';

/** Deterministic DOMAIN record of partially completed work — never a live
    inspection of files or processes. */
export interface CommandRunPartialWork {
  changedFiles: string[];
  commandsRun: number;
  testsRun: number;
  knownErrors: string[];
  /** Partial findings an interrupted reviewer has already confirmed. */
  findingIds: string[];
  unresolvedQuestions: string[];
  costConsumedUsd: number;
}

export interface CommandAgentRunContext {
  runId: string;
  taskId: string;
  requestedAgentId: string;
  actualAgentId: string;
  state: CommandAgentRunState;
  partialWork: CommandRunPartialWork;
  /** Opaque domain references to child processes — never real PIDs Relay
      would signal from this milestone. */
  childProcessRefs: string[];
  checkpointStatus: 'none' | 'required' | 'satisfied' | 'failed';
}

/* -------------------------------------------------------------- agents */

export type CommandAgentType = 'claude_code' | 'codex' | 'hermes' | 'human' | 'other';

export interface CommandPermissionContext {
  readablePaths: string[];
  writablePaths: string[];
  allowedCommands: string[];
  networkPolicy: 'none' | 'restricted' | 'full';
  toolPolicy: string[];
  secretPolicy: 'none' | 'handles_only';
  productionAccess: boolean;
  /** ISO expiry, or null for non-expiring. Compared to evaluationTime. */
  expiresAt: string | null;
  revoked: boolean;
}

/** Compatibility record standing in for the future Agent Passport
    (Milestone 3). Only what Milestone 2 must validate. */
export interface CommandAgentPassportRecord {
  passportId: string;
  compatibleResponsibilities: CommandTaskResponsibility[];
  permissions: CommandPermissionContext;
}

export interface CommandAgentContext {
  agentId: string;
  agentType: CommandAgentType;
  displayName: string;
  /** Execution identity — a new session of the same identity is the SAME
      party for independence purposes. */
  executionIdentity: string;
  /** Structural independence lineage (matches entitlement.ts semantics). */
  adapterId: string;
  independenceGroup: string;
  sessionId: string | null;
  passport: CommandAgentPassportRecord;
  rolesInMission: Array<'implementer' | 'reviewer' | 'architect' | 'repair'>;
  /** Artifact revisions this agent implemented / reviewed in this mission. */
  implementedArtifactRevisions: string[];
  reviewedArtifactRevisions: string[];
}

/* ---------------------------------------------------------- workspaces */

export interface CommandWorkspaceContext {
  workspaceId: string;
  isolationMode: 'isolated_worktree' | 'shared' | 'browser_virtual';
  /** Exactly one active write owner unless allowsParallelWriters. */
  writeOwnerAgentId: string | null;
  readablePaths: string[];
  writablePaths: string[];
  branch: string;
  /** The CLI worktree and the browser worktree must never be confused. */
  kind: 'cli_worktree' | 'browser_worktree';
  allowsParallelWriters: boolean;
}

/* ------------------------------------------------------------- reviews */

export type CommandReviewStatus =
  | 'in_progress'
  | 'completed'
  | 'incomplete'
  | 'stale'
  | 'invalidated';

export interface CommandReviewContext {
  reviewId: string;
  taskId: string;
  reviewerAgentId: string;
  /** The artifact revision the review examined. */
  artifactRevision: string;
  status: CommandReviewStatus;
  findingIds: string[];
  independent: boolean;
  runId?: string;
}

/* ------------------------------------------------------------- context */

export interface RelayMissionCommandContext {
  mission: CommandMissionContext;
  tasks: CommandTaskContext[];
  agentRuns: CommandAgentRunContext[];
  agents: CommandAgentContext[];
  workspaces: CommandWorkspaceContext[];
  reviews: CommandReviewContext[];
}

/* ------------------------------------------------------------- lookups */

export function findTask(
  context: RelayMissionCommandContext,
  taskId: string,
): CommandTaskContext | undefined {
  return context.tasks.find((t) => t.taskId === taskId);
}

export function findAgent(
  context: RelayMissionCommandContext,
  agentId: string,
): CommandAgentContext | undefined {
  return context.agents.find((a) => a.agentId === agentId);
}

export function findWorkspace(
  context: RelayMissionCommandContext,
  workspaceId: string,
): CommandWorkspaceContext | undefined {
  return context.workspaces.find((w) => w.workspaceId === workspaceId);
}

export function findReview(
  context: RelayMissionCommandContext,
  reviewId: string,
): CommandReviewContext | undefined {
  return context.reviews.find((r) => r.reviewId === reviewId);
}

export function findRun(
  context: RelayMissionCommandContext,
  runId: string,
): CommandAgentRunContext | undefined {
  return context.agentRuns.find((r) => r.runId === runId);
}

const ACTIVE_RUN_STATES: readonly CommandAgentRunState[] = ['starting', 'running', 'waiting'];

export function isActiveRunState(state: CommandAgentRunState): boolean {
  return ACTIVE_RUN_STATES.includes(state);
}

/** The active (starting/running/waiting) run for a task, if any. */
export function findActiveRunForTask(
  context: RelayMissionCommandContext,
  taskId: string,
): CommandAgentRunContext | undefined {
  return context.agentRuns.find((r) => r.taskId === taskId && isActiveRunState(r.state));
}

/** Every context record is serializable, so a JSON round-trip is a complete,
    deterministic deep clone (validators and the executor work on clones so
    the caller's context is NEVER mutated). */
export function cloneCommandContext(
  context: RelayMissionCommandContext,
): RelayMissionCommandContext {
  return JSON.parse(JSON.stringify(context)) as RelayMissionCommandContext;
}

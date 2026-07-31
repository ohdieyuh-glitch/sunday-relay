/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Validated Mission Command Protocol — core command types (PURE, browser-safe).
 *
 * The rule this module enforces:
 *
 *   a user command is a REQUEST for a state transition — never the transition
 *   itself.
 *
 * Natural language flows through deterministic interpretation into a typed
 * RelayMissionCommand. Only the validation pipeline may declare a command
 * valid, and only the atomic executor may turn its interpreted changes into
 * Milestone 1 status transitions. The command lifecycle below is deliberately
 * NOT the four-dimension AqualaOutcomeStatus — commands are requests ABOUT
 * missions/tasks, and their lifecycle never collapses into the mission's
 * execution/outcome/verification/release dimensions.
 *
 * No React, no network, no storage, no provider dependencies, no clock — ids
 * and timestamps are supplied by callers exactly as in Milestone 1.
 */

import type { AqualaStatusDimension } from '../status/status-model';

/* ------------------------------------------------------------- intents */

export const RELAY_MISSION_COMMAND_INTENTS = [
  'start',
  'pause',
  'resume',
  'cancel',
  'redirect',
  'reassign',
  'approve',
  'reject',
  'retry',
  'escalate',
  'change_priority',
  'change_budget',
  'change_permissions',
] as const;
export type RelayMissionCommandIntent = (typeof RELAY_MISSION_COMMAND_INTENTS)[number];

/* ----------------------------------------------------- command lifecycle */

export const RELAY_MISSION_COMMAND_STATUSES = [
  'received',
  'interpreted',
  'validation_required',
  'validated',
  'rejected',
  'executing',
  'executed',
  'failed',
] as const;
export type RelayMissionCommandStatus = (typeof RELAY_MISSION_COMMAND_STATUSES)[number];

/* ---------------------------------------------------------------- risk */

export const RELAY_MISSION_COMMAND_RISKS = ['low', 'medium', 'high', 'critical'] as const;
export type RelayMissionCommandRisk = (typeof RELAY_MISSION_COMMAND_RISKS)[number];

/* ------------------------------------------------------- state changes */

export const RELAY_STATE_CHANGE_ENTITY_TYPES = [
  'mission',
  'task',
  'agent_run',
  'workspace',
  'review',
  'permission',
  'budget',
] as const;
export type RelayStateChangeEntityType = (typeof RELAY_STATE_CHANGE_ENTITY_TYPES)[number];

/**
 * One requested entity transition. A state change is NEVER applied merely
 * because the interpreter emitted it — the validator confirms the expected
 * current state and the executor re-confirms it atomically at apply time.
 *
 * For mission/task changes that target the Milestone 1 four-status model,
 * `statusDimension` names the dimension and previous/requested states are the
 * raw Aquala status values. Non-dimension changes use `key:value` state
 * strings (`owner:agent-claude`, `write_owner:none`, `max_usd:20`).
 */
export interface RelayStateChange {
  changeId: string;
  entityType: RelayStateChangeEntityType;
  entityId: string;
  previousState: string;
  requestedState: string;
  reason: string;
  /** Present when the change is a Milestone 1 status transition. */
  statusDimension?: AqualaStatusDimension;
  /** Expected entity revision at apply time, when the entity is revisioned. */
  expectedRevision?: number;
}

/* -------------------------------------------------------------- drafts */

/**
 * The interpreter's output — a command BEFORE validation. It carries the
 * revisions the interpretation was based on so the validator and executor can
 * reject stale drafts instead of applying them.
 */
export interface RelayMissionCommandDraft {
  projectId: string;
  missionId: string;
  issuedByUserId: string;
  issuedAt: string;
  /** Secret-redacted natural language (never raw provider/system text). */
  naturalLanguageRequest: string;
  intent: RelayMissionCommandIntent;
  /** Explicit compound interpretation — never silently merged intents. */
  secondaryIntents: RelayMissionCommandIntent[];
  targetTaskIds: string[];
  targetAgentIds: string[];
  interpretedChanges: RelayStateChange[];
  missionRevision: number;
  taskRevisions: Record<string, number>;
}

/* ------------------------------------------------------ command record */

export interface RelayMissionCommand {
  commandId: string;
  projectId: string;
  missionId: string;
  issuedByUserId: string;
  issuedAt: string;
  /** Secret-redacted natural language request. */
  naturalLanguageRequest: string;

  intent: RelayMissionCommandIntent;
  /** Explicit compound interpretation — retained, never silently merged. */
  secondaryIntents: RelayMissionCommandIntent[];

  targetTaskIds: string[];
  targetAgentIds: string[];

  interpretedChanges: RelayStateChange[];

  affectedDependencies: string[];
  affectedWorkspaces: string[];
  affectedReviews: string[];
  affectedFindings: string[];

  checkpointRequired: boolean;
  approvalRequired: boolean;
  independenceRiskDetected: boolean;
  permissionChangeDetected: boolean;

  risk: RelayMissionCommandRisk;
  /** Deterministic factors behind the risk level (domain-calculated). */
  riskFactors: string[];
  status: RelayMissionCommandStatus;

  missionRevision: number;
  taskRevisions: Record<string, number>;

  rejectionReason?: string;
  executionEventIds: string[];
}

/* -------------------------------------------------------- prerequisites */

export const RELAY_COMMAND_PREREQUISITE_KINDS = ['checkpoint', 'human_approval'] as const;
export type RelayCommandPrerequisiteKind = (typeof RELAY_COMMAND_PREREQUISITE_KINDS)[number];

export const RELAY_COMMAND_PREREQUISITE_STATUSES = [
  'pending',
  'satisfied',
  'failed',
] as const;
export type RelayCommandPrerequisiteStatus =
  (typeof RELAY_COMMAND_PREREQUISITE_STATUSES)[number];

/**
 * Something that must be true before a validated command may execute. A
 * checkpoint prerequisite references the checkpoint requirement it enforces;
 * a human-approval prerequisite records who satisfied it. Prerequisites are
 * enforced again at execution time — satisfying one never executes anything.
 */
export interface RelayCommandPrerequisite {
  prerequisiteId: string;
  commandId: string;
  kind: RelayCommandPrerequisiteKind;
  description: string;
  status: RelayCommandPrerequisiteStatus;
  /** Checkpoint prerequisites: the task/run the checkpoint must capture. */
  taskId?: string;
  runId?: string;
  satisfiedBy?: string;
  satisfiedAt?: string;
  failureReason?: string;
}

/* -------------------------------------------------- checkpoint contract */

export const RELAY_COMMAND_CHECKPOINT_CAPTURES = [
  'partial_output',
  'changed_files',
  'commands',
  'tests',
  'errors',
  'findings',
  'processes',
  'workspace_state',
  'cost',
  'unresolved_questions',
] as const;
export type RelayCommandCheckpointCapture =
  (typeof RELAY_COMMAND_CHECKPOINT_CAPTURES)[number];

export const RELAY_COMMAND_CHECKPOINT_STATUSES = [
  'not_required',
  'required',
  'satisfied',
  'failed',
] as const;
export type RelayCommandCheckpointStatus =
  (typeof RELAY_COMMAND_CHECKPOINT_STATUSES)[number];

/**
 * Checkpoint-before-intervention: what must be captured (as DOMAIN records —
 * never real files or processes) before active work may be paused, cancelled,
 * redirected, or reassigned. `requiredCapture` is a list because interrupted
 * work usually has several things worth preserving at once.
 */
export interface RelayCommandCheckpointRequirement {
  required: boolean;
  taskId: string;
  runId?: string;
  reasons: string[];
  requiredCapture: RelayCommandCheckpointCapture[];
  status: RelayCommandCheckpointStatus;
}

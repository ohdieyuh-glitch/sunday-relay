/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 2
 * Validated Mission Command Protocol — public surface.
 *
 * Natural language never mutates mission state. The only path is:
 * interpret (deterministic) → validate (24-step pipeline) → preview →
 * prerequisites (checkpoint / human approval) → ATOMIC execution →
 * immutable ordered events. See docs/relay/MISSION_COMMAND_PROTOCOL.md.
 */

export * from './command-types';
export * from './command-errors';
export * from './command-context';
export * from './command-interpreter';
export { DeterministicCommandInterpreter } from './deterministic-command-interpreter';
export { calculateCheckpointRequirements } from './command-checkpoint';
export {
  analyzeDependencyImpact,
  findUnmetPrerequisites,
  type DependencyImpact,
} from './command-dependencies';
export {
  evaluateReviewerIndependence,
  type IndependenceAssessment,
} from './command-independence';
export {
  evaluatePermissionCompatibility,
  type PermissionAssessment,
} from './command-permissions';
export {
  evaluateWorkspaceCompatibility,
  type WorkspaceAssessment,
} from './command-workspace';
export {
  calculateCommandRisk,
  calculateApprovalRequirement,
  type CommandRiskInput,
  type CommandRiskResult,
  type ApprovalRequirementResult,
} from './command-risk';
export {
  validateMissionCommand,
  currentEntityState,
  type RelayMissionCommandValidationResult,
  type ValidateMissionCommandInput,
  type CommandValidationAnalyses,
} from './command-validator';
export {
  projectCommandPreview,
  type RelayMissionCommandPreview,
  type CommandPreviewAnalyses,
} from './command-preview';
export {
  createCommandEvent,
  redactCommandMetadata,
  RELAY_MISSION_COMMAND_EVENT_TYPES,
  type RelayMissionCommandEvent,
  type RelayMissionCommandEventType,
  type CreateCommandEventInput,
} from './command-events';
export {
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
  type RepositoryResult,
  type StoredExecutionOutcome,
} from './command-repository';
export {
  submitMissionCommand,
  executeMissionCommand,
  resolveCommandPrerequisite,
  type SubmitMissionCommandInput,
  type SubmitMissionCommandResult,
  type ExecuteMissionCommandInput,
  type ExecuteMissionCommandResult,
  type ResolvePrerequisiteInput,
  type ResolvePrerequisiteResult,
} from './command-executor';

/**
 * SUNDAY RELAY — LOOP ENGINE (barrel).
 *
 * ONE grammar, ONE target contract, consumed identically by the website
 * composer, the CLI and every test. Re-exported through `../index` (the
 * mission barrel) for the same reason mission economics, the agent operating
 * foundation, worktrees, the coding agent, the prompt architect and the
 * reviewer harness are: the CLI boundary permits only the bare `../mission`
 * path, and BOTH surfaces must normalize a command through the SAME parser
 * rather than each growing their own.
 *
 * Everything here is PURE and browser-safe. The durable Loop runtime, the
 * scheduler and the Unchain meter are server-side and live elsewhere; nothing
 * in this directory may import them.
 */

export {
  commandRequestsExecution,
  isSlashCommandInput,
  parseSlashCommand,
  routeRelayInput,
} from './loop-command-parser';

export {
  RELAY_INPUT_ROUTES,
  RELAY_LOOP_ACTIONS,
  RELAY_LOOP_ACTIONS_ACCEPTING_ID,
  RELAY_LOOP_SCHEDULE_VERBS,
  RELAY_SLASH_COMMAND_KINDS,
  RELAY_SLASH_FAMILIES,
  RELAY_SWARM_ACTIONS_ACCEPTING_ID,
  RELAY_SWARM_LOOP_ACTIONS,
  type RelayInputRoute,
  type RelayLoopAction,
  type RelayLoopActionCommand,
  type RelayLoopCatalogCommand,
  type RelayLoopCommand,
  type RelayLoopComposerCommand,
  type RelayLoopCreateCommand,
  type RelayLoopCronCreateCommand,
  type RelayLoopScheduleCommand,
  type RelayLoopScheduleComposerCommand,
  type RelayLoopScheduleCreateCommand,
  type RelayLoopScheduleListCommand,
  type RelayLoopScheduleVerb,
  type RelayParsedSlashCommand,
  type RelaySlashCommand,
  type RelaySlashCommandKind,
  type RelaySlashFamily,
  type RelaySwarmLoopAction,
  type RelaySwarmLoopActionCommand,
  type RelaySwarmLoopCommand,
  type RelaySwarmLoopComposerCommand,
  type RelaySwarmLoopCreateCommand,
} from './loop-command-types';

export {
  RELAY_LOOP_RECORD_SCHEMA_V1,
  RELAY_LOOP_RECORD_SCHEMA_VERSION,
  SUPPORTED_LOOP_RECORD_SCHEMA_VERSIONS,
  contractStillBinds,
  createRelayLoopStore,
  readLoopRecord,
  sealLoopRecord,
  type LoopReadResult,
  type LoopWriteResult,
  type RelayLoopIterationRef,
  type RelayLoopOwnerLease,
  type RelayLoopRecord,
  type RelayLoopRecordDraft,
  type RelayLoopRecordSchemaVersion,
  type RelayLoopStorePort,
} from './loop-store';

export {
  projectLoopCommandPreview,
  renderLoopPreviewLines,
  type RelayLoopCommandPreview,
  type RelayLoopPreviewInput,
  type RelayLoopPreviewRow,
} from './loop-preview';

export {
  ALL_LOOP_FEATURES_DISABLED,
  RELAY_LOOP_AVAILABILITY_STATES,
  RELAY_LOOP_FEATURES,
  RELAY_LOOP_FEATURE_DEPENDENCIES,
  UNCHAIN_GRANTING_STATES,
  UNCHAIN_METER_STATES,
  UNCHAIN_TEMPORARY_SLOTS,
  evaluateLoopAvailability,
  featureEffectivelyEnabled,
  featureEnabled,
  unchainSessionProblem,
  type RelayLoopAvailability,
  type RelayLoopAvailabilityInput,
  type RelayLoopAvailabilityState,
  type RelayLoopFeature,
  type RelayLoopFeatureFlags,
  type UnchainMeterState,
  type UnchainSessionRecord,
} from './loop-availability';

export {
  RELAY_ELIGIBILITY_BLOCKER_REASONS,
  RELAY_LOOP_BLOCKER_REASONS,
  RELAY_LOOP_BLOCKER_SOURCES,
  blockersForUnavailableRoles,
  blockersFromEligibility,
  runtimeBlocker,
  type RelayEligibilityCheckLike,
  type RelayEligibilityResultLike,
  type RelayLoopBlocker,
  type RelayLoopBlockerReason,
  type RelayLoopBlockerSource,
  type RelayLoopRuntimeCondition,
} from './loop-blockers';

export {
  COMPLETION_SUPPORTING_TRUSTS,
  RELAY_LOOP_COMPLETION_VERDICTS,
  claimAloneCompletes,
  evaluateLoopCompletion,
  trustSupportsCompletion,
  type RelayLoopCompletionInput,
  type RelayLoopCompletionResult,
  type RelayLoopCompletionVerdict,
  type RelayLoopEvidenceSummary,
  type RelayLoopIterationOutcomeSummary,
} from './loop-completion';

export {
  DEFAULT_LOOP_LIMITS,
  RELAY_LOOP_CONTRACT_SCHEMA_V1,
  RELAY_LOOP_CONTRACT_SCHEMA_VERSION,
  RELAY_LOOP_CREATION_SOURCES,
  RELAY_LOOP_STATES,
  RELAY_LOOP_STOP_CONDITIONS,
  RELAY_LOOP_TYPES,
  RELAY_SWARM_STATES,
  RESUMABLE_LOOP_STATES,
  SUPPORTED_LOOP_CONTRACT_SCHEMA_VERSIONS,
  TERMINAL_LOOP_STATES,
  buildLoopContract,
  isBindingLoopChange,
  loopBindingFields,
  validateLoopContractDraft,
  type RelayLoopContract,
  type RelayLoopContractDraft,
  type RelayLoopContractSchemaVersion,
  type RelayLoopCreationSource,
  type RelayLoopLimits,
  type RelayLoopReviewPolicy,
  type RelayLoopScope,
  type RelayLoopState,
  type RelayLoopStopCondition,
  type RelayLoopType,
  type RelaySwarmState,
} from './loop-contract';

export {
  ASSIGNABLE_ROLE_AVAILABILITY,
  RELAY_ROLE_AVAILABILITIES,
  requestedRolesFor,
  resolveLoopTarget,
  targetIsStaffable,
  withObservedAssignment,
  type RelayAgentRegistrySnapshot,
  type RelayLoopRoleAssignment,
  type RelayLoopTarget,
  type RelayLoopUnavailableRole,
  type RelayRoleAvailability,
} from './loop-target';

export {
  DEFAULT_LOOP_TARGET,
  RELAY_LOOP_ALL_ALIASES,
  RELAY_LOOP_CANONICAL_ALIAS,
  RELAY_LOOP_ROLE_ALIASES,
  RELAY_LOOP_ROLE_WORDS,
  RELAY_LOOP_TARGETABLE_ROLES,
  RELAY_LOOP_TARGET_KINDS,
  isAllTargetWord,
  looksLikeTargetExpression,
  parseRoleExpression,
  roleForAlias,
  type RelayLoopTargetKind,
  type RelayLoopTargetSelector,
  type RoleExpressionProblem,
  type RoleExpressionResult,
} from './loop-roles';

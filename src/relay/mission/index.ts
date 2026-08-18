/**
 * Mission projection layer (Prompt 8.1). PURE, browser-safe read-model
 * projections DERIVED from canonical Relay state — not a second source of
 * truth and not a second workflow engine. Consumed by the CLI now and the
 * future graphical Mission Control.
 */

export * from './contracts';
export {
  validateMissionConfig, defaultMissionConfig,
  RELAY_EXECUTION_MODES, RELAY_REVIEW_REQUIREMENTS, RELAY_COMPLETION_RULES,
  type RelayMissionConfig, type RelayMissionLimits, type RelayRoleSelection,
  type RelayExecutionMode, type RelayReviewRequirement, type RelayCompletionRule,
} from './mission-config';
export {
  buildMissionContract, validateMissionSpec, stableDigest, bindingFields,
  isBindingChange, handoffIsStale,
} from './mission';
export {
  buildExecutionAttestation, attestsSuccessfulExecution, hasAttestedExecutionBy,
  type ExecutionFacts,
} from './attestation';
export {
  projectReviewLedger, reviewHasActionableFinding, repairExpandsFileClaims,
  openBlockingFindings, type ReviewInput, type ProjectReviewInput,
} from './review-repair';
export { evaluateMissionVerdict, claimedCompleteVerdict, type MissionVerdictInput } from './verdict';
export { buildMissionTimeline, type TimelineEventInput, type TimelineContext } from './timeline';
export { projectMission, type MissionProjectionInput, type MissionProjectionBundle } from './read-models';
export {
  RELAY_MODES, defaultModePolicy, selectMode, buildAutonomousConsent,
  validateAutonomousAccess, actionRequiresStop, AUTONOMOUS_STOP_ACTIONS, SEMI_STOP_ACTIONS,
  type RelayMode, type RelayModePolicy, type AutonomousConsent, type AutonomousAccessGrant,
  type ModeTransition, type BoundaryAction,
} from './modes';
export {
  createCredentialHandle, handleIsActive, revokeHandle, evaluateHandleAccess, accessSummary,
  type CredentialHandle, type CredentialHandleInput, type HandleCapability, type HandleAccessResult,
} from './credential-handle';
export {
  DOG_STATES, computeDogActivity, renderDogFrames, DOG_FRAME,
  type DogState, type RelayDogActivity, type DogComputeInput, type DogEventInput,
} from './dog';
export {
  ENTITLEMENTS, entitlementPolicy, computeOutputVisibility, reviewerIsIndependent,
  assignReviewer, buildReviewerPackage, OUTPUT_VISIBILITIES,
  type RelayEntitlement, type EntitlementPolicy, type OutputVisibility,
  type ReviewerProfile, type ReviewerPackage, type ReleaseGateInput,
} from './entitlement';
export {
  projectTerminalEvent, redactTerminalText, createInProcessTerminalStream, buildAgentExchanges,
  type RelayTerminalEvent, type RelayTerminalReadModel, type ConnectionState,
  type TerminalProvenanceLabel, type ProjectTerminalEventInput, type AgentExchange, type TerminalStream,
} from './terminal';
export {
  evaluateReviewerGate,
  type ReviewerGateInput, type ReviewerGateResult, type IndependenceParty,
} from './reviewer-gate';
export {
  // Mission Economics (Milestone 5) — the SHARED core, byte-identical with
  // the website. Re-exported here because the CLI boundary permits only the
  // bare '../mission' barrel.
  createCostReceipt, createAdjustment, markProvisional, finalizeReceipt,
  disputeReceipt, voidReceipt, InMemoryCostReceiptRepository,
  createMissionBudget, createBudgetApproval, applyApprovedIncrease,
  evaluateMissionBudget, aggregateMissionEconomics, projectMissionEconomics,
  formatMoney, money, moneyFromDecimalString, amountLabel, boundedLabel,
  UNKNOWN_LABEL, NOT_AVAILABLE_LABEL, PENDING_LABEL, NOT_CONFIGURED_LABEL,
  AT_LEAST_PREFIX, AT_MOST_PREFIX,
  SIMULATED_DATA_LABEL, MIXED_DATA_LABEL, NO_DATA_LABEL,
  type RelayMoney, type RelayCostReceipt, type RelayCostCategory,
  type RelayMissionBudget, type RelayBudgetEvaluation,
  type RelayMissionEconomics, type RelayMissionEconomicsProjection,
  type RelayEconomicsDataSource,
} from './economics-barrel';
export {
  // Agent operating foundation — the four canonical components every Relay
  // Dog has. Re-exported here for the same reason economics is: the CLI
  // boundary permits only the bare '../mission' barrel, and BOTH surfaces
  // must import the one projection rather than format their own labels.
  RELAY_AGENT_ROLES, RELAY_OPERATING_COMPONENTS, RELAY_ROLE_TOOL_GRANTS,
  RELAY_AGENT_ROLE_LABEL, RELAY_OPERATING_COMPONENT_LABEL,
  NOT_CONNECTED_LABEL,
  projectAgentOperatingProfile, projectAgentOperatingProfiles,
  buildAgentOperatingProfile, missionContractReference,
  runtimeReferenceFromAttestation, unknownRuntimeReference,
  toolGrantsForRole, toolGrantsOutsidePolicy, toolGrantsWithinPolicy,
  operatingProfileFixture, operatingProfileFixtures,
  OPERATING_FIXTURE_CONTRACT, OPERATING_FIXTURE_ENVIRONMENT,
  OPERATING_FIXTURE_MISSION, OPERATING_FIXTURE_MODE,
  type RelayAgentOperatingProfile, type RelayAgentOperatingProjection,
  type RelayAgentRole, type RelayOperatingComponent, type RelayOperatingRow,
  type RelayRuntimeReference, type RelayMissionContractReference,
  type RelayEnvironmentReference, type RelayToolGrant,
} from './agent-operating';

export {
  // Isolated mission worktrees — re-exported for the same reason economics
  // and the agent operating foundation are: the CLI boundary permits only
  // the bare '../mission' barrel, and BOTH surfaces must render the one
  // worktree projection rather than word the same state differently.
  MISSION_BRANCH_PREFIX, MISSION_WORKTREE_STATES, PROTECTED_BRANCH_NAMES,
  WORKTREE_SCHEMA_VERSION, WORKTREE_STATE_LABEL,
  NO_WORKTREE_LABEL, WORKTREE_OFFLINE_LABEL, WORKTREE_SIMULATED_LABEL,
  abbreviateWorktreePath, createMissionWorktreeStore, deriveMissionBranch,
  projectMissionWorktree, readWorktreeRecord, renderWorktreeStatusLines,
  sealWorktreeRecord, validateMissionBranch, worktreeRefFor,
  type MissionWorktreeRecord, type MissionWorktreeRecordDraft,
  type MissionWorktreeState, type MissionWorktreeStorePort,
  type MissionWorktreeView, type WorktreeReadResult,
  type WorktreeValidationFinding,
} from './worktree';

export {
  // The Coding Agent runtime — re-exported through the barrel for the same
  // reason worktrees and economics are: the CLI boundary permits only the
  // bare '../mission' path, and BOTH surfaces must render the one runtime
  // projection rather than word a connection state differently.
  CODING_AGENT_CAPABILITIES, CODING_AGENT_CONNECTION_STATES,
  CODING_AGENT_RUNTIME_SCHEMA_VERSION, CONNECTION_STATE_LABEL,
  BRIDGE_REQUIRED_LABEL, SIMULATED_RUNTIME_LABEL, NO_CAPABILITIES, UNKNOWN_USAGE,
  availabilityFromProbe, capabilitiesFromProbe, runtimeRecordForMission,
  classifyRecoveredRuntime, codingAgentDraftFrom, createCodingAgentStore,
  idleCodingAgentRecord, notificationForRuntime,
  projectCodingAgentRuntime, readCodingAgentRecord, renderCodingAgentStatusLines,
  runtimeRecordFromObservation, sealCodingAgentRecord, usageFromRuntimeReport,
  type CodingAgentCapabilities, type CodingAgentConnectionState,
  type CodingAgentRuntimeRecord, type CodingAgentRuntimeRecordDraft,
  type CodingAgentRunObservation,
  type CodingAgentStorePort, type CodingAgentAvailability, type CodingAgentProbeInput,
  type CodingAgentView,
} from './coding-agent';

export {
  // Prompt Architect — re-exported through the barrel for the same reason as
  // worktrees and the coding agent: the CLI boundary permits only the bare
  // '../mission' path, and BOTH surfaces must render the one projection.
  ARCHITECT_BRIDGE_REQUIRED_LABEL, ARCHITECT_SIMULATED_LABEL, ARCHITECT_STATE_LABEL,
  PROMPT_ARCHITECT_CAPABILITIES, PROMPT_ARCHITECT_SCHEMA_VERSION,
  NO_ARCHITECT_CAPABILITIES, UNKNOWN_ARCHITECT_USAGE,
  architectDraftFrom, architectNotification, boundHandoff, buildArchitectContext,
  classifyRecoveredArchitect, createPromptArchitectStore, idleArchitectRecord,
  planNeedsInput, projectPromptArchitect, readArchitectRecord, redactContextText,
  renderArchitectStatusLines, renderContextInput, renderContractInstruction,
  sealArchitectRecord, validateArchitectPlan,
  type ArchitectPlan, type ArchitectConnectionState, type ContextBlock,
  type PromptArchitectRecord, type PromptArchitectRecordDraft,
  type PromptArchitectStorePort, type PromptArchitectView,
} from './prompt-architect';

export {
  // Loop Engine — re-exported through the barrel for the same reason economics,
  // worktrees, the coding agent, the prompt architect and the reviewer harness
  // are: the CLI boundary permits only the bare '../mission' path, and BOTH
  // surfaces must normalize a slash command through the SAME parser rather
  // than each growing their own grammar.
  ALL_LOOP_FEATURES_DISABLED, COMPLETION_SUPPORTING_TRUSTS, DEFAULT_LOOP_LIMITS,
  DEFAULT_LOOP_TARGET, RELAY_ELIGIBILITY_BLOCKER_REASONS, RELAY_INPUT_ROUTES,
  RELAY_LOOP_ACTIONS, RELAY_LOOP_ACTIONS_ACCEPTING_ID, RELAY_LOOP_ALL_ALIASES,
  RELAY_LOOP_AVAILABILITY_STATES, RELAY_LOOP_BLOCKER_REASONS,
  RELAY_LOOP_BLOCKER_SOURCES, RELAY_LOOP_CANONICAL_ALIAS,
  RELAY_LOOP_COMPLETION_VERDICTS, RELAY_LOOP_CONTRACT_SCHEMA_VERSION,
  RELAY_LOOP_CREATION_SOURCES, RELAY_LOOP_FEATURES, RELAY_LOOP_FEATURE_DEPENDENCIES,
  RELAY_LOOP_RECORD_SCHEMA_VERSION, SUPPORTED_LOOP_RECORD_SCHEMA_VERSIONS,
  contractStillBinds, createRelayLoopStore, readLoopRecord, sealLoopRecord,
  RELAY_LOOP_ROLE_ALIASES, RELAY_LOOP_ROLE_WORDS, RELAY_LOOP_SCHEDULE_VERBS,
  RELAY_LOOP_STATES, RELAY_LOOP_STOP_CONDITIONS, RELAY_LOOP_TARGETABLE_ROLES,
  RELAY_LOOP_TARGET_KINDS, RELAY_LOOP_TYPES, RELAY_ROLE_AVAILABILITIES,
  RELAY_SLASH_COMMAND_KINDS, RELAY_SLASH_FAMILIES, RELAY_SWARM_ACTIONS_ACCEPTING_ID,
  RELAY_SWARM_LOOP_ACTIONS, RELAY_SWARM_STATES, RESUMABLE_LOOP_STATES,
  TERMINAL_LOOP_STATES, UNCHAIN_GRANTING_STATES, UNCHAIN_METER_STATES,
  UNCHAIN_TEMPORARY_SLOTS,
  blockersForUnavailableRoles, blockersFromEligibility, buildLoopContract,
  claimAloneCompletes, commandRequestsExecution, evaluateLoopAvailability,
  evaluateLoopCompletion, featureEffectivelyEnabled, featureEnabled,
  isBindingLoopChange, isSlashCommandInput, looksLikeTargetExpression,
  parseRoleExpression, parseSlashCommand, projectLoopCommandPreview,
  renderLoopPreviewLines, requestedRolesFor, resolveLoopTarget,
  roleForAlias, routeRelayInput, runtimeBlocker, targetIsStaffable,
  trustSupportsCompletion, unchainSessionProblem, validateLoopContractDraft,
  withObservedAssignment,
  type RelayAgentRegistrySnapshot, type RelayInputRoute, type RelayLoopAction,
  type RelayLoopAvailability, type RelayLoopBlocker, type RelayLoopBlockerReason,
  type RelayLoopCommand, type RelayLoopCompletionInput, type RelayLoopCompletionResult,
  type RelayLoopCompletionVerdict, type RelayLoopContract, type RelayLoopContractDraft,
  type RelayLoopCreateCommand, type RelayLoopCreationSource, type RelayLoopFeature,
  type RelayLoopFeatureFlags, type RelayLoopLimits, type RelayLoopRoleAssignment,
  type RelayLoopCommandPreview, type RelayLoopIterationRef, type RelayLoopOwnerLease,
  type RelayLoopPreviewInput, type RelayLoopPreviewRow, type RelayLoopRecord,
  type RelayLoopRecordDraft, type RelayLoopStorePort,
  type RelayLoopScheduleCommand, type RelayLoopScope, type RelayLoopState,
  type RelayLoopStopCondition, type RelayLoopTarget, type RelayLoopTargetKind,
  type RelayLoopTargetSelector, type RelayLoopType, type RelayParsedSlashCommand,
  type RelayRoleAvailability, type RelaySlashCommand, type RelaySlashFamily,
  type RelaySwarmLoopAction, type RelaySwarmLoopCommand, type RelaySwarmState,
  type UnchainMeterState, type UnchainSessionRecord,
  // Stage 2 runtime read-models. Re-exported through the barrel so the CLI
  // (which may import only '../mission') and the website render the ONE
  // projection rather than each building their own from the domain.
  type LoopHistoryEntry, type LoopInspectionProjection, type LoopStatusProjection,
} from './loop';

export {
  // Reviewer harness — re-exported through the barrel so the CLI (which may
  // import only '../mission') and the website render the ONE projection.
  CATALOG_STATUS_LABEL, HARNESS_STATE_LABEL, NO_HARNESS_CAPABILITIES,
  NO_PROVEN_CAPABILITIES_LABEL, REVIEWER_HARNESS_CAPABILITIES, REVIEWER_HARNESS_CATALOG,
  REVIEWER_HARNESS_NOT_CONNECTED_LABEL, REVIEWER_HARNESS_SCHEMA_VERSION,
  REVIEWER_SIMULATED_LABEL, REVIEWER_TOOLS,
  UNKNOWN_HARNESS_USAGE, UNKNOWN_INDEPENDENCE,
  HARNESS_READINESS_LABEL, HARNESS_READINESS_STATES, NO_RUNTIME_EVIDENCE,
  assessHarnessReadiness, effectiveCatalogEntry,
  assessIndependence, blockingFindings, classifyRecoveredHarness,
  createReviewerHarnessStore, findCatalogEntry, grantReviewerTools,
  harnessDraftFrom, harnessIsSelectableForRun, idleHarnessRecord,
  isForbiddenReviewerTool, projectHarnessCatalog, projectReviewerHarness, readHarnessRecord,
  renderCatalogLine, renderHarnessCatalogLines, renderReviewerStatusLines,
  retryHarnessRun, reviewerNotification, sealHarnessRecord,
  validateProposedResult, validatedVerdictFor,
  type HarnessCapabilityView, type HarnessCatalogEntryView, type HarnessConnectionState,
  type HarnessReadinessAssessment, type HarnessReadinessState, type HarnessRuntimeEvidence,
  type IndependenceAssessment, type ProposedVerdict,
  type ReviewerHarnessCatalogEntry, type ReviewerHarnessCatalogView,
  type ReviewerHarnessRecord,
  type ReviewerHarnessRecordDraft, type ReviewerHarnessStorePort,
  type ReviewerHarnessView, type ReviewerIdentityEvidence, type ReviewerIdentityRow,
} from './reviewer-harness';

// Wonderland Coliseum — the duel domain (lifecycle, sandbox guarantee,
// command console, proof meter, rewards, durable store, results projection).
// Re-exported through the barrel for the same reason economics is: the CLI
// boundary permits only the bare '../mission' path, and BOTH surfaces must
// render the ONE results projection rather than each building their own.
export * from './coliseum';

/**
 * ROLE SLOTS — the permanent roles, as TYPES and vocabulary only.
 *
 * Straight from the CONTRACTS module rather than through the `role-slots`
 * barrel, and that is the whole point. Occupants carry the server-side
 * variable names their adapters read — a provider key among them — and this
 * barrel is reachable from the browser entry point, so re-exporting anything
 * through the sub-barrel pulled the registry, and therefore those names, into
 * the browser's import graph and into its bundle. Type-only exports do not
 * help: the graph is walked as text, because that is what a bundler resolves.
 *
 * A variable name is not a secret. Publishing the server's configuration
 * surface to a client that has no business knowing it is still a boundary this
 * repository already decided, and `connectors/gpt-architect/browser-isolation
 * .test.ts` walks the real graph from `main.tsx` to hold it.
 *
 * So the website gets the ROLE VOCABULARY, and reads occupant facts through
 * `src/relay/ui/project-workspace/role-occupant-map.ts`, whose table carries
 * no configuration name at all and is parity-tested against the registry from
 * a test — where importing it is free of consequence.
 */
export { ROLE_SLOTS } from './role-slots/role-slot-contracts';
export type {
  BillingPath, ExecutionEnvironment, OccupantKind, RoleBinding, RoleBindingProblem,
  RoleBindingRefusal, RoleOccupant, RoleSlot, RoleSlotBindingResult,
} from './role-slots/role-slot-contracts';
// `RoleSlotRequest` is deliberately absent: it lives beside `bindRoleSlots`,
// which imports the registry, so re-exporting it here would put the registry
// back into the browser's graph. The bridge — its only consumer — imports it
// from `./role-slots` directly, where that costs nothing.

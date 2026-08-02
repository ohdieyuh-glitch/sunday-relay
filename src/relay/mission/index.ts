/**
 * Mission projection layer (Prompt 8.1). PURE, browser-safe read-model
 * projections DERIVED from canonical Relay state — not a second source of
 * truth and not a second workflow engine. Consumed by the CLI now and the
 * future graphical Mission Control.
 */

export * from './contracts';
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

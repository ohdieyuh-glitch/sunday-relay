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

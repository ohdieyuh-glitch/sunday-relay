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
  formatMoney, money, moneyFromDecimalString, amountLabel,
  type RelayMoney, type RelayCostReceipt, type RelayCostCategory,
  type RelayMissionBudget, type RelayBudgetEvaluation,
  type RelayMissionEconomics, type RelayMissionEconomicsProjection,
} from './economics-barrel';

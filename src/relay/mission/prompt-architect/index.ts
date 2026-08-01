/**
 * PROMPT ARCHITECT — the canonical, provider-neutral planning runtime: its
 * record, the strict plan validation and handoff bounding, the deterministic
 * context builder, the one projection both surfaces render, and its store.
 * Pure domain: no SDK, no network, no clock.
 */
export {
  ACTIVE_ARCHITECT_STATES, ARCHITECT_APPROVAL_STATES, ARCHITECT_CONNECTION_STATES,
  ARCHITECT_FAILURE_CLASSES, BLOCKING_ARCHITECT_STATES, NO_ARCHITECT_CAPABILITIES,
  PROMPT_ARCHITECT_CAPABILITIES, PROMPT_ARCHITECT_SCHEMA_V1,
  PROMPT_ARCHITECT_SCHEMA_VERSION, SUPPORTED_PROMPT_ARCHITECT_VERSIONS,
  UNKNOWN_ARCHITECT_USAGE,
} from './prompt-architect-contracts';
export type {
  ArchitectApprovalState, ArchitectAssumption, ArchitectConnectionState,
  ArchitectDecision, ArchitectFailureClass, ArchitectHandoffProposal,
  ArchitectIdentity, ArchitectPlan, ArchitectQuestion, ArchitectRequirement,
  ArchitectRisk, ArchitectStep, ArchitectUsage, PromptArchitectCapabilities,
  PromptArchitectCapability, PromptArchitectRecord, PromptArchitectRecordDraft,
  PromptArchitectSchemaVersion,
} from './prompt-architect-contracts';
export {
  architectDraftFrom, classifyRecoveredArchitect, idleArchitectRecord,
  readArchitectRecord, sealArchitectRecord, verifyArchitectChecksum,
} from './prompt-architect-record';
export type { ArchitectReadResult } from './prompt-architect-record';
export { boundHandoff, planNeedsInput, validateArchitectPlan } from './prompt-architect-plan';
export type { BoundedHandoff, MissionContractBounds, PlanValidation } from './prompt-architect-plan';
export {
  CONTEXT_SECRET_KEY_RE, CONTEXT_SECRET_VALUE_RE, buildArchitectContext,
  redactContextText, renderContextInput, renderContractInstruction,
} from './prompt-architect-context';
export type { ContextBlock, ContextBuildOptions, ContextBuildResult } from './prompt-architect-context';
export {
  ARCHITECT_BRIDGE_REQUIRED_LABEL, ARCHITECT_SIMULATED_LABEL, ARCHITECT_STATE_LABEL,
  architectNotification, projectPromptArchitect, renderArchitectStatusLines,
} from './prompt-architect-projection';
export type { ArchitectProjectionOptions, PromptArchitectView } from './prompt-architect-projection';
export { createPromptArchitectStore } from './prompt-architect-store';
export type { ArchitectWriteResult, PromptArchitectStorePort } from './prompt-architect-store';

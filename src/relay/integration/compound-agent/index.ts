/**
 * COMPOUND AGENT CONFIGURATION — the Relay-side barrel.
 *
 * Everything exported here is CONFIGURATION Relay owns. Nothing here executes,
 * schedules, routes, budgets, verifies or repairs; those are Julius's and
 * reaching for them from this namespace is the boundary inverting.
 */

export {
  COMPOUND_AGENT_SLOTS,
  COMPOUND_AGENT_ACTIVATIONS,
  COMPOUND_AGENT_REFUSALS,
  JULIUS_RESERVED_TOKEN,
  identityIsReservedForJulius,
  normalizeIntegrationIdentity,
  type CompoundAgentSlot,
  type CompoundAgentSlotSelection,
  type CompoundAgentActivation,
  type CompoundAgentConfiguration,
  type CompoundAgentMissionDefaults,
  type CompoundAgentProblem,
  type CompoundAgentReadiness,
  type CompoundAgentRefusal,
  type CompoundAgentValidation,
  type PinnedRevisionReference,
} from './compound-agent-contracts';

export {
  COMPOUND_AGENT_ID,
  authorizeCompoundAgentRead,
  checkCompoundAgentSlots,
  createCompoundAgentConfiguration,
  evaluateCompoundAgentReadiness,
  parseCompoundAgentDraft,
  updateCompoundAgentConfiguration,
  type CompoundAgentAuthority,
  type CompoundAgentDraft,
  type CompoundAgentDraftResult,
  type IntegrationDirectory,
  type IntegrationDirectoryEntry,
} from './compound-agent-config';

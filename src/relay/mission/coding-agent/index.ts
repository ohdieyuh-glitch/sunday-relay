/**
 * CODING-AGENT RUNTIME — the canonical, provider-neutral record of what is
 * actually running a mission, its capabilities, the one projection both
 * surfaces render, and the recovery classification. Pure domain: no process,
 * no Node, no clock. The Claude Code implementation lives in
 * `src/relay/connectors/claude-code/`, which the browser may never import.
 */
export {
  ACTIVE_CONNECTION_STATES, BLOCKING_CONNECTION_STATES,
  CODING_AGENT_CAPABILITIES, CODING_AGENT_CONNECTION_STATES,
  CODING_AGENT_EXECUTION_MODES, CODING_AGENT_PROCESS_STATES,
  CODING_AGENT_RUNTIME_SCHEMA_V1, CODING_AGENT_RUNTIME_SCHEMA_VERSION,
  NO_CAPABILITIES, SUPPORTED_CODING_AGENT_SCHEMA_VERSIONS, UNKNOWN_USAGE,
} from './coding-agent-contracts';
export type {
  CodingAgentCapabilities, CodingAgentCapability, CodingAgentConnectionState,
  CodingAgentEvidence, CodingAgentExecutionMode, CodingAgentIdentity,
  CodingAgentProcessState, CodingAgentRuntimeRecord,
  CodingAgentRuntimeRecordDraft, CodingAgentSchemaVersion, CodingAgentUsage,
} from './coding-agent-contracts';
export {
  classifyRecoveredRuntime, codingAgentDraftFrom, idleCodingAgentRecord,
  readCodingAgentRecord, sealCodingAgentRecord, verifyCodingAgentChecksum,
} from './coding-agent-record';
export type { CodingAgentReadResult } from './coding-agent-record';
export {
  BRIDGE_REQUIRED_LABEL, CODING_AGENT_NOTIFICATIONS, CONNECTION_STATE_LABEL,
  SIMULATED_RUNTIME_LABEL, notificationForRuntime, projectCodingAgentRuntime,
  renderCodingAgentStatusLines,
} from './coding-agent-projection';
export type { CodingAgentProjectionOptions, CodingAgentView } from './coding-agent-projection';
export { createCodingAgentStore } from './coding-agent-store';
export type { CodingAgentStorePort, CodingAgentWriteResult } from './coding-agent-store';
export {
  availabilityFromProbe, capabilitiesFromProbe, runtimeRecordForMission,
} from './coding-agent-capabilities';
export type { CodingAgentAvailability, CodingAgentProbeInput } from './coding-agent-capabilities';

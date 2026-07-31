/**
 * SUNDAY RELAY — AGENT OPERATING FOUNDATION (barrel).
 *
 * A Relay Dog is a visible compound-agent identity operating through a
 * RUNTIME, under a MISSION CONTRACT, inside an ENVIRONMENT, using explicitly
 * granted TOOLS. Everything needed to state that on any surface is exported
 * here, and every surface imports the SAME projection.
 */

export {
  RELAY_AGENT_ROLES,
  RELAY_ENVIRONMENT_ACCESS,
  RELAY_NETWORK_POLICIES,
  RELAY_OPERATING_COMPONENTS,
  RELAY_RUNTIME_AVAILABILITIES,
  RELAY_WORKSPACE_KINDS,
  type RelayAgentOperatingProfile,
  type RelayAgentRole,
  type RelayEnvironmentAccess,
  type RelayEnvironmentReference,
  type RelayMissionContractReference,
  type RelayNetworkPolicy,
  type RelayOperatingComponent,
  type RelayRuntimeAvailability,
  type RelayRuntimeReference,
  type RelayToolGrant,
  type RelayWorkspaceKind,
} from './operating-profile-types';

export {
  NOT_CONNECTED_LABEL,
  RELAY_AGENT_ROLE_LABEL,
  RELAY_OPERATING_COMPONENT_LABEL,
  environmentLabelOf,
  executionModeLabelOf,
  missionContractLabelOf,
  projectAgentOperatingProfile,
  projectAgentOperatingProfiles,
  runtimeLabelOf,
  toolsLabelOf,
  type RelayAgentOperatingProjection,
  type RelayOperatingRow,
} from './operating-profile-projection';

export {
  RELAY_KNOWN_TOOL_IDS,
  RELAY_ROLE_TOOL_GRANTS,
  toolGrantsForRole,
  toolGrantsOutsidePolicy,
  toolGrantsWithinPolicy,
} from './operating-profile-tools';

export {
  buildAgentOperatingProfile,
  missionContractReference,
  runtimeReferenceFromAttestation,
  unknownRuntimeReference,
  type BuildAgentOperatingProfileInput,
} from './operating-profile-builder';

export {
  OPERATING_FIXTURE_CONTRACT,
  OPERATING_FIXTURE_ENVIRONMENT,
  OPERATING_FIXTURE_MISSION,
  OPERATING_FIXTURE_MODE,
  OPERATING_FIXTURE_PROJECT,
  operatingProfileFixture,
  operatingProfileFixtures,
} from './operating-profile-fixtures';

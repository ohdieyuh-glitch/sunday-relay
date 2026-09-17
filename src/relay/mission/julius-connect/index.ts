/**
 * JULIUS CONNECT — the barrel.
 *
 * The user says WHAT they want connected; Julius works out HOW (OAuth/API, MCP, an API credential, or governed browser
 * interaction) and automates everything short of the genuine trust boundary. Authority is capability-based and
 * project-scoped: a project uses exactly what was granted to it, through a credential handle, and a revoked connection
 * refuses at once. Pure domain: registry, lifecycle, capability gate, audit, mission dependency, surface.
 *
 * NOT re-exported through `src/relay/mission/index.ts`, like `wonder-web` and `julius`: a surface that needs it imports
 * this path, and that edge gets reviewed then. The runtime side -- the development adapters, the credential vault and
 * the local service Wonderland talks to -- lives in `relay-bridge/julius-connect/`.
 */

export {
  CAPABILITY_DENIALS,
  CAPABILITY_REQUEST_STATES,
  CAPABILITY_RISKS,
  CONNECT_AUDIT_ACTIONS,
  CONNECT_EDGES,
  CONNECT_ROUTES,
  CONNECT_ROUTE_LABELS,
  CONNECT_STATES,
  CONNECT_STATE_LABELS,
  EMPTY_JULIUS_CONNECT_STATE,
  EXTERNAL_CAPABILITY_REQUIRED,
  JULIUS_CONNECT_SCHEMA_V1,
  connectionKindLabel,
  isLegalConnectTransition,
} from './connect-contracts';
export type {
  CapabilityDecision,
  CapabilityDenial,
  CapabilityRequest,
  CapabilityRequestState,
  CapabilityRisk,
  ConnectAuditAction,
  ConnectAuditEvent,
  ConnectHealth,
  ConnectRoute,
  ConnectState,
  Connection,
  ConnectorCapability,
  ConnectorDescriptor,
  ConnectorRouteOption,
  JuliusConnectState,
  PreparedStep,
} from './connect-contracts';

export { JULIUS_CONNECT_REGISTRY, chooseConnectRoute, discoverConnectors, findConnector, planCapabilityAsk } from './connect-registry';

export {
  PROJECT_GRANT_DEFAULT_EXPIRY,
  approveRequest,
  auditAction,
  authorizeCapabilityUse,
  completeAuthorization,
  declineRequest,
  grantProjectAccess,
  isSecretShaped,
  latestConnection,
  needsAuthorization,
  recordCapabilityUse,
  requestCapabilities,
  revokeConnection,
  setConnectionHealth,
} from './connect-lifecycle';
export type { AuthorizationOutcome, CapabilityRequestOutcome, ConnectClock } from './connect-lifecycle';

export { CONNECT_TASK_TEMPLATES, DESIGN_SYNC_TEMPLATE, SOCIAL_POST_TEMPLATE, WEB_LOOKUP_TEMPLATE, advanceConnectTask, startConnectTask } from './connect-mission';
export type { ConnectStepExecutor, ConnectTask, ConnectTaskStep, ConnectTaskTemplate } from './connect-mission';

export { CONNECTIONS_SURFACE_SCHEMA, assertConnectionsSurfaceIsSafe, projectConnectionsSurface } from './connect-surface';
export type {
  ConnectionsSurface,
  ConnectionsSurfaceAuditRow,
  ConnectionsSurfaceCapability,
  ConnectionsSurfacePrompt,
  ConnectionsSurfaceService,
  ConnectionsSurfaceSetupRow,
  ConnectionsSurfaceTask,
} from './connect-surface';

export type { ConnectCredentialVaultPort, ConnectAuthorizerPort } from './connect-ports';

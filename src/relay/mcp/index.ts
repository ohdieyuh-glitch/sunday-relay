/**
 * SUNDAY RELAY — MCP FOUNDATION, public surface.
 *
 * Relay is an MCP HOST and a policy authority. Agents do not connect to MCP
 * servers; they ask the Relay MCP Gateway, which decides.
 *
 * THIS BARREL IS BROWSER-SAFE. It exports domain contracts, policy, the
 * registry, mission preflight and the PSP contract — all pure. It deliberately
 * does NOT re-export:
 *
 *   ../client/       the connection manager (drives transports)
 *   ../transports/   stdio and Streamable HTTP (child processes, sockets, SDK)
 *   ../testing/      the offline fake servers
 *
 * Those are server-only and are imported by their full paths from server-side
 * code. `src/relay/shared/browser-boundary.test.ts` forbids a browser entry
 * from reaching them, and `mcp-boundary.test.ts` forbids anything outside
 * `client/` and `transports/` from importing the MCP SDK. A barrel that
 * re-exported them would defeat both by making one import look harmless.
 *
 * See docs/relay/MCP_FOUNDATION.md.
 */

/* ------------------------------- domain ------------------------------ */
export {
  MCP_BASELINE_PROTOCOL_REVISION, MCP_SUPPORTED_PROTOCOL_REVISIONS, MCP_KNOWN_REVISIONS,
  MCP_TRANSPORT_KINDS, MCP_UNSUPPORTED_TRANSPORT_KINDS, isSupportedTransportKind,
  negotiateProtocol,
  type McpTransportKind, type McpProtocolIdentity, type McpProtocolNegotiation,
} from './domain/mcp-protocol';

export {
  MCP_FINGERPRINT_VERSION, UNFINGERPRINTABLE,
  fingerprintValue, normalizeCapabilityValue, isFingerprintable,
  type McpCapabilityFingerprint,
} from './domain/mcp-fingerprint';

export {
  MCP_FAILURE_CATEGORIES, MCP_NEVER_SUCCESS_CATEGORIES,
  mcpFailure, mcpOk, mcpFail, forbidsSuccess,
  type McpFailure, type McpFailureCategory, type McpOutcome,
} from './domain/mcp-failure';

export {
  MCP_VERIFICATION_METHODS, MCP_SERVER_TRUST_LEVELS,
  identityConfirmed, verifyDeclaredIdentity,
  type McpServerIdentity, type McpServerTrust, type McpVerificationMethod,
  type McpDeclaredServerIdentity, type McpRequestedServerIdentity,
} from './domain/mcp-identity';

export {
  MCP_CREDENTIAL_CLASSES, MCP_CREDENTIAL_STATES, FORBIDDEN_CREDENTIAL_FIELDS,
  forbiddenCredentialFieldsIn, credentialIsUsable, missingScopes,
  type McpCredentialReference, type McpCredentialClass, type McpCredentialState,
} from './domain/mcp-credential';

export {
  MCP_CAPABILITY_KINDS, MCP_CAPABILITY_CHANGE_KINDS, EMPTY_ANNOTATIONS,
  normalizeTool, normalizeResource, normalizePrompt, normalizeAnnotations,
  normalizeCapabilityFlags, snapshotFingerprint, diffSnapshots,
  findTool, findResource, findPrompt,
  type McpCapabilityKind, type McpCapabilitySnapshot, type McpToolDefinition,
  type McpResourceDefinition, type McpPromptDefinition, type McpToolAnnotations,
  type McpServerCapabilityFlags, type McpCapabilityChange, type McpCapabilityChangeKind,
  type McpCapabilityDiff,
} from './domain/mcp-capabilities';

export {
  MCP_CONNECTION_STATES, MCP_CONNECTION_STATE_LABELS,
  canInvoke, isRetryable, isTerminal, transitionAllowed, connectionUsableBy,
  type McpConnection, type McpConnectionDefinition, type McpConnectionScope, type McpConnectionState,
} from './domain/mcp-connection';

export {
  MCP_INVOCATION_STATES, MCP_UNSUCCESSFUL_STATES,
  summarizeArguments, argumentFingerprint, settleInvocation,
  type McpInvocationRequest, type McpInvocationResult, type McpInvocationState,
  type McpAuditRecord, type McpSafeArgumentSummary, type McpSafeResultSummary,
  type McpSanitizedContentBlock,
} from './domain/mcp-invocation';

/**
 * `McpCredentialResolverPort` and `McpResolvedCredential` are DELIBERATELY NOT
 * re-exported here. They are the one place real secret material exists, they
 * are implemented and consumed only on the server side, and a browser-safe
 * barrel that offers them invites an import that has no business existing.
 * Server-side code imports them from `./domain/mcp-ports` directly, and
 * `mcp-boundary.test.ts` asserts the set of files that may.
 */
export type {
  McpClientPort, McpTransportFactoryPort, McpTransportOpenRequest, McpTransportSession,
  McpSnapshotStorePort, McpEvidenceStorePort,
  McpCallOptions, McpListedCapabilities, McpRawToolResult, McpRawResourceContents, McpRawPromptResult,
} from './domain/mcp-ports';

export {
  MCP_RELAY_SERVER_STATUS, relayMcpServerIsAvailable,
  FUTURE_RELAY_MCP_RESOURCES, FUTURE_RELAY_MCP_TOOLS, FUTURE_RELAY_MCP_NEVER_EXPOSED,
} from './domain/mcp-relay-server-contract';

/**
 * The SHARED SURFACE PROJECTION — the one read model the CLI/terminal and the
 * website/application both render, with one wording for every state, risk
 * class, permission decision and approval state (governance §7).
 */
export {
  MCP_RISK_LABELS, MCP_PERMISSION_LABELS, MCP_APPROVAL_LABELS,
  projectCatalog, projectConnections, projectCapabilities, projectApprovals,
  type McpCatalogRow, type McpConnectionRow, type McpCapabilityRow,
  type McpCapabilitiesView, type McpApprovalRow,
} from './domain/mcp-surface-projection';

/* ------------------------------- policy ------------------------------ */
export {
  MCP_RISK_CLASSES, MCP_HUMAN_APPROVAL_RISK_CLASSES,
  classifyRisk, normalizeToolName, requiresHumanApproval, riskSeverity, higherRisk,
  type McpRiskClass, type McpRiskAssessment, type McpRiskOverride,
} from './policy/mcp-risk';

export {
  MCP_AGENT_ROLES, MCP_FORBIDDEN_ROLES, MCP_ROLE_DEFAULTS, MCP_PERMISSION_DECISIONS,
  evaluatePermission, pathWithinScope, normalizeWorkspacePath,
  type McpAgentRole, type McpPermissionDecision, type McpPermissionDecisionKind,
  type McpPermissionGrant, type McpRoleDefaults,
} from './policy/mcp-permissions';

export {
  MCP_APPROVAL_POLICIES, MCP_APPROVAL_STATES, DEFAULT_MAXIMUM_INVOCATIONS,
  approvalCovers, findCoveringApproval, consumeApproval, revokeApproval,
  type McpApprovalPolicy, type McpApprovalRecord, type McpApprovalRequest,
  type McpApprovalState, type McpApprovalVerdict,
} from './policy/mcp-approvals';

export {
  MCP_DEFAULT_RESULT_LIMITS, MCP_ALLOWED_TEXT_MIME_TYPES,
  sanitizeResult, redactText, detectInjectionSignals, checkStructure,
  containsSecretShapedText, isInlineableMimeType, provenanceHeader,
  type McpResultLimits, type McpSanitizeInput, type McpSanitizeOutput, type McpRawContentBlock,
} from './policy/mcp-sanitize';

export {
  MCP_DEFAULT_NETWORK_POLICY, MCP_LOOPBACK_TEST_NETWORK_POLICY, MCP_ACCEPTED_RESPONSE_TYPES,
  checkUrlPolicy, checkResolvedAddresses, checkRedirect, classifyAddress,
  classifyIpv4, classifyIpv6, addressPermitted, contentTypeAcceptable, originOf,
  type McpNetworkPolicy, type McpAddressClass, type McpDnsResolverPort,
  type McpUrlVerdict, type McpResolutionVerdict, type McpRedirectVerdict,
} from './policy/mcp-network-policy';

/* ------------------------------ registry ----------------------------- */
export {
  MCP_REGISTRY_ENTRY_STATES, MCP_REGISTRY_CATEGORIES,
  isConnectableState, resolveRegistryEntry, validateStdioArguments,
  type McpRegistryEntry, type McpRegistryEntryState, type McpRegistryCategory,
  type McpStdioLaunchDefinition, type McpHttpEndpointDefinition, type McpRegistryLookup,
} from './registry/mcp-registry-types';

export { MCP_REGISTRY_FIXTURES, allFixturesAreSimulations } from './registry/mcp-registry-fixtures';

/* ------------------------------- mission ----------------------------- */
export {
  MCP_PREFLIGHT_FAILURE_CATEGORIES, MCP_PREFLIGHT_READINESS,
  runMcpMissionPreflight, preflightSummaryLine,
  type McpMissionBinding, type McpMissionRequirement, type McpMissionCapabilityRequirement,
  type McpPreflightResult, type McpPreflightFinding, type McpPreflightReadiness,
  type McpPreflightFailureCategory,
} from './mission/mcp-mission-preflight';

export {
  MCP_TRACE_CLAIM_KINDS,
  projectMcpProjectBrain, projectAuditToTrace, assertProjectionIsSafe,
  type McpProjectBrainProjection, type McpBrainConnector, type McpTraceProjection,
} from './mission/mcp-project-brain';

/* --------------------------------- PSP ------------------------------- */
export {
  CONNECT_YOUR_OWN_ACCOUNTS_NOTICE, MCP_PSP_IMPORT_ISSUE_KINDS,
  buildPspTrustManifest, exportPspMcpRequirements, evaluatePspMcpImport,
  assertPspExportCarriesNoCredential,
  type McpPspRequirementSet, type McpPspServerRequirement, type McpPspAgentGrant,
  type McpPspTrustManifest, type McpPspExport, type McpPspImportReadiness, type McpPspImportIssue,
} from './psp/mcp-psp-requirements';

/* ------------------------------- gateway ----------------------------- */
export {
  McpGateway,
  type McpGatewayRequest, type McpGatewayDependencies, type McpGatewayOutcome,
} from './gateway/mcp-gateway';

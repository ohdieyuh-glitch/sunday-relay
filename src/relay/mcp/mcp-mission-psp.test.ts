import { describe, expect, it } from 'vitest';

import type { McpMissionBindingId } from '../protocol/ids';
import type { McpAuditRecord } from './domain/mcp-invocation';
import {
  preflightSummaryLine, runMcpMissionPreflight,
  type McpMissionBinding, type McpMissionRequirement,
} from './mission/mcp-mission-preflight';
import {
  assertProjectionIsSafe, projectAuditToTrace, projectMcpProjectBrain,
} from './mission/mcp-project-brain';
import {
  assertPspExportCarriesNoCredential, buildPspTrustManifest, CONNECT_YOUR_OWN_ACCOUNTS_NOTICE,
  evaluatePspMcpImport, exportPspMcpRequirements, type McpPspRequirementSet,
} from './psp/mcp-psp-requirements';
import { allFixturesAreSimulations, MCP_REGISTRY_FIXTURES } from './registry/mcp-registry-fixtures';
import {
  isConnectableState, resolveRegistryEntry, validateStdioArguments,
} from './registry/mcp-registry-types';
import {
  buildApproval, buildConnection, buildCredential, buildGrant, buildSnapshot,
  memorySnapshotStore, TEST_ACCOUNT, TEST_CONNECTION, TEST_MISSION, TEST_NOW, TEST_REGISTRY_ENTRY,
  TEST_SNAPSHOT, TEST_WORKSPACE, READ_FILE_TOOL_RAW,
} from './testing/mcp-test-fixtures';

/* ==================================================================== *
 * REGISTRY
 * ==================================================================== */

describe('the curated registry', () => {
  it('every fixture entry is marked as a SIMULATION', () => {
    expect(allFixturesAreSimulations()).toBe(true);
    for (const entry of MCP_REGISTRY_FIXTURES) {
      expect(entry.simulation, entry.displayName).toBe(true);
    }
  });

  it('covers the five private-beta categories', () => {
    const categories = new Set(MCP_REGISTRY_FIXTURES.map((e) => e.category));
    for (const category of ['filesystem_repository', 'git_hosting', 'documentation_context', 'database_readonly', 'browser_testing']) {
      expect(categories, category).toContain(category);
    }
  });

  it('never contains a filesystem PATH as an executable — only a name', () => {
    for (const entry of MCP_REGISTRY_FIXTURES) {
      if (entry.stdio === null) continue;
      expect(entry.stdio.executable, entry.displayName).not.toContain('/');
      expect(entry.stdio.executable, entry.displayName).not.toMatch(/^[A-Za-z]:/);
    }
  });

  it('refuses an entry that was never curated', () => {
    const lookup = resolveRegistryEntry(MCP_REGISTRY_FIXTURES, 'mrg_someone_elses_server');
    expect(lookup.refused).toBe(true);
    expect(lookup.refused && lookup.reason).toContain('does not connect to uncurated');
  });

  it('REFUSES a revoked entry and states the revocation reason', () => {
    const lookup = resolveRegistryEntry(MCP_REGISTRY_FIXTURES, 'mrg_fixture_revoked');
    expect(lookup.refused).toBe(true);
    expect(lookup.refused && lookup.reason).toContain('revoked');
  });

  it('refuses draft and reviewed entries — approval is a separate act from review', () => {
    for (const id of ['mrg_fixture_database_readonly', 'mrg_fixture_git_hosting']) {
      const lookup = resolveRegistryEntry(MCP_REGISTRY_FIXTURES, id);
      expect(lookup.refused, id).toBe(true);
    }
  });

  it('permits approved and deprecated entries only', () => {
    expect(isConnectableState('approved')).toBe(true);
    expect(isConnectableState('deprecated')).toBe(true);
    for (const state of ['draft', 'reviewed', 'revoked', 'blocked'] as const) {
      expect(isConnectableState(state), state).toBe(false);
    }
  });

  it('validates additional stdio arguments against the entry allowlist', () => {
    const entry = MCP_REGISTRY_FIXTURES.find((e) => e.registryEntryId === TEST_REGISTRY_ENTRY)!;
    expect(validateStdioArguments(entry.stdio!, ['--scenario=clean_read_only']).ok).toBe(true);
    const refused = validateStdioArguments(entry.stdio!, ['--allow-everything']);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toContain('allowlist');
  });
});

/* ==================================================================== *
 * MISSION PREFLIGHT
 * ==================================================================== */

const requirement = (overrides: Partial<McpMissionRequirement> = {}): McpMissionRequirement => ({
  registryEntryId: TEST_REGISTRY_ENTRY,
  required: true,
  capabilities: [{ capabilityKind: 'tool', name: 'read_file' }],
  requiredScopes: [],
  preApprovedOperations: [],
  minimumProtocolRevision: '2025-11-25',
  ...overrides,
});

const binding = (requirements: readonly McpMissionRequirement[]): McpMissionBinding => ({
  missionBindingId: 'mcb_test0001' as McpMissionBindingId,
  missionId: TEST_MISSION,
  accountId: TEST_ACCOUNT,
  workspaceId: TEST_WORKSPACE,
  projectId: null,
  requirements,
  approvedSnapshots: { 'mcn_test0001': TEST_SNAPSHOT },
  writablePathPrefixes: ['src/'],
  createdAt: TEST_NOW,
});

const preflight = (options: {
  readonly requirements?: readonly McpMissionRequirement[];
  readonly connections?: readonly ReturnType<typeof buildConnection>[];
  readonly grants?: readonly ReturnType<typeof buildGrant>[];
  readonly approvals?: readonly ReturnType<typeof buildApproval>[];
  readonly credentials?: readonly ReturnType<typeof buildCredential>[];
  readonly networkAllows?: boolean;
  readonly bindingOverride?: Partial<McpMissionBinding>;
} = {}) => runMcpMissionPreflight({
  binding: { ...binding(options.requirements ?? [requirement()]), ...options.bindingOverride },
  registry: MCP_REGISTRY_FIXTURES,
  connections: options.connections ?? [buildConnection()],
  snapshots: memorySnapshotStore(buildSnapshot({ tools: [READ_FILE_TOOL_RAW] })),
  credentials: options.credentials ?? [],
  grants: options.grants ?? [buildGrant()],
  approvals: options.approvals ?? [],
  networkPolicyAllows: () => options.networkAllows ?? true,
  now: TEST_NOW,
});

describe('mission preflight', () => {
  it('is READY when every required connector is present, verified, approved and granted', () => {
    const result = preflight();
    expect(result.readiness).toBe('ready');
    expect(result.findings).toEqual([]);
    expect(result.satisfied).toContain(TEST_REGISTRY_ENTRY);
    expect(preflightSummaryLine(result)).toContain('READY');
  });

  it('a REQUIRED connector that is missing BLOCKS readiness', () => {
    const result = preflight({ connections: [] });
    expect(result.readiness).toBe('blocked');
    expect(result.findings[0]?.category).toBe('required_connection_missing');
    expect(result.findings[0]?.blocking).toBe(true);
  });

  it('an OPTIONAL connector that is missing DEGRADES rather than blocking', () => {
    const result = preflight({ requirements: [requirement({ required: false })], connections: [] });
    expect(result.readiness).toBe('degraded');
    expect(result.findings[0]?.category).toBe('optional_connection_unavailable');
    expect(result.findings[0]?.blocking).toBe(false);
    expect(result.degraded).toContain(TEST_REGISTRY_ENTRY);
    expect(preflightSummaryLine(result)).toContain('DEGRADED');
  });

  it('blocks on a missing credential and names what is needed', () => {
    const result = preflight({
      requirements: [requirement({ requiredScopes: ['repo:read'] })],
      connections: [buildConnection()],
    });
    expect(result.readiness).toBe('blocked');
    expect(result.findings[0]?.category).toBe('credential_missing');
  });

  it('blocks on an insufficient scope and NAMES the missing scope', () => {
    const connection = buildConnection({
      definition: { ...buildConnection().definition, credentialReferenceId: 'mcr_test0001' as never },
    });
    const result = preflight({
      requirements: [requirement({ requiredScopes: ['repo:read', 'repo:write'] })],
      connections: [connection],
      credentials: [buildCredential({ scopeSummary: ['repo:read'] })],
    });
    expect(result.findings[0]?.category).toBe('insufficient_scope');
    expect(result.findings[0]?.detail).toContain('repo:write');
  });

  it('blocks on an expired credential as authorization_required', () => {
    const connection = buildConnection({
      definition: { ...buildConnection().definition, credentialReferenceId: 'mcr_test0001' as never },
    });
    const result = preflight({
      requirements: [requirement({ requiredScopes: ['repo:read'] })],
      connections: [connection],
      credentials: [buildCredential({ state: 'expired' })],
    });
    expect(result.findings[0]?.category).toBe('authorization_required');
  });

  it('blocks on capability_changed', () => {
    const result = preflight({ connections: [buildConnection({ state: 'capability_changed' })] });
    expect(result.findings[0]?.category).toBe('capability_changed');
    expect(result.readiness).toBe('blocked');
  });

  it('distinguishes protocol_mismatch from server_unreachable', () => {
    const mismatch = preflight({ connections: [buildConnection({ state: 'protocol_mismatch' })] });
    expect(mismatch.findings[0]?.category).toBe('protocol_mismatch');

    const unreachable = preflight({ connections: [buildConnection({ state: 'unreachable' })] });
    expect(unreachable.findings[0]?.category).toBe('server_unreachable');
  });

  it('blocks when the mission has not approved the current snapshot', () => {
    const result = preflight({ bindingOverride: { approvedSnapshots: {} } });
    expect(result.findings[0]?.category).toBe('capability_changed');
  });

  it('blocks on a missing required capability', () => {
    const result = preflight({
      requirements: [requirement({ capabilities: [{ capabilityKind: 'tool', name: 'not_offered' }] })],
    });
    expect(result.findings.some((f) => f.category === 'capability_missing')).toBe(true);
  });

  it('blocks on a missing permission grant', () => {
    const result = preflight({ grants: [] });
    expect(result.findings.some((f) => f.category === 'permission_missing')).toBe(true);
  });

  it('blocks on a missing pre-approval', () => {
    const result = preflight({ requirements: [requirement({ preApprovedOperations: ['create_issue'] })] });
    expect(result.findings.some((f) => f.category === 'approval_missing')).toBe(true);
  });

  it('accepts a satisfied pre-approval', () => {
    const result = preflight({
      requirements: [requirement({ preApprovedOperations: ['create_issue'] })],
      approvals: [buildApproval({ maximumInvocations: 5, serverName: 'Repository Reader (fixture)' })],
    });
    expect(result.findings.filter((f) => f.category === 'approval_missing')).toEqual([]);
  });

  it('blocks when the network policy refuses the transport', () => {
    const result = preflight({ networkAllows: false });
    expect(result.findings[0]?.category).toBe('network_policy_blocked');
  });

  it('blocks on a registry entry that is not connectable', () => {
    const result = preflight({
      requirements: [requirement({ registryEntryId: 'mrg_fixture_revoked' })],
    });
    expect(result.findings[0]?.category).toBe('registry_untrusted');
  });

  it('never exposes a secret in any finding detail', () => {
    const result = preflight({ connections: [], requirements: [requirement()] });
    for (const finding of result.findings) {
      expect(finding.detail).not.toMatch(/ghp_|sk-|Bearer /);
    }
  });
});

/* ==================================================================== *
 * PROJECT BRAIN
 * ==================================================================== */

describe('Project Brain MCP projection', () => {
  const audit: readonly McpAuditRecord[] = [{
    auditRecordId: 'mcu_1' as McpAuditRecord['auditRecordId'],
    invocationId: 'mci_1' as McpAuditRecord['invocationId'],
    accountId: TEST_ACCOUNT, workspaceId: TEST_WORKSPACE, projectId: null, missionId: TEST_MISSION,
    pspAgentFingerprint: null, actualAgentId: 'agent-1', agentRole: 'coding-agent',
    connectionId: TEST_CONNECTION, serverName: 'Repository Reader (fixture)', serverTrust: 'registry_verified',
    capabilitySnapshotId: TEST_SNAPSHOT, capabilityFingerprint: 'mcpfp1:x' as never,
    capabilityKind: 'tool' as const, capabilityName: 'read_file',
    safeArgumentSummary: { path: 'string(8)' }, argumentFingerprint: 'mcpfp1:y' as never,
    riskClass: 'read_only', permissionDecision: 'allow', permissionReason: 'ok',
    approvalRecordId: null, requestedAt: TEST_NOW, startedAt: TEST_NOW, completedAt: TEST_NOW,
    invocationState: 'completed' as const, cancelled: false, timedOut: false,
    safeResultSummary: { contentBlocks: 1, totalBytes: 12, mimeTypes: [], truncated: false, redactionsApplied: 0, injectionSignals: [], isError: false },
    evidenceReferences: ['evd_1'], failureCategory: null,
    transport: 'stdio', negotiatedProtocolVersion: '2025-11-25',
  }];

  it('projects connectors, decisions and evidence references safely', () => {
    const projection = projectMcpProjectBrain({
      connections: [buildConnection()],
      snapshots: memorySnapshotStore(buildSnapshot()),
      audit,
      preflight: preflight(),
      simulationRegistryEntryIds: [TEST_REGISTRY_ENTRY],
    });
    expect(projection.connectors[0]?.state).toBe('ready');
    expect(projection.connectors[0]?.simulation).toBe(true);
    expect(projection.permissionDecisions.allow).toBe(1);
    expect(projection.evidenceReferences).toContain('evd_1');
    expect(projection.preflightReadiness).toBe('ready');
    expect(assertProjectionIsSafe(projection)).toEqual([]);
  });

  it('the trace projection separates the claim from its evidence and carries no content', () => {
    const trace = projectAuditToTrace(audit[0]!);
    expect(trace.claimKind).toBe('mcp_invocation_completed');
    expect(trace.evidenceReferences).toEqual(['evd_1']);
    expect(assertProjectionIsSafe(trace)).toEqual([]);
    // Only enums, ids and counts.
    for (const value of Object.values(trace.attributes)) {
      expect(['string', 'number', 'boolean', 'object'], typeof value).toContain(typeof value);
    }
  });

  it('flags a projection that somehow contains a secret or a home path', () => {
    expect(assertProjectionIsSafe({ note: 'ghp_FAKETESTNOTREALFAKETESTNOTREALFAKE' }).length).toBeGreaterThan(0);
    expect(assertProjectionIsSafe({ note: '/home/relay-operator/.ssh/id_rsa' }).length).toBeGreaterThan(0);
    expect(assertProjectionIsSafe({ accessToken: 'x' }).length).toBeGreaterThan(0);
  });
});

/* ==================================================================== *
 * PSP
 * ==================================================================== */

const pspRequirements: McpPspRequirementSet = {
  pspRequirementVersion: '1.0.0',
  servers: [
    {
      serverClass: 'filesystem_repository',
      required: true,
      minimumProtocolRevision: '2025-11-25',
      acceptableTransports: ['stdio'],
      requiredTools: ['read_file'],
      requiredResources: [],
      requiredPrompts: [],
      requiredScopes: [],
      maximumRiskClass: 'read_only',
      approvalPolicy: 'ask_every_time',
      requiresVerifiedRegistryServer: true,
      knownCapabilityFingerprints: [],
      requiresHealthyConnection: true,
    },
    {
      serverClass: 'git_hosting',
      required: false,
      minimumProtocolRevision: '2025-11-25',
      acceptableTransports: ['streamable_http'],
      requiredTools: ['create_issue'],
      requiredResources: [],
      requiredPrompts: [],
      requiredScopes: ['repo:read'],
      maximumRiskClass: 'external_write',
      approvalPolicy: 'ask_every_time',
      requiresVerifiedRegistryServer: true,
      knownCapabilityFingerprints: [],
      requiresHealthyConnection: true,
    },
  ],
  grants: [
    { role: 'architect', serverClass: 'filesystem_repository', capabilityKind: 'tool', capabilityNames: ['read_file'], maximumRiskClass: 'read_only', writablePathPrefixes: [] },
    { role: 'coding-agent', serverClass: 'git_hosting', capabilityKind: 'tool', capabilityNames: ['create_issue'], maximumRiskClass: 'external_write', writablePathPrefixes: [] },
  ],
  riskOverrides: [],
};

describe('PSP MCP requirements', () => {
  it('the trust manifest names every write-capable capability and every approval', () => {
    const manifest = buildPspTrustManifest(pspRequirements);
    expect(manifest.requiresGitHosting).toBe(true);
    expect(manifest.readOnly).toBe(false);
    expect(manifest.createsExternalRecords).toBe(true);
    expect(manifest.humanApprovalRequired).toBe(true);
    expect(manifest.writeCapableCapabilities).toContain('create_issue');
    expect(manifest.operationsRequiringApproval).toContain('create_issue');
    expect(manifest.deploymentCapable).toBe(false);
    expect(manifest.accessesCredentials).toBe(false);
    expect(manifest.hasDestructiveCapabilities).toBe(false);
  });

  it('a read-only PSP is reported as read-only', () => {
    const manifest = buildPspTrustManifest({
      ...pspRequirements,
      servers: [pspRequirements.servers[0]!],
      grants: [pspRequirements.grants[0]!],
    });
    expect(manifest.readOnly).toBe(true);
    expect(manifest.humanApprovalRequired).toBe(false);
  });

  it('does not implement Ship on Sunday commerce', () => {
    expect(buildPspTrustManifest(pspRequirements).commerceImplemented).toBe(false);
  });

  it('the EXPORT carries no credential, even when the source object was polluted', () => {
    const polluted = {
      ...pspRequirements,
      servers: pspRequirements.servers.map((s) => ({
        ...s,
        accessToken: 'ghp_FAKETESTNOTREALFAKETESTNOTREALFAKE',
        clientSecret: 'nope',
      })),
    } as unknown as McpPspRequirementSet;

    const exported = exportPspMcpRequirements(polluted);
    expect(assertPspExportCarriesNoCredential(exported)).toEqual([]);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('ghp_FAKETESTNOTREAL');
  });

  it('the export declares no endpoint — a PSP names a server CLASS, never a destination', () => {
    const exported = exportPspMcpRequirements(pspRequirements);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('http://');
    expect(serialized).not.toContain('https://');
  });
});

describe('PSP import readiness', () => {
  it('BLOCKS when a required server class has no connection', () => {
    const readiness = evaluatePspMcpImport({
      requirements: pspRequirements,
      registry: MCP_REGISTRY_FIXTURES,
      connections: [],
      credentials: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.issues.some((i) => i.kind === 'connection_missing' && i.blocking)).toBe(true);
  });

  it('an OPTIONAL server class missing degrades truthfully instead of blocking', () => {
    const readiness = evaluatePspMcpImport({
      requirements: pspRequirements,
      registry: MCP_REGISTRY_FIXTURES,
      connections: [buildConnection()],
      credentials: [],
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.degraded).toBe(true);
    expect(readiness.issues.every((i) => !i.blocking)).toBe(true);
  });

  it('reports an unverified server', () => {
    const readiness = evaluatePspMcpImport({
      requirements: { ...pspRequirements, servers: [pspRequirements.servers[0]!] },
      registry: MCP_REGISTRY_FIXTURES,
      connections: [buildConnection({ identity: { ...buildConnection().identity, trust: 'registry_declared' } })],
      credentials: [],
    });
    expect(readiness.issues.some((i) => i.kind === 'server_unverified')).toBe(true);
  });

  it('reports an unhealthy connection', () => {
    const readiness = evaluatePspMcpImport({
      requirements: { ...pspRequirements, servers: [pspRequirements.servers[0]!] },
      registry: MCP_REGISTRY_FIXTURES,
      connections: [buildConnection({ state: 'unreachable' })],
      credentials: [],
    });
    expect(readiness.issues.some((i) => i.kind === 'connection_unhealthy')).toBe(true);
  });

  it('reports an unacceptable transport', () => {
    const readiness = evaluatePspMcpImport({
      requirements: {
        ...pspRequirements,
        servers: [{ ...pspRequirements.servers[0]!, acceptableTransports: ['streamable_http'] }],
      },
      registry: MCP_REGISTRY_FIXTURES,
      connections: [buildConnection()],
      credentials: [],
    });
    expect(readiness.issues.some((i) => i.kind === 'transport_unsupported')).toBe(true);
  });

  it('always tells the importer to connect their OWN accounts', () => {
    const readiness = evaluatePspMcpImport({
      requirements: pspRequirements,
      registry: MCP_REGISTRY_FIXTURES,
      connections: [],
      credentials: [],
    });
    expect(readiness.connectYourOwnAccountsNotice).toBe(CONNECT_YOUR_OWN_ACCOUNTS_NOTICE);
    expect(readiness.connectYourOwnAccountsNotice).toContain('carries no credentials');
  });
});

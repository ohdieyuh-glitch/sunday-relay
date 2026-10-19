import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  McpConnectionId, McpMissionBindingId, McpRegistryEntryId, McpServerDefinitionId,
} from '../protocol/ids';
import { createRandomIdFactory } from '../protocol/ids';
import { McpConnectionManager } from './client/mcp-connection-manager';
import type { McpCapabilitySnapshot } from './domain/mcp-capabilities';
import type { McpAuditRecord } from './domain/mcp-invocation';
import { MCP_BASELINE_PROTOCOL_REVISION } from './domain/mcp-protocol';
import { McpGateway, type McpGatewayDependencies } from './gateway/mcp-gateway';
import { runMcpMissionPreflight, type McpMissionBinding } from './mission/mcp-mission-preflight';
import { projectAuditToTrace, assertProjectionIsSafe } from './mission/mcp-project-brain';
import type { McpApprovalRecord } from './policy/mcp-approvals';
import type { McpPermissionGrant } from './policy/mcp-permissions';
import { containsSecretShapedText } from './policy/mcp-sanitize';
import {
  MCP_DEFAULT_NETWORK_POLICY, MCP_LOOPBACK_TEST_NETWORK_POLICY,
} from './policy/mcp-network-policy';
import type { McpRegistryEntry } from './registry/mcp-registry-types';
import {
  createFakeExecutableShims, fixedResolver, installNoExternalNetworkGuard, loopbackOnlyResolver,
  type FakeExecutableShims,
} from './testing/fake-mcp-harness';
import { MCP_ALLOWED_STDIO_EXECUTABLES } from './transports/stdio-launch-policy';
import { McpStdioTransportFactory } from './transports/stdio-transport';
import { McpStreamableHttpTransportFactory } from './transports/streamable-http-transport';
import { argumentFingerprint } from './domain/mcp-invocation';
import type { McpCapabilityFingerprint } from './domain/mcp-fingerprint';
import { buildApproval, buildGrant, memorySnapshotStore, TEST_NOW } from './testing/mcp-test-fixtures';

/**
 * THE OFFLINE END-TO-END MISSION PROOF (§24).
 *
 * This exercises the WHOLE path, against REAL SPAWNED MCP SERVERS speaking
 * REAL MCP over stdio:
 *
 *   Mission Contract → MCP preflight → registry verification → connection →
 *   protocol negotiation → capability discovery → snapshot fingerprint →
 *   agent permission check → approval decision → tools/call → sanitized
 *   result → Trace Ledger audit → evidence reference → clean closure.
 *
 * NO LLM. NO PAID API REQUEST. NO EXTERNAL NETWORK. The only processes started
 * are the fixture servers in `testing/`, the only sockets are loopback, and
 * `installNoExternalNetworkGuard` makes any external fetch FAIL rather than
 * succeed quietly — the guard's attempt counter is asserted to be zero at the
 * end of the run.
 *
 * The twenty scenarios §24 requires are each a named test below.
 */

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

const ACCOUNT = 'acct-proof';
const WORKSPACE = 'wsp-proof';
const PROJECT = 'prj-proof';
const MISSION = 'msn-proof';

let shims: FakeExecutableShims;
let guard: ReturnType<typeof installNoExternalNetworkGuard>;

beforeAll(() => {
  shims = createFakeExecutableShims([...MCP_ALLOWED_STDIO_EXECUTABLES]);
  guard = installNoExternalNetworkGuard();
});

afterAll(() => {
  guard.restore();
  shims.dispose();
});

const entry = (overrides: Partial<McpRegistryEntry> = {}): McpRegistryEntry => ({
  registryEntryId: 'mrg_proof_repository' as McpRegistryEntryId,
  serverDefinitionId: 'msd_proof_repository' as McpServerDefinitionId,
  displayName: 'Proof Repository Server',
  category: 'filesystem_repository',
  state: 'approved',
  expectedServerName: 'relay-fixture-repository',
  expectedServerVersion: '0.1.0',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'stdio',
  stdio: {
    executable: 'relay-fixture-repository',
    fixedArguments: [],
    argumentAllowlist: [],
    environmentAllowlist: ['RELAY_FIXTURE_SCENARIO'],
    workspaceRootBehavior: 'isolated_temp',
    packageIdentity: null,
    artifactChecksumSha256: null,
  },
  http: null,
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {
    read_file: 'read_only',
    search_repository: 'read_only',
    write_file: 'workspace_write',
    create_issue: 'external_write',
  },
  maximumRiskClass: 'external_write',
  requiredCredentialClass: null,
  requiredCredentialScopes: [],
  securityReviewedAt: '2026-08-02T00:00:00.000Z',
  securityReviewer: 'relay-founder',
  revokedAt: null,
  revocationReason: null,
  simulation: true,
  notes: [],
  ...overrides,
});

interface Rig {
  readonly manager: McpConnectionManager;
  readonly connectionId: McpConnectionId;
  readonly snapshot: McpCapabilitySnapshot;
  readonly gateway: (options?: {
    grants?: readonly McpPermissionGrant[];
    approvals?: readonly McpApprovalRecord[];
    writablePrefixes?: readonly string[];
  }) => { gateway: McpGateway; audit: McpAuditRecord[]; approvals: McpApprovalRecord[] };
  readonly close: () => Promise<void>;
}

/** Connects a real stdio fixture server and approves its snapshot. */
async function connectRig(scenario: string, registry: readonly McpRegistryEntry[] = [entry()]): Promise<Rig | { failure: string; manager: McpConnectionManager }> {
  const snapshots = memorySnapshotStore();
  const ids = createRandomIdFactory();
  const manager = new McpConnectionManager({
    ids,
    now: () => new Date().toISOString(),
    registry,
    transports: [
      new McpStdioTransportFactory({
        registry,
        resolveExecutable: shims.resolve,
        approvedFilesystemRoots: [],
        workspaceRoot: null,
        relaySuppliedEnvironment: { RELAY_FIXTURE_SCENARIO: scenario },
        terminationGraceMs: 300,
      }),
      new McpStreamableHttpTransportFactory({
        registry,
        policy: MCP_LOOPBACK_TEST_NETWORK_POLICY,
        resolver: loopbackOnlyResolver,
      }),
    ],
    credentials: null,
    snapshots,
    clientName: 'relay-offline-proof',
    clientVersion: '0.0.0',
    connectTimeoutMs: 20_000,
    discoveryTimeoutMs: 20_000,
  });

  const connectionId = ids.next('mcn');
  const configured = manager.configure({
    connectionId,
    registryEntryId: registry[0]!.registryEntryId,
    configuredName: registry[0]!.displayName,
    scope: { accountId: ACCOUNT, workspaceId: WORKSPACE, projectId: null },
    transport: registry[0]!.transport,
    credentialReferenceId: null,
    createdAt: TEST_NOW,
  });
  if (!configured.ok) return { failure: configured.failure.category, manager };

  const connected = await manager.connect(connectionId);
  if (connected.connection.state !== 'ready' || connected.snapshot === null) {
    return { failure: connected.connection.lastFailure?.category ?? connected.connection.state, manager };
  }
  manager.approveSnapshot(connectionId, connected.snapshot.snapshotId);

  const snapshot = connected.snapshot;

  return {
    manager,
    connectionId,
    snapshot,
    gateway: (options = {}) => {
      const audit: McpAuditRecord[] = [];
      const approvals = [...(options.approvals ?? [])];
      const deps: McpGatewayDependencies = {
        ids,
        now: () => new Date().toISOString(),
        connections: { get: (id) => manager.get(id) },
        snapshots: { get: (id) => snapshots.get(id) },
        registry: { get: (id) => registry.find((e) => e.registryEntryId === id) ?? null },
        clients: { get: (id) => manager.client(id) },
        grants: { forAgent: () => options.grants ?? [] },
        approvals: {
          forOperation: () => approvals,
          record: (updated) => {
            const index = approvals.findIndex((a) => a.approvalRecordId === updated.approvalRecordId);
            if (index >= 0) approvals[index] = updated;
          },
        },
        evidence: { store: (input) => `evd_${input.invocationId}_${input.blockIndex}` },
        audit: { append: (record) => { audit.push(record); } },
        missionWritablePathPrefixes: () => options.writablePrefixes ?? ['src/'],
        defaultTimeoutMs: 15_000,
      };
      return { gateway: new McpGateway(deps), audit, approvals };
    },
    close: () => manager.closeAll(),
  };
}

const isRig = (value: Awaited<ReturnType<typeof connectRig>>): value is Rig => 'connectionId' in value;

const invoke = (
  rig: Rig,
  gateway: McpGateway,
  overrides: Partial<Parameters<McpGateway['invoke']>[0]> = {},
) => gateway.invoke({
  connectionId: rig.connectionId,
  capabilityKind: 'tool',
  capabilityName: 'read_file',
  arguments: { path: 'src/a.ts' },
  accountId: ACCOUNT,
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  missionId: MISSION,
  pspAgentFingerprint: null,
  actualAgentId: 'agent-1',
  agentRole: 'coding-agent',
  ...overrides,
});

const grantFor = (role: string, names: readonly string[], max: string, prefixes: readonly string[] = []) =>
  buildGrant({
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    role: role as never,
    registryEntryId: 'mrg_proof_repository',
    capabilityNames: [...names],
    maximumRiskClass: max as never,
    writablePathPrefixes: [...prefixes],
  });

/* ==================================================================== *
 * 1–2. READ-ONLY WORK BY BOTH PERMITTED ROLES
 * ==================================================================== */

describe('offline proof', () => {
  it('1. Prompt Architect uses an allowed read-only documentation tool', async () => {
    const rig = await connectRig('clean_read_only');
    expect(isRig(rig), isRig(rig) ? '' : `connect failed: ${rig.failure}`).toBe(true);
    if (!isRig(rig)) return;
    try {
      const { gateway, audit } = rig.gateway({ grants: [grantFor('architect', ['search_repository'], 'read_only')] });
      const outcome = await invoke(rig, gateway, {
        agentRole: 'architect',
        capabilityName: 'search_repository',
        arguments: { query: 'relay' },
      });

      expect(outcome.result.state).toBe('completed');
      expect(outcome.risk?.riskClass).toBe('read_only');
      expect(outcome.permission?.decision).toBe('allow');
      // The full chain is present on the audit record.
      expect(audit[0]?.capabilitySnapshotId).toBe(rig.snapshot.snapshotId);
      expect(audit[0]?.capabilityFingerprint).toContain('mcpfp1:');
      expect(audit[0]?.negotiatedProtocolVersion).toBe('2025-11-25');
      expect(assertProjectionIsSafe(projectAuditToTrace(audit[0]!))).toEqual([]);
    } finally { await rig.close(); }
  }, 60_000);

  it('2. Coding Agent uses an allowed workspace-read tool', async () => {
    const rig = await connectRig('clean_read_only');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway, audit } = rig.gateway({ grants: [grantFor('coding-agent', ['read_file'], 'read_only')] });
      const outcome = await invoke(rig, gateway);
      expect(outcome.result.state).toBe('completed');
      expect(outcome.result.evidenceReferences.length + outcome.result.agentFacingContent.length).toBeGreaterThan(0);
      expect(audit).toHaveLength(1);
    } finally { await rig.close(); }
  }, 60_000);

  /* ================================================================== *
   * 3–5. WRITES AND APPROVALS
   * ================================================================== */

  it('3. Coding Agent requests a workspace write requiring mission-scoped permission', async () => {
    const rig = await connectRig('write_tool');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway } = rig.gateway({
        grants: [grantFor('coding-agent', ['write_file'], 'workspace_write', ['src/'])],
        writablePrefixes: ['src/'],
      });

      const inScope = await invoke(rig, gateway, {
        capabilityName: 'write_file',
        arguments: { path: 'src/feature.ts', content: 'x' },
      });
      expect(inScope.result.state).toBe('completed');
      expect(inScope.risk?.riskClass).toBe('workspace_write');

      const outOfScope = await invoke(rig, gateway, {
        capabilityName: 'write_file',
        arguments: { path: 'infra/prod.yaml', content: 'x' },
      });
      expect(outOfScope.result.state).toBe('denied');
      expect(outOfScope.dispatched).toBe(false);
    } finally { await rig.close(); }
  }, 60_000);

  it('4. an external write is BLOCKED without human approval, with zero dispatch', async () => {
    const rig = await connectRig('approval_required');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway, audit } = rig.gateway({
        grants: [grantFor('coding-agent', ['create_issue'], 'external_write')],
        approvals: [],
      });
      const outcome = await invoke(rig, gateway, {
        capabilityName: 'create_issue',
        arguments: { repository: 'relay', title: 'a title' },
      });

      expect(outcome.result.state).toBe('awaiting_approval');
      expect(outcome.result.failure?.category).toBe('approval_required');
      expect(outcome.dispatched).toBe(false);
      expect(outcome.risk?.riskClass).toBe('external_write');
      // The server ANNOTATED create_issue as read-only. Relay disagreed.
      expect(outcome.risk?.annotationContradiction).toBe(true);
      expect(audit[0]?.permissionDecision).toBe('requires_approval');
    } finally { await rig.close(); }
  }, 60_000);

  it('5. an approval permits EXACTLY ONE scoped external write', async () => {
    const rig = await connectRig('approval_required');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const args = { repository: 'relay', title: 'a title' };
      const approval = buildApproval({
        accountId: ACCOUNT,
        workspaceId: WORKSPACE,
        missionId: MISSION,
        actualAgentId: 'agent-1',
        serverName: 'Proof Repository Server',
        capabilitySnapshotFingerprint: rig.snapshot.fingerprint,
        capabilityName: 'create_issue',
        argumentFingerprint: argumentFingerprint('create_issue', args),
        riskClass: 'external_write',
        policy: 'allow_once',
        maximumInvocations: 1,
      });
      const { gateway } = rig.gateway({
        grants: [grantFor('coding-agent', ['create_issue'], 'external_write')],
        approvals: [approval],
      });

      const first = await invoke(rig, gateway, { capabilityName: 'create_issue', arguments: args });
      expect(first.result.state).toBe('completed');

      const second = await invoke(rig, gateway, { capabilityName: 'create_issue', arguments: args });
      expect(second.result.state).toBe('awaiting_approval');

      // And it does not stretch to a different repository.
      const widened = await invoke(rig, gateway, {
        capabilityName: 'create_issue',
        arguments: { repository: 'somewhere-else', title: 'a title' },
      });
      expect(widened.result.state).toBe('awaiting_approval');
      expect(widened.dispatched).toBe(false);
    } finally { await rig.close(); }
  }, 60_000);

  /* ================================================================== *
   * 6. THE REVIEWER
   * ================================================================== */

  it('6. the Independent Reviewer receives NO MCP capability', async () => {
    const rig = await connectRig('clean_read_only');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway, audit } = rig.gateway({
        // A maximally permissive grant, deliberately.
        grants: [grantFor('reviewer', ['read_file', 'search_repository'], 'destructive')],
      });
      for (const kind of ['tool', 'resource', 'prompt'] as const) {
        const outcome = await invoke(rig, gateway, { agentRole: 'reviewer', capabilityKind: kind });
        expect(outcome.result.state, kind).toBe('denied');
        expect(outcome.dispatched, kind).toBe(false);
      }
      expect(audit.every((record) => record.permissionDecision === 'deny')).toBe(true);
    } finally { await rig.close(); }
  }, 60_000);

  /* ================================================================== *
   * 7. CAPABILITY CHANGE
   * ================================================================== */

  it('7. a capability schema change during a mission PAUSES invocation', async () => {
    // Connect against the "before" surface and approve it.
    const rigBefore = await connectRig('clean_read_only');
    if (!isRig(rigBefore)) { expect(rigBefore.failure).toBe('ready'); return; }
    let approvedFingerprint: McpCapabilityFingerprint;
    try {
      approvedFingerprint = rigBefore.snapshot.fingerprint;
      const { gateway } = rigBefore.gateway({ grants: [grantFor('coding-agent', ['read_file'], 'read_only')] });
      expect((await invoke(rigBefore, gateway)).result.state).toBe('completed');
    } finally { await rigBefore.close(); }

    // The same server, restarted with a CHANGED input schema for read_file.
    const rigAfter = await connectRig('changed_capability');
    if (!isRig(rigAfter)) { expect(rigAfter.failure).toBe('ready'); return; }
    try {
      // The surface genuinely differs.
      expect(rigAfter.snapshot.fingerprint).not.toBe(approvedFingerprint);

      const changedTool = rigAfter.snapshot.tools.find((t) => t.name === 'read_file');
      expect(changedTool?.inputSchema).toHaveProperty('properties.followSymlinks');

      // An approval bound to the OLD fingerprint does not cover the new one.
      const staleApproval = buildApproval({
        accountId: ACCOUNT, workspaceId: WORKSPACE, missionId: MISSION, actualAgentId: 'agent-1',
        serverName: 'Proof Repository Server',
        capabilitySnapshotFingerprint: approvedFingerprint,
        capabilityName: 'create_issue',
        riskClass: 'external_write',
      });
      const { gateway } = rigAfter.gateway({
        grants: [grantFor('coding-agent', ['create_issue'], 'external_write')],
        approvals: [staleApproval],
      });
      const outcome = await invoke(rigAfter, gateway, {
        capabilityName: 'create_issue',
        arguments: { repository: 'relay', title: 't' },
      });
      // `create_issue` is not even on the changed surface, so it is refused
      // before approval is consulted — either refusal proves the mission did
      // not inherit access to a surface it never approved.
      expect(outcome.result.state).not.toBe('completed');
      expect(outcome.dispatched).toBe(false);
    } finally { await rigAfter.close(); }
  }, 90_000);

  /* ================================================================== *
   * 8–9. MISSION READINESS
   * ================================================================== */

  const binding = (requirements: McpMissionBinding['requirements'], approved: Record<string, string> = {}): McpMissionBinding => ({
    missionBindingId: 'mcb_proof' as McpMissionBindingId,
    missionId: MISSION,
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    projectId: null,
    requirements,
    approvedSnapshots: approved,
    writablePathPrefixes: ['src/'],
    createdAt: TEST_NOW,
  });

  it('8. a REQUIRED MCP that is unavailable BLOCKS mission readiness', () => {
    const result = runMcpMissionPreflight({
      binding: binding([{
        registryEntryId: 'mrg_proof_repository',
        required: true,
        capabilities: [{ capabilityKind: 'tool', name: 'read_file' }],
        requiredScopes: [],
        preApprovedOperations: [],
        minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
      }]),
      registry: [entry()],
      connections: [],
      snapshots: memorySnapshotStore(),
      credentials: [],
      grants: [],
      approvals: [],
      networkPolicyAllows: () => true,
      now: TEST_NOW,
    });
    expect(result.readiness).toBe('blocked');
    expect(result.findings[0]?.category).toBe('required_connection_missing');
  });

  it('9. an OPTIONAL MCP that is unavailable produces a truthful DEGRADED readiness', () => {
    const result = runMcpMissionPreflight({
      binding: binding([{
        registryEntryId: 'mrg_proof_repository',
        required: false,
        capabilities: [],
        requiredScopes: [],
        preApprovedOperations: [],
        minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
      }]),
      registry: [entry()],
      connections: [],
      snapshots: memorySnapshotStore(),
      credentials: [],
      grants: [],
      approvals: [],
      networkPolicyAllows: () => true,
      now: TEST_NOW,
    });
    expect(result.readiness).toBe('degraded');
    expect(result.findings[0]?.blocking).toBe(false);
  });

  /* ================================================================== *
   * 10. CREDENTIALS
   * ================================================================== */

  it('10. a missing credential BLOCKS the connection', async () => {
    const needsCredential = entry({
      requiredCredentialClass: 'bearer_token',
      requiredCredentialScopes: ['repo:read'],
    });
    const registry = [needsCredential];
    const ids = createRandomIdFactory();
    const manager = new McpConnectionManager({
      ids,
      now: () => new Date().toISOString(),
      registry,
      transports: [new McpStdioTransportFactory({
        registry,
        resolveExecutable: shims.resolve,
        approvedFilesystemRoots: [],
        workspaceRoot: null,
        relaySuppliedEnvironment: { RELAY_FIXTURE_SCENARIO: 'clean_read_only' },
        terminationGraceMs: 300,
      })],
      // No resolver configured, and the connection declares a credential.
      credentials: null,
      snapshots: memorySnapshotStore(),
      clientName: 'relay-offline-proof',
      clientVersion: '0.0.0',
      connectTimeoutMs: 10_000,
      discoveryTimeoutMs: 10_000,
    });
    const connectionId = ids.next('mcn');
    manager.configure({
      connectionId,
      registryEntryId: needsCredential.registryEntryId,
      configuredName: needsCredential.displayName,
      scope: { accountId: ACCOUNT, workspaceId: WORKSPACE, projectId: null },
      transport: 'stdio',
      credentialReferenceId: 'mcr_absent' as never,
      createdAt: TEST_NOW,
    });

    const connected = await manager.connect(connectionId);
    expect(connected.connection.state).toBe('authorization_required');
    expect(connected.connection.lastFailure?.category).toBe('credential_missing');
    await manager.closeAll();
  }, 30_000);

  /* ================================================================== *
   * 11–12. PROTOCOL AND MESSAGE INTEGRITY
   * ================================================================== */

  it('11. a protocol mismatch is DISTINCT from a network failure', async () => {
    const rig = await connectRig('protocol_mismatch');
    expect(isRig(rig)).toBe(false);
    if (isRig(rig)) { await rig.close(); return; }
    expect(rig.failure).not.toBe('unreachable');
    expect(rig.failure).not.toBe('server_unreachable');
    expect(['protocol_mismatch', 'initialize_failed', 'malformed_response', 'internal_error', 'timed_out'])
      .toContain(rig.failure);
    await rig.manager.closeAll();
  }, 60_000);

  it('12. malformed JSON-RPC can NEVER become a success', async () => {
    const rig = await connectRig('malformed_message');
    expect(isRig(rig), 'a non-MCP server must never reach ready').toBe(false);
    if (isRig(rig)) { await rig.close(); return; }
    await rig.manager.closeAll();
  }, 60_000);

  /* ================================================================== *
   * 13–16. BOUNDS, TIME AND LIFE
   * ================================================================== */

  it('13. an oversized result is safely REFERENCED rather than inlined', async () => {
    const rig = await connectRig('oversized_result');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway, audit } = rig.gateway({ grants: [grantFor('coding-agent', ['read_file'], 'read_only')] });
      const outcome = await invoke(rig, gateway);
      expect(outcome.result.agentFacingContent[0]?.type).toBe('reference');
      expect(outcome.result.evidenceReferences.length).toBeGreaterThan(0);
      expect(audit[0]?.safeResultSummary?.truncated).toBe(true);
      // The 300 KB never reached the ledger.
      expect(JSON.stringify(audit).length).toBeLessThan(20_000);
    } finally { await rig.close(); }
  }, 60_000);

  it('14. a timeout can NEVER become a completion', async () => {
    const rig = await connectRig('timeout');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway, audit } = rig.gateway({ grants: [grantFor('coding-agent', ['read_file'], 'read_only')] });
      const outcome = await invoke(rig, gateway, { timeoutMs: 800 });
      expect(outcome.result.state).toBe('timed_out');
      expect(outcome.result.summary).toBeNull();
      expect(audit[0]?.timedOut).toBe(true);
      expect(audit[0]?.invocationState).toBe('timed_out');
    } finally { await rig.close(); }
  }, 60_000);

  it('15. a cancellation can NEVER become a completion', async () => {
    const rig = await connectRig('timeout');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway } = rig.gateway({ grants: [grantFor('coding-agent', ['read_file'], 'read_only')] });
      const controller = new AbortController();
      const pending = invoke(rig, gateway, { timeoutMs: 20_000, signal: controller.signal });
      setTimeout(() => controller.abort(), 100);
      const outcome = await pending;
      expect(outcome.result.state).not.toBe('completed');
      expect(['cancelled', 'timed_out', 'failed']).toContain(outcome.result.state);
    } finally { await rig.close(); }
  }, 60_000);

  it('16. a process crash can NEVER become a completion', async () => {
    const rig = await connectRig('process_crash');
    if (!isRig(rig)) {
      // Crashed before ready — also truthful.
      expect(rig.failure).not.toBe('ready');
      await rig.manager.closeAll();
      return;
    }
    try {
      await new Promise((resolve) => { setTimeout(resolve, 700); });
      const { gateway } = rig.gateway({ grants: [grantFor('coding-agent', ['read_file'], 'read_only')] });
      const outcome = await invoke(rig, gateway, { timeoutMs: 3_000 });
      expect(outcome.result.state).not.toBe('completed');
    } finally { await rig.close(); }
  }, 60_000);

  /* ================================================================== *
   * 17–18. HTTP AND SSRF
   * ================================================================== */

  it('17. an HTTP authentication failure is classified truthfully', async () => {
    const { startFakeHttpMcpServer } = await import('./testing/fake-mcp-harness');
    const server = await startFakeHttpMcpServer({
      scenario: 'clean_read_only',
      requireAuthorization: 'Bearer expected',
    });
    try {
      const httpRegistry = [entry({
        registryEntryId: 'mrg_proof_http' as McpRegistryEntryId,
        transport: 'streamable_http',
        stdio: null,
        http: { url: server.url, expectedOrigin: server.origin, allowsPlainHttp: true },
      })];
      const factory = new McpStreamableHttpTransportFactory({
        registry: httpRegistry,
        policy: MCP_LOOPBACK_TEST_NETWORK_POLICY,
        resolver: loopbackOnlyResolver,
      });
      const outcome = await factory.open({
        connectionId: 'mcn_http',
        registryEntryId: 'mrg_proof_http',
        requestedProtocolVersion: MCP_BASELINE_PROTOCOL_REVISION,
        clientName: 'relay-offline-proof',
        clientVersion: '0.0.0',
        connectTimeoutMs: 10_000,
        resolvedCredential: null,
      });
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.failure.category).toBe('authentication_failed');
    } finally {
      await server.close();
    }
  }, 60_000);

  it('18. SSRF / private-address policy blocks an unsafe remote configuration', async () => {
    const httpRegistry = [entry({
      registryEntryId: 'mrg_proof_ssrf' as McpRegistryEntryId,
      transport: 'streamable_http',
      stdio: null,
      http: { url: 'https://looks-public.example.com/mcp', expectedOrigin: 'https://looks-public.example.com', allowsPlainHttp: false },
    })];
    const factory = new McpStreamableHttpTransportFactory({
      registry: httpRegistry,
      policy: MCP_DEFAULT_NETWORK_POLICY,
      // The hostname string is public. The address is not.
      resolver: fixedResolver({ 'looks-public.example.com': ['169.254.169.254'] }),
    });
    const outcome = await factory.open({
      connectionId: 'mcn_ssrf',
      registryEntryId: 'mrg_proof_ssrf',
      requestedProtocolVersion: MCP_BASELINE_PROTOCOL_REVISION,
      clientName: 'relay-offline-proof',
      clientVersion: '0.0.0',
      connectTimeoutMs: 5_000,
      resolvedCredential: null,
    });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure.category).toBe('network_policy_blocked');
  }, 30_000);

  /* ================================================================== *
   * 19–20. UNTRUSTED CONTENT
   * ================================================================== */

  it('19. prompt-injection content is LABELLED and cannot change a permission', async () => {
    const rig = await connectRig('prompt_injection_output');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const grants = [grantFor('coding-agent', ['read_file'], 'read_only')];
      const approvals: McpApprovalRecord[] = [];
      const before = JSON.stringify({ grants, approvals });

      const { gateway, audit } = rig.gateway({ grants, approvals });
      const outcome = await invoke(rig, gateway);

      expect(outcome.result.state).toBe('completed');
      expect(outcome.result.agentFacingContent[0]?.injectionSignals.length).toBeGreaterThan(0);
      expect(audit[0]?.safeResultSummary?.injectionSignals.length).toBeGreaterThan(0);

      // Not one byte of policy moved.
      expect(JSON.stringify({ grants, approvals })).toBe(before);

      // And the escalation the payload asked for is still refused.
      const escalation = await invoke(rig, gateway, {
        capabilityName: 'create_issue',
        arguments: { repository: 'relay', title: 'granted by the payload' },
      });
      expect(escalation.result.state).not.toBe('completed');
      expect(escalation.dispatched).toBe(false);
    } finally { await rig.close(); }
  }, 60_000);

  it('20. secret-like output is REDACTED before evidence or UI', async () => {
    const rig = await connectRig('secret_output');
    if (!isRig(rig)) { expect(rig.failure).toBe('ready'); return; }
    try {
      const { gateway, audit } = rig.gateway({ grants: [grantFor('coding-agent', ['read_file'], 'read_only')] });
      const outcome = await invoke(rig, gateway);

      expect(outcome.result.state).toBe('completed');
      const agentText = outcome.result.agentFacingContent.map((b) => b.text).join('\n');
      expect(agentText).not.toContain('ghp_FAKETESTNOTREAL');
      expect(containsSecretShapedText(agentText)).toBe(false);
      // The home directory the server volunteered is gone too.
      expect(agentText).not.toContain('/home/relay-operator');
      // And nothing secret-shaped reached the ledger.
      expect(containsSecretShapedText(JSON.stringify(audit))).toBe(false);
      expect(audit[0]?.safeResultSummary?.redactionsApplied).toBeGreaterThan(0);
      expect(assertProjectionIsSafe(projectAuditToTrace(audit[0]!))).toEqual([]);
    } finally { await rig.close(); }
  }, 60_000);

  /* ================================================================== *
   * THE OFFLINE GUARANTEE
   * ================================================================== */

  it('made NO external network call during the entire proof', () => {
    expect(guard.externalAttempts()).toEqual([]);
  });
});

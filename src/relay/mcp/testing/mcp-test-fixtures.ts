/**
 * DETERMINISTIC MCP TEST FIXTURES (TEST SURFACE — never imported by product
 * code, never reachable from a browser entry).
 *
 * Everything here is pure and clock-free: ids come from a counting factory and
 * timestamps are supplied, so a test that asserts "the approval expired" does
 * so by passing a time rather than by waiting for one.
 *
 * The builders default to the SAFE shape — a verified server, a ready
 * connection, an approved snapshot, an in-scope grant — so a test that wants
 * to prove a REFUSAL has to explicitly break one thing. That direction matters:
 * a fixture that defaults to broken makes every passing test ambiguous about
 * which property it actually exercised.
 */

import type {
  McpApprovalRecordId, McpCapabilitySnapshotId, McpConnectionId,
  McpCredentialReferenceId, McpPermissionGrantId, McpRegistryEntryId,
} from '../../protocol/ids';
import {
  normalizeTool, snapshotFingerprint,
  type McpCapabilitySnapshot, type McpToolDefinition,
} from '../domain/mcp-capabilities';
import type { McpConnection, McpConnectionDefinition } from '../domain/mcp-connection';
import type { McpCredentialReference } from '../domain/mcp-credential';
import type { McpServerIdentity } from '../domain/mcp-identity';
import { MCP_BASELINE_PROTOCOL_REVISION, type McpTransportKind } from '../domain/mcp-protocol';
import { argumentFingerprint } from '../domain/mcp-invocation';
import type { McpApprovalRecord } from '../policy/mcp-approvals';
import type { McpPermissionGrant } from '../policy/mcp-permissions';
import type { McpRiskClass } from '../policy/mcp-risk';

export const TEST_NOW = '2026-08-02T12:00:00.000Z';
export const TEST_ACCOUNT = 'acct-relay-test';
export const TEST_WORKSPACE = 'wsp-relay-test';
export const TEST_PROJECT = 'prj-relay-test';
export const TEST_MISSION = 'msn-relay-test';
export const TEST_REGISTRY_ENTRY = 'mrg_fixture_filesystem_repository' as McpRegistryEntryId;
export const TEST_CONNECTION = 'mcn_test0001' as McpConnectionId;
export const TEST_SNAPSHOT = 'mcs_test0001' as McpCapabilitySnapshotId;

/** A counting id factory, so every generated id is stable across runs. */
export function countingIds(): { next<P extends string>(prefix: P): string } {
  let n = 0;
  return {
    next<P extends string>(prefix: P): string {
      n += 1;
      return `${prefix}_t${String(n).padStart(4, '0')}`;
    },
  };
}

export const READ_FILE_TOOL_RAW = {
  name: 'read_file',
  description: 'Read a file from the repository.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  annotations: { readOnlyHint: true, destructiveHint: false },
};

export const WRITE_FILE_TOOL_RAW = {
  name: 'write_file',
  description: 'Write a file in the workspace.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
  annotations: { readOnlyHint: false },
};

export const CREATE_ISSUE_TOOL_RAW = {
  name: 'create_issue',
  description: 'Create an issue on the remote tracker.',
  inputSchema: {
    type: 'object',
    properties: { repository: { type: 'string' }, title: { type: 'string' } },
    required: ['repository', 'title'],
  },
  // Claims read-only. Relay must disagree and record the contradiction.
  annotations: { readOnlyHint: true },
};

export const MERGE_PR_TOOL_RAW = {
  name: 'merge_pull_request',
  description: 'Merge a pull request.',
  inputSchema: {
    type: 'object',
    properties: { repository: { type: 'string' }, number: { type: 'number' } },
    required: ['repository', 'number'],
  },
  annotations: {},
};

export function buildTools(...raw: readonly unknown[]): McpToolDefinition[] {
  return raw.map((entry) => normalizeTool(entry)).filter((tool): tool is McpToolDefinition => tool !== null);
}

export function buildSnapshot(input: {
  readonly snapshotId?: McpCapabilitySnapshotId;
  readonly connectionId?: McpConnectionId;
  readonly tools?: readonly unknown[];
  readonly serverName?: string;
  readonly protocolVersion?: string;
} = {}): McpCapabilitySnapshot {
  const tools = buildTools(...(input.tools ?? [READ_FILE_TOOL_RAW]));
  const flags = { tools: true, resources: true, prompts: true, logging: false, completions: false };
  const serverName = input.serverName ?? 'relay-fixture-repository';
  const protocolVersion = input.protocolVersion ?? MCP_BASELINE_PROTOCOL_REVISION;
  return {
    snapshotId: input.snapshotId ?? TEST_SNAPSHOT,
    connectionId: input.connectionId ?? TEST_CONNECTION,
    negotiatedProtocolVersion: protocolVersion,
    serverName,
    serverVersion: '0.1.0',
    flags,
    tools,
    resources: [],
    prompts: [],
    fingerprint: snapshotFingerprint({
      negotiatedProtocolVersion: protocolVersion,
      serverName,
      serverVersion: '0.1.0',
      flags,
      tools,
      resources: [],
      prompts: [],
    }),
    capturedAt: TEST_NOW,
  };
}

export function buildIdentity(overrides: Partial<McpServerIdentity> = {}): McpServerIdentity {
  const declared = { name: 'relay-fixture-repository', version: '0.1.0', title: null };
  return {
    configuredName: 'Repository Reader (fixture)',
    requested: {
      registryEntryId: TEST_REGISTRY_ENTRY,
      expectedName: 'relay-fixture-repository',
      expectedVersion: '0.1.0',
      expectedOrigin: null,
    },
    declared,
    verified: declared,
    verificationMethod: 'registry_match',
    trust: 'registry_verified',
    observedOrigin: null,
    ...overrides,
  };
}

export function buildConnectionDefinition(
  overrides: Partial<McpConnectionDefinition> = {},
): McpConnectionDefinition {
  return {
    connectionId: TEST_CONNECTION,
    registryEntryId: TEST_REGISTRY_ENTRY,
    configuredName: 'Repository Reader (fixture)',
    scope: { accountId: TEST_ACCOUNT, workspaceId: TEST_WORKSPACE, projectId: null },
    transport: 'stdio' as McpTransportKind,
    credentialReferenceId: null,
    createdAt: TEST_NOW,
    ...overrides,
  };
}

export function buildConnection(overrides: Partial<McpConnection> = {}): McpConnection {
  return {
    definition: buildConnectionDefinition(),
    state: 'ready',
    identity: buildIdentity(),
    protocol: {
      requestedProtocolVersion: MCP_BASELINE_PROTOCOL_REVISION,
      negotiatedProtocolVersion: MCP_BASELINE_PROTOCOL_REVISION,
      acceptable: true,
      configuredTransport: 'stdio',
      actualTransport: 'stdio',
    },
    capabilitySnapshotId: TEST_SNAPSHOT,
    approvedSnapshotId: TEST_SNAPSHOT,
    lastFailure: null,
    lastVerifiedAt: TEST_NOW,
    stateChangedAt: TEST_NOW,
    notes: [],
    ...overrides,
  };
}

export function buildGrant(overrides: Partial<McpPermissionGrant> = {}): McpPermissionGrant {
  return {
    grantId: 'mcg_test0001' as McpPermissionGrantId,
    accountId: TEST_ACCOUNT,
    workspaceId: TEST_WORKSPACE,
    projectId: null,
    missionId: null,
    pspAgentFingerprint: null,
    role: 'coding-agent',
    registryEntryId: TEST_REGISTRY_ENTRY,
    capabilityKind: 'tool',
    capabilityNames: ['read_file'],
    maximumRiskClass: 'read_only' as McpRiskClass,
    writablePathPrefixes: [],
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

export function buildApproval(overrides: Partial<McpApprovalRecord> = {}): McpApprovalRecord {
  const snapshot = buildSnapshot();
  return {
    approvalRecordId: 'mca_test0001' as McpApprovalRecordId,
    approvalRequestId: 'mcq_test0001' as McpApprovalRecord['approvalRequestId'],
    policy: 'allow_once',
    state: 'granted',
    decidedByHumanId: 'human-founder',
    decidedAt: TEST_NOW,
    accountId: TEST_ACCOUNT,
    workspaceId: TEST_WORKSPACE,
    projectId: null,
    missionId: TEST_MISSION,
    actualAgentId: 'agent-coding-1',
    agentRole: 'coding-agent',
    serverName: 'Repository Reader (fixture)',
    capabilitySnapshotFingerprint: snapshot.fingerprint,
    capabilityKind: 'tool',
    capabilityName: 'create_issue',
    argumentFingerprint: argumentFingerprint('create_issue', { repository: 'a', title: 't' }),
    riskClass: 'external_write',
    expiresAt: null,
    maximumInvocations: 1,
    usageCount: 0,
    revokedAt: null,
    ...overrides,
  };
}

export function buildCredential(overrides: Partial<McpCredentialReference> = {}): McpCredentialReference {
  return {
    credentialReferenceId: 'mcr_test0001' as McpCredentialReferenceId,
    credentialClass: 'bearer_token',
    accountId: TEST_ACCOUNT,
    workspaceId: TEST_WORKSPACE,
    providerClass: 'git_hosting',
    scopeSummary: ['repo:read'],
    state: 'active',
    expiresAt: null,
    revokedAt: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    environmentVariableNames: [],
    ...overrides,
  };
}

/** An in-memory snapshot store. */
export function memorySnapshotStore(...initial: readonly McpCapabilitySnapshot[]) {
  const map = new Map<string, McpCapabilitySnapshot>(initial.map((s) => [s.snapshotId, s]));
  return {
    put: (snapshot: McpCapabilitySnapshot): void => { map.set(snapshot.snapshotId, snapshot); },
    get: (snapshotId: string): McpCapabilitySnapshot | null => map.get(snapshotId) ?? null,
    latestForConnection: (connectionId: string): McpCapabilitySnapshot | null =>
      [...map.values()].filter((s) => s.connectionId === connectionId).at(-1) ?? null,
    all: (): readonly McpCapabilitySnapshot[] => [...map.values()],
  };
}

import { describe, expect, it } from 'vitest';

import {
  MCP_BASELINE_PROTOCOL_REVISION, MCP_SUPPORTED_PROTOCOL_REVISIONS,
  MCP_UNSUPPORTED_TRANSPORT_KINDS, isSupportedTransportKind, negotiateProtocol,
} from './domain/mcp-protocol';
import { fingerprintValue, normalizeCapabilityValue, MCP_FINGERPRINT_VERSION } from './domain/mcp-fingerprint';
import { forbidsSuccess, mcpFailure, MCP_NEVER_SUCCESS_CATEGORIES } from './domain/mcp-failure';
import { identityConfirmed, verifyDeclaredIdentity } from './domain/mcp-identity';
import { forbiddenCredentialFieldsIn, missingScopes, credentialIsUsable } from './domain/mcp-credential';
import {
  diffSnapshots, findTool, normalizeAnnotations, normalizePrompt, normalizeResource, normalizeTool,
} from './domain/mcp-capabilities';
import {
  canInvoke, connectionUsableBy, isTerminal, MCP_CONNECTION_STATES,
  MCP_CONNECTION_STATE_LABELS, transitionAllowed,
} from './domain/mcp-connection';
import {
  argumentFingerprint, settleInvocation, summarizeArguments,
} from './domain/mcp-invocation';
import { MCP_RELAY_SERVER_STATUS, relayMcpServerIsAvailable } from './domain/mcp-relay-server-contract';
import {
  buildConnection, buildCredential, buildIdentity, buildSnapshot,
  CREATE_ISSUE_TOOL_RAW, READ_FILE_TOOL_RAW, TEST_ACCOUNT, TEST_WORKSPACE,
  WRITE_FILE_TOOL_RAW,
} from './testing/mcp-test-fixtures';

/* ==================================================================== *
 * PROTOCOL
 * ==================================================================== */

describe('MCP protocol identity and negotiation', () => {
  it('the production baseline is 2025-11-25 and is the ONLY accepted revision', () => {
    expect(MCP_BASELINE_PROTOCOL_REVISION).toBe('2025-11-25');
    expect(MCP_SUPPORTED_PROTOCOL_REVISIONS).toEqual(['2025-11-25']);
  });

  it('accepts the baseline and records both requested and negotiated', () => {
    const result = negotiateProtocol('2025-11-25');
    expect(result.acceptable).toBe(true);
    expect(result.requested).toBe('2025-11-25');
    expect(result.negotiated).toBe('2025-11-25');
  });

  it('REFUSES the 2026-07-28 draft and says why, rather than reporting an unknown version', () => {
    const result = negotiateProtocol('2026-07-28');
    expect(result.acceptable).toBe(false);
    expect(result.negotiated).toBe('2026-07-28');
    expect(result.reason).toContain('draft');
    expect(result.reason).toContain('2025-11-25');
  });

  it('refuses superseded revisions the SDK would otherwise accept', () => {
    // The pinned SDK's SUPPORTED_PROTOCOL_VERSIONS includes these; Relay's
    // baseline does not. This is the gap that makes Relay's own check load-bearing.
    for (const revision of ['2025-06-18', '2025-03-26', '2024-11-05']) {
      const result = negotiateProtocol(revision);
      expect(result.acceptable, revision).toBe(false);
      expect(result.negotiated, revision).toBe(revision);
    }
  });

  it('fails closed when the server answered nothing', () => {
    for (const answer of [undefined, null, '', '   ', 42, {}]) {
      const result = negotiateProtocol(answer);
      expect(result.acceptable).toBe(false);
      expect(result.negotiated).toBeNull();
    }
  });

  it('names the deprecated HTTP+SSE transport as unsupported rather than unknown', () => {
    expect(isSupportedTransportKind('http_sse')).toBe(false);
    expect(MCP_UNSUPPORTED_TRANSPORT_KINDS.http_sse).toContain('deprecated');
    expect(isSupportedTransportKind('stdio')).toBe(true);
    expect(isSupportedTransportKind('streamable_http')).toBe(true);
  });
});

/* ==================================================================== *
 * FINGERPRINTS
 * ==================================================================== */

describe('capability fingerprints', () => {
  it('is stable across object key order', () => {
    const a = fingerprintValue('t', { alpha: 1, beta: { x: 1, y: 2 } });
    const b = fingerprintValue('t', { beta: { y: 2, x: 1 }, alpha: 1 });
    expect(a).toBe(b);
  });

  it('is stable across irrelevant whitespace in text', () => {
    const a = fingerprintValue('t', { description: 'Read a   file\nfrom  the repo.' });
    const b = fingerprintValue('t', { description: 'Read a file from the repo.' });
    expect(a).toBe(b);
  });

  it('is stable across ordering of SET-valued lists', () => {
    const a = fingerprintValue('t', { required: ['b', 'a', 'c'] });
    const b = fingerprintValue('t', { required: ['a', 'c', 'b'] });
    expect(a).toBe(b);
  });

  it('is NOT stable across ordering of order-significant lists', () => {
    const a = fingerprintValue('t', { enum: ['a', 'b'] });
    const b = fingerprintValue('t', { enum: ['b', 'a'] });
    expect(a).not.toBe(b);
  });

  it('changes when any value changes', () => {
    const a = fingerprintValue('t', { path: { type: 'string' } });
    const b = fingerprintValue('t', { path: { type: 'number' } });
    expect(a).not.toBe(b);
  });

  it('PRESERVES unknown extension keys, so a server cannot change behaviour invisibly', () => {
    const a = fingerprintValue('t', { name: 'x' });
    const b = fingerprintValue('t', { name: 'x', xRelayUnknownExtension: 'changes-behaviour' });
    expect(a).not.toBe(b);
  });

  it('separates domains, so a tool and a prompt with identical JSON differ', () => {
    expect(fingerprintValue('mcp.tool', { name: 'x' })).not.toBe(fingerprintValue('mcp.prompt', { name: 'x' }));
  });

  it('carries a version prefix so old and new digests can never be compared', () => {
    expect(fingerprintValue('t', {})).toContain(`${MCP_FINGERPRINT_VERSION}:`);
  });

  it('drops undefined object properties but keeps explicit null', () => {
    expect(normalizeCapabilityValue({ a: undefined, b: null })).toEqual({ b: null });
  });
});

/* ==================================================================== *
 * FAILURES
 * ==================================================================== */

describe('failure taxonomy', () => {
  it('keeps the five load-bearing categories distinct', () => {
    const categories = ['protocol_mismatch', 'malformed_response', 'server_unreachable', 'timed_out', 'authentication_failed'];
    expect(new Set(categories).size).toBe(5);
  });

  it('forbids success for every never-success category', () => {
    for (const category of MCP_NEVER_SUCCESS_CATEGORIES) {
      expect(forbidsSuccess(category), category).toBe(true);
    }
  });

  it('never marks a policy refusal retryable', () => {
    expect(mcpFailure('permission_denied', 'no').retryable).toBe(false);
    expect(mcpFailure('protocol_mismatch', 'no').retryable).toBe(false);
    expect(mcpFailure('server_unreachable', 'maybe').retryable).toBe(true);
  });
});

/* ==================================================================== *
 * IDENTITY
 * ==================================================================== */

describe('server identity separation', () => {
  it('a configured label is NOT a verified identity', () => {
    const identity = buildIdentity({ declared: null, verified: null, verificationMethod: 'none', trust: 'registry_declared' });
    expect(identity.configuredName).not.toBe('');
    expect(identityConfirmed(identity)).toBe(false);
  });

  it('a name mismatch makes the server untrusted', () => {
    const result = verifyDeclaredIdentity(
      buildIdentity().requested,
      { name: 'something-else', version: '0.1.0', title: null },
      null,
    );
    expect(result.trust).toBe('untrusted');
    expect(result.verified).toBeNull();
    expect(result.notes.join(' ')).toContain('something-else');
  });

  it('a version mismatch is REPORTED but does not fail verification', () => {
    const result = verifyDeclaredIdentity(
      buildIdentity().requested,
      { name: 'relay-fixture-repository', version: '0.2.0', title: null },
      null,
    );
    expect(result.trust).toBe('registry_verified');
    expect(result.notes.join(' ')).toContain('0.2.0');
  });

  it('an origin mismatch makes the server untrusted', () => {
    const requested = { ...buildIdentity().requested, expectedOrigin: 'https://good.example' };
    const result = verifyDeclaredIdentity(
      requested,
      { name: 'relay-fixture-repository', version: '0.1.0', title: null },
      'https://evil.example',
    );
    expect(result.trust).toBe('untrusted');
  });

  it('a matching origin upgrades the verification method', () => {
    const requested = { ...buildIdentity().requested, expectedOrigin: 'https://good.example' };
    const result = verifyDeclaredIdentity(
      requested,
      { name: 'relay-fixture-repository', version: '0.1.0', title: null },
      'https://good.example',
    );
    expect(result.method).toBe('registry_match_and_origin');
  });

  it('a server that declared nothing is never verified', () => {
    const result = verifyDeclaredIdentity(buildIdentity().requested, null, null);
    expect(result.verified).toBeNull();
    expect(result.method).toBe('none');
  });
});

/* ==================================================================== *
 * CREDENTIAL REFERENCES
 * ==================================================================== */

describe('credential references cannot hold a secret', () => {
  it('detects every token-shaped field name', () => {
    for (const field of ['token', 'accessToken', 'refresh_token', 'apiKey', 'secret', 'password', 'clientSecret', 'privateKey']) {
      expect(forbiddenCredentialFieldsIn({ [field]: 'x' }), field).toContain(field);
    }
  });

  it('detects a forbidden field nested deep inside a record', () => {
    expect(forbiddenCredentialFieldsIn({ a: { b: { c: { accessToken: 'x' } } } })).toContain('accessToken');
  });

  it('a clean reference has no forbidden fields', () => {
    expect(forbiddenCredentialFieldsIn(buildCredential())).toEqual([]);
  });

  it('allows environmentVariableNames to contain secret-shaped NAMES', () => {
    const reference = buildCredential({ environmentVariableNames: ['GITHUB_TOKEN', 'API_KEY'] });
    expect(forbiddenCredentialFieldsIn(reference)).toEqual([]);
  });

  it('reports which scopes are missing, by name', () => {
    const reference = buildCredential({ scopeSummary: ['repo:read'] });
    expect(missingScopes(reference, ['repo:read', 'repo:write'])).toEqual(['repo:write']);
  });

  it('only an active credential is usable', () => {
    expect(credentialIsUsable(buildCredential({ state: 'active' }))).toBe(true);
    for (const state of ['expired', 'revoked', 'missing', 'insufficient_scope'] as const) {
      expect(credentialIsUsable(buildCredential({ state })), state).toBe(false);
    }
  });
});

/* ==================================================================== *
 * CAPABILITIES
 * ==================================================================== */

describe('capability normalization', () => {
  it('drops a tool with no usable name rather than failing the whole surface', () => {
    expect(normalizeTool({ description: 'no name' })).toBeNull();
    expect(normalizeTool({ name: '   ' })).toBeNull();
    expect(normalizeTool(READ_FILE_TOOL_RAW)).not.toBeNull();
  });

  it('records annotations verbatim, including "the server said nothing"', () => {
    expect(normalizeAnnotations({ readOnlyHint: true }).readOnlyHint).toBe(true);
    expect(normalizeAnnotations({}).readOnlyHint).toBeNull();
    expect(normalizeAnnotations(undefined).destructiveHint).toBeNull();
  });

  it('normalizes resources and prompts, dropping malformed entries', () => {
    expect(normalizeResource({ uri: 'file:///a', name: 'a' })).not.toBeNull();
    expect(normalizeResource({ name: 'no uri' })).toBeNull();
    expect(normalizePrompt({ name: 'p', arguments: [{ name: 'x', required: true }, { bad: true }] })?.arguments).toHaveLength(1);
    expect(normalizePrompt({})).toBeNull();
  });

  it('finds a capability by exact name only', () => {
    const snapshot = buildSnapshot({ tools: [READ_FILE_TOOL_RAW] });
    expect(findTool(snapshot, 'read_file')).not.toBeNull();
    expect(findTool(snapshot, 'read_File')).toBeNull();
  });
});

describe('capability change classification', () => {
  const base = buildSnapshot({ tools: [READ_FILE_TOOL_RAW] });

  it('reports no change for an identical surface', () => {
    expect(diffSnapshots(base, buildSnapshot({ tools: [READ_FILE_TOOL_RAW] })).changed).toBe(false);
  });

  it('a NEW tool requires reapproval', () => {
    const diff = diffSnapshots(base, buildSnapshot({ tools: [READ_FILE_TOOL_RAW, WRITE_FILE_TOOL_RAW] }));
    expect(diff.changed).toBe(true);
    expect(diff.changes.some((c) => c.kind === 'tool_added' && c.target === 'write_file')).toBe(true);
    expect(diff.reapprovalRequiredFor).toContain('write_file');
  });

  it('a REMOVED tool requires reapproval', () => {
    const diff = diffSnapshots(buildSnapshot({ tools: [READ_FILE_TOOL_RAW, WRITE_FILE_TOOL_RAW] }), base);
    expect(diff.changes.some((c) => c.kind === 'tool_removed' && c.target === 'write_file')).toBe(true);
  });

  it('an INPUT SCHEMA change requires reapproval and is attributed to the schema', () => {
    const changed = {
      ...READ_FILE_TOOL_RAW,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, followSymlinks: { type: 'boolean' } },
        required: ['path'],
      },
    };
    const diff = diffSnapshots(base, buildSnapshot({ tools: [changed] }));
    expect(diff.changes.some((c) => c.kind === 'tool_input_schema_changed')).toBe(true);
    expect(diff.reapprovalRequiredFor).toContain('read_file');
  });

  it('an OUTPUT SCHEMA change is reported separately', () => {
    const changed = { ...READ_FILE_TOOL_RAW, outputSchema: { type: 'object' } };
    const diff = diffSnapshots(base, buildSnapshot({ tools: [changed] }));
    expect(diff.changes.some((c) => c.kind === 'tool_output_schema_changed')).toBe(true);
  });

  it('an ANNOTATION change is reported and requires reapproval', () => {
    const changed = { ...READ_FILE_TOOL_RAW, annotations: { readOnlyHint: false } };
    const diff = diffSnapshots(base, buildSnapshot({ tools: [changed] }));
    expect(diff.changes.some((c) => c.kind === 'tool_annotations_changed')).toBe(true);
    expect(diff.reapprovalRequiredFor).toContain('read_file');
  });

  it('a DESCRIPTION-ONLY change is recorded but does NOT require reapproval', () => {
    const changed = { ...READ_FILE_TOOL_RAW, description: 'Reads a file. Rewritten description.' };
    const diff = diffSnapshots(base, buildSnapshot({ tools: [changed] }));
    expect(diff.changed).toBe(true);
    expect(diff.changes.some((c) => c.kind === 'tool_description_changed')).toBe(true);
    expect(diff.reapprovalRequiredFor).toEqual([]);
  });

  it('a protocol-version change is reported', () => {
    const diff = diffSnapshots(base, buildSnapshot({ protocolVersion: '2025-06-18' }));
    expect(diff.changes.some((c) => c.kind === 'protocol_version_changed')).toBe(true);
  });

  it('a server-identity change is reported', () => {
    const diff = diffSnapshots(base, buildSnapshot({ serverName: 'someone-else' }));
    expect(diff.changes.some((c) => c.kind === 'server_identity_changed')).toBe(true);
  });
});

/* ==================================================================== *
 * CONNECTION LIFECYCLE
 * ==================================================================== */

describe('connection lifecycle', () => {
  it('has fourteen distinct states and a label for every one', () => {
    expect(new Set(MCP_CONNECTION_STATES).size).toBe(MCP_CONNECTION_STATES.length);
    for (const state of MCP_CONNECTION_STATES) {
      expect(MCP_CONNECTION_STATE_LABELS[state], state).toBeTruthy();
    }
  });

  it('ONLY `ready` may invoke — degraded and capability_changed may not', () => {
    for (const state of MCP_CONNECTION_STATES) {
      expect(canInvoke(state), state).toBe(state === 'ready');
    }
  });

  it('there is no direct capability_changed -> ready edge', () => {
    expect(transitionAllowed('capability_changed', 'ready')).toBe(false);
    expect(transitionAllowed('capability_changed', 'connecting')).toBe(true);
  });

  it('terminal states are terminal', () => {
    expect(isTerminal('closed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('ready')).toBe(false);
  });

  it('refuses a connection belonging to another workspace, and says which dimension failed', () => {
    const connection = buildConnection();
    const other = connectionUsableBy(connection, { accountId: TEST_ACCOUNT, workspaceId: 'wsp-other', projectId: null });
    expect(other.usable).toBe(false);
    expect(other.usable === false && other.reason).toContain('workspace');
  });

  it('refuses a connection belonging to another account', () => {
    const result = connectionUsableBy(buildConnection(), { accountId: 'acct-other', workspaceId: TEST_WORKSPACE, projectId: null });
    expect(result.usable).toBe(false);
    expect(result.usable === false && result.reason).toContain('account');
  });

  it('refuses a project-bound connection used from another project', () => {
    const connection = buildConnection({
      definition: { ...buildConnection().definition, scope: { accountId: TEST_ACCOUNT, workspaceId: TEST_WORKSPACE, projectId: 'prj-a' } },
    });
    const result = connectionUsableBy(connection, { accountId: TEST_ACCOUNT, workspaceId: TEST_WORKSPACE, projectId: 'prj-b' });
    expect(result.usable).toBe(false);
    expect(result.usable === false && result.reason).toContain('project');
  });
});

/* ==================================================================== *
 * INVOCATION SETTLEMENT
 * ==================================================================== */

describe('invocation settlement can never turn a failure into a completion', () => {
  const base = {
    invocationId: 'mci_test0001' as never,
    startedAt: '2026-08-02T12:00:00.000Z',
    completedAt: '2026-08-02T12:00:01.000Z',
    summary: { contentBlocks: 1, totalBytes: 10, mimeTypes: [], truncated: false, redactionsApplied: 0, injectionSignals: [], isError: false },
  };

  it('a TIMEOUT cannot become a completion, even with a summary present', () => {
    const result = settleInvocation({ ...base, intendedState: 'completed', failure: mcpFailure('timed_out', 'too slow') });
    expect(result.state).toBe('timed_out');
    expect(result.summary).toBeNull();
    expect(result.agentFacingContent).toEqual([]);
  });

  it('a CANCELLATION cannot become a completion', () => {
    const result = settleInvocation({ ...base, intendedState: 'completed', failure: mcpFailure('cancelled', 'stopped') });
    expect(result.state).toBe('cancelled');
  });

  it('a PROCESS CRASH cannot become a completion', () => {
    const result = settleInvocation({ ...base, intendedState: 'completed', failure: mcpFailure('process_crashed', 'died') });
    expect(result.state).toBe('failed');
    expect(result.summary).toBeNull();
  });

  it('a MALFORMED RESPONSE cannot become a completion', () => {
    const result = settleInvocation({ ...base, intendedState: 'completed', failure: mcpFailure('malformed_response', 'not mcp') });
    expect(result.state).toBe('failed');
  });

  it('a clean result completes and keeps its summary', () => {
    const result = settleInvocation({ ...base, intendedState: 'completed', failure: null });
    expect(result.state).toBe('completed');
    expect(result.summary).not.toBeNull();
  });
});

describe('argument summaries and fingerprints', () => {
  it('summarizes SHAPE without retaining values', () => {
    const summary = summarizeArguments({ path: 'src/secret-plan.ts', count: 3, flag: true, list: [1, 2] });
    expect(summary).toEqual({ path: 'string(18)', count: 'number', flag: 'boolean', list: 'array(2)' });
    expect(JSON.stringify(summary)).not.toContain('secret-plan');
  });

  it('different arguments produce different fingerprints', () => {
    expect(argumentFingerprint('read', { path: 'a.txt' })).not.toBe(argumentFingerprint('read', { path: 'b.txt' }));
  });

  it('the same arguments in a different key order produce the SAME fingerprint', () => {
    expect(argumentFingerprint('t', { a: 1, b: 2 })).toBe(argumentFingerprint('t', { b: 2, a: 1 }));
  });

  it('the same arguments on a different capability produce different fingerprints', () => {
    expect(argumentFingerprint('read', { x: 1 })).not.toBe(argumentFingerprint('write', { x: 1 }));
  });
});

/* ==================================================================== *
 * FUTURE RELAY-AS-MCP-SERVER CONTRACT
 * ==================================================================== */

describe('Relay as an MCP server is a contract, not an implementation', () => {
  it('is not implemented and cannot be turned on', () => {
    expect(MCP_RELAY_SERVER_STATUS).toBe('not_implemented');
    expect(relayMcpServerIsAvailable()).toBe(false);
  });
});

/* ==================================================================== *
 * A CAPABILITY THE SERVER MISLABELS
 * ==================================================================== */

describe('a server that mislabels its own tool', () => {
  it('is still normalized, and its annotation is preserved as evidence', () => {
    const tool = normalizeTool(CREATE_ISSUE_TOOL_RAW);
    expect(tool).not.toBeNull();
    // Recorded verbatim. `mcp-policy.test.ts` proves Relay does not honour it.
    expect(tool?.annotations.readOnlyHint).toBe(true);
  });
});

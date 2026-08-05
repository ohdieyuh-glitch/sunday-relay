/**
 * THE MCP CONNECTION MANAGER (SDK-free; drives transports through ports).
 *
 * ONE CLIENT RELATIONSHIP PER CONNECTION, and no sharing. A connection is
 * created for exactly one (account, workspace, project?) scope and is stored
 * under its own id. There is no pooling, no keying by URL, and no "reuse the
 * session for the same server" optimization — every one of those is a route by
 * which Workspace B ends up using Workspace A's authenticated session, which
 * §5 forbids. When a shared-connection policy is eventually added it will be an
 * explicit, reviewed field, not the emergent consequence of a cache key.
 *
 * WHAT `connect` ACTUALLY PROVES BEFORE RETURNING `ready`:
 *
 *   1. the registry entry exists and is connectable;
 *   2. the transport opened;
 *   3. `initialize` returned a protocol revision Relay accepts;
 *   4. the server's DECLARED identity matched its registry entry (and, for
 *      HTTP, the response came from the expected origin);
 *   5. capability discovery completed and produced a snapshot.
 *
 * Any of those failing produces a SPECIFIC state — `protocol_mismatch`,
 * `malformed_response`, `unreachable`, `timed_out`, `permission_blocked` — and
 * never `ready`. A process that started is not a server that works, and a
 * server that answered is not a server Relay trusts.
 *
 * CLEANUP IS UNCONDITIONAL. Every failure path closes the transport it opened.
 * A connection that fails verification after its child process started is the
 * exact case where an orphan is created, so `close()` runs in a `finally` and
 * the manager never returns without having either stored a live client or
 * disposed of it.
 */

import type { IdFactory } from '../../protocol/ids';
import type { McpCapabilitySnapshotId, McpConnectionId } from '../../protocol/ids';
import {
  normalizeCapabilityFlags, normalizePrompt, normalizeResource, normalizeTool,
  snapshotFingerprint, diffSnapshots,
  type McpCapabilitySnapshot, type McpPromptDefinition, type McpResourceDefinition, type McpToolDefinition,
} from '../domain/mcp-capabilities';
import {
  transitionAllowed,
  type McpConnection, type McpConnectionDefinition, type McpConnectionState,
} from '../domain/mcp-connection';
import { mcpFailure, mcpFail, mcpOk, type McpFailure, type McpOutcome } from '../domain/mcp-failure';
import { verifyDeclaredIdentity, type McpServerIdentity } from '../domain/mcp-identity';
import {
  MCP_BASELINE_PROTOCOL_REVISION, negotiateProtocol, type McpProtocolIdentity,
} from '../domain/mcp-protocol';
import type {
  McpClientPort, McpCredentialResolverPort, McpSnapshotStorePort, McpTransportFactoryPort,
} from '../domain/mcp-ports';
import { resolveRegistryEntry, type McpRegistryEntry } from '../registry/mcp-registry-types';

export interface McpConnectionManagerDependencies {
  readonly ids: IdFactory;
  readonly now: () => string;
  readonly registry: readonly McpRegistryEntry[];
  readonly transports: readonly McpTransportFactoryPort[];
  readonly credentials: McpCredentialResolverPort | null;
  readonly snapshots: McpSnapshotStorePort;
  readonly clientName: string;
  readonly clientVersion: string;
  readonly connectTimeoutMs: number;
  readonly discoveryTimeoutMs: number;
}

export interface McpConnectResult {
  readonly connection: McpConnection;
  readonly snapshot: McpCapabilitySnapshot | null;
}

export class McpConnectionManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly clients = new Map<string, McpClientPort>();

  constructor(private readonly deps: McpConnectionManagerDependencies) {}

  get(connectionId: string): McpConnection | null {
    return this.connections.get(connectionId) ?? null;
  }

  client(connectionId: string): McpClientPort | null {
    return this.clients.get(connectionId) ?? null;
  }

  list(): readonly McpConnection[] {
    return [...this.connections.values()];
  }

  /** Registers a definition without contacting anything. State: `configured`. */
  configure(definition: McpConnectionDefinition): McpOutcome<McpConnection> {
    const lookup = resolveRegistryEntry(this.deps.registry, definition.registryEntryId);
    if (lookup.refused) {
      return mcpFail(mcpFailure('registry_untrusted', lookup.reason));
    }
    const entry = lookup.entry;
    if (entry.transport !== definition.transport) {
      return mcpFail(mcpFailure(
        'unsupported_transport',
        `registry entry ${entry.displayName} is a ${entry.transport} server; the connection is configured for ${definition.transport}`,
      ));
    }
    const connection: McpConnection = {
      definition,
      state: 'configured',
      identity: initialIdentity(definition, entry),
      protocol: null,
      capabilitySnapshotId: null,
      approvedSnapshotId: null,
      lastFailure: null,
      lastVerifiedAt: null,
      stateChangedAt: this.deps.now(),
      notes: entry.simulation ? ['this registry entry is a SIMULATION FIXTURE and connects to no live service'] : [],
    };
    this.connections.set(definition.connectionId, connection);
    return mcpOk(connection);
  }

  /**
   * Opens, negotiates, verifies and discovers. Returns the connection in its
   * resulting state — including a failed state, which is a RESULT, not an
   * exception.
   */
  async connect(connectionId: McpConnectionId, options: { signal?: AbortSignal } = {}): Promise<McpConnectResult> {
    const existing = this.connections.get(connectionId);
    if (!existing) {
      throw new Error(`connect called for unknown connection ${connectionId}`);
    }
    const entryLookup = resolveRegistryEntry(this.deps.registry, existing.definition.registryEntryId);
    if (entryLookup.refused) {
      return { connection: this.fail(existing, 'permission_blocked', mcpFailure(entryLookup.category, entryLookup.reason)), snapshot: null };
    }
    const entry = entryLookup.entry;

    const factory = this.deps.transports.find((candidate) => candidate.kind === existing.definition.transport);
    if (!factory) {
      return {
        connection: this.fail(existing, 'failed', mcpFailure('unsupported_transport', `no transport implementation for ${existing.definition.transport}`)),
        snapshot: null,
      };
    }

    /* credentials — resolved immediately before opening, never stored */
    let resolvedCredential = null;
    if (existing.definition.credentialReferenceId !== null) {
      if (this.deps.credentials === null) {
        return {
          connection: this.fail(existing, 'authorization_required', mcpFailure('credential_missing', 'this connection requires a credential and no resolver is configured')),
          snapshot: null,
        };
      }
      const reference = await this.deps.credentials.resolve({
        credentialReferenceId: existing.definition.credentialReferenceId,
        credentialClass: 'bearer_token',
        accountId: existing.definition.scope.accountId,
        workspaceId: existing.definition.scope.workspaceId,
        providerClass: entry.requiredCredentialClass ?? 'unknown',
        scopeSummary: entry.requiredCredentialScopes,
        state: 'active',
        expiresAt: null,
        revokedAt: null,
        createdAt: existing.definition.createdAt,
        updatedAt: existing.definition.createdAt,
        environmentVariableNames: entry.stdio?.environmentAllowlist ?? [],
      });
      if (!reference.ok) {
        const state: McpConnectionState =
          reference.failure.category === 'credential_missing' ? 'authorization_required'
            : reference.failure.category === 'authorization_required' ? 'authorization_required'
              : 'failed';
        return { connection: this.fail(existing, state, reference.failure), snapshot: null };
      }
      resolvedCredential = reference.value;
    }

    this.set(existing, 'connecting');

    const opened = await factory.open({
      connectionId,
      registryEntryId: entry.registryEntryId,
      requestedProtocolVersion: MCP_BASELINE_PROTOCOL_REVISION,
      clientName: this.deps.clientName,
      clientVersion: this.deps.clientVersion,
      connectTimeoutMs: this.deps.connectTimeoutMs,
      signal: options.signal,
      resolvedCredential,
    });

    if (!opened.ok) {
      return { connection: this.fail(this.current(connectionId), stateForFailure(opened.failure), opened.failure), snapshot: null };
    }

    const client = opened.value;
    let keepClient = false;
    try {
      this.set(this.current(connectionId), 'negotiating');

      /* --- protocol --- */
      const negotiation = negotiateProtocol(client.session.negotiatedProtocolVersion);
      if (!negotiation.acceptable) {
        return {
          connection: this.fail(this.current(connectionId), 'protocol_mismatch', mcpFailure('protocol_mismatch', negotiation.reason ?? 'protocol negotiation failed')),
          snapshot: null,
        };
      }

      /* --- identity --- */
      const verification = verifyDeclaredIdentity(
        this.current(connectionId).identity.requested,
        client.session.declaredIdentity,
        client.session.observedOrigin,
      );
      if (verification.trust === 'untrusted') {
        return {
          connection: this.fail(
            this.current(connectionId),
            'permission_blocked',
            mcpFailure('registry_untrusted', `server identity verification failed: ${verification.notes.join('; ')}`),
          ),
          snapshot: null,
        };
      }

      /* --- discovery --- */
      const listed = await client.listCapabilities({ timeoutMs: this.deps.discoveryTimeoutMs, signal: options.signal });
      if (!listed.ok) {
        return { connection: this.fail(this.current(connectionId), stateForFailure(listed.failure), listed.failure), snapshot: null };
      }

      const tools = listed.value.tools.map(normalizeTool).filter(isPresent<McpToolDefinition>);
      const resources = listed.value.resources.map(normalizeResource).filter(isPresent<McpResourceDefinition>);
      const prompts = listed.value.prompts.map(normalizePrompt).filter(isPresent<McpPromptDefinition>);
      const flags = normalizeCapabilityFlags(client.session.serverCapabilityFlags);

      const snapshotId = this.deps.ids.next('mcs');
      const snapshot: McpCapabilitySnapshot = {
        snapshotId,
        connectionId,
        negotiatedProtocolVersion: negotiation.negotiated!,
        serverName: verification.verified?.name ?? this.current(connectionId).identity.configuredName,
        serverVersion: verification.verified?.version ?? null,
        flags, tools, resources, prompts,
        fingerprint: snapshotFingerprint({
          negotiatedProtocolVersion: negotiation.negotiated!,
          serverName: verification.verified?.name ?? '',
          serverVersion: verification.verified?.version ?? null,
          flags, tools, resources, prompts,
        }),
        capturedAt: this.deps.now(),
      };
      this.deps.snapshots.put(snapshot);

      const identity: McpServerIdentity = {
        ...this.current(connectionId).identity,
        declared: client.session.declaredIdentity,
        verified: verification.verified,
        verificationMethod: verification.method,
        trust: verification.trust,
        observedOrigin: client.session.observedOrigin,
      };
      const protocol: McpProtocolIdentity = {
        requestedProtocolVersion: negotiation.requested,
        negotiatedProtocolVersion: negotiation.negotiated,
        acceptable: true,
        configuredTransport: this.current(connectionId).definition.transport,
        actualTransport: client.session.transport,
      };

      const ready: McpConnection = {
        ...this.current(connectionId),
        state: 'ready',
        identity,
        protocol,
        capabilitySnapshotId: snapshotId,
        // Approval is a SEPARATE act. A freshly discovered snapshot is not an
        // approved one; `approveSnapshot` is what a mission preflight calls.
        approvedSnapshotId: this.current(connectionId).approvedSnapshotId,
        lastFailure: null,
        lastVerifiedAt: this.deps.now(),
        stateChangedAt: this.deps.now(),
        notes: [...this.current(connectionId).notes, ...verification.notes],
      };
      this.connections.set(connectionId, ready);
      this.clients.set(connectionId, client);
      keepClient = true;
      return { connection: ready, snapshot };
    } finally {
      // Unconditional cleanup — the orphan-prevention guarantee.
      if (!keepClient) await client.close().catch(() => undefined);
    }
  }

  /** Binds an approved snapshot. Only a mission preflight calls this. */
  approveSnapshot(connectionId: string, snapshotId: McpCapabilitySnapshotId): McpOutcome<McpConnection> {
    const connection = this.connections.get(connectionId);
    if (!connection) return mcpFail(mcpFailure('capability_missing', `unknown connection ${connectionId}`));
    if (connection.capabilitySnapshotId !== snapshotId) {
      return mcpFail(mcpFailure(
        'capability_changed',
        'the snapshot being approved is not the one currently discovered on this connection',
      ));
    }
    const updated: McpConnection = { ...connection, approvedSnapshotId: snapshotId, stateChangedAt: this.deps.now() };
    this.connections.set(connectionId, updated);
    return mcpOk(updated);
  }

  /**
   * Re-discovers and compares against the approved snapshot.
   *
   * A material change moves the connection to `capability_changed`, which
   * `canInvoke` refuses — so invocation PAUSES rather than silently gaining
   * access to whatever the server became. The old approval is never carried
   * forward; §9 is explicit that it must not be inherited.
   */
  async refreshCapabilities(connectionId: string): Promise<McpOutcome<{ connection: McpConnection; changed: boolean; changes: readonly string[] }>> {
    const connection = this.connections.get(connectionId);
    const client = this.clients.get(connectionId);
    if (!connection || !client) return mcpFail(mcpFailure('server_unreachable', `no live session for ${connectionId}`));

    const listed = await client.listCapabilities({ timeoutMs: this.deps.discoveryTimeoutMs });
    if (!listed.ok) {
      return mcpFail(listed.failure);
    }
    const tools = listed.value.tools.map(normalizeTool).filter(isPresent<McpToolDefinition>);
    const resources = listed.value.resources.map(normalizeResource).filter(isPresent<McpResourceDefinition>);
    const prompts = listed.value.prompts.map(normalizePrompt).filter(isPresent<McpPromptDefinition>);
    const flags = normalizeCapabilityFlags(client.session.serverCapabilityFlags);
    const negotiated = client.session.negotiatedProtocolVersion;

    const snapshotId = this.deps.ids.next('mcs');
    const current: McpCapabilitySnapshot = {
      snapshotId,
      connectionId: connection.definition.connectionId,
      negotiatedProtocolVersion: negotiated,
      serverName: connection.identity.verified?.name ?? connection.identity.configuredName,
      serverVersion: connection.identity.verified?.version ?? null,
      flags, tools, resources, prompts,
      fingerprint: snapshotFingerprint({
        negotiatedProtocolVersion: negotiated,
        serverName: connection.identity.verified?.name ?? '',
        serverVersion: connection.identity.verified?.version ?? null,
        flags, tools, resources, prompts,
      }),
      capturedAt: this.deps.now(),
    };
    this.deps.snapshots.put(current);

    const approved = connection.approvedSnapshotId === null
      ? null
      : this.deps.snapshots.get(connection.approvedSnapshotId);

    if (approved === null) {
      const updated: McpConnection = { ...connection, capabilitySnapshotId: snapshotId, stateChangedAt: this.deps.now() };
      this.connections.set(connectionId, updated);
      return mcpOk({ connection: updated, changed: false, changes: [] });
    }

    const diff = diffSnapshots(approved, current);
    if (!diff.changed) {
      const updated: McpConnection = { ...connection, capabilitySnapshotId: snapshotId, lastVerifiedAt: this.deps.now() };
      this.connections.set(connectionId, updated);
      return mcpOk({ connection: updated, changed: false, changes: [] });
    }

    const materially = diff.changes.some((change) => change.requiresReapproval);
    const updated: McpConnection = {
      ...connection,
      capabilitySnapshotId: snapshotId,
      // A description-only change does not pause the mission, but it is still
      // recorded — a rewritten description is a common injection vector.
      state: materially ? 'capability_changed' : connection.state,
      approvedSnapshotId: materially ? null : connection.approvedSnapshotId,
      stateChangedAt: this.deps.now(),
      notes: [...connection.notes, ...diff.changes.map((change) => `${change.kind}: ${change.target}`)],
    };
    this.connections.set(connectionId, updated);
    return mcpOk({
      connection: updated,
      changed: true,
      changes: diff.changes.map((change) => `${change.kind}: ${change.target}`),
    });
  }

  /** Health probe. A crashed process can never answer, so it can never pass. */
  async checkHealth(connectionId: string, timeoutMs = 2_000): Promise<McpOutcome<true>> {
    const client = this.clients.get(connectionId);
    if (!client) return mcpFail(mcpFailure('server_unreachable', 'no live session'));
    return client.ping({ timeoutMs });
  }

  async close(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) this.set(connection, 'shutting_down');
    const client = this.clients.get(connectionId);
    this.clients.delete(connectionId);
    if (client) await client.close().catch(() => undefined);
    const after = this.connections.get(connectionId);
    if (after) this.set(after, 'closed');
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((id) => this.close(id)));
  }

  /* ---------------------------------------------------------------- */

  private current(connectionId: string): McpConnection {
    const connection = this.connections.get(connectionId);
    if (!connection) throw new Error(`connection ${connectionId} disappeared mid-connect`);
    return connection;
  }

  private set(connection: McpConnection, state: McpConnectionState): McpConnection {
    if (!transitionAllowed(connection.state, state)) {
      // An illegal transition is a manager bug, not a server behaviour. It is
      // recorded rather than thrown so one bad edge cannot take down a run,
      // and `mcp-connection-manager.test.ts` asserts none is ever produced.
      const noted: McpConnection = {
        ...connection,
        notes: [...connection.notes, `illegal transition ${connection.state} → ${state} was refused`],
      };
      this.connections.set(connection.definition.connectionId, noted);
      return noted;
    }
    const updated: McpConnection = { ...connection, state, stateChangedAt: this.deps.now() };
    this.connections.set(connection.definition.connectionId, updated);
    return updated;
  }

  private fail(connection: McpConnection, state: McpConnectionState, failure: McpFailure): McpConnection {
    const moved = this.set(connection, state);
    const updated: McpConnection = { ...moved, lastFailure: failure };
    this.connections.set(connection.definition.connectionId, updated);
    return updated;
  }
}

/* ------------------------------------------------------------------ */

function initialIdentity(definition: McpConnectionDefinition, entry: McpRegistryEntry): McpServerIdentity {
  return {
    configuredName: definition.configuredName,
    requested: {
      registryEntryId: entry.registryEntryId,
      expectedName: entry.expectedServerName,
      expectedVersion: entry.expectedServerVersion,
      expectedOrigin: entry.http?.expectedOrigin ?? null,
    },
    declared: null,
    verified: null,
    verificationMethod: 'none',
    // `registry_declared`, not `registry_verified`: the entry is curated, the
    // running server is not yet anything.
    trust: 'registry_declared',
    observedOrigin: null,
  };
}

function stateForFailure(failure: McpFailure): McpConnectionState {
  switch (failure.category) {
    case 'timed_out': return 'timed_out';
    case 'protocol_mismatch': return 'protocol_mismatch';
    case 'malformed_response':
    case 'non_mcp_stdout': return 'malformed_response';
    case 'authentication_failed':
    case 'authorization_required':
    case 'authorization_expired':
    case 'insufficient_scope':
    case 'credential_missing':
    case 'credential_revoked': return 'authorization_required';
    case 'network_policy_blocked':
    case 'registry_untrusted':
    case 'executable_not_allowed':
    case 'argument_not_allowed':
    case 'environment_not_allowed': return 'permission_blocked';
    case 'server_unreachable':
    case 'connection_refused':
    case 'dns_resolution_failed':
    case 'tls_failed': return 'unreachable';
    default: return 'failed';
  }
}

const isPresent = <T>(value: T | null): value is T => value !== null;

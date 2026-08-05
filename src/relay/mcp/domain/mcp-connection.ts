/**
 * MCP CONNECTION LIFECYCLE (PURE).
 *
 * FOURTEEN STATES, NOT A BOOLEAN (directive §5).
 *
 * `connected: true` is the state model that produces every MCP host incident
 * worth having. It cannot distinguish a server that is up but unauthorized
 * from one that is up and authorized; it cannot express "reachable but its
 * tools changed since you approved them"; and it makes `permission_blocked`
 * indistinguishable from `unreachable`, so the operator fixes the network when
 * the problem was a policy.
 *
 * The states below are each an ANSWER TO A DIFFERENT QUESTION, and the CLI and
 * the website both render them from this one list (§21, §22) so the two
 * surfaces cannot invent different vocabularies for the same condition.
 *
 * READY IS EARNED, NOT ASSUMED. `ready` requires: a live transport, an
 * acceptable negotiated protocol, a captured capability snapshot, and a trust
 * level that is not `untrusted`. `canInvoke` below is the single predicate the
 * gateway consults, and it returns false for all thirteen other states —
 * including `capability_changed`, which is the state that exists specifically
 * so a mid-mission surface change PAUSES invocation instead of silently
 * widening it.
 */

import type {
  McpCapabilitySnapshotId, McpConnectionId, McpCredentialReferenceId, McpRegistryEntryId,
} from '../../protocol/ids';
import type { McpFailure } from './mcp-failure';
import type { McpServerIdentity } from './mcp-identity';
import type { McpProtocolIdentity, McpTransportKind } from './mcp-protocol';

export const MCP_CONNECTION_STATES = [
  /** Defined in the registry and bound to a workspace; nothing attempted yet. */
  'configured',
  /** Transport is being established. */
  'connecting',
  /** Transport is up; `initialize` is in flight. */
  'negotiating',
  /** Negotiated, verified, snapshotted, and usable. */
  'ready',
  /** Usable, but something is degraded — an optional sub-capability is absent. */
  'degraded',
  /** The server requires authorization Relay does not currently hold. */
  'authorization_required',
  /** Relay policy — not the server — refuses this connection. */
  'permission_blocked',
  /** The surface changed after the approved snapshot. Invocation is PAUSED. */
  'capability_changed',
  /** Nothing answered. */
  'unreachable',
  /** Something answered, speaking a protocol revision Relay refuses. */
  'protocol_mismatch',
  /** Something answered, and what it said was not MCP. */
  'malformed_response',
  /** A bounded wait elapsed. Never a success, never a failure-to-connect. */
  'timed_out',
  /** Closing in progress; new invocations refused. */
  'shutting_down',
  /** Closed cleanly. */
  'closed',
  /** Terminal failure that is none of the above. */
  'failed',
] as const;
export type McpConnectionState = (typeof MCP_CONNECTION_STATES)[number];

/**
 * The ONLY state from which an invocation may proceed.
 *
 * `degraded` is deliberately excluded. A degraded connection is one Relay
 * cannot fully vouch for, and §19 already provides the honest path for it: an
 * OPTIONAL MCP may degrade a mission's readiness, but a degraded connection
 * does not get to serve tool calls as though it were ready.
 */
export const canInvoke = (state: McpConnectionState): boolean => state === 'ready';

/** States from which a reconnect attempt is meaningful. */
export const isRetryable = (state: McpConnectionState): boolean =>
  state === 'unreachable' || state === 'timed_out' || state === 'failed' || state === 'closed';

/** States that are terminal for this connection object. */
export const isTerminal = (state: McpConnectionState): boolean =>
  state === 'closed' || state === 'failed';

/**
 * THE OWNERSHIP SCOPE OF A CONNECTION.
 *
 * A connection belongs to exactly one account and one workspace, and
 * optionally to one project. `connectionUsableBy` refuses any request whose
 * scope does not match, so a connection opened for Workspace A can never serve
 * Workspace B — the cross-tenant reuse §5 forbids. There is no shared-connection
 * policy in this milestone; when one is added it will be an explicit field
 * here, not an absence of a check.
 */
export interface McpConnectionScope {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
}

export interface McpConnectionDefinition {
  readonly connectionId: McpConnectionId;
  readonly registryEntryId: McpRegistryEntryId;
  readonly configuredName: string;
  readonly scope: McpConnectionScope;
  readonly transport: McpTransportKind;
  readonly credentialReferenceId: McpCredentialReferenceId | null;
  readonly createdAt: string;
}

export interface McpConnection {
  readonly definition: McpConnectionDefinition;
  readonly state: McpConnectionState;
  readonly identity: McpServerIdentity;
  readonly protocol: McpProtocolIdentity | null;
  /** The snapshot captured on this connection, if discovery completed. */
  readonly capabilitySnapshotId: McpCapabilitySnapshotId | null;
  /** The snapshot a mission APPROVED. Differs from the above after a change. */
  readonly approvedSnapshotId: McpCapabilitySnapshotId | null;
  readonly lastFailure: McpFailure | null;
  readonly lastVerifiedAt: string | null;
  readonly stateChangedAt: string;
  /** Safe, human-readable notes — never raw server output. */
  readonly notes: readonly string[];
}

/**
 * Scope check. Returns a reason on refusal rather than a bare false, because
 * "this connection belongs to another workspace" and "this connection belongs
 * to another project" call for different operator actions.
 */
export function connectionUsableBy(
  connection: McpConnection,
  requester: McpConnectionScope,
): { readonly usable: true } | { readonly usable: false; readonly reason: string } {
  const owner = connection.definition.scope;
  if (owner.accountId !== requester.accountId) {
    return { usable: false, reason: 'the connection belongs to a different account' };
  }
  if (owner.workspaceId !== requester.workspaceId) {
    return { usable: false, reason: 'the connection belongs to a different workspace' };
  }
  if (owner.projectId !== null && owner.projectId !== requester.projectId) {
    return { usable: false, reason: 'the connection is bound to a different project' };
  }
  return { usable: true };
}

/**
 * The lifecycle transitions Relay permits. An unlisted transition is a bug in
 * the connection manager, and `mcp-connection.test.ts` asserts the manager
 * only ever produces listed ones — so a state cannot be reached by accident
 * and then treated as though someone designed it.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<McpConnectionState, readonly McpConnectionState[]>> = Object.freeze({
  // `authorization_required` is reachable from `configured` because a required
  // credential can be absent BEFORE any transport is opened — the resolver runs
  // first, precisely so a connection with no credential never starts a process
  // or opens a socket.
  configured: ['connecting', 'authorization_required', 'permission_blocked', 'closed', 'failed'],
  connecting: ['negotiating', 'unreachable', 'timed_out', 'authorization_required', 'malformed_response', 'failed', 'shutting_down'],
  negotiating: ['ready', 'degraded', 'protocol_mismatch', 'malformed_response', 'timed_out', 'authorization_required', 'permission_blocked', 'failed', 'shutting_down'],
  ready: ['degraded', 'capability_changed', 'authorization_required', 'permission_blocked', 'unreachable', 'timed_out', 'malformed_response', 'shutting_down', 'failed'],
  degraded: ['ready', 'capability_changed', 'unreachable', 'timed_out', 'authorization_required', 'permission_blocked', 'shutting_down', 'failed'],
  authorization_required: ['connecting', 'shutting_down', 'closed', 'failed'],
  permission_blocked: ['configured', 'shutting_down', 'closed'],
  // A changed surface returns to ready ONLY through re-approval, which
  // re-enters via `connecting` — there is no direct capability_changed → ready
  // edge, because that edge is exactly "inherit the old approval".
  capability_changed: ['connecting', 'shutting_down', 'closed', 'permission_blocked', 'failed'],
  unreachable: ['connecting', 'shutting_down', 'closed', 'failed'],
  protocol_mismatch: ['shutting_down', 'closed', 'failed'],
  malformed_response: ['shutting_down', 'closed', 'failed'],
  timed_out: ['connecting', 'shutting_down', 'closed', 'failed'],
  shutting_down: ['closed', 'failed'],
  closed: ['connecting'],
  failed: ['connecting', 'closed'],
});

export const transitionAllowed = (from: McpConnectionState, to: McpConnectionState): boolean =>
  from === to || (ALLOWED_TRANSITIONS[from] ?? []).includes(to);

/** Operator-facing one-line summary. Shared by the CLI and the website. */
export const MCP_CONNECTION_STATE_LABELS: Readonly<Record<McpConnectionState, string>> = Object.freeze({
  configured: 'configured — never contacted',
  connecting: 'connecting',
  negotiating: 'negotiating protocol',
  ready: 'ready — verified, snapshotted, authorized',
  degraded: 'degraded — usable surface reduced',
  authorization_required: 'authorization required',
  permission_blocked: 'blocked by Relay policy',
  capability_changed: 'capability changed — invocation paused pending re-approval',
  unreachable: 'unreachable',
  protocol_mismatch: 'protocol mismatch',
  malformed_response: 'malformed response — not MCP',
  timed_out: 'timed out',
  shutting_down: 'shutting down',
  closed: 'closed',
  failed: 'failed',
});

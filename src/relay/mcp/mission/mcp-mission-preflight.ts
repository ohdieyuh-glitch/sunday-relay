/**
 * MCP MISSION PREFLIGHT (PURE).
 *
 * THE RULE (§19): **a required MCP that is unavailable BLOCKS mission
 * readiness. An optional MCP that is unavailable produces a truthful DEGRADED
 * state.** Never the reverse, and never a silent third option where a mission
 * proceeds hoping the connector comes back.
 *
 * WHY PREFLIGHT IS A SEPARATE, PURE FUNCTION rather than a check inside the
 * mission runner: it has to be answerable BEFORE anything runs, from the CLI
 * (`relay mission mcp preflight <mission-id>`) and from the website, with the
 * same answer both times. A readiness rule embedded in an execution path can
 * only be evaluated by executing, which is exactly the thing a preflight
 * exists to avoid.
 *
 * FAILURE CATEGORIES ARE SPECIFIC AND SAFE. Every finding names what is wrong
 * in terms an operator can act on — which connection, which scope, which
 * capability — and none of them contains a secret, a token, a header, a local
 * path or a raw server message. "Preflight failed" is not an output this
 * function can produce.
 *
 * A NOTE ON WHAT `ready` MEANS HERE. It means every REQUIRED precondition is
 * satisfied at this instant. It does not promise the server will still be there
 * in a minute — nothing can — which is why `capability_changed` exists as a
 * runtime state and why the gateway re-checks the approved snapshot on every
 * single invocation rather than trusting this result.
 */

import type { McpCapabilitySnapshot } from '../domain/mcp-capabilities';
import { findPrompt, findResource, findTool } from '../domain/mcp-capabilities';
import type { McpConnection } from '../domain/mcp-connection';
import type { McpCredentialReference } from '../domain/mcp-credential';
import { credentialIsUsable, missingScopes } from '../domain/mcp-credential';
import type { McpMissionBindingId } from '../../protocol/ids';
import { MCP_SUPPORTED_PROTOCOL_REVISIONS } from '../domain/mcp-protocol';
import type { McpApprovalRecord } from '../policy/mcp-approvals';
import type { McpPermissionGrant } from '../policy/mcp-permissions';
import { resolveRegistryEntry, type McpRegistryEntry } from '../registry/mcp-registry-types';

export const MCP_PREFLIGHT_FAILURE_CATEGORIES = [
  'required_connection_missing',
  'optional_connection_unavailable',
  'credential_missing',
  'authorization_required',
  'insufficient_scope',
  'protocol_mismatch',
  'capability_missing',
  'capability_changed',
  'permission_missing',
  'approval_missing',
  'server_unreachable',
  'registry_untrusted',
  'network_policy_blocked',
] as const;
export type McpPreflightFailureCategory = (typeof MCP_PREFLIGHT_FAILURE_CATEGORIES)[number];

/** Categories that DEGRADE rather than block. Exactly one, deliberately. */
const DEGRADING_CATEGORIES: readonly McpPreflightFailureCategory[] = Object.freeze([
  'optional_connection_unavailable',
]);

export interface McpMissionCapabilityRequirement {
  readonly capabilityKind: 'tool' | 'resource' | 'prompt';
  readonly name: string;
}

/** One MCP a mission declares it needs. */
export interface McpMissionRequirement {
  readonly registryEntryId: string;
  readonly required: boolean;
  readonly capabilities: readonly McpMissionCapabilityRequirement[];
  readonly requiredScopes: readonly string[];
  /** Operations that must be pre-approved before the mission may start. */
  readonly preApprovedOperations: readonly string[];
  readonly minimumProtocolRevision: string;
}

/** The mission's MCP binding — what it needs and what it approved. */
export interface McpMissionBinding {
  readonly missionBindingId: McpMissionBindingId;
  readonly missionId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly requirements: readonly McpMissionRequirement[];
  /** connectionId → the snapshot id the mission approved. */
  readonly approvedSnapshots: Readonly<Record<string, string>>;
  readonly writablePathPrefixes: readonly string[];
  readonly createdAt: string;
}

export interface McpPreflightFinding {
  readonly category: McpPreflightFailureCategory;
  readonly registryEntryId: string;
  readonly connectionId: string | null;
  /** Safe, specific, actionable. Never a secret, path or raw server message. */
  readonly detail: string;
  readonly blocking: boolean;
}

export const MCP_PREFLIGHT_READINESS = ['ready', 'degraded', 'blocked'] as const;
export type McpPreflightReadiness = (typeof MCP_PREFLIGHT_READINESS)[number];

export interface McpPreflightResult {
  readonly readiness: McpPreflightReadiness;
  readonly findings: readonly McpPreflightFinding[];
  /** Requirements that are fully satisfied. */
  readonly satisfied: readonly string[];
  /** Optional requirements running in a degraded state. */
  readonly degraded: readonly string[];
  readonly checkedAt: string;
}

export interface McpPreflightInput {
  readonly binding: McpMissionBinding;
  readonly registry: readonly McpRegistryEntry[];
  /** registryEntryId → the connection configured for it, if any. */
  readonly connections: readonly McpConnection[];
  readonly snapshots: { get(snapshotId: string): McpCapabilitySnapshot | null };
  readonly credentials: readonly McpCredentialReference[];
  readonly grants: readonly McpPermissionGrant[];
  readonly approvals: readonly McpApprovalRecord[];
  /** Whether the network policy permits each connection's transport. */
  readonly networkPolicyAllows: (connection: McpConnection) => boolean;
  readonly now: string;
}

export function runMcpMissionPreflight(input: McpPreflightInput): McpPreflightResult {
  const findings: McpPreflightFinding[] = [];
  const satisfied: string[] = [];
  const degraded: string[] = [];

  for (const requirement of input.binding.requirements) {
    const before = findings.length;
    const connection = input.connections.find(
      (candidate) => candidate.definition.registryEntryId === requirement.registryEntryId,
    ) ?? null;

    checkRequirement(requirement, connection, input, findings);

    const added = findings.slice(before);
    if (added.length === 0) {
      satisfied.push(requirement.registryEntryId);
    } else if (!requirement.required) {
      degraded.push(requirement.registryEntryId);
    }
  }

  const blocking = findings.some((finding) => finding.blocking);
  const readiness: McpPreflightReadiness = blocking
    ? 'blocked'
    : degraded.length > 0 ? 'degraded' : 'ready';

  return { readiness, findings, satisfied, degraded, checkedAt: input.now };
}

/* ------------------------------------------------------------------ */

function checkRequirement(
  requirement: McpMissionRequirement,
  connection: McpConnection | null,
  input: McpPreflightInput,
  findings: McpPreflightFinding[],
): void {
  const add = (category: McpPreflightFailureCategory, detail: string): void => {
    findings.push({
      category,
      registryEntryId: requirement.registryEntryId,
      connectionId: connection?.definition.connectionId ?? null,
      detail,
      // An optional requirement never blocks — that is the whole meaning of
      // "optional", and encoding it here rather than at each call site is what
      // keeps a new check from accidentally making an optional MCP mandatory.
      blocking: requirement.required && !DEGRADING_CATEGORIES.includes(category),
    });
  };

  /* --- registry --- */
  const lookup = resolveRegistryEntry(input.registry, requirement.registryEntryId);
  if (lookup.refused) {
    add('registry_untrusted', lookup.reason);
    return;
  }
  const entry = lookup.entry;

  /* --- connection exists --- */
  if (connection === null) {
    if (requirement.required) {
      add('required_connection_missing', `the mission requires "${entry.displayName}" and no connection is configured for it`);
    } else {
      add('optional_connection_unavailable', `the optional connector "${entry.displayName}" is not configured — the mission may proceed without it`);
    }
    return;
  }

  /* --- network policy --- */
  if (!input.networkPolicyAllows(connection)) {
    add('network_policy_blocked', `the network policy does not permit the ${connection.definition.transport} transport for "${entry.displayName}"`);
    return;
  }

  /* --- credentials --- */
  if (entry.requiredCredentialClass !== null || requirement.requiredScopes.length > 0) {
    const reference = connection.definition.credentialReferenceId === null
      ? null
      : input.credentials.find((candidate) => candidate.credentialReferenceId === connection.definition.credentialReferenceId) ?? null;
    if (reference === null) {
      add('credential_missing', `"${entry.displayName}" requires a ${entry.requiredCredentialClass ?? 'credential'} and none is connected`);
      return;
    }
    if (!credentialIsUsable(reference)) {
      add(
        reference.state === 'expired' || reference.state === 'revoked' ? 'authorization_required' : 'credential_missing',
        `the credential for "${entry.displayName}" is ${reference.state}`,
      );
      return;
    }
    const required = [...new Set([...entry.requiredCredentialScopes, ...requirement.requiredScopes])];
    const absent = missingScopes(reference, required);
    if (absent.length > 0) {
      add('insufficient_scope', `the credential for "${entry.displayName}" is missing scope(s): ${absent.join(', ')}`);
      return;
    }
  }

  /* --- connection health --- */
  if (connection.state === 'capability_changed') {
    add('capability_changed', `"${entry.displayName}" changed its capability surface after approval and must be re-approved`);
    return;
  }
  if (connection.state !== 'ready') {
    if (connection.state === 'authorization_required') {
      add('authorization_required', `"${entry.displayName}" requires authorization that Relay does not currently hold`);
    } else if (connection.state === 'protocol_mismatch') {
      add('protocol_mismatch', `"${entry.displayName}" negotiated ${connection.protocol?.negotiatedProtocolVersion ?? 'an unsupported revision'}; Relay requires ${MCP_SUPPORTED_PROTOCOL_REVISIONS.join(', ')}`);
    } else {
      add('server_unreachable', `"${entry.displayName}" is ${connection.state}, not ready`);
    }
    return;
  }

  /* --- protocol --- */
  const negotiated = connection.protocol?.negotiatedProtocolVersion ?? null;
  if (negotiated === null || !MCP_SUPPORTED_PROTOCOL_REVISIONS.includes(negotiated)) {
    add('protocol_mismatch', `"${entry.displayName}" has no acceptable negotiated protocol revision`);
    return;
  }
  if (negotiated < requirement.minimumProtocolRevision) {
    add('protocol_mismatch', `"${entry.displayName}" negotiated ${negotiated}; the mission requires at least ${requirement.minimumProtocolRevision}`);
    return;
  }

  /* --- approved snapshot --- */
  const approvedId = input.binding.approvedSnapshots[connection.definition.connectionId] ?? null;
  if (approvedId === null || connection.approvedSnapshotId !== approvedId) {
    add('capability_changed', `the mission has not approved the current capability snapshot of "${entry.displayName}"`);
    return;
  }
  const snapshot = input.snapshots.get(approvedId);
  if (snapshot === null) {
    add('capability_missing', `the approved capability snapshot for "${entry.displayName}" could not be loaded`);
    return;
  }

  /* --- required capabilities --- */
  for (const capability of requirement.capabilities) {
    const present =
      capability.capabilityKind === 'tool' ? findTool(snapshot, capability.name) !== null
        : capability.capabilityKind === 'resource' ? findResource(snapshot, capability.name) !== null
          : findPrompt(snapshot, capability.name) !== null;
    if (!present) {
      add('capability_missing', `"${entry.displayName}" does not offer the required ${capability.capabilityKind} "${capability.name}"`);
    }
  }

  /* --- grants --- */
  for (const capability of requirement.capabilities) {
    const covered = input.grants.some((grant) =>
      grant.revokedAt === null
      && grant.registryEntryId === requirement.registryEntryId
      && grant.capabilityKind === capability.capabilityKind
      && grant.capabilityNames.includes(capability.name)
      && (grant.missionId === null || grant.missionId === input.binding.missionId));
    if (!covered) {
      add('permission_missing', `no permission grant covers ${capability.capabilityKind} "${capability.name}" on "${entry.displayName}"`);
    }
  }

  /* --- pre-approvals --- */
  for (const operation of requirement.preApprovedOperations) {
    const approved = input.approvals.some((record) =>
      record.state === 'granted'
      && record.revokedAt === null
      && record.capabilityName === operation
      && record.serverName === connection.identity.configuredName
      && (record.missionId === null || record.missionId === input.binding.missionId)
      && (record.expiresAt === null || Date.parse(record.expiresAt) > Date.parse(input.now))
      && record.usageCount < record.maximumInvocations);
    if (!approved) {
      add('approval_missing', `"${operation}" on "${entry.displayName}" requires a human approval that does not exist yet`);
    }
  }
}

/** One-line, safe summary for the CLI and the website. */
export function preflightSummaryLine(result: McpPreflightResult): string {
  if (result.readiness === 'ready') {
    return `MCP preflight: READY — ${result.satisfied.length} requirement(s) satisfied`;
  }
  if (result.readiness === 'degraded') {
    return `MCP preflight: DEGRADED — ${result.satisfied.length} satisfied, ${result.degraded.length} optional connector(s) unavailable`;
  }
  const blocking = result.findings.filter((finding) => finding.blocking).length;
  return `MCP preflight: BLOCKED — ${blocking} blocking finding(s)`;
}

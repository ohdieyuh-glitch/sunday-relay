/**
 * THE SHARED MCP SURFACE PROJECTION (PURE).
 *
 * ONE projection, consumed byte-identically by the CLI/terminal and the
 * website/application. This is how Relay's parity requirement (governance §7)
 * is met for MCP: the two surfaces do not each decide what "degraded" means,
 * what a risk label reads as, or which states count as trusted. They render
 * the same rows produced here, and only the presentation differs.
 *
 * WHAT THIS PROJECTION REFUSES TO CARRY, and therefore what neither surface
 * can display even by mistake (§21, §22):
 *
 *   no tokens, no headers, no credential material of any kind;
 *   no local executable paths — a registry entry's executable NAME is policy
 *     and is shown; the resolved path is host topology and is not;
 *   no child environments — only the allowlisted NAMES;
 *   no unrestricted tool results — counts, byte totals and evidence
 *     references only.
 *
 * The fields simply do not exist on these types, so "the website accidentally
 * rendered the token" is not a bug that can be written.
 *
 * `simulation` TRAVELS WITH EVERY ROW. Every registry entry in this milestone
 * is a fixture, and a surface that shows a fixture connector without saying so
 * is claiming a live integration Relay does not have. The flag is not optional
 * and not derived at render time — it is on the row.
 */

import type { McpCapabilitySnapshot } from './mcp-capabilities';
import type { McpConnection } from './mcp-connection';
import { MCP_CONNECTION_STATE_LABELS } from './mcp-connection';
import type { McpApprovalRecord } from '../policy/mcp-approvals';
import type { McpRiskClass } from '../policy/mcp-risk';
import type { McpRegistryEntry } from '../registry/mcp-registry-types';

/** One catalog row — a curated registry entry as both surfaces show it. */
export interface McpCatalogRow {
  readonly registryEntryId: string;
  readonly displayName: string;
  readonly category: string;
  readonly state: string;
  readonly connectable: boolean;
  readonly transport: string;
  readonly publisher: string;
  readonly expectedServerName: string;
  readonly minimumProtocolRevision: string;
  readonly maximumRiskClass: McpRiskClass;
  readonly requiresCredential: boolean;
  readonly requiredScopes: readonly string[];
  /** Executable NAME or endpoint HOST. Never a resolved path or a full URL
   * with a query. */
  readonly launchIdentity: string;
  readonly securityReviewed: boolean;
  readonly simulation: boolean;
  readonly notes: readonly string[];
}

export function projectCatalog(entries: readonly McpRegistryEntry[]): readonly McpCatalogRow[] {
  return entries.map((entry) => ({
    registryEntryId: entry.registryEntryId,
    displayName: entry.displayName,
    category: entry.category,
    state: entry.state,
    connectable: entry.state === 'approved' || entry.state === 'deprecated',
    transport: entry.transport,
    publisher: entry.publisher,
    expectedServerName: entry.expectedServerName,
    minimumProtocolRevision: entry.minimumProtocolRevision,
    maximumRiskClass: entry.maximumRiskClass,
    requiresCredential: entry.requiredCredentialClass !== null,
    requiredScopes: entry.requiredCredentialScopes,
    launchIdentity: entry.stdio !== null
      ? entry.stdio.executable
      : entry.http !== null ? new URL(entry.http.url).host : 'unknown',
    securityReviewed: entry.securityReviewedAt !== null,
    simulation: entry.simulation,
    notes: entry.notes,
  }));
}

/**
 * The seven facts §21 requires a surface to keep DISTINCT. They are separate
 * booleans rather than one status string precisely because collapsing them is
 * the failure: a connector can be configured and unreachable, reachable and
 * untrusted, trusted and unauthorized, or authorized and capability-changed,
 * and an operator needs to see which.
 */
export interface McpConnectionRow {
  readonly connectionId: string;
  readonly displayName: string;
  readonly registryEntryId: string;
  readonly transport: string;
  readonly state: string;
  readonly stateLabel: string;

  readonly configured: boolean;
  readonly reachable: boolean;
  readonly ready: boolean;
  readonly trusted: boolean;
  readonly authorized: boolean;
  readonly degraded: boolean;
  readonly capabilityChanged: boolean;

  readonly requestedProtocolVersion: string | null;
  readonly negotiatedProtocolVersion: string | null;
  readonly identityVerified: boolean;
  readonly verificationMethod: string;
  readonly capabilitySnapshotId: string | null;
  readonly approvedSnapshotId: string | null;
  readonly lastVerifiedAt: string | null;
  readonly lastFailureCategory: string | null;
  readonly lastFailureMessage: string | null;
  readonly simulation: boolean;
}

export function projectConnections(
  connections: readonly McpConnection[],
  registry: readonly McpRegistryEntry[],
): readonly McpConnectionRow[] {
  return connections.map((connection) => {
    const entry = registry.find((candidate) => candidate.registryEntryId === connection.definition.registryEntryId) ?? null;
    const state = connection.state;
    return {
      connectionId: connection.definition.connectionId,
      displayName: connection.definition.configuredName,
      registryEntryId: connection.definition.registryEntryId,
      transport: connection.definition.transport,
      state,
      stateLabel: MCP_CONNECTION_STATE_LABELS[state],
      configured: true,
      // "reachable" means something answered — which is true for every state
      // reached AFTER the transport opened, including the failure states that
      // required an answer to diagnose.
      reachable: state === 'ready' || state === 'degraded' || state === 'negotiating'
        || state === 'capability_changed' || state === 'protocol_mismatch'
        || state === 'malformed_response' || state === 'authorization_required',
      ready: state === 'ready',
      trusted: connection.identity.trust === 'registry_verified',
      authorized: state !== 'authorization_required' && state !== 'permission_blocked',
      degraded: state === 'degraded',
      capabilityChanged: state === 'capability_changed',
      requestedProtocolVersion: connection.protocol?.requestedProtocolVersion ?? null,
      negotiatedProtocolVersion: connection.protocol?.negotiatedProtocolVersion ?? null,
      identityVerified: connection.identity.verified !== null,
      verificationMethod: connection.identity.verificationMethod,
      capabilitySnapshotId: connection.capabilitySnapshotId,
      approvedSnapshotId: connection.approvedSnapshotId,
      lastVerifiedAt: connection.lastVerifiedAt,
      lastFailureCategory: connection.lastFailure?.category ?? null,
      lastFailureMessage: connection.lastFailure?.message ?? null,
      simulation: entry?.simulation ?? true,
    };
  });
}

export interface McpCapabilityRow {
  readonly kind: 'tool' | 'resource' | 'prompt';
  readonly name: string;
  readonly description: string;
  readonly fingerprint: string;
  /** Relay's classification. Null for resources/prompts, which are read-only
   * by construction in this milestone. */
  readonly riskClass: McpRiskClass | null;
  /** True when the server's own hints disagree with Relay's classification. */
  readonly annotationContradiction: boolean;
  readonly requiresHumanApproval: boolean;
}

export interface McpCapabilitiesView {
  readonly snapshotId: string;
  readonly connectionId: string;
  readonly serverName: string;
  readonly negotiatedProtocolVersion: string;
  readonly snapshotFingerprint: string;
  readonly capturedAt: string;
  readonly approved: boolean;
  readonly rows: readonly McpCapabilityRow[];
}

export function projectCapabilities(
  snapshot: McpCapabilitySnapshot,
  approved: boolean,
  classify: (tool: { name: string; description: string; inputSchema: Record<string, unknown> }) => { riskClass: McpRiskClass; annotationContradiction: boolean; requiresHumanApproval: boolean },
): McpCapabilitiesView {
  const rows: McpCapabilityRow[] = [
    ...snapshot.tools.map((tool) => {
      const assessment = classify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
      return {
        kind: 'tool' as const,
        name: tool.name,
        description: tool.description,
        fingerprint: tool.fingerprint,
        riskClass: assessment.riskClass,
        annotationContradiction: assessment.annotationContradiction,
        requiresHumanApproval: assessment.requiresHumanApproval,
      };
    }),
    ...snapshot.resources.map((resource) => ({
      kind: 'resource' as const,
      name: resource.uri,
      description: resource.description,
      fingerprint: resource.fingerprint,
      riskClass: null,
      annotationContradiction: false,
      requiresHumanApproval: false,
    })),
    ...snapshot.prompts.map((prompt) => ({
      kind: 'prompt' as const,
      name: prompt.name,
      description: prompt.description,
      fingerprint: prompt.fingerprint,
      riskClass: null,
      annotationContradiction: false,
      requiresHumanApproval: false,
    })),
  ];
  return {
    snapshotId: snapshot.snapshotId,
    connectionId: snapshot.connectionId,
    serverName: snapshot.serverName,
    negotiatedProtocolVersion: snapshot.negotiatedProtocolVersion,
    snapshotFingerprint: snapshot.fingerprint,
    capturedAt: snapshot.capturedAt,
    approved,
    rows,
  };
}

export interface McpApprovalRow {
  readonly approvalRecordId: string;
  readonly policy: string;
  readonly state: string;
  readonly serverName: string;
  readonly capabilityKind: string;
  readonly capabilityName: string;
  readonly riskClass: McpRiskClass;
  readonly agentRole: string;
  readonly decidedByHumanId: string;
  readonly decidedAt: string;
  readonly expiresAt: string | null;
  readonly usageCount: number;
  readonly maximumInvocations: number;
  readonly revoked: boolean;
  /** The digest the consent is bound to. Shown so scope is visible, never the
   * argument values it was computed from. */
  readonly argumentFingerprint: string;
}

export function projectApprovals(records: readonly McpApprovalRecord[]): readonly McpApprovalRow[] {
  return records.map((record) => ({
    approvalRecordId: record.approvalRecordId,
    policy: record.policy,
    state: record.state,
    serverName: record.serverName,
    capabilityKind: record.capabilityKind,
    capabilityName: record.capabilityName,
    riskClass: record.riskClass,
    agentRole: record.agentRole,
    decidedByHumanId: record.decidedByHumanId,
    decidedAt: record.decidedAt,
    expiresAt: record.expiresAt,
    usageCount: record.usageCount,
    maximumInvocations: record.maximumInvocations,
    revoked: record.revokedAt !== null,
    argumentFingerprint: record.argumentFingerprint,
  }));
}

/** Risk labels. ONE wording, both surfaces. */
export const MCP_RISK_LABELS: Readonly<Record<McpRiskClass, string>> = Object.freeze({
  read_only: 'read only',
  workspace_write: 'workspace write',
  external_write: 'external write',
  financial: 'financial',
  deployment: 'deployment',
  credential_access: 'credential access',
  destructive: 'destructive',
  unknown: 'UNKNOWN — refused',
});

/** Permission-decision labels. ONE wording, both surfaces. */
export const MCP_PERMISSION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  allow: 'allowed',
  requires_approval: 'human approval required',
  deny: 'denied',
});

/** Approval-state labels. ONE wording, both surfaces. */
export const MCP_APPROVAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'pending',
  granted: 'granted',
  denied: 'denied',
  expired: 'expired',
  exhausted: 'exhausted',
  revoked: 'revoked',
});

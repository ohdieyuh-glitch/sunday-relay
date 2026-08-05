/**
 * PROJECT BRAIN AND TRACE PROJECTIONS FOR MCP (PURE).
 *
 * Project Brain is what a human and an agent both read to understand a
 * project's state. This module decides what MCP contributes to it — and,
 * far more importantly, what it does not.
 *
 * WHAT IS DELIBERATELY ABSENT FROM EVERY PROJECTION HERE (§18):
 *
 *   raw credentials              — never present anywhere in the MCP domain;
 *   authorization headers        — resolved server-side, never stored;
 *   unrestricted MCP output      — only bounded, redacted summaries and
 *                                  evidence REFERENCES;
 *   local executable paths       — a registry entry's executable NAME is
 *                                  policy; the resolved path is host topology
 *                                  and is never projected;
 *   entire child environments    — only the allowlisted NAMES, never values;
 *   OAuth refresh tokens         — see "raw credentials".
 *
 * `assertProjectionIsSafe` re-derives that from the produced value using the
 * same detectors the credential domain and the sanitizer use, so the guarantee
 * is a test over real output rather than a promise in a comment.
 *
 * CLAIMS AND EVIDENCE STAY SEPARATE. `MCP_TRACE_CLAIM_KINDS` records what the
 * system asserts; evidence references point at what was actually captured. A
 * projection that merged them would let "the agent said it read the file" and
 * "here is the bounded record of the read" become the same sentence, which is
 * precisely the conflation the Aquala Trace standard exists to prevent.
 */

import type { McpCapabilitySnapshot } from '../domain/mcp-capabilities';
import type { McpConnection } from '../domain/mcp-connection';
import { MCP_CONNECTION_STATE_LABELS } from '../domain/mcp-connection';
import { forbiddenCredentialFieldsIn } from '../domain/mcp-credential';
import type { McpAuditRecord } from '../domain/mcp-invocation';
import { containsSecretShapedText } from '../policy/mcp-sanitize';
import type { McpPreflightResult } from './mcp-mission-preflight';

/** One connector, as Project Brain shows it. */
export interface McpBrainConnector {
  readonly connectionId: string;
  readonly displayName: string;
  readonly registryEntryId: string;
  readonly transport: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly trust: string;
  readonly identityVerified: boolean;
  readonly negotiatedProtocolVersion: string | null;
  readonly capabilitySnapshotId: string | null;
  readonly approvedSnapshotId: string | null;
  readonly capabilityCounts: { readonly tools: number; readonly resources: number; readonly prompts: number };
  readonly lastVerifiedAt: string | null;
  readonly lastFailureCategory: string | null;
  readonly simulation: boolean;
}

export interface McpBrainInvocationSummary {
  readonly invocationId: string;
  readonly capabilityKind: string;
  readonly capabilityName: string;
  readonly riskClass: string;
  readonly permissionDecision: string;
  readonly invocationState: string;
  readonly approvalRecordId: string | null;
  readonly evidenceReferences: readonly string[];
  readonly failureCategory: string | null;
  readonly requestedAt: string;
}

export interface McpProjectBrainProjection {
  readonly configuredRequirements: readonly string[];
  readonly connectors: readonly McpBrainConnector[];
  readonly unavailableRequiredConnectors: readonly string[];
  readonly degradedConnectors: readonly string[];
  readonly permissionDecisions: Readonly<Record<string, number>>;
  readonly approvalDecisions: Readonly<Record<string, number>>;
  readonly recentInvocations: readonly McpBrainInvocationSummary[];
  readonly evidenceReferences: readonly string[];
  readonly preflightReadiness: string | null;
  readonly preflightFindings: readonly string[];
}

export function projectMcpProjectBrain(input: {
  readonly connections: readonly McpConnection[];
  readonly snapshots: { get(snapshotId: string): McpCapabilitySnapshot | null };
  readonly audit: readonly McpAuditRecord[];
  readonly preflight: McpPreflightResult | null;
  readonly simulationRegistryEntryIds: readonly string[];
  readonly recentLimit?: number;
}): McpProjectBrainProjection {
  const connectors: McpBrainConnector[] = input.connections.map((connection) => {
    const snapshot = connection.capabilitySnapshotId === null
      ? null
      : input.snapshots.get(connection.capabilitySnapshotId);
    return {
      connectionId: connection.definition.connectionId,
      displayName: connection.definition.configuredName,
      registryEntryId: connection.definition.registryEntryId,
      transport: connection.definition.transport,
      state: connection.state,
      stateLabel: MCP_CONNECTION_STATE_LABELS[connection.state],
      trust: connection.identity.trust,
      identityVerified: connection.identity.verified !== null,
      negotiatedProtocolVersion: connection.protocol?.negotiatedProtocolVersion ?? null,
      capabilitySnapshotId: connection.capabilitySnapshotId,
      approvedSnapshotId: connection.approvedSnapshotId,
      capabilityCounts: {
        tools: snapshot?.tools.length ?? 0,
        resources: snapshot?.resources.length ?? 0,
        prompts: snapshot?.prompts.length ?? 0,
      },
      lastVerifiedAt: connection.lastVerifiedAt,
      lastFailureCategory: connection.lastFailure?.category ?? null,
      simulation: input.simulationRegistryEntryIds.includes(connection.definition.registryEntryId),
    };
  });

  const permissionDecisions: Record<string, number> = {};
  const approvalDecisions: Record<string, number> = {};
  const evidenceReferences = new Set<string>();
  for (const record of input.audit) {
    permissionDecisions[record.permissionDecision] = (permissionDecisions[record.permissionDecision] ?? 0) + 1;
    const approvalKey = record.approvalRecordId === null ? 'no_approval_required' : 'approved';
    approvalDecisions[approvalKey] = (approvalDecisions[approvalKey] ?? 0) + 1;
    record.evidenceReferences.forEach((reference) => evidenceReferences.add(reference));
  }

  const limit = input.recentLimit ?? 25;
  const recentInvocations = [...input.audit]
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
    .slice(0, limit)
    .map((record) => ({
      invocationId: record.invocationId,
      capabilityKind: record.capabilityKind,
      capabilityName: record.capabilityName,
      riskClass: record.riskClass,
      permissionDecision: record.permissionDecision,
      invocationState: record.invocationState,
      approvalRecordId: record.approvalRecordId,
      evidenceReferences: record.evidenceReferences,
      failureCategory: record.failureCategory,
      requestedAt: record.requestedAt,
    }));

  return {
    configuredRequirements: [...new Set(input.connections.map((c) => c.definition.registryEntryId))].sort(),
    connectors,
    unavailableRequiredConnectors: (input.preflight?.findings ?? [])
      .filter((finding) => finding.blocking)
      .map((finding) => finding.registryEntryId),
    degradedConnectors: input.preflight?.degraded ?? [],
    permissionDecisions,
    approvalDecisions,
    recentInvocations,
    evidenceReferences: [...evidenceReferences].sort(),
    preflightReadiness: input.preflight?.readiness ?? null,
    preflightFindings: (input.preflight?.findings ?? []).map((finding) => `${finding.category}: ${finding.detail}`),
  };
}

/* ------------------------------------------------------------------ *
 * Trace claim kinds — claims and evidence, kept apart.
 * ------------------------------------------------------------------ */

export const MCP_TRACE_CLAIM_KINDS = [
  'mcp_connection_configured',
  'mcp_connection_ready',
  'mcp_connection_failed',
  'mcp_capability_snapshot_captured',
  'mcp_capability_snapshot_approved',
  'mcp_capability_changed',
  'mcp_permission_evaluated',
  'mcp_approval_requested',
  'mcp_approval_granted',
  'mcp_approval_refused',
  'mcp_invocation_requested',
  'mcp_invocation_completed',
  'mcp_invocation_refused',
  'mcp_invocation_failed',
  'mcp_evidence_stored',
  'mcp_preflight_evaluated',
] as const;
export type McpTraceClaimKind = (typeof MCP_TRACE_CLAIM_KINDS)[number];

/** A safe, append-only trace projection of one audit record. */
export interface McpTraceProjection {
  readonly claimKind: McpTraceClaimKind;
  readonly at: string;
  /** Flat, log-safe key/value pairs. Values are enums, ids and counts only. */
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly evidenceReferences: readonly string[];
}

export function projectAuditToTrace(record: McpAuditRecord): McpTraceProjection {
  const claimKind: McpTraceClaimKind =
    record.invocationState === 'completed' ? 'mcp_invocation_completed'
      : record.invocationState === 'denied' || record.invocationState === 'awaiting_approval' ? 'mcp_invocation_refused'
        : 'mcp_invocation_failed';
  return {
    claimKind,
    at: record.requestedAt,
    attributes: {
      invocationId: record.invocationId,
      connectionId: record.connectionId,
      serverName: record.serverName,
      serverTrust: record.serverTrust,
      transport: record.transport,
      negotiatedProtocolVersion: record.negotiatedProtocolVersion,
      capabilitySnapshotId: record.capabilitySnapshotId,
      capabilityFingerprint: record.capabilityFingerprint,
      capabilityKind: record.capabilityKind,
      capabilityName: record.capabilityName,
      argumentFingerprint: record.argumentFingerprint,
      riskClass: record.riskClass,
      permissionDecision: record.permissionDecision,
      approvalRecordId: record.approvalRecordId,
      invocationState: record.invocationState,
      cancelled: record.cancelled,
      timedOut: record.timedOut,
      failureCategory: record.failureCategory,
      resultBytes: record.safeResultSummary?.totalBytes ?? null,
      resultBlocks: record.safeResultSummary?.contentBlocks ?? null,
      redactionsApplied: record.safeResultSummary?.redactionsApplied ?? null,
      injectionSignals: record.safeResultSummary?.injectionSignals.join(',') ?? null,
      agentRole: record.agentRole,
      actualAgentId: record.actualAgentId,
    },
    evidenceReferences: record.evidenceReferences,
  };
}

/**
 * Structural safety check over any produced projection. Returns the reasons it
 * is unsafe; empty means clean.
 */
export function assertProjectionIsSafe(value: unknown): readonly string[] {
  const problems: string[] = [];
  problems.push(...forbiddenCredentialFieldsIn(value).map((field) => `forbidden credential field "${field}"`));
  const serialized = JSON.stringify(value) ?? '';
  if (containsSecretShapedText(serialized)) problems.push('the projection contains secret-shaped text');
  if (/\/(?:home|Users)\//.test(serialized)) problems.push('the projection contains a local home-directory path');
  return problems;
}

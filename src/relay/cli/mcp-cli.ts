/**
 * SUNDAY RELAY — CLI RENDERING FOR MCP MANAGEMENT.
 *
 * This module RENDERS. It makes no MCP policy decision, opens no connection,
 * resolves no credential and spawns nothing. Every value it prints comes out of
 * the shared projection in `src/relay/mcp/domain/mcp-surface-projection.ts`,
 * already worded — which is what keeps the terminal and the website from
 * drifting into two vocabularies for one product (governance §7).
 *
 * WHAT THE CLI IS STRUCTURALLY UNABLE TO PRINT. The projection types carry no
 * token, no header, no credential, no resolved executable path, no child
 * environment and no unrestricted tool result, so none of those can appear
 * here regardless of what a future edit does to the formatting. The one place
 * a path could have leaked — a stdio entry's launch identity — is the
 * executable NAME, which is policy, not host topology.
 *
 * TRUTHFULNESS OVER TIDINESS. Every simulated connector is labelled on its own
 * row, not once in a footer that scrolls away. §22 forbids claiming a live
 * integration, and a fixture that looks live for four rows and is disclaimed on
 * the fifth has already made the claim.
 */

import type {
  McpApprovalRow, McpCapabilitiesView, McpCatalogRow, McpConnectionRow,
} from '../mcp/domain/mcp-surface-projection';
import { MCP_APPROVAL_LABELS, MCP_PERMISSION_LABELS, MCP_RISK_LABELS } from '../mcp/domain/mcp-surface-projection';
import type { McpPreflightResult } from '../mcp/mission/mcp-mission-preflight';
import { preflightSummaryLine } from '../mcp/mission/mcp-mission-preflight';
import { EXIT } from './exit-codes';

export interface McpRenderOptions {
  readonly plain: boolean;
  readonly width: number;
}

const SIMULATION_TAG = '[SIMULATION FIXTURE — connects to no live service]';

const rule = (options: McpRenderOptions, length: number): string =>
  (options.plain ? '-' : '─').repeat(Math.max(20, Math.min(options.width - 2, length)));

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

/* ------------------------------------------------------------------ *
 * relay mcp catalog
 * ------------------------------------------------------------------ */

export function renderCatalog(rows: readonly McpCatalogRow[], options: McpRenderOptions): string[] {
  const lines: string[] = ['RELAY MCP CATALOG — curated registry entries', rule(options, 60)];
  if (rows.length === 0) {
    lines.push('  no curated registry entries');
    return lines;
  }
  lines.push(
    '  Private beta: only curated entries may be connected. There is no',
    '  arbitrary-server installation path and no marketplace.',
    '',
  );
  for (const row of rows) {
    lines.push(`  ${row.displayName}  [${row.registryEntryId}]`);
    lines.push(`    category           ${row.category}`);
    lines.push(`    state              ${row.state}${row.connectable ? '' : ' (NOT connectable)'}`);
    lines.push(`    transport          ${row.transport}`);
    lines.push(`    publisher          ${row.publisher}`);
    lines.push(`    server identity    ${row.expectedServerName}`);
    lines.push(`    launch identity    ${row.launchIdentity}`);
    lines.push(`    protocol (min)     ${row.minimumProtocolRevision}`);
    lines.push(`    maximum risk       ${MCP_RISK_LABELS[row.maximumRiskClass]}`);
    lines.push(`    credential         ${row.requiresCredential ? `required (${row.requiredScopes.join(', ') || 'scopes unspecified'})` : 'not required'}`);
    lines.push(`    security reviewed  ${yesNo(row.securityReviewed)}`);
    if (row.simulation) lines.push(`    ${SIMULATION_TAG}`);
    for (const note of row.notes) lines.push(`    note: ${note}`);
    lines.push('');
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * relay mcp connections
 * ------------------------------------------------------------------ */

export function renderConnections(rows: readonly McpConnectionRow[], options: McpRenderOptions): string[] {
  const lines: string[] = ['RELAY MCP CONNECTIONS', rule(options, 60)];
  if (rows.length === 0) {
    lines.push('  no MCP connections are configured in this workspace');
    return lines;
  }
  for (const row of rows) {
    lines.push(`  ${row.displayName}  [${row.connectionId}]`);
    lines.push(`    state       ${row.stateLabel}`);
    // The seven facts, never collapsed into one word.
    lines.push(
      `    configured=${yesNo(row.configured)}  reachable=${yesNo(row.reachable)}  ready=${yesNo(row.ready)}`
      + `  trusted=${yesNo(row.trusted)}  authorized=${yesNo(row.authorized)}`
      + `  degraded=${yesNo(row.degraded)}  capability-changed=${yesNo(row.capabilityChanged)}`,
    );
    lines.push(`    transport   ${row.transport}`);
    lines.push(`    protocol    requested ${row.requestedProtocolVersion ?? '—'} / negotiated ${row.negotiatedProtocolVersion ?? '—'}`);
    lines.push(`    identity    verified=${yesNo(row.identityVerified)} via ${row.verificationMethod}`);
    lines.push(`    snapshot    current ${row.capabilitySnapshotId ?? '—'} / approved ${row.approvedSnapshotId ?? '—'}`);
    lines.push(`    verified at ${row.lastVerifiedAt ?? 'never'}`);
    if (row.lastFailureCategory !== null) {
      lines.push(`    last failure ${row.lastFailureCategory}: ${row.lastFailureMessage ?? ''}`);
    }
    if (row.simulation) lines.push(`    ${SIMULATION_TAG}`);
    lines.push('');
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * relay mcp inspect <connection-id>
 * ------------------------------------------------------------------ */

export function renderInspect(row: McpConnectionRow | null, connectionId: string, options: McpRenderOptions): { lines: string[]; exitCode: number } {
  if (row === null) {
    return { lines: [`No MCP connection ${connectionId} is configured in this workspace.`], exitCode: EXIT.usage };
  }
  const lines = renderConnections([row], options);
  lines[0] = `RELAY MCP CONNECTION — ${row.displayName}`;
  return {
    lines,
    // A connection that is not ready is not a usage error, but it is not a
    // success either. `blocked` is the honest code.
    exitCode: row.ready ? EXIT.completed : EXIT.blocked,
  };
}

/* ------------------------------------------------------------------ *
 * relay mcp capabilities <connection-id>
 * ------------------------------------------------------------------ */

export function renderCapabilities(view: McpCapabilitiesView | null, connectionId: string, options: McpRenderOptions): { lines: string[]; exitCode: number } {
  if (view === null) {
    return {
      lines: [`No capability snapshot has been captured for connection ${connectionId}.`],
      exitCode: EXIT.blocked,
    };
  }
  const lines: string[] = [
    `RELAY MCP CAPABILITIES — ${view.serverName}`,
    rule(options, 60),
    `  snapshot     ${view.snapshotId}${view.approved ? ' (APPROVED for this mission)' : ' (NOT approved)'}`,
    `  protocol     ${view.negotiatedProtocolVersion}`,
    `  fingerprint  ${view.snapshotFingerprint}`,
    `  captured     ${view.capturedAt}`,
    '',
  ];
  if (view.rows.length === 0) {
    lines.push('  the server advertised no tools, resources or prompts');
    return { lines, exitCode: EXIT.completed };
  }
  for (const row of view.rows) {
    const risk = row.riskClass === null ? 'read only' : MCP_RISK_LABELS[row.riskClass];
    lines.push(`  [${row.kind}] ${row.name}`);
    lines.push(`      risk        ${risk}${row.requiresHumanApproval ? ' — HUMAN APPROVAL REQUIRED' : ''}`);
    if (row.annotationContradiction) {
      lines.push("      WARNING     the server's own annotations claim a safer operation than Relay's classification");
    }
    lines.push(`      fingerprint ${row.fingerprint}`);
    if (row.description !== '') lines.push(`      ${row.description}`);
  }
  return { lines, exitCode: EXIT.completed };
}

/* ------------------------------------------------------------------ *
 * relay mcp test-connection <connection-id>
 * ------------------------------------------------------------------ */

export interface McpTestConnectionOutcome {
  readonly connectionId: string;
  readonly reachable: boolean;
  readonly negotiatedProtocolVersion: string | null;
  readonly identityVerified: boolean;
  readonly failureCategory: string | null;
  readonly failureMessage: string | null;
  readonly simulation: boolean;
}

export function renderTestConnection(outcome: McpTestConnectionOutcome, options: McpRenderOptions): { lines: string[]; exitCode: number } {
  const lines: string[] = [
    `RELAY MCP CONNECTION TEST — ${outcome.connectionId}`,
    rule(options, 60),
    `  [${outcome.reachable ? 'PASS' : 'FAIL'}] transport reachable`,
    `  [${outcome.negotiatedProtocolVersion !== null ? 'PASS' : 'FAIL'}] protocol negotiated${outcome.negotiatedProtocolVersion !== null ? ` (${outcome.negotiatedProtocolVersion})` : ''}`,
    `  [${outcome.identityVerified ? 'PASS' : 'FAIL'}] server identity verified against its registry entry`,
  ];
  if (outcome.failureCategory !== null) {
    lines.push('', `  failure: ${outcome.failureCategory} — ${outcome.failureMessage ?? ''}`);
  }
  if (outcome.simulation) lines.push('', `  ${SIMULATION_TAG}`);
  const ok = outcome.reachable && outcome.negotiatedProtocolVersion !== null && outcome.identityVerified;
  lines.push('', ok ? '  CONNECTION TEST PASSED' : '  CONNECTION TEST FAILED');
  return { lines, exitCode: ok ? EXIT.completed : EXIT.doctorFailure };
}

/* ------------------------------------------------------------------ *
 * relay mcp approvals / approve / revoke
 * ------------------------------------------------------------------ */

export function renderApprovals(rows: readonly McpApprovalRow[], options: McpRenderOptions): string[] {
  const lines: string[] = ['RELAY MCP APPROVALS', rule(options, 60)];
  if (rows.length === 0) {
    lines.push('  no MCP approvals have been recorded');
    return lines;
  }
  for (const row of rows) {
    lines.push(`  ${row.capabilityKind} "${row.capabilityName}" on ${row.serverName}  [${row.approvalRecordId}]`);
    lines.push(`    policy      ${row.policy}`);
    lines.push(`    state       ${MCP_APPROVAL_LABELS[row.state] ?? row.state}${row.revoked ? ' (revoked)' : ''}`);
    lines.push(`    risk        ${MCP_RISK_LABELS[row.riskClass]}`);
    lines.push(`    for role    ${row.agentRole}`);
    lines.push(`    decided by  ${row.decidedByHumanId} at ${row.decidedAt}`);
    lines.push(`    expires     ${row.expiresAt ?? 'never'}`);
    lines.push(`    uses        ${row.usageCount} of ${row.maximumInvocations}`);
    lines.push(`    bound to    arguments ${row.argumentFingerprint}`);
    lines.push('');
  }
  return lines;
}

export function renderApprovalDecision(
  action: 'approve' | 'revoke',
  approvalId: string,
  outcome: { readonly ok: boolean; readonly reason: string },
): { lines: string[]; exitCode: number } {
  if (!outcome.ok) {
    return { lines: [`Could not ${action} ${approvalId}: ${outcome.reason}`], exitCode: EXIT.usage };
  }
  return {
    lines: [
      `Approval ${approvalId} ${action === 'approve' ? 'granted' : 'revoked'}.`,
      action === 'approve'
        ? '  It covers exactly the operation, arguments, agent, server and capability snapshot it was shown. It does not widen.'
        : '  Every future invocation relying on it will be refused.',
    ],
    exitCode: EXIT.completed,
  };
}

/* ------------------------------------------------------------------ *
 * relay mission mcp preflight <mission-id>
 * ------------------------------------------------------------------ */

export function renderMissionMcpPreflight(
  missionId: string,
  result: McpPreflightResult,
  options: McpRenderOptions,
): { lines: string[]; exitCode: number } {
  const lines: string[] = [
    `RELAY MISSION MCP PREFLIGHT — ${missionId}`,
    rule(options, 60),
    `  ${preflightSummaryLine(result)}`,
    '',
  ];
  for (const entry of result.satisfied) lines.push(`  [PASS] ${entry}`);
  for (const finding of result.findings) {
    lines.push(`  [${finding.blocking ? 'BLOCK' : 'WARN '}] ${finding.registryEntryId} — ${finding.category}`);
    lines.push(`          ${finding.detail}`);
  }
  lines.push('');
  if (result.readiness === 'blocked') {
    lines.push('  A required MCP connector is unavailable. Mission readiness is BLOCKED.');
  } else if (result.readiness === 'degraded') {
    lines.push('  Optional MCP connectors are unavailable. The mission may run in a DEGRADED state.');
  } else {
    lines.push('  Every required MCP connector is present, verified, approved and authorized.');
  }
  return {
    lines,
    exitCode: result.readiness === 'blocked' ? EXIT.blocked : EXIT.completed,
  };
}

/* ------------------------------------------------------------------ */

/** Help text fragment, merged into the CLI's own help. */
export const MCP_CLI_HELP: readonly string[] = Object.freeze([
  '  mcp catalog                      list curated MCP registry entries',
  '  mcp connections                  list configured MCP connections',
  '  mcp inspect <connection-id>      show one connection in full',
  '  mcp capabilities <connection-id> show the captured capability snapshot',
  '  mcp test-connection <id>         verify transport, protocol and identity',
  '  mcp approvals                    list recorded MCP approvals',
  '  mcp approve <approval-id>        grant a pending MCP approval',
  '  mcp revoke <approval-id>         revoke an MCP approval',
  '  mission mcp preflight <mission>  evaluate mission MCP readiness',
]);

export { MCP_PERMISSION_LABELS };

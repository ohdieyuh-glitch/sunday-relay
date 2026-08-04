import { useMemo } from 'react';

import './relay-mcp.css';

import {
  MCP_APPROVAL_LABELS, MCP_RISK_LABELS,
  type McpApprovalRow, type McpCapabilitiesView, type McpCatalogRow, type McpConnectionRow,
} from '../../mcp/domain/mcp-surface-projection';
import type { McpPreflightResult } from '../../mcp/mission/mcp-mission-preflight';
import { preflightSummaryLine } from '../../mcp/mission/mcp-mission-preflight';

/**
 * RELAY WORKSPACE → SETTINGS → MCP CONNECTIONS.
 *
 * FUNCTIONAL PARITY with `relay mcp …`: this component and
 * `src/relay/cli/mcp-cli.ts` render the SAME projection
 * (`mcp/domain/mcp-surface-projection.ts`), with the same labels for states,
 * risk classes, permission decisions and approval states. Neither surface
 * words anything for itself, so they cannot disagree about what "degraded" or
 * "trusted" means.
 *
 * THIS COMPONENT RECEIVES NO CREDENTIALS AND CANNOT. Its props are the
 * projection row types, which carry no token, no header, no credential
 * material, no resolved executable path and no unrestricted tool output. There
 * is no prop through which a secret could arrive, so there is no render path
 * on which one could leak — and no MCP transport, credential resolver or child
 * process is reachable from the browser bundle at all
 * (`src/relay/shared/browser-boundary.test.ts` enforces that).
 *
 * IT IS NOT A GENERIC SETTINGS DASHBOARD. Every row states the seven facts §21
 * requires kept distinct — configured, reachable, ready, trusted, authorized,
 * degraded, capability-changed — because collapsing them into one green dot is
 * how an operator ends up debugging a firewall when the problem was a policy.
 *
 * SIMULATION IS LABELLED PER ROW. Every registry entry in this milestone is a
 * fixture; a surface that showed one as a live integration would be making a
 * claim Relay cannot support.
 */

export interface RelayMcpConnectionsProps {
  readonly catalog: readonly McpCatalogRow[];
  readonly connections: readonly McpConnectionRow[];
  readonly capabilities: Readonly<Record<string, McpCapabilitiesView>>;
  readonly approvals: readonly McpApprovalRow[];
  readonly preflight: McpPreflightResult | null;
  readonly missionId: string | null;
  /** Registry entry ids a PSP Agent declared it requires. */
  readonly requiredByPsp: readonly string[];
  /**
   * OPTIONAL, AND THE CONTROL DOES NOT RENDER WITHOUT ONE.
   *
   * A button wired to `handler?.(id)` with no handler supplied is a control
   * that does nothing and says nothing — and on a security surface the worst
   * case is exact: an operator clicks `Revoke` on a live approval, sees no
   * error, and reasonably concludes a risk-bearing approval was revoked. That
   * is a lie told by an affordance. Each of these renders only when its handler
   * exists, so the mounted read-only projection shows no control at all rather
   * than a dead one.
   */
  readonly onReconnect?: (connectionId: string) => void;
  readonly onDisconnect?: (connectionId: string) => void;
  readonly onRevokeApproval?: (approvalRecordId: string) => void;
}

const YesNo = ({ label, value }: { label: string; value: boolean }): JSX.Element => (
  <span className={`rmcp-fact ${value ? 'is-yes' : 'is-no'}`} data-fact={label} data-value={value ? 'yes' : 'no'}>
    {label}
  </span>
);

export function RelayMcpConnections(props: RelayMcpConnectionsProps): JSX.Element {
  const requiredSet = useMemo(() => new Set(props.requiredByPsp), [props.requiredByPsp]);

  return (
    <section className="rmcp" aria-label="MCP connections">
      <header className="rmcp-head">
        <h2 className="rmcp-title">MCP CONNECTIONS</h2>
        <p className="rmcp-sub">
          Relay is the MCP host. Agents never connect to a server directly — every tool
          call, resource read and prompt fetch passes through the Relay MCP Gateway,
          which checks the capability snapshot, the risk class, the agent&rsquo;s permissions
          and any required human approval first.
        </p>
      </header>

      {/* ------------------------------ preflight ----------------------------- */}
      {props.preflight !== null && (
        <div className={`rmcp-preflight is-${props.preflight.readiness}`} role="status">
          <h3 className="rmcp-h3">MISSION PREFLIGHT{props.missionId !== null ? ` — ${props.missionId}` : ''}</h3>
          <p className="rmcp-preflight-line">{preflightSummaryLine(props.preflight)}</p>
          {props.preflight.findings.length > 0 && (
            <ul className="rmcp-findings">
              {props.preflight.findings.map((finding) => (
                <li key={`${finding.category}-${finding.registryEntryId}`} className={finding.blocking ? 'is-blocking' : 'is-warning'}>
                  <span className="rmcp-badge">{finding.blocking ? 'BLOCK' : 'WARN'}</span>
                  <span className="rmcp-finding-category">{finding.category}</span>
                  <span className="rmcp-finding-detail">{finding.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ----------------------------- connections ---------------------------- */}
      <h3 className="rmcp-h3">CONNECTIONS</h3>
      {props.connections.length === 0 ? (
        <p className="rmcp-empty">No MCP connections are configured in this workspace.</p>
      ) : (
        <ul className="rmcp-list">
          {props.connections.map((row) => {
            const view = props.capabilities[row.connectionId] ?? null;
            return (
              <li key={row.connectionId} className={`rmcp-card is-${row.state}`}>
                <div className="rmcp-card-head">
                  <span className="rmcp-name">{row.displayName}</span>
                  <span className="rmcp-state">{row.stateLabel}</span>
                </div>

                <div className="rmcp-facts">
                  <YesNo label="configured" value={row.configured} />
                  <YesNo label="reachable" value={row.reachable} />
                  <YesNo label="ready" value={row.ready} />
                  <YesNo label="trusted" value={row.trusted} />
                  <YesNo label="authorized" value={row.authorized} />
                  <YesNo label="degraded" value={row.degraded} />
                  <YesNo label="capability changed" value={row.capabilityChanged} />
                </div>

                <dl className="rmcp-meta">
                  <div><dt>Transport</dt><dd>{row.transport}</dd></div>
                  <div><dt>Protocol</dt><dd>requested {row.requestedProtocolVersion ?? '—'} / negotiated {row.negotiatedProtocolVersion ?? '—'}</dd></div>
                  <div><dt>Identity</dt><dd>{row.identityVerified ? `verified (${row.verificationMethod})` : 'not verified'}</dd></div>
                  <div><dt>Snapshot</dt><dd>current {row.capabilitySnapshotId ?? '—'} / approved {row.approvedSnapshotId ?? '—'}</dd></div>
                  <div><dt>Last verified</dt><dd>{row.lastVerifiedAt ?? 'never'}</dd></div>
                  {requiredSet.has(row.registryEntryId) && (
                    <div><dt>Required by PSP</dt><dd>yes</dd></div>
                  )}
                </dl>

                {row.capabilityChanged && (
                  <p className="rmcp-warning">
                    This server&rsquo;s capability surface changed after it was approved.
                    Invocation is paused until the new surface is reviewed and approved —
                    the previous approval is not carried forward.
                  </p>
                )}

                {row.lastFailureCategory !== null && (
                  <p className="rmcp-failure">
                    <span className="rmcp-badge">{row.lastFailureCategory}</span>
                    {row.lastFailureMessage}
                  </p>
                )}

                {view !== null && (
                  <details className="rmcp-caps">
                    <summary>
                      Capabilities — {view.rows.length} ({view.approved ? 'approved' : 'not approved'})
                    </summary>
                    <ul className="rmcp-cap-list">
                      {view.rows.map((cap) => (
                        <li key={`${cap.kind}:${cap.name}`}>
                          <span className="rmcp-cap-kind">{cap.kind}</span>
                          <span className="rmcp-cap-name">{cap.name}</span>
                          <span className={`rmcp-risk is-${cap.riskClass ?? 'read_only'}`}>
                            {cap.riskClass === null ? MCP_RISK_LABELS.read_only : MCP_RISK_LABELS[cap.riskClass]}
                          </span>
                          {cap.requiresHumanApproval && <span className="rmcp-approval-flag">approval required</span>}
                          {cap.annotationContradiction && (
                            <span className="rmcp-contradiction">
                              server annotation claims a safer operation than Relay&rsquo;s classification
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {row.simulation && (
                  <p className="rmcp-simulation">SIMULATION FIXTURE — connects to no live service.</p>
                )}

                {(props.onReconnect !== undefined || props.onDisconnect !== undefined) && (
                  <div className="rmcp-actions">
                    {props.onReconnect !== undefined && (
                      <button type="button" onClick={() => props.onReconnect?.(row.connectionId)}>Reconnect</button>
                    )}
                    {props.onDisconnect !== undefined && (
                      <button type="button" onClick={() => props.onDisconnect?.(row.connectionId)}>Disconnect</button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ------------------------------ approvals ----------------------------- */}
      <h3 className="rmcp-h3">APPROVALS</h3>
      {props.approvals.length === 0 ? (
        <p className="rmcp-empty">No MCP approvals have been recorded.</p>
      ) : (
        <ul className="rmcp-list">
          {props.approvals.map((row) => (
            <li key={row.approvalRecordId} className="rmcp-card rmcp-approval">
              <div className="rmcp-card-head">
                <span className="rmcp-name">{row.capabilityKind} &ldquo;{row.capabilityName}&rdquo; on {row.serverName}</span>
                <span className="rmcp-state">{MCP_APPROVAL_LABELS[row.state] ?? row.state}</span>
              </div>
              <dl className="rmcp-meta">
                <div><dt>Policy</dt><dd>{row.policy}</dd></div>
                <div><dt>Risk</dt><dd>{MCP_RISK_LABELS[row.riskClass]}</dd></div>
                <div><dt>Role</dt><dd>{row.agentRole}</dd></div>
                <div><dt>Decided by</dt><dd>{row.decidedByHumanId} at {row.decidedAt}</dd></div>
                <div><dt>Expires</dt><dd>{row.expiresAt ?? 'never'}</dd></div>
                <div><dt>Uses</dt><dd>{row.usageCount} of {row.maximumInvocations}</dd></div>
                <div><dt>Bound to arguments</dt><dd className="rmcp-fingerprint">{row.argumentFingerprint}</dd></div>
              </dl>
              <p className="rmcp-note">
                This approval covers exactly the operation, arguments, agent, server and
                capability snapshot it was shown. It does not widen.
              </p>
              {props.onRevokeApproval !== undefined && (
                <div className="rmcp-actions">
                  <button type="button" onClick={() => props.onRevokeApproval?.(row.approvalRecordId)} disabled={row.revoked}>
                    {row.revoked ? 'Revoked' : 'Revoke'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------- registry ----------------------------- */}
      <h3 className="rmcp-h3">REGISTRY</h3>
      <p className="rmcp-sub">
        Private beta: only curated entries may be connected. There is no
        arbitrary-server installation path and no marketplace.
      </p>
      <ul className="rmcp-list">
        {props.catalog.map((row) => (
          <li key={row.registryEntryId} className={`rmcp-card rmcp-catalog is-${row.state}`}>
            <div className="rmcp-card-head">
              <span className="rmcp-name">{row.displayName}</span>
              <span className="rmcp-state">{row.state}{row.connectable ? '' : ' — not connectable'}</span>
            </div>
            <dl className="rmcp-meta">
              <div><dt>Category</dt><dd>{row.category}</dd></div>
              <div><dt>Transport</dt><dd>{row.transport}</dd></div>
              <div><dt>Publisher</dt><dd>{row.publisher}</dd></div>
              <div><dt>Server identity</dt><dd>{row.expectedServerName}</dd></div>
              <div><dt>Launch identity</dt><dd>{row.launchIdentity}</dd></div>
              <div><dt>Protocol (min)</dt><dd>{row.minimumProtocolRevision}</dd></div>
              <div><dt>Maximum risk</dt><dd>{MCP_RISK_LABELS[row.maximumRiskClass]}</dd></div>
              <div><dt>Credential</dt><dd>{row.requiresCredential ? (row.requiredScopes.join(', ') || 'required') : 'not required'}</dd></div>
              <div><dt>Security reviewed</dt><dd>{row.securityReviewed ? 'yes' : 'no'}</dd></div>
              {requiredSet.has(row.registryEntryId) && <div><dt>Required by PSP</dt><dd>yes</dd></div>}
            </dl>
            {row.simulation && (
              <p className="rmcp-simulation">SIMULATION FIXTURE — connects to no live service.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

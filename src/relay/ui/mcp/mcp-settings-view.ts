/**
 * THE MOUNTED MCP SURFACE'S ONE INPUT (PURE).
 *
 * `RelayMcpConnections` renders the shared projection
 * (`mcp/domain/mcp-surface-projection.ts`). This module is the only thing
 * between a settings HOST and that component: it turns whatever MCP state the
 * host genuinely has into the projection rows the component already renders,
 * and it turns the ABSENCE of that state into a stated reason rather than an
 * empty list that reads like a finding.
 *
 * WHY A SEPARATE MODULE RATHER THAN HOST CODE. The host is
 * `RelayPreviewApp.tsx`, a browser shell. If it built these rows itself, the
 * shell would be the second place that decides what a connection row means,
 * and the CLI would be the first — which is the exact drift the shared
 * projection exists to prevent (governance §7). The host supplies state; this
 * module projects it; the component renders it; the CLI renders the same rows
 * from the same functions.
 *
 * WHAT IT REFUSES TO INVENT. With no connection state, `connections`,
 * `approvals` and `capabilities` are EMPTY and `preflight` is `null` — not a
 * placeholder connection, not a fabricated "ready" row, not a zeroed preflight
 * that would read as "evaluated, and fine". The registry catalog is the only
 * thing the browser genuinely knows, and every entry in it is a simulation
 * fixture that says so on its own row.
 *
 * IT CARRIES NO CREDENTIAL AND CAN CARRY NONE. Every type here is a projection
 * row type or a registry entry; none of them has a token, header, credential,
 * resolved executable path or unrestricted result field. No MCP transport,
 * connection manager or fake server is imported — those live behind
 * `mcp/transports/`, `mcp/client/` and `mcp/testing/`, which
 * `src/relay/shared/browser-boundary.test.ts` forbids a browser entry from
 * reaching at all.
 */

import {
  MCP_FORBIDDEN_ROLES, MCP_REGISTRY_FIXTURES,
  projectApprovals, projectCatalog, projectConnections,
  type McpApprovalRecord, type McpApprovalRow, type McpCapabilitiesView,
  type McpCatalogRow, type McpConnection, type McpConnectionRow,
  type McpPreflightResult, type McpRegistryEntry,
} from '../../mcp';

/**
 * Whether the host has an MCP surface to show at all.
 *
 * `unavailable` is a FIRST-CLASS state, not an error: a host that cannot read
 * MCP state must say so. Rendering an empty connection list in that case would
 * claim Relay looked and found nothing configured, which is a different fact.
 */
export type RelayMcpSurfaceStatus = 'loading' | 'ready' | 'unavailable';

/** Exactly the projection rows `RelayMcpConnections` renders. */
export interface RelayMcpSettingsView {
  readonly catalog: readonly McpCatalogRow[];
  readonly connections: readonly McpConnectionRow[];
  readonly capabilities: Readonly<Record<string, McpCapabilitiesView>>;
  readonly approvals: readonly McpApprovalRow[];
  readonly preflight: McpPreflightResult | null;
  readonly missionId: string | null;
  readonly requiredByPsp: readonly string[];
}

export interface RelayMcpSettingsState {
  readonly status: RelayMcpSurfaceStatus;
  /** Stated whenever `status` is `unavailable`; `null` otherwise. */
  readonly unavailableReason: string | null;
  /** Present only when `status` is `ready`. */
  readonly view: RelayMcpSettingsView | null;
}

export interface RelayMcpSettingsInput {
  /** Defaults to the curated registry — the one thing a browser truly knows. */
  readonly registry?: readonly McpRegistryEntry[];
  readonly connections?: readonly McpConnection[];
  readonly approvals?: readonly McpApprovalRecord[];
  readonly capabilities?: Readonly<Record<string, McpCapabilitiesView>>;
  readonly preflight?: McpPreflightResult | null;
  readonly missionId?: string | null;
  /** Registry entry ids a PSP Agent declared it requires. */
  readonly requiredByPsp?: readonly string[];
}

const EMPTY_CAPABILITIES: Readonly<Record<string, McpCapabilitiesView>> = Object.freeze({});

/**
 * The roles that receive no MCP access under any configuration, read from the
 * policy layer rather than restated here. A surface that hard-coded the
 * sentence could keep promising an isolation the policy had stopped enforcing.
 */
export const RELAY_MCP_DENIED_ROLES: readonly string[] = MCP_FORBIDDEN_ROLES;

export const RELAY_MCP_REVIEWER_DENIAL_NOTICE =
  'The Independent Reviewer receives NO MCP connection, tool, resource or prompt — '
  + 'under any configuration, and with no setting on this page that changes it. '
  + 'A reviewing role holding a tool is a channel from the work back into its own review.';

/**
 * Why the browser cannot open a connection, stated on the surface that would
 * otherwise imply it could. Connection management drives child processes and
 * sockets; it is server-side and structurally unreachable from this bundle.
 */
export const RELAY_MCP_BROWSER_LIMIT_NOTICE =
  'Connections are opened by the Relay host process, never by this browser: the MCP '
  + 'transports, the connection manager and every credential path are server-side and '
  + 'are not part of this bundle.';

/** The host is still resolving MCP state. Nothing is claimed while it does. */
export function mcpSettingsLoading(): RelayMcpSettingsState {
  return { status: 'loading', unavailableReason: null, view: null };
}

/** The host has no MCP surface, and says which. */
export function mcpSettingsUnavailable(reason: string): RelayMcpSettingsState {
  return { status: 'unavailable', unavailableReason: reason, view: null };
}

/**
 * Project whatever MCP state the host holds into the shared rows.
 *
 * Every field is optional and every default is the honest empty one, so a host
 * with no connection state produces a surface that shows the curated registry
 * and says plainly that nothing is connected.
 */
export function buildRelayMcpSettingsView(input: RelayMcpSettingsInput = {}): RelayMcpSettingsState {
  const registry = input.registry ?? MCP_REGISTRY_FIXTURES;
  return {
    status: 'ready',
    unavailableReason: null,
    view: {
      catalog: projectCatalog(registry),
      connections: projectConnections(input.connections ?? [], registry),
      capabilities: input.capabilities ?? EMPTY_CAPABILITIES,
      approvals: projectApprovals(input.approvals ?? []),
      preflight: input.preflight ?? null,
      missionId: input.missionId ?? null,
      requiredByPsp: input.requiredByPsp ?? [],
    },
  };
}

/**
 * The readiness word the section reports at the top level.
 *
 * `not_evaluated` is deliberately distinct from `ready`: no mission has asked
 * for MCP preflight, which is not the same as a preflight that passed.
 */
export function mcpSurfaceReadiness(state: RelayMcpSettingsState): string {
  return state.view?.preflight?.readiness ?? 'not_evaluated';
}

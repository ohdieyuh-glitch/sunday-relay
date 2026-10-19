import { RelayMcpConnections } from '../mcp';
import {
  RELAY_MCP_BROWSER_LIMIT_NOTICE, RELAY_MCP_DENIED_ROLES, RELAY_MCP_REVIEWER_DENIAL_NOTICE,
  mcpSurfaceReadiness, type RelayMcpSettingsState,
} from '../mcp';

/**
 * SECTION 14 — MCP CONNECTIONS, mounted inside the real Project Settings host.
 *
 * This is the seam, and it is deliberately thin. It decides ONE thing — whether
 * there is an MCP surface to render at all — and delegates everything else to
 * `RelayMcpConnections`, which renders the shared projection the CLI renders.
 * A seam that reformatted rows here would be a second vocabulary for one
 * product; this one adds no row, no label and no state word of its own.
 *
 * THE FOUR STATES IT MUST NOT CONFLATE:
 *
 *   loading      the host is still resolving MCP state. Nothing is claimed.
 *   unavailable  the host has no MCP surface, and says why. NOT an empty list:
 *                "Relay looked and found nothing configured" is a different
 *                fact from "Relay could not look."
 *   ready/empty  Relay looked. The curated registry is shown, and the
 *                connection and approval lists say plainly that they are empty.
 *   degraded /   a mission preflight reached a verdict. The verdict is on the
 *   blocked      surface, and `data-mcp-readiness` carries it at section level
 *                so a host test can assert what the operator was actually told.
 *
 * WHAT IT SAYS THAT THE COMPONENT ALONE CANNOT. Mounted in Project Settings,
 * this section sits next to PERMISSIONS and VERIFICATION, where an operator
 * reasonably expects to be able to grant something. Two things must therefore
 * be stated HERE, not inferred: the Independent Reviewer is permanently denied
 * MCP and no control on this page changes that, and the browser cannot open a
 * connection at all because every transport and credential path is server-side.
 */

const HOST_DID_NOT_PROVIDE =
  'This settings host did not provide an MCP surface, so Relay is showing none. '
  + 'An empty connection list here would claim Relay checked this workspace and found '
  + 'nothing connected, which is not what happened.';

const ABSENT: RelayMcpSettingsState = {
  status: 'unavailable',
  unavailableReason: HOST_DID_NOT_PROVIDE,
  view: null,
};

export function SectionMcp({ mcp }: { mcp?: RelayMcpSettingsState }) {
  const state = mcp ?? ABSENT;
  const readiness = mcpSurfaceReadiness(state);

  return (
    <div
      className="rps-section-body rps-mcp"
      data-mcp-status={state.status}
      data-mcp-readiness={readiness}
    >
      <p className="rps-hint rps-mcp-denial" data-mcp-reviewer-denied="true">
        {RELAY_MCP_REVIEWER_DENIAL_NOTICE}
        {' '}
        Permanently denied roles: {RELAY_MCP_DENIED_ROLES.join(', ')}.
      </p>
      <p className="rps-hint rps-mcp-browser-limit">{RELAY_MCP_BROWSER_LIMIT_NOTICE}</p>

      {state.status === 'loading' && (
        <p className="rps-hint rps-mcp-loading" role="status">
          Loading MCP connections… Relay shows nothing until it has read this workspace&rsquo;s
          real MCP state.
        </p>
      )}

      {state.status === 'unavailable' && (
        <p className="rps-hint rps-mcp-unavailable" role="status">
          MCP connections are unavailable. {state.unavailableReason}
        </p>
      )}

      {state.status === 'ready' && state.view !== null && (
        <RelayMcpConnections
          catalog={state.view.catalog}
          connections={state.view.connections}
          capabilities={state.view.capabilities}
          approvals={state.view.approvals}
          preflight={state.view.preflight}
          missionId={state.view.missionId}
          requiredByPsp={state.view.requiredByPsp}
        />
      )}
    </div>
  );
}

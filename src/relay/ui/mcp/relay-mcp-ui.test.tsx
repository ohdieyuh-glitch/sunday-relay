/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import {
  MCP_APPROVAL_LABELS, MCP_PERMISSION_LABELS, MCP_RISK_LABELS,
  projectApprovals, projectCapabilities, projectCatalog, projectConnections,
} from '../../mcp/domain/mcp-surface-projection';
import { MCP_REGISTRY_FIXTURES } from '../../mcp/registry/mcp-registry-fixtures';
import { runMcpMissionPreflight } from '../../mcp/mission/mcp-mission-preflight';
import {
  buildApproval, buildConnection, buildSnapshot, memorySnapshotStore,
  READ_FILE_TOOL_RAW, TEST_NOW,
} from '../../mcp/testing/mcp-test-fixtures';
import { RelayMcpConnections } from './RelayMcpConnections';

/**
 * WEBSITE ↔ CLI PARITY for MCP.
 *
 * The component renders the SAME projection the CLI renders
 * (`mcp/domain/mcp-surface-projection.ts`) with the SAME labels. These tests
 * assert what the surface must show and — more importantly — what it must never
 * be able to show.
 */

afterEach(() => cleanup());

const catalog = projectCatalog(MCP_REGISTRY_FIXTURES);
const connections = projectConnections([buildConnection()], MCP_REGISTRY_FIXTURES);
const snapshot = buildSnapshot({ tools: [READ_FILE_TOOL_RAW] });
const capabilities = {
  [connections[0]!.connectionId]: projectCapabilities(snapshot, true, () => ({
    riskClass: 'read_only' as const,
    annotationContradiction: false,
    requiresHumanApproval: false,
  })),
};
const approvals = projectApprovals([buildApproval()]);

const preflight = runMcpMissionPreflight({
  binding: {
    missionBindingId: 'mcb_ui' as never,
    missionId: 'msn-ui',
    accountId: 'a',
    workspaceId: 'w',
    projectId: null,
    requirements: [{
      registryEntryId: 'mrg_fixture_filesystem_repository',
      required: true,
      capabilities: [],
      requiredScopes: [],
      preApprovedOperations: [],
      minimumProtocolRevision: '2025-11-25',
    }],
    approvedSnapshots: {},
    writablePathPrefixes: [],
    createdAt: TEST_NOW,
  },
  registry: MCP_REGISTRY_FIXTURES,
  connections: [],
  snapshots: memorySnapshotStore(),
  credentials: [],
  grants: [],
  approvals: [],
  networkPolicyAllows: () => true,
  now: TEST_NOW,
});

const renderSurface = (overrides: Partial<Parameters<typeof RelayMcpConnections>[0]> = {}) => render(
  <RelayMcpConnections
    catalog={catalog}
    connections={connections}
    capabilities={capabilities}
    approvals={approvals}
    preflight={preflight}
    missionId="msn-ui"
    requiredByPsp={['mrg_fixture_filesystem_repository']}
    {...overrides}
  />,
);

describe('the MCP connections surface', () => {
  it('states that Relay is the host and agents never connect directly', () => {
    renderSurface();
    expect(screen.getByText(/Relay is the MCP host/i)).toBeTruthy();
    expect(screen.getByText(/never connect to a server directly/i)).toBeTruthy();
  });

  it('renders the seven facts as SEPARATE values, never one status', () => {
    const { container } = renderSurface();
    for (const fact of ['configured', 'reachable', 'ready', 'trusted', 'authorized', 'degraded', 'capability changed']) {
      expect(container.querySelector(`[data-fact="${fact}"]`), fact).not.toBeNull();
    }
  });

  it('marks a ready connection as ready and trusted', () => {
    const { container } = renderSurface();
    expect(container.querySelector('[data-fact="ready"]')?.getAttribute('data-value')).toBe('yes');
    expect(container.querySelector('[data-fact="trusted"]')?.getAttribute('data-value')).toBe('yes');
    expect(container.querySelector('[data-fact="capability changed"]')?.getAttribute('data-value')).toBe('no');
  });

  it('warns explicitly when a capability surface changed, and says approval is not carried forward', () => {
    renderSurface({
      connections: projectConnections([buildConnection({ state: 'capability_changed' })], MCP_REGISTRY_FIXTURES),
    });
    expect(screen.getByText(/Invocation is paused/i)).toBeTruthy();
    expect(screen.getByText(/previous approval is not carried forward/i)).toBeTruthy();
  });

  it('labels EVERY simulated connector and registry entry', () => {
    renderSurface();
    const labels = screen.getAllByText(/SIMULATION FIXTURE/);
    // one per connection row plus one per catalog row
    expect(labels.length).toBe(connections.length + catalog.length);
  });

  it('states the private-beta registry policy', () => {
    renderSurface();
    expect(screen.getByText(/only curated entries may be connected/i)).toBeTruthy();
    expect(screen.getByText(/no marketplace/i)).toBeTruthy();
  });

  it('shows the mission preflight verdict and every blocking finding', () => {
    renderSurface();
    expect(screen.getByText(/MCP preflight: BLOCKED/)).toBeTruthy();
    expect(screen.getByText('required_connection_missing')).toBeTruthy();
    expect(screen.getAllByText('BLOCK').length).toBeGreaterThan(0);
  });

  it('states that an approval does not widen, and shows what it is bound to', () => {
    renderSurface();
    expect(screen.getByText(/It does not widen/i)).toBeTruthy();
    expect(screen.getByText(/mcpfp1:/)).toBeTruthy();
  });

  it('marks which connectors a PSP Agent requires', () => {
    renderSurface();
    expect(screen.getAllByText('Required by PSP').length).toBeGreaterThan(0);
  });

  it('offers Reconnect and Disconnect WHEN A HOST CAN ACTUALLY PERFORM THEM', () => {
    // The previous version of this test rendered the surface with no handlers
    // and asserted the buttons existed. That is exactly what the independent
    // review objected to: a control wired to `handler?.(id)` with no handler is
    // a silent no-op, and the test was the thing certifying it as present.
    const onReconnect = vi.fn();
    const onDisconnect = vi.fn();
    renderSurface({ onReconnect, onDisconnect });
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    // Wired, not merely rendered.
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('offers NEITHER when the host supplies no handler', () => {
    renderSurface();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: /revoke/i })).toBeNull();
  });

  it('shows requested AND negotiated protocol separately', () => {
    renderSurface();
    expect(screen.getByText(/requested 2025-11-25 \/ negotiated 2025-11-25/)).toBeTruthy();
  });
});

describe('the surface cannot display a secret or host topology', () => {
  it('renders no token, header, credential or absolute local path', () => {
    const { container } = renderSurface();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/ghp_|sk-ant-|sk-proj-|Bearer |Authorization:/);
    expect(text).not.toMatch(/\/home\/|\/Users\/|\/usr\/bin/);
  });

  it('renders no VITE_-prefixed value', () => {
    const { container } = renderSurface();
    expect(container.textContent ?? '').not.toContain('VITE_');
  });
});

describe('label parity with the CLI', () => {
  it('uses ONE wording for risk, permission and approval, shared with the terminal', () => {
    // These maps are the single source both surfaces render from. If a label
    // is edited on one surface only, it is edited here and both change.
    expect(MCP_RISK_LABELS.unknown).toContain('UNKNOWN');
    expect(MCP_RISK_LABELS.external_write).toBe('external write');
    expect(MCP_PERMISSION_LABELS.requires_approval).toBe('human approval required');
    expect(MCP_APPROVAL_LABELS.exhausted).toBe('exhausted');
  });

  it('renders a risk label from the shared map', () => {
    renderSurface();
    const caps = screen.getByText(/Capabilities —/);
    expect(within(caps.closest('details')!).getByText(MCP_RISK_LABELS.read_only)).toBeTruthy();
  });
});

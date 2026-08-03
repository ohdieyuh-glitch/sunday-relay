/** @vitest-environment jsdom */
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayProjectSettings } from './RelayProjectSettings';
import { AGENT_OPTIONS } from './options';
import { buildProjectBriefDraft } from '../entry-home/project-brief';
import type { RelayProjectSettingsProps } from './contracts';
import {
  RELAY_MCP_DENIED_ROLES,
  buildRelayMcpSettingsView, mcpSettingsLoading, mcpSettingsUnavailable,
} from '../mcp';
import { MCP_FORBIDDEN_ROLES, MCP_REGISTRY_FIXTURES, runMcpMissionPreflight } from '../../mcp';
import type { McpMissionRequirement, McpPreflightResult } from '../../mcp';
import { TEST_NOW, buildConnection } from '../../mcp/testing/mcp-test-fixtures';

/**
 * MCP CONNECTIONS, MOUNTED IN THE REAL PROJECT SETTINGS HOST.
 *
 * `relay-mcp-ui.test.tsx` proves the component renders the shared projection.
 * That is not the same claim as this file's: a component can be complete,
 * styled and fully tested while no running surface reaches it — which is
 * exactly what was true of `RelayMcpConnections` until this change. These
 * tests exercise `RelayProjectSettings` itself, so what they assert is what a
 * settings host actually renders.
 *
 * The four states are asserted SEPARATELY and are never allowed to collapse
 * into each other: `unavailable` (Relay could not look) must not be reachable
 * as an empty list (Relay looked and found nothing), and `not_evaluated` must
 * not be reachable as a preflight `ready`.
 *
 * These tests run in jsdom on a 2-core box that also hosts other Relay
 * sessions; every case gets a wide budget so a slow machine reports a slow
 * machine, not a failing rule.
 */

const it = (name: string, fn: () => void | Promise<void>) => baseIt(name, fn, 120000);

afterEach(cleanup);

const brief = buildProjectBriefDraft('Build a usage dashboard for AI developers', null);

function setup(overrides: Partial<RelayProjectSettingsProps> = {}) {
  const props: RelayProjectSettingsProps = {
    brief,
    agentOptions: AGENT_OPTIONS,
    entitlement: 'pro',
    onSaveDraft: vi.fn(),
    onStartProject: vi.fn(),
    onConnectRepository: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(createElement(RelayProjectSettings, props));
  return props;
}

/** Click the section rail exactly as an operator would. */
const openMcpSection = () => {
  fireEvent.click(screen.getByRole('button', { name: /14\s*MCP\s*CONNECTIONS/ }));
};

const section = (): HTMLElement => {
  const node = document.querySelector('[data-mcp-status]');
  if (node === null) throw new Error('the MCP section did not render');
  return node as HTMLElement;
};

/** The shell's own numbered eyebrow. Some sections render a `role="status"` of
 *  their own, so this reads the shell's element rather than a role query. */
const eyebrow = (): string => document.querySelector('.rps-section-eyebrow')?.textContent ?? '';

/* --------------------------------------------------------- preflights */

const requirement = (required: boolean): McpMissionRequirement => ({
  registryEntryId: 'mrg_fixture_filesystem_repository',
  required,
  capabilities: [],
  requiredScopes: [],
  preApprovedOperations: [],
  minimumProtocolRevision: '2025-11-25',
});

/** A REAL preflight run — no hand-built verdict object. */
function preflightWith(required: boolean): McpPreflightResult {
  return runMcpMissionPreflight({
    binding: {
      missionBindingId: 'mcb_settings' as never,
      missionId: 'msn-settings',
      accountId: 'a',
      workspaceId: 'w',
      projectId: null,
      requirements: [requirement(required)],
      approvedSnapshots: {},
      writablePathPrefixes: [],
      createdAt: TEST_NOW,
    },
    registry: MCP_REGISTRY_FIXTURES,
    connections: [],
    snapshots: { get: () => null },
    credentials: [],
    grants: [],
    approvals: [],
    networkPolicyAllows: () => true,
    now: TEST_NOW,
  });
}

/* ------------------------------------------------------- the mounting */

describe('MCP Connections is reachable through the real Project Settings host', () => {
  it('the section rail offers 14 MCP CONNECTIONS and 15 REVIEW AND START', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    expect(screen.getByRole('button', { name: /14\s*MCP\s*CONNECTIONS/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /15\s*REVIEW\s*AND\s*START/ })).toBeTruthy();
  });

  it('clicking that rail entry renders the MCP connections surface itself', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    expect(document.querySelector('[aria-label="MCP connections"]')).toBeNull();

    openMcpSection();

    const surface = document.querySelector('[aria-label="MCP connections"]');
    expect(surface, 'the mounted host must render RelayMcpConnections, not a placeholder').toBeTruthy();
    expect(surface!.textContent).toContain('Relay is the MCP host');
    expect(section().getAttribute('data-mcp-status')).toBe('ready');
  });

  it('renders the curated registry the CLI catalog renders — every entry, by name', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    openMcpSection();
    const text = section().textContent ?? '';
    for (const entry of MCP_REGISTRY_FIXTURES) {
      expect(text, `the mounted catalog omits ${entry.registryEntryId}`).toContain(entry.displayName);
    }
  });

  it('the eyebrow reports section 14 of 15', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    openMcpSection();
    expect(eyebrow()).toContain('14 / 15');
  });
});

/* ------------------------------------------------------- the 4 states */

describe('the mounted section keeps its states distinct', () => {
  it('LOADING claims nothing — no catalog, no connection list', () => {
    setup({ mcp: mcpSettingsLoading() });
    openMcpSection();
    expect(section().getAttribute('data-mcp-status')).toBe('loading');
    expect(section().textContent).toContain('Loading MCP connections');
    expect(document.querySelector('[aria-label="MCP connections"]')).toBeNull();
    expect(section().textContent).not.toContain('No MCP connections are configured');
  });

  it('UNAVAILABLE states the reason and is NOT rendered as an empty list', () => {
    setup({ mcp: mcpSettingsUnavailable('the workspace MCP store could not be read') });
    openMcpSection();
    expect(section().getAttribute('data-mcp-status')).toBe('unavailable');
    expect(section().textContent).toContain('the workspace MCP store could not be read');
    // "Relay could not look" must never be shown as "Relay looked and found none".
    expect(section().textContent).not.toContain('No MCP connections are configured');
    expect(document.querySelector('[aria-label="MCP connections"]')).toBeNull();
  });

  it('a host that supplies no MCP state at all gets UNAVAILABLE, never a fabricated empty surface', () => {
    setup();
    openMcpSection();
    expect(section().getAttribute('data-mcp-status')).toBe('unavailable');
    expect(section().textContent).toContain('did not provide an MCP surface');
    expect(document.querySelector('[aria-label="MCP connections"]')).toBeNull();
  });

  it('EMPTY is truthful: the registry is shown and nothing is claimed connected', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    openMcpSection();
    expect(section().getAttribute('data-mcp-status')).toBe('ready');
    expect(section().textContent).toContain('No MCP connections are configured in this workspace.');
    expect(section().textContent).toContain('No MCP approvals have been recorded.');
    // No mission asked for preflight; that is NOT a preflight that passed.
    expect(section().getAttribute('data-mcp-readiness')).toBe('not_evaluated');
    expect(section().textContent).not.toContain('MCP preflight: READY');
  });

  it('DEGRADED surfaces the real verdict and its non-blocking finding', () => {
    const preflight = preflightWith(false);
    expect(preflight.readiness).toBe('degraded');
    setup({ mcp: buildRelayMcpSettingsView({ preflight, missionId: 'msn-settings' }) });
    openMcpSection();
    expect(section().getAttribute('data-mcp-readiness')).toBe('degraded');
    expect(section().textContent).toContain('MCP preflight: DEGRADED');
    expect(section().textContent).toContain('the mission may proceed without it');
    expect(section().querySelector('.is-warning')).toBeTruthy();
    expect(section().querySelector('.is-blocking')).toBeNull();
  });

  it('BLOCKED surfaces the real verdict and its blocking finding', () => {
    const preflight = preflightWith(true);
    expect(preflight.readiness).toBe('blocked');
    setup({ mcp: buildRelayMcpSettingsView({ preflight, missionId: 'msn-settings' }) });
    openMcpSection();
    expect(section().getAttribute('data-mcp-readiness')).toBe('blocked');
    expect(section().textContent).toContain('MCP preflight: BLOCKED');
    expect(section().querySelector('.is-blocking')).toBeTruthy();
  });
});

/* -------------------------------------------------- simulation labels */

describe('simulation labelling survives the mount', () => {
  it('every catalog row that is a fixture says so ON THAT ROW', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    openMcpSection();
    const rows = section().querySelectorAll('.rmcp-catalog');
    expect(rows.length).toBe(MCP_REGISTRY_FIXTURES.length);
    for (const row of Array.from(rows)) {
      expect(row.textContent, 'a fixture row must label itself').toContain(
        'SIMULATION FIXTURE — connects to no live service.',
      );
    }
  });

  it('a connection row is labelled too, not just the catalog', () => {
    setup({
      mcp: buildRelayMcpSettingsView({ connections: [buildConnection()] }),
    });
    openMcpSection();
    const connectionRows = Array.from(section().querySelectorAll('.rmcp-card'))
      .filter((node) => !node.classList.contains('rmcp-catalog') && !node.classList.contains('rmcp-approval'));
    expect(connectionRows.length).toBe(1);
    expect(connectionRows[0]!.textContent).toContain('SIMULATION FIXTURE');
  });

  it('the whole registry is simulation in this milestone, and the surface never says otherwise', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    openMcpSection();
    expect(MCP_REGISTRY_FIXTURES.every((entry) => entry.simulation)).toBe(true);
    const text = section().textContent ?? '';
    expect(text).not.toContain('live connector');
    expect(text).not.toMatch(/connected to (github|a live)/i);
  });
});

/* ------------------------------------------------------ reviewer deny */

describe('the Reviewer is permanently denied, and the settings surface says so', () => {
  it('states the denial on the section, in every state', () => {
    for (const state of [
      buildRelayMcpSettingsView(),
      mcpSettingsLoading(),
      mcpSettingsUnavailable('unreadable'),
    ]) {
      cleanup();
      setup({ mcp: state });
      openMcpSection();
      const notice = section().querySelector('[data-mcp-reviewer-denied="true"]');
      expect(notice, 'the denial must be stated whatever the surface state').toBeTruthy();
      expect(notice!.textContent).toContain('receives NO MCP connection, tool, resource or prompt');
    }
  });

  it('names the denied roles from the POLICY layer, so the sentence cannot outlive the rule', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    openMcpSection();
    expect(RELAY_MCP_DENIED_ROLES).toEqual(MCP_FORBIDDEN_ROLES);
    for (const role of MCP_FORBIDDEN_ROLES) {
      expect(section().textContent, `the denial must name ${role}`).toContain(role);
    }
  });

  it('offers no control that could grant a reviewer anything', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    openMcpSection();
    const controls = section().querySelectorAll('input, select, textarea');
    expect(controls.length, 'the MCP section grants nothing from this page').toBe(0);
  });
});

/* ------------------------------------------------- boundary + secrets */

describe('the mounted surface can carry no credential and no host topology', () => {
  it('renders no token, header, credential or absolute local path', () => {
    setup({ mcp: buildRelayMcpSettingsView({ connections: [buildConnection()] }) });
    openMcpSection();
    const html = section().innerHTML;
    for (const forbidden of [
      'Authorization', 'Bearer', 'api_key', 'apiKey', 'access_token', 'client_secret',
      'password', 'VITE_', '/home/', '/usr/', 'C:\\',
    ]) {
      expect(html, `the mounted MCP surface must never render ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the section imports NOTHING from the MCP transports, client or fake servers', () => {
    // SPECIFIERS, not prose: these modules NAME the server-only directories in
    // their docstrings to explain why they stay out of them, and a substring
    // match over the whole file would read that explanation as the violation.
    const specifiersOf = (source: string): string[] =>
      [...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]);

    const modules: Array<[string, string]> = [
      ['SettingsMcp.tsx', join(__dirname, 'SettingsMcp.tsx')],
      ['mcp-settings-view.ts', join(__dirname, '..', 'mcp', 'mcp-settings-view.ts')],
      ['ui/mcp/index.ts', join(__dirname, '..', 'mcp', 'index.ts')],
    ];
    for (const [name, path] of modules) {
      const specifiers = specifiersOf(readFileSync(path, 'utf8'));
      expect(specifiers.length, `${name} declares no imports at all — check the parse`).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        for (const forbidden of ['mcp/transports', 'mcp/client', 'mcp/testing', 'node:', '@modelcontextprotocol']) {
          expect(specifier, `${name} must not import ${forbidden}`).not.toContain(forbidden);
        }
      }
    }
  });
});

/* ----------------------------------------------- settings regressions */

describe('Project Settings itself keeps working with the section mounted', () => {
  it('every other section still renders through the rail', () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    for (const label of [
      '01 PROJECT', '05 WORKFORCE', '10 PERMISSIONS', '13 NOTIFICATIONS', '15 REVIEW AND START',
    ]) {
      const [number, ...rest] = label.split(' ');
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`${number}\\s*${rest.join('\\s*')}`) }));
      expect(eyebrow()).toContain(`${number} / 15`);
    }
  });

  it("REVIEW's own BACK lands on MCP CONNECTIONS, not on the section it used to precede", () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    fireEvent.click(screen.getByRole('button', { name: /15\s*REVIEW\s*AND\s*START/ }));
    fireEvent.click(screen.getByRole('button', { name: 'BACK' }));
    expect(eyebrow()).toContain('14 / 15');
  });

  it("the shell's own ← BACK from REVIEW lands on the same section — the two agree", () => {
    setup({ mcp: buildRelayMcpSettingsView() });
    fireEvent.click(screen.getByRole('button', { name: /15\s*REVIEW\s*AND\s*START/ }));
    fireEvent.click(screen.getByRole('button', { name: '← BACK' }));
    expect(eyebrow()).toContain('14 / 15');
  });

  it('the MCP section writes nothing to the settings draft', () => {
    const props = setup({ mcp: buildRelayMcpSettingsView() });
    fireEvent.click(screen.getByRole('button', { name: /01\s*PROJECT$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'SAVE DRAFT' }));
    const before = (props.onSaveDraft as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];

    openMcpSection();
    fireEvent.click(screen.getByRole('button', { name: 'SAVE DRAFT' }));
    const after = (props.onSaveDraft as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];

    expect(after).toEqual(before);
  });

  it('START PROJECT stays gated exactly as before — the section adds no blocker and removes none', () => {
    const props = setup({ mcp: buildRelayMcpSettingsView(), brief: null });
    fireEvent.click(screen.getByRole('button', { name: /15\s*REVIEW\s*AND\s*START/ }));
    const start = screen.getByRole('button', { name: /START PROJECT/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect((props.onStartProject as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

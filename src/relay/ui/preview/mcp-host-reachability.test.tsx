/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it as baseIt } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { MCP_REGISTRY_FIXTURES } from '../../mcp';

/**
 * REACHABILITY, NOT EXISTENCE.
 *
 * `relay-mcp-ui.test.tsx` renders `RelayMcpConnections` directly, and
 * `project-settings-mcp.test.tsx` renders it through `RelayProjectSettings`.
 * Both would keep passing if no running application ever mounted either one —
 * which is exactly the state this milestone was in, and exactly the state the
 * MCP document had to disclose. A component that only its own tests can reach
 * is not a product surface.
 *
 * This file therefore renders the REAL browser application shell — the same
 * `RelayPreviewApp` that `src/relay/main.tsx` mounts into `#root` — walks the
 * product route to a project's settings, and clicks the rail exactly as an
 * operator would. What it asserts is what a person can actually get to.
 *
 * It also holds the mount to the truth of this milestone: the browser shows
 * the CURATED REGISTRY and nothing else, every row labelled a simulation
 * fixture, no connection claimed, and no mission preflight claimed to have
 * been run.
 */

const it = (name: string, fn: () => void | Promise<void>) => baseIt(name, fn, 120000);

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay';
});
afterEach(cleanup);

/** Walk the real product route: Entry Home → Project Settings. */
async function openProjectSettings(): Promise<void> {
  render(createElement(RelayPreviewApp));
  fireEvent.click(screen.getByRole('button', { name: 'PROJECT SETTINGS' }));
  await waitFor(() => {
    expect(window.location.hash).toMatch(/^#\/relay\/project\/rly-\d+\/settings$/);
  });
  expect(screen.getByText('PROJECT SETTINGS')).toBeTruthy();
}

const openMcpSection = () => {
  fireEvent.click(screen.getByRole('button', { name: /14\s*MCP\s*CONNECTIONS/ }));
};

const section = (): HTMLElement => {
  const node = document.querySelector('[data-mcp-status]');
  if (node === null) throw new Error('the MCP section did not render in the running application');
  return node as HTMLElement;
};

/** The settings shell's numbered eyebrow. Read as an element, because the
 *  running application renders several `role="status"` regions at once. */
const eyebrow = (): string => document.querySelector('.rps-section-eyebrow')?.textContent ?? '';

describe('the running application reaches MCP Connections', () => {
  it('MCP CONNECTIONS is in the settings rail a real navigation arrives at', async () => {
    await openProjectSettings();
    expect(screen.getByRole('button', { name: /14\s*MCP\s*CONNECTIONS/ })).toBeTruthy();
  });

  it('clicking it renders the MCP surface inside the running shell', async () => {
    await openProjectSettings();
    expect(document.querySelector('[aria-label="MCP connections"]')).toBeNull();

    openMcpSection();

    expect(document.querySelector('[aria-label="MCP connections"]')).toBeTruthy();
    expect(section().getAttribute('data-mcp-status')).toBe('ready');
    expect(section().textContent).toContain('Relay is the MCP host');
  });

  it('a direct settings route reaches it too — not only the click path', async () => {
    const store = getRelayAppStore();
    const created = store.createDraftFromRequest('Build a billing API');
    if (!created.ok) throw new Error('setup');
    const projectId = created.value.project.id;

    window.location.hash = `#/relay/project/${projectId}/settings`;
    render(createElement(RelayPreviewApp));

    openMcpSection();
    expect(section().getAttribute('data-mcp-status')).toBe('ready');
  });

  it('the shell supplies the surface through the SHARED projection builder', () => {
    const source = readFileSync(join(__dirname, 'RelayPreviewApp.tsx'), 'utf8');
    // The host must not assemble rows of its own — that is how a second
    // vocabulary for one product starts.
    expect(source).toContain('buildRelayMcpSettingsView');
    expect(source).not.toContain('projectConnections(');
    expect(source).not.toContain('projectCatalog(');
  });
});

describe('what the running application is allowed to claim', () => {
  it('shows the curated registry, every row labelled a simulation fixture', async () => {
    await openProjectSettings();
    openMcpSection();
    const rows = section().querySelectorAll('.rmcp-catalog');
    expect(rows.length).toBe(MCP_REGISTRY_FIXTURES.length);
    for (const row of Array.from(rows)) {
      expect(row.textContent).toContain('SIMULATION FIXTURE — connects to no live service.');
    }
  });

  it('claims no connection, no approval and no preflight it did not run', async () => {
    await openProjectSettings();
    openMcpSection();
    expect(section().textContent).toContain('No MCP connections are configured in this workspace.');
    expect(section().textContent).toContain('No MCP approvals have been recorded.');
    expect(section().getAttribute('data-mcp-readiness')).toBe('not_evaluated');
    expect(section().textContent).not.toContain('MCP preflight');
  });

  it('states that the browser cannot open a connection at all', async () => {
    await openProjectSettings();
    openMcpSection();
    expect(section().textContent).toContain('opened by the Relay host process, never by this browser');
  });

  it('states the Reviewer denial on the running surface', async () => {
    await openProjectSettings();
    openMcpSection();
    expect(section().querySelector('[data-mcp-reviewer-denied="true"]')).toBeTruthy();
    expect(section().textContent).toContain('reviewer');
  });

  it('renders no credential, header or host path in the running application', async () => {
    await openProjectSettings();
    openMcpSection();
    const html = section().innerHTML;
    for (const forbidden of [
      'Authorization', 'Bearer', 'api_key', 'access_token', 'client_secret', 'password',
      'VITE_', '/home/', '/usr/', 'C:\\',
    ]) {
      expect(html, `the running MCP surface must never render ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('Project Settings stays functional in the running application', () => {
  it('the whole rail is still navigable after visiting MCP CONNECTIONS', async () => {
    await openProjectSettings();
    openMcpSection();
    for (const [number, label] of [
      ['01', 'PROJECT'], ['05', 'WORKFORCE'], ['13', 'NOTIFICATIONS'], ['15', 'REVIEW\\s*AND\\s*START'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`${number}\\s*${label}`) }));
      expect(eyebrow()).toContain(`${number} / 15`);
    }
  });

  it('the settings route still starts a project — the mount blocks nothing', async () => {
    const store = getRelayAppStore();
    const created = store.createDraftFromRequest('Build a usage dashboard for AI teams');
    if (!created.ok) throw new Error('setup');
    const projectId = created.value.project.id;

    window.location.hash = `#/relay/project/${projectId}/settings`;
    render(createElement(RelayPreviewApp));

    openMcpSection();
    fireEvent.click(screen.getByRole('button', { name: /15\s*REVIEW\s*AND\s*START/ }));
    const start = screen.getByRole('button', { name: 'START PROJECT' }) as HTMLButtonElement;
    expect(start.disabled, 'a brief-driven default draft was startable before the mount').toBe(false);
    fireEvent.click(start);

    await waitFor(() => {
      expect(window.location.hash).toBe(`#/relay/project/${projectId}`);
    });
    expect(store.getProject(projectId)!.activeMissionId).toBeTruthy();
  });
});

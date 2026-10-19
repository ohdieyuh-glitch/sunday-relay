/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RelayPspAgentImport } from './RelayPspAgentImport';
import { containsPspAgentId, createUnavailableEntitlementService, type PSPWorkspaceContext } from '../../psp';
import {
  FIXTURE_HOLDER_USER_ID,
  FIXTURE_NOW,
  FIXTURE_WORKSPACE_ID,
  createFixtureEntitlementService,
  fixtureScenario,
} from '../../psp/psp-fixtures';

/**
 * WEBSITE PSP Agent ID import — UI + security suite.
 *
 * All credentials are synthetic version-0 development fixtures. No marketplace
 * call, no purchase, no trade, no payment provider and no network request
 * exists in this path, so none can occur here.
 */

function workspace(overrides: Partial<PSPWorkspaceContext> = {}): PSPWorkspaceContext {
  return {
    workspaceId: FIXTURE_WORKSPACE_ID,
    userId: FIXTURE_HOLDER_USER_ID,
    importAllowed: true,
    relayVersion: '0.5.0',
    grantablePermissions: ['workspace.read', 'workspace.write', 'mission.run', 'mission.review'],
    installedPspIds: [],
    ...overrides,
  };
}

function mount(options: {
  service?: ReturnType<typeof createFixtureEntitlementService>;
  ws?: Partial<PSPWorkspaceContext>;
} = {}) {
  const service = options.service ?? createFixtureEntitlementService();
  const utils = render(
    <RelayPspAgentImport
      workspace={workspace(options.ws)}
      service={service}
      now={() => FIXTURE_NOW}
      importId={() => 'imp-web-1'}
    />,
  );
  return { ...utils, service };
}

function typeCredential(credential: string) {
  const input = screen.getByLabelText('PSP Agent ID') as HTMLInputElement;
  fireEvent.change(input, { target: { value: credential } });
  return input;
}

function validate() {
  fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
}

let consoleSpies: Array<{ restore: () => void; calls: unknown[][] }> = [];

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => {
    const calls: unknown[][] = [];
    const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
    return { restore: () => spy.mockRestore(), calls };
  });
});

afterEach(() => {
  consoleSpies.forEach((s) => s.restore());
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/* ------------------------------ entry point ----------------------------- */

describe('Relay Workspace -> Agents -> Import PSP Agent', () => {
  it('the entry point exists with an empty state', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'AGENTS' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Import PSP Agent' })).toBeTruthy();
    expect(screen.getByText('ENTER YOUR PSP AGENT ID')).toBeTruthy();
    expect(screen.getByText('No PSP agents imported yet.')).toBeTruthy();
  });

  it('the credential field is masked and never autofilled or spell-checked', () => {
    mount();
    const input = screen.getByLabelText('PSP Agent ID') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocorrect')).toBe('off');
  });

  it('walks validate -> preview -> confirm -> imported', () => {
    const scenario = fixtureScenario('purchased');
    const { service } = mount();

    typeCredential(scenario.credential);
    validate();

    // Safe preview, with the id masked.
    expect(screen.getByText('REVIEW AND CONFIRM')).toBeTruthy();
    expect(screen.getByText('Atlas Delivery Squad')).toBeTruthy();
    expect(screen.getByText('by Sunday Labs')).toBeTruthy();
    expect(screen.getByText(/PSP-AGENT-0-RY0001-•+/)).toBeTruthy();
    expect(screen.getByText(/official Relay Dog identity/)).toBeTruthy();
    expect(screen.getByText(/redeems this PSP Agent ID once/)).toBeTruthy();
    expect(service.imported).toHaveLength(0);   // nothing imported yet

    // Confirmation is required and is a separate, explicit action.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(screen.getByText('IMPORTED')).toBeTruthy();
    expect(screen.getByText(/was added to this workspace/)).toBeTruthy();
    expect(service.imported).toHaveLength(1);
    // The agent now appears in the workspace agent list.
    expect(screen.getAllByText('RY0001').length).toBeGreaterThan(0);
  });

  it('cancelling the preview imports nothing', () => {
    const scenario = fixtureScenario('purchased');
    const { service } = mount();
    typeCredential(scenario.credential);
    validate();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(service.imported).toHaveLength(0);
    expect(screen.getByText('ENTER YOUR PSP AGENT ID')).toBeTruthy();
  });
});

/* -------------------------------- states -------------------------------- */

describe('Import PSP Agent — failure states are shown safely', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['expired', 'EXPIRED', /expired/i],
    ['revoked', 'REVOKED', /revoked/i],
    ['already_redeemed', 'ALREADY REDEEMED', /already been redeemed/i],
    ['transferred', 'TRANSFERRED', /transferred/i],
    ['disputed', 'DISPUTED', /dispute/i],
    ['incompatible', 'INCOMPATIBLE', /not compatible/i],
  ];

  for (const [key, label, message] of cases) {
    it(`shows the ${key} state without leaking the credential`, () => {
      const scenario = fixtureScenario(key);
      const { container, service } = mount();
      typeCredential(scenario.credential);
      validate();
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toMatch(message);
      expect(service.imported).toHaveLength(0);
      expect(containsPspAgentId(container.innerHTML)).toBe(false);
      expect(container.innerHTML).not.toContain('DEVFXTR');
    });
  }

  it('an invalid format is rejected and never echoed back', () => {
    const { container } = mount();
    typeCredential('totally-not-a-psp-agent-id');
    validate();
    expect(screen.getByText('INVALID')).toBeTruthy();
    // The rendered DOM never contains what the user typed.
    expect(container.textContent).not.toContain('totally-not-a-psp-agent-id');
  });

  it('a service outage never fabricates a success', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService({ unavailable: true });
    mount({ service });
    typeCredential(scenario.credential);
    validate();
    expect(screen.getByText('SERVICE UNAVAILABLE')).toBeTruthy();
    expect(screen.queryByText('IMPORTED')).toBeNull();
    expect(service.imported).toHaveLength(0);
  });

  it('the production boundary refuses until a real backend exists', () => {
    const scenario = fixtureScenario('purchased');
    render(
      <RelayPspAgentImport
        workspace={workspace()}
        service={createUnavailableEntitlementService()}
        now={() => FIXTURE_NOW}
        importId={() => 'imp-web-1'}
      />,
    );
    typeCredential(scenario.credential);
    validate();
    expect(screen.getByText('SERVICE UNAVAILABLE')).toBeTruthy();
  });
});

/* ------------------------------- security ------------------------------- */

describe('Import PSP Agent — the credential never escapes', () => {
  it('never reaches the DOM, the URL, storage, or the console', () => {
    const scenario = fixtureScenario('purchased');
    const before = window.location.href;
    const { container } = mount();

    typeCredential(scenario.credential);
    validate();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

    const html = container.innerHTML;
    expect(containsPspAgentId(html)).toBe(false);
    expect(html).not.toContain('DEVFXTR');

    // The input's value is cleared once the flow ends.
    expect(screen.queryByLabelText('PSP Agent ID')).toBeNull();

    // URL untouched — no query parameter, no route parameter.
    expect(window.location.href).toBe(before);
    expect(window.location.search).toBe('');

    // No storage of any kind.
    const storage = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(containsPspAgentId(storage)).toBe(false);
    expect(storage).not.toContain('DEVFXTR');
    expect(document.cookie).not.toContain('PSP-AGENT');

    // Nothing was written to the console at all.
    for (const spy of consoleSpies) {
      const dumped = JSON.stringify(spy.calls);
      expect(containsPspAgentId(dumped)).toBe(false);
      expect(dumped).not.toContain('DEVFXTR');
    }
  });

  it('the component keeps the credential out of React state entirely', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'relay', 'ui', 'psp-import', 'RelayPspAgentImport.tsx'),
      'utf8',
    );
    // Comments are stripped first: the file DOCUMENTS these prohibitions, and
    // the assertion is about the code, not about the prose describing it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The credential lives in a ref, never in useState.
    expect(code).toContain('credentialRef');
    expect(code).not.toMatch(/useState[^\n]*credential/i);
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(code).not.toMatch(/console\.(log|debug|info|warn|error)/);
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest/);
    // And it is cleared on every exit path.
    expect(code).toContain('clearCredential');
  });

  it('the imported record shown to the user carries no credential', () => {
    const scenario = fixtureScenario('purchased');
    const { service } = mount();
    typeCredential(scenario.credential);
    validate();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    const record = service.imported[0];
    expect(containsPspAgentId(JSON.stringify(record))).toBe(false);
    expect(JSON.stringify(record)).not.toContain('DEVFXTR');
    expect(record.displayName).toBe('Atlas Delivery Squad');
  });
});

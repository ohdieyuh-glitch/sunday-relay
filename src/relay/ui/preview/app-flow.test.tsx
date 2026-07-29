/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { RelayPreviewApp, parsePreviewHash } from './RelayPreviewApp';
import { getRelayAppStore, RELAY_APP_STORAGE_KEY } from '../app';
import { createDefaultSettingsDraft } from '../project-settings/defaults';

/**
 * End-to-end product flow through the real screens and the application store
 * (jsdom): Ask Relay → brief → settings → workspace → mission playback, with
 * refresh recovery and direct-route behavior. Exercises the store singleton
 * that the app shell uses, so it proves the wired product, not a mock.
 */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay';
});
afterEach(cleanup);

const renderApp = () => render(createElement(RelayPreviewApp));

describe('hash routing', () => {
  it('parses the product routes', () => {
    expect(parsePreviewHash('#/relay')).toEqual({ screen: 'home' });
    expect(parsePreviewHash('#/relay/project/rly-002/settings')).toEqual({
      screen: 'settings',
      projectId: 'rly-002',
    });
    expect(parsePreviewHash('#/relay/project/rly-002')).toEqual({
      screen: 'workspace',
      projectId: 'rly-002',
      terminal: false,
    });
    expect(parsePreviewHash('#/relay/project/rly-002/terminal')).toEqual({
      screen: 'workspace',
      projectId: 'rly-002',
      terminal: true,
    });
  });
});

describe('Ask Relay creates a persisted project', () => {
  it('opens Project Settings from a fresh Relay Home without starting a mission', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'PROJECT SETTINGS' }));

    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/relay\/project\/rly-\d+\/settings$/);
    });
    const store = getRelayAppStore();
    expect(store.listProjects()).toHaveLength(1);
    expect(Object.keys(store.getState().missions)).toHaveLength(0);
    expect(screen.getByText('PROJECT SETTINGS')).toBeTruthy();
  });

  it('typing a request and building a brief creates exactly one project', () => {
    renderApp();
    const input = screen.getByPlaceholderText(/Describe the product/i);
    fireEvent.change(input, { target: { value: 'Build a usage dashboard for AI teams' } });
    fireEvent.click(screen.getByRole('button', { name: 'BUILD PROJECT BRIEF' }));

    const store = getRelayAppStore();
    expect(store.listProjects()).toHaveLength(1);
    expect(store.listProjects()[0].originalRequest).toBe('Build a usage dashboard for AI teams');
    // The brief panel now renders on the Entry Home.
    expect(screen.getByText('SEND TO PROJECT SETTINGS')).toBeTruthy();
  });

  it('a double-click does not create a second project', () => {
    renderApp();
    const input = screen.getByPlaceholderText(/Describe the product/i);
    fireEvent.change(input, { target: { value: 'Design a billing API' } });
    const build = screen.getByRole('button', { name: 'BUILD PROJECT BRIEF' });
    fireEvent.click(build);
    fireEvent.click(build);
    expect(getRelayAppStore().listProjects()).toHaveLength(1);
  });
});

describe('brief → settings → workspace, refresh-safe', () => {
  function createProject(request: string): string {
    const store = getRelayAppStore();
    const r = store.createDraftFromRequest(request);
    if (!r.ok) throw new Error('setup');
    return r.value.project.id;
  }

  it('a configured project workspace survives a direct route refresh', () => {
    const id = createProject('Build a dashboard');
    const store = getRelayAppStore();
    // Start with default (recommended) settings via the store service.
    store.startProject(id, createDefaultSettingsDraft(store.getBrief(id)!.draft));

    // Direct-load the workspace route (simulates refresh at that URL).
    window.location.hash = `#/relay/project/${id}`;
    renderApp();
    // The workspace renders the project, not a not-found state.
    expect(screen.getByText('RELAY CONSOLE')).toBeTruthy();
    expect(screen.queryByText(/could not load this project/i)).toBeNull();
    // Demo mission playback is present and honest.
    expect(screen.getByText('DEMO MISSION')).toBeTruthy();
    expect(screen.getByText(/no provider runs/i)).toBeTruthy();
  });

  it('an unknown project id shows a safe not-found (no crash, no stack trace)', () => {
    window.location.hash = '#/relay/project/rly-999';
    renderApp();
    expect(screen.getByRole('alert').textContent).toMatch(/could not load this project/i);
    expect(document.body.textContent).not.toMatch(/at Object\.|node_modules|\.tsx:/);
  });

  it('a draft project routes the founder back to settings instead of a broken workspace', () => {
    const id = createProject('Draft only');
    window.location.hash = `#/relay/project/${id}`;
    renderApp();
    expect(screen.getByText(/Finish configuring this project/i)).toBeTruthy();
  });
});

describe('mission playback advances only through the machine', () => {
  it('advancing eventually reaches VERIFIED COMPLETE and persists', () => {
    const store = getRelayAppStore();
    const r = store.createDraftFromRequest('Playable mission');
    if (!r.ok) throw new Error('setup');
    const id = r.value.project.id;
    store.startProject(id, createDefaultSettingsDraft(store.getBrief(id)!.draft));

    window.location.hash = `#/relay/project/${id}`;
    renderApp();

    // Step until the completion badge appears (bounded). Multiple nodes can
    // read "VERIFIED COMPLETE" (playback badge + mission verdict), so count.
    for (let i = 0; i < 20; i++) {
      if (screen.queryAllByText(/VERIFIED COMPLETE/i).length > 0) break;
      const advance = screen.getByRole('button', { name: /▸|ADVANCING/i });
      fireEvent.click(advance);
    }
    expect(screen.queryAllByText(/VERIFIED COMPLETE/i).length).toBeGreaterThan(0);
    // Persisted: the mission is complete in the store.
    const mission = store.getMission(store.getProject(id)!.activeMissionId!);
    expect(mission!.state).toBe('verified_complete');
    // Storage holds no credential-shaped content. (Scoped to actual secret
    // material — a JSON key named like a credential, or an `sk-`/bearer token —
    // so it does not false-flag safe settings vocabulary like the
    // "secrets" protected-area label or the "secret_scan" inspection.)
    expect(window.localStorage.getItem(RELAY_APP_STORAGE_KEY) ?? '').not.toMatch(
      /"(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|bearer)"\s*:|sk-[a-z0-9]{16,}/i,
    );
    // Legitimately long-running: up to 20 full render+click cycles of the
    // whole workspace. The default 5s timeout is too tight when the suite runs
    // serially on a loaded machine (measured 3.7s idle, 6.7s under load).
  }, 20_000);
});

describe('appearance persists through the store', () => {
  it('selecting RELAY MANUAL stamps the root and survives a remount', () => {
    const { unmount } = renderApp();
    // Open the dev switcher appearance group and pick RELAY MANUAL.
    const group = screen.getByRole('group', { name: 'Appearance' });
    fireEvent.click(within(group).getByRole('button', { name: 'RELAY MANUAL' }));
    expect(document.documentElement.getAttribute('data-relay-colorway')).toBe('manual');
    unmount();
    cleanup();
    renderApp();
    expect(getRelayAppStore().getState().colorway).toBe('manual');
    expect(document.documentElement.getAttribute('data-relay-colorway')).toBe('manual');
  });
});

describe('DEV PREVIEW collapse control', () => {
  const toggle = () =>
    screen.getByRole('button', { name: /(?:Collapse|Expand) DEV PREVIEW controls/ });

  it('is expanded by default, collapses to its handle, and reopens accessibly', () => {
    renderApp();
    const controls = screen.getByRole('navigation', { name: 'Development preview switcher' });

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(controls.classList.contains('rpv-switcher--open')).toBe(true);

    fireEvent.click(toggle());
    expect(toggle().textContent).toMatch(/DEV PREVIEW/);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(controls.classList.contains('rpv-switcher--open')).toBe(false);

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(controls.classList.contains('rpv-switcher--open')).toBe(true);
  });

  it('uses native keyboard-operable button semantics', () => {
    renderApp();
    const handle = toggle();
    expect(handle.tagName).toBe('BUTTON');
    expect(handle.getAttribute('type')).toBe('button');
    handle.focus();
    expect(document.activeElement).toBe(handle);
    // Native buttons activate from Enter and Space without custom key handlers.
    fireEvent.click(handle);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves the selected appearance and fixture state without resetting or dispatching', () => {
    window.location.hash = '#/relay/project/rly-001';
    const store = getRelayAppStore();
    const originalReset = store.resetAll;
    const originalBegin = store.beginLiveMission;
    let resetCalls = 0;
    let beginCalls = 0;
    store.resetAll = (...args) => {
      resetCalls += 1;
      return originalReset.apply(store, args);
    };
    store.beginLiveMission = (...args) => {
      beginCalls += 1;
      return originalBegin.apply(store, args);
    };

    try {
      renderApp();
      const appearance = screen.getByRole('group', { name: 'Appearance' });
      fireEvent.click(within(appearance).getByRole('button', { name: 'MIDNIGHT' }));
      const fixture = screen.getByRole('group', { name: 'Workspace fixture state' });
      fireEvent.click(within(fixture).getByRole('button', { name: 'VERIFYING' }));

      fireEvent.click(toggle());
      fireEvent.click(toggle());

      expect(within(appearance).getByRole('button', { name: 'MIDNIGHT' }).getAttribute('aria-pressed')).toBe('true');
      expect(within(fixture).getByRole('button', { name: 'VERIFYING' }).getAttribute('aria-pressed')).toBe('true');
      expect(window.location.hash).toBe('#/relay/project/rly-001');
      expect(resetCalls).toBe(0);
      expect(beginCalls).toBe(0);
    } finally {
      store.resetAll = originalReset;
      store.beginLiveMission = originalBegin;
    }
  });
});

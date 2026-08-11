// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';

afterEach(cleanup);
import { RelayConsole } from './RelayConsole';

/**
 * THE CONSOLE'S EMPTY STATE TELLS THE TRUTH, AND OFFERS THE ACTION.
 *
 * A founder with a paired control session, a configured mission and a healthy
 * bridge watched "Relay activity will appear here after Project Settings is
 * confirmed" for an afternoon, because the start refusal rendered only as a
 * dismissible line at the bottom of the page — and one silent client path
 * produced no line at all. The reason a mission is not running belongs where
 * the founder is looking, next to a button that tries again and reports here.
 */

const base = { events: [], handoffNetworkState: 'online' as const };

describe('the idle console', () => {
  it('shows the start refusal verbatim, as an alert, in the console itself', () => {
    render(createElement(RelayConsole, {
      ...base,
      idle: { reason: 'This browser’s session is read-only. Starting a mission needs a CONTROL pairing from the operator CLI.', canStart: true, onStart: () => {} },
    }));
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('read-only');
    // The boilerplate must not render beside a real reason — two competing
    // explanations is how the true one got ignored.
    expect(document.body.textContent).not.toContain('after Project Settings is confirmed');
  });

  it('keeps the legacy copy when nothing has been refused', () => {
    render(createElement(RelayConsole, { ...base, idle: { reason: null, canStart: false } }));
    expect(document.body.textContent).toContain('after Project Settings is confirmed');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('offers START MISSION exactly when a dispatch is possible, and it dispatches', () => {
    const onStart = vi.fn();
    render(createElement(RelayConsole, {
      ...base,
      idle: { reason: null, canStart: true, onStart },
    }));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'START MISSION');
    expect(btn).toBeDefined();
    btn?.click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('says STARTING and refuses double-dispatch while one is in flight', () => {
    const onStart = vi.fn();
    render(createElement(RelayConsole, {
      ...base,
      idle: { reason: null, canStart: true, starting: true, onStart },
    }));
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('STARTING'));
    expect(btn).toBeDefined();
    expect(btn?.disabled).toBe(true);
  });

  it('renders no button when no mission can be dispatched', () => {
    render(createElement(RelayConsole, { ...base, idle: { reason: null, canStart: false } }));
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'START MISSION')).toBe(false);
  });

  it('without an idle state, the legacy empty console is unchanged', () => {
    render(createElement(RelayConsole, base));
    expect(document.body.textContent).toContain('No mission is running.');
    expect(document.body.textContent).toContain('after Project Settings is confirmed');
  });
});

describe('mission ids cannot collide across browsers', () => {
  it('two stores creating the same-numbered project mint different mission ids', async () => {
    /**
     * The bridge is idempotent on mission id and project numbering is
     * per-browser, so `rly-002-msn-1` from two browsers was ONE mission —
     * observed in production between a founder and a diagnostic session.
     */
    const { createRelayAppStore } = await import('../app/store');
    const { createRelayAppStorage } = await import('../app/persistence');
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      window.localStorage.clear();
      const store = createRelayAppStore(createRelayAppStorage());
      const created = store.createDraftFromRequest('Normalize names.');
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const projectId = created.value.project.id;
      const { defaultSettingsForProject } = await import('../app/store');
      const started = store.startProject(projectId, defaultSettingsForProject(store, projectId));
      expect(started.ok).toBe(true);
      if (started.ok) ids.push(started.value.mission.id);
    }
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    // Still recognizably the project's first mission.
    for (const id of ids) expect(id).toMatch(/-msn-1-/);
  });
});

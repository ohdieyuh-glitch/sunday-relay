/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRelayAppStore } from '..';
import { RelayPreviewApp } from '../../preview/RelayPreviewApp';
import { RELAY_DEMO_SCRIPT } from './demo-simulation-script';

/**
 * RENDERER-PRESERVATION GATE — starting Demo Simulation must NOT swap the
 * original Claude Code-built Live Terminal for the old Codex demo-terminal
 * interface. The same RelayLiveTerminalPanel (PROMPT ARCHITECT / CODING AGENT
 * / RELAY SYSTEM RolePanels) stays mounted and is fed projected simulated
 * events. The forbidden alternate surface must never render.
 */

beforeEach(() => {
  window.localStorage.clear();
  // Open directly in full-screen Terminal Mode so the Live Terminal is mounted.
  window.location.hash = '#/relay/project/rly-001/terminal';
  getRelayAppStore().resetAll();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const playButton = () => screen.getByRole('button', { name: 'PLAY DEMO' });
const liveTerminal = () =>
  screen.getByRole('dialog', { name: /^Live Terminal/ });

describe('Demo Simulation keeps the original Live Terminal renderer', () => {
  it('renders the original Live Terminal before Demo Simulation begins', () => {
    render(createElement(RelayPreviewApp));
    // Same original component, same three RolePanels, before any demo click.
    expect(liveTerminal()).toBeTruthy();
    expect(screen.getByRole('region', { name: 'PROMPT ARCHITECT activity' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'RELAY SYSTEM activity' })).toBeTruthy();
  });

  it('keeps the SAME Live Terminal mounted and populates its original panels during autoplay', async () => {
    vi.useFakeTimers();
    render(createElement(RelayPreviewApp));

    const before = liveTerminal();
    fireEvent.click(playButton());

    // Advance the whole timeline to completion.
    for (const step of RELAY_DEMO_SCRIPT.slice(0, -1)) {
      await act(async () => vi.advanceTimersByTime(step.durationMs));
    }

    // The exact same terminal dialog node is still mounted (not remounted/swapped).
    const after = liveTerminal();
    expect(after).toBe(before);

    // Original vertical role panels remain and are populated with simulated work.
    const architect = screen.getByRole('region', { name: 'PROMPT ARCHITECT activity' });
    const coding = screen.getByRole('region', { name: 'CODING AGENT activity' });
    const relay = screen.getByRole('region', { name: 'RELAY SYSTEM activity' });
    expect(architect.textContent).toContain('Prompt Architect');
    expect(coding.textContent).toContain('Coding Agent');
    expect(relay.textContent).toMatch(/Reviewer|Relay/);

    // Truthful compact source marker inside the existing status row.
    expect(after.textContent).toContain('DEMO SIMULATION');
    // An explicit budget: this drives the WHOLE demo timeline through the
    // real application shell, so it is slower than the 5s default when the
    // suite runs files in parallel.
  }, 30_000);

  it('never renders the forbidden Codex demo-terminal interface', async () => {
    vi.useFakeTimers();
    render(createElement(RelayPreviewApp));
    fireEvent.click(playButton());
    for (const step of RELAY_DEMO_SCRIPT.slice(0, -1)) {
      await act(async () => vi.advanceTimersByTime(step.durationMs));
    }

    // No alternate demo-terminal detail surface, header, or its unique copy.
    expect(document.querySelector('[data-testid="demo-terminal-detail"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Vertical Demo Simulation workflow' })).toBeNull();
    expect(document.body.textContent).not.toContain('VIEW FULL SIMULATED INITIAL NPM OUTPUT');
    expect(document.body.textContent).not.toContain('NO CLAUDE PROCESS');
    expect(document.body.textContent).not.toContain('NO HERMES PROCESS');

    // Route unchanged; no second project created.
    expect(window.location.hash).toBe('#/relay/project/rly-001/terminal');
    expect(getRelayAppStore().listProjects().length).toBe(0);
  });
});

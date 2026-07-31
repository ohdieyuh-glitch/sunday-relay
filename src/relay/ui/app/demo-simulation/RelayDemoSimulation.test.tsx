/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRelayAppStore } from '..';
import { RelayPreviewApp } from '../../preview/RelayPreviewApp';
import { WORKSPACE_FIXTURES } from '../../project-workspace';
import { RELAY_DEMO_SCRIPT } from './demo-simulation-script';
import { INITIAL_RELAY_DEMO_STATE, relayDemoSimulationReducer } from './demo-simulation-reducer';
import { projectDemoSimulationIntoWorkspace } from './demo-workspace-projection';

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/relay/project/rly-001';
  getRelayAppStore().resetAll();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const playButton = () => screen.getByRole('button', { name: 'PLAY DEMO' });
const demoControls = () => screen.getByRole('group', { name: 'Demo Simulation controls' });

describe('demo simulation reducer', () => {
  it('is idle by default and PLAY creates a visibly non-production instance', () => {
    expect(INITIAL_RELAY_DEMO_STATE.status).toBe('idle');
    expect(INITIAL_RELAY_DEMO_STATE.active).toBe(false);
    const played = relayDemoSimulationReducer(INITIAL_RELAY_DEMO_STATE, {
      type: 'play',
      now: 100,
      instanceId: 'demo-simulation:normalize-project-name:test',
    });
    expect(played.status).toBe('playing');
    expect(played.currentStepIndex).toBe(0);
    expect(played.instanceId).toMatch(/^demo-simulation:/);
    expect(played.events[0].truthClass).toBe('simulated_demo');
  });

  it('NEXT advances exactly one ordered stage and reaches demo completion', () => {
    let state = relayDemoSimulationReducer(INITIAL_RELAY_DEMO_STATE, {
      type: 'play',
      now: 100,
      instanceId: 'demo-simulation:test',
    });
    state = relayDemoSimulationReducer(state, { type: 'advance' });
    expect(state.currentStepIndex).toBe(1);
    expect(state.events.map((event) => event.sequence)).toEqual([1, 2]);
    for (let i = 1; i < RELAY_DEMO_SCRIPT.length; i += 1) {
      state = relayDemoSimulationReducer(state, { type: 'advance' });
    }
    expect(state.status).toBe('complete');
    expect(RELAY_DEMO_SCRIPT[state.currentStepIndex].label).toBe('DEMO VERIFIED COMPLETE');
  });

  it('pause/resume, restart, speed, and exit affect simulation state only', () => {
    let state = relayDemoSimulationReducer(INITIAL_RELAY_DEMO_STATE, {
      type: 'play',
      now: 100,
      instanceId: 'demo-simulation:test',
    });
    state = relayDemoSimulationReducer(state, { type: 'advance' });
    state = relayDemoSimulationReducer(state, { type: 'pause', now: 200 });
    expect(state.status).toBe('paused');
    expect(relayDemoSimulationReducer(state, { type: 'advance' }).currentStepIndex).toBe(2);
    state = relayDemoSimulationReducer(state, { type: 'resume', now: 300 });
    expect(state.status).toBe('playing');
    state = relayDemoSimulationReducer(state, { type: 'speed', speed: 2 });
    expect(state.speed).toBe(2);
    state = relayDemoSimulationReducer(state, { type: 'restart', now: 400 });
    expect(state.currentStepIndex).toBe(0);
    expect(state.events).toHaveLength(1);
    state = relayDemoSimulationReducer(state, { type: 'exit' });
    expect(state.active).toBe(false);
    expect(state.events).toHaveLength(0);
    expect(state.speed).toBe(2);
  });

  it('records finding before repair, stales demo-r1, and binds approval to demo-r2', () => {
    const ids = RELAY_DEMO_SCRIPT.map((step) => step.id);
    expect(ids.indexOf('review')).toBeLessThan(ids.indexOf('repair'));
    expect(ids.indexOf('repair')).toBeLessThan(ids.indexOf('reverify'));
    expect(ids.indexOf('reverify')).toBeLessThan(ids.indexOf('final-review'));
    expect(RELAY_DEMO_SCRIPT.find((step) => step.id === 'review')?.event.summary).toMatch(/Repeated existing hyphens/);
    expect(RELAY_DEMO_SCRIPT.find((step) => step.id === 'reverify')?.event.summary).toMatch(/prior review is stale/i);
    expect(RELAY_DEMO_SCRIPT.find((step) => step.id === 'final-review')?.event.result).toContain('demo-r2');
  });
});

describe('browser demo integration', () => {
  it('keeps the existing workspace and project route while entering a clearly labeled simulation', () => {
    render(createElement(RelayPreviewApp));
    const route = window.location.hash;
    const projectCount = getRelayAppStore().listProjects().length;
    expect(screen.getByRole('group', { name: 'Project workforce and mode' })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Relay Console/ })).toBeTruthy();
    fireEvent.click(playButton());
    expect(window.location.hash).toBe(route);
    expect(getRelayAppStore().listProjects()).toHaveLength(projectCount);
    expect(screen.getByRole('region', { name: 'Demo Mission summary' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Project workforce and mode' }).textContent).toContain('DEMO SIMULATION');
    expect(screen.getByRole('region', { name: /Relay Console/ }).textContent).toContain('SIMULATED');
    expect(document.body.textContent).not.toContain('VISUAL MISSION WALKTHROUGH');
    expect(within(demoControls()).getByRole('button', { name: 'PAUSE' })).toBeTruthy();
  });

  it('autoplay advances, PAUSE stops, and RESUME continues without duplicate timers', async () => {
    vi.useFakeTimers();
    render(createElement(RelayPreviewApp));
    const baselineTimers = vi.getTimerCount();
    const play = playButton();
    fireEvent.click(play);
    fireEvent.click(play);
    expect(vi.getTimerCount()).toBe(baselineTimers + 1);

    await act(async () => vi.advanceTimersByTime(RELAY_DEMO_SCRIPT[0].durationMs));
    expect(screen.getByText(/DEMO MISSION · MISSION CONTRACT CREATED/)).toBeTruthy();

    fireEvent.click(within(demoControls()).getByRole('button', { name: 'PAUSE' }));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(screen.getByText(/DEMO MISSION · MISSION CONTRACT CREATED/)).toBeTruthy();

    fireEvent.click(within(demoControls()).getByRole('button', { name: 'RESUME' }));
    await act(async () => vi.advanceTimersByTime(RELAY_DEMO_SCRIPT[1].durationMs));
    expect(screen.getByText(/DEMO MISSION · ANALYZING MISSION/)).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('NEXT advances one stage and RESTART resets only the demo', () => {
    render(createElement(RelayPreviewApp));
    fireEvent.click(playButton());
    fireEvent.click(within(demoControls()).getByRole('button', { name: 'NEXT' }));
    expect(screen.getByText(/DEMO MISSION · MISSION CONTRACT CREATED/)).toBeTruthy();
    fireEvent.click(within(demoControls()).getByRole('button', { name: 'RESTART DEMO' }));
    expect(screen.getByText(/DEMO MISSION · READY/)).toBeTruthy();
    expect(window.location.hash).toBe('#/relay/project/rly-001');
  });

  /**
   * Drives the whole demo script through fake timers and re-renders the shell
   * on every step, so its wall-clock cost scales with machine load rather than
   * with anything it asserts. Under the FULL suite it exceeded vitest's 5s
   * default and failed as a timeout — a red result that says nothing about the
   * product. The timeout is explicit so a slow machine reports the real
   * outcome instead.
   */
  it('autoplay reaches DEMO VERIFIED COMPLETE and leaves it visible', { timeout: 60_000 }, async () => {
    vi.useFakeTimers();
    render(createElement(RelayPreviewApp));
    fireEvent.click(playButton());
    for (const step of RELAY_DEMO_SCRIPT.slice(0, -1)) {
      await act(async () => vi.advanceTimersByTime(step.durationMs));
    }
    expect(screen.getByText(/DEMO MISSION · DEMO VERIFIED COMPLETE/)).toBeTruthy();
    expect(screen.getByText(/scope preserved · simulated evidence present · Hermes approved demo-r2/)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Project workforce and mode' }).textContent).toMatch(/HERMES.*APPROVED.*COMPLETE/is);
  });

  it('EXIT restores the prior route and appearance and cleans up the timer', () => {
    vi.useFakeTimers();
    window.location.hash = '#/relay/project/rly-001';
    render(createElement(RelayPreviewApp));
    const appearance = screen.getByRole('group', { name: 'Appearance' });
    fireEvent.click(within(appearance).getByRole('button', { name: 'MIDNIGHT' }));
    const baselineTimers = vi.getTimerCount();
    fireEvent.click(playButton());
    expect(vi.getTimerCount()).toBe(baselineTimers + 1);
    fireEvent.click(within(demoControls()).getByRole('button', { name: 'EXIT DEMO' }));
    expect(vi.getTimerCount()).toBe(baselineTimers);
    expect(window.location.hash).toBe('#/relay/project/rly-001');
    expect(document.documentElement.getAttribute('data-relay-colorway')).toBe('midnight');
    expect(screen.queryByRole('region', { name: 'Demo Mission summary' })).toBeNull();
    expect(screen.getByText('RELAY CONSOLE')).toBeTruthy();
  });

  it('cleans up the single authoritative timer on unmount', () => {
    vi.useFakeTimers();
    const view = render(createElement(RelayPreviewApp));
    const baselineTimers = vi.getTimerCount();
    fireEvent.click(playButton());
    expect(vi.getTimerCount()).toBe(baselineTimers + 1);
    const timersBeforeUnmount = vi.getTimerCount();
    view.unmount();
    expect(vi.getTimerCount()).toBe(timersBeforeUnmount - 1);
  });

  it('never calls fetch, live mission controls, reset, or connector-like globals', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const store = getRelayAppStore();
    const begin = vi.spyOn(store, 'beginLiveMission');
    const cancel = vi.spyOn(store, 'cancelLiveMission');
    const reset = vi.spyOn(store, 'resetAll');
    const before = JSON.stringify(store.getState());

    render(createElement(RelayPreviewApp));
    fireEvent.click(playButton());
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(within(demoControls()).getByRole('button', { name: 'NEXT' }));
    }
    fireEvent.click(within(demoControls()).getByRole('button', { name: 'EXIT DEMO' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).toBe(before);
  });

  it('keeps DEV PREVIEW collapsible while the simulation is active', () => {
    render(createElement(RelayPreviewApp));
    fireEvent.click(playButton());
    expect(screen.getByRole('button', { name: 'Collapse DEV PREVIEW controls' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse DEV PREVIEW controls' }));
    expect(screen.getByRole('button', { name: 'Expand DEV PREVIEW controls' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Expand DEV PREVIEW controls' }));
    expect(screen.getByRole('group', { name: 'Demo Simulation controls' })).toBeTruthy();
  });

  it('keeps one autoplay run while switching between Workspace and Console', async () => {
    vi.useFakeTimers();
    render(createElement(RelayPreviewApp));
    fireEvent.click(playButton());
    await act(async () => vi.advanceTimersByTime(RELAY_DEMO_SCRIPT[0].durationMs));
    const instance = screen.getByRole('region', { name: 'Demo Mission summary' }).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'CONSOLE' }));
    expect(window.location.hash).toBe('#/relay/console');
    expect(screen.getByRole('region', { name: 'Demo Mission summary' }).textContent).toBe(instance);
    await act(async () => vi.advanceTimersByTime(RELAY_DEMO_SCRIPT[1].durationMs));
    expect(screen.getByText(/DEMO MISSION · ANALYZING MISSION/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'WORKSPACE' }));
    expect(screen.getByText(/DEMO MISSION · ANALYZING MISSION/)).toBeTruthy();
  });
});

describe('simulation presentation boundaries', () => {
  it('projects simulated events and demo completion without a production verdict', () => {
    let state = relayDemoSimulationReducer(INITIAL_RELAY_DEMO_STATE, {
      type: 'play',
      now: 1,
      instanceId: 'demo-simulation:test',
    });
    for (let i = 1; i < RELAY_DEMO_SCRIPT.length; i += 1) {
      state = relayDemoSimulationReducer(state, { type: 'advance' });
    }
    const projection = projectDemoSimulationIntoWorkspace(state, WORKSPACE_FIXTURES.implementing);
    expect(projection.mode).toBe('demo_simulation');
    expect(projection.outputState).toBe('demo_verified_complete');
    expect(projection.completionState.verdict).toBe('not_complete');
    expect(projection.terminalEvents.every((event) => event.simulated)).toBe(true);
    expect(projection.workforce.reviewer.name).toBe('Hermes');
    expect(state.events.every((event) => event.truthClass === 'simulated_demo')).toBe(true);
  });
});

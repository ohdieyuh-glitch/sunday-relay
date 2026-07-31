/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRelayAppStore } from '..';
import { RelayPreviewApp } from '../../preview/RelayPreviewApp';
import { RELAY_DEMO_SCRIPT } from './demo-simulation-script';

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '#/relay/project/rly-001';
  getRelayAppStore().resetAll();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const startDemo = () => {
  render(createElement(RelayPreviewApp));
  fireEvent.click(screen.getByRole('button', { name: 'PLAY DEMO' }));
};

const summary = () => screen.getByRole('region', { name: 'Demo Mission summary' });

describe('collapsible Demo Mission summary', () => {
  it('is expanded by default during playback with a truthful minimize control', () => {
    startDemo();
    const button = screen.getByRole('button', { name: 'Minimize Demo Mission' });
    expect(button.textContent).toBe('−');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe('relay-demo-mission-summary-body');
    expect(summary().textContent).toContain('FOUNDER REQUEST');
    expect(summary().textContent).toContain('DEMO SIMULATION · NO PROVIDER CALLS');
  });

  it('collapses to a live compact header and expands current content', async () => {
    vi.useFakeTimers();
    startDemo();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize Demo Mission' }));
    const expand = screen.getByRole('button', { name: 'Expand Demo Mission' });
    expect(expand.textContent).toBe('+');
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(summary().textContent).not.toContain('FOUNDER REQUEST');
    expect(summary().textContent).toContain('DEMO MISSION · READY');
    expect(summary().textContent).toContain('DEMO SIMULATION · NO PROVIDER CALLS');

    await act(async () => vi.advanceTimersByTime(RELAY_DEMO_SCRIPT[0].durationMs));
    expect(summary().textContent).toContain('MISSION CONTRACT CREATED');
    await act(async () => vi.advanceTimersByTime(RELAY_DEMO_SCRIPT[1].durationMs));
    expect(summary().textContent).toContain('ANALYZING MISSION');

    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: 'Minimize Demo Mission' }).getAttribute('aria-expanded')).toBe('true');
    expect(summary().textContent).toContain('ChatGPT · Prompt Architect');
    expect(summary().textContent).toContain('FOUNDER REQUEST');
  });

  it('continues autoplay to completion while collapsed without another timer', async () => {
    vi.useFakeTimers();
    startDemo();
    const timersBeforeCollapse = vi.getTimerCount();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize Demo Mission' }));
    const expand = screen.getByRole('button', { name: 'Expand Demo Mission' });
    expect(vi.getTimerCount()).toBe(timersBeforeCollapse);

    for (const step of RELAY_DEMO_SCRIPT.slice(0, -1)) {
      await act(async () => vi.advanceTimersByTime(step.durationMs));
    }
    expect(summary().textContent).toContain('DEMO MISSION · DEMO VERIFIED COMPLETE');
    expect(summary().textContent).toContain('DEMO SIMULATION · NO PROVIDER CALLS');
    fireEvent.click(expand);
    expect(summary().textContent).toContain('Hermes approved demo-r2');
  });

  it('does not exit, restart, reset, dispatch, or alter the real store', () => {
    const store = getRelayAppStore();
    const reset = vi.spyOn(store, 'resetAll');
    const begin = vi.spyOn(store, 'beginLiveMission');
    const cancel = vi.spyOn(store, 'cancelLiveMission');
    const before = JSON.stringify(store.getState());
    startDemo();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize Demo Mission' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Demo Mission' }));
    expect(screen.getByRole('group', { name: 'Demo Simulation controls' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Demo Simulation controls' })).getByRole('button', { name: 'PAUSE' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse DEV PREVIEW controls' }));
    expect(reset).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState())).toBe(before);
  });

  it('remains independent from DEV PREVIEW collapse and uses native keyboard semantics', () => {
    startDemo();
    const summaryToggle = screen.getByRole('button', { name: 'Minimize Demo Mission' });
    expect(summaryToggle.tagName).toBe('BUTTON');
    summaryToggle.focus();
    expect(document.activeElement).toBe(summaryToggle);

    fireEvent.click(summaryToggle);
    expect(screen.getByRole('button', { name: 'Collapse DEV PREVIEW controls' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand Demo Mission' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse DEV PREVIEW controls' }));
    expect(screen.getByRole('button', { name: 'Expand Demo Mission' })).toBeTruthy();
  });

  it('preserves collapsed state while switching Workspace and Console', () => {
    startDemo();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize Demo Mission' }));
    expect(screen.getByRole('button', { name: 'Expand Demo Mission' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'CONSOLE' }));
    expect(screen.getByRole('button', { name: 'Expand Demo Mission' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'WORKSPACE' }));
    expect(screen.getByRole('button', { name: 'Expand Demo Mission' })).toBeTruthy();
  });
});

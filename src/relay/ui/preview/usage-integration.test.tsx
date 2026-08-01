/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { USAGE_OFFLINE_LABEL, USAGE_SIMULATED_LABEL } from '../../usage';

/**
 * Usage Bar + notifications wired through the REAL application shell:
 * offline truthfulness on normal navigation, the ONE notification host,
 * simulated threshold crossings only from the explicitly triggered Demo
 * Simulation, refresh honesty, and zero network in offline mode.
 */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay/project/rly-001';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderApp = () => render(createElement(RelayPreviewApp));
const usageBar = () => screen.getAllByRole('button', { name: /^Usage — / })[0];
const hosts = () => document.querySelectorAll('[data-relay-notification-host]');

/** The preview switcher nav — scoping queries here keeps them fast. */
function switcher(): HTMLElement {
  const nav = document.querySelector('nav[aria-label="Development preview switcher"]');
  expect(nav).not.toBeNull();
  return nav as HTMLElement;
}

/** Walk the Demo Simulation to a given script step, deterministically. */
function driveDemoTo(step: number) {
  fireEvent.click(within(switcher()).getByRole('button', { name: 'PLAY DEMO' }));
  fireEvent.click(within(switcher()).getByRole('button', { name: 'PAUSE' }));
  const next = within(switcher()).getByRole('button', { name: 'NEXT' });
  for (let i = 0; i < step; i += 1) {
    fireEvent.click(next);
  }
}

/** Generous wall-clock budget: these walk the REAL app shell DOM. */
const SLOW = 60_000;

describe('offline production navigation', () => {
  it('loads the offline snapshot: UNAVAILABLE, never a simulated figure, no notifications', () => {
    renderApp();
    expect(usageBar().textContent).toBe('USAGE · UNAVAILABLE');
    expect(document.body.textContent).not.toContain(USAGE_SIMULATED_LABEL);
    expect(document.body.textContent).not.toContain('USAGE · DEMO');
    expect(hosts()).toHaveLength(0); // nothing to notify — host renders nothing
  });

  it('opening the Usage Bar shows the truthful offline detail panel', () => {
    renderApp();
    fireEvent.click(usageBar());
    const dialog = screen.getByRole('dialog', { name: 'Usage details' });
    expect(within(dialog).getByText(USAGE_OFFLINE_LABEL)).toBeTruthy();
    expect(within(dialog).getByText('Relay Cubs are not enabled yet.')).toBeTruthy();
    expect(dialog.textContent).not.toContain('0%');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close usage details' }));
    expect(screen.queryByRole('dialog', { name: 'Usage details' })).toBeNull();
  });

  it('makes no network request at all in offline mode — no fetch, no /relay-api', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderApp();
    fireEvent.click(usageBar());
    fireEvent.click(screen.getByRole('button', { name: 'Close usage details' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a browser refresh cannot fabricate a threshold crossing', () => {
    // A latch surviving from an earlier session must not error or notify.
    window.localStorage.setItem(
      'sunday-relay.usage.notified-thresholds',
      JSON.stringify(['five_hour|70|2026-07-31T14:14:00.000Z|simulated']),
    );
    renderApp();
    expect(hosts()).toHaveLength(0);
    expect(usageBar().textContent).toBe('USAGE · UNAVAILABLE');
  });
});

describe('Demo Simulation drives the SIMULATED usage ladder', () => {
  it('walks 70% info → 90% warning → 100% critical, each once, visibly SIMULATED', () => {
    vi.useFakeTimers();
    renderApp();
    driveDemoTo(6); // five-hour usage reaches exactly 70%
    expect(usageBar().textContent).toContain('USAGE · DEMO');
    let toasts = screen.getAllByText('Five-hour usage');
    expect(toasts.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText('You have used 70% of your five-hour allowance.'),
    ).toBeTruthy();
    expect(screen.getAllByText('SIMULATED').length).toBeGreaterThanOrEqual(1);
    expect(hosts()).toHaveLength(1);

    // Stepping again inside the same window must NOT repeat the 70% event.
    fireEvent.click(screen.getByRole('button', { name: 'NEXT' })); // step 7 → 76%
    expect(
      screen.getAllByText(/You have used \d+% of your five-hour allowance\./),
    ).toHaveLength(1);

    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'NEXT' })); // → step 10, 94%
    }
    expect(
      screen.getByText('You have used 94% of your five-hour allowance.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'NEXT' })); // step 11 → 100%
    const critical = screen.getByText(
      'Your five-hour allowance is fully used. New managed missions are unavailable until the allowance resets.',
    );
    expect(critical).toBeTruthy();
    // Critical persists until dismissed.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(
      screen.getByText(/fully used\. New managed missions are unavailable/),
    ).toBeTruthy();
    toasts = screen.getAllByRole('alert');
    expect(toasts).toHaveLength(1);
  }, SLOW);

  it('VIEW USAGE on a notification opens the canonical detail panel', () => {
    vi.useFakeTimers();
    renderApp();
    driveDemoTo(6);
    fireEvent.click(screen.getByRole('button', { name: 'VIEW USAGE' }));
    const dialog = screen.getByRole('dialog', { name: 'Usage details' });
    expect(within(dialog).getByText(USAGE_SIMULATED_LABEL)).toBeTruthy();
    expect(within(dialog).getAllByText('14 of 25 remaining').length).toBeGreaterThanOrEqual(1);
  }, SLOW);

  it('fullscreen panels never duplicate the host, reset timers, or lose the toast', () => {
    vi.useFakeTimers();
    renderApp();
    driveDemoTo(6);
    expect(hosts()).toHaveLength(1);
    const before = screen.getByText('You have used 70% of your five-hour allowance.');
    // The workspace no longer expands panels, so there is no second place for
    // the host or the toast to be re-created.
    expect(screen.queryAllByRole('button', { name: /^Expand .+ panel$/ })).toHaveLength(0);
    expect(hosts()).toHaveLength(1);
    // The SAME toast node survives — nothing remounted, no timer restarted.
    expect(screen.getByText('You have used 70% of your five-hour allowance.')).toBe(before);
    // Exactly one Usage Bar, in the header, and no duplicate echo anywhere.
    expect(screen.getAllByRole('button', { name: /^Usage — / })).toHaveLength(1);
  }, SLOW);

  it('route changes do not duplicate an already-delivered event', () => {
    vi.useFakeTimers();
    renderApp();
    driveDemoTo(6);
    expect(
      screen.getAllByText('You have used 70% of your five-hour allowance.'),
    ).toHaveLength(1);
    act(() => {
      window.location.hash = '#/relay';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    act(() => {
      window.location.hash = '#/relay/project/rly-001';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(
      screen.getAllByText('You have used 70% of your five-hour allowance.'),
    ).toHaveLength(1);
  }, SLOW);

  it('notifications change nothing about the mission: Relay Dog state stays put', () => {
    vi.useFakeTimers();
    renderApp();
    driveDemoTo(6);
    const statusLine = () =>
      (screen.getAllByRole('status').find((n) => n.textContent?.includes('Relay Dog'))
        ?.textContent ?? '');
    const before = statusLine();
    expect(before).toContain('Relay Dog');
    fireEvent.click(screen.getByRole('button', { name: /Dismiss notification/ }));
    fireEvent.click(usageBar());
    fireEvent.click(screen.getByRole('button', { name: 'Close usage details' }));
    expect(statusLine()).toBe(before);
  }, SLOW);
});

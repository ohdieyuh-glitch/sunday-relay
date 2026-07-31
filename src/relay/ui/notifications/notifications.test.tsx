/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type MutableRefObject } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  RELAY_NOTIFICATION_DURATION_MS,
  RELAY_NOTIFICATION_MAX_VISIBLE,
} from './notification-contracts';
import type { RelayNotificationInput } from './notification-contracts';
import { RelayNotificationHost } from './RelayNotificationHost';
import {
  useRelayNotificationCenter,
  type RelayNotificationCenter,
} from './useRelayNotificationCenter';

/**
 * The canonical top-right notification system: timing per kind, persistent
 * critical, max-three stack with a queue, hover/focus pause, dedupe, visible
 * dismiss labels, actions, reduced motion, and truthful announcements.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({
  centerRef,
  reducedMotion = false,
}: {
  centerRef: MutableRefObject<RelayNotificationCenter | null>;
  reducedMotion?: boolean;
}) {
  const center = useRelayNotificationCenter();
  centerRef.current = center;
  return createElement(RelayNotificationHost, {
    notifications: center.visible,
    queuedCount: center.queuedCount,
    onDismiss: center.dismiss,
    onPause: center.pauseTimers,
    onResume: center.resumeTimers,
    reducedMotion,
  });
}

function mount(reducedMotion = false) {
  const centerRef: MutableRefObject<RelayNotificationCenter | null> = { current: null };
  const view = render(createElement(Harness, { centerRef, reducedMotion }));
  const publish = (input: RelayNotificationInput) => {
    act(() => centerRef.current?.publish(input));
  };
  return { centerRef, publish, view };
}

const info = (title = 'Heads up', extra: Partial<RelayNotificationInput> = {}) =>
  ({ kind: 'info', title, ...extra }) as RelayNotificationInput;

describe('canonical timing', () => {
  it('the duration table is the single source: 5s info/success, 7s warning, persistent critical', () => {
    expect(RELAY_NOTIFICATION_DURATION_MS.info).toBe(5_000);
    expect(RELAY_NOTIFICATION_DURATION_MS.success).toBe(5_000);
    expect(RELAY_NOTIFICATION_DURATION_MS.warning).toBe(7_000);
    expect(RELAY_NOTIFICATION_DURATION_MS.critical).toBeNull();
    expect(RELAY_NOTIFICATION_MAX_VISIBLE).toBe(3);
  });

  it('an informational notification disappears on its own', async () => {
    vi.useFakeTimers();
    const { publish } = mount();
    publish(info());
    expect(screen.getByText('Heads up')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(4_999));
    expect(screen.getByText('Heads up')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(2));
    expect(screen.queryByText('Heads up')).toBeNull();
  });

  it('a warning stays longer than an info', async () => {
    vi.useFakeTimers();
    const { publish } = mount();
    publish({ kind: 'warning', title: 'Careful now' });
    await act(async () => vi.advanceTimersByTime(6_000));
    expect(screen.getByText('Careful now')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1_100));
    expect(screen.queryByText('Careful now')).toBeNull();
  });

  it('a critical notification never auto-dismisses — only the user removes it', async () => {
    vi.useFakeTimers();
    const { publish } = mount();
    publish({ kind: 'critical', title: 'Limit reached' });
    await act(async () => vi.advanceTimersByTime(600_000));
    expect(screen.getByText('Limit reached')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss notification: Limit reached/ }));
    expect(screen.queryByText('Limit reached')).toBeNull();
  });
});

describe('stack and queue', () => {
  it('shows at most three; excess queues; closing one advances the queue', () => {
    const { publish } = mount();
    for (const n of [1, 2, 3, 4, 5]) publish({ kind: 'critical', title: `Item ${n}` });
    expect(screen.getByText('Item 1')).toBeTruthy();
    expect(screen.getByText('Item 3')).toBeTruthy();
    expect(screen.queryByText('Item 4')).toBeNull();
    expect(screen.getByText('+ 2 more waiting')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss notification: Item 1/ }));
    expect(screen.getByText('Item 4')).toBeTruthy();
    expect(screen.getByText('+ 1 more waiting')).toBeTruthy();
  });

  it('suppresses duplicate events by dedupe key, including while queued', () => {
    const { publish } = mount();
    publish(info('Only once', { dedupeKey: 'usage:70' }));
    publish(info('Only once', { dedupeKey: 'usage:70' }));
    expect(screen.getAllByText('Only once')).toHaveLength(1);
  });
});

describe('pause behaviour', () => {
  it('hovering the stack pauses dismissal; leaving resumes it', async () => {
    vi.useFakeTimers();
    const { publish } = mount();
    publish(info('Hover me'));
    const host = document.querySelector('[data-relay-notification-host]');
    expect(host).not.toBeNull();
    fireEvent.mouseEnter(host as Element);
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Hover me')).toBeTruthy();
    fireEvent.mouseLeave(host as Element);
    await act(async () => vi.advanceTimersByTime(5_100));
    expect(screen.queryByText('Hover me')).toBeNull();
  });

  it('keyboard focus pauses dismissal — reading time is never hover-only', async () => {
    vi.useFakeTimers();
    const { publish } = mount();
    publish(info('Focus me'));
    const dismiss = screen.getByRole('button', { name: /Dismiss notification: Focus me/ });
    act(() => dismiss.focus());
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Focus me')).toBeTruthy();
    act(() => dismiss.blur());
    await act(async () => vi.advanceTimersByTime(5_100));
    expect(screen.queryByText('Focus me')).toBeNull();
  });
});

describe('actions and labels', () => {
  it('runs a notification action (VIEW USAGE) and keeps dismiss visibly labeled', () => {
    const onView = vi.fn();
    const { publish } = mount();
    publish(
      info('Five-hour usage', {
        actions: [{ id: 'view-usage', label: 'VIEW USAGE', onSelect: onView }],
      }),
    );
    const action = screen.getByRole('button', { name: 'VIEW USAGE' });
    fireEvent.click(action);
    expect(onView).toHaveBeenCalledTimes(1);
    // The dismiss control shows the word DISMISS — never an unlabeled glyph.
    expect(screen.getByRole('button', { name: /Dismiss notification/ }).textContent).toBe(
      'DISMISS',
    );
  });

  it('a simulated event is visibly labeled SIMULATED on the toast', () => {
    const { publish } = mount();
    publish(info('Demo warning', { simulated: true }));
    expect(screen.getByText('SIMULATED')).toBeTruthy();
  });
});

describe('announcements', () => {
  it('critical is an alert (announced once); others are polite status', () => {
    const { publish } = mount();
    publish({ kind: 'critical', title: 'Limit reached' });
    publish(info('Just so you know'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(1);
  });
});

describe('reduced motion and placement', () => {
  it('reducedMotion adds the static modifier; the stylesheet backs both channels', () => {
    const { publish } = mount(true);
    publish(info('Calm'));
    expect(document.querySelector('.rnt-host--static')).not.toBeNull();
    const css = readFileSync(join(__dirname, 'relay-notifications.css'), 'utf8');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toMatch(/\.rnt-host--static \.rnt-toast \{ animation: none; \}/);
  });

  it('the stylesheet keeps mobile placement safe: below the header, inside safe areas, touch targets', () => {
    const css = readFileSync(join(__dirname, 'relay-notifications.css'), 'utf8');
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*safe-area-inset-top/);
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*min-height: 44px/);
    // Desktop: fixed top-right, above the focused-panel context (62), below
    // the mobile menu (90).
    expect(css).toMatch(/\.rnt-host \{[\s\S]*?position: fixed/);
    expect(css).toMatch(/z-index: 70/);
  });
});

describe('hygiene', () => {
  it('unmounting clears every pending timer', async () => {
    vi.useFakeTimers();
    const { publish, view } = mount();
    publish(info('Bye'));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('source boundary: no network, no providers, no storage, no Node imports', () => {
    const files = readdirSync(__dirname)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
      .map((f) => readFileSync(join(__dirname, f), 'utf8'))
      .join('\n');
    expect(files).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
    expect(files).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(files).not.toMatch(/from\s+['"]node:/);
    expect(files).not.toMatch(/api\.anthropic\.com|api\.openai\.com|relay-api/);
  });
});

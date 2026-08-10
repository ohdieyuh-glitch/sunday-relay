/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { RelayLiveReachSettings } from './RelayLiveReachSettings';
import {
  EMPTY_LIVE_REACH_SETTINGS,
  acknowledgeGlobalNotice,
  acknowledgeSourceNotice,
  setCapability,
  setGroup,
  type BackendProbe,
} from '../../mission/live-reach';

/**
 * THE SETTINGS SURFACE — visible defaults, honest capabilities, notices once.
 *
 * The direction's specific fears, each held by a test: that default-enabled
 * gets buried; that the screen shows toggles for things Relay cannot do; that
 * the notices nag; and that READY becomes something a screen can assert.
 */

afterEach(cleanup);

const READY: readonly BackendProbe[] = Object.freeze([
  { backendId: 'relay_http_fetch', capability: 'read_item', result: 'observed', probedAt: '2026-08-10T12:00:00.000Z' },
]);

const open = (name: RegExp) => { fireEvent.click(screen.getByRole('button', { name })); };

/** Open a source by its id — stable, unlike a label that carries a status word. */
const openSource = (source: string) => {
  const row = document.querySelector(`[data-source="${source}"]`);
  if (row === null) throw new Error(`no row for ${source}`);
  fireEvent.click(row);
};
const row = (source: string): HTMLElement => {
  const node = document.querySelector(`[data-source="${source}"]`);
  if (node === null) throw new Error(`no row for ${source}`);
  return node as HTMLElement;
};

describe('default-enabled is stated, not buried', () => {
  it('says so on first entry, before any source is opened', () => {
    render(<RelayLiveReachSettings settings={EMPTY_LIVE_REACH_SETTINGS} />);
    const notice = document.querySelector('[data-notice="global"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('enabled by default');
    // And the limit is stated in the same breath, because "enabled" is the
    // half a founder could misread.
    expect(notice?.textContent).toContain('not permission to use it');
  });

  it('offers keep, manage and disable-all', () => {
    render(<RelayLiveReachSettings settings={EMPTY_LIVE_REACH_SETTINGS} />);
    expect(screen.getByRole('button', { name: 'KEEP ENABLED' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'MANAGE INDIVIDUALLY' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DISABLE ALL' })).toBeTruthy();
  });

  it('disables everything and acknowledges in one action', () => {
    const onDisableAll = vi.fn();
    const onAcknowledgeGlobal = vi.fn();
    render(
      <RelayLiveReachSettings
        settings={EMPTY_LIVE_REACH_SETTINGS}
        onDisableAll={onDisableAll}
        onAcknowledgeGlobal={onAcknowledgeGlobal}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'DISABLE ALL' }));
    expect(onDisableAll).toHaveBeenCalledTimes(1);
    // Acknowledged too: a founder who just turned everything off must not be
    // shown the same notice again.
    expect(onAcknowledgeGlobal).toHaveBeenCalledTimes(1);
  });

  it('does not show the notice again once acknowledged', () => {
    render(
      <RelayLiveReachSettings
        settings={acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T12:00:00.000Z')}
      />,
    );
    expect(document.querySelector('[data-notice="global"]')).toBeNull();
  });
});

describe('the per-source notice', () => {
  const acknowledged = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T12:00:00.000Z');

  it('appears on first entry to THAT source, and is separate from the global one', () => {
    render(<RelayLiveReachSettings settings={acknowledged} probes={READY} />);
    expect(document.querySelector('[data-notice="github"]')).toBeNull();
    open(/GitHub/);
    const notice = document.querySelector('[data-notice="github"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('GitHub access is currently enabled');
  });

  it('is acknowledged per source, so another source still shows its own', () => {
    const settings = acknowledgeSourceNotice(acknowledged, 'github', '2026-08-10T12:01:00.000Z');
    render(<RelayLiveReachSettings settings={settings} probes={READY} />);
    open(/GitHub/);
    expect(document.querySelector('[data-notice="github"]')).toBeNull();
    open(/GitHub/); // collapse
    openSource('web');
    expect(document.querySelector('[data-notice="web"]')).not.toBeNull();
  });

  it('shows no notice for a source Relay cannot reach at all', () => {
    render(<RelayLiveReachSettings settings={acknowledged} />);
    open(/LinkedIn/);
    // Nothing is enabled there, so telling a founder it is enabled would be
    // false. The panel explains the absence instead.
    expect(document.querySelector('[data-notice="linkedin"]')).toBeNull();
    expect(screen.getByText(/no backend for this source/i)).toBeTruthy();
  });
});

describe('only capabilities that exist get a control', () => {
  const acknowledged = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T12:00:00.000Z');

  it('shows read capabilities the registry actually implements', () => {
    render(<RelayLiveReachSettings settings={acknowledged} probes={READY} onSetCapability={vi.fn()} onSetGroup={vi.fn()} />);
    open(/GitHub/);
    const eyes = screen.getByRole('group', { name: /EYES/i });
    expect(within(eyes).getByLabelText(/Search/)).toBeTruthy();
    expect(within(eyes).getByLabelText(/Read a page or item/)).toBeTruthy();
  });

  it('shows NO action toggle anywhere, and says why', () => {
    render(<RelayLiveReachSettings settings={acknowledged} probes={READY} onSetCapability={vi.fn()} onSetGroup={vi.fn()} />);
    open(/GitHub/);
    const actions = screen.getByRole('group', { name: /ACTIONS/i });
    expect(within(actions).queryAllByRole('checkbox')).toHaveLength(0);
    expect(actions.textContent).toContain('No backend implements one');
  });

  it('renders state without inputs for a host that cannot store a choice', () => {
    render(<RelayLiveReachSettings settings={acknowledged} probes={READY} />);
    open(/GitHub/);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getAllByText('ON').length).toBeGreaterThan(0);
  });
});

describe('the toggles report the real resolved state', () => {
  const acknowledged = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T12:00:00.000Z');

  it('shows a capability as ON by default with no stored setting', () => {
    render(<RelayLiveReachSettings settings={acknowledged} probes={READY} onSetCapability={vi.fn()} onSetGroup={vi.fn()} />);
    open(/GitHub/);
    expect((screen.getByLabelText(/Search/) as HTMLInputElement).checked).toBe(true);
  });

  it('shows a capability turned off by its own switch', () => {
    const settings = setCapability(acknowledged, 'github', 'search', false);
    render(<RelayLiveReachSettings settings={settings} probes={READY} onSetCapability={vi.fn()} onSetGroup={vi.fn()} />);
    open(/GitHub/);
    expect((screen.getByLabelText(/Search/) as HTMLInputElement).checked).toBe(false);
  });

  it('shows every capability off when the integration is off', () => {
    const settings = setGroup(acknowledged, 'github', 'integration', false);
    render(<RelayLiveReachSettings settings={settings} probes={READY} onSetCapability={vi.fn()} onSetGroup={vi.fn()} />);
    open(/GitHub/);
    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
  });

  it('reports a change to the host rather than storing it locally', () => {
    const onSetCapability = vi.fn();
    render(
      <RelayLiveReachSettings
        settings={acknowledged}
        probes={READY}
        onSetCapability={onSetCapability}
        onSetGroup={vi.fn()}
      />,
    );
    open(/GitHub/);
    fireEvent.click(screen.getByLabelText(/Search/));
    expect(onSetCapability).toHaveBeenCalledWith('github', 'search', false);
    // The surface does NOT flip it itself — the stored settings are the truth,
    // and a local copy would let the screen disagree with the permission model.
    expect((screen.getByLabelText(/Search/) as HTMLInputElement).checked).toBe(true);
  });
});

describe('readiness is displayed, never asserted', () => {
  const acknowledged = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T12:00:00.000Z');

  it('says UNKNOWN when nothing has been probed', () => {
    render(<RelayLiveReachSettings settings={acknowledged} />);
    const row = screen.getByRole('button', { name: /GitHub/ });
    expect(row.textContent).toContain('UNKNOWN');
    expect(row.textContent).not.toContain('READY');
  });

  it('says READY only where a probe observed an answer', () => {
    render(<RelayLiveReachSettings settings={acknowledged} probes={READY} />);
    expect(row('web').textContent).toContain('READY');
    // A source with no probe of its own does not inherit another's.
    expect(screen.getByRole('button', { name: /Reddit/ }).textContent).not.toContain('READY');
  });

  it('says CAPABILITY UNSUPPORTED for a source with no backend', () => {
    render(<RelayLiveReachSettings settings={acknowledged} />);
    expect(screen.getByRole('button', { name: /LinkedIn/ }).textContent)
      .toContain('CAPABILITY UNSUPPORTED');
  });

  it('reports authentication and rate limits as themselves', () => {
    const probes: BackendProbe[] = [
      { backendId: 'relay_http_fetch', capability: 'read_item', result: 'unauthenticated', probedAt: '2026-08-10T12:00:00.000Z' },
    ];
    render(<RelayLiveReachSettings settings={acknowledged} probes={probes} />);
    expect(row('web').textContent).toContain('AUTHENTICATION REQUIRED');
  });
});

describe('progressive disclosure', () => {
  it('opens one source at a time rather than listing every capability at once', () => {
    const acknowledged = acknowledgeGlobalNotice(EMPTY_LIVE_REACH_SETTINGS, '2026-08-10T12:00:00.000Z');
    render(<RelayLiveReachSettings settings={acknowledged} probes={READY} onSetCapability={vi.fn()} onSetGroup={vi.fn()} />);
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    open(/GitHub/);
    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
    openSource('web');
    // GitHub collapsed when Web opened: one panel, not a wall.
    expect(screen.getByRole('button', { name: /GitHub/ }).getAttribute('aria-expanded')).toBe('false');
  });
});

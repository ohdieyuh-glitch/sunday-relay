/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { RelayPreviewApp, parsePreviewHash } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { capabilityState, evaluateLiveReach } from '../../mission/live-reach';

/**
 * LIVE REACH SETTINGS ARE REAL SETTINGS.
 *
 * The direction's requirement is precise: these cannot be decorative frontend
 * switches. So what is proven here is not that a checkbox moves — it is that
 * turning one off changes what the REAL permission evaluation answers, and
 * that the answer survives a reload.
 */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay';
});
afterEach(cleanup);

const openRoute = () => {
  window.location.hash = '#/relay/live-reach';
  return render(createElement(RelayPreviewApp));
};

const openSource = (source: string) => {
  const row = document.querySelector(`[data-source="${source}"]`);
  if (row === null) throw new Error(`no row for ${source}`);
  fireEvent.click(row);
};

describe('the route exists in the shipped application', () => {
  it('parses and renders', () => {
    expect(parsePreviewHash('#/relay/live-reach')).toEqual({ screen: 'live-reach' });
    openRoute();
    expect(screen.getByRole('heading', { name: 'LIVE REACH' })).toBeTruthy();
  });

  it('shows the global notice on a browser that has never been here', () => {
    openRoute();
    expect(document.querySelector('[data-notice="global"]')).not.toBeNull();
  });
});

describe('a toggle changes what the permission model answers', () => {
  it('turns a capability off, and the real evaluation then refuses it', () => {
    const store = getRelayAppStore();
    // Before: the default. Enabled, and a permitted request is allowed.
    expect(capabilityState('github', 'search', store.getState().liveReach).enabled).toBe(true);

    openRoute();
    openSource('github');
    fireEvent.click(screen.getByLabelText(/Search/));

    const settings = store.getState().liveReach;
    expect(capabilityState('github', 'search', settings).enabled).toBe(false);

    // THE POINT: the same evaluation the retrieval path runs now refuses.
    const decision = evaluateLiveReach({
      source: 'github',
      capability: 'search',
      settings,
      missionAuthorises: true,
      ready: true,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('capability_disabled');
  });

  it('turns the whole integration off from one control', () => {
    const store = getRelayAppStore();
    openRoute();
    fireEvent.click(screen.getByRole('button', { name: 'DISABLE ALL' }));

    const settings = store.getState().liveReach;
    for (const source of ['web', 'github', 'rss'] as const) {
      const decision = evaluateLiveReach({
        source, capability: 'read_item', settings, missionAuthorises: true, ready: true,
      });
      expect(decision.allowed, source).toBe(false);
    }
  });
});

describe('the choice survives a reload', () => {
  it('keeps a disabled capability disabled', () => {
    openRoute();
    openSource('github');
    fireEvent.click(screen.getByLabelText(/Search/));
    cleanup();

    // A fresh store reading persisted state — what a refresh does.
    const reloaded = getRelayAppStore();
    expect(capabilityState('github', 'search', reloaded.getState().liveReach).enabled).toBe(false);
    openRoute();
    openSource('github');
    expect((screen.getByLabelText(/Search/) as HTMLInputElement).checked).toBe(false);
  });

  it('keeps the notices acknowledged, so they are shown once and not again', () => {
    openRoute();
    fireEvent.click(screen.getByRole('button', { name: 'KEEP ENABLED' }));
    expect(document.querySelector('[data-notice="global"]')).toBeNull();
    cleanup();

    openRoute();
    expect(document.querySelector('[data-notice="global"]')).toBeNull();
  });

  it('acknowledges a source notice separately from the global one', () => {
    openRoute();
    fireEvent.click(screen.getByRole('button', { name: 'KEEP ENABLED' }));
    openSource('github');
    fireEvent.click(screen.getByRole('button', { name: 'GOT IT' }));
    cleanup();

    openRoute();
    openSource('github');
    expect(document.querySelector('[data-notice="github"]')).toBeNull();
    openSource('github');
    openSource('web');
    // A different source has its own first entry, still to come.
    expect(document.querySelector('[data-notice="web"]')).not.toBeNull();
  });
});

describe('a store written before Live Reach existed', () => {
  it('keeps its projects and expresses no preference', () => {
    const store = getRelayAppStore();
    store.createDraftFromRequest('An older build wrote this');
    const raw = window.localStorage.getItem('relay.app.v1')
      ?? window.localStorage.getItem(Object.keys(window.localStorage)[0] ?? '');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    delete parsed.liveReach;
    window.localStorage.setItem(Object.keys(window.localStorage)[0] as string, JSON.stringify(parsed));

    const reloaded = getRelayAppStore();
    reloaded.init();
    expect(reloaded.listProjects().length).toBeGreaterThan(0);
    // Absent means DEFAULT, not denied.
    expect(capabilityState('web', 'read_item', reloaded.getState().liveReach).enabled).toBe(true);
  });
});

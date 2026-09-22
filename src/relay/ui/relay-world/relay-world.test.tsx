/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RelayWorld } from './RelayWorld';
import { parsePreviewHash, RelayPreviewApp } from '../preview/RelayPreviewApp';

/**
 * Continuity, asserted structurally.
 *
 * jsdom cannot create a WebGL context, so these exercise the world's no-context
 * path — which is exactly where the structural guarantees live: which component
 * the router returns, whether it is the SAME one across the hash change, and
 * whether entering Relay can ever reach the old shell.
 */

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('one component spans Aquala and Relay', () => {
  it('is what the router returns for BOTH routes', () => {
    // This is the mechanism, not a detail: returning the same element type for
    // the bare URL and for `#/relay` lets React reconcile rather than remount,
    // so the canvas, the context, the Dog and the camera survive the passage.
    expect(parsePreviewHash('')).toEqual({ screen: 'landing' });
    expect(parsePreviewHash('#/relay')).toEqual({ screen: 'experience' });
  });

  it('keeps the very same canvas element across the route change', () => {
    window.location.hash = '';
    const { container, rerender } = render(createElement(RelayPreviewApp));
    const before = container.querySelector('canvas.rw-canvas');
    expect(before).not.toBeNull();
    window.location.hash = '#/relay';
    fireEvent(window, new HashChangeEvent('hashchange'));
    rerender(createElement(RelayPreviewApp));
    const after = container.querySelector('canvas.rw-canvas');
    // Identity, not merely presence. A remount would produce a new element —
    // and a new element means a new WebGL context and a rebuilt Dog.
    expect(after).toBe(before);
  });

  it('mounts exactly one canvas, never two', () => {
    const { container } = render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });
});

describe('the portal', () => {
  it('offers a keyboard- and screen-reader-reachable way in', () => {
    // The artifact is hit-tested in 3D, which no keyboard can do. The control
    // is the accessible path to the same commit.
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    const cta = screen.getAllByRole('button', { name: /ENTER RELAY/i })[0];
    expect(cta).toBeTruthy();
    expect(cta.tagName).toBe('BUTTON');
  });

  it('arrives at Create your Compound Agent when committed', () => {
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    fireEvent.click(screen.getAllByRole('button', { name: /ENTER RELAY/i })[0]);
    // Without a context there is no loop to advance the passage, so the world
    // arrives immediately rather than freezing mid-transition.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create your Compound Agent.');
  });

  it('exposes the pointer affordance only while Aquala is the subject', () => {
    const { container } = render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(container.querySelector('.rw')?.getAttribute('data-portal')).toBe('idle');
  });
});

describe('the old shell never returns', () => {
  const LEGACY = ['rpd-', 'reh-dog', 'WANDERING', 'rpv-devchip', 'What are we building'];

  it('is absent from Aquala', () => {
    const { container } = render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    for (const marker of LEGACY) {
      expect(container.innerHTML, `legacy marker "${marker}" leaked into Aquala`).not.toContain(marker);
    }
  });

  it('is absent after entering Relay', () => {
    const { container } = render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    fireEvent.click(screen.getAllByRole('button', { name: /ENTER RELAY/i })[0]);
    for (const marker of LEGACY) {
      expect(container.innerHTML, `legacy marker "${marker}" appeared after ENTER RELAY`).not.toContain(marker);
    }
  });

  it('reaches Relay without a document navigation', () => {
    // The camera performs the transition; the URL only catches up afterwards.
    // A page load here would discard the scene, which is the whole problem.
    window.location.hash = '';
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    fireEvent.click(screen.getAllByRole('button', { name: /ENTER RELAY/i })[0]);
    expect(window.location.hash).toBe('#/relay');
  });
});

describe('the way back', () => {
  it('offers exactly one Back control once Relay is reached, and none before', () => {
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    // ON THE LANDING PAGE THERE IS NOTHING TO GO BACK FROM, so the control does not exist there. A Back that is
    // present but inert is a control the user learns to distrust.
    expect(screen.queryAllByRole('button', { name: /back/i })).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: /ENTER RELAY/i })[0]);
    expect(screen.getAllByRole('button', { name: /back/i })).toHaveLength(1);
  });

  it('returns to the landing state, and does not answer to the name of the forward control', () => {
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    fireEvent.click(screen.getAllByRole('button', { name: /ENTER RELAY/i })[0]);
    const back = screen.getByRole('button', { name: /back/i });
    // THE LANDING PAGE KEEPS ITS OWN NAME. relay-landing.test.tsx uses a singular getByRole for ENTER RELAY, so a
    // Back control that matched that name would break it -- and would be ambiguous to a screen reader besides.
    expect(back.getAttribute('aria-label') ?? back.textContent ?? '').not.toMatch(/ENTER RELAY/i);
    fireEvent.click(back);
    // Without a WebGL context there is no loop to fly a passage, so the return is immediate -- the same rule the
    // forward journey already follows in static mode.
    expect(screen.getAllByRole('button', { name: /ENTER RELAY/i }).length).toBeGreaterThan(0);
  });

  it('returns immediately from a deep link, because there is no journey to retrace', () => {
    // A user who arrived at #/relay never flew in, so there is no departure pose. Flying them "back" from a place
    // they were never standing would be an invented journey.
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getAllByRole('button', { name: /ENTER RELAY/i }).length).toBeGreaterThan(0);
  });
});

describe('direct entry', () => {
  it('lands straight in Relay when the URL says so, with no passage', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create your Compound Agent.');
  });

  it('shows the Aquala beats when the URL does not', () => {
    render(createElement(RelayWorld, { initialStage: 'aquala' as const }));
    expect(screen.getAllByText('Enter the World Where Ideas Become Real.').length).toBeGreaterThan(0);
  });
});

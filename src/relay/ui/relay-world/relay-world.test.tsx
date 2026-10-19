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

  /**
   * IT IS IN THE BRAND ROW, WHICH IS WHY IT CAN BE SEEN.
   *
   * FOUNDER (2026-09-24): "The user asked DAYS AGO for a BACK control on this
   * experience. It is still not visible in the actual deployed page."
   *
   * It WAS deployed, and it was invisible, and both were true at once: the
   * control was `position: fixed` at top 22px / left 24px, and `.rx-brand` is
   * `top: var(--rx-pad); left: var(--rx-pad)` — the same corner. Measured on the
   * production page, `.rw-back` sat at (24, 22) 45x26 with the SUNDAY RELAY
   * lockup at (24, 24) 143x16, drawn over each other. It answered a hit test and
   * a screen reader and could not be read by a person.
   *
   * A coordinate cannot be asserted in jsdom, which computes no layout — so this
   * asserts the STRUCTURE that makes the coordinate impossible to get wrong.
   * Inside the row, the wordmark's own width decides where the control starts,
   * at every breakpoint, with no offset for anyone to keep in step.
   */
  it('lives INSIDE the brand row, so it can never be drawn underneath the wordmark', () => {
    const { container } = render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    const back = screen.getByRole('button', { name: /back/i });
    const brand = container.querySelector('.rx-brand');
    expect(brand).not.toBeNull();
    expect(brand?.contains(back)).toBe(true);
    // And it is a SIBLING of the lockup, not a wrapper around it or a child of
    // it: the row places the two side by side.
    expect(back.parentElement).toBe(brand);
    expect(brand?.querySelector('.rx-wordmark')).not.toBeNull();
  });

  it('is still exactly one control, and still not styled as a second primary action', () => {
    const { container } = render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(container.querySelectorAll('.rw-back')).toHaveLength(1);
    // `.rl3-cta` is the landing's gold pill and `.rx-cta` the experience's. A
    // Back wearing either would read as a second thing to do rather than the way
    // out of the one being asked for.
    const back = screen.getByRole('button', { name: /back/i });
    expect(back.className).not.toContain('cta');
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

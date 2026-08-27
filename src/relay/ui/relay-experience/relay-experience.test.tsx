/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/** This repo does not load jest-dom, so disabledness is read off the element. */
const disabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled;
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { RelayWorld } from '../relay-world';
import { AGENT_STORAGE_KEY, activate, EMPTY_DRAFT, saveAgentDraft, type CompoundAgentDraft } from './onboarding';
import { parsePreviewHash } from '../preview/RelayPreviewApp';
import { RelayLanding } from '../landing/RelayLanding';
import { sceneAt } from '../landing/choreography';

/**
 * jsdom has no WebGL, so the experience renders here on its no-context path.
 * That is the right place to assert the STRUCTURAL invariants — which screen is
 * mounted, which Dog is on it, what gates activation — because none of those
 * may depend on a GPU being present.
 */

const complete = (): CompoundAgentDraft => ({
  ...EMPTY_DRAFT,
  name: 'Caesar',
  promptArchitectId: 'architect-sunday-alcatraz',
  codingAgentId: 'coding-claude-code',
  reviewerId: 'reviewer-hermes',
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('ENTER RELAY no longer leads to the old interface', () => {
  it('routes `#/relay` to the Relay experience, not the Entry Home', () => {
    expect(parsePreviewHash('#/relay')).toEqual({ screen: 'experience' });
  });

  it('keeps the old Entry Home reachable only at an explicit legacy route', () => {
    // Not deleted — it still holds working surfaces and its own tests — but
    // nothing in the new flow links to it.
    expect(parsePreviewHash('#/relay/home-legacy')).toEqual({ screen: 'home' });
  });

  it('leaves the landing at the bare URL and the console where it was', () => {
    expect(parsePreviewHash('')).toEqual({ screen: 'landing' });
    expect(parsePreviewHash('#/relay/console')).toEqual({ screen: 'console' });
  });
});

describe('THE 2D RELAY DOG IS ABSENT FROM THE NEW EXPERIENCE', () => {
  // A hard UI invariant. The old surface's pixel sprite (`rpd-*`) and the Entry
  // Home's wandering dog (`reh-dog`) must never appear in the new onboarding —
  // the character is a realtime 3D object or it is not the character.
  const legacyMarkers = ['rpd-', 'reh-dog', 'WANDERING', 'pixel-dog'];

  it('renders no legacy Dog markup in the Relay experience', () => {
    const html = renderToStaticMarkup(createElement(RelayWorld, { initialStage: 'relay' as const }));
    for (const marker of legacyMarkers) {
      expect(html, `legacy marker "${marker}" leaked into the Relay experience`).not.toContain(marker);
    }
  });

  it('renders no legacy Dog markup on the landing', () => {
    const html = renderToStaticMarkup(createElement(RelayLanding, {
      position: sceneAt(0),
      telemetry: { width: 1440, height: 900, dpr: 1, tier: 'high', fps: 60, webgl: false },
      anchors: [], reducedMotion: false, onEnterRelay: () => undefined, overPortal: false,
    }));
    for (const marker of legacyMarkers) {
      expect(html, `legacy marker "${marker}" leaked into the landing`).not.toContain(marker);
    }
  });

  it('mounts a canvas for the Dog, never an image', () => {
    const { container } = render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(container.querySelector('canvas.rw-canvas')).not.toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});

describe('creation flow', () => {
  it('opens on step one for a first-run user', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create your Compound Agent.');
  });

  it('will not advance past the name until one is given', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    const cta = screen.getByRole('button', { name: 'CONTINUE' });
    expect(disabled(cta)).toBe(true);
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Caesar' } });
    expect(disabled(screen.getByRole('button', { name: 'CONTINUE' }))).toBe(false);
  });

  it('shows the agent name as telemetry beside the Dog as it is typed', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'Caesar' } });
    expect(screen.getByText('Caesar')).toBeTruthy();
    expect(screen.getByText('FORMING')).toBeTruthy();
  });

  it('offers only role-appropriate, actually-selectable options in each slot', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    fireEvent.click(screen.getByRole('button', { name: '03' }));
    // The Coding Agent slot is coding tools — Claude Code is connected today.
    expect(disabled(screen.getByRole('button', { name: /Claude Code/ }))).toBe(false);
    // An option the product has not configured cannot be chosen.
    const comingLater = screen.getAllByText('COMING LATER');
    expect(comingLater.length).toBeGreaterThan(0);
  });

  it('persists a selection immediately', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    fireEvent.click(screen.getByRole('button', { name: '04' }));
    fireEvent.click(screen.getByRole('button', { name: /Hermes/ }));
    const stored = JSON.parse(localStorage.getItem(AGENT_STORAGE_KEY)!) as CompoundAgentDraft;
    expect(stored.reviewerId).toBe('reviewer-hermes');
  });

  it('gates ACTIVATE on a complete Compound Agent', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    fireEvent.click(screen.getByRole('button', { name: '08' }));
    expect(disabled(screen.getByRole('button', { name: 'ACTIVATE RELAY' }))).toBe(true);
  });

  it('activates a complete agent and offers Wonderland afterwards', () => {
    saveAgentDraft(complete());
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    fireEvent.click(screen.getByRole('button', { name: '08' }));
    const cta = screen.getByRole('button', { name: 'ACTIVATE RELAY' });
    expect(disabled(cta)).toBe(false);
    fireEvent.click(cta);
    expect(screen.getByRole('button', { name: 'ENTER WONDERLAND' })).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
  });

  it('never claims Wonderland is reachable when no bridge is configured', () => {
    // The honest state: the agent is ready, the entrance is not reachable from
    // this browser. A button that navigates nowhere would be a false claim.
    saveAgentDraft(activate(complete(), '2026-08-26T00:00:00.000Z'));
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(disabled(screen.getByRole('button', { name: 'ENTER WONDERLAND' }))).toBe(true);
    expect(screen.getByText(/ENTRANCE UNREACHABLE/)).toBeTruthy();
  });
});

describe('returning users', () => {
  it('are not marched through creation again', () => {
    saveAgentDraft(activate(complete(), '2026-08-26T00:00:00.000Z'));
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Activate Relay.');
    expect(screen.getByText('RETURNING')).toBeTruthy();
  });

  it('can still reconfigure, and stay in the new language while doing it', () => {
    saveAgentDraft(activate(complete(), '2026-08-26T00:00:00.000Z'));
    const { container } = render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    fireEvent.click(screen.getByRole('button', { name: 'RECONFIGURE' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create your Compound Agent.');
    // Still the new experience — no fallback to the old shell.
    expect(container.querySelector('.rx')).not.toBeNull();
    expect(container.querySelector('.reh')).toBeNull();
  });
});

describe('Julius is the harness, never a worker', () => {
  it('is named in the telemetry beside the agent', () => {
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    expect(screen.getByText('HARNESS')).toBeTruthy();
    expect(screen.getByText('JULIUS')).toBeTruthy();
  });

  it('never appears as a selectable worker in any slot', () => {
    // Julius surrounds the Prompt Architect, Coding Agent and Independent
    // Reviewer — it coordinates them. Offering it as a choice among them would
    // present the control plane as one of the things it controls.
    render(createElement(RelayWorld, { initialStage: 'relay' as const }));
    for (const tick of ['02', '03', '04']) {
      fireEvent.click(screen.getByRole('button', { name: tick }));
      expect(screen.queryByRole('button', { name: /^Julius/i })).toBeNull();
    }
  });
});

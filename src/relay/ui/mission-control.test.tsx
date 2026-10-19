import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MissionControl } from './MissionControl';
import { LiveTerminal } from './LiveTerminal';
import { RelayDog } from './RelayDog';
import { buildMissionControlData } from './data';

/**
 * Mission Control render tests (Prompt 8.2) — DOM-less SSR. The graphical
 * surface must project from Relay Core, render every safe state, expose the
 * accessible Terminal button, and never leak hidden reasoning or secrets. No
 * provider call.
 */

describe('mission control data projection (Relay Core, no provider call)', () => {
  it('projects a verified competitive run with dog, reviewer, and terminal events', () => {
    const d = buildMissionControlData({ mode: 'semi', entitlement: 'pro' });
    expect(d.ok).toBe(true);
    expect(d.bundle.verdict.verdict).toBe('verified_complete');
    expect(d.dog.state).toBe('complete');
    expect(d.reviewer.availability).toBe('available');
    expect(d.reviewerIndependent).toBe(true);
    expect(d.outputVisibility).toBe('released');
    expect(d.terminalEvents.length).toBeGreaterThan(4);
    expect(d.connectionState).toBe('LIVE');
    // Access summary carries names/scopes only, never values.
    const accessJson = JSON.stringify(d.access);
    expect(accessJson).not.toMatch(/sk-[A-Za-z0-9]{8,}|password|secret|token[:=]/i);
  });

  it('the dog is entitlement-gated locked on Free (no reviewer)', () => {
    const free = buildMissionControlData({ entitlement: 'free' });
    expect(free.reviewer.availability).toBe('entitlement_locked');
  });
});

describe('MissionControl renders every safe state', () => {
  it('renders the primary screen, terminal button, dog, and progressive sections', () => {
    const html = renderToStaticMarkup(createElement(MissionControl, { initialMode: 'semi' }));
    expect(html).toContain('SUNDAY RELAY');
    expect(html).toContain('Mission Control');
    expect(html).toContain('Protect anonymous live access');
    expect(html).toContain('verified complete');
    expect(html).toContain('Open Live Terminal'); // accessible terminal button label
    expect(html).toContain('Relay Dog: COMPLETE'); // dog aria-label from Relay Core state
    expect(html).toContain('COMPLETE'); // dog state label
    expect(html).toContain('Mode: semi');
    expect(html).toContain('Plan: Pro');
    expect(html).toContain('SIMULATED');
    expect(html).toContain('Mission Contract');
    expect(html).toContain('Review &amp; Repair');
    expect(html).toContain('Reviewer &amp; Release Gate');
    // No hidden reasoning / secrets leak.
    expect(html).not.toMatch(/chain of thought|system prompt|sk-[A-Za-z0-9]{8,}/i);
  });

  it('the terminal button carries an accessible label and role', () => {
    const html = renderToStaticMarkup(createElement(MissionControl, {}));
    expect(html).toContain('aria-label="Open Live Terminal"');
  });
});

describe('LiveTerminal renders safe events and structured exchanges', () => {
  it('shows the header, filters, safe events, and responsibility exchanges', () => {
    const d = buildMissionControlData({ mode: 'semi' });
    const html = renderToStaticMarkup(createElement(LiveTerminal, { data: d, mode: 'semi' }));
    expect(html).toContain('LIVE TERMINAL');
    expect(html).toContain('Connection');
    expect(html).toContain('LIVE');
    expect(html).toContain('Provenance');
    expect(html).toContain('ARCHITECT → CODING AGENT');
    expect(html).toContain('Responsibility contract delivered');
    // Filters present.
    expect(html).toContain('Reviewer');
    expect(html).toContain('Verification');
    // No secrets / hidden reasoning.
    expect(html).not.toMatch(/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|chain of thought/i);
  });

  it('renders full-screen (mobile) without crashing', () => {
    const d = buildMissionControlData({});
    const html = renderToStaticMarkup(createElement(LiveTerminal, { data: d, mode: 'guided', fullScreen: true }));
    expect(html).toContain('relay-terminal--full');
  });
});

describe('RelayDog honors reduced motion and shows the state label without animation', () => {
  it('renders the label and no moving class under reduced motion', () => {
    const runningDog = {
      state: 'running' as const, activityLevel: 60, synchronizationLevel: 70, activeRoles: ['coding-agent'],
      mode: 'semi' as const, statusLabel: 'ACTIVE WORK', reason: 'x', lastMeaningfulSequence: 5,
      calculatedAt: 't', reducedMotion: true, provenance: 'simulated' as const,
    };
    const html = renderToStaticMarkup(createElement(RelayDog, { dog: runningDog }));
    expect(html).toContain('ACTIVE WORK');
    expect(html).not.toContain('relay-dog--moving');
  });
});

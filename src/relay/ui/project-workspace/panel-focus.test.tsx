/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES } from './fixtures';
import { RELAY_PANEL_NAME, type RelayFocusablePanel } from './RelayPanelFocus';
import { buildCodingTerminalView } from './coding-terminal';
import type { CodingTerminalState } from '../../mission/wire-contracts';

/**
 * FULLSCREEN ROLE BOXES — IN THE LIVE TERMINAL.
 *
 * Expanding a box is a LIVE TERMINAL affordance (founder direction). The
 * workspace itself is a plain reading surface with no per-panel control, and
 * the first describe below holds that line.
 *
 * For the terminal's own boxes the property that matters is NOT that a box
 * gets bigger — it is that expanding one changes nothing else. The box keeps
 * its place in the React tree, so there is exactly one terminal before and
 * after, no output is lost and no mission state moves.
 */

const CSS = readFileSync(
  join(process.cwd(), 'src/relay/ui/project-workspace/relay-project-workspace.css'),
  'utf8',
);
const TERMINAL_SOURCE = readFileSync(
  join(process.cwd(), 'src/relay/ui/project-workspace/RelayLiveTerminalPanel.tsx'),
  'utf8',
);

const terminalState = (): CodingTerminalState => ({
  executionId: 'a1b2c3d4',
  externalSessionRedacted: '…556666',
  runtime: 'Claude Code (local CLI)',
  billing: 'subscription',
  status: 'live',
  projectLabel: 'Relay controlled fixture (throwaway repository)',
  startedAt: '2026-07-23T10:00:00.000Z',
  endedAt: null,
  permissions: {
    allowedTools: ['Read', 'Edit', 'Grep'],
    allowedFiles: ['src/normalize.js'],
    protectedPaths: ['package.json'],
    deniedCapabilities: ['Bash'],
  },
  lines: [
    { sequence: 0, at: '2026-07-23T10:00:01.000Z', kind: 'command', truth: 'relay_evidence', text: 'node --test' },
    { sequence: 1, at: '2026-07-23T10:00:02.000Z', kind: 'verification', truth: 'relay_evidence', text: 'ok 1 normalize' },
  ],
  activeFile: null,
  changedFiles: [],
  claim: null,
  diff: null,
  test: null,
  attestation: null,
});

const codingTerminalView = () =>
  buildCodingTerminalView({ terminal: terminalState(), phase: 'build' });

function renderWorkspace(overrides: Record<string, unknown> = {}) {
  const base = Object.values(WORKSPACE_FIXTURES)[0];
  const fixture = { ...base, codingTerminal: codingTerminalView(), ...overrides };
  const { fixtureLabel: _label, ...props } = fixture as Record<string, unknown> & { fixtureLabel?: string };
  return render(createElement(RelayProjectWorkspace, props as never));
}

/** The workspace with its Live Terminal open — where the boxes live. */
const renderTerminal = (overrides: Record<string, unknown> = {}) =>
  renderWorkspace({ terminalOpen: true, ...overrides });

const expandButtons = () => screen.queryAllByRole('button', { name: /^Expand .+ panel$/ });
const returnButtons = () => screen.queryAllByRole('button', { name: /^Return to workspace from .+ panel$/ });
const focusedShells = () => document.querySelectorAll('.rpw-tmpanel-shell[data-focused="true"]');
const focusedDialog = () => screen.getAllByRole('dialog').find(
  (d) => d.getAttribute('aria-label')?.includes('focused panel'),
);
/** The Coding Agent terminal's real root element. */
const terminals = () => document.querySelectorAll('section.rcat');

afterEach(() => cleanup());

/* ------------------------------------------------ the workspace is plain --- */

describe('the workspace has no per-panel fullscreen control', () => {
  it('renders no expand button anywhere on the workspace', () => {
    renderWorkspace();
    expect(expandButtons()).toHaveLength(0);
    expect(document.querySelectorAll('.rpw-expand-btn')).toHaveLength(0);
  });

  it('opens no focused panel and paints no backdrop', () => {
    renderWorkspace();
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(document.querySelectorAll('.rpw-focus-backdrop')).toHaveLength(0);
    expect(document.querySelector('.rpw')?.getAttribute('data-panel-focused')).toBe('false');
  });

  it('drops the workforce strip from the workspace entirely', () => {
    renderWorkspace();
    // The founder asked for the top band to go; it is not rendered here.
    expect(document.querySelectorAll('.rpw-strip')).toHaveLength(0);
    expect(document.querySelectorAll('.rpw-operating')).toHaveLength(0);
  });
});

/* --------------------------------------------- the control, in the terminal */

describe('the expand control appears on every Live Terminal role box', () => {
  it('appears once per box, each with a box-specific accessible name', () => {
    renderTerminal();
    const buttons = expandButtons();
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    const names = buttons.map((b) => b.getAttribute('aria-label'));
    // Every name is distinct, so a screen-reader user never hears N identical
    // "Expand" buttons.
    expect(new Set(names).size).toBe(names.length);
    for (const panel of ['prompt_architect', 'relay_system'] as RelayFocusablePanel[]) {
      expect(names).toContain(`Expand ${RELAY_PANEL_NAME[panel]} panel`);
    }
  });

  it('is a real button, keyboard-activatable, with the Expand tooltip', () => {
    renderTerminal();
    const button = expandButtons()[0];
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe('Expand');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('carries meaning in its label, never in the icon alone', () => {
    renderTerminal();
    const button = expandButtons()[0];
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-label')).toMatch(/^Expand .+ panel$/);
  });

  it('a role box added later gets the control for free', () => {
    // The control lives inside the shared RolePanel, not at each call site.
    const rolePanel = TERMINAL_SOURCE.slice(
      TERMINAL_SOURCE.indexOf('function RolePanel'),
      TERMINAL_SOURCE.indexOf('export function RelayLiveTerminalPanel'),
    );
    expect(rolePanel).toContain('RelayPanelExpandButton');
    expect(rolePanel).toContain('RelayFocusedPanel');
  });
});

/* ------------------------------------------------------- expanding a box --- */

describe('expanding a role box', () => {
  it('opens that box, and only that box', () => {
    renderTerminal();
    fireEvent.click(expandButtons()[0]);
    expect(focusedShells()).toHaveLength(1);
    expect(focusedDialog()).toBeTruthy();
  });

  it('only one box is expanded at a time', () => {
    renderTerminal();
    const buttons = expandButtons();
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(focusedShells()).toHaveLength(1);
  });

  it('Escape closes it', () => {
    renderTerminal();
    fireEvent.click(expandButtons()[0]);
    fireEvent.keyDown(focusedDialog() as HTMLElement, { key: 'Escape' });
    expect(focusedShells()).toHaveLength(0);
  });

  it('the visible return control closes it, and says so', () => {
    renderTerminal();
    fireEvent.click(expandButtons()[0]);
    const back = returnButtons();
    expect(back).toHaveLength(1);
    expect(back[0].getAttribute('title')).toBe('Return to workspace');
    fireEvent.click(back[0]);
    expect(focusedShells()).toHaveLength(0);
  });

  it('restores focus to the button that opened it', () => {
    renderTerminal();
    const button = expandButtons()[0];
    fireEvent.click(button);
    fireEvent.click(returnButtons()[0]);
    expect(document.activeElement).toBe(button);
  });

  it('announces the expansion to assistive technology', () => {
    renderTerminal();
    fireEvent.click(expandButtons()[0]);
    const live = [...document.querySelectorAll('[role="status"][aria-live="polite"]')]
      .map((n) => n.textContent ?? '');
    expect(live.some((t) => /panel expanded\. Press Escape/.test(t))).toBe(true);
  });

  it('keeps the live region mounted so only its CONTENT changes', () => {
    renderTerminal();
    const before = document.querySelectorAll('.rpw-tmpanel-shell [role="status"]').length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(expandButtons()[0]);
    expect(document.querySelectorAll('.rpw-tmpanel-shell [role="status"]').length).toBe(before);
  });

  it('contains keyboard focus inside the expanded box', () => {
    renderTerminal();
    fireEvent.click(expandButtons()[0]);
    const dialog = focusedDialog() as HTMLElement;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBeGreaterThan(0);
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

/* ----------------------------------------------- expanding changes nothing */

describe('expanding a box changes nothing else', () => {
  it('does NOT create a second terminal', () => {
    renderTerminal();
    const before = terminals().length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(expandButtons()[0]);
    expect(terminals()).toHaveLength(before);
  });

  it('keeps the SAME terminal DOM node — it is moved by CSS, never re-mounted', () => {
    renderTerminal();
    const node = terminals()[0];
    fireEvent.click(expandButtons()[0]);
    expect(terminals()[0]).toBe(node);
  });

  it('does not lose terminal output', () => {
    renderTerminal();
    expect(document.body.textContent).toContain('ok 1 normalize');
    fireEvent.click(expandButtons()[0]);
    expect(document.body.textContent).toContain('ok 1 normalize');
  });

  it('does not change the Relay Dog state', () => {
    renderTerminal();
    // The dog now stands on the Relay Stage; `.rpw-dogzone` is gone with the band.
    const dog = () => document.querySelector('[data-stage-actor="relay-dog"]')?.innerHTML ?? '';
    const before = dog();
    fireEvent.click(expandButtons()[0]);
    expect(dog()).toBe(before);
  });

  it('fabricates no approval and adds no role', () => {
    renderTerminal();
    fireEvent.click(expandButtons()[0]);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('APPROVED BY');
    expect(text).not.toContain('Research Agent');
  });
});

/* ------------------------------------------------------------- the reviewer */

describe('the Live Terminal carries a Reviewer box', () => {
  it('declares a REVIEWER lane fed by reviewer activity', () => {
    expect(TERMINAL_SOURCE).toContain('title="REVIEWER"');
    expect(TERMINAL_SOURCE).toContain('events={reviewerEvents}');
  });

  it('keeps reviewer activity out of the Relay System catch-all', () => {
    // A reviewer event appears in exactly one lane, never two.
    expect(TERMINAL_SOURCE).toContain('!REVIEWER_CATS.has(e.category)');
  });
});

/* ------------------------------------------------------------------- CSS --- */

describe('the expanded box is a CSS lift, inside safe areas', () => {
  it('fills the terminal without re-mounting the box', () => {
    expect(CSS).toMatch(/\.rpw-tmpanel-shell\[data-focused='true'\] \{[\s\S]*?position: fixed/);
    expect(CSS).toMatch(/\.rpw-tmpanel-shell\[data-focused='true'\] \{[\s\S]*?inset: 0/);
  });

  it('honours mobile safe areas and touch targets', () => {
    expect(CSS).toMatch(/\.rpw-tmpanel-shell\[data-focused='true'\][\s\S]*?safe-area-inset-bottom/);
    expect(CSS).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.rpw-tmpanel-head \.rpw-expand-btn \{ min-height: 44px/);
  });

  it('preserves reduced motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.rpw-tmpanel-shell/);
  });
});

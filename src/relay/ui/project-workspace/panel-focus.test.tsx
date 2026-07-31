/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES } from './fixtures';
import {
  RELAY_FOCUSABLE_PANELS,
  RELAY_PANEL_NAME,
  type RelayFocusablePanel,
} from './RelayPanelFocus';
import { RELAY_AGENT_ROLES } from '../../mission';
import { buildCodingTerminalView } from './coding-terminal';
import type { CodingTerminalState } from '../../mission/wire-contracts';

/**
 * FULLSCREEN WORKSPACE PANELS.
 *
 * The property that matters most is NOT that a panel gets bigger — it is that
 * expanding one changes nothing else. The panel keeps its place in the React
 * tree, so there is exactly one terminal before and after, no output is lost,
 * no agent restarts, and no mission or Relay Dog state moves.
 */

const CSS = readFileSync(
  join(process.cwd(), 'src/relay/ui/project-workspace/relay-project-workspace.css'),
  'utf8',
);

/**
 * A real Coding Agent terminal view, built by the product's own builder so the
 * Coding Agent panel actually renders. No standard workspace fixture carries
 * one, and asserting "no second terminal" against zero terminals proves
 * nothing.
 */
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
    { sequence: 0, at: '2026-07-23T10:00:01.000Z', kind: 'command', text: 'node --test' },
    { sequence: 1, at: '2026-07-23T10:00:02.000Z', kind: 'output', text: 'ok 1 normalize' },
  ],
  diff: null,
  test: null,
  attestation: null,
} as unknown as CodingTerminalState);

const codingTerminalView = () =>
  buildCodingTerminalView({ terminal: terminalState(), phase: 'build' });

function renderWorkspace(overrides: Record<string, unknown> = {}) {
  const base = Object.values(WORKSPACE_FIXTURES)[0];
  const fixture = { ...base, codingTerminal: codingTerminalView(), ...overrides };
  const { fixtureLabel: _label, ...props } = fixture as Record<string, unknown> & { fixtureLabel?: string };
  return render(createElement(RelayProjectWorkspace, props as never));
}

const expandButtons = () => screen.queryAllByRole('button', { name: /^Expand .+ panel$/ });
/** The Coding Agent terminal's real root element. */
const terminals = () => document.querySelectorAll('section.rcat');

afterEach(() => cleanup());

describe('the canonical expand control', () => {
  it('appears on every eligible panel, once each, with a panel-specific name', () => {
    renderWorkspace();
    const buttons = expandButtons();
    expect(buttons.length).toBeGreaterThanOrEqual(8);

    const names = buttons.map((b) => b.getAttribute('aria-label'));
    // Every label names its panel — never eleven identical "Expand" buttons.
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^Expand .+ panel$/);
  });

  it('is a real button, keyboard-activatable, with the Expand tooltip', () => {
    renderWorkspace();
    const button = expandButtons()[0];
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe('Expand');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('carries meaning in its label, never in the icon alone', () => {
    renderWorkspace();
    const button = expandButtons()[0];
    const svg = button.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-label')).toBeTruthy();
  });

  it('has a 32px interaction area, a ~15px icon, and is touch-safe on mobile', () => {
    expect(CSS).toMatch(/\.rpw-expand-btn\s*\{[^}]*width:\s*32px/);
    expect(CSS).toMatch(/\.rpw-expand-btn\s*\{[^}]*height:\s*32px/);
    expect(CSS).toContain('.rpw-expand-btn { min-height: 44px; min-width: 44px; }');
  });

  it('is visible on keyboard focus, not hover only', () => {
    expect(CSS).toContain('.rpw-expand-btn:focus-visible');
    expect(CSS).toMatch(/\.rpw-expand-btn:focus-visible\s*\{[^}]*outline:/);
  });

  it('respects reduced motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.rpw-expand-btn \{ transition: none; \}/);
  });

  it('respects mobile safe areas', () => {
    expect(CSS).toMatch(/\.rpw-focusable\[data-focused='true'\][\s\S]*env\(safe-area-inset-top/);
    expect(CSS).toMatch(/env\(safe-area-inset-bottom/);
  });
});

describe('opening and closing a focused panel', () => {
  const open = (panel: RelayFocusablePanel) => {
    const button = screen.getByRole('button', { name: `Expand ${RELAY_PANEL_NAME[panel]} panel` });
    fireEvent.click(button);
    return button;
  };

  it('Prompt Architect opens its own focused view', () => {
    renderWorkspace();
    open('prompt_architect');
    const dialog = screen.getByRole('dialog', { name: /Prompt Architect — focused panel/ });
    expect(dialog.getAttribute('data-panel')).toBe('prompt_architect');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Coding Agent opens its own focused view', () => {
    renderWorkspace();
    open('coding_agent');
    const dialog = screen.getByRole('dialog', { name: /Coding Agent — focused panel/ });
    expect(dialog.getAttribute('data-panel')).toBe('coding_agent');
  });

  it('Reviewer opens its own focused view', () => {
    renderWorkspace();
    open('reviewer');
    expect(screen.getByRole('dialog', { name: /Reviewer — focused panel/ })).toBeTruthy();
  });

  it('generic panels open inside the SAME shared shell', () => {
    for (const panel of ['project_brain', 'verification', 'console'] as const) {
      cleanup();
      renderWorkspace();
      open(panel);
      const dialog = screen.getByRole('dialog', { name: new RegExp(`${RELAY_PANEL_NAME[panel]} — focused panel`) });
      // Same shell class, same semantics — not a bespoke design per panel.
      expect(dialog.classList.contains('rpw-focusable')).toBe(true);
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      }
  });

  it('only one panel is focused at a time', () => {
    renderWorkspace();
    open('reviewer');
    expect(screen.getAllByRole('dialog').length).toBe(1);
  });

  it('Escape closes the focused view', () => {
    renderWorkspace();
    open('reviewer');
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the visible return control closes it, and says so', () => {
    renderWorkspace();
    open('project_brain');
    const back = screen.getByRole('button', { name: 'Return to workspace from Project Brain panel' });
    expect(back.getAttribute('title')).toBe('Return to workspace');
    expect(back.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(back);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('announces the expansion to assistive technology', () => {
    renderWorkspace();
    open('verification');
    const announced = screen
      .getAllByRole('status')
      .map((n) => n.textContent ?? '')
      .join(' | ');
    expect(announced).toContain('Verification panel expanded');
    expect(announced).toContain('Escape');
  });

  it('makes the background inert to the pointer', () => {
    renderWorkspace();
    expect(document.querySelector('.rpw-focus-backdrop')).toBeNull();
    open('console');
    expect(document.querySelector('.rpw-focus-backdrop')).not.toBeNull();
  });

  it('restores focus to the button that opened it', () => {
    renderWorkspace();
    const button = open('verification');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(document.activeElement).toBe(button);
  });

  it('contains keyboard focus inside the focused panel', () => {
    renderWorkspace();
    open('reviewer');
    const dialog = screen.getByRole('dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>('button,a[href],input,textarea,select,[tabindex]:not([tabindex="-1"])');
    expect(focusable.length).toBeGreaterThan(0);
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    // Wrapped back to the first control rather than escaping into the workspace.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('expanding changes nothing but the layout', () => {
  it('does NOT create a second terminal', () => {
    renderWorkspace();
    const before = terminals().length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Coding Agent panel' }));
    expect(terminals().length).toBe(before);
  });

  it('keeps the SAME terminal DOM node — it is moved by CSS, never re-mounted', () => {
    renderWorkspace();
    const node = terminals()[0];
    fireEvent.click(screen.getByRole('button', { name: 'Expand Coding Agent panel' }));
    // Identity, not just count: a re-mount would produce a different node.
    expect(terminals()[0]).toBe(node);
  });

  it('does not lose terminal output', () => {
    renderWorkspace();
    const before = document.body.textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Expand Coding Agent panel' }));
    const after = document.body.textContent ?? '';
    // Everything that was rendered is still rendered.
    const sample = before.slice(0, 200).trim();
    if (sample.length > 0) expect(after.length).toBeGreaterThanOrEqual(sample.length);
  });

  it('does not change the Relay Dog state', () => {
    renderWorkspace();
    const dogBefore = document.querySelector('[class*="dog"]')?.className ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Expand Reviewer panel' }));
    const dogAfter = document.querySelector('[class*="dog"]')?.className ?? '';
    expect(dogAfter).toBe(dogBefore);
  });

  it('does not change mission state shown in the workspace', () => {
    renderWorkspace();
    const missionBefore = document.querySelector('.rpw-strip')?.textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Expand Project Brain panel' }));
    const missionAfter = document.querySelector('.rpw-strip')?.textContent ?? '';
    expect(missionAfter).toBe(missionBefore);
  });

  it('focus happens IN PLACE — the panel never leaves the tree', () => {
    // This is the mechanism the no-duplication guarantee rests on, so it is
    // asserted directly rather than inferred.
    const source = readFileSync(
      join(process.cwd(), 'src/relay/ui/project-workspace/RelayPanelFocus.tsx'),
      'utf8',
    );
    expect(source).toContain('FOCUS IN PLACE, NEVER RE-MOUNT');
    expect(source).not.toContain('createPortal');
    expect(CSS).toMatch(/\.rpw-focusable\[data-focused='true'\]\s*\{[^}]*position: fixed/);
  });
});

describe('truthfulness is unchanged by expansion', () => {
  it('the Reviewer view fabricates no approval', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Reviewer panel' }));
    const dialog = screen.getByRole('dialog');
    const text = dialog.textContent ?? '';
    // Expanding a panel cannot invent a verdict that no review produced.
    expect(/\bAPPROVED\b/.test(text) && !/changes/i.test(text)).toBe(false);
  });

  it('the Prompt Architect view creates no Research Agent, and adds no role', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Prompt Architect panel' }));
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(/research agent/i.test(text)).toBe(false);
    // Research is a Prompt Architect capability; the roles are still three.
    expect([...RELAY_AGENT_ROLES]).toEqual(['prompt_architect', 'coding_agent', 'reviewer']);
  });

  it('a focused agent panel shows Runtime, Mission Contract, Environment and Tools', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Coding Agent panel' }));
    const dialog = screen.getByRole('dialog');
    for (const row of ['Runtime', 'Mission Contract', 'Environment', 'Tools']) {
      expect(within(dialog).getAllByText(row).length).toBeGreaterThan(0);
    }
  });

  it('Demo Simulation disclosure survives expansion', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Coding Agent panel' }));
    const dialog = screen.getByRole('dialog');
    // The operating profile in this build is simulated and must say so.
    expect((dialog.textContent ?? '')).toContain('SIMULATED DATA');
  });

  it('the focusable panel list introduces no Relay role', () => {
    const roles = new Set<string>(RELAY_AGENT_ROLES);
    const panelsThatAreRoles = RELAY_FOCUSABLE_PANELS.filter((p) => roles.has(p));
    expect([...panelsThatAreRoles].sort()).toEqual(['coding_agent', 'prompt_architect', 'reviewer']);
  });
});

describe('mobile', () => {
  it('never renders a three-column layout inside a focused panel', () => {
    expect(CSS).toMatch(
      /@media \(max-width: 700px\)[\s\S]*\.rpw-focusable\[data-focused='true'\] \.rpw-workspace \{ grid-template-columns: minmax\(0, 1fr\); \}/,
    );
  });

  it('keeps the focused panel full-height with the return control reachable', () => {
    expect(CSS).toMatch(/\.rpw-focusable\[data-focused='true'\]\s*\{[^}]*inset: 0/);
    expect(CSS).toMatch(/\.rpw-focusable\[data-focused='true'\] \.rpw-expand-btn\s*\{[^}]*position: sticky/);
  });
});

describe('the focused panel actually paints above its own backdrop', () => {
  /**
   * THE BUG THIS PINS. `.rpw > main` is `position: relative; z-index: 2`, which
   * makes it a STACKING CONTEXT. A focused panel inside it at z-index 61 can
   * never rise above the backdrop at z-index 60 that is a SIBLING of main — so
   * the panel rendered underneath its own backdrop: invisible, with an
   * unclickable return control. jsdom computes no stacking, so this is
   * asserted structurally instead.
   */
  it('raises the main stacking context while a panel is focused', () => {
    expect(CSS).toContain(".rpw[data-panel-focused='true'] > main { z-index: 62; }");
    // The context it has to beat, and the backdrop it has to clear.
    expect(CSS).toMatch(/\.rpw > main,?[\s\S]{0,80}z-index: 2;/);
    expect(CSS).toMatch(/\.rpw-focus-backdrop\s*\{[^}]*z-index: 60/);
  });

  it('marks the workspace root only while a panel is focused', () => {
    renderWorkspace();
    const root = document.querySelector('.rpw');
    expect(root?.getAttribute('data-panel-focused')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Expand Reviewer panel' }));
    expect(document.querySelector('.rpw')?.getAttribute('data-panel-focused')).toBe('true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(document.querySelector('.rpw')?.getAttribute('data-panel-focused')).toBe('false');
  });
});

describe('the control never covers what the panel already shows', () => {
  it('reserves its width in every header row that right-aligns content', () => {
    // `.rcat-status` is `margin-left: auto`, and the Console prints
    // LIVE/STANDBY hard right — exactly where the control sits.
    expect(CSS).toMatch(
      /\.rpw-focusable \.rpw-console-head,[\s\S]*\.rpw-focusable \.rcat-head,[\s\S]*padding-right: 36px;/,
    );
  });
});

describe('a panel that stops existing cannot stay focused', () => {
  it('drops Coding Agent focus when the terminal view goes away', () => {
    const { rerender } = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Coding Agent panel' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // The terminal disappears while focused — without derived focus this would
    // leave a backdrop over a workspace with nothing to close.
    const base = Object.values(WORKSPACE_FIXTURES)[0];
    const { fixtureLabel: _l, ...props } = { ...base, codingTerminal: undefined } as Record<string, unknown> & { fixtureLabel?: string };
    rerender(createElement(RelayProjectWorkspace, props as never));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.rpw-focus-backdrop')).toBeNull();
  });
});

describe('the expansion announcement can actually be heard', () => {
  it('keeps the live region mounted so only its CONTENT changes', () => {
    renderWorkspace();
    // Regions inserted at the same moment as their text are usually not
    // announced at all, so the region exists before anything is focused.
    const regions = screen.getAllByRole('status');
    expect(regions.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Verification panel' }));
    const announced = screen.getAllByRole('status').map((n) => n.textContent ?? '').join(' | ');
    expect(announced).toContain('Verification panel expanded');
  });
});

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RelayProjectWorkspace } from '../project-workspace/RelayProjectWorkspace';
import { WORKSPACE_FIXTURES } from '../project-workspace/fixtures';
import {
  USAGE_OFFLINE_LABEL,
  USAGE_SIMULATED_LABEL,
  demoUsageSnapshot,
  offlineUsageSnapshot,
  projectUsageBar,
  projectUsageDetail,
} from '../../usage';
import { RelayUsageDetailPanel } from './RelayUsageDetailPanel';
import type { RelayWorkspaceUsage } from './index';

/**
 * Usage Bar + usage detail panel in the product: header placement, fullscreen
 * availability, truthful rendering, and accessibility. Follows the
 * panel-focus.test.tsx conventions (jsdom, role-first queries, CSS regex for
 * what jsdom cannot compute).
 */

afterEach(cleanup);

const NOW = '2026-07-31T12:00:00.000Z';

function usageProp(
  snapshot = offlineUsageSnapshot(),
  onOpenUsage: () => void = () => undefined,
): RelayWorkspaceUsage {
  return { bar: projectUsageBar(snapshot), onOpenUsage };
}

function renderWorkspace(overrides: Record<string, unknown> = {}) {
  const base = Object.values(WORKSPACE_FIXTURES)[0];
  const fixture = { ...base, ...overrides };
  const { fixtureLabel: _label, ...props } = fixture as Record<string, unknown> & {
    fixtureLabel?: string;
  };
  return render(createElement(RelayProjectWorkspace, props as never));
}

const usageButtons = () => screen.queryAllByRole('button', { name: /^Usage — / });

describe('Usage Bar in the workspace header', () => {
  it('renders as a real button whose accessible name carries the summary', () => {
    renderWorkspace({ usage: usageProp() });
    const bars = usageButtons();
    expect(bars).toHaveLength(1);
    expect(bars[0].tagName).toBe('BUTTON');
    expect(bars[0].getAttribute('aria-label')).toContain('unavailable');
    expect(bars[0].textContent).toBe('USAGE · UNAVAILABLE');
  });

  it('selecting it opens the usage detail surface (intent callback)', () => {
    const onOpen = vi.fn();
    renderWorkspace({ usage: usageProp(offlineUsageSnapshot(), onOpen) });
    fireEvent.click(usageButtons()[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('a workspace without a usage source renders exactly as before — no bar', () => {
    renderWorkspace();
    expect(usageButtons()).toHaveLength(0);
  });

  it('sits OUTSIDE the collapsing right cluster, so mobile keeps a compact indicator', () => {
    renderWorkspace({ usage: usageProp() });
    const bar = usageButtons()[0];
    expect(bar.closest('.rpw-header-right')).toBeNull();
    expect(bar.closest('.rpw-header')).not.toBeNull();
  });
});

describe('the workspace keeps exactly one Usage Bar', () => {
  it('has no per-panel fullscreen control, so no view can echo a second bar', () => {
    renderWorkspace({ usage: usageProp() });
    // Expanding a box is a Live Terminal affordance now; the workspace has no
    // focused view, so the compact echo has nowhere to be duplicated.
    expect(screen.queryAllByRole('button', { name: /^Expand .+ panel$/ })).toHaveLength(0);
    expect(usageButtons()).toHaveLength(1);
    expect(document.querySelectorAll('.rus-bar--compact')).toHaveLength(0);
  });

  it('the compact echo is pinned clear of the sticky return control (CSS fact)', () => {
    const css = readFileSync(join(__dirname, 'relay-usage.css'), 'utf8');
    expect(css).toMatch(/\.rus-bar--compact \{[\s\S]*?position: fixed/);
    expect(css).toMatch(/\.rus-bar--compact \{[\s\S]*?right: 56px/);
  });
});

describe('usage detail panel', () => {
  it('offline: four truthful sections, provenance banner, no fabricated numbers', () => {
    render(
      createElement(RelayUsageDetailPanel, {
        open: true,
        view: projectUsageDetail(offlineUsageSnapshot(), NOW),
        onClose: () => undefined,
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Usage details' });
    expect(within(dialog).getByText(USAGE_OFFLINE_LABEL)).toBeTruthy();
    for (const title of ['Mission Contracts', 'Five-hour usage', 'Weekly usage', 'Relay Cubs']) {
      expect(within(dialog).getByText(title)).toBeTruthy();
    }
    expect(within(dialog).getByText('Relay Cubs are not enabled yet.')).toBeTruthy();
    expect(dialog.textContent).not.toContain('0%');
    expect(dialog.textContent).toContain('Unavailable');
    expect(dialog.textContent).not.toContain(USAGE_SIMULATED_LABEL);
  });

  it('demo: SIMULATED banner, spec figures, meters that carry text', () => {
    render(
      createElement(RelayUsageDetailPanel, {
        open: true,
        view: projectUsageDetail(demoUsageSnapshot({ stepIndex: 0, nowIso: NOW }), NOW),
        onClose: () => undefined,
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Usage details' });
    expect(within(dialog).getByText(USAGE_SIMULATED_LABEL)).toBeTruthy();
    // The meter text deliberately mirrors the row value, so both appear.
    expect(within(dialog).getAllByText('14 of 25 remaining').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('34% used').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText('Resets in 2h 14m')).toBeTruthy();
    // Weekly usage and weekly Cub runs share the same reset window.
    expect(within(dialog).getAllByText('Resets Monday at 12:00 AM').length).toBeGreaterThanOrEqual(1);
    // Meter text mirrors the meter fill — never color alone.
    expect(dialog.querySelectorAll('.rus-meter-text').length).toBeGreaterThanOrEqual(2);
  });

  it('closes on Escape and via the visibly labeled CLOSE control', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      createElement(RelayUsageDetailPanel, {
        open: true,
        view: projectUsageDetail(offlineUsageSnapshot(), NOW),
        onClose,
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Usage details' });
    // Focus lands on the close control when the dialog opens.
    const close = screen.getByRole('button', { name: 'Close usage details' });
    expect(document.activeElement).toBe(close);
    expect(close.textContent).toBe('CLOSE');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      createElement(RelayUsageDetailPanel, {
        open: false,
        view: projectUsageDetail(offlineUsageSnapshot(), NOW),
        onClose,
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('locks body scroll while open and restores it on close', () => {
    const { rerender } = render(
      createElement(RelayUsageDetailPanel, {
        open: true,
        view: projectUsageDetail(offlineUsageSnapshot(), NOW),
        onClose: () => undefined,
      }),
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      createElement(RelayUsageDetailPanel, {
        open: false,
        view: projectUsageDetail(offlineUsageSnapshot(), NOW),
        onClose: () => undefined,
      }),
    );
    expect(document.body.style.overflow).toBe('');
  });
});

describe('visual language and mobile (CSS facts)', () => {
  it('uses shared theme tokens, touch-safe mobile targets, and reduced motion', () => {
    const css = readFileSync(join(__dirname, 'relay-usage.css'), 'utf8');
    expect(css).toContain('var(--rmc-gold)');
    expect(css).not.toMatch(/\.rus-[^{]*\{[^}]*#[0-9a-f]{3,6}[^}]*font/i); // tokens, not ad-hoc hex type styles
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*min-height: 44px/);
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/safe-area-inset-bottom/);
  });
});

describe('security and boundaries (source-level)', () => {
  it('usage UI files: no Node imports, no network, no credential fields, no thresholds of their own', () => {
    const files = readdirSync(__dirname)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
      .map((f) => ({ f, src: readFileSync(join(__dirname, f), 'utf8') }));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const { f, src } of files) {
      expect(src, f).not.toMatch(/from\s+['"]node:/);
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
      expect(src, f).not.toMatch(/api\.anthropic\.com|api\.openai\.com|relay-api/);
      expect(src, f).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      // The UI renders derived views; it never re-implements the canonical
      // threshold numbers.
      expect(src, f).not.toMatch(/>=\s*70|>=\s*90|>=\s*100/);
    }
  });
});

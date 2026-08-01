/** @vitest-environment jsdom */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import {
  NO_PROVEN_CAPABILITIES_LABEL, REVIEWER_HARNESS_CATALOG,
  REVIEWER_HARNESS_NOT_CONNECTED_LABEL, assessIndependence, harnessIsSelectableForRun,
  idleHarnessRecord, projectHarnessCatalog, projectReviewerHarness,
  renderHarnessCatalogLines, sealHarnessRecord,
} from '../../mission';

/**
 * THE REVIEWER HARNESS CATALOG IN THE BROWSER.
 *
 * The catalog already existed in the domain and in `relay reviewer harnesses`;
 * these tests are about the surface that projects it, and about the two ways
 * such a surface usually starts lying: by re-stating the catalog in a React
 * file, and by letting a row that cannot run look like one that can.
 *
 * So they assert the source (one catalog, no second copy), the projection
 * (labels come from the domain), and the CONSEQUENCES of clicking an
 * unavailable harness — no identity change, no run, no usage, no request.
 */

const CANONICAL_NAMES = [
  'Hermes', 'Buzz Agent / Buzz ACP', 'Vellum', 'TrustClaw',
  'PicoClaw', 'ZeroClaw', 'Agent Zero',
] as const;

const REPO = resolve(__dirname, '..', '..', '..', '..');
const UI = join(REPO, 'src', 'relay', 'ui');
const CATALOG_COMPONENT = join(UI, 'project-workspace', 'RelayReviewerHarnessCatalog.tsx');
const REVIEWER_PANEL = join(UI, 'project-workspace', 'RelayReviewerStatus.tsx');

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay/project/rly-001';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Renders the deployed shell and returns a fetch spy that must stay unused. */
async function renderApp(): Promise<ReturnType<typeof vi.fn>> {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  render(createElement(RelayPreviewApp));
  await act(async () => { await Promise.resolve(); });
  return fetchSpy;
}

const harnessTrigger = (): HTMLElement =>
  screen.getAllByRole('button', { name: 'Reviewer Harness' })[0];

const openCatalog = (): HTMLElement => {
  fireEvent.click(harnessTrigger());
  return screen.getByRole('dialog', { name: 'Reviewer Harness' });
};

const entryRow = (dialog: HTMLElement, catalogId: string): HTMLElement => {
  const row = dialog.querySelector<HTMLElement>(`[data-catalog-id="${catalogId}"]`);
  if (row === null) throw new Error(`no catalog row for ${catalogId}`);
  return row;
};

/* ------------------------------------------------- the entry point ----- */

describe('the Reviewer Harness control', () => {
  it('renders in the browser as a real button that names the surface', async () => {
    await renderApp();
    const trigger = harnessTrigger();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    // The accessible name identifies the surface, not just "open".
    expect(trigger.textContent).toBe('Reviewer Harness');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  }, 30_000);

  it('is reachable from the Reviewer fullscreen surface', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Reviewer panel' }));
    const focused = document.querySelectorAll('.rpw-focusable[data-focused="true"]');
    expect(focused).toHaveLength(1);
    expect(focused[0].getAttribute('data-panel')).toBe('reviewer');
    // The SAME control, inside the focused panel — not a second one.
    const triggers = screen.getAllByRole('button', { name: 'Reviewer Harness' });
    expect(triggers).toHaveLength(1);
    expect(focused[0].contains(triggers[0])).toBe(true);
    fireEvent.click(triggers[0]);
    expect(screen.getByRole('dialog', { name: 'Reviewer Harness' })).toBeTruthy();
  }, 30_000);

  it('states the connection fact beside the control, without a connection', async () => {
    await renderApp();
    expect(document.body.textContent).toContain(REVIEWER_HARNESS_NOT_CONNECTED_LABEL);
  }, 30_000);
});

/* ------------------------------------------------ the catalog itself --- */

describe('the catalog surface', () => {
  it('shows all seven canonical entries', async () => {
    await renderApp();
    const dialog = openCatalog();
    expect(dialog.querySelectorAll('.rhc-entry')).toHaveLength(7);
    for (const entry of REVIEWER_HARNESS_CATALOG) {
      expect(entryRow(dialog, entry.catalogId).textContent).toContain(entry.name);
    }
  }, 30_000);

  it('renders the maturity label the canonical catalog holds', async () => {
    await renderApp();
    const dialog = openCatalog();
    const view = projectHarnessCatalog();
    for (const entry of view.entries) {
      const row = entryRow(dialog, entry.catalogId);
      expect(row.textContent).toContain(entry.maturityLabel);
    }
    // Both labels the current catalog actually uses appear; none claims more.
    expect(dialog.textContent).toContain('Coming soon');
    expect(dialog.textContent).toContain('Experimental');
    expect(dialog.textContent).not.toContain('Available');
  }, 30_000);

  it('renders adapterAvailable false and not_installed truthfully', async () => {
    await renderApp();
    const dialog = openCatalog();
    for (const entry of REVIEWER_HARNESS_CATALOG) {
      const row = entryRow(dialog, entry.catalogId);
      expect(entry.adapterAvailable).toBe(false);
      expect(entry.installState).toBe('not_installed');
      expect(row.textContent).toContain('Adapter unavailable');
      expect(row.textContent).toContain('Not installed');
      expect(row.textContent).toContain('Not startable');
    }
  }, 30_000);

  it('never presents a catalog entry as connected, installed or ready', async () => {
    await renderApp();
    const dialog = openCatalog();
    const text = dialog.textContent ?? '';
    for (const forbidden of ['Connected', 'Verified', 'Live', 'Ready']) {
      expect(text, `catalog claims ${forbidden}`).not.toContain(forbidden);
    }
    // "Not installed" is fine; a bare "Installed" claim is not.
    expect(text.replace(/Not installed/g, '')).not.toContain('Installed');
  }, 30_000);

  it('does not display Hermes as connected, nor Grok as the actual model', async () => {
    await renderApp();
    const dialog = openCatalog();
    const hermes = entryRow(dialog, 'hermes');
    expect(hermes.textContent).toContain('Hermes');
    expect(hermes.textContent).toContain('Coming soon');
    expect(hermes.getAttribute('data-startable')).toBe('false');
    expect(dialog.textContent).not.toContain('Hermes · Connected');
    // The intended future model is nowhere on the surface at all.
    expect(document.body.textContent).not.toContain('Grok');
    expect(document.body.textContent).not.toContain('xAI');
    const actual = dialog.querySelector('[data-identity="actual_model"]');
    expect(actual?.textContent).toContain('Unknown');
  }, 30_000);
});

/* ----------------------------------------------- one canonical source -- */

describe('the browser and the CLI project one catalog', () => {
  it('renders the same entries, in the same order, as `relay reviewer harnesses`', async () => {
    await renderApp();
    const dialog = openCatalog();
    const rows = Array.from(dialog.querySelectorAll<HTMLElement>('.rhc-entry'))
      .map((n) => n.getAttribute('data-catalog-id'));
    expect(rows).toEqual(REVIEWER_HARNESS_CATALOG.map((e) => e.catalogId));

    // The CLI renders the SAME projection, so every projected fact appears in
    // its output too. One catalog, two renderers.
    const cli = renderHarnessCatalogLines().join('\n');
    for (const entry of projectHarnessCatalog().entries) {
      expect(cli).toContain(entry.catalogId);
      expect(cli).toContain(entry.name);
      expect(cli).toContain(entry.maturityLabel);
      expect(cli).toContain(`startable:   ${entry.startable ? 'yes' : 'no'}`);
    }
  }, 30_000);

  it('keeps no second catalog in the React components', () => {
    const sources = [readFileSync(CATALOG_COMPONENT, 'utf8'), readFileSync(REVIEWER_PANEL, 'utf8')];
    for (const source of sources) {
      for (const name of CANONICAL_NAMES) {
        expect(source, `a component names ${name} directly`).not.toContain(name);
      }
      // Nor the labels, statuses or capability wording they would duplicate.
      for (const label of ['Coming soon', 'Experimental', 'Adapter unavailable',
        'Not installed', 'Not startable', NO_PROVEN_CAPABILITIES_LABEL]) {
        expect(source, `a component re-states "${label}"`).not.toContain(label);
      }
    }
  });

  it('takes startability from the domain rule, never from a component', () => {
    for (const entry of projectHarnessCatalog().entries) {
      const canonical = REVIEWER_HARNESS_CATALOG.find((e) => e.catalogId === entry.catalogId);
      expect(canonical).toBeTruthy();
      expect(entry.startable).toBe(harnessIsSelectableForRun(canonical!));
    }
    expect(readFileSync(CATALOG_COMPONENT, 'utf8')).not.toContain('adapterAvailable ===');
  });
});

/* -------------------------------------------------- selector behavior -- */

describe('an unavailable harness cannot begin execution', () => {
  it('marks every non-startable row aria-disabled with a reason', async () => {
    await renderApp();
    const dialog = openCatalog();
    for (const entry of projectHarnessCatalog().entries) {
      const row = entryRow(dialog, entry.catalogId);
      const button = within(row).getByRole('button');
      expect(entry.startable).toBe(false);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      // The explanation is real text, and the button points at it.
      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const reason = document.getElementById(describedBy!);
      expect(reason?.textContent).toBe(entry.unavailableReason);
      expect(reason?.textContent).toBeTruthy();
    }
  }, 30_000);

  it('changes no identity, creates no run, no usage and no request when clicked', async () => {
    const fetchSpy = await renderApp();
    const store = getRelayAppStore();
    const dialog = openCatalog();

    const identityBefore = Array.from(dialog.querySelectorAll('[data-identity]'))
      .map((n) => n.textContent);
    const statusBefore = dialog.querySelector('[data-harness-status="true"]')?.textContent;
    const usageBefore = screen.getAllByRole('button', { name: /^Usage — / })[0].textContent;
    // The WHOLE application state, and the whole persisted state: a run, a
    // usage record or a connection would have to land in one of them.
    const stateBefore = JSON.stringify(store.getState());
    const storedBefore = JSON.stringify({ ...window.localStorage });

    // Every unavailable row, not just one.
    for (const entry of REVIEWER_HARNESS_CATALOG) {
      fireEvent.click(within(entryRow(dialog, entry.catalogId)).getByRole('button'));
    }

    expect(Array.from(dialog.querySelectorAll('[data-identity]')).map((n) => n.textContent))
      .toEqual(identityBefore);
    expect(dialog.querySelector('[data-harness-status="true"]')?.textContent).toBe(statusBefore);
    expect(dialog.querySelector('[data-harness-status="true"]')?.textContent)
      .toBe(REVIEWER_HARNESS_NOT_CONNECTED_LABEL);
    expect(screen.getAllByRole('button', { name: /^Usage — / })[0].textContent).toBe(usageBefore);
    expect(JSON.stringify(store.getState())).toBe(stateBefore);
    expect(JSON.stringify({ ...window.localStorage })).toBe(storedBefore);
    // Nothing minted a durable Reviewer harness record either.
    expect(Object.keys({ ...window.localStorage }).join(' ')).not.toContain('reviewer-harness:');
    // No provider, no agent-provider, no /relay-api — no request at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);

  it('inspects rather than starts: activation only opens the detail', async () => {
    await renderApp();
    const dialog = openCatalog();
    const row = entryRow(dialog, 'vellum');
    const button = within(row).getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(within(row).getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(entryRow(dialog, 'vellum').querySelector('.rhc-entry-detail')).toBeTruthy();
    // Still nothing that could run it.
    expect(dialog.textContent).not.toContain('Start review');
    expect(dialog.textContent).not.toContain('Connect');
  }, 30_000);

  it('announces the absence at most once, through the ONE existing host', async () => {
    await renderApp();
    const dialog = openCatalog();
    for (const entry of REVIEWER_HARNESS_CATALOG) {
      fireEvent.click(within(entryRow(dialog, entry.catalogId)).getByRole('button'));
    }
    const hosts = document.querySelectorAll('[data-relay-notification-host="true"]');
    expect(hosts).toHaveLength(1);
    const toasts = hosts[0].querySelectorAll('.rnt-toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toContain('Reviewer harness unavailable');
    expect(toasts[0].textContent).toContain('This harness is not connected yet.');
  }, 30_000);
});

/* -------------------------------------------------- identity + truth --- */

describe('identity fields stay independently Unknown', () => {
  it('shows requested and actual as five separate rows', async () => {
    await renderApp();
    const dialog = openCatalog();
    for (const [key, label] of [
      ['requested_harness', 'Requested harness'], ['actual_harness', 'Actual harness'],
      ['requested_model', 'Requested model'], ['actual_model', 'Actual model'],
      ['provider', 'Provider'],
    ] as const) {
      const row = dialog.querySelector(`[data-identity="${key}"]`);
      expect(row, `${label} row is missing`).toBeTruthy();
      expect(row?.textContent).toContain(label);
    }
    // Actual identity is Unknown and is NOT inferred from what was requested.
    expect(dialog.querySelector('[data-identity="actual_harness"]')?.textContent)
      .toContain('Unknown');
    expect(dialog.querySelector('[data-identity="actual_model"]')?.textContent)
      .toContain('Unknown');
    expect(dialog.querySelector('[data-identity="provider"]')?.textContent).toContain('Unknown');
  }, 30_000);

  it('a requested harness never becomes the actual harness', () => {
    const view = projectHarnessCatalog(projectReviewerHarness(null, {
      bridgeAvailable: true,
      selectedCatalogEntry: REVIEWER_HARNESS_CATALOG[0],
    }));
    const row = (key: string) => view.identityRows.find((r) => r.key === key)?.value;
    expect(row('requested_harness')).toBe('Hermes');
    expect(row('actual_harness')).toBe('Unknown');
    expect(view.statusLabel).toBe(REVIEWER_HARNESS_NOT_CONNECTED_LABEL);
  });

  it('an idle record keeps every observed field Unknown', () => {
    const record = sealHarnessRecord(idleHarnessRecord({
      missionId: 'm1', projectId: 'p1', missionContractRef: 'c1',
      now: '2026-08-01T12:00:00.000Z',
    }));
    const view = projectHarnessCatalog(projectReviewerHarness(record, { bridgeAvailable: false }));
    expect(view.identityRows.find((r) => r.key === 'actual_harness')?.value).toBe('Unknown');
    expect(view.identityRows.find((r) => r.key === 'actual_model')?.value).toBe('Unknown');
    expect(view.statusLabel).toBe(REVIEWER_HARNESS_NOT_CONNECTED_LABEL);
  });
});

/* ---------------------------------------------------- capabilities ----- */

describe('capabilities are proven or they are not shown', () => {
  it('says No proven capabilities for every current entry', async () => {
    await renderApp();
    const dialog = openCatalog();
    for (const entry of projectHarnessCatalog().entries) {
      expect(entry.provenCapabilityKeys).toHaveLength(0);
      expect(entryRow(dialog, entry.catalogId).textContent)
        .toContain(NO_PROVEN_CAPABILITIES_LABEL);
    }
  }, 30_000);

  it('shows a false capability as Not proven, never as supported', async () => {
    await renderApp();
    const dialog = openCatalog();
    fireEvent.click(within(entryRow(dialog, 'hermes')).getByRole('button'));
    const capabilities = entryRow(dialog, 'hermes').querySelectorAll('.rhc-cap');
    // All fifteen contract capabilities, each stated in readable text.
    expect(capabilities).toHaveLength(15);
    for (const capability of Array.from(capabilities)) {
      expect(capability.getAttribute('data-proven')).toBe('false');
      expect(capability.textContent).toContain('Not proven');
    }
  }, 30_000);
});

/* ---------------------------------------------------- independence ----- */

describe('independence is projected, never assumed', () => {
  it('renders the canonical projection, Unknown with no evidence', async () => {
    await renderApp();
    const dialog = openCatalog();
    const canonical = projectHarnessCatalog(projectReviewerHarness(null, { bridgeAvailable: false }));
    expect(dialog.querySelector('[data-independence="true"]')?.textContent)
      .toBe(canonical.independenceLabel);
    expect(canonical.independenceLabel).toBe('Unknown');
    expect(dialog.textContent).not.toContain('Independent review');
  }, 30_000);

  it('a shared session is Not independent whatever the harness is called', () => {
    const shared = assessIndependence({
      author: {
        agentId: 'a1', adapterId: 'x', sessionId: 'session-1', independenceGroup: 'g1',
        model: 'm-a', provider: 'provider-a', humanId: 'h1',
      },
      reviewer: {
        agentId: 'a2', adapterId: 'y', sessionId: 'session-1', independenceGroup: 'g2',
        model: 'm-b', provider: 'provider-b', humanId: 'h2',
      },
    });
    expect(shared.verdict).toBe('not_independent');
    const record = sealHarnessRecord(idleHarnessRecord({
      missionId: 'm1', projectId: 'p1', missionContractRef: 'c1',
      now: '2026-08-01T12:00:00.000Z',
    }));
    const view = projectHarnessCatalog(
      projectReviewerHarness({ ...record, independence: shared }, { bridgeAvailable: false }),
    );
    expect(view.independenceLabel).toBe('Not independent');
    // Different providers is a recorded FACT, not a verdict.
    expect(view.providerDiversityLabel).toBe('Different providers');
  });

  it('missing identity stays Unknown rather than becoming independent', () => {
    const missing = assessIndependence({
      author: {
        agentId: null, adapterId: 'x', sessionId: 's1', independenceGroup: 'g1',
        model: null, provider: null, humanId: null,
      },
      reviewer: {
        agentId: 'a2', adapterId: 'y', sessionId: 's2', independenceGroup: 'g2',
        model: null, provider: null, humanId: null,
      },
    });
    expect(missing.verdict).toBe('unknown');
    const record = sealHarnessRecord(idleHarnessRecord({
      missionId: 'm1', projectId: 'p1', missionContractRef: 'c1',
      now: '2026-08-01T12:00:00.000Z',
    }));
    const view = projectHarnessCatalog(
      projectReviewerHarness({ ...record, independence: missing }, { bridgeAvailable: false }),
    );
    expect(view.independenceLabel).toBe('Unknown');
    expect(view.providerDiversityLabel).toBe('Unknown');
  });
});

/* ------------------------------------------ fullscreen, focus, escape -- */

describe('fullscreen, focus and Escape', () => {
  it('opens from Reviewer fullscreen without duplicating a host or a panel', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Reviewer panel' }));
    openCatalog();
    expect(document.querySelectorAll('.rpw-focusable[data-focused="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('.rpw-reviewer')).toHaveLength(1);
    expect(document.querySelectorAll('[data-relay-harness-catalog="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-relay-notification-host="true"]').length)
      .toBeLessThanOrEqual(1);
    // Prompt Architect and Coding Agent panels keep their own controls.
    expect(screen.getByRole('button', { name: 'Expand Prompt Architect panel' })).toBeTruthy();
  }, 30_000);

  it('moves focus into the sheet and returns it to the trigger on close', async () => {
    await renderApp();
    const trigger = harnessTrigger();
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close Reviewer Harness catalog' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByRole('dialog', { name: 'Reviewer Harness' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  }, 30_000);

  it('Escape closes the catalog and leaves the focused panel open beneath it', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Reviewer panel' }));
    const dialog = openCatalog();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Reviewer Harness' })).toBeNull();
    // The topmost surface closed — and only that one.
    const focused = document.querySelectorAll('.rpw-focusable[data-focused="true"]');
    expect(focused).toHaveLength(1);
    // A second Escape then returns the panel to the workspace.
    fireEvent.keyDown(focused[0], { key: 'Escape' });
    expect(document.querySelectorAll('.rpw-focusable[data-focused="true"]')).toHaveLength(0);
  }, 30_000);
});

/* ------------------------------------------- production, not dev-only -- */

describe('the catalog ships in production', () => {
  const readIfExists = (p: string): string | null =>
    (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null);

  function resolveImport(fromFile: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const base = resolve(dirname(fromFile), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  }

  /** The real import graph from the browser entry — what Vite will bundle. */
  function closure(): string[] {
    const seen = new Set<string>();
    const queue = [join(REPO, 'src', 'relay', 'main.tsx')];
    const RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readIfExists(file);
      if (src === null) continue;
      RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE.exec(src)) !== null) {
        const r = resolveImport(file, m[1]);
        if (r !== null && !seen.has(r)) queue.push(r);
      }
    }
    return [...seen];
  }

  it('is reachable from the browser entry, so it cannot be tree-shaken out', () => {
    const files = closure();
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(CATALOG_COMPONENT);
    expect(files).toContain(join(REPO, 'src', 'relay', 'mission', 'reviewer-harness', 'harness-catalog.ts'));
    expect(files).toContain(join(REPO, 'src', 'relay', 'mission', 'reviewer-harness', 'harness-projection.ts'));
  });

  it('is not gated on a development flag', () => {
    for (const file of [CATALOG_COMPONENT, REVIEWER_PANEL,
      join(UI, 'project-workspace', 'RelayProjectWorkspace.tsx')]) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} gates on a build mode`).not.toMatch(/import\.meta\.env/);
      expect(src).not.toMatch(/process\.env\.NODE_ENV/);
      expect(src).not.toMatch(/\bif\s*\(\s*__DEV__/);
    }
  });

  it('names no provider, credential or bridge endpoint', () => {
    const src = readFileSync(CATALOG_COMPONENT, 'utf8');
    expect(src).not.toMatch(/relay-api|agent-provider|api\.x\.ai|fetch\(|XMLHttpRequest/);
    expect(src).not.toMatch(/API_KEY|VITE_XAI|VITE_GROK|VITE_HERMES/);
  });
});

/* ------------------------------------------------------------- mobile -- */

describe('the sheet stays usable on mobile', () => {
  const css = readFileSync(
    join(UI, 'project-workspace', 'relay-project-workspace.css'), 'utf8',
  );

  it('becomes a full-width sheet with touch-safe controls inside safe areas', () => {
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.rhc-sheet \{ width: 100%/);
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.rhc-close, \.rhc-entry-btn \{ min-height: 44px/);
    expect(css).toMatch(/\.rhc-sheet[\s\S]*?env\(safe-area-inset-bottom/);
    expect(css).toMatch(/\.rhc-sheet[\s\S]*?env\(safe-area-inset-top/);
  });

  it('cannot overflow horizontally and preserves reduced motion', () => {
    expect(css).toMatch(/\.rhc-sheet[\s\S]*?overflow-x: hidden/);
    expect(css).toMatch(/\.rhc-value \{[\s\S]*?overflow-wrap: anywhere/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.rhc-overlay/);
  });

  it('signals maturity and availability with text, not colour alone', () => {
    // The row's state attribute drives only a border; the words carry it.
    expect(css).toMatch(/\.rhc-entry\[data-startable='false'\] \{ border-left/);
    expect(css).not.toMatch(/\.rhc-entry-maturity \{[^}]*content:/);
  });
});

/* --------------------------------------------- existing surfaces hold -- */

describe('the surrounding surfaces are unchanged', () => {
  it('keeps Prompt Architect, Coding Agent and Reviewer fullscreen working', async () => {
    const fetchSpy = await renderApp();
    for (const panel of ['Prompt Architect', 'Reviewer']) {
      fireEvent.click(screen.getByRole('button', { name: `Expand ${panel} panel` }));
      const focused = document.querySelectorAll('.rpw-focusable[data-focused="true"]');
      expect(focused, `${panel} did not focus`).toHaveLength(1);
      fireEvent.keyDown(focused[0], { key: 'Escape' });
    }
    expect(screen.getAllByRole('button', { name: /^Usage — / })[0].textContent)
      .toBe('USAGE · UNAVAILABLE');
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);
});

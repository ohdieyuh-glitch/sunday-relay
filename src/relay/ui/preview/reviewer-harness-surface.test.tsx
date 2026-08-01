/** @vitest-environment jsdom */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { RelayAgentOperatingInspector } from '../project-workspace/RelayAgentOperatingInspector';
import {
  findCatalogEntry, projectAgentOperatingProfiles, projectReviewerHarness,
} from '../../mission';
import { operatingProfileFixture } from '../../mission/agent-operating/operating-profile-fixtures';

/** The Reviewer harness on the WEBSITE: harness and model shown separately,
    nothing Connected, and no harness credential in the browser graph. */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay/project/rly-001';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const reviewerProfile = () =>
  projectAgentOperatingProfiles([operatingProfileFixture('reviewer')])[0];

describe('the Reviewer harness line', () => {
  it('shows Harness and Model as SEPARATE labels, both Unknown before a run', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: reviewerProfile(),
      reviewer: projectReviewerHarness(null, { bridgeAvailable: false }),
    }));
    expect(document.body.textContent).toContain('Harness Unknown');
    expect(document.body.textContent).toContain('Model Unknown');
    // Never one combined identity string.
    expect(document.body.textContent).not.toMatch(/Harness .* \+ .* Connected/);
    expect(document.body.textContent).not.toContain('Connected');
  });

  it('a Coming soon harness cannot start and says so', () => {
    render(createElement(RelayAgentOperatingInspector, {
      projection: reviewerProfile(),
      reviewer: projectReviewerHarness(null, {
        bridgeAvailable: true, selectedCatalogEntry: findCatalogEntry('hermes'),
      }),
    }));
    expect(screen.getByText('Hermes · Coming soon')).toBeTruthy();
    expect(document.body.textContent).toContain('no adapter exists yet');
  });

  it('an Experimental harness is labelled, not started', () => {
    const view = projectReviewerHarness(null, {
      bridgeAvailable: true, selectedCatalogEntry: findCatalogEntry('trustclaw'),
    });
    expect(view.canStart).toBe(false);
    render(createElement(RelayAgentOperatingInspector, {
      projection: reviewerProfile(), reviewer: view,
    }));
    expect(document.body.textContent).toContain('TrustClaw');
  });

  it('omits the line when the surface knows nothing, and keeps four rows', () => {
    const { container } = render(createElement(RelayAgentOperatingInspector, {
      projection: reviewerProfile(),
    }));
    expect(container.querySelectorAll('.rpw-operating-runtime')).toHaveLength(0);
    expect(container.querySelectorAll('.rpw-operating-row')).toHaveLength(4);
  });
});

describe('offline production stays honest', () => {
  it('claims no connected harness and makes no request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('Hermes · Connected');
    expect(page).not.toContain('Reviewer harness Connected');
    expect(fetchSpy).not.toHaveBeenCalled();
    // Existing surfaces intact.
    expect(screen.getAllByRole('button', { name: /^Usage — / })[0].textContent)
      .toBe('USAGE · UNAVAILABLE');
  }, 30_000);
});

describe('no harness credential can reach the browser', () => {
  const REPO = resolve(__dirname, '..', '..', '..', '..');
  const BROWSER_ENTRY = join(REPO, 'src', 'relay', 'main.tsx');
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

  function closure(): string[] {
    const seen = new Set<string>();
    const queue = [BROWSER_ENTRY];
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

  it('names no xAI, Grok or Hermes credential anywhere reachable from the browser', () => {
    const files = closure();
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => {
      const src = readIfExists(f) ?? '';
      return /XAI_API_KEY|GROK_API_KEY|HERMES_KEY|VITE_XAI|VITE_GROK|VITE_HERMES/.test(src);
    });
    expect(offenders, 'these browser-reachable modules name a harness credential').toEqual([]);
  });

  it('defines no VITE-prefixed harness key in any tracked source', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
        } else if (/\.(ts|tsx|mts|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
          const src = readFileSync(full, 'utf8');
          if (/VITE_XAI|VITE_GROK|VITE_HERMES/.test(src)) offenders.push(full);
        }
      }
    };
    for (const root of [join(REPO, 'src'), join(REPO, 'relay-bridge')]) {
      if (existsSync(root)) walk(root);
    }
    expect(offenders).toEqual([]);
  });
});

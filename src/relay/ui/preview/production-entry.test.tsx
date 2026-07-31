import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siblingProductTarget } from './environment';

/**
 * Production-entry truthfulness.
 *
 * The Relay application shell doubles as the founder's full-flow preview
 * harness. The preview switcher (routes, fixture states, Demo Simulation,
 * appearance, zoom) was once build-gated out of production; founder
 * direction (2026-07-31) ships it WITH the offline demo product — the
 * deployed site is the walkable product tour, and the switcher is how a
 * visitor walks it. These tests fail in BOTH directions: if the switcher
 * stops shipping, and if a build gate quietly returns. The ALCATRAZ
 * sibling-product control must still never navigate to `/`, a route this
 * repository does not build.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const shell = readFileSync(join(__dirname, 'RelayPreviewApp.tsx'), 'utf8');

describe('the preview switcher ships with the product (founder direction)', () => {
  it('renders unconditionally — no build gate around the switcher', () => {
    expect(shell).toContain('rpv-devchip');
    expect(shell).toContain('Development preview switcher');
    expect(shell).toContain('DEV PREVIEW');
    // The retired gate must not quietly return.
    expect(shell).not.toContain('IS_DEV_BUILD');
  });

  it('remains collapsible behind its handle, so it never traps the product', () => {
    expect(shell).toContain('aria-expanded={switcherOpen}');
    expect(shell).toContain('aria-controls="relay-dev-preview-controls"');
  });
});

describe('production bundle', () => {
  const distDir = join(ROOT, 'dist', 'assets');
  const bundles = existsSync(distDir)
    ? readdirSync(distDir).filter((f) => f.endsWith('.js')).map((f) => join(distDir, f))
    : [];

  /**
   * BUILD-DEPENDENT, AND ACCOUNTED FOR.
   *
   * These assertions need `dist/`, which `npm test` runs before producing.
   * `it.runIf` reported them as SKIPPED, which reads as "nothing to see" —
   * so they now always run and assert in BOTH branches: either against the
   * real bundle, or that CI re-runs this exact file after `npm run build`.
   * `scripts/ci-test-accounting.test.ts` holds the ledger.
   */
  const requireCiRerun = () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'relay-ci.yml'), 'utf8');
    expect(
      workflow.includes('src/relay/ui/preview/production-entry.test.tsx'),
      'these assertions need dist/, so CI must re-run this file after `npm run build`',
    ).toBe(true);
  };

  /**
   * THE ROOT URL MUST WORK. The build once emitted only `relay.html`, so a
   * static host serving index.html at `/` returned 404 and the application was
   * reachable only at `/relay.html`. This asserts the shipped artifact, which
   * is the only place that regression is visible.
   */
  it('ships an index.html so the root URL serves the application', () => {
    const index = join(ROOT, 'dist', 'index.html');
    if (!existsSync(index)) {
      requireCiRerun();
      return;
    }
    const html = readFileSync(index, 'utf8');
    expect(html).toContain('<title>Sunday Relay</title>');
    expect(html).toContain('<div id="root"></div>');
    // Vite rewrote the entry module into a hashed asset — not the raw source.
    expect(html).toMatch(/<script type="module"[^>]+src="\/assets\/[^"]+\.js"/);
    expect(html).not.toContain('/src/relay/main.tsx');
  });

  it('keeps /relay.html as a redirect, never a second application', () => {
    const relay = join(ROOT, 'dist', 'relay.html');
    if (!existsSync(relay)) {
      requireCiRerun();
      return;
    }
    const html = readFileSync(relay, 'utf8');
    expect(html).toContain('url=/');
    // A second built application would carry a hashed module script too.
    expect(html).not.toMatch(/<script type="module"[^>]+src="\/assets\//);
    expect(html).not.toContain('id="root"');
  });

  it('ships the preview switcher (founder direction, 2026-07-31)', () => {
    if (bundles.length === 0) {
      requireCiRerun();
      return;
    }
    const all = bundles.map((b) => readFileSync(b, 'utf8')).join('');
    expect(all.includes('DEV PREVIEW'), 'the preview switcher chip must ship').toBe(true);
    expect(
      all.includes('Development preview switcher'),
      'the preview switcher nav must ship',
    ).toBe(true);
  });

  it('still identifies itself as Sunday Relay', () => {
    if (bundles.length === 0) {
      requireCiRerun();
      return;
    }
    const all = bundles.map((b) => readFileSync(b, 'utf8')).join('');
    expect(all).toContain('SUNDAY RELAY');
  });
});

describe('Alcatraz sibling-product navigation', () => {
  it('never targets the "/" route this repository does not build', () => {
    // Comments may DESCRIBE the retired behaviour; executable code may not
    // contain it.
    const executable = shell
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(executable).not.toContain("window.location.href = '/'");
    expect(executable).toContain('siblingProductTarget');
  });

  it('reports unavailable — with a reason — when no URL is configured', () => {
    for (const env of [undefined, {}, { VITE_ALCATRAZ_URL: '' }, { VITE_ALCATRAZ_URL: '   ' }]) {
      const target = siblingProductTarget(env);
      expect(target.configured).toBe(false);
      if (!target.configured) expect(target.reason.length).toBeGreaterThan(0);
    }
  });

  it('accepts an explicitly configured external Alcatraz URL', () => {
    const target = siblingProductTarget({ VITE_ALCATRAZ_URL: 'https://alcatraz.example.com/app' });
    expect(target.configured).toBe(true);
    if (target.configured) expect(target.url).toBe('https://alcatraz.example.com/app');
  });

  it('refuses a relative value — that is the original bug', () => {
    expect(siblingProductTarget({ VITE_ALCATRAZ_URL: '/' }).configured).toBe(false);
    expect(siblingProductTarget({ VITE_ALCATRAZ_URL: '/alcatraz' }).configured).toBe(false);
  });

  it('refuses a non-http(s) scheme — location.href is an injection sink', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
      expect(siblingProductTarget({ VITE_ALCATRAZ_URL: url }).configured, url).toBe(false);
    }
  });

  it('hardcodes no live Alcatraz domain', () => {
    const env = readFileSync(join(__dirname, 'environment.ts'), 'utf8');
    const executable = env.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '');
    expect(executable).not.toMatch(/https?:\/\/(?!\S*example\.com)\S+/);
  });

  it('keeps Alcatraz visible as an Aquala sibling product', () => {
    const header = readFileSync(
      join(__dirname, '..', 'entry-home', 'RelayEntryHeader.tsx'),
      'utf8',
    );
    expect(header).toContain('ALCATRAZ');
    expect(header).toContain('SUNDAY RELAY');
    // Visible, but only actionable when configured.
    expect(header).toContain('disabled={!onReturnToSunday}');
  });
});

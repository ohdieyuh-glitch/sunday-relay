import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siblingProductTarget } from './environment';

/**
 * Production-entry truthfulness.
 *
 * The Relay application shell doubles as the founder's full-flow preview
 * harness. That is useful and stays — but the shipped bundle used to render a
 * `DEV PREVIEW` chip and a route/fixture switcher unconditionally, so the
 * production build presented development scaffolding as the product. And the
 * ALCATRAZ sibling-product control navigated to `/`, a route this repository
 * does not build.
 *
 * These tests fail in BOTH directions: if development labelling reaches a
 * production build, and if the development tooling disappears from the source.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const shell = readFileSync(join(__dirname, 'RelayPreviewApp.tsx'), 'utf8');

describe('development tooling is gated on the build', () => {
  it('the DEV PREVIEW chip renders only under IS_DEV_BUILD', () => {
    expect(shell).toContain('IS_DEV_BUILD');
    // The chip markup must sit INSIDE the guard, not beside it.
    const guardAt = shell.indexOf('{IS_DEV_BUILD && (');
    const chipAt = shell.indexOf('rpv-devchip');
    const navAt = shell.indexOf('Development preview switcher');
    expect(guardAt).toBeGreaterThan(-1);
    expect(chipAt).toBeGreaterThan(guardAt);
    expect(navAt).toBeGreaterThan(guardAt);
  });

  it('development preview tooling still EXISTS — gating must not mean deleting', () => {
    expect(shell).toContain('rpv-devchip');
    expect(shell).toContain('Development preview switcher');
    expect(shell).toContain('DEV PREVIEW');
  });

  it('the gate is a build fact, not a runtime flag a user could flip', () => {
    const env = readFileSync(join(__dirname, 'environment.ts'), 'utf8');
    expect(env).toContain('import.meta.env');
    expect(env).toContain('DEV');
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

  it('contains no DEV PREVIEW label', () => {
    if (bundles.length === 0) {
      requireCiRerun();
      return;
    }
    for (const bundle of bundles) {
      const code = readFileSync(bundle, 'utf8');
      expect(code.includes('DEV PREVIEW'), `${bundle} ships a DEV PREVIEW label`).toBe(false);
      expect(code.includes('Development preview switcher'), `${bundle} ships the dev switcher`).toBe(false);
    }
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

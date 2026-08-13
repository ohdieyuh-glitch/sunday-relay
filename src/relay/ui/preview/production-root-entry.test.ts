import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * THE PRODUCTION ROOT ENTRY.
 *
 * The build used to emit only the relay document and no index document, so a
 * host that serves index.html at the root URL returned 404 and the application
 * was reachable only at /relay.html. That is a broken first customer-facing
 * deployment, and it is the only thing these tests are about.
 *
 * These are SOURCE-level assertions and read no build artifact; the shipped
 * output is asserted by `production-entry.test.tsx`, which the CI ledger
 * already declares build-dependent and re-runs after the website build.
 *
 * The repair is the ordinary Vite convention — the canonical document is
 * `index.html` at the repository root — with `relay.html` kept as a REDIRECT
 * so existing links do not break. The property that matters most is that the
 * redirect is not a second copy of the application: two complete documents
 * would drift, and the customer would open whichever one was stale.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const INDEX = read('index.html');
const RELAY = read('relay.html');
const VITE = read('vite.config.mts');

describe('the canonical application document', () => {
  it('is index.html, at the repository root', () => {
    expect(existsSync(join(ROOT, 'index.html'))).toBe(true);
    expect(INDEX).toContain('<title>Sunday Relay</title>');
  });

  it('loads the Relay application entry module', () => {
    expect(INDEX).toContain('<script type="module" src="/src/relay/main.tsx"></script>');
    expect(INDEX).toContain('<div id="root"></div>');
  });

  it('resolves its assets from the site root, so `/` works on a static host', () => {
    // A relative href would resolve differently at `/` than at `/relay.html`.
    expect(INDEX).toContain('href="/icon.svg"');
    expect(INDEX).not.toMatch(/src="\.\/|href="\.\//);
  });

  it('keeps the mobile-hardened viewport it always had', () => {
    expect((INDEX.match(/name="viewport"/g) ?? []).length).toBe(1);
    expect(INDEX).toContain('width=device-width, initial-scale=1.0, viewport-fit=cover');
  });

  it('is the Vite root input, so no host-specific rewrite is needed', () => {
    expect(VITE).toContain("main: fileURLToPath(new URL('./index.html'");
  });
});

describe('relay.html compatibility', () => {
  it('still exists, so an old link or bookmark does not 404', () => {
    expect(existsSync(join(ROOT, 'relay.html'))).toBe(true);
    expect(VITE).toContain("relay: fileURLToPath(new URL('./relay.html'");
  });

  it('redirects to the root URL', () => {
    expect(RELAY).toContain('<meta http-equiv="refresh" content="0; url=/" />');
    expect(RELAY).toContain("window.location.replace('/')");
    expect(RELAY).toContain('<link rel="canonical" href="/" />');
  });

  it('is NOT a second copy of the application', () => {
    // The whole point: no module script, no mount node, no app markup. A
    // second real document is a document that drifts.
    expect(RELAY).not.toContain('/src/relay/main.tsx');
    expect(RELAY).not.toContain('id="root"');
    expect(RELAY).not.toContain('type="module"');
  });

  it('is far smaller than the real document — a copy could not be', () => {
    expect(RELAY.length).toBeLessThan(INDEX.length * 3);
    expect(RELAY).toContain('COMPATIBILITY ONLY');
  });
});

describe('there is exactly one application document', () => {
  it('no other root HTML file mounts the Relay application', () => {
    const mounting = readdirSync(ROOT)
      .filter((f) => f.endsWith('.html'))
      .filter((f) => read(f).includes('/src/relay/main.tsx'));
    expect(mounting).toEqual(['index.html']);
  });
});

describe('the offline demo build needs nothing configured', () => {
  it('the canonical document requires no environment variable', () => {
    // Nothing in the entry document is substituted at build time.
    expect(INDEX).not.toMatch(/%[A-Z_]+%|import\.meta\.env|process\.env/);
  });

  it('live mode stays off unless VITE_RELAY_LIVE is explicitly "1"', () => {
    // Unset, empty and "0" all remain the offline demo adapter — enforced by the
    // one gate configuredBridgeUrl (a flag ≠ '1' returns null), which store.ts
    // routes the adapter choice through.
    const gate = read('src/relay/ui/app/bridge-session.ts');
    expect(gate).toContain("env?.VITE_RELAY_LIVE !== '1'");
    const store = read('src/relay/ui/app/store.ts');
    expect(store).toContain('configuredBridgeUrl(env)');
  });

  it('the build config adds no /relay-api infrastructure for production', () => {
    // The `/relay-api` proxy exists only for the dev and preview SERVERS; a
    // static production build must not depend on a bridge that is not hosted.
    const proxyBlocks = VITE.match(/'\/relay-api'/g) ?? [];
    expect(proxyBlocks.length).toBe(2); // server + preview only
    // …and both are `proxy` entries, which only the dev and preview servers
    // read. The `build:` block — the only part that shapes the static output a
    // host actually serves — declares no proxy at all. Comments are stripped
    // first: the prose above `server:` legitimately explains the proxy.
    const code = VITE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const buildBlock = code.slice(code.indexOf('build: {'), code.indexOf('server: {'));
    expect(buildBlock).not.toContain('proxy');
    expect((code.match(/proxy: \{/g) ?? []).length).toBe(2);
  });
});

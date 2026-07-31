import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Relay isolation contract.
 *
 * Sunday Relay is an independent product in its own repository. The contract
 * this file enforced while Relay was a tenant of the Sunday Alcatraz repo is
 * kept as a PERMANENT guard, because the boundary still matters: Relay must
 * never grow a dependency on Alcatraz's engine, server, session store or UI,
 * and must never import another product's stylesheet.
 *
 * - Relay application code lives in src/relay/** + index.html.
 * - Relay never imports the Alcatraz engine, server, or session store.
 * - Relay styles itself from its OWN token sheet (src/relay/relay-tokens.css).
 * Source-level assertions, matching the project's boundary-test convention.
 */

const root = process.cwd();
const relayDir = join(root, 'src', 'relay');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const FORBIDDEN_IMPORT_PATTERNS: Array<[RegExp, string]> = [
  [/from\s+['"]@\/fusion-engine/, 'the Alcatraz fusion engine (backend-only)'],
  [/from\s+['"].*\.\.\/fusion-engine/, 'the Alcatraz fusion engine via relative path'],
  [/from\s+['"]@\/state\//, 'the Alcatraz session store'],
  [/from\s+['"].*\.\.\/\.\.\/state\//, 'the Alcatraz session store via relative path'],
  [/from\s+['"]@\/core\//, 'shared core modules (keep Relay self-contained)'],
  [/from\s+['"]@\/components\//, 'shared app components'],
  [/from\s+['"].*server\//, 'the node server'],
];

describe('relay isolation boundary', () => {
  const files = walk(relayDir);

  it('has relay source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never imports Alcatraz engine, server, session store, or shared UI', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const [pattern, why] of FORBIDDEN_IMPORT_PATTERNS) {
        expect(pattern.test(content), `${file} imports ${why}`).toBe(false);
      }
    }
  });

  it('never imports another product\'s stylesheet', () => {
    // `.test.ts` files are excluded because this assertion names the forbidden
    // specifier as a literal — the same convention the checks below use.
    const foreign = files.filter(
      (f) => !f.endsWith('.test.ts') && readFileSync(f, 'utf8').includes("'@/styles/global.css'"),
    );
    expect(foreign).toEqual([]);
  });

  it('styles itself from its own token sheet, imported only by the entry', () => {
    const importers = files.filter(
      (f) => !f.endsWith('.test.ts') && readFileSync(f, 'utf8').includes("'./relay-tokens.css'"),
    );
    expect(importers).toEqual([join(relayDir, 'main.tsx')]);
  });

  it('ships its own entry page wired to the relay main', () => {
    // The CANONICAL document is `index.html` — Vite's normal root entry — so
    // the deployed application loads from `/` with no host-specific rewrite.
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('<title>Sunday Relay</title>');
    expect(html).toContain('/src/relay/main.tsx');
  });

  it('registers the canonical entry as the product build input', () => {
    const vite = readFileSync(join(root, 'vite.config.mts'), 'utf8');
    expect(vite).toContain("main: fileURLToPath(new URL('./index.html'");
    expect(vite).toContain("relay: fileURLToPath(new URL('./relay.html'");
  });

  it('keeps the historical status and integration records', () => {
    expect(readFileSync(join(root, 'RELAY_STATUS.md'), 'utf8')).toContain('Sunday Relay');
    expect(readFileSync(join(root, 'RELAY_INTEGRATION.md'), 'utf8')).toContain('Shared-file delta');
  });

  it('persists under its own storage key, never the session store keys', () => {
    const store = readFileSync(join(relayDir, 'state', 'store.ts'), 'utf8');
    expect(store).toContain("'sunday.relay.v1'");
    expect(store).not.toContain('fusion-session');
  });
});

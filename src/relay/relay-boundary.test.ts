import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Relay isolation contract (see RELAY_INTEGRATION.md):
 * - Relay code lives in src/relay/** + relay.html only.
 * - Relay never imports the Alcatraz engine, server, or session store.
 * - The only shared-file edit is the vite rollup input for the relay entry.
 * Source-level assertions, matching the repo's boundary-test convention.
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

  it('only the entry imports the shared global stylesheet, read-only', () => {
    const importers = files.filter(
      (f) => !f.endsWith('.test.ts') && readFileSync(f, 'utf8').includes("'@/styles/global.css'"),
    );
    expect(importers).toEqual([join(relayDir, 'main.tsx')]);
  });

  it('ships its own entry page wired to the relay main', () => {
    const html = readFileSync(join(root, 'relay.html'), 'utf8');
    expect(html).toContain('<title>Sunday Relay</title>');
    expect(html).toContain('/src/relay/main.tsx');
  });

  it('registers the relay entry in the vite build (the single shared-file edit)', () => {
    const vite = readFileSync(join(root, 'vite.config.mts'), 'utf8');
    expect(vite).toContain("relay: fileURLToPath(new URL('./relay.html'");
  });

  it('keeps status and integration docs present for the parallel Alcatraz session', () => {
    expect(readFileSync(join(root, 'RELAY_STATUS.md'), 'utf8')).toContain('Sunday Relay');
    expect(readFileSync(join(root, 'RELAY_INTEGRATION.md'), 'utf8')).toContain('Shared-file delta');
  });

  it('persists under its own storage key, never the session store keys', () => {
    const store = readFileSync(join(relayDir, 'state', 'store.ts'), 'utf8');
    expect(store).toContain("'sunday.relay.v1'");
    expect(store).not.toContain('fusion-session');
  });
});

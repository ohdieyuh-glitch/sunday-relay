import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Milestone 2 boundary tests (repo convention: source-level assertions, see
 * relay-core-boundary.test.ts). The command domain is PURE: no providers, no
 * network, no process control, no React, no storage, no clocks, no secrets.
 */

const dir = join(process.cwd(), 'src', 'relay', 'mission', 'commands');
const sources = readdirSync(dir)
  .filter((name) => /\.ts$/u.test(name) && !/\.test\.ts$/u.test(name))
  .map((name) => join(dir, name));
const read = (file: string) => readFileSync(file, 'utf8');

const FORBIDDEN: Array<[RegExp, string]> = [
  [/from\s+['"]react/u, 'React'],
  [/from\s+['"]zustand/u, 'zustand'],
  [/from\s+['"]openai['"]|from\s+['"]@anthropic/u, 'provider SDKs'],
  [/from\s+['"].*connectors\//u, 'live agent connectors'],
  [/from\s+['"].*relay-bridge/u, 'the relay bridge'],
  [/from\s+['"].*fusion-engine/u, 'the Fusion Engine'],
  [/from\s+['"]node:(?:child_process|net|http|https|fs)/u, 'process/network/fs modules'],
  [/\bfetch\s*\(/u, 'network fetch'],
  [/XMLHttpRequest|WebSocket/u, 'network transports'],
  [/child_process|execSync|spawnSync/u, 'process control'],
  [/process\.env/u, 'environment variables'],
  [/Date\.now\(|new Date\(\)/u, 'ambient clocks (ids/timestamps are caller-supplied)'],
  [/Math\.random\(/u, 'non-determinism'],
  [/localStorage|sessionStorage|indexedDB/u, 'browser storage'],
];

/** The ONLY modules the command domain may reach outside its own directory. */
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  '../status/status-model',
  '../entitlement',
  '../terminal',
]);

describe('mission command domain boundary', () => {
  it('finds the command domain sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(16);
  });

  it('no command module references providers, network, processes, storage, clocks, or env', () => {
    for (const file of sources) {
      const content = read(file);
      for (const [pattern, why] of FORBIDDEN) {
        expect(pattern.test(content), `${file} must not reference ${why}`).toBe(false);
      }
    }
  });

  it('imports stay inside the domain plus the three sanctioned mission modules', () => {
    for (const file of sources) {
      const content = read(file);
      for (const match of content.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
        const specifier = match[1];
        const allowed =
          specifier.startsWith('./') || ALLOWED_EXTERNAL_IMPORTS.has(specifier);
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('zero dispatch vocabulary: no module names a live provider invocation', () => {
    for (const file of sources) {
      const content = read(file);
      expect(/launchAgent|dispatchMission|startProcess|runProvider/u.test(content)).toBe(false);
    }
  });
});

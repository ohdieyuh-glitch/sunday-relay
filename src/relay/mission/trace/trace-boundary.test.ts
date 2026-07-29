import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Milestone 4 boundary tests (repo convention: source-level assertions). The
 * trace domain is PURE and browser-safe: no providers, no network, no process
 * control, no database client, no React, no ambient clocks, no environment
 * access — and, critically, NO `node:` imports, which is why the SHA-256
 * implementation is hand-written rather than borrowed from `node:crypto`.
 *
 * This is the mechanical proof of "zero external activity" for this milestone.
 */

const dir = join(process.cwd(), 'src', 'relay', 'mission', 'trace');
const sources = readdirSync(dir)
  .filter((name) => /\.ts$/u.test(name) && !/\.test\.ts$/u.test(name))
  .map((name) => join(dir, name));
const read = (file: string) => readFileSync(file, 'utf8');

const FORBIDDEN: Array<[RegExp, string]> = [
  [/from\s+['"]node:/u, 'node builtins (the domain must stay browser-safe)'],
  [/from\s+['"]react/u, 'React'],
  [/from\s+['"]zustand/u, 'zustand'],
  [/from\s+['"]openai['"]|from\s+['"]@anthropic/u, 'provider SDKs'],
  [/from\s+['"].*connectors\//u, 'live agent connectors'],
  [/from\s+['"].*relay-bridge/u, 'the relay bridge'],
  [/from\s+['"].*fusion-engine/u, 'the Fusion Engine'],
  [/\bfetch\s*\(/u, 'network fetch'],
  [/XMLHttpRequest|WebSocket/u, 'network transports'],
  [/child_process|execSync|spawnSync|process\.kill/u, 'process control'],
  [/process\.env/u, 'environment variables'],
  [/Date\.now\(|new Date\(\)/u, 'ambient clocks (timestamps are caller-supplied)'],
  [/Math\.random\(/u, 'non-determinism'],
  [/localStorage|sessionStorage|indexedDB/u, 'browser storage'],
  [/createClient|supabase/iu, 'database clients'],
];

/** The ONLY modules the trace domain may reach outside its own directory. */
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  '../status/status-model',
  '../commands/command-events',
  '../execution-capsules/capsule-types',
  '../execution-capsules/capsule-status',
  '../execution-capsules/capsule-trace-reference',
]);

describe('aquala trace domain boundary', () => {
  it('finds the trace domain sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(14);
  });

  it('no trace module reaches node, providers, network, processes, storage, clocks, or env', () => {
    for (const file of sources) {
      const content = read(file);
      for (const [pattern, why] of FORBIDDEN) {
        expect(pattern.test(content), `${file} must not reference ${why}`).toBe(false);
      }
    }
  });

  it('imports stay inside the domain plus the sanctioned mission modules', () => {
    for (const file of sources) {
      const content = read(file);
      for (const match of content.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
        const specifier = match[1];
        const allowed = specifier.startsWith('./') || ALLOWED_EXTERNAL_IMPORTS.has(specifier);
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('no module names a live provider invocation or process intervention', () => {
    for (const file of sources) {
      expect(
        /launchAgent\(|dispatchMission\(|startProcess\(|runProvider\(|spawnAgent\(/u.test(read(file)),
        `${file} must not name a live invocation`,
      ).toBe(false);
    }
  });

  it('the hasher is a real SHA-256, not an invented checksum', () => {
    const hashing = read(join(dir, 'trace-hashing.ts'));
    expect(hashing).toMatch(/FIPS 180-4/u);
    expect(hashing).toMatch(/0x6a09e667/u); // the standard SHA-256 initial state
    expect(hashing).toMatch(/0x428a2f98/u); // the standard round constants
    // The weak, non-cryptographic repo digest is never IMPORTED or CALLED for
    // the chain (naming it in a comment that explains why is fine).
    for (const file of sources) {
      const content = read(file);
      expect(/import[^;]*stableDigest/u.test(content), `${file} must not import stableDigest`).toBe(false);
      expect(/\bstableDigest\s*\(/u.test(content), `${file} must not call stableDigest`).toBe(false);
    }
  });

  it('the in-memory repository is explicitly labeled non-production', () => {
    const repository = read(join(dir, 'trace-repository.ts'));
    expect(repository).toMatch(/NOT a database and NOT\s*\n?\s*\*?\s*production persistence/u);
  });

  it('no module claims a live cross-product integration', () => {
    for (const file of sources) {
      const content = read(file);
      // Only Relay and manual events are emitted; other products are schema
      // compatibility plus documented boundaries.
      expect(/live (?:alcatraz|ophiuchus|aladiah) integration/iu.test(content)).toBe(false);
    }
  });

  it('economics values are never computed in the trace domain', () => {
    for (const file of sources) {
      const content = read(file);
      expect(/costUsd\s*[:=]\s*[0-9]/u.test(content), `${file} must not compute a cost`).toBe(false);
    }
  });
});

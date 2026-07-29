import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Milestone 3 boundary tests (repo convention: source-level assertions, see
 * relay-core-boundary.test.ts and the Milestone 2 command boundary). The
 * capsule domain is PURE: no providers, no network, no process control, no
 * React, no storage, no ambient clocks, no environment access.
 *
 * This is the mechanical proof of "zero external activity" for this milestone.
 */

const dir = join(process.cwd(), 'src', 'relay', 'mission', 'execution-capsules');
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
  [/from\s+['"]node:(?:child_process|net|http|https|fs|dns)/u, 'process/network/fs modules'],
  [/\bfetch\s*\(/u, 'network fetch'],
  [/XMLHttpRequest|WebSocket/u, 'network transports'],
  [/child_process|execSync|spawnSync|process\.kill/u, 'process control'],
  [/process\.env/u, 'environment variables'],
  [/Date\.now\(|new Date\(\)/u, 'ambient clocks (timestamps are caller-supplied)'],
  [/Math\.random\(/u, 'non-determinism'],
  [/localStorage|sessionStorage|indexedDB/u, 'browser storage'],
  [/createClient|supabase/iu, 'database clients'],
];

/** The ONLY modules the capsule domain may reach outside its own directory. */
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  '../status/status-model',
  '../contracts',
  '../terminal',
  '../commands/command-context',
  '../commands/command-events',
]);

describe('execution capsule domain boundary', () => {
  it('finds the capsule domain sources', () => {
    expect(sources.length).toBeGreaterThanOrEqual(13);
  });

  it('no capsule module reaches providers, network, processes, storage, clocks, or env', () => {
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
      const content = read(file);
      expect(
        /launchAgent\(|dispatchMission\(|startProcess\(|runProvider\(|spawnAgent\(/u.test(content),
        `${file} must not name a live invocation`,
      ).toBe(false);
    }
  });

  it('the domain never claims to build PRODUCTION attestations', () => {
    const identity = read(join(dir, 'capsule-identity.ts')).replace(/\s*\n\s*\*\s*/gu, ' ');
    expect(identity).toMatch(/never by the executing agent/u);
    // The production attestation builder is not imported anywhere here.
    for (const file of sources) {
      expect(/from\s+['"]\.\.\/attestation['"]/u.test(read(file))).toBe(false);
    }
  });

  it('the in-memory repository is explicitly labeled non-production', () => {
    const repository = read(join(dir, 'capsule-repository.ts'));
    expect(repository).toMatch(/NOT a database and NOT\s+\*?\s*production persistence/u);
  });
});

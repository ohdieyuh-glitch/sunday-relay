import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The mission-trace module is owned by BRIDGE at
 * 7e71a122fe03a2538904ab4b8651e034dcf2c1f3. These copies stay byte-identical.
 * A drift fails this test. The `.mjs` blob is the one the workflow and the
 * runtime call; it imports only `node:crypto`.
 *
 * The doc is the one exception: it was corrected after 7e71a122 and its blob
 * re-pinned. `/progress` serves `spanId` and `traceparent` as null on every
 * phase; the BRIDGE copy said each phase carried a span id. The pin is the
 * `git hash-object` of the corrected file, which `gitBlobSha1` reproduces.
 */
const OWNED_BY_BRIDGE_AT_7E71A122: Readonly<Record<string, string>> = {
  'scripts/julius-mission-trace.mjs': '8b9e799f39f0d7a70db4e3a22e486b565bb9e523',
  'scripts/julius-mission-trace.d.mts': 'be12ea93c2ac35cbf80870ec3b7e638502cf19bd',
  'scripts/julius-mission-trace.test.ts': 'c733b1358d447bdf6fa6b218ba4291a4fdbc1e28',
  'docs/JULIUS_MISSION_TRACE.md': 'd81ba5bd3961e0d14b8ca01184343d214532d792',
};

function gitBlobSha1(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${String(bytes.length)}\0`).update(bytes).digest('hex');
}

describe('mission trace module matches BRIDGE at 7e71a122', () => {
  const root = resolve(import.meta.dirname, '..');
  for (const [rel, sha] of Object.entries(OWNED_BY_BRIDGE_AT_7E71A122)) {
    it(`${rel} is byte-identical`, () => {
      expect(gitBlobSha1(readFileSync(resolve(root, rel)))).toBe(sha);
    });
  }

  it('the module imports only node:crypto', () => {
    const source = readFileSync(resolve(root, 'scripts/julius-mission-trace.mjs'), 'utf8');
    expect(source).toContain("import { createHash } from 'node:crypto';");
    expect(source.match(/^import .+$/gmu)).toEqual(["import { createHash } from 'node:crypto';"]);
  });
});

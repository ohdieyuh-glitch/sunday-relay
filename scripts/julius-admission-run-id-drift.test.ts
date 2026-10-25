import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Gatekeeper: the shared run-id module is owned by #434 at 090eabbb.
 * These copies stay byte-identical until that pull request lands and this
 * branch takes them through an ordinary merge. A drift fails this test.
 */
const OWNED_BY_434_AT_090EABBB: Readonly<Record<string, string>> = {
  'scripts/julius-admission-run-id.mjs': 'c560b73a2957dad284177f5fa2558b067c80f0fe',
  'scripts/julius-admission-run-id.d.mts': '0720a987c51483dce897a3133ade37e3dfd94c33',
  'scripts/julius-admission-run-id.test.ts': '68bb6e03bcb5afd9f2418b1832c612456352870a',
  'src/relay/mission/julius/julius-spent-tag-record.ts': 'f6ee4e9ddeb2f6f24d2afaa4a2ef32f74ef950a2',
  'src/relay/mission/julius/julius-spent-tag-contract.test.ts': 'e9f1c71200b26453dfe2884428bbcad9015f53bd',
};

function gitBlobSha1(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${String(bytes.length)}\0`).update(bytes).digest('hex');
}

describe('shared run-id module matches #434 at 090eabbb', () => {
  const root = resolve(import.meta.dirname, '..');
  for (const [rel, sha] of Object.entries(OWNED_BY_434_AT_090EABBB)) {
    it(`${rel} is byte-identical`, () => {
      expect(gitBlobSha1(readFileSync(resolve(root, rel)))).toBe(sha);
    });
  }
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Byte-for-byte copy of PR #434 head 090eabbb64008f6526e90183f0a2849f7a021ee4.
 * These are SHA-256 hashes of the file bytes. A drift fails this test.
 */
const PR_434_HEAD = '090eabbb64008f6526e90183f0a2849f7a021ee4';
const EXPECTED_SHA256 = {
  'julius-admission-run-id.mjs': '4000164514507f6fe64aa7e9397af850207237921048daa6b7a4713d2f098cfb',
  'julius-admission-run-id.d.mts': '8bb33449acfc0c19e6a764b652f106fc51fcafe9ac1d385657ecf67043ea5a9c',
  'julius-admission-run-id.test.ts': 'df1c4a7b9bbd4379f32fde6545714db2caa90f09e9ca80eae8e7237b01c1a202',
} as const;

describe(`julius admission run id copy of ${PR_434_HEAD}`, () => {
  it('matches the stored SHA-256 of each copied file', () => {
    for (const [name, expected] of Object.entries(EXPECTED_SHA256)) {
      const bytes = readFileSync(resolve(import.meta.dirname, name));
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash, name).toBe(expected);
    }
  });
});

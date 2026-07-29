import { describe, expect, it } from 'vitest';

import { isValidHashFormat, normalizeHash, sha256Hex } from './trace-hashing';

/**
 * Known-answer tests. The expected digests are the published FIPS 180-4
 * vectors plus values independently produced by a reference SHA-256 — if this
 * implementation ever drifts, the chain silently stops being tamper-evident,
 * so these are the most load-bearing assertions in the milestone.
 */
describe('SHA-256 known vectors', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'sunday relay aquala trace',
      'd6cd2c29f409a48850909130f58c209bfec6a7e01e0a00d0f523f54318dbda80',
    ],
  ])('hashes %j correctly', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('hashes a 1,000,000-character message (multi-block padding boundary)', () => {
    // FIPS 180-4 long-message vector: one million 'a' characters.
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('hashes messages across every padding boundary deterministically', () => {
    // 55/56/63/64 bytes are where the length field forces an extra block.
    for (const length of [54, 55, 56, 63, 64, 65, 119, 120]) {
      const hash = sha256Hex('x'.repeat(length));
      expect(isValidHashFormat(hash)).toBe(true);
      expect(sha256Hex('x'.repeat(length))).toBe(hash);
    }
  });

  it('handles multi-byte UTF-8 correctly', () => {
    // Distinct characters must not collide, and hashing must be stable.
    const a = sha256Hex('café — 日本語');
    const b = sha256Hex('café — 日本語');
    expect(a).toBe(b);
    expect(a).not.toBe(sha256Hex('cafe — 日本語'));
  });

  it('is avalanche-sensitive: a one-character change changes the digest', () => {
    expect(sha256Hex('trace-event-1')).not.toBe(sha256Hex('trace-event-2'));
  });
});

describe('hash format', () => {
  it('accepts a 64-character lowercase hex digest', () => {
    expect(isValidHashFormat(sha256Hex('abc'))).toBe(true);
  });

  it.each([
    ['too short', 'abc123'],
    ['too long', `${'a'.repeat(65)}`],
    ['non-hex', `${'z'.repeat(64)}`],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidHashFormat(value)).toBe(false);
    expect(normalizeHash(value)).toBeNull();
  });

  it('normalizes case and surrounding whitespace but never repairs length', () => {
    const upper = sha256Hex('abc').toUpperCase();
    expect(normalizeHash(`  ${upper}  `)).toBe(sha256Hex('abc'));
    expect(normalizeHash('ABC')).toBeNull();
  });
});

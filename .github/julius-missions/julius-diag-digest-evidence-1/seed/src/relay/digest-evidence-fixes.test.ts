import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { sha256Hex } from './mission/durable/durable-digest.ts';
import { evidenceAge } from './mission/evidence/evidence-contracts.ts';

/**
 * TWO LATENT DEFECTS IN TWO RELAY DOMAIN MODULES — THE SPECIFICATION.
 *
 * Each module is real Relay code with a documented intent and a behaviour that does not match it. The tests pin the main behaviours of each fix; the acceptance
 * criteria in the contract state the wider invariants in words.
 *
 *   A. `sha256Hex` (mission/durable/durable-digest.ts). Its doc says it is "byte-identical to `sha256Hex` in the Node layer", which hashes the UTF-8 bytes of the
 *      string with `node:crypto`. The module's own UTF-8 encoder (it has no TextEncoder) mishandles unpaired surrogates: a high surrogate at the end of the string,
 *      a lone low surrogate, and a high surrogate followed by a character that is not a low surrogate all hash differently from Node (the last one even swallows
 *      the next character).
 *   B. `evidenceAge` (mission/evidence/evidence-contracts.ts). "A publication time in the future is also unknown rather than negative". The future test runs
 *      after the difference has been rounded to whole minutes, so a publication up to thirty seconds in the future rounds to zero and is reported as `live`.
 */

const nodeHex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/* ------------------------------------------------------------------------------------------------------------------- A: the digest matches Node */

test('A: control: ordinary text, two-byte, three-byte and paired-surrogate (four-byte) characters hash exactly as Node does', () => {
  for (const text of ['', 'a', 'hello world', 'café', 'ünïcödé', '€', '日本語', '\u{1F600}', 'x\u{1F600}y', 'a\u{1F680}\u{1F600}b', '\u0000\u007f\u0080߿ࠀ￿']) {
    assert.equal(sha256Hex(text), nodeHex(text), JSON.stringify(text));
  }
});

test('A: a high surrogate with nothing after it hashes as Node does', () => {
  for (const text of ['\ud83d', 'a\ud83d', 'é\ud83d', '\u{1F600}\ud83d']) assert.equal(sha256Hex(text), nodeHex(text), JSON.stringify(text));
});

test('A: a lone low surrogate hashes as Node does', () => {
  for (const text of ['\ude00', 'a\ude00', '\ude00b', '\u{1F600}\ude00']) assert.equal(sha256Hex(text), nodeHex(text), JSON.stringify(text));
});

test('A: a high surrogate followed by something that is not a low surrogate hashes as Node does, and does not swallow what follows', () => {
  for (const text of ['\ud83dA', '\ud83d\ud83d', '\ud83d😀', 'x\ud83déy', '\ud83d€z']) assert.equal(sha256Hex(text), nodeHex(text), JSON.stringify(text));
});

test('A: every combination of a small alphabet that includes lone surrogates, up to length four, agrees with Node', () => {
  const alphabet = ['a', 'é', '€', '\u{1F600}', '\ud83d', '\ude00'];
  let checked = 0;
  const walk = (prefix: string, depth: number): void => {
    for (const ch of alphabet) {
      const text = prefix + ch;
      assert.equal(sha256Hex(text), nodeHex(text), JSON.stringify(text));
      checked += 1;
      if (depth > 1) walk(text, depth - 1);
    }
  };
  walk('', 4);
  assert.equal(checked, 6 + 36 + 216 + 1296);
});

/* ------------------------------------------------------------------------------------------------------------------------ B: future publication */

const RETRIEVED = '2026-08-10T12:00:00.000Z';
const at = (seconds: number): string => new Date(Date.parse(RETRIEVED) + seconds * 1000).toISOString();

test('B: control: unknown, unparseable, past and clearly-future publication times are classified as before', () => {
  assert.deepEqual(evidenceAge(null, RETRIEVED), { minutes: null, freshness: 'unknown' });
  assert.deepEqual(evidenceAge('', RETRIEVED), { minutes: null, freshness: 'unknown' });
  assert.deepEqual(evidenceAge('not a date', RETRIEVED), { minutes: null, freshness: 'unknown' });
  assert.deepEqual(evidenceAge(at(3600), RETRIEVED), { minutes: null, freshness: 'unknown' });
  assert.deepEqual(evidenceAge(at(-120), RETRIEVED), { minutes: 2, freshness: 'live' });
  assert.equal(evidenceAge(at(0), RETRIEVED).minutes, 0, 'published exactly at retrieval is age zero, and live');
  assert.equal(evidenceAge(at(0), RETRIEVED).freshness, 'live');
});

test('B: a publication time later than the retrieval time by any amount is unknown, not live', () => {
  for (const seconds of [1, 10, 29, 30, 31, 59, 60, 90]) {
    assert.deepEqual(evidenceAge(at(seconds), RETRIEVED), { minutes: null, freshness: 'unknown' }, `${seconds}s in the future`);
  }
});

test('B: the past still rounds to whole minutes, and a publication just before retrieval is not mistaken for the future', () => {
  assert.deepEqual(evidenceAge(at(-1), RETRIEVED), { minutes: 0, freshness: 'live' });
  assert.deepEqual(evidenceAge(at(-29), RETRIEVED), { minutes: 0, freshness: 'live' });
  assert.deepEqual(evidenceAge(at(-31), RETRIEVED), { minutes: 1, freshness: 'live' });
  assert.equal(Object.is(evidenceAge(at(-1), RETRIEVED).minutes, 0), true, 'zero, never negative zero');
});

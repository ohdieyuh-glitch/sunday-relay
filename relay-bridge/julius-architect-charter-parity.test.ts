import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { J1_ARCHITECT_CHARTER } from './julius-dispatch-adapters';

/** The sha256 pinned in the prereg: the live Julius architect charter (ARCHITECT_CHARTER in julius/live-workers.ts, 15 strings joined by one space). */
const PINNED_LIVE_CHARTER_SHA256 = '932ddd0b3010ec754b31abdb1f5b1ba9b34fb11ee5bf87f2ec91cbdd0aea2d0d';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Reads the live charter text READ-ONLY from live-workers.ts: the array literal between the const and its join, block comments dropped, every single-quoted string joined by one space. */
function extractLiveCharter(): string {
  const src = readFileSync(resolve(__dirname, 'julius', 'live-workers.ts'), 'utf8');
  const start = src.indexOf('const ARCHITECT_CHARTER = [');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("].join(' ');", start);
  const body = src.slice(start + 'const ARCHITECT_CHARTER = ['.length, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const parts = [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  return parts.join(' ');
}

describe('J1 architect charter parity with the live Julius architect', () => {
  it('the live charter text (read-only extraction) has the pinned sha256', () => {
    const live = extractLiveCharter();
    expect(live.length).toBe(1230);
    expect(sha256(live)).toBe(PINNED_LIVE_CHARTER_SHA256);
  });

  it('the J1 adapter default charter is byte-identical to the live charter', () => {
    expect(J1_ARCHITECT_CHARTER).toBe(extractLiveCharter());
    expect(sha256(J1_ARCHITECT_CHARTER)).toBe(PINNED_LIVE_CHARTER_SHA256);
  });

  it('drift is detected: a changed charter does not hash to the pin', () => {
    expect(sha256(`${J1_ARCHITECT_CHARTER} `)).not.toBe(PINNED_LIVE_CHARTER_SHA256);
  });
});

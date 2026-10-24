import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveJuliusSpentTag, LEGACY_RUN_ID_PATTERN, parseJuliusAdmissionRunId, WLJ_RUN_ID_PATTERN } from './julius-admission-run-id.mjs';

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const WLJ_HEX = '0123456789ab4cde8fab0123456789ab';
const LEGACY_HEX = '0123456789abcdef01234567';
const LEGACY = `run:${LEGACY_HEX}`;

describe('parseJuliusAdmissionRunId', () => {
  it('accepts a lowercase wlj_ UUIDv4', () => {
    expect(parseJuliusAdmissionRunId(WLJ)).toEqual({ ok: true, form: 'wlj', runId: WLJ });
  });

  it('accepts a legacy run: plus 24 lowercase hex', () => {
    expect(parseJuliusAdmissionRunId(LEGACY)).toEqual({ ok: true, form: 'legacy', runId: LEGACY });
  });

  it('rejects uppercase', () => {
    for (const value of [
      'wlj_01234567-89AB-4CDE-8FAB-0123456789AB',
      'WLJ_01234567-89ab-4cde-8fab-0123456789ab',
      `run:${LEGACY_HEX.toUpperCase()}`,
      `RUN:${LEGACY_HEX}`,
    ]) {
      expect(parseJuliusAdmissionRunId(value), value).toEqual({ ok: false, reason: 'admission_run_id_malformed' });
    }
  });

  it('rejects a UUIDv1 and a UUIDv7', () => {
    expect(parseJuliusAdmissionRunId('wlj_01234567-89ab-1cde-8fab-0123456789ab')).toEqual({ ok: false, reason: 'admission_run_id_malformed' });
    expect(parseJuliusAdmissionRunId('wlj_01234567-89ab-7cde-8fab-0123456789ab')).toEqual({ ok: false, reason: 'admission_run_id_malformed' });
  });

  it('rejects a malformed id and does not treat a blank as a minted id', () => {
    for (const value of [
      '',
      '   ',
      'wlj_01234567-89ab-4cde-cfab-0123456789ab',
      '01234567-89ab-4cde-8fab-0123456789ab',
      `${WLJ}\n`,
      ` ${WLJ}`,
      `${WLJ} `,
      'run:',
      `run:${LEGACY_HEX.slice(0, 23)}`,
      `${LEGACY}x`,
      'not-an-id',
    ]) {
      const parsed = parseJuliusAdmissionRunId(value);
      expect(parsed.ok, JSON.stringify(value)).toBe(false);
      if (value === '') expect(parsed).toEqual({ ok: false, reason: 'admission_run_id_required' });
      else expect(parsed).toEqual({ ok: false, reason: 'admission_run_id_malformed' });
    }
    expect(parseJuliusAdmissionRunId(undefined)).toEqual({ ok: false, reason: 'admission_run_id_required' });
  });
});

describe('deriveJuliusSpentTag', () => {
  it('derives a 32-hex tag from a wlj id and a 24-hex tag from a legacy id', () => {
    expect(deriveJuliusSpentTag(WLJ)).toEqual({
      ok: true,
      form: 'wlj',
      runId: WLJ,
      suffix: WLJ_HEX,
      tag: `refs/tags/julius-run-spent-${WLJ_HEX}`,
      concurrencyGroup: `julius-paid-${WLJ_HEX}`,
    });
    expect(WLJ_HEX).toMatch(/^[0-9a-f]{32}$/u);
    expect(deriveJuliusSpentTag(LEGACY)).toEqual({
      ok: true,
      form: 'legacy',
      runId: LEGACY,
      suffix: LEGACY_HEX,
      tag: `refs/tags/julius-run-spent-${LEGACY_HEX}`,
      concurrencyGroup: `julius-paid-${LEGACY_HEX}`,
    });
    expect(LEGACY_HEX).toMatch(/^[0-9a-f]{24}$/u);
  });

  it('a replay of the same id yields the same tag', () => {
    expect(deriveJuliusSpentTag(WLJ)).toEqual(deriveJuliusSpentTag(WLJ));
    expect(deriveJuliusSpentTag(LEGACY)).toEqual(deriveJuliusSpentTag(LEGACY));
    const again = deriveJuliusSpentTag(WLJ);
    const replay = deriveJuliusSpentTag(WLJ);
    expect(again.ok && replay.ok && again.tag === replay.tag).toBe(true);
  });

  it('does not mint an id', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'julius-admission-run-id.mjs'), 'utf8');
    expect(source).not.toMatch(/randomUUID|randomBytes|crypto|openssl/u);
    expect(source).toContain(WLJ_RUN_ID_PATTERN);
    expect(source).toContain(LEGACY_RUN_ID_PATTERN);
  });
});

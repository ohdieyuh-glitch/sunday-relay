import { describe, expect, it } from 'vitest';

import {
  createIntlTimezonePort, resolvedZoneCacheSize, resolvedZoneName, zoneNamesAPlace, zonePlaceVerdict,
} from './timezone-port';

/**
 * THE INTL ADAPTER, against real zone data.
 *
 * These tests pin the adapter to the two DST facts of 2026 in
 * America/Los_Angeles — spring-forward on Sunday March 8 (02:00 → 03:00),
 * fall-back on Sunday November 1 (02:00 → 01:00) — because an adapter that
 * always answers ONE instant has silently picked a side of exactly the
 * ambiguity the occurrence identity exists to pin down.
 */

const port = createIntlTimezonePort();
const LA = 'America/Los_Angeles';

describe('utcInstantsForLocal', () => {
  it('answers ONE instant for an ordinary minute', () => {
    expect(port.utcInstantsForLocal(
      { year: 2026, month: 8, dayOfMonth: 6, hour: 12, minute: 0 }, LA,
    )).toEqual(['2026-08-06T19:00:00.000Z']);
  });

  it('answers ZERO instants inside the spring-forward gap', () => {
    expect(port.utcInstantsForLocal(
      { year: 2026, month: 3, dayOfMonth: 8, hour: 2, minute: 30 }, LA,
    )).toEqual([]);
  });

  it('answers TWO ascending instants in the fall-back hour', () => {
    expect(port.utcInstantsForLocal(
      { year: 2026, month: 11, dayOfMonth: 1, hour: 1, minute: 30 }, LA,
    )).toEqual(['2026-11-01T08:30:00.000Z', '2026-11-01T09:30:00.000Z']);
  });

  it('answers null — not a throw — for a zone it cannot answer for', () => {
    expect(port.utcInstantsForLocal(
      { year: 2026, month: 8, dayOfMonth: 6, hour: 12, minute: 0 }, 'Not/AZone',
    )).toBeNull();
  });

  it('UTC is a zone like any other, with exactly one instant always', () => {
    expect(port.utcInstantsForLocal(
      { year: 2026, month: 11, dayOfMonth: 1, hour: 1, minute: 30 }, 'UTC',
    )).toEqual(['2026-11-01T01:30:00.000Z']);
  });
});

describe('localMinuteOf', () => {
  it('reads a UTC instant back into the zone’s wall clock', () => {
    expect(port.localMinuteOf('2026-08-06T19:00:00.000Z', LA))
      .toEqual({ year: 2026, month: 8, dayOfMonth: 6, hour: 12, minute: 0 });
  });

  it('distinguishes the two passes of the fall-back hour', () => {
    expect(port.localMinuteOf('2026-11-01T08:30:00.000Z', LA))
      .toEqual({ year: 2026, month: 11, dayOfMonth: 1, hour: 1, minute: 30 });
    expect(port.localMinuteOf('2026-11-01T09:30:00.000Z', LA))
      .toEqual({ year: 2026, month: 11, dayOfMonth: 1, hour: 1, minute: 30 });
  });

  it('answers null for garbage instants and unknown zones', () => {
    expect(port.localMinuteOf('not-an-instant', LA)).toBeNull();
    expect(port.localMinuteOf('2026-08-06T19:00:00.000Z', 'Not/AZone')).toBeNull();
  });

  it('truncates seconds — cron is minute-resolution', () => {
    expect(port.localMinuteOf('2026-08-06T19:00:59.999Z', LA))
      .toEqual({ year: 2026, month: 8, dayOfMonth: 6, hour: 12, minute: 0 });
  });
});

/**
 * THE PLACE CHECK, at its own layer.
 *
 * This lived only in a bridge test, which meant the property the whole
 * fixed-offset refusal rests on — that ICU folds case and aliases on lookup,
 * and omits fixed-offset pseudo-zones from its list of real locations — was
 * asserted nowhere in the domain that owns it.
 */
describe('a zone that names a place, versus a fixed offset wearing a zone name', () => {
  it('resolves case variants and aliases to the same zone', () => {
    expect(resolvedZoneName('etc/gmt+5')).toBe('Etc/GMT+5');
    expect(resolvedZoneName('ETC/GMT+5')).toBe('Etc/GMT+5');
    expect(resolvedZoneName('Japan')).toBe('Asia/Tokyo');
    expect(resolvedZoneName('Not/AZone')).toBeNull();
  });

  it('does NOT promise the IANA canonical name', () => {
    // ICU answers with the CLDR id, which for these is the LEGACY name — the
    // opposite of the IANA canonical one. Pinned so nobody later trusts this
    // to normalize a zone for storage or equality.
    expect(resolvedZoneName('Asia/Kolkata')).toBe('Asia/Calcutta');
    expect(resolvedZoneName('Europe/Kyiv')).toBe('Europe/Kiev');
  });

  it('refuses both refused families, whatever the spelling', () => {
    for (const zone of [
      'Etc/GMT+5', 'etc/gmt+5', 'ETC/GMT+5', 'Etc/GMT-14',
      // All THIRTEEN SystemV zones ICU resolves, not the seven an earlier
      // comment claimed — including the six that DO observe daylight saving.
      'SystemV/AST4', 'SystemV/AST4ADT', 'SystemV/CST6', 'SystemV/CST6CDT',
      'SystemV/EST5', 'SystemV/EST5EDT', 'SystemV/HST10', 'SystemV/MST7',
      'SystemV/MST7MDT', 'SystemV/PST8', 'SystemV/PST8PDT', 'SystemV/YST9',
      'SystemV/YST9YDT', 'systemv/mst7',
    ]) {
      expect(zoneNamesAPlace(zone), zone).toBe('not_a_place');
    }
  });

  it('records that all six DST-observing SystemV zones really do observe it', () => {
    // The reason they are refused is that their rules are FROZEN at the
    // pre-1987 US ruleset, not that they are fixed offsets — a refusal that
    // called them fixed offsets was simply false, and this pins the fact that
    // made it false.
    const offsetIn = (zone: string, month: number): string => {
      const at = new Date(Date.UTC(2026, month, 15, 12));
      return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? '';
    };
    for (const zone of [
      'SystemV/AST4ADT', 'SystemV/CST6CDT', 'SystemV/EST5EDT',
      'SystemV/MST7MDT', 'SystemV/PST8PDT', 'SystemV/YST9YDT',
    ]) {
      expect(offsetIn(zone, 0), zone).not.toBe(offsetIn(zone, 6));
      expect(zoneNamesAPlace(zone), zone).toBe('not_a_place');
    }
    // …while the other seven, and every Etc/GMT±N, really are fixed.
    for (const zone of [
      'SystemV/AST4', 'SystemV/CST6', 'SystemV/EST5', 'SystemV/HST10',
      'SystemV/MST7', 'SystemV/PST8', 'SystemV/YST9', 'Etc/GMT+5',
    ]) {
      expect(offsetIn(zone, 0), zone).toBe(offsetIn(zone, 6));
    }
  });

  it('accepts real places, including ones with no daylight saving at all', () => {
    // The tempting rule — "refuse any zone whose offset never changes" —
    // would refuse every one of these. A place without DST is still a place.
    for (const zone of [
      'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Honolulu', 'Asia/Kathmandu',
      'Australia/Lord_Howe', 'Asia/Kolkata', 'Japan', 'US/Pacific', 'UTC',
    ]) {
      expect(zoneNamesAPlace(zone), zone).toBe('place');
    }
  });

  it('refuses a zone nothing can resolve', () => {
    expect(zoneNamesAPlace('America/Atlantis')).toBe('not_a_place');
    expect(zoneNamesAPlace('')).toBe('not_a_place');
  });
});

describe('the verdict when the list of real locations cannot be read', () => {
  it('says it cannot verify, rather than calling a real place a fixed offset', () => {
    // A host without a readable `Intl.supportedValuesOf` must not tell an
    // operator that America/Los_Angeles is a fixed offset. Callers still
    // refuse — unverifiable is not schedulable — but for the true reason.
    expect(zonePlaceVerdict('America/Los_Angeles', null)).toBe('cannot_verify');
    // UTC is decided before the list is consulted, so it survives the outage.
    expect(zonePlaceVerdict('UTC', null)).toBe('place');
    // And a string that resolves to nothing needs no list to be refused.
    expect(zonePlaceVerdict(null, null)).toBe('not_a_place');
  });

  it('uses the list when it has one', () => {
    const known = new Set(['America/Los_Angeles']);
    expect(zonePlaceVerdict('America/Los_Angeles', known)).toBe('place');
    expect(zonePlaceVerdict('Etc/GMT+5', known)).toBe('not_a_place');
  });

  it('does not memoize strings that name no zone', () => {
    // Caching failures let any caller grow the map without bound with junk;
    // the successes are bounded by the zone database.
    const before = resolvedZoneCacheSize();
    for (let i = 0; i < 50; i += 1) expect(resolvedZoneName(`No/Such_${i}`)).toBeNull();
    expect(resolvedZoneCacheSize()).toBe(before);
    // A zone no other test in this file touches, so the growth is this call's.
    expect(resolvedZoneName('Africa/Nairobi')).toBe('Africa/Nairobi');
    expect(resolvedZoneCacheSize()).toBe(before + 1);
  });
});

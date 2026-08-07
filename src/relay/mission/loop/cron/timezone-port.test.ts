import { describe, expect, it } from 'vitest';

import { createIntlTimezonePort, resolvedZoneName, zoneNamesAPlace } from './timezone-port';

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

  it('refuses every fixed-offset family, whatever the spelling', () => {
    for (const zone of [
      'Etc/GMT+5', 'etc/gmt+5', 'ETC/GMT+5', 'Etc/GMT-14',
      'SystemV/EST5', 'SystemV/PST8', 'systemv/mst7',
    ]) {
      expect(zoneNamesAPlace(zone), zone).toBe(false);
    }
  });

  it('accepts real places, including ones with no daylight saving at all', () => {
    // The tempting rule — "refuse any zone whose offset never changes" —
    // would refuse every one of these. A place without DST is still a place.
    for (const zone of [
      'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Honolulu', 'Asia/Kathmandu',
      'Australia/Lord_Howe', 'Asia/Kolkata', 'Japan', 'US/Pacific', 'UTC',
    ]) {
      expect(zoneNamesAPlace(zone), zone).toBe(true);
    }
  });

  it('refuses a zone nothing can resolve', () => {
    expect(zoneNamesAPlace('America/Atlantis')).toBe(false);
    expect(zoneNamesAPlace('')).toBe(false);
  });
});

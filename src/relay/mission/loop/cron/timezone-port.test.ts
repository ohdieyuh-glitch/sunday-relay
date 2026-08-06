import { describe, expect, it } from 'vitest';

import { createIntlTimezonePort } from './timezone-port';

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

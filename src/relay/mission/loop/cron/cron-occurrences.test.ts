import { describe, expect, it } from 'vitest';

import { parseCronExpression, type CronSchedule } from './cron-expression';
import {
  dueCronOccurrences, MAX_CRON_WINDOW_MINUTES,
  type CronEvaluationInput,
} from './cron-occurrences';
import { createIntlTimezonePort, type CronLocalMinute, type TimezonePort } from './timezone-port';

/**
 * THE SCHEDULE EVALUATOR.
 *
 * Determinism is the product here: same schedule, same window, same answer,
 * on any host — so most tests run against a FAKE zone whose DST behaviour is
 * scripted, and one integration test pins the composition to the real Intl
 * adapter. The defect classes: an occurrence at the window edge counted on
 * the wrong side, a fall-back minute run twice, a spring-forward stampede, a
 * silent cap, and an identity that fails to change when the contract does.
 */

const schedule = (expression: string): CronSchedule => {
  const result = parseCronExpression(expression);
  if (!result.ok) throw new Error(result.problem);
  return result.schedule;
};

const literal = (m: CronLocalMinute): string =>
  `${String(m.year).padStart(4, '0')}-${String(m.month).padStart(2, '0')}-${String(m.dayOfMonth).padStart(2, '0')}`
  + `T${String(m.hour).padStart(2, '0')}:${String(m.minute).padStart(2, '0')}`;

/**
 * A fixed-offset zone (UTC-7) with scripted DST anomalies: local minutes in
 * `gaps` do not exist; local minutes in `repeats` occur at BOTH listed
 * instants. Everything else resolves at exactly one instant.
 */
function fakeZone(options: {
  gaps?: readonly string[];
  repeats?: Readonly<Record<string, readonly [string, string]>>;
} = {}): TimezonePort {
  const OFFSET_MS = -7 * 3_600_000;
  return {
    utcInstantsForLocal(local, timeZone) {
      if (timeZone !== 'Fake/Zone') return null;
      const lit = literal(local);
      if (options.gaps?.includes(lit)) return [];
      const repeat = options.repeats?.[lit];
      if (repeat !== undefined) return repeat;
      const ms = Date.UTC(local.year, local.month - 1, local.dayOfMonth, local.hour, local.minute)
        - OFFSET_MS;
      return [new Date(ms).toISOString()];
    },
    localMinuteOf(utcInstant, timeZone) {
      if (timeZone !== 'Fake/Zone') return null;
      const ms = Date.parse(utcInstant);
      if (Number.isNaN(ms)) return null;
      const d = new Date(ms + OFFSET_MS);
      return {
        year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, dayOfMonth: d.getUTCDate(),
        hour: d.getUTCHours(), minute: d.getUTCMinutes(),
      };
    },
  };
}

const digestCalls: string[] = [];
const digest = (value: string): string => {
  digestCalls.push(value);
  // Distinct inputs must yield distinct ids; a stable readable stand-in.
  return value.replace(/[^a-zA-Z0-9]/g, '').padEnd(32, '0');
};

const input = (over: Partial<CronEvaluationInput> = {}): CronEvaluationInput => ({
  schedule: schedule('0 * * * *'),
  timeZone: 'Fake/Zone',
  scheduleId: 'sched_1',
  contractVersion: 3,
  afterExclusive: '2026-08-06T00:00:00.000Z',
  untilInclusive: '2026-08-06T03:00:00.000Z',
  maxOccurrences: 100,
  digest,
  ...over,
});

describe('which occurrences a window owes', () => {
  it('finds every hourly occurrence, ascending, with distinct occ_ identities', () => {
    const result = dueCronOccurrences(fakeZone(), input());
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences.map((o) => o.resolvedUtcInstant)).toEqual([
      '2026-08-06T01:00:00.000Z',
      '2026-08-06T02:00:00.000Z',
      '2026-08-06T03:00:00.000Z',
    ]);
    // The wall clock is the zone's: 01:00Z is 18:00 local the previous day.
    expect(result.occurrences[0]?.intendedLocalMinute).toBe('2026-08-05T18:00');
    expect(result.truncated).toBe(false);
    expect(new Set(result.occurrences.map((o) => o.occurrenceId)).size).toBe(3);
    for (const o of result.occurrences) expect(o.occurrenceId).toMatch(/^occ_/);
  });

  it('the window is strictly-after / at-or-before, at the edges', () => {
    // An occurrence resolving exactly AT afterExclusive belongs to the
    // PREVIOUS window; one exactly at untilInclusive belongs to this one.
    // Mutation check: either comparison flipped fails this.
    const result = dueCronOccurrences(fakeZone(), input({
      afterExclusive: '2026-08-06T01:00:00.000Z',
      untilInclusive: '2026-08-06T03:00:00.000Z',
    }));
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences.map((o) => o.resolvedUtcInstant)).toEqual([
      '2026-08-06T02:00:00.000Z',
      '2026-08-06T03:00:00.000Z',
    ]);
  });

  it('is deterministic, and the identity carries the approved formula', () => {
    digestCalls.length = 0;
    const first = dueCronOccurrences(fakeZone(), input());
    const second = dueCronOccurrences(fakeZone(), input());
    expect(second).toEqual(first);
    expect(digestCalls).toContain(
      'sched_1|3|2026-08-05T18:00|2026-08-06T01:00:00.000Z',
    );
  });

  it('an edited contract gets NEW identities — versions never collide', () => {
    const v3 = dueCronOccurrences(fakeZone(), input());
    const v4 = dueCronOccurrences(fakeZone(), input({ contractVersion: 4 }));
    if (!v3.ok || !v4.ok) throw new Error('expected ok');
    expect(v3.occurrences[0]?.occurrenceId)
      .not.toBe(v4.occurrences[0]?.occurrenceId);
  });
});

describe('the two DST rules', () => {
  it('fall-back runs ONCE, at the first pass, and says the time repeated', () => {
    // Local 01:30 occurs at 08:30Z and 09:30Z. Mutation check: resolving to
    // the last instant instead of the first fails this.
    const port = fakeZone({
      repeats: { '2026-11-01T01:30': ['2026-11-01T08:30:00.000Z', '2026-11-01T09:30:00.000Z'] },
    });
    const result = dueCronOccurrences(port, input({
      schedule: schedule('30 1 * * *'),
      afterExclusive: '2026-11-01T00:00:00.000Z',
      untilInclusive: '2026-11-01T23:59:00.000Z',
    }));
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      resolvedUtcInstant: '2026-11-01T08:30:00.000Z',
      repeatedLocalTime: true,
      dstShifted: false,
    });
  });

  it('spring-forward shifts a nonexistent minute to the next real one, and says so', () => {
    const port = fakeZone({ gaps: ['2026-03-08T02:30'] });
    const result = dueCronOccurrences(port, input({
      schedule: schedule('30 2 * * *'),
      afterExclusive: '2026-03-08T00:00:00.000Z',
      untilInclusive: '2026-03-08T23:59:00.000Z',
    }));
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      intendedLocalMinute: '2026-03-08T02:30',
      // The next existing local minute, 02:31, at the fake zone's offset.
      resolvedUtcInstant: '2026-03-08T09:31:00.000Z',
      dstShifted: true,
    });
  });

  it('a gap FULL of matching minutes collapses to one shifted occurrence, not a stampede', () => {
    // Every minute of the 02:00 hour is scheduled and none of 02:00-02:59
    // exists. Mutation check: removing the shifted-resolution dedupe turns
    // this into sixty occurrences at 03:00.
    const gaps = Array.from({ length: 60 }, (_, i) =>
      `2026-03-08T02:${String(i).padStart(2, '0')}`);
    const result = dueCronOccurrences(fakeZone({ gaps }), input({
      schedule: schedule('* 2 * * *'),
      afterExclusive: '2026-03-08T00:00:00.000Z',
      untilInclusive: '2026-03-08T23:59:00.000Z',
    }));
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      intendedLocalMinute: '2026-03-08T02:00',
      resolvedUtcInstant: '2026-03-08T10:00:00.000Z',
      dstShifted: true,
    });
  });
});

describe('what is refused, by name', () => {
  it('window bounds without an explicit offset — the scheduler’s own rule', () => {
    const result = dueCronOccurrences(fakeZone(), input({
      afterExclusive: '2026-08-06T00:00:00',
    }));
    expect(result).toMatchObject({ ok: false, refusal: 'invalid_window' });
  });

  it('a window running backwards', () => {
    const result = dueCronOccurrences(fakeZone(), input({
      afterExclusive: '2026-08-06T03:00:00.000Z',
      untilInclusive: '2026-08-06T00:00:00.000Z',
    }));
    expect(result).toMatchObject({ ok: false, refusal: 'invalid_window' });
  });

  it('a window past the evaluation bound — catch-up is a policy, not a bigger scan', () => {
    const result = dueCronOccurrences(fakeZone(), input({
      untilInclusive: new Date(
        Date.parse('2026-08-06T00:00:00.000Z') + (MAX_CRON_WINDOW_MINUTES + 1) * 60_000,
      ).toISOString(),
    }));
    expect(result).toMatchObject({ ok: false, refusal: 'window_too_large' });
  });

  it('a limit that is not a bound', () => {
    for (const maxOccurrences of [0, -1, 2.5, Number.NaN]) {
      const result = dueCronOccurrences(fakeZone(), input({ maxOccurrences }));
      expect(result).toMatchObject({ ok: false, refusal: 'invalid_limit' });
    }
  });

  it('a zone the port cannot answer for', () => {
    const result = dueCronOccurrences(fakeZone(), input({ timeZone: 'Other/Zone' }));
    expect(result).toMatchObject({ ok: false, refusal: 'unknown_timezone' });
  });

  it('truncation is SAID, never silent', () => {
    const result = dueCronOccurrences(fakeZone(), input({ maxOccurrences: 2 }));
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('an empty window owes nothing, truthfully', () => {
    const at = '2026-08-06T00:00:00.000Z';
    const result = dueCronOccurrences(fakeZone(), input({
      afterExclusive: at, untilInclusive: at,
    }));
    expect(result).toEqual({ ok: true, occurrences: [], truncated: false });
  });
});

describe('composed with the real Intl adapter', () => {
  it('a window opening INSIDE the fall-back repeat does not re-run the first pass', () => {
    // 01:30 Los Angeles occurs at 08:30Z and 09:30Z on 2026-11-01. A window
    // opening at 09:00Z — between the passes — iterates local minutes from
    // 01:00 PST and meets 01:30 again; its resolution is the FIRST pass,
    // 08:30Z, which the PREVIOUS window already owed. Mutation check: this is
    // the test the `resolvedMs <= afterMs` guard exists for — weakening it to
    // `<` emits an occurrence BEFORE the window it was asked about, re-running
    // paid work the last window handled.
    const result = dueCronOccurrences(createIntlTimezonePort(), input({
      schedule: schedule('30 1 * * *'),
      timeZone: 'America/Los_Angeles',
      afterExclusive: '2026-11-01T09:00:00.000Z',
      untilInclusive: '2026-11-01T23:59:00.000Z',
    }));
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences).toEqual([]);
  });

  it('a daily 08:00 Los Angeles schedule crosses spring-forward truthfully', () => {
    // 08:00 exists on both days; what changes is the OFFSET — 16:00Z under
    // PST, 15:00Z under PDT. A UTC-fixed evaluator books the second morning
    // an hour late; the identity formula records the shift's resolution.
    const result = dueCronOccurrences(createIntlTimezonePort(), input({
      schedule: schedule('0 8 * * *'),
      timeZone: 'America/Los_Angeles',
      afterExclusive: '2026-03-07T00:00:00.000Z',
      untilInclusive: '2026-03-10T00:00:00.000Z',
    }));
    if (!result.ok) throw new Error(result.problem);
    expect(result.occurrences.map((o) => o.resolvedUtcInstant)).toEqual([
      '2026-03-07T16:00:00.000Z',
      '2026-03-08T15:00:00.000Z',
      '2026-03-09T15:00:00.000Z',
    ]);
    expect(result.occurrences.every((o) => !o.dstShifted)).toBe(true);
  });
});

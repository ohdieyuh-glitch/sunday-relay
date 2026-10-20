import { describe, expect, it } from 'vitest';

import { cronMatches, parseCronExpression, type CronSchedule } from './cron-expression';

/**
 * CRON EXPRESSION SEMANTICS.
 *
 * The parser upstream checks only SHAPE; meaning is decided here, once. What
 * is tested is that every accepted expression expands to exactly the values
 * it names, that every refusal names the field and the token, and that the
 * DOM/DOW OR-rule matches sixty years of cron rather than intuition.
 */

const parsed = (expression: string): CronSchedule => {
  const result = parseCronExpression(expression);
  if (!result.ok) throw new Error(result.problem);
  return result.schedule;
};

describe('what an expression means', () => {
  it('expands steps, ranges, lists and stars to exact value sets', () => {
    const s = parsed('*/15 9-17 1,15 * *');
    expect([...s.minute.values].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    expect([...s.hour.values].sort((a, b) => a - b))
      .toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...s.dayOfMonth.values].sort((a, b) => a - b)).toEqual([1, 15]);
    expect(s.month.restricted).toBe(false);
    expect(s.month.values.size).toBe(12);
  });

  it('accepts month and weekday NAMES, case-insensitively', () => {
    const s = parsed('0 8 * jan-mar Mon-Fri');
    expect([...s.month.values].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect([...s.dayOfWeek.values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('folds cron’s second Sunday (7) onto the first (0)', () => {
    const s = parsed('0 0 * * 7');
    expect([...s.dayOfWeek.values]).toEqual([0]);
    expect(s.dayOfWeek.restricted).toBe(true);
  });

  it('treats */1 as unrestricted — every value, and the OR-rule knows it', () => {
    const s = parsed('* * * * */1');
    expect(s.dayOfWeek.restricted).toBe(false);
    expect(s.dayOfWeek.values.size).toBe(7);
  });

  it('keeps the verbatim expression for display', () => {
    expect(parsed('  0 8 * * *  ').expression).toBe('0 8 * * *');
  });
});

describe('what is refused, by field and token', () => {
  const refusals: readonly [string, string][] = [
    ['0 8 * *', 'received 4'],
    ['60 * * * *', '"60" is not a minute value'],
    ['* 24 * * *', '"24" is not a hour value'],
    ['* * 0 * *', '"0" is not a day-of-month value'],
    ['*/0 * * * *', 'step "0"'],
    ['30-10 * * * *', 'runs backwards'],
    ['5/10 * * * *', 'applies a step to a single value'],
    ['1,,2 * * * *', 'empty list entry'],
    ['* * * XXX *', '"XXX" is not a month value'],
    ['1/2/3 * * * *', 'more than one "/"'],
    ['1-2-3 * * * *', 'more than one "-"'],
  ];
  for (const [expression, fragment] of refusals) {
    it(`refuses "${expression}" naming the cause`, () => {
      const result = parseCronExpression(expression);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).toContain(fragment);
    });
  }
});

describe('the DOM/DOW OR-rule', () => {
  // Friday the 13th schedules are the canonical probe: with BOTH day fields
  // restricted, either admits the day. Mutation check: switching the rule to
  // AND fails the first two cases below at once.
  const fridayThe13th = parsed('0 0 13 * FRI');

  it('matches a 13th that is not a Friday', () => {
    // 2026-05-13 is a Wednesday.
    expect(cronMatches(fridayThe13th, {
      minute: 0, hour: 0, dayOfMonth: 13, month: 5, dayOfWeek: 3,
    })).toBe(true);
  });

  it('matches a Friday that is not the 13th', () => {
    expect(cronMatches(fridayThe13th, {
      minute: 0, hour: 0, dayOfMonth: 15, month: 5, dayOfWeek: 5,
    })).toBe(true);
  });

  it('does not match a day that is neither', () => {
    expect(cronMatches(fridayThe13th, {
      minute: 0, hour: 0, dayOfMonth: 14, month: 5, dayOfWeek: 4,
    })).toBe(false);
  });

  it('with only day-of-week restricted, it alone decides', () => {
    const monday = parsed('0 0 * * MON');
    expect(cronMatches(monday, { minute: 0, hour: 0, dayOfMonth: 13, month: 5, dayOfWeek: 1 }))
      .toBe(true);
    expect(cronMatches(monday, { minute: 0, hour: 0, dayOfMonth: 13, month: 5, dayOfWeek: 2 }))
      .toBe(false);
  });

  it('minute, hour and month all gate independently', () => {
    const s = parsed('30 8 * 6 *');
    const at = { minute: 30, hour: 8, dayOfMonth: 10, month: 6, dayOfWeek: 2 };
    expect(cronMatches(s, at)).toBe(true);
    expect(cronMatches(s, { ...at, minute: 31 })).toBe(false);
    expect(cronMatches(s, { ...at, hour: 9 })).toBe(false);
    expect(cronMatches(s, { ...at, month: 7 })).toBe(false);
  });
});

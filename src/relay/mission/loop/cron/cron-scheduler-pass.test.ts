import { describe, expect, it } from 'vitest';

import { planSchedulerPass, type SchedulerCandidate } from './cron-scheduler-pass';
import { MAX_CRON_WINDOW_MINUTES } from './cron-occurrences';

/**
 * WHAT ONE AUTOMATIC PASS COVERS.
 *
 * The claims that matter are the bounds: a pass cannot reach further back than
 * the evaluator will look, cannot walk an unbounded number of schedules, and
 * cannot silently omit a schedule it declined to tick.
 */

const NOW = '2026-08-06T12:00:00.000Z';
const active = (id: string): SchedulerCandidate => ({ scheduleId: id, state: 'active' });
const ok = (result: ReturnType<typeof planSchedulerPass>) => {
  if (!result.ok) throw new Error(`expected a pass, got ${result.refusal}`);
  return result.pass;
};

describe('an automatic pass is bounded in both directions', () => {
  it('reaches back exactly the lookback, and ends at the server clock', () => {
    const pass = ok(planSchedulerPass({
      candidates: [active('a')], now: NOW, lookbackMinutes: 30, maxPerPass: 10,
    }));
    expect(pass.ticks).toEqual([{
      scheduleId: 'a',
      afterExclusive: '2026-08-06T11:30:00.000Z',
      untilInclusive: NOW,
    }]);
  });

  it('refuses a lookback wider than the evaluator will accept', () => {
    // Planning a window every tick would refuse reports work that never had a
    // chance to happen.
    const result = planSchedulerPass({
      candidates: [active('a')], now: NOW,
      lookbackMinutes: MAX_CRON_WINDOW_MINUTES + 1, maxPerPass: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal).toBe('lookback_exceeds_window');
    // The limit itself is allowed — the refusal is for exceeding it.
    expect(planSchedulerPass({
      candidates: [active('a')], now: NOW,
      lookbackMinutes: MAX_CRON_WINDOW_MINUTES, maxPerPass: 10,
    }).ok).toBe(true);
  });

  it('caps how many schedules one pass ticks, and NAMES the ones it left', () => {
    // The bridge answers requests on the same event loop that walks this list.
    const pass = ok(planSchedulerPass({
      candidates: [active('a'), active('b'), active('c')],
      now: NOW, lookbackMinutes: 30, maxPerPass: 2,
    }));
    expect(pass.ticks.map((t) => t.scheduleId)).toEqual(['a', 'b']);
    expect(pass.truncated).toBe(true);
    expect(pass.skipped).toEqual([{ scheduleId: 'c', reason: 'over_pass_limit' }]);
  });

  it('names every schedule it declined, rather than reporting a smaller list', () => {
    // "Nothing ran" and "nothing ran because eleven schedules are corrupt" are
    // the same count and completely different facts.
    const pass = ok(planSchedulerPass({
      candidates: [
        { scheduleId: 'p', state: 'paused' },
        { scheduleId: 'c', state: 'corrupt' },
        { scheduleId: 'm', state: 'missing' },
        active('a'),
      ],
      now: NOW, lookbackMinutes: 30, maxPerPass: 10,
    }));
    expect(pass.ticks.map((t) => t.scheduleId)).toEqual(['a']);
    expect(pass.skipped).toEqual([
      { scheduleId: 'p', reason: 'paused' },
      { scheduleId: 'c', reason: 'corrupt' },
      { scheduleId: 'm', reason: 'missing' },
    ]);
    expect(pass.truncated).toBe(false);
  });

  it('refuses a clock, a lookback or a limit it cannot use', () => {
    const base = { candidates: [active('a')], now: NOW, lookbackMinutes: 30, maxPerPass: 10 };
    expect(planSchedulerPass({ ...base, now: 'not-a-time' }).ok).toBe(false);
    for (const lookbackMinutes of [0, -5, 1.5]) {
      const result = planSchedulerPass({ ...base, lookbackMinutes });
      expect(result.ok, String(lookbackMinutes)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('unusable_lookback');
    }
    for (const maxPerPass of [0, -1]) {
      const result = planSchedulerPass({ ...base, maxPerPass });
      expect(result.ok, String(maxPerPass)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('unusable_pass_limit');
    }
  });

  it('plans nothing when there is nothing active, and says so without failing', () => {
    const pass = ok(planSchedulerPass({
      candidates: [], now: NOW, lookbackMinutes: 30, maxPerPass: 10,
    }));
    expect(pass.ticks).toEqual([]);
    expect(pass.skipped).toEqual([]);
    expect(pass.truncated).toBe(false);
  });
});

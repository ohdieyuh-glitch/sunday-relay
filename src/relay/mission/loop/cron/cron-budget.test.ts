import { describe, expect, it } from 'vitest';

import {
  authorizeScheduledSpend, SPEND_WINDOWS,
  type ScheduledSpendRequest, type SpendWindow, type WindowBudget,
} from './cron-budget';

/**
 * WHETHER A SCHEDULED RUN MAY SPEND.
 *
 * The rule under heaviest test is the one CRON_LOOPS.md states in a single
 * sentence: "Unknown cost remains Unknown; zero never substitutes." A cap
 * that authorizes on an unobserved spend is not a cap, and that is exactly
 * the substitution a plausible implementation makes.
 */

const unbounded: WindowBudget = { capMicros: null, spentMicros: null };

const windows = (
  over: Partial<Record<SpendWindow, WindowBudget>> = {},
): Record<SpendWindow, WindowBudget> => ({
  per_run: unbounded,
  per_day: unbounded,
  per_week: unbounded,
  per_billing_period: unbounded,
  ...over,
});

const request = (over: Partial<ScheduledSpendRequest> = {}): ScheduledSpendRequest => ({
  runCapMicros: '1000000',
  windows: windows(),
  reservedReviewerMicros: null,
  simultaneousRuns: 0,
  maxSimultaneousRuns: 3,
  emergencyGuardEngaged: false,
  autoPauseAtFraction: null,
  ...over,
});

const reasonsOf = (d: ReturnType<typeof authorizeScheduledSpend>): string[] =>
  d.kind === 'budget_blocked' ? d.refusals.map((r) => r.reason) : [];

describe('unknown is not zero', () => {
  it('REFUSES a bounded cap whose spend was never observed', () => {
    // Mutation check: treating a null spend as 0n authorizes here, which is
    // how an unmetered schedule passes a spend check.
    const decision = authorizeScheduledSpend(request({
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: null } }),
    }));
    expect(decision.kind).toBe('budget_blocked');
    expect(reasonsOf(decision)).toContain('unknown_spend_against_a_cap');
    if (decision.kind === 'budget_blocked') {
      expect(decision.refusals[0]?.window).toBe('per_day');
      expect(decision.refusals[0]?.detail).toContain('Unknown is not zero');
    }
  });

  it('an UNBOUNDED window with unknown spend has no ceiling to violate', () => {
    // No cap was configured, so there is nothing an unknown spend could
    // exceed. Refusing here would refuse every schedule ever.
    expect(authorizeScheduledSpend(request()).kind).toBe('authorized');
  });

  it('reports headroom as null — not zero — when every window is unbounded', () => {
    const decision = authorizeScheduledSpend(request());
    if (decision.kind !== 'authorized') throw new Error('expected authorized');
    expect(decision.headroomMicros).toBeNull();
  });

  it('a malformed cap is a configuration defect, not zero and not infinity', () => {
    for (const bad of ['abc', '-5', '1.5', ' 100']) {
      const decision = authorizeScheduledSpend(request({
        windows: windows({ per_week: { capMicros: bad, spentMicros: '0' } }),
      }));
      expect(reasonsOf(decision), bad).toEqual(['invalid_budget_configuration']);
    }
  });
});

describe('an unknown RUN cap is not zero either', () => {
  it('REFUSES a run whose own ceiling is Unknown against a bounded window', () => {
    // The rule inverted, and the sharpest defect review found: declaring the
    // run cap Unknown used to be strictly MORE permissive than declaring any
    // number. Mutation check: skipping the runCap === null branch authorizes.
    const decision = authorizeScheduledSpend(request({
      runCapMicros: null,
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '9000000' } }),
    }));
    expect(reasonsOf(decision)).toContain('unknown_run_cap_against_a_cap');
  });

  it('an unknown run cap authorizes only where every window is unbounded', () => {
    expect(authorizeScheduledSpend(request({ runCapMicros: null })).kind).toBe('authorized');
  });

  it('an unknown run cap cannot slip past the Reviewer reservation either', () => {
    const decision = authorizeScheduledSpend(request({
      runCapMicros: null,
      reservedReviewerMicros: '9000000',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '0' } }),
    }));
    expect(decision.kind).toBe('budget_blocked');
  });
});

describe('the boundaries, in both directions', () => {
  it('a run that fits EXACTLY is authorized', () => {
    // Mutation check: `runCap > remaining` weakened to `>=` refuses this.
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '2000000',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '8000000' } }),
    }));
    if (decision.kind !== 'authorized') throw new Error(JSON.stringify(decision));
    expect(decision.headroomMicros).toBe('2000000');
  });

  it('one micro too large is refused', () => {
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '2000001',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '8000000' } }),
    }));
    expect(reasonsOf(decision)).toContain('cap_exceeded');
  });

  it('spend EXACTLY at the pause threshold pauses', () => {
    // Mutation check: `>=` weakened to `>` authorizes at exactly the
    // threshold, which is the one point an operator set deliberately.
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '1',
      autoPauseAtFraction: 0.8,
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '8000000' } }),
    }));
    expect(reasonsOf(decision)).toContain('auto_pause_threshold_reached');
  });

  it('a threshold comparison does not truncate fail-open', () => {
    // 2/3 is 666666‰ against a 666667‰ threshold — under. The permille
    // version truncated both to 666 and authorized at exactly the threshold.
    const under = authorizeScheduledSpend(request({
      runCapMicros: '1', autoPauseAtFraction: 0.666667,
      windows: windows({ per_day: { capMicros: '3', spentMicros: '2' } }),
    }));
    expect(under.kind).toBe('authorized');
    const at = authorizeScheduledSpend(request({
      runCapMicros: '1', autoPauseAtFraction: 0.666666,
      windows: windows({ per_day: { capMicros: '3', spentMicros: '2' } }),
    }));
    expect(reasonsOf(at)).toContain('auto_pause_threshold_reached');
  });

  it('a pause fraction that would round away to nothing is refused as configuration', () => {
    // 0.0004 rounded to zero and then matched every spend, blocking a window
    // that had spent nothing.
    expect(reasonsOf(authorizeScheduledSpend(request({ autoPauseAtFraction: 0.0000004 }))))
      .toEqual(['invalid_budget_configuration']);
  });
});

describe('the caps themselves', () => {
  it('authorizes when the run fits inside every bounded window', () => {
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '1000000',
      windows: windows({
        per_day: { capMicros: '10000000', spentMicros: '2000000' },
        per_week: { capMicros: '50000000', spentMicros: '9000000' },
      }),
    }));
    if (decision.kind !== 'authorized') throw new Error(JSON.stringify(decision));
    // The TIGHTEST window decides the reported headroom: 8_000_000 vs
    // 41_000_000.
    expect(decision.headroomMicros).toBe('8000000');
  });

  it('blocks a window already spent to its cap', () => {
    const decision = authorizeScheduledSpend(request({
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '10000000' } }),
    }));
    expect(reasonsOf(decision)).toEqual(['cap_exceeded']);
  });

  it('blocks a run whose own cap exceeds what the window can still afford', () => {
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '5000000',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '8000000' } }),
    }));
    expect(reasonsOf(decision)).toEqual(['cap_exceeded']);
  });

  it('a zero cap says the cap is zero, not that something was already spent', () => {
    const decision = authorizeScheduledSpend(request({
      windows: windows({ per_day: { capMicros: '0', spentMicros: '0' } }),
    }));
    expect(reasonsOf(decision)).toContain('cap_exceeded');
    if (decision.kind === 'budget_blocked') {
      expect(decision.refusals[0]?.detail).toContain('cap is zero');
      expect(decision.refusals[0]?.detail).not.toContain('already spent');
    }
  });

  it('reports both refusals a SINGLE window earns at once', () => {
    // Review found each window returning at its first refusal, so an operator
    // raising the day cap would meet the pause threshold on the next tick.
    // Mutation check: `continue`ing after the cap refusal drops the pause one.
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '1000000',
      autoPauseAtFraction: 0.9,
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '9500000' } }),
    }));
    expect(reasonsOf(decision).sort())
      .toEqual(['auto_pause_threshold_reached', 'cap_exceeded']);
  });

  it('names the RESERVATION when that is what the run does not fit past', () => {
    // Review: this reported `cap_exceeded` when 5M remained and the 3M run
    // fitted with room — the cap was not exceeded, and a machine reading the
    // reason would act on a false one.
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '3000000',
      reservedReviewerMicros: '4000000',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '5000000' } }),
    }));
    expect(reasonsOf(decision)).toEqual(['reviewer_budget_would_be_consumed']);
  });

  it('a malformed config does not HIDE the guard or the ceiling', () => {
    const decision = authorizeScheduledSpend(request({
      emergencyGuardEngaged: true,
      simultaneousRuns: 4,
      maxSimultaneousRuns: 2,
      windows: windows({ per_day: { capMicros: 'nonsense', spentMicros: '0' } }),
    }));
    expect(reasonsOf(decision).sort())
      .toEqual(['emergency_guard_engaged', 'invalid_budget_configuration', 'too_many_simultaneous_runs']);
  });

  it('reports EVERY failing reason, not just the first', () => {
    // Mutation check: returning at the first refusal makes an operator fix
    // one cap only to meet the next — a budget review becoming four.
    const decision = authorizeScheduledSpend(request({
      emergencyGuardEngaged: true,
      simultaneousRuns: 5,
      maxSimultaneousRuns: 2,
      windows: windows({
        per_day: { capMicros: '10000000', spentMicros: '10000000' },
        per_week: { capMicros: '50000000', spentMicros: null },
      }),
    }));
    expect(reasonsOf(decision).sort()).toEqual([
      'cap_exceeded',
      'emergency_guard_engaged',
      'too_many_simultaneous_runs',
      'unknown_spend_against_a_cap',
    ]);
  });
});

describe('the Reviewer’s money is not headroom', () => {
  it('blocks a run that would consume the reserved reviewer budget', () => {
    // Mutation check: dropping the reservation from the comparison authorizes
    // a run that leaves its own verification unfunded.
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '1000000',
      reservedReviewerMicros: '3000000',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '7000000' } }),
    }));
    expect(reasonsOf(decision)).toContain('reviewer_budget_would_be_consumed');
  });

  it('subtracts the reservation from reported headroom when it still fits', () => {
    const decision = authorizeScheduledSpend(request({
      runCapMicros: '1000000',
      reservedReviewerMicros: '2000000',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '4000000' } }),
    }));
    if (decision.kind !== 'authorized') throw new Error(JSON.stringify(decision));
    // 10M cap − 4M spent − 2M reserved.
    expect(decision.headroomMicros).toBe('4000000');
  });
});

describe('the guard, the ceiling and the pause threshold', () => {
  it('an engaged emergency guard refuses whatever the caps say', () => {
    const decision = authorizeScheduledSpend(request({ emergencyGuardEngaged: true }));
    expect(reasonsOf(decision)).toEqual(['emergency_guard_engaged']);
  });

  it('refuses at the simultaneous-run ceiling, not past it', () => {
    expect(authorizeScheduledSpend(request({ simultaneousRuns: 2, maxSimultaneousRuns: 3 })).kind)
      .toBe('authorized');
    expect(reasonsOf(authorizeScheduledSpend(request({ simultaneousRuns: 3, maxSimultaneousRuns: 3 }))))
      .toEqual(['too_many_simultaneous_runs']);
  });

  it('pauses at the threshold rather than spending to the limit', () => {
    // 80% of the cap is spent and the threshold is 75%: the schedule pauses
    // itself while money remains, which is the point of a threshold.
    const decision = authorizeScheduledSpend(request({
      autoPauseAtFraction: 0.75,
      runCapMicros: '1',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '8000000' } }),
    }));
    expect(reasonsOf(decision)).toEqual(['auto_pause_threshold_reached']);
  });

  it('does not pause below the threshold', () => {
    const decision = authorizeScheduledSpend(request({
      autoPauseAtFraction: 0.9,
      runCapMicros: '1',
      windows: windows({ per_day: { capMicros: '10000000', spentMicros: '8000000' } }),
    }));
    expect(decision.kind).toBe('authorized');
  });

  it('refuses a pause fraction that is not a fraction', () => {
    for (const autoPauseAtFraction of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reasonsOf(authorizeScheduledSpend(request({ autoPauseAtFraction }))), String(autoPauseAtFraction))
        .toEqual(['invalid_budget_configuration']);
    }
  });
});

describe('a blocked run is never a successful one', () => {
  it('has no outcome a surface could render as progress', () => {
    const decision = authorizeScheduledSpend(request({ emergencyGuardEngaged: true }));
    expect(decision.kind).toBe('budget_blocked');
    // There is no partial authorization, no reduced run, no headroom field to
    // misread: a blocked decision carries refusals and nothing else.
    expect(Object.keys(decision).sort()).toEqual(['kind', 'refusals']);
  });

  it('every window is checked — none is skipped when an earlier one passes', () => {
    // Mutation check: breaking out of the window loop after the first bounded
    // window silently stops enforcing the rest.
    for (const window of SPEND_WINDOWS) {
      const decision = authorizeScheduledSpend(request({
        windows: windows({ [window]: { capMicros: '10000000', spentMicros: '10000000' } }),
      }));
      expect(reasonsOf(decision), window).toEqual(['cap_exceeded']);
      if (decision.kind === 'budget_blocked') {
        expect(decision.refusals[0]?.window).toBe(window);
      }
    }
  });
});

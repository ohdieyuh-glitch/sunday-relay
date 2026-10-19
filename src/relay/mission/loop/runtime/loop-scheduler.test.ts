import { describe, expect, it } from 'vitest';

import {
  planLoopPass, type SchedulableRun, type ScheduleOptions,
} from './loop-scheduler';

/**
 * MULTI-AGENT SCHEDULING.
 *
 * The defect class is STARVATION, so what is tested is not "runs get planned"
 * but the fairness argument itself: who goes first, who is left behind, and
 * whether the plan SAYS so. Every load-bearing test names the mutation that
 * fails it, because a fairness test that passes under an unfair sort is the
 * politest possible outage.
 */

const run = (
  runId: string,
  lastAdvancedAt: string | null,
  overrides: Partial<Omit<SchedulableRun, 'runId' | 'lastAdvancedAt'>> = {},
): SchedulableRun => ({
  runId,
  lastAdvancedAt,
  state: 'runnable',
  remainingIterations: 5,
  ...overrides,
});

const OPTS: ScheduleOptions = { maxRuns: 2, perRunIterations: 3 };

describe('planLoopPass — who goes first', () => {
  it('claims the least-recently-advanced run first, not the newest', () => {
    // Mutation check: flipping the comparator to `bt - at` fails this.
    const plan = planLoopPass([
      run('run_noisy', '2026-08-06T09:30:00.000Z'),
      run('run_quiet', '2026-08-01T09:00:00.000Z'),
      run('run_middle', '2026-08-03T12:00:00.000Z'),
    ], OPTS);

    expect(plan.claim.map((c) => c.runId)).toEqual(['run_quiet', 'run_middle']);
    expect(plan.excluded).toEqual([
      { runId: 'run_noisy', reason: 'capacity_reached' },
    ]);
    expect(plan.capacityReached).toBe(true);
  });

  it('sorts a never-advanced run as OLDEST — zero attention is the least attention', () => {
    // Mutation check: mapping null to POSITIVE_INFINITY (newest) fails this.
    const plan = planLoopPass([
      run('run_old', '2026-08-01T09:00:00.000Z'),
      run('run_fresh', null),
    ], { maxRuns: 1, perRunIterations: 3 });

    expect(plan.claim.map((c) => c.runId)).toEqual(['run_fresh']);
    expect(plan.excluded).toEqual([{ runId: 'run_old', reason: 'capacity_reached' }]);
  });

  it('breaks timestamp ties on runId, so two planners given one snapshot cannot argue', () => {
    const at = '2026-08-05T10:00:00.000Z';
    const plan = planLoopPass(
      [run('run_b', at), run('run_a', at), run('run_c', at)],
      { maxRuns: 3, perRunIterations: 1 },
    );
    expect(plan.claim.map((c) => c.runId)).toEqual(['run_a', 'run_b', 'run_c']);
  });

  it('ties break in CODEPOINT order — locale is a hidden input a pure planner must not have', () => {
    // '-' (0x2D) sorts before '_' (0x5F) by codepoint; ICU locale collation
    // orders them the other way. Mutation check: restoring localeCompare
    // fails this on any host, not only on an unusually-configured one.
    const at = null;
    const plan = planLoopPass(
      [run('run_b', at), run('run-b', at)],
      { maxRuns: 2, perRunIterations: 1 },
    );
    expect(plan.claim.map((c) => c.runId)).toEqual(['run-b', 'run_b']);
  });

  it('orders offset-carrying timestamps by INSTANT, not by string', () => {
    // 12:00+02:00 IS 10:00Z — equal instants tie and fall to runId, and an
    // earlier +02:00 wall-clock that is a LATER instant sorts later.
    const plan = planLoopPass([
      run('run_b', '2026-08-06T12:00:00+02:00'),
      run('run_a', '2026-08-06T10:00:00.000Z'),
      run('run_c', '2026-08-06T11:30:00+02:00'),
    ], { maxRuns: 3, perRunIterations: 1 });
    expect(plan.claim.map((c) => c.runId)).toEqual(['run_c', 'run_a', 'run_b']);
  });

  it('emits the same plan for the same snapshot regardless of input order', () => {
    const snapshot = [
      run('run_a', '2026-08-02T00:00:00.000Z'),
      run('run_b', null),
      run('run_c', '2026-08-02T00:00:00.000Z'),
      run('run_d', '2026-08-04T00:00:00.000Z', { state: 'paused' }),
    ];
    const forward = planLoopPass(snapshot, OPTS);
    const reversed = planLoopPass([...snapshot].reverse(), OPTS);
    expect(reversed.claim).toEqual(forward.claim);
    expect(reversed.capacityReached).toBe(forward.capacityReached);
    // Exclusions carry the same facts either way; order within them follows
    // input order for state exclusions, so compare as sets of facts.
    expect(new Set(reversed.excluded.map((e) => `${e.runId}:${e.reason}`)))
      .toEqual(new Set(forward.excluded.map((e) => `${e.runId}:${e.reason}`)));
  });
});

describe('planLoopPass — who is refused, by name', () => {
  it('excludes paused, terminal and recovery_required runs by their own state', () => {
    const plan = planLoopPass([
      run('run_paused', null, { state: 'paused' }),
      run('run_done', null, { state: 'terminal' }),
      run('run_hurt', null, { state: 'recovery_required' }),
      run('run_ok', null),
    ], OPTS);

    expect(plan.claim.map((c) => c.runId)).toEqual(['run_ok']);
    expect(plan.excluded).toEqual([
      { runId: 'run_paused', reason: 'paused' },
      { runId: 'run_done', reason: 'terminal' },
      { runId: 'run_hurt', reason: 'recovery_required' },
    ]);
    expect(plan.capacityReached).toBe(false);
  });

  it('excludes a run with no remaining budget instead of claiming and refusing later', () => {
    for (const remainingIterations of [0, -1]) {
      const plan = planLoopPass([run('run_broke', null, { remainingIterations })], OPTS);
      expect(plan.claim).toEqual([]);
      expect(plan.excluded).toEqual([{ runId: 'run_broke', reason: 'no_remaining_budget' }]);
    }
  });

  it('a budget that is not a budget is invalid_budget, never mistaken for exhaustion', () => {
    // "This run spent its budget" and "this run's budget is corrupt" are
    // different facts; an Infinity excluded as no_remaining_budget would be
    // the exact opposite of the truth. Mutation check: folding these back
    // into no_remaining_budget fails every case here.
    for (const remainingIterations of [2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planLoopPass([run('run_corrupt', null, { remainingIterations })], OPTS);
      expect(plan.claim).toEqual([]);
      expect(plan.excluded, String(remainingIterations))
        .toEqual([{ runId: 'run_corrupt', reason: 'invalid_budget' }]);
    }
  });

  it('refuses an unparseable timestamp BY NAME rather than guessing it into first place', () => {
    // The hole this closes: Date.parse('garbage') is NaN; NaN inside the
    // comparator breaks sort transitivity, and the "deterministic plan"
    // promise goes silently false. Mutation check: mapping NaN to
    // NEGATIVE_INFINITY instead of excluding fails this — the corrupt run
    // would be CLAIMED first.
    const plan = planLoopPass([
      run('run_corrupt', 'not-a-timestamp'),
      run('run_ok', '2026-08-05T00:00:00.000Z'),
    ], { maxRuns: 1, perRunIterations: 3 });

    expect(plan.claim.map((c) => c.runId)).toEqual(['run_ok']);
    expect(plan.excluded).toEqual([
      { runId: 'run_corrupt', reason: 'unreadable_timestamp' },
    ]);
    // The corrupt run did not count as runnable work left behind by capacity.
    expect(plan.capacityReached).toBe(false);
  });

  it('refuses timestamps Date.parse would ACCEPT when they name no explicit offset', () => {
    // An offset-less ISO string parses as HOST-LOCAL time, and 'Aug 6 2026'
    // parses with V8 locale semantics — both let two hosts order one snapshot
    // differently, which is the promise this module is named for. Mutation
    // check: relaxing the guard back to bare Date.parse claims both of these.
    for (const lastAdvancedAt of ['2026-08-06T10:00:00', 'Aug 6 2026', '0', '2026-08-06']) {
      const plan = planLoopPass(
        [run('run_local', lastAdvancedAt)],
        { maxRuns: 1, perRunIterations: 1 },
      );
      expect(plan.claim, lastAdvancedAt).toEqual([]);
      expect(plan.excluded, lastAdvancedAt)
        .toEqual([{ runId: 'run_local', reason: 'unreadable_timestamp' }]);
    }
  });
});

describe('planLoopPass — the grant and the bound', () => {
  it('grants min(perRunIterations, remainingIterations), never past the run budget', () => {
    const plan = planLoopPass([
      run('run_rich', null, { remainingIterations: 10 }),
      run('run_poor', '2026-08-05T00:00:00.000Z', { remainingIterations: 1 }),
    ], { maxRuns: 2, perRunIterations: 3 });

    expect(plan.claim).toEqual([
      { runId: 'run_rich', grantedIterations: 3 },
      { runId: 'run_poor', grantedIterations: 1 },
    ]);
  });

  it('refuses invalid options with a named reason and does not report false capacity', () => {
    // The bound rule is the repair loop's: a bound that is not a bound is
    // refused, not defaulted. Mutation check: defaulting maxRuns to 1 fails
    // this (something would be claimed).
    const snapshot = [run('run_a', null), run('run_b', null)];
    for (const options of [
      { maxRuns: 0, perRunIterations: 3 },
      { maxRuns: -1, perRunIterations: 3 },
      { maxRuns: 1.5, perRunIterations: 3 },
      { maxRuns: Number.NaN, perRunIterations: 3 },
      { maxRuns: Number.POSITIVE_INFINITY, perRunIterations: 3 },
      { maxRuns: 2, perRunIterations: 0 },
      { maxRuns: 2, perRunIterations: -3 },
    ]) {
      const plan = planLoopPass(snapshot, options);
      expect(plan.claim).toEqual([]);
      expect(plan.excluded).toEqual([
        { runId: 'run_a', reason: 'invalid_options' },
        { runId: 'run_b', reason: 'invalid_options' },
      ]);
      // "The planner refused to plan" and "the plan was too small for the
      // work" are different outages; conflating them hides the first inside
      // the second.
      expect(plan.capacityReached).toBe(false);
    }
  });

  it('reports capacityReached only when RUNNABLE work was left behind', () => {
    const noWork = planLoopPass([], OPTS);
    expect(noWork).toEqual({ claim: [], excluded: [], capacityReached: false });

    const exactFit = planLoopPass(
      [run('run_a', null), run('run_b', null)],
      { maxRuns: 2, perRunIterations: 1 },
    );
    expect(exactFit.capacityReached).toBe(false);

    const overflow = planLoopPass(
      [run('run_a', null), run('run_b', null), run('run_c', null)],
      { maxRuns: 2, perRunIterations: 1 },
    );
    expect(overflow.capacityReached).toBe(true);
    expect(overflow.excluded).toEqual([{ runId: 'run_c', reason: 'capacity_reached' }]);
  });

  it('accounts for every run: claim + excluded covers the snapshot exactly once', () => {
    // The starvation invariant one level up from the worker's counter
    // invariant. Mutation check: silently dropping any exclusion fails this.
    const snapshot = [
      run('run_a', null),
      run('run_b', '2026-08-01T00:00:00.000Z'),
      run('run_c', 'garbage'),
      run('run_d', null, { state: 'terminal' }),
      run('run_e', null, { remainingIterations: 0 }),
      run('run_f', '2026-08-02T00:00:00.000Z'),
    ];
    const plan = planLoopPass(snapshot, { maxRuns: 2, perRunIterations: 1 });
    const seen = [
      ...plan.claim.map((c) => c.runId),
      ...plan.excluded.map((e) => e.runId),
    ].sort();
    expect(seen).toEqual(snapshot.map((r) => r.runId).sort());
  });
});

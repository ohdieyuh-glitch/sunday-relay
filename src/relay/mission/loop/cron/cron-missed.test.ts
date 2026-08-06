import { describe, expect, it } from 'vitest';

import { decideMissedRuns } from './cron-missed';
import type { CronOccurrence } from './cron-occurrences';

/**
 * MISSED-RUN DECISIONS. The rule that outranks every policy is the one under
 * heaviest test: high-risk work is NEVER auto-caught-up, whatever the policy
 * says. And every occurrence lands in exactly one bucket, always.
 */

const occ = (id: string, resolvedUtcInstant: string): CronOccurrence => ({
  occurrenceId: id,
  scheduleId: 'sched_1',
  contractVersion: 1,
  intendedLocalMinute: resolvedUtcInstant.slice(0, 16),
  resolvedUtcInstant,
  dstShifted: false,
  repeatedLocalTime: false,
});

const MISSED = [
  occ('occ_a', '2026-08-06T09:00:00.000Z'),
  occ('occ_b', '2026-08-06T10:00:00.000Z'),
  occ('occ_c', '2026-08-06T11:00:00.000Z'),
];
const NOW = '2026-08-06T12:00:00.000Z';

const base = (over: Partial<Parameters<typeof decideMissedRuns>[0]> = {}) => ({
  policy: 'run_latest',
  workClass: 'read_only',
  occurrences: MISSED,
  evaluatedAt: NOW,
  ...over,
});

const covered = (decision: ReturnType<typeof decideMissedRuns>): string[] =>
  [
    ...decision.dispatch.map((o) => o.occurrenceId),
    ...decision.awaitingConfirmation.map((o) => o.occurrenceId),
    ...decision.skipped.map((s) => s.occurrenceId),
  ].sort();

describe('high-risk work outranks every policy', () => {
  it.each(['external_write', 'deployment', 'financial'])(
    '%s waits for a human under EVERY policy — never auto-caught-up',
    (workClass) => {
      // Mutation check: removing the work-class gate dispatches stale
      // high-risk work and fails all four policies here at once.
      for (const policy of ['skip_missed', 'run_latest', 'run_all_with_limit', 'require_confirmation']) {
        const decision = decideMissedRuns(base({ policy, workClass, maxCatchUpRuns: 5 }));
        expect(decision.dispatch, `${workClass}/${policy}`).toEqual([]);
        expect(decision.awaitingConfirmation.map((o) => o.occurrenceId))
          .toEqual(['occ_a', 'occ_b', 'occ_c']);
      }
    },
  );

  it('an UNKNOWN work class cannot prove it is low-risk, so it is held like high-risk', () => {
    const decision = decideMissedRuns(base({ workClass: 'chaos' }));
    expect(decision.dispatch).toEqual([]);
    expect(decision.awaitingConfirmation).toHaveLength(3);
  });
});

describe('the policies, for read-only work', () => {
  it('skip_missed records and never replays', () => {
    const decision = decideMissedRuns(base({ policy: 'skip_missed' }));
    expect(decision.dispatch).toEqual([]);
    expect(decision.skipped).toHaveLength(3);
    expect(decision.skipped[0]?.reason).toContain('never replayed');
  });

  it('run_latest dispatches the NEWEST and names the superseded', () => {
    const decision = decideMissedRuns(base());
    expect(decision.dispatch.map((o) => o.occurrenceId)).toEqual(['occ_c']);
    expect(decision.skipped.map((s) => s.occurrenceId)).toEqual(['occ_a', 'occ_b']);
    expect(decision.skipped[0]?.reason).toContain('Superseded');
  });

  it('run_all_with_limit keeps the NEWEST up to its bound — dropping fresh work to run stale work would catch up on staleness itself', () => {
    const decision = decideMissedRuns(base({ policy: 'run_all_with_limit', maxCatchUpRuns: 2 }));
    expect(decision.dispatch.map((o) => o.occurrenceId)).toEqual(['occ_b', 'occ_c']);
    expect(decision.skipped.map((s) => s.occurrenceId)).toEqual(['occ_a']);
  });

  it('run_all_with_limit without its bound is refused, not defaulted', () => {
    for (const maxCatchUpRuns of [undefined, 0, -2, 1.5]) {
      const decision = decideMissedRuns(base({ policy: 'run_all_with_limit', maxCatchUpRuns }));
      expect(decision.dispatch).toEqual([]);
      expect(decision.skipped[0]?.reason).toContain('IS its bound');
    }
  });

  it('require_confirmation holds everything for a human', () => {
    const decision = decideMissedRuns(base({ policy: 'require_confirmation' }));
    expect(decision.dispatch).toEqual([]);
    expect(decision.awaitingConfirmation).toHaveLength(3);
  });

  it('an unknown POLICY fails closed as a hold, not a silent drop and never a dispatch', () => {
    const decision = decideMissedRuns(base({ policy: 'improvise' }));
    expect(decision.dispatch).toEqual([]);
    expect(decision.awaitingConfirmation).toHaveLength(3);
  });
});

describe('age and accounting', () => {
  it('occurrences past the catch-up age are skipped by name under every policy — even run_latest', () => {
    // occ_a (09:00) and occ_b (10:00) are older than 90 minutes at 12:00.
    const decision = decideMissedRuns(base({ maxCatchUpAgeMinutes: 90 }));
    expect(decision.skipped.map((s) => s.occurrenceId).sort()).toEqual(['occ_a', 'occ_b']);
    expect(decision.skipped[0]?.reason).toContain('catch-up age');
    expect(decision.dispatch.map((o) => o.occurrenceId)).toEqual(['occ_c']);
  });

  it('a latest that is ITSELF too old dispatches nothing', () => {
    const decision = decideMissedRuns(base({
      evaluatedAt: '2026-08-07T12:00:00.000Z', maxCatchUpAgeMinutes: 60,
    }));
    expect(decision.dispatch).toEqual([]);
    expect(decision.skipped).toHaveLength(3);
  });

  it('an offset-less evaluatedAt decides NOTHING — the scheduler’s own instant rule', () => {
    const decision = decideMissedRuns(base({ evaluatedAt: '2026-08-06T12:00:00' }));
    expect(decision.dispatch).toEqual([]);
    expect(decision.skipped).toHaveLength(3);
    expect(decision.skipped[0]?.reason).toContain('explicit offset');
  });

  it('every occurrence lands in exactly ONE bucket, in every configuration', () => {
    for (const config of [
      base(),
      base({ policy: 'skip_missed' }),
      base({ policy: 'run_all_with_limit', maxCatchUpRuns: 1 }),
      base({ policy: 'require_confirmation', maxCatchUpAgeMinutes: 90 }),
      base({ workClass: 'financial', maxCatchUpAgeMinutes: 90 }),
      base({ policy: 'improvise' }),
    ]) {
      expect(covered(decideMissedRuns(config)), JSON.stringify(config.policy))
        .toEqual(['occ_a', 'occ_b', 'occ_c']);
    }
  });
});

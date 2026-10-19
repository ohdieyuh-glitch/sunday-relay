import { describe, expect, it } from 'vitest';

import { runCronTick, type CronRunCreationPort, type CronTickInput } from './cron-tick';
import { parseCronExpression } from './cron-expression';
import type { OccurrenceClaimPort } from './cron-claim';
import type { CronLocalMinute, TimezonePort } from './timezone-port';

/**
 * ONE CRON TICK. What is tested is the composition's claiming discipline —
 * dispatch claims first, an overlap skip claims, queue/replace/refused do
 * not — and that every occurrence the window owes lands in the report.
 */

const utcZone: TimezonePort = {
  utcInstantsForLocal: (local: CronLocalMinute) => [new Date(Date.UTC(
    local.year, local.month - 1, local.dayOfMonth, local.hour, local.minute,
  )).toISOString()],
  localMinuteOf: (instant: string) => {
    const d = new Date(Date.parse(instant));
    return {
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, dayOfMonth: d.getUTCDate(),
      hour: d.getUTCHours(), minute: d.getUTCMinutes(),
    };
  },
};

const schedule = (expr: string) => {
  const parsed = parseCronExpression(expr);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.schedule;
};

function harness(script: {
  markerExists?: (id: string) => boolean;
  createRun?: (id: string) => ReturnType<CronRunCreationPort['createRun']> | undefined;
} = {}) {
  const claimed: string[] = [];
  const created: string[] = [];
  const claim: OccurrenceClaimPort = {
    acquireOccurrenceLock: () => ({ acquired: true, release: () => {} }),
    claimMarkerExists: (id) => script.markerExists?.(id) ?? claimed.includes(id),
    writeClaimMarker: (o) => { claimed.push(o.occurrenceId); },
    appendTriggerClaimed: () => {},
    now: () => '2026-08-06T12:00:30.000Z',
  };
  const runs: CronRunCreationPort = {
    createRun: (o) => {
      const scripted = script.createRun?.(o.occurrenceId);
      if (scripted !== undefined) return scripted;
      created.push(o.occurrenceId);
      return { ok: true, runId: `lpr_${o.occurrenceId}`, duplicate: false };
    },
  };
  return { claim, runs, claimed, created };
}

const input = (over: {
  expr?: string; overlapPolicy?: string; overlapState?: Partial<CronTickInput['overlap']['state']>;
  missedPolicy?: string; workClass?: string; maxCatchUpRuns?: number;
  evaluatedAt?: string; maxCatchUpAgeMinutes?: number; maxOccurrences?: number;
} = {}): CronTickInput => ({
  tz: utcZone,
  evaluatedAt: over.evaluatedAt ?? '2026-08-06T12:00:30.000Z',
  evaluation: {
    schedule: schedule(over.expr ?? '0 * * * *'),
    timeZone: 'UTC',
    scheduleId: 'sched_1',
    contractVersion: 1,
    afterExclusive: '2026-08-06T09:00:00.000Z',
    untilInclusive: '2026-08-06T12:00:00.000Z',
    maxOccurrences: over.maxOccurrences ?? 50,
  },
  missed: {
    policy: over.missedPolicy ?? 'run_all_with_limit',
    workClass: over.workClass ?? 'read_only',
    maxCatchUpRuns: over.maxCatchUpRuns ?? 10,
    ...(over.maxCatchUpAgeMinutes === undefined
      ? {} : { maxCatchUpAgeMinutes: over.maxCatchUpAgeMinutes }),
  },
  overlap: {
    policy: over.overlapPolicy ?? 'parallel_with_limit',
    state: { activeRuns: 0, queuedRuns: 0, parallelLimit: 10, ...over.overlapState },
  },
  digest: (v) => v.replace(/[^a-zA-Z0-9]/g, '').padEnd(32, '0'),
});

describe('the tick composes the five pieces', () => {
  it('creates one run per due occurrence, claiming BEFORE creating', () => {
    const { claim, runs, claimed, created } = harness();
    const report = runCronTick(claim, runs, input());
    if (!report.ok) throw new Error(report.problem);
    // Three hourly occurrences: 10:00, 11:00, 12:00.
    expect(report.occurrences.map((o) => o.outcome))
      .toEqual(['run_created', 'run_created', 'run_created']);
    expect(claimed).toHaveLength(3);
    expect(created).toHaveLength(3);
    // Claim precedes creation for each occurrence.
    expect(claimed[0]).toBe(created[0]);
  });

  it('an evaluation refusal is the whole report', () => {
    const { claim, runs } = harness();
    const bad = input();
    const report = runCronTick(claim, runs, {
      ...bad,
      evaluation: { ...bad.evaluation, afterExclusive: 'not-an-instant' },
    });
    expect(report).toMatchObject({ ok: false, refusal: 'invalid_window' });
  });

  it('a run-creation failure AFTER the claim is loud and does not unclaim', () => {
    // Mutation check: reporting this as a plain failure and leaving the
    // occurrence claimable would spend twice on the retry.
    const { claim, runs, claimed } = harness({
      createRun: (id) => (id.includes('T1000') ? { ok: false, problem: 'store down' } : undefined),
    });
    const report = runCronTick(claim, runs, input());
    if (!report.ok) throw new Error(report.problem);
    const failed = report.occurrences.find((o) => o.outcome === 'claimed_but_run_not_created');
    expect(failed?.detail).toContain('store down');
    expect(claimed).toContain(failed?.occurrenceId ?? '');
  });

  it('a throwing run port is contained as claimed_but_run_not_created', () => {
    const { claim, runs } = harness({
      createRun: () => { throw new Error('bridge exploded'); },
    });
    const report = runCronTick(claim, runs, input());
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.every((o) => o.outcome === 'claimed_but_run_not_created')).toBe(true);
  });
});

describe('the claiming discipline per overlap action', () => {
  it('overlap SKIP claims — handled-without-a-run, never queue semantics in disguise', () => {
    // skip policy with a live run: every occurrence skips, and every skip
    // claims. Mutation check: not claiming lets next tick dispatch them.
    const { claim, runs, claimed, created } = harness();
    const report = runCronTick(claim, runs, input({
      overlapPolicy: 'skip', overlapState: { activeRuns: 1 },
    }));
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.every((o) => o.outcome === 'skipped_by_overlap_claimed')).toBe(true);
    expect(claimed).toHaveLength(3);
    expect(created).toHaveLength(0);
  });

  it('QUEUE does not claim — the next tick re-decides against fresh state', () => {
    const { claim, runs, claimed } = harness();
    const report = runCronTick(claim, runs, input({
      overlapPolicy: 'queue_all', overlapState: { activeRuns: 1, queueLimit: 2 },
    }));
    if (!report.ok) throw new Error(report.problem);
    // Two queue slots fill (queuedRuns evolves within the tick), third skips.
    expect(report.occurrences.map((o) => o.outcome)).toEqual([
      'queued_unclaimed', 'queued_unclaimed', 'skipped_by_capacity_unclaimed',
    ]);
    // NOTHING is claimed: a queue overflow is capacity, not handling, and
    // the queue this tick counted was never written anywhere.
    expect(claimed).toHaveLength(0);
  });

  it('overlap state EVOLVES within the tick — a limit of one admits one', () => {
    // Mutation check: deciding every occurrence against the tick's opening
    // state admits a stampede one occurrence at a time.
    const { claim, runs, created } = harness();
    const report = runCronTick(claim, runs, input({
      overlapPolicy: 'parallel_with_limit', overlapState: { parallelLimit: 1 },
    }));
    if (!report.ok) throw new Error(report.problem);
    expect(created).toHaveLength(1);
    expect(report.occurrences.map((o) => o.outcome)).toEqual([
      'run_created', 'skipped_by_capacity_unclaimed', 'skipped_by_capacity_unclaimed',
    ]);
  });

  it('an unknown overlap policy refuses every dispatch, claiming nothing', () => {
    const { claim, runs, claimed, created } = harness();
    const report = runCronTick(claim, runs, input({ overlapPolicy: 'improvise' }));
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.every((o) => o.outcome === 'overlap_refused')).toBe(true);
    expect(claimed).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});

describe('the repairs review demanded', () => {
  it('a queue overflow claims NOTHING — the queue it counted was never written', () => {
    // Review's HIGH finding, probed: two occurrences were claimed forever
    // against a queue limit that existed only in a local variable, with zero
    // runs created anywhere. Mutation check: marking capacity skips handled
    // (claiming them) fails this.
    const { claim, runs, claimed, created } = harness();
    const report = runCronTick(claim, runs, input({
      overlapPolicy: 'queue_all', overlapState: { activeRuns: 1, queueLimit: 1 },
    }));
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.map((o) => o.outcome)).toEqual([
      'queued_unclaimed', 'skipped_by_capacity_unclaimed', 'skipped_by_capacity_unclaimed',
    ]);
    expect(claimed).toEqual([]);
    expect(created).toEqual([]);
  });

  it('a DUPLICATE run counts as live — unknown liveness is not assumed finished', () => {
    // Mutation check: skipping the activeRuns increment for duplicates let a
    // parallel limit of one admit two live runs.
    const { claim, runs, created } = harness({
      createRun: (id) => (id.includes('T1000')
        ? { ok: true, runId: 'lpr_existing', duplicate: true } : undefined),
    });
    const report = runCronTick(claim, runs, input({
      overlapPolicy: 'parallel_with_limit', overlapState: { parallelLimit: 1 },
    }));
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.map((o) => o.outcome)).toEqual([
      'duplicate_run', 'skipped_by_capacity_unclaimed', 'skipped_by_capacity_unclaimed',
    ]);
    expect(created).toEqual([]);
  });

  it('the age cap is measured from the REAL clock, not the window end', () => {
    // A tick running six hours late: every occurrence is older than the cap.
    // Mutation check: substituting untilInclusive for evaluatedAt dispatches
    // two of them.
    const late = runCronTick(...(() => {
      const h = harness();
      return [h.claim, h.runs, input({
        evaluatedAt: '2026-08-06T18:00:00.000Z', maxCatchUpAgeMinutes: 60,
      })] as const;
    })());
    if (!late.ok) throw new Error(late.problem);
    expect(late.occurrences.every((o) => o.outcome === 'skipped_by_missed_policy')).toBe(true);
  });

  it('a window ending in the FUTURE is refused — an occurrence that has not happened is not due', () => {
    const { claim, runs, created } = harness();
    const report = runCronTick(claim, runs, input({ evaluatedAt: '2026-08-06T09:30:00.000Z' }));
    expect(report).toMatchObject({ ok: false, refusal: 'future_window' });
    expect(created).toEqual([]);
  });

  it('an offset-less evaluatedAt refuses the tick', () => {
    const { claim, runs } = harness();
    expect(runCronTick(claim, runs, input({ evaluatedAt: '2026-08-06T12:00:30' })))
      .toMatchObject({ ok: false, refusal: 'invalid_clock' });
  });

  it('run_latest over a TRUNCATED window is refused — the policy cannot keep its promise', () => {
    // Review's finding 5: the truncated window's last occurrence is not the
    // latest, so run_latest would run one AND leave a newer one for the next
    // tick — two runs from a policy that promised one.
    const { claim, runs, created } = harness();
    const report = runCronTick(claim, runs, input({
      missedPolicy: 'run_latest', maxOccurrences: 2,
    }));
    expect(report).toMatchObject({ ok: false, refusal: 'truncated_window_under_run_latest' });
    expect(created).toEqual([]);
  });

  it('a journal gap is a FIELD, not a phrase hidden in the detail string', () => {
    // Mutation check: review blanked the note and all 12 tests stayed green
    // — the signal was untested and only reachable by substring.
    const { claim, runs } = harness();
    claim.appendTriggerClaimed = () => { throw new Error('journal io'); };
    const report = runCronTick(claim, runs, input());
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.every((o) => o.journalRecorded === false)).toBe(true);
    // The run id stays parseable: no warning concatenated onto it.
    expect(report.occurrences[0]?.detail).toMatch(/^lpr_occ_[A-Za-z0-9]+$/);
  });

  it('a recorded journal says so, positively', () => {
    const { claim, runs } = harness();
    const report = runCronTick(claim, runs, input());
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.every((o) => o.journalRecorded === true)).toBe(true);
  });
});

describe('the missed-run and claim answers ride the report', () => {
  it('high-risk work awaits confirmation; nothing claims and nothing runs', () => {
    const { claim, runs, claimed, created } = harness();
    const report = runCronTick(claim, runs, input({ workClass: 'financial' }));
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.every((o) => o.outcome === 'awaiting_confirmation')).toBe(true);
    expect(claimed).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('run_latest skips the superseded BY NAME and runs the newest', () => {
    const { claim, runs } = harness();
    const report = runCronTick(claim, runs, input({ missedPolicy: 'run_latest' }));
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.map((o) => o.outcome)).toEqual([
      'skipped_by_missed_policy', 'skipped_by_missed_policy', 'run_created',
    ]);
  });

  it('already-claimed occurrences answer already_handled and are never re-run', () => {
    const { claim, runs, created } = harness({ markerExists: () => true });
    const report = runCronTick(claim, runs, input());
    if (!report.ok) throw new Error(report.problem);
    expect(report.occurrences.every((o) => o.outcome === 'already_handled')).toBe(true);
    expect(created).toHaveLength(0);
  });

  it('every due occurrence lands in the report exactly once, in every configuration', () => {
    for (const config of [
      input(), input({ overlapPolicy: 'skip', overlapState: { activeRuns: 1 } }),
      input({ workClass: 'deployment' }), input({ missedPolicy: 'skip_missed' }),
      input({ overlapPolicy: 'queue_one', overlapState: { activeRuns: 1 } }),
    ]) {
      const { claim, runs } = harness();
      const report = runCronTick(claim, runs, config);
      if (!report.ok) throw new Error(report.problem);
      // Exactly once: a set alone would accept a duplicated entry, which is
      // the accounting lie this invariant exists to catch.
      expect(report.occurrences).toHaveLength(3);
      expect(new Set(report.occurrences.map((o) => o.occurrenceId)).size).toBe(3);
    }
  });
});

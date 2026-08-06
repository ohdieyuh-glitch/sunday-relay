import { describe, expect, it } from 'vitest';

import {
  governingVersionFor, planScheduleEdit,
  type CronContractVersion, type ScheduleEditInput, type VersionedRun,
} from './cron-versioning';

/**
 * SCHEDULE VERSIONING. Every clause of CRON_LOOPS.md's Versioning section is
 * a refusal of the obvious implementation — editing in place — so what is
 * tested is that history survives an edit, that an in-progress run keeps the
 * version it started under, and that a future change disturbs no active run.
 */

const v = (over: Partial<CronContractVersion> = {}): CronContractVersion => ({
  version: 1,
  cronExpression: '0 9 * * 1-5',
  timeZone: 'America/Los_Angeles',
  contractRef: 'contract-ref-1',
  contractBindingDigest: 'digest-1',
  authoredBy: 'founder',
  authoredAt: '2026-08-01T10:00:00.000Z',
  ...over,
});

const proposed = (over: Partial<Omit<CronContractVersion, 'version'>> = {}) => {
  const { version: _ignored, ...rest } = v();
  return { ...rest, cronExpression: '0 7 * * 1-5', authoredAt: '2026-08-06T12:00:00.000Z', ...over };
};

const input = (over: Partial<ScheduleEditInput> = {}): ScheduleEditInput => ({
  history: [v()],
  proposed: proposed(),
  runs: [],
  ...over,
});

const planOf = (i: ScheduleEditInput) => {
  const decision = planScheduleEdit(i);
  if (!decision.ok) throw new Error(`${decision.refusal}: ${decision.problem}`);
  return decision.plan;
};

describe('an edit appends; it never rewrites', () => {
  it('keeps every previous version byte-identical and in order', () => {
    // Mutation check: replacing the head instead of appending destroys the
    // schedule that explains the runs already attributed to it.
    const history = [v({ version: 1 }), v({ version: 2, cronExpression: '0 8 * * *' })];
    const plan = planOf(input({ history }));
    expect(plan.history).toHaveLength(3);
    expect(plan.history[0]).toEqual(history[0]);
    expect(plan.history[1]).toEqual(history[1]);
    expect(plan.history.map((x) => x.version)).toEqual([1, 2, 3]);
  });

  it('derives the next version from the head rather than minting one', () => {
    const plan = planOf(input({ history: [v({ version: 1 }), v({ version: 2 })] }));
    expect(plan.nextVersion.version).toBe(3);
  });

  it('carries the author and the moment of the change through untouched', () => {
    const plan = planOf(input({
      proposed: proposed({ authoredBy: 'ops-oncall', authoredAt: '2026-08-06T12:34:56.000Z' }),
    }));
    expect(plan.nextVersion.authoredBy).toBe('ops-oncall');
    expect(plan.nextVersion.authoredAt).toBe('2026-08-06T12:34:56.000Z');
  });

  it('names WHAT changed — a version whose diff nobody can state is unreviewable', () => {
    const plan = planOf(input({
      proposed: proposed({ cronExpression: '0 7 * * 1-5', timeZone: 'Europe/Berlin' }),
    }));
    expect([...plan.changed].sort()).toEqual(['cronExpression', 'timeZone']);
  });

  it('a timezone change is an edit like any other, not a rewrite', () => {
    // CRON_LOOPS.md calls this out: rewriting historical triggers after a
    // zone change would relabel when work actually happened.
    const history = [v({ version: 1, timeZone: 'America/Los_Angeles' })];
    const plan = planOf(input({
      history,
      proposed: proposed({ cronExpression: history[0]!.cronExpression, timeZone: 'Asia/Tokyo' }),
    }));
    expect(plan.changed).toEqual(['timeZone']);
    expect(plan.history[0]?.timeZone).toBe('America/Los_Angeles');
  });
});

describe('an in-progress run keeps the version it started under', () => {
  const history = [
    v({ version: 1, cronExpression: '0 9 * * *' }),
    v({ version: 2, cronExpression: '0 8 * * *' }),
  ];

  it('resolves a run to ITS version, never to the newest', () => {
    // Mutation check: returning the head fails this — a version-1 run would
    // be explained by a schedule it never ran under.
    const run: VersionedRun = { runId: 'lpr_old', contractVersion: 1, active: true };
    expect(governingVersionFor(run, history)?.cronExpression).toBe('0 9 * * *');
  });

  it('answers null for a run citing a version the history lacks — not the head', () => {
    const run: VersionedRun = { runId: 'lpr_ghost', contractVersion: 9, active: false };
    expect(governingVersionFor(run, history)).toBeNull();
  });

  it('reports every ACTIVE run as unaffected by the edit', () => {
    // "Changing the future schedule never mutates an active run" is a promise
    // somebody must keep, and they cannot keep it from a list they were never
    // given. Mutation check: returning [] leaves a caller to infer them.
    const runs: VersionedRun[] = [
      { runId: 'lpr_a', contractVersion: 1, active: true },
      { runId: 'lpr_b', contractVersion: 2, active: false },
      { runId: 'lpr_c', contractVersion: 2, active: true },
    ];
    const plan = planOf(input({ history, runs }));
    expect(plan.runsUnaffected.map((r) => r.runId)).toEqual(['lpr_a', 'lpr_c']);
    // …and they keep the versions they started under, not the new one.
    expect(plan.runsUnaffected.map((r) => r.contractVersion)).toEqual([1, 2]);
  });
});

describe('what an edit refuses', () => {
  it('refuses a run citing a version the history does not contain', () => {
    const decision = planScheduleEdit(input({
      runs: [{ runId: 'lpr_ghost', contractVersion: 7, active: false }],
    }));
    expect(decision).toMatchObject({ ok: false, refusal: 'run_cites_unknown_version' });
  });

  it('refuses a history with gaps or repeats', () => {
    for (const history of [
      [v({ version: 1 }), v({ version: 3 })],
      [v({ version: 1 }), v({ version: 1 })],
      [v({ version: 2 })],
    ]) {
      expect(planScheduleEdit(input({ history })))
        .toMatchObject({ ok: false, refusal: 'non_contiguous_history' });
    }
  });

  it('refuses an unattributed edit', () => {
    for (const authoredBy of ['', '   ']) {
      expect(planScheduleEdit(input({ proposed: proposed({ authoredBy }) })))
        .toMatchObject({ ok: false, refusal: 'unauthored_edit' });
    }
  });

  it('refuses an authored-at without an explicit offset', () => {
    expect(planScheduleEdit(input({ proposed: proposed({ authoredAt: '2026-08-06T12:00:00' }) })))
      .toMatchObject({ ok: false, refusal: 'unreadable_authored_at' });
  });

  it('refuses a version that changes nothing', () => {
    // It would split the run history at a point where nothing changed, and a
    // later reader would look for a difference there is none of.
    const head = v({ version: 1 });
    const { version: _v, ...same } = head;
    expect(planScheduleEdit(input({ history: [head], proposed: same })))
      .toMatchObject({ ok: false, refusal: 'no_change' });
  });

  it('refuses to edit a schedule that has no versions at all', () => {
    expect(planScheduleEdit(input({ history: [] })))
      .toMatchObject({ ok: false, refusal: 'empty_history' });
  });
});

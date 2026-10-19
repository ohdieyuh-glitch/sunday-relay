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
  projectId: 'prj_cron',
  workspaceId: null,
  loopId: 'lpe_cron',
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

describe('a rebinding is an edit like any other', () => {
  it('counts a changed project, workspace or Loop as a change', () => {
    // Without this the planner answers `no_change` for a rebinding and refuses
    // to append, so a schedule could never be moved at all — and the field
    // that keys the occurrence claim would sit outside the versioning the rest
    // of the contract gets.
    for (const [field, value] of [
      ['projectId', 'prj_other'], ['loopId', 'lpe_other'], ['workspaceId', 'ws_other'],
    ] as const) {
      const decision = planScheduleEdit({
        history: [v()],
        proposed: { ...v(), [field]: value, authoredAt: '2026-08-06T12:00:00.000Z' },
        runs: [],
      });
      expect(decision.ok, field).toBe(true);
      if (decision.ok) expect(decision.plan.changed, field).toContain(field);
    }
  });

  it('keeps every earlier version, so runs made under the old binding still explain themselves', () => {
    const decision = planScheduleEdit({
      history: [v()],
      proposed: { ...v(), loopId: 'lpe_other', authoredAt: '2026-08-06T12:00:00.000Z' },
      runs: [{ runId: 'lpr_1', contractVersion: 1, active: false }],
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.plan.history).toHaveLength(2);
    expect(decision.plan.history[0]?.loopId).toBe('lpe_cron');
    const under = (contractVersion: number): string | undefined => governingVersionFor(
      { runId: 'lpr_1', contractVersion, active: false }, decision.plan.history,
    )?.loopId;
    // The run made under v1 still resolves to the Loop it was made for.
    expect(under(1)).toBe('lpe_cron');
    expect(under(2)).toBe('lpe_other');
  });
});

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

  it('answers null when the version is AMBIGUOUS rather than picking the first', () => {
    // Mutation check: `find` returned the first silently, so the two exports
    // disagreed about exactly the history planScheduleEdit refuses.
    const ambiguous = [
      v({ version: 1, contractRef: 'FIRST' }),
      v({ version: 1, contractRef: 'SECOND' }),
    ];
    const run: VersionedRun = { runId: 'lpr_x', contractVersion: 1, active: true };
    expect(governingVersionFor(run, ambiguous)).toBeNull();
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
    expect(plan.activeRuns.map((r) => r.runId)).toEqual(['lpr_a', 'lpr_c']);
    // …and they keep the versions they started under, not the new one.
    expect(plan.activeRuns.map((r) => r.contractVersion)).toEqual([1, 2]);
    // EVERY run's attribution survives, not just the active ones — the spec
    // requires the edit to preserve which runs came from which version, and a
    // plan carrying only the live ones drops completed runs' attribution for
    // any caller that persists it. Mutation check: restricting this to active
    // runs fails here.
    expect(plan.runAttribution.map((r) => [r.runId, r.contractVersion]))
      .toEqual([['lpr_a', 1], ['lpr_b', 2], ['lpr_c', 2]]);
    // Copies, not the caller's own objects handed back to be mutated.
    expect(plan.activeRuns[0]).not.toBe(runs[0]);
  });
});

describe('what an edit refuses', () => {
  it('refuses a run citing a version the history does not contain', () => {
    const decision = planScheduleEdit(input({
      runs: [{ runId: 'lpr_ghost', contractVersion: 7, active: false }],
    }));
    expect(decision).toMatchObject({ ok: false, refusal: 'run_cites_unknown_version' });
  });

  it('refuses a history with a REPEATED version — that is the real ambiguity', () => {
    expect(planScheduleEdit(input({ history: [v({ version: 1 }), v({ version: 1 })] })))
      .toMatchObject({ ok: false, refusal: 'duplicate_version_in_history' });
  });

  it('ACCEPTS a history with gaps — a run citing v4 in [1,2,4] resolves fine', () => {
    // An earlier version refused gaps on the stated grounds that they could
    // not say which version a run came from. That was false, and the spec
    // never required contiguity. Mutation check: restoring the contiguity
    // rule fails this and the next test.
    const history = [v({ version: 1 }), v({ version: 2 }), v({ version: 4 })];
    const plan = planOf(input({ history }));
    expect(plan.nextVersion.version).toBe(5);
  });

  it('derives the next version from the HIGHEST version, not the array length', () => {
    // With gaps permitted these differ, so the test can finally discriminate:
    // review found `history.length + 1` surviving because enforced contiguity
    // made the two provably equivalent.
    const plan = planOf(input({ history: [v({ version: 1 }), v({ version: 7 })] }));
    expect(plan.nextVersion.version).toBe(8);
  });

  it('a version numbered zero is a history like any other', () => {
    const plan = planOf(input({ history: [v({ version: 0 })] }));
    expect(plan.nextVersion.version).toBe(1);
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

  it('diffs against the HEAD, so reverting to an older schedule is a real change', () => {
    // Mutation check: diffing against history[0] instead of the head made a
    // legitimate revert read as no_change — and no test saw it, because none
    // used a multi-version history where the two differ.
    const history = [
      v({ version: 1, cronExpression: '0 9 * * *' }),
      v({ version: 2, cronExpression: '0 8 * * *' }),
    ];
    const plan = planOf(input({
      history,
      proposed: proposed({ cronExpression: '0 9 * * *' }),
    }));
    expect(plan.changed).toEqual(['cronExpression']);
    expect(plan.nextVersion.version).toBe(3);
  });

  it('re-authoring alone is not a schedule change, and the message says so', () => {
    const head = v({ version: 1 });
    const { version: _v, ...same } = head;
    const decision = planScheduleEdit(input({
      history: [head],
      proposed: { ...same, authoredBy: 'someone-else', authoredAt: '2026-08-06T12:00:00.000Z' },
    }));
    expect(decision).toMatchObject({ ok: false, refusal: 'no_change' });
    if (!decision.ok) {
      expect(decision.problem).toContain('no schedule or contract field');
      expect(decision.problem).not.toContain('identical to the current one');
    }
  });

  it('the proposed edit’s own defects are reported before a pre-existing orphan', () => {
    const decision = planScheduleEdit(input({
      proposed: proposed({ authoredBy: '' }),
      runs: [{ runId: 'lpr_ghost', contractVersion: 7, active: false }],
    }));
    expect(decision).toMatchObject({ ok: false, refusal: 'unauthored_edit' });
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

import { describe, expect, it } from 'vitest';

import {
  advanceJuliusGauntletRound, gauntletRoundTaskId, openNextGauntletRound, startJuliusGauntlet,
} from './julius-gauntlet-runtime';
import { cardPolicy, createJuliusHarness, seedRun, task, worker } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';
import type { JuliusTask } from './julius-runtime';

/**
 * IS /gauntletloop ACTUALLY A RUNTIME?
 *
 * #172 built the state machine and nothing persisted it, so a round could not
 * survive a restart, two schedulers could both start "round 2", and a cleared
 * gauntlet had no record of what cleared it. These tests are about the durable
 * half: that every round is a real task the ordinary scheduler claims, that
 * every bound is decided by #172's rule against stored state, and that no
 * recursion or loop exists anywhere in the path.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] });
const REVIEWER = worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', capabilities: ['review'], taskTypes: ['review:build'] });

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};

const ANCHOR: JuliusTask = task({ taskId: 'anchor', ordinal: 0 }) as JuliusTask;

const LIMITS = { maxRounds: 3, maxRetries: 2, maxDurationMs: 60_000, maxUsdMicros: 100_000 };

const build = (over: Parameters<typeof cardPolicy>[0] = {}) => {
  const harness = createJuliusHarness({
    workers: [
      { worker: CODER, script: [{ kind: 'succeed' }, { kind: 'succeed' }, { kind: 'succeed' }, { kind: 'succeed' }] },
      { worker: REVIEWER, script: [{ kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'clean' }] }] },
    ],
    card: cardPolicy({ allowedProviders: [CODER.providerId, REVIEWER.providerId], ...over }),
  });
  seedRun(harness, { tasks: [ANCHOR] });
  const policy = cardPolicy({ allowedProviders: [CODER.providerId, REVIEWER.providerId], ...over });
  const deps = { store: harness.store, clock: harness.clock };
  return { harness, policy, deps };
};

const start = (ctx: ReturnType<typeof build>, limits = LIMITS) => startJuliusGauntlet(
  { run: RUN, policy: ctx.policy, gauntletId: 'g-1', anchor: ANCHOR, limits }, ctx.deps,
);

const settle = (
  ctx: ReturnType<typeof build>,
  over: Partial<Parameters<typeof advanceJuliusGauntletRound>[0]> = {},
) => advanceJuliusGauntletRound({
  run: RUN, policy: ctx.policy, anchor: ANCHOR, gauntletId: 'g-1',
  phase: 'EXECUTE', outcome: 'PASSED', durationMs: 100, usdMicros: 1_000,
  evidenceIds: [], reviewerRequired: false, ...over,
}, ctx.deps);

/* --------------------------------------------------------------- starting */

describe('starting a gauntlet', () => {
  it('creates round 1 as an ordinary task the normal scheduler claims', async () => {
    const ctx = build();
    const started = await start(ctx);
    expect(started.started).toBe(true);
    if (!started.started) return;
    expect(started.resumed).toBe(false);
    expect(started.record.state).toBe('RUNNING');
    expect(started.record.round).toBe(1);

    const row = ctx.harness.store.taskRow(started.roundTask.taskId);
    expect(row).not.toBeNull();
    expect(row!.state).toBe('RUNNABLE');
    expect(row!.parentTaskId).toBe('anchor');

    const report = await ctx.harness.loop.tick({ projectId: 'prj-1' });
    expect(report.outcomes.map((o) => o.taskId)).toContain(started.roundTask.taskId);
  });

  it('names a round task deterministically, so two schedulers compose one id', () => {
    expect(gauntletRoundTaskId('g-1', 2, 'EXECUTE')).toBe('gauntlet:g-1:2:execute');
    expect(gauntletRoundTaskId('g-1', 2, 'EXECUTE')).toBe(gauntletRoundTaskId('g-1', 2, 'EXECUTE'));
    expect(gauntletRoundTaskId('g-1', 2, 'REVIEW')).not.toBe(gauntletRoundTaskId('g-1', 2, 'EXECUTE'));
  });

  it('RESUMES rather than forking when /gauntletloop is typed twice', async () => {
    const ctx = build();
    const first = await start(ctx);
    const second = await start(ctx);
    expect(first.started && second.started).toBe(true);
    if (!first.started || !second.started) return;
    expect(second.resumed).toBe(true);
    expect(second.record.gauntletId).toBe(first.record.gauntletId);
    expect(second.record.round).toBe(first.record.round);
  });

  it('refuses when C.A.R.D. does not allow a gauntlet', async () => {
    const ctx = build({ gauntlet: { allowed: false, maxRounds: 3 } });
    const started = await start(ctx);
    expect(started.started).toBe(false);
    if (started.started) return;
    expect(started.reasonCode).toBe('CARD_GAUNTLET_LIMIT');
  });

  it('lets the C.A.R.D. ceiling win over a larger request, without refusing the ask', async () => {
    const ctx = build({ gauntlet: { allowed: true, maxRounds: 2 } });
    const started = await start(ctx, { ...LIMITS, maxRounds: 50 });
    expect(started.started).toBe(true);
    if (!started.started) return;
    expect(started.record.limits.maxRounds).toBe(2);
  });

  it('requires an approval rather than starting when C.A.R.D. gates it', async () => {
    const ctx = build({ approvals: ['CONTINUE_GAUNTLET'], autonomy: 'SUPERVISED' });
    const started = await start(ctx);
    expect(started.started).toBe(false);
    if (started.started) return;
    expect(started.reasonCode).toBe('GAUNTLET_APPROVAL_REQUIRED');
  });
});

/* --------------------------------------------------------------- clearing */

describe('a gauntlet that clears', () => {
  it('clears on a first-round pass when no review is required', async () => {
    const ctx = build();
    await start(ctx);
    const advanced = await settle(ctx);
    expect(advanced.advanced).toBe(true);
    if (!advanced.advanced) return;
    expect(advanced.state).toBe('CLEARED');
    expect(advanced.nextTask).toBeNull();
    expect(advanced.haltReason).toBeNull();
  });

  it('does NOT clear on the implementer\'s word when a review is required', async () => {
    const ctx = build();
    await start(ctx);
    const afterExecute = await settle(ctx, { reviewerRequired: true });
    expect(afterExecute.advanced).toBe(true);
    if (!afterExecute.advanced) return;
    // Still RUNNING: the round is open and the reviewer decides.
    expect(afterExecute.state).toBe('RUNNING');
    expect(afterExecute.nextTask).not.toBeNull();
    expect(afterExecute.nextTask!.role).toBe('INDEPENDENT_REVIEWER');

    const afterReview = await settle(ctx, { phase: 'REVIEW', outcome: 'PASSED', reviewerRequired: true });
    expect(afterReview.advanced).toBe(true);
    if (!afterReview.advanced) return;
    expect(afterReview.state).toBe('CLEARED');
  });

  it('records every round durably, with its phase and outcome', async () => {
    const ctx = build();
    await start(ctx);
    await settle(ctx, { reviewerRequired: true });
    await settle(ctx, { phase: 'REVIEW', outcome: 'PASSED', reviewerRequired: true });
    const rounds = await ctx.harness.store.roundsFor('g-1');
    expect(rounds.map((r) => `${r.round}:${r.phase}`)).toEqual(['1:EXECUTE', '1:REVIEW']);
    expect(rounds.every((r) => r.completedAt !== null)).toBe(true);
    expect(rounds.map((r) => r.outcome)).toEqual(['PASSED', 'PASSED']);
  });
});

/* ---------------------------------------------------------------- repair */

describe('a gauntlet that fails and repairs', () => {
  const toRepair = async () => {
    const ctx = build();
    await start(ctx);
    const failed = await settle(ctx, { outcome: 'FAILED' });
    return { ctx, failed };
  };

  it('schedules a repair task rather than halting on the first failure', async () => {
    const { ctx, failed } = await toRepair();
    expect(failed.advanced).toBe(true);
    if (!failed.advanced) return;
    expect(failed.state).toBe('REPAIRING');
    expect(failed.nextTask).not.toBeNull();
    expect(failed.nextTask!.taskType.startsWith('repair:')).toBe(true);
    expect(ctx.harness.store.taskRow(failed.nextTask!.taskId)!.state).toBe('RUNNABLE');
  });

  it('opens the NEXT round when the repair completes, not before', async () => {
    const { ctx } = await toRepair();
    const repaired = await settle(ctx, { phase: 'REPAIR', outcome: 'PASSED' });
    expect(repaired.advanced).toBe(true);
    if (!repaired.advanced) return;
    // READY has no work of its own; a naive wiring parks here forever.
    expect(repaired.state).toBe('READY');
    expect(repaired.nextTask).toBeNull();

    const opened = await openNextGauntletRound({ run: RUN, anchor: ANCHOR, gauntletId: 'g-1' }, ctx.deps);
    expect(opened.advanced).toBe(true);
    if (!opened.advanced) return;
    expect(opened.state).toBe('RUNNING');
    expect(opened.round).toBe(2);
    expect(opened.nextTask!.taskId).toBe(gauntletRoundTaskId('g-1', 2, 'EXECUTE'));
  });

  it('clears on a later round after multiple repairs', async () => {
    const ctx = build();
    await start(ctx);
    await settle(ctx, { outcome: 'FAILED' });
    await settle(ctx, { phase: 'REPAIR', outcome: 'PASSED' });
    await openNextGauntletRound({ run: RUN, anchor: ANCHOR, gauntletId: 'g-1' }, ctx.deps);
    const cleared = await settle(ctx);
    expect(cleared.advanced).toBe(true);
    if (!cleared.advanced) return;
    expect(cleared.state).toBe('CLEARED');
    expect(cleared.round).toBe(2);
  });
});

/* ----------------------------------------------------------------- halts */

describe('a gauntlet that halts, with evidence of why', () => {
  it('halts on the retry limit rather than repairing forever', async () => {
    const ctx = build();
    await start(ctx, { ...LIMITS, maxRetries: 1, maxRounds: 9 });
    await settle(ctx, { outcome: 'FAILED' });                       // retries -> 1
    await settle(ctx, { phase: 'REPAIR', outcome: 'PASSED' });
    await openNextGauntletRound({ run: RUN, anchor: ANCHOR, gauntletId: 'g-1' }, ctx.deps);
    const halted = await settle(ctx, { outcome: 'FAILED' });         // retries already at the limit
    expect(halted.advanced).toBe(true);
    if (!halted.advanced) return;
    expect(halted.state).toBe('HALTED');
    expect(halted.haltReason).toBe('retry_limit');
  });

  it('halts on the round limit', async () => {
    const ctx = build();
    await start(ctx, { ...LIMITS, maxRounds: 1, maxRetries: 5 });
    await settle(ctx, { outcome: 'FAILED' });
    await settle(ctx, { phase: 'REPAIR', outcome: 'PASSED' });
    const opened = await openNextGauntletRound({ run: RUN, anchor: ANCHOR, gauntletId: 'g-1' }, ctx.deps);
    expect(opened.advanced).toBe(true);
    if (!opened.advanced) return;
    expect(opened.state).toBe('HALTED');
    expect(opened.haltReason).toBe('round_limit');
    expect(opened.nextTask).toBeNull();
  });

  it('halts on the spend ceiling, using the round\'s REAL total', async () => {
    const ctx = build();
    await start(ctx, { ...LIMITS, maxUsdMicros: 1_500 });
    // Execute costs 1000 and review costs 900: neither exceeds the ceiling and
    // the ROUND does. Charging only the last phase would let this continue.
    await settle(ctx, { reviewerRequired: true, usdMicros: 1_000 });
    const halted = await settle(ctx, { phase: 'REVIEW', outcome: 'PASSED', reviewerRequired: true, usdMicros: 900 });
    expect(halted.advanced).toBe(true);
    if (!halted.advanced) return;
    expect(halted.state).toBe('HALTED');
    expect(halted.haltReason).toBe('budget_limit');
  });

  it('halts on the duration ceiling', async () => {
    const ctx = build();
    await start(ctx, { ...LIMITS, maxDurationMs: 50 });
    const halted = await settle(ctx, { durationMs: 500 });
    expect(halted.advanced).toBe(true);
    if (!halted.advanced) return;
    expect(halted.state).toBe('HALTED');
    expect(halted.haltReason).toBe('duration_limit');
  });

  it('cancels on request and stays cancelled', async () => {
    const ctx = build();
    await start(ctx);
    const cancelled = await settle(ctx, { outcome: 'CANCELLED' });
    expect(cancelled.advanced).toBe(true);
    if (!cancelled.advanced) return;
    expect(cancelled.state).toBe('CANCELLED');

    const later = await settle(ctx, { phase: 'REPAIR', outcome: 'PASSED' });
    expect(later.advanced).toBe(true);
    if (!later.advanced) return;
    expect(later.state).toBe('CANCELLED');
    expect(later.nextTask).toBeNull();
  });
});

/* ------------------------------------------------------------ duplicates */

describe('duplicates and races', () => {
  it('absorbs a late settlement for a finished gauntlet instead of erroring', async () => {
    const ctx = build();
    await start(ctx);
    await settle(ctx);
    const late = await settle(ctx);
    expect(late.advanced).toBe(true);
    if (!late.advanced) return;
    expect(late.state).toBe('CLEARED');
  });

  it('records one round row however many times a phase is scheduled', async () => {
    const ctx = build();
    await start(ctx);
    const again = await ctx.harness.store.recordRound({
      gauntletId: 'g-1', round: 1, phase: 'EXECUTE', taskId: 'anything',
      outcome: null, durationMs: null, usdMicros: null, evidenceIds: [],
      startedAt: '2026-08-27T00:00:00.000Z', completedAt: null,
    });
    expect(again.duplicate).toBe(true);
    expect((await ctx.harness.store.roundsFor('g-1')).filter((r) => r.round === 1 && r.phase === 'EXECUTE')).toHaveLength(1);
  });

  it('keeps the first settlement of a phase, not the last', async () => {
    const ctx = build();
    await start(ctx);
    await settle(ctx, { outcome: 'FAILED' });
    const overwritten = await ctx.harness.store.settleRound({
      gauntletId: 'g-1', round: 1, phase: 'EXECUTE', outcome: 'PASSED',
      durationMs: 0, usdMicros: 0, evidenceIds: [], completedAt: '2026-08-27T09:00:00.000Z',
    });
    expect(overwritten).toBe(false);
    const rounds = await ctx.harness.store.roundsFor('g-1');
    expect(rounds.find((r) => r.round === 1 && r.phase === 'EXECUTE')!.outcome).toBe('FAILED');
  });

  it('refuses a save against a stale version', async () => {
    const ctx = build();
    const started = await start(ctx);
    expect(started.started).toBe(true);
    if (!started.started) return;
    const stale = await ctx.harness.store.saveGauntlet({ ...started.record, round: 99 }, started.record.version - 1);
    expect(stale).toBe(false);
    expect((await ctx.harness.store.loadGauntlet('run-1', 'g-1'))!.round).toBe(1);
  });

  it('reports the stored state when it loses the advance race', async () => {
    const ctx = build();
    const started = await start(ctx);
    expect(started.started).toBe(true);
    if (!started.started) return;
    // Someone else advances first, moving the version on.
    await ctx.harness.store.saveGauntlet({ ...started.record, version: started.record.version + 1, state: 'CLEARED' }, started.record.version);
    const lost = await settle(ctx);
    expect(lost.advanced).toBe(true);
    if (!lost.advanced) return;
    expect(lost.state).toBe('CLEARED');
  });

  it('reports honestly when there is no gauntlet', async () => {
    const ctx = build();
    const missing = await settle(ctx);
    expect(missing.advanced).toBe(false);
    if (missing.advanced) return;
    expect(missing.reasonCode).toBe('GAUNTLET_NOT_FOUND');
  });
});

/* ------------------------------------------------------------ durability */

describe('a gauntlet across a restart', () => {
  it('resumes from the stored round rather than starting over', async () => {
    const ctx = build();
    await start(ctx);
    await settle(ctx, { outcome: 'FAILED' });
    await settle(ctx, { phase: 'REPAIR', outcome: 'PASSED' });

    ctx.harness.store.restart();

    const resumed = await startJuliusGauntlet(
      { run: RUN, policy: ctx.policy, gauntletId: 'g-other', anchor: ANCHOR, limits: LIMITS }, ctx.deps,
    );
    expect(resumed.started).toBe(true);
    if (!resumed.started) return;
    expect(resumed.resumed).toBe(true);
    expect(resumed.record.gauntletId).toBe('g-1');
    expect(resumed.record.round).toBe(1);
    expect(resumed.record.retries).toBe(1);
    expect(resumed.record.state).toBe('READY');
  });
});

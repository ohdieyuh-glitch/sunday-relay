import { describe, expect, it } from 'vitest';

import {
  activateGauntlet, advanceGauntletCommand, cancelGauntlet, createGauntletMemoryStore,
  gauntletWorkId, openNextGauntletRound, runGauntletReview,
  type GauntletActivationCommand, type GauntletDependencies, type GauntletMemoryStore,
  type GauntletPolicy, type GauntletReviewPort, type GauntletWorkPort,
} from './index';

/**
 * `/gauntletloop` AS A USER COMMAND.
 *
 * The eight invariants the architecture rests on. Most of them are about what
 * does NOT happen: no mission start, no reviewer call, no verification failure
 * and no restart activates a gauntlet. Only a person does.
 */

/* ------------------------------------------------------------- the doubles */

interface RecordingWork extends GauntletWorkPort {
  readonly requested: { workId: string; kind: string }[];
  readonly cancelled: string[];
}

function recordingWork(): RecordingWork {
  const requested: { workId: string; kind: string }[] = [];
  const cancelled: string[] = [];
  return {
    requested, cancelled,
    async requestWork(input) {
      if (requested.some((entry) => entry.workId === input.workId)) {
        return { accepted: true, duplicate: true, reasonCode: null };
      }
      requested.push({ workId: input.workId, kind: input.kind });
      return { accepted: true, duplicate: false, reasonCode: null };
    },
    async workOutcome() { return null; },
    async cancelWork(workId) { cancelled.push(workId); return true; },
  };
}

interface ScriptedReviewer extends GauntletReviewPort {
  readonly calls: number[];
}

/** A reviewer that returns a scripted number of blocking findings per call. */
function scriptedReviewer(script: readonly number[]): ScriptedReviewer {
  const calls: number[] = [];
  let index = 0;
  return {
    calls,
    async review(input) {
      calls.push(input.round);
      const blocking = script[Math.min(index, script.length - 1)] ?? 0;
      index += 1;
      return {
        completed: true, blockingFindings: blocking,
        findingIds: Array.from({ length: blocking }, (_, n) => `finding-${input.round}-${n}`),
        safeSummary: blocking === 0 ? 'No blocking findings.' : `${blocking} blocking findings.`,
      };
    },
  };
}

const POLICY: GauntletPolicy = { allowed: true, maxRounds: 3, requiresApproval: false };

function harness(reviewScript: readonly number[] = [0]) {
  const store: GauntletMemoryStore = createGauntletMemoryStore();
  const work = recordingWork();
  const reviewer = scriptedReviewer(reviewScript);
  let tick = 0;
  const deps: GauntletDependencies = {
    store, work, reviewer,
    clock: { now: () => new Date(Date.parse('2026-08-27T00:00:00.000Z') + (tick += 1_000)).toISOString() },
    ids: { next: (kind) => `${kind}#${tick}` },
  };
  return { store, work, reviewer, deps };
}

const command = (over: Partial<GauntletActivationCommand> = {}): GauntletActivationCommand => ({
  runId: 'run-1', projectId: 'prj-1', gauntletId: 'g-1', subjectId: 'task-1',
  activatedBy: 'ghu-1',
  limits: { maxRounds: 3, maxRetries: 2, maxDurationMs: 600_000, maxUsdMicros: 1_000_000 },
  policy: POLICY, ...over,
});

/* ===== 2. Gauntlet does not auto-start · 3. Reviewer does not imply it ==== */

describe('a gauntlet begins only through explicit activation', () => {
  it('is INACTIVE until a person invokes the command', async () => {
    const ctx = harness();
    expect(ctx.store.all()).toEqual([]);
    expect(ctx.work.requested).toEqual([]);
  });

  it('is not started by a review — the reviewer works without it', async () => {
    // A normal Independent Reviewer invocation is a single review through the
    // same port and needs nothing from this module. Calling it does not create
    // a gauntlet.
    const ctx = harness();
    const verdict = await ctx.deps.reviewer.review({ reviewId: 'r-1', subjectId: 'task-1', round: 0 });
    expect(verdict.completed).toBe(true);
    expect(ctx.store.all()).toEqual([]);
  });

  it('is not started by a settlement, a cancellation or a next-round call', async () => {
    // Every other exported entry point refuses when nothing is active. None of
    // them can bring a gauntlet into existence.
    const ctx = harness();
    for (const attempt of [
      advanceGauntletCommand({ runId: 'run-1', gauntletId: 'g-1', phase: 'REVIEW', usage: { durationMs: 0, usdMicros: 0 } }, ctx.deps),
      openNextGauntletRound({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps),
      runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps),
      cancelGauntlet({ runId: 'run-1', gauntletId: 'g-1', actor: 'ghu-1', reason: 'stop' }, ctx.deps),
    ]) {
      const result = await attempt;
      expect(result.advanced).toBe(false);
      if (result.advanced) continue;
      expect(result.reasonCode).toBe('GAUNTLET_NOT_FOUND');
    }
    expect(ctx.store.all()).toEqual([]);
    expect(ctx.work.requested).toEqual([]);
  });

  it('survives a restart without becoming active', async () => {
    const ctx = harness();
    ctx.store.restart();
    expect(ctx.store.all()).toEqual([]);
  });
});

/* ================ 4. Explicit command activates the gauntlet ============= */

describe('the command activates it', () => {
  it('records who activated it, and refuses an unattributed activation', async () => {
    const ctx = harness();
    const refused = await activateGauntlet(command({ activatedBy: '  ' }), ctx.deps);
    expect(refused.activated).toBe(false);
    if (refused.activated) return;
    expect(refused.reasonCode).toBe('ACTIVATOR_REQUIRED');

    const activated = await activateGauntlet(command(), ctx.deps);
    expect(activated.activated).toBe(true);
    if (!activated.activated) return;
    expect(activated.record.activation).toBe('ACTIVE');
    expect(activated.record.activatedBy).toBe('ghu-1');
    expect(activated.resumed).toBe(false);
  });

  it('begins with a REVIEW, because a gauntlet is an intensified review', async () => {
    const ctx = harness();
    const activated = await activateGauntlet(command(), ctx.deps);
    expect(activated.activated).toBe(true);
    if (!activated.activated) return;
    expect(activated.firstWorkId).toBe(gauntletWorkId('g-1', 1, 'REVIEW'));
    expect(ctx.work.requested).toEqual([{ workId: gauntletWorkId('g-1', 1, 'REVIEW'), kind: 'REVIEW' }]);
  });

  it('RESUMES rather than forking when the command is typed twice', async () => {
    const ctx = harness();
    await activateGauntlet(command(), ctx.deps);
    const second = await activateGauntlet(command({ gauntletId: 'g-other' }), ctx.deps);
    expect(second.activated).toBe(true);
    if (!second.activated) return;
    expect(second.resumed).toBe(true);
    expect(second.record.gauntletId).toBe('g-1');
    expect(ctx.store.all()).toHaveLength(1);
  });

  it('refuses when the deployment does not permit iterative review', async () => {
    const ctx = harness();
    const refused = await activateGauntlet(
      command({ policy: { allowed: false, maxRounds: 3, requiresApproval: false } }), ctx.deps,
    );
    expect(refused.activated).toBe(false);
    if (refused.activated) return;
    expect(refused.reasonCode).toBe('ITERATIVE_REVIEW_NOT_PERMITTED');
    expect(ctx.work.requested).toEqual([]);
  });

  it('requires an approval when the deployment gates activation', async () => {
    const ctx = harness();
    const refused = await activateGauntlet(
      command({ policy: { allowed: true, maxRounds: 3, requiresApproval: true } }), ctx.deps,
    );
    expect(refused.activated).toBe(false);
    if (refused.activated) return;
    expect(refused.reasonCode).toBe('GAUNTLET_APPROVAL_REQUIRED');
  });

  it('lets the deployment ceiling win over the request, without refusing the ask', async () => {
    const ctx = harness();
    const activated = await activateGauntlet(command({
      limits: { maxRounds: 50, maxRetries: 2, maxDurationMs: 600_000, maxUsdMicros: 1_000_000 },
      policy: { allowed: true, maxRounds: 2, requiresApproval: false },
    }), ctx.deps);
    expect(activated.activated).toBe(true);
    if (!activated.activated) return;
    expect(activated.record.limits.maxRounds).toBe(2);
  });
});

/* ========= 5. An active gauntlet repeatedly calls the Reviewer =========== */

describe('an active gauntlet uses the Independent Reviewer Harness, repeatedly', () => {
  it('clears on a review with no blocking findings', async () => {
    const ctx = harness([0]);
    await activateGauntlet(command(), ctx.deps);
    const result = await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    expect(result.advanced).toBe(true);
    if (!result.advanced) return;
    expect(result.activation).toBe('CLEARED');
    expect(ctx.reviewer.calls).toEqual([1]);
  });

  it('schedules a repair on blocking findings, then reviews again', async () => {
    const ctx = harness([2, 0]);
    await activateGauntlet(command(), ctx.deps);

    const first = await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    expect(first.advanced).toBe(true);
    if (!first.advanced) return;
    expect(first.activation).toBe('ACTIVE');
    expect(first.nextWorkId).toBe(gauntletWorkId('g-1', 1, 'REPAIR'));
    expect(ctx.work.requested.map((entry) => entry.kind)).toEqual(['REVIEW', 'REPAIR']);

    // The repair completes through the ordinary work boundary.
    await advanceGauntletCommand({
      runId: 'run-1', gauntletId: 'g-1', phase: 'REPAIR', usage: { durationMs: 10, usdMicros: 10 },
    }, ctx.deps);
    const opened = await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    expect(opened.advanced).toBe(true);
    if (!opened.advanced) return;
    expect(opened.round).toBe(2);
    expect(opened.nextWorkId).toBe(gauntletWorkId('g-1', 2, 'REVIEW'));

    const second = await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    expect(second.advanced).toBe(true);
    if (!second.advanced) return;
    expect(second.activation).toBe('CLEARED');
    expect(ctx.reviewer.calls).toEqual([1, 2]);
  });

  it('halts on the retry limit rather than reviewing forever', async () => {
    const ctx = harness([1, 1, 1, 1]);
    await activateGauntlet(command({
      limits: { maxRounds: 9, maxRetries: 1, maxDurationMs: 600_000, maxUsdMicros: 1_000_000 },
    }), ctx.deps);
    await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    await advanceGauntletCommand({ runId: 'run-1', gauntletId: 'g-1', phase: 'REPAIR', usage: { durationMs: 0, usdMicros: 0 } }, ctx.deps);
    await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    const halted = await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    expect(halted.advanced).toBe(true);
    if (!halted.advanced) return;
    expect(halted.activation).toBe('HALTED');
    expect(halted.haltReason).toBe('retry_limit');
  });

  it('halts on the round limit', async () => {
    const ctx = harness([1, 1]);
    await activateGauntlet(command({
      limits: { maxRounds: 1, maxRetries: 5, maxDurationMs: 600_000, maxUsdMicros: 1_000_000 },
    }), ctx.deps);
    await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    await advanceGauntletCommand({ runId: 'run-1', gauntletId: 'g-1', phase: 'REPAIR', usage: { durationMs: 0, usdMicros: 0 } }, ctx.deps);
    const opened = await openNextGauntletRound({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    expect(opened.advanced).toBe(true);
    if (!opened.advanced) return;
    expect(opened.activation).toBe('HALTED');
    expect(opened.haltReason).toBe('round_limit');
  });

  it('halts on the spend ceiling using the round\'s real total', async () => {
    const ctx = harness([1]);
    await activateGauntlet(command({
      limits: { maxRounds: 5, maxRetries: 5, maxDurationMs: 600_000, maxUsdMicros: 1_500 },
    }), ctx.deps);
    // The review costs 1000 and the repair 900: neither alone trips 1500.
    await advanceGauntletCommand({
      runId: 'run-1', gauntletId: 'g-1', phase: 'REVIEW',
      usage: { durationMs: 0, usdMicros: 1_000 }, review: { blockingFindings: 1, findingIds: ['f'] },
    }, ctx.deps);
    const halted = await advanceGauntletCommand({
      runId: 'run-1', gauntletId: 'g-1', phase: 'REPAIR', usage: { durationMs: 0, usdMicros: 900 },
    }, ctx.deps);
    expect(halted.advanced).toBe(true);
    if (!halted.advanced) return;
    expect(halted.activation).toBe('HALTED');
    expect(halted.haltReason).toBe('budget_limit');
  });

  it('absorbs a late settlement for a finished gauntlet', async () => {
    const ctx = harness([0]);
    await activateGauntlet(command(), ctx.deps);
    await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    const late = await advanceGauntletCommand({
      runId: 'run-1', gauntletId: 'g-1', phase: 'REPAIR', usage: { durationMs: 0, usdMicros: 0 },
    }, ctx.deps);
    expect(late.advanced).toBe(true);
    if (!late.advanced) return;
    expect(late.activation).toBe('CLEARED');
  });
});

/* ================ 7. Cancellation does not damage the work =============== */

describe('cancelling a gauntlet', () => {
  it('stops the gauntlet and only the gauntlet\'s own outstanding work', async () => {
    const ctx = harness([1]);
    await activateGauntlet(command(), ctx.deps);
    await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);

    const cancelled = await cancelGauntlet(
      { runId: 'run-1', gauntletId: 'g-1', actor: 'ghu-1', reason: 'Enough.' }, ctx.deps,
    );
    expect(cancelled.advanced).toBe(true);
    if (!cancelled.advanced) return;
    expect(cancelled.activation).toBe('CANCELLED');
    // Only the gauntlet's own unfinished work was cancelled — the repair it
    // had just scheduled — and nothing else was touched.
    expect(ctx.work.cancelled).toEqual([gauntletWorkId('g-1', 1, 'REPAIR')]);
  });

  it('refuses without an actor or a reason', async () => {
    const ctx = harness();
    await activateGauntlet(command(), ctx.deps);
    for (const over of [{ actor: '' }, { reason: '  ' }]) {
      const refused = await cancelGauntlet(
        { runId: 'run-1', gauntletId: 'g-1', actor: 'ghu-1', reason: 'x', ...over }, ctx.deps,
      );
      expect(refused.advanced, JSON.stringify(over)).toBe(false);
    }
  });

  it('stays cancelled, and further settlements change nothing', async () => {
    const ctx = harness([1]);
    await activateGauntlet(command(), ctx.deps);
    await cancelGauntlet({ runId: 'run-1', gauntletId: 'g-1', actor: 'ghu-1', reason: 'stop' }, ctx.deps);
    const later = await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    expect(later.advanced).toBe(true);
    if (!later.advanced) return;
    expect(later.activation).toBe('CANCELLED');
    // The reviewer was never called again after cancellation.
    expect(ctx.reviewer.calls).toEqual([]);
  });
});

/* ============= 8. Restart resumes through the gauntlet subsystem ========= */

describe('restart and resume', () => {
  it('resumes from the gauntlet\'s own record, not from anything Julius owns', async () => {
    const ctx = harness([1, 0]);
    await activateGauntlet(command(), ctx.deps);
    await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);

    ctx.store.restart();

    const resumed = await activateGauntlet(command({ gauntletId: 'g-after-restart' }), ctx.deps);
    expect(resumed.activated).toBe(true);
    if (!resumed.activated) return;
    expect(resumed.resumed).toBe(true);
    expect(resumed.record.gauntletId).toBe('g-1');
    expect(resumed.record.round).toBe(1);
    expect(resumed.record.retries).toBe(1);
    expect(resumed.record.activation).toBe('ACTIVE');
    expect(resumed.record.activatedBy).toBe('ghu-1');
  });

  it('records one round row however many times a phase is scheduled', async () => {
    const ctx = harness();
    await activateGauntlet(command(), ctx.deps);
    const again = await ctx.store.recordRound({
      gauntletId: 'g-1', round: 1, phase: 'REVIEW', workId: 'anything',
      outcome: null, durationMs: null, usdMicros: null, findingIds: [],
      startedAt: '2026-08-27T00:00:00.000Z', completedAt: null,
    });
    expect(again.duplicate).toBe(true);
    expect((await ctx.store.roundsFor('g-1')).filter((r) => r.round === 1 && r.phase === 'REVIEW')).toHaveLength(1);
  });

  it('keeps the first settlement of a phase, not the last', async () => {
    const ctx = harness([1]);
    await activateGauntlet(command(), ctx.deps);
    await runGauntletReview({ runId: 'run-1', gauntletId: 'g-1' }, ctx.deps);
    const overwritten = await ctx.store.settleRound({
      gauntletId: 'g-1', round: 1, phase: 'REVIEW', outcome: 'PASSED',
      durationMs: 0, usdMicros: 0, findingIds: [], completedAt: '2026-08-27T09:00:00.000Z',
    });
    expect(overwritten).toBe(false);
    const round = (await ctx.store.roundsFor('g-1')).find((r) => r.round === 1 && r.phase === 'REVIEW')!;
    expect(round.outcome).toBe('FAILED');
  });

  it('refuses a save against a stale version', async () => {
    const ctx = harness();
    const activated = await activateGauntlet(command(), ctx.deps);
    expect(activated.activated).toBe(true);
    if (!activated.activated) return;
    const stale = await ctx.store.save({ ...activated.record, round: 99 }, activated.record.version - 1);
    expect(stale).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import {
  cancelJuliusRun, decideJuliusApproval, pauseJuliusRun, requestJuliusApproval, resumeJuliusRun,
} from './julius-lifecycle-runtime';
import type { JuliusApproverAuthority } from './julius-lifecycle-runtime';
import { JuliusRunLoop } from './julius-run-loop';
import { cardPolicy, createJuliusHarness, seedRun, task, worker } from './julius-runtime-fixtures';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * CAN A RUN ACTUALLY WAIT, PAUSE AND STOP?
 *
 * `evaluateJuliusPolicy` could return REQUIRE_APPROVAL and the runtime had
 * nowhere to put the request, no way to wait and no way to resume — so a gated
 * operation could only ever be refused, which is not the same thing.
 * `PAUSED` and `CANCELLED` were states with no operation behind them.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
const scope = { projectId: 'prj-1' };

const anyone: JuliusApproverAuthority = { async mayApprove() { return true; } };
const nobody: JuliusApproverAuthority = { async mayApprove() { return false; } };

const build = (opts: { approvers?: JuliusApproverAuthority } = {}) => {
  const harness = createJuliusHarness({
    workers: [{ worker: CODER, script: [{ kind: 'succeed' }, { kind: 'succeed' }] }],
    card: cardPolicy({ allowedProviders: [CODER.providerId] }),
  });
  seedRun(harness, { tasks: [task({ taskId: 'task-1', ordinal: 0 }), task({ taskId: 'task-2', ordinal: 1 })] });
  const deps = {
    store: harness.store, clock: harness.clock,
    approvers: opts.approvers ?? anyone,
  };
  return { harness, deps };
};

const runRow = async (harness: ReturnType<typeof build>['harness']): Promise<JuliusRunRow> =>
  (await harness.store.loadRun('run-1', 'prj-1'))!;

const ask = async (ctx: ReturnType<typeof build>, over: Record<string, unknown> = {}) =>
  requestJuliusApproval({
    run: await runRow(ctx.harness), approvalId: 'apr-1', taskId: 'task-1',
    operation: 'MUTATE_FILESYSTEM', policyRevision: 'card-r1',
    reasonCode: 'CARD_APPROVAL_REQUIRED', safeRationale: 'C.A.R.D. requires an authorized approval.',
    idempotencyKey: 'gate-1', ...over,
  } as Parameters<typeof requestJuliusApproval>[0], ctx.deps);

/* ------------------------------------------------------ requesting a gate */

describe('a gated operation waits instead of being refused', () => {
  it('records the request and moves the run out of a dispatching state', async () => {
    const ctx = build();
    const requested = await ask(ctx);
    expect(requested.requested).toBe(true);
    if (!requested.requested) return;
    expect(requested.record.state).toBe('PENDING');
    // BLOCKED, not PAUSED: PAUSED is somebody's decision and BLOCKED is the
    // run waiting on something. Collapsing them makes "who paused this?"
    // unanswerable.
    expect(requested.runState).toBe('BLOCKED');
  });

  it('stops the scheduler handing out any further work', async () => {
    const ctx = build();
    await ask(ctx);
    const report = await ctx.harness.loop.tick(scope);
    expect(report.claimed).toBe(0);
    expect(ctx.harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
  });

  it('produces ONE request when two workers reach the same gate', async () => {
    const ctx = build();
    const first = await ask(ctx);
    const second = await ask(ctx, { approvalId: 'apr-2', idempotencyKey: 'gate-2' });
    expect(first.requested && second.requested).toBe(true);
    if (!first.requested || !second.requested) return;
    expect(second.duplicate).toBe(true);
    expect(second.record.approvalId).toBe('apr-1');
    expect(await ctx.harness.store.pendingApprovals('run-1', 'prj-1')).toHaveLength(1);
  });

  it('is idempotent on a retried request under the same key', async () => {
    const ctx = build();
    await ask(ctx);
    const again = await ask(ctx);
    expect(again.requested).toBe(true);
    if (!again.requested) return;
    expect(again.duplicate).toBe(true);
  });
});

/* --------------------------------------------------------- deciding a gate */

describe('deciding an approval', () => {
  const gated = async (opts: { approvers?: JuliusApproverAuthority } = {}) => {
    const ctx = build(opts);
    await ask(ctx);
    return ctx;
  };

  const decide = (ctx: ReturnType<typeof build>, over: Record<string, unknown> = {}) =>
    decideJuliusApproval({
      runId: 'run-1', projectId: 'prj-1', approvalId: 'apr-1',
      decision: 'APPROVED', approverId: 'ghu-1', reason: 'Reviewed and accepted.', ...over,
    } as Parameters<typeof decideJuliusApproval>[0], ctx.deps);

  it('resumes the run and lets work flow again', async () => {
    const ctx = await gated();
    const decided = await decide(ctx);
    expect(decided.decided).toBe(true);
    if (!decided.decided) return;
    expect(decided.state).toBe('APPROVED');
    expect(decided.runState).toBe('READY');

    const report = await ctx.harness.loop.tick(scope);
    expect(report.claimed).toBeGreaterThan(0);
  });

  it('fails the run on a denial rather than silently continuing', async () => {
    const ctx = await gated();
    const decided = await decide(ctx, { decision: 'DENIED', reason: 'Out of scope.' });
    expect(decided.decided).toBe(true);
    if (!decided.decided) return;
    expect(decided.state).toBe('DENIED');
    expect(decided.runState).toBe('FAILED');
    expect((await ctx.harness.loop.tick(scope)).claimed).toBe(0);
  });

  it('refuses an approver the authority does not permit', async () => {
    const ctx = await gated({ approvers: nobody });
    const decided = await decide(ctx);
    expect(decided.decided).toBe(false);
    if (decided.decided) return;
    expect(decided.reasonCode).toBe('APPROVER_NOT_AUTHORIZED');
    // And the run is still waiting, not quietly resumed.
    expect((await runRow(ctx.harness)).state).toBe('BLOCKED');
  });

  it('refuses an approval nobody can be named for', async () => {
    const ctx = await gated();
    for (const over of [{ approverId: '  ' }, { reason: '' }]) {
      const decided = await decide(ctx, over);
      expect(decided.decided, JSON.stringify(over)).toBe(false);
      if (decided.decided) return;
      expect(decided.reasonCode).toBe('APPROVER_REQUIRED');
    }
  });

  it('absorbs a second decision instead of overwriting the first', async () => {
    const ctx = await gated();
    await decide(ctx);
    const second = await decide(ctx, { decision: 'DENIED', approverId: 'ghu-2', reason: 'Changed my mind.' });
    expect(second.decided).toBe(true);
    if (!second.decided) return;
    expect(second.duplicate).toBe(true);
    expect(second.state).toBe('APPROVED');
    const stored = await ctx.harness.store.loadApproval('run-1', 'apr-1', 'prj-1');
    expect(stored!.decidedBy).toBe('ghu-1');
  });

  it('does not resume while another gate is still open', async () => {
    const ctx = await gated();
    await requestJuliusApproval({
      run: await runRow(ctx.harness), approvalId: 'apr-2', taskId: 'task-2',
      operation: 'ACCESS_NETWORK', policyRevision: 'card-r1', reasonCode: 'CARD_APPROVAL_REQUIRED',
      safeRationale: 'Network access requires approval.', idempotencyKey: 'gate-2',
    }, ctx.deps);

    const decided = await decide(ctx);
    expect(decided.decided).toBe(true);
    if (!decided.decided) return;
    expect(decided.state).toBe('APPROVED');
    // Still BLOCKED: one answered gate is not every gate.
    expect(decided.runState).toBe('BLOCKED');
  });

  it('answers an approval for a cancelled run as CANCELLED, not APPROVED', async () => {
    const ctx = await gated();
    await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'Superseded.' }, ctx.deps);
    const decided = await decide(ctx);
    expect(decided.decided).toBe(false);
    if (decided.decided) return;
    expect(decided.reasonCode).toBe('RUN_CANCELLED');
    expect((await ctx.harness.store.loadApproval('run-1', 'apr-1', 'prj-1'))!.state).toBe('CANCELLED');
  });

  it('refuses a run or approval that is not this caller\'s', async () => {
    const ctx = await gated();
    const wrongProject = await decide(ctx, { projectId: 'prj-other' });
    expect(wrongProject.decided).toBe(false);
    if (wrongProject.decided) return;
    expect(wrongProject.reasonCode).toBe('RUN_NOT_FOUND');

    const missing = await decide(ctx, { approvalId: 'apr-nope' });
    expect(missing.decided).toBe(false);
    if (missing.decided) return;
    expect(missing.reasonCode).toBe('APPROVAL_NOT_FOUND');
  });

  it('survives a restart with the gate still open', async () => {
    const ctx = await gated();
    ctx.harness.store.restart();
    expect(await ctx.harness.store.pendingApprovals('run-1', 'prj-1')).toHaveLength(1);
    expect((await runRow(ctx.harness)).state).toBe('BLOCKED');
    const decided = await decide(ctx);
    expect(decided.decided).toBe(true);
  });
});

/* ---------------------------------------------------- Unchained's limits */

describe('Unchained cannot answer an approval on a person\'s behalf', () => {
  it('leaves a requested approval pending whatever the autonomy level', async () => {
    // `evaluateJuliusPolicy` skips the approval GATE under UNCHAINED, which is
    // its rule about which operations are gated. Once an approval has been
    // REQUESTED, no autonomy level decides it: this module never reads
    // autonomy at all, and there is no field it could read it from.
    const ctx = build();
    await ask(ctx);
    expect(await ctx.harness.store.pendingApprovals('run-1', 'prj-1')).toHaveLength(1);
    const ticked = await ctx.harness.loop.tick(scope);
    expect(ticked.claimed).toBe(0);
    expect(await ctx.harness.store.pendingApprovals('run-1', 'prj-1')).toHaveLength(1);
  });
});

/* ------------------------------------------------------- pause and resume */

describe('pause', () => {
  it('stops new claims and records who asked and why', async () => {
    const ctx = build();
    const paused = await pauseJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'Founder review.' }, ctx.deps);
    expect(paused.applied).toBe(true);
    if (!paused.applied) return;
    expect(paused.to).toBe('PAUSED');
    expect(ctx.harness.store.lifecycleOf('run-1')).toEqual(
      expect.objectContaining({ actor: 'ghu-1', reason: 'Founder review.' }),
    );
    expect((await ctx.harness.loop.tick(scope)).claimed).toBe(0);
  });

  it('does NOT kill work already in flight', async () => {
    const ctx = build();
    const claim = (await ctx.harness.store.claimRunnable({
      owner: 'worker-a', now: ctx.harness.clock.now(),
      leaseExpiresAt: '2026-08-27T12:00:00.000Z', limit: 1, projectId: 'prj-1',
    }))[0]!;
    await pauseJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'Founder review.' }, ctx.deps);

    // The in-flight result is still accepted: it was already paid for, and
    // discarding it would make pausing cost more than finishing.
    const receipt = await ctx.harness.store.acceptWorkerResult({
      resultId: 'r1', idempotencyKey: 'k1', runId: 'run-1', projectId: 'prj-1',
      taskId: claim.taskId, leaseGeneration: claim.leaseGeneration, workerId: 'coder',
      status: 'SUCCEEDED', safeSummary: 'finished', evidenceIds: [], providerReceiptIds: [],
      occurredAt: ctx.harness.clock.now(),
    });
    expect(receipt.recorded).toBe(true);
  });

  it('refuses without an actor or a reason', async () => {
    const ctx = build();
    for (const over of [{ actor: '' }, { reason: '  ' }]) {
      const paused = await pauseJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'x', ...over }, ctx.deps);
      expect(paused.applied, JSON.stringify(over)).toBe(false);
    }
  });

  it('is idempotent', async () => {
    const ctx = build();
    await pauseJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'once' }, ctx.deps);
    const again = await pauseJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'twice' }, ctx.deps);
    expect(again.applied).toBe(true);
    if (!again.applied) return;
    expect(again.duplicate).toBe(true);
  });
});

describe('resume', () => {
  it('brings a paused run back and lets work flow', async () => {
    const ctx = build();
    await pauseJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'hold' }, ctx.deps);
    const resumed = await resumeJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'go' }, ctx.deps);
    expect(resumed.applied).toBe(true);
    if (!resumed.applied) return;
    expect(resumed.to).toBe('READY');
    expect((await ctx.harness.loop.tick(scope)).claimed).toBeGreaterThan(0);
  });

  it('refuses to "resume" a run that was never paused', async () => {
    const ctx = build();
    const resumed = await resumeJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'go' }, ctx.deps);
    expect(resumed.applied).toBe(false);
    if (resumed.applied) return;
    // Reporting success here would tell an operator their run is running when
    // it is blocked on an approval.
    expect(resumed.reasonCode).toBe('RUN_NOT_PAUSED');
  });
});

/* -------------------------------------------------------------- cancel */

describe('cancel', () => {
  it('stops the run and every task still in it', async () => {
    const ctx = build();
    const cancelled = await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'Superseded.' }, ctx.deps);
    expect(cancelled.applied).toBe(true);
    if (!cancelled.applied) return;
    expect(cancelled.to).toBe('CANCELLED');
    expect(cancelled.cancelledTasks).toBe(2);
    expect(ctx.harness.store.taskRow('task-1')!.state).toBe('CANCELLED');
    expect((await ctx.harness.loop.tick(scope)).claimed).toBe(0);
  });

  it('rejects a late result rather than resurrecting the task', async () => {
    const ctx = build();
    const claim = (await ctx.harness.store.claimRunnable({
      owner: 'worker-a', now: ctx.harness.clock.now(),
      leaseExpiresAt: '2026-08-27T12:00:00.000Z', limit: 1, projectId: 'prj-1',
    }))[0]!;
    await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'stop' }, ctx.deps);
    await expect(ctx.harness.store.acceptWorkerResult({
      resultId: 'r1', idempotencyKey: 'k1', runId: 'run-1', projectId: 'prj-1',
      taskId: claim.taskId, leaseGeneration: claim.leaseGeneration, workerId: 'coder',
      status: 'SUCCEEDED', safeSummary: 'late', evidenceIds: [], providerReceiptIds: [],
      occurredAt: ctx.harness.clock.now(),
    })).rejects.toThrow('result_after_cancellation');
  });

  it('is idempotent and leaves already-terminal tasks alone', async () => {
    const ctx = build();
    // One task at a time, so the run is still mid-flight rather than COMPLETED
    // when the cancel arrives — a completed run is terminal and refuses one.
    const narrow = new JuliusRunLoop(ctx.harness.deps, ctx.harness.policies, { claimLimit: 1, leaseMs: 60_000 });
    await narrow.tick(scope);
    const succeeded = ['task-1', 'task-2'].filter((id) => ctx.harness.store.taskRow(id)!.state === 'SUCCEEDED');
    expect(succeeded.length).toBe(1);

    const first = await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'stop' }, ctx.deps);
    expect(first.applied).toBe(true);
    if (!first.applied) return;
    expect(first.cancelledTasks).toBe(1);

    const again = await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'stop again' }, ctx.deps);
    expect(again.applied).toBe(true);
    if (!again.applied) return;
    expect(again.duplicate).toBe(true);
    for (const id of succeeded) expect(ctx.harness.store.taskRow(id)!.state).toBe('SUCCEEDED');
  });

  it('refuses to cancel a run that already completed', async () => {
    const ctx = build();
    await ctx.harness.loop.tick(scope);
    expect((await runRow(ctx.harness)).state).toBe('COMPLETED');
    const cancelled = await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-1', actor: 'ghu-1', reason: 'too late' }, ctx.deps);
    expect(cancelled.applied).toBe(false);
    if (cancelled.applied) return;
    expect(cancelled.reasonCode).toBe('TRANSITION_NOT_LEGAL');
  });

  it('refuses a run in another project', async () => {
    const ctx = build();
    const cancelled = await cancelJuliusRun({ runId: 'run-1', projectId: 'prj-other', actor: 'ghu-1', reason: 'stop' }, ctx.deps);
    expect(cancelled.applied).toBe(false);
    if (cancelled.applied) return;
    expect(cancelled.reasonCode).toBe('RUN_NOT_FOUND');
    expect((await runRow(ctx.harness)).state).not.toBe('CANCELLED');
  });
});

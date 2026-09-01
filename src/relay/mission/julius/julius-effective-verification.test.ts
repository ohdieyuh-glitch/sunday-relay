/**
 * EFFECTIVE VERIFICATION STATE — the founder's completion semantics, proven.
 *
 * History is immutable audit material: no decision is ever deleted or
 * rewritten. Completion, however, reads each task's CURRENT decision and
 * honors repair lineage: a REPAIR that was successfully addressed by its own
 * parent-linked repair task — and re-verified to an effective ACCEPT — no
 * longer poisons `missionMayComplete`. Unrelated ACCEPTs supersede nothing,
 * HALT stays fail-closed, and the whole computation is deterministic from
 * durable tasks + the ordered decision log alone.
 */

import { describe, expect, it } from 'vitest';
import {
  missionMayComplete,
  type JuliusRecordedDecision,
  type JuliusTask,
} from './julius-runtime';
import { targetRunState } from './julius-run-loop';
import {
  cardPolicy,
  createJuliusHarness,
  task,
  verificationPolicy,
  worker,
} from './julius-runtime-fixtures';

/* ---------------------------------------------------------------- units */

const tsk = (
  taskId: string,
  over: Partial<JuliusTask> = {},
): JuliusTask => ({
  taskId, missionId: 'msn-1', parentTaskId: null, dependencyIds: [],
  requiredEvidenceTypes: [], taskType: 'build', role: 'CODING_AGENT',
  ordinal: 0, state: 'SUCCEEDED', ...over,
} as JuliusTask);

const repairOf = (parent: string, taskId: string, over: Partial<JuliusTask> = {}): JuliusTask =>
  tsk(taskId, { parentTaskId: parent, taskType: 'repair:build', ...over });

const dec = (
  taskId: string,
  action: JuliusRecordedDecision['action'],
): JuliusRecordedDecision => ({
  taskId, action, reasonCode: `${action}_TEST`, evidenceIds: ['e1'], safeSummary: `${action} for ${taskId}.`,
});

const may = (tasks: readonly JuliusTask[], decisions: readonly JuliusRecordedDecision[]): boolean =>
  missionMayComplete({ state: 'VERIFYING', tasks, decisions });

describe('missionMayComplete reads effective verification state', () => {
  it('1. an ACCEPT-only mission may complete', () => {
    expect(may([tsk('x')], [dec('x', 'ACCEPT')])).toBe(true);
  });

  it('2. a REPAIR with no completed, re-verified repair may not complete', () => {
    // No repair task at all.
    expect(may([tsk('x')], [dec('x', 'REPAIR')])).toBe(false);
    // A repair task that succeeded but was never verified vouches for nothing.
    expect(may([tsk('x'), repairOf('x', 'x-r1')], [dec('x', 'REPAIR')])).toBe(false);
    // A repair task that itself carries a REPAIR with no further lineage.
    expect(may(
      [tsk('x'), repairOf('x', 'x-r1')],
      [dec('x', 'REPAIR'), dec('x-r1', 'REPAIR')],
    )).toBe(false);
  });

  it('3. REPAIR → successful repair → effective ACCEPT for that lineage → completable', () => {
    expect(may(
      [tsk('x'), repairOf('x', 'x-r1')],
      [dec('x', 'REPAIR'), dec('x-r1', 'ACCEPT')],
    )).toBe(true);
    // A repaired repair completes through the chain.
    expect(may(
      [tsk('x'), repairOf('x', 'x-r1'), repairOf('x-r1', 'x-r2', { taskType: 'repair:repair:build' })],
      [dec('x', 'REPAIR'), dec('x-r1', 'REPAIR'), dec('x-r2', 'ACCEPT')],
    )).toBe(true);
    // A FAILED repair task supersedes nothing even if somehow decided.
    expect(may(
      [tsk('x'), repairOf('x', 'x-r1', { state: 'FAILED' })],
      [dec('x', 'REPAIR'), dec('x-r1', 'ACCEPT')],
    )).toBe(false);
  });

  it('5. an unrelated ACCEPT never supersedes another task\'s REPAIR', () => {
    expect(may(
      [tsk('x'), tsk('y', { ordinal: 1 })],
      [dec('x', 'REPAIR'), dec('y', 'ACCEPT')],
    )).toBe(false);
    // Even a repair-typed, accepted task under a DIFFERENT parent is unrelated.
    expect(may(
      [tsk('x'), tsk('y', { ordinal: 1 }), repairOf('y', 'y-r1')],
      [dec('x', 'REPAIR'), dec('y', 'REPAIR'), dec('y-r1', 'ACCEPT')],
    )).toBe(false);
    // A same-parent child WITHOUT the repair task type is not repair lineage.
    expect(may(
      [tsk('x'), tsk('x-review', { parentTaskId: 'x', taskType: 'review:build', role: 'INDEPENDENT_REVIEWER' })],
      [dec('x', 'REPAIR'), dec('x-review', 'ACCEPT')],
    )).toBe(false);
  });

  it('6. every currently effective scope must accept — one unrepaired REPAIR still blocks', () => {
    const tasks = [tsk('x1'), tsk('x2', { ordinal: 1 }), repairOf('x1', 'x1-r1'), repairOf('x2', 'x2-r1')];
    expect(may(tasks, [
      dec('x1', 'REPAIR'), dec('x2', 'REPAIR'), dec('x1-r1', 'ACCEPT'),
    ])).toBe(false);
    expect(may(tasks, [
      dec('x1', 'REPAIR'), dec('x2', 'REPAIR'), dec('x1-r1', 'ACCEPT'), dec('x2-r1', 'ACCEPT'),
    ])).toBe(true);
  });

  it('7. HALT stays fail-closed: repair lineage never supersedes it', () => {
    // Even a successful, accepted repair child does not clear a HALT.
    expect(may(
      [tsk('x'), repairOf('x', 'x-r1')],
      [dec('x', 'HALT'), dec('x-r1', 'ACCEPT')],
    )).toBe(false);
    // The one authorized path is the evaluator re-deciding the SAME task: a
    // later ACCEPT on that task is current; a later HALT is equally current.
    expect(may([tsk('x')], [dec('x', 'HALT'), dec('x', 'ACCEPT')])).toBe(true);
    expect(may([tsk('x')], [dec('x', 'ACCEPT'), dec('x', 'HALT')])).toBe(false);
    // Every other non-ACCEPT action is fail-closed the same way.
    expect(may([tsk('x')], [dec('x', 'ESCALATE')])).toBe(false);
  });

  it('9. duplicate or replayed decisions cannot change the effective answer', () => {
    const tasks = [tsk('x'), repairOf('x', 'x-r1')];
    const once = [dec('x', 'REPAIR'), dec('x-r1', 'ACCEPT')];
    const replayed = [...once, dec('x', 'REPAIR'), dec('x-r1', 'ACCEPT'), dec('x-r1', 'ACCEPT')];
    // A replayed REPAIR lands later in the log but is identical in verdict
    // and task, so the per-task current decision — and the lineage answer
    // that supersedes it — are unchanged.
    expect(may(tasks, once)).toBe(true);
    expect(may(tasks, replayed)).toBe(true);
    // Replaying the unrelated ACCEPT from scenario 5 still unblocks nothing.
    expect(may(
      [tsk('x'), tsk('y', { ordinal: 1 })],
      [dec('x', 'REPAIR'), dec('y', 'ACCEPT'), dec('y', 'ACCEPT')],
    )).toBe(false);
  });

  it('still requires the outer conditions: VERIFYING, terminal tasks, at least one decision', () => {
    expect(may([tsk('x')], [])).toBe(false);
    expect(may([tsk('x', { state: 'ACTIVE' })], [dec('x', 'ACCEPT')])).toBe(false);
    expect(missionMayComplete({ state: 'EXECUTING', tasks: [tsk('x')], decisions: [dec('x', 'ACCEPT')] })).toBe(false);
    expect(missionMayComplete({ state: 'COMPLETED', tasks: [tsk('x')], decisions: [dec('x', 'ACCEPT')] })).toBe(false);
  });
});

/* ------------------------------------- the full flow, through the loop */

const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
  providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:build', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});
const scope = { projectId: 'prj-1' };

/** Drain the loop, bounded; returns the tick count so no branch exits bare. */
async function drain(loop: { tick(scope: { projectId: string }): Promise<{ claimed: number }> }, maxTicks = 16): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    const report = await loop.tick(scope);
    if (report.claimed === 0) return tick;
  }
  return maxTicks;
}

function buildRepairMission() {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: CODER,
        script: [
          { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] },
          { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green after repair.' }] },
        ],
      },
      {
        worker: REVIEWER,
        script: [
          { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The branch is untested.' }] },
          { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] },
        ],
      },
    ],
    card: cardPolicy({
      allowedProviders: [CODER.providerId, REVIEWER.providerId],
      capabilities: ['implement', 'review'],
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor: (item) => (item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
  });
  harness.store.seedRun({
    runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
    cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 0, requiredEvidenceTypes: ['TEST'] }));
  return harness;
}

describe('the repaired mission completes through the run loop, with its history intact', () => {
  it('3+4+10. REPAIR → repair task → accepting re-review → Julius advances the run to COMPLETED', async () => {
    const harness = buildRepairMission();
    await drain(harness.loop);

    // The repair round genuinely happened.
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    const repairs = tasks.filter((item) => item.taskType.startsWith('repair:'));
    expect(repairs.length).toBeGreaterThan(0);
    expect(repairs.every((item) => item.state === 'SUCCEEDED')).toBe(true);
    expect(repairs.every((item) => item.parentTaskId === 'build-1')).toBe(true);

    // 4. The original REPAIR decision remains durable history, alongside the
    // lineage's ACCEPT — nothing was deleted or rewritten to permit this.
    const decisions = await harness.store.decisionsForRun('run-1', 'prj-1');
    expect(decisions.some((decision) => decision.action === 'REPAIR' && decision.taskId === 'build-1')).toBe(true);
    expect(decisions.some((decision) => decision.action === 'ACCEPT')).toBe(true);

    // 3. And the run COMPLETED — the exact flow the old rule made impossible.
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');

    // 10. Completion was Julius's own transition, not a worker's: the loop's
    // advance emitted the completion event from the verified decision state.
    expect(harness.store.events().some((event) => event.type === 'run.completed')).toBe(true);
  });

  it('2 (live). the same mission is NOT COMPLETED while the repair round is still open', async () => {
    const harness = buildRepairMission();
    // Tick exactly twice: build runs, then its review fails — the REPAIR
    // decision exists, the repair task does not yet have an accepting review.
    await harness.loop.tick(scope);
    await harness.loop.tick(scope);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run!.state).not.toBe('COMPLETED');
  });

  it('8. a restart recomputes the same effective state from durable rows alone', async () => {
    const harness = buildRepairMission();
    await drain(harness.loop);
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');

    // Simulate a process restart: durable data survives, in-flight leases die.
    harness.store.restart();
    const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
    const decisions = await harness.store.decisionsForRun('run-1', 'prj-1');
    // The completion target recomputed from re-read persistence is identical.
    expect(targetRunState(tasks, decisions)).toEqual({ state: 'COMPLETED', reasonCode: 'MISSION_VERIFIED' });
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });
});

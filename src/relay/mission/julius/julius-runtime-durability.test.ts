import { describe, expect, it } from 'vitest';

import { JuliusRunLoop } from './julius-run-loop';
import { createJuliusHarness, seedRun, task, worker } from './julius-runtime-fixtures';

/**
 * THE PROPERTIES THAT MAKE A RUNTIME BELIEVABLE.
 *
 * A run loop that works once, in one process, with one worker, proves very
 * little. These are the four questions a durable execution system has to
 * answer: can two workers take the same task, does a crashed worker's task
 * come back, does a duplicate result do damage, and does a stale lease still
 * have authority.
 *
 * WHAT THESE TESTS ARE EVIDENCE ABOUT. The in-memory store models the claim
 * exclusion, the lease generation compare-and-set and the idempotency
 * constraints that the SQL declares; a pass here is evidence about the
 * RUNTIME'S LOGIC and is not evidence about PostgreSQL. No PostgreSQL and no
 * container runtime exists on this machine — see the header of
 * `julius-memory-store.ts`, which states the limit rather than implying it is
 * covered.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'] });
const scope = { projectId: 'prj-1' };

const twoLoops = () => {
  const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
  seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
  const second = new JuliusRunLoop(
    { ...harness.deps, owner: 'worker-b' }, harness.policies, { claimLimit: 10, leaseMs: 60_000 },
  );
  return { harness, second };
};

describe('two schedulers, one task', () => {
  it('only one of them claims it', async () => {
    const { harness, second } = twoLoops();
    const [first, other] = await Promise.all([harness.loop.tick(scope), second.tick(scope)]);
    expect(first.claimed + other.claimed).toBe(1);
  });

  it('dispatches the provider exactly once', async () => {
    const { harness, second } = twoLoops();
    await Promise.all([harness.loop.tick(scope), second.tick(scope)]);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(1);
  });

  it('records one worker result, not two', async () => {
    const { harness, second } = twoLoops();
    await Promise.all([harness.loop.tick(scope), second.tick(scope)]);
    expect(harness.store.results()).toHaveLength(1);
  });

  it('records evidence once, even though both loops ran', async () => {
    const { harness, second } = twoLoops();
    await Promise.all([harness.loop.tick(scope), second.tick(scope)]);
    expect(await harness.store.evidenceForRun('run-1', 'prj-1')).toHaveLength(1);
  });

  it('reserves budget for one execution', async () => {
    const { harness, second } = twoLoops();
    await Promise.all([harness.loop.tick(scope), second.tick(scope)]);
    expect(harness.budget.reservations().filter((row) => row.state === 'COMMITTED')).toHaveLength(1);
  });
});

describe('a worker that never comes back', () => {
  it('leaves the task claimable again once the lease expires', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }],
      config: { leaseMs: 1_000 },
    });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    // Claim without executing — the shape a crashed worker leaves behind.
    const claims = await harness.store.claimRunnable({
      owner: 'ghost', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T00:00:01.000Z', limit: 1, projectId: 'prj-1',
    });
    expect(claims).toHaveLength(1);
    expect(harness.store.taskRow('task-1')!.state).toBe('ACTIVE');

    harness.clock.advance(60_000);
    const report = await harness.loop.tick(scope);
    expect(report.claimed).toBe(1);
    expect(report.outcomes[0].kind).toBe('COMPLETED');
  });

  it('gives the reclaiming worker a NEW generation, so the ghost has no authority', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    const ghost = (await harness.store.claimRunnable({
      owner: 'ghost', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T00:00:01.000Z', limit: 1, projectId: 'prj-1',
    }))[0]!;
    harness.clock.advance(60_000);
    await harness.loop.tick(scope);

    expect(harness.store.taskRow('task-1')!.leaseGeneration).toBeGreaterThan(ghost.leaseGeneration);
    // The ghost cannot finish, heartbeat, or report a result against the task
    // it thinks it still owns.
    expect(await harness.store.finishTask({
      taskId: 'task-1', owner: 'ghost', leaseGeneration: ghost.leaseGeneration,
      state: 'SUCCEEDED', now: harness.clock.now(),
    })).toBe(false);
    expect(await harness.store.heartbeat({
      taskId: 'task-1', owner: 'ghost', leaseGeneration: ghost.leaseGeneration,
      now: harness.clock.now(), leaseExpiresAt: '2026-08-27T01:00:00.000Z',
    })).toBe(false);
    await expect(harness.store.acceptWorkerResult({
      resultId: 'r', idempotencyKey: 'ghost', runId: 'run-1', projectId: 'prj-1',
      taskId: 'task-1', leaseGeneration: ghost.leaseGeneration, workerId: 'coder',
      status: 'SUCCEEDED', safeSummary: 'late', evidenceIds: [], providerReceiptIds: [],
      occurredAt: harness.clock.now(),
    })).rejects.toThrow(/stale_worker_result|julius_task_not_found/);
  });
});

describe('a process restart mid-flight', () => {
  it('resumes from durable state and completes without re-running what finished', async () => {
    const harness = createJuliusHarness({
      workers: [{ worker: CODER, script: [{ kind: 'succeed' }, { kind: 'succeed' }] }],
    });
    seedRun(harness, {
      tasks: [
        task({ taskId: 'first', ordinal: 0 }),
        task({ taskId: 'second', ordinal: 1, dependencyIds: ['first'] }),
      ],
    });

    await harness.loop.tick(scope);
    expect(harness.store.taskRow('first')!.state).toBe('SUCCEEDED');

    // The process dies. Nothing is held in memory between ticks, so a new loop
    // over the same durable state is all a restart is.
    harness.store.restart();
    const resumed = new JuliusRunLoop(
      { ...harness.deps, owner: 'worker-after-restart' }, harness.policies,
      { claimLimit: 10, leaseMs: 60_000 },
    );

    const report = await resumed.tick(scope);
    expect(report.outcomes.map((outcome) => outcome.taskId)).toEqual(['second']);
    // `first` was NOT re-run: a completed task is not replayed by a restart.
    expect(harness.adapters.get(CODER.adapterId)!.dispatches.map((d) => d.taskId)).toEqual(['first', 'second']);
    expect(harness.store.results()).toHaveLength(2);
  });

  it('re-runs a task that was in flight, because an unconfirmed run is not a completion', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });

    await harness.store.claimRunnable({
      owner: 'dying-worker', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T12:00:00.000Z', limit: 1, projectId: 'prj-1',
    });
    harness.store.restart();

    const report = await harness.loop.tick(scope);
    expect(report.claimed).toBe(1);
    expect(report.outcomes[0].kind).toBe('COMPLETED');
  });
});

describe('duplicate delivery', () => {
  it('absorbs a repeated worker result rather than recording it twice', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const claim = (await harness.store.claimRunnable({
      owner: 'worker-a', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T12:00:00.000Z', limit: 1, projectId: 'prj-1',
    }))[0]!;

    const submit = () => harness.store.acceptWorkerResult({
      resultId: 'result-1', idempotencyKey: 'op-1', runId: 'run-1', projectId: 'prj-1',
      taskId: 'task-1', leaseGeneration: claim.leaseGeneration, workerId: 'coder',
      status: 'SUCCEEDED', safeSummary: 'done', evidenceIds: [], providerReceiptIds: [],
      occurredAt: harness.clock.now(),
    });

    expect((await submit()).duplicate).toBe(false);
    expect((await submit()).duplicate).toBe(true);
    expect(harness.store.results()).toHaveLength(1);
  });

  it('absorbs repeated evidence under the same idempotency key', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const evidence = {
      evidenceId: 'evd-1', missionId: 'msn-1', taskId: 'task-1', workerId: 'coder',
      type: 'TEST' as const, status: 'PASSED' as const, safeSummary: 'ok',
      artifactRef: null, integrityHash: null, occurredAt: harness.clock.now(),
    };
    const write = () => harness.store.appendEvidence({
      runId: 'run-1', projectId: 'prj-1', idempotencyKey: 'k1', evidence,
    });
    expect(await write()).toBe(true);
    expect(await write()).toBe(false);
    expect(await harness.store.evidenceForRun('run-1', 'prj-1')).toHaveLength(1);
  });

  it('refuses a result after cancellation instead of resurrecting the task', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const claim = (await harness.store.claimRunnable({
      owner: 'worker-a', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T12:00:00.000Z', limit: 1, projectId: 'prj-1',
    }))[0]!;
    await harness.store.transition({
      commandId: 'cancel-1', runId: 'run-1', projectId: 'prj-1', expectedVersion: 1,
      to: 'CANCELLED', reasonCode: 'OPERATOR_CANCELLED', safeSummary: 'Cancelled by the operator.',
      evidenceIds: [], occurredAt: harness.clock.now(),
    });

    await expect(harness.store.acceptWorkerResult({
      resultId: 'r', idempotencyKey: 'late', runId: 'run-1', projectId: 'prj-1',
      taskId: 'task-1', leaseGeneration: claim.leaseGeneration, workerId: 'coder',
      status: 'SUCCEEDED', safeSummary: 'late', evidenceIds: [], providerReceiptIds: [],
      occurredAt: harness.clock.now(),
    })).rejects.toThrow('result_after_cancellation');
  });

  it('refuses two results for one lease generation', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const claim = (await harness.store.claimRunnable({
      owner: 'worker-a', now: harness.clock.now(),
      leaseExpiresAt: '2026-08-27T12:00:00.000Z', limit: 1, projectId: 'prj-1',
    }))[0]!;
    const base = {
      runId: 'run-1', projectId: 'prj-1', taskId: 'task-1',
      leaseGeneration: claim.leaseGeneration, workerId: 'coder',
      status: 'SUCCEEDED' as const, safeSummary: 'done',
      evidenceIds: [], providerReceiptIds: [], occurredAt: harness.clock.now(),
    };
    await harness.store.acceptWorkerResult({ ...base, resultId: 'r1', idempotencyKey: 'k1' });
    await expect(harness.store.acceptWorkerResult({ ...base, resultId: 'r2', idempotencyKey: 'k2' }))
      .rejects.toThrow(/duplicate_result_generation|stale_worker_result/);
  });
});

describe('a run id is not an authorization', () => {
  it('serves NOTHING to a reader holding the right run id and the wrong project', async () => {
    // A run id alone is enough to FIND a row and not enough to be allowed to
    // read it. The first version of the reader filtered on `run_id` alone
    // while its own header claimed each query was scoped through
    // `julius_runs` — a tenancy claim the SQL did not make.
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { projectId: 'prj-owner', tasks: [task({ taskId: 'task-1' })] });
    await harness.loop.tick({ projectId: 'prj-owner' });

    // The owner sees its own run.
    expect(await harness.store.tasksForRun('run-1', 'prj-owner')).toHaveLength(1);
    expect((await harness.store.evidenceForRun('run-1', 'prj-owner')).length).toBeGreaterThan(0);

    // An intruder holding the same run id sees nothing at all.
    for (const read of [
      harness.store.tasksForRun('run-1', 'prj-intruder'),
      harness.store.evidenceForRun('run-1', 'prj-intruder'),
      harness.store.findingsForRun('run-1', 'prj-intruder'),
      harness.store.criteriaForRun('run-1', 'prj-intruder'),
      harness.store.decisionsForRun('run-1', 'prj-intruder'),
      harness.store.brainEntriesForRun('run-1', 'prj-intruder'),
    ]) {
      expect(await read).toEqual([]);
    }
    expect(await harness.store.repairRoundsFor('task-1', 'prj-intruder')).toBe(0);
    expect(await harness.store.reviewCompletedFor('task-1', 'prj-intruder')).toBe(false);
  });

  it('is never claimed, executed, or written to', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { projectId: 'prj-owner', tasks: [task({ taskId: 'task-1' })] });
    const report = await harness.loop.tick({ projectId: 'prj-intruder' });
    expect(report.claimed).toBe(0);
    expect(harness.store.events()).toHaveLength(0);
    expect(harness.store.trajectory()).toHaveLength(0);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
  });
});

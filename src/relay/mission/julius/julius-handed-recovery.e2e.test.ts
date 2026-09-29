import { describe, expect, it } from 'vitest';

import { planJuliusRecovery } from './julius-recovery';
import type { JuliusProviderAdapter } from './julius-router';
import { JuliusRunLoop } from './julius-run-loop';
import { taskAttemptCeiling } from './julius-task-pipeline';
import { createFakeTime, createJuliusHarness, seedRun, task, worker, type FakeTime, type JuliusHarness } from './julius-runtime-fixtures';

/**
 * FOLLOW-UP (a): A HANDED TASK IS NEVER PAID FOR TWICE, AND ONE TASK'S THROW
 * NO LONGER ABANDONS ITS TICK.
 *
 * Recovery used to requeue every expired lease. When the attempt under that
 * lease had already been handed to a provider, the next claim dispatched the
 * worker AGAIN, and the first answer, paid for, was never recorded. The
 * durable `worker.dispatched` event (written before the handoff) now tells
 * recovery the attempt was handed, and it ends the task as
 * HANDED_OUTCOME_UNKNOWN instead: the live lane's decision C, with the stricter
 * answer under every autonomy until SUPERVISED parking exists.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], timeoutMs: 30_000 });
const scope = { projectId: 'prj-1' };
const LEASE_MS = 1_000;
const pg = (code: string) => Object.assign(new Error(`driver ${code}`), { code, severity: 'ERROR' });

describe('planJuliusRecovery: a handed attempt is never requeued', () => {
  const base = { runId: 'r', projectId: 'p', runState: 'EXECUTING' as const, taskId: 't', attempt: 1, maxRetries: 2, leaseGeneration: 3, recoveries: 0 };

  it('handed: FAIL_TASK, HANDED_OUTCOME_UNKNOWN', () => {
    expect(planJuliusRecovery({ ...base, handed: true })).toMatchObject({ action: 'FAIL_TASK', reasonCode: 'HANDED_OUTCOME_UNKNOWN' });
  });
  it('not handed: requeued, exactly as before', () => {
    expect(planJuliusRecovery({ ...base, handed: false })).toMatchObject({ action: 'REQUEUE', reasonCode: 'LEASE_EXPIRED' });
    expect(planJuliusRecovery(base), 'an older caller that never says').toMatchObject({ action: 'REQUEUE' });
  });
  it('a cancelled run still cancels, handed or not', () => {
    expect(planJuliusRecovery({ ...base, runState: 'CANCELLED', handed: true })).toMatchObject({ action: 'CANCEL_TASK', reasonCode: 'RUN_CANCELLED' });
  });
  it('the money fact outranks the exhaustion ceilings', () => {
    expect(planJuliusRecovery({ ...base, attempt: 3, recoveries: 3, handed: true })).toMatchObject({ reasonCode: 'HANDED_OUTCOME_UNKNOWN' });
  });
});

/** A loop over the harness's store under a clock the test drives. No lease renewal, so a lease simply lapses. */
const loopAs = (harness: JuliusHarness, time: FakeTime, owner: string) =>
  new JuliusRunLoop({ ...harness.deps, clock: time.clock, owner }, harness.policies, { claimLimit: 4, leaseMs: LEASE_MS });

/** The coder's first dispatch never answers: the process that made it is gone. Later dispatches are the script's. */
const firstDispatchNeverAnswers = (harness: JuliusHarness): { dispatches: () => number; started: Promise<void> } => {
  const inner = harness.adapters.get(CODER.adapterId)!;
  let dispatches = 0;
  let markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const held: JuliusProviderAdapter = {
    adapterId: CODER.adapterId,
    async dispatch(input) {
      dispatches += 1;
      if (dispatches === 1) { markStarted(); return new Promise(() => undefined); }
      return inner.dispatch(input);
    },
  };
  (harness.adapters as Map<string, JuliusProviderAdapter>).set(CODER.adapterId, held);
  return { dispatches: () => dispatches, started };
};

const recoveryReasons = (harness: JuliusHarness) => harness.store.events()
  .filter((event) => event.type === 'recovery.action')
  .map((event) => `${String(event.facts.action)}:${String(event.facts.reasonCode)}`);

describe('recovery reads whether the lost attempt was handed', () => {
  it('HANDED, then the worker process died: the task ends HANDED_OUTCOME_UNKNOWN and is never dispatched again', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    const provider = firstDispatchNeverAnswers(harness);

    void loopAs(harness, time, 'worker-a').tick(scope); // worker A dies holding the dispatch
    await provider.started;
    expect(harness.store.events().some((event) => event.type === 'worker.dispatched' && event.taskId === 'task-1'), 'the handoff was recorded before it happened').toBe(true);

    await time.advance(LEASE_MS * 3);
    const b = loopAs(harness, time, 'worker-b');
    for (let tick = 0; tick < 3; tick += 1) await b.tick(scope);

    expect(recoveryReasons(harness)).toContain('FAIL_TASK:HANDED_OUTCOME_UNKNOWN');
    expect(harness.store.taskRow('task-1')!.state).toBe('FAILED');
    expect(provider.dispatches(), 'the answer that was paid for is never bought a second time').toBe(1);
    // As the live driver does when a tick claims nothing (`driveJuliusRunToTerminal`).
    await b.advanceRun('run-1', scope.projectId);
    expect((await harness.store.loadRun('run-1', scope.projectId))?.state, 'the run ends on it').toBe('FAILED');
    expect(harness.budget.reservations().some((row) => row.state === 'RESERVED'), 'and the hold on it is kept, even with the run over: unknown, never $0').toBe(true);
  });

  it('CLAIMED BUT NEVER HANDED (the dispatched event never landed): requeued, and dispatched once, by the survivor', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    let dispatches = 0;
    const inner = harness.adapters.get(CODER.adapterId)!;
    (harness.adapters as Map<string, JuliusProviderAdapter>).set(CODER.adapterId, { adapterId: CODER.adapterId, async dispatch(input) { dispatches += 1; return inner.dispatch(input); } });
    // Worker A's write of `worker.dispatched` never returns: it dies before handing anything.
    const store = harness.store as unknown as { appendEvent: (event: { type: string; facts: Record<string, unknown> }) => Promise<unknown> };
    const append = store.appendEvent.bind(store);
    let hung = false;
    let reachedHandoff = (): void => undefined;
    const atHandoff = new Promise<void>((resolve) => { reachedHandoff = resolve; });
    store.appendEvent = async (event) => {
      if (!hung && event.type === 'worker.dispatched') { hung = true; reachedHandoff(); return new Promise(() => undefined); }
      return append(event);
    };

    void loopAs(harness, time, 'worker-a').tick(scope);
    await atHandoff;
    await time.advance(LEASE_MS * 3);
    const b = loopAs(harness, time, 'worker-b');
    for (let tick = 0; tick < 4; tick += 1) await b.tick(scope);

    expect(recoveryReasons(harness)).toContain('REQUEUE:LEASE_EXPIRED');
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(dispatches, 'nothing was handed before, so the survivor\'s is the only provider call').toBe(1);
  });
});

describe('one task\'s throw no longer abandons its tick', () => {
  /** Three runs, one task each, so C.A.R.D.\'s per-run concurrency admits all three in one tick. */
  const threeRuns = () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    for (const id of ['a', 'b', 'c']) seedRun(harness, { runId: `run-${id}`, tasks: [task({ taskId: `${id}-task` })] });
    return harness;
  };
  const failAppendsFor = (harness: JuliusHarness, taskId: string, types: readonly string[]) => {
    const store = harness.store as unknown as { appendEvent: (event: { type: string; taskId: string | null }) => Promise<unknown> };
    const append = store.appendEvent.bind(store);
    store.appendEvent = async (event) => {
      if (event.taskId === taskId && types.includes(event.type)) throw pg('08006');
      return append(event);
    };
  };

  it('NOT HANDED: a store outage before the dispatch sends that task straight back, and the tick runs the others', async () => {
    const harness = threeRuns();
    // The first write of b's attempt and its ending both fail, so nothing was spent and nothing could be recorded.
    failAppendsFor(harness, 'b-task', ['worker.selected', 'retry.scheduled', 'task.failed']);
    const report = await harness.loop.tick(scope);

    expect(report.persistenceUnavailable).toEqual([expect.objectContaining({ taskId: 'b-task', handed: false, phase: 'persist_before_dispatch', storeErrorClass: 'connection' })]);
    expect(harness.store.taskRow('b-task')!.state, 'handed back at once, not left to its lease').toBe('RUNNABLE');
    expect(harness.store.taskRow('a-task')!.state).not.toBe('ACTIVE');
    expect(harness.store.taskRow('c-task')!.state, 'the task after it still ran').not.toBe('ACTIVE');
  });

  it('HANDED: a store outage after a paid answer leaves that task to recovery, and the tick runs the others', async () => {
    const harness = threeRuns();
    const store = harness.store as unknown as { acceptWorkerResult: (input: { taskId: string }) => Promise<unknown> };
    const accept = store.acceptWorkerResult.bind(store);
    store.acceptWorkerResult = async (input) => { if (input.taskId === 'b-task') throw pg('08006'); return accept(input); };
    failAppendsFor(harness, 'b-task', ['task.failed', 'retry.scheduled']);
    const report = await harness.loop.tick(scope);

    expect(report.persistenceUnavailable).toEqual([expect.objectContaining({ taskId: 'b-task', handed: true, phase: 'persist_after_answer' })]);
    expect(harness.store.taskRow('b-task')!.state, 'it may have been paid for: never handed back for a second dispatch').toBe('ACTIVE');
    expect(harness.store.taskRow('c-task')!.state, 'the task after it still ran').not.toBe('ACTIVE');
  });

  it('NOT HANDED, AT THE CEILING: the last attempt is left to its lease, and the sweep ends the task with its row', async () => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    failAppendsFor(harness, 'task-1', ['worker.selected', 'retry.scheduled', 'task.failed']);
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    const loop = loopAs(harness, time, 'worker-a');
    const ceiling = taskAttemptCeiling('build');
    // Admission spends an attempt, so a store that keeps failing cannot cycle the task forever.
    for (let attempt = 1; attempt < ceiling; attempt += 1) {
      await loop.tick(scope);
      expect(harness.store.taskRow('task-1'), `attempt ${attempt} goes straight back`).toMatchObject({ state: 'RUNNABLE', attempt });
    }
    const last = await loop.tick(scope);
    expect(last.persistenceUnavailable).toEqual([expect.objectContaining({ taskId: 'task-1', handed: false })]);
    expect(harness.store.taskRow('task-1'), 'the last is left to its lease').toMatchObject({ state: 'ACTIVE', attempt: ceiling });

    await time.advance(LEASE_MS * 3);
    await loop.tick(scope);
    expect(recoveryReasons(harness), 'ended by the sweep, which writes why').toEqual(['FAIL_TASK:RETRIES_EXHAUSTED']);
    expect(harness.store.taskRow('task-1')!.state).toBe('FAILED');
  }, 30_000);

  it('A DEFECT still propagates, but only after the claims nobody started are handed back', async () => {
    const harness = threeRuns();
    const resources = harness.deps.resources as { estimate: (task: { taskId: string }) => unknown };
    const estimate = resources.estimate.bind(resources);
    resources.estimate = (input) => { if (input.taskId === 'b-task') throw new Error('estimator defect'); return estimate(input); };

    await expect(harness.loop.tick(scope)).rejects.toThrow('estimator defect');
    expect(harness.store.taskRow('a-task')!.state, 'the task before it ran').not.toBe('ACTIVE');
    expect(harness.store.taskRow('b-task')!.state, 'the defective one is left to its lease and the sweep').toBe('ACTIVE');
    expect(harness.store.taskRow('c-task'), 'the one after it is back at once, with no attempt spent').toMatchObject({ state: 'RUNNABLE', attempt: 0 });
  });
});

describe('the in-memory store reads handed exactly as the SQL does', () => {
  /** Claimed and admitted by a worker that then vanished; its lease has lapsed by the time the sweep runs. */
  const lapsed = async (dispatchedOnAttempt: number | null) => {
    const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [] }] });
    seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
    const time = createFakeTime('2026-09-29T12:00:00.000Z');
    const [claim] = await harness.store.claimRunnable({ owner: 'dead', now: time.clock.now(), leaseExpiresAt: new Date(time.nowMs() + LEASE_MS).toISOString(), limit: 1, projectId: scope.projectId });
    expect(await harness.store.admitTask({ taskId: 'task-1', owner: 'dead', leaseGeneration: claim!.leaseGeneration, now: time.clock.now() })).toBe(1);
    if (dispatchedOnAttempt !== null) {
      await harness.store.appendEvent({
        eventId: `event:dispatched:${String(dispatchedOnAttempt)}`, runId: 'run-1', projectId: scope.projectId, type: 'worker.dispatched',
        taskId: 'task-1', workerId: null, correlationId: 'task-1', causationId: null, occurredAt: time.clock.now(),
        facts: { workerId: 'coder', attempt: dispatchedOnAttempt, runId: 'run-1' },
      });
    }
    await time.advance(LEASE_MS * 3);
    return (await harness.store.recoverExpired(time.clock.now(), 10, scope.projectId)).map((action) => `${action.action}:${action.reasonCode}`);
  };

  it('a record for the attempt the task is on: handed', async () => {
    expect(await lapsed(1)).toEqual(['FAIL_TASK:HANDED_OUTCOME_UNKNOWN']);
  });
  it('no record, or one for another attempt: not handed, and requeued', async () => {
    expect(await lapsed(null)).toEqual(['REQUEUE:LEASE_EXPIRED']);
    expect(await lapsed(0), 'an old record does not make this attempt handed').toEqual(['REQUEUE:LEASE_EXPIRED']);
  });
});

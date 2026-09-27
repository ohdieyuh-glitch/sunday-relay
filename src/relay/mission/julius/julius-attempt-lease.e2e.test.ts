import { describe, expect, it } from 'vitest';

import { JuliusDispatchError, type JuliusProviderAdapter } from './julius-router';
import { JuliusRunLoop } from './julius-run-loop';
import { juliusLeaseHoldBoundMs, type JuliusLeaseRenewalPolicy } from './julius-lease-keeper';
import { createFakeTime, createJuliusHarness, seedRun, task, worker, type FakeTime, type JuliusHarness } from './julius-runtime-fixtures';

/**
 * CODING AGENT ATTEMPT TRUTH — THE LEASE UNDER A REAL RUN LOOP.
 *
 * The in-memory store, two run loops as two workers, one fake clock and fake
 * timers. Nothing waits on the wall clock.
 *
 *   A legitimate attempt longer than its lease keeps the lease: another worker's
 *   sweep finds nothing to reclaim, and the attempt completes as the one that ran.
 *
 *   A stale worker cannot continue: once another worker has reclaimed the task,
 *   the stale worker's next renewal is refused, its dispatch is aborted, and
 *   nothing it held becomes evidence, a result or a requeue.
 *
 *   A worker stuck past its hold bound is stopped, and never renews past it.
 */

const CODER = worker({ workerId: 'coder', role: 'CODING_AGENT', capabilities: ['implement'], taskTypes: ['build'], timeoutMs: 30_000 });
const scope = { projectId: 'prj-1' };
const LEASE_MS = 1_000;

interface Gate { readonly started: Promise<void>; release(): void; readonly aborted: () => string | null }

/**
 * The scripted coder, with its first dispatch held open like a long session.
 * It honours its signal, as a real provider now must; `deaf` makes it ignore it.
 */
const holdFirstDispatch = (harness: JuliusHarness, options: { deaf?: boolean; failWith?: () => Error } = {}): Gate => {
  const inner = harness.adapters.get(CODER.adapterId)!;
  let dispatches = 0;
  let markStarted = (): void => undefined;
  let release = (): void => undefined;
  let abortReason: string | null = null;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const held: JuliusProviderAdapter = {
    adapterId: CODER.adapterId,
    async dispatch(input) {
      dispatches += 1;
      if (dispatches === 1) {
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          input.signal?.addEventListener('abort', () => {
            abortReason = String(input.signal!.reason);
            if (options.deaf !== true) reject(new JuliusDispatchError('CANCELLED', false, 'The held session stopped.', 'fixture_cancelled'));
          }, { once: true });
          markStarted();
        });
        if (options.failWith !== undefined) throw options.failWith();
      }
      return inner.dispatch(input);
    },
  };
  (harness.adapters as Map<string, JuliusProviderAdapter>).set(CODER.adapterId, held);
  return { started, release: () => release(), aborted: () => abortReason };
};

const loopAs = (harness: JuliusHarness, time: FakeTime, owner: string, renewal: JuliusLeaseRenewalPolicy | null, timers = time.timers) =>
  new JuliusRunLoop(
    { ...harness.deps, clock: time.clock, owner },
    harness.policies,
    {
      claimLimit: 4, leaseMs: LEASE_MS,
      ...(renewal === null ? {} : { leaseRenewal: { ...renewal, timers } }),
    },
  );

const renewal = (holdMs = 60_000): JuliusLeaseRenewalPolicy => ({
  renewEveryMs: 250,
  holdBoundMsFor: () => holdMs,
});

const setup = () => {
  const harness = createJuliusHarness({ workers: [{ worker: CODER, script: [{ kind: 'succeed' }] }] });
  seedRun(harness, { tasks: [task({ taskId: 'task-1' })] });
  const time = createFakeTime('2026-09-17T12:00:00.000Z');
  return { harness, time };
};

/** Timers another worker owns: they fire only when that worker is running. */
const pausedTimers = (time: FakeTime) => {
  const due: { at: number; callback: () => void }[] = [];
  return {
    timers: {
      setTimeout(callback: () => void, ms: number) { const entry = { at: time.nowMs() + ms, callback }; due.push(entry); return entry; },
      clearTimeout(handle: unknown) { const index = due.indexOf(handle as never); if (index >= 0) due.splice(index, 1); },
    },
    async resume() {
      for (let guard = 0; guard < 50; guard += 1) {
        const ready = due.filter((entry) => entry.at <= time.nowMs());
        if (ready.length === 0) break;
        for (const entry of ready) { due.splice(due.indexOf(entry), 1); entry.callback(); }
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
      }
    },
  };
};

describe('a legitimate attempt longer than its lease keeps it', () => {
  it('renewal keeps the lease ahead of the clock for five leases, another worker reclaims nothing, and the attempt completes', async () => {
    const { harness, time } = setup();
    const gate = holdFirstDispatch(harness);
    const a = loopAs(harness, time, 'worker-a', renewal());
    const b = loopAs(harness, time, 'worker-b', null);

    const ticking = a.tick(scope);
    await gate.started;
    for (let step = 0; step < 20; step += 1) {
      await time.advance(250);
      const row = harness.store.taskRow('task-1')!;
      expect(row.state).toBe('ACTIVE');
      expect(Date.parse(row.leaseExpiresAt!), `lease lapsed at ${time.clock.now()}`).toBeGreaterThan(time.nowMs());
    }
    const other = await b.tick(scope);
    expect(other.claimed).toBe(0);
    expect(harness.store.events().filter((event) => event.type === 'recovery.action')).toHaveLength(0);

    gate.release();
    const report = await ticking;
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(['COMPLETED']);
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(harness.adapters.get(CODER.adapterId)).toBeDefined();
    expect(gate.aborted()).toBeNull();
  });

  it('WITHOUT renewal the same attempt outlives its lease and is reclaimed under it — the defect', async () => {
    const { harness, time } = setup();
    const gate = holdFirstDispatch(harness);
    const a = loopAs(harness, time, 'worker-a', null);
    const ticking = a.tick(scope);
    await gate.started;
    await time.advance(5_000);
    expect(Date.parse(harness.store.taskRow('task-1')!.leaseExpiresAt!)).toBeLessThan(time.nowMs());
    const swept = await harness.store.recoverExpired(time.clock.now(), 10, 'prj-1');
    expect(swept.map((action) => action.action)).toEqual(['REQUEUE']);
    gate.release();
    await ticking;
  });

  it('the first renewal lands at admission, before the provider is dispatched', async () => {
    const { harness, time } = setup();
    const order: string[] = [];
    const heartbeat = harness.store.heartbeat.bind(harness.store);
    (harness.store as { heartbeat: typeof heartbeat }).heartbeat = async (input) => { order.push('renew'); return heartbeat(input); };
    const gate = holdFirstDispatch(harness);
    void gate.started.then(() => order.push('dispatch'));
    const a = loopAs(harness, time, 'worker-a', renewal());
    const ticking = a.tick(scope);
    await gate.started;
    await Promise.resolve();
    expect(order.slice(0, 2)).toEqual(['renew', 'dispatch']);
    gate.release();
    await ticking;
  });

  it('a renewal refused at admission runs nothing and spends no dispatch', async () => {
    const { harness, time } = setup();
    (harness.store as { heartbeat: unknown }).heartbeat = async () => false;
    const a = loopAs(harness, time, 'worker-a', renewal());
    const report = await a.tick(scope);
    expect(report.lostLeases).toBe(1);
    expect(report.outcomes).toHaveLength(0);
    expect(harness.adapters.get(CODER.adapterId)!.dispatches).toHaveLength(0);
  });
});

describe('a stale worker cannot continue', () => {
  const reclaimUnderPausedWorker = async (options: { deaf?: boolean } = {}) => {
    const { harness, time } = setup();
    const gate = holdFirstDispatch(harness, options);
    const paused = pausedTimers(time);
    const a = loopAs(harness, time, 'worker-a', renewal(), paused.timers);
    const b = loopAs(harness, time, 'worker-b', renewal());

    const stale = a.tick(scope);
    await gate.started;
    const staleGeneration = harness.store.taskRow('task-1')!.leaseGeneration;
    // Worker A stops running — its timers do not fire — and its lease lapses.
    await time.advance(5_000);
    const fresh = await b.tick(scope);
    expect(fresh.outcomes.map((outcome) => outcome.kind)).toEqual(['COMPLETED']);
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    const evidenceBefore = (await harness.store.evidenceForRun('run-1', 'prj-1')).length;
    const resultsBefore = harness.store.results().length;

    // Worker A runs again. Its renewal is refused, and its dispatch is aborted.
    await paused.resume();
    if (options.deaf === true) gate.release();
    const report = await stale;
    return { harness, gate, report, staleGeneration, evidenceBefore, resultsBefore };
  };

  it('its renewal is refused, its dispatch is aborted lease_lost, and it writes no evidence, no result and no requeue', async () => {
    const { harness, gate, report, staleGeneration, evidenceBefore, resultsBefore } = await reclaimUnderPausedWorker();
    expect(gate.aborted()).toBe('lease_lost');
    expect(report.outcomes).toEqual([{ kind: 'FAILED', taskId: 'task-1', code: 'CANCELLED', failureClass: 'lease_lost' }]);
    // The task is the fresh worker's, finished; nothing of the stale one's became state.
    const row = harness.store.taskRow('task-1')!;
    expect(row.state).toBe('SUCCEEDED');
    expect(row.leaseGeneration).toBeGreaterThan(staleGeneration);
    expect((await harness.store.evidenceForRun('run-1', 'prj-1')).length).toBe(evidenceBefore);
    expect(harness.store.results().length).toBe(resultsBefore);
    const staleFailure = harness.store.events().filter((event) => event.type === 'task.failed');
    expect(staleFailure).toHaveLength(1);
    expect(staleFailure[0]!.facts).toMatchObject({ code: 'CANCELLED', failureClass: 'lease_lost' });
  });

  it('a stale worker whose provider ignores the abort is still ended at once, and its late answer changes nothing', async () => {
    const { harness, gate, report, evidenceBefore, resultsBefore } = await reclaimUnderPausedWorker({ deaf: true });
    expect(gate.aborted()).toBe('lease_lost');
    expect(report.outcomes).toEqual([{ kind: 'FAILED', taskId: 'task-1', code: 'CANCELLED', failureClass: 'lease_lost' }]);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect((await harness.store.evidenceForRun('run-1', 'prj-1')).length).toBe(evidenceBefore);
    expect(harness.store.results().length).toBe(resultsBefore);
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
  });

  it('a worker stuck past its hold bound is stopped, and its lease is never renewed past the bound', async () => {
    const { harness, time } = setup();
    const expiries: string[] = [];
    const heartbeat = harness.store.heartbeat.bind(harness.store);
    (harness.store as { heartbeat: typeof heartbeat }).heartbeat = async (input) => { expiries.push(input.leaseExpiresAt); return heartbeat(input); };
    const gate = holdFirstDispatch(harness);
    const admittedAt = time.nowMs();
    const a = loopAs(harness, time, 'worker-a', renewal(3_000));
    const ticking = a.tick(scope);
    await gate.started;
    await time.advance(10_000);
    const report = await ticking;
    expect(gate.aborted()).toBe('lease_hold_exhausted');
    expect(report.outcomes).toEqual([{ kind: 'FAILED', taskId: 'task-1', code: 'CANCELLED', failureClass: 'lease_hold_exhausted' }]);
    expect(expiries.length).toBeGreaterThan(1);
    for (const expiry of expiries) expect(Date.parse(expiry)).toBeLessThanOrEqual(admittedAt + 3_000);
    // A stopped attempt left no evidence.
    expect(await harness.store.evidenceForRun('run-1', 'prj-1')).toHaveLength(0);
  });
});

describe('the keeper belongs to the attempt, and the loop refuses a renewal that could not keep a lease', () => {
  it('renewal stops when the task is finished: nothing renews a lease the attempt no longer holds', async () => {
    const { harness, time } = setup();
    let renewals = 0;
    const heartbeat = harness.store.heartbeat.bind(harness.store);
    (harness.store as { heartbeat: typeof heartbeat }).heartbeat = async (input) => { renewals += 1; return heartbeat(input); };
    const gate = holdFirstDispatch(harness);
    const a = loopAs(harness, time, 'worker-a', renewal());
    const ticking = a.tick(scope);
    await gate.started;
    await time.advance(1_000);
    gate.release();
    const report = await ticking;
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(['COMPLETED']);
    const atFinish = renewals;
    expect(atFinish).toBeGreaterThan(1);
    await time.advance(10_000);
    expect(renewals, 'a renewal ran after the attempt was finished').toBe(atFinish);
  });

  it('a run loop refuses a renewal interval that is not shorter than its lease', () => {
    const { harness } = setup();
    for (const renewEveryMs of [LEASE_MS, LEASE_MS * 2, 0, 1.5]) {
      expect(() => new JuliusRunLoop(harness.deps, harness.policies, {
        claimLimit: 4, leaseMs: LEASE_MS, leaseRenewal: { renewEveryMs, holdBoundMsFor: () => 60_000 },
      })).toThrow('invalid_julius_lease_renewal_interval');
    }
  });
});

describe('a requeue is recorded only when the store took it', () => {
  it('a retryable failure from a worker whose lease was reclaimed is not a RETRY: the task belongs to another worker now', async () => {
    const { harness, time } = setup();
    const gate = holdFirstDispatch(harness, {
      failWith: () => new JuliusDispatchError('RATE_LIMIT', true, 'The provider rate limited the stale session.', 'fixture_rate_limited'),
    });
    // No renewal on either worker: main's behaviour, where the lease simply lapses.
    const a = loopAs(harness, time, 'worker-a', null);
    const b = loopAs(harness, time, 'worker-b', null);
    const stale = a.tick(scope);
    await gate.started;
    await time.advance(5_000);
    const fresh = await b.tick(scope);
    expect(fresh.outcomes.map((outcome) => outcome.kind)).toEqual(['COMPLETED']);

    gate.release();
    const report = await stale;
    expect(report.outcomes.map((outcome) => outcome.kind)).toEqual(['FAILED']);
    expect(harness.store.taskRow('task-1')!.state).toBe('SUCCEEDED');
    expect(harness.store.trajectory().filter((event) => event.kind === 'RETRY'), 'no RETRY row for a requeue the store refused').toHaveLength(0);
  });
});

describe('the live bound is derived from the registered workers', () => {
  it('a coder task holds for the coder\'s deadline plus settlement, never a reviewer\'s', () => {
    const reviewer = worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', timeoutMs: 900_000 });
    expect(juliusLeaseHoldBoundMs([CODER, reviewer], { role: 'CODING_AGENT' }, 600_000)).toBe(630_000);
  });
});

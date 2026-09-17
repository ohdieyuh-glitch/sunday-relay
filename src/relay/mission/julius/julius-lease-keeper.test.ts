import { describe, expect, it } from 'vitest';

import {
  JULIUS_LEASE_LOSS_REASONS,
  juliusEitherSignal,
  juliusLeaseHoldBoundMs,
  juliusLeaseMsFor,
  keepJuliusLease,
} from './julius-lease-keeper';
import { createFakeTime, type FakeTime } from './julius-runtime-fixtures';

/**
 * THE LEASE KEEPER, ON A FAKE CLOCK.
 *
 * Time is a number the test moves; timers fire only when the test says so. No
 * proof here waits on the wall clock, which is the only way "a legitimate long
 * attempt never expires" and "a stale worker cannot hold forever" can both be
 * shown in milliseconds.
 */

interface Beat { readonly now: string; readonly leaseExpiresAt: string }

const recordingStore = (answer: (beat: Beat, index: number) => boolean | Error = () => true) => {
  const beats: Beat[] = [];
  return {
    beats,
    store: {
      async heartbeat(input: { taskId: string; owner: string; leaseGeneration: number; now: string; leaseExpiresAt: string }) {
        const beat = { now: input.now, leaseExpiresAt: input.leaseExpiresAt };
        beats.push(beat);
        const outcome = answer(beat, beats.length - 1);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
  };
};

const keeper = (time: FakeTime, store: { heartbeat: (input: never) => Promise<boolean> }, over: { leaseMs?: number; renewEveryMs?: number; holdMs?: number } = {}) =>
  keepJuliusLease({
    store: store as never, clock: time.clock, timers: time.timers,
    taskId: 'task-1', owner: 'worker-a', leaseGeneration: 3,
    leaseMs: over.leaseMs ?? 1_000, renewEveryMs: over.renewEveryMs ?? 250,
    holdUntilMs: time.nowMs() + (over.holdMs ?? 60_000),
  });

describe('a legitimate long attempt never expires', () => {
  it('renews from the start, well inside the lease, for as long as the work runs', async () => {
    const time = createFakeTime();
    const { beats, store } = recordingStore();
    const lease = keeper(time, store);
    expect(await lease.renewNow()).toBe(true);
    // Twenty leases' worth of work.
    for (let step = 0; step < 80; step += 1) {
      await time.advance(250);
      const last = beats[beats.length - 1]!;
      expect(Date.parse(last.leaseExpiresAt), `the lease lapsed at ${time.clock.now()}`).toBeGreaterThan(time.nowMs());
    }
    expect(lease.renewals()).toBe(81);
    expect(lease.signal.aborted).toBe(false);
    for (const beat of beats) expect(Date.parse(beat.leaseExpiresAt) - Date.parse(beat.now)).toBe(1_000);
    await lease.stop();
  });

  it('one renewal chain, however often it is asked to renew now', async () => {
    const time = createFakeTime();
    const { beats, store } = recordingStore();
    const lease = keeper(time, store);
    await lease.renewNow();
    await lease.renewNow();
    await lease.renewNow();
    const before = beats.length;
    await time.advance(1_000);
    expect(beats.length - before).toBe(4);
    await lease.stop();
  });

  it('a store that did not answer has not refused: one failed renewal inside the lease is carried', async () => {
    const time = createFakeTime();
    const { beats, store } = recordingStore((_beat, index) => (index === 2 ? new Error('connection reset') : true));
    const lease = keeper(time, store);
    await lease.renewNow();
    await time.advance(2_000);
    expect(lease.signal.aborted).toBe(false);
    expect(beats.length).toBe(9);
    await lease.stop();
  });

  it('stopping waits for a renewal in flight, and nothing renews after it', async () => {
    const time = createFakeTime();
    let releaseBeat = (): void => undefined;
    const beats: string[] = [];
    const store = {
      async heartbeat(input: { now: string }) {
        beats.push(input.now);
        if (beats.length === 2) await new Promise<void>((resolve) => { releaseBeat = resolve; });
        return true;
      },
    };
    const lease = keeper(time, store as never);
    await lease.renewNow();
    await time.advance(250);
    let stopped = false;
    const stopping = lease.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseBeat();
    await stopping;
    await time.advance(5_000);
    expect(beats).toHaveLength(2);
    expect(lease.signal.aborted).toBe(false);
  });
});

describe('a stale worker cannot continue indefinitely', () => {
  it('never sets an expiry past the hold bound, and aborts the work when the bound is reached', async () => {
    const time = createFakeTime();
    const start = time.nowMs();
    const { beats, store } = recordingStore();
    const lease = keeper(time, store, { holdMs: 1_600 });
    await lease.renewNow();
    await time.advance(5_000);
    for (const beat of beats) expect(Date.parse(beat.leaseExpiresAt)).toBeLessThanOrEqual(start + 1_600);
    expect(Date.parse(beats[beats.length - 1]!.leaseExpiresAt)).toBe(start + 1_600);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.signal.reason).toBe('lease_hold_exhausted');
    const after = beats.length;
    await time.advance(5_000);
    expect(beats.length).toBe(after);
  });

  it('a renewal the store refuses aborts at once: the lease is already someone else\'s', async () => {
    const time = createFakeTime();
    const { beats, store } = recordingStore((_beat, index) => index < 3);
    const lease = keeper(time, store);
    await lease.renewNow();
    await time.advance(250);
    await time.advance(250);
    expect(lease.signal.aborted).toBe(false);
    await time.advance(250);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.signal.reason).toBe('lease_lost');
    await time.advance(10_000);
    expect(beats).toHaveLength(4);
  });

  it('refused at the very first renewal, the work is refused before it starts', async () => {
    const time = createFakeTime();
    const { store } = recordingStore(() => false);
    const lease = keeper(time, store);
    expect(await lease.renewNow()).toBe(false);
    expect(lease.signal.reason).toBe('lease_lost');
  });

  it('renewals that keep failing abort before the last confirmed expiry passes', async () => {
    const time = createFakeTime();
    const start = time.nowMs();
    const { store } = recordingStore((_beat, index) => (index === 0 ? true : new Error('database unavailable')));
    const lease = keeper(time, store);
    let abortedAt: number | null = null;
    lease.signal.addEventListener('abort', () => { abortedAt = time.nowMs(); });
    await lease.renewNow();
    await time.advance(2_000);
    expect(lease.signal.aborted).toBe(true);
    expect(lease.signal.reason).toBe('lease_renewal_failed');
    // Aborted while the lease the store last confirmed (start + 1 000) was still in force, and not at the first miss.
    expect(abortedAt).not.toBeNull();
    expect(abortedAt!).toBeLessThan(start + 1_000);
    expect(abortedAt!).toBeGreaterThan(start + 250);
  });

  it('a store that never answered the first renewal holds nothing to carry', async () => {
    const time = createFakeTime();
    const { store } = recordingStore(() => new Error('database unavailable'));
    const lease = keeper(time, store);
    expect(await lease.renewNow()).toBe(false);
    expect(lease.signal.reason).toBe('lease_renewal_failed');
  });

  it('refuses a renewal interval that is not shorter than the lease', () => {
    const time = createFakeTime();
    const { store } = recordingStore();
    for (const renewEveryMs of [0, -1, 1_000, 1_500, 2.5]) {
      expect(() => keeper(time, store, { renewEveryMs })).toThrow('invalid_julius_lease_renewal_interval');
    }
    expect(JULIUS_LEASE_LOSS_REASONS).toEqual(['lease_lost', 'lease_hold_exhausted', 'lease_renewal_failed']);
  });
});

describe('the lease and the hold follow the workers', () => {
  const workers = [
    { role: 'PROMPT_ARCHITECT', timeoutMs: 300_000 },
    { role: 'CODING_AGENT', timeoutMs: 1_169_386 },
    { role: 'INDEPENDENT_REVIEWER', timeoutMs: 792_000 },
    { role: 'INDEPENDENT_REVIEWER', timeoutMs: 100_000 },
  ];

  it('the lease outlives the longest declared dispatch plus its settlement', () => {
    expect(juliusLeaseMsFor(workers, 600_000)).toBe(1_769_386);
    expect(juliusLeaseMsFor([], 600_000)).toBe(600_000);
  });

  it('the hold covers every worker of the role in turn, plus settlement, and nothing of another role', () => {
    expect(juliusLeaseHoldBoundMs(workers, { role: 'CODING_AGENT' }, 600_000)).toBe(1_769_386);
    expect(juliusLeaseHoldBoundMs(workers, { role: 'INDEPENDENT_REVIEWER' }, 600_000)).toBe(1_492_000);
    expect(juliusLeaseHoldBoundMs(workers, { role: 'SOMEONE_ELSE' }, 600_000)).toBe(600_000);
  });
});

describe('either signal ends the dispatch, with the reason of the one that fired', () => {
  it('carries the first reason, ignores the second, and detaches', () => {
    const loop = new AbortController();
    const lease = new AbortController();
    const either = juliusEitherSignal(loop.signal, lease.signal);
    lease.abort('lease_lost');
    loop.abort('operator_stop');
    expect(either.signal.aborted).toBe(true);
    expect(either.signal.reason).toBe('lease_lost');
    either.detach();
  });

  it('is already aborted when either input already was', () => {
    const loop = new AbortController();
    loop.abort('operator_stop');
    expect(juliusEitherSignal(loop.signal, new AbortController().signal).signal.reason).toBe('operator_stop');
    const lease = new AbortController();
    lease.abort('lease_lost');
    expect(juliusEitherSignal(new AbortController().signal, lease.signal).signal.reason).toBe('lease_lost');
  });

  it('with no loop signal, the lease\'s own signal is used', () => {
    const lease = new AbortController();
    expect(juliusEitherSignal(undefined, lease.signal).signal).toBe(lease.signal);
  });
});

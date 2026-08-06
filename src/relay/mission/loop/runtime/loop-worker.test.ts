import { describe, expect, it } from 'vitest';

import { runLoopWorkerPass, type LoopWorkerPorts, type LoopSkipReason } from './loop-worker';
import type { LoopEngineContext, LoopEngineOutcome } from './loop-iteration-engine';

/**
 * THE DURABLE BACKGROUND WORKER.
 *
 * A run's journal, snapshot and lock already survive a restart; what was
 * missing was anything that PICKS THE RUN UP. Every defect a worker can add is
 * a CLAIM defect — double-claiming paid work, guessing at an unreadable lock,
 * skipping silently, or releasing before the work is durable — so that is what
 * these tests hold, at the worker's own seam. The engine's iterations are the
 * engine's suite's problem.
 */

const AT = (s: number) => new Date(Date.parse('2026-08-06T09:00:00.000Z') + s * 1000).toISOString();

type LockStatus = 'free' | 'held_by_live_owner' | 'stale_owner_dead' | 'unreadable';

interface RunSpec {
  lock: LockStatus;
  context?: 'ok' | 'missing' | 'throws';
  advance?: 'ok' | 'throws';
  acquireWins?: boolean;
}

function harness(runs: Record<string, RunSpec>) {
  const events: string[] = [];
  let clock = 0;
  const ports: LoopWorkerPorts = {
    async discoverRunnable() { return Object.keys(runs); },
    async inspectRunLock(runId) { return { status: runs[runId].lock }; },
    async acquireRunLock(runId) {
      if (runs[runId].acquireWins === false) return null;
      events.push(`acquire:${runId}`);
      return { async release() { events.push(`release:${runId}`); } };
    },
    async contextFor(runId) {
      const mode = runs[runId].context ?? 'ok';
      if (mode === 'missing') return null;
      if (mode === 'throws') throw new Error(`context exploded for ${runId}`);
      return { runId } as unknown as LoopEngineContext;
    },
    async advance(context) {
      const runId = (context as unknown as { runId: string }).runId;
      if (runs[runId].advance === 'throws') throw new Error(`engine exploded for ${runId}`);
      events.push(`advance:${runId}`);
      return { kind: 'terminal', run: { runId } as never, state: 'succeeded' } as unknown as LoopEngineOutcome;
    },
    now: () => AT(clock += 1),
  };
  return { ports, events };
}

const skipsOf = (pass: { attempts: readonly { runId: string; skipped?: LoopSkipReason }[] }) =>
  Object.fromEntries(pass.attempts.filter((a) => a.skipped).map((a) => [a.runId, a.skipped]));

describe('the worker never claims work somebody else may be doing', () => {
  it('skips a live owner, an unreadable lock, and a lost race — each named', async () => {
    const { ports, events } = harness({
      live: { lock: 'held_by_live_owner' },
      corrupt: { lock: 'unreadable' },
      raced: { lock: 'free', acquireWins: false },
      mine: { lock: 'free' },
    });
    const pass = await runLoopWorkerPass(ports, { maxRuns: 10, maxIterationsPerRun: 3 });

    expect(skipsOf(pass)).toEqual({
      live: 'held_by_live_owner',
      corrupt: 'lock_unreadable',
      raced: 'lock_acquisition_failed',
    });
    expect(pass.advanced).toBe(1);
    // Nothing was acquired for the skipped runs: an unreadable lock might be a
    // live owner mid-write, and guessing costs a double dispatch of PAID work.
    expect(events.filter((e) => e.startsWith('acquire:'))).toEqual(['acquire:mine']);
  });

  it('a stale dead owner IS claimable — that is the whole point of a worker', async () => {
    const { ports } = harness({ orphaned: { lock: 'stale_owner_dead' } });
    const pass = await runLoopWorkerPass(ports, { maxRuns: 1, maxIterationsPerRun: 1 });
    expect(pass.advanced).toBe(1);
  });
});

describe('every run it looked at appears in the report', () => {
  it('a pass that hit capacity says so, and names what it left', async () => {
    const { ports } = harness({
      a: { lock: 'free' }, b: { lock: 'free' }, c: { lock: 'free' },
    });
    const pass = await runLoopWorkerPass(ports, { maxRuns: 2, maxIterationsPerRun: 1 });
    expect(pass.advanced).toBe(2);
    expect(pass.capacityReached).toBe(true);
    // The leftover is REPORTED, not dropped: a pass that stopped early is a
    // different fact from one that finished the work, and a caller that cannot
    // tell them apart cannot tell a busy system from a finished one.
    expect(skipsOf(pass).c).toBe('pass_capacity_reached');
  });

  it('a pass that ran out of work does not claim it hit capacity', async () => {
    const { ports } = harness({ a: { lock: 'free' } });
    const pass = await runLoopWorkerPass(ports, { maxRuns: 5, maxIterationsPerRun: 1 });
    expect(pass.capacityReached).toBe(false);
  });
});

describe('one bad run must not stop the others', () => {
  it('continues past a context failure and an engine explosion, reporting both', async () => {
    const { ports, events } = harness({
      broken: { lock: 'free', context: 'throws' },
      exploding: { lock: 'free', advance: 'throws' },
      fine: { lock: 'free' },
    });
    const pass = await runLoopWorkerPass(ports, { maxRuns: 10, maxIterationsPerRun: 1 });
    expect(pass.advanced).toBe(1);
    const details = Object.fromEntries(
      pass.attempts.filter((a) => a.detail).map((a) => [a.runId, a.detail]),
    );
    expect(details.broken).toContain('context exploded');
    expect(details.exploding).toContain('engine exploded');
    expect(events).toContain('advance:fine');
  });

  it('releases the lock even when the run throws — and only after the work', async () => {
    const { ports, events } = harness({
      exploding: { lock: 'free', advance: 'throws' },
      fine: { lock: 'free' },
    });
    await runLoopWorkerPass(ports, { maxRuns: 10, maxIterationsPerRun: 1 });
    // Both locks released, each after its own work concluded.
    expect(events.filter((e) => e.startsWith('release:')).sort())
      .toEqual(['release:exploding', 'release:fine']);
    // Ordering within one run: advance strictly before release. A crash between
    // them leaves a stale lock and a complete journal, which recovery reads;
    // the other order leaves a claimable run whose last iteration is gone.
    expect(events.indexOf('advance:fine')).toBeLessThan(events.indexOf('release:fine'));
  });

  it('a run whose context cannot be rebuilt is skipped with its name on it', async () => {
    const { ports } = harness({ ghost: { lock: 'free', context: 'missing' } });
    const pass = await runLoopWorkerPass(ports, { maxRuns: 1, maxIterationsPerRun: 1 });
    expect(skipsOf(pass).ghost).toBe('no_context');
    expect(pass.advanced).toBe(0);
  });
});

describe('the pass is honest about time and count', () => {
  it('reports start, finish and totals from the injected clock', async () => {
    const { ports } = harness({ a: { lock: 'free' }, b: { lock: 'held_by_live_owner' } });
    const pass = await runLoopWorkerPass(ports, { maxRuns: 5, maxIterationsPerRun: 1 });
    expect(Date.parse(pass.finishedAt)).toBeGreaterThan(Date.parse(pass.startedAt));
    expect(pass.advanced + pass.skipped).toBe(pass.attempts.length);
  });

  it('an empty discovery is an empty pass, not an error', async () => {
    const { ports } = harness({});
    const pass = await runLoopWorkerPass(ports, { maxRuns: 5, maxIterationsPerRun: 1 });
    expect(pass.attempts).toEqual([]);
    expect(pass.advanced).toBe(0);
    expect(pass.capacityReached).toBe(false);
  });
});

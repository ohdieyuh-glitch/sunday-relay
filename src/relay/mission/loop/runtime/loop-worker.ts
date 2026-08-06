/**
 * SUNDAY RELAY — THE DURABLE BACKGROUND WORKER
 *
 * A Loop run survives a restart today: its journal, snapshot and lock are all
 * on disk. What has been missing is anything that PICKS IT UP. Until now a run
 * only advanced while someone watched it, which makes "durable" a property of
 * the storage and not of the work.
 *
 * This claims a run, advances it under its lock, and releases. It is
 * deliberately not a scheduler, not a queue and not a daemon: it does one
 * bounded pass and returns what it did, so the thing that decides HOW OFTEN to
 * run is somebody else's decision and can be tested without waiting.
 *
 * WHAT IT REFUSES.
 *
 * - **To claim a run somebody else holds.** `inspectLock` distinguishes a live
 *   owner from a dead one, and treats a lock held on ANOTHER HOST as live
 *   because cross-host liveness is unknowable. A worker that reclaimed those
 *   would run the same iteration twice, and an iteration is a paid dispatch.
 * - **To claim a lock it cannot read.** An unreadable lock file is not a free
 *   one. It might be a live owner whose file is mid-write, and guessing costs a
 *   double dispatch.
 * - **To work silently.** Every run it looked at appears in the report with the
 *   reason it was skipped. A worker that quietly skips everything is
 *   indistinguishable from one with nothing to do — and the second is fine
 *   while the first is an outage.
 * - **To spin.** One pass claims at most `maxRuns`, and each claim advances at
 *   most `maxIterationsPerRun`. A run that refuses is reported and not retried
 *   within the same pass.
 * - **To release a lock before the work is durable.** The engine journals each
 *   iteration before returning; the lock is released after. A crash between
 *   them leaves a stale lock and a complete journal, which recovery can read —
 *   the other order would leave a claimable run whose last iteration is gone.
 */

import type { LoopEngineDeps, LoopEngineContext, LoopEngineOutcome } from './loop-iteration-engine';
import { runLoopUntilSettled } from './loop-iteration-engine';

/**
 * The one thing the worker asks of the engine. A narrow seam on purpose: the
 * first draft took the engine's whole dependency surface, which meant anything
 * exercising the worker had to fake journal backings and digest functions it
 * never touches — and a worker that must know the engine's insides to be
 * tested will eventually know them to run.
 */
export type LoopAdvanceFn = (
  context: LoopEngineContext,
  maxIterations: number,
) => Promise<LoopEngineOutcome>;

/** The production binding: the engine itself, applied to real deps once. */
export function bindLoopAdvance(engine: LoopEngineDeps): LoopAdvanceFn {
  return async (context, maxIterations) => {
    const { final } = await runLoopUntilSettled(engine, context, {
      maxIterationsThisCall: maxIterations,
    });
    return final;
  };
}

/** Why a discovered run was not advanced. Each is a different conversation. */
export type LoopSkipReason =
  | 'held_by_live_owner'
  | 'lock_unreadable'
  | 'lock_acquisition_failed'
  | 'no_context'
  | 'pass_capacity_reached';

export interface LoopWorkerAttempt {
  readonly runId: string;
  /** Present when the run was advanced. */
  readonly outcome?: LoopEngineOutcome;
  /** Present when it was not. */
  readonly skipped?: LoopSkipReason;
  readonly detail?: string;
}

export interface LoopWorkerPass {
  readonly startedAt: string;
  readonly finishedAt: string;
  /** Every run the worker looked at, advanced or not. */
  readonly attempts: readonly LoopWorkerAttempt[];
  readonly advanced: number;
  readonly skipped: number;
  /**
   * True when the pass stopped because it hit `maxRuns`, not because it ran
   * out of work. A caller that cannot tell those apart cannot tell a busy
   * system from a finished one.
   */
  readonly capacityReached: boolean;
}

/** What the worker needs from the world, all injected. */
export interface LoopWorkerPorts {
  /** Runs that might need work, newest first. Never invents one. */
  discoverRunnable(): Promise<readonly string[]>;
  /** The lock's current state, without acquiring it. */
  inspectRunLock(runId: string): Promise<{ readonly status: 'free' | 'held_by_live_owner' | 'stale_owner_dead' | 'unreadable' }>;
  /** Acquire, or null when someone won the race between inspect and acquire. */
  acquireRunLock(runId: string): Promise<{ release(): Promise<void> } | null>;
  /** The engine context for a run, or null when it cannot be rebuilt. */
  contextFor(runId: string): Promise<LoopEngineContext | null>;
  /** Advance one claimed run. Bind with `bindLoopAdvance` in production. */
  readonly advance: LoopAdvanceFn;
  readonly now: () => string;
}

export interface LoopWorkerOptions {
  /** Runs claimed in one pass. */
  readonly maxRuns: number;
  /** Iterations advanced per claimed run, this pass. */
  readonly maxIterationsPerRun: number;
}

/**
 * One bounded pass.
 *
 * Total: a run that throws is reported and the pass continues. One bad run must
 * not stop every other run from advancing, which is the failure mode that turns
 * a worker into an outage.
 */
export async function runLoopWorkerPass(
  ports: LoopWorkerPorts,
  options: LoopWorkerOptions,
): Promise<LoopWorkerPass> {
  const startedAt = ports.now();
  const attempts: LoopWorkerAttempt[] = [];
  let claimed = 0;
  let capacityReached = false;

  const runIds = await ports.discoverRunnable();

  for (const runId of runIds) {
    if (claimed >= options.maxRuns) {
      // Reported, not dropped: a pass that stopped early is a different fact
      // from one that finished the work.
      attempts.push({ runId, skipped: 'pass_capacity_reached' });
      capacityReached = true;
      continue;
    }

    const lock = await ports.inspectRunLock(runId);
    if (lock.status === 'held_by_live_owner') {
      attempts.push({ runId, skipped: 'held_by_live_owner' });
      continue;
    }
    if (lock.status === 'unreadable') {
      // Not free. It may be a live owner mid-write, and guessing costs a
      // double dispatch of paid work.
      attempts.push({ runId, skipped: 'lock_unreadable' });
      continue;
    }

    const acquired = await ports.acquireRunLock(runId);
    if (acquired === null) {
      // Someone won the race between inspect and acquire. That is normal, and
      // it is not a failure.
      attempts.push({ runId, skipped: 'lock_acquisition_failed' });
      continue;
    }

    claimed += 1;
    try {
      const context = await ports.contextFor(runId);
      if (context === null) {
        attempts.push({ runId, skipped: 'no_context' });
        continue;
      }
      const outcome = await ports.advance(context, options.maxIterationsPerRun);
      attempts.push({ runId, outcome });
    } catch (error) {
      // One bad run must not stop every other run from advancing.
      attempts.push({
        runId,
        skipped: 'no_context',
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      });
    } finally {
      // AFTER the engine has journalled. A crash before this leaves a stale
      // lock and a complete journal; releasing first would leave a claimable
      // run whose last iteration is gone.
      await acquired.release();
    }
  }

  const advanced = attempts.filter((a) => a.outcome !== undefined).length;
  return {
    startedAt,
    finishedAt: ports.now(),
    attempts,
    advanced,
    skipped: attempts.length - advanced,
    capacityReached,
  };
}

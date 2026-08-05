import { LOOP_LOCK_PURPOSE } from '../mission/loop/runtime';
import type { LoopLockResult, LoopRunLockPort } from '../mission/loop/runtime';
import type { LoopRunNodeStore } from './loop-run-node';

/**
 * SUNDAY RELAY — THE LOOP RUN LOCK, FOR REAL.
 *
 * The engine declares a lock PORT; this is the adapter that fulfils it with
 * Relay's actual O_EXCL file lock. It is deliberately tiny. Every rule about
 * what a lock means — who may hold one, when a dead owner's lock may be
 * reclaimed, what evidence is preserved when it is — already exists in
 * `acquireRunLock` and `inspectLock`, and is reused rather than restated.
 *
 * WHY THE IN-MEMORY PORT IS NOT ENOUGH IN PRODUCTION. It excludes two callers
 * inside ONE process. A Loop run is mutated by the bridge, possibly by a CLI
 * invocation, possibly by a recovery sweep — different processes, and a `Set`
 * in one of them knows nothing about the others. Two processes dispatching the
 * same iteration is two paid calls for one unit of work, and the journal would
 * faithfully record both.
 *
 * RELEASE IS UNCONDITIONAL AND IDEMPOTENT. The engine releases in a `finally`,
 * so a thrown error, a refusal, a pause, a stop and a completion all release.
 * `acquireRunLock`'s release re-reads the lock and removes it only when this
 * process still owns it, so releasing twice is harmless and releasing a lock
 * another process has since reclaimed does nothing — which is the behaviour
 * that matters, because the alternative is one process deleting another's lock
 * and both then believing they hold it.
 *
 * A LOCK WE CANNOT READ IS NOT A LOCK WE MAY TAKE. When the file exists but
 * cannot be parsed, `acquireRunLock` preserves it and reclaims; when a live
 * owner holds it, acquisition FAILS rather than waiting or stealing. The engine
 * turns that failure into a refusal, and a caller that cannot establish
 * ownership never dispatches.
 */

export interface LoopLockNodePortOptions {
  readonly store: LoopRunNodeStore;
  /** Resolves the Loop that owns a run, so the lock lands in the run's own
   *  directory rather than somewhere derived from the caller's belief. */
  readonly loopIdFor: (runId: string) => string | null;
  /** Injected clock — the lock records when it was taken. */
  readonly now: () => string;
}

/**
 * A lock port backed by the real file lock.
 *
 * `loopIdFor` exists because the port speaks in run ids while the filesystem
 * nests runs under their Loop. Resolving it here keeps the engine ignorant of
 * the storage layout, which is the point of having a port at all.
 */
export function createNodeLoopLockPort(options: LoopLockNodePortOptions): LoopRunLockPort {
  return {
    acquire: (runId, purpose): LoopLockResult => {
      const loopId = options.loopIdFor(runId);
      if (loopId === null) {
        return { ok: false, problem: `There is no Loop run ${runId} to lock.` };
      }
      const acquired = options.store.lock(loopId, runId, purpose || LOOP_LOCK_PURPOSE, options.now);
      if (!acquired.ok) {
        // A live owner, an unreadable path, a missing run. The message is the
        // one the persistence layer wrote; this adapter adds nothing it does
        // not know.
        return { ok: false, problem: acquired.error.message };
      }
      let released = false;
      return {
        ok: true,
        diagnostics: acquired.value.diagnostics,
        handle: {
          release: () => {
            // Idempotent by this flag AND by the underlying release, which
            // checks ownership before unlinking. Two guards because the cost of
            // getting this wrong is one process deleting another's lock.
            if (released) return;
            released = true;
            acquired.value.lock.release();
          },
        },
      };
    },
  };
}

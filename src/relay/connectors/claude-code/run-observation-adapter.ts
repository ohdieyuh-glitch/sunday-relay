import type { ClaudeRunOutcome } from './process-runner';
import { observeRun, type ObservedRun, type RunObservation } from '../../shared/llmops';

/**
 * THE CLAUDE CONNECTOR'S OPERATIONAL OBSERVER.
 *
 * This is the mapping from a finished Claude run to operational signal, and it
 * lives HERE rather than beside the projection for a reason that took a review
 * to surface: `shared/` may not import a connector, not even for a type, in any
 * file that ships. The first version put this mapping inside a test — where the
 * boundary rules exempt it — which meant the only mapping the product offered
 * was one the product could not use.
 *
 * The direction that IS allowed is this one. A connector may read the shared,
 * browser-safe projection; the projection may not read a connector. So the
 * adapter belongs to the adapter's own module, and `observeRun` stays pure and
 * ignorant of who is feeding it.
 *
 * WHAT IT DECIDES, and what it refuses to decide. It classifies the outcome and
 * forwards the numbers. It does not compute a latency, does not fold a null
 * into a zero, and does not judge whether the run recovered — the caller knows
 * whether a later attempt succeeded, and this does not.
 */

/**
 * Read a finished run into operational signal.
 *
 * `attempt` is the attempt number for the TASK, not a running count of
 * unrelated runs — a mistake the first version's only exemplar taught by
 * labelling four independent runs 1 through 4.
 */
export function observeClaudeRun(
  outcome: ClaudeRunOutcome,
  options: { readonly attempt?: number; readonly missionId?: string; readonly taskId?: string;
    readonly recovered?: boolean } = {},
): RunObservation {
  return observeRun(toObservedRun(outcome, options));
}

/** The classification, separated so it can be tested against real outcomes. */
export function toObservedRun(
  outcome: ClaudeRunOutcome,
  options: { readonly attempt?: number; readonly missionId?: string; readonly taskId?: string;
    readonly recovered?: boolean } = {},
): ObservedRun {
  const parsed = outcome.parsed;
  return {
    // THE ORDER IS THE NORMALIZER'S ORDER, deliberately and exactly:
    // `event-normalizer.ts` classifies the same outcome as
    // cancelled > timedOut > spawnError > isError, and it ships. Two producers
    // that disagree about what one run WAS put two vocabularies into one
    // record, which is the thing this module's header says it exists to stop —
    // and the first version of this adapter did precisely that by ranking
    // `spawnError` first.
    //
    // It also read `spawnError` as "never started", which the field does not
    // mean. It is set from `child.on('error')`, which Node also emits when a
    // process cannot be KILLED — the connector's own event says "failed to
    // start OR RUN". Ranking it above `timedOut` therefore reclassified a real
    // timeout whose SIGKILL failed as a workspace failure, and threw away its
    // latency.
    //
    // Cancellation outranks the timeout because both flags are reachable
    // together: the watchdog sets `timedOut`, then the kill grace window leaves
    // the run cancellable for several seconds. An operator who cancels a hung
    // run in that window has NOT run a failed provider attempt, and booking one
    // is the exact flattery the cancelled rule exists to prevent.
    termination: outcome.cancelled ? 'cancelled'
      : outcome.timedOut ? 'timed_out'
        : outcome.spawnError ? 'spawn_failed'
          : parsed.isError ? 'reported_error' : 'completed',
    usage: {
      durationMs: parsed.usage.durationMs,
      apiDurationMs: parsed.usage.apiDurationMs,
    },
    outcomeDurationMs: outcome.durationMs,
    resultSubtype: parsed.resultSubtype,
    observedAt: outcome.completedAt,
    ...(options.attempt === undefined ? {} : { attempt: options.attempt }),
    ...(options.missionId === undefined ? {} : { missionId: options.missionId }),
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.recovered === undefined ? {} : { recovered: options.recovered }),
  };
}

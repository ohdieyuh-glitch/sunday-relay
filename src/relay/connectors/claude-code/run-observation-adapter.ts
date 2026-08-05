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
    // ORDER IS THE MOST SPECIFIC CAUSE FIRST, because an outcome can carry
    // several flags at once and a reader needs the one that explains the rest.
    //
    // A spawn failure outranks everything: a process that never started cannot
    // meaningfully have timed out, and reporting the watchdog instead of ENOENT
    // sends someone to tune a timeout that was never the problem. Cancellation
    // outranks the error flag for the same reason — a cancelled run's error is
    // a consequence of the cancelling, not a fact about the provider.
    termination: outcome.spawnError ? 'spawn_failed'
      : outcome.timedOut ? 'timed_out'
        : outcome.cancelled ? 'cancelled'
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

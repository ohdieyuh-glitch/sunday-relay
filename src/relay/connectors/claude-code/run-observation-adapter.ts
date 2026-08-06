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

/**
 * Where a finished run is observed.
 *
 * OPTIONAL at every call site, and its absence is the current state of every
 * host: nothing is measured, and both surfaces say so.
 */
export interface ClaudeObservationSink {
  record(projectId: string, observation: RunObservation): Promise<{ readonly ok: boolean }>;
}

/**
 * How long a store may take before the run stops waiting for it.
 *
 * An unbounded `await` on a third-party sink is the worst way to break the
 * thing you are measuring: the run never returns, and nothing says why. A
 * bounded wait turns a hung store into a reported failure and one lost
 * observation, which is the trade this module is willing to make.
 */
export const OBSERVATION_TIMEOUT_MS = 5_000;

export interface ObservationDeps {
  readonly operations?: ClaudeObservationSink;
  /**
   * Told when an observation could not be stored. Absent means such a failure
   * is genuinely UNOBSERVED — nothing anywhere will mention it — which is a
   * real cost of not passing one, not a detail.
   */
  readonly onObservationFailed?: (reason: string) => void;
}

/**
 * Record one finished run, and NEVER let that fail the run.
 *
 * Exported and used by the adapter itself rather than reimplemented beside it.
 * A test that reconstructs this guard would be testing its own copy — the same
 * mistake as defining a connector mapping inside the test that proves the
 * mapping — so this is the one implementation and the tests call it.
 *
 * An instrument must not break the thing it measures: a store that throws,
 * rejects, or declines cannot change the run's result. But a failure that goes
 * nowhere is a failure nobody knows about, so it is handed to
 * `onObservationFailed` rather than swallowed.
 */
export async function recordClaudeObservation(
  deps: ObservationDeps,
  projectId: string,
  outcome: ClaudeRunOutcome,
  options: {
    readonly attempt?: number;
    readonly taskId?: string;
    /**
     * `false` when the adapter judged the stream malformed. Without it the
     * observation recorded a run the adapter was about to REJECT as healthy,
     * with no error and a 0% rate — the observation must see what the adapter
     * saw, and the adapter saw this too.
     */
    readonly structurallyValid?: boolean;
  } = {},
): Promise<void> {
  if (deps.operations === undefined) return;

  // The host's callback is not allowed to fail the run either. A logger that
  // throws would otherwise escape the guard written to stop exactly that, and
  // the previous version called it twice on the declined path — the second
  // time reporting the HOST's error as the store's.
  const report = (reason: string): void => {
    try {
      deps.onObservationFailed?.(reason);
    } catch {
      // Nowhere left to report it: the reporter is the thing that failed.
    }
  };

  const observation = observeClaudeRun(outcome, options);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), OBSERVATION_TIMEOUT_MS);
    });
    const written = await Promise.race([
      deps.operations.record(projectId, observation),
      timeout,
    ]);

    if (written === 'timed-out') {
      report(`the operations store did not answer in ${OBSERVATION_TIMEOUT_MS}ms`);
      return;
    }
    // Shape-checked: a sink returning `undefined` produced a raw
    // "Cannot read properties of undefined" as its reason, and one returning a
    // string was reported as having declined.
    if (typeof written !== 'object' || written === null || typeof written.ok !== 'boolean') {
      report('the operations store returned something that is not a write result');
      return;
    }
    if (!written.ok) report('the operations store declined the write');
  } catch (error) {
    report((error instanceof Error ? error.message : String(error)).slice(0, 200));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

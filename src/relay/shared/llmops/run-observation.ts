/**
 * SUNDAY RELAY — PRODUCTION ALPHA
 * The first real producer of operational signal.
 *
 * Until now `RelayOperationalRecord` had no writer: the model was tested against
 * fixtures and every shipped surface truthfully reported that nothing was being
 * measured. This is the seam that changes that, and it is deliberately the ONLY
 * one — a second producer with its own idea of what a timeout is would put two
 * different error vocabularies into one record.
 *
 * WHAT IT READS. The Claude connector parses `duration_ms` and
 * `duration_api_ms` off the CLI's own result line and initialises both to
 * `null`, so a run that reported no duration produces NO SAMPLE for that phase.
 *
 * The harness's OWN wall clock is a different matter, and getting this wrong
 * was the first version's real defect. `ClaudeRunOutcome.durationMs` is not
 * nullable — the harness always measured something — so falling back to it
 * unconditionally gave a process that never started a "total latency" of two
 * milliseconds. A duration is only a LATENCY when the thing being timed
 * actually ran, so the fallback is now allowed for exactly the terminations
 * where elapsed time means what it says.
 *
 * WHAT IT CONTRIBUTES THAT NOTHING ELSE COULD. A counted denominator. A run
 * that was actually TRIED counts one attempt, which makes the error RATE
 * knowable for the first time — before this, every rate in the product was
 * `unknown_denominator`, correctly but uselessly. A cancelled run counts zero;
 * see `ObservedRunTermination`.
 *
 * STRUCTURAL TYPES, NO IMPORT EDGE. `mission/` must not depend on
 * `connectors/`; the domain does not get to know which adapter is feeding it.
 */

import type { RelayErrorEvent, RelayLatencySample } from './llmops-contracts';
import { errorFromFailure, samplesFromTurn } from './operational-intake';

/** What the connector's stream parser produces, structurally. */
export interface ObservedRunUsage {
  readonly durationMs?: number | null;
  readonly apiDurationMs?: number | null;
}

/**
 * How a run ENDED. These are the five terminal branches the connector's
 * normalizer already distinguishes, in its order, and they are kept distinct
 * here for the reason it keeps them distinct: a cancellation, a timeout, a
 * process that failed to start or run, and a provider that answered with an
 * error are four different endings, and a surface that merges them cannot tell
 * a user which one to act on.
 */
export type ObservedRunTermination =
  | 'completed'
  | 'timed_out'
  | 'spawn_failed'
  | 'reported_error'
  /**
   * Stopped on purpose. Not a failure, and NOT AN ATTEMPT: a run somebody
   * cancelled is not a trial of the provider, and counting it would raise the
   * error rate's denominator while never raising its numerator — quietly
   * reporting a system as more reliable the more often it is interrupted.
   */
  | 'cancelled';

/**
 * Every termination, as a value, so a test can iterate them exhaustively rather
 * than hand-picking a list that silently stops matching the union.
 */
export const RELAY_RUN_TERMINATIONS = [
  'completed', 'timed_out', 'spawn_failed', 'reported_error', 'cancelled',
] as const;

export interface ObservedRun {
  readonly termination: ObservedRunTermination;
  readonly usage?: ObservedRunUsage;
  /** Wall-clock the harness measured, when the parsed usage has none. */
  readonly outcomeDurationMs?: number | null;
  /** The connector's own label for a reported error, if it had one. */
  readonly resultSubtype?: string | null;
  /** 1 for the first attempt of a task. */
  readonly attempt?: number;
  /** ISO-8601. When the run ended. */
  readonly observedAt: string;
  readonly missionId?: string;
  readonly taskId?: string;
  /**
   * `false` when the consumer judged the stream malformed.
   *
   * Applied only to a run that otherwise COMPLETED. A killed process never
   * prints its result line, so the structural check calls every timeout and
   * cancellation malformed too — and a malformed-stream label on those would
   * bury the reason the run actually ended.
   */
  readonly structurallyValid?: boolean;
  /**
   * Whether the RUN continued after this outcome — a later attempt succeeded,
   * or the mission carried on. Absent means NOT KNOWN to have recovered, and
   * unrecovered errors are what make health `failing`, so the default is the
   * one that cannot understate a problem.
   */
  readonly recovered?: boolean;
}

export interface RunObservation {
  readonly latency: readonly RelayLatencySample[];
  readonly errors: readonly RelayErrorEvent[];
  /**
   * When the run ended. Carried even when it produced no latency and no error,
   * so a project whose only activity is cancelled runs is not mistaken for one
   * with no activity at all.
   */
  readonly observedAt: string;
  /**
   * 1 for a run that was actually tried, 0 for one that was cancelled. This is
   * the denominator of every rate in the operations view, so what it counts
   * decides what those rates MEAN.
   */
  readonly attemptsObserved: number;
}

/** The connector's termination → the domain's error vocabulary. */
const TERMINATION_TO_LABEL: Readonly<Record<ObservedRunTermination, string | null>> =
  Object.freeze(Object.assign(Object.create(null) as Record<ObservedRunTermination, string | null>, {
    completed: null,
    cancelled: null,
    timed_out: 'provider_timeout',
    // A process that never started is the workspace's failure, not the
    // provider's, and calling it a provider error would send someone to read
    // the wrong logs.
    spawn_failed: 'workspace_failure',
    reported_error: 'provider_error',
  }));

/**
 * Terminations whose elapsed time is a LATENCY.
 *
 * A completed run and a timed-out one both spent that time doing the work. A
 * process that never started spent it failing to start, and a cancelled one was
 * interrupted partway — neither number describes how long the provider takes,
 * and letting them into the distribution makes every percentile a lie about a
 * different thing.
 */
const TIMED_TERMINATIONS: readonly ObservedRunTermination[] =
  Object.freeze(['completed', 'timed_out']);

/** A duration usable as a measurement: finite and non-negative. */
const usable = (value: number | null | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
);

/**
 * Read one finished run into operational signal.
 *
 * Total, and never throws: a malformed outcome reduces what is KNOWN rather
 * than failing the run that produced it. An observation that costs the mission
 * its result would be a worse instrument than no instrument.
 */
export function observeRun(run: ObservedRun): RunObservation {
  const usage = run.usage ?? {};

  // `duration_ms` is the provider's own figure; the harness's wall clock is the
  // fallback. They are not the same measurement — the harness's includes spawn
  // and teardown — so the provider's is preferred.
  //
  // `usable()` on BOTH, rather than `??`: a provider figure of NaN is not null,
  // so `??` kept it and threw away a perfectly good harness measurement.
  const timed = TIMED_TERMINATIONS.includes(run.termination);
  const totalMs = timed ? (usable(usage.durationMs) ?? usable(run.outcomeDurationMs)) : null;

  const latency = timed ? samplesFromTurn({
    durationMs: totalMs,
    apiDurationMs: usable(usage.apiDurationMs),
    observedAt: run.observedAt,
    ...(run.missionId === undefined ? {} : { missionId: run.missionId }),
    ...(run.taskId === undefined ? {} : { taskId: run.taskId }),
  }) : [];

  // An unrecognised termination becomes an `unknown` error rather than
  // nothing. Silently producing no error while still counting the attempt
  // deflates the error rate, and `errorFromFailure` already holds the rule this
  // follows: the count of `unknown` is itself the signal that a case is missing.
  const known = Object.hasOwn(TERMINATION_TO_LABEL, run.termination);
  // A malformed stream is a validation failure ONLY when the process otherwise
  // completed normally. It must not override a more specific ending, and the
  // reason is concrete: a killed run never prints its result line, so the
  // structural check calls EVERY timeout and cancellation malformed. Letting
  // that win would relabel every timeout as `validation_failure` — destroying
  // the rule that failures stay distinct — and would give every cancellation an
  // error while it still counts zero attempts, which is the cancellation
  // flattery defect running in reverse.
  const label = run.structurallyValid === false && run.termination === 'completed'
    ? 'validation_failure'
    : known ? TERMINATION_TO_LABEL[run.termination] : 'unrecognised_termination';
  const errors: RelayErrorEvent[] = [];
  if (label !== null && label !== undefined) {
    const event = errorFromFailure({
      kind: label,
      observedAt: run.observedAt,
      ...(run.recovered === undefined ? {} : { recovered: run.recovered }),
      ...(run.attempt === undefined ? {} : { attempt: run.attempt }),
      ...(run.missionId === undefined ? {} : { missionId: run.missionId }),
      // The connector's own subtype, carried through rather than interpreted.
      ...(run.resultSubtype ? { detail: run.resultSubtype.slice(0, 200) } : {}),
    });
    if (event !== null) errors.push(event);
  }

  // A cancelled run is not a trial of the provider, so it is not a denominator
  // — but it DID happen, and `observedAt` is what keeps it from vanishing.
  return {
    latency,
    errors,
    observedAt: run.observedAt,
    attemptsObserved: run.termination === 'cancelled' ? 0 : 1,
  };
}

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
 * WHAT IT READS. The Claude connector already parses `duration_ms`,
 * `duration_api_ms`, `num_turns` and `total_cost_usd` off the CLI's own result
 * line, and initialises every one of them to `null`. That null is the whole
 * reason this mapping is honest: a run that did not report a duration produces
 * NO SAMPLE, and the operations view names the phase as untimed rather than
 * drawing a zero.
 *
 * WHAT IT CONTRIBUTES THAT NOTHING ELSE COULD. A counted denominator. Every
 * terminal outcome is exactly one attempt, so `attemptsObserved: 1` per run
 * makes the error RATE knowable for the first time — before this, every rate in
 * the product was `unknown_denominator`, correctly but uselessly.
 *
 * STRUCTURAL TYPES, NO IMPORT EDGE. `mission/` must not depend on
 * `connectors/`; the domain does not get to know which adapter is feeding it.
 */

import type { RelayErrorEvent, RelayLatencySample } from './llmops-contracts';
import { errorFromFailure, samplesFromTurn } from './operational-intake';

/** What the connector's stream parser produces, structurally. */
export interface ObservedRunUsage {
  readonly numTurns?: number | null;
  readonly durationMs?: number | null;
  readonly apiDurationMs?: number | null;
  readonly reportedCostUsd?: number | null;
}

/**
 * How a run ENDED. These are the four terminal branches the connector's
 * normalizer already distinguishes, and they are kept distinct here for the
 * same reason it keeps them distinct: a timeout, a process that never started,
 * and a provider that answered with an error are three different failures, and
 * a surface that merges them cannot tell a user which one to act on.
 */
export type ObservedRunTermination =
  | 'completed'
  | 'timed_out'
  | 'spawn_failed'
  | 'reported_error';

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
  /** Always 1: a terminal outcome is one attempt, however it ended. */
  readonly attemptsObserved: number;
}

/** The connector's termination → the domain's error vocabulary. */
const TERMINATION_TO_LABEL: Readonly<Record<ObservedRunTermination, string | null>> =
  Object.freeze(Object.assign(Object.create(null) as Record<ObservedRunTermination, string | null>, {
    completed: null,
    timed_out: 'provider_timeout',
    // A process that never started is the workspace's failure, not the
    // provider's, and calling it a provider error would send someone to read
    // the wrong logs.
    spawn_failed: 'workspace_failure',
    reported_error: 'provider_error',
  }));

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
  // and teardown — so the provider's is preferred and the fallback is used only
  // when the provider reported none.
  const totalMs = usage.durationMs ?? run.outcomeDurationMs ?? null;

  const latency = samplesFromTurn({
    durationMs: totalMs,
    apiDurationMs: usage.apiDurationMs ?? null,
    observedAt: run.observedAt,
    ...(run.missionId === undefined ? {} : { missionId: run.missionId }),
    ...(run.taskId === undefined ? {} : { taskId: run.taskId }),
  });

  const label = TERMINATION_TO_LABEL[run.termination];
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

  return { latency, errors, attemptsObserved: 1 };
}

/**
 * JULIUS OBSERVABILITY AND EVALS, DERIVED FROM THE TRAJECTORY.
 *
 * WHY DERIVED AND NOT COUNTED. A parallel counter is a second record of the
 * same facts, and two records of one fact drift: an increment missed on a
 * failure path, a process that dies between the write and the increment, a
 * restart that resets an in-memory tally. The trajectory is already the
 * authoritative, idempotent, durable record of what a run did — so every
 * counter and every histogram here is a PROJECTION of it. A number that
 * disagrees with the trajectory is impossible rather than merely unlikely.
 *
 * NO HIGH-CARDINALITY LABELS. Nothing here is keyed by a run id, a mission id,
 * a task id, a worker id or a user. Those are unbounded, and a metric keyed by
 * one is a metric that eventually costs more than the thing it measures. The
 * only dimensions are the RUNTIME VERSION and the trajectory KIND, both of
 * which are small and closed sets.
 *
 * UNKNOWN IS NULL, NEVER ZERO. A histogram with no samples reports `null` for
 * every percentile rather than `0`, and a cost that was never observed is
 * omitted from the sum rather than counted as free. An average over an empty
 * set is not zero; it does not exist, and saying zero is the specific lie that
 * makes an eval look like a measurement when it is a placeholder.
 *
 * PURE. No clock, no I/O: it takes the events it is given and returns numbers.
 */

import type { JuliusTrajectoryEvent, JuliusEvalSummary } from './julius-trajectory';

/* ------------------------------------------------------------- histograms */

export interface JuliusHistogram {
  readonly count: number;
  readonly sum: number | null;
  readonly min: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

const EMPTY_HISTOGRAM: JuliusHistogram = Object.freeze({
  count: 0, sum: null, min: null, p50: null, p95: null, max: null,
});

/**
 * A histogram over the samples that EXIST.
 *
 * `null` samples are excluded rather than treated as zero — a task whose
 * duration was never observed did not take no time. The percentile is the
 * nearest-rank one on the sorted samples, which is exact for a finite set and
 * needs no bucket configuration to be wrong.
 */
export function summariseSamples(values: readonly (number | null)[]): JuliusHistogram {
  const samples = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (samples.length === 0) return EMPTY_HISTOGRAM;
  const rank = (fraction: number): number =>
    samples[Math.min(samples.length - 1, Math.max(0, Math.ceil(fraction * samples.length) - 1))]!;
  return {
    count: samples.length,
    sum: samples.reduce((total, value) => total + value, 0),
    min: samples[0]!,
    p50: rank(0.5),
    p95: rank(0.95),
    max: samples[samples.length - 1]!,
  };
}

/* --------------------------------------------------------------- counters */

/**
 * THE COUNTERS, AND WHAT EACH IS COUNTED FROM.
 *
 * Every one names a trajectory KIND or a KIND+OUTCOME pair, so the derivation
 * is readable beside the name rather than hidden in a function.
 */
export const JULIUS_COUNTERS = [
  'julius_runs_started',
  'julius_runs_completed',
  'julius_runs_failed',
  'julius_runs_cancelled',
  'julius_tasks_dispatched',
  'julius_task_retries',
  'julius_repairs',
  'julius_reroutes',
  'julius_fallbacks',
  'julius_subagents_spawned',
  'julius_gauntlet_rounds',
  'julius_gauntlets_cleared',
  'julius_findings_recorded',
  'julius_recoveries',
] as const;
export type JuliusCounter = (typeof JULIUS_COUNTERS)[number];

export const JULIUS_HISTOGRAMS = [
  'julius_task_duration_ms',
  'julius_task_cost_usd_micros',
  'julius_context_characters',
  'julius_gauntlet_round_duration_ms',
] as const;
export type JuliusHistogramName = (typeof JULIUS_HISTOGRAMS)[number];

export interface JuliusMetricsSnapshot {
  /** The dimension every number below is grouped by. Small and closed. */
  readonly runtimeVersion: string;
  readonly counters: Readonly<Record<JuliusCounter, number>>;
  readonly histograms: Readonly<Record<JuliusHistogramName, JuliusHistogram>>;
  /** How many events the snapshot was derived from. Zero is a real answer. */
  readonly sampledEvents: number;
}

const zeroCounters = (): Record<JuliusCounter, number> =>
  Object.fromEntries(JULIUS_COUNTERS.map((name) => [name, 0])) as Record<JuliusCounter, number>;

/**
 * Project one runtime version's metrics out of its trajectory.
 *
 * MIXED RUNTIME VERSIONS ARE SEPARATED, NEVER BLENDED. Comparing generations
 * is the whole point of the eval layer, and an average across two runtimes is
 * a number about neither of them.
 */
export function projectJuliusMetrics(
  events: readonly JuliusTrajectoryEvent[],
  runtimeVersion: string,
): JuliusMetricsSnapshot {
  const scoped = events.filter((event) => event.runtimeVersion === runtimeVersion);
  const counters = zeroCounters();
  const of = (kind: JuliusTrajectoryEvent['kind']) => scoped.filter((event) => event.kind === kind);

  counters.julius_runs_started = new Set(of('TASK_TOPOLOGY').map((event) => event.runId)).size;
  counters.julius_runs_completed = new Set(of('COMPLETION').filter((event) => event.outcome === 'VERIFIED').map((event) => event.runId)).size;
  counters.julius_runs_failed = new Set(of('COMPLETION').filter((event) => event.outcome === 'FAILED').map((event) => event.runId)).size;
  counters.julius_runs_cancelled = new Set(of('COMPLETION').filter((event) => event.outcome === 'CANCELLED').map((event) => event.runId)).size;
  counters.julius_tasks_dispatched = of('DISPATCH').length;
  counters.julius_task_retries = of('RETRY').length;
  counters.julius_repairs = of('REPAIR').length;
  counters.julius_fallbacks = of('FALLBACK').length;
  // A reroute that stayed inside one provider produces no FALLBACK, so the
  // two are counted apart: `julius_reroutes` is every re-dispatch and
  // `julius_fallbacks` is the subset that crossed providers.
  counters.julius_reroutes = of('DISPATCH').filter((event) => event.outcome !== 'COMPLETED').length + of('FALLBACK').length;
  counters.julius_subagents_spawned = of('SUBAGENT').filter((event) => event.outcome === 'AUTHORIZED').length;
  counters.julius_gauntlet_rounds = of('GAUNTLET_ROUND').length;
  counters.julius_gauntlets_cleared = of('GAUNTLET_ROUND').filter((event) => event.outcome === 'CLEARED').length;
  counters.julius_findings_recorded = of('FINDING').length;
  counters.julius_recoveries = of('RECOVERY').length;

  return {
    runtimeVersion,
    counters,
    histograms: {
      julius_task_duration_ms: summariseSamples(of('DISPATCH').map((event) => event.durationMs)),
      julius_task_cost_usd_micros: summariseSamples(of('DISPATCH').map((event) => event.usdMicros)),
      julius_context_characters: summariseSamples(
        of('CONTEXT_COMPILED').map((event) => {
          const value = event.safeFacts.characterCount;
          return typeof value === 'number' ? value : null;
        }),
      ),
      julius_gauntlet_round_duration_ms: summariseSamples(of('GAUNTLET_ROUND').map((event) => event.durationMs)),
    },
    sampledEvents: scoped.length,
  };
}

/** Every runtime version present, so a caller can project each separately. */
export function runtimeVersionsIn(events: readonly JuliusTrajectoryEvent[]): readonly string[] {
  return [...new Set(events.map((event) => event.runtimeVersion))].sort();
}

/* ------------------------------------------------------------------ evals */

/**
 * The eval summary, computed in the same shape the SQL produces.
 *
 * WHY BOTH EXIST. `JuliusTrajectoryPostgresRepository.summarize` computes this
 * in one query, which is right for a production window over millions of rows
 * and unavailable in a test, on a laptop, or anywhere without a database. This
 * is the same summary as a pure function — so evals work offline, and the SQL
 * has a reference implementation to be checked against rather than being
 * trusted because it is SQL.
 *
 * EVERY HONEST-ZERO CASE IS A NULL. Cost per verified completion is `null`
 * when nothing completed, because dividing by zero completions is not a cost
 * of zero. Average duration is `null` when nothing recorded one. A rate over
 * zero runs is `0` and is reported alongside `runs: 0`, so a reader can tell a
 * real zero from an empty sample.
 */
export function summariseJuliusEvals(
  events: readonly JuliusTrajectoryEvent[],
  runtimeVersion: string,
): JuliusEvalSummary {
  const metrics = projectJuliusMetrics(events, runtimeVersion);
  const scoped = events.filter((event) => event.runtimeVersion === runtimeVersion);
  const runs = new Set(scoped.map((event) => event.runId)).size;
  const verified = metrics.counters.julius_runs_completed;
  const cost = scoped
    .map((event) => event.usdMicros)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const totalUsdMicros = cost.reduce((total, value) => total + value, 0);
  const durations = summariseSamples(scoped.map((event) => event.durationMs));

  return {
    runtimeVersion,
    runs,
    verifiedCompletions: verified,
    verifiedCompletionRate: runs === 0 ? 0 : verified / runs,
    totalUsdMicros,
    // NOT ZERO. Nothing completed, so there is no cost PER completion — and
    // reporting zero would make the cheapest generation the one that never
    // finished anything.
    costPerVerifiedCompletion: verified === 0 ? null : totalUsdMicros / verified,
    averageDurationMs: durations.count === 0 || durations.sum === null ? null : durations.sum / durations.count,
    retries: metrics.counters.julius_task_retries,
    fallbacks: metrics.counters.julius_fallbacks,
    repairs: metrics.counters.julius_repairs,
    recoveries: metrics.counters.julius_recoveries,
    gauntletRounds: metrics.counters.julius_gauntlet_rounds,
    successfulGauntlets: metrics.counters.julius_gauntlets_cleared,
  };
}

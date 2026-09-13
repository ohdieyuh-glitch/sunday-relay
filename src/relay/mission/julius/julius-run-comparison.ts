/**
 * COMPARING TWO PAID RUNS — PURE, AND HONEST ABOUT WHAT CANNOT BE COMPARED.
 *
 * THE PROBLEM THIS EXISTS FOR. The lab that evaluates Julius wants to say
 * whether a repair made a mission cheaper, faster or more complete, and the
 * only way to say it is to put two runs side by side. Every number a paid run
 * exports arrives with a qualification: a known cost is a FLOOR whenever a
 * component reported nothing, an allocation policy changes what "cost" was
 * even measuring, a role that never dispatched has no cost rather than a cost
 * of zero, and a tick count that was never recorded is not zero ticks. A
 * comparison that forgets any of those publishes a delta nobody can defend.
 *
 * WHAT THIS MODULE IS FOR. One vocabulary for what a comparison is willing to
 * say about a metric — a DELTA it stands behind, an UNKNOWN it will not guess,
 * or a NOT_COMPARABLE it refuses on structural grounds — and one function that
 * applies the same rules to a mission and to each of its roles. It is pure: no
 * clock, no Node, no filesystem, no randomness, and it mutates nothing.
 *
 * IT BUILDS ON `julius-cost-accounting`, which is the authority on what a
 * mission cost and whether that figure is complete. The cost module is in this
 * workspace and is imported, not copied: a second copy of its vocabulary is
 * how two readers come to disagree about the same run.
 *
 * EVERY FUNCTION BELOW THROWS. This module is the deliverable of a bounded
 * Julius mission; its specification is `julius-run-comparison.test.ts`, which
 * is written and currently fails.
 */

import type { JuliusMissionCost } from './julius-cost-accounting';

export const JULIUS_RUN_COMPARISON_VERSION = 'julius-run-comparison.v1' as const;

/** What a run ended as. A word outside this list is UNKNOWN, never guessed. */
export const JULIUS_RUN_STATES = ['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'] as const;
export type JuliusRunState = (typeof JULIUS_RUN_STATES)[number];

/** What a comparison of one metric is willing to say. */
export const JULIUS_COMPARISON_KINDS = ['DELTA', 'UNKNOWN', 'NOT_COMPARABLE'] as const;
export type JuliusComparisonKind = (typeof JULIUS_COMPARISON_KINDS)[number];

/**
 * The direction of a DELTA, read against the metric's declared polarity.
 * `NEUTRAL` is for a metric that has no better or worse — a dispatch count is
 * a fact, not a score — and it appears only when the two values differ.
 */
export const JULIUS_COMPARISON_DIRECTIONS = ['IMPROVED', 'REGRESSED', 'UNCHANGED', 'NEUTRAL'] as const;
export type JuliusComparisonDirection = (typeof JULIUS_COMPARISON_DIRECTIONS)[number];

/** The direction of an outcome. `UNKNOWN` when either run's state is unknown. */
export const JULIUS_OUTCOME_DIRECTIONS = ['IMPROVED', 'REGRESSED', 'UNCHANGED', 'UNKNOWN'] as const;
export type JuliusOutcomeDirection = (typeof JULIUS_OUTCOME_DIRECTIONS)[number];

export const JULIUS_METRIC_POLARITIES = ['LOWER_IS_BETTER', 'HIGHER_IS_BETTER', 'NEUTRAL'] as const;
export type JuliusMetricPolarity = (typeof JULIUS_METRIC_POLARITIES)[number];

/** The metrics a comparison reports, at the mission level and per role. */
export const JULIUS_COMPARED_METRICS = [
  'knownUsdMicros', 'estimatedUsdMicros', 'unknownComponents', 'components', 'ticks',
] as const;
export type JuliusComparedMetric = (typeof JULIUS_COMPARED_METRICS)[number];

/**
 * The polarity of each metric, declared once. Money and unknowns are better
 * lower; a dispatch count is neither. The specification pins this table.
 */
export const JULIUS_METRIC_POLARITY: Readonly<Record<JuliusComparedMetric, JuliusMetricPolarity>> = Object.freeze({
  knownUsdMicros: 'LOWER_IS_BETTER',
  estimatedUsdMicros: 'LOWER_IS_BETTER',
  unknownComponents: 'LOWER_IS_BETTER',
  components: 'NEUTRAL',
  ticks: 'LOWER_IS_BETTER',
});

/** The facts about one run that a comparison reads. Nothing here is inferred. */
export interface JuliusRunFacts {
  readonly runId: string;
  /** The allocation policy the run settled under, or null when the record does not say. */
  readonly allocationPolicy: string | null;
  readonly state: JuliusRunState;
  /** The ticks the run took, or null when the record does not say. Never 0 for "not recorded". */
  readonly ticks: number | null;
  /** The run's cost, from `summariseJuliusMissionCost`, with its completeness. */
  readonly cost: JuliusMissionCost;
}

/**
 * One metric, compared. `delta` is always `after - before`.
 *
 * `UNKNOWN` says one side (or both) could not supply the number honestly.
 * `NOT_COMPARABLE` says both sides supplied a number and the numbers still
 * must not be set against each other. Neither carries a delta, a before or an
 * after: a reader that wants a number from them cannot get one by accident.
 */
export type JuliusMetricComparison =
  | {
    readonly kind: 'DELTA';
    readonly before: number;
    readonly after: number;
    readonly delta: number;
    readonly direction: JuliusComparisonDirection;
  }
  | { readonly kind: 'UNKNOWN'; readonly reason: string }
  | { readonly kind: 'NOT_COMPARABLE'; readonly reason: string };

/** One role, compared on the four metrics a role has. */
export interface JuliusRoleComparison {
  readonly role: string | null;
  readonly knownUsdMicros: JuliusMetricComparison;
  readonly estimatedUsdMicros: JuliusMetricComparison;
  readonly unknownComponents: JuliusMetricComparison;
  readonly components: JuliusMetricComparison;
}

export interface JuliusRunComparison {
  readonly version: typeof JULIUS_RUN_COMPARISON_VERSION;
  /** The two run ids, in the order given: `before` then `after`. */
  readonly before: string;
  readonly after: string;
  readonly outcome: {
    readonly before: JuliusRunState;
    readonly after: JuliusRunState;
    readonly direction: JuliusOutcomeDirection;
  };
  /** True only when both runs settled under the same, known allocation policy. */
  readonly moneyComparable: boolean;
  readonly ticks: JuliusMetricComparison;
  readonly knownUsdMicros: JuliusMetricComparison;
  readonly estimatedUsdMicros: JuliusMetricComparison;
  readonly unknownComponents: JuliusMetricComparison;
  readonly components: JuliusMetricComparison;
  /** Every role either run had, in a deterministic order, each compared on its own. */
  readonly byRole: readonly JuliusRoleComparison[];
  /** True only when every metric above, and every role's, is a DELTA and the outcome is known. */
  readonly scorable: boolean;
}

/** A state from the closed set, or `UNKNOWN`. A word nobody defined is not a state. */
export function safeJuliusRunState(value: unknown): JuliusRunState {
  void value;
  throw new Error('run_comparison_not_implemented');
}

/**
 * The arithmetic, on one metric, with the metric's own polarity. A null on
 * either side is UNKNOWN and names the side; it is never read as zero.
 */
export function compareJuliusMetric(
  metric: JuliusComparedMetric,
  before: number | null,
  after: number | null,
): JuliusMetricComparison {
  void metric; void before; void after;
  throw new Error('run_comparison_not_implemented');
}

/** Two runs, compared under every rule the header states. */
export function compareJuliusRuns(before: JuliusRunFacts, after: JuliusRunFacts): JuliusRunComparison {
  void before; void after;
  throw new Error('run_comparison_not_implemented');
}

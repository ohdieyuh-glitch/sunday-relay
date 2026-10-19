import { projectJuliusMetrics, summariseJuliusEvals } from './julius-metrics';
import { isJuliusProviderAttempt, type JuliusTrajectoryEvent } from './julius-trajectory';

/**
 * THE JULIUS LEARNING LOOP — AND THE ONLY THING IT IS ALLOWED TO CLAIM.
 *
 * Project Brain has stored what a run concluded since migration 014. THAT IS NOT
 * LEARNING. A store is a store; learning is a claim about the FUTURE, and the
 * only honest way to make it is to run the future twice — once without the prior
 * knowledge and once with it — and measure whether anything got better.
 *
 * So this module is deliberately NOT a "learner". It is a MEASUREMENT and a
 * GATE:
 *
 *   MEASUREMENT  — `juliusLearningMetrics` projects one mission's outcome out of
 *                  the durable trajectory, never out of a parallel counter. Two
 *                  records of one fact drift; a projection cannot.
 *   COMPARISON   — `compareJuliusLearningPair` puts a matched pair side by side,
 *                  dimension by dimension, and says IMPROVED, NO_EFFECT,
 *                  REGRESSED or UNMEASURABLE for each. Never one blended score:
 *                  a mission that got faster and more expensive has not simply
 *                  "improved", and a single number is how that gets hidden.
 *   GATE         — `decideJuliusLearningPromotion` answers whether the artifact
 *                  may become trusted memory. It refuses far more often than it
 *                  promotes, and every refusal names why.
 *
 * THE FOUR RULES THE GATE HOLDS, each of which exists because the opposite is
 * the cheapest way to make a Learning Loop look like it works:
 *
 *  1. AN UNMEASURED DIMENSION IS NOT AN IMPROVED ONE. `null` is UNMEASURABLE and
 *     can never satisfy the promotion requirement. Half of the dimensions here
 *     are `number | null` precisely because a provider that reported no cost and
 *     a provider that cost nothing must not be the same row.
 *  2. AN IMPROVEMENT ON ONE DIMENSION DOES NOT PAY FOR A REGRESSION ON ANOTHER.
 *     Any declared dimension that regressed refuses the promotion outright.
 *  3. AN UNMATCHED PAIR MEASURES NOTHING. The two missions must be comparable —
 *     same objective, same worker roles, same runtime version, and both must
 *     have actually reached a verdict. A pair that differs in what it was asked
 *     to do is an anecdote, and this refuses to score one.
 *  4. NOISE IS NOT VALUE. An improvement must clear a declared minimum. Without
 *     it, one fewer tool call out of forty promotes a memory forever.
 *
 * AND THE RULE THAT IS NOT HERE: this module never writes anything. Promotion is
 * `promoteJuliusMemoryClaim`'s to perform, on evidence, from an authority that is
 * not the claim's asserter — so a learning artifact reaches trusted memory
 * through exactly the same gate every other claim does, with the comparison as
 * its evidence. A Learning Loop that could write its own trust would be the
 * "compound agent that compounds its own mistakes" with a measurement stapled on.
 *
 * Pure: no clock, no store, no network. It takes trajectory events and returns
 * numbers and verdicts.
 */

export const JULIUS_LEARNING_LOOP_VERSION = 'julius-learning-loop.v1' as const;

/**
 * WHAT A MISSION COST, AS THE DIMENSIONS A LEARNING ARTIFACT COULD PLAUSIBLY
 * MOVE. Every one is projected from the trajectory.
 *
 * `null` means the runtime does not know — a provider that reported no usage, a
 * window where nothing completed. It is never zero.
 */
export interface JuliusLearningMetrics {
  readonly runtimeVersion: string;
  readonly runs: number;
  readonly dispatches: number;
  readonly retries: number;
  readonly repairs: number;
  readonly recoveries: number;
  readonly fallbacks: number;
  readonly findings: number;
  readonly verifiedCompletions: number;
  /** A FLOOR whenever `costComplete` is false. */
  readonly knownUsdMicros: number;
  readonly costComplete: boolean;
  readonly averageDurationMs: number | null;
  /** Provider-reported tokens, summed over the provider attempts (requeued ones included) that reported any. */
  readonly knownInputTokens: number | null;
  readonly knownOutputTokens: number | null;
  /** Provider attempts, requeued ones included, that reported no usage at all. The reason a token sum is a floor. */
  readonly unknownUsageComponents: number;
}

/**
 * THE DIMENSIONS A PROMOTION MAY BE ARGUED ON, and the direction that counts as
 * better. Closed, so an experiment cannot invent a dimension after seeing its
 * own result.
 *
 * `verifiedCompletions` is the one where MORE is better; every other is a cost.
 */
export const JULIUS_LEARNING_DIMENSIONS = [
  'dispatches', 'retries', 'repairs', 'recoveries', 'fallbacks',
  'knownUsdMicros', 'averageDurationMs', 'knownInputTokens', 'knownOutputTokens',
  'verifiedCompletions',
] as const;
export type JuliusLearningDimension = (typeof JULIUS_LEARNING_DIMENSIONS)[number];

const HIGHER_IS_BETTER: ReadonlySet<JuliusLearningDimension> = new Set(['verifiedCompletions']);

export const JULIUS_LEARNING_VERDICTS = ['IMPROVED', 'NO_EFFECT', 'REGRESSED', 'UNMEASURABLE'] as const;
export type JuliusLearningVerdict = (typeof JULIUS_LEARNING_VERDICTS)[number];

export interface JuliusLearningDelta {
  readonly dimension: JuliusLearningDimension;
  readonly without: number | null;
  readonly with: number | null;
  /** `with - without`, or null when either side is unmeasured. */
  readonly delta: number | null;
  readonly verdict: JuliusLearningVerdict;
  /**
   * True when the side that would have to be trusted is a FLOOR rather than a
   * total — an incomplete cost or token sum. A floor can show a regression
   * (the floor already exceeds the other side) but never an improvement.
   */
  readonly bounded: boolean;
}

/** What makes two missions a matched pair. All of it must be equal. */
export interface JuliusLearningPairing {
  readonly objectiveDigest: string;
  readonly roles: readonly string[];
  readonly runtimeVersion: string;
}

export type JuliusLearningComparison =
  | {
      readonly outcome: 'COMPARED';
      readonly version: typeof JULIUS_LEARNING_LOOP_VERSION;
      readonly deltas: readonly JuliusLearningDelta[];
      readonly without: JuliusLearningMetrics;
      readonly with: JuliusLearningMetrics;
    }
  | { readonly outcome: 'UNCOMPARABLE'; readonly reasonCode: string };

export interface JuliusLearningPolicy {
  /** The dimensions this experiment declared BEFORE it ran. Never empty. */
  readonly dimensions: readonly JuliusLearningDimension[];
  /**
   * The smallest change on a dimension that is not noise, as a fraction of the
   * without-learning value. 0.1 means "at least ten per cent better".
   */
  readonly minimumRelativeImprovement: number;
  /** How many declared dimensions must improve. At least one. */
  readonly minimumImprovedDimensions: number;
}

export type JuliusLearningDecision =
  | {
      readonly outcome: 'PROMOTE';
      readonly improved: readonly JuliusLearningDimension[];
      readonly marginalValue: number;
    }
  | { readonly outcome: 'REFUSE'; readonly reasonCode: string; readonly regressed: readonly JuliusLearningDimension[] };

/* ------------------------------------------------------------- measurement */

/**
 * PROJECT ONE MISSION'S OUTCOME. Scoped to one runtime version, for the reason
 * `projectJuliusMetrics` separates them: an average across two generations is a
 * number about neither.
 */
export function juliusLearningMetrics(
  events: readonly JuliusTrajectoryEvent[],
  runtimeVersion: string,
): JuliusLearningMetrics {
  const summary = summariseJuliusEvals(events, runtimeVersion);
  const metrics = projectJuliusMetrics(events, runtimeVersion);
  // THE PROVIDER ATTEMPTS, not every DISPATCH row. A tool step's tokens are a
  // literal zero and a pre-provider refusal called nobody: counting a refusal's
  // absent usage as unknown would make the token dimensions unmeasurable for
  // any mission that met one, and counting tool steps as dispatches would let a
  // candidate look leaner by running fewer of them (`juliusDispatchRowClass`).
  // The usage is every attempt's, a requeued one's too: leaving a retried
  // attempt's tokens out would let a candidate that retried more read leaner.
  // The `dispatches` dimension counts DISPATCH rows; a requeue is a retry.
  const attempts = events.filter((event) =>
    event.runtimeVersion === runtimeVersion && isJuliusProviderAttempt(event));
  const dispatches = attempts.filter((event) => event.kind === 'DISPATCH');
  const sum = (pick: (event: JuliusTrajectoryEvent) => number | null): number | null => {
    const known = attempts.map(pick).filter((value): value is number => typeof value === 'number');
    // NO SAMPLES IS NOT ZERO. A sum over nothing does not exist.
    return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
  };
  const reportedUsage = attempts.filter((event) =>
    event.inputTokens !== null || event.outputTokens !== null);
  return {
    runtimeVersion,
    runs: summary.runs,
    dispatches: dispatches.length,
    retries: summary.retries,
    repairs: summary.repairs,
    recoveries: summary.recoveries,
    fallbacks: summary.fallbacks,
    findings: metrics.counters.julius_findings_recorded,
    verifiedCompletions: summary.verifiedCompletions,
    knownUsdMicros: summary.knownUsdMicros,
    costComplete: summary.costComplete,
    averageDurationMs: summary.averageDurationMs,
    knownInputTokens: sum((event) => event.inputTokens),
    knownOutputTokens: sum((event) => event.outputTokens),
    unknownUsageComponents: attempts.length - reportedUsage.length,
  };
}

/* ------------------------------------------------------------- comparison */

const BOUNDED_DIMENSIONS: ReadonlySet<JuliusLearningDimension> =
  new Set(['knownUsdMicros', 'knownInputTokens', 'knownOutputTokens']);

const valueOf = (metrics: JuliusLearningMetrics, dimension: JuliusLearningDimension): number | null => {
  switch (dimension) {
    case 'dispatches': return metrics.dispatches;
    case 'retries': return metrics.retries;
    case 'repairs': return metrics.repairs;
    case 'recoveries': return metrics.recoveries;
    case 'fallbacks': return metrics.fallbacks;
    case 'knownUsdMicros': return metrics.costComplete ? metrics.knownUsdMicros : null;
    case 'averageDurationMs': return metrics.averageDurationMs;
    case 'knownInputTokens': return metrics.unknownUsageComponents === 0 ? metrics.knownInputTokens : null;
    case 'knownOutputTokens': return metrics.unknownUsageComponents === 0 ? metrics.knownOutputTokens : null;
    case 'verifiedCompletions': return metrics.verifiedCompletions;
  }
};

/**
 * COMPARE A MATCHED PAIR, dimension by dimension.
 *
 * MISSION A ran without the learning artifact; MISSION B with it. The pairing is
 * checked FIRST and the comparison refused when it does not hold, because a
 * comparison between two different missions is worse than no comparison: it
 * looks like evidence.
 */
export function compareJuliusLearningPair(input: {
  readonly without: { readonly events: readonly JuliusTrajectoryEvent[]; readonly pairing: JuliusLearningPairing };
  readonly with: { readonly events: readonly JuliusTrajectoryEvent[]; readonly pairing: JuliusLearningPairing };
  readonly dimensions: readonly JuliusLearningDimension[];
}): JuliusLearningComparison {
  if (input.dimensions.length === 0) return uncomparable('learning_dimensions_required');
  for (const dimension of input.dimensions) {
    if (!JULIUS_LEARNING_DIMENSIONS.includes(dimension)) return uncomparable('learning_dimension_unknown');
  }
  const left = input.without.pairing;
  const right = input.with.pairing;
  if (left.objectiveDigest !== right.objectiveDigest) return uncomparable('learning_pair_objective_differs');
  if (left.runtimeVersion !== right.runtimeVersion) return uncomparable('learning_pair_runtime_differs');
  if (left.roles.length !== right.roles.length
    || [...left.roles].sort().join('|') !== [...right.roles].sort().join('|')) {
    return uncomparable('learning_pair_roles_differ');
  }
  const without = juliusLearningMetrics(input.without.events, left.runtimeVersion);
  const withLearning = juliusLearningMetrics(input.with.events, right.runtimeVersion);
  // A MISSION THAT NEVER RAN IS NOT A CONTROL. Both sides must have dispatched
  // something, or the "improvement" is that one of them did nothing.
  if (without.dispatches === 0 || withLearning.dispatches === 0) return uncomparable('learning_pair_empty');

  const deltas = input.dimensions.map((dimension): JuliusLearningDelta => {
    const a = valueOf(without, dimension);
    const b = valueOf(withLearning, dimension);
    const bounded = BOUNDED_DIMENSIONS.has(dimension)
      && !(without.costComplete && withLearning.costComplete
        && without.unknownUsageComponents === 0 && withLearning.unknownUsageComponents === 0);
    if (a === null || b === null) {
      return { dimension, without: a, with: b, delta: null, verdict: 'UNMEASURABLE', bounded };
    }
    const better = HIGHER_IS_BETTER.has(dimension) ? b > a : b < a;
    const worse = HIGHER_IS_BETTER.has(dimension) ? b < a : b > a;
    return {
      dimension, without: a, with: b, delta: b - a,
      verdict: better ? 'IMPROVED' : worse ? 'REGRESSED' : 'NO_EFFECT',
      bounded,
    };
  });
  return { outcome: 'COMPARED', version: JULIUS_LEARNING_LOOP_VERSION, deltas, without, with: withLearning };
}

const uncomparable = (reasonCode: string): JuliusLearningComparison => ({ outcome: 'UNCOMPARABLE', reasonCode });

/* ------------------------------------------------------------------- gate */

/**
 * MAY THIS ARTIFACT BECOME TRUSTED MEMORY?
 *
 * The answer is NO unless the measurement says yes, loudly enough, on dimensions
 * declared in advance, with nothing else made worse. `marginalValue` is reported
 * only when the answer is yes, and it is the SMALLEST relative improvement among
 * the dimensions that improved — not the largest and not a mean, because the
 * weakest link is what a reader would otherwise have to go and find.
 */
export function decideJuliusLearningPromotion(
  comparison: JuliusLearningComparison,
  policy: JuliusLearningPolicy,
): JuliusLearningDecision {
  if (comparison.outcome !== 'COMPARED') {
    return { outcome: 'REFUSE', reasonCode: comparison.reasonCode, regressed: [] };
  }
  if (policy.minimumImprovedDimensions < 1) {
    return { outcome: 'REFUSE', reasonCode: 'learning_policy_requires_no_improvement', regressed: [] };
  }
  if (!(policy.minimumRelativeImprovement > 0)) {
    return { outcome: 'REFUSE', reasonCode: 'learning_policy_threshold_required', regressed: [] };
  }
  const declared = comparison.deltas.filter((delta) => policy.dimensions.includes(delta.dimension));
  if (declared.length !== policy.dimensions.length) {
    return { outcome: 'REFUSE', reasonCode: 'learning_policy_dimension_not_compared', regressed: [] };
  }
  // RULE 2, FIRST. A regression refuses the promotion whatever else improved.
  const regressed = declared.filter((delta) => delta.verdict === 'REGRESSED').map((delta) => delta.dimension);
  if (regressed.length > 0) return { outcome: 'REFUSE', reasonCode: 'learning_regressed', regressed };

  const improvements: { readonly dimension: JuliusLearningDimension; readonly relative: number }[] = [];
  for (const delta of declared) {
    if (delta.verdict !== 'IMPROVED' || delta.delta === null || delta.without === null) continue;
    // A FLOOR CANNOT SHOW AN IMPROVEMENT. An incomplete cost that looks lower may
    // only be missing more components than the other side.
    if (delta.bounded) continue;
    // A DIMENSION THAT STARTED AT ZERO CANNOT IMPROVE RELATIVELY, and the only
    // way it can have improved at all is `verifiedCompletions` going up. Treated
    // as clearing the threshold, because "from none to some" is not noise.
    const relative = delta.without === 0 ? 1 : Math.abs(delta.delta) / Math.abs(delta.without);
    if (relative < policy.minimumRelativeImprovement) continue;
    improvements.push({ dimension: delta.dimension, relative });
  }
  if (improvements.length < policy.minimumImprovedDimensions) {
    return { outcome: 'REFUSE', reasonCode: 'learning_no_measurable_value', regressed: [] };
  }
  return {
    outcome: 'PROMOTE',
    improved: improvements.map((item) => item.dimension),
    marginalValue: improvements.reduce((least, item) => Math.min(least, item.relative), Number.POSITIVE_INFINITY),
  };
}

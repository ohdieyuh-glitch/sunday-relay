import { test } from 'node:test';
import assert from 'node:assert/strict';
import { juliusCostComponent, summariseJuliusMissionCost, type JuliusMissionCost } from './julius-cost-accounting';
import {
  JULIUS_COMPARED_METRICS,
  JULIUS_COMPARISON_DIRECTIONS,
  JULIUS_COMPARISON_KINDS,
  JULIUS_METRIC_POLARITY,
  JULIUS_OUTCOME_DIRECTIONS,
  JULIUS_RUN_COMPARISON_VERSION,
  JULIUS_RUN_STATES,
  compareJuliusMetric,
  compareJuliusRuns,
  safeJuliusRunState,
  type JuliusMetricComparison,
  type JuliusRunFacts,
} from './julius-run-comparison';

/**
 * COMPARING TWO PAID RUNS — THE SPECIFICATION.
 *
 * The rule the whole module exists to hold: A COMPARISON NEVER MANUFACTURES A
 * NUMBER. A known cost that is a floor is not compared, because the difference
 * of two floors is not a difference. Money settled under two allocation
 * policies is not compared, because the two figures were not measuring the
 * same thing. A role that never ran, or a tick count that was never recorded,
 * is unknown and not zero. Every case below is about one of those refusals or
 * about the deltas the module does stand behind.
 *
 * INPUTS COME FROM THE REAL COST MODULE. `juliusCostComponent` and
 * `summariseJuliusMissionCost` are the repository's own, sliced into this
 * workspace byte for byte; the facts below are built with them so the
 * comparator is tested against the completeness rules the product actually
 * applies, not against a hand-made imitation of them.
 */

/* ------------------------------------------------------------- fixtures */

type Component = { taskId: string; role: string | null; usdMicros?: number; estimatedUsdMicros?: number; basis?: string };

const cost = (components: readonly Component[]): JuliusMissionCost =>
  summariseJuliusMissionCost(components.map((component) => juliusCostComponent(component)));

const V1 = 'julius-allocation.v1';
const V3 = 'julius-allocation.v3';

/** A complete run: every component reported a spend basis with a figure. */
const complete = (overrides: Partial<JuliusRunFacts> = {}): JuliusRunFacts => ({
  runId: 'run:before',
  allocationPolicy: V3,
  state: 'COMPLETED',
  ticks: 7,
  cost: cost([
    { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 300_000, basis: 'PROVIDER_REPORTED' },
    { taskId: 'build', role: 'CODING_AGENT', usdMicros: 5_177_120, basis: 'PROVIDER_REPORTED' },
    { taskId: 'review', role: 'INDEPENDENT_REVIEWER', usdMicros: 120_000, basis: 'PROVIDER_REPORTED' },
  ]),
  ...overrides,
});

/** The same run with the reviewer having reported nothing: a floor, not a total. */
const incomplete = (overrides: Partial<JuliusRunFacts> = {}): JuliusRunFacts => complete({
  cost: cost([
    { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 300_000, basis: 'PROVIDER_REPORTED' },
    { taskId: 'build', role: 'CODING_AGENT', usdMicros: 5_177_120, basis: 'PROVIDER_REPORTED' },
    { taskId: 'review', role: 'INDEPENDENT_REVIEWER', basis: 'UNKNOWN' },
  ]),
  ...overrides,
});

const after = (facts: JuliusRunFacts, overrides: Partial<JuliusRunFacts> = {}): JuliusRunFacts =>
  ({ ...facts, runId: 'run:after', ...overrides });

const kindOf = (comparison: JuliusMetricComparison): string => comparison.kind;
const delta = (comparison: JuliusMetricComparison): { before: number; after: number; delta: number; direction: string } => {
  assert.equal(comparison.kind, 'DELTA', `expected a DELTA, got ${JSON.stringify(comparison)}`);
  if (comparison.kind !== 'DELTA') throw new Error('unreachable');
  return { before: comparison.before, after: comparison.after, delta: comparison.delta, direction: comparison.direction };
};
const reasonOf = (comparison: JuliusMetricComparison): string => {
  assert.notEqual(comparison.kind, 'DELTA', `expected a refusal, got ${JSON.stringify(comparison)}`);
  if (comparison.kind === 'DELTA') throw new Error('unreachable');
  return comparison.reason;
};
const roleOf = (comparison: ReturnType<typeof compareJuliusRuns>, role: string | null) => {
  const found = comparison.byRole.find((entry) => entry.role === role);
  assert.ok(found, `role ${String(role)} must be compared`);
  return found!;
};

/* --------------------------------------------------------- vocabularies */

test('the version and the vocabularies are the declared ones, and closed', () => {
  assert.equal(JULIUS_RUN_COMPARISON_VERSION, 'julius-run-comparison.v1');
  assert.deepEqual([...JULIUS_RUN_STATES], ['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN']);
  assert.deepEqual([...JULIUS_COMPARISON_KINDS], ['DELTA', 'UNKNOWN', 'NOT_COMPARABLE']);
  assert.deepEqual([...JULIUS_COMPARISON_DIRECTIONS], ['IMPROVED', 'REGRESSED', 'UNCHANGED', 'NEUTRAL']);
  assert.deepEqual([...JULIUS_OUTCOME_DIRECTIONS], ['IMPROVED', 'REGRESSED', 'UNCHANGED', 'UNKNOWN']);
  assert.deepEqual([...JULIUS_COMPARED_METRICS], ['knownUsdMicros', 'estimatedUsdMicros', 'unknownComponents', 'components', 'ticks']);
});

test('the polarity table names every compared metric, and money and unknowns are better lower', () => {
  for (const metric of JULIUS_COMPARED_METRICS) assert.ok(metric in JULIUS_METRIC_POLARITY, metric);
  assert.equal(JULIUS_METRIC_POLARITY.knownUsdMicros, 'LOWER_IS_BETTER');
  assert.equal(JULIUS_METRIC_POLARITY.estimatedUsdMicros, 'LOWER_IS_BETTER');
  assert.equal(JULIUS_METRIC_POLARITY.unknownComponents, 'LOWER_IS_BETTER');
  assert.equal(JULIUS_METRIC_POLARITY.ticks, 'LOWER_IS_BETTER');
  assert.equal(JULIUS_METRIC_POLARITY.components, 'NEUTRAL');
});

test('a run state is read against the closed set, and a word outside it is UNKNOWN', () => {
  assert.equal(safeJuliusRunState('COMPLETED'), 'COMPLETED');
  assert.equal(safeJuliusRunState('FAILED'), 'FAILED');
  assert.equal(safeJuliusRunState('CANCELLED'), 'CANCELLED');
  assert.equal(safeJuliusRunState('completed'), 'UNKNOWN');
  assert.equal(safeJuliusRunState('SUCCEEDED'), 'UNKNOWN');
  assert.equal(safeJuliusRunState(''), 'UNKNOWN');
  assert.equal(safeJuliusRunState(null), 'UNKNOWN');
  assert.equal(safeJuliusRunState(undefined), 'UNKNOWN');
  assert.equal(safeJuliusRunState(1), 'UNKNOWN');
});

/* ---------------------------------------------------- one metric at a time */

test('a metric compared on both sides is a DELTA of after minus before', () => {
  const d = delta(compareJuliusMetric('knownUsdMicros', 100, 80));
  assert.deepEqual(d, { before: 100, after: 80, delta: -20, direction: 'IMPROVED' });
});

test('a lower-is-better metric that rose is a REGRESSION, and one that held is UNCHANGED', () => {
  assert.equal(delta(compareJuliusMetric('ticks', 5, 9)).direction, 'REGRESSED');
  assert.equal(delta(compareJuliusMetric('unknownComponents', 3, 3)).direction, 'UNCHANGED');
  assert.equal(delta(compareJuliusMetric('unknownComponents', 3, 3)).delta, 0);
});

test('a neutral metric that changed is NEUTRAL, never an improvement or a regression', () => {
  assert.equal(delta(compareJuliusMetric('components', 6, 9)).direction, 'NEUTRAL');
  assert.equal(delta(compareJuliusMetric('components', 9, 6)).direction, 'NEUTRAL');
  assert.equal(delta(compareJuliusMetric('components', 6, 6)).direction, 'UNCHANGED');
});

test('a metric missing on one side is UNKNOWN and names the side, never zero', () => {
  assert.equal(kindOf(compareJuliusMetric('ticks', null, 7)), 'UNKNOWN');
  assert.equal(reasonOf(compareJuliusMetric('ticks', null, 7)), 'ticks_unknown_before');
  assert.equal(reasonOf(compareJuliusMetric('ticks', 7, null)), 'ticks_unknown_after');
  assert.equal(reasonOf(compareJuliusMetric('ticks', null, null)), 'ticks_unknown_both');
  assert.equal(reasonOf(compareJuliusMetric('knownUsdMicros', null, 0)), 'knownUsdMicros_unknown_before');
});

test('an UNKNOWN or NOT_COMPARABLE metric carries no delta, before or after at all', () => {
  const unknown = compareJuliusMetric('ticks', null, 7) as unknown as Record<string, unknown>;
  assert.equal(unknown.kind, 'UNKNOWN');
  for (const key of ['delta', 'before', 'after', 'direction']) assert.equal(key in unknown, false, key);
});

test('a non-finite or negative number on either side is UNKNOWN, never compared', () => {
  assert.equal(kindOf(compareJuliusMetric('ticks', Number.NaN, 7)), 'UNKNOWN');
  assert.equal(kindOf(compareJuliusMetric('ticks', 7, Number.POSITIVE_INFINITY)), 'UNKNOWN');
  assert.equal(kindOf(compareJuliusMetric('knownUsdMicros', -1, 7)), 'UNKNOWN');
});

/* ------------------------------------------------- the mission as a whole */

test('identical complete runs compare as unchanged on every metric, and are scorable', () => {
  const before = complete();
  const comparison = compareJuliusRuns(before, after(before));
  assert.equal(comparison.version, 'julius-run-comparison.v1');
  assert.equal(comparison.before, 'run:before');
  assert.equal(comparison.after, 'run:after');
  assert.equal(comparison.moneyComparable, true);
  for (const metric of ['knownUsdMicros', 'estimatedUsdMicros', 'unknownComponents', 'components', 'ticks'] as const) {
    assert.equal(delta(comparison[metric]).direction, 'UNCHANGED', metric);
    assert.equal(delta(comparison[metric]).delta, 0, metric);
  }
  assert.deepEqual(comparison.outcome, { before: 'COMPLETED', after: 'COMPLETED', direction: 'UNCHANGED' });
  assert.equal(comparison.scorable, true);
});

test('a lower known cost after is an improvement, with the mission floor never in play', () => {
  const before = complete();
  const cheaper = after(before, {
    cost: cost([
      { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 300_000, basis: 'PROVIDER_REPORTED' },
      { taskId: 'build', role: 'CODING_AGENT', usdMicros: 1_390_954, basis: 'PROVIDER_REPORTED' },
      { taskId: 'review', role: 'INDEPENDENT_REVIEWER', usdMicros: 120_000, basis: 'PROVIDER_REPORTED' },
    ]),
  });
  const comparison = compareJuliusRuns(before, cheaper);
  assert.deepEqual(delta(comparison.knownUsdMicros), {
    before: 5_597_120, after: 1_810_954, delta: 1_810_954 - 5_597_120, direction: 'IMPROVED',
  });
  assert.equal(comparison.scorable, true);
});

test('an incomplete known cost is UNKNOWN, never a delta between two floors', () => {
  const beforeSide = compareJuliusRuns(incomplete(), after(complete()));
  assert.equal(kindOf(beforeSide.knownUsdMicros), 'UNKNOWN');
  assert.equal(reasonOf(beforeSide.knownUsdMicros), 'cost_incomplete_before');
  assert.equal(kindOf(beforeSide.estimatedUsdMicros), 'DELTA', 'estimated cost is its own axis, not a floor');
  assert.equal(beforeSide.scorable, false);

  const afterSide = compareJuliusRuns(complete(), after(incomplete()));
  assert.equal(reasonOf(afterSide.knownUsdMicros), 'cost_incomplete_after');

  const both = compareJuliusRuns(incomplete(), after(incomplete()));
  assert.equal(reasonOf(both.knownUsdMicros), 'cost_incomplete_both');
});

test('the floor is still reported where it belongs: unknown components are compared as a count', () => {
  // Mission 5 had five unreported components; a run that reports every one is an improvement on that axis.
  const comparison = compareJuliusRuns(incomplete(), after(complete()));
  assert.deepEqual(delta(comparison.unknownComponents), { before: 1, after: 0, delta: -1, direction: 'IMPROVED' });
  assert.equal(delta(comparison.components).direction, 'UNCHANGED');
});

test('money under different allocation policies is NOT COMPARABLE, even when both are complete', () => {
  const comparison = compareJuliusRuns(complete({ allocationPolicy: V1 }), after(complete({ allocationPolicy: V3 })));
  assert.equal(comparison.moneyComparable, false);
  assert.equal(kindOf(comparison.knownUsdMicros), 'NOT_COMPARABLE');
  assert.equal(kindOf(comparison.estimatedUsdMicros), 'NOT_COMPARABLE');
  const reason = reasonOf(comparison.knownUsdMicros);
  assert.ok(reason.startsWith('allocation_policy_differs'), reason);
  assert.ok(reason.includes(V1) && reason.includes(V3), 'the reason names both policies');
  // Counts and ticks are not money and stay comparable.
  assert.equal(kindOf(comparison.unknownComponents), 'DELTA');
  assert.equal(kindOf(comparison.components), 'DELTA');
  assert.equal(kindOf(comparison.ticks), 'DELTA');
  assert.equal(comparison.scorable, false);
});

test('differing policies refuse money before completeness is even asked', () => {
  const comparison = compareJuliusRuns(incomplete({ allocationPolicy: V1 }), after(incomplete({ allocationPolicy: V3 })));
  assert.equal(kindOf(comparison.knownUsdMicros), 'NOT_COMPARABLE');
});

test('an unknown allocation policy makes money NOT COMPARABLE', () => {
  assert.equal(reasonOf(compareJuliusRuns(complete({ allocationPolicy: null }), after(complete())).knownUsdMicros), 'allocation_policy_unknown_before');
  assert.equal(reasonOf(compareJuliusRuns(complete(), after(complete({ allocationPolicy: null }))).knownUsdMicros), 'allocation_policy_unknown_after');
  assert.equal(reasonOf(compareJuliusRuns(complete({ allocationPolicy: null }), after(complete({ allocationPolicy: null }))).knownUsdMicros), 'allocation_policy_unknown_both');
  assert.equal(compareJuliusRuns(complete({ allocationPolicy: null }), after(complete())).moneyComparable, false);
});

test('estimated cost is its own axis: an estimate is compared as an estimate and never enters the known total', () => {
  // The cost module counts a harness-estimated component as one that reported
  // no spend, so a run carrying an estimate is never complete and its known
  // total is a floor. The estimate itself is still a number a harness stated,
  // and two of them compare on their own axis.
  const before = complete({
    cost: cost([
      { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 100, basis: 'PROVIDER_REPORTED' },
      { taskId: 'review', role: 'INDEPENDENT_REVIEWER', estimatedUsdMicros: 100, basis: 'ESTIMATED' },
    ]),
  });
  const next = after(before, {
    cost: cost([
      { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 200, basis: 'PROVIDER_REPORTED' },
      { taskId: 'review', role: 'INDEPENDENT_REVIEWER', estimatedUsdMicros: 0, basis: 'ESTIMATED' },
    ]),
  });
  const comparison = compareJuliusRuns(before, next);
  assert.equal(reasonOf(comparison.knownUsdMicros), 'cost_incomplete_both');
  assert.deepEqual(delta(comparison.estimatedUsdMicros), { before: 100, after: 0, delta: -100, direction: 'IMPROVED' });
  assert.deepEqual(delta(comparison.unknownComponents), { before: 1, after: 1, delta: 0, direction: 'UNCHANGED' });
});

test('unknown ticks are UNKNOWN, never zero', () => {
  const comparison = compareJuliusRuns(complete({ ticks: null }), after(complete()));
  assert.equal(reasonOf(comparison.ticks), 'ticks_unknown_before');
  assert.equal(comparison.scorable, false);
  assert.equal(reasonOf(compareJuliusRuns(complete(), after(complete({ ticks: null }))).ticks), 'ticks_unknown_after');
});

test('fewer ticks after is an improvement', () => {
  assert.deepEqual(delta(compareJuliusRuns(complete({ ticks: 7 }), after(complete({ ticks: 5 }))).ticks),
    { before: 7, after: 5, delta: -2, direction: 'IMPROVED' });
});

/* ---------------------------------------------------------------- outcome */

test('reaching COMPLETED from a run that did not is an improvement, and losing it is a regression', () => {
  assert.equal(compareJuliusRuns(complete({ state: 'FAILED' }), after(complete())).outcome.direction, 'IMPROVED');
  assert.equal(compareJuliusRuns(complete(), after(complete({ state: 'FAILED' }))).outcome.direction, 'REGRESSED');
  assert.equal(compareJuliusRuns(complete(), after(complete({ state: 'CANCELLED' }))).outcome.direction, 'REGRESSED');
});

test('two runs that both fell short compare as unchanged, whatever the manner', () => {
  const comparison = compareJuliusRuns(complete({ state: 'FAILED' }), after(complete({ state: 'CANCELLED' })));
  assert.deepEqual(comparison.outcome, { before: 'FAILED', after: 'CANCELLED', direction: 'UNCHANGED' });
});

test('an unknown state makes the outcome UNKNOWN and the comparison unscorable', () => {
  const comparison = compareJuliusRuns(complete({ state: 'UNKNOWN' }), after(complete()));
  assert.equal(comparison.outcome.direction, 'UNKNOWN');
  assert.equal(comparison.scorable, false);
});

/* ------------------------------------------------------------------ roles */

test('every role either run had is compared, in a deterministic order with the unattributed last', () => {
  const before = complete({
    cost: cost([
      { taskId: 'x', role: null, usdMicros: 1, basis: 'PROVIDER_REPORTED' },
      { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 1, basis: 'PROVIDER_REPORTED' },
      { taskId: 'build', role: 'CODING_AGENT', usdMicros: 1, basis: 'PROVIDER_REPORTED' },
    ]),
  });
  const next = after(before, {
    cost: cost([
      { taskId: 'review', role: 'INDEPENDENT_REVIEWER', usdMicros: 1, basis: 'PROVIDER_REPORTED' },
      { taskId: 'build', role: 'CODING_AGENT', usdMicros: 1, basis: 'PROVIDER_REPORTED' },
    ]),
  });
  const comparison = compareJuliusRuns(before, next);
  assert.deepEqual(comparison.byRole.map((entry) => entry.role), ['CODING_AGENT', 'INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT', null]);
});

test('a role absent from one run is UNKNOWN there, never a cost of zero', () => {
  const before = complete();
  const next = after(before, {
    cost: cost([
      { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 300_000, basis: 'PROVIDER_REPORTED' },
      { taskId: 'build', role: 'CODING_AGENT', usdMicros: 5_177_120, basis: 'PROVIDER_REPORTED' },
    ]),
  });
  const comparison = compareJuliusRuns(before, next);
  const reviewer = roleOf(comparison, 'INDEPENDENT_REVIEWER');
  for (const metric of ['knownUsdMicros', 'estimatedUsdMicros', 'unknownComponents', 'components'] as const) {
    assert.equal(kindOf(reviewer[metric]), 'UNKNOWN', metric);
    assert.equal(reasonOf(reviewer[metric]), 'role_absent_after', metric);
  }
  assert.equal(reasonOf(roleOf(compareJuliusRuns(next, before), 'INDEPENDENT_REVIEWER').knownUsdMicros), 'role_absent_before');
  assert.equal(comparison.scorable, false);
});

test('a role present on both sides is compared on its own four metrics', () => {
  const before = complete();
  const next = after(before, {
    cost: cost([
      { taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 300_000, basis: 'PROVIDER_REPORTED' },
      { taskId: 'build', role: 'CODING_AGENT', usdMicros: 2_000_000, basis: 'PROVIDER_REPORTED' },
      { taskId: 'build-2', role: 'CODING_AGENT', usdMicros: 1_000_000, basis: 'PROVIDER_REPORTED' },
      { taskId: 'review', role: 'INDEPENDENT_REVIEWER', usdMicros: 120_000, basis: 'PROVIDER_REPORTED' },
    ]),
  });
  const coder = roleOf(compareJuliusRuns(before, next), 'CODING_AGENT');
  assert.deepEqual(delta(coder.knownUsdMicros), { before: 5_177_120, after: 3_000_000, delta: 3_000_000 - 5_177_120, direction: 'IMPROVED' });
  assert.deepEqual(delta(coder.components), { before: 1, after: 2, delta: 1, direction: 'NEUTRAL' });
  assert.equal(delta(coder.unknownComponents).direction, 'UNCHANGED');
});

test("a role's money is UNKNOWN when that role reported nothing on either side, and the other roles are untouched", () => {
  const comparison = compareJuliusRuns(incomplete(), after(complete()));
  const reviewer = roleOf(comparison, 'INDEPENDENT_REVIEWER');
  assert.equal(reasonOf(reviewer.knownUsdMicros), 'role_cost_incomplete_before');
  assert.equal(kindOf(reviewer.estimatedUsdMicros), 'DELTA', 'an estimate is compared as an estimate');
  assert.deepEqual(delta(reviewer.unknownComponents), { before: 1, after: 0, delta: -1, direction: 'IMPROVED' });
  // The coder reported on both sides, so its money is a DELTA even though the mission's is a floor.
  assert.equal(delta(roleOf(comparison, 'CODING_AGENT').knownUsdMicros).direction, 'UNCHANGED');
  assert.equal(reasonOf(roleOf(compareJuliusRuns(complete(), after(incomplete())), 'INDEPENDENT_REVIEWER').knownUsdMicros), 'role_cost_incomplete_after');
  assert.equal(reasonOf(roleOf(compareJuliusRuns(incomplete(), after(incomplete())), 'INDEPENDENT_REVIEWER').knownUsdMicros), 'role_cost_incomplete_both');
});

test("a role's money under differing policies is NOT COMPARABLE like the mission's", () => {
  const comparison = compareJuliusRuns(complete({ allocationPolicy: V1 }), after(complete({ allocationPolicy: V3 })));
  assert.equal(kindOf(roleOf(comparison, 'CODING_AGENT').knownUsdMicros), 'NOT_COMPARABLE');
  assert.equal(kindOf(roleOf(comparison, 'CODING_AGENT').components), 'DELTA');
});

/* ----------------------------------------------------------------- purity */

test('the inputs are not mutated, and the same inputs compare the same way twice', () => {
  const freeze = <T,>(value: T): T => {
    if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value as object)) freeze((value as Record<string, unknown>)[key]);
      Object.freeze(value);
    }
    return value;
  };
  const before = freeze(incomplete({ allocationPolicy: V1 }));
  const next = freeze(after(complete({ allocationPolicy: V3, ticks: null, state: 'FAILED' })));
  const snapshot = JSON.stringify([before, next]);
  const first = compareJuliusRuns(before, next);
  const second = compareJuliusRuns(before, next);
  assert.equal(JSON.stringify([before, next]), snapshot, 'inputs unchanged');
  assert.deepEqual(first, second);
});

test('an empty run compares: no roles, complete, and a scorable unchanged comparison', () => {
  const empty = complete({ cost: cost([]) });
  const comparison = compareJuliusRuns(empty, after(empty));
  assert.deepEqual(comparison.byRole, []);
  assert.equal(delta(comparison.components).delta, 0);
  assert.equal(comparison.scorable, true);
});

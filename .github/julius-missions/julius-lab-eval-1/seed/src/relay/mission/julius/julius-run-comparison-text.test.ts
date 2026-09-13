import { test } from 'node:test';
import assert from 'node:assert/strict';
import { juliusCostComponent, summariseJuliusMissionCost } from './julius-cost-accounting';
import { compareJuliusRuns, type JuliusRunComparison, type JuliusRunFacts } from './julius-run-comparison';
import {
  JULIUS_RUN_COMPARISON_TEXT_VERSION,
  describeJuliusMetric,
  describeJuliusRunComparison,
} from './julius-run-comparison-text';

/**
 * THE SENTENCES — THE SPECIFICATION.
 *
 * The renderer computes nothing. It reads a comparison and prints it in a
 * form that cannot be misread: every DELTA with a sign and a direction, every
 * UNKNOWN with its reason and the words "unknown is not zero", every
 * NOT_COMPARABLE with its reason and no number. It depends on the comparator
 * being implemented, which is why this file's cases build real comparisons.
 */

const facts = (runId: string, overrides: Partial<JuliusRunFacts> = {}): JuliusRunFacts => ({
  runId,
  allocationPolicy: 'julius-allocation.v3',
  state: 'COMPLETED',
  ticks: 7,
  cost: summariseJuliusMissionCost([
    juliusCostComponent({ taskId: 'plan', role: 'PROMPT_ARCHITECT', usdMicros: 300_000, basis: 'PROVIDER_REPORTED' }),
    juliusCostComponent({ taskId: 'build', role: 'CODING_AGENT', usdMicros: 5_177_120, basis: 'PROVIDER_REPORTED' }),
  ]),
  ...overrides,
});

const scorable = (): JuliusRunComparison => compareJuliusRuns(facts('run:a'), facts('run:b', { ticks: 5 }));

test('the version is the declared one', () => {
  assert.equal(JULIUS_RUN_COMPARISON_TEXT_VERSION, 'julius-run-comparison-text.v1');
});

test('a DELTA prints before, after, the signed delta and the direction, in that form', () => {
  assert.equal(
    describeJuliusMetric('known cost', { kind: 'DELTA', before: 100, after: 80, delta: -20, direction: 'IMPROVED' }),
    'known cost: 100 → 80 (-20, IMPROVED)',
  );
  assert.equal(
    describeJuliusMetric('ticks', { kind: 'DELTA', before: 5, after: 9, delta: 4, direction: 'REGRESSED' }),
    'ticks: 5 → 9 (+4, REGRESSED)',
  );
  assert.equal(
    describeJuliusMetric('components', { kind: 'DELTA', before: 6, after: 6, delta: 0, direction: 'UNCHANGED' }),
    'components: 6 → 6 (+0, UNCHANGED)',
  );
});

test('an UNKNOWN prints its reason and says that unknown is not zero, and prints no number', () => {
  const text = describeJuliusMetric('known cost', { kind: 'UNKNOWN', reason: 'cost_incomplete_before' });
  assert.equal(text, 'known cost: unknown (cost_incomplete_before) — unknown is not zero');
  assert.equal(/\d/u.test(text), false, 'no digit may appear in an unknown metric');
});

test('a NOT_COMPARABLE prints its reason and no number', () => {
  const text = describeJuliusMetric('known cost', { kind: 'NOT_COMPARABLE', reason: 'allocation_policy_differs:julius-allocation.v1:julius-allocation.v3' });
  assert.equal(text, 'known cost: not comparable (allocation_policy_differs:julius-allocation.v1:julius-allocation.v3)');
  assert.equal(/\b\d+\b/u.test(text.replace(/v\d/gu, '')), false, 'no bare number may appear');
});

test('the paragraph names both runs, the outcome, every mission metric and every role', () => {
  const text = describeJuliusRunComparison(scorable());
  assert.ok(text.startsWith('Run run:a → run:b: outcome COMPLETED → COMPLETED (UNCHANGED).'), text);
  for (const label of ['known cost', 'estimated cost', 'unknown components', 'components', 'ticks']) {
    assert.ok(text.includes(`${label}:`), `mission metric ${label}`);
  }
  assert.ok(text.includes('ticks: 7 → 5 (-2, IMPROVED)'), text);
  assert.ok(text.includes('CODING_AGENT known cost:'), 'each role is named with its metric');
  assert.ok(text.includes('PROMPT_ARCHITECT known cost:'), text);
});

test('a comparison that is comparable in full says so, and nothing else hedges it', () => {
  const text = describeJuliusRunComparison(scorable());
  assert.ok(text.endsWith('Comparable in full.'), text);
  assert.equal(text.includes('unknown is not zero'), false);
  assert.equal(text.includes('not comparable'), false);
});

test('a comparison with an unknown metric hedges once at the end and never prints that metric as a number', () => {
  const comparison = compareJuliusRuns(facts('run:a', { ticks: null }), facts('run:b'));
  const text = describeJuliusRunComparison(comparison);
  assert.ok(text.includes('ticks: unknown (ticks_unknown_before) — unknown is not zero'), text);
  assert.ok(text.endsWith('Not comparable in full: 1 metric(s) unknown, 0 not comparable.'), text);
});

test('a comparison across allocation policies hedges on money and names the policies', () => {
  const comparison = compareJuliusRuns(facts('run:a', { allocationPolicy: 'julius-allocation.v1' }), facts('run:b'));
  const text = describeJuliusRunComparison(comparison);
  assert.ok(text.includes('known cost: not comparable (allocation_policy_differs:julius-allocation.v1:julius-allocation.v3)'), text);
  assert.ok(text.includes('julius-allocation.v1') && text.includes('julius-allocation.v3'));
  // Mission money (2) and each of the two roles' money (2 × 2) are refused: six metrics.
  assert.ok(text.endsWith('Not comparable in full: 0 metric(s) unknown, 6 not comparable.'), text);
});

test('the unattributed role is printed as unattributed, never as null', () => {
  const before = facts('run:a', {
    cost: summariseJuliusMissionCost([juliusCostComponent({ taskId: 'x', role: null, usdMicros: 1, basis: 'PROVIDER_REPORTED' })]),
  });
  const text = describeJuliusRunComparison(compareJuliusRuns(before, facts('run:b', { cost: before.cost })));
  assert.ok(text.includes('unattributed known cost:'), text);
  assert.equal(text.includes('null'), false);
});

test('the renderer is deterministic and mutates nothing', () => {
  const comparison = scorable();
  const snapshot = JSON.stringify(comparison);
  const first = describeJuliusRunComparison(comparison);
  const second = describeJuliusRunComparison(comparison);
  assert.equal(first, second);
  assert.equal(JSON.stringify(comparison), snapshot);
});

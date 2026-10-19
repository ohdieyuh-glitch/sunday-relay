import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateLoopCompletion } from './mission/loop/loop-completion.ts';
import { authorizeScheduledSpend } from './mission/loop/cron/cron-budget.ts';
import { planLoopPass, readIsoInstantWithOffset } from './mission/loop/runtime/loop-scheduler.ts';
import { authorizeScheduledOperation } from './mission/loop/cron/cron-approvals.ts';

/**
 * FOUR LATENT DEFECTS IN THE LOOP ENGINE'S GATES: THE SPECIFICATION.
 *
 * Each gate is real Relay code whose own header states the rule. The tests pin the MAIN behaviour of each fix and the controls
 * every fix must keep; the acceptance criteria in the contract state the wider invariants in words.
 *
 *   A. COMPLETION. Only a trust shortfall is `claimed_complete`; a failed fact about the work is `incomplete`.
 *   B. PAUSE THRESHOLD. The automatic pause is never applied later than the fraction configured.
 *   C. INSTANTS. A calendar date that does not exist is not an instant.
 *   D. NOTHING SUPPORTS COMPLETION. With no blocking criteria, a Loop with no evidence above "observed" is never verified complete.
 */

/* ------------------------------------------------------------------------------------------------- A: completion verdict */

const COMPLETION = {
  completionRule: 'all_blocking_criteria_and_independent_review',
  acceptanceCriteria: [{ id: 'c1', blocking: true }],
  evidence: [{ evidenceId: 'evd_1', sourceTrust: 'claim', criterionIds: ['c1'] }],
  iterations: [{ iterationId: 'lpi_1', outcome: 'completed' }],
  missionVerdict: 'verified_complete',
  openBlockingFindings: 0,
  independentReviewRequired: true,
  reviewOccurred: true,
  reviewApproved: true,
  reviewerWasIndependent: true,
  terminalWriteDurable: true,
} as const;
const NO_REVIEW = {
  completionRule: 'all_blocking_criteria', independentReviewRequired: false,
  reviewOccurred: false, reviewApproved: false, reviewerWasIndependent: false,
} as const;
const verdictOf = (over: Record<string, unknown>) => evaluateLoopCompletion({ ...COMPLETION, ...over } as never);

test('A: control: a Loop whose ONLY shortfall is trust is claimed_complete, and says which criteria lack support', () => {
  const r = verdictOf({});
  assert.equal(r.verdict, 'claimed_complete');
  assert.deepEqual(r.unsupportedBlockingCriterionIds, ['c1']);
  assert.equal(r.reasons.length, 1);
});

test('A: control: with no review required (the review flags all false), a trust shortfall is still claimed_complete', () => {
  assert.equal(verdictOf(NO_REVIEW).verdict, 'claimed_complete');
});

test('A: an independent review that REJECTED the work is not a trust shortfall: incomplete, with both failures reported', () => {
  const r = verdictOf({ reviewApproved: false });
  assert.equal(r.verdict, 'incomplete');
  assert.equal(r.reasons.length, 2);
  assert.deepEqual(r.unsupportedBlockingCriterionIds, ['c1']);
  assert.equal(verdictOf({ reviewApproved: false, reviewerWasIndependent: false }).verdict, 'incomplete');
});

test('A: a terminal write that is not durable is not a trust shortfall: incomplete', () => {
  assert.equal(verdictOf({ terminalWriteDurable: false }).verdict, 'incomplete');
});

test('A: a FAILED, blocked, needs-human, partial or Unknown mission verdict is not a trust shortfall: incomplete', () => {
  for (const missionVerdict of ['failed', 'blocked', 'needs_human', 'partially_complete', null]) {
    assert.equal(verdictOf({ missionVerdict }).verdict, 'incomplete', String(missionVerdict));
  }
});

test('A: claim-only evidence with no blocking criteria and a non-durable terminal write is incomplete (the failing check is not trust)', () => {
  const r = verdictOf({ ...NO_REVIEW, acceptanceCriteria: [{ id: 'c1', blocking: false }], terminalWriteDurable: false });
  assert.equal(r.verdict, 'incomplete');
});

/* ------------------------------------------------------------------------------------- D: nothing supports completion */

test('D: with no blocking criteria, claim-only, observed-only or no evidence is never verified complete, and the verdict says why', () => {
  for (const acceptanceCriteria of [[], [{ id: 'c1', blocking: false }]]) {
    for (const evidence of [
      [{ evidenceId: 'e1', sourceTrust: 'claim', criterionIds: ['c1'] }],
      [{ evidenceId: 'e1', sourceTrust: 'observed', criterionIds: ['c1'] }],
      [],
    ]) {
      const r = verdictOf({ ...NO_REVIEW, acceptanceCriteria, evidence });
      const label = `${JSON.stringify(acceptanceCriteria)} ${JSON.stringify(evidence)}`;
      assert.notEqual(r.verdict, 'verified_complete', label);
      assert.ok(r.reasons.length > 0, label);
    }
  }
});

test('D: control: a blocking criterion with attested evidence still verifies', () => {
  const r = verdictOf({ evidence: [{ evidenceId: 'e1', sourceTrust: 'attested', criterionIds: ['c1'] }] });
  assert.equal(r.verdict, 'verified_complete');
  assert.deepEqual(r.reasons, []);
});

/* ---------------------------------------------------------------------------------------------------- B: pause threshold */

const UNBOUNDED = { capMicros: null, spentMicros: null };
const spend = (autoPauseAtFraction: number, capMicros: string, spentMicros: string) => authorizeScheduledSpend({
  runCapMicros: '1', reservedReviewerMicros: null, simultaneousRuns: 0, maxSimultaneousRuns: 3, emergencyGuardEngaged: false,
  autoPauseAtFraction,
  windows: { per_run: UNBOUNDED, per_day: { capMicros, spentMicros }, per_week: UNBOUNDED, per_billing_period: UNBOUNDED },
});
const reasons = (d: ReturnType<typeof authorizeScheduledSpend>): string[] => (d.kind === 'budget_blocked' ? d.refusals.map((r) => r.reason) : []);

test('B: control: a six-decimal fraction is compared exactly, as written: it pauses AT it and not one part per million below it', () => {
  assert.equal(spend(0.666667, '3', '2').kind, 'authorized');
  assert.deepEqual(reasons(spend(0.666666, '3', '2')), ['auto_pause_threshold_reached']);
  for (const [fraction, at] of [[0.666667, 666667], [0.1, 100000], [0.7, 700000], [0.000249, 249], [0.000251, 251], [0.000489, 489]] as const) {
    assert.deepEqual(reasons(spend(fraction, '1000000', String(at))), ['auto_pause_threshold_reached'], `${fraction} at ${at}`);
    assert.equal(spend(fraction, '1000000', String(at - 1)).kind, 'authorized', `${fraction} at ${at - 1}`);
  }
  assert.deepEqual(reasons(spend(1, '1000000', '999999')), []);
});

test('B: control: the comparison is exact on any number of micros', () => {
  assert.deepEqual(reasons(spend(0.8, '45035996273704965', '36028797018963972')), ['auto_pause_threshold_reached']);
  assert.equal(spend(0.8, '45035996273704965', '36028797018963971').kind, 'authorized');
});

test('B: a spend at or past a finer-than-ppm fraction never authorizes (the threshold never moves UP)', () => {
  assert.equal(spend(0.6666666, '3', '2').kind, 'budget_blocked');
  assert.equal(spend(0.9999999, '10000000', '9999999').kind, 'budget_blocked');
  assert.equal(spend(0.0000015, '10000000', '15').kind, 'budget_blocked');
  assert.equal(spend(0.1234566, '10000000', '1234567').kind, 'budget_blocked');
  assert.equal(spend(0.999999999999999, '1000000000000000', '999999999999999').kind, 'budget_blocked');
  assert.equal(spend(0.0000019999999999999, '10000000000000000000', '19999999999999').kind, 'budget_blocked');
});

test('B: a window that has spent nothing never reaches the pause threshold, whatever the fraction', () => {
  for (const fraction of [0.0000006, 0.000001, 0.0000015, 0.6666666, 0.9999999]) {
    assert.ok(!reasons(spend(fraction, '10000000', '0')).includes('auto_pause_threshold_reached'), String(fraction));
  }
});

/* ------------------------------------------------------------------------------------------------------------ C: instants */

test('C: a calendar date that does not exist is not an instant', () => {
  for (const text of [
    '2026-02-29T00:00:00Z', '2100-02-29T00:00Z', '1900-02-29T00:00Z', '0100-02-29T00:00Z', '0001-02-29T00:00Z',
    '2026-02-30T00:00:00.000Z', '2026-02-31T23:00+05:00', '2026-04-31T12:00Z', '2026-06-31T23:59:59-02:00', '2026-09-31T00:00Z',
    '2026-11-31T08:30:00.5Z',
  ]) assert.equal(readIsoInstantWithOffset(text), null, text);
});

test('C: control: every real instant still reads exactly as before, including leap days and offsets that cross midnight', () => {
  for (const text of [
    '2028-02-29T00:00:00Z', '2000-02-29T12:00Z', '0000-02-29T00:00Z', '0400-02-29T06:00Z', '2026-01-31T00:00Z',
    '2026-04-30T23:59:59.999Z', '2026-12-31T23:59:59.999999999Z',
    '2026-03-01T02:00+05:30', '2026-02-28T22:00-05:00', '2026-07-31T00:30:00+14:00',
  ]) assert.equal(readIsoInstantWithOffset(text), Date.parse(text), text);
  assert.equal(readIsoInstantWithOffset('2026-03-01T02:00+05:30'), Date.parse('2026-02-28T20:30:00Z'));
  for (const text of ['2026-01-01T00:00:00', '2026-13-01T00:00Z', '2026-01-32T00:00Z', 'yesterday']) {
    assert.equal(readIsoInstantWithOffset(text), null, text);
  }
});

test('C: a recurring grant whose expiry names a day that does not exist cannot be shown unexpired', () => {
  const grant = (expiresAt: string) => authorizeScheduledOperation({
    request: { scope: 'read_only_recurring_work', arguments: ['repo:x'], at: '2026-03-01T12:00:00.000Z' },
    grants: [{ scope: 'read_only_recurring_work', expiresAt, argumentScope: ['repo:x'] }],
  });
  const impossible = grant('2026-02-30T00:00:00.000Z');
  assert.equal(impossible.ok, false);
  assert.equal((impossible as { reason?: string }).reason, 'unreadable_expiry');
  assert.equal(grant('2026-03-02T00:00:00.000Z').ok, true);
});

test('C: a run stamped on a day that does not exist is excluded as unreadable, not planned', () => {
  const plan = planLoopPass([
    { runId: 'r1', lastAdvancedAt: '2026-04-31T08:00:00Z', state: 'runnable', remainingIterations: 1 },
    { runId: 'r2', lastAdvancedAt: '2026-04-30T08:00:00Z', state: 'runnable', remainingIterations: 1 },
  ], { maxRuns: 2, perRunIterations: 1 });
  assert.deepEqual(plan.claim.map((c) => c.runId), ['r2']);
  assert.deepEqual(plan.excluded, [{ runId: 'r1', reason: 'unreadable_timestamp' }]);
});

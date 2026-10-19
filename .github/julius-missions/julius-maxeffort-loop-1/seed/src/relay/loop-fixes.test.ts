import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateLoopCompletion } from './mission/loop/loop-completion.ts';
import { authorizeScheduledSpend } from './mission/loop/cron/cron-budget.ts';
import { planLoopPass, readIsoInstantWithOffset } from './mission/loop/runtime/loop-scheduler.ts';
import { authorizeScheduledOperation } from './mission/loop/cron/cron-approvals.ts';

/**
 * THREE LATENT DEFECTS IN THE LOOP ENGINE'S GATES: THE SPECIFICATION.
 *
 * Each gate is real Relay code whose own header states the rule it breaks. The tests pin the MAIN behaviour of each fix and the
 * controls every fix must keep; the acceptance criteria in the contract state the wider invariants in words.
 *
 *   A. COMPLETION. `evaluateLoopCompletion` documents that a Loop whose ONLY shortfall is trust is `claimed_complete`, but it
 *      returns `claimed_complete` for a Loop whose independent review REJECTED the work, whose mission verdict FAILED or is
 *      Unknown, or whose terminal write is not durable, as long as the evidence was a claim.
 *   B. PAUSE THRESHOLD. `authorizeScheduledSpend` rounds the configured pause fraction to the NEAREST part per million, so a
 *      fraction finer than that can move the threshold UP and the schedule keeps spending past the point it was told to pause.
 *   C. INSTANTS. `readIsoInstantWithOffset`, the one shared reader of offset-carrying instants, hands the text to `Date.parse`,
 *      which ROLLS an impossible calendar date forward: 2026-02-30 is read as 2026-03-02. An approval expiry, a missed-run
 *      instant or a run's last-advanced stamp naming a day that does not exist is read as a real, later instant.
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
const verdictOf = (over: Record<string, unknown>) => evaluateLoopCompletion({ ...COMPLETION, ...over } as never);

test('A: control: a Loop whose ONLY shortfall is trust is claimed_complete, and says which criteria lack support', () => {
  const r = verdictOf({});
  assert.equal(r.verdict, 'claimed_complete');
  assert.deepEqual(r.unsupportedBlockingCriterionIds, ['c1']);
  assert.equal(r.reasons.length, 1);
});

test('A: control: with no review required (the review flags all false), a trust shortfall is still claimed_complete', () => {
  const r = verdictOf({
    completionRule: 'all_blocking_criteria', independentReviewRequired: false,
    reviewOccurred: false, reviewApproved: false, reviewerWasIndependent: false,
  });
  assert.equal(r.verdict, 'claimed_complete');
});

test('A: an independent review that REJECTED the work is not a trust shortfall: incomplete, with both failures reported', () => {
  const r = verdictOf({ reviewApproved: false });
  assert.equal(r.verdict, 'incomplete');
  assert.equal(r.reasons.length, 2);
  assert.deepEqual(r.unsupportedBlockingCriterionIds, ['c1']);
});

test('A: a terminal write that is not durable is not a trust shortfall: incomplete', () => {
  assert.equal(verdictOf({ terminalWriteDurable: false }).verdict, 'incomplete');
});

test('A: a FAILED or Unknown mission verdict is not a trust shortfall: incomplete', () => {
  assert.equal(verdictOf({ missionVerdict: 'failed' }).verdict, 'incomplete');
  assert.equal(verdictOf({ missionVerdict: null }).verdict, 'incomplete');
});

test('A: claim-only evidence with no blocking criteria and a non-durable terminal write is incomplete (the failing check is not trust)', () => {
  const r = verdictOf({
    completionRule: 'all_blocking_criteria', acceptanceCriteria: [{ id: 'c1', blocking: false }],
    independentReviewRequired: false, reviewOccurred: false, reviewApproved: false, reviewerWasIndependent: false,
    terminalWriteDurable: false,
  });
  assert.equal(r.verdict, 'incomplete');
});

/* ---------------------------------------------------------------------------------------------------- B: pause threshold */

const UNBOUNDED = { capMicros: null, spentMicros: null };
const spend = (autoPauseAtFraction: number, capMicros: string, spentMicros: string) => authorizeScheduledSpend({
  runCapMicros: '1', reservedReviewerMicros: null, simultaneousRuns: 0, maxSimultaneousRuns: 3, emergencyGuardEngaged: false,
  autoPauseAtFraction,
  windows: { per_run: UNBOUNDED, per_day: { capMicros, spentMicros }, per_week: UNBOUNDED, per_billing_period: UNBOUNDED },
});
const reasons = (d: ReturnType<typeof authorizeScheduledSpend>): string[] => (d.kind === 'budget_blocked' ? d.refusals.map((r) => r.reason) : []);

test('B: control: a six-decimal fraction stays exact (pauses AT it, not one part per million below it)', () => {
  assert.equal(spend(0.666667, '3', '2').kind, 'authorized');
  assert.deepEqual(reasons(spend(0.666666, '3', '2')), ['auto_pause_threshold_reached']);
  assert.equal(spend(0.000249, '1000000', '248').kind, 'authorized');
  assert.deepEqual(reasons(spend(0.000249, '1000000', '249')), ['auto_pause_threshold_reached']);
  assert.deepEqual(reasons(spend(1, '1000000', '999999')), []);
});

test('B: a spend at or past a finer-than-ppm fraction never authorizes (the threshold never moves UP)', () => {
  assert.equal(spend(0.6666666, '3', '2').kind, 'budget_blocked');
  assert.equal(spend(0.9999999, '10000000', '9999999').kind, 'budget_blocked');
  assert.equal(spend(0.0000015, '10000000', '15').kind, 'budget_blocked');
  assert.equal(spend(0.1234566, '10000000', '1234567').kind, 'budget_blocked');
});

test('B: a window that has spent nothing never reaches the pause threshold, whatever the fraction', () => {
  for (const fraction of [0.0000006, 0.000001, 0.0000015, 0.6666666, 0.9999999]) {
    assert.ok(!reasons(spend(fraction, '10000000', '0')).includes('auto_pause_threshold_reached'), String(fraction));
  }
});

/* ------------------------------------------------------------------------------------------------------------ C: instants */

test('C: a calendar date that does not exist is not an instant', () => {
  for (const text of [
    '2026-02-29T00:00:00Z', '2100-02-29T00:00Z', '2026-02-30T00:00:00.000Z', '2026-02-31T23:00+05:00',
    '2026-04-31T12:00Z', '2026-06-31T23:59:59-02:00', '2026-09-31T00:00Z', '2026-11-31T08:30:00.5Z',
  ]) assert.equal(readIsoInstantWithOffset(text), null, text);
});

test('C: control: every real instant still reads exactly as before, including leap days and offsets that cross midnight', () => {
  for (const text of [
    '2028-02-29T00:00:00Z', '2000-02-29T12:00Z', '2026-01-31T00:00Z', '2026-04-30T23:59:59.999Z', '2026-12-31T23:59:59.999999999Z',
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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as gateModule from './julius-accept-review-gate';
import { juliusAcceptReviewGate, type JuliusAppliedReviewRow } from './julius-accept-review-gate';

/*
 * THE SPECIFICATION for binding an ARCHITECT_UPHELD resolution to the hold it resolves.
 *
 * `juliusAcceptReviewGate` lets held work proceed only through an ARCHITECT_UPHELD resolution of the hold. The
 * tests below say which hold, and what the pipeline must hand the gate. The tests about the unchanged behaviour
 * pass today and must keep passing.
 */

const WORK = { taskId: 'build-1', role: 'CODING_AGENT' } as const;
const HOLD_1 = 'build-1:review';
const HOLD_2 = 'build-1:review:2';
const RE_REVIEW_1 = 'rebuttal:build-1:review:task:review';
const RE_REVIEW_2 = 'rebuttal:build-1:review:2:task:review';

const applied = (over: Partial<JuliusAppliedReviewRow> = {}): JuliusAppliedReviewRow =>
  ({ reviewTaskId: HOLD_1, reviewedTaskId: 'build-1', verdict: 'CONTINUE', route: 'PROCEED', ...over });
const hold = (reviewTaskId: string): JuliusAppliedReviewRow => applied({ reviewTaskId, verdict: 'CHALLENGE', route: 'HOLD' });
const reReview = (reviewTaskId: string, rebuttal: string): JuliusAppliedReviewRow =>
  applied({ reviewTaskId, reviewedTaskId: rebuttal, verdict: 'CONTINUE', route: 'RE_REVIEW' });
const row = (evidenceId: string, taskId: string) => ({ evidenceId, taskId, type: 'REVIEW_FINDING', status: 'PASSED' }) as const;
const EVIDENCE = [row(`${HOLD_1}:1:0`, HOLD_1), row(`${HOLD_2}:1:0`, HOLD_2), row(`${RE_REVIEW_1}:1:0`, RE_REVIEW_1), row(`${RE_REVIEW_2}:1:0`, RE_REVIEW_2)];

const gate = (over: Record<string, unknown> = {}) => juliusAcceptReviewGate({
  subject: WORK, reviewerRequired: true, applied: [], upheld: [], evidence: EVIDENCE, ...over,
} as Parameters<typeof juliusAcceptReviewGate>[0]);

// An upheld entry as the gate must now receive it: it names the hold it resolves.
const upheldFor = (holdReviewTaskId: string, reReviewTaskId: string) => ({ subjectTaskId: 'build-1', reReviewTaskId, holdReviewTaskId });

describe('behaviour that does not change', () => {
  it('lets work proceed on a passing verdict, a warning, or a challenge that is not material', () => {
    for (const [verdict, route] of [['CONTINUE', 'PROCEED'], ['WARNING', 'RETAIN'], ['CHALLENGE', 'RECORD']] as const) {
      assert.equal(gate({ applied: [applied({ verdict, route })] }).outcome, 'CITED', `${verdict}/${route}`);
    }
  });

  it('refuses a hold that nothing resolved', () => {
    assert.deepEqual(gate({ applied: [hold(HOLD_1)] }), {
      outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_PASSING', reviewTaskId: HOLD_1, evidenceIds: [`${HOLD_1}:1:0`],
    });
  });

  it('is gated by the re-review that upheld the architect for the hold, never by the challenge it overruled', () => {
    assert.deepEqual(
      gate({ applied: [hold(HOLD_1), reReview(RE_REVIEW_1, 'rebuttal:build-1:review:task')], upheld: [upheldFor(HOLD_1, RE_REVIEW_1)] }),
      { outcome: 'CITED', reviewTaskId: RE_REVIEW_1, evidenceIds: [`${RE_REVIEW_1}:1:0`] },
    );
  });

  it('finds the re-review through its research continuation', () => {
    const segment = `segment:${RE_REVIEW_1}:2:task`;
    assert.deepEqual(
      gate({
        applied: [hold(HOLD_1), reReview(segment, 'rebuttal:build-1:review:task')], upheld: [upheldFor(HOLD_1, RE_REVIEW_1)],
        evidence: [...EVIDENCE, row(`${segment}:1:0`, segment)],
      }),
      { outcome: 'CITED', reviewTaskId: segment, evidenceIds: [`${segment}:1:0`] },
    );
  });

  it('does not let another subject’s upheld resolution release this subject', () => {
    const other = { subjectTaskId: 'plan-1', reReviewTaskId: RE_REVIEW_1, holdReviewTaskId: HOLD_1 };
    assert.equal(gate({ applied: [hold(HOLD_1), reReview(RE_REVIEW_1, 'rebuttal:build-1:review:task')], upheld: [other] }).outcome, 'REFUSED');
  });
});

describe('an upheld resolution is bound to the hold it resolves', () => {
  it('a resolution of an EARLIER hold does not release a LATER hold on the same subject', () => {
    const result = gate({
      applied: [hold(HOLD_1), reReview(RE_REVIEW_1, 'rebuttal:build-1:review:task'), hold(HOLD_2)],
      upheld: [upheldFor(HOLD_1, RE_REVIEW_1)],
    });
    assert.deepEqual(result, { outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_PASSING', reviewTaskId: HOLD_2, evidenceIds: [`${HOLD_2}:1:0`] });
  });

  it('when both holds were upheld, the gate is gated by the re-review of the hold the subject is on now', () => {
    const result = gate({
      applied: [hold(HOLD_1), hold(HOLD_2), reReview(RE_REVIEW_2, 'rebuttal:build-1:review:2:task'), reReview(RE_REVIEW_1, 'rebuttal:build-1:review:task')],
      upheld: [upheldFor(HOLD_1, RE_REVIEW_1), upheldFor(HOLD_2, RE_REVIEW_2)],
    });
    assert.deepEqual(result, { outcome: 'CITED', reviewTaskId: RE_REVIEW_2, evidenceIds: [`${RE_REVIEW_2}:1:0`] });
  });

  it('an upheld entry that names no hold, or a different one, releases nothing', () => {
    const base = { applied: [hold(HOLD_1), reReview(RE_REVIEW_1, 'rebuttal:build-1:review:task')] };
    const unbound = { subjectTaskId: 'build-1', reReviewTaskId: RE_REVIEW_1 };
    assert.equal(gate({ ...base, upheld: [unbound] }).outcome, 'REFUSED');
    assert.equal(gate({ ...base, upheld: [upheldFor(HOLD_2, RE_REVIEW_1)] }).outcome, 'REFUSED');
  });
});

describe('juliusUpheldDisagreementOf', () => {
  const disagreement = (over: Record<string, unknown> = {}) => ({
    disagreementId: 'disagreement:scope:build-1:review', version: 'julius-disagreement.v1', executionScope: 'scope', missionId: 'mission:m',
    subjectTaskId: 'build-1', reviewTaskId: HOLD_1, challengeRequestId: 'request-1', material: true, category: 'c', target: 't',
    reviewerPosition: 'p', reviewerEvidenceIds: [], codingAgentEvidenceIds: [], contractBindingDigest: null,
    rebuttalTaskId: 'rebuttal:build-1:review:task', architectPosition: 'MAINTAINS', architectArgument: 'a', architectEvidence: [],
    reReviewTaskId: RE_REVIEW_1, status: 'RESOLVED', resolution: 'ARCHITECT_UPHELD', resolutionBasis: 'RE_REVIEW_CONTINUED',
    openedAt: '2026-10-18T00:00:00.000Z', resolvedAt: '2026-10-18T00:01:00.000Z', ...over,
  });
  const upheldOf = (value: unknown): unknown => (gateModule as Record<string, (input: unknown) => unknown>).juliusUpheldDisagreementOf(value);

  it('names the subject, the re-review that decided it, and the hold it resolves (the challenging review)', () => {
    assert.deepEqual(upheldOf(disagreement()), { subjectTaskId: 'build-1', reReviewTaskId: RE_REVIEW_1, holdReviewTaskId: HOLD_1 });
  });

  it('is null unless the disagreement is material, resolved ARCHITECT_UPHELD, and has a re-review', () => {
    for (const over of [
      { material: false }, { status: 'AWAITING_RE_REVIEW', resolution: null, resolutionBasis: null },
      { resolution: 'CHALLENGE_UPHELD' }, { resolution: 'ESCALATED' }, { reReviewTaskId: null },
    ]) assert.equal(upheldOf(disagreement(over)), null, JSON.stringify(over));
  });

  it('feeds the gate: the entry it returns releases exactly the hold it names', () => {
    const entry = upheldOf(disagreement({ reviewTaskId: HOLD_2, reReviewTaskId: RE_REVIEW_2 }));
    const rows = { applied: [hold(HOLD_2), reReview(RE_REVIEW_2, 'rebuttal:build-1:review:2:task')], upheld: [entry] };
    assert.equal(gate(rows).outcome, 'CITED');
    assert.equal(gate({ ...rows, applied: [hold(HOLD_1), ...rows.applied.slice(1)] }).outcome, 'REFUSED');
  });
});

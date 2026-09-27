import { describe, expect, it } from 'vitest';

import {
  JULIUS_DISAGREEMENT_BASES, JULIUS_DISAGREEMENT_RESOLUTIONS, advanceJuliusDisagreement, foldJuliusDisagreements,
  juliusDisagreementId, juliusDisagreementOpenedFacts, juliusDisagreementStepFacts, juliusRebuttalReviewTaskId,
  juliusRebuttalTaskId, openJuliusDisagreement, sanitizeJuliusRebuttal,
  type JuliusDisagreement, type JuliusDisagreementStep,
} from './julius-disagreement';
import { validateJuliusEvent } from './julius-events';

/** The disagreement record's rules, without a runtime. */

const OPENING = {
  executionScope: 'gh-34995797200.1', missionId: 'msn-1', subjectTaskId: 'build-1', reviewTaskId: 'build-1:review',
  challengeRequestId: 'peer:evidence_challenge:gh-34995797200.1:build-1:review', material: true,
  category: 'contract_drift', target: 'PLAN', reviewerPosition: 'The plan writes outside the permitted paths.',
  reviewerEvidenceIds: ['evidence:review-1'], codingAgentEvidenceIds: ['evidence:build-1'],
  contractBindingDigest: `sha256:${'c'.repeat(64)}`, openedAt: '2026-09-15T12:00:00.000Z',
} as const;

const opened = (over: Partial<Parameters<typeof openJuliusDisagreement>[0]> = {}): JuliusDisagreement => {
  const outcome = openJuliusDisagreement({ ...OPENING, ...over });
  if (outcome.outcome !== 'OPENED') throw new Error(outcome.reasonCode);
  return outcome.disagreement;
};

const MAINTAINS = { position: 'MAINTAINS', argument: 'The path is a symlink.', evidence: [{ locator: 'workspace/etc', claim: 'Resolves inside.' }], missionTermsMustChange: false } as const;
const reading = (value: unknown) => {
  const result = sanitizeJuliusRebuttal(value);
  if (!result.ok) throw new Error(result.reasonCode);
  return result.rebuttal;
};

const through = (start: JuliusDisagreement, steps: readonly JuliusDisagreementStep[]): JuliusDisagreement =>
  steps.reduce((current, step) => {
    const moved = advanceJuliusDisagreement(current, step, 't');
    if (moved.outcome !== 'MOVED') throw new Error(moved.reasonCode);
    return moved.disagreement;
  }, start);

describe('a disagreement is opened with everything a reader needs, or not at all', () => {
  it('opens awaiting the rebuttal, with a scoped identity', () => {
    expect(opened()).toMatchObject({
      disagreementId: 'disagreement:gh-34995797200.1:build-1:review', status: 'AWAITING_REBUTTAL',
      rebuttalTaskId: null, reReviewTaskId: null, resolution: null, resolutionBasis: null, architectPosition: null,
    });
  });

  it.each([
    ['no reviewer evidence', { reviewerEvidenceIds: [] }, 'disagreement_requires_reviewer_evidence'],
    ['a malformed binding', { contractBindingDigest: 'sha256:x' }, 'disagreement_binding_invalid'],
    ['an unsafe position', { reviewerPosition: 'password: hunter2' }, 'disagreement_position_invalid'],
    ['a scope that crowds the id', { executionScope: 's'.repeat(65) }, 'disagreement_identity_required'],
    ['a malformed evidence id', { codingAgentEvidenceIds: ['has space'] }, 'disagreement_evidence_invalid'],
  ])('refuses %s', (_label, over, reasonCode) => {
    expect(openJuliusDisagreement({ ...OPENING, ...over })).toEqual({ outcome: 'REFUSED', reasonCode });
  });

  it('two attempts never share an id; a long review id is digested, never truncated', () => {
    expect(juliusDisagreementId({ executionScope: 'gh-1.1', reviewTaskId: 'build-1:review' }))
      .not.toBe(juliusDisagreementId({ executionScope: 'gh-1.2', reviewTaskId: 'build-1:review' }));
    const long = `repair:segment:${'x'.repeat(300)}`;
    const a = juliusDisagreementId({ executionScope: 'local', reviewTaskId: `${long}:1:task:review` });
    const b = juliusDisagreementId({ executionScope: 'local', reviewTaskId: `${long}:2:task:review` });
    expect(a.length).toBeLessThanOrEqual(200);
    expect(a).not.toBe(b);
  });

  it('names its rebuttal task, and reads it back', () => {
    expect(juliusRebuttalTaskId('build-1:review')).toBe('rebuttal:build-1:review:task');
    expect(juliusRebuttalReviewTaskId('rebuttal:build-1:review:task')).toBe('build-1:review');
    expect(juliusRebuttalReviewTaskId('build-1:review')).toBeNull();
  });
});

describe('the architect answers once, from an allowlist', () => {
  it('reads a concession and a maintained position with evidence', () => {
    expect(reading({ position: 'concedes', argument: 'Agreed.' })).toEqual({ position: 'CONCEDES', argument: 'Agreed.', evidence: [], missionTermsMustChange: false });
    expect(reading(MAINTAINS).evidence).toHaveLength(1);
  });

  it.each([
    ['no position', { argument: 'x' }, 'rebuttal_position_unknown'],
    ['a maintained position with nothing to cite', { position: 'MAINTAINS', argument: 'x' }, 'rebuttal_maintains_without_evidence'],
    ['a completion claim', { ...MAINTAINS, verdict: 'VERIFIED' }, 'peer_response_mints_julius_only_outcome'],
    ['a contract edit', { ...MAINTAINS, permittedPaths: ['/'] }, 'peer_response_mutates_protected_term'],
    ['too much evidence', { ...MAINTAINS, evidence: Array.from({ length: 9 }, () => ({ locator: 'a', claim: 'b' })) }, 'rebuttal_evidence_invalid'],
    ['a non-boolean escalation flag', { ...MAINTAINS, missionTermsMustChange: 'yes' }, 'rebuttal_shape_refused'],
  ])('refuses %s by name', (_label, value, reasonCode) => {
    expect(sanitizeJuliusRebuttal(value)).toEqual({ ok: false, reasonCode });
  });
});

describe('every way it resolves, and nothing after', () => {
  const scheduled = (): JuliusDisagreement => through(opened(), [{ kind: 'REBUTTAL_SCHEDULED', rebuttalTaskId: 'rebuttal:build-1:review:task' }]);

  it.each([
    ['a concession', [{ kind: 'REBUTTAL', rebuttal: reading({ position: 'CONCEDES', argument: 'Agreed.' }) }], 'CHALLENGE_UPHELD', 'ARCHITECT_CONCEDED'],
    ['an unusable rebuttal', [{ kind: 'REBUTTAL', rebuttal: null }], 'CHALLENGE_UPHELD', 'REBUTTAL_UNUSABLE'],
    ['a position needing mission terms to change', [{ kind: 'REBUTTAL', rebuttal: reading({ ...MAINTAINS, missionTermsMustChange: true }) }], 'ESCALATED', 'MISSION_TERMS_MUST_CHANGE'],
    ['a re-review that continues', [{ kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }, { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'r' }, { kind: 'RE_REVIEW', verdict: 'CONTINUE' }], 'ARCHITECT_UPHELD', 'RE_REVIEW_CONTINUED'],
    ['a re-review that warns', [{ kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }, { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'r' }, { kind: 'RE_REVIEW', verdict: 'WARNING' }], 'ARCHITECT_UPHELD', 'RE_REVIEW_CONTINUED'],
    ['a re-review that challenges again', [{ kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }, { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'r' }, { kind: 'RE_REVIEW', verdict: 'CHALLENGE' }], 'CHALLENGE_UPHELD', 'RE_REVIEW_MAINTAINED'],
    ['a re-review that says nothing usable', [{ kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }, { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'r' }, { kind: 'RE_REVIEW', verdict: null }], 'CHALLENGE_UPHELD', 'RE_REVIEW_MAINTAINED'],
    ['a re-review that blocks', [{ kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }, { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'r' }, { kind: 'RE_REVIEW', verdict: 'BLOCK' }], 'CHALLENGE_UPHELD', 'RE_REVIEW_BLOCKED'],
  ] as const)('%s', (_label, steps, resolution, basis) => {
    expect(through(scheduled(), steps as readonly JuliusDisagreementStep[])).toMatchObject({ status: 'RESOLVED', resolution, resolutionBasis: basis, resolvedAt: 't' });
  });

  it('an unroutable rebuttal resolves before any task exists', () => {
    expect(through(opened(), [{ kind: 'REBUTTAL_UNROUTABLE' }])).toMatchObject({ resolution: 'CHALLENGE_UPHELD', resolutionBasis: 'REBUTTAL_UNROUTABLE' });
  });

  it('THE BOUND: a second rebuttal, a second re-review, a step out of order, and any step after resolution are refused', () => {
    const awaitingReReview = through(scheduled(), [{ kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }]);
    const reReviewing = through(awaitingReReview, [{ kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'r' }]);
    const resolved = through(reReviewing, [{ kind: 'RE_REVIEW', verdict: 'CONTINUE' }]);
    const refusals: [JuliusDisagreement, JuliusDisagreementStep, string][] = [
      [scheduled(), { kind: 'REBUTTAL_SCHEDULED', rebuttalTaskId: 'rebuttal:again:task' }, 'disagreement_rebuttal_bound_reached'],
      [awaitingReReview, { kind: 'REBUTTAL_SCHEDULED', rebuttalTaskId: 'rebuttal:again:task' }, 'disagreement_rebuttal_bound_reached'],
      [awaitingReReview, { kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }, 'disagreement_step_out_of_order'],
      [reReviewing, { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'r2' }, 'disagreement_re_review_bound_reached'],
      [opened(), { kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) }, 'disagreement_step_out_of_order'],
      [awaitingReReview, { kind: 'RE_REVIEW', verdict: 'CONTINUE' }, 'disagreement_step_out_of_order'],
      [scheduled(), { kind: 'REBUTTAL_UNROUTABLE' }, 'disagreement_step_out_of_order'],
      [resolved, { kind: 'RE_REVIEW', verdict: 'BLOCK' }, 'disagreement_already_resolved'],
      [resolved, { kind: 'REBUTTAL_SCHEDULED', rebuttalTaskId: 'rebuttal:again:task' }, 'disagreement_already_resolved'],
    ];
    for (const [state, step, reasonCode] of refusals) {
      expect(advanceJuliusDisagreement(state, step, 't'), `${state.status} + ${step.kind}`).toEqual({ outcome: 'REFUSED', reasonCode });
    }
  });

  it('the vocabularies are closed', () => {
    expect(JULIUS_DISAGREEMENT_RESOLUTIONS).toEqual(['CHALLENGE_UPHELD', 'ARCHITECT_UPHELD', 'ESCALATED']);
    expect(JULIUS_DISAGREEMENT_BASES).toHaveLength(7);
  });
});

describe('the record is a fold over its rows', () => {
  const start = opened();
  const steps: JuliusDisagreementStep[] = [
    { kind: 'REBUTTAL_SCHEDULED', rebuttalTaskId: 'rebuttal:build-1:review:task' },
    { kind: 'REBUTTAL', rebuttal: reading(MAINTAINS) },
    { kind: 'RE_REVIEW_SCHEDULED', reReviewTaskId: 'rebuttal:build-1:review:task:review' },
    { kind: 'RE_REVIEW', verdict: 'CHALLENGE' },
  ];
  const ledger = [
    { type: 'disagreement.opened', facts: juliusDisagreementOpenedFacts(start) },
    ...steps.map((step) => ({ type: 'disagreement.step', facts: juliusDisagreementStepFacts(start.disagreementId, step, 't') })),
  ];

  it('rebuilds exactly the state the steps reach, through JSON', () => {
    const expected = through(start, steps);
    expect(foldJuliusDisagreements(ledger)).toEqual([expected]);
    expect(foldJuliusDisagreements(JSON.parse(JSON.stringify(ledger)))).toEqual([expected]);
  });

  it('ignores a replayed open, a replayed step and a step for a record that was never opened', () => {
    const noisy = [ledger[0]!, ...ledger, ...ledger.slice(1), { type: 'disagreement.step', facts: { disagreementId: 'disagreement:nobody', step: 'RE_REVIEW', verdict: 'BLOCK', at: 't' } }];
    expect(foldJuliusDisagreements(noisy)).toEqual(foldJuliusDisagreements(ledger));
  });

  it('the widest rows fit the event validator', () => {
    const wide = opened({ reviewerPosition: 'p'.repeat(400), subjectTaskId: `s:${'s'.repeat(500)}`, reviewerEvidenceIds: Array.from({ length: 16 }, (_, i) => `evidence:${'e'.repeat(40)}${i}`) });
    const widest = reading({ position: 'MAINTAINS', argument: 'a'.repeat(600), evidence: Array.from({ length: 8 }, () => ({ locator: 'l'.repeat(200), claim: 'c'.repeat(240) })) });
    for (const facts of [juliusDisagreementOpenedFacts(wide), juliusDisagreementStepFacts(wide.disagreementId, { kind: 'REBUTTAL', rebuttal: widest }, 't')]) {
      expect(() => validateJuliusEvent({
        eventId: 'e', runId: 'r', projectId: 'p', type: 'disagreement.step', taskId: null, workerId: null,
        correlationId: 'c', causationId: null, occurredAt: 't', facts: { ...facts, owner: 'o' },
      })).not.toThrow();
    }
  });
});

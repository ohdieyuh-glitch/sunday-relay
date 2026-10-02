import { describe, expect, it } from 'vitest';

import {
  JuliusAcceptReviewRefused, assertJuliusAcceptCitesReview, juliusAcceptReviewGate, juliusDecisionUnderReviewGate,
  type JuliusAcceptReviewGate, type JuliusAppliedReviewRow,
} from './julius-accept-review-gate';
import type { JuliusEvidenceType, JuliusVerificationDecision } from './julius-runtime';

const WORK = { taskId: 'build-1', role: 'CODING_AGENT' } as const;
const applied = (over: Partial<JuliusAppliedReviewRow> = {}): JuliusAppliedReviewRow =>
  ({ reviewTaskId: 'build-1:review', reviewedTaskId: 'build-1', verdict: 'CONTINUE', route: 'PROCEED', ...over });
const row = (evidenceId: string, taskId: string, status: 'PASSED' | 'FAILED' = 'PASSED', type: JuliusEvidenceType = 'REVIEW_FINDING') =>
  ({ evidenceId, taskId, type, status }) as const;
const REVIEWED = [row('build-1:1:0', 'build-1', 'PASSED', 'TEST'), row('build-1:review:1:0', 'build-1:review')];
const gate = (over: Partial<Parameters<typeof juliusAcceptReviewGate>[0]> = {}) => juliusAcceptReviewGate({
  subject: WORK, reviewerRequired: true, applied: [applied()], upheld: [], evidence: REVIEWED, ...over,
});
const ACCEPT: JuliusVerificationDecision = { action: 'ACCEPT', reasonCode: 'TASK_VERIFIED', evidenceIds: ['build-1:1:0'], safeSummary: 'Required evidence passed.' };

describe('V2-1 (unit) — the review an ACCEPT must cite', () => {
  it('is not required where the policy requires none, or of a review itself', () => {
    expect(gate({ reviewerRequired: false })).toEqual({ outcome: 'NOT_REQUIRED' });
    expect(gate({ subject: { taskId: 'build-1:review', role: 'INDEPENDENT_REVIEWER' } })).toEqual({ outcome: 'NOT_REQUIRED' });
  });

  it('is the applied review’s PASSED REVIEW_FINDING rows, and nothing else on the record', () => {
    const evidence = [...REVIEWED, row('build-1:review:1:1', 'build-1:review', 'PASSED', 'TOOL_RECEIPT'), row('plan-1:review:1:0', 'plan-1:review')];
    expect(gate({ evidence })).toEqual({ outcome: 'CITED', reviewTaskId: 'build-1:review', evidenceIds: ['build-1:review:1:0'] });
  });

  it('passes the verdicts that let the work proceed: CONTINUE, WARNING, and a challenge that is not material', () => {
    for (const [verdict, route] of [['CONTINUE', 'PROCEED'], ['WARNING', 'RETAIN'], ['CHALLENGE', 'RECORD']] as const) {
      expect(gate({ applied: [applied({ verdict, route })] }).outcome, `${verdict}/${route}`).toBe('CITED');
    }
  });

  it('V2-2: is the LATEST applied review of the subject', () => {
    const repaired = [applied({ reviewTaskId: 'build-1:review', verdict: 'REPAIR_REQUIRED', route: 'REPAIR' }), applied({ reviewTaskId: 'segment:build-1:review:2:task' })];
    const evidence = [...REVIEWED, row('segment:build-1:review:2:task:1:0', 'segment:build-1:review:2:task')];
    expect(gate({ applied: repaired, evidence })).toEqual({ outcome: 'CITED', reviewTaskId: 'segment:build-1:review:2:task', evidenceIds: ['segment:build-1:review:2:task:1:0'] });
    expect(gate({ applied: [...repaired].reverse(), evidence })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_PASSING', reviewTaskId: 'build-1:review' });
  });
});

describe('V2-3 (unit) — an ACCEPT it refuses', () => {
  it('REVIEW_NOT_APPLIED: no verdict was applied to the subject (one applied to other work does not count)', () => {
    expect(gate({ applied: [] })).toEqual({ outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_APPLIED', reviewTaskId: null, evidenceIds: [] });
    expect(gate({ applied: [applied({ reviewedTaskId: 'plan-1', reviewTaskId: 'plan-1:review' })] }).outcome).toBe('REFUSED');
  });

  it('REVIEW_NOT_PASSING: a verdict stricter than proceeding, or none at all', () => {
    const refused = [
      { verdict: 'REPAIR_REQUIRED', route: 'REPAIR' }, { verdict: 'BLOCK', route: 'HALT' }, { verdict: 'CHALLENGE', route: 'HOLD' },
      { verdict: null, route: 'PROCEED' }, { verdict: 'CONTINUE', route: 'RECORD' }, { verdict: 'CONTINUE', route: 'NOT_A_ROUTE' },
    ] as const;
    for (const over of refused) {
      expect(gate({ applied: [applied(over)] }), JSON.stringify(over)).toMatchObject({ outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_PASSING', reviewTaskId: 'build-1:review' });
    }
  });

  it('REVIEW_NOT_PASSING: a passing verdict over a review row that FAILED', () => {
    const evidence = [...REVIEWED, row('build-1:review:1:1', 'build-1:review', 'FAILED')];
    expect(gate({ evidence })).toEqual({ outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_PASSING', reviewTaskId: 'build-1:review', evidenceIds: ['build-1:review:1:0', 'build-1:review:1:1'] });
  });

  it('REVIEW_EVIDENCE_MISSING: a passing verdict whose accepted attempt left no PASSED row to cite', () => {
    expect(gate({ evidence: REVIEWED.slice(0, 1) })).toEqual({ outcome: 'REFUSED', reasonCode: 'REVIEW_EVIDENCE_MISSING', reviewTaskId: 'build-1:review', evidenceIds: [] });
  });
});

describe('V2-1 (unit) — a material challenge Julius resolved for the architect', () => {
  const HOLD = applied({ verdict: 'CHALLENGE', route: 'HOLD' });
  const RE_REVIEW = 'rebuttal:build-1:review:task:review';
  const reReview = (over: Partial<JuliusAppliedReviewRow> = {}) =>
    applied({ reviewTaskId: RE_REVIEW, reviewedTaskId: 'rebuttal:build-1:review:task', route: 'RE_REVIEW', ...over });
  const evidence = [...REVIEWED, row(`${RE_REVIEW}:1:0`, RE_REVIEW)];
  const upheld = [{ subjectTaskId: 'build-1', reReviewTaskId: RE_REVIEW }];

  it('is gated by the re-review that upheld the architect, never by the challenge it overruled', () => {
    expect(gate({ applied: [HOLD, reReview()], upheld, evidence })).toEqual({ outcome: 'CITED', reviewTaskId: RE_REVIEW, evidenceIds: [`${RE_REVIEW}:1:0`] });
  });

  it('finds the re-review through its research continuation', () => {
    const segment = `segment:${RE_REVIEW}:2:task`;
    expect(gate({ applied: [HOLD, reReview({ reviewTaskId: segment })], upheld, evidence: [...REVIEWED, row(`${segment}:1:0`, segment)] }))
      .toEqual({ outcome: 'CITED', reviewTaskId: segment, evidenceIds: [`${segment}:1:0`] });
  });

  it('refuses while unresolved, when another subject was upheld, and when the re-review did not pass', () => {
    expect(gate({ applied: [HOLD, reReview()], upheld: [], evidence }).outcome).toBe('REFUSED');
    expect(gate({ applied: [HOLD, reReview()], upheld: [{ subjectTaskId: 'plan-1', reReviewTaskId: RE_REVIEW }], evidence }).outcome).toBe('REFUSED');
    expect(gate({ applied: [HOLD, reReview({ verdict: 'BLOCK' })], upheld, evidence })).toMatchObject({ outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_PASSING', reviewTaskId: RE_REVIEW });
  });
});

describe('V2-3/V2-4 (unit) — the decision the gate allows', () => {
  const cited: JuliusAcceptReviewGate = { outcome: 'CITED', reviewTaskId: 'build-1:review', evidenceIds: ['build-1:review:1:0'] };
  const refused: JuliusAcceptReviewGate = { outcome: 'REFUSED', reasonCode: 'REVIEW_EVIDENCE_MISSING', reviewTaskId: 'build-1:review', evidenceIds: [] };

  it('a cited ACCEPT carries the review’s ids after its own, once', () => {
    expect(juliusDecisionUnderReviewGate(ACCEPT, cited, 'build-1')).toEqual({ ...ACCEPT, evidenceIds: ['build-1:1:0', 'build-1:review:1:0'] });
    expect(juliusDecisionUnderReviewGate({ ...ACCEPT, evidenceIds: ['build-1:review:1:0'] }, cited, 'build-1').evidenceIds).toEqual(['build-1:review:1:0']);
  });

  it('a refused ACCEPT becomes a HALT naming the refusal and the review', () => {
    const halted = juliusDecisionUnderReviewGate(ACCEPT, refused, 'build-1');
    expect(halted).toMatchObject({ action: 'HALT', reasonCode: 'REVIEW_EVIDENCE_MISSING', evidenceIds: ['build-1:1:0'] });
    expect(halted.safeSummary).toContain('build-1:review');
  });

  it('every other decision, and an ACCEPT that needs no review, passes through untouched', () => {
    const repair: JuliusVerificationDecision = { action: 'REPAIR', reasonCode: 'BLOCKING_FINDINGS', evidenceIds: ['x'], safeSummary: 's' };
    expect(juliusDecisionUnderReviewGate(repair, refused, 'build-1')).toBe(repair);
    expect(juliusDecisionUnderReviewGate(ACCEPT, { outcome: 'NOT_REQUIRED' }, 'build-1')).toBe(ACCEPT);
  });
});

describe('V2-3 (unit) — the write refuses an ACCEPT that does not cite a passing review (typed)', () => {
  const cited: JuliusAcceptReviewGate = { outcome: 'CITED', reviewTaskId: 'build-1:review', evidenceIds: ['build-1:review:1:0'] };
  const refusalOf = (decision: JuliusVerificationDecision, current: JuliusAcceptReviewGate): unknown => {
    try { assertJuliusAcceptCitesReview(decision, current, 'build-1'); return null; } catch (error) { return error; }
  };

  it('throws JuliusAcceptReviewRefused, carrying the reason, for an ACCEPT the gate refused', () => {
    for (const reasonCode of ['REVIEW_NOT_APPLIED', 'REVIEW_NOT_PASSING', 'REVIEW_EVIDENCE_MISSING'] as const) {
      const error = refusalOf(ACCEPT, { outcome: 'REFUSED', reasonCode, reviewTaskId: null, evidenceIds: [] });
      expect(error).toBeInstanceOf(JuliusAcceptReviewRefused);
      expect(error).toMatchObject({ reasonCode, subjectTaskId: 'build-1', message: `julius_accept_review_refused:${reasonCode}` });
    }
  });

  it('throws REVIEW_NOT_CITED for an ACCEPT that omits an id the gate cited', () => {
    expect(refusalOf(ACCEPT, cited)).toMatchObject({ name: 'JuliusAcceptReviewRefused', reasonCode: 'REVIEW_NOT_CITED' });
  });

  it('writes a cited ACCEPT, any decision that is not an ACCEPT, and an ACCEPT that needs no review', () => {
    expect(refusalOf({ ...ACCEPT, evidenceIds: ['build-1:1:0', 'build-1:review:1:0'] }, cited)).toBeNull();
    expect(refusalOf({ ...ACCEPT, action: 'HALT' }, { outcome: 'REFUSED', reasonCode: 'REVIEW_NOT_PASSING', reviewTaskId: null, evidenceIds: [] })).toBeNull();
    expect(refusalOf(ACCEPT, { outcome: 'NOT_REQUIRED' })).toBeNull();
  });
});

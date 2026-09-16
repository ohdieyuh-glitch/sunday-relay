import { describe, expect, it } from 'vitest';

import { JULIUS_CHALLENGE_CATEGORIES, JULIUS_MATERIAL_CHALLENGE_CATEGORIES } from './julius-continuous-lifecycle';
import {
  JULIUS_REVIEW_VERDICT_LIMITS, juliusEffectiveReviewVerdict, juliusEvidenceReviewVerdict, juliusReviewEscalationGuidance,
  juliusReviewRoute, juliusReviewVerdictFacts, juliusReviewVerdictFromFacts, juliusWarningIsPromoted, sanitizeJuliusReviewVerdict,
} from './julius-review-verdict';
import { reviewSubjectTaskId } from './julius-review-stage';
import { validateJuliusEvent } from './julius-events';

/**
 * THE REVIEWER'S VERDICT, WITHOUT A RUNTIME: what a declaration may say, what
 * evidence says, which wins, and which way Julius goes.
 */

describe('a declaration is rebuilt from an allowlist', () => {
  it.each(['CONTINUE', 'continue', ' Warning '])('reads %j', (word) => {
    expect(sanitizeJuliusReviewVerdict({ verdict: word, claim: 'Seen.' }).ok).toBe(true);
  });

  it('keeps exactly the fields Julius reads', () => {
    expect(sanitizeJuliusReviewVerdict({
      verdict: 'challenge', category: 'Contract_Drift', target: 'plan', claim: '  The plan\nwrites outside the paths.  ', extra: 'dropped',
    })).toEqual({
      ok: true,
      declaration: {
        version: 'julius-review-verdict.v1', verdict: 'CHALLENGE', category: 'contract_drift', target: 'PLAN',
        claim: 'The plan writes outside the paths.', warnings: [],
      },
    });
  });

  it.each([
    ['an unknown word', { verdict: 'APPROVED', claim: 'x' }, 'review_verdict_unknown'],
    ['a Julius-only outcome', { verdict: 'VERIFIED', claim: 'x' }, 'peer_response_mints_julius_only_outcome'],
    ['a completion hidden in a status', { verdict: 'CONTINUE', claim: 'x', status: 'complete' }, 'peer_response_mints_julius_only_outcome'],
    ['a mission-owned term', { verdict: 'WARNING', claim: 'x', acceptanceCriteria: [] }, 'peer_response_mutates_protected_term'],
    ['a block with no category', { verdict: 'BLOCK', claim: 'x' }, 'review_verdict_requires_category'],
    ['a challenge with no category', { verdict: 'CHALLENGE', target: 'work', claim: 'x' }, 'review_verdict_requires_category'],
    ['a challenge with no target', { verdict: 'CHALLENGE', category: 'regression', claim: 'x' }, 'review_challenge_requires_target'],
    ['an invented category', { verdict: 'BLOCK', category: 'vibes', claim: 'x' }, 'review_verdict_category_unknown'],
    ['no claim', { verdict: 'CONTINUE' }, 'review_verdict_claim_invalid'],
    ['a credential-shaped claim', { verdict: 'CONTINUE', claim: 'token: abc' }, 'review_verdict_claim_invalid'],
    ['warnings that are not a list', { verdict: 'WARNING', claim: 'x', warnings: 'one' }, 'review_verdict_warnings_invalid'],
    ['a warning with an invented category', { verdict: 'WARNING', claim: 'x', warnings: [{ category: 'vibes', claim: 'y' }] }, 'review_verdict_warnings_invalid'],
    ['not an object', 'CONTINUE', 'review_verdict_shape_refused'],
  ])('refuses %s by name', (_label, value, reasonCode) => {
    expect(sanitizeJuliusReviewVerdict(value)).toEqual({ ok: false, reasonCode });
  });

  it('bounds the claim and the warnings, and a WARNING always retains something', () => {
    const long = sanitizeJuliusReviewVerdict({
      verdict: 'WARNING', claim: 'c'.repeat(2_000),
      warnings: Array.from({ length: 20 }, (_, index) => ({ claim: `w${index} ${'w'.repeat(500)}` })),
    });
    if (!long.ok) throw new Error(long.reasonCode);
    expect(long.declaration.claim.length).toBeLessThanOrEqual(JULIUS_REVIEW_VERDICT_LIMITS.claimChars);
    expect(long.declaration.warnings).toHaveLength(JULIUS_REVIEW_VERDICT_LIMITS.warnings);
    expect(long.declaration.warnings.every((warning) => warning.claim.length <= JULIUS_REVIEW_VERDICT_LIMITS.warningClaimChars)).toBe(true);
    const bare = sanitizeJuliusReviewVerdict({ verdict: 'WARNING', category: 'weak_evidence', claim: 'The citation is second-hand.' });
    expect(bare).toMatchObject({ ok: true, declaration: { warnings: [{ category: 'weak_evidence', claim: 'The citation is second-hand.' }] } });
  });

  it('round-trips through the ledger row, and the widest row fits', () => {
    const reading = sanitizeJuliusReviewVerdict({
      verdict: 'WARNING', category: 'weak_evidence', claim: 'c'.repeat(400),
      warnings: Array.from({ length: 8 }, () => ({ category: 'superficial_test', claim: `"quoted" ${'w'.repeat(240)}` })),
    });
    if (!reading.ok) throw new Error(reading.reasonCode);
    const facts = juliusReviewVerdictFacts(reading.declaration);
    expect(juliusReviewVerdictFromFacts(facts)).toEqual(reading.declaration);
    expect(() => validateJuliusEvent({
      eventId: 'e', runId: 'r', projectId: 'p', type: 'review.verdict.declared', taskId: null, workerId: null,
      correlationId: 'c', causationId: null, occurredAt: 't', facts: { ...facts, reviewTaskId: `task:${'t'.repeat(300)}`, owner: 'o' },
    })).not.toThrow();
    expect(juliusReviewVerdictFromFacts({ ...facts, warnings: '{not json' })).toBeNull();
  });
});

describe('evidence has a verdict too, and the stricter one wins', () => {
  it('reads the review evidence in the same vocabulary', () => {
    expect(juliusEvidenceReviewVerdict([{ type: 'REVIEW_FINDING', status: 'PASSED' }])).toBe('CONTINUE');
    expect(juliusEvidenceReviewVerdict([{ type: 'REVIEW_FINDING', status: 'PASSED' }, { type: 'REVIEW_FINDING', status: 'FAILED' }])).toBe('REPAIR_REQUIRED');
    expect(juliusEvidenceReviewVerdict([{ type: 'TEST', status: 'FAILED' }])).toBeNull();
  });

  it.each([
    [null, null, null, 'NONE'],
    ['WARNING', null, 'WARNING', 'DECLARED'],
    [null, 'REPAIR_REQUIRED', 'REPAIR_REQUIRED', 'EVIDENCE'],
    ['CONTINUE', 'REPAIR_REQUIRED', 'REPAIR_REQUIRED', 'EVIDENCE'],
    ['BLOCK', 'REPAIR_REQUIRED', 'BLOCK', 'DECLARED'],
    ['CHALLENGE', 'CONTINUE', 'CHALLENGE', 'DECLARED'],
    ['REPAIR_REQUIRED', 'REPAIR_REQUIRED', 'REPAIR_REQUIRED', 'BOTH'],
  ] as const)('declared %s with evidence %s is %s from %s', (declared, derived, verdict, source) => {
    expect(juliusEffectiveReviewVerdict(declared, derived)).toMatchObject({ verdict, source });
  });
});

describe('the route is Julius\'s', () => {
  it.each([
    ['CONTINUE', null, 'PROCEED'],
    [null, null, 'PROCEED'],
    ['WARNING', null, 'RETAIN'],
    ['CHALLENGE', 'superficial_test', 'RECORD'],
    ['CHALLENGE', 'contract_drift', 'HOLD'],
    ['REPAIR_REQUIRED', null, 'REPAIR'],
    ['BLOCK', 'unsafe_implementation', 'HALT'],
  ] as const)('%s (%s) routes %s', (verdict, category, route) => {
    expect(juliusReviewRoute({ verdict, category })).toBe(route);
  });

  it('materiality is a closed subset of the categories, and every other category is argued while work proceeds', () => {
    expect(JULIUS_MATERIAL_CHALLENGE_CATEGORIES.every((category) => (JULIUS_CHALLENGE_CATEGORIES as readonly string[]).includes(category))).toBe(true);
    const argued = JULIUS_CHALLENGE_CATEGORIES.filter((category) => !JULIUS_MATERIAL_CHALLENGE_CATEGORIES.includes(category));
    expect(argued).toEqual(['weak_evidence', 'bad_assumption', 'superficial_test', 'brain_contradiction', 'provenance_gap', 'budget_misuse']);
    for (const category of argued) expect(juliusReviewRoute({ verdict: 'CHALLENGE', category })).toBe('RECORD');
  });

  it('only Julius\'s policy promotes a warning', () => {
    const warning = { category: 'unsafe_implementation' as const, claim: 'x' };
    expect(juliusWarningIsPromoted(warning, undefined)).toBe(false);
    expect(juliusWarningIsPromoted(warning, [])).toBe(false);
    expect(juliusWarningIsPromoted(warning, ['unsafe_implementation'])).toBe(true);
    expect(juliusWarningIsPromoted({ category: null, claim: 'x' }, ['unsafe_implementation'])).toBe(false);
  });
});

describe('what the reviewer is told matches what Julius accepts', () => {
  it('names every category and target, and says the reviewer never declares completion', () => {
    const guidance = juliusReviewEscalationGuidance();
    for (const category of JULIUS_CHALLENGE_CATEGORIES) expect(guidance).toContain(category);
    for (const target of ['work', 'plan', 'guidance', 'contract']) expect(guidance).toContain(target);
    expect(guidance).toContain('You never declare work verified, complete or accepted');
  });
});

describe('a researching review is still a review of the same subject', () => {
  it('reads the subject through segment continuations', () => {
    expect(reviewSubjectTaskId('build-1:review')).toBe('build-1');
    expect(reviewSubjectTaskId('segment:build-1:review:2:task')).toBe('build-1');
    expect(reviewSubjectTaskId('segment:guidance:build-1:1:task:review:3:task')).toBe('guidance:build-1:1:task');
    expect(reviewSubjectTaskId('segment:build-1:2:task')).toBeNull();
    expect(reviewSubjectTaskId('build-1')).toBeNull();
  });
});

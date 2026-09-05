import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  INDEPENDENT_REVIEWER_LOGINS,
  REVIEW_CURRENCY_VERDICTS,
  evaluateReviewCurrency,
} from './julius-review-currency.mjs';

/**
 * A REVIEW APPROVES A COMMIT, NOT A PULL REQUEST.
 *
 * This hazard was hit four times on one branch: a clean review arrives for SHA
 * A, a finding is repaired, the head becomes B, and the review for A stays at
 * the top of the page reading like approval. Enforcement was a human
 * remembering. These cases are that rule, executable.
 */

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const REVIEWER = INDEPENDENT_REVIEWER_LOGINS[0]!;

const review = (commit: string, state = 'COMMENTED', login = REVIEWER) =>
  ({ commit_id: commit, state, user: { login } });
const finding = (commit: string, body: string, login = REVIEWER) =>
  ({ original_commit_id: commit, commit_id: commit, body, user: { login } });

/** The happy shape, with the head held still. */
const at = (headSha: string, reviews: unknown[], reviewComments: unknown[] = []) =>
  evaluateReviewCurrency({ headSha, headShaAfter: headSha, reviews, reviewComments, pullAuthorLogin: 'ohdieyuh-glitch' });

describe('review currency', () => {
  it('1. a clean review of the current head is current', () => {
    const result = at(A, [review(A)]);
    expect(result.verdict).toBe('current');
    expect(result.reviewedSha).toBe(A);
    expect(result.blockingCount).toBe(0);
  });

  it('2. a clean review of an EARLIER head is stale, however recent it looks', () => {
    // The exact hazard: the review is real, clean, and the newest one there is.
    const result = at(B, [review(A)]);
    expect(result.verdict).toBe('stale');
    expect(result.reason).toContain(B);
    expect(result.reviewedShas).toEqual([A]);
  });

  it('and ancestry does not rescue it: A being a parent of B says nothing about B', () => {
    // No ancestry is consulted anywhere. The changes made AFTER A are exactly
    // what an A-review did not see.
    expect(at(B, [review(A), review(A, 'APPROVED')]).verdict).toBe('stale');
  });

  it('3. once the NEW head is reviewed cleanly it becomes current', () => {
    const result = at(B, [review(A), review(B)]);
    expect(result.verdict).toBe('current');
    expect(result.reviewedSha).toBe(B);
  });

  it('4. a review of the current head with a blocking finding fails', () => {
    const p1 = at(B, [review(B)], [finding(B, '**P1 Badge** Reject outputs containing multiple review objects')]);
    expect(p1.verdict).toBe('blocked');
    expect(p1.blockingCount).toBe(1);

    // CHANGES_REQUESTED at the head blocks on its own.
    expect(at(B, [review(B, 'CHANGES_REQUESTED')]).verdict).toBe('blocked');
  });

  it('a non-blocking finding on the head does not block', () => {
    expect(at(B, [review(B)], [finding(B, '**P2 Badge** Prefer a clearer name here')]).verdict).toBe('current');
  });

  it('a finding carried forward from an OLDER commit is not a finding about this head', () => {
    // `original_commit_id` is the commit the comment was written against.
    // GitHub advances `commit_id` on comments that still apply, which is why
    // the original is the one that decides.
    const carried = { original_commit_id: A, commit_id: B, body: '**P1 Badge** old', user: { login: REVIEWER } };
    expect(at(B, [review(B)], [carried]).verdict).toBe('current');
  });

  it('an UNCLASSIFIABLE finding on the head blocks, because it cannot be dismissed', () => {
    // A finding this function cannot read the severity of is not one it may
    // wave through.
    expect(at(B, [review(B)], [finding(B, 'something the parser does not recognise')]).verdict).toBe('blocked');
    expect(at(B, [review(B)], [finding(B, '')]).verdict).toBe('blocked');
  });

  it('5. metadata that cannot be read fails closed, never approves', () => {
    for (const broken of [
      { headSha: undefined, headShaAfter: A, reviews: [], reviewComments: [] },
      { headSha: 'not-a-sha', headShaAfter: 'not-a-sha', reviews: [], reviewComments: [] },
      { headSha: A, headShaAfter: A, reviews: null, reviewComments: [] },
      { headSha: A, headShaAfter: A, reviews: [], reviewComments: undefined },
      { headSha: A, headShaAfter: A, reviews: [], reviewComments: [], reviewerLogins: [] },
    ]) {
      expect(evaluateReviewCurrency(broken as never).verdict, JSON.stringify(broken).slice(0, 60))
        .toBe('indeterminate');
    }
  });

  it('6. a head that MOVES while the gate runs is never approved', () => {
    // Otherwise the gate approves whichever commit happened to arrive last.
    const moved = evaluateReviewCurrency({
      headSha: A, headShaAfter: B, reviews: [review(A)], reviewComments: [],
    });
    expect(moved.verdict).toBe('indeterminate');
    expect(moved.reason).toContain('moved');

    // And a head that cannot be re-read at all is equally unproven.
    expect(evaluateReviewCurrency({
      headSha: A, headShaAfter: undefined, reviews: [review(A)], reviewComments: [],
    }).verdict).toBe('indeterminate');
  });

  it('7. nothing but a real review by the configured reviewer counts', () => {
    // A different account, however friendly.
    expect(at(A, [review(A, 'APPROVED', 'a-passing-collaborator')]).verdict).toBe('stale');
    // A DISMISSED review says nothing about the code.
    expect(at(A, [review(A, 'DISMISSED')]).verdict).toBe('stale');
    // Issue comments and reactions are not reviews: they never reach this
    // function, because it reads the review list and nothing else.
    expect(at(A, [], [finding(A, 'LGTM 👍')]).verdict).toBe('stale');
  });

  it('the pull request author can never be their own independent reviewer', () => {
    // Even if an identity were mistakenly allowlisted, self-certification is
    // refused: independence is the property under test, not the login.
    const selfCertified = evaluateReviewCurrency({
      headSha: A, headShaAfter: A,
      reviews: [review(A, 'APPROVED', REVIEWER)],
      reviewComments: [],
      pullAuthorLogin: REVIEWER,
    });
    expect(selfCertified.verdict).toBe('stale');
  });

  it('is reachable as a gate, and one passing answer is named', () => {
    // A rule nothing can run is a rule nobody enforces. The npm script is the
    // seam a merge or live gate consumes; the CLI exits non-zero for every
    // verdict except `current`, including metadata it could not read.
    const scripts = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as
      { scripts: Record<string, string> };
    expect(scripts.scripts['julius:review-currency'], 'the gate must be runnable')
      .toContain('scripts/julius-review-currency.mjs');
    expect(REVIEW_CURRENCY_VERDICTS.filter((name) => name !== 'current'), 'three ways to block, one to pass')
      .toEqual(['stale', 'blocked', 'indeterminate']);
  });

  it('every verdict other than `current` blocks', () => {
    // The gate's contract: there is one passing answer and it is named.
    for (const result of [
      at(B, [review(A)]),
      at(B, [review(B)], [finding(B, 'P1 bad')]),
      evaluateReviewCurrency({ headSha: A, headShaAfter: B, reviews: [], reviewComments: [] }),
    ]) {
      expect(result.verdict).not.toBe('current');
    }
  });
});

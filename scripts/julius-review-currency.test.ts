import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  BASE_INTEGRATION_VERDICTS,
  EXTERNAL_APPROVER_LOGINS,
  INDEPENDENT_REVIEWER_LOGINS,
  NON_ATTESTING_IDENTITIES,
  REVIEW_ATTESTATION_CONTEXT,
  REVIEW_AUTHORITY_LOGINS,
  REVIEW_CURRENCY_VERDICTS,
  collectPages,
  evaluateMergeEligibility,
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

/** The account outside this coding environment. It approves. */
const APPROVER = EXTERNAL_APPROVER_LOGINS[0]!;
/** The independent reviewer. It finds, and it never approves. */
const REVIEWER = INDEPENDENT_REVIEWER_LOGINS[0]!;
/** The coding worker: author of everything under review, authority over nothing. */
const WORKER = NON_ATTESTING_IDENTITIES[0]!;

const approved = (commit: string, login = APPROVER) =>
  ({ commit_id: commit, state: 'APPROVED', user: { login } });
const commented = (commit: string, login = REVIEWER) =>
  ({ commit_id: commit, state: 'COMMENTED', user: { login } });
const review = (commit: string, state: string, login = REVIEWER) =>
  ({ commit_id: commit, state, user: { login } });
const finding = (commit: string, body: string, login = REVIEWER) =>
  ({ original_commit_id: commit, commit_id: commit, body, user: { login } });

/** The happy shape, with the head held still and the worker as author. */
const at = (headSha: string, reviews: unknown[], reviewComments: unknown[] = []) =>
  evaluateReviewCurrency({ headSha, headShaAfter: headSha, reviews, reviewComments, pullAuthorLogin: WORKER });

describe('review currency', () => {
  it('1. an approval of the current head is current', () => {
    const result = at(A, [approved(A)]);
    expect(result.verdict).toBe('current');
    expect(result.reviewedSha).toBe(A);
    expect(result.blockingCount).toBe(0);
    expect(result.approvedBy).toEqual([APPROVER]);
  });

  it('2. an approval of an EARLIER head is stale, however recent it looks', () => {
    // The exact hazard: the approval is real, clean, and the newest one there is.
    const result = at(B, [approved(A)]);
    expect(result.verdict).toBe('stale');
    expect(result.reason).toContain(B);
    expect(result.reviewedShas).toEqual([A]);
  });

  it('and ancestry does not rescue it: A being a parent of B says nothing about B', () => {
    // No ancestry is consulted anywhere. The changes made AFTER A are exactly
    // what an A-approval did not see.
    expect(at(B, [approved(A), commented(A)]).verdict).toBe('stale');
  });

  it('3. once the NEW head is approved it becomes current', () => {
    const result = at(B, [approved(A), approved(B)]);
    expect(result.verdict).toBe('current');
    expect(result.reviewedSha).toBe(B);
  });

  it('4. an approved head carrying a blocking finding fails', () => {
    const p1 = at(B, [approved(B)], [finding(B, '**P1 Badge** Reject outputs containing multiple review objects')]);
    expect(p1.verdict).toBe('blocked');
    expect(p1.blockingCount).toBe(1);

    // CHANGES_REQUESTED at the head blocks on its own, approval or not.
    expect(at(B, [review(B, 'CHANGES_REQUESTED')]).verdict).toBe('blocked');
    expect(at(B, [approved(B), review(B, 'CHANGES_REQUESTED')]).verdict).toBe('blocked');
  });

  it('a non-blocking finding on the approved head does not block', () => {
    expect(at(B, [approved(B)], [finding(B, '**P2 Badge** Prefer a clearer name here')]).verdict).toBe('current');
  });

  it('a finding carried forward from an OLDER commit is not a finding about this head', () => {
    // `original_commit_id` is the commit the comment was written against.
    // GitHub advances `commit_id` on comments that still apply, which is why
    // the original is the one that decides.
    const carried = { original_commit_id: A, commit_id: B, body: '**P1 Badge** old', user: { login: REVIEWER } };
    expect(at(B, [approved(B)], [carried]).verdict).toBe('current');
  });

  it('an UNCLASSIFIABLE finding on the head blocks, because it cannot be dismissed', () => {
    // A finding this function cannot read the severity of is not one it may
    // wave through — even with an approval sitting on the same commit.
    expect(at(B, [approved(B)], [finding(B, 'something the parser does not recognise')]).verdict).toBe('blocked');
    expect(at(B, [approved(B)], [finding(B, '')]).verdict).toBe('blocked');
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
      headSha: A, headShaAfter: B, reviews: [approved(A)], reviewComments: [],
    });
    expect(moved.verdict).toBe('indeterminate');
    expect(moved.reason).toContain('moved');

    // And a head that cannot be re-read at all is equally unproven.
    expect(evaluateReviewCurrency({
      headSha: A, headShaAfter: undefined, reviews: [approved(A)], reviewComments: [],
    }).verdict).toBe('indeterminate');
  });

  it('7. nothing but a real approval by a configured authority counts', () => {
    // A different account, however friendly.
    expect(at(A, [approved(A, 'a-passing-collaborator')]).verdict).toBe('stale');
    // A DISMISSED review says nothing about the code.
    expect(at(A, [review(A, 'DISMISSED', APPROVER)]).verdict).toBe('stale');
    // Issue comments and reactions are not reviews: they never reach this
    // function, because it reads the review list and nothing else. A review
    // COMMENT saying the same thing is read, and blocks — an approving noise
    // that carries no severity is a finding this gate cannot classify, not a
    // finding it may dismiss.
    const applause = at(A, [], [finding(A, 'LGTM 👍')]);
    expect(applause.verdict).not.toBe('current');
    expect(applause.verdict).toBe('blocked');
  });

  it('the pull request author can never be their own approver', () => {
    // Even if an identity were mistakenly allowlisted, self-certification is
    // refused: independence is the property under test, not the login.
    const selfCertified = evaluateReviewCurrency({
      headSha: A, headShaAfter: A,
      reviews: [approved(A, APPROVER)],
      reviewComments: [],
      pullAuthorLogin: APPROVER,
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
      at(B, [approved(A)]),
      at(B, [approved(B)], [finding(B, 'P1 bad')]),
      at(B, [commented(B)]),
      evaluateReviewCurrency({ headSha: A, headShaAfter: B, reviews: [], reviewComments: [] }),
    ]) {
      expect(result.verdict).not.toBe('current');
    }
  });
});

/**
 * WHO MAY SAY WHAT.
 *
 * The coding worker is now the GitHub App `julius-worker[bot]`, and the founder
 * account holds a credential this environment no longer possesses. That inverts
 * the previous arrangement, where the worker ran AS the founder and therefore no
 * identity here could attest to anything. These cases pin the new roles so a
 * later change cannot quietly collapse them back together.
 */
describe('review authority', () => {
  it('the coding worker is the non-attesting identity, and the founder is not', () => {
    expect(NON_ATTESTING_IDENTITIES).toContain('julius-worker[bot]');
    expect(NON_ATTESTING_IDENTITIES).not.toContain(APPROVER);
    // A role can never be both. Refusal is checked before any allowlist, so an
    // overlap would be a silently ineffective entry rather than a loud error.
    for (const forbidden of NON_ATTESTING_IDENTITIES) {
      expect(REVIEW_AUTHORITY_LOGINS, `${forbidden} may never be an authority`).not.toContain(forbidden);
    }
    expect(REVIEW_AUTHORITY_LOGINS)
      .toEqual([...EXTERNAL_APPROVER_LOGINS, ...INDEPENDENT_REVIEWER_LOGINS]);
  });

  it('the identities are the ones this deployment actually has', () => {
    // Derived constants would let a rename pass silently; these are the real
    // logins the trust model names, spelled out once.
    expect(NON_ATTESTING_IDENTITIES).toEqual(['julius-worker[bot]']);
    expect(EXTERNAL_APPROVER_LOGINS).toEqual(['ohdieyuh-glitch']);
    expect(INDEPENDENT_REVIEWER_LOGINS).toEqual(['chatgpt-codex-connector[bot]']);
  });

  it('the founder approves an exact head, and that is the path that runs today', () => {
    const result = at(A, [approved(A, APPROVER)]);
    expect(result.verdict).toBe('current');
    expect(result.approvedBy).toEqual([APPROVER]);
    expect(result.attested, 'no commit status was involved').toBe(false);
  });

  it('the independent reviewer blocks but does not approve', () => {
    // Its findings decide the head.
    expect(at(A, [commented(A, REVIEWER)], [finding(A, '**P1** broken', REVIEWER)]).verdict).toBe('blocked');
    expect(at(A, [review(A, 'CHANGES_REQUESTED', REVIEWER)]).verdict).toBe('blocked');
    // Its silence does not.
    const looked = at(A, [commented(A, REVIEWER)]);
    expect(looked.verdict).toBe('stale');
    expect(looked.reason).toContain('no approval');
  });

  it('the line is drawn at sha binding, not at the identity', () => {
    // The reviewer signals clean with a reaction, which carries no commit and
    // is therefore never read. Were it to publish either artifact that DOES
    // carry a commit, that artifact would count — the refusal is of the unbound
    // signal, from anyone, and this pins that the code means what it says.
    expect(at(A, [approved(A, REVIEWER)]).verdict).toBe('current');
    expect(at(A, [approved(A, REVIEWER)]).approvedBy).toEqual([REVIEWER]);
  });

  it('narrowing the reviewer list cannot hide the reviewer\'s findings', () => {
    // Approval and objection are asymmetric: a narrowed list may only make
    // approval harder. If it also decided findings, dropping the independent
    // reviewer would turn a restriction into a bypass.
    const narrowed = evaluateReviewCurrency({
      headSha: A, headShaAfter: A, pullAuthorLogin: WORKER,
      reviews: [approved(A, APPROVER)],
      reviewComments: [finding(A, '**P1 Badge** still broken', REVIEWER)],
      reviewerLogins: [APPROVER],
    });
    expect(narrowed.verdict).toBe('blocked');
    expect(narrowed.blockingCount).toBe(1);
  });

  it('a finding written in the review body, not a line comment, still blocks', () => {
    const summarised = { commit_id: A, state: 'COMMENTED', body: '**P1** the whole approach is wrong', user: { login: REVIEWER } };
    expect(at(A, [approved(A), summarised]).verdict).toBe('blocked');
    // An empty summary is a reviewer who wrote no summary, not an
    // unclassifiable finding, so it does not block on its own.
    expect(at(A, [approved(A), { ...summarised, body: '' }]).verdict).toBe('current');
    expect(at(A, [approved(A), { ...summarised, body: undefined }]).verdict).toBe('current');
  });

  it('severity words are read, not just the P-badges', () => {
    for (const blocking of ['Critical: this drops writes', 'HIGH severity ordering bug', 'P1 anything']) {
      expect(at(A, [approved(A)], [finding(A, blocking)]).verdict, blocking).toBe('blocked');
    }
    for (const passing of ['P2 rename this', 'P3 spacing', 'medium: could be clearer', 'low priority', 'informational only', 'nit: comma']) {
      expect(at(A, [approved(A)], [finding(A, passing)]).verdict, passing).toBe('current');
    }
  });

  it('a COMMENTED review is not an approval, whoever writes it', () => {
    // The previous revision accepted this, because the only configured reviewer
    // never used APPROVED at all. With a real approver present, that shortcut
    // lets "someone typed a remark" read as "someone approved this".
    for (const login of REVIEW_AUTHORITY_LOGINS) {
      const result = at(A, [commented(A, login)]);
      expect(result.verdict, `${login} commented`).toBe('stale');
      expect(result.approvedBy).toBeUndefined();
    }
  });

  it('the reviewer looking and the reviewer approving are different sentences', () => {
    // "Nobody has looked" and "the reviewer looked and said nothing" need
    // different actions, so the reasons distinguish them.
    expect(at(A, []).reason).toContain('no approval exists');
    expect(at(A, [commented(A)]).reason).toContain('carries no approval');
  });

  it('both authorities on one head: the finding wins over the approval', () => {
    // A human approves while the independent reviewer is still objecting.
    // Reading the approval first would make the objection disappear.
    const contested = at(A, [approved(A, APPROVER), commented(A, REVIEWER)], [finding(A, '**P1** still broken', REVIEWER)]);
    expect(contested.verdict).toBe('blocked');
    expect(contested.blockingCount).toBe(1);
  });
});

/**
 * EXACT-HEAD IDENTITY ALONE IS NOT ENOUGH.
 *
 * A review binds to a commit; a merge integrates that commit with whatever the
 * base has become. Head A can be approved while base is X, main can advance to
 * Y, the head never moves, and the exact-head check keeps saying `current` —
 * for a combination A+Y nobody reviewed.
 */
describe('merge eligibility', () => {
  const X = 'c'.repeat(40);
  const Y = 'd'.repeat(40);
  const eligibility = (over: Record<string, unknown>) => evaluateMergeEligibility({
    headSha: A, headShaAfter: A, reviews: [approved(A)], reviewComments: [],
    pullAuthorLogin: WORKER, baseSha: X, baseShaAfter: X, baseContainedInHead: true, ...over,
  });

  it('an approval of the head, with the base already contained, is eligible', () => {
    const result = eligibility({});
    expect(result.reviewCurrency.verdict).toBe('current');
    expect(result.baseIntegration).toBe('integrated');
    expect(result.mergeEligible).toBe(true);
  });

  it('the base advancing past the reviewed candidate makes it ineligible', () => {
    // The head never moved and its approval is still exactly current — which is
    // why review currency alone would have waved this through.
    const result = eligibility({ baseSha: Y, baseShaAfter: Y, baseContainedInHead: false });
    expect(result.reviewCurrency.verdict, 'the approval of the head is still current').toBe('current');
    expect(result.baseIntegration).toBe('behind');
    expect(result.mergeEligible, 'but the pair was never reviewed').toBe(false);
    expect(result.baseReason).toContain('incorporate it');
  });

  it('incorporating the base makes a NEW head, which the old approval does not cover', () => {
    // The remedy is the same rule applying again, not an exception to it.
    const result = evaluateMergeEligibility({
      headSha: B, headShaAfter: B, reviews: [approved(A)], reviewComments: [],
      pullAuthorLogin: WORKER, baseSha: Y, baseShaAfter: Y, baseContainedInHead: true,
    });
    expect(result.reviewCurrency.verdict).toBe('stale');
    expect(result.baseIntegration, 'the base is now contained').toBe('integrated');
    expect(result.mergeEligible).toBe(false);
  });

  it('and an approval of that new head is eligible', () => {
    const result = evaluateMergeEligibility({
      headSha: B, headShaAfter: B, reviews: [approved(A), approved(B)], reviewComments: [],
      pullAuthorLogin: WORKER, baseSha: Y, baseShaAfter: Y, baseContainedInHead: true,
    });
    expect(result.mergeEligible).toBe(true);
  });

  it('ancestry that cannot be proven is not permission', () => {
    for (const unproven of [undefined, null, 'yes', 1, {}]) {
      const result = eligibility({ baseContainedInHead: unproven });
      expect(result.baseIntegration, String(unproven)).toBe('indeterminate');
      expect(result.mergeEligible).toBe(false);
    }
    expect(eligibility({ baseSha: 'not-a-sha', baseShaAfter: 'not-a-sha' }).baseIntegration).toBe('indeterminate');
  });


  it('a base that MOVES while the gate runs is never eligible', () => {
    // Containment was computed for one (base, head) pair. The head holding
    // still says nothing about the base, and the pair is what gets merged.
    const moved = eligibility({ baseShaAfter: Y });
    expect(moved.reviewCurrency.verdict, 'the head is still approved').toBe('current');
    expect(moved.baseIntegration).toBe('indeterminate');
    expect(moved.baseReason).toContain('moved');
    expect(moved.mergeEligible).toBe(false);

    // A base that could not be re-read at all is equally unproven.
    const unread = eligibility({ baseShaAfter: undefined });
    expect(unread.baseIntegration).toBe('indeterminate');
    expect(unread.baseReason).toContain('held still');
  });

  it('every base answer it can give is one of the named verdicts', () => {
    // The vocabulary is exported so a caller can exhaust it; a value outside it
    // would be a verdict nobody wrote a branch for.
    for (const over of [{}, { baseShaAfter: Y }, { baseSha: 'not-a-sha', baseShaAfter: 'not-a-sha' },
      { baseContainedInHead: false }, { baseContainedInHead: undefined }]) {
      expect(BASE_INTEGRATION_VERDICTS).toContain(eligibility(over).baseIntegration);
    }
  });

  it('the two facts are reported separately, never collapsed', () => {
    // "Nobody approved this" and "the base moved underneath it" need different
    // actions, so they may not share a verdict.
    const result = evaluateMergeEligibility({
      headSha: B, headShaAfter: B, reviews: [approved(A)], reviewComments: [],
      baseSha: Y, baseShaAfter: Y, baseContainedInHead: false,
    });
    expect(result.reviewCurrency.verdict).toBe('stale');
    expect(result.baseIntegration).toBe('behind');
    expect(result.reason).toContain('review=stale');
    expect(result.reason).toContain('base=behind');
  });
});

/**
 * THE REVIEWER'S CLEAN SIGNAL IS NOT SHA-BOUND, SO IT CANNOT BE APPROVAL.
 *
 * Measured on this repository: PRs #213 and #214 carry a `+1` reaction from the
 * reviewer and nothing else. A reaction's payload is
 * `content, created_at, id, node_id, user` — there is no commit field on it, so
 * it cannot say which code was clean. A commit status can.
 */
describe('clean-review attestation', () => {
  const status = (over: Record<string, unknown> = {}) => ({
    context: REVIEW_ATTESTATION_CONTEXT, state: 'success', sha: A,
    creator: { login: REVIEWER }, ...over,
  });
  const withStatuses = (statuses: unknown, reviews: unknown[] = [], reviewComments: unknown[] = []) =>
    evaluateReviewCurrency({
      headSha: A, headShaAfter: A, reviews, reviewComments, statuses,
      pullAuthorLogin: WORKER,
    });

  it('an authorized attestation on the exact head approves it', () => {
    const result = withStatuses([status()]);
    expect(result.verdict).toBe('current');
    expect(result.attested).toBe(true);
    expect(result.reviewedSha).toBe(A);
    expect(result.approvedBy).toEqual([REVIEWER]);
  });

  it('a real status row, which carries no sha of its own, is honoured', () => {
    // GitHub's `/commits/{ref}/statuses` items are url, avatar_url, id, node_id,
    // state, description, target_url, context, created_at, updated_at, creator —
    // there is no sha field. The rows are fetched FOR a sha, and the optional
    // `sha` this code also accepts is only a defence against a caller handing
    // over another commit's statuses.
    const bare = { context: REVIEW_ATTESTATION_CONTEXT, state: 'success', creator: { login: REVIEWER } };
    const result = withStatuses([bare]);
    expect(result.verdict).toBe('current');
    expect(result.attested).toBe(true);
  });

  it('nothing weaker counts', () => {
    // Wrong context, not success, another commit's status, or an unauthorized
    // creator — each is refused, and none is "probably fine".
    expect(withStatuses([status({ context: 'ci/other' })]).verdict).toBe('stale');
    expect(withStatuses([status({ state: 'pending' })]).verdict).toBe('stale');
    expect(withStatuses([status({ state: 'failure' })]).verdict).toBe('stale');
    expect(withStatuses([status({ sha: B })]).verdict).toBe('stale');
    expect(withStatuses([status({ creator: { login: 'a-passing-collaborator' } })]).verdict).toBe('stale');
  });

  it('the author cannot attest their own head', () => {
    // The coding worker self-certifying is the failure this whole control
    // exists to prevent; an attestation does not become an exception to it.
    expect(evaluateReviewCurrency({
      headSha: A, headShaAfter: A, reviews: [], reviewComments: [],
      statuses: [status({ creator: { login: WORKER } })], pullAuthorLogin: WORKER,
    }).verdict).toBe('stale');
  });

  it('an attestation cannot outrank a blocking finding on the same head', () => {
    expect(withStatuses([status()], [], [finding(A, '**P1 Badge** still broken')]).verdict).toBe('blocked');
  });

  it('a REVOKED attestation is not a standing one', () => {
    // A status is not a one-way door. The reviewer publishes `success` and
    // later withdraws it on the same sha and context; both rows remain, and
    // accepting the older success would make withdrawal invisible.
    const revoked = [
      status({ state: 'failure', created_at: '2026-09-05T12:00:00Z' }),
      status({ state: 'success', created_at: '2026-09-05T11:00:00Z' }),
    ];
    expect(withStatuses(revoked).verdict).toBe('stale');
    // Newest-first is GitHub's documented order, and is honoured when the rows
    // carry no timestamps at all.
    expect(withStatuses([status({ state: 'pending' }), status()]).verdict).toBe('stale');
    // Re-attesting after a withdrawal approves again.
    expect(withStatuses([
      status({ state: 'success', created_at: '2026-09-05T13:00:00Z' }),
      status({ state: 'failure', created_at: '2026-09-05T12:00:00Z' }),
    ]).verdict).toBe('current');
  });

  it('the latest state decides even when it comes from another creator', () => {
    // One authority withdrawing what another published is a disagreement, and
    // a disagreement is not an approval.
    expect(withStatuses([
      status({ state: 'failure', creator: { login: APPROVER }, created_at: '2026-09-05T12:00:00Z' }),
      status({ state: 'success', creator: { login: REVIEWER }, created_at: '2026-09-05T11:00:00Z' }),
    ]).verdict).toBe('stale');
  });

  it('a status for another commit never becomes the latest state of this one', () => {
    // Rows for other shas are discarded before recency is considered, so a
    // newer status on a different commit cannot revoke — or supply — this one.
    expect(withStatuses([
      status({ sha: B, state: 'failure', created_at: '2026-09-05T12:00:00Z' }),
      status({ state: 'success', created_at: '2026-09-05T11:00:00Z' }),
    ]).verdict).toBe('current');
  });

  it('statuses that could not be read fail closed', () => {
    // "The caller could not read them" is not "there were none".
    expect(withStatuses('unavailable').verdict).toBe('indeterminate');
    // Absent is fine: it simply means no attestation was offered.
    expect(evaluateReviewCurrency({
      headSha: A, headShaAfter: A, reviews: [approved(A)], reviewComments: [],
    }).verdict).toBe('current');
  });
});

/**
 * THE THREAT MODEL, EXECUTED.
 *
 * The coding worker can push to `main`, because branch protection is
 * unavailable on this plan. What it can no longer do is publish a commit status
 * (`statuses: read`), dispatch a workflow (`actions: read`), or touch
 * administration, secrets or environments at all. These cases fix what the
 * VERIFIER refuses regardless of any of that — the part that holds even if the
 * worker's credential were wider than it is.
 */
describe('a coding worker cannot certify itself', () => {
  const status = (over: Record<string, unknown> = {}) => ({
    context: REVIEW_ATTESTATION_CONTEXT, state: 'success', sha: A,
    creator: { login: REVIEWER }, ...over,
  });
  const check = (over: Record<string, unknown>) => evaluateReviewCurrency({
    headSha: A, headShaAfter: A, reviews: [], reviewComments: [], pullAuthorLogin: WORKER, ...over,
  });

  it('1+3. a status it publishes under its own identity is not a review', () => {
    // The App grant makes this unreachable — `statuses: read` cannot POST one —
    // but the verifier refuses it anyway, so the rule does not depend on the grant.
    expect(check({ statuses: [status({ creator: { login: WORKER } })] }).verdict).toBe('stale');
  });

  it('2+4. a status naming a different commit cannot be replayed onto this head', () => {
    // Attesting SHA A and presenting it for head B is the replay this refuses.
    expect(check({ headSha: B, headShaAfter: B, statuses: [status({ sha: A })] }).verdict).toBe('stale');
    // And an arbitrary chosen sha is equally not this head.
    expect(check({ statuses: [status({ sha: 'e'.repeat(40) })] }).verdict).toBe('stale');
  });

  it('5. a reaction can never certify anything, because it is not an input', () => {
    // Reactions carry no commit field, so they are not consulted at all. There
    // is no shape of reaction data that reaches a verdict.
    const asIfReaction = { content: '+1', user: { login: REVIEWER }, created_at: '2026-09-05T03:08:00Z' };
    expect(check({ reviews: [asIfReaction], statuses: [asIfReaction] }).verdict).toBe('stale');
  });

  it('6. a valid approval does not survive the base moving underneath it', () => {
    const moved = evaluateMergeEligibility({
      headSha: A, headShaAfter: A, reviews: [approved(A)], reviewComments: [], statuses: [],
      pullAuthorLogin: WORKER, baseSha: 'f'.repeat(40), baseShaAfter: 'f'.repeat(40), baseContainedInHead: false,
    });
    expect(moved.reviewCurrency.verdict, 'the head really was approved').toBe('current');
    expect(moved.mergeEligible, 'but the pair was never reviewed').toBe(false);
  });

  it('7. widening the allowlist cannot make the author their own reviewer', () => {
    // The policy-modification attack: change the trust list in the same change
    // that the list is asked to approve. The author is refused BEFORE the
    // allowlist is consulted, so the widened list buys nothing.
    expect(check({
      statuses: [status({ creator: { login: WORKER } })],
      reviewerLogins: [WORKER, REVIEWER],
    }).verdict).toBe('stale');
    expect(check({
      reviews: [approved(A, WORKER)],
      reviewerLogins: [WORKER],
    }).verdict).toBe('stale');
  });

  it('8. an approval by the founder is refused if the worker ever authors as them', () => {
    // The migration's own premise, executable: the external approver is only
    // external while the coding environment does not hold that credential. If a
    // pull request is ever authored by the approver, its approval is
    // self-certification and is refused on the author rule.
    expect(evaluateReviewCurrency({
      headSha: A, headShaAfter: A, reviews: [approved(A, APPROVER)], reviewComments: [],
      pullAuthorLogin: APPROVER,
    }).verdict).toBe('stale');
  });

  it('and the shipped policy never lists an identity that may not attest', () => {
    // A change adding the worker to the authority list fails here, in CI,
    // rather than quietly becoming self-approval.
    for (const forbidden of NON_ATTESTING_IDENTITIES) {
      expect(EXTERNAL_APPROVER_LOGINS, `${forbidden} may never approve`).not.toContain(forbidden);
      expect(INDEPENDENT_REVIEWER_LOGINS, `${forbidden} may never review`).not.toContain(forbidden);
    }
    expect(NON_ATTESTING_IDENTITIES.length, 'the coding worker identity is named').toBeGreaterThan(0);
    expect(EXTERNAL_APPROVER_LOGINS.length, 'an approver outside this environment is named').toBeGreaterThan(0);
  });

  it('with no approval and no attestation the gate is closed and stays closed', () => {
    expect(check({ statuses: [] }).verdict).toBe('stale');
  });
});

/**
 * EVERY PAGE, OR NONE.
 *
 * A blocking finding on page two is still a finding, and GitHub's default page
 * is 30 rows. The walk is a plain function precisely so this is testable
 * without spawning the CLI.
 */
describe('pagination', () => {
  const pages = (...chunks: unknown[][]) => (page: number) => chunks[page - 1] ?? [];

  it('a short page ends the walk', () => {
    const full = Array.from({ length: 3 }, (_, index) => ({ id: index }));
    expect(collectPages(pages(full, [{ id: 9 }]), { perPage: 3 }))
      .toEqual([...full, { id: 9 }]);
  });

  it('a page of exactly the page size is not the last page', () => {
    // The off-by-one that silently truncates: a full final page looks identical
    // to a full middle page, so the walk must ask again.
    const full = [{ id: 1 }, { id: 2 }];
    expect(collectPages(pages(full, full, []), { perPage: 2 })).toHaveLength(4);
  });

  it('a page that is not a list is an error, never an empty result', () => {
    expect(() => collectPages(() => ({ message: 'Not Found' }) as never, { perPage: 2 }))
      .toThrow(/not a list/u);
  });

  it('a walk that will not finish is an error, never a truncation', () => {
    // Truncating quietly is the one behaviour a gate may not have.
    expect(() => collectPages(() => [{ id: 1 }], { perPage: 1, maxPages: 3 }))
      .toThrow(/did not finish/u);
  });
});

/**
 * A GATE THAT DOES NOTHING MUST NOT EXIT 0.
 *
 * The entry guard decides whether this file is the program being run. Built
 * from an unencoded path it reads false wherever a URL escapes a character — a
 * space is the common one, and per-task worktree names are chosen by the worker
 * — and the process would then exit 0 having checked nothing.
 */
describe('the CLI entry guard', () => {
  const runFrom = (directory: string) => {
    const copy = join(directory, 'julius-review-currency.mjs');
    copyFileSync(resolve(import.meta.dirname, 'julius-review-currency.mjs'), copy);
    try {
      execFileSync(process.execPath, [copy], { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { code: failure.status ?? -1, stderr: failure.stderr ?? '' };
    }
  };

  it('runs from a path that a URL has to percent-encode', () => {
    // Without canonical URLs on both sides this exits 0 in silence, which reads
    // exactly like a passing gate.
    const directory = mkdtempSync(join(tmpdir(), 'julius gate '));
    try {
      const result = runFrom(directory);
      expect(result.code, 'no arguments must be a usage error, never a silent pass').toBe(2);
      expect(result.stderr).toContain('usage:');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

/**
 * REVIEW CURRENCY — does a review approve the code that is actually there?
 *
 * A review approves a COMMIT, not a pull request. We hit the same hazard four
 * times on one branch: a clean review arrives for SHA A, a finding is repaired,
 * the head becomes B, and the review for A stays visible at the top of the page
 * reading like approval. Every time, the enforcement was a human remembering.
 *
 * This is that rule as a function. It is dependency-free `.mjs` on purpose: the
 * npm script runs it with `node` and no build step, and the TypeScript tests
 * import THESE functions, so the rule a gate enforces and the rule a test
 * checks are the same code.
 *
 * FAIL CLOSED. Every answer other than `current` blocks. Metadata that cannot
 * be read, an identity that cannot be proven, a head that moves while the gate
 * runs — none of them are "probably fine", and none of them may be reported as
 * approval. Unknown is not approval.
 */

/**
 * WHO COUNTS AS THE INDEPENDENT REVIEWER.
 *
 * Reviews are only meaningful from an authority that is not the author. This
 * is an exact-match allowlist rather than "any GitHub review", because a
 * repository collaborator, an automation the author controls, or the author
 * themselves would otherwise be able to self-certify a head.
 */
export const INDEPENDENT_REVIEWER_LOGINS = Object.freeze(['chatgpt-codex-connector[bot]']);

/** The only verdicts. Anything not `current` blocks. */
export const REVIEW_CURRENCY_VERDICTS = Object.freeze(['current', 'stale', 'blocked', 'indeterminate']);

/** Whether the reviewed candidate already contains the base it will merge into. */
export const BASE_INTEGRATION_VERDICTS = Object.freeze(['integrated', 'behind', 'indeterminate']);

/**
 * THE SHA-BOUND CLEAN ATTESTATION, because the reviewer's own clean signal is not one.
 *
 * Measured, not assumed: this reviewer reports findings as review comments and
 * reports NO findings with a `+1` reaction on the issue (PRs #213 and #214 both
 * carry exactly that and nothing else). A reaction's payload is
 * `content, created_at, id, node_id, user` — there is no commit field on it at
 * all, so it cannot say WHICH code was clean. Accepting it would make "clean at
 * some point" indistinguishable from "clean at this head", which is the whole
 * hazard.
 *
 * A commit status is the GitHub-native artifact that IS bound to a sha and
 * carries an authenticated creator. An authorized reviewer publishing
 * `success` on this context for an exact commit is the machine-verifiable
 * statement the reaction cannot make.
 */
export const REVIEW_ATTESTATION_CONTEXT = 'julius/independent-review';

/** A review state that says something about the code. `DISMISSED` does not. */
const MEANINGFUL_STATES = Object.freeze(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED']);

const FULL_SHA = /^[0-9a-f]{40}$/u;

/**
 * A FINDING THAT BLOCKS.
 *
 * This reviewer reports severity as a badge in the comment body — `P1`, and
 * the words Critical and High. Nothing here infers severity from tone or
 * length: an unrecognised comment on the head is treated as blocking, because
 * a finding this function cannot classify is not a finding it may dismiss.
 */
const BLOCKING_MARKERS = [/\bP1\b/u, /\bcritical\b/iu, /\bhigh\b/iu];

const isBlockingBody = (body) => {
  if (typeof body !== 'string' || body.trim() === '') return true;
  if (BLOCKING_MARKERS.some((marker) => marker.test(body))) return true;
  // A recognised non-blocking severity, and nothing else, is not blocking.
  return !/\bP[23]\b/u.test(body) && !/\b(medium|low|informational|nit)\b/iu.test(body);
};

const verdict = (name, reason, extra = {}) => ({ verdict: name, reason, ...extra });

/**
 * Is the review on the CURRENT head clean?
 *
 * @param {object} input
 * @param {unknown} input.headSha            PR head, read before the review lookup.
 * @param {unknown} input.headShaAfter       PR head, read again after. A moving target is not reviewable.
 * @param {unknown} input.reviews            `/pulls/{n}/reviews`.
 * @param {unknown} input.reviewComments     `/pulls/{n}/comments`.
 * @param {unknown} [input.pullAuthorLogin]  The PR author, who may never be their own reviewer.
 * @param {readonly string[]} [input.reviewerLogins]
 */
export function evaluateReviewCurrency(input) {
  const reviewerLogins = input?.reviewerLogins ?? INDEPENDENT_REVIEWER_LOGINS;
  const headSha = input?.headSha;
  const headShaAfter = input?.headShaAfter;

  if (typeof headSha !== 'string' || !FULL_SHA.test(headSha)) {
    return verdict('indeterminate', 'the pull request head could not be read as a full commit sha');
  }
  // THE HEAD MOVED WHILE THE GATE RAN. Approving here would approve whichever
  // commit happened to arrive last, which is the hazard this exists to stop.
  if (typeof headShaAfter !== 'string' || !FULL_SHA.test(headShaAfter)) {
    return verdict('indeterminate', 'the pull request head could not be re-read to prove it held still');
  }
  if (headShaAfter !== headSha) {
    return verdict('indeterminate', `the head moved during the check: ${headSha} then ${headShaAfter}`);
  }
  if (!Array.isArray(input?.reviews) || !Array.isArray(input?.reviewComments)) {
    return verdict('indeterminate', 'review metadata was unavailable');
  }
  if (!Array.isArray(reviewerLogins) || reviewerLogins.length === 0) {
    return verdict('indeterminate', 'no independent reviewer identity is configured');
  }

  const authored = typeof input?.pullAuthorLogin === 'string' ? input.pullAuthorLogin : null;
  const isIndependent = (login) =>
    typeof login === 'string'
    && reviewerLogins.includes(login)
    // A worker may not certify its own head, whatever the allowlist says.
    && (authored === null || login !== authored);

  // EXACT SHA. Never ancestry: a review of a parent commit says nothing about
  // the changes made after it, which is precisely when review currency lapses.
  const atHead = input.reviews.filter((review) =>
    review?.commit_id === headSha
    && isIndependent(review?.user?.login)
    && MEANINGFUL_STATES.includes(review?.state));

  /**
   * A CLEAN ATTESTATION IS ALSO A REVIEW OF THIS HEAD.
   *
   * Statuses are optional input; when supplied they must be an array, because
   * "the caller could not read them" is not "there were none".
   */
  const statuses = input.statuses;
  if (statuses !== undefined && !Array.isArray(statuses)) {
    return verdict('indeterminate', 'commit status metadata was unavailable');
  }
  const attested = (statuses ?? []).filter((status) =>
    status?.context === REVIEW_ATTESTATION_CONTEXT
    && status?.state === 'success'
    // The status is fetched FOR this sha; a sha carried on the row is honoured
    // when present so a caller cannot hand over another commit's statuses.
    && (status?.sha === undefined || status?.sha === headSha)
    && isIndependent(status?.creator?.login));

  if (atHead.length === 0 && attested.length === 0) {
    const reviewedElsewhere = input.reviews
      .filter((review) => isIndependent(review?.user?.login) && typeof review?.commit_id === 'string')
      .map((review) => review.commit_id);
    return verdict('stale',
      reviewedElsewhere.length === 0
        ? 'no independent review exists for this pull request'
        : `the independent reviewer has reviewed ${[...new Set(reviewedElsewhere)].join(', ')}, not ${headSha}`,
      { reviewedShas: [...new Set(reviewedElsewhere)] });
  }

  if (atHead.length === 0 && attested.length > 0) {
    // Attested clean, with no review comments to contradict it.
    const contradicting = input.reviewComments.filter((comment) =>
      comment?.original_commit_id === headSha
      && isIndependent(comment?.user?.login)
      && isBlockingBody(comment?.body));
    if (contradicting.length > 0) {
      return verdict('blocked',
        `the attested head carries ${contradicting.length} blocking finding(s)`,
        { reviewedSha: headSha, blockingCount: contradicting.length });
    }
    return verdict('current', `the independent reviewer attested ${headSha} clean`,
      { reviewedSha: headSha, blockingCount: 0, attested: true });
  }

  if (atHead.some((review) => review.state === 'CHANGES_REQUESTED')) {
    return verdict('blocked', 'the independent review of this head requested changes', { reviewedSha: headSha });
  }

  // Findings anchored to THIS head. `original_commit_id` is the commit the
  // comment was written against; a comment carried forward from an older
  // commit is not a finding about this one.
  const blocking = input.reviewComments.filter((comment) =>
    comment?.original_commit_id === headSha
    && isIndependent(comment?.user?.login)
    && isBlockingBody(comment?.body));

  if (blocking.length > 0) {
    return verdict('blocked',
      `the independent review of this head left ${blocking.length} blocking finding(s)`,
      { reviewedSha: headSha, blockingCount: blocking.length });
  }

  return verdict('current', `the independent reviewer reviewed ${headSha} with no blocking findings`,
    { reviewedSha: headSha, blockingCount: 0 });
}

/**
 * MERGE ELIGIBILITY IS NOT REVIEW CURRENCY, AND THEY ARE REPORTED SEPARATELY.
 *
 * A review binds to a commit, and a merge integrates that commit with whatever
 * the base has become. Both can be true and the pair still unreviewed: head A
 * is reviewed cleanly while base is X, main advances to Y, the head never
 * moves, and the exact-head check keeps saying `current` — for a combination
 * A+Y that the reviewer never saw. Exact-head identity alone is insufficient.
 *
 * THE INVARIANT: the current base must already be CONTAINED in the reviewed
 * candidate. Ancestry, established by the caller from GitHub's own merge base,
 * never from timestamps or ordering. If the base has moved beyond the
 * candidate, the answer is not "merge carefully" — it is that the branch must
 * incorporate the base, which produces a NEW head and therefore requires its
 * own exact-head review. That is the same rule applying again, not an
 * exception to it.
 *
 * Two facts, two fields. Overloading them into one verdict would make "nobody
 * reviewed this code" indistinguishable from "the base moved underneath it",
 * and those need different actions.
 */
export function evaluateMergeEligibility(input) {
  const reviewCurrency = evaluateReviewCurrency(input);

  let baseIntegration;
  let baseReason;
  const baseSha = input?.baseSha;
  if (typeof baseSha !== 'string' || !FULL_SHA.test(baseSha)) {
    baseIntegration = 'indeterminate';
    baseReason = 'the base could not be read as a full commit sha';
  } else if (input?.baseContainedInHead === true) {
    baseIntegration = 'integrated';
    baseReason = `the reviewed candidate already contains base ${baseSha}`;
  } else if (input?.baseContainedInHead === false) {
    baseIntegration = 'behind';
    baseReason = `base ${baseSha} is not contained in the reviewed candidate; incorporate it and obtain a review of the new head`;
  } else {
    // STRICTLY true/false. A missing or truthy-ish value is not a proof of
    // ancestry, and guessing here would approve exactly the untested pair.
    baseIntegration = 'indeterminate';
    baseReason = 'containment of the base in the reviewed candidate could not be proven';
  }

  const mergeEligible = reviewCurrency.verdict === 'current' && baseIntegration === 'integrated';
  return {
    reviewCurrency,
    baseIntegration,
    baseReason,
    mergeEligible,
    reason: mergeEligible
      ? `${reviewCurrency.reason}, and ${baseReason}`
      : `not eligible: review=${reviewCurrency.verdict} (${reviewCurrency.reason}); base=${baseIntegration} (${baseReason})`,
  };
}

/* ------------------------------------------------------------------ CLI --- */

/**
 * The gate. Reads AUTHORITATIVE GitHub metadata — the pull request's own head
 * and its review list — and never infers currency from timestamps, ordering,
 * branch names or "the latest review".
 *
 * The head is read TWICE, around the review lookup, so a commit pushed while
 * the gate runs is caught rather than silently approved.
 *
 * Usage: node scripts/julius-review-currency.mjs <owner/repo> <pr-number> [expected-head-sha]
 */
async function main(argv) {
  const [repo, prNumber, expectedHead] = argv;
  if (typeof repo !== 'string' || typeof prNumber !== 'string') {
    process.stderr.write('usage: julius-review-currency.mjs <owner/repo> <pr-number> [expected-head-sha]\n');
    return 2;
  }
  const { execFileSync } = await import('node:child_process');
  const gh = (path) => {
    // `gh` carries the repository's own credential; nothing here reads or
    // prints a token, and no provider is contacted.
    const raw = execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(raw);
  };

  let headSha; let baseSha; let reviews; let reviewComments; let statuses; let pullAuthorLogin; let headShaAfter; let baseContainedInHead;
  try {
    const before = gh(`repos/${repo}/pulls/${prNumber}`);
    headSha = before?.head?.sha;
    pullAuthorLogin = before?.user?.login;
    baseSha = before?.base?.sha;
    reviews = gh(`repos/${repo}/pulls/${prNumber}/reviews`);
    reviewComments = gh(`repos/${repo}/pulls/${prNumber}/comments`);
    statuses = gh(`repos/${repo}/commits/${headSha}/statuses`);
    /**
     * ANCESTRY FROM GITHUB'S OWN MERGE BASE. `merge_base_commit.sha === base`
     * says the base is already an ancestor of the head — the containment the
     * invariant needs — and it is a fact about the commit graph rather than an
     * inference from ordering or time.
     */
    const comparison = gh(`repos/${repo}/compare/${baseSha}...${headSha}`);
    baseContainedInHead = comparison?.merge_base_commit?.sha === baseSha;
    headShaAfter = gh(`repos/${repo}/pulls/${prNumber}`)?.head?.sha;
  } catch (error) {
    // Unreadable metadata is not a passing gate.
    process.stderr.write(`review_currency_indeterminate: ${error instanceof Error ? error.message : 'metadata unavailable'}\n`);
    return 1;
  }

  const result = evaluateMergeEligibility({
    headSha, headShaAfter, reviews, reviewComments, statuses, pullAuthorLogin, baseSha, baseContainedInHead,
  });
  const line = `review_currency=${result.reviewCurrency.verdict} base_integration=${result.baseIntegration}`
    + ` merge_eligible=${result.mergeEligible} head=${typeof headSha === 'string' ? headSha : 'unknown'}`
    + ` reason=${result.reason}`;
  if (result.mergeEligible) {
    process.stdout.write(`${line}\n`);
    return 0;
  }
  process.stderr.write(`${line}\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

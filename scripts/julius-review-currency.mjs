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

  if (atHead.length === 0) {
    const reviewedElsewhere = input.reviews
      .filter((review) => isIndependent(review?.user?.login) && typeof review?.commit_id === 'string')
      .map((review) => review.commit_id);
    return verdict('stale',
      reviewedElsewhere.length === 0
        ? 'no independent review exists for this pull request'
        : `the independent reviewer has reviewed ${[...new Set(reviewedElsewhere)].join(', ')}, not ${headSha}`,
      { reviewedShas: [...new Set(reviewedElsewhere)] });
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

  let headSha; let reviews; let reviewComments; let pullAuthorLogin; let headShaAfter;
  try {
    const before = gh(`repos/${repo}/pulls/${prNumber}`);
    headSha = before?.head?.sha;
    pullAuthorLogin = before?.user?.login;
    reviews = gh(`repos/${repo}/pulls/${prNumber}/reviews`);
    reviewComments = gh(`repos/${repo}/pulls/${prNumber}/comments`);
    headShaAfter = gh(`repos/${repo}/pulls/${prNumber}`)?.head?.sha;
  } catch (error) {
    // Unreadable metadata is not a passing gate.
    process.stderr.write(`review_currency_indeterminate: ${error instanceof Error ? error.message : 'metadata unavailable'}\n`);
    return 1;
  }

  const result = evaluateReviewCurrency({ headSha, headShaAfter, reviews, reviewComments, pullAuthorLogin });
  const line = `review_currency=${result.verdict} head=${typeof headSha === 'string' ? headSha : 'unknown'} reason=${result.reason}`;
  if (result.verdict === 'current') {
    process.stdout.write(`${line}\n`);
    return 0;
  }
  process.stderr.write(`${line}\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

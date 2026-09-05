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
 * IDENTITIES THAT MAY NEVER ATTEST, WHATEVER ANY ALLOWLIST SAYS.
 *
 * The coding worker is the GitHub App `julius-worker[bot]`. It authors the
 * commits and the pull requests under review, so it can never be an authority
 * over them — that is true of any author and does not depend on how the worker
 * is credentialled.
 *
 * What its credential DOES change is the size of the remaining gap. The worker
 * holds contents/pull-requests/issues write and metadata/actions/statuses READ:
 * it cannot publish a commit status, cannot dispatch a workflow, cannot reach
 * secrets, environments or repository administration. It can still push to
 * `main`, because branch protection is unavailable on this plan, so "Julius
 * does not write to main directly" remains a procedural rule and not a
 * server-side one. This list is the structural half of that: checked BEFORE any
 * allowlist, so a change that adds the worker to the reviewer list still cannot
 * make the worker its own reviewer.
 */
export const NON_ATTESTING_IDENTITIES = Object.freeze(['julius-worker[bot]']);

/**
 * THE EXTERNAL APPROVER.
 *
 * The founder account holds a credential this coding environment no longer
 * possesses — it was removed on 2026-09-05 when the worker App replaced it —
 * so an approval carrying this login is a statement by someone outside the
 * environment being reviewed. GitHub binds an `APPROVED` review to a
 * `commit_id`, which makes it exactly the SHA-bound signal this gate needs.
 *
 * The same account is also the only identity that may BLOCK a head, through
 * `CHANGES_REQUESTED`, a review body, or a line comment.
 *
 * This is only sound while the environment genuinely does not hold the
 * founder's credential. If it is ever put back, this entry stops meaning
 * anything and belongs in `NON_ATTESTING_IDENTITIES` instead. It is equally
 * unsound in the other direction: the founder may never approve a pull request
 * the founder authored, which the author rule below enforces without caring
 * which login it is.
 */
export const EXTERNAL_APPROVER_LOGINS = Object.freeze(['ohdieyuh-glitch']);

/**
 * EVERY IDENTITY WHOSE SIGNAL IS READ AT ALL.
 *
 * One list, because the GitHub merge gate has exactly one authority: the
 * founder, who may approve a head and may block one. No provider bot is a
 * development worker, reviewer, blocker or required authority here. A login
 * absent from this list has no standing at all — its reviews, comments and
 * reactions are read past, not weighed — so adding a reviewer is a deliberate
 * edit to this list and never an accident of who happened to comment.
 *
 * That is not the same question as who reviews a Julius RUN. The canonical
 * development model — Prompt Architect, then Coding Agent, then Independent
 * Reviewer — is provider-independent, and Hermes may implement the Independent
 * Reviewer slot at runtime. This file is about who may approve a MERGE on
 * GitHub. Conflating the two would let a runtime verdict stand in for a merge
 * approval, which is a different claim about a different artifact.
 */
export const REVIEW_AUTHORITY_LOGINS = Object.freeze([...EXTERNAL_APPROVER_LOGINS]);

/** The only verdicts. Anything not `current` blocks. */
export const REVIEW_CURRENCY_VERDICTS = Object.freeze(['current', 'stale', 'blocked', 'indeterminate']);

/** Whether the reviewed candidate already contains the base it will merge into. */
export const BASE_INTEGRATION_VERDICTS = Object.freeze(['integrated', 'behind', 'indeterminate']);

/**
 * THE SHA-BOUND CLEAN ATTESTATION.
 *
 * A commit status is the GitHub-native artifact that is bound to a sha and
 * carries an authenticated creator, so an authorized identity publishing
 * `success` on this context for an exact commit makes a machine-verifiable
 * statement about that commit and no other.
 *
 * Nothing publishes it today — the founder's `APPROVED` review is the path that
 * actually runs — and it stays for two reasons. It is the seam any future
 * automated authority would use, whoever that turns out to be, and it is a
 * standing demonstration that the coding worker holding only `statuses: read`
 * cannot forge one.
 */
export const REVIEW_ATTESTATION_CONTEXT = 'julius/independent-review';

/**
 * APPROVAL IS A STATE, AND ONLY ONE STATE MEANS IT.
 *
 * `COMMENTED` says the reviewer looked; it does not say they agreed. The
 * previous revision of this gate accepted a `COMMENTED` review with no blocking
 * findings as approval, because the only configured reviewer never used
 * `APPROVED` at all. Now that a real approver exists, that shortcut is a way
 * for "someone typed a remark" to read as "someone approved this", so it is
 * gone. `DISMISSED` says nothing about the code by construction.
 */
const APPROVING_STATES = Object.freeze(['APPROVED']);

/** States that carry a finding rather than an approval. */
const REJECTING_STATES = Object.freeze(['CHANGES_REQUESTED']);

/** States this gate reads at all; anything else is ignored rather than guessed at. */
const READ_STATES = Object.freeze([...APPROVING_STATES, ...REJECTING_STATES, 'COMMENTED']);

const FULL_SHA = /^[0-9a-f]{40}$/u;

/**
 * A FINDING THAT BLOCKS.
 *
 * Severity is read from the body — a `P1` badge, or the words Critical and
 * High. Nothing here infers it from tone or length, and an unrecognised comment
 * on the head is treated as blocking, because a finding this function cannot
 * classify is not a finding it may dismiss.
 */
const BLOCKING_MARKERS = [/\bP1\b/u, /\bcritical\b/iu, /\bhigh\b/iu];

const isBlockingBody = (body) => {
  if (typeof body !== 'string' || body.trim() === '') return true;
  if (BLOCKING_MARKERS.some((marker) => marker.test(body))) return true;
  // A recognised non-blocking severity, and nothing else, is not blocking.
  return !/\bP[23]\b/u.test(body) && !/\b(medium|low|informational|nit)\b/iu.test(body);
};

const verdict = (name, reason, extra = {}) => ({ verdict: name, reason, ...extra });

const unique = (values) => [...new Set(values)];

/**
 * EVERY PAGE, OR NONE.
 *
 * A finding on page two is still a finding. A single unpaginated request
 * returns GitHub's default 30 rows and says nothing about the rest, which would
 * let a blocking comment outside the first page read as a clean head.
 *
 * The termination rule is deliberately visible rather than delegated to a CLI
 * flag: a short page ends the walk, a page that is not a list is an error, and
 * a walk that will not finish is an error too. Truncating quietly is the one
 * behaviour a gate may not have.
 *
 * @param {(page: number, perPage: number) => unknown} fetchPage
 * @returns {unknown[]} every row, in order.
 */
export function collectPages(fetchPage, { perPage = 100, maxPages = 50 } = {}) {
  const rows = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const chunk = fetchPage(page, perPage);
    if (!Array.isArray(chunk)) throw new Error('a page of results was not a list');
    rows.push(...chunk);
    if (chunk.length < perPage) return rows;
  }
  throw new Error(`pagination did not finish within ${maxPages} pages`);
}

/**
 * ONLY THE LATEST STATE OF THE ATTESTATION COUNTS.
 *
 * A commit status is not a one-way door: a reviewer that publishes `success`
 * and later revokes it with `failure` or `pending` leaves BOTH rows on the sha.
 * Accepting any historical success would make a withdrawn attestation
 * indistinguishable from a standing one, so the context is resolved to a single
 * current state first, and only then asked whether it approves.
 *
 * GitHub returns statuses newest-first; `created_at` is used when every row
 * carries a parseable one, and the documented order is the fallback. A row for
 * another sha is not about this head and is discarded before any of that.
 *
 * @returns {readonly object[]} the single current attestation, or nothing.
 */
function latestAttestation(statuses, headSha, isAuthority) {
  const onContext = (statuses ?? []).filter((status) =>
    status?.context === REVIEW_ATTESTATION_CONTEXT
    // The status is fetched FOR this sha; a sha carried on the row is honoured
    // when present so a caller cannot hand over another commit's statuses.
    && (status?.sha === undefined || status?.sha === headSha));
  if (onContext.length === 0) return [];

  const times = onContext.map((status) => Date.parse(status?.created_at ?? ''));
  const ordered = times.every((time) => Number.isFinite(time))
    // Stable sort, so equal timestamps keep GitHub's newest-first order.
    ? onContext.map((status, index) => ({ status, index }))
      .sort((left, right) => (times[right.index] - times[left.index]) || (left.index - right.index))
      .map((entry) => entry.status)
    : onContext;

  const current = ordered[0];
  return current?.state === 'success' && isAuthority(current?.creator?.login) ? [current] : [];
}

/**
 * Is the review on the CURRENT head an approval, and is that head clean?
 *
 * @param {object} input
 * @param {unknown} input.headSha            PR head, read before the review lookup.
 * @param {unknown} input.headShaAfter       PR head, read again after. A moving target is not reviewable.
 * @param {unknown} input.reviews            `/pulls/{n}/reviews`.
 * @param {unknown} input.reviewComments     `/pulls/{n}/comments`.
 * @param {unknown} [input.statuses]         `/commits/{sha}/statuses`. Optional, but an array when given.
 * @param {unknown} [input.pullAuthorLogin]  The PR author, who may never be their own reviewer.
 * @param {readonly string[]} [input.reviewerLogins]
 */
export function evaluateReviewCurrency(input) {
  const reviewerLogins = input?.reviewerLogins ?? REVIEW_AUTHORITY_LOGINS;
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
    return verdict('indeterminate', 'no review authority is configured');
  }
  // Statuses are optional input; when supplied they must be an array, because
  // "the caller could not read them" is not "there were none".
  const statuses = input?.statuses;
  if (statuses !== undefined && !Array.isArray(statuses)) {
    return verdict('indeterminate', 'commit status metadata was unavailable');
  }

  const authored = typeof input?.pullAuthorLogin === 'string' ? input.pullAuthorLogin : null;
  const permitted = (login, allowed) =>
    typeof login === 'string'
    // Refused first, so widening the allowlist cannot smuggle the author in.
    && !NON_ATTESTING_IDENTITIES.includes(login)
    && allowed.includes(login)
    // And never the author of the pull request under review.
    && (authored === null || login !== authored);
  /** Who may APPROVE: the configured list, which a caller may narrow. */
  const isAuthority = (login) => permitted(login, reviewerLogins);
  /**
   * WHO MAY BLOCK IS NOT NARROWABLE.
   *
   * Approval and objection are asymmetric on purpose. Narrowing the reviewer
   * list can only make approval harder, but if the same list decided findings,
   * a caller could drop the independent reviewer and make its P1s disappear —
   * turning a restriction into a bypass. Findings are therefore judged against
   * every configured authority as well as anything the caller added.
   */
  const blockingAuthorities = unique([...REVIEW_AUTHORITY_LOGINS, ...reviewerLogins]);
  const canBlock = (login) => permitted(login, blockingAuthorities);

  // EXACT SHA. Never ancestry: a review of a parent commit says nothing about
  // the changes made after it, which is precisely when review currency lapses.
  const atHead = input.reviews.filter((review) =>
    review?.commit_id === headSha
    && isAuthority(review?.user?.login)
    && READ_STATES.includes(review?.state));

  /**
   * BLOCKING IS DECIDED BEFORE APPROVAL, NOT AFTER.
   *
   * An approval and a blocking finding can both sit on one head — a human
   * approves while the independent reviewer is still objecting. Reading the
   * approval first would let the later signal disappear, so findings win.
   * `original_commit_id` is the commit a comment was written against; GitHub
   * advances `commit_id` on comments that still apply, which is why the
   * original is the one that decides.
   */
  const changesRequested = input.reviews.filter((review) =>
    review?.commit_id === headSha
    && canBlock(review?.user?.login)
    && REJECTING_STATES.includes(review?.state));
  /**
   * A FINDING CAN BE WRITTEN IN THE REVIEW ITSELF, not only in a line comment.
   * An EMPTY body carries no finding — that is a reviewer who left no summary,
   * not an unclassifiable one — so only a body with text is judged.
   */
  const blockingSummaries = input.reviews.filter((review) =>
    review?.commit_id === headSha
    && canBlock(review?.user?.login)
    && READ_STATES.includes(review?.state)
    && typeof review?.body === 'string' && review.body.trim() !== ''
    && isBlockingBody(review.body));
  const blockingComments = input.reviewComments.filter((comment) =>
    comment?.original_commit_id === headSha
    && canBlock(comment?.user?.login)
    && isBlockingBody(comment?.body));
  const blockingFindings = [...blockingSummaries, ...blockingComments];

  if (changesRequested.length > 0) {
    return verdict('blocked', 'the review of this head requested changes',
      { reviewedSha: headSha, blockingCount: blockingFindings.length });
  }
  if (blockingFindings.length > 0) {
    return verdict('blocked',
      `the review of this head left ${blockingFindings.length} blocking finding(s)`,
      { reviewedSha: headSha, blockingCount: blockingFindings.length });
  }

  // APPROVAL, by either SHA-bound artifact: GitHub's own APPROVED review state,
  // or a clean attestation published as a commit status on this exact sha.
  const approvals = atHead.filter((review) => APPROVING_STATES.includes(review.state));
  const attestations = latestAttestation(statuses, headSha, isAuthority);

  if (approvals.length > 0 || attestations.length > 0) {
    const approvedBy = unique([
      ...approvals.map((review) => review.user.login),
      ...attestations.map((status) => status.creator.login),
    ]);
    return verdict('current',
      attestations.length > 0 && approvals.length === 0
        ? `${approvedBy.join(', ')} attested ${headSha} clean`
        : `${approvedBy.join(', ')} approved ${headSha} with no blocking findings`,
      { reviewedSha: headSha, blockingCount: 0, approvedBy, attested: attestations.length > 0 });
  }

  /**
   * NOT APPROVED IS NOT APPROVED, and the reason says which kind.
   *
   * "Nobody has looked at this", "the reviewer looked and said nothing", and
   * "the approval is for an older commit" are three different situations
   * needing three different actions, so they do not share a sentence.
   */
  if (atHead.length > 0) {
    return verdict('stale',
      `this head was reviewed by ${unique(atHead.map((review) => review.user.login)).join(', ')} `
      + 'but carries no approval; only an APPROVED review or a clean attestation approves a head',
      { reviewedSha: headSha, blockingCount: 0, reviewedShas: [headSha] });
  }

  const approvedElsewhere = unique(input.reviews
    .filter((review) => isAuthority(review?.user?.login)
      && APPROVING_STATES.includes(review?.state)
      && typeof review?.commit_id === 'string')
    .map((review) => review.commit_id));
  return verdict('stale',
    approvedElsewhere.length === 0
      ? 'no approval exists for this pull request'
      : `the approval covers ${approvedElsewhere.join(', ')}, not ${headSha}`,
    { reviewedShas: approvedElsewhere });
}

/**
 * MERGE ELIGIBILITY IS NOT REVIEW CURRENCY, AND THEY ARE REPORTED SEPARATELY.
 *
 * A review binds to a commit, and a merge integrates that commit with whatever
 * the base has become. Both can be true and the pair still unreviewed: head A
 * is approved while base is X, main advances to Y, the head never moves, and
 * the exact-head check keeps saying `current` — for a combination A+Y that the
 * reviewer never saw. Exact-head identity alone is insufficient.
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
 * approved this code" indistinguishable from "the base moved underneath it",
 * and those need different actions.
 */
export function evaluateMergeEligibility(input) {
  const reviewCurrency = evaluateReviewCurrency(input);

  let baseIntegration;
  let baseReason;
  const baseSha = input?.baseSha;
  const baseShaAfter = input?.baseShaAfter;
  if (typeof baseSha !== 'string' || !FULL_SHA.test(baseSha)) {
    baseIntegration = 'indeterminate';
    baseReason = 'the base could not be read as a full commit sha';
  } else if (typeof baseShaAfter !== 'string' || !FULL_SHA.test(baseShaAfter)) {
    // THE BASE IS AS MOVEABLE AS THE HEAD. Containment was computed against one
    // base; if the branch advanced afterwards the answer describes a pair that
    // no longer exists, so an unprovable base is refused the same way.
    baseIntegration = 'indeterminate';
    baseReason = 'the base could not be re-read to prove it held still';
  } else if (baseShaAfter !== baseSha) {
    baseIntegration = 'indeterminate';
    baseReason = `the base moved during the check: ${baseSha} then ${baseShaAfter}`;
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

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The gate. Reads AUTHORITATIVE GitHub metadata — the pull request's own head
 * and its review list — and never infers currency from timestamps, ordering,
 * branch names or "the latest review".
 *
 * The head is read TWICE, around the review lookup, so a commit pushed while
 * the gate runs is caught rather than silently approved.
 *
 * Usage: node scripts/julius-review-currency.mjs <owner/repo> <pr-number>
 */
async function main(argv) {
  const [repo, prNumber] = argv;
  // Validated rather than interpolated as given: a crafted argument would
  // otherwise let the gate report a verdict for a different pull request.
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(repo)
    || typeof prNumber !== 'string' || !/^[1-9][0-9]*$/u.test(prNumber)) {
    process.stderr.write('usage: julius-review-currency.mjs <owner/repo> <pr-number>\n');
    return 2;
  }
  const { execFileSync } = await import('node:child_process');
  const gh = (path) => {
    // `gh` runs as the coding worker, which holds only read access to statuses
    // and no administration at all. Nothing here reads or prints a token, and
    // no provider is contacted.
    const raw = execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(raw);
  };
  const ghAll = (path) => collectPages((page, perPage) =>
    gh(`${path}${path.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`));

  let headSha; let baseSha; let reviews; let reviewComments; let statuses; let pullAuthorLogin;
  let headShaAfter; let baseShaAfter; let baseContainedInHead;
  try {
    const before = gh(`repos/${repo}/pulls/${prNumber}`);
    headSha = before?.head?.sha;
    pullAuthorLogin = before?.user?.login;
    /**
     * THE BASE IS THE BRANCH'S CURRENT TIP, READ AS A BRANCH.
     *
     * `pull.base.sha` is not that. It is a snapshot carried on the pull request
     * and it does not have to advance when the base branch does, so a gate
     * trusting it would compare the head against a base that no longer exists —
     * and report `integrated` for exactly the pair the invariant exists to
     * catch. The branch endpoint answers what is actually there.
     */
    const baseRef = before?.base?.ref;
    if (typeof baseRef !== 'string' || baseRef === '') throw new Error('the base branch could not be read');
    baseSha = gh(`repos/${repo}/branches/${encodeURIComponent(baseRef)}`)?.commit?.sha;
    reviews = ghAll(`repos/${repo}/pulls/${prNumber}/reviews`);
    reviewComments = ghAll(`repos/${repo}/pulls/${prNumber}/comments`);
    statuses = ghAll(`repos/${repo}/commits/${headSha}/statuses`);
    /**
     * ANCESTRY FROM GITHUB'S OWN MERGE BASE. `merge_base_commit.sha === base`
     * says the base is already an ancestor of the head — the containment the
     * invariant needs — and it is a fact about the commit graph rather than an
     * inference from ordering or time. A comparison that cannot be read stays
     * UNDEFINED rather than becoming `false`: "not proven contained" and
     * "proven not contained" are different answers and only one of them is a
     * fact.
     */
    const comparison = gh(`repos/${repo}/compare/${baseSha}...${headSha}`);
    const mergeBase = comparison?.merge_base_commit?.sha;
    baseContainedInHead = typeof mergeBase === 'string' ? mergeBase === baseSha : undefined;
    // BOTH ENDS ARE RE-READ. Containment was computed for one (base, head)
    // pair; either of them moving afterwards describes a pair that no longer
    // exists, so both are proven to have held still or the gate refuses.
    headShaAfter = gh(`repos/${repo}/pulls/${prNumber}`)?.head?.sha;
    baseShaAfter = gh(`repos/${repo}/branches/${encodeURIComponent(baseRef)}`)?.commit?.sha;
  } catch (error) {
    // Unreadable metadata is not a passing gate.
    process.stderr.write(`review_currency_indeterminate: ${error instanceof Error ? error.message : 'metadata unavailable'}\n`);
    return 1;
  }

  const result = evaluateMergeEligibility({
    headSha, headShaAfter, reviews, reviewComments, statuses, pullAuthorLogin,
    baseSha, baseShaAfter, baseContainedInHead,
  });
  const line = `pr=${repo}#${prNumber} review_currency=${result.reviewCurrency.verdict}`
    + ` base_integration=${result.baseIntegration}`
    + ` merge_eligible=${result.mergeEligible} head=${typeof headSha === 'string' ? headSha : 'unknown'}`
    + ` base=${typeof baseSha === 'string' ? baseSha : 'unknown'}`
    + ` approved_by=${(result.reviewCurrency.approvedBy ?? []).join(',') || 'none'}`
    + ` reason=${result.reason}`;
  if (result.mergeEligible) {
    process.stdout.write(`${line}\n`);
    return 0;
  }
  process.stderr.write(`${line}\n`);
  return 1;
}

/**
 * IS THIS FILE THE PROGRAM BEING RUN?
 *
 * Built by hand as `file://${argv[1]}` this comparison is wrong for any path a
 * URL percent-encodes — a space is the common one, and per-task worktrees are
 * named by the worker — and it is wrong again when the path reaches here
 * through a symlink. Either way the guard reads false, `main` never runs, and
 * node exits 0 having checked nothing: a silent pass is the worst answer a gate
 * can give, so the comparison is made on canonical URLs.
 */
const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

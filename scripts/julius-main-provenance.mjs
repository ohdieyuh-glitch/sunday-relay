/**
 * REVIEWED MAIN PROVENANCE — is the exact code tree on `main` externally approved?
 *
 * A pull request approval names a candidate COMMIT. Julius runs `main`, and a
 * squash merge deliberately gives the landed commit a different sha from the
 * one that was approved. So an approval, on its own, proves nothing about the
 * code that actually executes. The link between them has to be established from
 * facts, and the fact that survives a squash is the TREE: squashing changes
 * commit identity and must not change reviewed content.
 *
 * This answers one question and no other: is the exact source tree currently on
 * `main` the tree of a worker-authored candidate that the founder approved at an
 * exact sha, merged as the commit that is there now? It says nothing about
 * whether the code is any good. That is the runtime Independent Reviewer's
 * question, about a different artifact, and conflating the two would let a
 * runtime verdict stand in for a merge provenance proof.
 *
 * WHAT IT REFUSES TO USE. No timestamps, no branch-name conventions, no "the
 * most recent approval", no ancestry in place of identity. Every input is an
 * immutable git object id or an authenticated GitHub record.
 *
 * WHAT IT DOES NOT PROVE. This is a statement about ONE commit, not about the
 * branch's history. A branch reset to an earlier commit that was itself
 * approved still answers `provenant`, correctly — that code was approved — so
 * this gate does not detect a rollback, and nothing here should be read as
 * claiming the branch only ever moved forward. Detecting that needs recorded
 * state across runs, which is a different primitive and deliberately not this
 * one.
 *
 * FAIL CLOSED. `provenant` is the only passing verdict. `unprovenanced` is a
 * definite negative — nothing merged this, the author was wrong, no approval
 * exists, the tree differs. `indeterminate` is everything unreadable, ambiguous,
 * truncated or moving. Both block, and neither may be reported as approval.
 */

import {
  NON_ATTESTING_IDENTITIES,
  REVIEW_AUTHORITY_LOGINS,
  collectPages,
  evaluateReviewCurrency,
} from './julius-review-currency.mjs';

export { NON_ATTESTING_IDENTITIES, REVIEW_AUTHORITY_LOGINS };

/**
 * WHO MAY HAVE AUTHORED THE CANDIDATE.
 *
 * The same set as the identities that may never attest, and derived from it
 * rather than repeated, because that is the invariant: the author of a landed
 * candidate must be an identity that cannot approve one. Written as two
 * independent lists they could drift into overlapping with the approvers, and
 * the drift would be silent — a candidate authored by someone who may also
 * approve is self-certification with extra steps.
 */
export const WORKER_AUTHOR_LOGINS = NON_ATTESTING_IDENTITIES;

/** The only verdicts. Anything not `provenant` blocks. */
export const PROVENANCE_VERDICTS = Object.freeze(['provenant', 'unprovenanced', 'indeterminate']);

const FULL_SHA = /^[0-9a-f]{40}$/u;
const isSha = (value) => typeof value === 'string' && FULL_SHA.test(value);

const verdict = (name, reason, extra = {}) => ({ verdict: name, reason, ...extra });

/**
 * @param {object} input
 * @param {unknown} input.mainSha        `main`, read before the lookups.
 * @param {unknown} input.mainShaAfter   `main`, read again after. A moving branch is not provable.
 * @param {unknown} input.mainTreeSha    The tree of the commit on `main`.
 * @param {unknown} input.mainParents    Its parent shas. A squash onto `main` has exactly one.
 * @param {unknown} input.pullRequests   `/commits/{sha}/pulls` — every PR associated with the commit.
 * @param {unknown} input.reviewedTreeSha The tree of the reviewed candidate head.
 * @param {unknown} input.reviewedHeadShaAfter The PR head, re-read.
 * @param {unknown} input.reviews        The PR's reviews.
 * @param {unknown} input.reviewComments The PR's review comments.
 * @param {unknown} [input.statuses]     Commit statuses on the reviewed head.
 * @param {unknown} input.parentContainedInReviewedHead Strictly true/false.
 * @param {unknown} input.baseRefChanged Strictly false. Whether the pull request was ever retargeted.
 * @param {unknown} [input.branch] The branch under verification. Defaults to `main`.
 */
export function evaluateMainProvenance(input) {
  const branch = typeof input?.branch === 'string' && input.branch !== '' ? input.branch : 'main';
  const mainSha = input?.mainSha;
  const mainShaAfter = input?.mainShaAfter;
  if (!isSha(mainSha)) return verdict('indeterminate', 'the head of main could not be read as a full commit sha');
  if (!isSha(mainShaAfter)) return verdict('indeterminate', 'main could not be re-read to prove it held still');
  // MAIN MOVED WHILE THE GATE RAN. Everything below describes one commit; if the
  // branch advanced, the proof is about code that is no longer running.
  if (mainShaAfter !== mainSha) {
    return verdict('indeterminate', `main moved during the check: ${mainSha} then ${mainShaAfter}`);
  }
  if (!isSha(input?.mainTreeSha)) return verdict('indeterminate', 'the tree of the commit on main could not be read');

  /**
   * EXACTLY ONE PARENT.
   *
   * A squash merge produces a single-parent commit whose parent is the base the
   * merge happened onto. No parents is a root commit and nothing precedes it to
   * check; two or more is a real merge commit, whose content is a combination
   * this gate's tree comparison was not designed to reason about. Both are
   * refused rather than guessed at.
   */
  const parents = input?.mainParents;
  if (!Array.isArray(parents) || !parents.every(isSha)) {
    return verdict('indeterminate', 'the parents of the commit on main could not be read');
  }
  if (parents.length !== 1) {
    return verdict('indeterminate', `the commit on main has ${parents.length} parents; a squashed candidate has exactly one`);
  }
  const parentSha = parents[0];

  if (!Array.isArray(input?.pullRequests)) {
    return verdict('indeterminate', 'the pull requests associated with this commit could not be read');
  }

  /**
   * THE PULL REQUEST THAT PRODUCED THIS COMMIT, not one that merely mentions it.
   *
   * `/commits/{sha}/pulls` lists every pull request associated with a commit,
   * which includes ones whose branch happens to contain it. The discriminator
   * is GitHub's own record of what the merge produced: a merged pull request
   * whose `merge_commit_sha` IS this commit. A push of a commit that was never
   * anything's merge result matches nothing here and fails on the spot.
   *
   * A squash merged into some OTHER branch and then pushed here by hand does
   * match this filter — GitHub recorded it as that pull request's merge result,
   * wherever it was later placed. The base check below is what refuses it, and
   * this filter alone should not be read as catching every direct push.
   */
  const merging = input.pullRequests.filter((pull) =>
    pull?.merged === true && pull?.mergeCommitSha === mainSha);
  if (merging.length === 0) {
    return verdict('unprovenanced',
      `no merged pull request records ${mainSha} as its merge result`,
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha });
  }
  if (merging.length > 1) {
    // Two records claiming the same merge result is a contradiction, and a
    // contradiction is not a proof.
    return verdict('indeterminate',
      `${merging.length} merged pull requests claim ${mainSha} as their merge result`, { mainSha });
  }
  const pull = merging[0];

  /**
   * THE APPROVAL WAS RENDERED AGAINST THIS BRANCH.
   *
   * GitHub shows a reviewer the diff of the head against the pull request's
   * BASE. A candidate opened against some other branch shows a small diff while
   * carrying everything that branch contains, and squashing it produces a
   * commit whose tree is the candidate's — which every other check here would
   * accept. Landing that commit on `main` afterwards would launder content the
   * reviewer never saw into the branch Julius executes.
   *
   * Requiring the base to be the branch under verification is what makes "the
   * founder approved this diff" a statement about THIS branch. It is a fact on
   * the pull request record, not an inference.
   */
  if (pull?.baseRef !== branch) {
    return verdict('unprovenanced',
      `the landed candidate was reviewed against ${typeof pull?.baseRef === 'string' ? pull.baseRef : 'an unreadable branch'}, not ${branch}`,
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha, prNumber: pull?.number });
  }

  /**
   * AND THE BASE WAS NEVER CHANGED.
   *
   * The base a pull request names today is not necessarily the base the review
   * was rendered against: retargeting an open pull request is an ordinary
   * edit, available to anyone who can write to it, and the coding worker can.
   * Approve a one-line diff against a worker branch, retarget to `main`,
   * squash — and the base now reads `main`, the tree is the approved
   * candidate's, and every check above is satisfied by a review of a diff that
   * hid everything the worker branch carried.
   *
   * The honest test of "was the base the reviewer saw the base that merged" is
   * whether it ever moved. Any recorded change refuses, without comparing
   * timestamps to decide whether the change came before or after the approval:
   * ordering inferred from clocks is exactly the kind of reasoning this gate
   * does not do. A candidate that needs a different base needs a new pull
   * request, which gets its own review of its own diff.
   */
  const baseRefChanged = input?.baseRefChanged;
  if (baseRefChanged !== false) {
    return verdict(baseRefChanged === true ? 'unprovenanced' : 'indeterminate',
      baseRefChanged === true
        ? `the base of pull request #${pull?.number} was changed, so the approved diff was rendered against a base that is not the one it merged into`
        : 'whether the base of the landed pull request ever changed could not be established',
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha, prNumber: pull?.number });
  }

  if (!WORKER_AUTHOR_LOGINS.includes(pull?.authorLogin)) {
    return verdict('unprovenanced',
      `the landed candidate was authored by ${typeof pull?.authorLogin === 'string' ? pull.authorLogin : 'an unreadable identity'}, not the coding worker`,
      { mainSha, mainTreeSha: input.mainTreeSha, parentSha, prNumber: pull?.number });
  }
  if (!isSha(pull?.headSha)) {
    return verdict('indeterminate', 'the reviewed head of that pull request could not be read', { prNumber: pull?.number });
  }
  if (!isSha(input?.reviewedTreeSha)) {
    return verdict('indeterminate', 'the tree of the reviewed candidate could not be read', { prNumber: pull.number });
  }

  /**
   * APPROVAL IS THE SAME RULE AS EVERYWHERE ELSE, so there is one definition of
   * it. Exact-sha `APPROVED` from a configured authority that is not the author,
   * with no blocking finding on that head. The author check inside it is what
   * keeps founder self-approval invalid here too, without this file repeating
   * the reasoning.
   */
  const approval = evaluateReviewCurrency({
    headSha: pull.headSha,
    headShaAfter: input?.reviewedHeadShaAfter,
    reviews: input?.reviews,
    reviewComments: input?.reviewComments,
    statuses: input?.statuses,
    pullAuthorLogin: pull.authorLogin,
  });
  if (approval.verdict !== 'current') {
    return verdict(approval.verdict === 'indeterminate' ? 'indeterminate' : 'unprovenanced',
      `the landed candidate is not approved: ${approval.reason}`,
      { mainSha, prNumber: pull.number, reviewedHeadSha: pull.headSha, reviewCurrency: approval.verdict });
  }

  /**
   * THE TREE IS THE THING THAT SURVIVES A SQUASH.
   *
   * Commit identity deliberately changes; content must not. Ancestry is not a
   * substitute: a commit can descend from the reviewed candidate and still carry
   * a different tree, which is precisely the case where something was added
   * after approval.
   */
  if (input.reviewedTreeSha !== input.mainTreeSha) {
    return verdict('unprovenanced',
      `the tree on main (${input.mainTreeSha}) is not the reviewed tree (${input.reviewedTreeSha})`,
      { mainSha, prNumber: pull.number, reviewedHeadSha: pull.headSha });
  }

  /**
   * THE BASE THE SQUASH LANDED ON WAS ALREADY IN THE REVIEWED CANDIDATE.
   *
   * Squashing collapses the candidate onto whatever main had become. If that
   * parent was not already contained in the reviewed head, the landed tree
   * combines approved content with base commits the reviewer never saw — and
   * because the tree comparison above passes whenever the squash reproduced the
   * candidate's tree, nothing else here would notice.
   */
  const contained = input?.parentContainedInReviewedHead;
  if (contained !== true && contained !== false) {
    return verdict('indeterminate',
      'containment of the pre-merge parent in the reviewed candidate could not be proven',
      { mainSha, prNumber: pull.number, parentSha });
  }
  if (contained === false) {
    return verdict('unprovenanced',
      `the pre-merge parent ${parentSha} was not contained in the reviewed candidate`,
      { mainSha, prNumber: pull.number, parentSha, reviewedHeadSha: pull.headSha });
  }

  return verdict('provenant',
    `main ${mainSha} carries the tree of ${pull.headSha}, approved by ${(approval.approvedBy ?? []).join(', ')} and merged as pull request #${pull.number}`,
    {
      mainSha,
      mainTreeSha: input.mainTreeSha,
      parentSha,
      prNumber: pull.number,
      reviewedHeadSha: pull.headSha,
      approvedBy: approval.approvedBy ?? [],
    });
}

/* ------------------------------------------------------------------ CLI --- */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Usage: node scripts/julius-main-provenance.mjs <owner/repo> [branch]
 *
 * Reads the branch twice, around every other lookup, so a push landing while
 * the gate runs is caught rather than silently proved.
 */
/**
 * THE SAME RULE, WITHOUT A `gh` BINARY.
 *
 * The rule above is a pure function over one object; `main` below is only a
 * fetcher, and it fetches with `gh api`. A Claude Code cloud container has no
 * `gh` — so on the one machine that most needs to check a landing before
 * spending money, the authoritative gate could not run at all, and its rules
 * were being re-applied BY HAND from GitHub API responses read another way.
 * Two implementations of a trust rule is one too many, and the hand-run one is
 * the one nobody tests.
 *
 * `--evidence <file>` feeds the same object from JSON gathered however the
 * operator can gather it. It is NOT a weaker mode: every field the rule reads
 * that the file omits arrives `undefined`, and this rule answers
 * `indeterminate` for an unreadable field rather than passing it — so a
 * truncated or hand-trimmed evidence file cannot produce `provenant`. What the
 * mode cannot do is prove the file describes the repository it names, so the
 * output line says where the evidence came from and never claims otherwise.
 */
async function fromEvidenceFile(path) {
  const { readFileSync } = await import('node:fs');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('evidence file must hold a single JSON object');
  }
  return parsed;
}

async function main(argv) {
  const evidenceIndex = argv.indexOf('--evidence');
  const evidencePath = evidenceIndex >= 0 ? argv[evidenceIndex + 1] : undefined;
  const positional = evidenceIndex >= 0 ? [...argv.slice(0, evidenceIndex), ...argv.slice(evidenceIndex + 2)] : argv;
  const [repo, branchArg] = positional;
  const branch = branchArg ?? 'main';
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(repo) || !/^[\w./-]+$/u.test(branch)) {
    process.stderr.write('usage: julius-main-provenance.mjs <owner/repo> [branch] [--evidence <file>]\n');
    return 2;
  }
  if (evidenceIndex >= 0 && (typeof evidencePath !== 'string' || evidencePath === '')) {
    process.stderr.write('usage: --evidence needs a path to a JSON object holding the fields evaluateMainProvenance reads\n');
    return 2;
  }
  if (typeof evidencePath === 'string') {
    let evaluated;
    try {
      evaluated = evaluateMainProvenance({ ...(await fromEvidenceFile(evidencePath)), branch });
    } catch (error) {
      process.stderr.write(`main_provenance_indeterminate: ${error instanceof Error ? error.message : 'evidence unreadable'}\n`);
      return 1;
    }
    return report(repo, branch, evaluated, `file:${evidencePath}`);
  }
  const { execFileSync } = await import('node:child_process');
  const gh = (path) => {
    // `gh` runs as the coding worker: read-only on statuses, no administration.
    // Nothing here reads or prints a token, and no provider is contacted.
    const raw = execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(raw);
  };
  const ghAll = (path) => collectPages((page, perPage) =>
    gh(`${path}${path.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`));
  const ref = encodeURIComponent(branch);

  let result;
  try {
    const mainSha = gh(`repos/${repo}/branches/${ref}`)?.commit?.sha;
    const mainCommit = gh(`repos/${repo}/commits/${mainSha}`);
    const pullRequests = ghAll(`repos/${repo}/commits/${mainSha}/pulls`).map((pull) => ({
      number: pull?.number,
      merged: typeof pull?.merged_at === 'string',
      mergeCommitSha: pull?.merge_commit_sha,
      authorLogin: pull?.user?.login,
      headSha: pull?.head?.sha,
      baseRef: pull?.base?.ref,
    }));
    const landed = pullRequests.find((pull) => pull.merged && pull.mergeCommitSha === mainSha);

    let reviews = [];
    let reviewComments = [];
    let statuses = [];
    let reviewedTreeSha;
    let reviewedHeadShaAfter;
    let parentContainedInReviewedHead;
    let baseRefChanged;
    if (landed && typeof landed.headSha === 'string') {
      reviews = ghAll(`repos/${repo}/pulls/${landed.number}/reviews`);
      reviewComments = ghAll(`repos/${repo}/pulls/${landed.number}/comments`);
      statuses = ghAll(`repos/${repo}/commits/${landed.headSha}/statuses`);
      reviewedTreeSha = gh(`repos/${repo}/commits/${landed.headSha}`)?.commit?.tree?.sha;
      const parent = mainCommit?.parents?.[0]?.sha;
      if (typeof parent === 'string') {
        const comparison = gh(`repos/${repo}/compare/${parent}...${landed.headSha}`);
        const mergeBase = comparison?.merge_base_commit?.sha;
        // Unreadable stays UNDEFINED. "Not proven contained" and "proven not
        // contained" are different answers and only one of them is a fact.
        parentContainedInReviewedHead = typeof mergeBase === 'string' ? mergeBase === parent : undefined;
      }
      /**
       * `base_ref_changed` is the timeline's record of a retarget. Reading the
       * whole timeline and asking whether the event is present is a fact about
       * the pull request; asking WHEN it happened relative to the approval
       * would be an inference from clocks, which this gate does not make.
       */
      baseRefChanged = ghAll(`repos/${repo}/issues/${landed.number}/timeline`)
        .some((event) => event?.event === 'base_ref_changed');
      reviewedHeadShaAfter = gh(`repos/${repo}/pulls/${landed.number}`)?.head?.sha;
    }

    result = evaluateMainProvenance({
      branch,
      mainSha,
      mainShaAfter: gh(`repos/${repo}/branches/${ref}`)?.commit?.sha,
      mainTreeSha: mainCommit?.commit?.tree?.sha,
      mainParents: Array.isArray(mainCommit?.parents) ? mainCommit.parents.map((parent) => parent?.sha) : undefined,
      pullRequests,
      reviewedTreeSha,
      reviewedHeadShaAfter,
      reviews,
      reviewComments,
      statuses,
      parentContainedInReviewedHead,
      baseRefChanged,
    });
  } catch (error) {
    // Unreadable metadata is not a passing gate.
    process.stderr.write(`main_provenance_indeterminate: ${error instanceof Error ? error.message : 'metadata unavailable'}\n`);
    return 1;
  }

  return report(repo, branch, result, 'github');
}

/**
 * One line, and it names its SOURCE. A verdict read from a file and one read
 * from GitHub are the same rule over different evidence, and a reader who
 * cannot tell them apart cannot judge what the pass is worth.
 */
function report(repo, branch, result, source) {
  const line = `repo=${repo} branch=${branch} source=${source} provenance=${result.verdict}`
    + ` main=${result.mainSha ?? 'unknown'} tree=${result.mainTreeSha ?? 'unknown'}`
    + ` pr=${result.prNumber ?? 'none'} reviewed_head=${result.reviewedHeadSha ?? 'none'}`
    + ` approved_by=${(result.approvedBy ?? []).join(',') || 'none'} reason=${result.reason}`;
  if (result.verdict === 'provenant') {
    process.stdout.write(`${line}\n`);
    return 0;
  }
  process.stderr.write(`${line}\n`);
  return 1;
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

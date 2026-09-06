import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  EXTERNAL_APPROVER_LOGINS,
  NON_ATTESTING_IDENTITIES,
  REVIEW_ATTESTATION_CONTEXT,
} from './julius-review-currency.mjs';
import {
  PROVENANCE_VERDICTS,
  REVIEW_AUTHORITY_LOGINS,
  WORKER_AUTHOR_LOGINS,
  evaluateMainProvenance,
} from './julius-main-provenance.mjs';

/**
 * AN APPROVAL NAMES A CANDIDATE; JULIUS RUNS `main`.
 *
 * A squash merge deliberately gives the landed commit a different sha from the
 * approved one, so the approval alone says nothing about the code that
 * executes. The fact that survives a squash is the TREE. These cases are that
 * argument, executable.
 */

const MAIN = '1'.repeat(40);
const PARENT = '2'.repeat(40);
const HEAD = '3'.repeat(40);
const TREE = '4'.repeat(40);
const OTHER_TREE = '5'.repeat(40);
const OTHER = '6'.repeat(40);

const APPROVER = EXTERNAL_APPROVER_LOGINS[0]!;
const WORKER = NON_ATTESTING_IDENTITIES[0]!;
const OUTSIDER = 'a-passing-collaborator';

const approval = (commit = HEAD, login = APPROVER) =>
  ({ commit_id: commit, state: 'APPROVED', user: { login } });
const landedPull = (over: Record<string, unknown> = {}) =>
  ({ number: 226, merged: true, mergeCommitSha: MAIN, authorLogin: WORKER, headSha: HEAD, baseRef: 'main', ...over });

/** The whole proof, in its passing shape. Each case spoils exactly one fact. */
const provenance = (over: Record<string, unknown> = {}) => evaluateMainProvenance({
  mainSha: MAIN,
  mainShaAfter: MAIN,
  mainTreeSha: TREE,
  mainParents: [PARENT],
  pullRequests: [landedPull()],
  reviewedTreeSha: TREE,
  reviewedHeadShaAfter: HEAD,
  reviews: [approval()],
  reviewComments: [],
  statuses: [],
  parentContainedInReviewedHead: true,
  baseRefChanged: false,
  ...over,
});

describe('reviewed main provenance', () => {
  it('the passing shape: an approved worker candidate whose tree is what main carries', () => {
    const result = provenance();
    expect(result.verdict).toBe('provenant');
    expect(result.mainSha).toBe(MAIN);
    expect(result.mainTreeSha).toBe(TREE);
    expect(result.parentSha).toBe(PARENT);
    expect(result.prNumber).toBe(226);
    expect(result.reviewedHeadSha).toBe(HEAD);
    expect(result.approvedBy).toEqual([APPROVER]);
    expect(result.reason).toContain('approved by');
  });

  it('there is one passing verdict and it is named', () => {
    expect(PROVENANCE_VERDICTS.filter((name) => name !== 'provenant'))
      .toEqual(['unprovenanced', 'indeterminate']);
  });

  it('is reachable as a gate', () => {
    // A rule nothing can run is a rule nobody enforces.
    const scripts = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as
      { scripts: Record<string, string> };
    expect(scripts.scripts['julius:main-provenance'])
      .toContain('scripts/julius-main-provenance.mjs');
  });
});

/**
 * THE THREAT CASES.
 *
 * Each one is a way the code running on `main` could differ from the code
 * somebody approved. None of them is hypothetical: every one is reachable by an
 * identity that holds push access to an unprotected branch, which the coding
 * worker does.
 */
describe('what must never be reported as provenant', () => {
  it('1. a direct push to main, with no pull request behind it', () => {
    // The commit is real, its tree is real, and nothing merged it. GitHub's own
    // record of what a merge produced is the discriminator.
    const pushed = provenance({ pullRequests: [] });
    expect(pushed.verdict).toBe('unprovenanced');
    expect(pushed.reason).toContain('no merged pull request records');
  });

  it('and a pull request that merely MENTIONS the commit is not the one that merged it', () => {
    // `/commits/{sha}/pulls` lists every associated pull request, including ones
    // whose branch happens to contain the commit. Association is not causation.
    expect(provenance({
      pullRequests: [landedPull({ merged: false }), landedPull({ mergeCommitSha: OTHER })],
    }).verdict).toBe('unprovenanced');
    // `merged` is read strictly. A truthy value that is not `true` is a shape
    // this gate does not recognise, and an unrecognised shape is not a merge.
    for (const merged of ['yes', 1, {}, 'true']) {
      expect(provenance({ pullRequests: [landedPull({ merged })] }).verdict, String(merged)).toBe('unprovenanced');
    }
  });

  it('2. an unapproved merge', () => {
    const unapproved = provenance({ reviews: [] });
    expect(unapproved.verdict).toBe('unprovenanced');
    expect(unapproved.reviewCurrency).toBe('stale');
    expect(unapproved.reason).toContain('not approved');
  });

  it('3. an approval left behind by a head change', () => {
    // The candidate was approved at one sha and something was pushed after it.
    // The landed head is not the approved head, so the approval covers code
    // that is not what merged.
    const stale = provenance({ reviews: [approval(OTHER)] });
    expect(stale.verdict).toBe('unprovenanced');
    expect(stale.reviewCurrency).toBe('stale');
  });

  it('4. ancestry without tree equality', () => {
    // The landed commit descends from the reviewed candidate and carries a
    // different tree: something was added after approval. Ancestry is not a
    // substitute for content, which is the whole reason this compares trees.
    const drifted = provenance({ mainTreeSha: OTHER_TREE });
    expect(drifted.verdict).toBe('unprovenanced');
    expect(drifted.reason).toContain('is not the reviewed tree');
  });

  it('5. tree equality without a valid exact-sha approval', () => {
    // The mirror image: the content is exactly what was proposed, and nobody
    // with standing ever approved it.
    for (const reviews of [
      [],
      [approval(HEAD, WORKER)],
      [approval(HEAD, OUTSIDER)],
      [{ commit_id: HEAD, state: 'COMMENTED', user: { login: APPROVER } }],
      [{ commit_id: HEAD, state: 'DISMISSED', user: { login: APPROVER } }],
    ]) {
      expect(provenance({ reviews }).verdict, JSON.stringify(reviews).slice(0, 50)).toBe('unprovenanced');
    }
  });

  it('6. a candidate authored by anyone but the coding worker', () => {
    // Including the approver: a founder-authored candidate approved by the
    // founder is self-certification, and this refuses it twice over — once on
    // the author rule inside the approval check, and once here.
    for (const author of [APPROVER, OUTSIDER, undefined, 42]) {
      const wrong = provenance({ pullRequests: [landedPull({ authorLogin: author })] });
      expect(wrong.verdict, String(author)).toBe('unprovenanced');
      expect(wrong.reason).toContain('not the coding worker');
    }
  });

  it('7. founder self-approval stays invalid even with everything else perfect', () => {
    // Refused twice over, and the reasons say which check did it: the author
    // rule here, and the author rule inside the approval check. Asserting the
    // reason keeps this from passing for an unrelated reason.
    const selfAuthored = provenance({
      pullRequests: [landedPull({ authorLogin: APPROVER })],
      reviews: [approval(HEAD, APPROVER)],
    });
    expect(selfAuthored.verdict).toBe('unprovenanced');
    expect(selfAuthored.reason).toContain('not the coding worker');

    // And with the worker as author, an approval by the author is still refused
    // inside the approval check rather than here.
    const selfApproved = provenance({ reviews: [approval(HEAD, WORKER)] });
    expect(selfApproved.verdict).toBe('unprovenanced');
    expect(selfApproved.reason).toContain('not approved');
  });

  it('8. the worker cannot approve, and cannot attest either', () => {
    // The grant makes publishing a status impossible, and the verifier refuses
    // it regardless, so the rule does not depend on the grant.
    expect(provenance({ reviews: [approval(HEAD, WORKER)] }).verdict).toBe('unprovenanced');
    expect(provenance({
      reviews: [],
      statuses: [{ context: REVIEW_ATTESTATION_CONTEXT, state: 'success', creator: { login: WORKER } }],
    }).verdict).toBe('unprovenanced');
  });

  it('9. a candidate reviewed against some OTHER branch, then landed on main', () => {
    // GitHub renders the diff against the pull request's BASE. Opened against a
    // worker-controlled branch, a candidate shows a small diff while carrying
    // everything that branch contains; squashing reproduces the candidate's
    // tree, so the tree comparison passes. Only the base tells the difference
    // between "the founder approved this diff against main" and "against
    // something the worker wrote".
    const laundered = provenance({ pullRequests: [landedPull({ baseRef: 'relay/worker-staging' })] });
    expect(laundered.verdict).toBe('unprovenanced');
    expect(laundered.reason).toContain('reviewed against relay/worker-staging, not main');
    // And an unreadable base is not a base.
    for (const base of [undefined, null, 42, 'MAIN']) {
      expect(provenance({ pullRequests: [landedPull({ baseRef: base })] }).verdict, String(base)).toBe('unprovenanced');
    }
  });

  it('and a base RETARGETED after review is refused, without reading any clock', () => {
    // Approve a one-line diff against a worker branch, retarget to main, squash:
    // the base now reads `main`, the tree is the approved candidate's, and every
    // other check passes. Whether the base ever moved is the honest test, and it
    // does not require deciding whether it moved before or after the approval.
    const retargeted = provenance({ baseRefChanged: true });
    expect(retargeted.verdict).toBe('unprovenanced');
    expect(retargeted.reason).toContain('was changed');
    // Unknown is not a proof that it held.
    for (const unknown of [undefined, null, 'no', 0]) {
      const unproven = provenance({ baseRefChanged: unknown });
      expect(unproven.verdict, String(unknown)).toBe('indeterminate');
      expect(unproven.reason).toContain('could not be established');
    }
  });

  it('a squash merged into ANOTHER branch and then pushed here is refused', () => {
    // GitHub recorded it as that pull request's merge result wherever it was
    // later placed, so the merge-result filter alone does not catch it. The base
    // does.
    const relocated = provenance({ pullRequests: [landedPull({ baseRef: 'relay/worker-staging' })] });
    expect(relocated.verdict).toBe('unprovenanced');
    expect(relocated.reason).toContain('reviewed against');
  });

  it('and the branch under verification is the one the base must match', () => {
    // Verifying a different branch means the base must be THAT branch.
    expect(provenance({ branch: 'release', pullRequests: [landedPull({ baseRef: 'release' })] }).verdict).toBe('provenant');
    expect(provenance({ branch: 'release' }).verdict).toBe('unprovenanced');
  });

  it('10. an unintegrated base hidden by the squash', () => {
    // The squash collapsed the candidate onto a parent the reviewer never saw.
    // The tree comparison passes, because the squash reproduced the candidate's
    // tree; only the containment check notices.
    const behind = provenance({ parentContainedInReviewedHead: false });
    expect(behind.verdict).toBe('unprovenanced');
    expect(behind.reason).toContain('was not contained in the reviewed candidate');
    expect(behind.parentSha).toBe(PARENT);
  });

  it('11. a blocking finding on the approved head', () => {
    const blocked = provenance({
      reviewComments: [{ original_commit_id: HEAD, body: '**P1** broken', user: { login: APPROVER } }],
    });
    expect(blocked.verdict).toBe('unprovenanced');
    expect(blocked.reviewCurrency).toBe('blocked');
  });
});

/**
 * UNKNOWN IS NOT APPROVAL.
 *
 * Everything unreadable, ambiguous, truncated or moving is `indeterminate`,
 * which blocks exactly as hard as a definite negative but says something
 * different about why.
 */
describe('fail closed on anything unproven', () => {
  it('main moving during the check is never proved', () => {
    const moved = provenance({ mainShaAfter: OTHER });
    expect(moved.verdict).toBe('indeterminate');
    expect(moved.reason).toContain('moved');
    // And a branch that could not be re-read at all is equally unproven — by
    // the re-read guard specifically, which the reason names.
    const unread = provenance({ mainShaAfter: undefined });
    expect(unread.verdict).toBe('indeterminate');
    expect(unread.reason).toContain('held still');
  });

  it('unreadable git object ids are refused rather than guessed at', () => {
    for (const over of [
      { mainSha: undefined }, { mainSha: 'not-a-sha', mainShaAfter: 'not-a-sha' },
      { mainTreeSha: undefined }, { mainTreeSha: 'short' },
      { mainParents: undefined }, { mainParents: ['not-a-sha'] },
      { pullRequests: undefined }, { pullRequests: 'unavailable' },
      { pullRequests: [landedPull({ headSha: 'not-a-sha' })] },
      { reviewedTreeSha: undefined },
    ]) {
      expect(provenance(over).verdict, JSON.stringify(over).slice(0, 50)).toBe('indeterminate');
    }
  });

  it('a commit that is not a single-parent squash is refused', () => {
    // Two parents is a real merge commit whose content is a combination this
    // gate's tree comparison was not designed to reason about; no parents is a
    // root commit with nothing before it to check.
    expect(provenance({ mainParents: [PARENT, OTHER] }).verdict).toBe('indeterminate');
    expect(provenance({ mainParents: [] }).verdict).toBe('indeterminate');
  });

  it('two pull requests claiming the same merge result is a contradiction, not a proof', () => {
    const ambiguous = provenance({ pullRequests: [landedPull(), landedPull({ number: 999 })] });
    expect(ambiguous.verdict).toBe('indeterminate');
    expect(ambiguous.reason).toContain('claim');
  });

  it('unreadable review metadata is indeterminate, not merely unapproved', () => {
    // The distinction matters: "nobody approved this" and "the approval could
    // not be read" call for different actions.
    expect(provenance({ reviews: null }).verdict).toBe('indeterminate');
    expect(provenance({ reviewComments: undefined }).verdict).toBe('indeterminate');
    expect(provenance({ statuses: 'unavailable' }).verdict).toBe('indeterminate');
    expect(provenance({ reviewedHeadShaAfter: undefined }).verdict).toBe('indeterminate');
    expect(provenance({ reviewedHeadShaAfter: OTHER }).verdict).toBe('indeterminate');
  });

  it('containment that could not be proven is not permission', () => {
    for (const unproven of [undefined, null, 'yes', 1, {}]) {
      const result = provenance({ parentContainedInReviewedHead: unproven });
      expect(result.verdict, String(unproven)).toBe('indeterminate');
      expect(result.reason).toContain('could not be proven');
    }
  });
});

/**
 * THE ROLES ARE DERIVED, NOT REPEATED.
 *
 * Two independent lists could drift into overlapping, and the drift would be
 * silent: a candidate authored by someone who may also approve is
 * self-certification with extra steps.
 */
describe('the identities this gate trusts', () => {
  it('the required author is exactly the set that may never attest', () => {
    expect(WORKER_AUTHOR_LOGINS).toEqual(NON_ATTESTING_IDENTITIES);
    expect(WORKER_AUTHOR_LOGINS).toEqual(['julius-worker[bot]']);
  });

  it('no identity may both author a candidate and approve one', () => {
    for (const author of WORKER_AUTHOR_LOGINS) {
      expect(REVIEW_AUTHORITY_LOGINS, `${author} may never be an authority`).not.toContain(author);
    }
    expect(REVIEW_AUTHORITY_LOGINS).toEqual(['ohdieyuh-glitch']);
  });
});

/**
 * THE TRANSLATION LAYER IS WHERE A GATE QUIETLY STOPS WORKING.
 *
 * The pure function above is only as good as the facts handed to it, and those
 * come from reshaping GitHub's JSON: `merged_at` becomes `merged`, `base.ref`
 * becomes `baseRef`, `commit.tree.sha` becomes a tree. A rename on either side
 * turns a proof into `undefined`, and every `undefined` here is refused — which
 * is safe, but a gate that can only ever fail is not a gate. These cases run the
 * real CLI against a stub `gh` so the reshaping is executed, not assumed.
 */
describe('the CLI, against a stubbed GitHub', () => {
  const REPO = 'owner/repo';
  const routes = (over: Record<string, unknown> = {}) => ({
    [`repos/${REPO}/branches/main`]: { commit: { sha: MAIN } },
    [`repos/${REPO}/commits/${MAIN}`]: { commit: { tree: { sha: TREE } }, parents: [{ sha: PARENT }] },
    [`repos/${REPO}/commits/${MAIN}/pulls`]: [{
      number: 226,
      merged_at: '2026-09-06T00:41:33Z',
      merge_commit_sha: MAIN,
      user: { login: WORKER },
      head: { sha: HEAD },
      base: { ref: 'main' },
    }],
    [`repos/${REPO}/pulls/226`]: { head: { sha: HEAD } },
    [`repos/${REPO}/issues/226/timeline`]: [{ event: 'reviewed' }, { event: 'merged' }],
    [`repos/${REPO}/pulls/226/reviews`]: [approval()],
    [`repos/${REPO}/pulls/226/comments`]: [],
    [`repos/${REPO}/commits/${HEAD}`]: { commit: { tree: { sha: TREE } } },
    [`repos/${REPO}/commits/${HEAD}/statuses`]: [],
    [`repos/${REPO}/compare/${PARENT}...${HEAD}`]: { merge_base_commit: { sha: PARENT } },
    ...over,
  });

  const runWithStub = (table: Record<string, unknown>) => {
    const directory = mkdtempSync(join(tmpdir(), 'julius-provenance-'));
    try {
      // A stub `gh api <path>`: strips the pagination query the gate appends,
      // then answers from the table. An unknown path exits non-zero, exactly as
      // the real CLI would on a 404.
      writeFileSync(join(directory, 'gh'), [
        '#!/usr/bin/env node',
        `const table = ${JSON.stringify(table)};`,
        "const path = (process.argv[3] ?? '').split('?')[0];",
        'if (!(path in table)) { process.stderr.write(`stub: no route for ${path}\n`); process.exit(1); }',
        'process.stdout.write(JSON.stringify(table[path]));',
      ].join('\n'), { mode: 0o755 });
      chmodSync(join(directory, 'gh'), 0o755);
      try {
        const stdout = execFileSync(process.execPath, [resolve(import.meta.dirname, 'julius-main-provenance.mjs'), REPO], {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` },
          stdio: 'pipe',
        });
        return { code: 0, stdout, stderr: '' };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { code: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it('reshapes GitHub\'s JSON into a proof and exits 0', () => {
    const result = runWithStub(routes());
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('provenance=provenant');
    expect(result.stdout).toContain(`main=${MAIN}`);
    expect(result.stdout).toContain('pr=226');
    expect(result.stdout).toContain(`approved_by=${APPROVER}`);
  }, 30_000);

  it('a pull request GitHub never merged is not a merge, however associated', () => {
    // `merged_at: null` is how the endpoint says "open". The reshaping turns
    // that into `merged: false`, and this is the case that proves it does.
    const result = runWithStub(routes({
      [`repos/${REPO}/commits/${MAIN}/pulls`]: [{
        number: 226, merged_at: null, merge_commit_sha: MAIN,
        user: { login: WORKER }, head: { sha: HEAD }, base: { ref: 'main' },
      }],
    }));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('provenance=unprovenanced');
    expect(result.stderr).toContain('no merged pull request records');
  }, 30_000);

  it('a retargeted base is refused end to end', () => {
    const result = runWithStub(routes({
      [`repos/${REPO}/issues/226/timeline`]: [{ event: 'base_ref_changed' }, { event: 'merged' }],
    }));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('was changed');
  }, 30_000);

  it('a candidate reviewed against another branch is refused end to end', () => {
    const result = runWithStub(routes({
      [`repos/${REPO}/commits/${MAIN}/pulls`]: [{
        number: 226, merged_at: '2026-09-06T00:41:33Z', merge_commit_sha: MAIN,
        user: { login: WORKER }, head: { sha: HEAD }, base: { ref: 'relay/worker-staging' },
      }],
    }));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('reviewed against relay/worker-staging');
  }, 30_000);

  it('a tree on main that is not the reviewed tree is refused end to end', () => {
    const result = runWithStub(routes({
      [`repos/${REPO}/commits/${HEAD}`]: { commit: { tree: { sha: OTHER_TREE } } },
    }));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is not the reviewed tree');
  }, 30_000);

  it('metadata it cannot read is an error, never a pass', () => {
    const { [`repos/${REPO}/commits/${MAIN}`]: _removed, ...withoutCommit } = routes();
    const result = runWithStub(withoutCommit as Record<string, unknown>);
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('provenant');
  }, 30_000);

  it('bad arguments are a usage error, not a silent pass', () => {
    const directory = mkdtempSync(join(tmpdir(), 'julius-provenance-args-'));
    try {
      let code = 0;
      try {
        execFileSync(process.execPath, [resolve(import.meta.dirname, 'julius-main-provenance.mjs'), 'not-a-repo'], { stdio: 'pipe' });
      } catch (error) { code = (error as { status?: number }).status ?? -1; }
      expect(code).toBe(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

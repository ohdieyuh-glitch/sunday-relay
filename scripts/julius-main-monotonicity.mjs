/**
 * MONOTONIC MAIN — has the live branch moved backward, or jumped somewhere else?
 *
 * The provenance gate proves that the commit currently on `main` was reviewed.
 * It deliberately cannot notice a RESET: a branch rewound to an older commit
 * that was itself approved answers `provenant`, correctly and uselessly, because
 * that older tree really was approved once. Distinguishing "moved forward" from
 * "moved back" needs something the branch itself cannot tell you — a record of
 * what was accepted before.
 *
 * WHERE THE RECORD LIVES, AND WHY THE WORKER CANNOT FORGE IT.
 *
 * Not in this repository. Every file here is writable by the coding worker
 * (`contents: write`), so a checkpoint committed as source is a checkpoint the
 * worker can rewrite in the same push that rolls the branch back. Tags are the
 * same authority and equally useless: creating `refs/tags/anything` was tried
 * with the worker's own credential and it succeeded.
 *
 * The record is an ACTIONS ARTIFACT, named `julius-accepted-main-<sha>`, which
 * is the store Julius already uses for paid-attempt markers rather than a second
 * state system invented for this. Three facts make it unforgeable by the worker,
 * each verified against the live API with the worker's own token:
 *
 *   - Artifacts are produced by a workflow RUN. There is no REST route that
 *     uploads one, so holding a token is not enough; something must run.
 *   - The worker cannot make anything run: `actions: read` refuses
 *     `workflow_dispatch` with HTTP 403.
 *   - The worker cannot remove one either: `DELETE /actions/artifacts/{id}`
 *     refuses with HTTP 403.
 *   - And it cannot edit the workflow that would do the running. GitHub refuses
 *     a push touching `.github/workflows/**` from an App without the
 *     `workflows` permission, which this one does not have — the refusal was
 *     observed while landing this very change, and it is why the writer arrives
 *     separately rather than in this commit.
 *
 * The accepted state therefore only ever advances through a workflow the
 * founder dispatched, and the worker can neither add a checkpoint that blesses
 * a rollback, nor delete the checkpoint that would expose one, nor rewrite the
 * rules of the run that records them.
 *
 * UNTIL THAT WRITER EXISTS this guard answers `uninitialized`, which blocks.
 * That is the correct reading: a rollback guard with no record of what was
 * accepted is not a guard, and it says so rather than passing.
 *
 * NO CLOCKS, AND NO "LATEST".
 *
 * Ordering accepted commits by time would make a timestamp the authority, and
 * picking "the newest checkpoint" would need exactly that. Instead the rule is
 * containment of ALL of them: the current commit must contain every accepted
 * commit. That is strictly stronger, it is a fact about the commit graph, and it
 * makes the ordering question disappear — a rollback fails because the newer
 * accepted commit is not contained in the older one it was rolled back to.
 *
 * FAIL CLOSED. `monotonic` is the only passing verdict. `uninitialized` means no
 * checkpoint exists at all, which blocks until a founder deliberately records
 * one. `regressed` is a definite backward or sideways move. `indeterminate` is
 * anything unreadable or moving.
 */

/**
 * The artifact-name prefix a checkpoint is recorded under. The commit is IN THE
 * NAME on purpose: listing artifacts then needs no download, no unzip and no
 * parsing of anything the reader had to fetch separately.
 */
export const ACCEPTED_MAIN_ARTIFACT_PREFIX = 'julius-accepted-main-';

/** The only verdicts. Anything not `monotonic` blocks. */
export const MONOTONICITY_VERDICTS = Object.freeze(['monotonic', 'regressed', 'uninitialized', 'indeterminate']);

const FULL_SHA = /^[0-9a-f]{40}$/u;
const isSha = (value) => typeof value === 'string' && FULL_SHA.test(value);

const verdict = (name, reason, extra = {}) => ({ verdict: name, reason, ...extra });

/**
 * Every accepted commit an artifact list records, ignoring expired rows.
 *
 * EXPIRY IS NOT AMNESTY, but it is honest: GitHub deletes artifact content after
 * its retention window, and an expired row can no longer be treated as a live
 * checkpoint. What this must never do is quietly become `uninitialized` and then
 * pass — and it cannot, because no checkpoints is itself a blocking verdict.
 *
 * @param {unknown} artifacts `/actions/artifacts` rows.
 * @returns {string[] | null} accepted commit shas, or null if the list is unreadable.
 */
export function acceptedShasFrom(artifacts) {
  if (!Array.isArray(artifacts)) return null;
  const shas = new Set();
  for (const artifact of artifacts) {
    if (artifact?.expired === true) continue;
    const name = artifact?.name;
    if (typeof name !== 'string' || !name.startsWith(ACCEPTED_MAIN_ARTIFACT_PREFIX)) continue;
    const sha = name.slice(ACCEPTED_MAIN_ARTIFACT_PREFIX.length);
    // A name that does not carry a full sha is not a checkpoint. It is not
    // ignored quietly either: an unreadable row makes the whole list unreadable,
    // because "we could not parse one of them" is not "there were none".
    if (!isSha(sha)) return null;
    shas.add(sha);
  }
  return [...shas];
}

/**
 * @param {object} input
 * @param {unknown} input.mainSha        The branch tip, read before the lookups.
 * @param {unknown} input.mainShaAfter   The branch tip, read again after.
 * @param {unknown} input.acceptedShas   Accepted checkpoints, from `acceptedShasFrom`.
 * @param {unknown} input.containment    { [acceptedSha]: true | false }, strictly.
 */
export function evaluateMainMonotonicity(input) {
  const mainSha = input?.mainSha;
  const mainShaAfter = input?.mainShaAfter;
  if (!isSha(mainSha)) return verdict('indeterminate', 'the branch tip could not be read as a full commit sha');
  if (!isSha(mainShaAfter)) return verdict('indeterminate', 'the branch tip could not be re-read to prove it held still');
  if (mainShaAfter !== mainSha) {
    return verdict('indeterminate', `the branch moved during the check: ${mainSha} then ${mainShaAfter}`);
  }

  const accepted = input?.acceptedShas;
  if (!Array.isArray(accepted) || !accepted.every(isSha)) {
    return verdict('indeterminate', 'the accepted-main checkpoints could not be read');
  }
  if (accepted.length === 0) {
    /**
     * NO CHECKPOINT IS NOT A PASS.
     *
     * A first run has nothing to compare against, and treating that as "fine so
     * far" would make the guard trivially defeatable: delete history, get a
     * clean slate. It blocks until a founder records a starting point on
     * purpose, which is what makes initialization a deliberate act rather than
     * a side effect of running.
     */
    return verdict('uninitialized',
      'no accepted-main checkpoint exists; a founder must record one before this branch can be trusted to have moved forward',
      { mainSha, acceptedShas: [] });
  }

  const containment = input?.containment;
  if (containment === null || typeof containment !== 'object' || Array.isArray(containment)) {
    return verdict('indeterminate', 'containment of the accepted checkpoints could not be read', { mainSha, acceptedShas: accepted });
  }

  const unproven = [];
  const missing = [];
  for (const sha of accepted) {
    const contained = containment[sha];
    // STRICTLY true/false. A missing or truthy-ish value is not proof of
    // ancestry, and guessing here would bless exactly the move this exists to
    // catch.
    if (contained === true) continue;
    if (contained === false) missing.push(sha);
    else unproven.push(sha);
  }

  if (unproven.length > 0) {
    return verdict('indeterminate',
      `containment of ${unproven.length} accepted checkpoint(s) could not be proven`,
      { mainSha, acceptedShas: accepted, unprovenShas: unproven });
  }
  if (missing.length > 0) {
    /**
     * THE ROLLBACK, AND THE HISTORY JUMP, ARE THE SAME FACT.
     *
     * Reset to an older accepted commit: the newer accepted commit is not
     * contained in it. Pushed an unrelated history: no accepted commit is
     * contained in it. Both are "the branch no longer builds on what was
     * accepted", which is the property worth naming, so they share a verdict
     * and are told apart by which checkpoints are missing.
     */
    return verdict('regressed',
      `${mainSha} does not contain ${missing.length} accepted checkpoint(s): ${missing.join(', ')}`,
      { mainSha, acceptedShas: accepted, missingShas: missing });
  }

  return verdict('monotonic',
    `${mainSha} contains every accepted checkpoint (${accepted.length})`,
    { mainSha, acceptedShas: accepted, missingShas: [] });
}

/* ------------------------------------------------------------------ CLI --- */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Usage: node scripts/julius-main-monotonicity.mjs <owner/repo> [branch]
 *
 * Reads the branch twice, around the checkpoint lookups, so a push landing while
 * the guard runs is caught rather than silently accepted.
 */
async function main(argv) {
  const [repo, branchArg] = argv;
  const branch = branchArg ?? 'main';
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(repo) || !/^[\w./-]+$/u.test(branch)) {
    process.stderr.write('usage: julius-main-monotonicity.mjs <owner/repo> [branch]\n');
    return 2;
  }
  const { execFileSync } = await import('node:child_process');
  const { collectPages } = await import('./julius-review-currency.mjs');
  const gh = (path) => {
    const raw = execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(raw);
  };
  const ref = encodeURIComponent(branch);

  let result;
  try {
    const mainSha = gh(`repos/${repo}/branches/${ref}`)?.commit?.sha;
    /**
     * Every page, because a checkpoint on page two is still a checkpoint. The
     * artifact list is paged by GitHub and holds every artifact this repository
     * has, not only the accepted-main ones.
     */
    const artifacts = collectPages((page, perPage) => {
      const body = gh(`repos/${repo}/actions/artifacts?per_page=${perPage}&page=${page}`);
      return Array.isArray(body?.artifacts) ? body.artifacts : null;
    });
    const acceptedShas = acceptedShasFrom(artifacts);

    const containment = {};
    for (const sha of acceptedShas ?? []) {
      try {
        const mergeBase = gh(`repos/${repo}/compare/${sha}...${mainSha}`)?.merge_base_commit?.sha;
        // Unreadable stays UNSET. "Not proven contained" and "proven not
        // contained" are different answers and only one of them is a fact.
        if (typeof mergeBase === 'string') containment[sha] = mergeBase === sha;
      } catch {
        // A comparison that errors — an unrelated history returns 404 — is not
        // a proof of containment, and is left unset rather than read as false.
      }
    }

    result = evaluateMainMonotonicity({
      mainSha,
      mainShaAfter: gh(`repos/${repo}/branches/${ref}`)?.commit?.sha,
      acceptedShas,
      containment,
    });
  } catch (error) {
    process.stderr.write(`main_monotonicity_indeterminate: ${error instanceof Error ? error.message : 'metadata unavailable'}\n`);
    return 1;
  }

  const line = `repo=${repo} branch=${branch} monotonicity=${result.verdict}`
    + ` main=${result.mainSha ?? 'unknown'}`
    + ` accepted=${(result.acceptedShas ?? []).length}`
    + ` missing=${(result.missingShas ?? []).length}`
    + ` reason=${result.reason}`;
  if (result.verdict === 'monotonic') {
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

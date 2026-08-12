import { runGit } from '../src/relay/workspace/repository-inspector';
import {
  checkoutMatchesIdentity,
  resolveBaselineSha,
} from '../src/relay/workspace/repository-target-observer';
import { sanitizeRemoteUrl, type EphemeralGitAuth } from './repository-credential';
import { fail, ok, relayError, type RelayResult } from '../src/relay/protocol/errors';

/**
 * THE REMOTE GIT TRANSPORT — clone, fetch and push over normal HTTPS.
 *
 * This is the code-transfer layer the ship path was missing: the observer reads
 * and the provider opens/merges pull requests, but nothing moved commits across
 * the network. Every command here is CONSTRUCTED, never a passthrough — the
 * caller supplies structured values (a URL, a branch, a SHA), never argv — so a
 * force-push, an arbitrary refspec or a second remote is not expressible. The
 * credential reaches git only through `auth.extraEnv` (an ASKPASS helper reading
 * the child environment); it is never in a URL, in `.git/config`, in argv, or in
 * any message this module returns.
 */

/** A ref name Relay will act on: no leading dash (so it cannot be read as an
 *  option), no whitespace, no `:` or `~^?*[\` — the shape git branch names take
 *  and nothing that could smuggle a second refspec. */
const SAFE_BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,200}$/;

function badBranch(branch: string): boolean {
  return !SAFE_BRANCH.test(branch) || branch.startsWith('-') || branch.includes('..');
}

const HEX = /^[0-9a-f]{7,64}$/;

/** The git runner, injectable so a test can assert the EXACT argv and env a
 *  command was built with — that no token is in argv, that redirects are off,
 *  that force is never passed — without a network. Defaults to the real one. */
export type GitRunner = typeof runGit;

/**
 * CLONE EXACTLY THE AUTHORIZED REPOSITORY, then prove it is that repository.
 *
 * REDIRECT SAFETY RESTS ON `http.followRedirects=false` ALONE: a renamed or
 * moved repository fails to clone rather than silently resolving to a different
 * one. `checkoutMatchesIdentity` is NOT a redirect backstop — git records
 * `remote.origin.url` as the URL Relay passed, not the location a redirect
 * resolved to, so a FOLLOWED redirect would still compare equal. The identity
 * check guards a different case (a wrong local checkout whose origin genuinely
 * names another repository); both are kept, but do not weaken the redirect flag
 * believing the identity check covers it.
 */
export function cloneAuthorizedRepository(input: {
  readonly cloneUrl: string;
  /** Absolute path git will create and clone into. */
  readonly destPath: string;
  /** Absolute existing directory to run the clone from. */
  readonly runFrom: string;
  readonly baseBranch: string;
  readonly identity: { readonly host: string | null; readonly owner: string | null; readonly name: string };
  readonly auth: EphemeralGitAuth;
}, run: GitRunner = runGit): RelayResult<{ readonly root: string; readonly baselineRevision: string }> {
  const clone = run(
    [
      ...input.auth.configArgs,
      '-c', 'http.followRedirects=false',
      'clone', '--no-tags', '--origin', 'origin', '--', input.cloneUrl, input.destPath,
    ],
    input.runFrom,
    input.auth.extraEnv,
  );
  if (!clone.ok) {
    // The message from git may name the URL; strip any userinfo before it travels.
    return fail(relayError('validation-failed',
      `Clone of ${sanitizeRemoteUrl(input.cloneUrl)} failed.`,
      { details: [sanitizeRemoteUrl(String((clone.error.details ?? [])[0] ?? clone.error.message))] }));
  }
  const agrees = checkoutMatchesIdentity({
    worktreePath: input.destPath,
    host: input.identity.host,
    owner: input.identity.owner,
    name: input.identity.name,
  });
  if (!agrees.ok) return fail(agrees.error);

  const base = resolveBaselineSha({ worktreePath: input.destPath, ref: input.baseBranch });
  if (!base.ok) return base;
  return ok({ root: input.destPath, baselineRevision: base.value });
}

/** Fetch one branch into an existing authed checkout. Used when a baseline must
 *  be refreshed before observation; the clone already brings the base branch, so
 *  this is the narrow top-up, never a full re-fetch. */
export function fetchAuthorizedBranch(input: {
  readonly worktreePath: string;
  readonly branch: string;
  readonly auth: EphemeralGitAuth;
}): RelayResult<null> {
  if (badBranch(input.branch)) {
    return fail(relayError('validation-failed', 'Refusing to fetch a branch name of a rejected shape.'));
  }
  const res = runGit(
    [...input.auth.configArgs, 'fetch', '--no-tags', 'origin', input.branch],
    input.worktreePath,
    input.auth.extraEnv,
  );
  if (!res.ok) return fail(relayError('validation-failed', 'Authenticated fetch failed.'));
  return ok(null);
}

export interface PushObservation {
  /** The commit Relay asked to land at the remote branch tip. */
  readonly requestedSha: string;
  /** The commit the remote branch ACTUALLY points to after the push, read back
   *  from the remote. Null if the remote reported no such ref. */
  readonly observedRemoteSha: string | null;
  /** True only when observed equals requested — the caller never assumes it. */
  readonly matchesExpected: boolean;
}

/**
 * PUSH ONLY THE AUTHORIZED FEATURE BRANCH, never with force, then READ THE
 * REMOTE BACK.
 *
 * The refspec is `branch:branch` for one validated branch — no `--force`, no
 * `--force-with-lease`, no `--delete`, no `--mirror`, no second refspec is
 * expressible. WHERE the branch may be pushed (never the base/protected branch)
 * is the domain's `refusePushTarget`, checked by the caller before this runs;
 * this refuses the mechanics of a force or a malformed ref. Success is not the
 * push command's own word: the remote ref is read with `ls-remote` and compared
 * to the exact commit Relay expected, and requested-vs-actual is reported
 * truthfully rather than assumed equal.
 */
export function pushAuthorizedBranch(input: {
  readonly worktreePath: string;
  readonly branch: string;
  readonly expectedSha: string;
  readonly auth: EphemeralGitAuth;
}, run: GitRunner = runGit): RelayResult<PushObservation> {
  if (badBranch(input.branch)) {
    return fail(relayError('validation-failed', 'Refusing to push a branch name of a rejected shape.'));
  }
  if (!HEX.test(input.expectedSha)) {
    return fail(relayError('validation-failed', 'Refusing to push without a concrete expected commit SHA.'));
  }
  const pushed = run(
    [...input.auth.configArgs, 'push', 'origin', `${input.branch}:${input.branch}`],
    input.worktreePath,
    input.auth.extraEnv,
  );
  if (!pushed.ok) {
    return fail(relayError('validation-failed', 'Authenticated push failed.',
      { details: [sanitizeRemoteUrl(String((pushed.error.details ?? [])[0] ?? pushed.error.message))] }));
  }
  // Read the remote ref back — the push command reporting success is not evidence.
  const ls = run(
    [...input.auth.configArgs, 'ls-remote', 'origin', `refs/heads/${input.branch}`],
    input.worktreePath,
    input.auth.extraEnv,
  );
  if (!ls.ok) {
    return fail(relayError('validation-failed', 'Push completed but the remote ref could not be read back.'));
  }
  const line = ls.value.split('\n').find((l) => l.trim() !== '');
  const observed = line ? (line.split(/\s+/)[0] ?? '').trim() : '';
  const observedRemoteSha = HEX.test(observed) ? observed : null;
  return ok({
    requestedSha: input.expectedSha,
    observedRemoteSha,
    matchesExpected: observedRemoteSha !== null && observedRemoteSha === input.expectedSha,
  });
}

import type { RepositoryPermission, RepositoryProblem } from './repository-contracts';

/**
 * THE REMOTE PROVIDER PORT — the operations that leave the machine.
 *
 * `REPOSITORY_TARGETS.md` has listed this as the first thing not built since the
 * feature existed: `push_feature_branch`, `create_pr` and `merge_pr` are
 * AUTHORIZED by the permission ladder and PERFORMED by nothing. The git write
 * surface's allow-list deliberately has no `push`, because a remote operation
 * needs a credential and the credential boundary says Relay performs those
 * itself, after the agent has exited, from code that is separately audited.
 *
 * This is that code's contract. It is a pure port: no Node, no network, no
 * clock. The GitHub implementation lives outside the domain and is wired by a
 * composition root, which is how the browser can read a push record it could
 * never have produced.
 *
 * FOUR THINGS THIS PORT CANNOT EXPRESS, and their absence is the enforcement:
 *
 *   1. **No force.** There is no `force` field on `PushRequest` and there must
 *      never be one. "Relay adds commits; it never rewrites them" is a property
 *      of the type, not a flag somebody remembered to leave false.
 *   2. **No branch deletion.** No method deletes a ref. A Mission that could
 *      delete its own branch could destroy the evidence a Reviewer read.
 *   3. **No repository creation.** Creating a repository is a founder action
 *      with a visibility decision attached, and the founder's rule is explicit:
 *      never silently create a public repository. A port that could create one
 *      would make that rule a code review away from being broken.
 *   4. **No arbitrary write.** There is no "call the API with this path". Every
 *      operation this port exposes is one Relay decided to support.
 */

export interface RemoteProviderDescriptor {
  readonly providerId: string;
  readonly displayName: string;
  /**
   * The env var the credential is read from, server-side. The NAME only — never
   * the value, no prefix, no length, no fingerprint. This descriptor travels
   * into Mission evidence and the UI.
   *
   * `null` means the provider does NOT read a named env var: it consumes the
   * TARGET's resolved credential — a short-lived GitHub App installation token
   * minted per operation through the credential seam. A null here is the
   * user-safe installation path, not "no credential"; the credential is resolved
   * from the target, not from a founder-named variable.
   */
  readonly credentialEnvVarName: string | null;
  /** What this implementation can actually do today. Registered is not the same
   *  as drivable, the same distinction role slots and providers already draw. */
  readonly supports: readonly RepositoryPermission[];
}

export interface PushRequest {
  readonly repositoryKey: string;
  readonly owner: string;
  readonly repo: string;
  /** The branch to push. NEVER the base branch — refused by `refusePushTarget`. */
  readonly branch: string;
  /** The commit expected at the tip after the push, so the result can be checked
   *  against what Relay actually committed rather than trusted. */
  readonly expectedHeadSha: string;
}

/**
 * WHAT THE REMOTE REPORTED, never what Relay asked for.
 *
 * `observedHeadSha` is nullable because a provider that cannot report the tip
 * must say so. It is never defaulted from `expectedHeadSha` — that would make
 * every push appear to have landed the right commit, which is the check
 * `pushLanded` exists to perform.
 */
export interface PushObservation {
  readonly ok: boolean;
  readonly providerId: string;
  readonly branch: string | null;
  readonly observedHeadSha: string | null;
  readonly observedAt: string;
  /** Safe. Never a credential, never a raw provider body. */
  readonly detail: string | null;
}

export interface PullRequestObservation {
  readonly ok: boolean;
  readonly providerId: string;
  /** The provider's own number/id. Null when it did not say. */
  readonly reference: string | null;
  readonly url: string | null;
  /** `open`, `merged`, `closed` — as the provider reported it. Null if unknown. */
  readonly state: 'open' | 'merged' | 'closed' | null;
  readonly observedAt: string;
  readonly detail: string | null;
}

export interface RemoteRepositoryProvider {
  readonly descriptor: RemoteProviderDescriptor;
  push(request: PushRequest): Promise<PushObservation>;
  openPullRequest(request: {
    readonly owner: string;
    readonly repo: string;
    readonly head: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
  }): Promise<PullRequestObservation>;
  /**
   * Merge an ALREADY-OPEN pull request. The reference is required: there is no
   * "merge the branch" operation, because a merge without a pull request is a
   * push to the protected base branch under a different word.
   */
  mergePullRequest(request: {
    readonly owner: string;
    readonly repo: string;
    readonly reference: string;
  }): Promise<PullRequestObservation>;
}

/**
 * MAY THIS BRANCH BE PUSHED?
 *
 * Refused for the base branch and for every protected branch, by name, before a
 * provider is called. The permission ladder already gates WHETHER a Mission may
 * push; this gates WHERE, and they are different questions — a Mission can hold
 * `push_feature_branch` legitimately and still have no business pushing `main`.
 */
export function refusePushTarget(input: {
  readonly branch: string;
  readonly baseBranch: string;
  readonly protectedBranches: readonly string[];
}): RepositoryProblem | null {
  if (input.branch === input.baseBranch) {
    return {
      refusal: 'protected_branch_target',
      message: `Relay does not push to the base branch ("${input.baseBranch}"). Work lands on a working branch and merges through a pull request.`,
    };
  }
  if (input.protectedBranches.includes(input.branch)) {
    return {
      refusal: 'protected_branch_target',
      message: `"${input.branch}" is a protected branch and Relay does not push to it.`,
    };
  }
  return null;
}

/**
 * DID THE PUSH ACTUALLY LAND THE COMMIT RELAY COMMITTED?
 *
 * The same shape as `decideShipped`: a provider reporting success is the
 * provider's account of itself. An unreported tip is NOT a match — it is
 * unknown, and unknown is not agreement.
 */
export function pushLanded(input: {
  readonly expectedHeadSha: string;
  readonly observation: PushObservation;
}): { readonly landed: boolean; readonly reason: string } {
  const { expectedHeadSha, observation } = input;
  if (!observation.ok) return { landed: false, reason: 'The provider reported the push did not succeed.' };
  if (observation.observedHeadSha === null) {
    return {
      landed: false,
      reason: 'The provider did not report the branch tip, so the push is recorded and the landing is not.',
    };
  }
  if (observation.observedHeadSha !== expectedHeadSha) {
    return {
      landed: false,
      reason: `The remote branch tip is ${observation.observedHeadSha}, not the ${expectedHeadSha} Relay committed.`,
    };
  }
  return { landed: true, reason: `The remote branch tip is the committed ${expectedHeadSha}.` };
}

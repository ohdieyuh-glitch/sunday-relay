/**
 * Type declarations for the dependency-light reviewed-main provenance gate.
 *
 * Authored as plain `.mjs` on purpose: the npm script runs it with `node` and
 * no build step, and the TypeScript tests import the SAME function, so there is
 * exactly one implementation of the rule.
 */

/** Identities that may never attest. Re-exported so a consumer needs one import. */
export declare const NON_ATTESTING_IDENTITIES: readonly string[];
/** Every identity whose review signal is read at all. */
export declare const REVIEW_AUTHORITY_LOGINS: readonly string[];
/** Who may have authored a landed candidate: the same set that may never attest. */
export declare const WORKER_AUTHOR_LOGINS: readonly string[];
export declare const PROVENANCE_VERDICTS: readonly ['provenant', 'unprovenanced', 'indeterminate'];

export interface MainProvenanceResult {
  readonly verdict: 'provenant' | 'unprovenanced' | 'indeterminate';
  readonly reason: string;
  readonly mainSha?: string;
  readonly mainTreeSha?: string;
  /** The commit the squash landed on. */
  readonly parentSha?: string;
  readonly prNumber?: number;
  readonly reviewedHeadSha?: string;
  readonly approvedBy?: readonly string[];
  /** The review-currency verdict, present only when approval is why this failed. */
  readonly reviewCurrency?: 'stale' | 'blocked' | 'indeterminate';
}

/**
 * One pull request, RESHAPED from what `/commits/{sha}/pulls` returns: that
 * endpoint has `merged_at`, `user.login`, `head.sha` and `base.ref`, and the CLI
 * translates them into the fields below before the rule sees them.
 */
export interface AssociatedPullRequest {
  readonly number?: unknown;
  readonly merged?: unknown;
  readonly mergeCommitSha?: unknown;
  readonly authorLogin?: unknown;
  readonly headSha?: unknown;
  /** The branch the review was rendered against. */
  readonly baseRef?: unknown;
}

export declare function evaluateMainProvenance(input: {
  readonly mainSha: unknown;
  readonly mainShaAfter: unknown;
  readonly mainTreeSha: unknown;
  readonly mainParents: unknown;
  readonly pullRequests: unknown;
  readonly reviewedTreeSha: unknown;
  readonly reviewedHeadShaAfter: unknown;
  readonly reviews: unknown;
  readonly reviewComments: unknown;
  readonly statuses?: unknown;
  /** Strictly true/false. Anything else is unproven, not permission. */
  readonly parentContainedInReviewedHead: unknown;
  /** Strictly false. Whether the pull request was ever retargeted to another base. */
  readonly baseRefChanged: unknown;
  /** The branch under verification. Defaults to `main`. */
  readonly branch?: unknown;
}): MainProvenanceResult;

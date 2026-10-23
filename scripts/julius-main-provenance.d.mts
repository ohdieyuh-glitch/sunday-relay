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
  /** `signed-landing` for a landing-block tip. `worker-clearance` for a worker-PR squash cleared by a signed JULIUS-WORKER-SQUASH-V1. */
  readonly via?: 'signed-landing' | 'worker-clearance';
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
  /** The tip's commit message. A signed landing carries one JULIUS LANDING block; absent (undefined) leaves the founder-approval path alone. */
  readonly mainCommitMessage?: unknown;
  readonly repo?: unknown;
  /** The reviewer public key COMMITTED at the tip's single parent. */
  readonly reviewerKeyPem?: unknown;
  /** The commit that key was read at: must be the parent. */
  readonly reviewerKeyAtSha?: unknown;
  /** The same key file read AT THE TIP: must be byte-identical to the parent's. */
  readonly tipReviewerKeyPem?: unknown;
  /** Every path (and previous path) the signed tip changes against its parent. */
  readonly changedPaths?: unknown;
  /** Strictly true when changedPaths is complete. */
  readonly changedPathsComplete?: unknown;
  /** `{ sha, authorLogin, treeSha }` of the commit the signed clearance names as head. */
  readonly headCommit?: unknown;
  /** Merge-gate evaluation clock for a worker-PR squash clearance. */
  readonly now?: unknown;
  /** Issue comments at evaluation, for the worker-squash bot-comments digest. */
  readonly issueComments?: unknown;
  /**
   * External fingerprint of the pinned reviewer key (`JULIUS_REVIEWER_KEY_SHA256`).
   * Present-and-wrong fails closed. Omitted reads the process environment.
   */
  readonly externalReviewerKeySha256?: unknown;
  /**
   * Signed JULIUS-WORKER-SQUASH-V1 offers for a worker-PR squash.
   * Absent leaves the founder-approval path unchanged. Present and invalid fails closed.
   * Accepted only when review currency is `stale` and the pull request was opened by the coding worker,
   * and only when the key read at the parent is the pinned reviewer key.
   */
  readonly workerClearance?: unknown;
}): MainProvenanceResult;

/** Header of a worker-PR squash approval. Not a landing clearance. */
export declare const WORKER_SQUASH_HEADER: 'JULIUS-WORKER-SQUASH-V1';

export declare const LANDING_BEGIN: string;
export declare const LANDING_END: string;

export type LandingBlock =
  | { readonly state: 'absent' }
  | { readonly state: 'invalid'; readonly reason: string }
  | { readonly state: 'ok'; readonly nonce: string; readonly clearanceB64: string; readonly signatureB64: string };

export declare function extractLandingBlock(message: unknown): LandingBlock;
export declare function parseSignedClearance(text: string, queriedRepo?: string): { readonly problems: string[]; readonly fields: Record<string, string> };
export declare function parseWorkerSquashClearance(text: string, queriedRepo?: string): { readonly problems: string[]; readonly fields: Record<string, string> };
export declare function workerSquashCommentsDigest(input: { readonly issueComments: readonly unknown[]; readonly inlineComments: readonly unknown[]; readonly reviews: readonly unknown[] }): string;
export declare function evaluateSignedLanding(input: Record<string, unknown>, tip: { readonly mainSha: string; readonly mainTreeSha: unknown; readonly parentSha: string }):
  | { readonly state: 'absent' }
  | { readonly state: 'decided'; readonly result: MainProvenanceResult };

export declare function readReviewerKey(pem: unknown): { readonly key: unknown; readonly problem?: undefined } | { readonly problem: string; readonly key?: undefined };

/** Reviewer-tools `CLEARANCE_B64` / `SIGNATURE_B64` pairs found in one comment or pull-request body. */
export declare function extractClearanceOffers(text: unknown): readonly { readonly text: string | undefined; readonly signatureB64: string | undefined }[];
export declare const SIGNED_LANDING_GOVERNED: { readonly HARD_FORBIDDEN: RegExp; readonly EXCEPTION_ELIGIBLE: readonly string[] };

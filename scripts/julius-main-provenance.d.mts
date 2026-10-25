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
/** GitHub App id of the coding worker. Not a bot user id and not an email. */
export declare const WORKER_APP_ID: 4838349;
/**
 * Authenticated sources that may establish the cleared head's author.
 * Git author name, email, and the email-derived `commit.author.login` are not in this list.
 */
export declare const AUTHENTICATED_COMMIT_SOURCES: readonly ['pull-opener', 'app-installation', 'verified-signature'];
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
  /** `signed-landing` when the verdict came from the reviewer's signature rather than a founder approval. */
  readonly via?: 'signed-landing';
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
  /** The pull request head branch. A governed audit branch is refused. */
  readonly headRef?: unknown;
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
  /**
   * The commit the signed clearance names as head.
   * `authenticatedAuthor` (`{ login, source, accountType, appId?, signatureVerified? }`) is the only author identity.
   * `emailDerivedLogin`, `gitAuthorName`, `gitAuthorEmail` and a legacy `authorLogin` are untrusted and cannot authorize.
   */
  readonly headCommit?: unknown;
  /** H1: the founder-approval key file read at the parent, and its anchor (else JULIUS_FOUNDER_APPROVAL_KEY_SHA256). */
  readonly founderKeyPem?: unknown;
  readonly externalFounderKeySha256?: unknown;
  /**
   * External fingerprint of the pinned reviewer key (`JULIUS_REVIEWER_KEY_SHA256`).
   * Present-and-wrong fails closed. Omitted reads the process environment.
   */
  readonly externalReviewerKeySha256?: unknown;
}): MainProvenanceResult;

export declare const LANDING_BEGIN: string;
export declare const LANDING_END: string;

export type LandingBlock =
  | { readonly state: 'absent' }
  | { readonly state: 'invalid'; readonly reason: string }
  | { readonly state: 'ok'; readonly nonce: string; readonly clearanceB64: string; readonly signatureB64: string };

export declare function pagedCommitFiles(fetchPage: (page: number, perPage: number) => { files?: unknown } | undefined, options?: { perPage?: number }): Array<{ filename?: string; previous_filename?: string }>;
export declare function readFirstParentChain(gh: (path: string) => unknown, repo: string, tipSha: string, floorSha?: string): Array<Record<string, unknown>> | null;
export declare function extractLandingBlock(message: unknown): LandingBlock;
export declare function parseSignedClearance(text: string, queriedRepo?: string): { readonly problems: string[]; readonly fields: Record<string, string> };
export declare function evaluateSignedLanding(input: Record<string, unknown>, tip: { readonly mainSha: string; readonly mainTreeSha: unknown; readonly parentSha: string }):
  | { readonly state: 'absent' }
  | { readonly state: 'decided'; readonly result: MainProvenanceResult };

export declare function readReviewerKey(pem: unknown): { readonly key: unknown; readonly problem?: undefined } | { readonly problem: string; readonly key?: undefined };
export declare const SIGNED_LANDING_GOVERNED: { readonly HARD_FORBIDDEN: RegExp; readonly EXCEPTION_ELIGIBLE: readonly string[] };

/**
 * Type declarations for the dependency-free review-currency gate.
 *
 * Authored as plain `.mjs` on purpose: the npm script runs it with `node` and
 * no build step, and the TypeScript tests import the SAME function, so there is
 * exactly one implementation of the exact-head rule.
 */

/** Identities that may never attest, checked before any allowlist. The coding worker. */
export declare const NON_ATTESTING_IDENTITIES: readonly string[];
/** The account outside this coding environment. Its `APPROVED` review approves a head; it may also block one. */
export declare const EXTERNAL_APPROVER_LOGINS: readonly string[];
/** Every identity whose signal is read at all. One authority: it approves and it blocks. */
export declare const REVIEW_AUTHORITY_LOGINS: readonly string[];
export declare const BASE_INTEGRATION_VERDICTS: readonly ['integrated', 'behind', 'indeterminate'];
/** The commit-status context an authorized reviewer publishes a clean head under. */
export declare const REVIEW_ATTESTATION_CONTEXT: string;
export declare const REVIEW_CURRENCY_VERDICTS: readonly ['current', 'stale', 'blocked', 'indeterminate'];

export interface ReviewCurrencyResult {
  readonly verdict: 'current' | 'stale' | 'blocked' | 'indeterminate';
  readonly reason: string;
  readonly reviewedSha?: string;
  readonly reviewedShas?: readonly string[];
  readonly blockingCount?: number;
  /** Who approved this exact head. Absent unless the verdict is `current`. */
  readonly approvedBy?: readonly string[];
  readonly attested?: boolean;
}

/** Review currency and base integration are DISTINCT facts, reported separately. */
export interface MergeEligibilityResult {
  readonly reviewCurrency: ReviewCurrencyResult;
  readonly baseIntegration: 'integrated' | 'behind' | 'indeterminate';
  readonly baseReason: string;
  readonly mergeEligible: boolean;
  readonly reason: string;
}

/**
 * Walk every page of a list endpoint. Throws rather than truncating: a short
 * page ends the walk, a page that is not a list is an error, and a walk that
 * will not finish within `maxPages` is an error.
 */
export declare function collectPages(
  fetchPage: (page: number, perPage: number) => unknown,
  options?: { readonly perPage?: number; readonly maxPages?: number },
): unknown[];

export declare function evaluateReviewCurrency(input: {
  readonly headSha: unknown;
  readonly headShaAfter: unknown;
  readonly reviews: unknown;
  readonly reviewComments: unknown;
  readonly statuses?: unknown;
  readonly pullAuthorLogin?: unknown;
  readonly reviewerLogins?: readonly string[];
}): ReviewCurrencyResult;

export declare function evaluateMergeEligibility(input: {
  readonly headSha: unknown;
  readonly headShaAfter: unknown;
  readonly reviews: unknown;
  readonly reviewComments: unknown;
  readonly statuses?: unknown;
  readonly pullAuthorLogin?: unknown;
  readonly reviewerLogins?: readonly string[];
  readonly baseSha?: unknown;
  /** The base, re-read after the metadata lookup. A base that moved is not reviewable. */
  readonly baseShaAfter?: unknown;
  /** Strictly true/false. Anything else is unproven, not permission. */
  readonly baseContainedInHead?: unknown;
}): MergeEligibilityResult;

/**
 * Type declarations for the dependency-free review-currency gate.
 *
 * Authored as plain `.mjs` on purpose: the npm script runs it with `node` and
 * no build step, and the TypeScript tests import the SAME function, so there is
 * exactly one implementation of the exact-head rule.
 */
export declare const INDEPENDENT_REVIEWER_LOGINS: readonly string[];
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
  /** Strictly true/false. Anything else is unproven, not permission. */
  readonly baseContainedInHead?: unknown;
}): MergeEligibilityResult;

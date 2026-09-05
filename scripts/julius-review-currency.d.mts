/**
 * Type declarations for the dependency-free review-currency gate.
 *
 * Authored as plain `.mjs` on purpose: the npm script runs it with `node` and
 * no build step, and the TypeScript tests import the SAME function, so there is
 * exactly one implementation of the exact-head rule.
 */
export declare const INDEPENDENT_REVIEWER_LOGINS: readonly string[];
export declare const REVIEW_CURRENCY_VERDICTS: readonly ['current', 'stale', 'blocked', 'indeterminate'];

export interface ReviewCurrencyResult {
  readonly verdict: 'current' | 'stale' | 'blocked' | 'indeterminate';
  readonly reason: string;
  readonly reviewedSha?: string;
  readonly reviewedShas?: readonly string[];
  readonly blockingCount?: number;
}

export declare function evaluateReviewCurrency(input: {
  readonly headSha: unknown;
  readonly headShaAfter: unknown;
  readonly reviews: unknown;
  readonly reviewComments: unknown;
  readonly pullAuthorLogin?: unknown;
  readonly reviewerLogins?: readonly string[];
}): ReviewCurrencyResult;

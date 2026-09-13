/**
 * Type declarations for the paid reviewer's isolation policy.
 *
 * Authored as plain `.mjs` on purpose: `.github/julius-live-hermes.sh` runs it
 * with `node` before anything is built, and the TypeScript tests import the
 * SAME functions, so there is exactly one rendering of the profile and one
 * judgement of the proof.
 */

export declare const REVIEWER_ISOLATION_POLICY_VERSION: string;
export declare const REVIEWER_DISABLED_TOOLSETS: readonly string[];
export declare const REVIEWER_API_ATTEMPTS: number;
export declare const LINUX_MAX_ARG_STRLEN: number;
export declare const REVIEWER_ISOLATION_RECORD_FIELDS: readonly string[];

export declare function reviewerProfileConfigYaml(input: {
  readonly provider: string;
  readonly requestTimeoutSeconds: number | string;
}): string;

export interface ReviewerIsolationExpectation {
  readonly provider: string;
  readonly model: string;
  readonly requestTimeoutSeconds: number | string;
  /** The proof prompt file's size, which must be at least LINUX_MAX_ARG_STRLEN. */
  readonly promptBytes: number | string;
}

export type ReviewerIsolationVerdict =
  | { readonly ok: true; readonly evidence: string }
  | { readonly ok: false; readonly reason: string };

export declare function verifyReviewerIsolation(
  record: unknown,
  expected: ReviewerIsolationExpectation,
  sideRecords?: readonly unknown[],
): ReviewerIsolationVerdict;

export declare function readIsolationRecords(recordPath: string): {
  readonly record: unknown;
  readonly sideRecords: readonly unknown[];
};

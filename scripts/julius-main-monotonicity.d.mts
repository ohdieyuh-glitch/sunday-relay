/**
 * Type declarations for the dependency-light monotonic-main guard.
 *
 * Authored as plain `.mjs` on purpose: the npm script runs it with `node` and
 * no build step, and the TypeScript tests import the SAME functions, so there
 * is exactly one implementation of the rule.
 */

/** The artifact-name prefix an accepted-main checkpoint is recorded under. */
export declare const ACCEPTED_MAIN_ARTIFACT_PREFIX: string;
export declare const MONOTONICITY_VERDICTS: readonly ['monotonic', 'regressed', 'uninitialized', 'indeterminate'];

export interface MainMonotonicityResult {
  readonly verdict: 'monotonic' | 'regressed' | 'uninitialized' | 'indeterminate';
  readonly reason: string;
  readonly mainSha?: string;
  /** Every non-expired checkpoint found. */
  readonly acceptedShas?: readonly string[];
  /** Checkpoints proven NOT contained in the current tip. */
  readonly missingShas?: readonly string[];
  /** Checkpoints whose containment could not be established either way. */
  readonly unprovenShas?: readonly string[];
}

/**
 * Accepted commits recorded by an artifact list. Returns null when the list is
 * unreadable or carries a checkpoint name that is not a full commit sha —
 * "one row could not be parsed" is not "there were none".
 */
export declare function acceptedShasFrom(artifacts: unknown): string[] | null;

export declare function evaluateMainMonotonicity(input: {
  readonly mainSha: unknown;
  readonly mainShaAfter: unknown;
  readonly acceptedShas: unknown;
  /** Strictly true/false per accepted sha. Anything else is unproven, not permission. */
  readonly containment: unknown;
}): MainMonotonicityResult;

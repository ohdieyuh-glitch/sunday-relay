/**
 * Type declarations for the Wonderland Beta Gate.
 *
 * Authored as plain `.mjs` on purpose: an operator runs it with `node` and no
 * build step, and the TypeScript tests import the SAME function, so there is
 * exactly one implementation of the verdict rule.
 */

/** The only three answers. There is deliberately no fourth. */
export type BetaVerdict = 'PASS' | 'FAIL' | 'NOT BUILT';

export interface BetaCapabilityResult {
  readonly id: string;
  /** True when the capability sits on the creation path to VERIFIED COMPLETION. */
  readonly path: boolean;
  readonly verdict: BetaVerdict;
  /** The evidence the verdict was read from, never a summary of intent. */
  readonly basis: string;
}

export interface BetaGateReport {
  /** The evidence bundle actually read, or null when none was supplied or found. */
  readonly evidence: string | null;
  readonly evidenceNote: string | null;
  readonly results: readonly BetaCapabilityResult[];
  /** At most three, creation-path capabilities first, in declared order. */
  readonly gaps: readonly BetaCapabilityResult[];
}

/**
 * Evaluate every capability against the repository and, when supplied, one live
 * mission evidence bundle. Passing `null` is the no-evidence case, in which no
 * runtime capability can reach PASS.
 */
export declare function evaluate(evidenceDir: string | null): BetaGateReport;

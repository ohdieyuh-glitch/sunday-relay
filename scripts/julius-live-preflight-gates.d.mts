/**
 * Type declarations for the live-preflight trust gate.
 *
 * Authored as plain `.mjs` on purpose: the workflow runs it with `node` and no
 * build step, and the TypeScript tests import the SAME functions, so there is
 * exactly one implementation of the rule.
 */

export declare const LIVE_PREFLIGHT_VERDICTS: readonly ['pass', 'blocked', 'indeterminate'];
/** The branch a live mission may run from. */
export declare const LIVE_BRANCH: string;
/** The only ref that names it. Compared whole, never as a suffix. */
export declare const LIVE_REF: string;

export interface LivePreflightResult {
  readonly verdict: 'pass' | 'blocked' | 'indeterminate';
  readonly reason: string;
  /** `main` as read once at the start, and held for the whole preflight. */
  readonly frozenMainSha?: string;
  /** The commit this job is executing. */
  readonly workflowSha?: string;
  readonly ref?: string | null;
  /** Present only on a pass. */
  readonly provenance?: 'provenant';
  /** Present only on a pass. */
  readonly monotonicity?: 'monotonic';
  /** Accepted checkpoints the monotonicity gate counted, or null if it did not say. */
  readonly acceptedCheckpoints?: number | null;
  /** `main` re-read after both gates. Present only on a pass or a moving-branch verdict. */
  readonly finalMainSha?: string;
}

/** One gate's report, as this helper requires it: its answer AND what it said. */
export interface GateReport {
  readonly exitCode?: unknown;
  readonly verdict?: unknown;
  /** The commit the gate evaluated. Bound to the frozen sha, never assumed. */
  readonly mainSha?: unknown;
  readonly accepted?: unknown;
  readonly reason?: unknown;
}

export declare function evaluateLivePreflight(input: {
  readonly repository?: unknown;
  readonly branch?: unknown;
  readonly ref: unknown;
  readonly workflowSha: unknown;
  readonly frozenMainSha: unknown;
  readonly provenance: unknown;
  readonly monotonicity: unknown;
  readonly finalMainSha: unknown;
}): LivePreflightResult;

/**
 * Read one `key=value ... reason=<free text>` line, as both gates emit. Returns
 * null when the requested verdict key is absent — an unparseable gate is not a
 * gate that passed.
 */
export declare function parseGateLine(
  text: unknown,
  verdictKey: string,
): { verdict: string; mainSha?: string; accepted?: number; reason: string } | null;

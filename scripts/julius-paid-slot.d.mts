/**
 * Type declarations for the paid provider slot.
 *
 * Authored as plain `.mjs` on purpose: the `paid-slot` workflow job runs it with
 * `node` and no build step, and the TypeScript tests import the SAME functions,
 * so there is exactly one implementation of the admission rule.
 */

export declare const PAID_LANES: readonly ['qualification', 'qualification-repair', 'lab', 'regression'];
export type PaidLane = (typeof PAID_LANES)[number];
export declare const PAID_SLOT_JOB_NAME: string;
export declare const PAID_JOB_NAME: string;
export declare const PAID_WORKFLOW_FILE: string;
export declare const DISPATCH_KEY_PATTERN: RegExp;
export declare const NO_DISPATCH_KEY: string;
export declare const UNSPECIFIED_LANE: string;

export interface ParsedRunTitle {
  readonly mission: string;
  readonly lane: string;
  readonly mode: 'paid' | 'preflight';
  readonly key: string | null;
}
export declare function parseRunTitle(title: unknown): ParsedRunTitle | null;
export declare function laneRank(lane: unknown): number;

export interface PaidSlotJob { readonly status: string; readonly conclusion: string | null }
export interface PaidRunListing {
  readonly id: number;
  readonly createdAt: string;
  readonly status: string;
  readonly title: string;
  readonly slotJob: PaidSlotJob | null;
  readonly [field: string]: unknown;
}

export type PaidSlotDecision =
  | { readonly decision: 'PROCEED' }
  | { readonly decision: 'WAIT'; readonly holder: number | null; readonly ahead: readonly number[]; readonly reason: string; readonly queue?: readonly number[] }
  | { readonly decision: 'REFUSE_DUPLICATE'; readonly original: number }
  | { readonly decision: 'REFUSE_UNKEYED' };

export declare function decidePaidSlot(input: { readonly self: unknown; readonly runs: unknown }): PaidSlotDecision;

export declare const PAID_RUN_STATES: readonly ['IDLE', 'QUALIFICATION_ACTIVE', 'LAB_ACTIVE', 'QUEUED', 'PREFLIGHT_BLOCKED', 'PROVIDER_BLOCKED'];
export declare function classifyProviderFailure(logText: unknown): string | null;

export interface LastCompletedPaidRun {
  readonly id: number;
  readonly conclusion: string | null;
  readonly failedStep: string | null;
  readonly logsRead: boolean;
  readonly providerClass: string | null;
}
export interface DerivedPaidRunState {
  readonly state: (typeof PAID_RUN_STATES)[number];
  readonly holder: number | null;
  readonly holderLane: string | null;
  readonly queue: readonly number[];
  readonly lastResult: string | null;
  readonly lastLiveFailure: string | null;
}
export declare function derivePaidRunState(input: { readonly runs: readonly unknown[]; readonly lastCompleted: LastCompletedPaidRun | null }): DerivedPaidRunState;

export declare function pinnedModelsFrom(workflowText: unknown): {
  readonly architect: string | null;
  readonly coder: string | null;
  readonly reviewerProvider: string | null;
  readonly reviewerModel: string | null;
};

export declare function waitForPaidSlot(input: {
  readonly readState: () => Promise<{ readonly self: unknown; readonly runs: unknown }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly maxWaitMs?: number;
  readonly pollMs?: number;
  readonly confirmGapMs?: number;
  readonly maxBackoffMs?: number;
}): Promise<0 | 3 | 4>;

export declare class GitHubApiError extends Error {
  constructor(code: string);
  readonly code: string;
}

/** Null for a first attempt ("1"); a refusal reason for a re-run or an unknown attempt (audit F4). */
export declare function paidRunAttemptRefusal(attempt: string | undefined): 'paid_slot_rerun_refused' | 'paid_slot_run_attempt_unknown' | null;

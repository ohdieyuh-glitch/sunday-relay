/**
 * Type declarations for the paid-run dispatch client.
 *
 * Plain `.mjs` so a session runs it with `node` and no build step; the tests
 * import the same functions.
 */

export declare const CONFIRM_LIVE_PHRASE: string;
/** How many paid runs may be ahead when a paid run joins the queue: the admission wait fits one whole paid job. */
export declare const MAX_PAID_RUNS_AHEAD: number;
export declare const HOLD_POLL_MS: number;
export declare const MAX_HOLD_MS: number;

export interface DispatchRun {
  readonly id: number;
  readonly status: string;
  readonly conclusion: string | null;
  readonly title: string;
  readonly headSha: string | null;
  readonly [field: string]: unknown;
}

export declare function dispatchKey(input: {
  readonly mission: string;
  readonly mainSha: string;
  readonly lane: string;
  readonly attempt: number;
  readonly paid: boolean;
}): string;

export declare function runsWithKey(runs: readonly DispatchRun[], key: string): DispatchRun[];
export declare function keyState(runs: readonly DispatchRun[], key: string): { readonly state: 'NONE' | 'IN_FLIGHT' | 'CONSUMED'; readonly run: DispatchRun | null };
export declare function latestPreflight(runs: readonly DispatchRun[], input: { readonly mission: string; readonly mainSha: string }): DispatchRun | null;
export declare function dispatchArgs(input: {
  readonly mission: string;
  readonly lane: string;
  readonly key: string;
  readonly paid: boolean;
  readonly acknowledgeRerun?: boolean;
  readonly maxTicks?: string;
  readonly hermesRef?: string;
}): string[];

/** A run of the paid queue with its `paid-slot` job, the shape the admission job classifies. */
export interface QueueRun {
  readonly id: number;
  readonly createdAt: string | null;
  readonly status: string;
  readonly title: string;
  readonly slotJob: { readonly status: string; readonly conclusion: string | null } | null;
}

/** The paid runs a new dispatch in `lane` would queue behind. */
export declare function paidRunsAhead(runs: readonly QueueRun[], lane: string): { readonly ahead: number; readonly holders: number[]; readonly waiting: number[] };

export interface DispatchGitHub {
  mainSha(): string;
  acceptedCheckpoints(sha: string): number;
  runs(): DispatchRun[];
  queueRuns(nowMs?: number): QueueRun[];
  run(id: number): DispatchRun;
  dispatch(args: readonly string[]): boolean;
}
export declare function createGitHub(input: { readonly gh: (args: readonly string[]) => { code: number; stdout: string }; readonly repo: string }): DispatchGitHub;

export interface DispatchResult {
  readonly outcome: 'DISPATCHED' | 'ALREADY_IN_FLIGHT' | 'REFUSED' | 'PLAN';
  readonly reason?: string;
  readonly run?: DispatchRun | null;
  readonly [field: string]: unknown;
}

export declare function dispatchOnce(input: {
  readonly github: DispatchGitHub;
  readonly key: string;
  readonly args: readonly string[];
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly reconcileMs?: number;
  readonly pollMs?: number;
  readonly maxDispatches?: number;
}): Promise<DispatchResult>;

/** Hold a paid dispatch until at most `MAX_PAID_RUNS_AHEAD` runs are ahead; null means proceed. */
export declare function holdForQueue(input: {
  readonly github: DispatchGitHub;
  readonly lane: string;
  readonly mainSha: string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly pollMs?: number;
  readonly maxHoldMs?: number;
}): Promise<DispatchResult | null>;

export declare function runPaidDispatch(
  options: {
    readonly mission: string;
    readonly lane: string;
    readonly attempt?: number;
    readonly paid?: boolean;
    readonly acknowledgeRerun?: boolean;
    readonly maxTicks?: string;
    readonly hermesRef?: string;
    readonly dryPlan?: boolean;
    readonly holdPollMs?: number;
    readonly maxHoldMs?: number;
  },
  deps: {
    readonly github: unknown;
    readonly checkContract: (input: { mission: string; lane: string; mainSha: string }) => { ok: boolean; detail?: string };
    readonly sleep: (ms: number) => Promise<void>;
    readonly log: (line: string) => void;
  },
): Promise<DispatchResult>;

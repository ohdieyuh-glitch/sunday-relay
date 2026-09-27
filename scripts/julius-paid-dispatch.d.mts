/**
 * Type declarations for the paid-run dispatch client.
 *
 * Plain `.mjs` so a session runs it with `node` and no build step; the tests
 * import the same functions.
 */

export declare const CONFIRM_LIVE_PHRASE: string;

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

export interface DispatchGitHub {
  mainSha(): string;
  acceptedCheckpoints(sha: string): number;
  runs(): DispatchRun[];
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
  },
  deps: {
    readonly github: unknown;
    readonly checkContract: (input: { mission: string; lane: string; mainSha: string }) => { ok: boolean; detail?: string };
    readonly sleep: (ms: number) => Promise<void>;
    readonly log: (line: string) => void;
  },
): Promise<DispatchResult>;

/** Types for .github/julius-live-progress.mjs (the paid job's phase publisher). */
export declare const CONTEXT: 'julius-live-progress';
export declare const GRAMMAR: RegExp;
export declare const DESCRIPTION_MAX: number;
export declare const MIN_INTERVAL_MS: number;
export declare const MAX_RUNTIME_MS: number;
export declare const TASK_QUERY: string;
export interface ProgressRow { readonly role: string; readonly taskType: string; state: string; readonly ordinal: number }
export interface ProgressSnapshot { readonly role: string; readonly taskType: string; readonly state: string; readonly ordinal: number; readonly cycle: string }
export declare function credentialShaped(value: string): boolean;
export declare function parseTaskRows(stdout: string): ProgressRow[];
export declare function snapshotOf(rows: readonly ProgressRow[]): ProgressSnapshot | null;
export declare function describe(input: { runId: string; wlj8: string; seq: number; snapshot: ProgressSnapshot | null; marker: 'ended' | null }): string | null;
export declare function configFrom(env: Record<string, string | undefined>): any;
export declare function readTasks(config: any, spawnImpl?: unknown): Promise<ProgressRow[] | null>;
export declare function postStatus(config: any, description: string, state: string, fetchImpl?: unknown): Promise<boolean>;
export declare function run(env: Record<string, string | undefined>, deps?: Record<string, unknown>): Promise<void>;

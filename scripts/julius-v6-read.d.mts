/**
 * Type declarations for the V6 reader (row 2, G-5 instrument). Plain `.mjs` because it runs with `node` and no build
 * step, with no dependencies and no network; its test imports the SAME module.
 */
export declare const MET: 'MET';
export declare const NOT_MET: 'NOT MET';
export declare const UNKNOWN: 'UNKNOWN';
export declare const ITEMS: readonly string[];
export declare const E7_TESTS: readonly string[];
export declare const E8_TESTS: readonly string[];
export declare const NOT_JUDGED: readonly string[];

export interface V6ReadOptions {
  bundle?: string;
  log?: string;
  approvers?: string;
  workflowLogins?: string;
  contract?: string;
  grant?: string;
  ciLog?: string;
}

export interface V6ItemResult {
  id: string;
  status: 'MET' | 'NOT MET' | 'UNKNOWN';
  because: string[];
  rows: string[];
}

export declare function parseTsv(text: string | null):
  | { state: 'missing' | 'unavailable' }
  | { state: 'unreadable'; why: string }
  | { state: 'ok'; header: string[]; rows: Array<Record<string, string | number>> };
export declare function parseKeyValues(text: string | null): Record<string, string> | null;
export declare function parseTime(value: string): bigint | null;
export declare function readV6(options: V6ReadOptions): V6ItemResult[];
export declare function render(results: readonly V6ItemResult[]): string;
export declare function parseArgs(argv: readonly string[]): V6ReadOptions | null;
export declare function main(argv: readonly string[], write?: (text: string) => unknown): number;

export declare const J1_GRADE_PINS: Readonly<{
  contractSha256: string;
  combinedSha256: string;
  checkerFileSha256: string;
  oracleSha256: string;
}>;
export declare const J1_PIN_FILES: readonly string[];
export declare const VERDICTS: readonly ['PASS', 'FAIL', 'NOT_RUN'];
export declare const NOT_RUN_REASONS: readonly string[];

export type JuliusInworldVerdict = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface JuliusInworldVerdictRecord {
  readonly verdict: JuliusInworldVerdict | string;
  readonly reason?: string | null;
  readonly taskId?: string | null;
  readonly taskType?: string | null;
  readonly trimmedSha256?: string | null;
  readonly rawSha256?: string | null;
  readonly checkerSha256?: string | null;
  readonly combinedPin?: string | null;
  readonly graderSha256?: string | null;
  readonly failedSections?: string | null;
}

export declare function combinedPin(entries: readonly (readonly [string, Uint8Array])[]): string;
export declare function parsePsqlTsv(text: string): Record<string, string>[] | null;
export declare function selectGradedAttempt(tasks: readonly Record<string, string>[]):
  | { readonly ok: true; readonly taskId: string; readonly taskType: string }
  | { readonly ok: false; readonly reason: string; readonly taskIds?: readonly string[] };
export declare function judgeCheckerRun(
  run: { readonly status: number | null; readonly signal: string | null; readonly stdout?: string; readonly error?: unknown },
  expected: { readonly checkerFileSha256: string; readonly trimmedSha256: string },
): { readonly verdict: JuliusInworldVerdict; readonly reason: string | null; readonly failedSections?: string };
export declare function verdictText(v: JuliusInworldVerdictRecord): string;
export declare function gradeInworld(opts: {
  readonly staging: string;
  readonly finalMessage: string;
  readonly evidence: string;
  readonly graderSha256?: string;
  readonly nodePath?: string;
}): { readonly exit: number; readonly verdict: JuliusInworldVerdictRecord & { readonly verdict: JuliusInworldVerdict } };

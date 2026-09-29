/**
 * Type declarations for the workflow's subscription verdicts.
 *
 * Plain `.mjs` so the paid workflow runs it with `node` and no build step; the
 * tests import the same functions. It starts no process: the workflow runs the
 * CLI as a literal command and pipes its JSON here.
 */

export declare const TOKEN_ENV: 'CLAUDE_CODE_OAUTH_TOKEN';
export declare const OUTRANKING_ENV_NAMES: readonly string[];

export declare function envReason(env: Readonly<Record<string, string | undefined>>): string | null;

export interface SubscriptionStatusVerdict {
  readonly ok: boolean;
  readonly method: string;
  readonly provider: string;
  readonly plan: string;
  readonly keySource: string;
  readonly reason: string | null;
}

export declare function statusVerdict(raw: string, requirePlan?: string | null): SubscriptionStatusVerdict;

export interface SubscriptionSmokeVerdict {
  readonly ok: boolean;
  readonly reply: 'OK' | 'ERROR' | 'UNREADABLE' | 'UNEXPECTED';
}

export declare function smokeVerdict(raw: string): SubscriptionSmokeVerdict;

export interface SubscriptionCheckIo {
  readonly print?: (line: string) => void;
  readonly stdin?: () => string;
  readonly readFile?: (path: string) => string;
}

export declare function main(
  argv: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
  io?: SubscriptionCheckIo,
): number;

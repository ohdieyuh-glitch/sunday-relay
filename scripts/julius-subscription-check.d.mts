/**
 * Type declarations for the workflow's subscription check and smoke.
 *
 * Plain `.mjs` so the paid workflow runs it with `node` and no build step; the
 * tests import the same functions.
 */

export declare const TOKEN_ENV: 'CLAUDE_CODE_OAUTH_TOKEN';
export declare const EXECUTABLE_ENV: 'JULIUS_CODER_CLAUDE_EXECUTABLE';
export declare const OUTRANKING_ENV_NAMES: readonly string[];

export declare function sdkExecutableCandidates(platform?: string, arch?: string): string[];

export declare function resolveCli(env?: Readonly<Record<string, string | undefined>>): string | null;

export declare function composeChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  home: string,
): Record<string, string>;

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

export declare function main(
  argv: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
  print?: (line: string) => void,
): number;

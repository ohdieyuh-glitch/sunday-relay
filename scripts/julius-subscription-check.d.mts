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

/** Why a smoke reply was not a clean OK, in closed tokens only: nothing the CLI wrote is returned. */
export interface SubscriptionSmokeFailure {
  readonly reason: 'MODEL_NOT_ENTITLED_OR_NOT_FOUND' | 'AUTH' | 'USAGE_LIMIT' | 'RATE_LIMITED' | 'OVERLOADED'
    | 'MAX_TURNS' | 'UNEXPECTED_REPLY' | 'UNREADABLE' | 'OTHER';
  /** Three digits, or `none`. */
  readonly http: string;
  /** The CLI's result subtype when it is a plain token, or `none`. */
  readonly subtype: string;
}

export declare function smokeFailureReason(raw: string): SubscriptionSmokeFailure;

/** Which model answered the smoke, by the runtime's own crediting rule, and whether it is the one requested. */
export interface SubscriptionSmokeServed {
  /** The producers' `modelUsage` keys, largest first, each a plain label or `unsafe`, at most eight; or `none`. */
  readonly served: string;
  readonly match: 'EXACT' | 'DATED_BUILD' | 'MISMATCH' | 'NONE';
}

export declare function smokeServedModel(raw: string, requested: string): SubscriptionSmokeServed;

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

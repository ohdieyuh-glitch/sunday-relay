/**
 * Type declarations for the R16 local rehearsal runner.
 *
 * Authored as plain `.mjs` so it runs with `node` and no build step; the TypeScript tests import the SAME guards.
 */

export declare const R16_THROWAWAY_DATABASE: RegExp;

export interface R16Args {
  readonly db: string;
  readonly port: number;
  readonly clientIdFile: string | null;
  readonly githubStub: string | null;
  readonly tap: string | null;
  readonly build: boolean;
}

export declare function parseArgs(argv: readonly string[]): R16Args;

export declare function childEnv(
  parent: Readonly<Record<string, string | undefined>>,
  settings: {
    readonly db: string;
    readonly port: number;
    readonly clientId: string;
    readonly githubStub: string | null;
    readonly tap: string | null;
    readonly dataDir: string;
  },
): Record<string, string | undefined>;

/**
 * Type declarations for the R16 local rehearsal runner.
 *
 * Authored as plain `.mjs` so it runs with `node` and no build step; the TypeScript tests import the SAME guards.
 */

export declare const R16_THROWAWAY_DATABASE: RegExp;

/** The checkout the launcher lives in. */
export declare const REPO_ROOT: string;

/** R16_THROWAWAY_PG_PORT (default 54329; never 5432), the same rule as the stub fence and the migrate helper. */
export declare function throwawayPgPort(env?: Readonly<Record<string, string | undefined>>): number;

/** 127.0.0.1 on the throwaway port, a database named sw_r16_<n>. */
export declare function throwawayDatabase(env?: Readonly<Record<string, string | undefined>>): RegExp;

export declare function adminDatabaseUrl(pgPort: number): string;

export interface R16Args {
  readonly db: string;
  readonly port: number;
  readonly clientIdFile: string | null;
  readonly githubStub: string | null;
  readonly tap: string | null;
  readonly build: boolean;
  readonly eosConfig: string | null;
  readonly roomSaltFile: string | null;
  readonly pgPort: number;
}

export declare function parseArgs(argv: readonly string[], env?: Readonly<Record<string, string | undefined>>): R16Args;

/** Existence only; never opens the file. A path under .iwonder-secrets is never printed. Returns the line to print. */
export declare function checkEosConfig(path: string, exists?: (path: string) => boolean): string;

/** Created once (32 random bytes, hex), never overwritten, refused inside repoRoot. */
export declare function ensureRoomSaltFile(path: string, repoRoot?: string): { readonly path: string; readonly created: boolean };

export declare function childEnv(
  parent: Readonly<Record<string, string | undefined>>,
  settings: {
    readonly db: string;
    readonly port: number;
    readonly clientId: string;
    readonly githubStub: string | null;
    readonly tap: string | null;
    readonly dataDir: string;
    readonly pgPort?: number;
    readonly eosConfig?: string | null;
    readonly roomSaltFile?: string | null;
  },
): Record<string, string | undefined>;

/**
 * Type declarations for the dependency-free parity checker.
 *
 * The checker is authored as plain `.mjs` on purpose: the npm script runs it
 * with `node` and no build step, and the TypeScript tests import the SAME
 * functions, so there is exactly one implementation of the parity rules.
 * These declarations give the test suite type safety over that module.
 */

export interface ParityFailure {
  capabilityId: string;
  rule: string;
  detail: string;
}

export interface ParityResult {
  ok: boolean;
  failures: ParityFailure[];
}

export interface LoadedRegistry {
  registry: { manifestVersion: string; capabilities: unknown[]; [key: string]: unknown };
  checksum: string;
  path: string;
}

export type LoadResult =
  | { ok: true; value: LoadedRegistry }
  | { ok: false; error: string };

export const REGISTRY_RELATIVE_PATH: string;
export const PARITY_CLASSES: string[];
export const SURFACE_STATUSES: string[];
export const DOMAINS: string[];
export const DEFAULT_COMPANION_PATHS: string[];

export function loadRegistry(repoRoot: string): LoadResult;

export function validateRegistry(
  registry: unknown,
  options?: { now?: string },
): ParityResult;

export function compareRegistries(
  local: { registry: { manifestVersion: string }; checksum: string },
  companion: { registry: { manifestVersion: string }; checksum: string },
): ParityResult;

/**
 * Companion comparison is opt-in: `explicit` is required, and there are no
 * default search paths (the old defaults pointed at Alcatraz worktrees).
 */
export function findCompanion(repoRoot: string, explicit?: string): string | null;

/** `path/to/file.ts#symbol` → `path/to/file.ts`. */
export function declaredPathOf(declared: string): string;

/**
 * True when a registry entry point names a FILE rather than a CLI command.
 * Paths carry an extension and never contain whitespace; commands such as
 * `relay mission budget` and `relay (interactive) /pause` always do.
 */
export function isFileClaim(declared: string): boolean;

/**
 * Both surfaces live in this repository, so every entry point and test
 * reference the registry declares must resolve to a real file. `checked` is
 * how many file claims were examined (command notations are not files).
 */
export function verifyDeclaredFiles(
  repoRoot: string,
  registry: unknown,
): ParityResult & { checked: number };

export function runParityCheck(options: {
  repoRoot: string;
  strict?: boolean;
  companionPath?: string;
  now?: string;
}): ParityResult & { lines: string[] };

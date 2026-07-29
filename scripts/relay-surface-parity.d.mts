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

export function findCompanion(repoRoot: string, explicit?: string): string | null;

export function runParityCheck(options: {
  repoRoot: string;
  strict?: boolean;
  companionPath?: string;
  now?: string;
}): ParityResult & { lines: string[] };

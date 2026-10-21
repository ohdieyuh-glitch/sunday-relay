/**
 * Type declarations for the transport ring's mutants. Plain `.mjs` so a reviewer can run it with `node` alone.
 */

export interface WorldTrailEdit {
  /** The file it rewrites, relative to the root of the worktree. */
  readonly file: string;
  /** The anchor: it must occur exactly once in the file. */
  readonly from: string;
  readonly to: string;
}

export interface WorldTrailMutation {
  readonly id: string;
  /** The invariant whose gate, filter or clear this mutant removes. */
  readonly invariant: string;
  readonly edits: readonly WorldTrailEdit[];
  /** The ids (RING-..., R.., or GOLDEN) of the tests that must ALL fail under it: exact ids, the leading ids of a test's title. */
  readonly kills: readonly string[];
}

/** One id of the mutant map: 'live', 'retired', 'merged into Mnn' or 'never assigned', and why. */
export interface WorldTrailMutantMapEntry {
  readonly id: string;
  readonly status: string;
  readonly note: string;
}

export declare const WORLD_TRAIL_TEST_FILES: readonly string[];
export declare const WORLD_TRAIL_MUTATIONS: readonly WorldTrailMutation[];
export declare const WORLD_TRAIL_MUTANT_MAP: readonly WorldTrailMutantMapEntry[];
export declare const GOLDEN_TITLE: string;
/** A test's ids: the LEADING id tokens of its title; GOLDEN for the golden test. */
export declare function testIdsOf(title: string): string[];
/** The mutated texts per file; throws when an anchor does not occur exactly once. */
export declare function applyWorldTrailMutation(mutation: WorldTrailMutation, read: (file: string) => string): Map<string, string>;

/**
 * Type declarations for the transport ring's mutants. Plain `.mjs` so a reviewer can run it with `node` alone.
 */

export interface WorldTrailMutation {
  readonly id: string;
  /** The invariant whose one clear or filter this mutant removes. */
  readonly invariant: string;
  /** The file it rewrites, relative to the root of the worktree. */
  readonly file: string;
  /** The anchor: it must occur exactly once in the file. */
  readonly from: string;
  readonly to: string;
  /** The RING-... id of the test that must fail under it. */
  readonly kills: string;
}

export declare const WORLD_TRAIL_TEST_FILES: readonly string[];
export declare const WORLD_TRAIL_MUTATIONS: readonly WorldTrailMutation[];
/** The mutated text; throws when the anchor does not occur exactly once. */
export declare function applyWorldTrailMutation(mutation: WorldTrailMutation, text: string): string;

/**
 * Type declarations for the container proof's mutations. Plain `.mjs` because
 * the proof runs it with `node` inside a container that has no build.
 */

export declare const PROFILE_HEREDOC_BEFORE_ISOLATION: string;

export interface IsolationProofMutation {
  readonly name: string;
  /** The file the mutation rewrites, relative to the root of the copy. */
  readonly file: string;
  /** The refusal the bootstrap must print once the mutation is applied. */
  readonly refusal: string;
  /** Returns the mutated text, or throws when the anchor is gone. */
  apply(text: string): string;
}

export declare const ISOLATION_PROOF_MUTATIONS: readonly IsolationProofMutation[];

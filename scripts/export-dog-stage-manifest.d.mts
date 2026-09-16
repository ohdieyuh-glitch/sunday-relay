/**
 * Type declarations for the Dog stage manifest exporter.
 *
 * Authored as plain `.mjs` for the same reason the beta gate is: an operator
 * runs it with `node` and no build step, and the TypeScript staleness test
 * imports the SAME builder, so there is exactly one implementation of the
 * manifest shape.
 */

/** One stage's entry. `inherit` carries a reason instead of a performance. */
export type DogStageManifestEntry =
  | { readonly stage: string; readonly presentation: 'inherit'; readonly because: string }
  | {
    readonly stage: string;
    readonly presentation: 'staged';
    readonly animationId: string;
    readonly prop: string;
    readonly locomotion: string;
    readonly emission: string;
    readonly contractPresent: boolean;
    readonly headTracksContract: boolean;
  };

export interface DogStageManifest {
  readonly $comment: string;
  readonly schema: string;
  readonly lockedStages: readonly string[];
  readonly stages: readonly DogStageManifestEntry[];
  readonly activityToStage: Readonly<Record<string, string>>;
}

/** Where the generated manifest is written. */
export const DOG_STAGE_MANIFEST_PATH: string;

/**
 * Build the manifest from the live stage table. Takes the module rather than
 * importing it, so the test hands in the same module it asserts against.
 */
export function buildDogStageManifest(stageModule: unknown): DogStageManifest;

/** The exact bytes written to disk, so the staleness test can compare text. */
export function renderDogStageManifest(manifest: DogStageManifest): string;

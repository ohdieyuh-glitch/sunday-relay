/**
 * OFFICIAL RELAY DOG — cross-surface parity manifest.
 *
 * Sunday Relay has ONE official Relay Dog, and both surfaces now import the
 * SAME modules from this directory:
 *
 *   official-relay-dog-sprite.ts   the canonical 18x14 voxel art + palette
 *   official-relay-dog-states.ts   the canonical state semantics + motion
 *
 * Identity therefore holds BY CONSTRUCTION. One module imported by the
 * website/application and by the CLI/terminal cannot drift, so the checksums
 * that used to hash two hand-copied duplicates are gone: they proved something
 * strictly weaker than what the module graph now proves, and they could only
 * ever fail after someone forgot to recompute them.
 *
 * Updating the dog is a single deliberate edit here, plus a bump of
 * OFFICIAL_RELAY_DOG_IDENTITY_VERSION when the identity itself moved. Each
 * surface's parity suite asserts that its barrel still resolves to THIS
 * directory, so a future re-fork into per-surface copies fails immediately.
 *
 * PURE DATA — no imports. See docs/relay/OFFICIAL_RELAY_DOG_IDENTITY.md.
 */

/** Bumped whenever the shared file set changes shape (not on every edit). */
export const OFFICIAL_RELAY_DOG_MANIFEST_VERSION = '2.0.0';

/**
 * The retired dog. The CLI used to draw a large, flat, horizontally stretched,
 * SIDE-FACING four-legged sprite with an oversized gold collar stripe, a long
 * rectangular body and a raised rectangular tail. It is gone. These markers
 * exist so a source-level test can prove it never comes back — including as a
 * "simple" fallback for a terminal without color or Unicode.
 */
export const RETIRED_SIDE_PROFILE_DOG_MARKERS = [
  'LARGE_DOG',
  'SMALL_DOG',
  'ASCII_DOG',
] as const;

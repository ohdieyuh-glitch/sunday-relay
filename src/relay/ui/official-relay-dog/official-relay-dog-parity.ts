/**
 * OFFICIAL RELAY DOG — cross-surface parity manifest.
 *
 * The website/application and the CLI/terminal live in separate worktrees, so
 * neither can import the other's files. The shared dog identity is therefore
 * carried as BYTE-IDENTICAL copies of two pure-data modules, and these
 * checksums are what prove the copies have not diverged:
 *
 *   official-relay-dog-sprite.ts   the canonical 18x14 voxel art + palette
 *   official-relay-dog-states.ts   the canonical state semantics + motion
 *
 * Each repository has a test that hashes its OWN copy of those two files and
 * asserts the digests below. Because this manifest is itself byte-identical on
 * both sides, a change on one surface that is not mirrored on the other fails
 * that surface's test immediately — there is no silent drift, and no surface
 * can quietly grow a second mascot.
 *
 * Updating the dog is therefore a deliberate two-repository action:
 *   1. change the art or the semantics,
 *   2. copy the changed file verbatim into the other repository,
 *   3. recompute both digests and update this manifest in BOTH repositories,
 *   4. bump OFFICIAL_RELAY_DOG_IDENTITY_VERSION when the identity itself moved.
 *
 * PURE DATA — no imports. See docs/relay/OFFICIAL_RELAY_DOG_IDENTITY.md.
 */

/** Bumped whenever the shared file set changes shape (not on every edit). */
export const OFFICIAL_RELAY_DOG_MANIFEST_VERSION = '1.1.0';

/** sha256 of the byte-identical shared modules, lowercase hex. */
export const OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS = {
  'official-relay-dog-sprite.ts':
    '6c815798597d8f1de5e33415c4e50471372435d97ea019039356587a9995cbe0',
  'official-relay-dog-states.ts':
    'cf95e69ce7989d0e63a3b911ccd1668c6c4cac013485b301a2c948b0b37315ef',
} as const;

export type OfficialRelayDogAssetName = keyof typeof OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS;

export const OFFICIAL_RELAY_DOG_ASSET_NAMES = Object.keys(
  OFFICIAL_RELAY_DOG_ASSET_CHECKSUMS,
) as OfficialRelayDogAssetName[];

/**
 * Where each surface keeps its copy. Recorded for the identity document and
 * for humans debugging a checksum failure — nothing resolves these at runtime.
 */
export const OFFICIAL_RELAY_DOG_ASSET_LOCATIONS = {
  website: 'src/relay/ui/official-relay-dog/',
  cli: 'src/relay/cli/product/',
} as const;

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

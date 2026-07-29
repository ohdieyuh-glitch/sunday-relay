/**
 * OFFICIAL RELAY DOG — the canonical sprite, shared verbatim by every surface.
 *
 * Sunday Relay has ONE official Relay Dog. This module is the byte-identical
 * asset carried by both the Sunday Relay website/application and the Sunday
 * Relay CLI/terminal, so the two surfaces can never drift into two mascots.
 *
 * The official dog is the compact FRONT-FACING voxel companion: upright
 * rectangular ears, a block head, a dark charcoal visor band across the face
 * with two square amber eyes inside it, a short squared muzzle, a compact
 * chest, and short block legs — bone/cream white with a shadow tone that gives
 * the front and side surfaces their dimensionality. Hard pixel edges only: no
 * rounded vector illustration, no smooth cartoon outline, no antialiasing that
 * would blur the voxel edges.
 *
 * It is NOT the retired dog: the large, flat, horizontally stretched,
 * side-facing four-legged sprite with the oversized gold collar stripe, the
 * long rectangular body and the raised rectangular tail. That silhouette is
 * deprecated and must never be reintroduced on any surface, including as a
 * fallback for reduced capability terminals.
 *
 * CANONICAL RENDERER OF RECORD (website):
 *   src/relay/ui/pixel-dog/RelayPixelDog.tsx
 * The grids below are that component's pixel grids, verbatim. A parity test
 * renders the component and asserts the drawn pixels still match this module,
 * so the shared asset can never silently diverge from the website artwork.
 *
 * PURE DATA — no imports, no framework, no environment. See
 * docs/relay/OFFICIAL_RELAY_DOG_IDENTITY.md.
 */

/** Bumped only when the dog's identity changes — never for a renderer tweak. */
export const OFFICIAL_RELAY_DOG_IDENTITY_VERSION = '1.0.0';

/** The art is a fixed 18x14 pixel grid. Both surfaces scale it by ONE uniform
 *  factor; independent width/height scaling is prohibited (it distorts the
 *  body). See OFFICIAL_RELAY_DOG_ASPECT. */
export const OFFICIAL_RELAY_DOG_WIDTH = 18;
export const OFFICIAL_RELAY_DOG_HEIGHT = 14;
export const OFFICIAL_RELAY_DOG_ASPECT = OFFICIAL_RELAY_DOG_WIDTH / OFFICIAL_RELAY_DOG_HEIGHT;

/**
 * Pixel legend:
 *   '.' empty (transparent — never painted, never a background fill)
 *   'w' bone/cream white body
 *   's' shadow tone (the dimensional side/under surfaces)
 *   'd' dark charcoal facial visor band
 *   'y' amber/gold eye (inside the visor band only)
 *   'c' gold collar
 */
export type OfficialRelayDogPixel = 'w' | 's' | 'd' | 'y' | 'c';

/** Canonical colors. The website paints these hex values directly. */
export const OFFICIAL_RELAY_DOG_PALETTE: Record<OfficialRelayDogPixel, string> = {
  w: '#ece9e2',
  s: '#b9b5ab',
  d: '#23262e',
  y: '#f2c14e',
  c: '#d9a441',
};

/**
 * The nearest xterm-256 index for each canonical color, so a terminal surface
 * renders the SAME dog rather than inventing its own palette. Chosen by
 * smallest RGB distance to the hex above; documented here (not in the CLI) so
 * the mapping is part of the shared identity, not a local rendering choice.
 */
export const OFFICIAL_RELAY_DOG_TERMINAL_TONE: Record<OfficialRelayDogPixel, string> = {
  w: '254',
  s: '249',
  d: '235',
  y: '221',
  c: '179',
};

export type OfficialRelayDogPose =
  | 'standing'
  | 'trotting'
  | 'running'
  | 'sitting'
  | 'lying'
  | 'carrying'
  /** Up on hind toes, front paws raised toward an implied work surface. */
  | 'reaching';

/** The head block — ears, skull, visor band, amber eyes, muzzle. Shared by
 *  every pose except `carrying` (which adds the carried block) and `lying`
 *  (which drops the muzzle row as the dog settles). */
const HEAD = [
  '.........ww..ww...',
  '.........wwwwww...',
  '........wwwwwwww..',
  '........wddddddw..',
  '........wdyydyyw..',
  '........wwwwwwww..',
];

export const OFFICIAL_RELAY_DOG_POSES: Record<OfficialRelayDogPose, readonly string[]> = {
  standing: [
    ...HEAD,
    '.w......ccwwww....',
    '.ww..wwwwwwwwww...',
    '..wwwwwwwwwwwww...',
    '..swwwwwwwwwwss...',
    '...wwwwwwwwwww....',
    '...ww....ww..ww...',
    '...ww....ww..ww...',
    '...ss....ss..ss...',
  ],
  trotting: [
    ...HEAD,
    '.w......ccwwww....',
    '.ww..wwwwwwwwww...',
    '..wwwwwwwwwwwww...',
    '..swwwwwwwwwwss...',
    '...wwwwwwwwwww....',
    '..ww.....ww...ww..',
    '.ww.......ww...ww.',
    '..................',
  ],
  running: [
    ...HEAD,
    '.w......ccwwww....',
    '.ww..wwwwwwwwww...',
    '..wwwwwwwwwwwww...',
    '..swwwwwwwwwwss...',
    '...wwwwwwwwwww....',
    '..www....ww..www..',
    '.ww........ww..ww.',
    '..................',
  ],
  sitting: [
    ...HEAD,
    '........ccwwww....',
    '.......wwwwwww....',
    '......wwwwwwww....',
    '.....wwwwwwwww....',
    '.....wwwwwwwww....',
    '.....wwwwwwww.....',
    '.....ww....ww.....',
    '.....ss....ss.....',
  ],
  lying: [
    '..................',
    '..................',
    '..................',
    ...HEAD.slice(0, 5),
    '........ccwwww....',
    '..wwwwwwwwwwwww...',
    '..wwwwwwwwwwwww...',
    '..swwwwwwwwwwws...',
    '..ss.........ss...',
    '..................',
  ],
  /* IMPLEMENTING: the dog is up on its tippy toes, torso stretched vertical,
     both front paws lifted toward the work surface in front of it. Same head,
     collar and silhouette language as every other pose — only the stance
     changes. This pose carries the "implementing" meaning on BOTH surfaces. */
  reaching: [
    ...HEAD,
    '.......cccwwww.ww.',
    '........wwwwww.ww.',
    '........wwwwwww...',
    '.......swwwwwws...',
    '........wwwwww....',
    '........wwwwww....',
    '........ww..ww....',
    '........s....s....',
  ],
  carrying: [
    HEAD[0],
    HEAD[1],
    HEAD[2],
    '...cccc.' + HEAD[3].slice(8),
    '...cyyc.' + HEAD[4].slice(8),
    '...cccc.' + HEAD[5].slice(8),
    '.w......ccwwww....',
    '.ww..wwwwwwwwww...',
    '..wwwwwwwwwwwww...',
    '..swwwwwwwwwwss...',
    '...wwwwwwwwwww....',
    '...ww....ww..ww...',
    '...ww....ww..ww...',
    '...ss....ss..ss...',
  ],
};

export const OFFICIAL_RELAY_DOG_POSE_NAMES = Object.keys(
  OFFICIAL_RELAY_DOG_POSES,
) as OfficialRelayDogPose[];

/** The whole identity as one value, for checksum + parity assertions. */
export const OFFICIAL_RELAY_DOG_SPRITE = {
  identityVersion: OFFICIAL_RELAY_DOG_IDENTITY_VERSION,
  width: OFFICIAL_RELAY_DOG_WIDTH,
  height: OFFICIAL_RELAY_DOG_HEIGHT,
  palette: OFFICIAL_RELAY_DOG_PALETTE,
  terminalTone: OFFICIAL_RELAY_DOG_TERMINAL_TONE,
  poses: OFFICIAL_RELAY_DOG_POSES,
} as const;

/** Read a pose grid, defaulting to `standing` so an unknown pose can never
 *  leave a surface without the official dog. */
export function officialRelayDogGrid(pose: OfficialRelayDogPose | string): readonly string[] {
  return (
    (OFFICIAL_RELAY_DOG_POSES as Record<string, readonly string[] | undefined>)[pose] ??
    OFFICIAL_RELAY_DOG_POSES.standing
  );
}

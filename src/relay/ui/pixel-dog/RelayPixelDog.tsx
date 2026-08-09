/**
 * Pixel Relay Dog — the product mark and living state indicator, drawn to the
 * founder-approved sprite: bone-white robot dog, dark visor faceplate with
 * two gold eyes, gold collar. Pure presentation: the pose, label, and marker
 * always arrive through props (normalized UI data). The component never
 * invents state from animation timing, never randomizes, and honors reduced
 * motion. SVG pixel grid, crisp edges, no external assets.
 */

import { chakraAccent, chakraDogPalette, type ChakraTier } from '../../shared/relay-chakra';

export type PixelDogPose =
  | 'standing'
  | 'trotting'
  | 'running'
  | 'sitting'
  | 'lying'
  | 'carrying'
  /** Up on hind toes, front paws raised toward an implied work surface. */
  | 'reaching'
  /** REVIEWING: curled and resting, eyes shut, while a review runs. */
  | 'sleeping'
  /** REPAIRING: leaning forward, nose down, paws at the disturbed ground. */
  | 'digging'
  /** CODING: seated at an implied keyboard, both front paws on the keys. */
  | 'coding';

export type PixelDogMarker = 'none' | 'alert' | 'check' | 'question' | 'scan';

export interface RelayPixelDogProps {
  pose: PixelDogPose;
  /** Uppercase system label, e.g. READY, WANDERING, REVIEWING. */
  label: string;
  sublabel?: string;
  marker?: PixelDogMarker;
  /** Pixel unit size; total art is 18×14 units. */
  unit?: number;
  /** Motion class applied only when true AND not reduced motion. */
  moving?: boolean;
  reducedMotion?: boolean;
  /** Draw the glowing perspective grid floor under the dog. */
  floor?: boolean;
  className?: string;
  /**
   * Progression tier, as CONTROLLED ACCENTS on the eyes, collar and cast
   * light. `null` — the default — renders the Dog exactly as shipped, because
   * Relay awards no levels and a default tier would be this component
   * asserting one. See `src/relay/shared/relay-chakra.ts`.
   */
  tier?: ChakraTier | null;
}

/* 18×14 pixel grids.
   '.'=empty  w=bone white  s=shadow grey  d=dark visor  y=gold eye  c=gold collar */
const HEAD = [
  '.........ww..ww...',
  '.........wwwwww...',
  '........wwwwwwww..',
  '........wddddddw..',
  '........wdyydyyw..',
  '........wwwwwwww..',
];

/** The same head with the eyes shut — only the amber eye row closes. */
const HEAD_ASLEEP = [...HEAD.slice(0, 4), '........wddddddw..', ...HEAD.slice(5)];

const POSES: Record<PixelDogPose, string[]> = {
  standing: [
    ...HEAD,
    '.w......ccwwww....',
    '.ww..wwwwwwwwww...',
    '..wwwwwwwwwwwww...',
    '..swwwwwwwwwwss...',
    '...wwwwwwwwwww....',
    // FOUR LEGS, NOT THREE. A side-view quadruped needs a far-side pair to
    // have four paws that can move independently; the approved sprite drew
    // three columns, so a four-beat gait was impossible without one of them
    // doing two jobs. The far legs are shadow grey, which is how this sprite
    // already renders depth, so the mark stays the mark.
    '...ww..ss.ww.ww...',
    '...ww..ss.ww.ww...',
    '...ss..ss.ss.ss...',
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
  /* Implementing: the dog is up on its hind toes, torso vertical, both front
     paws lifted toward the work in front of it. Same head, collar, and
     silhouette language as every other pose — only the stance changes. */
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
  /* Reviewing: curled and settled, eyes shut. No check mark, no success
     styling — a review in progress is not approval. */
  sleeping: [
    '..................',
    '..................',
    ...HEAD_ASLEEP,
    '.....ccwwwwww.....',
    '...wwwwwwwwwww....',
    '..swwwwwwwwwwws...',
    '..swwwwwwwwwwws...',
    '...ww......ww.....',
    '...ss......ss.....',
  ],
  /* Repairing: nose toward the ground, rump and tail raised, front paws down at
     the disturbed patch. Eyes stay open — investigating, not resting. */
  digging: [
    '..................',
    '...............www',
    '..........wwwww.ww',
    ...HEAD,
    '.....ccwwwwwwwww..',
    '...wwwwwwwwwwwww..',
    '..swwwwwwwwwwwws..',
    '..ww....ww...ww...',
    '..ss....ss...ss...',
  ],
  /* Coding: seated square to the viewer, both front paws forward on an implied
     keyboard. The editor and its experience levels are decoration layers. */
  coding: [
    ...HEAD,
    '.......ccwwwww....',
    '......wwwwwwwww...',
    '.....wwwwwwwwww...',
    '.....wwwwwwwwww...',
    '..wwwwwwwwwwwww...',
    '..sswwwwwwwwws....',
    '.....ww....ww.....',
    '.....ss....ss.....',
  ],
};

const PIXEL_FILL: Record<string, string> = {
  w: '#ece9e2',
  s: '#b9b5ab',
  d: '#23262e',
  y: '#f2c14e',
  c: '#d9a441',
};

const MARKER_GLYPH: Record<Exclude<PixelDogMarker, 'none'>, string> = {
  alert: '!',
  check: '✓',
  question: '?',
  scan: '▚',
};

/**
 * WHICH PART OF THE ANIMAL EACH PIXEL BELONGS TO.
 *
 * The sprite was one flat list of rects, so the only motion available to it
 * was moving the whole thing — and a sprite translated up and down reads as a
 * UI icon pulsing, not as an animal breathing. Grouping the pixels lets the
 * chest rise while the head barely moves and each paw carries its own phase.
 *
 * Rows are the anatomy: 0-5 head, 6-10 body, 11-13 legs. Within the legs,
 * columns separate the four paws — near-front, far-front, near-rear, far-rear
 * — which is what makes a four-beat gait possible at all.
 */
export const PIXEL_DOG_PARTS = [
  'head', 'body', 'leg-front-near', 'leg-front-far', 'leg-rear-near', 'leg-rear-far',
] as const;
export type PixelDogPart = (typeof PIXEL_DOG_PARTS)[number];

export function pixelDogPart(x: number, y: number): PixelDogPart {
  if (y <= 5) return 'head';
  if (y <= 10) return 'body';
  // Leg rows. The column bands follow the standing sprite; a pose without a
  // paw in a band simply contributes no pixels to that group, which is why
  // this needs no per-pose table.
  if (x <= 5) return 'leg-front-near';
  if (x <= 8) return 'leg-front-far';
  if (x <= 11) return 'leg-rear-near';
  return 'leg-rear-far';
}

function PixelGrid({ grid, unit, palette }: {
  grid: string[];
  unit: number;
  /** Overrides for palette LETTERS. Absent letters keep the shipped colour. */
  palette?: Readonly<Record<string, string>>;
}) {
  const w = 18 * unit;
  const h = 14 * unit;
  return (
    <svg
      className="rpd-art"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {PIXEL_DOG_PARTS.map((part) => {
        const rects = grid.flatMap((row, y) =>
          row.split('').map((ch, x) => {
            if (pixelDogPart(x, y) !== part) return null;
            const fill = palette?.[ch] ?? PIXEL_FILL[ch];
            if (!fill) return null;
            return (
              <rect key={`${x}-${y}`} x={x * unit} y={y * unit} width={unit} height={unit} fill={fill} />
            );
          }),
        ).filter(Boolean);
        if (rects.length === 0) return null;
        return (
          <g
            key={part}
            className={`rpd-part rpd-part--${part}`}
            // The transform origin is the ground under this part, so a leg
            // swings from the shoulder and the body rises from the paws
            // rather than every group pivoting about the canvas corner.
            style={{ transformOrigin: `${9 * unit}px ${14 * unit}px` }}
          >
            {rects}
          </g>
        );
      })}
    </svg>
  );
}

export function RelayPixelDog({
  pose,
  label,
  sublabel,
  marker = 'none',
  unit = 6,
  moving = false,
  reducedMotion = false,
  floor = false,
  className = '',
  tier = null,
}: RelayPixelDogProps) {
  const grid = POSES[pose] ?? POSES.standing;
  const animate = moving && !reducedMotion;
  /**
   * THE TIER IS AN ACCENT, AND ONLY AN ACCENT.
   *
   * Two palette letters — the eyes and the collar — plus the light the figure
   * casts, which the stylesheet reads from these variables. The body, its
   * shading and the visor are untouched, so a tier can never turn the animal
   * into a solid colour. Untiered leaves every value exactly as shipped.
   */
  const accent = chakraAccent(tier);
  const palette = tier === null ? undefined : chakraDogPalette(tier);

  return (
    <figure
      className={`rpd rpd--${pose}${animate ? ' rpd--moving' : ''}${floor ? ' rpd--floored' : ''}${tier === null ? '' : ` rpd--tier rpd--tier-${tier}`} ${className}`.trim()}
      role="img"
      aria-label={`Relay Dog: ${label}`}
      style={{
        ['--rpd-accent' as string]: accent.accent,
        ['--rpd-accent-bright' as string]: accent.bright,
        ['--rpd-accent-glow' as string]: accent.glow,
      }}
    >
      <div className="rpd-stage">
        {marker !== 'none' && (
          <span className={`rpd-marker rpd-marker--${marker}`} aria-hidden="true">
            {MARKER_GLYPH[marker]}
          </span>
        )}
        <PixelGrid grid={grid} unit={unit} {...(palette === undefined ? {} : { palette })} />
        {floor && <div className="rpd-floor" aria-hidden="true" />}
      </div>
      <figcaption className="rpd-caption">
        <span className="rpd-label">{label}</span>
        {sublabel && <span className="rpd-sublabel">{sublabel}</span>}
      </figcaption>
    </figure>
  );
}

/** Tiny inline dog mark for headers — same pixel language, no caption. */
export function RelayDogMark({ unit = 2 }: { unit?: number }) {
  return (
    <span className="rpd-markwrap" aria-hidden="true">
      <PixelGrid grid={POSES.standing} unit={unit} />
    </span>
  );
}

/**
 * Pixel Relay Dog — the product mark and living state indicator, drawn to the
 * founder-approved sprite: bone-white robot dog, dark visor faceplate with
 * two gold eyes, gold collar. Pure presentation: the pose, label, and marker
 * always arrive through props (normalized UI data). The component never
 * invents state from animation timing, never randomizes, and honors reduced
 * motion. SVG pixel grid, crisp edges, no external assets.
 */

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

function PixelGrid({ grid, unit }: { grid: string[]; unit: number }) {
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
      {grid.flatMap((row, y) =>
        row.split('').map((ch, x) => {
          const fill = PIXEL_FILL[ch];
          if (!fill) return null;
          return (
            <rect key={`${x}-${y}`} x={x * unit} y={y * unit} width={unit} height={unit} fill={fill} />
          );
        }),
      )}
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
}: RelayPixelDogProps) {
  const grid = POSES[pose] ?? POSES.standing;
  const animate = moving && !reducedMotion;

  return (
    <figure
      className={`rpd rpd--${pose}${animate ? ' rpd--moving' : ''}${floor ? ' rpd--floored' : ''} ${className}`.trim()}
      role="img"
      aria-label={`Relay Dog: ${label}`}
    >
      <div className="rpd-stage">
        {marker !== 'none' && (
          <span className={`rpd-marker rpd-marker--${marker}`} aria-hidden="true">
            {MARKER_GLYPH[marker]}
          </span>
        )}
        <PixelGrid grid={grid} unit={unit} />
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

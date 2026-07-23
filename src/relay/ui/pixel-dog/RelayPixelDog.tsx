/**
 * Pixel Relay Dog — the product mark and living state indicator shared by the
 * Relay Entry Home and the Active Project Workspace. Pure presentation: the
 * pose, label, and marker always arrive through props (normalized UI data).
 * The component never invents state from animation timing, never randomizes,
 * and honors reduced motion. SVG pixel grid, crisp edges, no external assets.
 */

export type PixelDogPose =
  | 'standing'
  | 'trotting'
  | 'running'
  | 'sitting'
  | 'lying'
  | 'carrying';

export type PixelDogMarker = 'none' | 'alert' | 'check' | 'question' | 'scan';

export interface RelayPixelDogProps {
  pose: PixelDogPose;
  /** Uppercase system label, e.g. READY, WANDERING, REVIEWING. */
  label: string;
  sublabel?: string;
  marker?: PixelDogMarker;
  /** Pixel unit size; total art is 16×12 units. */
  unit?: number;
  /** Motion class applied only when true AND not reduced motion. */
  moving?: boolean;
  reducedMotion?: boolean;
  /** Draw the perspective grid floor under the dog. */
  floor?: boolean;
  className?: string;
}

/* 16×12 pixel grids. '.'=empty g=gold c=cream k=eye n=nose p=package */
const POSES: Record<PixelDogPose, string[]> = {
  standing: [
    '................',
    '................',
    '...........g..g.',
    '...........gggg.',
    '...........gkgg.',
    'g..........gggn.',
    'gg......ggggg...',
    '.ggggggggggcc...',
    '.ggggggggggg....',
    '.gggggggggg.....',
    '.gg......gg.....',
    '.gg......gg.....',
  ],
  trotting: [
    '................',
    '................',
    '...........g..g.',
    '...........gggg.',
    '...........gkgg.',
    'g..........gggn.',
    'gg......ggggg...',
    '.ggggggggggcc...',
    '.ggggggggggg....',
    '.gggggggggg.....',
    '..gg....gg......',
    '.gg.......gg....',
  ],
  running: [
    '................',
    '................',
    '...........g..g.',
    '...........gggg.',
    '...........gkgg.',
    'g..........gggn.',
    '.g......ggggg...',
    '.ggggggggggcc...',
    '.ggggggggggg....',
    '.gggggggggg.....',
    'gg........ggg...',
    'g...........gg..',
  ],
  sitting: [
    '................',
    '................',
    '..........g..g..',
    '..........gggg..',
    '..........gkgg..',
    '..........gggn..',
    '.......ggggg....',
    '......gggggg....',
    '.....gggggcc....',
    '....gggggggg....',
    '....gg...ggg....',
    '....gg...gg.....',
  ],
  lying: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..........g..g..',
    '..........gggg..',
    '..........gkgn..',
    '.ggggggggggggg..',
    '.ggggggggggcc...',
    '.gg......gg.....',
    '................',
  ],
  carrying: [
    '................',
    '....cccc........',
    '....cggc...g..g.',
    '....cccc...gggg.',
    '...........gkgg.',
    'g..........gggn.',
    'gg......ggggg...',
    '.ggggggggggcc...',
    '.ggggggggggg....',
    '.gggggggggg.....',
    '.gg......gg.....',
    '.gg......gg.....',
  ],
};

const PIXEL_FILL: Record<string, string> = {
  g: '#d9a441',
  c: '#ece7dd',
  k: '#07080b',
  n: '#8a5a24',
  p: '#f2c66d',
};

const MARKER_GLYPH: Record<Exclude<PixelDogMarker, 'none'>, string> = {
  alert: '!',
  check: '✓',
  question: '?',
  scan: '▚',
};

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
  const w = 16 * unit;
  const h = 12 * unit;
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
                <rect
                  key={`${x}-${y}`}
                  x={x * unit}
                  y={y * unit}
                  width={unit}
                  height={unit}
                  fill={fill}
                />
              );
            }),
          )}
        </svg>
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
  const grid = POSES.standing;
  const w = 16 * unit;
  const h = 12 * unit;
  return (
    <svg
      className="rpd-mark"
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

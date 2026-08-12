import { useId } from 'react';

/**
 * THE PROJECT BRAIN, AS AN OBJECT IN THE WORKSPACE.
 *
 * An ORIGINAL drawing, built from primitives in this file. The reference
 * images the direction supplied were watermarked stock and are reference only;
 * nothing here is traced from them and no external asset is loaded, which is
 * also the rule the rest of this product's artwork already follows.
 *
 * WHAT IT IS MADE OF, and why each layer exists:
 *
 *   depth       a dark technological plane beneath the brain, so it reads as
 *               floating ABOVE something rather than pasted onto a panel.
 *   lobes       two rounded masses and a stem — a brain silhouette, not a
 *               cartoon emoji and not a flat icon.
 *   pathways    luminous curves following the lobes, brightest where they
 *               cross, which is what makes it read as neural rather than as
 *               decorative swirls.
 *   nodes       small points of light ON the pathways, not scattered over the
 *               shape, so the network looks connected instead of speckled.
 *   specular    one soft highlight per mass, from the same direction as the
 *               surface gradient. Without it the lobes are flat discs with a
 *               vertical fade; with it they are round. It is white light at
 *               very low opacity, never the accent — a tier must not be able
 *               to change where the light comes from.
 *   signals     a few travelling pulses. Restrained on purpose: this sits
 *               above a workspace someone is trying to work in.
 *
 * THE ACCENT COLOUR IS AN INPUT, NOT A STATE THIS COMPONENT INVENTS. It
 * arrives as a CSS custom property from the caller so the Brain and the Relay
 * Dog can share one progression tier and visibly belong to each other.
 *
 * MOTION: one slow rotation, and pulses on the pathways. Both stop completely
 * under reduced motion — the rotation included, because a slowly rotating
 * object is still motion.
 */

export interface RelayProjectBrainOrbProps {
  /** Pixel size of the square artwork. */
  size?: number;
  reducedMotion?: boolean;
  /**
   * Whether the Brain has anything recorded. A Brain with no document is drawn
   * DIMMER rather than differently: the shape is the same object either way,
   * and the surface says the absence in words elsewhere rather than implying
   * it with a different picture.
   */
  populated?: boolean;
  className?: string;
}

/** Pathway curves, in the artwork's own 100×100 space. */
const PATHWAYS = [
  'M28 46 C 34 30, 52 26, 62 34',
  'M26 56 C 36 52, 44 60, 58 56',
  'M34 68 C 44 62, 56 68, 68 60',
  'M44 32 C 46 46, 42 58, 46 72',
  'M60 30 C 62 44, 58 56, 64 70',
  'M30 40 C 44 44, 58 40, 72 48',
];

/** Nodes sit ON the pathways, which is what makes the network read connected. */
const NODES: readonly (readonly [number, number, number])[] = [
  [34, 42, 1.6], [46, 31, 1.3], [61, 34, 1.8], [27, 55, 1.2],
  [45, 57, 2.0], [58, 55, 1.4], [37, 66, 1.5], [66, 62, 1.7],
  [52, 44, 1.1], [41, 49, 1.3], [63, 47, 1.2], [49, 70, 1.4],
];

export function RelayProjectBrainOrb({
  size = 132,
  reducedMotion = false,
  populated = true,
  className = '',
}: RelayProjectBrainOrbProps) {
  // Ids must be unique per instance: two Brains on one page would otherwise
  // share gradients, and the second would inherit the first's.
  const uid = useId().replace(/:/g, '');
  const glow = `rpb-glow-${uid}`;
  const surface = `rpb-surface-${uid}`;
  const plane = `rpb-plane-${uid}`;
  const specular = `rpb-specular-${uid}`;

  return (
    <svg
      className={`rpb-orb${reducedMotion ? '' : ' rpb-orb--live'}${populated ? '' : ' rpb-orb--sparse'} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={glow} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="var(--rpb-accent, #8f7cf0)" stopOpacity="0.55" />
          <stop offset="70%" stopColor="var(--rpb-accent, #8f7cf0)" stopOpacity="0.10" />
          <stop offset="100%" stopColor="var(--rpb-accent, #8f7cf0)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={surface} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#161a2e" />
          <stop offset="100%" stopColor="#080a15" />
        </linearGradient>
        <linearGradient id={plane} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--rpb-accent, #8f7cf0)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--rpb-accent, #8f7cf0)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--rpb-accent, #8f7cf0)" stopOpacity="0" />
        </linearGradient>
        {/* Off-centre, upper-left: the same light the surface gradient already
            implies. Deliberately weak — a bright highlight here would read as
            plastic, and this object sits over someone's work. */}
        <radialGradient id={specular} cx="32%" cy="22%" r="64%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="52%" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The light the object casts, drawn first so everything sits inside it. */}
      <circle cx="50" cy="46" r="34" fill={`url(#${glow})`} className="rpb-halo" />

      {/* THE TECHNOLOGICAL PLANE. Three receding lines and a soft band: enough
          depth for the brain to float above something, not a whole cityscape. */}
      <g className="rpb-plane" opacity="0.85">
        <rect x="14" y="83" width="72" height="0.7" fill={`url(#${plane})`} />
        <rect x="22" y="87" width="56" height="0.5" fill={`url(#${plane})`} opacity="0.7" />
        <rect x="30" y="90" width="40" height="0.4" fill={`url(#${plane})`} opacity="0.45" />
      </g>

      {/* THE BRAIN ITSELF — rotates as one body, so the pathways and nodes
          travel with the surface instead of sliding across it. */}
      <g className="rpb-body">
        <g className="rpb-mass">
          <ellipse cx="43" cy="46" rx="21" ry="19" fill={`url(#${surface})`} />
          <ellipse cx="60" cy="47" rx="17" ry="17" fill={`url(#${surface})`} />
          <path d="M47 63 L47 74 Q50 78 53 74 L53 62 Z" fill={`url(#${surface})`} />
          {/* The specular pass, over the fills and under the edge light, so the
              masses are lit before they are outlined. */}
          <ellipse cx="43" cy="46" rx="21" ry="19" fill={`url(#${specular})`} />
          <ellipse cx="60" cy="47" rx="17" ry="17" fill={`url(#${specular})`} />
          {/* Edge light: the accent reads as the object's own energy rather
              than a stroke drawn around it. */}
          <ellipse cx="43" cy="46" rx="21" ry="19" fill="none"
            stroke="var(--rpb-accent, #8f7cf0)" strokeOpacity="0.35" strokeWidth="0.6" />
          <ellipse cx="60" cy="47" rx="17" ry="17" fill="none"
            stroke="var(--rpb-accent, #8f7cf0)" strokeOpacity="0.3" strokeWidth="0.6" />
        </g>

        <g className="rpb-paths" fill="none" strokeLinecap="round">
          {PATHWAYS.map((d, i) => (
            <path
              key={d}
              d={d}
              stroke="var(--rpb-accent, #8f7cf0)"
              strokeOpacity={0.55}
              strokeWidth={0.8}
              className="rpb-path"
              style={{ animationDelay: `${String(i * 0.7)}s` }}
            />
          ))}
        </g>

        <g className="rpb-nodes">
          {NODES.map(([cx, cy, r], i) => (
            <circle
              key={`${String(cx)}-${String(cy)}`}
              cx={cx}
              cy={cy}
              r={r}
              fill="var(--rpb-accent, #8f7cf0)"
              className="rpb-node"
              style={{ animationDelay: `${String((i % 6) * 0.55)}s` }}
            />
          ))}
        </g>
      </g>
    </svg>
  );
}

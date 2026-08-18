/**
 * THE RELAY DOG'S PROGRESSION ACCENTS.
 *
 * Seven tiers, root through crown, expressed as CONTROLLED ACCENTS on an
 * otherwise unchanged animal: the eyes, the collar, the light it casts, and
 * the energy that joins it to the Project Brain. The bone-white body, the dark
 * visor and every pose are untouched, because the identity is the animal and
 * the tier is what it is carrying.
 *
 * WHAT THIS IS NOT, and this is the important part.
 *
 * Relay now has the STORE for its first progression source: the Wonderland
 * Coliseum XP ledger (`src/relay/mission/coliseum/duel-store.ts`), an
 * append-only per-agent record whose single writer is `concludeDuelAndAward`
 * (only a concluded, unmarked duel pays) — but this module is NOT wired to
 * it — nothing here reads
 * that ledger, and a tier here is still
 * a CHOSEN appearance, stored beside the colorway and the stage backdrop
 * because it is the same kind of fact: how this browser looks, to this user.
 *
 * It is emphatically not an earned rank, and no surface may present it as one.
 * That restraint is the whole reason this module exists as data rather than as
 * an engine: when a real progression system lands, it supplies the tier and
 * every accent follows, with no second scale to contradict it.
 *
 * `null` is a first-class answer meaning NO TIER HAS BEEN CHOSEN. It renders
 * the Dog exactly as it has always looked — gold — rather than defaulting to
 * root, because a default would be this module quietly asserting a level.
 */

export const CHAKRA_TIERS = [
  'root',
  'sacral',
  'solar_plexus',
  'heart',
  'throat',
  'third_eye',
  'crown',
] as const;

export type ChakraTier = (typeof CHAKRA_TIERS)[number];

export interface ChakraAccent {
  readonly tier: ChakraTier;
  /** Ordinal, 1-7. For ordering and for nothing else — it is not a score. */
  readonly step: number;
  readonly label: string;
  /** The collar, the edge light, the Brain's pathways. */
  readonly accent: string;
  /** The eyes and the brightest points of light. */
  readonly bright: string;
  /** The cast light and the column joining the Brain to the Dog. */
  readonly glow: string;
}

/**
 * Deep, jewel-weighted colour rather than the primary spectrum.
 *
 * The direction is explicit that the low tiers must not look cheap and the
 * whole thing must not read as a rainbow toy. A saturated red and orange at
 * the bottom would do exactly that, so root and sacral are garnet and burnt
 * amber — quieter than the gold above them, never poorer.
 *
 * SOLAR PLEXUS IS RELAY'S EXISTING GOLD, unchanged. The product already has an
 * identity at that colour; making the third tier something else would have
 * meant no tier looked like Relay.
 */
export const CHAKRA_ACCENTS: Readonly<Record<ChakraTier, ChakraAccent>> = Object.freeze({
  root: Object.freeze({
    tier: 'root', step: 1, label: 'ROOT',
    accent: '#b8515c', bright: '#d9707a', glow: 'rgba(184, 81, 92, 0.42)',
  }),
  sacral: Object.freeze({
    tier: 'sacral', step: 2, label: 'SACRAL',
    accent: '#c2763c', bright: '#e09456', glow: 'rgba(194, 118, 60, 0.40)',
  }),
  solar_plexus: Object.freeze({
    tier: 'solar_plexus', step: 3, label: 'SOLAR PLEXUS',
    accent: '#d9a441', bright: '#f2c14e', glow: 'rgba(217, 164, 65, 0.38)',
  }),
  heart: Object.freeze({
    tier: 'heart', step: 4, label: 'HEART',
    accent: '#4f9e72', bright: '#74c896', glow: 'rgba(79, 158, 114, 0.38)',
  }),
  throat: Object.freeze({
    tier: 'throat', step: 5, label: 'THROAT',
    accent: '#4287bb', bright: '#6fb3e0', glow: 'rgba(66, 135, 187, 0.40)',
  }),
  third_eye: Object.freeze({
    tier: 'third_eye', step: 6, label: 'THIRD EYE',
    accent: '#5f5ec4', bright: '#8b88ea', glow: 'rgba(95, 94, 196, 0.42)',
  }),
  crown: Object.freeze({
    tier: 'crown', step: 7, label: 'CROWN',
    accent: '#9068cf', bright: '#c0a0f2', glow: 'rgba(144, 104, 207, 0.44)',
  }),
});

/** The Dog's palette without any tier — Relay's gold, exactly as shipped. */
export const RELAY_DOG_DEFAULT_ACCENT = Object.freeze({
  accent: '#d9a441',
  bright: '#f2c14e',
  glow: 'rgba(217, 164, 65, 0.38)',
});

export function isChakraTier(value: unknown): value is ChakraTier {
  return typeof value === 'string' && (CHAKRA_TIERS as readonly string[]).includes(value);
}

/**
 * The accent for a tier, or the untiered default.
 *
 * Takes `unknown` deliberately: this is the boundary a persisted value crosses,
 * and an unrecognised tier — an older store, a forked build — resolves to the
 * default rather than to root, for the same reason `null` does.
 */
export function chakraAccent(tier: unknown): {
  readonly accent: string;
  readonly bright: string;
  readonly glow: string;
} {
  return isChakraTier(tier) ? CHAKRA_ACCENTS[tier] : RELAY_DOG_DEFAULT_ACCENT;
}

/**
 * The Dog's palette overrides for a tier: EYES AND COLLAR ONLY.
 *
 * The keys are the sprite's own palette letters, so this rides the documented
 * recolour seam instead of introducing a second palette. `w`, `s` and `d` — the
 * body, its shading, and the visor — are absent on purpose and must stay
 * absent: recolouring them is what would turn the animal into a flat colour
 * swatch, which the direction forbids in those words.
 */
export function chakraDogPalette(tier: unknown): { readonly y: string; readonly c: string } {
  const { accent, bright } = chakraAccent(tier);
  return { y: bright, c: accent };
}

/** Tier label for a surface that names it. Untiered says so rather than guessing. */
export function chakraLabel(tier: unknown): string {
  return isChakraTier(tier) ? CHAKRA_ACCENTS[tier].label : 'NO TIER';
}

/**
 * THE WONDERLAND USAGE METER — the swoosh in the top-left corner.
 *
 * The founder's direction, in their words: a Kingdom Hearts-inspired curved
 * meter with a swooping, almost Nike-swoosh-like wrapping silhouette; elegant
 * rather than bulky; part of Wonderland's visual language. And the meaning is
 * NOT a percentage: a higher tier increases the meter's PHYSICAL MAXIMUM
 * LENGTH, so a small bar and a long bar are two different amounts of capacity
 * rather than two renderings of the same 100%.
 *
 * THE ONE IDEA THIS FILE IS BUILT AROUND
 *
 * Absolute usage is drawn as absolute length. Capacity is drawn as absolute
 * length. So a viewer comparing two agents compares two pictures, not two
 * percentages of two different wholes:
 *
 *     tier with capacity 100, 50 used   ████░░░░░░░░
 *     tier with capacity 300, 50 used   ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 *
 * The filled part is the SAME LENGTH in both, because the same amount was
 * spent. That is what a percentage cannot say, and it is why `capacitySpan` and
 * `fillFraction` are separate fields rather than one number.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 *  - IT INVENTS NO BILLING. There is no tier→capacity table here and there must
 *    not be one. A tier is an opaque id, a label and a capacity SUPPLIED by an
 *    authority; this module transports and projects it. Relay has no
 *    subscription ledger, and a constant in a rendering module would be this
 *    file quietly becoming one — the same restraint `relay-chakra.ts` states
 *    about progression tiers, for the same reason.
 *
 *  - IT KEEPS NO SECOND ACCOUNT. Mission economics remains the per-mission cost
 *    authority. A locally applied delta is marked `local_projection` and drops
 *    the snapshot's provenance to simulated, so an optimistic client cannot
 *    show a projected balance as an observed one.
 *
 *  - IT DOES NOT DECIDE THE CURVE. The swoosh shapes are DATA: control points
 *    and a width profile. The whole point of the split is that a swoosh can be
 *    redrawn — thicker, longer, more hooked — without a single field of the
 *    meter changing. The browser samples them into an SVG path and Unreal
 *    samples them into a spline; both read these numbers, so the two surfaces
 *    cannot draw different meters.
 *
 * UNKNOWN IS NEVER ZERO. Every number is a `WonderlandFigure`, so an
 * unconfigured meter renders as Unknown rather than as an empty bar — an empty
 * bar is a claim that nothing has been used.
 *
 * PURE. No clock, no network, no React.
 */

import { PROVENANCES, type Provenance } from '../../protocol/enums';
import { RELAY_USAGE_STATUSES } from '../../usage/usage-contracts';
import type { RelayUsageStatus } from '../../usage/usage-contracts';
import { exactKeys, wonderlandFigure } from './wonderland-contracts';
import type { WonderlandFigure } from './wonderland-contracts';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_USAGE_SCHEMA_V1 = 'relay-wonderland-usage.v1' as const;
export type WonderlandUsageSchemaVersion = typeof WONDERLAND_USAGE_SCHEMA_V1;

/* --------------------------------------------------------------- anchor */

/**
 * WHERE THE HUD LIVES. Declared, because "top left" is a product decision.
 *
 * A renderer that placed it by convention would drift the moment two surfaces
 * had different conventions, and the founder named this corner specifically.
 * Other members exist so a later HUD element can state its own corner without
 * this becoming a boolean.
 */
export const WONDERLAND_HUD_ANCHORS = [
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
] as const;
export type WonderlandHudAnchor = (typeof WONDERLAND_HUD_ANCHORS)[number];

/** The usage meter's corner. The founder's direction, as data. */
export const WONDERLAND_USAGE_ANCHOR: WonderlandHudAnchor = 'top_left';

/* ----------------------------------------------------------- consumption */

/**
 * WHO SPENDS THE METER. Named now so the contract does not have to change when
 * they arrive, and honest that most of them have not.
 *
 * `julius_mission` is the only one Relay can currently attribute spend to.
 * `compound_agent` and `jhin_interaction` are declared because the founder
 * named them as future consumers, and a source that cannot be attributed is
 * `unattributed` rather than being folded into one that can — a mis-attributed
 * spend is worse than an unattributed one.
 */
export const WONDERLAND_USAGE_CONSUMERS = [
  'julius_mission',
  'compound_agent',
  'jhin_interaction',
  'unattributed',
] as const;
export type WonderlandUsageConsumer = (typeof WONDERLAND_USAGE_CONSUMERS)[number];

/** A drain spends capacity; a replenishment returns it. Nothing else moves it. */
export const WONDERLAND_USAGE_DELTA_KINDS = ['drain', 'replenish'] as const;
export type WonderlandUsageDeltaKind = (typeof WONDERLAND_USAGE_DELTA_KINDS)[number];

/**
 * Whether a delta came from the accounting authority or is a client's guess.
 *
 * The distinction is the whole safety of applying deltas at all: an optimistic
 * client may show its own spend immediately, and the moment it does the reading
 * stops being observed. `local_projection` says so in the data.
 */
export const WONDERLAND_USAGE_DELTA_SOURCES = ['authority', 'local_projection'] as const;
export type WonderlandUsageDeltaSource = (typeof WONDERLAND_USAGE_DELTA_SOURCES)[number];

export interface WonderlandUsageDelta {
  readonly kind: WonderlandUsageDeltaKind;
  /** Non-negative. A negative drain is a replenishment wearing a disguise. */
  readonly units: number;
  readonly consumer: WonderlandUsageConsumer;
  readonly source: WonderlandUsageDeltaSource;
  readonly atIso: string;
}

/* ---------------------------------------------------------------- status */

/**
 * The meter's status vocabulary is Relay's existing usage vocabulary, reused.
 *
 * `RELAY_USAGE_STATUSES` already means exactly this — available, limited,
 * blocked, updating, unavailable — and a second five-member list would be a
 * second opinion about the same fact. The C++ enum mirrors THIS array.
 */
export const WONDERLAND_USAGE_STATUSES = RELAY_USAGE_STATUSES;
export type WonderlandUsageStatus = RelayUsageStatus;

/* ----------------------------------------------------------- the meter */

/**
 * ONE READING OF ONE PLAYER'S CAPACITY.
 *
 * `capacityUnits` is the tier's own maximum. `referenceCapacityUnits` is the
 * largest capacity the HUD is designed to draw at full arc — supplied by the
 * caller from whatever tier catalogue the authority publishes, never guessed
 * here — and the ratio between them is how a tier changes the meter's physical
 * length rather than only its percentage.
 *
 * `unitLabel` exists because Relay does not know what a unit IS yet. Tokens,
 * dollars, missions and "wonder" are all plausible and the authority decides;
 * a HUD that hard-coded one would have to be rewritten when it turned out to be
 * another, and a HUD that showed a bare number would be inviting a guess.
 */
export interface WonderlandUsageMeter {
  readonly schemaVersion: WonderlandUsageSchemaVersion;
  /** Which of the two bars this reading fills. Never inferred from a tier. */
  readonly channel: WonderlandUsageChannel;
  /** Opaque. Never parsed, never ranked, never mapped to a price here. */
  readonly tierId: string | null;
  readonly tierLabel: string | null;
  /** What one unit is called. Null until the authority says. */
  readonly unitLabel: string | null;
  readonly capacityUnits: WonderlandFigure;
  readonly usedUnits: WonderlandFigure;
  readonly remainingUnits: WonderlandFigure;
  /**
   * The tier ceiling this HUD draws a full arc for, IN THIS CHANNEL'S LADDER.
   *
   * Per channel, not per HUD. The two bars are different instruments with
   * different shapes and different tier ladders, and sharing one ceiling would
   * squash the smaller instrument into a stub of its own stroke — a single
   * agent on its top tier would draw a quarter of a bar because a Compound
   * Agent can buy more.
   */
  readonly referenceCapacityUnits: WonderlandFigure;
  /** capacity / reference, clamped to 0..1. The meter's PHYSICAL LENGTH. */
  readonly capacitySpan: WonderlandFigure;
  /** used / capacity, clamped to 0..1. How much of that length is SPENT. */
  readonly fillFraction: WonderlandFigure;
  /**
   * remaining / capacity, clamped to 0..1. How much is LEFT — and this is the
   * one a renderer draws.
   *
   * BOTH EXIST BECAUSE A METER THAT DRAINS AND A NUMBER THAT COUNTS DOWN HAVE
   * TO AGREE. Drawing `fillFraction` while printing what is left produced an
   * untouched meter reading "480 / 480" beside an empty bar: the picture was
   * measuring spend and the words were measuring remainder, and each was
   * correct on its own. A usage meter drains, so the stroke is the remainder
   * and the readout is the remainder.
   *
   * `fillFraction` stays, because "how much has been spent" is a real question
   * and deriving it from its complement at three call sites is how the two
   * drift apart again.
   */
  readonly remainingFraction: WonderlandFigure;
  readonly status: WonderlandUsageStatus;
  /** A sentence whenever the meter cannot show a real reading. */
  readonly unavailableReason: string | null;
  readonly provenance: Provenance;
  /** True whenever provenance is not `live`. The label travels with the data. */
  readonly simulated: boolean;
  readonly anchor: WonderlandHudAnchor;
  readonly observedAtIso: string;
}

export const WONDERLAND_USAGE_METER_FIELDS = exactKeys<WonderlandUsageMeter>()([
  'schemaVersion',
  'channel',
  'tierId',
  'tierLabel',
  'unitLabel',
  'capacityUnits',
  'usedUnits',
  'remainingUnits',
  'referenceCapacityUnits',
  'capacitySpan',
  'fillFraction',
  'remainingFraction',
  'status',
  'unavailableReason',
  'provenance',
  'simulated',
  'anchor',
  'observedAtIso',
] as const);

/* ------------------------------------------------------------ the shape */

/**
 * THE SWOOSH, AS DATA — a poly-Bézier spine plus a width profile.
 *
 * ONE CUBIC WAS NOT ENOUGH, and the reason is the shape the direction asks
 * for. The Compound frame wraps most of the way around a corner ornament
 * before flying out; a single cubic cannot turn 250 degrees without cusping.
 * So a shape is a start point and a list of cubic segments, which is exactly
 * what an SVG path and an Unreal spline both already are.
 *
 * THE PARAMETER IS ARC LENGTH, NOT BÉZIER `t`, and that is load-bearing rather
 * than a refinement. Bézier `t` runs fast through gentle stretches and slow
 * through tight ones, so a meter drawn on raw `t` would show a different amount
 * of stroke for the same spend depending on WHERE on the curve it happened to
 * be — and this meter's entire thesis is that spend is drawn as length. The
 * sampler therefore builds a length table and inverts it, so `0.5` is half the
 * stroke, everywhere, on both surfaces.
 *
 * THE WIDTH HOLDS AND THEN TAPERS. A profile that tapered from the first pixel
 * would make the frame look like it was already draining; the reference's ring
 * is near-constant and only the tail comes to a point. `taperStart` is where
 * the fall begins.
 *
 * The numbers below are a FIRST VISUAL and are expected to change. That is why
 * they are here and not inside a renderer: every consumer samples this struct,
 * so a redraw is editing these values once, and no field of
 * `WonderlandUsageMeter` moves when it happens.
 */
export interface WonderlandSwooshSegment {
  readonly control1X: number;
  readonly control1Y: number;
  readonly control2X: number;
  readonly control2Y: number;
  readonly endX: number;
  readonly endY: number;
}

export const WONDERLAND_SWOOSH_SEGMENT_FIELDS = exactKeys<WonderlandSwooshSegment>()([
  'control1X',
  'control1Y',
  'control2X',
  'control2Y',
  'endX',
  'endY',
] as const);

export interface WonderlandUsageSwoosh {
  /** Spine start, in unit-box coordinates. */
  readonly startX: number;
  readonly startY: number;
  /** Cubic segments, head to tail. Never empty. */
  readonly segments: readonly WonderlandSwooshSegment[];
  /** Ribbon half-width before the taper begins. */
  readonly tailWidth: number;
  /** Ribbon half-width at the very tip. Near zero is a point, which is intended. */
  readonly tipWidth: number;
  /** Arc fraction at which the width starts falling. 0 tapers from the start. */
  readonly taperStart: number;
  /** How sharply the width falls after `taperStart`. 1 is linear. */
  readonly taperExponent: number;
}

export const WONDERLAND_USAGE_SWOOSH_FIELDS = exactKeys<WonderlandUsageSwoosh>()([
  'startX',
  'startY',
  'segments',
  'tailWidth',
  'tipWidth',
  'taperStart',
  'taperExponent',
] as const);

/* ------------------------------------------------------------- channels */

/**
 * TWO BARS, TWO SUBJECTS, AND THEY ARE NOT THE SAME NUMBER.
 *
 * A single agent and a Compound Agent consume different things and are bought
 * on different terms, so one meter showing their sum would be a bar a founder
 * could not act on: they would see it fall and not know which capability had
 * shrunk. Two channels, bound separately, all the way down.
 *
 * The Compound channel is the DOMINANT frame — the broader capacity, the longer
 * sweep, the one that reads first. That is a hierarchy, not a decoration: a
 * Compound Agent is the more powerful thing, and a HUD that drew the two at
 * equal weight would be saying they cost the same.
 */
export const WONDERLAND_USAGE_CHANNELS = ['compound_agent', 'single_agent'] as const;
export type WonderlandUsageChannel = (typeof WONDERLAND_USAGE_CHANNELS)[number];

/**
 * THE PALETTE AND THE ORDER, AS DATA RATHER THAN AS CSS.
 *
 * Both surfaces read these values. A colour that lived only in a stylesheet
 * would be a colour Unreal had to guess at, and the two HUDs would drift apart
 * the first time either was retouched — the same failure the dog's animation
 * table exists to prevent.
 *
 * Green for the Compound Agent and blue for the single agent are the founder's
 * direction. The hues are Wonderland's own — enchanted rather than arcade, so
 * the green is a jewelled aurora rather than the reference's primary — and they
 * are expected to be tuned. The CONTRACT is which channel owns which hue.
 */
export interface WonderlandUsageChannelStyle {
  readonly channel: WonderlandUsageChannel;
  readonly label: string;
  /** The filled stroke. */
  readonly accent: string;
  /** The leading edge, brightest where the fill ends. */
  readonly bright: string;
  /** The light the meter casts into the HUD. */
  readonly glow: string;
  /** The unspent remainder of the frame. Never the same value as `accent`. */
  readonly track: string;
  /** 0 is the dominant frame. Lower draws later, and on top. */
  readonly emphasis: number;
}

export const WONDERLAND_USAGE_CHANNEL_STYLE_FIELDS =
  exactKeys<WonderlandUsageChannelStyle>()([
    'channel',
    'label',
    'accent',
    'bright',
    'glow',
    'track',
    'emphasis',
  ] as const);

export const WONDERLAND_USAGE_CHANNEL_STYLE: Readonly<
  Record<WonderlandUsageChannel, WonderlandUsageChannelStyle>
> = Object.freeze({
  compound_agent: Object.freeze({
    channel: 'compound_agent' as WonderlandUsageChannel,
    label: 'COMPOUND AGENT',
    accent: '#3fd6a0',
    bright: '#b7ffe4',
    glow: 'rgba(63, 214, 160, 0.45)',
    track: 'rgba(63, 214, 160, 0.14)',
    emphasis: 0,
  }),
  single_agent: Object.freeze({
    channel: 'single_agent' as WonderlandUsageChannel,
    label: 'SINGLE AGENT',
    accent: '#54a8ff',
    bright: '#c4e4ff',
    glow: 'rgba(84, 168, 255, 0.40)',
    track: 'rgba(84, 168, 255, 0.13)',
    emphasis: 1,
  }),
});

/**
 * THE COMPOUND FRAME: the long swoop, and it faces RIGHT.
 *
 * PERMANENT. The founder has settled this shape and declared it the health bar
 * until they say otherwise. Do not redesign it, do not "improve" the curve, and
 * do not re-derive it from any reference image — `wonderland-hud-canon.test.ts`
 * pins every control point by digest and will fail on a nudge of 0.0004.
 *
 * The direction is explicit and it is a REVERSAL of the reference that inspired
 * it. There, the long green ring wraps a portrait at the right-hand end of the
 * HUD and its gap opens toward the LEFT, back into the bars. Mirrored for
 * Wonderland, the ring sits in the anchored top-left corner, its gap opens to
 * the RIGHT, and the stroke leaves the ring travelling right across the top —
 * which is also why it belongs in this corner at all: the ornament is the
 * anchor and the bars grow away from it.
 *
 * The spine is a 255-degree arc in three cubic segments plus a tail. The gap is
 * on the right, so the aperture faces right, and the tail ends further right
 * than anything else in the shape. Both facts are asserted in the test by
 * MEASURING the spine, because a mirrored curve is the single easiest thing to
 * get backwards and the easiest not to notice.
 */
export const WONDERLAND_COMPOUND_SWOOSH: WonderlandUsageSwoosh = Object.freeze({
  startX: 0.4675,
  startY: 0.7107,
  segments: Object.freeze([
    Object.freeze({
      control1X: 0.3906, control1Y: 0.7831,
      control2X: 0.2821, control2Y: 0.7955,
      endX: 0.1937, endY: 0.7421,
    }),
    Object.freeze({
      control1X: 0.1054, control1Y: 0.6886,
      control2X: 0.0550, control2Y: 0.5800,
      endX: 0.0667, endY: 0.4681,
    }),
    Object.freeze({
      control1X: 0.0783, control1Y: 0.3562,
      control2X: 0.1496, control2Y: 0.2635,
      endX: 0.2466, endY: 0.2344,
    }),
    /**
     * The tail, leaving the ring TANGENTIALLY.
     *
     * Its first control point is the ring's own exit direction extended, which
     * is the whole reason the arc stops at 255 degrees rather than carrying on
     * around: past the top the ring is already heading down, so a tail that
     * then rose to the right folded back over itself and put a visible crease
     * in the stroke. A crease is not a flourish — it is the seam of two curves
     * that were never joined.
     */
    Object.freeze({
      control1X: 0.4764, control1Y: 0.1652,
      control2X: 0.7500, control2Y: 0.1150,
      endX: 0.9550, endY: 0.1050,
    }),
  ]),
  // SLENDER, and that is the direction rather than a preference. "Elegant
  // rather than bulky" rules out an arcade-weight ring: at a radius of a
  // quarter of the box, a half-width past about 0.035 stops reading as a drawn
  // stroke and starts reading as a filled shape.
  tailWidth: 0.030,
  tipWidth: 0.004,
  taperStart: 0.80,
  taperExponent: 1.5,
});

/**
 * THE SINGLE-AGENT STROKE: the same swoop, nested INSIDE the frame.
 *
 * PERMANENT, on the same terms as the frame above.
 *
 * It swoops, and the founder's direction is that it must: a straight bar beside
 * a curved frame reads as two widgets that happened to be placed together. This
 * is one drawing. So the blue is a CONCENTRIC inner hook — the same centre, the
 * same span, the same tangential tail — at about six tenths of the radius, and
 * it runs inside the green the whole way out.
 *
 * WHY CONCENTRIC AND NOT CROSSING, which is the choice that was tried both ways.
 * An earlier draft ran the blue UNDER the green so the frame occluded it at two
 * crossings. It looked better in a still and it broke the instrument: the frame
 * covered the first third of the blue spine, so every single-agent reading below
 * about a third had its entire fill hidden and drew identically to empty —
 * exactly the range where "you are nearly out" has to be legible. Nested arcs
 * never cross, so nothing is ever hidden, and a viewer never has to work out
 * which arc belongs to which number. The canon test measures the overlap and
 * holds it at zero.
 *
 * "Simpler" survives the change, as weight rather than as shape: thinner, a
 * shorter tail that stops well short of the frame's tip, and a width that
 * barely tapers where the frame's comes to a point. That is what keeps the
 * hierarchy legible without a label — the same gesture, quieter.
 */
export const WONDERLAND_SINGLE_SWOOSH: WonderlandUsageSwoosh = Object.freeze({
  startX: 0.4077,
  startY: 0.6318,
  segments: Object.freeze([
    Object.freeze({
      control1X: 0.3600, control1Y: 0.6771,
      control2X: 0.2927, control2Y: 0.6848,
      endX: 0.2379, endY: 0.6514,
    }),
    Object.freeze({
      control1X: 0.1830, control1Y: 0.6179,
      control2X: 0.1518, control2Y: 0.5500,
      endX: 0.1590, endY: 0.4800,
    }),
    Object.freeze({
      control1X: 0.1663, control1Y: 0.4100,
      control2X: 0.2105, control2Y: 0.3521,
      endX: 0.2707, endY: 0.3339,
    }),
    // The tail, leaving tangentially exactly as the frame's does, and stopping
    // short of it so the frame keeps the last word.
    Object.freeze({
      control1X: 0.4621, control1Y: 0.2758,
      control2X: 0.6800, control2Y: 0.3000,
      endX: 0.8600, endY: 0.3500,
    }),
  ]),
  // Half the frame's weight. The hierarchy has to survive the fact that this
  // stroke is often the FULLER of the two — a single agent on a small tier runs
  // out sooner — and a bright arc at equal thickness would read as the louder
  // instrument precisely when it is the smaller one.
  tailWidth: 0.0145,
  tipWidth: 0.0110,
  taperStart: 0.70,
  taperExponent: 1.0,
});

/** Which spine each channel is drawn on. Total, so a channel cannot be shapeless. */
export const WONDERLAND_USAGE_CHANNEL_SWOOSH: Readonly<
  Record<WonderlandUsageChannel, WonderlandUsageSwoosh>
> = Object.freeze({
  compound_agent: WONDERLAND_COMPOUND_SWOOSH,
  single_agent: WONDERLAND_SINGLE_SWOOSH,
});

/* ------------------------------------------------------------- viewport */

/**
 * THE WINDOW ONTO THE UNIT BOX, so the HUD is WIDE rather than square.
 *
 * The shapes live in a 0..1 box in both axes — that is what lets the browser and
 * Unreal agree about a point without also agreeing about a widget's size. But
 * the composition is a ring with a tail beside it, which occupies the full width
 * and a band of the height, and rendering the whole square would put a third of
 * the HUD's height into empty space above and below the drawing.
 *
 * So the viewport is part of the CONTRACT rather than a number each renderer
 * picks. Both surfaces crop identically, and a redrawn shape that needs more
 * room changes this once. It is a WINDOW and not a scale: the aspect is
 * preserved, so nothing is squashed, and a stroke's thickness means the same
 * thing in both axes.
 */
export interface WonderlandUsageViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const WONDERLAND_USAGE_VIEWPORT_FIELDS = exactKeys<WonderlandUsageViewport>()([
  'x',
  'y',
  'width',
  'height',
] as const);

export const WONDERLAND_USAGE_VIEWPORT: WonderlandUsageViewport = Object.freeze({
  x: 0,
  // Framed from the MEASURED extent of the two strokes, half-widths included,
  // rather than chosen by eye: they occupy y 0.101..0.805, so this leaves a
  // little under two points of air at each edge and clips no stroke anywhere.
  y: 0.06,
  width: 1,
  height: 0.88,
});


/* ------------------------------------------------------------- sampling */

export interface WonderlandSwooshSample {
  /** Arc-length fraction, 0 at the tail and 1 at the tip. */
  readonly t: number;
  readonly x: number;
  readonly y: number;
  /** Unit tangent, so a renderer can offset along the normal without redoing it. */
  readonly tangentX: number;
  readonly tangentY: number;
  readonly halfWidth: number;
}

/**
 * The sample's shape is mirrored into `FWonderlandSwooshSample` so the Unreal
 * renderer walks the SAME curve this module describes rather than a re-drawn
 * approximation of it. `WonderlandUsageGeometry.golden.tsv` is generated from
 * `wonderlandSwooshAt` and the C++ sampler is diffed against it numerically, so
 * a divergence in either direction is a build failure, not a visual one.
 */
export const WONDERLAND_SWOOSH_SAMPLE_FIELDS = exactKeys<WonderlandSwooshSample>()([
  't',
  'x',
  'y',
  'tangentX',
  'tangentY',
  'halfWidth',
] as const);

const cubic = (t: number, a: number, b: number, c: number, d: number): number => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

const cubicDerivative = (t: number, a: number, b: number, c: number, d: number): number => {
  const u = 1 - t;
  return 3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c);
};

/** t clamped into the curve's domain. A bad parameter draws an end, not NaN. */
const clamp01 = (value: number): number =>
  !Number.isFinite(value) ? 0 : value < 0 ? 0 : value > 1 ? 1 : value;

interface SegmentPoints {
  readonly x0: number; readonly y0: number;
  readonly x1: number; readonly y1: number;
  readonly x2: number; readonly y2: number;
  readonly x3: number; readonly y3: number;
}

/** The segments as explicit four-point cubics, head to tail. */
function segmentPoints(shape: WonderlandUsageSwoosh): readonly SegmentPoints[] {
  const points: SegmentPoints[] = [];
  let x0 = shape.startX;
  let y0 = shape.startY;
  for (const segment of shape.segments) {
    points.push({
      x0, y0,
      x1: segment.control1X, y1: segment.control1Y,
      x2: segment.control2X, y2: segment.control2Y,
      x3: segment.endX, y3: segment.endY,
    });
    x0 = segment.endX;
    y0 = segment.endY;
  }
  return points;
}

/**
 * Samples per segment for the length table.
 *
 * Fixed rather than adaptive so the table is DETERMINISTIC: two surfaces
 * sampling the same shape must land on the same point for the same fraction,
 * and an adaptive subdivision that depended on floating-point comparisons
 * would not guarantee that across two languages.
 */
const ARC_TABLE_RESOLUTION = 64;

interface ArcTable {
  readonly segment: readonly number[];
  readonly local: readonly number[];
  readonly cumulative: readonly number[];
  readonly total: number;
}

function arcTable(shape: WonderlandUsageSwoosh): ArcTable {
  const segments = segmentPoints(shape);
  const segment: number[] = [];
  const local: number[] = [];
  const cumulative: number[] = [];
  let length = 0;
  let previousX = shape.startX;
  let previousY = shape.startY;
  segment.push(0);
  local.push(0);
  cumulative.push(0);
  segments.forEach((points, index) => {
    for (let step = 1; step <= ARC_TABLE_RESOLUTION; step += 1) {
      const t = step / ARC_TABLE_RESOLUTION;
      const x = cubic(t, points.x0, points.x1, points.x2, points.x3);
      const y = cubic(t, points.y0, points.y1, points.y2, points.y3);
      length += Math.hypot(x - previousX, y - previousY);
      previousX = x;
      previousY = y;
      segment.push(index);
      local.push(t);
      cumulative.push(length);
    }
  });
  return { segment, local, cumulative, total: length };
}

/** The half-width at an arc fraction: held, then tapered. */
function halfWidthAt(shape: WonderlandUsageSwoosh, t: number): number {
  const held = clamp01(shape.taperStart);
  if (t <= held) return shape.tailWidth;
  const span = 1 - held;
  const progress = span <= 0 ? 1 : (t - held) / span;
  const remaining = Math.pow(1 - progress, Math.max(shape.taperExponent, 0));
  return shape.tipWidth + (shape.tailWidth - shape.tipWidth) * remaining;
}

/**
 * One point on the spine at an ARC-LENGTH fraction, with tangent and width.
 *
 * The table is rebuilt per call rather than memoised. A cache keyed on a shape
 * object would be a mutable module-level map in a module whose whole claim is
 * that it is pure, and the table is 64 samples per segment — cheaper than the
 * bug that cache would eventually be.
 */
export function wonderlandSwooshAt(
  t: number,
  shape: WonderlandUsageSwoosh = WONDERLAND_COMPOUND_SWOOSH,
): WonderlandSwooshSample {
  const clamped = clamp01(t);
  const segments = segmentPoints(shape);
  const table = arcTable(shape);
  const target = table.total * clamped;

  // Find the table interval containing the target length.
  let index = 1;
  while (index < table.cumulative.length - 1 && table.cumulative[index] < target) index += 1;
  const lower = table.cumulative[index - 1];
  const upper = table.cumulative[index];
  const span = upper - lower;
  const withinInterval = span <= 0 ? 0 : (target - lower) / span;

  const segmentIndex = table.segment[index];
  const localLower = table.segment[index - 1] === segmentIndex ? table.local[index - 1] : 0;
  const localUpper = table.local[index];
  const local = localLower + (localUpper - localLower) * withinInterval;
  const points = segments[segmentIndex] ?? segments[segments.length - 1];

  const dx = cubicDerivative(local, points.x0, points.x1, points.x2, points.x3);
  const dy = cubicDerivative(local, points.y0, points.y1, points.y2, points.y3);
  // A zero-length tangent is possible when control points coincide. Falling back
  // to +x keeps the ribbon drawable rather than producing NaN normals.
  const length = Math.hypot(dx, dy);
  const safeLength = length === 0 ? 1 : length;

  return {
    t: clamped,
    x: cubic(local, points.x0, points.x1, points.x2, points.x3),
    y: cubic(local, points.y0, points.y1, points.y2, points.y3),
    tangentX: (length === 0 ? 1 : dx) / safeLength,
    tangentY: (length === 0 ? 0 : dy) / safeLength,
    halfWidth: halfWidthAt(shape, clamped),
  };
}

export interface WonderlandSwooshPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The closed ribbon outline between two arc fractions, as points.
 *
 * `from`/`to` are what makes the FILLED portion drawable with the same
 * function as the whole: the track is `outline(0, capacitySpan)` and the fill
 * is `outline(0, capacitySpan * fillFraction)`. One curve, two extents, so the
 * fill can never diverge from the track it sits in.
 */
export function wonderlandSwooshOutline(input: {
  readonly from?: number;
  readonly to: number;
  readonly samples?: number;
  readonly shape?: WonderlandUsageSwoosh;
}): readonly WonderlandSwooshPoint[] {
  const from = clamp01(input.from ?? 0);
  const to = clamp01(input.to);
  const samples = Math.max(2, Math.min(Math.trunc(input.samples ?? 48), 512));
  if (to <= from) return Object.freeze([]);

  const upper: WonderlandSwooshPoint[] = [];
  const lower: WonderlandSwooshPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = from + ((to - from) * i) / (samples - 1);
    const sample = wonderlandSwooshAt(t, input.shape);
    // Normal is the tangent rotated a quarter turn.
    const nx = -sample.tangentY;
    const ny = sample.tangentX;
    upper.push({ x: sample.x + nx * sample.halfWidth, y: sample.y + ny * sample.halfWidth });
    lower.push({ x: sample.x - nx * sample.halfWidth, y: sample.y - ny * sample.halfWidth });
  }
  return Object.freeze([...upper, ...lower.reverse()]);
}

/**
 * The SPINE as an open SVG path — the centre line, with no width.
 *
 * A renderer that wants to reveal the ribbon PROGRESSIVELY needs a curve to
 * travel along, and the outline is a closed loop that goes out and comes back.
 * Stroking this line inside an SVG mask, with a dash pattern, reveals the
 * tapered ribbon along the arc without any script running per frame — which is
 * the whole reason it exists: the website has exactly one animation loop by
 * architectural rule, and it belongs to the world's scene.
 */
export function wonderlandSwooshSpineSvgPath(input: {
  readonly to?: number;
  readonly samples?: number;
  readonly shape?: WonderlandUsageSwoosh;
  readonly scale?: number;
  readonly precision?: number;
}): string {
  const to = clamp01(input.to ?? 1);
  const samples = Math.max(2, Math.min(Math.trunc(input.samples ?? 64), 512));
  const scale = Number.isFinite(input.scale) && input.scale !== undefined ? input.scale : 1;
  const precision = Math.max(0, Math.min(Math.trunc(input.precision ?? 3), 8));
  if (to <= 0) return '';
  const points: string[] = [];
  for (let i = 0; i < samples; i += 1) {
    const sample = wonderlandSwooshAt((to * i) / (samples - 1), input.shape);
    points.push(
      `${(sample.x * scale).toFixed(precision)} ${(sample.y * scale).toFixed(precision)}`,
    );
  }
  return `M ${points[0]} ${points.slice(1).map((point) => `L ${point}`).join(' ')}`;
}

/**
 * The same outline as an SVG path.
 *
 * A convenience for the browser and nothing more — it is a pure string built
 * from the points above, so an SVG surface and an Unreal spline are drawing the
 * identical geometry rather than two implementations of one description.
 */
export function wonderlandSwooshSvgPath(input: {
  readonly from?: number;
  readonly to: number;
  readonly samples?: number;
  readonly shape?: WonderlandUsageSwoosh;
  /** Multiplies the unit box. Defaults to 1, i.e. a 0..1 viewBox. */
  readonly scale?: number;
  readonly precision?: number;
}): string {
  const scale = Number.isFinite(input.scale) && input.scale !== undefined ? input.scale : 1;
  const precision = Math.max(0, Math.min(Math.trunc(input.precision ?? 3), 8));
  const points = wonderlandSwooshOutline(input);
  if (points.length === 0) return '';
  const at = (point: WonderlandSwooshPoint): string =>
    `${(point.x * scale).toFixed(precision)} ${(point.y * scale).toFixed(precision)}`;
  return `M ${at(points[0])} ${points.slice(1).map((p) => `L ${at(p)}`).join(' ')} Z`;
}

/* ------------------------------------------------------------ projection */

/**
 * What an authority reports. Every field nullable, because today nothing
 * reports any of them and a projection that required them would have to invent
 * them to run.
 */
export interface WonderlandUsageObservation {
  readonly channel: WonderlandUsageChannel;
  readonly tierId?: string | null;
  readonly tierLabel?: string | null;
  readonly unitLabel?: string | null;
  readonly capacityUnits?: number | null;
  readonly usedUnits?: number | null;
  /** The largest capacity the HUD draws at full arc. From the tier catalogue. */
  readonly referenceCapacityUnits?: number | null;
  readonly status?: WonderlandUsageStatus;
  readonly provenance: Provenance;
  readonly observedAtIso: string;
  /** Overrides the derived sentence. Used when the authority explains itself. */
  readonly unavailableReason?: string | null;
}

const figure = (value: number | null | undefined): WonderlandFigure =>
  value === null || value === undefined || !Number.isFinite(value)
    ? wonderlandFigure({ known: false, reason: 'not_observed' })
    : wonderlandFigure({ known: true, value });

const ratio = (numerator: number | null, denominator: number | null): WonderlandFigure => {
  if (numerator === null || denominator === null) {
    return wonderlandFigure({ known: false, reason: 'unknown_denominator' });
  }
  if (denominator <= 0) {
    // A zero ceiling is not a full meter and it is not an empty one. It is a
    // denominator nobody can divide by, and the figure says exactly that.
    return wonderlandFigure({ known: false, reason: 'unknown_denominator' });
  }
  const value = numerator / denominator;
  return wonderlandFigure({ known: true, value: value < 0 ? 0 : value > 1 ? 1 : value });
};

/** The sentence a meter with no reading carries. */
export const WONDERLAND_USAGE_UNAVAILABLE_REASON =
  'No usage authority has reported capacity for this world yet.';

/**
 * Project one observation into one meter.
 *
 * `remainingUnits` is DERIVED and only when both sides are known: a remaining
 * count computed from a missing capacity would be the exact substitution
 * `WonderlandFigure` exists to prevent.
 */
export function projectWonderlandUsageMeter(
  observation: WonderlandUsageObservation,
): WonderlandUsageMeter {
  const capacity =
    observation.capacityUnits === undefined || observation.capacityUnits === null
      ? null
      : Number.isFinite(observation.capacityUnits)
        ? observation.capacityUnits
        : null;
  const used =
    observation.usedUnits === undefined || observation.usedUnits === null
      ? null
      : Number.isFinite(observation.usedUnits)
        ? observation.usedUnits
        : null;
  const reference =
    observation.referenceCapacityUnits === undefined ||
    observation.referenceCapacityUnits === null
      ? null
      : Number.isFinite(observation.referenceCapacityUnits)
        ? observation.referenceCapacityUnits
        : null;

  const known = capacity !== null && used !== null;
  const status: WonderlandUsageStatus =
    observation.status ?? (known ? 'available' : 'unavailable');
  const unavailable = status === 'unavailable' || !known;

  return Object.freeze({
    schemaVersion: WONDERLAND_USAGE_SCHEMA_V1,
    channel: observation.channel,
    tierId: observation.tierId ?? null,
    tierLabel: observation.tierLabel ?? null,
    unitLabel: observation.unitLabel ?? null,
    capacityUnits: figure(capacity),
    usedUnits: figure(used),
    remainingUnits: figure(known ? Math.max(0, capacity - used) : null),
    referenceCapacityUnits: figure(reference),
    capacitySpan: ratio(capacity, reference),
    fillFraction: ratio(used, capacity),
    remainingFraction: ratio(known ? Math.max(0, capacity - used) : null, capacity),
    status,
    unavailableReason: unavailable
      ? (observation.unavailableReason ?? WONDERLAND_USAGE_UNAVAILABLE_REASON)
      : (observation.unavailableReason ?? null),
    provenance: observation.provenance,
    simulated: observation.provenance !== 'live',
    anchor: WONDERLAND_USAGE_ANCHOR,
    observedAtIso: observation.observedAtIso,
  });
}

/**
 * Apply a spend or a return to a meter.
 *
 * A `local_projection` delta DROPS the provenance to simulated, and that is not
 * a formality: the moment a client adds its own arithmetic to an authority's
 * number, what is on screen is no longer what the authority said. The
 * alternative — an optimistic update that still claims to be live — is how a
 * surface ends up showing a balance nothing agrees with.
 *
 * A delta on a meter with no known reading changes nothing. There is nothing to
 * subtract from, and subtracting from an assumed zero would invent the whole
 * account.
 */
export function applyWonderlandUsageDelta(
  meter: WonderlandUsageMeter,
  delta: WonderlandUsageDelta,
): WonderlandUsageMeter {
  if (!meter.usedUnits.known || !meter.capacityUnits.known) return meter;
  if (!Number.isFinite(delta.units) || delta.units < 0) return meter;

  const capacity = meter.capacityUnits.value as number;
  const signed = delta.kind === 'drain' ? delta.units : -delta.units;
  const used = Math.min(capacity, Math.max(0, (meter.usedUnits.value as number) + signed));
  const provenance: Provenance =
    delta.source === 'authority' ? meter.provenance : 'simulated';

  return Object.freeze({
    ...meter,
    usedUnits: figure(used),
    remainingUnits: figure(Math.max(0, capacity - used)),
    fillFraction: ratio(used, capacity),
    remainingFraction: ratio(Math.max(0, capacity - used), capacity),
    provenance,
    simulated: provenance !== 'live',
    observedAtIso: delta.atIso,
  });
}

/* ------------------------------------------------------------- the HUD */

/**
 * THE WHOLE TOP-LEFT HUD: both bars, one anchor, one observation instant.
 *
 * The two meters travel TOGETHER because they are read together — a founder
 * glancing at the corner is comparing them, and two independently-timestamped
 * readings would let the HUD show a Compound bar from one second and a single
 * bar from another while looking like one picture.
 *
 * `observedAtIso` is the HUD's own instant and it is deliberately not derived
 * from either meter: a HUD assembled from a fresh Compound reading and a stale
 * single reading is not fresh, and the caller is the only thing that knows.
 */
export interface WonderlandUsageHud {
  readonly schemaVersion: WonderlandUsageSchemaVersion;
  readonly anchor: WonderlandHudAnchor;
  /** The dominant frame: the long right-facing green swoop. */
  readonly compoundAgent: WonderlandUsageMeter;
  /** The simpler blue stroke nested inside it. */
  readonly singleAgent: WonderlandUsageMeter;
  readonly observedAtIso: string;
}

export const WONDERLAND_USAGE_HUD_FIELDS = exactKeys<WonderlandUsageHud>()([
  'schemaVersion',
  'anchor',
  'compoundAgent',
  'singleAgent',
  'observedAtIso',
] as const);

/**
 * Assemble the HUD from two readings.
 *
 * It REFUSES a meter whose channel does not match its slot rather than
 * re-labelling it: a compound reading rendered on the single-agent stroke would
 * be a number attached to the wrong capability, which is worse than no number,
 * and silently swapping them would hide the caller's bug forever.
 */
export function projectWonderlandUsageHud(input: {
  readonly compoundAgent: WonderlandUsageMeter;
  readonly singleAgent: WonderlandUsageMeter;
  readonly observedAtIso: string;
}): WonderlandUsageHud {
  if (input.compoundAgent.channel !== 'compound_agent') {
    throw new Error('wonderland_usage_hud_channel_mismatch:compound_agent');
  }
  if (input.singleAgent.channel !== 'single_agent') {
    throw new Error('wonderland_usage_hud_channel_mismatch:single_agent');
  }
  return Object.freeze({
    schemaVersion: WONDERLAND_USAGE_SCHEMA_V1,
    anchor: WONDERLAND_USAGE_ANCHOR,
    compoundAgent: input.compoundAgent,
    singleAgent: input.singleAgent,
    observedAtIso: input.observedAtIso,
  });
}

/* ------------------------------------------------------------- easing */

/**
 * SMOOTH DEPLETION AND FILL, as one shared function.
 *
 * A meter that jumps is a meter a viewer cannot read; a meter that eases tells
 * them something moved and roughly how much. Both surfaces need it, so it lives
 * here rather than in a CSS transition and an Unreal timeline that would ease
 * differently.
 *
 * IT IS PRESENTATION AND NOTHING ELSE. The eased value is never written back
 * into a meter, never sent anywhere, and never read as a usage figure: it is
 * the number to DRAW this frame while the real one has already changed. A
 * renderer that stored it would be keeping a third account.
 *
 * Smoothstep rather than linear, so the motion starts and settles rather than
 * arriving at full speed and stopping dead. `progress` outside 0..1 clamps —
 * a renderer handed a bad clock draws an endpoint, never an overshoot past a
 * full or empty bar.
 */
/**
 * How long a change takes, and on what curve. ONE declaration, both surfaces.
 *
 * `cssTimingFunction` is the nearest CSS cubic-bézier to the smoothstep below —
 * nearest, not identical, because CSS parameterises by its own x and smoothstep
 * by time. The difference is under a percent of the travel and it is stated
 * here rather than left for someone to discover: a renderer that needs the two
 * to match EXACTLY must sample `wonderlandUsageEase` itself.
 */
export const WONDERLAND_USAGE_TRANSITION = Object.freeze({
  durationMs: 520,
  cssTimingFunction: 'cubic-bezier(0.5, 0, 0.5, 1)',
});

export function wonderlandUsageEase(from: number, to: number, progress: number): number {
  const a = Number.isFinite(from) ? from : 0;
  const b = Number.isFinite(to) ? to : a;
  const t = clamp01(progress);
  return a + (b - a) * t * t * (3 - 2 * t);
}

/* -------------------------------------------------------------- fixtures */

/**
 * A LABELLED FIXTURE, so the swoosh can be iterated visually before an
 * authority exists.
 *
 * `provenance: 'simulated'` is not decoration — `projectWonderlandUsageMeter`
 * sets `simulated: true` from it, and every surface that renders a meter must
 * pass that label to reach the numbers. Production navigation must never load
 * this; it exists so a designer can look at the shape.
 */
export const WONDERLAND_USAGE_FIXTURE_TIERS: readonly {
  readonly channel: WonderlandUsageChannel;
  readonly tierId: string;
  readonly tierLabel: string;
  readonly capacityUnits: number;
}[] = Object.freeze([
  Object.freeze({
    channel: 'compound_agent' as WonderlandUsageChannel,
    tierId: 'fixture-compound-small', tierLabel: 'FIXTURE · COMPOUND I', capacityUnits: 240,
  }),
  Object.freeze({
    channel: 'compound_agent' as WonderlandUsageChannel,
    tierId: 'fixture-compound-large', tierLabel: 'FIXTURE · COMPOUND III', capacityUnits: 480,
  }),
  Object.freeze({
    channel: 'single_agent' as WonderlandUsageChannel,
    tierId: 'fixture-single-small', tierLabel: 'FIXTURE · SINGLE I', capacityUnits: 60,
  }),
  Object.freeze({
    channel: 'single_agent' as WonderlandUsageChannel,
    tierId: 'fixture-single-large', tierLabel: 'FIXTURE · SINGLE II', capacityUnits: 120,
  }),
]);

/**
 * The ceiling each channel's fixtures draw against — the top of that channel's
 * own ladder, DERIVED from the tiers above rather than restated, so a fixture
 * tier added past the ceiling cannot silently draw past the end of its stroke.
 */
export const WONDERLAND_USAGE_FIXTURE_REFERENCE: Readonly<
  Record<WonderlandUsageChannel, number>
> = Object.freeze(
  Object.fromEntries(
    WONDERLAND_USAGE_CHANNELS.map((channel) => [
      channel,
      Math.max(
        ...WONDERLAND_USAGE_FIXTURE_TIERS.filter((tier) => tier.channel === channel).map(
          (tier) => tier.capacityUnits,
        ),
      ),
    ]),
  ) as Record<WonderlandUsageChannel, number>,
);

export function wonderlandUsageFixture(input: {
  readonly channel: WonderlandUsageChannel;
  readonly tierId: string;
  readonly usedUnits: number;
  readonly observedAtIso: string;
}): WonderlandUsageMeter {
  const tier = WONDERLAND_USAGE_FIXTURE_TIERS.find(
    (candidate) => candidate.tierId === input.tierId && candidate.channel === input.channel,
  );
  return projectWonderlandUsageMeter({
    channel: input.channel,
    tierId: tier?.tierId ?? null,
    tierLabel: tier?.tierLabel ?? null,
    unitLabel: tier === undefined ? null : 'WONDER',
    capacityUnits: tier?.capacityUnits ?? null,
    usedUnits: tier === undefined ? null : input.usedUnits,
    referenceCapacityUnits: WONDERLAND_USAGE_FIXTURE_REFERENCE[input.channel],
    provenance: 'simulated',
    observedAtIso: input.observedAtIso,
  });
}

/**
 * A whole labelled HUD, so the two bars can be looked at side by side before
 * any authority exists. Simulated, and the projection stamps it as such.
 */
export function wonderlandUsageHudFixture(observedAtIso: string): WonderlandUsageHud {
  return projectWonderlandUsageHud({
    compoundAgent: wonderlandUsageFixture({
      channel: 'compound_agent',
      tierId: 'fixture-compound-large',
      usedUnits: 186,
      observedAtIso,
    }),
    singleAgent: wonderlandUsageFixture({
      channel: 'single_agent',
      tierId: 'fixture-single-large',
      usedUnits: 78,
      observedAtIso,
    }),
    observedAtIso,
  });
}

/* --------------------------------------------------------------- parity */

/** Every provenance, re-exported so the C++ enum mirrors one list. */
export const WONDERLAND_USAGE_PROVENANCES = PROVENANCES;

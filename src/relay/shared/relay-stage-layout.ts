/**
 * THE RELAY STAGE — LAYOUT, AS A PURE PROJECTION.
 *
 * WHAT THIS REPLACES, MEASURED RATHER THAN REMEMBERED. The Relay Dog lived in
 * `.rdm`: `width: 100%`, `overflow-x: hidden` — a full-width horizontal band —
 * with its scenery in `.rdo`, a FIXED `128px × 90px` box anchored top-left and
 * clipped. Ninety pixels of usable height, one occupant, and anything that left
 * the box was cut. There was no vertical room for a jump, no depth axis, and
 * nowhere to put a second actor. It read as a rectangle because it was one.
 *
 * The Stage owns SPACE and LAYERS. It does not own animation:
 * `RelayDogMotionBoundary` already owns patrol, facing and the activity
 * animation, is proven by four test files, and keeps that job. This module
 * decides only where an actor stands and how much room it has.
 *
 * PURE. No DOM, no clock, no random, no measurement — the host passes the
 * viewport it observed and gets back placements. That is what makes a stage
 * with a Leopard, three cubs and a vehicle testable without rendering one.
 *
 * TRUTHFULNESS RULES THIS FILE CARRIES.
 *
 * - **It never invents an actor.** An empty cast lays out as an empty stage,
 *   and the host says why. It does not helpfully add a Dog.
 * - **It never claims room it does not have.** `stageCapacity` answers in
 *   actor widths that actually fit at the current aspect. A cast that exceeds
 *   it is reported as overflowing rather than quietly overlapped — two sprites
 *   drawn on top of each other is a surface lying about how much is there.
 * - **Depth is not a z-index.** It moves an actor UP the ground plane and
 *   scales it down together, because those are one fact about distance. A
 *   surface that scaled without lifting would put a small dog in mid-air.
 */

/* --------------------------------------------------------------- layers */

/**
 * Back to front. Only `backdrop` clips.
 *
 * An actor mid-jump, mid-transformation, or trailing an effect must not be cut
 * by the thing that exists to give it room — which is exactly what the old
 * 128×90 `overflow: hidden` box did.
 */
export const RELAY_STAGE_LAYERS = [
  'backdrop',
  'far',
  'ground',
  'actors',
  'effects',
  'foreground',
] as const;
export type RelayStageLayer = (typeof RELAY_STAGE_LAYERS)[number];

/** The one layer that clips, and the reason it is the only one. */
export const CLIPPING_LAYERS: readonly RelayStageLayer[] = Object.freeze(['backdrop']);

export const layerClips = (layer: RelayStageLayer): boolean =>
  CLIPPING_LAYERS.includes(layer);

/* ---------------------------------------------------------------- shape */

/**
 * The stage grows with the page and always has vertical room. An aspect with a
 * floor, never a fixed height — the old band was 90px at every viewport, which
 * is why nothing could ever jump.
 */
export interface RelayStageShape {
  readonly aspectRatio: number;
  readonly minHeightRem: number;
}

export const RELAY_STAGE_WIDE: RelayStageShape = Object.freeze({
  aspectRatio: 16 / 5,
  minHeightRem: 14,
});

export const RELAY_STAGE_NARROW: RelayStageShape = Object.freeze({
  aspectRatio: 4 / 3,
  minHeightRem: 11,
});

/** The width below which the stage becomes portrait-ish. */
export const RELAY_STAGE_NARROW_BELOW_PX = 640;

/**
 * An UNKNOWN width resolves to the NARROW shape, and so do zero and negative.
 *
 * One policy for every input that is not a real wide viewport, because the
 * alternative — `NaN` falling through a `<` comparison to WIDE while `0` gives
 * NARROW — makes the unknown case take the branch with LESS vertical room.
 * A host that could not measure gets the taller stage, not the squeezed one.
 */
export function stageShapeFor(viewportWidthPx: number): RelayStageShape {
  if (!Number.isFinite(viewportWidthPx)) return RELAY_STAGE_NARROW;
  return viewportWidthPx < RELAY_STAGE_NARROW_BELOW_PX ? RELAY_STAGE_NARROW : RELAY_STAGE_WIDE;
}

/* ---------------------------------------------------------------- cast */

/**
 * One occupant of the stage.
 *
 * `width` is in DOG UNITS: the Relay Dog is 1, a wider Leopard is 2, a cub is
 * 0.6, a vehicle is whatever it is. Expressing it this way is what lets the
 * stage place a mixed cast without anyone computing pixels, and what makes
 * "does this fit?" a question with an answer.
 */
export interface RelayStageActor {
  readonly id: string;
  /** 0 = stage left edge, 1 = stage right edge. */
  readonly x: number;
  /** 0 = far (small, high on the ground plane), 1 = near (large, low). */
  readonly depth: number;
  /** Footprint in dog units. */
  readonly width: number;
  /**
   * How much of the stage this actor may MOVE ACROSS, in dog units. Defaults
   * to `width` — an actor that does not roam.
   *
   * Footprint and track are different facts. The Relay Dog occupies one dog
   * unit but patrols the whole stage, and its patrol engine measures its track
   * from its own box: give it a box the size of its sprite and it measures a
   * track of nearly zero and stops patrolling, with nothing failing anywhere.
   * Capacity is still counted in `width`, because two actors that PASS each
   * other do not need room for both tracks at once.
   */
  readonly track?: number;
  readonly layer: RelayStageLayer;
}

export interface RelayStagePlacement {
  readonly id: string;
  readonly layer: RelayStageLayer;
  /** Percentage of stage width, for `left`. */
  readonly leftPercent: number;
  /** Percentage of stage height, for `bottom`. Depth lifts an actor. */
  readonly bottomPercent: number;
  /** Multiplier on the actor's natural size. Depth shrinks it. */
  readonly scale: number;
  /** Painting order within a layer: nearer actors paint later. */
  readonly order: number;
  /**
   * Percentage of stage width the actor's BOX spans, from its track.
   *
   * An absolutely-positioned box with no width shrink-to-fits its content, so
   * a `width: 100%` child inside it resolves to the sprite's own width. This
   * is the number that stops that happening.
   */
  readonly widthPercent: number;
}

/** Where the ground meets the backdrop, as a fraction of stage height. */
export const GROUND_HORIZON = 0.62;
/** How much smaller the farthest actor is than the nearest. */
export const FAR_SCALE = 0.55;

/**
 * Only NaN — a value with no position on the line — falls back to 0. Infinity
 * clamps to 1 like any other over-large number, because mapping the maximum to
 * the minimum would put an actor declared "as near as possible" at the far
 * horizon, which is a silent inversion rather than a clamp.
 */
const clamp01 = (value: number): number => (
  Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value))
);

/** Dog units, to two places. `3.8000000000000003` is not a cast description. */
const roundUnits = (value: number): number => Math.round(value * 100) / 100;

/** A footprint or track in dog units: finite and non-negative, or nothing. */
const sanitiseUnits = (value: number | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
);

/**
 * Depth → scale and height, together.
 *
 * They move as one because they are one fact. An actor twice as far away is
 * both smaller AND standing higher up the ground plane; a surface that applied
 * only the first would put a small dog floating in mid-air, which is the
 * commonest way a flat stage betrays that it has no depth model at all.
 */
export function placeActor(actor: RelayStageActor, capacity: number): RelayStagePlacement {
  const depth = clamp01(actor.depth);
  const scale = FAR_SCALE + (1 - FAR_SCALE) * depth;
  // depth 1 (near) sits ON the ground line; depth 0 (far) sits at the horizon.
  const bottomPercent = (GROUND_HORIZON - depth * GROUND_HORIZON) * 100;

  // Track defaults to footprint; footprint defaults to one dog. An actor may
  // not roam wider than the stage.
  const footprint = sanitiseUnits(actor.width) ?? 1;
  const track = sanitiseUnits(actor.track) ?? footprint;
  const usableCapacity = Number.isFinite(capacity) && capacity > 0 ? capacity : 1;
  const widthPercent = Math.min(100, (track / usableCapacity) * 100);

  return {
    id: actor.id,
    layer: actor.layer,
    leftPercent: clamp01(actor.x) * 100,
    bottomPercent,
    scale,
    order: Math.round(depth * 1000),
    widthPercent,
  };
}

/**
 * How many dog-widths fit, at this shape.
 *
 * Answered rather than assumed, because the honest response to "can the Leopard
 * bring three cubs?" is a number. A stage that silently overlapped them would
 * be claiming space it does not have.
 */
export function stageCapacity(shape: RelayStageShape): number {
  // A dog occupies roughly a sixth of the wide stage's width at depth 1.
  const dogWidthFraction = 1 / 6;
  return Math.max(1, Math.floor((shape.aspectRatio / RELAY_STAGE_WIDE.aspectRatio) / dogWidthFraction));
}

export interface RelayStageLayout {
  readonly shape: RelayStageShape;
  readonly placements: readonly RelayStagePlacement[];
  /**
   * Total footprint requested, in dog units, ROUNDED TO TWO PLACES for display.
   * `overflowing` is decided from the unrounded sum, so a cast that exceeds the
   * stage by less than the rounding step is still reported as overflowing.
   */
  readonly requestedWidth: number;
  readonly capacity: number;
  /** True when the cast asks for more room than the stage has. */
  readonly overflowing: boolean;
  /** Present only when the stage is empty, and says WHY rather than nothing. */
  readonly emptyReason: string | null;
}

export function layoutStage(input: {
  readonly actors: readonly RelayStageActor[];
  readonly viewportWidthPx: number;
  readonly emptyReason?: string;
}): RelayStageLayout {
  const shape = stageShapeFor(input.viewportWidthPx);
  const capacity = stageCapacity(shape);
  // The SUM AS MEASURED decides whether the cast fits; the ROUNDED sum is what
  // a surface prints. They are separate because 2 + 0.6 + 0.6 + 0.6 is
  // 3.8000000000000003 in binary floating point — a stage reporting that has
  // stopped describing its cast and started describing IEEE 754 — but rounding
  // BEFORE the comparison would let a cast overflowing by less than half a
  // hundredth of a dog-width be reported as fitting.
  const measuredWidth = input.actors.reduce(
    (total, actor) => total + (sanitiseUnits(actor.width) ?? 0),
    0,
  );
  const requestedWidth = roundUnits(measuredWidth);
  const placements = [...input.actors]
    .map((actor) => placeActor(actor, capacity))
    // Nearer actors paint later, so a cub in front of the Leopard is in front.
    .sort((a, b) => a.order - b.order);

  return {
    shape,
    placements,
    requestedWidth,
    capacity,
    overflowing: measuredWidth > capacity,
    emptyReason: input.actors.length === 0
      ? (input.emptyReason ?? 'No Relay agent is on stage.')
      : null,
  };
}

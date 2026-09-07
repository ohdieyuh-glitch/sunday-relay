import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_COMPOUND_SWOOSH,
  WONDERLAND_SINGLE_SWOOSH,
  WONDERLAND_USAGE_ANCHOR,
  WONDERLAND_USAGE_CHANNELS,
  WONDERLAND_USAGE_CHANNEL_STYLE,
  WONDERLAND_USAGE_VIEWPORT,
  projectWonderlandUsageHud,
  projectWonderlandUsageMeter,
  wonderlandSwooshAt,
} from './wonderland-usage-meter';
import type { WonderlandUsageChannel, WonderlandUsageSwoosh } from './wonderland-usage-meter';

/**
 * THE HUD IS CANON. THIS FILE IS THE LOCK.
 *
 * The two-meter usage HUD on this branch — the green Compound ring with its
 * aperture facing right and its tail swooping down-right, the blue single-agent
 * stroke crossing behind it and sweeping out — is FOUNDER-APPROVED and frozen.
 * It took several rounds to arrive at, and every round that went backwards did
 * so by degrees: a curve mirrored in x but not in y, a bar flattened until it
 * read as straight, a stroke moved beside the frame instead of behind it. None
 * of those looked like a redesign while it was happening.
 *
 * SO THE GEOMETRY IS PINNED BY DIGEST, not by description. A prose comment
 * saying "do not change this" is advice; a digest over the actual control
 * points is a build failure. Nothing here stops a deliberate redesign — it
 * makes one DELIBERATE, because the digest has to be updated in the same commit
 * by someone who read this file and decided.
 *
 * WHAT IS FROZEN, and it is the presentation ONLY:
 *
 *   the two spines, control point for control point
 *   the width profiles
 *   the viewport window
 *   which channel owns which hue and which is dominant
 *   the corner
 *   the six geometric invariants the founder's direction named
 *   what the four approved states render
 *
 * WHAT IS NOT FROZEN, and is the entire point of freezing the rest: everything
 * BENEATH it. The usage authority, the freshness model, the event bridge, the
 * identity isolation — all of that is expected to change underneath a HUD whose
 * appearance no longer moves. That separation is why this lock exists.
 */

/* ------------------------------------------------------------- the digest */

/**
 * A stable digest over a shape's numbers.
 *
 * Deliberately NOT a cryptographic hash: this detects an edit, it does not
 * defend against one, and a reader debugging a failure should be able to see
 * the numbers that produced it. Fixed 6-decimal formatting so a value that
 * round-trips through a different literal spelling — `0.3` versus `0.30` —
 * does not read as a change, while a real edit at the fifth decimal still does.
 */
function digest(shape: WonderlandUsageSwoosh): string {
  const numbers = [
    shape.startX,
    shape.startY,
    ...shape.segments.flatMap((segment) => [
      segment.control1X,
      segment.control1Y,
      segment.control2X,
      segment.control2Y,
      segment.endX,
      segment.endY,
    ]),
    shape.tailWidth,
    shape.tipWidth,
    shape.taperStart,
    shape.taperExponent,
  ];
  return numbers.map((value) => value.toFixed(6)).join(',');
}

/**
 * THE APPROVED COMPOUND FRAME — PERMANENT.
 *
 * A 255-degree arc centred near (0.3225, 0.500) at radius ~0.267, its gap
 * facing RIGHT, plus a tail that leaves the upper gap edge on the ring's own
 * tangent and RISES away to the right, tapering to a point.
 *
 * The founder settled this shape and declared it the health bar until they say
 * otherwise. Changing these numbers is not a refactor.
 */
const CANON_COMPOUND = [
  '0.467500,0.710700',
  '0.390600,0.783100,0.282100,0.795500,0.193700,0.742100',
  '0.105400,0.688600,0.055000,0.580000,0.066700,0.468100',
  '0.078300,0.356200,0.149600,0.263500,0.246600,0.234400',
  '0.476400,0.165200,0.750000,0.115000,0.955000,0.105000',
  '0.030000,0.004000,0.800000,1.500000',
].join(',');

/**
 * THE APPROVED SINGLE-AGENT STROKE — PERMANENT.
 *
 * A CONCENTRIC inner hook at about two thirds of the frame's radius, sharing
 * its centre and its gesture, with a tangential tail that stops well short of
 * the frame's tip. It never crosses the green and is never hidden by it.
 */
const CANON_SINGLE = [
  '0.407700,0.631800',
  '0.360000,0.677100,0.292700,0.684800,0.237900,0.651400',
  '0.183000,0.617900,0.151800,0.550000,0.159000,0.480000',
  '0.166300,0.410000,0.210500,0.352100,0.270700,0.333900',
  '0.462100,0.275800,0.680000,0.300000,0.860000,0.350000',
  '0.014500,0.011000,0.700000,1.000000',
].join(',');

describe('the canonical HUD geometry is frozen', () => {
  it('has not changed the Compound frame', () => {
    expect(
      digest(WONDERLAND_COMPOUND_SWOOSH),
      'The founder-approved Compound frame changed. If that is deliberate, update ' +
        'CANON_COMPOUND in this file in the same commit and say why in the message.',
    ).toBe(CANON_COMPOUND);
  });

  it('has not changed the single-agent stroke', () => {
    expect(
      digest(WONDERLAND_SINGLE_SWOOSH),
      'The founder-approved single-agent stroke changed. If that is deliberate, ' +
        'update CANON_SINGLE in this file in the same commit and say why.',
    ).toBe(CANON_SINGLE);
  });

  it('has not changed the window onto the unit box', () => {
    expect(WONDERLAND_USAGE_VIEWPORT).toEqual({ x: 0, y: 0.06, width: 1, height: 0.88 });
  });

  it('has not changed the corner', () => {
    expect(WONDERLAND_USAGE_ANCHOR).toBe('top_left');
  });

  it('has not changed which channel owns which hue, or which one dominates', () => {
    // GREEN is the Compound Agent. BLUE is the single agent. This is the one
    // fact a reader is most likely to invert while refactoring, and it is the
    // one that would misreport a founder's capacity to them.
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.compound_agent.accent.toLowerCase()).toBe('#3fd6a0');
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.single_agent.accent.toLowerCase()).toBe('#54a8ff');
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.compound_agent.emphasis).toBeLessThan(
      WONDERLAND_USAGE_CHANNEL_STYLE.single_agent.emphasis,
    );
    expect([...WONDERLAND_USAGE_CHANNELS]).toEqual(['compound_agent', 'single_agent']);
  });
});

/* ------------------------------------------------------- the invariants */

/**
 * The six facts the founder's direction named, restated as measurements.
 *
 * The digest above already fails on any edit — but a digest failure says only
 * "something moved". These say WHICH PROPERTY was lost, which is what a reader
 * needs to know whether their edit was the mistake or the digest was stale.
 */
describe('the canonical HUD keeps the properties the direction named', () => {
  const spine = (shape: WonderlandUsageSwoosh, samples = 129) =>
    Array.from({ length: samples }, (_, i) => wonderlandSwooshAt(i / (samples - 1), shape));

  it('opens to the RIGHT — the reversal of the reference', () => {
    const points = spine(WONDERLAND_COMPOUND_SWOOSH);
    const leftMost = points.reduce((best, p) => (p.x < best.x ? p : best));
    expect(leftMost.t).toBeGreaterThan(0.05);
    expect(leftMost.t).toBeLessThan(0.95);
    expect(points[0].x - leftMost.x).toBeGreaterThan(0.2);
    expect(points[points.length - 1].x - leftMost.x).toBeGreaterThan(0.2);
  });

  it('travels left to right, ending at the right-most point in the shape', () => {
    const points = spine(WONDERLAND_COMPOUND_SWOOSH);
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(points[points.length - 1].x, 5);
  });

  it('RISES as it travels — the tail lifts away from the ring', () => {
    // Smaller y is higher on screen. The tail leaves the ring's upper gap edge
    // already heading up, and keeps going, which is why it stops at 255 degrees
    // rather than carrying on around: past the top the ring heads down, and a
    // tail that then rose folded back over itself and creased the stroke.
    expect(wonderlandSwooshAt(1).y).toBeLessThan(wonderlandSwooshAt(0.72).y);
    expect(wonderlandSwooshAt(0.72).y).toBeLessThan(wonderlandSwooshAt(0.6).y);
  });

  it('is a RING — near-constant radius about one centre', () => {
    // Hand-authored cubics rather than a true circle, so the tolerance is the
    // honest one measured off the shape: within about a tenth of the radius.
    // Tight enough that an ellipse or a spiral fails, loose enough that the
    // drawn curve passes without anyone being tempted to "correct" it.
    const radii = spine(WONDERLAND_COMPOUND_SWOOSH)
      .filter((p) => p.t <= 0.55)
      .map((p) => Math.hypot(p.x - 0.3225, p.y - 0.5));
    const spread = Math.max(...radii) - Math.min(...radii);
    expect(spread).toBeLessThan(0.03);
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    expect(mean).toBeGreaterThan(0.24);
    expect(mean).toBeLessThan(0.29);
  });

  it('NESTS the blue inside the frame, concentric and never crossing', () => {
    // The choice that was tried both ways. Running the blue UNDER the green
    // looked better in a still and broke the instrument: the frame covered the
    // first third of the blue spine, so every reading below about a third drew
    // identically to empty. Nested arcs never cross, so nothing is ever hidden.
    const centre = { x: 0.3225, y: 0.5 };
    const ringRadius = spine(WONDERLAND_COMPOUND_SWOOSH)
      .filter((p) => p.t <= 0.55)
      .map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));
    const meanRing = ringRadius.reduce((a, b) => a + b, 0) / ringRadius.length;

    const blue = spine(WONDERLAND_SINGLE_SWOOSH).filter((p) => p.t <= 0.55);
    const blueRadii = blue.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));
    const meanBlue = blueRadii.reduce((a, b) => a + b, 0) / blueRadii.length;

    // INSIDE, and by enough to read as a second ring rather than a thick edge.
    expect(meanBlue).toBeLessThan(meanRing);
    expect(meanBlue / meanRing).toBeGreaterThan(0.55);
    expect(meanBlue / meanRing).toBeLessThan(0.80);
  });

  it('keeps the blue a SWOOP, not a straight bar', () => {
    const tail = wonderlandSwooshAt(0, WONDERLAND_SINGLE_SWOOSH);
    const tip = wonderlandSwooshAt(1, WONDERLAND_SINGLE_SWOOSH);
    const middle = wonderlandSwooshAt(0.5, WONDERLAND_SINGLE_SWOOSH);
    const chordY = tail.y + (tip.y - tail.y) * ((middle.x - tail.x) / (tip.x - tail.x));
    expect(Math.abs(middle.y - chordY)).toBeGreaterThan(0.03);
  });
});

/* --------------------------------------------------- the approved states */

/**
 * The four panels the founder approved, pinned by what they RENDER rather than
 * by a screenshot — a screenshot pins anti-aliasing, and this pins meaning.
 */
describe('the four approved states still read the way they were approved', () => {
  const meter = (channel: WonderlandUsageChannel, used: number | null, capacity: number | null) =>
    projectWonderlandUsageMeter({
      channel,
      tierId: 'canon',
      tierLabel: 'CANON',
      unitLabel: 'WONDER',
      capacityUnits: capacity,
      usedUnits: used,
      referenceCapacityUnits: capacity,
      provenance: 'simulated',
      observedAtIso: '2026-01-01T00:00:00.000Z',
    });

  const hud = (used: number | null) =>
    projectWonderlandUsageHud({
      compoundAgent: meter('compound_agent', used, used === null ? null : 480),
      singleAgent: meter('single_agent', used, used === null ? null : 120),
      observedAtIso: '2026-01-01T00:00:00.000Z',
    });

  it('TYPICAL — both meters part-drawn, both numbers known', () => {
    const state = hud(186);
    expect(state.compoundAgent.remainingFraction.known).toBe(true);
    expect(state.compoundAgent.remainingFraction.value).toBeGreaterThan(0.1);
    expect(state.compoundAgent.remainingFraction.value).toBeLessThan(0.95);
  });

  it('NEARLY SPENT — a remainder that is small but never zero-by-rounding', () => {
    const state = hud(452);
    expect(state.compoundAgent.remainingUnits.value).toBe(28);
    expect(state.compoundAgent.remainingFraction.value as number).toBeGreaterThan(0);
  });

  it('UNTOUCHED — a FULL meter, because the meter drains', () => {
    const state = hud(0);
    expect(state.compoundAgent.remainingFraction.value).toBe(1);
    expect(state.singleAgent.remainingFraction.value).toBe(1);
  });

  it('NOTHING REPORTED — unknown, and never zero', () => {
    // The rule the whole product rests on. An unreported meter is not an empty
    // one, and an empty one is a claim that everything was spent.
    const state = hud(null);
    for (const meterState of [state.compoundAgent, state.singleAgent]) {
      expect(meterState.remainingFraction.known).toBe(false);
      expect(meterState.remainingFraction.value).toBeNull();
      expect(meterState.capacityUnits.known).toBe(false);
      expect(meterState.status).toBe('unavailable');
      expect(meterState.unavailableReason).not.toBeNull();
    }
  });
});

/* ---------------------------------------- what the nesting buys, measured */

/**
 * THE TWO STROKES NEVER OVERLAP, AND THAT IS THE POINT.
 *
 * This replaces a test that measured the opposite. An earlier draft ran the
 * blue UNDER the green so the frame occluded it at two crossings; measuring it
 * showed the frame covered the first 33.3% of the blue spine, so every
 * single-agent reading at or below about a third had its entire fill inside the
 * covered span and drew identically to empty — precisely the range where "you
 * are nearly out" has to be legible. The founder settled on the nested form,
 * which has none of that, and this asserts the property rather than the story.
 *
 * A test for zero overlap is worth keeping rather than deleting: it is the one
 * thing that would silently break if anyone widened either stroke, moved the
 * inner radius, or "tidied" the two curves toward each other.
 */
describe('the nested strokes never hide each other', () => {
  const SAMPLES = 500;

  const sample = (shape: WonderlandUsageSwoosh) =>
    Array.from({ length: SAMPLES + 1 }, (_, i) => wonderlandSwooshAt(i / SAMPLES, shape));

  it('leaves a clear gap between the two stroke edges everywhere', () => {
    const green = sample(WONDERLAND_COMPOUND_SWOOSH);
    let closest = Number.POSITIVE_INFINITY;
    for (const blue of sample(WONDERLAND_SINGLE_SWOOSH)) {
      for (const g of green) {
        const gap = Math.hypot(g.x - blue.x, g.y - blue.y) - (g.halfWidth + blue.halfWidth);
        if (gap < closest) closest = gap;
      }
    }
    // Edge to edge, not centre to centre: this is the number that decides
    // whether the two ever touch on screen.
    expect(closest).toBeGreaterThan(0.02);
  });

  it('hides no part of the blue spine, at any reading', () => {
    const green = sample(WONDERLAND_COMPOUND_SWOOSH);
    const covered = sample(WONDERLAND_SINGLE_SWOOSH).filter((blue) =>
      green.some((g) => Math.hypot(g.x - blue.x, g.y - blue.y) <= g.halfWidth),
    );
    expect(covered.length).toBe(0);
  });
});

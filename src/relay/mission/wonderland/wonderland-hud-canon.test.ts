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
 * THE APPROVED COMPOUND FRAME.
 *
 * A 305-degree ring centred at (0.225, 0.50) with radius 0.185, its gap facing
 * right, plus a tail leaving the upper gap edge on the ring's own tangent and
 * falling away to the right.
 */
const CANON_COMPOUND = [
  '0.389100,0.585400',
  '0.349700,0.661000,0.263800,0.700000,0.181000,0.679700',
  '0.098200,0.659400,0.040000,0.585200,0.040000,0.500000',
  '0.040000,0.414800,0.098200,0.340600,0.181000,0.320300',
  '0.263800,0.300000,0.349700,0.339000,0.389100,0.414600',
  '0.458400,0.547600,0.700000,0.615000,0.940000,0.600000',
  '0.031000,0.004000,0.630000,1.350000',
].join(',');

/**
 * THE APPROVED SINGLE-AGENT STROKE.
 *
 * Starts on the frame's own spine, dives under the ring's lower arc, and rises
 * away to the right — most of its sweep in the visible half, because the first
 * half is behind the ring.
 */
const CANON_SINGLE = [
  '0.055000,0.570000',
  '0.095000,0.672000,0.250000,0.701000,0.440000,0.708000',
  '0.630000,0.714000,0.780000,0.695000,0.905000,0.655000',
  '0.023000,0.019500,0.740000,1.000000',
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
    expect(WONDERLAND_USAGE_VIEWPORT).toEqual({ x: 0, y: 0.27, width: 1, height: 0.48 });
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

  it('SWOOPS DOWN as it travels', () => {
    expect(wonderlandSwooshAt(1).y).toBeGreaterThan(wonderlandSwooshAt(0.72).y);
  });

  it('is a RING — constant radius, and a circle rather than an ellipse', () => {
    const radii = spine(WONDERLAND_COMPOUND_SWOOSH)
      .filter((p) => p.t <= 0.6)
      .map((p) => Math.hypot(p.x - 0.225, p.y - 0.5));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.008);
  });

  it('runs the blue BEHIND the green, crossing the frame rather than passing beside it', () => {
    const ring = spine(WONDERLAND_COMPOUND_SWOOSH, 257);
    const inside = (point: { x: number; y: number }): boolean =>
      Math.min(...ring.map((r) => Math.hypot(r.x - point.x, r.y - point.y))) <
      WONDERLAND_COMPOUND_SWOOSH.tailWidth;
    const samples = spine(WONDERLAND_SINGLE_SWOOSH).map(inside);
    expect(samples[0], 'the blue must START inside the frame footprint').toBe(true);
    expect(samples.filter((v, i) => i > 0 && v !== samples[i - 1]).length).toBeGreaterThanOrEqual(
      1,
    );
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

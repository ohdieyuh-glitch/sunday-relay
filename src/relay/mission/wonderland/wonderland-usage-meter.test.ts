import { describe, expect, it } from 'vitest';

import { RELAY_USAGE_STATUSES } from '../../usage/usage-contracts';
import {
  WONDERLAND_COMPOUND_SWOOSH,
  WONDERLAND_HUD_ANCHORS,
  WONDERLAND_SINGLE_SWOOSH,
  WONDERLAND_USAGE_ANCHOR,
  WONDERLAND_USAGE_CHANNELS,
  WONDERLAND_USAGE_CHANNEL_STYLE,
  WONDERLAND_USAGE_CHANNEL_SWOOSH,
  WONDERLAND_USAGE_CONSUMERS,
  WONDERLAND_USAGE_DELTA_KINDS,
  WONDERLAND_USAGE_FIXTURE_REFERENCE,
  WONDERLAND_USAGE_HUD_FIELDS,
  WONDERLAND_USAGE_METER_FIELDS,
  WONDERLAND_USAGE_STATUSES,
  WONDERLAND_USAGE_SWOOSH_FIELDS,
  WONDERLAND_USAGE_UNAVAILABLE_REASON,
  WONDERLAND_USAGE_VIEWPORT,
  applyWonderlandUsageDelta,
  projectWonderlandUsageHud,
  projectWonderlandUsageMeter,
  wonderlandSwooshAt,
  wonderlandSwooshOutline,
  wonderlandMeterDrawPlan,
  WONDERLAND_METER_DRAW_PLAN_FIELDS,
  WONDERLAND_METER_HEAD_ARC,
  WONDERLAND_METER_MINIMUM_VISIBLE_ARC,
  wonderlandSwooshSvgPath,
  wonderlandUsageEase,
  wonderlandUsageFixture,
  wonderlandUsageHudFixture,
} from './wonderland-usage-meter';
import type { WonderlandUsageMeter, WonderlandUsageSwoosh } from './wonderland-usage-meter';

const AT = '2026-09-07T10:00:00.000Z';

const meter = (
  overrides: Partial<Parameters<typeof projectWonderlandUsageMeter>[0]> = {},
): WonderlandUsageMeter =>
  projectWonderlandUsageMeter({
    channel: 'compound_agent',
    tierId: 'tier-a',
    tierLabel: 'TIER A',
    unitLabel: 'WONDER',
    capacityUnits: 100,
    usedUnits: 50,
    referenceCapacityUnits: 300,
    provenance: 'live',
    observedAtIso: AT,
    ...overrides,
  });

/* --------------------------------------------------------------- shape */

describe('the usage meter contract', () => {
  it('sits in the corner the direction named, and says so in the data', () => {
    expect(WONDERLAND_USAGE_ANCHOR).toBe('top_left');
    expect(WONDERLAND_HUD_ANCHORS).toContain(WONDERLAND_USAGE_ANCHOR);
    expect(meter().anchor).toBe('top_left');
  });

  it('reuses Relay’s existing usage status vocabulary rather than inventing one', () => {
    expect(WONDERLAND_USAGE_STATUSES).toBe(RELAY_USAGE_STATUSES);
  });

  it('names the consumers that will spend it, including the ones that do not exist yet', () => {
    expect([...WONDERLAND_USAGE_CONSUMERS].sort()).toEqual([
      'compound_agent',
      'jhin_interaction',
      'julius_mission',
      'unattributed',
    ]);
    expect([...WONDERLAND_USAGE_DELTA_KINDS].sort()).toEqual(['drain', 'replenish']);
  });

  it('carries every field the manifest names', () => {
    expect(Object.keys(meter()).sort()).toEqual([...WONDERLAND_USAGE_METER_FIELDS].sort());
    expect(Object.keys(WONDERLAND_COMPOUND_SWOOSH).sort()).toEqual(
      [...WONDERLAND_USAGE_SWOOSH_FIELDS].sort(),
    );
    expect(Object.keys(wonderlandUsageHudFixture(AT)).sort()).toEqual(
      [...WONDERLAND_USAGE_HUD_FIELDS].sort(),
    );
  });

  it('holds no tier catalogue, because a capacity table here would be billing', () => {
    // The tier is opaque: an id, a label, and a capacity the caller supplied.
    // Nothing in the projection may map one to the other.
    const unknownTier = meter({ tierId: 'a-tier-nobody-declared', capacityUnits: 7 });
    expect(unknownTier.capacityUnits.value).toBe(7);
    expect(unknownTier.tierId).toBe('a-tier-nobody-declared');
  });
});

/* ------------------------------------------------- capacity vs percentage */

describe('a tier changes the meter\'s length, not only its percentage', () => {
  const small = meter({ tierId: 'small', capacityUnits: 100, usedUnits: 50 });
  const large = meter({ tierId: 'large', capacityUnits: 300, usedUnits: 50 });

  it('draws a longer meter for a larger capacity', () => {
    expect(small.capacitySpan.value).toBeCloseTo(1 / 3, 10);
    expect(large.capacitySpan.value).toBe(1);
    expect(large.capacitySpan.value as number).toBeGreaterThan(
      small.capacitySpan.value as number,
    );
  });

  it('reports a different percentage for the same spend', () => {
    expect(small.fillFraction.value).toBeCloseTo(0.5, 10);
    expect(large.fillFraction.value).toBeCloseTo(1 / 6, 10);
  });

  it('drains the SAME absolute length for the same spend', () => {
    // This is the whole point of splitting the two fields. Fifty units spent is
    // fifty units of meter, whatever the tier — which is exactly what a single
    // percentage cannot say.
    const drained = (m: WonderlandUsageMeter): number =>
      (m.capacitySpan.value as number) * (m.fillFraction.value as number);
    expect(drained(small)).toBeCloseTo(drained(large), 10);
  });

  it('leaves more of a larger meter unspent', () => {
    expect(small.remainingUnits.value).toBe(50);
    expect(large.remainingUnits.value).toBe(250);
  });
});

/* ------------------------------------------------------- unknown is not 0 */

describe('what the meter says when nobody has told it anything', () => {
  it('reports every figure as unknown rather than as zero', () => {
    const blank = projectWonderlandUsageMeter({
      channel: 'compound_agent',
      provenance: 'simulated',
      observedAtIso: AT,
    });
    for (const figure of [
      blank.capacityUnits,
      blank.usedUnits,
      blank.remainingUnits,
      blank.referenceCapacityUnits,
      blank.capacitySpan,
      blank.fillFraction,
      blank.remainingFraction,
    ]) {
      expect(figure.known).toBe(false);
      expect(figure.value).toBeNull();
      expect(figure.reason).not.toBeNull();
    }
    expect(blank.status).toBe('unavailable');
    expect(blank.unavailableReason).toBe(WONDERLAND_USAGE_UNAVAILABLE_REASON);
  });

  it('refuses to derive a remaining count from a capacity it does not have', () => {
    const halfKnown = projectWonderlandUsageMeter({
      channel: 'single_agent',
      usedUnits: 30,
      provenance: 'live',
      observedAtIso: AT,
    });
    expect(halfKnown.usedUnits.value).toBe(30);
    expect(halfKnown.remainingUnits.known).toBe(false);
    expect(halfKnown.fillFraction.known).toBe(false);
  });

  it('refuses to divide by a ceiling of zero', () => {
    const zeroCeiling = meter({ capacityUnits: 0, usedUnits: 0 });
    expect(zeroCeiling.fillFraction.known).toBe(false);
    expect(zeroCeiling.fillFraction.reason).toBe('unknown_denominator');
    // A zero ceiling is not a full meter and it is not an empty one.
    expect(zeroCeiling.fillFraction.value).toBeNull();
  });

  it('treats a non-finite number as no number at all', () => {
    const broken = meter({ capacityUnits: Number.NaN, usedUnits: Number.POSITIVE_INFINITY });
    expect(broken.capacityUnits.known).toBe(false);
    expect(broken.usedUnits.known).toBe(false);
  });

  it('clamps an over-spend to an empty meter rather than an impossible one', () => {
    const over = meter({ capacityUnits: 100, usedUnits: 250 });
    expect(over.fillFraction.value).toBe(1);
    expect(over.remainingFraction.value).toBe(0);
    expect(over.remainingUnits.value).toBe(0);
  });

  it('keeps the stroke and the readout measuring the same thing', () => {
    // The bug this pins: drawing spend while printing remainder made an
    // untouched meter read "480 / 480" beside an empty bar. Both were right on
    // their own, and together they were nonsense.
    for (const used of [0, 25, 50, 99, 100]) {
      const m = meter({ capacityUnits: 100, usedUnits: used });
      expect(m.remainingFraction.value).toBeCloseTo(
        (m.remainingUnits.value as number) / 100,
        10,
      );
      expect(
        (m.fillFraction.value as number) + (m.remainingFraction.value as number),
      ).toBeCloseTo(1, 10);
    }
  });
});

/* -------------------------------------------------------------- provenance */

describe('a simulated meter says so', () => {
  it('marks anything that is not live as simulated', () => {
    expect(meter({ provenance: 'live' }).simulated).toBe(false);
    for (const provenance of ['simulated', 'imported', 'manual'] as const) {
      expect(meter({ provenance }).simulated).toBe(true);
    }
  });

  it('labels its own fixtures, so a designer can look without the world lying', () => {
    const fixture = wonderlandUsageFixture({
      channel: 'single_agent',
      tierId: 'fixture-single-small',
      usedUnits: 30,
      observedAtIso: AT,
    });
    expect(fixture.simulated).toBe(true);
    expect(fixture.provenance).toBe('simulated');
    expect(fixture.tierLabel).toContain('FIXTURE');
    expect(fixture.referenceCapacityUnits.value).toBe(
      WONDERLAND_USAGE_FIXTURE_REFERENCE.single_agent,
    );
  });

  it('gives each channel its own ceiling, so the smaller instrument is not a stub', () => {
    // One shared ceiling would draw a single agent on its TOP tier as a quarter
    // of a bar, purely because a Compound Agent can buy more.
    expect(WONDERLAND_USAGE_FIXTURE_REFERENCE.compound_agent).not.toBe(
      WONDERLAND_USAGE_FIXTURE_REFERENCE.single_agent,
    );
    const top = wonderlandUsageFixture({
      channel: 'single_agent',
      tierId: 'fixture-single-large',
      usedUnits: 10,
      observedAtIso: AT,
    });
    expect(top.capacitySpan.value).toBe(1);
  });

  it('has nothing to say about a fixture tier that does not exist', () => {
    const missing = wonderlandUsageFixture({
      channel: 'single_agent',
      tierId: 'not-a-fixture',
      usedUnits: 30,
      observedAtIso: AT,
    });
    expect(missing.capacityUnits.known).toBe(false);
    expect(missing.status).toBe('unavailable');
  });
});

/* ------------------------------------------------------------ draw plan */

describe('the draw plan both surfaces render from', () => {
  // THE VALIDATIONS THE DIRECTIVE NAMES BY HAND. Each of these was listed as a
  // thing the HUD must be shown to do, and each is a property of the plan
  // rather than of a renderer, which is the point of extracting it: proving it
  // once proves it for the browser and for Unreal at the same time.

  it('accepts dynamic values rather than a hardcoded percentage', () => {
    const readings = [0, 0.25, 0.5, 0.75, 1];
    const seen = readings.map(
      (left) => wonderlandMeterDrawPlan(meter({ usedUnits: 100 * (1 - left) })).remainderOfTrack,
    );
    expect(seen).toEqual(readings);
    expect(new Set(seen).size).toBe(readings.length);
  });

  it('clamps a reading that arrives outside its own range', () => {
    // projectWonderlandUsageMeter clamps what it computes, so an out-of-range
    // value has to be introduced directly — which is exactly how one would
    // arrive from a replayed capture or a future authority.
    const wild: WonderlandUsageMeter = {
      ...meter(),
      capacitySpan: { known: true, value: 1.8, reason: null },
      remainingFraction: { known: true, value: -0.4, reason: null },
    } as WonderlandUsageMeter;
    const plan = wonderlandMeterDrawPlan(wild);
    expect(plan.trackFraction).toBe(1);
    expect(plan.remainderOfTrack).toBe(0);
    expect(plan.remainderFraction).toBe(0);
    expect(plan.headStartFraction).toBeGreaterThanOrEqual(0);
  });

  it('refuses to propagate a non-finite reading as geometry', () => {
    const broken: WonderlandUsageMeter = {
      ...meter(),
      capacitySpan: { known: true, value: Number.NaN, reason: null },
      remainingFraction: { known: true, value: Number.POSITIVE_INFINITY, reason: null },
    } as WonderlandUsageMeter;
    const plan = wonderlandMeterDrawPlan(broken);
    expect(Number.isFinite(plan.trackFraction)).toBe(true);
    expect(Number.isFinite(plan.remainderFraction)).toBe(true);
    expect(plan.trackFraction).toBe(0);
  });

  it('draws nothing at zero capacity, and says the track is not there', () => {
    const empty = wonderlandMeterDrawPlan(meter({ capacityUnits: 0, usedUnits: 0 }));
    expect(empty.trackFraction).toBe(0);
    expect(empty.trackVisible).toBe(false);
    expect(empty.remainderFraction).toBe(0);
    expect(empty.remainderVisible).toBe(false);
    expect(empty.headVisible).toBe(false);
  });

  it('fills the whole arc at full capacity', () => {
    const full = wonderlandMeterDrawPlan(
      meter({ capacityUnits: 300, usedUnits: 0, referenceCapacityUnits: 300 }),
    );
    expect(full.trackFraction).toBe(1);
    expect(full.trackVisible).toBe(true);
    expect(full.remainderOfTrack).toBe(1);
    expect(full.remainderFraction).toBe(1);
    expect(full.remainderVisible).toBe(true);
  });

  it('gives a bigger tier a PHYSICALLY LONGER track, not a differently shaded one', () => {
    // The founder asked for higher tiers to visibly increase capacity, and this
    // is where that lives: the tier ceiling moves the track's own length.
    const small = wonderlandMeterDrawPlan(
      meter({ capacityUnits: 100, usedUnits: 0, referenceCapacityUnits: 400 }),
    );
    const large = wonderlandMeterDrawPlan(
      meter({ capacityUnits: 400, usedUnits: 0, referenceCapacityUnits: 400 }),
    );
    expect(large.trackFraction).toBeGreaterThan(small.trackFraction);
    expect(small.trackFraction).toBeCloseTo(0.25, 10);
    expect(large.trackFraction).toBe(1);

    // And both are FULL, so the difference a viewer sees is length rather than
    // fill: two untouched tiers must not look like one that has been spent.
    expect(small.remainderOfTrack).toBe(1);
    expect(large.remainderOfTrack).toBe(1);
    expect(large.remainderFraction).toBeGreaterThan(small.remainderFraction);
  });

  it('draws the frame but never a remainder when capacity was not reported', () => {
    const unknown = wonderlandMeterDrawPlan(meter({ capacityUnits: null }));
    expect(unknown.trackFraction).toBe(1);
    expect(unknown.trackVisible).toBe(true);
    expect(unknown.remainderKnown).toBe(false);
    expect(unknown.remainderVisible).toBe(false);
    expect(unknown.remainderFraction).toBe(0);
  });

  it('tells a reported zero apart from an unreported remainder', () => {
    // Both draw nothing, and they are not the same fact. A renderer that could
    // not distinguish them would caption "0 left" over silence.
    const spent = wonderlandMeterDrawPlan(meter({ capacityUnits: 100, usedUnits: 100 }));
    const silent = wonderlandMeterDrawPlan(meter({ usedUnits: null }));
    expect(spent.remainderKnown).toBe(true);
    expect(spent.remainderVisible).toBe(false);
    expect(silent.remainderKnown).toBe(false);
    expect(silent.remainderVisible).toBe(false);
  });

  it('drops a remainder too short to be a shape rather than drawing a speck', () => {
    const speck = wonderlandMeterDrawPlan(
      meter({ capacityUnits: 100000, usedUnits: 99999.8, referenceCapacityUnits: 100000 }),
    );
    expect(speck.remainderKnown).toBe(true);
    expect(speck.remainderFraction).toBeGreaterThan(0);
    expect(speck.remainderFraction).toBeLessThan(WONDERLAND_METER_MINIMUM_VISIBLE_ARC);
    expect(speck.remainderVisible).toBe(false);
  });

  it('keeps the leading highlight inside the remainder it highlights', () => {
    for (const usedUnits of [0, 1, 50, 97, 99, 100]) {
      const plan = wonderlandMeterDrawPlan(meter({ capacityUnits: 100, usedUnits }));
      expect(plan.headStartFraction).toBeGreaterThanOrEqual(0);
      expect(plan.headEndFraction).toBe(plan.remainderFraction);
      expect(plan.headStartFraction).toBeLessThanOrEqual(plan.headEndFraction);
      expect(plan.headEndFraction).toBeLessThanOrEqual(plan.trackFraction);
    }
  });

  it('scales the highlight with the track, so a short tier is not all highlight', () => {
    const short = wonderlandMeterDrawPlan(
      meter({ capacityUnits: 40, usedUnits: 0, referenceCapacityUnits: 400 }),
    );
    const long = wonderlandMeterDrawPlan(
      meter({ capacityUnits: 400, usedUnits: 0, referenceCapacityUnits: 400 }),
    );
    const arc = (p: ReturnType<typeof wonderlandMeterDrawPlan>): number =>
      p.headEndFraction - p.headStartFraction;
    expect(arc(short)).toBeLessThan(arc(long));
    expect(arc(long)).toBeCloseTo(WONDERLAND_METER_HEAD_ARC, 10);
  });

  it('never draws a head without a remainder under it', () => {
    for (const usedUnits of [0, 25, 50, 99.99, 100]) {
      const plan = wonderlandMeterDrawPlan(meter({ capacityUnits: 100, usedUnits }));
      if (plan.headVisible) expect(plan.remainderVisible).toBe(true);
    }
    expect(wonderlandMeterDrawPlan(meter({ usedUnits: null })).headVisible).toBe(false);
  });

  it('names every field it carries, so the C++ mirror cannot drift', () => {
    const plan = wonderlandMeterDrawPlan(meter());
    expect(Object.keys(plan).sort()).toEqual([...WONDERLAND_METER_DRAW_PLAN_FIELDS].sort());
  });
});

/* ------------------------------------------------------ drain and refill */

describe('spending and returning capacity', () => {
  it('drains and replenishes the same units in both directions', () => {
    const start = meter({ capacityUnits: 100, usedUnits: 40 });
    const drained = applyWonderlandUsageDelta(start, {
      kind: 'drain',
      units: 25,
      consumer: 'julius_mission',
      source: 'authority',
      atIso: AT,
    });
    expect(drained.usedUnits.value).toBe(65);
    expect(drained.remainingUnits.value).toBe(35);
    expect(drained.remainingFraction.value).toBeCloseTo(0.35, 10);

    const returned = applyWonderlandUsageDelta(drained, {
      kind: 'replenish',
      units: 25,
      consumer: 'julius_mission',
      source: 'authority',
      atIso: AT,
    });
    expect(returned.usedUnits.value).toBe(40);
  });

  it('keeps an authority delta live and drops a local guess to simulated', () => {
    const start = meter({ capacityUnits: 100, usedUnits: 40, provenance: 'live' });
    expect(start.provenance).toBe('live');

    const fromAuthority = applyWonderlandUsageDelta(start, {
      kind: 'drain',
      units: 5,
      consumer: 'compound_agent',
      source: 'authority',
      atIso: AT,
    });
    expect(fromAuthority.provenance).toBe('live');
    expect(fromAuthority.simulated).toBe(false);

    const optimistic = applyWonderlandUsageDelta(start, {
      kind: 'drain',
      units: 5,
      consumer: 'compound_agent',
      source: 'local_projection',
      atIso: AT,
    });
    // The moment a client adds its own arithmetic, what is on screen is no
    // longer what the authority said.
    expect(optimistic.provenance).toBe('simulated');
    expect(optimistic.simulated).toBe(true);
  });

  it('changes nothing when there is no reading to change', () => {
    const blank = projectWonderlandUsageMeter({
      channel: 'compound_agent',
      provenance: 'live',
      observedAtIso: AT,
    });
    const after = applyWonderlandUsageDelta(blank, {
      kind: 'drain',
      units: 10,
      consumer: 'jhin_interaction',
      source: 'authority',
      atIso: AT,
    });
    // Subtracting from an assumed zero would invent the whole account.
    expect(after).toBe(blank);
  });

  it('never spends past the ends of the meter', () => {
    const start = meter({ capacityUnits: 100, usedUnits: 90 });
    const overDrained = applyWonderlandUsageDelta(start, {
      kind: 'drain',
      units: 500,
      consumer: 'julius_mission',
      source: 'authority',
      atIso: AT,
    });
    expect(overDrained.usedUnits.value).toBe(100);
    expect(overDrained.remainingUnits.value).toBe(0);

    const overFilled = applyWonderlandUsageDelta(start, {
      kind: 'replenish',
      units: 500,
      consumer: 'julius_mission',
      source: 'authority',
      atIso: AT,
    });
    expect(overFilled.usedUnits.value).toBe(0);
  });

  it('refuses a negative delta, which is the other kind wearing a disguise', () => {
    const start = meter({ capacityUnits: 100, usedUnits: 40 });
    const after = applyWonderlandUsageDelta(start, {
      kind: 'drain',
      units: -20,
      consumer: 'julius_mission',
      source: 'authority',
      atIso: AT,
    });
    expect(after).toBe(start);
  });
});

/* ------------------------------------------------------------ the swoosh */

describe('the swoosh geometry', () => {
  it('is a sweep, not a dial — its curvature is nowhere near constant', () => {
    // The measurable difference between the direction's swooping stroke and the
    // arc it must not become: an arc has ONE curvature everywhere, so a ring
    // gauge reads as a dial no matter how it is coloured. A cubic tightens and
    // relaxes, which is what makes a stroke look drawn rather than plotted.
    const samples = 48;
    const curvature: number[] = [];
    for (let i = 0; i < samples - 1; i += 1) {
      const a = wonderlandSwooshAt(i / (samples - 1));
      const b = wonderlandSwooshAt((i + 1) / (samples - 1));
      const arc = Math.hypot(b.x - a.x, b.y - a.y);
      const turn = Math.abs(
        Math.atan2(b.tangentY, b.tangentX) - Math.atan2(a.tangentY, a.tangentX),
      );
      if (arc > 0) curvature.push(turn / arc);
    }
    expect(curvature.length).toBeGreaterThan(0);
    expect(Math.max(...curvature)).toBeGreaterThan(3 * Math.min(...curvature));
  });

  it('stays inside the unit box, so a renderer can use a 0..1 viewBox', () => {
    for (const point of wonderlandSwooshOutline({ to: 1, samples: 64 })) {
      expect(point.x).toBeGreaterThanOrEqual(-0.001);
      expect(point.x).toBeLessThanOrEqual(1.001);
      expect(point.y).toBeGreaterThanOrEqual(-0.001);
      expect(point.y).toBeLessThanOrEqual(1.001);
    }
  });

  it('opens to the RIGHT — the mandatory reversal of the reference', () => {
    // The reference's long green ring opens LEFT, back into the bars. Wonderland
    // reverses it. Measured rather than eyeballed, because a mirrored curve is
    // the easiest thing to get backwards and the hardest to notice.
    //
    // "Opens right" means the aperture is on the right: the spine's extreme
    // point is on the LEFT, and both ends sit well to the right of it.
    const spine = Array.from({ length: 65 }, (_, i) => wonderlandSwooshAt(i / 64));
    const leftMost = spine.reduce((best, s) => (s.x < best.x ? s : best));
    expect(leftMost.t).toBeGreaterThan(0.05);
    expect(leftMost.t).toBeLessThan(0.95);
    expect(spine[0].x - leftMost.x).toBeGreaterThan(0.2);
    expect(spine[spine.length - 1].x - leftMost.x).toBeGreaterThan(0.2);
  });

  it('is a RING — near-constant radius about one centre, not an arc with a flourish', () => {
    const ring = Array.from({ length: 129 }, (_, i) =>
      wonderlandSwooshAt((i / 128) * 0.55, WONDERLAND_COMPOUND_SWOOSH),
    );
    const centre = { x: 0.3225, y: 0.5 };
    const radii = ring.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));
    // Hand-authored cubics rather than a true circle, so the tolerance is the
    // one measured off the shape: within about a tenth of the radius. Tight
    // enough that an ellipse or a spiral fails, loose enough that nobody is
    // tempted to "correct" the drawn curve toward a compass circle.
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.03);
    // And it wraps: the spine passes above, left of, and below the centre.
    expect(ring.some((p) => p.y < centre.y - 0.1)).toBe(true);
    expect(ring.some((p) => p.x < centre.x - 0.1)).toBe(true);
    expect(ring.some((p) => p.y > centre.y + 0.1)).toBe(true);
  });

  it('RISES as it travels, lifting away from the ring', () => {
    // Smaller y is higher on screen. The tail leaves the ring's upper gap edge
    // already heading up and keeps going — which is exactly why the arc stops
    // at 255 degrees: past the top the ring heads down, and a tail that then
    // rose would fold back over itself and crease the stroke.
    const leaves = wonderlandSwooshAt(0.72);
    const tip = wonderlandSwooshAt(1);
    expect(tip.y).toBeLessThan(leaves.y);
    expect(tip.x).toBeGreaterThan(leaves.x);
  });

  it('finishes travelling to the right, so the frame reads left to right', () => {
    const tip = wonderlandSwooshAt(1);
    const justBefore = wonderlandSwooshAt(0.97);
    expect(tip.x).toBeGreaterThan(justBefore.x);
    // And the tip is the right-most thing in the whole shape.
    const spine = Array.from({ length: 65 }, (_, i) => wonderlandSwooshAt(i / 64));
    expect(Math.max(...spine.map((s) => s.x))).toBeCloseTo(tip.x, 6);
  });

  it('parameterises by arc length, so equal spend draws equal stroke', () => {
    // The whole meter rests on this. On raw Bézier `t` the stroke would run
    // fast through the gentle tail and slow through the tight ring, and the
    // same spend would draw a different length depending where it landed.
    const steps = 20;
    const lengths: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      const a = wonderlandSwooshAt(i / steps);
      const b = wonderlandSwooshAt((i + 1) / steps);
      lengths.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const longest = Math.max(...lengths);
    const shortest = Math.min(...lengths);
    expect(longest / shortest).toBeLessThan(1.35);
  });

  it('tapers from a thick tail to a point', () => {
    expect(wonderlandSwooshAt(0).halfWidth).toBeCloseTo(WONDERLAND_COMPOUND_SWOOSH.tailWidth, 10);
    expect(wonderlandSwooshAt(1).halfWidth).toBeCloseTo(WONDERLAND_COMPOUND_SWOOSH.tipWidth, 10);
    expect(wonderlandSwooshAt(1).halfWidth).toBeLessThan(wonderlandSwooshAt(0).halfWidth);
  });

  it('produces a finite point, tangent and width everywhere, including at bad input', () => {
    for (const t of [-5, 0, 0.5, 1, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const sample = wonderlandSwooshAt(t);
      for (const value of [
        sample.x,
        sample.y,
        sample.tangentX,
        sample.tangentY,
        sample.halfWidth,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(Math.hypot(sample.tangentX, sample.tangentY)).toBeCloseTo(1, 10);
    }
  });

  it('draws the fill with the same function as the track, so they cannot diverge', () => {
    const track = wonderlandSwooshOutline({ to: 1, samples: 32 });
    const fill = wonderlandSwooshOutline({ to: 0.4, samples: 32 });
    expect(track.length).toBe(64);
    expect(fill.length).toBe(64);
    // The fill starts at the same tail point as the track it sits in.
    expect(fill[0].x).toBeCloseTo(track[0].x, 10);
    expect(fill[0].y).toBeCloseTo(track[0].y, 10);
  });

  it('draws nothing for an empty extent rather than a degenerate sliver', () => {
    expect(wonderlandSwooshOutline({ to: 0 })).toEqual([]);
    expect(wonderlandSwooshOutline({ from: 0.6, to: 0.3 })).toEqual([]);
    expect(wonderlandSwooshSvgPath({ to: 0 })).toBe('');
  });

  it('emits a closed SVG path a browser can render directly', () => {
    const path = wonderlandSwooshSvgPath({ to: 1, samples: 8, scale: 100 });
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);
    expect(path).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('is deterministic — the same extent always yields the same path', () => {
    const once = wonderlandSwooshSvgPath({ to: 0.63, samples: 16 });
    const twice = wonderlandSwooshSvgPath({ to: 0.63, samples: 16 });
    expect(once).toBe(twice);
  });

  it('lets the shape change without the data layer moving', () => {
    // The whole reason the curve is data: a redraw is a different shape struct,
    // and every field of the meter is untouched by it.
    const redrawn = wonderlandSwooshOutline({
      to: 1,
      samples: 8,
      shape: { ...WONDERLAND_COMPOUND_SWOOSH, tailWidth: 0.2, taperStart: 0.1 },
    });
    const shipped = wonderlandSwooshOutline({ to: 1, samples: 8 });
    expect(redrawn).not.toEqual(shipped);
    expect(Object.keys(meter()).sort()).toEqual([...WONDERLAND_USAGE_METER_FIELDS].sort());
  });
});

describe('the window onto the unit box', () => {
  it('crops only what the drawing does not use', () => {
    // Not a fixed aspect — the crop follows the shape. The ring and its rising
    // tail occupy a tall band (measured: y 0.101..0.805 with half-widths), so
    // the window is nearly the full box vertically and trimming it to some
    // preferred wideness would clip a stroke.
    expect(WONDERLAND_USAGE_VIEWPORT.width / WONDERLAND_USAGE_VIEWPORT.height).toBeGreaterThan(1);
    expect(WONDERLAND_USAGE_VIEWPORT.height).toBeLessThan(1);
  });

  it('contains every point of both shapes, so nothing is cropped away', () => {
    const v = WONDERLAND_USAGE_VIEWPORT;
    for (const shape of Object.values(WONDERLAND_USAGE_CHANNEL_SWOOSH)) {
      for (const point of wonderlandSwooshOutline({ to: 1, samples: 96, shape })) {
        expect(point.x).toBeGreaterThanOrEqual(v.x - 0.002);
        expect(point.x).toBeLessThanOrEqual(v.x + v.width + 0.002);
        expect(point.y).toBeGreaterThanOrEqual(v.y - 0.002);
        expect(point.y).toBeLessThanOrEqual(v.y + v.height + 0.002);
      }
    }
  });

  it('preserves aspect — a window, never a squash', () => {
    // If the window scaled the axes differently, a stroke's thickness would
    // mean two different things and the ring would render as an ellipse it was
    // never authored as.
    expect(WONDERLAND_USAGE_VIEWPORT.width).toBe(1);
    expect(WONDERLAND_USAGE_VIEWPORT.x).toBe(0);
  });
});

/* ------------------------------------------------------------- channels */

describe('two bars, bound separately', () => {
  it('names the blue single agent and the green Compound Agent', () => {
    expect([...WONDERLAND_USAGE_CHANNELS]).toEqual(['compound_agent', 'single_agent']);
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.compound_agent.accent).toMatch(/^#3fd6a0$/i);
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.single_agent.accent).toMatch(/^#54a8ff$/i);
  });

  it('gives the Compound Agent the dominant frame', () => {
    // The more powerful capability reads first. Equal weight would say they
    // cost the same.
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.compound_agent.emphasis).toBeLessThan(
      WONDERLAND_USAGE_CHANNEL_STYLE.single_agent.emphasis,
    );
  });

  it('gives the Compound Agent the longer, thicker sweep', () => {
    const spineLength = (shape: typeof WONDERLAND_COMPOUND_SWOOSH): number => {
      let total = 0;
      for (let i = 0; i < 64; i += 1) {
        const a = wonderlandSwooshAt(i / 64, shape);
        const b = wonderlandSwooshAt((i + 1) / 64, shape);
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return total;
    };
    expect(spineLength(WONDERLAND_COMPOUND_SWOOSH)).toBeGreaterThan(
      spineLength(WONDERLAND_SINGLE_SWOOSH) * 1.3,
    );
    expect(WONDERLAND_COMPOUND_SWOOSH.tailWidth).toBeGreaterThan(
      WONDERLAND_SINGLE_SWOOSH.tailWidth,
    );
  });

  it('keeps the single-agent stroke the simpler shape — as weight, not as form', () => {
    // It is a concentric inner hook and it swoops: a dead-straight rectangle
    // beside a ring reads as two widgets placed together. "Simpler" therefore
    // cannot mean FEWER SEGMENTS — the two share a gesture, so they share a
    // segment count — it means weight. Half the thickness, a tail that stops
    // short, and no point at the end.
    expect(WONDERLAND_SINGLE_SWOOSH.segments.length).toBeGreaterThan(1);
    expect(WONDERLAND_SINGLE_SWOOSH.segments.length).toBe(
      WONDERLAND_COMPOUND_SWOOSH.segments.length,
    );
    expect(WONDERLAND_SINGLE_SWOOSH.tailWidth).toBeLessThan(
      WONDERLAND_COMPOUND_SWOOSH.tailWidth * 0.8,
    );
    const singleTaper =
      WONDERLAND_SINGLE_SWOOSH.tipWidth / WONDERLAND_SINGLE_SWOOSH.tailWidth;
    const compoundTaper =
      WONDERLAND_COMPOUND_SWOOSH.tipWidth / WONDERLAND_COMPOUND_SWOOSH.tailWidth;
    expect(singleTaper).toBeGreaterThan(compoundTaper);
  });

  it('SWOOPS rather than running dead straight', () => {
    const tail = wonderlandSwooshAt(0, WONDERLAND_SINGLE_SWOOSH);
    const tip = wonderlandSwooshAt(1, WONDERLAND_SINGLE_SWOOSH);
    const middle = wonderlandSwooshAt(0.5, WONDERLAND_SINGLE_SWOOSH);
    // The midpoint sits off the chord between the ends. A straight bar would
    // put it exactly on it.
    const chordY = tail.y + (tip.y - tail.y) * ((middle.x - tail.x) / (tip.x - tail.x));
    // A real sweep, not a hint of one. A bar this long with a deviation under a
    // couple of percent of the box reads as straight however it is authored.
    expect(Math.abs(middle.y - chordY)).toBeGreaterThan(0.03);
  });

  it('NESTS inside the frame without ever crossing it', () => {
    // Tried both ways. Running the blue UNDER the green occluded the first
    // third of its spine, so every single-agent reading below about a third
    // drew identically to empty — the range where "nearly out" must be legible.
    // Nested arcs never cross, so nothing is ever hidden.
    const ring = Array.from({ length: 257 }, (_, i) =>
      wonderlandSwooshAt(i / 256, WONDERLAND_COMPOUND_SWOOSH),
    );
    const covered = Array.from({ length: 129 }, (_, i) =>
      wonderlandSwooshAt(i / 128, WONDERLAND_SINGLE_SWOOSH),
    ).filter((point) =>
      ring.some((r) => Math.hypot(r.x - point.x, r.y - point.y) <= r.halfWidth),
    );
    expect(covered.length).toBe(0);
  });

  it('shares the frame`s centre at a smaller radius', () => {
    const centre = { x: 0.3225, y: 0.5 };
    const meanRadius = (shape: WonderlandUsageSwoosh): number => {
      const radii = Array.from({ length: 97 }, (_, i) =>
        wonderlandSwooshAt((i / 96) * 0.55, shape),
      ).map((p) => Math.hypot(p.x - centre.x, p.y - centre.y));
      return radii.reduce((a, b) => a + b, 0) / radii.length;
    };
    const ratio = meanRadius(WONDERLAND_SINGLE_SWOOSH) / meanRadius(WONDERLAND_COMPOUND_SWOOSH);
    // Inside, and by enough to read as a second ring rather than a thick edge.
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.80);
  });

  it('lets the frame paint over the bar, so behind means behind', () => {
    // Draw order is the contract's, and `emphasis` 0 draws last.
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.compound_agent.emphasis).toBeLessThan(
      WONDERLAND_USAGE_CHANNEL_STYLE.single_agent.emphasis,
    );
  });

  it('stops the bar short of the frame, so the frame has the last word', () => {
    expect(wonderlandSwooshAt(1, WONDERLAND_SINGLE_SWOOSH).x).toBeLessThan(
      wonderlandSwooshAt(1, WONDERLAND_COMPOUND_SWOOSH).x,
    );
  });

  it('draws every channel on a real shape', () => {
    for (const channel of WONDERLAND_USAGE_CHANNELS) {
      const shape = WONDERLAND_USAGE_CHANNEL_SWOOSH[channel];
      expect(shape.segments.length).toBeGreaterThan(0);
      expect(wonderlandSwooshSvgPath({ to: 1, samples: 12, shape })).not.toBe('');
    }
  });

  it('never lets a track colour be mistaken for a filled one', () => {
    for (const channel of WONDERLAND_USAGE_CHANNELS) {
      const style = WONDERLAND_USAGE_CHANNEL_STYLE[channel];
      expect(style.track).not.toBe(style.accent);
      expect(style.bright).not.toBe(style.accent);
    }
  });
});

describe('assembling the HUD', () => {
  const compound = meter({ channel: 'compound_agent', capacityUnits: 300, usedUnits: 120 });
  const single = meter({ channel: 'single_agent', capacityUnits: 100, usedUnits: 60 });

  it('binds each bar to its own channel', () => {
    const hud = projectWonderlandUsageHud({
      compoundAgent: compound,
      singleAgent: single,
      observedAtIso: AT,
    });
    expect(hud.anchor).toBe('top_left');
    expect(hud.compoundAgent.channel).toBe('compound_agent');
    expect(hud.singleAgent.channel).toBe('single_agent');
    expect(hud.compoundAgent.usedUnits.value).toBe(120);
    expect(hud.singleAgent.usedUnits.value).toBe(60);
  });

  it('refuses a reading on the wrong bar rather than relabelling it', () => {
    // A compound number drawn on the single-agent stroke is a figure attached
    // to the wrong capability, which is worse than no figure.
    expect(() =>
      projectWonderlandUsageHud({
        compoundAgent: single,
        singleAgent: compound,
        observedAtIso: AT,
      }),
    ).toThrow(/channel_mismatch/);
  });

  it('carries one instant for the whole HUD, not one per bar', () => {
    const hud = projectWonderlandUsageHud({
      compoundAgent: compound,
      singleAgent: single,
      observedAtIso: '2026-09-07T11:11:11.000Z',
    });
    expect(hud.observedAtIso).toBe('2026-09-07T11:11:11.000Z');
  });
});

describe('smooth depletion and fill', () => {
  it('starts and settles rather than arriving at full speed', () => {
    expect(wonderlandUsageEase(0, 1, 0)).toBe(0);
    expect(wonderlandUsageEase(0, 1, 1)).toBe(1);
    expect(wonderlandUsageEase(0, 1, 0.5)).toBeCloseTo(0.5, 10);
    // Slower at the ends than in the middle: that is what smoothstep buys.
    expect(wonderlandUsageEase(0, 1, 0.1)).toBeLessThan(0.1);
    expect(wonderlandUsageEase(0, 1, 0.9)).toBeGreaterThan(0.9);
  });

  it('never overshoots past a full or an empty bar', () => {
    expect(wonderlandUsageEase(0.2, 0.8, 5)).toBeCloseTo(0.8, 10);
    expect(wonderlandUsageEase(0.2, 0.8, -5)).toBeCloseTo(0.2, 10);
    expect(wonderlandUsageEase(0.2, 0.8, Number.NaN)).toBeCloseTo(0.2, 10);
  });

  it('draws an endpoint when handed a broken clock, never NaN', () => {
    expect(Number.isFinite(wonderlandUsageEase(Number.NaN, 1, 0.5))).toBe(true);
    expect(wonderlandUsageEase(0.4, Number.NaN, 1)).toBeCloseTo(0.4, 10);
  });
});

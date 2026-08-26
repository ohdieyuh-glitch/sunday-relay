import { describe, expect, it } from 'vitest';
import { DOG_BOXES, DOG_METRICS, DOG_PIVOTS, type DogBox } from './relay-dog';

/**
 * THE DOG'S PROPORTIONS ARE THE BRAND, so they are pinned here.
 *
 * Every assertion below corresponds to something visible in the founder's
 * FRONT / SIDE / REAR / THREE-QUARTER reference sheet. The point is not that
 * the numbers are round — it is that a later edit which quietly redraws the
 * character has to argue with a named property of the reference first.
 */

const box = (name: string): DogBox => {
  const found = DOG_BOXES.find((b) => b.name === name);
  if (!found) throw new Error(`no box named ${name}`);
  return found;
};

const spanX = (b: DogBox) => [b.center[0] - b.size[0] / 2, b.center[0] + b.size[0] / 2] as const;
const top = (b: DogBox) => b.center[1] + b.size[1] / 2;
const bottom = (b: DogBox) => b.center[1] - b.size[1] / 2;

describe('silhouette', () => {
  it('makes the head the widest form in the character', () => {
    // The single most important proportion. A generic voxel dog shrinks the
    // head; the Relay Dog's head is wider than its shoulders AND wider than
    // its arms at rest, and that is what makes it recognisable in silhouette.
    // Measured over the IVORY silhouette. The visor slabs sit a few thousandths
    // proud of the shell so they win the depth test against the face they lie
    // on; that sliver is governed by the protrusion test below, and calling it
    // "wider than the head" would be a claim about nothing visible.
    const widest = Math.max(
      ...DOG_BOXES.filter((b) => b.surface === 'ivory').map((b) => Math.abs(b.center[0]) + b.size[0] / 2),
    );
    const headHalf = box('skull').size[0] / 2;
    expect(headHalf).toBeCloseTo(DOG_METRICS.headWidth / 2, 6);
    expect(widest).toBeLessThanOrEqual(headHalf + 1e-9);
  });

  it('stands on the ground plane', () => {
    const lowest = Math.min(...DOG_BOXES.map(bottom));
    expect(lowest).toBeCloseTo(0, 2);
  });

  it('reaches its reference height at the ear tips', () => {
    const highest = Math.max(...DOG_BOXES.map(top));
    expect(highest).toBeCloseTo(DOG_METRICS.height, 1);
  });

  it('keeps the reference’s head / torso / leg proportions', () => {
    const h = DOG_METRICS.height;
    const headBlock = top(box('earLeft')) - bottom(box('skull'));
    const torso = top(box('chest')) - bottom(box('hips'));
    const legs = top(box('legLeft')) - bottom(box('footLeft'));
    expect(headBlock / h).toBeCloseTo(DOG_METRICS.headBlockFraction, 1);
    expect(torso / h).toBeCloseTo(DOG_METRICS.torsoFraction, 1);
    expect(legs / h).toBeCloseTo(DOG_METRICS.legFraction, 1);
  });
});

describe('the face', () => {
  it('has exactly two rectangular ears, mirrored, with a notch between them', () => {
    const ears = DOG_BOXES.filter((b) => b.name.startsWith('ear'));
    expect(ears).toHaveLength(2);
    expect(ears[0].center[0]).toBeCloseTo(-ears[1].center[0], 6);
    expect(ears[0].size).toEqual(ears[1].size);
    // Taller than wide — rectangular, never a rounded or floppy ear.
    expect(ears[0].size[1]).toBeGreaterThan(ears[0].size[0]);
    const gap = Math.abs(ears[0].center[0]) - ears[0].size[0] / 2;
    expect(gap * 2).toBeGreaterThan(1.5);
  });

  it('has exactly two gold eyes, inside the visor, separated', () => {
    const eyes = DOG_BOXES.filter((b) => b.surface === 'eye');
    expect(eyes).toHaveLength(2);
    expect(eyes[0].center[0]).toBeCloseTo(-eyes[1].center[0], 6);
    const visor = box('visor');
    for (const eye of eyes) {
      const [lo, hi] = spanX(eye);
      const [vlo, vhi] = spanX(visor);
      expect(lo).toBeGreaterThan(vlo);
      expect(hi).toBeLessThan(vhi);
      expect(eye.center[1]).toBeCloseTo(visor.center[1], 6);
    }
    // A visible gap between the eyes — they are two eyes, not one bar.
    expect(spanX(eyes[1])[0] - spanX(eyes[0])[1]).toBeGreaterThan(0.5);
  });

  it('leaves ivory at both ends of the visor slot', () => {
    const visor = box('visor');
    expect(visor.size[0]).toBeLessThan(box('skull').size[0]);
  });

  it('wraps the visor onto both side planes', () => {
    // Visible only in the SIDE reference. A front-only visor leaves the profile
    // blank there — the clearest tell of a model built from one view.
    const wraps = DOG_BOXES.filter((b) => b.name.startsWith('visorWrap'));
    expect(wraps).toHaveLength(2);
    expect(wraps[0].center[0]).toBeCloseTo(-wraps[1].center[0], 6);
    expect(wraps.every((w) => w.surface === 'visor')).toBe(true);
  });

  it('never lets a visor or eye slab protrude past the head shell', () => {
    // Protruding slabs were visible as stray marks along the head's edge in the
    // REAR view, where the visor must not appear at all.
    const skull = box('skull');
    const shellX = skull.size[0] / 2;
    const shellZ = skull.center[2] + skull.size[2] / 2;
    for (const b of DOG_BOXES.filter((x) => x.surface !== 'ivory')) {
      expect(Math.abs(b.center[0]) + b.size[0] / 2, `${b.name} x`).toBeLessThan(shellX + 0.15);
      expect(b.center[2] + b.size[2] / 2, `${b.name} z`).toBeLessThan(shellZ + 0.2);
    }
  });
});

describe('body and limbs', () => {
  it('pinches the waist so the arms read as separate from the torso', () => {
    // Chest and hips stay in contact with the arms (attached); the belly does
    // not (a visible gap). Without the pinch the front view is one solid slab.
    const armInner = Math.abs(box('armRightUpper').center[0]) - box('armRightUpper').size[0] / 2;
    expect(box('belly').size[0] / 2, 'belly must clear the arm').toBeLessThan(armInner);
    expect(box('chest').size[0] / 2, 'chest must meet the arm').toBeGreaterThan(armInner);
  });

  it('mirrors both arms and both legs exactly', () => {
    for (const [l, r] of [['armLeftUpper', 'armRightUpper'], ['armLeftHand', 'armRightHand'], ['legLeft', 'legRight'], ['footLeft', 'footRight']]) {
      expect(box(l).center[0]).toBeCloseTo(-box(r).center[0], 6);
      expect(box(l).size).toEqual(box(r).size);
    }
  });

  it('projects the feet forward, not centred under the leg', () => {
    expect(box('footLeft').center[2]).toBeGreaterThan(box('legLeft').center[2]);
  });

  it('leaves a gap between the legs', () => {
    const half = box('legRight').size[0] / 2;
    expect(box('legRight').center[0] - half).toBeGreaterThan(0.2);
  });

  it('steps the tail back and up, tapering', () => {
    const tail = DOG_BOXES.filter((b) => b.joint === 'tail');
    expect(tail.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < tail.length; i += 1) {
      expect(tail[i].center[2], 'each segment further back').toBeLessThan(tail[i - 1].center[2]);
      expect(tail[i].center[1], 'each segment higher').toBeGreaterThan(tail[i - 1].center[1]);
      expect(tail[i].size[0], 'each segment narrower').toBeLessThan(tail[i - 1].size[0]);
    }
  });

  it('shows no tail in the front silhouette', () => {
    // Correct occlusion: the tail is behind the body, absent from FRONT.
    for (const b of DOG_BOXES.filter((x) => x.joint === 'tail')) {
      expect(b.center[2] + b.size[2] / 2).toBeLessThan(box('hips').center[2] - box('hips').size[2] / 2);
    }
  });
});

describe('rig', () => {
  it('gives every box a joint that declares a pivot', () => {
    for (const b of DOG_BOXES) {
      expect(DOG_PIVOTS[b.joint], `${b.name} → ${b.joint}`).toBeDefined();
    }
  });

  it('places the head pivot at the neck, not at the model origin', () => {
    // A head that rotates about the origin swings the whole skull through the
    // torso instead of turning on the neck.
    const neck = DOG_PIVOTS.head[1];
    expect(neck).toBeGreaterThan(box('chest').center[1]);
    expect(neck).toBeLessThan(box('skull').center[1]);
  });

  it('places each limb pivot inside its own limb', () => {
    expect(DOG_PIVOTS.armRight[1]).toBeGreaterThan(box('armRightUpper').center[1]);
    expect(DOG_PIVOTS.legRight[1]).toBeGreaterThan(box('legRight').center[1]);
  });
});

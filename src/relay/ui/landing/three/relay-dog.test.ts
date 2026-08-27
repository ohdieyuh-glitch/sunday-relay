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
/** The head is a FRAME of five ivory boxes, so its extent is their union. */
const headBoxes = DOG_BOXES.filter((b) => b.name.startsWith('head'));
const headHalfWidth = Math.max(...headBoxes.map((b) => Math.abs(b.center[0]) + b.size[0] / 2));
const headFrontZ = Math.max(...headBoxes.map((b) => b.center[2] + b.size[2] / 2));
const headTop = Math.max(...headBoxes.map(top));
const headBottom = Math.min(...headBoxes.map(bottom));


describe('silhouette', () => {
  it('makes the head the widest single mass, with the arms reaching past it', () => {
    // The REAR reference is unambiguous: the arm columns sit OUTSIDE the head's
    // silhouette. An earlier rule forced them inside it and pinned them against
    // the body. What stays true is that the head is the widest single MASS —
    // wider than any part of the torso.
    expect(headHalfWidth).toBeCloseTo(DOG_METRICS.headWidth / 2, 6);
    const torsoHalf = Math.max(
      ...DOG_BOXES.filter((b) => ['shoulders', 'chest', 'lowerTorso', 'skirt', 'hipChamfer'].includes(b.name))
        .map((b) => b.size[0] / 2),
    );
    expect(headHalfWidth).toBeGreaterThan(torsoHalf);
    const armOuter = Math.abs(box('armRightHand').center[0]) + box('armRightHand').size[0] / 2;
    expect(armOuter).toBeGreaterThan(headHalfWidth);
    // ...but only just. The arms frame the head, they do not dwarf it.
    expect(armOuter).toBeLessThan(headHalfWidth * 1.3);
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
    const headBlock = top(box('earLeft')) - headBottom;
    const torso = top(box('shoulders')) - bottom(box('hipChamfer'));
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
    expect(top(ears[0])).toBeGreaterThan(headTop - 1e-9);
  });

  it('has exactly two gold eyes, inside the visor, separated', () => {
    const eyes = DOG_BOXES.filter((b) => b.surface === 'eye');
    expect(eyes).toHaveLength(2);
    expect(eyes[0].center[0]).toBeCloseTo(-eyes[1].center[0], 6);
    const visor = box('visorPlate');
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

  it('never lets a visor or eye slab protrude past the head shell', () => {
    // Protruding slabs were visible as stray marks along the head's edge in the
    // REAR view, where the visor must not appear at all.
    for (const b of DOG_BOXES.filter((x) => x.surface !== 'ivory')) {
      expect(Math.abs(b.center[0]) + b.size[0] / 2, `${b.name} x`).toBeLessThan(headHalfWidth + 0.02);
      expect(b.center[2] + b.size[2] / 2, `${b.name} z`).toBeLessThan(headFrontZ + 0.02);
    }
  });
});

describe('body and limbs', () => {
  it('widens the torso downward into the skirt', () => {
    // The sheet's RELAY OG FORM: narrow at the shoulders, broadest at the hip.
    // The previous model had a broad chest tapering to narrow hips — the
    // opposite shape, and the single biggest reason it read as a generic
    // blocky humanoid rather than as the Relay Dog.
    const widths = ['shoulders', 'chest', 'lowerTorso', 'skirt'].map((n) => box(n).size[0]);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i], 'each torso block is wider than the one above it').toBeGreaterThan(widths[i - 1]);
    }
    // Then a chamfer back in before the legs.
    expect(box('hipChamfer').size[0]).toBeLessThan(box('skirt').size[0]);
  });

  it('clears the arms from the shoulders so they read as separate limbs', () => {
    const armInner = Math.abs(box('armRightUpper').center[0]) - box('armRightUpper').size[0] / 2;
    expect(box('shoulders').size[0] / 2, 'a visible gap at the shoulder').toBeLessThan(armInner);
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

  it('steps the tail outward, back and down, tapering', () => {
    const tail = DOG_BOXES.filter((b) => b.joint === 'tail');
    expect(tail.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < tail.length; i += 1) {
      expect(tail[i].center[0], 'each segment further out').toBeGreaterThan(tail[i - 1].center[0]);
      expect(tail[i].center[2], 'each segment further back').toBeLessThan(tail[i - 1].center[2]);
      expect(tail[i].center[1], 'each segment lower').toBeLessThan(tail[i - 1].center[1]);
      expect(tail[i].size[0], 'each segment smaller').toBeLessThan(tail[i - 1].size[0]);
    }
  });

  it('puts the tail out at hip height where the sheet shows it', () => {
    // Beside the right hand, not tucked behind the spine — tucked away it
    // vanishes from the front and three-quarter views, which are the two the
    // reference sheet actually leads with.
    const tail = DOG_BOXES.filter((b) => b.joint === 'tail');
    expect(Math.min(...tail.map((t) => t.center[0]))).toBeGreaterThan(0);
    for (const t of tail) {
      expect(t.center[1]).toBeGreaterThan(bottom(box('skirt')) - 1.5);
      expect(t.center[1]).toBeLessThan(top(box('skirt')) + 2);
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
    expect(neck).toBeGreaterThan(box('shoulders').center[1]);
    expect(neck).toBeLessThan(headTop);
    // The head deliberately extends BELOW its own pivot, into the shoulders, so
    // a turn cannot open a hole at the neck. So the pivot sits above the head's
    // lowest point rather than on it — asserting they coincide would re-impose
    // the gap this overlap exists to close.
    expect(neck).toBeGreaterThan(headBottom);
    expect(neck - headBottom).toBeGreaterThan(0.4);
    expect(neck - headBottom).toBeLessThan(1.5);
  });

  it('places each limb pivot inside its own limb', () => {
    expect(DOG_PIVOTS.armRight[1]).toBeGreaterThan(box('armRightUpper').center[1]);
    expect(DOG_PIVOTS.legRight[1]).toBeGreaterThan(box('legRight').center[1]);
  });
});

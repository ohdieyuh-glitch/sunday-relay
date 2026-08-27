import { describe, expect, it } from 'vitest';
import { DOG_BOXES, DOG_CANON, DOG_METRICS, DOG_PIVOTS, type DogBox } from './relay-dog';

/**
 * THE RELAY DOG'S PROPORTIONS ARE TREATED LIKE A LOGO.
 *
 * Every assertion below is a canonical band from the founder's reference sheet,
 * expressed as a fraction of HEAD_WIDTH. This file exists because an earlier
 * build drifted to a torso at 0.89 of the head's width, legs at 0.31 and a visor
 * at 0.78 — individually small edits that together produced a barrel-chested,
 * thick-legged humanoid. Every one of those would pass a test that only checked
 * the model still had a head, two arms and two legs.
 */

const W = DOG_METRICS.headWidth;
const box = (name: string): DogBox => {
  const found = DOG_BOXES.find((b) => b.name === name);
  if (!found) throw new Error(`no box named ${name}`);
  return found;
};
const top = (b: DogBox) => b.center[1] + b.size[1] / 2;
const bottom = (b: DogBox) => b.center[1] - b.size[1] / 2;
const outerX = (b: DogBox) => Math.abs(b.center[0]) + b.size[0] / 2;

/** Assert a measurement sits inside its canonical band, as a fraction of W. */
const band = (label: string, value: number, [lo, hi]: readonly number[]) => {
  const ratio = value / W;
  expect(ratio, `${label} is ${ratio.toFixed(3)} of head width; canonical band is ${lo}–${hi}`)
    .toBeGreaterThanOrEqual(lo);
  expect(ratio, `${label} is ${ratio.toFixed(3)} of head width; canonical band is ${lo}–${hi}`)
    .toBeLessThanOrEqual(hi);
};

describe('canonical proportions', () => {
  it('keeps the torso far narrower than the head', () => {
    // THE defining contrast of the character.
    band('torso width', box('upperTorso').size[0], DOG_CANON.torsoWidth);
    band('torso width', box('midTorso').size[0], DOG_CANON.torsoWidth);
  });

  it('keeps the legs thin', () => {
    band('leg width', box('legLeft').size[0], DOG_CANON.legWidth);
    band('leg width', box('legRight').size[0], DOG_CANON.legWidth);
  });

  it('leaves an obvious gap between the legs', () => {
    const gap = Math.abs(box('legRight').center[0]) * 2 - box('legRight').size[0];
    band('leg gap', gap, DOG_CANON.legGap);
  });

  it('makes the feet wide, and wider than the legs', () => {
    band('foot width', box('footLeft').size[0], DOG_CANON.footWidth);
    expect(box('footLeft').size[0]).toBeGreaterThan(box('legLeft').size[0] * 1.3);
  });

  it('keeps the feet LOW, never boots', () => {
    // Wide + deep + low. Tall feet were a named error in the previous build.
    const foot = box('footLeft');
    expect(foot.size[1]).toBeLessThan(foot.size[0]);
    expect(foot.size[1]).toBeLessThan(foot.size[2]);
    expect(foot.size[2], 'the foot is deeper than it is wide').toBeGreaterThan(foot.size[0]);
  });

  it('sizes the ears, the visor and the eyes to the canonical bands', () => {
    band('ear width', box('earLeft').size[0], DOG_CANON.earWidth);
    band('visor width', box('visorInterior').size[0], DOG_CANON.visorWidth);
    band('eye width', box('eyeLeft').size[0], DOG_CANON.eyeWidth);
  });

  it('divides the height into three comparable regions', () => {
    const h = DOG_METRICS.height;
    band('head block', h - DOG_METRICS.torsoTop, DOG_CANON.heightSplit.head.map((x) => x * h / W) as number[]);
    band('torso', DOG_METRICS.torsoTop - DOG_METRICS.legTop, DOG_CANON.heightSplit.torso.map((x) => x * h / W) as number[]);
    band('legs + feet', DOG_METRICS.legTop, DOG_CANON.heightSplit.legs.map((x) => x * h / W) as number[]);
  });

  it('stands on the ground and reaches its declared height', () => {
    expect(Math.min(...DOG_BOXES.map(bottom))).toBeCloseTo(0, 3);
    expect(Math.max(...DOG_BOXES.map(top))).toBeCloseTo(DOG_METRICS.height, 3);
  });
});

describe('silhouette', () => {
  it('opens a notch under each of the head’s lower corners', () => {
    // The head overhangs the torso, and nothing may fill that space. Arms that
    // begin level with the head close it — which is exactly what happened once.
    const headBottom = bottom(box('headJaw'));
    const overhang = W / 2 - box('upperTorso').size[0] / 2;
    expect(overhang, 'the head must overhang the torso on both sides').toBeGreaterThan(0.15 * W);
    const armTop = Math.max(top(box('armLeftUpper')), top(box('armRightUpper')));
    expect(armTop, 'the arms must hang from below the head').toBeLessThan(headBottom);
    expect(headBottom - armTop, 'the notch must be obvious').toBeGreaterThan(0.05 * W);
  });

  it('lets the relaxed arms approach, but not dwarf, the head’s width', () => {
    const armSpan = Math.max(...DOG_BOXES.filter((b) => b.joint.startsWith('arm')).map(outerX)) * 2;
    expect(armSpan / W).toBeGreaterThan(0.95);
    expect(armSpan / W).toBeLessThan(1.2);
  });

  it('keeps every arm segment clear of the torso', () => {
    for (const name of ['armLeftUpper', 'armLeftForearm', 'armRightUpper', 'armRightForearm']) {
      const inner = Math.abs(box(name).center[0]) - box(name).size[0] / 2;
      expect(inner, `${name} must not merge into the torso`).toBeGreaterThan(box('midTorso').size[0] / 2);
    }
  });

  it('steps the lower torso down in stages rather than one rectangle', () => {
    const widths = ['upperTorso', 'midTorso', 'lowerTorso', 'pelvisStep'].map((n) => box(n).size[0]);
    expect(widths[2]).toBeLessThan(widths[1]);
    expect(widths[3]).toBeLessThan(widths[2]);
  });

  it('hangs the arms down to the upper thigh', () => {
    expect(bottom(box('armLeftHand'))).toBeLessThan(DOG_METRICS.legTop);
    expect(bottom(box('armLeftHand'))).toBeGreaterThan(DOG_METRICS.legTop - 0.2 * W);
  });

  it('builds each arm from stepped segments, not one prism', () => {
    for (const side of ['Left', 'Right']) {
      const segs = [`arm${side}Upper`, `arm${side}Forearm`, `arm${side}Hand`].map(box);
      expect(segs).toHaveLength(3);
      // Each segment drifts slightly outward as it descends.
      expect(Math.abs(segs[1].center[0])).toBeGreaterThan(Math.abs(segs[0].center[0]));
      expect(Math.abs(segs[2].center[0])).toBeGreaterThan(Math.abs(segs[1].center[0]));
    }
  });

  it('mirrors every paired part exactly', () => {
    for (const [l, r] of [
      ['earLeft', 'earRight'], ['eyeLeft', 'eyeRight'], ['headFrameLeft', 'headFrameRight'],
      ['armLeftUpper', 'armRightUpper'], ['armLeftHand', 'armRightHand'],
      ['legLeft', 'legRight'], ['footLeft', 'footRight'],
    ]) {
      expect(box(l).center[0]).toBeCloseTo(-box(r).center[0], 6);
      expect(box(l).size).toEqual(box(r).size);
    }
  });
});

describe('the head', () => {
  it('is the widest single mass in the character', () => {
    const widestTorso = Math.max(...['upperTorso', 'midTorso', 'lowerTorso', 'pelvisStep'].map((n) => box(n).size[0]));
    expect(W).toBeGreaterThan(widestTorso);
    expect(box('headBrow').size[0]).toBeCloseTo(W, 6);
  });

  it('is WIDER than it is tall — a helmet, not a portrait rectangle', () => {
    const headHeight = top(box('headBrow')) - bottom(box('headJaw'));
    expect(W).toBeGreaterThan(headHeight);
  });

  it('surrounds the visor with four thick ivory masses', () => {
    for (const n of ['headBrow', 'headJaw', 'headFrameLeft', 'headFrameRight']) {
      expect(box(n).surface).toBe('ivory');
    }
    // A heavy jaw below the visor: the character does not end under its eyes.
    expect(box('headJaw').size[1]).toBeGreaterThan(0.2 * W);
    expect(box('headBrow').size[1]).toBeGreaterThan(0.2 * W);
    expect(box('headFrameLeft').size[0]).toBeGreaterThan(0.1 * W);
  });

  it('recesses the visor into a cavity with real depth', () => {
    const faceZ = box('headBrow').center[2] + box('headBrow').size[2] / 2;
    const floorZ = box('visorInterior').center[2] + box('visorInterior').size[2] / 2;
    expect(faceZ - floorZ, 'the visor floor must sit well behind the face').toBeGreaterThan(0.15 * W);
  });

  it('makes the visor wider than it is tall', () => {
    expect(box('visorInterior').size[0]).toBeGreaterThan(box('visorInterior').size[1] * 1.6);
  });

  it('suspends two small eyes in the lower half of the cavity, with black around them', () => {
    const visor = box('visorInterior');
    const eye = box('eyeLeft');
    expect(eye.center[1], 'the eyes sit in the lower half of the visor').toBeLessThan(visor.center[1]);
    // Black above, between and outside.
    expect(top(visor) - top(eye)).toBeGreaterThan(0.06 * W);
    expect(Math.abs(eye.center[0]) - eye.size[0] / 2, 'black between the eyes').toBeGreaterThan(0.03 * W);
    expect(visor.size[0] / 2 - outerX(eye), 'black outside each eye').toBeGreaterThan(0.08 * W);
    // The pair must never approach filling the opening.
    const goldFraction = (box('eyeLeft').size[0] + box('eyeRight').size[0]) / visor.size[0];
    expect(goldFraction).toBeLessThan(0.45);
  });

  it('has exactly two chunky rectangular ears, inset from the corners', () => {
    const ears = DOG_BOXES.filter((b) => b.name.startsWith('ear'));
    expect(ears).toHaveLength(2);
    // Ivory remains outside each ear — they are not at the extreme corners.
    expect(W / 2 - outerX(ears[0])).toBeGreaterThan(0.04 * W);
    // The gap between them is far wider than either ear.
    const gap = Math.abs(ears[0].center[0]) * 2 - ears[0].size[0];
    expect(gap).toBeGreaterThan(ears[0].size[0] * 1.8);
    // Chunky, with real front-to-back thickness — never an antenna.
    expect(ears[0].size[2]).toBeGreaterThan(ears[0].size[0] * 0.8);
    expect(ears[0].size[1]).toBeLessThan(ears[0].size[0] * 2);
  });

  it('has meaningful head depth without becoming a cube', () => {
    const depth = box('headBrow').size[2];
    expect(depth).toBeGreaterThan(0.5 * W);
    expect(depth).toBeLessThan(W);
  });

  it('carries no facial feature beyond the visor and the two eyes', () => {
    const faceParts = DOG_BOXES.filter((b) => b.surface !== 'ivory');
    expect(faceParts.map((b) => b.name).sort()).toEqual(['eyeLeft', 'eyeRight', 'visorInterior']);
  });
});

describe('the tail', () => {
  const tail = DOG_BOXES.filter((b) => b.joint === 'tail');

  it('exists, in discrete stepped segments', () => {
    expect(tail.length).toBeGreaterThanOrEqual(4);
  });

  it('steps out, back and UP to a squared tip, tapering', () => {
    for (let i = 1; i < tail.length; i += 1) {
      expect(tail[i].center[0], 'further out').toBeGreaterThan(tail[i - 1].center[0]);
      expect(tail[i].center[2], 'further back').toBeLessThan(tail[i - 1].center[2]);
      expect(tail[i].center[1], 'and rising').toBeGreaterThan(tail[i - 1].center[1]);
      expect(tail[i].size[0], 'tapering').toBeLessThan(tail[i - 1].size[0]);
    }
  });

  it('bends upward: the tip rises well above where the tail leaves the hip', () => {
    expect(tail[tail.length - 1].center[1] - tail[0].center[1]).toBeGreaterThan(0.25 * W);
  });

  it('reads beyond the rear silhouette without dominating the body', () => {
    const reach = Math.min(...tail.map((t) => t.center[2] - t.size[2] / 2));
    expect(reach).toBeLessThan(-box('midTorso').size[2] / 2);
    const tailMass = tail.reduce((sum, t) => sum + t.size[0] * t.size[1] * t.size[2], 0);
    const torsoMass = ['upperTorso', 'midTorso'].reduce((sum, n) => {
      const b = box(n);
      return sum + b.size[0] * b.size[1] * b.size[2];
    }, 0);
    expect(tailMass).toBeLessThan(torsoMass * 0.4);
  });
});

describe('rig', () => {
  it('gives every box a joint that declares a pivot', () => {
    for (const b of DOG_BOXES) expect(DOG_PIVOTS[b.joint], `${b.name} → ${b.joint}`).toBeDefined();
  });

  it('pivots the arms at the torso’s upper OUTSIDE corners, not its centre', () => {
    expect(Math.abs(DOG_PIVOTS.armRight[0])).toBeCloseTo(box('upperTorso').size[0] / 2, 3);
    expect(DOG_PIVOTS.armRight[1]).toBeGreaterThan(box('armRightUpper').center[1]);
  });

  it('gives each leg its own hip anchor so the central gap survives animation', () => {
    expect(DOG_PIVOTS.legLeft[0]).toBeCloseTo(-DOG_PIVOTS.legRight[0], 6);
    expect(Math.abs(DOG_PIVOTS.legRight[0])).toBeGreaterThan(0);
    expect(DOG_PIVOTS.legRight[1]).toBeGreaterThan(box('legRight').center[1]);
  });

  it('roots the tail at the rear-side hip', () => {
    expect(DOG_PIVOTS.tail[0]).toBeGreaterThan(0);
    expect(DOG_PIVOTS.tail[2]).toBeLessThan(0);
  });

  it('pivots the head at the neck, with a hidden stub closing the gap', () => {
    expect(DOG_PIVOTS.head[1]).toBeCloseTo(DOG_METRICS.torsoTop, 3);
    // The stub must stay INSIDE the torso's width, or it becomes visible head.
    expect(box('headStub').size[0]).toBeLessThan(box('upperTorso').size[0]);
    expect(bottom(box('headStub'))).toBeLessThan(DOG_PIVOTS.head[1]);
  });
});

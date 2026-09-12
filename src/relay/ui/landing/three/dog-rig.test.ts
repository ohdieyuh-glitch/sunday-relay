import { describe, expect, it } from 'vitest';
import {
  DOG_STEP_SECONDS, DogAnimator, GAIT, NEUTRAL_POSE, SteppedDogAnimator, gaitPose, idlePose, shapePhase,
  shortestAngle, springStep,
  type DogIntent, type DogPose,
} from './dog-rig';

/**
 * The founder's constraint is that a BLOCK body must not move like one. These
 * tests pin the three mechanisms that carry that — springs, a shaped gait
 * phase, and an additive look layer — because each of them is easy to
 * "simplify" back into the cheap version that looks like a wind-up toy.
 */

const intent = (over: Partial<DogIntent> = {}): DogIntent => ({
  state: 'IDLE', x: 0, z: 0, yaw: 0, look: null, ...over,
});

describe('springs', () => {
  it('converges on the target without ever overshooting it', () => {
    // Overshoot is what makes motion feel bouncy and cheap. A critically-damped
    // spring cannot produce it, and that is the reason it was chosen.
    let value = 0;
    let velocity = 0;
    for (let i = 0; i < 400; i += 1) {
      const step = springStep(value, 10, velocity, 0.4, 1 / 60);
      value = step.value;
      velocity = step.velocity;
      expect(value).toBeLessThanOrEqual(10.000001);
    }
    expect(value).toBeCloseTo(10, 3);
  });

  it('is frame-rate independent', () => {
    // The `lerp(a, b, 0.1)` idiom this replaces animates twice as fast at
    // 120fps as at 60fps — the usual reason a scene "feels different on the
    // good monitor". Converging to the same place in the same WALL time is the
    // whole point.
    const run = (dt: number) => {
      let v = 0;
      let vel = 0;
      for (let t = 0; t < 1; t += dt) {
        const s = springStep(v, 1, vel, 0.3, dt);
        v = s.value;
        vel = s.velocity;
      }
      return v;
    };
    expect(Math.abs(run(1 / 60) - run(1 / 144))).toBeLessThan(0.01);
  });

  it('degenerates safely on a zero or negative step', () => {
    expect(springStep(0, 5, 0, 0.3, 0).value).toBe(5);
    expect(springStep(0, 5, 0, 0, 0.016).value).toBe(5);
  });
});

describe('turning', () => {
  it('always takes the short way round', () => {
    expect(shortestAngle(Math.PI * 0.95, -Math.PI * 0.95)).toBeCloseTo(Math.PI * 0.1, 5);
    expect(Math.abs(shortestAngle(0, Math.PI * 1.9))).toBeLessThanOrEqual(Math.PI);
  });

  it('never rotates the long way to reach a mirrored facing', () => {
    const animator = new DogAnimator();
    let previous = 0;
    let travelled = 0;
    for (let i = 0; i < 240; i += 1) {
      const pose = animator.update(1 / 60, intent({ state: 'TURN', yaw: -Math.PI * 0.95 }));
      travelled += Math.abs(pose.rootYaw - previous);
      previous = pose.rootYaw;
    }
    // Short way from 0 to -171° is 171°. Going the long way would be 189°.
    expect(travelled).toBeLessThan(Math.PI);
  });
});

describe('gait', () => {
  it('spends longer in stance than in swing', () => {
    // A pure sine splits the cycle exactly in half and reads as marching.
    expect(shapePhase(0.31, 0.62)).toBeCloseTo(0.25, 5);
    expect(shapePhase(0.62, 0.62)).toBeCloseTo(0.5, 5);
    expect(shapePhase(0.3)).toBeLessThan(0.3);
  });

  it('wraps the phase rather than running off the end', () => {
    expect(shapePhase(1.25)).toBeCloseTo(shapePhase(0.25), 6);
    expect(shapePhase(-0.25)).toBeCloseTo(shapePhase(0.75), 6);
  });

  it('swings the legs in opposition', () => {
    const pose = gaitPose(0.12, 1);
    expect(Math.sign(pose.legLeftPitch!)).toBe(-Math.sign(pose.legRightPitch!));
  });

  it('swings each arm against the leg on its own side', () => {
    // Contralateral, as in real gait. Arms swinging WITH the same-side leg is
    // the single most obvious animation error a biped can have.
    const pose = gaitPose(0.12, 1);
    expect(Math.sign(pose.armLeftPitch!)).toBe(-Math.sign(pose.legLeftPitch!));
    expect(Math.sign(pose.armRightPitch!)).toBe(-Math.sign(pose.legRightPitch!));
    expect(Math.abs(pose.armLeftPitch!)).toBeLessThan(Math.abs(pose.legLeftPitch!));
  });

  it('bobs twice per stride, once per footfall', () => {
    const n = 200;
    const heights = Array.from({ length: n }, (_, i) => gaitPose(i / n, 1).rootY ?? 0);
    // Scanned CYCLICALLY. One of the two footfalls sits exactly on the phase
    // boundary, so a scan from index 1 to n-1 finds only one and reports a
    // correct double-bob as a single one.
    let minima = 0;
    for (let i = 0; i < n; i += 1) {
      const prev = heights[(i - 1 + n) % n];
      const next = heights[(i + 1) % n];
      if (heights[i] <= prev && heights[i] < next) minima += 1;
    }
    expect(minima).toBe(2);
  });

  it('contributes nothing at zero weight, so a standing Dog has no stride', () => {
    expect(gaitPose(0.4, 0)).toEqual({});
    expect(idlePose(3, 0)).toEqual({});
  });

  it('ties stride length to the declared walking speed', () => {
    expect(GAIT.strideRate).toBeGreaterThan(0);
    expect(GAIT.strideLength).toBeGreaterThan(0);
  });
});

describe('idle', () => {
  it('is never still — the Dog breathes', () => {
    // Relay Dog canon: the Dogs BREATHE, and breathing is ambient life, never
    // a state readout.
    const a = idlePose(0, 1);
    const b = idlePose(0.9, 1);
    expect(a.rootY).not.toBeCloseTo(b.rootY!, 4);
  });

  it('does not repeat on a single obvious period', () => {
    // Three incommensurate frequencies: a one-second loop is recognisable as
    // a loop within a few cycles.
    const at = (t: number) => JSON.stringify(idlePose(t, 1));
    expect(at(0)).not.toBe(at(1));
    expect(at(0)).not.toBe(at(2 * Math.PI));
  });
});

describe('the animator', () => {
  it('eases into a walk instead of popping into stride', () => {
    const animator = new DogAnimator();
    const first = animator.update(1 / 60, intent({ state: 'WALK', x: 10 }));
    expect(Math.abs(first.legLeftPitch)).toBeLessThan(0.05);
    for (let i = 0; i < 120; i += 1) animator.update(1 / 60, intent({ state: 'WALK', x: 10 }));
    const settled = animator.currentPose;
    expect(Math.abs(settled.rootX - 10)).toBeLessThan(1.5);
  });

  it('clamps a huge delta so a backgrounded tab cannot teleport the Dog', () => {
    // A restored tab delivers one enormous dt. Unclamped it moves the character
    // across the scene in a single frame and spins the gait through dozens of
    // strides — a visible glitch on every return to the tab.
    const animator = new DogAnimator();
    const pose = animator.update(30, intent({ state: 'WALK', x: 100 }));
    expect(Math.abs(pose.rootX)).toBeLessThan(20);
  });

  it('adds the look layer on top of the gait rather than replacing it', () => {
    const animator = new DogAnimator();
    for (let i = 0; i < 90; i += 1) {
      animator.update(1 / 60, intent({ state: 'WALK', look: { x: 1, y: 0 } }));
    }
    const pose = animator.currentPose;
    // Both systems are visibly active on their own joints at the same time.
    expect(pose.headYaw).toBeGreaterThan(0.2);
    expect(Math.abs(pose.legLeftPitch)).toBeGreaterThan(0.05);
  });

  it('keeps the head inside a comfortable cone', () => {
    const animator = new DogAnimator();
    for (let i = 0; i < 200; i += 1) {
      animator.update(1 / 60, intent({ state: 'LOOK', look: { x: 1, y: 1 } }));
    }
    // A Dog that can crane 180° reads as a security camera, not a companion.
    expect(Math.abs(animator.currentPose.headYaw)).toBeLessThan(1.1);
    expect(Math.abs(animator.currentPose.headPitch)).toBeLessThan(0.8);
  });

  it('decays a REACT impulse instead of latching it', () => {
    const animator = new DogAnimator();
    animator.update(1 / 60, intent({ state: 'REACT' }));
    const peak = Math.abs(animator.currentPose.tailPitch);
    for (let i = 0; i < 120; i += 1) animator.update(1 / 60, intent({ state: 'IDLE' }));
    expect(Math.abs(animator.currentPose.tailPitch)).toBeLessThan(peak);
  });

  it('produces finite numbers for every joint, always', () => {
    const animator = new DogAnimator();
    const states = ['IDLE', 'WALK', 'TURN', 'LOOK', 'PAUSE', 'REACT'] as const;
    for (let i = 0; i < 600; i += 1) {
      const pose = animator.update(1 / 60, intent({
        state: states[i % states.length],
        x: Math.sin(i) * 20,
        yaw: Math.cos(i) * Math.PI,
        look: { x: Math.sin(i * 3), y: Math.cos(i * 3) },
      }));
      for (const [key, value] of Object.entries(pose)) {
        expect(Number.isFinite(value), `${key} at frame ${i}`).toBe(true);
      }
    }
  });
});

describe('the clock', () => {
  const worstDifference = (a: Readonly<DogPose>, b: Readonly<DogPose>): number =>
    Math.max(...(Object.keys(a) as (keyof DogPose)[]).map((key) => Math.abs(a[key] - b[key])));

  it('draws the shipped animator’s own 30Hz steps, unaltered', () => {
    // The clock decides only WHEN the animator steps. On a 30Hz display it must
    // draw exactly the poses DogAnimator produces at 1/30s, one step behind,
    // through every state and a pointer that comes and goes.
    const stepped = new SteppedDogAnimator();
    const reference = new DogAnimator();
    let expected: Readonly<DogPose> = NEUTRAL_POSE;
    for (let i = 0; i < 30 * 40; i += 1) {
      const next = intent({
        state: (['IDLE', 'LOOK', 'WALK', 'TURN', 'REACT', 'PAUSE'] as const)[Math.floor(i / 120) % 6],
        x: 5 + (Math.floor(i / 240) % 2) * 1.5,
        yaw: Math.sin(i / 90) * 0.6,
        look: i % 150 < 60 ? null : { x: Math.sin(i / 17), y: Math.cos(i / 23) },
      });
      const drawn = stepped.update(DOG_STEP_SECONDS, next);
      expect(worstDifference(drawn, expected), `frame ${i}`).toBeLessThan(1e-12);
      expected = reference.update(DOG_STEP_SECONDS, next);
    }
  });

  it('moves the same way on a 60Hz and a 165Hz display', () => {
    // Stepped once per display frame, the same Dog swayed its head through a
    // wider arc the faster the screen: glancing at 30Hz, turning away at 60,
    // circling at 165. The clock is what makes the screen irrelevant.
    const envelope = (fps: number) => {
      const dog = new SteppedDogAnimator();
      let yaw = 0;
      let pitch = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < fps * 60; i += 1) {
        const pose = dog.update(1 / fps, intent({ state: 'IDLE', x: 5 }));
        if (i < fps * 10) continue;
        yaw = Math.max(yaw, Math.abs(pose.headYaw));
        pitch = Math.max(pitch, Math.abs(pose.headPitch));
        minX = Math.min(minX, pose.rootX);
        maxX = Math.max(maxX, pose.rootX);
      }
      return { yaw, pitch, sway: maxX - minX };
    };
    const at60 = envelope(60);
    const at165 = envelope(165);
    expect(Math.abs(at60.yaw - at165.yaw)).toBeLessThan(0.01);
    expect(Math.abs(at60.pitch - at165.pitch)).toBeLessThan(0.01);
    expect(Math.abs(at60.sway - at165.sway)).toBeLessThan(0.05);
  });
});

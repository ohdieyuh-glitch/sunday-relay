/**
 * RELAY DOG ANIMATION — a block body that must not move like a block.
 *
 * The founder's constraint is exact: the geometric identity stays voxel, the
 * MOTION must be premium. So nothing here snaps, nothing lerps toward a target
 * at a fixed fraction per frame, and no joint is driven by a raw sine alone.
 *
 * Three mechanisms carry that:
 *
 *   1. CRITICALLY-DAMPED SPRINGS for every continuous quantity (facing, head
 *      aim, position, gait weight). A spring has no overshoot, no wobble, and
 *      — unlike `lerp(a, b, 0.1)` — is FRAME-RATE INDEPENDENT. The lerp idiom
 *      silently animates twice as fast at 120fps as at 60fps, which is the
 *      usual reason a scene "feels different on the good monitor".
 *   2. A SHAPED GAIT PHASE. Real legs spend longer in stance than in swing;
 *      a pure sine spends exactly half in each and reads as a wind-up toy.
 *   3. AN ADDITIVE LOOK LAYER. Head aim is added on top of whatever the gait is
 *      doing rather than replacing it, so the Dog can watch the pointer while
 *      walking without the two systems fighting for the same joint.
 *
 * This module is PURE — no Three.js, no DOM, no clock. It takes a state and a
 * delta and returns numbers. That is what makes the gait and the state machine
 * testable on a machine with no GPU, which is where this was built.
 */

/** The behaviours the landing choreography can ask for. */
export type DogState = 'IDLE' | 'WALK' | 'TURN' | 'LOOK' | 'PAUSE' | 'REACT';

/** Joint angles in radians, plus a root offset. Consumed by the Three.js host. */
export type DogPose = {
  rootX: number;
  rootY: number;
  rootZ: number;
  /** Facing, radians. 0 faces +Z, toward the camera. */
  rootYaw: number;
  rootRoll: number;
  headPitch: number;
  headYaw: number;
  armLeftPitch: number;
  armRightPitch: number;
  legLeftPitch: number;
  legRightPitch: number;
  tailPitch: number;
  tailYaw: number;
};

export const NEUTRAL_POSE: DogPose = Object.freeze({
  rootX: 0, rootY: 0, rootZ: 0, rootYaw: 0, rootRoll: 0,
  headPitch: 0, headYaw: 0,
  armLeftPitch: 0, armRightPitch: 0,
  legLeftPitch: 0, legRightPitch: 0,
  tailPitch: 0, tailYaw: 0,
});

/**
 * One step of a critically-damped spring.
 *
 * `smoothTime` is the approximate time to converge, in seconds — an intuitive
 * dial, unlike a raw stiffness. The implementation is the standard
 * Game-Programming-Gems form: stable for any `dt`, and it cannot overshoot, so
 * a head aim can never wobble past its target and back.
 */
export function springStep(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  dt: number,
): { value: number; velocity: number } {
  if (smoothTime <= 0 || dt <= 0) return { value: target, velocity: 0 };
  const omega = 2 / smoothTime;
  const x = omega * dt;
  // Padé approximation of exp(-x) — cheaper than Math.exp and accurate here.
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  const nextVelocity = (velocity - omega * temp) * exp;
  return { value: target + (change + temp) * exp, velocity: nextVelocity };
}

/** Shortest signed angular difference, so a turn never takes the long way. */
export function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Reshape a linear 0..1 gait phase so STANCE occupies more of the cycle than
 * SWING. `bias` above 0.5 lengthens stance. This single function is most of the
 * difference between "walking" and "marching".
 */
export function shapePhase(phase: number, bias = 0.62): number {
  const p = ((phase % 1) + 1) % 1;
  return p < bias ? (p / bias) * 0.5 : 0.5 + ((p - bias) / (1 - bias)) * 0.5;
}

/** Gait tuning, in radians and units. Named so a review can argue with a value. */
export const GAIT = Object.freeze({
  // KEPT SHORT ON PURPOSE. A block leg rotating about a pivot at its top
  // separates visibly from the hip block once the swing passes roughly 0.4rad —
  // there is no skinning here to hide the joint. It is also the founder's
  // brief: a companion inhabiting the interface, not a hyperactive mascot.
  legSwing: 0.36,
  /** Arms counter-swing at a fraction of the legs — never in sympathy. */
  armSwingRatio: 0.58,
  /** Vertical bob happens TWICE per stride, once per footfall. */
  bobAmplitude: 0.18,
  /** Weight shifts side to side ONCE per stride, onto the stance leg. */
  swayAmplitude: 0.13,
  rollAmplitude: 0.022,
  /** Strides per second at the Dog's natural walking speed. */
  strideRate: 0.78,
  /** Units travelled per stride — ties foot speed to ground speed. */
  strideLength: 5.6,
});

/**
 * The locomotion layer. Returns the pose contribution of the gait alone; the
 * look layer and the state machine's transforms are applied on top.
 *
 * `weight` is how "walking" the Dog currently is, 0..1. Blending the GAIT by a
 * weight rather than cross-fading two finished poses is what lets the Dog ease
 * into and out of a walk instead of popping into stride.
 */
export function gaitPose(phase: number, weight: number): Partial<DogPose> {
  if (weight <= 0) return {};
  const p = shapePhase(phase);
  const a = p * Math.PI * 2;
  const swing = Math.sin(a);
  const opposite = Math.sin(a + Math.PI);
  return {
    legLeftPitch: swing * GAIT.legSwing * weight,
    legRightPitch: opposite * GAIT.legSwing * weight,
    // Arms oppose the leg on the SAME side — contralateral, as in real gait.
    armLeftPitch: opposite * GAIT.legSwing * GAIT.armSwingRatio * weight,
    armRightPitch: swing * GAIT.legSwing * GAIT.armSwingRatio * weight,
    // Two footfalls per stride, so the bob runs at double frequency.
    rootY: -Math.abs(Math.cos(a)) * GAIT.bobAmplitude * weight,
    rootX: swing * GAIT.swayAmplitude * weight,
    rootRoll: swing * GAIT.rollAmplitude * weight,
    tailPitch: Math.sin(a * 2 + 0.6) * 0.16 * weight,
    tailYaw: swing * 0.2 * weight,
  };
}

/**
 * The idle layer. A standing Dog is never still: it breathes, shifts weight,
 * and its tail drifts. Three incommensurate frequencies keep the loop from
 * reading as a loop — a single sine is instantly recognisable as one.
 *
 * Breathing is deliberate. It is Relay Dog canon that the Dogs BREATHE, and
 * that breathing is ambient life, never a state readout.
 */
export function idlePose(time: number, weight: number): Partial<DogPose> {
  if (weight <= 0) return {};
  const breathe = Math.sin(time * 1.15);
  const shift = Math.sin(time * 0.37);
  const drift = Math.sin(time * 0.61 + 1.2);
  return {
    rootY: breathe * 0.055 * weight,
    rootX: shift * 0.09 * weight,
    rootRoll: shift * 0.012 * weight,
    headPitch: breathe * 0.018 * weight,
    headYaw: drift * 0.05 * weight,
    tailYaw: Math.sin(time * 0.8) * 0.13 * weight,
    tailPitch: breathe * 0.05 * weight,
    armLeftPitch: breathe * 0.02 * weight,
    armRightPitch: -breathe * 0.02 * weight,
  };
}

/** How long each state takes to blend in, seconds. REACT is the only fast one. */
export const STATE_BLEND: Readonly<Record<DogState, number>> = Object.freeze({
  IDLE: 0.55, WALK: 0.45, TURN: 0.4, LOOK: 0.35, PAUSE: 0.7, REACT: 0.18,
});

/** What the choreography asks of the Dog on a given frame. */
export type DogIntent = {
  readonly state: DogState;
  /** Where the Dog should stand, in world units. */
  readonly x: number;
  readonly z: number;
  /** Where it should face, radians. */
  readonly yaw: number;
  /** Normalised pointer, -1..1 on each axis, or null when there is no pointer. */
  readonly look: { x: number; y: number } | null;
};

/**
 * Drives a `DogPose` over time from a stream of intents.
 *
 * The class holds only springs and one phase accumulator, so it is
 * deterministic given a sequence of `(dt, intent)` — which is exactly how
 * `dog-rig.test.ts` exercises the gait and the transitions without a renderer.
 */
export class DogAnimator {
  private pose: DogPose = { ...NEUTRAL_POSE };
  private phase = 0;
  private elapsed = 0;
  private state: DogState = 'IDLE';
  private gaitWeight = 0;
  private reactImpulse = 0;
  private readonly v = {
    x: 0, z: 0, yaw: 0, gait: 0, headYaw: 0, headPitch: 0,
  };

  get currentState(): DogState {
    return this.state;
  }

  /** Snapshot of the last computed pose. */
  get currentPose(): Readonly<DogPose> {
    return this.pose;
  }

  update(dt: number, intent: DogIntent): Readonly<DogPose> {
    // A tab restored from the background delivers a single enormous dt. Left
    // unclamped it teleports the Dog and spins the gait through dozens of
    // strides in one frame — a visible glitch on every return to the tab.
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.elapsed += step;

    if (intent.state !== this.state) {
      if (intent.state === 'REACT') this.reactImpulse = 1;
      this.state = intent.state;
    }

    const wantsGait = this.state === 'WALK';
    const blend = STATE_BLEND[this.state];
    const gait = springStep(this.gaitWeight, wantsGait ? 1 : 0, this.v.gait, blend, step);
    this.gaitWeight = gait.value;
    this.v.gait = gait.velocity;

    // The phase advances with the gait weight, so easing out of a walk also
    // eases the stride down rather than freezing a leg mid-air.
    this.phase = (this.phase + step * GAIT.strideRate * this.gaitWeight) % 1;

    const x = springStep(this.pose.rootX, intent.x, this.v.x, 0.9, step);
    const z = springStep(this.pose.rootZ, intent.z, this.v.z, 0.9, step);

    // Turning goes the short way. Springing the raw target instead makes a Dog
    // asked to face -179° from +179° rotate almost all the way around.
    const yawTarget = this.pose.rootYaw + shortestAngle(this.pose.rootYaw, intent.yaw);
    const yaw = springStep(this.pose.rootYaw, yawTarget, this.v.yaw, this.state === 'TURN' ? 0.5 : 0.85, step);

    // Look layer. The head aims at the pointer within a comfortable cone; a Dog
    // that can crane 180° reads as a security camera, not a companion.
    // A NARROW CONE. At 0.6rad, plus an attentive boost, plus whatever the body
    // was already doing, the head reached angles where it read as detached
    // rather than attentive — a companion glancing over, not a turret.
    const lookYawTarget = intent.look ? intent.look.x * 0.22 : 0;
    const lookPitchTarget = intent.look ? -intent.look.y * 0.09 : 0;
    const attentive = this.state === 'LOOK' || this.state === 'REACT' ? 1.15 : 1;
    const headYaw = springStep(this.pose.headYaw, lookYawTarget * attentive, this.v.headYaw, 0.45, step);
    const headPitch = springStep(this.pose.headPitch, lookPitchTarget * attentive, this.v.headPitch, 0.5, step);

    this.reactImpulse = Math.max(0, this.reactImpulse - step * 1.6);
    // A short, decaying perk-up: ears lift via a small pitch, tail flicks.
    const react = this.reactImpulse * this.reactImpulse;

    const idleWeight = 1 - this.gaitWeight;
    const g = gaitPose(this.phase, this.gaitWeight);
    const i = idlePose(this.elapsed, idleWeight);
    const add = (key: keyof DogPose): number => (g[key] ?? 0) + (i[key] ?? 0);

    this.pose = {
      rootX: x.value + add('rootX'),
      rootY: add('rootY') + react * 0.28,
      rootZ: z.value,
      rootYaw: yaw.value,
      rootRoll: add('rootRoll'),
      headPitch: headPitch.value + add('headPitch') - react * 0.13,
      headYaw: headYaw.value + add('headYaw'),
      armLeftPitch: add('armLeftPitch'),
      armRightPitch: add('armRightPitch'),
      legLeftPitch: add('legLeftPitch'),
      legRightPitch: add('legRightPitch'),
      tailPitch: add('tailPitch') + react * 0.4,
      tailYaw: add('tailYaw') + Math.sin(this.elapsed * 9) * react * 0.35,
    };
    this.v.x = x.velocity;
    this.v.z = z.velocity;
    this.v.yaw = yaw.velocity;
    this.v.headYaw = headYaw.velocity;
    this.v.headPitch = headPitch.velocity;
    return this.pose;
  }
}

/**
 * THE DOG'S CLOCK. The animator above is kept exactly as it shipped; this is
 * only how often it is stepped.
 *
 * `DogAnimator` has one frame-rate dependence its springs do not cover: each
 * spring starts from the COMPOSED pose, so the idle layer is folded back in on
 * every step and the head's sway grows with the number of steps per second.
 * Stepped 30 times a second, the head glances and tilts with its face kept
 * toward the viewer. At 60 the face turns away; on a 165Hz display the head
 * circles. Stepping it once per display frame made the Dog's character a
 * property of whatever screen it was opened on.
 *
 * So it is CLOCKED rather than retuned: fixed 1/30s steps whatever the display
 * runs at, drawn as a blend of the last two steps, so a high-refresh screen
 * gets smooth motion along the same path instead of visible 30Hz stepping.
 */
export const DOG_STEP_SECONDS = 1 / 30;

const POSE_KEYS = Object.keys(NEUTRAL_POSE) as (keyof DogPose)[];

export class SteppedDogAnimator {
  private readonly animator = new DogAnimator();
  private previous: Readonly<DogPose> = NEUTRAL_POSE;
  private latest: Readonly<DogPose> = NEUTRAL_POSE;
  private carry = 0;

  update(dt: number, intent: DogIntent): DogPose {
    // The animator's own clamp, so a tab restored from the background cannot
    // queue a burst of catch-up steps.
    this.carry += Math.min(Math.max(dt, 0), 0.05);
    while (this.carry >= DOG_STEP_SECONDS) {
      this.previous = this.latest;
      this.latest = this.animator.update(DOG_STEP_SECONDS, intent);
      this.carry -= DOG_STEP_SECONDS;
    }
    const t = this.carry / DOG_STEP_SECONDS;
    const pose = { ...NEUTRAL_POSE };
    for (const key of POSE_KEYS) {
      pose[key] = this.previous[key] + (this.latest[key] - this.previous[key]) * t;
    }
    return pose;
  }
}

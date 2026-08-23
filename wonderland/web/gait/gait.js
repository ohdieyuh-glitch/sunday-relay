// The Relay Dog's walk, in the browser — a MIRROR of WonderlandDogGait.cpp.
//
// Not the authority. The C++ is, because that is what the engine runs and what
// the founder will be looking at. Two implementations of the same arithmetic
// drift silently; the placement math already taught that lesson, which is why
// the Marble inspector consumes a contract instead of re-deriving a basis.
//
// The gait cannot be handed over as a contract in the same way — it is a
// function, not a table of constants — so the discipline is the other one:
// WonderlandDogGait.test.cpp --golden emits 64 sampled poses, and
// gait.parity.test.mjs asserts every number here matches. If this file drifts
// from the engine by so much as 1e-4, that test fails.
//
// Keep the structure identical to the C++, line for line, so a reader can put
// them side by side. Cleverness here would be a liability.

/** Fraction of the stride a paw spends on the ground. Mirrors WalkDutyFactor. */
export const WALK_DUTY_FACTOR = 0.65;

// ---------------------------------------------------------------- gait model
// Mirrors WonderlandGait::GaitForSpeed. See that header for why the thresholds
// are Froude numbers rather than uu/s. Checked sample-for-sample against the
// engine's own table by gait.parity.test.mjs.
const GRAVITY_UU = 980;
const WALK_OFFSETS = [0.00, 0.50, 0.75, 0.25];
const TROT_OFFSETS = [0.00, 0.50, 0.50, 0.00];
const RUN_OFFSETS  = [0.00, 0.12, 0.55, 0.67];

const lerp = (a, b, t) => a + (b - a) * t;

/** Blend two phases the SHORT way round the circle — a plain lerp from 0.9 to
 *  0.1 sweeps backwards through 0.5, which is a visible kick mid-transition. */
function blendPhase(a, b, t) {
  let d = b - a;
  while (d > 0.5) d -= 1;
  while (d < -0.5) d += 1;
  return frac(a + d * t);
}

/** 0 below lo, 1 above hi, smoothstep between — so the gait does not change
 *  RATE abruptly at either end of a band, which is its own kind of snap. */
function band(v, lo, hi) {
  if (hi <= lo) return v >= hi ? 1 : 0;
  let t = (v - lo) / (hi - lo);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function gaitForSpeed(speedUU, hipHeightUU) {
  const hip = hipHeightUU > 1 ? hipHeightUU : 1;
  const speed = speedUU > 0 ? speedUU : 0;
  const fr = (speed * speed) / (GRAVITY_UU * hip);
  const trotBlend = band(fr, 0.35, 0.65);
  const runBlend = band(fr, 2.10, 2.90);

  const relStride = 1.05 + 1.35 * Math.sqrt(fr);
  const strideLength = hip * (relStride < 1.05 ? 1.05 : relStride > 3.6 ? 3.6 : relStride);
  const dutyFactor = lerp(lerp(WALK_DUTY_FACTOR, 0.45, trotBlend), 0.34, runBlend);
  const liftHeight = hip * lerp(lerp(0.125, 0.185, trotBlend), 0.26, runBlend);
  const bobHeight = hip * lerp(lerp(0.025, 0.045, trotBlend), 0.07, runBlend);

  const legOffset = [0, 1, 2, 3].map(i =>
    blendPhase(blendPhase(WALK_OFFSETS[i], TROT_OFFSETS[i], trotBlend),
               RUN_OFFSETS[i], runBlend));

  let gait = 'walk', blend = trotBlend;
  if (speed < 1) { gait = 'idle'; blend = 0; }
  else if (runBlend > 0.5) { gait = 'run'; blend = runBlend; }
  else if (trotBlend > 0.5) { gait = 'trot'; blend = trotBlend; }
  return { gait, dutyFactor, strideLength, liftHeight, bobHeight, legOffset, blend };
}

function frac(v) {
  const f = v - Math.floor(v);
  return f < 0 ? f + 1 : f;
}

/** 0 LH, 1 RH, 2 LF, 3 RF -> footfall order LH, LF, RH, RF.
 *  A LARGER OFFSET LANDS THE PAW SOONER — see the C++ note. */
export function legPhaseOffset(legIndex) {
  switch (legIndex) {
    case 0: return 0.0;    // left hind  — first down, at phase 0.00
    case 2: return 0.75;   // left fore  — a quarter stride later
    case 1: return 0.5;    // right hind — half a stride
    case 3: return 0.25;   // right fore — three quarters
    default: return 0.0;
  }
}

/**
 * @returns {{forward:number, lift:number, stance:boolean}}
 *   forward — local offset along the Dog's facing axis, Unreal units
 *   lift    — height above the paw's resting position; zero during stance
 *   stance  — true while planted, when the paw must not move in WORLD space
 */
export function legPose(stridePhase, strideLength, liftHeight, dutyFactor = WALK_DUTY_FACTOR) {
  const p = frac(stridePhase);
  // Clamped, not trusted: duty 0 floats the Dog, duty 1 skates it, silently.
  const duty = dutyFactor < 0.15 ? 0.15 : dutyFactor > 0.95 ? 0.95 : dutyFactor;
  const reach = strideLength * duty * 0.5;

  if (p < duty) {
    // STANCE. Planted, so relative to a forward-moving body the paw travels
    // BACKWARD at exactly the body's speed. +reach -> -reach over the stance is
    // strideLength * duty, precisely what the body covers. That is the foot lock.
    return { forward: reach - (p / duty) * (2 * reach), lift: 0, stance: true };
  }
  // SWING. A sine arch, so the paw leaves and meets the ground with zero
  // vertical speed instead of stabbing at it.
  const w = (p - duty) / (1 - duty);
  return {
    forward: -reach + w * (2 * reach),
    lift: liftHeight * Math.sin(Math.PI * w),
    stance: false,
  };
}

/** Body carriage for the same phase. Bob peaks twice per stride. */
export function bodyPose(stridePhase, bobHeight) {
  const p = frac(stridePhase);
  const twoPi = 6.28318530717958647692;
  return {
    // Twice per stride: the body rises as each diagonal pair takes weight.
    bob: bobHeight * Math.sin(twoPi * 2 * p),
    // A quarter-cycle behind the bob, so the nose dips as weight lands.
    pitch: 1.2 * Math.sin(twoPi * 2 * p - 1.5707963),
    // Once per stride: weight rolls left, then right.
    roll: 1.8 * Math.sin(twoPi * p),
  };
}

/** How a rigid, blocky leg is carried so the paw reaches legPose's target.
 *  Mirrors WonderlandGait::LegSwing — see that header for why a stretching
 *  limb, and not a knee, is the right answer for this Dog.
 *  @returns {{pitchDeg:number, stretch:number}} */
export function legSwing(pose, legLength) {
  if (!(legLength > 0)) return { pitchDeg: 0, stretch: 1 };
  const rise = legLength - pose.lift;
  const reach = Math.sqrt(pose.forward * pose.forward + rise * rise);
  return {
    pitchDeg: Math.atan2(pose.forward, rise) * (180 / Math.PI),
    stretch: reach / legLength,
  };
}

/** Where the paw is in WORLD terms along the travel axis. Constant through
 *  stance is the whole point. */
export function worldPawForward(distanceTravelled, legOffset, strideLength, liftHeight) {
  const phase = distanceTravelled / strideLength + legOffset;
  return distanceTravelled + legPose(phase, strideLength, liftHeight).forward;
}

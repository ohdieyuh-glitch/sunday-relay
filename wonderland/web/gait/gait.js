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
export function legPose(stridePhase, strideLength, liftHeight) {
  const p = frac(stridePhase);
  const reach = strideLength * WALK_DUTY_FACTOR * 0.5;

  if (p < WALK_DUTY_FACTOR) {
    // STANCE. Planted, so relative to a forward-moving body the paw travels
    // BACKWARD at exactly the body's speed. +reach -> -reach over the stance is
    // strideLength * duty, precisely what the body covers. That is the foot lock.
    return { forward: reach - (p / WALK_DUTY_FACTOR) * (2 * reach), lift: 0, stance: true };
  }
  // SWING. A sine arch, so the paw leaves and meets the ground with zero
  // vertical speed instead of stabbing at it.
  const w = (p - WALK_DUTY_FACTOR) / (1 - WALK_DUTY_FACTOR);
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

/** Where the paw is in WORLD terms along the travel axis. Constant through
 *  stance is the whole point. */
export function worldPawForward(distanceTravelled, legOffset, strideLength, liftHeight) {
  const phase = distanceTravelled / strideLength + legOffset;
  return distanceTravelled + legPose(phase, strideLength, liftHeight).forward;
}

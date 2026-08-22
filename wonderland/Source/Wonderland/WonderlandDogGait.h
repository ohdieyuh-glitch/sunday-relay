// The Relay Dog's walk, as arithmetic.
//
// WHY THIS IS A SEPARATE, ENGINE-FREE FILE
//
// The founder's note is that the Dogs "slide, teleport, jitter, snap" and read
// as "a model being translated through space while its legs twitch". That is
// exactly what was happening, and not as a bug: AWonderlandStrollingDog::Tick
// called SetActorLocation on a root that four static cubes are welded to. There
// was no gait at all. The animation module next door is a RESOLVER — it maps a
// Relay motion to an enum name — and nothing consumed those names visually.
//
// The one property that decides whether a walk reads as walking is FOOT LOCK:
// while a paw is on the ground it must not move in WORLD space. If it drifts
// even slightly the eye reads skating, no matter how good the rest is. That is
// a testable arithmetic claim, so it lives here in plain floats with no UE
// types, and WonderlandDogGait.test.cpp compiles it with g++ and proves the
// world-space paw position is constant through stance — on a laptop, with no
// engine and no GPU.
//
// PHASE IS DRIVEN BY DISTANCE TRAVELLED, NEVER BY A CLOCK. A gait advanced by
// time drifts out of step with the body the moment speed changes, which is the
// "mismatch between movement speed and animation speed" that makes legs twitch
// while the body glides. Feeding it distance makes the two the same quantity by
// construction: they cannot disagree.
#pragma once

namespace WonderlandGait
{
	/** Fraction of the stride a paw spends on the ground. 0.65 is a walk; a
	 *  trot is nearer 0.5 and a run below it. Above 0.5 at least two paws are
	 *  always down, which is what keeps a walk looking unhurried. */
	inline constexpr float WalkDutyFactor = 0.65f;

	/** Lateral-sequence walk — the order a real dog puts paws down:
	 *  left hind, left fore, right hind, right fore, evenly spaced.
	 *  Index order matches the body's part table: 0 LH, 1 RH, 2 LF, 3 RF. */
	float LegPhaseOffset(int LegIndex);

	struct FLegPose
	{
		/** Local offset along the Dog's facing axis, in Unreal units. */
		float Forward = 0.0f;
		/** Height above the paw's resting position. Zero during stance. */
		float Lift = 0.0f;
		/** True while the paw is planted and must not move in world space. */
		bool bStance = true;
	};

	struct FBodyPose
	{
		/** Vertical bob. Two peaks per stride: the body rises over each pair. */
		float Bob = 0.0f;
		/** Nose-down/up, degrees. Small; a walking dog barely pitches. */
		float Pitch = 0.0f;
		/** Weight shifting side to side, degrees. */
		float Roll = 0.0f;
	};

	/**
	 * @param StridePhase   distance travelled / stride length, plus the leg's
	 *                      offset. Any real value; only the fraction matters.
	 * @param StrideLength  how far the body moves in one full cycle, uu.
	 * @param LiftHeight    peak paw lift during swing, uu.
	 */
	FLegPose LegPose(float StridePhase, float StrideLength, float LiftHeight);

	/** Body carriage for the same phase. Bob peaks twice per stride. */
	FBodyPose BodyPose(float StridePhase, float BobHeight);

	/** Where the paw is in WORLD terms along the travel axis, given how far the
	 *  body has gone. Constant through stance is the whole point, and the test
	 *  asserts exactly that. */
	float WorldPawForward(float DistanceTravelled, float LegOffset,
	                      float StrideLength, float LiftHeight);
}

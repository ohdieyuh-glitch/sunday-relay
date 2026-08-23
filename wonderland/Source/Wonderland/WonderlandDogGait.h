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

	/** How a rigid, blocky leg is carried so the paw reaches LegPose's target.
	 *
	 *  A LEG THAT SLIDES IS NOT A LEG. Translating the leg cube forward and
	 *  back puts the paw in the right place and still reads as a box being
	 *  shunted along a rail, because nothing about it PIVOTS. Every walking
	 *  animal, and every blocky character in the voxel idiom this Dog belongs
	 *  to, swings the whole limb from the hip.
	 *
	 *  A rigid limb rotated about the hip traces an ARC, so its paw lifts off
	 *  the ground exactly when it should be planted — which is why translation
	 *  was reached for. The way out is not to add a knee: a knee is a different
	 *  silhouette and this Dog's proportions are its identity. It is to let the
	 *  limb stretch by the small amount the arc is short by. Over the whole
	 *  gait that is at most about five percent, invisible on a blocky leg, and
	 *  the paw lands exactly where LegPose says — so foot lock is preserved
	 *  EXACTLY rather than approximately.
	 */
	struct FLegSwing
	{
		/** Degrees about the lateral axis. Positive carries the paw FORWARD. */
		float PitchDeg = 0.0f;
		/** Length multiplier along the limb so the paw reaches. ~1.00-1.05. */
		float Stretch = 1.0f;
	};

	/** @param LegLength  hip-to-paw distance at rest, uu. */
	FLegSwing LegSwing(const FLegPose& Pose, float LegLength);

	/** Where a Dog may not walk — staging, not gait, but the same kind of thing
	 *  and testable for the same reason: it is arithmetic, so it lives in plain
	 *  floats here rather than inside an actor where only a GPU could check it.
	 *
	 *  Pushes (X,Y) out to the rim of a circle it has strayed inside, along its
	 *  own bearing. Radius <= 0 is no exclusion at all. A point exactly at the
	 *  centre has no bearing, so it leaves along +X — arbitrary, but defined,
	 *  because the alternative is a NaN that propagates into a transform. */
	void PushOutOfColumn(float X, float Y, float CentreX, float CentreY,
	                     float Radius, float& OutX, float& OutY);

	/** Where the paw is in WORLD terms along the travel axis, given how far the
	 *  body has gone. Constant through stance is the whole point, and the test
	 *  asserts exactly that. */
	float WorldPawForward(float DistanceTravelled, float LegOffset,
	                      float StrideLength, float LiftHeight);
}

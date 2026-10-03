// THE MISSION HANDOFF'S ATTACK-READY STANCE -- as arithmetic, beside RelayDogStride and in its own terms.
//
// FOUNDER, 2026-10-02 (MISSION HANDOFF COMBAT STANCE + HIGH-SPEED ROAMING): while the twin swords are held the Relay Dog is
// "visibly in an armed, attack-ready stance" -- grounded, the body slightly forward, the arms visibly carrying both
// blades out from the body, the shoulders and torso ready, the feet spaced -- in idle, walk, run and the starts and stops
// between them. "Avoid stiff T-pose-like weapon holding; avoid overly exaggerated crouching." Ordinary roaming is
// unchanged.
//
// A LAYER, NOT A SECOND ANIMATOR. FDogAnimator stays the one authority for how the Dog moves: its phase, its foot lock, its
// springs, its gait bands. This takes the pose it returned and lays the stance onto it, by two weights the caller eases
// (armed, dashing), so a weight of zero leaves the animator's pose EXACTLY as it was -- normal roaming is untouched by
// construction. The legs are re-solved with RelayDogStride's own two-bone solve, onto the same feet, with the pelvis
// lower: a planted foot stays planted. Every skin wears the result, because every skin wears the canon's pose.
//
// Engine-free, like RelayDogStride, so its promises are arithmetic: zero weight is identity, the crouch keeps the sole
// under the hip, nothing is ever asked of a leg that the canon proportions cannot make.
#pragma once

#include "RelayDogStride.h"

namespace RelayDogArmedStance
{
	/**
	 * The stance's shape, in the animator's own angles (degrees; the signs RelayDogStride writes: a positive shoulder
	 * swings the arm forward, a positive elbow folds the forearm forward and up, a positive outward sweep takes the arm
	 * away from the body).
	 */
	struct FShape
	{
		/** Body lean added, standing and walking (the run already leans hard; see RunLeanDeg). */
		float LeanDeg = 8.0f;
		float RunLeanDeg = 3.0f;
		/** How far the pelvis rides lower, standing and walking, uu: a ready knee, never a squat. */
		float CrouchUU = 10.0f;
		/** Each hip swept outward: the feet spaced for movement. */
		float FeetOutDeg = 19.0f;
		/**
		 * Each thigh turned outward about the vertical (the knees out over the toes), degrees. FeetOut is a roll, so the knee folds in a
		 * plane facing forward -- a bend the gameplay camera, BEHIND the Dog, barely sees (round 4: ~58 deg of knee read as straight).
		 * Turned out, the same bend shows from behind. 0 = the look before it (the founder picks from wl.Qa.StanceCalib's L frames).
		 */
		float KneesOutDeg = 0.0f;
		/** The ready arms, standing and walking: raised forward and out, the forearms up -- the blades carried out from the body. */
		float ReadyShoulderDeg = 12.0f;
		float ReadyElbowDeg = 25.0f;
		float ReadyOutDeg = 44.0f;
		/** How much of the walk's own arm swing stays with the blades in hand: they are carried, not flung. */
		float SwingKeep = 0.3f;
		/** Running (the animator's arms-back posture): the blades trail, swept out so they clear the legs, forearms a little bent. */
		float RunOutDeg = 32.0f;
		float RunElbowAddDeg = 14.0f;
		/** The dash: a stronger lean and both blades swept back and out, like the trails they leave. */
		float DashLeanDeg = 10.0f;
		float DashShoulderDeg = -70.0f;
		float DashElbowDeg = 10.0f;
		float DashOutDeg = 24.0f;
		/** Seconds to ease the stance in or out (a critically damped spring: nothing pops), and the dash in or out. */
		float ArmedSmoothSeconds = 0.22f;
		float DashSmoothSeconds = 0.07f;
	};

	/** The two weights, eased by the caller every frame. */
	struct FState
	{
		RelayDogStride::FSpring Armed;
		RelayDogStride::FSpring Dash;
	};

	/** Ease the weights toward the state: armed while the swords are held, dashing while a dash is under way. */
	void Step(FState& State, bool bArmed, bool bDashing, float DeltaSeconds, const FShape& Shape = FShape());

	/**
	 * The stance laid onto the animator's pose, in place. Both weights 0: the pose is left exactly as it was.
	 *
	 * @param LeftOutFactor, RightOutFactor  +1 when a positive FArmPose::ShoulderYawDeg carries that arm AWAY from the body on
	 *        this rig, -1 when it carries it in. The writer rolls a shoulder by ShoulderYawDeg x the arm's side; the rig's own
	 *        outward roll is MEASURED at bind (RelayDogLimbs: OutwardSign), and the two need not agree -- the stance QA caught
	 *        the "outward" sweep drawing the hands together (ST2, 2026-10-02). So the stance's sweeps go through the measured
	 *        sign; the animator's own arms-back roll is left exactly as it was.
	 */
	void Apply(RelayDogStride::FDogPose& Pose, float ArmedWeight, float DashWeight, float LegLengthUU, float ThighUU, float ShinUU,
		float LeftOutFactor, float RightOutFactor, const FShape& Shape = FShape());

	/** How far each hip is swept outward at these weights. The pose has no field for a leg's sweep, so the caller writes it. */
	float FeetOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape = FShape());

	/** How far each thigh is turned outward at these weights (standing and walking; none in the run). The caller writes it as a yaw. */
	float KneesOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape = FShape());
}

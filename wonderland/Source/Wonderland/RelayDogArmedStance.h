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
		// THE FOUNDER'S CANONICAL STANCE, 2026-10-03 (the reference photo; it supersedes the P2 "wider stance"): legs relatively close
		// together, one foot a little ahead, knees only slightly bent, the torso upright, shoulders level, the arms LOWERED and the
		// blades held low and diagonal, out and down from the body -- composed, ready to move, never a wide split or a crouch.
		/** Body lean added, standing and walking: upright (the run already leans; see RunLeanDeg). */
		float LeanDeg = 2.0f;
		float RunLeanDeg = 3.0f;
		/** How far the pelvis rides lower, standing and walking, uu: on the canon leg 1.5 uu is a ~30 deg knee -- slightly bent. */
		float CrouchUU = 1.5f;
		/** Each hip swept outward: a touch -- the feet stay about hip width apart (P2's 19 deg doubled the spacing). */
		float FeetOutDeg = 2.0f;
		/**
		 * Each thigh turned outward about the vertical (the knees out over the toes), degrees. FeetOut is a roll, so the knee folds in a
		 * plane facing forward -- a bend the gameplay camera, BEHIND the Dog, barely sees (round 4: ~58 deg of knee read as straight).
		 * Turned out, the same bend shows from behind. 0 = the look before it (the founder picks from wl.Qa.StanceCalib's L frames).
		 */
		float KneesOutDeg = 0.0f;
		/**
		 * THE OFFSET FOOT (the reference): standing, the Dog's own LEFT foot -- the gold sword's side, the canon's Pose.LegRight, which
		 * hangs at -Y -- this far ahead of the hip, and its right foot 30% of it behind, uu. Faded out as the gait comes in, so the walk's
		 * own feet take over.
		 */
		float StaggerUU = 6.0f;
		/** The ready arms, standing and walking: LOWERED, a little forward and away from the body, the elbows soft -- the blades low. */
		float ReadyShoulderDeg = 4.0f;
		float ReadyElbowDeg = 18.0f;
		float ReadyOutDeg = 14.0f;
		/** How much of the walk's own arm swing stays with the blades in hand: they are carried, not flung. */
		float SwingKeep = 0.3f;
		/** Running (the animator's arms-back posture): the blades trail, swept out so they clear the legs, forearms a little bent. */
		float RunOutDeg = 20.0f;
		float RunElbowAddDeg = 14.0f;
		/** The dash (the founder's Genshin sprint reference): a sprinter's arms -- a little back and out, still PUMPING with the stride
		 *  (DashSwingKeep of the run's own swing), the blades trailing low. The sprint's lean comes from the stride (SprintStride). */
		float DashLeanDeg = 2.0f;
		float DashShoulderDeg = -25.0f;
		float DashElbowDeg = 20.0f;
		float DashOutDeg = 12.0f;
		float DashSwingKeep = 0.8f;
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

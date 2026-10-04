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
		//
		// THE FOUNDER'S TWO STATES, 2026-10-04 (the last photo and the last video; "these are separate states"):
		//   STANDING -- the summon, the swords equipped, ready, idle -- is the PHOTO: the torso mostly upright, a subtle natural tilt,
		//     relaxed asymmetry (one leg carrying more weight, the hips and shoulders offset), narrow to moderate feet, swords low.
		//   FAST MOVEMENT -- the armed run, the burst, the sprint -- is the VIDEO: the body bent well forward, charging, and the
		//     locomotion a run of rapid powerful HOPS (push off, airborne, land, spring straight into the next), never a run cycle.
		// The bend is about the HIPS and the legs are re-solved onto their feet, through the body's own hierarchy -- never the actor.
		/** The forward bend STANDING, degrees, about the hips (+ = the chest forward): the photo's upright torso, a touch forward. */
		float BendDeg = 3.0f;
		/** Armed, moving at an ordinary pace: a little more. */
		float RunBendDeg = 6.0f;
		/** FAST (the hop and the dash): the video's charging bend. */
		float FastBendDeg = 38.0f;
		/** The hips across toward the loaded leg, and forward, uu (standing). */
		float HipForwardUU = 0.5f;
		float HipShiftUU = 3.0f;
		/** The pelvis angled: the free (front) hip this much lower, degrees; and the body turned a little to lead with the front side. */
		float TiltDeg = 4.0f;
		float TurnDeg = 5.0f;
		/** The head held this share level through the bend (1 = looking straight ahead, 0 = bent with the body). */
		float HeadKeep = 0.8f;
		/** How far the pelvis rides lower, standing and walking, uu: knees soft, not a crouch. */
		float CrouchUU = 3.0f;
		/**
		 * THE FAST HOP (the video, studied frame by frame at 30 fps: a deep forward bend, a push about every 0.2 s, the push leg left
		 * stretched far behind, a short low flight, the landing pressed and sprung at once). FAST comes in between FastFromUU and
		 * FastFullUU of ground speed (the armed run is 728) and at once with a dash. Hops a second = HopRateBase + speed / HopRatePerUU,
		 * within HopRateMin..Max; the planted foot passes HopReachUU each side of the hip, so the contact is as short as the speed
		 * needs and a planted foot never slides; the pushed leg trails HopTrailUU behind; the swinging knee tucks HopTuckUU; the body
		 * rises HopApexUU through the flight and presses HopCompressUU into each landing.
		 */
		float FastFromUU = 480.0f;
		float FastFullUU = 700.0f;
		float FastSmoothSeconds = 0.15f;
		float HopRateBase = 2.2f;
		float HopRatePerUU = 500.0f;
		float HopRateMin = 3.0f;
		float HopRateMax = 5.5f;
		float HopReachUU = 24.0f;
		float HopTrailUU = 40.0f;
		float HopTuckUU = 18.0f;
		float HopApexUU = 9.0f;
		float HopCompressUU = 3.0f;
		/** Each hip swept outward: a touch -- the feet stay about hip width apart (P2's 19 deg doubled the spacing). */
		float FeetOutDeg = 2.0f;
		/**
		 * Each thigh turned outward about the vertical (the knees out over the toes), degrees. FeetOut is a roll, so the knee folds in a
		 * plane facing forward -- a bend the gameplay camera, BEHIND the Dog, barely sees (round 4: ~58 deg of knee read as straight).
		 * Turned out, the same bend shows from behind. 0 = the look before it (the founder picks from wl.Qa.StanceCalib's L frames).
		 */
		float KneesOutDeg = 0.0f;
		/**
		 * THE FEET (standing): the Dog's own LEFT foot -- the gold sword's side, the canon's Pose.LegRight, which hangs at -Y -- this far
		 * ahead of the hips, relaxed; its RIGHT foot this far behind, carrying the weight, uu. Faded out as the gait comes in, so the
		 * walk's own feet take over.
		 */
		float FrontUU = 6.0f;
		float RearUU = 5.0f;
		/** The ready arms, standing and walking: LOWERED, a little forward and away from the body, the elbows soft -- the blades low. */
		float ReadyShoulderDeg = 4.0f;
		float ReadyElbowDeg = 55.0f;
		float ReadyOutDeg = 6.0f;
		/** How much of the walk's own arm swing stays with the blades in hand: they are carried, not flung. */
		float SwingKeep = 0.3f;
		/** Running (the animator's arms-back posture): the blades trail, swept out so they clear the legs, forearms a little bent. */
		float RunOutDeg = 20.0f;
		float RunElbowAddDeg = 14.0f;
		/** The dash (the founder's Genshin sprint reference): a sprinter's arms -- a little back and out, still PUMPING with the stride
		 *  (DashSwingKeep of the stride's own swing, never the run's locked arms-back), the blades trailing low. */
		float DashShoulderDeg = -25.0f;
		float DashElbowDeg = 20.0f;
		float DashOutDeg = 4.0f;   // round 7a4 S4: at 12 the pumping hands carried a tip 89.5 uu out (half the body is 87)
		float DashSwingKeep = 0.8f;
		/** Seconds to ease the stance in or out (a critically damped spring: nothing pops), and the dash in or out. */
		float ArmedSmoothSeconds = 0.22f;
		float DashSmoothSeconds = 0.07f;
	};

	/**
	 * THE STATES, EXPLICIT (founder, 10-04: "implement the behavior as clearly separated states"), as weights eased every frame so
	 * nothing snaps: SUMMON and READY/IDLE are Armed at standing (the photo); NORMAL MOVEMENT is Armed with the gait coming in; HIGH-
	 * SPEED MOVEMENT is Fast (the hop); the DASH/BURST is Dash (and Fast); STOP/RECOVERY is Fast and the gait easing back out, the body
	 * rising into the standing stance. HopPhase counts hops (each whole number a landing), advancing only while Fast is on.
	 */
	struct FState
	{
		RelayDogStride::FSpring Armed;
		RelayDogStride::FSpring Dash;
		RelayDogStride::FSpring Fast;
		float HopPhase = 0.0f;
		float HopRate = 0.0f;
	};

	/** Which of the founder's states the weights are in, for the log and the QA ("summon/ready", "moving", "fast hop", "dash"...). */
	const char* StateName(const FState& State, float GaitWeight);

	/** Ease the weights toward the state: armed while the swords are held, dashing while a dash is under way, fast above FastFromUU. */
	void Step(FState& State, bool bArmed, bool bDashing, float SpeedUU, float DeltaSeconds, const FShape& Shape = FShape());

	/**
	 * The stance laid onto the animator's pose, in place. Both weights 0: the pose is left exactly as it was.
	 *
	 * @param LeftOutFactor, RightOutFactor  +1 when a positive FArmPose::ShoulderYawDeg carries that arm AWAY from the body on
	 *        this rig, -1 when it carries it in. The writer rolls a shoulder by ShoulderYawDeg x the arm's side; the rig's own
	 *        outward roll is MEASURED at bind (RelayDogLimbs: OutwardSign), and the two need not agree -- the stance QA caught
	 *        the "outward" sweep drawing the hands together (ST2, 2026-10-02). So the stance's sweeps go through the measured
	 *        sign; the animator's own arms-back roll is left exactly as it was.
	 */
	/**
	 * @param HipPivotUU  the hips' height above the body root's pivot, uu, as the rig has them (the bend turns about it).
	 * @param HipYLeft, HipYRight  Pose.LegLeft's and Pose.LegRight's hips across the body, uu, as measured (the canon's LegLeft
	 *        hangs at +Y). The leg on HipYRight's side is the front one.
	 * The body's part goes to Pose.Stance (in the rig's own signs), each leg's sweep to Pose.Stance.Leg*OutDeg.
	 */
	void Apply(RelayDogStride::FDogPose& Pose, float ArmedWeight, float DashWeight, float FastWeight, float HopPhase, float LegLengthUU,
		float ThighUU, float ShinUU, float LeftOutFactor, float RightOutFactor, float HipPivotUU, float HipYLeft, float HipYRight,
		const FShape& Shape = FShape());

	/** How far each hip is swept outward at these weights while moving (Apply folds it into each leg's own sweep). */
	float FeetOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape = FShape());

	/** How far each thigh is turned outward at these weights (standing and walking; none in the run). The caller writes it as a yaw. */
	float KneesOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape = FShape());
}

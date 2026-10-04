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
		float FastBendDeg = 42.0f;
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
		// A BINARY TARGET WITH HYSTERESIS (Second's port, 4b5790e3: a ramp between two speeds left a steady 590 at a part weight forever, two
		// leg solutions blended and both feet dragged ~22-39 uu a frame): FAST comes ON at FastFullUU and goes OFF below FastFromUU, so between
		// them the Dog stays in whichever state it was in, and the 0.15 s spring is the only blend
		float FastFromUU = 520.0f;
		float FastFullUU = 640.0f;
		float FastSmoothSeconds = 0.15f;
		float FastOffSeconds = 0.25f;
		/** 0 = THE VIDEO's lunge-skip (the rear leg stretched behind, the front foot tapping); 1 = the alternating bound. */
		int HopStyle = 0;
		float HopRateBase = 3.5f;
		float HopRatePerUU = 800.0f;
		float HopRateMin = 3.5f;
		float HopRateMax = 6.0f;
		float HopReachUU = 28.0f;
		float HopTrailUU = 40.0f;
		float HopTuckUU = 18.0f;
		float HopApexUU = 4.0f;
		float HopCompressUU = 2.0f;
		/** The skip: the body this much lower, the tapping foot's lift between taps, the trailing foot's skim over the ground, uu. */
		float HopCrouchUU = 8.0f;
		float HopTapLiftUU = 6.0f;
		float HopSkimUU = 5.0f;   // over PlantBandUU: the trailing foot skims in the air, never a "down" foot dragged
		/**
		 * THE PLANTED FOOT, HELD IN THE WORLD (Second's port: blending two leg solutions dragged the feet through every transition). A foot
		 * whose target is within PlantBandUU of the ground LOCKS where it is and is held there through the Dog's REAL motion (Step carries
		 * it), until its target rises out of the band or drifts PlantSlackUU away; then a CATCH-UP STEP of CatchUpSeconds takes it, lifted
		 * at least CatchUpLiftUU at the middle, to the target -- across the ground only while it is above the band, so it never glides.
		 */
		float PlantBandUU = 2.5f;
		float PlantSlackUU = 12.0f;
		float CatchUpSeconds = 0.12f;
		float CatchUpLiftUU = 6.0f;
		/** QA ONLY (wl.Handoff.Hop.QaSkate; the ST2C9 control): the tapping foot's contact moves this share of the ground speed in the world
		 *  and no foot is locked -- a skating hop, which ST2C9 must turn RED. 0 in play. */
		float QaSkate = 0.0f;
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
		float DashShoulderDeg = -33.0f;   // Second's port fit (10-04): the low-handed skins' tips >= +2 through the hop
		float DashElbowDeg = 20.0f;
		float DashOutDeg = 4.0f;   // round 7a4 S4: at 12 the pumping hands carried a tip 89.5 uu out (half the body is 87)
		float DashSwingKeep = 0.6f;     // ...and the back swing stopping at the horizontal (a 32 deg pump)
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
	/** One foot held in the world: where, in the ACTOR's frame (X forward, Y right, from the actor's origin), as of this frame. */
	struct FFootLock
	{
		bool bLocked = false;
		float X = 0.0f;
		float Y = 0.0f;
		/** A catch-up step's progress 0..1 (1 = none under way). bFromWorld: it left a spot still DOWN (drifted off), so From is that spot,
		 *  held in the world; else the target rose and From is the lock's offset from it, eased out in the air (the target's own swing
		 *  leaves the ground still in the world; holding the foot back on its spot and then catching up whipped it ~70 uu a frame). */
		float StepS = 1.0f;
		bool bFromWorld = false;
		float FromX = 0.0f;
		float FromY = 0.0f;
	};

	/**
	 * THE FEET HELD IN THE WORLD, carried through the actor's REAL motion each frame (Second's review: an odometer -- speed x time along the
	 * facing -- skates a planted foot on every turn, slope, wall and correction; mouse-steering a sprint is a constant turn). [0] Pose.LegLeft
	 * (+Y), [1] Pose.LegRight (-Y). Released, with no catch-up, on a discontinuity: a frame over 50 ms, a jump over 150 uu, the hop off.
	 */
	struct FFeetLock
	{
		FFootLock Foot[2];
		float DeltaSeconds = 0.0f;
		/** Counted for the QA: catch-ups forced by a foot drifting PlantSlackUU from its lock, and locks dropped by a discontinuity. */
		int Overstretches = 0;
		int Drops = 0;
	};

	struct FState
	{
		RelayDogStride::FSpring Armed;
		RelayDogStride::FSpring Dash;
		RelayDogStride::FSpring Fast;
		/** FAST's target, held between FastFromUU and FastFullUU (hysteresis); off only after FastOffSeconds below FastFromUU (or at
		 *  once under half of it: a real stop), so a wobbling stick does not flip the body faster than its spring blends. */
		bool bFastOn = false;
		float BelowFor = 0.0f;
		float HopPhase = 0.0f;
		float HopRate = 0.0f;
		/** The ground speed the phase advanced by this frame: the stride is laid out from the same number (one speed). */
		float HopSpeed = 0.0f;
		FFeetLock Feet;
	};

	/** Which of the founder's states the weights are in, for the log and the QA ("summon/ready", "moving", "fast hop", "dash"...). */
	const char* StateName(const FState& State, float GaitWeight);

	/**
	 * Ease the weights toward the state: armed while the swords are held, dashing while a dash is under way, fast ON at FastFullUU and OFF
	 * below FastFromUU. MoveForwardUU / MoveRightUU / TurnDeg: the actor's REAL motion over this frame, in its frame of the frame before
	 * (forward, right, and its yaw's change, + = to the right); they carry the locked feet. bJumped: a teleport or a respawn this frame.
	 */
	void Step(FState& State, bool bArmed, bool bDashing, float SpeedUU, float DeltaSeconds, const FShape& Shape = FShape(),
		float MoveForwardUU = 0.0f, float MoveRightUU = 0.0f, float TurnDeg = 0.0f, bool bJumped = false);

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
	 * @param Feet  the feet held in the world (FState::Feet, carried by Step); null = no lock (the targets as they are).
	 */
	void Apply(RelayDogStride::FDogPose& Pose, float ArmedWeight, float DashWeight, float FastWeight, float HopPhase, float HopRate, float HopSpeedUU,
		float LegLengthUU, float ThighUU, float ShinUU, float LeftOutFactor, float RightOutFactor, float HipPivotUU, float HipYLeft, float HipYRight,
		const FShape& Shape = FShape(), FFeetLock* Feet = nullptr);

	/** How far each hip is swept outward at these weights while moving (Apply folds it into each leg's own sweep). */
	float FeetOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape = FShape());

	/** How far each thigh is turned outward at these weights (standing and walking; none in the run). The caller writes it as a yaw. */
	float KneesOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape = FShape());
}

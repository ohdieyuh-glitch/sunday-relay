// THE RELAY DOG'S MISSION PERFORMANCE, AS ARITHMETIC — the half that needs no engine.
//
// The same division as RelayDogStride.h, and for the same reason: everything that can be decided with
// numbers is decided here, where it can be read and reasoned about, and RelayDogCharacter is left with
// only the things that genuinely need a world — finding the joints, tracing the ground, moving a capsule.
//
// WHAT THIS SOLVES. The founder's canon of 2026-09-15 gives the Dog four performances (float, read, paint,
// beam; see WonderlandDogPerformance.h for the table and its numbers). This turns the act the mission is
// in, plus a clock and where the Mission Contract is, into an OVERLAY on the walking pose: how far the
// body lifts, where the head looks, where the arms are, whether the Dog should be circling the contract,
// and whether the beam is running.
//
// AN OVERLAY, NOT A REPLACEMENT. The stride system keeps solving the walk underneath — that is what makes
// `orbit_contract` a real walk around the diamond rather than a slide, and it is why a mission performance
// cannot break locomotion: at Weight 0 every field here is identity and the Dog is exactly the Dog.
//
// TWO RULES THAT COME STRAIGHT FROM THE SPEC AND ARE EASY TO GET BACKWARDS:
//
//   1. `None` IS NOT "STOP". EWonderlandDogAct::None means "whatever the Dog was already doing", and it is
//      where handoff lands — so during a handoff mid-implementation the paintbrush must stay on screen and
//      keep painting. It is ALSO where completion and idle land, which need the opposite. The two are told
//      apart by the Mission Contract: it exists for exactly as long as the mission does, so
//         None + a contract  = INHERIT, keep performing
//         None + no contract = the mission is over, blend back to the ordinary Dog.
//
//   2. THE BEAM IS BOUND TO THE ACT, NOT INHERITED. The spec's transition table ends the beam on
//      verifying -> complete, so the beam runs only while the act IS VerificationBeam. Everything else
//      about the pose may inherit; the beam may not, or it would outlive the checking it represents.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandDogPerformance.h"

namespace RelayDogMission
{
	/**
	 * THE READING POSE, as numbers the character supplies every frame (from wl.Dog.Read.*), so the look can be
	 * settled against film in a running editor instead of one rebuild per guess.
	 *
	 * The first reading pose raised both arms out to the sides and hung the book off the left forearm, where it
	 * lay on its side facing the Dog's ribs: no camera could see a page, and nothing on screen turned. Now the
	 * book is held in front of the chest, open toward the face; the left arm comes forward under it and stays;
	 * the right arm rests on the right-hand page, carries a page across to the left, and comes back.
	 */
	struct FReadingPose
	{
		/** The holding (left) arm: forward, a little out, the elbow bent up under the book. */
		float HoldPitchDeg = 78.0f;
		float HoldRollDeg = 14.0f;
		float HoldElbowDeg = 72.0f;
		/** The turning (right) arm at rest, its hand on the right-hand page. */
		float TurnPitchDeg = 74.0f;
		float TurnRollDeg = 16.0f;
		float TurnElbowDeg = 66.0f;
		/** How far the hand travels carrying a page: across toward the holding hand, and lifted at mid-turn. */
		float SweepRollDeg = -34.0f;
		float SweepPitchDeg = 12.0f;
		float SweepElbowDeg = 18.0f;
		/** Head pitch while reading, degrees down: the gaze on the pages. */
		float HeadPitchDeg = 30.0f;
		/** Turns per second, and the fraction of each cycle the page is actually moving. */
		float TurnHz = 0.32f;
		float TurnFraction = 0.34f;
	};

	/** Where a page is in its turn: 0 lying on the right-hand page, 1 on the left, NEGATIVE between turns. */
	float PageTurnProgress(const FReadingPose& Pose, float TimeSeconds);

	/** What the world knows this frame. Angles are degrees, in the Dog's own frame. */
	struct FStageInput
	{
		/** The reading pose's numbers. Defaults are the settled look; the character overrides them live. */
		FReadingPose Reading;

		float DeltaSeconds = 0.0f;
		/** The world clock. Every cyclic part of a performance is computed ABSOLUTELY from this, like the
		 *  rest of the Dog, so a long frame or a paused editor cannot leave a limb mid-stroke. */
		float TimeSeconds = 0.0f;

		/** Whether a Mission Contract exists at all. See rule 1 above -- this is what separates a handoff
		 *  from the end of a mission, and nothing else can. */
		bool bHasContract = false;
		/** Yaw from where the Dog is facing to the contract, degrees, signed. Zero means facing it. */
		float ContractYawDeg = 0.0f;
		/** Pitch from the Dog's eyes to the contract, degrees. Negative looks up. */
		float ContractPitchDeg = 0.0f;
		/** Ground distance to the contract, uu. */
		float ContractDistanceUU = 0.0f;

		/** True while a player is actually steering. A performance never fights input: the orbit yields,
		 *  the pose stays. Locomotion is a protected system and the mission layer is a guest in it. */
		bool bPlayerDriving = false;
	};

	/** The overlay to add on top of the solved walking pose. At Weight 0 every field is identity. */
	struct FStageOverlay
	{
		/** 0 while the Dog is ordinary, 1 while a performance is fully in. Everything below is already
		 *  scaled by it, so a caller adds these values without weighting them again. */
		float Weight = 0.0f;

		/** How far the whole body is lifted off the ground, uu, hover included. */
		float LiftUU = 0.0f;

		float HeadPitchDeg = 0.0f;
		float HeadYawDeg = 0.0f;

		/** Added to each shoulder. Pitch swings the limb forward, roll opens it outward; the caller
		 *  multiplies roll by the arm's own side sign. */
		float ShoulderPitchLeftDeg = 0.0f;
		float ShoulderPitchRightDeg = 0.0f;
		float ShoulderRollDeg = 0.0f;
		/** Added to the WORKING arm's roll only -- the repair's lateral drag across the fault, and the
		 *  page-turning hand sweeping across the book. The holding arm never gets it. */
		float ShoulderRollExtraDeg = 0.0f;
		float ElbowDeg = 0.0f;
		/** Added to the WORKING arm's elbow only: the turning hand bends differently from the holding one. */
		float ElbowExtraDeg = 0.0f;
		/** How much of the WALK's own arm swing to keep, 1 all of it. A hand holding a book open does not swing
		 *  with the stride, or the book it is under would float free of it. */
		float ArmStrideKeep = 1.0f;

		/** Added to both hips, so suspended legs hang instead of standing on nothing. */
		float HipDeg = 0.0f;

		/** True while the Dog should be walking a circle about the contract, and the world-space bearing
		 *  to walk. The caller turns this into movement input; the stride system does the rest. */
		bool bOrbit = false;
		float OrbitBearingDeg = 0.0f;
		/** How fast to walk the circle, as a fraction of the reading pace. An inspection lingers. */
		float OrbitPace = 1.0f;

		/**
		 * TURN THE DOG TO FACE THE CONTRACT. Not tidiness -- an act done AT the work has to be done facing
		 * it. The research circle ends with the Dog tangential, about 90 degrees off the radius, and
		 * nothing used to turn it back, so review and repair inherited that stance and held it for their
		 * whole length. It stayed hidden because the beam aims itself and therefore looked correct however
		 * the Dog was standing.
		 */
		bool bFaceContract = false;

		/** Which prop should be in hand, and how far it has faded in. */
		EWonderlandDogProp Prop = EWonderlandDogProp::None;
		float PropWeight = 0.0f;
		/** While the book is in hand: where the turning page is (PageTurnProgress), negative when none is turning. */
		float PageTurn = -1.0f;

		/** The verification beam: on only while the act is VerificationBeam, faded by BeamWeight. */
		bool bBeam = false;
		float BeamWeight = 0.0f;
	};

	/**
	 * The performance, across frames.
	 *
	 * It holds the act, the act it is fading OUT of, and the blend between them, so no stage change pops --
	 * "no hard cuts" in the spec's words. A prop leaves over the same blend it arrived on.
	 */
	class FPerformer
	{
	public:
		/** From the mission. `bContractPresent` is the whole of telling a handoff from an ending. */
		void SetAct(EWonderlandDogAct Act, bool bContractPresent);

		/** The act actually being performed, which during a handoff is the INHERITED one, not None. */
		EWonderlandDogAct Performing() const { return Current; }
		/** The act the mission last reported, before inheritance, and the beam's own fade. For diagnosis. */
		EWonderlandDogAct ReportedAct() const { return Reported; }
		float BeamFade() const { return BeamWeight; }

		FStageOverlay Update(const FStageInput& In);

		/** Seconds a stage takes to fade in or out. */
		float BlendSeconds = 0.45f;

	private:
		EWonderlandDogAct Current = EWonderlandDogAct::None;
		/** The act being faded OUT of, so one stage descends into the next instead of cutting. Without it,
		 *  float -> read drops the body 64 uu in a frame: both acts are "performing", so the in/out blend
		 *  never moves and only the lift's value changes. */
		EWonderlandDogAct Previous = EWonderlandDogAct::None;
		/** The act the mission last reported, before the inherit rule was applied. Kept only so the beam
		 *  can be bound to the reported act while the pose inherits. */
		EWonderlandDogAct Reported = EWonderlandDogAct::None;
		float Weight = 0.0f;
		/** 0 the instant an act changes, 1 once the new one has fully arrived. */
		float Cross = 1.0f;
		float BeamWeight = 0.0f;
	};

	/** The two numbers the table states as "down from horizontal" turned into this rig's rotations:
	 *  a hanging limb points down, roll takes it outward, pitch takes it forward. Exposed for tests. */
	void ArmAnglesFor(const FWonderlandDogActReading& Reading, float& OutPitchDeg, float& OutRollDeg);
}

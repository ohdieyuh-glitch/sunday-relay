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
	/** What the world knows this frame. Angles are degrees, in the Dog's own frame. */
	struct FStageInput
	{
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
		float ElbowDeg = 0.0f;

		/** Added to both hips, so suspended legs hang instead of standing on nothing. */
		float HipDeg = 0.0f;

		/** True while the Dog should be walking a circle about the contract, and the world-space bearing
		 *  to walk. The caller turns this into movement input; the stride system does the rest. */
		bool bOrbit = false;
		float OrbitBearingDeg = 0.0f;

		/** Which prop should be in hand, and how far it has faded in. */
		EWonderlandDogProp Prop = EWonderlandDogProp::None;
		float PropWeight = 0.0f;

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

		FStageOverlay Update(const FStageInput& In);

		/** Seconds a stage takes to fade in or out. */
		float BlendSeconds = 0.45f;

	private:
		EWonderlandDogAct Current = EWonderlandDogAct::None;
		/** The act the mission last reported, before the inherit rule was applied. Kept only so the beam
		 *  can be bound to the reported act while the pose inherits. */
		EWonderlandDogAct Reported = EWonderlandDogAct::None;
		float Weight = 0.0f;
		float BeamWeight = 0.0f;
	};

	/** The two numbers the table states as "down from horizontal" turned into this rig's rotations:
	 *  a hanging limb points down, roll takes it outward, pitch takes it forward. Exposed for tests. */
	void ArmAnglesFor(const FWonderlandDogActReading& Reading, float& OutPitchDeg, float& OutRollDeg);
}

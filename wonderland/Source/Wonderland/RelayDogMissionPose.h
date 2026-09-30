// THE RELAY DOG'S MISSION PERFORMANCE, AS ARITHMETIC — the half that needs no engine.
//
// The same division as RelayDogStride.h: what can be decided with numbers is decided here, and RelayDogCharacter keeps
// only what needs a world -- where the joints and the Mission Contract actually are, the inverse kinematics that put
// the hands on the book, the brush and the lens, the props, the beam and the camera.
//
// THE FOUNDER'S LIFECYCLE, 2026-09-16 (evening), which supersedes every earlier table:
//
//   PREPARATION     the Dog MEDITATES and FLOATS: legs crossed, hands on the knees, eyes closed, lifted off the ground;
//                   energy gathers in front of it and the Mission Contract appears out of it.
//   RESEARCH        it walks its circle round the Contract READING a book held in its hands -- one hand under the book,
//                   the other turning the pages -- head bowed to the pages.
//   IMPLEMENTATION  it walks round the Contract PAINTING it with the brush in its working hand; the other arm hangs.
//   VERIFICATION    it FLIES UP, hovers, aims both hands at the Contract and HOLDS the beam for the whole stage.
//   REVIEW          it walks slowly round the Contract with a MAGNIFYING GLASS at its eye.
//   REPAIR          it stops at the fault: IDENTIFIES it (lens), ERASES it (scraper), REPAINTS it (brush), and the
//                   Contract shows the same three things on its crown.
//   COMPLETION      the performance fades, props and effects settle, and the Dog is the Dog again.
//
//   HANDOFF         does not exist for the player. Its event is still Julius's (WonderlandMissionBeat.h); the world
//                   withholds it entirely (UWonderlandMissionSubsystem) and an act of `None` inherits here.
//
// THE DOG FACES WHERE IT WALKS (founder, same note). It is no longer turned to the Contract while circling; the CAMERA
// holds the Contract. Only the stationary acts done at the work -- hovering to verify, standing at a fault to repair --
// turn the body to it.
//
// WHY NOTHING HERE NAMES AN AXIS. The rig's own conventions (which roll opens an arm, which pitch bows a head) were
// argued three ways in comments and renders and settled by none of them. So this file speaks only in intent -- weights,
// phases, lifts -- and the character measures the rig's signs at bind and solves the limbs in world terms.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandDogPerformance.h"

namespace RelayDogMission
{
	/** The four moments of a repair, in order. */
	enum class ERepairStage : uint8
	{
		None,
		Identify,
		Erase,
		Repaint,
		Settle
	};

	/** Seconds each moment of a repair lasts; one whole cycle is their sum and then it repeats. */
	struct FRepairTiming
	{
		float IdentifySeconds = 4.0f;
		float EraseSeconds = 5.0f;
		float RepaintSeconds = 8.0f;
		float SettleSeconds = 3.0f;
	};

	struct FRepairMoment
	{
		ERepairStage Stage = ERepairStage::None;
		/** 0..1 through the current moment. */
		float Progress = 0.0f;
	};

	/** Where a repair that began `SecondsIntoAct` ago is. Absolute from the act's start, so nothing accumulates. */
	WONDERLAND_API FRepairMoment RepairMomentAt(const FRepairTiming& Timing, float SecondsIntoAct);

	/** Where a page is in its turn: 0 lying on the right-hand page, 1 on the left, NEGATIVE between turns. */
	WONDERLAND_API float PageTurnProgress(float TurnHz, float TurnFraction, float TimeSeconds);

	/** The numbers the character supplies every frame from wl.Dog.* console variables, so a look is tuned live. */
	struct FTuning
	{
		// PREPARATION
		float MeditateLiftUU = 72.0f;
		float MeditateHoverUU = 6.0f;
		float MeditateHoverPeriod = 4.2f;
		/** How long the rise into the float takes, seconds. */
		float MeditateRiseSeconds = 1.6f;
		// RESEARCH
		float TurnHz = 0.32f;
		float TurnFraction = 0.42f;
		// IMPLEMENTATION
		float StrokeHz = 0.55f;
		// REVIEW
		float SweepHz = 0.16f;
		// VERIFICATION
		float FlyLiftUU = 150.0f;
		float FlyHoverUU = 5.0f;
		float FlyHoverPeriod = 3.4f;
		float FlyRiseSeconds = 1.5f;
		// REPAIR
		FRepairTiming Repair;
		float ScrubHz = 2.4f;
	};

	/** What the world knows this frame. */
	struct FStageInput
	{
		FTuning Tuning;
		float DeltaSeconds = 0.0f;
		/** The world clock. Cycles are computed ABSOLUTELY from it, so a long frame cannot leave a limb mid-stroke. */
		float TimeSeconds = 0.0f;
		/** Whether a Mission Contract exists at all: what separates an inherited interval from the end of a mission. */
		bool bHasContract = false;
		/** Yaw from where the Dog is facing to the contract, degrees, signed; positive toward the Dog's right. */
		float ContractYawDeg = 0.0f;
		/** Ground distance to the contract, uu. */
		float ContractDistanceUU = 0.0f;
		/** +1 when the working (brush, lens) hand is on the Dog's right, -1 on its left. Measured by the character. */
		float WorkingHandSide = 1.0f;
		/** True while a player is steering: a performance never fights input. */
		bool bPlayerDriving = false;
		/**
		 * THE CIRCLE ABOUT THE CONTRACT: its radius, uu, and +1 / -1 for the way round. Normally 340 and +1. The character
		 * changes them only to get round something the circle ran into (a urn, a pillar) -- see ARelayDogCharacter's orbit
		 * detour (founder regression G1, 2026-09-30).
		 */
		float OrbitRadiusUU = 340.0f;
		float OrbitDirection = 1.0f;
	};

	/**
	 * What the body should be doing, as intent. At Weight 0 the Dog is exactly the walking Dog.
	 *
	 * The ACT WEIGHTS say how much of each performance is in the pose right now; during a change of stage two of them are
	 * non-zero and sum to Weight, so the character blends the hands' goals rather than cutting between poses.
	 */
	struct FStageOverlay
	{
		/** 0 while the Dog is ordinary, 1 while a performance is fully in. */
		float Weight = 0.0f;

		float Meditate = 0.0f;
		float Read = 0.0f;
		float Paint = 0.0f;
		float Fly = 0.0f;
		float Inspect = 0.0f;
		float Correct = 0.0f;

		/** How far the whole body is lifted off the ground, uu, hover included. */
		float LiftUU = 0.0f;

		/** Phases the character turns into hand paths: a page turning, a brush stroke, a lens sweep, a scraper's scrub. */
		float PageTurn = -1.0f;
		float StrokePhase = 0.0f;
		float SweepPhase = 0.0f;
		float ScrubPhase = 0.0f;
		FRepairMoment Repair;

		/** 0..1 how shut the eyes are: closed in meditation. */
		float EyesShut = 0.0f;
		/** Energy gathering toward the Contract, and seconds since the preparation began. */
		float Energy = 0.0f;
		float SecondsIntoAct = 0.0f;

		/** Walk a circle about the contract, on this world-yaw bearing relative to where the Dog faces, at this pace. */
		bool bOrbit = false;
		float OrbitBearingDeg = 0.0f;
		float OrbitPace = 1.0f;

		/** Turn the body to the contract. Only for the stationary acts done at the work. */
		bool bFaceContract = false;

		/** Which prop is in hand, and how far it has faded in. */
		EWonderlandDogProp Prop = EWonderlandDogProp::None;
		float PropWeight = 0.0f;

		/** The verification beam: bound to the REPORTED act, so it lasts exactly as long as verification. */
		bool bBeam = false;
		float BeamWeight = 0.0f;
	};

	/**
	 * The performance across frames: the act, the act being faded out of, and the blends between them.
	 */
	class WONDERLAND_API FPerformer
	{
	public:
		void SetAct(EWonderlandDogAct Act, bool bContractPresent, float TimeSeconds);

		/** The act actually being performed, which during an inherited interval is the previous act, not None. */
		EWonderlandDogAct Performing() const { return Current; }
		/** The act the mission last reported, before inheritance. */
		EWonderlandDogAct ReportedAct() const { return Reported; }
		float BeamFade() const { return BeamWeight; }

		FStageOverlay Update(const FStageInput& In);

	private:
		EWonderlandDogAct Current = EWonderlandDogAct::None;
		EWonderlandDogAct Previous = EWonderlandDogAct::None;
		EWonderlandDogAct Reported = EWonderlandDogAct::None;
		float Weight = 0.0f;
		float Cross = 1.0f;
		/** Seconds the current cross-fade takes: longer when the body has far to rise or descend. */
		float CrossSeconds = 0.45f;
		float WeightSeconds = 0.45f;
		float BeamWeight = 0.0f;
		/** World time the performed act began. */
		float ActStartedAt = 0.0f;
	};
}

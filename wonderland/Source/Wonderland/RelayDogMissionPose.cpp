#include "RelayDogMissionPose.h"

namespace RelayDogMission
{
	namespace
	{
		/** Ease a weight toward a target at a fixed rate, in seconds-to-travel-the-whole-range. */
		float Approach(float Value, float Target, float Seconds, float DeltaSeconds)
		{
			if (Seconds <= KINDA_SMALL_NUMBER)
			{
				return Target;
			}
			const float Step = DeltaSeconds / Seconds;
			return FMath::Clamp(Value + FMath::Clamp(Target - Value, -Step, Step), 0.0f, 1.0f);
		}

		/** Smoothstep, so a stage arrives and leaves without a corner in its motion. */
		float Smooth(float T)
		{
			const float X = FMath::Clamp(T, 0.0f, 1.0f);
			return X * X * (3.0f - 2.0f * X);
		}
	}

	void ArmAnglesFor(const FWonderlandDogActReading& Reading, float& OutPitchDeg, float& OutRollDeg)
	{
		// THE TABLE SPEAKS IN THE FOUNDER'S TERMS, this rig does not. "Arms 35 degrees DOWN" is measured
		// from the horizontal, but a Relay Dog's arm hangs straight down at zero, so 35 below horizontal is
		// 55 degrees of ROLL away from hanging. ArmOutDeg then opens the limb forward of the lateral plane,
		// which is the "chest open" in the note; a negative ArmDownDeg (the painter reaching up) simply
		// carries the roll past horizontal, which is what painting above the shoulder should look like.
		OutRollDeg = 90.0f - Reading.ArmDownDeg;
		OutPitchDeg = Reading.ArmOutDeg;
	}

	void FPerformer::SetAct(EWonderlandDogAct Act, bool bContractPresent)
	{
		Reported = Act;
		if (Act == EWonderlandDogAct::None)
		{
			// RULE 1. A contract on the table means the mission is still running and this is an interval --
			// a handoff, a repair, a review -- so the Dog keeps performing what it was performing. No
			// contract means the mission has ended, and the performance ends with it.
			if (!bContractPresent)
			{
				Current = EWonderlandDogAct::None;
			}
			return;
		}
		Current = Act;
	}

	FStageOverlay FPerformer::Update(const FStageInput& In)
	{
		const bool bWant = Current != EWonderlandDogAct::None;
		Weight = Approach(Weight, bWant ? 1.0f : 0.0f, BlendSeconds, In.DeltaSeconds);

		// RULE 2. The beam follows the REPORTED act, never the inherited one, so verifying -> complete puts
		// it out on the transition the spec names rather than leaving it lit through the contract's fade.
		const bool bWantBeam = Reported == EWonderlandDogAct::VerificationBeam && In.bHasContract;
		BeamWeight = Approach(BeamWeight, bWantBeam ? 1.0f : 0.0f, BlendSeconds, In.DeltaSeconds);

		FStageOverlay Out;
		Out.Weight = Smooth(Weight);
		Out.bBeam = BeamWeight > KINDA_SMALL_NUMBER;
		Out.BeamWeight = Smooth(BeamWeight);
		if (Out.Weight <= KINDA_SMALL_NUMBER && !Out.bBeam)
		{
			return Out;
		}

		const FWonderlandDogActReading& R = WonderlandDogActReading(Current);
		const float W = Out.Weight;

		// ---------------------------------------------------------------- the float
		// Lift and hover are one number: the body rises to FloatLiftUU and then breathes about it. The
		// hover is never zero for an act that has one, because "never frozen" is in the founder's note.
		float Lift = R.FloatLiftUU;
		if (R.HoverUU > 0.0f)
		{
			const float Period = FMath::Max(R.HoverPeriod, 0.25f);
			Lift += R.HoverUU * FMath::Sin(2.0f * PI * In.TimeSeconds / Period);
		}
		Out.LiftUU = Lift * W;

		// ---------------------------------------------------------------- the head
		// Head tracking is the contract's, not the table's: VERIFYING says headTracksContract, and reading
		// looks at the pages instead. Both are still scaled by the blend.
		float HeadPitch = R.HeadPitchDeg;
		float HeadYaw = 0.0f;
		if (R.bBeamsTheContract && In.bHasContract)
		{
			HeadPitch = FMath::Clamp(In.ContractPitchDeg, -38.0f, 38.0f);
			HeadYaw = FMath::Clamp(In.ContractYawDeg, -42.0f, 42.0f);
		}
		Out.HeadPitchDeg = HeadPitch * W;
		Out.HeadYawDeg = HeadYaw * W;

		// ---------------------------------------------------------------- the arms
		float Pitch = 0.0f;
		float Roll = 0.0f;
		ArmAnglesFor(R, Pitch, Roll);

		// THE WORKING MOTION. A stroke is not a wobble: it is asymmetric on purpose, big on the working arm
		// and small on the other, because a painter's off hand steadies rather than mirrors. The page turn
		// uses the same machinery at a fifth of the size and a third of the rate, which is why the table
		// carries one pair of numbers for both.
		float Swing = 0.0f;
		if (R.WorkSwingDeg > 0.0f && R.WorkSwingHz > 0.0f)
		{
			Swing = R.WorkSwingDeg * FMath::Sin(2.0f * PI * R.WorkSwingHz * In.TimeSeconds);
		}
		Out.ShoulderPitchRightDeg = (Pitch + Swing) * W;
		Out.ShoulderPitchLeftDeg = (Pitch + Swing * 0.22f) * W;
		Out.ShoulderRollDeg = Roll * W;
		// The elbow follows the stroke a beat behind, which is what makes it a brush rather than a pointer.
		Out.ElbowDeg = (R.WorkSwingDeg > 0.0f
			? R.WorkSwingDeg * 0.45f * FMath::Sin(2.0f * PI * R.WorkSwingHz * In.TimeSeconds - 0.9f)
			: 0.0f) * W;

		// ---------------------------------------------------------------- suspended legs
		// A floating Dog whose legs are still standing reads as a bug. They hang, and only while lifted.
		Out.HipDeg = (R.FloatLiftUU > 0.0f ? -14.0f : 0.0f) * W;

		// ---------------------------------------------------------------- the orbit
		// A REAL WALK, not a slide: this returns a bearing and the character moves along it, so the stride
		// system solves the gait and the Dog genuinely circles the contract. It yields to the player at
		// once -- locomotion is protected, and a performance that fought the stick would be a bug.
		if (R.bOrbitsTheContract && In.bHasContract && !In.bPlayerDriving && Weight > 0.5f)
		{
			Out.bOrbit = true;
			// Tangent to the circle about the contract, with a gentle pull toward the radius it wants, so
			// the Dog closes to its ring rather than spiralling away from wherever it started.
			// 340 uu is the contract's own anchor offset (WonderlandMissionOrb FollowOffset, measured
			// 2026-09-16), so the Dog is already standing on its ring when a mission begins and walks a
			// circle rather than first swinging out to find one.
			const float Want = 340.0f;
			const float Err = FMath::Clamp((In.ContractDistanceUU - Want) / Want, -1.0f, 1.0f);
			Out.OrbitBearingDeg = In.ContractYawDeg + 90.0f - Err * 52.0f;
		}

		// ---------------------------------------------------------------- the prop
		// The prop belongs to the act being PERFORMED, so a handoff mid-implementation keeps the brush.
		Out.Prop = R.Prop;
		Out.PropWeight = W;
		return Out;
	}
}

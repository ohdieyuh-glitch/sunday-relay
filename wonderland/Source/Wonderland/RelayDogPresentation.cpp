#include "RelayDogPresentation.h"

namespace RelayDogPresentation
{
	void ConfigureCanonAnimator(RelayDogStride::FDogAnimator& Animator, float HeadWidthUU)
	{
		// The canon body's proportions, in its own unit: the hip stands 0.8 head widths up, split into a thigh and a shin
		// of 0.2875 and 0.5125. Moved here unchanged from ARelayDogCharacter::BindJoints so the wardrobe's animator and the
		// Dog's can never be configured differently.
		// Taken as given: a caller with no Dog to ask passes CanonHeadWidthUU.
		const float LegLengthUU = 0.8f * HeadWidthUU;
		const float ThighUU = (0.8f - 0.5125f) * HeadWidthUU;
		const float ShinUU = 0.5125f * HeadWidthUU;
		Animator.Configure(LegLengthUU, ThighUU, ShinUU, HeadWidthUU);
	}

	RelayDogStride::FDogInput StandingStill(float DeltaSeconds, float HeadingDeg)
	{
		RelayDogStride::FDogInput In;
		In.DeltaSeconds = DeltaSeconds;
		In.SpeedUU = 0.0f;
		In.DistanceUU = 0.0f;
		In.HeadingDeg = HeadingDeg;
		In.DesiredHeadingDeg = HeadingDeg;
		In.bInAir = false;
		In.VerticalSpeedUU = 0.0f;
		In.bJumpPressed = false;
		In.GroundDeltaLeft = 0.0f;
		In.GroundDeltaRight = 0.0f;
		In.bHasLookTarget = false;
		return In;
	}

	FWonderlandWornPose ComposeWornPose(const RelayDogStride::FDogPose& Pose, float Stillness, float LiftUU)
	{
		// FIELD FOR FIELD what ARelayDogCharacter::Tick composed inline (2026-09-29 .. 10-01), so the Dog's hand-down is
		// unchanged by being shared. A still performance damps the walk's sway, bob, yaw and roll; the lean is kept.
		// Taken as given, not clamped: the Dog's own composition never clamped it either, and the refactor must not move a
		// single number of Relay OG's hand-down.
		const float Still = Stillness;
		FWonderlandWornPose Dressed;
		Dressed.StridePhase = Pose.StridePhase;
		Dressed.GaitWeight = Pose.GaitWeight;
		Dressed.SpeedUU = Pose.SpeedUU;
		Dressed.SwayUU = Pose.SwayUU * (1.0f - Still);
		Dressed.BobUU = (Pose.BobUU - Pose.PelvisDropUU) * (1.0f - Still);
		Dressed.LiftUU = LiftUU;
		Dressed.BodyPitchDeg = Pose.LeanDeg + Pose.Body.PitchDeg;
		Dressed.BodyYawDeg = Pose.BodyYawDeg * (1.0f - Still);
		Dressed.BodyRollDeg = (Pose.Body.RollDeg + Pose.TurnRollDeg) * (1.0f - Still);
		// The head keeps its own level against the body's lean, exactly as the canon HeadPivot is written.
		Dressed.HeadPitchDeg = Pose.HeadPitchDeg - Pose.LeanDeg;
		Dressed.HeadYawDeg = Pose.HeadYawDeg;
		Dressed.TailPitchDeg = Pose.TailPitchDeg;
		Dressed.TailYawDeg = Pose.TailYawDeg;
		// THE SOLVED JOINTS, so a skin bends where the Dog bends rather than re-deriving a swing of its own.
		Dressed.HipLeftDeg = Pose.LegLeft.HipDeg;
		Dressed.KneeLeftDeg = Pose.LegLeft.KneeDeg;
		Dressed.HipRightDeg = Pose.LegRight.HipDeg;
		Dressed.KneeRightDeg = Pose.LegRight.KneeDeg;
		Dressed.ShoulderLeftDeg = Pose.ArmLeft.ShoulderDeg;
		Dressed.ElbowLeftDeg = Pose.ArmLeft.ElbowDeg;
		Dressed.ShoulderRightDeg = Pose.ArmRight.ShoulderDeg;
		Dressed.ElbowRightDeg = Pose.ArmRight.ElbowDeg;
		Dressed.AirborneWeight = Pose.AirborneWeight;
		Dressed.Stillness = Still;
		Dressed.bValid = true;
		return Dressed;
	}
}

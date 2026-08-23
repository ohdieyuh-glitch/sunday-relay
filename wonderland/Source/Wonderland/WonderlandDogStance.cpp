#include "WonderlandDogStance.h"

#include <cmath>

namespace
{
	constexpr float Pi = 3.14159265358979323846f;
	constexpr float TwoPi = 2.0f * Pi;

	float Frac(float V)
	{
		const float F = V - std::floor(V);
		return (F < 0.0f) ? F + 1.0f : F;
	}

	float Clamp01(float V)
	{
		return V < 0.0f ? 0.0f : (V > 1.0f ? 1.0f : V);
	}

	/** Smoothstep. Used everywhere a value has to arrive without a corner:
	 *  its first derivative is zero at both ends, so nothing changes velocity
	 *  discontinuously. A linear ramp is exactly the "pose stepping" read. */
	float Smooth(float T)
	{
		T = Clamp01(T);
		return T * T * (3.0f - 2.0f * T);
	}
}

namespace WonderlandStance
{

const char* RoleName(EUprightRole Role)
{
	switch (Role)
	{
		case EUprightRole::Hero:        return "hero";
		case EUprightRole::Working:     return "working";
		case EUprightRole::Ceremonial:  return "ceremonial";
		case EUprightRole::SpecialSkin: return "special_skin";
		case EUprightRole::None:
		default:                        return "none";
	}
}

bool RoleStandsUpright(EUprightRole Role)
{
	// QUADRUPED IS THE DEFAULT AND THE SPAWN IDENTITY. Only the roles the
	// founder named stand, and they are named here rather than tested for at
	// each call site so that "which Dogs are upright" has one answer.
	return Role != EUprightRole::None;
}

float LegPhaseOffset(int LegIndex)
{
	// Half a cycle apart. Both feet in phase is a hop, not a walk.
	return (LegIndex & 1) ? 0.5f : 0.0f;
}

FStandingPose StandingPose(float Blend, float LegLength, float TorsoLength)
{
	FStandingPose Out;
	const float B = Smooth(Clamp01(Blend));
	if (B <= 0.0f || LegLength <= 0.0f)
	{
		return Out;   // exactly the canonical quadruped, by construction
	}

	// THE HIPS RISE UNTIL THE LEGS ARE UNDER THE BODY RATHER THAN BESIDE IT.
	// A quadruped's hip already sits one leg above the ground; standing does
	// not raise the hip much at all -- what changes is that the TORSO stops
	// lying along the ground and stands on top of it. Getting this backwards
	// (lifting the pelvis by a whole leg) is what makes a reared animal look
	// like it is hanging from a wire.
	Out.PelvisRise = 0.10f * LegLength * B;

	// The torso comes vertical. Negative pitch lifts the chest.
	Out.TorsoPitchDeg = -82.0f * B;

	// Standing, the body's own LENGTH becomes its height, and its centre
	// therefore rises by about half of it. This is the single measurement that
	// makes the silhouette match the sheet: too little and the Dog is a
	// begging dog, too much and it is a humanoid wearing a dog's head.
	Out.TorsoRise = (0.42f * TorsoLength + 0.10f * LegLength) * B;

	// THE HEAD STAYS LEVEL. The torso pitches 82 degrees; if the head rode it
	// the Dog would face the sky and the visor -- the identity -- would be
	// invisible from the arrival camera. So the head counter-rotates almost
	// exactly, and rises to sit on top of the standing torso.
	Out.HeadPitchDeg = 80.0f * B;
	Out.HeadRise = (0.52f * TorsoLength + 0.10f * LegLength) * B;

	// STANDING LEGS (0 left-hind, 1 right-hind). They straighten under the
	// body and spread a little, because a narrow base reads as unstable and
	// the sheet draws the feet apart.
	for (int i = 0; i < 2; ++i)
	{
		const float Side = (i == 0) ? -1.0f : 1.0f;
		Out.LegRise[i] = 0.0f;                      // feet stay on the ground
		Out.LegPitchDeg[i] = -6.0f * B;             // shins come under the hips
		Out.LegSpread[i] = Side * 0.10f * LegLength * B;
	}

	// ARMS (2 left-fore, 3 right-fore). These are the forelegs, re-carried.
	// They rise to SHOULDER height -- near the top of the standing torso --
	// and rotate to hang down alongside it, which is how the sheet draws them:
	// straight down, slightly clear of the body, paw blocks at the ends.
	for (int i = 0; i < 2; ++i)
	{
		const int Limb = 2 + i;
		const float Side = (i == 0) ? -1.0f : 1.0f;
		Out.LegRise[Limb] = (0.72f * TorsoLength + 0.10f * LegLength) * B;
		Out.ArmRise[i] = Out.LegRise[Limb];
		// The foreleg's rest orientation points DOWN-and-forward under the
		// chest; hanging at the side is a small correction from that, not a
		// large one. Overshooting here swings the arms out like a scarecrow.
		Out.ArmPitchDeg[i] = -4.0f * B;
		Out.LegPitchDeg[Limb] = Out.ArmPitchDeg[i];
		Out.ArmOutDeg[i] = Side * 7.0f * B;
		Out.LegSpread[Limb] = Side * 0.16f * LegLength * B;
	}

	// The tail curls out and back, as drawn. It also counterweights the chest
	// coming up, which is what a real animal does with it.
	Out.TailPitchDeg = -34.0f * B;

	// A PLANTED FOOT DOES NOT MOVE, so a rising hip has to be reached FROM.
	// Without this the body detaches from its own legs -- the exact defect
	// WonderlandPose::HindStretch was added to fix, repeated here because the
	// geometry is the same geometry.
	Out.LegStretch = 1.0f + (Out.PelvisRise / LegLength);

	return Out;
}

FStepPose StepPose(float StridePhase, float StrideLength, float LiftHeight,
                   float DutyFactor)
{
	FStepPose Out;
	const float P = Frac(StridePhase);
	const float Duty = (DutyFactor <= 0.0f || DutyFactor >= 1.0f)
	                 ? WalkDutyFactor : DutyFactor;

	if (P < Duty)
	{
		// STANCE. The foot is planted, so in the BODY's frame it must travel
		// backwards at exactly the rate the body travels forwards -- no more
		// and no less. That makes its world position constant, and it is the
		// single thing that has to be exactly right for a walk not to slide.
		//
		// The rate is set by the PHASE, not by the phase renormalised over the
		// duty factor. Dividing by Duty here is the obvious-looking mistake and
		// it is wrong by a factor of 1/Duty: at 0.62 the foot travelled back
		// 1.6x too fast and skated 36 uu per stride. The test caught it before
		// a single frame was rendered.
		Out.bStance = true;
		Out.Lift = 0.0f;
		Out.Forward = StrideLength * (0.5f - P);
	}
	else
	{
		// SWING. The foot lifts and is carried from where stance left it back
		// to the front of the stride. Smoothstep in the horizontal so it does
		// not jerk at lift-off or touchdown; a half-sine in the vertical so it
		// leaves and lands at zero height rather than clipping through it.
		const float T = (P - Duty) / (1.0f - Duty);
		const float Back = StrideLength * (0.5f - Duty);   // where stance ended
		const float Front = StrideLength * 0.5f;           // where it lands
		Out.bStance = false;
		Out.Forward = Back + (Front - Back) * Smooth(T);
		Out.Lift = LiftHeight * std::sin(Pi * T);
	}
	return Out;
}

float WorldFootForward(float DistanceTravelled, float LegOffset,
                       float StrideLength, float LiftHeight)
{
	if (StrideLength <= 0.0f)
	{
		return DistanceTravelled;
	}
	const float Phase = DistanceTravelled / StrideLength + LegOffset;
	const FStepPose Pose = StepPose(Phase, StrideLength, LiftHeight);
	return DistanceTravelled + Pose.Forward;
}

FLimbSwing LimbSwing(const FStepPose& Pose, float LegLength)
{
	FLimbSwing Out;
	if (LegLength <= 0.0f)
	{
		return Out;
	}
	// The hip is fixed; the foot must reach (Forward, -LegLength + Lift)
	// relative to it. The angle is the direction to that point and the stretch
	// is how much further away it is than the limb is long.
	const float Dx = Pose.Forward;
	const float Dz = -(LegLength - Pose.Lift);
	const float Span = std::sqrt(Dx * Dx + Dz * Dz);
	Out.PitchDeg = std::atan2(Dx, -Dz) * 180.0f / Pi;
	Out.Stretch = (Span > 0.0f) ? (Span / LegLength) : 1.0f;
	return Out;
}

FCarriage Carriage(float StridePhase, float RiseHeight, float SwayWidth)
{
	FCarriage Out;
	const float P = Frac(StridePhase);
	const float Theta = TwoPi * P;

	// RISE: twice per stride. Highest over each planted leg, lowest at the
	// double-support moments between steps.
	Out.PelvisRise = RiseHeight * (0.5f - 0.5f * std::cos(2.0f * Theta));

	// SWAY: ONCE per stride, toward whichever foot is carrying the weight.
	// Half the frequency of the rise, and that ratio is most of why walking
	// reads as alive rather than as bouncing on the spot.
	Out.PelvisSway = SwayWidth * std::sin(Theta);

	// The pelvis drops toward the UNSUPPORTED side, which is what a real hip
	// does when the other foot leaves the ground.
	Out.PelvisRollDeg = -3.2f * std::sin(Theta);

	// The hips rotate with the leading leg...
	Out.PelvisYawDeg = 4.5f * std::sin(Theta);
	// ...and the shoulders counter-rotate against them about the spine. This
	// is the single most characteristic motion of bipedal walking, and its
	// absence is most of the "whole body moves as one block" read.
	Out.TorsoYawDeg = -0.65f * Out.PelvisYawDeg;
	Out.TorsoRollDeg = -0.45f * Out.PelvisRollDeg;

	// THE HEAD HOLDS STILL. An animal stabilises its gaze against everything
	// its body is doing; a head welded to the chest is the doll read.
	Out.HeadRise = -0.55f * Out.PelvisRise;
	Out.HeadYawDeg = -(Out.PelvisYawDeg + Out.TorsoYawDeg) * 0.85f;
	Out.HeadRollDeg = -(Out.PelvisRollDeg + Out.TorsoRollDeg) * 0.85f;

	return Out;
}

FArmSwing ArmSwing(float StridePhase, float Amplitude)
{
	FArmSwing Out;
	// CONTRALATERAL, and TRAILING by a twelfth of a cycle. The half-cycle
	// offset is the contralateral flip -- this arm answers the OPPOSITE leg --
	// and the 0.08 is the lag that stops it reading as clockwork.
	const float P = Frac(StridePhase + 0.5f + 0.08f);
	Out.PitchDeg = Amplitude * std::sin(TwoPi * P);
	// Arms swing slightly out at the extremes so they clear the hips instead
	// of passing through them.
	Out.OutDeg = 0.22f * Amplitude * std::fabs(std::sin(TwoPi * P));
	return Out;
}

float ArmAmplitudeFor(float SpeedUU, float LegLength)
{
	if (LegLength <= 0.0f || SpeedUU <= 0.0f)
	{
		return 0.0f;
	}
	// Scaled by the same dimensionless speed the gait thresholds use, so a
	// large Dog and a small one swing alike at the speed that suits them.
	const float V = SpeedUU / LegLength;
	const float T = Clamp01(V / 3.2f);
	return 26.0f * Smooth(T);
}

FIdleSway IdleSway(float Seconds, float LegLength)
{
	FIdleSway Out;
	if (LegLength <= 0.0f)
	{
		return Out;
	}
	// Three rhythms that do not share a period, so the loop never announces
	// itself. Amplitudes are deliberately small: this has to be visible as
	// life and invisible as animation.
	Out.Breath = 0.016f * LegLength * std::sin(TwoPi * Seconds / 3.4f);
	Out.SwayDeg = 1.15f * std::sin(TwoPi * Seconds / 5.9f);
	Out.HeadYawDeg = 3.4f * std::sin(TwoPi * Seconds / 8.3f)
	               * std::sin(TwoPi * Seconds / 19.7f);
	return Out;
}

float Approach(float Current, float Target, float DeltaSeconds,
               float HalfLifeSeconds)
{
	if (DeltaSeconds <= 0.0f)
	{
		return Current;
	}
	if (HalfLifeSeconds <= 0.0f)
	{
		return Target;
	}
	// Exponential toward the target. Frame-rate independent by construction:
	// the same elapsed time produces the same result whatever the step size,
	// which `Current += Rate * Dt` does not.
	const float K = std::exp(-DeltaSeconds * 0.6931472f / HalfLifeSeconds);
	return Target + (Current - Target) * K;
}

float WrapDeg(float Deg)
{
	float D = std::fmod(Deg + 180.0f, 360.0f);
	if (D < 0.0f)
	{
		D += 360.0f;
	}
	return D - 180.0f;
}

float ApproachAngleDeg(float CurrentDeg, float TargetDeg, float DeltaSeconds,
                       float HalfLifeSeconds)
{
	// WRAP FIRST. Easing a raw heading takes the long way round whenever the
	// target crosses the +/-180 seam: a Dog asked to turn ten degrees spins
	// three hundred and fifty the other way, which is the snap.
	const float Delta = WrapDeg(TargetDeg - CurrentDeg);
	const float Eased = Approach(0.0f, Delta, DeltaSeconds, HalfLifeSeconds);
	return WrapDeg(CurrentDeg + Eased);
}

}   // namespace WonderlandStance

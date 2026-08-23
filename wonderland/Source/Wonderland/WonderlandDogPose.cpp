#include "WonderlandDogPose.h"

#include <cmath>

namespace WonderlandPose
{
	namespace
	{
		constexpr float Pi = 3.14159265358979323846f;

		float Clamp01(float V) { return V < 0.0f ? 0.0f : (V > 1.0f ? 1.0f : V); }

		/** Smoothstep. The rise has to start and finish softly or the moment the
		 *  Dog leaves the ground reads as a jerk however long the transition is. */
		float Ease(float T)
		{
			T = Clamp01(T);
			return T * T * (3.0f - 2.0f * T);
		}
	}

	const char* WorkName(EWork Work)
	{
		switch (Work)
		{
		case EWork::None:       return "none";
		case EWork::Meditating: return "meditating";
		case EWork::Channelling:return "channelling";
		case EWork::Placing:    return "placing";
		case EWork::Inspecting: return "inspecting";
		case EWork::Repairing:  return "repairing";
		case EWork::Approving:  return "approving";
		default: return "?";
		}
	}

	float UprightTargetFor(EWork Work)
	{
		switch (Work)
		{
		case EWork::None:        return 0.0f;
		// Meditation is a SIT, not a stand. Sending every work state to fully
		// upright is what makes a cast look like it shares one skeleton.
		case EWork::Meditating:  return 0.28f;
		case EWork::Channelling: return 1.00f;
		case EWork::Placing:     return 0.86f;
		case EWork::Inspecting:  return 0.92f;
		case EWork::Repairing:   return 0.80f;
		case EWork::Approving:   return 0.95f;
		default: return 0.0f;
		}
	}

	float ApproachBlend(float Current, float Target, float DeltaSeconds, float HalfLifeSeconds)
	{
		if (HalfLifeSeconds <= 0.0f || DeltaSeconds <= 0.0f)
		{
			return Target;
		}
		// FRAME-RATE INDEPENDENT BY CONSTRUCTION. `Blend += Rate * Dt` converges
		// at a speed that depends on the frame rate, so the same transition is a
		// different length at 20 fps and 60 — and Wonderland streams at both.
		// Halving the remaining distance every HalfLife seconds does not.
		const float K = std::pow(0.5f, DeltaSeconds / HalfLifeSeconds);
		const float Next = Target + (Current - Target) * K;
		// Snap the last sliver, or the blend approaches 1 forever and a state
		// that tests "fully upright" never becomes true.
		return (std::fabs(Next - Target) < 1e-4f) ? Target : Next;
	}

	FUprightPose UprightPose(float Blend, float LegLength, float WorkPhase, EWork Work)
	{
		FUprightPose Pose;
		const float B = Ease(Clamp01(Blend));
		if (B <= 0.0f)
		{
			return Pose;   // exactly the canonical quadruped pose, not near it
		}
		const float L = (LegLength > 1.0f) ? LegLength : 1.0f;
		const float Cycle = std::sin(WorkPhase * 2.0f * Pi);

		// THE CHEST RISES BY PITCHING ABOUT THE HIP, not by lifting the whole
		// body. That distinction is the difference between a Dog rearing and a
		// Dog levitating, and getting it wrong is invisible in numbers.
		//
		// The first version lifted the torso 0.62 of a leg outright. A planted
		// hind leg is rigid and its paw does not move, so the hip cannot rise
		// that far — the body simply detached from its own legs, measured at 52%
		// of a leg length. The pitch already raises the chest by
		// TorsoLength*sin(pitch), which is most of a leg on its own; the rise
		// only has to be the modest gather of the haunches.
		Pose.TorsoRise = 0.14f * L * B;
		Pose.TorsoPitchDeg = 52.0f * B;



		// The head stays roughly level. A standing animal looks ahead, not at
		// the sky, so the head takes back most of what the torso just added.
		Pose.HeadPitchDeg = -44.0f * B;
		Pose.HeadRise = 0.10f * L * B;

		// Tail swings back as a counterweight.
		Pose.TailPitchDeg = -30.0f * B;

		for (int i = 0; i < 4; ++i)
		{
			const bool bFore = (i == 2 || i == 3);
			if (bFore)
			{
				// FORELEGS LEAVE THE GROUND and fold up against the chest.
				Pose.LegRise[i] = 0.70f * L * B;
				Pose.LegPitchDeg[i] = -58.0f * B;
			}
			else
			{
				// HIND LEGS TAKE THE WEIGHT: they stay planted and spread a
				// little for balance. LegRise stays ZERO for these — a hind paw
				// leaving the floor while the Dog stands is the hovering the
				// brief calls out.
				Pose.LegRise[i] = 0.0f;
				Pose.LegPitchDeg[i] = 9.0f * B;
				Pose.LegSpread[i] = ((i == 0) ? -1.0f : 1.0f) * 0.13f * L * B;
			}
		}

		// WHAT THE PAWS ARE ACTUALLY DOING. Only reached once the Dog is
		// standing, and scaled by B so it fades in with the rise instead of
		// appearing at full amplitude the instant the state changes.
		const float W = B;
		switch (Work)
		{
		case EWork::Channelling:
			// Both forepaws pushed out and trembling with effort.
			Pose.LegPitchDeg[2] += (-26.0f + 5.0f * Cycle) * W;
			Pose.LegPitchDeg[3] += (-26.0f - 5.0f * Cycle) * W;
			Pose.TorsoPitchDeg += 5.0f * Cycle * W;
			break;
		case EWork::Placing:
			// One paw forward holding the component, the other tucked.
			Pose.LegPitchDeg[3] += (-34.0f + 8.0f * Cycle) * W;
			Pose.LegPitchDeg[2] += 14.0f * W;
			break;
		case EWork::Inspecting:
			// Head tilts and the body turns it over.
			Pose.HeadPitchDeg += 16.0f * Cycle * W;
			Pose.LegPitchDeg[2] += (-18.0f - 10.0f * Cycle) * W;
			Pose.LegPitchDeg[3] += (-18.0f + 10.0f * Cycle) * W;
			break;
		case EWork::Repairing:
			// Short busy strokes, out of phase between the paws.
			Pose.LegPitchDeg[2] += (-20.0f + 14.0f * Cycle) * W;
			Pose.LegPitchDeg[3] += (-20.0f - 14.0f * std::cos(WorkPhase * 2.0f * Pi)) * W;
			break;
		case EWork::Approving:
			// One paw raised and held. Deliberately not cyclic — an approval
			// that waves continuously reads as a greeting.
			Pose.LegPitchDeg[3] += -46.0f * W;
			Pose.HeadPitchDeg += -6.0f * W;
			break;
		case EWork::Meditating:
			// Low, still, breathing. The only motion is the body.
			Pose.TorsoRise += 0.02f * L * Cycle * W;
			break;
		default:
			break;
		}

		// THE HIND LEGS MUST REACH, AND THIS IS DERIVED LAST ON PURPOSE.
		//
		// Whatever the hip rises by, a planted hind leg has to span it — the
		// same solve LegSwing does for the gait, for the same reason: a planted
		// paw stays planted, so the limb is what gives.
		//
		// It was computed BEFORE the work switch first, and meditating adds its
		// own 0.02L of breathing to TorsoRise afterwards — so the stretch was
		// derived from a rise that then changed underneath it and the leg came
		// up 2.3 uu short. Anything that moves the hip must happen before this
		// line, and now everything does.
		Pose.HindStretch = 1.0f + (Pose.TorsoRise / L);
		return Pose;
	}
}

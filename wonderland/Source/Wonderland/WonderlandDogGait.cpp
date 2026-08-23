#include "WonderlandDogGait.h"

#include <cmath>

namespace WonderlandGait
{
	namespace
	{
		float Frac(float V)
		{
			const float F = V - std::floor(V);
			return (F < 0.0f) ? (F + 1.0f) : F;
		}
	}

	float LegPhaseOffset(int LegIndex)
	{
		// 0 LH, 1 RH, 2 LF, 3 RF -> footfall order LH, LF, RH, RF.
		//
		// A LARGER OFFSET LANDS THE PAW SOONER, NOT LATER, and the first
		// version of this table read as though the opposite were true. Stance
		// begins where the phase fraction wraps, so a leg carrying +0.75 gets
		// there after only a quarter of a stride, while one at 0.00 waits a
		// full one. Ascending offsets therefore produce a DESCENDING footfall
		// order: the Dogs walked RF, RH, LF, LH — each fore paw landing before
		// the hind paw on the same side, which is a lateral-sequence walk run
		// backwards, and it puts the two SAME-SIDE legs on the ground together
		// instead of a diagonal pair.
		//
		// The unit test agreed with it, because it checked that the four
		// CONSTANTS were in ascending order — a restatement of the table below,
		// not a claim about what the Dog does. It now simulates touchdowns.
		// The browser preview is what showed it: the HUD read "RF RH LF LH".
		switch (LegIndex)
		{
		case 0: return 0.00f;   // left hind  — first down, at phase 0.00
		case 2: return 0.75f;   // left fore  — a quarter stride later
		case 1: return 0.50f;   // right hind — half a stride
		case 3: return 0.25f;   // right fore — three quarters
		default: return 0.0f;
		}
	}

	FLegPose LegPose(float StridePhase, float StrideLength, float LiftHeight)
	{
		FLegPose Pose;
		const float P = Frac(StridePhase);
		const float Reach = StrideLength * WalkDutyFactor * 0.5f;

		if (P < WalkDutyFactor)
		{
			// STANCE. The paw is planted, so relative to a body moving forward
			// it must travel BACKWARD at exactly the body's speed. Over the
			// stance the local offset runs +Reach -> -Reach, which is a total
			// of StrideLength * Duty — precisely the distance the body covers
			// in that time. That equality is the foot lock.
			Pose.bStance = true;
			Pose.Lift = 0.0f;
			Pose.Forward = Reach - (P / WalkDutyFactor) * (2.0f * Reach);
		}
		else
		{
			// SWING. The paw lifts and returns to the front. A sine arch, so it
			// leaves and meets the ground with zero vertical speed rather than
			// stabbing at it.
			const float W = (P - WalkDutyFactor) / (1.0f - WalkDutyFactor);
			Pose.bStance = false;
			Pose.Forward = -Reach + W * (2.0f * Reach);
			Pose.Lift = LiftHeight * std::sin(3.14159265358979323846f * W);
		}
		return Pose;
	}

	FBodyPose BodyPose(float StridePhase, float BobHeight)
	{
		FBodyPose Pose;
		const float P = Frac(StridePhase);
		const float TwoPi = 6.28318530717958647692f;
		// Twice per stride: the body rises as each diagonal pair takes weight.
		Pose.Bob = BobHeight * std::sin(TwoPi * 2.0f * P);
		// A quarter-cycle behind the bob, so the nose dips as weight lands.
		Pose.Pitch = 1.2f * std::sin(TwoPi * 2.0f * P - 1.5707963f);
		// Once per stride: weight rolls left, then right.
		Pose.Roll = 1.8f * std::sin(TwoPi * P);
		return Pose;
	}

	float WorldPawForward(float DistanceTravelled, float LegOffset,
	                      float StrideLength, float LiftHeight)
	{
		const float Phase = DistanceTravelled / StrideLength + LegOffset;
		const FLegPose Pose = LegPose(Phase, StrideLength, LiftHeight);
		// The body is at DistanceTravelled; the paw sits at its local offset
		// from there.
		return DistanceTravelled + Pose.Forward;
	}
}

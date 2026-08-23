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

	FLegPose LegPose(float StridePhase, float StrideLength, float LiftHeight,
	                 float DutyFactor)
	{
		FLegPose Pose;
		const float P = Frac(StridePhase);
		// Clamped, not trusted. A duty of 0 makes every paw a swing and the Dog
		// floats; a duty of 1 never lifts one and it skates. Both are silent.
		const float Duty = (DutyFactor < 0.15f) ? 0.15f
		                 : (DutyFactor > 0.95f) ? 0.95f : DutyFactor;
		const float Reach = StrideLength * Duty * 0.5f;

		if (P < Duty)
		{
			// STANCE. The paw is planted, so relative to a body moving forward
			// it must travel BACKWARD at exactly the body's speed. Over the
			// stance the local offset runs +Reach -> -Reach, which is a total
			// of StrideLength * Duty — precisely the distance the body covers
			// in that time. That equality is the foot lock.
			Pose.bStance = true;
			Pose.Lift = 0.0f;
			Pose.Forward = Reach - (P / Duty) * (2.0f * Reach);
		}
		else
		{
			// SWING. The paw lifts and returns to the front. A sine arch, so it
			// leaves and meets the ground with zero vertical speed rather than
			// stabbing at it.
			const float W = (P - Duty) / (1.0f - Duty);
			Pose.bStance = false;
			Pose.Forward = -Reach + W * (2.0f * Reach);
			Pose.Lift = LiftHeight * std::sin(3.14159265358979323846f * W);
		}
		return Pose;
	}

	namespace
	{
		// Gravity in Unreal units. 980 uu/s^2 is UE's own default.
		constexpr float GravityUU = 980.0f;

		// Footfall patterns, as phase offsets. Index 0 LH, 1 RH, 2 LF, 3 RF.
		// Remember a LARGER offset lands the paw SOONER.
		//
		// WALK  lateral sequence LH -> LF -> RH -> RF, evenly spaced.
		// TROT  DIAGONAL PAIRS move together: LH+RF, then RH+LF. This is the
		//       one that reads instantly as a different gait, because two paws
		//       leave the ground at the same instant instead of four in turn.
		// RUN   transverse gallop: the hinds land close together, then the
		//       fores, with a moment of suspension between.
		const float WalkOffsets[4] = { 0.00f, 0.50f, 0.75f, 0.25f };
		const float TrotOffsets[4] = { 0.00f, 0.50f, 0.50f, 0.00f };
		const float RunOffsets[4]  = { 0.00f, 0.12f, 0.55f, 0.67f };

		float Lerp(float A, float B, float T) { return A + (B - A) * T; }

		/** Blend two phase offsets the SHORT way round the circle.
		 *
		 *  Phases wrap, so a plain lerp from 0.9 to 0.1 walks backwards through
		 *  0.5 — the leg sweeps a full half-cycle the wrong way in the middle
		 *  of a transition, which is a visible kick. */
		float BlendPhase(float A, float B, float T)
		{
			float D = B - A;
			while (D > 0.5f) { D -= 1.0f; }
			while (D < -0.5f) { D += 1.0f; }
			return Frac(A + D * T);
		}

		/** 0 below Lo, 1 above Hi, smooth in between. Smoothstep rather than a
		 *  straight ramp so the gait does not change RATE abruptly at either
		 *  end of the band, which is its own kind of snap. */
		float Band(float V, float Lo, float Hi)
		{
			if (Hi <= Lo) { return V >= Hi ? 1.0f : 0.0f; }
			float T = (V - Lo) / (Hi - Lo);
			T = (T < 0.0f) ? 0.0f : (T > 1.0f ? 1.0f : T);
			return T * T * (3.0f - 2.0f * T);
		}
	}

	const char* GaitName(EGait Gait)
	{
		switch (Gait)
		{
		case EGait::Idle: return "idle";
		case EGait::Walk: return "walk";
		case EGait::Trot: return "trot";
		case EGait::Run:  return "run";
		default: return "?";
		}
	}

	FGaitParams GaitForSpeed(float SpeedUU, float HipHeightUU)
	{
		FGaitParams Out;
		const float Hip = (HipHeightUU > 1.0f) ? HipHeightUU : 1.0f;
		const float Speed = (SpeedUU > 0.0f) ? SpeedUU : 0.0f;

		// FROUDE NUMBER, not uu/s. Fr = v^2 / (g*h) is dimensionless, so the
		// same two thresholds place the gait change correctly for a Dog of any
		// size — the hero at actor scale 1.75 and a companion at 1.05 break
		// into a trot at different speeds and the same Fr, with no per-Dog
		// tuning and nothing to keep in sync.
		const float Fr = (Speed * Speed) / (GravityUU * Hip);

		// Alexander's transitions: walk->trot about Fr 0.5, trot->gallop about
		// Fr 2.5. Widened into BANDS so the change is blended rather than
		// switched; a four-phase swap in one frame is a snap.
		const float TrotBlend = Band(Fr, 0.35f, 0.65f);
		const float RunBlend  = Band(Fr, 2.10f, 2.90f);

		// STRIDE GROWS WITH SPEED. This is the whole point: a faster Dog covers
		// more ground per cycle, so the paws do not simply spin faster over the
		// same footprints. Relative stride rises roughly with the square root
		// of Fr in animals; sqrt is used directly and clamped so a standing
		// Dog still has a sane stride to settle into.
		const float RelStride = 1.05f + 1.35f * std::sqrt(Fr);
		Out.StrideLength = Hip * ((RelStride < 1.05f) ? 1.05f : (RelStride > 3.6f ? 3.6f : RelStride));

		// DUTY FALLS WITH SPEED: 0.65 planted at a walk, 0.45 at a trot, 0.34
		// at a run — below 0.5 there are moments with no paw down at all, which
		// is what makes a run read as a run.
		Out.DutyFactor = Lerp(Lerp(WalkDutyFactor, 0.45f, TrotBlend), 0.34f, RunBlend);

		// A faster paw clears the ground further, and the body works harder.
		Out.LiftHeight = Hip * Lerp(Lerp(0.125f, 0.185f, TrotBlend), 0.26f, RunBlend);
		Out.BobHeight  = Hip * Lerp(Lerp(0.025f, 0.045f, TrotBlend), 0.07f, RunBlend);

		for (int i = 0; i < 4; ++i)
		{
			const float WalkToTrot = BlendPhase(WalkOffsets[i], TrotOffsets[i], TrotBlend);
			Out.LegOffset[i] = BlendPhase(WalkToTrot, RunOffsets[i], RunBlend);
		}

		if (Speed < 1.0f)      { Out.Gait = EGait::Idle; Out.Blend = 0.0f; }
		else if (RunBlend > 0.5f)  { Out.Gait = EGait::Run;  Out.Blend = RunBlend; }
		else if (TrotBlend > 0.5f) { Out.Gait = EGait::Trot; Out.Blend = TrotBlend; }
		else                       { Out.Gait = EGait::Walk; Out.Blend = TrotBlend; }
		return Out;
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

	FLegSwing LegSwing(const FLegPose& Pose, float LegLength)
	{
		FLegSwing Swing;
		if (LegLength <= 0.0f)
		{
			return Swing;   // nothing to pivot about; caller gets the rest pose
		}
		// The leg's own plane: the hip sits at (0, LegLength) above the paw's
		// resting spot, and the paw is being asked for at (Forward, Lift).
		const float Rise = LegLength - Pose.Lift;
		const float Reach = std::sqrt(Pose.Forward * Pose.Forward + Rise * Rise);
		// Straight down is zero; positive swings the paw forward.
		Swing.PitchDeg = std::atan2(Pose.Forward, Rise) * (180.0f / 3.14159265358979323846f);
		Swing.Stretch = Reach / LegLength;
		return Swing;
	}

	void PushOutOfColumn(float X, float Y, float CentreX, float CentreY,
	                     float Radius, float& OutX, float& OutY)
	{
		OutX = X; OutY = Y;
		if (Radius <= 0.0f)
		{
			return;
		}
		const float DX = X - CentreX;
		const float DY = Y - CentreY;
		const float D = std::sqrt(DX * DX + DY * DY);
		if (D >= Radius)
		{
			return;
		}
		if (D > 1.0f)
		{
			OutX = CentreX + (DX / D) * Radius;
			OutY = CentreY + (DY / D) * Radius;
		}
		else
		{
			// No bearing to push along. Defined rather than divided by zero.
			OutX = CentreX + Radius;
			OutY = CentreY;
		}
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

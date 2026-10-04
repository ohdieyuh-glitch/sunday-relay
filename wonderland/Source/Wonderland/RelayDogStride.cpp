#include "RelayDogStride.h"

#include <cmath>

namespace RelayDogStride
{
	namespace
	{
		constexpr float Pi = 3.14159265358979323846f;
		constexpr float DegPerRad = 57.2957795130823209f;

		float Frac01(float V)
		{
			const float F = V - std::floor(V);
			return (F < 0.0f) ? F + 1.0f : F;
		}

		float Clamp(float V, float Lo, float Hi) { return V < Lo ? Lo : (V > Hi ? Hi : V); }

		/** 0 below Lo, 1 above Hi, smooth in between. Every band boundary uses
		 *  this rather than a step, which is why nothing pops at a threshold. */
		float SmoothStep(float V, float Lo, float Hi)
		{
			if (Hi <= Lo) return V >= Hi ? 1.0f : 0.0f;
			const float T = Clamp((V - Lo) / (Hi - Lo), 0.0f, 1.0f);
			return T * T * (3.0f - 2.0f * T);
		}
	}

	const char* GaitName(EGait Gait)
	{
		switch (Gait)
		{
		case EGait::Idle: return "Idle";
		case EGait::Walk: return "Walk";
		case EGait::Jog: return "Jog";
		case EGait::Run: return "Run";
		case EGait::AnimeRun: return "AnimeRun";
		}
		return "Idle";
	}

	float SpeedForFroude(float Froude, float LegLengthUU)
	{
		if (Froude <= 0.0f || LegLengthUU <= 0.0f) return 0.0f;
		return std::sqrt(Froude * GravityUU * LegLengthUU);
	}

	FStride StrideForSpeed(float SpeedUU, float LegLengthUU)
	{
		FStride Out;
		const float Leg = LegLengthUU > 1.0f ? LegLengthUU : 1.0f;
		const float Speed = SpeedUU > 0.0f ? SpeedUU : 0.0f;

		const float VJog = SpeedForFroude(FroudeJog, Leg);
		const float VRun = SpeedForFroude(FroudeRun, Leg);
		const float VAnime = SpeedForFroude(FroudeAnime, Leg);
		// Below this the Dog is standing: a stride phase advanced at a crawl
		// looks like a Dog shuffling on the spot, and the idle layer owns it.
		const float VStand = VJog * 0.12f;

		if (Speed <= VStand) Out.Gait = EGait::Idle;
		else if (Speed < VJog) Out.Gait = EGait::Walk;
		else if (Speed < VRun) Out.Gait = EGait::Jog;
		else if (Speed < VAnime) Out.Gait = EGait::Run;
		else Out.Gait = EGait::AnimeRun;

		// STRIDE LENGTH RISES WITH SPEED, and that is the whole anti-slide
		// mechanism: a constant stride means a Dog told to move faster cycles
		// its legs faster over the same ground, which is a moonwalk. Animals
		// lengthen the stride and shorten the fraction of it each foot spends
		// planted. Both here are continuous in speed.
		//
		// The floor is what a standing step costs; the growth is proportional
		// to sqrt(speed), the same shape as the Froude relation itself, so the
		// step count per second grows far more slowly than the speed does.
		const float Ratio = Speed / (VRun > 0.0f ? VRun : 1.0f);
		Out.DutyFactor = 0.62f - 0.27f * SmoothStep(Speed, VStand, VAnime);

		// THE HIP RIDES LOWER THE FASTER THE DOG GOES. See FStride::HipHeightUU:
		// the canonical leg is straight at rest, so without this there is no
		// reach, no knee bend, and -- measured in the founder's own playtest --
		// very little stride either. At a 3% drop the reach was +-11 uu, which
		// capped the walk at a 39 uu stride and made the Dog take SEVEN STEPS A
		// SECOND at 131 uu/s: a sewing machine, not a walk. The cap was doing
		// its job; the crouch was too shallow to give the cap anything to work
		// with.
		//
		// Twelve percent walking is also what bodies do -- a hip sits near 0.9
		// of leg length through midstance, and the difference between that and
		// a locked leg is most of the stride. It buys +-21 uu of reach, a 77 uu
		// stride, and 3.4 steps a second at the same speed. Twenty-six at a
		// full sprint keeps the cadence near six steps a second rather than a
		// blur.
		Out.HipHeightUU = Leg * (1.0f - 0.12f * SmoothStep(Speed, VStand, VJog)
			- 0.14f * SmoothStep(Speed, VJog, VAnime));

		// STRIDE LENGTH RISES WITH SPEED and is then CAPPED BY REACH. A stride
		// the legs cannot make is not a stride: it silently clamps inside the
		// IK, which shows up as a foot that stops moving at the end of its
		// travel while the body keeps going — a slide, produced by the very
		// arithmetic that exists to prevent one.
		const float Wanted = Leg * (1.35f + 1.55f * std::sqrt(Clamp(Ratio, 0.0f, 2.2f)));
		const float MaxExcursion = 2.0f * ReachHalfSpan(Leg, Out.HipHeightUU);
		const float MaxStride = Out.DutyFactor > 0.05f ? MaxExcursion / Out.DutyFactor : Wanted;
		Out.StrideLength = Wanted < MaxStride ? Wanted : MaxStride;
		Out.LiftHeight = Leg * (0.055f + 0.20f * SmoothStep(Speed, VStand, VAnime));
		Out.BobHeight = Leg * (0.030f + 0.075f * SmoothStep(Speed, VStand, VRun));

		// LEAN AND ARMS-BACK ARE POSTURE, NOT A DIFFERENT CHARACTER. The lean
		// starts in the jog and grows; the arms only begin to trail once the
		// run band is entered, and reach the full anime posture at the top.
		// "Arms-back posture only at high speed" is therefore true by
		// construction, and the test pins it at every band.
		Out.LeanDeg = 3.0f * SmoothStep(Speed, VJog * 0.85f, VRun)
			+ 14.0f * SmoothStep(Speed, VRun, VAnime * 1.25f);
		Out.ArmsBack = SmoothStep(Speed, VRun * 1.02f, VAnime * 1.1f);

		const float Lo = (Out.Gait == EGait::Idle) ? 0.0f
			: (Out.Gait == EGait::Walk) ? VStand
			: (Out.Gait == EGait::Jog) ? VJog
			: (Out.Gait == EGait::Run) ? VRun : VAnime;
		const float Hi = (Out.Gait == EGait::Idle) ? VStand
			: (Out.Gait == EGait::Walk) ? VJog
			: (Out.Gait == EGait::Jog) ? VRun
			: (Out.Gait == EGait::Run) ? VAnime : VAnime * 1.5f;
		Out.Blend = Hi > Lo ? Clamp((Speed - Lo) / (Hi - Lo), 0.0f, 1.0f) : 0.0f;
		return Out;
	}

	float ShapePhase(float Phase, float Bias)
	{
		const float P = Frac01(Phase);
		const float B = Clamp(Bias, 0.05f, 0.95f);
		return P < B ? (P / B) * 0.5f : 0.5f + ((P - B) / (1.0f - B)) * 0.5f;
	}

	FFootPose FootPose(float StridePhase, float StrideLength, float LiftHeight, float DutyFactor)
	{
		FFootPose Out;
		const float P = Frac01(StridePhase);
		const float Duty = Clamp(DutyFactor, 0.05f, 0.95f);
		// THE FOOT'S EXCURSION IS stride x duty, NOT the whole stride. While a
		// foot is planted the body travels the fraction of the cycle that foot
		// is down — duty of it — and the foot must travel exactly that far
		// backward relative to the body to stay still on the ground. Using the
		// whole stride here made every planted foot creep forward at
		// (1/duty - 1) times the body's speed: a moonwalk, hidden behind a
		// formula that looked symmetric.
		const float Excursion = StrideLength * Duty;
		const float Half = Excursion * 0.5f;

		if (P < Duty)
		{
			// STANCE. dForward/dDistance is exactly -1, so the world position
			// is constant — the identity the test asserts, with nothing to tune.
			Out.bStance = true;
			Out.Lift = 0.0f;
			Out.Forward = Half - Excursion * (P / Duty);
		}
		else
		{
			// SWING. Back to the front in the remaining fraction, lifting in a
			// single arch. A cosine, not a triangle: the foot leaves and meets
			// the ground with zero vertical speed, so there is no visible
			// stamp at either end.
			Out.bStance = false;
			const float S = (P - Duty) / (1.0f - Duty);
			Out.Forward = -Half + Excursion * S;
			Out.Lift = LiftHeight * 0.5f * (1.0f - std::cos(S * 2.0f * Pi));
		}
		return Out;
	}

	float WorldFootForward(float DistanceTravelled, float FootOffset,
	                       float StrideLength, float LiftHeight, float DutyFactor)
	{
		if (StrideLength <= 0.0f) return DistanceTravelled;
		const float Phase = DistanceTravelled / StrideLength + FootOffset;
		const FFootPose Foot = FootPose(Phase, StrideLength, LiftHeight, DutyFactor);
		return DistanceTravelled + Foot.Forward;
	}

	float FootGroundOffset(float CurrentOffset, float GroundDelta, bool bStance,
	                       float MaxOffset, float DeltaSeconds, float HalfLifeSeconds)
	{
		// A SWINGING FOOT IS RELEASED, not snapped: it eases back to zero over
		// the same half-life, so the correction that carried it up a step does
		// not vanish in one frame the moment it lifts.
		const float Target = bStance ? Clamp(GroundDelta, -MaxOffset, MaxOffset) : 0.0f;
		if (DeltaSeconds <= 0.0f || HalfLifeSeconds <= 0.0f) return Target;
		const float Alpha = 1.0f - std::pow(2.0f, -DeltaSeconds / HalfLifeSeconds);
		return CurrentOffset + (Target - CurrentOffset) * Alpha;
	}

	FStride SprintStride(const FStride& Run, float SpeedUU, float LegLengthUU, float Weight, float CyclesPerSecond)
	{
		const float W = Clamp(Weight, 0.0f, 1.0f);
		if (W <= 0.0f || SpeedUU <= 1.0f || Run.StrideLength <= 1.0f)
		{
			return Run;
		}
		const float Leg = LegLengthUU > 1.0f ? LegLengthUU : 1.0f;
		const float Cycles = Clamp(CyclesPerSecond, 2.5f, 6.0f);
		// THE CADENCE HELD: as fast as the body goes, the legs cycle at a sprinter's rate, so the stride is what grows
		const float Long = SpeedUU / Cycles > Run.StrideLength ? SpeedUU / Cycles : Run.StrideLength;
		// THE PLANTED PART FITS THE REACH: the stance shortens and the flight between steps lengthens, so a planted foot never
		// travels farther than the leg can follow it (92% of the reach, the rest is the slack the IK needs)
		const float Excursion = 2.0f * ReachHalfSpan(Leg, Run.HipHeightUU) * 0.92f;
		const float Duty = Clamp(Excursion / Long, 0.16f, Run.DutyFactor);
		FStride Out = Run;
		Out.StrideLength = Run.StrideLength + (Long - Run.StrideLength) * W;
		Out.DutyFactor = Run.DutyFactor + (Duty - Run.DutyFactor) * W;
		// a bound, not a shuffle: the feet come up and the body rides the flight
		Out.LiftHeight = Run.LiftHeight + (Leg * 0.34f - Run.LiftHeight) * W;
		Out.BobHeight = Run.BobHeight + (Leg * 0.14f - Run.BobHeight) * W;
		// the reference sprints nearly upright: a lean into the speed, never the anime dive
		Out.LeanDeg = Run.LeanDeg + (11.0f - Run.LeanDeg) * W;
		Out.ArmsBack = Run.ArmsBack + (1.0f - Run.ArmsBack) * W;
		return Out;
	}

	float ReachHalfSpan(float LegLengthUU, float HipHeightUU)
	{
		const float Leg = LegLengthUU > 0.1f ? LegLengthUU : 0.1f;
		const float Hip = Clamp(HipHeightUU, 0.05f * Leg, Leg);
		// Pythagoras, with a small margin so the IK never sits exactly on the
		// singularity where the knee angle is undefined.
		const float Span = std::sqrt(Leg * Leg - Hip * Hip);
		return Span * 0.94f;
	}

	FLegPose LegPose(const FFootPose& Foot, float ThighUU, float ShinUU, float HipHeightUU)
	{
		FLegPose Out;
		const float Thigh = ThighUU > 0.1f ? ThighUU : 0.1f;
		const float Shin = ShinUU > 0.1f ? ShinUU : 0.1f;
		const float Full = Thigh + Shin;
		const float Hip = HipHeightUU > 0.05f ? Clamp(HipHeightUU, 0.05f * Full, Full) : Full;

		// TWO-BONE INVERSE KINEMATICS, in the sagittal plane. The hip is the
		// origin; the target is the foot, `Forward` ahead of it and `Lift`
		// above the ground it would otherwise rest on.
		const float X = Foot.Forward;
		const float Y = -(Hip - Foot.Lift);    // downward is negative
		float Dist = std::sqrt(X * X + Y * Y);

		// A leg cannot reach further than it is long. Clamping slightly short
		// of full extension keeps the knee angle defined and stops the block
		// shin from snapping straight at the end of a stride, which is exactly
		// the "snap" the brief forbids.
		const float MaxReach = Full * 0.995f;
		if (Dist > MaxReach) Dist = MaxReach;
		if (Dist < 0.05f) Dist = 0.05f;

		// Law of cosines: interior knee angle, then the hip's share.
		const float CosKnee = Clamp((Thigh * Thigh + Shin * Shin - Dist * Dist) / (2.0f * Thigh * Shin), -1.0f, 1.0f);
		const float KneeInterior = std::acos(CosKnee);          // pi when straight
		Out.KneeDeg = (Pi - KneeInterior) * DegPerRad;          // 0 straight, positive folds back

		const float CosHipOffset = Clamp((Thigh * Thigh + Dist * Dist - Shin * Shin) / (2.0f * Thigh * Dist), -1.0f, 1.0f);
		const float HipOffset = std::acos(CosHipOffset);
		// Angle of the hip->foot line from straight down, positive forward.
		const float LineAngle = std::atan2(X, -Y);
		Out.HipDeg = (LineAngle + HipOffset) * DegPerRad;
		return Out;
	}

	FArmPose ArmPose(float StridePhase, bool bLeft, float GaitWeight, float ArmsBack)
	{
		FArmPose Out;
		const float Weight = Clamp(GaitWeight, 0.0f, 1.0f);
		const float Back = Clamp(ArmsBack, 0.0f, 1.0f);

		// CONTRALATERAL SWING: the arm opposes the leg on its own side, which
		// is what real gait does and what the landing rig does (armSwingRatio
		// 0.58 of the leg's swing). Kept modest — a block shoulder separates
		// visibly past about 0.4 rad and there is no skinning to hide it.
		const float Shaped = ShapePhase(StridePhase, 0.62f);
		const float A = Shaped * 2.0f * Pi + (bLeft ? Pi : 0.0f);
		// ARMS SWING LIKE A PERSON WALKING, not like a doll being carried. The
		// founder asked for a GTA-style walk; the largest single tell is how much
		// the arms carry the stride, and 21 degrees was reading as restrained.
		const float Swing = std::sin(A) * 27.0f * Weight;
		// The elbow trails the shoulder by a quarter cycle and never straightens
		// past zero: an arm swinging from a rigid shoulder with a dead-straight
		// elbow is the pendulum this seam exists to avoid.
		const float SwingElbow = (12.0f + 9.0f * std::sin(A - Pi * 0.5f)) * Weight;

		// THE ANIME POSTURE. Both arms trail straight back and slightly out, so
		// the blocks clear the hips, with the elbows nearly straight — the
		// silhouette the founder asked for, and it only exists at speed.
		const float BackShoulder = -62.0f;
		const float BackElbow = 6.0f + 4.0f * std::sin(A * 2.0f);   // a little life, not a swing
		const float BackYaw = 9.0f;

		Out.ShoulderDeg = Swing * (1.0f - Back) + BackShoulder * Back;
		Out.ElbowDeg = SwingElbow * (1.0f - Back) + BackElbow * Back;
		Out.ShoulderYawDeg = BackYaw * Back;
		return Out;
	}

	FBodyPose BodyPose(float StridePhase, const FStride& Stride)
	{
		FBodyPose Out;
		const float Shaped = ShapePhase(StridePhase, Stride.DutyFactor);
		const float A = Shaped * 2.0f * Pi;
		// Two footfalls per cycle, so the bob runs at double frequency and is
		// LOWEST at each footfall — the body sinks onto the planted leg.
		Out.BobUU = -std::fabs(std::cos(A)) * Stride.BobHeight;
		Out.SwayUU = std::sin(A) * Stride.BobHeight * 0.55f;
		Out.RollDeg = std::sin(A) * 1.6f;
		Out.PitchDeg = std::sin(A * 2.0f) * 0.8f;
		return Out;
	}

	void SpringStep(FSpring& State, float Target, float SmoothTime, float DeltaSeconds)
	{
		if (SmoothTime <= 0.0f || DeltaSeconds <= 0.0f)
		{
			State.Value = Target;
			State.Velocity = 0.0f;
			return;
		}
		const float Omega = 2.0f / SmoothTime;
		const float X = Omega * DeltaSeconds;
		const float Exp = 1.0f / (1.0f + X + 0.48f * X * X + 0.235f * X * X * X);
		const float Change = State.Value - Target;
		const float Temp = (State.Velocity + Omega * Change) * DeltaSeconds;
		State.Velocity = (State.Velocity - Omega * Temp) * Exp;
		State.Value = Target + (Change + Temp) * Exp;
	}

	float ShortestAngleDeg(float FromDeg, float ToDeg)
	{
		float Delta = std::fmod(ToDeg - FromDeg, 360.0f);
		if (Delta > 180.0f) Delta -= 360.0f;
		if (Delta < -180.0f) Delta += 360.0f;
		return Delta;
	}

	FIdlePose IdlePose(float TimeSeconds, float Weight, float ScaleUU)
	{
		FIdlePose Out;
		const float W = Clamp(Weight, 0.0f, 1.0f);
		if (W <= 0.0f) return Out;
		const float S = ScaleUU > 0.0f ? ScaleUU : 60.0f;

		// THREE INCOMMENSURATE FREQUENCIES, as on the landing: 0.37, 0.61 and
		// 0.8 have no common period inside any watching time, so the loop
		// cannot be heard. What is deliberately ABSENT is a vertical breathing
		// bob — the founder's rule for this body is settling, not pulsing — so
		// the weight moves sideways and the limbs settle, and nothing rises.
		const float Shift = std::sin(TimeSeconds * 0.37f);
		const float Drift = std::sin(TimeSeconds * 0.61f + 1.2f);
		const float Settle = std::sin(TimeSeconds * 0.8f + 0.4f);

		Out.SwayUU = Shift * 0.012f * S * W;
		Out.RollDeg = Shift * 0.55f * W;
		Out.HeadYawDeg = Drift * 1.1f * W;      // beneath the glance layer, not instead of it
		Out.HeadPitchDeg = Settle * 0.5f * W;
		Out.ArmLeftDeg = Settle * 0.9f * W;
		Out.ArmRightDeg = -Settle * 0.9f * W;
		Out.TailYawDeg = std::sin(TimeSeconds * 0.53f) * 2.2f * W;
		Out.TailPitchDeg = Drift * 1.4f * W;
		return Out;
	}

	float FInterest::NextFloat()
	{
		// xorshift32: deterministic, seedable, and dependency-free — the test
		// needs the same sequence twice, and <random> is not worth linking for
		// four numbers a second.
		Rng ^= Rng << 13;
		Rng ^= Rng >> 17;
		Rng ^= Rng << 5;
		return static_cast<float>(Rng & 0x00FFFFFFu) / static_cast<float>(0x01000000u);
	}

	FGlance FInterest::Update(float DeltaSeconds)
	{
		Remaining -= DeltaSeconds > 0.0f ? DeltaSeconds : 0.0f;
		if (Remaining > 0.0f)
		{
			Current.HoldSeconds = Remaining;
			return Current;
		}

		if (!bResting)
		{
			// A REST BETWEEN GLANCES, near centre. Without it the head walks
			// from one interest to the next and never settles, which reads as
			// scanning — a turret, not a companion.
			bResting = true;
			Current.bAttending = false;
			Current.YawDeg = (NextFloat() * 2.0f - 1.0f) * HeadYawLimitDeg * 0.12f;
			Current.PitchDeg = (NextFloat() * 2.0f - 1.0f) * HeadPitchLimitDeg * 0.12f;
			Remaining = 0.9f + NextFloat() * 2.6f;
		}
		else
		{
			bResting = false;
			Current.bAttending = true;
			// ANTI-REPETITION, not a coin flip. A fair coin puts the head on
			// the same side six or seven times running inside a few minutes,
			// and a companion that keeps glancing the same way looks stuck on
			// something the viewer cannot see. Strongly preferring the other
			// side keeps the head reading as an observer taking the room in,
			// while still never being predictable.
			const float Side = (LastSide >= 0.0f) ? -1.0f : 1.0f;
			const float Flip = NextFloat() < 0.78f ? Side : -Side;
			LastSide = Flip;
			Current.YawDeg = Flip * (0.35f + 0.65f * NextFloat()) * HeadYawLimitDeg;
			// Occasional up/down observation: about one glance in three also
			// lifts or drops, and looking UP is the more common of the two —
			// a Dog in a place like this attends to the architecture.
			const float R = NextFloat();
			Current.PitchDeg = (R < 0.22f) ? -(0.4f + 0.6f * NextFloat()) * HeadPitchLimitDeg
				: (R < 0.34f) ? (0.4f + 0.6f * NextFloat()) * HeadPitchLimitDeg
				: (NextFloat() * 2.0f - 1.0f) * HeadPitchLimitDeg * 0.2f;
			// VARIABLE DWELL. 0.7..3.1 s, never the same twice in a row by more
			// than chance; a fixed interval is the mechanical loop the brief
			// forbids.
			Remaining = 0.7f + NextFloat() * 2.4f;
		}
		Current.HoldSeconds = Remaining;
		return Current;
	}

	void FDogAnimator::Configure(float InLegLengthUU, float InThighUU, float InShinUU, float InScaleUU)
	{
		LegLengthUU = InLegLengthUU > 1.0f ? InLegLengthUU : 1.0f;
		ThighUU = InThighUU > 0.5f ? InThighUU : 0.5f;
		ShinUU = InShinUU > 0.5f ? InShinUU : 0.5f;
		ScaleUU = InScaleUU > 1.0f ? InScaleUU : 1.0f;
	}

	const FDogPose& FDogAnimator::Update(const FDogInput& In)
	{
		// A hitch or a resumed tab delivers one enormous dt. Unclamped it spins
		// the stride through several cycles in a frame and teleports every
		// spring — a visible glitch that looks like a bug in the animation.
		const float Dt = Clamp(In.DeltaSeconds, 0.0f, 0.05f);
		Elapsed += Dt;

		// The speed that drives POSTURE is filtered, so a single frame of
		// collision noise cannot flick the Dog into an anime run and back. The
		// distance that drives PHASE is not filtered: it is ground truth.
		SpringStep(SpeedFilter, In.SpeedUU, 0.16f, Dt);
		const float Speed = SpeedFilter.Value > 0.0f ? SpeedFilter.Value : 0.0f;

		// THE MISSION HANDOFF SPRINT rides on the run (0 = exactly the run)
		const FStride Stride = SprintStride(StrideForSpeed(Speed, LegLengthUU), Speed, LegLengthUU, In.SprintWeight, In.SprintCycles);
		Current.Stride = Stride;
		Current.SpeedUU = Speed;

		// GAIT WEIGHT eases in and out, so starting and stopping are weighted
		// rather than instant: the legs blend up out of the idle layer instead
		// of appearing mid-stride.
		const float WantsGait = (Stride.Gait == EGait::Idle) ? 0.0f : 1.0f;
		SpringStep(GaitBlend, WantsGait, WantsGait > 0.5f ? 0.28f : 0.42f, Dt);
		const float Weight = Clamp(GaitBlend.Value, 0.0f, 1.0f);
		Current.GaitWeight = Weight;

		// PHASE FROM DISTANCE, NEVER FROM A CLOCK. This is the anti-slide
		// invariant: if the body does not move, the feet do not cycle.
		//
		// ACCUMULATED, NOT DIVIDED. `frac(TotalDistance / StrideLength)` looks
		// equivalent and is not: the stride LENGTHENS with speed, so the moment
		// it changes, a phase computed from the whole journey jumps by
		// TotalDistance x delta / stride^2 — after a few hundred metres that is
		// most of a cycle, and it teleports the legs mid-run. Integrating the
		// increment makes the phase continuous through any stride change.
		Distance += In.DistanceUU;
		const float Stride01 = Stride.StrideLength > 1.0f ? Stride.StrideLength : 1.0f;
		Phase = Frac01(Phase + In.DistanceUU / Stride01);
		Current.StridePhase = Phase;

		const FFootPose FootL = FootPose(Current.StridePhase, Stride.StrideLength, Stride.LiftHeight, Stride.DutyFactor);
		const FFootPose FootR = FootPose(Current.StridePhase + 0.5f, Stride.StrideLength, Stride.LiftHeight, Stride.DutyFactor);
		// THE GROUND UNDER EACH FOOT, eased. On the flat both deltas are zero
		// and this changes nothing; on a stair the planted foot is placed on
		// the step it is actually over instead of hanging in the air or sinking
		// into the stone.
		const float MaxFootOffset = LegLengthUU * 0.45f;
		FootOffsetLeft = FootGroundOffset(FootOffsetLeft, In.GroundDeltaLeft, FootL.bStance, MaxFootOffset, Dt);
		FootOffsetRight = FootGroundOffset(FootOffsetRight, In.GroundDeltaRight, FootR.bStance, MaxFootOffset, Dt);
		FFootPose GroundedL = FootL;
		FFootPose GroundedR = FootR;
		GroundedL.Lift += FootOffsetLeft;
		GroundedR.Lift += FootOffsetRight;
		Current.FootOffsetLeft = FootOffsetLeft;
		Current.FootOffsetRight = FootOffsetRight;
		Current.FootLeft = GroundedL;
		Current.FootRight = GroundedR;

		const FLegPose RawL = LegPose(GroundedL, ThighUU, ShinUU, Stride.HipHeightUU);
		const FLegPose RawR = LegPose(GroundedR, ThighUU, ShinUU, Stride.HipHeightUU);
		// Blended by weight against the standing pose (0,0), so easing out of a
		// walk eases the stride down rather than freezing a leg mid-air.
		Current.LegLeft = { RawL.HipDeg * Weight, RawL.KneeDeg * Weight };
		Current.LegRight = { RawR.HipDeg * Weight, RawR.KneeDeg * Weight };

		Current.ArmLeft = ArmPose(Current.StridePhase, true, Weight, Stride.ArmsBack * Weight);
		Current.ArmRight = ArmPose(Current.StridePhase, false, Weight, Stride.ArmsBack * Weight);

		const FBodyPose Body = BodyPose(Current.StridePhase, Stride);
		Current.Body = { Body.BobUU * Weight, Body.SwayUU * Weight, Body.RollDeg * Weight, Body.PitchDeg * Weight };
		// The pelvis drop that buys the legs their reach, eased in with the
		// gait so a standing Dog is at its canonical height.
		Current.PelvisDropUU = (LegLengthUU - Stride.HipHeightUU) * Weight;

		SpringStep(Lean, Stride.LeanDeg * Weight, 0.35f, Dt);
		Current.LeanDeg = Lean.Value;

		// TURNS RESPECT MOMENTUM: the body banks into the turn in proportion to
		// how fast it is going and how hard it is turning, and the bank eases
		// out on its own spring rather than tracking the input.
		const float TurnDeg = ShortestAngleDeg(In.HeadingDeg, In.DesiredHeadingDeg);
		const float TurnRate = Dt > 0.0f ? Clamp(TurnDeg / (Dt * 240.0f), -1.0f, 1.0f) : 0.0f;
		const float SpeedFrac = Clamp(Speed / (SpeedForFroude(FroudeRun, LegLengthUU) + 1.0f), 0.0f, 1.4f);
		SpringStep(TurnRoll, -TurnRate * SpeedFrac * 9.0f, 0.40f, Dt);
		Current.TurnRollDeg = TurnRoll.Value;

		// HEAD: the interest scheduler proposes, a runtime look target
		// overrides, and both go through the same springs, so an override
		// cannot make the head snap.
		const FGlance Glance = Interest.Update(Dt);
		float WantYaw = In.bHasLookTarget ? In.LookYawDeg : Glance.YawDeg;
		float WantPitch = In.bHasLookTarget ? In.LookPitchDeg : Glance.PitchDeg;
		// While moving the head settles toward where the body is going: a Dog
		// that keeps glancing sideways at a run reads as distracted.
		WantYaw *= (1.0f - 0.75f * Weight);
		WantPitch *= (1.0f - 0.5f * Weight);
		WantYaw = Clamp(WantYaw, -HeadYawLimitDeg, HeadYawLimitDeg);
		WantPitch = Clamp(WantPitch, -HeadPitchLimitDeg, HeadPitchLimitDeg);
		// The landing's own smoothing times, so the ease matches the web Dog.
		SpringStep(HeadYaw, WantYaw, 0.45f, Dt);
		SpringStep(HeadPitch, WantPitch, 0.50f, Dt);

		// THE SHOULDERS ARGUE WITH THE HIPS. A walking body counter-rotates: as
		// the left leg comes through, the torso turns very slightly right. Two
		// degrees is almost invisible held still and is most of what separates
		// walking from marching -- and because the whole body carries it here,
		// the legs turn with it, which is what stops the counter-rotation from
		// sliding the feet.
		Current.BodyYawDeg = -std::sin(ShapePhase(Current.StridePhase, Stride.DutyFactor) * 2.0f * Pi) * 2.4f * Weight;

		// THE JUMP IS A POSE, NOT AN ABSENCE OF ONE. Off the ground the legs
		// fold up under the body and the arms come out and up -- the founder's
		// "legs bend, arms spread". Rising and falling differ: on the way up
		// the body is still extending, on the way down it reaches for the
		// ground it is about to meet.
		// Leaving the ground is quick, landing is not: a pose that arrives in a
		// tenth of a second reads as a jump, one that LEAVES that fast reads as
		// a snap. The test measured 16.6 degrees in a single frame at 0.22 s.
		SpringStep(Airborne, In.bInAir ? 1.0f : 0.0f, In.bInAir ? 0.12f : 0.34f, Dt);
		Current.AirborneWeight = Clamp(Airborne.Value, 0.0f, 1.0f);
		if (Current.AirborneWeight > 0.001f)
		{
			const float Air = Current.AirborneWeight;
			// -1 falling, +1 rising, with a dead band so the apex is calm.
			const float Rise = Clamp(In.VerticalSpeedUU / 320.0f, -1.0f, 1.0f);
			// A REAL TUCK. At 42 degrees the jump was straighter-legged than a
			// running stride, whose knee passes 100 -- so leaving the ground
			// visibly UNBENT the legs, which is the opposite of a jump. Rising
			// folds them up under the body; falling extends them toward the
			// ground the Dog is about to meet.
			const float Tuck = 78.0f + 26.0f * Rise;
			const float HipUp = 30.0f + 12.0f * Rise;
			Current.LegLeft.HipDeg = Current.LegLeft.HipDeg * (1.0f - Air) + HipUp * Air;
			Current.LegRight.HipDeg = Current.LegRight.HipDeg * (1.0f - Air) + (HipUp * 0.65f) * Air;
			Current.LegLeft.KneeDeg = Current.LegLeft.KneeDeg * (1.0f - Air) + Tuck * Air;
			Current.LegRight.KneeDeg = Current.LegRight.KneeDeg * (1.0f - Air) + (Tuck * 0.8f) * Air;
			// THE ARMS WERE BEHIND THE BODY, AND THE COMMENT SAID OTHERWISE.
			//
			// The founder rejected this jump: "arms/front limbs pulled behind
			// him". The old line was `ArmUp = -34 - 18 * Rise` under a comment
			// reading "Arms out and up". In this rig NEGATIVE IS BACK -- the
			// anime run's "both arms trail straight back" is BackShoulder =
			// -62.0 in ArmPose() twenty lines up. So the jump asked for 52
			// degrees BACK on takeoff and 34 at the apex: the arms-back
			// silhouette, a few degrees short of the sprint pose, described in
			// the comment as its opposite. Nothing measured it because the
			// gait goldens cover locomotion, not the airborne override.
			//
			// A person's arms LEAD a jump. They swing back during the dip
			// (below), then drive forward and up through takeoff, stay high
			// while the body is rising, and come down and forward again on the
			// way to the ground so the landing has something to balance
			// against. That is the arc these numbers make, with Rise as the
			// clock: +1 leaving the ground, 0 at the apex, -1 descending.
			const float ArmFwd = 58.0f + 22.0f * Rise;      // 80 up, 58 apex, 36 down
			const float ArmElbow = 30.0f - 8.0f * Rise;     // folds in slightly to land
			// Only enough outward sweep to clear the hips. The old 30 existed
			// because arms held BEHIND the body foul the torso; arms in front
			// do not need it, and a wide sweep reads as a T-pose.
			const float ArmOut = 16.0f;
			Current.ArmLeft.ShoulderDeg = Current.ArmLeft.ShoulderDeg * (1.0f - Air) + ArmFwd * Air;
			Current.ArmRight.ShoulderDeg = Current.ArmRight.ShoulderDeg * (1.0f - Air) + ArmFwd * Air;
			Current.ArmLeft.ElbowDeg = Current.ArmLeft.ElbowDeg * (1.0f - Air) + ArmElbow * Air;
			Current.ArmRight.ElbowDeg = Current.ArmRight.ElbowDeg * (1.0f - Air) + ArmElbow * Air;
			Current.ArmLeft.ShoulderYawDeg = Current.ArmLeft.ShoulderYawDeg * (1.0f - Air) + ArmOut * Air;
			Current.ArmRight.ShoulderYawDeg = Current.ArmRight.ShoulderYawDeg * (1.0f - Air) + ArmOut * Air;
			// Chest opens slightly on the way up, torso folds forward on the way
			// down to meet the ground. Was -7 * Rise, which leaned BACK while
			// falling -- the pose of someone being lifted, not someone landing.
			Current.LeanDeg = Current.LeanDeg * (1.0f - Air) + (2.0f - 6.0f * Rise) * Air;
			Current.BodyYawDeg *= (1.0f - Air);
		}

		// THE DIP BEFORE, AND THE ABSORB AFTER. Both happen while the Dog is on
		// the ground, where AirborneWeight is zero, so neither can live in the
		// block above. A jump with no anticipation and no landing is two poses
		// with a gap; these are the frames that make it one movement.
		//
		// LOAD: knees bend, hips drop, arms swing BACK and down -- which is the
		// one moment arms-behind is correct, and is what the takeoff swings out
		// of. Fast in (0.08 s) because a dip you can watch arrive is a squat.
		SpringStep(Crouch, (In.bJumpPressed && !In.bInAir) ? 1.0f : 0.0f,
		           (In.bJumpPressed && !In.bInAir) ? 0.08f : 0.16f, Dt);
		// ABSORB: fires on TOUCHDOWN, detected here rather than reported by the
		// actor -- last frame airborne, this frame not. Decays slowly so the
		// knees give and recover instead of snapping straight.
		const bool bTouchedDown = (PrevAirborne > 0.35f) && !In.bInAir;
		if (bTouchedDown) { Land.Value = 1.0f; }
		SpringStep(Land, 0.0f, 0.30f, Dt);
		PrevAirborne = Current.AirborneWeight;

		const float Dip = Clamp(Crouch.Value, 0.0f, 1.0f) + Clamp(Land.Value, 0.0f, 1.0f);
		// Carried past the body block below, which ASSIGNS BobUU from the stride
		// and would discard a dip applied here. Found by the acceptance test:
		// knees bent, arms loaded, and the body height never moved.
		float DipBobUU = 0.0f;
		if (Dip > 0.001f)
		{
			const float D = Clamp(Dip, 0.0f, 1.0f);
			// Knees take the load on both the dip and the landing.
			Current.LegLeft.KneeDeg += 34.0f * D;
			Current.LegRight.KneeDeg += 34.0f * D;
			Current.LegLeft.HipDeg += 10.0f * D;
			Current.LegRight.HipDeg += 10.0f * D;
			// The body actually lowers; a crouch that does not change height is
			// a leg animation nobody reads as weight. Applied below, after the
			// stride's own bob is assigned.
			DipBobUU = 5.5f * D * (ScaleUU / 100.0f);
			Current.LeanDeg += 6.0f * D;
			// Arms back and down to LOAD the swing, forward-low to STABILISE on
			// landing. Crouch drives them back, Land settles them in front.
			const float C = Clamp(Crouch.Value, 0.0f, 1.0f);
			const float L = Clamp(Land.Value, 0.0f, 1.0f);
			const float ArmLoad = -38.0f * C + 20.0f * L;
			Current.ArmLeft.ShoulderDeg = Current.ArmLeft.ShoulderDeg * (1.0f - D) + ArmLoad * D;
			Current.ArmRight.ShoulderDeg = Current.ArmRight.ShoulderDeg * (1.0f - D) + ArmLoad * D;
			Current.ArmLeft.ElbowDeg += 14.0f * D;
			Current.ArmRight.ElbowDeg += 14.0f * D;
		}

		const FIdlePose Idle = IdlePose(Elapsed, 1.0f - Weight, ScaleUU);
		Current.HeadYawDeg = HeadYaw.Value + Idle.HeadYawDeg;
		// Lean pitches the whole body forward; the head keeps its own level, so
		// the Dog looks where it is going instead of at the floor.
		Current.HeadPitchDeg = HeadPitch.Value + Idle.HeadPitchDeg + Current.LeanDeg * 0.55f;
		Current.SwayUU = Current.Body.SwayUU + Idle.SwayUU;
		Current.BobUU = Current.Body.BobUU - DipBobUU;
		Current.Body.RollDeg += Idle.RollDeg;
		Current.ArmLeft.ShoulderDeg += Idle.ArmLeftDeg;
		Current.ArmRight.ShoulderDeg += Idle.ArmRightDeg;

		// The tail settles at idle and counterbalances at speed.
		Current.TailYawDeg = Idle.TailYawDeg + std::sin(Current.StridePhase * 2.0f * Pi) * 5.0f * Weight;
		Current.TailPitchDeg = Idle.TailPitchDeg - 16.0f * Stride.ArmsBack * Weight;
		return Current;
	}
}

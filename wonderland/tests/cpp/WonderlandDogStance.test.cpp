// THE UPRIGHT RELAY DOG, PROVEN ON A LAPTOP.
//
// The founder's bar is "must not look like a Minecraft character": no jitter,
// no snapping, no sliding, no pose stepping, no whole-body-as-one-block. Every
// one of those is a property of the arithmetic rather than of the renderer, so
// every one of them is decided here, with g++ and no GPU, before a build is
// ever spent on it.
//
// The tests are written to FAIL against the specific defect they name. A test
// that passes whatever the code does has not checked anything.
#include "WonderlandDogStance.h"

#include <cmath>
#include <cstdio>
#include <string>

using namespace WonderlandStance;

static int Passed = 0;
static int Failed = 0;

static void Check(bool Cond, const std::string& What)
{
	if (Cond) { ++Passed; std::printf("  ok   %s\n", What.c_str()); }
	else      { ++Failed; std::printf("  FAIL %s\n", What.c_str()); }
}

int main()
{
	const float LegLength = 74.0f;
	const float TorsoLength = 118.0f;
	const float Stride = 96.0f;
	const float Lift = 15.0f;

	// ---------------------------------------------------------------- sliding
	//
	// THE ONE THAT MATTERS MOST. While a foot is planted its world position
	// must not change AT ALL. Any drift and the eye reads skating, however
	// good everything else is.
	{
		float MaxDrift = 0.0f;
		for (int Leg = 0; Leg < 2; ++Leg)
		{
			const float Off = LegPhaseOffset(Leg);
			float Locked = 0.0f;
			bool bHave = false;
			for (int i = 0; i <= 4000; ++i)
			{
				const float D = Stride * 3.0f * (i / 4000.0f);
				const FStepPose P = StepPose(D / Stride + Off, Stride, Lift);
				const float World = WorldFootForward(D, Off, Stride, Lift);
				if (P.bStance)
				{
					if (bHave)
					{
						const float Drift = std::fabs(World - Locked);
						if (Drift > MaxDrift) { MaxDrift = Drift; }
					}
					else { Locked = World; bHave = true; }
				}
				else { bHave = false; }
			}
		}
		Check(MaxDrift < 0.02f,
		      "a planted foot does not move in world space (drift "
		      + std::to_string(MaxDrift) + " uu)");
	}

	// A planted foot is also ON THE GROUND. A stance foot with lift is a Dog
	// walking on air, and it is the other half of the same illusion.
	{
		float MaxStanceLift = 0.0f;
		for (int i = 0; i <= 2000; ++i)
		{
			const FStepPose P = StepPose(i / 2000.0f, Stride, Lift);
			if (P.bStance && P.Lift > MaxStanceLift) { MaxStanceLift = P.Lift; }
		}
		Check(MaxStanceLift == 0.0f, "a planted foot is on the ground, not above it");
	}

	// --------------------------------------------------------------- snapping
	//
	// CONTINUITY ACROSS THE WHOLE CYCLE, INCLUDING THE WRAP. The stance/swing
	// boundary and the phase seam at 1.0 are exactly where a walk pops.
	{
		float MaxJump = 0.0f;
		const int N = 20000;
		float PrevF = StepPose(0.0f, Stride, Lift).Forward;
		float PrevL = StepPose(0.0f, Stride, Lift).Lift;
		for (int i = 1; i <= N; ++i)
		{
			const float Phase = 2.0f * (i / static_cast<float>(N));
			const FStepPose P = StepPose(Phase, Stride, Lift);
			MaxJump = std::fmax(MaxJump, std::fabs(P.Forward - PrevF));
			MaxJump = std::fmax(MaxJump, std::fabs(P.Lift - PrevL));
			PrevF = P.Forward; PrevL = P.Lift;
		}
		// One step of this sweep covers a ten-thousandth of a stride; a
		// continuous curve cannot move more than a fraction of a uu across it.
		Check(MaxJump < 0.5f,
		      "the step cycle is continuous everywhere, including the wrap (max jump "
		      + std::to_string(MaxJump) + " uu)");
	}

	// The FOOT LEAVES AND LANDS AT ZERO HEIGHT. A swing that starts or ends
	// with the foot already off the ground is a foot clipping through it.
	{
		const FStepPose Off = StepPose(WalkDutyFactor + 1e-5f, Stride, Lift);
		const FStepPose On  = StepPose(1.0f - 1e-5f, Stride, Lift);
		Check(Off.Lift < 0.05f && On.Lift < 0.05f,
		      "the foot leaves and lands at ground height");
	}

	// --------------------------------------------------- not one rigid block
	//
	// THE BODY MOVES ON THREE DIFFERENT RHYTHMS. If rise and sway shared a
	// period the walk would bounce; the whole point is that they do not.
	{
		// Rise peaks TWICE per stride, sway ONCE. Count sign changes in the
		// derivative over one cycle.
		int RisePeaks = 0, SwayPeaks = 0;
		const int N = 2000;
		float PrevRiseD = 0.0f, PrevSwayD = 0.0f;
		for (int i = 1; i <= N; ++i)
		{
			const float A = (i - 1) / static_cast<float>(N);
			const float B = i / static_cast<float>(N);
			const FCarriage CA = Carriage(A, 10.0f, 6.0f);
			const FCarriage CB = Carriage(B, 10.0f, 6.0f);
			const float RiseD = CB.PelvisRise - CA.PelvisRise;
			const float SwayD = CB.PelvisSway - CA.PelvisSway;
			if (i > 1 && PrevRiseD > 0.0f && RiseD <= 0.0f) { ++RisePeaks; }
			if (i > 1 && PrevSwayD > 0.0f && SwayD <= 0.0f) { ++SwayPeaks; }
			PrevRiseD = RiseD; PrevSwayD = SwayD;
		}
		Check(RisePeaks == 2, "the pelvis rises twice per stride (once over each foot)");
		Check(SwayPeaks == 1, "...and shifts its weight sideways ONCE, at half that rate");
	}

	// THE SHOULDERS COUNTER-ROTATE AGAINST THE HIPS. Same-sign is a mannequin
	// being carried; opposite-sign is walking.
	{
		bool bAlwaysOpposed = true;
		for (int i = 0; i <= 400; ++i)
		{
			const FCarriage C = Carriage(i / 400.0f, 10.0f, 6.0f);
			if (std::fabs(C.PelvisYawDeg) > 0.4f
			    && C.PelvisYawDeg * C.TorsoYawDeg > 0.0f)
			{
				bAlwaysOpposed = false; break;
			}
		}
		Check(bAlwaysOpposed, "the shoulders counter-rotate against the hips, every step");
	}

	// THE HEAD HOLDS STEADY. It must move LESS than the pelvis it sits on --
	// that is what gaze stabilisation means, and a head welded to the chest is
	// the doll read the founder is describing.
	{
		float PelvisSpan = 0.0f, HeadSpan = 0.0f;
		float PMin = 1e9f, PMax = -1e9f, HMin = 1e9f, HMax = -1e9f;
		for (int i = 0; i <= 800; ++i)
		{
			const FCarriage C = Carriage(i / 800.0f, 10.0f, 6.0f);
			const float H = C.PelvisRise + C.HeadRise;   // the head's own height
			PMin = std::fmin(PMin, C.PelvisRise); PMax = std::fmax(PMax, C.PelvisRise);
			HMin = std::fmin(HMin, H);           HMax = std::fmax(HMax, H);
		}
		PelvisSpan = PMax - PMin; HeadSpan = HMax - HMin;
		Check(HeadSpan < PelvisSpan * 0.75f,
		      "the head is stabilised against the pelvis (head " + std::to_string(HeadSpan)
		      + " uu vs pelvis " + std::to_string(PelvisSpan) + " uu)");
	}

	// ------------------------------------------------------------- arm swing
	//
	// CONTRALATERAL. The left arm must lead when the RIGHT leg does. This is a
	// sign error away at all times and it is instantly readable when wrong.
	{
		// Sample where the LEFT leg is at its most forward and check the arm
		// on that same side is BACK.
		float BestPhase = 0.0f, BestFwd = -1e9f;
		for (int i = 0; i <= 2000; ++i)
		{
			const float Ph = i / 2000.0f;
			const FStepPose P = StepPose(Ph + LegPhaseOffset(0), Stride, Lift);
			if (P.Forward > BestFwd) { BestFwd = P.Forward; BestPhase = Ph; }
		}
		const FArmSwing A = ArmSwing(BestPhase + LegPhaseOffset(0), 26.0f);
		Check(A.PitchDeg < 0.0f,
		      "the arm swings opposite its own leg, not with it (contralateral)");
	}

	// AND IT TRAILS. An arm that reaches its extreme at the same instant the
	// leg does is clockwork; limbs have mass.
	{
		float LegPeak = 0.0f, LegBest = -1e9f;
		float ArmPeak = 0.0f, ArmBest = -1e9f;
		for (int i = 0; i <= 4000; ++i)
		{
			const float Ph = i / 4000.0f;
			const FStepPose P = StepPose(Ph, Stride, Lift);
			if (P.Forward > LegBest) { LegBest = P.Forward; LegPeak = Ph; }
			const FArmSwing A = ArmSwing(Ph + 0.5f, 26.0f);   // opposite arm
			if (A.PitchDeg > ArmBest) { ArmBest = A.PitchDeg; ArmPeak = Ph; }
		}
		const float Lag = std::fabs(ArmPeak - LegPeak);
		Check(Lag > 0.01f && Lag < 0.30f,
		      "the arm trails its leg rather than snapping in lockstep (lag "
		      + std::to_string(Lag) + " of a cycle)");
	}

	// An idle Dog's arms HANG. Waving arms at a standstill is the single most
	// obvious tell of a walk cycle that never turns off.
	{
		Check(ArmAmplitudeFor(0.0f, LegLength) == 0.0f,
		      "a standing Dog's arms hang instead of swinging");
		Check(ArmAmplitudeFor(400.0f, LegLength) > ArmAmplitudeFor(80.0f, LegLength),
		      "...and swing further the faster it goes");
	}

	// ------------------------------------------------------- the standing form
	//
	// AT BLEND 0 IT IS EXACTLY THE CANONICAL QUADRUPED. Not nearly. If the
	// upright form leaks into the default pose then every Dog in Wonderland is
	// quietly wrong, which is the identity rule this whole file is under.
	{
		const FStandingPose Q = StandingPose(0.0f, LegLength, TorsoLength);
		bool bZero = (Q.PelvisRise == 0.0f && Q.TorsoPitchDeg == 0.0f
		              && Q.TorsoRise == 0.0f && Q.HeadRise == 0.0f
		              && Q.HeadPitchDeg == 0.0f && Q.TailPitchDeg == 0.0f
		              && Q.LegStretch == 1.0f);
		for (int i = 0; i < 4; ++i)
		{
			bZero = bZero && Q.LegRise[i] == 0.0f && Q.LegPitchDeg[i] == 0.0f
			              && Q.LegSpread[i] == 0.0f;
		}
		Check(bZero, "at blend 0 the Dog is EXACTLY the canonical quadruped");
	}

	// THE SILHOUETTE MATCHES THE SHEET. Standing, the head must clear the
	// shoulders and the arms must hang from near the top of the torso -- that
	// is what makes it the Dog from the reference rather than a begging dog.
	{
		const FStandingPose S = StandingPose(1.0f, LegLength, TorsoLength);
		Check(S.TorsoPitchDeg < -60.0f, "standing, the torso is vertical, not pitched back");
		// LEVEL IS AN ABSOLUTE CLAIM, not a relative one. Every part hangs off
		// the actor root, so "level" means the head's own pitch is near zero --
		// NOT that it cancels the torso's. The first version asserted the
		// cancellation and passed happily while drawing a Dog looking at the
		// sky, which is a test agreeing with a bug because both shared a wrong
		// model of the rig.
		Check(std::fabs(S.HeadPitchDeg) < 12.0f,
		      "the head stays LEVEL so the visor and gold eyes face the camera");
		Check(S.HeadForward < -0.4f * TorsoLength,
		      "the head comes BACK over the body instead of leading it");
		Check(S.LegForward[0] > 0.0f && S.LegForward[2] < 0.0f,
		      "the legs gather under the hips and the arms come back to the shoulders");
		Check(S.HeadRise > S.TorsoRise,
		      "the head sits ON TOP of the standing torso");
		Check(S.ArmRise[0] > 0.5f * TorsoLength,
		      "the arms hang from shoulder height, as the sheet draws them");
		Check(S.LegRise[0] == 0.0f && S.LegRise[1] == 0.0f,
		      "the standing feet stay on the ground");
		Check(S.LegSpread[0] < 0.0f && S.LegSpread[1] > 0.0f,
		      "the feet are apart, giving the stance a base");
		Check(S.TailPitchDeg < 0.0f, "the tail is retained and swings back");
		Check(S.LegStretch > 1.0f,
		      "the standing legs span the raised hip instead of leaving the body floating");
	}

	// STANDING UP IS CONTINUOUS. A pose that arrives in one frame is the
	// "teleporting into the pose" defect, and it is what ApproachBlend and the
	// smoothstep here exist to prevent.
	{
		float MaxJump = 0.0f;
		const int N = 4000;
		FStandingPose Prev = StandingPose(0.0f, LegLength, TorsoLength);
		for (int i = 1; i <= N; ++i)
		{
			const FStandingPose S = StandingPose(i / static_cast<float>(N),
			                                     LegLength, TorsoLength);
			MaxJump = std::fmax(MaxJump, std::fabs(S.TorsoRise - Prev.TorsoRise));
			MaxJump = std::fmax(MaxJump, std::fabs(S.HeadRise - Prev.HeadRise));
			MaxJump = std::fmax(MaxJump, std::fabs(S.TorsoPitchDeg - Prev.TorsoPitchDeg));
			Prev = S;
		}
		Check(MaxJump < 0.5f, "the Dog stands up continuously, never in one frame");
	}

	// ----------------------------------------------------- frame-rate honesty
	//
	// THE SAME ELAPSED TIME MUST PRODUCE THE SAME RESULT whatever the step
	// size. `Current += Rate * Dt` does not, and this world is streamed at a
	// frame rate that moves -- so a transition tuned at 60 fps would snap at
	// 20. One second of easing, taken in 20 steps and in 240.
	{
		float A = 0.0f, B = 0.0f;
		for (int i = 0; i < 20; ++i)  { A = Approach(A, 1.0f, 1.0f / 20.0f); }
		for (int i = 0; i < 240; ++i) { B = Approach(B, 1.0f, 1.0f / 240.0f); }
		Check(std::fabs(A - B) < 0.005f,
		      "easing is frame-rate independent (20 fps " + std::to_string(A)
		      + " vs 240 fps " + std::to_string(B) + ")");
	}

	// TURNING TAKES THE SHORT WAY. Easing a raw heading across the +/-180 seam
	// spins the long way round, and that is a snap you cannot miss.
	{
		const float Next = ApproachAngleDeg(170.0f, -170.0f, 1.0f / 60.0f);
		// The short way is +20 degrees, through 180. Going the long way would
		// move the heading DOWN from 170.
		Check(Next > 170.0f || Next < -170.0f,
		      "a turn across the 180 seam takes the short way (" + std::to_string(Next) + ")");
		const float Far = ApproachAngleDeg(0.0f, 90.0f, 1.0f / 60.0f);
		Check(Far > 0.0f && Far < 90.0f, "...and eases rather than jumping to the target");
	}

	// ------------------------------------------------------------ idle is alive
	{
		// SAMPLE A RANGE, NOT TWO POINTS. The first version of this compared
		// t=0 and t=1.7, which is exactly half the breath period -- both are
		// zero crossings, so it reported a frozen Dog for a Dog that was
		// breathing perfectly well. Two samples cannot tell a still signal
		// from a periodic one caught at the wrong instants.
		float BMin = 1e9f, BMax = -1e9f;
		for (int i = 0; i <= 2000; ++i)
		{
			const float V = IdleSway(i * 0.01f, LegLength).Breath;
			BMin = std::fmin(BMin, V); BMax = std::fmax(BMax, V);
		}
		Check((BMax - BMin) > 1e-3f,
		      "a standing Dog breathes rather than freezing (span "
		      + std::to_string(BMax - BMin) + " uu)");
		float MaxBreath = 0.0f;
		for (int i = 0; i <= 4000; ++i)
		{
			MaxBreath = std::fmax(MaxBreath,
			                      std::fabs(IdleSway(i * 0.01f, LegLength).Breath));
		}
		Check(MaxBreath < 0.05f * LegLength,
		      "...and the breath stays ambient life, never a signal");
	}

	// ------------------------------------------------------------- the roster
	{
		Check(!RoleStandsUpright(EUprightRole::None),
		      "the canonical spawn Dog stays quadruped");
		Check(RoleStandsUpright(EUprightRole::Hero)
		      && RoleStandsUpright(EUprightRole::Working)
		      && RoleStandsUpright(EUprightRole::Ceremonial)
		      && RoleStandsUpright(EUprightRole::SpecialSkin),
		      "hero, working, ceremonial and special-skin Dogs stand");
		Check(std::string(RoleName(EUprightRole::Ceremonial)) == "ceremonial",
		      "every role names itself for the proof line");
	}

	std::printf("\npassed %d, failed %d\n", Passed, Failed);
	return Failed == 0 ? 0 : 1;
}

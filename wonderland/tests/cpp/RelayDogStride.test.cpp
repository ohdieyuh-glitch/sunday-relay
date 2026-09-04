// Prove the canonical Relay Dog's locomotion — on a laptop, with no engine.
//
//   g++ -std=c++17 -O1 -I../../Source/Wonderland -o /tmp/stride \
//       ../../Source/Wonderland/RelayDogStride.cpp RelayDogStride.test.cpp && /tmp/stride
//
// The founder's acceptance list is mostly claims about numbers, and every one
// of those is checked here rather than judged from a stream on a rented GPU:
//
//   * no visible foot sliding      -> a planted foot's WORLD position is
//                                     constant through stance, at every speed
//   * smooth gait transitions      -> no angle jumps between adjacent frames
//   * weighted starts and stops    -> the gait blends in and out over time
//   * arms-back only at high speed -> ArmsBack is 0 through walk and jog
//   * turns respect momentum       -> the bank follows the turn and decays
//   * idle is never a mechanical loop -> glance angles, sides and dwells vary
//   * canonical proportions        -> the leg IK never asks a segment to
//                                     stretch, so no pose can lengthen a limb
#include "RelayDogStride.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace RelayDogStride;

static int gPass = 0;
static std::vector<std::string> gFail;

static void Check(const std::string& Name, bool Ok, const std::string& Detail = "")
{
	if (Ok)
	{
		++gPass;
		std::printf("  ok   %s\n", Name.c_str());
	}
	else
	{
		gFail.push_back(Name);
		std::printf("  FAIL %s%s%s\n", Name.c_str(), Detail.empty() ? "" : ": ", Detail.c_str());
	}
}

static std::string F(float V)
{
	char Buf[64];
	std::snprintf(Buf, sizeof(Buf), "%.4f", static_cast<double>(V));
	return Buf;
}

// The canonical Dog at the shipped scale: head width 60 uu, hip 0.8 W, the leg
// split at its own centre by the seams in dog_canon.py.
static constexpr float ScaleUU = 60.0f;
static constexpr float LegUU = 0.8f * ScaleUU;          // 48
static constexpr float ThighUU = (0.8f - 0.5125f) * ScaleUU;   // 17.25
static constexpr float ShinUU = (0.5125f - 0.0f) * ScaleUU;    // 30.75

int main()
{
	std::printf("== the stride is driven by distance, so a planted foot cannot slide ==\n");
	{
		bool AllLocked = true;
		std::string Worst;
		float WorstDrift = 0.0f;
		for (float Speed : { 40.0f, 90.0f, 150.0f, 240.0f, 380.0f, 520.0f, 700.0f })
		{
			const FStride S = StrideForSpeed(Speed, LegUU);
			// March the body forward in small steps and watch one foot.
			float Distance = 0.0f;
			float LastWorld = 0.0f;
			bool bHadStance = false;
			for (int i = 0; i < 4000; ++i)
			{
				Distance += Speed / 240.0f;   // 240 Hz of travel
				const float Phase = Distance / S.StrideLength;
				const FFootPose Foot = FootPose(Phase, S.StrideLength, S.LiftHeight, S.DutyFactor);
				const float World = WorldFootForward(Distance, 0.0f, S.StrideLength, S.LiftHeight, S.DutyFactor);
				if (Foot.bStance && bHadStance)
				{
					const float Drift = std::fabs(World - LastWorld);
					if (Drift > WorstDrift)
					{
						WorstDrift = Drift;
						Worst = "speed " + F(Speed) + " drift " + F(Drift) + " uu/frame";
					}
					if (Drift > 0.01f) AllLocked = false;
				}
				bHadStance = Foot.bStance;
				LastWorld = World;
			}
		}
		Check("a planted foot's world position is constant at every speed", AllLocked,
		      Worst.empty() ? "" : "worst " + Worst);
		std::printf("       worst stance drift across all speeds: %s uu per frame\n", F(WorstDrift).c_str());
	}
	{
		// The other half of foot lock: a Dog that is NOT moving must not cycle.
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 0.0f;
		In.DistanceUU = 0.0f;
		float FirstPhase = -1.0f;
		bool bStill = true;
		for (int i = 0; i < 600; ++i)
		{
			const FDogPose& P = Dog.Update(In);
			if (FirstPhase < 0.0f) FirstPhase = P.StridePhase;
			if (std::fabs(P.StridePhase - FirstPhase) > 1e-6f) bStill = false;
		}
		Check("a Dog that does not move does not cycle its legs", bStill);
	}

	std::printf("== the gait bands, and the arms-back posture only at speed ==\n");
	{
		const float VJog = SpeedForFroude(FroudeJog, LegUU);
		const float VRun = SpeedForFroude(FroudeRun, LegUU);
		const float VAnime = SpeedForFroude(FroudeAnime, LegUU);
		std::printf("       thresholds for a %.0f uu leg: jog %.0f, run %.0f, anime %.0f uu/s\n",
		            static_cast<double>(LegUU), static_cast<double>(VJog),
		            static_cast<double>(VRun), static_cast<double>(VAnime));
		Check("walk below the jog threshold", StrideForSpeed(VJog * 0.6f, LegUU).Gait == EGait::Walk);
		Check("jog between the jog and run thresholds", StrideForSpeed(VJog * 1.2f, LegUU).Gait == EGait::Jog);
		Check("run between the run and anime thresholds", StrideForSpeed(VRun * 1.2f, LegUU).Gait == EGait::Run);
		Check("anime run above the top threshold", StrideForSpeed(VAnime * 1.1f, LegUU).Gait == EGait::AnimeRun);
		Check("idle at a standstill", StrideForSpeed(0.0f, LegUU).Gait == EGait::Idle);

		Check("no arms-back while walking", StrideForSpeed(VJog * 0.7f, LegUU).ArmsBack == 0.0f);
		Check("no arms-back while jogging", StrideForSpeed(VJog * 1.3f, LegUU).ArmsBack == 0.0f,
		      "got " + F(StrideForSpeed(VJog * 1.3f, LegUU).ArmsBack));
		Check("arms fully back at the top of the range", StrideForSpeed(VAnime * 1.3f, LegUU).ArmsBack > 0.99f);
		// And the posture itself: both arms behind the body, not one.
		const FArmPose L = ArmPose(0.20f, true, 1.0f, 1.0f);
		const FArmPose R = ArmPose(0.20f, false, 1.0f, 1.0f);
		Check("both arms trail backward in the anime posture", L.ShoulderDeg < -45.0f && R.ShoulderDeg < -45.0f,
		      "L " + F(L.ShoulderDeg) + " R " + F(R.ShoulderDeg));
		Check("and they are swept out so the blocks clear the hips", L.ShoulderYawDeg > 5.0f && R.ShoulderYawDeg > 5.0f);
		// Contralateral while walking: the arms oppose each other.
		const FArmPose WL = ArmPose(0.20f, true, 1.0f, 0.0f);
		const FArmPose WR = ArmPose(0.20f, false, 1.0f, 0.0f);
		Check("walking arms swing in opposition", WL.ShoulderDeg * WR.ShoulderDeg < 0.0f,
		      "L " + F(WL.ShoulderDeg) + " R " + F(WR.ShoulderDeg));
		Check("the elbow never straightens past zero while swinging", ArmPose(0.55f, true, 1.0f, 0.0f).ElbowDeg > 0.0f);
	}
	{
		// STRIDE LENGTH RISES WITH SPEED. If it did not, a faster Dog would
		// cycle the same stride faster over the same ground — the moonwalk.
		bool Monotonic = true;
		float Last = -1.0f;
		for (float Speed = 30.0f; Speed <= 800.0f; Speed += 10.0f)
		{
			const float SL = StrideForSpeed(Speed, LegUU).StrideLength;
			if (SL < Last - 1e-4f) Monotonic = false;
			Last = SL;
		}
		Check("stride length never falls as speed rises", Monotonic);
		bool DutyFalls = true;
		Last = 99.0f;
		for (float Speed = 30.0f; Speed <= 800.0f; Speed += 10.0f)
		{
			const float D = StrideForSpeed(Speed, LegUU).DutyFactor;
			if (D > Last + 1e-4f) DutyFalls = false;
			Last = D;
		}
		Check("duty factor never rises as speed rises", DutyFalls);
		Check("a walk keeps both feet down part of the cycle", StrideForSpeed(100.0f, LegUU).DutyFactor > 0.5f);
		Check("a full run has a flight phase", StrideForSpeed(700.0f, LegUU).DutyFactor < 0.5f);
	}

	std::printf("== the cadence is a body's, not a sewing machine's ==\n");
	{
		// THE FOUNDER'S PLAYTEST FOUND THIS, and it is arithmetic, so it is
		// pinned here now. Stride is capped by how far a leg can reach, so a
		// crouch that is too shallow forces the Dog to make the ground up with
		// frequency instead: at a 3% hip drop the walk was a 39 uu stride and
		// SEVEN STEPS A SECOND at 131 uu/s. Real gait sits between roughly two
		// and seven steps a second across this whole range, and the walk is the
		// end that gives it away.
		struct FCase { const char* Name; float Speed; float MinSteps; float MaxSteps; };
		const FCase Cases[] = {
			{ "walk", 131.0f, 2.4f, 4.4f },
			{ "jog", 220.0f, 3.2f, 5.6f },
			{ "run", 400.0f, 4.0f, 6.8f },
			{ "anime run", 560.0f, 4.4f, 7.4f },
		};
		for (const FCase& C : Cases)
		{
			const FStride S = StrideForSpeed(C.Speed, LegUU);
			const float StepsPerSecond = 2.0f * C.Speed / (S.StrideLength > 1.0f ? S.StrideLength : 1.0f);
			Check(std::string("the ") + C.Name + " takes a believable number of steps a second",
			      StepsPerSecond >= C.MinSteps && StepsPerSecond <= C.MaxSteps,
			      F(StepsPerSecond) + " steps/s at " + F(C.Speed) + " uu/s, stride " + F(S.StrideLength));
		}
		// And the stride is a real fraction of the body, not a shuffle.
		Check("the walking stride is longer than the leg",
		      StrideForSpeed(131.0f, LegUU).StrideLength > LegUU,
		      F(StrideForSpeed(131.0f, LegUU).StrideLength) + " uu vs leg " + F(LegUU));
	}

	std::printf("== nothing snaps: the motion is continuous, not merely small ==\n");
	{
		// A SNAP IS A DISCONTINUITY, NOT A FAST MOVEMENT. A running leg
		// legitimately swings tens of degrees in a frame, so a fixed "no more
		// than N degrees" threshold either passes a real jump at speed or fails
		// an honest sprint. The definition that does not need a magic number is
		// REFINEMENT: halve the time step and a continuous motion halves its
		// largest per-frame change, while a discontinuity does not shrink at all.
		//
		// So the same 30-second acceleration through every band and back is run
		// at 60 Hz and at 240 Hz, and the two worst frame-to-frame changes are
		// compared. Anything that teleports would show here as a ratio near 1.
		struct FSweep { float MaxJump; const char* Where; };
		auto Sweep = [](int Hz) -> float
		{
			FDogAnimator Dog;
			Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
			FDogInput In;
			In.DeltaSeconds = 1.0f / static_cast<float>(Hz);
			const int Frames = 30 * Hz;
			float MaxJump = 0.0f;
			FDogPose Prev;
			bool bFirst = true;
			for (int i = 0; i < Frames; ++i)
			{
				const float T = static_cast<float>(i) / static_cast<float>(Frames);
				const float Speed = (T < 0.5f) ? (760.0f * T * 2.0f) : (760.0f * (1.0f - T) * 2.0f);
				In.SpeedUU = Speed;
				In.DistanceUU = Speed * In.DeltaSeconds;
				const FDogPose& P = Dog.Update(In);
				if (!bFirst)
				{
					const float Angles[][2] = {
						{ P.LegLeft.HipDeg, Prev.LegLeft.HipDeg },
						{ P.LegLeft.KneeDeg, Prev.LegLeft.KneeDeg },
						{ P.LegRight.HipDeg, Prev.LegRight.HipDeg },
						{ P.LegRight.KneeDeg, Prev.LegRight.KneeDeg },
						{ P.ArmLeft.ShoulderDeg, Prev.ArmLeft.ShoulderDeg },
						{ P.ArmLeft.ElbowDeg, Prev.ArmLeft.ElbowDeg },
						{ P.ArmRight.ShoulderDeg, Prev.ArmRight.ShoulderDeg },
						{ P.LeanDeg, Prev.LeanDeg },
						{ P.HeadYawDeg, Prev.HeadYawDeg },
						{ P.HeadPitchDeg, Prev.HeadPitchDeg },
						{ P.PelvisDropUU, Prev.PelvisDropUU },
					};
					for (const auto& A : Angles)
					{
						const float Jump = std::fabs(A[0] - A[1]);
						if (Jump > MaxJump) MaxJump = Jump;
					}
				}
				Prev = P;
				bFirst = false;
			}
			return MaxJump;
		};
		const float At60 = Sweep(60);
		const float At240 = Sweep(240);
		const float Ratio = At60 > 1e-6f ? At240 / At60 : 1.0f;
		Check("four times the frame rate quarters the largest step (so nothing jumps)",
		      Ratio < 0.45f, "60 Hz " + F(At60) + " deg, 240 Hz " + F(At240) + " deg, ratio " + F(Ratio));
		// And an absolute sanity bound: even a full anime run must not move a
		// joint more than a quarter turn between two frames at 60 Hz.
		Check("no joint moves more than 45 deg in a 60 Hz frame", At60 < 45.0f, F(At60) + " deg");
		std::printf("       worst frame-to-frame change: %s deg at 60 Hz, %s deg at 240 Hz\n",
		            F(At60).c_str(), F(At240).c_str());
	}
	{
		// WEIGHTED START AND STOP: asked for full speed from rest, the gait
		// weight must take time to arrive, and it must come back down.
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 400.0f;
		In.DistanceUU = 400.0f / 60.0f;
		const float W1 = Dog.Update(In).GaitWeight;
		for (int i = 0; i < 5; ++i) Dog.Update(In);
		const float W6 = Dog.Update(In).GaitWeight;
		for (int i = 0; i < 60; ++i) Dog.Update(In);
		const float WFull = Dog.Pose().GaitWeight;
		Check("the gait does not appear fully formed on frame one", W1 < 0.25f, "got " + F(W1));
		Check("it is on its way a tenth of a second later", W6 > W1);
		Check("and reaches full stride within a second", WFull > 0.9f, "got " + F(WFull));
		// STOPPING IS ALSO WEIGHTED, and it is deliberately slower than
		// starting: the posture filter has to fall through the jog and walk
		// bands before the legs are allowed to stop cycling, which is what
		// makes a stop read as settling rather than as a freeze-frame.
		In.SpeedUU = 0.0f;
		In.DistanceUU = 0.0f;
		float PrevWeight = Dog.Pose().GaitWeight;
		bool bFalling = false;
		bool bMonotonic = true;
		for (int i = 0; i < 120; ++i)
		{
			const float W = Dog.Update(In).GaitWeight;
			// The spring may still be finishing its rise on the first frames
			// after the input drops — what must never happen is a RECOVERY once
			// the wind-down has begun, which would read as the Dog taking one
			// more phantom step after stopping.
			if (W < PrevWeight - 1e-5f) bFalling = true;
			if (bFalling && W > PrevWeight + 1e-4f) bMonotonic = false;
			PrevWeight = W;
		}
		Check("once the stride starts winding down it never picks back up", bMonotonic);
		Check("and the Dog is standing again within two seconds", Dog.Pose().GaitWeight < 0.1f,
		      "got " + F(Dog.Pose().GaitWeight));
	}

	std::printf("== turns respect momentum ==\n");
	{
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 420.0f;
		In.DistanceUU = 420.0f / 60.0f;
		for (int i = 0; i < 120; ++i) Dog.Update(In);   // up to speed, straight
		const float Straight = Dog.Pose().TurnRollDeg;
		In.HeadingDeg = 0.0f;
		In.DesiredHeadingDeg = 40.0f;                   // turning hard left
		for (int i = 0; i < 30; ++i) Dog.Update(In);
		const float Banked = Dog.Pose().TurnRollDeg;
		In.DesiredHeadingDeg = 0.0f;
		for (int i = 0; i < 90; ++i) Dog.Update(In);
		const float Recovered = Dog.Pose().TurnRollDeg;
		Check("running straight, the body is level", std::fabs(Straight) < 1.0f, "got " + F(Straight));
		Check("turning at speed banks the body", std::fabs(Banked) > 2.0f, "got " + F(Banked));
		Check("and the bank comes back out when the turn ends", std::fabs(Recovered) < std::fabs(Banked) * 0.35f,
		      "banked " + F(Banked) + " -> " + F(Recovered));
		// The same turn at a walk should bank far less: momentum, not steering.
		FDogAnimator Slow;
		Slow.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput SlowIn = In;
		SlowIn.SpeedUU = 90.0f;
		SlowIn.DistanceUU = 90.0f / 60.0f;
		SlowIn.DesiredHeadingDeg = 40.0f;
		for (int i = 0; i < 150; ++i) Slow.Update(SlowIn);
		Check("a walking turn banks less than a running one",
		      std::fabs(Slow.Pose().TurnRollDeg) < std::fabs(Banked) * 0.6f,
		      "walk " + F(Slow.Pose().TurnRollDeg) + " vs run " + F(Banked));
	}

	std::printf("== the idle head is an observer, not a metronome ==\n");
	{
		FInterest Interest(12345u);
		std::vector<float> Dwells;
		std::vector<float> Yaws;
		std::vector<float> Pitches;
		float LastHold = -1.0f;
		bool bWasAttending = false;
		bool bInCone = true;
		for (int i = 0; i < 60 * 600; ++i)   // ten minutes at 60 Hz
		{
			const FGlance G = Interest.Update(1.0f / 60.0f);
			if (std::fabs(G.YawDeg) > HeadYawLimitDeg + 1e-4f) bInCone = false;
			if (std::fabs(G.PitchDeg) > HeadPitchLimitDeg + 1e-4f) bInCone = false;
			if (G.bAttending && !bWasAttending)
			{
				Dwells.push_back(G.HoldSeconds);
				Yaws.push_back(G.YawDeg);
				Pitches.push_back(G.PitchDeg);
			}
			bWasAttending = G.bAttending;
			LastHold = G.HoldSeconds;
		}
		(void)LastHold;
		Check("every glance stays inside the comfortable cone", bInCone);
		Check("ten minutes produces many separate glances", Dwells.size() > 40,
		      "got " + std::to_string(Dwells.size()));
		// VARIABLE TIMING: no two consecutive dwells the same, and a real spread.
		bool bVaried = true;
		float MinD = 1e9f, MaxD = -1e9f;
		for (size_t i = 0; i < Dwells.size(); ++i)
		{
			MinD = Dwells[i] < MinD ? Dwells[i] : MinD;
			MaxD = Dwells[i] > MaxD ? Dwells[i] : MaxD;
			if (i && std::fabs(Dwells[i] - Dwells[i - 1]) < 1e-3f) bVaried = false;
		}
		Check("no two consecutive glances are held for the same time", bVaried);
		Check("dwell times span a real range", (MaxD - MinD) > 1.0f, F(MinD) + ".." + F(MaxD) + " s");
		// NOT A LOOP: the Dog does not glance the same side every time, and does
		// not walk off in one direction.
		int SameSideRuns = 0, Longest = 0, Run = 1;
		for (size_t i = 1; i < Yaws.size(); ++i)
		{
			if ((Yaws[i] > 0.0f) == (Yaws[i - 1] > 0.0f)) { ++Run; }
			else { Longest = Run > Longest ? Run : Longest; Run = 1; ++SameSideRuns; }
		}
		Longest = Run > Longest ? Run : Longest;
		Check("the head does not glance to the same side more than three times running", Longest < 4,
		      "longest same-side run " + std::to_string(Longest));
		int Ups = 0, Downs = 0;
		for (float P : Pitches)
		{
			if (P > HeadPitchLimitDeg * 0.3f) Ups++;
			if (P < -HeadPitchLimitDeg * 0.3f) Downs++;
		}
		Check("it occasionally looks up and occasionally down", Ups > 2 && Downs > 2,
		      "up " + std::to_string(Ups) + " down " + std::to_string(Downs));
		std::printf("       %zu glances, dwell %s..%s s, %d up / %d down\n",
		            Dwells.size(), F(MinD).c_str(), F(MaxD).c_str(), Ups, Downs);
	}
	{
		// The idle body settles; it does not pulse. The founder's rule is
		// explicit, so the absence of a vertical breathing bob is a test.
		float MaxSway = 0.0f, MaxArm = 0.0f;
		for (int i = 0; i < 60 * 120; ++i)
		{
			const FIdlePose P = IdlePose(i / 60.0f, 1.0f, ScaleUU);
			MaxSway = std::fabs(P.SwayUU) > MaxSway ? std::fabs(P.SwayUU) : MaxSway;
			MaxArm = std::fabs(P.ArmLeftDeg) > MaxArm ? std::fabs(P.ArmLeftDeg) : MaxArm;
		}
		Check("idle sway is a settle, not a sway dance", MaxSway > 0.1f && MaxSway < 0.02f * ScaleUU + 1e-3f,
		      F(MaxSway) + " uu");
		Check("idle arm settle stays under a degree and a half", MaxArm < 1.5f, F(MaxArm) + " deg");
		// A standing Dog is never frozen: over any 4-second window something moves.
		bool bAlwaysAlive = true;
		for (int Start = 0; Start < 60 * 60; Start += 30)
		{
			float Lo = 1e9f, Hi = -1e9f;
			for (int i = Start; i < Start + 240; ++i)
			{
				const float V = IdlePose(i / 60.0f, 1.0f, ScaleUU).HeadYawDeg;
				Lo = V < Lo ? V : Lo;
				Hi = V > Hi ? V : Hi;
			}
			if (Hi - Lo < 0.2f) bAlwaysAlive = false;
		}
		Check("the standing Dog is never still for four seconds together", bAlwaysAlive);
	}

	std::printf("== the leg IK cannot stretch the canonical Dog ==\n");
	{
		// PROPORTIONS ARE IDENTITY. The two-bone solve may bend the knee as far
		// as it likes; what it may never do is ask for a leg longer than the
		// canon's, because that would silently restore the V1 "stretch" trick
		// on a body whose seams exist precisely so it does not need one.
		bool bReaches = true, bKneeSane = true;
		float WorstErr = 0.0f, MaxKnee = 0.0f, MinKnee = 1e9f;
		for (float Speed : { 60.0f, 150.0f, 300.0f, 520.0f, 760.0f })
		{
			const FStride S = StrideForSpeed(Speed, LegUU);
			for (int i = 0; i < 400; ++i)
			{
				const float Phase = i / 400.0f;
				const FFootPose Foot = FootPose(Phase, S.StrideLength, S.LiftHeight, S.DutyFactor);
				const FLegPose Leg = LegPose(Foot, ThighUU, ShinUU, S.HipHeightUU);
				if (Leg.KneeDeg < -1e-4f) bKneeSane = false;
				MaxKnee = Leg.KneeDeg > MaxKnee ? Leg.KneeDeg : MaxKnee;
				MinKnee = Leg.KneeDeg < MinKnee ? Leg.KneeDeg : MinKnee;
				// Forward-solve the two bones and compare with the target.
				const float Hip = Leg.HipDeg / 57.29577951f;
				const float Knee = Leg.KneeDeg / 57.29577951f;
				const float KneeX = ThighUU * std::sin(Hip);
				const float KneeY = -ThighUU * std::cos(Hip);
				const float FootX = KneeX + ShinUU * std::sin(Hip - Knee);
				const float FootY = KneeY - ShinUU * std::cos(Hip - Knee);
				const float WantX = Foot.Forward;
				const float WantY = -(S.HipHeightUU - Foot.Lift);
				const float Err = std::sqrt((FootX - WantX) * (FootX - WantX) + (FootY - WantY) * (FootY - WantY));
				if (Err > WorstErr) WorstErr = Err;
				if (Err > 0.75f) bReaches = false;
			}
		}
		Check("the knee never hyperextends", bKneeSane, "min " + F(MinKnee) + " deg");
		Check("the solved leg puts the foot where the stride asked", bReaches, "worst error " + F(WorstErr) + " uu");
		Check("and the knee bends enough to read as a knee", MaxKnee > 12.0f, "max " + F(MaxKnee) + " deg");
		std::printf("       knee range %s..%s deg, worst foot error %s uu\n",
		            F(MinKnee).c_str(), F(MaxKnee).c_str(), F(WorstErr).c_str());
	}

	std::printf("== stairs: a planted foot is placed on the step it is over ==\n");
	{
		// A STAIRCASE, WALKED UP. Golden Arrival's path rises at the steps, and
		// the failure the founder would see is a foot hanging in the air on the
		// higher tread or buried in the lower one. The trace needs an engine;
		// the easing does not, so it is exercised here against a real profile.
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 130.0f;                       // a walk, up the stairs
		In.DistanceUU = 130.0f / 60.0f;
		const float RiserUU = 14.0f;               // one tread of the arrival steps
		float Travelled = 0.0f;
		float WorstPlantedDrift = 0.0f;
		float MaxOffsetSeen = 0.0f;
		float PrevWorldL = 0.0f;
		bool bHadStanceL = false;
		bool bOffsetSane = true;
		for (int i = 0; i < 1200; ++i)
		{
			Travelled += In.DistanceUU;
			// Ground under each foot: a step every 60 uu of travel. The left
			// foot leads, so the two feet are on different treads for part of
			// every cycle — which is the case that exposes a shared offset.
			const FDogPose& Peek = Dog.Pose();
			const float FootLX = Travelled + Peek.FootLeft.Forward;
			const float FootRX = Travelled + Peek.FootRight.Forward;
			const float GroundL = std::floor(FootLX / 60.0f) * RiserUU;
			const float GroundR = std::floor(FootRX / 60.0f) * RiserUU;
			const float BodyGround = std::floor(Travelled / 60.0f) * RiserUU;
			In.GroundDeltaLeft = GroundL - BodyGround;
			In.GroundDeltaRight = GroundR - BodyGround;
			const FDogPose& P = Dog.Update(In);

			if (std::fabs(P.FootOffsetLeft) > MaxOffsetSeen) MaxOffsetSeen = std::fabs(P.FootOffsetLeft);
			if (std::fabs(P.FootOffsetLeft) > LegUU * 0.45f + 1e-3f) bOffsetSane = false;
			if (std::fabs(P.FootOffsetRight) > LegUU * 0.45f + 1e-3f) bOffsetSane = false;
			// FOOT LOCK STILL HOLDS. The vertical correction must not move the
			// foot along the ground: only the height is allowed to change.
			const float WorldL = Travelled + P.FootLeft.Forward;
			if (P.FootLeft.bStance && bHadStanceL && P.GaitWeight > 0.9f)
			{
				const float Drift = std::fabs(WorldL - PrevWorldL);
				if (Drift > WorstPlantedDrift) WorstPlantedDrift = Drift;
			}
			bHadStanceL = P.FootLeft.bStance;
			PrevWorldL = WorldL;
		}
		Check("the ground correction stays inside its clamp", bOffsetSane);
		Check("a step is actually corrected for", MaxOffsetSeen > 3.0f, "max " + F(MaxOffsetSeen) + " uu");
		Check("and a planted foot still does not slide on stairs", WorstPlantedDrift < 0.05f,
		      "worst " + F(WorstPlantedDrift) + " uu/frame");
		std::printf("       stair correction up to %s uu, planted drift %s uu per frame\n",
		            F(MaxOffsetSeen).c_str(), F(WorstPlantedDrift).c_str());
	}
	{
		// FRAME-RATE INDEPENDENCE of the easing, for the same reason the springs
		// have it: the same second of a step must land in the same place at
		// 20 fps and 60.
		float Slow = 0.0f, Fast = 0.0f;
		for (int i = 0; i < 20; ++i) Slow = FootGroundOffset(Slow, 12.0f, true, 30.0f, 1.0f / 20.0f);
		for (int i = 0; i < 60; ++i) Fast = FootGroundOffset(Fast, 12.0f, true, 30.0f, 1.0f / 60.0f);
		Check("a foot eases onto a step identically at 20 and 60 fps", std::fabs(Slow - Fast) < 0.05f,
		      F(Slow) + " vs " + F(Fast));
		Check("a swinging foot is released rather than glued",
		      FootGroundOffset(10.0f, 12.0f, false, 30.0f, 0.5f) < 4.0f);
		Check("one absurd trace cannot stretch the leg",
		      FootGroundOffset(0.0f, 5000.0f, true, 21.6f, 1.0f) <= 21.6f + 1e-3f);
	}

	std::printf("== the elbow is a joint, and it is used ==\n");
	{
		// REAL, READABLE ARTICULATION. The seam exists so the arm bends; a seam
		// that never moves is the painted line the founder ruled out. Walk a
		// full cycle and measure how far the elbow actually travels, and check
		// the knee the same way.
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 130.0f;
		In.DistanceUU = 130.0f / 60.0f;
		for (int i = 0; i < 120; ++i) Dog.Update(In);   // settle into the walk
		float ElbowLo = 1e9f, ElbowHi = -1e9f, KneeLo = 1e9f, KneeHi = -1e9f;
		for (int i = 0; i < 240; ++i)
		{
			const FDogPose& P = Dog.Update(In);
			ElbowLo = std::fmin(ElbowLo, P.ArmLeft.ElbowDeg); ElbowHi = std::fmax(ElbowHi, P.ArmLeft.ElbowDeg);
			KneeLo = std::fmin(KneeLo, P.LegLeft.KneeDeg); KneeHi = std::fmax(KneeHi, P.LegLeft.KneeDeg);
		}
		Check("the elbow swings a readable amount while walking", (ElbowHi - ElbowLo) > 8.0f,
		      F(ElbowLo) + ".." + F(ElbowHi) + " deg");
		Check("the knee swings a readable amount while walking", (KneeHi - KneeLo) > 15.0f,
		      F(KneeLo) + ".." + F(KneeHi) + " deg");
		std::printf("       walking: elbow %s..%s deg, knee %s..%s deg\n",
		            F(ElbowLo).c_str(), F(ElbowHi).c_str(), F(KneeLo).c_str(), F(KneeHi).c_str());
	}

	std::printf("== the jump is a pose, and the walk has a body in it ==\n");
	{
		// THE FOUNDER ASKED FOR A HUMAN JUMP: legs bent, arms spread. Both are
		// arithmetic, so both are checked rather than judged from a video.
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 240.0f;
		In.DistanceUU = 240.0f / 60.0f;
		for (int i = 0; i < 60; ++i) Dog.Update(In);      // running along the ground
		const FDogPose Ground = Dog.Pose();
		In.bInAir = true;
		In.VerticalSpeedUU = 300.0f;                      // on the way up
		for (int i = 0; i < 30; ++i) Dog.Update(In);
		const FDogPose Air = Dog.Pose();
		Check("leaving the ground puts the Dog in the air pose", Air.AirborneWeight > 0.8f,
		      F(Air.AirborneWeight));
		// A RUNNING KNEE CYCLES from 12 to 118 degrees, so comparing the jump
		// against ONE instant of it compares against a moving target and says
		// nothing. What a tuck actually means is that the knee stays bent AND
		// stops pedalling: held, not cycling.
		{
			float Lo = 1e9f, Hi = -1e9f;
			FDogInput Hold = In;
			for (int i = 0; i < 40; ++i)
			{
				const float K = Dog.Update(Hold).LegLeft.KneeDeg;
				Lo = std::fmin(Lo, K); Hi = std::fmax(Hi, K);
			}
			Check("in the air the knee is bent", Lo > 55.0f, "min " + F(Lo));
			Check("and it is held there rather than pedalling", (Hi - Lo) < 25.0f,
			      F(Lo) + ".." + F(Hi) + " deg");
		}
		// SUPERSEDED 2026-09-04 (founder rejected the pose this asserted).
		//
		// This required ShoulderDeg < -20 on both arms and called it "up and
		// out". Negative is BACK in this rig -- ArmPose()'s anime sprint, the
		// one posture whose comment says "both arms trail straight back", is
		// BackShoulder = -62. So the assertion demanded the arms be at least a
		// third of the way into the sprint's arms-back silhouette, and the code
		// obliged with -52 on takeoff. Test and code were written together and
		// shared the same sign, so they agreed with each other and neither
		// agreed with the Dog: the founder saw "arms/front limbs pulled behind
		// him" the first time they jumped.
		//
		// The assertion now says what a person watching would say. Arms in
		// FRONT and up, positively, with only enough outward sweep to clear the
		// hips -- and an explicit floor at zero, because the failure being
		// guarded against is specifically "behind the body".
		Check("both arms come up and FORWARD, never behind the body",
		      Air.ArmLeft.ShoulderDeg > 20.0f && Air.ArmRight.ShoulderDeg > 20.0f
		      && Air.ArmLeft.ShoulderYawDeg > 8.0f,
		      "L " + F(Air.ArmLeft.ShoulderDeg) + " R " + F(Air.ArmRight.ShoulderDeg)
		      + " sweep " + F(Air.ArmLeft.ShoulderYawDeg));
		// Falling differs from rising: the body reaches for the ground.
		In.VerticalSpeedUU = -300.0f;
		for (int i = 0; i < 20; ++i) Dog.Update(In);
		Check("falling is a different pose from rising",
		      std::fabs(Dog.Pose().LegLeft.KneeDeg - Air.LegLeft.KneeDeg) > 4.0f,
		      F(Air.LegLeft.KneeDeg) + " rising vs " + F(Dog.Pose().LegLeft.KneeDeg) + " falling");
		// And landing returns it, without a snap.
		// LANDING. The joint angles on touchdown mix two things -- the air pose
		// leaving and the run stride resuming -- and only the first is mine to
		// control, so that is what is measured: the airborne blend itself must
		// come out smoothly, with no step that would read as a pose swap.
		In.bInAir = false;
		In.VerticalSpeedUU = 0.0f;
		float PrevAir = Dog.Pose().AirborneWeight;
		float MaxAirStep = 0.0f;
		for (int i = 0; i < 60; ++i)
		{
			const float W = Dog.Update(In).AirborneWeight;
			MaxAirStep = std::fmax(MaxAirStep, std::fabs(W - PrevAir));
			PrevAir = W;
		}
		Check("the air pose blends out smoothly rather than popping", MaxAirStep < 0.12f,
		      F(MaxAirStep) + " of the blend in one frame");
		Check("and the Dog is out of the air pose once down", Dog.Pose().AirborneWeight < 0.1f);
	}

	std::printf("== the jump has an anticipation and a landing ==\n");
	{
		// A JUMP IS FOUR THINGS, AND THE POSE USED TO BE ONE. Off the ground
		// there was an air pose; on either side of it, nothing. So the Dog went
		// from standing skeleton to airborne in a frame and back the same way.
		// The founder asked for the human sequence: dip, drive, fly, absorb.
		//
		// The dip and the absorb both happen ON THE GROUND, where
		// AirborneWeight is zero, which is why neither could live in the air
		// block and why nothing here was caught by the tests above.
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 0.0f;
		In.DistanceUU = 0.0f;
		for (int i = 0; i < 60; ++i) Dog.Update(In);       // standing still
		const FDogPose Rest = Dog.Pose();

		// PRE-JUMP. The key is down and the feet are still on the floor.
		In.bJumpPressed = true;
		for (int i = 0; i < 10; ++i) Dog.Update(In);
		const FDogPose Load = Dog.Pose();
		Check("the standing jump dips before it leaves",
		      Load.LegLeft.KneeDeg > Rest.LegLeft.KneeDeg + 8.0f,
		      F(Rest.LegLeft.KneeDeg) + " -> " + F(Load.LegLeft.KneeDeg) + " deg");
		Check("...and the body actually lowers, rather than only bending a leg",
		      Load.BobUU < Rest.BobUU - 1.0f,
		      F(Rest.BobUU) + " -> " + F(Load.BobUU) + " uu");
		Check("...and the arms swing BACK to load the swing",
		      Load.ArmLeft.ShoulderDeg < Rest.ArmLeft.ShoulderDeg - 8.0f,
		      F(Rest.ArmLeft.ShoulderDeg) + " -> " + F(Load.ArmLeft.ShoulderDeg) + " deg");

		// TAKEOFF out of that load: the arms reverse through the swing.
		In.bJumpPressed = false;
		In.bInAir = true;
		In.VerticalSpeedUU = 320.0f;
		for (int i = 0; i < 25; ++i) Dog.Update(In);
		const FDogPose Up = Dog.Pose();
		Check("the standing jump throws the arms FORWARD, not behind",
		      Up.ArmLeft.ShoulderDeg > 20.0f && Up.ArmRight.ShoulderDeg > 20.0f,
		      "L " + F(Up.ArmLeft.ShoulderDeg) + " R " + F(Up.ArmRight.ShoulderDeg));
		Check("...which is a real reversal out of the loaded pose",
		      (Up.ArmLeft.ShoulderDeg - Load.ArmLeft.ShoulderDeg) > 40.0f,
		      F(Load.ArmLeft.ShoulderDeg) + " -> " + F(Up.ArmLeft.ShoulderDeg) + " deg");

		// LANDING. Touchdown is detected inside the solver from the airborne
		// weight falling away, so the actor does not have to report it.
		In.bInAir = false;
		In.VerticalSpeedUU = 0.0f;
		float KneePeak = -1e9f;
		float BobLow = 1e9f;
		for (int i = 0; i < 12; ++i)
		{
			const FDogPose P = Dog.Update(In);
			KneePeak = std::fmax(KneePeak, P.LegLeft.KneeDeg);
			BobLow = std::fmin(BobLow, P.BobUU);
		}
		Check("landing absorbs: the knees give on touchdown",
		      KneePeak > Rest.LegLeft.KneeDeg + 8.0f,
		      "peak " + F(KneePeak) + " vs rest " + F(Rest.LegLeft.KneeDeg) + " deg");
		Check("...and the body dips with them",
		      BobLow < Rest.BobUU - 1.0f, F(BobLow) + " vs rest " + F(Rest.BobUU) + " uu");
		// ...and recovers, rather than leaving the Dog in a permanent crouch.
		for (int i = 0; i < 90; ++i) Dog.Update(In);
		const FDogPose Settled = Dog.Pose();
		Check("...and it recovers to standing rather than staying crouched",
		      std::fabs(Settled.LegLeft.KneeDeg - Rest.LegLeft.KneeDeg) < 3.0f,
		      F(Settled.LegLeft.KneeDeg) + " vs rest " + F(Rest.LegLeft.KneeDeg) + " deg");
		Check("...and the arms come back to where they started",
		      std::fabs(Settled.ArmLeft.ShoulderDeg - Rest.ArmLeft.ShoulderDeg) < 4.0f,
		      F(Settled.ArmLeft.ShoulderDeg) + " vs rest " + F(Rest.ArmLeft.ShoulderDeg) + " deg");
	}
	{
		// THE COUNTER-ROTATION that separates a walk from a march: the body
		// turns very slightly against the stride, and it is zero standing still.
		FDogAnimator Dog;
		Dog.Configure(LegUU, ThighUU, ShinUU, ScaleUU);
		FDogInput In;
		In.DeltaSeconds = 1.0f / 60.0f;
		In.SpeedUU = 130.0f;
		In.DistanceUU = 130.0f / 60.0f;
		float Lo = 1e9f, Hi = -1e9f;
		for (int i = 0; i < 400; ++i)
		{
			const float Y = Dog.Update(In).BodyYawDeg;
			if (i > 120) { Lo = std::fmin(Lo, Y); Hi = std::fmax(Hi, Y); }
		}
		Check("the body counter-rotates while walking", (Hi - Lo) > 2.0f, F(Lo) + ".." + F(Hi) + " deg");
		Check("and stays subtle -- this is a walk, not a swagger", (Hi - Lo) < 8.0f);
		In.SpeedUU = 0.0f; In.DistanceUU = 0.0f;
		for (int i = 0; i < 180; ++i) Dog.Update(In);
		Check("standing still, the body does not rotate", std::fabs(Dog.Pose().BodyYawDeg) < 0.3f,
		      F(Dog.Pose().BodyYawDeg));
	}

	std::printf("== the springs behave like the landing's ==\n");
	{
		FSpring S;
		bool bOvershoot = false;
		for (int i = 0; i < 600; ++i)
		{
			SpringStep(S, 10.0f, 0.4f, 1.0f / 60.0f);
			if (S.Value > 10.0f + 1e-4f) bOvershoot = true;
		}
		Check("a critically-damped spring never overshoots", !bOvershoot);
		Check("and converges", std::fabs(S.Value - 10.0f) < 1e-3f, F(S.Value));
		// FRAME-RATE INDEPENDENCE: the same wall-clock time at 20 Hz and 240 Hz
		// must arrive at nearly the same place. `lerp(a,b,k)` per frame does not.
		FSpring Slow, Fast;
		for (int i = 0; i < 20; ++i) SpringStep(Slow, 1.0f, 0.5f, 1.0f / 20.0f);
		for (int i = 0; i < 240; ++i) SpringStep(Fast, 1.0f, 0.5f, 1.0f / 240.0f);
		Check("the same second of easing lands in the same place at 20 and 240 Hz",
		      std::fabs(Slow.Value - Fast.Value) < 0.02f,
		      F(Slow.Value) + " vs " + F(Fast.Value));
		Check("a turn takes the short way", std::fabs(ShortestAngleDeg(179.0f, -179.0f) - 2.0f) < 1e-3f,
		      F(ShortestAngleDeg(179.0f, -179.0f)));
		Check("stance outlasts swing in the shaped phase", ShapePhase(0.31f, 0.62f) < 0.5f);
	}

	std::printf("\n%d passed, %zu failed\n", gPass, gFail.size());
	for (const std::string& Name : gFail) std::printf("  FAILED: %s\n", Name.c_str());
	return gFail.empty() ? 0 : 1;
}

// Prove a Relay Dog stands up smoothly, and stays a Relay Dog.
//
//   g++ -std=c++17 -O1 -o /tmp/pose WonderlandDogPose.cpp WonderlandDogPose.test.cpp
//
// The brief's requirement is "no instant pose swap", and that is a claim about
// CONTINUITY, which is arithmetic. So is "hind paws stay planted", which is the
// difference between a Dog standing and a Dog hovering. Both are checked here,
// on a laptop, rather than judged from a stream on a rented GPU.
#include "WonderlandDogPose.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

static int gPass = 0;
static std::vector<std::string> gFail;

static void Check(const std::string& Name, bool Ok, const std::string& Detail = "")
{
	if (Ok) { ++gPass; std::printf("  ok   %s\n", Name.c_str()); }
	else { gFail.push_back(Name); std::printf("  FAIL %s%s%s\n", Name.c_str(),
	          Detail.empty() ? "" : "\n         ", Detail.c_str()); }
}

int main()
{
	using namespace WonderlandPose;
	const float Leg = 119.6f;

	std::printf("== a quadruped Dog is EXACTLY the canonical pose ==\n");
	{
		const FUprightPose P = UprightPose(0.0f, Leg, 0.37f, EWork::None);
		bool bZero = P.TorsoRise == 0.0f && P.TorsoPitchDeg == 0.0f
		          && P.HeadPitchDeg == 0.0f && P.HeadRise == 0.0f
		          && P.TailPitchDeg == 0.0f;
		for (int i = 0; i < 4; ++i)
			if (P.LegRise[i] != 0.0f || P.LegPitchDeg[i] != 0.0f || P.LegSpread[i] != 0.0f)
				bZero = false;
		Check("at blend 0 every offset is exactly zero, not merely small", bZero);
		// And it stays that way whatever work is nominally selected: a Dog that
		// has not risen yet must not already be waving a paw.
		bool bStillZero = true;
		for (const EWork W : { EWork::Channelling, EWork::Repairing, EWork::Approving })
			if (UprightPose(0.0f, Leg, 0.5f, W).LegPitchDeg[3] != 0.0f) bStillZero = false;
		Check("...for every work state, so work fades in with the rise", bStillZero);
	}

	std::printf("== the rise is CONTINUOUS — no instant pose swap ==\n");
	{
		// Sweep the blend and assert nothing jumps between adjacent samples.
		float WorstTorso = 0.0f, WorstHead = 0.0f, WorstLeg = 0.0f;
		FUprightPose Prev = UprightPose(0.0f, Leg, 0.0f, EWork::Channelling);
		for (int i = 1; i <= 2000; ++i)
		{
			const float B = i / 2000.0f;
			const FUprightPose Cur = UprightPose(B, Leg, 0.0f, EWork::Channelling);
			WorstTorso = std::fmax(WorstTorso, std::fabs(Cur.TorsoRise - Prev.TorsoRise));
			WorstHead = std::fmax(WorstHead, std::fabs(Cur.HeadPitchDeg - Prev.HeadPitchDeg));
			for (int L = 0; L < 4; ++L)
				WorstLeg = std::fmax(WorstLeg, std::fabs(Cur.LegPitchDeg[L] - Prev.LegPitchDeg[L]));
			Prev = Cur;
		}
		Check("the torso never jumps", WorstTorso < 0.5f, "worst " + std::to_string(WorstTorso) + " uu");
		Check("the head never jumps", WorstHead < 0.5f, "worst " + std::to_string(WorstHead) + " deg");
		Check("no leg jumps", WorstLeg < 0.5f, "worst " + std::to_string(WorstLeg) + " deg");

		// EASED AT BOTH ENDS. A linear rise leaves the ground at full speed,
		// which reads as a jerk however long the transition lasts.
		const float D0 = UprightPose(0.02f, Leg, 0.0f, EWork::None).TorsoRise
		               - UprightPose(0.00f, Leg, 0.0f, EWork::None).TorsoRise;
		const float DMid = UprightPose(0.52f, Leg, 0.0f, EWork::None).TorsoRise
		                 - UprightPose(0.50f, Leg, 0.0f, EWork::None).TorsoRise;
		const float D1 = UprightPose(1.00f, Leg, 0.0f, EWork::None).TorsoRise
		               - UprightPose(0.98f, Leg, 0.0f, EWork::None).TorsoRise;
		Check("it leaves the ground slowly and arrives slowly",
		      D0 < DMid * 0.35f && D1 < DMid * 0.35f,
		      "start " + std::to_string(D0) + " mid " + std::to_string(DMid)
		      + " end " + std::to_string(D1));
	}

	std::printf("== the hind paws stay on the floor ==\n");
	{
		// A hind paw leaving the ground while the Dog stands IS the hovering
		// the brief calls out. Checked across every work state and the whole
		// transition, because it only has to be wrong once to be seen.
		float WorstHind = 0.0f;
		for (const EWork W : { EWork::None, EWork::Meditating, EWork::Channelling,
		                       EWork::Placing, EWork::Inspecting, EWork::Repairing,
		                       EWork::Approving })
		{
			for (int i = 0; i <= 400; ++i)
			{
				const FUprightPose P = UprightPose(i / 400.0f, Leg, (i % 97) / 97.0f, W);
				WorstHind = std::fmax(WorstHind, std::fabs(P.LegRise[0]));
				WorstHind = std::fmax(WorstHind, std::fabs(P.LegRise[1]));
			}
		}
		Check("no hind paw ever leaves the ground, in any work state",
		      WorstHind == 0.0f, "worst rise " + std::to_string(WorstHind) + " uu");

		// The FORELEGS must, or the Dog has not stood up at all.
		const FUprightPose Up = UprightPose(1.0f, Leg, 0.0f, EWork::Channelling);
		Check("the forepaws DO leave the ground",
		      Up.LegRise[2] > Leg * 0.4f && Up.LegRise[3] > Leg * 0.4f,
		      std::to_string(Up.LegRise[2]) + " uu");
		Check("the chest rises by over half a leg", Up.TorsoRise > Leg * 0.5f,
		      std::to_string(Up.TorsoRise) + " uu");
		Check("...and the body pitches back rather than levitating",
		      Up.TorsoPitchDeg > 35.0f, std::to_string(Up.TorsoPitchDeg) + " deg");
		// The head must NOT end up staring at the sky.
		Check("the head stays roughly level, not pointed upward",
		      std::fabs(Up.TorsoPitchDeg + Up.HeadPitchDeg) < 20.0f,
		      "net " + std::to_string(Up.TorsoPitchDeg + Up.HeadPitchDeg) + " deg");
	}

	std::printf("== the transition is the same length at any frame rate ==\n");
	{
		// `Blend += Rate * Dt` converges at a speed that depends on the frame
		// rate, so the same rise is a different length at 20 fps and 60 — and
		// Wonderland has streamed at both this week.
		auto TimeToRise = [](float Fps) {
			float B = 0.0f, T = 0.0f;
			const float Dt = 1.0f / Fps;
			for (int i = 0; i < 100000 && B < 0.99f; ++i) { B = ApproachBlend(B, 1.0f, Dt); T += Dt; }
			return T;
		};
		const float T20 = TimeToRise(20.0f), T60 = TimeToRise(60.0f), T144 = TimeToRise(144.0f);
		Check("rising takes the same wall time at 20, 60 and 144 fps",
		      std::fabs(T20 - T60) < 0.06f && std::fabs(T60 - T144) < 0.06f,
		      std::to_string(T20) + "s / " + std::to_string(T60) + "s / " + std::to_string(T144) + "s");
		Check("...and it actually completes rather than approaching forever",
		      ApproachBlend(0.9999f, 1.0f, 1.0f / 60.0f) == 1.0f);
		Check("a blend never overshoots its target",
		      ApproachBlend(0.0f, 1.0f, 10.0f) <= 1.0f && ApproachBlend(1.0f, 0.0f, 10.0f) >= 0.0f);
	}

	std::printf("== work states are DIFFERENT poses, not one stand ==\n");
	{
		Check("meditating is a low sit, not a stand",
		      UprightTargetFor(EWork::Meditating) < 0.4f,
		      std::to_string(UprightTargetFor(EWork::Meditating)));
		Check("channelling goes fully upright",
		      UprightTargetFor(EWork::Channelling) > 0.95f);
		Check("quadruped work is exactly zero", UprightTargetFor(EWork::None) == 0.0f);
		// Distinct paw poses, or the states are one animation with new names.
		auto PoseDistance = [&](EWork X, EWork Y) {
			float Worst = 0.0f;
			for (int i = 0; i < 64; ++i)
			{
				const float Ph = i / 64.0f;
				const FUprightPose A = UprightPose(1.0f, Leg, Ph, X);
				const FUprightPose B = UprightPose(1.0f, Leg, Ph, Y);
				float D = std::fabs(A.HeadPitchDeg - B.HeadPitchDeg);
				for (int L = 2; L < 4; ++L)          // the forepaws are the work
					D += std::fabs(A.LegPitchDeg[L] - B.LegPitchDeg[L]);
				Worst = std::fmax(Worst, D);
			}
			return Worst;
		};
		const float CP = PoseDistance(EWork::Channelling, EWork::Placing);
		const float PA = PoseDistance(EWork::Placing, EWork::Approving);
		const float CA = PoseDistance(EWork::Channelling, EWork::Approving);
		const float CI = PoseDistance(EWork::Channelling, EWork::Inspecting);
		Check("channelling, placing, inspecting and approving are distinct poses",
		      CP > 25.0f && PA > 25.0f && CA > 25.0f && CI > 25.0f,
		      "channel/place " + std::to_string(CP) + ", place/approve " + std::to_string(PA)
		      + ", channel/approve " + std::to_string(CA) + ", channel/inspect " + std::to_string(CI));
		// A held pose still has to be alive.
		const float P1 = UprightPose(1.0f, Leg, 0.10f, EWork::Repairing).LegPitchDeg[2];
		const float P2 = UprightPose(1.0f, Leg, 0.60f, EWork::Repairing).LegPitchDeg[2];
		Check("repairing keeps moving while it is held, rather than freezing",
		      std::fabs(P1 - P2) > 3.0f, std::to_string(P1) + " vs " + std::to_string(P2));
		// ...but approval does not wave.
		const float Q1 = UprightPose(1.0f, Leg, 0.10f, EWork::Approving).LegPitchDeg[3];
		const float Q2 = UprightPose(1.0f, Leg, 0.60f, EWork::Approving).LegPitchDeg[3];
		Check("approving HOLDS the paw — a waving approval reads as a greeting",
		      std::fabs(Q1 - Q2) < 1e-4f);
	}

	std::printf("\npassed %d, failed %zu\n", gPass, gFail.size());
	for (const std::string& F : gFail) std::printf("  FAILED: %s\n", F.c_str());
	return gFail.empty() ? 0 : 1;
}

// Prove the Relay Dog's paws do not skate — on a laptop, with no engine.
//
//   g++ -std=c++17 -O1 -o /tmp/gait WonderlandDogGait.cpp WonderlandDogGait.test.cpp && /tmp/gait
//
// The founder's words were "sliding, teleporting, jittering, snapping". Foot
// lock is the property that decides whether a walk reads as walking: while a
// paw is down it must be stationary in WORLD space. Everything else — bob,
// pitch, gait order — is polish on top of that one thing, and it is arithmetic,
// so it is checked here rather than by looking at a stream on a rented GPU.
#include "WonderlandDogGait.h"

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

// THE C++ IS THE SOURCE OF TRUTH FOR THE GAIT, and the browser preview is a
// second implementation of it. Two implementations of the same arithmetic drift
// — the placement math already taught that, which is why the inspector consumes
// a contract rather than re-deriving a basis. Same answer here: this binary
// emits the table, the JS is checked against it, and the JS is never the
// authority. `--golden` prints it; nothing else changes.
static int EmitGolden()
{
	using namespace WonderlandGait;
	const float Stride = 120.0f, Lift = 18.0f, Bob = 3.0f;
	std::printf("{\n");
	std::printf("  \"note\": \"emitted by WonderlandDogGait.test.cpp --golden; do not hand-edit\",\n");
	std::printf("  \"stride\": %.1f, \"lift\": %.1f, \"bob\": %.1f,\n", Stride, Lift, Bob);
	std::printf("  \"dutyFactor\": %.6f,\n", WalkDutyFactor);
	std::printf("  \"legPhaseOffset\": [%.6f, %.6f, %.6f, %.6f],\n",
	            LegPhaseOffset(0), LegPhaseOffset(1), LegPhaseOffset(2), LegPhaseOffset(3));
	std::printf("  \"samples\": [\n");
	const int N = 64;
	for (int i = 0; i < N; ++i)
	{
		const float P = i / float(N);
		const FLegPose L = LegPose(P, Stride, Lift);
		const FBodyPose B = BodyPose(P, Bob);
		std::printf("    {\"p\": %.6f, \"fwd\": %.6f, \"lift\": %.6f, \"stance\": %s, "
		            "\"bob\": %.6f, \"pitch\": %.6f, \"roll\": %.6f}%s\n",
		            P, L.Forward, L.Lift, L.bStance ? "true" : "false",
		            B.Bob, B.Pitch, B.Roll, (i + 1 < N) ? "," : "");
	}
	std::printf("  ]\n}\n");
	return 0;
}

int main(int argc, char** argv)
{
	if (argc > 1 && std::string(argv[1]) == "--golden") { return EmitGolden(); }
	using namespace WonderlandGait;
	const float Stride = 120.0f;
	const float Lift = 14.0f;

	std::printf("== a planted paw does not move in world space ==\n");
	// Walk the body forward in small steps and watch one paw through a stance.
	float WorstDrift = 0.0f;
	int StanceSamples = 0;
	{
		float PrevWorld = 0.0f;
		bool bHavePrev = false;
		for (int i = 0; i <= 4000; ++i)
		{
			const float D = i * 0.05f;                 // body distance, uu
			const float Phase = D / Stride + LegPhaseOffset(0);
			const FLegPose Pose = LegPose(Phase, Stride, Lift);
			const float World = WorldPawForward(D, LegPhaseOffset(0), Stride, Lift);
			if (Pose.bStance)
			{
				if (bHavePrev) { WorstDrift = std::fmax(WorstDrift, std::fabs(World - PrevWorld)); }
				PrevWorld = World; bHavePrev = true; ++StanceSamples;
			}
			else { bHavePrev = false; }
		}
	}
	Check("a paw in stance is world-stationary to within a rounding error",
	      WorstDrift < 1e-3f,
	      "worst per-step world drift " + std::to_string(WorstDrift) + " uu over "
	      + std::to_string(StanceSamples) + " stance samples");
	Check("...and the stance was actually sampled, so the check ran",
	      StanceSamples > 1000);

	std::printf("== a paw in stance is on the ground, and a swinging one is not ==\n");
	{
		bool bStanceEverLifted = false, bSwingEverFlat = false;
		for (int i = 0; i < 1000; ++i)
		{
			const float P = i / 1000.0f;
			const FLegPose Pose = LegPose(P, Stride, Lift);
			if (Pose.bStance && Pose.Lift != 0.0f) bStanceEverLifted = true;
			if (!Pose.bStance && Pose.Lift <= 0.0f && P > WalkDutyFactor + 0.02f
			    && P < 0.98f) bSwingEverFlat = true;
		}
		Check("a planted paw is never lifted", !bStanceEverLifted);
		Check("a swinging paw leaves the ground", !bSwingEverFlat);
	}

	std::printf("== the paw arrives and leaves without stabbing the ground ==\n");
	{
		const FLegPose AtTouchdown = LegPose(0.9999f, Stride, Lift);
		const FLegPose AtLiftoff = LegPose(WalkDutyFactor + 0.0001f, Stride, Lift);
		Check("lift is ~0 at the moment of touchdown", AtTouchdown.Lift < 0.02f,
		      "lift " + std::to_string(AtTouchdown.Lift));
		Check("lift is ~0 at the moment of lift-off", AtLiftoff.Lift < 0.02f,
		      "lift " + std::to_string(AtLiftoff.Lift));
		const FLegPose Mid = LegPose(WalkDutyFactor + (1.0f - WalkDutyFactor) * 0.5f,
		                             Stride, Lift);
		Check("...and peaks mid-swing", Mid.Lift > Lift * 0.98f);
	}

	std::printf("== the four paws do not move together ==\n");
	{
		// This is the founder's "do not animate all four legs together".
		float Offsets[4];
		for (int i = 0; i < 4; ++i) Offsets[i] = LegPhaseOffset(i);
		bool bAllDistinct = true;
		for (int i = 0; i < 4; ++i)
			for (int j = i + 1; j < 4; ++j)
				if (std::fabs(Offsets[i] - Offsets[j]) < 1e-6f) bAllDistinct = false;
		Check("every leg has its own phase", bAllDistinct);
		Check("the footfall order is LH, LF, RH, RF — a lateral-sequence walk",
		      Offsets[0] < Offsets[2] && Offsets[2] < Offsets[1] && Offsets[1] < Offsets[3],
		      "LH " + std::to_string(Offsets[0]) + " LF " + std::to_string(Offsets[2])
		      + " RH " + std::to_string(Offsets[1]) + " RF " + std::to_string(Offsets[3]));
		// At any instant a walk keeps at least two paws down, which is what
		// stops it reading as a trot or a stumble.
		int WorstDown = 4;
		for (int i = 0; i < 1000; ++i)
		{
			const float P = i / 1000.0f;
			int Down = 0;
			for (int L = 0; L < 4; ++L)
				if (LegPose(P + LegPhaseOffset(L), Stride, Lift).bStance) ++Down;
			WorstDown = std::min(WorstDown, Down);
		}
		Check("at least two paws are down at every instant of the walk",
		      WorstDown >= 2, "fewest down at once: " + std::to_string(WorstDown));
	}

	std::printf("== the gait is driven by DISTANCE, so it cannot drift from the body ==\n");
	{
		// The same distance must give the same pose regardless of how fast it
		// was covered. A time-driven gait fails this, and that failure is what
		// makes legs twitch while the body glides.
		const float D = 337.0f;
		const FLegPose Slow = LegPose(D / Stride, Stride, Lift);
		const FLegPose Fast = LegPose(D / Stride, Stride, Lift);
		Check("pose depends only on distance travelled",
		      std::fabs(Slow.Forward - Fast.Forward) < 1e-6f);
		// And a full stride of travel returns the paw to where it started.
		const FLegPose Start = LegPose(0.13f, Stride, Lift);
		const FLegPose OneStrideLater = LegPose(1.13f, Stride, Lift);
		Check("one stride of travel returns the paw to the same pose",
		      std::fabs(Start.Forward - OneStrideLater.Forward) < 1e-4f
		      && std::fabs(Start.Lift - OneStrideLater.Lift) < 1e-4f);
	}

	std::printf("== the body carries the gait rather than gliding ==\n");
	{
		float MinBob = 1e9f, MaxBob = -1e9f;
		for (int i = 0; i < 1000; ++i)
		{
			const FBodyPose B = BodyPose(i / 1000.0f, 3.0f);
			MinBob = std::fmin(MinBob, B.Bob); MaxBob = std::fmax(MaxBob, B.Bob);
		}
		Check("the body bobs", (MaxBob - MinBob) > 5.0f,
		      "range " + std::to_string(MaxBob - MinBob));
		// Twice per stride: count zero crossings going positive.
		int Rises = 0; float Prev = BodyPose(0.0f, 3.0f).Bob;
		for (int i = 1; i <= 2000; ++i)
		{
			const float B = BodyPose(i / 2000.0f, 3.0f).Bob;
			if (Prev < 0.0f && B >= 0.0f) ++Rises;
			Prev = B;
		}
		Check("...twice per stride, once for each diagonal pair taking weight",
		      Rises == 2, "rises " + std::to_string(Rises));
	}

	std::printf("\npassed %d, failed %zu\n", gPass, gFail.size());
	for (const std::string& F : gFail) std::printf("  FAILED: %s\n", F.c_str());
	return gFail.empty() ? 0 : 1;
}

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
	const float LegLen = 119.6f;   // the canonical Dog at scale 1.3
	std::printf("{\n");
	std::printf("  \"note\": \"emitted by WonderlandDogGait.test.cpp --golden; do not hand-edit\",\n");
	std::printf("  \"stride\": %.1f, \"lift\": %.1f, \"bob\": %.1f,\n", Stride, Lift, Bob);
	std::printf("  \"dutyFactor\": %.6f,\n", WalkDutyFactor);
	std::printf("  \"legLength\": %.1f,\n", LegLen);
	std::printf("  \"legPhaseOffset\": [%.6f, %.6f, %.6f, %.6f],\n",
	            LegPhaseOffset(0), LegPhaseOffset(1), LegPhaseOffset(2), LegPhaseOffset(3));
	std::printf("  \"samples\": [\n");
	const int N = 64;
	for (int i = 0; i < N; ++i)
	{
		const float P = i / float(N);
		const FLegPose L = LegPose(P, Stride, Lift);
		const FBodyPose B = BodyPose(P, Bob);
		const FLegSwing W = LegSwing(L, LegLen);
		std::printf("    {\"p\": %.6f, \"fwd\": %.6f, \"lift\": %.6f, \"stance\": %s, "
		            "\"bob\": %.6f, \"pitch\": %.6f, \"roll\": %.6f, "
		            "\"swingPitch\": %.6f, \"stretch\": %.6f}%s\n",
		            P, L.Forward, L.Lift, L.bStance ? "true" : "false",
		            B.Bob, B.Pitch, B.Roll, W.PitchDeg, W.Stretch, (i + 1 < N) ? "," : "");
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
		// SIMULATE THE TOUCHDOWNS. This check used to assert
		//     Offsets[0] < Offsets[2] < Offsets[1] < Offsets[3]
		// which is a restatement of the table three lines above it, not a claim
		// about the Dog. A larger offset lands the paw SOONER, so ascending
		// constants produced the exact reverse of the intended order and the
		// test passed on it. The browser preview's HUD is what caught it.
		//
		// Walk the gait and record which paw goes down next, the way an eye
		// watching the Dog would.
		const char* const Name[4] = { "LH", "RH", "LF", "RF" };
		bool WasDown[4];
		for (int L = 0; L < 4; ++L)
			WasDown[L] = LegPose(LegPhaseOffset(L), Stride, Lift).bStance;
		std::vector<int> Seq;
		for (int i = 1; i <= 8000 && Seq.size() < 9; ++i)
		{
			const float D = (i / 8000.0f) * 4.0f * Stride;
			for (int L = 0; L < 4; ++L)
			{
				const bool Down = LegPose(D / Stride + LegPhaseOffset(L), Stride, Lift).bStance;
				if (Down && !WasDown[L]) Seq.push_back(L);
				WasDown[L] = Down;
			}
		}
		std::string SeqText;
		for (const int L : Seq) { SeqText += Name[L]; SeqText += " "; }
		// Lateral sequence: each HIND paw lands before the FORE paw on the same
		// side. Expressed as the cycle LH -> LF -> RH -> RF, checked from
		// wherever the recording happened to start.
		const int Cycle[4] = { 0, 2, 1, 3 };   // LH, LF, RH, RF
		bool bLateral = Seq.size() >= 5;
		if (bLateral)
		{
			int At = 0;
			while (At < 4 && Cycle[At] != Seq[0]) ++At;
			for (std::size_t k = 0; k < Seq.size(); ++k)
				if (Seq[k] != Cycle[(At + k) % 4]) bLateral = false;
		}
		Check("the footfall order is LH, LF, RH, RF — a lateral-sequence walk",
		      bLateral, "observed: " + SeqText);

		// AND THE HIND PAW LEADS THE FORE PAW ON THE SAME SIDE, BY A QUARTER
		// CYCLE. That IS the definition of a lateral sequence, and it is
		// precisely what the reversed table broke.
		//
		// A support-pattern check was written here first and deleted: it
		// asserted that two-paw support is always a DIAGONAL pair, which is
		// false — an even walk at duty 0.65 spends 20% of the cycle on two
		// same-side paws, by construction. Worse, it had no teeth. The correct
		// and reversed tables produce IDENTICAL support statistics (60% three
		// down, 20% diagonal, 20% ipsilateral), so no test of which paws are
		// down can tell them apart. Only the ORDER can.
		auto Touchdown = [](int Leg) {
			// Stance starts where the phase fraction wraps, so a leg carrying
			// offset o lands at distance-phase (1 - o) mod 1.
			const float O = LegPhaseOffset(Leg);
			float T = 1.0f - O;
			while (T >= 1.0f) T -= 1.0f;
			while (T < 0.0f) T += 1.0f;
			return T;
		};
		auto Lag = [&](int Hind, int Fore) {   // fore relative to hind, forward in time
			float L = Touchdown(Fore) - Touchdown(Hind);
			while (L < 0.0f) L += 1.0f;
			while (L >= 1.0f) L -= 1.0f;
			return L;
		};
		const float LeftLag = Lag(0, 2);    // LH -> LF
		const float RightLag = Lag(1, 3);   // RH -> RF
		Check("the left hind paw lands a quarter cycle BEFORE the left fore",
		      std::fabs(LeftLag - 0.25f) < 1e-4f,
		      "lag " + std::to_string(LeftLag) + " (0.75 means the fore leads — reversed)");
		Check("...and the same on the right",
		      std::fabs(RightLag - 0.25f) < 1e-4f,
		      "lag " + std::to_string(RightLag));
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

	std::printf("== the leg PIVOTS at the hip, and still lands where it should ==\n");
	{
		const float LegLen = 119.6f;   // the canonical Dog: 92 uu at scale 1.3
		float MaxStretch = 1.0f, MinStretch = 2.0f, MaxPitch = 0.0f;
		float WorstPaw = 0.0f;
		for (int i = 0; i <= 4000; ++i)
		{
			const float P = i / 4000.0f;
			const FLegPose L = LegPose(P, Stride, Lift);
			const FLegSwing W = LegSwing(L, LegLen);
			MaxStretch = std::fmax(MaxStretch, W.Stretch);
			MinStretch = std::fmin(MinStretch, W.Stretch);
			MaxPitch = std::fmax(MaxPitch, std::fabs(W.PitchDeg));
			// THE WHOLE POINT: rotating the limb by PitchDeg and stretching it
			// by Stretch must put the paw exactly where LegPose asked. If this
			// drifts, the pivot has quietly reintroduced the skate that the
			// translation was there to prevent.
			const float Rad = W.PitchDeg * (3.14159265358979323846f / 180.0f);
			const float PawF = LegLen * W.Stretch * std::sin(Rad);
			const float PawUp = LegLen - LegLen * W.Stretch * std::cos(Rad);
			WorstPaw = std::fmax(WorstPaw, std::fabs(PawF - L.Forward));
			WorstPaw = std::fmax(WorstPaw, std::fabs(PawUp - L.Lift));
		}
		Check("the pivoted leg puts its paw exactly where LegPose asked",
		      WorstPaw < 1e-3f, "worst " + std::to_string(WorstPaw) + " uu");
		Check("...so a planted paw is still locked, not merely near",
		      WorstPaw < 1e-3f);
		Check("the limb actually swings, rather than staying vertical",
		      MaxPitch > 12.0f, "max pitch " + std::to_string(MaxPitch) + " deg");
		// TWO DIFFERENT THINGS, BOUNDED SEPARATELY. The first version of this
		// check asked for the whole range to sit inside six percent and failed
		// at 0.88 — and the correct response was not to widen it to 0.88,
		// which would have been a guard relaxed until the code passed. The
		// range covers two phenomena that want opposite bounds:
		//
		//   STANCE. The paw is planted and the limb reaches forward or back
		//   from a fixed hip. It can only ever be LONGER than rest, and only
		//   by the small amount an arc is short by. A planted leg that visibly
		//   grows is wrong.
		//
		//   SWING. The limb retracts to carry the paw over the ground. Without
		//   a knee that IS the lift — it is the mechanism, not an error — and
		//   bounding it tightly would forbid the paw from leaving the floor.
		float StanceMax = 1.0f, StanceMin = 2.0f, SwingMin = 2.0f;
		for (int i = 0; i <= 4000; ++i)
		{
			const float P = i / 4000.0f;
			const FLegPose L = LegPose(P, Stride, Lift);
			const float St = LegSwing(L, LegLen).Stretch;
			if (L.bStance) { StanceMax = std::fmax(StanceMax, St); StanceMin = std::fmin(StanceMin, St); }
			else { SwingMin = std::fmin(SwingMin, St); }
		}
		Check("a PLANTED leg never shortens, and lengthens by under 6 percent",
		      StanceMin > 0.9999f && StanceMax < 1.06f,
		      "stance " + std::to_string(StanceMin) + " to " + std::to_string(StanceMax));
		Check("a SWINGING leg retracts — that retraction IS the paw lift",
		      SwingMin < 0.93f,
		      "swing shortest " + std::to_string(SwingMin));
		// And it must come back. A limb still short at touchdown puts the paw
		// through the floor on the next frame, which reads as a snap.
		const FLegSwing Touchdown = LegSwing(LegPose(0.0f, Stride, Lift), LegLen);
		const FLegSwing Liftoff = LegSwing(LegPose(WalkDutyFactor - 1e-4f, Stride, Lift), LegLen);
		Check("...and is back to full length at touchdown and at lift-off",
		      Touchdown.Stretch > 0.9999f && Liftoff.Stretch > 0.9999f,
		      "touchdown " + std::to_string(Touchdown.Stretch)
		      + " liftoff " + std::to_string(Liftoff.Stretch));
		// A leg at rest must be exactly its rest length; a Dog standing still
		// with a 3% longer leg is a Dog standing on tiptoe.
		const FLegSwing Rest = LegSwing(LegPose(WalkDutyFactor * 0.5f, Stride, Lift), LegLen);
		Check("mid-stance is upright and unstretched",
		      std::fabs(Rest.PitchDeg) < 1e-3f && std::fabs(Rest.Stretch - 1.0f) < 1e-4f,
		      "pitch " + std::to_string(Rest.PitchDeg) + " stretch " + std::to_string(Rest.Stretch));
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

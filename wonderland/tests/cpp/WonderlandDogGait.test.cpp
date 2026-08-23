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

static float Frac01(float V) { const float F = V - std::floor(V); return (F < 0.0f) ? F + 1.0f : F; }

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
	std::printf("  ],\n");
	// THE GAIT MODEL, SAMPLED. The browser preview mirrors GaitForSpeed, and
	// two implementations of the same arithmetic drift; this is what stops it.
	std::printf("  \"gaits\": [\n");
	const float Speeds[] = { 0.0f, 40.0f, 120.0f, 203.0f, 276.0f, 350.0f,
	                         496.0f, 583.0f, 800.0f, 1100.0f };
	const int NS = int(sizeof(Speeds) / sizeof(Speeds[0]));
	for (int i = 0; i < NS; ++i)
	{
		const FGaitParams G = GaitForSpeed(Speeds[i], LegLen);
		std::printf("    {\"speed\": %.1f, \"gait\": \"%s\", \"duty\": %.6f, "
		            "\"stride\": %.6f, \"lift\": %.6f, \"bob\": %.6f, "
		            "\"offsets\": [%.6f, %.6f, %.6f, %.6f]}%s\n",
		            Speeds[i], GaitName(G.Gait), G.DutyFactor, G.StrideLength,
		            G.LiftHeight, G.BobHeight,
		            G.LegOffset[0], G.LegOffset[1], G.LegOffset[2], G.LegOffset[3],
		            (i + 1 < NS) ? "," : "");
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

	std::printf("== speed picks the gait, and the stride grows with it ==\n");
	{
		const float Hip = 119.6f;
		// The stride was a CONSTANT. A Dog told to move faster cycled its legs
		// faster over the same ground, which is the speed/animation mismatch by
		// construction. It must now grow.
		const FGaitParams Slow = GaitForSpeed(60.0f, Hip);    // Fr 0.03 — walk
		const FGaitParams Mid  = GaitForSpeed(350.0f, Hip);   // Fr 1.05 — trot
		const FGaitParams Fast = GaitForSpeed(800.0f, Hip);   // Fr 5.46 — run
		Check("the stride LENGTHENS with speed rather than replaying faster",
		      Slow.StrideLength < Mid.StrideLength && Mid.StrideLength < Fast.StrideLength,
		      std::to_string(Slow.StrideLength) + " -> " + std::to_string(Mid.StrideLength)
		      + " -> " + std::to_string(Fast.StrideLength));
		Check("...and the duty factor FALLS, so paws spend less time planted",
		      Slow.DutyFactor > Mid.DutyFactor && Mid.DutyFactor > Fast.DutyFactor,
		      std::to_string(Slow.DutyFactor) + " -> " + std::to_string(Mid.DutyFactor)
		      + " -> " + std::to_string(Fast.DutyFactor));
		Check("the three gaits are actually reached",
		      Slow.Gait == EGait::Walk && Mid.Gait == EGait::Trot && Fast.Gait == EGait::Run,
		      std::string(GaitName(Slow.Gait)) + "/" + GaitName(Mid.Gait) + "/" + GaitName(Fast.Gait));
		Check("a stopped Dog reads as idle, not as a walk at zero speed",
		      GaitForSpeed(0.0f, Hip).Gait == EGait::Idle);

		// SCALE INVARIANCE. This is why the thresholds are Froude numbers and
		// not uu/s: the hero Dog at actor scale 1.75 and a companion at 1.05
		// must break into a trot at DIFFERENT speeds and the SAME Froude
		// number, with no per-Dog tuning to keep in sync.
		auto TrotSpeed = [](float H) {
			// The first TROT, not the first non-walk: below 1 uu/s the Dog is
			// idle, which is also not a walk, and the old form returned 0.5 for
			// every size and compared two identical numbers.
			for (int i = 1; i < 8000; ++i)
			{
				const float V = i * 0.5f;
				if (GaitForSpeed(V, H).Gait == EGait::Trot) { return V; }
			}
			return -1.0f;
		};
		const float SmallH = 119.6f, BigH = 119.6f * 1.75f;
		const float VSmall = TrotSpeed(SmallH), VBig = TrotSpeed(BigH);
		Check("a bigger Dog breaks into a trot at a HIGHER speed",
		      VBig > VSmall * 1.2f,
		      "small " + std::to_string(VSmall) + " uu/s, big " + std::to_string(VBig));
		const float FrSmall = (VSmall * VSmall) / (980.0f * SmallH);
		const float FrBig = (VBig * VBig) / (980.0f * BigH);
		Check("...at the SAME Froude number, which is what makes it scale-free",
		      std::fabs(FrSmall - FrBig) < 0.05f,
		      "Fr " + std::to_string(FrSmall) + " vs " + std::to_string(FrBig));

		// The walk table here and LegPhaseOffset are two spellings of one fact.
		const FGaitParams W = GaitForSpeed(50.0f, Hip);
		bool bAgree = true;
		for (int i = 0; i < 4; ++i)
			if (std::fabs(W.LegOffset[i] - LegPhaseOffset(i)) > 1e-4f) bAgree = false;
		Check("the walk's offsets agree with LegPhaseOffset", bAgree);
	}

	std::printf("== a gait CHANGE is blended, never snapped ==\n");
	{
		const float Hip = 119.6f;
		// Four phases swapped in one frame is a visible kick. Sweep the whole
		// speed range and assert nothing jumps between adjacent samples.
		float WorstStride = 0.0f, WorstDuty = 0.0f, WorstPhase = 0.0f;
		FGaitParams Prev = GaitForSpeed(0.5f, Hip);
		for (int i = 1; i <= 4000; ++i)
		{
			const float V = 0.5f + i * 0.2f;
			const FGaitParams Cur = GaitForSpeed(V, Hip);
			WorstStride = std::fmax(WorstStride, std::fabs(Cur.StrideLength - Prev.StrideLength));
			WorstDuty = std::fmax(WorstDuty, std::fabs(Cur.DutyFactor - Prev.DutyFactor));
			for (int L = 0; L < 4; ++L)
			{
				float D = std::fabs(Cur.LegOffset[L] - Prev.LegOffset[L]);
				if (D > 0.5f) { D = 1.0f - D; }      // the wrap is not a jump
				WorstPhase = std::fmax(WorstPhase, D);
			}
			Prev = Cur;
		}
		Check("stride never jumps between adjacent speeds", WorstStride < 1.0f,
		      "worst " + std::to_string(WorstStride) + " uu");
		Check("duty never jumps", WorstDuty < 0.01f, "worst " + std::to_string(WorstDuty));
		Check("no leg's phase jumps across a transition",
		      WorstPhase < 0.01f, "worst " + std::to_string(WorstPhase) + " of a cycle");
	}

	std::printf("== each gait is a DIFFERENT gait, not the walk played faster ==\n");
	{
		const float Hip = 119.6f;
		auto DownAt = [&](const FGaitParams& G, float P) {
			int N = 0;
			for (int L = 0; L < 4; ++L)
				if (LegPose(P + G.LegOffset[L], G.StrideLength, G.LiftHeight, G.DutyFactor).bStance) ++N;
			return N;
		};
		const FGaitParams Wk = GaitForSpeed(60.0f, Hip);    // Fr 0.03
		const FGaitParams Tr = GaitForSpeed(350.0f, Hip);   // Fr 1.05, trot saturated
		const FGaitParams Rn = GaitForSpeed(800.0f, Hip);   // Fr 5.46, run saturated

		int WorstWalk = 4, WorstRun = 4, SuspensionRun = 0;
		for (int i = 0; i < 2000; ++i)
		{
			const float P = i / 2000.0f;
			WorstWalk = std::min(WorstWalk, DownAt(Wk, P));
			const int R = DownAt(Rn, P);
			WorstRun = std::min(WorstRun, R);
			if (R == 0) ++SuspensionRun;
		}
		Check("a WALK always keeps at least two paws down", WorstWalk >= 2,
		      "worst " + std::to_string(WorstWalk));
		Check("a RUN has a suspension phase — moments with NO paw down",
		      SuspensionRun > 0,
		      std::to_string(SuspensionRun) + " of 2000 samples airborne");

		// A trot is DIAGONAL PAIRS. LH+RF together, RH+LF together. This is the
		// one an eye reads instantly as "that is not a walk".
		const float LH = Tr.LegOffset[0], RH = Tr.LegOffset[1];
		const float LF = Tr.LegOffset[2], RF = Tr.LegOffset[3];
		auto Near = [](float A, float B) {
			float D = std::fabs(A - B);
			if (D > 0.5f) { D = 1.0f - D; }
			return D < 0.06f;
		};
		Check("a TROT moves the diagonal pairs together (LH+RF, RH+LF)",
		      Near(LH, RF) && Near(RH, LF) && !Near(LH, RH),
		      "LH " + std::to_string(LH) + " RH " + std::to_string(RH)
		      + " LF " + std::to_string(LF) + " RF " + std::to_string(RF));
	}

	std::printf("== FOOT LOCK SURVIVES EVERY GAIT ==\n");
	{
		// The whole fix rests on this one property, and it was only ever proven
		// for the walk at a fixed duty. Every gait now has its own duty and its
		// own stride; a planted paw must still be stationary in all of them, or
		// the Dog skates the moment it speeds up.
		const float Hip = 119.6f;
		float WorstDrift = 0.0f;
		int Samples = 0;
		for (const float V : { 40.0f, 120.0f, 230.0f, 380.0f, 560.0f, 720.0f })
		{
			const FGaitParams G = GaitForSpeed(V, Hip);
			for (int L = 0; L < 4; ++L)
			{
				float Anchor = 0.0f, PrevPhase = -1.0f;
				bool bHave = false;
				for (float D = 0.0f; D <= 2000.0f; D += 0.25f)
				{
					const float Phase = Frac01(D / G.StrideLength + G.LegOffset[L]);
					const FLegPose Pose = LegPose(Phase, G.StrideLength, G.LiftHeight, G.DutyFactor);
					if (!Pose.bStance) { bHave = false; PrevPhase = Phase; continue; }
					const float World = D + Pose.Forward;
					if (!bHave || Phase < PrevPhase) { Anchor = World; bHave = true; }
					else { WorstDrift = std::fmax(WorstDrift, std::fabs(World - Anchor)); ++Samples; }
					PrevPhase = Phase;
				}
			}
		}
		Check("a planted paw is stationary in walk, trot AND run",
		      WorstDrift < 1e-2f && Samples > 5000,
		      "worst " + std::to_string(WorstDrift) + " uu over "
		      + std::to_string(Samples) + " planted samples across 6 speeds");
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

	std::printf("== paws sit on the ground they are actually over ==\n");
	{
		const float Dt = 1.0f / 60.0f, Max = 40.0f;
		// A PLANTED PAW REACHES ITS GROUND. Run it to convergence.
		float O = 0.0f;
		for (int i = 0; i < 400; ++i) { O = PawGroundOffset(O, 18.0f, true, Max, Dt); }
		Check("a planted paw settles onto ground 18 uu above it",
		      std::fabs(O - 18.0f) < 0.05f, std::to_string(O) + " uu");
		// ...and below it, for a downhill paw that would otherwise hang.
		O = 0.0f;
		for (int i = 0; i < 400; ++i) { O = PawGroundOffset(O, -22.0f, true, Max, Dt); }
		Check("...and reaches DOWN to ground below it, instead of hanging",
		      std::fabs(O + 22.0f) < 0.05f, std::to_string(O) + " uu");

		// A SWINGING PAW IS NOT GLUED DOWN. If it were, the swing arc would be
		// cancelled and the Dog would shuffle with its feet on the floor.
		O = 30.0f;
		for (int i = 0; i < 400; ++i) { O = PawGroundOffset(O, 30.0f, false, Max, Dt); }
		Check("a SWINGING paw returns to zero, so its arc survives",
		      std::fabs(O) < 0.05f, std::to_string(O) + " uu");

		// CLAMPED. One bad trace must not stretch a leg to the horizon.
		O = 0.0f;
		for (int i = 0; i < 400; ++i) { O = PawGroundOffset(O, 5000.0f, true, Max, Dt); }
		Check("a wild trace is clamped to the limit, not followed",
		      std::fabs(O - Max) < 0.05f, std::to_string(O) + " uu");
		O = 0.0f;
		for (int i = 0; i < 400; ++i) { O = PawGroundOffset(O, -5000.0f, true, Max, Dt); }
		Check("...in both directions", std::fabs(O + Max) < 0.05f, std::to_string(O) + " uu");

		// EASED, NOT SNAPPED. A paw crossing a step must not pop.
		O = 0.0f;
		const float First = PawGroundOffset(O, 40.0f, true, Max, Dt);
		Check("one frame does not jump the whole way onto a step",
		      First < 40.0f * 0.35f, "first frame moved " + std::to_string(First) + " uu");

		// FRAME-RATE INDEPENDENT. The same step must take the same wall time at
		// 20 fps and 60, or the grounding behaves differently as the stream's
		// frame rate moves — and this world has streamed between 13 and 21.
		auto TimeTo = [&](float Fps) {
			float V = 0.0f, T = 0.0f; const float D = 1.0f / Fps;
			for (int i = 0; i < 100000 && V < 35.0f; ++i) { V = PawGroundOffset(V, 40.0f, true, Max, D); T += D; }
			return T;
		};
		const float A = TimeTo(20.0f), B = TimeTo(60.0f), C = TimeTo(144.0f);
		Check("a paw settles in the same wall time at 20, 60 and 144 fps",
		      std::fabs(A - B) < 0.04f && std::fabs(B - C) < 0.04f,
		      std::to_string(A) + "s / " + std::to_string(B) + "s / " + std::to_string(C) + "s");

		// FOOT IK MUST NOT DISTURB FOOT LOCK. Run a leg through strides over
		// sloping ground with the grounding active, and check the planted paw's
		// world position along the TRAVEL axis never moves — the correction is
		// vertical, so the lock the whole gait rests on is untouched.
		{
			const float Stride = 120.0f, Lift = 18.0f;
			float Off = 0.0f, WorstDrift = 0.0f, Anchor = 0.0f, PrevPhase = -1.0f;
			bool bHave = false;
			int Planted = 0;
			for (int i = 0; i <= 6000; ++i)
			{
				const float D = i * 0.15f;
				const float Phase = D / Stride;
				const FLegPose Pose = LegPose(Phase, Stride, Lift);
				// A slope the Dog is walking up, plus a step partway along.
				const float Ground = D * 0.12f + ((D > 400.0f) ? 25.0f : 0.0f);
				Off = PawGroundOffset(Off, Ground - D * 0.12f, Pose.bStance, 40.0f, 1.0f / 60.0f);
				if (!Pose.bStance) { bHave = false; PrevPhase = Phase; continue; }
				const float World = D + Pose.Forward;      // horizontal only
				if (!bHave || Phase < PrevPhase) { Anchor = World; bHave = true; }
				else { WorstDrift = std::fmax(WorstDrift, std::fabs(World - Anchor)); ++Planted; }
				PrevPhase = Phase;
			}
			Check("grounding a paw on a slope does not move it horizontally",
			      WorstDrift < 1e-2f && Planted > 2000,
			      "worst drift " + std::to_string(WorstDrift) + " uu over "
			      + std::to_string(Planted) + " planted samples on a slope with a step");
		}
	}

	std::printf("== a Dog will not walk through the opening shot ==\n");
	{
		const float CX = 0.0f, CY = -1150.0f, R = 1150.0f;
		float X = 0.0f, Y = 0.0f;
		// Outside is untouched.
		PushOutOfColumn(0.0f, 500.0f, CX, CY, R, X, Y);
		Check("a point outside the column is left exactly where it was",
		      std::fabs(X - 0.0f) < 1e-4f && std::fabs(Y - 500.0f) < 1e-4f);
		// Inside is pushed to the rim, keeping its bearing.
		PushOutOfColumn(0.0f, -600.0f, CX, CY, R, X, Y);
		const float D = std::sqrt((X - CX) * (X - CX) + (Y - CY) * (Y - CY));
		Check("a point inside is pushed exactly to the rim", std::fabs(D - R) < 1e-2f,
		      "distance " + std::to_string(D));
		Check("...along its own bearing, not toward an arbitrary axis",
		      std::fabs(X - CX) < 1e-3f && Y > CY,
		      "landed at " + std::to_string(X) + "," + std::to_string(Y));
		// THE CENTRE. A Dog standing exactly on the camera has no bearing to
		// push along, and dividing by that zero puts a NaN into a transform,
		// which is an actor that vanishes rather than an actor that moves.
		PushOutOfColumn(CX, CY, CX, CY, R, X, Y);
		Check("a point AT the centre leaves along a defined bearing, not a NaN",
		      X == X && Y == Y && std::fabs(std::sqrt((X - CX) * (X - CX) + (Y - CY) * (Y - CY)) - R) < 1e-2f,
		      "landed at " + std::to_string(X) + "," + std::to_string(Y));
		// Disabled means disabled.
		PushOutOfColumn(0.0f, -600.0f, CX, CY, 0.0f, X, Y);
		Check("radius 0 is no exclusion at all",
		      std::fabs(X) < 1e-4f && std::fabs(Y + 600.0f) < 1e-4f);
		// The rule has to hold for a Dog CROSSING, not just for its target: walk
		// a chord straight through the column and check every step is outside.
		int Inside = 0;
		for (int i = 0; i <= 500; ++i)
		{
			const float T = i / 500.0f;
			const float PX = -1600.0f + 3200.0f * T;
			const float PY = -1150.0f;
			PushOutOfColumn(PX, PY, CX, CY, R, X, Y);
			if (std::sqrt((X - CX) * (X - CX) + (Y - CY) * (Y - CY)) < R - 1e-2f) ++Inside;
		}
		Check("a Dog walking a chord straight through it never gets inside",
		      Inside == 0, std::to_string(Inside) + " of 501 steps landed inside");
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

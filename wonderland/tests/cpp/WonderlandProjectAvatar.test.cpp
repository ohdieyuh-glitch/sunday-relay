// The Project Avatar must never lie about what Relay is doing.
//
//   g++ -std=c++17 -O1 -o /tmp/av WonderlandProjectAvatar.cpp WonderlandDogPose.cpp \
//       WonderlandProjectAvatar.test.cpp
//
// A world that idly cycles pretty animations is a screensaver. A world that
// shows implementing ONLY while Relay is implementing is an instrument. The
// difference is invisible in a screenshot and total in what the thing is for,
// so it is checked here by name.
#include "WonderlandProjectAvatar.h"

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

static int EmitGolden()
{
	using namespace WonderlandAvatar;
	const EStage Stages[] = { EStage::Dormant, EStage::Egg, EStage::Baby,
	                          EStage::Growing, EStage::Advanced, EStage::Final };
	const EMission Missions[] = { EMission::Unknown, EMission::Idle,
	                              EMission::Researching, EMission::Implementing,
	                              EMission::Reviewing, EMission::Repairing,
	                              EMission::Complete };
	std::printf("{\n  \"note\": \"emitted by WonderlandProjectAvatar.test.cpp --golden\",\n");
	std::printf("  \"stages\": [\n");
	for (int i = 0; i < 6; ++i)
	{
		const FAvatarLook L = LookFor(Stages[i], EMission::Idle, 0.0f);
		std::printf("    {\"name\": \"%s\", \"scale\": %.4f, \"segments\": %d}%s\n",
		            StageName(Stages[i]), L.Scale, L.Segments, (i < 5) ? "," : "");
	}
	std::printf("  ],\n  \"missions\": [\n");
	for (int m = 0; m < 7; ++m)
	{
		std::printf("    {\"name\": \"%s\", \"work\": \"%s\", \"attends\": %s, \"glow\": [",
		            MissionName(Missions[m]),
		            WonderlandPose::WorkName(WorkForMission(Missions[m])),
		            MissionWantsAttendance(Missions[m]) ? "true" : "false");
		for (int k = 0; k < 24; ++k)
		{
			std::printf("%.4f%s",
			            LookFor(EStage::Growing, Missions[m], k / 24.0f).Glow,
			            (k < 23) ? ", " : "");
		}
		std::printf("]}%s\n", (m < 6) ? "," : "");
	}
	std::printf("  ]\n}\n");
	return 0;
}

int main(int argc, char** argv)
{
	if (argc > 1 && std::string(argv[1]) == "--golden") { return EmitGolden(); }
	using namespace WonderlandAvatar;
	using WonderlandPose::EWork;

	std::printf("== the Avatar does not invent work Relay is not doing ==\n");
	{
		Check("NO Relay data means the Dog does NO work",
		      WorkForMission(EMission::Unknown) == EWork::None);
		Check("...and an idle Relay means no work either",
		      WorkForMission(EMission::Idle) == EWork::None);
		Check("...and neither draws a Dog to the Avatar",
		      !MissionWantsAttendance(EMission::Unknown)
		      && !MissionWantsAttendance(EMission::Idle));
		// A finished project is not a Dog still hammering at it.
		Check("a COMPLETE mission stops the work animation",
		      WorkForMission(EMission::Complete) == EWork::None);

		// Every state that IS work must produce work, or a real Relay run would
		// show a Dog standing idle beside a glowing project.
		bool bAllWork = true;
		for (const EMission M : { EMission::Researching, EMission::Planning,
		                          EMission::Implementing, EMission::Reviewing,
		                          EMission::Verifying, EMission::Repairing,
		                          EMission::Approved })
			if (WorkForMission(M) == EWork::None) bAllWork = false;
		Check("every ACTIVE mission state produces a visible work pose", bAllWork);

		// And they must not all be the same pose.
		Check("implementing, reviewing and repairing look different",
		      WorkForMission(EMission::Implementing) != WorkForMission(EMission::Reviewing)
		      && WorkForMission(EMission::Reviewing) != WorkForMission(EMission::Repairing)
		      && WorkForMission(EMission::Implementing) != WorkForMission(EMission::Repairing));
	}

	std::printf("== a dormant project does not glow ==\n");
	{
		float Worst = 0.0f;
		for (int i = 0; i < 200; ++i)
			Worst = std::fmax(Worst, LookFor(EStage::Dormant, EMission::Unknown, i / 200.0f).Glow);
		Check("an unreachable Bridge leaves the Avatar completely dark",
		      Worst == 0.0f, "peak glow " + std::to_string(Worst));

		// Implementing is the busiest it ever looks — that is the beat the
		// founder should be able to read across the plaza.
		float PeakImpl = 0.0f, PeakIdle = 0.0f;
		for (int i = 0; i < 200; ++i)
		{
			const float P = i / 200.0f;
			PeakImpl = std::fmax(PeakImpl, LookFor(EStage::Growing, EMission::Implementing, P).Glow);
			PeakIdle = std::fmax(PeakIdle, LookFor(EStage::Growing, EMission::Idle, P).Glow);
		}
		Check("implementing is unmistakably brighter than idle",
		      PeakImpl > PeakIdle * 4.0f,
		      std::to_string(PeakImpl) + " vs " + std::to_string(PeakIdle));
		// Repairing GUTTERS. A fault that pulses like healthy work is a fault
		// nobody notices.
		auto Crossings = [](EMission M) {
			int N = 0;
			float Prev = LookFor(EStage::Growing, M, 0.0f).Glow;
			float Lo = Prev, Hi = Prev;
			for (int i = 1; i <= 2000; ++i)
			{
				const float G = LookFor(EStage::Growing, M, i / 2000.0f).Glow;
				Lo = std::fmin(Lo, G); Hi = std::fmax(Hi, G);
				Prev = G;
			}
			const float Mid = (Lo + Hi) * 0.5f;
			Prev = LookFor(EStage::Growing, M, 0.0f).Glow;
			for (int i = 1; i <= 2000; ++i)
			{
				const float G = LookFor(EStage::Growing, M, i / 2000.0f).Glow;
				if ((Prev < Mid) != (G < Mid)) ++N;
				Prev = G;
			}
			return N;
		};
		const int Fault = Crossings(EMission::Repairing);
		const int Healthy = Crossings(EMission::Implementing);
		Check("repairing GUTTERS — many times faster than a healthy work pulse",
		      Fault >= Healthy * 4 && Healthy > 0,
		      "repairing " + std::to_string(Fault) + " crossings vs implementing "
		      + std::to_string(Healthy));
	}

	std::printf("== the Avatar grows because work LANDED, never because time passed ==\n");
	{
		Check("no completed runs and no mission is dormant",
		      StageFor(EStage::Dormant, EMission::Unknown, 0) == EStage::Dormant);
		Check("a mission existing gets it to egg",
		      StageFor(EStage::Dormant, EMission::Planning, 0) == EStage::Egg);
		Check("one completed run hatches it",
		      StageFor(EStage::Egg, EMission::Idle, 1) == EStage::Baby);
		Check("stages are earned at 3, 6 and 12 completed runs",
		      StageFor(EStage::Baby, EMission::Idle, 3) == EStage::Growing
		      && StageFor(EStage::Growing, EMission::Idle, 6) == EStage::Advanced
		      && StageFor(EStage::Advanced, EMission::Idle, 12) == EStage::Final);

		// NEVER REGRESS. A Bridge that drops out sets Mission to Unknown; a
		// project that visibly shrank because the network blinked would be
		// worse than one that froze.
		Check("losing the Bridge does not shrink the project",
		      StageFor(EStage::Advanced, EMission::Unknown, 0) == EStage::Advanced);
		Check("...nor does a completed-run count going backwards",
		      StageFor(EStage::Final, EMission::Idle, 0) == EStage::Final);

		// A LATER STAGE IS BIGGER. If the look does not change, the growth is
		// bookkeeping the founder cannot see.
		float Last = -1.0f;
		bool bGrows = true;
		for (const EStage S : { EStage::Dormant, EStage::Egg, EStage::Baby,
		                        EStage::Growing, EStage::Advanced, EStage::Final })
		{
			const FAvatarLook L = LookFor(S, EMission::Idle, 0.0f);
			if (L.Scale <= Last) bGrows = false;
			Last = L.Scale;
		}
		Check("every stage is visibly bigger than the one before", bGrows);
		Check("...and later stages carry more shell segments",
		      LookFor(EStage::Final, EMission::Idle, 0.0f).Segments
		      > LookFor(EStage::Baby, EMission::Idle, 0.0f).Segments);
	}

	std::printf("\npassed %d, failed %zu\n", gPass, gFail.size());
	for (const std::string& F : gFail) std::printf("  FAILED: %s\n", F.c_str());
	return gFail.empty() ? 0 : 1;
}

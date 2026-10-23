// Offline lock for the QA event line. Does not parse an absent handoff field.
#include "WonderlandQaFormat.h"
#include "WonderlandSocialReconnectPolicy.h"

#include <cmath>
#include <cstdio>
#include <string>

namespace
{
	int gFails = 0;

	void Expect(bool bOk, const char* What)
	{
		if (!bOk)
		{
			std::fprintf(stderr, "FAIL %s\n", What);
			++gFails;
		}
	}

	void ExpectEq(const std::string& Got, const char* Want, const char* What)
	{
		if (Got != Want)
		{
			std::fprintf(stderr, "FAIL %s\n got %s\n", What, Got.c_str());
			++gFails;
		}
	}

	void ExpectOrder(const std::string& Line)
	{
		const char* Keys[] = {"\"ts_utc_ms\"", "\"client_role\"", "\"net_id\"", "\"build_sha\"", "\"corr_id\"", "\"event\""};
		std::size_t At = 0;
		for (const char* Key : Keys)
		{
			const std::size_t Found = Line.find(Key, At);
			Expect(Found != std::string::npos, "key missing or out of order");
			if (Found == std::string::npos)
			{
				return;
			}
			At = Found + 1;
		}
	}
}

int main()
{
	using namespace WonderlandQa;
	ResetForTests();
	Expect(!IsEnabled(), "QA defaults off");
	Expect(std::string(DisabledRefusal()).find('{') == std::string::npos, "refusal is not JSON");

	const std::string Started = ActivationLine(1000, "sender", "local", false, "", true, "local1", kActivationStarted);
	ExpectEq(Started,
		"{\"ts_utc_ms\":1000,\"client_role\":\"sender\",\"net_id\":\"local\",\"build_sha\":null,\"corr_id\":\"local1\",\"event\":\"activation_started\",\"anim_asset\":\"handoff_twin_swords\",\"vfx_asset\":\"WonderlandHandoffTransform\"}",
		"activation line");
	ExpectOrder(Started);
	const std::string NoNet = EventLine(1000, "observer", "", false, "", false, "", kActivationEnded, "");
	Expect(NoNet.find("\"net_id\":null") != std::string::npos, "empty net id is null");
	Expect(NoNet.find("\"corr_id\":null") != std::string::npos, "missing corr is null");
	Expect(NoNet.find("\"build_sha\":null") != std::string::npos, "missing build is null");

	const std::string Miss = MovementLine(1000, "sender", "local", 1.0, 2.0, 3.0, false, 0.0, 0.0, 0.0, false, false, 0.0, false);
	ExpectEq(Miss,
		"{\"ts_utc_ms\":1000,\"client_role\":\"sender\",\"net_id\":\"local\",\"build_sha\":null,\"corr_id\":null,\"event\":\"movement_sample\",\"x\":1.0000,\"y\":2.0000,\"z\":3.0000,\"vx\":null,\"vy\":null,\"vz\":null,\"ground_hit\":false,\"ground_distance\":null,\"hover\":false}",
		"ground miss");
	Expect(Miss.find("\"ground_distance\":0") == std::string::npos, "a miss is not distance 0");
	const std::string NanDist = MovementLine(1000, "observer", "usr", 0.0, 0.0, 0.0, true, 1.0, 0.0, 0.0, true, true, std::nan(""), false);
	Expect(NanDist.find("\"ground_distance\":null") != std::string::npos, "non-finite distance is null");

	int64_t Last = -1;
	Expect(ShouldSample(Last, 0) && Last == 0, "first sample");
	Expect(!ShouldSample(Last, 50) && Last == 0, "inside the period");
	Expect(ShouldSample(Last, 100) && Last == 100, "period elapsed");
	Expect(!ShouldSample(Last, 50) && Last == 100, "backwards clock");
	Expect(ShouldSample(Last, 100000) && Last == 100000, "one sample across a gap");
	Expect(!ShouldSample(Last, 100050) && Last == 100000, "no burst after a gap");

	ResetForTests();
	const FMotionSample First = TakeMotion("local", 1000, 0.0, 0.0, 0.0);
	Expect(First.bEmit && !First.bHasVelocity, "first velocity is null");
	const FMotionSample Early = TakeMotion("local", 1050, 1.0, 0.0, 0.0);
	Expect(!Early.bEmit, "motion clock holds inside the period");
	const FMotionSample Second = TakeMotion("local", 1100, 1.0, 0.0, 0.0);
	Expect(Second.bEmit && Second.bHasVelocity && Second.Vx == 10.0 && Second.Vy == 0.0 && Second.Vz == 0.0, "velocity from the delta");
	const FMotionSample Back = TakeMotion("local", 1000, 9.0, 9.0, 9.0);
	Expect(!Back.bEmit, "motion clock ignores a backwards step");
	const FMotionSample Still = TakeMotion("local", 1199, 9.0, 9.0, 9.0);
	Expect(!Still.bEmit, "backwards step did not move the clock");

	ResetForTests();
	const FEdge LocalStart = LocalEdge(0, 1);
	Expect(LocalStart.bEmit && LocalStart.Corr == "local1" && LocalStart.Event == kActivationStarted, "local start");
	const FEdge LocalAgain = LocalEdge(0, 1);
	Expect(LocalAgain.bEmit && LocalAgain.Corr == "local2", "second start mints a new corr");
	ResetForTests();
	Expect(!LocalEdge(0, 4).bEmit, "restored Held does not start");
	Expect(!LocalEdge(5, 0).bEmit, "end without a start emits nothing");
	Expect(LocalEdge(0, 1).bEmit, "start after a refused end");
	const FEdge LocalEnd = LocalEdge(5, 0);
	Expect(LocalEnd.bEmit && LocalEnd.Event == kActivationEnded && LocalEnd.Corr == "local1", "end after a start");

	ResetForTests();
	Expect(ObserverCorr("e9n3") == "e9n3", "carried corr is copied unchanged");
	const FEdge ObsStart = ObserverEdge("fig", -1, 1, "e9n3");
	Expect(ObsStart.bEmit && ObsStart.Corr == "e9n3" && ObsStart.Event == kActivationStarted, "observer start");
	const FEdge ObsDup = ObserverEdge("fig", -1, 1, "e9n3");
	Expect(!ObsDup.bEmit, "duplicate corr is ignored");
	Expect(!ObserverEdge("other", 4, 0, "e1n1").bEmit, "end of an unseen corr does not start");
	Expect(!ObserverEdge("fig", -1, 4, "e9n3").bEmit, "observer Held does not start");
	const FEdge ObsEnd = ObserverEdge("fig", 2, 0, "seq1");
	Expect(ObsEnd.bEmit && ObsEnd.Event == kActivationEnded && ObsEnd.Corr == "e9n3", "end keeps the corr from the start");

	const bool bWould = WonderlandSocialReconnectPolicy::ShouldRetryLeave(0, false, true);
	Expect(bWould, "status 0 would retry a leave once");
	Expect(!WonderlandSocialReconnectPolicy::ShouldRetryLeave(0, false, false), "policy off does not retry");
	Expect(!WonderlandSocialReconnectPolicy::ShouldRetryLeave(0, true, true), "a retry already recorded does not retry again");
	Expect(!WonderlandSocialReconnectPolicy::ShouldRetryLeave(200, false, true), "a normal status is not a transport failure");

	FDropFacts Facts;
	Facts.TsMs = 1000;
	Facts.bHasRejoin404 = true;
	Facts.Rejoin404 = 1;
	Facts.bHasRejoinKeep = true;
	Facts.RejoinKeep = 1;
	Facts.bHasLeaveRetry = true;
	Facts.LeaveRetry = 1;
	Facts.bHasLeaveWould = true;
	Facts.bLeaveRetryWouldApply = bWould;
	const std::vector<std::string> Lines = DropLines(Facts);
	Expect(Lines.size() == 4, "four drop lines");
	if (Lines.size() == 4)
	{
		Expect(Lines[0].find("\"event\":\"disconnect\"") != std::string::npos, "disconnect");
		Expect(Lines[1].find("\"event\":\"reconnect_attempt\"") != std::string::npos, "reconnect_attempt");
		Expect(Lines[2].find("\"event\":\"reconnected\"") != std::string::npos, "reconnected");
		Expect(Lines[3].find("\"event\":\"state_restored\"") != std::string::npos, "state_restored");
		Expect(Lines[0].find("server_restored") == std::string::npos, "disconnect is not a restore");
		Expect(Lines[3].find("\"server_restored\":false") != std::string::npos, "server did not restore");
		Expect(Lines[3].find("\"restored_by\":\"local_snapshot\"") != std::string::npos, "local snapshot");
		Expect(Lines[3].find("\"leave_retry_would_apply\":true") != std::string::npos, "policy fact recorded");
		Expect(Lines[3].find("\"session_id\":null") != std::string::npos, "unknown session is null");
		Expect(Lines[3].find("\"x\":null") != std::string::npos, "unknown pose is null");
		ExpectOrder(Lines[3]);
	}

	FDropFacts Unknown;
	Unknown.TsMs = 1;
	const std::string Restored = DropLine(Unknown, kStateRestored, true);
	Expect(Restored.find("\"rejoin_404_replan\":null") != std::string::npos, "unread policy is null");
	Expect(Restored.find("\"leave_retry_would_apply\":null") != std::string::npos, "uncomputed retry is null");

	if (gFails != 0)
	{
		std::fprintf(stderr, "%d failed\n", gFails);
		return 1;
	}
	std::printf("mp_reliability_logic_test ok\n");
	return 0;
}

// WONDERLAND -- J1 mission-flow known-answer test. No Unreal, no network.
//
//   g++ -std=c++17 -Wall -Wextra -Werror -pedantic -Wshadow -I wonderland/Source/Wonderland -O2
//       wonderland/Tools/j1_mission_flow_kat.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionFlow.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.cpp
//       wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp
//       -o j1_mission_flow_kat && ./j1_mission_flow_kat
#include "WonderlandJuliusMissionFlow.h"

#include <cstdio>
#include <cstring>
#include <string>

namespace
{
	using namespace WonderlandJuliusMissionFlow;
	using WonderlandJuliusMissionLogic::EMissionProgress;
	using WonderlandJuliusMissionLogic::PollDispatchWatchMs;
	using WonderlandJuliusMissionLogic::PollHoldWatchMs;
	using WonderlandJuliusMissionLogic::PollSlowDelayMs;
	using WonderlandJuliusMissionLogic::ProgressDisplayLabel;

	int Failures = 0;
	int Meanings = 0;
	int Routes = 0;
	int Results = 0;
	int FlowSteps = 0;
	int Windows = 0;

	void Expect(bool bOk, const char* What)
	{
		if (!bOk)
		{
			++Failures;
			std::printf("FAIL %s\n", What);
		}
	}

	bool Same(const char* Left, const char* Right)
	{
		if (Left == nullptr || Right == nullptr) { return Left == Right; }
		return std::strcmp(Left, Right) == 0;
	}

	void ExpectProgress(EMissionProgress Meaning, EMissionProgress Shown, bool bPaid, bool bUnconfirmed, bool bNotStarted, bool bHeld, const char* What)
	{
		const FProgressPanel Panel = PanelForProgress(Meaning);
		++Meanings;
		Expect(Panel.Panel == EFlowPanel::Progress, What);
		Expect(Panel.bFinished == false, What);
		Expect(Same(Panel.Line, ProgressDisplayLabel(Shown)), What);
		Expect(Panel.bPaid == bPaid, What);
		Expect(Panel.bUnconfirmed == bUnconfirmed, What);
		Expect(Panel.bNotStarted == bNotStarted, What);
		Expect(Panel.bHeldAtDispatched == bHeld, What);
		Expect(Panel.bFault == false, What);
		Expect(Panel.bUsesWrapperLabel == false, What);
	}

	class FScriptReader final : public IMissionResultReader
	{
	public:
		mutable bool bCall = false;
		FResultRead Body;
		FResultRead Read(std::string_view) const override
		{
			bCall = true;
			return Body;
		}
	};

	const char* const WljOk = "wlj_0b1f3c2a-5d4e-4f60-8a71-92b3c4d5e6f7";
	const char* const RunLegacy = "run:0123456789abcdef01234567";
}

int main()
{
	using E = EMissionProgress;
	ExpectProgress(E::AwaitingDispatchAnswer, E::AwaitingDispatchAnswer, false, false, false, false, "awaiting");
	ExpectProgress(E::AdmittedHeld, E::AdmittedHeld, false, false, false, false, "admitted");
	ExpectProgress(E::OperatorStarted, E::OperatorStarted, true, false, false, true, "dispatched");
	ExpectProgress(E::DispatchUnconfirmed, E::DispatchUnconfirmed, false, true, false, false, "unconfirmed");
	ExpectProgress(E::Dispatched, E::OperatorStarted, false, false, false, true, "julius-dispatched");
	ExpectProgress(E::Running, E::OperatorStarted, false, false, false, true, "running-meaning");
	ExpectProgress(E::Paused, E::OperatorStarted, false, false, false, true, "paused");
	ExpectProgress(E::Waiting, E::Waiting, false, false, false, false, "unknown");
	ExpectProgress(E::Succeeded, E::OperatorStarted, false, false, false, true, "succeeded");
	ExpectProgress(E::Failed, E::OperatorStarted, false, false, false, true, "failed-meaning");
	ExpectProgress(E::Refused, E::Refused, false, false, false, false, "refused");
	ExpectProgress(E::DispatchFailed, E::DispatchFailed, false, false, false, false, "dispatch-failed");
	ExpectProgress(E::NotStarted, E::NotStarted, false, false, true, false, "expired");
	ExpectProgress(E::RunIdMismatch, E::RunIdMismatch, false, false, false, false, "mismatch");
	ExpectProgress(E::AnswerInvalid, E::AnswerInvalid, false, false, false, false, "invalid");
	ExpectProgress(E::PollLimitReached, E::PollLimitReached, false, false, false, false, "poll-limit");
	ExpectProgress(E::AlreadySpent, E::AlreadySpent, false, false, false, false, "already-spent");
	Expect(Meanings == 17, "every progress meaning");

	const FProgressPanel Unknown = PanelForProgress(E::Waiting);
	Expect(Unknown.bFinished == false, "unknown is not finished");
	Expect(Same(Unknown.Line, ProgressDisplayLabel(E::Waiting)), "unknown line");
	Expect(!Same(Unknown.Line, ProgressDisplayLabel(E::Succeeded)), "unknown is not succeeded");
	const FProgressPanel Expired = PanelForProgress(E::NotStarted);
	Expect(Expired.bNotStarted, "expired shows NotStarted");
	Expect(Same(Expired.Line, ProgressDisplayLabel(E::NotStarted)), "expired line");
	Expect(!Same(Expired.Line, ProgressDisplayLabel(E::Succeeded)), "expired is not succeeded");
	Expect(Expired.bFinished == false, "expired is not finished");

	const char* Words[] = {"", "unknown", "running", "completed", "expired"};
	for (const char* Word : Words)
	{
		const FProgressPanel Panel = PanelForStatusRouteWord(Word);
		++Routes;
		Expect(Panel.bFinished == false, Word);
		if (std::strcmp(Word, "running") == 0 || std::strcmp(Word, "completed") == 0)
		{
			Expect(Panel.bFault, Word);
			Expect(Panel.bPaid == false, Word);
			Expect(Same(Panel.Line, ProgressDisplayLabel(E::OperatorStarted)), Word);
		}
		else
		{
			Expect(Panel.bFault == false, Word);
			Expect(Same(Panel.Line, ProgressDisplayLabel(E::Waiting)), Word);
			Expect(Panel.bNotStarted == false, Word);
		}
	}

	const char* Tokens[] = {
		"idle", "dispatching", "admitted_waiting", "still_waiting", "queued_busy", "running", "completed",
		"refused", "failed", "operator_started", "dispatch_unconfirmed", "not_started",
	};
	for (const char* Token : Tokens)
	{
		const FProgressPanel Panel = PanelForWrapperToken(Token);
		Expect(Panel.bFinished == false, Token);
		if (std::strcmp(Token, "running") == 0 || std::strcmp(Token, "completed") == 0)
		{
			Expect(Panel.bFault, Token);
			Expect(Panel.bPaid == false, Token);
		}
		if (std::strcmp(Token, "not_started") == 0)
		{
			Expect(Panel.bNotStarted, Token);
			Expect(Same(Panel.Line, ProgressDisplayLabel(E::NotStarted)), Token);
		}
		if (std::strcmp(Token, "dispatch_unconfirmed") == 0)
		{
			Expect(Panel.bUnconfirmed, Token);
			Expect(Panel.bPaid == false, Token);
			Expect(Same(Panel.Line, ProgressDisplayLabel(E::DispatchUnconfirmed)), Token);
		}
		if (std::strcmp(Token, "operator_started") == 0)
		{
			Expect(Panel.bPaid, Token);
			Expect(Same(Panel.Line, ProgressDisplayLabel(E::OperatorStarted)), Token);
		}
		if (std::strcmp(Token, "idle") == 0 || std::strcmp(Token, "still_waiting") == 0
			|| std::strcmp(Token, "queued_busy") == 0 || std::strcmp(Token, "failed") == 0)
		{
			Expect(Panel.bUsesWrapperLabel, Token);
			Expect(Panel.Line == nullptr, Token);
		}
	}

	Expect(ResultPanelFor(FResultRead{}).bShowsArtifact == false, "no result artifact");
	Expect(Same(ResultPanelFor(FResultRead{}).Line, CopyNoResultYet), "no result line");
	++Results;
	FResultRead Unverified;
	Unverified.bReported = true;
	Unverified.bVerified = false;
	const FResultPanel ShownFalse = ResultPanelFor(Unverified);
	Expect(ShownFalse.bReported && ShownFalse.bVerified == false && ShownFalse.bShowsArtifact == false, "verified false");
	Expect(Same(ShownFalse.Line, CopyVerifiedFalse), "verified false line");
	++Results;
	FResultRead Verified;
	Verified.bReported = true;
	Verified.bVerified = true;
	const FResultPanel ShownTrue = ResultPanelFor(Verified);
	Expect(ShownTrue.bShowsArtifact && ShownTrue.bVerified, "verified artifact");
	Expect(Same(ShownTrue.Line, CopyVerifiedTrue), "verified true line");
	Expect(!Same(ShownTrue.Line, CopyNoResultYet), "verified is not a synthesized absence");
	++Results;

	Expect(BridgeOperatorWindowMs == 360ull * 60ull * 1000ull, "bridge window is 360 min");
	Expect(PollHoldWatchMs == 362ull * 60ull * 1000ull, "client hold is 362 min");
	Expect(BridgeOperatorWindowMs + static_cast<std::uint64_t>(PollSlowDelayMs) == PollHoldWatchMs, "hold is window plus one slow poll");
	Expect(BridgeOperatorWindowMs != PollHoldWatchMs, "window and hold differ");
	Expect(PollDispatchWatchMs == BridgeOperatorWindowMs, "dispatch watch shares the length, not the clock");
	Expect(std::strstr(CopyBridgeWindow, "360") != nullptr, "confirm names 360");
	Expect(std::strstr(CopyClientHold, "362") != nullptr, "confirm names 362");
	Expect(std::strstr(CopyPaidOnDispatch, "only paid once the bridge reports dispatch") != nullptr, "paid once dispatch is reported");
	Expect(std::strstr(CopyPaidNature, "paid") != nullptr, "confirm names the paid nature");
	Windows = 2;

	FMissionFlow Flow;
	Flow.SetOffers({FMissionOffer{"julius-first-live", "First live mission"}});
	FFlowView Idle = Flow.View();
	Expect(Idle.Step == EFlowStep::AtTerminal && !Idle.bShowChoice && !Idle.bShowResult, "at the terminal");
	++FlowSteps;
	Flow.InteractWithTerminal();
	Expect(Flow.View().bShowChoice && !Flow.View().bShowConfirm && !Flow.View().bShowProgress, "choice");
	++FlowSteps;
	Expect(Flow.ChooseMission("other") == false, "unknown mission");
	Expect(Flow.Confirm().bSend == false, "confirm before a choice");
	++FlowSteps;
	Expect(Flow.ChooseMission("julius-first-live"), "choose");
	const FFlowView Confirm = Flow.View();
	Expect(Confirm.bShowConfirm && Confirm.bShowChoice && !Confirm.bShowResult, "confirm screen");
	Expect(Same(Confirm.PaidNature, CopyPaidNature), "paid nature");
	Expect(Same(Confirm.PaidOnDispatch, CopyPaidOnDispatch), "paid on dispatch");
	++FlowSteps;
	const FDispatchIntent Intent = Flow.Confirm();
	Expect(Intent.bSend && Intent.MissionId == "julius-first-live", "dispatch intent");
	Expect(Flow.View().Step == EFlowStep::Confirming, "intent does not pretend the wrapper sent");
	Flow.NoteDispatchHandedToWrapper(false);
	Expect(Flow.View().bDispatchHanded == false, "rejected handoff");
	Flow.NoteDispatchHandedToWrapper(true);
	const FFlowView Watching = Flow.View();
	Expect(Watching.bShowProgress && Watching.bShowResult && Watching.bDispatchHanded, "watching");
	Expect(Watching.Progress.bFinished == false, "fresh watch is not finished");
	Expect(Same(Watching.Result.Line, CopyNoResultYet), "no result yet");
	Expect(Watching.Result.bShowsArtifact == false, "no artifact yet");
	++FlowSteps;
	Flow.NoteProgress(E::Succeeded);
	Expect(Flow.View().Progress.bFinished == false, "succeeded meaning is not finished");
	Expect(Same(Flow.View().Progress.Line, ProgressDisplayLabel(E::OperatorStarted)), "succeeded holds at dispatched");
	Expect(Same(Flow.View().Result.Line, CopyNoResultYet), "succeeded does not synthesize a result");
	++FlowSteps;
	Flow.NoteStatusRouteWord("completed");
	Expect(Flow.View().Progress.bFault && Flow.View().Progress.bFinished == false, "completed is a fault");
	++FlowSteps;
	Flow.NoteStatusRouteWord("running");
	Expect(Flow.View().Progress.bFault && Flow.View().Progress.bPaid == false, "running is a fault");
	++FlowSteps;
	Flow.NoteClientRunId(RunLegacy);
	Expect(Flow.View().bRunIdOk == false, "legacy id is not the minted id");
	FScriptReader Eager;
	Eager.Body.bReported = true;
	Eager.Body.bVerified = true;
	Flow.NoteResult(Eager);
	Expect(Eager.bCall == false, "reader is not called without a wlj_ id");
	Expect(Flow.View().Result.bShowsArtifact == false, "bad id shows no artifact");
	++FlowSteps;
	Flow.NoteClientRunId(WljOk);
	Flow.NoteResult(Eager);
	Expect(Eager.bCall, "reader is called for the minted id");
	Expect(Flow.View().Result.bShowsArtifact, "verified read shows the artifact slot");
	Expect(Same(Flow.View().Result.Line, CopyVerifiedTrue), "verified read line");
	++FlowSteps;
	Eager.bCall = false;
	Eager.Body.bVerified = false;
	Flow.NoteResult(Eager);
	Expect(Flow.View().Result.bShowsArtifact == false, "verified false shows no artifact");
	Expect(Same(Flow.View().Result.Line, CopyVerifiedFalse), "verified false line");
	++FlowSteps;
	FAbsentResultReader Absent;
	Flow.NoteResult(Absent);
	Expect(Same(Flow.View().Result.Line, CopyNoResultYet) && Flow.View().Result.bShowsArtifact == false, "absent reader");
	++FlowSteps;

	if (Failures != 0)
	{
		std::printf("J1 MISSION FLOW KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::printf(
		"J1 MISSION FLOW KAT PASS meanings=%d route=%d result=%d flow=%d windows=%d\n",
		Meanings, Routes, Results, FlowSteps, Windows);
	return 0;
}

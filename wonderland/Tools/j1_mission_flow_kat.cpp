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
	int Bridge = 0;
	int PhaseCases = 0;

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

	bool HasLine(const FResultPanel& Panel, const char* Line)
	{
		if (Line == nullptr) { return false; }
		for (const std::string& Row : Panel.Lines)
		{
			if (Row == Line) { return true; }
		}
		return false;
	}

	bool ContainsText(const FResultPanel& Panel, const char* Piece)
	{
		if (Piece == nullptr) { return false; }
		if (Panel.Line != nullptr && std::strstr(Panel.Line, Piece) != nullptr) { return true; }
		for (const std::string& Row : Panel.Lines)
		{
			if (Row.find(Piece) != std::string::npos) { return true; }
		}
		return false;
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

	// Verbatim from relay-bridge/wonderland-mission-result-route.test.ts
	// blob 46b8b095e4aa923fa1cb49333076f83f9918e45e
	// commit 7e71a122fe03a2538904ab4b8651e034dcf2c1f3
	// completionValue(), lines 102-161. The route does not echo traceId 'f'*32,
	// providerMessageId, or the secret fields. Those stay in this excerpt only.
	const char* const VerbatimCompletionValue = R"BRIDGE(function completionValue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    juliusFinalState: 'COMPLETED',
    spendTag: {
      schema: 'julius-run-spent.v1',
      run: RUN,
      namespace: 'julius-live-mission-5',
      reservedUsdMicros: 30_000_000,
      workflowRunId: '4242',
      workflowRunAttempt: '1',
      headSha: SHA,
    },
    spendAccounting: {
      knownUsdMicros: 30_000_000,
      unknownCostComponents: 0,
      unverifiableApiSpend: false,
      spendVerified: true,
    },
    coderCost: {
      costUsdMicros: 608861,
      costBasis: 'PROVIDER_REPORTED',
      executionCostUsdMicros: null,
      billingPath: 'API_BILLED',
    },
    missionCost: {
      knownUsdMicros: 608861,
      unknownComponents: 2,
      complete: false,
    },
    providerReceipt: {
      providerRequestId: 'req_0123456789abcdef',
      responseId: 'req_0123456789abcdef',
      providerMessageId: 'msg_does_not_count',
      providerRequestAvailability: 'CAPTURED',
      providerRequestUnavailableReason: null,
    },
    archive: {
      artifactName: 'julius-live-evidence',
      artifactDigest: DIGEST,
      fileCount: 1,
      totalBytes: 12,
      conclusion: 'success',
      failedSteps: [],
      files: [{ path: 'tasks.tsv', sha256: DIGEST, kind: 'table' }],
    },
    workArtifactRefs: [`artifact:julius-work-artifact.v1:${RUN}:build-1:g1:DIFF`],
    projectBrainRevision: 3,
    phases: [
      { role: 'PROMPT_ARCHITECT', state: 'IDLE', stage: 'plan', attempt: 1, knownUsdMicros: null, costComplete: false },
      { role: 'CODING_AGENT', state: 'IDLE', stage: 'build', attempt: 1, knownUsdMicros: 608861, costComplete: true },
      { role: 'INDEPENDENT_REVIEWER', state: 'IDLE', stage: null, attempt: 1, knownUsdMicros: null, costComplete: false },
    ],
    traceId: 'f'.repeat(32),
    traceparent: `00-${'f'.repeat(32)}-${'a'.repeat(16)}-01`,
    apiKey: SECRET,
    token: 'ghp_FAKETESTNOTREAL', // relay-boundary:allow-fixture — synthetic
    password: 'super-secret-password',
    ...over,
  };
})BRIDGE";

	const char* const BridgeRun = "wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d";
	const char* const OtherRun = "wlj_11111111-2222-4333-8444-555555555555";
	const char* const BridgeTrace = "0ef34f0df7cf2cf89b844dcfa5fe084f";
	const char* const ReaderTrace = "ffffffffffffffffffffffffffffffff";
	const char* const When = "2026-10-23T17:18:00.000Z";

	std::string Repeat(char C, int Count)
	{
		return std::string(static_cast<std::size_t>(Count), C);
	}

	std::string SpendTag(const char* Run, const char* Schema)
	{
		return std::string("{\"schema\":\"") + Schema + "\",\"run\":\"" + Run
			+ "\",\"namespace\":\"julius-live-mission-5\",\"reservedUsdMicros\":30000000,"
			"\"workflowRunId\":\"4242\",\"workflowRunAttempt\":\"1\",\"headSha\":\""
			+ Repeat('a', 40) + "\"}";
	}

	std::string ArchiveJson(const char* DigestOrNull)
	{
		const std::string FileSha = Repeat('b', 64);
		const std::string Digest = DigestOrNull == nullptr ? std::string("null") : std::string("\"") + DigestOrNull + "\"";
		return std::string("{\"artifactName\":\"julius-live-evidence\",\"artifactDigest\":") + Digest
			+ ",\"fileCount\":1,\"totalBytes\":12,\"conclusion\":\"success\",\"failedSteps\":[],\"files\":[{\"path\":\"tasks.tsv\",\"sha256\":\""
			+ FileSha + "\",\"kind\":\"table\"}]}";
	}

	std::string CompletionJson(const char* FinalState, const char* Run, const char* Schema, const char* CoderMicros, const char* DigestOrNull, const char* Trace, const char* ReceiptExtra, const char* Tail)
	{
		std::string Receipt = std::string("{\"providerRequestId\":\"req_0123456789abcdef\",\"responseId\":\"req_0123456789abcdef\"");
		if (ReceiptExtra != nullptr) { Receipt += ReceiptExtra; }
		Receipt += ",\"providerRequestAvailability\":\"CAPTURED\",\"providerRequestUnavailableReason\":null}";
		std::string Out = std::string("{\"juliusFinalState\":\"") + FinalState + "\"";
		if (Schema != nullptr)
		{
			Out += std::string(",\"spendTag\":") + SpendTag(Run, Schema);
		}
		Out += std::string(",\"spendAccounting\":{\"knownUsdMicros\":30000000,\"unknownCostComponents\":0,\"unverifiableApiSpend\":false,\"spendVerified\":true}")
			+ ",\"coderCost\":{\"costUsdMicros\":" + CoderMicros + ",\"costBasis\":\"PROVIDER_REPORTED\",\"executionCostUsdMicros\":null,\"billingPath\":\"API_BILLED\"}"
			+ ",\"missionCost\":{\"knownUsdMicros\":608861,\"unknownComponents\":2,\"complete\":false}"
			+ ",\"providerReceipt\":" + Receipt
			+ ",\"archive\":" + ArchiveJson(DigestOrNull)
			+ ",\"workArtifactRefs\":[\"artifact:julius-work-artifact.v1:" + Run + ":build-1:g1:DIFF\"]"
			+ ",\"projectBrainRevision\":3,\"traceId\":\"" + Trace + "\",\"traceparent\":null";
		if (Tail != nullptr) { Out += Tail; }
		Out += "}";
		return Out;
	}

	std::string ResultJson(const char* Wlj, const char* State, const char* TraceJson, const char* Cause, const char* Completion, const char* Extra)
	{
		std::string Out = std::string("{\"wljRunId\":\"") + Wlj + "\",\"serverRunId\":\"" + Wlj
			+ "\",\"legacyRunId\":null,\"traceId\":" + TraceJson + ",\"state\":\"" + State
			+ "\",\"updatedAt\":\"" + When + "\",\"dispatchedAt\":";
		if (std::strcmp(State, "dispatched") == 0 || std::strcmp(State, "completed") == 0)
		{
			Out += std::string("\"") + When + "\"";
		}
		else
		{
			Out += "null";
		}
		if (Cause != nullptr)
		{
			Out += std::string(",\"cause\":\"") + Cause + "\"";
		}
		if (Extra != nullptr) { Out += Extra; }
		Out += ",\"completion\":";
		Out += Completion == nullptr ? "null" : Completion;
		Out += "}";
		return Out;
	}

	std::string ProgressJson(const char* Wlj, const char* State, const char* TraceJson, const char* Phases)
	{
		return std::string("{\"wljRunId\":\"") + Wlj + "\",\"serverRunId\":\"" + Wlj
			+ "\",\"legacyRunId\":null,\"traceId\":" + TraceJson + ",\"state\":\"" + State
			+ "\",\"updatedAt\":\"" + When + "\",\"phases\":" + (Phases == nullptr ? "null" : Phases) + "}";
	}

	FResultRead Load(const std::string& Result, const std::string& Progress, int ResultStatus = 200, int ProgressStatus = 200)
	{
		FBridgeMissionResultClient Client;
		Client.SetResultResponse(ResultStatus, Result);
		if (!Progress.empty()) { Client.SetProgressResponse(ProgressStatus, Progress); }
		return Client.Read(BridgeRun);
	}

	FFlowView WatchRead(const FResultRead& Read)
	{
		FMissionFlow Flow;
		Flow.SetOffers({FMissionOffer{"julius-first-live", "First live mission"}});
		Flow.InteractWithTerminal();
		Flow.ChooseMission("julius-first-live");
		Flow.NoteDispatchHandedToWrapper(true);
		Flow.NoteClientRunId(BridgeRun);
		FScriptReader Reader;
		Reader.Body = Read;
		Flow.NoteResult(Reader);
		return Flow.View();
	}

	void ExpectHidden(const FResultPanel& Panel, const char* What)
	{
		Expect(Panel.bVerified == false && Panel.bFinished == false && Panel.bShowsArtifact == false, What);
		Expect(Same(Panel.Line, CopyNoResultYet), What);
		Expect(!ContainsText(Panel, "archive.artifactName"), What);
		Expect(!ContainsText(Panel, "coderCost.costUsdMicros"), What);
		Expect(!ContainsText(Panel, "608861"), What);
		Expect(!ContainsText(Panel, "30000000"), What);
	}


	// d9880ad4 relay-bridge/julius-mission-evidence.conformance.test.ts, verbatim (BRIDGE's vectors for #448).
	const char* const VerbatimPhaseVectors = R"BRIDGE(const CODER_PHASE = {
  role: 'CODING_AGENT',
  state: 'IDLE',
  stage: 'repair:build',
  attempt: 2,
  spanId: null,
  traceparent: null,
  knownUsdMicros: 1000,
  costComplete: true,
} as const;

const ABSENT_PHASE = {
  state: 'NEVER_DISPATCHED',
  stage: null,
  attempt: null,
  spanId: null,
  traceparent: null,
  knownUsdMicros: 0,
  costComplete: true,
} as const;
    for (const projectBrainRevision of [null, '', 'nope', -1, 1.5, false]) {
      [{ role: 'CODING_AGENT', ...ABSENT_PHASE, state: 'ACTIVE' }],
      [],
      PRESENT_PHASES.map((phase) => ({ ...phase, spanId: 'a'.repeat(16) })),
      PRESENT_PHASES.map((phase) => ({ ...phase, knownUsdMicros: null })),
      PRESENT_PHASES.map((phase, index) => index === 1 ? { ...phase, stage: 'checkpoint' } : phase),
    expect(accepted).toEqual({ completion: null, phases: null });)BRIDGE";

	std::string AbsentSlot(const char* Role, const char* SpanJson = "null", const char* CostJson = "0", const char* StageJson = "null")
	{
		return std::string("{\"role\":\"") + Role + "\",\"state\":\"NEVER_DISPATCHED\",\"stage\":" + StageJson
			+ ",\"attempt\":null,\"spanId\":" + SpanJson + ",\"traceparent\":null,\"knownUsdMicros\":" + CostJson + ",\"costComplete\":true}";
	}

	std::string CoderSlot(const char* SpanJson = "null", const char* CostJson = "1000", const char* StageJson = "\"repair:build\"")
	{
		return std::string("{\"role\":\"CODING_AGENT\",\"state\":\"IDLE\",\"stage\":") + StageJson
			+ ",\"attempt\":2,\"spanId\":" + SpanJson + ",\"traceparent\":null,\"knownUsdMicros\":" + CostJson + ",\"costComplete\":true}";
	}

	std::string PresentPhases()
	{
		return "[" + AbsentSlot("PROMPT_ARCHITECT") + "," + CoderSlot() + "," + AbsentSlot("INDEPENDENT_REVIEWER") + "]";
	}

	std::string HeaderOnlyPhases()
	{
		return "[" + AbsentSlot("PROMPT_ARCHITECT") + "," + AbsentSlot("CODING_AGENT") + "," + AbsentSlot("INDEPENDENT_REVIEWER") + "]";
	}

	std::string Replaced(std::string Text, const std::string& From, const std::string& To)
	{
		const std::size_t At = Text.find(From);
		if (At != std::string::npos) { Text.replace(At, From.size(), To); }
		return Text;
	}

	const char* const AccountingObject = "\"spendAccounting\":{\"knownUsdMicros\":30000000,\"unknownCostComponents\":0,\"unverifiableApiSpend\":false,\"spendVerified\":true}";

	// The #454 completion: spendAccounting null, the revision and the phase list carried inside the completion too.
	// PhasesJson nullptr leaves the completion's phases key out.
	std::string Completion454(const char* Revision, const char* PhasesJson, const char* Schema = "julius-run-spent.v1", const char* FinalState = "COMPLETED")
	{
		const std::string Digest = Repeat('b', 64);
		std::string Out = CompletionJson(FinalState, BridgeRun, Schema, "1000", Digest.c_str(), BridgeTrace, nullptr, nullptr);
		Out = Replaced(Out, AccountingObject, "\"spendAccounting\":null");
		std::string Tail = std::string(",\"projectBrainRevision\":") + Revision;
		if (PhasesJson != nullptr) { Tail += std::string(",\"phases\":") + PhasesJson; }
		return Replaced(Out, ",\"projectBrainRevision\":3", Tail);
	}

	std::string Result454(const char* State, const std::string& Completion, const char* PhasesJson, const char* Revision, const char* Cause = nullptr)
	{
		const std::string TraceJson = std::string("\"") + BridgeTrace + "\"";
		const std::string Extra = std::string(",\"phases\":") + PhasesJson + ",\"projectBrainRevision\":" + Revision;
		return ResultJson(BridgeRun, State, TraceJson.c_str(), Cause, Completion.empty() ? nullptr : Completion.c_str(), Extra.c_str());
	}

	std::string Progress454(const char* State, const char* PhasesJson, const char* Revision)
	{
		const std::string TraceJson = std::string("\"") + BridgeTrace + "\"";
		const std::string Body = ProgressJson(BridgeRun, State, TraceJson.c_str(), PhasesJson);
		return Body.substr(0, Body.size() - 1) + ",\"projectBrainRevision\":" + Revision + "}";
	}

	// One d9880ad4 read: the same phases and revision on /result, inside completion, and on /progress.
	FResultRead Load454(const char* PhasesJson, const char* Revision)
	{
		return Load(Result454("completed", Completion454(Revision, PhasesJson), PhasesJson, Revision), Progress454("completed", PhasesJson, Revision));
	}

	bool HasPrefix(const FResultPanel& Panel, const char* Prefix)
	{
		for (const std::string& Line : Panel.Lines)
		{
			if (Line.rfind(Prefix, 0) == 0) { return true; }
		}
		return false;
	}

	const char* const PresentArchitectLine = "phase PROMPT_ARCHITECT: NEVER_DISPATCHED, stage Unknown, attempt Unknown, knownUsdMicros 0, costComplete true";
	const char* const PresentCoderLine = "phase CODING_AGENT: IDLE, stage repair:build, attempt 2, knownUsdMicros 1000, costComplete true";
	const char* const PresentReviewerLine = "phase INDEPENDENT_REVIEWER: NEVER_DISPATCHED, stage Unknown, attempt Unknown, knownUsdMicros 0, costComplete true";
	const char* const HeaderCoderLine = "phase CODING_AGENT: NEVER_DISPATCHED, stage Unknown, attempt Unknown, knownUsdMicros 0, costComplete true";

	void ExpectNoPhases(const FResultPanel& Panel, const char* What)
	{
		Expect(!HasPrefix(Panel, "phase "), What);
		Expect(!ContainsText(Panel, "NEVER_DISPATCHED"), What);
		Expect(!ContainsText(Panel, "repair:build"), What);
	}

	void ExpectUnverifiedHidesPhases(const FResultRead& Read, const char* What)
	{
		const FResultPanel Panel = ResultPanelFor(Read);
		ExpectHidden(Panel, What);
		ExpectNoPhases(Panel, What);
		Expect(!HasPrefix(Panel, "phases:"), What);
		Expect(!HasPrefix(Panel, "projectBrainRevision"), What);
	}

	// LIVE RUN EVENTS: contract with MAIN JULIUS (2026-10-25). LIVE is the server's fact; phases are samples.
	int LiveCases = 0;
	const char* const LiveWlj = "wlj_0f8fad5b-d9cb-469f-a165-70867728950e";

	std::string LiveBody(const std::string& Top, const std::string& Events)
	{
		return std::string("{\"wljRunId\":\"") + LiveWlj + "\"," + Top + ",\"events\":[" + Events + "]}";
	}

	const char* const LiveTop =
		"\"workflowRunId\":\"18733051234\",\"source\":\"github_actions\",\"reason\":null,\"live\":true,\"stale\":false,"
		"\"mode\":\"paid\",\"runStatus\":\"in_progress\",\"runConclusion\":null,\"fetchedAt\":\"2026-10-25T18:00:00Z\",\"next\":\"c7\"";
	const char* const LiveStep =
		"{\"seq\":3,\"at\":\"2026-10-25T18:00:01Z\",\"kind\":\"step\",\"job\":\"Preflight, then the live mission\","
		"\"name\":\"LIVE: run the first real Julius mission\",\"status\":\"in_progress\",\"conclusion\":null}";
	const char* const LivePhase =
		"{\"seq\":4,\"at\":\"2026-10-25T18:00:11Z\",\"kind\":\"phase\",\"role\":\"coder\",\"taskType\":\"repair_build\","
		"\"state\":\"active\",\"ordinal\":5,\"repairCycle\":1,\"sampled\":true}";

	bool PanelHas(const FLivePanel& Panel, const char* Piece)
	{
		if (Panel.Header.find(Piece) != std::string::npos) { return true; }
		for (const std::string& Line : Panel.Lines)
		{
			if (Line.find(Piece) != std::string::npos) { return true; }
		}
		return false;
	}

	std::string Swap(std::string Text, const std::string& From, const std::string& To)
	{
		const std::size_t At = Text.find(From);
		if (At != std::string::npos) { Text.replace(At, From.size(), To); }
		return Text;
	}

	/** The page was read, exactly one event was skipped as unreadable, and nothing unreadable was kept. */
	bool EventSkipped(const FLiveRead& Read)
	{
		return Read.bParsed && Read.SkippedSeqs.size() == 1;
	}

	void LiveFixtures()
	{
		const std::string Good = LiveBody(LiveTop, std::string(LiveStep) + "," + LivePhase);
		const FLiveRead Read = ParseLiveEvents(LiveWlj, 200, Good);
		Expect(Read.bParsed && Read.bLive && !Read.bStale && Read.Mode == ELiveMode::Paid, "live paid read parses");
		Expect(Read.Events.size() == 2 && Read.Events[1].RepairCycle == 1 && Read.Next == "c7", "live events and cursor");
		++LiveCases;
		FLiveFeed Feed;
		Feed.Apply(Read);
		const FLivePanel Panel = LivePanelFor(Feed, 0);
		Expect(Panel.bShow && Panel.bLive && PanelHas(Panel, "LIVE -- the paid run is executing"), "live paid header");
		Expect(PanelHas(Panel, "GitHub Actions run 18733051234"), "header names the bound run");
		Expect(PanelHas(Panel, "now: coder / repair_build -- active (repair cycle 1 of 3)"), "now line from the latest sample");
		Expect(PanelHas(Panel, "sampled every ~10 s"), "phases are labelled as samples");
		Expect(PanelHas(Panel, "now running: Preflight, then the live mission / LIVE: run the first real Julius mission"), "real step names");
		Expect(PanelHas(Panel, "GitHub workflow steps (not mission progress): 0 of 1 finished"), "step count");
		Expect(Feed.Cursor() == "c7", "cursor kept");
		++LiveCases;

		// Reconnect: the same events again plus one new one append once (no duplicate).
		const std::string More = LiveBody(Swap(LiveTop, "\"c7\"", "\"c8\""), std::string(LivePhase) + ","
			"{\"seq\":5,\"at\":\"2026-10-25T18:00:21Z\",\"kind\":\"phase\",\"role\":\"reviewer\",\"taskType\":\"review\","
			"\"state\":\"active\",\"ordinal\":6,\"repairCycle\":0,\"sampled\":true}");
		Feed.Apply(ParseLiveEvents(LiveWlj, 200, More));
		Expect(Feed.Events().size() == 3 && Feed.Cursor() == "c8", "resume appends without duplicates");
		Expect(PanelHas(LivePanelFor(Feed, 0), "now: reviewer / review -- active"), "now follows the newest sample");
		++LiveCases;

		// A failed read keeps what was shown; a long gap says so.
		Feed.Apply(ParseLiveEvents(LiveWlj, 503, "{}"));
		Expect(Feed.IsLive() && Feed.Events().size() == 3, "failed read changes nothing");
		Expect(PanelHas(LivePanelFor(Feed, 25000), "no update for 25 s, reconnecting"), "client gap is shown");
		++LiveCases;

		FLiveFeed Stale;
		Stale.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(LiveTop, "\"stale\":false", "\"stale\":true"), LiveStep)));
		Expect(Stale.IsStale() && PanelHas(LivePanelFor(Stale, 0), "connection to GitHub lost, reconnecting"), "stale shown");
		++LiveCases;

		FLiveFeed Pre;
		Pre.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(LiveTop, "\"mode\":\"paid\"", "\"mode\":\"preflight\""), LiveStep)));
		Expect(PanelHas(LivePanelFor(Pre, 0), "LIVE -- PREFLIGHT (no paid calls)"), "preflight header");
		++LiveCases;

		// Recorded: never LIVE; a recorded body claiming live is refused whole.
		const std::string RecTop = Swap(Swap(LiveTop, "\"github_actions\"", "\"github_actions_recorded\""), "\"live\":true", "\"live\":false");
		FLiveFeed Rec;
		Rec.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(RecTop, LiveStep)));
		const FLivePanel RecPanel = LivePanelFor(Rec, 0);
		Expect(RecPanel.bShow && !RecPanel.bLive && !Rec.IsLive() && PanelHas(RecPanel, "RECORDED RUN, NOT LIVE"), "recorded is labelled");
		Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(LiveTop, "\"github_actions\"", "\"github_actions_recorded\""), LiveStep)).bParsed, "recorded+live refused");
		FLiveFeed RecDone;
		RecDone.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(RecTop, "\"runConclusion\":null", "\"runConclusion\":\"failure\""), LiveStep)));
		Expect(PanelHas(LivePanelFor(RecDone, 0), "RECORDED RUN, NOT LIVE (GitHub Actions run 18733051234) -- GitHub workflow conclusion: failure (not the mission result)"), "recorded shows GitHub's conclusion");
		++LiveCases;

		// Finished run: not live, conclusion shown; completed+live refused.
		const std::string DoneTop = Swap(Swap(Swap(LiveTop, "\"live\":true", "\"live\":false"), "\"in_progress\"", "\"completed\""), "\"runConclusion\":null", "\"runConclusion\":\"success\"");
		FLiveFeed Done;
		Done.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(DoneTop, LiveStep)));
		Expect(!Done.IsLive() && PanelHas(LivePanelFor(Done, 0), "GitHub workflow finished: success (workflow conclusion, not the mission result)"), "finished header");
		Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(LiveTop, "\"in_progress\"", "\"completed\""), LiveStep)).bParsed, "completed+live refused");
		Expect(!PanelHas(LivePanelFor(Done, 0), "last sampled:"), "no phase line without phases");
		++LiveCases;

		const std::string NoneTop = "\"workflowRunId\":null,\"source\":\"none\",\"reason\":\"run_mismatch\",\"live\":false,"
			"\"stale\":false,\"mode\":null,\"runStatus\":null,\"runConclusion\":null,\"fetchedAt\":\"x\",\"next\":null";
		FLiveFeed NoRun;
		NoRun.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(NoneTop, "")));
		Expect(PanelHas(LivePanelFor(NoRun, 0), "Live view unavailable: run_mismatch"), "none says why");
		FLiveFeed NotYet;
		NotYet.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(NoneTop, "run_mismatch", "not_dispatched"), "")));
		Expect(NotYet.HasRead() && !LivePanelFor(NotYet, 0).bShow, "not_dispatched adds nothing");
		Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(NoneTop, "run_mismatch", "because"), "")).bParsed, "unknown reason refused");
		Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(NoneTop, LiveStep)).bParsed, "none with events refused");
		Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(NoneTop, "\"live\":false", "\"live\":true"), "")).bParsed, "none+live refused");
		++LiveCases;

		struct FBad { const char* From; const char* To; const char* What; bool bEventOnly = false; };
		const FBad Bad[] = {
			{"\"sampled\":true", "\"sampled\":false", "unsampled phase", true},
			{",\"sampled\":true", "", "phase without sampled", true},
			{"\"repair_build\"", "\"rebuild\"", "unknown task type", true},
			{"\"state\":\"active\"", "\"state\":\"thinking\"", "unknown task state", true},
			{"\"coder\"", "\"grok\"", "unknown role", true},
			{"\"repairCycle\":1", "\"repairCycle\":4", "repair cycle above 3", true},
			{"\"kind\":\"step\"", "\"kind\":\"thought\"", "unknown kind", true},
			{"LIVE: run", "LIVE:\\u0007run", "control char in a name", true},
			{"\"status\":\"in_progress\",\"conclusion\"", "\"status\":\"running\",\"conclusion\"", "unknown step status", true},
			{"\"live\":true", "\"live\":\"yes\"", "live must be a bool"},
			{"\"mode\":\"paid\"", "\"mode\":\"free\"", "unknown mode"},
			{"\"18733051234\"", "\"18733x\"", "non-digit workflow id"},
			{"\"workflowRunId\":\"18733051234\"", "\"workflowRunId\":null", "live without a run"},
		};
		for (const FBad& Case : Bad)
		{
			const std::string Mutated = Swap(Good, Case.From, Case.To);
			// Founder ruling 2026-10-30: one bad EVENT field skips that event (named), never the page; a bad envelope
			// field still refuses the page.
			Expect(Mutated != Good && (Case.bEventOnly ? EventSkipped(ParseLiveEvents(LiveWlj, 200, Mutated)) : !ParseLiveEvents(LiveWlj, 200, Mutated).bParsed), Case.What);
			++LiveCases;
		}
		Expect(!ParseLiveEvents("wlj_11111111-2222-4333-8444-555555555555", 200, Good).bParsed, "another run's events refused");
		Expect(!ParseLiveEvents(LiveWlj, 404, Good).bParsed, "non-200 refused");
		++LiveCases;

		// Julius 2026-10-25 additions: null "at" for an unstarted step; reset:true restarts from seq 1; phase markers.
		Expect(ParseLiveEvents(LiveWlj, 200, Swap(Good, "\"at\":\"2026-10-25T18:00:01Z\"", "\"at\":null")).bParsed, "unstarted step has null at");
		Expect(EventSkipped(ParseLiveEvents(LiveWlj, 200, Swap(Good, ",\"at\":\"2026-10-25T18:00:01Z\"", ""))), "at is required");
		++LiveCases;
		FLiveFeed Reset;
		Reset.Apply(Read);
		Reset.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(std::string(LiveTop) + ",\"reset\":true",
			Swap(LiveStep, "\"seq\":3", "\"seq\":1"))));
		Expect(Reset.Events().size() == 1 && Reset.Events()[0].Seq == 1, "reset replaces the stream from seq 1");
		Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(std::string(LiveTop) + ",\"reset\":1", LiveStep)).bParsed, "reset must be a bool");
		++LiveCases;
		const std::string Idle = "{\"seq\":9,\"at\":\"2026-10-25T18:01:00Z\",\"kind\":\"phase\",\"marker\":\"idle\",\"role\":null,"
			"\"taskType\":null,\"state\":null,\"ordinal\":null,\"repairCycle\":null,\"sampled\":true}";
		FLiveFeed Marked;
		Marked.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, std::string(LivePhase) + "," + Idle)));
		Expect(Marked.Events().size() == 2 && PanelHas(LivePanelFor(Marked, 0), "now: between tasks (idle)"), "idle marker is the now line");
		FLiveFeed Ended;
		Ended.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(Idle, "\"idle\"", "\"ended\""))));
		const FLivePanel EndedPanel = LivePanelFor(Ended, 0);
		Expect(PanelHas(EndedPanel, "stream ended (only the result says") && !PanelHas(EndedPanel, "complete"), "ended is not completion");
		Expect(EventSkipped(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(Idle, "\"idle\"", "\"done\"")))), "unknown marker refused");
		Expect(EventSkipped(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(Idle, "\"role\":null", "\"role\":\"coder\"")))), "marker with task fields refused");
		Expect(EventSkipped(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(Idle, "\"sampled\":true", "\"sampled\":false")))), "marker must be sampled");
		Expect(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(LivePhase, ",\"sampled\"", ",\"marker\":null,\"sampled\""))).bParsed, "null marker is a task sample");
		++LiveCases;
		// GitHub's waiting/pending/requested pass through (rehearsal b refused every live page before this).
		for (const char* Word : {"waiting", "pending", "requested"})
		{
			const std::string Top = Swap(LiveTop, "\"runStatus\":\"in_progress\"", std::string("\"runStatus\":\"") + Word + "\"");
			const std::string Step = Swap(LiveStep, "\"status\":\"in_progress\"", std::string("\"status\":\"") + Word + "\"");
			FLiveFeed Waiting;
			Waiting.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Top, Step)));
			Expect(Waiting.IsLive() && PanelHas(LivePanelFor(Waiting, 0), "GitHub workflow steps (not mission progress): 0 of 1 finished"), Word);
		}
		Expect(!ParseLiveEvents(LiveWlj, 200, Swap(Good, "\"runStatus\":\"in_progress\"", "\"runStatus\":\"running\"")).bParsed, "unknown run status");
		++LiveCases;
		// Rehearsal b: a step reported pending, then in_progress, then completed is ONE step; pending ones are counted, not listed.
		{
			const std::string Pending = "{\"seq\":1,\"at\":null,\"kind\":\"step\",\"job\":\"J\",\"name\":\"A\",\"status\":\"pending\",\"conclusion\":null},"
				"{\"seq\":2,\"at\":null,\"kind\":\"step\",\"job\":\"J\",\"name\":\"B\",\"status\":\"pending\",\"conclusion\":null},"
				"{\"seq\":3,\"at\":\"2026-10-25T18:00:01Z\",\"kind\":\"step\",\"job\":\"J\",\"name\":\"A\",\"status\":\"in_progress\",\"conclusion\":null}";
			FLiveFeed Steps;
			Steps.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Pending)));
			FLivePanel P = LivePanelFor(Steps, 0);
			Expect(PanelHas(P, "now running: J / A") && PanelHas(P, "GitHub workflow steps (not mission progress): 0 of 2 finished") && !PanelHas(P, "J / B"), "running step first, pending counted");
			Steps.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(LiveTop, "\"c7\"", "\"c9\""),
				"{\"seq\":4,\"at\":\"2026-10-25T18:00:09Z\",\"kind\":\"step\",\"job\":\"J\",\"name\":\"A\",\"status\":\"completed\",\"conclusion\":\"success\"},"
				"{\"seq\":5,\"at\":\"2026-10-25T18:00:09Z\",\"kind\":\"step\",\"job\":\"J\",\"name\":\"B\",\"status\":\"in_progress\",\"conclusion\":null}")));
			P = LivePanelFor(Steps, 0);
			Expect(PanelHas(P, "now running: J / B") && !PanelHas(P, "now running: J / A"), "now running moves on");
			Expect(PanelHas(P, "GitHub workflow steps (not mission progress): 1 of 2 finished") && PanelHas(P, "  done: J / A (success)"), "finished step listed once");
			++LiveCases;
		}
		// A full page: 500 events parse (the shared 64-element JSON cap refused a real 106-event page), 501 do not.
		{
			std::string Many;
			for (int I = 1; I <= 501; ++I)
			{
				if (I > 1) { Many += ","; }
				// The phase shape is the widest event (11 values): a full page of them must fit the node budget too.
				Many += "{\"seq\":" + std::to_string(I) + ",\"at\":\"2026-10-25T18:00:11Z\",\"kind\":\"phase\",\"role\":\"coder\",\"taskType\":\"build\","
					"\"state\":\"active\",\"ordinal\":" + std::to_string(I) + ",\"repairCycle\":0,\"marker\":null,\"sampled\":true}";
			}
			const std::string Last = ",{\"seq\":501,";
			const std::string Page500 = LiveBody(LiveTop, Many.substr(0, Many.find(Last)));
			const FLiveRead Full = ParseLiveEvents(LiveWlj, 200, Page500);
			Expect(Full.bParsed && Full.Events.size() == 500, "a 500-event page parses");
			Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Many)).bParsed, "a 501-event page is refused");
			++LiveCases;
		}
		// REVIEW (c573b54e) MEDIUM-1: the bridge grammar's `other` role/state and `c x` (null cycle) are accepted, so one
		// such sample never freezes the view (a refused page is never applied and the cursor never advances).
		{
			const std::string Other = Swap(Swap(LivePhase, "\"coder\"", "\"other\""), "\"state\":\"active\"", "\"state\":\"other\"");
			const FLiveRead OtherRead = ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Other));
			Expect(OtherRead.bParsed && OtherRead.Events[0].Role == "other" && OtherRead.Events[0].State == "other", "role and state other");
			FLiveFeed OtherFeed;
			OtherFeed.Apply(OtherRead);
			Expect(PanelHas(LivePanelFor(OtherFeed, 0), "now: other / repair_build -- other"), "other is shown as other");
			const std::string NoCycle = Swap(LivePhase, "\"repairCycle\":1", "\"repairCycle\":null");
			const FLiveRead CxRead = ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, NoCycle));
			Expect(CxRead.bParsed && CxRead.Events[0].RepairCycle == -1, "c x (null cycle) parses");
			FLiveFeed CxFeed;
			CxFeed.Apply(CxRead);
			const FLivePanel CxPanel = LivePanelFor(CxFeed, 0);
			Expect(PanelHas(CxPanel, "(repair cycle not reported)") && !PanelHas(CxPanel, "of 3"), "null cycle is never a number");
			Expect(EventSkipped(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(LivePhase, "\"repairCycle\":1", "\"repairCycle\":\"x\"")))), "raw x is not the wire form");
			++LiveCases;
		}
		// REVIEW LOW: the kept cursor is exactly what the request will send (no space, not empty).
		Expect(!ParseLiveEvents(LiveWlj, 200, Swap(Good, "\"next\":\"c7\"", "\"next\":\"c 7\"")).bParsed, "cursor with a space refused");
		Expect(!ParseLiveEvents(LiveWlj, 200, Swap(Good, "\"next\":\"c7\"", "\"next\":\"\"")).bParsed, "empty cursor refused");
		++LiveCases;
		// The real folded step name from the workflow.
		Expect(ParseLiveEvents(LiveWlj, 200, Swap(Good, "LIVE: run the first real Julius mission", "Preflight complete - stopping here (no confirm_live given)")).bParsed, "real folded step name");
		++LiveCases;

		// A different workflow run is never merged into the shown one.
		FLiveFeed Swapped;
		Swapped.Apply(Read);
		Swapped.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(LiveTop, "18733051234", "18733059999"), LiveStep)));
		Expect(Swapped.WorkflowRunId() == "18733059999" && Swapped.Events().size() == 1, "new workflow run resets the feed");
		++LiveCases;
	}

	// IN-WONDERLAND START (founder P0 2026-10-25; REVIEW criteria 1, 4, 5): the one gate and the strict answer.
	int StartCases = 0;
	void StartFixtures()
	{
		using R = EStartRecord;
		const char* const Ok = "RUN LIVE MISSION";
		FStartGate G = StartGateFor("admitted_waiting", true, false, R::None, false, Ok);
		Expect(G.bOffer && !G.bSend, "start offered but never sent without the founder's click");
		Expect(!StartGateFor("admitted_waiting", true, false, R::None, false, "").bSend, "no start on open/poll/restore");
		Expect(StartGateFor("admitted_waiting", true, false, R::None, true, Ok).bSend, "click + exact phrase sends");
		Expect(!StartGateFor("admitted_waiting", true, false, R::None, true, "run live mission").bSend, "phrase is exact (case)");
		Expect(!StartGateFor("admitted_waiting", true, false, R::None, true, "RUN LIVE MISSION ").bSend, "phrase is exact (space)");
		Expect(!StartGateFor("admitted_waiting", true, false, R::None, true, "").bSend, "empty phrase never sends");
		++StartCases;
		for (const char* Token : {"operator_started", "running", "dispatching", "completed", "failed", "not_started", "idle", "dispatch_unconfirmed"})
		{
			const FStartGate Never = StartGateFor(Token, true, false, R::None, true, Ok);
			Expect(!Never.bOffer && !Never.bSend, Token);
		}
		++StartCases;
		const FStartGate Bound = StartGateFor("admitted_waiting", true, true, R::None, true, Ok);
		Expect(!Bound.bOffer && !Bound.bSend, "never start a run that already has a GitHub Actions run");
		for (const R Record : {R::Sending, R::Started, R::Refused})
		{
			const FStartGate Once = StartGateFor("admitted_waiting", true, false, Record, true, Ok);
			Expect(!Once.bOffer && !Once.bSend, "a recorded start (sending/started/refused) is never offered again");
		}
		Expect(StartGateFor("admitted_waiting", true, false, R::NotStarted, true, Ok).bSend, "a transient not-started may be re-sent on a click");
		Expect(!StartGateFor("admitted_waiting", false, false, R::None, true, Ok).bOffer, "no start without a paired session");
		++StartCases;

		const char* const W = "wlj_0f8fad5b-d9cb-469f-a165-70867728950e";
		const std::string Made = std::string("{\"wljRunId\":\"") + W + "\",\"state\":\"dispatched\",\"workflowRunId\":\"40242149156\",\"dispatchedAt\":\"2026-10-25T22:50:08.473Z\",\"replayed\":false}";
		FStartAnswer A = ParseStartAnswer(W, 202, Made);
		Expect(A.Outcome == EStartOutcome::Accepted && A.WorkflowRunId == "40242149156" && !A.bReplayed, "202 made the dispatch");
		A = ParseStartAnswer(W, 200, Swap(Made, "\"replayed\":false", "\"replayed\":true"));
		Expect(A.Outcome == EStartOutcome::Accepted && A.bReplayed, "200 replayed binds, never re-dispatches");
		A = ParseStartAnswer(W, 200, Swap(Swap(Swap(Made, "\"replayed\":false", "\"replayed\":true"), "\"dispatched\"", "\"dispatching\""), "\"40242149156\"", "null"));
		Expect(A.Outcome == EStartOutcome::Uncertain && A.WorkflowRunId.empty() && A.State == "dispatching", "dispatching is uncertain (A-9: never bound as started)");
		Expect(ParseStartAnswer(W, 200, Made).Outcome == EStartOutcome::Malformed, "200 must be a replay");
		Expect(ParseStartAnswer(W, 202, Swap(Made, "\"replayed\":false", "\"replayed\":true")).Outcome == EStartOutcome::Malformed, "202 is never a replay");
		Expect(ParseStartAnswer("wlj_11111111-2222-4333-8444-555555555555", 202, Made).Outcome == EStartOutcome::Malformed, "another run's answer is refused");
		Expect(ParseStartAnswer(W, 202, Swap(Made, "\"dispatched\"", "\"queued\"")).Outcome == EStartOutcome::Malformed, "unknown state refused");
		Expect(ParseStartAnswer(W, 202, Swap(Made, "\"40242149156\"", "\"4024x\"")).Outcome == EStartOutcome::Malformed, "non-digit run id refused");
		++StartCases;
		Expect(ParseStartAnswer(W, 409, "{\"error\":{\"kind\":\"already_spent\",\"message\":\"x\"},\"retry\":false}").Outcome == EStartOutcome::Refused, "409 claim refused");
		Expect(ParseStartAnswer(W, 400, "{\"error\":{\"kind\":\"julius_start_confirmation_required\",\"message\":\"x\"}}").Outcome == EStartOutcome::Refused, "400 refused");
		Expect(ParseStartAnswer(W, 404, "{\"error\":{\"kind\":\"not_found\",\"message\":\"x\"}}").Outcome == EStartOutcome::Refused, "404 refused");
		Expect(ParseStartAnswer(W, 503, "{\"error\":{\"kind\":\"julius_start_unavailable\"}}").Outcome == EStartOutcome::Uncertain, "M1: a 503 julius_start_unavailable is outcome-unknown");
		Expect(ParseStartAnswer(W, 0, "").Outcome == EStartOutcome::Retryable, "transport nothing dispatched");
		Expect(ParseStartAnswer(W, 401, "").Outcome == EStartOutcome::Retryable, "401 re-pair");
		Expect(ParseStartAnswer(W, 409, "{}").Outcome == EStartOutcome::Malformed, "a refusal without a kind is not understood");
		++StartCases;
	}

	// EXECUTION STATE (founder P0 2026-10-26; MAIN JULIUS's contract): dispatch is never execution; the outcome only from
	// /result; a run whose LIVE step never started DID NOT START; the contract fold gets each beat once, in order.
	int ExecCases = 0;
	std::string Step(int Seq, const char* Job, const char* Name, const char* Status, const char* Conclusion)
	{
		return std::string("{\"seq\":") + std::to_string(Seq) + ",\"at\":null,\"kind\":\"step\",\"job\":\"" + Job + "\",\"name\":\"" + Name
			+ "\",\"status\":\"" + Status + "\",\"conclusion\":" + (Conclusion == nullptr ? std::string("null") : std::string("\"") + Conclusion + "\"") + "}";
	}
	std::string Job(int Seq, const char* Name, const char* Status, const char* Conclusion)
	{
		return std::string("{\"seq\":") + std::to_string(Seq) + ",\"at\":null,\"kind\":\"job\",\"job\":\"" + Name + "\",\"name\":\"" + Name
			+ "\",\"status\":\"" + Status + "\",\"conclusion\":" + (Conclusion == nullptr ? std::string("null") : std::string("\"") + Conclusion + "\"") + "}";
	}
	std::string Phase(int Seq, const char* Role, const char* TaskType, int Cycle)
	{
		return std::string("{\"seq\":") + std::to_string(Seq) + ",\"at\":\"2026-10-26T02:30:00Z\",\"kind\":\"phase\",\"role\":\"" + Role + "\",\"taskType\":\"" + TaskType
			+ "\",\"state\":\"active\",\"ordinal\":" + std::to_string(Seq) + ",\"repairCycle\":" + std::to_string(Cycle) + ",\"sampled\":true}";
	}
	std::string Top(const char* RunStatus, const char* Conclusion, bool bLive, const char* Mode = "paid", const char* Workflow = "40258482240")
	{
		return std::string("\"workflowRunId\":\"") + Workflow + "\",\"source\":\"" + (bLive ? "github_actions" : "github_actions_recorded")
			+ "\",\"reason\":null,\"live\":" + (bLive ? "true" : "false") + ",\"stale\":false,\"mode\":\"" + Mode + "\",\"runStatus\":\"" + RunStatus
			+ "\",\"runConclusion\":" + (Conclusion == nullptr ? std::string("null") : std::string("\"") + Conclusion + "\"") + ",\"fetchedAt\":\"x\",\"next\":\"e1.1\"";
	}
	FExecutionView ViewOf(const std::string& Body, ECheckerVerdict Verdict = ECheckerVerdict::NotRun, bool bCompletion = false, const char* Bound = "40258482240",
		bool bNoVerdictIsFinal = true, const char* OutcomeUnknownCause = nullptr)
	{
		FLiveFeed Feed;
		Feed.Apply(ParseLiveEvents(LiveWlj, 200, Body));
		FVerdictRead Read;
		Read.Verdict = Verdict;
		Read.bHasCompletion = bCompletion;
		Read.bNoVerdictIsFinal = bNoVerdictIsFinal;
		Read.bOutcomeUnknown = OutcomeUnknownCause != nullptr;
		Read.OutcomeUnknownCause = OutcomeUnknownCause != nullptr ? OutcomeUnknownCause : "";
		return ExecutionViewFor(Feed, true, Bound, Read);
	}
	void ExecFixtures()
	{
		const char* const PJ = "Preflight, then the live mission";
		const char* const LS = "LIVE: run the first real Julius mission";
		const std::string Gates = Job(1, "spend-tag", "completed", "success") + "," + Job(2, "paid-slot", "in_progress", nullptr);
		FExecutionView V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates));
		Expect(V.Phase == EExecutionPhase::Starting, "gates running is STARTING, never executing (live:true is not execution)");
		V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(3, PJ, "Record that a paid mission was attempted (before any provider can be reached)", "completed", "success")));
		Expect(V.Phase == EExecutionPhase::Committing, "attempt recorded is COMMITTING, still not executing");
		V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(3, PJ, "Preflight: each provider accepts its credential", "completed", "success")));
		Expect(V.Phase == EExecutionPhase::Starting, "provider preflight is not execution");
		++ExecCases;
		V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(4, PJ, LS, "in_progress", nullptr)));
		Expect(V.Phase == EExecutionPhase::Executing && V.Role.empty(), "LIVE step in_progress is EXECUTING");
		V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Phase(5, "coder", "build", 0)));
		Expect(V.Phase == EExecutionPhase::Executing && V.Role == "coder", "a task phase sample is EXECUTING");
		V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + ",{\"seq\":5,\"at\":\"x\",\"kind\":\"phase\",\"marker\":\"idle\",\"role\":null,\"taskType\":null,\"state\":null,\"ordinal\":null,\"repairCycle\":null,\"sampled\":true}"));
		Expect(V.Phase == EExecutionPhase::Starting, "an idle marker alone is not execution");
		V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(4, PJ, LS, "completed", "success")));
		Expect(V.Phase == EExecutionPhase::Grading, "LIVE finished, run still going: GRADING");
		++ExecCases;
		const std::string Ran = Gates + "," + Step(4, PJ, LS, "completed", "success");
		Expect(ViewOf(LiveBody(Top("completed", "success", false), Ran), ECheckerVerdict::Pass, true).Phase == EExecutionPhase::Completed, "PASS + completion: COMPLETED");
		Expect(ViewOf(LiveBody(Top("completed", "success", false), Ran), ECheckerVerdict::Pass, false).Phase != EExecutionPhase::Completed, "PASS without completion is not success");
		Expect(ViewOf(LiveBody(Top("completed", "failure", false), Ran), ECheckerVerdict::Fail, false).Phase == EExecutionPhase::Failed, "FAIL: FAILED");
		Expect(ViewOf(LiveBody(Top("completed", "success", false), Ran)).Phase == EExecutionPhase::FailedUnverified, "NOT_RUN once the run completed: failed, unverified (never success)");
		// MAIN JULIUS 2026-10-26: a LIVE step that fails/cancels/times out interrupts AT ONCE, even mid-run.
		V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(4, PJ, LS, "completed", "failure")));
		Expect(V.Phase == EExecutionPhase::Failed && V.Detail.find("(failure)") != std::string::npos, "LIVE failure mid-run: interrupted now");
		Expect(ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(4, PJ, LS, "completed", "cancelled"))).Phase == EExecutionPhase::Cancelled, "LIVE cancelled mid-run: interrupted now");
		Expect(ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(4, PJ, LS, "completed", "timed_out"))).Phase == EExecutionPhase::Failed, "LIVE timed out: interrupted now");
		Expect(ViewOf(LiveBody(Top("completed", "failure", false), Gates + "," + Step(4, PJ, LS, "in_progress", nullptr))).Phase == EExecutionPhase::Failed, "run ended without LIVE success: interrupted");
		Expect(std::string(ContractTaskStateFor(ViewOf(LiveBody(Top("in_progress", nullptr, true), Ran)))) == "verification", "grading shows VERIFICATION (Skywalker 10-30: never a blank beat)");
		Expect(ViewOf(LiveBody(Top("completed", "success", false), Ran)).Phase != EExecutionPhase::Completed, "a successful WORKFLOW is never mission success without the checker");
		++ExecCases;
		// 40258482240 exactly: paid-slot gate refused, LIVE skipped.
		const std::string Refused = Job(1, "spend-tag", "completed", "success") + "," + Step(2, "paid-slot", "Gate: admission runs only reviewed, current, not rolled-back code", "completed", "failure")
			+ "," + Job(3, "paid-slot", "completed", "failure") + "," + Step(4, PJ, LS, "completed", "skipped");
		V = ViewOf(LiveBody(Top("completed", "failure", false), Refused));
		Expect(V.Phase == EExecutionPhase::DidNotStart && V.Detail == "paid-slot / Gate: admission runs only reviewed, current, not rolled-back code", "gate refusal: DID NOT START, naming the gate");
		Expect(ViewOf(LiveBody(Top("completed", "cancelled", false), Gates)).Phase == EExecutionPhase::DidNotStart, "cancelled before LIVE: did not start");
		Expect(ViewOf(LiveBody(Top("in_progress", nullptr, true), Refused)).Phase == EExecutionPhase::Starting, "a skipped LIVE step on a still-running run is never GRADING or executing");
		Expect(ViewOf(LiveBody(Top("completed", "cancelled", false), Ran)).Phase == EExecutionPhase::Cancelled, "cancelled after LIVE: CANCELLED");
		++ExecCases;
		// REVIEW B1 (2026-10-26): /result trails the run's completion. No verdict yet is a neutral wait, never a failure;
		// the wait ends on PASS (success), FAIL (interrupt) or a NOT_RUN read after completion once the grace passed.
		V = ViewOf(LiveBody(Top("completed", "success", false), Ran), ECheckerVerdict::NotRun, false, "40258482240", false);
		Expect(V.Phase == EExecutionPhase::Grading, "completed + no /result read yet: GRADING, not failed");
		Expect(std::string(ContractTaskStateFor(V)) == "verification", "completed + awaiting verdict: verification, not blank");
		Expect(ViewOf(LiveBody(Top("completed", "failure", false), Ran), ECheckerVerdict::NotRun, false, "40258482240", false).Phase == EExecutionPhase::Grading, "completed + stale pre-completion /result (NOT_RUN): GRADING");
		Expect(ViewOf(LiveBody(Top("completed", "success", false), Ran), ECheckerVerdict::Pass, true, "40258482240", false).Phase == EExecutionPhase::Completed, "the wait ends on PASS: COMPLETED");
		V = ViewOf(LiveBody(Top("completed", "failure", false), Ran), ECheckerVerdict::Fail, true, "40258482240", false);
		Expect(V.Phase == EExecutionPhase::Failed && V.Detail == "Checker: FAIL", "the wait ends on a graded FAIL (run concluded failure): FAILED, Checker: FAIL");
		{
			// The cursor across the wait: GRADING then PASS still plays run.completed (the B1 defect latched it as failed).
			FContractCursor Wait;
			FExecutionView W;
			W.Phase = EExecutionPhase::Executing;
			Wait.Advance(W);
			W.Phase = EExecutionPhase::Grading;
			Expect(Wait.Advance(W).empty() && !Wait.Ended() && !Wait.Released(), "awaiting the verdict neither ends nor interrupts");
			W.Phase = EExecutionPhase::Completed;
			const std::vector<FContractBeat> Done = Wait.Advance(W);
			Expect(Done.size() == 1 && Done[0].Type == "run.completed", "PASS after the wait: run.completed");
		}
		// B7 OUTCOME UNKNOWN (#478 /result outcomeUnknown, any cause): interrupt, never success -- even over a PASS.
		V = ViewOf(LiveBody(Top("completed", "failure", false), Gates + "," + Step(4, PJ, LS, "completed", "failure")), ECheckerVerdict::NotRun, false, "40258482240", false, "HANDED_TIMEOUT_OUTCOME_UNKNOWN");
		Expect(V.Phase == EExecutionPhase::OutcomeUnknown && V.Detail == "HANDED_TIMEOUT_OUTCOME_UNKNOWN", "outcomeUnknown: OUTCOME_UNKNOWN with its cause");
		Expect(std::string(ContractTaskStateFor(V)) == "waiting", "outcomeUnknown is neither success nor failure (labelled waiting)");
		Expect(ViewOf(LiveBody(Top("completed", "success", false), Ran), ECheckerVerdict::Pass, true, "40258482240", true, "SOME_FUTURE_CAUSE").Phase == EExecutionPhase::OutcomeUnknown, "any non-null outcomeUnknown wins over PASS");
		Expect(ViewOf(LiveBody(Top("completed", "failure", false), Refused), ECheckerVerdict::NotRun, false, "40258482240", true, "HANDED_OUTCOME_UNKNOWN").Phase == EExecutionPhase::DidNotStart, "outcomeUnknown on a run Julius never started stays DID NOT START");
		{
			FContractCursor Unknown;
			FExecutionView U;
			U.Phase = EExecutionPhase::Executing;
			Unknown.Advance(U);
			U.Phase = EExecutionPhase::OutcomeUnknown;
			Expect(Unknown.Advance(U).empty() && Unknown.Released(), "outcomeUnknown interrupts: released, no ending");
		}
		{
			// The /result field itself (#478 shape): any object is OUTCOME UNKNOWN, null or absent is not.
			const std::string Head = std::string("{\"wljRunId\":\"") + BridgeRun + "\",\"serverRunId\":\"" + BridgeRun
				+ "\",\"state\":\"dispatched\",\"checkerVerdict\":\"NOT_RUN\",\"completion\":null,\"outcomeUnknown\":";
			FResultRead R = Load(Head + "{\"cause\":\"HANDED_TIMEOUT_OUTCOME_UNKNOWN\",\"role\":\"CODING_AGENT\",\"taskId\":\"task:build:1\"}}", "");
			Expect(R.bOutcomeUnknown && R.OutcomeUnknownCause == "HANDED_TIMEOUT_OUTCOME_UNKNOWN", "/result outcomeUnknown object: read with its cause");
			R = Load(Head + "{\"cause\":null,\"role\":null,\"taskId\":null}}", "");
			Expect(R.bOutcomeUnknown && R.OutcomeUnknownCause.empty(), "/result outcomeUnknown with null cause: still OUTCOME UNKNOWN");
			R = Load(Head + "null}", "");
			Expect(!R.bOutcomeUnknown, "/result outcomeUnknown null: none");
		}
		++ExecCases;
		Expect(ViewOf(LiveBody(Top("in_progress", nullptr, true, "preflight"), Gates + "," + Step(4, PJ, LS, "in_progress", nullptr))).Phase == EExecutionPhase::Starting, "a preflight run never binds");
		Expect(ViewOf(LiveBody(Top("in_progress", nullptr, true, "paid", "999"), Gates + "," + Step(4, PJ, LS, "in_progress", nullptr))).Phase == EExecutionPhase::Starting, "another workflow run never binds");
		{
			FLiveFeed None;
			Expect(ExecutionViewFor(None, false, "", FVerdictRead{}).Phase == EExecutionPhase::None, "nothing started: NONE");
		}
		++ExecCases;
		// The contract cursor (founder acceptance 2026-10-26): nothing before execution; activation only on CONFIRMED
		// execution; each beat once; success ends with run.completed; failure/did-not-start/cancel INTERRUPT (no ending).
		FContractCursor Cursor;
		FExecutionView Seq;
		Seq.Phase = EExecutionPhase::Starting;
		Expect(Cursor.Advance(Seq).empty() && !Cursor.Started(), "B1 starting: no presentation");
		Seq.Phase = EExecutionPhase::Committing;
		Expect(Cursor.Advance(Seq).empty() && !Cursor.Started(), "B1 committing: no presentation");
		Seq.Phase = EExecutionPhase::Executing;
		std::vector<FContractBeat> B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "run.started", "B2 confirmed execution: the activation sequence");
		Seq.Role = "coder"; Seq.TaskType = "build";
		B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "coder.started", "coder beat");
		Expect(Cursor.Advance(Seq).empty(), "the same sample is not a new beat");
		Seq.Role = "reviewer"; Seq.TaskType = "review";
		Expect(Cursor.Advance(Seq).at(0).Type == "review.started", "reviewer beat");
		// FOUNDER 2026-10-26: the §04 beats only when Julius reports them (JUDEV's publisher vocabulary: the ACTIVE task only).
		// A repair round: its FIRST repair task is REPAIR REQUIRED (the reviewer's decision is not published live; the round
		// starting proves it), then guidance / repair / the reviewer's audit, then a non-repair task closes the round.
		Seq.Role = "coder"; Seq.TaskType = "repair_build"; Seq.RepairCycle = 1;
		B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "review.repair_required" && B[0].RepairRound == 1, "first repair task: REPAIR REQUIRED with its round");
		Seq.Role = "architect"; Seq.TaskType = "repair_guidance"; Seq.RepairCycle = 2;
		B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "architect.guidance", "repair_guidance (architect): GUIDANCE");
		Seq.Role = "coder"; Seq.TaskType = "repair_build"; Seq.RepairCycle = 3;
		B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "repair.started" && B[0].RepairRound == 3, "a later repair task in the round: REPAIRING");
		Seq.Role = "reviewer"; Seq.TaskType = "repair_audit"; Seq.RepairCycle = -1;
		B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "repair.completed", "the reviewer auditing the repair: VERIFYING");
		Seq.Role = "reviewer"; Seq.TaskType = "review"; Seq.RepairCycle = 3;
		B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "repair.completed", "a review after repairs: VERIFYING");
		Seq.Role = "coder"; Seq.TaskType = "repair_plan"; Seq.RepairCycle = -1;
		B = Cursor.Advance(Seq);
		Expect(B.size() == 1 && B[0].Type == "review.repair_required", "the next round after other work: REPAIR REQUIRED again");
		{
			FContractCursor Research;
			FExecutionView R; R.Phase = EExecutionPhase::Executing;
			(void)Research.Advance(R);
			R.Role = "architect"; R.TaskType = "research";
			const std::vector<FContractBeat> Rb = Research.Advance(R);
			Expect(Rb.size() == 1 && Rb[0].Type == "research.requested", "a reported research task: RESEARCHING");
			R.TaskType = "plan";
			Expect(Research.Advance(R).at(0).Type == "architect.started", "plan is PROMPT ARCHITECT, never research");
			R.Role = "reviewer"; R.TaskType = "review"; R.RepairCycle = 0;
			Expect(Research.Advance(R).at(0).Type == "review.started", "a first review (no repairs) is INDEPENDENT REVIEWER, not VERIFYING");
			R.TaskType = "plan"; R.Role = "architect";
			(void)Research.Advance(R);
			R.Role = "reviewer"; R.TaskType = "review"; R.RepairCycle = -1;
			Expect(Research.Advance(R).at(0).Type == "review.started", "REVIEW F1: a review with a null (unreported) cycle is INDEPENDENT REVIEWER, never VERIFYING");
		}
		{
			// REVIEW 2026-10-26 LINE 1: no presentation before confirmed execution, for the Dog's task-state fallback.
			Expect(!TaskRowMayPerform(true, false), "a restored/unconfirmed row bound to a Julius run never performs");
			Expect(TaskRowMayPerform(true, true), "a row Julius confirmed this session performs");
			Expect(TaskRowMayPerform(false, false), "a local row that follows no run is unaffected");
			Expect(AdoptingRunResetsToQueued(true, "wlj_a", "wlj_b"), "adopting a DIFFERENT run resets the row to queued");
			Expect(!AdoptingRunResetsToQueued(true, "wlj_a", "wlj_a"), "the same run (restore) keeps its state");
			Expect(AdoptingRunResetsToQueued(false, "", "wlj_a"), "a row with no run yet starts queued");
			Expect(!UnmappedReportMayApply(false), "REVIEW #70: an unmapped stream report never confirms an unconfirmed (restored) row");
			Expect(UnmappedReportMayApply(true), "an unmapped report may re-show the state of a row Julius already confirmed");
			// #75: after a stop that followed execution, keep reading /result until outcomeUnknown or run completion + grace.
			Expect(KeepReadingResultAfterStop(true, false, false, 0, 180000), "stopped, run still going: keep reading /result");
			Expect(KeepReadingResultAfterStop(true, false, true, 179999, 180000), "stopped, run completed, inside the grace: keep reading");
			Expect(!KeepReadingResultAfterStop(true, false, true, 180000, 180000), "the grace has passed: stop reading");
			Expect(!KeepReadingResultAfterStop(true, true, false, 0, 180000), "outcomeUnknown seen: nothing more to wait for");
			Expect(!KeepReadingResultAfterStop(false, false, false, 0, 180000), "not stopped after execution (e.g. did not start): no extra reads");
			// #74: the admission ends locally only for a completed workflow run, a terminal non-success, nothing awaited.
			Expect(AdmissionEndsWithWorkflow(true, EExecutionPhase::DidNotStart, false), "gate-stopped run completed: the admission ends (New mission possible)");
			Expect(AdmissionEndsWithWorkflow(true, EExecutionPhase::Failed, false), "failed run completed, nothing awaited: ends");
			Expect(AdmissionEndsWithWorkflow(true, EExecutionPhase::OutcomeUnknown, false), "outcome unknown, run completed: ends");
			Expect(!AdmissionEndsWithWorkflow(false, EExecutionPhase::Failed, false), "the workflow run still going: never ends the admission");
			Expect(!AdmissionEndsWithWorkflow(true, EExecutionPhase::Failed, true), "still awaiting /result (outcomeUnknown/verdict): not yet");
			Expect(!AdmissionEndsWithWorkflow(true, EExecutionPhase::Completed, false), "success is never concluded locally (the claim record finishes it)");
			Expect(!AdmissionEndsWithWorkflow(true, EExecutionPhase::Grading, false), "grading is not terminal");
		}
		{
			// REVIEW 2026-10-26: a reconnect taken MID-repair-round never replays past beats and never shows a late REPAIR
			// REQUIRED: the fresh cursor shows the activation and the round's current beat only.
			FContractCursor Joined;
			FExecutionView J; J.Phase = EExecutionPhase::Executing; J.Role = "coder"; J.TaskType = "repair_build"; J.RepairCycle = 3;
			const std::vector<FContractBeat> First = Joined.Advance(J);
			Expect(First.size() == 2 && First[0].Type == "run.started" && First[1].Type == "repair.started", "mid-round reconnect: activation + REPAIRING, no burst, no REPAIR REQUIRED");
			J.Role = "reviewer"; J.TaskType = "repair_audit"; J.RepairCycle = -1;
			Expect(Joined.Advance(J).at(0).Type == "repair.completed", "then the audit: VERIFYING");
			J.Role = "coder"; J.TaskType = "repair_build"; J.RepairCycle = -1;
			Expect(Joined.Advance(J).at(0).Type == "repair.started", "still the same round: REPAIRING, not a new REPAIR REQUIRED");
		}
		FExecutionView Stale = Seq; Stale.bStale = true; Stale.Phase = EExecutionPhase::Completed;
		Expect(Cursor.Advance(Stale).empty() && !Cursor.Ended(), "stale moves nothing");
		Seq.Phase = EExecutionPhase::Completed;
		B = Cursor.Advance(Seq);
		Expect(!B.empty() && B.back().Type == "run.completed" && Cursor.Ended() && !Cursor.Released(), "success ends with run.completed");
		Expect(Cursor.Advance(Seq).empty(), "nothing after the ending");
		for (const EExecutionPhase Bad : {EExecutionPhase::Failed, EExecutionPhase::FailedUnverified, EExecutionPhase::DidNotStart, EExecutionPhase::Cancelled})
		{
			FContractCursor Live;
			FExecutionView Running; Running.Phase = EExecutionPhase::Executing; Running.Role = "coder"; Running.TaskType = "build";
			(void)Live.Advance(Running);
			FExecutionView End; End.Phase = Bad;
			const std::vector<FContractBeat> Ending = Live.Advance(End);
			// Skywalker 2026-10-30 (supersedes "interrupt at once"): the failure ending plays, once, never success.
			Expect(Ending.size() == 1 && Ending[0].Type == "run.failed" && !Live.Released() && Live.Ended(), "B3 failure/did-not-start/interrupted: the failure ending");
			Expect(Live.Advance(End).empty() && Live.Advance(Running).empty(), "B3 the failure ending plays once and nothing follows");
		}
		FContractCursor Gate;
		FExecutionView Dns; Dns.Phase = EExecutionPhase::DidNotStart;
		const std::vector<FContractBeat> DnsBeats = Gate.Advance(Dns);
		Expect(DnsBeats.size() == 1 && DnsBeats[0].Type == "run.failed" && !Gate.Started() && !Gate.Released(), "B4 did not start: the failure ending, never activated");
		FContractCursor Restored;
		FExecutionView Done; Done.Phase = EExecutionPhase::Completed;
		B = Restored.Advance(Done);
		Expect(B.size() == 2 && B[0].Type == "run.started" && B[1].Type == "run.completed", "restored success: start then completion");
		Expect(std::string(ContractTaskStateFor(Done)) == "completed" && std::string(ContractTaskStateFor(Dns)) == "failed", "task states");
		FExecutionView Committing; Committing.Phase = EExecutionPhase::Committing;
		Expect(std::string(ContractTaskStateFor(Committing)) == "queued", "committing is queued (no Dog performance)");
		++ExecCases;
		// B5: connection uncertainty suspends; a fresh good read clears it; nothing is invented.
		Expect(ConnectionUncertain(true, true, true, 0), "stale is uncertain");
		Expect(ConnectionUncertain(false, false, true, 0), "no session is uncertain");
		Expect(ConnectionUncertain(false, true, true, LiveNoReadAfterMs + 1), "no good read for too long is uncertain");
		Expect(!ConnectionUncertain(false, true, true, 1000) && !ConnectionUncertain(false, true, false, 999999), "a fresh read (or none yet) is not");
		++ExecCases;
	}

	void PhaseFixtures()
	{
		Expect(std::strstr(VerbatimPhaseVectors, "stage: 'repair:build',\n  attempt: 2,") != nullptr, "verbatim coder phase");
		Expect(std::strstr(VerbatimPhaseVectors, "knownUsdMicros: 1000,") != nullptr, "verbatim coder cost");
		Expect(std::strstr(VerbatimPhaseVectors, "state: 'NEVER_DISPATCHED',\n  stage: null,\n  attempt: null,") != nullptr, "verbatim absent phase");
		Expect(std::strstr(VerbatimPhaseVectors, "[null, '', 'nope', -1, 1.5, false]") != nullptr, "verbatim bad revisions");
		Expect(std::strstr(VerbatimPhaseVectors, "stage: 'checkpoint'") != nullptr, "verbatim bad stage");
		Expect(std::strstr(VerbatimPhaseVectors, "{ completion: null, phases: null }") != nullptr, "verbatim unverified read");
		++PhaseCases;

		const std::string Present = PresentPhases();
		const std::string Header = HeaderOnlyPhases();

		// Present projection, revision 0, spendAccounting null (conformance "keeps a present phase projection and a projectBrainRevision of 0").
		const FResultRead Zero = Load454(Present.c_str(), "0");
		Expect(Zero.bVerified && Zero.bFinished, "present projection verifies");
		Expect(Zero.Phases == EPhaseList::Projection && Zero.PhaseSlots.size() == 3, "present projection read");
		Expect(Zero.ProjectBrainRevision.bKnown && Zero.ProjectBrainRevision.Value == 0, "revision 0 is known 0");
		Expect(!Zero.bPhasesSplit && !Zero.bRevisionSplit && !Zero.bRevisionMalformed, "present projection agrees");
		Expect(Zero.bSpendAccountingNull && !Zero.bSpendAccountingPresent, "spendAccounting null read");
		const FResultPanel ZeroPanel = ResultPanelFor(Zero);
		Expect(Same(ZeroPanel.Line, CopyStateCompleted), "present projection line");
		Expect(HasLine(ZeroPanel, "projectBrainRevision: 0"), "revision 0 shown as 0");
		Expect(!HasLine(ZeroPanel, "projectBrainRevision: Unknown"), "revision 0 is not Unknown");
		Expect(HasLine(ZeroPanel, PresentArchitectLine), "architect phase line");
		Expect(HasLine(ZeroPanel, PresentCoderLine), "coder phase line");
		Expect(HasLine(ZeroPanel, PresentReviewerLine), "reviewer phase line");
		Expect(!HasPrefix(ZeroPanel, "phases:"), "present projection has no Unknown line");
		Expect(HasLine(ZeroPanel, "spendAccounting: Unknown"), "null spendAccounting shown as Unknown");
		Expect(!HasPrefix(ZeroPanel, "spendAccounting.knownUsdMicros"), "null spendAccounting is not a number");
		Expect(HasLine(ZeroPanel, "spendTag.reservedUsdMicros: 30000000") && !HasLine(ZeroPanel, "spendAccounting: 30000000"), "null spendAccounting is not the reservation");
		Expect(!ContainsText(ZeroPanel, "spanId") && !ContainsText(ZeroPanel, "traceparent"), "phase spans are not shown");
		const FFlowView ZeroView = WatchRead(Zero);
		Expect(ZeroView.Result.bVerified && ZeroView.Result.bFinished, "flow shows the verified completion");
		Expect(ZeroView.Progress.bFinished == false, "phases do not move progress");
		++PhaseCases;

		const FResultRead Four = Load454(Present.c_str(), "4");
		Expect(Four.bVerified && Four.ProjectBrainRevision.bKnown && Four.ProjectBrainRevision.Value == 4, "revision 4");
		Expect(HasLine(ResultPanelFor(Four), "projectBrainRevision: 4") && HasLine(ResultPanelFor(Four), PresentCoderLine), "revision 4 panel");
		++PhaseCases;

		// Header-only ledger: three NEVER_DISPATCHED slots with 0 and true. Shown as reported, not as Unknown.
		const FResultRead HeaderRead = Load454(Header.c_str(), "0");
		Expect(HeaderRead.bVerified && HeaderRead.Phases == EPhaseList::Projection, "header-only projection");
		const FResultPanel HeaderPanel = ResultPanelFor(HeaderRead);
		Expect(HasLine(HeaderPanel, HeaderCoderLine), "header-only coder line keeps 0");
		Expect(HasLine(HeaderPanel, PresentArchitectLine) && HasLine(HeaderPanel, PresentReviewerLine), "header-only slots");
		Expect(!HasPrefix(HeaderPanel, "phases:"), "header-only is not Unknown");
		Expect(HasLine(HeaderPanel, "projectBrainRevision: 0"), "header-only revision 0");
		++PhaseCases;

		// A null phase list with revision 4: phases Unknown, nothing invented.
		const FResultRead NullList = Load454("null", "4");
		Expect(NullList.bVerified && NullList.Phases == EPhaseList::Null && NullList.PhaseSlots.empty(), "null phase list");
		const FResultPanel NullPanel = ResultPanelFor(NullList);
		Expect(HasLine(NullPanel, "phases: Unknown") && HasLine(NullPanel, "projectBrainRevision: 4"), "null phase list panel");
		ExpectNoPhases(NullPanel, "null phase list invents nothing");
		Expect(HasLine(NullPanel, "spendAccounting: Unknown"), "null phase list spendAccounting");
		const FResultRead OldShape = Load(
			ResultJson(BridgeRun, "completed", (std::string("\"") + BridgeTrace + "\"").c_str(), nullptr,
				Completion454("4", nullptr).c_str(), nullptr),
			"");
		Expect(OldShape.bVerified && OldShape.Phases == EPhaseList::Absent, "absent phase key");
		Expect(HasLine(ResultPanelFor(OldShape), "phases: Unknown"), "absent phase key is Unknown");
		ExpectNoPhases(ResultPanelFor(OldShape), "absent phase key invents nothing");
		++PhaseCases;

		// Every bad revision is Unknown, never 0, and the header-only phases stay.
		const char* const BadRevisions[] = {"null", "\"\"", "\"nope\"", "-1", "1.5", "false", "9007199254740992", "\"0\"", "{}", "[]"};
		for (const char* Bad : BadRevisions)
		{
			const FResultRead Read = Load454(Header.c_str(), Bad);
			Expect(Read.bVerified && !Read.ProjectBrainRevision.bKnown, Bad);
			Expect(Read.ProjectBrainRevision.bNull == (std::strcmp(Bad, "null") == 0), Bad);
			Expect(Read.bRevisionMalformed == (std::strcmp(Bad, "null") != 0), Bad);
			const FResultPanel Panel = ResultPanelFor(Read);
			Expect(HasLine(Panel, "projectBrainRevision: Unknown") && !HasLine(Panel, "projectBrainRevision: 0"), Bad);
			Expect(HasLine(Panel, HeaderCoderLine), Bad);
			++PhaseCases;
		}
		const FResultRead Largest = Load454(Header.c_str(), "9007199254740991");
		Expect(Largest.ProjectBrainRevision.bKnown && Largest.ProjectBrainRevision.Value == 9007199254740991LL, "largest safe revision");
		++PhaseCases;

		// Lists that are not the projection: null, never a partial list, never NEVER_DISPATCHED invented.
		const std::string SpanA = std::string("\"") + Repeat('a', 16) + "\"";
		const std::string Malformed[] = {
			"[" + Replaced(AbsentSlot("CODING_AGENT"), "NEVER_DISPATCHED", "ACTIVE") + "]",
			"[]",
			"[" + AbsentSlot("PROMPT_ARCHITECT", SpanA.c_str()) + "," + CoderSlot(SpanA.c_str()) + "," + AbsentSlot("INDEPENDENT_REVIEWER", SpanA.c_str()) + "]",
			"[" + AbsentSlot("PROMPT_ARCHITECT", "null", "null") + "," + CoderSlot("null", "null") + "," + AbsentSlot("INDEPENDENT_REVIEWER", "null", "null") + "]",
			"[" + AbsentSlot("PROMPT_ARCHITECT") + "," + CoderSlot("null", "1000", "\"checkpoint\"") + "," + AbsentSlot("INDEPENDENT_REVIEWER") + "]",
			"[" + CoderSlot(SpanA.c_str()) + "]",
			"[" + CoderSlot() + "," + AbsentSlot("PROMPT_ARCHITECT") + "," + AbsentSlot("INDEPENDENT_REVIEWER") + "]",
			Present.substr(0, Present.size() - 1) + "," + AbsentSlot("INDEPENDENT_REVIEWER") + "]",
			"[" + AbsentSlot("PROMPT_ARCHITECT") + "," + CoderSlot() + ",null]",
			Replaced(Present, "\"state\":\"IDLE\"", "\"state\":\"RUNNING\""),
			Replaced(Present, "\"stage\":\"repair:build\",", ""),
			Replaced(Present, "\"attempt\":2,", ""),
			Replaced(Present, "\"attempt\":2", "\"attempt\":-1"),
			Replaced(Present, "\"attempt\":2", "\"attempt\":\"2\""),
			Replaced(Present, "\"attempt\":2", "\"attempt\":9007199254740992"),
			Replaced(Present, "\"knownUsdMicros\":1000", "\"knownUsdMicros\":-1"),
			Replaced(Present, "\"knownUsdMicros\":1000", "\"knownUsdMicros\":1.5"),
			Replaced(Present, "\"knownUsdMicros\":1000,", ""),
			Replaced(Present, "\"knownUsdMicros\":1000,\"costComplete\":true", "\"knownUsdMicros\":1000,\"costComplete\":null"),
			Replaced(Present, "\"knownUsdMicros\":1000,\"costComplete\":true", "\"knownUsdMicros\":1000,\"costComplete\":\"true\""),
			Replaced(Present, "\"attempt\":2,\"spanId\":null,\"traceparent\":null", "\"attempt\":2,\"spanId\":null,\"traceparent\":\"00-0ef34f0df7cf2cf89b844dcfa5fe084f-6bc1bfe65ed9e64b-01\""),
			Replaced(Present, "\"attempt\":2,\"spanId\":null,", "\"attempt\":2,"),
			Replaced(Present, "\"role\":\"CODING_AGENT\"", "\"role\":\"coding_agent\""),
			"{}",
			"\"phases\"",
		};
		int MalformedIndex = 0;
		for (const std::string& List : Malformed)
		{
			const std::string What = "malformed phase list " + std::to_string(MalformedIndex++);
			const FResultRead Read = Load454(List.c_str(), "4");
			Expect(Read.bVerified && Read.Phases == EPhaseList::Malformed && Read.PhaseSlots.empty(), What.c_str());
			const FResultPanel Panel = ResultPanelFor(Read);
			Expect(HasLine(Panel, "phases: Unknown") && HasLine(Panel, "projectBrainRevision: 4"), What.c_str());
			ExpectNoPhases(Panel, What.c_str());
			Expect(!ContainsText(Panel, Repeat('a', 16).c_str()), What.c_str());
			++PhaseCases;
		}

		// Not a verified completion: phases and revision are never shown and never move progress.
		const FResultRead Executing = Load(
			Result454("completed", Completion454("0", Present.c_str(), "julius-run-spent.v1", "EXECUTING"), Present.c_str(), "0"),
			Progress454("completed", Present.c_str(), "0"));
		Expect(Executing.bVerified == false, "EXECUTING with phases and revision 0 is not completion");
		ExpectUnverifiedHidesPhases(Executing, "EXECUTING hides phases");
		++PhaseCases;
		const FResultRead DispatchedPhases = Load(Result454("dispatched", "", Present.c_str(), "0"), Progress454("dispatched", Present.c_str(), "0"));
		Expect(DispatchedPhases.bVerified == false && DispatchedPhases.bDispatchedCeiling, "dispatched with phases");
		ExpectUnverifiedHidesPhases(DispatchedPhases, "dispatched hides phases");
		const FFlowView DispatchedView = WatchRead(DispatchedPhases);
		Expect(Same(DispatchedView.Progress.Line, ProgressDisplayLabel(EMissionProgress::OperatorStarted)), "dispatched stays the furthest state");
		Expect(DispatchedView.Progress.bFinished == false && DispatchedView.Result.bFinished == false, "dispatched with phases is not finished");
		++PhaseCases;
		const std::string AllIdle = Replaced(Replaced(Present, "NEVER_DISPATCHED", "IDLE"), "NEVER_DISPATCHED", "IDLE");
		const FResultRead IdleOnly = Load(Result454("completed", "", AllIdle.c_str(), "4"), Progress454("completed", AllIdle.c_str(), "4"));
		Expect(IdleOnly.bVerified == false, "three idle phases are not completion");
		ExpectUnverifiedHidesPhases(IdleOnly, "idle phases without evidence");
		++PhaseCases;
		const FResultRead UnknownPhases = Load(
			Result454("unknown", Completion454("0", Present.c_str()), Present.c_str(), "0"),
			Progress454("unknown", Present.c_str(), "0"));
		Expect(UnknownPhases.bVerified == false && UnknownPhases.bUnknownState, "unknown with phases");
		ExpectUnverifiedHidesPhases(UnknownPhases, "unknown hides phases");
		Expect(WatchRead(UnknownPhases).Progress.bFinished == false, "unknown with phases is not finished");
		++PhaseCases;
		const FResultRead ExpiredPhases = Load(
			Result454("failed", Completion454("0", Present.c_str()), Present.c_str(), "0", "AWAITING_OPERATOR_EXPIRED"),
			Progress454("failed", Present.c_str(), "0"));
		Expect(ExpiredPhases.bExpired && ExpiredPhases.bVerified == false, "expired with phases");
		ExpectUnverifiedHidesPhases(ExpiredPhases, "expired hides phases");
		Expect(WatchRead(ExpiredPhases).Progress.bNotStarted, "expired with phases stays NotStarted");
		++PhaseCases;

		// spendAccounting null is never completion by itself.
		const FResultRead NullNoTag = Load(
			Result454("completed", Completion454("0", Present.c_str(), nullptr), Present.c_str(), "0"),
			Progress454("completed", Present.c_str(), "0"));
		Expect(NullNoTag.bVerified == false && NullNoTag.bSpendAccountingNull, "null spendAccounting without a tag");
		ExpectUnverifiedHidesPhases(NullNoTag, "null spendAccounting without a tag hides phases");
		const FResultRead NullWrongRun = Load(
			Result454("completed", Replaced(Completion454("0", Present.c_str()), std::string("\"run\":\"") + BridgeRun, std::string("\"run\":\"") + OtherRun), Present.c_str(), "0"),
			Progress454("completed", Present.c_str(), "0"));
		Expect(NullWrongRun.bVerified == false, "null spendAccounting with another run's tag");
		++PhaseCases;

		// The copies must agree. A split copy is Unknown, and the completion evidence is unchanged.
		const FResultRead ProgressSplit = Load(
			Result454("completed", Completion454("0", Present.c_str()), Present.c_str(), "0"),
			Progress454("completed", Header.c_str(), "0"));
		Expect(ProgressSplit.bVerified && ProgressSplit.bPhasesSplit && ProgressSplit.Phases == EPhaseList::Malformed, "progress phase split");
		Expect(HasLine(ResultPanelFor(ProgressSplit), "phases: Unknown"), "progress phase split is Unknown");
		ExpectNoPhases(ResultPanelFor(ProgressSplit), "progress phase split invents nothing");
		const FResultRead ProgressNullSplit = Load(
			Result454("completed", Completion454("0", Present.c_str()), Present.c_str(), "0"),
			Progress454("completed", "null", "0"));
		Expect(ProgressNullSplit.bPhasesSplit && HasLine(ResultPanelFor(ProgressNullSplit), "phases: Unknown"), "progress null phase split");
		const FResultRead CompletionSplit = Load(
			Result454("completed", Completion454("0", Header.c_str()), Present.c_str(), "0"),
			Progress454("completed", Present.c_str(), "0"));
		Expect(CompletionSplit.bVerified && CompletionSplit.bPhasesSplit, "completion phase split");
		Expect(HasLine(ResultPanelFor(CompletionSplit), "phases: Unknown"), "completion phase split is Unknown");
		const FResultRead ProgressRevisionSplit = Load(
			Result454("completed", Completion454("0", Present.c_str()), Present.c_str(), "0"),
			Progress454("completed", Present.c_str(), "4"));
		Expect(ProgressRevisionSplit.bVerified && ProgressRevisionSplit.bRevisionSplit && !ProgressRevisionSplit.ProjectBrainRevision.bKnown, "progress revision split");
		Expect(HasLine(ResultPanelFor(ProgressRevisionSplit), "projectBrainRevision: Unknown"), "progress revision split is Unknown");
		Expect(!HasLine(ResultPanelFor(ProgressRevisionSplit), "projectBrainRevision: 0"), "progress revision split is not 0");
		Expect(HasLine(ResultPanelFor(ProgressRevisionSplit), PresentCoderLine), "revision split keeps the phases");
		const FResultRead CompletionRevisionSplit = Load(
			Result454("completed", Completion454("4", Present.c_str()), Present.c_str(), "0"),
			Progress454("completed", Present.c_str(), "0"));
		Expect(CompletionRevisionSplit.bRevisionSplit && HasLine(ResultPanelFor(CompletionRevisionSplit), "projectBrainRevision: Unknown"), "completion revision split");
		const FResultRead CompletionNullRevision = Load(
			Result454("completed", Completion454("null", Present.c_str()), Present.c_str(), "0"),
			Progress454("completed", Present.c_str(), "0"));
		Expect(CompletionNullRevision.bRevisionSplit && !CompletionNullRevision.ProjectBrainRevision.bKnown, "completion null revision against 0");
		++PhaseCases;
	}

	void BridgeRouteFixtures()
	{
		const std::string Sha = Repeat('a', 40);
		const std::string Digest = Repeat('b', 64);
		const std::string TraceJson = std::string("\"") + BridgeTrace + "\"";
		const char* Phases = "[{\"role\":\"PROMPT_ARCHITECT\",\"state\":\"IDLE\",\"stage\":\"plan\",\"attempt\":1,\"spanId\":\"20d74ea3e2204340\",\"traceparent\":\"00-0ef34f0df7cf2cf89b844dcfa5fe084f-20d74ea3e2204340-01\",\"knownUsdMicros\":null,\"costComplete\":false},{\"role\":\"CODING_AGENT\",\"state\":\"IDLE\",\"stage\":\"build\",\"attempt\":1,\"spanId\":\"6bc1bfe65ed9e64b\",\"traceparent\":\"00-0ef34f0df7cf2cf89b844dcfa5fe084f-6bc1bfe65ed9e64b-01\",\"knownUsdMicros\":608861,\"costComplete\":true},{\"role\":\"INDEPENDENT_REVIEWER\",\"state\":\"IDLE\",\"stage\":null,\"attempt\":1,\"spanId\":null,\"traceparent\":null,\"knownUsdMicros\":null,\"costComplete\":false}]";
		const std::string HappyCompletion = CompletionJson("COMPLETED", BridgeRun, "julius-run-spent.v1", "608861", Digest.c_str(), BridgeTrace, nullptr, nullptr);
		const std::string HappyResult = ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, HappyCompletion.c_str(), nullptr);
		const std::string HappyProgress = ProgressJson(BridgeRun, "completed", TraceJson.c_str(), Phases);

		Expect(std::strstr(VerbatimCompletionValue, "juliusFinalState: 'COMPLETED'") != nullptr, "verbatim final state");
		Expect(std::strstr(VerbatimCompletionValue, "reservedUsdMicros: 30_000_000") != nullptr, "verbatim reservation");
		Expect(std::strstr(VerbatimCompletionValue, "costUsdMicros: 608861") != nullptr, "verbatim coder cost");
		Expect(std::strstr(VerbatimCompletionValue, "artifactName: 'julius-live-evidence'") != nullptr, "verbatim artifact");
		Expect(std::strstr(VerbatimCompletionValue, "traceId: 'f'.repeat(32)") != nullptr, "verbatim reader trace");
		Expect(std::strstr(VerbatimCompletionValue, "providerMessageId: 'msg_does_not_count'") != nullptr, "verbatim message id");
		Expect(std::strstr(VerbatimCompletionValue, "apiKey: SECRET") != nullptr, "verbatim secret");
		Expect(std::strstr(VerbatimCompletionValue, "token: 'ghp_FAKETESTNOTREAL'") != nullptr, "verbatim token");
		Expect(Sha.size() == 40 && Digest.size() == 64, "sha and digest widths");
		++Bridge;

		FBridgeMissionResultClient Unplugged;
		const FResultRead Absent = Unplugged.Read(BridgeRun);
		Expect(Absent.bParsed == false && Absent.bReported == false && Absent.bVerified == false && Absent.bFinished == false, "unplugged client");
		ExpectHidden(ResultPanelFor(Absent), "unplugged panel");
		++Bridge;

		const FResultRead Awaiting = Load(
			ResultJson(BridgeRun, "awaiting_operator", TraceJson.c_str(), nullptr, nullptr, nullptr),
			ProgressJson(BridgeRun, "awaiting_operator", TraceJson.c_str(), nullptr));
		Expect(Awaiting.bParsed && Awaiting.bVerified == false && Awaiting.bFinished == false && Awaiting.bDispatchedCeiling == false, "awaiting parse");
		Expect(HasLine(ResultPanelFor(Awaiting), "traceId: 0ef34f0df7cf2cf89b844dcfa5fe084f"), "awaiting trace reported");
		ExpectHidden(ResultPanelFor(Awaiting), "awaiting hides completion");
		const FFlowView AwaitingView = WatchRead(Awaiting);
		Expect(AwaitingView.Progress.bFinished == false && AwaitingView.Progress.bPaid == false, "awaiting not paid");
		Expect(Same(AwaitingView.Progress.Line, ProgressDisplayLabel(EMissionProgress::AdmittedHeld)), "awaiting label");
		++Bridge;

		const FResultRead Dispatched = Load(
			ResultJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr, nullptr, nullptr),
			ProgressJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr));
		Expect(Dispatched.bDispatchedCeiling && Dispatched.bVerified == false && Dispatched.bFinished == false, "dispatched ceiling");
		Expect(HasLine(ResultPanelFor(Dispatched), "traceId: 0ef34f0df7cf2cf89b844dcfa5fe084f"), "dispatched trace");
		ExpectHidden(ResultPanelFor(Dispatched), "dispatched hides completion");
		const FFlowView DispatchedView = WatchRead(Dispatched);
		Expect(DispatchedView.Progress.bFinished == false && DispatchedView.Progress.bPaid, "dispatched is the furthest and is not finished");
		Expect(Same(DispatchedView.Progress.Line, ProgressDisplayLabel(EMissionProgress::OperatorStarted)), "dispatched label");
		Expect(!Same(DispatchedView.Progress.Line, ProgressDisplayLabel(EMissionProgress::Succeeded)), "dispatched is not succeeded");
		++Bridge;

		const FResultRead Done = Load(HappyResult, HappyProgress);
		const FResultPanel DonePanel = ResultPanelFor(Done);
		Expect(Done.bVerified && Done.bFinished && Done.State == "completed", "completed verifies");
		Expect(Same(DonePanel.Line, CopyStateCompleted) && DonePanel.bShowsArtifact && DonePanel.bFinished, "completed panel");
		Expect(HasLine(DonePanel, "traceId: 0ef34f0df7cf2cf89b844dcfa5fe084f"), "completed trace");
		Expect(HasLine(DonePanel, "completion.traceId: 0ef34f0df7cf2cf89b844dcfa5fe084f"), "completion trace");
		Expect(HasLine(DonePanel, "archive.artifactName: julius-live-evidence"), "artifact name");
		Expect(HasLine(DonePanel, std::string("archive.artifactDigest: " + Digest).c_str()), "artifact digest");
		Expect(HasLine(DonePanel, (std::string("workArtifactRefs: artifact:julius-work-artifact.v1:") + BridgeRun + ":build-1:g1:DIFF").c_str()), "work artifact");
		Expect(HasLine(DonePanel, "spendTag.reservedUsdMicros: 30000000"), "reservation as reported");
		Expect(HasLine(DonePanel, "spendAccounting.knownUsdMicros: 30000000"), "accounting as reported");
		Expect(HasLine(DonePanel, "coderCost.costUsdMicros: 608861"), "coder cost as reported");
		Expect(HasLine(DonePanel, "coderCost.costBasis: PROVIDER_REPORTED"), "cost basis as reported");
		Expect(HasLine(DonePanel, "missionCost.knownUsdMicros: 608861"), "mission cost as reported");
		Expect(HasLine(DonePanel, "missionCost.unknownComponents: 2"), "unknown components as reported");
		Expect(HasLine(DonePanel, "missionCost.complete: false"), "incomplete total stays false");
		Expect(!ContainsText(DonePanel, ReaderTrace), "reader trace is not substituted");
		Expect(!ContainsText(DonePanel, "checkerVerdict"), "absent verdict is not invented");
		++Bridge;

		// PR-B CHECKER VERDICT (founder-approved): "Completed" only on PASS; FAIL is a failed evaluation; NOT_RUN,
		// absent and unreadable all stay "not independently verified".
		const auto WithVerdict = [&](const char* Extra)
		{
			return Load(ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, HappyCompletion.c_str(), Extra), HappyProgress);
		};
		// completion.checker (#448 57ed1d61): a PASS must name the judged sha256 it graded.
		const std::string Judged = std::string("0123456789ab") + Repeat('c', 52);
		const auto WithChecker = [&](const char* Verdict, const std::string& CheckerObject)
		{
			std::string Completion = HappyCompletion;
			Completion.insert(1, std::string("\"checker\":") + CheckerObject + ",");
			return Load(ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, Completion.c_str(),
				(std::string(",\"checkerVerdict\":\"") + Verdict + "\"").c_str()), HappyProgress);
		};
		const std::string GoodChecker = std::string("{\"reason\":\"ok\",\"taskId\":\"t1\",\"judgedTrimmedSha256\":\"") + Judged
			+ "\",\"gameDigest\":\"0123456789ab\",\"checkerSha256\":\"" + Repeat('d', 64) + "\"}";
		const FResultRead Passed = WithChecker("PASS", GoodChecker);
		const FResultPanel PassedPanel = ResultPanelFor(Passed);
		Expect(Passed.bCheckerReported && Passed.Checker == ECheckerVerdict::Pass && !Passed.bCheckerUnbound, "pass parsed");
		Expect(Same(PassedPanel.Line, CopyStateCompletedChecked) && PassedPanel.bVerified && PassedPanel.bFinished && PassedPanel.bShowsArtifact, "pass shows completed");
		Expect(HasLine(PassedPanel, "checkerVerdict: PASS"), "pass named");
		Expect(HasLine(PassedPanel, "checker.gameDigest: 0123456789ab"), "pass shows the in-game digest");
		Expect(HasLine(PassedPanel, (std::string("checker.judgedTrimmedSha256: ") + Judged).c_str()), "pass names what it judged");
		++Bridge;
		const FResultRead Unbound = WithVerdict(",\"checkerVerdict\":\"PASS\"");
		Expect(Unbound.bCheckerUnbound && !Same(ResultPanelFor(Unbound).Line, CopyStateCompletedChecked), "pass naming no judged sha is not completed");
		Expect(HasLine(ResultPanelFor(Unbound), "checkerVerdict: PASS (names no judged sha256; not verified)"), "unbound pass says so");
		++Bridge;
		const FResultRead BadHex = WithChecker("PASS", "{\"judgedTrimmedSha256\":\"" + Repeat('C', 64) + "\",\"gameDigest\":\"0123456789abc\"}");
		const FResultPanel BadHexPanel = ResultPanelFor(BadHex);
		Expect(BadHex.bCheckerUnbound && !Same(BadHexPanel.Line, CopyStateCompletedChecked), "malformed judged sha unbinds the pass");
		Expect(HasLine(BadHexPanel, "checker.gameDigest: Unknown") && HasLine(BadHexPanel, "checker.judgedTrimmedSha256: Unknown"), "malformed checker values read Unknown");
		Expect(!ContainsText(BadHexPanel, "0123456789abc") && !ContainsText(BadHexPanel, Repeat('C', 64).c_str()), "malformed checker values are not echoed");
		++Bridge;
		const FResultRead DigestOff = WithChecker("PASS", std::string("{\"judgedTrimmedSha256\":\"") + Judged + "\",\"gameDigest\":\"ffffffffffff\"}");
		Expect(DigestOff.bCheckerUnbound && !Same(ResultPanelFor(DigestOff).Line, CopyStateCompletedChecked), "digest not the judged prefix unbinds the pass");
		++Bridge;
		const FResultPanel FailDetail = ResultPanelFor(WithChecker("FAIL", GoodChecker));
		Expect(Same(FailDetail.Line, CopyCheckerFailed) && HasLine(FailDetail, "checker.gameDigest: 0123456789ab"), "fail shows what it judged");
		const FResultPanel NotRunDetail = ResultPanelFor(WithChecker("NOT_RUN", GoodChecker));
		Expect(!ContainsText(NotRunDetail, "checker.gameDigest") && Same(NotRunDetail.Line, CopyStateCompleted), "not run shows no checker detail");
		++Bridge;
		const FResultRead Failed = WithVerdict(",\"checkerVerdict\":\"FAIL\"");
		const FResultPanel FailedPanel = ResultPanelFor(Failed);
		Expect(Failed.Checker == ECheckerVerdict::Fail, "fail parsed");
		Expect(Same(FailedPanel.Line, CopyCheckerFailed) && !FailedPanel.bVerified && !FailedPanel.bShowsArtifact, "fail is a failed evaluation");
		Expect(!ContainsText(FailedPanel, "state: completed") && HasLine(FailedPanel, "checkerVerdict: FAIL"), "fail is never completed");
		Expect(!ContainsText(FailedPanel, "archive.artifactName"), "fail offers no artifact");
		++Bridge;
		const FResultRead NotRun = WithVerdict(",\"checkerVerdict\":\"NOT_RUN\"");
		Expect(Same(ResultPanelFor(NotRun).Line, CopyStateCompleted) && HasLine(ResultPanelFor(NotRun), "checkerVerdict: NOT_RUN"), "not run stays unverified");
		++Bridge;
		const char* Unreadable[] = { ",\"checkerVerdict\":\"pass\"", ",\"checkerVerdict\":true", ",\"checkerVerdict\":null",
			",\"checkerVerdict\":\"PASSED\"", ",\"checkerVerdict\":{\"verdict\":\"PASS\"}", ",\"checkerVerdict\":\" PASS\"" };
		for (const char* Extra : Unreadable)
		{
			const FResultRead Odd = WithVerdict(Extra);
			const FResultPanel OddPanel = ResultPanelFor(Odd);
			Expect(Odd.Checker == ECheckerVerdict::NotRun && !Odd.bCheckerReported, "unreadable verdict is not run");
			Expect(Same(OddPanel.Line, CopyStateCompleted) && !ContainsText(OddPanel, "checkerVerdict"), "unreadable verdict stays unverified and unnamed");
			++Bridge;
		}
		const FResultRead PassNoEvidence = Load(ResultJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr, nullptr, ",\"checkerVerdict\":\"PASS\""),
			ProgressJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr));
		Expect(!PassNoEvidence.bVerified && !Same(ResultPanelFor(PassNoEvidence).Line, CopyStateCompletedChecked), "pass without completion evidence is not completed");
		++Bridge;
		Expect(!ContainsText(DonePanel, "traceparent:"), "null traceparent is not computed");
		Expect(!ContainsText(DonePanel, "msg_does_not_count"), "message id absent");
		Expect(!ContainsText(DonePanel, "sk-"), "secret absent");
		Expect(WatchRead(Done).Progress.bFinished == false, "progress is not marked finished by the result");
		++Bridge;

		const std::string NullCost = CompletionJson("COMPLETED", BridgeRun, "julius-run-spent.v1", "null", Digest.c_str(), BridgeTrace, nullptr, nullptr);
		const FResultPanel NullCostPanel = ResultPanelFor(Load(ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, NullCost.c_str(), nullptr), HappyProgress));
		Expect(NullCostPanel.bVerified, "null coder cost still verified");
		Expect(HasLine(NullCostPanel, "coderCost.costUsdMicros: Unknown"), "null coder cost is Unknown");
		Expect(!HasLine(NullCostPanel, "coderCost.costUsdMicros: 0"), "null coder cost is not zero");
		Expect(!HasLine(NullCostPanel, "coderCost.costUsdMicros: 30000000"), "null coder cost is not the reservation");
		Expect(HasLine(NullCostPanel, "spendTag.reservedUsdMicros: 30000000"), "reservation stays on its own line");
		++Bridge;

		const std::string NullDigest = CompletionJson("COMPLETED", BridgeRun, "julius-run-spent.v1", "608861", nullptr, BridgeTrace, nullptr, nullptr);
		const FResultPanel NullDigestPanel = ResultPanelFor(Load(ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, NullDigest.c_str(), nullptr), HappyProgress));
		Expect(NullDigestPanel.bVerified && NullDigestPanel.bShowsArtifact, "null digest keeps the reported name");
		Expect(HasLine(NullDigestPanel, "archive.artifactDigest: Unknown"), "null digest is Unknown");
		Expect(!HasLine(NullDigestPanel, (std::string("archive.artifactDigest: ") + Digest).c_str()), "file sha is not the artifact digest");
		++Bridge;

		const char* MovingPhases = "[{\"role\":\"CODING_AGENT\",\"state\":\"ACTIVE\",\"stage\":\"build\",\"attempt\":null,\"spanId\":null,\"traceparent\":null,\"knownUsdMicros\":null,\"costComplete\":null}]";
		const FResultRead Moving = Load(
			ResultJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr, nullptr, nullptr),
			ProgressJson(BridgeRun, "dispatched", TraceJson.c_str(), MovingPhases));
		Expect(Moving.bVerified == false && Moving.bDispatchedCeiling, "phases are not completion");
		ExpectHidden(ResultPanelFor(Moving), "phases hide cost and artifact");
		++Bridge;

		const FResultRead Bare = Load(
			ResultJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr, nullptr, ",\"completed\":true"),
			ProgressJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr));
		Expect(Bare.bVerified == false && Bare.bFinished == false, "bare completed bool is not evidence");
		ExpectHidden(ResultPanelFor(Bare), "bare completed hides a result");
		++Bridge;

		const FResultRead WordOnly = Load(
			ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, nullptr, nullptr),
			ProgressJson(BridgeRun, "completed", TraceJson.c_str(), nullptr));
		Expect(WordOnly.bVerified == false && WordOnly.bFinished == false, "completed without evidence");
		ExpectHidden(ResultPanelFor(WordOnly), "completed word hides a result");
		const FFlowView WordView = WatchRead(WordOnly);
		Expect(WordView.Progress.bFinished == false && WordView.Progress.bFault && WordView.Progress.bPaid == false, "unverified completed stays unfinished");
		Expect(Same(WordView.Progress.Line, ProgressDisplayLabel(EMissionProgress::OperatorStarted)), "unverified completed holds at dispatched");
		++Bridge;

		const std::string Executing = CompletionJson("EXECUTING", BridgeRun, "julius-run-spent.v1", "608861", Digest.c_str(), BridgeTrace, nullptr, nullptr);
		const FResultRead NotFinal = Load(
			ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, Executing.c_str(), nullptr),
			HappyProgress);
		Expect(NotFinal.bVerified == false && NotFinal.ArtifactName.bKnown, "executing is parsed and not verified");
		ExpectHidden(ResultPanelFor(NotFinal), "executing hides the artifact");
		++Bridge;

		const FResultRead Early = Load(
			ResultJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr, HappyCompletion.c_str(), nullptr),
			ProgressJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr));
		Expect(Early.bVerified == false && Early.ArtifactName.bKnown && Early.bDispatchedCeiling, "evidence under dispatched is not completion");
		ExpectHidden(ResultPanelFor(Early), "dispatched evidence hides the artifact");
		++Bridge;

		const FResultRead Unknown = Load(
			ResultJson(BridgeRun, "unknown", TraceJson.c_str(), nullptr, HappyCompletion.c_str(), nullptr),
			ProgressJson(BridgeRun, "unknown", TraceJson.c_str(), nullptr));
		Expect(Unknown.bUnknownState && Unknown.bVerified == false && Unknown.bFinished == false, "unknown is not finished");
		ExpectHidden(ResultPanelFor(Unknown), "unknown hides completion");
		const FFlowView UnknownView = WatchRead(Unknown);
		Expect(UnknownView.Progress.bFinished == false && UnknownView.Result.bFinished == false, "unknown panels are not finished");
		Expect(Same(UnknownView.Progress.Line, ProgressDisplayLabel(EMissionProgress::Waiting)), "unknown label");
		Expect(!Same(UnknownView.Progress.Line, ProgressDisplayLabel(EMissionProgress::Succeeded)), "unknown is not succeeded");
		++Bridge;

		const FResultRead Expired = Load(
			ResultJson(BridgeRun, "failed", TraceJson.c_str(), "AWAITING_OPERATOR_EXPIRED", HappyCompletion.c_str(), nullptr),
			ProgressJson(BridgeRun, "failed", TraceJson.c_str(), nullptr));
		Expect(Expired.bExpired && Expired.bVerified == false && Expired.bFinished == false, "expired is not verified");
		ExpectHidden(ResultPanelFor(Expired), "expired hides completion");
		const FFlowView ExpiredView = WatchRead(Expired);
		Expect(ExpiredView.Progress.bNotStarted && ExpiredView.Progress.bFinished == false && ExpiredView.Progress.bPaid == false, "expired stays NotStarted");
		Expect(Same(ExpiredView.Progress.Line, ProgressDisplayLabel(EMissionProgress::NotStarted)), "expired label");
		Expect(!Same(ExpiredView.Progress.Line, ProgressDisplayLabel(EMissionProgress::Succeeded)), "expired is not succeeded");
		Expect(ExpiredView.Result.bFinished == false, "expired result is not finished");
		++Bridge;

		const std::string NoTag = CompletionJson("COMPLETED", BridgeRun, nullptr, "608861", Digest.c_str(), BridgeTrace, nullptr, nullptr);
		const FResultRead MissingTag = Load(
			ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, NoTag.c_str(), nullptr),
			HappyProgress);
		Expect(MissingTag.bVerified == false, "missing spend tag");
		ExpectHidden(ResultPanelFor(MissingTag), "missing spend tag hides the artifact");
		++Bridge;

		const std::string BadSchemaCompletion = CompletionJson("COMPLETED", BridgeRun, "not-a-spend-tag", "608861", Digest.c_str(), BridgeTrace, nullptr, nullptr);
		Expect(Load(ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, BadSchemaCompletion.c_str(), nullptr), HappyProgress).bVerified == false, "wrong spend schema");
		++Bridge;

		const std::string WrongRunCompletion = CompletionJson("COMPLETED", OtherRun, "julius-run-spent.v1", "608861", Digest.c_str(), BridgeTrace, nullptr, nullptr);
		Expect(Load(ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, WrongRunCompletion.c_str(), nullptr), HappyProgress).bVerified == false, "spend tag run mismatch");
		++Bridge;

		const FResultRead Mismatch = Load(
			ResultJson(OtherRun, "completed", TraceJson.c_str(), nullptr, HappyCompletion.c_str(), nullptr),
			HappyProgress);
		Expect(Mismatch.bParsed == false && Mismatch.bVerified == false, "wljRunId mismatch");
		++Bridge;

		const FResultRead Split = Load(HappyResult, ProgressJson(BridgeRun, "dispatched", TraceJson.c_str(), nullptr));
		Expect(Split.bVerified == false && Split.bFinished == false, "split state is not completion");
		ExpectHidden(ResultPanelFor(Split), "split state hides the artifact");
		++Bridge;

		Expect(Load(HappyResult, HappyProgress, 404, 200).bVerified == false, "404 is not a result");
		Expect(Load(HappyResult, HappyProgress, 403, 200).bParsed == false, "403 is not a result");
		const char* NotFound = "{\"error\":{\"kind\":\"not_found\",\"message\":\"Not found.\"}}";
		const char* Denied = "{\"error\":{\"kind\":\"julius_dispatch_not_loopback\",\"message\":\"Mission dispatch is only served to the same machine.\"}}";
		Expect(Load(NotFound, "", 404, 0).bParsed == false, "not_found body");
		Expect(Load(Denied, "", 403, 0).bParsed == false, "loopback body");
		Expect(!ContainsText(ResultPanelFor(Load(NotFound, "", 404, 0)), BridgeRun), "not_found does not echo the run");
		++Bridge;

		const FResultRead Errored = Load(
			ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, HappyCompletion.c_str(), ",\"error\":{\"kind\":\"not_found\",\"message\":\"Not found.\"}"),
			HappyProgress);
		Expect(Errored.bParsed == false && Errored.bVerified == false, "error object is not a result");
		++Bridge;

		const std::string HostileCompletion = CompletionJson(
			"COMPLETED", BridgeRun, "julius-run-spent.v1", "608861", Digest.c_str(), ReaderTrace,
			",\"providerMessageId\":\"msg_does_not_count\"",
			",\"apiKey\":\"sk-ant-FAKETESTNOTREAL\",\"token\":\"ghp_FAKETESTNOTREAL\"");
		const FResultPanel Hostile = ResultPanelFor(Load(
			ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, HostileCompletion.c_str(), nullptr),
			HappyProgress));
		Expect(Hostile.bVerified, "hostile extras do not erase evidence");
		Expect(HasLine(Hostile, "traceId: 0ef34f0df7cf2cf89b844dcfa5fe084f"), "top level trace kept");
		Expect(HasLine(Hostile, "completion.traceId: ffffffffffffffffffffffffffffffff"), "reported completion trace kept");
		Expect(!ContainsText(Hostile, "msg_does_not_count"), "message id is not a receipt");
		Expect(!ContainsText(Hostile, "sk-ant-FAKETESTNOTREAL"), "apiKey is not displayed");
		Expect(!ContainsText(Hostile, "ghp_FAKETESTNOTREAL"), "token is not displayed");
		++Bridge;

		const FResultRead NullTrace = Load(
			ResultJson(BridgeRun, "dispatched", "null", nullptr, nullptr, nullptr),
			ProgressJson(BridgeRun, "dispatched", "null", nullptr));
		Expect(NullTrace.TraceId.bNull && NullTrace.TraceId.bKnown == false && NullTrace.bVerified == false, "null trace stays unknown");
		Expect(HasLine(ResultPanelFor(NullTrace), "traceId: Unknown"), "null trace renders Unknown");
		Expect(!HasLine(ResultPanelFor(NullTrace), "traceId: 0ef34f0df7cf2cf89b844dcfa5fe084f"), "null trace is not derived");
		++Bridge;

		const char* ReaderShaped = "{\"juliusFinalState\":\"COMPLETED\",\"completed\":true,\"traceId\":\"ffffffffffffffffffffffffffffffff\",\"archive\":{\"artifactName\":\"julius-live-evidence\"},\"apiKey\":\"sk-ant-FAKETESTNOTREAL\"}";
		const FResultRead ReaderPayload = Load(ReaderShaped, "");
		Expect(ReaderPayload.bParsed == false && ReaderPayload.bVerified == false, "reader payload is not a route body");
		Expect(!ContainsText(ResultPanelFor(ReaderPayload), "julius-live-evidence"), "reader payload artifact hidden");
		Expect(!ContainsText(ResultPanelFor(ReaderPayload), "sk-ant"), "reader payload secret hidden");
		++Bridge;

		const std::string Redacted = std::string("{\"juliusFinalState\":\"COMPLETED\",\"spendTag\":") + SpendTag(BridgeRun, "julius-run-spent.v1")
			+ ",\"coderCost\":{\"costUsdMicros\":608861,\"costBasis\":\"PROVIDER_REPORTED\",\"executionCostUsdMicros\":null,\"billingPath\":\"API_BILLED\"}"
			+ ",\"missionCost\":{\"knownUsdMicros\":608861,\"unknownComponents\":2,\"complete\":false}"
			+ ",\"providerReceipt\":{\"providerRequestId\":null,\"responseId\":null,\"providerRequestAvailability\":\"UNAVAILABLE\",\"providerRequestUnavailableReason\":\"provider_request_id_credential_shaped\"}"
			+ ",\"archive\":" + ArchiveJson(Digest.c_str())
			+ ",\"traceId\":\"" + BridgeTrace + "\",\"traceparent\":null}";
		const FResultPanel RedactedPanel = ResultPanelFor(Load(ResultJson(BridgeRun, "completed", TraceJson.c_str(), nullptr, Redacted.c_str(), nullptr), HappyProgress));
		Expect(RedactedPanel.bVerified, "redacted receipt still completes");
		Expect(!ContainsText(RedactedPanel, "sk-ant-FAKETESTNOTREAL"), "credential was not in the body and is not invented");
		Expect(!HasLine(RedactedPanel, "providerRequestId: "), "request id is not invented");
		++Bridge;
	}

	// CLIENT LANE C1 (2026-10-30; Skywalker ruling 3 / A-9): the 202 ack is a RECEIPT, not a dispatch; outcome-unknown
	// is 200 dispatching replayed:false; a same-key resend reuses the persisted clientTriggerId.
	int AckCases = 0;
	void StartAckFixtures()
	{
		using R = EStartRecord;
		const char* const W = "wlj_0f8fad5b-d9cb-469f-a165-70867728950e";
		const std::string Hash(64, 'a');
		const std::string AckBody = std::string("{\"wljRunId\":\"") + W + "\",\"ack\":\"accepted\",\"state\":\"accepted\",\"startKeyHash\":\"" + Hash +
			"\",\"acceptedAt\":\"2026-10-30T18:00:00.000Z\",\"replayed\":false,\"workflowRunId\":null,\"dispatchedAt\":null}";
		FStartAnswer A = ParseStartAnswer(W, 202, AckBody);
		Expect(A.Outcome == EStartOutcome::Acknowledged && A.WorkflowRunId.empty() && A.StartKeyHash == Hash && !A.bReplayed, "202 ack is acknowledged");
		Expect(A.Outcome != EStartOutcome::Accepted, "202 ack is NEVER treated as dispatched");
		Expect(StartRecordAfterAnswer(A.Outcome, 202) == R::Accepted, "an ack records Accepted, not Started");
		A = ParseStartAnswer(W, 202, Swap(AckBody, "\"replayed\":false", "\"replayed\":true"));
		Expect(A.Outcome == EStartOutcome::Acknowledged && A.bReplayed, "a replayed ack is still only an ack");
		Expect(ParseStartAnswer(W, 200, AckBody).Outcome == EStartOutcome::Malformed, "an ack is only ever 202");
		Expect(ParseStartAnswer(W, 202, Swap(AckBody, "\"workflowRunId\":null", "\"workflowRunId\":\"40242149156\"")).Outcome == EStartOutcome::Malformed, "an ack with a run id is not understood");
		Expect(ParseStartAnswer(W, 202, Swap(AckBody, "\"dispatchedAt\":null", "\"dispatchedAt\":\"2026-10-30T18:00:01.000Z\"")).Outcome == EStartOutcome::Malformed, "an ack with a dispatch time is not understood");
		Expect(ParseStartAnswer(W, 202, Swap(AckBody, "\"state\":\"accepted\"", "\"state\":\"dispatched\"")).Outcome == EStartOutcome::Malformed, "an ack must say state accepted");
		Expect(ParseStartAnswer(W, 202, Swap(AckBody, Hash, Hash.substr(1))).Outcome == EStartOutcome::Malformed, "an ack needs the 64-hex key hash");
		Expect(ParseStartAnswer(W, 202, Swap(AckBody, ",\"replayed\":false", "")).Outcome == EStartOutcome::Malformed, "an ack must say whether it replayed");
		Expect(ParseStartAnswer("wlj_11111111-2222-4333-8444-555555555555", 202, AckBody).Outcome == EStartOutcome::Malformed, "another run's ack is refused");
		++AckCases;

		// V2 dispatch_outcome_unknown: 200 dispatching replayed:false. Never Started, never offered, never resent.
		const std::string Unknown = std::string("{\"wljRunId\":\"") + W + "\",\"state\":\"dispatching\",\"workflowRunId\":null,\"dispatchedAt\":null,\"replayed\":false}";
		A = ParseStartAnswer(W, 200, Unknown);
		Expect(A.Outcome == EStartOutcome::Uncertain && A.State == "dispatching", "200 dispatching replayed:false is outcome-unknown");
		Expect(StartRecordAfterAnswer(A.Outcome, 200) == R::Sending, "outcome-unknown keeps the record unreconciled");
		Expect(ParseStartAnswer(W, 200, Swap(Unknown, "\"replayed\":false", "\"replayed\":true")).Outcome == EStartOutcome::Uncertain, "a replay of dispatching is still uncertain");
		Expect(ParseStartAnswer(W, 202, Unknown).Outcome == EStartOutcome::Malformed, "202 dispatching is not understood");
		++AckCases;

		// 409 kinds under ACK.
		const FStartAnswer Reused = ParseStartAnswer(W, 409, "{\"error\":{\"kind\":\"julius_start_key_reused\",\"message\":\"x\"}}");
		Expect(Reused.Outcome == EStartOutcome::Uncertain, "key reused is uncertain, not a refusal of the run");
		const FStartAnswer Busy = ParseStartAnswer(W, 409, "{\"error\":{\"kind\":\"julius_start_in_progress\",\"message\":\"Poll /status; do not send a new key\"}}");
		Expect(Busy.Outcome == EStartOutcome::InProgress && StartRecordAfterAnswer(Busy.Outcome, 409) == R::Accepted, "in progress polls /status");
		const FStartAnswer Cut = ParseStartAnswer(W, 409, "{\"error\":{\"kind\":\"julius_start_interrupted\",\"message\":\"Start again with a new key\"}}");
		Expect(Cut.Outcome == EStartOutcome::Refused && StartRecordAfterAnswer(Cut.Outcome, 409) == R::Refused, "interrupted is refused; no automatic new key");
		++AckCases;

		// Founder ruling 2026-10-30: a lost answer (crash, timeout) blocks Start until /status reconciles it.
		Expect(StartRecordAfterAnswer(EStartOutcome::Retryable, 0) == R::Sending, "transport/timeout blocks (no auto retry)");
		Expect(StartRecordAfterAnswer(EStartOutcome::Retryable, 504) == R::Sending, "a gateway timeout blocks");
		Expect(StartRecordAfterAnswer(EStartOutcome::Retryable, 502) == R::Sending, "a bad gateway blocks");
		Expect(StartRecordAfterAnswer(EStartOutcome::Retryable, 503) == R::NotStarted, "503 unavailable said nothing was claimed");
		Expect(StartRecordAfterAnswer(EStartOutcome::Retryable, 401) == R::NotStarted, "401 said nothing was claimed");
		Expect(StartRecordAfterAnswer(EStartOutcome::Malformed, 202) == R::Sending, "an unreadable answer blocks");
		Expect(StartRecordAfterAnswer(EStartOutcome::Accepted, 202) == R::Started, "a dispatch answer is Started");
		const char* const Ok = "RUN LIVE MISSION";
		for (const R Record : {R::Sending, R::Accepted})
		{
			const FStartGate Blocked = StartGateFor("admitted_waiting", true, false, Record, true, Ok);
			Expect(!Blocked.bOffer && !Blocked.bSend && Blocked.Why != nullptr && *Blocked.Why != 0, "an unreconciled or acknowledged start is blocked with a reason");
		}
		Expect(std::strstr(StartGateFor("admitted_waiting", true, false, R::Sending, true, Ok).Why, "/status") != nullptr, "the reason names /status");
		++AckCases;

		Expect(ClientTriggerIdOk(std::string(32, 'f')) && !ClientTriggerIdOk(std::string(32, 'F')) && !ClientTriggerIdOk(std::string(31, 'f')), "trigger id is 32 lowercase hex");
		++AckCases;
	}

	// CLIENT LANE C2 (A-9 /status; founder ruling 2026-10-30): /status decides the Start record; outcome-unknown keeps
	// Start blocked; nothing reconciles into a send.
	const char* const StatusWlj = "wlj_0f8fad5b-d9cb-469f-a165-70867728950e";
	std::string StatusBody(const std::string& Phase, bool bTerminal, const std::string& Start, const std::string& Run = "null",
		const std::string& Result = "{\"checkerVerdict\":null,\"outcomeUnknown\":false}", const std::string& NextPoll = "2000")
	{
		return std::string("{\"schema\":\"wonderland-mission-status.v1\",\"wljRunId\":\"") + StatusWlj + "\",\"serverRunId\":\"srv-1\",\"phase\":\"" + Phase +
			"\",\"terminal\":" + (bTerminal ? "true" : "false") +
			",\"admission\":{\"state\":\"awaiting_operator\",\"cause\":null,\"updatedAt\":null},\"start\":" + Start + ",\"run\":" + Run +
			",\"stage\":null,\"progress\":{\"percent\":null,\"basis\":\"none\"},\"workflowProgress\":{\"label\":\"GitHub workflow steps (not mission progress)\",\"percent\":null,\"basis\":\"none\",\"stepsCompleted\":null,\"stepsTotal\":null}"
			",\"result\":" + Result + ",\"eventsCursor\":null,\"nextPollMs\":" + NextPoll + ",\"serverTime\":\"2026-10-30T18:00:00.000Z\"}";
	}
	std::string StartObj(bool bRequested, const std::string& Workflow = "null", const std::string& Request = "")
	{
		return std::string("{\"requested\":") + (bRequested ? "true" : "false") + ",\"startKeyHash\":null,\"clientTriggerId\":null,\"dispatchedAt\":null,\"workflowRunId\":" +
			Workflow + ",\"workflowRunIdSource\":null,\"retryStartSafe\":" + (bRequested ? "true" : "false") + ",\"recovery\":\"none\"" +
			(Request.empty() ? std::string() : ",\"request\":" + Request) + "}";
	}
	std::string RequestObj(const char* State)
	{
		return std::string("{\"state\":\"") + State + "\",\"startKeyHash\":\"" + std::string(64, 'a') + "\",\"acceptedAt\":\"2026-10-30T18:00:00.000Z\",\"outcome\":null,\"resumed\":false,\"resumedAt\":null}";
	}
	const char* const BoundRun = "{\"status\":\"in_progress\",\"conclusion\":null,\"live\":true,\"execution\":\"executing\",\"executionStartedAt\":null,\"stoppedAt\":null,\"stale\":false,\"fetchedAt\":null}";

	FMissionStatusRead& Read503()
	{
		static FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 503, "");
		return Read;
	}

	int StatusCases = 0;
	void StatusFixtures()
	{
		using R = EStartRecord;
		const char* const W = StatusWlj;
		FMissionStatusRead S = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false)));
		Expect(S.bOk && S.Phase == EMissionStatusPhase::Admitted && !S.bTerminal && !S.bRequested && S.NextPollMs == 2000 && S.Skipped.empty(), "status admitted reads");
		Expect(!ParseMissionStatus(W, 200, Swap(StatusBody("admitted", false, StartObj(false)), "wonderland-mission-status.v1", "wonderland-mission-status.v2")).bOk, "status schema is exact");
		Expect(!ParseMissionStatus("wlj_11111111-2222-4333-8444-555555555555", 200, StatusBody("admitted", false, StartObj(false))).bOk, "another run's status is refused");
		Expect(!ParseMissionStatus(W, 200, StatusBody("running", false, StartObj(false))).bOk, "status phase is a closed set");
		Expect(!ParseMissionStatus(W, 200, StatusBody("failed", false, StartObj(false))).bOk, "terminal must match the phase (failed)");
		Expect(!ParseMissionStatus(W, 200, StatusBody("executing", true, StartObj(true), BoundRun)).bOk, "terminal must match the phase (executing)");
		Expect(!ParseMissionStatus(W, 503, StatusBody("admitted", false, StartObj(false))).bOk, "status needs 200");
		Expect(!ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false, "\"40x\""))).bOk, "status workflow run id is digits");
		Expect(!ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false, "null", RequestObj("pending")))).bOk, "status request state is a closed set");
		Expect(!ParseMissionStatus(W, 200, Swap(StatusBody("admitted", false, StartObj(false)), "\"requested\":false", "\"requested\":0")).bOk, "start.requested is a bool");
		++StatusCases;

		// Tolerant per field: one bad display field never drops the page.
		S = ParseMissionStatus(W, 200, Swap(StatusBody("admitted", false, StartObj(false)), "\"progress\":{\"percent\":null,\"basis\":\"none\"}", "\"progress\":{\"percent\":\"12%\",\"basis\":\"guess\"}"));
		Expect(S.bOk && S.ProgressPercent == -1 && S.Skipped.size() == 1 && S.Skipped[0] == "progress", "a bad progress field is dropped, not the page");
		S = ParseMissionStatus(W, 200, Swap(StatusBody("admitted", false, StartObj(false)), "\"progress\":{\"percent\":null,\"basis\":\"none\"}", "\"progress\":{\"percent\":100,\"basis\":\"none\"}"));
		Expect(S.bOk && S.ProgressPercent == -1, "100 without verified_completion is not shown");
		S = ParseMissionStatus(W, 200, Swap(StatusBody("admitted", false, StartObj(false)), "GitHub workflow steps (not mission progress)", "Progress"));
		Expect(S.bOk && !S.bWorkflowLabelOk, "workflow steps without the exact label are not shown");
		S = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false), "null", "{\"checkerVerdict\":7,\"outcomeUnknown\":\"no\"}"));
		Expect(S.bOk && S.CheckerVerdict.empty() && S.bOutcomeUnknown, "an unreadable result is treated as outcome-unknown");
		S = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":false}", "50"));
		Expect(S.bOk && S.NextPollMs == StatusPollMinMs, "nextPollMs is clamped up");
		S = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":false}", "600000"));
		Expect(S.bOk && S.NextPollMs == StatusPollMaxMs, "nextPollMs is clamped down");
		S = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":false}", "null"));
		Expect(S.bOk && S.NextPollMs == StatusPollDefaultMs, "null nextPollMs on a live phase keeps polling");
		S = ParseMissionStatus(W, 200, StatusBody("failed", true, StartObj(false), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":false}", "null"));
		Expect(S.bOk && S.NextPollMs == 0, "null nextPollMs on a terminal phase stops polling");
		++StatusCases;

		// Reconcile: dispatch evidence -> Started.
		for (const R From : {R::Sending, R::Accepted, R::NotStarted})
		{
			Expect(StartRecordFromStatus(From, ParseMissionStatus(W, 200, StatusBody("dispatched", false, StartObj(true, "\"40242149156\"")))).Record == R::Started, "dispatched reconciles to Started");
			Expect(StartRecordFromStatus(From, ParseMissionStatus(W, 200, StatusBody("executing", false, StartObj(true), BoundRun))).Record == R::Started, "a bound run reconciles to Started");
		}
		++StatusCases;

		// FOUNDER RULING: outcome-unknown -> Start stays blocked; no automatic resend path.
		const char* const Ok = "RUN LIVE MISSION";
		const FMissionStatusRead Unknown = ParseMissionStatus(W, 200, StatusBody("unknown", false, StartObj(true)));
		const FMissionStatusRead UnknownFlag = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":true}"));
		const FMissionStatusRead Unreadable = ParseMissionStatus(W, 200, Swap(StatusBody("admitted", false, StartObj(false)), "\"recovery\":\"none\"", "\"recovery\":\"none\",\"requestUnreadable\":true"));
		Expect(Unknown.bOk && UnknownFlag.bOk && Unreadable.bOk && Unreadable.bRequestUnreadable, "the unknown fixtures read");
		for (const FMissionStatusRead* Read : {&Unknown, &UnknownFlag, &Unreadable})
		{
			R Record = StartRecordAfterAnswer(EStartOutcome::Uncertain, 200);
			for (int Poll = 0; Poll < 5; ++Poll)
			{
				const FStartReconcile Rec = StartRecordFromStatus(Record, *Read);
				Record = Rec.Record;
				Expect(Record == R::Sending && Rec.Why != nullptr && std::strstr(Rec.Why, "outcome unknown, needs reconciliation") != nullptr, "outcome-unknown keeps Start blocked, with the reason");
				Expect(!StartGateFor("admitted_waiting", true, false, Record, false, Ok).bSend, "no automatic resend (no click)");
				Expect(!StartGateFor("admitted_waiting", true, false, Record, true, Ok).bSend, "no resend even on a click while unreconciled");
			}
			// A transient not-started must also re-block when /status says unknown.
			Expect(StartRecordFromStatus(R::NotStarted, *Read).Record == R::Sending, "unknown re-blocks a not-started record");
		}
		Expect(StartRecordFromStatus(R::Sending, ParseMissionStatus(W, 503, "")).Record == R::Sending, "an unreadable /status changes nothing");
		++StatusCases;

		// Operator reconcile reflected as settled.
		const FMissionStatusRead Settled = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false, "null", RequestObj("settled"))));
		// F10: settled is NOT nothing-at-all (an intent exists): blocked until an operator clears it.
		Expect(StartRecordFromStatus(R::Sending, Settled).Record == R::Sending, "F10: settled keeps a Sending record blocked");
		Expect(StartRecordFromStatus(R::Accepted, Settled).Record == R::Accepted, "F10: settled keeps an Accepted record blocked");
		const FMissionStatusRead AckNothing = ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false, "null", "null")));
		const FStartReconcile Released = StartRecordFromStatus(R::Sending, AckNothing);
		Expect(AckNothing.bRequestFieldPresent && Released.Record == R::NotStarted && Released.bChanged, "F10: ACK on and nothing at all releases Start");
		Expect(!StartGateFor("admitted_waiting", true, false, Released.Record, false, Ok).bSend && StartGateFor("admitted_waiting", true, false, Released.Record, true, Ok).bSend,
			"a released Start sends only on the founder's click");
		Expect(StartRecordFromStatus(R::Sending, ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false)))).Record == R::Sending, "F10: ACK off (no start.request) never releases");
		Expect(StartRecordFromStatus(R::Sending, ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false, "null", RequestObj("accepted"))))).Record == R::Accepted, "a live accepted request blocks");
		Expect(StartRecordFromStatus(R::NotStarted, ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false, "null", RequestObj("claiming"))))).Record == R::Accepted, "a claiming request blocks");
		Expect(StartRecordFromStatus(R::Sending, ParseMissionStatus(W, 200, StatusBody("starting", false, StartObj(true)))).Record == R::Sending, "a Start running on the bridge blocks");
		Expect(StartRecordFromStatus(R::Accepted, ParseMissionStatus(W, 200, StatusBody("dispatching", false, StartObj(true)))).Record == R::Accepted, "dispatching keeps an ack blocked");
		Expect(StartRecordFromStatus(R::Sending, ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false, "null", RequestObj("interrupted"))))).Record == R::Refused, "an interrupted request is refused (no auto new key)");
		Expect(StartRecordFromStatus(R::Sending, ParseMissionStatus(W, 200, StatusBody("expired", true, StartObj(false), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":false}", "null"))).Record == R::Refused, "terminal without dispatch is refused");
		Expect(StartRecordFromStatus(R::None, ParseMissionStatus(W, 200, StatusBody("dispatching", false, StartObj(true)))).Record == R::Sending, "a claim with no local record is never offered");
		Expect(StartRecordFromStatus(R::None, ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false)))).Record == R::None, "no claim, no record: unchanged");
		Expect(StartRecordFromStatus(R::Started, ParseMissionStatus(W, 200, StatusBody("admitted", false, StartObj(false)))).Record == R::Started, "a Started record never regresses");
		Expect(StartRecordFromStatus(R::Refused, Settled).Record == R::Refused, "a Refused record never re-opens");
		++StatusCases;
	}

	// C4 (founder rulings 2026-10-30) + YUJI: percent only from status.progress and only as the verified 100; the
	// workflow's steps always carry their label; phase "completed" alone is never success; nothing un-emitted shown.
	int PanelCases = 0;
	bool StatusPanelHas(const FStatusPanel& Panel, const char* Piece)
	{
		if (Panel.Header.find(Piece) != std::string::npos) { return true; }
		for (const std::string& Line : Panel.Lines)
		{
			if (Line.find(Piece) != std::string::npos) { return true; }
		}
		return false;
	}
	bool StatusPanelInventsNothing(const FStatusPanel& Panel)
	{
		for (const char* Word : {"cost", "Cost", "model", "Model", "$", "USD", "usd", "token"})
		{
			if (StatusPanelHas(Panel, Word)) { return false; }
		}
		return true;
	}
	std::string StatusResult(const char* Verdict, bool bUnknown = false)
	{
		return std::string("{\"checkerVerdict\":") + (Verdict == nullptr ? std::string("null") : std::string("\"") + Verdict + "\"")
			+ ",\"outcomeUnknown\":" + (bUnknown ? "true" : "false") + "}";
	}
	const char* const VerifiedProgress = "\"progress\":{\"percent\":100,\"basis\":\"verified_completion\"}";
	const char* const NoProgress = "\"progress\":{\"percent\":null,\"basis\":\"none\"}";
	std::string Completed(const char* Verdict, bool bVerified)
	{
		const std::string Body = StatusBody("completed", true, StartObj(true, "\"18733051234\""), BoundRun, StatusResult(Verdict), "null");
		return bVerified ? Swap(Body, NoProgress, VerifiedProgress) : Body;
	}
	void StatusPanelFixtures()
	{
		{
			const FMissionStatusRead Pass = ParseMissionStatus(StatusWlj, 200, Completed("PASS", true));
			const FStatusPanel Panel = StatusPanelFor(Pass);
			Expect(Pass.bOk && StatusIsVerifiedSuccess(Pass) && Panel.bSuccess, "completed + PASS + verified completion is success");
			Expect(StatusPanelHas(Panel, "Mission progress: 100% (verified completion)") && StatusPanelHas(Panel, "PASS"), "only the verified success shows 100%");
			Expect(StatusPanelInventsNothing(Panel), "success shows no model or cost");
			++PanelCases;
		}
		{
			// YUJI 2026-10-30: phase "completed" covers FAIL and NOT_RUN too.
			for (const char* Verdict : {"FAIL", "NOT_RUN"})
			{
				const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, Completed(Verdict, false));
				const FStatusPanel Panel = StatusPanelFor(Read);
				Expect(Read.bOk && Read.Phase == EMissionStatusPhase::Completed, Verdict);
				Expect(!StatusIsVerifiedSuccess(Read) && !Panel.bSuccess, "completed alone is never success");
				Expect(StatusPanelHas(Panel, "not a success") && StatusPanelHas(Panel, Verdict) && !StatusPanelHas(Panel, "%") && !StatusPanelHas(Panel, "Mission completed"), "completed FAIL/NOT_RUN is worded as not a success");
			}
			const FMissionStatusRead Unverified = ParseMissionStatus(StatusWlj, 200, Completed("PASS", false));
			Expect(Unverified.bOk && !StatusIsVerifiedSuccess(Unverified) && !StatusPanelFor(Unverified).bSuccess, "PASS without verified completion is not success");
			const FMissionStatusRead Mixed = ParseMissionStatus(StatusWlj, 200, Completed("FAIL", true));
			Expect(Mixed.bOk && !StatusIsVerifiedSuccess(Mixed) && !StatusPanelHas(StatusPanelFor(Mixed), "100%"), "verified 100 with FAIL is not success");
			const FMissionStatusRead Grading = ParseMissionStatus(StatusWlj, 200, Swap(Swap(Completed("PASS", true), "\"phase\":\"completed\"", "\"phase\":\"grading\""), "\"terminal\":true", "\"terminal\":false"));
			Expect(!StatusIsVerifiedSuccess(Grading) && !StatusPanelFor(Grading).bSuccess, "PASS before completed is not success");
			++PanelCases;
		}
		{
			const std::string Executing = Swap(StatusBody("executing", false, StartObj(true, "\"18733051234\""), BoundRun),
				"\"stepsCompleted\":null,\"stepsTotal\":null", "\"stepsCompleted\":3,\"stepsTotal\":7");
			const FStatusPanel Panel = StatusPanelFor(ParseMissionStatus(StatusWlj, 200, Executing));
			Expect(Panel.bShow && !Panel.bSuccess && StatusPanelHas(Panel, "Mission status: executing"), "executing says executing");
			Expect(StatusPanelHas(Panel, "GitHub workflow steps (not mission progress): 3 of 7 finished") && !StatusPanelHas(Panel, "Mission progress"), "workflow steps carry their label; no mission percent");
			const std::string WrongLabel = Swap(Executing, "GitHub workflow steps (not mission progress)", "progress");
			const FMissionStatusRead Wrong = ParseMissionStatus(StatusWlj, 200, WrongLabel);
			Expect(Wrong.bOk && !StatusPanelHas(StatusPanelFor(Wrong), "3 of 7"), "an unlabelled workflow percent is never shown");
			Expect(StatusPanelInventsNothing(Panel), "executing shows no model or cost");
			++PanelCases;
		}
		{
			const FMissionStatusRead Unknown = ParseMissionStatus(StatusWlj, 200,
				StatusBody("dispatching", false, StartObj(true), "null", StatusResult(nullptr, true)));
			const FStatusPanel Panel = StatusPanelFor(Unknown);
			Expect(Panel.bOutcomeUnknown && !Panel.bSuccess && StatusPanelHas(Panel, "Outcome unknown -- needs reconciliation"), "outcome unknown is labelled");
			Expect(!StatusPanelHas(Panel, "did not succeed") && !StatusPanelHas(Panel, "%"), "outcome unknown is neither success nor failure");
			const FStatusPanel Failed = StatusPanelFor(ParseMissionStatus(StatusWlj, 200, StatusBody("did_not_start", true, StartObj(false), "null", StatusResult(nullptr), "null")));
			Expect(!Failed.bSuccess && StatusPanelHas(Failed, "Mission did not succeed -- did_not_start"), "did_not_start is a failure ending");
			Expect(!StatusPanelFor(ParseMissionStatus(StatusWlj, 500, "{}")).bShow, "an unreadable /status shows no panel");
			++PanelCases;
		}
		{
			FLiveFeed Feed;
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, LiveStep)));
			const FLivePanel Panel = LivePanelFor(Feed, 0);
			Expect(PanelHas(Panel, "GitHub workflow steps (not mission progress): 0 of 1 finished"), "live step count is labelled workflow steps");
			for (const std::string& Line : Panel.Lines) { Expect(Line.rfind("steps: ", 0) != 0, "no unlabelled steps line"); }
			++PanelCases;
		}
	}

	// C5 ENDINGS (Skywalker 2026-10-30 ruling 2, YUJI steering 1, R1): success only on a verified PASS; failure endings
	// play; outcome-unknown plays none; grading is never blank; a recorded replay refuses Start.
	int EndingCases = 0;
	void EndingFixtures()
	{
		const FMissionStatusRead VerifiedPass = ParseMissionStatus(StatusWlj, 200, Completed("PASS", true));
		Expect(SuccessGatedByStatus(EExecutionPhase::Completed, &VerifiedPass) == EExecutionPhase::Completed, "verified PASS keeps success");
		// F1 / M3: fail closed. No readable /status = no success.
		Expect(SuccessGatedByStatus(EExecutionPhase::Completed, nullptr) == EExecutionPhase::Grading, "F1: no /status read: no success (fail closed)");
		const FMissionStatusRead Unreadable = ParseMissionStatus(StatusWlj, 500, "{}");
		Expect(SuccessGatedByStatus(EExecutionPhase::Completed, &Unreadable) == EExecutionPhase::Grading, "F1: an unreadable /status: no success (fail closed)");
		Expect(SuccessGatedByStatus(EExecutionPhase::Failed, nullptr) == EExecutionPhase::Failed
			&& SuccessGatedByStatus(EExecutionPhase::OutcomeUnknown, nullptr) == EExecutionPhase::OutcomeUnknown, "F1: failing closed never touches other phases");
		for (const char* Verdict : {"FAIL", "NOT_RUN"})
		{
			// YUJI steering 1, beat side: completed FAIL/NOT_RUN never plays the success beat.
			const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, Completed(Verdict, false));
			const EExecutionPhase Gated = SuccessGatedByStatus(EExecutionPhase::Completed, &Read);
			Expect(Read.bOk && Gated == EExecutionPhase::Grading, "completed alone never reaches the success beat");
			FContractCursor Cursor;
			FExecutionView V; V.Phase = EExecutionPhase::Executing; V.Role = "coder"; V.TaskType = "build";
			(void)Cursor.Advance(V);
			V.Phase = Gated;
			for (const FContractBeat& Beat : Cursor.Advance(V)) { Expect(Beat.Type != "run.completed", "no run.completed without a verified PASS"); }
			Expect(!Cursor.Ended(), "completed FAIL/NOT_RUN under /status stays a wait, never success");
		}
		const FMissionStatusRead UnverifiedPass = ParseMissionStatus(StatusWlj, 200, Completed("PASS", false));
		Expect(SuccessGatedByStatus(EExecutionPhase::Completed, &UnverifiedPass) == EExecutionPhase::Grading, "PASS without verified completion is not the success beat");
		Expect(SuccessGatedByStatus(EExecutionPhase::Failed, &VerifiedPass) == EExecutionPhase::Failed
			&& SuccessGatedByStatus(EExecutionPhase::Executing, &VerifiedPass) == EExecutionPhase::Executing, "the gate never creates success or moves other phases");
		++EndingCases;
		{
			FContractCursor Cursor;
			FExecutionView V; V.Phase = EExecutionPhase::Executing; V.Role = "reviewer"; V.TaskType = "audit";
			(void)Cursor.Advance(V);
			V.Phase = EExecutionPhase::Grading;
			Expect(Cursor.Advance(V).empty() && !Cursor.Released() && !Cursor.Ended(), "grading neither releases nor ends");
			Expect(std::string(ContractTaskStateFor(V)) == "verification", "grading is shown as verification");
			V.Phase = EExecutionPhase::OutcomeUnknown;
			const std::vector<FContractBeat> B = Cursor.Advance(V);
			Expect(B.empty() && Cursor.Released() && Cursor.Ended(), "outcome unknown: no ending, the stage clears");
			Expect(std::string(ContractTaskStateFor(V)) != "failed" && std::string(ContractTaskStateFor(V)) != "completed", "outcome unknown is neither failure nor success");
			++EndingCases;
		}
		{
			FStartGate Open; Open.bOffer = true; Open.bSend = true; Open.Why = "";
			const FStartGate Recorded = RecordedReplayGate(Open, true);
			Expect(!Recorded.bOffer && !Recorded.bSend && std::string(Recorded.Why).find("RECORDED RUN, NOT LIVE") != std::string::npos, "R1: a recorded replay hard-refuses Start");
			const FStartGate Live = RecordedReplayGate(Open, false);
			Expect(Live.bOffer && Live.bSend, "R1 control: no replay leaves the gate as it was");
			++EndingCases;
		}
	}

	// C6 EVIDENCE LOGS: exact JSON lines; absent values are null; success only when verified; no model or cost.
	int LogCases = 0;
	void LogFixtures()
	{
		const FMissionStatusRead Pass = ParseMissionStatus(StatusWlj, 200, Completed("PASS", true));
		const std::string Read = FormatStatusReadLog(StatusWlj, Pass);
		Expect(Read.rfind("{\"event\":\"status_read\",\"wlj_run_id\":\"" + std::string(StatusWlj) + "\",\"http\":200,\"ok\":true,\"phase\":\"completed\",\"terminal\":true", 0) == 0, "status_read line opens with the run and phase");
		Expect(Read.find("\"progress_percent\":100") != std::string::npos && Read.find("\"checker_verdict\":\"PASS\"") != std::string::npos
			&& Read.find("\"verified_success\":true") != std::string::npos && Read.back() == '}', "status_read carries the verified success");
		const FMissionStatusRead Fail = ParseMissionStatus(StatusWlj, 200, Completed("FAIL", false));
		const std::string FailLine = FormatStatusReadLog(StatusWlj, Fail);
		Expect(FailLine.find("\"verified_success\":false") != std::string::npos && FailLine.find("\"progress_percent\":null") != std::string::npos, "completed FAIL logs no success and a null percent");
		Expect(FailLine.find("model") == std::string::npos && FailLine.find("cost") == std::string::npos, "the log invents no model or cost");
		const std::string Refused = FormatStatusReadLog(StatusWlj, ParseMissionStatus(StatusWlj, 503, "{}"));
		Expect(Refused.find("\"ok\":false,\"why\":") != std::string::npos && Refused.find("phase") == std::string::npos, "a refused read logs why, nothing else");
		++LogCases;
		Expect(FormatResyncLog("wlj_x", "seq_gap", 2, 41) == "{\"event\":\"resync\",\"wlj_run_id\":\"wlj_x\",\"reason\":\"seq_gap\",\"events_skipped\":2,\"last_seq\":41,\"next\":\"status_read\"}", "resync line, exact");
		Expect(FormatResyncLog("wlj_x", "reset", 0, -1).find("\"last_seq\":null") != std::string::npos, "resync with no seq: null");
		++LogCases;
		auto MakeBeat = [](std::string_view Wlj, std::string_view Type, EExecutionPhase Phase, std::int64_t Seq, const FMissionStatusRead* St,
			bool bApplied, std::string_view Stage)
		{
			FBeatEvidence B; B.WljRunId = Wlj; B.BeatType = Type; B.Phase = Phase; B.SourceSeq = Seq; B.Status = St; B.bApplied = bApplied; B.StageLabel = Stage;
			return B;
		};
		FBeatEvidence Actor = MakeBeat("wlj_x", "run.completed", EExecutionPhase::Completed, 57, &Pass, true, "COMPLETE / VERIFIED");
		Actor.bActor = true; Actor.ClientUtcMs = 1793400000123ULL; Actor.bClockOffsetKnown = true; Actor.ClockOffsetMs = -42; Actor.Source = "result";
		const std::string Beat = FormatBeatLog(Actor);
		Expect(Beat == "{\"event\":\"beat\",\"wlj_run_id\":\"wlj_x\",\"type\":\"run.completed\",\"role\":\"actor\",\"client_utc_ms\":1793400000123,\"clock_offset_ms\":-42,\"phase\":\""
			+ std::string(ExecutionPhaseWord(EExecutionPhase::Completed))
			+ "\",\"source\":\"result\",\"source_seq\":57,\"status_phase\":\"completed\",\"verified_success\":true,\"applied\":true,\"stage\":\"COMPLETE / VERIFIED\"}", "F4: beat line, exact (time, role, source)");
		const std::string NoStatus = FormatBeatLog(MakeBeat("wlj_x", "run.failed", EExecutionPhase::DidNotStart, -1, nullptr, false, ""));
		Expect(NoStatus.find("\"source_seq\":null,\"status_phase\":null,\"verified_success\":false,\"applied\":false,\"stage\":null}") != std::string::npos, "beat without status or seq: nulls, never success");
		Expect(NoStatus.find("\"role\":\"observer\"") != std::string::npos && NoStatus.find("\"clock_offset_ms\":null") != std::string::npos, "F4: observer role, unknown offset is null");
		Expect(FormatBeatLog(MakeBeat("wlj_\"q\\", "x", EExecutionPhase::Grading, 1, &Fail, true, "a\nb")).find("wlj_\\\"q\\\\") != std::string::npos
			&& FormatBeatLog(MakeBeat("w", "x", EExecutionPhase::Grading, 1, &Fail, true, "a\nb")).find("a\\u000ab") != std::string::npos, "log strings are escaped");
		++LogCases;
	}

	// YUJI M-b 2026-10-30: after a bridge restart start.requested is false and retryStartSafe true (journal only); only
	// start.request reveals the saved intent. Neither is ever permission to send; interrupted is explicit, never resent.
	int RestartCases = 0;
	void BridgeRestartFixtures()
	{
		using R = EStartRecord;
		const auto RestartedStart = [](const char* State)
		{
			return Swap(StartObj(false, "null", RequestObj(State)), "\"retryStartSafe\":false", "\"retryStartSafe\":true");
		};
		for (const char* State : {"accepted", "claiming"})
		{
			const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, StatusBody("admitted", false, RestartedStart(State)));
			Expect(Read.bOk && !Read.bRequested && Read.RequestState == State, State);
			for (const R Current : {R::None, R::NotStarted, R::Sending, R::Accepted})
			{
				const FStartReconcile Out = StartRecordFromStatus(Current, Read);
				Expect(Out.Record == R::Accepted, "a live request after a restart blocks Start");
				const FStartGate Gate = StartGateFor("admitted_waiting", true, false, Out.Record, true, "RUN LIVE MISSION");
				Expect(!Gate.bSend && Gate.Why != nullptr && Gate.Why[0] != '\0', "requested:false + retryStartSafe never lets Start send");
			}
		}
		{
			const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, StatusBody("admitted", false, RestartedStart("interrupted")));
			const FStartReconcile Out = StartRecordFromStatus(R::None, Read);
			Expect(Out.Record == R::Refused && std::strstr(Out.Why, "interrupted") != nullptr, "interrupted without a record is explicit and refused");
			Expect(!StartGateFor("admitted_waiting", true, false, Out.Record, true, "RUN LIVE MISSION").bSend, "interrupted is never resent");
			const FStatusPanel Panel = StatusPanelFor(Read);
			Expect(StatusPanelHas(Panel, "Start request interrupted -- nothing was dispatched") && !Panel.bSuccess, "interrupted is shown as non-dispatching");
		}
		{
			const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, StatusBody("admitted", false, RestartedStart("settled")));
			// F10 (2026-10-30): settled is an intent, not "nothing at all": a Sending / Accepted / unrecorded Start stays
			// blocked until an operator clears it. A record that already said not-started stays offered on a click only.
			for (const R Current : {R::None, R::Sending, R::Accepted})
			{
				const R Got = StartRecordFromStatus(Current, Read).Record;
				Expect(Got != R::NotStarted && !StartGateFor("admitted_waiting", true, false, Got, true, "RUN LIVE MISSION").bSend, "F10: settled keeps Start blocked");
			}
			const R Kept = StartRecordFromStatus(R::NotStarted, Read).Record;
			Expect(Kept == R::NotStarted && !StartGateFor("admitted_waiting", true, false, Kept, false, "RUN LIVE MISSION").bSend, "settled never sends without a click");
		}
		{
			// Control: nothing held at all (ACK on, request null) is the only release, and only from an open record.
			const FMissionStatusRead Free = ParseMissionStatus(StatusWlj, 200, StatusBody("admitted", false, StartObj(false, "null", "null")));
			Expect(StartRecordFromStatus(R::Sending, Free).Record == R::NotStarted && StartRecordFromStatus(R::None, Free).Record == R::None, "only nothing held releases");
			Expect(StartGateFor("admitted_waiting", true, false, R::NotStarted, true, "RUN LIVE MISSION").bSend, "control: the gate itself sends on a click when released");
		}
		++RestartCases;
	}


	// FIX COMMIT (YUJI M1/M2/m4/m6, Skywalker F1/F3/F4/F5/F10, 2026-10-30).
	int M1Cases = 0, M2Cases = 0, F4Cases = 0, F5Cases = 0, M6Cases = 0, F10Cases = 0;
	void FixCommitFixtures()
	{
		using R = EStartRecord;
		const char* const Ok = "RUN LIVE MISSION";
		{
			// M1 (Skywalker ruling 2026-10-30, YUJI review): a 503 is "nothing dispatched" only by its error.kind, from the
			// explicit before-claim list. The bodies are the bridge's exact ones at #493 9dcb1ad9 (err() = {error:{kind,message}},
			// relay-bridge/wonderland-mission-start-route.ts:233, wonderland-start-intents.ts:334). The message is never read.
			const std::string W = StatusWlj;
			auto Err = [](const char* Kind, const char* Message)
			{
				return std::string("{\"error\":{\"kind\":\"") + Kind + "\",\"message\":\"" + Message + "\"}}";
			};
			const std::string Safe[] = {
				// start-route.ts:246 and :251, exact.
				Err("julius_start_disabled", "Starting a mission from Wonderland is switched off. Nothing was dispatched."),
				Err("julius_start_not_configured", "The bridge has no repository or lane for a start. Nothing was dispatched."),
				// The code alone decides: any message, none, or extra fields.
				Err("julius_start_disabled", "The claim could not run. Check /status before trying again."),
				"{\"error\":{\"kind\":\"julius_start_not_configured\"}}",
				"{\"error\":{\"kind\":\"julius_start_disabled\",\"message\":\"x\"},\"retry\":true}",
			};
			for (const std::string& Body : Safe)
			{
				const FStartAnswer A = ParseStartAnswer(W, 503, Body);
				Expect(A.Outcome == EStartOutcome::Retryable && StartRecordAfterAnswer(A.Outcome, 503) == R::NotStarted, "M1: a 503 with a before-claim code is not started");
			}
			const std::string Unsafe[] = {
				// julius_start_unavailable, every message the bridge sends (start-route.ts:318/351, start-intents.ts:403, :441/:492, :496).
				Err("julius_start_unavailable", "The claim could not run. Check /status before trying again."),
				Err("julius_start_unavailable", "The Start could not be saved. Nothing was claimed or dispatched."),
				Err("julius_start_unavailable", "The saved Start requests could not be read. Nothing was claimed or dispatched."),
				// The old sentence with a non-allowed or missing code.
				Err("service_unavailable", "Nothing was claimed or dispatched."),
				Err("julius_dispatch_unavailable", "Wonderland admission store is not available. Nothing was reserved."),
				"{\"error\":{\"message\":\"Nothing was claimed or dispatched.\"}}",
				"{\"error\":{\"kind\":\"\",\"message\":\"Nothing was claimed or dispatched.\"}}",
				"{\"error\":{\"kind\":null,\"message\":\"Nothing was claimed or dispatched.\"}}",
				"{\"message\":\"Nothing was claimed or dispatched.\"}",
				// L1 (Skywalker N14): no kind at all.
				"{\"error\":{}}",
				"{\"error\":null}",
				"{}",
				"Nothing was claimed or dispatched.",
				// An allowed code in the wrong place or spelling is not that code.
				"{\"kind\":\"julius_start_disabled\"}",
				"{\"error\":\"julius_start_disabled\"}",
				"{\"error\":{\"code\":\"julius_start_disabled\"}}",
				Err("julius_start_disabled_x", "Nothing was dispatched."),
				Err("JULIUS_START_DISABLED", "Nothing was dispatched."),
				Err("julius_start_not_configured2", "Nothing was dispatched."),
				// Unknown code, no body, non-JSON.
				Err("julius_start_maintenance", "Nothing was dispatched."),
				"",
				"<html>503</html>",
				"{\"error\":{\"kind\":\"julius_start_unavailable\"}}",
			};
			for (const std::string& Body : Unsafe)
			{
				const FStartAnswer A = ParseStartAnswer(W, 503, Body);
				const R Record = StartRecordAfterAnswer(A.Outcome, 503);
				Expect(A.Outcome != EStartOutcome::Retryable && Record == R::Sending, "M1: any other 503 is outcome-unknown (Sending)");
				Expect(!StartGateFor("admitted_waiting", true, false, Record, true, Ok).bSend, "M1: any other 503 blocks Start until /status resolves");
			}
			// The allowed codes mean "not started" only on a 503: a 409 with the same kind is a refusal, and a 500 is unknown.
			Expect(StartRecordAfterAnswer(ParseStartAnswer(W, 409, Err("julius_start_disabled", "x")).Outcome, 409) == R::Refused, "M1 control: the code releases only on a 503");
			for (const int Http : {500, 502, 504})
			{
				for (const std::string& Body : {Err("julius_start_disabled", "x"), std::string("{}"), std::string("<html>"), std::string()})
				{
					Expect(StartRecordAfterAnswer(ParseStartAnswer(W, Http, Body).Outcome, Http) == R::Sending, "M1 control: 500 / 502 / 504 stay blocked whatever the body");
				}
			}
			++M1Cases;
			Expect(StartRecordAfterAnswer(ParseStartAnswer(W, 401, "").Outcome, 401) == R::NotStarted, "M1 control: 401 is still not started");
			for (const int Http : {0, 502, 504}) { Expect(StartRecordAfterAnswer(ParseStartAnswer(W, Http, "").Outcome, Http) == R::Sending, "M1 control: a lost answer stays blocked"); }
			++M1Cases;
		}
		{
			// M2: the saved record round-trips; anything unreadable is BLOCKED, never reset to None.
			const std::string Run = StatusWlj;
			const std::string Good = FormatSavedStartRecord(Run, "jstart_k", R::Sending, "", "jtrig_t");
			Expect(Good == "WJ1START 1\nrun " + Run + "\nkey jstart_k\nstate sending\nworkflow \ntrigger jtrig_t\n", "M2: saved record format, exact");
			const FSavedStartRecord Back = ParseSavedStartRecord(true, true, Good, Run);
			Expect(Back.Read == ESavedStartRead::Ok && Back.Record == R::Sending && Back.Key == "jstart_k" && Back.TriggerId == "jtrig_t", "M2: round trip");
			for (const R Each : {R::None, R::Sending, R::Started, R::Refused, R::NotStarted, R::Accepted})
			{
				Expect(ParseSavedStartRecord(true, true, FormatSavedStartRecord(Run, "k", Each, "40242149156", "t"), Run).Record == Each, "M2: every state round-trips");
			}
			Expect(ParseSavedStartRecord(false, false, "", Run).Read == ESavedStartRead::Absent && ParseSavedStartRecord(false, false, "", Run).Record == R::None, "M2: no file is None");
			const FSavedStartRecord Other = ParseSavedStartRecord(true, true, FormatSavedStartRecord("wlj_other", "k", R::Sending, "", "t"), Run);
			Expect(Other.Read == ESavedStartRead::OtherRun && Other.Record == R::None, "M2: another run's readable record is None here");
			Expect(ParseSavedStartRecord(true, true, "WJ1START 1\nrun " + Run + "\nkey k\nstate sending\nworkflow \n", Run).Read == ESavedStartRead::Ok, "M2: a pre-C1 record without a trigger still reads");
			const std::string Corrupt[] = {
				"",
				Good.substr(0, Good.size() - 1),
				Good.substr(0, Good.size() / 2),
				"WJ1START 2\nrun " + Run + "\nkey k\nstate sending\nworkflow \ntrigger t\n",
				"WJ1START 1\nrun " + Run + "\nkey k\nstate sending\nstate none\nworkflow \ntrigger t\n",
				"WJ1START 1\nrun " + Run + "\nkey k\nstate maybe\nworkflow \ntrigger t\n",
				"WJ1START 1\nrun " + Run + "\nstate sending\nworkflow \ntrigger t\n",
				"WJ1START 1\nrun " + Run + "\nkey k\nstate sending\nworkflow \ntrigger t\ngarbage\n",
				"WJ1START 1\nrun " + Run + "\nkey k\nstate unreadable\nworkflow \ntrigger t\n",
			};
			for (const std::string& Text : Corrupt)
			{
				const FSavedStartRecord Got = ParseSavedStartRecord(true, true, Text, Run);
				Expect(Got.Read == ESavedStartRead::Unreadable && Got.Record == R::Unreadable, "M2: a corrupt record is unreadable, not None");
			}
			Expect(ParseSavedStartRecord(true, false, Good, Run).Record == R::Unreadable, "M2: a file that exists but cannot be read is unreadable");
			++M2Cases;
			for (const bool bClick : {false, true})
			{
				const FStartGate Gate = StartGateFor("admitted_waiting", true, false, R::Unreadable, bClick, Ok);
				Expect(!Gate.bSend && !Gate.bOffer && Gate.Why != nullptr && std::strstr(Gate.Why, "unreadable") != nullptr, "M2: an unreadable record blocks Start, even on a click");
			}
			const FMissionStatusRead Nothing = ParseMissionStatus(StatusWlj, 200, StatusBody("admitted", false, StartObj(false, "null", "null")));
			Expect(StartRecordFromStatus(R::Unreadable, Nothing).Record == R::Unreadable, "M2: nothing at all on the bridge never releases an unreadable record");
			Expect(StartRecordFromStatus(R::Unreadable, ParseMissionStatus(StatusWlj, 200, StatusBody("dispatched", false, StartObj(true, "\"40242149156\"")))).Record == R::Started, "M2: a dispatch makes it Started (still blocked)");
			Expect(std::string(SavedStartStateWord(R::Unreadable)) == "unreadable" && std::string(SavedStartStateWord(R::NotStarted)) == "not_started", "M2: words");
			++M2Cases;
			// n1 (YUJI 2026-10-30): an unreadable record is moved aside, never replaced; Start stays blocked while it exists.
			Expect(QuarantinedStartRecordName("/s/SaveGames/JuliusJ1/start.v1", "20261030T120000123Z") == "/s/SaveGames/JuliusJ1/start.v1.corrupt-20261030T120000123Z", "n1: moved-aside name, exact");
			for (const char* BadStamp : {"", "2026-10-30", "../x", "20261030T12/00", "20261030 120000", "123456789012345678901234567890123"})
			{
				Expect(QuarantinedStartRecordName("/s/start.v1", BadStamp).empty(), "n1: a stamp that is not plain digits/T/Z moves nothing");
			}
			Expect(QuarantinedStartRecordName("", "1").empty(), "n1: no record path, no name");
			const std::string CorruptText = Good.substr(0, Good.size() / 2);
			const FSavedStartRecord CorruptRead = ParseSavedStartRecord(true, true, CorruptText, Run);
			Expect(!SavedStartRecordMayBeReplaced(CorruptRead.Read) && !SavedStartRecordMayBeReplaced(ParseSavedStartRecord(true, false, "", Run).Read), "n1: an unreadable file on disk is never replaced");
			Expect(SavedStartRecordMayBeReplaced(ESavedStartRead::Absent) && SavedStartRecordMayBeReplaced(ESavedStartRead::Ok) && SavedStartRecordMayBeReplaced(ESavedStartRead::OtherRun), "n1 control: absent / readable files may be replaced");
			// The evidence case: a /status that shows the dispatch promotes the unreadable record to Started, and the unreadable
			// file it came from still may not be replaced (it is moved aside first, or nothing is written).
			const FMissionStatusRead DispatchedRead = ParseMissionStatus(StatusWlj, 200, StatusBody("dispatched", false, StartObj(true, "\"40242149156\"")));
			Expect(StartRecordFromStatus(R::Unreadable, DispatchedRead).Record == R::Started && !SavedStartRecordMayBeReplaced(CorruptRead.Read), "n1: Started from /status never licenses writing over the corrupt file");
			FSavedStartRecord AbsentRec;
			const FSavedStartRecord OtherRec = ParseSavedStartRecord(true, true, FormatSavedStartRecord("wlj_other", "k", R::NotStarted, "", "t"), Run);
			Expect(StartRecordFromDisk(AbsentRec, true) == R::Unreadable && StartRecordFromDisk(OtherRec, true) == R::Unreadable, "n1: a moved-aside record keeps Start blocked (no record / another run's)");
			Expect(StartRecordFromDisk(CorruptRead, false) == R::Unreadable && StartRecordFromDisk(CorruptRead, true) == R::Unreadable, "n1: unreadable stays unreadable");
			Expect(StartRecordFromDisk(AbsentRec, false) == R::None && StartRecordFromDisk(OtherRec, false) == R::None, "n1 control: nothing moved aside, no record is None");
			const FSavedStartRecord StartedRec = ParseSavedStartRecord(true, true, FormatSavedStartRecord(Run, "k", R::Started, "40242149156", "t"), Run);
			const FSavedStartRecord NotStartedRec = ParseSavedStartRecord(true, true, FormatSavedStartRecord(Run, "k", R::NotStarted, "", "t"), Run);
			Expect(StartRecordFromDisk(StartedRec, true) == R::Started && StartRecordFromDisk(NotStartedRec, false) == R::NotStarted, "n1: this run's readable record is taken as saved");
			Expect(!StartGateFor("admitted_waiting", true, false, StartRecordFromDisk(AbsentRec, true), true, Ok).bSend, "n1: the gate refuses while a record is moved aside");
			++M2Cases;
		}
		{
			// F5: phase admitted + start.requested:true + no request state: Start stays blocked (M08).
			const std::string Hash = std::string("\"") + std::string(64, 'b') + "\"";
			const std::string Bodies[] = {
				StatusBody("admitted", false, StartObj(true)),
				StatusBody("admitted", false, StartObj(true, "null", "null")),
				StatusBody("admitted", false, Swap(StartObj(false, "null", "null"), "\"startKeyHash\":null", "\"startKeyHash\":" + Hash)),
			};
			for (const std::string& Body : Bodies)
			{
				const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, Body);
				Expect(Read.bOk && Read.RequestState.empty() && Read.Phase == EMissionStatusPhase::Admitted, "F5 fixture reads");
				Expect(!StatusShowsNothingAtAll(Read), "F5: a claim is not nothing at all");
				for (const R Current : {R::None, R::Sending, R::Accepted, R::NotStarted})
				{
					const R Got = StartRecordFromStatus(Current, Read).Record;
					Expect(Got != R::NotStarted && !StartGateFor("admitted_waiting", true, false, Got, true, Ok).bSend, "F5: admitted + requested + no request keeps Start blocked");
				}
			}
			++F5Cases;
		}
		{
			// F10: release ONLY when ACK on, readable, and no intent or claim at all.
			const FMissionStatusRead Nothing = ParseMissionStatus(StatusWlj, 200, StatusBody("admitted", false, StartObj(false, "null", "null")));
			Expect(StatusShowsNothingAtAll(Nothing), "F10: the one releasing shape");
			for (const R Current : {R::Sending, R::Accepted})
			{
				const FStartReconcile Rec = StartRecordFromStatus(Current, Nothing);
				Expect(Rec.Record == R::NotStarted && !StartGateFor("admitted_waiting", true, false, Rec.Record, false, Ok).bSend
					&& StartGateFor("admitted_waiting", true, false, Rec.Record, true, Ok).bSend, "F10: released only to a click");
			}
			struct FCase { std::string Body; const char* Why; };
			const FCase Held[] = {
				{StatusBody("admitted", false, StartObj(false)), "ACK off"},
				{StatusBody("admitted", false, StartObj(false, "null", RequestObj("settled"))), "settled"},
				{StatusBody("admitted", false, StartObj(false, "null", RequestObj("accepted"))), "accepted"},
				{StatusBody("admitted", false, StartObj(false, "null", RequestObj("claiming"))), "claiming"},
				{Swap(StatusBody("admitted", false, StartObj(false, "null", "null")), "\"recovery\":\"none\"", "\"recovery\":\"none\",\"requestUnreadable\":true"), "request unreadable"},
				{StatusBody("admitted", false, StartObj(false, "null", "null"), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":true}"), "outcome unknown"},
				{StatusBody("dispatching", false, StartObj(true, "null", "null")), "dispatching"},
				{StatusBody("unknown", false, StartObj(false, "null", "null")), "unknown"},
			};
			for (const FCase& Case : Held)
			{
				const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, Case.Body);
				Expect(Read.bOk && !StatusShowsNothingAtAll(Read), Case.Why);
				for (const R Current : {R::Sending, R::Accepted})
				{
					const R Got = StartRecordFromStatus(Current, Read).Record;
					Expect(Got != R::NotStarted && !StartGateFor("admitted_waiting", true, false, Got, true, Ok).bSend, Case.Why);
				}
			}
			Expect(StartRecordFromStatus(R::Sending, ParseMissionStatus(StatusWlj, 503, "")).Record == R::Sending, "F10: no readable /status never releases");
			++F10Cases;
		}
		{
			// m6: /status did_not_start / interrupted / expired / failed play the failure ending once; unknown plays none.
			FExecutionView Waiting; Waiting.Phase = EExecutionPhase::Starting;
			const char* const Plain = "{\"checkerVerdict\":null,\"outcomeUnknown\":false}";
			for (const char* Ph : {"did_not_start", "interrupted", "expired", "failed"})
			{
				const FMissionStatusRead Read = ParseMissionStatus(StatusWlj, 200, StatusBody(Ph, true, StartObj(false, "null", "null"), "null", Plain, "null"));
				Expect(Read.bOk, Ph);
				const FExecutionView V = StatusFailureEnding(Waiting, &Read);
				Expect(V.Phase == EExecutionPhase::DidNotStart || V.Phase == EExecutionPhase::Failed, Ph);
				Expect(std::string(V.CauseSource) == "status" && V.Detail.find(Ph) != std::string::npos, "m6: the ending names the /status phase");
				FContractCursor Cursor;
				FExecutionView Exec; Exec.Phase = EExecutionPhase::Executing; Exec.Role = "coder"; Exec.TaskType = "build";
				(void)Cursor.Advance(Exec);
				int Failed = 0;
				for (int Poll = 0; Poll < 4; ++Poll)
				{
					for (const FContractBeat& Beat : Cursor.Advance(StatusFailureEnding(Exec, &Read))) { Failed += Beat.Type == "run.failed" ? 1 : 0; Expect(Beat.Type != "run.completed", "m6: never success"); }
				}
				Expect(Failed == 1 && Cursor.Ended(), "m6: the failure ending plays exactly once");
			}
			const FMissionStatusRead Interrupted = ParseMissionStatus(StatusWlj, 200, StatusBody("interrupted", true, StartObj(false, "null", "null"), "null", Plain, "null"));
			Expect(StatusFailureEnding(Waiting, &Interrupted).Phase == EExecutionPhase::Failed, "m6: interrupted is a failure");
			++M6Cases;
			const FMissionStatusRead Unknown = ParseMissionStatus(StatusWlj, 200, StatusBody("failed", true, StartObj(false, "null", "null"), "null", "{\"checkerVerdict\":null,\"outcomeUnknown\":true}", "null"));
			Expect(StatusFailureEnding(Waiting, &Unknown).Phase == EExecutionPhase::Starting, "m6: outcome unknown plays no ending");
			FExecutionView Lost; Lost.Phase = EExecutionPhase::OutcomeUnknown;
			Expect(StatusFailureEnding(Lost, &Interrupted).Phase == EExecutionPhase::OutcomeUnknown, "m6: an outcome-unknown view is never turned into a failure");
			FExecutionView Done; Done.Phase = EExecutionPhase::Failed; Done.Detail = "Checker: FAIL";
			Expect(StatusFailureEnding(Done, &Interrupted).Detail == "Checker: FAIL", "m6: an ending already chosen is kept");
			Expect(StatusFailureEnding(Waiting, nullptr).Phase == EExecutionPhase::Starting && StatusFailureEnding(Waiting, &Read503()).Phase == EExecutionPhase::Starting, "m6: no readable /status changes nothing");
			const FMissionStatusRead Live = ParseMissionStatus(StatusWlj, 200, StatusBody("executing", false, StartObj(true), BoundRun));
			Expect(StatusFailureEnding(Waiting, &Live).Phase == EExecutionPhase::Starting, "m6: a live phase is not an ending");
			++M6Cases;
		}
		{
			// F4: the beat's source_seq is the seq that CAUSED it.
			const char* const PJ = "Preflight, then the live mission";
			const char* const LS = "LIVE: run the first real Julius mission";
			const std::string Gates = Job(1, "spend-tag", "completed", "success") + "," + Job(2, "paid-slot", "in_progress", nullptr);
			FExecutionView V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Phase(5, "coder", "build", 0) + "," + Job(9, "paid-slot", "completed", "success")));
			Expect(V.Phase == EExecutionPhase::Executing && V.CauseSeq == 5 && std::string(V.CauseSource) == "events", "F4: a task sample's beat carries ITS seq, not the newest");
			V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(4, PJ, LS, "in_progress", nullptr) + "," + Job(7, "paid-slot", "completed", "success")));
			Expect(V.Phase == EExecutionPhase::Executing && V.CauseSeq == 4, "F4: the LIVE step's seq");
			V = ViewOf(LiveBody(Top("in_progress", nullptr, true), Gates + "," + Step(4, PJ, LS, "in_progress", nullptr) + "," + Step(6, PJ, LS, "completed", "failure") + "," + Job(8, "paid-slot", "completed", "success")));
			Expect(V.Phase == EExecutionPhase::Failed && V.CauseSeq == 6, "F4: a LIVE failure carries the failing step's seq");
			const std::string Ran = Gates + "," + Step(4, PJ, LS, "completed", "success");
			V = ViewOf(LiveBody(Top("completed", "success", false), Ran), ECheckerVerdict::Pass, true);
			Expect(V.Phase == EExecutionPhase::Completed && V.CauseSeq == -1 && std::string(V.CauseSource) == "result", "F4: a /result-decided ending says result, no seq");
			++F4Cases;
		}
	}

	// C3 (founder ruling 2026-10-30): a seq gap or reset:true clears the latches and resyncs from /status (never a stale
	// "running"); live_view_unconfigured is a known reason; one bad event field never drops the whole page.
	int ResyncCases = 0;
	void ResyncFixtures()
	{
		const std::string Good = LiveBody(LiveTop, std::string(LiveStep) + "," + LivePhase);
		const std::string BadRolePhase = Swap(LivePhase, "\"coder\"", "\"grok\"");
		{
			const FLiveRead Read = ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, std::string(LiveStep) + "," + BadRolePhase));
			Expect(Read.bParsed && Read.Events.size() == 1 && Read.Events[0].Seq == 3, "a bad event keeps the rest of the page");
			Expect(Read.SkippedSeqs.size() == 1 && Read.SkippedSeqs[0] == 4, "the bad event is named by its seq");
			Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(LiveStep, "\"seq\":3", "\"seq\":\"3\""))).bParsed, "an unreadable seq still refuses the page");
			Expect(!ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, std::string(LiveStep) + ",7")).bParsed, "a non-object event still refuses the page");
			++ResyncCases;
		}
		{
			FLiveFeed Feed;
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, Good));
			Expect(Feed.LiveStepStarted() && Feed.TaskPhaseSeen() && !Feed.Resyncing() && Feed.TakeResyncRequest() == nullptr, "a contiguous read latches and asks nothing");
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(LivePhase, "\"seq\":4", "\"seq\":6"))));
			Expect(Feed.Resyncing() && Feed.Events().empty() && Feed.Cursor().empty(), "a seq gap drops the stream and its cursor");
			Expect(!Feed.LiveStepStarted() && !Feed.TaskPhaseSeen() && Feed.HasRead(), "a seq gap clears every latch");
			const char* Why = Feed.TakeResyncRequest();
			Expect(Why != nullptr && std::strcmp(Why, "seq_gap") == 0 && Feed.TakeResyncRequest() == nullptr, "a seq gap asks for /status once");
			const FLivePanel Panel = LivePanelFor(Feed, 0);
			Expect(Panel.bShow && !Panel.bLive && PanelHas(Panel, "RESYNCING") && PanelHas(Panel, "18733051234") && Panel.Lines.empty(), "resync shows nothing old");
			Expect(!PanelHas(Panel, "LIVE --"), "resync is never labelled live");
			Expect(!PanelHas(Panel, "running") && !PanelHas(Panel, "now"), "resync never says running");
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(LiveStep, "\"seq\":3", "\"seq\":1"))));
			Expect(!Feed.Resyncing() && Feed.Events().size() == 1 && Feed.LiveStepStarted(), "the replay from seq 1 rebuilds the latches");
			++ResyncCases;
		}
		{
			FLiveFeed Feed;
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, Good));
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(BadRolePhase, "\"seq\":4", "\"seq\":5"))));
			Expect(!Feed.Resyncing() && Feed.SkippedEvents() == 1 && Feed.Events().size() == 2, "a skipped event is not a gap");
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(LivePhase, "\"seq\":4", "\"seq\":6"))));
			Expect(!Feed.Resyncing() && Feed.Events().size() == 3 && Feed.TakeResyncRequest() == nullptr, "the seq after a skipped one is contiguous");
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(LiveTop, Swap(LivePhase, "\"seq\":4", "\"seq\":6"))));
			Expect(!Feed.Resyncing() && Feed.Events().size() == 3, "a repeated seq is neither a gap nor a duplicate");
			++ResyncCases;
		}
		{
			FLiveFeed Feed;
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, Good));
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(std::string(LiveTop) + ",\"reset\":true", Swap(LivePhase, "\"seq\":4", "\"seq\":1"))));
			Expect(!Feed.LiveStepStarted() && Feed.TaskPhaseSeen() && Feed.Events().size() == 1, "reset clears the old epoch's latches");
			const char* Why = Feed.TakeResyncRequest();
			Expect(Why != nullptr && std::strcmp(Why, "reset") == 0, "reset asks for /status");
			++ResyncCases;
		}
		{
			const std::string Unconfigured = "\"workflowRunId\":null,\"source\":\"none\",\"reason\":\"live_view_unconfigured\",\"live\":false,"
				"\"stale\":false,\"mode\":null,\"runStatus\":null,\"runConclusion\":null,\"fetchedAt\":\"x\",\"next\":null";
			const FLiveRead Read = ParseLiveEvents(LiveWlj, 200, LiveBody(Unconfigured, ""));
			Expect(Read.bParsed, "live_view_unconfigured is a known reason");
			FLiveFeed Feed;
			Feed.Apply(Read);
			Expect(PanelHas(LivePanelFor(Feed, 0), "Live view unavailable: live_view_unconfigured"), "live_view_unconfigured is said plainly");
			++ResyncCases;
		}
		{
			FLiveFeed Feed;
			Feed.Apply(ParseLiveEvents(LiveWlj, 200, Good));
			const FLivePanel Fresh = LivePanelFor(Feed, 0);
			Expect(Fresh.bLive && PanelHas(Fresh, "now running: "), "a fresh live read says now running");
			const FLivePanel Silent = LivePanelFor(Feed, LiveNoReadAfterMs + 1);
			Expect(!Silent.bLive && PanelHas(Silent, "STALE") && !PanelHas(Silent, "now running") && !PanelHas(Silent, "now: "), "silence is stale, never running");
			Expect(PanelHas(Silent, "was running: ") && PanelHas(Silent, "last sampled: "), "stale names only what was last seen");
			FLiveFeed Lost;
			Lost.Apply(ParseLiveEvents(LiveWlj, 200, Swap(Good, "\"stale\":false", "\"stale\":true")));
			const FLivePanel LostPanel = LivePanelFor(Lost, 0);
			Expect(!LostPanel.bLive && PanelHas(LostPanel, "STALE") && !PanelHas(LostPanel, "now running"), "the bridge's stale flag is never live");
			FLiveFeed Done;
			Done.Apply(ParseLiveEvents(LiveWlj, 200, LiveBody(Swap(Swap(Swap(LiveTop, "\"live\":true", "\"live\":false"), "\"runStatus\":\"in_progress\"", "\"runStatus\":\"completed\""), "\"runConclusion\":null", "\"runConclusion\":\"success\""), LiveStep)));
			Expect(!PanelHas(LivePanelFor(Done, LiveNoReadAfterMs * 10), "STALE"), "a finished run's silence is not stale");
			++ResyncCases;
		}
	}
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
	Expect(ResultPanelFor(FResultRead{}).bFinished == false, "no result is not finished");
	++Results;
	FResultRead Unverified;
	Unverified.bReported = true;
	Unverified.bVerified = false;
	Unverified.ArtifactName.bKnown = true;
	Unverified.ArtifactName.Text = "julius-live-evidence";
	const FResultPanel ShownFalse = ResultPanelFor(Unverified);
	Expect(ShownFalse.bReported && ShownFalse.bVerified == false && ShownFalse.bShowsArtifact == false, "unverified artifact hidden");
	Expect(ShownFalse.bFinished == false, "unverified is not finished");
	Expect(Same(ShownFalse.Line, CopyNoResultYet), "unverified line");
	Expect(!HasLine(ShownFalse, "archive.artifactName: julius-live-evidence"), "unverified name hidden");
	++Results;
	FResultRead Verified;
	Verified.bReported = true;
	Verified.bVerified = true;
	Verified.ArtifactName.bKnown = true;
	Verified.ArtifactName.Text = "julius-live-evidence";
	Verified.TraceId.bKnown = true;
	Verified.TraceId.Text = "0ef34f0df7cf2cf89b844dcfa5fe084f";
	const FResultPanel ShownTrue = ResultPanelFor(Verified);
	Expect(ShownTrue.bShowsArtifact && ShownTrue.bVerified && ShownTrue.bFinished, "verified artifact");
	Expect(Same(ShownTrue.Line, CopyStateCompleted), "verified line is the route state");
	Expect(HasLine(ShownTrue, "archive.artifactName: julius-live-evidence"), "verified name");
	Expect(HasLine(ShownTrue, "traceId: 0ef34f0df7cf2cf89b844dcfa5fe084f"), "verified trace");
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
	Eager.Body.ArtifactName.bKnown = true;
	Eager.Body.ArtifactName.Text = "julius-live-evidence";
	Flow.NoteResult(Eager);
	Expect(Eager.bCall == false, "reader is not called without a wlj_ id");
	Expect(Flow.View().Result.bShowsArtifact == false, "bad id shows no artifact");
	++FlowSteps;
	Flow.NoteClientRunId(WljOk);
	Flow.NoteResult(Eager);
	Expect(Eager.bCall, "reader is called for the minted id");
	Expect(Flow.View().Result.bShowsArtifact, "verified read shows the artifact slot");
	Expect(Same(Flow.View().Result.Line, CopyStateCompleted), "verified read line");
	Expect(HasLine(Flow.View().Result, "archive.artifactName: julius-live-evidence"), "verified read names the artifact");
	++FlowSteps;
	Eager.bCall = false;
	Eager.Body.bVerified = false;
	Flow.NoteResult(Eager);
	Expect(Flow.View().Result.bShowsArtifact == false, "verified false shows no artifact");
	Expect(!HasLine(Flow.View().Result, "archive.artifactName: julius-live-evidence"), "verified false hides the artifact");
	Expect(Same(Flow.View().Result.Line, CopyNoResultYet), "verified false line");
	++FlowSteps;
	FAbsentResultReader Absent;
	Flow.NoteResult(Absent);
	Expect(Same(Flow.View().Result.Line, CopyNoResultYet) && Flow.View().Result.bShowsArtifact == false, "absent reader");
	Expect(Flow.View().Result.bFinished == false, "absent reader is not finished");
	++FlowSteps;

	// RESUME: the wrapper restored an open pair after a restart. Watch it; never offer a second paid Confirm.
	FMissionFlow Resumed;
	Resumed.SetOffers({FMissionOffer{"julius-inworld-data-1", "julius-inworld-data-1"}});
	Expect(Resumed.ResumeWatching("other") == false && Resumed.View().Step == EFlowStep::AtTerminal, "resume refuses an unoffered id");
	Expect(Resumed.ResumeWatching("") == false, "resume refuses an empty id");
	++FlowSteps;
	Expect(Resumed.ResumeWatching("julius-inworld-data-1"), "resume an offered id");
	const FFlowView ResumedView = Resumed.View();
	Expect(ResumedView.Step == EFlowStep::Watching && ResumedView.bDispatchHanded && ResumedView.bShowProgress, "resume watches");
	Expect(!ResumedView.bShowConfirm && Resumed.Confirm().bSend == false, "resume offers no second confirm");
	Expect(Same(ResumedView.Result.Line, CopyNoResultYet) && ResumedView.Result.bFinished == false, "resume invents no result");
	++FlowSteps;
	Expect(Resumed.ResumeWatching("julius-inworld-data-1") == false, "resume is once");
	Expect(Flow.ResumeWatching("julius-first-live") == false, "no resume after a handed dispatch");
	++FlowSteps;

	// START AGAIN (REVIEW #456 M4): only from Watching; back to Choosing with nothing chosen and nothing sent.
	FMissionFlow Again;
	Again.SetOffers({FMissionOffer{"julius-inworld-data-1", "julius-inworld-data-1"}});
	Expect(Again.StartAgain() == false, "start again refused at the terminal");
	Again.InteractWithTerminal();
	Expect(Again.StartAgain() == false, "start again refused while choosing");
	Expect(Again.ResumeWatching("julius-inworld-data-1"), "watching before start again");
	Again.NoteClientRunId(WljOk);
	Expect(Again.StartAgain(), "start again from watching");
	const FFlowView AgainView = Again.View();
	Expect(AgainView.Step == EFlowStep::Choosing && AgainView.bShowChoice && !AgainView.bShowConfirm && !AgainView.bShowProgress, "start again shows the choice");
	Expect(!AgainView.bDispatchHanded && !AgainView.bRunIdOk && Again.Confirm().bSend == false, "start again keeps no run and sends nothing");
	Expect(Again.Offers().size() == 1 && Again.ChooseMission("julius-inworld-data-1") && Again.Confirm().bSend, "start again offers the mission again");
	Expect(std::strstr(CopyStateCompleted, "not independently verified") != nullptr, "completed copy names its source");
	++FlowSteps;

	BridgeRouteFixtures();
	PhaseFixtures();
	LiveFixtures();
	StartFixtures();
	ExecFixtures();
	StartAckFixtures();
	StatusFixtures();
	ResyncFixtures();
	StatusPanelFixtures();
	BridgeRestartFixtures();
	EndingFixtures();
	LogFixtures();
	FixCommitFixtures();

	if (Failures != 0)
	{
		std::printf("J1 MISSION FLOW KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::printf(
		"J1 MISSION FLOW KAT PASS meanings=%d route=%d result=%d flow=%d windows=%d bridge=%d phases=%d live=%d start=%d exec=%d ack=%d status=%d resync=%d panel=%d restart=%d ending=%d log=%d m1=%d m2=%d f4=%d f5=%d m6=%d f10=%d\n",
		Meanings, Routes, Results, FlowSteps, Windows, Bridge, PhaseCases, LiveCases, StartCases, ExecCases, AckCases, StatusCases, ResyncCases, PanelCases, RestartCases, EndingCases, LogCases, M1Cases, M2Cases, F4Cases,
		F5Cases, M6Cases, F10Cases);
	return 0;
}

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

	if (Failures != 0)
	{
		std::printf("J1 MISSION FLOW KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::printf(
		"J1 MISSION FLOW KAT PASS meanings=%d route=%d result=%d flow=%d windows=%d bridge=%d phases=%d\n",
		Meanings, Routes, Results, FlowSteps, Windows, Bridge, PhaseCases);
	return 0;
}

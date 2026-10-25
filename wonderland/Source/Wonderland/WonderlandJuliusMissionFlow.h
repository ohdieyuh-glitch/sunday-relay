// WONDERLAND -- the player-facing J1 mission flow. Standard C++17, no Unreal include.
//
// The wrapper (WonderlandJuliusMissionClient) mints the wlj_ id, posts admission, and polls.
// This layer only decides which screen the player is on, and which words that screen may show.
// It does not mint, it does not parse status JSON, and it does not infer spend or completion.
//
// PROGRESS. The words are WonderlandJuliusMissionLogic::ProgressDisplayLabel, or the wrapper's own
// player label when the wrapper has not published a progress meaning yet. `dispatched` (the status
// route, OperatorStarted) is the furthest progress this flow will show until BRIDGE's result route
// exists. Julius states past that, and the wrapper tokens "running" and "completed", stay at that
// ceiling. They are not a finished mission.
//
// RESULT. A separate reader. FBridgeMissionResultClient parses the JSON bodies of
// GET /relay-api/wonderland/julius/missions/{wljRunId}/result and /progress
// (relay-bridge/wonderland-mission-result-route.ts at 7e71a122, phases and projectBrainRevision at
// d9880ad4). It does not fetch them and it does not derive a trace id, a span id, a cost, a phase
// list, a revision, or an artifact reference. An unplugged reader reports nothing, and
// the panel says "No result reported yet". dispatched stays the furthest progress until a read verifies.
//
// WINDOWS. The bridge's operator window is 360 minutes from acceptance. The client hold is 362
// minutes (that window plus one slow poll). PollDispatchWatchMs is also 360 minutes, but it starts
// at dispatchedAt. It is not the operator window and it is not the hold.
#pragma once

#include "WonderlandJuliusMissionProgress.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace WonderlandJuliusMissionFlow
{
	/** 360 minutes from acceptance. Not PollHoldWatchMs, and not the dispatchedAt watch. */
	inline constexpr std::uint64_t BridgeOperatorWindowMs = 360ull * 60ull * 1000ull;
	static_assert(BridgeOperatorWindowMs + static_cast<std::uint64_t>(WonderlandJuliusMissionLogic::PollSlowDelayMs)
		== WonderlandJuliusMissionLogic::PollHoldWatchMs);
	static_assert(BridgeOperatorWindowMs != WonderlandJuliusMissionLogic::PollHoldWatchMs);

	inline constexpr const char* CopyPaidNature =
		"This is a paid Julius mission. The bridge is what charges for it.";
	inline constexpr const char* CopyPaidOnDispatch =
		"A run is only paid once the bridge reports dispatch.";
	inline constexpr const char* CopyBridgeWindow =
		"The bridge gives the operator 360 minutes from acceptance.";
	inline constexpr const char* CopyClientHold =
		"This client keeps the watch for 362 minutes: the bridge window plus one slow poll.";
	inline constexpr const char* CopyNoResultYet = "No result reported yet";
	/** The result route's state word, copied onto the panel only after the completion evidence verifies. */
	/** The bridge's own completion check, not an independent verdict (REVIEW #456 M4). Becomes "state: completed" only
	 *  once the hidden-checker verdict (Julius PR-B) is part of the read. */
	inline constexpr const char* CopyStateCompleted = "state: completed (bridge-reported; not independently verified)";
	/** PR-B: the governed hidden checker PASSED this run. The only "Completed" the panel shows as verified. */
	inline constexpr const char* CopyStateCompletedChecked = "state: completed (checker PASS)";
	/** PR-B: the governed hidden checker FAILED this run. A failed evaluation, never shown as completed. */
	inline constexpr const char* CopyCheckerFailed = "evaluation failed (checker FAIL)";

	/** /result `checkerVerdict` (founder-approved PR-B, closed set). Absent or unreadable is NotRun. */
	enum class ECheckerVerdict : std::uint8_t { NotRun, Pass, Fail };

	enum class EFlowStep : std::uint8_t
	{
		AtTerminal,
		Choosing,
		Confirming,
		Watching,
	};

	enum class EFlowPanel : std::uint8_t
	{
		None,
		MissionChoice,
		Confirm,
		Progress,
		Result,
	};

	struct FMissionOffer
	{
		std::string Id;
		std::string Title;
	};

	struct FProgressPanel
	{
		EFlowPanel Panel = EFlowPanel::Progress;
		/** A ProgressDisplayLabel, or null when the wrapper's own player label is shown instead. */
		const char* Line = nullptr;
		bool bFinished = false;
		/** True only when the progress meaning is OperatorStarted: the bridge reported dispatch. */
		bool bPaid = false;
		bool bUnconfirmed = false;
		bool bNotStarted = false;
		/** "running" or "completed" from the server, or the wrapper tokens of those names. */
		bool bFault = false;
		/** The meaning is past the status-route dispatched word, so the line is held at that ceiling. */
		bool bHeldAtDispatched = false;
		/** The wrapper published a label this flow does not replace. */
		bool bUsesWrapperLabel = false;
	};

	struct FResultPanel
	{
		EFlowPanel Panel = EFlowPanel::Result;
		const char* Line = CopyNoResultYet;
		bool bShowsArtifact = false;
		bool bVerified = false;
		bool bReported = false;
		/** True only when the result route's state is completed and the completion evidence verified. */
		bool bFinished = false;
		/** Reported fields, in display order. Empty when that field was null, absent, or not verified. */
		std::vector<std::string> Lines;
	};

	/**
	 * A field as the JSON body reported it. bKnown means a value was present. bNull means the key was
	 * present and null. Neither is zero, and neither is a value this client computed.
	 */
	struct FReportedString
	{
		bool bKnown = false;
		bool bNull = false;
		std::string Text;
		/** Set only by format-checked reads: the field was sent but failed its format (shown Unknown, never echoed). */
		bool bPresent = false;
	};

	struct FReportedInt64
	{
		bool bKnown = false;
		bool bNull = false;
		std::int64_t Value = 0;
	};

	struct FReportedBool
	{
		bool bKnown = false;
		bool bNull = false;
		bool bValue = false;
	};

	/**
	 * One slot of BRIDGE's #454 phase projection, as d9880ad4 accepts it
	 * (relay-bridge/julius-mission-evidence.ts:347-382). Every key is required. Stage and Attempt may be
	 * null (Unknown). spanId and traceparent must be null and are not kept. KnownUsdMicros 0 is a real 0.
	 */
	struct FPhaseSlot
	{
		/** PROMPT_ARCHITECT, CODING_AGENT, INDEPENDENT_REVIEWER, in that order. */
		std::string Role;
		/** NEVER_DISPATCHED, ACTIVE, IDLE or FAILED. */
		std::string State;
		/** null, plan, build, repair:plan or repair:build. */
		FReportedString Stage;
		/** null or a non-negative safe integer. */
		FReportedInt64 Attempt;
		std::int64_t KnownUsdMicros = 0;
		bool bCostComplete = false;
	};

	/**
	 * Absent: no key (a body before d9880ad4). Null: the key is null. Projection: exactly the three-slot
	 * projection. Malformed: anything else, which this client treats as null. None of them is completion.
	 */
	enum class EPhaseList : std::uint8_t { Absent, Null, Projection, Malformed };

	/**
	 * One parse of BRIDGE's result and progress bodies.
	 *
	 * Field names, from bridge/wonderland-julius-mission-result-20261024 @ 7e71a122fe03a2538904ab4b8651e034dcf2c1f3:
	 *   relay-bridge/wonderland-mission-result-route.ts (blob 4e34e0d6fab93b6ba4f7183ac6bfb02ece3ea6f1)
	 *     shared body 137-144: wljRunId, serverRunId, legacyRunId, traceId, state, updatedAt
	 *     progress 150: phases
	 *     result 154-162: cause (only when state is not completed and cause is non-null), dispatchedAt, completion
	 *     state is "completed" only when evidence.completion !== null (136). Otherwise ceilingState (187-189).
	 *   relay-bridge/julius-mission-evidence.ts (blob af82258f94e0df0637622e5da7afb9bb298f5a67)
	 *     spendTag 52-60, spendAccounting 63-68, coderCost 71-76, missionCost 79-83
	 *     archive 104-112 (artifactName, artifactDigest), workArtifactRefs 330-337
	 *     completion 135-156, including juliusFinalState "COMPLETED", traceId, traceparent null
	 *     acceptJuliusMissionEvidence 380-404
	 *   docs/JULIUS_MISSION_EVIDENCE_READER.md (blob 4f1ab222a8519635b9b9cc4c0073c3266ee7a99a)
	 *     13-18: completion requires juliusFinalState "COMPLETED" and spendTag.run equal to the path wlj_ id.
	 *     A missing cost is null, not zero. 77: this route does not recompute JuliusMissionResultView.verified.
	 *     63-67: traceId and spanId are derived on the bridge. This client displays the strings the body carried.
	 *
	 * Phases and projectBrainRevision, from #448 @ d9880ad45c16bec6e338bf784bc045b7a23b2d37:
	 *   relay-bridge/wonderland-mission-result-route.ts:145 projectBrainRevision is null unless completion is
	 *     non-null (no falsy coercion: 0 stays 0); :153 phases null stays null on /result and /progress.
	 *   relay-bridge/julius-mission-evidence.ts:193-194, :423 revision is a non-negative safe integer, else null;
	 *     :347-382 the phase list is exactly the three-slot projection, else null (an empty array is null);
	 *     :370, :378-379 spanId and traceparent stay null; :411-412 a read that is not a verified completion
	 *     is { completion: null, phases: null }.
	 *   Fixtures: relay-bridge/julius-mission-evidence.conformance.test.ts (PRESENT_PHASES, HEADER_ONLY_PHASES).
	 *   spendAccounting stays null on #454 output (reader :623): shown as Unknown, never as 0, never as evidence.
	 */
	struct FResultRead
	{
		bool bParsed = false;
		bool bReported = false;
		/** state "completed" and the completion object carries the spend-tag evidence. */
		bool bVerified = false;
		bool bFinished = false;
		/** state "unknown", or a state word this client will not treat as a ceiling it understands. */
		bool bUnknownState = false;
		/** state "failed" and cause "AWAITING_OPERATOR_EXPIRED". Stays NotStarted. */
		bool bExpired = false;
		/** state "dispatched" and completion did not verify. The furthest unplugged progress. */
		bool bDispatchedCeiling = false;
		std::string State;
		FReportedString Cause;
		FReportedString TraceId;
		FReportedString CompletionTraceId;
		FReportedString CompletionTraceparent;
		FReportedString ArtifactName;
		FReportedString ArtifactDigest;
		std::vector<std::string> WorkArtifactRefs;
		bool bSpendTagPresent = false;
		FReportedInt64 ReservedUsdMicros;
		bool bSpendAccountingPresent = false;
		FReportedInt64 SpendAccountingKnownUsdMicros;
		bool bCoderCostPresent = false;
		FReportedInt64 CoderCostUsdMicros;
		FReportedString CoderCostBasis;
		bool bMissionCostPresent = false;
		FReportedInt64 MissionKnownUsdMicros;
		FReportedInt64 MissionUnknownComponents;
		FReportedBool MissionCostComplete;
		/** The completion carried "spendAccounting": null (#454). Unknown, not zero, not evidence. */
		bool bSpendAccountingNull = false;
		/** Top-level phases on /result, cross-checked against completion.phases and /progress. */
		EPhaseList Phases = EPhaseList::Absent;
		/** Filled only when Phases is Projection. */
		std::vector<FPhaseSlot> PhaseSlots;
		/** /result, /progress or completion disagreed on phases. Phases is then Malformed. */
		bool bPhasesSplit = false;
		/** Top-level projectBrainRevision. 0 is a real 0. A string, fraction, negative or bool is Unknown. */
		FReportedInt64 ProjectBrainRevision;
		bool bRevisionMalformed = false;
		bool bRevisionSplit = false;
		FReportedString ProviderMessageId;
		/** Honest parse leaves it false. It exists so a display flip is observable. Secrets have no display path at all. */
		bool bEchoProviderMessageId = false;
		/** The checker's verdict as the bridge reported it; NotRun when absent or not one of PASS/FAIL/NOT_RUN. */
		ECheckerVerdict Checker = ECheckerVerdict::NotRun;
		/** True only when the field was present with one of the three words (so the panel names it, never invents it). */
		bool bCheckerReported = false;
		/** completion.checker (#448 57ed1d61): the in-game digest (12 lowercase hex) and the judged sha256 (64 lowercase hex),
		 *  as reported. A present but malformed value reads as known=false, null=false (shown Unknown). */
		FReportedString CheckerGameDigest;
		FReportedString CheckerJudgedSha256;
		/** PASS that does not name a well-formed judged sha256: not bound to what was graded, so never shown as Completed. */
		bool bCheckerUnbound = false;
	};

	class IMissionResultReader
	{
	public:
		virtual ~IMissionResultReader() = default;
		/** No result when the route is absent or has not reported one. Never a synthesized body. */
		virtual FResultRead Read(std::string_view WljRunId) const = 0;
	};

	class FAbsentResultReader final : public IMissionResultReader
	{
	public:
		FResultRead Read(std::string_view) const override { return {}; }
	};

	/**
	 * Parses the result and progress response bodies. It does not open a connection. Status 0 and an
	 * empty body mean that response was not supplied. While neither response is supplied, Read matches
	 * FAbsentResultReader: nothing is reported, and dispatched stays the furthest progress.
	 */
	class FBridgeMissionResultClient final : public IMissionResultReader
	{
	public:
		void Clear();
		void SetResultResponse(int Status, std::string_view Json);
		void SetProgressResponse(int Status, std::string_view Json);
		FResultRead Read(std::string_view WljRunId) const override;

	private:
		bool bHaveResult = false;
		int ResultStatus = 0;
		std::string ResultJson;
		bool bHaveProgress = false;
		int ProgressStatus = 0;
		std::string ProgressJson;
	};

	/**
	 * Fail-closed parse of the two bodies. ProgressJson may be empty when that response was not supplied.
	 * A non-200 result, an error object, a wljRunId other than WljRunId, or evidence short of the spend
	 * tag is not completion.
	 */
	FResultRead ParseBridgeMissionResponses(
		std::string_view WljRunId,
		int ResultStatus,
		std::string_view ResultJson,
		int ProgressStatus,
		std::string_view ProgressJson);

	FProgressPanel PanelForProgress(WonderlandJuliusMissionLogic::EMissionProgress Meaning);
	FProgressPanel PanelForStatusRouteWord(std::string_view Word);
	/** Wrapper ui_state tokens from WonderlandJuliusMissionClient::UiStateToken. */
	FProgressPanel PanelForWrapperToken(std::string_view Token);
	FResultPanel ResultPanelFor(const FResultRead& Read);

	struct FDispatchIntent
	{
		bool bSend = false;
		std::string MissionId;
	};

	struct FFlowView
	{
		EFlowStep Step = EFlowStep::AtTerminal;
		bool bShowChoice = false;
		bool bShowConfirm = false;
		bool bShowProgress = false;
		bool bShowResult = false;
		const char* PaidNature = CopyPaidNature;
		const char* PaidOnDispatch = CopyPaidOnDispatch;
		const char* BridgeWindow = CopyBridgeWindow;
		const char* ClientHold = CopyClientHold;
		FProgressPanel Progress;
		FResultPanel Result;
		std::string MissionId;
		std::string ClientRunId;
		bool bRunIdOk = false;
		bool bDispatchHanded = false;
	};

	class FMissionFlow
	{
	public:
		void SetOffers(std::vector<FMissionOffer> InOffers);
		const std::vector<FMissionOffer>& Offers() const { return OfferList; }

		void InteractWithTerminal();
		bool ChooseMission(std::string_view MissionId);
		void BackToChoice();
		/** Does not send. The host hands MissionId to the wrapper, then calls NoteDispatchHandedToWrapper. */
		FDispatchIntent Confirm() const;
		void NoteDispatchHandedToWrapper(bool bAccepted);
		/**
		 * The wrapper restored an open pair from its save (the game restarted after Confirm). Goes straight to Watching
		 * for that offered mission without a second Confirm and without sending: the wrapper already owns the run.
		 * False when the id is not offered or a dispatch was already handed in this flow.
		 */
		bool ResumeWatching(std::string_view MissionId);
		/**
		 * "New mission" after a terminal run (the wrapper allows a new mint): back to Choosing with nothing chosen,
		 * no run id, no result. Only from Watching. Never sends.
		 */
		bool StartAgain();

		void NoteClientRunId(std::string_view WljRunId);
		void NoteProgress(WonderlandJuliusMissionLogic::EMissionProgress Meaning);
		void NoteStatusRouteWord(std::string_view Word);
		void NoteWrapperToken(std::string_view Token);
		void NoteResult(const IMissionResultReader& Reader);

		FFlowView View() const;

	private:
		std::vector<FMissionOffer> OfferList;
		EFlowStep Step = EFlowStep::AtTerminal;
		std::string ChosenId;
		bool bDispatchHanded = false;
		std::string ClientRunId;
		bool bRunIdOk = false;
		bool bHaveMeaning = false;
		WonderlandJuliusMissionLogic::EMissionProgress Meaning = WonderlandJuliusMissionLogic::EMissionProgress::Waiting;
		bool bHaveWord = false;
		std::string StatusWord;
		bool bHaveToken = false;
		std::string WrapperToken;
		FResultPanel Result;
		FResultRead RouteRead;
	};

	// ---------------------------------------------------------------------------------------------------------------
	// LIVE RUN EVENTS (founder requirement 2026-10-25: watch the first paid J1 run live in Wonderland; contract agreed
	// with MAIN JULIUS). BRIDGE GET /missions/{wlj}/events?projectId=&after= reads ONLY the GitHub Actions run bound to
	// this admission's claim. Steps: the workflow's real job/step names. Phases: an allowlisted projection of the Julius
	// task table (role, task type, state, ordinal, repair cycle) -- no text, no output, no model payload. Phase events are
	// SAMPLES of the active task (commit status julius-live-progress, <= every 10 s), never a complete log. "live" and
	// "stale" are the SERVER's facts; the client never derives them. Julius and the paid workflow are the authority.
	// ---------------------------------------------------------------------------------------------------------------
	enum class ELiveSource : std::uint8_t { Unknown, None, GithubActions, GithubActionsRecorded };
	enum class ELiveRunStatus : std::uint8_t { Unknown, Queued, InProgress, Completed };
	enum class ELiveMode : std::uint8_t { Unknown, Paid, Preflight };

	struct FLiveEvent
	{
		std::int64_t Seq = 0;
		/** Empty when the step has not started (the server sends null). */
		std::string At;
		/** "job", "step" or "phase". */
		std::string Kind;
		/** job/step only. */
		std::string Job;
		std::string Name;
		std::string Status;
		std::string Conclusion;
		/** phase only. "idle" or "ended" when the sample is a marker (then role..repairCycle are absent). "ended" is
		 *  NOT completion: completion and the verdict come only from /result. */
		std::string Marker;
		std::string Role;
		std::string TaskType;
		std::string State;
		std::int64_t Ordinal = 0;
		std::int64_t RepairCycle = 0;
	};

	struct FLiveRead
	{
		/** False for anything but a fully well-formed 200 body for THIS run: nothing from it is shown or kept. */
		bool bParsed = false;
		ELiveSource Source = ELiveSource::Unknown;
		/** source "none" only: not_dispatched, run_unbound, run_mismatch or github_unreadable. */
		std::string Reason;
		bool bLive = false;
		bool bStale = false;
		ELiveMode Mode = ELiveMode::Unknown;
		ELiveRunStatus Run = ELiveRunStatus::Unknown;
		std::string RunConclusion;
		std::string WorkflowRunId;
		std::vector<FLiveEvent> Events;
		std::string Next;
		/** The server did not know our cursor's epoch: this page restarts from seq 1. */
		bool bReset = false;
	};

	/** The bridge sends at most this many events per /events page (contract with MAIN JULIUS). */
	inline constexpr std::size_t LiveMaxEventsPerPage = 500;

	/** Strict: a malformed field anywhere fails the whole read closed (no partial, no invented event). */
	FLiveRead ParseLiveEvents(std::string_view WljRunId, int HttpStatus, std::string_view Json);

	/** One run's stream: events de-duplicated by seq, oldest first, capped; the cursor resumes after a reconnect. */
	class FLiveFeed
	{
	public:
		static constexpr std::size_t MaxEvents = 300;
		void Apply(const FLiveRead& Read);
		void Clear() { *this = FLiveFeed(); }
		bool HasRead() const { return bHasRead; }
		ELiveSource Source() const { return SourceNow; }
		const std::string& Reason() const { return ReasonNow; }
		/** The server's live flag from the last good read; never computed here. */
		bool IsLive() const { return bHasRead && bLiveNow && SourceNow == ELiveSource::GithubActions; } // FLOW_LIVE_IS_THE_SERVERS
		bool IsStale() const { return bStaleNow; }
		ELiveMode Mode() const { return ModeNow; }
		ELiveRunStatus Run() const { return RunNow; }
		const std::string& RunConclusion() const { return Conclusion; }
		const std::string& WorkflowRunId() const { return Workflow; }
		const std::string& Cursor() const { return CursorNow; }
		const std::vector<FLiveEvent>& Events() const { return EventList; }

	private:
		bool bHasRead = false;
		ELiveSource SourceNow = ELiveSource::Unknown;
		std::string ReasonNow;
		bool bLiveNow = false;
		bool bStaleNow = false;
		ELiveMode ModeNow = ELiveMode::Unknown;
		ELiveRunStatus RunNow = ELiveRunStatus::Unknown;
		std::string Conclusion;
		std::string Workflow;
		std::string CursorNow;
		std::int64_t LastSeq = -1;
		std::vector<FLiveEvent> EventList;
	};

	struct FLivePanel
	{
		bool bShow = false;
		bool bLive = false;
		std::string Header;
		std::vector<std::string> Lines;
	};

	/** Client-side: no successful read for this long while the server last said live. */
	inline constexpr std::uint64_t LiveNoReadAfterMs = 20000;
	/** At most this many finished steps are listed (newest last). */
	inline constexpr std::size_t LivePanelLines = 8;
	/** MsSinceLastRead: time since the last successful read (0 = just now). */
	FLivePanel LivePanelFor(const FLiveFeed& Feed, std::uint64_t MsSinceLastRead);

	// ---------------------------------------------------------------------------------------------------------------
	// IN-WONDERLAND START (founder P0, 2026-10-25): the founder starts the admitted paid mission from the Julius Mission
	// Terminal. The client sends ONLY an authorisation (POST .../missions/{wlj}/start, the founder's typed confirmation,
	// a one-per-run idempotency key); the bridge and the paid workflow perform the governed claim and dispatch. The
	// client never holds GitHub or provider credentials and never chooses lane, budget, repo or ref.
	// ---------------------------------------------------------------------------------------------------------------
	inline constexpr const char* StartConfirmPhrase = "RUN LIVE MISSION";
	/** Exactly the phrase, as typed (no trimming, no case folding): the same words the CLI's --confirm takes. */
	bool StartConfirmTextOk(std::string_view Typed);

	enum class EStartOutcome : std::uint8_t
	{
		/** Not a well-formed answer for this run: nothing is believed; the button stays (same key on a resend). */
		Malformed,
		/** 202 (made the dispatch) or 200 replayed (already dispatching/dispatched): bind; WorkflowRunId may be pending. */
		Accepted,
		/** 400 / 409 / 403 / 404: shown as is; never resent. */
		Refused,
		/** 401 / 503 / transport: nothing dispatched; a resend (same key) is allowed only on the founder's click. */
		Retryable,
	};

	struct FStartAnswer
	{
		EStartOutcome Outcome = EStartOutcome::Malformed;
		std::string WorkflowRunId;
		std::string State;
		std::string ErrorKind;
		bool bReplayed = false;
	};

	FStartAnswer ParseStartAnswer(std::string_view WljRunId, int HttpStatus, std::string_view Json);

	/** What the client has recorded (and persisted) about starting the current admitted run. */
	enum class EStartRecord : std::uint8_t { None, Sending, Started, Refused, NotStarted };

	struct FStartGate
	{
		/** The Start control is shown. */
		bool bOffer = false;
		/** This call may send the start request now. */
		bool bSend = false;
		const char* Why = "";
	};

	/**
	 * THE ONE START DECISION. Offered only for an admitted run still waiting for the operator, with a paired session, no
	 * bound workflow run and no recorded start (a transient NotStarted may be retried, by the same key). Sent only from an
	 * explicit founder click with the exact typed phrase: never from open, poll, reconnect or restore.
	 */
	FStartGate StartGateFor(std::string_view WrapperToken, bool bHasSession, bool bHasWorkflowRun, EStartRecord Record,
		bool bExplicitClick, std::string_view Typed);
}

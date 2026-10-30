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
		/** Top-level outcomeUnknown (#478): any object = a provider call's outcome is unknown and Julius did not retry it. */
		bool bOutcomeUnknown = false;
		/** Its cause word as reported (HANDED_OUTCOME_UNKNOWN, HANDED_TIMEOUT_OUTCOME_UNKNOWN, ...); empty when absent. */
		std::string OutcomeUnknownCause;
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
		/** Events whose seq was readable but whose other fields were not: skipped (never shown, never latched). */
		std::vector<std::int64_t> SkippedSeqs;
	};

	/** The bridge sends at most this many events per /events page (contract with MAIN JULIUS). */
	inline constexpr std::size_t LiveMaxEventsPerPage = 500;

	/**
	 * Strict on the envelope: a malformed top-level field fails the whole read closed. Per event (founder ruling
	 * 2026-10-30): an event whose seq is readable but whose other fields are not is skipped and named in SkippedSeqs
	 * (never shown, never latched); a non-object event or an unreadable seq still fails the page (order is unknowable).
	 */
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
		/**
		 * EXECUTION FACTS, latched as events arrive (the event list is capped, these are not). Names per MAIN JULIUS's
		 * execution-state contract (2026-10-26), compared exactly.
		 */
		bool LiveStepStarted() const { return bLiveStepStarted; }
		bool LiveStepFinished() const { return bLiveStepFinished; }
		/** The LIVE step completed with success (the only "finished" that may lead to an outcome). */
		bool LiveStepSucceeded() const { return bLiveStepSucceeded; }
		/** The LIVE step completed failure/cancelled/timed_out: Julius was interrupted (reported at once). */
		bool LiveStepInterrupted() const { return bLiveStepInterrupted; }
		const std::string& LiveStepConclusion() const { return LiveConclusion; }
		bool TaskPhaseSeen() const { return bTaskPhaseSeen; }
		bool AttemptRecorded() const { return bAttemptRecorded; }
		bool GradeJobFinished() const { return bGradeJobFinished; }
		/** "job / step" of the first job or step that concluded failure, or empty. */
		const std::string& FirstFailure() const { return FirstFailureName; }
		/** The newest non-marker phase sample (Role empty when none yet). */
		const FLiveEvent& LastTaskPhase() const { return LastTaskPhaseEvent; }
		/**
		 * RESYNC (founder ruling 2026-10-30): a seq gap or a server reset:true clears every latch. A gap also drops the
		 * stream and its cursor (the next read replays from the start) and shows nothing old meanwhile. Either way the
		 * owner must read /status before trusting anything: TakeResyncRequest returns the reason once.
		 */
		bool Resyncing() const { return bResyncing; }
		const char* TakeResyncRequest()
		{
			const char* Why = ResyncWhy;
			ResyncWhy = nullptr;
			return Why;
		}
		/** Seqs skipped as unreadable since the feed began (kept for the log). */
		std::size_t SkippedEvents() const { return SkippedCount; }

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
		bool bLiveStepStarted = false;
		bool bLiveStepFinished = false;
		bool bLiveStepSucceeded = false;
		bool bLiveStepInterrupted = false;
		std::string LiveConclusion;
		bool bTaskPhaseSeen = false;
		bool bAttemptRecorded = false;
		bool bGradeJobFinished = false;
		std::string FirstFailureName;
		FLiveEvent LastTaskPhaseEvent;
		bool bResyncing = false;
		const char* ResyncWhy = nullptr;
		std::size_t SkippedCount = 0;
		void Latch(const FLiveEvent& Event);
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
		/** A-9 (ACK): 202 ack:"accepted" -- the bridge durably RECEIVED the request. NOT a dispatch: /status decides. */
		Acknowledged,
		/** 200 state "dispatching" (V2 dispatch_outcome_unknown, or a replay of one) or 409 julius_start_key_reused: the
		 *  dispatch may or may not have happened. Never Started, never offered again; /status decides. */
		Uncertain,
		/** 409 julius_start_in_progress: a Start for this run is live on the bridge. Poll /status; never send a new key. */
		InProgress,
	};

	struct FStartAnswer
	{
		EStartOutcome Outcome = EStartOutcome::Malformed;
		std::string WorkflowRunId;
		std::string State;
		std::string ErrorKind;
		bool bReplayed = false;
		/** Acknowledged only: the bridge's startKeyHash (64 lowercase hex). */
		std::string StartKeyHash;
	};

	FStartAnswer ParseStartAnswer(std::string_view WljRunId, int HttpStatus, std::string_view Json);

	/**
	 * What the client has recorded (and persisted) about starting the current admitted run. Values are persisted by
	 * number order: append only. Sending = sent and not reconciled (in flight, crashed, timed out, or uncertain): never
	 * offered, never resent, until /status reconciles it. Accepted = the bridge acknowledged the request (A-9), which is
	 * NOT a dispatch.
	 */
	enum class EStartRecord : std::uint8_t { None, Sending, Started, Refused, NotStarted, Accepted };

	/**
	 * The record an answer leaves (founder ruling 2026-10-30: after a crash, timeout or outcome-unknown Start, Start stays
	 * ineligible until /status reconciles it). Only an answer the bridge GAVE that says nothing was dispatched (401, 503)
	 * is NotStarted; a lost answer (transport 0, 502, 504) is Sending.
	 */
	EStartRecord StartRecordAfterAnswer(EStartOutcome Outcome, int HttpStatus);

	/** clientTriggerId: 32 lowercase hex (16 random bytes), minted ONCE per start key and persisted with it (A-9 digest). */
	inline constexpr std::size_t ClientTriggerIdChars = 32;
	bool ClientTriggerIdOk(std::string_view Id);

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

	// ---------------------------------------------------------------------------------------------------------------
	// MISSION STATUS (A-9 route GET {prefix}{wljRunId}/status, schema wonderland-mission-status.v1). The ONE answer the
	// client reconciles a Start against. Strict on what decides state (schema, run, phase, terminal, start.*); tolerant
	// per field on what is only shown (progress, workflowProgress, result, nextPollMs): a bad display field is dropped
	// and named in Skipped, never the whole read.
	// ---------------------------------------------------------------------------------------------------------------
	inline constexpr const char* MissionStatusSchema = "wonderland-mission-status.v1";
	inline constexpr const char* WorkflowProgressLabel = "GitHub workflow steps (not mission progress)";
	inline constexpr int StatusPollMinMs = 1000;
	inline constexpr int StatusPollMaxMs = 30000;
	inline constexpr int StatusPollDefaultMs = 2000;

	enum class EMissionStatusPhase : std::uint8_t
	{
		Unknown, Admitted, Starting, Dispatching, Dispatched, Queued, Executing, Grading, Completed, Failed, DidNotStart,
		Interrupted, Expired,
	};

	struct FMissionStatusRead
	{
		bool bOk = false;
		int HttpStatus = 0;
		/** Why the read was refused (bOk false), for the log. */
		std::string Why;
		EMissionStatusPhase Phase = EMissionStatusPhase::Unknown;
		std::string PhaseWord;
		bool bTerminal = false;
		/** start.requested: the journal holds a claim, or this bridge process is running a Start. */
		bool bRequested = false;
		std::string WorkflowRunId;
		/** start.request.state (ACK only): "", "accepted", "claiming", "settled" or "interrupted". */
		std::string RequestState;
		bool bRequestUnreadable = false;
		/** run: present when the bridge bound a GitHub Actions run. */
		bool bRunPresent = false;
		bool bRunLive = false;
		bool bRunStale = false;
		/** progress (MISSION progress): -1 = null (no percent shown). */
		int ProgressPercent = -1;
		std::string ProgressBasis;
		/** workflowProgress: shown only with its exact label; -1 = null. */
		bool bWorkflowLabelOk = false;
		int WorkflowPercent = -1;
		int WorkflowStepsCompleted = -1;
		int WorkflowStepsTotal = -1;
		/** result.checkerVerdict ("" = null) and result.outcomeUnknown. */
		std::string CheckerVerdict;
		bool bOutcomeUnknown = false;
		/** nextPollMs clamped to StatusPollMinMs..StatusPollMaxMs; 0 = null (terminal: stop polling). */
		int NextPollMs = StatusPollDefaultMs;
		std::string EventsCursor;
		/** Display fields dropped as unreadable (tolerant per field). */
		std::vector<std::string> Skipped;
	};

	FMissionStatusRead ParseMissionStatus(std::string_view WljRunId, int HttpStatus, std::string_view Json);
	const char* MissionStatusPhaseWord(EMissionStatusPhase Phase);

	struct FStartReconcile
	{
		EStartRecord Record = EStartRecord::None;
		bool bChanged = false;
		/** Shown with the (blocked or released) Start control; never empty when Record blocks Start. */
		const char* Why = "";
	};

	/**
	 * Founder ruling 2026-10-30: a Start that crashed, timed out or is outcome-unknown (Sending), or was only
	 * acknowledged (Accepted), stays blocked until /status says what happened. Started only on dispatch evidence;
	 * Refused when the bridge settled it terminal without a dispatch or interrupted the request; NotStarted (offered
	 * again, on a click only, same key and trigger) only when the bridge holds no claim, runs no Start, and keeps no
	 * live request. phase "unknown" / outcomeUnknown / an unreadable request change nothing. Never sends anything.
	 */
	FStartReconcile StartRecordFromStatus(EStartRecord Current, const FMissionStatusRead& Status);

	// ---------------------------------------------------------------------------------------------------------------
	// EXECUTION STATE (founder P0 2026-10-26: the mission contract follows Julius's ACTUAL execution, not "a workflow
	// is running"). MAIN JULIUS's contract, verbatim: /events `live` means queued/in_progress INCLUDING the gates and is
	// never "executing"; EXECUTING is the first of the LIVE step in_progress or a non-marker phase sample; the outcome
	// comes only from /result once the LIVE step started; a run whose LIVE step never started DID NOT START.
	// ---------------------------------------------------------------------------------------------------------------
	enum class EExecutionPhase : std::uint8_t
	{
		None,
		/** Start accepted / dispatched; the workflow is in its gates. Never "executing". */
		Starting,
		/** "Record that a paid mission was attempted" succeeded: the point of no return, still not executing. */
		Committing,
		Executing,
		/** The LIVE step SUCCEEDED, the run is still going and the pinned checker has not reported: a neutral wait. */
		Grading,
		Completed,
		Failed,
		/** The run completed, the LIVE step ran, and no verdict arrived: unknown, never success. */
		FailedUnverified,
		/** The run completed and the LIVE step never started (a gate refused): Julius did not run. */
		DidNotStart,
		Cancelled,
		/** /result says a provider call's outcome is unknown: Julius stopped that step and did not retry it. Never success. */
		OutcomeUnknown,
	};

	/** What /result says, as the contract reads it. */
	struct FVerdictRead
	{
		ECheckerVerdict Verdict = ECheckerVerdict::NotRun;
		bool bHasCompletion = false;
		/** NOT_RUN may be taken as final: a /result read made after the run's completion still said it AND the grace passed.
		 *  Until then no verdict is a neutral wait, never a failure (/result trails the run's completion). */
		bool bNoVerdictIsFinal = false;
		bool bOutcomeUnknown = false;
		std::string OutcomeUnknownCause;
	};

	const char* ExecutionPhaseWord(EExecutionPhase Phase);

	struct FExecutionView
	{
		EExecutionPhase Phase = EExecutionPhase::None;
		/** The server said stale: keep the last state; never advance or regress on it. */
		bool bStale = false;
		/** The run is over and the server reads it as recorded (not live). */
		bool bRecorded = false;
		/** The bound GitHub Actions run, when bound. */
		std::string WorkflowRunId;
		/** DidNotStart: the failing gate ("job / step"); otherwise empty. */
		std::string Detail;
		/** The newest real task sample while executing: role, task type, repair cycle (-1 unknown). */
		std::string Role;
		std::string TaskType;
		std::int64_t RepairCycle = 0;
	};

	/**
	 * Binds ONLY to a paid GitHub Actions run whose id is the start's bound run (when the start named one). Anything
	 * else (no read yet, a preflight, another run) is at most Starting when the founder's start was accepted.
	 */
	FExecutionView ExecutionViewFor(const FLiveFeed& Feed, bool bStartAccepted, std::string_view BoundWorkflowRunId,
		const FVerdictRead& Read);

	/** One event for the EXISTING mission-contract fold (WonderlandApplyEvent), in the fold's own vocabulary. */
	struct FContractBeat
	{
		std::string Type;
		/** "architect", "coder", "reviewer" or empty. */
		std::string Role;
		std::int64_t RepairRound = 0;
	};

	/**
	 * Turns execution views into the contract's events, each emitted ONCE and in order (founder acceptance 2026-10-26):
	 * NOTHING while starting/committing (dispatch is not execution); run.started -- the existing activation sequence --
	 * only once execution is CONFIRMED, then a role beat per new task sample (architect/coder/review/repair .started);
	 * success ends with run.completed. Failure, did-not-start and cancel play NO ending: the cursor RELEASES, and the
	 * caller interrupts the sequence at once (no beat, the Dog back to idle/follow). A stale view emits nothing.
	 */
	class FContractCursor
	{
	public:
		std::vector<FContractBeat> Advance(const FExecutionView& View);
		bool Started() const { return bStarted; }
		bool Ended() const { return bEnded; }
		/** True once failure/did-not-start/cancel was seen: the caller interrupts the presentation immediately. */
		bool Released() const { return bReleased; }

	private:
		bool bStarted = false;
		bool bEnded = false;
		bool bReleased = false;
		/** A repair round is open: the first repair task after other work showed REPAIR REQUIRED; non-repair work closes it. */
		bool bInRepairRound = false;
		/** This cursor has seen a task sample (so a round opening is a transition it actually observed). */
		bool bSawTask = false;
		std::string LastBeatKey;
	};

	/**
	 * CONNECTION UNCERTAINTY (founder acceptance): the run's state cannot be verified right now -- the server said stale,
	 * the paired session is gone, or no good /events read for LiveNoReadAfterMs after one had arrived. The caller
	 * suspends the presentation (never invents an outcome) until a verified read returns.
	 */
	bool ConnectionUncertain(bool bStale, bool bHasSession, bool bEverRead, std::uint64_t MsSinceLastGoodRead);

	/**
	 * NO PRESENTATION BEFORE CONFIRMED EXECUTION, for the Dog's task-state fallback (REVIEW 2026-10-26, LINE 1): a task row
	 * bound to a Julius run performs only once Julius confirmed it THIS session. A row restored from the save (or otherwise
	 * unconfirmed) stays inert; a local row that follows no run is not affected.
	 */
	bool TaskRowMayPerform(bool bBoundToJuliusRun, bool bJuliusConfirmedThisSession);

	/** Following a run: adopting a DIFFERENT run than the row held starts the row at queued (a new run starts queued). */
	bool AdoptingRunResetsToQueued(bool bRowHadRun, std::string_view RowRunId, std::string_view NewRunId);

	/**
	 * A stream report whose Julius state word does not map to a task state may re-apply the row's CURRENT state only when
	 * Julius already confirmed that row this session (REVIEW #70): re-applying is not a fresh state, so it must never be
	 * what confirms a row.
	 */
	bool UnmappedReportMayApply(bool bRowConfirmedThisSession);

	/**
	 * KEEP READING /result AFTER A STOP (REVIEW/JUDEV #75): /result gains outcomeUnknown only once the WHOLE workflow run has
	 * completed (grade + cleanup jobs, then a cache of up to 30 s), long after /events has already interrupted the
	 * presentation. After a stop that followed confirmed execution, keep reading until outcomeUnknown is seen or the run has
	 * completed plus the grace -- read-only: nothing is started, nothing re-animates, the Dog stays normal.
	 */
	/**
	 * REVIEW #74: may the client end the admission locally? Only when the bound workflow run has COMPLETED (a fresh /events
	 * read), the contract is a terminal NON-success (failed, unverified, did not start, cancelled, outcome unknown) and no
	 * verdict is still awaited. Success is never concluded here: the claim record finishes it.
	 */
	bool AdmissionEndsWithWorkflow(bool bRunCompletedSeen, EExecutionPhase Phase, bool bAwaitingVerdict);

	bool KeepReadingResultAfterStop(bool bStoppedAfterExecution, bool bOutcomeUnknownSeen, bool bRunCompletedSeen,
		std::uint64_t MsSinceRunCompleted, std::uint64_t GraceMs);

	/** The contract task state word for a view ("queued", "preparation", "implementation", "review", "repair",
	 *  "verification", "completed", "failed", "cancelled") or empty for none. */
	const char* ContractTaskStateFor(const FExecutionView& View);
}

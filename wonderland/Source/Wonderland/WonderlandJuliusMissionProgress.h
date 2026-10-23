// WONDERLAND -- J1 in-world mission: the client's PROGRESS LOGIC after a dispatch is Accepted. Standard C++17, no
// Unreal include, no HTTP, no JSON, no clock, no randomness. It sits on top of WonderlandJuliusMissionLogic.h (r2,
// a821a467), whose files it does not change.
//
// WHAT THIS IS. r2 decides how ONE dispatch POST was answered (ClassifyDispatchAnswer: Accepted, Refused or NoAnswer)
// and when the identical pair may be resent (FDispatchAttemptTracker, NextResend). This file is what happens next:
// once the bridge has Accepted the pair, the client never sends that dispatch again. It only POLLS for status, shows
// what the status says, and stops for good on a terminal status. FMissionProgressTracker is the state machine the
// Unreal wrapper (BRIDGE's later work) drives; it never sends anything itself.
//
// THE BRIDGE CONTRACT this follows is BRIDGE's draft PR #407, head dd0153a0d8c362283224d388390e822b13c3b2d6
// (branch bridge/julius-mission-adapter-20261023), read field by field:
//   - POST /relay-api/wonderland/julius/dispatch answers 202 (new) or 200 (same-pair replay) with
//     {data:{runId, serverRunId, dispatchId, state, replayed, ledgerRef, mode:"admission", dispatched:false,
//     confirmLive:"", submittedToPaidWorkflow:false, correlation, modelPins, gatesRemaining}}
//     (relay-bridge/wonderland-admission-route.ts toHttp). runId is the client's wlj_ id; serverRunId is
//     "run:" + 24 lowercase hex (JULIUS_BOOTSTRAP_RUN_ID, src/relay/integration/wonderland-admission/
//     admission-contract.ts), minted once per pair and returned unchanged on every same-pair replay
//     (admission-store.ts reserveSync); a different pair sharing the run id or key is a 409 refusal.
//   - data.state is one of exactly RESERVED, ADMISSION_HELD, LEDGER_UNWRITTEN, INTERRUPTED, FAILED
//     (src/relay/integration/wonderland-admission/admission-store.ts AdmissionState).
//     INTERRUPTED and FAILED are set only by markTerminal.
//   - #407 defines NO status endpoint. The only status vocabulary that is served at all is the Julius run view,
//     GET /relay-api/julius/runs/<runId>/run -> JuliusRunView.state, one of exactly CREATED, PLANNING, READY,
//     EXECUTING, WAITING, REVIEWING, REPAIRING, VERIFYING, BLOCKED, PAUSED, FAILED, COMPLETED, CANCELLED
//     (src/relay/mission/julius/julius-runtime.ts JULIUS_MISSION_STATES; FAILED, COMPLETED and CANCELLED are terminal,
//     JULIUS_TERMINAL_MISSION_STATES). That route is operator-Bearer only (docs/JULIUS_WONDERLAND_CONTRACT.md), and
//     the admission route refuses an operator Bearer from the game, so the game cannot reach it today; and nobody has
//     confirmed that serverRunId IS that Julius runId (YUJI, #407 "confirm bootstrap will require this id").
//   So the wrapper tags every status answer with the vocabulary it came from (EStatusVocabulary): Admission for an
//   answer shaped like the dispatch data object, JuliusRun for a JuliusRunView, Unknown for anything else. Every
//   status string is matched by its exact bytes inside its own vocabulary, never by case-folding, prefix or free
//   text, and an unrecognised string or vocabulary is Waiting: keep polling, show "waiting", conclude nothing.
//
// THE RULES (each one is pinned by wonderland/Tools/j1_progress_kat.cpp and
// src/relay/mission/wonderland/wonderland-j1-progress.test.ts):
//   P1 NO SECOND DISPATCH. DispatchSendAllowed() is true only in AwaitingDispatchAnswer, the state before the first
//      Accepted answer. Every other state answers false forever: no transition leads back to AwaitingDispatchAnswer.
//      The wrapper sends a dispatch POST only when BOTH this and r2's FDispatchAttemptTracker::BeginAttempt allow it.
//      (r2 alone would admit a FRESH pair after Accepted, because Accepted closes the pair; this tracker is what
//      stops a second paid dispatch for the same mission trigger.) ONE TRACKER PER TRIGGER: the wrapper creates one
//      FMissionProgressTracker when a person starts the mission, with that trigger's single pair, and never a second
//      one for the same trigger. Before an answer only the identical pair is resent (r2), so one tracker sees exactly
//      one pair. After Refused, a fresh pair needs a fresh person action and so a fresh tracker; nothing here mints.
//   P2 THE SERVER RUN ID IS PINNED at the first Accepted answer. It must match ^run:[0-9a-f]{24}$ and data.runId must
//      be this client's wlj_ run id, or the state is AnswerInvalid. Every later answer that names a run must name the
//      same two ids; a different serverRunId (or data.runId) is RunIdMismatch. Both are fail-closed terminals.
//   P3 TERMINALS ARE STICKY. Succeeded, Failed, Refused, DispatchFailed, RunIdMismatch, AnswerInvalid and
//      PollLimitReached never change again; every later answer is traced as ignored and changes nothing.
//   P4 POLLING NEVER DISPATCHES. A poll that fails (no answer, a bare 5xx, an error object, no data, no run id) is
//      counted against the poll budget and changes no state. It never leads to a resend or a fresh pair.
//   P5 THE POLL SCHEDULE IS BOUNDED. NextPoll: PollBaseDelayMs doubling to PollMaxDelayMs, at most PollMaxCount polls
//      and never a wait past PollMaxTotalWatchMs since the first Accepted answer. Then PollLimitReached, which is
//      terminal: stop polling and say so. Running out of patience is NOT a failure: the run may still be going.
//   P6 NO SPEND, NO PASS. The display words never claim money was spent, never say PASS, qualifying or verified.
//      Succeeded only means "the status said COMPLETED": the result still goes through r2's ClassifyResultEnvelope,
//      ClassifyFinishedResult and the R4-F judge before anything is shown as an outcome.
//   P7 A 202 IS NOT A RUNNING MISSION. An Admission-vocabulary answer can only ever give AdmittedHeld, Waiting or
//      DispatchFailed. Only a JuliusRun-vocabulary status can say Dispatched or Running, so ADMISSION_HELD with
//      dispatched:false shows "Admitted -- waiting for the paid run", never "running".
//
// WHAT IS NOT HERE: no HTTP, no JSON parsing, no logging sink, no clock, no Unreal. The wrapper measures WatchedMs,
// parses the answer into FStatusAnswer and writes the trace lines (FormatProgressTrace) to its own log.
#pragma once

#include "WonderlandJuliusMissionLogic.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace WonderlandJuliusMissionLogic
{
	/** ^run:[0-9a-f]{24}$, JULIUS_BOOTSTRAP_RUN_ID in #407's admission-contract.ts. */
	bool IsServerRunId(std::string_view ServerRunId);

	enum class EMissionProgress : std::uint8_t
	{
		/** Before the first Accepted answer. r2's resend rules apply; the only state that allows a dispatch POST. */
		AwaitingDispatchAnswer,
		/** Admission state RESERVED, ADMISSION_HELD or LEDGER_UNWRITTEN: the pair is admitted, no paid run yet. */
		AdmittedHeld,
		/** Julius run state CREATED, PLANNING or READY: Julius holds the run, nothing has started it. */
		Dispatched,
		/** Julius run state EXECUTING, WAITING, REVIEWING, REPAIRING or VERIFYING. */
		Running,
		/** Julius run state BLOCKED or PAUSED: not running, not finished. */
		Paused,
		/** An unrecognised status string or vocabulary: keep polling, show waiting, conclude nothing. */
		Waiting,
		/** Terminal. Julius run state COMPLETED. Not a PASS: the result is still checked by r2 and the judge. */
		Succeeded,
		/** Terminal. Julius run state FAILED or CANCELLED. */
		Failed,
		/** Terminal. The dispatch POST itself was refused (r2 Refused) before any Accepted answer. */
		Refused,
		/** Terminal. Admission state INTERRUPTED or FAILED: the bridge ended the admission (markTerminal). */
		DispatchFailed,
		/** Terminal, fail closed. An answer named a different serverRunId or client run id than the pinned ones. */
		RunIdMismatch,
		/** Terminal, fail closed. The first Accepted answer had no well-formed serverRunId or not this client's run id. */
		AnswerInvalid,
		/** Terminal. NextPoll ran out (P5). The run may still be going; the client has stopped watching it. */
		PollLimitReached,
	};

	bool IsTerminalProgress(EMissionProgress State);

	/** Where a status string came from. Strings are only ever matched inside their own vocabulary. */
	enum class EStatusVocabulary : std::uint8_t
	{
		/** data.state of the dispatch answer shape (#407 toHttp, mode "admission"). */
		Admission,
		/** JuliusRunView.state (julius-runtime.ts JULIUS_MISSION_STATES). */
		JuliusRun,
		/** Anything else, including a status endpoint nobody has defined yet. Always Waiting. */
		Unknown,
	};

	/**
	 * The exact-bytes map from a status string to a progress state. Never returns AwaitingDispatchAnswer, Refused,
	 * RunIdMismatch, AnswerInvalid or PollLimitReached; an unrecognised string, a case variant, padding or an empty
	 * string is Waiting.
	 */
	EMissionProgress ProgressFromStatus(EStatusVocabulary Vocabulary, std::string_view Status);

	/** One parsed answer: the dispatch POST's answer, or a status poll's. Strings are the parsed JSON values. */
	struct FStatusAnswer
	{
		/** 0 when there was no HTTP answer (transport failure or timeout). */
		int HttpStatus = 0;
		bool bHasError = false;
		std::string_view ErrorKind;
		bool bHasData = false;
		EStatusVocabulary Vocabulary = EStatusVocabulary::Unknown;
		/** data.runId on an Admission-shaped answer (the client's wlj_ id); empty when absent. */
		std::string_view ClientRunId;
		/** data.serverRunId on an Admission-shaped answer, or JuliusRunView.runId; empty when absent. */
		std::string_view ServerRunId;
		/** data.state / JuliusRunView.state. */
		std::string_view Status;
	};

	/** What a recorded answer did. Every value is traced; none of them sends anything. */
	enum class EProgressEvent : std::uint8_t
	{
		/** The tracker was created for one dispatched pair. */
		Started,
		/** A dispatch answer r2 calls NoAnswer, before Accepted: r2's resend schedule decides what happens. */
		DispatchUnanswered,
		/** The dispatch POST was refused (terminal Refused). */
		DispatchRefused,
		/** The first Accepted answer: serverRunId pinned. */
		Admitted,
		/** A later dispatch answer (a late replay of the same pair), consistent with the pinned ids. */
		DispatchReplayed,
		/** A dispatch answer after Accepted that r2 calls Refused or NoAnswer: ignored, the pair is already spent. */
		LateDispatchAnswerIgnored,
		/** A readable status answer for the pinned run; the state follows the status. */
		StatusApplied,
		/** A poll with no usable answer: counted, no state change, never a resend. */
		PollFailed,
		/** An answer named a run other than the pinned one. */
		RunIdMismatched,
		/** The first Accepted answer could not be checked. */
		AnswerRejected,
		/** Any answer after a terminal state: ignored. */
		IgnoredAfterTerminal,
		/** NextPollStep ran out of budget. */
		PollLimitReached,
	};

	struct FProgressTrace
	{
		EProgressEvent Event = EProgressEvent::Started;
		EMissionProgress From = EMissionProgress::AwaitingDispatchAnswer;
		EMissionProgress To = EMissionProgress::AwaitingDispatchAnswer;
		/** The pinned server run id; empty only before the first Accepted answer (and on AnswerRejected). */
		std::string ServerRunId;
		/** The client's wlj_ run id this tracker was created for. */
		std::string ClientRunId;
		int HttpStatus = 0;
		/** Polls recorded so far, this one included. */
		std::uint32_t PollIndex = 0;
		/** The status string as received when it is 1-32 characters of [A-Z_]; otherwise "-" (never free text). */
		std::string Status;
	};

	/* ---------------------------------------------------------------- the poll schedule, P5 */

	inline constexpr std::uint32_t PollBaseDelayMs = 5000;
	inline constexpr std::uint32_t PollGrowthFactor = 2;
	inline constexpr std::uint32_t PollMaxDelayMs = 60000;
	inline constexpr std::uint32_t PollMaxCount = 240;
	inline constexpr std::uint64_t PollMaxTotalWatchMs = 10800000;

	enum class EPollStep : std::uint8_t
	{
		/** Wait DelayMs, then send one status poll. Never a dispatch. */
		WaitThenPoll,
		/** Send nothing more. */
		Stop,
	};

	struct FPollDecision
	{
		EPollStep Step = EPollStep::Stop;
		/** 0 when Step is Stop. */
		std::uint32_t DelayMs = 0;
	};

	/**
	 * Pure and deterministic, like r2's NextResend. PollsSent: polls already sent for this run. WatchedMs: wall time
	 * since the first Accepted answer, as the wrapper measured it. The delay before poll N (from 0) is
	 * min(PollBaseDelayMs * PollGrowthFactor^N, PollMaxDelayMs): 5,000, 10,000, 20,000, 40,000 ms, then 60,000 ms.
	 * Stop once PollsSent reaches PollMaxCount or the wait would take WatchedMs past PollMaxTotalWatchMs.
	 */
	FPollDecision NextPoll(std::uint32_t PollsSent, std::uint64_t WatchedMs);

	/* ---------------------------------------------------------------- the state machine */

	class FMissionProgressTracker
	{
	public:
		/** One tracker per dispatched pair, created with the pair's wlj_ run id. Traces Started. */
		explicit FMissionProgressTracker(std::string ClientRunId);

		/**
		 * Record the answer to a dispatch POST of this pair (the first send or one of r2's resends). Answer is r2's
		 * ClassifyDispatchAnswer of the same HTTP status and error fields. Returns the state after it.
		 */
		EMissionProgress RecordDispatchAnswer(EDispatchAnswer Answer, const FStatusAnswer& Fields);

		/** Record one status poll's answer. Counts the poll. Returns the state after it. */
		EMissionProgress RecordPollAnswer(const FStatusAnswer& Fields);

		/**
		 * Whether to poll, and after what wait. Stop in AwaitingDispatchAnswer and in every terminal state. When the
		 * budget is spent it moves to PollLimitReached (traced) and answers Stop from then on.
		 */
		FPollDecision NextPollStep(std::uint64_t WatchedMs);

		/** P1: true only before the first Accepted answer and before any terminal state. */
		bool DispatchSendAllowed() const { return State == EMissionProgress::AwaitingDispatchAnswer; }

		EMissionProgress Current() const { return State; }
		const std::string& PinnedServerRunId() const { return ServerRunId; }
		std::uint32_t PollsRecorded() const { return PollsSent; }
		const std::vector<FProgressTrace>& Trace() const { return Events; }

	private:
		EMissionProgress Move(EProgressEvent Event, EMissionProgress To, const FStatusAnswer* Fields);

		std::string ClientRunId;
		std::string ServerRunId;
		EMissionProgress State = EMissionProgress::AwaitingDispatchAnswer;
		std::uint32_t PollsSent = 0;
		std::vector<FProgressTrace> Events;
	};

	/* ---------------------------------------------------------------- display and trace */

	/**
	 * The exact words the wrapper shows for a state (UTF-8; the dash is U+2014). None claims spend, PASS, a
	 * qualifying result or a verified one (P6).
	 */
	const char* ProgressDisplayLabel(EMissionProgress State);

	/** Stable snake_case names for trace lines and tests. */
	const char* ProgressStateName(EMissionProgress State);
	const char* ProgressEventName(EProgressEvent Event);

	/**
	 * One trace line: "j1_progress event=<e> from=<s> to=<s> client_run_id=<wlj_...> server_run_id=<run:...|->
	 * http=<n> poll=<n> status=<S|->". server_run_id is "-" only before the first Accepted answer.
	 */
	std::string FormatProgressTrace(const FProgressTrace& Trace);
}

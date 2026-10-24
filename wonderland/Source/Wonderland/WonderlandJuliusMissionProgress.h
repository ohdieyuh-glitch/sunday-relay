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
//   - BRIDGE'S STATUS ROUTE (branch bridge/wonderland-julius-status-20261023, a427eac7, NOT pushed as of this
//     commit, so not read from its source) is confirmed by BRIDGE in the team room, 2026-10-23 about 11:38 PT:
//     before the operator claim the admission is in its own bounded state data.state "awaiting_operator", with its
//     own expiry whose end cause is data.cause "operator_window_expired" (unpaid; the run was never started). The
//     operator claim moves it to data.state "dispatched" and sets data.dispatchedAt once (UTC ISO-8601, never
//     rewritten; updatedAt is NOT used, it changes on every transition). After dispatch, INTERRUPTED or FAILED is
//     never written. These three words are single constants below (BridgeAwaitingOperatorState,
//     BridgeDispatchedState, BridgeOperatorWindowExpiredCause) and MUST BE RE-PINNED to BRIDGE's closed state and
//     cause sets once BRIDGE posts them with commit SHAs.
//   So the wrapper tags every status answer with the vocabulary it came from (EStatusVocabulary): Admission for an
//   answer shaped like the dispatch data object, JuliusRun for a JuliusRunView, Unknown for anything else. Every
//   status string is matched by its exact bytes inside its own vocabulary, never by case-folding, prefix or free
//   text, and an unrecognised string or vocabulary is Waiting: keep polling, show "waiting", conclude nothing.
//
// THE RULES (each one is pinned by wonderland/Tools/j1_progress_kat.cpp and, on the #421 line only,
// src/relay/mission/wonderland/wonderland-j1-progress.test.ts; this client line does not carry that test):
//   P1 NO SECOND DISPATCH. DispatchSendAllowed() is true only in AwaitingDispatchAnswer, the state before the first
//      Accepted answer. Every other state answers false forever: no transition leads back to AwaitingDispatchAnswer.
//      The wrapper sends a dispatch POST only when BOTH this and r2's FDispatchAttemptTracker::BeginAttempt allow it.
//      (r2 alone would admit a FRESH pair after Accepted, because Accepted closes the pair; this tracker is what
//      stops a second paid dispatch for the same mission trigger.) ONE TRACKER PER TRIGGER: the wrapper creates one
//      FMissionProgressTracker when a person starts the mission, with that trigger's single pair, and never a second
//      one for the same trigger. Before an answer only the identical pair is resent (r2), so one tracker sees exactly
//      one pair. After Refused, a fresh pair needs a fresh person action and so a fresh tracker; nothing here mints.
//   P2 THE SERVER RUN ID IS PINNED at the first Accepted answer. It must be either this client's OWN wlj_ run id
//      (RunIdPrefix + canonical lowercase UUIDv4, byte for byte: the proposed contract, where #407 validates and
//      persists the client's id and Julius #432 adopts it unchanged) or the legacy ^run:[0-9a-f]{24}$ that #407
//      mints today, and data.runId must be this client's wlj_ run id, or the state is AnswerInvalid. A well-formed
//      wlj_ serverRunId that is not this client's is RunIdMismatch. Every later answer that names a run must name the
//      same two ids; a different serverRunId (or data.runId) is RunIdMismatch. Both are fail-closed terminals.
//      KEYED ONLY ON serverRunId: a status is applied only when the run id it names is the pinned serverRunId,
//      byte for byte, or (bAcceptOwnRunIdAsServerRunId) this client's own wlj_ run id, the id Julius carries once it
//      adopts the client's id while the admission pin is still the legacy run: form. There is no other fallback
//      (Julius's own run:<idempotencyKey> name and any other wlj_ id included): a status naming any other id is never
//      applied and ends the watch as RunIdMismatch. With bAcceptOwnRunIdAsServerRunId false, P2 is the legacy rule.
//   P3 TERMINALS ARE STICKY. Succeeded, Failed, Refused, DispatchFailed, NotStarted, RunIdMismatch, AnswerInvalid
//      and PollLimitReached never change again; every later answer is traced as ignored and changes nothing.
//   P4 POLLING NEVER DISPATCHES. A poll that fails (no answer, a bare 5xx, an error object, no data, no run id) is
//      counted and changes no state. It never leads to a resend or a fresh pair. A poll before the first Accepted
//      answer is not counted (PollsRecorded() stays 0).
//   P5 THE POLL SCHEDULE IS BOUNDED BY TIME, IN THREE PHASES. There is no poll-count cap. The HOLD phase runs from
//      the first Accepted answer while the bridge has not reported the operator's dispatch, and lasts at most
//      PollHoldWatchMs: the wait for the manual operator claim, shown as "Waiting for the operator to start the
//      run". When it runs out in AdmittedHeld the watch ends NotStarted (neutral, never DispatchFailed); in any other
//      state it ends PollLimitReached. The DISPATCH phase starts at the dispatch time the bridge recorded
//      (data.dispatchedAt of a "dispatched" answer, P9), not at Accepted, so the operator hold never eats into it,
//      and lasts at most PollDispatchWatchMs (360 min): longer than julius-first-live-mission.yml's paid-slot job
//      (timeout-minutes: 350), a legal wait for a paid slot before anything is spent, plus the measured ~4 min from
//      the slot to the first Julius status. The first JuliusRun status opens a fresh RUN phase of at most
//      PollRunWatchMs (330 min): longer than the first-live-mission job (timeout-minutes: 300 on the #421 line, sized for
//      the measured 291.9 min worst case with 3 repair cycles; 120 in this client line's copy of the workflow). The run phase starts at the first NextPollStep after that status
//      (the wrapper asks right after recording each answer), so it never starts early. In each phase the delay is
//      PollBaseDelayMs doubling to PollMaxDelayMs, and PollSlowDelayMs once the phase is PollSlowAfterMs (30 min)
//      old. When the next wait would pass the phase's budget: PollLimitReached, which is terminal: stop polling and
//      say so. Running out of patience is NOT a failure: the run may still be going. On this client line the dispatch
//      and run budgets are pinned as constants by the KAT (paid-slot timeout-minutes: 350 at line 132 and
//      first-live-mission timeout-minutes: 120 at line 226 of .github/workflows/julius-first-live-mission.yml here; the
//      KAT also requires >= the #421 line's 300 min and 291.9 min worst case). No test on this line reads the workflow file.
//   P6 NO SPEND, NO PASS. The display words never claim money was spent, never say PASS, qualifying or verified.
//      Succeeded only means "the status said COMPLETED": the result still goes through r2's ClassifyResultEnvelope,
//      ClassifyFinishedResult and the R4-F judge before anything is shown as an outcome.
//   P7 A 202 IS NOT A RUNNING MISSION. An Admission-vocabulary answer can only ever give AdmittedHeld,
//      OperatorStarted, DispatchUnconfirmed, NotStarted, Waiting or DispatchFailed. Only a JuliusRun-vocabulary status
//      can say Dispatched or Running, so ADMISSION_HELD with dispatched:false shows "Waiting for the operator to start
//      the run", never "running".
//   P8 JULIUS OUTRANKS ADMISSION. Once any JuliusRun status has been applied (JuliusStatusSeen()), an Admission-
//      vocabulary answer (a poll or a late replay of the dispatch) is only traced (admission_answer_logged) and
//      changes nothing: it can never move the state back to AdmittedHeld or Waiting, and never to DispatchFailed.
//      So DispatchFailed is reachable only before any Julius status: at the first Accepted answer itself, or from
//      AdmittedHeld or Waiting. A run-id mismatch is still checked first and still fails closed (P2).
//   P9 THE DISPATCH TIME IS THE BRIDGE'S, AND IT IS SET ONCE. Before any Julius status, an Admission answer with
//      data.state == BridgeDispatchedState is the operator's dispatch. Its data.dispatchedAt must parse strictly as
//      UTC ISO-8601 (YYYY-MM-DDTHH:MM:SSZ or YYYY-MM-DDTHH:MM:SS.sssZ, ParseBridgeUtcTimestampMs); then the state is
//      OperatorStarted and the dispatch window is armed once, at the first NextPollStep after it, backdated by how
//      long before the answer's ReceivedUtcMs the dispatch was recorded (never before the first Accepted answer;
//      0 when the wrapper gave no ReceivedUtcMs or its clock is behind). A missing or unparseable dispatchedAt FAILS
//      CLOSED: DispatchUnconfirmed ("Can't confirm..."), no window is started and the hold window keeps running;
//      a later "dispatched" answer with a good dispatchedAt confirms it. Once dispatched has been reported, no
//      Admission answer can move the state back to AdmittedHeld, nor to NotStarted or DispatchFailed: it is only
//      traced (admission_answer_logged), and a later dispatchedAt never restarts the window. data.cause ==
//      BridgeOperatorWindowExpiredCause (before any dispatch or Julius status) is NotStarted, whatever data.state
//      says, so the operator window's expiry is never shown as DispatchFailed.
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
	/** ^run:[0-9a-f]{24}$, JULIUS_BOOTSTRAP_RUN_ID in #407's admission-contract.ts (the legacy server run id form). */
	bool IsServerRunId(std::string_view ServerRunId);

	/**
	 * THE ONE SETTING for the wlj_ contract (P2): Wonderland mints wlj_<UUIDv4>, #407 validates and persists it, Julius
	 * (#432) adopts it unchanged. True: this client's own wlj_ run id is accepted as the server/Julius run id, and the
	 * legacy run:<24 hex> from #407 still is. False: the legacy rule only (run:<24 hex>, nothing else).
	 */
	inline constexpr bool bAcceptOwnRunIdAsServerRunId = true;

	/** RunIdPrefix + a canonical lowercase UUIDv4: ^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ */
	bool IsClientMintedRunId(std::string_view RunId);

	/**
	 * Whether ServerRunId may be pinned by the tracker created for ClientRunId: the legacy run:<24 hex> form, or (when
	 * bAcceptOwnRunIdAsServerRunId) exactly ClientRunId, byte for byte, when that is a well-formed client-minted id.
	 */
	bool IsAcceptedServerRunId(std::string_view ServerRunId, std::string_view ClientRunId);

	/* ---------------------------------------------------------------- BRIDGE's status route words (re-pin, see top) */

	/** data.state while the admission waits for the manual operator claim (BRIDGE, room 2026-10-23 11:38 PT). */
	inline constexpr std::string_view BridgeAwaitingOperatorState = "awaiting_operator";
	/** data.state once the operator claim dispatched the paid workflow; carries data.dispatchedAt (P9). */
	inline constexpr std::string_view BridgeDispatchedState = "dispatched";
	/** data.cause when the awaiting_operator window expired: unpaid, never started. Shown as NotStarted. */
	inline constexpr std::string_view BridgeOperatorWindowExpiredCause = "operator_window_expired";

	/**
	 * P9: strict UTC ISO-8601, "YYYY-MM-DDTHH:MM:SSZ" or "YYYY-MM-DDTHH:MM:SS.sssZ" (exactly 3 fraction digits, the
	 * form JavaScript's Date.prototype.toISOString writes), years 1970-9999, real calendar dates, no leap second, no
	 * offset other than Z. On success writes milliseconds since 1970-01-01T00:00:00Z. Anything else is false.
	 */
	bool ParseBridgeUtcTimestampMs(std::string_view Text, std::uint64_t& OutMs);

	enum class EMissionProgress : std::uint8_t
	{
		/** Before the first Accepted answer. r2's resend rules apply; the only state that allows a dispatch POST. */
		AwaitingDispatchAnswer,
		/**
		 * Admission state RESERVED, ADMISSION_HELD, LEDGER_UNWRITTEN or BRIDGE's awaiting_operator: the pair is admitted
		 * and waits for the manual operator claim; no paid run yet. Bounded by the hold window (P5).
		 */
		AdmittedHeld,
		/** BRIDGE's "dispatched" with a well-formed dispatchedAt: the operator started the run; no Julius status yet. */
		OperatorStarted,
		/** BRIDGE's "dispatched" with a missing or unparseable dispatchedAt: fail closed, no dispatch window (P9). */
		DispatchUnconfirmed,
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
		/**
		 * Terminal. Admission state INTERRUPTED or FAILED: the bridge ended the admission (markTerminal). Reachable only
		 * before any JuliusRun status was applied (P8).
		 */
		DispatchFailed,
		/**
		 * Terminal, neutral. The operator never started the run: BRIDGE's operator_window_expired cause, or the client's
		 * hold window ran out while AdmittedHeld (P5). Never DispatchFailed, never a failure.
		 */
		NotStarted,
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
	 * DispatchUnconfirmed, NotStarted, RunIdMismatch, AnswerInvalid or PollLimitReached (those need more than the
	 * status string); an unrecognised string, a case variant, padding or an empty string is Waiting.
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
		/** data.dispatchedAt on BRIDGE's status answer (UTC ISO-8601); empty when absent (P9). */
		std::string_view DispatchedAt;
		/** data.cause on BRIDGE's status answer; empty when absent. */
		std::string_view Cause;
		/** The wrapper's own UTC clock (ms since 1970) when this answer arrived; 0 when unknown (P9). */
		std::uint64_t ReceivedUtcMs = 0;
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
		/** P8: an Admission-vocabulary answer after a JuliusRun status was applied. Traced; the state does not change. */
		AdmissionAnswerLogged,
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
		/** NextPollStep ran out of the hold window while AdmittedHeld: NotStarted (P5). */
		HoldWindowExpired,
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
		/** The status string as received when it is 1-32 characters of [A-Za-z_]; otherwise "-" (never free text). */
		std::string Status;
	};

	/* ---------------------------------------------------------------- the poll schedule, P5 */

	inline constexpr std::uint32_t PollBaseDelayMs = 5000;
	inline constexpr std::uint32_t PollGrowthFactor = 2;
	inline constexpr std::uint32_t PollMaxDelayMs = 60000;
	/** Once a phase is this old (30 min), every wait is PollSlowDelayMs. */
	inline constexpr std::uint64_t PollSlowAfterMs = 1800000;
	inline constexpr std::uint32_t PollSlowDelayMs = 120000;
	/**
	 * 180 min from the first Accepted answer while the bridge has not reported the operator's dispatch (P5). PROVISIONAL:
	 * BRIDGE has not posted the awaiting_operator expiry yet; re-pin to at least that expiry plus one slow wait
	 * (PollSlowDelayMs), so the client sees BRIDGE's operator_window_expired before its own window ends.
	 */
	inline constexpr std::uint64_t PollHoldWatchMs = 10800000;
	/**
	 * 360 min from BRIDGE's recorded dispatchedAt while no JuliusRun status has been applied. Must stay >= the
	 * paid-slot job's timeout-minutes: 350 in .github/workflows/julius-first-live-mission.yml (line 132 on this client line;
	 * pinned as a KAT constant here, by the .ts test on the #421 line).
	 */
	inline constexpr std::uint64_t PollDispatchWatchMs = 21600000;
	/**
	 * 330 min from the first JuliusRun status. Must stay >= the first-live-mission job's timeout-minutes: 300 (worst
	 * case 291.9 min with 3 repair cycles) in the #421 line's .github/workflows/julius-first-live-mission.yml. This
	 * client line's copy has timeout-minutes: 120 at line 226. Pinned as a KAT constant here.
	 */
	inline constexpr std::uint64_t PollRunWatchMs = 19800000;

	/** P5: which budget applies. Hold until dispatch is confirmed, Dispatch until the first JuliusRun status, then Run. */
	enum class EPollPhase : std::uint8_t
	{
		Hold,
		Dispatch,
		Run,
	};

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
	 * Pure and deterministic, like r2's NextResend. PollsSent: polls already sent for this run. PhaseWatchedMs: wall
	 * time since the phase began (Hold: the first Accepted answer; Dispatch: BRIDGE's dispatchedAt; Run: the first
	 * JuliusRun status), as the wrapper measured it. The delay before poll N (from 0) is min(PollBaseDelayMs * PollGrowthFactor^N,
	 * PollMaxDelayMs): 5,000, 10,000, 20,000, 40,000 ms, then 60,000 ms; PollSlowDelayMs once PhaseWatchedMs reaches
	 * PollSlowAfterMs. Stop when the wait would take PhaseWatchedMs past the phase's budget (PollHoldWatchMs,
	 * PollDispatchWatchMs or PollRunWatchMs). There is no count cap.
	 */
	FPollDecision NextPoll(std::uint32_t PollsSent, EPollPhase Phase, std::uint64_t PhaseWatchedMs);

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
		 * Whether to poll, and after what wait. WatchedMs: wall time since the first Accepted answer. Stop in
		 * AwaitingDispatchAnswer and in every terminal state. The first call after a confirmed dispatch starts the
		 * Dispatch phase at WatchedMs minus the dispatch's age (P9); the first call after a JuliusRun status was applied
		 * starts the Run phase at WatchedMs (P5). When the phase's budget is spent it moves to PollLimitReached, or
		 * to NotStarted when the hold window runs out in AdmittedHeld (traced), and answers Stop from then on.
		 */
		FPollDecision NextPollStep(std::uint64_t WatchedMs);

		/** P1: true only before the first Accepted answer and before any terminal state. */
		bool DispatchSendAllowed() const { return State == EMissionProgress::AwaitingDispatchAnswer; }

		EMissionProgress Current() const { return State; }
		const std::string& PinnedServerRunId() const { return ServerRunId; }
		std::uint32_t PollsRecorded() const { return PollsSent; }
		/** P8: true once any JuliusRun status has been applied for the pinned run. */
		bool JuliusStatusSeen() const { return bJuliusStatusSeen; }
		/** P9: true once BRIDGE reported "dispatched" (with or without a usable dispatchedAt). */
		bool DispatchReported() const { return bDispatchReported; }
		/** P9: true once a "dispatched" answer carried a well-formed dispatchedAt. */
		bool DispatchConfirmed() const { return bDispatchConfirmed; }
		EPollPhase PollPhase() const
		{
			return bJuliusStatusSeen ? EPollPhase::Run : bDispatchConfirmed ? EPollPhase::Dispatch : EPollPhase::Hold;
		}
		const std::vector<FProgressTrace>& Trace() const { return Events; }

	private:
		EMissionProgress Move(EProgressEvent Event, EMissionProgress To, const FStatusAnswer* Fields);
		/**
		 * An Admission-vocabulary status for the pinned run: applied before any Julius status and before a reported
		 * dispatch, logged after (P8, P9); "dispatched" and the operator-window cause are handled here (P9).
		 */
		EMissionProgress ApplyAdmission(EProgressEvent Event, const FStatusAnswer& Fields);
		/** P2: an answer's run id names the pinned run: the pin itself, or (when enabled) this client's own wlj_ id. */
		bool NamesPinnedRun(std::string_view NamedServerRunId) const;

		std::string ClientRunId;
		std::string ServerRunId;
		EMissionProgress State = EMissionProgress::AwaitingDispatchAnswer;
		std::uint32_t PollsSent = 0;
		bool bJuliusStatusSeen = false;
		bool bRunPhaseStarted = false;
		std::uint64_t RunPhaseStartMs = 0;
		bool bDispatchReported = false;
		bool bDispatchConfirmed = false;
		bool bDispatchPhaseStarted = false;
		std::uint64_t DispatchAgeAtReportMs = 0;
		std::uint64_t DispatchPhaseStartMs = 0;
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

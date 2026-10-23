// WONDERLAND -- J1 mission progress logic after Accepted. See WonderlandJuliusMissionProgress.h for the rules.
#include "WonderlandJuliusMissionProgress.h"

#include <cstdint>
#include <limits>
#include <utility>

namespace WonderlandJuliusMissionLogic
{
	namespace
	{
		// Names are unique to this file: an Unreal unity build may join it with WonderlandJuliusMissionLogic.cpp.
		constexpr std::string_view ProgressServerRunIdPrefix = "run:";
		constexpr std::size_t ProgressServerRunIdHexLength = 24;
		constexpr std::size_t ProgressTraceStatusMax = 32;
		constexpr std::uint64_t ProgressMsPerDay = 86400000;

		bool ProgressIsLowerHexDigit(char Character)
		{
			return (Character >= '0' && Character <= '9') || (Character >= 'a' && Character <= 'f');
		}

		/** A status string is echoed into a trace line only when it is short letters-and-underscore: never free text. */
		std::string ProgressTraceStatus(std::string_view Status)
		{
			if (Status.empty() || Status.size() > ProgressTraceStatusMax)
			{
				return "-";
			}
			for (const char Character : Status)
			{
				if (!((Character >= 'A' && Character <= 'Z') || (Character >= 'a' && Character <= 'z') || Character == '_'))
				{
					return "-";
				}
			}
			return std::string(Status);
		}

		bool ProgressDigits(std::string_view Text, std::size_t Begin, std::size_t Count, std::uint32_t& Out)
		{
			Out = 0;
			for (std::size_t Index = Begin; Index < Begin + Count; ++Index)
			{
				const char Character = Text[Index];
				if (Character < '0' || Character > '9')
				{
					return false;
				}
				Out = Out * 10 + static_cast<std::uint32_t>(Character - '0');
			}
			return true;
		}

		bool ProgressIsLeapYear(std::uint32_t Year)
		{
			return (Year % 4 == 0 && Year % 100 != 0) || Year % 400 == 0;
		}

		/** Days from 1970-01-01 to Year-Month-Day (proleptic Gregorian; Year >= 1970, a valid date). */
		std::uint64_t ProgressDaysSinceEpoch(std::uint32_t Year, std::uint32_t Month, std::uint32_t Day)
		{
			static constexpr std::uint32_t DaysBeforeMonth[12] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
			std::uint64_t Days = 0;
			for (std::uint32_t Each = 1970; Each < Year; ++Each)
			{
				Days += ProgressIsLeapYear(Each) ? 366 : 365;
			}
			Days += DaysBeforeMonth[Month - 1];
			if (Month > 2 && ProgressIsLeapYear(Year))
			{
				Days += 1;
			}
			return Days + (Day - 1);
		}

		bool ProgressIsReadable(const FStatusAnswer& Fields)
		{
			return Fields.HttpStatus >= 200 && Fields.HttpStatus <= 299 && !Fields.bHasError && Fields.ErrorKind.empty()
				&& Fields.bHasData;
		}
	}

	bool IsServerRunId(std::string_view ServerRunId)
	{
		if (ServerRunId.size() != ProgressServerRunIdPrefix.size() + ProgressServerRunIdHexLength
			|| ServerRunId.substr(0, ProgressServerRunIdPrefix.size()) != ProgressServerRunIdPrefix)
		{
			return false;
		}
		for (const char Character : ServerRunId.substr(ProgressServerRunIdPrefix.size()))
		{
			if (!ProgressIsLowerHexDigit(Character))
			{
				return false;
			}
		}
		return true;
	}

	bool ParseBridgeUtcTimestampMs(std::string_view Text, std::uint64_t& OutMs)
	{
		// "YYYY-MM-DDTHH:MM:SSZ" (20) or "YYYY-MM-DDTHH:MM:SS.sssZ" (24), nothing else.
		if (Text.size() != 20 && Text.size() != 24)
		{
			return false;
		}
		if (Text[4] != '-' || Text[7] != '-' || Text[10] != 'T' || Text[13] != ':' || Text[16] != ':'
			|| Text[Text.size() - 1] != 'Z')
		{
			return false;
		}
		std::uint32_t Year = 0, Month = 0, Day = 0, Hour = 0, Minute = 0, Second = 0, Milli = 0;
		if (!ProgressDigits(Text, 0, 4, Year) || !ProgressDigits(Text, 5, 2, Month) || !ProgressDigits(Text, 8, 2, Day)
			|| !ProgressDigits(Text, 11, 2, Hour) || !ProgressDigits(Text, 14, 2, Minute) || !ProgressDigits(Text, 17, 2, Second))
		{
			return false;
		}
		if (Text.size() == 24 && (Text[19] != '.' || !ProgressDigits(Text, 20, 3, Milli)))
		{
			return false;
		}
		static constexpr std::uint32_t DaysInMonth[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
		if (Year < 1970 || Month < 1 || Month > 12 || Day < 1 || Hour > 23 || Minute > 59 || Second > 59)
		{
			return false;
		}
		const std::uint32_t MonthDays = DaysInMonth[Month - 1] + ((Month == 2 && ProgressIsLeapYear(Year)) ? 1u : 0u);
		if (Day > MonthDays)
		{
			return false;
		}
		OutMs = ProgressDaysSinceEpoch(Year, Month, Day) * ProgressMsPerDay
			+ ((static_cast<std::uint64_t>(Hour) * 60 + Minute) * 60 + Second) * 1000 + Milli;
		return true;
	}

	bool IsTerminalProgress(EMissionProgress State)
	{
		switch (State)
		{
		case EMissionProgress::Succeeded:
		case EMissionProgress::Failed:
		case EMissionProgress::Refused:
		case EMissionProgress::DispatchFailed:
		case EMissionProgress::NotStarted:
		case EMissionProgress::RunIdMismatch:
		case EMissionProgress::AnswerInvalid:
		case EMissionProgress::PollLimitReached:
			return true;
		case EMissionProgress::AwaitingDispatchAnswer:
		case EMissionProgress::AdmittedHeld:
		case EMissionProgress::OperatorStarted:
		case EMissionProgress::DispatchUnconfirmed:
		case EMissionProgress::Dispatched:
		case EMissionProgress::Running:
		case EMissionProgress::Paused:
		case EMissionProgress::Waiting:
			return false;
		}
		return true;
	}

	EMissionProgress ProgressFromStatus(EStatusVocabulary Vocabulary, std::string_view Status)
	{
		if (Vocabulary == EStatusVocabulary::Admission)
		{
			// admission-store.ts AdmissionState (#407 dd0153a0) and BRIDGE's status-route words (P9), exact bytes.
			if (Status == "RESERVED" || Status == "ADMISSION_HELD" || Status == "LEDGER_UNWRITTEN"
				|| Status == BridgeAwaitingOperatorState)
			{
				return EMissionProgress::AdmittedHeld;
			}
			if (Status == BridgeDispatchedState)
			{
				return EMissionProgress::OperatorStarted;
			}
			if (Status == "INTERRUPTED" || Status == "FAILED")
			{
				return EMissionProgress::DispatchFailed;
			}
			return EMissionProgress::Waiting;
		}
		if (Vocabulary == EStatusVocabulary::JuliusRun)
		{
			// julius-runtime.ts JULIUS_MISSION_STATES, exact bytes.
			if (Status == "CREATED" || Status == "PLANNING" || Status == "READY")
			{
				return EMissionProgress::Dispatched;
			}
			if (Status == "EXECUTING" || Status == "WAITING" || Status == "REVIEWING" || Status == "REPAIRING"
				|| Status == "VERIFYING")
			{
				return EMissionProgress::Running;
			}
			if (Status == "BLOCKED" || Status == "PAUSED")
			{
				return EMissionProgress::Paused;
			}
			if (Status == "COMPLETED")
			{
				return EMissionProgress::Succeeded;
			}
			if (Status == "FAILED" || Status == "CANCELLED")
			{
				return EMissionProgress::Failed;
			}
			return EMissionProgress::Waiting;
		}
		return EMissionProgress::Waiting;
	}

	FPollDecision NextPoll(std::uint32_t PollsSent, EPollPhase Phase, std::uint64_t PhaseWatchedMs)
	{
		const std::uint64_t Budget = Phase == EPollPhase::Run ? PollRunWatchMs
			: Phase == EPollPhase::Dispatch ? PollDispatchWatchMs : PollHoldWatchMs;
		std::uint64_t Delay = PollBaseDelayMs;
		if (PhaseWatchedMs >= PollSlowAfterMs)
		{
			Delay = PollSlowDelayMs;
		}
		else
		{
			for (std::uint32_t Step = 0; Step < PollsSent && Delay < PollMaxDelayMs; ++Step)
			{
				Delay *= PollGrowthFactor;
			}
			if (Delay > PollMaxDelayMs)
			{
				Delay = PollMaxDelayMs;
			}
		}
		if (PhaseWatchedMs > Budget || Delay > Budget - PhaseWatchedMs)
		{
			return {};
		}
		return {EPollStep::WaitThenPoll, static_cast<std::uint32_t>(Delay)};
	}

	FMissionProgressTracker::FMissionProgressTracker(std::string InClientRunId)
		: ClientRunId(std::move(InClientRunId))
	{
		Move(EProgressEvent::Started, EMissionProgress::AwaitingDispatchAnswer, nullptr);
	}

	EMissionProgress FMissionProgressTracker::Move(EProgressEvent Event, EMissionProgress To, const FStatusAnswer* Fields)
	{
		FProgressTrace Trace;
		Trace.Event = Event;
		Trace.From = State;
		Trace.To = To;
		Trace.ServerRunId = ServerRunId;
		Trace.ClientRunId = ClientRunId;
		Trace.HttpStatus = Fields != nullptr ? Fields->HttpStatus : 0;
		Trace.PollIndex = PollsSent;
		Trace.Status = Fields != nullptr ? ProgressTraceStatus(Fields->Status) : std::string("-");
		Events.push_back(std::move(Trace));
		State = To;
		return State;
	}

	EMissionProgress FMissionProgressTracker::RecordDispatchAnswer(EDispatchAnswer Answer, const FStatusAnswer& Fields)
	{
		if (IsTerminalProgress(State))
		{
			return Move(EProgressEvent::IgnoredAfterTerminal, State, &Fields);
		}
		if (State == EMissionProgress::AwaitingDispatchAnswer)
		{
			if (Answer == EDispatchAnswer::NoAnswer)
			{
				return Move(EProgressEvent::DispatchUnanswered, State, &Fields);
			}
			if (Answer == EDispatchAnswer::Refused)
			{
				return Move(EProgressEvent::DispatchRefused, EMissionProgress::Refused, &Fields);
			}
			// Accepted: the pair is spent from here on, whatever the body says (P1). Pin or fail closed (P2).
			if (!Fields.bHasData || !IsServerRunId(Fields.ServerRunId) || Fields.ClientRunId.empty())
			{
				return Move(EProgressEvent::AnswerRejected, EMissionProgress::AnswerInvalid, &Fields);
			}
			if (Fields.ClientRunId != ClientRunId)
			{
				return Move(EProgressEvent::RunIdMismatched, EMissionProgress::RunIdMismatch, &Fields);
			}
			ServerRunId = std::string(Fields.ServerRunId);
			return ApplyAdmission(EProgressEvent::Admitted, Fields);
		}
		// After Accepted. Only a late answer to an earlier send of the same pair can arrive here; it never re-opens
		// anything. A readable one is checked against the pinned ids and applied like a poll.
		if (Answer != EDispatchAnswer::Accepted)
		{
			return Move(EProgressEvent::LateDispatchAnswerIgnored, State, &Fields);
		}
		if ((!Fields.ServerRunId.empty() && Fields.ServerRunId != ServerRunId)
			|| (!Fields.ClientRunId.empty() && Fields.ClientRunId != ClientRunId))
		{
			return Move(EProgressEvent::RunIdMismatched, EMissionProgress::RunIdMismatch, &Fields);
		}
		if (!Fields.bHasData || Fields.ServerRunId.empty() || Fields.ClientRunId.empty())
		{
			return Move(EProgressEvent::LateDispatchAnswerIgnored, State, &Fields);
		}
		return ApplyAdmission(EProgressEvent::DispatchReplayed, Fields);
	}

	EMissionProgress FMissionProgressTracker::ApplyAdmission(EProgressEvent Event, const FStatusAnswer& Fields)
	{
		const bool bSaysDispatched = Fields.Status == BridgeDispatchedState;
		if (bJuliusStatusSeen || (bDispatchReported && (bDispatchConfirmed || !bSaysDispatched)))
		{
			// P8: Julius has reported this run; P9: the bridge has reported its dispatch. The admission vocabulary can
			// no longer move it back, nor end it, and a later dispatchedAt never restarts the window.
			return Move(EProgressEvent::AdmissionAnswerLogged, State, &Fields);
		}
		if (bSaysDispatched)
		{
			bDispatchReported = true;
			std::uint64_t DispatchedAtMs = 0;
			if (!ParseBridgeUtcTimestampMs(Fields.DispatchedAt, DispatchedAtMs))
			{
				// P9: fail closed. Dispatched, but not when: no window starts; the hold window keeps running.
				return Move(Event, EMissionProgress::DispatchUnconfirmed, &Fields);
			}
			bDispatchConfirmed = true;
			DispatchAgeAtReportMs = Fields.ReceivedUtcMs > DispatchedAtMs ? Fields.ReceivedUtcMs - DispatchedAtMs : 0;
			return Move(Event, EMissionProgress::OperatorStarted, &Fields);
		}
		if (Fields.Cause == BridgeOperatorWindowExpiredCause)
		{
			// P9: the operator window expired before any dispatch: not started, never DispatchFailed.
			return Move(Event, EMissionProgress::NotStarted, &Fields);
		}
		return Move(Event, ProgressFromStatus(EStatusVocabulary::Admission, Fields.Status), &Fields);
	}

	EMissionProgress FMissionProgressTracker::RecordPollAnswer(const FStatusAnswer& Fields)
	{
		if (State == EMissionProgress::AwaitingDispatchAnswer)
		{
			// Nothing to poll before Accepted; not counted, nothing changes.
			return Move(EProgressEvent::PollFailed, State, &Fields);
		}
		if (PollsSent != std::numeric_limits<std::uint32_t>::max())
		{
			++PollsSent;
		}
		if (IsTerminalProgress(State))
		{
			return Move(EProgressEvent::IgnoredAfterTerminal, State, &Fields);
		}
		if (!ProgressIsReadable(Fields))
		{
			return Move(EProgressEvent::PollFailed, State, &Fields);
		}
		if ((!Fields.ServerRunId.empty() && Fields.ServerRunId != ServerRunId)
			|| (!Fields.ClientRunId.empty() && Fields.ClientRunId != ClientRunId))
		{
			return Move(EProgressEvent::RunIdMismatched, EMissionProgress::RunIdMismatch, &Fields);
		}
		if (Fields.ServerRunId.empty() || (Fields.Vocabulary == EStatusVocabulary::Admission && Fields.ClientRunId.empty()))
		{
			// Cannot tell whose status this is: not ours to apply.
			return Move(EProgressEvent::PollFailed, State, &Fields);
		}
		if (Fields.Vocabulary == EStatusVocabulary::Admission)
		{
			return ApplyAdmission(EProgressEvent::StatusApplied, Fields);
		}
		if (Fields.Vocabulary == EStatusVocabulary::JuliusRun)
		{
			bJuliusStatusSeen = true;
		}
		return Move(EProgressEvent::StatusApplied, ProgressFromStatus(Fields.Vocabulary, Fields.Status), &Fields);
	}

	FPollDecision FMissionProgressTracker::NextPollStep(std::uint64_t WatchedMs)
	{
		if (State == EMissionProgress::AwaitingDispatchAnswer || IsTerminalProgress(State))
		{
			return {};
		}
		std::uint64_t PhaseWatchedMs = WatchedMs;
		if (bJuliusStatusSeen)
		{
			if (!bRunPhaseStarted)
			{
				// P5: the fresh Run window starts now, at the first ask after the first JuliusRun status.
				bRunPhaseStarted = true;
				RunPhaseStartMs = WatchedMs;
			}
			PhaseWatchedMs = WatchedMs >= RunPhaseStartMs ? WatchedMs - RunPhaseStartMs : 0;
		}
		else if (bDispatchConfirmed)
		{
			if (!bDispatchPhaseStarted)
			{
				// P9: the dispatch window starts at BRIDGE's dispatchedAt: now, backdated by the dispatch's age when
				// the answer arrived, but never before the first Accepted answer (WatchedMs 0).
				bDispatchPhaseStarted = true;
				DispatchPhaseStartMs = WatchedMs - (DispatchAgeAtReportMs < WatchedMs ? DispatchAgeAtReportMs : WatchedMs);
			}
			PhaseWatchedMs = WatchedMs >= DispatchPhaseStartMs ? WatchedMs - DispatchPhaseStartMs : 0;
		}
		const EPollPhase Phase = PollPhase();
		const FPollDecision Decision = NextPoll(PollsSent, Phase, PhaseWatchedMs);
		if (Decision.Step == EPollStep::Stop)
		{
			if (Phase == EPollPhase::Hold && State == EMissionProgress::AdmittedHeld)
			{
				// P5: the operator never started the run inside the hold window: neutral, never DispatchFailed.
				Move(EProgressEvent::HoldWindowExpired, EMissionProgress::NotStarted, nullptr);
			}
			else
			{
				Move(EProgressEvent::PollLimitReached, EMissionProgress::PollLimitReached, nullptr);
			}
		}
		return Decision;
	}

	const char* ProgressDisplayLabel(EMissionProgress State)
	{
		switch (State)
		{
		case EMissionProgress::AwaitingDispatchAnswer: return "Sent \xE2\x80\x94 waiting for the bridge to answer";
		case EMissionProgress::AdmittedHeld: return "Waiting for the operator to start the run";
		case EMissionProgress::OperatorStarted: return "The operator started the run \xE2\x80\x94 waiting for Julius to report";
		case EMissionProgress::DispatchUnconfirmed: return "Can't confirm when the run was started \xE2\x80\x94 still checking with the bridge";
		case EMissionProgress::Dispatched: return "Handed to Julius \xE2\x80\x94 waiting for it to start";
		case EMissionProgress::Running: return "Julius is working on the mission";
		case EMissionProgress::Paused: return "Julius has paused the mission \xE2\x80\x94 waiting";
		case EMissionProgress::Waiting: return "Waiting for the bridge \xE2\x80\x94 no status it recognises yet";
		case EMissionProgress::Succeeded: return "Julius reports the mission finished \xE2\x80\x94 checking the result";
		case EMissionProgress::Failed: return "Julius reports the mission did not finish";
		case EMissionProgress::Refused: return "The bridge refused the request \xE2\x80\x94 nothing was started";
		case EMissionProgress::DispatchFailed: return "The bridge ended this request before Julius reported a run";
		case EMissionProgress::NotStarted: return "Not started \xE2\x80\x94 no operator start was reported in time; nothing will be resent";
		case EMissionProgress::RunIdMismatch: return "Stopped \xE2\x80\x94 the bridge named a different run; nothing will be resent";
		case EMissionProgress::AnswerInvalid: return "Stopped \xE2\x80\x94 the bridge's answer could not be checked; nothing will be resent";
		case EMissionProgress::PollLimitReached: return "Stopped checking \xE2\x80\x94 the mission may still be going; ask the bridge";
		}
		return "Waiting for the bridge \xE2\x80\x94 no status it recognises yet";
	}

	const char* ProgressStateName(EMissionProgress State)
	{
		switch (State)
		{
		case EMissionProgress::AwaitingDispatchAnswer: return "awaiting_dispatch_answer";
		case EMissionProgress::AdmittedHeld: return "admitted_held";
		case EMissionProgress::OperatorStarted: return "operator_started";
		case EMissionProgress::DispatchUnconfirmed: return "dispatch_unconfirmed";
		case EMissionProgress::Dispatched: return "dispatched";
		case EMissionProgress::Running: return "running";
		case EMissionProgress::Paused: return "paused";
		case EMissionProgress::Waiting: return "waiting";
		case EMissionProgress::Succeeded: return "succeeded";
		case EMissionProgress::Failed: return "failed";
		case EMissionProgress::Refused: return "refused";
		case EMissionProgress::DispatchFailed: return "dispatch_failed";
		case EMissionProgress::NotStarted: return "not_started";
		case EMissionProgress::RunIdMismatch: return "run_id_mismatch";
		case EMissionProgress::AnswerInvalid: return "answer_invalid";
		case EMissionProgress::PollLimitReached: return "poll_limit_reached";
		}
		return "unknown";
	}

	const char* ProgressEventName(EProgressEvent Event)
	{
		switch (Event)
		{
		case EProgressEvent::Started: return "started";
		case EProgressEvent::DispatchUnanswered: return "dispatch_unanswered";
		case EProgressEvent::DispatchRefused: return "dispatch_refused";
		case EProgressEvent::Admitted: return "admitted";
		case EProgressEvent::DispatchReplayed: return "dispatch_replayed";
		case EProgressEvent::LateDispatchAnswerIgnored: return "late_dispatch_answer_ignored";
		case EProgressEvent::StatusApplied: return "status_applied";
		case EProgressEvent::AdmissionAnswerLogged: return "admission_answer_logged";
		case EProgressEvent::PollFailed: return "poll_failed";
		case EProgressEvent::RunIdMismatched: return "run_id_mismatched";
		case EProgressEvent::AnswerRejected: return "answer_rejected";
		case EProgressEvent::IgnoredAfterTerminal: return "ignored_after_terminal";
		case EProgressEvent::PollLimitReached: return "poll_limit_reached";
		case EProgressEvent::HoldWindowExpired: return "hold_window_expired";
		}
		return "unknown";
	}

	std::string FormatProgressTrace(const FProgressTrace& Trace)
	{
		std::string Line = "j1_progress event=";
		Line += ProgressEventName(Trace.Event);
		Line += " from=";
		Line += ProgressStateName(Trace.From);
		Line += " to=";
		Line += ProgressStateName(Trace.To);
		Line += " client_run_id=";
		Line += Trace.ClientRunId.empty() ? std::string("-") : Trace.ClientRunId;
		Line += " server_run_id=";
		Line += Trace.ServerRunId.empty() ? std::string("-") : Trace.ServerRunId;
		Line += " http=";
		Line += std::to_string(Trace.HttpStatus);
		Line += " poll=";
		Line += std::to_string(Trace.PollIndex);
		Line += " status=";
		Line += Trace.Status;
		return Line;
	}
}

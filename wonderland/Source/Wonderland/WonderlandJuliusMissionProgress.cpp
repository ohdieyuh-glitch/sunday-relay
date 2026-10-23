// WONDERLAND -- J1 mission progress logic after Accepted. See WonderlandJuliusMissionProgress.h for the rules.
#include "WonderlandJuliusMissionProgress.h"

#include <utility>

namespace WonderlandJuliusMissionLogic
{
	namespace
	{
		// Names are unique to this file: an Unreal unity build may join it with WonderlandJuliusMissionLogic.cpp.
		constexpr std::string_view ProgressServerRunIdPrefix = "run:";
		constexpr std::size_t ProgressServerRunIdHexLength = 24;
		constexpr std::size_t ProgressTraceStatusMax = 32;

		bool ProgressIsLowerHexDigit(char Character)
		{
			return (Character >= '0' && Character <= '9') || (Character >= 'a' && Character <= 'f');
		}

		/** A status string is echoed into a trace line only when it is short upper-case snake: never free text. */
		std::string ProgressTraceStatus(std::string_view Status)
		{
			if (Status.empty() || Status.size() > ProgressTraceStatusMax)
			{
				return "-";
			}
			for (const char Character : Status)
			{
				if (!((Character >= 'A' && Character <= 'Z') || Character == '_'))
				{
					return "-";
				}
			}
			return std::string(Status);
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

	bool IsTerminalProgress(EMissionProgress State)
	{
		switch (State)
		{
		case EMissionProgress::Succeeded:
		case EMissionProgress::Failed:
		case EMissionProgress::Refused:
		case EMissionProgress::DispatchFailed:
		case EMissionProgress::RunIdMismatch:
		case EMissionProgress::AnswerInvalid:
		case EMissionProgress::PollLimitReached:
			return true;
		case EMissionProgress::AwaitingDispatchAnswer:
		case EMissionProgress::AdmittedHeld:
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
			// admission-store.ts AdmissionState (#407 dd0153a0), exact bytes.
			if (Status == "RESERVED" || Status == "ADMISSION_HELD" || Status == "LEDGER_UNWRITTEN")
			{
				return EMissionProgress::AdmittedHeld;
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

	FPollDecision NextPoll(std::uint32_t PollsSent, std::uint64_t WatchedMs)
	{
		if (PollsSent >= PollMaxCount)
		{
			return {};
		}
		std::uint64_t Delay = PollBaseDelayMs;
		for (std::uint32_t Step = 0; Step < PollsSent && Delay < PollMaxDelayMs; ++Step)
		{
			Delay *= PollGrowthFactor;
		}
		if (Delay > PollMaxDelayMs)
		{
			Delay = PollMaxDelayMs;
		}
		if (WatchedMs > PollMaxTotalWatchMs || Delay > PollMaxTotalWatchMs - WatchedMs)
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
			return Move(EProgressEvent::Admitted, ProgressFromStatus(EStatusVocabulary::Admission, Fields.Status), &Fields);
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
		return Move(EProgressEvent::DispatchReplayed, ProgressFromStatus(EStatusVocabulary::Admission, Fields.Status), &Fields);
	}

	EMissionProgress FMissionProgressTracker::RecordPollAnswer(const FStatusAnswer& Fields)
	{
		if (State == EMissionProgress::AwaitingDispatchAnswer)
		{
			// Nothing to poll before Accepted; not counted, nothing changes.
			return Move(EProgressEvent::PollFailed, State, &Fields);
		}
		if (PollsSent < PollMaxCount)
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
		return Move(EProgressEvent::StatusApplied, ProgressFromStatus(Fields.Vocabulary, Fields.Status), &Fields);
	}

	FPollDecision FMissionProgressTracker::NextPollStep(std::uint64_t WatchedMs)
	{
		if (State == EMissionProgress::AwaitingDispatchAnswer || IsTerminalProgress(State))
		{
			return {};
		}
		const FPollDecision Decision = NextPoll(PollsSent, WatchedMs);
		if (Decision.Step == EPollStep::Stop)
		{
			Move(EProgressEvent::PollLimitReached, EMissionProgress::PollLimitReached, nullptr);
		}
		return Decision;
	}

	const char* ProgressDisplayLabel(EMissionProgress State)
	{
		switch (State)
		{
		case EMissionProgress::AwaitingDispatchAnswer: return "Sent \xE2\x80\x94 waiting for the bridge to answer";
		case EMissionProgress::AdmittedHeld: return "Admitted \xE2\x80\x94 waiting for the paid run";
		case EMissionProgress::Dispatched: return "Handed to Julius \xE2\x80\x94 waiting for it to start";
		case EMissionProgress::Running: return "Julius is working on the mission";
		case EMissionProgress::Paused: return "Julius has paused the mission \xE2\x80\x94 waiting";
		case EMissionProgress::Waiting: return "Waiting for the bridge \xE2\x80\x94 no status it recognises yet";
		case EMissionProgress::Succeeded: return "Julius reports the mission finished \xE2\x80\x94 checking the result";
		case EMissionProgress::Failed: return "Julius reports the mission did not finish";
		case EMissionProgress::Refused: return "The bridge refused the request \xE2\x80\x94 nothing was started";
		case EMissionProgress::DispatchFailed: return "The bridge ended this request before the paid run";
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
		case EMissionProgress::Dispatched: return "dispatched";
		case EMissionProgress::Running: return "running";
		case EMissionProgress::Paused: return "paused";
		case EMissionProgress::Waiting: return "waiting";
		case EMissionProgress::Succeeded: return "succeeded";
		case EMissionProgress::Failed: return "failed";
		case EMissionProgress::Refused: return "refused";
		case EMissionProgress::DispatchFailed: return "dispatch_failed";
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
		case EProgressEvent::PollFailed: return "poll_failed";
		case EProgressEvent::RunIdMismatched: return "run_id_mismatched";
		case EProgressEvent::AnswerRejected: return "answer_rejected";
		case EProgressEvent::IgnoredAfterTerminal: return "ignored_after_terminal";
		case EProgressEvent::PollLimitReached: return "poll_limit_reached";
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

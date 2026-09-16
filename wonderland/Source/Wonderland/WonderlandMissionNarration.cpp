#include "WonderlandMissionNarration.h"

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandNarrationDetail
{
	struct FJuliusRow
	{
		const TCHAR* Event;
		FWonderlandJuliusNarration Narration;
	};

	// EVERY EVENT THE DETERMINISTIC FIXTURES EMIT, in the order a mission meets them. A row per real Julius event name,
	// plus the fixtures' labelled stand-ins (simulated.*) for the three beats Julius cannot yet emit.
	const FJuliusRow JuliusRows[] = {
		{ TEXT("run.started"),            { TEXT("Mission started. Scoped task accepted."), TEXT(""), TEXT(""), TEXT(""), TEXT("RUNNING") } },
		{ TEXT("mission.contract.locked"),{ TEXT("Mission Contract created: RED. Preparing."), TEXT(""), TEXT(""), TEXT(""), TEXT("PREPARING") } },
		{ TEXT("research.requested"),     { TEXT("Research requested for the mission."), TEXT("PROMPT ARCHITECT"), TEXT("ACTIVE"), TEXT("Researching the task and its context."), TEXT("RESEARCH") } },
		{ TEXT("research.served"),        { TEXT("Research served back to the mission."), TEXT("PROMPT ARCHITECT"), TEXT("ACTIVE"), TEXT("Research gathered. Moving to planning."), TEXT("RESEARCH") } },
		{ TEXT("simulated.handoff"),      { TEXT("Handoff between roles."), TEXT(""), TEXT(""), TEXT(""), TEXT("HANDOFF") } },
		{ TEXT("architect.started"),      { TEXT("Planning started."), TEXT("PROMPT ARCHITECT"), TEXT("ACTIVE"), TEXT("Planning: drafting the implementation brief."), TEXT("PLANNING") } },
		{ TEXT("architect.guidance"),     { TEXT("Guidance accepted into the plan."), TEXT("PROMPT ARCHITECT"), TEXT("DONE"), TEXT("Brief issued to the Coding Agent."), TEXT("PLANNING") } },
		{ TEXT("coder.started"),          { TEXT("Implementation under way."), TEXT("CODING AGENT"), TEXT("ACTIVE"), TEXT("Implementing the brief."), TEXT("IMPLEMENTING") } },
		{ TEXT("task.paused"),            { TEXT("Checkpoint: waiting for approval."), TEXT("CODING AGENT"), TEXT("PAUSED"), TEXT("Paused at a checkpoint."), TEXT("CHECKPOINT") } },
		{ TEXT("simulated.approval"),     { TEXT("Approved. Continuing."), TEXT("CODING AGENT"), TEXT("ACTIVE"), TEXT("Resuming the implementation."), TEXT("IMPLEMENTING") } },
		{ TEXT("review.started"),         { TEXT("Independent review started."), TEXT("INDEPENDENT REVIEWER"), TEXT("ACTIVE"), TEXT("Examining the work against the contract."), TEXT("REVIEW") } },
		{ TEXT("review.challenge"),       { TEXT("Reviewer raised a challenge."), TEXT("INDEPENDENT REVIEWER"), TEXT("CHALLENGE"), TEXT("Challenge: one section does not meet the contract."), TEXT("REVIEW") } },
		{ TEXT("review.warning"),         { TEXT("Reviewer raised a warning."), TEXT("INDEPENDENT REVIEWER"), TEXT("CHALLENGE"), TEXT("Warning raised on the work."), TEXT("REVIEW") } },
		{ TEXT("review.repair_required"), { TEXT("Repair required. The contract is not met yet."), TEXT("INDEPENDENT REVIEWER"), TEXT("REPAIR SENT"), TEXT("Sent the flagged section back for repair."), TEXT("REPAIR") } },
		{ TEXT("repair.started"),         { TEXT("Repair under way."), TEXT("CODING AGENT"), TEXT("REPAIR"), TEXT("Removing and rebuilding the flagged section."), TEXT("REPAIR") } },
		{ TEXT("repair.completed"),       { TEXT("Repair complete. Verifying."), TEXT("CODING AGENT"), TEXT("DONE"), TEXT("Repair handed back for verification."), TEXT("VERIFYING") } },
		{ TEXT("task.verified"),          { TEXT("Task verified against the contract."), TEXT("INDEPENDENT REVIEWER"), TEXT("DONE"), TEXT("Verified: pass."), TEXT("VERIFYING") } },
		{ TEXT("run.verified"),           { TEXT("Run verified. Mission Contract: VIOLET."), TEXT(""), TEXT(""), TEXT(""), TEXT("VERIFIED") } },
		{ TEXT("run.completed"),          { TEXT("Mission complete."), TEXT(""), TEXT(""), TEXT(""), TEXT("COMPLETE") } },
		{ TEXT("review.block"),           { TEXT("Blocked by the reviewer. Progress frozen."), TEXT("INDEPENDENT REVIEWER"), TEXT("BLOCK"), TEXT("Blocked: waiting on a decision."), TEXT("BLOCKED") } },
		{ TEXT("provider.blocked"),       { TEXT("Blocked at a gate. Progress frozen."), TEXT(""), TEXT(""), TEXT(""), TEXT("BLOCKED") } },
		{ TEXT("run.failed"),             { TEXT("Run failed."), TEXT(""), TEXT(""), TEXT(""), TEXT("ERROR") } },
	};

	FWonderlandCompanionNarration Llm(EWonderlandMissionBeat Beat)
	{
		switch (Beat)
		{
		case EWonderlandMissionBeat::MissionStart:              return { TEXT("JOINING"),        TEXT("Received scoped mission context from Julius.") };
		case EWonderlandMissionBeat::Researching:               return { TEXT("RESEARCHING"),    TEXT("Researching references for the mission.") };
		case EWonderlandMissionBeat::PromptArchitectActive:     return { TEXT("REASONING"),      TEXT("Reasoning through the plan with the architect.") };
		case EWonderlandMissionBeat::Guidance:                  return { TEXT("RETURNING"),      TEXT("Returned findings to Julius for the brief.") };
		case EWonderlandMissionBeat::CodingAgentActive:         return { TEXT("SUPPORTING"),     TEXT("Supporting implementation: checking the brief.") };
		case EWonderlandMissionBeat::WaitingCheckpoint:         return { TEXT("WAITING"),        TEXT("Holding at the checkpoint with Julius.") };
		case EWonderlandMissionBeat::ApprovalContinue:          return { TEXT("SUPPORTING"),     TEXT("Approval received. Continuing support.") };
		case EWonderlandMissionBeat::Handoff:                   return { TEXT("HANDOFF"),        TEXT("Following the handoff between roles.") };
		case EWonderlandMissionBeat::IndependentReviewerActive: return { TEXT("CROSS-CHECKING"), TEXT("Cross-checking the work for the reviewer.") };
		case EWonderlandMissionBeat::ReviewChallenge:           return { TEXT("CROSS-CHECKING"), TEXT("Explaining the challenged section to Julius.") };
		case EWonderlandMissionBeat::RepairRequired:            return { TEXT("ASSISTING"),      TEXT("Locating the flagged section for the repair.") };
		case EWonderlandMissionBeat::Repairing:                 return { TEXT("ASSISTING"),      TEXT("Assisting the repair with references.") };
		case EWonderlandMissionBeat::Verifying:                 return { TEXT("HOLDING CLEAR"),  TEXT("Holding clear while Julius verifies.") };
		case EWonderlandMissionBeat::Block:                     return { TEXT("WAITING"),        TEXT("Paused: the mission is blocked.") };
		case EWonderlandMissionBeat::Error:                     return { TEXT("STOPPED"),        TEXT("Stopped: the run failed.") };
		case EWonderlandMissionBeat::CompleteVerified:          return { TEXT("RETURNED"),       TEXT("Contribution recorded on the Mission Contract.") };
		default: break;
		}
		return { TEXT("WAITING"), TEXT("Waiting for Julius.") };
	}

	FWonderlandCompanionNarration Jhinn(EWonderlandMissionBeat Beat)
	{
		switch (Beat)
		{
		case EWonderlandMissionBeat::MissionStart:              return { TEXT("ASSIGNED"),       TEXT("Assigned a scoped task by Julius.") };
		case EWonderlandMissionBeat::Researching:               return { TEXT("PLANNING"),       TEXT("Planning its assigned task.") };
		case EWonderlandMissionBeat::PromptArchitectActive:     return { TEXT("PLANNING"),       TEXT("Planning tool steps for the brief.") };
		case EWonderlandMissionBeat::Guidance:                  return { TEXT("PLANNING"),       TEXT("Took the brief. Ready to execute.") };
		case EWonderlandMissionBeat::CodingAgentActive:         return { TEXT("EXECUTING"),      TEXT("Executing its assigned edit.") };
		case EWonderlandMissionBeat::WaitingCheckpoint:         return { TEXT("WAITING"),        TEXT("Paused at the checkpoint.") };
		case EWonderlandMissionBeat::ApprovalContinue:          return { TEXT("EXECUTING"),      TEXT("Approved. Resuming its edit.") };
		case EWonderlandMissionBeat::Handoff:                   return { TEXT("HANDOFF"),        TEXT("Returned its step to Julius.") };
		case EWonderlandMissionBeat::IndependentReviewerActive: return { TEXT("RETURNED WORK"),  TEXT("Returned its work to Julius for review.") };
		case EWonderlandMissionBeat::ReviewChallenge:           return { TEXT("RETURNED WORK"),  TEXT("Standing by on the reviewer's challenge.") };
		case EWonderlandMissionBeat::RepairRequired:            return { TEXT("ASSIGNED FIX"),   TEXT("Assigned the fix for the flagged section.") };
		case EWonderlandMissionBeat::Repairing:                 return { TEXT("EXECUTING FIX"),  TEXT("Executing the assigned fix.") };
		case EWonderlandMissionBeat::Verifying:                 return { TEXT("HOLDING CLEAR"),  TEXT("Holding clear; its checks are in.") };
		case EWonderlandMissionBeat::Block:                     return { TEXT("WAITING"),        TEXT("Paused: the mission is blocked.") };
		case EWonderlandMissionBeat::Error:                     return { TEXT("STOPPED"),        TEXT("Stopped: the run failed.") };
		case EWonderlandMissionBeat::CompleteVerified:          return { TEXT("RETURNED"),       TEXT("Work returned to Julius. Task closed.") };
		default: break;
		}
		return { TEXT("WAITING"), TEXT("Waiting for an assignment.") };
	}
}

FWonderlandJuliusNarration WonderlandJuliusNarrationForEvent(FName EventType)
{
	for (const WonderlandNarrationDetail::FJuliusRow& Row : WonderlandNarrationDetail::JuliusRows)
	{
		if (EventType == FName(Row.Event))
		{
			return Row.Narration;
		}
	}
	// An event this table does not know still gets a row: silence would read as nothing having happened.
	FWonderlandJuliusNarration Unknown;
	Unknown.Headline = TEXT("Event received.");
	return Unknown;
}

FWonderlandCompanionNarration WonderlandCompanionNarrationForBeat(EWonderlandMissionBeat Beat, EWonderlandCompanionKind Kind)
{
	return Kind == EWonderlandCompanionKind::LlmCompanion ? WonderlandNarrationDetail::Llm(Beat) : WonderlandNarrationDetail::Jhinn(Beat);
}

EWonderlandCompanionFormation WonderlandCompanionFlightForBeat(EWonderlandMissionBeat Beat, bool bJoined, EWonderlandCompanionFormation Current)
{
	// Every companion, joined or not, keeps the verification sight-line clear.
	if (Beat == EWonderlandMissionBeat::Verifying)
	{
		return EWonderlandCompanionFormation::ClearTheSightLine;
	}
	if (!bJoined)
	{
		return EWonderlandCompanionFormation::Follow;
	}
	switch (Beat)
	{
	case EWonderlandMissionBeat::MissionStart:
		return EWonderlandCompanionFormation::Gather;
	case EWonderlandMissionBeat::Researching:
	case EWonderlandMissionBeat::PromptArchitectActive:
	case EWonderlandMissionBeat::Guidance:
		return EWonderlandCompanionFormation::ResearchOrbit;
	case EWonderlandMissionBeat::CodingAgentActive:
	case EWonderlandMissionBeat::ApprovalContinue:
		return EWonderlandCompanionFormation::SupportOrbit;
	case EWonderlandMissionBeat::IndependentReviewerActive:
	case EWonderlandMissionBeat::ReviewChallenge:
		return EWonderlandCompanionFormation::CalmOrbit;
	case EWonderlandMissionBeat::RepairRequired:
	case EWonderlandMissionBeat::Repairing:
		return EWonderlandCompanionFormation::AssistOrbit;
	case EWonderlandMissionBeat::WaitingCheckpoint:
	case EWonderlandMissionBeat::Block:
		// Stopped, not dismissed: the companions stay round the Contract and hold, without contributing.
		return EWonderlandCompanionFormation::Gather;
	case EWonderlandMissionBeat::Handoff:
		// A transition keeps the flight already in the air, unless the companion was still at the Dog's side.
		return Current == EWonderlandCompanionFormation::Follow || Current == EWonderlandCompanionFormation::ClearTheSightLine
			? EWonderlandCompanionFormation::Gather : Current;
	default:
		break;
	}
	// Completion, error, idle: back to the Dog, contributions stopped.
	return EWonderlandCompanionFormation::Follow;
}

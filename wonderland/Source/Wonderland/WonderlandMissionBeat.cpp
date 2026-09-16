#include "WonderlandMissionBeat.h"

namespace
{
	// PREFIXED, NOT SINGLE-LETTERED. The module compiles as one unity translation unit, so an anonymous
	// namespace is shared: a bare `A` here would collide with WonderlandProjectBrain.cpp's `A`.
	using MBeat = EWonderlandMissionBeat;
	using MPhase = EWonderlandJuliusState;
	using MAccent = EWonderlandActivityAccent;
	using MChakra = EWonderlandChakra;

	// ONE TABLE, INDEXED BY ORDINAL. A switch would let two cases quietly return the same reading; an array
	// sized by the enum makes a missing member a compile-time hole and a duplicated one visible on the page.
	//
	// Read a row as a sentence: this beat looks like THIS, means THAT, is really this runtime phase and
	// accent, moves the colour here, and will be driven by these events.
	const FWonderlandBeatReading GBeats[WonderlandMissionBeatCount] = {

	/* ---------------------------------------------------------------- nothing reported */
	{ MBeat::Unobserved, TEXT("UNOBSERVED"), TEXT("Nothing has been reported."),
	  MPhase::Unobserved, MAccent::Unobserved, MChakra::None, false, false, false,
	  TEXT(""),
	  TEXT(""),
	  { 0.0f, 0.0f, 6.0f, 0.15f, 0.10f, 0.0f, 0.85f, 0.25f } },

	/* ---------------------------------------------------------------- at rest */
	{ MBeat::Idle, TEXT("IDLE"), TEXT("No mission is running. The contract is empty."),
	  MPhase::Idle, MAccent::Unobserved, MChakra::None, true, false, false,
	  TEXT(""),
	  TEXT("Nothing reports that a finished run has been acknowledged and the world may rest. `run.completed` "
	       "is the ENDING, which is what COMPLETE shows; going back to idle afterwards is a separate moment."),
	  { 0.05f, 2.0f, 5.0f, 0.25f, 0.15f, 0.0f, 0.90f, 0.50f } },

	/* ---------------------------------------------------------------- the task begins */
	// THE RESET LIVES HERE. Advancing to Root is what "resets per task" means: the orb drops the colour the
	// last task climbed to and starts again at red.
	{ MBeat::MissionStart, TEXT("MISSION START"), TEXT("A Mission Contract was locked. The task begins."),
	  MPhase::Attention, MAccent::Unobserved, MChakra::Root, true, false, false,
	  TEXT("run.started, mission.contract.locked"),
	  TEXT(""),
	  { 0.40f, 5.0f, 2.2f, 1.50f, 0.50f, 0.0f, 1.15f, 1.40f } },

	{ MBeat::Researching, TEXT("RESEARCHING"), TEXT("Context is being gathered before anyone acts."),
	  MPhase::Attention, MAccent::Recalling, MChakra::Sacral, true, false, false,
	  TEXT("research.requested, research.served"),
	  TEXT(""),
	  { 0.25f, 3.0f, 3.4f, 0.80f, 0.30f, 0.0f, 1.00f, 0.90f } },

	// HANDOFF HOLDS ITS COLOUR. Work moving between roles is not progress through the task; it is the same
	// work changing hands, and an orb that stepped forward for it would count the journey twice.
	// A THIRD GAP, found while building the Phase 3B adapter. This row used to claim `architect.started,
	// coder.started, review.started` -- but those events are the moments roles BEGIN, which are three other
	// beats. A handoff is the interval BETWEEN them, and the catalogue has no event for it: Julius reports
	// that a role started, never that work changed hands. Claiming those three here also made the adapter
	// ambiguous, because one event type would have resolved to two different beats.
	// NO DEDICATED PERFORMANCE (founder, 2026-09-15). This beat is an INTERVAL, not a state: the world
	// continues the stage already in performance, so a handoff arriving mid-implementation keeps the
	// paintbrush on screen and changes no prop. The Julius event survives; only the scene is withheld,
	// and MPhase::Handoff stays a member because deleting one to remove a visual would delete an event
	// to remove a picture. The performance layer simply never selects it -- see WonderlandDogActForBeat.
	// The old copy said "No role is executing", which contradicted that and was also untrue: during a
	// handoff the mission is mid-flight and the previous role's work still stands.
	{ MBeat::Handoff, TEXT("HANDOFF"), TEXT("Work product is moving between roles. The world continues the stage already in performance."),
	  MPhase::Handoff, MAccent::Unobserved, MChakra::None, false, false, false,
	  TEXT(""),
	  TEXT("Nothing reports work CHANGING HANDS. `architect.started`, `coder.started` and `review.started` "
	       "report a role BEGINNING, which are three other beats; the interval between them is what this "
	       "shows, and no event marks it."),
	  { 0.60f, 6.0f, 1.2f, 1.00f, 0.25f, 0.0f, 1.00f, 1.00f } },

	/* ---------------------------------------------------------------- the three roles */
	{ MBeat::PromptArchitectActive, TEXT("PROMPT ARCHITECT"), TEXT("The Prompt Architect is planning the work."),
	  MPhase::PromptArchitect, MAccent::Unobserved, MChakra::SolarPlexus, true, false, false,
	  TEXT("architect.started"),
	  TEXT(""),
	  { 0.15f, 3.0f, 4.0f, 0.50f, 0.25f, 0.0f, 1.00f, 1.00f } },

	{ MBeat::CodingAgentActive, TEXT("CODING AGENT"), TEXT("The Coding Agent is implementing."),
	  MPhase::Coding, MAccent::Unobserved, MChakra::Heart, true, false, false,
	  TEXT("coder.started"),
	  TEXT(""),
	  { 0.30f, 2.0f, 3.0f, 2.20f, 0.35f, 0.0f, 1.00f, 1.05f } },

	{ MBeat::IndependentReviewerActive, TEXT("INDEPENDENT REVIEWER"), TEXT("The Independent Reviewer is examining the work."),
	  MPhase::IndependentReview, MAccent::Unobserved, MChakra::Throat, true, false, false,
	  TEXT("review.started"),
	  TEXT(""),
	  { 0.12f, 2.0f, 4.6f, 0.40f, 0.40f, 0.0f, 1.00f, 1.00f } },

	/* ---------------------------------------------------------------- waiting on a person */
	// SLOW AND DIM ON PURPOSE. A checkpoint is the orb breathing rather than working, so a glance across
	// the garden tells you the mission stopped for you and not for a machine.
	{ MBeat::WaitingCheckpoint, TEXT("WAITING / CHECKPOINT"), TEXT("The mission is paused at a checkpoint, waiting for you."),
	  MPhase::IndependentReview, MAccent::AwaitingInput, MChakra::None, false, true, false,
	  TEXT("task.paused"),
	  TEXT(""),
	  { 0.02f, 1.0f, 6.0f, 0.35f, 0.60f, 0.0f, 0.95f, 0.70f } },

	{ MBeat::Guidance, TEXT("GUIDANCE"), TEXT("The Prompt Architect is steering the work in flight."),
	  MPhase::PromptArchitect, MAccent::Recalling, MChakra::None, false, false, false,
	  TEXT("architect.guidance"),
	  TEXT(""),
	  { 0.20f, 3.0f, 3.0f, 1.00f, 0.30f, 0.0f, 1.05f, 1.10f } },

	/* ---------------------------------------------------------------- the review turns */
	{ MBeat::ReviewChallenge, TEXT("REVIEW CHALLENGE"), TEXT("The reviewer is challenging the work, not accepting it."),
	  MPhase::IndependentReview, MAccent::Strained, MChakra::None, false, false, false,
	  TEXT("review.warning, review.challenge"),
	  TEXT(""),
	  { 0.50f, 3.0f, 1.6f, 2.80f, 0.50f, 1.5f, 1.05f, 1.15f } },

	// THE ONE BEAT THAT WALKS THE COLOUR BACK. Repair returns the work to the role that already had it, and
	// an orb that kept climbing through a repair would be telling a more flattering story than the run's.
	{ MBeat::RepairRequired, TEXT("REPAIR REQUIRED"), TEXT("The review sent the work back. The contract is not met."),
	  MPhase::IndependentReview, MAccent::Strained, MChakra::Heart, true, false, false,
	  TEXT("review.repair_required"),
	  TEXT(""),
	  { -0.30f, 4.0f, 1.4f, 3.00f, 0.60f, 2.0f, 1.10f, 1.20f } },

	{ MBeat::Repairing, TEXT("REPAIRING"), TEXT("The same work, attempted again."),
	  MPhase::Repair, MAccent::Reattempting, MChakra::Heart, true, false, false,
	  TEXT("repair.started"),
	  TEXT(""),
	  { 0.35f, 2.0f, 2.4f, 1.80f, 0.35f, 0.8f, 1.00f, 1.05f } },

	{ MBeat::Verifying, TEXT("VERIFYING"), TEXT("The repair is being checked against the contract."),
	  MPhase::Verifying, MAccent::Unobserved, MChakra::Brow, true, false, false,
	  TEXT("repair.completed, task.verified"),
	  TEXT(""),
	  { 0.18f, 2.0f, 4.0f, 0.60f, 0.25f, 0.0f, 1.00f, 1.10f } },

	{ MBeat::ApprovalContinue, TEXT("APPROVAL / CONTINUE"), TEXT("The gate cleared. Work resumes where it paused."),
	  MPhase::Verifying, MAccent::Unobserved, MChakra::None, false, false, false,
	  TEXT(""),
	  TEXT("`task.paused` opens a human gate and nothing in the catalogue reports it being CLEARED. Binding "
	       "this to `run.verified` was tried and removed: that is the run being verified, a different moment, "
	       "and it would make the orb say a person approved when the run merely passed."),
	  { 0.45f, 6.0f, 1.8f, 1.20f, 0.30f, 0.0f, 1.10f, 1.30f } },

	/* ---------------------------------------------------------------- the three endings */
	// STOPPED WITHOUT A FAULT: still, dim, and holding whatever step it got to. A block that flashed would
	// read as a failure, and a block that kept spinning would read as progress.
	{ MBeat::Block, TEXT("BLOCK"), TEXT("Stopped without a fault: a ceiling, a gate, or a refusal."),
	  MPhase::Blocked, MAccent::Unobserved, MChakra::None, false, true, true,
	  TEXT("review.block, provider.blocked"),
	  TEXT(""),
	  { 0.00f, 0.0f, 6.0f, 0.20f, 0.15f, 0.0f, 0.90f, 0.35f } },

	{ MBeat::Error, TEXT("ERROR"), TEXT("Stopped by a fault."),
	  MPhase::Error, MAccent::Unobserved, MChakra::None, false, true, true,
	  TEXT("run.failed"),
	  TEXT(""),
	  { 0.00f, 0.0f, 6.0f, 4.00f, 0.80f, 2.5f, 1.05f, 1.20f } },

	// A FINISH THAT SNAPS READS AS A FAILURE (WonderlandJuliusState.h says the same of the Settle
	// transition). The crown settles slowly and stays bright.
	{ MBeat::CompleteVerified, TEXT("COMPLETE / VERIFIED"), TEXT("The contract was met and the result was verified."),
	  MPhase::Complete, MAccent::Unobserved, MChakra::Crown, true, false, true,
	  TEXT("run.verified, run.completed"),
	  TEXT(""),
	  { 0.08f, 3.0f, 5.2f, 0.30f, 0.20f, 0.0f, 1.20f, 1.60f } },
	};

	// The id a console command and a proof job use. Parallel to GBeats by ordinal.
	const TCHAR* const GBeatIds[WonderlandMissionBeatCount] = {
		TEXT("unobserved"),
		TEXT("idle"),
		TEXT("mission_start"),
		TEXT("researching"),
		TEXT("handoff"),
		TEXT("prompt_architect"),
		TEXT("coding_agent"),
		TEXT("independent_reviewer"),
		TEXT("waiting_checkpoint"),
		TEXT("guidance"),
		TEXT("review_challenge"),
		TEXT("repair_required"),
		TEXT("repairing"),
		TEXT("verifying"),
		TEXT("approval_continue"),
		TEXT("block"),
		TEXT("error"),
		TEXT("complete_verified"),
	};
}

const FWonderlandBeatReading& WonderlandBeatReading(EWonderlandMissionBeat Beat)
{
	const int32 Index = static_cast<int32>(Beat);
	// TOTAL. A member this build does not know draws as unobserved rather than reading off the end.
	return GBeats[(Index >= 0 && Index < WonderlandMissionBeatCount) ? Index : 0];
}

EWonderlandMissionBeat WonderlandBeatFromId(FName Id)
{
	const FString Wanted = Id.ToString().ToLower();
	for (int32 Index = 0; Index < WonderlandMissionBeatCount; ++Index)
	{
		if (Wanted.Equals(GBeatIds[Index], ESearchCase::IgnoreCase))
		{
			return static_cast<EWonderlandMissionBeat>(Index);
		}
	}
	return EWonderlandMissionBeat::Unobserved;
}

FName WonderlandBeatId(EWonderlandMissionBeat Beat)
{
	const int32 Index = static_cast<int32>(Beat);
	return FName(GBeatIds[(Index >= 0 && Index < WonderlandMissionBeatCount) ? Index : 0]);
}

EWonderlandChakra WonderlandChakraForBeat(EWonderlandMissionBeat Beat, EWonderlandChakra Previous)
{
	const FWonderlandBeatReading& Reading = WonderlandBeatReading(Beat);
	return Reading.bAdvances ? Reading.Chakra : Previous;
}

int32 WonderlandChakraStep(EWonderlandChakra Chakra)
{
	return FMath::Clamp(static_cast<int32>(Chakra), 0, WonderlandChakraSteps);
}

EWonderlandChakra WonderlandChakraForStep(int32 Step)
{
	return static_cast<EWonderlandChakra>(FMath::Clamp(Step, 0, WonderlandChakraSteps));
}

FLinearColor WonderlandChakraColour(EWonderlandChakra Chakra)
{
	switch (Chakra)
	{
	case EWonderlandChakra::Root:       return FLinearColor(0.780f, 0.108f, 0.075f);
	case EWonderlandChakra::Sacral:     return FLinearColor(0.900f, 0.300f, 0.040f);
	case EWonderlandChakra::SolarPlexus:return FLinearColor(0.940f, 0.720f, 0.070f);
	case EWonderlandChakra::Heart:      return FLinearColor(0.150f, 0.780f, 0.330f);
	case EWonderlandChakra::Throat:     return FLinearColor(0.090f, 0.450f, 0.900f);
	// PULLED VIOLET-WARD off the textbook indigo. At its literal value this sits so close to Throat that the
	// fifth and sixth pips read as one pip from across a garden, which defeats a seven-step progression.
	case EWonderlandChakra::Brow:       return FLinearColor(0.260f, 0.160f, 0.760f);
	case EWonderlandChakra::Crown:      return FLinearColor(0.600f, 0.180f, 0.880f);
	default: break;
	}
	// None: the orb before a task, and the unreached pips. Cold ivory, never a chakra it has not earned.
	return FLinearColor(0.520f, 0.540f, 0.620f);
}

bool WonderlandBeatAwaitsAnEvent(EWonderlandMissionBeat Beat)
{
	const FWonderlandBeatReading& Reading = WonderlandBeatReading(Beat);
	// Unobserved is the ABSENCE of a report, so it waits on nothing; it is not a gap in the catalogue.
	return Beat != EWonderlandMissionBeat::Unobserved && FCString::Strlen(Reading.Events) == 0;
}

bool WonderlandBeatShowsContract(EWonderlandMissionBeat Beat)
{
	return Beat != EWonderlandMissionBeat::Unobserved && Beat != EWonderlandMissionBeat::Idle;
}

const TCHAR* WonderlandChakraName(EWonderlandChakra Chakra)
{
	switch (Chakra)
	{
	case EWonderlandChakra::Root:        return TEXT("ROOT");
	case EWonderlandChakra::Sacral:      return TEXT("SACRAL");
	case EWonderlandChakra::SolarPlexus: return TEXT("SOLAR PLEXUS");
	case EWonderlandChakra::Heart:       return TEXT("HEART");
	case EWonderlandChakra::Throat:      return TEXT("THROAT");
	case EWonderlandChakra::Brow:        return TEXT("BROW");
	case EWonderlandChakra::Crown:       return TEXT("CROWN");
	default: break;
	}
	return TEXT("NONE");
}

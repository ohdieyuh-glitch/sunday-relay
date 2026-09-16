// WONDERLAND — what the terminals say while a simulated mission runs, and what a joined companion is doing.
//
// ONE STORY, TOLD ONCE. The Julius Live Terminal, the LLM Companion's terminal and the Jhinn's terminal all narrate
// from this table, and the companions' flight is chosen from it too, in the SAME call, from the SAME beat the Relay
// Dog and the Mission Contract read. A terminal that says "researching" while its companion is holding clear of a
// verification beam is therefore not a bug that can happen here: there is no second clock to drift from.
//
// THE JULIUS TERMINAL NARRATES EVENTS; THE COMPANIONS NARRATE BEATS. Julius's own rows are keyed by the event type
// the fixture emitted -- run.started, review.challenge, repair.completed -- because those are Julius's real event
// names and a terminal quoting them is showing what the fold received. A companion changes what it is doing when
// the STAGE changes, so its lines follow beats.
//
// SIMULATED, AND SAID SO. None of this is a provider's output. Every row is a deterministic sentence from this file,
// the Julius terminal carries DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION while it shows them, and /join in is
// SIMULATED /JOIN IN on the companions' terminals: nothing is imported, nothing is called.
//
// ROLES STAY WHAT THEY ARE. The LLM Companion researches, reasons and returns information; the Jhinn is a SINGLE AI
// AGENT that takes an assigned task and returns work. Neither becomes a Compound Agent, and Julius and the Relay Dog
// keep mission authority: every companion line is framed as work handed back to Julius.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandCompanionFormation.h"
#include "WonderlandMissionBeat.h"

/** Which companion a line or a flight belongs to. Index 0 in the companion subsystem is the LLM Companion. */
enum class EWonderlandCompanionKind : uint8
{
	LlmCompanion,
	JhinnAgent
};

/** One event's effect on the Julius Live Terminal. */
struct FWonderlandJuliusNarration
{
	/** The JULIUS 3.3 row: what Julius says happened. */
	const TCHAR* Headline = TEXT("");
	/** A role section this event moves, or empty: PROMPT ARCHITECT, CODING AGENT, INDEPENDENT REVIEWER. */
	const TCHAR* Section = TEXT("");
	/** That section's new state: ACTIVE, PAUSED, REPAIR, DONE. */
	const TCHAR* SectionState = TEXT("");
	/** That section's new line. */
	const TCHAR* SectionLine = TEXT("");
	/** The JULIUS 3.3 section's own state after this event: RUNNING, CHECKPOINT, VERIFYING, COMPLETE. */
	const TCHAR* JuliusState = TEXT("RUNNING");
};

/** What a joined companion is doing in one beat, as its terminal says it. */
struct FWonderlandCompanionNarration
{
	/** Upper-case, short: RESEARCHING, EXECUTING, HOLDING CLEAR. Drawn as the speaker mark. */
	const TCHAR* Activity = TEXT("");
	const TCHAR* Line = TEXT("");
};

/** The Julius terminal's narration for one fixture event, by its type. Unknown types still get an honest row. */
WONDERLAND_API FWonderlandJuliusNarration WonderlandJuliusNarrationForEvent(FName EventType);

/** A joined companion's activity and line for a beat. */
WONDERLAND_API FWonderlandCompanionNarration WonderlandCompanionNarrationForBeat(EWonderlandMissionBeat Beat, EWonderlandCompanionKind Kind);

/**
 * WHERE A COMPANION FLIES, given whether it has joined. The one mapping, beat to flight, for every companion.
 *
 *   JOINED      preparation gathers round the Contract; research, planning and guidance circle it with pulses;
 *               implementation supports it; review is a calmer circle; repair assists; verification clears the
 *               Dog's beam; completion returns to follow. Transitions keep whatever the companion was doing, so a
 *               handoff does not snap it back to the Dog and out again.
 *   NOT JOINED  follows the Dog, except that EVERY companion clears the verification sight-line -- a companion that
 *               has not joined can still stand in front of the beam, and that was the fault the founder saw.
 */
WONDERLAND_API EWonderlandCompanionFormation WonderlandCompanionFlightForBeat(EWonderlandMissionBeat Beat, bool bJoined,
	EWonderlandCompanionFormation Current);

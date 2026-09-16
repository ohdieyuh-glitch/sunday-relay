// WONDERLAND — A JULIUS-SHAPED EVENT, AND WHAT A WORLD MAY DO WITH IT.
//
// THE FOUNDER'S PHASE 3B RULE: EVENT TRUTH IS SEPARATE FROM WORLD PRESENTATION. Phase 3 let a console
// command pick a beat, which made Wonderland the thing deciding what a mission was doing. This file is the
// seam that ends that. Something outside produces events; the fold below interprets them; the world draws
// the result and has no say in it.
//
//   fixture or Julius  ->  FWonderlandMissionEvent  ->  FWonderlandMissionFold  ->  beat  ->  the crystal
//
// NO PROVIDER NAMES, ANYWHERE. There is no field here that could hold "OpenAI", "Anthropic" or "xAI", and
// the mapping never consults one. A run is a run whichever model served it: roles are permanent,
// providers are implementations. That is not a style preference -- it is what lets this mapping survive
// Julius changing providers without Wonderland noticing.
//
// THE ADAPTER IS BUILT FROM THE BEAT TABLE, not written twice. WonderlandMissionBeat.cpp already declares
// which Julius events resolve to each beat; the map here is derived from those declarations, and a startup
// check fails if one event type ever claims two beats. A second hand-written table is how a visual and its
// binding drift apart.
//
// A FOLD, NOT A SNAPSHOT. FWonderlandMissionFold is the accumulated reading of an ordered stream: which
// beat, which chakra, how many repair rounds, whether it ended -- and the counters for everything it
// REFUSED, because a client that rejected nine events is in a different situation from one with a clean
// stream and must not look the same.
//
// PLAIN STRUCTS ON PURPOSE. No USTRUCT: the parity test reads that macro and would require a TypeScript
// mirror for a shape that is this world's reading of the wire rather than the wire itself.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionBeat.h"

/**
 * WHICH ROLE an event is about. Roles are permanent; providers are implementations, and none appears here.
 * `None` covers the events that are about the run rather than about any one role.
 */
enum class EWonderlandMissionRole : uint8
{
	None,
	PromptArchitect,
	CodingAgent,
	IndependentReviewer
};

WONDERLAND_API const TCHAR* WonderlandRoleName(EWonderlandMissionRole Role);

/**
 * THE SMALLEST USEFUL ENVELOPE. Every field earns its place by changing what a world may honestly draw;
 * anything Julius knows that Wonderland cannot act on is deliberately absent.
 */
struct FWonderlandMissionEvent
{
	/** The Julius event name, e.g. "review.repair_required". The only thing the mapping switches on. */
	FName Type;

	/** Which run produced it. Opaque: the world groups by it and never parses it. */
	FName RunId;

	/** WHICH MISSION CONTRACT it belongs to. An event for another mission may not touch this one's fold. */
	FName MissionId;

	/** Which unit of work inside the mission. Opaque. */
	FName TaskId;

	EWonderlandMissionRole Role = EWonderlandMissionRole::None;

	/** Order within the mission, from 1. A fold applies events in sequence and rejects anything stale. */
	int64 Sequence = 0;

	/** The runtime's own word for what happened, when one travelled. Never switched on; carried for report. */
	FName Status;

	/** A review's finding, where one applies: "pass", "warning", "repair_required", "block". */
	FName Verdict;

	/** Which attempt this is. 0 before any repair; 1 on the first repair round. */
	int32 RepairRound = 0;

	/**
	 * TRUE ONLY FOR A BEAT JULIUS CANNOT CURRENTLY EMIT.
	 *
	 * Three of the founder's seventeen have no event behind them -- handoff, approval, and the return to
	 * idle. A fixture may still show them, because a person plainly sees those moments, but it must SAY SO,
	 * and a fold refuses one of these unless the flag is set. That is what keeps the simulated path from
	 * quietly becoming a claim about what Julius reports.
	 */
	bool bSimulationOnly = false;
};

/**
 * THE ACCUMULATED READING of an ordered stream, for ONE mission.
 *
 * The counters are part of the truth. Hiding a refused event behind a boolean would make a stream that
 * contradicted itself indistinguishable from a clean one.
 */
struct FWonderlandMissionFold
{
	FName MissionId;
	EWonderlandMissionBeat Beat = EWonderlandMissionBeat::Unobserved;
	EWonderlandChakra Chakra = EWonderlandChakra::None;
	int64 Sequence = 0;
	int32 RepairRounds = 0;
	/** Set by an event that reports a real ending, and by nothing else. */
	bool bEnded = false;

	int32 Applied = 0;
	/** Events whose type this build does not model. Not an error: most of the catalogue is other concerns. */
	int32 Unmodelled = 0;
	/** Events naming another mission. Refused without touching anything. */
	int32 Foreign = 0;
	/** Events that arrived out of order. */
	int32 Stale = 0;
	/** Events refused because the mission had already ended. Progress after an ending is a contradiction. */
	int32 RefusedAfterEnding = 0;
	/** Gap-only beats refused because the event was not labelled as simulation. */
	int32 RefusedUnlabelledGap = 0;
	/** Beats shown that Julius cannot emit. A run with any of these is not a pure real-event reading. */
	int32 SimulatedBeats = 0;
};

/** Why an event did or did not move the fold. Reported so a run can be explained rather than just counted. */
enum class EWonderlandEventVerdict : uint8
{
	Applied,
	Unmodelled,
	ForeignMission,
	Stale,
	RefusedAfterEnding,
	RefusedUnlabelledGap
};

WONDERLAND_API const TCHAR* WonderlandEventVerdictName(EWonderlandEventVerdict Verdict);

/* ------------------------------------------------------------------ the adapter */

/**
 * The beat an event type resolves to, from the declarations in WonderlandMissionBeat.cpp.
 * `Unobserved` when nothing claims that type.
 */
WONDERLAND_API EWonderlandMissionBeat WonderlandBeatForEventType(FName Type);

/** Every event type any beat claims, for a test that wants to walk the whole catalogue. */
WONDERLAND_API void WonderlandKnownEventTypes(TArray<FName>& Out);

/**
 * APPLY ONE EVENT TO ONE FOLD, and say what happened.
 *
 * The rules, in the order they are checked:
 *   - an event for a different mission is FOREIGN and changes nothing;
 *   - an event at or below the sequence already applied is STALE;
 *   - an event whose type resolves to no beat is UNMODELLED;
 *   - a beat Julius cannot emit is refused unless the event says bSimulationOnly;
 *   - AFTER AN ENDING, only a new mission's start is accepted. A block that kept accepting `coder.started`
 *     would let a stopped mission carry on showing progress, which is the one thing a blocked world must
 *     never do.
 */
WONDERLAND_API EWonderlandEventVerdict WonderlandApplyEvent(FWonderlandMissionFold& Fold, const FWonderlandMissionEvent& Event);

/**
 * Apply a LABELLED SIMULATED event -- one standing in for a beat Julius cannot emit.
 *
 * It keeps every rule WonderlandApplyEvent keeps (one mission, in order, nothing after an ending) and
 * differs in exactly one way: the beat is NAMED by the caller in Event.Status rather than looked up from a
 * type, because the adapter's type map holds real Julius types and must stay that way.
 *
 * It refuses an event that is not flagged bSimulationOnly, so this cannot become a second way in.
 */
WONDERLAND_API EWonderlandEventVerdict WonderlandApplySimulatedEvent(FWonderlandMissionFold& Fold, const FWonderlandMissionEvent& Event);

/** One line describing a fold, for a log or a report. */
WONDERLAND_API FString WonderlandDescribeFold(const FWonderlandMissionFold& Fold);

// WONDERLAND — WHAT JULIUS IS DOING WITH HIS BODY. The Relay Dog's mission performance.
//
// THE FOUNDER'S CANON, 2026-09-16 (evening), WHICH SUPERSEDES EVERY EARLIER TABLE:
//
//   PREPARATION     The Dog MEDITATES and FLOATS above the ground; energy gathers; the Mission Contract appears.
//   RESEARCH        The Dog circles the Mission Contract READING a book held in its hands: one hand supports it, the
//                   other turns the pages, and the Dog reads.
//   IMPLEMENTATION  The Dog circles the Contract PAINTING it: the brush arm works, the free arm rests down naturally.
//   VERIFICATION    The Dog FLIES UP, stays airborne, aims the verification beam at the Contract and HOLDS it for the
//                   whole stage; the beam ends when verification ends and the Dog comes down.
//   REVIEW          A dedicated inspection with a MAGNIFYING GLASS. Never the brush.
//   REPAIR          IDENTIFY the incorrect section, ERASE it, REPAINT it -- visibly unlike implementation.
//   COMPLETION      The performance ends; props and effects settle; the Dog returns to normal.
//
//   HANDOFF         DOES NOT EXIST FOR THE PLAYER. There is no handoff animation, pose, camera beat or label; the world
//                   withholds the beat (UWonderlandMissionSubsystem) and an act of `None` inherits whatever is performing.
//
// WHY THIS IS A SEPARATE VOCABULARY FROM EWonderlandDogAnimation.
//
// That enum -- PatrolWalk, WorkScratch, CarryWalk and the rest -- is MIRRORED TO TYPESCRIPT and shared with the website
// and the CLI, and wonderland-cpp-parity fails if the two drift. `CarryWalk` is the handoff clip, and deleting it to
// satisfy "no handoff animation" would break the web Dog and the parity test for a change that is purely about what
// Wonderland draws. World presentation and Julius internal events are separate layers.
//
// `None` IS ONLY FOR TRANSITIONS. A handoff, a checkpoint and a non-terminal approval inherit, because nothing about the
// work has changed; a WORK STAGE may not, because something has.
//
// NO PROVIDER DECIDES ANY OF THIS. The act comes from the mission beat, which comes from the fold, which comes from
// role-shaped events.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionBeat.h"
#include "WonderlandMissionTasks.h"

/** The performances, plus the absence of one. `None` MEANS INHERIT while a Mission Contract exists. */
enum class EWonderlandDogAct : uint8
{
	/** Keep whatever the Dog is already doing. Transitions only. */
	None,
	/** PREPARATION. Meditating, floating, gathering the energy the Contract appears from. */
	FloatingActivation,
	/** RESEARCH. Reading the book in its hands while circling the Contract. */
	ReadingTheBook,
	/** IMPLEMENTATION. Painting the Contract while circling it. */
	PaintingTheWork,
	/** VERIFICATION. Airborne, holding the beam on the Contract. */
	VerificationBeam,
	/** REVIEW. A lens, and a deliberate examination. Checking the work, never building it. */
	InspectingTheWork,
	/** REPAIR. Identify the fault, erase it, repaint it. */
	CorrectingTheWork
};

/** What the Dog is holding. Props fade in and out rather than appearing, so a stage change is a movement. */
enum class EWonderlandDogProp : uint8
{
	None,
	Book,
	Paintbrush,
	/** REVIEW's lens, and the repair's IDENTIFY. The one prop whose whole job is to say "looking", not "making". */
	MagnifyingGlass,
	/** The repair's ERASE: a flat blade that scrapes the incorrect section away. */
	Scraper
};

/**
 * ONE PERFORMANCE, AS INTENT. The numbers -- lifts, angles, rates -- live in RelayDogMissionPose.h's tuning and in the
 * character's hand solvers; this row says what the act IS, so the table reads as the founder's list.
 */
struct FWonderlandDogActReading
{
	EWonderlandDogAct Act = EWonderlandDogAct::None;
	/** The founder's stage name, as the strip shows it: PREPARATION, RESEARCH, ... */
	const TCHAR* Label = TEXT("NONE");
	const TCHAR* Meaning = TEXT("Whatever the Dog was already doing.");
	EWonderlandDogProp Prop = EWonderlandDogProp::None;

	/** Legs crossed, hands on the knees, eyes closed, floating; energy gathers toward the Contract. */
	bool bMeditates = false;
	/** The book in both hands: one under it, one turning its pages; the head bowed to it. */
	bool bReadsTheBook = false;
	/** Brush strokes with the working hand at the Contract; the other arm hangs. */
	bool bPaints = false;
	/** Airborne; both hands aimed at the Contract. */
	bool bFlies = false;
	/** The lens held up to the eye, swept slowly across the work. */
	bool bInspects = false;
	/** Identify, erase, repaint. */
	bool bCorrects = false;

	/** Walk a slow circle about the Contract, facing the way it walks. */
	bool bOrbitsTheContract = false;
	/** Fraction of the study pace. An inspection lingers. */
	float OrbitPace = 1.0f;
	/** Which side the Contract is kept on while circling: +1 the Dog's left, -1 its right, 0 the working hand's side. */
	int32 OrbitSide = 0;
	/** Turn the body to the Contract. Only stationary acts done at the work. */
	bool bFacesTheContract = false;
	/** A sustained beam from the Dog's hands to the Contract, for as long as verification lasts. */
	bool bBeamsTheContract = false;
};

/* ------------------------------------------------------------------ resolvers */

WONDERLAND_API const FWonderlandDogActReading& WonderlandDogActReading(EWonderlandDogAct Act);

/**
 * THE ONE MAPPING, from mission beat to what the body does. Every WORK STAGE resolves to its own performance; only
 * TRANSITIONS (handoff, checkpoint, a non-terminal approval) and ENDINGS resolve to `None`, told apart by the contract.
 */
WONDERLAND_API EWonderlandDogAct WonderlandDogActForBeat(EWonderlandMissionBeat Beat);

/**
 * WHAT THE DOG IS DOING FOR A MISSION CONTRACT IN THIS STATE.
 *
 * THE GAP THIS CLOSES. The contract's lifecycle and the Dog's performance were two parallel systems with
 * nothing between them: a contract walked PREPARATION -> RESEARCH -> IMPLEMENTATION -> VERIFICATION ->
 * REVIEW -> REPAIR -> COMPLETED exactly as it should, and TellTheDog only ever read the mission BEAT, so the
 * Dog performed NONE at every stage and the whole lifecycle passed with the mascot standing still. Measured
 * in PIE: seven stages, dog_act NONE seven times, lift 0.0 throughout -- while the same body lifts 77.97 uu
 * the moment the act is set directly. It was never a skin fault; Relay OG did nothing either.
 *
 * The stages are the founder's own lifecycle, so the mapping is one-to-one and needs no interpretation.
 */
WONDERLAND_API EWonderlandDogAct WonderlandDogActForTaskState(EWonderlandTaskState State);


WONDERLAND_API const TCHAR* WonderlandDogActName(EWonderlandDogAct Act);
WONDERLAND_API const TCHAR* WonderlandDogPropName(EWonderlandDogProp Prop);

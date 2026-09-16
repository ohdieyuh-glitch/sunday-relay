// WONDERLAND — WHAT JULIUS IS DOING WITH HIS BODY. The Relay Dog's mission performance.
//
// THE FOUNDER'S CANON, 2026-09-16, WHICH SUPERSEDES THE GENERIC POSES FOR THE WORK STAGES:
//
//   MISSION START   The Dog FLOATS. Body off the ground and upright, head raised, both forearms reaching
//                   out and about 35 degrees DOWN -- not hanging, not a T-pose. Chest open, calm, centred,
//                   breathing. Julius activating and entering the Mission Contract. No book, no brush, and
//                   emphatically not meditating on the floor.
//
//   PLANNING        The Dog READS A BOOK, and WALKS AROUND the Mission Contract while reading. Reading,
//                   never writing. The contract is the centre of the activity, not scenery beside it.
//
//   IMPLEMENTING    The Dog PAINTS. Deliberate repeated strokes through the air, working rather than
//                   holding a brush. The Compound Agent painting the creation into existence.
//
//   VERIFYING       The Dog holds a stance and a SUSTAINED BEAM connects it to the Mission Contract, for
//                   as long as verification lasts. Not a shot, not a burst, not a flicker. Analytical
//                   rather than destructive -- this is checking, not combat.
//
//   REVIEW          A LENS, and a deliberate examination around the work. Checking it, never building
//                   it. CHALLENGE stays inside this family rather than dropping back to the brush.
//
//   REPAIR          FIND THE FAULT, TAKE IT OUT, PUT IT BACK. The brush returns, which is the whole
//                   difficulty: a repair that merely painted would be implementation wearing another
//                   label. What separates them is the cycle -- a repair keeps stopping to undo.
//
//   HANDOFF         NOTHING OF ITS OWN. There is deliberately no handoff animation, and a handoff
//                   INHERITS whatever is performing.
//
// WHY THIS IS A SEPARATE VOCABULARY FROM EWonderlandDogAnimation.
//
// That enum -- PatrolWalk, WorkScratch, CarryWalk and the rest -- is MIRRORED TO TYPESCRIPT and shared
// with the website and the CLI, and wonderland-cpp-parity fails if the two drift. `CarryWalk` is the
// handoff clip, and deleting it to satisfy "no handoff animation" would break the web Dog and the parity
// test for a change that is purely about what Wonderland draws. The founder's own words settle it: world
// presentation and Julius internal events are separate layers.
//
// So the clip vocabulary is left exactly as it is, and this sits ON TOP of it.
//
// AND `None` IS NOW ONLY FOR TRANSITIONS. It first covered every unspecified state, which was right
// while they were unspecified and became wrong the moment they were not: because None inherits, REVIEW
// inherited IMPLEMENTATION, and the Compound Agent went on painting while its own work was being
// reviewed. The founder cut the line where it belongs -- a handoff, a checkpoint and a non-terminal
// approval are TRANSITIONS and may inherit, because nothing about the work has changed; a WORK STAGE
// may not, because something has.
//
// NO PROVIDER DECIDES ANY OF THIS. The act comes from the mission beat, which comes from the fold, which
// comes from role-shaped events. Whether the work was served by one provider or another changes nothing.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionBeat.h"

/**
 * The locked performances, plus the absence of one.
 *
 * `None` MEANS INHERIT, NOT STOP, and the founder's 2026-09-16 decision draws the line: TRANSITIONS may
 * inherit the act that is running -- a handoff, a checkpoint, an approval that does not end the mission --
 * because nothing about the work itself has changed. WORK STAGES may not. Review inheriting implementation
 * left the Compound Agent painting while its own work was being reviewed, which is a sentence about the
 * mission that was not true.
 */
enum class EWonderlandDogAct : uint8
{
	/** Keep whatever the Dog is already doing. Transitions only. */
	None,
	FloatingActivation,
	ReadingTheBook,
	PaintingTheWork,
	VerificationBeam,
	/** REVIEW. A lens, and a deliberate examination. Checking the work, never building it. */
	InspectingTheWork,
	/** REPAIR. Find the fault, take it out, put it back. Fixing something that failed. */
	CorrectingTheWork
};

/** What the Dog is holding. Props fade in and out rather than appearing, so a stage change is a movement. */
enum class EWonderlandDogProp : uint8
{
	None,
	Book,
	Paintbrush,
	/** REVIEW's lens. The one prop whose whole job is to say "looking", not "making". */
	MagnifyingGlass
};

/**
 * ONE PERFORMANCE, FULLY STATED. Numbers rather than clip names, because there is no rig for these: the
 * Dog is posed joint by joint every frame, so "arms 35 degrees down" has to be a figure.
 */
struct FWonderlandDogActReading
{
	EWonderlandDogAct Act = EWonderlandDogAct::None;
	const TCHAR* Label = TEXT("NONE");
	const TCHAR* Meaning = TEXT("Whatever the Dog was already doing.");
	EWonderlandDogProp Prop = EWonderlandDogProp::None;

	/** How far the body leaves the ground, uu. Zero keeps the Dog walking normally. */
	float FloatLiftUU = 0.0f;
	/** Vertical travel either side of the lift, and its period. The float breathes; it is never frozen. */
	float HoverUU = 0.0f;
	float HoverPeriod = 4.0f;

	/** Head pitch, degrees. Negative looks UP. */
	float HeadPitchDeg = 0.0f;
	/** Shoulder pitch, degrees, measured DOWN from horizontal. 35 is the founder's reach. */
	float ArmDownDeg = 0.0f;
	/** How far the arms open outward, degrees. */
	float ArmOutDeg = 0.0f;
	/** Amplitude of the working motion in the arms, degrees. A brush stroke; a page turn. */
	float WorkSwingDeg = 0.0f;
	float WorkSwingHz = 0.0f;

	/** True while the Dog should walk a slow circle around the Mission Contract. */
	bool bOrbitsTheContract = false;
	/** True while a sustained beam runs from the Dog's chest to the contract. */
	bool bBeamsTheContract = false;

	/**
	 * READING IS A TWO-HANDED ACT. One hand holds the book and the other turns the pages, because a book
	 * that sits in a fist is a prop glued to a hand and reads as carrying rather than studying. The page
	 * turn has to be visible from the play camera, which is a good deal further away than an animator's.
	 */
	bool bTurnsPages = false;

	/**
	 * THE CORRECTIVE CYCLE, for REPAIR: find the fault, take it out, put it back. The brush returns here,
	 * which is the whole difficulty -- repair must not read as implementation carrying on. The phase length
	 * is what separates them: a repair keeps stopping to undo, an implementation does not.
	 */
	bool bCorrects = false;
	/** Seconds for one find-erase-repaint cycle. */
	float CorrectCycleSeconds = 0.0f;
};

/* ------------------------------------------------------------------ resolvers */

WONDERLAND_API const FWonderlandDogActReading& WonderlandDogActReading(EWonderlandDogAct Act);

/**
 * THE ONE MAPPING, from mission beat to what the body does.
 *
 * Every WORK STAGE resolves to its own performance. Only TRANSITIONS resolve to `None` and inherit --
 * handoff, checkpoint, and an approval that does not end the mission. An ending resolves to `None` too,
 * and is told apart from a transition by the contract pointer going null rather than by this table.
 */
WONDERLAND_API EWonderlandDogAct WonderlandDogActForBeat(EWonderlandMissionBeat Beat);

WONDERLAND_API const TCHAR* WonderlandDogActName(EWonderlandDogAct Act);
WONDERLAND_API const TCHAR* WonderlandDogPropName(EWonderlandDogProp Prop);

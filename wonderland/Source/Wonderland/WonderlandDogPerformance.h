// WONDERLAND — WHAT JULIUS IS DOING WITH HIS BODY. The Relay Dog's mission performance.
//
// THE FOUNDER'S CANON, 2026-09-16, WHICH SUPERSEDES THE GENERIC POSES FOR FOUR STAGES:
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
//   HANDOFF         NOTHING. There is deliberately no Relay Dog handoff animation in this design.
//
// WHY THIS IS A SEPARATE VOCABULARY FROM EWonderlandDogAnimation.
//
// That enum -- PatrolWalk, WorkScratch, CarryWalk and the rest -- is MIRRORED TO TYPESCRIPT and shared
// with the website and the CLI, and wonderland-cpp-parity fails if the two drift. `CarryWalk` is the
// handoff clip, and deleting it to satisfy "no handoff animation" would break the web Dog and the parity
// test for a change that is purely about what Wonderland draws. The founder's own words settle it: world
// presentation and Julius internal events are separate layers.
//
// So the clip vocabulary is left exactly as it is, and this sits ON TOP of it. An act of `None` means
// "whatever the Dog was already going to do", which is how every unspecified state -- research, repair,
// review, blocked, waiting, error, completion -- keeps its existing behaviour untouched. Handoff maps to
// `None`, and that is the whole of removing the handoff animation: nothing is deleted, nothing is broken,
// and no dedicated pose plays.
//
// NO PROVIDER DECIDES ANY OF THIS. The act comes from the mission beat, which comes from the fold, which
// comes from role-shaped events. Whether the work was served by one provider or another changes nothing.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionBeat.h"

/** The four locked performances, plus the absence of one. */
enum class EWonderlandDogAct : uint8
{
	/** Keep whatever the Dog is already doing. Every unspecified mission state resolves here. */
	None,
	FloatingActivation,
	ReadingTheBook,
	PaintingTheWork,
	VerificationBeam
};

/** What the Dog is holding. Props fade in and out rather than appearing, so a stage change is a movement. */
enum class EWonderlandDogProp : uint8
{
	None,
	Book,
	Paintbrush
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
};

/* ------------------------------------------------------------------ resolvers */

WONDERLAND_API const FWonderlandDogActReading& WonderlandDogActReading(EWonderlandDogAct Act);

/**
 * THE ONE MAPPING, from mission beat to what the body does.
 *
 * Only the four the founder locked resolve to a performance. EVERYTHING ELSE RESOLVES TO `None` ON
 * PURPOSE, including handoff: research, repair, review, blocked, waiting, error and completion keep the
 * behaviour they already had until each is specified in its own right.
 */
WONDERLAND_API EWonderlandDogAct WonderlandDogActForBeat(EWonderlandMissionBeat Beat);

WONDERLAND_API const TCHAR* WonderlandDogActName(EWonderlandDogAct Act);
WONDERLAND_API const TCHAR* WonderlandDogPropName(EWonderlandDogProp Prop);

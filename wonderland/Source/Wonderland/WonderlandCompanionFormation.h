// WONDERLAND — WHERE THE COMPANIONS STAND WHILE A MISSION IS BEING PERFORMED.
//
// THE FOUNDER'S DECISIONS, 2026-09-16, and both of them are about COMPOSITION rather than about behaviour:
//
//   WHILE VERIFYING, the companions clear the line between the Dog and the Mission Contract. The joint
//   film found the Jhinn standing exactly on that sight-line -- the contract projects to the centre of
//   frame and the companion is in front of it -- so the most important moment of a mission was happening
//   behind somebody's head.
//
//   WHILE RESEARCHING, they fly a coordinated orbit about the Contract and send small orb pulses into it,
//   which reads as assisting the study: contributing energy and information, not attacking it. Elegant,
//   coordinated, supportive -- and still not blocking the Dog or the Contract.
//
// A TEMPORARY OVERRIDE, NOT A REDESIGN. The measured follow offsets from Phase 1 -- the LLM Companion at
// Y=-88 and the Jhinn at Y=+110, both established with the founder -- are untouched, and every companion
// returns to them the moment the stage ends. What this adds is a formation that a STAGE may ask for, for
// as long as that stage lasts.
//
// IT IS DRIVEN BY THE SAME BEAT AS EVERYTHING ELSE. The formation comes from the mission beat, through the
// same fold the crystal and the Dog's body read, so there is one source of stage truth in the world and
// the companions cannot disagree with the Dog about what is happening.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionBeat.h"

/** Where the companions put themselves while a stage is being performed. */
enum class EWonderlandCompanionFormation : uint8
{
	/** The measured Phase 1 offsets, beside the Dog. Everything that is not a named stage. */
	Follow,
	/** Behind the Dog and out to the sides, off the line between the Dog and the Contract. */
	ClearTheSightLine,
	/** A coordinated circle about the Contract, above it, sending pulses into it. */
	ResearchOrbit
};

WONDERLAND_API const TCHAR* WonderlandCompanionFormationName(EWonderlandCompanionFormation Formation);

/**
 * THE ONE MAPPING, beat to formation.
 *
 * Only two stages ask for anything. Everything else -- including every transition and every ending -- is
 * `Follow`, so a companion is never left in a formation because a stage forgot to put it back.
 */
WONDERLAND_API EWonderlandCompanionFormation WonderlandCompanionFormationForBeat(EWonderlandMissionBeat Beat);

/** How the orbit is shaped. Numbers rather than a curve asset, for the same reason the Dog's poses are. */
struct FWonderlandCompanionOrbit
{
	/** Distance from the Contract, uu. Inside the Dog's own circle so the two read as concentric. */
	float RadiusUU = 210.0f;
	/** Height above the Contract's heart, uu. Above the Dog's head, so a companion never masks it. */
	float HeightUU = 110.0f;
	/** Revolutions per second. Slow enough to read as ceremony rather than agitation. */
	float Revolutions = 0.085f;
	/** How far a companion rises and falls as it goes round, uu. */
	float BobUU = 16.0f;
	/** Seconds between one companion's pulses. They are offset so the two never fire together. */
	float PulseEverySeconds = 1.45f;
	/** Seconds a pulse takes to reach the Contract. */
	float PulseTravelSeconds = 0.75f;
};

WONDERLAND_API const FWonderlandCompanionOrbit& WonderlandCompanionOrbit();

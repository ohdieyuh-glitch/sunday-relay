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
// /JOIN IN MAKES THEM PARTICIPANTS (founder, 2026-09-16). A companion that has joined the Mission Contract flies
// about it for the whole mission and contributes to it -- gathering at preparation, circling with information pulses
// through research and planning, supporting implementation, a calmer circle through review, assisting a repair --
// while the Relay Dog performs each stage. Verification still clears the Dog's sight-line, and completion returns
// every companion to the Dog. Which flight a companion takes, joined or not, is WonderlandCompanionFlightForBeat
// (WonderlandMissionNarration.h), chosen in the same call as the lines its terminal shows.
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
	ResearchOrbit,
	/** Joined, preparing or holding: a slow circle about the Contract, not yet contributing. */
	Gather,
	/** Joined, implementation: circling and contributing, the Jhinn with an execution beam as well. */
	SupportOrbit,
	/** Joined, review: wider and slower, with sparse pulses. */
	CalmOrbit,
	/** Joined, repair: close and quick, contributing to the fix. */
	AssistOrbit
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
	/** False for a flight that only gathers: no pulses and no beam. */
	bool bContributes = true;
	/** The Jhinn's execution beam, on for part of each beam cycle. */
	bool bAgentBeam = false;
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

/** The orbit a flight uses. Follow and ClearTheSightLine are not orbits; they return the research orbit unused. */
WONDERLAND_API FWonderlandCompanionOrbit WonderlandCompanionOrbitFor(EWonderlandCompanionFormation Formation);

/** Whether a flight circles the Contract. */
WONDERLAND_API bool WonderlandFormationOrbits(EWonderlandCompanionFormation Formation);

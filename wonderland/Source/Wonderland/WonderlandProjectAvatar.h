// The Project Avatar — the user's actual project, as a thing in the world.
//
// WHAT IT IS
//
// A project starts as something dormant and small and grows as real work lands.
// The dragon egg is an EXAMPLE archetype, not the system: the stages here are
// generic and an archetype only decides what the stage looks like. Hard-coding
// "dragon" would make the next project type a rewrite.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE
//
//   Do not show a work animation for work Relay is not doing.
//
// It is the whole reason the state lives in engine-free arithmetic with tests
// rather than inside an actor. A world that idly cycles pretty animations is a
// screensaver; a world that shows implementing ONLY while Relay is implementing
// is an instrument. The difference is invisible in a screenshot and total in
// what the thing is for — so the absence of Relay data maps to Dormant, never
// to a plausible-looking guess, and there is a test named for it.
#pragma once

#include "WonderlandDogPose.h"

namespace WonderlandAvatar
{
	/** How far the project has come. Archetype-independent. */
	enum class EStage : int
	{
		Dormant = 0,   // nothing has happened yet
		Egg,           // a project exists
		Baby,          // first real work landed
		Growing,
		Advanced,
		Final,
	};

	/** What Relay says it is doing RIGHT NOW. Mirrors Relay's own vocabulary;
	 *  Unknown is what "we have not heard from Relay" maps to, and it is a
	 *  first-class value rather than a default that looks like Idle. */
	enum class EMission : int
	{
		Unknown = 0,
		Idle,
		Researching,
		Planning,
		Implementing,
		Reviewing,
		Verifying,
		Repairing,
		Approved,
		Complete,
	};

	const char* StageName(EStage Stage);
	const char* MissionName(EMission Mission);

	/** The work a Relay Dog should be seen doing for a given mission state.
	 *
	 *  Unknown and Idle both map to NO work — the Dog stays a quadruped and
	 *  wanders. That is the truthfulness rule in one line. */
	WonderlandPose::EWork WorkForMission(EMission Mission);

	/** Whether this mission state means a Dog should be AT the Avatar at all. */
	bool MissionWantsAttendance(EMission Mission);

	/** How the Avatar looks. Everything an actor needs to build itself. */
	struct FAvatarLook
	{
		/** Uniform scale multiplier for the shell, 1.0 at Egg. */
		float Scale = 1.0f;
		/** 0..1. Drives emissive strength — how awake it looks. */
		float Glow = 0.0f;
		/** Extra shell segments a stage has earned. */
		int Segments = 0;
		/** True only on the tick a stage was reached, so a growth pulse fires
		 *  ONCE. A pulse driven by "stage != last stage" every frame is a
		 *  permanent shimmer, which reads as a bug. */
		bool bGrowthPulse = false;
	};

	FAvatarLook LookFor(EStage Stage, EMission Mission, float Phase);

	/** Stage progression. Advances ONLY on real completion signals.
	 *
	 *  @param Current        the stage now.
	 *  @param Mission        what Relay reports.
	 *  @param CompletedRuns  how many missions have actually completed.
	 *  @return the stage the Avatar should be in.
	 *
	 *  There is deliberately no elapsed-time parameter. An Avatar that grows
	 *  because the level has been open for a while is telling the founder a
	 *  project advanced when nothing happened. */
	EStage StageFor(EStage Current, EMission Mission, int CompletedRuns);
}

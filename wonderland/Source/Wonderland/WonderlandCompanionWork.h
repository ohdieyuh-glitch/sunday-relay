// WONDERLAND — WHAT A JOINED COMPANION VISIBLY DOES, stage by stage, in a SIMULATED mission.
//
// FOUNDER, 2026-10-01: the companion terminals must show "commands, reasoning-safe status summaries, tool activity, file
// operations, checks, test/build output, search results" arriving as they happen. In a simulated mission nothing is
// behind the companions, so this is that activity as a DETERMINISTIC FIXTURE -- the same kind of fixture the Julius
// Live Terminal's role script is (WonderlandRoleScript.h), set in the SAME mission so the three consoles tell one story:
// the creation runtime's boundary, creation-runtime.ts and grants.ts, finding F-004, evidence E-021 and E-024.
//
// SAID TO BE A SIMULATION WHEREVER IT SHOWS: the feed that plays these marks the console's mode, session inset and tip
// line SIMULATED (UWonderlandUiSubsystem::NarrateMissionEvent). The counter it shows is the lines actually printed, never
// tokens: no model produced these and no usage is claimed.
//
// OPERATIONAL, NOT INTERIOR, and in each companion's own authority. The LLM Companion holds CONVERSATION authority: it
// reads, searches, compares and reports -- it never edits or runs anything. The Jhinn holds SCOPED WORK: it edits and
// tests inside the one folder it was given, and stops at its task. Neither ever carries Julius's mission authority.
//
// Pure data, no Slate: the console draws it, and a proof can read it.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandCompanionConsole.h"
#include "WonderlandMissionNarration.h"

namespace WonderlandCompanionWork
{
	/** One stage of a simulated mission in one companion's console: its narrated line first, then its work. */
	WONDERLAND_API TArray<FWonderlandConsoleLine> ForBeat(EWonderlandMissionBeat Beat, EWonderlandCompanionKind Kind);

	/** The status row's verb for a narrated activity: RESEARCHING reads "Researching", HOLDING CLEAR "Holding clear". */
	WONDERLAND_API FString VerbFor(const FString& Activity);

	/** How the row moves for that activity: working, thinking, or the slower cadence of waiting. */
	WONDERLAND_API EWonderlandConsoleActivity ActivityFor(const FString& Activity);
}

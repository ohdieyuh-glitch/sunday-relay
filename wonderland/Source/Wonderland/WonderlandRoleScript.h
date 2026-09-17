// WONDERLAND — what Julius and its three components are visibly doing, event by event, in a simulated mission.
//
// FOUNDER, 2026-09-16: "When I watch the simulation, I should immediately understand: Julius is coordinating multiple
// specialized AI components simultaneously." The world already performs the mission; this is the other half: four
// live consoles -- JULIUS (orchestration and authority), PROMPT ARCHITECT, CODING AGENT, INDEPENDENT REVIEWER -- each
// writing out its own work from the SAME deterministic event stream the Relay Dog performs.
//
// OPERATIONAL, NOT INTERIOR. Every line is an operational fact a Julius component would record -- a dispatch, a
// prompt/task packet, a diff, a test run, a criterion checked, a finding and its lifecycle, a decision -- and none is
// presented as a model's hidden reasoning. The packets, file names, IDs and diffs are a DETERMINISTIC FIXTURE: no
// provider is called, and the consoles carry DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION.
//
// THESE ARE JULIUS'S COMPONENTS, NOT WONDERLAND'S COMPANIONS. The LLM Companion and the Jhinn are Wonderland companion
// tiers joined to a Mission Contract (WonderlandMissionNarration.h); the Prompt Architect, Coding Agent and Independent
// Reviewer are provider-independent roles inside Julius. The two layers never share a console.
//
// Pure data, no Slate and no reflection, so the scripts can be read and tested like the fixtures themselves.
#pragma once

#include "CoreMinimal.h"

/** The four system views of a running Julius mission. Julius holds mission authority; the others work under it. */
enum class EWonderlandJuliusRole : uint8
{
	Julius,
	PromptArchitect,
	CodingAgent,
	IndependentReviewer,
};

inline constexpr int32 WonderlandJuliusRoleCount = 4;

/** How a console line is drawn. */
enum class EWonderlandRoleLineKind : uint8
{
	/** "> something happened" */
	Log,
	/** A small heading inside the console: MISSION, PROMPT PREVIEW, EDIT, CHECKING... */
	Section,
	/** A command or action being run: "$ running targeted tests" */
	Command,
	/** A line of a prompt or task packet being composed. */
	Preview,
	/** The rule above and below a packet. */
	PreviewRule,
	/** A file being edited or inspected. */
	File,
	DiffAdd,
	DiffRemove,
	Pass,
	Fail,
	/** A criterion checked, and one still open. */
	CheckDone,
	CheckOpen,
	/** A finding or claim raised. */
	Finding,
	/** A lifecycle transition: "F-004  OPEN -> ADDRESSED", "G-018 ACCEPTED". */
	State,
	/** Waiting on another component. */
	Wait,

	// ---- the concurrent workstream (founder, 2026-09-16 evening): work you can watch, not status lines

	/** Not drawn: the section's status changes here, when the component reaches this point of its work. */
	Status,
	/** Not drawn: a new piece of work begins; the previous one collapses to its summary line. */
	Episode,
	/** Not drawn: what the current piece of work's collapsed summary line says. */
	Summary,
	/** "FILE  src/relay/mission/creation-runtime.ts" */
	CodeFile,
	/** "174|+|  const grant = ..." -- line number, marker (' ', '+', '-'), code. TYPED. */
	CodeLine,
	/** "+4 / -1" */
	DiffStat,
	/** Opens an outbound prompt preview box; the text is its target ("CODING AGENT"). */
	PromptBegin,
	/** A heading inside the prompt box: Objective, Constraints, Required work. */
	PromptHeading,
	/** A line of the prompt. TYPED. */
	PromptLine,
	/** Closes the prompt box. */
	PromptEnd,
	/** "F-004|MATERIAL|Failure path lacks verification evidence.|creation-runtime.ts:175" */
	FindingCard,
	/** Not drawn: hold this many seconds before the next line. */
	Pause,
	/** A little space. */
	Blank,
};

struct FWonderlandRoleLine
{
	EWonderlandRoleLineKind Kind = EWonderlandRoleLineKind::Log;
	FString Text;
};

/** What one role does when one mission event arrives: a status (empty keeps the current one) and lines to write. */
struct FWonderlandRoleBlock
{
	FString Status;
	TArray<FWonderlandRoleLine> Lines;
};

/**
 * The block a role writes for an event. `Occurrence` counts from 1 how many times this event type has arrived in the
 * current mission, because the fixture repeats some (a second coder.started resumes after a checkpoint; a second
 * review.started is the re-review). The companions joined are named in Julius's orchestration.
 */
WONDERLAND_API FWonderlandRoleBlock WonderlandRoleBlockFor(EWonderlandJuliusRole Role, FName EventType, int32 Occurrence,
	bool bLlmJoined, bool bJhinnJoined);

/** When the mission ends (no event): the status each role settles to. */
WONDERLAND_API FString WonderlandRoleRestingStatus(EWonderlandJuliusRole Role, bool bCompleted);

/** Seconds of world time a line holds the console before the next one is written. Readable, not instant. */
WONDERLAND_API float WonderlandRoleLineHoldSeconds(EWonderlandRoleLineKind Kind);

/** True for a line that arrives character by character: code and prompt text. */
WONDERLAND_API bool WonderlandRoleLineTypes(EWonderlandRoleLineKind Kind);

/** How fast a typed line arrives, characters per second of world time. */
WONDERLAND_API float WonderlandRoleTypingCharsPerSecond(EWonderlandRoleLineKind Kind);

/** "JULIUS", "PROMPT ARCHITECT", ... */
WONDERLAND_API const TCHAR* WonderlandJuliusRoleTitle(EWonderlandJuliusRole Role);

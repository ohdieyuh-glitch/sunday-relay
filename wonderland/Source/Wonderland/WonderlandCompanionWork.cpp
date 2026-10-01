#include "WonderlandCompanionWork.h"

// Named for this file alone: the module is one unity translation unit.
namespace WonderlandCompanionWorkDetail
{
	using ELine = EWonderlandConsoleLine;

	/** A stage's lines, each with the pause before it: a beat of thought before a tool, output close behind it. */
	struct FScript
	{
		TArray<FWonderlandConsoleLine> Lines;

		FScript& Say(const FString& Text, float Pace = 0.4f) { Lines.Emplace(ELine::Say, Text, FString(), Pace); return *this; }
		FScript& Tool(const TCHAR* Name, const TCHAR* Detail, float Pace) { Lines.Emplace(ELine::Tool, Name, Detail, Pace); return *this; }
		FScript& Cmd(const TCHAR* Text, float Pace) { Lines.Emplace(ELine::Command, Text, FString(), Pace); return *this; }
		FScript& Out(const TCHAR* Text, float Pace) { Lines.Emplace(ELine::Output, Text, FString(), Pace); return *this; }
		FScript& Add(const TCHAR* Text, float Pace) { Lines.Emplace(ELine::Added, Text, FString(), Pace); return *this; }
		FScript& Del(const TCHAR* Text, float Pace) { Lines.Emplace(ELine::Removed, Text, FString(), Pace); return *this; }
		FScript& Ok(const TCHAR* Text, float Pace) { Lines.Emplace(ELine::Success, Text, FString(), Pace); return *this; }
		FScript& Bad(const TCHAR* Text, float Pace) { Lines.Emplace(ELine::Failure, Text, FString(), Pace); return *this; }
		FScript& Note(const TCHAR* Text, float Pace) { Lines.Emplace(ELine::Note, Text, FString(), Pace); return *this; }
	};

	/**
	 * THE LLM COMPANION: CONVERSATION AUTHORITY. It reads, searches, compares and tells Julius what it found. It edits
	 * nothing and runs nothing -- so there is no shell here, only its reading and its reports.
	 */
	void Llm(EWonderlandMissionBeat Beat, const FString& Said, FScript& S)
	{
		using B = EWonderlandMissionBeat;
		switch (Beat)
		{
		case B::MissionStart:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("Mission Contract r1"), 1.1f)
			 .Out(TEXT("objective   implement the Mission Contract boundary"), 0.35f)
			 .Out(TEXT("4 constraints · 3 acceptance criteria"), 0.12f)
			 .Tool(TEXT("Recall"), TEXT("earlier work on creation-runtime.ts"), 1.5f)
			 .Out(TEXT("2 notes · last change verified in mission/omega"), 0.5f)
			 .Say(TEXT("Joined. Ready to research for the Prompt Architect."), 1.3f);
			break;
		case B::Researching:
			S.Say(Said)
			 .Tool(TEXT("Search"), TEXT("\"admit(\" in src/relay/mission"), 1.0f)
			 .Out(TEXT("3 call sites"), 0.6f)
			 .Out(TEXT("  creation-runtime.ts:174   admit(request)"), 0.08f)
			 .Out(TEXT("  grants.ts:41              admit(cached)"), 0.08f)
			 .Out(TEXT("  sandbox.ts:88             admit(scope)"), 0.08f)
			 .Tool(TEXT("Read"), TEXT("research/R-03.md"), 1.3f)
			 .Out(TEXT("Read 48 lines"), 0.4f)
			 .Tool(TEXT("Compare"), TEXT("R-03 with Mission Contract r1"), 1.4f)
			 .Out(TEXT("A1  the sandbox owns every grant     covered"), 0.5f)
			 .Out(TEXT("A2  no credential inheritance        covered"), 0.1f)
			 .Out(TEXT("A3  failure path has evidence        open"), 0.1f)
			 .Say(TEXT("A3 has no evidence yet. Flagging it for the brief."), 1.2f);
			break;
		case B::PromptArchitectActive:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("packet P-05 (draft)"), 1.0f)
			 .Out(TEXT("Objective · Constraints · Required work · Evidence"), 0.45f)
			 .Tool(TEXT("Check"), TEXT("P-05 against R-03"), 1.5f)
			 .Out(TEXT("present   \"accepted guidance only\""), 0.55f)
			 .Out(TEXT("missing   an evidence step for A3"), 0.12f)
			 .Say(TEXT("Suggested an evidence step for A3 to the architect."), 1.3f);
			break;
		case B::Guidance:
			S.Say(Said)
			 .Tool(TEXT("Note"), TEXT("findings for guidance G-018"), 1.1f)
			 .Out(TEXT("3 references · 1 open question (A3)"), 0.5f)
			 .Ok(TEXT("handed to Julius with G-018"), 0.6f);
			break;
		case B::CodingAgentActive:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("creation-runtime.ts:160-190"), 1.1f)
			 .Out(TEXT("Read 31 lines"), 0.4f)
			 .Tool(TEXT("Compare"), TEXT("the change with P-05's constraints"), 1.4f)
			 .Out(TEXT("preserve sandbox isolation     kept"), 0.5f)
			 .Out(TEXT("accepted guidance only         kept"), 0.1f)
			 .Out(TEXT("do not change the contract     kept"), 0.1f)
			 .Say(TEXT("The change stays inside the brief."), 1.2f);
			break;
		case B::WaitingCheckpoint:
			S.Say(Said)
			 .Note(TEXT("checkpoint C-2 · waiting for Julius to approve"), 1.0f);
			break;
		case B::ApprovalContinue:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("guidance G-019"), 1.0f)
			 .Out(TEXT("expire cached grants with their scope"), 0.45f)
			 .Say(TEXT("Watching grants.ts for the change."), 1.2f);
			break;
		case B::Handoff:
			S.Say(Said)
			 .Note(TEXT("work moving: Coding Agent -> Independent Reviewer"), 0.8f);
			break;
		case B::IndependentReviewerActive:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("evidence E-021"), 1.0f)
			 .Out(TEXT("creation-boundary.test.ts   7/7"), 0.45f)
			 .Out(TEXT("sandbox-isolation.test.ts   4/4"), 0.1f)
			 .Tool(TEXT("Compare"), TEXT("E-021 with the acceptance criteria"), 1.4f)
			 .Out(TEXT("A1 met · A2 met · A3 has no evidence"), 0.5f)
			 .Say(TEXT("Told the reviewer A3 still lacks failure-path evidence."), 1.2f);
			break;
		case B::ReviewChallenge:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("creation-runtime.ts:175"), 1.0f)
			 .Out(TEXT("the denial path returns without an evidence id"), 0.45f)
			 .Note(TEXT("finding F-004 · OPEN"), 0.9f);
			break;
		case B::RepairRequired:
			S.Say(Said)
			 .Tool(TEXT("Search"), TEXT("\"deny(\" in creation-runtime.ts"), 1.0f)
			 .Out(TEXT("1 match · creation-runtime.ts:175"), 0.45f)
			 .Ok(TEXT("location sent to the Coding Agent"), 0.8f);
			break;
		case B::Repairing:
			S.Say(Said)
			 .Tool(TEXT("Recall"), TEXT("the evidence id format"), 1.0f)
			 .Out(TEXT("E-### · issued by evidence.ts"), 0.45f)
			 .Tool(TEXT("Read"), TEXT("failure-path.test.ts"), 1.3f)
			 .Out(TEXT("Read 22 lines"), 0.4f)
			 .Out(TEXT("expects an evidence id on every denial"), 0.15f);
			break;
		case B::Verifying:
			S.Say(Said)
			 .Note(TEXT("verifying is Julius's; the companion only watches"), 1.0f);
			break;
		case B::Block:
			S.Say(Said)
			 .Note(TEXT("nothing advances until Julius unblocks the run"), 0.9f);
			break;
		case B::Error:
			// the feed reports the failure itself, in red, once
			break;
		case B::CompleteVerified:
			S.Say(Said)
			 .Ok(TEXT("3 references · 2 cross-checks · 1 finding explained"), 0.7f);
			break;
		default:
			S.Say(Said);
			break;
		}
	}

	/**
	 * THE JHINN: SCOPED WORK. Given one task and one folder, it plans, edits, runs the checks it was allowed, and hands
	 * the work back. Its tasks here are J-07 (cached grants expire with their scope) and J-08 (every denial carries an
	 * evidence id) -- inside grants.ts and evidence.ts and nowhere else.
	 */
	void Jhinn(EWonderlandMissionBeat Beat, const FString& Said, FScript& S)
	{
		using B = EWonderlandMissionBeat;
		switch (Beat)
		{
		case B::MissionStart:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("task J-07"), 1.0f)
			 .Out(TEXT("scope   src/relay/mission/grants.ts"), 0.4f)
			 .Out(TEXT("allow   read, edit, run tests"), 0.1f)
			 .Out(TEXT("goal    cached grants expire with their scope"), 0.1f)
			 .Say(TEXT("Taking J-07. Nothing outside grants.ts."), 1.2f);
			break;
		case B::Researching:
			S.Say(Said)
			 .Cmd(TEXT("git status --short"), 1.0f)
			 .Out(TEXT("clean · branch mission/alpha"), 0.4f)
			 .Cmd(TEXT("grep -n \"cache\" src/relay/mission/grants.ts"), 1.2f)
			 .Out(TEXT("41:  const cache = new Map<string, Grant>()"), 0.35f)
			 .Out(TEXT("57:  cache.set(key, grant)"), 0.08f)
			 .Out(TEXT("63:  return cache.get(key)"), 0.08f)
			 .Say(TEXT("Three places to change, all in grants.ts."), 1.2f);
			break;
		case B::PromptArchitectActive:
			S.Say(Said)
			 .Tool(TEXT("Plan"), TEXT("J-07"), 1.1f)
			 .Out(TEXT("1. keep each grant's scope beside it"), 0.4f)
			 .Out(TEXT("2. drop a cached grant once its scope has ended"), 0.12f)
			 .Out(TEXT("3. run grants.test.ts"), 0.12f);
			break;
		case B::Guidance:
			S.Say(Said)
			 .Ok(TEXT("brief P-05 acknowledged"), 0.9f);
			break;
		case B::CodingAgentActive:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("src/relay/mission/grants.ts"), 1.0f)
			 .Out(TEXT("Read 96 lines"), 0.4f)
			 .Tool(TEXT("Edit"), TEXT("src/relay/mission/grants.ts"), 1.4f)
			 .Out(TEXT("Updated grants.ts with 2 additions and 1 removal"), 0.45f)
			 .Del(TEXT("57 -   cache.set(key, grant)"), 0.1f)
			 .Add(TEXT("57 +   cache.set(key, { grant, scope: grant.scope })"), 0.08f)
			 .Add(TEXT("63 +   if (entry.scope.ended) return undefined"), 0.08f)
			 .Cmd(TEXT("npm test -- grants"), 1.3f)
			 .Out(TEXT("grants.test.ts   6 passed"), 0.9f)
			 .Ok(TEXT("6/6 passed"), 0.3f);
			break;
		case B::WaitingCheckpoint:
			S.Say(Said)
			 .Note(TEXT("J-07 waits here until Julius approves its edit"), 1.0f);
			break;
		case B::ApprovalContinue:
			S.Say(Said)
			 .Tool(TEXT("Edit"), TEXT("src/relay/mission/grants.test.ts"), 1.2f)
			 .Out(TEXT("Updated grants.test.ts with 9 additions"), 0.45f)
			 .Add(TEXT("+   it('drops a grant whose scope has ended', ...)"), 0.1f)
			 .Cmd(TEXT("npm test -- grants"), 1.2f)
			 .Out(TEXT("grants.test.ts   7 passed"), 0.9f)
			 .Ok(TEXT("7/7 passed"), 0.3f);
			break;
		case B::Handoff:
			S.Say(Said)
			 .Note(TEXT("J-07 done · evidence E-022 handed to Julius"), 0.8f);
			break;
		case B::IndependentReviewerActive:
			S.Say(Said)
			 .Note(TEXT("E-022 submitted alongside E-021"), 0.9f);
			break;
		case B::ReviewChallenge:
			S.Say(Said)
			 .Note(TEXT("F-004 is outside J-07's scope; no action taken"), 0.9f);
			break;
		case B::RepairRequired:
			S.Say(Said)
			 .Tool(TEXT("Read"), TEXT("task J-08"), 1.0f)
			 .Out(TEXT("scope   src/relay/mission/evidence.ts"), 0.4f)
			 .Out(TEXT("goal    every denial carries an evidence id"), 0.1f);
			break;
		case B::Repairing:
			S.Say(Said)
			 .Tool(TEXT("Edit"), TEXT("src/relay/mission/evidence.ts"), 1.1f)
			 .Out(TEXT("Updated evidence.ts with 2 additions"), 0.45f)
			 .Add(TEXT("+ export const denialEvidence = (scope) => issue('denial', scope)"), 0.1f)
			 .Cmd(TEXT("npm test -- failure-path"), 1.2f)
			 .Bad(TEXT("failure-path.test.ts   0/1   evidence id missing"), 1.0f)
			 .Tool(TEXT("Edit"), TEXT("src/relay/mission/evidence.ts"), 1.4f)
			 .Out(TEXT("Updated evidence.ts with 1 addition"), 0.45f)
			 .Add(TEXT("+   return { ...denial, evidenceId: next.id }"), 0.1f)
			 .Cmd(TEXT("npm test -- failure-path"), 1.2f)
			 .Ok(TEXT("failure-path.test.ts   1/1"), 0.9f);
			break;
		case B::Verifying:
			S.Say(Said)
			 .Note(TEXT("J-07 and J-08 checks are in"), 0.9f);
			break;
		case B::Block:
			S.Say(Said)
			 .Note(TEXT("nothing advances until Julius unblocks the run"), 0.9f);
			break;
		case B::Error:
			break;
		case B::CompleteVerified:
			S.Say(Said)
			 .Ok(TEXT("J-07, J-08 closed · 3 files changed · 8 tests passed"), 0.7f);
			break;
		default:
			S.Say(Said);
			break;
		}
	}
}

TArray<FWonderlandConsoleLine> WonderlandCompanionWork::ForBeat(EWonderlandMissionBeat Beat, EWonderlandCompanionKind Kind)
{
	// THE NARRATED LINE LEADS, word for word: the console says what the mission proofs already read as the companion's line.
	const FWonderlandCompanionNarration Narration = WonderlandCompanionNarrationForBeat(Beat, Kind);
	WonderlandCompanionWorkDetail::FScript Script;
	if (Kind == EWonderlandCompanionKind::LlmCompanion)
	{
		WonderlandCompanionWorkDetail::Llm(Beat, Narration.Line, Script);
	}
	else
	{
		WonderlandCompanionWorkDetail::Jhinn(Beat, Narration.Line, Script);
	}
	return Script.Lines;
}

FString WonderlandCompanionWork::VerbFor(const FString& Activity)
{
	struct FVerb
	{
		const TCHAR* Activity;
		const TCHAR* Verb;
	};
	static const FVerb Verbs[] = {
		{TEXT("JOINING"),        TEXT("Joining")},
		{TEXT("RESEARCHING"),    TEXT("Researching")},
		{TEXT("REASONING"),      TEXT("Reasoning")},
		{TEXT("RETURNING"),      TEXT("Returning findings")},
		{TEXT("SUPPORTING"),     TEXT("Supporting")},
		{TEXT("WAITING"),        TEXT("Waiting on Julius")},
		{TEXT("HANDOFF"),        TEXT("Following the handoff")},
		{TEXT("CROSS-CHECKING"), TEXT("Cross-checking")},
		{TEXT("ASSISTING"),      TEXT("Assisting")},
		{TEXT("HOLDING CLEAR"),  TEXT("Holding clear")},
		{TEXT("STOPPED"),        TEXT("Stopped")},
		{TEXT("RETURNED"),       TEXT("Returning")},
		{TEXT("ASSIGNED"),       TEXT("Taking the task")},
		{TEXT("PLANNING"),       TEXT("Planning")},
		{TEXT("EXECUTING"),      TEXT("Executing")},
		{TEXT("RETURNED WORK"),  TEXT("Waiting on review")},
		{TEXT("ASSIGNED FIX"),   TEXT("Taking the fix")},
		{TEXT("EXECUTING FIX"),  TEXT("Fixing")},
	};
	for (const FVerb& Pair : Verbs)
	{
		if (Activity.Equals(Pair.Activity, ESearchCase::IgnoreCase))
		{
			return Pair.Verb;
		}
	}
	// anything else reads as its own word, in sentence case
	FString Out = Activity.ToLower().Replace(TEXT("_"), TEXT(" "));
	if (Out.Len() > 0)
	{
		Out[0] = FChar::ToUpper(Out[0]);
	}
	return Out.IsEmpty() ? FString(TEXT("Working")) : Out;
}

EWonderlandConsoleActivity WonderlandCompanionWork::ActivityFor(const FString& Activity)
{
	static const TCHAR* const Waiting[] = { TEXT("WAITING"), TEXT("HOLDING CLEAR"), TEXT("RETURNED WORK"), TEXT("HANDOFF") };
	static const TCHAR* const Thinking[] = { TEXT("JOINING"), TEXT("REASONING"), TEXT("PLANNING"), TEXT("ASSIGNED"), TEXT("ASSIGNED FIX") };
	for (const TCHAR* Word : Waiting)
	{
		if (Activity.Equals(Word, ESearchCase::IgnoreCase))
		{
			return EWonderlandConsoleActivity::Waiting;
		}
	}
	for (const TCHAR* Word : Thinking)
	{
		if (Activity.Equals(Word, ESearchCase::IgnoreCase))
		{
			return EWonderlandConsoleActivity::Thinking;
		}
	}
	return Activity.Equals(TEXT("STOPPED"), ESearchCase::IgnoreCase) ? EWonderlandConsoleActivity::Error : EWonderlandConsoleActivity::Working;
}

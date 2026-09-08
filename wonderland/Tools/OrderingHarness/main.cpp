// THE C++ ORDERING RULE, RUN AGAINST WHAT TYPESCRIPT ACTUALLY DID.
//
// Every case in WonderlandOrdering.cases.cpp was produced by executing the real
// `applyWonderlandOrdering`. This replays each one through the C++ port and
// compares BOTH halves: the verdict, and the whole cursor it folded into.
//
// Comparing the cursor matters as much as the verdict. A port that returned the
// right verdicts while forgetting to raise a counter, or while letting an
// accepted envelope lower the revision, would agree about every decision and
// diverge about everything it remembered — and the divergence would only become
// visible on the next envelope, in the field.

#include "WonderlandOrdering.h"

#include <cstdio>
#include <string>

namespace
{
	int Failures = 0;
	int Checks = 0;

	const char* VerdictName(EWonderlandOrderingVerdict Verdict)
	{
		switch (Verdict)
		{
		case EWonderlandOrderingVerdict::Applied: return "applied";
		case EWonderlandOrderingVerdict::Duplicate: return "duplicate";
		case EWonderlandOrderingVerdict::StaleSequence: return "stale_sequence";
		case EWonderlandOrderingVerdict::StaleRevision: return "stale_revision";
		case EWonderlandOrderingVerdict::ForeignProject: return "foreign_project";
		case EWonderlandOrderingVerdict::ForeignJulius: return "foreign_julius";
		case EWonderlandOrderingVerdict::ForeignRun: return "foreign_run";
		case EWonderlandOrderingVerdict::Malformed: return "malformed";
		}
		return "?";
	}

	std::string Text(const FWonderlandText& Value)
	{
		return Value.bKnown ? std::string("\"") + Value.Value.s + "\"" : std::string("<unknown>");
	}

	void Field(const char* Case, const char* Name, int64 Actual, int64 Expected)
	{
		++Checks;
		if (Actual == Expected) { return; }
		++Failures;
		std::printf("FAIL %s: %s is %lld, TypeScript made it %lld\n",
			Case, Name, static_cast<long long>(Actual), static_cast<long long>(Expected));
	}

	void Flag(const char* Case, const char* Name, bool Actual, bool Expected)
	{
		++Checks;
		if (Actual == Expected) { return; }
		++Failures;
		std::printf("FAIL %s: %s is %s, TypeScript made it %s\n",
			Case, Name, Actual ? "true" : "false", Expected ? "true" : "false");
	}

	void Carrier(const char* Case, const char* Name,
		const FWonderlandText& Actual, const FWonderlandText& Expected)
	{
		++Checks;
		if (Actual.bKnown == Expected.bKnown && (!Actual.bKnown || Actual.Value == Expected.Value))
		{
			return;
		}
		++Failures;
		std::printf("FAIL %s: %s is %s, TypeScript made it %s\n",
			Case, Name, Text(Actual).c_str(), Text(Expected).c_str());
	}
}

int main()
{
	const TArray<FWonderlandOrderingCase>& Cases = WonderlandOrderingCases();
	if (Cases.Num() == 0)
	{
		std::printf("FAIL the generated case table is empty\n");
		return 1;
	}

	// EVERY VERDICT MUST APPEAR, or the table has stopped covering the rule. A
	// fixture that drifted into testing only the happy path would keep passing
	// while the refusals rotted.
	bool Seen[8] = {false, false, false, false, false, false, false, false};

	for (int32 Index = 0; Index < Cases.Num(); ++Index)
	{
		const FWonderlandOrderingCase& Entry = Cases[Index];
		const char* Name = Entry.Name.s.c_str();
		const FWonderlandOrderingOutcome Outcome = WonderlandApplyOrdering(Entry.Before, Entry.Envelope);

		Seen[static_cast<int>(Entry.Expected)] = true;

		++Checks;
		if (Outcome.Verdict != Entry.Expected)
		{
			++Failures;
			std::printf("FAIL %s: verdict is %s, TypeScript said %s\n",
				Name, VerdictName(Outcome.Verdict), VerdictName(Entry.Expected));
		}

		Field(Name, "Sequence", Outcome.Cursor.Sequence, Entry.After.Sequence);
		Field(Name, "Revision", Outcome.Cursor.Revision, Entry.After.Revision);
		Flag(Name, "bRevisionFromSnapshot",
			Outcome.Cursor.bRevisionFromSnapshot, Entry.After.bRevisionFromSnapshot);
		Carrier(Name, "JuliusInstanceId", Outcome.Cursor.JuliusInstanceId, Entry.After.JuliusInstanceId);
		Carrier(Name, "RunId", Outcome.Cursor.RunId, Entry.After.RunId);
		Carrier(Name, "LastEventId", Outcome.Cursor.LastEventId, Entry.After.LastEventId);
		Carrier(Name, "LastAppliedAtIso", Outcome.Cursor.LastAppliedAtIso, Entry.After.LastAppliedAtIso);
		Field(Name, "Applied", Outcome.Cursor.Applied, Entry.After.Applied);
		Field(Name, "Duplicates", Outcome.Cursor.Duplicates, Entry.After.Duplicates);
		Field(Name, "StaleSequences", Outcome.Cursor.StaleSequences, Entry.After.StaleSequences);
		Field(Name, "StaleRevisions", Outcome.Cursor.StaleRevisions, Entry.After.StaleRevisions);
		Field(Name, "ForeignProjects", Outcome.Cursor.ForeignProjects, Entry.After.ForeignProjects);
		Field(Name, "ForeignJulius", Outcome.Cursor.ForeignJulius, Entry.After.ForeignJulius);
		Field(Name, "ForeignRuns", Outcome.Cursor.ForeignRuns, Entry.After.ForeignRuns);
		Field(Name, "Malformed", Outcome.Cursor.Malformed, Entry.After.Malformed);
		Field(Name, "Gaps", Outcome.Cursor.Gaps, Entry.After.Gaps);
	}

	for (int Verdict = 0; Verdict < 8; ++Verdict)
	{
		++Checks;
		if (Seen[Verdict]) { continue; }
		++Failures;
		std::printf("FAIL no generated case produces the verdict '%s'; the table has stopped covering the rule\n",
			VerdictName(static_cast<EWonderlandOrderingVerdict>(Verdict)));
	}

	if (Failures > 0)
	{
		std::printf("FAIL %d of %d ordering checks over %d cases\n", Failures, Checks, Cases.Num());
		return 1;
	}
	std::printf("ok   ordering matches TypeScript: %d cases, %d checks\n", Cases.Num(), Checks);
	return 0;
}

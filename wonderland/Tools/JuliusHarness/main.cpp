// THE JULIUS SUBSYSTEM, COMPILED AND RUN THROUGH A RECONNECT.
//
// The ordering RULE is proven elsewhere, against a table generated from the
// TypeScript. This proves the SUBSYSTEM around it: that a snapshot adopted
// after a reconnect sets the revision without moving the sequence, that a
// replayed tail cannot undo it, that a dropped link changes no mission state,
// and that a world switching projects cannot show the previous run.
//
// The scenario at the end is the one the founder directive names directly —
// disconnect mid-mission, reconnect, reconcile against authoritative state —
// walked end to end rather than asserted about.

#include "WonderlandJuliusSubsystem.h"

#include <cstdio>
#include <string>

static int Failures = 0;
static int Checks = 0;

static void Check(bool Condition, const char* What)
{
	++Checks;
	if (Condition) { return; }
	++Failures;
	std::printf("FAIL %s\n", What);
}

static FWonderlandEnvelope Env(const char* EventId, int64 Sequence, int64 Revision)
{
	FWonderlandEnvelope E;
	E.SchemaVersion = TEXT("relay-wonderland-envelope.v1");
	E.EventId = FString(EventId);
	E.ProjectId = TEXT("project-alpha");
	E.JuliusInstanceId.bKnown = true;
	E.JuliusInstanceId.Value = TEXT("julius-1");
	E.RunId.bKnown = true;
	E.RunId.Value = TEXT("run-1");
	E.OccurredAt = TEXT("2026-09-08T00:00:00.000Z");
	E.Sequence = Sequence;
	E.Revision = Revision;
	return E;
}

static FWonderlandJuliusEmbodiment State(EWonderlandJuliusState Visual, bool bTerminal)
{
	FWonderlandJuliusEmbodiment M;
	M.VisualState = Visual;
	M.StateSource = EWonderlandJuliusStateSource::JuliusRunState;
	M.bTerminal = bTerminal;
	return M;
}

static FWonderlandActivityReading Signals(std::initializer_list<EWonderlandActivitySignal> List)
{
	FWonderlandActivityReading A;
	for (const EWonderlandActivitySignal Signal : List) { A.Signals.Add(Signal); }
	return A;
}

static FWonderlandRunSnapshot Snapshot(int64 Revision, const char* RunId = "run-1")
{
	FWonderlandRunSnapshot S;
	S.SchemaVersion = TEXT("relay-wonderland-snapshot.v1");
	S.ProjectId = TEXT("project-alpha");
	S.RunId = FString(RunId);
	S.Revision = Revision;
	S.ObservedAtIso = TEXT("2026-09-08T00:01:00.000Z");
	return S;
}

/** The same snapshot, from a reader that could say where in the stream it sat. */
static FWonderlandRunSnapshot PositionedSnapshot(int64 Revision, int64 AtSequence)
{
	FWonderlandRunSnapshot S = Snapshot(Revision);
	S.AtSequence.bKnown = true;
	S.AtSequence.Value = static_cast<double>(AtSequence);
	return S;
}

int main()
{
	FSubsystemCollectionBase Collection;

	/* ------------------------------------------------ nothing said yet */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);

		Check(!S.HasState(), "a fresh subsystem holds no state");
		Check(!S.IsBound(), "and is bound to no project");
		// UNOBSERVED IS NOT IDLE, and DORMANT IS NOT PATROLLING.
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Unobserved,
			"an untold run is Unobserved, not Idle");
		Check(S.GetEmbodiment().Animation == EWonderlandDogAnimation::Dormant,
			"and the dog is Dormant, not walking a patrol nobody reported");
		Check(!S.GetEmbodiment().bTerminal, "and nothing claims the run ended");
		Check(S.GetActivity().Signals.Num() == 0, "and no activity was signalled");
		Check(S.GetResumeAfterSequence() == 0, "and a replay would start from the beginning");

		Check(S.ApplyEnvelope(Env("e1", 1, 1), State(EWonderlandJuliusState::Coding, false),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::ForeignProject,
			"an unbound subsystem refuses every envelope as foreign");
		Check(!S.HasState(), "and stays untold");
	}

	/* ---------------------------------------------------- the happy path */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));

		Check(S.ApplyEnvelope(Env("e1", 1, 1), State(EWonderlandJuliusState::PromptArchitect, false),
				Signals({EWonderlandActivitySignal::RetrievingContext})) ==
				EWonderlandOrderingVerdict::Applied,
			"the first envelope applies");
		Check(S.HasState(), "and the world has been told something");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::PromptArchitect,
			"and holds the state it was given");
		Check(S.GetActivity().Signals.Num() == 1, "and the activity that came with it");
		Check(S.GetResumeAfterSequence() == 1, "and a replay would resume from there");

		Check(S.ApplyEnvelope(Env("e2", 2, 2), State(EWonderlandJuliusState::Coding, false),
				Signals({EWonderlandActivitySignal::Retrying})) == EWonderlandOrderingVerdict::Applied,
			"a later envelope applies");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Coding,
			"and moves the state");
		Check(S.GetActivity().Signals[0] == EWonderlandActivitySignal::Retrying,
			"and replaces the activity rather than accumulating it");
		Check(S.GetCursor().Applied == 2, "both applications are counted");
	}

	/* ------------------------------------- the state and cursor stay together */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));
		S.ApplyEnvelope(Env("e1", 5, 5), State(EWonderlandJuliusState::Coding, false),
			FWonderlandActivityReading());

		// A REFUSED ENVELOPE MOVES NEITHER. A cursor advanced past a state the
		// world never showed would resume from a position describing something
		// nobody drew, and no later envelope would repair it.
		Check(S.ApplyEnvelope(Env("e2", 3, 5), State(EWonderlandJuliusState::Idle, false),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::StaleSequence,
			"an envelope behind us is refused");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Coding,
			"and does not change the state");
		Check(S.GetResumeAfterSequence() == 5, "nor the resume position");
		Check(S.GetCursor().StaleSequences == 1, "and the refusal is counted");
	}

	/* ------------------------------------------- a completion is not undone */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));
		S.ApplyEnvelope(Env("done", 9, 6), State(EWonderlandJuliusState::Complete, true),
			FWonderlandActivityReading());
		Check(S.GetEmbodiment().bTerminal, "a real ending is terminal");

		// THE CLASSIC RECONNECT FAILURE: a replica replays CODING at a sequence
		// ahead on its own stream while the run has already finished.
		Check(S.ApplyEnvelope(Env("late", 40, 4), State(EWonderlandJuliusState::Coding, false),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::StaleRevision,
			"a stale replica ahead on sequence is refused on REVISION");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Complete,
			"and a finished run stays finished");
		Check(S.GetEmbodiment().bTerminal, "and stays terminal");
	}

	/* ------------------------------------- disconnect, reconnect, reconcile */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));
		S.ApplyEnvelope(Env("e1", 4, 4), State(EWonderlandJuliusState::Coding, false),
			Signals({EWonderlandActivitySignal::Swarming}));

		FWonderlandLinkStatus Lost;
		Lost.State = EWonderlandLinkState::Stale;
		Lost.Explanation = TEXT("Contact with Relay was lost.");
		S.SetLinkStatus(Lost);

		// A DISCONNECTION IS NEVER A COMPLETION, and never an erasure either.
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Coding,
			"losing the link leaves the run where it was");
		Check(!S.GetEmbodiment().bTerminal, "and never marks it finished");
		Check(S.GetActivity().Signals.Num() == 1, "and leaves the activity standing");
		Check(S.GetResumeAfterSequence() == 4, "and the resume position intact");
		Check(S.GetLinkStatus().State == EWonderlandLinkState::Stale, "the link says it is stale");

		// RECONNECT: ask Julius what is true now, and adopt it.
		S.AdoptSnapshot(Snapshot(6), State(EWonderlandJuliusState::Verifying, false));
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Verifying,
			"the snapshot moves the world to what is true now");
		Check(S.GetCursor().Revision == 6, "and sets the revision");
		Check(S.GetResumeAfterSequence() == 4,
			"and leaves the SEQUENCE alone, because there is still a tail to replay");
		Check(S.GetCursor().bRevisionFromSnapshot,
			"and records that the revision came from a snapshot");

		// THE TAIL REPLAYS, and the events already absorbed by the snapshot are
		// refused while the ones beyond it are not.
		Check(S.ApplyEnvelope(Env("e2", 5, 6), State(EWonderlandJuliusState::Coding, false),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::StaleRevision,
			"an event at the snapshot's own revision is already in it");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Verifying,
			"so the replay cannot take the world backwards");
		Check(S.ApplyEnvelope(Env("e3", 6, 7), State(EWonderlandJuliusState::Complete, true),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::Applied,
			"and an event beyond the snapshot applies");
		Check(S.GetEmbodiment().bTerminal, "and the run reaches its real ending");
		Check(!S.GetCursor().bRevisionFromSnapshot,
			"an accepted event puts the position back on the event stream");
	}

	/* ------------------------- a POSITIONED snapshot, and the deafness it fixes */
	{
		// THE DEFECT THIS BLOCK EXISTS FOR. Only a state transition bumps
		// `julius_runs.version`, so a burst of genuinely new review, finding and
		// subagent work all arrives at the revision the snapshot was taken at.
		// With only the revision tie-break, every one of them was refused and the
		// world went deaf until the run happened to change state.
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));

		S.AdoptSnapshot(PositionedSnapshot(10, 40), State(EWonderlandJuliusState::Coding, false));
		Check(S.HasState(), "a positioned snapshot is adopted");
		Check(S.GetCursor().Revision == 10, "and sets the revision");
		Check(S.GetResumeAfterSequence() == 40,
			"and moves the resume position to where the snapshot sat");
		Check(!S.GetCursor().bRevisionFromSnapshot,
			"and leaves the blunt tie-break OFF, because sequence now does that job");

		// New work at the SAME revision: the case that used to go dark.
		Check(S.ApplyEnvelope(Env("after-1", 41, 10), State(EWonderlandJuliusState::IndependentReview, false),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::Applied,
			"new work at the snapshot's own revision is heard");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::IndependentReview,
			"and moves the world");

		// The tail the snapshot already absorbed, at the same revision: refused,
		// and refused on the axis that actually knows.
		Check(S.ApplyEnvelope(Env("before-1", 12, 10), State(EWonderlandJuliusState::PromptArchitect, false),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::StaleSequence,
			"a replayed pre-snapshot event is refused on SEQUENCE");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::IndependentReview,
			"and cannot take the world backwards");

		// An older revision is still refused on revision, which is checked first
		// on purpose: a stale replica can be ahead on its own stream.
		Check(S.ApplyEnvelope(Env("older", 900, 4), State(EWonderlandJuliusState::Idle, false),
				FWonderlandActivityReading()) == EWonderlandOrderingVerdict::StaleRevision,
			"an older revision is still refused on REVISION");
	}

	/* ------------------------------ a snapshot never drags the cursor back */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));
		S.ApplyEnvelope(Env("e1", 90, 5), State(EWonderlandJuliusState::Coding, false),
			FWonderlandActivityReading());

		S.AdoptSnapshot(PositionedSnapshot(9, 12), State(EWonderlandJuliusState::Verifying, false));
		Check(S.GetResumeAfterSequence() == 90,
			"a snapshot naming a position we have passed does not re-open applied events");
		Check(S.GetCursor().Revision == 9, "though its newer revision is still taken");
	}

	/* ---------------------------------------------- snapshots are refused too */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));
		S.ApplyEnvelope(Env("e1", 4, 8), State(EWonderlandJuliusState::Complete, true),
			FWonderlandActivityReading());

		// A REPLICA THAT HAS NOT CAUGHT UP ANSWERING inspectRun.
		S.AdoptSnapshot(Snapshot(5), State(EWonderlandJuliusState::Coding, false));
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Complete,
			"a snapshot behind us is not recovery, and is refused");
		Check(S.GetCursor().StaleRevisions == 1, "and counted as the stale revision it is");

		S.AdoptSnapshot(Snapshot(9, "run-2"), State(EWonderlandJuliusState::Coding, false));
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Complete,
			"a snapshot for another run is refused however new it is");
		Check(S.GetCursor().ForeignRuns == 1, "and counted as foreign");
	}

	/* ------------------------------------------------- switching projects */
	{
		UWonderlandJuliusSubsystem S;
		S.Initialize(Collection);
		S.BindProject(TEXT("project-alpha"));
		S.ApplyEnvelope(Env("e1", 7, 7), State(EWonderlandJuliusState::Coding, false),
			Signals({EWonderlandActivitySignal::Swarming}));

		S.BindProject(TEXT("project-alpha"));
		Check(S.HasState(), "re-binding the same project keeps the run");

		S.BindProject(TEXT("project-beta"));
		Check(!S.HasState(), "binding another project drops the previous run");
		Check(S.GetEmbodiment().VisualState == EWonderlandJuliusState::Unobserved,
			"and shows Unobserved rather than the last thing it knew");
		Check(S.GetActivity().Signals.Num() == 0, "and signals nothing");
		Check(S.GetResumeAfterSequence() == 0,
			"and starts a fresh cursor, so beta's first envelope is not stale");
		Check(S.GetCursor().Applied == 0,
			"with alpha's counters left behind rather than attributed to beta");
	}

	if (Failures > 0)
	{
		std::printf("FAIL %d of %d julius subsystem checks\n", Failures, Checks);
		return 1;
	}
	std::printf("ok   julius subsystem: %d checks\n", Checks);
	return 0;
}

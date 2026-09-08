#include "WonderlandJuliusSubsystem.h"

void UWonderlandJuliusSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	// The explanation is set because FWonderlandLinkStatus promises one always:
	// a world that has not connected has to be able to say so, and an empty
	// sentence reads as a missing string rather than a fact anybody stated.
	LinkStatus.State = EWonderlandLinkState::NeverConnected;
	LinkStatus.Explanation = TEXT("This world has not connected to Relay yet.");
}

void UWonderlandJuliusSubsystem::Deinitialize()
{
	ClearHeldState();
	Cursor = FWonderlandCursor();
	OnJuliusChanged.Clear();

	Super::Deinitialize();
}

void UWonderlandJuliusSubsystem::ClearHeldState()
{
	// A DEFAULT EMBODIMENT SAYS "RELAY HAS NOT SPOKEN", not "the run is idle".
	// EWonderlandJuliusState's ordinal 0 is Unobserved and the animation's is
	// Dormant, so a cleared subsystem renders a world waiting to be told rather
	// than an agent at rest.
	Embodiment = FWonderlandJuliusEmbodiment();
	Activity = FWonderlandActivityReading();
	bStateApplied = false;
}

void UWonderlandJuliusSubsystem::BindProject(const FString& ProjectId)
{
	if (ProjectId == Cursor.ProjectId)
	{
		return;
	}

	const bool bHadState = bStateApplied;

	// A FRESH CURSOR, not an edited one. Carrying the counters across would
	// attribute the previous project's refusals to this one, and carrying the
	// position would make the new run's first envelope look stale.
	Cursor = FWonderlandCursor();
	Cursor.SchemaVersion = TEXT("relay-wonderland-cursor.v1");
	Cursor.ProjectId = ProjectId;
	ClearHeldState();

	if (bHadState)
	{
		OnJuliusChanged.Broadcast();
	}
}

EWonderlandOrderingVerdict UWonderlandJuliusSubsystem::ApplyEnvelope(
	const FWonderlandEnvelope& Envelope,
	const FWonderlandJuliusEmbodiment& InEmbodiment,
	const FWonderlandActivityReading& InActivity)
{
	// AN UNBOUND CLIENT IS FOREIGN TO EVERYTHING, as in the usage subsystem and
	// for the same reason: a world that had not been told its project would
	// adopt whichever envelope reached it first and then refuse the real one.
	// Silence about identity is not permission.
	if (!IsBound())
	{
		++Cursor.ForeignProjects;
		return EWonderlandOrderingVerdict::ForeignProject;
	}

	const FWonderlandOrderingOutcome Outcome = WonderlandApplyOrdering(Cursor, Envelope);
	Cursor = Outcome.Cursor;

	if (!WonderlandOrderingVerdictApplies(Outcome.Verdict))
	{
		return Outcome.Verdict;
	}

	// THE THREE MOVE TOGETHER, ALWAYS. A cursor advanced past an envelope whose
	// state was not adopted would resume from a position describing something
	// the world never showed, and no later envelope would repair it.
	Embodiment = InEmbodiment;
	Activity = InActivity;
	bStateApplied = true;

	OnJuliusChanged.Broadcast();
	return EWonderlandOrderingVerdict::Applied;
}

void UWonderlandJuliusSubsystem::AdoptSnapshot(
	const FWonderlandRunSnapshot& Snapshot,
	const FWonderlandJuliusEmbodiment& InEmbodiment)
{
	// A SNAPSHOT FOR ANOTHER PROJECT IS REFUSED LIKE ANY OTHER FOREIGN INPUT.
	// Recovery is exactly when a mis-routed answer is most likely and least
	// noticeable: the world has nothing to contradict it.
	if (!IsBound() || Snapshot.ProjectId != Cursor.ProjectId)
	{
		++Cursor.ForeignProjects;
		return;
	}
	if (Cursor.RunId.bKnown && Cursor.RunId.Value != Snapshot.RunId)
	{
		++Cursor.ForeignRuns;
		return;
	}

	// A SNAPSHOT BEHIND WHAT WE HAVE IS NOT RECOVERY, it is an old answer from a
	// replica that has not caught up. Adopting it would undo events already
	// applied — the reconnect failure this whole cursor exists to prevent.
	if (Snapshot.Revision < Cursor.Revision)
	{
		++Cursor.StaleRevisions;
		return;
	}

	Cursor.RunId.bKnown = true;
	Cursor.RunId.Value = Snapshot.RunId;
	if (Snapshot.JuliusInstanceId.bKnown)
	{
		Cursor.JuliusInstanceId = Snapshot.JuliusInstanceId;
	}
	Cursor.Revision = Snapshot.Revision;

	// TWO MODES, AND THE DIFFERENCE IS THE READER'S HONESTY ABOUT ITS POSITION.
	//
	// WITH a sequence, the snapshot's place in the stream is KNOWN, so the
	// cursor moves to it and everything at or before it is refused on
	// SEQUENCE — precise, because a pre-snapshot replay is behind and new work
	// is ahead whatever the revision happens to be. The blunt revision
	// tie-break is then left OFF, because it is not merely unnecessary but
	// wrong: only a transition bumps the run version, so new review, finding
	// and subagent events all arrive at the snapshot's own revision and the
	// tie-break refused every one. The world went deaf until the run moved.
	//
	// WITHOUT one, the conservative tie-break stands. It refuses some genuinely
	// new events, which is the safer of the two errors when position is
	// unknown: showing stale work is worse than showing less of it.
	//
	// Never backwards. A snapshot naming a position we have already passed
	// would otherwise re-open events this world applied.
	const bool bPositioned = Snapshot.AtSequence.bKnown;
	if (bPositioned)
	{
		Cursor.Sequence = FMath::Max(Cursor.Sequence, static_cast<int64>(Snapshot.AtSequence.Value));
	}
	Cursor.bRevisionFromSnapshot = !bPositioned;

	Embodiment = InEmbodiment;
	bStateApplied = true;
	OnJuliusChanged.Broadcast();
}

void UWonderlandJuliusSubsystem::SetLinkStatus(const FWonderlandLinkStatus& Status)
{
	// NOTHING HERE TOUCHES THE EMBODIMENT. Losing a link does not change what
	// the run was last known to be doing, and blanking the state on disconnect
	// would turn a transport event into a mission verdict — the
	// disconnection-as-completion mistake in reverse, and just as wrong.
	if (Status.State == LinkStatus.State && Status.Explanation == LinkStatus.Explanation)
	{
		LinkStatus.LastSnapshotAtIso = Status.LastSnapshotAtIso;
		return;
	}

	LinkStatus = Status;
	OnJuliusChanged.Broadcast();
}

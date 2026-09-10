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
	// GATES GO WITH EVERYTHING ELSE. A world that switched projects and kept
	// the previous run's open gate would tell a founder they are being waited
	// on by a mission they are no longer watching.
	HumanGates.Empty();
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

bool UWonderlandJuliusSubsystem::AdoptHydration(const FWonderlandHydration& Hydration)
{
	// EVERY REFUSAL FIRST, AND NOTHING APPLIED UNTIL THEY ALL PASS. A hydration
	// is adopted WHOLESALE — the run, both meters, the activity, the citation,
	// the C.A.R.D. and the gates replace themselves in one act — so a partial
	// application would leave a world drawing two different moments with
	// nothing to say which half is real.
	if (!IsBound() || Hydration.ProjectId != Cursor.ProjectId)
	{
		++Cursor.ForeignProjects;
		return false;
	}
	if (Cursor.RunId.bKnown && Cursor.RunId.Value != Hydration.Run.RunId)
	{
		++Cursor.ForeignRuns;
		return false;
	}
	// THE RUN INSIDE MUST BE THE RUN NAMED OUTSIDE. The decoder checks this and
	// so does the server's verdict; a hydration that reached here another way —
	// a fixture, a replay, a caller that built one — would otherwise put
	// another run's meters under this run's name, and every check downstream
	// reads the outer identity alone.
	//
	// AND IT IS REDUNDANT TODAY, WHICH IS WORTH SAYING RATHER THAN IMPLYING
	// OTHERWISE. Given the outer check above, an inner project that differs
	// also differs from the cursor's, so `AdoptSnapshot` refuses it and the
	// counter comparison below returns false anyway. A mutation deleting this
	// block passes the harness, and that is correct rather than a gap: it is
	// defence in depth against a future in which those two rules diverge, and
	// it names the failure at the layer that can see both halves.
	if (Hydration.Run.ProjectId != Hydration.ProjectId)
	{
		++Cursor.ForeignProjects;
		return false;
	}
	// AN OLD ANSWER FROM A REPLICA THAT HAS NOT CAUGHT UP is not a recovery.
	// Adopting it would undo events already applied.
	if (Hydration.Run.Revision < Cursor.Revision)
	{
		++Cursor.StaleRevisions;
		return false;
	}

	// THE EMBODIMENT, BUILT FROM WHAT THE PAYLOAD ALREADY SAYS. Relay's mapping
	// decided the drawable state; nothing here re-decides it, and the fields
	// this cannot know stay at their zero members, which read as "Relay has not
	// said" rather than as an agent at rest.
	FWonderlandJuliusEmbodiment Next;
	Next.SchemaVersion = Hydration.Run.SchemaVersion;
	Next.ProjectId = Hydration.ProjectId;
	Next.MissionId = Hydration.Run.MissionId;
	Next.VisualState = Hydration.VisualState;
	// THE SOURCE IS THE RUN ROW, and saying so matters: it is the most
	// authoritative of the three derivations, and a world that could not tell
	// this from a phase-derived guess would weigh them the same.
	Next.StateSource = EWonderlandJuliusStateSource::JuliusRunState;
	Next.SourceState.bKnown = true;
	Next.SourceState.Value = Hydration.Run.State;
	Next.bTerminal = Hydration.bTerminal;
	Next.Activity = WonderlandActivityForJuliusState(Hydration.VisualState);
	Next.Motion = WonderlandMotionForActivity(Next.Activity);
	Next.Animation = WonderlandAnimationForJuliusState(Hydration.VisualState);
	Next.AttentionRequired.bKnown = true;
	Next.AttentionRequired.bValue = WonderlandJuliusStateAsksForAHuman(Hydration.VisualState);

	// EVERY REFUSAL AdoptSnapshot MAKES IS ONE OF THE FOUR ABOVE, so reaching
	// here it must apply. VERIFIED RATHER THAN ASSUMED — the two sets of rules
	// live in different methods and only one of them is edited at a time.
	//
	// BY THE COUNTERS, NOT BY `bStateApplied`, and the difference is the point.
	// On a RECONNECT — which is what this method is for — state is already
	// applied, so that flag stays true whether the snapshot was taken or
	// refused, and a refusal would have been invisible: this would have gone on
	// to apply another run's activity and gates over the held ones. The first
	// version of this guard read the flag, and the harness case that exercises
	// a split identity against a world that ALREADY HAS STATE is what found it.
	const int64 RefusedBefore =
		Cursor.ForeignProjects + Cursor.ForeignRuns + Cursor.StaleRevisions;
	AdoptSnapshot(Hydration.Run, Next);
	if (Cursor.ForeignProjects + Cursor.ForeignRuns + Cursor.StaleRevisions != RefusedBefore)
	{
		return false;
	}

	// AND THE HALVES A SNAPSHOT NEVER CARRIED. This is the whole reason this
	// method exists: the server folds the activity so a rejoining world need
	// not replay the transcript, and nothing applied what it folded.
	Activity = Hydration.Activity;
	HumanGates = Hydration.HumanGates;

	OnJuliusChanged.Broadcast();
	return true;
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

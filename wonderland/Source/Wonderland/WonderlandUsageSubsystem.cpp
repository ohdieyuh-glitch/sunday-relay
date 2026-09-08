#include "WonderlandUsageSubsystem.h"

/* ------------------------------------------------------------ the rule */

EWonderlandOrderingVerdict WonderlandUsagePushVerdict(
	const FString& BoundProjectId,
	int64 HeldRevision,
	bool bHasUsage,
	const FString& PushProjectId,
	const FWonderlandUsageAuthorityStatus& PushAuthority)
{
	// AN UNBOUND CLIENT IS FOREIGN TO EVERYTHING.
	//
	// Not "accepts anything until told otherwise", which is the tempting
	// reading and the dangerous one: a world that had not yet been told its
	// project would adopt whichever reading reached it first and then refuse
	// the real one as foreign. Silence about identity is not permission.
	if (BoundProjectId.IsEmpty() || PushProjectId != BoundProjectId)
	{
		return EWonderlandOrderingVerdict::ForeignProject;
	}

	// MALFORMED BEFORE STALE, because a push claiming revision 0 is not an old
	// reading — it is a reading that never passed through an authority. Ranking
	// it against our cursor would file a structural failure under replay
	// traffic, and the two need different investigations.
	//
	// Revision 1 is the first an authority issues. `Reading` is checked too: a
	// push that reports NotReported is a client's own empty state travelling
	// backwards, never something an authority sends, and applying one would let
	// an unspoken default overwrite figures somebody actually reported.
	if (PushAuthority.Revision < 1 ||
		PushAuthority.Reading == EWonderlandUsageReading::NotReported)
	{
		return EWonderlandOrderingVerdict::Malformed;
	}

	// DUPLICATE IS SPLIT OUT FROM STALE, though both are "not newer".
	//
	// The wire retrying the current revision is healthy; a replica pushing an
	// older one means two sources disagree about where this world is. Collapsed
	// into one counter, a genuinely divergent backend would hide inside routine
	// retry noise.
	//
	// TypeScript's `applyWonderlandUsageReport` does NOT make this split, and
	// the difference is deliberate rather than drift: it applies reports from
	// the source it is already holding, where a repeat is a programming error,
	// while this applies pushes off a network where a repeat is the transport
	// working. Merging the two would mean one of them counting a normal event
	// as a fault. The refusals they share are ordered identically on purpose.
	if (bHasUsage && PushAuthority.Revision == HeldRevision)
	{
		return EWonderlandOrderingVerdict::Duplicate;
	}
	if (bHasUsage && PushAuthority.Revision < HeldRevision)
	{
		return EWonderlandOrderingVerdict::StaleRevision;
	}

	return EWonderlandOrderingVerdict::Applied;
}

/* ------------------------------------------------------- the subsystem */

void UWonderlandUsageSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	// Nothing to start. No socket, no timer, no tick — a subsystem that opened
	// a connection here would be a second transport beside the world's own, and
	// two things fetching the same figures is how they come to disagree.
	//
	// The explanation is set because FWonderlandLinkStatus promises one always:
	// a world that has not connected has to be able to say that, and an empty
	// sentence beside NeverConnected reads as a missing string rather than a
	// fact anybody stated.
	LinkStatus.State = EWonderlandLinkState::NeverConnected;
	LinkStatus.Explanation = TEXT("This world has not connected to Relay yet.");
}

void UWonderlandUsageSubsystem::Deinitialize()
{
	// Cleared on the way out so a game instance that came back could not read a
	// previous session's figures as current. The delegate is cleared too: its
	// listeners are widgets from a world that no longer exists.
	ClearHeldReading();
	BoundProjectId.Reset();
	OnUsageChanged.Clear();

	Super::Deinitialize();
}

void UWonderlandUsageSubsystem::ClearHeldReading()
{
	Usage = FWonderlandUsageHud();
	Authority = FWonderlandUsageAuthorityStatus();
	bUsageApplied = false;
	AppliedRevision = 0;
}

void UWonderlandUsageSubsystem::BindProject(const FString& ProjectId)
{
	if (ProjectId == BoundProjectId)
	{
		return;
	}

	const bool bHadReading = bUsageApplied;
	BoundProjectId = ProjectId;
	ClearHeldReading();

	// Broadcast only if there was something to lose. Binding on a fresh
	// subsystem changes nothing a meter draws, and waking every listener for it
	// would put a redraw on the level-load path for no visible difference.
	if (bHadReading)
	{
		OnUsageChanged.Broadcast();
	}
}

EWonderlandOrderingVerdict UWonderlandUsageSubsystem::ApplyUsage(
	const FString& ProjectId,
	const FWonderlandUsageHud& Hud,
	const FWonderlandUsageAuthorityStatus& InAuthority)
{
	const EWonderlandOrderingVerdict Verdict = WonderlandUsagePushVerdict(
		BoundProjectId, AppliedRevision, bUsageApplied, ProjectId, InAuthority);

	switch (Verdict)
	{
	case EWonderlandOrderingVerdict::ForeignProject:
		++ForeignProjectPushesRejected;
		return Verdict;
	case EWonderlandOrderingVerdict::Malformed:
		++MalformedPushesRejected;
		return Verdict;
	case EWonderlandOrderingVerdict::Duplicate:
		++DuplicatePushesRejected;
		return Verdict;
	case EWonderlandOrderingVerdict::StaleRevision:
		++StaleRevisionPushesRejected;
		return Verdict;
	default:
		break;
	}

	// THE HUD AND ITS AUTHORITY MOVE TOGETHER, ALWAYS.
	//
	// Figures from one revision beside a currency verdict from another is the
	// worst of both: numbers nobody reported labelled with a confidence nobody
	// assigned. They are assigned in one place so there is no path on which one
	// lands without the other.
	Usage = Hud;
	Authority = InAuthority;
	AppliedRevision = InAuthority.Revision;
	bUsageApplied = true;
	++AppliedPushes;

	OnUsageChanged.Broadcast();
	return EWonderlandOrderingVerdict::Applied;
}

void UWonderlandUsageSubsystem::SetLinkStatus(const FWonderlandLinkStatus& Status)
{
	// THE FIGURES ARE NOT TOUCHED HERE, AND THAT IS THE POINT.
	//
	// A lost link does not make the last reading false; it makes it old. The
	// numbers were true at their revision and still are, so they stay, and the
	// world says what its own connection is doing beside them. Clearing on
	// disconnect would turn "we last heard 480 remaining" into "unknown", which
	// is the disconnection-as-completion mistake wearing different clothes —
	// and zeroing them would be worse.
	//
	// Nothing here writes Authority. Relay's verdict about its own figures is
	// Relay's; if the client wants to say they may have moved, it says so in
	// the link status, which is the client's to say.
	if (Status.State == LinkStatus.State &&
		Status.Explanation == LinkStatus.Explanation)
	{
		// The last-snapshot instant still updates: a link that is live and
		// staying live is exactly when it moves, and a listener that redrew for
		// each heartbeat would redraw for nothing.
		LinkStatus.LastSnapshotAtIso = Status.LastSnapshotAtIso;
		return;
	}

	LinkStatus = Status;
	OnUsageChanged.Broadcast();
}

// THE USAGE SUBSYSTEM, COMPILED AND RUN.
//
// There is no Unreal Engine here, so the usual answer would be an editor
// automation test nobody in this repository can execute. Instead this builds
// the REAL subsystem against the syntax stubs and drives it through the
// sequences a live world actually sees: a reconnect delivering an old reading,
// a fan-out delivering somebody else's, a link dropping mid-mission.
//
// WHAT IT PROVES: the ordering rules and the held state. Every claim in
// WonderlandUsageSubsystem.h's header comment is asserted below by exercising
// the code, not by reading it.
//
// WHAT IT CANNOT PROVE: that a widget draws. That needs the engine. The two
// are different claims and this harness only makes the first.

#include "WonderlandUsageSubsystem.h"

#include <cstdio>
#include <string>

static int Failures = 0;
static int Checks = 0;

static void Check(bool Condition, const char* What)
{
	++Checks;
	if (Condition)
	{
		return;
	}
	++Failures;
	std::printf("FAIL %s\n", What);
}

/** An authority status shaped like one Relay would actually project. */
static FWonderlandUsageAuthorityStatus Report(int64 Revision, EWonderlandUsageReading Reading)
{
	FWonderlandUsageAuthorityStatus Status;
	Status.Revision = Revision;
	Status.Reading = Reading;
	return Status;
}

/** A HUD carrying one recognisable figure, so a swap is visible. */
static FWonderlandUsageHud Hud(double CompoundRemaining)
{
	FWonderlandUsageHud Out;
	Out.CompoundAgent.Status = EWonderlandUsageStatus::Available;
	Out.CompoundAgent.RemainingUnits.bKnown = true;
	Out.CompoundAgent.RemainingUnits.Value = CompoundRemaining;
	return Out;
}

static double HeldRemaining(const UWonderlandUsageSubsystem& Subsystem)
{
	return Subsystem.GetUsage().CompoundAgent.RemainingUnits.Value;
}

int main()
{
	FSubsystemCollectionBase Collection;

	/* ------------------------------------------------ nothing said yet */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);

		Check(!S.HasUsage(), "a fresh subsystem holds no usage");
		Check(!S.IsBound(), "a fresh subsystem is bound to no project");
		Check(S.GetAppliedRevision() == 0, "a fresh subsystem holds revision 0");

		// UNKNOWN IS NOT ZERO. The default meters must say Unavailable, so a
		// world that has never been told anything cannot render a full or an
		// empty bar as though it were a measurement.
		Check(S.GetUsage().CompoundAgent.Status == EWonderlandUsageStatus::Unavailable,
			"an untold compound meter is Unavailable, not zero");
		Check(S.GetUsage().SingleAgent.Status == EWonderlandUsageStatus::Unavailable,
			"an untold single meter is Unavailable, not zero");
		Check(!S.GetUsage().CompoundAgent.RemainingUnits.bKnown,
			"an untold compound remainder is unknown, not 0");
		Check(S.GetAuthority().Reading == EWonderlandUsageReading::NotReported,
			"an untold authority reads NotReported");
		Check(S.GetLinkStatus().State == EWonderlandLinkState::NeverConnected,
			"an untold link reads NeverConnected");
		Check(!FString(S.GetLinkStatus().Explanation).IsEmpty(),
			"a never-connected link still explains itself");

		// SILENCE ABOUT IDENTITY IS NOT PERMISSION.
		const EWonderlandOrderingVerdict V =
			S.ApplyUsage(FString("alpha"), Hud(100), Report(1, EWonderlandUsageReading::Known));
		Check(V == EWonderlandOrderingVerdict::ForeignProject,
			"an unbound subsystem refuses every push as foreign");
		Check(!S.HasUsage(), "a refused push leaves an unbound subsystem untold");
		Check(S.GetForeignProjectPushesRejected() == 1, "the refusal is counted as foreign");
	}

	/* --------------------------------------------------- the happy path */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		Check(S.IsBound(), "binding names a project");

		Check(S.ApplyUsage(FString("alpha"), Hud(480), Report(1, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"the first real reading applies");
		Check(S.HasUsage(), "an applied reading is held");
		Check(S.GetAppliedRevision() == 1, "the applied revision is recorded");
		Check(HeldRemaining(S) == 480, "the applied figures are the ones held");
		Check(S.GetAppliedPushes() == 1, "the application is counted");

		Check(S.ApplyUsage(FString("alpha"), Hud(300), Report(2, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"a newer reading applies");
		Check(HeldRemaining(S) == 300, "the newer figures replace the older ones");
		Check(S.GetAppliedRevision() == 2, "the revision advances");

		// STATE MOVES WITHOUT THE HOLDER BEING REBUILT. The same object now
		// carries a different reading; nothing was recreated to make that
		// happen, which is what lets a widget bind once and keep drawing.
		Check(S.GetAppliedPushes() == 2, "both applications went through one holder");
	}

	/* ------------------------------------------------------ the refusals */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(5, EWonderlandUsageReading::Known));

		// A FAN-OUT DELIVERING SOMEBODY ELSE'S SPEND.
		Check(S.ApplyUsage(FString("beta"), Hud(7), Report(9, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::ForeignProject,
			"another project's reading is foreign");
		Check(HeldRemaining(S) == 480, "a foreign reading does not overwrite ours");
		Check(S.GetAppliedRevision() == 5, "a foreign reading does not move the revision");
		Check(S.GetForeignProjectPushesRejected() == 1, "the foreign refusal is counted");

		// A READING THAT NEVER PASSED THROUGH AN AUTHORITY.
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(0, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Malformed,
			"revision 0 is malformed, not merely old");
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(9, EWonderlandUsageReading::NotReported)) ==
				EWonderlandOrderingVerdict::Malformed,
			"a NotReported push is malformed however new it claims to be");
		Check(S.GetMalformedPushesRejected() == 2, "both malformed refusals are counted");
		Check(HeldRemaining(S) == 480, "no malformed reading reached the held figures");

		// THE WIRE RETRYING, WHICH IS HEALTHY.
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(5, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Duplicate,
			"the revision we already hold is a duplicate");
		Check(S.GetDuplicatePushesRejected() == 1, "the duplicate is counted as a duplicate");
		Check(S.GetStaleRevisionPushesRejected() == 0,
			"a duplicate is NOT filed as a stale revision");

		// A REPLICA THAT IS BEHIND, WHICH IS NOT.
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(4, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::StaleRevision,
			"an older revision is stale");
		Check(S.GetStaleRevisionPushesRejected() == 1, "the stale refusal is counted separately");
		Check(HeldRemaining(S) == 480, "a stale reading does not take back a newer one");
		Check(S.GetAppliedPushes() == 1, "none of the refusals counted as an application");
	}

	/* ------------------------------- the link drops, and comes back */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(3, EWonderlandUsageReading::Known));

		FWonderlandLinkStatus Lost;
		Lost.State = EWonderlandLinkState::Stale;
		Lost.Explanation = FString("Contact with Relay was lost.");
		S.SetLinkStatus(Lost);

		// A DISCONNECTION IS NEVER A COMPLETION, AND NEVER A RESET.
		Check(S.HasUsage(), "losing the link does not un-tell the world");
		Check(HeldRemaining(S) == 480, "losing the link does not clear the figures");
		Check(S.GetAppliedRevision() == 3, "losing the link does not move the revision");
		Check(S.GetLinkStatus().State == EWonderlandLinkState::Stale, "the link says it is stale");

		// AND IT NEVER REWRITES WHAT THE AUTHORITY SAID.
		Check(S.GetAuthority().Reading == EWonderlandUsageReading::Known,
			"the client's link trouble does not edit Relay's verdict");

		// RECONNECT REPLAYING AN OLD READING. The classic corruption: a resumed
		// stream re-sends from its own cursor and the world must not rewind.
		Check(S.ApplyUsage(FString("alpha"), Hud(999), Report(2, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::StaleRevision,
			"a reconnect replaying an older revision is refused");
		Check(HeldRemaining(S) == 480, "the replay did not corrupt the held figures");

		FWonderlandLinkStatus Back;
		Back.State = EWonderlandLinkState::Live;
		Back.Explanation = FString("Connected to Relay.");
		S.SetLinkStatus(Back);
		Check(S.ApplyUsage(FString("alpha"), Hud(120), Report(4, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"the first genuinely new reading after a reconnect applies");
		Check(HeldRemaining(S) == 120, "and it is the one held");
	}

	/* ------------------------------------------------- switching worlds */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(6, EWonderlandUsageReading::Known));

		S.BindProject(FString("alpha"));
		Check(S.HasUsage(), "re-binding the same project keeps the reading");
		Check(HeldRemaining(S) == 480, "an idempotent bind costs nothing");

		S.BindProject(FString("beta"));
		Check(!S.HasUsage(), "binding a different project drops the previous reading");
		Check(S.GetAppliedRevision() == 0, "and its revision, so beta's first push is not stale");
		Check(!S.GetUsage().CompoundAgent.RemainingUnits.bKnown,
			"the dropped reading becomes unknown, not zero");

		// The counters are this SESSION's history and survive a rebind: an
		// operator asking why a world looks wrong needs what it refused, not
		// what it refused since the last level change.
		Check(S.GetAppliedPushes() == 1, "the counters survive the rebind");

		Check(S.ApplyUsage(FString("alpha"), Hud(1), Report(7, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::ForeignProject,
			"the previous project's traffic is now foreign");
		Check(S.ApplyUsage(FString("beta"), Hud(50), Report(1, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"beta's first reading applies at revision 1 despite alpha having reached 6");
		Check(HeldRemaining(S) == 50, "and beta's figures are the ones held");
	}

	/* ----------------------------------------------------- teardown */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(1, EWonderlandUsageReading::Known));
		S.Deinitialize();

		Check(!S.HasUsage(), "deinitialising forgets the reading");
		Check(!S.IsBound(), "deinitialising forgets the project");
		Check(S.GetAppliedRevision() == 0, "deinitialising forgets the revision");
	}

	if (Failures > 0)
	{
		std::printf("FAIL %d of %d usage subsystem checks\n", Failures, Checks);
		return 1;
	}
	std::printf("ok   usage subsystem: %d checks\n", Checks);
	return 0;
}

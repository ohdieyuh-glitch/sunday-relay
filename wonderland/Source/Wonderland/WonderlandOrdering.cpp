#include "WonderlandOrdering.h"

namespace
{
	/**
	 * A whole, non-negative position. Mirrors `Number.isSafeInteger(x) && x >= 0`.
	 *
	 * The C++ side gets this for free where TypeScript does not — an int64 is
	 * already whole — so only the sign is left to check. The safe-integer half of
	 * the TypeScript rule guards a hazard that does not exist here, and writing a
	 * range check to "mirror" it would be mirroring a language, not a rule.
	 */
	bool IsPosition(int64 Value)
	{
		return Value >= 0;
	}

	/** A known identity that differs. An unknown one on EITHER side is not a mismatch. */
	bool Conflicts(const FWonderlandText& Held, const FWonderlandText& Arriving)
	{
		return Held.bKnown && Arriving.bKnown && Held.Value != Arriving.Value;
	}
}

EWonderlandOrderingVerdict WonderlandOrderingVerdict(
	const FWonderlandCursor& Cursor,
	const FWonderlandEnvelope& Envelope)
{
	if (Envelope.ProjectId != Cursor.ProjectId)
	{
		return EWonderlandOrderingVerdict::ForeignProject;
	}

	// A cursor that has not yet LEARNED an identity accepts one; it does not
	// refuse everything until told. Identity arrives with the first envelope,
	// and a world that refused that envelope could never learn anything.
	if (Conflicts(Cursor.JuliusInstanceId, Envelope.JuliusInstanceId))
	{
		return EWonderlandOrderingVerdict::ForeignJulius;
	}
	if (Conflicts(Cursor.RunId, Envelope.RunId))
	{
		return EWonderlandOrderingVerdict::ForeignRun;
	}

	if (!IsPosition(Envelope.Sequence) || !IsPosition(Envelope.Revision) || Envelope.EventId.IsEmpty())
	{
		return EWonderlandOrderingVerdict::Malformed;
	}

	if (Cursor.LastEventId.bKnown && Envelope.EventId == Cursor.LastEventId.Value)
	{
		return EWonderlandOrderingVerdict::Duplicate;
	}

	// REVISION BEFORE SEQUENCE. See the header: a stale replica can be ahead on
	// its own stream while the run has moved on.
	if (Envelope.Revision < Cursor.Revision)
	{
		return EWonderlandOrderingVerdict::StaleRevision;
	}
	if (Cursor.bRevisionFromSnapshot && Envelope.Revision == Cursor.Revision)
	{
		return EWonderlandOrderingVerdict::StaleRevision;
	}

	if (Envelope.Sequence <= Cursor.Sequence)
	{
		return EWonderlandOrderingVerdict::StaleSequence;
	}

	return EWonderlandOrderingVerdict::Applied;
}

FWonderlandOrderingOutcome WonderlandApplyOrdering(
	const FWonderlandCursor& Cursor,
	const FWonderlandEnvelope& Envelope)
{
	FWonderlandOrderingOutcome Outcome;
	Outcome.Cursor = Cursor;
	Outcome.Verdict = WonderlandOrderingVerdict(Cursor, Envelope);

	switch (Outcome.Verdict)
	{
	case EWonderlandOrderingVerdict::Duplicate:
		++Outcome.Cursor.Duplicates;
		return Outcome;
	case EWonderlandOrderingVerdict::StaleSequence:
		++Outcome.Cursor.StaleSequences;
		return Outcome;
	case EWonderlandOrderingVerdict::StaleRevision:
		++Outcome.Cursor.StaleRevisions;
		return Outcome;
	case EWonderlandOrderingVerdict::ForeignProject:
		++Outcome.Cursor.ForeignProjects;
		return Outcome;
	case EWonderlandOrderingVerdict::ForeignJulius:
		++Outcome.Cursor.ForeignJulius;
		return Outcome;
	case EWonderlandOrderingVerdict::ForeignRun:
		++Outcome.Cursor.ForeignRuns;
		return Outcome;
	case EWonderlandOrderingVerdict::Malformed:
		++Outcome.Cursor.Malformed;
		return Outcome;
	default:
		break;
	}

	// A GAP ONLY MEANS SOMETHING ONCE WE HAVE A POSITION TO JUMP FROM. The first
	// envelope a world ever sees may carry any sequence — it joined mid-stream —
	// and calling that a gap would report one for every world that ever started.
	const bool bGapped = Cursor.Sequence > 0 && Envelope.Sequence > Cursor.Sequence + 1;

	// IDENTITY IS LEARNED AND NEVER UNLEARNED. An envelope that happened not to
	// name the run does not erase the run we know we are following.
	if (Envelope.JuliusInstanceId.bKnown)
	{
		Outcome.Cursor.JuliusInstanceId = Envelope.JuliusInstanceId;
	}
	if (Envelope.RunId.bKnown)
	{
		Outcome.Cursor.RunId = Envelope.RunId;
	}

	Outcome.Cursor.Sequence = Envelope.Sequence;
	// REVISION ONLY EVER RISES — and on this path the Max is provably a no-op,
	// which is worth saying so nobody hunts for a test that could catch its
	// removal. The guard above refuses anything with a lower revision, so an
	// accepted envelope always carries one at least as high as the cursor's. It
	// is kept because the TypeScript keeps it and this file's whole value is
	// being the same rule: a reader diffing the two should find the same
	// defensive line in the same place, not wonder which one dropped it.
	Outcome.Cursor.Revision = FMath::Max(Cursor.Revision, Envelope.Revision);
	// An accepted EVENT re-establishes the revision from the event stream, so
	// later events at that revision are peers again rather than history.
	Outcome.Cursor.bRevisionFromSnapshot = false;
	Outcome.Cursor.LastEventId.bKnown = true;
	Outcome.Cursor.LastEventId.Value = Envelope.EventId;
	// `OccurredAt` is a bare FString on the envelope and a carrier on the cursor,
	// and the asymmetry is correct: every envelope HAS an instant, and a cursor
	// that has applied nothing has none to report.
	Outcome.Cursor.LastAppliedAtIso.bKnown = true;
	Outcome.Cursor.LastAppliedAtIso.Value = Envelope.OccurredAt;
	++Outcome.Cursor.Applied;
	if (bGapped)
	{
		++Outcome.Cursor.Gaps;
	}

	return Outcome;
}

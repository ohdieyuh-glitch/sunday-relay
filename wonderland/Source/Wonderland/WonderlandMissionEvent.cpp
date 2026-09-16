#include "WonderlandMissionEvent.h"

namespace
{
	/**
	 * event type -> beat, BUILT ONCE FROM THE BEAT TABLE.
	 *
	 * Derived rather than written, so the binding a beat declares beside its visual is the same binding the
	 * adapter uses. A second hand-maintained table is exactly how a visual and its meaning drift apart.
	 */
	const TMap<FName, EWonderlandMissionBeat>& MissionEventMap()
	{
		static TMap<FName, EWonderlandMissionBeat> Map = []
		{
			TMap<FName, EWonderlandMissionBeat> Built;
			for (int32 Index = 0; Index < WonderlandMissionBeatCount; ++Index)
			{
				const EWonderlandMissionBeat Beat = static_cast<EWonderlandMissionBeat>(Index);
				const FString Events = WonderlandBeatReading(Beat).Events;
				if (Events.IsEmpty())
				{
					continue;
				}
				TArray<FString> Parts;
				Events.ParseIntoArray(Parts, TEXT(","), true);
				for (FString& Part : Parts)
				{
					Part.TrimStartAndEndInline();
					if (Part.IsEmpty())
					{
						continue;
					}
					const FName Type(*Part);
					// LOUD, AT STARTUP. One event type claiming two beats would make the adapter a coin toss
					// decided by table order, and the symptom would be a mission that animates almost right.
					checkf(!Built.Contains(Type), TEXT("WLMISSION event type %s is claimed by two beats"), *Part);
					Built.Add(Type, Beat);
				}
			}
			return Built;
		}();
		return Map;
	}

	/** True for a beat no Julius event can currently produce: it may only be shown by a labelled fixture. */
	bool MissionBeatIsGapOnly(EWonderlandMissionBeat Beat)
	{
		return WonderlandBeatAwaitsAnEvent(Beat);
	}
}

const TCHAR* WonderlandRoleName(EWonderlandMissionRole Role)
{
	switch (Role)
	{
	case EWonderlandMissionRole::PromptArchitect:    return TEXT("PROMPT ARCHITECT");
	case EWonderlandMissionRole::CodingAgent:        return TEXT("CODING AGENT");
	case EWonderlandMissionRole::IndependentReviewer:return TEXT("INDEPENDENT REVIEWER");
	default: break;
	}
	return TEXT("RUN");
}

const TCHAR* WonderlandEventVerdictName(EWonderlandEventVerdict Verdict)
{
	switch (Verdict)
	{
	case EWonderlandEventVerdict::Applied:              return TEXT("applied");
	case EWonderlandEventVerdict::Unmodelled:           return TEXT("unmodelled");
	case EWonderlandEventVerdict::ForeignMission:       return TEXT("foreign mission");
	case EWonderlandEventVerdict::Stale:                return TEXT("stale");
	case EWonderlandEventVerdict::RefusedAfterEnding:   return TEXT("refused after ending");
	case EWonderlandEventVerdict::RefusedUnlabelledGap: return TEXT("refused unlabelled gap");
	default: break;
	}
	return TEXT("unknown");
}

EWonderlandMissionBeat WonderlandBeatForEventType(FName Type)
{
	const EWonderlandMissionBeat* Found = MissionEventMap().Find(Type);
	return Found != nullptr ? *Found : EWonderlandMissionBeat::Unobserved;
}

void WonderlandKnownEventTypes(TArray<FName>& Out)
{
	MissionEventMap().GenerateKeyArray(Out);
	Out.Sort(FNameLexicalLess());
}

EWonderlandEventVerdict WonderlandApplyEvent(FWonderlandMissionFold& Fold, const FWonderlandMissionEvent& Event)
{
	const EWonderlandMissionBeat Candidate = WonderlandBeatForEventType(Event.Type);
	const bool bStartsAMission = Candidate == EWonderlandMissionBeat::MissionStart;

	if (Event.Sequence <= Fold.Sequence)
	{
		++Fold.Stale;
		return EWonderlandEventVerdict::Stale;
	}

	// ---------------------------------------------------------------- a finished contract makes way
	// CHECKED BEFORE THE MISSION-ID GUARD, and that order is the whole point: the NEXT mission has a
	// different id by definition -- that is what makes it the next mission rather than more of this one.
	// Checking identity first would reject every second mission as foreign, which is exactly what it did
	// until a replay of the two-mission fixture caught it.
	//
	// The replacement is what makes a new Mission Contract start at red: everything the last one
	// accumulated goes, and only the counters survive, because they describe the stream and not the mission.
	if (Fold.bEnded && bStartsAMission)
	{
		Fold.MissionId = Event.MissionId;
		Fold.Sequence = Event.Sequence;
		Fold.Chakra = WonderlandChakraForBeat(Candidate, EWonderlandChakra::None);
		Fold.Beat = Candidate;
		Fold.RepairRounds = Event.RepairRound;
		Fold.bEnded = WonderlandBeatReading(Candidate).bTerminal;
		++Fold.Applied;
		return EWonderlandEventVerdict::Applied;
	}

	// ---------------------------------------------------------------- whose mission is this
	// A fold with no mission yet adopts the first one it is given; after that it is that mission's and no
	// other's. This is the whole of cross-mission isolation, and it is one comparison on purpose.
	if (Fold.MissionId.IsNone())
	{
		Fold.MissionId = Event.MissionId;
	}
	else if (Fold.MissionId != Event.MissionId)
	{
		++Fold.Foreign;
		return EWonderlandEventVerdict::ForeignMission;
	}

	const bool bGapOnly = MissionBeatIsGapOnly(Candidate) || Candidate == EWonderlandMissionBeat::Unobserved;

	// An event nothing claims, and which is not a labelled stand-in for a gap, is simply not ours.
	if (Candidate == EWonderlandMissionBeat::Unobserved && !Event.bSimulationOnly)
	{
		++Fold.Unmodelled;
		return EWonderlandEventVerdict::Unmodelled;
	}

	// ---------------------------------------------------------------- after an ending
	// Only one thing is still allowed once a mission has ended and it is not a new contract: A SECOND
	// REPORT OF THE SAME ENDING. A real stream sends `run.verified` and then `run.completed`, and both mean
	// the mission finished; refusing the second would count an ordinary, correct stream as contradicting
	// itself. It is corroboration, not progress, and it moves nothing.
	//
	// Everything else is refused, which is the whole of the block rule: `coder.started` after a block would
	// let a stopped mission carry on showing progress, and that is the one thing a blocked world must not do.
	if (Fold.bEnded && Candidate != Fold.Beat)
	{
		++Fold.RefusedAfterEnding;
		return EWonderlandEventVerdict::RefusedAfterEnding;
	}

	// ---------------------------------------------------------------- a beat Julius cannot emit
	if (bGapOnly && !Event.bSimulationOnly)
	{
		++Fold.RefusedUnlabelledGap;
		return EWonderlandEventVerdict::RefusedUnlabelledGap;
	}

	// ---------------------------------------------------------------- apply
	Fold.Sequence = Event.Sequence;
	Fold.Beat = Candidate;
	Fold.Chakra = WonderlandChakraForBeat(Candidate, Fold.Chakra);
	Fold.RepairRounds = FMath::Max(Fold.RepairRounds, Event.RepairRound);
	Fold.bEnded = WonderlandBeatReading(Candidate).bTerminal;
	++Fold.Applied;
	if (bGapOnly)
	{
		++Fold.SimulatedBeats;
	}
	return EWonderlandEventVerdict::Applied;
}

EWonderlandEventVerdict WonderlandApplySimulatedEvent(FWonderlandMissionFold& Fold, const FWonderlandMissionEvent& Event)
{
	// Not flagged means not ours. This is the guard that stops the simulated path becoming a second door
	// into the fold that real events could wander through.
	if (!Event.bSimulationOnly)
	{
		++Fold.RefusedUnlabelledGap;
		return EWonderlandEventVerdict::RefusedUnlabelledGap;
	}
	const EWonderlandMissionBeat Beat = WonderlandBeatFromId(Event.Status);
	if (Beat == EWonderlandMissionBeat::Unobserved)
	{
		++Fold.Unmodelled;
		return EWonderlandEventVerdict::Unmodelled;
	}
	if (Fold.MissionId.IsNone())
	{
		Fold.MissionId = Event.MissionId;
	}
	else if (Fold.MissionId != Event.MissionId)
	{
		++Fold.Foreign;
		return EWonderlandEventVerdict::ForeignMission;
	}
	if (Event.Sequence <= Fold.Sequence)
	{
		++Fold.Stale;
		return EWonderlandEventVerdict::Stale;
	}
	if (Fold.bEnded)
	{
		++Fold.RefusedAfterEnding;
		return EWonderlandEventVerdict::RefusedAfterEnding;
	}
	Fold.Sequence = Event.Sequence;
	Fold.Beat = Beat;
	Fold.Chakra = WonderlandChakraForBeat(Beat, Fold.Chakra);
	Fold.bEnded = WonderlandBeatReading(Beat).bTerminal;
	++Fold.Applied;
	++Fold.SimulatedBeats;
	return EWonderlandEventVerdict::Applied;
}

FString WonderlandDescribeFold(const FWonderlandMissionFold& Fold)
{
	return FString::Printf(
		TEXT("%s beat=%s chakra=%s(%d) seq=%lld repairs=%d ended=%s applied=%d unmodelled=%d foreign=%d stale=%d refused_ended=%d refused_gap=%d simulated=%d"),
		*Fold.MissionId.ToString(), *WonderlandBeatId(Fold.Beat).ToString(),
		WonderlandChakraName(Fold.Chakra), WonderlandChakraStep(Fold.Chakra),
		Fold.Sequence, Fold.RepairRounds, Fold.bEnded ? TEXT("yes") : TEXT("no"),
		Fold.Applied, Fold.Unmodelled, Fold.Foreign, Fold.Stale,
		Fold.RefusedAfterEnding, Fold.RefusedUnlabelledGap, Fold.SimulatedBeats);
}

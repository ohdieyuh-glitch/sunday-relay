#include "WonderlandMissionFixture.h"

namespace
{
	using FixtureRole = EWonderlandMissionRole;

	/** A builder that numbers events as it goes, so a fixture reads as a story and cannot skip a sequence. */
	struct FMissionStream
	{
		FName MissionId;
		FName RunId;
		FName TaskId;
		int64 Next = 0;
		int32 RepairRound = 0;
		TArray<FWonderlandMissionEvent>* Out = nullptr;

		FMissionStream& On(FName Task)
		{
			TaskId = Task;
			return *this;
		}

		FMissionStream& Repair(int32 Round)
		{
			RepairRound = Round;
			return *this;
		}

		/** A real Julius event. */
		FMissionStream& Emit(const TCHAR* Type, FixtureRole Role = FixtureRole::None, const TCHAR* Verdict = nullptr)
		{
			FWonderlandMissionEvent Event;
			Event.Type = FName(Type);
			Event.MissionId = MissionId;
			Event.RunId = RunId;
			Event.TaskId = TaskId;
			Event.Role = Role;
			Event.Sequence = ++Next;
			Event.RepairRound = RepairRound;
			if (Verdict != nullptr)
			{
				Event.Verdict = FName(Verdict);
			}
			Out->Add(Event);
			return *this;
		}

		/**
		 * A beat Julius cannot currently emit, shown anyway and SAID SO.
		 *
		 * The type is spelled as a wish rather than as a fact -- `simulated.handoff`, not `handoff` -- so
		 * that nobody reading a stream later mistakes it for something the kernel produced, and so that it
		 * can never accidentally match a real type.
		 */
		FMissionStream& Simulate(const TCHAR* Type, EWonderlandMissionBeat AsBeat)
		{
			FWonderlandMissionEvent Event;
			Event.Type = FName(Type);
			Event.MissionId = MissionId;
			Event.RunId = RunId;
			Event.TaskId = TaskId;
			Event.Sequence = ++Next;
			Event.RepairRound = RepairRound;
			Event.bSimulationOnly = true;
			// The fold resolves a type to a beat; a simulated one carries the beat in its status so the
			// adapter's own map stays the only place real types are read.
			Event.Status = WonderlandBeatId(AsBeat);
			Out->Add(Event);
			return *this;
		}
	};

	/**
	 * THE FULL LIFECYCLE, with one repair round.
	 *
	 * Read the chakra down the right: it climbs to blue, FALLS BACK to green when the reviewer sends the
	 * work in for repair, climbs again through a re-review, and finishes at violet.
	 */
	FWonderlandMissionFixture BuildFullLifecycle()
	{
		FWonderlandMissionFixture F;
		F.Id = TEXT("full_lifecycle");
		F.Title = TEXT("A whole task, with one repair");
		F.Purpose = TEXT("Contract to verified completion, including a review that sends the work back.");
		FMissionStream S{TEXT("alpha"), TEXT("run-alpha-1"), TEXT("task-1"), 0, 0, &F.Events};

		S.On(TEXT("task-1"))
		 .Emit(TEXT("run.started"))                                            // RED      1
		 .Emit(TEXT("mission.contract.locked"))                                // RED      1
		 .Emit(TEXT("research.requested"), FixtureRole::PromptArchitect)       // ORANGE   2
		 .Emit(TEXT("research.served"), FixtureRole::PromptArchitect)          // ORANGE   2
		 .Simulate(TEXT("simulated.handoff"), EWonderlandMissionBeat::Handoff) // holds    2
		 .Emit(TEXT("architect.started"), FixtureRole::PromptArchitect)        // YELLOW   3
		 .Emit(TEXT("architect.guidance"), FixtureRole::PromptArchitect)       // holds    3
		 .Simulate(TEXT("simulated.handoff"), EWonderlandMissionBeat::Handoff) // holds    3
		 .Emit(TEXT("coder.started"), FixtureRole::CodingAgent)                // GREEN    4
		 .Emit(TEXT("task.paused"))                                            // holds    4
		 .Simulate(TEXT("simulated.approval"), EWonderlandMissionBeat::ApprovalContinue)
		 .Emit(TEXT("coder.started"), FixtureRole::CodingAgent)                // GREEN    4
		 .Simulate(TEXT("simulated.handoff"), EWonderlandMissionBeat::Handoff) // holds    4
		 .Emit(TEXT("review.started"), FixtureRole::IndependentReviewer)       // BLUE     5
		 .Emit(TEXT("review.challenge"), FixtureRole::IndependentReviewer, TEXT("warning"))
		 .Emit(TEXT("review.repair_required"), FixtureRole::IndependentReviewer, TEXT("repair_required"))
		 .Repair(1)
		 .Emit(TEXT("repair.started"), FixtureRole::CodingAgent)               // GREEN    4
		 .Emit(TEXT("review.started"), FixtureRole::IndependentReviewer)       // BLUE     5  re-review
		 .Emit(TEXT("repair.completed"), FixtureRole::CodingAgent)             // INDIGO   6
		 .Emit(TEXT("task.verified"), FixtureRole::IndependentReviewer, TEXT("pass"))
		 .Emit(TEXT("run.verified"))                                           // VIOLET   7
		 .Emit(TEXT("run.completed"));                                         // VIOLET   7
		return F;
	}

	/**
	 * A MISSION STOPPED BY A BLOCK, and then pushed.
	 *
	 * The last three events would each have advanced a running mission. They are refused, and the fold's
	 * RefusedAfterEnding counter is the proof -- a blocked world that kept animating forward would be
	 * telling a more comfortable story than the run's.
	 */
	FWonderlandMissionFixture BuildBlocked()
	{
		FWonderlandMissionFixture F;
		F.Id = TEXT("blocked");
		F.Title = TEXT("A mission that is blocked, and stays blocked");
		F.Purpose = TEXT("Progression freezes, and later events that would advance it are refused.");
		FMissionStream S{TEXT("bravo"), TEXT("run-bravo-1"), TEXT("task-1"), 0, 0, &F.Events};

		S.Emit(TEXT("run.started"))                                            // RED      1
		 .Emit(TEXT("architect.started"), FixtureRole::PromptArchitect)        // YELLOW   3
		 .Emit(TEXT("coder.started"), FixtureRole::CodingAgent)                // GREEN    4
		 .Emit(TEXT("review.started"), FixtureRole::IndependentReviewer)       // BLUE     5
		 .Emit(TEXT("review.block"), FixtureRole::IndependentReviewer, TEXT("block"))
		 // everything from here is refused
		 .Emit(TEXT("repair.started"), FixtureRole::CodingAgent)
		 .Emit(TEXT("task.verified"), FixtureRole::IndependentReviewer)
		 .Emit(TEXT("run.completed"));
		return F;
	}

	/** Two missions in a row. The second must begin at red with nothing carried over from the first. */
	FWonderlandMissionFixture BuildTwoMissions()
	{
		FWonderlandMissionFixture F;
		F.Id = TEXT("two_missions");
		F.Title = TEXT("One mission to violet, then the next");
		F.Purpose = TEXT("A new Mission Contract resets to red; a repair does not.");
		FMissionStream A{TEXT("alpha"), TEXT("run-alpha-1"), TEXT("task-1"), 0, 0, &F.Events};
		A.Emit(TEXT("run.started"))
		 .Emit(TEXT("architect.started"), FixtureRole::PromptArchitect)
		 .Emit(TEXT("coder.started"), FixtureRole::CodingAgent)
		 .Emit(TEXT("review.started"), FixtureRole::IndependentReviewer)
		 .Emit(TEXT("task.verified"), FixtureRole::IndependentReviewer, TEXT("pass"))
		 .Emit(TEXT("run.verified"));                                          // VIOLET 7

		// A SECOND CONTRACT, with its own id. It continues the sequence so the stream stays ordered, but
		// the fold treats a mission start after an ending as a fresh contract and clears the progression.
		FMissionStream B{TEXT("charlie"), TEXT("run-charlie-1"), TEXT("task-1"), A.Next, 0, &F.Events};
		B.Emit(TEXT("run.started"))                                            // RED 1 again
		 .Emit(TEXT("architect.started"), FixtureRole::PromptArchitect);       // YELLOW 3
		return F;
	}

	/**
	 * TWO MISSIONS ON ONE STREAM, interleaved.
	 *
	 * Only alpha's events may move alpha. Every delta event is counted as foreign and changes nothing,
	 * which is the whole of cross-mission isolation stated as a test rather than as an intention.
	 */
	FWonderlandMissionFixture BuildCrossed()
	{
		FWonderlandMissionFixture F;
		F.Id = TEXT("crossed");
		F.Title = TEXT("Two Mission Contracts on one stream");
		F.Purpose = TEXT("An event for one mission cannot move another's contract.");
		int64 Seq = 0;
		auto Add = [&F, &Seq](const TCHAR* Mission, const TCHAR* Type)
		{
			FWonderlandMissionEvent Event;
			Event.Type = FName(Type);
			Event.MissionId = FName(Mission);
			Event.RunId = FName(*FString::Printf(TEXT("run-%s"), Mission));
			Event.TaskId = TEXT("task-1");
			Event.Sequence = ++Seq;
			F.Events.Add(Event);
		};
		Add(TEXT("alpha"), TEXT("run.started"));
		Add(TEXT("delta"), TEXT("run.started"));
		Add(TEXT("alpha"), TEXT("architect.started"));
		Add(TEXT("delta"), TEXT("coder.started"));
		Add(TEXT("delta"), TEXT("review.started"));
		Add(TEXT("alpha"), TEXT("coder.started"));
		Add(TEXT("delta"), TEXT("run.verified"));
		Add(TEXT("alpha"), TEXT("review.started"));
		return F;
	}

	const TArray<FWonderlandMissionFixture>& MissionFixtures()
	{
		static TArray<FWonderlandMissionFixture> All = []
		{
			TArray<FWonderlandMissionFixture> Built;
			Built.Add(BuildFullLifecycle());
			Built.Add(BuildBlocked());
			Built.Add(BuildTwoMissions());
			Built.Add(BuildCrossed());
			return Built;
		}();
		return All;
	}
}

int32 WonderlandMissionFixtureCount()
{
	return MissionFixtures().Num();
}

const FWonderlandMissionFixture& WonderlandMissionFixtureAt(int32 Index)
{
	const TArray<FWonderlandMissionFixture>& All = MissionFixtures();
	return All[FMath::Clamp(Index, 0, All.Num() - 1)];
}

const FWonderlandMissionFixture* WonderlandMissionFixture(FName Id)
{
	for (const FWonderlandMissionFixture& Fixture : MissionFixtures())
	{
		if (Fixture.Id == Id)
		{
			return &Fixture;
		}
	}
	return nullptr;
}

void WonderlandReplayFixture(const FWonderlandMissionFixture& Fixture, FWonderlandMissionFold& OutFold,
	TArray<EWonderlandMissionBeat>* OutBeats, TArray<int32>* OutChakraSteps, TArray<EWonderlandEventVerdict>* OutVerdicts)
{
	OutFold = FWonderlandMissionFold();
	for (const FWonderlandMissionEvent& Event : Fixture.Events)
	{
		const EWonderlandEventVerdict Verdict = Event.bSimulationOnly
			? WonderlandApplySimulatedEvent(OutFold, Event)
			: WonderlandApplyEvent(OutFold, Event);

		if (OutVerdicts != nullptr)
		{
			OutVerdicts->Add(Verdict);
		}
		if (OutBeats != nullptr)
		{
			OutBeats->Add(OutFold.Beat);
		}
		if (OutChakraSteps != nullptr)
		{
			OutChakraSteps->Add(WonderlandChakraStep(OutFold.Chakra));
		}
	}
}

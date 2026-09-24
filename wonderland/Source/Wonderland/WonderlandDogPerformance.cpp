#include "WonderlandDogPerformance.h"

namespace WonderlandDogPerformanceDetail
{
	using DogAct = EWonderlandDogAct;
	using DogProp = EWonderlandDogProp;

	FWonderlandDogActReading Row(DogAct Act, const TCHAR* Label, const TCHAR* Meaning, DogProp Prop)
	{
		FWonderlandDogActReading R;
		R.Act = Act;
		R.Label = Label;
		R.Meaning = Meaning;
		R.Prop = Prop;
		return R;
	}

	/** Every performance, as one table, in the enum's order. Read a row as the founder's sentence for the stage. */
	const TArray<FWonderlandDogActReading>& Table()
	{
		static const TArray<FWonderlandDogActReading> Acts = []
		{
			TArray<FWonderlandDogActReading> T;
			T.Add(Row(DogAct::None, TEXT("NONE"), TEXT("Whatever the Dog was already doing."), DogProp::None));

			FWonderlandDogActReading Prepare = Row(DogAct::FloatingActivation, TEXT("PREPARATION"),
				TEXT("Julius meditates and gathers the energy the Mission Contract appears from."), DogProp::None);
			Prepare.bMeditates = true;
			T.Add(Prepare);

			FWonderlandDogActReading Research = Row(DogAct::ReadingTheBook, TEXT("RESEARCH"),
				TEXT("Reading the book in its hands, circling the Mission Contract."), DogProp::Book);
			Research.bReadsTheBook = true;
			Research.bOrbitsTheContract = true;
			Research.OrbitPace = 1.0f;
			Research.OrbitSide = 1;
			T.Add(Research);

			FWonderlandDogActReading Implement = Row(DogAct::PaintingTheWork, TEXT("IMPLEMENTATION"),
				TEXT("Painting the creation into existence, circling the Mission Contract."), DogProp::Paintbrush);
			Implement.bPaints = true;
			Implement.bOrbitsTheContract = true;
			Implement.OrbitPace = 0.8f;
			Implement.OrbitSide = 0;
			T.Add(Implement);

			FWonderlandDogActReading Verify = Row(DogAct::VerificationBeam, TEXT("VERIFICATION"),
				TEXT("Airborne, holding the verification beam on the Mission Contract."), DogProp::None);
			Verify.bFlies = true;
			Verify.bFacesTheContract = true;
			Verify.bBeamsTheContract = true;
			T.Add(Verify);

			FWonderlandDogActReading Review = Row(DogAct::InspectingTheWork, TEXT("REVIEW"),
				TEXT("Examining the work through the lens, not adding to it."), DogProp::MagnifyingGlass);
			Review.bInspects = true;
			Review.bOrbitsTheContract = true;
			Review.OrbitPace = 0.34f;
			Review.OrbitSide = 0;
			T.Add(Review);

			FWonderlandDogActReading Repair = Row(DogAct::CorrectingTheWork, TEXT("REPAIR"),
				TEXT("Identifying the incorrect section, erasing it, and repainting it."), DogProp::Paintbrush);
			Repair.bCorrects = true;
			Repair.bFacesTheContract = true;
			T.Add(Repair);
			return T;
		}();
		return Acts;
	}
}

const FWonderlandDogActReading& WonderlandDogActReading(EWonderlandDogAct Act)
{
	const TArray<FWonderlandDogActReading>& Acts = WonderlandDogPerformanceDetail::Table();
	const int32 Index = static_cast<int32>(Act);
	// TOTAL. An act this build does not know performs as None rather than reading off the end.
	return Acts[(Index >= 0 && Index < Acts.Num()) ? Index : 0];
}

EWonderlandDogAct WonderlandDogActForBeat(EWonderlandMissionBeat Beat)
{
	switch (Beat)
	{
	case EWonderlandMissionBeat::MissionStart:
		return EWonderlandDogAct::FloatingActivation;

	// RESEARCH AND PLANNING ARE BOTH THE BOOK, and guidance is the same study continuing.
	case EWonderlandMissionBeat::Researching:
	case EWonderlandMissionBeat::PromptArchitectActive:
	case EWonderlandMissionBeat::Guidance:
		return EWonderlandDogAct::ReadingTheBook;

	case EWonderlandMissionBeat::CodingAgentActive:
		return EWonderlandDogAct::PaintingTheWork;

	case EWonderlandMissionBeat::Verifying:
		return EWonderlandDogAct::VerificationBeam;

	// REVIEW NEVER INHERITS IMPLEMENTATION. CHALLENGE stays in the review family.
	case EWonderlandMissionBeat::IndependentReviewerActive:
	case EWonderlandMissionBeat::ReviewChallenge:
		return EWonderlandDogAct::InspectingTheWork;

	// REPAIR IS CORRECTIVE. RepairRequired is the moment the fault is named, and belongs with the repair.
	case EWonderlandMissionBeat::RepairRequired:
	case EWonderlandMissionBeat::Repairing:
		return EWonderlandDogAct::CorrectingTheWork;

	// TRANSITIONS AND ENDINGS. Handoff, checkpoint and a non-terminal approval inherit; block, error, complete and idle
	// are told apart by the contract pointer going null.
	default:
		break;
	}
	return EWonderlandDogAct::None;
}

EWonderlandDogAct WonderlandDogActForTaskState(EWonderlandTaskState State)
{
	switch (State)
	{
	case EWonderlandTaskState::Preparation:    return EWonderlandDogAct::FloatingActivation;
	case EWonderlandTaskState::Research:       return EWonderlandDogAct::ReadingTheBook;
	case EWonderlandTaskState::Implementation: return EWonderlandDogAct::PaintingTheWork;
	case EWonderlandTaskState::Verification:   return EWonderlandDogAct::VerificationBeam;
	case EWonderlandTaskState::Review:         return EWonderlandDogAct::InspectingTheWork;
	case EWonderlandTaskState::Repair:         return EWonderlandDogAct::CorrectingTheWork;
	// DRAFT, QUEUED, COMPLETED, FAILED and PAUSED are not performances. A contract waiting to be reached has
	// nothing to act out, and a finished one must SETTLE rather than hold its last pose forever.
	default:                                   return EWonderlandDogAct::None;
	}
}

const TCHAR* WonderlandDogActName(EWonderlandDogAct Act)
{
	return WonderlandDogActReading(Act).Label;
}

const TCHAR* WonderlandDogPropName(EWonderlandDogProp Prop)
{
	switch (Prop)
	{
	case EWonderlandDogProp::Book:            return TEXT("BOOK");
	case EWonderlandDogProp::Paintbrush:      return TEXT("PAINTBRUSH");
	case EWonderlandDogProp::MagnifyingGlass: return TEXT("LENS");
	case EWonderlandDogProp::Scraper:         return TEXT("SCRAPER");
	default: break;
	}
	return TEXT("NONE");
}

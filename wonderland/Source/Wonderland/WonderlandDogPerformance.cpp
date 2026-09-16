#include "WonderlandDogPerformance.h"

namespace
{
	using DogAct = EWonderlandDogAct;
	using DogProp = EWonderlandDogProp;

	/**
	 * Every performance, as one table. Read a row as a sentence: this act looks like THIS, holds THAT,
	 * moves the body this far, and either walks the contract, beams it, or works at it.
	 */
	const FWonderlandDogActReading GDogActs[] = {

	{ DogAct::None, TEXT("NONE"), TEXT("Whatever the Dog was already doing."),
	  DogProp::None, 0.0f, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false, false, false, false, 0.0f },

	// THE FOUNDER'S ACTIVATION, and the one most easily got wrong: this is NOT meditation. The body leaves
	// the ground entirely, upright and open, the head goes UP, and the forearms reach out and about 35
	// degrees down -- between hanging and a T-pose, which is the whole shape of the note.
	{ DogAct::FloatingActivation, TEXT("MISSION START"),
	  TEXT("Julius is activating and entering the Mission Contract."),
	  DogProp::None,
	  /* lift */ 64.0f, /* hover */ 5.0f, /* period */ 3.6f,
	  /* head up */ -26.0f, /* arms down */ 35.0f, /* arms out */ 22.0f,
	  /* work */ 0.0f, 0.0f, false, false, false, false, 0.0f },

	// READING, never writing, and MOVING: the Dog circles the contract while it studies. A Dog standing
	// beside the orb holding a book is the thing the founder specifically did not want.
	{ DogAct::ReadingTheBook, TEXT("PLANNING"),
	  TEXT("Studying the mission, understanding the requirements, building the plan."),
	  DogProp::Book,
	  0.0f, 0.0f, 4.0f,
	  /* head down at the pages */ 22.0f, /* arms forward and a little down */ 18.0f, 10.0f,
	  /* pages turn */ 5.0f, 0.22f, /* orbits */ true, false, /* two hands */ true, false, 0.0f },

	// WORKING, not holding. The swing is the stroke, and it is big enough to read from the play camera.
	{ DogAct::PaintingTheWork, TEXT("IMPLEMENTING"),
	  TEXT("The Compound Agent painting the creation into existence."),
	  DogProp::Paintbrush,
	  0.0f, 0.0f, 4.0f,
	  /* head follows the stroke */ 10.0f, -18.0f, 16.0f,
	  /* strokes */ 34.0f, 0.62f, /* moves while creating */ true, false, false, false, 0.0f },

	// A STANCE AND A BEAM. Still, level, facing the contract, arms forward -- everything about the pose
	// says holding steady, because the beam is the action and a busy body would fight it.
	{ DogAct::VerificationBeam, TEXT("VERIFYING"),
	  TEXT("Checking the work against the Mission Contract."),
	  DogProp::None,
	  0.0f, 1.5f, 5.0f,
	  /* level */ -4.0f, /* arms forward */ 8.0f, 14.0f,
	  0.0f, 0.0f, false, /* beams */ true, false, false, 0.0f },

	// LOOKING, NOT MAKING. The lens comes up to the eye and the head goes down at the work; the walk is
	// slower than the reading circle, because an inspection lingers where a study paces.
	{ DogAct::InspectingTheWork, TEXT("REVIEW"),
	  TEXT("The work is being examined against the contract, not added to."),
	  DogProp::MagnifyingGlass,
	  0.0f, 0.0f, 4.0f,
	  /* head at the work */ 18.0f, /* lens up to the eye */ -34.0f, 8.0f,
	  /* a slow sweep of the lens */ 12.0f, 0.18f,
	  /* circles, slowly */ true, false, false, false, 0.0f },

	// THE BRUSH COMES BACK, and that is the whole risk: a repair that merely painted would be
	// implementation wearing another label. The CYCLE is what separates them -- find, erase, repaint --
	// so this carries a period, and its stroke is larger and rarer than a build stroke.
	{ DogAct::CorrectingTheWork, TEXT("REPAIR"),
	  TEXT("Finding what failed, taking it out, and putting it back."),
	  DogProp::Paintbrush,
	  0.0f, 0.0f, 4.0f,
	  /* head down at the fault */ 16.0f, -22.0f, 12.0f,
	  /* bigger and slower than a build stroke */ 46.0f, 0.34f,
	  /* stays at the fault rather than circling */ false, false, false,
	  /* corrects */ true, /* one find-erase-repaint */ 2.6f },
	};
}

const FWonderlandDogActReading& WonderlandDogActReading(EWonderlandDogAct Act)
{
	const int32 Index = static_cast<int32>(Act);
	const int32 Count = UE_ARRAY_COUNT(GDogActs);
	// TOTAL. An act this build does not know performs as None rather than reading off the end.
	return GDogActs[(Index >= 0 && Index < Count) ? Index : 0];
}

EWonderlandDogAct WonderlandDogActForBeat(EWonderlandMissionBeat Beat)
{
	switch (Beat)
	{
	case EWonderlandMissionBeat::MissionStart:
		return EWonderlandDogAct::FloatingActivation;

	// RESEARCH AND PLANNING ARE BOTH THE BOOK, and guidance is the same study continuing in flight, so it
	// stays open rather than snapping shut and back.
	case EWonderlandMissionBeat::Researching:
	case EWonderlandMissionBeat::PromptArchitectActive:
	case EWonderlandMissionBeat::Guidance:
		return EWonderlandDogAct::ReadingTheBook;

	case EWonderlandMissionBeat::CodingAgentActive:
		return EWonderlandDogAct::PaintingTheWork;

	case EWonderlandMissionBeat::Verifying:
		return EWonderlandDogAct::VerificationBeam;

	// REVIEW DOES NOT INHERIT IMPLEMENTATION (founder, 2026-09-16). These used to fall through to `None`
	// and therefore keep the brush, which had the Compound Agent painting while its own work was being
	// reviewed. CHALLENGE stays in the review family rather than dropping back to the brush.
	case EWonderlandMissionBeat::IndependentReviewerActive:
	case EWonderlandMissionBeat::ReviewChallenge:
		return EWonderlandDogAct::InspectingTheWork;

	// REPAIR IS CORRECTIVE, not more implementation. RepairRequired is the moment the fault is named, and
	// it belongs with the repair rather than with the review that found it.
	case EWonderlandMissionBeat::RepairRequired:
	case EWonderlandMissionBeat::Repairing:
		return EWonderlandDogAct::CorrectingTheWork;

	// WHAT IS LEFT HERE IS TRANSITIONS AND ENDINGS, and nothing else.
	//
	// Handoff, waiting/checkpoint and a non-terminal approval inherit, because nothing about the WORK has
	// changed -- that is the founder's line, and it is why removing the handoff animation needs no case,
	// no deletion from the shared clip vocabulary, and no change to Julius's own handoff events.
	//
	// Block, error, complete and idle land here too, and are told apart from a transition by the contract
	// pointer going null rather than by this table: an ending has no contract, so the body stops.
	default:
		break;
	}
	return EWonderlandDogAct::None;
}

const TCHAR* WonderlandDogActName(EWonderlandDogAct Act)
{
	return WonderlandDogActReading(Act).Label;
}

const TCHAR* WonderlandDogPropName(EWonderlandDogProp Prop)
{
	switch (Prop)
	{
	case EWonderlandDogProp::Book:       return TEXT("BOOK");
	case EWonderlandDogProp::Paintbrush: return TEXT("PAINTBRUSH");
	case EWonderlandDogProp::MagnifyingGlass: return TEXT("LENS");
	default: break;
	}
	return TEXT("NONE");
}

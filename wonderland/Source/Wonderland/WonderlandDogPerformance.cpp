#include "WonderlandDogPerformance.h"

namespace
{
	using DogAct = EWonderlandDogAct;
	using DogProp = EWonderlandDogProp;

	/**
	 * The four, as one table. Read a row as a sentence: this act looks like THIS, holds THAT, moves the
	 * body this far, and either walks the contract or beams it.
	 */
	const FWonderlandDogActReading GDogActs[] = {

	{ DogAct::None, TEXT("NONE"), TEXT("Whatever the Dog was already doing."),
	  DogProp::None, 0.0f, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false, false },

	// THE FOUNDER'S ACTIVATION, and the one most easily got wrong: this is NOT meditation. The body leaves
	// the ground entirely, upright and open, the head goes UP, and the forearms reach out and about 35
	// degrees down -- between hanging and a T-pose, which is the whole shape of the note.
	{ DogAct::FloatingActivation, TEXT("MISSION START"),
	  TEXT("Julius is activating and entering the Mission Contract."),
	  DogProp::None,
	  /* lift */ 64.0f, /* hover */ 5.0f, /* period */ 3.6f,
	  /* head up */ -26.0f, /* arms down */ 35.0f, /* arms out */ 22.0f,
	  /* work */ 0.0f, 0.0f, false, false },

	// READING, never writing, and MOVING: the Dog circles the contract while it studies. A Dog standing
	// beside the orb holding a book is the thing the founder specifically did not want.
	{ DogAct::ReadingTheBook, TEXT("PLANNING"),
	  TEXT("Studying the mission, understanding the requirements, building the plan."),
	  DogProp::Book,
	  0.0f, 0.0f, 4.0f,
	  /* head down at the pages */ 22.0f, /* arms forward and a little down */ 18.0f, 10.0f,
	  /* pages turn */ 5.0f, 0.22f, /* orbits */ true, false },

	// WORKING, not holding. The swing is the stroke, and it is big enough to read from the play camera.
	{ DogAct::PaintingTheWork, TEXT("IMPLEMENTING"),
	  TEXT("The Compound Agent painting the creation into existence."),
	  DogProp::Paintbrush,
	  0.0f, 0.0f, 4.0f,
	  /* head follows the stroke */ 10.0f, -18.0f, 16.0f,
	  /* strokes */ 34.0f, 0.62f, /* moves while creating */ true, false },

	// A STANCE AND A BEAM. Still, level, facing the contract, arms forward -- everything about the pose
	// says holding steady, because the beam is the action and a busy body would fight it.
	{ DogAct::VerificationBeam, TEXT("VERIFYING"),
	  TEXT("Checking the work against the Mission Contract."),
	  DogProp::None,
	  0.0f, 1.5f, 5.0f,
	  /* level */ -4.0f, /* arms forward */ 8.0f, 14.0f,
	  0.0f, 0.0f, false, /* beams */ true },
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

	// PLANNING IS THE ARCHITECT'S WORK, and guidance is the same work continuing in flight, so the book
	// stays open through it rather than snapping shut and back.
	case EWonderlandMissionBeat::PromptArchitectActive:
	case EWonderlandMissionBeat::Guidance:
		return EWonderlandDogAct::ReadingTheBook;

	case EWonderlandMissionBeat::CodingAgentActive:
		return EWonderlandDogAct::PaintingTheWork;

	case EWonderlandMissionBeat::Verifying:
		return EWonderlandDogAct::VerificationBeam;

	// HANDOFF FALLS HERE DELIBERATELY, with everything else. The founder removed the handoff animation,
	// and this is what removing it looks like: no case, no pose, nothing deleted from the shared clip
	// vocabulary, and Julius's own handoff events left exactly as they were.
	//
	// Research, repair, review, blocked, waiting, error and completion are also here ON PURPOSE. They keep
	// the behaviour they already had until each is specified, rather than being guessed at now.
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
	default: break;
	}
	return TEXT("NONE");
}

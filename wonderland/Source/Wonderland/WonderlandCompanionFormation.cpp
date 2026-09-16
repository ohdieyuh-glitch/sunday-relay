#include "WonderlandCompanionFormation.h"

const TCHAR* WonderlandCompanionFormationName(EWonderlandCompanionFormation Formation)
{
	switch (Formation)
	{
	case EWonderlandCompanionFormation::ClearTheSightLine: return TEXT("CLEAR THE SIGHT-LINE");
	case EWonderlandCompanionFormation::ResearchOrbit:     return TEXT("RESEARCH ORBIT");
	default: break;
	}
	return TEXT("FOLLOW");
}

EWonderlandCompanionFormation WonderlandCompanionFormationForBeat(EWonderlandMissionBeat Beat)
{
	switch (Beat)
	{
	// THE SIGHT-LINE IS ONLY SACRED WHILE SOMETHING IS TRAVELLING DOWN IT. Verification is the one stage
	// where the Dog, the beam and the Contract are a single straight line the viewer has to read.
	case EWonderlandMissionBeat::Verifying:
		return EWonderlandCompanionFormation::ClearTheSightLine;

	// THE STUDY IS A GROUP ACTIVITY. Research, planning and guidance are all the book, so the companions
	// circle for all three rather than settling and rising again between them.
	case EWonderlandMissionBeat::Researching:
	case EWonderlandMissionBeat::PromptArchitectActive:
	case EWonderlandMissionBeat::Guidance:
		return EWonderlandCompanionFormation::ResearchOrbit;

	// EVERYTHING ELSE FOLLOWS, deliberately including every transition and every ending. A companion is
	// never left in a formation because a stage forgot to put it back.
	default:
		break;
	}
	return EWonderlandCompanionFormation::Follow;
}

const FWonderlandCompanionOrbit& WonderlandCompanionOrbit()
{
	static const FWonderlandCompanionOrbit Orbit;
	return Orbit;
}

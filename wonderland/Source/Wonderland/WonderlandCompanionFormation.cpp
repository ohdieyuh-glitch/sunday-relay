#include "WonderlandCompanionFormation.h"

const TCHAR* WonderlandCompanionFormationName(EWonderlandCompanionFormation Formation)
{
	switch (Formation)
	{
	case EWonderlandCompanionFormation::ClearTheSightLine: return TEXT("CLEAR THE SIGHT-LINE");
	case EWonderlandCompanionFormation::ResearchOrbit:     return TEXT("RESEARCH ORBIT");
	case EWonderlandCompanionFormation::Gather:            return TEXT("GATHER");
	case EWonderlandCompanionFormation::SupportOrbit:      return TEXT("SUPPORT ORBIT");
	case EWonderlandCompanionFormation::CalmOrbit:         return TEXT("CALM ORBIT");
	case EWonderlandCompanionFormation::AssistOrbit:       return TEXT("ASSIST ORBIT");
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

FWonderlandCompanionOrbit WonderlandCompanionOrbitFor(EWonderlandCompanionFormation Formation)
{
	FWonderlandCompanionOrbit Orbit = WonderlandCompanionOrbit();
	switch (Formation)
	{
	case EWonderlandCompanionFormation::Gather:
		// Arriving and holding: wide, high and slow, and not yet giving anything.
		Orbit.RadiusUU = 200.0f;
		Orbit.HeightUU = 95.0f;
		Orbit.Revolutions = 0.05f;
		Orbit.bContributes = false;
		break;
	case EWonderlandCompanionFormation::SupportOrbit:
		// Implementation: a working circle, more often, and the Jhinn's execution beam.
		Orbit.RadiusUU = 215.0f;
		Orbit.HeightUU = 55.0f;
		Orbit.Revolutions = 0.12f;
		Orbit.PulseEverySeconds = 1.1f;
		Orbit.bAgentBeam = true;
		break;
	case EWonderlandCompanionFormation::CalmOrbit:
		// Review is the reviewer's stage: the companions stay present and quiet.
		Orbit.RadiusUU = 235.0f;
		Orbit.HeightUU = 85.0f;
		Orbit.Revolutions = 0.06f;
		Orbit.PulseEverySeconds = 2.8f;
		break;
	case EWonderlandCompanionFormation::AssistOrbit:
		// Repair: close in and quick, helping to fix what failed.
		Orbit.RadiusUU = 195.0f;
		Orbit.HeightUU = 50.0f;
		Orbit.Revolutions = 0.13f;
		Orbit.PulseEverySeconds = 0.9f;
		Orbit.bAgentBeam = true;
		break;
	default:
		break;
	}
	return Orbit;
}

bool WonderlandFormationOrbits(EWonderlandCompanionFormation Formation)
{
	return Formation != EWonderlandCompanionFormation::Follow && Formation != EWonderlandCompanionFormation::ClearTheSightLine;
}


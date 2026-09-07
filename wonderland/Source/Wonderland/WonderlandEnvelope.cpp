#include "WonderlandEnvelope.h"

bool WonderlandOrderingVerdictApplies(EWonderlandOrderingVerdict Verdict)
{
	// Exactly one verdict changes the world. Written as an equality rather than
	// a switch so that a member added to the enum is refused by default: a new
	// refusal reason must never start applying to the scene because nobody
	// remembered to add a case for it.
	return Verdict == EWonderlandOrderingVerdict::Applied;
}

bool WonderlandAttributionChannel(
	EWonderlandUsageAttribution Attribution,
	EWonderlandUsageChannel& OutChannel)
{
	switch (Attribution)
	{
	case EWonderlandUsageAttribution::CompoundOrchestrated:
		OutChannel = EWonderlandUsageChannel::CompoundAgent;
		return true;
	case EWonderlandUsageAttribution::SingleAgent:
		OutChannel = EWonderlandUsageChannel::SingleAgent;
		return true;
	default:
		// Unattributed draws into neither meter. The caller renders UNKNOWN;
		// picking a channel here would be guessing about someone's money.
		return false;
	}
}

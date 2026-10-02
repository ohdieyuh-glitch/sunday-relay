#include "WonderlandVoice.h"

namespace WonderlandVoice
{
	const TCHAR* TransportPending()
	{
		return TEXT("VOICE TRANSPORT PENDING");
	}
}

FWonderlandVoiceUnavailable::FWonderlandVoiceUnavailable()
{
	State.Connection = TEXT("UNAVAILABLE");
	State.Detail = WonderlandVoice::TransportPending();
}

FWonderlandVoicePreviewScript::FWonderlandVoicePreviewScript(TArray<TPair<FString, FWonderlandVoiceState>> InStates)
	: States(MoveTemp(InStates))
{
	Empty.Connection = TEXT("UNAVAILABLE");
	Empty.Detail = WonderlandVoice::TransportPending();
}

const FWonderlandVoiceState& FWonderlandVoicePreviewScript::GetState() const
{
	return States.IsValidIndex(Index) ? States[Index].Value : Empty;
}

FString FWonderlandVoicePreviewScript::GetPreviewLabel() const
{
	return States.IsValidIndex(Index)
		? FString::Printf(TEXT("DEVELOPMENT PREVIEW · scripted voice state %d of %d: %s"), Index + 1, States.Num(), *States[Index].Key)
		: FString(TEXT("DEVELOPMENT PREVIEW · no scripted voice states"));
}

void FWonderlandVoicePreviewScript::Step()
{
	if (States.Num() > 0)
	{
		Index = (Index + 1) % States.Num();
		Changed.Broadcast();
	}
}

FWonderlandVoiceCommandResult FWonderlandVoicePreviewScript::Refuse()
{
	return FWonderlandVoiceCommandResult{false, TEXT("DEVELOPMENT PREVIEW · voice is a scripted example here; nothing is connected")};
}

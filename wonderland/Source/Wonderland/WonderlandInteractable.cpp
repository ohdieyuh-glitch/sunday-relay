#include "WonderlandInteractable.h"

#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "WonderlandRelayLink.h"

AWonderlandInteractable::AWonderlandInteractable()
{
	// Nothing to tick. An interactable is a place, not a process — it waits to
	// be asked and does nothing in between.
	PrimaryActorTick.bCanEverTick = false;
}

bool AWonderlandInteractable::TryInteractWithinRange(const FVector& FromLocation)
{
	// 2D, matching the caller and for the same reason: a Dog on a balcony
	// directly above an arch has not reached it.
	const float Dist = FVector::Dist2D(GetActorLocation(), FromLocation);
	if (Dist > ProximityRadiusUu)
	{
		UE_LOG(LogTemp, Warning,
			TEXT("WLINTERACT '%s' at '%s' refused: %.0f uu away, radius %.0f"),
			*IntentType, *Locus, Dist, ProximityRadiusUu);
		return false;
	}

	const UWorld* const World = GetWorld();
	UGameInstance* const GameInstance = World != nullptr ? World->GetGameInstance() : nullptr;
	UWonderlandRelayLink* const Link =
		GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandRelayLink>() : nullptr;
	if (Link == nullptr)
	{
		// An editor preview has no game instance. That is not a failure worth
		// crashing over, and it is certainly not a success.
		UE_LOG(LogTemp, Warning,
			TEXT("WLINTERACT '%s' at '%s' NOT SENT: no Relay link in this world"),
			*IntentType, *Locus);
		return false;
	}

	// The link decides whether anything actually leaves this machine, and says
	// so. This function reports that answer unchanged rather than improving it.
	return Link->RaiseIntent(IntentType, Locus, FromLocation);
}

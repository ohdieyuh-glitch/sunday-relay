#include "WonderlandHubGameMode.h"

#include "WonderlandDogPawn.h"

AWonderlandHubGameMode::AWonderlandHubGameMode()
{
	// The mode ticks only so it can notice a player who has lost their body. See GiveThePlayerABodyBack.
	PrimaryActorTick.bCanEverTick = true;

	// The Dog IS the player. A Blueprint subclass may restyle it; the C++
	// default guarantees a clean clone of this repository spawns one at all.
	DefaultPawnClass = AWonderlandDogPawn::StaticClass();
}

void AWonderlandHubGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	GiveThePlayerABodyBack(DeltaSeconds);
}

void AWonderlandHubGameMode::GiveThePlayerABodyBack(float DeltaSeconds)
{
	UWorld* const Here = GetWorld();
	if (Here == nullptr)
	{
		return;
	}
	APlayerController* const Player = Here->GetFirstPlayerController();
	if (Player == nullptr)
	{
		SecondsWithoutAPawn = 0.0f;
		return;
	}
	if (Player->GetPawn() != nullptr)
	{
		SecondsWithoutAPawn = 0.0f;
		return;
	}

	// A second's grace. Possession legitimately lapses for a frame or two during startup and whenever
	// something deliberately unpossesses, and respawning into either of those would be worse than the fault
	// this is here for.
	SecondsWithoutAPawn += DeltaSeconds;
	if (SecondsWithoutAPawn < 1.0f)
	{
		return;
	}
	SecondsWithoutAPawn = 0.0f;
	UE_LOG(LogTemp, Warning,
		TEXT("WLHUB the player has had no pawn for a second -- restarting them. This is a RECOVERY, not a "
			 "fix: something destroyed the Dog and that cause is still open."));
	RestartPlayer(Player);
}

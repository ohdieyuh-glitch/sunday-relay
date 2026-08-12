// WONDERLAND — the hub game mode.
//
// The smallest class that makes the evidence chain's "map loads → Relay Dog
// spawns" step TRUE by construction: the mode's default pawn is the Dog, so
// loading the hub map spawns one without a Blueprint having to remember to.
//
// DELIBERATELY THIN. The mode spawns and possesses; it holds no Relay state and
// makes no Relay decision. Relay remains authoritative for Missions, Loops,
// Brain, PSPs, permissions, verification and durable state — the pawn READS a
// world snapshot through the Bridge's explicit contract and writes nothing
// back. A game mode that owned engineering truth would be the architecture
// violation Wonderland exists to avoid.
//
// This file was authored on a machine that cannot run Unreal. Its config entry
// (`GlobalDefaultGameMode` in DefaultEngine.ini) originally named this class
// BEFORE it existed — the config was written first and checked against the
// source, which is the only reason the gap was caught here instead of as a
// launch failure on the first Unreal-capable session.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "WonderlandHubGameMode.generated.h"

UCLASS(Blueprintable)
class AWonderlandHubGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AWonderlandHubGameMode();
};

// WONDERLAND — the hub game mode.
//
// The smallest class that makes the evidence chain's "map loads → Relay Dog
// spawns" step TRUE by construction: the mode's default pawn is the Dog, so
// loading the hub map spawns one without a Blueprint having to remember to.
//
// DELIBERATELY THIN. The mode spawns and possesses; it holds no Relay state and
// makes no Relay decision. Relay remains authoritative for Missions, Loops,
// Brain, C.A.R.D.s, permissions, verification and durable state — the pawn
// READS a
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

	virtual void Tick(float DeltaSeconds) override;

private:
	/**
	 * GIVE THE PLAYER A BODY BACK IF THEY LOSE ONE.
	 *
	 * MEASURED, and it is the reason this mode grew a Tick. Touring the converted world, the Dog is destroyed
	 * part-way through: `GetAllActorsOfClass(RelayDogCharacter)` returns ZERO while the PlayerController is
	 * still alive and well. Nothing brings it back. From that moment the session has a camera and no body --
	 * every input does nothing, and a founder looking at it would reasonably call the game broken.
	 *
	 * WHAT DESTROYS IT IS STILL OPEN and four explanations have been eliminated (see the world ledger); the
	 * leading remaining one is a capsule being placed inside solid geometry, which only a teleport can do.
	 * But the right thing to do about a player with no pawn does not depend on knowing why: respawn them.
	 * A beta that ships fast travel, a checkpoint warp, or a mission that places the Dog will meet this, and
	 * an unrecoverable session is a far worse outcome than a respawn.
	 *
	 * Deliberately slow and quiet: it waits a second so it cannot race a legitimate possession change during
	 * startup or a deliberate unpossess, and it logs when it fires so the underlying fault stays visible
	 * rather than being papered over by the thing that recovers from it.
	 */
	void GiveThePlayerABodyBack(float DeltaSeconds);

	float SecondsWithoutAPawn = 0.0f;
};

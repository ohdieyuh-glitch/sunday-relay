// The one thing that makes AWonderlandPlayerController actually run.
//
// WHY THIS EXISTS
//
// It did not, and the consequence was invisible for as long as the hero-shot
// system has existed: with no AGameModeBase subclass and no GlobalDefaultGameMode,
// a packaged Unreal game uses stock APlayerController. So
// AWonderlandPlayerController::BeginPlay was never called, `-CinematicView` and
// `-HeroCam=N` were never read, and EVERY hero capture this project has taken
// was the same view regardless of which camera was requested. Proven on the L4:
// HeroCam0, HeroCam3 (1,300 uu away) and HeroCam6 returned three frames of the
// identical composition.
//
// DefaultEngine.ini used to say, correctly, that naming a GameMode which does
// not exist would be a fabricated setting. The repair is to make one exist, not
// to name a fiction.
//
// DELIBERATELY MINIMAL. This sets PlayerControllerClass and NOTHING else. In
// particular it does not set DefaultPawnClass: which pawn the player possesses
// is a gameplay decision, and changing it here would alter the default streamed
// view as a side effect of fixing the cinematic one.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "WonderlandGameMode.generated.h"

UCLASS()
class AWonderlandGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AWonderlandGameMode();
};

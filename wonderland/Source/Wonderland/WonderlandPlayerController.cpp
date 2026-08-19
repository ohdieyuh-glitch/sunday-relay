// WONDERLAND — the player controller implementation. See the header for the
// invariant.

#include "WonderlandPlayerController.h"

#include "EnhancedInputSubsystems.h"
#include "GameFramework/Pawn.h"
#include "InputMappingContext.h"
#include "Camera/CameraActor.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

void AWonderlandPlayerController::BeginPlay()
{
	Super::BeginPlay();
	// Start from the current known state (defaults: not interactive yet, focused,
	// no overlay) so the first real snapshot flips us into exploration cleanly.
	RecomputeInputMode();

	// The DEFAULT streamed view is now the PLAYABLE third-person Dog — the possessed
	// pawn's spring-arm camera — so WASD / mouse-look move a view the player can see.
	// The cinematic ARRIVAL hero camera is opt-in (-CinematicView) for hero-shot
	// captures; without it we leave the view on the possessed pawn.
	if (FParse::Param(FCommandLine::Get(), TEXT("CinematicView")))
	{
		// Pick a specific hero camera by index for the named hero-shot captures:
		// `-HeroCam=N` renders from the CameraActor tagged "HeroCamN" (the level
		// generator places HeroCam0..HeroCam5 at the arrival, dog, gate, tree,
		// overlook and garden). Defaults to HeroCam0, then the legacy arrival tag.
		int32 HeroIndex = 0;
		FParse::Value(FCommandLine::Get(), TEXT("HeroCam="), HeroIndex);
		const FName HeroTag(*FString::Printf(TEXT("HeroCam%d"), HeroIndex));

		TArray<AActor*> HeroCameras;
		UGameplayStatics::GetAllActorsOfClassWithTag(this, ACameraActor::StaticClass(), HeroTag, HeroCameras);
		if (HeroCameras.Num() == 0)
		{
			UGameplayStatics::GetAllActorsOfClassWithTag(this, ACameraActor::StaticClass(), FName(TEXT("arrival_hero_view")), HeroCameras);
		}
		if (HeroCameras.Num() > 0 && HeroCameras[0] != nullptr)
		{
			SetViewTarget(HeroCameras[0]);
		}
	}
}

void AWonderlandPlayerController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);
	if (InPawn == nullptr)
	{
		return;
	}
	// Seed the control rotation from the pawn's SPAWN YAW.
	//
	// The spring-arm camera follows the CONTROL rotation
	// (bUsePawnControlRotation), and a headless possess leaves that rotation at
	// yaw 0 (+X) rather than the PlayerStart's facing - so the first streamed
	// frame faced whatever +X happened to be, and a hero shot framed a landmark
	// it was never pointed at.
	//
	// Yaw ONLY: pitch and roll stay level. FRotator is (Pitch, Yaw, Roll), and
	// passing the yaw into the first slot would pitch the camera into the floor.
	const FRotator SpawnRotation = InPawn->GetActorRotation();
	SetControlRotation(FRotator(0.0f, SpawnRotation.Yaw, 0.0f));
}

void AWonderlandPlayerController::SetStreamInteractive(bool bInteractive)
{
	bStreamInteractive = bInteractive;
	RecomputeInputMode();
}

void AWonderlandPlayerController::SetPageFocused(bool bFocused)
{
	bPageFocused = bFocused;
	RecomputeInputMode();
}

void AWonderlandPlayerController::SetOverlayOpen(bool bOpen)
{
	bOverlayOpen = bOpen;
	RecomputeInputMode();
}

EWonderlandInputMode AWonderlandPlayerController::ResolveInputMode() const
{
	// The exact order of wonderland-input.ts resolveInputMode(): fail toward NOT
	// capturing. No interactivity or no focus -> unfocused; an open overlay ->
	// ui_focus; only a focused, interactive, overlay-free page reaches exploration.
	if (!bStreamInteractive || !bPageFocused)
	{
		return EWonderlandInputMode::Unfocused;
	}
	if (bOverlayOpen)
	{
		return EWonderlandInputMode::UiFocus;
	}
	return EWonderlandInputMode::Exploration;
}

void AWonderlandPlayerController::RecomputeInputMode()
{
	const EWonderlandInputMode Next = ResolveInputMode();
	if (Next != CurrentMode)
	{
		CurrentMode = Next;
		ApplyInputMode(Next);
	}
}

void AWonderlandPlayerController::ApplyInputMode(EWonderlandInputMode Mode)
{
	UEnhancedInputLocalPlayerSubsystem* Input =
		ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer());

	// Swap Enhanced Input mapping contexts to match the mode.
	if (Input != nullptr)
	{
		if (ExplorationContext != nullptr)
		{
			if (Mode == EWonderlandInputMode::Exploration)
			{
				Input->AddMappingContext(ExplorationContext, 0);
			}
			else
			{
				Input->RemoveMappingContext(ExplorationContext);
			}
		}
		if (UIFocusContext != nullptr)
		{
			if (Mode == EWonderlandInputMode::UiFocus)
			{
				Input->AddMappingContext(UIFocusContext, 1);
			}
			else
			{
				Input->RemoveMappingContext(UIFocusContext);
			}
		}
	}

	// Pointer capture. GameOnly (captured) is used ONLY in exploration; every other
	// mode shows the cursor and lets the browser/UI have it. This is the line that
	// guarantees a Relay overlay is never clicked-through-a-captured-pointer.
	switch (Mode)
	{
	case EWonderlandInputMode::Exploration:
	{
		FInputModeGameOnly GameOnly;
		SetInputMode(GameOnly);
		SetShowMouseCursor(false);
		break;
	}
	case EWonderlandInputMode::UiFocus:
	{
		// GameAndUI (not UIOnly) so cancel still reaches the controller, but the
		// cursor is unlocked and visible for the overlay.
		FInputModeGameAndUI GameAndUI;
		GameAndUI.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		GameAndUI.SetHideCursorDuringCapture(false);
		SetInputMode(GameAndUI);
		SetShowMouseCursor(true);
		break;
	}
	case EWonderlandInputMode::Unfocused:
	default:
	{
		FInputModeGameAndUI GameAndUI;
		GameAndUI.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		SetInputMode(GameAndUI);
		SetShowMouseCursor(true);
		break;
	}
	}
}

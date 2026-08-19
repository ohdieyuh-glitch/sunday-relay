// WONDERLAND — the player controller: input modes, camera tuning, and the mouse-
// capture handoff.
//
// Mirrors the input-mode contract in
// src/relay/mission/wonderland/wonderland-input.ts. Two Enhanced Input mapping
// contexts share one browser: EXPLORATION (Dog + camera, pointer captured) and
// UI_FOCUS (a Relay overlay owns the free cursor). This controller swaps them,
// and it holds the invariant the whole file exists for:
//
//   THE POINTER IS CAPTURED ONLY IN EXPLORATION, AND EXPLORATION IS UNREACHABLE
//   WHILE AN OVERLAY IS OPEN OR THE PAGE HAS LOST FOCUS.
//
// So when a Relay panel opens over the stream, the founder's cursor is always
// free to click it. The TypeScript twin proves this exhaustively; this class
// implements the same transition.
//
// FWonderlandCameraTuning and EWonderlandInputMode are authoring/vocabulary types
// (parity checked in wonderland-input.test.ts), not world-document state.
//
// NOT COMPILED. No Unreal Engine binary exists here; never built or run.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "WonderlandPlayerController.generated.h"

class UInputMappingContext;

// Mirrors WONDERLAND_INPUT_MODES. Ordinal is not load-bearing here.
UENUM(BlueprintType)
enum class EWonderlandInputMode : uint8
{
	Unfocused,
	UiFocus,
	Exploration
};

// Mirrors WonderlandCameraTuning. Every scalar initialized so a default camera is
// usable rather than a zero-FOV pinhole.
USTRUCT(BlueprintType)
struct FWonderlandCameraTuning
{
	GENERATED_BODY()

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double MinFovDeg = 60.0;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double MaxFovDeg = 95.0;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double DefaultFovDeg = 78.0;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double SensitivityMin = 0.25;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double SensitivityMax = 2.5;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double DefaultSensitivity = 1.0;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double ArmLengthCm = 420.0;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	double SmoothingLagSpeed = 12.0;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	bool bCameraCollision = true;
};

UCLASS()
class AWonderlandPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	/** The exploration mapping context (Dog + camera). Assigned in the Blueprint subclass. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Input")
	TObjectPtr<UInputMappingContext> ExplorationContext;

	/** The UI-focus mapping context (cancel only). Assigned in the Blueprint subclass. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Input")
	TObjectPtr<UInputMappingContext> UIFocusContext;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Camera")
	FWonderlandCameraTuning CameraTuning;

	/** The web shell calls these as the stream, focus and overlays change. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Input")
	void SetStreamInteractive(bool bInteractive);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Input")
	void SetPageFocused(bool bFocused);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Input")
	void SetOverlayOpen(bool bOpen);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Input")
	EWonderlandInputMode GetInputMode() const { return CurrentMode; }

	/** True only in Exploration — the one mode that captures the pointer. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Input")
	bool IsPointerCaptured() const { return CurrentMode == EWonderlandInputMode::Exploration; }

protected:
	virtual void BeginPlay() override;

	// The spring-arm camera follows the CONTROL rotation (bUsePawnControlRotation),
	// but a headless possess seeds that rotation to +X (yaw 0) rather than the
	// PlayerStart's facing — so the first streamed frame faces the wrong way and a
	// hero-shot spawn framed a landmark it was never pointed at. Seed the control
	// rotation from the pawn's spawn yaw so "aim the PlayerStart at the landmark"
	// actually aims the camera there.
	virtual void OnPossess(APawn* InPawn) override;

private:
	/** The pure transition, mirroring resolveInputMode() in wonderland-input.ts. */
	EWonderlandInputMode ResolveInputMode() const;
	void RecomputeInputMode();
	void ApplyInputMode(EWonderlandInputMode Mode);

	bool bStreamInteractive = false;
	bool bPageFocused = true;
	bool bOverlayOpen = false;
	EWonderlandInputMode CurrentMode = EWonderlandInputMode::Unfocused;
};

// WONDERLAND — the in-world UI, owned in one place per player.
//
// ONE OWNER FOR EVERYTHING DRAWN OVER THE WORLD. The usage HUD, the Julius Live
// Terminal and the world map share one input hierarchy and one set of rules:
//
//   THE HUD IS FURNITURE. It is created once per player controller and stays on
//   screen while the terminal and the map open and close over it. Opening a panel
//   never destroys or recreates the HUD.
//
//   ONE PANEL AT A TIME. The terminal and the map are overlays; opening one closes
//   the other, so two cannot stack and a panel can never be added twice.
//
//   A PANEL OWNS THE KEYBOARD WHILE IT IS OPEN. UI-only input with focus in the
//   panel, cursor shown, move and look ignored, and held keys flushed on open — so
//   typing "wasd" into the terminal types letters and never walks the Dog, and a W
//   held when the terminal opened does not keep walking underneath it. Closing hands
//   control straight back.
//
// THE SHORTCUTS LIVE HERE, NOT ON A PAWN. Ctrl+T (terminal) and M (map) are bound on
// an input component this subsystem pushes onto the player controller, above the
// pawn's own, and they consume their keys. They therefore work whichever body the
// player is wearing — the canonical BP_RelayDog, the hub's dog pawn, a spectator —
// and survive the pawn being replaced. While a panel is open the panel itself
// answers Ctrl+T, M and Escape, because UI-only input means the game never sees them.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/LocalPlayerSubsystem.h"
#include "WonderlandUiSubsystem.generated.h"

class APlayerController;
class SWidget;
class SWonderlandLiveTerminal;
class SWonderlandWorldMap;
class UInputComponent;
class UWonderlandUsageHudWidget;

UCLASS()
class WONDERLAND_API UWonderlandUiSubsystem : public ULocalPlayerSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void ToggleLiveTerminal();

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void ToggleWorldMap();

	/** Close whichever panel is open and give the world its input back. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void CloseOverlay();

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsLiveTerminalOpen() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsWorldMapOpen() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsUsageHudOnScreen() const;

	/** Panels this subsystem currently has in the viewport. Never more than one. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetOverlaysInViewport() const { return OverlaysInViewport; }

	/** How many usage HUD widgets were ever created for the current controller. One. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetUsageHudCreations() const { return UsageHudCreations; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetTerminalInputText() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetTerminalRowCount() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetMapStopCount() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FName GetMapSelectedId() const;

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void SelectMapDestination(FName DestinationId);

	/** Press the map's Teleport button for the selected place. False when the map is closed or empty. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool TeleportToSelected();

private:
	enum class EOverlay : uint8 { None, Terminal, Map };

	void HandlePlayerControllerChanged(APlayerController* NewController);
	void Attach(APlayerController* Controller);
	void Detach();
	void OpenOverlay(EOverlay Which);
	void RefreshMap();
	void HandleTerminalSubmit(const FString& Text);
	void HandleTravel(FName DestinationId);
	void ApplyOverlayInput(bool bOverlayOpen, TSharedPtr<SWidget> Focus);
	UWorld* PlayerWorld() const;

	TWeakObjectPtr<APlayerController> BoundController;

	UPROPERTY(Transient)
	TObjectPtr<UInputComponent> UiInput;

	UPROPERTY(Transient)
	TObjectPtr<UWonderlandUsageHudWidget> UsageHud;

	TSharedPtr<SWonderlandLiveTerminal> Terminal;
	TSharedPtr<SWonderlandWorldMap> WorldMap;
	EOverlay Open = EOverlay::None;
	bool bOverlayIgnoresInput = false;
	int32 OverlaysInViewport = 0;
	int32 UsageHudCreations = 0;
	FString PendingMapNotice;
	FDelegateHandle ControllerChangedHandle;
};

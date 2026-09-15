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
class SWonderlandCompanionTerminal;
class SWonderlandLiveTerminal;
class SWonderlandProjectBrainPanel;
class UTexture2D;
class UWonderlandProjectBrainSubsystem;
struct FSlateBrush;
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

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void ToggleProjectBrain();

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsProjectBrainOpen() const;

	/** Inspect one Project Brain surface, or NAME_None to close the inspector. False when the panel is shut. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool SelectBrainSurface(FName SurfaceId);

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FName GetBrainSelectedSurface() const;

	/** Propose a line on the selected surface, exactly as its input box does. False unless the surface is yours. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool ProposeToSelectedBrainSurface(const FString& Text);

	/**
	 * COMPANION TERMINALS (development preview, WonderlandCompanionSubsystem.h). Mounted once per controller while
	 * the companion preview is on, and SHOWN WITH THE JULIUS LIVE TERMINAL: Ctrl+T brings the three consoles up
	 * together and takes them away together (founder, 2026-09-15), because they are one instrument -- the Compound
	 * Agent's terminal and the companions beside it -- rather than three panels that happen to overlap. They take
	 * typing only while a panel holds UI input -- in play, the world has the keys. 0 is the LLM Companion's, 1 the
	 * Jhinn AI Agent's.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetCompanionTerminalCount() const { return CompanionTerminals.Num(); }

	/** Mounted AND showing, which now means the Julius live terminal is open. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool AreCompanionTerminalsOnScreen() const { return CompanionLayer.IsValid() && CompanionTerminals.Num() > 0 && IsLiveTerminalOpen(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetCompanionTerminalTitle(int32 Index) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetCompanionTerminalLineCount(int32 Index) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetCompanionTerminalInputText(int32 Index) const;

	/** Give a companion terminal's command line the keyboard. False unless a panel currently holds UI input. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool FocusCompanionTerminal(int32 Index);

private:
	enum class EOverlay : uint8 { None, Terminal, Map, Brain };

	void HandlePlayerControllerChanged(APlayerController* NewController);
	void Attach(APlayerController* Controller);
	void Detach();
	void OpenOverlay(EOverlay Which);
	void RefreshMap();
	void RefreshBrain();
	void HandleTerminalSubmit(const FString& Text);
	void HandleTravel(FName DestinationId);
	void ApplyOverlayInput(bool bOverlayOpen, TSharedPtr<SWidget> Focus);
	void MountCompanionTerminals();
	void UnmountCompanionTerminals();
	void HandleCompanionSubmit(int32 Index, const FString& Text);
	UWonderlandProjectBrainSubsystem* Brain() const;
	UWorld* PlayerWorld() const;

	TArray<TSharedPtr<SWonderlandCompanionTerminal>> CompanionTerminals;
	TSharedPtr<SWidget> CompanionLayer;

	TWeakObjectPtr<APlayerController> BoundController;

	UPROPERTY(Transient)
	TObjectPtr<UInputComponent> UiInput;

	UPROPERTY(Transient)
	TObjectPtr<UWonderlandUsageHudWidget> UsageHud;

	TSharedPtr<SWonderlandLiveTerminal> Terminal;
	TSharedPtr<SWonderlandWorldMap> WorldMap;
	TSharedPtr<SWonderlandProjectBrainPanel> BrainPanel;

	/** The Project Brain hologram, imported from wonderland/UiArt at attach. A transient texture, never an asset. */
	UPROPERTY(Transient)
	TObjectPtr<UTexture2D> BrainArt;

	TSharedPtr<FSlateBrush> BrainArtBrush;
	FDelegateHandle BrainChangedHandle;
	EOverlay Open = EOverlay::None;
	bool bOverlayIgnoresInput = false;
	int32 OverlaysInViewport = 0;
	int32 UsageHudCreations = 0;
	FString PendingMapNotice;
	FDelegateHandle ControllerChangedHandle;
};

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
// THE BOTTOM SHORTCUTS AND THE MINI-MAP ARE FURNITURE TOO (founder, 2026-09-15). The mini-map holds the top right
// and the AGENT · MISSIONS · BRAIN · COMMANDS · MENU strip holds the bottom edge. Both are mounted once, like the
// usage HUD; the strip steps aside while any panel is open, and the map while a full-screen one is. Their places
// are safe zones measured against everything else on screen -- DescribeHudRects reports them for exactly that.
//
// THE SHORTCUTS LIVE HERE, NOT ON A PAWN. Ctrl+T (terminal) and M (map) are bound on
// an input component this subsystem pushes onto the player controller, above the
// pawn's own, and they consume their keys -- as are B (brain), J (missions), C (commands), Tab (menu) and a held Left
// Alt, which brings the cursor out so the bottom shortcuts can be clicked. They therefore work whichever body the
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
class SWonderlandCommandStation;
class SWonderlandMenuPanel;
class SWonderlandMiniMap;
class SWonderlandMissionsPanel;
class SWonderlandNavBar;
class UInputComponent;
class UWonderlandCommandPresetSubsystem;
class UWonderlandMiniMapDriver;
class UWonderlandMissionSubsystem;
class UWonderlandUsageHudWidget;
enum class EWonderlandNavTarget : uint8;

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

	// ---------------------------------------------------------------- the bottom shortcuts (WonderlandNavBar.h)

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void ToggleMissions();

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void ToggleCommandStation();

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void ToggleMenu();

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsMissionsOpen() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsCommandStationOpen() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsMenuOpen() const;

	/** Go where a shortcut goes, by id ("agent", "missions", "brain", "commands", "menu"). False for an unknown id. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool NavigateTo(FName ShortcutId);

	/** Mounted, and not stepped aside for a panel. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsNavBarOnScreen() const;

	/** The strip's labels as its built tiles read them, "|"-joined. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetNavBarLabels() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetNavClickCount(FName ShortcutId) const;

	/** Held Left Alt: the cursor comes out and look input is held, so the shortcuts can be clicked. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void BeginPointing();

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void EndPointing();

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsPointing() const { return bPointing; }

	/**
	 * CLICK A SHORTCUT THE WAY A MOUSE DOES. The cursor moves to the tile's centre and a button goes down and up
	 * through Slate's own hit testing, so whatever is really under that point is what answers -- a tile hidden
	 * behind something, or not laid out, does not count as clicked. Starts pointing first, as a player must.
	 * True when that tile registered the click.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool ClickNavButton(FName ShortcutId);

	/**
	 * WHAT SLATE SEES UNDER A TILE. The tile's rectangle, whether pointing is on, who holds mouse capture, whether the
	 * application is active, and the widget path Slate locates at the tile's centre -- the question a failed pointer
	 * click leaves open, answered instead of guessed. One "key value" per line.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	FString DiagnoseNavClick(FName ShortcutId);

	/** The tile button's own SimulateClick. Wiring only -- says nothing about whether a pointer can reach the tile. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool SimulateNavTileClick(FName ShortcutId);

	// ---------------------------------------------------------------- the mini-map (WonderlandMiniMap.h)

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsMiniMapOnScreen() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetMiniMapWorldLine() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetMiniMapRegionLine() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetMiniMapCaptureCount() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsMiniMapCaptureInWorld() const;

	/** Whether the last paint drew the ground photograph, not just the empty disc. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool DidMiniMapDrawPhotograph() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetMiniMapPaintCount() const;

	/** The Dog's arrow as last drawn: screen degrees, 0 = right, 90 = down. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	double GetMiniMapArrowAngle() const;

	/** The camera's view wedge as last drawn, same convention. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	double GetMiniMapViewAngle() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	double GetMiniMapUUPerPixel() const;

	/** A place's marker as last drawn, pixels from the disc centre. False when it was not on the disc. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool GetMiniMapMarkerOffset(FName PlaceId, FVector2D& OutOffset) const;

	/** Whether a place's marker was on the disc at the last paint. The same answer as the return above, for bindings that drop it. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsMiniMapMarkerDrawn(FName PlaceId) const;

	/** Every piece of HUD as last laid out, one "name x y w h shown" line each, viewport pixels. For overlap checks. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString DescribeHudRects() const;

	// ---------------------------------------------------------------- the command station (WonderlandCommandStation.h)

	/** Select a quick slot, as clicking its row does. False unless the station is open. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool SelectCommandSlot(int32 Slot);

	/** Equip a command to the selected slot, as its card's button does. False unless the station is open. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool EquipCommandToSelectedSlot(FName CommandId);

	/** The station's slot rows as they read on screen. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetCommandStationSlotRows() const;

	/** The Julius terminal's command rows as they read on screen. Empty until the terminal has been opened once. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetTerminalCommandRows() const;

private:
	enum class EOverlay : uint8 { None, Terminal, Map, Brain, Missions, Commands, Menu };

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
	UWonderlandCommandPresetSubsystem* Presets() const;
	UWonderlandMissionSubsystem* Missions() const;
	static const TCHAR* OverlayName(EOverlay Which);
	TSharedPtr<SWidget> OverlayWidget(EOverlay Which) const;
	void ToggleOverlay(EOverlay Which);
	void HandleNavigate(EWonderlandNavTarget Target);
	void MountHudFurniture();
	void UnmountHudFurniture();
	void StopPointing(bool bRestoreGameInput);
	/** The map shows over the world while no full-screen panel covers it. The terminal is not full-screen. */
	bool IsMiniMapShown() const { return Open == EOverlay::None || Open == EOverlay::Terminal; }
	/** Top right, unless a long mission strip reaches into that column: then just below the strip. */
	FMargin MiniMapOffset() const;

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
	TSharedPtr<SWonderlandCommandStation> CommandStation;
	TSharedPtr<SWonderlandMissionsPanel> MissionsPanel;
	TSharedPtr<SWonderlandMenuPanel> MenuPanel;

	/** The mini-map and the bottom shortcuts, on one layer above the usage HUD and below every panel. */
	TSharedPtr<SWidget> HudFurniture;
	TSharedPtr<SWonderlandMiniMap> MiniMap;
	TSharedPtr<SWonderlandNavBar> NavBar;

	UPROPERTY(Transient)
	TObjectPtr<UWonderlandMiniMapDriver> MiniMapDriver;

	bool bPointing = false;

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

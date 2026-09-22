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
// THE WONDER WEB WALLET HEADS THE TOP RIGHT (founder, 2026-09-16): a compact sandbox status above the mini-map, one
// column, never overlapping it, opening a fuller wallet surface.
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
#include "Containers/Ticker.h"
#include "Subsystems/LocalPlayerSubsystem.h"
#include "WonderlandRoleScript.h"
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
class SWonderlandWalletChip;
class SWonderlandWonderWebInputLayer;
class SWonderlandWonderWebPanel;
class SWonderlandJuliusConnectPanel;
class SWonderlandWonderWebBrowserPanel;
class AWonderlandWonderWebScreen;
class AWonderlandWonderWebWorkspace;
class UWonderlandWonderWebSubsystem;
class UWonderlandJuliusConnectSubsystem;
class UWonderlandWonderWebBrowseSubsystem;
class SWonderlandWalletPanel;
class UInputComponent;
class UWonderlandCommandPresetSubsystem;
class UWonderlandMiniMapDriver;
class UWonderlandMissionSubsystem;
class UWonderlandUsageHudWidget;
class UWonderlandWalletSubsystem;
enum class EWonderlandMissionBeat : uint8;
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

	/**
	 * OPEN OR SHUT THE RELAY DOG WARDROBE inside the Project Brain. False when the Brain panel itself is shut, because
	 * the wardrobe lives inside it and opening one without the other would be a state no key can reach.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool SetBrainSkinsOpen(bool bOpen);

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsBrainSkinsOpen() const;

	/** Wear a skin, exactly as clicking its card does. False when the registry refuses it. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool WearRelaySkin(FName SkinId);

	/**
	 * HOW MANY FRAMES THE SKIN STAGE HAS CAPTURED. A proof reads it twice with a wait between: a number that moved is
	 * a live 3D dog, and a number that did not is a still photograph wearing the same clothes.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	int32 GetSkinStageFrameCount() const;

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

	// ---------------------------------------------------------------- Wonder Web (WonderlandWonderWeb.h)
	//
	// THE IN-WORLD BROWSER, OPENED FROM THE PROJECT. A screen stands in the garden ahead of the Dog and the camera glides
	// to it; the window on it renders the Wonder Web projection and decides nothing. It is a panel like the others --
	// one at a time, the keyboard its while it is open, Escape or its own close button hands the world back -- but it is
	// drawn in the world, not over it. DEVELOPMENT PREVIEW: sample projections, a simulated creation, sample peers.

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	void OpenWonderWeb();

	// ---------------------------------------------------------------- the workspace of windows
	//
	// A WORKSPACE, NOT ONE GIANT BROWSER (founder, 2026-09-17). Wonder Web opens as a workspace standing in the garden, and
	// windows stand in it side by side at a multitasking size: "creation" (the running creation, Pixel Canvas) and
	// "connections" (Julius Connect). Each is a view under the one Julius -- none holds authority -- and each goes on
	// working while another is focused or it is minimized. Opening a second window tiles the two; a third tiles three.
	// Escape (or closing the last window) returns to the world and keeps the set for next time.

	/** Open (or restore and focus) a window: "creation", "connections" or "browser". Opens the workspace first when it is closed. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool OpenWonderWebWindow(FName Window);

	/**
	 * CTRL+W: ONE MORE WONDER WEB (founder, 2026-09-17). Each press opens the next one; at the account's limit it opens
	 * nothing and the workspace says so in its own voice rather than in a modal.
	 *
	 * How many is not written here: it is read from the entitlement (WonderlandEntitlements.h), so a future tier raises a
	 * number rather than changing this code.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SpawnWonderWebWindow();

	/** What the key is bound to. A chord's handler returns nothing; the answer is shown in the workspace instead. */
	void HandleSpawnWonderWebShortcut();

	/** How many Wonder Web browser windows are open, and how many this account may have. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	int32 CountOpenWonderWebWindows() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	int32 GetWonderWebWindowLimit() const;

	/** Close one window; closing the last closes the workspace. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool CloseWonderWebWindow(FName Window);

	/** Fold a window to its chip along the bottom of the workspace (its work goes on), or restore it. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool MinimizeWonderWebWindow(FName Window, bool bMinimize);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool FocusWonderWebWindow(FName Window);

	/** Grow the window larger in the middle of the workspace, or back to its tile. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool ExpandWonderWebWindow(FName Window);

	/** Lay the open windows out again: one in the middle, two side by side, three in two rows. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	void TileWonderWeb();

	/** Every window's state in the workspace, and Julius Connect's link, prompt and task, as one line. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FString DescribeWonderWebWorkspace() const;

	/** Click a named control of a named window through the real input path ("connections", "approve"). "chip" clicks a minimized window's chip. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebWindowClick(FName Window, FName Control);

	/**
	 * Scroll a Wonder Web window where a real wheel would: a real wheel event, hit tested and routed like any other, at a
	 * control or at a point ("at:760,420"). Positive scrolls up, as a wheel does.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebWindowScroll(FName Window, FName Control, float Delta);

	/**
	 * Point the Wonder Web window in front at a real address. The first window goes through the shared browse state, which
	 * is what Julius's story follows; any other window has its own page and is pointed straight at it. Refused, with a
	 * reason, for a host that is not allowed.
	 */
	bool NavigateFocusedBrowser(const FString& Url, FString& OutRefusal);
	/** True for a Wonder Web window that is a browser: "browser", "browser-2", and so on. */
	static bool IsBrowserWindow(FName Window);

	/**
	 * Type into whatever has keyboard focus, as real character events. After a click on the live page that is the page, so
	 * this types into a real website. What is typed is never logged.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebWindowType(const FString& Text);

	/** Press a key ("Enter", "BackSpace") as a real key event, routed to whatever has focus. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebWindowKey(FName Key);

	/** Where a named control of a named window stands on screen, in Slate screen space; (-1, -1) when it is not drawn. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FVector2D GetWonderWebWindowControlOnScreen(FName Window, FName Control) const;

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	void CloseWonderWeb();

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	bool IsWonderWebOpen() const;

	/** The screen standing in the world and the camera on it, as "presented=1 view_target=1 ...". */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FString DescribeWonderWeb() const;

	/**
	 * Click a named control of the in-world window ("tab:1", "open-sample", "stop", "cell:20", "close" ...) the way a
	 * mouse does: real Slate press and release events at the screen position where that control stands in the world, so
	 * they pass through the input layer, the ray onto the glass and the widget interaction. False when the control is
	 * not on screen or the click did not reach the glass.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebClick(FName Control);

	/** Type into whatever the window has focused, as the keyboard does, and press Enter when asked. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebTyping(const FString& Text, bool bPressEnter);

	/**
	 * Send the Wonder Web screen gliding to a place in the view: center, left, right, top, bottom, top-left, top-right,
	 * bottom-left, bottom-right. The way Julius will arrange the Wonder Webs it opens. False for an unknown place.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool MoveWonderWeb(FName Place);

	/** The screen's place, offset (across, up, uu), target and whether it is still gliding, as "place=left offset=... target=... gliding=1". */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FString DescribeWonderWebPlacement() const;

	/** Press and release a key as the keyboard does (e.g. "Right" with Control held), to whatever Wonder Web has focused. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebKey(FName KeyName, bool bControl);

	/** Drag the screen by its title bar with real routed pointer events, from its current place by this many screen units. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI|Wonder Web")
	bool SimulateWonderWebTitleDrag(float DeltaX, float DeltaY, int32 Steps);

	/** Where a named control of the window stands on screen, in Slate screen space; (-1, -1) when it is not drawn. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Wonder Web")
	FVector2D GetWonderWebControlOnScreen(FName Control) const;

	// ---------------------------------------------------------------- the Wonder Web Wallet (WonderlandWallet.h)

	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	void ToggleWallet();

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsWalletOpen() const;

	/** The compact wallet status is mounted and not stepped aside for a full-screen panel. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsWalletOnScreen() const;

	/** The balance, unit and sandbox claim exactly as the chip's built text reads. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetWalletDrawnBalance() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetWalletDrawnUnit() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetWalletDrawnClaim() const;

	/** Click the wallet status the way a pointer does, as ClickNavButton does a shortcut. True when it opened. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|UI")
	bool ClickWalletChip();

	// ---------------------------------------------------------------- simulated mission narration (WonderlandMissionNarration.h)

	/**
	 * ONE APPLIED MISSION EVENT, told on the terminals. The Julius Live Terminal gets a row for every event and moves
	 * the role section it names; a JOINED companion's terminal gets a line whenever the stage changes, from the same
	 * beat its flight was just chosen from. A new mission clears the simulated logs; EventType None means the mission
	 * has ended and the companions go back to WAITING.
	 */
	void NarrateMissionEvent(FName EventType, EWonderlandMissionBeat Beat, const FString& ChakraLabel, bool bBeatChanged,
		bool bNewMission, bool bLlmJoined, bool bJhinnJoined);

	/** The Julius terminal carries DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	bool IsJuliusTerminalSimulated() const;

	/** A Julius terminal section's state as it reads: PROMPT ARCHITECT, CODING AGENT, JULIUS 3.3, INDEPENDENT REVIEWER. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetJuliusSectionState(const FString& Section) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetJuliusLatestHeadline() const;

	/** The event the Julius terminal last narrated. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FName GetJuliusNarratedEvent() const { return JuliusNarratedEvent; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetCompanionTerminalStatus(int32 Index) const;

	/** What the companion's newest line was spoken as, e.g. RESEARCHING. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FString GetCompanionTerminalActivity(int32 Index) const;

	/** The beat the companion's terminal last narrated. Must equal its flight beat. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI")
	FName GetCompanionTerminalNarratedBeat(int32 Index) const;

	// ---------------------------------------------------------------- Julius's components at work (founder, 2026-09-16)
	// The Julius Live Terminal is never changed. While a simulated mission runs, Julius and its three components work in
	// the terminal's own four sections at the same time, each from the same event the Relay Dog performs.
	// Role: 0 JULIUS, 1 PROMPT ARCHITECT, 2 CODING AGENT, 3 INDEPENDENT REVIEWER.

	/** What a role is doing now, e.g. IMPLEMENTING: its section's state. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	FString GetJuliusRoleStatus(int32 Role) const;

	/** Lines a role has written this mission. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	int32 GetJuliusRoleWrittenCount(int32 Role) const;

	/** A role's newest line, and its kind (Log, DiffAdd, Preview, Finding...). */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	FString GetJuliusRoleLatestLine(int32 Role) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	FString GetJuliusRoleLatestKind(int32 Role) const;

	/** The mission event the roles are working on. It must equal the world's. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	FName GetJuliusRoleEvent() const { return RoleEvent; }

	/** Lines a role still has to write for the current event. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	int32 GetJuliusRolePending(int32 Role) const;

	/** Lines written into a Julius terminal section's work log this mission. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	int32 GetJuliusSectionLineCount(const FString& Section) const;

	/** A section's newest lines, "\n"-joined: what a proof job reads to know the section shows real work. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	FString DescribeJuliusSection(const FString& Section, int32 MaxLines) const;

	/** The section the terminal is keeping in view for the stage the world is in. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	FString GetJuliusFocusSection() const;

	/** How many characters a role has typed this mission (code and prompt text arrive character by character). */
	UFUNCTION(BlueprintPure, Category = "Wonderland|UI|Julius")
	int32 GetJuliusRoleTypedCharacters(int32 Role) const;

private:
	enum class EOverlay : uint8 { None, Terminal, Map, Brain, Missions, Commands, Menu, Wallet, WonderWeb };

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
	/** The map shows over the world while no full-screen panel covers it. The terminal is not full-screen, and Wonder Web stands in the world. */
	bool IsMiniMapShown() const { return Open == EOverlay::None || Open == EOverlay::Terminal || Open == EOverlay::WonderWeb; }
	UWonderlandWonderWebSubsystem* WonderWebState() const;
	UWonderlandJuliusConnectSubsystem* JuliusConnect() const;
	/** The companions' runtime: what is actually behind the LLM Companion and Jhinn, if anything. */
	class UWonderlandSidekickSubsystem* Sidekicks() const;
	/** What this account may do. The window limit comes from here and from nowhere else. */
	class UWonderlandEntitlementSubsystem* Entitlements() const;

	/** The Relay Dog skin registry: what skins exist and which one the Dog is wearing. */
	class UWonderlandRelaySkinSubsystem* RelaySkins() const;

	/**
	 * THE LIVE RELAY DOG BEHIND THE PROJECT BRAIN'S WARDROBE. Made on first use and kept; it costs one idle actor when
	 * nothing is looking at it, because it captures only while a surface asks. Null when there is no world.
	 */
	class AWonderlandSkinStage* SkinStage();
	/** The next browser window id this account may open, or NAME_None when it is already at its limit. */
	FName NextWonderWebWindowId() const;
	/**
	 * THE COMPANIONS AS THE RUNTIME REPORTS THEM. Their terminals show the truth state, the provider and the model; their
	 * answers arrive as lines when a turn really finishes. Nothing here invents an answer, and nothing here decides a
	 * state -- it is the same "Wonderland is a view" rule the Connections window follows.
	 */
	void HandleSidekicksChanged();
	UWonderlandWonderWebBrowseSubsystem* BrowseState() const;

	/** One window of the Wonder Web workspace: what it draws, its chip, and the glass it stands on. */
	struct FWonderWebWindow
	{
		FName Id;
		TSharedPtr<SWidget> Content;
		FVector2D ContentSize = FVector2D(1536.0, 1024.0);
		TSharedPtr<SWidget> Chip;
		TWeakObjectPtr<AWonderlandWonderWebScreen> Screen;
		bool bOpen = false;
		bool bMinimized = false;
		bool bExpanded = false;
		int32 OpenedOrder = 0;
	};
	FWonderWebWindow* FindWonderWebWindow(FName Id);
	const FWonderWebWindow* FindWonderWebWindow(FName Id) const;
	/** The window, its widgets and its glass in the controller's world, made the first time it is asked for. */
	FWonderWebWindow* EnsureWonderWebWindow(FName Id);
	AWonderlandWonderWebWorkspace* EnsureWonderWebWorkspace(APlayerController* Controller);
	void PresentWonderWebWindow(FWonderWebWindow& Window);
	TArray<AWonderlandWonderWebScreen*> OpenWonderWebScreens() const;
	void FocusWonderWebScreen(AWonderlandWonderWebScreen* Screen);
	/** The most recently opened window that is open and not minimized, other than this one. */
	FName MostRecentWonderWebWindow(FName Except) const;
	/** The HUD on screen that windows must not sit under, as viewport fractions (0..1, y down). */
	TArray<FBox2D> WonderWebHudKeepOut() const;
	/** The last tile area chosen, as viewport fractions, for the proof job. */
	FBox2D LastWonderWebTileArea = FBox2D(ForceInit);
	AWonderlandWonderWebScreen* FocusedWonderWebScreen() const;
	bool GetWonderWebWindowPixel(FName Window, FName Control, FVector2D& OutPixel) const;
	/** Julius started waiting on the user: the Connections window comes forward. */
	void HandleJuliusConnectChanged();
	/** Top right, unless a long mission strip reaches into that column: then just below the strip. */
	FMargin MiniMapOffset() const;
	UWonderlandWalletSubsystem* Wallet() const;
	/** The Julius Live Terminal, created once and kept -- at attach, so it can record a mission while it is closed. */
	void EnsureLiveTerminal();

	/** One role's work in progress: its status, the lines it still owes the current event, and when the next is due. */
	struct FRoleFeed
	{
		FString Status = TEXT("STANDBY");
		TArray<FWonderlandRoleLine> Pending;
		float Wait = 0.0f;
		int32 Written = 0;
		FWonderlandRoleLine Latest;
		/** Julius only: a heading waiting to be carried into the row it heads. */
		FString Heading;
		/** The line being typed into the section's work log, how far it has got, and how long it is. */
		int32 TypingLine = INDEX_NONE;
		float Typed = 0.0f;
		int32 TypingLength = 0;
		EWonderlandRoleLineKind TypingKind = EWonderlandRoleLineKind::Log;
		int32 TypedCharacters = 0;
	};
	void NarrateRoles(FName EventType, const FString& ChakraLabel, bool bNewMission, bool bLlmJoined, bool bJhinnJoined);
	void WriteRoleLine(int32 Role, const FWonderlandRoleLine& Line);
	/** Write everything a role still owes, at once: the world has moved on and its section must not lag it. */
	void FlushRole(int32 Role);
	bool TickRoles(float DeltaSeconds);
	FRoleFeed RoleFeeds[WonderlandJuliusRoleCount];
	TMap<FName, int32> RoleOccurrences;
	FName RoleEvent;
	FString RoleChakra;
	FTSTicker::FDelegateHandle RoleTicker;
	double RoleWorldSeconds = -1.0;
	/**
	 * A pointer click on one widget: hit tested in that widget's own window, routed down the path found there, and
	 * only when the widget is really on that path. False when it is not under its own centre. The OS cursor never moves.
	 */
	bool RouteClickToWidget(const TSharedPtr<SWidget>& Target, const FString& What);

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
	/** The windows, kept once made like the other panels, so a half-typed command is still there on reopen. */
	TSharedPtr<SWonderlandWonderWebPanel> WonderWebPanel;
	TSharedPtr<SWonderlandJuliusConnectPanel> ConnectPanel;
	/**
	 * THE BROWSER WINDOWS, one panel each. Founder: "Julius will be spawning multiple wonder webs" -- so browser is not one
	 * window but as many as are open, each with its own real page in the runtime (WonderlandWonderWebLive.h). The first is
	 * called "browser" and is the one Julius's own browsing appears in.
	 */
	TMap<FName, TSharedPtr<SWonderlandWonderWebBrowserPanel>> BrowserPanels;
	TSharedPtr<SWonderlandWonderWebInputLayer> WonderWebLayer;
	TArray<FWonderWebWindow> WonderWebWindows;
	TWeakObjectPtr<AWonderlandWonderWebWorkspace> WonderWebWorkspace;
	FName FocusedWonderWebWindow;
	int32 WonderWebOpenCounter = 0;
	FDelegateHandle JuliusConnectChangedHandle;
	FDelegateHandle SidekicksChangedHandle;
	/** Per companion terminal: the turn whose ask, and the turn whose answer, are already on screen. */
	TArray<FString> CompanionShownAsk;
	TArray<FString> CompanionShownAnswer;
	TArray<FString> CompanionShownNote;
	FString LastPromptRequestId;
	/** The browsing task a window has already been opened for, so Julius opens one window per task and not one per tick. */
	FString LastBrowsingTaskId;

	/** The mini-map and the bottom shortcuts, on one layer above the usage HUD and below every panel. */
	TSharedPtr<SWidget> HudFurniture;
	TSharedPtr<SWonderlandMiniMap> MiniMap;
	TSharedPtr<SWonderlandNavBar> NavBar;
	TSharedPtr<SWonderlandWalletChip> WalletChip;
	TSharedPtr<SWonderlandWalletPanel> WalletPanel;
	/** The wallet above the mini-map: the top-right column as one piece, so its size is known when it is placed. */
	TSharedPtr<SWidget> TopRightColumn;

	UPROPERTY(Transient)
	TObjectPtr<UWonderlandMiniMapDriver> MiniMapDriver;

	bool bPointing = false;
	FName JuliusNarratedEvent;

	/** The Project Brain hologram, imported from wonderland/UiArt at attach. A transient texture, never an asset. */
	UPROPERTY(Transient)
	TObjectPtr<UTexture2D> BrainArt;

	TSharedPtr<FSlateBrush> BrainArtBrush;

	/** The brush the wardrobe draws: the skin stage's render target, pointed at once and then left alone. */
	TSharedPtr<FSlateBrush> SkinPreviewBrush;
	TWeakObjectPtr<class AWonderlandSkinStage> SkinStageActor;
	FDelegateHandle BrainChangedHandle;
	EOverlay Open = EOverlay::None;
	bool bOverlayIgnoresInput = false;
	int32 OverlaysInViewport = 0;
	int32 UsageHudCreations = 0;
	FString PendingMapNotice;
	FDelegateHandle ControllerChangedHandle;
};

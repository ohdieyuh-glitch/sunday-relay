// WONDERLAND — WONDER WEB, AS THE WORLD SHOWS IT.
//
// Wonder Web is Wonderland's in-world browser: the place a user opens, runs, tests and uses what they built without
// leaving Wonderland (docs/relay/WONDER_WEB.md). Its authority lives in the Relay domain -- src/relay/mission/wonder-web
// -- as a pure lifecycle and a PROJECTION, `WonderWebSurface`, which "decides nothing and stores nothing" so that the
// browser surface and the Unreal surface render the same struct and cannot drift into two opinions about what a user
// may do. This file is the Unreal half of that sentence.
//
// UNREAL DECIDES NOTHING. The types below mirror `WonderWebSurface` field for field, plain C++ (like Project Brain's
// presentation model, none of it crosses back to Relay, so none of it belongs in the parity table). Which tabs exist,
// whether a tab is an observation, which chrome control is live and whether the terminal takes input are READ from the
// projection and never computed here; every action this subsystem offers is refused unless the surface currently on
// screen says it is allowed. Replication is not authorization, and a peer's tab can never be driven.
//
// DEVELOPMENT PREVIEW, AND IT SAYS SO. No bridge delivers projections to the game yet. Until one does, the surfaces
// come from wonderland/UiArt/WonderWeb/wonder-web-preview.json, which Tools/wonder_web/wonder-web-preview.generate.ts
// writes by walking a SIMULATED sample creation through the real domain lifecycle and calling the real
// `projectWonderWebSurface` for every state. This subsystem plays those frames in order as a simulated runtime would
// report them -- created, preparing, building, ready, running, stopped, failed -- and the peers are sample people. The
// surface labels all of it; nothing pretends to be connected.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandWonderWeb.generated.h"

/** `WonderWebAccess`. Never Control for a peer's tab: the projection has no branch that yields it. */
enum class EWonderWebAccess : uint8
{
	None,
	Observe,
	Control
};

/** `WonderWebViewport['kind']`: what the big black area is showing, as a closed set. */
enum class EWonderWebViewportKind : uint8
{
	Idle,
	Working,
	Creation,
	Failed,
	Observed
};

struct FWonderWebTab
{
	FString UserId;
	FString Label;
	bool bIsSelf = false;
	bool bIsActive = false;
	/** A palette TOKEN (wonder-dot-amber ...), never a colour: the palette belongs to the renderer. */
	FString DotColorToken;
	/** LIVE, RECONNECTING, OFFLINE, or empty when Relay has not said. */
	FString ConnectionState;
	EWonderWebAccess Access = EWonderWebAccess::None;
};

struct FWonderWebAddress
{
	FString Display;
	bool bSecure = false;
	FString CreationId;
	FString ProjectId;
};

struct FWonderWebViewport
{
	EWonderWebViewportKind Kind = EWonderWebViewportKind::Idle;
	/** Working and Observed: the creation's status (CREATED ... STOPPED). */
	FString Status;
	/** Working: the sentence the domain says about that status. */
	FString Message;
	FString CreationId;
	/** Creation: the file the build produced and Wonder Web opens. */
	FString Entrypoint;
	bool bRunning = false;
	/** Failed: the reason and the phase it happened in. */
	FString Summary;
	FString Phase;
	/** Observed: whose creation it is. */
	FString OwnerUserId;
};

struct FWonderWebTerminalLine
{
	int32 Sequence = 0;
	FString Text;
	/** `stream === 'runtime'`; false is the build stream. */
	bool bRuntime = false;
};

struct FWonderWebTerminal
{
	FString Prompt;
	TArray<FWonderWebTerminalLine> Lines;
	/** -1 when nothing was dropped. */
	int32 TruncatedFrom = -1;
	bool bAcceptsInput = false;
	bool bBusy = false;
};

struct FWonderWebChrome
{
	bool bCanGoBack = false;
	bool bCanGoForward = false;
	bool bCanReload = false;
	bool bCanStop = false;
	bool bCanRestart = false;
	bool bCanRebuild = false;
	bool bCanReturnToProject = false;
};

/** `WonderWebSurface`: the whole Wonder Web window, as one observation for one viewer. */
struct FWonderWebSurface
{
	bool bValid = false;
	FString Title;
	FString ObservedAtIso;
	FString ViewerUserId;
	TArray<FWonderWebTab> Tabs;
	FWonderWebAddress Address;
	FWonderWebViewport Viewport;
	FWonderWebTerminal Terminal;
	FWonderWebChrome Chrome;
	/** Empty when live. A sentence when something could not be observed -- rendered instead of guessed. */
	FString UnavailableReason;
};

/** Read one `WonderWebSurface` from its JSON. Strict: a missing field or an unknown viewport kind is not a surface. */
WONDERLAND_API bool WonderlandParseWonderWebSurface(const TSharedPtr<class FJsonObject>& Json, FWonderWebSurface& Out, FString& OutProblem);

/** One line the user's own terminal session added: what they typed, or what the preview answered. Never a creation log. */
struct FWonderWebSessionLine
{
	FString Text;
	bool bTyped = false;
};

/** The chrome and terminal actions. Each is refused unless the surface on screen allows it. */
enum class EWonderWebAction : uint8
{
	OpenSample,
	Stop,
	Restart,
	Rebuild,
	Reload,
	FailSample,
	Back,
	Forward
};

DECLARE_MULTICAST_DELEGATE(FOnWonderWebChanged);

UCLASS()
class WONDERLAND_API UWonderlandWonderWebSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** The surface for the selected tab: the viewer's own frame, or a peer's creation as the viewer may observe it. */
	const FWonderWebSurface& GetSurface() const;

	/** False when the preview file could not be read; GetProblem says why, and the surface renders that. */
	bool IsPreviewLoaded() const { return bLoaded; }
	const FString& GetProblem() const { return Problem; }

	/** Increments on every change a renderer should redraw for. */
	int32 GetRevision() const { return Revision; }
	FOnWonderWebChanged OnChanged;

	/** Choose a tab. Navigation only: what the tab allows still comes from its projection. */
	bool SelectTab(int32 Index);
	int32 GetSelectedTab() const { return SelectedTab; }

	/** Do what a chrome or terminal button does. False, and nothing happens, when the surface on screen does not allow it. */
	bool Act(EWonderWebAction Action);

	/** A line typed at the terminal prompt. Refused unless the surface's terminal accepts input. Never a shell. */
	bool SubmitTerminal(const FString& Line);
	void ClearTerminal();
	/** CLEAR hides the creation's lines up to this sequence number and this many of the session's own lines. */
	int32 GetClearedThroughSequence() const { return ClearedThroughSequence; }
	int32 GetClearedSessionLines() const { return ClearedSessionLines; }
	const TArray<FWonderWebSessionLine>& GetSessionLines() const { return SessionLines; }

	/** The preview frame the viewer's own view is on ("idle", "building_2", "running" ...), for tests and the log. */
	FName GetFrameName() const { return CurrentFrame; }

	// ---------------------------------------------------------------- the simulated creation's own state
	// PIXEL CANVAS, the sample creation: a grid the user paints. It lives here, not in the widget, so closing Wonder Web
	// and coming back finds the picture where it was left -- and Reload clears it, as reloading a page would.
	static constexpr int32 CanvasColumns = 16;
	static constexpr int32 CanvasRows = 9;
	static constexpr int32 PaletteSize = 5;
	/** Paint a cell with the selected colour; painting it again with the same colour clears it. Only while it runs. */
	bool PaintCell(int32 Index);
	void SelectPaint(int32 PaletteIndex);
	int32 GetSelectedPaint() const { return SelectedPaint; }
	/** 0 is unpainted, 1..PaletteSize a colour. */
	uint8 GetCell(int32 Index) const { return Canvas.IsValidIndex(Index) ? Canvas[Index] : 0; }
	int32 GetPaintedCells() const;
	bool ClearCanvas();

private:
	bool LoadPreview();
	void SetFrame(FName Frame);
	void Play(std::initializer_list<TPair<FName, float>> Steps);
	bool TickTimeline(float DeltaSeconds);
	void Say(const FString& Text, bool bTyped = false);
	bool IsMyViewSelected() const { return SelectedTab == 0; }
	const FWonderWebSurface* MyFrame() const;

	TMap<FName, FWonderWebSurface> MyView;
	/** In tab order, after MY VIEW. */
	TArray<FWonderWebSurface> PeerViews;
	FWonderWebSurface Unavailable;

	FName CurrentFrame = TEXT("idle");
	int32 SelectedTab = 0;
	TArray<TPair<FName, float>> Timeline;
	float TimelineClock = 0.0f;
	FTSTicker::FDelegateHandle Ticker;

	TArray<FWonderWebSessionLine> SessionLines;
	int32 ClearedThroughSequence = 0;
	int32 ClearedSessionLines = 0;

	TArray<uint8> Canvas;
	int32 SelectedPaint = 1;

	bool bLoaded = false;
	FString Problem;
	int32 Revision = 0;
};

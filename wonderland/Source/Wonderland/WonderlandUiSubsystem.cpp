#include "WonderlandUiSubsystem.h"

#include "Components/InputComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Engine/Texture2D.h"
#include "HAL/IConsoleManager.h"
#include "ImageUtils.h"
#include "Misc/Paths.h"
#include "GenericPlatform/GenericApplication.h"
#include "Input/Events.h"
#include "Input/HittestGrid.h"
#include "Framework/Application/SlateUser.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SConstraintCanvas.h"
#include "Widgets/SWindow.h"
#include "WonderlandCommandPresets.h"
#include "WonderlandCommandStation.h"
#include "WonderlandCompanionSubsystem.h"
#include "WonderlandCompanionTerminal.h"
#include "WonderlandHudPanels.h"
#include "WonderlandJuliusConnect.h"
#include "WonderlandJuliusStream.h"
#include "WonderlandJuliusSubsystem.h"
#include "WonderlandEntitlements.h"
#include "WonderlandSidekicks.h"
#include "WonderlandJuliusConnectPanel.h"
#include "WonderlandWonderWebBrowse.h"
#include "WonderlandWonderWebBrowserPanel.h"
#include "WonderlandWonderWebLive.h"
#include "WonderlandJuliusWorkLog.h"
#include "WonderlandLiveTerminal.h"
#include "WonderlandMiniMap.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandNavBar.h"
#include "WonderlandBrainSculpture.h"
#include "WonderlandProjectBrain.h"
#include "Engine/TextureRenderTarget2D.h"
#include "WonderlandProjectBrainPanel.h"
#include "WonderlandRelaySkins.h"
#include "EngineUtils.h"
#include "WonderlandCompanionEmbodiment.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "RelayDogCharacter.h"
#include "TimerManager.h"
#include "WonderlandMissionTasks.h"
#include "WonderlandSubAgentCubs.h"
#include "WonderlandCursor.h"
#include "WonderlandMissionOrb.h"
#include "WonderlandSkinStage.h"
#include "WonderlandTerritory.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandTravel.h"
#include "WonderlandUiStyle.h"
#include "WonderlandUsageHudWidget.h"
#include "WonderlandUsagePreview.h"
#include "WonderlandWallet.h"
#include "WonderlandMissionBeat.h"
#include "WonderlandMissionNarration.h"
#include "WonderlandWorldMap.h"
#include "WonderlandWonderWeb.h"
#include "WonderlandWonderWebPanel.h"
#include "WonderlandWonderWebScreen.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/WidgetComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandUi, Log, All);

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderWebWindowIds
{
	const FName Creation(TEXT("creation"));
	const FName Connections(TEXT("connections"));
	const FName Browser(TEXT("browser"));
	/** How many browser windows may be open at once. Each one is a real page in the runtime, so this is a memory bound. */
	/**
	 * The highest number a browser window id may carry. Not a limit on how many may be open -- that is the account's
	 * entitlement -- just the range of names this build will answer to, so a typo cannot invent a window.
	 */
	constexpr int32 MaxBrowserId = 12;
}

namespace WonderWebWorkspaceTuning
{
	TAutoConsoleVariable<float> CVarHudClearance(TEXT("wl.WonderWeb.HudClearance"), 8.0f,
		TEXT("Wonder Web workspace: uu kept between a tiled window and the HUD on screen (meters, wallet, mini-map, mission strip)."));
	TAutoConsoleVariable<float> CVarTileGap(TEXT("wl.WonderWeb.TileGap"), 18.0f, TEXT("Wonder Web workspace: uu between tiled windows."));
	TAutoConsoleVariable<float> CVarLoneSize(TEXT("wl.WonderWeb.LoneSize"), 1.15f, TEXT("Wonder Web workspace: a lone window's size, as a multiple of the multitasking size."));
	TAutoConsoleVariable<float> CVarExpandedSize(TEXT("wl.WonderWeb.ExpandedSize"), 1.6f, TEXT("Wonder Web workspace: an expanded window's size, as a multiple of the multitasking size."));
	TAutoConsoleVariable<int32> CVarAutoOpenPrompt(TEXT("wl.JuliusConnect.AutoOpenPrompt"), 1,
		TEXT("Julius Connect: bring the Connections window forward when Julius starts waiting on the user (1) or not (0)."));
}

namespace WonderlandUiHitTest
{
	/**
	 * What Slate finds at a desktop point inside ONE window, through that window's own hit-test grid -- what
	 * FSlateApplication::LocateWidgetInWindow does, which is protected. Used so a test click cannot be taken by an
	 * unrelated editor window the scripted editor happens to rank above the game at the same coordinates.
	 */
	FWidgetPath PathInWindow(const TSharedRef<SWindow>& Window, const FVector2D& At, int32 UserIndex)
	{
		if (!Window->IsVisible() || !Window->IsScreenspaceMouseWithin(At))
		{
			return FWidgetPath();
		}
		TArray<FWidgetAndPointer> Hits = Window->GetHittestGrid().GetBubblePath(At, 0.0f, false, UserIndex);
		return FWidgetPath(MakeArrayView(Hits));
	}
}

namespace
{
	// WHERE THE COMPANION TERMINALS SIT, as viewport anchors "minX minY maxX maxY". Between the HUD's readout
	// and the Julius terminal's side lists (which start at 0.708), one at each edge, the LLM Companion's on
	// the left under the HUD. Console variables, read every layout pass, so the panels can be placed in PIE.
	TAutoConsoleVariable<FString> CVarCompanionPanelLeft(
		TEXT("wl.Companion.PanelLeft"), TEXT("0.016 0.487 0.262 0.700"),
		TEXT("Anchors of the LLM Companion terminal: minX minY maxX maxY, fractions of the viewport."));
	TAutoConsoleVariable<FString> CVarCompanionPanelRight(
		TEXT("wl.Companion.PanelRight"), TEXT("0.738 0.487 0.984 0.700"),
		TEXT("Anchors of the Jhinn AI Agent terminal: minX minY maxX maxY, fractions of the viewport."));

	// The Project Brain hologram: a PNG read at attach, never an asset -- the world's art lane owns Content, and
	// this panel is a development preview. With no file the frame draws without the brain and says nothing false.
	TAutoConsoleVariable<FString> CVarBrainArtPath(
		TEXT("wl.Brain.ArtPath"), TEXT(""),
		TEXT("Absolute path of the Project Brain hologram PNG. Empty uses <project>/UiArt/ProjectBrainHologram.png."));

	FAnchors ParseAnchors(const FString& Text, const FAnchors& Fallback)
	{
		TArray<FString> Parts;
		Text.ParseIntoArrayWS(Parts);
		if (Parts.Num() != 4)
		{
			return Fallback;
		}
		float Values[4];
		for (int32 Index = 0; Index < 4; ++Index)
		{
			if (!FCString::IsNumeric(*Parts[Index]))
			{
				return Fallback;
			}
			Values[Index] = FMath::Clamp(FCString::Atof(*Parts[Index]), 0.0f, 1.0f);
		}
		if (Values[2] <= Values[0] || Values[3] <= Values[1])
		{
			return Fallback;
		}
		return FAnchors(Values[0], Values[1], Values[2], Values[3]);
	}
}

void UWonderlandUiSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	if (ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>())
	{
		ControllerChangedHandle = LocalPlayer->OnPlayerControllerChanged().AddUObject(this, &UWonderlandUiSubsystem::HandlePlayerControllerChanged);
		if (LocalPlayer->PlayerController != nullptr)
		{
			HandlePlayerControllerChanged(LocalPlayer->PlayerController);
		}
	}
	// Five readings a second: a string comparison each, and a write only when the followed run moved.
	LiveJuliusTicker = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateUObject(this, &UWonderlandUiSubsystem::TickLiveJulius), 0.2f);
}

void UWonderlandUiSubsystem::Deinitialize()
{
	if (RoleTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(RoleTicker);
		RoleTicker.Reset();
	}
	if (LiveJuliusTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(LiveJuliusTicker);
		LiveJuliusTicker.Reset();
	}
	Detach();
	if (ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>())
	{
		LocalPlayer->OnPlayerControllerChanged().Remove(ControllerChangedHandle);
	}
	Super::Deinitialize();
}

void UWonderlandUiSubsystem::HandlePlayerControllerChanged(APlayerController* NewController)
{
	if (NewController == BoundController.Get())
	{
		return;
	}
	Detach();
	if (NewController != nullptr && NewController->GetWorld() != nullptr && NewController->GetWorld()->IsGameWorld())
	{
		Attach(NewController);
	}
}

void UWonderlandUiSubsystem::Attach(APlayerController* Controller)
{
	BoundController = Controller;

	UiInput = NewObject<UInputComponent>(Controller, TEXT("WonderlandUiInput"));
	UiInput->Priority = 100;
	UiInput->BindKey(FInputChord(EKeys::T, false, true, false, false), IE_Pressed, this, &UWonderlandUiSubsystem::ToggleLiveTerminal);
	// CTRL+W IS WONDERLAND'S, not a browser's close-tab. It spawns a Wonder Web; the workspace's own input layer catches
	// it as well, so a page that has keyboard focus cannot swallow it (WonderlandWonderWebScreen.cpp).
	UiInput->BindKey(FInputChord(EKeys::W, false, true, false, false), IE_Pressed, this, &UWonderlandUiSubsystem::HandleSpawnWonderWebShortcut);
	UiInput->BindKey(EKeys::M, IE_Pressed, this, &UWonderlandUiSubsystem::ToggleWorldMap);
	UiInput->BindKey(EKeys::B, IE_Pressed, this, &UWonderlandUiSubsystem::ToggleProjectBrain);
	// THE BOTTOM STRIP'S KEYS, the letters its tiles show. INVENTORY's old I is deliberately not bound to anything.
	UiInput->BindKey(EKeys::J, IE_Pressed, this, &UWonderlandUiSubsystem::ToggleMissions);
	UiInput->BindKey(EKeys::C, IE_Pressed, this, &UWonderlandUiSubsystem::ToggleCommandStation);
	UiInput->BindKey(EKeys::Tab, IE_Pressed, this, &UWonderlandUiSubsystem::ToggleMenu);
	UiInput->BindKey(EKeys::LeftAlt, IE_Pressed, this, &UWonderlandUiSubsystem::BeginPointing);
	UiInput->BindKey(EKeys::LeftAlt, IE_Released, this, &UWonderlandUiSubsystem::EndPointing);
	Controller->PushInputComponent(UiInput);

	// The Project Brain hologram, read once per attach. A missing file is a drawn frame without a brain, logged
	// plainly: a panel that silently lost its centrepiece is the failure this project keeps paying for.
	FString ArtPath = CVarBrainArtPath.GetValueOnGameThread();
	if (ArtPath.IsEmpty())
	{
		ArtPath = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectDir(), TEXT("UiArt"), TEXT("ProjectBrainHologram.png")));
	}
	BrainArt = FImageUtils::ImportFileAsTexture2D(ArtPath);
	if (BrainArt != nullptr)
	{
		BrainArtBrush = MakeShared<FSlateBrush>();
		BrainArtBrush->SetResourceObject(BrainArt);
		BrainArtBrush->ImageSize = FVector2D(BrainArt->GetSizeX(), BrainArt->GetSizeY());
		BrainArtBrush->DrawAs = ESlateBrushDrawType::Image;
	}
	else
	{
		UE_LOG(LogWonderlandUi, Warning, TEXT("WLUI Project Brain hologram not read from %s; the panel draws without it"), *ArtPath);
	}
	if (UWonderlandProjectBrainSubsystem* BrainSubsystem = Brain())
	{
		BrainChangedHandle = BrainSubsystem->OnBrainChanged.AddUObject(this, &UWonderlandUiSubsystem::RefreshBrain);
	}
	if (UWonderlandJuliusConnectSubsystem* Connect = JuliusConnect())
	{
		JuliusConnectChangedHandle = Connect->OnChanged.AddUObject(this, &UWonderlandUiSubsystem::HandleJuliusConnectChanged);
	}
	if (UWonderlandSidekickSubsystem* Runtime = Sidekicks())
	{
		SidekicksChangedHandle = Runtime->OnChanged.AddUObject(this, &UWonderlandUiSubsystem::HandleSidekicksChanged);
	}

	// Before the HUD exists, so its first paint already shows the configured source. With the source
	// set to JuliusUsageAuthority this applies nothing and the HUD shows what the authority reports.
	const bool bPreview = WonderlandUsagePreview::ApplyIfConfigured(Controller->GetGameInstance());

	UsageHud = CreateWidget<UWonderlandUsageHudWidget>(Controller, UWonderlandUsageHudWidget::StaticClass());
	if (UsageHud != nullptr)
	{
		// Top left, compact: the swoosh is instrument furniture and must not cover the world.
		// ON THE PLAYER'S LAYER, BELOW THE PANELS. AddToViewport would put it in the viewport's
		// top overlay, above every per-player widget, and the HUD then drew across the open map.
		UsageHud->AddToPlayerScreen(10);
		UsageHud->SetAnchorsInViewport(FAnchors(0.0f, 0.0f, 0.0f, 0.0f));
		UsageHud->SetAlignmentInViewport(FVector2D(0.0, 0.0));
		UsageHud->SetPositionInViewport(FVector2D(30.0, 22.0), true);
		// THE + IS NOT HERE ANY MORE.
		//
		// FOUNDER CORRECTION: "REMOVE ADD TASK from the usage shelf / percentage HUD ... It must feel like a
		// terminal-level action, not a HUD/shelf-bar action." Adding a Julius task is opening another Julius
		// terminal, and it belongs beside the terminal it opens -- not next to a row of usage percentages, which
		// report consumption and have nothing to do with starting work.
		//
		// It now lives at the top of the Julius live terminal. See MakeTaskTabs in SWonderlandLiveTerminal.
		// Thirty units taller with the white LLM Companion meter: its third readout row takes that height,
		// so the art is drawn at the size it always was rather than shrinking to make room.
		const UWonderlandUsageHudSettings* HudSettings = GetDefault<UWonderlandUsageHudSettings>();
		const bool bThreeMeters = HudSettings != nullptr && HudSettings->bShowLlmCompanionMeter;
		UsageHud->SetDesiredSizeInViewport(FVector2D(400.0, bThreeMeters ? 500.0 : 470.0));
		++UsageHudCreations;
	}
	MountCompanionTerminals();
	MountHudFurniture();
	EnsureLiveTerminal();
	// EVERY COLOUR CHANGE REBUILDS THE CHROME THAT CARRIES IT. One subscription, so the Wardrobe's swatches,
	// the Menu's Colors tab and the console commands all reach the screen by the same route.
	if (!StyleChangedHandle.IsValid())
	{
		TWeakObjectPtr<UWonderlandUiSubsystem> WeakStyleThis(this);
		StyleChangedHandle = WonderlandMascotStyle::OnChanged().AddLambda([WeakStyleThis]()
		{
			if (UWonderlandUiSubsystem* Self = WeakStyleThis.Get())
			{
				Self->RefreshChrome();
			}
		});
	}
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI attached to %s (usage HUD %s%s, %d companion terminals, mini-map and shortcuts mounted; Ctrl+T J B C Tab, M map, hold Alt to point)"),
		*Controller->GetName(), UsageHud != nullptr ? TEXT("on screen") : TEXT("FAILED"), bPreview ? TEXT(", DEVELOPMENT PREVIEW reading") : TEXT(""),
		CompanionTerminals.Num());
}

void UWonderlandUiSubsystem::MountCompanionTerminals()
{
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	if (CompanionLayer.IsValid() || !UWonderlandCompanionSubsystem::IsPreviewEnabled()
		|| LocalPlayer == nullptr || LocalPlayer->ViewportClient == nullptr)
	{
		return;
	}
	const UWonderlandCompanionPreviewSettings* Settings = GetDefault<UWonderlandCompanionPreviewSettings>();
	const TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);

	// Each panel's accent is the colour its embodiment glows in: starlight for the LLM Companion, and the
	// imported-agent cyan-blue for the Jhinn -- the canon colour that says it came from outside Wonderland.
	TSharedPtr<SWonderlandCompanionTerminal> Llm;
	TSharedPtr<SWonderlandCompanionTerminal> Agent;
	SAssignNew(Llm, SWonderlandCompanionTerminal)
		.Title(Settings->LlmCompanionName)
		.Intro(TEXT("The LLM companion built\nfor Wonderland."))
		.Accent(WonderlandUi::Srgb(0xF4, 0xF7, 0xFF))
		.OnSubmit_Lambda([WeakThis](const FString& Text) { if (WeakThis.IsValid()) { WeakThis->HandleCompanionSubmit(0, Text); } })
		.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } });
	SAssignNew(Agent, SWonderlandCompanionTerminal)
		.Title(Settings->AgentName)
		.Intro(TEXT("The AI coding agent built\nfor Wonderland."))
		.Accent(WonderlandUi::Srgb(0x5C, 0xDB, 0xFF))
		.OnSubmit_Lambda([WeakThis](const FString& Text) { if (WeakThis.IsValid()) { WeakThis->HandleCompanionSubmit(1, Text); } })
		.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } });
	CompanionTerminals = {Llm, Agent};

	// THE THREE CONSOLES ARE ONE INSTRUMENT. Ctrl+T raises the Julius terminal and these two with it, and takes
	// all three away together (founder, 2026-09-15). Mounted once; shown with the terminal.
	CompanionLayer = SNew(SConstraintCanvas)
		.Visibility_Lambda([WeakThis]() { return WeakThis.IsValid() && WeakThis->IsLiveTerminalOpen() ? EVisibility::SelfHitTestInvisible : EVisibility::Collapsed; })
		+ SConstraintCanvas::Slot()
		.Anchors(TAttribute<FAnchors>::CreateLambda([]() { return ParseAnchors(CVarCompanionPanelLeft.GetValueOnGameThread(), FAnchors(0.016f, 0.487f, 0.262f, 0.700f)); }))
		.Offset(FMargin(0.0f))
		[
			Llm.ToSharedRef()
		]
		+ SConstraintCanvas::Slot()
		.Anchors(TAttribute<FAnchors>::CreateLambda([]() { return ParseAnchors(CVarCompanionPanelRight.GetValueOnGameThread(), FAnchors(0.738f, 0.487f, 0.984f, 0.700f)); }))
		.Offset(FMargin(0.0f))
		[
			Agent.ToSharedRef()
		];
	// Above the HUD's layer, below the terminal (50), the map (60) and the Project Brain (58).
	LocalPlayer->ViewportClient->AddViewportWidgetForPlayer(LocalPlayer, CompanionLayer.ToSharedRef(), 20);

	// ---- AND WONDERLAND'S OWN POINTER, if the founder has asked for one.
	//
	// Registered here because this is where the viewport is already in hand and known good. It is a no-op until
	// a cursor is actually chosen: an install that has not asked for one keeps the machine's own pointer.
	WonderlandCursor::Apply(LocalPlayer->ViewportClient);
}

void UWonderlandUiSubsystem::UnmountCompanionTerminals()
{
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	if (CompanionLayer.IsValid() && LocalPlayer != nullptr && LocalPlayer->ViewportClient != nullptr)
	{
		LocalPlayer->ViewportClient->RemoveViewportWidgetForPlayer(LocalPlayer, CompanionLayer.ToSharedRef());
	}
	CompanionLayer.Reset();
	CompanionTerminals.Reset();
}

void UWonderlandUiSubsystem::HandleCompanionSubmit(int32 Index, const FString& Text)
{
	if (!CompanionTerminals.IsValidIndex(Index) || !CompanionTerminals[Index].IsValid())
	{
		return;
	}
	const TSharedPtr<SWonderlandCompanionTerminal>& Panel = CompanionTerminals[Index];
	UWonderlandSidekickSubsystem* Runtime = Sidekicks();
	const FWonderlandSidekick* Sidekick = Runtime != nullptr ? Runtime->ByIndex(Index) : nullptr;
	// THE COMPANION IS REALLY ASKED, when there is really something behind it. The line appears when the runtime reports
	// the turn, so what is on screen is what was actually asked of a provider rather than a hopeful echo.
	if (Runtime != nullptr && Sidekick != nullptr && Runtime->GetLink() == EWonderlandSidekickLink::Online && Sidekick->State == TEXT("CONNECTED"))
	{
		Runtime->Ask(Sidekick->SidekickId, Text);
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI companion terminal %d asked its runtime: %d characters"), Index, Text.Len());
		return;
	}
	// Otherwise it is recorded as the visitor's own line and marked unsent -- with the reason, which is now a real one:
	// no runtime, or a companion that has no provider behind it yet.
	Panel->AddLine(TEXT("You"), Text, false);
	const FString Why = Runtime == nullptr || Runtime->GetLink() != EWonderlandSidekickLink::Online
		? FString::Printf(TEXT("Not sent: the companions' runtime is not running, so %s has nothing behind it."), *Panel->GetTitle())
		: FString::Printf(TEXT("Not sent: %s is %s. Connect a provider first."), *Panel->GetTitle(), *Sidekick->State.Replace(TEXT("_"), TEXT(" ")).ToLower());
	Panel->AddLine(FString(), Why, true);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI companion terminal %d line recorded, not sent: %d characters"), Index, Text.Len());
}

FString UWonderlandUiSubsystem::GetCompanionTerminalTitle(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid() ? CompanionTerminals[Index]->GetTitle() : FString();
}

FLinearColor UWonderlandUiSubsystem::GetCompanionTerminalAccent(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid()
		? CompanionTerminals[Index]->GetPaintedAccent() : FLinearColor::Transparent;
}

int32 UWonderlandUiSubsystem::GetCompanionTerminalLineCount(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid() ? CompanionTerminals[Index]->GetLineCount() : 0;
}

FString UWonderlandUiSubsystem::GetCompanionTerminalInputText(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid() ? CompanionTerminals[Index]->GetInputText() : FString();
}

bool UWonderlandUiSubsystem::FocusCompanionTerminal(int32 Index)
{
	// Only while the Julius terminal is up: that is when these panels are on screen at all.
	if (Open != EOverlay::Terminal || !CompanionTerminals.IsValidIndex(Index) || !CompanionTerminals[Index].IsValid() || !FSlateApplication::IsInitialized())
	{
		return false;
	}
	const TSharedPtr<SWidget> Focus = CompanionTerminals[Index]->GetFocusTarget();
	if (!Focus.IsValid())
	{
		return false;
	}
	FSlateApplication::Get().SetKeyboardFocus(Focus, EFocusCause::SetDirectly);
	return true;
}

void UWonderlandUiSubsystem::Detach()
{
	CloseOverlay();
	StopPointing(true);
	UnmountHudFurniture();
	UnmountCompanionTerminals();
	if (APlayerController* Controller = BoundController.Get())
	{
		if (UiInput != nullptr)
		{
			Controller->PopInputComponent(UiInput);
		}
	}
	UiInput = nullptr;
	if (UsageHud != nullptr)
	{
		UsageHud->RemoveFromParent();
		UsageHud = nullptr;
	}
	if (UWonderlandProjectBrainSubsystem* BrainSubsystem = Brain())
	{
		BrainSubsystem->OnBrainChanged.Remove(BrainChangedHandle);
	}
	BrainChangedHandle.Reset();
	if (UWonderlandJuliusConnectSubsystem* Connect = JuliusConnect())
	{
		Connect->OnChanged.Remove(JuliusConnectChangedHandle);
	}
	JuliusConnectChangedHandle.Reset();
	Terminal.Reset();
	WorldMap.Reset();
	BrainPanel.Reset();
	CommandStation.Reset();
	MissionsPanel.Reset();
	MenuPanel.Reset();
	WalletPanel.Reset();
	WonderWebPanel.Reset();
	ConnectPanel.Reset();
	BrowserPanels.Reset();
	WonderWebLayer.Reset();
	for (FWonderWebWindow& Window : WonderWebWindows)
	{
		if (AWonderlandWonderWebScreen* Screen = Window.Screen.Get())
		{
			Screen->Destroy();
		}
	}
	WonderWebWindows.Reset();
	if (AWonderlandWonderWebWorkspace* Workspace = WonderWebWorkspace.Get())
	{
		Workspace->Destroy();
	}
	WonderWebWorkspace.Reset();
	FocusedWonderWebWindow = NAME_None;
	BrainArtBrush.Reset();
	BrainArt = nullptr;
	BoundController.Reset();
	UsageHudCreations = 0;
}

UWorld* UWonderlandUiSubsystem::PlayerWorld() const
{
	const APlayerController* Controller = BoundController.Get();
	return Controller != nullptr ? Controller->GetWorld() : nullptr;
}

void UWonderlandUiSubsystem::ToggleLiveTerminal()
{
	if (Open == EOverlay::Terminal)
	{
		CloseOverlay();
	}
	else
	{
		OpenOverlay(EOverlay::Terminal);
	}
}

void UWonderlandUiSubsystem::ToggleWorldMap()
{
	if (Open == EOverlay::Map)
	{
		CloseOverlay();
	}
	else
	{
		OpenOverlay(EOverlay::Map);
	}
}

void UWonderlandUiSubsystem::OpenOverlay(EOverlay Which)
{
	APlayerController* Controller = BoundController.Get();
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	if (Controller == nullptr || LocalPlayer == nullptr || LocalPlayer->ViewportClient == nullptr || Which == EOverlay::None)
	{
		return;
	}
	if (Open != EOverlay::None)
	{
		CloseOverlay();
	}
	// A panel opened from a click: the pointer's hold on look input ends here, and the panel sets the input mode.
	StopPointing(false);

	const TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);
	TSharedPtr<SWidget> Panel;
	TSharedPtr<SWidget> Focus;
	int32 ZOrder = 50;
	if (Which == EOverlay::Terminal)
	{
		EnsureLiveTerminal();
		Panel = Terminal;
		Focus = Terminal->GetFocusTarget();
	}
	else if (Which == EOverlay::Brain)
	{
		if (!BrainPanel.IsValid())
		{
			// Created once and kept, like the terminal: proposals made in this session are still there on reopen.
			// THE WARDROBE'S LIVE DOG, made before the panel that draws it. A brush handed over null would leave the
			// view saying the preview is unavailable for the life of the panel, since the panel is built once and kept.
			UWonderlandRelaySkinSubsystem* SkinRegistry = RelaySkins();
			// SPAWNED HERE AND BOUND AGAIN LATER. Creating the stage in the same statement that reads its render
			// target is what made the first binding race the resource; the binding is now also redone every time
			// the wardrobe opens, so a handle taken too early cannot survive as a permanently white panel.
			AWonderlandSkinStage* Stage = SkinStage();
			if (Stage != nullptr && Stage->GetRenderTarget() != nullptr)
			{
				if (!SkinPreviewBrush.IsValid())
				{
					SkinPreviewBrush = MakeShared<FSlateBrush>();
				}
				SkinPreviewBrush->SetResourceObject(Stage->GetRenderTarget());
				SkinPreviewBrush->ImageSize = FVector2D(640.0, 800.0);
				SkinPreviewBrush->DrawAs = ESlateBrushDrawType::Image;
			}

			SAssignNew(BrainPanel, SWonderlandProjectBrainPanel)
				.HologramBrush(BrainArtBrush.IsValid() ? BrainArtBrush.Get() : nullptr)
				.SkinPreviewBrush(SkinPreviewBrush.IsValid() ? SkinPreviewBrush.Get() : nullptr)
				.Skins(SkinRegistry != nullptr ? SkinRegistry->GetSkins() : TArray<FWonderlandRelaySkin>())
				.EquippedSkin_Lambda([WeakThis]()
				{
					// READ, NEVER REMEMBERED. The registry is the one authority on what the Dog wears, so a skin
					// changed from the console shows on these cards without the panel being told.
					UWonderlandRelaySkinSubsystem* Registry = WeakThis.IsValid() ? WeakThis->RelaySkins() : nullptr;
					return Registry != nullptr ? Registry->GetEquippedSkinId() : NAME_None;
				})
				.OnChooseSkin_Lambda([WeakThis](FName SkinId)
				{
					if (UWonderlandRelaySkinSubsystem* Registry = WeakThis.IsValid() ? WeakThis->RelaySkins() : nullptr)
					{
						// The stage listens to the registry, so this one call dresses the Dog on the plinth too.
						Registry->EquipSkin(SkinId);
					}
				})
				.OnSkinPreviewPainted_Lambda([WeakThis]()
				{
					if (AWonderlandSkinStage* Watching = WeakThis.IsValid() ? WeakThis->SkinStage() : nullptr)
					{
						Watching->MarkWanted();
					}
				})
				.OnToggleInspect_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->ToggleWardrobeInspect(); } })
				.IsInspecting_Lambda([WeakThis]() { return WeakThis.IsValid() && WeakThis->IsWardrobeInspecting(); })
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
				.OnRequestTerminal_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::Terminal); } })
				.OnRequestMap_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::Map); } })
				.OnRequestWonderWeb_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::WonderWeb); } })
				.OnPropose_Lambda([WeakThis](FName SurfaceId, const FString& Text)
				{
					if (WeakThis.IsValid())
					{
						if (UWonderlandProjectBrainSubsystem* BrainSubsystem = WeakThis->Brain())
						{
							BrainSubsystem->Propose(SurfaceId, Text);
						}
					}
				})
				.OnReview_Lambda([WeakThis](FName SurfaceId, int32 LineIndex, bool bAccept)
				{
					if (WeakThis.IsValid())
					{
						if (UWonderlandProjectBrainSubsystem* BrainSubsystem = WeakThis->Brain())
						{
							BrainSubsystem->Review(SurfaceId, LineIndex, bAccept);
						}
					}
				});
		}
		// ONE DOOR INTO THE WARDROBE, NOT TWO -- AND THE SECOND ONE WAS THE PLAYER'S.
		//
		// Standing the brain sculpture down and framing the Dog into the window lived in SetBrainSkinsOpen below,
		// which is what every proof called. The panel's own SWITCH SKIN button called SetSkinsOpen on the WIDGET
		// (WonderlandProjectBrainPanel.cpp), so the founder clicking it opened the wardrobe with the brain still
		// staged and the camera still on it -- and the preview window is a HOLE, so what it showed was the brain
		// chamber: white background, black snow. Exactly the screenshot. Escape and the window's own X had the
		// same two-door problem in reverse.
		//
		// So staging hangs off the PANEL'S state change instead. Whatever route flips it -- button, X, Escape,
		// console, subsystem -- the world is staged once and the same way.
		BrainPanel->OnSkinsOpenChanged = [WeakThis](bool bNowOpen)
		{
			if (UWonderlandUiSubsystem* Self = WeakThis.Get())
			{
				Self->StageWardrobe(bNowOpen);
			}
		};
		RefreshBrain();
		Panel = BrainPanel;
		Focus = BrainPanel;
		ZOrder = 58;
	}
	else if (Which == EOverlay::Commands)
	{
		if (!CommandStation.IsValid())
		{
			SAssignNew(CommandStation, SWonderlandCommandStation)
				.Presets(TWeakObjectPtr<UWonderlandCommandPresetSubsystem>(Presets()))
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
				.OnRequestNavigate_Lambda([WeakThis](EWonderlandNavTarget Target) { if (WeakThis.IsValid()) { WeakThis->HandleNavigate(Target); } });
		}
		CommandStation->Refresh();
		Panel = CommandStation;
		Focus = CommandStation;
		ZOrder = 58;
	}
	else if (Which == EOverlay::Missions)
	{
		if (!MissionsPanel.IsValid())
		{
			SAssignNew(MissionsPanel, SWonderlandMissionsPanel)
				.Missions(TWeakObjectPtr<UWonderlandMissionSubsystem>(Missions()))
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
				.OnRequestNavigate_Lambda([WeakThis](EWonderlandNavTarget Target) { if (WeakThis.IsValid()) { WeakThis->HandleNavigate(Target); } });
		}
		Panel = MissionsPanel;
		Focus = MissionsPanel;
		ZOrder = 58;
	}
	else if (Which == EOverlay::WonderWeb)
	{
		AWonderlandWonderWebWorkspace* Workspace = EnsureWonderWebWorkspace(Controller);
		if (Workspace == nullptr)
		{
			UE_LOG(LogWonderlandUi, Warning, TEXT("WLUI wonder web: no workspace could be stood in this world"));
			return;
		}
		// WHERE THE PLAYER IS LOOKING, AHEAD OF THE DOG: the workspace stands there facing back toward them.
		Workspace->StandBefore(Controller);
		if (!WonderWebLayer.IsValid())
		{
			SAssignNew(WonderWebLayer, SWonderlandWonderWebInputLayer)
				.Controller(TWeakObjectPtr<APlayerController>(Controller))
				.GetScreens_Lambda([WeakThis]() { return WeakThis.IsValid() ? WeakThis->OpenWonderWebScreens() : TArray<AWonderlandWonderWebScreen*>(); })
				.OnFocus_Lambda([WeakThis](AWonderlandWonderWebScreen* Screen) { if (WeakThis.IsValid()) { WeakThis->FocusWonderWebScreen(Screen); } })
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
				// CTRL+W CAUGHT IN THE WORKSPACE TOO, so a page holding keyboard focus cannot take Wonderland's shortcut.
				.OnRequestSpawn_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->SpawnWonderWebWindow(); } });
		}
		if (!WonderWebWindows.ContainsByPredicate([](const FWonderWebWindow& Window) { return Window.bOpen; }))
		{
			if (FWonderWebWindow* Creation = EnsureWonderWebWindow(WonderWebWindowIds::Creation))
			{
				Creation->bOpen = true;
				Creation->OpenedOrder = ++WonderWebOpenCounter;
			}
		}
		for (FWonderWebWindow& Window : WonderWebWindows)
		{
			if (Window.bOpen)
			{
				PresentWonderWebWindow(Window);
			}
		}
		Controller->SetViewTargetWithBlend(Workspace, 0.8f, EViewTargetBlendFunction::VTBlend_Cubic);
		TileWonderWeb();
		const FWonderWebWindow* Focused = FindWonderWebWindow(FocusedWonderWebWindow);
		if (Focused == nullptr || !Focused->bOpen || Focused->bMinimized)
		{
			FocusedWonderWebWindow = MostRecentWonderWebWindow(NAME_None);
		}
		for (FWonderWebWindow& Window : WonderWebWindows)
		{
			if (AWonderlandWonderWebScreen* Screen = Window.Screen.Get())
			{
				Screen->SetFocused(Window.Id == FocusedWonderWebWindow);
			}
		}
		Panel = WonderWebLayer;
		Focus = WonderWebLayer;
		ZOrder = 40;
	}
	else if (Which == EOverlay::Wallet)
	{
		if (!WalletPanel.IsValid())
		{
			SAssignNew(WalletPanel, SWonderlandWalletPanel)
				.Wallet(TWeakObjectPtr<UWonderlandWalletSubsystem>(Wallet()))
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } });
		}
		Panel = WalletPanel;
		Focus = WalletPanel;
		ZOrder = 58;
	}
	else if (Which == EOverlay::Menu)
	{
		if (!MenuPanel.IsValid())
		{
			SAssignNew(MenuPanel, SWonderlandMenuPanel)
				.OnRequestWallet_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::Wallet); } })
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
				.OnRequestMap_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::Map); } })
				.OnRequestNavigate_Lambda([WeakThis](EWonderlandNavTarget Target) { if (WeakThis.IsValid()) { WeakThis->HandleNavigate(Target); } });
		}
		Panel = MenuPanel;
		Focus = MenuPanel;
		ZOrder = 58;
	}
	else
	{
		if (!WorldMap.IsValid())
		{
			SAssignNew(WorldMap, SWonderlandWorldMap)
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
				.OnTravel_Lambda([WeakThis](FName Id) { if (WeakThis.IsValid()) { WeakThis->HandleTravel(Id); } })
				.OnRequestTerminal_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::Terminal); } });
		}
		RefreshMap();
		Panel = WorldMap;
		Focus = WorldMap;
		ZOrder = 60;
	}

	LocalPlayer->ViewportClient->AddViewportWidgetForPlayer(LocalPlayer, Panel.ToSharedRef(), ZOrder);
	++OverlaysInViewport;
	Open = Which;
	ApplyOverlayInput(true, Focus);
	// THE BRAIN COMES ALIVE WITH ITS PANEL. Started after the panel is in the viewport, because the framing reads
	// the window's painted geometry and there is none until it has been laid out once.
	if (Which == EOverlay::Brain)
	{
		FrameBrainSculpture(true);
	}
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI open %s (panels in viewport: %d)"), OverlayName(Which), OverlaysInViewport);
}

void UWonderlandUiSubsystem::CloseOverlay()
{
	// THE WARDROBE IS SHUT BEFORE THE BRAIN IS, AND THE PANEL IS LEFT REMEMBERING NOTHING.
	//
	// Closing the Project Brain while the wardrobe stood open left bSkinsOpen TRUE on the widget, because nothing
	// ever put it back. The next time the brain was opened, OpenOverlay staged the brain sculpture and the panel
	// drew the wardrobe over it -- a skin preview window full of brain chamber, with no click on SWITCH SKIN
	// involved at all. That is the second half of the same screenshot.
	//
	// Staging is suppressed across this one call: the two lines below tear the whole lot down a moment later, and
	// re-framing the sculpture on the way out would be work done only to be undone.
	if (Open == EOverlay::Brain && BrainPanel.IsValid() && BrainPanel->IsSkinsOpen())
	{
		bSuppressWardrobeStaging = true;
		BrainPanel->SetSkinsOpen(false);
		bSuppressWardrobeStaging = false;
	}
	// THE CAMERA GOES BACK TO THE PLAYER whenever the panel closes by any route -- Escape, CLOSE, or a jump to
	// another overlay. The Dog needs no sending home: it is the player's own pawn, wearing the skin.
	FrameRelayDogInWardrobe(false);
	// AND THE BRAIN GOES WITH IT, by every one of those same routes: a sculpture and a camera that outlive their
	// panel would leave the founder looking at a brain with nothing on screen able to close it.
	FrameBrainSculpture(false);
	if (Open == EOverlay::None)
	{
		return;
	}
	const EOverlay Closing = Open;
	TSharedPtr<SWidget> Panel = OverlayWidget(Closing);
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	if (LocalPlayer != nullptr && LocalPlayer->ViewportClient != nullptr && Panel.IsValid())
	{
		LocalPlayer->ViewportClient->RemoveViewportWidgetForPlayer(LocalPlayer, Panel.ToSharedRef());
		--OverlaysInViewport;
	}
	Open = EOverlay::None;
	if (Closing == EOverlay::WonderWeb)
	{
		// BACK TO THE WORLD: the windows fold away and the camera glides back to the Dog. What each window shows -- what is
		// running, the connections, Julius's work -- stays in its subsystem, and the set of open windows is kept for next time.
		for (FWonderWebWindow& Window : WonderWebWindows)
		{
			if (AWonderlandWonderWebScreen* Screen = Window.Screen.Get())
			{
				Screen->Dismiss();
			}
		}
		if (APlayerController* Controller = BoundController.Get())
		{
			if (Controller->GetPawn() != nullptr)
			{
				Controller->SetViewTargetWithBlend(Controller->GetPawn(), 0.7f, EViewTargetBlendFunction::VTBlend_Cubic);
			}
		}
	}
	ApplyOverlayInput(false, nullptr);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI close %s (panels in viewport: %d)"), OverlayName(Closing), OverlaysInViewport);
}

void UWonderlandUiSubsystem::ApplyOverlayInput(bool bOverlayOpen, TSharedPtr<SWidget> Focus)
{
	APlayerController* Controller = BoundController.Get();
	if (Controller == nullptr)
	{
		return;
	}
	if (bOverlayOpen)
	{
		FInputModeUIOnly Mode;
		if (Focus.IsValid())
		{
			Mode.SetWidgetToFocus(Focus);
		}
		Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
		Controller->SetInputMode(Mode);
		Controller->SetShowMouseCursor(true);
		Controller->FlushPressedKeys();
		if (!bOverlayIgnoresInput)
		{
			Controller->SetIgnoreMoveInput(true);
			Controller->SetIgnoreLookInput(true);
			bOverlayIgnoresInput = true;
		}
		if (Focus.IsValid() && FSlateApplication::IsInitialized())
		{
			FSlateApplication::Get().SetKeyboardFocus(Focus, EFocusCause::SetDirectly);
		}
	}
	else
	{
		Controller->SetInputMode(FInputModeGameOnly());
		Controller->SetShowMouseCursor(false);
		if (bOverlayIgnoresInput)
		{
			Controller->SetIgnoreMoveInput(false);
			Controller->SetIgnoreLookInput(false);
			bOverlayIgnoresInput = false;
		}
		if (FSlateApplication::IsInitialized())
		{
			FSlateApplication::Get().SetAllUserFocusToGameViewport();
		}
	}
}

void UWonderlandUiSubsystem::RefreshMap()
{
	if (!WorldMap.IsValid())
	{
		return;
	}
	TArray<FWonderlandMapStop> Stops;
	FName Current = NAME_None;
	FString Notice;
	FVector2D PlayerXY = FVector2D::ZeroVector;
	bool bHasPlayer = false;

	UWorld* World = PlayerWorld();
	UWonderlandTravelSubsystem* Travel = World != nullptr ? World->GetSubsystem<UWonderlandTravelSubsystem>() : nullptr;
	if (Travel != nullptr)
	{
		for (const FWonderlandTravelDestination& Row : Travel->GetOfferedDestinations())
		{
			FWonderlandMapStop Stop;
			Stop.Row = Row;
			if (const AWonderlandTravelAnchor* Anchor = Travel->FindAnchor(Row.Id))
			{
				Stop.AnchorXY = FVector2D(Anchor->GetActorLocation().X, Anchor->GetActorLocation().Y);
			}
			Stops.Add(Stop);
		}
		Current = Travel->GetNearestOfferedDestination(3000.0);
		Notice = Travel->GetLastTravelReport();
	}
	if (const APlayerController* Controller = BoundController.Get())
	{
		if (const APawn* Pawn = Controller->GetPawn())
		{
			PlayerXY = FVector2D(Pawn->GetActorLocation().X, Pawn->GetActorLocation().Y);
			bHasPlayer = true;
		}
	}
	if (!PendingMapNotice.IsEmpty())
	{
		Notice = PendingMapNotice;
		PendingMapNotice.Reset();
	}
	if (Stops.Num() == 0)
	{
		Notice = TEXT("No developed place has an arrival point in this world yet.");
	}
	WorldMap->Refresh(Stops, Current, PlayerXY, bHasPlayer, Notice);
	// AND THE TERRITORIES WITH IT, so the strip's distances are from where the player is now.
	RefreshTerritories();
}

UWonderlandWonderWebSubsystem* UWonderlandUiSubsystem::WonderWebState() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandWonderWebSubsystem>() : nullptr;
}

UWonderlandJuliusConnectSubsystem* UWonderlandUiSubsystem::JuliusConnect() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusConnectSubsystem>() : nullptr;
}

UWonderlandSidekickSubsystem* UWonderlandUiSubsystem::Sidekicks() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
}

/**
 * THE COMPANION TERMINALS FOLLOW THE RUNTIME. State at the right of the title, the provider and model under it, and a
 * line when a turn actually ends -- the answer, marked SIMULATED while a fixture is behind it, or the plain reason it
 * failed. Nothing is added while a turn is in flight: the state says THINKING, which is what is true.
 */
void UWonderlandUiSubsystem::HandleSidekicksChanged()
{
	const UWonderlandSidekickSubsystem* Runtime = Sidekicks();
	if (Runtime == nullptr)
	{
		return;
	}
	CompanionShownAsk.SetNum(CompanionTerminals.Num());
	CompanionShownAnswer.SetNum(CompanionTerminals.Num());
	CompanionShownNote.SetNum(CompanionTerminals.Num());
	CompanionShownProvider.SetNum(CompanionTerminals.Num());
	for (int32 Index = 0; Index < CompanionTerminals.Num(); ++Index)
	{
		const TSharedPtr<SWonderlandCompanionTerminal>& Panel = CompanionTerminals[Index];
		const FWonderlandSidekick* Sidekick = Runtime->ByIndex(Index);
		if (!Panel.IsValid() || Sidekick == nullptr)
		{
			continue;
		}
		if (Runtime->GetLink() != EWonderlandSidekickLink::Online)
		{
			// NO RUNTIME IS NOT A MOOD: the terminal says the companion has nothing behind it, and how to change that.
			Panel->SetStatus(TEXT("OFFLINE"));
			if (CompanionShownNote[Index] != TEXT("offline"))
			{
				CompanionShownNote[Index] = TEXT("offline");
				Panel->AddLine(FString(), Runtime->GetLinkProblem(), true);
			}
			continue;
		}
		// THE EIGHT TRUTH STATES, as the founder named them, with the underscore turned into a space to read as words.
		// SHORT, deliberately: the state shares the title row with a name that can be long, and the state is the half that
		// must stay readable. Which provider and model is behind it goes on its own line, where there is room for both.
		Panel->SetStatus(Sidekick->State.Replace(TEXT("_"), TEXT(" ")));

		// One line about what is behind this companion, added only when it actually changes -- including when it changes
		// into a failure. Repeating AUTH REQUIRED three times tells the reader nothing the first line did not.
		const FString Note = Sidekick->Failure.IsEmpty()
			? FString::Printf(TEXT("%s · %s · %s — %s"), *Sidekick->ProviderName, *Sidekick->ModelId, *Sidekick->Mode, *Sidekick->Note)
			: FString::Printf(TEXT("%s: %s"), *Sidekick->Failure.Replace(TEXT("_"), TEXT(" ")), *Sidekick->Note);
		if (CompanionShownNote[Index] != Note)
		{
			CompanionShownNote[Index] = Note;
			Panel->AddLine(FString(), Note, true);
		}

		// WHAT IT WOULD TAKE TO MAKE THIS COMPANION REAL, said once, and only while it is answering from a fixture.
		//
		// The runtime already knows. It probes each real provider and reports exactly what is missing: an OpenAI
		// key that has never been connected, or a Claude Code that IS installed on this machine and has simply not
		// been allowed to spend anything yet. NONE OF THAT REACHED THE FOUNDER -- GetProviders() was read nowhere
		// outside the sidekick client's own proof string, so from inside Wonderland the companions said SIMULATED
		// and gave no way to find out why, or that a real provider was sitting there waiting for one decision.
		//
		// THE WORDS ARE THE RUNTIME'S OWN. This composes no advice, invents no next step, and grants no permission:
		// consent to spend is the founder's and is kept in the service, not here.
		if (Sidekick->Mode == TEXT("SIMULATED"))
		{
			FString Waiting;
			for (const FWonderlandSidekickProvider& Provider : Runtime->GetProviders())
			{
				if (Provider.Backs == Sidekick->Kind && !Provider.bReady)
				{
					Waiting = FString::Printf(TEXT("%s is not connected yet — %s"), *Provider.DisplayName, *Provider.Detail);
					break;
				}
			}
			if (CompanionShownProvider[Index] != Waiting)
			{
				CompanionShownProvider[Index] = Waiting;
				if (!Waiting.IsEmpty())
				{
					Panel->AddLine(FString(), Waiting, true);
				}
			}
		}

		// A turn that has started: show what was asked, once, whoever asked it (a terminal or a console command).
		if (Sidekick->bHasLiveTurn && CompanionShownAsk[Index] != Sidekick->LiveTurnId)
		{
			CompanionShownAsk[Index] = Sidekick->LiveTurnId;
			if (!Sidekick->LiveAsk.IsEmpty())
			{
				Panel->AddLine(TEXT("You"), Sidekick->LiveAsk, false);
			}
		}

		// A turn that has ended: the answer as it really came back, marked when it is a fixture's.
		const FString AnswerKey = FString::Printf(TEXT("%s|%d"), *Sidekick->SessionId, Sidekick->Turns);
		if (!Sidekick->bHasLiveTurn && !Sidekick->LastAnswer.IsEmpty() && CompanionShownAnswer[Index] != AnswerKey)
		{
			CompanionShownAnswer[Index] = AnswerKey;
			const FString Marked = Sidekick->Mode == TEXT("REAL")
				? Sidekick->LastAnswer
				: FString::Printf(TEXT("%s  [SIMULATED]"), *Sidekick->LastAnswer);
			Panel->AddLine(Panel->GetTitle(), Marked, false);
		}
	}
}

UWonderlandWonderWebBrowseSubsystem* UWonderlandUiSubsystem::BrowseState() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandWonderWebBrowseSubsystem>() : nullptr;
}

UWonderlandUiSubsystem::FWonderWebWindow* UWonderlandUiSubsystem::FindWonderWebWindow(FName Id)
{
	return WonderWebWindows.FindByPredicate([Id](const FWonderWebWindow& Window) { return Window.Id == Id; });
}

const UWonderlandUiSubsystem::FWonderWebWindow* UWonderlandUiSubsystem::FindWonderWebWindow(FName Id) const
{
	return WonderWebWindows.FindByPredicate([Id](const FWonderWebWindow& Window) { return Window.Id == Id; });
}

AWonderlandWonderWebWorkspace* UWonderlandUiSubsystem::EnsureWonderWebWorkspace(APlayerController* Controller)
{
	UWorld* World = Controller != nullptr ? Controller->GetWorld() : nullptr;
	AWonderlandWonderWebWorkspace* Workspace = WonderWebWorkspace.Get();
	if (Workspace != nullptr && Workspace->GetWorld() == World)
	{
		return Workspace;
	}
	if (World == nullptr)
	{
		return nullptr;
	}
	FActorSpawnParameters Params;
	Params.Name = MakeUniqueObjectName(World->GetCurrentLevel(), AWonderlandWonderWebWorkspace::StaticClass(), TEXT("WonderWebWorkspace"));
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;
	Workspace = World->SpawnActor<AWonderlandWonderWebWorkspace>(AWonderlandWonderWebWorkspace::StaticClass(), FTransform::Identity, Params);
	WonderWebWorkspace = Workspace;
	return Workspace;
}

UWonderlandUiSubsystem::FWonderWebWindow* UWonderlandUiSubsystem::EnsureWonderWebWindow(FName Id)
{
	APlayerController* Controller = BoundController.Get();
	if (Controller == nullptr || (Id != WonderWebWindowIds::Creation && Id != WonderWebWindowIds::Connections && !IsBrowserWindow(Id)))
	{
		return nullptr;
	}
	FWonderWebWindow* Window = FindWonderWebWindow(Id);
	if (Window == nullptr)
	{
		Window = &WonderWebWindows.AddDefaulted_GetRef();
		Window->Id = Id;
	}
	const TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);
	if (!Window->Content.IsValid())
	{
		if (Id == WonderWebWindowIds::Creation)
		{
			SAssignNew(WonderWebPanel, SWonderlandWonderWebPanel)
				.WonderWeb(TWeakObjectPtr<UWonderlandWonderWebSubsystem>(WonderWebState()))
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseWonderWebWindow(WonderWebWindowIds::Creation); } })
				// Return to project: out of Wonder Web and back to the project it was opened from.
				.OnRequestProject_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::Brain); } })
				.OnRequestMinimize_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(WonderWebWindowIds::Creation, true); } })
				.OnRequestExpand_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->ExpandWonderWebWindow(WonderWebWindowIds::Creation); } })
				// The window's menu opens Julius Connect beside it: a second window, in context, not a button on the HUD.
				.OnRequestConnections_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenWonderWebWindow(WonderWebWindowIds::Connections); } });
			Window->Content = WonderWebPanel;
			Window->ContentSize = SWonderlandWonderWebPanel::DesignSize();
			const TWeakObjectPtr<UWonderlandWonderWebSubsystem> WebState(WonderWebState());
			Window->Chip = SNew(SWonderWebWindowChip)
				.Title(INVTEXT("PIXEL CANVAS"))
				.Status_Lambda([WebState]()
				{
					if (!WebState.IsValid())
					{
						return FText::GetEmpty();
					}
					// LIVE WHILE FOLDED: the chip reads the creation as it is now.
					const FWonderWebSurface& Surface = WebState->GetSurface();
					return FText::FromString(Surface.Viewport.bRunning ? FString::Printf(TEXT("RUNNING  ·  %d CELLS PAINTED"), WebState->GetPaintedCells())
						: (Surface.Viewport.Status.IsEmpty() ? FString(TEXT("NOT RUNNING")) : Surface.Viewport.Status.ToUpper()));
				})
				.StatusColor(FSlateColor(WonderWebLook::Line(0.8f)))
				.OnRestore_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(WonderWebWindowIds::Creation, false); } });
		}
		else if (IsBrowserWindow(Id))
		{
			// A BROWSER WINDOW: Wonderland's shell outside, ordinary web pages inside (founder, 2026-09-17). There can be
			// several, and each has its own page in the runtime, named after the window.
			TSharedPtr<SWonderlandWonderWebBrowserPanel>& Panel = BrowserPanels.Add(Id);
			SAssignNew(Panel, SWonderlandWonderWebBrowserPanel)
				.Browse(TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem>(BrowseState()))
				.Connect(TWeakObjectPtr<UWonderlandJuliusConnectSubsystem>(JuliusConnect()))
				.Creation(TWeakObjectPtr<UWonderlandWonderWebSubsystem>(WonderWebState()))
				.LiveTab(Id.ToString())
				.OnRequestClose_Lambda([WeakThis, Id]() { if (WeakThis.IsValid()) { WeakThis->CloseWonderWebWindow(Id); } })
				.OnRequestMinimize_Lambda([WeakThis, Id]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(Id, true); } })
				.OnRequestExpand_Lambda([WeakThis, Id]() { if (WeakThis.IsValid()) { WeakThis->ExpandWonderWebWindow(Id); } });
			Window->Content = Panel;
			Window->ContentSize = SWonderlandWonderWebBrowserPanel::DesignSize();
			const TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem> BrowseWeak(BrowseState());
			Window->Chip = SNew(SWonderWebWindowChip)
				.Title(INVTEXT("WONDER WEB"))
				.Status_Lambda([BrowseWeak]()
				{
					if (!BrowseWeak.IsValid())
					{
						return INVTEXT("NO PAGES");
					}
					const FWonderWebBrowseTab* Tab = BrowseWeak->GetSelected();
					return FText::FromString(FString::Printf(TEXT("%d TABS  ·  %s"), BrowseWeak->GetModel().Tabs.Num(),
						Tab != nullptr ? *Tab->Url : TEXT("-")));
				})
				.StatusColor(FSlateColor(WonderWebLook::Line(0.8f)))
				.OnRestore_Lambda([WeakThis, Id]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(Id, false); } });
		}
		else
		{
			SAssignNew(ConnectPanel, SWonderlandJuliusConnectPanel)
				.Connect(TWeakObjectPtr<UWonderlandJuliusConnectSubsystem>(JuliusConnect()))
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseWonderWebWindow(WonderWebWindowIds::Connections); } })
				.OnRequestMinimize_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(WonderWebWindowIds::Connections, true); } })
				.OnRequestExpand_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->ExpandWonderWebWindow(WonderWebWindowIds::Connections); } });
			Window->Content = ConnectPanel;
			Window->ContentSize = SWonderlandJuliusConnectPanel::DesignSize();
			const TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> ConnectState(JuliusConnect());
			Window->Chip = SNew(SWonderWebWindowChip)
				.Title(INVTEXT("JULIUS CONNECT"))
				.Status_Lambda([ConnectState]()
				{
					if (!ConnectState.IsValid() || ConnectState->GetLink() != EJuliusConnectLink::Online)
					{
						return INVTEXT("OFFLINE");
					}
					const FJuliusConnectSurface& Surface = ConnectState->GetSurface();
					if (Surface.bHasPrompt)
					{
						return INVTEXT("JULIUS NEEDS YOUR APPROVAL");
					}
					const FJuliusConnectTask* Task = Surface.CurrentTask();
					return FText::FromString(Task != nullptr ? FString::Printf(TEXT("JULIUS  ·  %s"), *Task->RunState) : FString(TEXT("NO TASK")));
				})
				.StatusColor_Lambda([ConnectState]()
				{
					const bool bAsk = ConnectState.IsValid() && ConnectState->GetSurface().bHasPrompt;
					return FSlateColor(bAsk ? WonderWebLook::Fail() : WonderWebLook::Line(0.8f));
				})
				.OnRestore_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(WonderWebWindowIds::Connections, false); } });
		}
	}
	// THE WINDOW'S PLACE, in the controller's world.
	UWorld* World = Controller->GetWorld();
	AWonderlandWonderWebScreen* Screen = Window->Screen.Get();
	if (World != nullptr && (Screen == nullptr || Screen->GetWorld() != World))
	{
		FActorSpawnParameters Params;
		Params.Name = MakeUniqueObjectName(World->GetCurrentLevel(), AWonderlandWonderWebScreen::StaticClass(), *FString::Printf(TEXT("WonderWeb_%s"), *Id.ToString()));
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Params.ObjectFlags |= RF_Transient;
		Screen = World->SpawnActor<AWonderlandWonderWebScreen>(AWonderlandWonderWebScreen::StaticClass(), FTransform::Identity, Params);
		Window->Screen = Screen;
	}
	return Window;
}

void UWonderlandUiSubsystem::PresentWonderWebWindow(FWonderWebWindow& Window)
{
	AWonderlandWonderWebScreen* Screen = Window.Screen.Get();
	if (Screen == nullptr || !Window.Content.IsValid() || !Window.Chip.IsValid())
	{
		return;
	}
	Screen->Present(Window.ContentSize, SWonderWebWindowChip::DesignSize(), WonderWebWorkspace.Get());
	Screen->SetMinimized(Window.bMinimized);
	// Drawn by the workspace layer over where its glass stands.
	if (WonderWebLayer.IsValid())
	{
		WonderWebLayer->Present(Screen, Window.Content.ToSharedRef(), Window.ContentSize, Window.Chip.ToSharedRef(), SWonderWebWindowChip::DesignSize());
	}
}

TArray<AWonderlandWonderWebScreen*> UWonderlandUiSubsystem::OpenWonderWebScreens() const
{
	TArray<AWonderlandWonderWebScreen*> Screens;
	for (const FWonderWebWindow& Window : WonderWebWindows)
	{
		AWonderlandWonderWebScreen* Screen = Window.Screen.Get();
		if (Window.bOpen && Screen != nullptr && Screen->IsPresented())
		{
			Screens.Add(Screen);
		}
	}
	return Screens;
}

void UWonderlandUiSubsystem::FocusWonderWebScreen(AWonderlandWonderWebScreen* Screen)
{
	for (const FWonderWebWindow& Window : WonderWebWindows)
	{
		if (Screen != nullptr && Window.Screen.Get() == Screen)
		{
			FocusWonderWebWindow(Window.Id);
			return;
		}
	}
}

FName UWonderlandUiSubsystem::MostRecentWonderWebWindow(FName Except) const
{
	FName Best = NAME_None;
	int32 BestOrder = -1;
	for (const FWonderWebWindow& Window : WonderWebWindows)
	{
		if (Window.bOpen && !Window.bMinimized && Window.Id != Except && Window.OpenedOrder > BestOrder)
		{
			Best = Window.Id;
			BestOrder = Window.OpenedOrder;
		}
	}
	return Best;
}

AWonderlandWonderWebScreen* UWonderlandUiSubsystem::FocusedWonderWebScreen() const
{
	const FWonderWebWindow* Window = FindWonderWebWindow(FocusedWonderWebWindow);
	return Window != nullptr && Window->bOpen ? Window->Screen.Get() : nullptr;
}

bool UWonderlandUiSubsystem::FocusWonderWebWindow(FName Id)
{
	const FWonderWebWindow* Target = FindWonderWebWindow(Id);
	if (Target == nullptr || !Target->bOpen)
	{
		return false;
	}
	FocusedWonderWebWindow = Id;
	// THE WINDOW IN FRONT GETS THE FRAMES. A browser window behind another still moves, at a share of the rate.
	if (IsBrowserWindow(Id))
	{
		const APlayerController* Controller = BoundController.Get();
		UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
		if (UWonderlandWonderWebLiveSubsystem* LiveWeb = Instance != nullptr ? Instance->GetSubsystem<UWonderlandWonderWebLiveSubsystem>() : nullptr)
		{
			LiveWeb->SetFront(Id.ToString());
		}
	}
	for (FWonderWebWindow& Window : WonderWebWindows)
	{
		if (AWonderlandWonderWebScreen* Screen = Window.Screen.Get())
		{
			Screen->SetFocused(Window.Id == Id);
		}
	}
	return true;
}

void UWonderlandUiSubsystem::FrameRelayDogInWardrobe(bool bOn)
{
	APlayerController* Controller = BoundController.Get();
	UWorld* World = Controller != nullptr ? Controller->GetWorld() : nullptr;
	APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (World == nullptr || Pawn == nullptr)
	{
		return;
	}
	// ---- THE PLAYER'S OWN DOG STEPS OUT OF THE SHOT WHILE THE WARDROBE IS OPEN.
	//
	// The preview is staged on the ray that leaves the REAL camera through the centre of the window, and the
	// player's Dog is standing on very nearly that same ray -- that is why the spot is pinned to 55% of the way
	// to it. Photographed in PIE with ARDEN INFERNAL: 55% is not far enough, because Arden's burning mane
	// reaches toward the lens, and the window filled with a blown-out orange wall with the mannequin a sixth of
	// the frame behind it. No distance is safe here: every skin reaches a different way.
	//
	// Nothing is lost by hiding it. The Project Brain page covers the screen while the wardrobe is open, so the
	// only window onto the world is the preview square itself -- the one place the Dog must NOT be. The founder
	// asked for "no world bleed-through" in the preview, and this is what actually guarantees it, for every
	// skin, rather than hoping a clearance holds.
	auto ShowTheDog = [Pawn](bool bShow)
	{
		if (Pawn != nullptr)
		{
			Pawn->SetActorHiddenInGame(!bShow);
		}
		if (const ARelayDogCharacter* Relay = Cast<ARelayDogCharacter>(Pawn))
		{
			if (AActor* Worn = Relay->GetCostume())
			{
				Worn->SetActorHiddenInGame(!bShow);
			}
		}
	};
	ShowTheDog(!bOn);

	if (!bOn)
	{
		World->GetTimerManager().ClearTimer(WardrobeFrameTimer);
		// NOTHING TO GIVE BACK. The wardrobe no longer takes the view target, so closing it restores no camera
		// and plays no blend -- there is no trip out to the world to return from. The preview body goes home to
		// its viewing room instead.
		if (AWonderlandSkinStage* Stage = SkinStage())
		{
			Stage->SetInWorldPreview(false, FVector::ZeroVector, FRotator::ZeroRotator);
		}
		// THE BLACK GOES AWAY WITH THE WINDOW. Leaving a panel standing in the garden would be a prop the founder
		// walks into the moment the wardrobe closes, so it is destroyed rather than merely hidden.
		if (AActor* Backdrop = WardrobeBackdrop.Get())
		{
			Backdrop->Destroy();
		}
		WardrobeBackdrop.Reset();
		return;
	}
	// THE WINDOW HAS TO HAVE PAINTED ONCE before its place on screen is known, so the framing is done a tick after
	// the wardrobe opens and re-solved for a few frames while the panel settles into its layout.
	TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);
	World->GetTimerManager().SetTimer(WardrobeFrameTimer, FTimerDelegate::CreateWeakLambda(this, [WeakThis]()
	{
		UWonderlandUiSubsystem* Self = WeakThis.Get();
		APlayerController* PC = Self != nullptr ? Self->BoundController.Get() : nullptr;
		APawn* Dog = PC != nullptr ? PC->GetPawn() : nullptr;
		UWorld* W = PC != nullptr ? PC->GetWorld() : nullptr;
		if (Self == nullptr || Dog == nullptr || W == nullptr || !Self->BrainPanel.IsValid() || !Self->BrainPanel->IsSkinsOpen())
		{
			return;
		}
		FVector2D Centre, Size;
		if (!Self->BrainPanel->GetSkinPreviewRect(Centre, Size))
		{
			return;
		}
		// ---- how tall the thing IN THE WINDOW stands, and where its middle is
		const ARelayDogCharacter* Relay = Cast<ARelayDogCharacter>(Dog);
		// THE MANNEQUIN'S OWN HEIGHT, AND NOTHING ELSE'S.
		//
		// This took the MAX of the player's dressed height and the staged figure's, which was meant to stop a
		// halo being clipped. Photographed in PIE with Arden Infernal, it does the opposite: Arden's dressed
		// height on the PLAYER counts the flame reach, so Height came out far larger than the mannequin standing
		// in the window -- and every use of it is wrong by that ratio at once. The fit distance is too far, the
		// scale that compensates for it is too small, and the figure is dropped Height*Scale*0.5 below the ray,
		// so Arden came out a sixth of the frame and sitting near the bottom of it.
		//
		// What is in the window is the stage's mannequin. It is measured, it already includes whatever the skin
		// reaches to, and it is the only figure the framing has any business solving for. The player's dressed
		// height is the fallback for the frames before the mannequin exists, not a participant.
		float Height = Relay != nullptr ? Relay->GetDressedHeightUu() : 174.0f;
		// And how wide it is, read in the same place: the fit below is solved from the vertical angle alone,
		// so without this a halo or a banner is clipped at the window's SIDES however much height it is given.
		float FigureWide = 0.0f;
		// HOW FAR THE MIDDLE OF WHAT IS DRAWN SITS ABOVE THE ACTOR'S OWN ORIGIN. Never zero, and getting this
		// wrong is what cut the Dog's head off the top of the window.
		float FigureMiddle = 0.0f;
		// WHICH OF THE TWO BOUNDS BRANCHES BELOW ACTUALLY RAN. The declared envelope over-counts a flame by
		// design and the drawn bounds under-count a flame that is displaced by its material; knowing which one
		// framed a given skin is the first thing anyone debugging this needs and it was not recorded.
		bool bFramedOnDrawnBounds = false;
		// Kept for the framing note: which of the two measures won is the first thing anyone debugging a
		// mis-framed skin needs to know, and deriving it afterwards is guesswork.
		float EnvelopeTall = 0.0f;
		float EnvelopeSeen = 0.0f;
		if (const AWonderlandSkinStage* Staged = Self->SkinStage())
		{
			if (const AWonderlandCompanionEmbodiment* Shown = Staged->GetBody())
			{
				// ---- MEASURED FROM WHAT IS ON SCREEN, NOT FROM WHAT THE FIGURE FILE DECLARES.
				//
				// GetFigureHeightUu and GetFigureWidthUu are an ENVELOPE, not a size: they add a reach factor
				// to every glow group (Tall * 1.45, Fat * 1.15) so that a flame which animates outward is
				// counted before it gets there. That is right for deciding a safe distance and wrong for
				// filling a frame, and the difference is not small.
				//
				// MEASURED IN PIE with the wardrobe open: Arden Infernal's declared height is about 473 uu and
				// the bounds of what actually renders are 326 -- so a frame solved to 0.86 of the window put
				// the visible figure at 0.59 of it, which is precisely the "too much empty black space around
				// it" the founder photographed. Relay OG, which has no fire, came out at 0.87 from the same
				// code, which is why this was invisible until a skin with flames was measured.
				//
				// So the fit reads the rendered bounds and divides out the scale they were rendered at. That is
				// a fixed point -- the scale cancels -- and it re-solves every 0.08 s, so a skin that has only
				// half loaded is corrected on the next tick instead of being framed for good.
				// ---- FRAMED ON THE BODY, WITH THE EFFECTS LEFT OUT OF THE VOTE.
				//
				// FOUNDER, with video of a tiny mascot adrift in black: "Wardrobe framing MUST derive from
				// the physical mascot BODY, not total actor bounds ... Those effects can still render. They
				// simply must NOT determine camera distance." That names the fault precisely, and the two
				// mechanisms that produced it were both added here in the course of trying to fix it:
				//
				// AGGREGATE BOUNDS. GetComponentsBoundingBox counts every primitive the figure owns, so
				// Celestial Light's halo, Apollo's crown and Arden's fire were all voting on the camera
				// distance -- and an animated flame votes differently every frame.
				//
				// A DECAYING PEAK. To stop a pulsing flame clipping, the solve tracked the largest the figure
				// had been recently and decayed it 0.6% per tick. That is a memory: one big frame backed the
				// camera off and it STAYED off for many seconds, across skin switches and reopenings. A
				// framing that remembers is a framing that drifts, and drift is exactly the recurrence the
				// founder has now reported three times. Both are gone.
				//
				// GetFramingBodyBounds returns the union of the Lit and Rim meshes only -- the shell, the
				// plate, the bone, the cloth -- and nothing that glows. It is stateless: the same skin in the
				// same pose gives the same box every time, whatever the fire happened to be doing.
				const FVector Applied = Shown->GetActorScale3D();
				const float Uniform = FMath::Max(FMath::Abs(static_cast<float>(Applied.Z)), 0.001f);
				const FBox Drawn = Shown->GetFramingBodyBounds();
				if (Drawn.IsValid && Drawn.GetExtent().Z > 1.0)
				{
					bFramedOnDrawnBounds = true;
					const FVector Half = Drawn.GetExtent() / Uniform;
					Height = FMath::Max(static_cast<float>(Half.Z) * 2.0f, 60.0f);
					FigureWide = FMath::Max(static_cast<float>(Half.X), static_cast<float>(Half.Y)) * 2.0f;
					FigureMiddle = static_cast<float>(Drawn.GetCenter().Z - Shown->GetActorLocation().Z) / Uniform;
					EnvelopeTall = Shown->GetFigureHeightUu();
					EnvelopeSeen = Shown->GetFigureWidthUu();
				}
				else
				{
					// Nothing built yet: the declared envelope, which is at least the right order of size.
					const float Standing = Shown->GetFigureHeightUu();
					if (Standing > 60.0f)
					{
						Height = Standing;
					}
					FigureWide = Shown->GetFigureWidthUu();
					FigureMiddle = Shown->GetFigureLowestUu() + Height * 0.5f;
				}
			}
		}
		const FVector Sole = Dog->GetActorLocation() - FVector(0.0, 0.0, Dog->GetSimpleCollisionHalfHeight());
		const FVector LookAt = Sole + FVector(0.0, 0.0, Height * 0.47);

		// ---- the lens: the player's own field of view, so the framing maths matches what is drawn
		const float HFov = PC->PlayerCameraManager != nullptr ? PC->PlayerCameraManager->GetFOVAngle() : 90.0f;
		int32 VX = 0, VY = 0;
		PC->GetViewportSize(VX, VY);
		const float Aspect = VY > 0 ? static_cast<float>(VX) / static_cast<float>(VY) : 1.777f;
		const float TanH = FMath::Tan(FMath::DegreesToRadians(HFov * 0.5f));
		const float TanV = TanH / Aspect;
		// Distance so the Dog fills most of the window's height.
		// FOUNDER, 2026-09-25: "Bring the mascot skins closer to the frame in the wardrobe feature section."
		// 0.62 was set when Apollo's halo and Celestial Light's banner were being clipped at 0.74, and it left
		// a lot of black around every skin. The clipping is not really a height problem -- Height above is
		// already the MAX of the dressed height and the staged figure's own height, so an ornament that reaches
		// past the head is already counted. It was the WIDTH: a halo and a banner are wider than the body, and
		// a fit computed only from the vertical angle does not know that. So the figure is brought in to 0.80
		// and the widest-ornamented skins are given their width back explicitly, rather than every skin paying
		// for them with margin it does not need.
		// BOTH DIMENSIONS, AT THE SAME FILL. Solving only the vertical angle is what clipped Apollo's halo and
		// Celestial Light's banner at the window's sides, and pulling the whole fill back to 0.62 to hide it
		// made every OTHER skin small. So each axis gets its own fit distance and the camera takes whichever
		// is further: the figure then fills 0.80 of whichever axis binds, and nothing leaves the frame.
		// FOUNDER, 2026-09-25: "MAKE THE MASCOT PREVIEW MORE CLOSE-UP ... significantly larger than it is now ...
		// Target approximately 80-90% useful frame occupancy where the skin's silhouette allows it, while
		// retaining a small clean margin." 0.88 of whichever axis binds, both axes still solved separately, so
		// a halo or a mane is brought to the frame's edge rather than through it.
		const float Fill = 0.88f;
		const float WantTall = FMath::Max(Size.Y * Fill, 0.05f);
		const float WantWide = FMath::Max(Size.X * Fill, 0.05f);
		const float FitTall = Height / (WantTall * 2.0f * TanV);
		const float FitWide = FigureWide > 1.0f ? FigureWide / (WantWide * 2.0f * TanH) : 0.0f;
		// THE CEILING WAS THE THING BINDING ARDEN, not the bounds. Logged mid-framing: Arden Infernal asks for
		// fitWide 1642 and this clamp handed back 1400, so the widest skin in the set could never be given the
		// distance its own mane needed and was cut off by the window no matter how the bounds were measured.
		// Three separate attempts at the bounds moved nothing because none of them was what was binding.
		// The camera does not actually stand at this distance -- it is pinned to dogAway * 0.55 and the figure
		// is scaled by distance/fit to match -- so this is a scale denominator, not a real camera position,
		// and a larger ceiling costs nothing.
		const float FitDistance = FMath::Clamp(FMath::Max(FitTall, FitWide), 140.0f, 4000.0f);
		float Distance = FitDistance;

		// ---- IN FRONT OF THE PLAYER'S OWN DOG, WHICH IS WHAT WAS IN THE WINDOW ALL ALONG.
		//
		// Measured in PIE with Apollo worn: the preview mannequin WAS being staged correctly, 832 uu out along
		// the ray through the window's centre -- and the player's own Dog, wearing the same skin, stood at 297 uu
		// squarely between it and the lens. The gold filling the preview square was the PLAYER'S halo seen from
		// inside, not the preview at all, which is why widening the chamber and re-framing on the staged figure
		// both changed nothing: the chamber was doing its job 500 uu behind the thing that was blocking it.
		//
		// A backdrop cannot hide what stands in front of the subject, so the subject comes in front instead.
		const float DogAway = static_cast<float>(FVector::Dist(
			PC->PlayerCameraManager != nullptr ? PC->PlayerCameraManager->GetCameraLocation() : Dog->GetActorLocation(),
			Dog->GetActorLocation()));
		if (DogAway > 1.0f)
		{
			Distance = FMath::Min(Distance, DogAway * 0.55f);
		}
		// Sized for where it ended up, so coming closer does not make it enormous: the apparent size stays
		// whatever the window asked for.
		const float PreviewScale = FMath::Clamp(Distance / FMath::Max(FitDistance, 1.0f), 0.05f, 1.0f);
		// The Dog must sit at the window's centre, which is off the screen's centre: aim the lens away from the
		// Dog by exactly that angle. Screen y runs downward.
		const float YawOff = FMath::RadiansToDegrees(FMath::Atan((Centre.X - 0.5f) * 2.0f * TanH));
		const float PitchOff = FMath::RadiansToDegrees(FMath::Atan((Centre.Y - 0.5f) * 2.0f * TanV));

		// ---- a clear eye, in front of the face first. Bystanders (companions, cubs) have no collision and are
		// ---- kept out of the shot by distance rather than by trace.
		TArray<FVector> Bystanders;
		for (TActorIterator<AWonderlandCompanionEmbodiment> It(W); It; ++It)
		{
			if (Relay == nullptr || *It != Relay->GetCostume()) { Bystanders.Add(It->GetActorLocation()); }
		}
		for (TActorIterator<AWonderlandSubAgentCub> It(W); It; ++It) { Bystanders.Add(It->GetActorLocation()); }
		FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandWardrobeCamera), false);
		Params.AddIgnoredActor(Dog);
		if (Relay != nullptr && Relay->GetCostume() != nullptr) { Params.AddIgnoredActor(Relay->GetCostume()); }
		const float BaseYaw = Dog->GetActorRotation().Yaw;
		static const float Offsets[] = { 0.0f, -30.0f, 30.0f, -60.0f, 60.0f, -90.0f, 90.0f, 180.0f };
		FVector Eye = LookAt + Dog->GetActorForwardVector() * Distance + FVector(0.0, 0.0, Height * 0.12);
		for (float Off : Offsets)
		{
			const FVector Dir = FRotator(0.0, BaseYaw + Off, 0.0).Vector();
			const FVector Candidate = LookAt + Dir * Distance + FVector(0.0, 0.0, Height * 0.12);
			bool bCrowded = false;
			for (const FVector& B : Bystanders)
			{
				if (FVector::Dist2D(B, Candidate) < 200.0f) { bCrowded = true; break; }
				const FVector Seg = LookAt - Candidate;
				const float T = FMath::Clamp(FVector::DotProduct(B - Candidate, Seg) / FMath::Max(Seg.SizeSquared(), 1.0), 0.0, 1.0);
				if (FVector::Dist2D(Candidate + Seg * T, B) < 120.0f) { bCrowded = true; break; }
			}
			if (bCrowded) { continue; }
			FHitResult Hit;
			if (W->LineTraceSingleByChannel(Hit, Candidate, LookAt, ECC_Camera, Params)) { continue; }
			FHitResult Above;
			if (W->LineTraceSingleByChannel(Above, Candidate + FVector(0.0, 0.0, 250.0), Candidate, ECC_Camera, Params)) { continue; }
			Eye = Candidate;
			break;
		}

		// ---- the camera actor, reused
		ACameraActor* Cam = Self->WardrobeCamera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters SpawnParams;
			SpawnParams.ObjectFlags |= RF_Transient;
			Cam = W->SpawnActor<ACameraActor>(ACameraActor::StaticClass(), FTransform(Eye), SpawnParams);
			if (Cam == nullptr) { return; }
#if WITH_EDITOR
			Cam->SetActorLabel(TEXT("WL_WardrobeCamera"), false);
#endif
			Self->WardrobeCamera = Cam;
		}
		FRotator Aim = (LookAt - Eye).Rotation();
		Aim.Yaw -= YawOff;
		Aim.Pitch += PitchOff;
		Cam->SetActorLocationAndRotation(Eye, Aim);
		if (UCameraComponent* Lens = Cam->GetCameraComponent())
		{
			Lens->SetFieldOfView(HFov);
			Lens->bConstrainAspectRatio = false;
		}
		// ---- THE BLACK BEHIND THE DOG, on the camera's own axis so it is always square to the lens.
		// The window is a hole, so whatever the Dog stands in front of IS the wardrobe's background: a brick wall
		// one time, a flower bed the next, a companion wandering through the shot. The founder's reference plates
		// are all read against black, and a premium skin cannot be judged against a different garden each time.
		// Parked beyond the Dog and scaled past the frame's far corners, it fills the window and nothing else.
		AActor* Backdrop = Self->WardrobeBackdrop.Get();
		if (Backdrop == nullptr)
		{
			FActorSpawnParameters BackdropParams;
			BackdropParams.ObjectFlags |= RF_Transient;
			BackdropParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Backdrop = W->SpawnActor<AActor>(AActor::StaticClass(), FTransform::Identity, BackdropParams);
			if (Backdrop != nullptr)
			{
				// A CYCLORAMA, NOT A PANEL. A vertical sheet behind the Dog cannot hide the garden FLOOR, because
				// the floor runs from under the Dog toward the lens and fills the bottom of the frame in front of
				// anything standing behind him -- the first build left the lower third of the window as paving.
				// So: a wall behind, and a black deck under the Dog running back to meet it.
				UStaticMeshComponent* Panel = NewObject<UStaticMeshComponent>(Backdrop, TEXT("WardrobeBlackWall"));
				Backdrop->SetRootComponent(Panel);
				UStaticMeshComponent* Deck = NewObject<UStaticMeshComponent>(Backdrop, TEXT("WardrobeBlackDeck"));
				Deck->SetupAttachment(Panel);
				UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
				UMaterialInstanceDynamic* Black = nullptr;
				// UNLIT, WHICH IS THE WHOLE DIFFERENCE. BasicShapeMaterial is LIT, so a wall painted 0.008 black
				// still takes the garden's sunlight and came back grey-brown -- photographed in PIE the preview's
				// "black" was a lit slab with a visible sunlit edge. An unlit material renders exactly the colour
				// it is given whatever the sun is doing, which is what a backdrop has to do.
				UMaterialInterface* Flat = LoadObject<UMaterialInterface>(
					nullptr, TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial"));
				if (Flat == nullptr)
				{
					Flat = LoadObject<UMaterialInterface>(
						nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
					UE_LOG(LogWonderlandUi, Warning,
						TEXT("WLUI wardrobe backdrop fell back to a LIT material; the preview will not read as black"));
				}
				if (UMaterialInterface* Plain = Flat)
				{
					Black = UMaterialInstanceDynamic::Create(Plain, Backdrop);
					// NOT PURE ZERO: a hair above black keeps the panel from flattening into the HUD's own
					// dark chrome, so the window still reads as a lit space the Dog is standing in.
					if (Black != nullptr)
					{
						Black->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.008f, 0.009f, 0.013f, 1.0f));
					}
				}
				for (UStaticMeshComponent* Part : { Panel, Deck })
				{
					Part->RegisterComponent();
					Part->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
					Part->SetCastShadow(false);
					if (Cube != nullptr) { Part->SetStaticMesh(Cube); }
					if (Black != nullptr) { Part->SetMaterial(0, Black); }
				}
#if WITH_EDITOR
				Backdrop->SetActorLabel(TEXT("WL_WardrobeBackdrop"), false);
#endif
				Self->WardrobeBackdrop = Backdrop;
			}
		}
		if (Backdrop != nullptr)
		{
			// Far enough behind the Dog that its own shadow and any ground contact stay off it, and wide enough
			// that the frame's corners are still panel at this distance.
			// THE SQUARE, AND ONLY THE SQUARE. Sized to the whole frame, this blacked out the entire garden behind
			// the panel -- the founder's words were "not the world turning black". What he asked for is the
			// wardrobe's own window reading as a black screen with the skin standing on it, so the panel is cut
			// to the WINDOW's angular size (Size is that window as a fraction of the viewport) and centred on the
			// Dog, who is already framed at the window's middle. Outside the window the world is untouched.
			const FVector Away = (LookAt - Eye).GetSafeNormal2D();
			const float Behind = Distance * 1.35f;
			// TIGHT ACROSS, GENEROUS UP AND DOWN. Horizontally the panel must not spill past the window or it
			// starts blacking the garden either side of it. Vertically it can be over-large safely: the screen
			// area above and below the window is panel chrome, not world. A tight vertical margin is what made
			// this inconsistent -- Apollo's square came out black and Hagoromo's showed brick across its lower
			// half, because each skin's figure height changes the camera distance and with it the fit.
			const float HalfW = (Distance + Behind) * TanH * FMath::Max(Size.X, 0.05f) * 1.15f;
			const float HalfH = (Distance + Behind) * TanV * FMath::Max(Size.Y, 0.05f) * 2.40f;
			const FVector At = LookAt + Away * Behind;
			// The engine cube is 100 uu across, so scale is half-extent/50. The wall is turned to face the lens on
			// the horizontal only -- a wall that pitches to face a slightly-raised camera would lift its own base
			// off the ground and show a bright seam under it.
			const FRotator Facing(0.0, (Eye - At).Rotation().Yaw, 0.0);
			Backdrop->SetActorLocationAndRotation(At, Facing);
			Backdrop->SetActorScale3D(FVector(0.04f, FMath::Max(HalfW, 60.0f) / 50.0f, FMath::Max(HalfH, 60.0f) / 50.0f));
			if (AActor* BackdropActor = Backdrop)
			{
				TArray<UStaticMeshComponent*> Parts;
				BackdropActor->GetComponents<UStaticMeshComponent>(Parts);
				for (UStaticMeshComponent* Part : Parts)
				{
					if (Part == nullptr || Part->GetFName() != TEXT("WardrobeBlackDeck")) { continue; }
					// THE DECK, in the wall's own frame. It reaches from the wall forward past the Dog's feet to
					// well in front of the lens, and sits a little below the feet so the Dog is not cut off at the
					// ankle by its own stage. Parent scale is (0.04, W, H), so the child's scale is divided
					// through by it to come out square in world space.
					// FORWARD ONLY AS FAR AS THE WINDOW SEES. Running the deck out past the lens turned the whole
					// garden floor black along with the window; it only has to reach the Dog's feet and a little
					// past them, because beyond that it is outside the square.
					const float Forward = Behind + Distance * 1.10f;
					const FVector ParentScale(0.04f, FMath::Max(HalfW, 60.0f) / 50.0f, FMath::Max(HalfH, 60.0f) / 50.0f);
					Part->SetRelativeScale3D(FVector((Forward / 50.0f) / ParentScale.X,
													 1.0f,
													 (4.0f / 50.0f) / ParentScale.Z));
					// THE GROUND IS TRACED, NOT DERIVED. This was computed from the figure's height, and figure
					// height differs per skin -- so the deck landed correctly for Apollo and far too low for
					// Hagoromo, which showed the founder brick wall across half its window. The floor the Dog is
					// actually standing on is a trace away, and it is the same floor for every skin.
					//
					// ON ECC_Camera, AND THAT IS THE WHOLE FIX. This traced on ECC_Visibility, which THIS MAP'S
					// PAVING DOES NOT ANSWER -- the fact is recorded forty lines below, where the preview-spot
					// sweep rejected every candidate for the same reason, and every other ground trace in the
					// project (the clearance bubble, the wardrobe camera, the brain sculpture) is on Camera. So
					// the trace found nothing, fell silently back to the derived height above, and the comment
					// swearing the ground was traced has been describing something that never happened. That
					// derived height is exactly the one the founder saw as brick across half the window.
					float GroundZ = Dog->GetActorLocation().Z - Height * 0.5f;
					FHitResult Ground;
					FCollisionQueryParams GroundParams(SCENE_QUERY_STAT(WonderlandWardrobeDeck), false);
					GroundParams.AddIgnoredActor(Dog);
					if (Relay != nullptr && Relay->GetCostume() != nullptr) { GroundParams.AddIgnoredActor(Relay->GetCostume()); }
					const FVector From = Dog->GetActorLocation();
					if (W->LineTraceSingleByChannel(Ground, From, From - FVector(0.0, 0.0, 600.0), ECC_Camera, GroundParams))
					{
						GroundZ = Ground.ImpactPoint.Z;
					}
					// A HAIR ABOVE THE REAL FLOOR, so the deck hides it instead of z-fighting with it.
					const float DropToDeck = (LookAt.Z - GroundZ) - 1.5f;
					Part->SetRelativeLocation(FVector(Forward * 0.5f / ParentScale.X, 0.0f,
													  -DropToDeck / ParentScale.Z));
				}
			}
		}

		// THE CAMERA DOES NOT MOVE. THAT WAS THE BUG.
		//
		// FOUNDER, reported repeatedly: "When I am inside PROJECT BRAIN and click a mascot skin: IT MUST NOT
		// TAKE ME BACK INTO WONDERLAND." What stood here was SetViewTargetWithBlend(Cam) -- the wardrobe took
		// the player's view target and flew it out to wherever the Dog was standing in the garden. Project
		// Brain never closed, which is why every test that asked IsProjectBrainOpen() came back true and I kept
		// reporting it fixed; what actually happened is that the founder was looking at Wonderland through a
		// borrowed camera. The panel was still there, behind a view of the world.
		//
		// So the SUBJECT COMES TO THE WINDOW instead of the window going to the subject. The real camera stays
		// exactly where it is; the preview body is placed along the ray that leaves the real camera through the
		// centre of the wardrobe's window, at the distance that makes it fill the frame. Nothing is possessed,
		// no view target is set, no blend is played, and the player never leaves Project Brain.
		if (Cam != nullptr)
		{
			Cam->Destroy();
			Self->WardrobeCamera.Reset();
		}
		const APlayerCameraManager* Lens = PC->PlayerCameraManager;
		if (Lens == nullptr)
		{
			return;
		}
		const FVector RealEye = Lens->GetCameraLocation();
		const FRotator RealAim = Lens->GetCameraRotation();
		// The ray through the window's centre: the screen offset turned back into an angle off the real axis.
		FRotator Through = RealAim;
		Through.Yaw += YawOff;
		Through.Pitch -= PitchOff;
		const FVector Spot = RealEye + Through.Vector() * Distance;
		if (AWonderlandSkinStage* Stage = Self->SkinStage())
		{
			// The stage's own mannequin, not the player's Dog: the Dog stays where it is in the world, and the
			// body in the window is the one that wears whatever card was clicked (the stage listens to the skin
			// registry, so a click re-dresses it without anything here being told about it).
			// THE FIGURE'S MIDDLE ON THE RAY, NOT THE ACTOR'S.
			//
			// A figure does not start at its actor origin: the boxes begin at FigureLowestUu above it, and for
			// the Relay Dog that is most of a shin. Dropping the body by half its HEIGHT therefore left it
			// riding high by that base -- photographed with Relay OG at Fill 0.88 the head was cut off by the
			// top of the window and there was a band of empty black under the feet. Half the height PLUS the
			// base is where the middle of the figure actually is.
			const float MiddleAbove = FigureMiddle * PreviewScale;
			// THE BOX'S CENTRE ON THE RAY, NOT THE ACTOR'S ORIGIN, on all three axes now. The vertical half of
			// this was already here and was what stopped the Dog's head being cut off; the sideways half is
			// what stops Arden hanging off the left edge of the window. Both are the same measurement.
			// ---- THE SIDEWAYS DRIFT IS MEASURED AND DELIBERATELY NOT APPLIED.
			//
			// It was added to stop Arden Infernal hanging off the left edge of the window, back when I still
			// believed that was a framing fault. It was not -- the bright shape in the corner was the plaza
			// showing past a backdrop parked 254 uu too far away -- and with that fixed, centring the drawn
			// BOX turns out to push the BODY off centre, because a mane or a banner hangs to one side and the
			// box centre is not the figure's. Measured across the five skins it shifted every one of them
			// left, by an amount that scaled with how much fire the skin has: Arden by 0.114 of the window
			// against a 0.1 tolerance, the others by 0.03 to 0.06.
			//
			// A wardrobe centres the MASCOT, so the actor's own origin goes on the ray and the fire is allowed
			// to hang where the artist hung it. The measurement is kept because it is the honest description
			// of how far off-centre a silhouette is, and the framing note reports it.
			const FVector2D Drift = FVector2D::ZeroVector;
			Self->WardrobeFramingNote = FString::Printf(
				TEXT("height=%.1f wide=%.1f middle=%.1f fitTall=%.0f fitWide=%.0f fit=%.0f dogAway=%.0f ")
				TEXT("distance=%.0f scale=%.3f drift=(%.1f,%.1f) winSize=(%.3f,%.3f) winCentre=(%.3f,%.3f) ")
				TEXT("tanH=%.3f aspect=%.3f bounds=%s envelope=%.1f envelopeWide=%.1f"),
				Height, FigureWide, FigureMiddle, FitTall, FitWide, FitDistance, DogAway,
				Distance, PreviewScale, Self->WardrobeDrift.X, Self->WardrobeDrift.Y,
				Size.X, Size.Y, Centre.X, Centre.Y, TanH, Aspect,
				bFramedOnDrawnBounds ? TEXT("drawn") : TEXT("declared"), EnvelopeTall, EnvelopeSeen);
			Stage->SetInWorldPreview(true,
				Spot - FVector(Drift.X, Drift.Y, MiddleAbove),
				(RealEye - Spot).GetSafeNormal2D().Rotation());
			Stage->SetActorScale3D(FVector(PreviewScale, PreviewScale, PreviewScale));
			if (AWonderlandCompanionEmbodiment* Shown = Stage->GetBody())
			{
				Shown->SetActorScale3D(FVector(PreviewScale, PreviewScale, PreviewScale));
			}
		}

		// AND THE BLACK GOES BEHIND THE NEW SPOT, not the old one.
		//
		// The backdrop above was placed relative to the virtual camera this function used to fly the player to.
		// Once the subject started coming to the window instead, that camera stopped existing -- so the black
		// panel was still being parked out in the garden while the preview window showed whatever the REAL
		// camera happened to be pointing at. The founder's words: "Wardrobe still does NOT have the correct
		// black background preview area." It was there, behind the wrong thing.
		//
		// Squarely across the ray, far enough past the figure to clear it, and big enough that the window's
		// corners are still panel at that distance.
		if (AActor* Black = Self->WardrobeBackdrop.Get())
		{
			const FVector Ray = Through.Vector();
			// ---- JUST BEHIND THE FIGURE, NOT HALF A ROOM BEHIND IT.
			//
			// THE BUG THIS FIXES, and it wore a framing bug's clothes for four attempts. Photographed with
			// Arden Infernal worn, the preview square showed an orange-lit WALL with a STAIRCASE across its
			// bottom-left corner -- the Golden Arrival plaza, not the mascot. I read the bright shape as a
			// mis-framed figure and spent three fixes on the framing arithmetic; the arithmetic turned out to
			// be exactly right, solving every skin to 0.88 of the window, which is what finally made it clear
			// the bright thing was not the figure.
			//
			// A backdrop at Distance * 0.55 BEYOND the subject sat 254 uu from the lens with plaza geometry a
			// couple of metres in front of it, so the world was never hidden -- it was merely darker than the
			// figure, which is why only the skins bright enough to LIGHT that geometry ever showed it. Arden
			// and Celestial Light light it; Relay OG and Skeleton Flame do not, and their corners always read
			// black, which is exactly how this hid for so long.
			//
			// The wall only has to be behind the subject, and the subject is a few uu deep at preview scale.
			// Close enough that nothing can get between them, with a floor so a very near figure still has a
			// wall rather than a coincident plane.
			const float BackOff = FMath::Max(Distance * 0.12f, 18.0f);
			const FVector At = Spot + Ray * BackOff;
			const float Reach = Distance + BackOff;
			// Generous on purpose: anything of the chamber that overruns the window is covered by the night
			// field's own bands, so being too big costs nothing and being too small shows garden in a corner.
			// The wall is nearer now, so the same angular coverage needs less of it -- but the multiplier is
			// raised rather than left alone, because being generous here costs nothing (anything of it that
			// overruns the window is covered by the night field's own bands) and being a few uu short shows
			// garden in a corner, which is the whole fault being fixed.
			const float HalfW = Reach * TanH * FMath::Max(Size.X, 0.05f) * 3.20f;
			const float HalfH = Reach * TanV * FMath::Max(Size.Y, 0.05f) * 3.20f;
			Black->SetActorLocationAndRotation(At, (RealEye - At).Rotation());
			// The engine cube is 100 uu, and the wall faces the lens down its own X.
			Black->SetActorScale3D(FVector(0.04f, FMath::Max(HalfW, 80.0f) / 50.0f, FMath::Max(HalfH, 80.0f) / 50.0f));
			// AND THE DECK COMES BACK, because the floor was never gone.
			//
			// It was switched off here on the reasoning that "there is no floor in front of the lens" once the
			// subject came to the window. Photographed in PIE, that is simply untrue: the player's camera looks
			// DOWNWARD, so the lower half of the preview window is aimed at garden ground a couple of metres
			// ahead -- nearer than the wall, which therefore cannot hide it. The founder saw decking, flowers
			// and a mission orb in a square that is supposed to be black.
			//
			// So the chamber has a floor again: a slab whose top sits at the figure's feet, running from behind
			// the wall forward PAST the camera, wide enough to pass the window's corners. A wall hides what is
			// behind the subject; only a floor hides what is below and in front of it.
			TInlineComponentArray<UStaticMeshComponent*> Parts(Black);
			const FVector ActorScale = Black->GetActorScale3D();
			for (UStaticMeshComponent* Part : Parts)
			{
				if (Part == nullptr || Part->GetFName() != TEXT("WardrobeBlackDeck"))
				{
					continue;
				}
				Part->SetVisibility(true, true);
				// Laid flat and square to the ray, in the wall's own space: the wall faces the lens down its X,
				// so forward-toward-the-camera is -X and down is -Z.
				const float DeckLong = (Reach + Distance) / FMath::Max(ActorScale.X * 100.0f, 1.0f);
				const float DeckWide = FMath::Max(HalfW, 80.0f) * 2.2f / FMath::Max(ActorScale.Y * 100.0f, 1.0f);
				const float FeetBelowCentre = FigureMiddle * PreviewScale + 4.0f;
				Part->SetRelativeScale3D(FVector(DeckLong, DeckWide, 0.04f / FMath::Max(ActorScale.Z, 0.0001f)));
				Part->SetRelativeRotation(FRotator::ZeroRotator);
				Part->SetRelativeLocation(FVector(
					-(Reach + Distance) * 0.5f / FMath::Max(ActorScale.X * 100.0f, 1.0f) * 100.0f,
					0.0f,
					-FeetBelowCentre / FMath::Max(ActorScale.Z * 100.0f, 1.0f) * 100.0f));
			}
		}
	}), 0.08f, true, 0.05f);
}

void UWonderlandUiSubsystem::FrameBrainSculpture(bool bOn, bool bReleaseCamera)
{
	APlayerController* Controller = BoundController.Get();
	UWorld* World = Controller != nullptr ? Controller->GetWorld() : nullptr;
	APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (World == nullptr || Pawn == nullptr)
	{
		return;
	}
	if (!bOn)
	{
		World->GetTimerManager().ClearTimer(BrainFrameTimer);
		if (BrainPanel.IsValid())
		{
			// THE STILL COMES BACK FIRST, so there is never a frame with neither brain on screen.
			BrainPanel->SetSculptureLive(false);
		}
		// ONLY IF THE BRAIN ACTUALLY HAS THE LENS. This runs from CloseOverlay, which closes every overlay there
		// is -- so a bare "the camera exists" test would snatch the view back to the pawn when the founder shut a
		// Wonder Web window that the brain had nothing to do with.
		if (bReleaseCamera && BrainCamera.IsValid() && Controller->GetViewTarget() == BrainCamera.Get())
		{
			Controller->SetViewTargetWithBlend(Pawn, 0.35f, EViewTargetBlendFunction::VTBlend_Cubic);
		}
		// DESTROYED, NOT HIDDEN, for the reason the wardrobe's backdrop is: a brain left floating in the plaza is
		// a prop the founder walks into the moment the panel closes.
		if (AActor* Sculpture = BrainSculptureActor.Get())
		{
			Sculpture->Destroy();
		}
		// THE CRYSTAL COMES STRAIGHT BACK. It was only ever hidden to keep it out of the brain window.
		for (TActorIterator<AWonderlandMissionOrb> It(World); It; ++It)
		{
			It->SetActorHiddenInGame(false);
		}
		BrainSculptureActor.Reset();
		return;
	}

	// THE WINDOW HAS TO HAVE PAINTED ONCE before its place on screen is known, so this re-solves for a few frames
	// while the panel settles -- the same timer shape, and for the same reason, as the wardrobe's framing.
	TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);
	World->GetTimerManager().SetTimer(BrainFrameTimer, FTimerDelegate::CreateWeakLambda(this, [WeakThis]()
	{
		UWonderlandUiSubsystem* Self = WeakThis.Get();
		APlayerController* PC = Self != nullptr ? Self->BoundController.Get() : nullptr;
		APawn* Dog = PC != nullptr ? PC->GetPawn() : nullptr;
		UWorld* W = PC != nullptr ? PC->GetWorld() : nullptr;
		if (Self == nullptr || Dog == nullptr || W == nullptr || !Self->BrainPanel.IsValid())
		{
			return;
		}
		FVector2D Centre, Size;
		if (!Self->BrainPanel->GetBrainSculptureRect(Centre, Size))
		{
			// The wardrobe has the lens, or the panel has not painted yet. Either way the still art stays up.
			UE_LOG(LogTemp, Warning, TEXT("WLBRAINFRAME: timer ran but the window rect was not available"));
			Self->BrainPanel->SetSculptureLive(false);
			return;
		}

		// ---- the sculpture itself, made once and kept while the panel is open
		AWonderlandBrainSculpture* Sculpture = Self->BrainSculptureActor.Get();
		if (Sculpture == nullptr)
		{
			FActorSpawnParameters SpawnParams;
			SpawnParams.ObjectFlags |= RF_Transient;
			SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Sculpture = W->SpawnActor<AWonderlandBrainSculpture>(
				AWonderlandBrainSculpture::StaticClass(), FTransform::Identity, SpawnParams);
			if (Sculpture == nullptr) { return; }
#if WITH_EDITOR
			Sculpture->SetActorLabel(TEXT("WL_ProjectBrainSculpture"), false);
#endif
			Self->BrainSculptureActor = Sculpture;
		}

		// ---- the lens: the player's own field of view, so the framing maths matches what is drawn
		const float HFov = PC->PlayerCameraManager != nullptr ? PC->PlayerCameraManager->GetFOVAngle() : 90.0f;
		int32 VX = 0, VY = 0;
		PC->GetViewportSize(VX, VY);
		const float Aspect = VY > 0 ? static_cast<float>(VX) / static_cast<float>(VY) : 1.777f;
		const float TanH = FMath::Tan(FMath::DegreesToRadians(HFov * 0.5f));
		const float TanV = TanH / Aspect;

		// ---- IT FLOATS, AND IT GOES WHERE THE REAL CAMERA IS LOOKING.
		//
		// This used to take the eye from the PAWN and then aim a camera of its own. Measured in PIE, that put the
		// sculpture 808 uu from the camera that was actually rendering while the code believed it was 537 -- the
		// brain was being placed in front of a viewpoint nobody was looking through, which is exactly why the
		// window came back empty with every instance present, meshed, materialled and visible.
		//
		// The real camera is the only viewpoint that matters, so the subject is placed on the ray leaving IT --
		// the same thing that finally made the wardrobe preview work. No camera of our own is created and no view
		// target is taken, so opening Project Brain no longer moves the player either.
		const APlayerCameraManager* Lens = PC->PlayerCameraManager;
		if (Lens == nullptr)
		{
			return;
		}
		const FVector Eye = Lens->GetCameraLocation();
		const FRotator Aim0 = Lens->GetCameraRotation();

		// The python swims on a shell outside the brain, so what has to fit in the window is that shell, not the mass.
		const float Reach = Sculpture->BrainRadiusUU * 1.55f * 2.0f;
		// BIGGER IN THE WINDOW (founder, 2026-09-24). The subject fills nearly the whole window height
		// rather than three quarters of it; the fit distance below turns that into how far away it stands.
		const float WantTall = FMath::Max(Size.Y * 0.95f, 0.05f);

		// The ray through the window's centre, turned back from the screen offset into an angle off the real axis.
		// SOLVED FIRST, because everything below has to be measured along the ray the subject is actually placed
		// on -- the previous version traced for obstructions down the camera axis while placing along this one,
		// and with the window sitting at x=0.70 of the screen those are nowhere near the same direction.
		FRotator Through = Aim0;
		Through.Yaw += FMath::RadiansToDegrees(FMath::Atan((Centre.X - 0.5f) * 2.0f * TanH));
		Through.Pitch -= FMath::RadiansToDegrees(FMath::Atan((Centre.Y - 0.5f) * 2.0f * TanV));
		const FVector Ray = Through.Vector();

		// How far away the brain fills the window at its built size. Everything after this only ever brings it
		// NEARER, and the scale at the end pays that back so the founder sees the same size either way.
		const float FitDistance = FMath::Clamp(Reach / (WantTall * 2.0f * TanV), 260.0f, 2000.0f);
		float Distance = FitDistance;

		// ---- IN FRONT OF THE DOG, ALWAYS.
		//
		// Measured in PIE with the night field finally cut open: the brain sat 808 uu out while the mascot stood
		// at roughly half that, so the first thing the founder saw in the brain window was his own dog standing
		// in the middle of it. A backdrop behind the subject cannot hide anything in FRONT of the subject, so the
		// only fix is to put the subject nearer than the world it has to beat.
		const float DogAway = static_cast<float>(FVector::Dist(Eye, Dog->GetActorLocation()));
		if (DogAway > 1.0f)
		{
			Distance = FMath::Min(Distance, DogAway * 0.55f);
		}
		// AND CLOSER STILL, because the chamber can only exclude what is OUTSIDE it.
		//
		// Measured: with the sculpture hidden, the brain window showed a pale voxel staircase standing right
		// beside the lens -- and it was still there with the sculpture shown, because the chamber's mouth opened
		// further from the eye than the staircase stood. No size of box can help: a box hides what is behind its
		// walls, and that was in front of them. Bringing the whole assembly in to arm's length puts its mouth
		// within a few uu of the lens, so there is almost nowhere left for the world to stand in between.
		Distance = FMath::Min(Distance, 90.0f);

		// ---- AND NEVER INSIDE A WALL. Five metres ahead is a doorway as often as it is open air; if something
		// ---- solid is nearer than that, the brain is brought in front of it.
		FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandBrainSculptureSpot), false);
		Params.AddIgnoredActor(Dog);
		Params.AddIgnoredActor(Sculpture);
		if (const ARelayDogCharacter* Relay = Cast<ARelayDogCharacter>(Dog))
		{
			if (Relay->GetCostume() != nullptr) { Params.AddIgnoredActor(Relay->GetCostume()); }
		}
		FHitResult Blocked;
		if (W->LineTraceSingleByChannel(Blocked, Eye, Eye + Ray * Distance, ECC_Camera, Params))
		{
			Distance = FMath::Max(static_cast<float>(Blocked.Distance) - Reach * 0.25f, 150.0f);
		}

		// ---- SIZED FOR WHERE IT ENDED UP. Coming closer must not make it enormous: the apparent size is held to
		// what the window asked for, so the brain reads the same in an open plaza and up against a wall.
		const float Scale = FMath::Clamp(Distance / FMath::Max(FitDistance, 1.0f), 0.10f, 1.0f);
		Sculpture->SetActorScale3D(FVector(Scale, Scale, Scale));
		Sculpture->SetActorLocation(Eye + Ray * Distance);

		// NO CAMERA OF OUR OWN. The offsets above already carried the subject to the window, so there is
		// nothing left to aim and nothing to possess -- opening Project Brain does not move the player.
		if (ACameraActor* Stale = Self->BrainCamera.Get())
		{
			Stale->Destroy();
			Self->BrainCamera.Reset();
		}
		// ---- AND THE PLAZA'S OWN PROPS STAND DOWN WHILE THE WINDOW IS OPEN.
		//
		// The Mission Contract crystal is a large white voxel ring with NO COLLISION, so the obstruction trace
		// above cannot see it -- photographed in PIE it stood between the lens and the sculpture and appeared
		// inside the brain window as a white slab. A chamber cannot hide what is inside it, and enlarging the
		// box only let more of the crystal in. While Project Brain is open the world is covered by the night
		// field in any case, so nothing is lost by standing the crystal down until the panel closes.
		for (TActorIterator<AWonderlandMissionOrb> It(W); It; ++It)
		{
			It->SetActorHiddenInGame(true);
		}
		// ONLY NOW is the still art stood down: everything the live brain needs exists and is pointed at.
		Self->BrainPanel->SetSculptureLive(true);
	}), 0.08f, true, 0.05f);
}

void UWonderlandUiSubsystem::StageSkinPreviewInWorld(bool bOn)
{
	AWonderlandSkinStage* Stage = SkinStage();
	APlayerController* Controller = BoundController.Get();
	APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (Stage == nullptr || Pawn == nullptr)
	{
		return;
	}
	if (!bOn)
	{
		Stage->SetInWorldPreview(false, FVector::ZeroVector, FRotator::ZeroRotator);
		return;
	}
	const FVector At = Pawn->GetActorLocation();
	const FVector Forward = Pawn->GetActorForwardVector();
	const FVector Right = Pawn->GetActorRightVector();
	UWorld* World = Pawn->GetWorld();

	// A SPOT THE FOUNDER CAN ACTUALLY SEE. The first version stood the Dog a fixed 320 uu ahead and 170 aside,
	// and the first portraits came back as a wall of Jhinn: the companions follow the player at three or four
	// metres, they have no collision, so a trace walks straight through them and calls the view clear while one
	// of them fills the frame. Candidates are swept outward instead, and each must have a floor under it, nobody
	// standing on it, and a line of sight from the founder's eyes that passes nothing solid AND no bystander.
	TArray<FVector> Bystanders;
	for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
	{
		if (*It != Stage->GetBody()) { Bystanders.Add(It->GetActorLocation()); }
	}
	for (TActorIterator<AWonderlandSubAgentCub> It(World); It; ++It) { Bystanders.Add(It->GetActorLocation()); }

	FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandSkinPreviewSpot), false);
	Params.AddIgnoredActor(Pawn);
	Params.AddIgnoredActor(Stage);
	if (Stage->GetBody() != nullptr) { Params.AddIgnoredActor(Stage->GetBody()); }
	const FVector Eyes = At + FVector(0.0, 0.0, 70.0);

	// ECC_Camera, NOT ECC_Visibility. The first sweep rejected every candidate: this map's paving does not answer
	// on Visibility, and the clearance bubble -- which finds ground under a Mission Contract every time -- traces
	// on Camera. Same channel, same answer.
	static const float Ahead[] = { 340.0f, 460.0f, 600.0f, 760.0f };
	static const float Aside[] = { 170.0f, -170.0f, 0.0f, 340.0f, -340.0f };
	FVector Where = At + Forward * 320.0 + Right * 170.0 - FVector(0.0, 0.0, 88.0);
	bool bFound = false;
	for (float A : Ahead)
	{
		for (float S : Aside)
		{
			const FVector Spot = At + Forward * A + Right * S;
			FHitResult Ground;
			if (!World->LineTraceSingleByChannel(Ground, Spot + FVector(0.0, 0.0, 300.0), Spot - FVector(0.0, 0.0, 400.0), ECC_Camera, Params)
				|| Ground.ImpactNormal.Z < 0.7f)
			{
				continue;
			}
			bool bCrowded = false;
			for (const FVector& B : Bystanders) { if (FVector::Dist2D(B, Spot) < 260.0f) { bCrowded = true; break; } }
			if (bCrowded) { continue; }
			const FVector Chest(Spot.X, Spot.Y, Ground.ImpactPoint.Z + 90.0);
			FHitResult Sight;
			if (World->LineTraceSingleByChannel(Sight, Eyes, Chest, ECC_Camera, Params)) { continue; }
			bool bBodyInTheWay = false;
			const FVector Seg = Chest - Eyes;
			for (const FVector& B : Bystanders)
			{
				const float T = FMath::Clamp(FVector::DotProduct(B - Eyes, Seg) / FMath::Max(Seg.SizeSquared(), 1.0), 0.0, 1.0);
				if (FVector::Dist2D(Eyes + Seg * T, B) < 150.0f) { bBodyInTheWay = true; break; }
			}
			if (bBodyInTheWay) { continue; }
			Where = FVector(Spot.X, Spot.Y, Ground.ImpactPoint.Z);
			bFound = true;
			break;
		}
		if (bFound) { break; }
	}
	UE_LOG(LogWonderlandUi, Log, TEXT("WLSKIN preview spot %s (%d bystander(s))"), bFound ? TEXT("found clear") : TEXT("FALLBACK, none clear"), Bystanders.Num());
	// FACING THE PLAYER, because a skin is judged from the front.
	const FRotator Facing = (At - Where).GetSafeNormal2D().Rotation();
	Stage->SetInWorldPreview(true, Where, Facing);
}

void UWonderlandUiSubsystem::RefreshSkinPreviewBrush()
{
	AWonderlandSkinStage* Stage = SkinStage();
	if (Stage == nullptr)
	{
		return;
	}
	UTextureRenderTarget2D* Target = Stage->GetRenderTarget();
	if (Target == nullptr)
	{
		return;
	}
	if (!SkinPreviewBrush.IsValid())
	{
		SkinPreviewBrush = MakeShared<FSlateBrush>();
		SkinPreviewBrush->ImageSize = FVector2D(640.0, 800.0);
		SkinPreviewBrush->DrawAs = ESlateBrushDrawType::Image;
	}
	// RE-POINTED EVERY TIME, not only when it is null. Re-setting the resource object makes Slate drop the handle
	// it cached and take a fresh one, which is the whole point: the stale handle is the bug.
	SkinPreviewBrush->SetResourceObject(Target);
	// AND THE STAGE IS TOLD SOMEBODY IS LOOKING, so the first frame after opening is a real capture rather than
	// whatever was left in the target from last time.
	Stage->MarkWanted();
}

void UWonderlandUiSubsystem::StageWardrobe(bool bOpen)
{
	// THE WORLD SIDE OF THE WARDROBE, and the ONLY copy of it. Called from the panel's own state change, so it
	// runs whichever way the wardrobe was opened or shut. See the binding in OpenOverlay.
	if (bSuppressWardrobeStaging || !BrainPanel.IsValid())
	{
		return;
	}
	if (bOpen)
	{
		RefreshSkinPreviewBrush();
	}
	// ONE LENS, HANDED OVER CLEANLY. The wardrobe and the brain both want the camera, and they are never both on
	// show: the brain stands down as the wardrobe opens and comes back when it closes. Without this the two
	// framings fight over the view target every tick -- which is what a click on a skin looked like from outside.
	// Opening, the brain lets go WITHOUT releasing the camera, because the wardrobe is about to take it: releasing
	// would blend back to the pawn and straight out again for no reason the founder could see a purpose in.
	if (bOpen)
	{
		FrameBrainSculpture(false, /*bReleaseCamera*/ false);
		FrameRelayDogInWardrobe(true);
	}
	else
	{
		FrameRelayDogInWardrobe(false);
		FrameBrainSculpture(true);
	}
}

bool UWonderlandUiSubsystem::SetBrainSkinsOpen(bool bOpen)
{
	if (!IsProjectBrainOpen() || !BrainPanel.IsValid())
	{
		return false;
	}
	// THE FOUNDER'S OWN DOG IS THE PREVIEW. It wears the skin now (ARelayDogCharacter::WearSkin), so there is no
	// mannequin to stand anywhere: the panel opens a window and the camera frames the Dog inside it.
	//
	// NOTHING IS STAGED HERE. Setting the panel's state fires OnSkinsOpenChanged, which calls StageWardrobe above
	// -- the same path the player's own SWITCH SKIN button takes. This is the whole point of the change: a proof
	// that calls this function now exercises exactly what a click does, instead of a second route that worked.
	BrainPanel->SetSkinsOpen(bOpen);
	return BrainPanel->IsSkinsOpen() == bOpen;
}

bool UWonderlandUiSubsystem::IsBrainSkinsOpen() const
{
	return BrainPanel.IsValid() && BrainPanel->IsSkinsOpen();
}

bool UWonderlandUiSubsystem::PressSwitchSkin()
{
	if (!IsProjectBrainOpen() || !BrainPanel.IsValid())
	{
		return false;
	}
	// THE BUTTON'S OWN LINE, AND NOTHING ELSE. WonderlandProjectBrainPanel.cpp:
	//     .OnClicked_Lambda([this]() { SetSkinsOpen(!bSkinsOpen); return FReply::Handled(); })
	BrainPanel->SetSkinsOpen(!BrainPanel->IsSkinsOpen());
	return true;
}

bool UWonderlandUiSubsystem::GetSkinPreviewRect(FVector2D& OutCentre, FVector2D& OutSize) const
{
	return BrainPanel.IsValid() && BrainPanel->GetSkinPreviewRect(OutCentre, OutSize);
}

bool UWonderlandUiSubsystem::ToggleWardrobeInspect()
{
	AWonderlandSkinStage* Stage = SkinStage();
	if (Stage == nullptr || !IsBrainSkinsOpen())
	{
		return false;
	}
	Stage->SetInspectSpin(!Stage->IsInspectSpinning());
	return true;
}

bool UWonderlandUiSubsystem::IsWardrobeInspecting() const
{
	const AWonderlandSkinStage* Stage = SkinStageActor.Get();
	return Stage != nullptr && Stage->IsInspectSpinning();
}

float UWonderlandUiSubsystem::GetWardrobeInspectYaw() const
{
	const AWonderlandSkinStage* Stage = SkinStageActor.Get();
	return Stage != nullptr ? Stage->GetInspectYaw() : 0.0f;
}

namespace
{
	UWonderlandTerritorySubsystem* TerritoriesFor(const UWonderlandUiSubsystem* Ui)
	{
		const UWorld* World = Ui != nullptr ? Ui->GetWorld() : nullptr;
		return World != nullptr ? World->GetSubsystem<UWonderlandTerritorySubsystem>() : nullptr;
	}
}

FName UWonderlandUiSubsystem::AnnouncedTerritory() const
{
	const UWonderlandTerritorySubsystem* Territories = TerritoriesFor(this);
	return Territories != nullptr ? Territories->GetAnnouncing() : NAME_None;
}

FString UWonderlandUiSubsystem::AnnouncedName() const
{
	const UWonderlandTerritorySubsystem* Territories = TerritoriesFor(this);
	FWonderlandTerritory Row;
	if (Territories != nullptr && Territories->FindTerritory(Territories->GetAnnouncing(), Row))
	{
		return Row.DisplayName;
	}
	return FString();
}

FString UWonderlandUiSubsystem::AnnouncedSpecialisation() const
{
	const UWonderlandTerritorySubsystem* Territories = TerritoriesFor(this);
	FWonderlandTerritory Row;
	if (Territories != nullptr && Territories->FindTerritory(Territories->GetAnnouncing(), Row))
	{
		// THE CANON, OR THE FACT THAT THERE IS NONE. Never a guess. See FWonderlandTerritory::Specialisation.
		return Row.bSpecialisationIsCanon && !Row.Specialisation.IsEmpty()
			? Row.Specialisation : FString(TEXT("NEEDS FOUNDER DEFINITION"));
	}
	return FString();
}

FLinearColor UWonderlandUiSubsystem::AnnouncedAccent() const
{
	const UWonderlandTerritorySubsystem* Territories = TerritoriesFor(this);
	FWonderlandTerritory Row;
	if (Territories != nullptr && Territories->FindTerritory(Territories->GetAnnouncing(), Row))
	{
		return Row.Accent;
	}
	return FLinearColor::White;
}

FName UWonderlandUiSubsystem::GetCurrentTerritory() const
{
	const UWonderlandTerritorySubsystem* Territories = TerritoriesFor(this);
	return Territories != nullptr ? Territories->GetCurrentTerritory() : NAME_None;
}

void UWonderlandUiSubsystem::RefreshTerritories()
{
	// THE MAP IS THE NAVIGATION UI, so the territories go into it rather than into a panel of their own --
	// the founder's "integrate this into the existing navigation/UI rather than creating a second competing
	// system". The map widget holds no lore: it is handed rows straight off the canon registry, with the
	// direction and distance worked out from where the player is standing right now.
	UWonderlandTerritorySubsystem* Territories = TerritoriesFor(this);
	if (!WorldMap.IsValid() || Territories == nullptr)
	{
		return;
	}
	TArray<FWonderlandMapTerritory> Rows;
	for (const FWonderlandTerritory& Row : Territories->GetTerritories())
	{
		FWonderlandMapTerritory Entry;
		Entry.Row = Row;
		Entry.bDiscovered = Territories->IsDiscovered(Row.Id);
		Entry.bHere = Territories->GetCurrentTerritory() == Row.Id;
		Entry.BearingDeg = Territories->BearingTo(Row.Id);
		Entry.DistanceM = Territories->DistanceToMetres(Row.Id);
		Entry.Way = Territories->DescribeWayTo(Row.Id);
		Rows.Add(Entry);
	}
	WorldMap->RefreshTerritories(Rows);
}

int32 UWonderlandUiSubsystem::GetMapTerritoryCount() const
{
	return WorldMap.IsValid() ? WorldMap->GetTerritoryCount() : 0;
}

FName UWonderlandUiSubsystem::GetSelectedMapTerritory() const
{
	return WorldMap.IsValid() ? WorldMap->GetSelectedTerritory() : NAME_None;
}

bool UWonderlandUiSubsystem::SelectMapTerritory(FName Id)
{
	return WorldMap.IsValid() && WorldMap->SelectTerritory(Id);
}

FString UWonderlandUiSubsystem::DescribeMapTerritory() const
{
	return WorldMap.IsValid() ? WorldMap->DescribeTerritoryPanel() : FString();
}

FString UWonderlandUiSubsystem::GetMenuTabs() const
{
	return MenuPanel.IsValid() ? MenuPanel->DescribeTabs() : FString();
}

FString UWonderlandUiSubsystem::GetOpenMenuTab() const
{
	return MenuPanel.IsValid() ? MenuPanel->GetOpenTab() : FString();
}

bool UWonderlandUiSubsystem::ShowMenuTab(const FString& Title)
{
	return MenuPanel.IsValid() && MenuPanel->ShowTab(Title);
}

bool UWonderlandUiSubsystem::WearRelaySkin(FName SkinId)
{
	UWonderlandRelaySkinSubsystem* Registry = RelaySkins();
	return Registry != nullptr && Registry->EquipSkin(SkinId);
}

int32 UWonderlandUiSubsystem::GetSkinStageFrameCount() const
{
	const AWonderlandSkinStage* Stage = SkinStageActor.Get();
	return Stage != nullptr ? Stage->GetFrameCount() : 0;
}

UWonderlandMissionTaskSubsystem* UWonderlandUiSubsystem::Tasks() const
{
	ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
}

bool UWonderlandUiSubsystem::PressAddTask()
{
	UWonderlandMissionTaskSubsystem* Set = Tasks();
	if (Set == nullptr)
	{
		return false;
	}
	const FGuid Id = Set->AddDraft();
	if (Id.IsValid() && TaskEntry.IsValid())
	{
		// THE NEXT THING ANYBODY DOES IS TYPE, so the field is cleared and given focus rather than waiting to be
		// clicked. A + that takes two clicks to mean one thing is a + nobody presses twice.
		TaskEntry->SetText(FText::GetEmpty());
		FSlateApplication::Get().SetKeyboardFocus(TaskEntry, EFocusCause::SetDirectly);
	}
	return Id.IsValid();
}

void UWonderlandUiSubsystem::MountTaskAddControl()
{
	ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	if (TaskAddLayer.IsValid() || Player == nullptr || Player->ViewportClient == nullptr)
	{
		return;
	}
	TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);

	// WHAT THE SELECTED SLOT IS, asked fresh each frame rather than remembered: the set can change from the console,
	// from a proof, or from a scheduler, and a remembered answer would be wrong the moment any of those happened.
	const auto SelectedIsDraft = [WeakThis]()
	{
		const UWonderlandMissionTaskSubsystem* Set = WeakThis.IsValid() ? WeakThis->Tasks() : nullptr;
		const FWonderlandMissionTask* Task = Set != nullptr ? Set->GetSelectedTask() : nullptr;
		return Task != nullptr && !WonderlandTaskIsContract(Task->State);
	};

	TaskAddLayer = SNew(SConstraintCanvas)
		.Visibility(EVisibility::SelfHitTestInvisible)
		// BESIDE THE TOKEN USAGE METERS, not beside the logo above them.
		//
		// The usage widget is positioned at (30, 22) but that is its TOP LEFT, and what it draws there is the mark;
		// the COMPOUND AGENT / SINGLE AGENT / LLM COMPANION rows sit well below it. A + at y=20 landed alongside the
		// logo, where a filmed frame showed it invisible against the art -- beside the wrong thing, which is the same
		// fault as being missing. These offsets put it level with the first meter row, just right of the figures.
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.0f, 0.0f, 0.0f, 0.0f))
		.Offset(FMargin(392.0f, 318.0f, 0.0f, 0.0f))
		.AutoSize(true)
		.Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					// A BORDER, BECAUSE A BORDERLESS + IS NOT A CONTROL. Filmed against the plaza the NoBorder
					// version was invisible -- the subsystem reported it on screen and no frame contained it, which
					// is the worst of both. This is still small and still quiet: a hairline box and a dim gold
					// glyph, sized to sit beside a usage figure rather than compete with one.
					SNew(SBorder)
					.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
					.BorderBackgroundColor(FSlateColor(FLinearColor(0.05f, 0.05f, 0.07f, 0.78f)))
					.Padding(FMargin(1.0f))
					[
						SNew(SButton)
						.ButtonStyle(FCoreStyle::Get(), "NoBorder")
						.ToolTipText(INVTEXT("Add another task for Julius"))
						.ContentPadding(FMargin(10.0f, 2.0f))
						.OnClicked_Lambda([WeakThis]()
						{
							if (WeakThis.IsValid()) { WeakThis->PressAddTask(); }
							return FReply::Handled();
						})
						[
							SNew(STextBlock)
							.Text(INVTEXT("+"))
							.Font(WonderlandUi::Sans(22, true))
							.ColorAndOpacity(WonderlandUi::Gold())
						]
					]
				]
				// How many contracts are open, so the + says what it is adding to without being pressed.
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(6.0f, 0.0f, 0.0f, 0.0f))
				[
					SNew(STextBlock)
					.Font(WonderlandUi::Sans(9, false, 2))
					.ColorAndOpacity(WonderlandUi::Cream())
					.Text_Lambda([WeakThis]()
					{
						const UWonderlandMissionTaskSubsystem* Set = WeakThis.IsValid() ? WeakThis->Tasks() : nullptr;
						if (Set == nullptr || Set->NumTasks() == 0)
						{
							return INVTEXT("ADD A TASK");
						}
						return FText::FromString(FString::Printf(TEXT("%d TASK%s"),
							Set->NumTasks(), Set->NumTasks() == 1 ? TEXT("") : TEXT("S")));
					})
				]
			]
			// THE ONE LINE, shown only while the selected slot is still empty. A field standing open beside a
			// finished contract would invite somebody to type into a task that has already been submitted.
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.0f, 5.0f, 0.0f, 0.0f))
			[
				SNew(SHorizontalBox)
				.Visibility_Lambda([SelectedIsDraft]()
				{
					return SelectedIsDraft() ? EVisibility::Visible : EVisibility::Collapsed;
				})
				+ SHorizontalBox::Slot().AutoWidth()
				[
					SNew(SBox).WidthOverride(360.0f)
					[
						SAssignNew(TaskEntry, SEditableTextBox)
						.HintText(INVTEXT("what should Julius do?"))
						.OnTextCommitted_Lambda([WeakThis](const FText& Text, ETextCommit::Type How)
						{
							if (How != ETextCommit::OnEnter || !WeakThis.IsValid()) { return; }
							UWonderlandMissionTaskSubsystem* Set = WeakThis->Tasks();
							if (Set == nullptr) { return; }
							// GRAY BECOMES RED HERE, and only here. A blank line is refused by the set itself.
							if (Set->SubmitDraft(Set->GetSelected(), Text.ToString()) && WeakThis->TaskEntry.IsValid())
							{
								WeakThis->TaskEntry->SetText(FText::GetEmpty());
							}
						})
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(8.0f, 0.0f, 0.0f, 0.0f))
				[
					SNew(SButton)
					.ButtonStyle(FCoreStyle::Get(), "NoBorder")
					.ToolTipText(INVTEXT("Throw this empty slot away. No mission is created."))
					.OnClicked_Lambda([WeakThis]()
					{
						if (WeakThis.IsValid())
						{
							if (UWonderlandMissionTaskSubsystem* Set = WeakThis->Tasks())
							{
								Set->DismissDraft(Set->GetSelected());
							}
						}
						return FReply::Handled();
					})
					[
						SNew(STextBlock).Text(INVTEXT("DISMISS"))
						.Font(WonderlandUi::Sans(8, false, 2)).ColorAndOpacity(WonderlandUi::Faint())
					]
				]
			]
		];
	// Beside the usage HUD's own layer (10), below the companion consoles (20) and every panel.
	Player->ViewportClient->AddViewportWidgetForPlayer(Player, TaskAddLayer.ToSharedRef(), 11);
}

void UWonderlandUiSubsystem::UnmountTaskAddControl()
{
	ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	if (TaskAddLayer.IsValid() && Player != nullptr && Player->ViewportClient != nullptr)
	{
		Player->ViewportClient->RemoveViewportWidgetForPlayer(Player, TaskAddLayer.ToSharedRef());
	}
	TaskAddLayer.Reset();
	TaskEntry.Reset();
}

UWonderlandRelaySkinSubsystem* UWonderlandUiSubsystem::RelaySkins() const
{
	const UWorld* World = GetWorld();
	const UGameInstance* GameInstance = World != nullptr ? World->GetGameInstance() : nullptr;
	return GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
}

AWonderlandSkinStage* UWonderlandUiSubsystem::SkinStage()
{
	if (SkinStageActor.IsValid())
	{
		return SkinStageActor.Get();
	}
	AWonderlandSkinStage* Stage = AWonderlandSkinStage::Get(GetWorld());
	SkinStageActor = Stage;
	return Stage;
}

UWonderlandEntitlementSubsystem* UWonderlandUiSubsystem::Entitlements() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandEntitlementSubsystem>() : nullptr;
}

int32 UWonderlandUiSubsystem::CountOpenWonderWebWindows() const
{
	int32 Count = 0;
	for (const FWonderWebWindow& Window : WonderWebWindows)
	{
		// MINIMIZED STILL COUNTS. A folded window is still a Wonder Web: its page is still open and its work goes on.
		Count += Window.bOpen && IsBrowserWindow(Window.Id) ? 1 : 0;
	}
	return Count;
}

int32 UWonderlandUiSubsystem::GetWonderWebWindowLimit() const
{
	const UWonderlandEntitlementSubsystem* Account = Entitlements();
	// With no entitlement subsystem there is no account to read, and the free tier's figure is the honest fallback.
	return Account != nullptr ? Account->GetMaxConcurrentWonderWebs() : 6;
}

FName UWonderlandUiSubsystem::NextWonderWebWindowId() const
{
	if (CountOpenWonderWebWindows() >= GetWonderWebWindowLimit())
	{
		return NAME_None;
	}
	// The first window is called "browser"; the rest are numbered. A closed number is reused, so the names stay small.
	if (FindWonderWebWindow(WonderWebWindowIds::Browser) == nullptr || !FindWonderWebWindow(WonderWebWindowIds::Browser)->bOpen)
	{
		return WonderWebWindowIds::Browser;
	}
	for (int32 Number = 2; Number <= WonderWebWindowIds::MaxBrowserId; ++Number)
	{
		const FName Id(*FString::Printf(TEXT("browser-%d"), Number));
		const FWonderWebWindow* Existing = FindWonderWebWindow(Id);
		if (Existing == nullptr || !Existing->bOpen)
		{
			return Id;
		}
	}
	return NAME_None;
}

void UWonderlandUiSubsystem::HandleSpawnWonderWebShortcut()
{
	SpawnWonderWebWindow();
}

bool UWonderlandUiSubsystem::SpawnWonderWebWindow()
{
	const int32 Limit = GetWonderWebWindowLimit();
	const FName Id = NextWonderWebWindowId();
	if (Id == NAME_None)
	{
		// AT THE LIMIT: nothing is opened, and the workspace says so where the founder is already looking. Not a modal,
		// not a beep, and not silence -- a press that does nothing without saying why is the worst of the three.
		const UWonderlandEntitlementSubsystem* Account = Entitlements();
		const FString Tier = Account != nullptr ? Account->GetTierLabel() : TEXT("FREE");
		if (WonderWebLayer.IsValid())
		{
			WonderWebLayer->ShowNotice(
				TEXT("WONDER WEB LIMIT"),
				FString::Printf(TEXT("%d / %d ACTIVE"), CountOpenWonderWebWindows(), Limit),
				FString::Printf(TEXT("%s tier supports up to %d simultaneous Wonder Web windows. Close one to open another."), *Tier, Limit),
				5.0f);
		}
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI ctrl+w refused: %d of %d Wonder Webs are open (%s tier)"), CountOpenWonderWebWindows(), Limit,
			Account != nullptr ? *Account->GetTierLabel() : TEXT("FREE"));
		return false;
	}
	const bool bOpened = OpenWonderWebWindow(Id);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI ctrl+w opened %s (%d of %d)"), *Id.ToString(), CountOpenWonderWebWindows(), Limit);
	return bOpened;
}

bool UWonderlandUiSubsystem::OpenWonderWebWindow(FName Id)
{
	FWonderWebWindow* Window = EnsureWonderWebWindow(Id);
	if (Window == nullptr)
	{
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web: no window called %s"), *Id.ToString());
		return false;
	}
	if (!Window->bOpen)
	{
		Window->bOpen = true;
		Window->OpenedOrder = ++WonderWebOpenCounter;
	}
	Window->bMinimized = false;
	if (Open != EOverlay::WonderWeb)
	{
		OpenOverlay(EOverlay::WonderWeb);
	}
	else
	{
		PresentWonderWebWindow(*Window);
		TileWonderWeb();
	}
	FocusWonderWebWindow(Id);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web window %s open (%d open)"), *Id.ToString(), OpenWonderWebScreens().Num());
	return IsWonderWebOpen();
}

bool UWonderlandUiSubsystem::CloseWonderWebWindow(FName Id)
{
	FWonderWebWindow* Window = FindWonderWebWindow(Id);
	if (Window == nullptr || !Window->bOpen)
	{
		return false;
	}
	const bool bLast = !WonderWebWindows.ContainsByPredicate([Id](const FWonderWebWindow& Other) { return Other.bOpen && Other.Id != Id; });
	if (bLast)
	{
		// The last window closes the workspace -- and is kept open in the set, so Wonder Web comes back showing it.
		CloseOverlay();
		return true;
	}
	Window->bOpen = false;
	Window->bMinimized = false;
	Window->bExpanded = false;
	if (AWonderlandWonderWebScreen* Screen = Window->Screen.Get())
	{
		Screen->Dismiss();
	}
	if (FocusedWonderWebWindow == Id)
	{
		FocusWonderWebWindow(MostRecentWonderWebWindow(Id));
	}
	TileWonderWeb();
	return true;
}

bool UWonderlandUiSubsystem::MinimizeWonderWebWindow(FName Id, bool bMinimize)
{
	FWonderWebWindow* Window = FindWonderWebWindow(Id);
	if (Window == nullptr || !Window->bOpen)
	{
		return false;
	}
	Window->bMinimized = bMinimize;
	if (bMinimize)
	{
		Window->bExpanded = false;
	}
	if (AWonderlandWonderWebScreen* Screen = Window->Screen.Get())
	{
		Screen->SetMinimized(bMinimize);
	}
	if (bMinimize && FocusedWonderWebWindow == Id)
	{
		const FName Next = MostRecentWonderWebWindow(Id);
		if (!Next.IsNone())
		{
			FocusWonderWebWindow(Next);
		}
	}
	else if (!bMinimize)
	{
		FocusWonderWebWindow(Id);
	}
	TileWonderWeb();
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web window %s %s"), *Id.ToString(), bMinimize ? TEXT("minimized") : TEXT("restored"));
	return true;
}

bool UWonderlandUiSubsystem::ExpandWonderWebWindow(FName Id)
{
	FWonderWebWindow* Target = FindWonderWebWindow(Id);
	if (Target == nullptr || !Target->bOpen)
	{
		return false;
	}
	const bool bExpand = !Target->bExpanded;
	for (FWonderWebWindow& Window : WonderWebWindows)
	{
		Window.bExpanded = false;
	}
	Target->bExpanded = bExpand;
	Target->bMinimized = false;
	if (AWonderlandWonderWebScreen* Screen = Target->Screen.Get())
	{
		Screen->SetMinimized(false);
	}
	FocusWonderWebWindow(Id);
	TileWonderWeb();
	return true;
}

TArray<FBox2D> UWonderlandUiSubsystem::WonderWebHudKeepOut() const
{
	TArray<FBox2D> Out;
	if (!HudFurniture.IsValid())
	{
		return Out;
	}
	const FGeometry& Canvas = HudFurniture->GetCachedGeometry();
	const FVector2D Size(Canvas.GetLocalSize());
	if (Size.X <= 1.0 || Size.Y <= 1.0)
	{
		return Out;
	}
	const auto Add = [&Out, &Canvas, &Size](const FSlateRect& Absolute)
	{
		const FVector2D TopLeft(Canvas.AbsoluteToLocal(Absolute.GetTopLeft()));
		const FVector2D BottomRight(Canvas.AbsoluteToLocal(Absolute.GetBottomRight()));
		if (!(BottomRight - TopLeft).IsNearlyZero())
		{
			Out.Add(FBox2D(TopLeft / Size, BottomRight / Size));
		}
	};
	const auto FromGeometry = [&Add](const FGeometry& Geometry)
	{
		if (!Geometry.GetLocalSize().IsNearlyZero())
		{
			Add(Geometry.GetLayoutBoundingRect());
		}
	};
	// Everything that stays on screen while the workspace is open: the usage meters, the mission strip, the wallet and
	// the mini-map, and the companion terminals when they are up.
	if (UsageHud != nullptr && UsageHud->IsInViewport())
	{
		FromGeometry(UsageHud->GetCachedGeometry());
	}
	FSlateRect Strip;
	if (const UWonderlandMissionSubsystem* Mission = Missions())
	{
		if (Mission->GetMissionStripAbsoluteRect(Strip))
		{
			Add(Strip);
		}
	}
	if (IsMiniMapShown())
	{
		if (WalletChip.IsValid() && GetDefault<UWonderlandWalletHudSettings>()->bShowWallet)
		{
			FromGeometry(WalletChip->GetCachedGeometry());
		}
		if (MiniMap.IsValid())
		{
			FromGeometry(MiniMap->GetCachedGeometry());
		}
	}
	if (AreCompanionTerminalsOnScreen())
	{
		for (const TSharedPtr<SWonderlandCompanionTerminal>& Companion : CompanionTerminals)
		{
			if (Companion.IsValid())
			{
				FromGeometry(Companion->GetCachedGeometry());
			}
		}
	}
	return Out;
}

void UWonderlandUiSubsystem::TileWonderWeb()
{
	using namespace WonderWebWorkspaceTuning;
	TArray<FWonderWebWindow*> Shown;
	TArray<FWonderWebWindow*> Folded;
	for (FWonderWebWindow& Window : WonderWebWindows)
	{
		if (Window.bOpen && Window.Screen.IsValid())
		{
			(Window.bMinimized ? Folded : Shown).Add(&Window);
		}
	}
	const auto ByOrder = [](const FWonderWebWindow& A, const FWonderWebWindow& B) { return A.OpenedOrder < B.OpenedOrder; };
	Shown.Sort(ByOrder);
	Folded.Sort(ByOrder);
	for (int32 Index = 0; Index < Folded.Num(); ++Index)
	{
		Folded[Index]->Screen->SetDockSlot(Index);
	}
	if (Shown.Num() == 0)
	{
		return;
	}

	// THE WINDOWS NEVER SIT UNDER THE HUD. The meters, the mission strip, the wallet and the mini-map stay on screen over
	// the workspace (the founder's HUD is not rearranged for it), so the windows tile in the free space the HUD leaves:
	// either the band below everything along the top, or the column between the left and right HUD. Whichever lets the
	// windows be largest wins. All in viewport fractions until the last step.
	const AWonderlandWonderWebWorkspace* Workspace = WonderWebWorkspace.Get();
	const FVector2D Half = Workspace != nullptr ? Workspace->HalfView() : FVector2D(295.0, 166.0);
	const IConsoleVariable* SideVar = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.WonderWeb.ViewSide"));
	// The camera stands a little to one side of the glass's centre; the middle of the view is that far across.
	const double ViewAcross = SideVar != nullptr ? -SideVar->GetFloat() : 16.0;
	const double Gap = FMath::Max(CVarTileGap.GetValueOnGameThread(), 0.0f);
	const double ClearX = FMath::Max(CVarHudClearance.GetValueOnGameThread(), 0.0f) / (2.0 * Half.X);
	const double ClearY = FMath::Max(CVarHudClearance.GetValueOnGameThread(), 0.0f) / (2.0 * Half.Y);
	const double MarginX = 10.0 / (2.0 * Half.X);
	const double MarginY = 10.0 / (2.0 * Half.Y);
	const double ChipRow = Folded.Num() > 0 ? (SWonderWebWindowChip::DesignSize().Y * 0.2 + 12.0) / (2.0 * Half.Y) : 0.0;
	const double Bottom = 1.0 - MarginY - ChipRow;
	const TArray<FBox2D> KeepOut = WonderWebHudKeepOut();

	TArray<FBox2D> Areas;
	double BelowTop = MarginY;
	for (const FBox2D& Box : KeepOut)
	{
		if (Box.Min.Y < 0.5)
		{
			BelowTop = FMath::Max(BelowTop, Box.Max.Y + ClearY);
		}
	}
	Areas.Add(FBox2D(FVector2D(MarginX, BelowTop), FVector2D(1.0 - MarginX, Bottom)));
	double Left = MarginX;
	double Right = 1.0 - MarginX;
	for (const FBox2D& Box : KeepOut)
	{
		if (Box.Max.X < 0.5)
		{
			Left = FMath::Max(Left, Box.Max.X + ClearX);
		}
		else if (Box.Min.X > 0.5)
		{
			Right = FMath::Min(Right, Box.Min.X - ClearX);
		}
	}
	double Top = MarginY;
	for (const FBox2D& Box : KeepOut)
	{
		if (Box.Max.X > Left && Box.Min.X < Right && Box.Min.Y < 0.5)
		{
			Top = FMath::Max(Top, Box.Max.Y + ClearY);
		}
	}
	if (Right > Left && Bottom > Top)
	{
		Areas.Add(FBox2D(FVector2D(Left, Top), FVector2D(Right, Bottom)));
	}

	// Every window shares the one multitasking size; its glass at size 1, in uu.
	const FVector2D Base = Shown[0]->Screen->GlassSize() / FMath::Max(Shown[0]->Screen->GetSizeFactor(), 0.01f);
	const auto AreaUu = [&Half](const FBox2D& Area) { return FVector2D((Area.Max.X - Area.Min.X) * 2.0 * Half.X, (Area.Max.Y - Area.Min.Y) * 2.0 * Half.Y); };
	const auto CentreUu = [&Half, ViewAcross](const FBox2D& Area)
	{
		return FVector2D(((Area.Min.X + Area.Max.X) * 0.5 - 0.5) * 2.0 * Half.X + ViewAcross, (0.5 - (Area.Min.Y + Area.Max.Y) * 0.5) * 2.0 * Half.Y);
	};
	const auto Fit = [&](const FBox2D& Area, int32 Across, int32 Down, double Want)
	{
		const FVector2D Room = AreaUu(Area);
		return FMath::Min3(Want, (Room.X - Gap * (Across - 1)) / (Base.X * Across), (Room.Y - Gap * (Down - 1)) / (Base.Y * Down));
	};

	const int32 Count = Shown.Num();
	const double Want = Count == 1 ? CVarLoneSize.GetValueOnGameThread() : (Count == 2 ? 1.0 : 0.9);
	double BestSize = -1.0;
	int32 BestArea = 0;
	int32 BestAcross = Count;
	for (int32 AreaIndex = 0; AreaIndex < Areas.Num(); ++AreaIndex)
	{
		for (int32 Across = Count; Across >= 1; --Across)
		{
			const int32 Down = FMath::DivideAndRoundUp(Count, Across);
			const double Size = Fit(Areas[AreaIndex], Across, Down, Want);
			// Fewer rows win a tie: side by side reads as a workspace.
			if (Size > BestSize + 0.01)
			{
				BestSize = Size;
				BestArea = AreaIndex;
				BestAcross = Across;
			}
		}
	}
	const FBox2D& Area = Areas[BestArea];
	LastWonderWebTileArea = Area;
	const float Size = static_cast<float>(FMath::Max(BestSize, 0.3));
	const int32 Down = FMath::DivideAndRoundUp(Count, BestAcross);
	const FVector2D Centre = CentreUu(Area);
	const FVector2D Cell(Base.X * Size + Gap, Base.Y * Size + Gap);
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const int32 Row = Index / BestAcross;
		const int32 InRow = Row < Down - 1 ? BestAcross : Count - BestAcross * (Down - 1);
		const int32 Column = Index % BestAcross;
		const FVector2D Place(Centre.X + (Column - (InRow - 1) * 0.5) * Cell.X, Centre.Y + ((Down - 1) * 0.5 - Row) * Cell.Y);
		AWonderlandWonderWebScreen* Screen = Shown[Index]->Screen.Get();
		Screen->SetSizeFactor(Size);
		Screen->PlaceAt(Place);
	}

	// EXPANDED: the largest a single window can be in the free space, in the middle of it, in front of the others.
	for (FWonderWebWindow* Window : Shown)
	{
		if (!Window->bExpanded)
		{
			continue;
		}
		double ExpandedSize = -1.0;
		int32 ExpandedArea = 0;
		for (int32 AreaIndex = 0; AreaIndex < Areas.Num(); ++AreaIndex)
		{
			const double Candidate = Fit(Areas[AreaIndex], 1, 1, CVarExpandedSize.GetValueOnGameThread());
			if (Candidate > ExpandedSize)
			{
				ExpandedSize = Candidate;
				ExpandedArea = AreaIndex;
			}
		}
		Window->Screen->SetSizeFactor(static_cast<float>(FMath::Max(ExpandedSize, 0.3)));
		Window->Screen->PlaceAt(CentreUu(Areas[ExpandedArea]));
	}
}

void UWonderlandUiSubsystem::OpenWonderWeb()
{
	OpenWonderWebWindow(WonderWebWindowIds::Creation);
}

void UWonderlandUiSubsystem::CloseWonderWeb()
{
	if (Open == EOverlay::WonderWeb)
	{
		CloseOverlay();
	}
}

bool UWonderlandUiSubsystem::IsWonderWebOpen() const
{
	return Open == EOverlay::WonderWeb;
}

void UWonderlandUiSubsystem::HandleJuliusConnectChanged()
{
	const UWonderlandJuliusConnectSubsystem* Connect = JuliusConnect();
	if (Connect == nullptr || WonderWebWorkspaceTuning::CVarAutoOpenPrompt.GetValueOnGameThread() == 0)
	{
		return;
	}
	// JULIUS OPENS ITS OWN WONDER WEB (founder: "Julius will be spawning multiple wonder webs"). When a task of Julius's
	// works in the browser, the window it works in comes up by itself -- the founder should not have to know a command to
	// watch what Julius is doing. Once per task, and never over another panel they are in.
	const FJuliusConnectTask* Task = Connect->GetSurface().CurrentTask();
	if (Task != nullptr && Task->TemplateId == TEXT("web-lookup") && Task->TaskId != LastBrowsingTaskId
		&& (Open == EOverlay::None || Open == EOverlay::WonderWeb))
	{
		LastBrowsingTaskId = Task->TaskId;
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI julius connect: Julius is browsing (%s) -- a Wonder Web window opens to watch it"), *Task->TaskId);
		OpenWonderWebWindow(WonderWebWindowIds::Browser);
	}
	if (!Connect->GetSurface().bHasPrompt)
	{
		return;
	}
	const FString& RequestId = Connect->GetSurface().Prompt.RequestId;
	// Once per request, and never over another panel the user is in: it is asked again on the next change.
	if (RequestId == LastPromptRequestId || (Open != EOverlay::None && Open != EOverlay::WonderWeb))
	{
		return;
	}
	LastPromptRequestId = RequestId;
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI julius connect: Julius is waiting on the user (%s) -- the Connections window comes forward"), *RequestId);
	OpenWonderWebWindow(WonderWebWindowIds::Connections);
}

FString UWonderlandUiSubsystem::DescribeWonderWeb() const
{
	const FWonderWebWindow* Window = FindWonderWebWindow(WonderWebWindowIds::Creation);
	const AWonderlandWonderWebScreen* Screen = Window != nullptr ? Window->Screen.Get() : nullptr;
	const APlayerController* Controller = BoundController.Get();
	const UWonderlandWonderWebSubsystem* State = WonderWebState();
	const bool bViewing = Controller != nullptr && WonderWebWorkspace.IsValid() && Controller->GetViewTarget() == WonderWebWorkspace.Get();
	FString Kind = TEXT("-");
	FString Access = TEXT("-");
	bool bInput = false;
	if (State != nullptr)
	{
		const FWonderWebSurface& Surface = State->GetSurface();
		static const TCHAR* Kinds[] = { TEXT("idle"), TEXT("working"), TEXT("creation"), TEXT("failed"), TEXT("observed") };
		Kind = Kinds[static_cast<int32>(Surface.Viewport.Kind)];
		if (Surface.Tabs.IsValidIndex(State->GetSelectedTab()))
		{
			Access = Surface.Tabs[State->GetSelectedTab()].Access == EWonderWebAccess::Control ? TEXT("control") : TEXT("observe");
		}
		bInput = Surface.Terminal.bAcceptsInput;
	}
	return FString::Printf(TEXT("open=%d presented=%d hidden=%d view_target=%d loaded=%d frame=%s tab=%d access=%s viewport=%s status=%s running=%d input=%d chrome=%d%d%d%d%d session_lines=%d painted=%d clicks=%d chars=%d terminal_text=\"%s\" problem=\"%s\""),
		IsWonderWebOpen() ? 1 : 0, Screen != nullptr && Screen->IsPresented() ? 1 : 0, Screen != nullptr && Screen->IsHidden() ? 1 : 0, bViewing ? 1 : 0,
		State != nullptr && State->IsPreviewLoaded() ? 1 : 0, State != nullptr ? *State->GetFrameName().ToString() : TEXT("-"),
		State != nullptr ? State->GetSelectedTab() : -1, *Access, *Kind,
		State != nullptr ? *State->GetSurface().Viewport.Status : TEXT("-"), State != nullptr && State->GetSurface().Viewport.bRunning ? 1 : 0, bInput ? 1 : 0,
		State != nullptr && State->GetSurface().Chrome.bCanReload ? 1 : 0, State != nullptr && State->GetSurface().Chrome.bCanStop ? 1 : 0,
		State != nullptr && State->GetSurface().Chrome.bCanRestart ? 1 : 0, State != nullptr && State->GetSurface().Chrome.bCanRebuild ? 1 : 0,
		State != nullptr && State->GetSurface().Chrome.bCanReturnToProject ? 1 : 0,
		State != nullptr ? State->GetSessionLines().Num() : 0, State != nullptr ? State->GetPaintedCells() : 0,
		WonderWebLayer.IsValid() ? WonderWebLayer->GetForwardedClicks() : 0, WonderWebLayer.IsValid() ? WonderWebLayer->GetForwardedCharacters() : 0,
		WonderWebPanel.IsValid() ? *WonderWebPanel->GetTerminalInput() : TEXT(""), State != nullptr ? *State->GetProblem() : TEXT(""));
}

FString UWonderlandUiSubsystem::DescribeWonderWebWorkspace() const
{
	TArray<FString> Rows;
	for (const FWonderWebWindow& Window : WonderWebWindows)
	{
		const AWonderlandWonderWebScreen* Screen = Window.Screen.Get();
		Rows.Add(FString::Printf(TEXT("%s[open=%d presented=%d min=%d expanded=%d focus=%d size=%.2f shown_size=%.2f offset=%.0f,%.0f gliding=%d]"),
			*Window.Id.ToString(), Window.bOpen ? 1 : 0, Screen != nullptr && Screen->IsPresented() ? 1 : 0, Window.bMinimized ? 1 : 0, Window.bExpanded ? 1 : 0,
			Screen != nullptr && Screen->IsFocused() ? 1 : 0, Screen != nullptr ? Screen->GetSizeFactor() : 0.0f, Screen != nullptr ? Screen->GetShownSizeFactor() : 0.0f,
			Screen != nullptr ? Screen->GetOffset().X : 0.0, Screen != nullptr ? Screen->GetOffset().Y : 0.0, Screen != nullptr && Screen->IsGliding() ? 1 : 0));
	}
	FString Connect = TEXT("connect=none");
	if (const UWonderlandJuliusConnectSubsystem* State = JuliusConnect())
	{
		const FJuliusConnectSurface& Surface = State->GetSurface();
		const FJuliusConnectTask* Task = Surface.CurrentTask();
		const FJuliusConnectService* Figma = Surface.FindService(TEXT("dev-figma"));
		const FJuliusConnectService* Social = Surface.FindService(TEXT("dev-social"));
		const FJuliusConnectService* Web = Surface.FindService(TEXT("open-web"));
		static const TCHAR* Links[] = { TEXT("connecting"), TEXT("online"), TEXT("offline") };
		Connect = FString::Printf(TEXT("link=%s prompt=%s task=%s template=%s step=%d/%d blocked=\"%s\" dev_figma=%s dev_social=%s open_web=%s scope=%s audit=%d last_audit=\"%s %s %s\" intents=%d"),
			Links[static_cast<int32>(State->GetLink())], Surface.bHasPrompt ? *Surface.Prompt.RequestId : TEXT("-"),
			Task != nullptr ? *Task->RunState : TEXT("-"), Task != nullptr ? *Task->TemplateId : TEXT("-"),
			Task != nullptr ? Task->Progress : 0, Task != nullptr ? Task->Total : 0,
			Task != nullptr ? *Task->BlockedReason : TEXT(""), Figma != nullptr ? *Figma->State : TEXT("-"),
			Social != nullptr ? *Social->State : TEXT("-"), Web != nullptr ? *Web->State : TEXT("-"),
			Task != nullptr && Task->TemplateId == TEXT("social-post") && Social != nullptr ? *FString::Join(Social->ProjectScope, TEXT(","))
				: (Figma != nullptr ? *FString::Join(Figma->ProjectScope, TEXT(",")) : TEXT("-")), Surface.Audit.Num(),
			Surface.Audit.Num() > 0 ? *Surface.Audit[0].Action : TEXT("-"), Surface.Audit.Num() > 0 ? *Surface.Audit[0].Capability : TEXT("-"),
			Surface.Audit.Num() > 0 ? *Surface.Audit[0].Outcome : TEXT("-"), State->GetIntentsSent());
	}
	return FString::Printf(TEXT("workspace_open=%d focused=%s tile_area=%.2f,%.2f,%.2f,%.2f windows=%s %s"), IsWonderWebOpen() ? 1 : 0, *FocusedWonderWebWindow.ToString(),
		LastWonderWebTileArea.Min.X, LastWonderWebTileArea.Min.Y, LastWonderWebTileArea.Max.X, LastWonderWebTileArea.Max.Y, *FString::Join(Rows, TEXT(",")), *Connect);
}

bool UWonderlandUiSubsystem::GetWonderWebWindowPixel(FName Window, FName Control, FVector2D& OutPixel) const
{
	const FWonderWebWindow* Found = FindWonderWebWindow(Window);
	if (Found == nullptr)
	{
		return false;
	}
	if (Control == TEXT("chip"))
	{
		OutPixel = SWonderWebWindowChip::DesignSize() * 0.5;
		return Found->bMinimized;
	}
	// A POINT RATHER THAN A CONTROL: "at:760,420" is that place in the window's own pixels, and "page:500,33" that place
	// in the live page's own pixels. The live page has no named controls -- it is somebody else's website -- so this is how
	// a proof reaches a search box or a link on it.
	const FString Text = Control.ToString();
	if (Text.StartsWith(TEXT("at:")) || Text.StartsWith(TEXT("page:")))
	{
		const bool bPage = Text.StartsWith(TEXT("page:"));
		FString X, Y;
		if (!Text.RightChop(bPage ? 5 : 3).Split(TEXT(","), &X, &Y))
		{
			return false;
		}
		const FVector2D Point(FCString::Atod(*X), FCString::Atod(*Y));
		if (Found->bMinimized)
		{
			return false;
		}
		if (!bPage)
		{
			OutPixel = Point;
			return true;
		}
		const TSharedPtr<SWonderlandWonderWebBrowserPanel>* Panel = BrowserPanels.Find(Window);
		return Panel != nullptr && Panel->IsValid() && (*Panel)->GetLivePagePoint(Point, OutPixel);
	}
	if (Window == WonderWebWindowIds::Creation)
	{
		return WonderWebPanel.IsValid() && WonderWebPanel->GetControlCentre(Control, OutPixel);
	}
	if (IsBrowserWindow(Window))
	{
		const TSharedPtr<SWonderlandWonderWebBrowserPanel>* Panel = BrowserPanels.Find(Window);
		return Panel != nullptr && Panel->IsValid() && (*Panel)->GetControlCentre(Control, OutPixel);
	}
	return ConnectPanel.IsValid() && ConnectPanel->GetControlCentre(Control, OutPixel);
}

FVector2D UWonderlandUiSubsystem::GetWonderWebWindowControlOnScreen(FName Window, FName Control) const
{
	const FWonderWebWindow* Found = FindWonderWebWindow(Window);
	const AWonderlandWonderWebScreen* Screen = Found != nullptr ? Found->Screen.Get() : nullptr;
	if (Screen == nullptr || !WonderWebLayer.IsValid() || !Found->bOpen)
	{
		return FVector2D(-1.0, -1.0);
	}
	FSlateRect Rect;
	if (Control == TEXT("chip"))
	{
		return Found->bMinimized && WonderWebLayer->GetWindowRect(Screen, true, Rect) ? Rect.GetCenter() : FVector2D(-1.0, -1.0);
	}
	// A control's place in the window's design pixels, onto the window as it is drawn this frame.
	FVector2D WindowPixel;
	FVector2D Absolute;
	if (Found->bMinimized || !GetWonderWebWindowPixel(Window, Control, WindowPixel) || !WonderWebLayer->WindowPixelToAbsolute(Screen, WindowPixel, Absolute))
	{
		return FVector2D(-1.0, -1.0);
	}
	return Absolute;
}

FVector2D UWonderlandUiSubsystem::GetWonderWebControlOnScreen(FName Control) const
{
	return GetWonderWebWindowControlOnScreen(WonderWebWindowIds::Creation, Control);
}

bool UWonderlandUiSubsystem::SimulateWonderWebWindowClick(FName Window, FName Control)
{
	if (!IsWonderWebOpen() || !FSlateApplication::IsInitialized() || !WonderWebLayer.IsValid())
	{
		return false;
	}
	const FVector2D At = GetWonderWebWindowControlOnScreen(Window, Control);
	if (At.X < 0.0)
	{
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web click %s/%s: not on screen"), *Window.ToString(), *Control.ToString());
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	const uint32 Pointer = FSlateApplicationBase::CursorPointerIndex;
	const uint32 User = static_cast<uint32>(App.GetUserIndexForMouse());
	const int32 ClicksBefore = WonderWebLayer->GetForwardedClicks();
	TSet<FKey> Held;
	Held.Add(EKeys::LeftMouseButton);
	// HIT TESTED IN THE LAYER'S OWN WINDOW, as RouteClickToWidget does for the shortcuts: the scripted editor ranks its
	// Content Browser above the PIE viewport at these desktop coordinates, so the application's window search would hand
	// the click to an asset tile. Confined to the viewport's window it is still a real hit test and a real route.
	const TSharedPtr<SWindow> SlateWindow = App.FindWidgetWindow(WonderWebLayer.ToSharedRef());
	if (!SlateWindow.IsValid())
	{
		return false;
	}
	const FWidgetPath Path = WonderlandUiHitTest::PathInWindow(SlateWindow.ToSharedRef(), At, App.GetUserIndexForMouse());
	bool bLayerUnderPoint = false;
	for (int32 Index = 0; Index < Path.Widgets.Num(); ++Index)
	{
		bLayerUnderPoint |= Path.Widgets[Index].Widget == StaticCastSharedRef<SWidget>(WonderWebLayer.ToSharedRef());
	}
	bool bDown = false;
	bool bUp = false;
	if (bLayerUnderPoint)
	{
		App.RoutePointerMoveEvent(Path, FPointerEvent(User, Pointer, At, At, TSet<FKey>(), EKeys::Invalid, 0.0f, FModifierKeysState()), false);
		bDown = App.RoutePointerDownEvent(Path, FPointerEvent(User, Pointer, At, At, Held, EKeys::LeftMouseButton, 0.0f, FModifierKeysState())).IsEventHandled();
		bUp = App.RoutePointerUpEvent(Path, FPointerEvent(User, Pointer, At, At, TSet<FKey>(), EKeys::LeftMouseButton, 0.0f, FModifierKeysState())).IsEventHandled();
	}
	// WHAT THE CLICK LANDED ON, leaf first: the proof reads this when a control does not answer.
	TArray<FString> Leaf;
	for (int32 Index = Path.Widgets.Num() - 1; Index >= 0 && Leaf.Num() < 6; --Index)
	{
		const TSharedRef<SWidget>& Widget = Path.Widgets[Index].Widget;
		Leaf.Add(FString::Printf(TEXT("%s%s"), *Widget->GetTypeAsString(), Widget->IsHovered() ? TEXT("(hovered)") : TEXT("")));
	}
	const bool bReached = WonderWebLayer->GetForwardedClicks() > ClicksBefore;
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web click %s/%s at (%.0f, %.0f): layer under the point %d, %s, down %d up %d, path %s"), *Window.ToString(), *Control.ToString(), At.X, At.Y,
		bLayerUnderPoint ? 1 : 0, bReached ? TEXT("reached the window") : TEXT("did not reach the window"), bDown ? 1 : 0, bUp ? 1 : 0, *FString::Join(Leaf, TEXT(" < ")));
	return bReached;
}

bool UWonderlandUiSubsystem::SimulateWonderWebWindowScroll(FName Window, FName Control, float Delta)
{
	if (!IsWonderWebOpen() || !FSlateApplication::IsInitialized() || !WonderWebLayer.IsValid())
	{
		return false;
	}
	const FVector2D At = GetWonderWebWindowControlOnScreen(Window, Control);
	if (At.X < 0.0)
	{
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	const TSharedPtr<SWindow> SlateWindow = App.FindWidgetWindow(WonderWebLayer.ToSharedRef());
	if (!SlateWindow.IsValid())
	{
		return false;
	}
	// The same hit test the click takes, for the same reason: the layer's own window, not the whole desktop.
	const FWidgetPath Path = WonderlandUiHitTest::PathInWindow(SlateWindow.ToSharedRef(), At, App.GetUserIndexForMouse());
	const FPointerEvent Wheel(static_cast<uint32>(App.GetUserIndexForMouse()), FSlateApplicationBase::CursorPointerIndex,
		At, At, TSet<FKey>(), EKeys::MouseWheelAxis, Delta, FModifierKeysState());
	const bool bHandled = App.RouteMouseWheelOrGestureEvent(Path, Wheel, nullptr).IsEventHandled();
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web scroll %s/%s at (%.0f, %.0f) by %.1f: handled %d"),
		*Window.ToString(), *Control.ToString(), At.X, At.Y, Delta, bHandled ? 1 : 0);
	return bHandled;
}

bool UWonderlandUiSubsystem::SimulateWonderWebWindowType(const FString& Text)
{
	if (!FSlateApplication::IsInitialized() || Text.IsEmpty())
	{
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	const int32 User = App.GetUserIndexForKeyboard();
	for (const TCHAR Char : Text)
	{
		if (Char < 0x20)
		{
			continue;
		}
		// A real character event to whatever has keyboard focus, which after a click on the page is the page.
		App.ProcessKeyCharEvent(FCharacterEvent(Char, FModifierKeysState(), User, false));
	}
	// WHAT WAS TYPED IS NOT LOGGED, only that something was: this path reaches real websites.
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web typed %d characters into whatever has focus"), Text.Len());
	return true;
}

bool UWonderlandUiSubsystem::SimulateWonderWebWindowKey(FName Key)
{
	if (!FSlateApplication::IsInitialized())
	{
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	const FKey Pressed(Key);
	if (!Pressed.IsValid())
	{
		return false;
	}
	const FKeyEvent Event(Pressed, FModifierKeysState(), App.GetUserIndexForKeyboard(), false, 0, 0);
	const bool bDown = App.ProcessKeyDownEvent(Event);
	App.ProcessKeyUpEvent(Event);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web key %s: handled %d"), *Key.ToString(), bDown ? 1 : 0);
	return bDown;
}

bool UWonderlandUiSubsystem::IsBrowserWindow(FName Window)
{
	if (Window == WonderWebWindowIds::Browser)
	{
		return true;
	}
	// "browser-2" and up, to a bound: each browser window is a real page in another process.
	const FString Text = Window.ToString();
	if (!Text.StartsWith(TEXT("browser-")))
	{
		return false;
	}
	// A SHAPE CHECK, NOT A LIMIT. Whether this account may have another open is a different question, asked of the
	// entitlement at the moment of spawning -- so raising a tier never means editing this.
	const int32 Number = FCString::Atoi(*Text.RightChop(8));
	return Number >= 2 && Number <= WonderWebWindowIds::MaxBrowserId;
}

bool UWonderlandUiSubsystem::NavigateFocusedBrowser(const FString& Url, FString& OutRefusal)
{
	UWonderlandWonderWebBrowseSubsystem* Pages = BrowseState();
	if (Pages == nullptr)
	{
		OutRefusal = TEXT("there are no pages in this build");
		return false;
	}
	// THE WINDOW IN FRONT, if it is a browser at all; otherwise the first one, which is where a lone `Go` should land.
	const FName Window = IsBrowserWindow(FocusedWonderWebWindow) ? FocusedWonderWebWindow : WonderWebWindowIds::Browser;
	if (Window == WonderWebWindowIds::Browser)
	{
		// The first window goes through the shared browse state: that is what Julius's story and the page label follow.
		return Pages->Navigate(Url, OutRefusal);
	}
	if (!Pages->IsRealMode())
	{
		OutRefusal = TEXT("real mode is off: set wl.WonderWeb.Real 1 to load real pages");
		return false;
	}
	FString Host;
	if (!UWonderlandWonderWebBrowseSubsystem::IsHostAllowed(Url, Host))
	{
		OutRefusal = Host.IsEmpty()
			? FString::Printf(TEXT("'%s' is not an http(s) address"), *Url)
			: FString::Printf(TEXT("%s is not on wl.WonderWeb.RealHosts, so it was not loaded"), *Host);
		return false;
	}
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	UWonderlandWonderWebLiveSubsystem* LiveWeb = Instance != nullptr ? Instance->GetSubsystem<UWonderlandWonderWebLiveSubsystem>() : nullptr;
	if (LiveWeb == nullptr)
	{
		OutRefusal = TEXT("the live browser is not available in this build");
		return false;
	}
	LiveWeb->Navigate(Window.ToString(), Url);
	return true;
}

bool UWonderlandUiSubsystem::SimulateWonderWebClick(FName Control)
{
	return SimulateWonderWebWindowClick(WonderWebWindowIds::Creation, Control);
}

bool UWonderlandUiSubsystem::MoveWonderWeb(FName Place)
{
	AWonderlandWonderWebScreen* Screen = FocusedWonderWebScreen();
	if (Screen == nullptr)
	{
		// Nothing focused yet: the creation window, stood (closed) so the place is kept for when it opens.
		const FWonderWebWindow* Window = EnsureWonderWebWindow(WonderWebWindowIds::Creation);
		Screen = Window != nullptr ? Window->Screen.Get() : nullptr;
	}
	const bool bMoved = Screen != nullptr && Screen->MoveTo(Place);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web move to %s: %s"), *Place.ToString(), bMoved ? TEXT("gliding") : TEXT("unknown place"));
	return bMoved;
}

FString UWonderlandUiSubsystem::DescribeWonderWebPlacement() const
{
	const AWonderlandWonderWebScreen* Screen = FocusedWonderWebScreen();
	if (Screen == nullptr)
	{
		return TEXT("place=none");
	}
	return FString::Printf(TEXT("window=%s place=%s offset=%.1f,%.1f target=%.1f,%.1f gliding=%d dragging=%d"), *FocusedWonderWebWindow.ToString(), *Screen->GetPlace().ToString(),
		Screen->GetOffset().X, Screen->GetOffset().Y, Screen->GetTargetOffset().X, Screen->GetTargetOffset().Y,
		Screen->IsGliding() ? 1 : 0, Screen->IsDragging() ? 1 : 0);
}

bool UWonderlandUiSubsystem::SimulateWonderWebTitleDrag(float DeltaX, float DeltaY, int32 Steps)
{
	AWonderlandWonderWebScreen* Screen = FocusedWonderWebScreen();
	if (!IsWonderWebOpen() || !FSlateApplication::IsInitialized() || !WonderWebLayer.IsValid() || Screen == nullptr)
	{
		return false;
	}
	// The empty stretch of title bar just left of the window's first tab.
	const FVector2D Start = GetWonderWebWindowControlOnScreen(FocusedWonderWebWindow, TEXT("tab:0"));
	if (Start.X < 0.0)
	{
		return false;
	}
	const FVector2D From = Start - FVector2D(118.0, 0.0);
	FSlateApplication& App = FSlateApplication::Get();
	const TSharedPtr<SWindow> Window = App.FindWidgetWindow(WonderWebLayer.ToSharedRef());
	if (!Window.IsValid())
	{
		return false;
	}
	const FWidgetPath Path = WonderlandUiHitTest::PathInWindow(Window.ToSharedRef(), From, App.GetUserIndexForMouse());
	const uint32 User = static_cast<uint32>(App.GetUserIndexForMouse());
	const uint32 Pointer = FSlateApplicationBase::CursorPointerIndex;
	TSet<FKey> Held;
	Held.Add(EKeys::LeftMouseButton);
	App.RoutePointerDownEvent(Path, FPointerEvent(User, Pointer, From, From, Held, EKeys::LeftMouseButton, 0.0f, FModifierKeysState()));
	const bool bTaken = Screen->IsDragging();
	FVector2D Last = From;
	const int32 Count = FMath::Clamp(Steps, 1, 240);
	for (int32 Step = 1; Step <= Count && bTaken; ++Step)
	{
		const FVector2D At = From + FVector2D(DeltaX, DeltaY) * (static_cast<float>(Step) / static_cast<float>(Count));
		// Moves go to the layer directly: while it holds the capture, Slate routes them to it wherever the pointer is.
		const FGeometry& Geometry = WonderWebLayer->GetTickSpaceGeometry();
		WonderWebLayer->OnMouseMove(Geometry, FPointerEvent(User, Pointer, At, Last, Held, EKeys::Invalid, 0.0f, FModifierKeysState()));
		Last = At;
	}
	if (bTaken)
	{
		WonderWebLayer->OnMouseButtonUp(WonderWebLayer->GetTickSpaceGeometry(), FPointerEvent(User, Pointer, Last, Last, TSet<FKey>(), EKeys::LeftMouseButton, 0.0f, FModifierKeysState()));
		App.ReleaseAllPointerCapture();
	}
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web title drag from (%.0f, %.0f) by (%.0f, %.0f): %s"), From.X, From.Y, DeltaX, DeltaY, bTaken ? TEXT("taken and moved") : TEXT("not taken"));
	return bTaken;
}

bool UWonderlandUiSubsystem::SimulateWonderWebKey(FName KeyName, bool bControl)
{
	if (!IsWonderWebOpen() || !FSlateApplication::IsInitialized())
	{
		return false;
	}
	const FKey Key(KeyName);
	if (!Key.IsValid())
	{
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	const FModifierKeysState Modifiers(false, false, bControl, false, false, false, false, false, false);
	const FKeyEvent Event(Key, Modifiers, 0, false, 0, 0);
	const bool bHandled = App.ProcessKeyDownEvent(Event);
	App.ProcessKeyUpEvent(Event);
	return bHandled;
}

bool UWonderlandUiSubsystem::SimulateWonderWebTyping(const FString& Text, bool bPressEnter)
{
	if (!IsWonderWebOpen() || !FSlateApplication::IsInitialized())
	{
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	for (const TCHAR Character : Text)
	{
		App.ProcessKeyCharEvent(FCharacterEvent(Character, FModifierKeysState(), 0, false));
	}
	if (bPressEnter)
	{
		const FKeyEvent Enter(EKeys::Enter, FModifierKeysState(), 0, false, 13, 13);
		App.ProcessKeyDownEvent(Enter);
		App.ProcessKeyUpEvent(Enter);
	}
	return true;
}

UWonderlandProjectBrainSubsystem* UWonderlandUiSubsystem::Brain() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandProjectBrainSubsystem>() : nullptr;
}

void UWonderlandUiSubsystem::ToggleProjectBrain()
{
	if (Open == EOverlay::Brain)
	{
		CloseOverlay();
	}
	else
	{
		OpenOverlay(EOverlay::Brain);
	}
}

bool UWonderlandUiSubsystem::IsProjectBrainOpen() const
{
	return Open == EOverlay::Brain;
}

FVector4 UWonderlandUiSubsystem::GetBrainWindowRect() const
{
	FVector2D Centre, Extent;
	if (!BrainPanel.IsValid() || !BrainPanel->GetBrainSculptureRect(Centre, Extent))
	{
		return FVector4(0.0, 0.0, 0.0, 0.0);
	}
	return FVector4(Centre.X - Extent.X * 0.5, Centre.Y - Extent.Y * 0.5,
					Centre.X + Extent.X * 0.5, Centre.Y + Extent.Y * 0.5);
}

void UWonderlandUiSubsystem::RefreshBrain()
{
	if (!BrainPanel.IsValid())
	{
		return;
	}
	// THE PANEL NEVER HOLDS THE RECORD. It takes a copy of the subsystem's presentation model every time the
	// model moves, and owns nothing between refreshes.
	const UWonderlandProjectBrainSubsystem* BrainSubsystem = Brain();
	BrainPanel->Refresh(BrainSubsystem != nullptr ? BrainSubsystem->GetModel() : FWonderlandBrainModel());
}

bool UWonderlandUiSubsystem::SelectBrainSurface(FName SurfaceId)
{
	if (Open != EOverlay::Brain || !BrainPanel.IsValid())
	{
		return false;
	}
	BrainPanel->Select(SurfaceId);
	return SurfaceId.IsNone() || BrainPanel->GetSelected() == SurfaceId;
}

FName UWonderlandUiSubsystem::GetBrainSelectedSurface() const
{
	return BrainPanel.IsValid() ? BrainPanel->GetSelected() : NAME_None;
}

bool UWonderlandUiSubsystem::ProposeToSelectedBrainSurface(const FString& Text)
{
	return Open == EOverlay::Brain && BrainPanel.IsValid() && BrainPanel->ProposeToSelected(Text);
}

bool UWonderlandUiSubsystem::ShowProjectAvatars(const FString& Argument)
{
	UWorld* World = PlayerWorld();
	APlayerController* Controller = BoundController.Get();
	APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (World == nullptr || Pawn == nullptr || !Terminal.IsValid())
	{
		return true;
	}

	// A SECOND /pa CLEARS THE FIRST, so the founder can look twice without wading through six avatars.
	int32 Cleared = 0;
	for (int32 Index = ShownProjectAvatars.Num() - 1; Index >= 0; --Index)
	{
		if (AActor* Shown = ShownProjectAvatars[Index].Get())
		{
			Shown->Destroy();
			++Cleared;
		}
	}
	ShownProjectAvatars.Reset();
	if (Argument.Equals(TEXT("off"), ESearchCase::IgnoreCase) || Argument.Equals(TEXT("none"), ESearchCase::IgnoreCase))
	{
		Terminal->AddJuliusRow(TEXT("You"), TEXT("/pa off"),
			FString::Printf(TEXT("%d project avatar(s) dismissed."), Cleared));
		return true;
	}

	FString Stage = Argument.IsEmpty() ? TEXT("Large") : Argument;
	Stage = Stage.Left(1).ToUpper() + Stage.Mid(1).ToLower();
	if (Stage != TEXT("Small") && Stage != TEXT("Medium") && Stage != TEXT("Large"))
	{
		Stage = TEXT("Large");
	}

	static const TCHAR* const Families[] = { TEXT("TenTails"), TEXT("Cherubim"), TEXT("Seraph") };
	const FVector At = Pawn->GetActorLocation();
	const FVector Forward = Pawn->GetActorForwardVector();
	const FVector Right = Pawn->GetActorRightVector();

	TArray<FString> Shown;
	TArray<FString> Missing;
	for (int32 Index = 0; Index < UE_ARRAY_COUNT(Families); ++Index)
	{
		// THE ACCEPTED FAMILY IS NOW THE .wlvox ONE, AND THAT IS A REVERSAL WORTH STATING. This spawned the world
		// lane's BP_Avatar_* Blueprints because they were the newer assets and the founder had said "do not
		// silently substitute old voxel placeholders if newer assets exist". Both halves of that have since
		// changed: on 2026-09-23 the founder rejected every BP_Avatar_* body as blocky and LEGO-like, the whole
		// line was handed to this lane, the figures were remade from the forge, and the founder approved THOSE.
		// So showing the .wlvox figures is no longer a silent substitution of something older -- it is the only
		// way /pa shows what was actually accepted. The Blueprints are deliberately no longer loaded.
		const FString Figure = FPaths::ConvertRelativePathToFull(
			FPaths::ProjectDir() / TEXT("ProjectAvatars") / FString::Printf(TEXT("%s_%s.wlvox"), Families[Index], *Stage));
		if (!FPaths::FileExists(Figure))
		{
			Missing.Add(FString::Printf(TEXT("%s %s"), Families[Index], *Stage.ToUpper()));
			continue;
		}
		// SPREAD ACROSS THE VIEW, far enough apart that a five-metre creature does not stand inside its neighbour.
		const float Lateral = (static_cast<float>(Index) - 1.0f) * 620.0f;
		const FVector Where = At + Forward * 900.0 + Right * Lateral - FVector(0.0, 0.0, 88.0);
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		AWonderlandCompanionEmbodiment* Body = World->SpawnActor<AWonderlandCompanionEmbodiment>(
			AWonderlandCompanionEmbodiment::StaticClass(),
			FTransform((At - Where).GetSafeNormal2D().Rotation(), Where), Params);
		if (Body == nullptr || !Body->LoadFigure(Figure))
		{
			if (Body != nullptr) { Body->Destroy(); }
			Missing.Add(FString::Printf(TEXT("%s %s (figure would not load)"), Families[Index], *Stage.ToUpper()));
			continue;
		}
		Body->DisplayName = FString::Printf(TEXT("%s %s"), Families[Index], *Stage.ToUpper());
		Body->ClassLabel = TEXT("PROJECT AVATAR");
		// THE OVERHANG, WHICH IS THE WHOLE TRAP THE HANDOFF WARNED ABOUT. The Blueprints were levelled so their
		// lowest geometry sat at z=0 and could be dropped straight on the ground. These figures are not: each one
		// carries its own overhang, and the two families' conventions cannot be mixed without burying one and
		// floating the other. So the lift is MEASURED from the figure's own lowest instance rather than assumed.
		// MEASURED AT LOAD, NOT WALKED BACK OUT. This used to read every instance of every component through
		// GetInstanceTransform(bWorldSpace=true) to find the figure's feet -- 95,594 calls for one /pa at Large
		// (Cherubim 36,025 + Seraph 19,724 + TenTails 39,845 boxes), all on the spawn frame, to recover a number
		// LoadFigure had already computed while parsing. That was the spawn hitch, and it grew with every avatar.
		// The figure's feet sit GetFigureLowestUu() below its origin, so lifting by exactly that puts them on Where.
		const double Lift = -static_cast<double>(Body->GetFigureLowestUu());
		Body->SetActorLocation(Where + FVector(0.0, 0.0, Lift), false, nullptr, ETeleportType::TeleportPhysics);
#if WITH_EDITOR
		Body->SetActorLabel(FString::Printf(TEXT("WL_PA_%s_%s"), Families[Index], *Stage), false);
#endif
		ShownProjectAvatars.Add(Body);
		Shown.Add(FString::Printf(TEXT("%s %s"), Families[Index], *Stage.ToUpper()));
	}

	const FString Headline = Shown.Num() > 0
		? FString::Printf(TEXT("%d Project Avatar(s) standing ahead: %s"), Shown.Num(), *FString::Join(Shown, TEXT(", ")))
		: TEXT("No Project Avatar assets could be loaded.");
	const FString Sub = Missing.Num() > 0
		? FString::Printf(TEXT("DEVELOPMENT PREVIEW. Not built yet: %s"), *FString::Join(Missing, TEXT(", ")))
		: TEXT("DEVELOPMENT PREVIEW - a showcase only. No project's real progression is changed by this.");
	Terminal->AddJuliusRow(TEXT("You"), FString::Printf(TEXT("/pa %s"), *Stage.ToLower()), Headline);
	Terminal->AddJuliusRow(TEXT("Wonderland"), Headline, Sub);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI /pa -> %d shown, %d missing"), Shown.Num(), Missing.Num());
	return true;
}

bool UWonderlandUiSubsystem::HandleTerminalCommand(const FString& Text)
{
	const FString Line = Text.TrimStartAndEnd();
	if (!Line.StartsWith(TEXT("/")) || !Terminal.IsValid())
	{
		return false;
	}
	FString Command = Line;
	FString Argument;
	Line.Split(TEXT(" "), &Command, &Argument, ESearchCase::IgnoreCase, ESearchDir::FromStart);
	Command = Command.ToLower().TrimStartAndEnd();
	Argument = Argument.TrimStartAndEnd();

	if (Command == TEXT("/tasks"))
	{
		// THE RECORD, AND THE WAY BACK INTO THE WORKSPACE. `/tasks` lists every task with its state and whether it
		// is open; `/tasks open N` brings a closed one back as a tab and an orb; `/tasks close N` is the X.
		UWonderlandMissionTaskSubsystem* Set = Tasks();
		if (Set == nullptr)
		{
			Terminal->AddJuliusRow(TEXT("You"), Line, TEXT("There is no task set in this world."));
			return true;
		}
		FString Verb, Which;
		Argument.Split(TEXT(" "), &Verb, &Which);
		if (Verb.IsEmpty()) { Verb = Argument; }
		const TArray<FWonderlandMissionTask>& Rows = Set->GetTasks();
		if (Verb.Equals(TEXT("open"), ESearchCase::IgnoreCase) || Verb.Equals(TEXT("close"), ESearchCase::IgnoreCase))
		{
			const int32 Index = FCString::Atoi(*Which) - 1;
			if (!Rows.IsValidIndex(Index))
			{
				Terminal->AddJuliusRow(TEXT("You"), Line, FString::Printf(TEXT("No task %s. /tasks lists them."), *Which));
				return true;
			}
			const bool bOpen = Verb.Equals(TEXT("open"), ESearchCase::IgnoreCase);
			const bool bOk = bOpen ? Set->ReopenInWorkspace(Rows[Index].LocalId) : Set->CloseFromWorkspace(Rows[Index].LocalId);
			Terminal->AddJuliusRow(TEXT("You"), Line, bOk
				? FString::Printf(TEXT("Task %d %s. Its Mission Contract is unchanged."), Index + 1, bOpen ? TEXT("reopened") : TEXT("closed"))
				: TEXT("Refused -- see the log."));
			return true;
		}
		if (Rows.Num() == 0)
		{
			Terminal->AddJuliusRow(TEXT("You"), Line, TEXT("No tasks. Press + to open one."));
			return true;
		}
		for (int32 Index = 0; Index < Rows.Num(); ++Index)
		{
			const FWonderlandMissionTask& Task = Rows[Index];
			Terminal->AddJuliusRow(TEXT("Tasks"),
				FString::Printf(TEXT("%d  %s  %s"), Index + 1, WonderlandTaskStateName(Task.State),
					Task.bInWorkspace ? TEXT("OPEN") : TEXT("closed")),
				Task.Objective.IsEmpty() ? TEXT("(empty draft)") : Task.Objective.Left(72));
		}
		Terminal->AddJuliusRow(TEXT("Tasks"), TEXT("/tasks open N   /tasks close N"),
			TEXT("Closing a tab keeps the contract. Only an explicit cancel would end a mission, and there is none yet."));
		return true;
	}

	if (Command == TEXT("/skin"))
	{
		// THE WARDROBE WITHOUT THE WARDROBE. The panel covers the screen, so the quickest way to compare skins is
		// to not open it: `/skin apollo`, look, `/skin bee`, look.
		//
		// PREVIEW IS NOT OWNERSHIP. This dresses the development preview body and the registry's equipped skin,
		// which is what the in-world Dog and the cards both read. It grants no entitlement and claims no purchase:
		// the panel still says NO ACCOUNT HAS GRANTED THIS, because no account has.
		UWonderlandRelaySkinSubsystem* Registry = RelaySkins();
		if (Registry == nullptr)
		{
			Terminal->AddJuliusRow(TEXT("You"), Line, TEXT("There is no skin registry in this world."));
			return true;
		}
		if (Argument.Equals(TEXT("off"), ESearchCase::IgnoreCase) || Argument.Equals(TEXT("none"), ESearchCase::IgnoreCase))
		{
			// OFF IS RELAY OG: the Dog's own body. There is no separate preview body to dismiss any more.
			Registry->EquipSkin(TEXT("relay_og"));
			Terminal->AddJuliusRow(TEXT("You"), TEXT("/skin off"), TEXT("RELAY OG. The Dog wears its own body."));
			return true;
		}
		if (Argument.IsEmpty() || Argument.Equals(TEXT("list"), ESearchCase::IgnoreCase))
		{
			TArray<FString> Names;
			for (const FWonderlandRelaySkin& Skin : Registry->GetSkins())
			{
				Names.Add(Skin.SkinId.ToString());
			}
			Terminal->AddJuliusRow(TEXT("You"), Line, FString::Join(Names, TEXT("  ")));
			return true;
		}
		const FName Wanted(*Argument.ToLower().Replace(TEXT(" "), TEXT("_")));
		if (!Registry->EquipSkin(Wanted))
		{
			Terminal->AddJuliusRow(TEXT("You"), Line,
				FString::Printf(TEXT("No skin named '%s'. Try /skin list."), *Argument));
			return true;
		}
		Terminal->AddJuliusRow(TEXT("You"), Line,
			FString::Printf(TEXT("%s - your Relay Dog wears it now. DEVELOPMENT PREVIEW: appearance only, no entitlement granted."),
				*Argument.ToUpper()));
		return true;
	}

	if (Command == TEXT("/pa"))
	{
		// FOUNDER PREVIEW: every Project Avatar family that actually exists, standing in front of the founder.
		//
		// A PROJECT AVATAR IS THE REPRESENTATION OF A PROJECT. Not Julius, not the Relay Dog, not a sub-agent, not
		// a Jhinn and not the LLM Companion. Nothing here spawns or touches any of those, and nothing here moves
		// a project's real progression: this is a development showcase and it is the founder's own dev command.
		//
		// THE HANDED-OVER MESH ASSETS, NOT THE VOXEL PLACEHOLDERS. The founder was explicit -- "Do not silently
		// substitute old voxel placeholders if newer assets exist" -- and the world lane's BP_Avatar_* Blueprints
		// are the newer ones. A family whose Blueprint will not load is REPORTED MISSING rather than quietly
		// replaced by the .wlvox figure of the same name, because those are different asset families and saying
		// otherwise would show the founder one thing while naming another.
		return ShowProjectAvatars(Argument);
	}

	if (Command == TEXT("/cubs"))
	{
		UWorld* World = PlayerWorld();
		UWonderlandSubAgentCubSubsystem* Flock = World != nullptr ? World->GetSubsystem<UWonderlandSubAgentCubSubsystem>() : nullptr;
		if (Flock == nullptr)
		{
			Terminal->AddJuliusRow(TEXT("You"), Line, TEXT("There is no sub-agent flock in this world."));
			return true;
		}
		// `/cubs` on its own brings out as many as this account may run; a number asks for that many; `off` or `0`
		// sends them home. Nothing here needs a mission: the cubs escort the Dog, and the Dog is always there.
		int32 Wanted = Flock->GetMaxSubAgentCubCount();
		if (Argument.Equals(TEXT("off"), ESearchCase::IgnoreCase) || Argument.Equals(TEXT("none"), ESearchCase::IgnoreCase))
		{
			Wanted = 0;
		}
		else if (!Argument.IsEmpty() && Argument.IsNumeric())
		{
			Wanted = FCString::Atoi(*Argument);
		}
		const int32 Given = Flock->SummonSubAgentCubs(Wanted);
		const FString Note = Given == 0
			? FString(TEXT("The cubs are returning to the Relay Dog."))
			: FString::Printf(
				TEXT("%d sub-agent cub%s summoned. SUMMONED BY YOU — this is not a report that Julius is running %d sub-agents. "
				     "They swirl around the Dog while it is still and fly above it while it moves."),
				Given, Given == 1 ? TEXT("") : TEXT("s"), Given);
		Terminal->AddJuliusRow(TEXT("You"), Line, Note);
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI /cubs -> %d summoned"), Given);
		return true;
	}

	if (Command == TEXT("/help") || Command == TEXT("/commands"))
	{
		Terminal->AddJuliusRow(TEXT("You"), Line,
			TEXT("/cubs [n|off] — summon the Relay Dog's sub-agent cub ghosts, in a mission or out of one."));
		return true;
	}

	// AN UNKNOWN SLASH COMMAND IS NOT SILENTLY SENT ANYWHERE. A line beginning with a slash was meant as a command,
	// and passing it on as a message to a Julius that is not connected would answer the wrong question twice.
	Terminal->AddJuliusRow(TEXT("You"), Line,
		FString::Printf(TEXT("%s is not a Wonderland command. Try /help."), *Command));
	return true;
}

void UWonderlandUiSubsystem::HandleTerminalSubmit(const FString& Text)
{
	if (!Terminal.IsValid())
	{
		return;
	}
	if (HandleTerminalCommand(Text))
	{
		return;
	}
	// Recorded as the visitor's own line and marked unsent. The world can FOLLOW a Julius run but has no way to
	// send Julius anything, and a terminal that answered anyway would be inventing Julius. While a real run is
	// followed the reason says that, rather than claiming there is no connection at all.
	const UWonderlandMissionSubsystem* Mission = Missions();
	const bool bFollowing = Mission != nullptr && Mission->IsFollowingRealRun();
	Terminal->AddJuliusRow(TEXT("You"), Text, bFollowing
		? FString::Printf(TEXT("Not sent: this world follows run %s read-only and cannot send commands to Julius yet."), *Mission->GetFollowedRunId())
		: FString(TEXT("Not sent: Julius 3.3 is not connected to this world yet.")));
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI terminal line recorded, not sent (%s): %d characters"),
		bFollowing ? TEXT("following read-only") : TEXT("no Julius link"), Text.Len());
}

namespace WonderlandLiveJuliusDetail
{
	/** The link, in the words a row gives it. A link event is never a mission event, and none of these is an ending. */
	const TCHAR* LinkWord(EWonderlandLinkState State)
	{
		switch (State)
		{
		case EWonderlandLinkState::NeverConnected: return TEXT("NOT CONNECTED");
		case EWonderlandLinkState::Pairing:        return TEXT("PAIRING");
		case EWonderlandLinkState::Live:           return TEXT("LIVE");
		case EWonderlandLinkState::Stale:          return TEXT("STALE · showing the last known state");
		case EWonderlandLinkState::SessionExpired: return TEXT("SESSION EXPIRED · pair again");
		case EWonderlandLinkState::Refused:        return TEXT("REFUSED");
		default: break;
		}
		return TEXT("UNKNOWN");
	}
}

bool UWonderlandUiSubsystem::TickLiveJulius(float DeltaSeconds)
{
	const UWonderlandMissionSubsystem* Mission = Missions();
	// NOTHING REAL IS FOLLOWED, or a fixture is playing -- IsFollowingRealRun is false for both, since a fixture is a
	// simulation and the terminal is its to narrate. The live line comes down either way, so the banner can never name
	// a run no one is following.
	if (Mission == nullptr || !Mission->IsFollowingRealRun())
	{
		if (bLiveJuliusShown && Terminal.IsValid())
		{
			Terminal->SetLiveProvenance(FString());
			// A fixture takes the terminal over itself: its first event is a new mission, which resets it. Anything else
			// means the Mission Contract stopped following the run -- say so, and put the section back at rest rather
			// than leave the run's last state standing without the line that named it.
			if (Mission == nullptr || !Mission->IsFixtureRunning())
			{
				Terminal->AddJuliusRow(TEXT("Julius"), FString::Printf(TEXT("No longer following run %s"), *LiveJuliusRun),
					TEXT("The rows above are what was last known."));
				Terminal->SetSectionState(TEXT("JULIUS 3.3"), TEXT("STANDBY"), FString());
				RoleFeeds[static_cast<int32>(EWonderlandJuliusRole::Julius)].Status = TEXT("STANDBY");
			}
		}
		bLiveJuliusShown = false;
		return true;
	}
	// Created the way a narrated mission creates it, so a run followed while the terminal is closed is there to read
	// when it opens.
	EnsureLiveTerminal();
	if (!Terminal.IsValid())
	{
		return true;
	}

	const FString Run = Mission->GetFollowedRunId();
	const FString Said = Mission->GetFollowedJuliusState();
	const FString Label = Mission->GetFollowedStateLabel();
	// FOLLOWING is the founder's own word for a run the world follows before Julius has named a state.
	const FString Shown = Label.IsEmpty() ? FString(TEXT("FOLLOWING")) : Label;
	const FString SaidShown = Said.IsEmpty() ? FString(TEXT("no state reported yet")) : Said.ToUpper();
	const FString Where = FString::Printf(TEXT("run %s · Julius: %s"), *Run, *SaidShown);

	if (!bLiveJuliusShown || Run != LiveJuliusRun)
	{
		// WHAT THE TERMINAL HELD BELONGS TO SOMETHING ELSE -- a simulation's rows, or another run's. A fixture's rows
		// under a JULIUS LIVE line would read as this run's work, so they go, as a new mission's do; and a role still
		// typing a fixture's lines is stopped, or it would go on writing them under the live line.
		for (FRoleFeed& Feed : RoleFeeds)
		{
			Feed = FRoleFeed();
		}
		RoleOccurrences.Reset();
		Terminal->ResetSimulation();
		Terminal->SetSimulated(false);
		Terminal->SetFocusSection(TEXT("JULIUS 3.3"));
		Terminal->AddJuliusRow(TEXT("Julius"),
			FString::Printf(TEXT("Following %s · %s"), *Mission->GetFoldMissionId().ToString(), *Shown), Where);
		Terminal->SetSectionState(TEXT("JULIUS 3.3"), Shown, FString());
		// The role's own reading says what its section says, or a proof reading GetJuliusRoleStatus would see STANDBY.
		RoleFeeds[static_cast<int32>(EWonderlandJuliusRole::Julius)].Status = Shown;
		bLiveJuliusShown = true;
		LiveJuliusRun = Run;
		LiveJuliusSaid = Said;
		LiveJuliusLabel = Shown;
		LiveJuliusLink = -1;
		LiveJuliusResult.Reset();
	}
	else if (Said != LiveJuliusSaid || Shown != LiveJuliusLabel)
	{
		// THE RUN MOVED. Both words, as the founder asked: what a player reads, and what Julius said.
		Terminal->AddJuliusRow(TEXT("Julius"), FString::Printf(TEXT("%s → %s"), *LiveJuliusLabel, *Shown), Where);
		Terminal->SetSectionState(TEXT("JULIUS 3.3"), Shown, FString());
		RoleFeeds[static_cast<int32>(EWonderlandJuliusRole::Julius)].Status = Shown;
		LiveJuliusSaid = Said;
		LiveJuliusLabel = Shown;
	}

	// THE LINK, in its own row and its own words. It never moves the run's state above it: a dropped link is never an
	// ending, and the terminal keeps the last known state exactly as the world does.
	const ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	const UGameInstance* Instance = Player != nullptr ? Player->GetGameInstance() : nullptr;
	if (const UWonderlandJuliusSubsystem* Julius = Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusSubsystem>() : nullptr)
	{
		const FWonderlandLinkStatus& Link = Julius->GetLinkStatus();
		const int32 LinkNow = static_cast<int32>(Link.State);
		if (LinkNow != LiveJuliusLink)
		{
			// A LIVE link on the first reading is what "Following" already said; anything else is news.
			if (LiveJuliusLink != -1 || Link.State != EWonderlandLinkState::Live)
			{
				Terminal->AddJuliusRow(TEXT("Link"), WonderlandLiveJuliusDetail::LinkWord(Link.State), Link.Explanation);
			}
			LiveJuliusLink = LinkNow;
		}
	}
	// THE USER RESULT (founder decision 5), as the bridge projected it for THIS player: a row when it first arrives
	// and whenever it changes. Only for the run this terminal follows; the transport reads it for its own followed
	// run, and the two are one run unless a switch is mid-flight -- when the row simply waits.
	if (const UWonderlandJuliusStreamSubsystem* Stream = Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusStreamSubsystem>() : nullptr)
	{
		if (Stream->HasResult() && Stream->GetFollowedRunId() == Run)
		{
			const FWonderlandJuliusResultReading& Reading = Stream->GetResultReading();
			const FString Headline = WonderlandJuliusStreamLogic::ResultHeadline(Reading);
			const FString Detail = WonderlandJuliusStreamLogic::ResultDetail(Reading);
			const FString ResultLines = Headline + TEXT("\n") + Detail;
			if (ResultLines != LiveJuliusResult)
			{
				Terminal->AddJuliusRow(TEXT("Result"), Headline, Detail);
				LiveJuliusResult = ResultLines;
			}
		}
	}
	// The same sentence the strip and the Missions panel print, so the three surfaces cannot disagree.
	Terminal->SetLiveProvenance(Mission->GetProvenanceBanner());
	return true;
}

void UWonderlandUiSubsystem::HandleTravel(FName DestinationId)
{
	UWorld* World = PlayerWorld();
	UWonderlandTravelSubsystem* Travel = World != nullptr ? World->GetSubsystem<UWonderlandTravelSubsystem>() : nullptr;
	if (Travel == nullptr)
	{
		return;
	}
	// The map closes first: the fade is seen over the world, and the travel holds input, not the map.
	CloseOverlay();
	FText Refusal;
	if (!Travel->RequestTravel(DestinationId, Refusal))
	{
		PendingMapNotice = Refusal.ToString();
		OpenOverlay(EOverlay::Map);
	}
}

bool UWonderlandUiSubsystem::IsLiveTerminalOpen() const
{
	return Open == EOverlay::Terminal;
}

bool UWonderlandUiSubsystem::IsWorldMapOpen() const
{
	return Open == EOverlay::Map;
}

bool UWonderlandUiSubsystem::IsUsageHudOnScreen() const
{
	return UsageHud != nullptr && UsageHud->IsInViewport();
}

FString UWonderlandUiSubsystem::GetTerminalInputText() const
{
	return Terminal.IsValid() ? Terminal->GetInputText() : FString();
}

int32 UWonderlandUiSubsystem::GetTerminalRowCount() const
{
	return Terminal.IsValid() ? Terminal->GetJuliusRowCount() : 0;
}

int32 UWonderlandUiSubsystem::GetMapStopCount() const
{
	return WorldMap.IsValid() ? WorldMap->GetStopCount() : 0;
}

FName UWonderlandUiSubsystem::GetMapSelectedId() const
{
	return WorldMap.IsValid() ? WorldMap->GetSelectedId() : NAME_None;
}

void UWonderlandUiSubsystem::SelectMapDestination(FName DestinationId)
{
	if (WorldMap.IsValid())
	{
		WorldMap->SelectById(DestinationId);
	}
}

bool UWonderlandUiSubsystem::TeleportToSelected()
{
	if (Open != EOverlay::Map || !WorldMap.IsValid())
	{
		return false;
	}
	const FName Selected = WorldMap->GetSelectedId();
	if (Selected.IsNone())
	{
		return false;
	}
	HandleTravel(Selected);
	return true;
}

/* ------------------------------------------------------------------ overlays by name */

const TCHAR* UWonderlandUiSubsystem::OverlayName(EOverlay Which)
{
	switch (Which)
	{
	case EOverlay::Terminal: return TEXT("live terminal");
	case EOverlay::Map:      return TEXT("world map");
	case EOverlay::Brain:    return TEXT("project brain");
	case EOverlay::Missions: return TEXT("missions");
	case EOverlay::Commands: return TEXT("command station");
	case EOverlay::Menu:     return TEXT("menu");
	case EOverlay::Wallet:   return TEXT("wallet");
	case EOverlay::WonderWeb: return TEXT("wonder web");
	default: break;
	}
	return TEXT("nothing");
}

TSharedPtr<SWidget> UWonderlandUiSubsystem::OverlayWidget(EOverlay Which) const
{
	switch (Which)
	{
	case EOverlay::Terminal: return Terminal;
	case EOverlay::Map:      return WorldMap;
	case EOverlay::Brain:    return BrainPanel;
	case EOverlay::Missions: return MissionsPanel;
	case EOverlay::Commands: return CommandStation;
	case EOverlay::Menu:     return MenuPanel;
	case EOverlay::Wallet:   return WalletPanel;
	case EOverlay::WonderWeb: return WonderWebLayer;
	default: break;
	}
	return nullptr;
}

void UWonderlandUiSubsystem::ToggleOverlay(EOverlay Which)
{
	if (Open == Which)
	{
		CloseOverlay();
	}
	else
	{
		OpenOverlay(Which);
	}
}

void UWonderlandUiSubsystem::ToggleMissions() { ToggleOverlay(EOverlay::Missions); }
void UWonderlandUiSubsystem::ToggleCommandStation() { ToggleOverlay(EOverlay::Commands); }
void UWonderlandUiSubsystem::ToggleMenu() { ToggleOverlay(EOverlay::Menu); }
bool UWonderlandUiSubsystem::IsMissionsOpen() const { return Open == EOverlay::Missions; }
bool UWonderlandUiSubsystem::IsCommandStationOpen() const { return Open == EOverlay::Commands; }
bool UWonderlandUiSubsystem::IsMenuOpen() const { return Open == EOverlay::Menu; }

UWonderlandCommandPresetSubsystem* UWonderlandUiSubsystem::Presets() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandCommandPresetSubsystem>() : nullptr;
}

UWonderlandMissionSubsystem* UWonderlandUiSubsystem::Missions() const
{
	const ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	return LocalPlayer != nullptr ? LocalPlayer->GetSubsystem<UWonderlandMissionSubsystem>() : nullptr;
}

/* ------------------------------------------------------------------ the bottom shortcuts */

void UWonderlandUiSubsystem::HandleNavigate(EWonderlandNavTarget Target)
{
	// A shortcut OPENS where it leads; it never closes it. The keys toggle, because a key pressed twice means
	// "away again", but the strip is only on screen when nothing is open, so a tile has nothing to close.
	EOverlay Want = EOverlay::Menu;
	switch (Target)
	{
	case EWonderlandNavTarget::Agent:    Want = EOverlay::Terminal; break;
	case EWonderlandNavTarget::Missions: Want = EOverlay::Missions; break;
	case EWonderlandNavTarget::Brain:    Want = EOverlay::Brain; break;
	case EWonderlandNavTarget::Commands: Want = EOverlay::Commands; break;
	case EWonderlandNavTarget::Menu:     Want = EOverlay::Menu; break;
	}
	if (Open != Want)
	{
		OpenOverlay(Want);
	}
}

bool UWonderlandUiSubsystem::NavigateTo(FName ShortcutId)
{
	const FWonderlandNavEntry* Entry = WonderlandFindNavEntry(ShortcutId);
	if (Entry == nullptr)
	{
		return false;
	}
	HandleNavigate(Entry->Target);
	return true;
}

bool UWonderlandUiSubsystem::IsNavBarOnScreen() const
{
	return HudFurniture.IsValid() && NavBar.IsValid() && Open == EOverlay::None;
}

FString UWonderlandUiSubsystem::GetNavBarLabels() const
{
	return NavBar.IsValid() ? NavBar->DescribeLabels() : FString();
}

int32 UWonderlandUiSubsystem::GetNavClickCount(FName ShortcutId) const
{
	return NavBar.IsValid() ? NavBar->GetClickCount(ShortcutId) : 0;
}

void UWonderlandUiSubsystem::BeginPointing()
{
	APlayerController* Controller = BoundController.Get();
	// Only over the world: a panel already has the cursor, and the strip is not on screen then anyway.
	if (bPointing || Open != EOverlay::None || Controller == nullptr || !NavBar.IsValid())
	{
		return;
	}
	FInputModeGameAndUI Mode;
	Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
	Mode.SetHideCursorDuringCapture(false);
	Controller->SetInputMode(Mode);
	Controller->SetShowMouseCursor(true);
	// Held, not ignored for good: moving the mouse to a tile must not also swing the camera across the garden.
	Controller->SetIgnoreLookInput(true);
	bPointing = true;
}

void UWonderlandUiSubsystem::EndPointing()
{
	StopPointing(true);
}

void UWonderlandUiSubsystem::StopPointing(bool bRestoreGameInput)
{
	if (!bPointing)
	{
		return;
	}
	bPointing = false;
	APlayerController* Controller = BoundController.Get();
	if (Controller == nullptr)
	{
		return;
	}
	Controller->SetIgnoreLookInput(false);
	if (bRestoreGameInput)
	{
		Controller->SetInputMode(FInputModeGameOnly());
		Controller->SetShowMouseCursor(false);
		if (FSlateApplication::IsInitialized())
		{
			FSlateApplication::Get().SetAllUserFocusToGameViewport();
		}
	}
}

bool UWonderlandUiSubsystem::ClickNavButton(FName ShortcutId)
{
	if (!IsNavBarOnScreen() || !FSlateApplication::IsInitialized())
	{
		return false;
	}
	BeginPointing();
	FSlateRect Rect;
	if (!NavBar->GetTileAbsoluteRect(ShortcutId, Rect))
	{
		return false;
	}
	const int32 Before = NavBar->GetClickCount(ShortcutId);
	RouteClickToWidget(NavBar->GetTileButton(ShortcutId), ShortcutId.ToString());
	const bool bClicked = NavBar->GetClickCount(ShortcutId) > Before;
	if (!bClicked)
	{
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI click diagnosis:\n%s"), *DiagnoseNavClick(ShortcutId));
		StopPointing(true);
	}
	return bClicked;
}

bool UWonderlandUiSubsystem::RouteClickToWidget(const TSharedPtr<SWidget>& Target, const FString& What)
{
	if (!Target.IsValid() || !FSlateApplication::IsInitialized())
	{
		return false;
	}
	const FGeometry& Geometry = Target->GetCachedGeometry();
	if (Geometry.GetLocalSize().IsNearlyZero())
	{
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	const FVector2D Centre(Geometry.GetLayoutBoundingRect().GetCenter());
	const uint32 User = static_cast<uint32>(App.GetUserIndexForMouse());
	const TSet<FKey> None;
	TSet<FKey> Held;
	Held.Add(EKeys::LeftMouseButton);

	// HIT TESTED IN THE WINDOW THE STRIP LIVES IN. The first two versions sent the events through the application's
	// window search, and DiagnoseNavClick showed where they went: at the tile's desktop coordinates the scripted
	// editor ranks its CONTENT BROWSER window above the PIE viewport, so a 47-deep path of asset tiles took every
	// click and the strip never saw one. That is the editor's window stacking, not the HUD. So the search is confined
	// to the strip's own window -- still a real hit test, which a covered or invisible tile would fail -- and the
	// press and release are routed down the path it finds, exactly as the application routes a hand's click.
	// The OS cursor is never moved: a test has no business dragging the founder's real mouse across the screen.
	const TSharedPtr<SWindow> Window = App.FindWidgetWindow(Target.ToSharedRef());
	if (!Window.IsValid())
	{
		return false;
	}
	const FWidgetPath Path = WonderlandUiHitTest::PathInWindow(Window.ToSharedRef(), Centre, App.GetUserIndexForMouse());
	bool bTileUnderPoint = false;
	for (int32 Index = 0; Index < Path.Widgets.Num(); ++Index)
	{
		bTileUnderPoint |= Path.Widgets[Index].Widget == Target.ToSharedRef();
	}
	bool bDown = false;
	bool bUp = false;
	if (bTileUnderPoint)
	{
		App.RoutePointerMoveEvent(Path, FPointerEvent(User, FSlateApplicationBase::CursorPointerIndex, Centre, Centre, None, EKeys::Invalid, 0.0f, FModifierKeysState()), false);
		bDown = App.RoutePointerDownEvent(Path, FPointerEvent(User, FSlateApplicationBase::CursorPointerIndex, Centre, Centre, Held, EKeys::LeftMouseButton, 0.0f, FModifierKeysState())).IsEventHandled();
		bUp = App.RoutePointerUpEvent(Path, FPointerEvent(User, FSlateApplicationBase::CursorPointerIndex, Centre, Centre, None, EKeys::LeftMouseButton, 0.0f, FModifierKeysState())).IsEventHandled();
	}

	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI pointer click on %s at (%.0f, %.0f): under the point %d, down %d, up %d"), *What, Centre.X, Centre.Y,
		bTileUnderPoint ? 1 : 0, bDown ? 1 : 0, bUp ? 1 : 0);
	return bTileUnderPoint;
}

FString UWonderlandUiSubsystem::DiagnoseNavClick(FName ShortcutId)
{
	TArray<FString> Lines;
	if (!NavBar.IsValid() || !FSlateApplication::IsInitialized())
	{
		return TEXT("navbar none");
	}
	FSlateApplication& App = FSlateApplication::Get();
	FSlateRect Rect;
	const bool bRect = NavBar->GetTileAbsoluteRect(ShortcutId, Rect);
	Lines.Add(FString::Printf(TEXT("tile %d %.1f %.1f %.1f %.1f"), bRect ? 1 : 0, Rect.Left, Rect.Top, Rect.Right - Rect.Left, Rect.Bottom - Rect.Top));
	Lines.Add(FString::Printf(TEXT("pointing %d"), bPointing ? 1 : 0));
	Lines.Add(FString::Printf(TEXT("app_active %d"), App.IsActive() ? 1 : 0));
	Lines.Add(FString::Printf(TEXT("strip_on_screen %d"), IsNavBarOnScreen() ? 1 : 0));

	const TSharedPtr<FSlateUser> Cursor = App.GetCursorUser();
	const bool bCapture = Cursor.IsValid() && Cursor->HasCapture(FSlateApplicationBase::CursorPointerIndex);
	const TSharedPtr<SWidget> Captor = Cursor.IsValid() ? Cursor->GetCursorCaptor() : nullptr;
	Lines.Add(FString::Printf(TEXT("capture %d %s"), bCapture ? 1 : 0, Captor.IsValid() ? *Captor->GetTypeAsString() : TEXT("-")));

	if (bRect)
	{
		const FVector2D Centre(Rect.GetCenter());
		const FWidgetPath Path = App.LocateWindowUnderMouse(Centre, App.GetInteractiveTopLevelWindows(), false, App.GetUserIndexForMouse());
		const TSharedPtr<SButton> Tile = NavBar->GetTileButton(ShortcutId);
		bool bTileInPath = false;
		TArray<FString> Types;
		for (int32 Index = 0; Index < Path.Widgets.Num(); ++Index)
		{
			const TSharedRef<SWidget>& Widget = Path.Widgets[Index].Widget;
			if (Tile.IsValid() && Widget == Tile.ToSharedRef())
			{
				bTileInPath = true;
			}
			Types.Add(Widget->GetTypeAsString());
		}
		// The leafmost ten are the part that decides who gets the click.
		const int32 First = FMath::Max(0, Types.Num() - 10);
		Lines.Add(FString::Printf(TEXT("path_len %d"), Types.Num()));
		Lines.Add(FString::Printf(TEXT("path_leaf %s"), *FString::Join(TArray<FString>(Types.GetData() + First, Types.Num() - First), TEXT(" > "))));
		Lines.Add(FString::Printf(TEXT("tile_in_path %d"), bTileInPath ? 1 : 0));
		Lines.Add(FString::Printf(TEXT("window %s"), Path.IsValid() ? *Path.GetWindow()->GetTitle().ToString() : TEXT("-")));

		// And the same point searched only in the strip's own window: what a click routed there would reach.
		const TSharedPtr<SWindow> Own = App.FindWidgetWindow(NavBar.ToSharedRef());
		if (Own.IsValid())
		{
			const FWidgetPath OwnPath = WonderlandUiHitTest::PathInWindow(Own.ToSharedRef(), Centre, App.GetUserIndexForMouse());
			bool bTileInOwn = false;
			TArray<FString> OwnTypes;
			for (int32 Index = 0; Index < OwnPath.Widgets.Num(); ++Index)
			{
				bTileInOwn |= Tile.IsValid() && OwnPath.Widgets[Index].Widget == Tile.ToSharedRef();
				OwnTypes.Add(OwnPath.Widgets[Index].Widget->GetTypeAsString());
			}
			const int32 OwnFirst = FMath::Max(0, OwnTypes.Num() - 8);
			Lines.Add(FString::Printf(TEXT("own_window %s"), *Own->GetTitle().ToString()));
			Lines.Add(FString::Printf(TEXT("own_path_leaf %s"), *FString::Join(TArray<FString>(OwnTypes.GetData() + OwnFirst, OwnTypes.Num() - OwnFirst), TEXT(" > "))));
			Lines.Add(FString::Printf(TEXT("tile_in_own_window_path %d"), bTileInOwn ? 1 : 0));
		}
	}
	return FString::Join(Lines, TEXT("\n"));
}

bool UWonderlandUiSubsystem::SimulateNavTileClick(FName ShortcutId)
{
	return IsNavBarOnScreen() && NavBar->SimulateTileClick(ShortcutId);
}

/* ------------------------------------------------------------------ the HUD furniture */

void UWonderlandUiSubsystem::RefreshChrome()
{
	// THE WARDROBE IS NEVER INTERRUPTED. See the declaration.
	if (Open == EOverlay::Brain)
	{
		return;
	}
	const EOverlay Was = Open;
	if (Was != EOverlay::None)
	{
		CloseOverlay();
	}
	// Every panel whose brushes carry an accent. BrainPanel is deliberately not in this list, and the Julius
	// terminal is an overlay like the rest -- so reopening `Was` brings it back with the rest of them.
	MenuPanel.Reset();
	WorldMap.Reset();
	CommandStation.Reset();
	WalletPanel.Reset();
	Terminal.Reset();

	UnmountCompanionTerminals();
	UnmountHudFurniture();
	MountHudFurniture();
	MountCompanionTerminals();
	EnsureLiveTerminal();
	if (Was != EOverlay::None)
	{
		OpenOverlay(Was);
	}
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI chrome rebuilt for a colour change"));
}

void UWonderlandUiSubsystem::MountHudFurniture()
{
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	APlayerController* Controller = BoundController.Get();
	if (HudFurniture.IsValid() || LocalPlayer == nullptr || LocalPlayer->ViewportClient == nullptr || Controller == nullptr)
	{
		return;
	}
	MiniMapDriver = NewObject<UWonderlandMiniMapDriver>(this);
	MiniMapDriver->Start(Controller);

	const TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);
	SAssignNew(MiniMap, SWonderlandMiniMap).Driver(TWeakObjectPtr<UWonderlandMiniMapDriver>(MiniMapDriver));
	SAssignNew(WalletChip, SWonderlandWalletChip)
		.Wallet(TWeakObjectPtr<UWonderlandWalletSubsystem>(Wallet()))
		.OnOpen_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->OpenOverlay(EOverlay::Wallet); } })
		.Pointing_Lambda([WeakThis]() { return WeakThis.IsValid() && WeakThis->IsPointing(); });
	const bool bShowWallet = GetDefault<UWonderlandWalletHudSettings>()->bShowWallet;
	// THE TOP RIGHT IS ONE COLUMN: the wallet heads it and the mini-map sits under it, so they can never overlap and
	// whatever moves the map (a long mission strip) moves the wallet with it.
	TopRightColumn = SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 0.0f, 0.0f, bShowWallet ? 12.0f : 0.0f)
		[
			SNew(SBox)
			.Visibility(bShowWallet ? EVisibility::SelfHitTestInvisible : EVisibility::Collapsed)
			[
				WalletChip.ToSharedRef()
			]
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
		[
			SNew(SBox)
			.Visibility(EVisibility::HitTestInvisible)
			[
				MiniMap.ToSharedRef()
			]
		];
	SAssignNew(NavBar, SWonderlandNavBar)
		.OnNavigate_Lambda([WeakThis](EWonderlandNavTarget Target) { if (WeakThis.IsValid()) { WeakThis->HandleNavigate(Target); } })
		.Pointing_Lambda([WeakThis]() { return WeakThis.IsValid() && WeakThis->IsPointing(); });

	// TWO SAFE ZONES ON ONE LAYER. The top right is the map's and the bottom edge is the strip's; the usage HUD
	// keeps the top left, the mission strip the top centre, and the terminal suite the whole bottom band while it
	// is open -- which is why the strip steps aside for any panel rather than learning to share.
	HudFurniture = SNew(SConstraintCanvas)
		.Visibility(EVisibility::SelfHitTestInvisible)
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(1.0f, 0.0f, 1.0f, 0.0f))
		.Alignment(FVector2D(1.0, 0.0))
		.AutoSize(true)
		.Offset(TAttribute<FMargin>::CreateLambda([WeakThis]() { return WeakThis.IsValid() ? WeakThis->MiniMapOffset() : FMargin(-28.0f, 22.0f, 0.0f, 0.0f); }))
		[
			SNew(SBox)
			.Visibility_Lambda([WeakThis]() { return WeakThis.IsValid() && WeakThis->IsMiniMapShown() ? EVisibility::SelfHitTestInvisible : EVisibility::Collapsed; })
			[
				TopRightColumn.ToSharedRef()
			]
		]
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.5f, 1.0f, 0.5f, 1.0f))
		.Alignment(FVector2D(0.5, 1.0))
		.AutoSize(true)
		.Offset(FMargin(0.0f, -16.0f, 0.0f, 0.0f))
		[
			SNew(SBox)
			.Visibility_Lambda([WeakThis]() { return WeakThis.IsValid() && WeakThis->Open == EOverlay::None ? EVisibility::SelfHitTestInvisible : EVisibility::Collapsed; })
			[
				NavBar.ToSharedRef()
			]
		]
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.5f, 0.0f, 0.5f, 0.0f))
		.Alignment(FVector2D(0.5, 0.0))
		.AutoSize(true)
		.Offset(FMargin(0.0f, 132.0f, 0.0f, 0.0f))
		[
			SNew(SBox)
			.Visibility_Lambda([WeakThis]()
			{
				return WeakThis.IsValid() && !WeakThis->AnnouncedTerritory().IsNone()
					? EVisibility::HitTestInvisible : EVisibility::Collapsed;
			})
			[
				SNew(SBorder)
				.BorderImage(TerritoryBannerBrush.Get())
				.Padding(FMargin(30.0f, 14.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
					[
						SNew(STextBlock)
						.Text_Lambda([WeakThis]() { return FText::FromString(WeakThis.IsValid() ? WeakThis->AnnouncedName() : FString()); })
						.Font(WonderlandUi::Sans(22, true, 240))
						.ShadowOffset(FVector2D(1.0f, 1.0f)).ShadowColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, 0.9f))
						.ColorAndOpacity_Lambda([WeakThis]()
						{
							return FSlateColor(WeakThis.IsValid() ? WeakThis->AnnouncedAccent() : FLinearColor::White);
						})
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 6.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text_Lambda([WeakThis]() { return FText::FromString(WeakThis.IsValid() ? WeakThis->AnnouncedSpecialisation() : FString()); })
						.Font(WonderlandUi::Sans(11, false, 200))
						.ShadowOffset(FVector2D(1.0f, 1.0f)).ShadowColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, 0.9f))
						.ColorAndOpacity(WonderlandUi::Cream())
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 9.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT("CHECKPOINT DISCOVERED"))
						.Font(WonderlandUi::Mono(9))
						.ShadowOffset(FVector2D(1.0f, 1.0f)).ShadowColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, 0.9f))
						.ColorAndOpacity(WonderlandUi::Gold())
					]
				]
			]
		];
	if (!TerritoryBannerBrush.IsValid())
	{
		// DARK ENOUGH TO READ AGAINST IVORY STONE. Photographed at the Icarus checkpoint at 0.86 alpha, the
		// three lines sat on a pale plaza and the gold one nearly vanished; a discovery the founder has to
		// squint at is not a discovery treatment.
		TerritoryBannerBrush = MakeShared<FSlateRoundedBoxBrush>(
			WonderlandUi::Srgb(5, 7, 13, 0.95f), 10.0f, WonderlandUi::Gold(0.80f), 1.4f);
	}

	// ---- THE DISCOVERY BANNER, and it is a banner on purpose.
	//
	// FOUNDER, 2026-09-25: "Show a brief in-world discovery treatment the first time a player enters a
	// territory: TERRITORY NAME, SPECIALIZATION, CHECKPOINT DISCOVERED. It should feel like discovering a real
	// region, not an intrusive full-screen popup."
	//
	// So: three lines, high and centred, never hit-testable, gone in seven seconds, and it cannot appear twice
	// for the same territory because the subsystem only announces on the first entry. Everything it says comes
	// from the canon registry -- including "NEEDS FOUNDER DEFINITION" where the canon states no specialisation,
	// which is the honest thing for the game to say rather than a blank line.
	// Above the usage HUD (10), below the mission strip (18), the companion consoles (20) and every panel.
	LocalPlayer->ViewportClient->AddViewportWidgetForPlayer(LocalPlayer, HudFurniture.ToSharedRef(), 12);
}

void UWonderlandUiSubsystem::UnmountHudFurniture()
{
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	if (HudFurniture.IsValid() && LocalPlayer != nullptr && LocalPlayer->ViewportClient != nullptr)
	{
		LocalPlayer->ViewportClient->RemoveViewportWidgetForPlayer(LocalPlayer, HudFurniture.ToSharedRef());
	}
	HudFurniture.Reset();
	MiniMap.Reset();
	NavBar.Reset();
	WalletChip.Reset();
	TopRightColumn.Reset();
	if (MiniMapDriver != nullptr)
	{
		MiniMapDriver->Stop();
		MiniMapDriver = nullptr;
	}
}

FMargin UWonderlandUiSubsystem::MiniMapOffset() const
{
	const float Right = 28.0f;
	float Top = 22.0f;
	FSlateRect Strip;
	const UWonderlandMissionSubsystem* Mission = Missions();
	if (Mission != nullptr && HudFurniture.IsValid() && TopRightColumn.IsValid() && Mission->GetMissionStripAbsoluteRect(Strip))
	{
		const FGeometry& Canvas = HudFurniture->GetCachedGeometry();
		const FVector2D CanvasSize(Canvas.GetLocalSize());
		// The whole column moves together: wallet and mini-map.
		const FVector2D MapSize(TopRightColumn->GetDesiredSize());
		const FVector2D StripTopLeft(Canvas.AbsoluteToLocal(Strip.GetTopLeft()));
		const FVector2D StripBottomRight(Canvas.AbsoluteToLocal(Strip.GetBottomRight()));
		const double MapLeft = CanvasSize.X - Right - MapSize.X;
		// A narrow viewport or a long strip can reach into the map's column. The top right is still the map's, so it
		// steps down under the strip instead of drawing across it.
		if (StripBottomRight.X + 16.0 > MapLeft && StripTopLeft.Y < Top + MapSize.Y)
		{
			Top = static_cast<float>(StripBottomRight.Y) + 12.0f;
		}
	}
	return FMargin(-Right, Top, 0.0f, 0.0f);
}

/* ------------------------------------------------------------------ the mini-map, read back */

bool UWonderlandUiSubsystem::IsMiniMapOnScreen() const
{
	return HudFurniture.IsValid() && MiniMap.IsValid() && IsMiniMapShown();
}

FString UWonderlandUiSubsystem::GetMiniMapWorldLine() const
{
	return MiniMap.IsValid() ? MiniMap->GetWorldLine() : FString();
}

FString UWonderlandUiSubsystem::GetMiniMapRegionLine() const
{
	return MiniMap.IsValid() ? MiniMap->GetRegionLine() : FString();
}

int32 UWonderlandUiSubsystem::GetMiniMapCaptureCount() const
{
	return MiniMapDriver != nullptr ? MiniMapDriver->GetCaptureCount() : 0;
}

bool UWonderlandUiSubsystem::IsMiniMapCaptureInWorld() const
{
	return MiniMapDriver != nullptr && MiniMapDriver->IsCaptureInWorld();
}

bool UWonderlandUiSubsystem::DidMiniMapDrawPhotograph() const
{
	return MiniMap.IsValid() && MiniMap->GetDisc().IsValid() && MiniMap->GetDisc()->DidDrawCapture();
}

int32 UWonderlandUiSubsystem::GetMiniMapPaintCount() const
{
	return MiniMap.IsValid() && MiniMap->GetDisc().IsValid() ? MiniMap->GetDisc()->GetPaintCount() : 0;
}

double UWonderlandUiSubsystem::GetMiniMapArrowAngle() const
{
	return MiniMap.IsValid() && MiniMap->GetDisc().IsValid() ? MiniMap->GetDisc()->GetDrawnArrowAngleDeg() : 0.0;
}

double UWonderlandUiSubsystem::GetMiniMapViewAngle() const
{
	return MiniMap.IsValid() && MiniMap->GetDisc().IsValid() ? MiniMap->GetDisc()->GetDrawnViewAngleDeg() : 0.0;
}

double UWonderlandUiSubsystem::GetMiniMapUUPerPixel() const
{
	return MiniMap.IsValid() && MiniMap->GetDisc().IsValid() ? MiniMap->GetDisc()->GetDrawnUUPerPixel() : 0.0;
}

bool UWonderlandUiSubsystem::GetMiniMapMarkerOffset(FName PlaceId, FVector2D& OutOffset) const
{
	OutOffset = FVector2D::ZeroVector;
	return MiniMap.IsValid() && MiniMap->GetDisc().IsValid() && MiniMap->GetDisc()->GetDrawnMarkerOffset(PlaceId, OutOffset);
}

bool UWonderlandUiSubsystem::IsMiniMapMarkerDrawn(FName PlaceId) const
{
	FVector2D Ignored;
	return GetMiniMapMarkerOffset(PlaceId, Ignored);
}

FString UWonderlandUiSubsystem::DescribeHudRects() const
{
	if (!HudFurniture.IsValid())
	{
		return FString();
	}
	const FGeometry& Canvas = HudFurniture->GetCachedGeometry();
	TArray<FString> Lines;
	Lines.Add(FString::Printf(TEXT("viewport 0 0 %.1f %.1f 1"), Canvas.GetLocalSize().X, Canvas.GetLocalSize().Y));
	const auto Add = [&Lines, &Canvas](const TCHAR* Name, const FSlateRect& Absolute, bool bShown)
	{
		const FVector2D TopLeft(Canvas.AbsoluteToLocal(Absolute.GetTopLeft()));
		const FVector2D BottomRight(Canvas.AbsoluteToLocal(Absolute.GetBottomRight()));
		Lines.Add(FString::Printf(TEXT("%s %.1f %.1f %.1f %.1f %d"), Name, TopLeft.X, TopLeft.Y,
			BottomRight.X - TopLeft.X, BottomRight.Y - TopLeft.Y, bShown ? 1 : 0));
	};
	const auto FromGeometry = [&Add](const TCHAR* Name, const FGeometry& Geometry, bool bShown)
	{
		// A widget never laid out has no size, and a zero rectangle overlaps nothing -- which would be a pass for
		// the wrong reason. It is left out, and the check counts what it was given.
		if (!Geometry.GetLocalSize().IsNearlyZero())
		{
			Add(Name, Geometry.GetLayoutBoundingRect(), bShown);
		}
	};
	if (UsageHud != nullptr)
	{
		FromGeometry(TEXT("usage_hud"), UsageHud->GetCachedGeometry(), UsageHud->IsInViewport());
	}
	FSlateRect Strip;
	if (const UWonderlandMissionSubsystem* Mission = Missions())
	{
		if (Mission->GetMissionStripAbsoluteRect(Strip))
		{
			Add(TEXT("mission_strip"), Strip, true);
		}
	}
	if (WalletChip.IsValid() && GetDefault<UWonderlandWalletHudSettings>()->bShowWallet)
	{
		FromGeometry(TEXT("wallet"), WalletChip->GetCachedGeometry(), IsMiniMapShown());
	}
	if (MiniMap.IsValid())
	{
		FromGeometry(TEXT("mini_map"), MiniMap->GetCachedGeometry(), IsMiniMapShown());
	}
	if (NavBar.IsValid())
	{
		FromGeometry(TEXT("nav_bar"), NavBar->GetCachedGeometry(), Open == EOverlay::None);
	}
	for (int32 Index = 0; Index < CompanionTerminals.Num(); ++Index)
	{
		if (CompanionTerminals[Index].IsValid())
		{
			FromGeometry(Index == 0 ? TEXT("companion_left") : TEXT("companion_right"), CompanionTerminals[Index]->GetCachedGeometry(), AreCompanionTerminalsOnScreen());
		}
	}
	return FString::Join(Lines, TEXT("\n"));
}

/* ------------------------------------------------------------------ the command station, driven as its buttons drive it */

bool UWonderlandUiSubsystem::SelectCommandSlot(int32 Slot)
{
	if (Open != EOverlay::Commands || !CommandStation.IsValid())
	{
		return false;
	}
	CommandStation->SelectSlot(Slot);
	return CommandStation->GetSelectedSlot() == Slot;
}

bool UWonderlandUiSubsystem::EquipCommandToSelectedSlot(FName CommandId)
{
	return Open == EOverlay::Commands && CommandStation.IsValid() && CommandStation->EquipToSelectedSlot(CommandId);
}

FString UWonderlandUiSubsystem::GetCommandStationSlotRows() const
{
	return CommandStation.IsValid() ? CommandStation->DescribeSlotRows() : FString();
}

FString UWonderlandUiSubsystem::GetTerminalCommandRows() const
{
	return Terminal.IsValid() ? Terminal->DescribeCommandRows() : FString();
}

/* ------------------------------------------------------------------ the Wonder Web Wallet */

UWonderlandWalletSubsystem* UWonderlandUiSubsystem::Wallet() const
{
	const APlayerController* Controller = BoundController.Get();
	UGameInstance* Instance = Controller != nullptr ? Controller->GetGameInstance() : nullptr;
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandWalletSubsystem>() : nullptr;
}

void UWonderlandUiSubsystem::ToggleWallet() { ToggleOverlay(EOverlay::Wallet); }
bool UWonderlandUiSubsystem::IsWalletOpen() const { return Open == EOverlay::Wallet; }

bool UWonderlandUiSubsystem::IsWalletOnScreen() const
{
	return HudFurniture.IsValid() && WalletChip.IsValid() && IsMiniMapShown() && GetDefault<UWonderlandWalletHudSettings>()->bShowWallet;
}

FString UWonderlandUiSubsystem::GetWalletDrawnBalance() const { return WalletChip.IsValid() ? WalletChip->GetDrawnBalance() : FString(); }
FString UWonderlandUiSubsystem::GetWalletDrawnUnit() const { return WalletChip.IsValid() ? WalletChip->GetDrawnUnit() : FString(); }
FString UWonderlandUiSubsystem::GetWalletDrawnClaim() const { return WalletChip.IsValid() ? WalletChip->GetDrawnClaim() : FString(); }

bool UWonderlandUiSubsystem::ClickWalletChip()
{
	if (!IsWalletOnScreen() || Open != EOverlay::None)
	{
		return false;
	}
	BeginPointing();
	const int32 Before = WalletChip->GetOpenClicks();
	RouteClickToWidget(WalletChip->GetButton(), TEXT("wallet"));
	const bool bClicked = WalletChip->GetOpenClicks() > Before;
	if (!bClicked)
	{
		StopPointing(true);
	}
	return bClicked && IsWalletOpen();
}

/* ------------------------------------------------------------------ simulated mission narration */

void UWonderlandUiSubsystem::EnsureLiveTerminal()
{
	if (Terminal.IsValid())
	{
		return;
	}
	// Created once and kept: its log survives closing and reopening, and a mission it narrates while closed is there
	// when it opens.
	const TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);
	const UWonderlandCommandPresetSubsystem* CommandPresets = Presets();
	SAssignNew(Terminal, SWonderlandLiveTerminal)
		.CommandSlotCount(CommandPresets != nullptr ? CommandPresets->GetSlotCount() : GetDefault<UWonderlandCommandSettings>()->QuickSlotCount)
		.OnGetCommandLabel_Lambda([WeakThis](int32 Slot)
		{
			const UWonderlandCommandPresetSubsystem* Source = WeakThis.IsValid() ? WeakThis->Presets() : nullptr;
			return Source != nullptr ? Source->GetSlotLabel(Slot) : FString();
		})
		.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
		// ONE IDENTITY, THREE SURFACES. A tab, its Mission Contract and its orb are the same task seen three ways,
		// so the strip is built straight from the task set and carries that task's own LocalId. Nothing here mints
		// a terminal id of its own -- which is exactly what the founder ruled out.
		.OnGetTaskTabs_Lambda([WeakThis]()
		{
			TArray<SWonderlandLiveTerminal::FTaskTab> Out;
			const UWonderlandMissionTaskSubsystem* Set = WeakThis.IsValid() ? WeakThis->Tasks() : nullptr;
			if (Set == nullptr)
			{
				return Out;
			}
			const TArray<FWonderlandMissionTask>& Rows = Set->GetTasks();
			for (int32 Index = 0; Index < Rows.Num(); ++Index)
			{
				// A TAB IS A TASK OPEN IN THE WORKSPACE. A closed one is on record and reachable through /tasks,
				// and its orb is gone with it -- the same flag decides both.
				if (!Rows[Index].bInWorkspace)
				{
					continue;
				}
				SWonderlandLiveTerminal::FTaskTab Tab;
				Tab.Id = Rows[Index].LocalId;
				Tab.bSelected = Rows[Index].LocalId == Set->GetSelected();
				Tab.bDraft = !WonderlandTaskIsContract(Rows[Index].State);
				// A DRAFT HAS NO OBJECTIVE TO NAME IT BY, so it says what it is instead of showing an empty tab.
				Tab.Label = Tab.bDraft
					? FString::Printf(TEXT("TASK %d · NEW"), Index + 1)
					: FString::Printf(TEXT("TASK %d · %s"), Index + 1, *Rows[Index].Objective.Left(18).ToUpper());
				Out.Add(Tab);
			}
			return Out;
		})
		.OnSelectTaskTab_Lambda([WeakThis](FGuid Id)
		{
			if (UWonderlandMissionTaskSubsystem* Set = WeakThis.IsValid() ? WeakThis->Tasks() : nullptr)
			{
				// A VIEW, NOT A COMMAND. The other tasks are not paused, reset or touched.
				Set->SelectTask(Id);
			}
		})
		.OnAddTaskTerminal_Lambda([WeakThis]()
		{
			// THE SAME CALL THE ORB STACK GROWS FROM, so a tab and an orb can never disagree about how many tasks
			// there are. It creates an empty slot and selects it; it does not touch the terminal being viewed.
			if (WeakThis.IsValid()) { WeakThis->PressAddTask(); }
		})
		.OnCloseTaskTerminal_Lambda([WeakThis]()
		{
			// THE X. Closes the selected tab and its orb; a draft is discarded, a contract keeps its truth.
			if (UWonderlandMissionTaskSubsystem* Set = WeakThis.IsValid() ? WeakThis->Tasks() : nullptr)
			{
				Set->CloseFromWorkspace(Set->GetSelected());
			}
		})
		.ClosedTaskCount_Lambda([WeakThis]()
		{
			const UWonderlandMissionTaskSubsystem* Set = WeakThis.IsValid() ? WeakThis->Tasks() : nullptr;
			return Set != nullptr ? Set->NumTasks() - Set->GetWorkspaceCount() : 0;
		})
		.OnSubmit_Lambda([WeakThis](const FString& Text) { if (WeakThis.IsValid()) { WeakThis->HandleTerminalSubmit(Text); } });
}

void UWonderlandUiSubsystem::NarrateMissionEvent(FName EventType, EWonderlandMissionBeat Beat, const FString& ChakraLabel,
	bool bBeatChanged, bool bNewMission, bool bLlmJoined, bool bJhinnJoined)
{
	EnsureLiveTerminal();
	const bool bEnded = EventType.IsNone();

	// ---- Julius and its three components, each working in its own section of the Julius Live Terminal
	if (Terminal.IsValid() && !bEnded)
	{
		if (bNewMission)
		{
			Terminal->ResetSimulation();
		}
		Terminal->SetSimulated(true);
		JuliusNarratedEvent = EventType;
		// THE SECTION IN VIEW FOLLOWS THE STAGE: the architect's prompt while the Dog reads, the coder's code while it
		// paints and repairs, the reviewer while it inspects and verifies, Julius at the start and the end.
		const TCHAR* Focus = TEXT("JULIUS 3.3");
		switch (Beat)
		{
		case EWonderlandMissionBeat::Researching:
		case EWonderlandMissionBeat::PromptArchitectActive:
		case EWonderlandMissionBeat::Guidance:
			Focus = TEXT("PROMPT ARCHITECT");
			break;
		case EWonderlandMissionBeat::CodingAgentActive:
		case EWonderlandMissionBeat::WaitingCheckpoint:
		case EWonderlandMissionBeat::ApprovalContinue:
		case EWonderlandMissionBeat::RepairRequired:
		case EWonderlandMissionBeat::Repairing:
			Focus = TEXT("CODING AGENT");
			break;
		case EWonderlandMissionBeat::IndependentReviewerActive:
		case EWonderlandMissionBeat::ReviewChallenge:
		case EWonderlandMissionBeat::Verifying:
			Focus = TEXT("INDEPENDENT REVIEWER");
			break;
		default:
			break;
		}
		Terminal->SetFocusSection(Focus);
	}
	NarrateRoles(EventType, ChakraLabel, bNewMission, bLlmJoined, bJhinnJoined);

	// ---- the companions: only a joined one takes part, and it speaks when the stage changes
	for (int32 Index = 0; Index < CompanionTerminals.Num(); ++Index)
	{
		const TSharedPtr<SWonderlandCompanionTerminal>& Panel = CompanionTerminals[Index];
		if (!Panel.IsValid())
		{
			continue;
		}
		const bool bAgent = Index == 1;
		const bool bJoined = bAgent ? bJhinnJoined : bLlmJoined;
		if (bNewMission)
		{
			Panel->ClearLines();
		}
		if (bEnded || !bJoined)
		{
			// Not joined, or the mission is over: it waits, and what it contributed stays in its log.
			Panel->SetStatus(TEXT("WAITING"));
			continue;
		}
		Panel->SetStatus(Beat == EWonderlandMissionBeat::CompleteVerified ? TEXT("JOINED \u00B7 DONE") : TEXT("ACTIVE \u00B7 JOINED"));
		if (bBeatChanged || bNewMission)
		{
			const FWonderlandCompanionNarration Line = WonderlandCompanionNarrationForBeat(Beat,
				bAgent ? EWonderlandCompanionKind::JhinnAgent : EWonderlandCompanionKind::LlmCompanion);
			Panel->AddLine(Line.Activity, Line.Line, false);
			Panel->NoteNarration(Line.Activity, WonderlandBeatId(Beat));
		}
	}
}

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandRoleFeedDetail
{
	/** The section of the Julius Live Terminal each role works in -- the terminal's own four, never new ones. */
	const TCHAR* SectionFor(EWonderlandJuliusRole Role)
	{
		switch (Role)
		{
		case EWonderlandJuliusRole::PromptArchitect:     return TEXT("PROMPT ARCHITECT");
		case EWonderlandJuliusRole::CodingAgent:         return TEXT("CODING AGENT");
		case EWonderlandJuliusRole::IndependentReviewer: return TEXT("INDEPENDENT REVIEWER");
		default: break;
		}
		return TEXT("JULIUS 3.3");
	}

	/** One line as a section's single line reads it: a diff as a diff, a test as a test, a packet line as a packet. */
	FString AsSectionLine(const FWonderlandRoleLine& Line)
	{
		using K = EWonderlandRoleLineKind;
		switch (Line.Kind)
		{
		case K::Section:     return FString::Printf(TEXT("[%s]"), *Line.Text);
		case K::Preview:     return TEXT("| ") + Line.Text;
		case K::DiffAdd:     return TEXT("+ ") + Line.Text;
		case K::DiffRemove:  return TEXT("- ") + Line.Text;
		case K::Pass:        return TEXT("PASS  ") + Line.Text;
		case K::Fail:        return TEXT("FAIL  ") + Line.Text;
		case K::CheckDone:   return TEXT("\u25CF ") + Line.Text;
		case K::CheckOpen:   return TEXT("\u25CB ") + Line.Text;
		case K::Finding:     return TEXT("! ") + Line.Text;
		case K::Wait:        return TEXT("\u2026 ") + Line.Text;
		default: break;
		}
		return Line.Text;
	}

	TAutoConsoleVariable<float> CVarHoldScale(TEXT("wl.Julius.RolePace"), 1.0f,
		TEXT("How long each line of a role's work holds its section before the next, as a multiple of the reading holds."));
}

void UWonderlandUiSubsystem::NarrateRoles(FName EventType, const FString& ChakraLabel, bool bNewMission, bool bLlmJoined, bool bJhinnJoined)
{
	if (!Terminal.IsValid())
	{
		return;
	}
	if (!RoleTicker.IsValid())
	{
		RoleTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandUiSubsystem::TickRoles));
	}
	if (bNewMission)
	{
		RoleOccurrences.Reset();
		for (FRoleFeed& Feed : RoleFeeds)
		{
			Feed = FRoleFeed();
		}
	}
	RoleEvent = EventType;
	RoleChakra = ChakraLabel;
	const int32 Occurrence = EventType.IsNone() ? 0 : ++RoleOccurrences.FindOrAdd(EventType);
	for (int32 Role = 0; Role < WonderlandJuliusRoleCount; ++Role)
	{
		const EWonderlandJuliusRole Which = static_cast<EWonderlandJuliusRole>(Role);
		FRoleFeed& Feed = RoleFeeds[Role];
		// THE WORLD HAS MOVED ON. A role still working through the last event keeps going -- faster, so it catches up
		// (TickRoles) -- rather than dumping its code at once; only a runaway backlog is written in one go.
		if (Feed.Pending.Num() > 24 || EventType.IsNone())
		{
			FlushRole(Role);
		}
		if (EventType.IsNone())
		{
			Feed.Status = WonderlandRoleRestingStatus(Which, true);
			Terminal->SetSectionState(WonderlandRoleFeedDetail::SectionFor(Which), Feed.Status, FString());
			continue;
		}
		FWonderlandRoleBlock Block = WonderlandRoleBlockFor(Which, EventType, Occurrence, bLlmJoined, bJhinnJoined);
		if (!Block.Status.IsEmpty())
		{
			// The state moves with the world, now; the lines follow at reading pace.
			Feed.Status = Block.Status;
			Terminal->SetSectionState(WonderlandRoleFeedDetail::SectionFor(Which), Feed.Status, FString());
		}
		const bool bWasIdle = Feed.Pending.Num() == 0 && Feed.TypingLine == INDEX_NONE;
		Feed.Pending.Append(MoveTemp(Block.Lines));
		// All four work at once, each in its own section; staggered so they do not change on the same frame.
		if (bWasIdle)
		{
			Feed.Wait = 0.15f * Role;
		}
	}
}

void UWonderlandUiSubsystem::WriteRoleLine(int32 Role, const FWonderlandRoleLine& Line)
{
	if (!Terminal.IsValid())
	{
		return;
	}
	const EWonderlandJuliusRole Which = static_cast<EWonderlandJuliusRole>(Role);
	FRoleFeed& Feed = RoleFeeds[Role];
	const FString Section = WonderlandRoleFeedDetail::SectionFor(Which);
	if (Line.Kind == EWonderlandRoleLineKind::Status)
	{
		// The component's state changes here, as it reaches this point of its work.
		Feed.Status = Line.Text;
		Terminal->SetSectionState(Section, Feed.Status, FString());
		return;
	}
	if (Line.Kind == EWonderlandRoleLineKind::Pause)
	{
		return;
	}
	++Feed.Written;
	Feed.Latest = Line;
	if (Which == EWonderlandJuliusRole::Julius)
	{
		// JULIUS'S OWN ROWS, as the approved terminal draws them: a heading is carried into the row it heads, and the
		// newest row says which event it is and that nothing was called.
		if (Line.Kind == EWonderlandRoleLineKind::Section || Line.Kind == EWonderlandRoleLineKind::Episode)
		{
			Feed.Heading = Line.Text;
			return;
		}
		if (Line.Kind == EWonderlandRoleLineKind::Summary)
		{
			return;
		}
		const FString Headline = Feed.Heading.IsEmpty() ? Line.Text : FString::Printf(TEXT("%s \u00B7 %s"), *Feed.Heading, *Line.Text);
		Feed.Heading.Reset();
		Terminal->AddJuliusRow(TEXT("Julius"), Headline,
			FString::Printf(TEXT("event %s  \u00B7  %s  \u00B7  simulated, no provider called"), *RoleEvent.ToString(), *RoleChakra));
		return;
	}
	const TSharedPtr<SWonderlandWorkLog> WorkLog = Terminal->GetWorkLog(Section);
	if (!WorkLog.IsValid())
	{
		return;
	}
	const int32 Typing = WorkLog->AddLine(Line.Kind, Line.Text);
	if (Typing != INDEX_NONE)
	{
		Feed.TypingLine = Typing;
		Feed.Typed = 0.0f;
		Feed.TypingLength = WorkLog->GetLineLength(Typing);
		Feed.TypingKind = Line.Kind;
	}
}

void UWonderlandUiSubsystem::FlushRole(int32 Role)
{
	FRoleFeed& Feed = RoleFeeds[Role];
	const TSharedPtr<SWonderlandWorkLog> WorkLog = Terminal.IsValid()
		? Terminal->GetWorkLog(WonderlandRoleFeedDetail::SectionFor(static_cast<EWonderlandJuliusRole>(Role)))
		: TSharedPtr<SWonderlandWorkLog>();
	auto FinishTyping = [&Feed, &WorkLog]()
	{
		if (Feed.TypingLine != INDEX_NONE && WorkLog.IsValid())
		{
			WorkLog->SetReveal(Feed.TypingLine, Feed.TypingLength);
			Feed.TypedCharacters += FMath::Max(Feed.TypingLength - FMath::FloorToInt(Feed.Typed), 0);
		}
		Feed.TypingLine = INDEX_NONE;
	};
	FinishTyping();
	for (const FWonderlandRoleLine& Line : Feed.Pending)
	{
		WriteRoleLine(Role, Line);
		FinishTyping();
	}
	Feed.Pending.Reset();
	Feed.Wait = 0.0f;
}

bool UWonderlandUiSubsystem::TickRoles(float DeltaSeconds)
{
	// ON THE WORLD'S CLOCK, like the fixture and the Dog: slowing the world slows the terminal with it, and a paused world
	// holds it mid-sentence rather than letting it run ahead of the mission.
	const UWorld* World = PlayerWorld();
	if (World == nullptr)
	{
		RoleWorldSeconds = -1.0;
		return true;
	}
	const double Now = World->GetTimeSeconds();
	const float Step = RoleWorldSeconds < 0.0 ? 0.0f : FMath::Clamp(static_cast<float>(Now - RoleWorldSeconds), 0.0f, 0.5f);
	RoleWorldSeconds = Now;
	const float Scale = FMath::Clamp(WonderlandRoleFeedDetail::CVarHoldScale.GetValueOnGameThread(), 0.05f, 4.0f);
	for (int32 Role = 0; Role < WonderlandJuliusRoleCount; ++Role)
	{
		FRoleFeed& Feed = RoleFeeds[Role];
		if (Feed.Pending.Num() == 0 && Feed.TypingLine == INDEX_NONE)
		{
			continue;
		}
		// CATCHING UP, NOT DUMPING: a role with work still queued when the world moves on works faster until it is level.
		const float Hurry = 1.0f + 0.10f * static_cast<float>(Feed.Pending.Num());
		float Left = Step * Hurry;
		const TSharedPtr<SWonderlandWorkLog> WorkLog = Terminal.IsValid()
			? Terminal->GetWorkLog(WonderlandRoleFeedDetail::SectionFor(static_cast<EWonderlandJuliusRole>(Role)))
			: TSharedPtr<SWonderlandWorkLog>();
		int32 Guard = 64;
		while (Left > 0.0f && Guard-- > 0)
		{
			if (Feed.TypingLine != INDEX_NONE)
			{
				// TYPING: characters at a readable rate, then the line's own short hold.
				const float Cps = WonderlandRoleTypingCharsPerSecond(Feed.TypingKind) / Scale;
				const float Need = (static_cast<float>(Feed.TypingLength) - Feed.Typed) / FMath::Max(Cps, 1.0f);
				const float Use = FMath::Min(Left, Need);
				const int32 Before = FMath::FloorToInt(Feed.Typed);
				Feed.Typed += Use * Cps;
				Left -= Use;
				const int32 After = FMath::Min(FMath::FloorToInt(Feed.Typed), Feed.TypingLength);
				Feed.TypedCharacters += FMath::Max(After - Before, 0);
				if (WorkLog.IsValid())
				{
					WorkLog->SetReveal(Feed.TypingLine, After);
				}
				if (Feed.Typed >= static_cast<float>(Feed.TypingLength) - 0.001f)
				{
					if (WorkLog.IsValid())
					{
						WorkLog->SetReveal(Feed.TypingLine, Feed.TypingLength);
					}
					Feed.TypingLine = INDEX_NONE;
					Feed.Wait = WonderlandRoleLineHoldSeconds(Feed.TypingKind) * Scale;
				}
				continue;
			}
			if (Feed.Wait > 0.0f)
			{
				const float Use = FMath::Min(Left, Feed.Wait);
				Feed.Wait -= Use;
				Left -= Use;
				continue;
			}
			if (Feed.Pending.Num() == 0)
			{
				break;
			}
			const FWonderlandRoleLine Line = Feed.Pending[0];
			Feed.Pending.RemoveAt(0);
			WriteRoleLine(Role, Line);
			if (Feed.TypingLine == INDEX_NONE)
			{
				Feed.Wait = Line.Kind == EWonderlandRoleLineKind::Pause
					? static_cast<float>(FCString::Atof(*Line.Text))
					: WonderlandRoleLineHoldSeconds(Line.Kind) * Scale;
			}
		}
	}
	return true;
}

FString UWonderlandUiSubsystem::GetJuliusRoleStatus(int32 Role) const
{
	return Role >= 0 && Role < WonderlandJuliusRoleCount ? RoleFeeds[Role].Status : FString();
}

int32 UWonderlandUiSubsystem::GetJuliusRoleWrittenCount(int32 Role) const
{
	return Role >= 0 && Role < WonderlandJuliusRoleCount ? RoleFeeds[Role].Written : 0;
}

FString UWonderlandUiSubsystem::GetJuliusRoleLatestLine(int32 Role) const
{
	return Role >= 0 && Role < WonderlandJuliusRoleCount ? RoleFeeds[Role].Latest.Text : FString();
}

FString UWonderlandUiSubsystem::GetJuliusRoleLatestKind(int32 Role) const
{
	if (Role < 0 || Role >= WonderlandJuliusRoleCount || RoleFeeds[Role].Written == 0)
	{
		return FString();
	}
	static const TCHAR* const Names[] = { TEXT("Log"), TEXT("Section"), TEXT("Command"), TEXT("Preview"), TEXT("PreviewRule"),
		TEXT("File"), TEXT("DiffAdd"), TEXT("DiffRemove"), TEXT("Pass"), TEXT("Fail"), TEXT("CheckDone"), TEXT("CheckOpen"),
		TEXT("Finding"), TEXT("State"), TEXT("Wait"), TEXT("Status"), TEXT("Episode"), TEXT("Summary"), TEXT("CodeFile"),
		TEXT("CodeLine"), TEXT("DiffStat"), TEXT("PromptBegin"), TEXT("PromptHeading"), TEXT("PromptLine"), TEXT("PromptEnd"),
		TEXT("FindingCard"), TEXT("Pause"), TEXT("Blank") };
	const int32 Index = static_cast<int32>(RoleFeeds[Role].Latest.Kind);
	return Index >= 0 && Index < UE_ARRAY_COUNT(Names) ? FString(Names[Index]) : FString();
}

int32 UWonderlandUiSubsystem::GetJuliusRolePending(int32 Role) const
{
	return Role >= 0 && Role < WonderlandJuliusRoleCount ? RoleFeeds[Role].Pending.Num() : 0;
}

int32 UWonderlandUiSubsystem::GetJuliusSectionLineCount(const FString& Section) const
{
	return Terminal.IsValid() ? Terminal->GetSectionLineCount(Section) : 0;
}

FString UWonderlandUiSubsystem::DescribeJuliusSection(const FString& Section, int32 MaxLines) const
{
	return Terminal.IsValid() ? Terminal->DescribeSection(Section, MaxLines) : FString();
}

FString UWonderlandUiSubsystem::GetJuliusFocusSection() const
{
	return Terminal.IsValid() ? Terminal->GetFocusSection() : FString();
}

int32 UWonderlandUiSubsystem::GetJuliusRoleTypedCharacters(int32 Role) const
{
	return Role >= 0 && Role < WonderlandJuliusRoleCount ? RoleFeeds[Role].TypedCharacters : 0;
}

bool UWonderlandUiSubsystem::IsJuliusTerminalSimulated() const
{
	return Terminal.IsValid() && Terminal->IsSimulated();
}

FString UWonderlandUiSubsystem::GetJuliusSectionState(const FString& Section) const
{
	return Terminal.IsValid() ? Terminal->GetSectionState(Section) : FString();
}

FString UWonderlandUiSubsystem::GetJuliusLatestHeadline() const
{
	return Terminal.IsValid() ? Terminal->GetLatestJuliusHeadline() : FString();
}

FString UWonderlandUiSubsystem::GetJuliusTerminalBanner() const
{
	return Terminal.IsValid() ? Terminal->GetBannerText() : FString();
}

FString UWonderlandUiSubsystem::GetCompanionTerminalStatus(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid() ? CompanionTerminals[Index]->GetStatus() : FString();
}

FString UWonderlandUiSubsystem::GetCompanionTerminalActivity(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid() ? CompanionTerminals[Index]->GetLatestActivity() : FString();
}

FName UWonderlandUiSubsystem::GetCompanionTerminalNarratedBeat(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid() ? CompanionTerminals[Index]->GetNarratedBeat() : NAME_None;
}


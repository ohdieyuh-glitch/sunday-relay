#include "WonderlandUiSubsystem.h"

#include "Components/InputComponent.h"
#include "Engine/GameInstance.h"
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
#include "WonderlandJuliusConnectPanel.h"
#include "WonderlandWonderWebBrowse.h"
#include "WonderlandWonderWebBrowserPanel.h"
#include "WonderlandJuliusWorkLog.h"
#include "WonderlandLiveTerminal.h"
#include "WonderlandMiniMap.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandNavBar.h"
#include "WonderlandProjectBrain.h"
#include "WonderlandProjectBrainPanel.h"
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
}

void UWonderlandUiSubsystem::Deinitialize()
{
	if (RoleTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(RoleTicker);
		RoleTicker.Reset();
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
	// Recorded as the visitor's own line and marked unsent: nothing is imported, and a companion that
	// answered anyway would be inventing one.
	Panel->AddLine(TEXT("You"), Text, false);
	Panel->AddLine(FString(), FString::Printf(TEXT("Not sent: %s is not imported into this world yet."), *Panel->GetTitle()), true);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI companion terminal %d line recorded, not sent (nothing imported): %d characters"), Index, Text.Len());
}

FString UWonderlandUiSubsystem::GetCompanionTerminalTitle(int32 Index) const
{
	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid() ? CompanionTerminals[Index]->GetTitle() : FString();
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
	BrowserPanel.Reset();
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
			SAssignNew(BrainPanel, SWonderlandProjectBrainPanel)
				.HologramBrush(BrainArtBrush.IsValid() ? BrainArtBrush.Get() : nullptr)
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
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } });
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
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI open %s (panels in viewport: %d)"), OverlayName(Which), OverlaysInViewport);
}

void UWonderlandUiSubsystem::CloseOverlay()
{
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
	if (Controller == nullptr || (Id != WonderWebWindowIds::Creation && Id != WonderWebWindowIds::Connections && Id != WonderWebWindowIds::Browser))
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
		else if (Id == WonderWebWindowIds::Browser)
		{
			// THE BROWSER: Wonderland's shell outside, ordinary web pages inside (founder, 2026-09-17).
			SAssignNew(BrowserPanel, SWonderlandWonderWebBrowserPanel)
				.Browse(TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem>(BrowseState()))
				.Connect(TWeakObjectPtr<UWonderlandJuliusConnectSubsystem>(JuliusConnect()))
				.Creation(TWeakObjectPtr<UWonderlandWonderWebSubsystem>(WonderWebState()))
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseWonderWebWindow(WonderWebWindowIds::Browser); } })
				.OnRequestMinimize_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(WonderWebWindowIds::Browser, true); } })
				.OnRequestExpand_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->ExpandWonderWebWindow(WonderWebWindowIds::Browser); } });
			Window->Content = BrowserPanel;
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
				.OnRestore_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->MinimizeWonderWebWindow(WonderWebWindowIds::Browser, false); } });
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
	for (FWonderWebWindow& Window : WonderWebWindows)
	{
		if (AWonderlandWonderWebScreen* Screen = Window.Screen.Get())
		{
			Screen->SetFocused(Window.Id == Id);
		}
	}
	return true;
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
	if (Connect == nullptr || !Connect->GetSurface().bHasPrompt || WonderWebWorkspaceTuning::CVarAutoOpenPrompt.GetValueOnGameThread() == 0)
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
		static const TCHAR* Links[] = { TEXT("connecting"), TEXT("online"), TEXT("offline") };
		Connect = FString::Printf(TEXT("link=%s prompt=%s task=%s template=%s step=%d/%d blocked=\"%s\" dev_figma=%s dev_social=%s scope=%s audit=%d last_audit=\"%s %s %s\" intents=%d"),
			Links[static_cast<int32>(State->GetLink())], Surface.bHasPrompt ? *Surface.Prompt.RequestId : TEXT("-"),
			Task != nullptr ? *Task->RunState : TEXT("-"), Task != nullptr ? *Task->TemplateId : TEXT("-"),
			Task != nullptr ? Task->Progress : 0, Task != nullptr ? Task->Total : 0,
			Task != nullptr ? *Task->BlockedReason : TEXT(""), Figma != nullptr ? *Figma->State : TEXT("-"),
			Social != nullptr ? *Social->State : TEXT("-"),
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
	if (Window == WonderWebWindowIds::Creation)
	{
		return WonderWebPanel.IsValid() && WonderWebPanel->GetControlCentre(Control, OutPixel);
	}
	if (Window == WonderWebWindowIds::Browser)
	{
		return BrowserPanel.IsValid() && BrowserPanel->GetControlCentre(Control, OutPixel);
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

void UWonderlandUiSubsystem::HandleTerminalSubmit(const FString& Text)
{
	if (!Terminal.IsValid())
	{
		return;
	}
	// Recorded as the visitor's own line and marked unsent. There is no Julius link in the
	// world yet, and a terminal that answered anyway would be inventing Julius.
	Terminal->AddJuliusRow(TEXT("You"), Text, TEXT("Not sent: Julius 3.3 is not connected to this world yet."));
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI terminal line recorded, not sent (no Julius link): %d characters"), Text.Len());
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
		];
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


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
#include "WonderlandLiveTerminal.h"
#include "WonderlandMissionDeck.h"
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

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandUi, Log, All);

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
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
	// WHILE THE MISSION DECK IS UP the bottom band is Julius's, so the companions' terminals stand in the right-hand
	// column under the mini-map instead, one above the other, and the world between stays clear.
	TAutoConsoleVariable<FString> CVarCompanionDeckLeft(
		TEXT("wl.Companion.DeckLeft"), TEXT("0.806 0.318 0.994 0.463"),
		TEXT("Anchors of the LLM Companion terminal while the mission deck is shown."));
	TAutoConsoleVariable<FString> CVarCompanionDeckRight(
		TEXT("wl.Companion.DeckRight"), TEXT("0.806 0.469 0.994 0.612"),
		TEXT("Anchors of the Jhinn AI Agent terminal while the mission deck is shown."));

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
	if (DeckTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(DeckTicker);
		DeckTicker.Reset();
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
		.Anchors(TAttribute<FAnchors>::CreateLambda([WeakThis]()
		{
			return WeakThis.IsValid() && WeakThis->IsMissionDeckShown()
				? ParseAnchors(CVarCompanionDeckLeft.GetValueOnGameThread(), FAnchors(0.806f, 0.318f, 0.994f, 0.463f))
				: ParseAnchors(CVarCompanionPanelLeft.GetValueOnGameThread(), FAnchors(0.016f, 0.487f, 0.262f, 0.700f));
		}))
		.Offset(FMargin(0.0f))
		[
			Llm.ToSharedRef()
		]
		+ SConstraintCanvas::Slot()
		.Anchors(TAttribute<FAnchors>::CreateLambda([WeakThis]()
		{
			return WeakThis.IsValid() && WeakThis->IsMissionDeckShown()
				? ParseAnchors(CVarCompanionDeckRight.GetValueOnGameThread(), FAnchors(0.806f, 0.469f, 0.994f, 0.612f))
				: ParseAnchors(CVarCompanionPanelRight.GetValueOnGameThread(), FAnchors(0.738f, 0.487f, 0.984f, 0.700f));
		}))
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
	Terminal.Reset();
	WorldMap.Reset();
	BrainPanel.Reset();
	CommandStation.Reset();
	MissionsPanel.Reset();
	MenuPanel.Reset();
	WalletPanel.Reset();
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

	// ---- Julius: a row for every event, and the role section it moves
	if (Terminal.IsValid() && !bEnded)
	{
		if (bNewMission)
		{
			Terminal->ResetSimulation();
		}
		Terminal->SetSimulated(true);
		const FWonderlandJuliusNarration Julius = WonderlandJuliusNarrationForEvent(EventType);
		if (*Julius.Section != 0)
		{
			Terminal->SetSectionState(Julius.Section, Julius.SectionState, Julius.SectionLine);
		}
		Terminal->SetSectionState(TEXT("JULIUS 3.3"), Julius.JuliusState, FString());
		Terminal->AddJuliusRow(TEXT("Julius"), Julius.Headline,
			FString::Printf(TEXT("event %s  \u00B7  %s  \u00B7  simulated, no provider called"), *EventType.ToString(), *ChakraLabel));
		JuliusNarratedEvent = EventType;
	}

	// ---- the deck: Julius and its three components, each writing its own work from this same event
	NarrateDeck(EventType, bNewMission, bLlmJoined, bJhinnJoined);

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

void UWonderlandUiSubsystem::NarrateDeck(FName EventType, bool bNewMission, bool bLlmJoined, bool bJhinnJoined)
{
	if (!Terminal.IsValid())
	{
		return;
	}
	if (!DeckTicker.IsValid())
	{
		DeckTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandUiSubsystem::TickDeck));
	}
	const bool bEnded = EventType.IsNone();
	if (bNewMission)
	{
		DeckOccurrences.Reset();
		for (int32 Role = 0; Role < WonderlandJuliusRoleCount; ++Role)
		{
			DeckFeeds[Role] = FDeckFeed();
			if (const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role))
			{
				Console->Clear();
			}
		}
	}
	const int32 Occurrence = bEnded ? 0 : ++DeckOccurrences.FindOrAdd(EventType);
	for (int32 Role = 0; Role < WonderlandJuliusRoleCount; ++Role)
	{
		const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role);
		if (!Console.IsValid())
		{
			continue;
		}
		// THE WORLD HAS MOVED ON. Whatever a console still owed the last event is written now, so no console is ever
		// describing a stage the Dog has left; the pacing is chosen so this is rarely more than a line.
		FlushDeckFeed(Role);
		FDeckFeed& Feed = DeckFeeds[Role];
		Feed.Event = EventType;
		const EWonderlandJuliusRole Which = static_cast<EWonderlandJuliusRole>(Role);
		if (bEnded)
		{
			Console->SetStatus(WonderlandRoleRestingStatus(Which, true));
			continue;
		}
		FWonderlandRoleBlock Block = WonderlandRoleBlockFor(Which, EventType, Occurrence, bLlmJoined, bJhinnJoined);
		if (!Block.Status.IsEmpty())
		{
			Console->SetStatus(Block.Status);
		}
		Feed.Pending = MoveTemp(Block.Lines);
		// Staggered, so four consoles taking one event do not write their first lines on the same frame like a printer.
		Feed.Wait = 0.18f * Role;
	}
}

void UWonderlandUiSubsystem::FlushDeckFeed(int32 Role)
{
	const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role);
	FDeckFeed& Feed = DeckFeeds[Role];
	if (Console.IsValid())
	{
		for (const FWonderlandRoleLine& Line : Feed.Pending)
		{
			Console->AddLine(Line);
		}
	}
	Feed.Pending.Reset();
	Feed.Wait = 0.0f;
}

bool UWonderlandUiSubsystem::TickDeck(float DeltaSeconds)
{
	// ON THE WORLD'S CLOCK, like the fixture and the Dog: slowing the world for a film slows the consoles with it, and a
	// paused world holds them mid-sentence rather than letting them run ahead of the mission.
	const UWorld* World = PlayerWorld();
	if (World == nullptr)
	{
		DeckWorldSeconds = -1.0;
		return true;
	}
	const double Now = World->GetTimeSeconds();
	const float Step = DeckWorldSeconds < 0.0 ? 0.0f : FMath::Clamp(static_cast<float>(Now - DeckWorldSeconds), 0.0f, 0.5f);
	DeckWorldSeconds = Now;
	for (int32 Role = 0; Role < WonderlandJuliusRoleCount; ++Role)
	{
		FDeckFeed& Feed = DeckFeeds[Role];
		if (Feed.Pending.Num() == 0)
		{
			continue;
		}
		const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role);
		Feed.Wait -= Step;
		while (Feed.Wait <= 0.0f && Feed.Pending.Num() > 0)
		{
			const FWonderlandRoleLine Line = Feed.Pending[0];
			Feed.Pending.RemoveAt(0);
			if (Console.IsValid())
			{
				Console->AddLine(Line);
			}
			Feed.Wait += WonderlandRoleLineHoldSeconds(Line.Kind);
		}
	}
	return true;
}

TSharedPtr<SWonderlandRoleConsole> UWonderlandUiSubsystem::DeckConsole(int32 Role) const
{
	return Terminal.IsValid() && Role >= 0 && Role < WonderlandJuliusRoleCount
		? Terminal->GetRoleConsole(static_cast<EWonderlandJuliusRole>(Role)) : nullptr;
}

bool UWonderlandUiSubsystem::IsMissionDeckShown() const
{
	return Terminal.IsValid() && Terminal->IsDeckShown() && IsLiveTerminalOpen();
}

FString UWonderlandUiSubsystem::GetDeckStatus(int32 Role) const
{
	const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role);
	return Console.IsValid() ? Console->GetStatus() : FString();
}

int32 UWonderlandUiSubsystem::GetDeckWrittenCount(int32 Role) const
{
	const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role);
	return Console.IsValid() ? Console->GetWrittenCount() : 0;
}

FString UWonderlandUiSubsystem::GetDeckLatestLine(int32 Role) const
{
	const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role);
	return Console.IsValid() ? Console->GetLatestText() : FString();
}

FString UWonderlandUiSubsystem::GetDeckLatestKind(int32 Role) const
{
	const TSharedPtr<SWonderlandRoleConsole> Console = DeckConsole(Role);
	return Console.IsValid() ? Console->GetLatestKind() : FString();
}

FName UWonderlandUiSubsystem::GetDeckNarratedEvent(int32 Role) const
{
	return Role >= 0 && Role < WonderlandJuliusRoleCount ? DeckFeeds[Role].Event : NAME_None;
}

int32 UWonderlandUiSubsystem::GetDeckPendingCount(int32 Role) const
{
	return Role >= 0 && Role < WonderlandJuliusRoleCount ? DeckFeeds[Role].Pending.Num() : 0;
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


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
#include "Widgets/Layout/SConstraintCanvas.h"
#include "WonderlandCompanionSubsystem.h"
#include "WonderlandCompanionTerminal.h"
#include "WonderlandLiveTerminal.h"
#include "WonderlandProjectBrain.h"
#include "WonderlandProjectBrainPanel.h"
#include "WonderlandTravel.h"
#include "WonderlandUiStyle.h"
#include "WonderlandUsageHudWidget.h"
#include "WonderlandUsagePreview.h"
#include "WonderlandWorldMap.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandUi, Log, All);

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
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI attached to %s (usage HUD %s%s, %d companion terminals, Ctrl+T terminal, M map)"),
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

	const TWeakObjectPtr<UWonderlandUiSubsystem> WeakThis(this);
	TSharedPtr<SWidget> Panel;
	TSharedPtr<SWidget> Focus;
	int32 ZOrder = 50;
	if (Which == EOverlay::Terminal)
	{
		if (!Terminal.IsValid())
		{
			// Created once and kept: its log survives closing and reopening.
			SAssignNew(Terminal, SWonderlandLiveTerminal)
				.OnRequestClose_Lambda([WeakThis]() { if (WeakThis.IsValid()) { WeakThis->CloseOverlay(); } })
				.OnSubmit_Lambda([WeakThis](const FString& Text) { if (WeakThis.IsValid()) { WeakThis->HandleTerminalSubmit(Text); } });
		}
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
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI open %s (panels in viewport: %d)"),
		Which == EOverlay::Terminal ? TEXT("live terminal") : (Which == EOverlay::Brain ? TEXT("project brain") : TEXT("world map")), OverlaysInViewport);
}

void UWonderlandUiSubsystem::CloseOverlay()
{
	if (Open == EOverlay::None)
	{
		return;
	}
	const EOverlay Closing = Open;
	TSharedPtr<SWidget> Panel = StaticCastSharedPtr<SWidget>(WorldMap);
	if (Closing == EOverlay::Terminal)
	{
		Panel = StaticCastSharedPtr<SWidget>(Terminal);
	}
	else if (Closing == EOverlay::Brain)
	{
		Panel = StaticCastSharedPtr<SWidget>(BrainPanel);
	}
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	if (LocalPlayer != nullptr && LocalPlayer->ViewportClient != nullptr && Panel.IsValid())
	{
		LocalPlayer->ViewportClient->RemoveViewportWidgetForPlayer(LocalPlayer, Panel.ToSharedRef());
		--OverlaysInViewport;
	}
	Open = EOverlay::None;
	ApplyOverlayInput(false, nullptr);
	UE_LOG(LogWonderlandUi, Log, TEXT("WLUI close %s (panels in viewport: %d)"),
		Closing == EOverlay::Terminal ? TEXT("live terminal") : (Closing == EOverlay::Brain ? TEXT("project brain") : TEXT("world map")), OverlaysInViewport);
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

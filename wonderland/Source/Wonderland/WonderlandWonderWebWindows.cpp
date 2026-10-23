// WONDERLAND — WONDER WEB WINDOWS.
//
// Definitions moved verbatim from WonderlandUiSubsystem.cpp (aa930c269c43a52fc31c785f7bdcc231c8af6cf0).
// They remain UWonderlandUiSubsystem methods.

#include "WonderlandWonderWebWindows.h"
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
#include "Slate/SGameLayerManager.h"
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
#include "WonderlandCompanionConsole.h"
#include "WonderlandCompanionWork.h"
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
#include "WonderlandBeta.h"
#include "WonderlandBrainSculpture.h"
#include "WonderlandProjectBrain.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/UserInterfaceSettings.h"
#include "HAL/FileManager.h"
#include "Slate/WidgetRenderer.h"
#include "TextureResource.h"
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
#include "WonderlandSocialHubPanel.h"
#include "WonderlandSocialProfilePanel.h"
#include "WonderlandSocialLive.h"
#include "WonderlandSocialSubsystem.h"
#include "WonderlandMissionBeat.h"
#include "WonderlandHandoffDirector.h"
#include "WonderlandCardDirector.h"
#include "WonderlandCard.h"
#include "WonderlandMissionNarration.h"
#include "WonderlandWorldMap.h"
#include "WonderlandWonderWeb.h"
#include "WonderlandWonderWebPanel.h"
#include "WonderlandWonderWebScreen.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/WidgetComponent.h"


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
	// A TESTER'S CTRL+W SAYS WHY NOTHING OPENS (founder, 2026-10-01, D3: the sample browser is "Developer-only"). Every
	// window it would spawn is a browser, browsing is a Julius surface, and Julius is not part of this beta.
	if (!WonderlandBeta::IsDeveloperSession())
	{
		if (WonderWebLayer.IsValid())
		{
			WonderWebLayer->ShowNotice(TEXT("WONDER WEB"), TEXT("BROWSING IS NOT IN THIS BETA"),
				TEXT("Julius opens web pages, and Julius is not part of this beta build. The Pixel Canvas is yours to use."), 5.0f);
		}
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI ctrl+w: browser windows are not part of this beta build"));
		return false;
	}
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
	// THE SAMPLE BROWSER IS A DEVELOPER'S (founder, 2026-10-01, D3). Its pages are styled as other companies' sites and
	// browsing is Julius's, so a tester's build opens no browser window by any route; the Pixel Canvas and the
	// Connections window are unaffected.
	if (IsBrowserWindow(Id) && !WonderlandBeta::IsDeveloperSession())
	{
		UE_LOG(LogWonderlandUi, Log, TEXT("WLUI wonder web: %s refused -- browser windows are not part of this beta build"), *Id.ToString());
		return false;
	}
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
		for (const TSharedPtr<SWonderlandCompanionConsole>& Companion : CompanionTerminals)
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

bool UWonderlandUiSubsystem::IsWonderWebCreationOnScreen() const
{
	if (Open != EOverlay::WonderWeb)
	{
		return false;
	}
	const FWonderWebWindow* CreationWindow = FindWonderWebWindow(WonderWebWindowIds::Creation);
	if (CreationWindow == nullptr || !CreationWindow->bOpen || CreationWindow->bMinimized)
	{
		return false;
	}
	// r2 (the privacy review's F1): the window being open is not creating -- it opens on the idle page, and it can show a sample peer's tab.
	// Only the player's OWN tab with a creation being built or opened counts (WonderlandWonderWebShowsOwnCreation).
	const UWonderlandWonderWebSubsystem* CreationState = WonderWebState();
	return CreationState != nullptr && WonderlandWonderWebShowsOwnCreation(CreationState->GetSurface(), CreationState->GetSelectedTab());
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

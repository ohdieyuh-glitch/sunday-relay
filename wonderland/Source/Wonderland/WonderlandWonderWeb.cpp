#include "WonderlandWonderWeb.h"

#include "Dom/JsonObject.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "CoreGlobals.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "UObject/UObjectIterator.h"
#include "WonderlandJuliusConnect.h"
#include "WonderlandUiSubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderWeb, Log, All);

/* ==================================================================== the console */

namespace WonderWebConsole
{
	/**
	 * A COMMAND THAT DOES NOTHING MUST SAY SO, ON SCREEN (founder, 2026-09-17: "commands arent working"). Two console
	 * commands were typed while Wonder Web was closed and nothing was connected: both ran, both answered into a window
	 * that was not open, and the console showed nothing. Every command now answers in the viewport and in the log.
	 */
	void Say(const FString& Text, bool bProblem = false)
	{
		UE_LOG(LogWonderWeb, Display, TEXT("%s"), *Text);
		// The editor can have screen messages switched off globally; a command's answer must not vanish with them.
		GAreScreenMessagesEnabled = true;
		if (GEngine != nullptr)
		{
			GEngine->bEnableOnScreenDebugMessages = true;
			GEngine->AddOnScreenDebugMessage(INDEX_NONE, 7.0f, bProblem ? FColor(255, 107, 74) : FColor(255, 212, 0), Text);
		}
	}

	/** An argument as typed, less the punctuation a sentence leaves on the end when a command is copied out of one. */
	FString Arg(const TArray<FString>& Args, int32 Index, const TCHAR* Fallback)
	{
		FString Text = Args.IsValidIndex(Index) ? Args[Index] : FString(Fallback);
		Text.TrimStartAndEndInline();
		while (Text.Len() > 0 && FString(TEXT(".,;:!?\"'")).Contains(Text.Right(1)))
		{
			Text.LeftChopInline(1);
		}
		return Text.IsEmpty() ? FString(Fallback) : Text;
	}

	template <typename T>
	int32 ForEachLive(TFunctionRef<void(T&)> Body)
	{
		int32 Found = 0;
		for (TObjectIterator<T> It; It; ++It)
		{
			if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject) && It->GetWorld() != nullptr && It->GetWorld()->IsGameWorld())
			{
				Body(**It);
				++Found;
			}
		}
		if (Found == 0)
		{
			Say(TEXT("WONDER WEB: nothing to do -- press Play first (these commands work on the running game)."), true);
		}
		return Found;
	}

	FAutoConsoleCommand CmdOpen(TEXT("wl.WonderWeb.Open"),
		TEXT("Open a Wonder Web window in the workspace standing ahead of the Dog: `wl.WonderWeb.Open` (creation), `wl.WonderWeb.Open connections` (Julius Connect). A second window tiles beside the first."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Window(*Arg(Args, 0, TEXT("creation")));
			ForEachLive<UWonderlandUiSubsystem>([Window](UWonderlandUiSubsystem& Ui)
			{
				Say(Ui.OpenWonderWebWindow(Window)
					? FString::Printf(TEXT("WONDER WEB: the %s window is open."), *Window.ToString())
					: FString::Printf(TEXT("WONDER WEB: there is no window called '%s' -- try creation or connections."), *Window.ToString()),
					!Ui.IsWonderWebOpen());
			});
		}));

	FAutoConsoleCommand CmdCloseWindow(TEXT("wl.WonderWeb.CloseWindow"), TEXT("Close one Wonder Web window: `wl.WonderWeb.CloseWindow connections`. The last one closes the workspace."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Window(*Arg(Args, 0, TEXT("creation")));
			ForEachLive<UWonderlandUiSubsystem>([Window](UWonderlandUiSubsystem& Ui)
			{
				Say(Ui.CloseWonderWebWindow(Window) ? FString::Printf(TEXT("WONDER WEB: the %s window is closed."), *Window.ToString())
					: FString::Printf(TEXT("WONDER WEB: the %s window was not open."), *Window.ToString()), true);
			});
		}));

	FAutoConsoleCommand CmdMinimize(TEXT("wl.WonderWeb.Minimize"), TEXT("Fold a window to its chip (its work goes on), or `wl.WonderWeb.Minimize creation 0` to restore it."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Window(*Arg(Args, 0, TEXT("creation")));
			const bool bMinimize = Args.Num() < 2 || Arg(Args, 1, TEXT("1")) != TEXT("0");
			ForEachLive<UWonderlandUiSubsystem>([Window, bMinimize](UWonderlandUiSubsystem& Ui)
			{
				Say(Ui.MinimizeWonderWebWindow(Window, bMinimize)
					? FString::Printf(TEXT("WONDER WEB: the %s window is %s."), *Window.ToString(), bMinimize ? TEXT("a chip along the bottom") : TEXT("back"))
					: FString::Printf(TEXT("WONDER WEB: the %s window is not open."), *Window.ToString()), true);
			});
		}));

	FAutoConsoleCommand CmdFocus(TEXT("wl.WonderWeb.Focus"), TEXT("Focus a Wonder Web window: `wl.WonderWeb.Focus connections`."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Window(*Arg(Args, 0, TEXT("creation")));
			ForEachLive<UWonderlandUiSubsystem>([Window](UWonderlandUiSubsystem& Ui)
			{
				Say(Ui.FocusWonderWebWindow(Window) ? FString::Printf(TEXT("WONDER WEB: the %s window has the keyboard."), *Window.ToString())
					: FString::Printf(TEXT("WONDER WEB: the %s window is not open."), *Window.ToString()), true);
			});
		}));

	FAutoConsoleCommand CmdExpand(TEXT("wl.WonderWeb.Expand"), TEXT("Grow a window larger in the middle of the workspace, or back: `wl.WonderWeb.Expand connections`."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Window(*Arg(Args, 0, TEXT("creation")));
			ForEachLive<UWonderlandUiSubsystem>([Window](UWonderlandUiSubsystem& Ui)
			{
				Say(Ui.ExpandWonderWebWindow(Window) ? FString::Printf(TEXT("WONDER WEB: the %s window grew (run it again to put it back)."), *Window.ToString())
					: FString::Printf(TEXT("WONDER WEB: the %s window is not open."), *Window.ToString()), true);
			});
		}));

	FAutoConsoleCommand CmdTile(TEXT("wl.WonderWeb.Tile"), TEXT("Lay the open Wonder Web windows out again: one in the middle, two side by side, three in two rows."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive<UWonderlandUiSubsystem>([](UWonderlandUiSubsystem& Ui)
			{
				Ui.TileWonderWeb();
				Say(TEXT("WONDER WEB: the open windows are laid out again."));
			});
		}));

	// ONE COMMAND FOR THE WHOLE FLOW (founder, 2026-09-17): Wonder Web A running its creation, Wonder Web B beside it, and
	// Julius given the task that needs a connection this project does not have yet.
	FAutoConsoleCommand CmdPlaytest(TEXT("wl.Julius.Playtest"),
		TEXT("Open Wonder Web A with the sample creation running, open Julius Connect beside it, and give Julius the design task that needs a development connector."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			const int32 Found = ForEachLive<UWonderlandUiSubsystem>([](UWonderlandUiSubsystem& Ui)
			{
				Ui.OpenWonderWebWindow(TEXT("creation"));
				Ui.OpenWonderWebWindow(TEXT("connections"));
			});
			if (Found == 0)
			{
				return;
			}
			ForEachLive<UWonderlandWonderWebSubsystem>([](UWonderlandWonderWebSubsystem& Web)
			{
				if (!Web.Act(EWonderWebAction::OpenSample))
				{
					Web.Act(EWonderWebAction::Restart);
				}
			});
			ForEachLive<UWonderlandJuliusConnectSubsystem>([](UWonderlandJuliusConnectSubsystem& Connect) { Connect.StartTask(TEXT("design-sync")); });
			Say(TEXT("PLAYTEST: Pixel Canvas is building in the left window; Julius has the design task and will ask you to connect the design tool in the right one."));
		}));

	FAutoConsoleCommand CmdClose(TEXT("wl.WonderWeb.Close"),
		TEXT("Close Wonder Web and glide back to the Dog. What is running keeps running."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive<UWonderlandUiSubsystem>([](UWonderlandUiSubsystem& Ui)
			{
				Ui.CloseWonderWeb();
				Say(TEXT("WONDER WEB: back to the world. What is running keeps running."));
			});
		}));

	FAutoConsoleCommand CmdRun(TEXT("wl.WonderWeb.Run"),
		TEXT("Open and run the sample creation (Pixel Canvas) in MY VIEW: from rest it is built first; when stopped or ready it runs again."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive<UWonderlandWonderWebSubsystem>([](UWonderlandWonderWebSubsystem& Web)
			{
				const bool bOpened = Web.Act(EWonderWebAction::OpenSample) || Web.Act(EWonderWebAction::Restart);
				Say(bOpened ? TEXT("WONDER WEB: the sample creation is building.") : TEXT("WONDER WEB: the view on screen cannot run the sample."), !bOpened);
			});
		}));

	FAutoConsoleCommand CmdStop(TEXT("wl.WonderWeb.Stop"), TEXT("Stop the running sample creation."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive<UWonderlandWonderWebSubsystem>([](UWonderlandWonderWebSubsystem& Web)
			{
				const bool bStopped = Web.Act(EWonderWebAction::Stop);
				Say(bStopped ? TEXT("WONDER WEB: the creation stopped.") : TEXT("WONDER WEB: nothing is running."), !bStopped);
			});
		}));

	FAutoConsoleCommand CmdRebuild(TEXT("wl.WonderWeb.Rebuild"), TEXT("Rebuild the sample creation and run it."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive<UWonderlandWonderWebSubsystem>([](UWonderlandWonderWebSubsystem& Web)
			{
				const bool bRebuilding = Web.Act(EWonderWebAction::Rebuild);
				Say(bRebuilding ? TEXT("WONDER WEB: rebuilding the creation.") : TEXT("WONDER WEB: the view on screen cannot rebuild."), !bRebuilding);
			});
		}));

	FAutoConsoleCommand CmdFail(TEXT("wl.WonderWeb.FailSample"), TEXT("Rebuild the sample creation from a broken source, to show a failed build."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive<UWonderlandWonderWebSubsystem>([](UWonderlandWonderWebSubsystem& Web)
			{
				const bool bFailing = Web.Act(EWonderWebAction::FailSample);
				Say(bFailing ? TEXT("WONDER WEB: building a broken source, to show a failed build.") : TEXT("WONDER WEB: the view on screen cannot rebuild."), !bFailing);
			});
		}));

	FAutoConsoleCommand CmdTab(TEXT("wl.WonderWeb.Tab"),
		TEXT("Choose a tab: `wl.WonderWeb.Tab 0` is MY VIEW, 1-4 the sample peers (observe only)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const int32 Index = FCString::Atoi(*Arg(Args, 0, TEXT("0")));
			ForEachLive<UWonderlandWonderWebSubsystem>([Index](UWonderlandWonderWebSubsystem& Web)
			{
				const bool bChosen = Web.SelectTab(Index);
				Say(bChosen ? FString::Printf(TEXT("WONDER WEB: tab %d."), Index) : FString::Printf(TEXT("WONDER WEB: there is no tab %d."), Index), !bChosen);
			});
		}));

	FAutoConsoleCommand CmdMove(TEXT("wl.WonderWeb.Move"),
		TEXT("Glide the focused Wonder Web window to a place in the view: center, left, right, top, bottom, top-left, top-right, bottom-left, bottom-right."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Place(*Arg(Args, 0, TEXT("center")));
			ForEachLive<UWonderlandUiSubsystem>([Place](UWonderlandUiSubsystem& Ui)
			{
				Say(Ui.MoveWonderWeb(Place) ? FString::Printf(TEXT("WONDER WEB: gliding to %s."), *Place.ToString())
					: FString::Printf(TEXT("WONDER WEB: '%s' is not a place -- center, left, right, top, bottom or a corner."), *Place.ToString()), true);
			});
		}));

	FAutoConsoleCommand CmdType(TEXT("wl.WonderWeb.Type"),
		TEXT("Enter a line at the Wonder Web terminal, e.g. `wl.WonderWeb.Type help`. Refused on a peer's tab. Never a shell."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Line = FString::Join(Args, TEXT(" "));
			ForEachLive<UWonderlandWonderWebSubsystem>([&Line](UWonderlandWonderWebSubsystem& Web)
			{
				Say(Web.SubmitTerminal(Line) ? FString::Printf(TEXT("WONDER WEB terminal: %s"), *Line)
					: FString::Printf(TEXT("WONDER WEB terminal refused '%s' -- the view on screen does not take input."), *Line), true);
			});
		}));
}

/* ==================================================================== reading a projection */

namespace
{
	bool ReadString(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, FString& Out, FString& Problem, bool bNullable = false)
	{
		const TSharedPtr<FJsonValue> Value = Json.IsValid() ? Json->TryGetField(Field) : nullptr;
		if (!Value.IsValid())
		{
			Problem = FString::Printf(TEXT("missing field '%s'"), Field);
			return false;
		}
		if (Value->IsNull())
		{
			if (bNullable)
			{
				Out.Reset();
				return true;
			}
			Problem = FString::Printf(TEXT("field '%s' is null"), Field);
			return false;
		}
		if (Value->Type != EJson::String)
		{
			Problem = FString::Printf(TEXT("field '%s' is not a string"), Field);
			return false;
		}
		Out = Value->AsString();
		return true;
	}

	bool ReadBool(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, bool& Out, FString& Problem)
	{
		const TSharedPtr<FJsonValue> Value = Json.IsValid() ? Json->TryGetField(Field) : nullptr;
		if (!Value.IsValid() || Value->Type != EJson::Boolean)
		{
			Problem = FString::Printf(TEXT("field '%s' is missing or not a boolean"), Field);
			return false;
		}
		Out = Value->AsBool();
		return true;
	}

	bool ReadAccess(const FString& Text, EWonderWebAccess& Out)
	{
		if (Text == TEXT("control")) { Out = EWonderWebAccess::Control; return true; }
		if (Text == TEXT("observe")) { Out = EWonderWebAccess::Observe; return true; }
		if (Text == TEXT("none")) { Out = EWonderWebAccess::None; return true; }
		return false;
	}
}

bool WonderlandParseWonderWebSurface(const TSharedPtr<FJsonObject>& Json, FWonderWebSurface& Out, FString& Problem)
{
	Out = FWonderWebSurface();
	if (!Json.IsValid())
	{
		Problem = TEXT("not an object");
		return false;
	}
	if (!ReadString(Json, TEXT("title"), Out.Title, Problem)
		|| !ReadString(Json, TEXT("observedAtIso"), Out.ObservedAtIso, Problem)
		|| !ReadString(Json, TEXT("viewerUserId"), Out.ViewerUserId, Problem)
		|| !ReadString(Json, TEXT("unavailableReason"), Out.UnavailableReason, Problem, true))
	{
		return false;
	}

	const TArray<TSharedPtr<FJsonValue>>* Tabs = nullptr;
	if (!Json->TryGetArrayField(TEXT("tabs"), Tabs) || Tabs == nullptr || Tabs->Num() == 0)
	{
		Problem = TEXT("no tabs");
		return false;
	}
	for (const TSharedPtr<FJsonValue>& Value : *Tabs)
	{
		const TSharedPtr<FJsonObject> TabJson = Value.IsValid() ? Value->AsObject() : nullptr;
		FWonderWebTab Tab;
		FString Access;
		if (!ReadString(TabJson, TEXT("userId"), Tab.UserId, Problem) || !ReadString(TabJson, TEXT("label"), Tab.Label, Problem)
			|| !ReadBool(TabJson, TEXT("isSelf"), Tab.bIsSelf, Problem) || !ReadBool(TabJson, TEXT("isActive"), Tab.bIsActive, Problem)
			|| !ReadString(TabJson, TEXT("dotColorToken"), Tab.DotColorToken, Problem)
			|| !ReadString(TabJson, TEXT("connectionState"), Tab.ConnectionState, Problem, true)
			|| !ReadString(TabJson, TEXT("access"), Access, Problem))
		{
			return false;
		}
		if (!ReadAccess(Access, Tab.Access))
		{
			Problem = FString::Printf(TEXT("tab access '%s' is not in the vocabulary"), *Access);
			return false;
		}
		// THE ONE RULE A RENDERER MAY STILL CHECK, because trusting it blindly would let a malformed feed hand a peer's
		// creation to a stranger: a tab that is not the viewer's own is never control.
		if (!Tab.bIsSelf && Tab.Access == EWonderWebAccess::Control)
		{
			Problem = FString::Printf(TEXT("tab '%s' is a peer's and claims control"), *Tab.Label);
			return false;
		}
		Out.Tabs.Add(MoveTemp(Tab));
	}

	const TSharedPtr<FJsonObject>* Address = nullptr;
	if (!Json->TryGetObjectField(TEXT("address"), Address) || Address == nullptr
		|| !ReadString(*Address, TEXT("display"), Out.Address.Display, Problem) || !ReadBool(*Address, TEXT("secure"), Out.Address.bSecure, Problem)
		|| !ReadString(*Address, TEXT("creationId"), Out.Address.CreationId, Problem, true)
		|| !ReadString(*Address, TEXT("projectId"), Out.Address.ProjectId, Problem, true))
	{
		Problem = Problem.IsEmpty() ? TEXT("no address") : Problem;
		return false;
	}

	const TSharedPtr<FJsonObject>* Viewport = nullptr;
	FString Kind;
	if (!Json->TryGetObjectField(TEXT("viewport"), Viewport) || Viewport == nullptr || !ReadString(*Viewport, TEXT("kind"), Kind, Problem))
	{
		Problem = Problem.IsEmpty() ? TEXT("no viewport") : Problem;
		return false;
	}
	FWonderWebViewport& View = Out.Viewport;
	if (Kind == TEXT("idle"))
	{
		View.Kind = EWonderWebViewportKind::Idle;
	}
	else if (Kind == TEXT("working"))
	{
		View.Kind = EWonderWebViewportKind::Working;
		if (!ReadString(*Viewport, TEXT("status"), View.Status, Problem) || !ReadString(*Viewport, TEXT("message"), View.Message, Problem))
		{
			return false;
		}
	}
	else if (Kind == TEXT("creation"))
	{
		View.Kind = EWonderWebViewportKind::Creation;
		if (!ReadString(*Viewport, TEXT("creationId"), View.CreationId, Problem) || !ReadString(*Viewport, TEXT("entrypoint"), View.Entrypoint, Problem)
			|| !ReadBool(*Viewport, TEXT("running"), View.bRunning, Problem))
		{
			return false;
		}
	}
	else if (Kind == TEXT("failed"))
	{
		View.Kind = EWonderWebViewportKind::Failed;
		if (!ReadString(*Viewport, TEXT("creationId"), View.CreationId, Problem) || !ReadString(*Viewport, TEXT("summary"), View.Summary, Problem)
			|| !ReadString(*Viewport, TEXT("phase"), View.Phase, Problem))
		{
			return false;
		}
	}
	else if (Kind == TEXT("observed"))
	{
		View.Kind = EWonderWebViewportKind::Observed;
		if (!ReadString(*Viewport, TEXT("creationId"), View.CreationId, Problem) || !ReadString(*Viewport, TEXT("ownerUserId"), View.OwnerUserId, Problem)
			|| !ReadString(*Viewport, TEXT("status"), View.Status, Problem))
		{
			return false;
		}
	}
	else
	{
		// A kind this build does not know is not drawn as one it does.
		Problem = FString::Printf(TEXT("viewport kind '%s' is not in the vocabulary"), *Kind);
		return false;
	}

	const TSharedPtr<FJsonObject>* Terminal = nullptr;
	if (!Json->TryGetObjectField(TEXT("terminal"), Terminal) || Terminal == nullptr
		|| !ReadString(*Terminal, TEXT("prompt"), Out.Terminal.Prompt, Problem)
		|| !ReadBool(*Terminal, TEXT("acceptsInput"), Out.Terminal.bAcceptsInput, Problem)
		|| !ReadBool(*Terminal, TEXT("busy"), Out.Terminal.bBusy, Problem))
	{
		Problem = Problem.IsEmpty() ? TEXT("no terminal") : Problem;
		return false;
	}
	double Truncated = -1.0;
	Out.Terminal.TruncatedFrom = (*Terminal)->TryGetNumberField(TEXT("truncatedFrom"), Truncated) ? static_cast<int32>(Truncated) : -1;
	const TArray<TSharedPtr<FJsonValue>>* Lines = nullptr;
	if (!(*Terminal)->TryGetArrayField(TEXT("lines"), Lines) || Lines == nullptr)
	{
		Problem = TEXT("terminal has no lines array");
		return false;
	}
	for (const TSharedPtr<FJsonValue>& Value : *Lines)
	{
		const TSharedPtr<FJsonObject> LineJson = Value.IsValid() ? Value->AsObject() : nullptr;
		FWonderWebTerminalLine Line;
		FString Stream;
		double Sequence = 0.0;
		if (!LineJson.IsValid() || !LineJson->TryGetNumberField(TEXT("sequence"), Sequence)
			|| !ReadString(LineJson, TEXT("text"), Line.Text, Problem) || !ReadString(LineJson, TEXT("stream"), Stream, Problem))
		{
			Problem = Problem.IsEmpty() ? TEXT("a terminal line is malformed") : Problem;
			return false;
		}
		Line.Sequence = static_cast<int32>(Sequence);
		Line.bRuntime = Stream == TEXT("runtime");
		Out.Terminal.Lines.Add(MoveTemp(Line));
	}

	const TSharedPtr<FJsonObject>* Chrome = nullptr;
	if (!Json->TryGetObjectField(TEXT("chrome"), Chrome) || Chrome == nullptr
		|| !ReadBool(*Chrome, TEXT("canGoBack"), Out.Chrome.bCanGoBack, Problem) || !ReadBool(*Chrome, TEXT("canGoForward"), Out.Chrome.bCanGoForward, Problem)
		|| !ReadBool(*Chrome, TEXT("canReload"), Out.Chrome.bCanReload, Problem) || !ReadBool(*Chrome, TEXT("canStop"), Out.Chrome.bCanStop, Problem)
		|| !ReadBool(*Chrome, TEXT("canRestart"), Out.Chrome.bCanRestart, Problem) || !ReadBool(*Chrome, TEXT("canRebuild"), Out.Chrome.bCanRebuild, Problem)
		|| !ReadBool(*Chrome, TEXT("canReturnToProject"), Out.Chrome.bCanReturnToProject, Problem))
	{
		Problem = Problem.IsEmpty() ? TEXT("no chrome") : Problem;
		return false;
	}
	Out.bValid = true;
	return true;
}

/* ==================================================================== the subsystem */

void UWonderlandWonderWebSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Canvas.Init(0, CanvasColumns * CanvasRows);
	bLoaded = LoadPreview();
	Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandWonderWebSubsystem::TickTimeline));
}

void UWonderlandWonderWebSubsystem::Deinitialize()
{
	if (Ticker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(Ticker);
		Ticker.Reset();
	}
	Super::Deinitialize();
}

bool UWonderlandWonderWebSubsystem::LoadPreview()
{
	const FString Path = FPaths::Combine(FPaths::ProjectDir(), TEXT("UiArt/WonderWeb/wonder-web-preview.json"));
	FString Text;
	Unavailable = FWonderWebSurface();
	Unavailable.Title = TEXT("WONDER WEB");
	Unavailable.Terminal.Prompt = TEXT("wonder@project:~$");
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		Problem = FString::Printf(TEXT("The Wonder Web preview surfaces could not be read from %s."), *Path);
		Unavailable.UnavailableReason = Problem;
		UE_LOG(LogWonderWeb, Warning, TEXT("WLWEB %s"), *Problem);
		return false;
	}
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		Problem = TEXT("The Wonder Web preview file is not valid JSON.");
		Unavailable.UnavailableReason = Problem;
		UE_LOG(LogWonderWeb, Warning, TEXT("WLWEB %s"), *Problem);
		return false;
	}
	FString Schema;
	if (!Root->TryGetStringField(TEXT("schema"), Schema) || Schema != TEXT("wonderland-wonder-web-preview.v1"))
	{
		Problem = FString::Printf(TEXT("The Wonder Web preview file has schema '%s', which this build does not read."), *Schema);
		Unavailable.UnavailableReason = Problem;
		UE_LOG(LogWonderWeb, Warning, TEXT("WLWEB %s"), *Problem);
		return false;
	}

	const TSharedPtr<FJsonObject>* Mine = nullptr;
	const TSharedPtr<FJsonObject>* Peers = nullptr;
	if (!Root->TryGetObjectField(TEXT("myView"), Mine) || !Root->TryGetObjectField(TEXT("peerViews"), Peers))
	{
		Problem = TEXT("The Wonder Web preview file carries no views.");
		Unavailable.UnavailableReason = Problem;
		return false;
	}
	for (const TPair<FString, TSharedPtr<FJsonValue>>& Frame : (*Mine)->Values)
	{
		FWonderWebSurface Surface;
		FString FrameProblem;
		if (!WonderlandParseWonderWebSurface(Frame.Value.IsValid() ? Frame.Value->AsObject() : nullptr, Surface, FrameProblem))
		{
			Problem = FString::Printf(TEXT("Preview frame '%s' is not a Wonder Web surface: %s."), *Frame.Key, *FrameProblem);
			Unavailable.UnavailableReason = Problem;
			UE_LOG(LogWonderWeb, Warning, TEXT("WLWEB %s"), *Problem);
			return false;
		}
		MyView.Add(FName(*Frame.Key), MoveTemp(Surface));
	}
	if (!MyView.Contains(TEXT("idle")))
	{
		Problem = TEXT("The Wonder Web preview file has no idle frame.");
		Unavailable.UnavailableReason = Problem;
		return false;
	}
	// The peers' views, in the order the viewer's own tab strip lists them.
	for (const FWonderWebTab& Tab : MyView[TEXT("idle")].Tabs)
	{
		if (Tab.bIsSelf)
		{
			continue;
		}
		const TSharedPtr<FJsonObject>* PeerJson = nullptr;
		FWonderWebSurface Surface;
		FString FrameProblem;
		if (!(*Peers)->TryGetObjectField(Tab.UserId, PeerJson) || !WonderlandParseWonderWebSurface(*PeerJson, Surface, FrameProblem))
		{
			Surface = Unavailable;
			Surface.Tabs = MyView[TEXT("idle")].Tabs;
			Surface.UnavailableReason = FString::Printf(TEXT("%s's view could not be read: %s"), *Tab.Label, FrameProblem.IsEmpty() ? TEXT("absent") : *FrameProblem);
		}
		PeerViews.Add(MoveTemp(Surface));
	}
	UE_LOG(LogWonderWeb, Log, TEXT("WLWEB preview loaded: %d frames of the viewer's own view, %d peer views"), MyView.Num(), PeerViews.Num());
	return true;
}

const FWonderWebSurface* UWonderlandWonderWebSubsystem::MyFrame() const
{
	return MyView.Find(CurrentFrame);
}

const FWonderWebSurface& UWonderlandWonderWebSubsystem::GetSurface() const
{
	if (!bLoaded)
	{
		return Unavailable;
	}
	if (SelectedTab > 0 && PeerViews.IsValidIndex(SelectedTab - 1))
	{
		return PeerViews[SelectedTab - 1];
	}
	const FWonderWebSurface* Frame = MyFrame();
	return Frame != nullptr ? *Frame : Unavailable;
}

bool UWonderlandWonderWebSubsystem::SelectTab(int32 Index)
{
	const FWonderWebSurface& Surface = GetSurface();
	if (!Surface.Tabs.IsValidIndex(Index) || Index == SelectedTab)
	{
		return Surface.Tabs.IsValidIndex(Index);
	}
	SelectedTab = Index;
	++Revision;
	OnChanged.Broadcast();
	UE_LOG(LogWonderWeb, Log, TEXT("WLWEB tab %d (%s, %s)"), Index, *GetSurface().Tabs[Index].Label,
		GetSurface().Tabs[Index].Access == EWonderWebAccess::Control ? TEXT("control") : TEXT("observe"));
	return true;
}

void UWonderlandWonderWebSubsystem::SetFrame(FName Frame)
{
	if (!MyView.Contains(Frame) || Frame == CurrentFrame)
	{
		return;
	}
	CurrentFrame = Frame;
	++Revision;
	OnChanged.Broadcast();
	UE_LOG(LogWonderWeb, Log, TEXT("WLWEB my view -> %s"), *Frame.ToString());
}

void UWonderlandWonderWebSubsystem::Play(std::initializer_list<TPair<FName, float>> Steps)
{
	Timeline.Reset();
	for (const TPair<FName, float>& Step : Steps)
	{
		Timeline.Add(Step);
	}
	TimelineClock = 0.0f;
	if (Timeline.Num() > 0)
	{
		SetFrame(Timeline[0].Key);
	}
}

bool UWonderlandWonderWebSubsystem::TickTimeline(float DeltaSeconds)
{
	// THE SIMULATED RUNTIME. It keeps going while Wonder Web is closed, as a real build would: close it mid-build and
	// come back to a running creation.
	if (Timeline.Num() == 0)
	{
		return true;
	}
	TimelineClock += DeltaSeconds;
	if (TimelineClock >= Timeline[0].Value)
	{
		TimelineClock = 0.0f;
		Timeline.RemoveAt(0);
		if (Timeline.Num() > 0)
		{
			SetFrame(Timeline[0].Key);
		}
	}
	return true;
}

bool UWonderlandWonderWebSubsystem::Act(EWonderWebAction Action)
{
	// ONLY WHAT THE SURFACE ON SCREEN ALLOWS. A peer's tab allows nothing; the viewer's own allows what its chrome says.
	const FWonderWebSurface& Surface = GetSurface();
	const FWonderWebChrome& Chrome = Surface.Chrome;
	const bool bMine = bLoaded && IsMyViewSelected() && Surface.Terminal.bAcceptsInput;
	bool bDone = false;
	switch (Action)
	{
	case EWonderWebAction::OpenSample:
		// Opening the project's sample creation from rest: the viewer owns an empty view, so it is theirs to start.
		if (bMine && Surface.Viewport.Kind == EWonderWebViewportKind::Idle && Timeline.Num() == 0)
		{
			Play({ {TEXT("created"), 0.8f}, {TEXT("preparing"), 1.4f}, {TEXT("building_1"), 1.0f}, {TEXT("building_2"), 1.0f},
				{TEXT("building_3"), 1.0f}, {TEXT("building_4"), 0.9f}, {TEXT("ready"), 0.9f}, {TEXT("running"), 0.0f} });
			bDone = true;
		}
		break;
	case EWonderWebAction::Stop:
		if (bMine && Chrome.bCanStop)
		{
			Timeline.Reset();
			SetFrame(TEXT("stopped"));
			bDone = true;
		}
		break;
	case EWonderWebAction::Restart:
		if (bMine && Chrome.bCanRestart)
		{
			Timeline.Reset();
			SetFrame(CurrentFrame == TEXT("ready") ? FName(TEXT("running")) : FName(TEXT("restarted")));
			bDone = true;
		}
		break;
	case EWonderWebAction::Rebuild:
		if (bMine && Chrome.bCanRebuild)
		{
			Play({ {TEXT("preparing"), 1.2f}, {TEXT("building_1"), 0.9f}, {TEXT("building_2"), 0.9f}, {TEXT("building_3"), 0.9f},
				{TEXT("building_4"), 0.8f}, {TEXT("ready"), 0.8f}, {TEXT("running"), 0.0f} });
			bDone = true;
		}
		break;
	case EWonderWebAction::Reload:
		if (bMine && Chrome.bCanReload)
		{
			// A reload is a page reload: the running creation starts over, and its canvas with it.
			Canvas.Init(0, CanvasColumns * CanvasRows);
			++Revision;
			OnChanged.Broadcast();
			bDone = true;
		}
		break;
	case EWonderWebAction::FailSample:
		// The error state on demand: a rebuild whose build exits 1. Allowed exactly where a rebuild is.
		if (bMine && Chrome.bCanRebuild)
		{
			Play({ {TEXT("failing"), 1.6f}, {TEXT("failed"), 0.0f} });
			bDone = true;
		}
		break;
	case EWonderWebAction::Back:
		bDone = bMine && Chrome.bCanGoBack;
		break;
	case EWonderWebAction::Forward:
		bDone = bMine && Chrome.bCanGoForward;
		break;
	}
	UE_LOG(LogWonderWeb, Log, TEXT("WLWEB action %d on %s: %s"), static_cast<int32>(Action), *CurrentFrame.ToString(),
		bDone ? TEXT("done") : TEXT("refused by the surface"));
	return bDone;
}

void UWonderlandWonderWebSubsystem::Say(const FString& Text, bool bTyped)
{
	SessionLines.Add({ Text, bTyped });
	// Bounded, like every log in Wonder Web.
	if (SessionLines.Num() > 200)
	{
		const int32 Drop = SessionLines.Num() - 200;
		SessionLines.RemoveAt(0, Drop);
		ClearedSessionLines = FMath::Max(ClearedSessionLines - Drop, 0);
	}
}

bool UWonderlandWonderWebSubsystem::SubmitTerminal(const FString& RawLine)
{
	const FWonderWebSurface& Surface = GetSurface();
	if (!bLoaded || !IsMyViewSelected() || !Surface.Terminal.bAcceptsInput)
	{
		UE_LOG(LogWonderWeb, Log, TEXT("WLWEB terminal input refused: this view's terminal does not accept input"));
		return false;
	}
	const FString Line = RawLine.TrimStartAndEnd();
	if (Line.IsEmpty())
	{
		return false;
	}
	Say(FString::Printf(TEXT("%s %s"), *Surface.Terminal.Prompt, *Line), true);

	// A FIXED VOCABULARY, NOT A SHELL. Nothing typed here reaches a process; the preview answers what it knows.
	FString Command = Line.ToLower();
	Command.RemoveFromStart(TEXT("wonder "));
	const auto Refused = [this](const TCHAR* Why) { Say(FString::Printf(TEXT("wonder: %s"), Why)); };
	if (Command == TEXT("help"))
	{
		Say(TEXT("development preview commands: open, run, stop, rebuild, reload, status, ls, fail-sample, clear, whoami"));
		Say(TEXT("this is not a shell: nothing typed here runs on any machine"));
	}
	else if (Command == TEXT("open") || Command == TEXT("run"))
	{
		if (Surface.Viewport.Kind == EWonderWebViewportKind::Idle)
		{
			Act(EWonderWebAction::OpenSample) ? Say(TEXT("opening the sample creation Pixel Canvas (simulated)")) : Refused(TEXT("cannot open a creation right now"));
		}
		else
		{
			Act(EWonderWebAction::Restart) ? Say(TEXT("running Pixel Canvas (simulated)")) : Refused(TEXT("nothing to run: the creation is not ready or already running"));
		}
	}
	else if (Command == TEXT("stop"))
	{
		Act(EWonderWebAction::Stop) ? Say(TEXT("stopping Pixel Canvas")) : Refused(TEXT("nothing is running"));
	}
	else if (Command == TEXT("rebuild") || Command == TEXT("build"))
	{
		Act(EWonderWebAction::Rebuild) ? Say(TEXT("rebuilding Pixel Canvas (simulated)")) : Refused(TEXT("a rebuild is not available right now"));
	}
	else if (Command == TEXT("reload"))
	{
		Act(EWonderWebAction::Reload) ? Say(TEXT("reloaded")) : Refused(TEXT("nothing is open to reload"));
	}
	else if (Command == TEXT("fail-sample"))
	{
		Act(EWonderWebAction::FailSample) ? Say(TEXT("rebuilding with a broken source to show a failed build (simulated)")) : Refused(TEXT("a rebuild is not available right now"));
	}
	else if (Command == TEXT("status"))
	{
		const FWonderWebViewport& View = Surface.Viewport;
		switch (View.Kind)
		{
		case EWonderWebViewportKind::Idle: Say(TEXT("nothing is open. type open to open the sample creation")); break;
		case EWonderWebViewportKind::Working: Say(FString::Printf(TEXT("%s: %s"), *View.Status, *View.Message)); break;
		case EWonderWebViewportKind::Creation: Say(FString::Printf(TEXT("%s: %s, %s"), *View.CreationId, *View.Entrypoint, View.bRunning ? TEXT("RUNNING") : TEXT("READY"))); break;
		case EWonderWebViewportKind::Failed: Say(FString::Printf(TEXT("FAILED in %s: %s"), *View.Phase, *View.Summary)); break;
		case EWonderWebViewportKind::Observed: Say(FString::Printf(TEXT("observing %s: %s"), *View.OwnerUserId, *View.Status)); break;
		}
	}
	else if (Command == TEXT("ls"))
	{
		Say(Surface.Viewport.Kind == EWonderWebViewportKind::Creation ? TEXT("index.html  assets/canvas.js  assets/styles.css") : TEXT("index.html  src/canvas.ts  src/palette.ts  src/styles.css"));
	}
	else if (Command == TEXT("whoami"))
	{
		Say(FString::Printf(TEXT("%s (development preview sample account)"), *Surface.ViewerUserId));
	}
	else if (Command == TEXT("clear"))
	{
		ClearTerminal();
	}
	else
	{
		Say(FString::Printf(TEXT("wonder: %s: not available in the development preview (no shell). type help"), *Line));
	}
	++Revision;
	OnChanged.Broadcast();
	return true;
}

void UWonderlandWonderWebSubsystem::ClearTerminal()
{
	const FWonderWebSurface* Frame = MyFrame();
	ClearedThroughSequence = Frame != nullptr && Frame->Terminal.Lines.Num() > 0 ? Frame->Terminal.Lines.Last().Sequence : ClearedThroughSequence;
	ClearedSessionLines = SessionLines.Num();
	++Revision;
	OnChanged.Broadcast();
}

bool UWonderlandWonderWebSubsystem::PaintCell(int32 Index)
{
	const FWonderWebSurface& Surface = GetSurface();
	// The creation is USED only where it is open and running for its owner.
	if (!IsMyViewSelected() || Surface.Viewport.Kind != EWonderWebViewportKind::Creation || !Surface.Viewport.bRunning || !Canvas.IsValidIndex(Index))
	{
		return false;
	}
	Canvas[Index] = Canvas[Index] == SelectedPaint ? 0 : static_cast<uint8>(SelectedPaint);
	++Revision;
	OnChanged.Broadcast();
	return true;
}

void UWonderlandWonderWebSubsystem::SelectPaint(int32 PaletteIndex)
{
	SelectedPaint = FMath::Clamp(PaletteIndex, 1, PaletteSize);
	++Revision;
	OnChanged.Broadcast();
}

int32 UWonderlandWonderWebSubsystem::GetPaintedCells() const
{
	int32 Painted = 0;
	for (const uint8 Cell : Canvas)
	{
		Painted += Cell != 0 ? 1 : 0;
	}
	return Painted;
}

bool UWonderlandWonderWebSubsystem::ClearCanvas()
{
	const FWonderWebSurface& Surface = GetSurface();
	if (!IsMyViewSelected() || Surface.Viewport.Kind != EWonderWebViewportKind::Creation || !Surface.Viewport.bRunning)
	{
		return false;
	}
	Canvas.Init(0, CanvasColumns * CanvasRows);
	++Revision;
	OnChanged.Broadcast();
	return true;
}

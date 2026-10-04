#include "WonderlandJuliusConnect.h"
#include "WonderlandCard.h"
#include "WonderlandBeta.h"
#include "WonderlandMissionHandoff.h"

#include "Dom/JsonObject.h"
#include "CoreGlobals.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/UObjectIterator.h"

DEFINE_LOG_CATEGORY_STATIC(LogJuliusConnect, Log, All);

namespace JuliusConnectTuning
{
	TAutoConsoleVariable<FString> CVarUrl(TEXT("wl.JuliusConnect.Url"), TEXT("http://127.0.0.1:8795"),
		TEXT("Julius Connect: the local service Wonderland reads connections from. Loopback only."));
	TAutoConsoleVariable<float> CVarPollSeconds(TEXT("wl.JuliusConnect.PollSeconds"), 0.5f,
		TEXT("Julius Connect: seconds between surface reads while the service is online."));
	TAutoConsoleVariable<float> CVarOfflinePollSeconds(TEXT("wl.JuliusConnect.OfflinePollSeconds"), 2.0f,
		TEXT("Julius Connect: seconds between attempts to reach the service while it is offline."));

	const TCHAR* ServiceSchema = TEXT("relay-julius-connect-service.v1");
	const TCHAR* SurfaceSchema = TEXT("relay-julius-connect-surface.v1");
}

/* ==================================================================== the console */

namespace JuliusConnectConsole
{
	/**
	 * A COMMAND THAT DOES NOTHING MUST SAY SO, ON SCREEN (founder, 2026-09-17: "commands arent working"). A revoke was
	 * typed with nothing connected and the Connections window closed: it answered into that window, so the console showed
	 * nothing at all. Every command now answers in the viewport and in the log.
	 */
	void Say(const FString& Text, bool bProblem = false)
	{
		UE_LOG(LogJuliusConnect, Display, TEXT("%s"), *Text);
		// The editor can have screen messages switched off globally; a command's answer must not vanish with them.
		GAreScreenMessagesEnabled = true;
		if (GEngine != nullptr)
		{
			GEngine->bEnableOnScreenDebugMessages = true;
			GEngine->AddOnScreenDebugMessage(INDEX_NONE, 8.0f, bProblem ? FColor(255, 107, 74) : FColor(255, 212, 0), Text);
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

	/** Everything typed after the command name, cleaned the same way -- "connect design tool" is one name. */
	FString Rest(const TArray<FString>& Args, const TCHAR* Fallback)
	{
		if (Args.Num() == 0)
		{
			return FString(Fallback);
		}
		TArray<FString> One;
		One.Add(FString::Join(Args, TEXT(" ")));
		return Arg(One, 0, Fallback);
	}

	int32 ForEachLive(TFunctionRef<void(UWonderlandJuliusConnectSubsystem&)> Body)
	{
		int32 Found = 0;
		for (TObjectIterator<UWonderlandJuliusConnectSubsystem> It; It; ++It)
		{
			if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject) && It->GetWorld() != nullptr && It->GetWorld()->IsGameWorld())
			{
				Body(**It);
				++Found;
			}
		}
		if (Found == 0)
		{
			Say(TEXT("JULIUS CONNECT: nothing to do -- press Play first (these commands work on the running game)."), true);
		}
		return Found;
	}

	/** What is connected right now, for a command that was asked about something else. */
	FString Connected(const UWonderlandJuliusConnectSubsystem& Connect)
	{
		if (Connect.GetLink() != EJuliusConnectLink::Online)
		{
			return FString::Printf(TEXT("the Julius Connect service is not answering (%s)"), *Connect.GetProblem());
		}
		TArray<FString> Rows;
		for (const FJuliusConnectService& Service : Connect.GetSurface().Services)
		{
			if (!Service.ConnectionId.IsEmpty())
			{
				Rows.Add(FString::Printf(TEXT("%s (%s) = %s"), *Service.DisplayName, *Service.ConnectorId, *Service.StateLabel));
			}
		}
		return Rows.Num() > 0 ? FString::Join(Rows, TEXT("; ")) : FString(TEXT("nothing is connected yet"));
	}

	FAutoConsoleCommand CmdTask(TEXT("wl.Julius.Task"),
		TEXT("Give Julius a task that uses external capabilities: `wl.Julius.Task design-sync` (it needs the DEVELOPMENT design-tool connector)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Template = Arg(Args, 0, TEXT("design-sync"));
			ForEachLive([&Template](UWonderlandJuliusConnectSubsystem& Connect)
			{
				Connect.StartTask(Template);
				Say(FString::Printf(TEXT("JULIUS: asked Julius to run %s. It needs a connection this project does not have, so the Connections window comes forward with the request."), *Template));
			});
		}));

	FAutoConsoleCommand CmdApprove(TEXT("wl.Julius.Connect.Approve"), TEXT("CONNECT on the authorization Julius is waiting on."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandJuliusConnectSubsystem& Connect)
			{
				const bool bAsked = Connect.GetSurface().bHasPrompt;
				Connect.ApprovePrompt();
				Say(bAsked ? TEXT("JULIUS CONNECT: approved. Julius finishes the connection itself.")
					: FString::Printf(TEXT("JULIUS CONNECT: Julius is not waiting on you for anything -- %s."), *Connected(Connect)), !bAsked);
			});
		}));

	FAutoConsoleCommand CmdDecline(TEXT("wl.Julius.Connect.NotNow"), TEXT("NOT NOW on the authorization Julius is waiting on."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandJuliusConnectSubsystem& Connect)
			{
				const bool bAsked = Connect.GetSurface().bHasPrompt;
				Connect.DeclinePrompt();
				Say(bAsked ? TEXT("JULIUS CONNECT: not now. Nothing was connected, and Julius will not ask again by itself.")
					: FString::Printf(TEXT("JULIUS CONNECT: Julius is not waiting on you for anything -- %s."), *Connected(Connect)), !bAsked);
			});
		}));

	FAutoConsoleCommand CmdConnect(TEXT("wl.Julius.Connect"),
		TEXT("Ask Julius to connect a service by what you call it: `wl.Julius.Connect design tool`. Julius works out how."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Name = Rest(Args, TEXT("design tool"));
			ForEachLive([&Name](UWonderlandJuliusConnectSubsystem& Connect)
			{
				Connect.Connect(Name);
				Say(FString::Printf(TEXT("JULIUS CONNECT: asked Julius to connect '%s'. It works out how, and asks you only for the step that is yours."), *Name));
			});
		}));

	FAutoConsoleCommand CmdRevoke(TEXT("wl.Julius.Connect.Revoke"), TEXT("Revoke a connection: `wl.Julius.Connect.Revoke dev-figma`. Julius loses it at once."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Id = Rest(Args, TEXT("dev-figma"));
			ForEachLive([&Id](UWonderlandJuliusConnectSubsystem& Connect)
			{
				Say(Connect.Revoke(Id) ? FString::Printf(TEXT("JULIUS CONNECT: revoking %s. Julius loses it at once."), *Id)
					: FString::Printf(TEXT("JULIUS CONNECT: there is no connection called '%s' -- %s."), *Id, *Connected(Connect)), true);
			});
		}));

	FAutoConsoleCommand CmdTest(TEXT("wl.Julius.Connect.Test"), TEXT("Ask the gate whether Julius may use a capability now: `wl.Julius.Connect.Test dev-figma files.read`."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Id = Arg(Args, 0, TEXT("dev-figma"));
			const FString Capability = Arg(Args, 1, TEXT("files.read"));
			ForEachLive([&Id, &Capability](UWonderlandJuliusConnectSubsystem& Connect)
			{
				Connect.TestAccess(Id, Capability);
				Say(FString::Printf(TEXT("JULIUS CONNECT: asking the gate whether Julius may use %s on %s -- the answer lands in the audit."), *Capability, *Id));
			});
		}));

	FAutoConsoleCommand CmdHealth(TEXT("wl.Julius.Connect.DevHealth"),
		TEXT("DEVELOPMENT CONTROL: `wl.Julius.Connect.DevHealth dev-figma RATE_LIMITED` (or UNAVAILABLE, EXPIRED, FAILED, RECONNECT_REQUIRED, CONNECTED)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Id = Arg(Args, 0, TEXT("dev-figma"));
			const FString State = Arg(Args, 1, TEXT("CONNECTED"));
			ForEachLive([&Id, &State](UWonderlandJuliusConnectSubsystem& Connect)
			{
				Say(Connect.SetHealth(Id, State) ? FString::Printf(TEXT("DEVELOPMENT CONTROL: %s -> %s."), *Id, *State.ToUpper())
					: FString::Printf(TEXT("DEVELOPMENT CONTROL: there is no connection called '%s' -- %s."), *Id, *Connected(Connect)), true);
			});
		}));

	FAutoConsoleCommand CmdReset(TEXT("wl.Julius.Connect.Reset"), TEXT("DEVELOPMENT CONTROL: forget every development connection, request and task, and start clean."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandJuliusConnectSubsystem& Connect)
			{
				Connect.Reset();
				Say(TEXT("DEVELOPMENT CONTROL: every development connection, request and task forgotten."));
			});
		}));

	FAutoConsoleCommand CmdType(TEXT("wl.Julius.Connect.Type"), TEXT("Enter a line at the Connections terminal: `wl.Julius.Connect.Type connect design tool`."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Line = FString::Join(Args, TEXT(" "));
			ForEachLive([&Line](UWonderlandJuliusConnectSubsystem& Connect)
			{
				Connect.SubmitTerminal(Line);
				Say(FString::Printf(TEXT("JULIUS CONNECT terminal: %s (the answer is in the Connections window)"), *Line));
			});
		}));
}

/* ==================================================================== reading the surface */

namespace
{
	bool Str(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, FString& Out, FString& Problem, bool bNullable = false)
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

	bool Bool(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, bool& Out, FString& Problem)
	{
		if (!Json.IsValid() || !Json->TryGetBoolField(Field, Out))
		{
			Problem = FString::Printf(TEXT("missing boolean '%s'"), Field);
			return false;
		}
		return true;
	}

	bool Int(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, int32& Out, FString& Problem)
	{
		if (!Json.IsValid() || !Json->TryGetNumberField(Field, Out))
		{
			Problem = FString::Printf(TEXT("missing number '%s'"), Field);
			return false;
		}
		return true;
	}

	bool Strings(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, TArray<FString>& Out, FString& Problem)
	{
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (!Json.IsValid() || !Json->TryGetArrayField(Field, Values))
		{
			Problem = FString::Printf(TEXT("missing array '%s'"), Field);
			return false;
		}
		Out.Reset();
		for (const TSharedPtr<FJsonValue>& Value : *Values)
		{
			if (!Value.IsValid() || Value->Type != EJson::String)
			{
				Problem = FString::Printf(TEXT("'%s' holds a non-string"), Field);
				return false;
			}
			Out.Add(Value->AsString());
		}
		return true;
	}

	bool Objects(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, TArray<TSharedPtr<FJsonObject>>& Out, FString& Problem)
	{
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (!Json.IsValid() || !Json->TryGetArrayField(Field, Values))
		{
			Problem = FString::Printf(TEXT("missing array '%s'"), Field);
			return false;
		}
		Out.Reset();
		for (const TSharedPtr<FJsonValue>& Value : *Values)
		{
			TSharedPtr<FJsonObject> Object = Value.IsValid() && Value->Type == EJson::Object ? Value->AsObject() : nullptr;
			if (!Object.IsValid())
			{
				Problem = FString::Printf(TEXT("'%s' holds a non-object"), Field);
				return false;
			}
			Out.Add(Object);
		}
		return true;
	}

	bool Capabilities(const TSharedPtr<FJsonObject>& Json, const TCHAR* Field, TArray<FJuliusConnectCapability>& Out, FString& Problem)
	{
		TArray<TSharedPtr<FJsonObject>> Rows;
		if (!Objects(Json, Field, Rows, Problem))
		{
			return false;
		}
		Out.Reset();
		for (const TSharedPtr<FJsonObject>& Row : Rows)
		{
			FJuliusConnectCapability& Capability = Out.AddDefaulted_GetRef();
			if (!Str(Row, TEXT("capabilityId"), Capability.Id, Problem) || !Str(Row, TEXT("label"), Capability.Label, Problem) || !Str(Row, TEXT("risk"), Capability.Risk, Problem))
			{
				return false;
			}
		}
		return true;
	}
}

const FJuliusConnectService* FJuliusConnectSurface::FindService(const FString& ConnectorId) const
{
	return Services.FindByPredicate([&ConnectorId](const FJuliusConnectService& Service) { return Service.ConnectorId == ConnectorId; });
}

const FJuliusConnectTask* FJuliusConnectSurface::CurrentTask() const
{
	for (int32 Index = Tasks.Num() - 1; Index >= 0; --Index)
	{
		if (Tasks[Index].RunState != TEXT("COMPLETED") && Tasks[Index].RunState != TEXT("FAILED") && Tasks[Index].RunState != TEXT("CANCELLED"))
		{
			return &Tasks[Index];
		}
	}
	return Tasks.Num() > 0 ? &Tasks.Last() : nullptr;
}

bool WonderlandParseJuliusConnectView(const FString& Body, FJuliusConnectSurface& Out, FString& OutProblem)
{
	using namespace JuliusConnectTuning;
	// Defence in depth: the service never sends a credential reference; if one ever arrives it is not drawn.
	if (Body.Contains(TEXT("vault://")) || Body.Contains(TEXT("credentialRef")))
	{
		OutProblem = TEXT("the service sent a credential reference; the surface was refused and nothing was drawn");
		return false;
	}
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Body);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		OutProblem = TEXT("the response is not JSON");
		return false;
	}
	FString Schema;
	if (!Str(Root, TEXT("schema"), Schema, OutProblem))
	{
		return false;
	}
	if (Schema != ServiceSchema)
	{
		OutProblem = FString::Printf(TEXT("unknown service schema '%s'"), *Schema);
		return false;
	}
	FJuliusConnectSurface Parsed;
	const TSharedPtr<FJsonObject>* SurfacePtr = nullptr;
	if (!Str(Root, TEXT("mode"), Parsed.Mode, OutProblem) || !Int(Root, TEXT("revision"), Parsed.ServiceRevision, OutProblem))
	{
		return false;
	}
	if (!Root->TryGetObjectField(TEXT("surface"), SurfacePtr) || SurfacePtr == nullptr || !SurfacePtr->IsValid())
	{
		OutProblem = TEXT("missing object 'surface'");
		return false;
	}
	const TSharedPtr<FJsonObject> S = *SurfacePtr;
	if (!Str(S, TEXT("schema"), Schema, OutProblem))
	{
		return false;
	}
	if (Schema != SurfaceSchema)
	{
		OutProblem = FString::Printf(TEXT("unknown surface schema '%s'"), *Schema);
		return false;
	}
	if (!Str(S, TEXT("observedAt"), Parsed.ObservedAt, OutProblem) || !Str(S, TEXT("viewerUserId"), Parsed.ViewerUserId, OutProblem)
		|| !Str(S, TEXT("projectId"), Parsed.ProjectId, OutProblem) || !Str(S, TEXT("notice"), Parsed.Notice, OutProblem))
	{
		return false;
	}

	TArray<TSharedPtr<FJsonObject>> Rows;
	if (!Objects(S, TEXT("services"), Rows, OutProblem))
	{
		return false;
	}
	for (const TSharedPtr<FJsonObject>& Row : Rows)
	{
		FJuliusConnectService& Service = Parsed.Services.AddDefaulted_GetRef();
		if (!Str(Row, TEXT("connectorId"), Service.ConnectorId, OutProblem) || !Str(Row, TEXT("displayName"), Service.DisplayName, OutProblem)
			|| !Str(Row, TEXT("kind"), Service.Kind, OutProblem) || !Str(Row, TEXT("connectionId"), Service.ConnectionId, OutProblem, true)
			|| !Str(Row, TEXT("state"), Service.State, OutProblem) || !Str(Row, TEXT("stateLabel"), Service.StateLabel, OutProblem)
			|| !Bool(Row, TEXT("reachable"), Service.bReachable, OutProblem) || !Str(Row, TEXT("unavailableReason"), Service.UnavailableReason, OutProblem, true)
			|| !Str(Row, TEXT("routeLabel"), Service.RouteLabel, OutProblem) || !Str(Row, TEXT("accountLabel"), Service.AccountLabel, OutProblem, true)
			|| !Strings(Row, TEXT("granted"), Service.Granted, OutProblem) || !Strings(Row, TEXT("denied"), Service.Denied, OutProblem)
			|| !Strings(Row, TEXT("projectScope"), Service.ProjectScope, OutProblem) || !Strings(Row, TEXT("missions"), Service.Missions, OutProblem)
			|| !Str(Row, TEXT("healthDetail"), Service.HealthDetail, OutProblem) || !Str(Row, TEXT("lastActivityAt"), Service.LastActivityAt, OutProblem, true)
			|| !Bool(Row, TEXT("canRevoke"), Service.bCanRevoke, OutProblem) || !Bool(Row, TEXT("canConnect"), Service.bCanConnect, OutProblem)
			|| !Str(Row, TEXT("connectLabel"), Service.ConnectLabel, OutProblem) || !Bool(Row, TEXT("awaitingUser"), Service.bAwaitingUser, OutProblem))
		{
			OutProblem = FString::Printf(TEXT("service row: %s"), *OutProblem);
			return false;
		}
	}

	const TSharedPtr<FJsonValue> PromptValue = S->TryGetField(TEXT("prompt"));
	if (!PromptValue.IsValid())
	{
		OutProblem = TEXT("missing field 'prompt'");
		return false;
	}
	if (!PromptValue->IsNull())
	{
		const TSharedPtr<FJsonObject> P = PromptValue->Type == EJson::Object ? PromptValue->AsObject() : nullptr;
		FJuliusConnectPrompt& Prompt = Parsed.Prompt;
		if (!P.IsValid() || !Str(P, TEXT("requestId"), Prompt.RequestId, OutProblem) || !Str(P, TEXT("banner"), Prompt.Banner, OutProblem)
			|| !Str(P, TEXT("headline"), Prompt.Headline, OutProblem) || !Str(P, TEXT("kind"), Prompt.Kind, OutProblem)
			|| !Str(P, TEXT("connectorId"), Prompt.ConnectorId, OutProblem) || !Str(P, TEXT("displayName"), Prompt.DisplayName, OutProblem)
			|| !Str(P, TEXT("routeLabel"), Prompt.RouteLabel, OutProblem) || !Str(P, TEXT("neededFor"), Prompt.NeededFor, OutProblem)
			|| !Str(P, TEXT("missionId"), Prompt.MissionId, OutProblem, true)
			|| !Capabilities(P, TEXT("requested"), Prompt.Requested, OutProblem) || !Capabilities(P, TEXT("notRequested"), Prompt.NotRequested, OutProblem)
			|| !Strings(P, TEXT("juliusDid"), Prompt.JuliusDid, OutProblem) || !Str(P, TEXT("humanStep"), Prompt.HumanStep, OutProblem)
			|| !Bool(P, TEXT("credentialFlow"), Prompt.bCredentialFlow, OutProblem))
		{
			OutProblem = FString::Printf(TEXT("prompt: %s"), OutProblem.IsEmpty() ? TEXT("not an object") : *OutProblem);
			return false;
		}
		Parsed.bHasPrompt = true;
	}

	if (!Objects(S, TEXT("setup"), Rows, OutProblem))
	{
		return false;
	}
	for (const TSharedPtr<FJsonObject>& Row : Rows)
	{
		FJuliusConnectSetupRow& Setup = Parsed.Setup.AddDefaulted_GetRef();
		if (!Str(Row, TEXT("requestId"), Setup.RequestId, OutProblem) || !Str(Row, TEXT("displayName"), Setup.DisplayName, OutProblem)
			|| !Str(Row, TEXT("kind"), Setup.Kind, OutProblem) || !Str(Row, TEXT("routeLabel"), Setup.RouteLabel, OutProblem)
			|| !Str(Row, TEXT("humanStep"), Setup.HumanStep, OutProblem))
		{
			return false;
		}
	}

	if (!Objects(S, TEXT("tasks"), Rows, OutProblem))
	{
		return false;
	}
	for (const TSharedPtr<FJsonObject>& Row : Rows)
	{
		FJuliusConnectTask& Task = Parsed.Tasks.AddDefaulted_GetRef();
		TArray<TSharedPtr<FJsonObject>> Timeline;
		if (!Str(Row, TEXT("taskId"), Task.TaskId, OutProblem) || !Str(Row, TEXT("missionId"), Task.MissionId, OutProblem)
			|| !Str(Row, TEXT("templateId"), Task.TemplateId, OutProblem)
			|| !Str(Row, TEXT("title"), Task.Title, OutProblem) || !Str(Row, TEXT("runState"), Task.RunState, OutProblem)
			|| !Str(Row, TEXT("stepLabel"), Task.StepLabel, OutProblem) || !Int(Row, TEXT("progress"), Task.Progress, OutProblem)
			|| !Int(Row, TEXT("total"), Task.Total, OutProblem) || !Str(Row, TEXT("blockedReason"), Task.BlockedReason, OutProblem, true)
			|| !Strings(Row, TEXT("blockedOn"), Task.BlockedOn, OutProblem) || !Objects(Row, TEXT("timeline"), Timeline, OutProblem))
		{
			return false;
		}
		for (const TSharedPtr<FJsonObject>& Entry : Timeline)
		{
			FJuliusConnectTimelineRow& Line = Task.Timeline.AddDefaulted_GetRef();
			if (!Str(Entry, TEXT("at"), Line.At, OutProblem) || !Str(Entry, TEXT("state"), Line.State, OutProblem) || !Str(Entry, TEXT("summary"), Line.Summary, OutProblem))
			{
				return false;
			}
		}
	}

	if (!Objects(S, TEXT("audit"), Rows, OutProblem))
	{
		return false;
	}
	for (const TSharedPtr<FJsonObject>& Row : Rows)
	{
		FJuliusConnectAuditRow& Audit = Parsed.Audit.AddDefaulted_GetRef();
		if (!Str(Row, TEXT("at"), Audit.At, OutProblem) || !Str(Row, TEXT("actor"), Audit.Actor, OutProblem) || !Str(Row, TEXT("action"), Audit.Action, OutProblem)
			|| !Str(Row, TEXT("service"), Audit.Service, OutProblem) || !Str(Row, TEXT("capability"), Audit.Capability, OutProblem, true)
			|| !Str(Row, TEXT("outcome"), Audit.Outcome, OutProblem) || !Str(Row, TEXT("detail"), Audit.Detail, OutProblem)
			|| !Str(Row, TEXT("projectId"), Audit.ProjectId, OutProblem, true) || !Str(Row, TEXT("missionId"), Audit.MissionId, OutProblem, true))
		{
			return false;
		}
	}
	Out = MoveTemp(Parsed);
	return true;
}

/* ==================================================================== the client */

void UWonderlandJuliusConnectSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandJuliusConnectSubsystem::Tick), 0.05f);
	Say(TEXT("Julius Connect. Say what to connect -- Julius works out how. Type  help  for the words this prompt knows."));
}

void UWonderlandJuliusConnectSubsystem::Deinitialize()
{
	if (Ticker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(Ticker);
		Ticker.Reset();
	}
	for (const FHttpRequestPtr& Request : InFlight)
	{
		if (Request.IsValid())
		{
			Request->OnProcessRequestComplete().Unbind();
			Request->CancelRequest();
		}
	}
	InFlight.Reset();
	Super::Deinitialize();
}

FString UWonderlandJuliusConnectSubsystem::StartCommand()
{
	// A DEVELOPER'S INSTRUCTION, SHOWN TO DEVELOPERS ONLY (private beta, B09). It names a folder on the founder's disk and
	// an npm script; a tester can do nothing with either, and the clean-user baseline found it printed for every one.
	return WonderlandBeta::IsDeveloperSession()
		? FString(TEXT("cd C:\\dev\\iwonder\\julius-connect && npm run julius-connect:dev"))
		: FString();
}

FString UWonderlandJuliusConnectSubsystem::BaseUrl() const
{
	FString Url = JuliusConnectTuning::CVarUrl.GetValueOnGameThread();
	// Loopback only: this client never sends a user's intent anywhere but this machine.
	if (!Url.StartsWith(TEXT("http://127.0.0.1:")) && !Url.StartsWith(TEXT("http://localhost:")))
	{
		Url = TEXT("http://127.0.0.1:8795");
	}
	Url.RemoveFromEnd(TEXT("/"));
	return Url;
}

bool UWonderlandJuliusConnectSubsystem::Tick(float DeltaSeconds)
{
	// NOT PART OF THIS BETA: a player's session never contacts the local service (see WonderlandBeta.h).
	if (!WonderlandBeta::UseLocalAiServices())
	{
		SetLink(EJuliusConnectLink::Offline, WonderlandBeta::AiUnavailableSentence());
		return true;
	}
	const double Now = FPlatformTime::Seconds();
	if (!bPollInFlight && Now >= NextPollAt)
	{
		Poll();
	}
	return true;
}

void UWonderlandJuliusConnectSubsystem::PollNow()
{
	NextPollAt = 0.0;
	if (!bPollInFlight)
	{
		Poll();
	}
}

void UWonderlandJuliusConnectSubsystem::Poll()
{
	bPollInFlight = true;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl() + TEXT("/julius-connect/v1/surface"));
	Request->SetVerb(TEXT("GET"));
	Request->SetTimeout(2.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		bPollInFlight = false;
		const double Now = FPlatformTime::Seconds();
		if (!bConnected || !Response.IsValid())
		{
			NextPollAt = Now + JuliusConnectTuning::CVarOfflinePollSeconds.GetValueOnGameThread();
			SetLink(EJuliusConnectLink::Offline, FString::Printf(TEXT("The Julius Connect service is not running at %s."), *BaseUrl()));
			return;
		}
		NextPollAt = Now + JuliusConnectTuning::CVarPollSeconds.GetValueOnGameThread();
		Accept(Response->GetContentAsString(), Response->GetResponseCode(), false, FString());
	});
	InFlight.Add(Request);
	Request->ProcessRequest();
}

void UWonderlandJuliusConnectSubsystem::Post(const TSharedRef<FJsonObject>& Intent, const FString& Describe)
{
	// A CONNECTION CHANGE (provider, capability, approval) is never the Mission Handoff's to make (the write spy)
	FWonderlandMissionHandoff::NoteMutation(TEXT("UWonderlandJuliusConnectSubsystem::Post (a connection intent)"));
	if (!WonderlandBeta::UseLocalAiServices())
	{
		Say(FString::Printf(TEXT("%s: not sent. %s"), *Describe, WonderlandBeta::AiUnavailableSentence()), false, true);
		return;
	}
	FString Body;
	const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Body);
	FJsonSerializer::Serialize(Intent, Writer);
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl() + TEXT("/julius-connect/v1/intents"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(Body);
	Request->SetTimeout(3.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, Describe](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		if (!bConnected || !Response.IsValid())
		{
			SetLink(EJuliusConnectLink::Offline, FString::Printf(TEXT("The Julius Connect service is not running at %s."), *BaseUrl()));
			Say(FString::Printf(TEXT("%s: not sent -- the Julius Connect service is offline. Start it: %s"), *Describe, *StartCommand()), false, true);
			Announce(FString::Printf(TEXT("JULIUS CONNECT is offline, so %s was not sent. In a Windows terminal -- not this console -- run: %s"), *Describe, *StartCommand()), true);
			return;
		}
		Accept(Response->GetContentAsString(), Response->GetResponseCode(), true, Describe);
	});
	InFlight.Add(Request);
	++IntentsSent;
	UE_LOG(LogJuliusConnect, Log, TEXT("WLCONNECT intent %s"), *Describe);
	Request->ProcessRequest();
}

void UWonderlandJuliusConnectSubsystem::Accept(const FString& Body, int32 Status, bool bFromIntent, const FString& Describe)
{
	// A refused intent still carries the surface as it stands, plus the service's reason.
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Body);
	FString Refusal;
	if (FJsonSerializer::Deserialize(Reader, Root) && Root.IsValid())
	{
		bool bOk = true;
		const TSharedPtr<FJsonObject>* Error = nullptr;
		if (Root->TryGetBoolField(TEXT("ok"), bOk) && !bOk && Root->TryGetObjectField(TEXT("error"), Error) && Error != nullptr && Error->IsValid())
		{
			(*Error)->TryGetStringField(TEXT("message"), Refusal);
		}
	}
	FJuliusConnectSurface Parsed;
	FString ParseProblem;
	const bool bParsed = WonderlandParseJuliusConnectView(Body, Parsed, ParseProblem);
	if (bFromIntent)
	{
		if (!Refusal.IsEmpty())
		{
			Say(FString::Printf(TEXT("%s: refused -- %s"), *Describe, *Refusal), false, true);
			Announce(FString::Printf(TEXT("JULIUS CONNECT refused %s: %s"), *Describe, *Refusal), true);
		}
		else if (Status == 200)
		{
			Say(FString::Printf(TEXT("%s: done."), *Describe));
		}
	}
	if (!bParsed)
	{
		if (!bFromIntent || Refusal.IsEmpty())
		{
			SetLink(EJuliusConnectLink::Offline, FString::Printf(TEXT("The Julius Connect surface could not be read (HTTP %d): %s"), Status, *ParseProblem));
		}
		return;
	}
	const bool bLinkChanged = Link != EJuliusConnectLink::Online;
	const bool bSurfaceChanged = Parsed.ServiceRevision != Surface.ServiceRevision || bLinkChanged;
	Link = EJuliusConnectLink::Online;
	Problem.Reset();
	if (bSurfaceChanged)
	{
		Surface = MoveTemp(Parsed);
		Changed();
	}
}

void UWonderlandJuliusConnectSubsystem::SetLink(EJuliusConnectLink NewLink, const FString& Why)
{
	if (Link == NewLink && Problem == Why)
	{
		return;
	}
	if (NewLink == EJuliusConnectLink::Offline && Link != EJuliusConnectLink::Offline)
	{
		UE_LOG(LogJuliusConnect, Warning, TEXT("WLCONNECT offline: %s"), *Why);
	}
	Link = NewLink;
	Problem = Why;
	if (NewLink != EJuliusConnectLink::Online)
	{
		// NOTHING REMEMBERED IS SHOWN AS CURRENT: without the service there is no connection state to draw.
		Surface = FJuliusConnectSurface();
	}
	Changed();
}

void UWonderlandJuliusConnectSubsystem::Changed()
{
	++Revision;
	OnChanged.Broadcast();
}

void UWonderlandJuliusConnectSubsystem::Announce(const FString& Text, bool bProblem) const
{
	// SEEN EVEN WITH NO WINDOW OPEN: a refusal, or an offline service, must not be a line in a panel nobody has open.
	UE_LOG(LogJuliusConnect, Display, TEXT("%s"), *Text);
	// ENGINE DEBUG TEXT IS A DEVELOPER'S TOOL (private beta): a player's session keeps it in the log, off the screen.
	if (!WonderlandBeta::IsDeveloperSession())
	{
		return;
	}
	GAreScreenMessagesEnabled = true;
	if (GEngine != nullptr)
	{
		GEngine->bEnableOnScreenDebugMessages = true;
		GEngine->AddOnScreenDebugMessage(INDEX_NONE, 8.0f, bProblem ? FColor(255, 107, 74) : FColor(255, 212, 0), Text);
	}
}

void UWonderlandJuliusConnectSubsystem::Say(const FString& Text, bool bTyped, bool bProblem)
{
	Lines.Add({ Text, bTyped, bProblem });
	if (Lines.Num() > 60)
	{
		Lines.RemoveAt(0, Lines.Num() - 60);
	}
	Changed();
}

/* ==================================================================== intents */

namespace
{
	TSharedRef<FJsonObject> Intent(const TCHAR* Name)
	{
		const TSharedRef<FJsonObject> Json = MakeShared<FJsonObject>();
		Json->SetStringField(TEXT("intent"), Name);
		return Json;
	}
}

void UWonderlandJuliusConnectSubsystem::StartTask(const FString& TemplateId)
{
	const TSharedRef<FJsonObject> Json = Intent(TEXT("start_task"));
	Json->SetStringField(TEXT("templateId"), TemplateId.IsEmpty() ? TEXT("design-sync") : TemplateId);
	Post(Json, FString::Printf(TEXT("Julius, run %s"), TemplateId.IsEmpty() ? TEXT("design-sync") : *TemplateId));
}

bool UWonderlandJuliusConnectSubsystem::ApprovePrompt()
{
	if (!Surface.bHasPrompt)
	{
		Say(TEXT("approve: Julius is not waiting on you for anything."), false, true);
		return false;
	}
	const TSharedRef<FJsonObject> Json = Intent(TEXT("approve"));
	Json->SetStringField(TEXT("requestId"), Surface.Prompt.RequestId);
	Post(Json, FString::Printf(TEXT("CONNECT %s"), *Surface.Prompt.DisplayName));
	return true;
}

bool UWonderlandJuliusConnectSubsystem::DeclinePrompt()
{
	if (!Surface.bHasPrompt)
	{
		Say(TEXT("not now: Julius is not waiting on you for anything."), false, true);
		return false;
	}
	const TSharedRef<FJsonObject> Json = Intent(TEXT("decline"));
	Json->SetStringField(TEXT("requestId"), Surface.Prompt.RequestId);
	Post(Json, FString::Printf(TEXT("NOT NOW %s"), *Surface.Prompt.DisplayName));
	return true;
}

void UWonderlandJuliusConnectSubsystem::Connect(const FString& ConnectorIdOrName)
{
	const FString What = ConnectorIdOrName.TrimStartAndEnd();
	// NEVER A SECRET SENT (Second's sink audit, 10-03): a connector is named, never keyed -- nothing shaped like a key leaves or is logged
	if (FWonderlandCardStore::HoldsSecret(What))
	{
		UE_LOG(LogJuliusConnect, Warning, TEXT("WLCONNECT refused: the name holds something shaped like a key or password (%d characters); nothing was sent"), What.Len());
		return;
	}
	const TSharedRef<FJsonObject> Json = Intent(TEXT("connect"));
	if (Surface.FindService(What) != nullptr)
	{
		Json->SetStringField(TEXT("connectorId"), What);
	}
	else
	{
		Json->SetStringField(TEXT("name"), What);
	}
	Post(Json, FString::Printf(TEXT("connect %s"), *What));
}

bool UWonderlandJuliusConnectSubsystem::Revoke(const FString& ConnectorId)
{
	const FJuliusConnectService* Service = Surface.FindService(ConnectorId);
	if (Service == nullptr)
	{
		// Say what the user calls it: the first service whose name contains it.
		Service = Surface.Services.FindByPredicate([&ConnectorId](const FJuliusConnectService& Row) { return Row.DisplayName.Contains(ConnectorId); });
	}
	if (Service == nullptr || Service->ConnectionId.IsEmpty())
	{
		Say(FString::Printf(TEXT("revoke %s: there is no such connection."), *ConnectorId), false, true);
		return false;
	}
	const TSharedRef<FJsonObject> Json = Intent(TEXT("revoke"));
	Json->SetStringField(TEXT("connectionId"), Service->ConnectionId);
	Post(Json, FString::Printf(TEXT("REVOKE %s"), *Service->DisplayName));
	return true;
}

void UWonderlandJuliusConnectSubsystem::TestAccess(const FString& ConnectorId, const FString& Capability)
{
	const TSharedRef<FJsonObject> Json = Intent(TEXT("probe"));
	Json->SetStringField(TEXT("connectorId"), ConnectorId);
	Json->SetStringField(TEXT("capability"), Capability);
	Post(Json, FString::Printf(TEXT("test %s %s"), *ConnectorId, *Capability));
}

bool UWonderlandJuliusConnectSubsystem::SetHealth(const FString& ConnectorId, const FString& State)
{
	const FJuliusConnectService* Service = Surface.FindService(ConnectorId);
	if (Service == nullptr || Service->ConnectionId.IsEmpty())
	{
		Say(FString::Printf(TEXT("health %s: there is no such connection."), *ConnectorId), false, true);
		return false;
	}
	const TSharedRef<FJsonObject> Json = Intent(TEXT("dev_set_health"));
	Json->SetStringField(TEXT("connectionId"), Service->ConnectionId);
	Json->SetStringField(TEXT("to"), State.ToUpper());
	Post(Json, FString::Printf(TEXT("DEVELOPMENT CONTROL %s -> %s"), *Service->DisplayName, *State.ToUpper()));
	return true;
}

void UWonderlandJuliusConnectSubsystem::Reset()
{
	Post(Intent(TEXT("reset")), TEXT("DEVELOPMENT CONTROL reset"));
}

void UWonderlandJuliusConnectSubsystem::SubmitTerminal(const FString& InLine)
{
	const FString Line = InLine.TrimStartAndEnd();
	if (Line.IsEmpty())
	{
		return;
	}
	Say(FString::Printf(TEXT("julius@connect:~$ %s"), *Line), true);
	const FString Lower = Line.ToLower();
	TArray<FString> Words;
	Lower.ParseIntoArrayWS(Words);

	if (Lower == TEXT("help"))
	{
		Say(TEXT("julius sync design tokens   give Julius the design task (it needs a design-tool connection)"));
		Say(TEXT("connect <service>           e.g. connect design tool  ·  connect database  ·  connect github"));
		Say(TEXT("approve  ·  not now         answer the authorization Julius is waiting on"));
		Say(TEXT("revoke <service>            Julius loses it at once        test <service> [capability]"));
		Say(TEXT("status                      what is connected, and what Julius is doing"));
		return;
	}
	if (Lower.StartsWith(TEXT("julius")) && (Lower.Contains(TEXT("design")) || Lower.Contains(TEXT("sync"))))
	{
		StartTask(TEXT("design-sync"));
		return;
	}
	if (Words.Num() >= 2 && (Words[0] == TEXT("connect") || Words[0] == TEXT("reconnect")))
	{
		Connect(Line.RightChop(Words[0].Len()).TrimStartAndEnd());
		return;
	}
	if (Lower == TEXT("approve") || Lower == TEXT("yes") || Lower == TEXT("connect"))
	{
		ApprovePrompt();
		return;
	}
	if (Lower == TEXT("not now") || Lower == TEXT("no") || Lower == TEXT("decline"))
	{
		DeclinePrompt();
		return;
	}
	if (Words.Num() >= 2 && Words[0] == TEXT("revoke"))
	{
		const FString Name = Line.RightChop(Words[0].Len()).TrimStartAndEnd();
		const FJuliusConnectService* Service = Surface.FindService(Name);
		if (Service == nullptr)
		{
			Service = Surface.Services.FindByPredicate([&Name](const FJuliusConnectService& Row) { return !Row.ConnectionId.IsEmpty() && Row.DisplayName.Contains(Name); });
		}
		Revoke(Service != nullptr ? Service->ConnectorId : Name);
		return;
	}
	if (Words.Num() >= 2 && Words[0] == TEXT("test"))
	{
		const FJuliusConnectService* Service = Surface.FindService(Words[1]);
		if (Service == nullptr)
		{
			Service = Surface.Services.FindByPredicate([&Words](const FJuliusConnectService& Row) { return Row.DisplayName.ToLower().Contains(Words[1]); });
		}
		if (Service == nullptr)
		{
			Say(FString::Printf(TEXT("test: Julius knows no service called %s."), *Words[1]), false, true);
			return;
		}
		const FString Capability = Words.Num() >= 3 && Words.Last().Contains(TEXT(".")) ? Words.Last()
			: (Service->Granted.Num() > 0 ? Service->Granted[0] : TEXT("files.read"));
		TestAccess(Service->ConnectorId, Capability);
		return;
	}
	if (Lower == TEXT("status"))
	{
		if (Link != EJuliusConnectLink::Online)
		{
			Say(WonderlandBeta::IsDeveloperSession()
				? FString::Printf(TEXT("OFFLINE. %s Start it: %s"), *Problem, *StartCommand())
				: FString::Printf(TEXT("OFFLINE. %s"), *Problem), false, true);
			return;
		}
		for (const FJuliusConnectService& Service : Surface.Services)
		{
			if (!Service.ConnectionId.IsEmpty())
			{
				Say(FString::Printf(TEXT("%s: %s  ·  project may use %s"), *Service.DisplayName, *Service.StateLabel,
					Service.ProjectScope.Num() > 0 ? *FString::Join(Service.ProjectScope, TEXT(", ")) : TEXT("nothing")));
			}
		}
		if (const FJuliusConnectTask* Task = Surface.CurrentTask())
		{
			Say(FString::Printf(TEXT("Julius: %s  ·  %s  ·  step %d of %d"), *Task->Title, *Task->RunState, FMath::Min(Task->Progress + 1, Task->Total), Task->Total));
		}
		return;
	}
	Say(FString::Printf(TEXT("\"%s\" is not something this prompt knows. Type  help . It is not a shell."), *Line), false, true);
}

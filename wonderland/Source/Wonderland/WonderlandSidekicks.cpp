#include "WonderlandSidekicks.h"

#include "CoreGlobals.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/UObjectIterator.h"

DEFINE_LOG_CATEGORY_STATIC(LogSidekicks, Log, All);

namespace SidekickTuning
{
	TAutoConsoleVariable<FString> CVarUrl(TEXT("wl.Sidekicks.Url"), TEXT("http://127.0.0.1:8795"),
		TEXT("Sidekicks: the local service Wonderland reads the LLM Companion and Jhinn from. Loopback only."));
	TAutoConsoleVariable<float> CVarPollSeconds(TEXT("wl.Sidekicks.PollSeconds"), 0.35f,
		TEXT("Sidekicks: seconds between reads while the service is online. A companion mid-answer is worth watching, so this is quicker than the connections poll."));
	TAutoConsoleVariable<float> CVarOfflinePollSeconds(TEXT("wl.Sidekicks.OfflinePollSeconds"), 2.0f,
		TEXT("Sidekicks: seconds between attempts to reach the service while it is offline."));

	const TCHAR* ServiceSchema = TEXT("relay-sidekicks-service.v1");
}

/* ==================================================================== saying things where they can be seen */

namespace SidekickConsole
{
	void Say(const FString& Text, bool bProblem = false)
	{
		UE_LOG(LogSidekicks, Display, TEXT("%s"), *Text);
		GAreScreenMessagesEnabled = true;
		if (GEngine != nullptr)
		{
			GEngine->bEnableOnScreenDebugMessages = true;
			GEngine->AddOnScreenDebugMessage(INDEX_NONE, 8.0f, bProblem ? FColor(255, 107, 74) : FColor(255, 212, 0), Text);
		}
	}

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

	/** Everything from this argument on, as typed: what a person says to a companion is a sentence, not a token. */
	FString Rest(const TArray<FString>& Args, int32 From)
	{
		TArray<FString> Words;
		for (int32 Index = From; Index < Args.Num(); ++Index)
		{
			Words.Add(Args[Index]);
		}
		return FString::Join(Words, TEXT(" ")).TrimStartAndEnd();
	}

	int32 ForEachLive(TFunctionRef<void(UWonderlandSidekickSubsystem&)> Body)
	{
		int32 Found = 0;
		for (TObjectIterator<UWonderlandSidekickSubsystem> It; It; ++It)
		{
			if (It->GetWorld() != nullptr && It->GetWorld()->IsGameWorld())
			{
				Body(**It);
				++Found;
			}
		}
		if (Found == 0)
		{
			Say(TEXT("SIDEKICKS: nothing to do -- press Play first."), true);
		}
		return Found;
	}

	/** Which companion a command is about. "llm" and "jhinn" are what a person would type. */
	FString Who(const TArray<FString>& Args, int32 Index)
	{
		const FString Typed = Arg(Args, Index, TEXT("llm")).ToLower();
		if (Typed == TEXT("jhinn") || Typed == TEXT("agent") || Typed == TEXT("single"))
		{
			return TEXT("jhinn");
		}
		return TEXT("llm-companion");
	}

	FAutoConsoleCommand CmdStatus(TEXT("wl.Sidekicks.Status"),
		TEXT("What the LLM Companion and Jhinn are right now: state, provider, model, and whether answers are real."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandSidekickSubsystem& Sidekicks)
			{
				Say(FString::Printf(TEXT("SIDEKICKS: %s"), *Sidekicks.DescribeSidekicks()));
			});
		}));

	FAutoConsoleCommand CmdConnect(TEXT("wl.Sidekicks.Connect"),
		TEXT("Put a provider behind a companion: `wl.Sidekicks.Connect llm dev-companion`, `wl.Sidekicks.Connect jhinn dev-single-agent`. A real provider (openai, claude-code) answers AUTH REQUIRED until the founder has connected their own account."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString SidekickId = Who(Args, 0);
			const FString ProviderId = Arg(Args, 1, SidekickId == TEXT("jhinn") ? TEXT("dev-single-agent") : TEXT("dev-companion"));
			const FString ModelId = Args.IsValidIndex(2) ? Arg(Args, 2, TEXT("")) : FString();
			ForEachLive([&](UWonderlandSidekickSubsystem& Sidekicks)
			{
				Sidekicks.Connect(SidekickId, ProviderId, ModelId);
				Say(FString::Printf(TEXT("SIDEKICKS: asked for %s behind %s."), *ProviderId, *SidekickId));
			});
		}));

	FAutoConsoleCommand CmdSay(TEXT("wl.Sidekicks.Say"),
		TEXT("Say something to a companion: `wl.Sidekicks.Say llm what are you?`. Refused unless it is really connected."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString SidekickId = Who(Args, 0);
			const FString Text = Rest(Args, 1);
			if (Text.IsEmpty())
			{
				Say(TEXT("SIDEKICKS: say what? `wl.Sidekicks.Say llm hello`."), true);
				return;
			}
			ForEachLive([&](UWonderlandSidekickSubsystem& Sidekicks)
			{
				Sidekicks.Ask(SidekickId, Text);
			});
		}));

	FAutoConsoleCommand CmdCancel(TEXT("wl.Sidekicks.Cancel"), TEXT("Stop what a companion is doing: `wl.Sidekicks.Cancel llm`."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString SidekickId = Who(Args, 0);
			ForEachLive([&](UWonderlandSidekickSubsystem& Sidekicks) { Sidekicks.Cancel(SidekickId); });
		}));

	FAutoConsoleCommand CmdDisconnect(TEXT("wl.Sidekicks.Disconnect"), TEXT("Disconnect a companion: `wl.Sidekicks.Disconnect llm`. It truthfully becomes DISCONNECTED."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString SidekickId = Who(Args, 0);
			ForEachLive([&](UWonderlandSidekickSubsystem& Sidekicks) { Sidekicks.Disconnect(SidekickId); });
		}));

	FAutoConsoleCommand CmdModel(TEXT("wl.Sidekicks.Model"), TEXT("Change the model behind a companion: `wl.Sidekicks.Model llm fixture-chat-slow`. A new model is a new conversation."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString SidekickId = Who(Args, 0);
			const FString ModelId = Arg(Args, 1, TEXT(""));
			ForEachLive([&](UWonderlandSidekickSubsystem& Sidekicks) { Sidekicks.ChooseModel(SidekickId, ModelId); });
		}));

	FAutoConsoleCommand CmdProbe(TEXT("wl.Sidekicks.Probe"),
		TEXT("Ask each real provider whether it is actually on this machine, and what is missing. Free: a version check or a models listing, never a completion."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandSidekickSubsystem& Sidekicks)
			{
				Sidekicks.Probe();
				Say(TEXT("SIDEKICKS: asking each real provider whether it is there. Nothing is spent."));
			});
		}));

	FAutoConsoleCommand CmdProviders(TEXT("wl.Sidekicks.Providers"),
		TEXT("What the last probe found: each real provider, whether it is ready, and what is missing."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandSidekickSubsystem& Sidekicks)
			{
				if (Sidekicks.GetProviders().Num() == 0)
				{
					Say(TEXT("SIDEKICKS: nothing probed yet -- run wl.Sidekicks.Probe first."), true);
					return;
				}
				for (const FWonderlandSidekickProvider& Provider : Sidekicks.GetProviders())
				{
					Say(FString::Printf(TEXT("%s (%s): %s — %s"), *Provider.DisplayName, *Provider.Backs,
						Provider.bReady ? TEXT("READY") : TEXT("NOT READY"), *Provider.Detail), !Provider.bReady);
				}
			});
		}));

	FAutoConsoleCommand CmdReset(TEXT("wl.Sidekicks.Reset"), TEXT("Put both companions back to SIMULATED with no session."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachLive([](UWonderlandSidekickSubsystem& Sidekicks) { Sidekicks.Reset(); });
		}));
}

/* ==================================================================== the client */

void UWonderlandSidekickSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UWonderlandSidekickSubsystem::Tick), 0.0f);
}

void UWonderlandSidekickSubsystem::Deinitialize()
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

FString UWonderlandSidekickSubsystem::BaseUrl()
{
	FString Url = SidekickTuning::CVarUrl.GetValueOnGameThread();
	// Loopback only: the companions' runtime is a process on this machine and nowhere else.
	if (!Url.StartsWith(TEXT("http://127.0.0.1:")) && !Url.StartsWith(TEXT("http://localhost:")))
	{
		Url = TEXT("http://127.0.0.1:8795");
	}
	Url.RemoveFromEnd(TEXT("/"));
	return Url + TEXT("/sidekicks/v1");
}

const FWonderlandSidekick* UWonderlandSidekickSubsystem::Find(const FString& SidekickId) const
{
	return Sidekicks.FindByPredicate([&SidekickId](const FWonderlandSidekick& Row) { return Row.SidekickId == SidekickId; });
}

const FWonderlandSidekick* UWonderlandSidekickSubsystem::ByIndex(int32 Index) const
{
	// The companion preview's order, kept: 0 is the LLM Companion and 1 the Jhinn.
	return Find(Index == 1 ? TEXT("jhinn") : TEXT("llm-companion"));
}

FString UWonderlandSidekickSubsystem::MascotStateOf(const FString& SidekickId) const
{
	const FWonderlandSidekick* Row = Find(SidekickId);
	if (Row == nullptr || Link != EWonderlandSidekickLink::Online)
	{
		// NOTHING TO READ IS NOT A MOOD. With no runtime there is no honest activity to show.
		return TEXT("DISCONNECTED");
	}
	return Row->Mascot;
}

FString UWonderlandSidekickSubsystem::DescribeSidekicks() const
{
	static const TCHAR* Links[] = { TEXT("connecting"), TEXT("online"), TEXT("offline") };
	TArray<FString> Rows;
	for (const FWonderlandSidekick& Row : Sidekicks)
	{
		Rows.Add(FString::Printf(TEXT("%s[state=%s mascot=%s provider=%s model=%s mode=%s authority=%s turns=%d live=%s failure=%s]"),
			*Row.SidekickId, *Row.State, *Row.Mascot, *Row.ProviderId, *Row.ModelId, *Row.Mode, *Row.Authority, Row.Turns,
			Row.bHasLiveTurn ? *Row.LiveState : TEXT("-"), Row.Failure.IsEmpty() ? TEXT("-") : *Row.Failure));
	}
	return FString::Printf(TEXT("link=%s intents=%d %s"), Links[static_cast<int32>(Link)], IntentsSent, *FString::Join(Rows, TEXT(" ")));
}

void UWonderlandSidekickSubsystem::Changed()
{
	++Revision;
	OnChanged.Broadcast();
}

void UWonderlandSidekickSubsystem::SetLink(EWonderlandSidekickLink NewLink, const FString& Problem)
{
	if (Link == NewLink && LinkProblem == Problem)
	{
		return;
	}
	Link = NewLink;
	LinkProblem = Problem;
	Changed();
}

bool UWonderlandSidekickSubsystem::Tick(float DeltaSeconds)
{
	const double Now = FPlatformTime::Seconds();
	if (!bPollInFlight && Now >= NextPollAt)
	{
		Poll();
	}
	return true;
}

void UWonderlandSidekickSubsystem::Poll()
{
	bPollInFlight = true;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl() + TEXT("/view"));
	Request->SetVerb(TEXT("GET"));
	Request->SetTimeout(3.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		bPollInFlight = false;
		const double Now = FPlatformTime::Seconds();
		if (!bConnected || !Response.IsValid() || Response->GetResponseCode() != 200)
		{
			NextPollAt = Now + SidekickTuning::CVarOfflinePollSeconds.GetValueOnGameThread();
			SetLink(EWonderlandSidekickLink::Offline,
				FString::Printf(TEXT("The sidekick service is not running at %s. Start it with: npm run julius-connect:dev"), *BaseUrl()));
			return;
		}
		NextPollAt = Now + SidekickTuning::CVarPollSeconds.GetValueOnGameThread();
		Accept(Response->GetContentAsString());
	});
	InFlight.Add(Request);
	Request->ProcessRequest();
}

void UWonderlandSidekickSubsystem::Accept(const FString& Text)
{
	// NOTHING THAT LOOKS LIKE A SECRET IS EVEN PARSED. The service holds none; a body carrying one is a wrong body.
	if (Text.Contains(TEXT("sk-")) || Text.Contains(TEXT("BEGIN PRIVATE KEY")) || Text.Contains(TEXT("credentialRef")))
	{
		SetLink(EWonderlandSidekickLink::Offline, TEXT("The sidekick service sent something that looked like credential material. It was refused and not read."));
		return;
	}
	TSharedPtr<FJsonObject> Json;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
	if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
	{
		SetLink(EWonderlandSidekickLink::Offline, TEXT("The sidekick service answered with something that is not JSON."));
		return;
	}
	FString Schema;
	if (!Json->TryGetStringField(TEXT("schema"), Schema) || Schema != SidekickTuning::ServiceSchema)
	{
		SetLink(EWonderlandSidekickLink::Offline, FString::Printf(TEXT("The sidekick service speaks %s, which this build does not know."), *Schema));
		return;
	}
	int32 ServiceRev = 0;
	Json->TryGetNumberField(TEXT("revision"), ServiceRev);
	SetLink(EWonderlandSidekickLink::Online, FString());
	if (ServiceRev == ServiceRevision)
	{
		// Nothing changed: no redraw, and no one told twice.
		return;
	}
	ServiceRevision = ServiceRev;

	TArray<FWonderlandSidekick> Next;
	const TArray<TSharedPtr<FJsonValue>>* Rows = nullptr;
	if (Json->TryGetArrayField(TEXT("sidekicks"), Rows))
	{
		for (const TSharedPtr<FJsonValue>& Value : *Rows)
		{
			const TSharedPtr<FJsonObject>* Object = nullptr;
			if (!Value.IsValid() || !Value->TryGetObject(Object) || Object == nullptr)
			{
				continue;
			}
			const TSharedPtr<FJsonObject>& Row = *Object;
			FWonderlandSidekick Sidekick;
			Row->TryGetStringField(TEXT("sidekickId"), Sidekick.SidekickId);
			Row->TryGetStringField(TEXT("kind"), Sidekick.Kind);
			Row->TryGetStringField(TEXT("state"), Sidekick.State);
			Row->TryGetStringField(TEXT("mascot"), Sidekick.Mascot);
			Row->TryGetStringField(TEXT("providerId"), Sidekick.ProviderId);
			Row->TryGetStringField(TEXT("providerName"), Sidekick.ProviderName);
			Row->TryGetStringField(TEXT("modelId"), Sidekick.ModelId);
			Row->TryGetStringField(TEXT("mode"), Sidekick.Mode);
			Row->TryGetStringField(TEXT("note"), Sidekick.Note);
			Row->TryGetStringField(TEXT("authority"), Sidekick.Authority);
			Row->TryGetStringField(TEXT("sessionId"), Sidekick.SessionId);
			Row->TryGetNumberField(TEXT("turns"), Sidekick.Turns);
			Row->TryGetStringField(TEXT("lastAnswer"), Sidekick.LastAnswer);
			Row->TryGetStringField(TEXT("failure"), Sidekick.Failure);
			const TSharedPtr<FJsonObject>* Live = nullptr;
			if (Row->TryGetObjectField(TEXT("live"), Live) && Live != nullptr && (*Live).IsValid())
			{
				Sidekick.bHasLiveTurn = true;
				(*Live)->TryGetStringField(TEXT("turnId"), Sidekick.LiveTurnId);
				(*Live)->TryGetStringField(TEXT("state"), Sidekick.LiveState);
				(*Live)->TryGetStringField(TEXT("ask"), Sidekick.LiveAsk);
				(*Live)->TryGetStringField(TEXT("answer"), Sidekick.LiveAnswer);
			}
			// A SIDEKICK NEVER HOLDS MISSION AUTHORITY. If a body ever said so, it would be a wrong body: refuse it here
			// rather than draw it, because the separation is the founder's rule and Wonderland is the place it is seen.
			if (Sidekick.Authority == TEXT("mission"))
			{
				SetLink(EWonderlandSidekickLink::Offline, TEXT("The sidekick service claimed mission authority for a companion. That belongs to Julius; the answer was refused."));
				return;
			}
			Next.Add(MoveTemp(Sidekick));
		}
	}
	Sidekicks = MoveTemp(Next);

	TArray<FWonderlandSidekickProvider> FoundProviders;
	const TArray<TSharedPtr<FJsonValue>>* ProviderRows = nullptr;
	if (Json->TryGetArrayField(TEXT("providers"), ProviderRows))
	{
		for (const TSharedPtr<FJsonValue>& Value : *ProviderRows)
		{
			const TSharedPtr<FJsonObject>* Object = nullptr;
			if (!Value.IsValid() || !Value->TryGetObject(Object) || Object == nullptr)
			{
				continue;
			}
			FWonderlandSidekickProvider Provider;
			(*Object)->TryGetStringField(TEXT("providerId"), Provider.ProviderId);
			(*Object)->TryGetStringField(TEXT("displayName"), Provider.DisplayName);
			(*Object)->TryGetStringField(TEXT("backs"), Provider.Backs);
			(*Object)->TryGetBoolField(TEXT("ready"), Provider.bReady);
			(*Object)->TryGetStringField(TEXT("detail"), Provider.Detail);
			FoundProviders.Add(MoveTemp(Provider));
		}
	}
	Providers = MoveTemp(FoundProviders);
	Changed();
}

void UWonderlandSidekickSubsystem::SendIntent(const FString& Body, const FString& Describe)
{
	++IntentsSent;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl() + TEXT("/intents"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(Body);
	Request->SetTimeout(10.0f);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, Describe](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		if (!bConnected || !Response.IsValid())
		{
			SidekickConsole::Say(FString::Printf(TEXT("SIDEKICKS: no answer from the runtime, so %s did nothing."), *Describe), true);
			return;
		}
		if (Response->GetResponseCode() >= 400)
		{
			// The refusal as it was given: a companion that will not do something says why.
			SidekickConsole::Say(FString::Printf(TEXT("SIDEKICKS: %s"), *Response->GetContentAsString().Left(300)), true);
			return;
		}
		NextPollAt = 0.0;
		Accept(Response->GetContentAsString());
	});
	InFlight.Add(Request);
	Request->ProcessRequest();
}

/** JSON string escaping for what a person typed: quotes and backslashes, and nothing below a space. */
static FString EscapeForJson(const FString& Text)
{
	FString Out;
	Out.Reserve(Text.Len() + 8);
	for (const TCHAR Char : Text)
	{
		if (Char == TEXT('"') || Char == TEXT('\\'))
		{
			Out.AppendChar(TEXT('\\'));
			Out.AppendChar(Char);
		}
		else if (Char == TEXT('\n'))
		{
			Out.Append(TEXT("\\n"));
		}
		else if (Char >= 0x20)
		{
			Out.AppendChar(Char);
		}
	}
	return Out;
}

void UWonderlandSidekickSubsystem::Connect(const FString& SidekickId, const FString& ProviderId, const FString& ModelId)
{
	const FString Model = ModelId.IsEmpty() ? FString() : FString::Printf(TEXT(",\"modelId\":\"%s\""), *ModelId);
	SendIntent(FString::Printf(TEXT("{\"intent\":\"connect\",\"sidekickId\":\"%s\",\"providerId\":\"%s\"%s}"), *SidekickId, *ProviderId, *Model), TEXT("connect"));
}

void UWonderlandSidekickSubsystem::Ask(const FString& SidekickId, const FString& Text)
{
	// WHAT A PERSON SAYS IS NOT LOGGED HERE. It appears in their own terminal, which is where it belongs.
	SendIntent(FString::Printf(TEXT("{\"intent\":\"ask\",\"sidekickId\":\"%s\",\"ask\":\"%s\"}"), *SidekickId, *EscapeForJson(Text)), TEXT("ask"));
}

void UWonderlandSidekickSubsystem::Cancel(const FString& SidekickId)
{
	SendIntent(FString::Printf(TEXT("{\"intent\":\"cancel\",\"sidekickId\":\"%s\"}"), *SidekickId), TEXT("cancel"));
}

void UWonderlandSidekickSubsystem::Disconnect(const FString& SidekickId)
{
	SendIntent(FString::Printf(TEXT("{\"intent\":\"disconnect\",\"sidekickId\":\"%s\"}"), *SidekickId), TEXT("disconnect"));
}

void UWonderlandSidekickSubsystem::ChooseModel(const FString& SidekickId, const FString& ModelId)
{
	SendIntent(FString::Printf(TEXT("{\"intent\":\"model\",\"sidekickId\":\"%s\",\"modelId\":\"%s\"}"), *SidekickId, *ModelId), TEXT("model"));
}

void UWonderlandSidekickSubsystem::Probe()
{
	SendIntent(TEXT("{\"intent\":\"probe\"}"), TEXT("probe"));
}

void UWonderlandSidekickSubsystem::Reset()
{
	SendIntent(TEXT("{\"intent\":\"reset\"}"), TEXT("reset"));
}

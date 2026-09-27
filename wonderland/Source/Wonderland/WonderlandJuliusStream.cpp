#include "WonderlandJuliusStream.h"

#include "CoreGlobals.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/UObjectIterator.h"
#include "WonderlandJuliusSubsystem.h"
#include "WonderlandJuliusTaskState.h"
#include "WonderlandWireDecode.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandJuliusStream, Log, All);

namespace WonderlandJuliusStreamTuning
{
	TAutoConsoleVariable<FString> CVarBridgeUrl(TEXT("wl.Julius.Bridge.Url"), TEXT(""),
		TEXT("Julius stream: the Relay bridge this world follows a run on, e.g. http://127.0.0.1:8796. Overrides the "
			"project's Julius Link setting; when both are empty the world follows nothing and says so."));
	TAutoConsoleVariable<float> CVarPollSeconds(TEXT("wl.Julius.Stream.PollSeconds"), 1.0f,
		TEXT("Julius stream: seconds between page reads while following a run."));
	TAutoConsoleVariable<float> CVarUnpairedSeconds(TEXT("wl.Julius.Stream.UnpairedSeconds"), 2.0f,
		TEXT("Julius stream: seconds between checks for a token while waiting to be paired."));
}

/* ============================================================================================== the pure logic */

namespace WonderlandJuliusStreamLogic
{
	FWonderlandJuliusEmbodiment EmbodimentFromEnvelope(const FWonderlandEnvelope& Envelope)
	{
		// The recipe is AdoptHydration's, field for field, and deliberately so: two ways of turning Relay's decision
		// into a drawable state would be two rules waiting to disagree about the same run.
		FWonderlandJuliusEmbodiment Next;
		Next.SchemaVersion = Envelope.SchemaVersion;
		Next.ProjectId = Envelope.ProjectId;
		Next.MissionId = Envelope.MissionId;
		Next.VisualState = Envelope.State;
		Next.StateSource = Envelope.StateSource;
		Next.SourceState = Envelope.SourceState;
		Next.bTerminal = Envelope.bTerminal;
		Next.Activity = WonderlandActivityForJuliusState(Envelope.State);
		Next.Motion = WonderlandMotionForActivity(Next.Activity);
		Next.Animation = WonderlandAnimationForJuliusState(Envelope.State);
		Next.AttentionRequired.bKnown = true;
		Next.AttentionRequired.bValue = WonderlandJuliusStateAsksForAHuman(Envelope.State);
		Next.Sequence = Envelope.Sequence;
		Next.ObservedAtIso.bKnown = !Envelope.OccurredAt.IsEmpty();
		Next.ObservedAtIso.Value = Envelope.OccurredAt;
		return Next;
	}

	EWonderlandLinkState LinkStateForFailure(int32 HttpStatus, bool bConnected)
	{
		if (!bConnected)
		{
			return EWonderlandLinkState::Stale;
		}
		if (HttpStatus == 401)
		{
			return EWonderlandLinkState::SessionExpired;
		}
		if (HttpStatus == 403 || HttpStatus == 404)
		{
			return EWonderlandLinkState::Refused;
		}
		return EWonderlandLinkState::Stale;
	}

	float BackoffSeconds(int32 ConsecutiveFailures)
	{
		const int32 Clamped = FMath::Clamp(ConsecutiveFailures, 1, 6);
		return FMath::Min(30.0f, static_cast<float>(1 << (Clamped - 1)));
	}

	namespace Json
	{
		bool Serialize(const TSharedPtr<FJsonObject>& Object, FString& Out)
		{
			if (!Object.IsValid())
			{
				return false;
			}
			Out.Reset();
			const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
				TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
			return FJsonSerializer::Serialize(Object.ToSharedRef(), Writer);
		}

		TSharedPtr<FJsonObject> DataOf(const FString& Body)
		{
			TSharedPtr<FJsonObject> Root;
			const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Body);
			if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
			{
				return nullptr;
			}
			const TSharedPtr<FJsonObject>* Data = nullptr;
			if (!Root->TryGetObjectField(TEXT("data"), Data) || Data == nullptr || !Data->IsValid())
			{
				return nullptr;
			}
			return *Data;
		}
	}

	bool UnwrapData(const FString& Body, FString& OutData)
	{
		return Json::Serialize(Json::DataOf(Body), OutData);
	}

	bool SplitPage(const FString& Body, TArray<FString>& OutDeliveries, int64& OutNextCursor)
	{
		const TSharedPtr<FJsonObject> Data = Json::DataOf(Body);
		if (!Data.IsValid())
		{
			return false;
		}
		const TArray<TSharedPtr<FJsonValue>>* Deliveries = nullptr;
		int64 Next = 0;
		if (!Data->TryGetArrayField(TEXT("deliveries"), Deliveries) || Deliveries == nullptr
			|| !Data->TryGetNumberField(TEXT("nextCursor"), Next))
		{
			return false;
		}
		TArray<FString> Out;
		Out.Reserve(Deliveries->Num());
		for (const TSharedPtr<FJsonValue>& Value : *Deliveries)
		{
			FString One;
			// A delivery that is not an object is not skipped quietly: the whole page is refused, because applying the
			// rest of it would move the cursor past something the world never showed.
			if (!Value.IsValid() || !Json::Serialize(Value->AsObject(), One))
			{
				return false;
			}
			Out.Add(MoveTemp(One));
		}
		OutDeliveries = MoveTemp(Out);
		OutNextCursor = Next;
		return true;
	}
}

/* =========================================================================================== the subsystem */

void UWonderlandJuliusStreamSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	// The Julius state subsystem is what this feeds; make sure it exists before anything is pushed to it.
	Collection.InitializeDependency(UWonderlandJuliusSubsystem::StaticClass());
	Paired = MakeShared<FWonderlandPairedTokenSource>();
	TokenSource = Paired;
	Ticker = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateUObject(this, &UWonderlandJuliusStreamSubsystem::Tick), 0.1f);
}

void UWonderlandJuliusStreamSubsystem::Deinitialize()
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

UWonderlandJuliusSubsystem* UWonderlandJuliusStreamSubsystem::World() const
{
	const UGameInstance* Instance = GetGameInstance();
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusSubsystem>() : nullptr;
}

FString UWonderlandJuliusStreamSubsystem::BridgeUrl() const
{
	// The cvar is a developer's override; a packaged build has no console and reads the project setting.
	FString Url = WonderlandJuliusStreamTuning::CVarBridgeUrl.GetValueOnGameThread();
	Url.TrimStartAndEndInline();
	if (Url.IsEmpty())
	{
		Url = GetDefault<UWonderlandJuliusLinkSettings>()->BridgeUrl;
		Url.TrimStartAndEndInline();
	}
	while (Url.EndsWith(TEXT("/")))
	{
		Url.LeftChopInline(1);
	}
	return Url;
}

FString UWonderlandJuliusStreamSubsystem::RunQuery(int64 Cursor) const
{
	return FString::Printf(TEXT("projectId=%s&runId=%s&cursor=%lld"),
		*FGenericPlatformHttp::UrlEncode(ProjectId),
		// THE RUN ID IS SENT RAW. It carries a colon (run:<hex>), which RFC 3986 allows unencoded in a query, and the
		// bridge decodes either spelling -- but raw is the spelling that has never been refused.
		*RunId,
		Cursor);
}

TSharedRef<IHttpRequest, ESPMode::ThreadSafe> UWonderlandJuliusStreamSubsystem::NewRequest(const FString& Verb, const FString& Url) const
{
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(Url);
	Request->SetVerb(Verb);
	const FString Token = TokenSource.IsValid() ? TokenSource->CurrentToken() : FString();
	if (!Token.IsEmpty())
	{
		// NO ORIGIN HEADER, ever. A native client is not a web page and does not pretend to be one; the bridge
		// verifies an originless caller as a native session and nothing else.
		Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Relay-Session %s"), *Token));
	}
	return Request;
}

void UWonderlandJuliusStreamSubsystem::SetLink(EWonderlandLinkState State, const FString& Explanation)
{
	UWonderlandJuliusSubsystem* Julius = World();
	if (Julius == nullptr)
	{
		return;
	}
	FWonderlandLinkStatus Status = Julius->GetLinkStatus();
	Status.State = State;
	Status.Explanation = Explanation;
	if (State == EWonderlandLinkState::Live)
	{
		Status.LastSnapshotAtIso.bKnown = true;
		Status.LastSnapshotAtIso.Value = FDateTime::UtcNow().ToIso8601();
	}
	Julius->SetLinkStatus(Status);
}

void UWonderlandJuliusStreamSubsystem::Pair(const FString& Code)
{
	const FString Base = BridgeUrl();
	if (Base.IsEmpty())
	{
		UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: set wl.Julius.Bridge.Url before pairing."));
		return;
	}
	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("code"), Code.TrimStartAndEnd());
	FString Payload;
	WonderlandJuliusStreamLogic::Json::Serialize(Body, Payload);

	// Pairing carries no session of its own -- it is how this client gets one.
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(Base + TEXT("/relay-api/wonderland/native/session"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(Payload);
	SetLink(EWonderlandLinkState::Pairing, TEXT("Redeeming the pairing code from the Wonderland website."));
	InFlight.Add(Request);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		const int32 Status = Response.IsValid() ? Response->GetResponseCode() : 0;
		const TSharedPtr<FJsonObject> Parsed = (bConnected && Status == 200 && Response.IsValid())
			? WonderlandJuliusStreamLogic::Json::DataOf(Response->GetContentAsString()) : nullptr;
		FString Token;
		if (!Parsed.IsValid() || !Parsed->TryGetStringField(TEXT("token"), Token) || Token.IsEmpty())
		{
			// One answer for every way a code can be wrong, as the bridge gives -- and nothing about the mission.
			SetLink(EWonderlandLinkState::SessionExpired,
				TEXT("That pairing code did not work (invalid, expired or already used). Pair again from the website."));
			UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: pairing refused (HTTP %d)."), Status);
			return;
		}
		Paired->Adopt(Token);
		TokenSource = Paired;
		FString Participant;
		Parsed->TryGetStringField(TEXT("participantId"), Participant);
		UE_LOG(LogWonderlandJuliusStream, Display, TEXT("JULIUS STREAM: paired as %s."), *Participant);
		// A new identity reads the run again from durable state rather than trusting what an old one saw.
		if (Phase != EPhase::Idle)
		{
			Phase = EPhase::Hydrating;
			NextAttemptAt = 0.0;
			Failures = 0;
		}
	});
	Request->ProcessRequest();
}

void UWonderlandJuliusStreamSubsystem::Follow(const FString& InProjectId, const FString& InRunId)
{
	UWonderlandJuliusSubsystem* Julius = World();
	if (Julius == nullptr)
	{
		return;
	}
	// A DIFFERENT RUN IS A DIFFERENT WORLD. What was held for another run must not survive into this one, and the
	// subsystem refuses a hydration for a run other than the one it holds.
	//
	// The subsystem resets itself -- a fresh cursor, its held state cleared -- when its PROJECT changes, and exposes
	// no public way to switch RUNS within one project (ClearHeldState is private, deliberately). So a switch unbinds
	// and rebinds, which asks for a fresh world through the public API alone. Both calls run here, synchronously, so
	// no envelope can land between them. A first-class "follow this run" on the subsystem would say this more
	// directly; that is its owner's to add.
	const bool bSwitching = !ProjectId.IsEmpty() && (ProjectId != InProjectId || RunId != InRunId);
	ProjectId = InProjectId;
	RunId = InRunId;
	if (bSwitching)
	{
		Julius->BindProject(FString());
	}
	Julius->BindProject(ProjectId);
	Phase = EPhase::Hydrating;
	Failures = 0;
	NextAttemptAt = 0.0;
}

void UWonderlandJuliusStreamSubsystem::Stop()
{
	Phase = EPhase::Idle;
	// The world keeps what it last knew, and says plainly that it is no longer being kept current.
	SetLink(EWonderlandLinkState::Stale, TEXT("Not following this run. What is shown is what was last known."));
}

bool UWonderlandJuliusStreamSubsystem::Tick(float DeltaSeconds)
{
	if (Phase == EPhase::Idle || bInFlight || FPlatformTime::Seconds() < NextAttemptAt)
	{
		return true;
	}
	if (BridgeUrl().IsEmpty())
	{
		SetLink(EWonderlandLinkState::NeverConnected, TEXT("No bridge is configured (wl.Julius.Bridge.Url)."));
		NextAttemptAt = FPlatformTime::Seconds() + WonderlandJuliusStreamTuning::CVarUnpairedSeconds.GetValueOnGameThread();
		return true;
	}
	if (!TokenSource.IsValid() || TokenSource->CurrentToken().IsEmpty())
	{
		SetLink(EWonderlandLinkState::Pairing,
			TEXT("This desktop client is not paired. Pair it from the signed-in Wonderland website (wl.Julius.Pair <code>)."));
		NextAttemptAt = FPlatformTime::Seconds() + WonderlandJuliusStreamTuning::CVarUnpairedSeconds.GetValueOnGameThread();
		return true;
	}
	if (Phase == EPhase::Hydrating)
	{
		Hydrate();
	}
	else
	{
		ReadPage();
	}
	return true;
}

void UWonderlandJuliusStreamSubsystem::Hydrate()
{
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
		NewRequest(TEXT("GET"), BridgeUrl() + TEXT("/relay-api/wonderland/julius/hydrate?") + RunQuery(0));
	bInFlight = true;
	InFlight.Add(Request);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		bInFlight = false;
		const int32 Status = Response.IsValid() ? Response->GetResponseCode() : 0;
		if (!bConnected || Status != 200 || !Response.IsValid())
		{
			Failed(Status, bConnected, TEXT("hydrate"));
			return;
		}
		FString Inner;
		if (!WonderlandJuliusStreamLogic::UnwrapData(Response->GetContentAsString(), Inner))
		{
			Failed(Status, bConnected, TEXT("hydrate (not a hydration)"));
			return;
		}
		const FTCHARToUTF8 Utf8(*Inner);
		const FWonderlandHydrationDecode Decoded = WonderlandDecodeHydrationBytes(Utf8.Get(), Utf8.Length());
		if (!Decoded.bOk)
		{
			UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: hydration refused by the decoder (error %d at %s)."),
				static_cast<int32>(Decoded.Refusal.Error), *Decoded.Refusal.Field);
			Failed(Status, bConnected, TEXT("hydrate (decoder refused)"));
			return;
		}
		UWonderlandJuliusSubsystem* Julius = World();
		if (Julius == nullptr || !Julius->AdoptHydration(Decoded.Hydration))
		{
			// The subsystem refused it: another project, another run, or an older revision than it already holds. That
			// is a world protecting what it knows, not a failure of the mission; read again after a pause.
			Failed(Status, bConnected, TEXT("hydrate (subsystem refused)"));
			return;
		}
		Failures = 0;
		Phase = EPhase::Following;
		NextAttemptAt = 0.0;
		SetLink(EWonderlandLinkState::Live, FString::Printf(TEXT("Following %s from durable state."), *RunId));
	});
	Request->ProcessRequest();
}

void UWonderlandJuliusStreamSubsystem::ReadPage()
{
	UWonderlandJuliusSubsystem* Julius = World();
	if (Julius == nullptr)
	{
		return;
	}
	const int64 Cursor = Julius->GetResumeAfterSequence();
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest(TEXT("GET"),
		BridgeUrl() + TEXT("/relay-api/wonderland/julius/events?mode=page&") + RunQuery(Cursor));
	bInFlight = true;
	InFlight.Add(Request);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, Cursor](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		bInFlight = false;
		const int32 Status = Response.IsValid() ? Response->GetResponseCode() : 0;
		if (!bConnected || Status != 200 || !Response.IsValid())
		{
			Failed(Status, bConnected, TEXT("events"));
			return;
		}
		TArray<FString> Deliveries;
		int64 NextCursor = 0;
		if (!WonderlandJuliusStreamLogic::SplitPage(Response->GetContentAsString(), Deliveries, NextCursor))
		{
			Failed(Status, bConnected, TEXT("events (not a page)"));
			return;
		}
		UWonderlandJuliusSubsystem* Julius = World();
		if (Julius == nullptr)
		{
			return;
		}
		for (const FString& One : Deliveries)
		{
			const FTCHARToUTF8 Utf8(*One);
			const FWonderlandDeliveryDecode Decoded = WonderlandDecodeDeliveryBytes(Utf8.Get(), Utf8.Length());
			if (!Decoded.bOk)
			{
				// STOP AT THE FIRST ONE THAT DOES NOT DECODE. Applying what follows would move the cursor past an event
				// the world never showed; hydrating again recovers the true state instead.
				UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: a delivery was refused by the decoder (error %d at %s)."),
					static_cast<int32>(Decoded.Refusal.Error), *Decoded.Refusal.Field);
				Failed(Status, bConnected, TEXT("events (decoder refused)"));
				return;
			}
			// Duplicates, stale sequences and replays are the SUBSYSTEM's to refuse, by its ordering rule; offering one
			// twice is harmless by design, which is what makes a retry safe.
			Julius->ApplyEnvelope(Decoded.Envelope,
				WonderlandJuliusStreamLogic::EmbodimentFromEnvelope(Decoded.Envelope), Decoded.Activity);
			++EnvelopesOffered;
		}
		++PagesRead;
		Failures = 0;
		// READ AGAIN AT ONCE ONLY IF THE WORLD MOVED FORWARD. A page that advanced the subsystem's cursor may have more
		// behind it, so a long backlog drains without waiting a poll per page. A page that did NOT advance it --
		// everything in it a duplicate or refused -- must wait a full poll: re-reading at once would ask for the same
		// page forever, a tight loop against the bridge with nothing to show for it.
		const bool bAdvanced = Julius->GetResumeAfterSequence() > Cursor;
		NextAttemptAt = FPlatformTime::Seconds() + (bAdvanced
			? 0.0 : static_cast<double>(WonderlandJuliusStreamTuning::CVarPollSeconds.GetValueOnGameThread()));
		(void)NextCursor; // The ledger position is the server's; the WORLD resumes from its own applied cursor.
		SetLink(EWonderlandLinkState::Live, FString::Printf(TEXT("Following %s."), *RunId));
	});
	Request->ProcessRequest();
}

void UWonderlandJuliusStreamSubsystem::Failed(int32 HttpStatus, bool bConnected, const TCHAR* During)
{
	++Failures;
	const EWonderlandLinkState State = WonderlandJuliusStreamLogic::LinkStateForFailure(HttpStatus, bConnected);
	if (State == EWonderlandLinkState::SessionExpired && TokenSource.IsValid())
	{
		TokenSource->Invalidate();
	}
	// RECONNECT MEANS HYDRATE AGAIN. Whatever was missed while the link was down is recovered from durable state,
	// not guessed at; the cursor then resumes from where that hydration left it.
	Phase = EPhase::Hydrating;
	const float Wait = WonderlandJuliusStreamLogic::BackoffSeconds(Failures);
	NextAttemptAt = FPlatformTime::Seconds() + Wait;
	const FString Why = State == EWonderlandLinkState::SessionExpired
		? FString(TEXT("The bridge no longer accepts this client's session. Pair again from the website."))
		: State == EWonderlandLinkState::Refused
		? FString::Printf(TEXT("The bridge refused this player for this run (HTTP %d)."), HttpStatus)
		: FString::Printf(TEXT("Cannot see the run right now (%s, HTTP %d). Showing what was last known; retrying in %.0fs."),
			During, HttpStatus, Wait);
	SetLink(State, Why);
	UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: %s"), *Why);
}

FString UWonderlandJuliusStreamSubsystem::GetAdoptedRunId() const
{
	const UWonderlandJuliusSubsystem* Julius = World();
	if (Julius == nullptr || !Julius->HasState())
	{
		return FString();
	}
	const FWonderlandText& Adopted = Julius->GetCursor().RunId;
	return Adopted.bKnown ? Adopted.Value : FString();
}

FString UWonderlandJuliusStreamSubsystem::GetJuliusRunState() const
{
	const UWonderlandJuliusSubsystem* Julius = World();
	if (Julius == nullptr)
	{
		return FString();
	}
	const FWonderlandJuliusEmbodiment& Embodiment = Julius->GetEmbodiment();
	return Embodiment.StateSource == EWonderlandJuliusStateSource::JuliusRunState && Embodiment.SourceState.bKnown
		? Embodiment.SourceState.Value : FString();
}

FString UWonderlandJuliusStreamSubsystem::GetMissionContractState() const
{
	const FString JuliusState = GetJuliusRunState();
	EWonderlandTaskState TaskState = EWonderlandTaskState::Draft;
	return !JuliusState.IsEmpty() && WonderlandJuliusTaskState::TaskStateForJuliusState(JuliusState, TaskState)
		? FString(WonderlandTaskStateName(TaskState)) : FString();
}

FString UWonderlandJuliusStreamSubsystem::Describe() const
{
	const UWonderlandJuliusSubsystem* Julius = World();
	const TCHAR* PhaseName = Phase == EPhase::Idle ? TEXT("idle") : Phase == EPhase::Hydrating ? TEXT("hydrating") : TEXT("following");
	// WHAT THE MISSION CONTRACT SHOULD SHOW for this run, by the engine's copy of the Julius -> task-state table. Only
	// when the world's state really came from Julius's own run row: a relay phase or an event type is a different
	// vocabulary, and mapping it here would be deriving a conclusion Julius did not reach.
	FString JuliusState = TEXT("unknown");
	FString ContractState = TEXT("unknown");
	if (Julius != nullptr)
	{
		const FWonderlandJuliusEmbodiment& Embodiment = Julius->GetEmbodiment();
		if (Embodiment.StateSource == EWonderlandJuliusStateSource::JuliusRunState && Embodiment.SourceState.bKnown)
		{
			JuliusState = Embodiment.SourceState.Value;
			EWonderlandTaskState TaskState = EWonderlandTaskState::Draft;
			if (WonderlandJuliusTaskState::TaskStateForJuliusState(JuliusState, TaskState))
			{
				ContractState = WonderlandTaskStateName(TaskState);
			}
		}
	}
	return FString::Printf(TEXT("JULIUS STREAM: %s | julius=%s | contract=%s | bridge=%s | project=%s | run=%s | paired=%s | cursor=%lld | pages=%lld | offered=%lld | failures=%d | link=%s"),
		PhaseName,
		*JuliusState,
		*ContractState,
		BridgeUrl().IsEmpty() ? TEXT("(unset)") : *BridgeUrl(),
		ProjectId.IsEmpty() ? TEXT("-") : *ProjectId,
		RunId.IsEmpty() ? TEXT("-") : *RunId,
		(TokenSource.IsValid() && !TokenSource->CurrentToken().IsEmpty()) ? TEXT("yes") : TEXT("no"),
		Julius != nullptr ? Julius->GetResumeAfterSequence() : -1LL,
		PagesRead, EnvelopesOffered, Failures,
		Julius != nullptr ? *Julius->GetLinkStatus().Explanation : TEXT("-"));
}

/* ============================================================================================== the console */

namespace WonderlandJuliusStreamConsole
{
	void Say(const FString& Text)
	{
		UE_LOG(LogWonderlandJuliusStream, Display, TEXT("%s"), *Text);
		GAreScreenMessagesEnabled = true;
		if (GEngine != nullptr)
		{
			GEngine->bEnableOnScreenDebugMessages = true;
			GEngine->AddOnScreenDebugMessage(INDEX_NONE, 8.0f, FColor(255, 212, 0), Text);
		}
	}

	int32 ForEachLive(TFunctionRef<void(UWonderlandJuliusStreamSubsystem&)> Body)
	{
		int32 Found = 0;
		for (TObjectIterator<UWonderlandJuliusStreamSubsystem> It; It; ++It)
		{
			if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject) && It->GetWorld() != nullptr && It->GetWorld()->IsGameWorld())
			{
				Body(**It);
				++Found;
			}
		}
		if (Found == 0)
		{
			Say(TEXT("JULIUS STREAM: nothing to do -- press Play first (these commands work on the running game)."));
		}
		return Found;
	}

	FAutoConsoleCommand CmdPair(TEXT("wl.Julius.Pair"),
		TEXT("Pair this desktop client with the code shown on the signed-in Wonderland website: `wl.Julius.Pair <code>`."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() < 1)
			{
				Say(TEXT("JULIUS STREAM: usage -- wl.Julius.Pair <code>"));
				return;
			}
			ForEachLive([&Args](UWonderlandJuliusStreamSubsystem& Stream) { Stream.Pair(Args[0]); });
		}));

	FAutoConsoleCommand CmdFollow(TEXT("wl.Julius.Follow"),
		TEXT("Follow exactly one Julius run: `wl.Julius.Follow <projectId> <runId>` -- the runId Julius returned."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() < 2)
			{
				Say(TEXT("JULIUS STREAM: usage -- wl.Julius.Follow <projectId> <runId>"));
				return;
			}
			ForEachLive([&Args](UWonderlandJuliusStreamSubsystem& Stream)
			{
				Stream.Follow(Args[0], Args[1]);
				Say(FString::Printf(TEXT("JULIUS STREAM: following %s in %s."), *Args[1], *Args[0]));
			});
		}));

	FAutoConsoleCommand CmdStop(TEXT("wl.Julius.Stop"),
		TEXT("Stop following the run. The world keeps what it last knew and says the link is stale."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>&)
		{
			ForEachLive([](UWonderlandJuliusStreamSubsystem& Stream) { Stream.Stop(); });
		}));

	FAutoConsoleCommand CmdDescribe(TEXT("wl.Julius.Stream"),
		TEXT("Say what the Julius stream is doing, and why."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>&)
		{
			ForEachLive([](UWonderlandJuliusStreamSubsystem& Stream) { Say(Stream.Describe()); });
		}));
}

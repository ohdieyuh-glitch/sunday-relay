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
#include "Engine/LocalPlayer.h"
#include "WonderlandJuliusSubsystem.h"
#include "WonderlandJuliusTaskState.h"
#include "WonderlandMissionHandoff.h"
#include "WonderlandMissionTasks.h"
#include "WonderlandWireDecode.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandJuliusStream, Log, All);

namespace WonderlandJuliusStreamTuning
{
	TAutoConsoleVariable<FString> CVarBridgeUrl(TEXT("wl.Julius.Bridge.Url"), TEXT(""),
		TEXT("Julius stream: the Relay bridge this world follows a run on, e.g. http://127.0.0.1:8796. Overrides the "
			"project's Wonderland Julius Link setting; when both are empty the world follows nothing and says so."));
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

	FString ResolveBridgeUrl(const FString& CvarValue, const FString& SettingValue, FString& OutProblem)
	{
		OutProblem.Reset();
		// The cvar is a developer's override; a packaged build has no console and reads the project setting.
		FString Url = CvarValue.TrimStartAndEnd();
		if (Url.IsEmpty())
		{
			Url = SettingValue.TrimStartAndEnd();
		}
		while (Url.EndsWith(TEXT("/")))
		{
			Url.LeftChopInline(1);
		}
		if (Url.IsEmpty())
		{
			return FString();
		}
		if (Url.StartsWith(TEXT("https://"), ESearchCase::IgnoreCase) && Url.Len() > 8)
		{
			return Url;
		}
		if (Url.StartsWith(TEXT("http://"), ESearchCase::IgnoreCase))
		{
			// THE HOST, up to a port or a path. "[::1]" keeps its brackets.
			const FString Rest = Url.Mid(7);
			FString Host = Rest;
			int32 Cut = INDEX_NONE;
			if (Rest.StartsWith(TEXT("[")))
			{
				Cut = Rest.Find(TEXT("]"));
				Host = Cut == INDEX_NONE ? Rest : Rest.Left(Cut + 1);
			}
			else
			{
				for (int32 Index = 0; Index < Rest.Len(); ++Index)
				{
					if (Rest[Index] == TEXT(':') || Rest[Index] == TEXT('/'))
					{
						Host = Rest.Left(Index);
						break;
					}
				}
			}
			if (Host.Equals(TEXT("127.0.0.1")) || Host.Equals(TEXT("localhost"), ESearchCase::IgnoreCase) || Host.Equals(TEXT("[::1]")))
			{
				return Url;
			}
			OutProblem = FString::Printf(TEXT("Refusing %s: plain http to a bridge off this machine would send this client's session in the clear. Use https."), *Url);
			return FString();
		}
		OutProblem = FString::Printf(TEXT("Refusing %s: a bridge is an http(s) URL."), *Url);
		return FString();
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

	bool ParseResult(const FString& Body, FWonderlandJuliusResultReading& Out)
	{
		const TSharedPtr<FJsonObject> Data = Json::DataOf(Body);
		if (!Data.IsValid())
		{
			return false;
		}
		// THE SHAPE IS THE PROJECTION'S OWN, and anything else is refused whole. A partial read would show a result
		// with holes in it that look like answers -- "0 of 0 criteria met" from a body that simply lacked the list.
		FWonderlandJuliusResultReading Read;
		FString Schema;
		const TArray<TSharedPtr<FJsonValue>>* Criteria = nullptr;
		const TArray<TSharedPtr<FJsonValue>>* Deliverables = nullptr;
		const TArray<TSharedPtr<FJsonValue>>* Findings = nullptr;
		const TSharedPtr<FJsonObject>* Cost = nullptr;
		if (!Data->TryGetStringField(TEXT("schemaVersion"), Schema) || Schema != TEXT("relay-wonderland-julius-result.v1")
			|| !Data->TryGetStringField(TEXT("runId"), Read.RunId) || Read.RunId.IsEmpty()
			|| !Data->TryGetStringField(TEXT("juliusState"), Read.JuliusState)
			|| !Data->TryGetBoolField(TEXT("verified"), Read.bVerified)
			|| !Data->TryGetBoolField(TEXT("terminal"), Read.bTerminal)
			|| !Data->TryGetArrayField(TEXT("criteria"), Criteria) || Criteria == nullptr
			|| !Data->TryGetArrayField(TEXT("deliverables"), Deliverables) || Deliverables == nullptr
			|| !Data->TryGetArrayField(TEXT("openFindings"), Findings) || Findings == nullptr
			|| !Data->TryGetObjectField(TEXT("cost"), Cost) || Cost == nullptr || !Cost->IsValid()
			|| !(*Cost)->TryGetBoolField(TEXT("visible"), Read.bCostVisible))
		{
			return false;
		}
		// A null taskState is "no mapping", and stays empty.
		Data->TryGetStringField(TEXT("taskState"), Read.TaskState);
		for (const TSharedPtr<FJsonValue>& Value : *Criteria)
		{
			const TSharedPtr<FJsonObject>* Criterion = nullptr;
			bool bSatisfied = false;
			if (!Value.IsValid() || !Value->TryGetObject(Criterion) || Criterion == nullptr
				|| !(*Criterion)->TryGetBoolField(TEXT("satisfied"), bSatisfied))
			{
				return false;
			}
			++Read.CriteriaTotal;
			Read.CriteriaMet += bSatisfied ? 1 : 0;
		}
		for (const TSharedPtr<FJsonValue>& Value : *Deliverables)
		{
			const TSharedPtr<FJsonObject>* Deliverable = nullptr;
			FString EvidenceId;
			if (!Value.IsValid() || !Value->TryGetObject(Deliverable) || Deliverable == nullptr
				|| !(*Deliverable)->TryGetStringField(TEXT("evidenceId"), EvidenceId))
			{
				return false;
			}
			Read.DeliverableIds.Add(EvidenceId);
		}
		Read.OpenFindings = Findings->Num();
		const TSharedPtr<FJsonObject>* Review = nullptr;
		if (Data->TryGetObjectField(TEXT("review"), Review) && Review != nullptr && Review->IsValid())
		{
			(*Review)->TryGetStringField(TEXT("verdict"), Read.Verdict);
			(*Review)->TryGetNumberField(TEXT("repairRounds"), Read.RepairRounds);
			(*Review)->TryGetBoolField(TEXT("reReviewedAfterRepair"), Read.bReReviewedAfterRepair);
		}
		// A null failure is "no failure"; TryGetObjectField is false for it and the reason stays empty.
		const TSharedPtr<FJsonObject>* Failure = nullptr;
		if (Data->TryGetObjectField(TEXT("failure"), Failure) && Failure != nullptr && Failure->IsValid())
		{
			(*Failure)->TryGetStringField(TEXT("reasonCode"), Read.FailureReason);
			(*Failure)->TryGetStringField(TEXT("failureClass"), Read.FailureClass);
		}
		// THE COST ONLY WHEN THIS PLAYER MAY SEE IT, and then all three parts or none: a figure without whether it is
		// complete would be read as a total when it may be a floor.
		if (Read.bCostVisible
			&& (!(*Cost)->TryGetNumberField(TEXT("knownUsdMicros"), Read.CostKnownUsdMicros)
				|| !(*Cost)->TryGetNumberField(TEXT("unknownComponents"), Read.CostUnknownComponents)
				|| !(*Cost)->TryGetBoolField(TEXT("complete"), Read.bCostComplete)))
		{
			return false;
		}
		Data->TryGetStringField(TEXT("tokens"), Read.Tokens);
		Data->TryGetNumberField(TEXT("withheldDetails"), Read.WithheldDetails);
		Read.bKnown = true;
		Out = MoveTemp(Read);
		return true;
	}

	FString CreationRefusalSentence(const FString& Kind)
	{
		// The bridge's own kinds first, then the client's (refused before anything was sent).
		if (Kind == TEXT("execution_not_configured"))
		{
			return TEXT("This project has no execution profile yet: an operator must set where its missions may run.");
		}
		if (Kind == TEXT("execution_disabled"))
		{
			return TEXT("An operator has switched off mission creation for this project.");
		}
		if (Kind == TEXT("not_authorized"))
		{
			return TEXT("Only the project's owner can create a mission.");
		}
		if (Kind == TEXT("session_invalid") || Kind == TEXT("not_paired"))
		{
			return TEXT("This desktop client is not paired, or its session has ended: pair again from the website.");
		}
		if (Kind == TEXT("not_paired_for_a_project"))
		{
			return TEXT("This desktop client's pairing names no project: pair it again for the project.");
		}
		if (Kind == TEXT("forbidden_field"))
		{
			return TEXT("The request carried a field only an operator may set.");
		}
		if (Kind == TEXT("malformed_mission") || Kind == TEXT("criteria_mismatch"))
		{
			return TEXT("The mission is incomplete: it needs an objective and at least one acceptance criterion.");
		}
		if (Kind == TEXT("idempotency_key_required"))
		{
			return TEXT("The request had no key of its own, so a retry could not be told from a second mission.");
		}
		if (Kind == TEXT("no_bridge"))
		{
			return TEXT("No bridge is configured for this build.");
		}
		if (Kind == TEXT("no_connection") || Kind == TEXT("unavailable") || Kind.StartsWith(TEXT("execution_profile_store"))
			|| Kind.StartsWith(TEXT("mission_contract_store")) || Kind == TEXT("julius_state_unavailable"))
		{
			return TEXT("The bridge could not answer; nothing was created. Try again.");
		}
		if (Kind == TEXT("mission_run_already_active"))
		{
			return TEXT("That key already names a different mission that is still running.");
		}
		return FString::Printf(TEXT("The bridge refused it (%s)."), *Kind);
	}

	FString ResultHeadline(const FWonderlandJuliusResultReading& Result)
	{
		if (!Result.bKnown)
		{
			return FString();
		}
		const FString Criteria = FString::Printf(TEXT("%d of %d criteria met"), Result.CriteriaMet, Result.CriteriaTotal);
		if (!Result.bTerminal)
		{
			// NOT A RESULT YET: what is true so far, and labelled so. No verdict is printed before Julius gives one.
			return FString::Printf(TEXT("not final · %s"), *Criteria);
		}
		FString Line = FString::Printf(TEXT("%s · %s"), Result.bVerified ? TEXT("VERIFIED") : TEXT("NOT VERIFIED"), *Criteria);
		if (!Result.FailureReason.IsEmpty())
		{
			Line += FString::Printf(TEXT(" · %s"), *Result.FailureReason);
		}
		return Line;
	}

	FString ResultDetail(const FWonderlandJuliusResultReading& Result)
	{
		if (!Result.bKnown)
		{
			return FString();
		}
		TArray<FString> Parts;
		const int32 Made = Result.DeliverableIds.Num();
		Parts.Add(Made > 0 ? FString::Printf(TEXT("%d made"), Made)
			: FString(Result.bTerminal ? TEXT("nothing made") : TEXT("nothing made yet")));
		Parts.Add(Result.OpenFindings == 0 ? FString(TEXT("no open findings"))
			: FString::Printf(TEXT("%d open finding%s"), Result.OpenFindings, Result.OpenFindings == 1 ? TEXT("") : TEXT("s")));
		FString Review = Result.Verdict.IsEmpty() ? FString(TEXT("review: none yet")) : FString::Printf(TEXT("review: %s"), *Result.Verdict);
		if (Result.RepairRounds > 0)
		{
			Review += FString::Printf(TEXT(" after %d repair%s, %s"), Result.RepairRounds, Result.RepairRounds == 1 ? TEXT("") : TEXT("s"),
				Result.bReReviewedAfterRepair ? TEXT("re-reviewed") : TEXT("awaiting re-review"));
		}
		Parts.Add(Review);
		if (!Result.Tokens.IsEmpty())
		{
			Parts.Add(FString::Printf(TEXT("tokens %s"), *Result.Tokens));
		}
		// Only a role that may see the cost is given one, and a floor never reads as a total.
		if (Result.bCostVisible)
		{
			const double Usd = static_cast<double>(Result.CostKnownUsdMicros) / 1000000.0;
			Parts.Add(Result.bCostComplete ? FString::Printf(TEXT("cost $%.4f"), Usd) : FString::Printf(TEXT("cost at least $%.4f"), Usd));
		}
		return FString::Join(Parts, TEXT(" · "));
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
	FString Problem;
	return WonderlandJuliusStreamLogic::ResolveBridgeUrl(WonderlandJuliusStreamTuning::CVarBridgeUrl.GetValueOnGameThread(),
		GetDefault<UWonderlandJuliusLinkSettings>()->BridgeUrl, Problem);
}

FString UWonderlandJuliusStreamSubsystem::BridgeProblem() const
{
	FString Problem;
	WonderlandJuliusStreamLogic::ResolveBridgeUrl(WonderlandJuliusStreamTuning::CVarBridgeUrl.GetValueOnGameThread(),
		GetDefault<UWonderlandJuliusLinkSettings>()->BridgeUrl, Problem);
	return Problem;
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
	// ANYTHING BUT A READ IS SENT TO JULIUS: a write the Mission Handoff path must never make (the write spy)
	if (!Verb.Equals(TEXT("GET"), ESearchCase::IgnoreCase))
	{
		FWonderlandMissionHandoff::NoteMutation(TEXT("UWonderlandJuliusStreamSubsystem::NewRequest (a Julius send)"));
	}
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
		const FString Problem = BridgeProblem();
		UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: no usable bridge -- %s"), Problem.IsEmpty()
			? TEXT("set Project Settings > Wonderland Julius Link, or wl.Julius.Bridge.Url, before pairing.") : *Problem);
		return;
	}
	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("code"), Code.TrimStartAndEnd());
	FString Payload;
	WonderlandJuliusStreamLogic::Json::Serialize(Body, Payload);

	// Pairing carries no session of its own -- it is how this client gets one.
	FWonderlandMissionHandoff::NoteMutation(TEXT("UWonderlandJuliusStreamSubsystem pairing (a Julius send)"));
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
		// THE PROJECT THIS SESSION IS BOUND TO, as the bridge states it (founder decision 2). A mission is created in
		// this project and no other; a session that names none cannot create at all.
		PairedProjectId.Reset();
		Parsed->TryGetStringField(TEXT("projectId"), PairedProjectId);
		UE_LOG(LogWonderlandJuliusStream, Display, TEXT("JULIUS STREAM: paired as %s for %s."), *Participant,
			PairedProjectId.IsEmpty() ? TEXT("no project") : *PairedProjectId);
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
	if (RunId != InRunId || ProjectId != InProjectId)
	{
		// Another run's result describes another run. HasResult() would refuse it anyway; forgetting it is plainer.
		Result = FWonderlandJuliusResultReading();
		ResultReadFor.Reset();
		ResultFailures = 0;
		NextResultAt = 0.0;
	}
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
	// The result has its own request and its own clock, so it neither waits for a page nor holds one up.
	TickResult();
	if (Phase == EPhase::Idle || bInFlight || FPlatformTime::Seconds() < NextAttemptAt)
	{
		return true;
	}
	if (BridgeUrl().IsEmpty())
	{
		// NOT CONFIGURED and CONFIGURED-BUT-REFUSED are different facts, and the link says which.
		const FString Problem = BridgeProblem();
		SetLink(EWonderlandLinkState::NeverConnected, Problem.IsEmpty()
			? FString(TEXT("No bridge is configured (Project Settings > Wonderland Julius Link, or wl.Julius.Bridge.Url)."))
			: Problem);
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
		ShowOnMissionContract(true);
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
		if (bAdvanced)
		{
			ShowOnMissionContract(false);
		}
		(void)NextCursor; // The ledger position is the server's; the WORLD resumes from its own applied cursor.
		SetLink(EWonderlandLinkState::Live, FString::Printf(TEXT("Following %s."), *RunId));
	});
	Request->ProcessRequest();
}

void UWonderlandJuliusStreamSubsystem::TickResult()
{
	if (Phase != EPhase::Following || bResultInFlight || FPlatformTime::Seconds() < NextResultAt
		|| BridgeUrl().IsEmpty() || !TokenSource.IsValid() || TokenSource->CurrentToken().IsEmpty())
	{
		return;
	}
	// ONLY A RUN THE WORLD HOLDS. A result for a run it has not adopted would describe something that is not on screen.
	if (RunId.IsEmpty() || GetAdoptedRunId() != RunId)
	{
		return;
	}
	const FString ReadFor = RunId + TEXT("|") + GetJuliusRunState();
	if (ReadFor != ResultReadFor)
	{
		RequestResult(ReadFor);
	}
}

void UWonderlandJuliusStreamSubsystem::RequestResult(const FString& ReadFor)
{
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request =
		NewRequest(TEXT("GET"), BridgeUrl() + TEXT("/relay-api/wonderland/julius/result?") + RunQuery(0));
	bResultInFlight = true;
	InFlight.Add(Request);
	const FString AskedRun = RunId;
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, ReadFor, AskedRun](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		bResultInFlight = false;
		// THE RUN MAY HAVE CHANGED WHILE THIS WAS IN FLIGHT, and a result for the previous one is not this one's.
		if (AskedRun != RunId)
		{
			return;
		}
		const int32 Status = Response.IsValid() ? Response->GetResponseCode() : 0;
		FWonderlandJuliusResultReading Read;
		const bool bRead = bConnected && Status == 200 && Response.IsValid()
			&& WonderlandJuliusStreamLogic::ParseResult(Response->GetContentAsString(), Read);
		if (!bRead || Read.RunId != AskedRun)
		{
			// NOT A LINK FAILURE. The run is still followed perfectly well; only its result could not be read, so the
			// link state is left alone and the result is asked for again after a pause.
			++ResultFailures;
			NextResultAt = FPlatformTime::Seconds() + WonderlandJuliusStreamLogic::BackoffSeconds(ResultFailures);
			UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: the run's result could not be read (HTTP %d); the follow is unaffected."), Status);
			return;
		}
		ResultFailures = 0;
		Result = MoveTemp(Read);
		ResultReadFor = ReadFor;
		UE_LOG(LogWonderlandJuliusStream, Log, TEXT("JULIUS STREAM: result for %s -- %s"), *AskedRun,
			*WonderlandJuliusStreamLogic::ResultHeadline(Result));
	});
	Request->ProcessRequest();
}

void UWonderlandJuliusStreamSubsystem::CreateMission(const FString& IdempotencyKey,
	const FString& Objective, const TArray<FString>& Requirements, const TArray<FString>& Constraints,
	const TArray<FString>& CriterionIds, const TArray<FString>& CriterionTexts, const TArray<bool>& CriterionBlocking)
{
	LastCreatedRunId.Reset();
	LastCreatedMissionId.Reset();
	LastCreationRefusal.Reset();
	LastCreationStatus = 0;
	// REFUSED HERE, BEFORE ANYTHING IS SENT, each for its own reason -- never collapsed into one "failed". A refusal
	// here, like one from the bridge, creates nothing, follows nothing, and leaves the world on what it was showing.
	const auto RefuseLocally = [this](const TCHAR* Kind)
	{
		LastCreationRefusal = Kind;
		++CreationGeneration;
		UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: mission not created (%s; nothing was sent)."), Kind);
	};
	const FString Base = BridgeUrl();
	if (Base.IsEmpty())
	{
		RefuseLocally(TEXT("no_bridge"));
		return;
	}
	if (!IsPaired())
	{
		RefuseLocally(TEXT("not_paired"));
		return;
	}
	// THE PROJECT COMES FROM PAIRING: the session is bound to it, and a client never names another.
	if (PairedProjectId.IsEmpty())
	{
		RefuseLocally(TEXT("not_paired_for_a_project"));
		return;
	}
	if (CriterionIds.Num() != CriterionTexts.Num() || CriterionIds.Num() != CriterionBlocking.Num())
	{
		RefuseLocally(TEXT("criteria_mismatch"));
		return;
	}

	// THE PLAYER'S FOUR FIELDS AND NOTHING ELSE. The bridge refuses any other key by name; this never sends one.
	const auto Lines = [](const TArray<FString>& In)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		for (const FString& Line : In)
		{
			Out.Add(MakeShared<FJsonValueString>(Line));
		}
		return Out;
	};
	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("objective"), Objective);
	Body->SetArrayField(TEXT("requirements"), Lines(Requirements));
	Body->SetArrayField(TEXT("constraints"), Lines(Constraints));
	TArray<TSharedPtr<FJsonValue>> Criteria;
	for (int32 Index = 0; Index < CriterionIds.Num(); ++Index)
	{
		const TSharedPtr<FJsonObject> Criterion = MakeShared<FJsonObject>();
		Criterion->SetStringField(TEXT("id"), CriterionIds[Index]);
		Criterion->SetStringField(TEXT("text"), CriterionTexts[Index]);
		Criterion->SetBoolField(TEXT("blocking"), CriterionBlocking[Index]);
		Criteria.Add(MakeShared<FJsonValueObject>(Criterion));
	}
	Body->SetArrayField(TEXT("acceptanceCriteria"), Criteria);
	FString Payload;
	WonderlandJuliusStreamLogic::Json::Serialize(Body, Payload);

	const FString Project = PairedProjectId;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = NewRequest(TEXT("POST"),
		Base + TEXT("/relay-api/wonderland/julius/missions?projectId=") + FGenericPlatformHttp::UrlEncode(Project));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	// THE CLIENT'S OWN KEY FOR THIS MISSION: sending it again is the same mission, never a second one.
	Request->SetHeader(TEXT("x-relay-idempotency-key"), IdempotencyKey);
	Request->SetContentAsString(Payload);
	LastCreationStatus = -1;
	InFlight.Add(Request);
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, Project](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		InFlight.Remove(Done);
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		LastCreationStatus = Status;
		++CreationGeneration;
		const FString Content = Response.IsValid() ? Response->GetContentAsString() : FString();
		if (Status == 201)
		{
			const TSharedPtr<FJsonObject> Data = WonderlandJuliusStreamLogic::Json::DataOf(Content);
			FString Run;
			FString Mission;
			if (Data.IsValid() && Data->TryGetStringField(TEXT("runId"), Run) && !Run.IsEmpty()
				&& Data->TryGetStringField(TEXT("missionId"), Mission) && !Mission.IsEmpty())
			{
				LastCreatedRunId = Run;
				LastCreatedMissionId = Mission;
				UE_LOG(LogWonderlandJuliusStream, Display, TEXT("JULIUS STREAM: created %s as %s -- following it."), *Mission, *Run);
				// THE WORLD FOLLOWS WHAT ITS PLAYER JUST CREATED -- the run the BRIDGE named, never one derived from the
				// mission id. A retry with the same key is answered with the same run, and following it again is
				// following it once.
				Follow(Project, Run);
				return;
			}
			// A 201 this client cannot read is not a mission it may show.
			LastCreationRefusal = TEXT("unreadable_answer");
			return;
		}
		if (Status == 401 && TokenSource.IsValid())
		{
			// The bridge no longer knows this session (it expired, was revoked, or the bridge restarted). Forget it, as
			// the stream does, so the link says "pair again" instead of retrying a session that cannot work.
			TokenSource->Invalidate();
			SetLink(EWonderlandLinkState::SessionExpired, TEXT("The bridge no longer accepts this client's session. Pair again from the website."));
		}
		// The bridge's own word for the refusal, verbatim; a status with no word is named by its number.
		TSharedPtr<FJsonObject> Root;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Content);
		const TSharedPtr<FJsonObject>* Error = nullptr;
		FString Kind;
		if (FJsonSerializer::Deserialize(Reader, Root) && Root.IsValid() && Root->TryGetObjectField(TEXT("error"), Error)
			&& Error != nullptr && Error->IsValid() && (*Error)->TryGetStringField(TEXT("kind"), Kind) && !Kind.IsEmpty())
		{
			LastCreationRefusal = Kind;
		}
		else
		{
			LastCreationRefusal = bConnected ? FString::Printf(TEXT("http_%d"), Status) : FString(TEXT("no_connection"));
		}
		UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: mission not created (%s, HTTP %d)."), *LastCreationRefusal, Status);
	});
	Request->ProcessRequest();
}

FString UWonderlandJuliusStreamSubsystem::DescribeResult() const
{
	if (!HasResult())
	{
		return FString();
	}
	return WonderlandJuliusStreamLogic::ResultHeadline(Result) + TEXT("\n") + WonderlandJuliusStreamLogic::ResultDetail(Result);
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

UWonderlandMissionTaskSubsystem* UWonderlandJuliusStreamSubsystem::MissionTasks() const
{
	// A LocalPlayer subsystem: which contracts are open is a property of the PLAYER, not of the game instance.
	const UGameInstance* Instance = GetGameInstance();
	ULocalPlayer* Player = Instance != nullptr ? Instance->GetFirstGamePlayer() : nullptr;
	return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
}

void UWonderlandJuliusStreamSubsystem::ContractFollowOnly(const FString& MissionId, const FString& InRunId)
{
	UWonderlandMissionTaskSubsystem* Tasks = MissionTasks();
	if (Tasks == nullptr)
	{
		UE_LOG(LogWonderlandJuliusStream, Warning, TEXT("JULIUS STREAM: contract-follow -- no local player."));
		return;
	}
	FWonderlandText Run;
	Run.bKnown = !InRunId.IsEmpty();
	Run.Value = InRunId;
	const FGuid Shown = Tasks->FollowJuliusRun(MissionId, Run);
	UE_LOG(LogWonderlandJuliusStream, Log, TEXT("JULIUS STREAM: contract-follow %s -> %s (%s)."),
		*MissionId, *InRunId, Shown.IsValid() ? TEXT("shown") : TEXT("not shown"));
}

void UWonderlandJuliusStreamSubsystem::ShowOnMissionContract(bool bAfterHydration)
{
	UWonderlandJuliusSubsystem* Julius = World();
	if (Julius == nullptr || !Julius->HasState())
	{
		return;
	}
	// No player yet (the first frames of play) means nowhere to show it; the next page or hydration tries again.
	UWonderlandMissionTaskSubsystem* Tasks = MissionTasks();
	if (Tasks == nullptr)
	{
		ContractNote = TEXT("no local player to show it to yet");
		return;
	}
	// WHICH MISSION: the one Julius says this run belongs to. Without it there is no contract id to show the run
	// under -- and inventing one (the run id, say) would file it where a later report of the real mission never
	// finds it.
	const FWonderlandText& Mission = Julius->GetEmbodiment().MissionId;
	if (!Mission.bKnown || Mission.Value.IsEmpty())
	{
		ContractNote = TEXT("not shown: Julius has not named this run's mission");
		return;
	}
	const FWonderlandText& Run = Julius->GetCursor().RunId;
	const FGuid Shown = Tasks->FollowJuliusRun(Mission.Value, Run);
	if (!Shown.IsValid())
	{
		// The founder's workspace cap, not a failure to follow: the world still holds the run, and the link is fine.
		ContractNote = TEXT("could not be shown: the workspace is full");
		return;
	}
	if (bAfterHydration)
	{
		// A SNAPSHOT IS A CORRECTION, not a quieter message: what described the previous picture of this run is
		// forgotten before the snapshot's own facts land -- a run switch always arrives this way, because Follow()
		// rebinds and hydrates. The mapped state and the run id are left alone by the task set's design, so the
		// contract never flashes to Draft while the snapshot arrives.
		Tasks->ResetJuliusCarriers(Mission.Value);
	}
	// JULIUS'S OWN WORD travels beside the mapped state, so a state the table does not know is shown verbatim
	// instead of becoming Draft -- the enum's zero member and its most misleading value.
	const FString Raw = GetJuliusRunState();
	FWonderlandText JuliusState;
	JuliusState.bKnown = !Raw.IsEmpty();
	JuliusState.Value = Raw;
	EWonderlandTaskState Mapped = EWonderlandTaskState::Draft;
	const bool bMapped = !Raw.IsEmpty() && WonderlandJuliusTaskState::TaskStateForJuliusState(Raw, Mapped);
	if (!bMapped)
	{
		// No mapping: keep what the contract already shows and hand over the raw word, rather than guess a phase.
		const FWonderlandMissionTask* Existing = Tasks->Find(Shown);
		Mapped = Existing != nullptr ? Existing->State : EWonderlandTaskState::Queued;
	}
	// Tokens and evidence go as UNKNOWN, which leaves any existing assertion alone: no read route serves tokens, and
	// nothing the world reads carries an evidence total.
	const FWonderlandTally Unknown;
	const bool bApplied = Tasks->ApplySchedulerState(Mission.Value, Mapped, Unknown, Unknown, Run, JuliusState);
	ContractNote = bApplied
		? FString::Printf(TEXT("shown as %s (julius %s)"), *FString(WonderlandTaskStateName(Mapped)),
			Raw.IsEmpty() ? TEXT("unknown") : *Raw)
		: FString(TEXT("the task set refused the report"));
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
	// The result goes LAST: proof jobs split this line on the fields before it.
	FString ResultLine = TEXT("not read yet");
	if (HasResult())
	{
		ResultLine = WonderlandJuliusStreamLogic::ResultHeadline(Result);
	}
	else if (ResultFailures > 0)
	{
		ResultLine = FString::Printf(TEXT("not read yet (%d failed reads)"), ResultFailures);
	}
	return FString::Printf(TEXT("JULIUS STREAM: %s | julius=%s | contract=%s | on-contract=%s | bridge=%s | project=%s | run=%s | paired=%s | cursor=%lld | pages=%lld | offered=%lld | failures=%d | link=%s | result=%s"),
		PhaseName,
		*JuliusState,
		*ContractState,
		*ContractNote,
		BridgeUrl().IsEmpty() ? TEXT("(unset)") : *BridgeUrl(),
		ProjectId.IsEmpty() ? TEXT("-") : *ProjectId,
		RunId.IsEmpty() ? TEXT("-") : *RunId,
		(TokenSource.IsValid() && !TokenSource->CurrentToken().IsEmpty()) ? TEXT("yes") : TEXT("no"),
		Julius != nullptr ? Julius->GetResumeAfterSequence() : -1LL,
		PagesRead, EnvelopesOffered, Failures,
		Julius != nullptr ? *Julius->GetLinkStatus().Explanation : TEXT("-"),
		*ResultLine);
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

	FAutoConsoleCommand CmdContractFollow(TEXT("wl.Julius.ContractFollow"),
		TEXT("DIAGNOSTIC: point this player's Mission Contract task for a mission at a run WITHOUT reading the run -- "
			"FollowJuliusRun only, no reset and no report: `wl.Julius.ContractFollow <missionId> <runId>`."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() < 2)
			{
				Say(TEXT("JULIUS STREAM: usage -- wl.Julius.ContractFollow <missionId> <runId>"));
				return;
			}
			ForEachLive([&Args](UWonderlandJuliusStreamSubsystem& Stream) { Stream.ContractFollowOnly(Args[0], Args[1]); });
		}));
}

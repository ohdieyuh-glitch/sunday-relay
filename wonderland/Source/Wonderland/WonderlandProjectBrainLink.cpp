#include "WonderlandProjectBrainLink.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/Guid.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/UObjectIterator.h"
#include "WonderlandJuliusStream.h"
#include "WonderlandProjectBrain.h"

namespace WonderlandProjectBrainLinkTuning
{
	/** How long the bridge may hold a feed read open before answering "nothing new". */
	constexpr int32 FeedWaitMs = 20000;
	/** The HTTP timeout for that read: longer than the wait, so the bridge always answers first. */
	constexpr float FeedTimeoutSeconds = 35.0f;
	/** A write is sent at most this many times, always with the same key. */
	constexpr int32 WriteAttempts = 3;
	/** Unpaired or unconfigured: how often to look again. */
	constexpr double IdleSeconds = 2.0;
}

/* ================================================================================================= pure logic */

namespace WonderlandProjectBrainLinkLogic
{
	namespace
	{
		TSharedPtr<FJsonObject> ParseObject(const FString& Body)
		{
			TSharedPtr<FJsonObject> Root;
			const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Body);
			if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
			{
				return nullptr;
			}
			return Root;
		}

		TSharedPtr<FJsonObject> DataOf(const FString& Body)
		{
			const TSharedPtr<FJsonObject> Root = ParseObject(Body);
			const TSharedPtr<FJsonObject>* Data = nullptr;
			if (!Root.IsValid() || !Root->TryGetObjectField(TEXT("data"), Data) || Data == nullptr || !Data->IsValid())
			{
				return nullptr;
			}
			return *Data;
		}

		/** Condensed JSON, for a request body. */
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

		/** A string field that may be JSON null: null and absent both read as empty. */
		FString OptionalString(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
		{
			FString Value;
			return Object.IsValid() && Object->TryGetStringField(Field, Value) ? Value : FString();
		}

		bool ParseEntries(const TSharedPtr<FJsonObject>& Surface, const TCHAR* Field, TArray<FWonderlandBrainLiveEntry>& Out)
		{
			const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
			if (!Surface->TryGetArrayField(Field, Values) || Values == nullptr)
			{
				return false;
			}
			for (const TSharedPtr<FJsonValue>& Value : *Values)
			{
				const TSharedPtr<FJsonObject>* Entry = nullptr;
				if (!Value.IsValid() || !Value->TryGetObject(Entry) || Entry == nullptr || !Entry->IsValid())
				{
					return false;
				}
				FWonderlandBrainLiveEntry Read;
				// A line with no reference or no text is not a line this panel can show or review.
				if (!(*Entry)->TryGetStringField(TEXT("ref"), Read.Ref) || !(*Entry)->TryGetStringField(TEXT("line"), Read.Line))
				{
					return false;
				}
				Read.Status = OptionalString(*Entry, TEXT("status"));
				Read.Review = OptionalString(*Entry, TEXT("review"));
				Out.Add(MoveTemp(Read));
			}
			return true;
		}
	}

	bool ParseView(const FString& Body, FWonderlandBrainLiveView& Out)
	{
		const TSharedPtr<FJsonObject> Data = DataOf(Body);
		FString Schema;
		if (!Data.IsValid() || !Data->TryGetStringField(TEXT("schemaVersion"), Schema) || Schema != TEXT("relay-wonderland-project-brain.v1"))
		{
			return false;
		}
		FWonderlandBrainLiveView View;
		if (!Data->TryGetStringField(TEXT("projectId"), View.ProjectId) || !Data->TryGetStringField(TEXT("cursor"), View.Cursor)
			|| !Data->TryGetNumberField(TEXT("brainRevision"), View.BrainRevision) || !Data->TryGetStringField(TEXT("sourceLine"), View.SourceLine))
		{
			return false;
		}
		View.MissionTitle = OptionalString(Data, TEXT("missionTitle"));
		const TArray<TSharedPtr<FJsonValue>>* Surfaces = nullptr;
		if (!Data->TryGetArrayField(TEXT("surfaces"), Surfaces) || Surfaces == nullptr)
		{
			return false;
		}
		for (const TSharedPtr<FJsonValue>& Value : *Surfaces)
		{
			const TSharedPtr<FJsonObject>* Surface = nullptr;
			if (!Value.IsValid() || !Value->TryGetObject(Surface) || Surface == nullptr || !Surface->IsValid())
			{
				return false;
			}
			FWonderlandBrainLiveSurface Read;
			FString Id;
			if (!(*Surface)->TryGetStringField(TEXT("id"), Id) || !(*Surface)->TryGetNumberField(TEXT("entryCount"), Read.EntryCount)
				|| !ParseEntries(*Surface, TEXT("entries"), Read.Entries) || !ParseEntries(*Surface, TEXT("proposals"), Read.Proposals))
			{
				// One surface the panel cannot read means the view is not the contract it claims to be: refused whole.
				return false;
			}
			Read.Id = FName(*Id);
			View.Surfaces.Add(MoveTemp(Read));
		}
		Out = MoveTemp(View);
		return true;
	}

	bool ParseEventsPage(const FString& Body, int32& OutEvents, FString& OutCursor)
	{
		const TSharedPtr<FJsonObject> Data = DataOf(Body);
		const TArray<TSharedPtr<FJsonValue>>* Events = nullptr;
		FString Cursor;
		if (!Data.IsValid() || !Data->TryGetArrayField(TEXT("events"), Events) || Events == nullptr || !Data->TryGetStringField(TEXT("cursor"), Cursor))
		{
			return false;
		}
		OutEvents = Events->Num();
		OutCursor = Cursor;
		return true;
	}

	FString WriteSentence(const FString& Body, int32 HttpStatus, bool bConnected, const FString& What)
	{
		if (!bConnected)
		{
			return FString::Printf(TEXT("Not saved: the bridge could not be reached for this %s."), *What);
		}
		if (HttpStatus == 201 || HttpStatus == 200)
		{
			const TSharedPtr<FJsonObject> Data = DataOf(Body);
			const FString Status = OptionalString(Data, TEXT("status"));
			return Status.IsEmpty()
				? FString::Printf(TEXT("Saved in Project Brain: your %s."), *What)
				: FString::Printf(TEXT("Saved in Project Brain: your %s (%s)."), *What, *Status.ToLower());
		}
		// The bridge's own sentence, verbatim; a status with none is named by its number.
		const TSharedPtr<FJsonObject> Root = ParseObject(Body);
		const TSharedPtr<FJsonObject>* Error = nullptr;
		FString Message;
		if (Root.IsValid() && Root->TryGetObjectField(TEXT("error"), Error) && Error != nullptr && Error->IsValid()
			&& (*Error)->TryGetStringField(TEXT("message"), Message) && !Message.IsEmpty())
		{
			return FString::Printf(TEXT("Not saved: %s"), *Message);
		}
		return FString::Printf(TEXT("Not saved: the bridge answered HTTP %d."), HttpStatus);
	}

	bool SerializeBody(const TSharedPtr<FJsonObject>& Object, FString& Out)
	{
		return Serialize(Object, Out);
	}

	bool WriteMayRetry(const FString& Body, int32 HttpStatus, bool bConnected)
	{
		if (!bConnected)
		{
			return true;
		}
		if (HttpStatus != 503)
		{
			return false;
		}
		// A 503 whose outcome is UNKNOWN is the one case retrying with the same key exists for; one that saved nothing
		// for certain may be retried too. Either way the key makes a second application impossible.
		return true;
	}
}

/* ================================================================================================== the link */

FWonderlandProjectBrainLink::FWonderlandProjectBrainLink(UGameInstance* InGameInstance, UWonderlandProjectBrainSubsystem* InBrain)
	: GameInstance(InGameInstance)
	, Brain(InBrain)
{
}

FWonderlandProjectBrainLink::~FWonderlandProjectBrainLink()
{
	Stop();
}

void FWonderlandProjectBrainLink::Start()
{
	if (!Ticker.IsValid())
	{
		Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateSP(this, &FWonderlandProjectBrainLink::Tick), 0.25f);
	}
}

void FWonderlandProjectBrainLink::Stop()
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
}

UWonderlandJuliusStreamSubsystem* FWonderlandProjectBrainLink::Stream() const
{
	const UGameInstance* Instance = GameInstance.Get();
	return Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusStreamSubsystem>() : nullptr;
}

void FWonderlandProjectBrainLink::Refresh()
{
	bDirty = true;
	NextAttemptAt = 0.0;
}

bool FWonderlandProjectBrainLink::Tick(float /*DeltaSeconds*/)
{
	UWonderlandJuliusStreamSubsystem* Julius = Stream();
	if (Julius == nullptr || !Brain.IsValid() || FPlatformTime::Seconds() < NextAttemptAt)
	{
		return true;
	}
	// THE PROJECT COMES FROM PAIRING, never from the player: unpaired, the preview stays exactly as it was.
	const FString Paired = Julius->GetPairedProjectId();
	if (Paired.IsEmpty())
	{
		// NEVER PAIRED: the labelled preview. PAIRED BEFORE, NOW NOT (a 401 here or on the stream, or the session ended): the last
		// live view stays on screen labelled NOT CONNECTED and refuses writes -- a stale view must never read as live (Second, 10-03).
		if (bHaveView)
		{
			LastProblem = TEXT("the session ended or was refused: the last view is shown, labelled NOT CONNECTED");
			if (UWonderlandProjectBrainSubsystem* Model = Brain.Get())
			{
				Model->MarkLinkLost(TEXT("the bridge no longer accepts this client's session."));
			}
			bHaveView = false;
			bDirty = true;
			Cursor.Reset();
			ProjectId.Reset();
		}
		else
		{
			LastProblem = Brain->GetModel().bLive ? TEXT("not paired: the last view is shown, labelled NOT CONNECTED")
				: TEXT("not paired: the development preview is shown");
		}
		NextAttemptAt = FPlatformTime::Seconds() + WonderlandProjectBrainLinkTuning::IdleSeconds;
		return true;
	}
	if (Paired != ProjectId)
	{
		// ANOTHER PROJECT IS ANOTHER BRAIN. Nothing read for the old one carries over, not even the cursor.
		ProjectId = Paired;
		Cursor.Reset();
		bHaveView = false;
		bDirty = true;
	}
	if (bViewInFlight || bEventsInFlight)
	{
		return true;
	}
	if (bDirty || !bHaveView)
	{
		RequestView();
	}
	else
	{
		RequestEvents();
	}
	return true;
}

void FWonderlandProjectBrainLink::RequestView()
{
	UWonderlandJuliusStreamSubsystem* Julius = Stream();
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> Request;
	if (Julius != nullptr)
	{
		Request = Julius->NewBridgeRequest(TEXT("GET"), TEXT("/relay-api/wonderland/brain?projectId=") + FGenericPlatformHttp::UrlEncode(ProjectId));
	}
	if (!Request.IsValid())
	{
		LastProblem = TEXT("no usable bridge or no session");
		NextAttemptAt = FPlatformTime::Seconds() + WonderlandProjectBrainLinkTuning::IdleSeconds;
		return;
	}
	bViewInFlight = true;
	bDirty = false;
	InFlight.Add(Request);
	const FString Asked = ProjectId;
	const TWeakPtr<FWonderlandProjectBrainLink> Weak = AsShared();
	Request->OnProcessRequestComplete().BindLambda([Weak, Asked](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		const TSharedPtr<FWonderlandProjectBrainLink> Self = Weak.Pin();
		if (!Self.IsValid())
		{
			return;
		}
		Self->InFlight.Remove(Done);
		Self->bViewInFlight = false;
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		FWonderlandBrainLiveView View;
		const bool bRead = Status == 200 && Response.IsValid()
			&& WonderlandProjectBrainLinkLogic::ParseView(Response->GetContentAsString(), View);
		// THE PROJECT MAY HAVE CHANGED WHILE THIS WAS IN FLIGHT; a view of the old one is not this one's.
		if (Asked != Self->ProjectId)
		{
			Self->bDirty = true;
			return;
		}
		if (!bRead || View.ProjectId != Asked)
		{
			++Self->Failures;
			Self->bDirty = true;
			Self->NextAttemptAt = FPlatformTime::Seconds() + WonderlandJuliusStreamLogic::BackoffSeconds(Self->Failures);
			Self->LastProblem = FString::Printf(TEXT("the Project Brain view could not be read (HTTP %d)"), Status);
			if (Status == 401)
			{
				if (UWonderlandJuliusStreamSubsystem* Julius = Self->Stream())
				{
					Julius->NoteSessionRefused();
				}
			}
			UE_LOG(LogTemp, Warning, TEXT("WLBRAIN LINK: %s; what is shown is what was last read."), *Self->LastProblem);
			return;
		}
		Self->Failures = 0;
		Self->LastProblem.Reset();
		Self->Cursor = View.Cursor;
		Self->bHaveView = true;
		++Self->ViewsAdopted;
		if (UWonderlandProjectBrainSubsystem* Model = Self->Brain.Get())
		{
			Model->AdoptLive(View);
		}
	});
	Request->ProcessRequest();
}

void FWonderlandProjectBrainLink::RequestEvents()
{
	UWonderlandJuliusStreamSubsystem* Julius = Stream();
	const FString Path = FString::Printf(TEXT("/relay-api/wonderland/brain/events?projectId=%s&cursor=%s&waitMs=%d"),
		*FGenericPlatformHttp::UrlEncode(ProjectId), *FGenericPlatformHttp::UrlEncode(Cursor), WonderlandProjectBrainLinkTuning::FeedWaitMs);
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> Request;
	if (Julius != nullptr)
	{
		Request = Julius->NewBridgeRequest(TEXT("GET"), Path);
	}
	if (!Request.IsValid())
	{
		NextAttemptAt = FPlatformTime::Seconds() + WonderlandProjectBrainLinkTuning::IdleSeconds;
		return;
	}
	Request->SetTimeout(WonderlandProjectBrainLinkTuning::FeedTimeoutSeconds);
	bEventsInFlight = true;
	InFlight.Add(Request);
	const FString Asked = ProjectId;
	const TWeakPtr<FWonderlandProjectBrainLink> Weak = AsShared();
	Request->OnProcessRequestComplete().BindLambda([Weak, Asked](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		const TSharedPtr<FWonderlandProjectBrainLink> Self = Weak.Pin();
		if (!Self.IsValid())
		{
			return;
		}
		Self->InFlight.Remove(Done);
		Self->bEventsInFlight = false;
		if (Asked != Self->ProjectId)
		{
			return;
		}
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		int32 Events = 0;
		FString Next;
		if (Status == 200 && Response.IsValid() && WonderlandProjectBrainLinkLogic::ParseEventsPage(Response->GetContentAsString(), Events, Next))
		{
			Self->Failures = 0;
			if (Events > 0)
			{
				// SOMETHING DURABLE CHANGED. The view is read again from durable state rather than patched from the event,
				// so what is shown can never drift from what Project Brain holds.
				Self->bDirty = true;
			}
			return;
		}
		// RECONNECT MEANS READ THE VIEW AGAIN: whatever changed while the feed was down is in the next view.
		++Self->Failures;
		Self->bDirty = true;
		Self->NextAttemptAt = FPlatformTime::Seconds() + WonderlandJuliusStreamLogic::BackoffSeconds(Self->Failures);
		if (Status == 401)
		{
			if (UWonderlandJuliusStreamSubsystem* Julius = Self->Stream())
			{
				Julius->NoteSessionRefused();
			}
		}
	});
	Request->ProcessRequest();
}

bool FWonderlandProjectBrainLink::SendProposal(FName SurfaceId, const FString& Text)
{
	if (ProjectId.IsEmpty() || Stream() == nullptr)
	{
		return false;
	}
	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("projectId"), ProjectId);
	Body->SetStringField(TEXT("surfaceId"), SurfaceId.ToString());
	Body->SetStringField(TEXT("text"), Text);
	// ONE KEY PER ACTION, minted here and reused by every retry of it.
	Body->SetStringField(TEXT("idempotencyKey"), FString::Printf(TEXT("wl-%s"), *FGuid::NewGuid().ToString(EGuidFormats::Digits).ToLower()));
	FString Payload;
	WonderlandProjectBrainLinkLogic::SerializeBody(Body, Payload);
	SendWrite(TEXT("/relay-api/wonderland/brain/proposals"), Payload, TEXT("proposal"), 1);
	return true;
}

bool FWonderlandProjectBrainLink::SendReview(FName SurfaceId, const FString& EntryRef, bool bAccept)
{
	if (ProjectId.IsEmpty() || EntryRef.IsEmpty() || Stream() == nullptr)
	{
		return false;
	}
	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("projectId"), ProjectId);
	Body->SetStringField(TEXT("surfaceId"), SurfaceId.ToString());
	Body->SetStringField(TEXT("entryRef"), EntryRef);
	Body->SetStringField(TEXT("verdict"), bAccept ? TEXT("ACCEPT") : TEXT("DECLINE"));
	Body->SetStringField(TEXT("idempotencyKey"), FString::Printf(TEXT("wl-%s"), *FGuid::NewGuid().ToString(EGuidFormats::Digits).ToLower()));
	FString Payload;
	WonderlandProjectBrainLinkLogic::SerializeBody(Body, Payload);
	SendWrite(TEXT("/relay-api/wonderland/brain/reviews"), Payload, TEXT("review"), 1);
	return true;
}

void FWonderlandProjectBrainLink::SendWrite(const FString& Path, const FString& Payload, const FString& What, int32 Attempt)
{
	UWonderlandJuliusStreamSubsystem* Julius = Stream();
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> Request;
	if (Julius != nullptr)
	{
		Request = Julius->NewBridgeRequest(TEXT("POST"), Path);
	}
	if (!Request.IsValid())
	{
		if (UWonderlandProjectBrainSubsystem* Model = Brain.Get())
		{
			Model->SetWriteNote(FString::Printf(TEXT("Not saved: this client is not paired with a bridge, so the %s was not sent."), *What));
		}
		return;
	}
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetContentAsString(Payload);
	InFlight.Add(Request);
	const TWeakPtr<FWonderlandProjectBrainLink> Weak = AsShared();
	Request->OnProcessRequestComplete().BindLambda([Weak, Path, Payload, What, Attempt](FHttpRequestPtr Done, FHttpResponsePtr Response, bool bConnected)
	{
		const TSharedPtr<FWonderlandProjectBrainLink> Self = Weak.Pin();
		if (!Self.IsValid())
		{
			return;
		}
		Self->InFlight.Remove(Done);
		const int32 Status = (bConnected && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const FString Content = Response.IsValid() ? Response->GetContentAsString() : FString();
		const bool bSaved = Status == 200 || Status == 201;
		if (!bSaved && Attempt < WonderlandProjectBrainLinkTuning::WriteAttempts && WonderlandProjectBrainLinkLogic::WriteMayRetry(Content, Status, bConnected))
		{
			// THE SAME PAYLOAD, AND SO THE SAME KEY: if the first one was saved after all, this is answered from the log.
			const float Delay = WonderlandJuliusStreamLogic::BackoffSeconds(Attempt);
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Weak, Path, Payload, What, Attempt](float)
			{
				if (const TSharedPtr<FWonderlandProjectBrainLink> Again = Weak.Pin())
				{
					Again->SendWrite(Path, Payload, What, Attempt + 1);
				}
				return false;
			}), Delay);
			if (UWonderlandProjectBrainSubsystem* Model = Self->Brain.Get())
			{
				Model->SetWriteNote(FString::Printf(TEXT("Still sending the %s (attempt %d of %d)..."), *What, Attempt + 1, WonderlandProjectBrainLinkTuning::WriteAttempts));
			}
			return;
		}
		if (bSaved)
		{
			++Self->WritesSaved;
			// READ IT BACK: the panel shows the proposal when the view says Project Brain holds it, not before.
			Self->Refresh();
		}
		else if (Status == 401)
		{
			if (UWonderlandJuliusStreamSubsystem* Julius = Self->Stream())
			{
				Julius->NoteSessionRefused();
			}
		}
		const FString Sentence = WonderlandProjectBrainLinkLogic::WriteSentence(Content, Status, bConnected, What);
		UE_LOG(LogTemp, Log, TEXT("WLBRAIN LINK: %s (HTTP %d)"), *Sentence, Status);
		if (UWonderlandProjectBrainSubsystem* Model = Self->Brain.Get())
		{
			Model->SetWriteNote(Sentence);
		}
	});
	Request->ProcessRequest();
}

FString FWonderlandProjectBrainLink::Describe() const
{
	return FString::Printf(TEXT("WLBRAIN LINK: project %s · %s · views adopted %d · writes saved %d · failures %d%s%s"),
		ProjectId.IsEmpty() ? TEXT("(none)") : *ProjectId,
		bHaveView ? TEXT("live") : TEXT("not yet read"),
		ViewsAdopted, WritesSaved, Failures,
		LastProblem.IsEmpty() ? TEXT("") : TEXT(" · "), *LastProblem);
}

/* ============================================================================================ console commands */

namespace WonderlandProjectBrainLinkCommands
{
	void Say(const FString& Text)
	{
		UE_LOG(LogTemp, Display, TEXT("%s"), *Text);
		if (GEngine != nullptr)
		{
			GEngine->AddOnScreenDebugMessage(INDEX_NONE, 8.0f, FColor(184, 140, 255), Text);
		}
	}

	void ForEachLive(TFunctionRef<void(UWonderlandProjectBrainSubsystem&)> Body)
	{
		int32 Found = 0;
		for (TObjectIterator<UWonderlandProjectBrainSubsystem> It; It; ++It)
		{
			if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject) && It->GetWorld() != nullptr && It->GetWorld()->IsGameWorld())
			{
				Body(**It);
				++Found;
			}
		}
		if (Found == 0)
		{
			Say(TEXT("WLBRAIN LINK: nothing to do -- press Play first."));
		}
	}

	FAutoConsoleCommand CmdDescribe(TEXT("wl.Brain.Link"),
		TEXT("Say what the Project Brain link is doing: the paired project, whether the view is live, views read, writes saved."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>&)
		{
			ForEachLive([](UWonderlandProjectBrainSubsystem& Brain) { Say(Brain.DescribeLink()); });
		}));

	FAutoConsoleCommand CmdRefresh(TEXT("wl.Brain.Refresh"),
		TEXT("Read the Project Brain view again now, from the bridge."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>&)
		{
			ForEachLive([](UWonderlandProjectBrainSubsystem& Brain) { Brain.RefreshLink(); });
		}));
}

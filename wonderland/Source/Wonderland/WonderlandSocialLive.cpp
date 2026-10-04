#include "WonderlandSocialLive.h"

#include "Dom/JsonObject.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandSocialLiveDetail
{
	/** How often the events are asked for, and how long to wait after a failure before asking again. */
	constexpr double PollSeconds = 2.0;
	constexpr double RetrySeconds = 6.0;
	/**
	 * A change this viewer is NOT TOLD about still reaches their view. A block is announced to nobody but its actor (privacy), so
	 * the blocked player's view -- the friendship the block removed -- changes with no event at all, and the first durable
	 * two-client run (10-02) left A's friend list showing B for minutes. The view is read again when it is this old.
	 */
	constexpr double ResyncSeconds = 20.0;
	/** The shared presence layer's report: ~5 a second, each answered with the view. */
	constexpr double WorldSeconds = 0.2;
	constexpr int64 MaxResponseBytes = 2 * 1024 * 1024;

	const TCHAR* const Root = TEXT("/relay-api/wonderland/social");

	TSharedPtr<FJsonObject> Object(const TCHAR* Key, const FString& Value)
	{
		TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
		Out->SetStringField(Key, Value);
		return Out;
	}

	TSharedPtr<FJsonObject> Object(const TCHAR* Key1, const FString& Value1, const TCHAR* Key2, const FString& Value2)
	{
		TSharedPtr<FJsonObject> Out = Object(Key1, Value1);
		Out->SetStringField(Key2, Value2);
		return Out;
	}

	/** Only ids the server's table accepts ([A-Za-z0-9_-]{1,80}) ever go into a path. */
	bool SafeId(const FString& Id)
	{
		if (Id.IsEmpty() || Id.Len() > 80)
		{
			return false;
		}
		for (const TCHAR C : Id)
		{
			if (!FChar::IsAlnum(C) && C != TEXT('_') && C != TEXT('-'))
			{
				return false;
			}
		}
		return true;
	}

	/** worldViewFor's answer (src/relay/social/world-presence.ts). */
	FWonderlandWorldView ParseWorldView(const TSharedPtr<FJsonObject>& Data)
	{
		FWonderlandWorldView View;
		if (!Data.IsValid())
		{
			return View;
		}
		const TSharedPtr<FJsonObject>* Context = nullptr;
		if (Data->TryGetObjectField(TEXT("context"), Context) && Context != nullptr && (*Context).IsValid())
		{
			View.bInWorld = true;
			(*Context)->TryGetStringField(TEXT("contextId"), View.ContextId);
			(*Context)->TryGetStringField(TEXT("kind"), View.Kind);
			(*Context)->TryGetStringField(TEXT("serverName"), View.ServerName);
			(*Context)->TryGetStringField(TEXT("authority"), View.Authority);
			double N = 0.0;
			View.Population = (*Context)->TryGetNumberField(TEXT("population"), N) ? static_cast<int32>(N) : 0;
			View.Capacity = (*Context)->TryGetNumberField(TEXT("capacity"), N) ? static_cast<int32>(N) : 0;
		}
		const TArray<TSharedPtr<FJsonValue>>* Avatars = nullptr;
		if (Data->TryGetArrayField(TEXT("avatars"), Avatars) && Avatars != nullptr)
		{
			for (const TSharedPtr<FJsonValue>& V : *Avatars)
			{
				const TSharedPtr<FJsonObject> A = V.IsValid() ? V->AsObject() : nullptr;
				if (!A.IsValid())
				{
					continue;
				}
				FWonderlandRemoteAvatar R;
				double X = 0.0, Y = 0.0, Z = 0.0, Yaw = 0.0, Speed = 0.0, Age = 0.0;
				A->TryGetStringField(TEXT("userId"), R.UserId);
				A->TryGetStringField(TEXT("displayName"), R.DisplayName);
				A->TryGetNumberField(TEXT("x"), X);
				A->TryGetNumberField(TEXT("y"), Y);
				A->TryGetNumberField(TEXT("z"), Z);
				A->TryGetNumberField(TEXT("yaw"), Yaw);
				A->TryGetNumberField(TEXT("speed"), Speed);
				A->TryGetNumberField(TEXT("ageMs"), Age);
				A->TryGetStringField(TEXT("motion"), R.Motion);
				A->TryGetStringField(TEXT("skinId"), R.SkinId);
				R.Location = FVector(X, Y, Z);
				R.Yaw = static_cast<float>(Yaw);
				R.Speed = static_cast<float>(Speed);
				R.AgeMs = Age;
				if (!R.UserId.IsEmpty())
				{
					View.Avatars.Add(MoveTemp(R));
				}
			}
		}
		const TArray<TSharedPtr<FJsonValue>>* Invites = nullptr;
		if (Data->TryGetArrayField(TEXT("invites"), Invites) && Invites != nullptr)
		{
			for (const TSharedPtr<FJsonValue>& V : *Invites)
			{
				const TSharedPtr<FJsonObject> I = V.IsValid() ? V->AsObject() : nullptr;
				if (!I.IsValid())
				{
					continue;
				}
				FWonderlandWorldInviteRow Row;
				I->TryGetStringField(TEXT("inviteId"), Row.InviteId);
				I->TryGetStringField(TEXT("fromUserId"), Row.FromUserId);
				I->TryGetStringField(TEXT("fromName"), Row.FromName);
				I->TryGetStringField(TEXT("serverName"), Row.ServerName);
				I->TryGetNumberField(TEXT("expiresInMs"), Row.ExpiresInMs);
				View.Invites.Add(MoveTemp(Row));
			}
		}
		return View;
	}

	FString ErrorMessageOf(const TSharedPtr<FJsonObject>& Json)
	{
		const TSharedPtr<FJsonObject>* Error = nullptr;
		FString Message;
		if (Json.IsValid() && Json->TryGetObjectField(TEXT("error"), Error) && Error != nullptr && (*Error)->TryGetStringField(TEXT("message"), Message))
		{
			return Message;
		}
		return FString();
	}
}

FWonderlandSocialLiveService::FWonderlandSocialLiveService(const FString& InBaseUrl, const FString& InToken)
	: BaseUrl(InBaseUrl.TrimStartAndEnd())
	, Token(InToken.TrimStartAndEnd())
{
	BaseUrl.RemoveFromEnd(TEXT("/"));
	TickerHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FWonderlandSocialLiveService::Tick), 0.25f);
	ReportPresence(true);
	Refresh();
}

FWonderlandSocialLiveService::~FWonderlandSocialLiveService()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickerHandle);
	for (const TSharedRef<IHttpRequest, ESPMode::ThreadSafe>& Request : InFlight)
	{
		Request->OnProcessRequestComplete().Unbind();
		Request->CancelRequest();
	}
	InFlight.Reset();
}

FString FWonderlandSocialLiveService::GetSourceLine() const
{
	return bHasSnapshot ? FString::Printf(TEXT("LIVE · signed in as %s"), *Snapshot.Self.Profile.DisplayName)
		: FString(TEXT("LIVE · connecting to Wonderland social"));
}

FString FWonderlandSocialLiveService::Describe() const
{
	return FString::Printf(TEXT("live %s as %s | events %d (latest %lld) | snapshot %s | last error %s"), *BaseUrl,
		bHasSnapshot ? *Snapshot.ViewerId : TEXT("(not yet)"), EventsSeen, LatestEvent,
		bHasSnapshot ? *FString::Printf(TEXT("%.1f s old"), FPlatformTime::Seconds() - SnapshotAt) : TEXT("none"),
		LastError.IsEmpty() ? TEXT("none") : *LastError);
}

void FWonderlandSocialLiveService::JoinVoice(const FString& PartyId, const FString& EosProductUserId,
	TFunction<void(int32, const TSharedPtr<FJsonObject>&, const FString&)> Done)
{
	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("eosProductUserId"), EosProductUserId);
	Call(TEXT("POST"), FString::Printf(TEXT("/parties/%s/voice/join"), *PartyId), Body, MoveTemp(Done));
}

void FWonderlandSocialLiveService::GetEosClientConfig(TFunction<void(int32, const TSharedPtr<FJsonObject>&, const FString&)> Done)
{
	// the session is the only key (Relay-Session, as every social route); the answer carries a client secret, so nothing here logs it
	Call(TEXT("GET"), TEXT("/voice/eos-client-config"), nullptr, MoveTemp(Done));
}

void FWonderlandSocialLiveService::Call(const FString& Verb, const FString& Path, const TSharedPtr<FJsonObject>& Body,
	TFunction<void(int32, const TSharedPtr<FJsonObject>&, const FString&)> Done)
{
	using namespace WonderlandSocialLiveDetail;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> HttpRequest = FHttpModule::Get().CreateRequest();
	HttpRequest->SetURL(BaseUrl + Root + Path);
	HttpRequest->SetVerb(Verb);
	// NO ORIGIN HEADER, ever: the social routes are the desktop client's, and they refuse a browser's.
	HttpRequest->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Relay-Session %s"), *Token));
	HttpRequest->SetTimeout(15.0f);
	if (Body.IsValid())
	{
		FString Payload;
		const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Payload);
		FJsonSerializer::Serialize(Body.ToSharedRef(), Writer);
		HttpRequest->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
		HttpRequest->SetContentAsString(Payload);
	}
	InFlight.Add(HttpRequest);
	const TWeakPtr<bool> WeakAlive = Alive;
	HttpRequest->OnProcessRequestComplete().BindLambda([this, WeakAlive, Done](FHttpRequestPtr Finished, FHttpResponsePtr Response, bool bConnected)
	{
		if (!WeakAlive.IsValid())
		{
			return;
		}
		InFlight.RemoveAll([&Finished](const TSharedRef<IHttpRequest, ESPMode::ThreadSafe>& R) { return &R.Get() == Finished.Get(); });
		const int32 Status = Response.IsValid() ? Response->GetResponseCode() : 0;
		if (!bConnected || !Response.IsValid())
		{
			Done(0, nullptr, TEXT("Wonderland social could not be reached"));
			return;
		}
		// THE SESSION IS GONE (expired, revoked, or the bridge restarted: its sessions live in memory). Said ONCE; polling
		// stops; the owner forgets the token and offers SIGN IN again. Social state itself is durable on the server.
		if (Status == 401 && !bSessionEnded)
		{
			bSessionEnded = true;
			LastError = TEXT("the server ended this session");
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL live: HTTP 401 -- the server ended this session"));
			SessionEndedEvent.Broadcast();
		}
		const FString Text = Response->GetContentAsString();
		if (Text.Len() > WonderlandSocialLiveDetail::MaxResponseBytes)
		{
			Done(Status, nullptr, TEXT("the social server's answer was too large"));
			return;
		}
		TSharedPtr<FJsonObject> Json;
		const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
		if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
		{
			Done(Status, nullptr, FString::Printf(TEXT("the social server answered HTTP %d without JSON"), Status));
			return;
		}
		if (Status != 200)
		{
			const FString Message = WonderlandSocialLiveDetail::ErrorMessageOf(Json);
			Done(Status, nullptr, Message.IsEmpty() ? FString::Printf(TEXT("the social server refused (HTTP %d)"), Status) : Message);
			return;
		}
		const TSharedPtr<FJsonObject>* Data = nullptr;
		Done(Status, Json->TryGetObjectField(TEXT("data"), Data) && Data != nullptr ? *Data : nullptr, FString());
	});
	HttpRequest->ProcessRequest();
}

void FWonderlandSocialLiveService::Refresh()
{
	if (bRefreshing)
	{
		bRefreshAgain = true;   // a change arrived while reading: read once more when this read lands
		return;
	}
	bRefreshing = true;
	Call(TEXT("GET"), TEXT("/snapshot"), nullptr, [this](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		bRefreshing = false;
		FWonderlandSocialSnapshot Parsed;
		FString ParseProblem;
		if (!Problem.IsEmpty() || !WonderlandParseSocialView(Data, false, Parsed, ParseProblem))
		{
			LastError = Problem.IsEmpty() ? FString::Printf(TEXT("the live view was refused: %s"), *ParseProblem) : Problem;
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live snapshot failed: %s"), *LastError);
		}
		else
		{
			Snapshot = MoveTemp(Parsed);
			bHasSnapshot = true;
			SnapshotAt = FPlatformTime::Seconds();
			LastError.Reset();
			UE_LOG(LogTemp, Log, TEXT("WLSOCIAL live snapshot: %s, %d friends, %d requests in, %d conversations, party %s"), *Snapshot.ViewerId,
				Snapshot.Friends.Num(), Snapshot.IncomingRequests.Num(), Snapshot.Conversations.Num(), Snapshot.bHasParty ? *Snapshot.Party.Name : TEXT("none"));
			Changed.Broadcast();
		}
		if (bRefreshAgain)
		{
			bRefreshAgain = false;
			Refresh();
		}
	});
}

bool FWonderlandSocialLiveService::Tick(float)
{
	if (bSessionEnded)
	{
		return true;   // nothing more is asked with a dead session; the owner replaces this service
	}
	if (!bPolling && FPlatformTime::Seconds() >= NextPollAt)
	{
		PollEvents();
	}
	// At most one resync per ResyncSeconds, so a server that keeps failing is not asked again every tick.
	if (bHasSnapshot && !bRefreshing && FPlatformTime::Seconds() >= NextResyncAt)
	{
		NextResyncAt = FPlatformTime::Seconds() + WonderlandSocialLiveDetail::ResyncSeconds;
		if (FPlatformTime::Seconds() - SnapshotAt >= WonderlandSocialLiveDetail::ResyncSeconds)
		{
			Refresh();
		}
	}
	// AN AUTOMATIC JOIN THAT WAS REFUSED is tried again on its own clock (JoinWorldAs), never two at once
	if (bAutoJoinPending && !bAutoJoinInFlight && FPlatformTime::Seconds() >= NextAutoJoinAt)
	{
		JoinWorldAs(AutoJoinTarget, AutoJoinArg, true);
	}
	if (bWorldWanted && !bWorldBusy && FPlatformTime::Seconds() >= NextWorldAt)
	{
		TickWorld();
	}
	return true;
}

void FWonderlandSocialLiveService::TickWorld()
{
	using namespace WonderlandSocialLiveDetail;
	FWonderlandAvatarReport Report;
	if (!AvatarSource || !AvatarSource(Report))
	{
		NextWorldAt = FPlatformTime::Seconds() + WorldSeconds;
		return;
	}
	TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetNumberField(TEXT("x"), Report.Location.X);
	Body->SetNumberField(TEXT("y"), Report.Location.Y);
	Body->SetNumberField(TEXT("z"), Report.Location.Z);
	Body->SetNumberField(TEXT("yaw"), Report.Yaw);
	Body->SetNumberField(TEXT("speed"), Report.Speed);
	Body->SetStringField(TEXT("motion"), Report.Motion);
	Body->SetStringField(TEXT("skinId"), Report.SkinId);
	bWorldBusy = true;
	// ONE CALL A TICK: the report answers with who else is here.
	Call(TEXT("POST"), TEXT("/world/state"), Body, [this](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		bWorldBusy = false;
		NextWorldAt = FPlatformTime::Seconds() + (Problem.IsEmpty() ? WonderlandSocialLiveDetail::WorldSeconds : WonderlandSocialLiveDetail::RetrySeconds);
		if (!Problem.IsEmpty())
		{
			LastError = Problem;
			// A REFUSAL IS NEVER A REMOVAL (Second's review of 4d31c524: since b7dd6eae the server answers a removal 200 with no context).
			// 404 "Join a world first": the server's sweep forgot this player (silent for 15 s -- a hitch, a modal, sleep), so the SAME
			// world is joined again quietly. 400 (a position out of range): logged, and the player stays.
			if (Status == 404 && bWorldWanted && !bAutoJoinInFlight && !bAutoJoinPending)
			{
				UE_LOG(LogTemp, Display, TEXT("WLWORLD the server no longer holds this player's world (404): joining the same one again quietly"));
				JoinWorldAs(WorldTarget, WorldArg, true);
			}
			return;
		}
		if (!Data.IsValid())
		{
			// a 200 without a view (only something that is not the bridge -- a proxy -- answers so): never read as a removal
			LastError = TEXT("the world answer carried no view");
			return;
		}
		const bool bWasPrivate = WorldView.bInWorld && WorldView.Kind == TEXT("PRIVATE_SERVER");
		WorldView = WonderlandSocialLiveDetail::ParseWorldView(Data);
		if (bWasPrivate && !WorldView.bInWorld && bWorldWanted)
		{
			// TAKEN OUT OF A PRIVATE SERVER BY THE SERVER (founder P4/P5, 10-04: a block either way removes the member; the owner stays):
			// the server answers ok with NO context for 60 s (Second b7dd6eae). Only the generic words, never why; then the public world
			// this map is -- joined quietly, so its "Done" can never overwrite the words (Second's review M1).
			UE_LOG(LogTemp, Display, TEXT("WLWORLD removed from a private server by the server: back to the public world"));
			Answered.Broadcast(TEXT("world.removed"), FString(), FWonderlandSocialActionResult{false, TEXT("You can't stay in this server."), false});
			WorldChanged.Broadcast();
			if (!bAutoJoinInFlight)
			{
				JoinWorldAs(TEXT("PUBLIC"), TEXT("golden_arrival"), true);
			}
			return;
		}
		WorldChanged.Broadcast();
	});
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::JoinWorld(const FString& Target, const FString& Arg)
{
	return JoinWorldAs(Target, Arg, false);
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::JoinWorldAs(const FString& Target, const FString& Arg, bool bAutomatic)
{
	if (bAutomatic)
	{
		bAutoJoinInFlight = true;
	}
	bAutoJoinPending = false;   // this join replaces any planned retry; a player's own join ends the automatic ones
	TSharedPtr<FJsonObject> Body = WonderlandSocialLiveDetail::Object(TEXT("target"), Target.ToUpper());
	if (Target.Equals(TEXT("PUBLIC"), ESearchCase::IgnoreCase))
	{
		Body->SetStringField(TEXT("place"), Arg.IsEmpty() ? FString(TEXT("golden_arrival")) : Arg);
		Body->SetStringField(TEXT("placeName"), TEXT("Golden Arrival"));
	}
	else if (Target.Equals(TEXT("PRIVATE"), ESearchCase::IgnoreCase)) { Body->SetStringField(TEXT("name"), Arg); }
	else if (Target.Equals(TEXT("FRIEND"), ESearchCase::IgnoreCase)) { Body->SetStringField(TEXT("userId"), Arg); }
	else if (Target.Equals(TEXT("INVITE"), ESearchCase::IgnoreCase)) { Body->SetStringField(TEXT("inviteId"), Arg); }
	Call(TEXT("POST"), TEXT("/world/join"), Body, [this, Target, Arg, bAutomatic](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		if (bAutomatic)
		{
			bAutoJoinInFlight = false;
		}
		FWonderlandSocialActionResult Answer;
		Answer.bOk = Problem.IsEmpty();
		Answer.Reason = Problem;
		if (Answer.bOk)
		{
			bWorldWanted = true;
			NextWorldAt = 0.0;
			WorldView = WonderlandSocialLiveDetail::ParseWorldView(Data);
			WorldTarget = Target.ToUpper();   // the world a forgotten player is put back into (the 404 path above)
			WorldArg = Arg;
			AutoJoinAttempts = 0;
			UE_LOG(LogTemp, Display, TEXT("WLWORLD joined %s (%s), %d of %d here%s"), *WorldView.ContextId, *WorldView.ServerName, WorldView.Population,
				WorldView.Capacity, bAutomatic ? TEXT(" (automatically)") : TEXT(""));
			WorldChanged.Broadcast();
		}
		else
		{
			UE_LOG(LogTemp, Warning, TEXT("WLWORLD join refused%s: %s"), bAutomatic ? TEXT(" (automatic)") : TEXT(""), *Problem);
			if (bAutomatic)
			{
				// THE WAY BACK (Second's review, minor 1): the same world refused it -> the public world; the public world refused it (or
				// nothing answered) -> again, spaced out, until it takes or the player joins somewhere themselves
				static const double Backoffs[] = { 2.0, 5.0, 15.0, 30.0 };
				const bool bWasPublic = Target.Equals(TEXT("PUBLIC"), ESearchCase::IgnoreCase);
				AutoJoinTarget = bWasPublic ? Target : FString(TEXT("PUBLIC"));
				AutoJoinArg = bWasPublic ? Arg : FString(TEXT("golden_arrival"));
				NextAutoJoinAt = FPlatformTime::Seconds() + Backoffs[FMath::Min(AutoJoinAttempts, 3)];
				AutoJoinAttempts += 1;
				bAutoJoinPending = true;
			}
		}
		// AN AUTOMATIC JOIN ANSWERS NO SCREEN (Second's review M1): the player did not ask, and its "Done" must never overwrite a notice
		Answered.Broadcast(bAutomatic ? TEXT("world.join.auto") : TEXT("world.join"), FString(), Answer);
		Refresh();
	});
	return FWonderlandSocialActionResult{true, TEXT("Joining…"), true};
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::LeaveWorld()
{
	bWorldWanted = false;
	bAutoJoinPending = false;   // the player chose to leave: no automatic join puts them back
	WorldView = FWonderlandWorldView();
	WorldChanged.Broadcast();
	return Ask(TEXT("world.leave"), FString(), TEXT("POST"), TEXT("/world/leave"), MakeShared<FJsonObject>());
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::InviteToWorld(const FString& UserId)
{
	if (!WonderlandSocialLiveDetail::SafeId(UserId))
	{
		return FWonderlandSocialActionResult{false, TEXT("That is not a valid id"), false};
	}
	return Ask(TEXT("world.invite"), UserId, TEXT("POST"), TEXT("/world/invites"), WonderlandSocialLiveDetail::Object(TEXT("toUserId"), UserId));
}

void FWonderlandSocialLiveService::PollEvents()
{
	bPolling = true;
	Call(TEXT("GET"), FString::Printf(TEXT("/events?after=%lld"), LatestEvent), nullptr, [this](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		bPolling = false;
		if (!Problem.IsEmpty() || !Data.IsValid())
		{
			LastError = Problem.IsEmpty() ? FString(TEXT("the events answer had no data")) : Problem;
			NextPollAt = FPlatformTime::Seconds() + WonderlandSocialLiveDetail::RetrySeconds;
			return;
		}
		NextPollAt = FPlatformTime::Seconds() + WonderlandSocialLiveDetail::PollSeconds;
		double Latest = 0.0;
		Data->TryGetNumberField(TEXT("latest"), Latest);
		bool bReset = false;
		Data->TryGetBoolField(TEXT("reset"), bReset);
		const TArray<TSharedPtr<FJsonValue>>* Events = nullptr;
		const int32 Count = Data->TryGetArrayField(TEXT("events"), Events) && Events != nullptr ? Events->Num() : 0;
		LatestEvent = FMath::Max(LatestEvent, static_cast<int64>(Latest));
		EventsSeen += Count;
		// WHAT CHANGED IS NOT IN THE EVENT: the view is read again, and shows what the authority lets this player see.
		if (Count > 0 || bReset)
		{
			Refresh();
		}
	});
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::Ask(const FString& OperationId, const FString& SubjectId, const FString& Verb,
	const FString& Path, const TSharedPtr<FJsonObject>& Body)
{
	Call(Verb, Path, Body, [this, OperationId, SubjectId](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		FWonderlandSocialActionResult Answer;
		Answer.bOk = Problem.IsEmpty();
		Answer.Reason = Problem;
		UE_LOG(LogTemp, Log, TEXT("WLSOCIAL live %s %s: %s%s"), *OperationId, *SubjectId, Answer.bOk ? TEXT("ok") : TEXT("refused"),
			Answer.Reason.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" -- %s"), *Answer.Reason));
		Answered.Broadcast(OperationId, SubjectId, Answer);
		if (Answer.bOk)
		{
			Refresh();
		}
	});
	FWonderlandSocialActionResult Pending;
	Pending.bOk = true;
	Pending.bPending = true;
	Pending.Reason = TEXT("Sending…");
	return Pending;
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::Request(const FString& OperationId, const FString& SubjectId)
{
	using namespace WonderlandSocialLiveDetail;
	const auto Refuse = [](const FString& Why) { return FWonderlandSocialActionResult{false, Why, false}; };
	if (!SubjectId.IsEmpty() && !SafeId(SubjectId))
	{
		return Refuse(TEXT("That is not a valid id"));
	}
	const FString MyParty = Snapshot.bHasParty ? Snapshot.Party.PartyId : FString();
	// THE TABLE, op by op: the method, the path (ids only from the subject or this player's own party) and the body.
	if (OperationId == TEXT("requests.send")) return Ask(OperationId, SubjectId, TEXT("POST"), TEXT("/requests"), Object(TEXT("toUserId"), SubjectId));
	if (OperationId == TEXT("requests.accept")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/requests/%s/accept"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId == TEXT("requests.decline")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/requests/%s/decline"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId == TEXT("requests.cancel")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/requests/%s/cancel"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId == TEXT("friends.remove")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/friends/%s/remove"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId == TEXT("blocks.add")) return Ask(OperationId, SubjectId, TEXT("POST"), TEXT("/blocks"), Object(TEXT("targetId"), SubjectId));
	if (OperationId == TEXT("blocks.add.confirm"))
	{
		// F1: the player confirmed a block on somebody in their party (UWonderlandUiSubsystem::HandleSocialAction warned first)
		TSharedPtr<FJsonObject> Body = Object(TEXT("targetId"), SubjectId);
		Body->SetBoolField(TEXT("confirmSharedParty"), true);
		return Ask(TEXT("blocks.add"), SubjectId, TEXT("POST"), TEXT("/blocks"), Body);
	}
	if (OperationId == TEXT("blocks.remove")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/blocks/%s/remove"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId == TEXT("mutes.set"))
	{
		TSharedPtr<FJsonObject> Body = Object(TEXT("targetId"), SubjectId);
		Body->SetBoolField(TEXT("voice"), true);
		Body->SetBoolField(TEXT("messages"), true);
		return Ask(OperationId, SubjectId, TEXT("POST"), TEXT("/mutes"), Body);
	}
	if (OperationId == TEXT("reports.file"))
	{
		// The reason picker is the report dialog's (to come); until then a report says OTHER and carries no note.
		return Ask(OperationId, SubjectId, TEXT("POST"), TEXT("/reports"), Object(TEXT("reportedId"), SubjectId, TEXT("reason"), TEXT("OTHER")));
	}
	if (OperationId == TEXT("presence.set"))
	{
		// THE PLAYER'S OWN PRESENCE (founder 10-04: a small presence control in the hub, so P1 is chosen by a real click): the subject is
		// the availability itself, one of the authority's four (social-contracts.ts SOCIAL_AVAILABILITY); presence.update_self keeps the rest
		static const TCHAR* const Availabilities[] = { TEXT("AVAILABLE"), TEXT("AWAY"), TEXT("BUSY"), TEXT("APPEAR_OFFLINE") };
		bool bKnown = false;
		for (const TCHAR* Known : Availabilities)
		{
			bKnown = bKnown || SubjectId.Equals(Known, ESearchCase::CaseSensitive);
		}
		if (!bKnown)
		{
			return Refuse(TEXT("That is not a presence choice"));
		}
		return Ask(OperationId, SubjectId, TEXT("POST"), TEXT("/presence"), Object(TEXT("availability"), SubjectId));
	}
	if (OperationId == TEXT("conversations.open")) return Ask(OperationId, SubjectId, TEXT("POST"), TEXT("/conversations"), Object(TEXT("otherUserId"), SubjectId));
	if (OperationId == TEXT("parties.create")) return Ask(OperationId, SubjectId, TEXT("POST"), TEXT("/parties"), MakeShared<FJsonObject>());
	if (OperationId == TEXT("parties.join")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/parties/%s/join"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId == TEXT("party_invites.accept")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/party-invites/%s/accept"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId == TEXT("party_invites.decline")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/party-invites/%s/decline"), *SubjectId), MakeShared<FJsonObject>());
	if (OperationId.StartsWith(TEXT("parties.")))
	{
		// The rest act on THIS player's own party: its id comes from the view, never from the subject.
		if (MyParty.IsEmpty())
		{
			return Refuse(TEXT("You are not in a party"));
		}
		if (OperationId == TEXT("parties.leave")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/parties/%s/leave"), *MyParty), MakeShared<FJsonObject>());
		if (OperationId == TEXT("parties.invite")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/parties/%s/invites"), *MyParty), Object(TEXT("toUserId"), SubjectId));
		if (OperationId == TEXT("parties.remove_member")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/parties/%s/members/%s/remove"), *MyParty, *SubjectId), MakeShared<FJsonObject>());
		if (OperationId == TEXT("parties.promote")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/parties/%s/leader"), *MyParty), Object(TEXT("memberId"), SubjectId));
		if (OperationId == TEXT("parties.rules")) return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/parties/%s/rules"), *MyParty), Object(TEXT("privacy"), SubjectId));
	}
	// JOIN / INVITE TO A WORLD: the shared presence layer (Multiplayer Phase 1). A friend's world by THEIR join rule.
	if (OperationId == TEXT("server.join")) return JoinWorld(TEXT("FRIEND"), SubjectId);
	if (OperationId == TEXT("server.invite")) return InviteToWorld(SubjectId);
	return Refuse(FString::Printf(TEXT("%s is not a social action this client knows"), *OperationId));
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::SendMessage(const FString& ConversationId, const FString& Body)
{
	if (!WonderlandSocialLiveDetail::SafeId(ConversationId))
	{
		return FWonderlandSocialActionResult{false, TEXT("That is not a valid conversation"), false};
	}
	return Ask(TEXT("messages.send"), ConversationId, TEXT("POST"), FString::Printf(TEXT("/conversations/%s/messages"), *ConversationId),
		WonderlandSocialLiveDetail::Object(TEXT("body"), Body));
}

void FWonderlandSocialLiveService::ReportPresence(bool bConnected)
{
	TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetBoolField(TEXT("connected"), bConnected);
	// THE CLIENT'S PART: connected, and what it is doing. The activity is derived by the authority's one precedence.
	TSharedPtr<FJsonObject> Signals = MakeShared<FJsonObject>();
	Signals->SetBoolField(TEXT("exploring"), bConnected);
	Body->SetObjectField(TEXT("signals"), Signals);
	Call(TEXT("POST"), TEXT("/presence"), Body, [](int32, const TSharedPtr<FJsonObject>&, const FString& Problem)
	{
		if (!Problem.IsEmpty())
		{
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live presence not reported: %s"), *Problem);
		}
	});
}

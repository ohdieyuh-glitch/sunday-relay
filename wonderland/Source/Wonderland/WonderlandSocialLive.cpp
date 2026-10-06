#include "WonderlandSocialLive.h"

#include "Dom/JsonObject.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Misc/ScopeExit.h"
#include "HAL/IConsoleManager.h"

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
	// AN OUTAGE IS SAID (Second's review of e48a5b3e, MAJOR for R9/R7): never "LIVE" over a view the server can no longer refresh
	if (bUnreachable)
	{
		return TEXT("OFFLINE · can't reach Wonderland social, retrying… (what you see is from before)");
	}
	return bHasSnapshot ? FString::Printf(TEXT("LIVE · signed in as %s"), *Snapshot.Self.Profile.DisplayName)
		: FString(TEXT("LIVE · connecting to Wonderland social"));
}

void FWonderlandSocialLiveService::NoteTransport(int32 Status, bool bReached)
{
	const bool bFailed = !bReached || Status == 0 || Status >= 500;
	if (bFailed)
	{
		++TransportFailures;
		if (!bUnreachable && TransportFailures >= 2)
		{
			bUnreachable = true;
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live: Wonderland social cannot be reached (%d answers in a row: status %d) -- OFFLINE, retrying"),
				TransportFailures, Status);
			Changed.Broadcast();
		}
		return;
	}
	TransportFailures = 0;
	if (bUnreachable)
	{
		bUnreachable = false;
		UE_LOG(LogTemp, Display, TEXT("WLSOCIAL live: Wonderland social answered again (HTTP %d) -- LIVE"), Status);
		Changed.Broadcast();
	}
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
		// EVERY ANSWER COUNTS toward "can the server be reached" (poll, snapshot, world report, actions alike), before its own handling
		NoteTransport(Status, bConnected && Response.IsValid());
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
		FString Text = Response->GetContentAsString();
		// THIS CLIENT'S OWN COPY of the answer is zeroed once read (Second's review of 4e877962: the EOS config answer carries a client
		// secret). The engine's own buffers (the HTTP payload, the JSON reader's copy, the parsed tree) are freed as the engine frees them;
		// the founder ruled that runtime delivery is not secret from the machine's owner.
		ON_SCOPE_EXIT
		{
			for (TCHAR& Character : Text.GetCharArray())
			{
				Character = 0;
			}
			Text.Empty();
		};
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
	// AN AUTOMATIC JOIN THAT WAS REFUSED is tried again on its own clock (JoinWorldAs), never two at once -- and never while ANY join is in
	// flight (Second's review of b7740150, minor 3): that join's answer decides first, and a successful one clears the plan
	if (bAutoJoinPending && !bJoinInFlight && FPlatformTime::Seconds() >= NextAutoJoinAt)
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
		HandleWorldReport(Status, Data, Problem);
	});
}

void FWonderlandSocialLiveService::HandleWorldReport(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
{
	NextWorldAt = FPlatformTime::Seconds() + (Problem.IsEmpty() ? WonderlandSocialLiveDetail::WorldSeconds : WonderlandSocialLiveDetail::RetrySeconds);
	if (!Problem.IsEmpty())
	{
		// A REFUSAL IS NEVER A REMOVAL (Second's review of 4d31c524: since b7dd6eae the server answers a removal 200 with no context).
		if (Status == 404 && bWorldWanted)
		{
			// 404 "Join a world first": the server's sweep forgot this player (silent for 15 s -- a hitch, a modal, sleep). The figures
			// shown are stale now, so they go (Second's review m5), and the SAME world is joined again quietly -- on the backoff, so a
			// server that keeps forgetting is not asked several times a second (m4). NOT while ANY join is in flight (Second's review of
			// b7740150, minor 3): a sweep 404 for the old world landing mid player-join made the old world's rejoin the latest join, so the
			// player's own answer was dropped and they ended back where they had left.
			if (!bJoinInFlight && !bAutoJoinPending)
			{
				UE_LOG(LogTemp, Display, TEXT("WLWORLD the server no longer holds this player's world (404): joining the same one again quietly"));
				RejoinContextId = WorldView.ContextId;   // a FRIEND rejoin must land in this same world, or the player is not moved (m2)
				WorldView = FWonderlandWorldView();
				WorldChanged.Broadcast();
				ScheduleAutoJoin(WorldTarget, WorldArg);
			}
		}
		else if (Problem != LastError)
		{
			// any other refusal (a 400: a position or skin the server will not take) stays put -- and is SAID, once per new reason (m3)
			UE_LOG(LogTemp, Warning, TEXT("WLWORLD the world report was refused (HTTP %d): %s -- staying"), Status, *Problem);
		}
		LastError = Problem;
		return;
	}
	if (!Data.IsValid())
	{
		// a 200 without a view (only something that is not the bridge -- a proxy -- answers so): never read as a removal
		LastError = TEXT("the world answer carried no view");
		return;
	}
	AutoJoinAttempts = 0;   // a report the server ANSWERED resets the backoff, never a join alone (m4)
	const bool bWasPrivate = WorldView.bInWorld && WorldView.Kind == TEXT("PRIVATE_SERVER");
	WorldView = WonderlandSocialLiveDetail::ParseWorldView(Data);
	if (bWasPrivate && !WorldView.bInWorld && bWorldWanted)
	{
		// TAKEN OUT OF A PRIVATE SERVER BY THE SERVER (founder P4/P5, 10-04: a block either way removes the member; the owner stays):
		// the server answers ok with NO context (Second b7dd6eae). Only the generic words, never why; then the public world this map
		// is -- joined quietly, so its "Done" can never overwrite the words (Second's review M1). If a join of the player's own is in
		// flight, the plan waits for its answer: placed somewhere, the plan is dropped; refused, it runs (never stranded out of a world).
		UE_LOG(LogTemp, Display, TEXT("WLWORLD removed from a private server by the server: back to the public world"));
		Answered.Broadcast(TEXT("world.removed"), FString(), FWonderlandSocialActionResult{false, TEXT("You can't stay in this server."), false});
		WorldChanged.Broadcast();
		RejoinContextId.Reset();
		ScheduleAutoJoin(TEXT("PUBLIC"), TEXT("golden_arrival"));
		return;
	}
	WorldChanged.Broadcast();
}

void FWonderlandSocialLiveService::ScheduleAutoJoin(const FString& Target, const FString& Arg, bool bNow)
{
	// THE ONE PLACE an automatic join is planned: at once the first time, then 2 / 5 / 15 / 30 s apart until a report is answered again
	static const double Delays[] = { 0.0, 2.0, 5.0, 15.0, 30.0 };
	AutoJoinTarget = Target;
	AutoJoinArg = Arg;
	if (bNow)
	{
		// NOT A FAILURE, SO NO BACKOFF STEP (Second's review of b7740150, minor 4): the server has already placed the player in the friend's
		// new world, and every second spent waiting shows the others there a Dog the player never chose to bring
		NextAutoJoinAt = FPlatformTime::Seconds();
	}
	else
	{
		NextAutoJoinAt = FPlatformTime::Seconds() + Delays[FMath::Min(AutoJoinAttempts, static_cast<int32>(UE_ARRAY_COUNT(Delays)) - 1)];
		AutoJoinAttempts += 1;
	}
	bAutoJoinPending = true;
}

int32 FWonderlandSocialLiveService::BeginJoin()
{
	// the in-flight flag belongs to the LATEST join, automatic or the player's own (Second's review of b7740150, minor 3)
	bJoinInFlight = true;
	bAutoJoinPending = false;   // this join replaces any planned retry; a player's own join ends the automatic ones
	// THE LATEST JOIN WINS (Second's review m1): an answer to an older join -- an automatic one overtaken by the player's own -- is read
	// for nothing: it moves no view, re-arms no retry
	return ++JoinSeq;
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::JoinWorld(const FString& Target, const FString& Arg)
{
	return JoinWorldAs(Target, Arg, false);
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::JoinWorldAs(const FString& Target, const FString& Arg, bool bAutomatic)
{
	const int32 Seq = BeginJoin();
	TSharedPtr<FJsonObject> Body = WonderlandSocialLiveDetail::Object(TEXT("target"), Target.ToUpper());
	if (Target.Equals(TEXT("PUBLIC"), ESearchCase::IgnoreCase))
	{
		Body->SetStringField(TEXT("place"), Arg.IsEmpty() ? FString(TEXT("golden_arrival")) : Arg);
		Body->SetStringField(TEXT("placeName"), TEXT("Golden Arrival"));
	}
	else if (Target.Equals(TEXT("PRIVATE"), ESearchCase::IgnoreCase)) { Body->SetStringField(TEXT("name"), Arg); }
	else if (Target.Equals(TEXT("FRIEND"), ESearchCase::IgnoreCase)) { Body->SetStringField(TEXT("userId"), Arg); }
	else if (Target.Equals(TEXT("INVITE"), ESearchCase::IgnoreCase)) { Body->SetStringField(TEXT("inviteId"), Arg); }
	Call(TEXT("POST"), TEXT("/world/join"), Body, [this, Target, Arg, bAutomatic, Seq](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		HandleJoinAnswer(Seq, Target, Arg, bAutomatic, Data, Problem);
	});
	return FWonderlandSocialActionResult{true, TEXT("Joining…"), true};
}

void FWonderlandSocialLiveService::HandleJoinAnswer(int32 Seq, const FString& Target, const FString& Arg, bool bAutomatic,
	const TSharedPtr<FJsonObject>& Data, const FString& Problem)
{
	if (Seq != JoinSeq)
	{
		UE_LOG(LogTemp, Display, TEXT("WLWORLD an earlier join's answer arrived after a newer join: ignored"));
		return;
	}
	bJoinInFlight = false;   // the latest join has answered, whoever started it
	FWonderlandSocialActionResult Answer;
	Answer.bOk = Problem.IsEmpty();
	Answer.Reason = Problem;
	const bool bFriendTarget = Target.Equals(TEXT("FRIEND"), ESearchCase::IgnoreCase);
	if (Answer.bOk)
	{
		const FWonderlandWorldView Joined = WonderlandSocialLiveDetail::ParseWorldView(Data);
		// A FRIEND REJOIN FOLLOWS THE FRIEND to wherever they are NOW (Second's review m2): if that is not the world this player was
		// in, they are not carried somewhere they never chose -- the public world instead, quietly, and AT ONCE (minor 4)
		if (bAutomatic && bFriendTarget && !RejoinContextId.IsEmpty() && Joined.ContextId != RejoinContextId)
		{
			UE_LOG(LogTemp, Display, TEXT("WLWORLD the friend's world is not the one this player was in: the public world instead"));
			RejoinContextId.Reset();
			ScheduleAutoJoin(TEXT("PUBLIC"), TEXT("golden_arrival"), true);
			Answered.Broadcast(TEXT("world.join.auto"), FString(), Answer);
			return;
		}
		RejoinContextId.Reset();
		// PLACED: no automatic join planned while this one was in flight (a removal's way back) may move the player afterwards
		bAutoJoinPending = false;
		bWorldWanted = true;
		NextWorldAt = 0.0;
		WorldView = Joined;
		WorldTarget = Target.ToUpper();   // the world a forgotten player is put back into (the 404 path above)
		WorldArg = Arg;
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
			// nothing answered) -> again, on the backoff, until it takes or the player joins somewhere themselves
			const bool bWasPublic = Target.Equals(TEXT("PUBLIC"), ESearchCase::IgnoreCase);
			RejoinContextId.Reset();
			ScheduleAutoJoin(bWasPublic ? Target : FString(TEXT("PUBLIC")), bWasPublic ? Arg : FString(TEXT("golden_arrival")));
		}
	}
	// AN AUTOMATIC JOIN ANSWERS NO SCREEN (Second's review M1): the player did not ask, and its "Done" must never overwrite a notice
	Answered.Broadcast(bAutomatic ? TEXT("world.join.auto") : TEXT("world.join"), FString(), Answer);
	Refresh();
}

FWonderlandSocialActionResult FWonderlandSocialLiveService::LeaveWorld()
{
	bWorldWanted = false;
	bAutoJoinPending = false;   // the player chose to leave: no automatic join puts them back
	bJoinInFlight = false;
	++JoinSeq;                  // nor does a join still in flight: its answer is now an earlier join's
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

FWonderlandSocialLiveService::FQaAutoJoinPlan FWonderlandSocialLiveService::QaAutoJoinPlan() const
{
	FQaAutoJoinPlan Plan;
	Plan.bPending = bAutoJoinPending;
	Plan.Target = AutoJoinTarget;
	Plan.Arg = AutoJoinArg;
	Plan.InSeconds = NextAutoJoinAt - FPlatformTime::Seconds();
	Plan.Attempts = AutoJoinAttempts;
	Plan.RejoinContextId = RejoinContextId;
	Plan.bJoinInFlight = bJoinInFlight;
	return Plan;
}

void FWonderlandSocialLiveService::QaSetWorld(const FWonderlandWorldView& View, bool bWanted)
{
	WorldView = View;
	bWorldWanted = bWanted;
	bAutoJoinPending = false;
	bJoinInFlight = false;
	AutoJoinAttempts = 0;
	RejoinContextId.Reset();
}

namespace WonderlandSocialLiveDetail
{
	/** R16 P4/P5 CLIENT QA (founder 10-04: a block either way removes the member from a private server, with the generic words only;
	 *  Second's review m6: the client has no way to own a private server, so the run proves P4/P5 at the protocol level and THIS proves
	 *  the client's half). World answers are fed as if the server sent them, into a throwaway service on a dead loopback port
	 *  (127.0.0.1:9; nothing listens, never a real server). WR1-WR9 + WRC1 (the reveal judge can fail); WR10-WR13 the join timing
	 *  (Second's review of b7740150, minors 3-4: a 404 or a removal while a join is in flight; a FRIEND rejoin that landed elsewhere).
	 *  WR10, WR11 and WR13 each fail on the rule they replaced; WR12 guards the removal's way back. WLQA WORLDRM lines. */
	FAutoConsoleCommand GQaWorldRemoval(
		TEXT("wl.Qa.WorldRemoval"),
		TEXT("QA: the client's half of a private-server removal (P4/P5) and the 404/400 world answers -- fed answers, dead loopback port."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			int32 Passed = 0;
			int32 Failed = 0;
			auto Check = [&Passed, &Failed](const FString& Id, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA WORLDRM %s %s -- %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};
			auto World = [](const FString& ContextId, const FString& Kind)
			{
				FWonderlandWorldView View;
				View.bInWorld = true;
				View.ContextId = ContextId;
				View.Kind = Kind;
				View.ServerName = TEXT("qa-owner-server");
				return View;
			};
			auto Answer = [](const FString& ContextId, const FString& Kind)
			{
				TSharedPtr<FJsonObject> Made = MakeShared<FJsonObject>();
				Made->SetArrayField(TEXT("avatars"), TArray<TSharedPtr<FJsonValue>>());
				if (!ContextId.IsEmpty())
				{
					TSharedPtr<FJsonObject> Context = MakeShared<FJsonObject>();
					Context->SetStringField(TEXT("contextId"), ContextId);
					Context->SetStringField(TEXT("kind"), Kind);
					Context->SetStringField(TEXT("serverName"), TEXT("qa-owner-server"));
					Made->SetObjectField(TEXT("context"), Context);
				}
				return Made;
			};
			TUniquePtr<FWonderlandSocialLiveService> Probe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-world"));
			TArray<FString> Ops;
			FString RemovedReason;
			bool bRemovedOk = true;
			int32 Changes = 0;
			Probe->OnAnswered().AddLambda([&Ops, &RemovedReason, &bRemovedOk](const FString& Op, const FString&, const FWonderlandSocialActionResult& Result)
			{
				Ops.Add(Op);
				if (Op == TEXT("world.removed"))
				{
					RemovedReason = Result.Reason;
					bRemovedOk = Result.bOk;
				}
			});
			Probe->OnWorldChanged().AddLambda([&Changes]() { Changes += 1; });
			const FString Private = TEXT("ctx_qa_private");

			// WR1: removed from a private server (the server answers ok with NO context): the generic words, then the public world at once
			Probe->QaSetWorld(World(Private, TEXT("PRIVATE_SERVER")), true);
			Probe->QaFeedWorldReport(200, Answer(FString(), FString()), FString());
			FWonderlandSocialLiveService::FQaAutoJoinPlan Plan = Probe->QaAutoJoinPlan();
			Check(TEXT("WR1"), Ops.Contains(TEXT("world.removed")) && RemovedReason == TEXT("You can't stay in this server.") && !bRemovedOk
				&& !Probe->GetWorldView().bInWorld && Plan.bPending && Plan.Target == TEXT("PUBLIC") && Plan.Arg == TEXT("golden_arrival") && Plan.InSeconds <= 0.5,
				FString::Printf(TEXT("a removal says the generic words and plans the public world at once (pending %d, %s/%s, in %.1f s)"),
					Plan.bPending ? 1 : 0, *Plan.Target, *Plan.Arg, Plan.InSeconds));
			// WR2: the words never say why or who; WRC1: the same judge DOES catch a reason that did
			auto Reveals = [&Private](const FString& Text)
			{
				return Text.Contains(TEXT("block")) || Text.Contains(TEXT("owner")) || Text.Contains(TEXT("qa-owner-server")) || Text.Contains(Private);
			};
			Check(TEXT("WR2"), !RemovedReason.IsEmpty() && !Reveals(RemovedReason), TEXT("the removal names no block, no owner, no server"));
			Check(TEXT("WRC1"), Reveals(TEXT("You were blocked by qa-owner-server")), TEXT("control: a reason that names the block IS caught by the same judge"));

			// WR3: the server forgot the world (404): no removal words, the stale view goes, the SAME world is planned, its context kept
			Ops.Reset();
			Changes = 0;
			Probe->QaSetWorld(World(TEXT("ctx_qa_friend"), TEXT("FRIEND_WORLD")), true);
			Probe->QaFeedWorldReport(404, nullptr, TEXT("Join a world first"));
			Plan = Probe->QaAutoJoinPlan();
			Check(TEXT("WR3"), !Ops.Contains(TEXT("world.removed")) && !Probe->GetWorldView().bInWorld && Changes >= 1 && Plan.bPending
				&& Plan.RejoinContextId == TEXT("ctx_qa_friend"),
				FString::Printf(TEXT("a 404 is not a removal: view cleared (%d change), rejoin planned, context kept"), Changes));
			// WR4: a server that keeps forgetting is asked on the backoff (2 s, then 5 s), and an ANSWERED report resets it
			Probe->QaClearPendingJoin();
			Probe->QaFeedWorldReport(404, nullptr, TEXT("Join a world first"));
			const double Wait1 = Probe->QaAutoJoinPlan().InSeconds;
			Probe->QaClearPendingJoin();
			Probe->QaFeedWorldReport(404, nullptr, TEXT("Join a world first"));
			const double Wait2 = Probe->QaAutoJoinPlan().InSeconds;
			Probe->QaClearPendingJoin();
			Probe->QaFeedWorldReport(200, Answer(TEXT("pub_qa"), TEXT("PUBLIC")), FString());
			Check(TEXT("WR4"), Wait1 > 1.5 && Wait1 <= 2.1 && Wait2 > 4.5 && Wait2 <= 5.1 && Probe->QaAutoJoinPlan().Attempts == 0,
				FString::Printf(TEXT("backoff %.1f s then %.1f s; an answered report resets it (attempts %d)"), Wait1, Wait2, Probe->QaAutoJoinPlan().Attempts));
			// WR5: any other refusal (400) keeps the player where they are: no removal, no join, the view unchanged
			Ops.Reset();
			Probe->QaSetWorld(World(TEXT("pub_qa"), TEXT("PUBLIC")), true);
			Probe->QaFeedWorldReport(400, nullptr, TEXT("position out of range"));
			Check(TEXT("WR5"), Ops.Num() == 0 && !Probe->QaAutoJoinPlan().bPending && Probe->GetWorldView().ContextId == TEXT("pub_qa"),
				TEXT("a 400 keeps the player in the same world, says nothing on screen, plans no join"));
			// WR6: no context after a PUBLIC world is not a private-server removal
			Probe->QaFeedWorldReport(200, Answer(FString(), FString()), FString());
			Check(TEXT("WR6"), !Ops.Contains(TEXT("world.removed")), TEXT("leaving a PUBLIC world never shows the removal words"));
			// WR7: the same private server answered with its context: nothing happens
			Probe->QaSetWorld(World(Private, TEXT("PRIVATE_SERVER")), true);
			Probe->QaFeedWorldReport(200, Answer(Private, TEXT("PRIVATE_SERVER")), FString());
			Check(TEXT("WR7"), !Ops.Contains(TEXT("world.removed")) && Probe->GetWorldView().ContextId == Private && !Probe->QaAutoJoinPlan().bPending,
				TEXT("a private server that still holds the player: no removal"));
			// WR8: a player who chose to leave is never told they were removed, nor put back
			Probe->QaSetWorld(World(Private, TEXT("PRIVATE_SERVER")), false);
			Probe->QaFeedWorldReport(200, Answer(FString(), FString()), FString());
			Check(TEXT("WR8"), !Ops.Contains(TEXT("world.removed")) && !Probe->QaAutoJoinPlan().bPending, TEXT("no removal words or rejoin for a player who left"));
			// WR9: a 200 without a view (a proxy, never the bridge) is not a removal either
			Probe->QaSetWorld(World(Private, TEXT("PRIVATE_SERVER")), true);
			Probe->QaFeedWorldReport(200, nullptr, FString());
			Check(TEXT("WR9"), !Ops.Contains(TEXT("world.removed")) && Probe->GetWorldView().ContextId == Private,
				TEXT("an ok answer with no body keeps the player and shows nothing"));
			// WR10 (Second's review of b7740150, minor 3): a sweep 404 for the OLD world that lands while the player's OWN join is in flight
			// plans nothing, and the player's answer places them where they chose (the old rule planned the old world's rejoin here, which
			// became the latest join and dropped the player's answer)
			Ops.Reset();
			Probe->QaSetWorld(World(TEXT("pub_qa_old"), TEXT("PUBLIC")), true);
			const int32 PlayerSeq = Probe->QaBeginJoin();
			Probe->QaFeedWorldReport(404, nullptr, TEXT("Join a world first"));
			const FWonderlandSocialLiveService::FQaAutoJoinPlan MidJoin = Probe->QaAutoJoinPlan();
			Probe->QaFeedJoinAnswer(PlayerSeq, TEXT("FRIEND"), TEXT("ghu-qa-friend"), false, Answer(TEXT("ctx_qa_chosen"), TEXT("FRIEND_WORLD")), FString());
			Plan = Probe->QaAutoJoinPlan();
			Check(TEXT("WR10"), !MidJoin.bPending && MidJoin.bJoinInFlight && Probe->GetWorldView().ContextId == TEXT("ctx_qa_chosen") && !Plan.bPending
				&& !Plan.bJoinInFlight,
				FString::Printf(TEXT("a 404 mid player-join plans no rejoin (pending %d, in flight %d); the player's own answer places them (%s)"),
					MidJoin.bPending ? 1 : 0, MidJoin.bJoinInFlight ? 1 : 0, *Probe->GetWorldView().ContextId));
			// WR11 (minor 4): an automatic FRIEND rejoin that lands in a different world plans the public world AT ONCE, with no backoff step
			Probe->QaSetWorld(World(TEXT("ctx_qa_friend_old"), TEXT("FRIEND_WORLD")), true);
			Probe->QaFeedWorldReport(404, nullptr, TEXT("Join a world first"));   // the sweep: the same world is planned, its context kept
			const int32 AttemptsBefore = Probe->QaAutoJoinPlan().Attempts;
			const int32 AutoSeq = Probe->QaBeginJoin();                          // that automatic FRIEND rejoin leaves
			Probe->QaFeedJoinAnswer(AutoSeq, TEXT("FRIEND"), TEXT("ghu-qa-friend"), true, Answer(TEXT("ctx_qa_friend_new"), TEXT("FRIEND_WORLD")), FString());
			Plan = Probe->QaAutoJoinPlan();
			Check(TEXT("WR11"), Plan.bPending && Plan.Target == TEXT("PUBLIC") && Plan.InSeconds <= 0.5 && Plan.Attempts == AttemptsBefore,
				FString::Printf(TEXT("a FRIEND rejoin that landed elsewhere plans the public world at once (in %.1f s, attempts %d -> %d)"),
					Plan.InSeconds, AttemptsBefore, Plan.Attempts));
			// WR12: a removal while the player's own join is in flight still says the words; the way back waits for that join, and a
			// REFUSED join leaves it planned, so nobody is stranded outside every world
			Ops.Reset();
			Probe->QaSetWorld(World(Private, TEXT("PRIVATE_SERVER")), true);
			const int32 RefusedSeq = Probe->QaBeginJoin();
			Probe->QaFeedWorldReport(200, Answer(FString(), FString()), FString());
			const FWonderlandSocialLiveService::FQaAutoJoinPlan Waiting = Probe->QaAutoJoinPlan();
			Probe->QaFeedJoinAnswer(RefusedSeq, TEXT("FRIEND"), TEXT("ghu-qa-friend"), false, nullptr, TEXT("That world is full."));
			Plan = Probe->QaAutoJoinPlan();
			Check(TEXT("WR12"), Ops.Contains(TEXT("world.removed")) && Waiting.bPending && Waiting.bJoinInFlight && Plan.bPending
				&& Plan.Target == TEXT("PUBLIC") && !Plan.bJoinInFlight,
				TEXT("a removal mid-join says the words; the public world stays planned and runs once the refused join has answered"));
			// WR13: the same, but the player's join PLACES them: the planned way back is dropped (they are where they chose to be)
			Ops.Reset();
			Probe->QaSetWorld(World(Private, TEXT("PRIVATE_SERVER")), true);
			const int32 PlacedSeq = Probe->QaBeginJoin();
			Probe->QaFeedWorldReport(200, Answer(FString(), FString()), FString());
			Probe->QaFeedJoinAnswer(PlacedSeq, TEXT("FRIEND"), TEXT("ghu-qa-friend"), false, Answer(TEXT("ctx_qa_chosen2"), TEXT("FRIEND_WORLD")), FString());
			Plan = Probe->QaAutoJoinPlan();
			Check(TEXT("WR13"), Ops.Contains(TEXT("world.removed")) && !Plan.bPending && Probe->GetWorldView().ContextId == TEXT("ctx_qa_chosen2"),
				TEXT("a removal mid-join, then the player's join places them: the planned public world is dropped"));
			Probe.Reset();
			UE_LOG(LogTemp, Display, TEXT("WLQA WORLDRM END pass=%d fail=%d"), Passed, Failed);
		}));

	/** R9/R7 CLIENT QA (Second's review of e48a5b3e, MAJOR): an outage of the social server is SAID -- the hub's source line reads OFFLINE
	 *  after two transport failures in a row (no connection, status 0, a 5xx) and LIVE again at the first answer the server gives, each
	 *  change broadcast once so the hub repaints. Answers fed as Call would note them, into a throwaway service on a dead loopback port.
	 *  RC1 is the control: ONE failure alone does not flip the line. WLQA REACH lines. */
	FAutoConsoleCommand GQaSocialReach(
		TEXT("wl.Qa.SocialReach"),
		TEXT("QA: the hub says OFFLINE when Wonderland social cannot be reached (two failures in a row) and LIVE when it answers -- fed answers."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			int32 Passed = 0;
			int32 Failed = 0;
			auto Check = [&Passed, &Failed](const FString& Id, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA REACH %s %s -- %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};
			TUniquePtr<FWonderlandSocialLiveService> Probe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-reach"));
			int32 Changes = 0;
			Probe->OnChanged().AddLambda([&Changes]() { Changes += 1; });
			const auto Live = [&Probe]() { return Probe->GetSourceLine().StartsWith(TEXT("LIVE")); };
			const auto Offline = [&Probe]() { return Probe->GetSourceLine().StartsWith(TEXT("OFFLINE")); };
			// RC1 THE CONTROL: one lost answer is a blip, not an outage
			Probe->QaNoteTransport(0, false);
			Check(TEXT("RC1"), Live() && !Probe->IsUnreachable() && Changes == 0, FString::Printf(TEXT("control: one failure alone keeps '%s' (%d changes)"), *Probe->GetSourceLine(), Changes));
			// R1: the second in a row is an outage, said once
			Probe->QaNoteTransport(0, false);
			Check(TEXT("R1"), Offline() && Probe->IsUnreachable() && Changes == 1, FString::Printf(TEXT("two failures in a row: '%s' (%d change)"), *Probe->GetSourceLine(), Changes));
			// R2: more failures change nothing more
			Probe->QaNoteTransport(0, false);
			Check(TEXT("R2"), Offline() && Changes == 1, FString::Printf(TEXT("a third failure: still offline, no new change (%d)"), Changes));
			// R3: the first answer the server gives is LIVE again, said once
			Probe->QaNoteTransport(200, true);
			Check(TEXT("R3"), Live() && !Probe->IsUnreachable() && Changes == 2, FString::Printf(TEXT("one 200: '%s' (%d changes)"), *Probe->GetSourceLine(), Changes));
			// R4: 5xx answers are the server failing too
			Probe->QaNoteTransport(503, true);
			Probe->QaNoteTransport(502, true);
			Check(TEXT("R4"), Offline() && Changes == 3, FString::Printf(TEXT("503 then 502: '%s' (%d changes)"), *Probe->GetSourceLine(), Changes));
			// R5: any answer the server GAVE means it was reached: 404, 400, 429 and 401 each bring it back and never count as an outage
			Probe->QaNoteTransport(404, true);
			const bool bBack = Live() && Changes == 4;
			Probe->QaNoteTransport(400, true);
			Probe->QaNoteTransport(429, true);
			Probe->QaNoteTransport(401, true);
			Probe->QaNoteTransport(404, true);
			Check(TEXT("R5"), bBack && Live() && Changes == 4, FString::Printf(TEXT("4xx answers (404, 400, 429, 401) reach the server: '%s' (%d changes)"), *Probe->GetSourceLine(), Changes));
			// R6: a failure, an answer, a failure is never two in a row
			Probe->QaNoteTransport(0, false);
			Probe->QaNoteTransport(200, true);
			Probe->QaNoteTransport(0, false);
			Check(TEXT("R6"), Live() && Changes == 4, FString::Printf(TEXT("failure, answer, failure: never two in a row ('%s', %d changes)"), *Probe->GetSourceLine(), Changes));
			Probe.Reset();
			UE_LOG(LogTemp, Display, TEXT("WLQA REACH END pass=%d fail=%d"), Passed, Failed);
		}));
}

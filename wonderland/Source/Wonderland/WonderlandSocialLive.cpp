#include "WonderlandSocialLive.h"

#include "Dom/JsonObject.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Misc/ScopeExit.h"
#include "Misc/SecureHash.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/IConsoleManager.h"
#include "WonderlandSocialReconnectPolicy.h"

namespace WonderlandSocialFreshness
{
	bool& GateMutatedOffFlag()
	{
		static bool bOff = false;
		return bOff;
	}

	bool IsGateMutatedOff()
	{
		return GateMutatedOffFlag();
	}

	void SetGateMutatedOff(bool bOff)
	{
#if UE_BUILD_SHIPPING
		(void)bOff;   // never in a shipped build
#else
		// a developer session only (-wldev), whoever asks: a player's session can never turn the privacy gate off
		GateMutatedOffFlag() = bOff && FParse::Param(FCommandLine::Get(), TEXT("wldev"));
		UE_LOG(LogTemp, Warning, TEXT("WLDEV MUTATION social gate %s"), GateMutatedOffFlag() ? TEXT("OFF (control: cached people are drawn on open, as before SC1)") : TEXT("ON"));
#endif
	}
}

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
	/** B35: the longest gap between periodic reads after failures while a surface is open (the surface withholds people meanwhile). */
	constexpr double MaxReadBackoffSeconds = 8.0;

	/** B35: the view's identity without its own clock (generatedAtIso is new on every read): equal digests = nothing to redraw. The server
	 *  sends an online player's lastSeenAtIso as null (social-commands.ts, "steady"), so an unchanged view reads the same. SHA-1 of the
	 *  condensed JSON, so a changed view is never mistaken for the old one. */
	FString ViewDigest(const TSharedPtr<FJsonObject>& Data)
	{
		if (!Data.IsValid())
		{
			return FString();
		}
		const TSharedRef<FJsonObject> Copy = MakeShared<FJsonObject>(*Data);
		Copy->RemoveField(TEXT("generatedAtIso"));
		FString Canon;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Canon);
		FJsonSerializer::Serialize(Copy, Writer);
		FSHA1 Sha;
		{
			const FTCHARToUTF8 Utf8(*Canon);
			Sha.Update(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
		}
		Sha.Final();
		uint8 Hash[FSHA1::DigestSize];
		Sha.GetHash(Hash);
		// the copy holds what the view holds (names, message bodies): zeroed like every answer this client reads (Call)
		for (TCHAR& Character : Canon.GetCharArray())
		{
			Character = 0;
		}
		return BytesToHex(Hash, FSHA1::DigestSize);
	}
	/** The shared presence layer's report, each answered with the view. The gap AFTER an answer (so the period is round trip + this + tick rounding).
	 *  r16reh16b: 0.2 -> 0.1 s. (Alone it changed nothing: the shared Tick runs every 0.25 s and gated the report; r16reh16c adds TickWorldFast, a 50 ms ticker.) Measured period 255 ms at 13 ms RTT; remote motion showed surge/stall at that rate. The server stores one report per 100 ms
	 *  (WORLD_REPORT_MIN_INTERVAL_MS) and its `report` budget is a burst of 30 then one per 100 ms (SOCIAL_BUDGETS.report), so the period always stays above
	 *  the floor (RTT + 0.1 s) and far inside the budget; over budget would be 429 + a RetrySeconds wait, which this margin avoids. */
	constexpr double WorldSeconds = 0.1;
	TAutoConsoleVariable<int32> CVarWorldFastTick(TEXT("wl.Remote.FastWorldTick"), 1,
		TEXT("Social: 1 sends the world report from a dedicated 50 ms ticker (about 8 a second), 0 leaves it on the shared 0.25 s tick (4 a second, the old cadence)."));
	/** r16reh16w reconnect fixes, each a rollback: 0 puts the old behaviour back. */
	TAutoConsoleVariable<int32> CVarRejoin404Replan(TEXT("wl.Remote.Rejoin404Replan"), 1,
		TEXT("Social: 1 plans the rejoin of a 404 that landed while a join was in flight once that join answers without placing the player, 0 drops it (the old behaviour)."));
	TAutoConsoleVariable<int32> CVarRejoinKeepTarget(TEXT("wl.Remote.RejoinKeepTarget"), 1,
		TEXT("Social: 1 says a refused INVITE or PARTY rejoin target and asks for it again (bounded) before the public world, 0 falls back to the public world at once and silently (the old behaviour)."));
	TAutoConsoleVariable<int32> CVarLeaveRetry(TEXT("wl.Remote.LeaveRetry"), 1,
		TEXT("Social: 1 sends world.leave once more, a second later, when the first never reached the server, 0 sends it once (the old behaviour)."));
	constexpr double LeaveRetrySeconds = 1.0;
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
				// MP-VIS-02 REV2: the optional equipped-handoff enum and the optional latest event, each decoded against a WHITELIST (exact names, whole positive seq, a bounded age);
				// absent (an older server) or anything else is None / no event. No string is ever kept, used as a name, a path or an asset.
				FString HandoffWire;
				if (A->TryGetStringField(TEXT("handoff"), HandoffWire))
				{
					R.Handoff = WonderlandHandoffWire::FromWire(HandoffWire);
				}
				const TSharedPtr<FJsonObject>* EventObject = nullptr;
				if (A->TryGetObjectField(TEXT("handoffEvent"), EventObject) && EventObject != nullptr && (*EventObject).IsValid())
				{
					FString KindWire;
					FString FormWire;
					double SeqNumber = 0.0;
					double EventAge = 0.0;
					(*EventObject)->TryGetStringField(TEXT("kind"), KindWire);
					(*EventObject)->TryGetStringField(TEXT("form"), FormWire);
					(*EventObject)->TryGetNumberField(TEXT("seq"), SeqNumber);
					(*EventObject)->TryGetNumberField(TEXT("ageMs"), EventAge);
					R.HandoffEvent.Kind = WonderlandHandoffWire::KindFromWire(KindWire);
					R.HandoffEvent.Form = WonderlandHandoffWire::FromWire(FormWire);
					R.HandoffEvent.Seq = SeqNumber >= 1.0 && SeqNumber <= 2147483647.0 ? static_cast<int32>(SeqNumber) : 0;
					R.HandoffEvent.AgeMs = FMath::Clamp(EventAge, 0.0, 60000.0);
					R.HandoffEvent.bValid = R.HandoffEvent.Kind != WonderlandHandoffWire::EKind::None && R.HandoffEvent.Form != WonderlandHandoffWire::EForm::None && R.HandoffEvent.Seq > 0;
				}
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

FString WonderlandSocialSnapshotLine(const FWonderlandSocialSnapshot& View)
{
	return FString::Printf(TEXT("WLSOCIAL live snapshot: %s, %d friends, %d requests in, %d conversations, party %s | recent %d"), *View.ViewerId,
		View.Friends.Num(), View.IncomingRequests.Num(), View.Conversations.Num(), View.bHasParty ? *View.Party.Name : TEXT("none"), View.RecentPlayers.Num());
}

FWonderlandSocialLiveService::FWonderlandSocialLiveService(const FString& InBaseUrl, const FString& InToken)
	: BaseUrl(InBaseUrl.TrimStartAndEnd())
	, Token(InToken.TrimStartAndEnd())
{
	BaseUrl.RemoveFromEnd(TEXT("/"));
	TickerHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FWonderlandSocialLiveService::Tick), 0.25f);
	WorldTickerHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateRaw(this, &FWonderlandSocialLiveService::TickWorldFast), 0.05f);
	// R16 CF-1: the arrival counts as movement, so the "exploring" this first report says holds for ExploringHoldSeconds
	PresenceReporter = FWonderlandPresenceReporter(FPlatformTime::Seconds());
	ReportPresence(true);
	Refresh();
}

FWonderlandSocialLiveService::~FWonderlandSocialLiveService()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickerHandle);
	FTSTicker::GetCoreTicker().RemoveTicker(WorldTickerHandle);
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
		LastRetryAfterSeconds = 0;
		if (!bConnected || !Response.IsValid())
		{
			Done(0, nullptr, TEXT("Wonderland social could not be reached"));
			return;
		}
		// A 429 SAYS HOW LONG TO WAIT (Retry-After, whole seconds, as every social 429 sends it): read here, just before Done, for the
		// LFF surfaces to show (CallLff); every other caller ignores it
		if (Status == 429)
		{
			LastRetryAfterSeconds = FMath::Clamp(FCString::Atoi(*Response->GetHeader(TEXT("Retry-After"))), 0, 24 * 60 * 60);
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

#if !UE_BUILD_SHIPPING
void FWonderlandSocialLiveService::QaLand(const FWonderlandSocialSnapshot& View, double IssuedAt)
{
	static int32 QaLandings = 0;
	Snapshot = View;
	SnapshotDigest = FString::Printf(TEXT("qa-%d"), ++QaLandings);
	bHasSnapshot = true;
	SnapshotAt = FPlatformTime::Seconds();
	SnapshotIssuedAt = IssuedAt;
	UE_LOG(LogTemp, Display, TEXT("WLSOCIAL QA landed a view issued %.3f s ago: %s"), FPlatformTime::Seconds() - IssuedAt, *WonderlandSocialSnapshotLine(Snapshot));
	Changed.Broadcast();
	ReadLanded.Broadcast();
}
#endif

void FWonderlandSocialLiveService::SetSurfaceOpen(bool bOpen)
{
	if (bSurfaceOpen == bOpen)
	{
		return;
	}
	bSurfaceOpen = bOpen;
	if (!bOpen)
	{
		// back on the closed clock: the next periodic read is a full ResyncSeconds after the last one, and a failure's gap is forgotten
		NextResyncAt = FMath::Max(NextResyncAt, LastReadIssuedAt + WonderlandSocialLiveDetail::ResyncSeconds);
		ReadNotBefore = 0.0;
	}
}

void FWonderlandSocialLiveService::Refresh()
{
	if (bRefreshing)
	{
		bRefreshAgain = true;   // a change arrived while reading (or a surface opened): read once more when this read lands
		return;
	}
	bRefreshing = true;
	// B35: THE ISSUE TIME is what freshness is judged by: the server answered with what it knew at or after this moment
	const double IssuedAt = FPlatformTime::Seconds();
	LastReadIssuedAt = IssuedAt;
	++ReadsIssued;
	Call(TEXT("GET"), TEXT("/snapshot"), nullptr, [this, IssuedAt](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		bRefreshing = false;
		FWonderlandSocialSnapshot Parsed;
		FString ParseProblem;
		if (!Problem.IsEmpty() || !WonderlandParseSocialView(Data, false, Parsed, ParseProblem))
		{
			LastError = Problem.IsEmpty() ? FString::Printf(TEXT("the live view was refused: %s"), *ParseProblem) : Problem;
			ReadProblem = LastError;
			// B35: AN OPEN SURFACE KEEPS WITHHOLDING while reads fail (the UI's freshness rule), and is not asked again every tick: a 429 waits
			// its Retry-After, anything else a gap that doubles from OpenResyncSeconds up to MaxReadBackoffSeconds
			ReadFailures = FMath::Min(ReadFailures + 1, 16);
			const double Gap = Status == 429 ? FMath::Max(1.0, static_cast<double>(LastRetryAfterSeconds))
				: FMath::Min(WonderlandSocialLiveDetail::MaxReadBackoffSeconds, WonderlandSocialFreshness::OpenResyncSeconds * FMath::Pow(2.0, static_cast<double>(FMath::Min(ReadFailures - 1, 4))));
			ReadNotBefore = FPlatformTime::Seconds() + Gap;
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live snapshot failed: %s (next periodic read in %.2f s)"), *LastError, Gap);
		}
		else
		{
			ReadFailures = 0;
			ReadNotBefore = 0.0;
			ReadProblem.Reset();
			const FString Digest = WonderlandSocialLiveDetail::ViewDigest(Data);
			const bool bViewChanged = !bHasSnapshot || Digest.IsEmpty() || Digest != SnapshotDigest;
			Snapshot = MoveTemp(Parsed);
			SnapshotDigest = Digest;
			bHasSnapshot = true;
			SnapshotAt = FPlatformTime::Seconds();
			SnapshotIssuedAt = IssuedAt;
			LastError.Reset();
			// B35 (M2 P9): EVERY landed read, changed or not, with how long ago it was issued -- a diagnostic proves "no read landed between the
			// hide and the open" from these lines (an unchanged read is otherwise silent)
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL read landed: issued %.0f ms ago, view %s, surface %s"), (FPlatformTime::Seconds() - IssuedAt) * 1000.0,
				bViewChanged ? TEXT("changed") : TEXT("unchanged"), bSurfaceOpen ? TEXT("open") : TEXT("closed"));
			if (bViewChanged)
			{
				UE_LOG(LogTemp, Log, TEXT("%s"), *WonderlandSocialSnapshotLine(Snapshot));
				Changed.Broadcast();
			}
			ReadLanded.Broadcast();
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
	const double Now = FPlatformTime::Seconds();
	if (!bRefreshing && Now >= ReadNotBefore)
	{
		if (bSurfaceOpen)
		{
			// B35: AN OPEN SURFACE IS READ AGAIN OpenResyncSeconds AFTER THE LAST READ WAS ISSUED -- not after it landed, and not on the closed
			// clock below (RV-B35-01: the open's own read left the next one waiting for a deadline set while the hub was closed, up to ~20 s)
			if (Now - LastReadIssuedAt >= WonderlandSocialFreshness::OpenResyncSeconds)
			{
				Refresh();
			}
		}
		// At most one resync per ResyncSeconds, so a server that keeps failing is not asked again every tick.
		else if (bHasSnapshot && Now >= NextResyncAt)
		{
			NextResyncAt = Now + WonderlandSocialLiveDetail::ResyncSeconds;
			if (Now - SnapshotAt >= WonderlandSocialLiveDetail::ResyncSeconds)
			{
				Refresh();
			}
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
	if (ActivitySource)
	{
		TickActivity();
	}
	return true;
}

bool FWonderlandSocialLiveService::TickWorldFast(float)
{
	// The same guard as Tick's world branch (whichever ticker runs first sets bWorldBusy, so a report never goes out twice). The shared Tick runs every
	// 0.25 s, so before this the world report could never leave faster than 4 a second whatever WorldSeconds said (measured: period 255 ms at a 13 ms RTT).
	if (bSessionEnded || WonderlandSocialLiveDetail::CVarWorldFastTick.GetValueOnGameThread() == 0)
	{
		return true;
	}
	if (bWorldWanted && !bWorldBusy && FPlatformTime::Seconds() >= NextWorldAt)
	{
		TickWorld();
	}
	return true;
}

void FWonderlandSocialLiveService::TickActivity()
{
	FWonderlandActivitySample Sample;
	if (!ActivitySource(Sample))
	{
		return;   // nothing to read this tick (no Dog yet, a map loading): what the server holds stands
	}
	const double Now = FPlatformTime::Seconds();
	const FWonderlandPresenceSignals Wanted = PresenceReporter.Want(Sample, Now);
	// THE PARTY AS THIS VIEW LAST SAID IT: joining or leaving one (or being removed) re-reports, so the authority derives IN PARTY anew
	const FString PartyKey = bHasSnapshot && Snapshot.bHasParty ? Snapshot.Party.PartyId : FString();
	if (PresenceReporter.IsDue(Wanted, PartyKey, Now))
	{
		SendPresence(true, Wanted, PartyKey);
	}
}

void FWonderlandSocialLiveService::NotePopulation()
{
	if (!WorldView.bInWorld)
	{
		// out of every world (a leave, a forgotten world, a removal): the next world's population is said again, whatever it is
		LoggedPopulation = -1;
		LoggedPopulationContext.Reset();
		return;
	}
	if (WorldView.Population == LoggedPopulation && WorldView.ContextId == LoggedPopulationContext)
	{
		return;
	}
	LoggedPopulation = WorldView.Population;
	LoggedPopulationContext = WorldView.ContextId;
	// THE POPULATION THIS VIEWER IS SHOWN (worldViewFor counts the viewer and those visible to them: P1 keeps a hidden player out of it)
	LastPopulationLine = FString::Printf(TEXT("WLWORLD population %d in %s (%s)"), WorldView.Population, *WorldView.ContextId, *WorldView.ServerName);
	PopulationLineCount += 1;
	UE_LOG(LogTemp, Display, TEXT("%s"), *LastPopulationLine);
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
	// MP-VIS-02 REV2. THE EQUIPPED FORM goes ONLY while a form is equipped (absent = NONE on the server): a player who never hands off sends exactly the bytes they always did,
	// to any server. THE ACTIVATION EVENT is made on an EDGE of that form and is resent with every report for ResendSeconds (the server keeps the first copy, ignores the rest, so a
	// lost report loses nothing and a duplicate changes nothing). A restored HELD (the form is already equipped on the first report) makes NO event: nothing is replayed.
	// Nothing goes once a server has refused it (bHandoffWireRefused).
	{
		using namespace WonderlandHandoffWire;
		const double NowSeconds = FPlatformTime::Seconds();
		if (HandoffEpoch == 0)
		{
			HandoffEpoch = FMath::RandRange(1, 2147483000);
		}
		if (Report.Handoff != PrevHandoffForm)
		{
			// how far into its own sequence the owner's state already is (a report that waited for the network may first see Transforming)
			const double PhaseMs = static_cast<double>(Report.HandoffPhaseSeconds) * 1000.0;
			double Elapsed = PhaseMs;
			if (Report.HandoffLocalState == EWonderlandHandoffState::Transforming) { Elapsed += FWonderlandMissionHandoff::AcknowledgeSeconds * 1000.0; }
			if (Report.HandoffLocalState == EWonderlandHandoffState::Delivering) { Elapsed += (FWonderlandMissionHandoff::AcknowledgeSeconds + FWonderlandMissionHandoff::TransformSeconds) * 1000.0; }
			const bool bBegan = Report.Handoff == EForm::TwinSwords && (Report.HandoffLocalState == EWonderlandHandoffState::Acknowledged
				|| Report.HandoffLocalState == EWonderlandHandoffState::Transforming || Report.HandoffLocalState == EWonderlandHandoffState::Delivering);
			const bool bReturned = Report.Handoff == EForm::None && PrevHandoffForm == EForm::TwinSwords && Report.HandoffLocalState == EWonderlandHandoffState::Returning;
			if (bBegan || bReturned)
			{
				OutgoingHandoffEvent.bActive = true;
				OutgoingHandoffEvent.N = ++HandoffCounter;
				OutgoingHandoffEvent.Kind = bBegan ? EKind::Activate : EKind::Deactivate;
				OutgoingHandoffEvent.Form = EForm::TwinSwords;
				OutgoingHandoffEvent.CreatedAt = NowSeconds;
				OutgoingHandoffEvent.InitialSinceMs = bBegan ? Elapsed : PhaseMs;
				UE_LOG(LogTemp, Display, TEXT("WLHANDOFF send event=%s epoch=%d n=%d sinceMs=%.0f"), KindToWire(OutgoingHandoffEvent.Kind), HandoffEpoch, OutgoingHandoffEvent.N, OutgoingHandoffEvent.InitialSinceMs);
			}
			PrevHandoffForm = Report.Handoff;
		}
	}
	const bool bResendEvent = OutgoingHandoffEvent.bActive && FPlatformTime::Seconds() - OutgoingHandoffEvent.CreatedAt < WonderlandHandoffWire::ResendSeconds;
	if (!bResendEvent)
	{
		OutgoingHandoffEvent.bActive = false;
	}
	// SC2: never with replication off -- the source already leaves the form at NONE then (WonderlandSocialSubsystem), and this also stops an event made
	// before the switch was turned off from being resent
	const bool bSendHandoff = WonderlandHandoffWire::IsReplicationOn() && !bHandoffWireRefused && (Report.Handoff != WonderlandHandoffWire::EForm::None || bResendEvent);
	if (bSendHandoff)
	{
		if (Report.Handoff != WonderlandHandoffWire::EForm::None)
		{
			Body->SetStringField(TEXT("handoff"), WonderlandHandoffWire::ToWire(Report.Handoff));
		}
		if (bResendEvent)
		{
			TSharedPtr<FJsonObject> Event = MakeShared<FJsonObject>();
			Event->SetNumberField(TEXT("epoch"), HandoffEpoch);
			Event->SetNumberField(TEXT("n"), OutgoingHandoffEvent.N);
			Event->SetStringField(TEXT("kind"), WonderlandHandoffWire::KindToWire(OutgoingHandoffEvent.Kind));
			Event->SetStringField(TEXT("form"), WonderlandHandoffWire::ToWire(OutgoingHandoffEvent.Form));
			// the transition began this long ago: when it was made plus however long this copy has waited (the server clamps it to one second)
			Event->SetNumberField(TEXT("sinceMs"), FMath::FloorToDouble(OutgoingHandoffEvent.InitialSinceMs + (FPlatformTime::Seconds() - OutgoingHandoffEvent.CreatedAt) * 1000.0));
			Body->SetObjectField(TEXT("handoffEvent"), Event);
		}
	}
	{
		const int32 SendKey = (static_cast<int32>(Report.HandoffLocalState) << 4) | (bSendHandoff ? 1 : 0) | (bHandoffWireRefused ? 2 : 0);
		if (SendKey != LoggedHandoffSendKey)
		{
			if (LoggedHandoffSendKey >= 0 || SendKey != 0)   // the first, idle line is not news
			{
				static const TCHAR* const StateNames[] = { TEXT("Idle"), TEXT("Acknowledged"), TEXT("Transforming"), TEXT("Delivering"), TEXT("Held"), TEXT("Returning") };
				const int32 StateIndex = static_cast<int32>(Report.HandoffLocalState);
				UE_LOG(LogTemp, Display, TEXT("WLHANDOFF send state=%s form=%s%s"), StateIndex >= 0 && StateIndex < 6 ? StateNames[StateIndex] : TEXT("?"),
					bSendHandoff && Report.Handoff != WonderlandHandoffWire::EForm::None ? WonderlandHandoffWire::ToWire(Report.Handoff) : TEXT("(field omitted)"), bHandoffWireRefused ? TEXT(" server-refused") : TEXT(""));
			}
			LoggedHandoffSendKey = SendKey;
		}
	}
	{
		// SC2 EVIDENCE: the NAMES of the fields this report carries (never their values), said once and again whenever the set changes, so a run log
		// shows what leaves this machine at the build's defaults (r16reh16u: x,y,z,yaw,speed,motion,skinId)
		TArray<FString> Keys;
		for (const auto& Field : Body->Values)
		{
			Keys.Add(FString(*Field.Key));   // FString or UE 5.8's FSharedString key: both give their characters by operator*
		}
		const FString KeyLine = FString::Join(Keys, TEXT(","));
		if (KeyLine != LoggedReportKeys)
		{
			LoggedReportKeys = KeyLine;
			UE_LOG(LogTemp, Display, TEXT("WLWORLD report fields: %s"), *KeyLine);
		}
	}
	bWorldBusy = true;
	// WLREMOTE: diagnostics only (one line per report: the soles sent, the round trip, the send period).
	const double SentAt = FPlatformTime::Seconds();
	const double SentPeriodMs = LastWorldSentAt > 0.0 ? (SentAt - LastWorldSentAt) * 1000.0 : 0.0;
	LastWorldSentAt = SentAt;
	const FVector SentSoles = Report.Location;
	// WLREMOTE motion: the sender's label with the soles z and vertical speed (log only; no allocation; the send cadence).
	UE_LOG(LogTemp, Display, TEXT("WLREMOTE send motion=%s z=%.1f vz=%.1f period=%.0fms"), *Report.Motion, Report.Location.Z, static_cast<double>(Report.VerticalSpeed), SentPeriodMs);
	const float SentYaw = Report.Yaw;
	// ONE CALL A TICK: the report answers with who else is here.
	Call(TEXT("POST"), TEXT("/world/state"), Body, [this, SentAt, SentPeriodMs, SentSoles, SentYaw, bSendHandoff](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		bWorldBusy = false;
		if (bSendHandoff && Status == 400 && !bHandoffWireRefused)
		{
			// DEGRADE, NEVER BREAK: a server that rejects the fields would otherwise cost this player every position report while the swords are out
			bHandoffWireRefused = true;
			UE_LOG(LogTemp, Warning, TEXT("WLHANDOFF send: the server refused the report that carried the handoff (HTTP 400); the fields are dropped for this session"));
		}
		const double RoundTrip = FPlatformTime::Seconds() - SentAt;
		if (Problem.IsEmpty())
		{
			// B33 (wl.Remote.RttClock): the round trip's FLOOR, not its spikes -- half way down to a shorter trip at once, up by 5 % of a longer one per report
			// (a spike counts at most +100 ms, so one slow answer moves the remote figures' sample clock by at most 5 ms)
			if (WorldRttSmoothed < 0.0)
			{
				WorldRttSmoothed = RoundTrip;
			}
			else if (RoundTrip < WorldRttSmoothed)
			{
				WorldRttSmoothed += 0.5 * (RoundTrip - WorldRttSmoothed);
			}
			else
			{
				WorldRttSmoothed += 0.05 * (FMath::Min(RoundTrip, WorldRttSmoothed + 0.1) - WorldRttSmoothed);
			}
		}
		UE_LOG(LogTemp, Display, TEXT("WLREMOTE send soles=(%.1f,%.1f,%.1f) rtt=%.0fms period=%.0fms status=%d yaw=%.2f"),
			SentSoles.X, SentSoles.Y, SentSoles.Z, RoundTrip * 1000.0, SentPeriodMs, Status, static_cast<double>(SentYaw));
		HandleWorldReport(Status, Data, Problem);
	});
}

void FWonderlandSocialLiveService::HandleWorldReport(int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
{
	NextWorldAt = FPlatformTime::Seconds() + (Problem.IsEmpty() ? WonderlandSocialLiveDetail::WorldSeconds : WonderlandSocialLiveDetail::RetrySeconds);
	// R16 CF-3 r2 (the correctness review's F1): A REPORT SENT BEFORE LEAVE SHARED WORLD answers about a world the player chose to leave.
	// Its answer is dropped whatever it says: applied, it put the view back "in" that world -- frozen copies of the others' Dogs, a false
	// "appeared" and a population line after "world.leave : ok" -- and a 404 for it is no reason to say "staying" either.
	if (!bWorldWanted)
	{
		return;
	}
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
				PlanRejoinAfter404();
			}
			else if (bJoinInFlight && WonderlandSocialLiveDetail::CVarRejoin404Replan.GetValueOnGameThread() != 0)
			{
				// NOT LOST (r16reh16w): that join's answer decides, and if it does not place the player the rejoin is planned then
				bRejoin404Deferred = true;
				UE_LOG(LogTemp, Display, TEXT("WLSOCIAL rejoin404 deferred: a join is in flight, the rejoin is replanned when it answers"));
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
	WorldView.ReportRttSeconds = FMath::Max(WorldRttSmoothed, 0.0);   // B33 wl.Remote.RttClock
	if (bWasPrivate && !WorldView.bInWorld && bWorldWanted)
	{
		// TAKEN OUT OF A PRIVATE SERVER BY THE SERVER (founder P4/P5, 10-04: a block either way removes the member; the owner stays):
		// the server answers ok with NO context (Second b7dd6eae). Only the generic words, never why; then the public world this map
		// is -- joined quietly, so its "Done" can never overwrite the words (Second's review M1). If a join of the player's own is in
		// flight, the plan waits for its answer: placed somewhere, the plan is dropped; refused, it runs (never stranded out of a world).
		UE_LOG(LogTemp, Display, TEXT("WLWORLD removed from a private server by the server: back to the public world"));
		Answered.Broadcast(TEXT("world.removed"), FString(), FWonderlandSocialActionResult{false, TEXT("You can't stay in this server."), false});
		NotePopulation();
		WorldChanged.Broadcast();
		RejoinContextId.Reset();
		ScheduleAutoJoin(TEXT("PUBLIC"), TEXT("golden_arrival"));
		return;
	}
	NotePopulation();
	WorldChanged.Broadcast();
}

void FWonderlandSocialLiveService::PlanRejoinAfter404()
{
	UE_LOG(LogTemp, Display, TEXT("WLWORLD the server no longer holds this player's world (404): joining the same one again quietly"));
	UE_LOG(LogTemp, Display, TEXT("WLREMOTE rejoin404 figures=%d context=%s"), WorldView.Avatars.Num(), *WorldView.ContextId);
	bRejoin404Deferred = false;
	RejoinContextId = WorldView.ContextId;   // a FRIEND rejoin must land in this same world, or the player is not moved (m2)
	WorldView = FWonderlandWorldView();
	NotePopulation();
	WorldChanged.Broadcast();
	ScheduleAutoJoin(WorldTarget, WorldArg);
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
		HandleJoinAnswer(Seq, Target, Arg, bAutomatic, Data, Problem, Status);
	});
	return FWonderlandSocialActionResult{true, TEXT("Joining…"), true};
}

void FWonderlandSocialLiveService::HandleJoinAnswer(int32 Seq, const FString& Target, const FString& Arg, bool bAutomatic,
	const TSharedPtr<FJsonObject>& Data, const FString& Problem, int32 Status)
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
		bRejoin404Deferred = false;   // placed: the server holds this player again, whatever a 404 for the old world said
		TargetRefusals = 0;
		// PLACED: no automatic join planned while this one was in flight (a removal's way back) may move the player afterwards
		bAutoJoinPending = false;
		bWorldWanted = true;
		NextWorldAt = 0.0;
		WorldView = Joined;
		WorldView.ReportRttSeconds = FMath::Max(WorldRttSmoothed, 0.0);   // B33 wl.Remote.RttClock (0 until a world report has answered)
		WorldTarget = Target.ToUpper();   // the world a forgotten player is put back into (the 404 path above)
		WorldArg = Arg;
		UE_LOG(LogTemp, Display, TEXT("WLWORLD joined %s (%s), %d of %d here%s"), *WorldView.ContextId, *WorldView.ServerName, WorldView.Population,
			WorldView.Capacity, bAutomatic ? TEXT(" (automatically)") : TEXT(""));
		NotePopulation();
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
			// r16reh16w: an INVITE or PARTY target that is refused is SAID, and asked for again (bounded) before the public world
			using namespace WonderlandSocialReconnectPolicy;
			const EJoinKind Kind = bWasPublic ? EJoinKind::Public
				: Target.Equals(TEXT("INVITE"), ESearchCase::IgnoreCase) ? EJoinKind::Invite
				: Target.Equals(TEXT("PARTY"), ESearchCase::IgnoreCase) ? EJoinKind::Party
				: Target.Equals(TEXT("FRIEND"), ESearchCase::IgnoreCase) ? EJoinKind::Friend : EJoinKind::Private;
			const FString TargetKey = Target.ToUpper() + TEXT(":") + Arg;
			TargetRefusals = TargetKey == RefusedTarget ? TargetRefusals + 1 : 1;
			RefusedTarget = TargetKey;
			const bool bKeepTarget = WonderlandSocialLiveDetail::CVarRejoinKeepTarget.GetValueOnGameThread() != 0;
			const ERefusalAction Action = AfterAutomaticJoinRefused(Kind, TargetRefusals, bKeepTarget);
			if (Action == ERefusalAction::RetrySameTarget)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL rejoin target %s refused (HTTP %d, refusal %d of %d): asking again before the public world"),
					*Target.ToUpper(), Status, TargetRefusals, MaxTargetRefusals);
				ScheduleAutoJoin(Target, Arg);
			}
			else
			{
				if (Kind == EJoinKind::Invite || Kind == EJoinKind::Party)
				{
					UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL rejoin target %s refused (HTTP %d) after %d refusals: the public world instead"),
						*Target.ToUpper(), Status, TargetRefusals);
				}
				ScheduleAutoJoin(bWasPublic ? Target : FString(TEXT("PUBLIC")), bWasPublic ? Arg : FString(TEXT("golden_arrival")));
			}
		}
		else if (WonderlandSocialReconnectPolicy::ShouldReplanDeferred404(bRejoin404Deferred, false, bAutomatic, bWorldWanted, bAutoJoinPending,
			WonderlandSocialLiveDetail::CVarRejoin404Replan.GetValueOnGameThread() != 0))
		{
			// the 404 that landed while this join was in flight (r16reh16w): the join did not place the player, so the rejoin is planned now
			UE_LOG(LogTemp, Display, TEXT("WLSOCIAL rejoin404 replanned: the join in flight answered without placing the player"));
			PlanRejoinAfter404();
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
	NotePopulation();
	WorldChanged.Broadcast();
	SendLeave(++LeaveSeq, false);
	FWonderlandSocialActionResult Pending;
	Pending.bOk = true;
	Pending.bPending = true;
	Pending.Reason = TEXT("Sending…");
	return Pending;
}

void FWonderlandSocialLiveService::SendLeave(int32 Leave, bool bRetried)
{
	// ONE bounded retry (r16reh16w): a leave that never reached the server is sent once more a second later, from a ticker -- the game thread
	// never waits -- and only if the player is still out (no newer leave, no join since)
	const int32 JoinAtLeave = JoinSeq;
	Call(TEXT("POST"), TEXT("/world/leave"), MakeShared<FJsonObject>(), [this, Leave, bRetried, JoinAtLeave](int32 Status, const TSharedPtr<FJsonObject>&, const FString& Problem)
	{
		const bool bStillOut = Leave == LeaveSeq && JoinAtLeave == JoinSeq && !bWorldWanted;
		if (!Problem.IsEmpty() && bStillOut
			&& WonderlandSocialReconnectPolicy::ShouldRetryLeave(Status, bRetried, WonderlandSocialLiveDetail::CVarLeaveRetry.GetValueOnGameThread() != 0))
		{
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live world.leave did not reach the server (%s): one more try in %.0f s"), *Problem, WonderlandSocialLiveDetail::LeaveRetrySeconds);
			const TWeakPtr<bool> WeakAlive = Alive;
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([this, WeakAlive, Leave, JoinAtLeave](float)
			{
				if (WeakAlive.IsValid() && Leave == LeaveSeq && JoinAtLeave == JoinSeq && !bWorldWanted)
				{
					SendLeave(Leave, true);
				}
				return false;
			}), static_cast<float>(WonderlandSocialLiveDetail::LeaveRetrySeconds));
			return;
		}
		FWonderlandSocialActionResult Answer;
		Answer.bOk = Problem.IsEmpty();
		Answer.Reason = Problem;
		UE_LOG(LogTemp, Log, TEXT("WLSOCIAL live world.leave : %s%s%s"), Answer.bOk ? TEXT("ok") : TEXT("refused"), bRetried ? TEXT(" (retry)") : TEXT(""),
			Answer.Reason.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" -- %s"), *Answer.Reason));
		Answered.Broadcast(TEXT("world.leave"), FString(), Answer);
		if (Answer.bOk)
		{
			Refresh();
		}
	});
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
		// LFF IS NOT IN THE SNAPSHOT (its own bounded reads): an lff.* event -- or a block, which hides posts both ways, or a reset -- tells
		// the LFF surfaces to read again. The op is all an event says; nothing about a post is in it.
		bool bLff = bReset;
		for (int32 Index = 0; !bLff && Events != nullptr && Index < Events->Num(); ++Index)
		{
			const TSharedPtr<FJsonObject>* Event = nullptr;
			FString Op;
			if ((*Events)[Index].IsValid() && (*Events)[Index]->TryGetObject(Event) && Event != nullptr && (*Event).IsValid()
				&& (*Event)->TryGetStringField(TEXT("op"), Op))
			{
				bLff = Op.StartsWith(TEXT("lff."), ESearchCase::CaseSensitive) || Op.StartsWith(TEXT("blocks."), ESearchCase::CaseSensitive);
			}
		}
		// WHAT CHANGED IS NOT IN THE EVENT: the view is read again, and shows what the authority lets this player see.
		if (Count > 0 || bReset)
		{
			Refresh();
		}
		if (bLff)
		{
			LffChanged.Broadcast();
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
			// THE VIEWER'S OWN BLOCK (or unblock) changes which LFF posts and requests they see, and its event may be told as an ordinary
			// friends.remove or parties.leave (never as a block): the LFF surfaces read again
			if (OperationId.StartsWith(TEXT("blocks."), ESearchCase::CaseSensitive))
			{
				LffChanged.Broadcast();
			}
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
	if (OperationId == TEXT("messages.read"))
	{
		// R16 CF-2 (B25): the conversation the hub is SHOWING, read up to the newest message THIS view holds of it -- never one the player
		// has not been shown (markRead never moves backwards and stops at the conversation's last: social-conversations.ts:172-180)
		int64 Through = 0;
		if (const TArray<FWonderlandSocialMessage>* History = SubjectId.IsEmpty() ? nullptr : Snapshot.Messages.Find(SubjectId))
		{
			for (const FWonderlandSocialMessage& Shown : *History)
			{
				Through = FMath::Max(Through, Shown.Sequence);
			}
		}
		if (Through <= 0)
		{
			return Refuse(TEXT("There is nothing to mark read in that conversation"));
		}
		TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
		Body->SetNumberField(TEXT("sequence"), static_cast<double>(Through));
		return Ask(OperationId, SubjectId, TEXT("POST"), FString::Printf(TEXT("/conversations/%s/read"), *SubjectId), Body);
	}
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
	// R16 CF-3 (B34, the CONTEXT's leave and rejoin): the hub's LEAVE / REJOIN SHARED WORLD, through the leave and the join this client
	// already makes -- LeaveWorld (world.leave: no automatic join puts the player back), and the PUBLIC join the sign-in itself makes, as the
	// player's own join (its answer is shown). The subject of world.join is the public place's id (the safe-id rule above).
	if (OperationId == TEXT("world.leave")) return LeaveWorld();
	if (OperationId == TEXT("world.join")) return JoinWorld(TEXT("PUBLIC"), SubjectId.IsEmpty() ? FString(TEXT("golden_arrival")) : SubjectId);
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

// ---- LFF, THE LOOKING FOR FEED: relay-bridge/wonderland-social-scope.ts (the lff.* rows) and social-lff.ts's views.

namespace WonderlandSocialLiveDetail
{
	/** Refused here, before anything leaves: the reason a person can read. */
	FWonderlandLffAnswer LffRefusedHere(const FString& Why)
	{
		FWonderlandLffAnswer Answer;
		Answer.bRefusedHere = true;
		Answer.Problem = Why;
		return Answer;
	}

	/** A post's fields as the routes take them (lff.post.create / lff.post.edit): every field, the server validating each again. */
	TSharedPtr<FJsonObject> LffPostBody(const FWonderlandLffPostFields& Fields)
	{
		TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
		Body->SetStringField(TEXT("category"), Fields.Category);
		Body->SetStringField(TEXT("title"), Fields.Title);
		Body->SetStringField(TEXT("description"), Fields.Description);
		Body->SetStringField(TEXT("projectLabel"), Fields.ProjectLabel);
		TArray<TSharedPtr<FJsonValue>> Skills;
		for (const FString& Skill : Fields.Skills)
		{
			Skills.Add(MakeShared<FJsonValueString>(Skill));
		}
		Body->SetArrayField(TEXT("skills"), Skills);
		Body->SetNumberField(TEXT("openSlots"), static_cast<double>(Fields.OpenSlots));
		return Body;
	}
}

void FWonderlandSocialLiveService::CallLff(const FString& OperationId, const FString& SubjectId, const FString& Verb, const FString& Path,
	const TSharedPtr<FJsonObject>& Body, TFunction<void(const FWonderlandLffAnswer&, const TSharedPtr<FJsonObject>&)> Done)
{
	Call(Verb, Path, Body, [this, OperationId, SubjectId, Done](int32 Status, const TSharedPtr<FJsonObject>& Data, const FString& Problem)
	{
		FWonderlandLffAnswer Answer;
		Answer.Status = Status;
		Answer.Problem = Problem;
		Answer.RetryAfterSeconds = Status == 429 ? FMath::Max(1, LastRetryAfterSeconds) : 0;
		// THE OPERATION, THE ID AND THE STATUS ONLY: a post's text is the player's, never the log's (the 10-07 log-injection rule). The
		// server's refusals name fields, never their values (social-commands.ts onlyFields / lffText).
		UE_LOG(LogTemp, Log, TEXT("WLSOCIAL live %s %s: %s (HTTP %d)%s"), *OperationId, SubjectId.IsEmpty() ? TEXT("-") : *SubjectId,
			Problem.IsEmpty() ? TEXT("ok") : TEXT("refused"), Status, Problem.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" -- %s"), *Problem));
		Done(Answer, Data);
	});
}

void FWonderlandSocialLiveService::WriteLff(const FString& OperationId, const FString& SubjectId, const FString& Path, const TSharedPtr<FJsonObject>& Body,
	const TCHAR* IdField, FWonderlandLffWriteDone Done)
{
	const FString Field = IdField != nullptr ? FString(IdField) : FString();
	CallLff(OperationId, SubjectId, TEXT("POST"), Path, Body.IsValid() ? Body : TSharedPtr<FJsonObject>(MakeShared<FJsonObject>()),
		[Field, Done](const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)
	{
		FString CreatedId;
		FWonderlandLffAnswer Out = Answer;
		if (Out.IsOk() && !Field.IsEmpty() && (!Data.IsValid() || !Data->TryGetStringField(Field, CreatedId) || !WonderlandSocialLiveDetail::SafeId(CreatedId)))
		{
			// a create that answered without its new id: not an answer this client can act on (a proxy, never the bridge)
			Out.Problem = FString::Printf(TEXT("the social server's answer carried no %s"), *Field);
			CreatedId.Reset();
		}
		Done(Out, CreatedId);
	});
}

void FWonderlandSocialLiveService::ReadLffFeed(const FWonderlandLffFeedQuery& Query, FWonderlandLffFeedDone Done)
{
	FString Path;
	FString Why;
	if (!WonderlandLffFeedPath(Query, Path, Why))
	{
		Done(WonderlandSocialLiveDetail::LffRefusedHere(Why), FWonderlandLffFeedPage());
		return;
	}
	CallLff(TEXT("lff.feed.list"), Query.bMine ? FString(TEXT("mine")) : Query.Category, TEXT("GET"), Path, nullptr,
		[Done](const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)
	{
		FWonderlandLffAnswer Out = Answer;
		FWonderlandLffFeedPage Page;
		FString Problem;
		if (Out.IsOk() && !WonderlandParseLffFeed(Data, Page, Problem))
		{
			Out.Problem = FString::Printf(TEXT("the feed was not readable: %s"), *Problem);
			Page = FWonderlandLffFeedPage();
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live lff.feed.list refused: %s"), *Problem);
		}
		Done(Out, Page);
	});
}

void FWonderlandSocialLiveService::ReadLffPost(const FString& PostId, FWonderlandLffPostDone Done)
{
	if (!WonderlandSocialLiveDetail::SafeId(PostId))
	{
		Done(WonderlandSocialLiveDetail::LffRefusedHere(TEXT("That is not a valid post")), FWonderlandLffPostDetail());
		return;
	}
	CallLff(TEXT("lff.post.get"), PostId, TEXT("GET"), FString::Printf(TEXT("/lff/posts/%s"), *PostId), nullptr,
		[Done](const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)
	{
		FWonderlandLffAnswer Out = Answer;
		FWonderlandLffPostDetail Detail;
		FString Problem;
		if (Out.IsOk() && !WonderlandParseLffPostDetail(Data, Detail, Problem))
		{
			Out.Problem = FString::Printf(TEXT("the post was not readable: %s"), *Problem);
			Detail = FWonderlandLffPostDetail();
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live lff.post.get refused: %s"), *Problem);
		}
		Done(Out, Detail);
	});
}

void FWonderlandSocialLiveService::ReadLffPostRequests(const FString& PostId, FWonderlandLffPostRequestsDone Done)
{
	if (!WonderlandSocialLiveDetail::SafeId(PostId))
	{
		Done(WonderlandSocialLiveDetail::LffRefusedHere(TEXT("That is not a valid post")), FWonderlandLffPostRequests());
		return;
	}
	CallLff(TEXT("lff.requests.forPost"), PostId, TEXT("GET"), FString::Printf(TEXT("/lff/posts/%s/requests"), *PostId), nullptr,
		[Done](const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)
	{
		FWonderlandLffAnswer Out = Answer;
		FWonderlandLffPostRequests Inbox;
		FString Problem;
		if (Out.IsOk() && !WonderlandParseLffPostRequests(Data, Inbox, Problem))
		{
			Out.Problem = FString::Printf(TEXT("the post's requests were not readable: %s"), *Problem);
			Inbox = FWonderlandLffPostRequests();
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live lff.requests.forPost refused: %s"), *Problem);
		}
		Done(Out, Inbox);
	});
}

void FWonderlandSocialLiveService::ReadLffMyRequests(FWonderlandLffMyRequestsDone Done)
{
	CallLff(TEXT("lff.requests.mine"), FString(), TEXT("GET"), TEXT("/lff/requests"), nullptr,
		[Done](const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)
	{
		FWonderlandLffAnswer Out = Answer;
		FWonderlandLffMyRequests Mine;
		FString Problem;
		if (Out.IsOk() && !WonderlandParseLffMyRequests(Data, Mine, Problem))
		{
			Out.Problem = FString::Printf(TEXT("your requests were not readable: %s"), *Problem);
			Mine = FWonderlandLffMyRequests();
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live lff.requests.mine refused: %s"), *Problem);
		}
		Done(Out, Mine);
	});
}

void FWonderlandSocialLiveService::CreateLffPost(const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done)
{
	WriteLff(TEXT("lff.post.create"), FString(), TEXT("/lff/posts"), WonderlandSocialLiveDetail::LffPostBody(Fields), TEXT("postId"), MoveTemp(Done));
}

void FWonderlandSocialLiveService::EditLffPost(const FString& PostId, const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done)
{
	if (!WonderlandSocialLiveDetail::SafeId(PostId))
	{
		Done(WonderlandSocialLiveDetail::LffRefusedHere(TEXT("That is not a valid post")), FString());
		return;
	}
	WriteLff(TEXT("lff.post.edit"), PostId, FString::Printf(TEXT("/lff/posts/%s/edit"), *PostId), WonderlandSocialLiveDetail::LffPostBody(Fields), nullptr, MoveTemp(Done));
}

void FWonderlandSocialLiveService::SendLffRequest(const FString& PostId, const FString& Message, FWonderlandLffWriteDone Done)
{
	if (!WonderlandSocialLiveDetail::SafeId(PostId))
	{
		Done(WonderlandSocialLiveDetail::LffRefusedHere(TEXT("That is not a valid post")), FString());
		return;
	}
	// THE NOTE IS OPTIONAL: no note, no field (the routes take `message` or nothing)
	TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	if (!Message.IsEmpty())
	{
		Body->SetStringField(TEXT("message"), Message);
	}
	WriteLff(TEXT("lff.request.create"), PostId, FString::Printf(TEXT("/lff/posts/%s/requests"), *PostId), Body, TEXT("requestId"), MoveTemp(Done));
}

void FWonderlandSocialLiveService::ActOnLff(const FString& OperationId, const FString& SubjectId, FWonderlandLffWriteDone Done)
{
	using namespace WonderlandSocialLiveDetail;
	if (!SafeId(SubjectId))
	{
		Done(LffRefusedHere(TEXT("That is not a valid id")), FString());
		return;
	}
	// THE TABLE, op by op: a post's id for close / delete, a request's for withdraw / accept / decline; an empty body (the routes refuse
	// any field these take none of)
	FString Path;
	if (OperationId == TEXT("lff.post.close")) Path = FString::Printf(TEXT("/lff/posts/%s/close"), *SubjectId);
	else if (OperationId == TEXT("lff.post.delete")) Path = FString::Printf(TEXT("/lff/posts/%s/delete"), *SubjectId);
	else if (OperationId == TEXT("lff.request.withdraw")) Path = FString::Printf(TEXT("/lff/requests/%s/withdraw"), *SubjectId);
	else if (OperationId == TEXT("lff.request.accept")) Path = FString::Printf(TEXT("/lff/requests/%s/accept"), *SubjectId);
	else if (OperationId == TEXT("lff.request.decline")) Path = FString::Printf(TEXT("/lff/requests/%s/decline"), *SubjectId);
	if (Path.IsEmpty())
	{
		Done(LffRefusedHere(FString::Printf(TEXT("%s is not a Looking For Feed action this client knows"), *OperationId)), FString());
		return;
	}
	WriteLff(OperationId, SubjectId, Path, MakeShared<FJsonObject>(), nullptr, MoveTemp(Done));
}

void FWonderlandSocialLiveService::ReportLffPost(const FString& AuthorId, const FString& PostId, FWonderlandLffWriteDone Done)
{
	using namespace WonderlandSocialLiveDetail;
	if (!SafeId(AuthorId) || !SafeId(PostId))
	{
		Done(LffRefusedHere(TEXT("That is not a valid post")), FString());
		return;
	}
	// THE EXISTING REPORT FLOW (reports.file), the post as its subject: referenced by id, never copied (social-contracts.ts)
	TSharedPtr<FJsonObject> Body = Object(TEXT("reportedId"), AuthorId, TEXT("reason"), TEXT("OTHER"));
	Body->SetStringField(TEXT("subjectRef"), PostId);
	WriteLff(TEXT("reports.file"), PostId, TEXT("/reports"), Body, nullptr, MoveTemp(Done));
}

void FWonderlandSocialLiveService::ReadProfileForSurface(const FString& UserId,
	TFunction<void(const FWonderlandLffAnswer&, const FWonderlandSocialProfileView&, double, const FString&)> Done)
{
	const double IssuedAt = FPlatformTime::Seconds();
	if (!WonderlandSocialLiveDetail::SafeId(UserId))
	{
		Done(WonderlandSocialLiveDetail::LffRefusedHere(TEXT("That is not a valid player")), FWonderlandSocialProfileView(), IssuedAt, FString());
		return;
	}
	// the same profile.read as ReadProfile (scope.ts): their card for this viewer, or not-found for a person they may not see
	CallLff(TEXT("profile.read"), UserId, TEXT("GET"), FString::Printf(TEXT("/profiles/%s"), *UserId), nullptr,
		[Done, IssuedAt](const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)
	{
		FWonderlandLffAnswer Out = Answer;
		FWonderlandSocialProfileView View;
		FString Problem;
		FString Digest;
		if (Out.IsOk() && !WonderlandParseSocialProfileView(Data, View, Problem))
		{
			Out.Problem = TEXT("the profile was not readable");
			View = FWonderlandSocialProfileView();
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live profile.read refused: the answer is not a profile this client reads"));
		}
		else if (Out.IsOk())
		{
			Digest = WonderlandSocialLiveDetail::ViewDigest(Data);
		}
		Done(Out, View, IssuedAt, Digest);
	});
}

void FWonderlandSocialLiveService::ReadProfile(const FString& UserId, FWonderlandLffProfileDone Done)
{
	if (!WonderlandSocialLiveDetail::SafeId(UserId))
	{
		Done(WonderlandSocialLiveDetail::LffRefusedHere(TEXT("That is not a valid player")), FWonderlandSocialProfileView());
		return;
	}
	// THE EXISTING profile.read (scope.ts): the authority's card for this viewer, or its not-found for a person they may not see
	CallLff(TEXT("profile.read"), UserId, TEXT("GET"), FString::Printf(TEXT("/profiles/%s"), *UserId), nullptr,
		[Done](const FWonderlandLffAnswer& Answer, const TSharedPtr<FJsonObject>& Data)
	{
		FWonderlandLffAnswer Out = Answer;
		FWonderlandSocialProfileView View;
		FString Problem;
		if (Out.IsOk() && !WonderlandParseSocialProfileView(Data, View, Problem))
		{
			Out.Problem = TEXT("the profile was not readable");
			View = FWonderlandSocialProfileView();
			UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live profile.read refused: the answer is not a profile this client reads"));
		}
		Done(Out, View);
	});
}

void FWonderlandSocialLiveService::ReportPresence(bool bConnected)
{
	// THE CLIENT'S PART: connected, and what it is doing. The activity is derived by the authority's one precedence. Arriving is
	// exploring (as it always was); leaving is nothing. Either way any detail an earlier activity left is cleared (null).
	FWonderlandPresenceSignals Arrival;
	Arrival.bExploring = bConnected;
	SendPresence(bConnected, Arrival, bHasSnapshot && Snapshot.bHasParty ? Snapshot.Party.PartyId : FString());
}

void FWonderlandSocialLiveService::SendPresence(bool bConnected, const FWonderlandPresenceSignals& Signals, const FString& PartyKey)
{
	PresenceReporter.NoteSent(Signals, PartyKey, FPlatformTime::Seconds());
	// THE SIGNALS AND WHETHER THERE IS A PARTY, ONE TOKEN (the operation-line form every "WLSOCIAL live <op> <subject>: ok" reader takes);
	// the detail is the client's own fixed words, never a player's text
	const FString Said = FString::Printf(TEXT("%s,connected=%d,party=%s"), *Signals.Describe(), bConnected ? 1 : 0, PartyKey.IsEmpty() ? TEXT("no") : TEXT("yes"));
	Call(TEXT("POST"), TEXT("/presence"), WonderlandPresenceBody(bConnected, Signals), [this, Said](int32 Status, const TSharedPtr<FJsonObject>&, const FString& Problem)
	{
		// no answer (status 0) or a 5xx: the outcome is unknown, so the reporter sends the current state again (r2, F3)
		PresenceReporter.NoteAnswered(Problem.IsEmpty(), Status == 429 ? LastRetryAfterSeconds : 0, FPlatformTime::Seconds(), Status == 0 || Status >= 500);
		if (!Problem.IsEmpty())
		{
			// SAID ONCE PER NEW REASON: an outage retries every few seconds, and the log must not fill with the same line
			if (Problem != PresenceProblem)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLSOCIAL live presence not reported: %s"), *Problem);
			}
			PresenceProblem = Problem;
			return;
		}
		PresenceProblem.Reset();
		UE_LOG(LogTemp, Log, TEXT("WLSOCIAL live presence.update_self %s: ok"), *Said);
	});
}

TSharedRef<FJsonObject> WonderlandPresenceBody(bool bConnected, const FWonderlandPresenceSignals& Signals)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetBoolField(TEXT("connected"), bConnected);
	TSharedPtr<FJsonObject> Flags = MakeShared<FJsonObject>();
	Flags->SetBoolField(TEXT("exploring"), Signals.bExploring);
	Flags->SetBoolField(TEXT("runningMission"), Signals.bRunningMission);
	if (Signals.bCreating)
	{
		Flags->SetStringField(TEXT("creating"), TEXT("SOFTWARE"));
	}
	else
	{
		Flags->SetField(TEXT("creating"), MakeShared<FJsonValueNull>());
	}
	// NEVER CLAIMED BY THIS CLIENT (founder 10-13): GVE and private servers are deferred, and Julius at work is representation only. Said
	// false outright, so no earlier report can leave one standing. "inParty" is never sent: the authority reads its own party record.
	Flags->SetBoolField(TEXT("inGveBattle"), false);
	Flags->SetBoolField(TEXT("inPrivateServer"), false);
	Flags->SetBoolField(TEXT("juliusWorking"), false);
	Body->SetObjectField(TEXT("signals"), Flags);
	if (Signals.Detail.IsEmpty())
	{
		Body->SetField(TEXT("activityDetail"), MakeShared<FJsonValueNull>());
	}
	else
	{
		Body->SetStringField(TEXT("activityDetail"), Signals.Detail);
	}
	return Body;
}

FWonderlandPresenceSignals FWonderlandPresenceReporter::Want(const FWonderlandActivitySample& Sample, double Now)
{
	if (Sample.bMoving)
	{
		LastMovedAt = Now;
	}
	FWonderlandPresenceSignals Out;
	Out.bExploring = Now - LastMovedAt <= ExploringHoldSeconds;
	Out.bCreating = Sample.bCreating;
	Out.bRunningMission = Sample.bRunningMission;
	// ONE DETAIL, for the activity the authority will show (deriveActivity: a mission over creating). A mission this build only simulates
	// says so; a real one followed (none in this build) carries no words of the client's. The creation window's sample is simulated.
	Out.Detail = Sample.bRunningMission ? (Sample.bMissionSimulated ? FString(WonderlandPresenceDetail::SimulatedMission()) : FString())
		: Sample.bCreating ? FString(WonderlandPresenceDetail::SimulatedCreation()) : FString();
	return Out;
}

bool FWonderlandPresenceReporter::IsDue(const FWonderlandPresenceSignals& Wanted, const FString& PartyKey, double Now) const
{
	if (bInFlight || Now < NotBefore)
	{
		return false;
	}
	return !bHasAccepted || Wanted != Accepted || !PartyKey.Equals(AcceptedParty, ESearchCase::CaseSensitive);
}

void FWonderlandPresenceReporter::NoteSent(const FWonderlandPresenceSignals& Sent, const FString& PartyKey, double Now)
{
	bInFlight = true;
	InFlightSignals = Sent;
	InFlightParty = PartyKey;
	NotBefore = Now + MinGapSeconds;
}

void FWonderlandPresenceReporter::NoteAnswered(bool bAccepted, int32 RetryAfterSeconds, double Now, bool bOutcomeUnknown)
{
	if (!bInFlight)
	{
		return;   // an answer to nothing this reporter sent (it was reset meanwhile)
	}
	bInFlight = false;
	if (bAccepted)
	{
		bHasAccepted = true;
		Accepted = InFlightSignals;
		AcceptedParty = InFlightParty;
		return;
	}
	// LOST (no answer, a 5xx): the report may have been applied, so nothing is known of what the server holds -- the current state is
	// sent again after the wait, even if it equals the last accepted one (the player closed the window meanwhile: friends must not keep
	// seeing CREATING). REFUSED (4xx): the server holds what it held, so only a change is sent. Either way not before the retry wait.
	if (bOutcomeUnknown)
	{
		bHasAccepted = false;
	}
	NotBefore = FMath::Max(NotBefore, Now + FMath::Max(RetrySeconds, static_cast<double>(RetryAfterSeconds)));
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

// WONDERLAND -- companion UE adapter seam. NOT COMPILED; Unreal APIs UNVERIFIED (see the header).
// Provider-agnostic: every call names an agentId (or, to connect, an opaque providerId); nothing here switches on either.
// Routes as served by BRIDGE 7e5e1e30: POST / GET / DELETE /relay-api/wonderland/companions/agents[/{agentId}]?projectId=.
#include "WonderlandCompanionClient.h"

#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "WonderlandJuliusMissionLogic.h"

using namespace WonderlandCompanionLogic;

namespace
{
	std::string ToUtf8(const FString& Text)
	{
		const FTCHARToUTF8 Conv(*Text);
		return std::string(Conv.Get(), Conv.Length());
	}

	FString FromUtf8(std::string_view Text)
	{
		const FUTF8ToTCHAR Conv(Text.data(), static_cast<int32>(Text.size()));
		return FString(Conv.Length(), Conv.Get());
	}

	std::string_view BytesView(const TArray<uint8>& Bytes)
	{
		return std::string_view(reinterpret_cast<const char*>(Bytes.GetData()), Bytes.Num());
	}
}

void UWonderlandCompanionClient::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Session = MakeUnique<FCompanionSession>(std::string()); // Offline until Start() gets a loopback origin
}

void UWonderlandCompanionClient::Deinitialize()
{
	for (TPair<FString, TSharedPtr<IHttpRequest, ESPMode::ThreadSafe>>& Pair : ChatRequests)
	{
		if (Pair.Value.IsValid()) { Pair.Value->CancelRequest(); }
	}
	ChatRequests.Empty();
	Session.Reset();
	Super::Deinitialize();
}

void UWonderlandCompanionClient::Start(const FString& J1RelayBaseUrl, const FString& ProjectId)
{
	// No providers / connections fetch. Agents arrive as slots (RefreshMissionAgents), a connect answer or a GET.
	// The chat route is not served at 7e5e1e30, so the session is built with bChatRouteServed = false (the default).
	Session = MakeUnique<FCompanionSession>(RelayOriginFromJ1Endpoint(ToUtf8(J1RelayBaseUrl)), ToUtf8(ProjectId)); // Q9
	Changed();
}

void UWonderlandCompanionClient::AdoptSession(const FString& Token)
{
	SessionToken = Token;
}

void UWonderlandCompanionClient::DropSession()
{
	SessionToken.Reset();
}

void UWonderlandCompanionClient::RefreshMissionAgents(const FString& WljRunId, const FString& ProjectId)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	const std::string Wlj = ToUtf8(WljRunId);
	Issue(CompanionMissionRequest(Session->RelayOrigin(), Wlj, ToUtf8(ProjectId)),
		[this, Wlj](int32 Status, const FString&, const TArray<uint8>& Body) { if (!Session) { return; }
			FCompanionMissionView Mission;
			const ECompanionMissionParse Parse = ParseCompanionMission(Status, BytesView(Body), Wlj, Mission); // agents[] are read even if a v0.1 field fails
			// One trace word per read: the HTTP status and the parser's verdict, never the body.
			UE_LOG(LogTemp, Display, TEXT("WLCOMPANION mission read: http %d, parse %s, agents %d"), Status,
				UTF8_TO_TCHAR(CompanionMissionParseName(Parse)), static_cast<int32>(Mission.Agents.size()));
			if (Mission.AgentsParse == EAgentListParse::Ok) { Session->ApplyAgentSlots(Mission.Agents); }
			// #447 traceId: kept as reported for THIS run only; an answer without one clears the last one (never reused).
			MissionTraceWljRunId = FromUtf8(Wlj);
			MissionTraceId = Mission.TraceId.empty() ? FString() : FromUtf8(Mission.TraceId);
			MissionView = Mission;
			bHaveMissionView = true;
			MissionViewHttpStatus = Status;
			Changed();
		});
}

void UWonderlandCompanionClient::ConnectAgent(const FString& ProviderId, const FString& WljRunIdOrEmpty, const FString& DisplayLabelOrEmpty)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	// No key, no idempotency key: every POST mints a new slot (registry.ts:246), so it is never resent.
	FRelayRequest Request;
	if (Session->BeginConnect(ToUtf8(ProviderId), ToUtf8(WljRunIdOrEmpty), ToUtf8(DisplayLabelOrEmpty), Request))
	{
		Issue(Request, [this](int32 Status, const FString&, const TArray<uint8>& Body) { if (!Session) { return; }
			Session->ApplyConnectAnswer(Status, BytesView(Body), NowMs());
			Changed();
		});
	}
	Changed();
}

void UWonderlandCompanionClient::RefreshAgent(const FString& AgentId)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	const std::string Id = ToUtf8(AgentId);
	Issue(Session->BeginReadAgent(Id), [this, Id](int32 Status, const FString&, const TArray<uint8>& Body) { if (!Session) { return; }
		Session->ApplyReadAgentAnswer(Id, Status, BytesView(Body));
		Changed();
	});
}

void UWonderlandCompanionClient::Disconnect(const FString& AgentId)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	const std::string Id = ToUtf8(AgentId);
	Issue(Session->BeginDisconnect(Id), [this, Id](int32 Status, const FString&, const TArray<uint8>& Body) { if (!Session) { return; }
		Session->ApplyDisconnectAnswer(Id, Status, BytesView(Body));
		Changed();
	});
}

void UWonderlandCompanionClient::SendMessage(const FString& AgentId, const FString& Message, const FString& WljRunIdOrEmpty)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	FRelayRequest Request;
	const FString IdemKey = NewIdempotencyKey(AgentId);
	if (IdemKey.IsEmpty()) { Changed(); return; } // fail closed: no secure key, nothing sent
	if (Session->BeginMessage(ToUtf8(AgentId), ToUtf8(Message), ToUtf8(IdemKey), ToUtf8(WljRunIdOrEmpty), NowMs(), Request))
	{
		StartChatRequest(AgentId, Request);
	}
	Changed();
}

void UWonderlandCompanionClient::Resend(const FString& AgentId)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	FRelayRequest Request;
	if (Session->BeginResend(ToUtf8(AgentId), NowMs(), Request)) { StartChatRequest(AgentId, Request); }
	Changed();
}

void UWonderlandCompanionClient::StartChatRequest(const FString& AgentId, const FRelayRequest& In)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	const std::string Id = ToUtf8(AgentId);
	if (SessionToken.IsEmpty() || !MayCarrySession(In.Url, Session->RelayOrigin())) { return; }
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(FromUtf8(In.Url));
	Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Relay-Session %s"), *SessionToken));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("text/event-stream"));
	Request->SetHeader(TEXT("x-relay-idempotency-key"), FromUtf8(In.IdempotencyKey));
	Request->SetContentAsString(FromUtf8(In.Body));
	// UNVERIFIED: UE 5.4+ streaming body delegate name and signature. Bytes arrive on the HTTP thread; they are
	// marshalled to the game thread before touching the session.
	Request->SetResponseBodyReceiveStreamDelegateV2(FHttpRequestStreamDelegateV2::CreateWeakLambda(this,
		[this, Id](void* Data, int64& Length) {
			std::string Chunk(static_cast<const char*>(Data), static_cast<size_t>(Length));
			AsyncTask(ENamedThreads::GameThread, [this, Id, Chunk = MoveTemp(Chunk)]() { if (!Session) { return; }
				if (Session) { Session->FeedChatBytes(Id, Chunk, NowMs()); Changed(); }
			});
		}));
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this, Id, AgentId](FHttpRequestPtr, FHttpResponsePtr Response, bool bOk) { if (!Session) { return; }
		ChatRequests.Remove(AgentId);
		if (!bOk || !Response.IsValid()) { Session->ApplyChatTransportFailure(Id, NowMs()); Changed(); return; }
		const int32 Status = Response->GetResponseCode();
		if (Status == 200 && Response->GetContentType().StartsWith(TEXT("text/event-stream"))) { Session->FinishChatStream(Id, NowMs()); }
		else
		{
			Session->ApplyChatHttpAnswer(Id, Status, ToUtf8(Response->GetHeader(TEXT("Retry-After"))), BytesView(Response->GetContent()), NowMs());
		}
		Changed();
	});
	ChatRequests.Add(AgentId, Request);
	Request->ProcessRequest();
}

void UWonderlandCompanionClient::DeleteHistory(const FString& AgentId)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	const std::string Id = ToUtf8(AgentId);
	Issue(Session->BeginDeleteHistory(Id), [this, Id](int32 Status, const FString&, const TArray<uint8>&) { if (!Session) { return; }
		Session->ApplyDeleteHistoryAnswer(Id, Status);
		Changed();
	});
	Changed();
}

TArray<FString> UWonderlandCompanionClient::GetAgentIds() const
{
	if (!Session) { return {}; }
	TArray<FString> Out;
	for (const std::string& Id : Session->AgentIds()) { Out.Add(FromUtf8(Id)); }
	return Out;
}

const FAgentView* UWonderlandCompanionClient::GetAgentView(const FString& AgentId) const { return Session ? Session->View(ToUtf8(AgentId)) : nullptr; }

const FTurnHistory* UWonderlandCompanionClient::GetHistory(const FString& AgentId) const { return Session ? Session->History(ToUtf8(AgentId)) : nullptr; }

void UWonderlandCompanionClient::Issue(const FRelayRequest& In, TFunction<void(int32, const FString&, const TArray<uint8>&)> OnDone)
{
	if (!Session) { return; } // deinitialized: refuse, never dereference
	if (In.Method.empty() || SessionToken.IsEmpty() || !MayCarrySession(In.Url, Session->RelayOrigin())) { return; }
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(FromUtf8(In.Method));
	Request->SetURL(FromUtf8(In.Url));
	Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Relay-Session %s"), *SessionToken));
	if (!In.IdempotencyKey.empty()) { Request->SetHeader(TEXT("x-relay-idempotency-key"), FromUtf8(In.IdempotencyKey)); }
	if (!In.Body.empty())
	{
		Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
		Request->SetContentAsString(FromUtf8(In.Body));
	}
	Request->OnProcessRequestComplete().BindWeakLambda(this, [OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bOk) {
		const TArray<uint8> Empty;
		const bool bHave = bOk && Response.IsValid();
		OnDone(bHave ? Response->GetResponseCode() : 0, bHave ? Response->GetHeader(TEXT("Retry-After")) : FString(),
			bHave ? Response->GetContent() : Empty);
	});
	Request->ProcessRequest();
}

FString UWonderlandCompanionClient::NewIdempotencyKey(const FString& AgentIdOrEmpty)
{
	if (!Session) { return FString(); } // deinitialized: refuse, never dereference
	// #433's IPlatformCrypto source; the pure minter formats a canonical UUIDv4 and refuses a failed or repeating source.
	std::string Key;
	const EKeyMint Result = KeyMinter.Mint(Random, Key);
	if (Result != EKeyMint::Minted)
	{
		Session->ApplyKeyMintFailure(ToUtf8(AgentIdOrEmpty));
		return FString();
	}
	return FromUtf8(Key);
}

uint64 UWonderlandCompanionClient::NowMs() const { return static_cast<uint64>(FPlatformTime::Seconds() * 1000.0); }

void UWonderlandCompanionClient::Changed() { OnViewChanged.Broadcast(); }

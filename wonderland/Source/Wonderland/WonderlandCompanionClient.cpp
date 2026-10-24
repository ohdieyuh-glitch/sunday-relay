// WONDERLAND -- companion UE adapter seam. NOT COMPILED; Unreal APIs UNVERIFIED (see the header).
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
}

void UWonderlandCompanionClient::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Session = MakeUnique<FOpenAiCompanionSession>(std::string()); // Offline until Start() gets a loopback origin
}

void UWonderlandCompanionClient::Deinitialize()
{
	if (ChatRequest.IsValid()) { ChatRequest->CancelRequest(); }
	KeyField.Clear();
	Session.Reset();
	Super::Deinitialize();
}

void UWonderlandCompanionClient::Start(const FString& J1RelayBaseUrl)
{
	Session = MakeUnique<FOpenAiCompanionSession>(RelayOriginFromJ1Endpoint(ToUtf8(J1RelayBaseUrl))); // Q9
	Issue(Session->ProvidersRequest(), [this](int32 Status, const FString&, const TArray<uint8>& Body) {
		Session->ApplyProvidersAnswer(Status, std::string_view(reinterpret_cast<const char*>(Body.GetData()), Body.Num()));
		Issue(Session->ConnectionsRequest(), [this](int32 S2, const FString&, const TArray<uint8>& B2) {
			Session->ApplyConnectionsAnswer(S2, std::string_view(reinterpret_cast<const char*>(B2.GetData()), B2.Num()));
			Changed();
		});
		Changed();
	});
	Changed();
}

void UWonderlandCompanionClient::KeyFieldAppend(const FString& Typed)
{
	// UNVERIFIED: FTCHARToUTF8 keeps a temporary buffer; it is short-lived but not wiped. Prefer feeding raw key
	// events (one ASCII char at a time) from the widget so no full-key FString ever exists.
	const FTCHARToUTF8 Conv(*Typed);
	KeyField.Append(std::string_view(Conv.Get(), Conv.Length()));
	Changed();
}

void UWonderlandCompanionClient::KeyFieldBackspace() { KeyField.Backspace(); Changed(); }

FString UWonderlandCompanionClient::KeyFieldMask() const { return FromUtf8(KeyField.MaskText()); }

void UWonderlandCompanionClient::ConnectKey()
{
	FKeyHandoff Handoff;
	const FString IdemKey = NewIdempotencyKey();
	if (IdemKey.IsEmpty()) { KeyField.Clear(); Changed(); return; } // fail closed: no secure key, nothing sent
	if (!Session->BeginConnect(KeyField, ToUtf8(IdemKey), Handoff)) { Changed(); return; }
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(TEXT("PUT"));
	Request->SetURL(FromUtf8(Handoff.TargetUrl()));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("x-relay-idempotency-key"), FromUtf8(Handoff.IdempotencyKey()));
	const std::string_view Body = Handoff.Body();
	Request->SetContent(TArray<uint8>(reinterpret_cast<const uint8*>(Body.data()), static_cast<int32>(Body.size())));
	Handoff.MarkSent(); // UNVERIFIED: the engine's request keeps its own copy of the content until it is destroyed.
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this](FHttpRequestPtr, FHttpResponsePtr Response, bool bOk) {
		const int32 Status = (bOk && Response.IsValid()) ? Response->GetResponseCode() : 0;
		const TArray<uint8> Empty;
		const TArray<uint8>& Bytes = Response.IsValid() ? Response->GetContent() : Empty;
		Session->ApplyConnectAnswer(Status, std::string_view(reinterpret_cast<const char*>(Bytes.GetData()), Bytes.Num()), NowMs());
		Changed();
	});
	Request->ProcessRequest();
	Changed();
}

void UWonderlandCompanionClient::Disconnect()
{
	Issue(Session->BeginDisconnect(), [this](int32 Status, const FString&, const TArray<uint8>&) {
		Session->ApplyDisconnectAnswer(Status);
		Changed();
	});
}

void UWonderlandCompanionClient::SendMessage(const FString& Message, const FString& WljRunIdOrEmpty)
{
	FRelayRequest Request;
	const FString IdemKey = NewIdempotencyKey();
	if (IdemKey.IsEmpty()) { Changed(); return; } // fail closed: no secure key, nothing sent
	if (Session->BeginMessage(ToUtf8(Message), ToUtf8(IdemKey), ToUtf8(WljRunIdOrEmpty), NowMs(), Request))
	{
		StartChatRequest(Request);
	}
	Changed();
}

void UWonderlandCompanionClient::Resend()
{
	FRelayRequest Request;
	if (Session->BeginResend(NowMs(), Request)) { StartChatRequest(Request); }
	Changed();
}

void UWonderlandCompanionClient::StartChatRequest(const FRelayRequest& In)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(TEXT("POST"));
	Request->SetURL(FromUtf8(In.Url));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Accept"), TEXT("text/event-stream"));
	Request->SetHeader(TEXT("x-relay-idempotency-key"), FromUtf8(In.IdempotencyKey));
	Request->SetContentAsString(FromUtf8(In.Body));
	// UNVERIFIED: UE 5.4+ streaming body delegate name and signature. Bytes arrive on the HTTP thread; they are
	// marshalled to the game thread before touching the session.
	Request->SetResponseBodyReceiveStreamDelegateV2(FHttpRequestStreamDelegateV2::CreateWeakLambda(this,
		[this](void* Data, int64& Length) {
			std::string Chunk(static_cast<const char*>(Data), static_cast<size_t>(Length));
			AsyncTask(ENamedThreads::GameThread, [this, Chunk = MoveTemp(Chunk)]() {
				if (Session) { Session->FeedChatBytes(Chunk, NowMs()); Changed(); }
			});
		}));
	Request->OnProcessRequestComplete().BindWeakLambda(this, [this](FHttpRequestPtr, FHttpResponsePtr Response, bool bOk) {
		ChatRequest.Reset();
		if (!bOk || !Response.IsValid()) { Session->ApplyChatTransportFailure(NowMs()); Changed(); return; }
		const int32 Status = Response->GetResponseCode();
		if (Status == 200 && Response->GetContentType().StartsWith(TEXT("text/event-stream"))) { Session->FinishChatStream(NowMs()); }
		else
		{
			const TArray<uint8>& Bytes = Response->GetContent();
			Session->ApplyChatHttpAnswer(Status, ToUtf8(Response->GetHeader(TEXT("Retry-After"))),
				std::string_view(reinterpret_cast<const char*>(Bytes.GetData()), Bytes.Num()), NowMs());
		}
		Changed();
	});
	ChatRequest = Request;
	Request->ProcessRequest();
}

void UWonderlandCompanionClient::DeleteHistory()
{
	Issue(Session->BeginDeleteHistory(), [this](int32 Status, const FString&, const TArray<uint8>&) {
		Session->ApplyDeleteHistoryAnswer(Status);
		Changed();
	});
	Changed();
}

void UWonderlandCompanionClient::Issue(const FRelayRequest& In, TFunction<void(int32, const FString&, const TArray<uint8>&)> OnDone)
{
	if (In.Method.empty()) { return; }
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetVerb(FromUtf8(In.Method));
	Request->SetURL(FromUtf8(In.Url));
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

FString UWonderlandCompanionClient::NewIdempotencyKey()
{
	// #433's IPlatformCrypto source; the pure minter formats a canonical UUIDv4 and refuses a failed or repeating source.
	std::string Key;
	const EKeyMint Result = KeyMinter.Mint(Random, Key);
	if (Result != EKeyMint::Minted)
	{
		Session->ApplyKeyMintFailure();
		return FString();
	}
	return FromUtf8(Key);
}

uint64 UWonderlandCompanionClient::NowMs() const { return static_cast<uint64>(FPlatformTime::Seconds() * 1000.0); }

void UWonderlandCompanionClient::Changed() { OnViewChanged.Broadcast(); }

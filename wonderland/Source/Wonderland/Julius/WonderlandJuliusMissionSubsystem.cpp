#include "WonderlandJuliusMissionSubsystem.h"

#include "Wonderland/WonderlandJuliusMissionClient.h"
#include "Wonderland/WonderlandJuliusStream.h"
#include "WonderlandJuliusRandomBytes.h"

#include "Engine/GameInstance.h"
#include "Misc/Crc.h"

#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

#include <string>
#include <string_view>

DEFINE_LOG_CATEGORY(LogJuliusJ1);

#if !UE_BUILD_SHIPPING
static TAutoConsoleVariable<FString> CVarJuliusJ1Endpoint(
	TEXT("wl.Julius.J1.Endpoint"),
	TEXT("http://127.0.0.1:8790"),
	TEXT("Loopback-only base URL for Julius J1 admission. A non-loopback host refuses the dispatch and sends nothing. Compiled out of Shipping, which always uses http://127.0.0.1:8790."),
	ECVF_Default);
#endif

namespace
{
	std::string ToStd(const FString& Text)
	{
		return std::string(TCHAR_TO_UTF8(*Text));
	}

	FString ToF(std::string_view Text)
	{
		const std::string Copy(Text);
		return FString(UTF8_TO_TCHAR(Copy.c_str()));
	}

	class FJuliusJ1UtcClock final : public WonderlandJuliusMissionClient::IUtcClock
	{
	public:
		std::uint64_t NowUtcMs() const override
		{
			const FDateTime Now = FDateTime::UtcNow();
			const int64 UnixSeconds = Now.ToUnixTimestamp();
			if (UnixSeconds < 0) { return 0; }
			return static_cast<std::uint64_t>(UnixSeconds) * 1000ull + static_cast<std::uint64_t>(Now.GetMillisecond());
		}

		bool NtpOffsetMs(std::int64_t& OutOffsetMs) const override
		{
			(void)OutOffsetMs;
			return false;
		}
	};

	class FJuliusJ1FileTrace final : public WonderlandJuliusMissionClient::ITraceSink
	{
	public:
		explicit FJuliusJ1FileTrace(FString InRoot) : Root(MoveTemp(InRoot)) {}

		bool Append(std::string_view RunId, std::string_view Line) override
		{
			const std::string Path = WonderlandJuliusMissionClient::JuliusTraceFilePath(ToStd(Root), RunId);
			if (Path.empty() || Line.empty()) { return false; }
			const FString Full = ToF(Path);
			IFileManager::Get().MakeDirectory(*FPaths::GetPath(Full), true);
			TArray<uint8> Bytes;
			Bytes.Append(reinterpret_cast<const uint8*>(Line.data()), static_cast<int32>(Line.size()));
			if (!FFileHelper::SaveArrayToFile(Bytes, *Full, &IFileManager::Get(), FILEWRITE_Append)) { return false; }
			FString Shown = ToF(Line);
			Shown.TrimEndInline();
			UE_LOG(LogJuliusJ1, Display, TEXT("%s"), *Shown);
			return true;
		}

		std::string PathFor(std::string_view RunId) const override
		{
			return WonderlandJuliusMissionClient::JuliusTraceFilePath(ToStd(Root), RunId);
		}

		std::size_t LineCount(std::string_view RunId) const override
		{
			const std::string Path = PathFor(RunId);
			if (Path.empty()) { return 0; }
			TArray<uint8> Bytes;
			if (!FFileHelper::LoadFileToArray(Bytes, *ToF(Path))) { return 0; }
			std::size_t Count = 0;
			for (const uint8 Byte : Bytes)
			{
				if (Byte == static_cast<uint8>('\n')) { ++Count; }
			}
			return Count;
		}

	private:
		FString Root;
	};

	class FJuliusJ1FileStore final : public WonderlandJuliusMissionClient::ITextStore
	{
	public:
		explicit FJuliusJ1FileStore(FString InPath) : Path(MoveTemp(InPath)) {}

		bool Write(std::string_view Text) override
		{
			IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), true);
			TArray<uint8> Bytes;
			Bytes.Append(reinterpret_cast<const uint8*>(Text.data()), static_cast<int32>(Text.size()));
			return FFileHelper::SaveArrayToFile(Bytes, *Path);
		}

		bool Read(std::string& OutText) override
		{
			TArray<uint8> Bytes;
			if (!FFileHelper::LoadFileToArray(Bytes, *Path)) { return false; }
			OutText.assign(reinterpret_cast<const char*>(Bytes.GetData()), static_cast<std::size_t>(Bytes.Num()));
			return !OutText.empty();
		}

	private:
		FString Path;
	};

	UWonderlandJuliusMissionSubsystem* FindJulius(UWorld* World)
	{
		if (World == nullptr) { return nullptr; }
		UGameInstance* Instance = World->GetGameInstance();
		if (Instance == nullptr) { return nullptr; }
		return Instance->GetSubsystem<UWonderlandJuliusMissionSubsystem>();
	}
}

struct UWonderlandJuliusMissionSubsystem::FHost
{
	FWonderlandJuliusPlatformCryptoRandom Random;
	FJuliusJ1UtcClock Clock;
	FJuliusJ1FileTrace Trace;
	FJuliusJ1FileStore Store;
	WonderlandJuliusMissionClient::FJuliusMissionSession Session;

	explicit FHost(const FString& SavedDir)
		: Trace(SavedDir)
		, Store(FPaths::Combine(SavedDir, TEXT("SaveGames/JuliusJ1/open-pair.v1")))
		, Session(Random, Clock, Trace, Store)
	{
	}
};

struct FJuliusJ1Transport
{
	static bool Send(UWonderlandJuliusMissionSubsystem& Self, const WonderlandJuliusMissionClient::FWireRequest& Request)
	{
		using namespace WonderlandJuliusMissionClient;
		if (Self.Host == nullptr) { return false; }
		if (!IsLoopbackBaseUrl(Request.Url))
		{
			FHttpResult Fail;
			Fail.bTransportError = true;
			Fail.bResend = Request.bResend;
			if (Request.bStatusPoll) { Self.Host->Session.OnStatusHttp(Fail); }
			else { Self.Host->Session.OnDispatchHttp(Fail); }
			Self.NoteDetail(TEXT("endpoint is not loopback"));
			return false;
		}
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Http = FHttpModule::Get().CreateRequest();
		Http->SetVerb(ToF(Request.Method));
		Http->SetURL(ToF(Request.Url));
		for (const std::pair<std::string, std::string>& Header : Request.Headers)
		{
			Http->SetHeader(ToF(Header.first), ToF(Header.second));
		}
		if (!Request.Body.empty())
		{
			TArray<uint8> Content;
			Content.Append(reinterpret_cast<const uint8*>(Request.Body.data()), static_cast<int32>(Request.Body.size()));
			Http->SetContent(Content);
		}
		Http->SetDelegateThreadPolicy(EHttpRequestDelegateThreadPolicy::CompleteOnGameThread);
		const bool bStatus = Request.bStatusPoll;
		const bool bResend = Request.bResend;
		const uint64 StartUtcMs = Self.Host->Clock.NowUtcMs();
		TWeakObjectPtr<UWonderlandJuliusMissionSubsystem> Weak(&Self);
		Http->OnProcessRequestComplete().BindLambda(
			[Weak, bStatus, bResend, StartUtcMs](FHttpRequestPtr /*Request*/, FHttpResponsePtr Response, bool bConnected)
			{
				if (!Weak.IsValid()) { return; }
				Weak->CompleteHttp(bStatus, bResend, StartUtcMs, bConnected, Response);
			});
		if (!Http->ProcessRequest())
		{
			FHttpResult Fail;
			Fail.bTransportError = true;
			Fail.bResend = bResend;
			if (bStatus) { Self.Host->Session.OnStatusHttp(Fail); }
			else { Self.Host->Session.OnDispatchHttp(Fail); }
			Self.NoteDetail(TEXT("http did not start"));
			return false;
		}
		return true;
	}
};

UWonderlandJuliusMissionSubsystem::UWonderlandJuliusMissionSubsystem() = default;

UWonderlandJuliusMissionSubsystem::~UWonderlandJuliusMissionSubsystem() = default;

void UWonderlandJuliusMissionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	const FString SavedDir = FPaths::ProjectSavedDir();
	Host = MakeUnique<FHost>(SavedDir);
	ApplyConfiguredEndpoint();
	if (!Host->Session.Load())
	{
		UE_LOG(LogJuliusJ1, Display, TEXT("no open pair restored"));
	}
	else
	{
		UE_LOG(LogJuliusJ1, Display, TEXT("open pair restored"));
	}
	TickerHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateUObject(this, &UWonderlandJuliusMissionSubsystem::HandleTick), 0.1f);
}

void UWonderlandJuliusMissionSubsystem::Deinitialize()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickerHandle);
	Host.Reset();
	Super::Deinitialize();
}

void UWonderlandJuliusMissionSubsystem::ApplyConfiguredEndpoint()
{
	if (Host == nullptr) { return; }
#if UE_BUILD_SHIPPING
	Host->Session.SetBaseUrl(WonderlandJuliusMissionClient::DefaultBridgeBaseUrl);
#else
	const FString Configured = CVarJuliusJ1Endpoint.GetValueOnGameThread();
	Host->Session.SetBaseUrl(ToStd(Configured));
#endif
}

void UWonderlandJuliusMissionSubsystem::SetNativeSession(const FString& Token)
{
	if (Host == nullptr) { return; }
	Host->Session.SetNativeSessionToken(ToStd(Token));
	UE_LOG(LogJuliusJ1, Display, TEXT("native session updated"));
}

void UWonderlandJuliusMissionSubsystem::SetProjectId(const FString& InProjectId)
{
	if (Host != nullptr) { Host->Session.SetProjectId(ToStd(InProjectId)); }
}

void UWonderlandJuliusMissionSubsystem::SetPlayerNetId(const FString& InPlayerNetId)
{
	if (Host != nullptr) { Host->Session.SetPlayerNetId(ToStd(InPlayerNetId)); }
}

void UWonderlandJuliusMissionSubsystem::SetBuildIdentity(const FString& BuildSha, const FString& PackageId)
{
	if (Host != nullptr) { Host->Session.SetBuildIdentity(ToStd(BuildSha), ToStd(PackageId)); }
}

void UWonderlandJuliusMissionSubsystem::SetExpectedResultMode(const FString& Mode)
{
	if (Host != nullptr) { Host->Session.SetExpectedResultMode(ToStd(Mode)); }
}

void UWonderlandJuliusMissionSubsystem::SetClockOffset(bool bKnown, int64 OffsetMs, const FString& Source)
{
	if (Host != nullptr) { Host->Session.SetClockOffset(bKnown, static_cast<std::int64_t>(OffsetMs), ToStd(Source)); }
}

bool UWonderlandJuliusMissionSubsystem::DispatchMission(const FString& MissionId, const FString& PairId)
{
	if (Host == nullptr) { return false; }
	ApplyConfiguredEndpoint();
	const WonderlandJuliusMissionClient::FCommandOutcome Outcome = Host->Session.Dispatch(ToStd(MissionId), ToStd(PairId));
	if (!Outcome.bSent)
	{
		NoteDetail(ToF(Outcome.Detail));
		return false;
	}
	return FJuliusJ1Transport::Send(*this, Outcome.Request);
}

bool UWonderlandJuliusMissionSubsystem::ResendOpenPair()
{
	if (Host == nullptr) { return false; }
	ApplyConfiguredEndpoint();
	const WonderlandJuliusMissionClient::FCommandOutcome Outcome = Host->Session.Resend();
	if (!Outcome.bSent)
	{
		NoteDetail(ToF(Outcome.Detail));
		return false;
	}
	return FJuliusJ1Transport::Send(*this, Outcome.Request);
}

FString UWonderlandJuliusMissionSubsystem::StatusLine() const
{
	if (Host == nullptr) { return TEXT("{\"ui_state\":\"idle\",\"server_run_id\":null}"); }
	return ToF(Host->Session.StatusJson());
}

FString UWonderlandJuliusMissionSubsystem::PlayerLabel() const
{
	if (Host == nullptr) { return ToF(WonderlandJuliusMissionClient::LabelIdle); }
	return ToF(Host->Session.PlayerLabel());
}

FString UWonderlandJuliusMissionSubsystem::UiStateToken() const
{
	if (Host == nullptr) { return TEXT("idle"); }
	return ToF(WonderlandJuliusMissionClient::UiStateToken(Host->Session.UiState()));
}

FString UWonderlandJuliusMissionSubsystem::ArtifactLabel() const
{
	if (Host == nullptr) { return FString(); }
	return ToF(Host->Session.ArtifactLabel());
}

FString UWonderlandJuliusMissionSubsystem::ServerRunId() const
{
	if (Host == nullptr || !Host->Session.HasServerRunId()) { return FString(); }
	return ToF(Host->Session.ServerRunId());
}

bool UWonderlandJuliusMissionSubsystem::HasServerRunId() const
{
	return Host != nullptr && Host->Session.HasServerRunId();
}

void UWonderlandJuliusMissionSubsystem::NotifyReplicatedMissionObserved(
	const FString& RunId,
	const FString& PlayerNetId,
	const FString& InUiStateToken,
	const FString& UiLabel,
	const FString& InServerRunId,
	bool bServerRunIdKnown)
{
	if (Host == nullptr) { return; }
	WonderlandJuliusMissionClient::FObserverReceipt Receipt;
	Receipt.RunId = ToStd(RunId);
	Receipt.PlayerNetId = ToStd(PlayerNetId);
	Receipt.UiStateToken = ToStd(InUiStateToken);
	Receipt.UiLabel = ToStd(UiLabel);
	Receipt.ServerRunId = ToStd(InServerRunId);
	Receipt.bServerRunIdKnown = bServerRunIdKnown;
	Host->Session.NoteObserverReceipt(Receipt);
}

bool UWonderlandJuliusMissionSubsystem::HandleTick(float DeltaSeconds)
{
	(void)DeltaSeconds;
	if (Host == nullptr) { return true; }
	ApplyConfiguredEndpoint();
	SyncFromPairing();
	const WonderlandJuliusMissionClient::FTickOutcome Outcome = Host->Session.Tick();
	if (Outcome.bSend) { (void)FJuliusJ1Transport::Send(*this, Outcome.Request); }
	PollMissionReads();
	return true;
}

void UWonderlandJuliusMissionSubsystem::AdoptPairedSession(const FString& Token, const FString& InProjectId)
{
	if (Host == nullptr) { return; }
	const uint32 Crc = FCrc::StrCrc32(*Token);
	if (!bAdoptedToken || Crc != AdoptedTokenCrc)
	{
		bAdoptedToken = true;
		AdoptedTokenCrc = Crc;
		SetNativeSession(Token);
	}
	if (InProjectId != AdoptedProjectId)
	{
		AdoptedProjectId = InProjectId;
		SetProjectId(InProjectId);
		UE_LOG(LogJuliusJ1, Display, TEXT("project id adopted from pairing"));
	}
}

void UWonderlandJuliusMissionSubsystem::SyncFromPairing()
{
	if (Host == nullptr) { return; }
	const uint64 NowMs = Host->Clock.NowUtcMs();
	if (NowMs < NextPairingSyncAtUtcMs) { return; }
	NextPairingSyncAtUtcMs = NowMs + 1000;
	UGameInstance* Instance = GetGameInstance();
	const UWonderlandJuliusStreamSubsystem* Stream = Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusStreamSubsystem>() : nullptr;
	if (Stream != nullptr) { (void)Stream->HandNativeSessionToMission(*this); }
}

FString UWonderlandJuliusMissionSubsystem::ClientRunId() const
{
	if (Host == nullptr) { return FString(); }
	return ToF(Host->Session.RunId());
}

bool UWonderlandJuliusMissionSubsystem::LatestMissionReads(
	int32& OutResultStatus,
	FString& OutResultJson,
	int32& OutProgressStatus,
	FString& OutProgressJson) const
{
	OutResultStatus = 0;
	OutProgressStatus = 0;
	OutResultJson.Reset();
	OutProgressJson.Reset();
	if (MissionReadRunId.IsEmpty() || MissionReadRunId != ClientRunId()) { return false; }
	OutResultStatus = ResultRead.Status;
	OutResultJson = ResultRead.Body;
	OutProgressStatus = ProgressRead.Status;
	OutProgressJson = ProgressRead.Body;
	return true;
}

void UWonderlandJuliusMissionSubsystem::PollMissionReads()
{
	if (Host == nullptr) { return; }
	const FString RunId = ClientRunId();
	if (RunId.IsEmpty()) { return; }
	if (RunId != MissionReadRunId)
	{
		// A new attempt: nothing read for the previous run carries over.
		MissionReadRunId = RunId;
		ResultRead = FMissionReadSlot();
		ProgressRead = FMissionReadSlot();
		NextMissionReadAtUtcMs = 0;
	}
	const uint64 NowMs = Host->Clock.NowUtcMs();
	if (NowMs < NextMissionReadAtUtcMs) { return; }
	NextMissionReadAtUtcMs = NowMs + WonderlandJuliusMissionClient::MissionReadPeriodMs;
	SendMissionRead(false);
	SendMissionRead(true);
}

void UWonderlandJuliusMissionSubsystem::SendMissionRead(bool bProgress)
{
	FMissionReadSlot& Slot = bProgress ? ProgressRead : ResultRead;
	if (Slot.bInFlight) { return; }
	const WonderlandJuliusMissionClient::FCommandOutcome Outcome = Host->Session.MissionReadRequest(bProgress);
	if (!Outcome.bSent) { return; }
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Http = FHttpModule::Get().CreateRequest();
	Http->SetVerb(ToF(Outcome.Request.Method));
	Http->SetURL(ToF(Outcome.Request.Url));
	for (const std::pair<std::string, std::string>& Header : Outcome.Request.Headers)
	{
		Http->SetHeader(ToF(Header.first), ToF(Header.second));
	}
	Http->SetDelegateThreadPolicy(EHttpRequestDelegateThreadPolicy::CompleteOnGameThread);
	const FString ForRunId = MissionReadRunId;
	TWeakObjectPtr<UWonderlandJuliusMissionSubsystem> Weak(this);
	Http->OnProcessRequestComplete().BindLambda(
		[Weak, bProgress, ForRunId](FHttpRequestPtr /*Request*/, FHttpResponsePtr Response, bool bConnected)
		{
			if (!Weak.IsValid()) { return; }
			Weak->CompleteMissionRead(bProgress, ForRunId, bConnected, Response);
		});
	Slot.bInFlight = Http->ProcessRequest();
}

void UWonderlandJuliusMissionSubsystem::CompleteMissionRead(
	bool bProgress,
	const FString& ForRunId,
	bool bConnected,
	const TSharedPtr<IHttpResponse, ESPMode::ThreadSafe>& Response)
{
	if (ForRunId != MissionReadRunId) { return; }
	FMissionReadSlot& Slot = bProgress ? ProgressRead : ResultRead;
	Slot.bInFlight = false;
	if (!bConnected || !Response.IsValid())
	{
		// A transport miss keeps the last answer; it is not a new state.
		return;
	}
	const int32 Status = Response->GetResponseCode();
	const FString Body = Response->GetContentAsString();
	if (Status != Slot.Status || Body != Slot.Body)
	{
		UE_LOG(LogJuliusJ1, Display, TEXT("{\"event\":\"mission_read\",\"route\":\"%s\",\"wlj_run_id\":\"%s\",\"status\":%d,\"bytes\":%d}"),
			bProgress ? TEXT("progress") : TEXT("result"), *ForRunId, Status, Body.Len());
	}
	Slot.Status = Status;
	Slot.Body = Body;
}

void UWonderlandJuliusMissionSubsystem::CompleteHttp(
	bool bStatusPoll,
	bool bResend,
	uint64 StartUtcMs,
	bool bConnected,
	const TSharedPtr<IHttpResponse, ESPMode::ThreadSafe>& Response)
{
	if (Host == nullptr) { return; }
	WonderlandJuliusMissionClient::FHttpResult Result;
	Result.bResend = bResend;
	Result.bTransportError = !bConnected || !Response.IsValid();
	if (Response.IsValid())
	{
		Result.Status = Response->GetResponseCode();
		const TArray<uint8>& Content = Response->GetContent();
		if (Content.Num() > 0)
		{
			Result.Body.assign(reinterpret_cast<const char*>(Content.GetData()), static_cast<std::size_t>(Content.Num()));
		}
	}
	const std::uint64_t NowMs = Host->Clock.NowUtcMs();
	Result.LatencyMs = NowMs >= StartUtcMs ? NowMs - StartUtcMs : 0;
	if (bStatusPoll) { Host->Session.OnStatusHttp(Result); }
	else { Host->Session.OnDispatchHttp(Result); }
}

void UWonderlandJuliusMissionSubsystem::NoteDetail(const FString& Detail) const
{
	if (!Detail.IsEmpty())
	{
		UE_LOG(LogJuliusJ1, Display, TEXT("%s"), *Detail);
	}
}

void UWonderlandJuliusMissionSubsystem::DispatchCommand(const TArray<FString>& Args, FOutputDevice& Ar)
{
	if (Args.Num() != 1 && !(Args.Num() == 3 && Args[1] == TEXT("--pair")))
	{
		Ar.Log(TEXT("usage: wl.Julius.J1.Dispatch <missionId> [--pair <id>]"));
		return;
	}
	const FString Pair = Args.Num() == 3 ? Args[2] : FString();
	const bool bSent = DispatchMission(Args[0], Pair);
	Ar.Log(bSent ? TEXT("dispatch sent") : TEXT("dispatch not sent"));
}

void UWonderlandJuliusMissionSubsystem::ResendCommand(FOutputDevice& Ar)
{
	const bool bSent = ResendOpenPair();
	Ar.Log(bSent ? TEXT("resend sent") : TEXT("resend not sent"));
}

void UWonderlandJuliusMissionSubsystem::StatusCommand(FOutputDevice& Ar)
{
	Ar.Log(StatusLine());
}

void UWonderlandJuliusMissionSubsystem::DumpTraceCommand(FOutputDevice& Ar)
{
	if (Host == nullptr)
	{
		Ar.Log(TEXT("no trace file"));
		return;
	}
	const FString Path = ToF(Host->Session.TraceLocation());
	TArray<uint8> Bytes;
	if (Path.IsEmpty() || !FFileHelper::LoadFileToArray(Bytes, *Path))
	{
		Ar.Log(TEXT("no trace file"));
		return;
	}
	std::string Text(reinterpret_cast<const char*>(Bytes.GetData()), static_cast<std::size_t>(Bytes.Num()));
	std::size_t Cursor = 0;
	while (Cursor < Text.size())
	{
		const std::size_t End = Text.find('\n', Cursor);
		const std::size_t Count = (End == std::string::npos ? Text.size() : End) - Cursor;
		if (Count > 0) { Ar.Log(ToF(std::string_view(Text.data() + Cursor, Count))); }
		if (End == std::string::npos) { break; }
		Cursor = End + 1;
	}
}

static void JuliusDispatchCommand(const TArray<FString>& Args, UWorld* World, FOutputDevice& Ar)
{
	UWonderlandJuliusMissionSubsystem* Session = FindJulius(World);
	if (Session == nullptr) { Ar.Log(TEXT("wl.Julius.J1.Dispatch: no session")); return; }
	Session->DispatchCommand(Args, Ar);
}

static void JuliusResendCommand(const TArray<FString>& Args, UWorld* World, FOutputDevice& Ar)
{
	(void)Args;
	UWonderlandJuliusMissionSubsystem* Session = FindJulius(World);
	if (Session == nullptr) { Ar.Log(TEXT("wl.Julius.J1.Resend: no session")); return; }
	Session->ResendCommand(Ar);
}

static void JuliusStatusCommand(const TArray<FString>& Args, UWorld* World, FOutputDevice& Ar)
{
	(void)Args;
	UWonderlandJuliusMissionSubsystem* Session = FindJulius(World);
	if (Session == nullptr) { Ar.Log(TEXT("{\"ui_state\":\"idle\",\"server_run_id\":null}")); return; }
	Session->StatusCommand(Ar);
}

static void JuliusDumpTraceCommand(const TArray<FString>& Args, UWorld* World, FOutputDevice& Ar)
{
	(void)Args;
	UWonderlandJuliusMissionSubsystem* Session = FindJulius(World);
	if (Session == nullptr) { Ar.Log(TEXT("no trace file")); return; }
	Session->DumpTraceCommand(Ar);
}

static FAutoConsoleCommandWithWorldArgsAndOutputDevice GJuliusDispatchCommand(
	TEXT("wl.Julius.J1.Dispatch"),
	TEXT("Dispatch a Julius mission on the open loopback bridge. Usage: wl.Julius.J1.Dispatch <missionId> [--pair <id>]"),
	FConsoleCommandWithWorldArgsAndOutputDeviceDelegate::CreateStatic(&JuliusDispatchCommand));

static FAutoConsoleCommandWithWorldArgsAndOutputDevice GJuliusResendCommand(
	TEXT("wl.Julius.J1.Resend"),
	TEXT("Resend the open Julius pair. Never mints a new pair."),
	FConsoleCommandWithWorldArgsAndOutputDeviceDelegate::CreateStatic(&JuliusResendCommand));

static FAutoConsoleCommandWithWorldArgsAndOutputDevice GJuliusStatusCommand(
	TEXT("wl.Julius.J1.Status"),
	TEXT("Print one JSON line of the Julius J1 session, including server_run_id."),
	FConsoleCommandWithWorldArgsAndOutputDeviceDelegate::CreateStatic(&JuliusStatusCommand));

static FAutoConsoleCommandWithWorldArgsAndOutputDevice GJuliusDumpTraceCommand(
	TEXT("wl.Julius.J1.DumpTrace"),
	TEXT("Print the JSONL trace for the current wlj_ run."),
	FConsoleCommandWithWorldArgsAndOutputDeviceDelegate::CreateStatic(&JuliusDumpTraceCommand));

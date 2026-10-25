// WONDERLAND -- game-instance owner of one J1 mission attempt.
//
// The pure session (WonderlandJuliusMissionClient) decides. This type only
// moves bytes: loopback HTTP, the local save, the JSONL trace, and the
// Display log. It does not mint run ids, classify answers, or call a provider.
//
// Console (every build):
//   wl.Julius.J1.Dispatch <missionId> [--pair <id>]
//   wl.Julius.J1.Resend
//   wl.Julius.J1.Status
//   wl.Julius.J1.DumpTrace
// --pair is a non-secret correlation id. It is not the idempotency key and
// not the session token. The token is SetNativeSession only, and it is never
// printed.
//
// wl.Julius.J1.Endpoint exists only when UE_BUILD_SHIPPING is 0. Shipping
// always uses http://127.0.0.1:8790. In every build a non-loopback host
// refuses the dispatch and sends nothing.
//
// Replication is FORGE's. When replicated state arrives, call
// NotifyReplicatedMissionObserved. That writes one observer trace line under
// the same wlj_ run id and does not send HTTP and does not mint.

#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpResponse.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandJuliusMissionSubsystem.generated.h"

DECLARE_LOG_CATEGORY_EXTERN(LogJuliusJ1, Log, All);

class IHttpResponse;
struct FJuliusJ1Transport;

UCLASS()
class UWonderlandJuliusMissionSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	UWonderlandJuliusMissionSubsystem();
	virtual ~UWonderlandJuliusMissionSubsystem() override;

	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Memory only. Never written to the save and never written to the log. */
	void SetNativeSession(const FString& Token);
	/**
	 * From UWonderlandJuliusStreamSubsystem::HandNativeSessionToMission: the paired native session and the project it
	 * was paired for. Changes the session only when either differs; logs that it changed, never the token.
	 */
	void AdoptPairedSession(const FString& Token, const FString& InProjectId);
	void SetProjectId(const FString& InProjectId);
	void SetPlayerNetId(const FString& InPlayerNetId);
	void SetBuildIdentity(const FString& BuildSha, const FString& PackageId);
	void SetExpectedResultMode(const FString& Mode);
	/** Source is "ntp" or "system". Known false leaves the offset unknown (null, not 0). */
	void SetClockOffset(bool bKnown, int64 OffsetMs, const FString& Source);

	/** True when a request was handed to HTTP. A refusal mints nothing. */
	bool DispatchMission(const FString& MissionId, const FString& PairId);
	bool ResendOpenPair();

	/** One JSON object, no newline. Includes server_run_id. No token, no key. */
	FString StatusLine() const;
	FString PlayerLabel() const;
	FString UiStateToken() const;
	FString ArtifactLabel() const;
	FString ServerRunId() const;
	bool HasServerRunId() const;
	/** The loopback base J1 sends to (wl.Julius.J1.Endpoint; Shipping: http://127.0.0.1:8790). */
	FString EndpointBase() const;
	/** True once a paired native session was adopted (the token itself is never exposed). */
	bool HasNativeSession() const { return bAdoptedToken; }
	/** The mission id of the current attempt (restored from the save after a restart), or empty. */
	FString CurrentMissionId() const;
	/** The client-minted wlj_ id of the current attempt, or empty. */
	FString ClientRunId() const;

	/**
	 * Last /result and /progress answers for the current wlj_ run, as BRIDGE sent them (status 0 = not read yet).
	 * The subsystem polls both every MissionReadPeriodMs once a run exists. It parses nothing: the flow panel
	 * owns the meaning. Returns false when no run exists.
	 */
	bool LatestMissionReads(int32& OutResultStatus, FString& OutResultJson, int32& OutProgressStatus, FString& OutProgressJson) const;
	void CompleteMissionRead(bool bProgress, const FString& ForRunId, bool bConnected, const TSharedPtr<IHttpResponse, ESPMode::ThreadSafe>& Response);

	/**
	 * FORGE calls this when replicated mission state arrives. client_role=observer,
	 * same wlj_ run id. Does not change the sender's UI and does not send.
	 */
	void NotifyReplicatedMissionObserved(
		const FString& RunId,
		const FString& PlayerNetId,
		const FString& UiStateToken,
		const FString& UiLabel,
		const FString& InServerRunId,
		bool bServerRunIdKnown);

	void DispatchCommand(const TArray<FString>& Args, FOutputDevice& Ar);
	void ResendCommand(FOutputDevice& Ar);
	void StatusCommand(FOutputDevice& Ar);
	void DumpTraceCommand(FOutputDevice& Ar);
	void CompleteHttp(bool bStatusPoll, bool bResend, uint64 StartUtcMs, bool bConnected, const TSharedPtr<IHttpResponse, ESPMode::ThreadSafe>& Response);

private:
	friend struct FJuliusJ1Transport;

	struct FHost;
	TUniquePtr<FHost> Host;
	FTSTicker::FDelegateHandle TickerHandle;
	bool bHttpOutstanding = false;

	struct FMissionReadSlot
	{
		int32 Status = 0;
		FString Body;
		bool bInFlight = false;
	};
	FString MissionReadRunId;
	FMissionReadSlot ResultRead;
	FMissionReadSlot ProgressRead;
	uint64 NextMissionReadAtUtcMs = 0;
	uint32 AdoptedTokenCrc = 0;
	bool bAdoptedToken = false;
	FString AdoptedProjectId;
	uint64 NextPairingSyncAtUtcMs = 0;

	/** Once a second: take the paired session from the Julius stream subsystem, when it has one. */
	void SyncFromPairing();

	bool HandleTick(float DeltaSeconds);
	void PollMissionReads();
	void SendMissionRead(bool bProgress);
	void ApplyConfiguredEndpoint();
	void NoteDetail(const FString& Detail) const;
};

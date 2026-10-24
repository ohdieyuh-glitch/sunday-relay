// WONDERLAND -- companion UE adapter seam. NOT COMPILED: there is no Unreal toolchain on the box where this was written.
// Every Unreal API named here is UNVERIFIED against the project's engine version and must be checked in the editor.
// Build.cs: #433's Wonderland.Build.cs (blob bc070d53e2e7) already lists "HTTP", "UMG", "Slate", "SlateCore", "Json" and
// (private) "PlatformCrypto", "PlatformCryptoTypes", "PlatformCryptoContext"; this file depends on #433 for that and for
// Julius/WonderlandJuliusRandomBytes.h. No UMG widget asset exists for it yet.
//
// RULES (all enforced by the pure core WonderlandCompanionLogic, which this file only feeds):
//   - BYOAI only, provider-agnostic. The only server this talks to is the loopback relay origin it is given; there is
//     no i.Wonder key, no provider URL, no provider name and no fallback anywhere in this file. Every agent is addressed
//     by its server-issued agentId; a providerId is an opaque string the player's UI chose and the server's adapter owns.
//   - Several agents can be connected at once; one agent's failure or disconnect never touches another.
//   - Capabilities shown are the agent's authorizedCapabilities from the server only; nothing is inferred.
//   - No API key is collected or sent: BRIDGE's connect route (7e5e1e30) refuses credentials and no route takes one.
//     Where the player's provider auth happens is an OPEN question for BRIDGE. UE_LOG calls print trace words only.
//   - OPEN: BRIDGE's dispatch guard needs "authorization: Relay-Session <token>" on every companion route
//     (admission-route.ts:255-295). This seam does not set it yet; it must reuse #433's native session, never copy it.
//   - Idempotency keys come from the J1 random path: #433's FWonderlandJuliusPlatformCryptoRandom (IPlatformCrypto
//     CreateRandomBytes, no fallback) -> FIdempotencyKeyMinter -> canonical lowercase UUIDv4. Never FGuid::NewGuid
//     (FGuid is not a v4 UUID by construction). A failed source sends nothing (ApplyKeyMintFailure).
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Interfaces/IHttpRequest.h"
#include "WonderlandCompanionLogic.h"
#include "Wonderland/Julius/WonderlandJuliusRandomBytes.h"
#include "WonderlandCompanionClient.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnWonderlandCompanionViewChanged);

UCLASS()
class UWonderlandCompanionClient : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/**
	 * Q9: pass the SAME configured relay base URL the J1 dispatch path (#433) uses; there is no discovery. Only a strict
	 * loopback origin (http://127.0.0.1:<port> or http://[::1]:<port>, one trailing '/' allowed) is used: "localhost",
	 * which #433 accepts, keeps the companion Offline.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void Start(const FString& J1RelayBaseUrl, const FString& ProjectId);

	/** v0.2: GET the mission companion route and upsert its agents[] slots (per slot, fail closed per slot). */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void RefreshMissionAgents(const FString& WljRunId, const FString& ProjectId);

	/** POST /companions/agents?projectId= {providerId (opaque)[, wljRunId][, displayName]}. 201 only; an unknown providerId answers an unsupported slot. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void ConnectAgent(const FString& ProviderId, const FString& WljRunIdOrEmpty, const FString& DisplayLabelOrEmpty);
	/** GET /companions/agents/{agentId}?projectId=. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void RefreshAgent(const FString& AgentId);
	/** DELETE /companions/agents/{agentId}?projectId= (200 + the disconnected descriptor). */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void Disconnect(const FString& AgentId);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SendMessage(const FString& AgentId, const FString& Message, const FString& WljRunIdOrEmpty);
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void Resend(const FString& AgentId);
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void DeleteHistory(const FString& AgentId);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	TArray<FString> GetAgentIds() const;
	/** Per-agent view: displayName, authorized capabilities only, state, status line, partial reply, banner. nullptr if unknown. */
	const WonderlandCompanionLogic::FAgentView* GetAgentView(const FString& AgentId) const;
	const WonderlandCompanionLogic::FTurnHistory* GetHistory(const FString& AgentId) const;
	/** Session-wide: origin, project, connect in flight, the last connect notice, unreadable slots, the SIMULATED banner. */
	const WonderlandCompanionLogic::FCompanionSessionView& GetSessionView() const { return Session->SessionView(); }

	/** #447: the companion route's traceId for WljRunId as BRIDGE reported it; empty when absent, null, malformed or another run. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	FString GetMissionTraceId(const FString& WljRunId) const { return WljRunId.Equals(MissionTraceWljRunId, ESearchCase::CaseSensitive) ? MissionTraceId : FString(); }

	UPROPERTY(BlueprintAssignable, Category = "Wonderland|Companion")
	FOnWonderlandCompanionViewChanged OnViewChanged;

private:
	void Issue(const WonderlandCompanionLogic::FRelayRequest& Request, TFunction<void(int32, const FString&, const TArray<uint8>&)> OnDone);
	void StartChatRequest(const FString& AgentId, const WonderlandCompanionLogic::FRelayRequest& Request);
	/** Empty when the random source failed or repeated; the session has then been told (ApplyKeyMintFailure). */
	FString NewIdempotencyKey(const FString& AgentIdOrEmpty);
	uint64 NowMs() const;
	void Changed();

	TUniquePtr<WonderlandCompanionLogic::FCompanionSession> Session;
	FWonderlandJuliusPlatformCryptoRandom Random;
	WonderlandCompanionLogic::FIdempotencyKeyMinter KeyMinter;
	/** One chat stream per agent, keyed by agentId. */
	TMap<FString, TSharedPtr<IHttpRequest, ESPMode::ThreadSafe>> ChatRequests;
	/** Last companion read's run and its parsed traceId (ParseCompanionMission). */
	FString MissionTraceWljRunId;
	FString MissionTraceId;
};

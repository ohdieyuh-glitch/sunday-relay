// WONDERLAND — THE COMPANIONS' INTELLIGENCE, READ FROM THE RUNTIME.
//
// FOUNDER DIRECTIVE (2026-09-17): "BEGIN REAL CHATGPT + CLAUDE CODE SIDEKICK INTEGRATION … Now make the intelligence
// behind them real." The bodies and the terminals already exist (WonderlandCompanionEmbodiment.h,
// WonderlandCompanionTerminal.h); this is the seam through which something actually thinks behind them.
//
// THREE IDENTITIES, AND THEY DO NOT COLLAPSE. Locked by the founder, and this file holds the line in Wonderland:
//   JULIUS, the Relay Dog, is the COMPOUND agent and the mission authority. It is not here. Nothing in this file can
//   give a companion mission authority, because nothing in this file grants authority at all -- it reads.
//   JHINN is a SINGLE agent: one scoped task, reported back. The runtime enforces that; this shows it.
//   THE LLM COMPANION converses, and holds no authority over anything.
//
// IT IS A VIEW, AND IT DECIDES NOTHING. Every state, every provider name, every model name and every word of every
// answer comes from the local sidekick service (relay-bridge/sidekicks). Wonderland renders it. When the service is not
// running the companions say OFFLINE and the command that starts it -- they do not invent a mood.
//
// NO SECRET CROSSES THIS LINE. The service holds no credential material and this client refuses a body that looks like
// it is carrying any. The founder is never asked to type a secret into a terminal, a console or a chat: credentials are
// connected through Julius Connect's own path, or through the provider's own tool on this machine.
//
// SIMULATED IS A STATE, NOT A DISGUISE. Until the founder connects a real provider, every answer is a fixture's and the
// terminal says so on the line where the answer appears.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandSidekicks.generated.h"

class FJsonObject;

/** Whether the local sidekick service is answering. Nothing about a provider: that is the sidekick's own state. */
enum class EWonderlandSidekickLink : uint8
{
	Connecting,
	Online,
	Offline,
};

/** One companion as the runtime reports it. Strings, because every one of them is shown to a person as it is. */
struct FWonderlandSidekick
{
	FString SidekickId;
	/** "llm_companion" or "single_agent". */
	FString Kind;
	/** SIMULATED, AUTH_REQUIRED, CONNECTING, CONNECTED, WORKING, RATE_LIMITED, FAILED, DISCONNECTED. */
	FString State;
	/** IDLE, LISTENING, THINKING, WORKING, RESPONDING, WAITING_FOR_AUTH, ERROR, DISCONNECTED -- what the body does. */
	FString Mascot;
	FString ProviderId;
	FString ProviderName;
	FString ModelId;
	/** SIMULATED or REAL. Never guessed: the runtime says which, per answer. */
	FString Mode;
	FString Note;
	/** "conversation" for the companion, "scoped_work" for Jhinn. Never "mission": that is Julius's. */
	FString Authority;
	FString SessionId;
	int32 Turns = 0;
	bool bHasLiveTurn = false;
	FString LiveTurnId;
	FString LiveState;
	FString LiveAsk;
	FString LiveAnswer;
	FString LastAnswer;
	FString Failure;
};

/** What a real provider says about itself on THIS machine, found by asking rather than assumed. */
struct FWonderlandSidekickProvider
{
	FString ProviderId;
	FString DisplayName;
	/** "llm_companion" or "single_agent". */
	FString Backs;
	bool bReady = false;
	/** What is actually missing: the tool, the account, or permission to spend. Shown to the founder as it is. */
	FString Detail;
};

DECLARE_MULTICAST_DELEGATE(FOnWonderlandSidekicksChanged);

/**
 * The client. Polls the local service, sends the user's intents, and tells the world when anything changed.
 */
UCLASS()
class WONDERLAND_API UWonderlandSidekickSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	EWonderlandSidekickLink GetLink() const { return Link; }
	const FString& GetLinkProblem() const { return LinkProblem; }
	const TArray<FWonderlandSidekick>& GetSidekicks() const { return Sidekicks; }
	const FWonderlandSidekick* Find(const FString& SidekickId) const;
	/** Index 0 is the LLM Companion and 1 the Jhinn, as the companion preview has always ordered them. */
	const FWonderlandSidekick* ByIndex(int32 Index) const;
	const TArray<FWonderlandSidekickProvider>& GetProviders() const { return Providers; }
	/** Ask each real provider whether it is there. Free: a version check or a models listing, never a completion. */
	void Probe();
	int32 GetRevision() const { return Revision; }
	FOnWonderlandSidekicksChanged OnChanged;

	// ---------------------------------------------------------------- what the user can ask for
	/** Put a provider behind a companion. A real one will answer AUTH_REQUIRED until the founder has connected it. */
	void Connect(const FString& SidekickId, const FString& ProviderId, const FString& ModelId = FString());
	/** Say something to a companion. Refused by the runtime unless it is really connected. */
	void Ask(const FString& SidekickId, const FString& Text);
	void Cancel(const FString& SidekickId);
	void Disconnect(const FString& SidekickId);
	void ChooseModel(const FString& SidekickId, const FString& ModelId);
	void Reset();

	/** The companions as one line, for a proof job. Never a credential, and never a whole answer. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Sidekicks")
	FString DescribeSidekicks() const;

	/** What the body of this companion should be doing right now, or DISCONNECTED when there is nothing to read. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Sidekicks")
	FString MascotStateOf(const FString& SidekickId) const;

private:
	bool Tick(float DeltaSeconds);
	void Poll();
	void SendIntent(const FString& Body, const FString& Describe);
	void Accept(const FString& Text);
	void SetLink(EWonderlandSidekickLink NewLink, const FString& Problem);
	static FString BaseUrl();
	void Changed();

	EWonderlandSidekickLink Link = EWonderlandSidekickLink::Connecting;
	FString LinkProblem;
	TArray<FWonderlandSidekick> Sidekicks;
	TArray<FWonderlandSidekickProvider> Providers;
	int32 Revision = 0;
	int32 ServiceRevision = -1;
	bool bPollInFlight = false;
	double NextPollAt = 0.0;
	int32 IntentsSent = 0;
	TArray<FHttpRequestPtr> InFlight;
	FTSTicker::FDelegateHandle Ticker;
};

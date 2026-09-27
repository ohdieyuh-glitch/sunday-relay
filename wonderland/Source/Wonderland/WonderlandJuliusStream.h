// WONDERLAND JULIUS STREAM -- THE TRANSPORT BETWEEN THE BRIDGE AND THE WORLD.
//
// UWonderlandJuliusSubsystem is deliberately passive: "no tick, no polling, no socket -- pushed to and read from".
// Until 2026-09-27 nothing pushed to it. Every HTTP client in this module talked to the local Connect service;
// none talked to the bridge, so no real Julius state could reach the world. This is that missing half.
//
// WHAT IT DOES, AND ONLY THROUGH THE SUBSYSTEM'S OWN PUBLIC API:
//
//   AUTHENTICATE   with a NATIVE session. A signed-in player pairs this client from the website and it redeems the
//                  code (POST /relay-api/wonderland/native/session). The session is held in memory only; a bridge
//                  restart or its 30-minute expiry means pairing again. Where the token comes from is behind
//                  IWonderlandJuliusTokenSource, so a device-code flow can replace pairing without touching this.
//   HYDRATE        GET /relay-api/wonderland/julius/hydrate -> WonderlandDecodeHydrationBytes -> AdoptHydration.
//   FOLLOW         GET /relay-api/wonderland/julius/events?mode=page from the subsystem's OWN cursor
//                  (GetResumeAfterSequence) -> WonderlandDecodeDeliveryBytes -> ApplyEnvelope, page after page.
//                  mode=page, not SSE: this module's HTTP client has no first-class SSE, and a cursor read is
//                  simpler to make correct. The deliveries are identical to the stream's.
//   RECONNECT      on any failure: mark the link STALE, back off, and HYDRATE AGAIN from durable state before reading
//                  on from the cursor. It never marks a mission failed or complete, never resets it, never creates a
//                  run -- it cannot: it only calls AdoptHydration, ApplyEnvelope and SetLinkStatus, and the subsystem
//                  refuses anything that would let a dropped link produce an ending.
//
// THE RUN IS THE RUN IT WAS GIVEN. Follow() takes the exact runId Julius returned. A missionId can own several runs
// (Julius confirmed a changed contract is a new run), so a missionId is never used to choose one.
//
// NO USTRUCT, NO UENUM. Nothing here is a document that crosses the seam, so nothing here enters the
// TypeScript/C++ parity table; every type on the wire is the existing decoder's.
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandEnvelope.h"
#include "WonderlandJuliusState.h"
#include "WonderlandTypes.h"
#include "WonderlandJuliusStream.generated.h"

class UWonderlandJuliusSubsystem;

/**
 * Where the transport gets the player's identity. Pairing today; a device-code flow can implement this later and the
 * transport will not notice.
 */
class WONDERLAND_API IWonderlandJuliusTokenSource
{
public:
	virtual ~IWonderlandJuliusTokenSource() = default;
	/** The session token, or an empty string when there is none. */
	virtual FString CurrentToken() const = 0;
	/** The bridge refused the token -- expired, revoked, or the bridge restarted. Forget it. */
	virtual void Invalidate() = 0;
};

/** A native session redeemed from a pairing code. In memory only: it never reaches disk. */
class WONDERLAND_API FWonderlandPairedTokenSource final : public IWonderlandJuliusTokenSource
{
public:
	virtual FString CurrentToken() const override { return Token; }
	virtual void Invalidate() override { Token.Reset(); }
	void Adopt(const FString& InToken) { Token = InToken; }

private:
	FString Token;
};

/**
 * The parts with no HTTP and no UObject, so they can be reasoned about -- and checked -- on their own.
 */
namespace WonderlandJuliusStreamLogic
{
	/**
	 * The embodiment for one envelope, by the SAME recipe UWonderlandJuliusSubsystem::AdoptHydration uses for a
	 * snapshot: the envelope already carries Relay's decision (State, StateSource, SourceState, bTerminal), and the
	 * Dog's activity, motion, animation and whether it asks for a human come from the existing mapping functions.
	 * Nothing is re-decided, and the fields an envelope cannot know stay at their zero members, which read as
	 * "Relay has not said".
	 */
	WONDERLAND_API FWonderlandJuliusEmbodiment EmbodimentFromEnvelope(const FWonderlandEnvelope& Envelope);

	/**
	 * What an answer from the bridge means for the link. 401 is an identity the bridge no longer accepts
	 * (SessionExpired: pair again); 403 and 404 are a refusal of THIS player for THIS run (Refused); anything else --
	 * no connection, a 5xx, a 503 because the bridge cannot reach durable state -- is a world that cannot currently
	 * see the run (Stale). None of them is a statement about the MISSION, and none is treated as one.
	 */
	WONDERLAND_API EWonderlandLinkState LinkStateForFailure(int32 HttpStatus, bool bConnected);

	/** Seconds before the next attempt after this many consecutive failures: 1, 2, 4, 8, 16, then 30 at most. */
	WONDERLAND_API float BackoffSeconds(int32 ConsecutiveFailures);

	/** `{ "data": X }` -> X, re-serialized, or false when the body is not that shape. */
	WONDERLAND_API bool UnwrapData(const FString& Body, FString& OutData);

	/**
	 * A mode=page body -> each delivery (re-serialized, ready for WonderlandDecodeDeliveryBytes) and the ledger
	 * position to read on from. False when the body is not a page; OutNextCursor is then untouched.
	 */
	WONDERLAND_API bool SplitPage(const FString& Body, TArray<FString>& OutDeliveries, int64& OutNextCursor);
}

UCLASS()
class WONDERLAND_API UWonderlandJuliusStreamSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Redeem a pairing code for this client's native session. */
	void Pair(const FString& Code);

	/** Follow exactly this run of this project. Switching runs clears what the world held. */
	void Follow(const FString& InProjectId, const FString& InRunId);

	/** Stop following. The world keeps what it last knew and says the link is stale. */
	void Stop();

	/** Replace where identity comes from -- the seam a device-code flow will use. */
	void SetTokenSource(const TSharedRef<IWonderlandJuliusTokenSource>& InSource) { TokenSource = InSource; }

	/** One line for the console: what this is doing and why. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString Describe() const;

	/*
	 * READ-ONLY FACTS FOR A PROOF. Each reads the WORLD's state, not this transport's intent: the adopted run comes
	 * from UWonderlandJuliusSubsystem's own cursor, so a proof that asked to follow run X checks that the world is
	 * showing run X rather than comparing the request with itself.
	 */

	/** The run the world ADOPTED -- empty until a hydration for it was accepted. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetAdoptedRunId() const;

	/** The run this transport was asked to follow. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetFollowedRunId() const { return RunId; }

	/** Julius's own run state as the world holds it, or empty when the world's state did not come from the run row. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetJuliusRunState() const;

	/** The Mission Contract state for that run, by the engine's table -- or empty when it is not known. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	FString GetMissionContractState() const;

	/** Whether this client currently holds a native session. The token itself is never exposed. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Julius")
	bool IsPaired() const { return TokenSource.IsValid() && !TokenSource->CurrentToken().IsEmpty(); }

private:
	enum class EPhase : uint8
	{
		Idle,
		Hydrating,
		Following
	};

	bool Tick(float DeltaSeconds);
	void Hydrate();
	void ReadPage();
	void Failed(int32 HttpStatus, bool bConnected, const TCHAR* During);
	void SetLink(EWonderlandLinkState State, const FString& Explanation);
	UWonderlandJuliusSubsystem* World() const;
	FString BridgeUrl() const;
	FString RunQuery(int64 Cursor) const;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> NewRequest(const FString& Verb, const FString& Url) const;

	EPhase Phase = EPhase::Idle;
	FString ProjectId;
	FString RunId;
	TSharedPtr<FWonderlandPairedTokenSource> Paired;
	TSharedPtr<IWonderlandJuliusTokenSource> TokenSource;
	int32 Failures = 0;
	double NextAttemptAt = 0.0;
	bool bInFlight = false;
	int64 PagesRead = 0;
	int64 EnvelopesOffered = 0;
	FTSTicker::FDelegateHandle Ticker;
	TArray<FHttpRequestPtr> InFlight;
};

/**
 * WONDERLAND RELAY LINK — the one seam between this world and Relay.
 *
 * Reconstructed from its call sites. WonderlandDogPawn has always reached for
 * it as a GameInstance subsystem, and DogPawn.h states the architecture
 * outright: "Register with the Relay link so it can push ApplyWorldState ...
 * the subsystem is the caller". Registration, unregistration and that push are
 * exactly what this provides, plus the intent request the interactable needs.
 *
 * THE DIRECTION OF AUTHORITY, which is the whole point of the class:
 *
 *   Relay -> Wonderland   world state, pushed to registered pawns. READ ONLY.
 *                         The pawn learns; it never decides.
 *   Wonderland -> Relay   intent REQUESTS. Never commands, never state, never
 *                         a claim that something happened.
 *
 * FAIL-CLOSED BY CONSTRUCTION. The Bridge endpoint is configuration, and there
 * is no default. With none supplied this link declines to send and says so —
 * it does not queue, retry silently, or return success. The pawn's own comment
 * already promises this behaviour to the reader ("Fail-closed: with no Link
 * config, nothing is sent") and this is where that promise is kept.
 *
 * That matters more than convenience: a link that pretended to post would make
 * Wonderland appear to drive Relay while changing nothing, which is precisely
 * the class of untruth the rest of this codebase is built to prevent.
 */
#pragma once

#include "CoreMinimal.h"
#include "RelayWorldState.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandRelayLink.generated.h"

class AWonderlandDogPawn;

UCLASS()
class UWonderlandRelayLink : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/**
	 * Let the link reach this pawn.
	 *
	 * Registration grants the link NO power over Relay — DogPawn.h is explicit
	 * that it "only lets Relay reach the pawn". Held weakly so a pawn destroyed
	 * between pushes is simply dropped rather than resurrected or crashed into.
	 */
	void RegisterDogPawn(AWonderlandDogPawn* Pawn);
	void UnregisterDogPawn(AWonderlandDogPawn* Pawn);

	/** How many live pawns the link can currently reach. */
	int32 RegisteredDogPawnCount() const;

	/**
	 * Push a world snapshot to every registered pawn.
	 *
	 * The last accepted world is retained so a pawn registering later gets the
	 * current picture rather than waiting for the next poll. A pawn that has
	 * never been told anything must show its dormant state, not a guess — which
	 * is why the retained world is only pushed when one has actually arrived.
	 */
	void PushWorldState(const FWonderlandWorld& World);

	/** True once a world has been accepted at least once. Unknown is not empty. */
	bool HasWorldState() const { return bWorldAccepted; }

	/**
	 * Raise an intent with Relay. Returns whether the request WAS SENT.
	 *
	 * Not whether Relay accepted it and not whether it will succeed. Those are
	 * Relay's to decide and arrive, if at all, through world state.
	 */
	bool RaiseIntent(const FString& IntentType, const FString& Locus, const FVector& FromLocation);

	/**
	 * Whether a Bridge endpoint is configured at all.
	 *
	 * Deliberately separate from "is it reachable". Not configured is a
	 * different fact from configured-and-failing, and collapsing them would
	 * hide a deployment mistake behind a network error.
	 */
	bool IsConfigured() const { return !BridgeBaseUrl.IsEmpty(); }

	/** The configured base URL, or empty. Never a placeholder. */
	const FString& GetBridgeBaseUrl() const { return BridgeBaseUrl; }

private:
	/** Resolve the endpoint from the command line, then the environment. */
	static FString ResolveBridgeBaseUrl();

	UPROPERTY()
	TArray<TWeakObjectPtr<AWonderlandDogPawn>> DogPawns;

	FWonderlandWorld LastWorld;
	bool bWorldAccepted = false;
	FString BridgeBaseUrl;
};

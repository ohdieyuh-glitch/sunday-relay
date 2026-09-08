// WONDERLAND USAGE SUBSYSTEM — WHERE THE HUD'S NUMBERS ACTUALLY LIVE.
//
// The founder directive is explicit that the widget must not own authoritative
// usage state, and this is the answer to that: one GameInstance subsystem holds
// the last reading Relay reported, and every widget that draws a meter reads it
// from here. A widget that owned its own figures would keep them across a
// reopen, diverge from a second widget showing the same mission, and have
// nowhere to put the fact that nobody has reported yet.
//
// THREE LAYERS, AND THIS IS THE MIDDLE ONE:
//
//   BACKEND / JULIUS   what was actually spent. Relay's `wonderland-usage-
//                      authority.ts` decides it, applies the staleness budget
//                      and projects the meters. Authoritative.
//   RUNTIME STATE      THIS FILE. What this client currently holds, which
//                      revision it holds, what it refused on the way, and
//                      whether its link is live.
//   PRESENTATION       the widget. Reads, draws, decides nothing.
//
// WHY THE ARITHMETIC IS NOT HERE. Every figure on the HUD — the spans, the
// fractions, the status, the staleness verdict — is computed once, in
// TypeScript, and pushed here already projected. A C++ re-derivation would be a
// second canonical implementation of the product's most load-bearing numbers,
// free to drift while both sides went on passing their own tests. What this
// subsystem decides is the one thing TypeScript cannot: which of several pushes
// arriving over a real network this client should be holding right now.
//
// WHAT IT REFUSES, and each refusal is counted rather than logged:
//
//   FOREIGN PROJECT    a reading for another world. The most serious refusal —
//                      one world showing another's spend is worse than showing
//                      nothing — so it is checked first and never overwrites.
//   MALFORMED          ours, and unreadable. A revision below 1 or an empty
//                      project id means the push never passed through Relay's
//                      own authority, whatever it claims.
//   STALE REVISION     ours, readable, superseded. Ordinary reconnect traffic.
//   DUPLICATE          the revision we already hold. The wire retried.
//
// UNKNOWN IS NOT ZERO, kept structurally. `HasUsage()` is false until a push is
// applied, and the held HUD is a default-constructed struct whose meters read
// Unavailable rather than 0/0. A world that has never been told anything must
// be able to say so, and a subsystem that started at zero could not.
//
// A DISCONNECTION IS NEVER A COMPLETION, and never a reset either. Losing the
// link does NOT clear the figures: they were true at their revision and still
// are — they have only stopped being current. That distinction lives in the
// link status, which the world owns, beside the authority status, which Relay
// owns. Nothing here ever edits what Relay said.
//
// NO TICK. NO POLLING. NO NETWORKING OF ITS OWN. This subsystem is pushed to
// and read from; it never asks. A HUD that fetched per frame would be the
// per-frame backend call the directive forbids, and a subsystem that owned a
// socket would be a second transport beside the one the world already has.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandTypes.h"
#include "WonderlandEnvelope.h"
#include "WonderlandUsageHud.h"
#include "WonderlandUsageSubsystem.generated.h"

/**
 * Fired after the held state CHANGES. Carries nothing on purpose.
 *
 * Two reasons. A payload would be a copy of two sizeable structs per push, for
 * every listener, when the state they describe is one accessor away. And a
 * payload can be held: a widget that cached the struct it was handed would be
 * back to owning authoritative state, which is the thing this file exists to
 * prevent. "Something moved, read me again" is the whole contract.
 *
 * NOT fired for a refused push. A rejected foreign-project reading changes the
 * counters and nothing a meter draws, and broadcasting it would make every HUD
 * in the world re-read on traffic that was never theirs.
 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FWonderlandUsageChanged);

/**
 * Decide what to do with an arriving usage push. FREE FUNCTION, DELIBERATELY.
 *
 * The rule is the interesting part and a `UGameInstanceSubsystem` cannot be
 * constructed outside a running engine, so a rule that lived only as a private
 * method would be a rule nothing in this repository could execute. As a free
 * function it compiles and runs in `wonderland/Tools/UsageHarness`, which is
 * why the ordering claims above are tested rather than asserted.
 *
 * The verdict vocabulary is the EVENT seam's, reused rather than reinvented:
 * one world should not answer "why was this ignored" in two languages.
 */
WONDERLAND_API EWonderlandOrderingVerdict WonderlandUsagePushVerdict(
	const FString& BoundProjectId,
	int64 HeldRevision,
	bool bHasUsage,
	const FString& PushProjectId,
	const FWonderlandUsageAuthorityStatus& PushAuthority);

UCLASS()
class WONDERLAND_API UWonderlandUsageSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/* ------------------------------------------------------------ binding */

	/**
	 * Bind this client to one project. Everything else is refused as foreign.
	 *
	 * Binding to a DIFFERENT project clears the held reading rather than
	 * carrying it across. A world that switched projects and kept the previous
	 * one's figures would show another mission's spend under this mission's
	 * name for as long as it took the first push to arrive, and "briefly wrong"
	 * is the failure mode a HUD can least afford. Re-binding to the same
	 * project is a no-op, so an idempotent bind on level load costs nothing.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Usage")
	void BindProject(const FString& ProjectId);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	bool IsBound() const { return !BoundProjectId.IsEmpty(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	const FString& GetBoundProjectId() const { return BoundProjectId; }

	/* -------------------------------------------------------------- pushes */

	/**
	 * Offer a reading Relay has already projected. Returns what happened to it.
	 *
	 * The caller is whatever owns the transport. This subsystem has no opinion
	 * about how the push arrived and no way to ask for another.
	 */
	EWonderlandOrderingVerdict ApplyUsage(
		const FString& ProjectId,
		const FWonderlandUsageHud& Hud,
		const FWonderlandUsageAuthorityStatus& Authority);

	/**
	 * Tell the subsystem what the world's own link is doing.
	 *
	 * Separate from `ApplyUsage` because it is a DIFFERENT FACT with a different
	 * owner: the authority status is Relay's report about the figures, and this
	 * is the client's report about its socket. Merging them would let a dropped
	 * connection quietly rewrite what an authority said, which is how a HUD
	 * ends up inventing a staleness nobody measured.
	 */
	void SetLinkStatus(const FWonderlandLinkStatus& Status);

	/* --------------------------------------------------------------- reads */

	/** False until a push has been APPLIED. Never-told is not empty. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	bool HasUsage() const { return bUsageApplied; }

	/**
	 * The held reading. Meaningful only when `HasUsage()`.
	 *
	 * Returned even when it is not, because the default-constructed HUD is
	 * itself honest — its meters read Unavailable — and a widget forced to
	 * branch before it could draw anything would grow a second, unchecked
	 * notion of what an empty HUD looks like.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	const FWonderlandUsageHud& GetUsage() const { return Usage; }

	/** How much to believe the figures, as REPORTED. Never edited here. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	const FWonderlandUsageAuthorityStatus& GetAuthority() const { return Authority; }

	/** What the world's own link is doing. The client's fact, not Relay's. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	const FWonderlandLinkStatus& GetLinkStatus() const { return LinkStatus; }

	/** Highest applied revision. 0 until one has been. Resume from exactly this. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	int64 GetAppliedRevision() const { return AppliedRevision; }

	/* ------------------------------------------------------------ counters */
	//
	// Counted separately for the reason the TypeScript authority counts them
	// separately: a mis-routed fan-out, a schema drift and ordinary replay
	// traffic are three different problems, and one "rejected" number would
	// present them as one.

	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	int64 GetForeignProjectPushesRejected() const { return ForeignProjectPushesRejected; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	int64 GetMalformedPushesRejected() const { return MalformedPushesRejected; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	int64 GetStaleRevisionPushesRejected() const { return StaleRevisionPushesRejected; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	int64 GetDuplicatePushesRejected() const { return DuplicatePushesRejected; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Usage")
	int64 GetAppliedPushes() const { return AppliedPushes; }

	/* ------------------------------------------------------- notification */

	/** Bind to redraw when the held state moves. Never fires for a refusal. */
	UPROPERTY(BlueprintAssignable, Category = "Wonderland|Usage")
	FWonderlandUsageChanged OnUsageChanged;

private:
	/** Drop everything held. Counters survive: they are this session's history. */
	void ClearHeldReading();

	FString BoundProjectId;

	FWonderlandUsageHud Usage;
	FWonderlandUsageAuthorityStatus Authority;
	FWonderlandLinkStatus LinkStatus;

	bool bUsageApplied = false;
	int64 AppliedRevision = 0;

	int64 AppliedPushes = 0;
	int64 ForeignProjectPushesRejected = 0;
	int64 MalformedPushesRejected = 0;
	int64 StaleRevisionPushesRejected = 0;
	int64 DuplicatePushesRejected = 0;
};

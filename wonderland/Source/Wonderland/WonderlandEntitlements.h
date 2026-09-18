// WONDERLAND — WHAT THIS ACCOUNT IS ENTITLED TO.
//
// FOUNDER DIRECTIVE (2026-09-17): "Do not hardcode 'six forever' deep into window spawning. Create a proper
// entitlement/capability value such as conceptually maxConcurrentWonderWebs. FREE: 6. Future tiers may raise it. The
// window manager reads the entitlement."
//
// So this is the one place a limit lives, and the window manager asks rather than knowing. A future tier raises a number
// here; nothing in the spawning code changes.
//
// IT SAYS WHERE IT CAME FROM. Until an account service reports this user's tier, the source is BUILT_IN and the tier is
// FREE -- said plainly, not dressed up as an account lookup that never happened. When Julius's account authority exists,
// it reports here and the source becomes ACCOUNT; every surface that shows a limit shows which of those it is reading.
//
// NOT A PAYWALL, AND NOT A PRICE LIST. No tier above free is implemented, because none is required yet. What exists is
// the seam that makes adding one a change of data rather than a change of design.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandEntitlements.generated.h"

/** Where an entitlement figure came from. A number with no provenance is a number nobody can check. */
enum class EWonderlandEntitlementSource : uint8
{
	/** This build's own free-tier defaults. Honest, and what a beta user gets. */
	BuiltIn,
	/** Reported by an account authority. Nothing does this yet. */
	Account,
	/** Raised or lowered by hand for a proof or a playtest. Always visible as such. */
	Development,
};

/** What this account may do. One struct, read by whoever needs a limit. */
struct FWonderlandEntitlements
{
	/** How many Wonder Web windows may be open at once. The free tier's figure, and the founder's number. */
	int32 MaxConcurrentWonderWebs = 6;
	/** The tier's id and the words a surface shows: "free" / "FREE TIER". */
	FString TierId = TEXT("free");
	FString TierLabel = TEXT("FREE");
	EWonderlandEntitlementSource Source = EWonderlandEntitlementSource::BuiltIn;
};

DECLARE_MULTICAST_DELEGATE(FOnWonderlandEntitlementsChanged);

/**
 * The entitlement holder. A GameInstance subsystem because an account is a property of the session, not of a level or a
 * player's viewport.
 */
UCLASS()
class WONDERLAND_API UWonderlandEntitlementSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	const FWonderlandEntitlements& Get() const { return Entitlements; }

	/** How many Wonder Web windows this account may have open at once. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Entitlements")
	int32 GetMaxConcurrentWonderWebs() const { return FMath::Max(Entitlements.MaxConcurrentWonderWebs, 1); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Entitlements")
	FString GetTierLabel() const { return Entitlements.TierLabel; }

	/** Where the figures came from, for a surface that shows a limit and for a proof that reads one. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Entitlements")
	FString GetSourceLabel() const;

	/** The entitlements as one line, for a proof job. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Entitlements")
	FString DescribeEntitlements() const;

	/**
	 * RAISED OR LOWERED FOR A PROOF. Marks the source as DEVELOPMENT, so no surface can show a changed limit as though an
	 * account had granted it. Refused outside a development build.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Entitlements")
	bool SetMaxConcurrentWonderWebsForDevelopment(int32 Max);

	/**
	 * WHAT AN ACCOUNT AUTHORITY WOULD CALL. Nothing calls it yet, and until something does the source stays BUILT_IN --
	 * this exists so that wiring an authority is a call rather than a redesign.
	 */
	void ApplyFromAccount(const FWonderlandEntitlements& Reported);

	FOnWonderlandEntitlementsChanged OnChanged;

private:
	FWonderlandEntitlements Entitlements;
};

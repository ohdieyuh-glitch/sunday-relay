// WONDERLAND — the hub / starter zone, as an authoring description.
//
// WHAT THIS IS: a data description of the hub level's zones — what each one is
// for, roughly where it sits, and which Relay surface (if any) it presents. It is
// the thing a level designer and an automated layout pass both read, so the zone
// list is not buried in a .umap nobody can diff.
//
// WHAT THIS IS NOT: a level. There is no .umap in this repository and no engine
// here to open one with. The geometry, lighting, materials and foliage are
// Unreal-editor work and are recorded as deferred in docs/relay/WONDERLAND.md
// rather than implied by this file.
//
// AESTHETIC DIRECTION. An original whimsical surreal fantasy world: lush paths
// and forests, a whimsical city, oversized mushrooms, strange clocks, ornate
// gates, impossible architecture, roses, teacups, glossy materials, bright
// cinematic light, strong depth and atmosphere. The influence is on ATMOSPHERE
// and WORLD LOGIC only — no protected character, name, likeness or design from
// any existing work is reproduced, and none of the zone names below is taken from
// one.
//
// Zones carry NO PRODUCT MEANING. A player standing in a zone changes no Relay
// state; walking somewhere is where the Dog happens to be standing, exactly as
// idle patrol is on the 2D Stage. Zones that PRESENT Relay state say which
// section they read, and they read the projection — never a local guess.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandHubLevel.generated.h"

// Authoring vocabulary for the hub. Purely presentational, deliberately not part
// of the Relay contract, and recorded as C++-only by the parity test.
UENUM(BlueprintType)
enum class EWonderlandHubZoneKind : uint8
{
	/** Where the player and their Dog arrive. Quiet, legible, no Relay surface. */
	Arrival,
	/** The Dog's own ground: patrol space and the live terminal beneath it. */
	AgentGrounds,
	/** Project entities stand here, in the form their category chose. */
	ProjectField,
	/** The Brain's weather is visible from here: sky, light, atmosphere. */
	Observatory,
	/** Where a GVE begins. The runaway Dog breaks from this gate. */
	ChaseGate,
	/** Class standings and verified badges are displayed. Read-only. */
	Atrium,
	/** Traversal only: paths, forests, bridges, stairs that go the wrong way up. */
	Passage
};

// One zone of the hub.
USTRUCT(BlueprintType)
struct FWonderlandHubZone
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FName ZoneId;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	EWonderlandHubZoneKind Kind = EWonderlandHubZoneKind::Passage;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FText DisplayName;

	/** What a player sees and does here. Written for a designer, not a renderer. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FText Intent;

	/** Approximate centre, in world units, for the layout pass. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FVector Centre = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	float RadiusUu = 0.0f;

	/**
	 * The FWonderlandWorld section this zone presents, or NAME_None for a zone
	 * that presents nothing. A zone naming a section must read that section from
	 * the applied snapshot; it may not compute a substitute when the section is
	 * absent, and an absent section shows its own unavailable reason.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FName PresentsWorldSection;

	/** True when this zone is walkable in the current build. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	bool bWalkable = true;
};

/**
 * The hub description asset.
 *
 * A DataAsset rather than hardcoded constants so the zone list is editable in
 * the editor and diffable in the repository at the same time.
 */
UCLASS(BlueprintType)
class UWonderlandHubDescription : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FText HubName;

	/** One paragraph of art direction. Atmosphere only — never a character. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FText ArtDirection;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	TArray<FWonderlandHubZone> Zones;

	/**
	 * Where the player's Dog spawns. A named zone id rather than a transform, so
	 * moving the arrival zone moves the spawn with it.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Hub")
	FName ArrivalZoneId;
};

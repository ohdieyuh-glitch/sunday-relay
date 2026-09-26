// WONDERLAND — WHERE AM I, WHAT IS THIS PLACE FOR, AND HOW DO I GET TO THE OTHER ONES.
//
// FOUNDER, 2026-09-25: "TERRITORY DISCOVERY + CHECKPOINT SYSTEM ... Each major territory / nation / region in
// Wonderland should have a visible checkpoint marker ... Clicking/selecting a checkpoint should open a clean
// info panel: TERRITORY NAME, SPECIALIZATION, PURPOSE, IMPORTANT LOCATIONS, AVAILABLE ACTIVITIES,
// DISCOVERED/UNDISCOVERED STATE ... Wonderland currently does not communicate WHERE the player is, WHAT each
// region is for, or WHERE the other regions are ... Integrate this into the existing navigation/UI rather than
// creating a second competing system."
//
// AND THE RULE THAT SHAPES ALL OF IT: "DO NOT INVENT THE TERRITORY SPECIALIZATIONS ... If a territory
// genuinely has no canonical specialization yet, mark it as NEEDS FOUNDER DEFINITION rather than silently
// inventing permanent lore."
//
// THE REGISTRY IS NOT WRITTEN HERE. It is generated into Config/DefaultGame.ini by
// wonderland/Tools/territory_registry.py, which reads WorldDesign/CANON/nations.json and NATIONS.md and copies
// their words across. Every row carries the CanonSource it came from, so anything that appears in the game can
// be traced back to the line of canon that says it. DUBEL FOREST comes through with an EMPTY specialisation
// and bSpecialisationIsCanon false, because the canon gives it an existence and an exception rule and states
// no discipline at all -- and the panel says so in those words rather than filling the gap.
//
// ONE SOURCE, READ BY EVERYTHING. The founder asked for "a canonical territory definition ... used by the
// checkpoint UI, world orientation and future map/nav features". This is it: the markers in the world, the
// panel, the discovery banner and the map all read UWonderlandTerritorySettings and none of them keeps a
// second copy.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "GameFramework/Actor.h"
#include "Subsystems/WorldSubsystem.h"
#include "WonderlandTerritory.generated.h"

class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class UPointLightComponent;

/**
 * ONE TERRITORY, AS THE CANON STATES IT.
 *
 * Everything here except the checkpoint's position and accent is COPIED from WorldDesign/CANON. The position
 * is geometry -- the canon calls its own bearings "a placement frame and may be moved as data" -- and the
 * accent is each nation's canon colour word turned into a colour.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandTerritory
{
	GENERATED_BODY()

	/** Stable id: golden_arrival, icarus, noctis, tartarus, dubel. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FName Id;

	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FString DisplayName;

	/**
	 * THE CANON'S OWN WORD FOR WHAT THIS TERRITORY IS FOR, or EMPTY.
	 *
	 * Empty is not a mistake and must never be filled in by code: it means the canon does not say, and the
	 * panel is required to show NEEDS FOUNDER DEFINITION instead of a guess.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FString Specialisation;

	/** False when the canon states no specialisation for this territory. See Specialisation. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	bool bSpecialisationIsCanon = false;

	/** The canon's sentence about what the work here is. Empty where the canon is silent. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FString Purpose;

	/** How the canon describes the place's feel. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FString Description;

	/** Named places. Only names that exist somewhere in the project; never invented here. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	TArray<FString> Landmarks;

	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	TArray<FString> Activities;

	/** Where the checkpoint stands, world X/Y in uu. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FVector2D CheckpointXY = FVector2D::ZeroVector;

	/** Which way a visitor arriving at the checkpoint should face. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	float CheckpointYawDeg = 0.0f;

	/** The territory's colour, from the canon's colour identity. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FLinearColor Accent = FLinearColor::White;

	/** How near the checkpoint counts as being in this territory, and as discovering it. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	float DiscoverRadiusUU = 15000.0f;

	/** The file and field this row was copied from, so any claim in the game can be checked. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territory")
	FString CanonSource;

	bool IsValid() const { return !Id.IsNone() && !DisplayName.IsEmpty(); }
};

UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Territories"))
class WONDERLAND_API UWonderlandTerritorySettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	/** Generated by Tools/territory_registry.py from WorldDesign/CANON. Do not hand-edit. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Territories")
	TArray<FWonderlandTerritory> Territories;

	static const UWonderlandTerritorySettings& Get()
	{
		const UWonderlandTerritorySettings* Settings = GetDefault<UWonderlandTerritorySettings>();
		check(Settings != nullptr);
		return *Settings;
	}
};

/**
 * THE MARKER THAT STANDS IN THE WORLD.
 *
 * FOUNDER: "clearly identifies which territory the player is entering ... recognizable both in-world and from
 * the navigation UI ... not clutter ... consistent with Wonderland's visual language ... readable in morning,
 * afternoon, evening and night lighting. Do NOT use generic floating map pins."
 *
 * So it is built from the same vocabulary the rest of Wonderland is: a stone plinth, an ivory pylon and a ring
 * of the territory's own colour, all instanced cubes on the engine cube, no new asset and no new material
 * master. The ring and the core are UNLIT and emissive, which is the whole answer to "readable at every hour"
 * -- they render the same colour at noon and at midnight, and the light they carry lets the plinth read too.
 *
 * It is a piece of architecture, not a pin: it stands ON the ground, at the scale of a gatepost.
 */
UCLASS(NotBlueprintable)
class WONDERLAND_API AWonderlandTerritoryCheckpoint : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandTerritoryCheckpoint();

	virtual void Tick(float DeltaSeconds) override;

	/** Build this marker for a territory. Safe to call again; it rebuilds. */
	void Stand(const FWonderlandTerritory& Territory, bool bDiscovered);

	/** Say whether the territory has been found, which is the only thing that changes how it looks. */
	void SetDiscovered(bool bDiscovered);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	FName GetTerritoryId() const { return TerritoryId; }

	/** How tall the marker is, uu, so a proof can say it is a gatepost and not a pin. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	float GetHeightUU() const { return HeightUU; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	bool IsDiscovered() const { return bFound; }

private:
	UPROPERTY(Transient)
	TObjectPtr<USceneComponent> Root = nullptr;

	/** One component per material: stone, ivory, and the glowing ring. Three draw calls for a whole marker. */
	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> Stone = nullptr;

	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> Ivory = nullptr;

	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> Glow = nullptr;

	UPROPERTY(Transient)
	TObjectPtr<UPointLightComponent> Lamp = nullptr;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> GlowMid = nullptr;

	FName TerritoryId;
	FLinearColor Accent = FLinearColor::White;
	bool bFound = false;
	float HeightUU = 0.0f;
	float Age = 0.0f;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FWonderlandTerritoryFound, FName /*TerritoryId*/);
DECLARE_MULTICAST_DELEGATE_OneParam(FWonderlandTerritoryEntered, FName /*TerritoryId*/);

/**
 * WHO KNOWS WHERE THE PLAYER IS.
 *
 * Stands the markers, answers "which territory am I in", remembers which have been found, and tells whoever
 * is listening the first time each one is entered. It keeps no lore of its own: every word it hands out comes
 * from UWonderlandTerritorySettings.
 *
 * DISCOVERY IS REMEMBERED ACROSS SESSIONS, in a small text file beside the skin the Dog is wearing, for the
 * same reason that is: a discovery the founder loses on exit is not a discovery.
 */
UCLASS()
class WONDERLAND_API UWonderlandTerritorySubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;
	virtual void Tick(float DeltaSeconds) override;
	virtual TStatId GetStatId() const override;

	/** Every territory the canon declares, in registry order. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	const TArray<FWonderlandTerritory>& GetTerritories() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	bool FindTerritory(FName Id, FWonderlandTerritory& Out) const;

	/** Which territory the player is standing in, or None between them. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	FName GetCurrentTerritory() const { return Current; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	bool IsDiscovered(FName Id) const { return Discovered.Contains(Id); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	int32 GetDiscoveredCount() const { return Discovered.Num(); }

	/** Mark one found, as walking into it does. True when this was the first time. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Territory")
	bool Discover(FName Id);

	/** Forget every discovery. For proofs and for a founder who wants to see the first-entry treatment again. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Territory")
	void ForgetDiscoveries();

	/**
	 * WHICH WAY IS IT, AND HOW FAR -- the founder's "Where is ICARUS?" and "How do I get there?", answered as
	 * a compass bearing from where the player is standing and a distance in metres. Empty for an id the
	 * registry does not hold.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	FString DescribeWayTo(FName Id) const;

	/** Bearing from the player to a territory's checkpoint, degrees clockwise from north. -1 when unknown. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	float BearingTo(FName Id) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	float DistanceToMetres(FName Id) const;

	/** How many markers are actually standing in the world. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	int32 GetStandingCheckpointCount() const;

	/** The id whose first-entry banner should be showing, and how long it has left. None when nothing is. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	FName GetAnnouncing() const { return Announcing; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Territory")
	float GetAnnouncingSecondsLeft() const { return AnnounceLeft; }

	FWonderlandTerritoryFound OnTerritoryFound;
	FWonderlandTerritoryEntered OnTerritoryEntered;

private:
	void StandTheCheckpoints();
	void LoadDiscoveries();
	void SaveDiscoveries() const;
	static FString DiscoveryPath();
	/** The ground under a checkpoint, traced, so a marker never floats or buries itself. */
	float GroundAt(const FVector2D& XY, float& OutFound) const;

	UPROPERTY(Transient)
	TArray<TObjectPtr<AWonderlandTerritoryCheckpoint>> Checkpoints;

	TSet<FName> Discovered;
	FName Current;
	FName Announcing;
	float AnnounceLeft = 0.0f;
	float SinceCheck = 0.0f;
	bool bStood = false;
};

// WONDERLAND — travel: the developed-place registry, its anchors, and the one teleport.
//
// THREE PIECES, EACH WITH ONE JOB.
//
//   UWonderlandTravelSettings   WHICH places exist and whether they are ready to
//                               visit. Config-backed (DefaultGame.ini), so adding a
//                               newly developed district is a data edit, not a code
//                               change, and the list diffs in review.
//   AWonderlandTravelAnchor     WHERE a visitor stands. A placed actor in the map,
//                               never a coordinate typed into a menu. The registry's
//                               seed position only decides where an anchor is first
//                               put and audited; teleporting goes to the anchor.
//   UWonderlandTravelSubsystem  HOW the move happens: fade to black, make sure the
//                               destination exists (World Partition streaming when the
//                               world has it), sweep onto real ground, move the pawn
//                               ONCE, fade back in. A travel that cannot land safely is
//                               abandoned and the visitor is returned, never left in a
//                               half-loaded or intersecting place.
//
// THE CANONICAL NAMES ARE NOT INVENTED HERE. They come from the Lightning-era
// destination table (wonderland/v2/tools/destinations.py, generated from
// layout_v2._DISTRICT_SEEDS and proven walkable from the real PlayerStart), which
// never reached git. What is new is the gate in front of them: a place is only
// offered once a density audit of the real recovered map says it is developed.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "GameFramework/Actor.h"
#include "Subsystems/WorldSubsystem.h"
#include "WorldPartition/WorldPartitionStreamingSource.h"
#include "WonderlandTravel.generated.h"

class UArrowComponent;
class UCapsuleComponent;
class APawn;
class APlayerController;

/** Whether a place may be offered. Ordinal 0 is the truthful default: unassessed. */
UENUM(BlueprintType)
enum class EWonderlandTravelStatus : uint8
{
	/** Nobody has audited it. Never offered. */
	Unassessed,
	/** Audited: authored content around it, safe ground, worth a visit. Offered. */
	Developed,
	/** Audited: safe and visitable, lighter development. Offered. */
	Available,
	/** Exists, not ready to show a visitor. Not offered. */
	InDevelopment,
	/** A future place. Not offered. */
	Locked
};

/** What kind of place. Mirrors the Lightning table's kinds. */
UENUM(BlueprintType)
enum class EWonderlandTravelKind : uint8
{
	Arrival,
	District,
	Quarter,
	Landmark
};

/** One place in the registry. */
USTRUCT(BlueprintType)
struct FWonderlandTravelDestination
{
	GENERATED_BODY()

	/** Stable id. Anchors and the map address a place by this and nothing else. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FName Id;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FText Description;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	EWonderlandTravelKind Kind = EWonderlandTravelKind::District;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	EWonderlandTravelStatus Status = EWonderlandTravelStatus::Unassessed;

	/** Grouping label for the map. A temporary development label is marked in the note. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FString District;

	/** The generated seed (world X/Y, uu). Used to place and audit the anchor, and to lay out the map. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FVector2D SeedXY = FVector2D::ZeroVector;

	/** Facing on arrival, degrees yaw, toward the thing worth looking at. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	double ArrivalYawDeg = 0.0;

	/** The map this place belongs to. Empty means any map. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FString MapPackage;

	/** Map glyph: arrival, district, quarter or landmark. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FName IconName;

	/** Optional preview texture shown when the place is selected. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FSoftObjectPath Thumbnail;

	/** Data layers that must be active for this place. Empty for classic maps. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	TArray<FName> RequiredDataLayers;

	/** Why the status is what it is: the audit's numbers, or a development label. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FString DevelopmentNote;
};

/** The registry. Project Settings > Game > Wonderland Travel, stored in DefaultGame.ini. */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Travel"))
class WONDERLAND_API UWonderlandTravelSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UPROPERTY(Config, EditAnywhere, Category = "Destinations")
	TArray<FWonderlandTravelDestination> Destinations;

	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "0.05"))
	float FadeOutSeconds = 0.35f;

	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "0.05"))
	float FadeInSeconds = 0.45f;

	/** Longest the screen may stay black waiting for the destination before the travel is abandoned. */
	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "1.0"))
	float MaxBlackSeconds = 10.0f;

	/** Consecutive frames the ground trace must succeed before fading back in. */
	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "1"))
	int32 GroundFramesRequired = 3;

	virtual FName GetCategoryName() const override { return TEXT("Game"); }

	const FWonderlandTravelDestination* FindDestination(FName Id) const;
};

/** Where a visitor stands when they arrive. Placed by the travel audit, never at runtime. */
UCLASS(meta = (DisplayName = "Wonderland Travel Anchor"))
class WONDERLAND_API AWonderlandTravelAnchor : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandTravelAnchor();

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FName DestinationId;

private:
	/** Editor-only visual of the player capsule: collision off, hidden in game. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Travel")
	TObjectPtr<UCapsuleComponent> CapsulePreview;

	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Travel")
	TObjectPtr<UArrowComponent> Facing;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FWonderlandTravelFinished, FName, DestinationId, bool, bArrived);

/** Runs one travel at a time for the local player. */
UCLASS()
class WONDERLAND_API UWonderlandTravelSubsystem : public UTickableWorldSubsystem, public IWorldPartitionStreamingSourceProvider
{
	GENERATED_BODY()

public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Deinitialize() override;

	// FTickableGameObject, through UTickableWorldSubsystem (Conditional once initialized):
	// ticks only while travelling.
	virtual void Tick(float DeltaTime) override;
	virtual bool IsTickable() const override;
	virtual TStatId GetStatId() const override;

	// IWorldPartitionStreamingSourceProvider: a source at the destination while loading.
	virtual bool GetStreamingSource(FWorldPartitionStreamingSource& OutSource) const override;
	virtual const UObject* GetStreamingSourceOwner() const override { return this; }

	/** Places the map may offer on THIS map: Developed or Available, with an anchor present. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Travel")
	TArray<FWonderlandTravelDestination> GetOfferedDestinations() const;

	/** Begin a travel. False (with a sentence) when it cannot start; nothing moves then. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Travel")
	bool RequestTravel(FName DestinationId, FText& OutRefusal);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Travel")
	bool IsTravelling() const { return Phase != EPhase::Idle; }

	/** The offered place nearest the local pawn within MaxDistanceUU, or None. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Travel")
	FName GetNearestOfferedDestination(double MaxDistanceUU) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Travel")
	FName GetLastArrivedDestination() const { return LastArrived; }

	/** The last travel's outcome in a sentence, for the map and for tests. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Travel")
	FString GetLastTravelReport() const { return LastReport; }

	/**
	 * The landing rule a teleport uses, asked of one spot: where the local pawn's capsule
	 * could stand if it arrived at Location (a point on the ground). The same sweep and
	 * the same rejections as a real travel, so an anchor placed by this answer is an
	 * anchor the teleport will accept. False when nothing near it is standable.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Travel")
	bool ProbeArrival(FVector Location, FVector& OutStandLocation) const;

	/** Whether this world streams through World Partition (so a travel waits for streaming). */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Travel")
	bool UsesWorldPartition() const;

	UPROPERTY(BlueprintAssignable, Category = "Wonderland|Travel")
	FWonderlandTravelFinished OnTravelFinished;

	AWonderlandTravelAnchor* FindAnchor(FName DestinationId) const;

private:
	enum class EPhase : uint8 { Idle, FadingOut, Loading, FadingIn };

	APlayerController* LocalController() const;
	bool FindSafeSpot(APawn* Pawn, const FTransform& Anchor, FVector& OutLocation) const;
	bool GroundUnder(APawn* Pawn) const;
	void BeginFadeIn(bool bArrived, const FString& Report);
	void SetStreamingRegistered(bool bRegister);
	void RestoreInput();

	EPhase Phase = EPhase::Idle;
	FName TravelId;
	FName LastArrived;
	FString LastReport;
	FTransform AnchorTransform;
	FTransform OriginTransform;
	float PhaseSeconds = 0.0f;
	int32 GroundFrames = 0;
	bool bPlaced = false;
	bool bArrivedResult = false;
	bool bStreamingRegistered = false;
	bool bInputIgnored = false;
	TWeakObjectPtr<APlayerController> Controller;
};

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

	/**
	 * WHERE A VISITOR STANDS, AS DATA: a point on the ground (world uu), faced along ArrivalYawDeg.
	 *
	 * FOUNDER, 2026-09-29: "I cannot teleport to the new places Claude Code created. This needs to be fixed as a
	 * SYSTEM problem." An anchor is a PLACED ACTOR, and World Partition streams placed actors: past roughly the
	 * 512 m streaming radius it is not in the world to be found, so a place built out there could never be offered
	 * or reached -- and from out there, the core's own places vanished from the map in the same way. A row that
	 * carries its arrival point needs no actor at all: it is offered and travelled to from anywhere, streaming is
	 * waited on at that point, and the same capsule sweep lands the visitor on real ground. When set it wins over
	 * any anchor with the same id, so a place relocated with intent cannot be pulled back to where it used to be.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	FVector ArrivalLocation = FVector::ZeroVector;

	/** True when ArrivalLocation is the arrival point (see above). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Travel")
	bool bHasArrivalLocation = false;

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

	/**
	 * Longest the screen may stay black waiting for the destination before the travel is abandoned.
	 *
	 * 10 S WAS SHORTER THAN THE WORLD. Measured 2026-09-29 (zg_06): every destination more than a few hundred metres
	 * from the Dog -- the Dubel Forest, the far heartlands, the nation quarters -- timed out still streaming and put the
	 * visitor back where they started, so "teleport doesn't work to the new places" was true of every far one.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "1.0"))
	float MaxBlackSeconds = 25.0f;

	/**
	 * 25 S WAS STILL SHORTER THAN THE CENTRE, SEEN FROM THE RIM. Founder, 2026-09-30 (editor log 16:04:57 UTC): a
	 * Mission Contract deployed at Tartarus Heartland East travelled to castle_approach, World Partition went Critical at
	 * +10 s and was still bringing the castle's cells in when the 25 s ran out, and the travel gave up -- "Could not land
	 * safely at castle_approach". zg_22 never made that trip (it reached castle_approach from 75 m away).
	 *
	 * So MaxBlackSeconds is now the limit for a travel that has STOPPED making progress: while the world is still
	 * streaming cells in (StallSeconds), it keeps waiting, up to this hard cap. A spot that is fully streamed and still
	 * not standable is abandoned at MaxBlackSeconds exactly as before.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "1.0"))
	float MaxTravelSeconds = 60.0f;

	/** How long streaming may show no pending cell and no newly loaded cell before a slow travel counts as stalled. */
	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "0.5"))
	float StallSeconds = 5.0f;

	/**
	 * ONCE THE DESTINATION HAS STREAMED, the landing still needs a spot and GroundFramesRequired frames of ground. A stream
	 * that finished after MaxBlackSeconds was abandoned on the very next tick -- placed, then put back before its ground
	 * frames could count (zh_12, 2026-09-30: "abandoned after 4.7 s: no ground under the landing | streamed at 4.3 s").
	 * A late stream now gets this long to land before a failed landing is called one.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Transition", meta = (ClampMin = "0.5"))
	float LandingGraceSeconds = 3.0f;

	/**
	 * How far round the destination must be streamed IN before the visitor is placed, uu. The travel waited for the
	 * whole 512 m grid loading range round a place nobody was near, when landing needs only the ground and what stands
	 * on it; the rest streams in round the Dog after the fade exactly as it always does -- the world's own streaming
	 * range is untouched. 0 or less restores the full grid range for the wait.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Transition")
	float ArrivalStreamRadiusUU = 15000.0f;

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

	/** Places the map may offer on THIS map: Developed or Available, with an arrival point (registry or anchor). */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Travel")
	TArray<FWonderlandTravelDestination> GetOfferedDestinations() const;

	/**
	 * THE ONE ANSWER TO "WHERE DOES THIS PLACE PUT A VISITOR": the row's own arrival point when it carries one,
	 * otherwise its anchor if that is loaded. The map, the mini-map, the nearest-place test and the teleport all
	 * ask this, so they can never disagree. False when the place has neither.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Travel")
	bool ResolveArrival(FName DestinationId, FTransform& OutArrival) const;

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
	 * WHY THE LAST TRAVEL ENDED AS IT DID, for proofs and the log: seconds taken, when streaming finished, how many
	 * cells were still pending, and -- on a failure -- which condition refused (still streaming, no standable spot, the
	 * move refused, no ground). "Could not land safely" alone could not tell a slow stream from a blocked arrival.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Travel")
	FString GetLastTravelDiagnostics() const { return LastDiagnostics; }

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
	/** World Partition cells (streaming levels) loaded, and those still changing state. */
	void CountCells(int32& OutLoaded, int32& OutPending) const;
	/** The line over the black screen: where the visitor is going, and -- on a long wait -- that it is still loading. */
	void ShowCaption(const FText& Destination);
	void HideCaption();

	EPhase Phase = EPhase::Idle;
	float TravelSeconds = 0.0f;
	float StreamedAtSeconds = -1.0f;
	float LastProgressSeconds = 0.0f;
	int32 LastLoadedCells = -1;
	int32 LastPendingCells = 0;
	int32 SafeSpotMisses = 0;
	int32 MoveRefusals = 0;
	FString LastDiagnostics;
	TSharedPtr<class SWidget> CaptionLayer;
	TSharedPtr<class STextBlock> CaptionDetail;
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

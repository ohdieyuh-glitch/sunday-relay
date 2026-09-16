// WONDERLAND — THE MISSION CONTRACT ORB. What the Relay Dog is carrying, set down on the ground.
//
// THE FOUNDER'S SHAPE, 2026-09-15: SMALL, and GROUND-POSITIONED — not floating on the Carry-On. So this is
// a thing at the Dog's feet that the Dog walks with, the way a lamp travels with the person holding it,
// and the mission it represents is read off the ground rather than off the Dog's back.
//
// WHAT IT IS MADE OF, and why it reads at a glance:
//
//   A DAIS on the floor, turning. The turn is the mission moving: forward while work advances, BACKWARDS
//   through a repair, and stopped dead on a block. Nobody has to be told that; it is how things move.
//
//   A SPINE OF SEVEN rising from it, one per chakra, in the metaphor's own arrangement: root at the base,
//   crown at the top. Steps the task has reached burn in their own colour; steps ahead sit dark on a matte
//   collar that is always there, so the set stays COUNTABLE — "four of seven" — rather than a colour a
//   viewer has to remember the order of. Seven around the ring was tried first and rejected offline: from
//   any one camera only four of them face you, which is no way to count.
//
//   A CORE above it, in the colour of the step the task has reached, bobbing and pulsing. Its pulse is the
//   tempo of the work: fast and shallow while coding, slow and deep while waiting on a person.
//
// IT RESETS PER TASK. MissionStart advances the colour to Root, which drops whatever the last task climbed
// to. A progression that carried over between tasks would be a progress bar for the session, and the
// founder asked for one per task.
//
// NO COLLISION, NO NAVIGATION, NO INPUT — the same rules the companions keep. It cannot block the Dog, a
// camera trace, or a travel landing.
//
// IT DECIDES NOTHING. The beat arrives from outside; this actor only draws it. Nothing here can advance a
// mission, and a beat it has never been given is drawn as unobserved rather than as idle.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandMissionBeat.h"
#include "WonderlandMissionOrb.generated.h"

class APlayerController;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;

UCLASS(NotBlueprintable)
class WONDERLAND_API AWonderlandMissionOrb : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandMissionOrb();

	virtual void Tick(float DeltaSeconds) override;
	virtual void BeginPlay() override;

	/** Follow whatever pawn this controller is wearing, now and after it changes. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void SetFollowController(APlayerController* Controller);

	/** Jump to the follow position immediately instead of gliding there. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void SnapToTarget();

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	APawn* GetFollowPawn() const;

	/** Show a beat. The chakra folds: a beat that holds keeps the step the task already reached. */
	void SetBeat(EWonderlandMissionBeat Beat);

	/** Put the progression back to nothing, as a new task does. */
	void ResetProgression();

	EWonderlandMissionBeat GetBeat() const { return Beat; }
	EWonderlandChakra GetChakra() const { return Chakra; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetBeatId() const { return WonderlandBeatId(Beat); }

	/** 0 when no task has started, else 1..7. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetChakraStep() const { return WonderlandChakraStep(Chakra); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetBoxCount() const { return BoxCount; }

	/** Where the dais sits, in the pawn's yaw frame: X forward, Y right, uu. Z is ignored -- it meets the floor. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	FVector FollowOffset = FVector(62.0, -30.0, 0.0);

	/** Radius of the turning dais on the floor, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float DaisRadiusUU = 24.0f;

	/** Height of the root step above the floor, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float SpineBaseUU = 5.0f;

	/** Rise from one step to the next, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float SpinePitchUU = 3.8f;

	/** Width of a step, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float SpineWidthUU = 7.4f;

	/** Height of the core's centre above the floor, uu. Clear of the spine, so it reads as floating. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float CoreHeightUU = 42.0f;

	/** Radius of the core, uu. Small: this is a held thing, not a monument -- the whole orb stands 50 uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float CoreRadiusUU = 8.0f;

	/** Time constant of the follow, seconds. Slower than a companion: a thing on the ground has weight. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float FollowLagSeconds = 0.45f;

	/** Farther than this from the follow position and it snaps rather than glides: a teleport. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float SnapDistanceUU = 1800.0f;

	/**
	 * What an unlit colour is multiplied by to read against a physically-based Wonderland afternoon.
	 * Measured 2026-09-15: below about x3000 an emissive box reads as black in daylight.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float GlowExposure = 4000.0f;

	/**
	 * How dim a step the task has not reached sits, as a fraction of a lit one.
	 *
	 * THE RESPONSE IS STEEP, not linear: the Phase 1 probe found x1, x30 and x300 all read as black in
	 * daylight and x3000 as readable, so this lands deliberately between -- dim but present. If it reads
	 * as black anyway the matte collar behind it still carries the count, which is why the collar exists.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float UnreachedPipFraction = 0.30f;

	/** Seconds to ease from one beat's motion to the next. A beat that asks for a person CUTS instead. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float BeatBlendSeconds = 0.35f;

private:
	void Build();
	FVector DesiredLocation(const APawn* Pawn) const;
	void Animate(float TimeSeconds, float DeltaSeconds);
	void PaintChakra();
	/** OutMid is a TObjectPtr& because every caller hands it a TObjectPtr member, which will not bind to a raw one. */
	UInstancedStaticMeshComponent* MakeMesh(FName Name, USceneComponent* Parent, bool bGlow, const TArray<FTransform>& Instances, TObjectPtr<UMaterialInstanceDynamic>& OutMid);

	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Mission")
	TObjectPtr<USceneComponent> Root;

	/** Turns. The dais and the seven pips hang from this. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Mission")
	TObjectPtr<USceneComponent> DaisRoot;

	/** Bobs and jitters. The core and its band hang from this. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Mission")
	TObjectPtr<USceneComponent> CoreRoot;

	/** Turns the other way, so the band reads as held rather than carried. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Mission")
	TObjectPtr<USceneComponent> BandRoot;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Meshes;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> DaisMid;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> CoreMid;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> BandMid;

	/** The matte collars behind the seven. One colour, never repainted: they are the countable set. */
	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> SpineMid;

	/** One per chakra, in order. Each keeps its own colour for the life of the orb; only brightness moves. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> PipMids;

	TWeakObjectPtr<APlayerController> FollowController;

	EWonderlandMissionBeat Beat = EWonderlandMissionBeat::Unobserved;
	EWonderlandChakra Chakra = EWonderlandChakra::None;

	/** Eased toward the current beat's motion, so a state change reads as a change and not as a cut. */
	FWonderlandBeatMotion Motion;
	FWonderlandBeatMotion MotionTarget;

	/** Accumulated, and wrapped: an angle has no rest pose to be computed from. */
	float SpinDegrees = 0.0f;
	float BandDegrees = 0.0f;
	float Phase = 0.0f;
	int32 BoxCount = 0;
	bool bHasSnapped = false;
	bool bBuilt = false;
};

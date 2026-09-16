// WONDERLAND — THE MISSION CONTRACT. A floating crystal that exists only while a task is being executed.
//
// THE FOUNDER'S CANON, 2026-09-16, WHICH REPLACES THE PHASE 3 GROUND DAIS:
//
//   IT IS NOT FURNITURE. A Mission Contract does not exist because someone spawned into Wonderland, and it
//   does not trail the player around while they explore. It is MANIFESTED by a task being executed —
//   through Julius, through a Jhinn AI Agent, or through an LLM Companion that is actually participating —
//   and it is gone again when no task is running. The world is empty of contracts most of the time, and
//   that emptiness is the point: seeing one means something is happening.
//
//   IT FLOATS. A small, glowing, diamond-cut crystal in the air beside the player, not a plate on the
//   floor. Red at the moment a task begins, then climbing the chakra as the mission advances.
//
// WHAT IT IS MADE OF, from the founder's reference:
//
//   THE CRYSTAL — an eight-sided bipyramid, taller than it is wide, glowing in the colour of the step the
//   task has reached. This is the whole silhouette; everything else is trim on it.
//
//   THE FRAME — ivory-gold, LIT rather than glowing, so the crystal reads as a made object held in a
//   setting rather than as a floating light. A spire above, a point below, caps at the four equator
//   corners, and a girdle around the waist.
//
//   THE STAR — a small white flare at the heart, where the frame's axes cross.
//
//   THE ORBIT — one thin ring sweeping round it, leaning, turning with the mission. The turn is the
//   mission moving: forward while work advances, BACKWARDS through a repair, stopped dead on a block.
//
//   THE MOTES — a few sparks drifting round the crystal, in its colour.
//
// IT RESETS PER TASK. A new Mission Contract starts at Root and drops whatever the last one climbed to.
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

	/** Put the progression back to nothing, as a new Mission Contract does. */
	void ResetProgression();

	/**
	 * How far the contract has manifested, 0..1. A contract does not blink into existence: it draws itself
	 * in over MaterialiseSeconds when a task starts, and fades back out when the task is done. Driven from
	 * outside so the owner decides WHEN, and the actor only decides what that looks like.
	 */
	void SetManifest(float Target);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	float GetManifest() const { return Manifest; }

	/** True once the fade-out has finished and the owner may destroy this actor. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsFullyDismissed() const { return ManifestTarget <= 0.0f && Manifest <= 0.001f; }

	void SetOrbScale(float Scale);
	void SetFollowOffset(float Forward, float Right);

	/**
	 * STOP FOLLOWING AND BECOME A PLACE. Takes the follow position once and holds that world location.
	 *
	 * WHY THIS EXISTS. The contract used to be pinned in the pawn's YAW frame, which meant it was always
	 * the same distance dead ahead of the Dog whatever the Dog did -- and the founder's performances need
	 * the opposite. You cannot walk a circle around a point welded 3 m in front of your nose: the Dog would
	 * circle and the crystal would circle with it, one radius ahead, which reads as a dog chasing a bauble
	 * rather than studying a contract. Worse for VERIFYING, where "face the contract" and "track it with
	 * the head" are degenerate when it is by construction always straight ahead, and the beam becomes a rod
	 * at a fixed angle every frame forever (lane owner, 2026-09-16).
	 *
	 * So while a mission is being PERFORMED the contract is a place in the world, and the Dog moves around
	 * it. That is what "the Contract is the centre of the activity" has to mean geometrically.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void AnchorHere();

	/** Follow the Dog again. Called when a mission ends, so the next one anchors somewhere new. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void ReleaseAnchor();

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsAnchored() const { return bAnchored; }

	/** Where it is holding, world space. Meaningless unless IsAnchored. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FVector GetAnchorPoint() const { return AnchorPoint; }

	/** How many times the anchor has been re-taken because the visitor walked away. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetLeashBreaks() const { return LeashBreaks; }

	EWonderlandMissionBeat GetBeat() const { return Beat; }
	EWonderlandChakra GetChakra() const { return Chakra; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetBeatId() const { return WonderlandBeatId(Beat); }

	/** 0 when no task has started, else 1..7. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetChakraStep() const { return WonderlandChakraStep(Chakra); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetBoxCount() const { return BoxCount; }

	/** How tall the crystal stands, uu, at its current scale. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	float GetOrbHeightUU() const;

	/**
	 * Where it hangs, in the pawn's yaw frame: X forward, Y right, uu.
	 *
	 * MEASURED FROM THE PLAY CAMERA TWICE, and the second answer is not the first.
	 *
	 * (125, 80) was measured for a DAIS ON THE FLAGSTONES, where the only thing that could hide it was the
	 * Dog's own back leg. A floating contract has different neighbours: at 122 uu it hangs at the Jhinn's
	 * chest, and the Jhinn stands at Y=+110, so the ground answer put a crystal inside a companion.
	 *
	 * Eight placements were trialled in the air and looked at. Forward-and-right wins because it is the
	 * only one that clears BOTH companions -- high_right and wide_right_high pass straight through the
	 * Jhinn's crown, and the old ground placement overlaps its tail. Out in front, the crystal is
	 * silhouetted against the garden instead of against something else that glows.
	 *
	 * THE DISTANCE IS THE ORBIT RADIUS. Once anchored this is where the crystal is DROPPED, and the Dog
	 * then walks around it to read and to paint -- so 340 uu is not a framing choice, it is a 3.4 m circle,
	 * chosen inside the 3-6 m the animation lane asked for.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	FVector FollowOffset = FVector(340.0, 40.0, 0.0);

	/** Height of the crystal's heart above the floor, uu. Above the companions rather than among them. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float FloatHeightUU = 135.0f;

	/** Half-height of the crystal, uu: the distance from its heart to the tip of a pyramid. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float CrystalHalfHeightUU = 28.0f;

	/** Half-width of the crystal at its waist, uu. Narrower than it is tall, as a cut stone is. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float CrystalHalfWidthUU = 15.0f;

	/**
	 * Uniform scale over the whole contract.
	 *
	 * DERIVED, THEN TO BE CONFIRMED. 1.35 was chosen when the contract hung at 210 uu; moving it out to the
	 * 340 uu orbit radius shrinks it, and the joint film showed a crystal too small to read. A probe meant
	 * to settle it produced impossible numbers and no captures, so rather than spend another PIE session on
	 * a broken measurement this is solved from the two readings that ARE trustworthy:
	 *
	 *   (125 uu, x1.00) -> 149.5 px        apparent height ~ k * scale / (boom + forward)
	 *   (210 uu, x1.35) -> 170.8 px        two points, two unknowns: boom ~= 343 uu, k ~= 69958
	 *
	 * which puts x1.90 at about 195 px at 340 uu -- a little larger than the 170 px that read well before,
	 * because it now has to hold its own against a Dog walking a circle in front of it. Marked as derived
	 * rather than measured on purpose: the next joint film confirms it or replaces it.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float BuiltScale = 1.90f;

	/** Time constant of the follow, seconds. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float FollowLagSeconds = 0.42f;

	/** Farther than this from the follow position and it snaps rather than glides: a teleport. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float SnapDistanceUU = 1800.0f;

	/**
	 * How far the visitor may walk from an anchored contract before it comes after them, uu.
	 *
	 * A HARD ANCHOR WOULD BREAK THE OTHER HALF OF THE CANON. The founder asked both that the Contract be
	 * the centre of the activity AND that it "remains near the Relay Dog during active mission execution";
	 * a crystal that stayed put while someone wandered off satisfies the first and abandons the second.
	 * Inside this radius it holds perfectly still, which is every case an orbit or a beam cares about.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float LeashUU = 900.0f;

	/** Seconds to draw itself in when a task starts, and to fade out when one ends. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float MaterialiseSeconds = 0.55f;

	/**
	 * What an unlit colour is multiplied by to read against a physically-based Wonderland afternoon.
	 * Measured 2026-09-15: below about x3000 an emissive box reads as black in daylight.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Mission")
	float GlowExposure = 4000.0f;

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

	/** Hovers and turns. The crystal, the frame and the star hang from this. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Mission")
	TObjectPtr<USceneComponent> CrystalRoot;

	/** Turns the other way and leans, so the ring reads as sweeping round rather than carried. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Mission")
	TObjectPtr<USceneComponent> RingRoot;

	/** Drifts on its own clock. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Mission")
	TObjectPtr<USceneComponent> MoteRoot;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Meshes;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> CrystalMid;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> FrameMid;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> StarMid;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> RingMid;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> MoteMid;

	TWeakObjectPtr<APlayerController> FollowController;

	EWonderlandMissionBeat Beat = EWonderlandMissionBeat::Unobserved;
	EWonderlandChakra Chakra = EWonderlandChakra::None;

	/** Eased toward the current beat's motion, so a state change reads as a change and not as a cut. */
	FWonderlandBeatMotion Motion;
	FWonderlandBeatMotion MotionTarget;

	/** Accumulated, and wrapped: an angle has no rest pose to be computed from. */
	float SpinDegrees = 0.0f;
	float RingDegrees = 0.0f;
	float Phase = 0.0f;
	float Manifest = 0.0f;
	float ManifestTarget = 1.0f;
	FVector AnchorPoint = FVector::ZeroVector;
	int32 LeashBreaks = 0;
	bool bAnchored = false;
	int32 BoxCount = 0;
	bool bHasManifested = false;
	bool bHasSnapped = false;
	bool bBuilt = false;
};

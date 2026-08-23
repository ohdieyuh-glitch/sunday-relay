// THE AMBIENT RELAY DOGS — the Compound Agents the founder sees at spawn.
//
// WHY THIS CLASS DID NOT EXIST, AND WHAT THAT COST
//
// generate-hub-level.py has been spawning `/Script/Wonderland.WonderlandStrollingDog`
// for the hero Relay Dog and seven skinned companions since the art pass. That
// class was never written. `unreal.load_class` returned None, stroll_dog logged
// one warning and RETURNED, and every one of those eight Dogs was silently
// absent from the level — including the hero Dog the arrival camera is composed
// around. The world reported ~4400 actors and looked correct in every count,
// because the missing objects were never counted in the first place.
//
// So: the class exists now, and stroll_dog no longer has a path where it places
// nothing. A Dog that cannot be built is a VISIBLE failure, not an invisible one.
//
// WHAT IT IS AND IS NOT
//
// It is presentation and ambient life: a canonical Relay Dog body (shared, from
// WonderlandDogBody — never a second copy of the proportions), a slow wander
// inside a radius, a turn toward travel, and a breath.
//
// THE BREATH IS NOT A STATUS CHANNEL. It runs on this actor's own elapsed time
// and nothing else — no snapshot, no activity, no loop. The founder asked for
// Dogs that "move around like it's breathing in and out"; the moment that rate
// meant something it would become a second channel competing with Relay's own
// projection, and one of them would be wrong.
//
// Relay state reaches Dogs through AWonderlandDogPawn::ApplyWorldState. This
// actor has no such method, deliberately.

#pragma once

#include "WonderlandDogBody.h"

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandStrollingDog.generated.h"

class USceneComponent;

/** Tags every ambient Dog carries. WonderlandWorldProof counts them. */
namespace WonderlandDogTags
{
	/** On every Relay Dog in the world, hero or companion. */
	extern const FName RelayDog;
	/** On the Dogs that stand for a user's Compound AI Agent. */
	extern const FName CompoundAgent;
	/** The one hero Dog the arrival composition is built around. */
	extern const FName HeroRelayDog;
}

UCLASS(Blueprintable)
class AWonderlandStrollingDog : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandStrollingDog();

	/** Centre of the wander. Defaults to wherever the generator placed it. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	FVector HomeLocation = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float RoamRadius = 800.0f;

	/** The hero Dog. Larger, slower, and NOT a Compound Agent — it is the
	 *  founder's own Dog, and conflating the two would miscount both. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	bool bIsHero = false;

	/** Coat material instance name — "dog_body" is the canonical white. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	FName CoatName = FName(TEXT("dog_body"));

	/** "none", "tophat", "crown". Never alters the silhouette. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	FName Accessory = FName(TEXT("none"));

	/** The CURRENT leg's cruise speed. PickDestination varies it per leg of the
	 *  wander so the plaza shows strollers and trotters at once; the gait is
	 *  derived from speed, so this is the only knob that needs to move. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float WalkSpeed = 90.0f;

	/** What WalkSpeed is varied AROUND. Set by the generator per Dog. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float BaseWalkSpeed = 90.0f;

	/** A place the Dog will not walk into: the ARRIVAL CAMERA'S NEAR FIELD.
	 *
	 *  Companions roam 800 uu around a home that can sit 1,350 uu from the
	 *  arrival camera, so one can legitimately end up 550 uu from the lens —
	 *  where a 338 uu Dog fills seventy percent of the frame height and the
	 *  Marble castle city the shot exists to present is behind it. Every hero
	 *  capture this session took had a Dog standing in it like a wall, and the
	 *  first three readings of those frames blamed the camera.
	 *
	 *  Not a hack to tidy a screenshot: the arrival composition is the first
	 *  thing a player sees, and "a Dog may wander anywhere except through the
	 *  opening shot" is a staging rule, the same kind as the hero Dog owning
	 *  its own patch of frame. Radius 0 disables it. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	FVector KeepOutCentre = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float KeepOutRadius = 0.0f;

	/** How many body parts were actually built. 0 means the body failed and the
	 *  Dog is invisible — the world proof reports that rather than hiding it. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Dog")
	int32 BuiltParts = 0;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Dog")
	TObjectPtr<USceneComponent> Body;

	/** Seconds alive. The breath is a function of this and nothing else. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Life")
	float BreathElapsedSeconds() const { return LifeSeconds; }

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	void PickDestination();

	/** Nudge a point out of the keep-out column, along its own bearing. */
	FVector PushOutOfKeepOut(const FVector& Where) const;

	FVector Destination = FVector::ZeroVector;
	float LifeSeconds = 0.0f;

	/** DISTANCE TRAVELLED, which is what drives the gait. Not a clock: a gait
	 *  advanced by time drifts out of step with the body the moment speed
	 *  changes, and legs that twitch while the body glides is exactly the
	 *  failure this replaced. */
	float DistanceWalked = 0.0f;

	/** The legs, torso and head, so they can actually be moved. */
	WonderlandDogBody::FRig Rig;

	/** Ground height under the Dog, traced and smoothed. */
	float GroundZ = 0.0f;
	bool bHaveGround = false;

	/** The torso's scale as built, so the breath multiplies it rather than
	 *  replacing it. The breath used to scale the ROOT, which scaled the legs
	 *  and their stride with it — the whole Dog pulsed instead of breathing. */
	FVector TorsoBaseScale = FVector(1.0f, 1.0f, 1.0f);

	/** Stride geometry is NO LONGER FIXED. It used to be three constants, so a
	 *  Dog told to move faster cycled the same 132 uu stride more quickly —
	 *  legs spinning over unchanged ground, which is the speed/animation
	 *  mismatch by construction. WonderlandGait::GaitForSpeed derives all of
	 *  it from the current speed and the Dog's own hip height each tick.
	 *  These remain as the FALLBACK for a Dog whose rig failed to build. */
	float StrideLength = 132.0f;
	float StrideLift = 15.0f;
	float StrideBob = 3.0f;

	/** Hip height in WORLD units, cached once: leg length at build time times
	 *  the actor scale. The Froude number that picks the gait is
	 *  v^2/(g*h) and both v and h have to be world-space or a Dog at actor
	 *  scale 1.75 breaks gait at the wrong speed. */
	float HipHeightWorld = 119.6f;

	/** Speed is ACCELERATED toward its target, never assigned. A Dog that goes
	 *  from 0 to full stride in one frame is the "snapping from zero velocity
	 *  to full walk" the brief calls out; and because the gait is derived from
	 *  the speed, easing the speed eases the whole gait with it. */
	float CurrentSpeed = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float AccelUUPerSec2 = 260.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float DecelUUPerSec2 = 420.0f;

	/** What the world proof reports, so the gait in a captured frame is a
	 *  recorded fact rather than an inference from how fast something looked. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Dog")
	FName CurrentGaitName = FName(TEXT("idle"));

	/** Place the four paws, the torso and the head for a distance travelled.
	 *  SettleAlpha 1 blends everything back to the standing pose. */
	void PoseLegs(float Travelled, float SettleAlpha);
	/** Per-Dog phase so a crowd does not breathe in lockstep. Derived from the
	 *  actor's placed position, so it is stable across runs — a deterministic
	 *  hero frame must not depend on a random number. */
	float BreathPhase = 0.0f;
	float PauseSeconds = 0.0f;
};

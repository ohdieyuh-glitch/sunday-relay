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

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float WalkSpeed = 90.0f;

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

	FVector Destination = FVector::ZeroVector;
	float LifeSeconds = 0.0f;
	/** Per-Dog phase so a crowd does not breathe in lockstep. Derived from the
	 *  actor's placed position, so it is stable across runs — a deterministic
	 *  hero frame must not depend on a random number. */
	float BreathPhase = 0.0f;
	float PauseSeconds = 0.0f;
};

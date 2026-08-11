// WONDERLAND — the third-person Relay Dog pawn.
//
// The pawn the player controls. It is the user's Compound AI Agent given a body,
// a spring-arm camera behind it, and an animation state that is READ from the
// world snapshot rather than chosen here.
//
// THE AUTHORITY BOUNDARY, IN THIS CLASS
//
//   ApplyWorldState() is the only way the pawn learns anything about Relay, it
//   takes a const reference, and it writes nothing back. There is no method on
//   this pawn that starts a mission, advances a loop, records evidence, or
//   changes a verdict. Movement and camera are local and presentational; the
//   Agent's STATE arrives from Relay and is never inferred from where the player
//   walked.
//
//   ObservedAnimation() returns Dormant until a snapshot has been applied. Not
//   PatrolWalk: a pawn that has heard nothing from Relay is not an idling Agent,
//   and defaulting to the idle clip is how a disconnected client ends up looking
//   like a working one.
//
// PROPORTIONS ARE IDENTITY. The mesh is scaled by ONE uniform factor
// (FWonderlandDogProportions::UniformScale). There is deliberately no separate
// width or height property: independent axis scaling distorts the body, and a
// skin transforms the Relay Dog rather than replacing it with an unrelated
// humanoid.
//
// NOT COMPILED. No Unreal Engine binary exists in this environment, so this
// class has never been built or run. See docs/relay/WONDERLAND.md for exactly
// what that leaves unproven.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "RelayWorldState.h"
#include "WonderlandDogAnimation.h"
#include "WonderlandDogPawn.generated.h"

class UCameraComponent;
class USpringArmComponent;
class UStaticMeshComponent;
class UInputAction;
class UInputMappingContext;

UCLASS(Blueprintable)
class AWonderlandDogPawn : public APawn
{
	GENERATED_BODY()

public:
	AWonderlandDogPawn();

	/** The scene root: the Dog's collision and movement volume. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Dog")
	TObjectPtr<UStaticMeshComponent> DogMesh;

	/** Third-person boom. Collision test on, so the camera does not clip walls. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Camera")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Camera")
	TObjectPtr<UCameraComponent> FollowCamera;

	/** Enhanced Input bindings, assigned in the Blueprint subclass. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Input")
	TObjectPtr<UInputMappingContext> InputContext;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Input")
	TObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Input")
	TObjectPtr<UInputAction> LookAction;

	/** Identity constants and the ONE uniform scale factor. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Wonderland|Dog")
	FWonderlandDogProportions Proportions;

	/**
	 * Accept a Relay snapshot.
	 *
	 * READ-ONLY: takes a const reference and returns void. The pawn keeps the
	 * agent section and the loop signals it needs for animation and nothing else.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Relay")
	void ApplyWorldState(const FWonderlandWorld& World);

	/** The clip to play. Dormant until a snapshot has been applied. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Relay")
	EWonderlandDogAnimation ObservedAnimation() const;

	/** The additive overlay. None until a snapshot has been applied. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Relay")
	EWonderlandDogOverlay ObservedOverlay() const;

	/**
	 * False until Relay has asserted an activity for this Agent.
	 *
	 * A surface that draws a label must show the unobserved case as unobserved.
	 * The state label is always present as TEXT — no Relay state is ever conveyed
	 * by colour or silhouette alone.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Relay")
	bool HasObservedActivity() const;

	/**
	 * THE BREATH, AND IT IS NOT UNDER "Wonderland|Relay".
	 *
	 * Deliberately categorised `Wonderland|Life`, because it is the one thing on
	 * this pawn that Relay does not drive. It is a function of the pawn's own
	 * elapsed time and NOTHING else: no snapshot, no activity, no loop. A
	 * designer wiring this in Blueprint should see at a glance that it is
	 * ambient, or the first thing they will do is try to make it faster when the
	 * Agent is busy — which would turn it into a status channel nobody can read
	 * correctly.
	 *
	 * It runs before a snapshot arrives, too. An unobserved Agent is still alive;
	 * only its ACTIVITY is unknown, and a Dog that stood perfectly still until
	 * Relay spoke would read as broken rather than as waiting.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Life")
	FWonderlandBreath CurrentBreath() const;

	/**
	 * Seconds this pawn has been alive. Advanced by Tick and by nothing else.
	 *
	 * Exposed read-only so a test can prove the breath depends on it and on
	 * nothing on this pawn that Relay wrote.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Life")
	float BreathElapsedSeconds() const;

protected:
	virtual void SetupPlayerInputComponent(class UInputComponent* PlayerInputComponent) override;
	virtual void Tick(float DeltaSeconds) override;

private:
	/** The last agent section Relay sent. Default-constructed = unobserved. */
	UPROPERTY()
	FWonderlandAgent ObservedAgent;

	/** The last loop signals Relay sent. Empty = no loop observed. */
	UPROPERTY()
	TArray<FWonderlandLoopSignal> ObservedLoops;

	/** True only after ApplyWorldState has run at least once. */
	bool bSnapshotApplied = false;

	/**
	 * The breath clock. NOT a UPROPERTY and not replicated: every client
	 * breathes on its own time, because a breath is presentation and sending it
	 * over the wire would spend bandwidth to synchronise something that carries
	 * no information. It is also why the breath must stay information-free — the
	 * moment it meant anything, this field would have to be authoritative, and
	 * Relay is the only authority in this system.
	 */
	float LifeSeconds = 0.0f;
};

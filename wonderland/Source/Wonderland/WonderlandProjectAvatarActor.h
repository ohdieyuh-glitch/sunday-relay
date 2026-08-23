// The Project Avatar, in the world.
//
// The state lives next door in WonderlandProjectAvatar.h, engine-free and
// tested; this is the part that has to exist in a level. It builds its shell
// from the same primitive kit the Relay Dog uses, so it needs no new asset and
// no import step — which is what lets it appear in the next build rather than
// the next art pass.
//
// IT DOES NOT DECIDE WHAT RELAY IS DOING. The mission state is PUSHED in.
// Absent a push it stays Unknown, which the state module maps to dormant and
// dark. An Avatar that defaulted to something plausible would light up for a
// Bridge that never answered.
#pragma once

#include "WonderlandProjectAvatar.h"

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandProjectAvatarActor.generated.h"

class UStaticMeshComponent;
class USceneComponent;

UCLASS()
class AWonderlandProjectAvatarActor : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandProjectAvatarActor();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Relay's current mission state, as an int matching EMission. Exposed as
	 *  an int32 so the generator and Blueprints can set it without the enum. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Avatar")
	int32 MissionState = 0;   // EMission::Unknown

	/** How many missions have actually completed. Drives the stage, and there
	 *  is deliberately no time-based path to the same effect. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Avatar")
	int32 CompletedRuns = 0;

	/** Base size of the shell in uu at stage Egg. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Avatar")
	float BaseRadius = 96.0f;

	/** Reported by the world proof, so a captured frame records the Avatar's
	 *  state as a fact rather than leaving it to be guessed from the glow. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Avatar")
	FName StageName = FName(TEXT("dormant"));

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Avatar")
	int32 BuiltParts = 0;

	/** Where a Dog should stand to work on this. */
	FVector AttendancePoint() const;

	WonderlandAvatar::EMission Mission() const
	{
		return static_cast<WonderlandAvatar::EMission>(MissionState);
	}

private:
	void BuildShell();

	UPROPERTY() TObjectPtr<USceneComponent> Root;
	UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Shell;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Core;

	TArray<FVector> ShellRest;
	TArray<FVector> ShellRestScale;
	WonderlandAvatar::EStage Stage = WonderlandAvatar::EStage::Dormant;
	float LifeSeconds = 0.0f;
};

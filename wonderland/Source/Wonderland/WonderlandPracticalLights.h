// WONDERLAND -- practical lights: the lamps that actually light the city after dark.
//
// THE FINDING THIS ANSWERS. Measured 2026-09-27 at midnight on the territory checkpoints: court luminance
// TARTARUS 0.037, NOCTIS 0.19, against ICARUS 0.34 and Dubel 0.45, with 94% and 73% of the frame crushed to
// black at the two dark ones. Same hour, same rig. The difference is paint: Tartarus is crimson and black,
// Noctis is obsidian and charcoal, and NOTHING LOCAL LIGHTS EITHER. The world has one sun, one moon, three
// shadowless fills, one sky light, the Dog's lamp and five 4-metre checkpoint lamps. Every lantern standard
// in Wonderland -- hundreds of them, down every march and round every plaza -- is an EMISSIVE MESH. It glows
// and lights nothing. That is the whole distance between "the city has lamps" and "the city is lit", and it
// is the founder's night item stated as a mechanism: "the city must be lit at night ... efficient practicals,
// architectural accents, path/street illumination, landmark lighting".
//
// SPAWNED, NOT PLACED, for the same reason the moon and the checkpoint pylons are: Content/ is a junction
// shared by every worktree, and adding hundreds of light actors to the .umap is the one change that could be
// lost or could collide with another editor. The lights are read from a data file the world tools generate
// from the specs -- so a lantern standard that moves in a layer moves its light with it on the next
// regeneration -- and they are transient, so they are never saved into anything.
//
// BOUNDED, BECAUSE A LIGHT PER LANTERN IS A THOUSAND LIGHTS. Only the nearest few dozen to the player are
// lit; the rest are hidden and cost nothing. The count and the radius are console variables so the budget
// can be swept against a frame time rather than guessed.
//
// DAY/NIGHT AWARE. Intensity follows the day cycle's own night curve, so a lamp is dark at noon and comes up
// with the moon -- no schedule of its own, no second clock. wl.Look.PracticalGain scales all of them at once
// for the night sweep.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "WonderlandPracticalLights.generated.h"

class APointLight;

/** One lamp as the data file describes it. */
USTRUCT()
struct FWonderlandPracticalLight
{
	GENERATED_BODY()

	UPROPERTY() FVector Location = FVector::ZeroVector;
	UPROPERTY() FLinearColor Colour = FLinearColor(1.0f, 0.78f, 0.5f, 1.0f);
	/** Candelas at full night. */
	UPROPERTY() float Candelas = 12.0f;
	UPROPERTY() float RadiusUU = 900.0f;
	UPROPERTY() float SourceRadiusUU = 12.0f;
	UPROPERTY() FString Label;
};

UCLASS()
class WONDERLAND_API UWonderlandPracticalLightsSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UWonderlandPracticalLightsSubsystem, STATGROUP_Tickables); }

	/** For proofs: "defined=N active=K night=0.00 gain=1.00 radius=12000 file=..." */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Look")
	FString DescribePracticals() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Look")
	int32 GetDefinedCount() const { return Defined.Num(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Look")
	int32 GetActiveCount() const { return ActiveCount; }

	/** Re-read the data file and rebuild the pool. Console: wl.Look.PracticalReload */
	void Reload();

private:
	bool LoadFile(FString& OutProblem);
	void BuildPool();
	void Assign();

	UPROPERTY(Transient) TArray<FWonderlandPracticalLight> Defined;
	/** The pool of spawned lights; Pool[i] currently shows Defined[Assigned[i]] or is hidden. */
	UPROPERTY(Transient) TArray<TObjectPtr<APointLight>> Pool;
	TArray<int32> Assigned;
	int32 ActiveCount = 0;
	float SinceAssign = 0.0f;
	float LastNight = -1.0f;
	float LastGain = -1.0f;
	FString FilePath;
	FString LoadProblem;
};

// WONDERLAND — MORNING TO NIGHT AND ROUND AGAIN.
//
// FOUNDER, 2026-09-24: "Add continuous time of day: morning -> afternoon -> evening/night -> morning. Sky, sun,
// atmosphere, exposure, shadows, clouds, windows/lanterns, and environment lighting transition coherently."
// And, separately: "Fix glitching shadows: flicker, bias, leaking, unstable shadows, conflicting lights."
//
// Both live here because they are the same actor's business: the thing that moves the sun is the thing that has
// to keep its shadows stable while it moves.
//
// A SUBSYSTEM, NOT AN ACTOR IN THE MAP. Wonderland's Content is a junction shared by every worktree and is not
// durably tracked, so adding an actor to the .umap is the one change that could be lost or could collide with
// another editor. This attaches itself to whatever the level already has -- the survey found exactly one
// atmosphere sun, one SkyAtmosphere, one SkyLight, one height fog, one volumetric cloud and one post process
// volume -- and never edits the level at all.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "WonderlandDayCycle.generated.h"

class ADirectionalLight;
class ASkyLight;
class AExponentialHeightFog;
class APostProcessVolume;

UCLASS()
class WONDERLAND_API UWonderlandDayCycleSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;
	virtual void Tick(float DeltaSeconds) override;
	virtual TStatId GetStatId() const override;

	/** The hour of Wonderland's day, 0-24. Noon is 12. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Sky")
	float GetHour() const { return Hour; }

	/** Put the sky at an hour and hold there if Speed is zero. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Sky")
	void SetHour(float NewHour);

	/** How far above the horizon the sun stands right now, in degrees. Negative is night. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Sky")
	float GetSunElevationDeg() const;

	/** What the sky is doing, in one line, for a proof to read back rather than infer from a photograph. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Sky")
	FString DescribeSky() const;

private:
	void FindTheSky();
	/** Points every pond, well, canal and fountain basin at the real water material, if it is present. */
	void DressTheWater();
	void ApplyStableShadows();
	void PaintTheSky();

	/** 0-24. Starts mid-morning, which is the light every reference plate of Wonderland was made in. */
	float Hour = 9.5f;
	/** Hours of Wonderland time per real second. Zero holds the sky still. */
	float HoursPerSecond = 0.0f;
	float SinceSkyCapture = 0.0f;
	bool bFound = false;

	TWeakObjectPtr<ADirectionalLight> Sun;
	TWeakObjectPtr<ASkyLight> Sky;
	TWeakObjectPtr<AExponentialHeightFog> Fog;
	TWeakObjectPtr<APostProcessVolume> Grade;
	/** The fills: bounced ground light and the two canopy lights, dimmed together as the sun goes down. */
	TArray<TWeakObjectPtr<ADirectionalLight>> Fills;
	TArray<float> FillIntensities;
	float SunIntensityAtNoon = 70000.0f;
	float FogDensityByDay = 0.0f;
	/** The water surfaces, so the day cycle can carry their colour with the light. */
	TArray<TWeakObjectPtr<class UMaterialInstanceDynamic>> WaterSurfaces;
	int32 WaterDressed = 0;
};

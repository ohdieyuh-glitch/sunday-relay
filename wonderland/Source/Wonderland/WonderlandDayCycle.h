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

	/**
	 * HOW FAR INTO THE NIGHT IT IS: 0 with the sun up, 1 once it is well down, smooth between.
	 *
	 * Read by anything that has to behave differently after dark -- the Relay Dog's own night light is the
	 * first -- so there is ONE curve for "it is night now" and not a second opinion per system.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Sky")
	float GetNightAmount() const { return Nightfall; }

	/** What the sky is doing, in one line, for a proof to read back rather than infer from a photograph. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Sky")
	FString DescribeSky() const;

private:
	void FindTheSky();
	/** Stands a second directional light in the sky, opposite the sun, so night is LIT rather than merely dark. */
	void MakeTheMoon();
	/** Points every pond, well, canal and fountain basin at the real water material, if it is present. */
	void DressTheWater();
	void ApplyStableShadows();
	/** Bring every mascot's emissive channels down to meet the night exposure. See the definition. */
	void ScaleGlowsForNight();
	void PaintTheSky();

	/** 0-24. Starts mid-morning, which is the light every reference plate of Wonderland was made in. */
	float Hour = 9.5f;
	/** Hours of Wonderland time per real second. Zero holds the sky still. */
	float HoursPerSecond = 0.0f;
	/** The night curve, computed in PaintTheSky and published by GetNightAmount. */
	float Nightfall = 0.0f;
	float SinceSkyCapture = 0.0f;
	bool bFound = false;

	TWeakObjectPtr<ADirectionalLight> Sun;
	/**
	 * THE MOON, and it is a real light rather than a floor under the sun's.
	 *
	 * FOUNDER, 2026-09-25: "NIGHT MODE IS TOO DARK ... it must still read as NIGHT, but the player must be able
	 * to see the Relay Dog, the ground around the player, paths, architecture silhouettes, the Project Avatars
	 * and AI Companions, and navigation landmarks."
	 *
	 * The old night was the SUN held at 0.4% of noon while it stood up to 72 degrees BELOW the horizon -- which
	 * means the only directional light in the world was shining UPWARDS through the ground. That is why raising
	 * it was never the answer: brighter would only have lit the undersides of things. So the night gets its own
	 * light, standing where a moon stands (opposite the sun, therefore high when the sun is low), and it lights
	 * the world from above with its own shadows. Silhouettes come back, the ground reads, and nothing is washed
	 * flat, because this is a light with a direction rather than a lift on the exposure.
	 */
	TWeakObjectPtr<ADirectionalLight> Moon;
	/** The sky light's authored strength, so night can raise it without forgetting what day was. */
	float SkyIntensityByDay = 1.0f;
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

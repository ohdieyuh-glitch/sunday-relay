#include "WonderlandDayCycle.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/SkyLight.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"

namespace
{
	/**
	 * HOW HIGH THE SUN STANDS AT THIS HOUR.
	 *
	 * Sunrise at six, noon at twelve, sunset at eighteen, and below the horizon between -- one smooth curve
	 * rather than a table, so every intermediate minute is as valid as the four the founder named and nothing
	 * jumps at a boundary.
	 */
	float ElevationAt(float Hour)
	{
		const float Through = (Hour - 6.0f) / 12.0f;   // 0 at sunrise, 1 at sunset
		return FMath::Sin(Through * PI) * 72.0f;
	}

	/** The sun's bearing, swinging through the south across the day so shadows sweep rather than pivot. */
	float BearingAt(float Hour)
	{
		return FMath::Lerp(72.0f, 288.0f, FMath::Clamp((Hour - 5.0f) / 14.0f, 0.0f, 1.0f));
	}

	/** Warm at the horizon, white overhead. The turn happens in the last few degrees, as it does outdoors. */
	FLinearColor SunColourAt(float Elevation)
	{
		const float Low = FMath::Clamp(1.0f - Elevation / 18.0f, 0.0f, 1.0f);
		const FLinearColor Noon(1.0f, 0.99f, 0.96f, 1.0f);
		const FLinearColor Horizon(1.0f, 0.62f, 0.33f, 1.0f);
		return FMath::Lerp(Noon, Horizon, Low * Low);
	}

	TAutoConsoleVariable<float> CVarDayMinutes(
		TEXT("wl.Sky.DayMinutes"), 24.0f,
		TEXT("Real minutes for one whole Wonderland day. 0 holds the sky still."));
}

bool UWonderlandDayCycleSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	// Game worlds only: an editor preview world has no sun of its own to move and no player to see it.
	const UWorld* World = Cast<UWorld>(Outer);
	return World != nullptr && World->IsGameWorld();
}

void UWonderlandDayCycleSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	FindTheSky();
	ApplyStableShadows();
	PaintTheSky();
}

TStatId UWonderlandDayCycleSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UWonderlandDayCycleSubsystem, STATGROUP_Tickables);
}

void UWonderlandDayCycleSubsystem::FindTheSky()
{
	UWorld* World = GetWorld();
	if (World == nullptr) { return; }

	for (TActorIterator<ADirectionalLight> It(World); It; ++It)
	{
		UDirectionalLightComponent* Comp = It->GetComponent();
		if (Comp == nullptr) { continue; }
		// THE SUN IS THE ONE THE ATMOSPHERE ALREADY BELIEVES IN. Measured, this level has four directional
		// lights and exactly one of them -- V2_Sun -- is the atmosphere sun light; the other three are a ground
		// bounce and two canopy fills that cast no shadows at all. Picking the brightest, or the first, would
		// have been a guess; asking which one the SkyAtmosphere is driven by is not.
		if (Comp->IsUsedAsAtmosphereSunLight() && !Sun.IsValid())
		{
			Sun = *It;
			SunIntensityAtNoon = Comp->Intensity;
		}
		else
		{
			Fills.Add(*It);
			FillIntensities.Add(Comp->Intensity);
		}
	}
	for (TActorIterator<ASkyLight> It(World); It; ++It) { Sky = *It; break; }
	for (TActorIterator<AExponentialHeightFog> It(World); It; ++It)
	{
		Fog = *It;
		if (const UExponentialHeightFogComponent* C = It->GetComponent())
		{
			FogDensityByDay = C->FogDensity;
		}
		break;
	}
	for (TActorIterator<APostProcessVolume> It(World); It; ++It) { Grade = *It; break; }

	bFound = Sun.IsValid();
	UE_LOG(LogTemp, Display,
		TEXT("WLSKY sun=%s fills=%d skylight=%s fog=%s grade=%s"),
		Sun.IsValid() ? *Sun->GetName() : TEXT("NONE -- the sky will not move"),
		Fills.Num(), Sky.IsValid() ? TEXT("yes") : TEXT("no"),
		Fog.IsValid() ? TEXT("yes") : TEXT("no"), Grade.IsValid() ? TEXT("yes") : TEXT("no"));
}

void UWonderlandDayCycleSubsystem::ApplyStableShadows()
{
	ADirectionalLight* Light = Sun.Get();
	UDirectionalLightComponent* Comp = Light != nullptr ? Light->GetComponent() : nullptr;
	if (Comp == nullptr) { return; }

	// ---- WHY THE SHADOWS CRAWLED.
	//
	// Measured on this level: 40,000 uu of dynamic shadow distance spread over 3 cascades with a distribution
	// exponent of 3.0. That is four hundred metres of world across three shadow maps, and the exponent pushes
	// most of that range into the LAST cascade -- so the ground near the Dog, where the founder actually looks,
	// was being shadowed at a resolution meant for the horizon. Every step the camera takes re-snaps that map,
	// and a re-snapped low-resolution cascade is exactly what "flicker" and "unstable shadows" look like.
	//
	// Half the distance, an extra cascade, and a gentler exponent put four times the texel density where it is
	// seen. The fade keeps the last cascade from popping as it is crossed, and lowering the bias closes the gap
	// at the foot of walls that reads as light leaking under them -- possible only BECAUSE the cascades got
	// tighter, since bias is what a coarse map needs to stop shadow acne and a fine one does not.
	Comp->DynamicShadowDistanceMovableLight = 18000.0f;
	Comp->DynamicShadowCascades = 4;
	Comp->CascadeDistributionExponent = 1.85f;
	Comp->CascadeTransitionFraction = 0.12f;
	Comp->ShadowBias = 0.30f;
	Comp->ShadowSlopeBias = 0.35f;
	// Contact shadows close the last few pixels where a foot meets stone, which no cascade resolves.
	Comp->ContactShadowLength = 0.035f;
	Comp->bCastVolumetricShadow = true;
	Comp->MarkRenderStateDirty();
	UE_LOG(LogTemp, Display,
		TEXT("WLSKY shadows: %.0f uu over %d cascades (exp %.2f), bias %.2f/%.2f, contact %.3f"),
		Comp->DynamicShadowDistanceMovableLight, Comp->DynamicShadowCascades,
		Comp->CascadeDistributionExponent, Comp->ShadowBias, Comp->ShadowSlopeBias, Comp->ContactShadowLength);
}

void UWonderlandDayCycleSubsystem::SetHour(float NewHour)
{
	Hour = FMath::Fmod(FMath::Fmod(NewHour, 24.0f) + 24.0f, 24.0f);
	PaintTheSky();
}

float UWonderlandDayCycleSubsystem::GetSunElevationDeg() const
{
	return ElevationAt(Hour);
}

void UWonderlandDayCycleSubsystem::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bFound) { return; }

	const float Minutes = CVarDayMinutes.GetValueOnGameThread();
	HoursPerSecond = Minutes > 0.01f ? (24.0f / (Minutes * 60.0f)) : 0.0f;
	if (HoursPerSecond > 0.0f)
	{
		Hour = FMath::Fmod(Hour + HoursPerSecond * DeltaSeconds, 24.0f);
		PaintTheSky();
	}

	// THE SKY LIGHT IS RECAPTURED, NOT LEFT. It is what lights everything the sun does not reach, so a sky that
	// turns orange while the shadows stay blue is the single most obvious way a day cycle looks fake. Twice a
	// second is far more often than the eye needs and far less often than every frame would cost.
	SinceSkyCapture += DeltaSeconds;
	if (SinceSkyCapture > 0.5f)
	{
		SinceSkyCapture = 0.0f;
		if (ASkyLight* Light = Sky.Get())
		{
			if (USkyLightComponent* Comp = Light->GetLightComponent())
			{
				Comp->RecaptureSky();
			}
		}
	}
}

void UWonderlandDayCycleSubsystem::PaintTheSky()
{
	ADirectionalLight* Light = Sun.Get();
	UDirectionalLightComponent* Comp = Light != nullptr ? Light->GetComponent() : nullptr;
	if (Comp == nullptr) { return; }

	const float Elevation = ElevationAt(Hour);
	// ---- THE SUN ITSELF. Pitch is negative downward in Unreal, so an elevation above the horizon is a
	// ---- negative pitch: the light points DOWN at the world from up there.
	Light->SetActorRotation(FRotator(-Elevation, BearingAt(Hour), 0.0f));

	// Full strength from a little above the horizon, falling to nothing as it sets, and never negative.
	const float Daylight = FMath::Clamp(Elevation / 12.0f, 0.0f, 1.0f);
	// A FLOOR OF MOONLIGHT, so night is legible rather than black. Cool, and a thousandth of noon.
	const float Night = 1.0f - Daylight;
	Comp->SetIntensity(FMath::Max(SunIntensityAtNoon * Daylight, SunIntensityAtNoon * 0.004f));
	Comp->SetLightColor(FMath::Lerp(FLinearColor(0.42f, 0.55f, 0.95f, 1.0f), SunColourAt(Elevation), Daylight));

	// ---- THE FILLS GO WITH IT. Bounced ground light and canopy fill are daylight effects; leaving them at
	// ---- full strength through the night is what makes a night scene look like a day scene with a dark sky.
	for (int32 Index = 0; Index < Fills.Num(); ++Index)
	{
		ADirectionalLight* Fill = Fills[Index].Get();
		UDirectionalLightComponent* FillComp = Fill != nullptr ? Fill->GetComponent() : nullptr;
		if (FillComp == nullptr || !FillIntensities.IsValidIndex(Index)) { continue; }
		FillComp->SetIntensity(FillIntensities[Index] * FMath::Max(Daylight, 0.06f));
	}

	// ---- THE AIR THICKENS AT EITHER END OF THE DAY, which is what sells a sunrise and a dusk.
	if (AExponentialHeightFog* Air = Fog.Get())
	{
		if (UExponentialHeightFogComponent* FogComp = Air->GetComponent())
		{
			const float Edge = 1.0f - FMath::Abs(Elevation) / 72.0f;          // 1 at the horizon, 0 overhead
			FogComp->SetFogDensity(FogDensityByDay * (1.0f + Edge * 1.35f));
			FogComp->SetFogInscatteringColor(FMath::Lerp(
				FLinearColor(0.05f, 0.07f, 0.14f, 1.0f), SunColourAt(Elevation), Daylight));
		}
	}

	// ---- AND THE EYE ADJUSTS. Opened at night and closed at noon, by a stop and a half either way, so the
	// ---- founder can still read the garden at midnight without noon becoming milky.
	if (APostProcessVolume* Volume = Grade.Get())
	{
		Volume->Settings.bOverride_AutoExposureBias = true;
		Volume->Settings.AutoExposureBias = FMath::Lerp(1.5f, -0.4f, Daylight);
	}
}

namespace
{
	UWonderlandDayCycleSubsystem* CycleFor(UWorld* World)
	{
		return World != nullptr ? World->GetSubsystem<UWonderlandDayCycleSubsystem>() : nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs GSkyHour(
		TEXT("wl.Sky.Hour"),
		TEXT("Put Wonderland's sky at an hour: wl.Sky.Hour <0-24>."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandDayCycleSubsystem* Cycle = CycleFor(World);
			if (Cycle == nullptr || Args.Num() < 1)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLSKY usage: wl.Sky.Hour <0-24>"));
				return;
			}
			Cycle->SetHour(FCString::Atof(*Args[0]));
			UE_LOG(LogTemp, Display, TEXT("WLSKY %s"), *Cycle->DescribeSky());
		}));

	FAutoConsoleCommandWithWorldAndArgs GSkyState(
		TEXT("wl.Sky.State"),
		TEXT("Say what the sky is doing right now."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			if (const UWonderlandDayCycleSubsystem* Cycle = CycleFor(World))
			{
				UE_LOG(LogTemp, Display, TEXT("WLSKY %s"), *Cycle->DescribeSky());
			}
		}));
}

FString UWonderlandDayCycleSubsystem::DescribeSky() const
{
	const ADirectionalLight* Light = Sun.Get();
	const UDirectionalLightComponent* Comp = Light != nullptr ? Light->GetComponent() : nullptr;
	return FString::Printf(
		TEXT("hour=%.2f elevation=%.1f intensity=%.0f cascades=%d shadowDistance=%.0f exposureBias=%.2f fills=%d"),
		Hour, ElevationAt(Hour),
		Comp != nullptr ? Comp->Intensity : -1.0f,
		Comp != nullptr ? Comp->DynamicShadowCascades : -1,
		Comp != nullptr ? Comp->DynamicShadowDistanceMovableLight : -1.0f,
		Grade.IsValid() ? Grade->Settings.AutoExposureBias : 0.0f,
		Fills.Num());
}

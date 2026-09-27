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
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "HAL/IConsoleManager.h"
#include "WonderlandCompanionEmbodiment.h"
#include "RelayDogCharacter.h"

namespace
{
	/**
	 * THE SUN'S LIGHT COMPONENT, REACHED THE WAY A PACKAGED BUILD CAN REACH IT.
	 *
	 * ADirectionalLight::GetComponent() is declared inside WITH_EDITOR. This file used it five times, the
	 * EDITOR target compiled every one of them happily, and the GAME target could not compile a single one --
	 * so Wonderland could not be packaged at all, and no amount of testing in PIE would ever have said so.
	 * The failure only appeared when a packaged build was actually attempted.
	 *
	 * ALight::GetLightComponent() is the runtime accessor and exists in both targets.
	 */
	UDirectionalLightComponent* SunComponent(const ADirectionalLight* Light)
	{
		return Light != nullptr ? Cast<UDirectionalLightComponent>(Light->GetLightComponent()) : nullptr;
	}

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

	/**
	 * The sun's bearing, swinging through the south across the day so shadows sweep rather than pivot -- AND
	 * CONTINUING ROUND THROUGH THE NIGHT, which it did not do until this was measured.
	 *
	 * The clamped version froze the bearing at 288 deg from 19:00 to midnight and at 72 deg from midnight to
	 * 05:00, then SNAPPED 216 degrees the instant Hour wrapped through Fmod from 24 to 0 -- taking the moon
	 * with it, since the moon is laid out at bearing + 180. zzT3 measured the result at the arrival: luma
	 * 0.1971 to 0.1714 and ground 0.1969 to 0.1573 between 23:30 and midnight, a step eighteen times the
	 * median step of the rest of the night, on a night that is otherwise flat to within 0.0053.
	 *
	 * The docstring directly above this one promises that "nothing jumps at a boundary". The elevation curve
	 * honours that; this function sat three lines under the same comment and broke it once a night, at the
	 * same moment, for every player.
	 *
	 * So the night now carries the remaining 144 degrees of the circle at a constant rate: 288 deg at 19:00
	 * swinging to 432 deg (which is 72) at 05:00, where the day arc picks it up exactly. Continuous at both
	 * joins and across the wrap -- 359.99 and 0.0 are the same direction to a rotator, so nothing jumps.
	 */
	float BearingAt(float Hour)
	{
		if (Hour >= 5.0f && Hour <= 19.0f)
		{
			// Day: 72 -> 288 through the south, over fourteen hours. Unchanged.
			return FMath::Lerp(72.0f, 288.0f, (Hour - 5.0f) / 14.0f);
		}
		// Night: ten hours from 19:00 round to 05:00, in the SAME direction, covering the other 144 degrees.
		const float IntoNight = (Hour > 19.0f) ? (Hour - 19.0f) : (Hour + 5.0f);
		return FMath::Fmod(288.0f + 144.0f * (IntoNight / 10.0f), 360.0f);
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
	DressTheWater();
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
		UDirectionalLightComponent* Comp = SunComponent(*It);
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
	for (TActorIterator<ASkyLight> It(World); It; ++It)
	{
		Sky = *It;
		if (const USkyLightComponent* SkyComp = It->GetLightComponent())
		{
			SkyIntensityByDay = SkyComp->Intensity;
		}
		break;
	}
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

	MakeTheMoon();

	bFound = Sun.IsValid();
	UE_LOG(LogTemp, Display,
		TEXT("WLSKY sun=%s fills=%d skylight=%s fog=%s grade=%s"),
		Sun.IsValid() ? *Sun->GetName() : TEXT("NONE -- the sky will not move"),
		Fills.Num(), Sky.IsValid() ? TEXT("yes") : TEXT("no"),
		Fog.IsValid() ? TEXT("yes") : TEXT("no"), Grade.IsValid() ? TEXT("yes") : TEXT("no"));
}

void UWonderlandDayCycleSubsystem::MakeTheMoon()
{
	UWorld* World = GetWorld();
	if (World == nullptr || Moon.IsValid())
	{
		return;
	}
	// SPAWNED, NOT PLACED, for the same reason this whole subsystem is a subsystem: Wonderland's Content is a
	// junction shared by every worktree, and adding an actor to the .umap is the one change that could be lost
	// or could collide with another editor. Transient, so it is never saved into anything.
	FActorSpawnParameters Params;
	Params.ObjectFlags |= RF_Transient;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ADirectionalLight* Light = World->SpawnActor<ADirectionalLight>(
		ADirectionalLight::StaticClass(), FTransform::Identity, Params);
	if (Light == nullptr)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLSKY the moon could not be spawned; night will be as dark as it was"));
		return;
	}
	Light->SetMobility(EComponentMobility::Movable);
#if WITH_EDITOR
	Light->SetActorLabel(TEXT("WL_Moon"), false);
#endif
	if (UDirectionalLightComponent* Comp = SunComponent(Light))
	{
		// NOT A SECOND SUN. The atmosphere is driven by exactly one light and it is V2_Sun; a moon that claimed
		// to be an atmosphere sun would paint a second daylight sky in the middle of the night.
		Comp->SetAtmosphereSunLight(false);
		Comp->SetIntensity(0.0f);
		Comp->SetLightColor(FLinearColor(0.40f, 0.52f, 0.86f, 1.0f));
		Comp->CastShadows = true;
		Comp->bCastVolumetricShadow = false;
		// SILHOUETTES ARE THE POINT, so the moon casts, but it casts cheaply: the founder asked to see the shape
		// of the architecture at night, not to read the mortar. Two cascades over the near field do that, and a
		// softer source reads as moonlight rather than as a second midday.
		Comp->DynamicShadowDistanceMovableLight = 12000.0f;
		Comp->DynamicShadowCascades = 2;
		Comp->CascadeDistributionExponent = 1.6f;
		Comp->CascadeTransitionFraction = 0.15f;
		Comp->ShadowBias = 0.45f;
		Comp->ShadowSlopeBias = 0.45f;
		Comp->SetLightSourceAngle(1.6f);
		Comp->MarkRenderStateDirty();
	}
	Moon = Light;
	UE_LOG(LogTemp, Display, TEXT("WLSKY the moon is up"));
}

void UWonderlandDayCycleSubsystem::DressTheWater()
{
	UWorld* World = GetWorld();
	if (World == nullptr) { return; }

	// ---- WHY THE WATER LOOKED PLASTIC, measured rather than guessed.
	//
	// All 64 ponds, wells, canals and fountain basins share MI_V2_Water, whose master M_V2_Surface is
	// BLEND_OPAQUE and MSM_DEFAULT_LIT and exposes only TexScale, Roughness, RoughVary, Metallic, Specular and
	// EmissiveStrength. There is no refraction in it, no flow, no depth response and no translucency -- so NO
	// value of any parameter it has could ever have made it look wet. It is a shiny opaque solid, which is
	// exactly what the founder kept seeing.
	//
	// M_WL_RealWater is a new master, authored alongside it and never replacing it: translucent, two normal maps
	// panning at different rates so the ripples never line up again, a depth fade that makes the rim clear and
	// the middle deep, and refraction. Applied HERE, at runtime, so the level is never edited -- Wonderland's
	// Content is a shared junction and not durably tracked, and if this asset is ever missing the water simply
	// stays as it was.
	UMaterialInterface* Real = LoadObject<UMaterialInterface>(
		nullptr, TEXT("/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater"));
	if (Real == nullptr)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLWATER M_WL_RealWater is not present; the water is left as it was"));
		return;
	}

	WaterSurfaces.Reset();
	WaterDressed = 0;
	for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
	{
		UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
		if (Mesh == nullptr) { continue; }
		for (int32 Slot = 0; Slot < Mesh->GetNumMaterials(); ++Slot)
		{
			const UMaterialInterface* Worn = Mesh->GetMaterial(Slot);
			// MATCHED ON THE MATERIAL, NOT ON THE ACTOR'S NAME. Every water surface in the level wears
			// MI_V2_Water and nothing else does, so this cannot catch a basin's stone rim or a fountain's gold
			// finial by accident -- which a name like "court_fountainwater" very nearly would.
			if (Worn == nullptr || !Worn->GetName().Equals(TEXT("MI_V2_Water"), ESearchCase::IgnoreCase))
			{
				continue;
			}
			if (UMaterialInstanceDynamic* Wet = UMaterialInstanceDynamic::Create(Real, *It))
			{
				// NANITE WILL NOT DRAW TRANSLUCENCY, and says so rather than guessing:
				//
				//   Invalid material [MID_M_WL_RealWater_0] used on Nanite static mesh
				//   [WL_Water_Pavilion_water]. Only opaque or masked blend modes are currently
				//   supported, [BLEND_Translucent] blend mode was specified.
				//
				// Found in the editor log, not by any proof -- the material assignment below succeeds, and
				// a proof reading back which material a surface wears would agree that the water is wet.
				// The substitution happens at render time, downstream of everything a proof can see.
				//
				// The engine's own remedy is the one taken: this surface stops being a Nanite mesh. Water
				// basins are a few hundred triangles of flat plane, which is the case Nanite buys least on,
				// so the cost of dropping them out of it is close to nothing. Done per component and only
				// to surfaces this function just dressed, so nothing else in the level changes.
				Mesh->SetForceDisableNanite(true);
				Mesh->SetMaterial(Slot, Wet);
				WaterSurfaces.Add(Wet);
				++WaterDressed;
			}
		}
	}
	UE_LOG(LogTemp, Display, TEXT("WLWATER dressed %d surfaces in M_WL_RealWater"), WaterDressed);
}

void UWonderlandDayCycleSubsystem::ApplyStableShadows()
{
	ADirectionalLight* Light = Sun.Get();
	UDirectionalLightComponent* Comp = SunComponent(Light);
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
		ScaleGlowsForNight();
		// AND A REPAINT WHEN THE CLOCK IS STOPPED, so the sky knobs are live either way. A moving clock
		// repaints every frame on its own; a frozen one never would, and wl.Sky.MoonGain would then appear to
		// do nothing at the exact times anyone wants to look at it -- every night proof freezes the clock, and
		// so does anyone standing still to judge a sunset.
		if (HoursPerSecond <= 0.0f)
		{
			PaintTheSky();
		}
		if (ASkyLight* Light = Sky.Get())
		{
			if (USkyLightComponent* Comp = Light->GetLightComponent())
			{
				Comp->RecaptureSky();
			}
		}
	}
}

/**
 * HOW MUCH OF ITS DAYTIME GLOW A FIGURE KEEPS AT FULL NIGHT.
 *
 * Exposed because the right value is a judgement about how a lantern should look and was always going to be
 * found by sweeping it against photographs rather than derived. The derivation only sets the scale: night
 * opens the exposure by +1.45 EV and day closes it by -0.9, a ratio of 5.1, so a figure that kept ALL of its
 * glow after dark renders five times brighter on screen than the same figure at noon -- which is what
 * clipped the Dog to a white starburst.
 *
 * 0.20 WAS CHOSEN FROM THE SWEEP, NOT FROM THAT ARITHMETIC, which only set the scale to look in. Photographed
 * at 04:00 across four skins at 1.00, 0.55, 0.32 and 0.20: at 1.00 the companions are featureless white
 * blobs and the plaza behind them is lit to daylight; by 0.20 the crown, the pendant, the faces and the
 * bunny's markings are all back, the flower bed reads, the sky is dark, and every figure is still obviously
 * luminous. The measured ground brightness beside the Dog falls from 0.41 to 0.32 over the same sweep, which
 * is the emissive figures' Lumen contribution being handed back -- they were lighting the plaza.
 */
static float GWonderlandNightGlow = 0.20f;

/**
 * WHAT ACTUALLY LIGHTS THE NIGHT, now that the mascots have stopped doing it by accident.
 *
 * Correcting the emissive blow-out took the night from 0.207 world luma to 0.120 in one step, which passed
 * the "is it still night" gate and immediately failed the other one: four fifths of the frame fell below
 * 0.14, and a frame that is nearly all black is not a night, it is a failure to light one. The brightness
 * that went away was the Dog and its companions spilling Lumen onto the plaza, and that is not a light source
 * anyone designed -- it followed the player around and vanished when they changed skin.
 *
 * So the same brightness is put back where it belongs. These three are console variables for one reason: the
 * last four attempts on this number were each argued and each moved it by under 0.005, and the only progress
 * came from sweeping a knob inside a single session and photographing the result. See zc_night_lighting.
 *
 * THE SHAPE CAME FROM THE SWEEP AND THE CAPTURE; THE EXACT VALUES CAME FROM INTERPOLATING TWO GATE RUNS.
 *
 * Six settings were walked at 04:00 in one session, and at the top rung the plaza reads as moonlit teal with
 * the mushroom, the clock face, the paving and the flower beds all legible, the mascot standing in it as a
 * lantern with its crown and eyes visible, and the sky still black. That is the look these numbers are for.
 *
 * The two gates are a WINDOW and the sweep's own framing could not see it -- a parapet in the foreground put
 * its crushed fraction 0.08 above the gate's at identical settings. So the last step was measured with the
 * gate itself, twice: the old lighting gave 0.120 world luma at 0.81 crushed (too dark to be a night, though
 * it passed for one), the top rung gave 0.194 at 0.46 crushed (too bright beside the day). These sit 61% of
 * the way between, where the night is lit and still unmistakably night.
 *
 * A moon at 5% of noon sounds enormous beside a real one at a quarter of a lux, and would be, in a world
 * whose sun was also real.
 */
/**
 * HOW HARD A MASCOT'S EYES BURN AT NOON AND AT MIDNIGHT.
 *
 * FOUNDER: "Every mascot skin eyes have to be glowing even when its day time in wonderland."
 *
 * The eyes are the one emissive part that must not follow the rules the rest of the glow follows. In daylight
 * a 70,000 lux sun on ivory stone and an exposure closed nearly a stop flatten an authored emissive into a
 * painted-on square -- the eye stops reading as a light and starts reading as a colour. So it is driven ABOVE
 * its authored value exactly when the sky is brightest, on the inverse of the curve everything else uses.
 *
 * And at night it is brought down only a little. wl.Look.NightGlow cuts the body's glow five-fold to stop the
 * flames clipping, which is right for fire and wrong for eyes: they are how a Dog reads as alive and how its
 * status is shown, and going dark with the scenery is the one thing they must not do.
 *
 * THESE ARE LEVELS, NOT MULTIPLIERS. A multiplier was tried and could not serve five skins at once -- see
 * ApplyColourway.
 *
 * AND THEY HAVE TO BE READ AGAINST WHAT THE SKINS ALREADY AUTHOR, which is the mistake the first pass made:
 * 6.5 looked like a big number and is BELOW every skin in the lineup -- Relay OG authors its eyes at 7.0,
 * Arden and Apollo at 7.5, Skeleton Flame at 8.0 -- so setting that "level" changed nothing measurable on any
 * of them and the daylight problem was untouched. 18 is well clear of all five, and past the bloom threshold
 * by enough that an eye throws a coloured halo instead of merely being a bright square, which is what makes
 * it read as a lamp beside sunlit stone. Apollo is the skin that needs it: pale gold eyes set in gold
 * armour, where at the authored strength the eye cleared its own face by 0.03 at noon.
 *
 * 5.0 at midnight is still above four of the five authored strengths' effective night value, because the
 * body's glow around them has been cut five-fold and the eyes deliberately have not.
 *
 * ---- AND RAISING IT MAKES THE NIGHT EYES WORSE, WHICH IS WHY IT HAS NOT BEEN RAISED.
 *
 * The note above is wrong on its face and the contradiction is worth leaving visible: it argues that 6.5 "is
 * BELOW every skin in the lineup ... so setting that level changed nothing measurable", and the night value
 * beside it is 5.0, lower still. The obvious correction is to raise it. Swept at midnight across 5, 9, 13 and
 * 18 with the eye patch projected from the figure rather than guessed:
 *
 *     Relay OG    0.153 -> 0.095 -> 0.070 -> 0.078      (eye luma, and it FALLS)
 *     Arden, Apollo, Skeleton Flame   1.000 at every level, fully clipped throughout
 *     Celestial Light   0.88 / 0.85 / 0.88 / 0.90, flat
 *
 * The eyes get DIMMER as they are driven harder. That is auto-exposure doing its job: the measuring camera
 * stands 300 uu from the face, the eyes are most of what it can see, and a brighter emissive closes the iris
 * on the very thing being measured. Three of the five skins are already clipped at 1.0 and cannot go up at
 * all. So this control cannot buy night readability at close range, and the correction that looks obvious
 * from the arithmetic is measurably the wrong move.
 *
 * WHAT IS ACTUALLY TRUE, recorded rather than rounded up: the founder's stated requirement is daylight --
 * "eyes have to be glowing even when its day time" -- and at noon every skin passes with room (Relay OG
 * reads 0.591 against a face of 0.039). At night three skins blaze and Relay OG's warm gold reads lit but
 * dull, out-reading its visor 3.7x. Making that dull gold read as a lamp needs the eye's own authored
 * strength or its material raised on that one skin, not this global level, and that is art rather than a
 * constant -- so it is left for the founder rather than guessed at here.
 */
// 24, from the round-2 sheet: at 18 the core sat at ~0.7 of the 25,000 white, lit but flat, and nothing bloomed.
// 24 puts the core's centre at the white point by day, so the bloom pass (threshold 1.0) catches it and the eye
// gets the soft light around it that the founder asked for; the halo panes carry the coloured rim. Night stays
// at 8, which the night exposure opens to ~21,600 -- bright, coloured, under white.
static float GWonderlandEyeDayGlow = 24.0f;
static FAutoConsoleVariableRef GWonderlandEyeDayGlowRef(
	TEXT("wl.Look.EyeGlowDay"),
	GWonderlandEyeDayGlow,
	TEXT("The emissive level a mascot's eyes are driven to at noon (an absolute, not a multiplier)."),
	ECVF_Default);

// 8, not 5, now that the day level is really 18 rather than a clamped 12: the night exposure opens about 1.45 EV,
// so 8 renders near what 22 would by day -- a strong perceptual glow that stays under the white point.
static float GWonderlandEyeNightGlow = 8.0f;
static FAutoConsoleVariableRef GWonderlandEyeNightGlowRef(
	TEXT("wl.Look.EyeGlowNight"),
	GWonderlandEyeNightGlow,
	TEXT("The emissive level a mascot's eyes are driven to at midnight."),
	ECVF_Default);

/**
 * HOW HARD A FIGURE'S SHELL CATCHES A RIM AT MIDNIGHT.
 *
 * The mascot reads 0.074 luma against ground at 0.121 at 04:00 -- darker than the stone it stands on, with
 * 0.0476 of separation against a floor of 0.05. Reproduced across two runs, so it is a real reading rather
 * than noise, and the direction is what matters: a bone-white dog should not be the darker of the two.
 *
 * A console variable and not a literal because the right value is a look decision and this file has already
 * been bitten twice by numbers that were correct when written and stale a week later.
 */
static float GWonderlandNightRim = 2.6f;
static FAutoConsoleVariableRef GWonderlandNightRimRef(
	TEXT("wl.Look.NightRim"),
	GWonderlandNightRim,
	TEXT("How hard a figure's shell catches a rim light at midnight. 1 = the daylight amount."),
	ECVF_Default);

static float GWonderlandMoonGain = 0.050f;
static FAutoConsoleVariableRef GWonderlandMoonGainRef(
	TEXT("wl.Sky.MoonGain"),
	GWonderlandMoonGain,
	TEXT("The moon's intensity as a fraction of the noon sun."),
	ECVF_Default);

static float GWonderlandNightFill = 0.26f;
static FAutoConsoleVariableRef GWonderlandNightFillRef(
	TEXT("wl.Sky.NightFill"),
	GWonderlandNightFill,
	TEXT("The floor under the three fill lights after dark, as a fraction of their noon intensity."),
	ECVF_Default);

static float GWonderlandNightSky = 7.0f;

//: THE NIGHT SHADOW LIFT, and the founder's section A in one number.
//:
//: Their correction asks to raise the night illumination floor "without flattening contrast: dark sky, bright
//: practicals, cool moon ambient, deep but readable shadows." LOCAL EXPOSURE IS THE NAMED TOOL FOR EXACTLY
//: THAT and it was wired to nothing -- along with dynamic GI, reflections, shadow amount and ambient
//: occlusion, five of the eleven systems the founder listed had no code touching them anywhere in this
//: project. That is why nine combinations of moon, sky and practicals could not find a readable night: the
//: sweep was moving three levers out of eleven, and none of the three lifts a surface the moon does not
//: directly hit.
//:
//: Measured cost of that gap, on a character, with the figure's own lights excluded: the default Dog's BODY is
//: 97.1% crushed at deepest night with a mean of 0.054. A dark grey box with two glowing eyes -- the founder's
//: "glowing objects floating in blackness", photographed.
//:
//: Shadow contrast BELOW 1.0 lifts shadow detail and leaves highlights alone, which is the difference between
//: a readable night and a flat one. The engine's own guidance is 0.6 to 1.0. This is lerped by Nightfall, so
//: at Nightfall 0 it is exactly 1.0 -- the engine default, no effect -- and DAY IS PROVABLY UNTOUCHED.
//: HOW WIDE THE TWILIGHT BAND IS, IN DEGREES OF SUN ELEVATION -- and therefore how long evening lasts.
//:
//: THE FOUNDER'S ITEM 12 ASKS FOR "morning to afternoon to evening to night with no sudden jumps". What the
//: world does instead, read off this curve rather than guessed: Daylight = clamp((elevation + 9) / SPAN)^1.9
//: saturates at elevation 12, so with SPAN at its shipped 21 it reads EXACTLY 1.0 from 06:38 to 17:22 --
//: 10.7 hours of identical daylight -- and then falls the entire way to zero between 17:22 and 18:29. The
//: whole evening is 67 MINUTES. The day has no afternoon; it has a plateau and a cliff.
//:
//: Widening the band spreads that fall over more of the sun's arc:
//:
//:      span 21 (shipped)   flat 06:38-17:22 (10.7 h)   evening  67 min
//:      span 39             flat 07:38-16:22 ( 8.7 h)   evening 127 min
//:      span 49             flat 08:15-15:45 ( 7.5 h)   evening 163 min
//:
//: NOON IS UNCHANGED AT ANY VALUE, which is what makes this safe to sweep: at 72 degrees every band
//: saturates to 1.0, so the noon exposure bias stays at -0.9 and the other lane's eye tuning is untouched.
//: What moves is the late afternoon -- at 17:00 span 39 gives 0.52 of full daylight where span 21 gives 1.0.
//:
//: DEFAULTED TO THE SHIPPED 21 ON PURPOSE. This is a visible change to every afternoon in the world and it
//: has not been measured or looked at yet. Today has produced enough evidence that a number which looks
//: right is not a number that has been checked; 39 is the recommendation and the default stays 21 until the
//: ladder and a photograph agree.
static float GWonderlandTwilightSpan = 21.0f;
static FAutoConsoleVariableRef GWonderlandTwilightSpanRef(
	TEXT("wl.Sky.TwilightSpan"),
	GWonderlandTwilightSpan,
	TEXT("Degrees of sun elevation the day-to-night transition is spread over. 21 is shipped and gives a "
		 "67-minute evening after 10.7 flat hours; 39 gives a 127-minute evening after 8.7. Noon is "
		 "identical at any value."),
	ECVF_Default);

//: 0.62 RATHER THAN 0.65, and it is measured rather than chosen. The other lane's ladder on the corrected
//: build, reading relay_og's BODY with the figure's own lights excluded, at the checkpoint court:
//:
//:      lift 0.70   body 67.7% crushed   ground 90.2% dark
//:      lift 0.65   body 30.0%           ground 62.9%
//:      lift 0.62   body 22.0%           ground 36.7%      <- here
//:      lift 0.58   body 19.2%           ground 11.2%
//:
//: Against the 57.6% crushed of the night the founder REJECTED, 0.62 does better than halve it. 0.58 buys
//: almost nothing more on the body and takes the ground to 11.2% dark, which is the wash -- my own tails
//: measure agrees independently, since a vanished dark tail is exactly what "do not wash the world in flat
//: brightness" rules out. Two measures, two mechanisms, the same rung.
static float GWonderlandNightShadowLift = 0.62f;
static FAutoConsoleVariableRef GWonderlandNightShadowLiftRef(
	TEXT("wl.Look.NightShadowLift"),
	GWonderlandNightShadowLift,
	TEXT("Local-exposure shadow contrast at FULL night. 1.0 is the engine default and lifts nothing; lower "
		 "lifts shadow detail without touching highlights. Engine guidance is 0.6-1.0. Day is unaffected at "
		 "any value, because this is interpolated by Nightfall."),
	ECVF_Default);
static FAutoConsoleVariableRef GWonderlandNightSkyRef(
	TEXT("wl.Sky.NightSky"),
	GWonderlandNightSky,
	TEXT("How hard the sky light is driven at midnight, relative to its daytime capture."),
	ECVF_Default);
static FAutoConsoleVariableRef GWonderlandNightGlowRef(
	TEXT("wl.Look.NightGlow"),
	GWonderlandNightGlow,
	TEXT("How much of its daytime glow a mascot keeps at full night. 1 = no correction (blows out)."),
	ECVF_Default);

void UWonderlandDayCycleSubsystem::PaintTheSky()
{
	ADirectionalLight* Light = Sun.Get();
	UDirectionalLightComponent* Comp = SunComponent(Light);
	if (Comp == nullptr) { return; }

	const float Elevation = ElevationAt(Hour);
	// ---- THE SUN ITSELF. Pitch is negative downward in Unreal, so an elevation above the horizon is a
	// ---- negative pitch: the light points DOWN at the world from up there.
	Light->SetActorRotation(FRotator(-Elevation, BearingAt(Hour), 0.0f));

	// DUSK IS NOT A SWITCH, and this term is the only place that decides. Every value below is driven from
	// Daylight -- the sun's intensity and colour, the three fills, the fog colour, the water colour and the
	// exposure bias -- so the shape of this one curve IS the shape of the transition.
	//
	// MEASURED, 2026-09-24 (zc_day_cycle): it used to read Clamp(Elevation / 12), which is zero everywhere
	// below the horizon, and the readback showed the consequence exactly -- 54,821 lux at +9.4 deg, then 280
	// lux at -3.8 deg. The sun crossed the horizon and took the whole sky with it between two frames, so
	// "evening" did not exist: it was afternoon, and then it was midnight.
	//
	// The band now opens at -9 deg, a little past civil twilight, so the light keeps falling for the half hour
	// after sunset the way it does outdoors. The exponent is what keeps the horizon reading as EVENING rather
	// than as a dimmer afternoon: at 0 deg it lands near a fifth of noon, not the two fifths a straight line
	// would give.
	const float TwilightBand = FMath::Clamp(
		(Elevation + 9.0f) / FMath::Max(GWonderlandTwilightSpan, 1.0f), 0.0f, 1.0f);
	const float Daylight = FMath::Pow(TwilightBand, 1.9f);

	// HOW FAR INTO THE NIGHT WE ARE: 0 while the sun is still up, 1 once it is well down. Smoothstepped,
	// because this is what crossfades the sun out and the moon in and the founder asked for no jumps.
	//
	// IT IS NOW THE COMPLEMENT OF THE BAND ABOVE, AND THAT IS THE WHOLE FIX. It used to be
	// Clamp((-Elevation - 2)/10) -- a SECOND curve, on the same input, with its own window. Two curves kept
	// in sync by hand, and they were not in sync: Daylight leaves 1.0 at +12 deg and reaches 0 at -9, while
	// Nightfall did not start until -2. Between them they left a hole.
	//
	// MEASURED AT THE BOTTOM OF IT, 2026-09-27 (zzT2_dusk_hole). At 18:00 the elevation is EXACTLY ZERO:
	// Daylight had already fallen to 0.1999 while Nightfall was still exactly 0.0000. So at the darkest hour
	// of the day the moon was invisible (it needs Nightfall > 0.002), NightShadowLift was not applied (it is
	// lerped by Nightfall), local exposure was off (it needs Nightfall > 0.001), the exposure bias was +0.98
	// of its eventual +1.45, and EVERY PRACTICAL LIGHT IN WONDERLAND WAS AT ZERO INTENSITY, because their
	// brightness is Candelas * GetNightAmount() * Gain and GetNightAmount returns this value. The day rig had
	// left and the night rig had not arrived.
	//
	// The world read 0.0365 there against 0.0937 an hour LATER -- darker at six in the evening than at full
	// night -- with ground at 0.0126 and 97 per cent of pixels in the tails. The photographs are not subtle:
	// at 18:00 the paving, the gate, the ironwork and the planting are simply absent; at 19:00 they all read.
	//
	// AND IT EXPLAINS WHY WIDENING THE BAND MADE THINGS WORSE. zzT1 swept wl.Sky.TwilightSpan at 21/30/39
	// expecting a gentler evening and got the opposite -- worst hour-to-hour step 0.0995 -> 0.1353 -> 0.1812
	// -- because a wider band raised the shoulder the world fell FROM without moving the curve that decides
	// when it lands. Two independent curves cannot be widened by one knob.
	//
	// As the complement they are one crossover by construction and cannot separate again at any span. Full
	// day is untouched: at +12 deg and above the band is 1, so this is exactly 0 and every noon proof stands.
	// The twilight SHOULDERS do change -- at +9.4 deg, which is 17:50 and symmetrically 06:50, this becomes
	// 0.042 where it was 0 -- and that is the intended behaviour rather than a side effect: the night should
	// begin arriving while the sun is visibly going down. The other lane owns the eye glow, rim and mascot
	// that read this value and signed off on that shoulder after seeing the whole ramp, not just its start.
	const float Sinking = 1.0f - TwilightBand;
	Nightfall = Sinking * Sinking * (3.0f - 2.0f * Sinking);

	// THE SUN STOPS SHINING UP THROUGH THE GROUND. Pitch is -Elevation, so a sun 40 degrees below the horizon is
	// a light pointing UPWARD at the world, and the old flat 0.4%-of-noon floor kept it doing that all night --
	// the one directional light in Wonderland, lighting every underside and nothing else. It is faded out with
	// the same curve the moon comes up on, leaving only enough for the SkyAtmosphere to keep a sky.
	// 84 LUX AT FULL NIGHT, and it stays: the sun keeps casting all the way round, so below the horizon the
	// ground occludes almost all of this and what is left is the faint sky the SkyAtmosphere needs to not be
	// black. Dropping it to 14 was tried while chasing a brightness lift that turned out to be elsewhere, and
	// it changed the night by 0.003.
	const float SunFloor = 0.004f * (1.0f - Nightfall) + 0.0012f * Nightfall;
	Comp->SetIntensity(FMath::Max(SunIntensityAtNoon * Daylight, SunIntensityAtNoon * SunFloor));
	Comp->SetLightColor(FMath::Lerp(FLinearColor(0.42f, 0.55f, 0.95f, 1.0f), SunColourAt(Elevation), Daylight));

	// ---- AND THE MOON RISES, OPPOSITE IT. Same bearing plus half a turn and the elevation mirrored, which is
	// ---- where a full moon actually stands: highest at midnight, setting as the sun comes up. So the night is
	// ---- lit from ABOVE, with its own shadows, and the ground, the paths and the architecture read as shapes.
	if (ADirectionalLight* MoonLight = Moon.Get())
	{
		if (UDirectionalLightComponent* MoonComp = SunComponent(MoonLight))
		{
			MoonLight->SetActorRotation(FRotator(Elevation, BearingAt(Hour) + 180.0f, 0.0f));
			// A FIFTIETH OF NOON. Bright enough that the founder can see the Dog, the paving under it and the
			// silhouette of a tower; nowhere near enough to be mistaken for daylight. Tuned against photographs
			// of the darkest hour rather than chosen, and it is the one number to move if night reads wrong.
			const float MoonLux = SunIntensityAtNoon * GWonderlandMoonGain * Nightfall;
			MoonComp->SetIntensity(MoonLux);
			// OFF WHEN IT IS NOT NEEDED, so daytime pays nothing at all for a second shadow-casting light.
			MoonComp->SetVisibility(Nightfall > 0.002f);

			// ---- AND ONLY ONE OF THEM EVER CASTS A SHADOW.
			//
			// FOUNDER, P2 item 11, among the shadow faults to fix: "conflicting lights." Adding a moon added
			// exactly that, and zc_shadows S01 caught it -- two directional shadow casters in the world at
			// once. They are not both bright at once for long, but through dusk and dawn the sun is still
			// worth thousands of lux BELOW the horizon while the moon is climbing on the OPPOSITE bearing, so
			// for those minutes every object in Wonderland would throw two shadows crossing each other.
			//
			// Whichever is actually brighter casts, and the other does not. The handover happens where the two
			// curves cross, which is the one instant at which swapping is invisible -- and the flag is only
			// written when it CHANGES, because setting it every frame would dirty the render state of the
			// scene's main light sixty times a second for nothing.
			// ONLY THE MOON'S FLAG IS EVER TOUCHED, and that is a correction.
			//
			// The first version of this gate also switched the SUN off as a caster whenever the moon took
			// over, which is the symmetrical-looking thing to do and was wrong: measured across the whole
			// cycle, dusk went from 0.103 to 0.191 and the entire night lifted by half again. The sun is the
			// ATMOSPHERE light -- Lumen and the SkyAtmosphere are both wired to it -- and taking its shadows
			// away changes how the world is lit globally, not just what it casts. Two further attempts to find
			// the lift elsewhere (the sub-horizon fill, then the checkpoint lamps) each moved the number by
			// under 0.005, which is how it was narrowed to this.
			//
			// The moon alone is enough for the founder's clause. It is the newcomer, it is the one that can
			// disagree with the sun, and switching it off while the sun is brighter means the world never has
			// two directional shadow casters at once -- which is all "no conflicting lights" asks.
			const bool bMoonShouldCast = MoonLux > Comp->Intensity;
			if (MoonComp->CastShadows != bMoonShouldCast)
			{
				MoonComp->CastShadows = bMoonShouldCast;
				MoonComp->MarkRenderStateDirty();
			}
		}
	}

	// ---- THE FILLS GO WITH IT. Bounced ground light and canopy fill are daylight effects; leaving them at
	// ---- full strength through the night is what makes a night scene look like a day scene with a dark sky.
	for (int32 Index = 0; Index < Fills.Num(); ++Index)
	{
		ADirectionalLight* Fill = Fills[Index].Get();
		UDirectionalLightComponent* FillComp = SunComponent(Fill);
		if (FillComp == nullptr || !FillIntensities.IsValidIndex(Index)) { continue; }
		// A LITTLE MORE THAN BEFORE, AND COLD. 0.06 of a daylight bounce is nearly nothing, and it was the only
		// fill the night had. At 0.15, tinted to moonlight, it is the soft floor that keeps the ground around
		// the player readable where the moon's own shadows fall -- which is the founder's second requirement,
		// after seeing the Dog itself.
		FillComp->SetIntensity(FillIntensities[Index] * FMath::Max(Daylight, GWonderlandNightFill));
		FillComp->SetLightColor(FMath::Lerp(FLinearColor(0.38f, 0.48f, 0.82f, 1.0f), FLinearColor::White, Daylight));
	}

	// ---- THE AMBIENT THE SUN NEVER REACHES. The sky light is captured from the sky itself, so at midnight it
	// ---- captures a nearly black dome and contributes nothing -- which is why shadowed sides of buildings went
	// ---- to pure black. Raising its gain at night lifts that floor WITHOUT flattening anything, because what
	// ---- it is lifting is the night sky's own colour and not a grey wash.
	if (ASkyLight* Ambient = Sky.Get())
	{
		if (USkyLightComponent* SkyComp = Ambient->GetLightComponent())
		{
			SkyComp->SetIntensity(SkyIntensityByDay * FMath::Lerp(GWonderlandNightSky, 1.0f, Daylight));
		}
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

	// ---- THE WATER GOES WITH THE SKY. Water is mostly what it reflects, so a pond that stays noon-blue at
	// ---- dusk is the loudest thing in a night scene.
	for (const TWeakObjectPtr<UMaterialInstanceDynamic>& Weak : WaterSurfaces)
	{
		UMaterialInstanceDynamic* Wet = Weak.Get();
		if (Wet == nullptr) { continue; }
		const FLinearColor Daylit = SunColourAt(Elevation);
		Wet->SetVectorParameterValue(TEXT("ShallowColor"),
			FMath::Lerp(FLinearColor(0.03f, 0.06f, 0.11f, 1.0f), FLinearColor(0.16f, 0.42f, 0.44f, 1.0f) * Daylit, Daylight));
		Wet->SetVectorParameterValue(TEXT("DeepColor"),
			FMath::Lerp(FLinearColor(0.01f, 0.02f, 0.05f, 1.0f), FLinearColor(0.02f, 0.10f, 0.16f, 1.0f), Daylight));
	}

	// ---- AND THE EYE ADJUSTS. Opened at night and closed at noon, by a stop and a half either way, so the
	// ---- founder can still read the garden at midnight without noon becoming milky.
	if (APostProcessVolume* Volume = Grade.Get())
	{
		// ---- CLOSED FURTHER AT NOON (founder, 2026-09-25): "the lighting is too bright and washed out.
		// Reduce glare, bloom, and overexposure so the mascot skins are clearly visible. The same applies to
		// the AI Agent companions and LLM companions."
		//
		// Was Lerp(1.5, -0.4): about a third of a stop closed at noon, which is not enough against a
		// 70,000 lux sun falling on ivory stone. Now nearly a stop and a third. Night is brought down a
		// little too, because the old +1.5 was lifting midnight far enough to grey it.
		Volume->Settings.bOverride_AutoExposureBias = true;
		// PULLED BACK FROM -1.3 AFTER MEASURING. The first pass closed the world nearly a stop and a third
		// and the guard caught it: the plaza went dark while the luminous skins stayed blown, because the
		// glare was never the sun -- it was figures emitting up to 32,000x white. That is now compressed at
		// its source (WonderlandTameGlow), so the world only needs the modest close it always did.
		// NIGHT OPENS A LITTLE FURTHER, 1.2 -> 1.45, and no further than that ON PURPOSE. Exposure is the one
		// tool here that CANNOT make night readable without also making it flat, which is exactly what the
		// founder ruled out ("do not simply wash the world in flat brightness"). The readability comes from the
		// moon, the fills and the sky light above; this is a quarter stop of help, not the mechanism.
		Volume->Settings.AutoExposureBias = FMath::Lerp(1.45f, -0.9f, Daylight);

		// ---- AND THE GLARE ITSELF, which is the half exposure cannot fix.
		//
		// Bloom was never overridden here, so it ran at the engine's default 0.675 with a threshold of -1 --
		// and a threshold of -1 means EVERYTHING blooms, including plain lit stone at 0.8. That is precisely
		// what "washed out" looks like: a white haze lifted off every bright surface, flattening the skins
		// and the companions into it.
		//
		// A THRESHOLD OF 1.0 IS THE WHOLE POINT, AND IT IS WHY THE FLAMES SURVIVE. Only pixels brighter than
		// white bloom now. Lit stone, cloth and voxel skins sit below that and stop hazing; the flames,
		// Celestial Light and the glow parts are emissive at thousands of times white (DogGlowExposure is
		// 4000) and are nowhere near the threshold -- they bloom exactly as they did. The founder asked for
		// the flame quality to be kept, and this removes haze from everything EXCEPT the things that glow.
		Volume->Settings.bOverride_BloomIntensity = true;
		Volume->Settings.BloomIntensity = 0.34f;
		Volume->Settings.bOverride_BloomThreshold = true;
		Volume->Settings.BloomThreshold = 1.0f;

		// ---- THE SHADOW FLOOR, which is the half that neither exposure nor the moon can reach.
		//
		// The comment above says exposure cannot make night readable without making it flat, and that is
		// true of GLOBAL exposure -- it moves the whole frame. Local exposure does not: it lifts shadow
		// detail and leaves highlights where they are. That is the founder's "deep but readable shadows"
		// exactly, and it is the tool their correction names.
		//
		// AT NIGHTFALL 0 THIS IS 1.0, the engine default and a no-op, so the day this session was told not to
		// touch is untouched by construction rather than by intention. Highlights are pinned at 1.0 at every
		// hour on purpose: the practicals and the figures' own glow must stay as bright against the dark as
		// they are now, because the founder asked for bright practicals and a dark sky, not for both to meet
		// in the middle.
		// SWITCHED OFF ENTIRELY BY DAY, not merely set to a neutral value.
		//
		// The first version enabled these overrides at EVERY hour and made the day harmless by lerping the
		// contrast to 1.0 -- numerically a no-op, and I called the day "untouched by construction". It is
		// not: bOverride_LocalExposureMethod = true ENABLES THE FEATURE, and local exposure is a bilateral
		// decomposition that runs on the RENDER THREAD whether or not its contrast happens to be neutral.
		// A no-op value is not a no-op pass.
		//
		// WHY THIS IS A SUSPECT AND NOT A CERTAINTY. The other lane's instrumented ladder reads 389.5 ms
		// with NO avatars at all, 19 ms game and 21 ms GPU -- five per cent of the frame accounted for --
		// on a world that read 38.71 ms this morning. Foreground is true at every rung, so the editor's
		// background throttle is ruled out. Game and GPU are small, so the render thread is the only thread
		// left, and stat unit reports it as 0.0 through that accessor. A render-thread post-process pass
		// that I switched on today, for the first time in this project, is the candidate that fits: it
		// appeared today, it is avatar-independent, and it is on the one thread nobody can see.
		//
		// It is NOT proven. The machine has 2.48 GB free of 15.7 with three sessions and builds sharing it,
		// and sustained paging produces the same signature. This is the cheap half of the disjunction to
		// eliminate, and eliminating it costs nothing at night because Nightfall is 0 by day anyway.
		const bool bWantLocalExposure = Nightfall > 0.001f;
		Volume->Settings.bOverride_LocalExposureMethod = bWantLocalExposure;
		Volume->Settings.bOverride_LocalExposureShadowContrastScale = bWantLocalExposure;
		Volume->Settings.bOverride_LocalExposureHighlightContrastScale = bWantLocalExposure;
		if (bWantLocalExposure)
		{
			Volume->Settings.LocalExposureMethod = ELocalExposureMethod::Bilateral;
			Volume->Settings.LocalExposureShadowContrastScale =
				FMath::Lerp(1.0f, FMath::Clamp(GWonderlandNightShadowLift, 0.2f, 1.0f), Nightfall);
			Volume->Settings.LocalExposureHighlightContrastScale = 1.0f;
		}
	}

	// ---- AND WHAT THE EXPOSURE DOES TO THINGS THAT MAKE THEIR OWN LIGHT.
	//
	// THE BUG THIS FIXES, PHOTOGRAPHED AT 04:00: the Relay Dog was a featureless white starburst with two
	// eyes just visible inside it, and it had been read three times as "the night is too bright" and chased
	// through the shadow gate, the sub-horizon sun fill and the territory lamps -- each of which was argued
	// rather than tested, and each of which moved the number by under 0.005. Hiding every candidate one at a
	// time in one PIE session found none of them; the capture found it in a second.
	//
	// WHY IT HAPPENS. Exposure is a property of the camera, not of the surface, so the +1.45 EV that makes a
	// dark world readable multiplies emissive pixels by the same 2.7 it applies to lit ones. A lit surface
	// can afford that because the sun stopped feeding it hours ago; an emissive surface never dimmed in the
	// first place, so it arrives at the tonemapper already bright and leaves it clipped.
	//
	// So the glow is brought down by the clock, at the source, in the same pass that opens the exposure --
	// which also means the flames, Celestial Light's starlight and the Skeleton's ghostfire all stop blowing
	// out after dark without anything being said about them individually. The wardrobe's preview figure is
	// exempt: see AWonderlandCompanionEmbodiment::SetExposureAware.
	ScaleGlowsForNight();
}

void UWonderlandDayCycleSubsystem::ScaleGlowsForNight()
{
	UWorld* const Here = GetWorld();
	if (Here == nullptr)
	{
		return;
	}
	// EVERY HALF SECOND AS WELL AS ON EVERY REPAINT, because the two things this has to catch arrive by
	// different routes. A moving clock repaints; a FROZEN one does not, and a skin worn at four in the
	// morning -- which is exactly what the fire and wardrobe proofs do -- would otherwise arrive at full
	// daytime glow and blow out with nothing to correct it. SetNightGlow early-outs unless the value actually
	// moved, so the steady state costs one iteration and no repaints.
	const float Keep = FMath::Clamp(FMath::Lerp(1.0f, GWonderlandNightGlow, Nightfall), 0.05f, 1.0f);
	// THE EYES GO THE OTHER WAY. Brightest when the sky is, which is the opposite of everything else here.
	// CLAMPED AT 30, NOT 12. wl.Look.EyeGlowDay has defaulted to 18 since it was written and this clamp held it
	// at 12 the whole time, so every "eye level" ever measured was 12 and every sweep above it read a flat
	// line. The configured value is now the value.
	const float Eyes = FMath::Clamp(
		FMath::Lerp(GWonderlandEyeDayGlow, GWonderlandEyeNightGlow, Nightfall), 0.05f, 30.0f);
	// AND THE SHELL GETS AN EDGE AFTER DARK. See AWonderlandCompanionEmbodiment::SetRimBoost: at the darkest
	// hour the mascot measured DARKER than the ground it stands on, and neither the moon nor the fill can fix
	// that because both light a horizontal ground more than a standing figure.
	const float Rim = FMath::Clamp(FMath::Lerp(1.0f, GWonderlandNightRim, Nightfall), 1.0f, 6.0f);
	// AND THE DOG ITSELF. Relay OG in gameplay is the Blueprint's meshes, not a figure; until 2026-09-27 this
	// loop never reached the eyes the founder actually looks at.
	for (TActorIterator<ARelayDogCharacter> Dog(Here); Dog; ++Dog)
	{
		Dog->SetEyeGlow(Eyes);
	}
	for (TActorIterator<AWonderlandCompanionEmbodiment> It(Here); It; ++It)
	{
		It->SetNightGlow(Keep);
		It->SetEyeGlow(Eyes);
		It->SetRimBoost(Rim);
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
	const UDirectionalLightComponent* Comp = SunComponent(Light);
	return FString::Printf(
		TEXT("hour=%.2f elevation=%.1f intensity=%.0f cascades=%d shadowDistance=%.0f exposureBias=%.2f fills=%d"),
		Hour, ElevationAt(Hour),
		Comp != nullptr ? Comp->Intensity : -1.0f,
		Comp != nullptr ? Comp->DynamicShadowCascades : -1,
		Comp != nullptr ? Comp->DynamicShadowDistanceMovableLight : -1.0f,
		Grade.IsValid() ? Grade->Settings.AutoExposureBias : 0.0f,
		Fills.Num()) + FString::Printf(TEXT(" water=%d"), WaterDressed);
}

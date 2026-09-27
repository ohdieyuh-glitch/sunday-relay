#include "WonderlandPracticalLights.h"

#include "Components/PointLightComponent.h"
#include "Engine/PointLight.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "WonderlandDayCycle.h"

// ---- THE BUDGET, AS CONSOLE VARIABLES, so it can be swept against a frame time rather than guessed.
static float GWonderlandPracticalGain = 1.0f;
static FAutoConsoleVariableRef GWonderlandPracticalGainRef(
	TEXT("wl.Look.PracticalGain"), GWonderlandPracticalGain,
	TEXT("Scales every practical light at once. 1 = the candelas the data file asks for."), ECVF_Default);

static int32 GWonderlandPracticalCount = 48;
static FAutoConsoleVariableRef GWonderlandPracticalCountRef(
	TEXT("wl.Look.PracticalCount"), GWonderlandPracticalCount,
	// THIS TEXT DESCRIBED THE OLD BEHAVIOUR FOR TWO COMMITS AFTER IT CHANGED, and a teammate reading it
	// formed a diagnosis from it and was about to rewrite a sort that had already been rewritten. A stale
	// help string is not a cosmetic defect; it is a false statement the engine hands out on request.
	TEXT("How many practicals may be lit at once. The pool is spent on the lights that carry the district: "
	     "one containing the player first, then by significance (candelas x radius), with distance only as "
	     "a tiebreak -- NOT the nearest N. Takes effect on wl.Look.PracticalReload, which rebuilds the pool; "
	     "setting this alone changes the number and leaves the pool at its previous size."), ECVF_Default);

static float GWonderlandPracticalRadius = 12000.0f;
static FAutoConsoleVariableRef GWonderlandPracticalRadiusRef(
	TEXT("wl.Look.PracticalRadius"), GWonderlandPracticalRadius,
	TEXT("Beyond this distance from the player a practical is never lit, whatever the count allows."), ECVF_Default);

static FAutoConsoleCommandWithWorld GWonderlandPracticalReload(
	TEXT("wl.Look.PracticalReload"),
	TEXT("Re-read WorldDesign/Look/practical_lights.json and rebuild the lights."),
	FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
	{
		if (World != nullptr)
		{
			if (UWonderlandPracticalLightsSubsystem* Sub = World->GetSubsystem<UWonderlandPracticalLightsSubsystem>())
			{
				Sub->Reload();
			}
		}
	}));

bool UWonderlandPracticalLightsSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	// Game worlds only, like the day cycle: an editor preview world has no night to light.
	const UWorld* World = Cast<UWorld>(Outer);
	return World != nullptr && World->IsGameWorld();
}

void UWonderlandPracticalLightsSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	FilePath = FPaths::Combine(FPaths::ProjectDir(), TEXT("WorldDesign"), TEXT("Look"), TEXT("practical_lights.json"));
	Reload();
}

void UWonderlandPracticalLightsSubsystem::Deinitialize()
{
	for (APointLight* Light : Pool)
	{
		if (IsValid(Light))
		{
			Light->Destroy();
		}
	}
	Pool.Reset();
	Assigned.Reset();
	Super::Deinitialize();
}

void UWonderlandPracticalLightsSubsystem::Reload()
{
	Defined.Reset();
	LoadProblem.Reset();
	if (!LoadFile(LoadProblem))
	{
		UE_LOG(LogTemp, Warning, TEXT("WLLIGHT practicals not loaded: %s"), *LoadProblem);
	}
	BuildPool();
	LastNight = -1.0f;   // force a re-assign and re-intensity on the next tick
	SinceAssign = 1.0f;
	UE_LOG(LogTemp, Display, TEXT("WLLIGHT %d practicals defined, pool of %d"), Defined.Num(), Pool.Num());
}

bool UWonderlandPracticalLightsSubsystem::LoadFile(FString& OutProblem)
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *FilePath))
	{
		OutProblem = FString::Printf(TEXT("could not read %s"), *FilePath);
		return false;
	}
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		OutProblem = TEXT("not valid JSON");
		return false;
	}
	const TArray<TSharedPtr<FJsonValue>>* Lights = nullptr;
	if (!Root->TryGetArrayField(TEXT("lights"), Lights) || Lights == nullptr)
	{
		OutProblem = TEXT("no 'lights' array");
		return false;
	}
	for (const TSharedPtr<FJsonValue>& Value : *Lights)
	{
		const TSharedPtr<FJsonObject> Obj = Value.IsValid() ? Value->AsObject() : nullptr;
		if (!Obj.IsValid())
		{
			continue;
		}
		FWonderlandPracticalLight Light;
		Light.Location = FVector(Obj->GetNumberField(TEXT("x")), Obj->GetNumberField(TEXT("y")), Obj->GetNumberField(TEXT("z")));
		Light.Colour = FLinearColor(
			static_cast<float>(Obj->HasField(TEXT("r")) ? Obj->GetNumberField(TEXT("r")) : 1.0),
			static_cast<float>(Obj->HasField(TEXT("g")) ? Obj->GetNumberField(TEXT("g")) : 0.78),
			static_cast<float>(Obj->HasField(TEXT("b")) ? Obj->GetNumberField(TEXT("b")) : 0.5), 1.0f);
		Light.Candelas = static_cast<float>(Obj->HasField(TEXT("cd")) ? Obj->GetNumberField(TEXT("cd")) : 12.0);
		Light.RadiusUU = static_cast<float>(Obj->HasField(TEXT("radius")) ? Obj->GetNumberField(TEXT("radius")) : 900.0);
		Light.SourceRadiusUU = static_cast<float>(Obj->HasField(TEXT("source")) ? Obj->GetNumberField(TEXT("source")) : 12.0);
		Obj->TryGetStringField(TEXT("label"), Light.Label);
		Defined.Add(Light);
	}
	return true;
}

void UWonderlandPracticalLightsSubsystem::BuildPool()
{
	UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return;
	}
	const int32 Want = FMath::Clamp(FMath::Min(GWonderlandPracticalCount, Defined.Num()), 0, 256);
	while (Pool.Num() > Want)
	{
		if (APointLight* Light = Pool.Pop())
		{
			Light->Destroy();
		}
	}
	while (Pool.Num() < Want)
	{
		FActorSpawnParameters Params;
		Params.ObjectFlags |= RF_Transient;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		APointLight* Light = World->SpawnActor<APointLight>(APointLight::StaticClass(), FTransform::Identity, Params);
		if (Light == nullptr)
		{
			break;
		}
		Light->SetMobility(EComponentMobility::Movable);
#if WITH_EDITOR
		Light->SetActorLabel(FString::Printf(TEXT("WL_Practical_%02d"), Pool.Num()), false);
#endif
		if (UPointLightComponent* Comp = Light->PointLightComponent)
		{
			// NO SHADOWS. A street lamp that casts is the single most expensive thing a point light can be,
			// and the founder asked for the city to be lit, not for the mortar to be read at midnight.
			Comp->SetIntensityUnits(ELightUnits::Candelas);
			Comp->SetIntensity(0.0f);
			Comp->SetCastShadows(false);
			Comp->bUseInverseSquaredFalloff = true;
			Comp->SetAttenuationRadius(900.0f);
			Comp->SetVisibility(false);
			Comp->MarkRenderStateDirty();
		}
		Pool.Add(Light);
	}
	Assigned.Init(INDEX_NONE, Pool.Num());
}

void UWonderlandPracticalLightsSubsystem::Assign()
{
	UWorld* World = GetWorld();
	if (World == nullptr || Pool.Num() == 0)
	{
		ActiveCount = 0;
		return;
	}
	FVector Eye = FVector::ZeroVector;
	if (const APlayerController* PC = UGameplayStatics::GetPlayerController(World, 0))
	{
		if (const APawn* Pawn = PC->GetPawn())
		{
			Eye = Pawn->GetActorLocation();
		}
		else
		{
			FRotator Unused;
			PC->GetPlayerViewPoint(Eye, Unused);
		}
	}
	// DISTANCE IS THE CUTOFF. SIGNIFICANCE IS THE RANKING. The founder's correction asks for
	// "distance/significance activation" and this used distance for both, which spends the pool on the
	// lights least able to be seen.
	//
	// MEASURED AT THE TARTARUS AVENUE DIP, 2026-09-27, after the light set went from 970 to 1355: 119
	// definitions sat inside the 120 m radius, the pool of 48 reached only 53 m, and THIRTY OF THE FORTY-EIGHT
	// were 1.8-2.0 candela facade dabs with a 250 uu attenuation radius -- lights that illuminate two and a
	// half metres of wall. Ten of twenty-eight road lamps in range made the pool. At the market, twenty-eight
	// of forty-eight were facade. The before/after of a whole new lamp layer was 0.0323 to 0.0325: unchanged
	// to four decimals, because the lamps that would have shown were ranked out by dabs behind the player.
	//
	// This got urgent because of a fix of mine: 388 fixtures that had been silently throwing nothing are now
	// lit, and most of them are low-candela wall lanterns. The pool had never been under this pressure.
	//
	// TWO RULES, BOTH ANSWERING A THING THE FOUNDER ASKED FOR.
	//
	// 1. A LIGHT WHOSE OWN RADIUS CONTAINS THE PLAYER IS NEVER DROPPED. A 2.5 m dab is worthless five metres
	//    away and is the only thing lighting the ground when you are standing under it -- which is the
	//    founder's "cannot see where to put your foot". Pure significance ordering would drop exactly those.
	// 2. OTHERWISE, RANK BY REACH x STRENGTH (candelas times attenuation radius), nearest first on a tie. An
	//    11 candela road lamp forty metres ahead lights the road being walked towards; a dab behind the
	//    player does not, however close it is.
	//
	// The cvars keep their meaning: PracticalRadius is still the hard cutoff, PracticalCount still the pool.
	const float Radius2 = GWonderlandPracticalRadius * GWonderlandPracticalRadius;
	struct FCandidate
	{
		float DistSq = 0.0f;
		float Significance = 0.0f;
		bool bContainsPlayer = false;
		int32 Index = INDEX_NONE;
	};
	TArray<FCandidate> Near;
	Near.Reserve(Defined.Num());
	for (int32 Index = 0; Index < Defined.Num(); ++Index)
	{
		const FWonderlandPracticalLight& Def = Defined[Index];
		const float D2 = static_cast<float>(FVector::DistSquared2D(Def.Location, Eye));
		if (D2 > Radius2)
		{
			continue;
		}
		FCandidate C;
		C.DistSq = D2;
		C.Significance = FMath::Max(Def.Candelas, 0.0f) * FMath::Max(Def.RadiusUU, 0.0f);
		C.bContainsPlayer = D2 <= Def.RadiusUU * Def.RadiusUU;
		C.Index = Index;
		Near.Emplace(MoveTemp(C));
	}
	Near.Sort([](const FCandidate& A, const FCandidate& B)
	{
		if (A.bContainsPlayer != B.bContainsPlayer)
		{
			return A.bContainsPlayer;          // standing inside it beats everything
		}
		if (!FMath::IsNearlyEqual(A.Significance, B.Significance))
		{
			return A.Significance > B.Significance;
		}
		return A.DistSq < B.DistSq;
	});
	const int32 Lit = FMath::Min(Near.Num(), Pool.Num());
	ActiveCount = Lit;
	for (int32 Slot = 0; Slot < Pool.Num(); ++Slot)
	{
		APointLight* Light = Pool[Slot];
		if (!IsValid(Light))
		{
			continue;
		}
		UPointLightComponent* Comp = Light->PointLightComponent;
		if (Slot >= Lit)
		{
			if (Assigned[Slot] != INDEX_NONE)
			{
				Assigned[Slot] = INDEX_NONE;
				if (Comp != nullptr)
				{
					Comp->SetVisibility(false);
				}
			}
			continue;
		}
		const int32 Index = Near[Slot].Index;
		if (Assigned[Slot] != Index)
		{
			Assigned[Slot] = Index;
			const FWonderlandPracticalLight& Def = Defined[Index];
			Light->SetActorLocation(Def.Location);
			if (Comp != nullptr)
			{
				Comp->SetLightColor(Def.Colour);
				Comp->SetAttenuationRadius(Def.RadiusUU);
				Comp->SetSourceRadius(Def.SourceRadiusUU);
				Comp->SetVisibility(true);
			}
		}
	}
	LastNight = -1.0f;   // intensities must follow the new assignment
}

void UWonderlandPracticalLightsSubsystem::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	UWorld* World = GetWorld();
	if (World == nullptr || Pool.Num() == 0)
	{
		return;
	}
	SinceAssign += DeltaSeconds;
	if (SinceAssign >= 0.25f)
	{
		SinceAssign = 0.0f;
		Assign();
	}
	float Night = 1.0f;
	if (const UWonderlandDayCycleSubsystem* Sky = World->GetSubsystem<UWonderlandDayCycleSubsystem>())
	{
		Night = Sky->GetNightAmount();
	}
	// THE LAMPS COME UP WITH THE MOON. The day cycle publishes its own night curve; following it means a lamp
	// is dark at noon, brightening through dusk, full at midnight -- with no second clock to drift.
	if (FMath::IsNearlyEqual(Night, LastNight, 0.002f) && FMath::IsNearlyEqual(GWonderlandPracticalGain, LastGain, 0.001f))
	{
		return;
	}
	LastNight = Night;
	LastGain = GWonderlandPracticalGain;
	for (int32 Slot = 0; Slot < Pool.Num(); ++Slot)
	{
		if (Assigned[Slot] == INDEX_NONE || !IsValid(Pool[Slot]))
		{
			continue;
		}
		if (UPointLightComponent* Comp = Pool[Slot]->PointLightComponent)
		{
			Comp->SetIntensity(Defined[Assigned[Slot]].Candelas * Night * GWonderlandPracticalGain);
		}
	}
}

FString UWonderlandPracticalLightsSubsystem::DescribePracticals() const
{
	return FString::Printf(TEXT("defined=%d active=%d pool=%d night=%.3f gain=%.2f count=%d radius=%.0f file=%s problem=%s"),
		Defined.Num(), ActiveCount, Pool.Num(), LastNight, GWonderlandPracticalGain,
		GWonderlandPracticalCount, GWonderlandPracticalRadius, *FilePath, *LoadProblem);
}

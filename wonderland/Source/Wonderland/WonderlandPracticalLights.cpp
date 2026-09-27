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
	TEXT("How many practicals may be lit at once -- the nearest to the player. The rest are hidden."), ECVF_Default);

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
	// The nearest N within the radius. A partial sort of a few hundred entries four times a second is nothing.
	const float Radius2 = GWonderlandPracticalRadius * GWonderlandPracticalRadius;
	TArray<TPair<float, int32>> Near;
	Near.Reserve(Defined.Num());
	for (int32 Index = 0; Index < Defined.Num(); ++Index)
	{
		const float D2 = static_cast<float>(FVector::DistSquared2D(Defined[Index].Location, Eye));
		if (D2 <= Radius2)
		{
			Near.Emplace(D2, Index);
		}
	}
	Near.Sort([](const TPair<float, int32>& A, const TPair<float, int32>& B) { return A.Key < B.Key; });
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
		const int32 Index = Near[Slot].Value;
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

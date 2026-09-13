#include "WonderlandHoverComponent.h"

#include "GameFramework/Actor.h"
#include "Engine/World.h"

UWonderlandHoverComponent::UWonderlandHoverComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.bStartWithTickEnabled = true;
}

void UWonderlandHoverComponent::BeginPlay()
{
	Super::BeginPlay();
	AActor* Owner = GetOwner();
	if (Owner == nullptr)
	{
		SetComponentTickEnabled(false);
		return;
	}
	BaseLocation = Owner->GetActorLocation();
	BaseRotation = Owner->GetActorRotation();
	if (Phase < 0.0f)
	{
		// Hash the rest position into a phase. Deterministic — a rebuilt world
		// hovers identically — and different for any two props not standing
		// on exactly the same point.
		const float H = FVector::DotProduct(BaseLocation, FVector(12.9898f, 78.233f, 37.719f));
		ResolvedPhase = FMath::Frac(FMath::Sin(H * 0.001f) * 43758.5453f);
	}
	else
	{
		ResolvedPhase = FMath::Frac(Phase);
	}
}

void UWonderlandHoverComponent::TickComponent(float DeltaTime, ELevelTick TickType,
											   FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	AActor* Owner = GetOwner();
	UWorld* World = GetWorld();
	if (Owner == nullptr || World == nullptr || PeriodSeconds <= 0.01f)
	{
		return;
	}
	const float T = World->GetTimeSeconds() / PeriodSeconds + ResolvedPhase;
	const float Angle = T * 2.0f * PI;
	// Absolute from the base, so amplitude is a hard bound and nothing drifts.
	FVector Loc = BaseLocation;
	Loc.Z += FMath::Sin(Angle) * AmplitudeUu;
	FRotator Rot = BaseRotation;
	if (SwayDeg > 0.0f)
	{
		Rot.Yaw += FMath::Cos(Angle * 0.5f) * SwayDeg;
	}
	Owner->SetActorLocationAndRotation(Loc, Rot, false, nullptr, ETeleportType::None);
}

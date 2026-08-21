#include "WonderlandStrollingDog.h"

#include "Components/SceneComponent.h"
#include "WonderlandDogBody.h"

namespace WonderlandDogTags
{
	const FName RelayDog(TEXT("RelayDog"));
	const FName CompoundAgent(TEXT("CompoundAgent"));
	const FName HeroRelayDog(TEXT("HeroRelayDog"));
}

AWonderlandStrollingDog::AWonderlandStrollingDog()
{
	PrimaryActorTick.bCanEverTick = true;
	Body = CreateDefaultSubobject<USceneComponent>(TEXT("Body"));
	SetRootComponent(Body);
}

void AWonderlandStrollingDog::BeginPlay()
{
	Super::BeginPlay();

	if (HomeLocation.IsNearlyZero())
	{
		HomeLocation = GetActorLocation();
	}

	// THE TAGS ARE THE PROOF'S ONLY EVIDENCE. WonderlandWorldProof counts by
	// them, and a Dog that forgot to tag itself is a Dog the founder can see and
	// the log says is not there — which is worse than either being true alone.
	Tags.AddUnique(WonderlandDogTags::RelayDog);
	if (bIsHero)
	{
		Tags.AddUnique(WonderlandDogTags::HeroRelayDog);
	}
	else
	{
		Tags.AddUnique(WonderlandDogTags::CompoundAgent);
	}

	WonderlandDogBody::FSkin Skin;
	Skin.Coat = CoatName;
	Skin.Accessory = Accessory;
	// The actor's own scale carries the size the generator asked for, so the
	// body is built at the canonical reference scale and scaled as a whole.
	// Scaling the parts instead would let a skin change proportions, which is
	// the one thing the identity rule forbids.
	Skin.Scale = WonderlandDogBody::ReferenceScale;
	Skin.FootOffset = 0.0f;
	BuiltParts = WonderlandDogBody::Build(this, Body, Skin);

	if (BuiltParts == 0)
	{
		// LOUD, and at Warning so it survives the packaged log's filtering. The
		// failure this class was written to end was a Dog that vanished
		// quietly; replacing it with a Dog that vanishes quietly for a
		// different reason would be no improvement.
		UE_LOG(LogTemp, Warning,
			   TEXT("RELAY DOG BODY FAILED for %s — coat '%s'. The Dog is present "
					"as an actor and INVISIBLE. Check that /Engine/BasicShapes/Cube "
					"and /Game/Wonderland/Materials/MI_%s cooked into the package."),
			   *GetName(), *CoatName.ToString(), *CoatName.ToString());
	}

	// A stable per-Dog phase from the placed position: deterministic across
	// runs, so two hero frames of the same camera are comparable.
	const FVector P = GetActorLocation();
	BreathPhase = FMath::Fmod(FMath::Abs(P.X * 0.013f + P.Y * 0.029f), 6.2831853f);
	PickDestination();
}

void AWonderlandStrollingDog::PickDestination()
{
	// Deterministic wander: the destination is a function of the Dog's home and
	// how long it has been alive. No RNG, because a hero frame captured twice
	// must frame the same Dogs in the same places.
	const float Angle = FMath::Fmod(BreathPhase + LifeSeconds * 0.37f, 6.2831853f);
	const float Radius = RoamRadius * (0.35f + 0.5f * FMath::Abs(FMath::Sin(LifeSeconds * 0.11f + BreathPhase)));
	Destination = HomeLocation + FVector(FMath::Cos(Angle) * Radius,
										 FMath::Sin(Angle) * Radius, 0.0f);
}

void AWonderlandStrollingDog::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	LifeSeconds += DeltaSeconds;

	// THE BREATH. Ambient life, never state: it depends on LifeSeconds and the
	// placed position and on nothing Relay has ever said. ~4.5 second cycle,
	// about 2% of the body — visible as life, never readable as information.
	if (Body != nullptr)
	{
		const float Breath = 1.0f + 0.02f * FMath::Sin(LifeSeconds * 1.4f + BreathPhase);
		Body->SetRelativeScale3D(FVector(Breath, Breath, Breath));
	}

	if (PauseSeconds > 0.0f)
	{
		PauseSeconds -= DeltaSeconds;
		return;
	}

	const FVector Here = GetActorLocation();
	FVector ToTarget = Destination - Here;
	ToTarget.Z = 0.0f;
	const float Distance = ToTarget.Size();
	if (Distance < 25.0f)
	{
		// A pause at each waypoint: a Dog that walks a perfect loop reads as a
		// machine on a track. The length is a function of the phase, so it is
		// still deterministic.
		PauseSeconds = 1.5f + 2.0f * FMath::Abs(FMath::Sin(BreathPhase * 3.1f));
		PickDestination();
		return;
	}

	const FVector Step = ToTarget / Distance * WalkSpeed * DeltaSeconds;
	SetActorLocation(Here + Step);

	// Turn toward travel. The body faces +X, so the yaw of the step is the yaw
	// the whole Dog wants — interpolated so it banks into a turn rather than
	// snapping, which is what made the earlier Dogs read as sliding props.
	const FRotator Want(0.0f, FMath::RadiansToDegrees(FMath::Atan2(Step.Y, Step.X)), 0.0f);
	SetActorRotation(FMath::RInterpTo(GetActorRotation(), Want, DeltaSeconds, 3.0f));
}

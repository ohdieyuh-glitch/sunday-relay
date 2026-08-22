#include "WonderlandStrollingDog.h"

#include "Components/SceneComponent.h"
#include "WonderlandDogBody.h"
#include "WonderlandDogGait.h"
#include "Components/StaticMeshComponent.h"
#include "CollisionQueryParams.h"
#include "Engine/World.h"

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
	BuiltParts = WonderlandDogBody::Build(this, Body, Skin, &Rig);
	if (Rig.Torso != nullptr)
	{
		TorsoBaseScale = Rig.Torso->GetRelativeScale3D();
	}
	// Stride scales with the Dog. Quoted against the reference skin scale so a
	// larger Dog takes proportionally longer steps instead of scurrying.
	const float SizeRatio = (WonderlandDogBody::ReferenceScale > 0.0f)
		? (Skin.Scale / WonderlandDogBody::ReferenceScale) : 1.0f;
	StrideLength *= SizeRatio;
	StrideLift *= SizeRatio;
	StrideBob *= SizeRatio;

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

	// A frame that took no time, or an absurd one after a hitch, must not be
	// integrated: it produces a zero-length step or a teleport, and both read
	// as the snapping the founder saw.
	const float Dt = FMath::Clamp(DeltaSeconds, 0.0f, 0.1f);

	// THE BREATH. Ambient life, never state: it depends on LifeSeconds and the
	// placed position and on nothing Relay has ever said. Applied to the TORSO
	// now rather than to the root — scaling the root scaled the legs and their
	// stride with it, so the whole Dog pulsed instead of breathing.
	if (Rig.Torso != nullptr)
	{
		const float Breath = 1.0f + 0.02f * FMath::Sin(LifeSeconds * 1.4f + BreathPhase);
		Rig.Torso->SetRelativeScale3D(TorsoBaseScale * Breath);
	}

	if (PauseSeconds > 0.0f)
	{
		PauseSeconds -= Dt;
		// Settle to a stand: the paws ease back to rest rather than freezing
		// mid-stride, which is what made a stopping Dog look like a dropped
		// prop.
		PoseLegs(0.0f, FMath::Clamp(PauseSeconds * 2.0f, 0.0f, 1.0f));
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

	const FVector Direction = ToTarget / Distance;
	const float StepLength = WalkSpeed * Dt;
	FVector Next = Here + Direction * StepLength;

	// GROUND. The old step forced Z to zero and left the Dog at its spawn
	// height forever, so on anything but flat ground it floated or sank. Trace
	// down for the floor and ease onto it — eased, because a hard snap to a
	// traced height is itself a jitter.
	if (const UWorld* const W = GetWorld())
	{
		FHitResult Hit;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandDogGround), false, this);
		const FVector From = Next + FVector(0.0f, 0.0f, 220.0f);
		const FVector To = Next - FVector(0.0f, 0.0f, 600.0f);
		if (W->LineTraceSingleByChannel(Hit, From, To, ECC_WorldStatic, Params))
		{
			GroundZ = bHaveGround ? FMath::FInterpTo(GroundZ, Hit.Location.Z, Dt, 12.0f)
			                      : Hit.Location.Z;
			bHaveGround = true;
		}
	}
	if (bHaveGround)
	{
		Next.Z = GroundZ;
	}
	SetActorLocation(Next);

	// The gait advances with the DISTANCE covered, so the paws and the body are
	// the same quantity and cannot disagree at any speed.
	DistanceWalked += StepLength;
	PoseLegs(DistanceWalked, 0.0f);

	// Turn toward travel. The body faces +X, so the yaw of the step is the yaw
	// the whole Dog wants — interpolated so it banks into a turn rather than
	// snapping, which is what made the earlier Dogs read as sliding props.
	const FRotator Want(0.0f, FMath::RadiansToDegrees(FMath::Atan2(Direction.Y, Direction.X)), 0.0f);
	SetActorRotation(FMath::RInterpTo(GetActorRotation(), Want, Dt, 3.0f));
}

void AWonderlandStrollingDog::PoseLegs(float Travelled, float SettleAlpha)
{
	// SettleAlpha 1 means "stand": the paws blend back to their rest pose. A
	// Dog that stops mid-stride and freezes is the snapping the founder saw.
	const float Blend = 1.0f - FMath::Clamp(SettleAlpha, 0.0f, 1.0f);
	for (int32 i = 0; i < 4; ++i)
	{
		UStaticMeshComponent* const Leg = Rig.Legs[i];
		if (Leg == nullptr)
		{
			continue;
		}
		const float Phase = Travelled / StrideLength + WonderlandGait::LegPhaseOffset(i);
		const WonderlandGait::FLegPose Pose =
			WonderlandGait::LegPose(Phase, StrideLength, StrideLift);
		const FVector Rest = Rig.LegRest[i];
		Leg->SetRelativeLocation(FVector(Rest.X + Pose.Forward * Blend,
		                                 Rest.Y,
		                                 Rest.Z + Pose.Lift * Blend));
	}

	const WonderlandGait::FBodyPose BodyPose =
		WonderlandGait::BodyPose(Travelled / StrideLength, StrideBob);
	if (Rig.Torso != nullptr)
	{
		Rig.Torso->SetRelativeLocation(FVector(Rig.TorsoRest.X, Rig.TorsoRest.Y,
		                                       Rig.TorsoRest.Z + BodyPose.Bob * Blend));
	}
	if (Rig.Head != nullptr)
	{
		// The head counter-bobs: a walking dog holds its head steadier than its
		// shoulders, and without this the whole Dog pogos.
		Rig.Head->SetRelativeLocation(FVector(Rig.HeadRest.X, Rig.HeadRest.Y,
		                                       Rig.HeadRest.Z + BodyPose.Bob * 0.35f * Blend));
	}
}

#include "WonderlandMissionOrb.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandMission, Log, All);

namespace
{
	// ENGINE CONTENT ONLY, so the orb needs nothing from the world's Content to be drawn. Both parents are
	// cleared for instanced static meshes on disk; the glow one is what the companions' eyes already use.
	const TCHAR* const MissionOrbLitParent = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
	const TCHAR* const MissionOrbGlowParent = TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");
	const TCHAR* const MissionOrbCubePath = TEXT("/Engine/BasicShapes/Cube.Cube");

	/** The engine cube is 100 uu on a side. */
	FTransform MissionOrbBox(const FVector& Centre, const FVector& SizeUU, float YawDegrees = 0.0f)
	{
		return FTransform(FRotator(0.0f, YawDegrees, 0.0f), Centre, SizeUU / 100.0f);
	}

	/**
	 * A hollow ball of cubes. SHELL, NOT SOLID: the inside of a glowing ball is never seen and every cube in
	 * there is an instance drawn for nobody.
	 */
	void MissionOrbBall(TArray<FTransform>& Out, float RadiusUU, float CellUU)
	{
		const int32 Reach = FMath::Max(1, FMath::CeilToInt(RadiusUU / CellUU));
		const float Outer = RadiusUU;
		const float Inner = RadiusUU - CellUU * 1.05f;
		for (int32 X = -Reach; X <= Reach; ++X)
		{
			for (int32 Y = -Reach; Y <= Reach; ++Y)
			{
				for (int32 Z = -Reach; Z <= Reach; ++Z)
				{
					const FVector Cell(X * CellUU, Y * CellUU, Z * CellUU);
					const float D = Cell.Size();
					if (D <= Outer && D >= Inner)
					{
						Out.Add(MissionOrbBox(Cell, FVector(CellUU)));
					}
				}
			}
		}
	}

	/** Ease a motion toward another. Every field, so a beat can change one of them alone. */
	void MissionOrbEase(FWonderlandBeatMotion& Current, const FWonderlandBeatMotion& Target, float Alpha)
	{
		Current.SpinRevs = FMath::Lerp(Current.SpinRevs, Target.SpinRevs, Alpha);
		Current.BobUU = FMath::Lerp(Current.BobUU, Target.BobUU, Alpha);
		Current.BobPeriod = FMath::Lerp(Current.BobPeriod, Target.BobPeriod, Alpha);
		Current.PulseHz = FMath::Lerp(Current.PulseHz, Target.PulseHz, Alpha);
		Current.PulseDepth = FMath::Lerp(Current.PulseDepth, Target.PulseDepth, Alpha);
		Current.JitterUU = FMath::Lerp(Current.JitterUU, Target.JitterUU, Alpha);
		Current.CoreScale = FMath::Lerp(Current.CoreScale, Target.CoreScale, Alpha);
		Current.Brightness = FMath::Lerp(Current.Brightness, Target.Brightness, Alpha);
	}
}

AWonderlandMissionOrb::AWonderlandMissionOrb()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	// After movement, so the orb settles where the Dog IS this frame rather than where it was.
	PrimaryActorTick.TickGroup = TG_PostPhysics;
	SetCanBeDamaged(false);
	SetActorEnableCollision(false);

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Root->SetMobility(EComponentMobility::Movable);
	SetRootComponent(Root);

	DaisRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Dais"));
	DaisRoot->SetMobility(EComponentMobility::Movable);
	DaisRoot->SetupAttachment(Root);

	CoreRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Core"));
	CoreRoot->SetMobility(EComponentMobility::Movable);
	CoreRoot->SetupAttachment(Root);

	BandRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Band"));
	BandRoot->SetMobility(EComponentMobility::Movable);
	BandRoot->SetupAttachment(CoreRoot);
}

void AWonderlandMissionOrb::BeginPlay()
{
	Super::BeginPlay();
	SetOrbScale(BuiltScale);
	Build();
	Motion = WonderlandBeatReading(Beat).Motion;
	MotionTarget = Motion;
	PaintChakra();
}

UInstancedStaticMeshComponent* AWonderlandMissionOrb::MakeMesh(FName Name, USceneComponent* Parent, bool bGlow,
	const TArray<FTransform>& Instances, TObjectPtr<UMaterialInstanceDynamic>& OutMid)
{
	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, MissionOrbCubePath);
	UMaterialInterface* ParentMaterial = LoadObject<UMaterialInterface>(nullptr, bGlow ? MissionOrbGlowParent : MissionOrbLitParent);
	if (Cube == nullptr)
	{
		UE_LOG(LogWonderlandMission, Error, TEXT("WLMISSION no cube mesh at %s; the orb cannot be built"), MissionOrbCubePath);
		return nullptr;
	}
	UInstancedStaticMeshComponent* Mesh = NewObject<UInstancedStaticMeshComponent>(this, MakeUniqueObjectName(this, UInstancedStaticMeshComponent::StaticClass(), Name));
	Mesh->SetMobility(EComponentMobility::Movable);
	Mesh->SetStaticMesh(Cube);
	OutMid = ParentMaterial != nullptr ? UMaterialInstanceDynamic::Create(ParentMaterial, this) : nullptr;
	if (OutMid != nullptr)
	{
		Mesh->SetMaterial(0, OutMid.Get());
	}
	else
	{
		// LOUD, NOT SILENT: a missing parent draws the part in the default material rather than not at all.
		UE_LOG(LogWonderlandMission, Warning, TEXT("WLMISSION no material at %s; %s draws in the default material"),
			bGlow ? MissionOrbGlowParent : MissionOrbLitParent, *Name.ToString());
	}
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->SetGenerateOverlapEvents(false);
	Mesh->SetCanEverAffectNavigation(false);
	// Light does not cast shadows. A glowing pip that shadowed the ground would be a dark lamp.
	Mesh->SetCastShadow(!bGlow);
	Mesh->SetupAttachment(Parent);
	Mesh->AddInstances(Instances, false, false, false);
	Mesh->RegisterComponent();
	Meshes.Add(Mesh);
	BoxCount += Instances.Num();
	return Mesh;
}

void AWonderlandMissionOrb::Build()
{
	if (bBuilt)
	{
		return;
	}
	bBuilt = true;
	Phase = static_cast<float>(GetTypeHash(GetFName()) % 10007u) / 10007.0f;

	// ---------------------------------------------------------------- the dais, on the floor
	// A ring of short blocks laid flat, each turned to face the centre, so the ring reads as a rim rather
	// than as twenty-eight cubes that happen to be in a circle.
	{
		TArray<FTransform> Ring;
		const int32 Segments = 28;
		for (int32 Index = 0; Index < Segments; ++Index)
		{
			const float Angle = 360.0f * static_cast<float>(Index) / static_cast<float>(Segments);
			const float Rad = FMath::DegreesToRadians(Angle);
			Ring.Add(MissionOrbBox(
				FVector(FMath::Cos(Rad) * DaisRadiusUU, FMath::Sin(Rad) * DaisRadiusUU, 1.4f),
				FVector(3.0f, 6.4f, 2.4f), Angle));
		}
		MakeMesh(TEXT("MissionDais"), DaisRoot, true, Ring, DaisMid);
	}

	// ---------------------------------------------------------------- the spine of seven
	// THE COLLARS FIRST, and always: one lit component holding all seven, so the set can be counted even
	// when a single step is burning. They are the only part of the progression that never changes.
	{
		TArray<FTransform> Collars;
		for (int32 Step = 1; Step <= WonderlandChakraSteps; ++Step)
		{
			const float Z = SpineBaseUU + static_cast<float>(Step - 1) * SpinePitchUU;
			Collars.Add(MissionOrbBox(FVector(0.0f, 0.0f, Z), FVector(SpineWidthUU + 1.6f, SpineWidthUU + 1.6f, 1.5f)));
		}
		MakeMesh(TEXT("MissionSpine"), DaisRoot, false, Collars, SpineMid);
		if (SpineMid != nullptr)
		{
			SpineMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.20f, 0.20f, 0.24f));
		}
	}

	// ONE COMPONENT PER STEP, which is what lets each keep its own chakra hue. Seven components is a
	// rounding error beside the alternative -- per-instance custom data and a material that reads it.
	PipMids.SetNum(WonderlandChakraSteps);
	for (int32 Step = 1; Step <= WonderlandChakraSteps; ++Step)
	{
		const float Z = SpineBaseUU + static_cast<float>(Step - 1) * SpinePitchUU + 0.9f;
		TArray<FTransform> Pip;
		Pip.Add(MissionOrbBox(FVector(0.0f, 0.0f, Z), FVector(SpineWidthUU, SpineWidthUU, 1.9f)));
		MakeMesh(FName(*FString::Printf(TEXT("MissionPip%d"), Step)), DaisRoot, true, Pip, PipMids[Step - 1]);
	}

	// ---------------------------------------------------------------- the core
	{
		TArray<FTransform> Ball;
		MissionOrbBall(Ball, CoreRadiusUU, CoreRadiusUU / 2.6f);
		MakeMesh(TEXT("MissionCore"), CoreRoot, true, Ball, CoreMid);
	}

	// ---------------------------------------------------------------- the contract band
	// LIT, NOT GLOWING, and the only part of the orb that is: a band of ivory that takes the world's own
	// light is what keeps this reading as an object in Wonderland rather than as a HUD element in the world.
	{
		TArray<FTransform> Band;
		const int32 Segments = 14;
		const float BandRadius = CoreRadiusUU * 1.95f;
		for (int32 Index = 0; Index < Segments; ++Index)
		{
			const float Angle = 360.0f * static_cast<float>(Index) / static_cast<float>(Segments);
			const float Rad = FMath::DegreesToRadians(Angle);
			Band.Add(MissionOrbBox(
				FVector(FMath::Cos(Rad) * BandRadius, FMath::Sin(Rad) * BandRadius, 0.0f),
				FVector(2.6f, 4.8f, 2.6f), Angle));
		}
		MakeMesh(TEXT("MissionBand"), BandRoot, false, Band, BandMid);
		if (BandMid != nullptr)
		{
			BandMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.88f, 0.86f, 0.80f));
		}
	}

	UE_LOG(LogWonderlandMission, Log, TEXT("WLMISSION orb built: %d boxes, %d components"), BoxCount, Meshes.Num());
}

void AWonderlandMissionOrb::SetBeat(EWonderlandMissionBeat NewBeat)
{
	const bool bChanged = NewBeat != Beat;
	Beat = NewBeat;
	const FWonderlandBeatReading& Reading = WonderlandBeatReading(Beat);
	Chakra = WonderlandChakraForBeat(Beat, Chakra);
	MotionTarget = Reading.Motion;
	// A BEAT THAT NEEDS A PERSON CUTS, at zero seconds -- the same rule EWonderlandAnimationTransition
	// states for Interrupt. A graceful third of a second spent easing into "your mission stopped" is a
	// third of a second spent making the most important frame in the session look like the others.
	if (bChanged && Reading.bAsksForAHuman)
	{
		Motion = MotionTarget;
	}
	PaintChakra();
	UE_LOG(LogWonderlandMission, Verbose, TEXT("WLMISSION beat %s -> chakra %s (%d/%d)"),
		*WonderlandBeatId(Beat).ToString(), WonderlandChakraName(Chakra), WonderlandChakraStep(Chakra), WonderlandChakraSteps);
}

void AWonderlandMissionOrb::ResetProgression()
{
	Chakra = EWonderlandChakra::None;
	PaintChakra();
}

void AWonderlandMissionOrb::SetOrbScale(float Scale)
{
	SetActorScale3D(FVector(FMath::Clamp(Scale, 0.2f, 6.0f)));
}

void AWonderlandMissionOrb::SetFollowOffset(float Forward, float Right)
{
	FollowOffset = FVector(Forward, Right, 0.0);
	bHasSnapped = false;
	SnapToTarget();
}

float AWonderlandMissionOrb::GetOrbHeightUU() const
{
	return (CoreHeightUU + CoreRadiusUU) * static_cast<float>(GetActorScale3D().Z);
}

void AWonderlandMissionOrb::PaintChakra()
{
	const FLinearColor Colour = WonderlandChakraColour(Chakra);
	const int32 Step = WonderlandChakraStep(Chakra);
	if (DaisMid != nullptr)
	{
		// The dais sits under the core rather than beside it, so it burns lower: a rim, not a second lamp.
		DaisMid->SetVectorParameterValue(TEXT("Color"), Colour * (GlowExposure * 0.34f));
	}
	for (int32 Index = 0; Index < PipMids.Num(); ++Index)
	{
		if (PipMids[Index] == nullptr)
		{
			continue;
		}
		// EVERY PIP KEEPS ITS OWN HUE, ALWAYS. Only how hard it burns says whether the task has got there,
		// so the seven are recognisable as an ordered set even when only one of them is lit.
		const FLinearColor Own = WonderlandChakraColour(WonderlandChakraForStep(Index + 1));
		const bool bReached = (Index + 1) <= Step;
		const float Burn = bReached ? 1.0f : UnreachedPipFraction;
		PipMids[Index]->SetVectorParameterValue(TEXT("Color"), Own * (GlowExposure * Burn));
	}
}

void AWonderlandMissionOrb::SetFollowController(APlayerController* Controller)
{
	FollowController = Controller;
	bHasSnapped = false;
}

APawn* AWonderlandMissionOrb::GetFollowPawn() const
{
	APlayerController* Controller = FollowController.Get();
	return Controller != nullptr ? Controller->GetPawn() : nullptr;
}

FVector AWonderlandMissionOrb::DesiredLocation(const APawn* Pawn) const
{
	const FRotator Yaw(0.0f, Pawn->GetActorRotation().Yaw, 0.0f);
	FVector Wanted = Pawn->GetActorLocation() + Yaw.RotateVector(FVector(FollowOffset.X, FollowOffset.Y, 0.0));

	// GROUND-POSITIONED MEANS MEASURED, not assumed. The pawn's own origin is its centre, not its feet, and
	// Wonderland's floor rises and falls under it -- so the dais finds the floor by looking for it.
	UWorld* World = GetWorld();
	if (World != nullptr)
	{
		FHitResult Hit;
		FCollisionQueryParams Query(SCENE_QUERY_STAT(WonderlandMissionOrbFloor), false, this);
		Query.AddIgnoredActor(const_cast<APawn*>(Pawn));
		const FVector From = Wanted + FVector(0.0, 0.0, 180.0);
		const FVector To = Wanted - FVector(0.0, 0.0, 420.0);
		if (World->LineTraceSingleByChannel(Hit, From, To, ECC_WorldStatic, Query))
		{
			Wanted.Z = Hit.Location.Z;
			return Wanted;
		}
	}
	// No floor found: hold the pawn's own height rather than sinking through the world.
	Wanted.Z = Pawn->GetActorLocation().Z - 42.0;
	return Wanted;
}

void AWonderlandMissionOrb::SnapToTarget()
{
	if (const APawn* Pawn = GetFollowPawn())
	{
		SetActorLocation(DesiredLocation(Pawn));
		bHasSnapped = true;
	}
}

void AWonderlandMissionOrb::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bBuilt)
	{
		Build();
	}

	if (const APawn* Pawn = GetFollowPawn())
	{
		const FVector Target = DesiredLocation(Pawn);
		if (!bHasSnapped || FVector::Dist(GetActorLocation(), Target) > SnapDistanceUU)
		{
			SetActorLocation(Target);
			bHasSnapped = true;
		}
		else
		{
			const float Alpha = FollowLagSeconds > KINDA_SMALL_NUMBER
				? 1.0f - FMath::Exp(-DeltaSeconds / FollowLagSeconds)
				: 1.0f;
			SetActorLocation(FMath::Lerp(GetActorLocation(), Target, Alpha));
		}
		// The dais never tilts with the Dog. A contract lies flat on the ground.
		SetActorRotation(FRotator::ZeroRotator);
	}

	const UWorld* World = GetWorld();
	Animate(World != nullptr ? static_cast<float>(World->GetTimeSeconds()) : 0.0f, DeltaSeconds);
}

void AWonderlandMissionOrb::Animate(float TimeSeconds, float DeltaSeconds)
{
	const float Blend = BeatBlendSeconds > KINDA_SMALL_NUMBER
		? 1.0f - FMath::Exp(-DeltaSeconds / BeatBlendSeconds)
		: 1.0f;
	MissionOrbEase(Motion, MotionTarget, Blend);

	// ---------------------------------------------------------------- the turn
	SpinDegrees = FMath::Fmod(SpinDegrees + Motion.SpinRevs * 360.0f * DeltaSeconds, 360.0f);
	BandDegrees = FMath::Fmod(BandDegrees - Motion.SpinRevs * 210.0f * DeltaSeconds, 360.0f);
	if (DaisRoot != nullptr)
	{
		DaisRoot->SetRelativeRotation(FRotator(0.0f, SpinDegrees, 0.0f));
	}
	if (BandRoot != nullptr)
	{
		// The band leans, so a turning ring is legible from the play camera rather than edge-on.
		BandRoot->SetRelativeRotation(FRotator(18.0f, BandDegrees, 0.0f));
	}

	// ---------------------------------------------------------------- the float
	// COMPUTED ABSOLUTELY FROM REST, the rule everything in Wonderland that floats keeps: no pose is added
	// to the last one, so a paused editor, a long frame or a changed beat cannot make the orb drift away.
	const float Wave = FMath::Sin((TimeSeconds / FMath::Max(Motion.BobPeriod, 0.05f) + Phase) * 2.0f * PI);
	FVector CoreAt(0.0f, 0.0f, CoreHeightUU + Motion.BobUU * Wave);
	if (Motion.JitterUU > KINDA_SMALL_NUMBER)
	{
		// Deterministic and absolute: three incommensurate rates, so it never repeats and never accumulates.
		CoreAt.X += Motion.JitterUU * FMath::Sin((TimeSeconds * 11.3f + Phase * 7.0f));
		CoreAt.Y += Motion.JitterUU * FMath::Sin((TimeSeconds * 13.7f + Phase * 5.0f));
		CoreAt.Z += Motion.JitterUU * 0.6f * FMath::Sin((TimeSeconds * 17.1f + Phase * 3.0f));
	}
	if (CoreRoot != nullptr)
	{
		CoreRoot->SetRelativeLocation(CoreAt);
		CoreRoot->SetRelativeScale3D(FVector(FMath::Max(Motion.CoreScale, 0.05f)));
	}

	// ---------------------------------------------------------------- the pulse
	if (CoreMid != nullptr)
	{
		const float Cycle = Motion.PulseHz > KINDA_SMALL_NUMBER
			? 0.5f * (1.0f - FMath::Cos(TimeSeconds * Motion.PulseHz * 2.0f * PI))
			: 0.0f;
		const float Burn = FMath::Max(Motion.Brightness * (1.0f - Motion.PulseDepth * Cycle), 0.0f);
		CoreMid->SetVectorParameterValue(TEXT("Color"), WonderlandChakraColour(Chakra) * (GlowExposure * Burn));
	}
}

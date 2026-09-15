#include "WonderlandCompanionEmbodiment.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandCompanion, Log, All);

namespace
{
	// ENGINE CONTENT FIRST. The lit and glowing parents ship with the engine, so a companion needs nothing
	// from the world's Content to be drawn. The one project parent is the V1 master material, cleared for
	// read-only use as a parent by the world build (2026-09-15); the V2 materials are world-space
	// triplanar and would swim on anything that floats, and they are the world's to tune.
	const TCHAR* const LitParentPath = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
	const TCHAR* const RimParentPath = TEXT("/Game/Wonderland/Materials/M_WLMaster.M_WLMaster");
	const TCHAR* const GlowParentPath = TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");
	const TCHAR* const AdditiveParentPath = TEXT("/Engine/EngineMaterials/EmissiveMeshMaterial.EmissiveMeshMaterial");
	const TCHAR* const CubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
}

AWonderlandCompanionEmbodiment::AWonderlandCompanionEmbodiment()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	// After movement has run, so the companion follows where the Dog IS this frame rather than where it was.
	PrimaryActorTick.TickGroup = TG_PostPhysics;
	SetCanBeDamaged(false);
	SetActorEnableCollision(false);

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Root->SetMobility(EComponentMobility::Movable);
	SetRootComponent(Root);

	FloatRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Float"));
	FloatRoot->SetMobility(EComponentMobility::Movable);
	FloatRoot->SetupAttachment(Root);
}

UMaterialInterface* AWonderlandCompanionEmbodiment::ParentFor(EWonderlandCompanionMaterialKind Kind) const
{
	const TCHAR* Path = LitParentPath;
	switch (Kind)
	{
	case EWonderlandCompanionMaterialKind::Rim: Path = RimParentPath; break;
	case EWonderlandCompanionMaterialKind::Glow: Path = GlowParentPath; break;
	case EWonderlandCompanionMaterialKind::Additive: Path = AdditiveParentPath; break;
	default: break;
	}
	UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, Path);
	if (Parent == nullptr && Path != LitParentPath)
	{
		// LOUD, NOT SILENT. A missing parent draws the part in plain lit colour rather than not at all, and
		// says so, because a companion whose eyes quietly stopped glowing is the kind of drift nobody reports.
		UE_LOG(LogWonderlandCompanion, Warning, TEXT("WLCOMPANION material parent %s did not load; drawing that material lit instead"), Path);
		Parent = LoadObject<UMaterialInterface>(nullptr, LitParentPath);
	}
	return Parent;
}

void AWonderlandCompanionEmbodiment::ClearBody()
{
	for (UInstancedStaticMeshComponent* Mesh : PartMeshes)
	{
		if (Mesh != nullptr)
		{
			Mesh->DestroyComponent();
		}
	}
	for (int32 Index = PartPivots.Num() - 1; Index >= 0; --Index)
	{
		if (PartPivots[Index] != nullptr)
		{
			PartPivots[Index]->DestroyComponent();
		}
	}
	PartMeshes.Reset();
	PartPivots.Reset();
	MaterialInstances.Reset();
	Motions.Reset();
	GlowMaterials.Reset();
	BoxCount = 0;
}

bool AWonderlandCompanionEmbodiment::LoadFigure(const FString& FilePath)
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *FilePath))
	{
		LastError = FString::Printf(TEXT("cannot read figure file %s"), *FilePath);
		UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: %s"), *DisplayName, *LastError);
		return false;
	}
	FWonderlandCompanionFigure Figure;
	FString ParseError;
	if (!FWonderlandCompanionFigure::Parse(Text, Figure, ParseError))
	{
		LastError = FString::Printf(TEXT("%s: %s"), *FilePath, *ParseError);
		UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: figure refused, %s"), *DisplayName, *LastError);
		return false;
	}
	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, CubePath);
	if (Cube == nullptr)
	{
		LastError = TEXT("the engine cube /Engine/BasicShapes/Cube did not load");
		UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: %s"), *DisplayName, *LastError);
		return false;
	}

	// Only now, with a figure known to be whole, does the old body come down.
	ClearBody();
	FigurePath = FilePath;
	LastError.Reset();
	// Hashed from the name, so the two companions never hover, flap or blink in step.
	Phase = static_cast<float>(GetTypeHash(DisplayName) % 10007u) / 10007.0f;

	const float Unit = Figure.VoxelUU * FMath::Max(FigureScale, 0.05f);

	for (int32 Index = 0; Index < Figure.Materials.Num(); ++Index)
	{
		const FWonderlandCompanionMaterial& Def = Figure.Materials[Index];
		UMaterialInstanceDynamic* Instance = UMaterialInstanceDynamic::Create(ParentFor(Def.Kind), this);
		if (Instance != nullptr)
		{
			const FLinearColor Lit(Def.Color.R, Def.Color.G, Def.Color.B, 1.0f);
			const FLinearColor Emissive = Lit * FMath::Max(Def.Strength, 0.0f);
			switch (Def.Kind)
			{
			case EWonderlandCompanionMaterialKind::Lit:
				Instance->SetVectorParameterValue(TEXT("Color"), Lit);
				break;
			case EWonderlandCompanionMaterialKind::Rim:
				Instance->SetVectorParameterValue(TEXT("BaseColor"), Lit);
				Instance->SetVectorParameterValue(TEXT("RimColor"), Emissive);
				Instance->SetScalarParameterValue(TEXT("RimAmp"), 1.0f);
				Instance->SetScalarParameterValue(TEXT("EmissiveStrength"), 0.0f);
				// THE V1 MASTER CAN BREATHE AND BOB IN ITS VERTEX SHADER, on one clock shared by everything
				// that wears it. A companion must never join that heartbeat.
				Instance->SetScalarParameterValue(TEXT("BobAmp"), 0.0f);
				Instance->SetScalarParameterValue(TEXT("BreatheAmp"), 0.0f);
				Instance->SetScalarParameterValue(TEXT("DetailAmp"), 0.0f);
				break;
			case EWonderlandCompanionMaterialKind::Glow:
			case EWonderlandCompanionMaterialKind::Additive:
				Instance->SetVectorParameterValue(TEXT("Color"), Emissive);
				GlowMaterials.Add({Index, TEXT("Color"), Emissive});
				break;
			}
		}
		MaterialInstances.Add(Instance);
	}

	for (const FWonderlandCompanionPart& Def : Figure.Parts)
	{
		USceneComponent* Parent = Def.Parent == INDEX_NONE ? FloatRoot.Get() : PartPivots[Def.Parent].Get();
		const FVector ParentPivot = Def.Parent == INDEX_NONE ? FVector::ZeroVector : Figure.Parts[Def.Parent].Pivot;
		const FName ComponentName = MakeUniqueObjectName(this, USceneComponent::StaticClass(), FName(*FString::Printf(TEXT("Part_%s"), *Def.Name.ToString())));
		USceneComponent* Pivot = NewObject<USceneComponent>(this, ComponentName);
		Pivot->SetMobility(EComponentMobility::Movable);
		Pivot->SetupAttachment(Parent);
		const FVector Rest = (Def.Pivot - ParentPivot) * Unit;
		Pivot->SetRelativeLocation(Rest);
		Pivot->RegisterComponent();
		PartPivots.Add(Pivot);

		FPartMotion Motion;
		Motion.Motion = Def.Motion;
		Motion.A = Def.A;
		Motion.B = Def.B;
		Motion.RestLocation = Rest;
		Motions.Add(Motion);
	}

	// ONE INSTANCED COMPONENT PER PART AND MATERIAL, filled before it is registered, so a figure of a few
	// thousand boxes costs a few dozen components and a single render-state build each.
	TMap<int64, TArray<FTransform>> Groups;
	for (const FWonderlandCompanionBox& Box : Figure.Boxes)
	{
		const int64 Key = (static_cast<int64>(Box.Part) << 32) | static_cast<int64>(static_cast<uint32>(Box.Material));
		const FVector Local = (Box.Centre - Figure.Parts[Box.Part].Pivot) * Unit;
		// The engine cube is 100 uu on a side, centred on its pivot.
		const FVector Scale = Box.Size * (Unit / 100.0f);
		Groups.FindOrAdd(Key).Add(FTransform(Box.Rotation, Local, Scale));
	}
	for (TPair<int64, TArray<FTransform>>& Group : Groups)
	{
		const int32 PartIndex = static_cast<int32>(Group.Key >> 32);
		const int32 MaterialIndex = static_cast<int32>(Group.Key & 0xffffffff);
		const EWonderlandCompanionMaterialKind Kind = Figure.Materials[MaterialIndex].Kind;
		const FName ComponentName = MakeUniqueObjectName(this, UInstancedStaticMeshComponent::StaticClass(),
			FName(*FString::Printf(TEXT("Mesh_%s_%s"), *Figure.Parts[PartIndex].Name.ToString(), *Figure.Materials[MaterialIndex].Name.ToString())));
		UInstancedStaticMeshComponent* Mesh = NewObject<UInstancedStaticMeshComponent>(this, ComponentName);
		Mesh->SetMobility(EComponentMobility::Movable);
		Mesh->SetStaticMesh(Cube);
		if (MaterialInstances.IsValidIndex(MaterialIndex) && MaterialInstances[MaterialIndex] != nullptr)
		{
			Mesh->SetMaterial(0, MaterialInstances[MaterialIndex]);
		}
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Mesh->SetGenerateOverlapEvents(false);
		Mesh->SetCanEverAffectNavigation(false);
		// Light does not cast shadows: an unlit eye or a halo that shadowed the ground would be a dark lamp.
		Mesh->SetCastShadow(Kind == EWonderlandCompanionMaterialKind::Lit || Kind == EWonderlandCompanionMaterialKind::Rim);
		Mesh->SetupAttachment(PartPivots[PartIndex]);
		Mesh->AddInstances(Group.Value, false, false, false);
		Mesh->RegisterComponent();
		PartMeshes.Add(Mesh);
		BoxCount += Group.Value.Num();
	}

	UE_LOG(LogWonderlandCompanion, Log, TEXT("WLCOMPANION %s (%s) built from %s: %d boxes, %d parts, %d materials, %d components"),
		*DisplayName, *ClassLabel, *FilePath, BoxCount, PartPivots.Num(), MaterialInstances.Num(), PartMeshes.Num());
	Animate(GetWorld() != nullptr ? static_cast<float>(GetWorld()->GetTimeSeconds()) : 0.0f);
	return true;
}

bool AWonderlandCompanionEmbodiment::ReloadFigure()
{
	return !FigurePath.IsEmpty() && LoadFigure(FigurePath);
}

void AWonderlandCompanionEmbodiment::SetFollowController(APlayerController* Controller)
{
	FollowController = Controller;
	bHasSnapped = false;
}

APawn* AWonderlandCompanionEmbodiment::GetFollowPawn() const
{
	const APlayerController* Controller = FollowController.Get();
	return Controller != nullptr ? Controller->GetPawn() : nullptr;
}

void AWonderlandCompanionEmbodiment::SnapToTarget()
{
	bHasSnapped = false;
	if (const APawn* Pawn = GetFollowPawn())
	{
		SetActorLocationAndRotation(DesiredLocation(Pawn), FRotator(0.0, Pawn->GetActorRotation().Yaw, 0.0));
		bHasSnapped = true;
	}
}

FVector AWonderlandCompanionEmbodiment::DesiredLocation(const APawn* Pawn) const
{
	float Radius = 0.0f;
	float HalfHeight = 0.0f;
	Pawn->GetSimpleCollisionCylinder(Radius, HalfHeight);
	const FVector Feet = Pawn->GetActorLocation() - FVector(0.0, 0.0, HalfHeight);
	const FRotator Heading(0.0, Pawn->GetActorRotation().Yaw, 0.0);
	return Feet
		+ Heading.RotateVector(FVector(FollowOffset.X, FollowOffset.Y, 0.0))
		+ FVector(0.0, 0.0, HoverHeightUU + FollowOffset.Z);
}

void AWonderlandCompanionEmbodiment::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return;
	}

	APlayerController* Controller = FollowController.Get();
	const APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (Pawn != nullptr)
	{
		const FVector Target = DesiredLocation(Pawn);
		FVector Location = GetActorLocation();
		FRotator Facing = GetActorRotation();
		if (!bHasSnapped || FVector::DistSquared(Location, Target) > FMath::Square(SnapDistanceUU))
		{
			// A spawn, or a teleport: be there, facing the way the Dog faces, rather than streak across the world.
			Location = Target;
			Facing = FRotator(0.0, Pawn->GetActorRotation().Yaw, 0.0);
			bHasSnapped = true;
		}
		else
		{
			// Exponential lag: frame-rate independent, and it never overshoots the place it is heading for.
			const float Alpha = FollowLagSeconds <= KINDA_SMALL_NUMBER ? 1.0f : 1.0f - FMath::Exp(-DeltaSeconds / FollowLagSeconds);
			Location = FMath::Lerp(Location, Target, Alpha);

			IdleSeconds = Pawn->GetVelocity().Size2D() < 15.0 ? IdleSeconds + DeltaSeconds : 0.0f;
			double DesiredYaw = Pawn->GetActorRotation().Yaw;
			if (FaceCameraAfterIdleSeconds >= 0.0f && IdleSeconds >= FaceCameraAfterIdleSeconds && Controller->PlayerCameraManager != nullptr)
			{
				const FVector ToCamera = Controller->PlayerCameraManager->GetCameraLocation() - Location;
				if (ToCamera.SizeSquared2D() > 1.0)
				{
					DesiredYaw = ToCamera.Rotation().Yaw;
				}
			}
			Facing = FMath::RInterpTo(FRotator(0.0, Facing.Yaw, 0.0), FRotator(0.0, DesiredYaw, 0.0), DeltaSeconds, 3.0f);
		}
		SetActorLocationAndRotation(Location, Facing, false, nullptr, ETeleportType::TeleportPhysics);
	}

	Animate(static_cast<float>(World->GetTimeSeconds()));
}

void AWonderlandCompanionEmbodiment::Animate(float TimeSeconds)
{
	const float Scale = FMath::Max(FigureScale, 0.05f);

	// THE FLOAT: bounded, absolute from rest, and on this companion's own phase.
	if (FloatRoot != nullptr)
	{
		const float Hover = 2.0f * PI * (TimeSeconds / FMath::Max(HoverPeriodSeconds, 0.5f) + Phase);
		FloatRoot->SetRelativeLocationAndRotation(
			FVector(0.0, 0.0, FMath::Sin(Hover) * HoverAmplitudeUU),
			FRotator(FMath::Sin(Hover * 0.5f + 1.1f) * 1.5f, 0.0, FMath::Cos(Hover * 0.5f) * 2.0f));
	}

	for (int32 Index = 0; Index < PartPivots.Num() && Index < Motions.Num(); ++Index)
	{
		USceneComponent* Pivot = PartPivots[Index];
		const FPartMotion& Part = Motions[Index];
		if (Pivot == nullptr)
		{
			continue;
		}
		switch (Part.Motion)
		{
		case EWonderlandCompanionMotion::Float:
		{
			const float Angle = 2.0f * PI * (TimeSeconds / 3.1f + Phase + Part.A);
			Pivot->SetRelativeLocation(Part.RestLocation + FVector(0.0, 0.0, FMath::Sin(Angle) * 2.0f * Scale));
			break;
		}
		case EWonderlandCompanionMotion::Head:
		{
			const float Angle = 2.0f * PI * (TimeSeconds / 5.3f + Phase);
			Pivot->SetRelativeRotation(FRotator(FMath::Sin(Angle * 1.3f) * 2.5f, FMath::Sin(Angle) * 4.0f, FMath::Cos(Angle * 0.7f) * 3.0f));
			break;
		}
		case EWonderlandCompanionMotion::Wing:
		{
			// Swept back and forward about the root and lifted a little, mirrored by side.
			const float Side = Part.A < 0.0f ? -1.0f : 1.0f;
			const float Flap = FMath::Sin(2.0f * PI * (TimeSeconds / 2.4f + Phase));
			Pivot->SetRelativeRotation(FRotator(0.0, Side * Flap * 9.0f, Side * Flap * 7.0f));
			break;
		}
		case EWonderlandCompanionMotion::Tail:
		{
			// A wave travelling down the wisp: the further from the body, the later and the wider it swings.
			const float Along = FMath::Clamp(Part.A / FMath::Max(Part.B, 1.0f), 0.0f, 1.0f);
			const float Reach = FMath::Pow(Along, 1.35f);
			const float Wave = 2.0f * PI * (TimeSeconds / 2.2f + Phase) - Part.A * 0.62f;
			Pivot->SetRelativeLocationAndRotation(
				Part.RestLocation + FVector(FMath::Cos(Wave * 0.8f) * 3.0f, FMath::Sin(Wave) * 9.0f, 0.0) * (Reach * Scale),
				FRotator(0.0, FMath::Sin(Wave) * 8.0f * Reach, 0.0));
			break;
		}
		case EWonderlandCompanionMotion::Orbit:
			Pivot->SetRelativeRotation(FRotator(0.0, FMath::Fmod(TimeSeconds * Part.A + Phase * 360.0f, 360.0f), 0.0));
			break;
		case EWonderlandCompanionMotion::Blink:
		{
			// A 0.14 s squash every 5.2 s, offset per companion so the two never blink together.
			const float Cycle = FMath::Fmod(TimeSeconds + Phase * 5.2f, 5.2f);
			const float Squash = Cycle < 0.14f ? FMath::Lerp(0.12f, 1.0f, FMath::Abs(Cycle - 0.07f) / 0.07f) : 1.0f;
			Pivot->SetRelativeScale3D(FVector(1.0, 1.0, Squash));
			break;
		}
		case EWonderlandCompanionMotion::Twinkle:
		{
			const float Breath = 0.5f + 0.5f * FMath::Sin(2.0f * PI * (TimeSeconds / 1.7f + Part.A + Phase));
			Pivot->SetRelativeScale3D(FVector(0.55f + 0.45f * Breath));
			break;
		}
		default:
			break;
		}
	}

	// A slow pulse on everything that glows, from rest, so it can never ratchet brighter.
	const float Pulse = 1.0f + 0.10f * FMath::Sin(2.0f * PI * (TimeSeconds / 2.9f + Phase));
	for (const FGlowMaterial& Glow : GlowMaterials)
	{
		if (MaterialInstances.IsValidIndex(Glow.MaterialIndex) && MaterialInstances[Glow.MaterialIndex] != nullptr)
		{
			MaterialInstances[Glow.MaterialIndex]->SetVectorParameterValue(Glow.Parameter, Glow.Rest * Pulse);
		}
	}
}

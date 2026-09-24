#include "WonderlandCompanionEmbodiment.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"

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
	PartNames.Reset();
	MaterialInstances.Reset();
	Motions.Reset();
	GlowMaterials.Reset();
	BoxCount = 0;
}

bool AWonderlandCompanionEmbodiment::LoadFigure(const FString& FilePath)
{
	// PARSED ONCE PER FILE, NOT ONCE PER SPAWN.
	//
	// Every LoadFigure used to read the whole file off disk and parse it again: Cherubim Large is 2.5 MB and
	// 36,025 boxes, TenTails Large 2.9 MB and 39,845. One /pa at Large therefore read and parsed 7 MB on the
	// spawn frame, and a server holding MANY Project Avatars would pay that per avatar -- which is the cost the
	// founder is feeling. The wardrobe pays it too, on every skin click.
	//
	// The parsed figure is immutable once built, so it is shared. Keyed by path AND the file's timestamp, so
	// regenerating a skin with the forge is picked up without an editor restart; the entry is simply replaced.
	struct FCachedFigure
	{
		FDateTime Stamp;
		TSharedPtr<const FWonderlandCompanionFigure> Figure;
	};
	static TMap<FString, FCachedFigure> FigureCache;

	const FDateTime Stamp = IFileManager::Get().GetTimeStamp(*FilePath);
	TSharedPtr<const FWonderlandCompanionFigure> Shared;
	if (const FCachedFigure* Hit = FigureCache.Find(FilePath))
	{
		if (Hit->Stamp == Stamp && Hit->Figure.IsValid())
		{
			Shared = Hit->Figure;
		}
	}
	if (!Shared.IsValid())
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *FilePath))
		{
			LastError = FString::Printf(TEXT("cannot read figure file %s"), *FilePath);
			UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: %s"), *DisplayName, *LastError);
			return false;
		}
		TSharedRef<FWonderlandCompanionFigure> Parsed = MakeShared<FWonderlandCompanionFigure>();
		FString ParseError;
		if (!FWonderlandCompanionFigure::Parse(Text, Parsed.Get(), ParseError))
		{
			LastError = FString::Printf(TEXT("%s: %s"), *FilePath, *ParseError);
			UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: figure refused, %s"), *DisplayName, *LastError);
			return false;
		}
		Shared = Parsed;
		FigureCache.Add(FilePath, FCachedFigure{Stamp, Shared});
	}
	const FWonderlandCompanionFigure& Figure = *Shared;
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
	// MEASURED, NOT ASSUMED: how tall this figure really is, from the boxes it is about to build.
	{
		float Lowest = TNumericLimits<float>::Max();
		float Highest = -TNumericLimits<float>::Max();
		for (const FWonderlandCompanionBox& Box : Figure.Boxes)
		{
			Lowest = FMath::Min(Lowest, static_cast<float>(Box.Centre.Z - Box.Size.Z * 0.5));
			Highest = FMath::Max(Highest, static_cast<float>(Box.Centre.Z + Box.Size.Z * 0.5));
		}
		FigureHeightUU = Figure.Boxes.Num() > 0 ? (Highest - Lowest) * Unit : 0.0f;
		// AND KEEP THE FLOOR OF IT. /pa was re-deriving this by walking every instance of every component back
		// out of the render proxy with GetInstanceTransform(bWorldSpace=true) -- 95,594 calls for one /pa at
		// Large, on the spawn frame, to recover a number this loop had just computed for free.
		FigureLowestUU = Figure.Boxes.Num() > 0 ? Lowest * Unit : 0.0f;
	}

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
		PartNames.Add(Def.Name);
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

void AWonderlandCompanionEmbodiment::SetFormation(EWonderlandCompanionFormation InFormation,
	const AActor* Contract, int32 Index, int32 Count)
{
	ContractActor = Contract;
	if (Formation != InFormation)
	{
		const EWonderlandCompanionFormation Previous = Formation;
		Formation = InFormation;
		// HOME ACROSS THE DOG? Each companion clears the verification beam on the side it is already on, which is not
		// always the side it follows on; flying straight home, both then crossed through the Dog and through each other
		// in the completion shot (Scenario D film, 2026-09-16: 123 uu apart, 121 from the Dog). So a companion that ends
		// a mission flight on the wrong side of the Dog is routed round it -- see RouteHome.
		bRoutingHome = false;
		const APlayerController* RouteController = FollowController.Get();
		const APawn* RoutePawn = RouteController != nullptr ? RouteController->GetPawn() : nullptr;
		if (Formation == EWonderlandCompanionFormation::Follow && Previous != EWonderlandCompanionFormation::Follow
			&& RoutePawn != nullptr && GetWorld() != nullptr)
		{
			const FRotator Heading(0.0, RoutePawn->GetActorRotation().Yaw, 0.0);
			const double Across = FVector::DotProduct(GetActorLocation() - RoutePawn->GetActorLocation(), Heading.RotateVector(FVector::RightVector));
			const double HomeSide = FollowOffset.Y >= 0.0 ? 1.0 : -1.0;
			bRoutingHome = Across * HomeSide < 0.0;
			RouteStartedAt = static_cast<float>(GetWorld()->GetTimeSeconds());
			if (bRoutingHome)
			{
				UE_LOG(LogWonderlandCompanion, Log, TEXT("WLCOMPANION %s goes home round the %s of the Dog"),
					*DisplayName, HomeSide > 0.0 ? TEXT("front") : TEXT("back"));
			}
		}
		// Spread around a shared circle rather than stacking: two companions in the same place is one
		// companion with a shadow. The phase is per-companion and constant for the stage.
		FormationPhase = Count > 0 ? static_cast<float>(Index) / static_cast<float>(Count) : 0.0f;
		NextPulseAt = -1.0f;
		if (Formation == EWonderlandCompanionFormation::ClearTheSightLine && Contract != nullptr)
		{
			bFlankRight = ChooseFlank(Contract);
		}
	}
}

bool AWonderlandCompanionEmbodiment::ChooseFlank(const AActor* Contract) const
{
	// Right of the beam when this companion is further right than the other one; each on its own side when there is
	// no other. Both decide on the same frame from the same positions, so they always choose opposite flanks.
	const APlayerController* Controller = FollowController.Get();
	const APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (Pawn == nullptr)
	{
		return FollowOffset.Y >= 0.0;
	}
	const FVector Along = (Contract->GetActorLocation() - Pawn->GetActorLocation()).GetSafeNormal2D();
	const FVector Right(-Along.Y, Along.X, 0.0);
	const double Mine = FVector::DotProduct(GetActorLocation() - Pawn->GetActorLocation(), Right);
	for (TActorIterator<AWonderlandCompanionEmbodiment> Other(GetWorld()); Other; ++Other)
	{
		if (*Other == this)
		{
			continue;
		}
		const double Theirs = FVector::DotProduct(Other->GetActorLocation() - Pawn->GetActorLocation(), Right);
		if (FMath::IsNearlyEqual(Mine, Theirs, 1.0))
		{
			return FormationPhase >= 0.5f;
		}
		return Mine > Theirs;
	}
	return Mine >= 0.0;
}

void AWonderlandCompanionEmbodiment::SetParticipation(bool bInJoined, bool bInAgent, const FLinearColor& InAccent, FName InFlightBeat)
{
	bJoined = bInJoined;
	bAgent = bInAgent;
	ContributionAccent = InAccent;
	FlightBeat = InFlightBeat;
}

int32 AWonderlandCompanionEmbodiment::GetPulsesInFlight() const
{
	int32 Flying = 0;
	for (const FSupportPulse& Pulse : Pulses)
	{
		Flying += Pulse.Started >= 0.0f ? 1 : 0;
	}
	return Flying;
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

FVector AWonderlandCompanionEmbodiment::ContributionOrigin() const
{
	// From the body, not the figure origin: the origin is the tail tip, and light leaving a companion's feet reads as
	// something dripping from it rather than something it gives.
	return GetActorLocation() + FVector(0.0, 0.0, BodyClearanceHeightUU * FMath::Max(FigureScale, 0.05f));
}

FVector AWonderlandCompanionEmbodiment::RouteHome(const APawn* Pawn, const FVector& FollowTarget, float Now)
{
	// THE WAY HOME, ROUND THE DOG. The companion that follows on the Dog's right passes in front of it, the one on the
	// left behind it: when both change sides at once they cross HomeRouteReachUU in front and behind, never meeting, and
	// neither flies through the Dog. First out to the pass on the side it is on, then across it, then home as usual once
	// it is well out on its own side -- or after five seconds, whatever happened (a Dog that ran off, a teleport).
	const FRotator Heading(0.0, Pawn->GetActorRotation().Yaw, 0.0);
	const FVector Forward = Heading.RotateVector(FVector::ForwardVector);
	const FVector Right = Heading.RotateVector(FVector::RightVector);
	const FVector FromDog = GetActorLocation() - Pawn->GetActorLocation();
	const double Along = FVector::DotProduct(FromDog, Forward);
	const double Across = FVector::DotProduct(FromDog, Right);
	const double HomeSide = FollowOffset.Y >= 0.0 ? 1.0 : -1.0;
	if (Formation != EWonderlandCompanionFormation::Follow || Across * HomeSide > HomeRouteReachUU * 0.55
		|| Now - RouteStartedAt > 5.0f)
	{
		bRoutingHome = false;
		return FollowTarget;
	}
	const double PassAlong = HomeSide * HomeRouteReachUU;
	const bool bAtThePass = FMath::Abs(Along - PassAlong) < HomeRouteReachUU * 0.35;
	const double Side = bAtThePass ? HomeSide : (Across >= 0.0 ? 1.0 : -1.0);
	return Pawn->GetActorLocation() + Forward * PassAlong + Right * (Side * HomeRouteReachUU)
		+ FVector(0.0, 0.0, FollowTarget.Z - Pawn->GetActorLocation().Z);
}

FVector AWonderlandCompanionEmbodiment::DesiredLocation(const APawn* Pawn) const
{
	const AActor* Contract = ContractActor.Get();
	if (Contract != nullptr && Formation != EWonderlandCompanionFormation::Follow)
	{
		const FVector ContractAt = Contract->GetActorLocation();
		const FWonderlandCompanionOrbit Orbit = WonderlandCompanionOrbitFor(Formation);

		if (WonderlandFormationOrbits(Formation))
		{
			// A CIRCLE ABOUT THE CONTRACT, ABOVE IT. Inside the Dog's own circle so the two read as
			// concentric rather than as a crowd, and above the Dog's head so a companion never masks it.
			//
			// THE ANGLE IS INTEGRATED, NOT CLOCK x RATE. With `time x revolutions`, changing flight at 35 s from
			// 0.085 to 0.07 rev/s moved every companion's place on the circle by half a turn in one frame, and the
			// two flew straight across the circle through each other -- 16 uu apart in the first film.
			const float Angle = 2.0f * PI * static_cast<float>(FMath::Frac(OrbitTurns) + FormationPhase);
			const float Rise = Orbit.BobUU * FMath::Sin(Angle * 2.0f);
			return ContractAt + FVector(FMath::Cos(Angle) * Orbit.RadiusUU,
			                            FMath::Sin(Angle) * Orbit.RadiusUU,
			                            Orbit.HeightUU + Rise);
		}

		// CLEAR THE SIGHT-LINE. Flanking the Dog, level with it and well out to either side, measured against
		// the line the beam actually travels rather than against the Dog's facing -- the Dog turns to face the
		// contract, so the two agree here, but the beam is what must not be crossed and so the beam is what is used.
		// NOT BEHIND IT: 150 uu behind the Dog is where the play camera stands, and the first film's verification
		// shot had the Jhinn's wings filling the corner of the frame, a blur between the viewer and the beam.
		// THE FLANK IS THE SIDE THE COMPANION IS ALREADY ON (chosen once, in SetFormation), so reaching it never
		// crosses the beam. Taking it from the follow offset sent the LLM Companion from the Dog's left, where it
		// follows, across the beam to the right.
		const FVector Along = (ContractAt - Pawn->GetActorLocation()).GetSafeNormal2D();
		const FVector Right(-Along.Y, Along.X, 0.0);
		const double Side = bFlankRight ? 1.0 : -1.0;
		// NOR BETWEEN THE VIEWER AND THE DOG (editor 72, 2026-09-17). The mission camera watches verification from
		// the side, and from there the flank straight out beside the Dog put the LLM Companion squarely in front of
		// it, covering its legs. So there are two places on this companion's own side of the beam -- straight out
		// beside the Dog, or back and out, away from the Contract -- and it takes whichever is further off the line
		// through the Dog to the camera, in front or behind. Both keep it on its own side, so neither crosses the beam;
		// with the camera behind the Dog, as the play camera stands, it is still straight out to the side.
		const FVector Beside = Along * 30.0 + Right * (Side * 250.0);
		const FVector BackAndOut = -Along * 200.0 + Right * (Side * 170.0);
		FVector Offset = Beside;
		const APlayerController* Viewer = FollowController.Get();
		if (Viewer != nullptr && Viewer->PlayerCameraManager != nullptr)
		{
			const FVector ToViewer = (Viewer->PlayerCameraManager->GetCameraLocation() - Pawn->GetActorLocation()).GetSafeNormal2D();
			const double OnLineBeside = FMath::Abs(FVector::DotProduct(Beside.GetSafeNormal2D(), ToViewer));
			const double OnLineBack = FMath::Abs(FVector::DotProduct(BackAndOut.GetSafeNormal2D(), ToViewer));
			if (!ToViewer.IsNearlyZero() && OnLineBack + 0.05 < OnLineBeside)
			{
				Offset = BackAndOut;
			}
		}
		return Pawn->GetActorLocation() + Offset + FVector(0.0, 0.0, HoverHeightUU * 0.5);
	}

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

	// The orbit's own clock: the rate eases toward the flight's, and the angle is the running sum of it. Every
	// companion in the same flight integrates the same rate on the same frames, so they stay opposite.
	const bool bOrbiting = ContractActor.IsValid() && WonderlandFormationOrbits(Formation);
	const float WantRate = bOrbiting ? WonderlandCompanionOrbitFor(Formation).Revolutions : 0.0f;
	OrbitRate = FMath::FInterpTo(OrbitRate, WantRate, DeltaSeconds, 1.6f);
	OrbitTurns += static_cast<double>(OrbitRate) * DeltaSeconds;

	APlayerController* Controller = FollowController.Get();
	const APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (Pawn != nullptr)
	{
		FVector Target = DesiredLocation(Pawn);
		if (bRoutingHome)
		{
			Target = RouteHome(Pawn, Target, static_cast<float>(World->GetTimeSeconds()));
		}
		// OUT OF THE WALLS. Swept from the Dog's chest to where the companion's body would float, on the camera
		// channel -- the same geometry that stops the follow camera -- so beside a wall or down a narrow lane the
		// companion draws in toward the Dog instead of hovering inside the stone. The Dog itself never blocks.
		//
		// AN ORBIT IS SWEPT FROM ITS CENTRE, THE CONTRACT. Swept from the Dog, any planter between the Dog and the far
		// side of the circle pulled the companion back to the Dog: in the second film they dropped to the ground
		// 7 uu from it, mid-orbit, and one was pulled onto the verification beam. The sight-line flank is not swept
		// at all -- pulled in, it would land on exactly the line it exists to keep clear.
		const bool bOrbitFlight = ContractActor.IsValid() && WonderlandFormationOrbits(Formation);
		const bool bFlankFlight = ContractActor.IsValid() && Formation == EWonderlandCompanionFormation::ClearTheSightLine;
		UWorld* SweepWorld = bFlankFlight ? nullptr : GetWorld();
		if (SweepWorld != nullptr)
		{
			const FVector BodyLift(0.0, 0.0, BodyClearanceHeightUU);
			FCollisionQueryParams Query(SCENE_QUERY_STAT(WonderlandCompanionFollow), false, this);
			Query.AddIgnoredActor(Pawn);
			// Nor the Contract, nor another companion: an orbit is not a wall, and a companion pulled short by the
			// crystal it is circling would crowd in toward the Dog on exactly the side the other one is on.
			if (const AActor* Contract = ContractActor.Get())
			{
				Query.AddIgnoredActor(Contract);
			}
			for (TActorIterator<AWonderlandCompanionEmbodiment> Other(SweepWorld); Other; ++Other)
			{
				Query.AddIgnoredActor(*Other);
			}
			FHitResult Hit;
			const FVector SweepFrom = bOrbitFlight ? ContractActor.Get()->GetActorLocation() : Pawn->GetActorLocation();
			if (SweepWorld->SweepSingleByChannel(Hit, SweepFrom, Target + BodyLift, FQuat::Identity, ECC_Camera,
				FCollisionShape::MakeSphere(BodyClearanceRadiusUU), Query) && !Hit.bStartPenetrating)
			{
				Target = Hit.Location - BodyLift;
			}
		}
		FVector Location = GetActorLocation();
		FRotator Facing = GetActorRotation();

		// ROOM FOR THE DOG. In a mission flight nothing should brush past it: a companion whose body would be at the
		// Dog's height and within its reach is moved straight out from it. (Following, the offsets place a companion
		// at the Dog's shoulder on purpose, so this is for mission flights only.)
		if (bHasSnapped && (bOrbitFlight || bFlankFlight))
		{
			FVector FromDog = Target - Pawn->GetActorLocation();
			const double Level = FromDog.Z;
			FromDog.Z = 0.0;
			const double Reach = FromDog.Size();
			if (Reach < DogSpacingUU && Level < 110.0)
			{
				const FVector Out = Reach > 1.0 ? FromDog / Reach : FVector(0.0, FormationPhase < 0.5f ? -1.0 : 1.0, 0.0);
				Target += Out * (DogSpacingUU - Reach);
			}
		}

		// ROOM FOR EACH OTHER. Flights change together, so two companions can be sent across each other's path --
		// into an orbit from either side of the Dog, or home again at completion. Whichever is inside the other's
		// space is steered out of it, and because both do it they part and pass instead of meeting.
		if (bHasSnapped)
		{
			for (TActorIterator<AWonderlandCompanionEmbodiment> Other(GetWorld()); Other; ++Other)
			{
				if (*Other == this)
				{
					continue;
				}
				FVector Apart = Location - Other->GetActorLocation();
				Apart.Z *= 0.5;
				const double Gap = Apart.Size();
				if (Gap < CompanionSpacingUU)
				{
					const FVector Away = Gap > 1.0
						? Apart / Gap
						: FVector(0.0, FormationPhase < 0.5f ? 1.0 : -1.0, 0.0);
					Target += Away * ((CompanionSpacingUU - Gap) * 1.5);
				}
			}
		}

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
			const AActor* Contract = ContractActor.Get();
			if (Contract != nullptr && WonderlandFormationOrbits(Formation))
			{
				// Circling the Contract, a companion faces it: it is working on it, not escorting the Dog.
				const FVector ToContract = Contract->GetActorLocation() - Location;
				if (ToContract.SizeSquared2D() > 1.0)
				{
					DesiredYaw = ToContract.Rotation().Yaw;
				}
			}
			else if (FaceCameraAfterIdleSeconds >= 0.0f && IdleSeconds >= FaceCameraAfterIdleSeconds && Controller->PlayerCameraManager != nullptr)
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
	AnimatePulses(static_cast<float>(World->GetTimeSeconds()));
}

/**
 * HOW EACH ACTIVITY LOOKS, and why. Bounded, and all of it a shaping of the motion the body already has: the rate it
 * moves at, how far it moves, and how high it floats. Nothing here is decorative -- each one is what that runtime state
 * honestly looks like from outside.
 */
namespace WonderlandCompanionActivity
{
	struct FLook
	{
		float Rate = 1.0f;
		float Amplitude = 1.0f;
		float HeightUU = 0.0f;
	};

	FLook For(FName Activity)
	{
		// LISTENING is attentive stillness; THINKING is quick and small; WORKING is quicker and steadier; RESPONDING
		// rises and moves; WAITING FOR AUTH is dormant; ERROR sinks; DISCONNECTED is nearly still, because nothing is
		// there to move it.
		if (Activity == TEXT("LISTENING")) return { 0.70f, 0.80f, 3.0f };
		if (Activity == TEXT("THINKING")) return { 1.90f, 0.55f, 5.0f };
		if (Activity == TEXT("WORKING")) return { 2.30f, 0.45f, 2.0f };
		if (Activity == TEXT("RESPONDING")) return { 1.35f, 1.25f, 4.0f };
		if (Activity == TEXT("WAITING_FOR_AUTH")) return { 0.35f, 0.50f, -4.0f };
		if (Activity == TEXT("ERROR")) return { 0.45f, 0.35f, -7.0f };
		if (Activity == TEXT("DISCONNECTED")) return { 0.15f, 0.15f, -9.0f };
		return { 1.0f, 1.0f, 0.0f }; // IDLE, and anything this build does not know: the body's own resting motion.
	}
}

void AWonderlandCompanionEmbodiment::DriveGaitFromCanonical(float InStridePhase, float InGaitWeight, float InSpeedUU)
{
	// TAKEN WHOLE, NOT BLENDED TOWARD. Easing the costume toward the Dog's numbers would just be a third gait with
	// a lag of its own -- and a lag is precisely what "the skins do not move like the Dog" looks like. The
	// canonical values ARE this body's values for the frame.
	bGaitDrivenExternally = true;
	GaitPhase = InStridePhase;
	GaitWeight = InGaitWeight;
	GroundSpeedUU = InSpeedUU;
}

void AWonderlandCompanionEmbodiment::WearCanonicalPose(const FWonderlandWornPose& InPose)
{
	// TAKEN WHOLE, for the same reason the gait is: easing toward the Dog's numbers would be a third animation
	// with a lag of its own, and a lag is exactly what "the skins do not move like the Dog" looks like.
	WornPose = InPose;
	WornPose.bValid = true;
	bGaitDrivenExternally = true;
	GaitPhase = InPose.StridePhase;
	GaitWeight = InPose.GaitWeight;
	GroundSpeedUU = InPose.SpeedUU;
}

void AWonderlandCompanionEmbodiment::SetRuntimeActivity(FName Activity)
{
	if (Activity.IsNone() || Activity == RuntimeActivity)
	{
		return;
	}
	RuntimeActivity = Activity;
	ActivityChangedAt = GetWorld() != nullptr ? GetWorld()->GetTimeSeconds() : 0.0f;
	// A BODY DOES NOT SNAP BETWEEN MOODS: the new look is eased into over the next moment.
	ActivityBlend = 0.0f;
}

FRotator AWonderlandCompanionEmbodiment::GetPartRotation(FName PartName) const
{
	const int32 Index = PartNames.IndexOfByKey(PartName);
	return PartPivots.IsValidIndex(Index) && PartPivots[Index] != nullptr
		? PartPivots[Index]->GetRelativeRotation()
		: FRotator::ZeroRotator;
}

TArray<FName> AWonderlandCompanionEmbodiment::GetPartNames() const
{
	return PartNames;
}

void AWonderlandCompanionEmbodiment::Animate(float TimeSeconds)
{
	const float Scale = FMath::Max(FigureScale, 0.05f);

	// WHAT THE RUNTIME SAYS THIS COMPANION IS DOING, eased in. The phase is advanced by the rate rather than the clock
	// being scaled, so a change of activity never makes the body jump: it simply moves at a different pace from here.
	{
		const WonderlandCompanionActivity::FLook Look = WonderlandCompanionActivity::For(RuntimeActivity);
		ActivityBlend = FMath::Min(1.0f, ActivityBlend + FMath::Max(TimeSeconds - LastAnimateSeconds, 0.0f) * 1.8f);
		const float Blend = FMath::SmoothStep(0.0f, 1.0f, ActivityBlend);
		ActivityRate = FMath::Lerp(ActivityRate, Look.Rate, Blend * 0.25f);
		ActivityAmplitude = FMath::Lerp(ActivityAmplitude, Look.Amplitude, Blend * 0.25f);
		ActivityHeightUU = FMath::Lerp(ActivityHeightUU, Look.HeightUU, Blend * 0.25f);
		ActivityPhase += FMath::Max(TimeSeconds - LastAnimateSeconds, 0.0f) * ActivityRate;
		LastAnimateSeconds = TimeSeconds;
	}
	const float ActivityTime = ActivityPhase;

	// ---------------------------------------------------------------- THE GAIT, MEASURED RATHER THAN TIMED
	//
	// A WALK CYCLE DRIVEN BY A TIMER IS THE DEFINITION OF STIFF: the legs march at a fixed rate whatever the body is
	// doing, so a creature standing still paddles on the spot and one crossing a plaza takes the same little steps.
	// This clock is advanced by DISTANCE instead, so one turn of the cycle is always one stride on the ground and the
	// feet keep up with the body by construction.
	// UNLESS A RELAY DOG IS HANDING DOWN ITS OWN, which is what a worn mascot skin does. The canonical stride has
	// already been solved by the Dog this frame, so the costume wears that number and does not measure a second
	// one. Everything below still reads GaitPhase and GaitWeight, so the entire body -- legs, lean, sway, bob,
	// every joint -- inherits the canonical cadence, easing and transitions without any of them knowing.
	if (bGaitDrivenExternally)
	{
		// The spot is still tracked so that releasing the drive does not read as one enormous instant stride.
		GaitMeasuredAt = TimeSeconds;
		LastGroundSpot = GetActorLocation();
		bHasGroundSpot = true;
	}
	else
	{
		const float Delta = FMath::Max(TimeSeconds - GaitMeasuredAt, 0.0f);
		GaitMeasuredAt = TimeSeconds;
		const FVector Here = GetActorLocation();
		if (bHasGroundSpot && Delta > KINDA_SMALL_NUMBER)
		{
			const float Travelled = static_cast<float>(FVector::Dist2D(Here, LastGroundSpot));
			// Smoothed: one stuttered editor frame must not read as a sprint, and one dropped frame must not stop it.
			GroundSpeedUU = FMath::FInterpTo(GroundSpeedUU, Travelled / Delta, Delta, 6.0f);
			GaitPhase += Travelled / FMath::Max(StrideLengthUU * Scale, 1.0f);
		}
		LastGroundSpot = Here;
		bHasGroundSpot = true;

		// HOW MUCH OF THE WALK IS SHOWING. Eased both ways, because a body that snaps from standing to walking on the
		// frame it starts moving is as mechanical as one that never moves at all.
		const float Want = FMath::Clamp(GroundSpeedUU / FMath::Max(WalkSpeedUU, 1.0f), 0.0f, 1.35f);
		GaitWeight = FMath::FInterpTo(GaitWeight, Want, FMath::Max(TimeSeconds - LastAnimateSeconds, 0.0f) + Delta, 3.2f);

		// STANDING IS NOT STILLNESS. With no stride to run, the cycle keeps turning slowly so the body shifts its
		// weight, breathes and settles: a creature frozen between steps reads as a statue that happens to hover.
		if (GaitWeight < 0.98f)
		{
			GaitPhase += Delta * 0.22f * (1.0f - GaitWeight);
		}
	}
	// A SECOND CLOCK AT AN UNRELATED PERIOD. Every joint below mixes a little of this in, so no cycle ever lands in
	// exactly the same place twice. It is a small thing and it is most of the difference between a body that is
	// animated and one that is running a loop.
	const float Drift = FMath::Sin(2.0f * PI * (ActivityTime / 7.37f + Phase * 3.1f));
	const float Gait = GaitPhase;
	const float Walk = FMath::Clamp(GaitWeight, 0.0f, 1.2f);

	// THE FLOAT: bounded, absolute from rest, and on this companion's own phase.
	if (FloatRoot != nullptr)
	{
		const float Hover = 2.0f * PI * (ActivityTime / FMath::Max(HoverPeriodSeconds, 0.5f) + Phase);
		FloatRoot->SetRelativeLocationAndRotation(
			FVector(0.0, 0.0, FMath::Sin(Hover) * HoverAmplitudeUU * ActivityAmplitude + ActivityHeightUU),
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
			const float Angle = 2.0f * PI * (ActivityTime / 3.1f + Phase + Part.A);
			const float Idle = FMath::Sin(Angle) * 2.0f * Scale;
			// THE PERFORMANCE LIFTS THE WHOLE BODY -- 72 uu to meditate, 150 to fly up and verify. A floating part
			// keeps its own small bob on top of that; what it must not do is ignore the lift entirely, which is
			// what a costume did through every preparation and verification the founder ever watched.
			Pivot->SetRelativeLocation(Part.RestLocation + FVector(0.0, 0.0, Idle + (WornPose.bValid ? WornPose.LiftUU : 0.0f)));
			break;
		}
		case EWonderlandCompanionMotion::Head:
		{
			if (WornPose.bValid)
			{
				// THE DOG'S HEAD. Bowed to the pages while it reads, level against its own lean while it walks,
				// turned to the Contract where the performance turns it -- all of it decided by the one animator.
				Pivot->SetRelativeRotation(FRotator(WornPose.HeadPitchDeg, WornPose.HeadYawDeg, 0.0f));
				break;
			}
			const float Angle = 2.0f * PI * (ActivityTime / 5.3f + Phase);
			Pivot->SetRelativeRotation(FRotator(FMath::Sin(Angle * 1.3f) * 2.5f, FMath::Sin(Angle) * 4.0f, FMath::Cos(Angle * 0.7f) * 3.0f));
			break;
		}
		case EWonderlandCompanionMotion::Wing:
		{
			// Swept back and forward about the root and lifted a little, mirrored by side.
			const float Side = Part.A < 0.0f ? -1.0f : 1.0f;
			const float Beat = 2.0f * PI * (ActivityTime / 2.4f + Phase);
			// TWO TERMS AT DIFFERENT PERIODS, and the second lags: a wing driven by one sine beats like a metronome,
			// and the founder's word for that is stiff. The downstroke is also faster than the recovery, which is how
			// a wing actually works and what makes the beat read as effort rather than as oscillation.
			const float Flap = FMath::Sin(Beat) * 0.78f + FMath::Sin(Beat * 0.41f + 1.2f) * 0.22f;
			const float Bite = FMath::Sin(Beat - 0.55f);
			Pivot->SetRelativeRotation(FRotator(
				Bite * 4.0f + Drift * 1.4f,
				Side * Flap * 11.0f,
				Side * (Flap * 8.0f + Bite * 2.5f)));
			break;
		}
		case EWonderlandCompanionMotion::Tail:
		{
			// A wave travelling down the wisp: the further from the body, the later and the wider it swings.
			const float Along = FMath::Clamp(Part.A / FMath::Max(Part.B, 1.0f), 0.0f, 1.0f);
			const float Reach = FMath::Pow(Along, 1.35f);
			if (WornPose.bValid)
			{
				// THE DOG'S TAIL, spread along the chain so a segmented wisp still reads as one tail rather than
				// every segment snapping to the same angle.
				Pivot->SetRelativeLocationAndRotation(Part.RestLocation,
					FRotator(WornPose.TailPitchDeg * Reach, WornPose.TailYawDeg * Reach, 0.0f));
				break;
			}
			const float Wave = 2.0f * PI * (ActivityTime / 2.2f + Phase) - Part.A * 0.62f;
			// A SECOND, SLOWER SWING ACROSS THE FIRST, and a little pitch: one sine on one axis is a windscreen wiper.
			const float Cross = 2.0f * PI * (ActivityTime / 6.1f + Phase * 0.7f) - Part.A * 0.30f;
			Pivot->SetRelativeLocationAndRotation(
				Part.RestLocation + FVector(
					FMath::Cos(Wave * 0.8f) * 3.0f,
					FMath::Sin(Wave) * 9.0f + FMath::Sin(Cross) * 3.4f,
					FMath::Sin(Cross * 1.3f) * 2.2f) * (Reach * Scale),
				FRotator(
					FMath::Sin(Cross) * 4.0f * Reach,
					FMath::Sin(Wave) * 8.0f * Reach,
					FMath::Sin(Wave * 0.5f + 0.4f) * 5.0f * Reach));
			break;
		}
		case EWonderlandCompanionMotion::Stride:
		{
			// A LEG. Through one cycle the hip swings forward, plants, and is driven back under the body; the foot
			// lifts only on the forward half, because a foot that lifts while bearing weight is a creature skating.
			const float Cycle = FMath::Frac(Gait + Part.A);
			const float Swing = FMath::Sin(2.0f * PI * Cycle);
			// The lift is the positive half only, eased, so the foot leaves and meets the ground softly.
			const float Raw = FMath::Max(Swing, 0.0f);
			const float Lift = Raw * Raw * (3.0f - 2.0f * Raw);
			const float Reach = FMath::Max(Part.B, 0.01f);
			// Standing, the legs do not hold a pose: they shift weight slowly from side to side. DRIVEN, that
			// shuffle is the Dog's stillness instead of this body's clock -- and while the Dog is off the ground
			// the legs stop striding at nothing, which is the jump channel a costume never had.
			const float Idle = FMath::Sin(2.0f * PI * (ActivityTime / 4.6f + Phase + Part.A)) * 2.2f;
			const float Air = WornPose.bValid ? FMath::Clamp(WornPose.AirborneWeight, 0.0f, 1.0f) : 0.0f;
			const float Still = WornPose.bValid ? FMath::Clamp(WornPose.Stillness, 0.0f, 1.0f) : 0.0f;
			const float Ground = (1.0f - Air) * (1.0f - Still);
			Pivot->SetRelativeLocationAndRotation(
				Part.RestLocation + FVector(0.0, 0.0, Lift * 3.4f * Reach * Walk * Scale * Ground),
				FRotator((Swing * 27.0f * Walk + Idle * (1.0f - Walk) * (1.0f - Still)) * Ground
					+ Air * -18.0f * Reach + Drift * 1.1f, 0.0, 0.0));
			break;
		}
		case EWonderlandCompanionMotion::Knee:
		{
			// THE JOINT BELOW A HIP, AND IT ARRIVES LATE. A knee that bends on the same frame as its hip is the most
			// mechanical thing a walk can do; the 0.11 of a cycle it runs behind is what makes the leg read as a leg.
			const float Cycle = FMath::Frac(Gait + Part.A - 0.11f);
			// Bent hardest through the swing, nearly straight under load, and never quite locked.
			const float Bend = FMath::Max(FMath::Sin(2.0f * PI * Cycle), 0.0f);
			const float Load = FMath::Max(-FMath::Sin(2.0f * PI * Cycle), 0.0f);
			const float Reach = FMath::Max(Part.B, 0.01f);
			const float KneeAir = WornPose.bValid ? FMath::Clamp(WornPose.AirborneWeight, 0.0f, 1.0f) : 0.0f;
			Pivot->SetRelativeRotation(FRotator(
				(-Bend * 34.0f + Load * 6.0f) * Reach * Walk * (1.0f - KneeAir)
				+ KneeAir * -30.0f * Reach + Drift * 0.9f, 0.0, 0.0));
			break;
		}
		case EWonderlandCompanionMotion::Spine:
		{
			// THE BODY ITSELF FLEXES. It rolls into the stride, yaws against it, and bobs twice a cycle -- once for
			// each pair of feet. A torso carried rigidly over moving legs is a puppet on a stick.
			const float Amount = FMath::Max(Part.A, 0.0f);
			const float Wave = 2.0f * PI * (Gait + Part.B);
			const float Breathe = FMath::Sin(2.0f * PI * (ActivityTime / 3.9f + Phase)) * 1.4f;
			if (WornPose.bValid)
			{
				// THE DOG'S OWN TORSO, composed exactly as the canon body's root is: sway and bob damped by the
				// stillness the performance asks for, the mission lift added, the lean and turn-roll carried.
				// This is the half that used to be invented here, and the reason a standing skin looked nothing
				// like a standing Relay OG -- at rest the gait weight is zero and ONLY this was left running.
				Pivot->SetRelativeLocationAndRotation(
					Part.RestLocation + FVector(0.0, WornPose.SwayUU * Amount, (WornPose.BobUU + WornPose.LiftUU) * Amount),
					FRotator(WornPose.BodyPitchDeg * Amount, WornPose.BodyYawDeg * Amount, WornPose.BodyRollDeg * Amount));
				break;
			}
			Pivot->SetRelativeLocationAndRotation(
				Part.RestLocation + FVector(0.0, 0.0, FMath::Sin(Wave * 2.0f) * 1.9f * Amount * Walk * Scale),
				FRotator(
					FMath::Sin(Wave * 2.0f + 0.7f) * 2.6f * Amount * Walk + Breathe * Amount,
					FMath::Sin(Wave + 1.57f) * 3.4f * Amount * Walk,
					FMath::Sin(Wave) * 5.2f * Amount * Walk + Drift * 1.6f * Amount));
			break;
		}
		case EWonderlandCompanionMotion::Trail:
		{
			// A SEGMENT THAT STREAMS. The wave starts at the body and arrives late at the tip, it widens along the
			// chain, and the whole thing sweeps BACK as the body speeds up -- so a tail follows a running creature
			// instead of waving at the same rate whatever it is doing.
			const float Along = FMath::Clamp(Part.A / FMath::Max(Part.B, 1.0f), 0.0f, 1.0f);
			const float Reach = FMath::Pow(Along, 1.2f) + 0.12f;
			const float Lag = Part.A * 0.42f;
			const float Wave = 2.0f * PI * (ActivityTime / 2.05f + Phase) - Lag;
			const float Slow = 2.0f * PI * (ActivityTime / 5.7f + Phase * 0.5f) - Lag * 0.6f;
			// Swinging widens with speed; the backward sweep is what "streaming" actually looks like.
			const float Amplitude = (1.0f + 1.5f * Walk) * Reach;
			Pivot->SetRelativeRotation(FRotator(
				(FMath::Sin(Slow) * 5.0f - 16.0f * Walk * Reach) * (1.0f + 0.3f * Drift),
				FMath::Sin(Wave) * 11.0f * Amplitude,
				FMath::Sin(Wave * 0.63f + 0.9f) * 7.0f * Amplitude));
			break;
		}
		case EWonderlandCompanionMotion::Orbit:
			Pivot->SetRelativeRotation(FRotator(0.0, FMath::Fmod(ActivityTime * Part.A + Phase * 360.0f, 360.0f), 0.0));
			break;
		case EWonderlandCompanionMotion::Blink:
		{
			// A 0.14 s squash every 5.2 s, offset per companion so the two never blink together.
			const float Cycle = FMath::Fmod(ActivityTime + Phase * 5.2f, 5.2f);
			const float Squash = Cycle < 0.14f ? FMath::Lerp(0.12f, 1.0f, FMath::Abs(Cycle - 0.07f) / 0.07f) : 1.0f;
			Pivot->SetRelativeScale3D(FVector(1.0, 1.0, Squash));
			break;
		}
		case EWonderlandCompanionMotion::Twinkle:
		{
			const float Breath = 0.5f + 0.5f * FMath::Sin(2.0f * PI * (ActivityTime / 1.7f + Part.A + Phase));
			Pivot->SetRelativeScale3D(FVector(0.55f + 0.45f * Breath));
			break;
		}
		default:
			break;
		}
	}

	// A slow pulse on everything that glows, from rest, so it can never ratchet brighter.
	const float Pulse = 1.0f + 0.10f * FMath::Sin(2.0f * PI * (ActivityTime / 2.9f + Phase));
	for (const FGlowMaterial& Glow : GlowMaterials)
	{
		if (MaterialInstances.IsValidIndex(Glow.MaterialIndex) && MaterialInstances[Glow.MaterialIndex] != nullptr)
		{
			MaterialInstances[Glow.MaterialIndex]->SetVectorParameterValue(Glow.Parameter, Glow.Rest * Pulse);
		}
	}
}

/**
 * THE SUPPORT PULSES. Small lights that leave a companion and travel into the Contract while the study
 * is going on -- the founder's "contributing energy and information", and emphatically not shots.
 *
 * WHAT KEEPS IT FROM READING AS COMBAT is entirely in the numbers: they are slow (three quarters of a
 * second to cross), they are rare (one every second and a half per companion, offset so the two never
 * fire together), they arrive and stop rather than striking, and they travel on a curve that rises
 * before it falls. A fast straight repeat of the same light would be gunfire with a nicer colour.
 */
void AWonderlandCompanionEmbodiment::AnimatePulses(float TimeSeconds)
{
	const AActor* Contract = ContractActor.Get();
	const FWonderlandCompanionOrbit FlightOrbit = WonderlandCompanionOrbitFor(Formation);
	// ONLY A JOINED COMPANION CONTRIBUTES, and only in a flight that contributes. Gathering and holding clear do not.
	const bool bShould = WonderlandFormationOrbits(Formation) && FlightOrbit.bContributes && Contract != nullptr;
	AnimateBeam(TimeSeconds, FlightOrbit, bShould);
	if (PulseMesh == nullptr)
	{
		if (!bShould)
		{
			return;
		}
		// Built on first use rather than at spawn: a companion that never joins a study never pays for it.
		UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, CubePath);
		UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, GlowParentPath);
		if (Cube == nullptr)
		{
			return;
		}
		PulseMesh = NewObject<UInstancedStaticMeshComponent>(this,
			MakeUniqueObjectName(this, UInstancedStaticMeshComponent::StaticClass(), TEXT("SupportPulse")));
		PulseMesh->SetMobility(EComponentMobility::Movable);
		PulseMesh->SetStaticMesh(Cube);
		PulseMid = Parent != nullptr ? UMaterialInstanceDynamic::Create(Parent, this) : nullptr;
		if (PulseMid != nullptr)
		{
			// An unlit emissive reads as BLACK below about x3000 in this world's daylight exposure; the
			// companions' own figures carry the same multiplier for the same reason.
			PulseMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.80f, 0.93f, 1.0f) * 4200.0f);
			PulseMesh->SetMaterial(0, PulseMid.Get());
		}
		PulseMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		PulseMesh->SetGenerateOverlapEvents(false);
		PulseMesh->SetCanEverAffectNavigation(false);
		PulseMesh->SetCastShadow(false);
		PulseMesh->SetAbsolute(true, true, true);
		PulseMesh->SetupAttachment(Root);
		PulseMesh->RegisterComponent();
		Pulses.SetNum(4);
		// A head and two trailing sparks per pulse.
		// EVERY INSTANCE IS CREATED ONCE, HERE, and afterwards only ever MOVED.
		//
		// The first version cleared and re-added the instances every frame, which forces a full render
		// state rebuild per companion per frame. It stalled a PIE session so badly that the run never got
		// past its seventh sample and the editor sat at several hundred per cent CPU until it was killed.
		// An unused pulse is parked at zero scale rather than removed: a scale of nothing costs a matrix
		// multiply, and a rebuilt buffer costs the frame.
		TArray<FTransform> Parked;
		Parked.Init(FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector::ZeroVector), Pulses.Num() * PulseSparks);
		PulseMesh->AddInstances(Parked, false, false, false);
	}

	// Each companion's light is its own colour -- starlight for the LLM Companion, the imported-agent cyan for the
	// Jhinn -- so it is always readable which companion is contributing what. Set only when it changes.
	if (PulseMid != nullptr && !AppliedPulseAccent.Equals(ContributionAccent))
	{
		PulseMid->SetVectorParameterValue(TEXT("Color"), ContributionAccent * 4200.0f);
		AppliedPulseAccent = ContributionAccent;
	}

	if (!bShould)
	{
		// Park them rather than clearing: this branch runs every frame for the whole of a mission that is
		// not a study, and rebuilding an instance buffer every frame is what stalled the first version.
		for (int32 Index = 0; Index < Pulses.Num(); ++Index)
		{
			if (Pulses[Index].Started >= 0.0f)
			{
				Pulses[Index].Started = -1.0f;
				for (int32 Spark = 0; Spark < PulseSparks; ++Spark)
				{
					PulseMesh->UpdateInstanceTransform(Index * PulseSparks + Spark,
						FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector::ZeroVector), true, false, false);
				}
			}
		}
		PulseMesh->MarkRenderStateDirty();
		return;
	}

	const FWonderlandCompanionOrbit& Orbit = FlightOrbit;
	if (NextPulseAt < 0.0f)
	{
		// Offset by the companion's own phase so the two never fire together.
		NextPulseAt = TimeSeconds + Orbit.PulseEverySeconds * FormationPhase;
	}
	if (TimeSeconds >= NextPulseAt)
	{
		NextPulseAt = TimeSeconds + Orbit.PulseEverySeconds;
		for (FSupportPulse& Pulse : Pulses)
		{
			if (Pulse.Started < 0.0f)
			{
				Pulse.From = ContributionOrigin();
				Pulse.Started = TimeSeconds;
				++PulsesSent;
				break;
			}
		}
	}

	const FVector Target = Contract->GetActorLocation();
	for (int32 Index = 0; Index < Pulses.Num(); ++Index)
	{
		FSupportPulse& Pulse = Pulses[Index];
		const float Along = Pulse.Started >= 0.0f
			? (TimeSeconds - Pulse.Started) / FMath::Max(Orbit.PulseTravelSeconds, 0.05f)
			: -1.0f;
		if (Pulse.Started >= 0.0f && Along >= 1.0f + PulseTrail * (PulseSparks - 1))
		{
			// It ARRIVES rather than striking: the light reaches the Contract, its sparks follow it in, and it is done.
			Pulse.Started = -1.0f;
		}
		for (int32 Spark = 0; Spark < PulseSparks; ++Spark)
		{
			FTransform Where(FRotator::ZeroRotator, FVector::ZeroVector, FVector::ZeroVector);
			// Each spark runs the same curve a little behind the one before, so a pulse reads as a travelling light
			// with a tail at play distance -- a single 5 uu cube, the first version, was three pixels.
			const float At = Pulse.Started >= 0.0f ? Along - PulseTrail * Spark : -1.0f;
			if (At >= 0.0f && At < 1.0f)
			{
				// A curve, not a line. It rises out of the companion and settles into the Contract, which is what
				// makes it read as offering rather than firing.
				const FVector Straight = FMath::Lerp(Pulse.From, Target, At);
				const float Arc = FMath::Sin(At * PI) * 40.0f;
				const float Size = FMath::Lerp(15.0f, 6.0f, At) * (Spark == 0 ? 1.0f : (Spark == 1 ? 0.62f : 0.4f));
				// Turning as it goes, so the voxel light glints instead of sliding.
				Where = FTransform(FRotator(At * 300.0f, At * 420.0f, 0.0f), Straight + FVector(0.0, 0.0, Arc), FVector(Size / 100.0f));
			}
			const int32 Instance = Index * PulseSparks + Spark;
			if (PulseMesh->IsValidInstance(Instance))
			{
				PulseMesh->UpdateInstanceTransform(Instance, Where, true, false, false);
			}
		}
	}
	// One render-state touch for the whole set, after all four have moved.
	PulseMesh->MarkRenderStateDirty();
}

void AWonderlandCompanionEmbodiment::AnimateBeam(float TimeSeconds, const FWonderlandCompanionOrbit& Orbit, bool bContributing)
{
	const AActor* Contract = ContractActor.Get();
	// THE JHINN'S EXECUTION BEAM: on for a moment in each cycle while it implements or repairs, so it reads as work
	// being delivered in bursts rather than a laser held on the crystal. The LLM Companion contributes by pulses alone.
	const float Cycle = 2.4f;
	const float CyclePhase = FMath::Fmod(TimeSeconds + FormationPhase * Cycle, Cycle);
	const bool bWant = bContributing && bAgent && Orbit.bAgentBeam && Contract != nullptr && CyclePhase < 0.9f;
	if (!bWant)
	{
		if (BeamMesh != nullptr && BeamMesh->IsVisible())
		{
			BeamMesh->SetVisibility(false);
		}
		bBeamOn = false;
		return;
	}
	if (BeamMesh == nullptr)
	{
		UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, CubePath);
		UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, GlowParentPath);
		if (Cube == nullptr)
		{
			return;
		}
		BeamMesh = NewObject<UStaticMeshComponent>(this, MakeUniqueObjectName(this, UStaticMeshComponent::StaticClass(), TEXT("ContributionBeam")));
		BeamMesh->SetMobility(EComponentMobility::Movable);
		BeamMesh->SetStaticMesh(Cube);
		BeamMid = Parent != nullptr ? UMaterialInstanceDynamic::Create(Parent, this) : nullptr;
		if (BeamMid != nullptr)
		{
			BeamMesh->SetMaterial(0, BeamMid.Get());
		}
		BeamMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		BeamMesh->SetGenerateOverlapEvents(false);
		BeamMesh->SetCanEverAffectNavigation(false);
		BeamMesh->SetCastShadow(false);
		BeamMesh->SetAbsolute(true, true, true);
		BeamMesh->SetupAttachment(Root);
		BeamMesh->RegisterComponent();
	}
	if (BeamMid != nullptr)
	{
		// Brightest at the start of the burst, fading out, with a floor that still reads in daylight (x3000 and up).
		const float Burst = 1.0f - FMath::Clamp(CyclePhase / 0.9f, 0.0f, 1.0f);
		BeamMid->SetVectorParameterValue(TEXT("Color"), ContributionAccent * (3600.0f + 2400.0f * Burst));
	}
	const FVector From = ContributionOrigin();
	const FVector To = Contract->GetActorLocation();
	const FVector Span = To - From;
	const double Length = Span.Size();
	if (Length < 10.0)
	{
		BeamMesh->SetVisibility(false);
		bBeamOn = false;
		return;
	}
	// The unit cube is 100 uu and centred, so the bar sits at the midpoint, turned along the span, X-scaled to length.
	BeamMesh->SetWorldLocationAndRotation((From + To) * 0.5, Span.Rotation());
	// Seven uu across: at 4.5 the first film showed a hairline that vanished whenever the bar was not broadside.
	BeamMesh->SetWorldScale3D(FVector(Length / 100.0, 0.07, 0.07));
	if (!BeamMesh->IsVisible())
	{
		BeamMesh->SetVisibility(true);
	}
	bBeamOn = true;
}


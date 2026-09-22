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
	// ENGINE CONTENT ONLY, so a contract needs nothing from the world's Content to be drawn. Both parents
	// are cleared for instanced static meshes on disk; the glow one is what the companions' eyes use.
	const TCHAR* const MissionOrbLitParent = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
	const TCHAR* const MissionOrbGlowParent = TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");
	const TCHAR* const MissionOrbCubePath = TEXT("/Engine/BasicShapes/Cube.Cube");

	/** The engine cube is 100 uu on a side. */
	FTransform MissionOrbBox(const FVector& Centre, const FVector& SizeUU, const FRotator& Turn = FRotator::ZeroRotator)
	{
		return FTransform(Turn, Centre, SizeUU / 100.0f);
	}

	/**
	 * A HOLLOW BIPYRAMID: two square pyramids base to base, which is the diamond cut in the founder's
	 * reference. Shell only -- the inside of a glowing stone is never seen, and every cube in there is an
	 * instance drawn for nobody.
	 *
	 * A cell belongs to the surface when it is inside the solid and at least one neighbour is not.
	 */
	void MissionOrbDiamond(TArray<FTransform>& Out, float HalfWidth, float HalfHeight, float Cell)
	{
		const int32 ReachXY = FMath::Max(1, FMath::CeilToInt(HalfWidth / Cell));
		const int32 ReachZ = FMath::Max(1, FMath::CeilToInt(HalfHeight / Cell));
		auto Inside = [HalfWidth, HalfHeight, Cell](int32 X, int32 Y, int32 Z)
		{
			// |x|/w + |y|/w + |z|/h <= 1 is the octahedron; its waist is a square turned on its corner,
			// which is what gives the reference its facets rather than a cone.
			const float Fx = FMath::Abs(static_cast<float>(X) * Cell) / HalfWidth;
			const float Fy = FMath::Abs(static_cast<float>(Y) * Cell) / HalfWidth;
			const float Fz = FMath::Abs(static_cast<float>(Z) * Cell) / HalfHeight;
			return (Fx + Fy + Fz) <= 1.0f;
		};
		for (int32 X = -ReachXY; X <= ReachXY; ++X)
		{
			for (int32 Y = -ReachXY; Y <= ReachXY; ++Y)
			{
				for (int32 Z = -ReachZ; Z <= ReachZ; ++Z)
				{
					if (!Inside(X, Y, Z))
					{
						continue;
					}
					const bool bSurface =
						!Inside(X + 1, Y, Z) || !Inside(X - 1, Y, Z) ||
						!Inside(X, Y + 1, Z) || !Inside(X, Y - 1, Z) ||
						!Inside(X, Y, Z + 1) || !Inside(X, Y, Z - 1);
					if (bSurface)
					{
						Out.Add(MissionOrbBox(
							FVector(static_cast<float>(X) * Cell, static_cast<float>(Y) * Cell, static_cast<float>(Z) * Cell),
							FVector(Cell)));
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
	// After movement, so the contract settles where the Dog IS this frame rather than where it was.
	PrimaryActorTick.TickGroup = TG_PostPhysics;
	SetCanBeDamaged(false);
	SetActorEnableCollision(false);

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Root->SetMobility(EComponentMobility::Movable);
	SetRootComponent(Root);

	CrystalRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Crystal"));
	CrystalRoot->SetMobility(EComponentMobility::Movable);
	CrystalRoot->SetupAttachment(Root);

	RingRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Ring"));
	RingRoot->SetMobility(EComponentMobility::Movable);
	RingRoot->SetupAttachment(CrystalRoot);

	MoteRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Motes"));
	MoteRoot->SetMobility(EComponentMobility::Movable);
	MoteRoot->SetupAttachment(CrystalRoot);
}

void AWonderlandMissionOrb::BeginPlay()
{
	Super::BeginPlay();
	SetActorScale3D(FVector(FMath::Clamp(BuiltScale, 0.2f, 6.0f)));
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
		UE_LOG(LogWonderlandMission, Error, TEXT("WLMISSION no cube mesh at %s; the contract cannot be built"), MissionOrbCubePath);
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
	// Light does not cast shadows. A glowing stone that shadowed the ground would be a dark lamp.
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

	const float Cell = CrystalHalfWidthUU / 5.5f;

	// ---------------------------------------------------------------- the crystal
	{
		TArray<FTransform> Stone;
		MissionOrbDiamond(Stone, CrystalHalfWidthUU, CrystalHalfHeightUU, Cell);
		// THE CROWN IS ITS OWN PIECE: the section a repair identifies, erases and rebuilds, pivoted at its base.
		CrownFromUU = CrystalHalfHeightUU * 0.34f;
		TArray<FTransform> Lower;
		TArray<FTransform> Crown;
		for (const FTransform& Box : Stone)
		{
			if (Box.GetLocation().Z > CrownFromUU)
			{
				FTransform Moved = Box;
				Moved.AddToTranslation(FVector(0.0f, 0.0f, -CrownFromUU));
				Crown.Add(Moved);
			}
			else
			{
				Lower.Add(Box);
			}
		}
		MakeMesh(TEXT("MissionCrystal"), CrystalRoot, true, Lower, CrystalMid);
		CrownRoot = NewObject<USceneComponent>(this, MakeUniqueObjectName(this, USceneComponent::StaticClass(), TEXT("MissionCrown")));
		CrownRoot->SetMobility(EComponentMobility::Movable);
		CrownRoot->SetupAttachment(CrystalRoot);
		CrownRoot->SetRelativeLocation(FVector(0.0f, 0.0f, CrownFromUU));
		CrownRoot->RegisterComponent();
		MakeMesh(TEXT("MissionCrystalCrown"), CrownRoot, true, Crown, CrownMid);
		TArray<FTransform> Debris;
		for (int32 Index = 0; Index < 14; ++Index)
		{
			Debris.Add(MissionOrbBox(FVector::ZeroVector, FVector(Cell * 0.7f)));
		}
		DebrisMesh = MakeMesh(TEXT("MissionCrownDebris"), CrystalRoot, true, Debris, DebrisMid);
		if (DebrisMesh != nullptr)
		{
			DebrisMesh->SetVisibility(false);
		}
	}

	// ---------------------------------------------------------------- the frame
	// LIT, NOT GLOWING, and the reason the contract reads as a made object rather than a floating light:
	// ivory-gold trim takes the world's own sun, so it has highlights and shade the crystal cannot have.
	{
		TArray<FTransform> Frame;
		const float Bar = Cell * 0.72f;
		const float Tip = CrystalHalfHeightUU;

		// the spire above and the point below, each a short stack narrowing to a tip
		for (int32 Side = -1; Side <= 1; Side += 2)
		{
			const float Sign = static_cast<float>(Side);
			for (int32 Step = 0; Step < 4; ++Step)
			{
				const float T = static_cast<float>(Step);
				const float Width = Bar * (1.9f - 0.40f * T);
				Frame.Add(MissionOrbBox(
					FVector(0.0f, 0.0f, Sign * (Tip + 1.2f + T * Bar * 1.15f)),
					FVector(Width, Width, Bar * 1.15f)));
			}
		}

		// the spine through the stone, and the girdle round its waist
		Frame.Add(MissionOrbBox(FVector::ZeroVector, FVector(Bar * 0.9f, Bar * 0.9f, Tip * 2.0f)));
		const int32 Girdle = 20;
		for (int32 Index = 0; Index < Girdle; ++Index)
		{
			const float Angle = 360.0f * static_cast<float>(Index) / static_cast<float>(Girdle);
			const float Rad = FMath::DegreesToRadians(Angle);
			// The waist of an octahedron is a square on its corner, so the girdle follows |x|+|y| = w.
			const float Cos = FMath::Cos(Rad);
			const float Sin = FMath::Sin(Rad);
			const float Shrink = CrystalHalfWidthUU / FMath::Max(FMath::Abs(Cos) + FMath::Abs(Sin), 0.1f);
			Frame.Add(MissionOrbBox(
				FVector(Cos * Shrink, Sin * Shrink, 0.0f),
				FVector(Bar * 0.9f, Bar * 1.6f, Bar * 0.9f), FRotator(0.0f, Angle, 0.0f)));
		}

		// caps at the four equator corners, where the reference puts its gold clasps
		for (int32 Corner = 0; Corner < 4; ++Corner)
		{
			const float Angle = 90.0f * static_cast<float>(Corner);
			const float Rad = FMath::DegreesToRadians(Angle);
			const FVector At(FMath::Cos(Rad) * CrystalHalfWidthUU, FMath::Sin(Rad) * CrystalHalfWidthUU, 0.0f);
			Frame.Add(MissionOrbBox(At, FVector(Bar * 1.5f), FRotator(0.0f, Angle, 0.0f)));
			Frame.Add(MissionOrbBox(At * 1.15f, FVector(Bar * 1.0f), FRotator(0.0f, Angle, 0.0f)));
		}
		MakeMesh(TEXT("MissionFrame"), CrystalRoot, false, Frame, FrameMid);
		if (FrameMid != nullptr)
		{
			FrameMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.72f, 0.58f, 0.26f));
		}
	}

	// ---------------------------------------------------------------- the star at the heart
	{
		TArray<FTransform> Star;
		const float S = Cell * 0.8f;
		for (int32 Face = 0; Face < 4; ++Face)
		{
			const float Angle = 45.0f + 90.0f * static_cast<float>(Face);
			const float Rad = FMath::DegreesToRadians(Angle);
			Star.Add(MissionOrbBox(
				FVector(FMath::Cos(Rad) * CrystalHalfWidthUU * 0.76f, FMath::Sin(Rad) * CrystalHalfWidthUU * 0.76f, 0.0f),
				FVector(S * 1.1f), FRotator(0.0f, Angle, 0.0f)));
		}
		MakeMesh(TEXT("MissionStar"), CrystalRoot, true, Star, StarMid);
	}

	// ---------------------------------------------------------------- the orbit
	{
		TArray<FTransform> Ring;
		const int32 Segments = 40;
		const float Radius = CrystalHalfWidthUU * 1.65f;
		for (int32 Index = 0; Index < Segments; ++Index)
		{
			const float Angle = 360.0f * static_cast<float>(Index) / static_cast<float>(Segments);
			const float Rad = FMath::DegreesToRadians(Angle);
			Ring.Add(MissionOrbBox(
				FVector(FMath::Cos(Rad) * Radius, FMath::Sin(Rad) * Radius, 0.0f),
				FVector(Cell * 0.34f, Cell * 0.95f, Cell * 0.34f), FRotator(0.0f, Angle, 0.0f)));
		}
		MakeMesh(TEXT("MissionOrbit"), RingRoot, true, Ring, RingMid);
	}

	// ---------------------------------------------------------------- the motes
	{
		TArray<FTransform> Motes;
		const int32 Count = 14;
		for (int32 Index = 0; Index < Count; ++Index)
		{
			// Spread on a golden angle so they never line up into a visible ring or spiral.
			const float T = static_cast<float>(Index);
			const float Angle = FMath::DegreesToRadians(137.5f * T);
			const float Radius = CrystalHalfWidthUU * (1.5f + 0.09f * FMath::Fmod(T * 3.0f, 7.0f));
			const float Height = CrystalHalfHeightUU * (FMath::Fmod(T * 0.37f, 1.6f) - 0.8f);
			const float Size = Cell * (0.30f + 0.10f * FMath::Fmod(T, 3.0f));
			Motes.Add(MissionOrbBox(
				FVector(FMath::Cos(Angle) * Radius, FMath::Sin(Angle) * Radius, Height), FVector(Size)));
		}
		MakeMesh(TEXT("MissionMotes"), MoteRoot, true, Motes, MoteMid);
	}

	UE_LOG(LogWonderlandMission, Log, TEXT("WLMISSION contract built: %d boxes, %d components"), BoxCount, Meshes.Num());
}

float AWonderlandMissionOrb::GetOrbHeightUU() const
{
	return CrystalHalfHeightUU * 2.0f * static_cast<float>(GetActorScale3D().Z);
}

void AWonderlandMissionOrb::SetOrbScale(float Scale)
{
	BuiltScale = FMath::Clamp(Scale, 0.2f, 6.0f);
	SetActorScale3D(FVector(BuiltScale));
}

void AWonderlandMissionOrb::SetFollowOffset(float Forward, float Right)
{
	FollowOffset = FVector(Forward, Right, 0.0);
	bHasSnapped = false;
	SnapToTarget();
}

void AWonderlandMissionOrb::AnchorHere()
{
	const APawn* Pawn = GetFollowPawn();
	// Taken from the FOLLOW position rather than from wherever the crystal happens to be mid-glide, so the
	// anchor lands where the placement was measured even if the contract has only just manifested.
	AnchorPoint = Pawn != nullptr ? DesiredLocation(Pawn) : GetActorLocation();
	bAnchored = true;
	UE_LOG(LogWonderlandMission, Log, TEXT("WLMISSION contract anchored at %s"), *AnchorPoint.ToCompactString());
}

void AWonderlandMissionOrb::ReleaseAnchor()
{
	bAnchored = false;
}

void AWonderlandMissionOrb::SetManifest(float Target)
{
	ManifestTarget = FMath::Clamp(Target, 0.0f, 1.0f);
	if (ManifestTarget <= 0.0f)
	{
		// A dismissal cancels an appearance still waiting.
		ManifestDelay = 0.0f;
	}
}

void AWonderlandMissionOrb::ManifestAfter(float Seconds)
{
	ManifestDelay = FMath::Max(Seconds, 0.0f);
	ManifestTarget = ManifestDelay > 0.0f ? 0.0f : 1.0f;
}

void AWonderlandMissionOrb::SetRepairState(int32 Stage, float Progress, float Weight)
{
	RepairStage = FMath::Clamp(Stage, 0, 4);
	RepairProgress = FMath::Clamp(Progress, 0.0f, 1.0f);
	RepairWeight = FMath::Clamp(Weight, 0.0f, 1.0f);
}

FVector AWonderlandMissionOrb::GetCrownLocation() const
{
	return CrownRoot != nullptr ? CrownRoot->GetComponentLocation() : GetActorLocation();
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

void AWonderlandMissionOrb::SetDraft(bool bInDraft)
{
	if (bDraft == bInDraft)
	{
		return;
	}
	bDraft = bInDraft;
	PaintChakra();
}

void AWonderlandMissionOrb::SetStackLift(float Up)
{
	FollowOffset.Z = Up;
}

FLinearColor AWonderlandMissionOrb::CurrentColour() const
{
	if (bDraft)
	{
		// COLOURLESS, AND DELIBERATELY NOT DARK. A draft slot is waiting, not broken: a near-black orb would read
		// as a dead one, and the founder's rule is that gray never means failure.
		return FLinearColor(0.42f, 0.44f, 0.48f);
	}
	return WonderlandChakraColour(Chakra == EWonderlandChakra::None ? EWonderlandChakra::Root : Chakra);
}

void AWonderlandMissionOrb::PaintChakra()
{
	// A CONTRACT WITH NO STEP YET IS STILL RED. The founder's canon starts a new Mission Contract at red,
	// so `None` here means "just manifested, before the first event landed" and shows the root colour
	// rather than the cold ivory a resting orb used to use.
	const FLinearColor Colour = CurrentColour();
	if (RingMid != nullptr)
	{
		RingMid->SetVectorParameterValue(TEXT("Color"), Colour * (GlowExposure * 0.55f * Manifest));
	}
	if (MoteMid != nullptr)
	{
		MoteMid->SetVectorParameterValue(TEXT("Color"), Colour * (GlowExposure * 0.85f * Manifest));
	}
	if (StarMid != nullptr)
	{
		// The heart stays near-white whatever the stone is doing, which is what makes it read as a star
		// inside the crystal rather than as a brighter part of it.
		StarMid->SetVectorParameterValue(TEXT("Color"),
			FMath::Lerp(FLinearColor::White, Colour, 0.25f) * (GlowExposure * 1.4f * Manifest));
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

	// IT FLOATS, BUT IT FLOATS OVER SOMETHING. The height is measured from the floor rather than from the
	// pawn, so the contract keeps a constant altitude over rising ground instead of sinking into a slope.
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
			Wanted.Z = Hit.Location.Z + FloatHeightUU;
			return Wanted;
		}
	}
	// No floor found: hang at the pawn's own height rather than sinking through the world.
	Wanted.Z = Pawn->GetActorLocation().Z + (FloatHeightUU - 89.0f);
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

	// A CONTRACT CLEARS ITS OWN PLACE. Once it has manifested and then been asked to leave, it removes
	// itself when the fade is finished, so the owner never has to poll for the right moment to destroy it.
	// WAITING TO APPEAR: the Dog is gathering the energy this grows from. Held at nothing until the pause is over.
	if (ManifestDelay > 0.0f)
	{
		ManifestDelay = FMath::Max(ManifestDelay - DeltaSeconds, 0.0f);
		ManifestTarget = ManifestDelay > 0.0f ? 0.0f : 1.0f;
	}
	else if (bHasManifested && IsFullyDismissed())
	{
		Destroy();
		return;
	}

	if (const APawn* Pawn = GetFollowPawn())
	{
		FVector Target = DesiredLocation(Pawn);
		if (bAnchored)
		{
			// A PLACE, NOT AN ACCESSORY. It holds still while the Dog walks around it, reads at it and
			// beams at it -- and comes after the visitor only if they leave it behind entirely.
			const float Strayed = FVector::Dist2D(Pawn->GetActorLocation(), AnchorPoint);
			if (Strayed > LeashUU)
			{
				AnchorPoint = Target;
				++LeashBreaks;
				UE_LOG(LogWonderlandMission, Verbose, TEXT("WLMISSION leash broken at %.0f uu; contract re-anchored"), Strayed);
			}
			Target = AnchorPoint;
		}
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
		// The crystal never tilts with the Dog. It hangs level in the air.
		SetActorRotation(FRotator::ZeroRotator);
	}

	const UWorld* World = GetWorld();
	Animate(World != nullptr ? static_cast<float>(World->GetTimeSeconds()) : 0.0f, DeltaSeconds);
}

void AWonderlandMissionOrb::Animate(float TimeSeconds, float DeltaSeconds)
{
	// ---------------------------------------------------------------- manifesting
	const float Rate = MaterialiseSeconds > KINDA_SMALL_NUMBER
		? 1.0f - FMath::Exp(-DeltaSeconds / MaterialiseSeconds)
		: 1.0f;
	const float Before = Manifest;
	Manifest = FMath::Lerp(Manifest, ManifestTarget, Rate);
	if (FMath::Abs(Manifest - ManifestTarget) < 0.004f)
	{
		Manifest = ManifestTarget;
	}
	bHasManifested |= Manifest > 0.5f;
	if (!FMath::IsNearlyEqual(Manifest, Before, 0.002f))
	{
		PaintChakra();
	}

	const float Blend = BeatBlendSeconds > KINDA_SMALL_NUMBER
		? 1.0f - FMath::Exp(-DeltaSeconds / BeatBlendSeconds)
		: 1.0f;
	MissionOrbEase(Motion, MotionTarget, Blend);

	// ---------------------------------------------------------------- the turn
	SpinDegrees = FMath::Fmod(SpinDegrees + Motion.SpinRevs * 150.0f * DeltaSeconds, 360.0f);
	RingDegrees = FMath::Fmod(RingDegrees - Motion.SpinRevs * 330.0f * DeltaSeconds, 360.0f);
	if (RingRoot != nullptr)
	{
		// The orbit leans, so a turning ring is legible from the play camera rather than edge-on.
		RingRoot->SetRelativeRotation(FRotator(24.0f, RingDegrees, 0.0f));
	}
	if (MoteRoot != nullptr)
	{
		MoteRoot->SetRelativeRotation(FRotator(0.0f, -SpinDegrees * 0.6f, 0.0f));
	}

	// ---------------------------------------------------------------- the hover
	// COMPUTED ABSOLUTELY FROM REST, the rule everything in Wonderland that floats keeps: no pose is added
	// to the last one, so a paused editor, a long frame or a changed beat cannot make it drift away.
	const float Wave = FMath::Sin((TimeSeconds / FMath::Max(Motion.BobPeriod, 0.05f) + Phase) * 2.0f * PI);
	FVector At(0.0f, 0.0f, Motion.BobUU * Wave);
	if (Motion.JitterUU > KINDA_SMALL_NUMBER)
	{
		// Deterministic and absolute: three incommensurate rates, so it never repeats and never accumulates.
		At.X += Motion.JitterUU * FMath::Sin((TimeSeconds * 11.3f + Phase * 7.0f));
		At.Y += Motion.JitterUU * FMath::Sin((TimeSeconds * 13.7f + Phase * 5.0f));
		At.Z += Motion.JitterUU * 0.6f * FMath::Sin((TimeSeconds * 17.1f + Phase * 3.0f));
	}
	if (CrystalRoot != nullptr)
	{
		CrystalRoot->SetRelativeLocation(At);
		CrystalRoot->SetRelativeRotation(FRotator(0.0f, SpinDegrees, 0.0f));
		// A CONTRACT ARRIVES AND LEAVES BY GROWING, not by appearing. Scale carries the manifest as well as
		// the colour, because an emissive that merely brightened would pop rather than materialise.
		const float Grown = FMath::Max(Motion.CoreScale, 0.05f) * FMath::Max(Manifest, 0.001f);
		CrystalRoot->SetRelativeScale3D(FVector(Grown));
	}

	// ---------------------------------------------------------------- the pulse
	if (CrystalMid != nullptr)
	{
		const float Cycle = Motion.PulseHz > KINDA_SMALL_NUMBER
			? 0.5f * (1.0f - FMath::Cos(TimeSeconds * Motion.PulseHz * 2.0f * PI))
			: 0.0f;
		const float Burn = FMath::Max(Motion.Brightness * (1.0f - Motion.PulseDepth * Cycle), 0.0f) * Manifest;
		CrystalMid->SetVectorParameterValue(TEXT("Color"), CurrentColour() * (GlowExposure * Burn));
		CrystalBurn = Burn;
	}

	// ---------------------------------------------------------------- the repair, on the crown
	RepairShown = FMath::FInterpTo(RepairShown, RepairWeight, DeltaSeconds, 4.0f);
	{
		const FLinearColor Stone = CurrentColour() * CrystalBurn;
		const FLinearColor Fault(1.0f, 0.06f, 0.04f);
		const FLinearColor Ash(0.22f, 0.20f, 0.20f);
		const FLinearColor Gold(1.0f, 0.78f, 0.30f);
		float Scale = 1.0f;
		FLinearColor Colour = Stone;
		bool bDebris = false;
		const float P = RepairProgress;
		const float Shown = RepairShown;
		if (Shown > 0.01f)
		{
			switch (RepairStage)
			{
			case 1:
			{
				// IDENTIFY: the incorrect section flickers red, harder the longer it is looked at.
				const float Flicker = 0.55f + 0.45f * FMath::Sin(TimeSeconds * 15.0f);
				Colour = FMath::Lerp(Stone, Fault * (0.9f + 1.1f * Flicker), Shown * FMath::Clamp(P * 2.5f, 0.0f, 1.0f));
				break;
			}
			case 2:
			{
				// ERASE: it breaks away to nothing, going dark as it goes.
				const float Gone = FMath::SmoothStep(0.0f, 1.0f, P);
				Scale = FMath::Lerp(1.0f, 0.02f, Shown * Gone);
				Colour = FMath::Lerp(Fault * 1.4f, Ash, Gone);
				bDebris = true;
				break;
			}
			case 3:
			{
				// REPAINT: it grows back out of the stone in gold, and takes the chakra's colour as it finishes.
				const float Grown = FMath::SmoothStep(0.0f, 0.8f, P);
				Scale = FMath::Lerp(1.0f, FMath::Max(Grown, 0.02f), Shown);
				Colour = FMath::Lerp(Gold * 2.4f, Stone, FMath::SmoothStep(0.75f, 1.0f, P));
				break;
			}
			case 4:
			{
				// SETTLE: whole again, the gold easing back into the stone.
				Colour = FMath::Lerp(Gold * 1.5f, Stone, P);
				break;
			}
			default:
				break;
			}
		}
		CrownScaleShown = Scale;
		if (CrownRoot != nullptr)
		{
			CrownRoot->SetRelativeScale3D(FVector(FMath::Max(Scale, 0.001f)));
		}
		if (CrownMid != nullptr)
		{
			CrownMid->SetVectorParameterValue(TEXT("Color"), Colour * (GlowExposure * (Shown > 0.01f ? FMath::Max(Manifest, 0.2f) : 1.0f)));
		}
		if (DebrisMesh != nullptr)
		{
			const bool bShowDebris = bDebris && Shown > 0.2f && P > 0.05f;
			if (DebrisMesh->IsVisible() != bShowDebris)
			{
				DebrisMesh->SetVisibility(bShowDebris);
			}
			if (bShowDebris)
			{
				// The pieces fly out from the crown and fall, fading as the erase finishes.
				const int32 Count = DebrisMesh->GetInstanceCount();
				TArray<FTransform> Pieces;
				Pieces.Reserve(Count);
				const float Cell = CrystalHalfWidthUU / 5.5f;
				for (int32 Index = 0; Index < Count; ++Index)
				{
					const float Angle = FMath::DegreesToRadians(Index * 137.5f);
					const float Out = (4.0f + 30.0f * P) * (0.6f + 0.4f * FMath::Frac(Index * 0.37f));
					const float Fall = P * P * 70.0f * (0.7f + 0.3f * FMath::Frac(Index * 0.61f));
					const FVector PieceAt(FMath::Cos(Angle) * Out, FMath::Sin(Angle) * Out, CrownFromUU + CrystalHalfHeightUU * 0.3f - Fall);
					const float Size = Cell * 0.7f * (1.0f - P * 0.6f);
					Pieces.Add(FTransform(FRotator(Index * 31.0f + TimeSeconds * 200.0f, Index * 47.0f, 0.0f), PieceAt, FVector(Size / 100.0f)));
				}
				DebrisMesh->BatchUpdateInstancesTransforms(0, Pieces, false, true, true);
				if (DebrisMid != nullptr)
				{
					DebrisMid->SetVectorParameterValue(TEXT("Color"), FMath::Lerp(Fault, Ash, P) * (GlowExposure * (1.2f - P)));
				}
			}
		}
	}
}

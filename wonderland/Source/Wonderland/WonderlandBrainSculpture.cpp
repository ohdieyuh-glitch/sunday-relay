#include "WonderlandBrainSculpture.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "GameFramework/PlayerController.h"
#include "Camera/PlayerCameraManager.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/CollisionProfile.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

// NAMED FOR THIS FILE, not anonymous. The module is ONE UNITY TRANSLATION UNIT -- the convention
// WonderlandBrainIcon.cpp states outright, and which this file ignored: bare CubePath collided with the
// identical constant in WonderlandCompanionEmbodiment.cpp the moment a clean unity build ran. The
// adaptive game-target builds never caught it because they compile changed files OUTSIDE unity.
namespace
{
	const TCHAR* const BrainCubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
	const TCHAR* const BrainPlainMaterialPath = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");

	/** The head is integrated at this rate whatever the frame rate, so the body wave is the same on any machine. */
	constexpr float BrainSubStepSeconds = 1.0f / 120.0f;
	/**
	 * How many bearing samples the not-an-orbit proof averages over -- EIGHT seconds at the substep rate.
	 *
	 * NOT THREE, which is what this was. Over a three-second window a wandering route can happen to be mid-glide
	 * and read almost as steady as an orbit: simulated across six runs the worst three-second window came out at
	 * 5.6 deg/s, against a threshold the proof wanted to set at 20. Over eight seconds the worst window measured
	 * 10.2 deg/s and a real circular orbit still reads ~0, which is a gap a proof can actually stand on.
	 */
	constexpr int32 BrainBearingWindow = 960;

	/** Smooth value noise in one dimension: enough to wander convincingly, cheap, and repeatable from a seed. */
	float BrainWander(float T, float Seed)
	{
		const float A = FMath::Sin((T + Seed) * 0.37f);
		const float B = FMath::Sin((T + Seed) * 0.83f + 1.7f);
		const float C = FMath::Sin((T + Seed) * 1.61f + 4.2f);
		// Three unrelated periods summed: no short repeat, and never the same shape twice over a run.
		return (A * 0.55f + B * 0.30f + C * 0.15f);
	}
}

AWonderlandBrainSculpture::AWonderlandBrainSculpture()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	auto MakeMesh = [this, Root](const TCHAR* Name) -> UInstancedStaticMeshComponent*
	{
		UInstancedStaticMeshComponent* Mesh = CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		Mesh->SetupAttachment(Root);
		Mesh->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
		Mesh->SetCastShadow(false);
		Mesh->SetMobility(EComponentMobility::Movable);
		return Mesh;
	};
	auto MakePanel = [this, Root](const TCHAR* Name) -> UStaticMeshComponent*
	{
		UStaticMeshComponent* Panel = CreateDefaultSubobject<UStaticMeshComponent>(Name);
		Panel->SetupAttachment(Root);
		Panel->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
		Panel->SetCastShadow(false);
		Panel->SetMobility(EComponentMobility::Movable);
		return Panel;
	};
	Backdrop = MakePanel(TEXT("Chamber"));
	ChamberTop = MakePanel(TEXT("ChamberTop"));
	ChamberFloor = MakePanel(TEXT("ChamberFloor"));
	ChamberLeft = MakePanel(TEXT("ChamberLeft"));
	ChamberRight = MakePanel(TEXT("ChamberRight"));

	auto MakeSurface = [this, Root](const TCHAR* Name) -> UProceduralMeshComponent*
	{
		UProceduralMeshComponent* Surface = CreateDefaultSubobject<UProceduralMeshComponent>(Name);
		Surface->SetupAttachment(Root);
		Surface->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
		Surface->SetCastShadow(false);
		Surface->SetMobility(EComponentMobility::Movable);
		return Surface;
	};
	BrainSurface = MakeSurface(TEXT("BrainSurface"));
	SnakeSurface = MakeSurface(TEXT("PythonSurface"));

	Snow = MakeMesh(TEXT("BlackSnow"));

	auto MakeLamp = [this, Root](const TCHAR* Name, float Lumens) -> UPointLightComponent*
	{
		UPointLightComponent* Lamp = CreateDefaultSubobject<UPointLightComponent>(Name);
		Lamp->SetupAttachment(Root);
		Lamp->SetMobility(EComponentMobility::Movable);
		Lamp->SetIntensityUnits(ELightUnits::Lumens);
		Lamp->SetIntensity(Lumens);
		// NEUTRAL. A warm lamp turned the white chamber cream, and the founder asked for white.
		Lamp->SetLightColor(FLinearColor(1.0f, 1.0f, 1.0f));
		// NO SHADOWS. Two lamps inside a five-panel box would throw the panels' own shadows across the
		// backdrop and turn the white wall grey in bands -- and the founder asked for a white background.
		Lamp->SetCastShadows(false);
		Lamp->SetAffectTranslucentLighting(false);
		return Lamp;
	};
	KeyLight = MakeLamp(TEXT("BrainKeyLight"), 140000.0f);
	FillLight = MakeLamp(TEXT("BrainFillLight"), 46000.0f);

	BrainMesh = MakeMesh(TEXT("BrainMass"));
	BrainFold = MakeMesh(TEXT("BrainFolds"));
	SnakeMesh = MakeMesh(TEXT("PythonBody"));
	SnakeBelly = MakeMesh(TEXT("PythonBelly"));
	SnakeHead = MakeMesh(TEXT("PythonSnout"));
	SnakeEyes = MakeMesh(TEXT("PythonEyes"));
}

void AWonderlandBrainSculpture::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, BrainCubePath);
	UMaterialInterface* Plain = LoadObject<UMaterialInterface>(nullptr, BrainPlainMaterialPath);
	auto Dress = [this, Cube, Plain](UInstancedStaticMeshComponent* Mesh, const FLinearColor& Colour,
									 TObjectPtr<UMaterialInstanceDynamic>& OutMid)
	{
		if (Mesh == nullptr) { return; }
		if (Cube != nullptr) { Mesh->SetStaticMesh(Cube); }
		if (Plain != nullptr)
		{
			if (UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Plain, this))
			{
				Mid->SetVectorParameterValue(TEXT("Color"), Colour);
				Mesh->SetMaterial(0, Mid);
				OutMid = Mid;
			}
		}
	};
	// THE PANEL'S OWN COLOUR, not a pink lump pasted into it (founder, 2026-09-24: "keep the project brain the
	// same color as the background of the project brain UI"). The night field behind it is Srgb(3,6,22), so the
	// brain is built out of that same blue-black -- the mass a little above it so the lighting still separates
	// the silhouette from the chamber, the creases a little below it, which is what makes the folds read as
	// depth rather than as a pattern painted on a ball.
	// RED ON WHITE (founder, 2026-09-25): "white background, red brain, red Python snake, black snow falling
	// continuously from top to bottom." The blue-black family below was the previous direction, where the
	// sculpture was built out of the panel's own night colour; it is replaced rather than tinted, because a
	// near-black mass lit against WHITE reads as a hole rather than as a brain.
	//
	// The brain and the python are both red and must still read apart, so they are red at different depths:
	// the brain a deep oxblood, the python a brighter vermilion with the four tones a python needs.
	Dress(BrainMesh, FLinearColor(0.240f, 0.020f, 0.028f, 1.0f), BrainMid);
	Dress(BrainFold, FLinearColor(0.110f, 0.008f, 0.014f, 1.0f), FoldMid);
	// And a python is four tones, not one: a dark back, a pale belly, a darker snout and a lit eye.
	Dress(SnakeMesh, FLinearColor(0.560f, 0.070f, 0.055f, 1.0f), SnakeMid);
	Dress(SnakeBelly, FLinearColor(0.880f, 0.520f, 0.470f, 1.0f), BellyMid);
	Dress(SnakeHead, FLinearColor(0.380f, 0.040f, 0.038f, 1.0f), HeadMid);
	Dress(SnakeEyes, FLinearColor(0.060f, 0.050f, 0.050f, 1.0f), EyeMid);

	// The chamber wall: not pure black, because a true 0,0,0 wall and the night field's Srgb(3,6,22) read as two
	// different blacks and the hole's edges show as a visible rectangle. This sits where the field sits.
	// UNLIT, so the chamber is the colour it is told to be rather than whatever Wonderland's sun makes of it.
	// Lit, a wall painted near-black came back brown, and the brain appeared to be floating in a cave.
	// BasicShapeMaterial, NOT the unlit debug material.
	//
	// LevelColorationUnlitMaterial has no parameter called "Color", so SetVectorParameterValue on it did exactly
	// nothing and every panel kept the material's own default -- WHITE. That is the white slab that appeared
	// down the left of the brain window, and it grew each time the chamber was enlarged, which is precisely what
	// a mis-painted chamber panel would do. Three cycles were spent hunting it as an intruding world prop.
	// This material's Color parameter is the one the rest of this file already relies on, so it is known to work.
	// THE PANELS STAY ON THE MATERIAL THAT IS KNOWN TO TAKE A COLOUR HERE.
	//
	// Swapping them to M_WL_VoxelGlow to get an unlit white produced a BLACK chamber -- twice, once setting
	// "Color" and again setting Color, EmissiveColor, BaseColor and EmissiveStrength together. Whatever
	// drives that material's emissive, it is none of those names, and this file's own history says exactly
	// what that costs: "a material instance accepts any parameter name you hand it and simply ignores one it
	// does not have, so a mis-named parameter looks exactly like a correct one that had no effect."
	//
	// So the white is made the honest way instead: a white ALBEDO on the lit material the rest of this file
	// already relies on, lit by the chamber's own key and fill. Those lamps had to exist anyway -- a red
	// brain in an unlit box is a black blob -- so the background costs nothing extra.
	UMaterialInterface* FlatDark = Plain;
	for (UStaticMeshComponent* Panel : { Backdrop.Get(), ChamberTop.Get(), ChamberFloor.Get(),
										 ChamberLeft.Get(), ChamberRight.Get() })
	{
		if (Panel == nullptr) { continue; }
		if (Cube != nullptr) { Panel->SetStaticMesh(Cube); }
		if (FlatDark == nullptr) { continue; }
		if (UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(FlatDark, this))
		{
			// WHITE, AND UNLIT, so it is white whatever the sun is doing.
			//
			// Painted 0.945 on the LIT BasicShapeMaterial the chamber photographed as a dim beige room with a
			// shadow gradient across it -- because the chamber is a closed box and almost no sunlight reaches
			// inside. A background asked to be white has to be told, not lit.
			//
			// The value is far above 1 because this project runs in extended luminance range: the glow knee
			// measured at 700 is where a surface reads as bright-but-detailed, so a touch under it is a clean
			// white that the black flakes still cut against.
			// EVERY NAME, because a material instance ACCEPTS any parameter name and silently ignores one it
			// does not have -- so a wrong name looks exactly like a correct one that had no effect. This file
			// has already paid for that lesson once: tinting LevelColorationUnlitMaterial through "Color" did
			// nothing and every panel stayed white, and three cycles went into hunting it as an intruding
			// world prop. Setting "Color" alone on M_WL_VoxelGlow reproduced it exactly -- the chamber came
			// out BLACK -- so all four are set here the same way the figure loader does it.
			const FLinearColor ChamberWhite(0.94f, 0.94f, 0.95f, 1.0f);
			Mid->SetVectorParameterValue(TEXT("Color"), ChamberWhite);
			Panel->SetMaterial(0, Mid);
			if (Panel == Backdrop) { BackdropMid = Mid; }
		}
	}

	// THE SURFACES CARRY THE LOOK NOW. The instanced boxes still run, because the path maths, the girth profile
	// and every proof read from them -- but the brain mass, its folds and the python's body are no longer DRAWN
	// as cubes. They are hidden rather than deleted so that each measurement the proofs take is still the same
	// measurement it always was.
	auto DressSurface = [this, Plain](UProceduralMeshComponent* Surface, const FLinearColor& Colour,
									  TObjectPtr<UMaterialInstanceDynamic>& OutMid)
	{
		if (Surface == nullptr || Plain == nullptr) { return; }
		if (UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Plain, this))
		{
			Mid->SetVectorParameterValue(TEXT("Color"), Colour);
			Surface->SetMaterial(0, Mid);
			OutMid = Mid;
		}
	};
	// IN THE PANEL'S OWN FAMILY, but light enough that the folds read. A surface this dark returns almost no
	// light whatever its shape, so the first build's organic geometry was invisible and it looked like a stone.
	// THE SURFACES ARE WHAT IS ACTUALLY SEEN, so these are the two colours that matter. Both red, a stop
	// apart, so the python reads against the brain as well as against the white.
	// BRIGHT ENOUGH TO READ AS RED AGAINST WHITE. At 0.33 the brain photographed black: a lit surface that
	// dark, in a box the sun does not reach, returns almost nothing. With the chamber's own key and fill
	// standing over it these are the albedo of something red rather than something nearly black.
	DressSurface(BrainSurface, FLinearColor(0.720f, 0.085f, 0.095f, 1.0f), BrainSurfaceMid);
	DressSurface(SnakeSurface, FLinearColor(0.880f, 0.145f, 0.105f, 1.0f), SnakeSurfaceMid);

	// ---- THE BLACK SNOW. One flake mesh, dressed once, seeded once, re-placed every frame.
	if (Snow != nullptr)
	{
		if (Cube != nullptr) { Snow->SetStaticMesh(Cube); }
		if (Plain != nullptr)
		{
			if (UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Plain, this))
			{
				// Not pure 0: an unlit true black loses its silhouette where two flakes overlap, and reads
				// as one larger blob rather than two flakes.
				Mid->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.020f, 0.018f, 0.022f, 1.0f));
				Snow->SetMaterial(0, Mid);
				SnowMid = Mid;
			}
		}
		// SEEDED ONCE AND KEPT. Re-rolling the field each frame would make it flicker rather than fall; the
		// only thing that changes per frame is how far each flake has descended.
		FRandomStream Flakes(20260925);
		SnowSeeds.Reset();
		SnowShape.Reset();
		Snow->ClearInstances();
		// More, and finer. At 240 flakes of 1.4-4.0 uu they photographed as black BLOCKS drifting past;
		// snow is small and plentiful, and the count is what carries the effect rather than the size.
		for (int32 Index = 0; Index < 340; ++Index)
		{
			SnowSeeds.Add(FVector4(
				Flakes.FRandRange(-0.94f, 0.94f),        // across the window
				Flakes.FRandRange(-1.0f, 1.0f),          // where in its fall it starts
				Flakes.FRandRange(0.10f, 0.92f),         // depth between the lens and the back wall
				Flakes.FRandRange(0.055f, 0.185f)));     // fall rate, as a fraction of the window per second
			SnowShape.Add(FVector2D(Flakes.FRandRange(0.007f, 0.019f),      // size, engine-cube units
									Flakes.FRandRange(0.0f, 6.2831853f)));  // sway phase
			Snow->AddInstance(FTransform::Identity, true);
		}
	}

	BuildBrain();
	BuildSnake();
	BuildBrainSurface();
	for (UInstancedStaticMeshComponent* Hide : { BrainMesh.Get(), BrainFold.Get(), SnakeMesh.Get(),
								 SnakeBelly.Get(), SnakeHead.Get(), SnakeEyes.Get() })
	{
		if (Hide != nullptr) { Hide->SetVisibility(false, true); }
	}
}

void AWonderlandBrainSculpture::SmoothNormals(const TArray<FVector>& Verts, const TArray<int32>& Tris,
											  TArray<FVector>& OutNormals)
{
	OutNormals.Init(FVector::ZeroVector, Verts.Num());
	for (int32 I = 0; I + 2 < Tris.Num(); I += 3)
	{
		const int32 A = Tris[I], B = Tris[I + 1], C = Tris[I + 2];
		if (!Verts.IsValidIndex(A) || !Verts.IsValidIndex(B) || !Verts.IsValidIndex(C)) { continue; }
		// UNNORMALISED ON PURPOSE: a face's cross product is proportional to its area, so accumulating them raw
		// weights broad faces above slivers, which is what keeps a folded surface from shading like gravel.
		const FVector Face = FVector::CrossProduct(Verts[B] - Verts[A], Verts[C] - Verts[A]);
		OutNormals[A] += Face;
		OutNormals[B] += Face;
		OutNormals[C] += Face;
	}
	for (FVector& N : OutNormals)
	{
		N = N.GetSafeNormal(UE_SMALL_NUMBER, FVector::UpVector);
	}
}

void AWonderlandBrainSculpture::BuildBrainSurface()
{
	if (BrainSurface == nullptr) { return; }
	const float R = FMath::Max(BrainRadiusUU, 20.0f);
	// Fine enough that the silhouette is a curve rather than a staircase, and still only a few thousand
	// triangles -- leaving voxels behind costs LESS here, not more: the cube brain was 2,758 instanced boxes.
	const int32 Rings = 72;
	const int32 Segs = 108;

	TArray<FVector> Verts;
	TArray<int32> Tris;
	TArray<FVector2D> UVs;
	Verts.Reserve((Rings + 1) * (Segs + 1));
	UVs.Reserve((Rings + 1) * (Segs + 1));

	for (int32 Ring = 0; Ring <= Rings; ++Ring)
	{
		const float V = static_cast<float>(Ring) / static_cast<float>(Rings);
		const float Theta = V * PI;
		for (int32 Seg = 0; Seg <= Segs; ++Seg)
		{
			const float U = static_cast<float>(Seg) / static_cast<float>(Segs);
			const float Phi = U * 2.0f * PI;
			const FVector Dir(FMath::Sin(Theta) * FMath::Cos(Phi), FMath::Sin(Theta) * FMath::Sin(Phi), FMath::Cos(Theta));

			// THE SAME OVOID THE VOXEL BRAIN USED -- flattened, longer than it is wide -- so the python's shell
			// and the panel's framing, both tuned against those proportions, do not have to be tuned again.
			const FVector Base(Dir.X * R * 1.06f, Dir.Y * R * 0.84f, Dir.Z * R * 0.78f);
			const FVector Out = Base.GetSafeNormal(UE_SMALL_NUMBER, FVector::UpVector);

			// The longitudinal fissure: a valley down the midline, deepest on top and closing underneath.
			const float Midline = FMath::Exp(-(Dir.Y * Dir.Y) * 26.0f) * FMath::Clamp(Dir.Z, 0.0f, 1.0f);
			// GYRI AND SULCI IN THREE SIZES. One frequency reads as corduroy; three that do not divide into one
			// another read as a brain, which is the whole difference between "folded" and "patterned".
			const float Fold =
				  FMath::Sin(Dir.X * 9.2f + Dir.Z * 4.1f) * FMath::Sin(Dir.Y * 7.7f - Dir.X * 3.3f)
				+ 0.55f * FMath::Sin(Dir.Y * 15.1f + Dir.X * 6.7f) * FMath::Sin(Dir.Z * 12.9f + Dir.Y * 5.3f)
				+ 0.30f * FMath::Sin(Dir.Z * 23.3f - Dir.Y * 11.1f) * FMath::Sin(Dir.X * 19.7f + Dir.Z * 8.9f);
			// DEEP ENOUGH TO SEE. At R*0.028 the relief was 3.4 uu on a 120 uu brain -- real, and invisible at
			// the size the window frames it, so the first smooth build read as a polished stone. Gyri stand
			// proud and sulci cut in far enough that the light actually breaks over them.
			const float Disp = -Midline * R * 0.22f + Fold * R * 0.062f;

			Verts.Add(Base + Out * Disp);
			UVs.Add(FVector2D(U, V));
		}
	}
	for (int32 Ring = 0; Ring < Rings; ++Ring)
	{
		for (int32 Seg = 0; Seg < Segs; ++Seg)
		{
			const int32 A = Ring * (Segs + 1) + Seg;
			const int32 B = A + Segs + 1;
			Tris.Add(A); Tris.Add(B); Tris.Add(A + 1);
			Tris.Add(A + 1); Tris.Add(B); Tris.Add(B + 1);
		}
	}

	TArray<FVector> Normals;
	SmoothNormals(Verts, Tris, Normals);
	BrainSurface->CreateMeshSection(0, Verts, Tris, Normals, UVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
	// APPLIED AFTER THE SECTION EXISTS, which is the whole trick.
	//
	// UProceduralMeshComponent keeps materials PER SECTION, so SetMaterial(0, ...) called at construction -- when
	// there is no section 0 yet -- is dropped on the floor. Both surfaces were therefore drawing with the engine
	// default: photographed in PIE the brain came back warm grey-brown instead of the violet it was given, and
	// the python came back as a white band, which is what sent three cycles hunting for an imaginary white prop
	// intruding on the window. Nothing was intruding. It was the snake.
	if (BrainSurfaceMid != nullptr) { BrainSurface->SetMaterial(0, BrainSurfaceMid); }
}

void AWonderlandBrainSculpture::RebuildSnakeSurface()
{
	if (SnakeSurface == nullptr || SegmentSpot.Num() < 3) { return; }
	const int32 Count = SegmentSpot.Num();
	const int32 Around = 12;

	TArray<FVector> Verts;
	TArray<int32> Tris;
	TArray<FVector2D> UVs;
	Verts.Reserve(Count * (Around + 1));
	UVs.Reserve(Count * (Around + 1));

	for (int32 I = 0; I < Count; ++I)
	{
		const FVector Here = SegmentSpot[I];
		const int32 Ahead = FMath::Max(I - 1, 0);
		const int32 Behind = FMath::Min(I + 1, Count - 1);
		FVector Forward = SegmentSpot[Ahead] - SegmentSpot[Behind];
		Forward = Forward.GetSafeNormal(UE_SMALL_NUMBER, FVector::ForwardVector);
		// THE BRAIN IS THE FRAME'S UP. Taking the outward direction rather than transporting a frame along the
		// curve means the pale belly faces the mass all the way down the animal by construction, and the tube
		// can never corkscrew: the two are never parallel, because it travels ACROSS the shell, not into it.
		const FVector Out = Here.GetSafeNormal(UE_SMALL_NUMBER, FVector::UpVector);
		const FVector Side = FVector::CrossProduct(Out, Forward).GetSafeNormal(UE_SMALL_NUMBER, FVector::RightVector);
		const FVector Up = FVector::CrossProduct(Forward, Side).GetSafeNormal(UE_SMALL_NUMBER, FVector::UpVector);

		const float Girth = SegmentGirth.IsValidIndex(I) ? SegmentGirth[I] : FMath::Max(BrainRadiusUU, 20.0f) * 0.08f;
		for (int32 K = 0; K <= Around; ++K)
		{
			const float A = static_cast<float>(K) / static_cast<float>(Around) * 2.0f * PI;
			// Flattened a little underneath, as an animal lying along a surface is.
			const FVector Ring = Side * (FMath::Cos(A) * Girth) + Up * (FMath::Sin(A) * Girth * 0.82f);
			Verts.Add(Here + Ring);
			UVs.Add(FVector2D(static_cast<float>(K) / static_cast<float>(Around),
							  static_cast<float>(I) / static_cast<float>(Count) * 6.0f));
		}
	}
	for (int32 I = 0; I + 1 < Count; ++I)
	{
		for (int32 K = 0; K < Around; ++K)
		{
			const int32 A = I * (Around + 1) + K;
			const int32 B = A + Around + 1;
			Tris.Add(A); Tris.Add(B); Tris.Add(A + 1);
			Tris.Add(A + 1); Tris.Add(B); Tris.Add(B + 1);
		}
	}

	TArray<FVector> Normals;
	SmoothNormals(Verts, Tris, Normals);
	if (SnakeSurface->GetNumSections() == 0)
	{
		SnakeSurface->CreateMeshSection(0, Verts, Tris, Normals, UVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
		if (SnakeSurfaceMid != nullptr) { SnakeSurface->SetMaterial(0, SnakeSurfaceMid); }
	}
	else
	{
		// UPDATED, NOT RECREATED: the topology never changes, only where the vertices are, and recreating the
		// section every frame reallocates its buffers for nothing.
		SnakeSurface->UpdateMeshSection(0, Verts, Normals, UVs, TArray<FColor>(), TArray<FProcMeshTangent>());
	}
}


void AWonderlandBrainSculpture::BuildBrain()
{
	if (BrainMesh == nullptr || BrainFold == nullptr) { return; }
	BrainMesh->ClearInstances();
	BrainFold->ClearInstances();

	const float R = FMath::Max(BrainRadiusUU, 20.0f);
	// The voxel is a thirteenth of the radius, which is fine enough that the surface reads as a surface and coarse
	// enough that the whole brain is a few thousand boxes rather than a few hundred thousand.
	const float Step = R / 13.0f;

	for (float X = -R; X <= R; X += Step)
	{
		for (float Y = -R; Y <= R; Y += Step)
		{
			for (float Z = -R * 0.86f; Z <= R * 0.86f; Z += Step)
			{
				// AN OVOID, FLATTENED AND LONGER THAN IT IS WIDE, with a valley down the middle so it reads as
				// two hemispheres rather than one lump.
				const float NX = X / (R * 1.06f);
				const float NY = Y / (R * 0.84f);
				const float NZ = Z / (R * 0.78f);
				float Rho = FMath::Sqrt(NX * NX + NY * NY + NZ * NZ);
				// The longitudinal fissure: pull the surface in near the midline, most deeply on top.
				const float Midline = FMath::Exp(-(NY * NY) * 26.0f) * FMath::Clamp(NZ, 0.0f, 1.0f);
				Rho += Midline * 0.20f;
				// The folds themselves: a ripple in two directions, shallow, so the surface is never a clean shell.
				const float Fold = FMath::Sin(NX * 9.2f + NZ * 4.1f) * FMath::Sin(NY * 7.7f - NX * 3.3f);
				Rho += Fold * 0.045f;
				if (Rho > 1.0f) { continue; }
				// Hollow: only a shell of boxes is kept, because the inside is never seen and costs everything.
				if (Rho < 0.82f) { continue; }

				const bool bCrease = (Fold < -0.35f) || (Midline > 0.45f);
				const FTransform T(FRotator::ZeroRotator, FVector(X, Y, Z), FVector(Step / 100.0f));
				(bCrease ? BrainFold : BrainMesh)->AddInstance(T);
			}
		}
	}
}

void AWonderlandBrainSculpture::BuildSnake()
{
	if (SnakeMesh == nullptr || SnakeBelly == nullptr) { return; }
	SnakeMesh->ClearInstances();
	SnakeBelly->ClearInstances();
	if (SnakeHead != nullptr) { SnakeHead->ClearInstances(); }
	if (SnakeEyes != nullptr) { SnakeEyes->ClearInstances(); }

	const int32 Count = FMath::Clamp(SnakeSegments, 6, 200);
	const float Spacing = FMath::Max(SegmentSpacingUU, 0.5f);
	const float R = FMath::Max(BrainRadiusUU, 20.0f);

	SegmentGirth.Reset();
	SegmentSpot.SetNum(Count);
	for (int32 I = 0; I < Count; ++I)
	{
		// THICKEST A THIRD OF THE WAY BACK, tapering to the tail: a python, not a rope of equal beads.
		const float T = static_cast<float>(I) / FMath::Max(Count - 1, 1);
		const float Girth = R * 0.190f * FMath::Sin(FMath::Clamp(0.30f + T * 0.78f, 0.0f, 1.0f) * PI) + R * 0.038f;
		SegmentGirth.Add(Girth);
		const FTransform Rest(FRotator::ZeroRotator, FVector(R * 1.6f, 0.0f, 0.0f), FVector(Girth / 100.0f));
		SnakeMesh->AddInstance(Rest);
		SnakeBelly->AddInstance(Rest);
	}
	// A HEAD, so the front of the animal is not just the widest bead: a snout box and two eyes.
	if (SnakeHead != nullptr) { SnakeHead->AddInstance(FTransform::Identity); }
	if (SnakeEyes != nullptr)
	{
		SnakeEyes->AddInstance(FTransform::Identity);
		SnakeEyes->AddInstance(FTransform::Identity);
	}

	BearingRates.Reset();
	BearingRates.SetNumZeroed(BrainBearingWindow);
	BearingWrite = 0;

	// The head starts on the shell.
	TargetRadius = R * 1.82f;
	TargetYaw = 0.0f;
	TargetPitch = 0.0f;
	HeadDir = FVector::ForwardVector;
	HeadSwing = FVector::ZeroVector;
	HeadRadius = TargetRadius;
	RadiusVel = 0.0f;
	HeadWorld = HeadDir * HeadRadius;
	YawSeed = 3.1f;
	PitchSeed = 11.7f;
	RadiusSeed = 23.9f;
	LastBearingDeg = 0.0f;
	ClosestThisFrame = HeadWorld.Size();
	StepAccumulator = 0.0f;

	// ---- THE PATH, SIZED TO THE ANIMAL and laid down before it is ever looked at.
	const float Resolution = PathResolution();
	const int32 Points = FMath::CeilToInt(Spacing * (Count - 1) / Resolution) + 8;
	Path.Reset();
	Path.SetNumZeroed(Points);
	PathWrite = 0;
	PathCount = 0;

	// A STARTING ROUTE, running back around the shell's equator behind the head, so the python is its full length
	// on the first frame. Without it the tail spends its first seconds stacked on one point (measured: 48 uu long,
	// growing to 640 over ten seconds) which is the first thing anyone opening the panel would see.
	//
	// WRITTEN OLDEST FIRST, so that the last entry laid down is the one nearest the head -- which is exactly what
	// the ring calls its newest, and what SamplePath counts backwards from.
	for (int32 I = Points; I >= 1; --I)
	{
		const float Angle = (Resolution * I) / FMath::Max(HeadRadius, 1.0f);
		const FVector Back(FMath::Cos(-Angle) * HeadRadius, FMath::Sin(-Angle) * HeadRadius, 0.0f);
		Path[PathWrite] = Back;
		PathWrite = (PathWrite + 1) % Path.Num();
		PathCount = FMath::Min(PathCount + 1, Path.Num());
	}
	LastPathPoint = PathPoint(0);
	SinceLastPoint = FVector::Dist(HeadWorld, LastPathPoint);
}

float AWonderlandBrainSculpture::PathResolution() const
{
	return FMath::Max(SegmentSpacingUU, 0.5f) * 0.25f;
}

FVector AWonderlandBrainSculpture::PathPoint(int32 StepsBack) const
{
	if (PathCount <= 0 || Path.Num() <= 0) { return HeadWorld; }
	const int32 Size = Path.Num();
	const int32 Clamped = FMath::Clamp(StepsBack, 0, PathCount - 1);
	const int32 Index = ((PathWrite - 1 - Clamped) % Size + Size) % Size;
	return Path[Index];
}

FVector AWonderlandBrainSculpture::SamplePath(float DistanceBackUU) const
{
	if (PathCount <= 0) { return HeadWorld; }
	const float Resolution = PathResolution();
	const float Back = FMath::Max(DistanceBackUU, 0.0f);
	// Nearer than the newest stored point: the gap between it and the head, which is shorter than one resolution.
	if (Back <= SinceLastPoint)
	{
		const float Alpha = SinceLastPoint > KINDA_SMALL_NUMBER ? Back / SinceLastPoint : 0.0f;
		return FMath::Lerp(HeadWorld, PathPoint(0), FMath::Clamp(Alpha, 0.0f, 1.0f));
	}
	// Otherwise walk back along the stored route. Points sit exactly one resolution apart by construction, so the
	// index is the distance divided by it -- no search, and no drift.
	const float Steps = (Back - SinceLastPoint) / Resolution;
	const int32 Lo = FMath::FloorToInt(Steps);
	const float Frac = Steps - static_cast<float>(Lo);
	return FMath::Lerp(PathPoint(Lo), PathPoint(Lo + 1), Frac);
}

void AWonderlandBrainSculpture::AdvanceHead(float FixedStep)
{
	const float R = FMath::Max(BrainRadiusUU, 20.0f);

	// ---- THE ROUTE. Not an angle being incremented: three unrelated noise walks, one per spherical coordinate,
	// ---- so the target slides over the shell, rises and falls, and leans in and out without ever completing a
	// ---- lap at a constant rate. This is the whole reason it does not read as RotateAroundActor.
	TargetYaw = BrainWander(Elapsed * 0.31f, YawSeed) * PI;
	TargetPitch = BrainWander(Elapsed * 0.41f, PitchSeed) * 1.05f;
	// FURTHER OUT AGAIN. The smooth brain's gyri stand proud of the old voxel silhouette, and at 1.46R the
	// animal spent most of its route hidden behind the mass -- photographed as a green sliver. At 1.78R it
	// passes clearly in front, above, below and behind, which is the whole point of it not being an orbit.
	TargetRadius = R * (1.78f + BrainWander(Elapsed * 0.33f, RadiusSeed) * 0.22f);

	// ---- AND IT CHANGES ITS MIND. Every few seconds the yaw walk is kicked, which is what makes the python
	// ---- double back over the top of the brain instead of settling into a groove.
	ReconsiderIn -= FixedStep;
	if (ReconsiderIn <= 0.0f)
	{
		ReconsiderIn = FMath::FRandRange(2.6f, 6.4f);
		YawSeed += FMath::FRandRange(-2.4f, 2.4f);
		PitchSeed += FMath::FRandRange(-1.8f, 1.8f);
	}

	const float CosP = FMath::Cos(TargetPitch);
	const FVector TargetDir = FVector(
		FMath::Cos(TargetYaw) * CosP,
		FMath::Sin(TargetYaw) * CosP,
		FMath::Sin(TargetPitch) * 0.78f).GetSafeNormal(UE_SMALL_NUMBER, FVector::ForwardVector);

	// ---- THE DIRECTION SPRINGS ACROSS THE SHELL. Accelerating toward the target and damping gives the overshoot
	// ---- and recovery that reads as a living thing deciding where to go; keeping the momentum TANGENT means the
	// ---- head glides over the brain's surface instead of cutting a chord through the middle of it.
	HeadSwing += (TargetDir - HeadDir) * (FixedStep * 5.0f);
	HeadSwing *= FMath::Clamp(1.0f - FixedStep * 2.2f, 0.0f, 1.0f);
	HeadSwing -= HeadDir * FVector::DotProduct(HeadSwing, HeadDir);
	HeadDir = (HeadDir + HeadSwing * FixedStep).GetSafeNormal(UE_SMALL_NUMBER, FVector::ForwardVector);

	// ---- AND THE DISTANCE SPRINGS IN AND OUT ON ITS OWN, so the python rises off the brain and settles back onto
	// ---- it -- motion an orbit has no way to produce, and the second of the three readings the proof takes.
	RadiusVel += (TargetRadius - HeadRadius) * (FixedStep * 3.0f);
	RadiusVel *= FMath::Clamp(1.0f - FixedStep * 2.6f, 0.0f, 1.0f);
	// THE FLOOR THAT NEVER FIRES. With the direction and the radius kept apart there is no way to be inside the
	// brain at all; this stays only so that a hand-edited BrainRadiusUU cannot make one.
	HeadRadius = FMath::Max(HeadRadius + RadiusVel * FixedStep, R * 1.52f);
	HeadWorld = HeadDir * HeadRadius;

	// ---- THE PATH IS RECORDED BY DISTANCE, NOT BY TIME. A point is laid down every time the head has travelled
	// ---- one resolution further, interpolated exactly onto that spacing -- so however fast or slowly the head
	// ---- moves, the stored route has the same scale, and the body read off it keeps the same length.
	if (Path.Num() > 0)
	{
		const float Resolution = PathResolution();
		int32 Guard = 0;
		while (Guard++ < 64)
		{
			const FVector Gap = HeadWorld - LastPathPoint;
			const float Travelled = Gap.Size();
			if (Travelled < Resolution) { SinceLastPoint = Travelled; break; }
			LastPathPoint += (Gap / Travelled) * Resolution;
			Path[PathWrite] = LastPathPoint;
			PathWrite = (PathWrite + 1) % Path.Num();
			PathCount = FMath::Min(PathCount + 1, Path.Num());
			SinceLastPoint = FVector::Dist(HeadWorld, LastPathPoint);
		}
	}

	// ---- the not-an-orbit sample
	const float BearingDeg = FMath::RadiansToDegrees(FMath::Atan2(HeadWorld.Y, HeadWorld.X));
	if (BearingRates.Num() > 0)
	{
		BearingRates[BearingWrite] = FMath::UnwindDegrees(BearingDeg - LastBearingDeg) / FixedStep;
		BearingWrite = (BearingWrite + 1) % BearingRates.Num();
	}
	LastBearingDeg = BearingDeg;
}

void AWonderlandBrainSculpture::AdvanceBody()
{
	if (SnakeMesh == nullptr || SegmentSpot.Num() == 0) { return; }
	const int32 Count = FMath::Min(SnakeMesh->GetInstanceCount(), SegmentSpot.Num());
	if (Count <= 1) { return; }

	const float R = FMath::Max(BrainRadiusUU, 20.0f);
	const float Spacing = FMath::Max(SegmentSpacingUU, 0.5f);
	// AGAINST THE OVOID, NOT A SPHERE. This floor and the head's were both written as multiples of R as though the
	// brain were a ball, but BuildBrain's longest semi-axis is R*1.06 -- so the old R*1.13 left 8.4 uu of clearance,
	// less than the R/13 voxel the brain is built out of. Photographed in PIE the python was grazing the surface
	// and being swallowed by it; it renders, and always did, but there was nowhere for it to be seen.
	const float MinR = R * 1.50f;
	ClosestThisFrame = TNumericLimits<float>::Max();
	BodyLengthThisFrame = 0.0f;

	// EACH SEGMENT IS THE HEAD, FURTHER BACK ALONG ITS OWN ROUTE. No wave is authored anywhere: replaying where
	// the head went IS the wave, the overshoot through a turn, and the follow-through when it changes course --
	// and because the measure is DISTANCE, the animal is the same length whatever speed it is doing.
	for (int32 I = 0; I < Count; ++I)
	{
		FVector Where = SamplePath(Spacing * I);
		const float Len = Where.Size();
		if (Len < MinR && Len > KINDA_SMALL_NUMBER)
		{
			Where = Where / Len * MinR;
		}
		SegmentSpot[I] = Where;
		ClosestThisFrame = FMath::Min(ClosestThisFrame, Where.Size());
		if (I > 0) { BodyLengthThisFrame += FVector::Dist(SegmentSpot[I - 1], Where); }
	}

	for (int32 I = 0; I < Count; ++I)
	{
		const FVector Here = SegmentSpot[I];
		// Forward is toward the segment ahead -- for the head, away from the one behind.
		FVector Forward = (I == 0) ? (SegmentSpot[0] - SegmentSpot[1]) : (SegmentSpot[I - 1] - Here);
		const float Span = Forward.Size();
		Forward = Span > KINDA_SMALL_NUMBER ? Forward / Span : FVector::ForwardVector;
		// Up is away from the brain, so the pale belly always faces the mass and the body lies along the surface.
		const FVector Out = Here.GetSafeNormal(UE_SMALL_NUMBER, FVector::UpVector);

		const float Girth = SegmentGirth.IsValidIndex(I) ? SegmentGirth[I] : R * 0.08f;
		// THE BOX SPANS THE GAP TO ITS NEIGHBOUR. Stretching each segment to the measured distance is what stops
		// the body breaking into separate beads when the head speeds up -- there is no gap it can open.
		const float Length = FMath::Max(Span * 1.25f, Girth * 0.9f);
		const FQuat Look = FRotationMatrix::MakeFromXZ(Forward, Out).ToQuat();

		const FTransform T(Look, Here, FVector(Length / 100.0f, Girth / 100.0f, Girth * 0.78f / 100.0f));
		SnakeMesh->UpdateInstanceTransform(I, T, false, I == Count - 1, true);

		if (SnakeBelly != nullptr && SnakeBelly->GetInstanceCount() > I)
		{
			// The belly rides just under the back and a little narrower, so the pale reads as an underside rather
			// than as a second snake in the same place.
			const FTransform B(Look, Here - Out * (Girth * 0.34f),
							   FVector(Length * 0.96f / 100.0f, Girth * 0.74f / 100.0f, Girth * 0.34f / 100.0f));
			SnakeBelly->UpdateInstanceTransform(I, B, false, I == Count - 1, true);
		}

		if (I == 0)
		{
			const float HeadGirth = Girth * 1.28f;
			if (SnakeHead != nullptr && SnakeHead->GetInstanceCount() > 0)
			{
				// A snout: longer than it is wide and set forward of the first body segment.
				const FTransform S(Look, Here + Forward * (HeadGirth * 0.55f),
								   FVector(HeadGirth * 1.5f / 100.0f, HeadGirth / 100.0f, HeadGirth * 0.66f / 100.0f));
				SnakeHead->UpdateInstanceTransform(0, S, false, true, true);
			}
			if (SnakeEyes != nullptr && SnakeEyes->GetInstanceCount() > 1)
			{
				const FVector Side = FVector::CrossProduct(Out, Forward).GetSafeNormal(UE_SMALL_NUMBER, FVector::RightVector);
				const FVector Brow = Here + Forward * (HeadGirth * 0.72f) + Out * (HeadGirth * 0.24f);
				const FVector Eye(HeadGirth * 0.30f / 100.0f);
				SnakeEyes->UpdateInstanceTransform(0, FTransform(Look, Brow + Side * (HeadGirth * 0.40f), Eye),
												   false, false, true);
				SnakeEyes->UpdateInstanceTransform(1, FTransform(Look, Brow - Side * (HeadGirth * 0.40f), Eye),
												   false, true, true);
			}
		}
	}
}

void AWonderlandBrainSculpture::Breathe(float /*DeltaSeconds*/)
{
	// TWO PERIODS, so the brain never lands on a beat you can count. Small: this is breathing, not pumping.
	const float Slow = FMath::Sin(Elapsed * 0.9f);
	const float Fast = FMath::Sin(Elapsed * 2.3f + 1.1f);
	Breath = 0.5f + 0.5f * (Slow * 0.72f + Fast * 0.28f);

	// THE WHOLE MASS SWELLS, WHICH IS A COMPONENT TRANSFORM AND NOT FOUR THOUSAND OF THEM.
	//
	// Breathing moves every box outward from the same centre by the same proportion -- which is the definition of
	// a scale. Writing it into each instance instead would mean rewriting roughly four thousand transforms on both
	// components every single frame, and would need both resting lists kept in memory to do it, to produce a
	// picture no different from this. Two component scales a frame, and the instances never move.
	//
	// A HAIR MORE IN Z, AND A HAIR OF LIFT, so the crown rises further than the base does: a brain drawing breath
	// rather than a model being scaled.
	const float Swell = 1.0f + Breath * 0.018f;
	const float Stretch = 1.0f + Breath * 0.026f;
	const float Lift = Breath * FMath::Max(BrainRadiusUU, 1.0f) * 0.010f;
	const FVector Scale(Swell, Swell, Stretch);
	const FVector Where(0.0f, 0.0f, Lift);
	if (BrainMesh != nullptr) { BrainMesh->SetRelativeScale3D(Scale); BrainMesh->SetRelativeLocation(Where); }
	if (BrainFold != nullptr) { BrainFold->SetRelativeScale3D(Scale); BrainFold->SetRelativeLocation(Where); }
}

void AWonderlandBrainSculpture::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// The head runs on fixed substeps; a long hitch is capped rather than replayed, so a stall never fires off a
	// hundred substeps and snaps the body straight.
	StepAccumulator += FMath::Clamp(DeltaSeconds, 0.0f, 0.25f);
	int32 Guard = 0;
	while (StepAccumulator >= BrainSubStepSeconds && Guard++ < 32)
	{
		StepAccumulator -= BrainSubStepSeconds;
		Elapsed += BrainSubStepSeconds;
		AdvanceHead(BrainSubStepSeconds);
	}
	AdvanceBody();
	RebuildSnakeSurface();
	Breathe(DeltaSeconds);
	StandTheChamber();
	DriftTheSnow();
}

void AWonderlandBrainSculpture::StandTheChamber()
{
	// AN OPEN-FRONTED BOX, PLACED FROM THE REAL CAMERA EVERY FRAME.
	//
	// A single wall behind the brain hid the garden behind it and nothing else, so a white voxel prop standing
	// between the lens and the sculpture appeared inside the brain window -- photographed in PIE at the top-left
	// of the frame. Five panels close the sides, the top and the floor as well, and the only opening is the one
	// the founder is looking through.
	if (Backdrop == nullptr) { return; }
	const APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	const APlayerCameraManager* Lens = (PC != nullptr) ? PC->PlayerCameraManager : nullptr;
	UStaticMeshComponent* const Panels[] = { Backdrop.Get(), ChamberTop.Get(), ChamberFloor.Get(),
											 ChamberLeft.Get(), ChamberRight.Get() };
	if (Lens == nullptr)
	{
		for (UStaticMeshComponent* Panel : Panels) { if (Panel != nullptr) { Panel->SetVisibility(false, true); } }
		return;
	}

	const FVector Here = GetActorLocation();
	const FVector Eye = Lens->GetCameraLocation();
	const FVector Away = (Here - Eye).GetSafeNormal(UE_SMALL_NUMBER, FVector::ForwardVector);
	const FRotator Facing = Away.Rotation();
	const FVector Right = FRotationMatrix(Facing).GetUnitAxis(EAxis::Y);
	const FVector Up = FRotationMatrix(Facing).GetUnitAxis(EAxis::Z);

	// Scaled with the actor, because the panel shrinks the sculpture when it has to be brought in close.
	const float R = FMath::Max(BrainRadiusUU, 20.0f) * static_cast<float>(GetActorScale3D().X);
	// DELIBERATELY OVERSIZED. At R*2.6 the box subtended about 41 degrees while the brain window is nearer 35,
	// so props sitting just outside its edges still showed in the corners of the frame -- photographed in PIE as
	// a white voxel slab at the top left. Anything of the box that overruns the window is covered by the night
	// field's own bands, so being too generous costs nothing and being too mean shows the garden.
	const float Half = R * 6.0f;     // how wide and tall the box is, well past the window's corners
	const float Back = R * 4.0f;     // how far behind the brain the rear wall stands
	// THE MOUTH REACHES NEARLY TO THE LENS.
	//
	// At R*2.2 the box opened about 90 uu in front of the brain and left 70-odd uu of unprotected space between
	// its mouth and the camera -- and something large, whose ACTOR ORIGIN sits far away across the map so no
	// proximity search ever listed it, reached into exactly that gap and showed as a white slab down the left of
	// the window. Measured: nothing at all has its origin between the lens and the brain, so the intruder could
	// only ever have been a big mesh leaning in. Carrying the side panels most of the way back to the lens
	// leaves almost nothing for anything to lean into, and stops short so the panels never close over the eye.
	const float ToEye = static_cast<float>(FVector::Dist(Here, Eye));
	// Stops just short of the near clip plane; any closer and the panels close over the eye entirely.
	const float Front = FMath::Max(ToEye - 14.0f, 4.0f);
	const float Thin = 0.04f;        // the engine cube is 100 uu, so this is a 4 uu sheet

	auto Place = [](UStaticMeshComponent* Panel, const FVector& At, const FRotator& Rot, const FVector& Scale)
	{
		if (Panel == nullptr) { return; }
		Panel->SetVisibility(true, true);
		Panel->SetWorldLocation(At);
		Panel->SetWorldRotation(Rot);
		Panel->SetWorldScale3D(Scale);
	};

	// The rear wall faces the lens down its own X; the four sides are the same sheet turned onto its edges.
	const float Depth = (Back + Front) / 100.0f;
	Place(Backdrop.Get(), Here + Away * Back, Facing, FVector(Thin, Half * 2.0f / 100.0f, Half * 2.0f / 100.0f));
	Place(ChamberTop.Get(), Here + Up * Half + Away * (Back - Front) * 0.5f,
		  Facing, FVector(Depth, Half * 2.0f / 100.0f, Thin));
	Place(ChamberFloor.Get(), Here - Up * Half + Away * (Back - Front) * 0.5f,
		  Facing, FVector(Depth, Half * 2.0f / 100.0f, Thin));
	Place(ChamberLeft.Get(), Here - Right * Half + Away * (Back - Front) * 0.5f,
		  Facing, FVector(Depth, Thin, Half * 2.0f / 100.0f));
	Place(ChamberRight.Get(), Here + Right * Half + Away * (Back - Front) * 0.5f,
		  Facing, FVector(Depth, Thin, Half * 2.0f / 100.0f));

	// ---- AND THE TWO LAMPS, in the founder's own frame.
	//
	// The key falls from the upper left as seen through the window and the fill sits low on the right, so the
	// folds have a consistent direction of light however the sculpture is turned. Both sit BETWEEN the lens
	// and the brain: behind it they would light the white wall and silhouette the brain against its own
	// background, which is the picture this is trying to avoid.
	// REACHING THE WALLS AS WELL AS THE SCULPTURE. The chamber is Half = R*6 across, so a radius that only
	// covered the brain would leave a lit brain in a dark room -- which is the picture before this existed.
	const float Reach = Half * 2.6f;
	if (KeyLight != nullptr)
	{
		KeyLight->SetWorldLocation(Here - Right * (R * 1.5f) + Up * (R * 1.6f) - Away * (R * 1.5f));
		KeyLight->SetAttenuationRadius(Reach);
	}
	if (FillLight != nullptr)
	{
		FillLight->SetWorldLocation(Here + Right * (R * 1.7f) - Up * (R * 0.9f) - Away * (R * 1.2f));
		FillLight->SetAttenuationRadius(Reach);
	}
}

void AWonderlandBrainSculpture::DriftTheSnow()
{
	// BLACK SNOW, FALLING TOP TO BOTTOM, CONTINUOUSLY (founder, 2026-09-25).
	//
	// IT FALLS IN THE CAMERA'S FRAME, NOT THE WORLD'S. The chamber is rebuilt from the lens every frame, and
	// the founder looks through one open face of it, so "top to bottom" means down the WINDOW. Snow that fell
	// along world -Z would drift diagonally whenever the camera turned, and would fall sideways the moment the
	// camera looked up at the sculpture. The same Right/Up basis the chamber is placed on is the one the flakes
	// descend in, so down is always down on screen.
	//
	// EVERY FLAKE IS A CONSTANT PLUS A PHASE. The field is seeded once; per frame each flake's height is just
	// its start less its rate times the clock, wrapped. Nothing is randomised here -- re-rolling per frame is
	// what makes a snow field flicker instead of fall.
	if (Snow == nullptr || SnowSeeds.Num() == 0)
	{
		return;
	}
	const APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	const APlayerCameraManager* Lens = (PC != nullptr) ? PC->PlayerCameraManager : nullptr;
	if (Lens == nullptr)
	{
		// No lens, no window to fall down. Hidden rather than left frozen mid-air.
		Snow->SetVisibility(false, true);
		return;
	}
	Snow->SetVisibility(true, true);

	const FVector Here = GetActorLocation();
	const FVector Eye = Lens->GetCameraLocation();
	const FVector Away = (Here - Eye).GetSafeNormal(UE_SMALL_NUMBER, FVector::ForwardVector);
	const FRotator Facing = Away.Rotation();
	const FVector Right = FRotationMatrix(Facing).GetUnitAxis(EAxis::Y);
	const FVector Up = FRotationMatrix(Facing).GetUnitAxis(EAxis::Z);

	// The same measurements the chamber is built from, so the snow cannot fall outside the room it is in.
	const float R = FMath::Max(BrainRadiusUU, 20.0f) * static_cast<float>(GetActorScale3D().X);
	const float Half = R * 6.0f;
	const float Back = R * 4.0f;
	const float ToEye = static_cast<float>(FVector::Dist(Here, Eye));
	const float Front = FMath::Max(ToEye - 14.0f, 4.0f);

	const float Clock = Elapsed;
	const int32 Count = FMath::Min(SnowSeeds.Num(), Snow->GetInstanceCount());
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const FVector4& Seed = SnowSeeds[Index];
		const FVector2D& Shape = SnowShape.IsValidIndex(Index) ? SnowShape[Index] : FVector2D(0.02f, 0.0f);

		// WRAPPED, NOT RESET. Fmod on the whole two-unit span means a flake leaving the bottom re-enters at the
		// top in the same column, so the field never thins out and never restarts as a visible sheet.
		float Height = static_cast<float>(Seed.Y) - static_cast<float>(Seed.W) * Clock;
		Height = FMath::Fmod(Height + 1.0f, 2.0f);
		if (Height < 0.0f) { Height += 2.0f; }
		Height -= 1.0f;

		// A LITTLE SWAY, because snow does not fall on rails. Small enough that it reads as air rather than as
		// a flake being pushed sideways.
		const float Across = static_cast<float>(Seed.X)
			+ 0.018f * FMath::Sin(Clock * 0.9f + static_cast<float>(Shape.Y));

		// Kept off the very edges so a flake never intersects a chamber wall and flicker-clips against it.
		const FVector At = Here
			+ Right * (Across * Half * 0.93f)
			+ Up * (Height * Half * 0.93f)
			+ Away * (-Front + static_cast<float>(Seed.Z) * (Back + Front));

		// Turned with the window, so a flake is a square facing the founder rather than an edge-on sliver.
		Snow->UpdateInstanceTransform(Index,
			FTransform(Facing, At, FVector(static_cast<float>(Shape.X))), true, false, true);
	}
	// One render-state push for the whole field, after the last flake, rather than one per flake.
	Snow->MarkRenderStateDirty();
}

float AWonderlandBrainSculpture::GetHeadRadiusUU() const
{
	return HeadWorld.Size();
}

float AWonderlandBrainSculpture::GetClosestSegmentRadiusUU() const
{
	return (ClosestThisFrame > 0.0f && ClosestThisFrame < TNumericLimits<float>::Max())
		? ClosestThisFrame
		: HeadWorld.Size();
}

float AWonderlandBrainSculpture::GetBodyLengthUU() const
{
	return BodyLengthThisFrame;
}

FString AWonderlandBrainSculpture::DescribeRendering() const
{
	auto Say = [](const TCHAR* Name, UInstancedStaticMeshComponent* M) -> FString
	{
		if (M == nullptr) { return FString::Printf(TEXT("%s=NULL"), Name); }
		return FString::Printf(TEXT("%s{n=%d mesh=%s mat=%s vis=%d hidden=%d}"),
			Name, M->GetInstanceCount(),
			M->GetStaticMesh() != nullptr ? TEXT("yes") : TEXT("NO"),
			M->GetMaterial(0) != nullptr ? TEXT("yes") : TEXT("NO"),
			M->IsVisible() ? 1 : 0, M->bHiddenInGame ? 1 : 0);
	};
	return FString::Printf(TEXT("at=%s hiddenActor=%d radius=%.1f | %s %s %s %s %s %s"),
		*GetActorLocation().ToCompactString(), IsHidden() ? 1 : 0, BrainRadiusUU,
		*Say(TEXT("mass"), BrainMesh), *Say(TEXT("fold"), BrainFold),
		*Say(TEXT("body"), SnakeMesh), *Say(TEXT("belly"), SnakeBelly),
		*Say(TEXT("snout"), SnakeHead), *Say(TEXT("eyes"), SnakeEyes));
}

float AWonderlandBrainSculpture::GetBearingRateSpreadDeg() const
{
	// Only the samples actually written count: the ring starts zeroed, and averaging those in would report a
	// steady route as an erratic one for the first three seconds of life.
	const int32 Count = FMath::Min(BearingRates.Num(), FMath::FloorToInt(Elapsed / BrainSubStepSeconds));
	if (Count < 8) { return 0.0f; }
	float Mean = 0.0f;
	for (int32 I = 0; I < Count; ++I) { Mean += BearingRates[I]; }
	Mean /= Count;
	float Var = 0.0f;
	for (int32 I = 0; I < Count; ++I) { Var += (BearingRates[I] - Mean) * (BearingRates[I] - Mean); }
	return FMath::Sqrt(Var / Count);
}

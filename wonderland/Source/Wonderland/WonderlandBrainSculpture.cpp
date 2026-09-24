#include "WonderlandBrainSculpture.h"

#include "Components/InstancedStaticMeshComponent.h"
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
	// A BRAIN IS NOT PINK PLASTIC. Two tones, a warm pale mass and a darker crease, so the folds read as depth
	// rather than as a pattern painted on a ball.
	Dress(BrainMesh, FLinearColor(0.78f, 0.62f, 0.66f, 1.0f), BrainMid);
	Dress(BrainFold, FLinearColor(0.44f, 0.30f, 0.36f, 1.0f), FoldMid);
	// And a python is four tones, not one: a dark back, a pale belly, a darker snout and a lit eye.
	Dress(SnakeMesh, FLinearColor(0.20f, 0.42f, 0.23f, 1.0f), SnakeMid);
	Dress(SnakeBelly, FLinearColor(0.76f, 0.77f, 0.52f, 1.0f), BellyMid);
	Dress(SnakeHead, FLinearColor(0.14f, 0.30f, 0.17f, 1.0f), HeadMid);
	Dress(SnakeEyes, FLinearColor(0.96f, 0.72f, 0.16f, 1.0f), EyeMid);

	BuildBrain();
	BuildSnake();
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
		const float Girth = R * 0.105f * FMath::Sin(FMath::Clamp(0.30f + T * 0.78f, 0.0f, 1.0f) * PI) + R * 0.020f;
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
	TargetRadius = R * 1.42f;
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
	TargetRadius = R * (1.38f + BrainWander(Elapsed * 0.33f, RadiusSeed) * 0.17f);

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
	HeadRadius = FMath::Max(HeadRadius + RadiusVel * FixedStep, R * 1.16f);
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
	const float MinR = R * 1.13f;
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
	Breathe(DeltaSeconds);
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

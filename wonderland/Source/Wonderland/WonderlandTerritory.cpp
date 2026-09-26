#include "WonderlandTerritory.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/Engine.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

namespace
{
	const TCHAR* const CubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
	/** LIT, for the stone and the ivory: they take the day cycle's light like every other surface in Wonderland. */
	const TCHAR* const LitPath = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
	/**
	 * UNLIT, for the ring and the core, and this is the whole of "readable in morning, afternoon, evening and
	 * night lighting": an unlit material renders the colour it is given whatever the sun is doing, so the
	 * marker's identity colour is the same at noon and at midnight.
	 */
	const TCHAR* const UnlitPath =
		TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");

	/** A marker is a gatepost, not a pin: six metres of standing stone. */
	constexpr float PylonHeight = 600.0f;
	constexpr float PlinthSide = 260.0f;

	void Paint(UInstancedStaticMeshComponent* Mesh, UMaterialInterface* Parent, const FLinearColor& Colour,
		UMaterialInstanceDynamic** OutMid = nullptr)
	{
		if (Mesh == nullptr || Parent == nullptr)
		{
			return;
		}
		if (UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Parent, Mesh))
		{
			// EVERY NAME THE STOCK MATERIALS USE. A material instance silently ignores a parameter it does not
			// have, so a mis-named one is indistinguishable from a correct one that did nothing -- the mistake
			// that left the brain's chamber panels white for three build cycles.
			Mid->SetVectorParameterValue(TEXT("Color"), Colour);
			Mid->SetVectorParameterValue(TEXT("BaseColor"), Colour);
			Mid->SetVectorParameterValue(TEXT("EmissiveColor"), Colour);
			Mesh->SetMaterial(0, Mid);
			if (OutMid != nullptr)
			{
				*OutMid = Mid;
			}
		}
	}
}

/* ---------------------------------------------------------------------------------------- the marker */

AWonderlandTerritoryCheckpoint::AWonderlandTerritoryCheckpoint()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	SetCanBeDamaged(false);

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	auto MakeMesh = [this](const TCHAR* Name) -> UInstancedStaticMeshComponent*
	{
		UInstancedStaticMeshComponent* Mesh = CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		Mesh->SetupAttachment(Root);
		Mesh->SetMobility(EComponentMobility::Movable);
		// NOTHING WALKS INTO A CHECKPOINT. It is a sign, and a sign the Dog can be stopped by is a wall.
		Mesh->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
		Mesh->SetGenerateOverlapEvents(false);
		Mesh->SetCanEverAffectNavigation(false);
		return Mesh;
	};
	Stone = MakeMesh(TEXT("Stone"));
	Ivory = MakeMesh(TEXT("Ivory"));
	Glow = MakeMesh(TEXT("Glow"));
	Stone->SetCastShadow(true);
	Ivory->SetCastShadow(true);
	Glow->SetCastShadow(false);

	Lamp = CreateDefaultSubobject<UPointLightComponent>(TEXT("Lamp"));
	Lamp->SetupAttachment(Root);
	Lamp->SetRelativeLocation(FVector(0.0, 0.0, PylonHeight * 0.92));
	Lamp->SetIntensityUnits(ELightUnits::Candelas);
	Lamp->SetIntensity(9.0f);
	Lamp->SetAttenuationRadius(900.0f);
	Lamp->SetCastShadows(false);
}

void AWonderlandTerritoryCheckpoint::Stand(const FWonderlandTerritory& Territory, bool bDiscovered)
{
	TerritoryId = Territory.Id;
	Accent = Territory.Accent;
	bFound = bDiscovered;
	HeightUU = PylonHeight;

	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, CubePath);
	UMaterialInterface* Lit = LoadObject<UMaterialInterface>(nullptr, LitPath);
	UMaterialInterface* Unlit = LoadObject<UMaterialInterface>(nullptr, UnlitPath);
	if (Cube == nullptr)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTERRITORY no cube; %s has no marker"), *TerritoryId.ToString());
		return;
	}
	for (UInstancedStaticMeshComponent* Mesh : {Stone.Get(), Ivory.Get(), Glow.Get()})
	{
		if (Mesh != nullptr)
		{
			Mesh->ClearInstances();
			Mesh->SetStaticMesh(Cube);
		}
	}
	Paint(Stone, Lit, FLinearColor(0.32f, 0.31f, 0.29f));
	Paint(Ivory, Lit, FLinearColor(0.88f, 0.86f, 0.80f));
	// THE RING CARRIES THE TERRITORY'S OWN COLOUR, well above white so it blooms a little and reads across a
	// plaza. Undiscovered it is dim: the founder asked for a DISCOVERED/UNDISCOVERED state and this is what it
	// looks like from a hundred metres away, before any panel is opened.
	UMaterialInstanceDynamic* Mid = nullptr;
	Paint(Glow, Unlit, Accent * (bFound ? 22.0f : 3.0f), &Mid);
	GlowMid = Mid;

	const float Unit = 100.0f;   // the engine cube is 100 uu across, so scale is size/100
	auto Block = [Unit](UInstancedStaticMeshComponent* Mesh, const FVector& Centre, const FVector& Size)
	{
		if (Mesh != nullptr)
		{
			Mesh->AddInstance(FTransform(FRotator::ZeroRotator, Centre, Size / Unit), false);
		}
	};

	// ---- THE PLINTH: three courses of stone, each a little narrower, so it reads as built and not extruded.
	Block(Stone, FVector(0.0, 0.0, 18.0), FVector(PlinthSide, PlinthSide, 36.0));
	Block(Stone, FVector(0.0, 0.0, 52.0), FVector(PlinthSide * 0.82f, PlinthSide * 0.82f, 34.0));
	Block(Stone, FVector(0.0, 0.0, 82.0), FVector(PlinthSide * 0.66f, PlinthSide * 0.66f, 28.0));

	// ---- THE PYLON: a slim ivory shaft with a shoulder near the top, in Wonderland's own stone-and-ivory.
	Block(Ivory, FVector(0.0, 0.0, PylonHeight * 0.52f), FVector(66.0, 66.0, PylonHeight * 0.80f));
	Block(Ivory, FVector(0.0, 0.0, PylonHeight * 0.90f), FVector(92.0, 92.0, 38.0));
	Block(Ivory, FVector(0.0, 0.0, PylonHeight * 0.98f), FVector(54.0, 54.0, 46.0));

	// ---- THE RING: eight blocks around the shoulder, which reads as a band rather than as eight blocks, and
	// ---- the core behind it. Together they are the thing that is seen first and from furthest away.
	for (int32 Step = 0; Step < 8; ++Step)
	{
		const float Angle = FMath::DegreesToRadians(Step * 45.0f);
		Block(Glow, FVector(FMath::Cos(Angle) * 74.0f, FMath::Sin(Angle) * 74.0f, PylonHeight * 0.90f),
			FVector(34.0, 34.0, 20.0));
	}
	Block(Glow, FVector(0.0, 0.0, PylonHeight * 0.62f), FVector(22.0, 22.0, 150.0));
	// And a medallion at the foot, so the marker is still legible from directly above it.
	for (int32 Step = 0; Step < 12; ++Step)
	{
		const float Angle = FMath::DegreesToRadians(Step * 30.0f);
		Block(Glow, FVector(FMath::Cos(Angle) * 168.0f, FMath::Sin(Angle) * 168.0f, 3.0),
			FVector(30.0, 30.0, 6.0));
	}

	if (Lamp != nullptr)
	{
		Lamp->SetLightColor(Accent);
		Lamp->SetIntensity(bFound ? 9.0f : 2.0f);
	}
}

void AWonderlandTerritoryCheckpoint::SetDiscovered(bool bDiscovered)
{
	if (bFound == bDiscovered)
	{
		return;
	}
	bFound = bDiscovered;
	if (GlowMid != nullptr)
	{
		const FLinearColor Want = Accent * (bFound ? 22.0f : 3.0f);
		GlowMid->SetVectorParameterValue(TEXT("Color"), Want);
		GlowMid->SetVectorParameterValue(TEXT("BaseColor"), Want);
		GlowMid->SetVectorParameterValue(TEXT("EmissiveColor"), Want);
	}
	if (Lamp != nullptr)
	{
		Lamp->SetIntensity(bFound ? 9.0f : 2.0f);
	}
}

void AWonderlandTerritoryCheckpoint::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (GlowMid == nullptr)
	{
		return;
	}
	// A SLOW BREATH, and a small one. The marker has to read as alive without becoming a flashing beacon --
	// the founder asked for "no clutter" and a pulsing sign on the horizon is clutter with a rhythm.
	Age += DeltaSeconds;
	const float Breath = 1.0f + 0.12f * FMath::Sin(2.0f * PI * Age / 4.5f);
	const FLinearColor Want = Accent * (bFound ? 22.0f : 3.0f) * Breath;
	GlowMid->SetVectorParameterValue(TEXT("Color"), Want);
	GlowMid->SetVectorParameterValue(TEXT("EmissiveColor"), Want);
}

/* ---------------------------------------------------------------------------------- who knows where we are */

bool UWonderlandTerritorySubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* World = Cast<UWorld>(Outer);
	return World != nullptr && World->IsGameWorld();
}

TStatId UWonderlandTerritorySubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UWonderlandTerritorySubsystem, STATGROUP_Tickables);
}

const TArray<FWonderlandTerritory>& UWonderlandTerritorySubsystem::GetTerritories() const
{
	return UWonderlandTerritorySettings::Get().Territories;
}

bool UWonderlandTerritorySubsystem::FindTerritory(FName Id, FWonderlandTerritory& Out) const
{
	for (const FWonderlandTerritory& Row : GetTerritories())
	{
		if (Row.Id == Id)
		{
			Out = Row;
			return true;
		}
	}
	return false;
}

FString UWonderlandTerritorySubsystem::DiscoveryPath()
{
	return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("TerritoriesFound.txt"));
}

void UWonderlandTerritorySubsystem::LoadDiscoveries()
{
	Discovered.Reset();
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *DiscoveryPath()))
	{
		return;
	}
	TArray<FString> Lines;
	Text.ParseIntoArrayLines(Lines);
	for (const FString& Line : Lines)
	{
		const FString Clean = Line.TrimStartAndEnd();
		if (!Clean.IsEmpty())
		{
			Discovered.Add(FName(*Clean));
		}
	}
}

void UWonderlandTerritorySubsystem::SaveDiscoveries() const
{
	TArray<FString> Lines;
	for (const FName& Id : Discovered)
	{
		Lines.Add(Id.ToString());
	}
	Lines.Sort();
	FFileHelper::SaveStringToFile(FString::Join(Lines, TEXT("\n")), *DiscoveryPath());
}

float UWonderlandTerritorySubsystem::GroundAt(const FVector2D& XY, float& OutFound) const
{
	OutFound = 0.0f;
	UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return 0.0f;
	}
	// TRACED FROM WELL ABOVE TO WELL BELOW. A marker placed at a guessed height either floats over a slope or
	// is buried in one, and Wonderland's ground is not flat past the plaza.
	FHitResult Hit;
	const FVector From(XY.X, XY.Y, 12000.0);
	const FVector To(XY.X, XY.Y, -6000.0);
	FCollisionQueryParams Params(SCENE_QUERY_STAT(WonderlandTerritoryGround), false);
	if (World->LineTraceSingleByChannel(Hit, From, To, ECC_Visibility, Params))
	{
		OutFound = 1.0f;
		return static_cast<float>(Hit.ImpactPoint.Z);
	}
	return 0.0f;
}

void UWonderlandTerritorySubsystem::StandTheCheckpoints()
{
	UWorld* World = GetWorld();
	if (World == nullptr || bStood)
	{
		return;
	}
	bStood = true;
	for (const FWonderlandTerritory& Row : GetTerritories())
	{
		if (!Row.IsValid())
		{
			continue;
		}
		float Found = 0.0f;
		const float Z = GroundAt(Row.CheckpointXY, Found);
		FActorSpawnParameters Params;
		Params.ObjectFlags |= RF_Transient;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		AWonderlandTerritoryCheckpoint* Marker = World->SpawnActor<AWonderlandTerritoryCheckpoint>(
			AWonderlandTerritoryCheckpoint::StaticClass(),
			FTransform(FRotator(0.0f, Row.CheckpointYawDeg, 0.0f),
				FVector(Row.CheckpointXY.X, Row.CheckpointXY.Y, Z)), Params);
		if (Marker == nullptr)
		{
			continue;
		}
#if WITH_EDITOR
		Marker->SetActorLabel(FString::Printf(TEXT("WL_Checkpoint_%s"), *Row.Id.ToString()), false);
#endif
		Marker->Stand(Row, Discovered.Contains(Row.Id));
		Checkpoints.Add(Marker);
		UE_LOG(LogTemp, Display, TEXT("WLTERRITORY %s marker at (%.0f, %.0f, %.0f)%s"),
			*Row.Id.ToString(), Row.CheckpointXY.X, Row.CheckpointXY.Y, Z,
			Found > 0.5f ? TEXT("") : TEXT(" -- NO GROUND FOUND, standing at z=0"));
	}
	UE_LOG(LogTemp, Display, TEXT("WLTERRITORY %d checkpoints standing, %d already found"),
		Checkpoints.Num(), Discovered.Num());
}

void UWonderlandTerritorySubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	LoadDiscoveries();
	StandTheCheckpoints();
}

int32 UWonderlandTerritorySubsystem::GetStandingCheckpointCount() const
{
	int32 Standing = 0;
	for (const TObjectPtr<AWonderlandTerritoryCheckpoint>& Marker : Checkpoints)
	{
		Standing += (Marker != nullptr && IsValid(Marker)) ? 1 : 0;
	}
	return Standing;
}

bool UWonderlandTerritorySubsystem::Discover(FName Id)
{
	FWonderlandTerritory Row;
	if (!FindTerritory(Id, Row) || Discovered.Contains(Id))
	{
		return false;
	}
	Discovered.Add(Id);
	SaveDiscoveries();
	for (const TObjectPtr<AWonderlandTerritoryCheckpoint>& Marker : Checkpoints)
	{
		if (Marker != nullptr && Marker->GetTerritoryId() == Id)
		{
			Marker->SetDiscovered(true);
		}
	}
	// THE FIRST-ENTRY TREATMENT, and it is a BANNER rather than a takeover. The founder: "Show a brief
	// in-world discovery treatment ... It should feel like discovering a real region, not an intrusive
	// full-screen popup." Seven seconds is long enough to read three lines and short enough not to be dismissed.
	Announcing = Id;
	AnnounceLeft = 7.0f;
	OnTerritoryFound.Broadcast(Id);
	UE_LOG(LogTemp, Display, TEXT("WLTERRITORY discovered %s (%s)"), *Id.ToString(), *Row.DisplayName);
	return true;
}

void UWonderlandTerritorySubsystem::ForgetDiscoveries()
{
	Discovered.Reset();
	SaveDiscoveries();
	for (const TObjectPtr<AWonderlandTerritoryCheckpoint>& Marker : Checkpoints)
	{
		if (Marker != nullptr)
		{
			Marker->SetDiscovered(false);
		}
	}
	Current = NAME_None;
	Announcing = NAME_None;
	AnnounceLeft = 0.0f;
}

float UWonderlandTerritorySubsystem::BearingTo(FName Id) const
{
	FWonderlandTerritory Row;
	UWorld* World = GetWorld();
	const APawn* Pawn = World != nullptr ? UGameplayStatics::GetPlayerPawn(World, 0) : nullptr;
	if (Pawn == nullptr || !FindTerritory(Id, Row))
	{
		return -1.0f;
	}
	const FVector Here = Pawn->GetActorLocation();
	const double Dx = Row.CheckpointXY.X - Here.X;
	const double Dy = Row.CheckpointXY.Y - Here.Y;
	if (FMath::Abs(Dx) < 1.0 && FMath::Abs(Dy) < 1.0)
	{
		return 0.0f;
	}
	// Compass bearing: north is +X in Wonderland's frame, and it runs clockwise the way a compass does.
	const double Deg = FMath::RadiansToDegrees(FMath::Atan2(Dy, Dx));
	return static_cast<float>(FMath::Fmod(Deg + 360.0, 360.0));
}

float UWonderlandTerritorySubsystem::DistanceToMetres(FName Id) const
{
	FWonderlandTerritory Row;
	UWorld* World = GetWorld();
	const APawn* Pawn = World != nullptr ? UGameplayStatics::GetPlayerPawn(World, 0) : nullptr;
	if (Pawn == nullptr || !FindTerritory(Id, Row))
	{
		return -1.0f;
	}
	const FVector Here = Pawn->GetActorLocation();
	return static_cast<float>(FVector2D::Distance(FVector2D(Here.X, Here.Y), Row.CheckpointXY) / 100.0);
}

FString UWonderlandTerritorySubsystem::DescribeWayTo(FName Id) const
{
	FWonderlandTerritory Row;
	if (!FindTerritory(Id, Row))
	{
		return FString();
	}
	const float Bearing = BearingTo(Id);
	const float Away = DistanceToMetres(Id);
	if (Bearing < 0.0f || Away < 0.0f)
	{
		return FString::Printf(TEXT("%s is on the map."), *Row.DisplayName);
	}
	static const TCHAR* const Points[] = {
		TEXT("north"), TEXT("north-east"), TEXT("east"), TEXT("south-east"),
		TEXT("south"), TEXT("south-west"), TEXT("west"), TEXT("north-west")};
	const int32 Point = static_cast<int32>(FMath::RoundToInt(Bearing / 45.0f)) % 8;
	if (Away < 60.0f)
	{
		return FString::Printf(TEXT("You are standing in %s."), *Row.DisplayName);
	}
	return FString::Printf(TEXT("%s lies %s, %.0f m away."), *Row.DisplayName, Points[Point], Away);
}

void UWonderlandTerritorySubsystem::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (AnnounceLeft > 0.0f)
	{
		AnnounceLeft = FMath::Max(AnnounceLeft - DeltaSeconds, 0.0f);
		if (AnnounceLeft <= 0.0f)
		{
			Announcing = NAME_None;
		}
	}

	// A CHECK A FEW TIMES A SECOND IS PLENTY for a question whose answer changes at walking pace, and it keeps
	// a distance test against five territories off the per-frame budget entirely.
	SinceCheck += DeltaSeconds;
	if (SinceCheck < 0.25f)
	{
		return;
	}
	SinceCheck = 0.0f;
	if (!bStood)
	{
		StandTheCheckpoints();
	}

	UWorld* World = GetWorld();
	const APawn* Pawn = World != nullptr ? UGameplayStatics::GetPlayerPawn(World, 0) : nullptr;
	if (Pawn == nullptr)
	{
		return;
	}
	const FVector2D Here(Pawn->GetActorLocation().X, Pawn->GetActorLocation().Y);

	// WHICHEVER CHECKPOINT CLAIMS THIS GROUND MOST STRONGLY, measured as a fraction of its own radius rather
	// than in metres: Golden Arrival's core is 500 m and a nation's march is 150, and a plain nearest-marker
	// test would hand the whole world to whichever happened to be closest in absolute terms.
	FName Nearest;
	float Best = TNumericLimits<float>::Max();
	for (const FWonderlandTerritory& Row : GetTerritories())
	{
		const float Away = static_cast<float>(FVector2D::Distance(Here, Row.CheckpointXY));
		const float Share = Away / FMath::Max(Row.DiscoverRadiusUU, 1.0f);
		if (Share <= 1.0f && Share < Best)
		{
			Best = Share;
			Nearest = Row.Id;
		}
	}

	if (Nearest != Current)
	{
		Current = Nearest;
		if (!Current.IsNone())
		{
			OnTerritoryEntered.Broadcast(Current);
			Discover(Current);
		}
	}
}

/* --------------------------------------------------------------------------------------- from the console */

namespace
{
	UWonderlandTerritorySubsystem* TerritoriesIn(UWorld* World)
	{
		return World != nullptr ? World->GetSubsystem<UWonderlandTerritorySubsystem>() : nullptr;
	}

	FAutoConsoleCommandWithWorld GTerritoryList(
		TEXT("wl.Territory.List"),
		TEXT("Every territory the canon declares, and whether it has been found."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			UWonderlandTerritorySubsystem* Territories = TerritoriesIn(World);
			if (Territories == nullptr)
			{
				return;
			}
			for (const FWonderlandTerritory& Row : Territories->GetTerritories())
			{
				UE_LOG(LogTemp, Display, TEXT("WLTERRITORY %s %-16s %-34s %s"),
					Territories->IsDiscovered(Row.Id) ? TEXT("*") : TEXT(" "),
					*Row.DisplayName,
					Row.bSpecialisationIsCanon ? *Row.Specialisation : TEXT("NEEDS FOUNDER DEFINITION"),
					*Territories->DescribeWayTo(Row.Id));
			}
		}));

	FAutoConsoleCommandWithWorld GTerritoryWhere(
		TEXT("wl.Territory.Where"),
		TEXT("Which territory the player is standing in."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (const UWonderlandTerritorySubsystem* Territories = TerritoriesIn(World))
			{
				const FName Where = Territories->GetCurrentTerritory();
				UE_LOG(LogTemp, Display, TEXT("WLTERRITORY here: %s"),
					Where.IsNone() ? TEXT("between territories") : *Where.ToString());
			}
		}));

	FAutoConsoleCommandWithWorld GTerritoryForget(
		TEXT("wl.Territory.Forget"),
		TEXT("Forget every discovery, so the first-entry treatment can be seen again."),
		FConsoleCommandWithWorldDelegate::CreateLambda([](UWorld* World)
		{
			if (UWonderlandTerritorySubsystem* Territories = TerritoriesIn(World))
			{
				Territories->ForgetDiscoveries();
				UE_LOG(LogTemp, Display, TEXT("WLTERRITORY every discovery forgotten"));
			}
		}));
}

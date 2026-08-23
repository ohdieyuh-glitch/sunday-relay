#include "WonderlandProjectAvatarActor.h"

#include "Components/StaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	// The same primitive the Relay Dog is built from, for the same reason: it
	// is always present, so an Avatar cannot fail to appear because an asset
	// did not cook.
	const TCHAR* const CubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
	const TCHAR* const ShellMat = TEXT("/Game/Wonderland/Materials/MI_spire.MI_spire");
	const TCHAR* const CoreMat  = TEXT("/Game/Wonderland/Materials/MI_gold_glow.MI_gold_glow");

	/** How many shell plates a stage carries. Eight around the core, plus one
	 *  ring per earned segment. */
	int32 PlatesFor(int32 Segments) { return 8 + Segments * 6; }
}

AWonderlandProjectAvatarActor::AWonderlandProjectAvatarActor()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("AvatarRoot"));
	SetRootComponent(Root);
}

FVector AWonderlandProjectAvatarActor::AttendancePoint() const
{
	// In FRONT of the Avatar (-X), far enough out that a standing Dog's raised
	// forepaws reach it rather than intersecting it.
	return GetActorLocation() + GetActorForwardVector() * -(BaseRadius * 2.6f);
}

void AWonderlandProjectAvatarActor::BeginPlay()
{
	Super::BeginPlay();
	BuildShell();
}

void AWonderlandProjectAvatarActor::BuildShell()
{
	UStaticMesh* const Cube = LoadObject<UStaticMesh>(nullptr, CubePath);
	if (Cube == nullptr)
	{
		// Loudly: an invisible Avatar is a world that silently lost its subject.
		UE_LOG(LogTemp, Error, TEXT("AVATAR_BUILD_FAILED=1 — %s did not load"), CubePath);
		return;
	}
	UMaterialInterface* const Plate = LoadObject<UMaterialInterface>(nullptr, ShellMat);
	UMaterialInterface* const Heart = LoadObject<UMaterialInterface>(nullptr, CoreMat);

	const WonderlandAvatar::FAvatarLook Look =
		WonderlandAvatar::LookFor(Stage, Mission(), 0.0f);
	const int32 Plates = PlatesFor(Look.Segments);

	// THE CORE: a small bright heart the shell is arranged around. This is what
	// carries the glow, so activity reads even when the shell is dark stone.
	Core = NewObject<UStaticMeshComponent>(this);
	Core->SetupAttachment(Root);
	Core->SetStaticMesh(Cube);
	if (Heart != nullptr) { Core->SetMaterial(0, Heart); }
	Core->SetRelativeScale3D(FVector(BaseRadius * 0.010f));
	Core->SetRelativeLocation(FVector(0.0f, 0.0f, BaseRadius));
	Core->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Core->RegisterComponent();
	++BuiltParts;

	// THE SHELL: plates on a sphere around the core, so it reads as something
	// closed that could open — an egg, a seed, a chrysalis. Deterministic
	// placement: a hero frame captured twice must show the same Avatar.
	Shell.Reset();
	ShellRest.Reset();
	ShellRestScale.Reset();
	for (int32 i = 0; i < Plates; ++i)
	{
		const float T = (i + 0.5f) / float(Plates);
		const float Phi = FMath::Acos(1.0f - 2.0f * T);               // even in latitude
		const float Theta = float(i) * 2.39996323f;                    // golden angle
		const float R = BaseRadius;
		const FVector Dir(FMath::Sin(Phi) * FMath::Cos(Theta),
		                  FMath::Sin(Phi) * FMath::Sin(Theta),
		                  FMath::Cos(Phi));
		UStaticMeshComponent* const C = NewObject<UStaticMeshComponent>(this);
		C->SetupAttachment(Root);
		C->SetStaticMesh(Cube);
		if (Plate != nullptr) { C->SetMaterial(0, Plate); }
		const FVector Rest = Dir * R + FVector(0.0f, 0.0f, BaseRadius);
		const FVector RestScale(R * 0.0075f, R * 0.0075f, R * 0.0030f);
		C->SetRelativeLocation(Rest);
		C->SetRelativeRotation(Dir.Rotation());
		C->SetRelativeScale3D(RestScale);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->RegisterComponent();
		Shell.Add(C);
		ShellRest.Add(Rest);
		ShellRestScale.Add(RestScale);
		++BuiltParts;
	}
	UE_LOG(LogTemp, Warning, TEXT("AVATAR_PARTS=%d AVATAR_STAGE=%s"),
	       BuiltParts, ANSI_TO_TCHAR(WonderlandAvatar::StageName(Stage)));
}

void AWonderlandProjectAvatarActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	LifeSeconds += FMath::Clamp(DeltaSeconds, 0.0f, 0.1f);

	// The stage is a pure function of what has actually landed. Recomputed each
	// tick rather than latched, so a completed run is reflected immediately and
	// nothing else can move it.
	const WonderlandAvatar::EStage Next =
		WonderlandAvatar::StageFor(Stage, Mission(), CompletedRuns);
	const bool bGrew = (Next != Stage);
	Stage = Next;
	StageName = FName(ANSI_TO_TCHAR(WonderlandAvatar::StageName(Stage)));

	const float Phase = FMath::Fmod(LifeSeconds * 0.5f, 1.0f);
	const WonderlandAvatar::FAvatarLook Look =
		WonderlandAvatar::LookFor(Stage, Mission(), Phase);

	// The shell breathes outward with the glow: the busier Relay is, the more
	// the plates part and the more of the core shows through. That is the beat
	// the founder should be able to read from across the plaza without a HUD.
	const float Part = 1.0f + Look.Glow * 0.22f;
	for (int32 i = 0; i < Shell.Num(); ++i)
	{
		if (Shell[i] == nullptr) { continue; }
		Shell[i]->SetRelativeLocation(ShellRest[i] * FVector(Part, Part, 1.0f)
		                              + FVector(0.0f, 0.0f, ShellRest[i].Z * (Part - 1.0f)));
		Shell[i]->SetRelativeScale3D(ShellRestScale[i] * Look.Scale);
	}
	if (Core != nullptr)
	{
		// A GROWTH PULSE, ONCE. Driven by the tick the stage actually changed;
		// a pulse recomputed from "stage != last stage" every frame is a
		// permanent shimmer, which reads as a bug rather than an event.
		const float Pulse = bGrew ? 1.9f : 1.0f;
		Core->SetRelativeScale3D(FVector(BaseRadius * 0.010f * Look.Scale * Pulse));
	}
}

#include "WonderlandInstancedBatch.h"

#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"

AWonderlandInstancedBatch::AWonderlandInstancedBatch()
{
	// PURELY VISUAL ACTORS MUST NOT TICK. One actor that ticks for nothing is
	// invisible in a profile; a few hundred of them is a measurable slice of the
	// GameThread, and this actor has nothing to do once its instances exist.
	PrimaryActorTick.bCanEverTick = false;
	PrimaryActorTick.bStartWithTickEnabled = false;
	SetActorEnableCollision(false);
	// Nothing here is replicated. The geometry is identical on every client
	// because it is generated into the map, and sending it would be paying to
	// synchronise a constant.
	bReplicates = false;
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
}

void AWonderlandInstancedBatch::BeginPlay()
{
	Super::BeginPlay();
	BuildInstances();
}

int32 AWonderlandInstancedBatch::BuildInstances()
{
	if (Instances != nullptr && BuiltInstances > 0)
	{
		return BuiltInstances;      // idempotent
	}

	const int32 Declared = DeclaredInstanceCount();
	if (Declared <= 0)
	{
		// An empty batch is a generator bug, not a quiet no-op. Warning level so
		// it survives the packaged log's Display filtering.
		UE_LOG(LogTemp, Warning,
			   TEXT("WONDERLAND BATCH '%s' declares no instances (%d floats). "
					"Something placed a batch actor and never filled it."),
			   *BatchName.ToString(), Transforms.Num());
		return 0;
	}
	if (Transforms.Num() % WonderlandFloatsPerInstance != 0)
	{
		// A truncated array would otherwise place Declared-1 instances and look
		// like an art change. Refusing is louder and cheaper to diagnose.
		UE_LOG(LogTemp, Error,
			   TEXT("WONDERLAND BATCH '%s' has %d floats, which is not a multiple "
					"of %d. Refusing to build a partial batch."),
			   *BatchName.ToString(), Transforms.Num(), WonderlandFloatsPerInstance);
		return 0;
	}

	// The hard reference first; the path only if nothing was wired.
	UStaticMesh* MeshAsset = Mesh;
	if (MeshAsset == nullptr && !MeshPath.IsEmpty())
	{
		MeshAsset = LoadObject<UStaticMesh>(nullptr, *MeshPath);
	}
	if (MeshAsset == nullptr)
	{
		UE_LOG(LogTemp, Error,
			   TEXT("WONDERLAND BATCH '%s' could not load mesh '%s'. %d pieces of "
					"the world will be MISSING, not merely unlit."),
			   *BatchName.ToString(), *MeshPath, Declared);
		return 0;
	}

	Instances = bHierarchical
		? NewObject<UHierarchicalInstancedStaticMeshComponent>(
			this, *FString::Printf(TEXT("ISM_%s"), *BatchName.ToString()))
		: NewObject<UInstancedStaticMeshComponent>(
			this, *FString::Printf(TEXT("ISM_%s"), *BatchName.ToString()));
	if (Instances == nullptr)
	{
		UE_LOG(LogTemp, Error, TEXT("WONDERLAND BATCH '%s': component creation failed"),
			   *BatchName.ToString());
		return 0;
	}

	Instances->SetupAttachment(GetRootComponent());
	// Mobility BEFORE registration: changing it afterwards is a warning at best
	// and ignored at worst.
	Instances->SetMobility(bStaticMobility ? EComponentMobility::Static
										   : EComponentMobility::Movable);
	Instances->SetStaticMesh(MeshAsset);
	UMaterialInterface* MaterialAsset = Material;
	if (MaterialAsset == nullptr && !MaterialPath.IsEmpty())
	{
		MaterialAsset = LoadObject<UMaterialInterface>(nullptr, *MaterialPath);
	}
	if (MaterialAsset != nullptr || !MaterialPath.IsEmpty())
	{
		if (MaterialAsset != nullptr)
		{
			Instances->SetMaterial(0, MaterialAsset);
		}
		else
		{
			// The generator chose this material deliberately; falling back to the
			// mesh's default silently is how a world turns up in engine grey.
			UE_LOG(LogTemp, Warning,
				   TEXT("WONDERLAND BATCH '%s': material '%s' did not load; %d "
						"pieces will use the mesh default."),
				   *BatchName.ToString(), *MaterialPath, Declared);
		}
	}

	// Decoration blocks nothing, is not walked on, and contributes no
	// navigation. Collision on 33,000 pieces is a cost with no gameplay behind
	// it — Unreal's own geometry and the gameplay actors remain the authority
	// for anything a Dog can bump into.
	Instances->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Instances->SetCollisionProfileName(TEXT("NoCollision"));
	Instances->SetGenerateOverlapEvents(false);
	Instances->SetCanEverAffectNavigation(false);
	Instances->SetCastShadow(bCastShadow);
	Instances->RegisterComponent();

	Instances->PreAllocateInstancesMemory(Declared);
	for (int32 Index = 0; Index < Declared; ++Index)
	{
		const int32 Base = Index * WonderlandFloatsPerInstance;
		// Named rotator fields, in the generator's own order (pitch, yaw, roll).
		// FRotator's positional constructor has already mis-aimed a hero camera
		// and the sun in this project; the ordering is written out here so the
		// same mistake cannot be made silently on the way in.
		const FRotator Rotation(Transforms[Base + 3],   // pitch
								Transforms[Base + 4],   // yaw
								Transforms[Base + 5]);  // roll
		const FTransform Local(
			Rotation,
			FVector(Transforms[Base + 0], Transforms[Base + 1], Transforms[Base + 2]),
			FVector(Transforms[Base + 6], Transforms[Base + 7], Transforms[Base + 8]));
		Instances->AddInstance(Local);
	}
	BuiltInstances = Instances->GetInstanceCount();

	if (BuiltInstances != Declared)
	{
		UE_LOG(LogTemp, Error,
			   TEXT("WONDERLAND BATCH '%s': declared %d instances, built %d."),
			   *BatchName.ToString(), Declared, BuiltInstances);
	}
	return BuiltInstances;
}

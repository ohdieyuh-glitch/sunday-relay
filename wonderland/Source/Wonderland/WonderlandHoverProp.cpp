#include "WonderlandHoverProp.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "WonderlandHoverComponent.h"

AWonderlandHoverProp::AWonderlandHoverProp()
{
	PrimaryActorTick.bCanEverTick = false;   // the component ticks, the actor does not
	MeshComponent = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	SetRootComponent(MeshComponent);
	// Movable: it moves. And, as WonderlandInstancedBatch.h records, a STATIC
	// mesh in this no-baked-lighting world renders black.
	MeshComponent->SetMobility(EComponentMobility::Movable);
	MeshComponent->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Hover = CreateDefaultSubobject<UWonderlandHoverComponent>(TEXT("Hover"));
}

void AWonderlandHoverProp::BeginPlay()
{
	Super::BeginPlay();
	UStaticMesh* MeshAsset = Mesh;
	if (MeshAsset == nullptr && !MeshPath.IsEmpty())
	{
		MeshAsset = LoadObject<UStaticMesh>(nullptr, *MeshPath);
	}
	if (MeshAsset == nullptr)
	{
		UE_LOG(LogTemp, Error, TEXT("WONDERLAND HOVER '%s' could not load mesh '%s'; the prop is invisible."),
			   *GetName(), *MeshPath);
		return;
	}
	MeshComponent->SetStaticMesh(MeshAsset);
	UMaterialInterface* MaterialAsset = Material;
	if (MaterialAsset == nullptr && !MaterialPath.IsEmpty())
	{
		MaterialAsset = LoadObject<UMaterialInterface>(nullptr, *MaterialPath);
	}
	if (MaterialAsset != nullptr)
	{
		MeshComponent->SetMaterial(0, MaterialAsset);
	}
}

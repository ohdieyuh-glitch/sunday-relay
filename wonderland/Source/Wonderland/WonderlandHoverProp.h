// ONE FLOATING PROP, AS AN ACTOR THE GENERATOR CAN SPAWN.
//
// Everything decorative in Wonderland is an INSTANCE inside a batch actor, and
// an instance cannot carry a component. The three or four things the founder
// wants to float — the sky keys, the teapot — therefore need to be actors, and
// this is the smallest actor that will do: a static mesh, a material, and a
// UWonderlandHoverComponent. Mesh and Material are resolved the same way the
// batch actor resolves them (hard reference first, path second) so the cooker
// follows a real object reference and the prop cannot come up grey.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandHoverProp.generated.h"

class UStaticMeshComponent;
class UWonderlandHoverComponent;
class UMaterialInterface;
class UStaticMesh;

UCLASS(Blueprintable)
class AWonderlandHoverProp : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandHoverProp();

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	TObjectPtr<UStaticMesh> Mesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	FString MeshPath;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	TObjectPtr<UMaterialInterface> Material;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Hover")
	FString MaterialPath;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Hover")
	TObjectPtr<UStaticMeshComponent> MeshComponent;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Hover")
	TObjectPtr<UWonderlandHoverComponent> Hover;

protected:
	virtual void BeginPlay() override;
};

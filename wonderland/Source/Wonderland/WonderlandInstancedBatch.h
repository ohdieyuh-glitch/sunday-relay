// ONE ACTOR FOR THOUSANDS OF PIECES.
//
// WHY THIS EXISTS — measured, not assumed
//
// A real NVIDIA L4 benchmark of the live world: 1280x720, H264, 18 Mb/s,
// **12 FPS**, zero freezes, **GPU utilisation ~10%**, VRAM 1.6 GB, and the
// RenderThread pinned at 55-80% of one core. A GPU sitting at ten per cent
// while the frame rate is twelve is not a shading problem. The renderer was
// never the bottleneck; SUBMITTING the scene was.
//
// The world is ~33,000 individual AStaticMeshActors, one per decorative piece.
// Every one of them is a separate actor, a separate scene component, a separate
// primitive in the scene proxy list, and a separate visibility test every
// frame. That cost is paid on the CPU before the GPU is asked to do anything,
// and it does not care that each mesh is a twelve-triangle cube.
//
// So the fix is architectural and it changes NOTHING about what is on screen:
// identical geometry, identical materials, identical transforms — submitted as
// instances of a handful of components instead of as tens of thousands of
// actors.
//
// WHY ISM AND NOT HISM, deliberately
//
// HierarchicalInstancedStaticMeshComponent maintains a CPU cluster tree for
// per-instance culling. In UE5 the GPU Scene already culls ISM instances, so
// the tree buys less than it used to — and building it costs a rebuild per
// AddInstance unless auto-rebuild is disabled, which on 30,000 instances is the
// difference between a startup hitch and an unusable one. `bHierarchical`
// exists on this actor so the choice can be MEASURED rather than argued about,
// and it defaults to the one that cannot degenerate.
//
// WHY MOVABLE AND NOT STATIC
//
// The generator's own note, learned the hard way: with `r.AllowStaticLighting`
// false and no baked lighting, a STATIC-mobility mesh has no lightmap and is
// excluded from some dynamic paths — it renders BLACK. That was the fix for the
// black Hub and it is not being undone here on a hunch. `bStaticMobility`
// exists so one render can settle it; it defaults to Movable, which is what is
// known to work.
//
// WHAT IS DELIBERATELY NOT BATCHED
//
// Anything with meaning. Interaction points, markers, portals, lights, cameras,
// the Relay Dogs and every gameplay anchor stay individual actors. Actor count
// is not the goal; the goal is that PURELY VISUAL geometry stops costing an
// actor each. Semantics are worth their overhead and decoration is not.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WonderlandInstancedBatch.generated.h"

class UInstancedStaticMeshComponent;

/** Nine floats per instance: X Y Z, Pitch Yaw Roll, ScaleX ScaleY ScaleZ. */
static constexpr int32 WonderlandFloatsPerInstance = 9;

UCLASS(Blueprintable)
class AWonderlandInstancedBatch : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandInstancedBatch();

	/** `/Engine/BasicShapes/Cube.Cube` and friends today; a Nanite or Marble mesh
	 *  later. Resolved by path at runtime, so /Game/Wonderland must stay in
	 *  DirectoriesToAlwaysCook or the cooker strips what nothing references. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	FString MeshPath;

	/** Material instance for slot 0. Empty leaves the mesh's own material. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	FString MaterialPath;

	/**
	 * Flat transforms, nine floats each.
	 *
	 * A flat float array rather than TArray<FTransform> on purpose: this is
	 * written from the level generator's Python, and a flat numeric array is the
	 * one shape that crosses that boundary without depending on how a given
	 * engine build exposes a struct. The parsing is trivial and the interop is
	 * not a thing that can quietly half-work.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	TArray<float> Transforms;

	/** What this batch is, for logs and for a person reading the outliner. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	FName BatchName;

	/** Shadow casting for the whole batch. The generator already decides this
	 *  per material and per label; batching keys on it so the decision survives. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	bool bCastShadow = true;

	/** Use HISM instead of ISM. See the header note — default false, and it is
	 *  a question for a measurement rather than a preference. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	bool bHierarchical = false;

	/** Static mobility instead of Movable. See the header note — default false
	 *  because Movable is what is known to render. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	bool bStaticMobility = false;

	/** How many instances were actually created. The world proof reads this. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Batch")
	int32 BuiltInstances = 0;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Wonderland|Batch")
	TObjectPtr<UInstancedStaticMeshComponent> Instances;

	/** Instances this batch holds, whether or not they have been built yet. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Batch")
	int32 DeclaredInstanceCount() const
	{
		return Transforms.Num() / WonderlandFloatsPerInstance;
	}

	/** Build the component and add every instance. Idempotent. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Batch")
	int32 BuildInstances();

protected:
	virtual void BeginPlay() override;
};

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
class UMaterialInterface;
class UStaticMesh;

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

	/**
	 * HARD REFERENCES, and they exist because the path strings above are not
	 * enough on their own.
	 *
	 * The cooker follows object references. A path held as an FString is not a
	 * reference, so every material reached only that way was stripped from the
	 * pak and the live L4 render came up with all 146 batches grey — "material
	 * did not load", once per batch. Config can fix that (and now does), but a
	 * hard pointer means the asset cooks because something points at it, which
	 * does not depend on an ini being read from the right file.
	 *
	 * Set by the level generator. The path fields stay as the human-readable
	 * record and as the fallback.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	TObjectPtr<UMaterialInterface> Material;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	TObjectPtr<UStaticMesh> Mesh;

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

	/** BLOCK A PAWN. Default false, which is what every batch has always been.
	 *
	 *  This world currently has NO gameplay collision at all: every visual piece
	 *  is an instance in a batch and no other geometry carries a blocking
	 *  profile, so a player can fly through the castle and nothing can be stood
	 *  on. That is a decision to make rather than a bug to patch — the pawn
	 *  floats, so nothing falls — and this is the switch that makes the other
	 *  choice testable without a code change.
	 *
	 *  It is per-batch and OFF by default on purpose. Collision on thirty-three
	 *  thousand instances is a real cost that nobody has measured; collision on
	 *  the few thousand that form the ground and the walls may be nothing. The
	 *  generator picks which batches get it from WONDERLAND_COLLIDE, and
	 *  WonderlandWorldProof prints RUNTIME_BLOCKING_PRIMITIVES so the result is
	 *  a number rather than an impression. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	bool bCollides = false;

	/** Whether the instances feed the mesh distance fields that occlude the
	 *  sky light (DFAO) and Lumen's software traces. Default true, the engine's
	 *  own default. The generator turns it OFF for foliage: a hedge or a bed of
	 *  leaf blades has a distance field like a solid block, and that block
	 *  occludes the sky on the very leaves it is made of -- measured on
	 *  HeroCam0 as sRGB 2 on a leaf's shadow side beside an ivory post's 118
	 *  (V2_PASS_027, PASS 05c). Architecture keeps it on for contact shading. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	bool bAffectDistanceFieldLighting = true;

	/**
	 * DISTANCE AT WHICH THE WHOLE BATCH STOPS DRAWING, uu. Zero -- the default, and what every batch had before this
	 * existed -- means never, so no current batch changes.
	 *
	 * It exists for decoration that only matters close up. The GPU Scene culls instances by frustum and occlusion
	 * but not by distance, so a lawn scattered with small flowers across 1.8 km^2 of lawn would draw every visible
	 * flower out to the horizon, where each is a sub-pixel speck costing the same as one at your feet. Per instance:
	 * each fades out between StartCull and CullDistance rather than popping, via the ISM's own instance cull range.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Batch")
	float CullDistance = 0.0f;

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

	/** Instances the editor preview is drawing, 0 outside an editor world. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Batch")
	int32 EditorPreviewInstanceCount() const;

protected:
	virtual void BeginPlay() override;

#if WITH_EDITOR
	// THE EDITOR SHOWS THE WORLD PIE SHOWS.
	//
	// Instances are built in BeginPlay, so an editor viewport used to draw only the
	// 16,218 plain actors: every kerb, hedge, flower bed and gold trim living in a
	// batch -- 32,963 pieces -- was missing until Play, and the world read as sparse
	// and wrong to anyone judging it in the editor. The preview draws the same
	// transforms with the same mesh and material in editor worlds only.
	//
	// IT IS NEVER SAVED AND NEVER PLAYED. The component is transient, duplicate-
	// transient and editor-only, so it is not written into the map, not copied into
	// a PIE world (which builds its own in BeginPlay), and not cooked. It has no
	// collision: the preview is a picture, and gameplay collision stays exactly what
	// BuildInstances decides at runtime.
	virtual void PostRegisterAllComponents() override;
	virtual void PostEditChangeProperty(FPropertyChangedEvent& PropertyChangedEvent) override;
#endif

private:
	UStaticMesh* ResolveMesh() const;
	UMaterialInterface* ResolveMaterial() const;
	void AppendInstanceTransforms(TArray<FTransform>& OutTransforms) const;

#if WITH_EDITOR
	void RefreshEditorPreview(bool bRebuild);
#endif

#if WITH_EDITORONLY_DATA
	UPROPERTY(Transient, DuplicateTransient, TextExportTransient)
	TObjectPtr<UInstancedStaticMeshComponent> EditorPreview;
#endif
};

#include "WonderlandInstancedBatch.h"

#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstance.h"

AWonderlandInstancedBatch::AWonderlandInstancedBatch()
{
	// PURELY VISUAL ACTORS MUST NOT TICK. One actor that ticks for nothing is
	// invisible in a profile; a few hundred of them is a measurable slice of the
	// GameThread, and this actor has nothing to do once its instances exist.
	PrimaryActorTick.bCanEverTick = false;
	PrimaryActorTick.bStartWithTickEnabled = false;
	// NOT bCollides here. This is the constructor: the generator sets bCollides
	// on the spawned actor afterwards, so reading it now would always see the
	// default and a colliding batch would be built with actor collision off —
	// every setting reading correct and nothing being hittable. BuildInstances
	// applies it, where the value is real.
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
		if (MaterialAsset == nullptr)
		{
			// The generator chose this material deliberately; falling back to
			// the mesh's default silently is how a world turns up in engine
			// grey.
			UE_LOG(LogTemp, Warning,
				   TEXT("WONDERLAND BATCH '%s': material '%s' did not load; %d "
						"pieces will use the mesh default."),
				   *BatchName.ToString(), *MaterialPath, Declared);
		}
	}

	// Decoration blocks nothing, is not walked on, and contributes no
	// navigation. Collision on 33,000 pieces is a cost with no gameplay behind
	// it, and that is still true.
	//
	// WHAT IS NOT TRUE, AND USED TO BE CLAIMED HERE: that some other Unreal
	// geometry owned collision for anything a Dog could bump into. There is no
	// such geometry. Every visual piece in this world goes
	// through this batch, nothing else carries a blocking profile, and the
	// player pawn uses FloatingPawnMovement, so nothing falls and nothing can be
	// stood on. WonderlandWorldProof measures that at runtime and prints
	// RUNTIME_BLOCKING_PRIMITIVES and RUNTIME_WORLD_HAS_NO_GAMEPLAY_COLLISION
	// rather than leaving it to a comment.
	//
	// If Wonderland is to be walked rather than flown, the fix is NOT collision
	// on every instance — it is a small set of STRUCTURAL colliders (the plaza
	// floor, the gate, the castle walls) authored alongside the decoration.
	// Applied HERE, in BuildInstances, because this is the first point at which
	// bCollides holds what the generator asked for.
	SetActorEnableCollision(bCollides);
	if (bCollides)
	{
		// BlockAll and not a custom channel set: a batch that collides is
		// ground or architecture, and "everything treats it as solid" is what
		// that means. Overlap events stay off — this is a wall, not a trigger.
		Instances->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
		Instances->SetCollisionProfileName(TEXT("BlockAll"));
		Instances->SetCanEverAffectNavigation(true);
	}
	else
	{
		Instances->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Instances->SetCollisionProfileName(TEXT("NoCollision"));
		Instances->SetCanEverAffectNavigation(false);
	}
	Instances->SetGenerateOverlapEvents(false);
	Instances->SetCastShadow(bCastShadow);
	// Before registration, like mobility: the distance-field scene reads this
	// flag when the primitive is added.
	Instances->bAffectDistanceFieldLighting = bAffectDistanceFieldLighting;
	Instances->RegisterComponent();

	// THE MATERIAL GOES ON AFTER REGISTRATION, and this is the whole reason
	// Wonderland rendered as a grey world for a session and a half.
	//
	// SetMaterial on an unregistered component writes OverrideMaterials and
	// nothing else. Registration then builds the render state from the static
	// mesh, and the override does not survive it -- so all 40,986 batched
	// pieces drew with the MESH's default material, which is engine grey with
	// a checkerboard, while every non-batched actor in the same frame kept its
	// palette. That split -- grey instances, coloured actors -- was visible in
	// every capture and I read it as a lighting problem for eight builds.
	//
	// It also made a proof line lie. Reading GetMaterial(0) immediately after
	// SetMaterial only reads the override array back, so it agreed 147 times
	// out of 147 and proved nothing. Read AFTER registration and the claim has
	// teeth: this is what the component will actually draw with.
	if (MaterialAsset != nullptr)
	{
		Instances->SetMaterial(0, MaterialAsset);
		const UMaterialInterface* Bound = Instances->GetMaterial(0);
		const bool bAgrees = (Bound == MaterialAsset);
		UE_LOG(LogTemp, Warning,
			   TEXT("WONDERLAND BATCH '%s': asked '%s', renders '%s'%s, %d pieces."),
			   *BatchName.ToString(), *MaterialAsset->GetName(),
			   Bound ? *Bound->GetName() : TEXT("NONE"),
			   bAgrees ? TEXT("") : TEXT("  <-- MISMATCH"), Declared);

		// ---- FORENSIC TRACE, FROM THE COMPONENT THAT ACTUALLY RENDERS ----
		//
		// Thirteen hypotheses have been tested and refuted, and every one of
		// them was checked against the ASSET. That the pak contains
		// MI_mush_red with a pure red proves the asset exists correctly. It
		// does NOT prove the visibly grey mushroom is rendering that material,
		// and that gap is where this investigation has been living.
		//
		// So this asks the COMPONENT, not the disk: how many slots does the
		// mesh actually have, what material object sits in each one, what is
		// that object's parent, and -- the question never asked -- what does
		// THAT OBJECT report when asked for its own BaseColor and Emissive at
		// runtime. If a component's bound material answers grey, the search is
		// over and it was never the lighting.
		//
		// Deliberately verbose and deliberately limited to a handful of named
		// batches: 148 batches x 10 lines is a log nobody reads.
		const FString BN = BatchName.ToString();
		const bool bTraceThis = BN.Contains(TEXT("mush_red"))
							 || BN.Contains(TEXT("petal_pink"))
							 || BN.Contains(TEXT("foliage"))
							 || BN.Contains(TEXT("gold"))
							 || BN.Contains(TEXT("stone"));
		if (bTraceThis)
		{
			const int32 NumSlots = Instances->GetNumMaterials();
			const UStaticMesh* SM = Instances->GetStaticMesh();
			UE_LOG(LogTemp, Warning,
				   TEXT("FORENSIC [%s] mesh='%s' slots=%d overrides=%d customdata=%d"),
				   *BN, SM ? *SM->GetName() : TEXT("NONE"), NumSlots,
				   Instances->OverrideMaterials.Num(),
				   Instances->NumCustomDataFloats);

			for (int32 Slot = 0; Slot < NumSlots; ++Slot)
			{
				UMaterialInterface* const M = Instances->GetMaterial(Slot);
				if (M == nullptr)
				{
					UE_LOG(LogTemp, Warning,
						   TEXT("FORENSIC [%s]   slot %d -> NULL (renders the engine default)"),
						   *BN, Slot);
					continue;
				}
				const UMaterialInterface* Par =
					Cast<UMaterialInstance>(M) ? Cast<UMaterialInstance>(M)->Parent : nullptr;

				// ASK THE BOUND OBJECT ITSELF. Not the asset on disk -- this
				// pointer, the one the renderer will use.
				FLinearColor BaseCol = FLinearColor::White;
				FLinearColor EmisCol = FLinearColor::Black;
				float EmisStr = -1.0f;
				float DetailAmp = -1.0f;
				const bool bGotBase = M->GetVectorParameterValue(
					FMaterialParameterInfo(TEXT("BaseColor")), BaseCol);
				const bool bGotEmis = M->GetVectorParameterValue(
					FMaterialParameterInfo(TEXT("Emissive")), EmisCol);
				M->GetScalarParameterValue(
					FMaterialParameterInfo(TEXT("EmissiveStrength")), EmisStr);
				M->GetScalarParameterValue(
					FMaterialParameterInfo(TEXT("DetailAmp")), DetailAmp);

				UE_LOG(LogTemp, Warning,
					   TEXT("FORENSIC [%s]   slot %d -> '%s' parent='%s' "
							"BaseColor=%s(%.3f,%.3f,%.3f) Emissive=%s(%.3f,%.3f,%.3f) "
							"EmisStr=%.3f DetailAmp=%.3f"),
					   *BN, Slot, *M->GetName(),
					   Par ? *Par->GetName() : TEXT("none"),
					   bGotBase ? TEXT("set") : TEXT("DEFAULT"),
					   BaseCol.R, BaseCol.G, BaseCol.B,
					   bGotEmis ? TEXT("set") : TEXT("DEFAULT"),
					   EmisCol.R, EmisCol.G, EmisCol.B,
					   EmisStr, DetailAmp);
			}
		}
	}

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

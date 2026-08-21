#include "WonderlandWorldProof.h"

#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"

#include "WonderlandDogPawn.h"
#include "WonderlandInstancedBatch.h"
#include "WonderlandStrollingDog.h"

DEFINE_LOG_CATEGORY(LogWonderlandProof);

namespace WonderlandWorldProof
{
	// WAS 500, AND WAS THE WORLD-LOADED SIGNAL. It is neither any more. Batching
	// decoration into instances means the same world ships a few hundred actors
	// instead of thirty-three thousand, and a floor of 500 would have failed the
	// optimised world for being optimised — the classic way a safety check gets
	// deleted rather than fixed. This is now only a "there is nothing here at
	// all" backstop; GExpectedMinPieces is the real gate.
	int32 GExpectedMinActors = 20;

	// THE FLOOR THAT ACTUALLY MEANS SOMETHING NOW.
	//
	// ACTORS used to be the signal that the built world had loaded: tens of
	// thousands meant Wonderland, a handful meant the engine's default map. That
	// stopped being true the moment decoration was batched into instances — the
	// same world now ships a few hundred actors carrying thirty thousand pieces,
	// and a gate on actor count would have failed the optimised world for being
	// optimised, which is exactly how a safety check gets deleted.
	//
	// What still separates "Wonderland" from "a template" is how many PIECES are
	// in the map, batched or not. That is what is gated.
	int32 GExpectedMinPieces = 5000;

	static FDelegateHandle GHandle;

	static bool IsProxyActor(const AActor* Actor)
	{
		// The default pawn a GameMode spawns when nothing else is configured.
		// Its presence alongside a tiny actor count is the signature of the
		// engine default map rather than the built world.
		if (!Actor)
		{
			return false;
		}
		const FString ClassName = Actor->GetClass()->GetName();
		return ClassName.Contains(TEXT("DefaultPawn"))
			|| ClassName.Contains(TEXT("SpectatorPawn"));
	}

	// TAKES FActorsInitializedParams, NOT UWorld*.
	//
	// FWorldDelegates::OnWorldBeginPlay does not exist in UE 5.8 — the compile
	// said so plainly. UWorld has a per-world OnWorldBeginPlay, which would mean
	// subscribing to each world as it appears; the global hook that fires once
	// per world with the actors already initialised is OnWorldInitializedActors,
	// and it hands over a params struct rather than the world directly.
	//
	// It fires slightly earlier than BeginPlay — after actor initialisation,
	// before BeginPlay is dispatched. That is fine and arguably better here:
	// every actor the cooked map contains is present and counted, and the count
	// is not affected by anything BeginPlay might spawn afterwards. What is being
	// proven is what the MAP shipped with.
	static void ReportWorld(const FActorsInitializedParams& Params)
	{
		UWorld* World = Params.World;
		if (!World)
		{
			return;
		}

		int32 Actors = 0;
		int32 Dogs = 0;
		int32 CompoundAgents = 0;
		int32 Proxies = 0;
		int32 BodylessDogs = 0;
		int32 Batches = 0;
		int32 InstancedPieces = 0;
		int32 LoosePieces = 0;

		for (TActorIterator<AActor> It(World); It; ++It)
		{
			AActor* Actor = *It;
			++Actors;

			// COUNT WHAT THE MAP SHIPPED, NOT WHAT HAS BEEN BUILT YET. This runs
			// at OnWorldInitializedActors, which is BEFORE BeginPlay — so a batch
			// actor's instances do not exist yet and GetInstanceCount() would
			// report zero for a world that is entirely present. The declared
			// count is the honest number here, and it is also the one that proves
			// what the COOK produced rather than what the runtime managed.
			if (const AWonderlandInstancedBatch* const Batch =
					Cast<AWonderlandInstancedBatch>(Actor))
			{
				++Batches;
				InstancedPieces += Batch->DeclaredInstanceCount();
			}
			else
			{
				TArray<UStaticMeshComponent*> Meshes;
				Actor->GetComponents<UStaticMeshComponent>(Meshes);
				for (const UStaticMeshComponent* const Mesh : Meshes)
				{
					if (const UInstancedStaticMeshComponent* const Instanced =
							Cast<UInstancedStaticMeshComponent>(Mesh))
					{
						InstancedPieces += Instanced->GetInstanceCount();
					}
					else if (Mesh != nullptr && Mesh->GetStaticMesh() != nullptr)
					{
						++LoosePieces;
					}
				}
			}

			// BOTH KINDS OF DOG. This used to count only AWonderlandDogPawn —
			// the player's pawn — so the eight ambient Relay Dogs the level
			// generator places would not have appeared in RELAY_DOGS even once
			// they existed, and the proof would have reported 1 while the
			// founder looked at nine. The ambient Dogs are
			// AWonderlandStrollingDog and they tag themselves at BeginPlay.
			const bool bIsDogPawn = Cast<AWonderlandDogPawn>(Actor) != nullptr;
			const bool bIsStroller = Cast<AWonderlandStrollingDog>(Actor) != nullptr;
			if (bIsDogPawn || bIsStroller)
			{
				++Dogs;
				// A Compound Agent is a Dog carrying the agent tag. Counted
				// separately because "a dog is present" and "an agent is bound to
				// it" are different claims and the founder asked for both.
				// Matched EXACTLY against the shared tag, not by substring: the
				// old Contains(TEXT("Agent")) predicate would have counted a tag
				// like "AgentGarden" or "NoAgent" as a Compound Agent.
				if (Actor->ActorHasTag(WonderlandDogTags::CompoundAgent))
				{
					++CompoundAgents;
				}
				// A Dog whose body failed to build is present and INVISIBLE.
				// Reporting it as a Dog without saying so would make the count
				// agree with the world while disagreeing with the picture.
				if (const AWonderlandStrollingDog* const Stroller =
						Cast<AWonderlandStrollingDog>(Actor))
				{
					if (Stroller->BuiltParts == 0)
					{
						++BodylessDogs;
					}
				}
			}
			else if (IsProxyActor(Actor))
			{
				++Proxies;
			}
		}

		// Warning level on purpose: Display is filtered out of the packaged log,
		// and a proof nobody can read after the fact is not a proof.
		const FString MapName = World->GetMapName();
		UE_LOG(LogWonderlandProof, Warning, TEXT("WORLD=%s"), *MapName);
		UE_LOG(LogWonderlandProof, Warning, TEXT("ACTORS=%d"), Actors);
		UE_LOG(LogWonderlandProof, Warning, TEXT("RELAY_DOGS=%d"), Dogs);
		UE_LOG(LogWonderlandProof, Warning, TEXT("COMPOUND_AGENTS=%d"), CompoundAgents);
		UE_LOG(LogWonderlandProof, Warning, TEXT("PROXY_ACTORS=%d"), Proxies);
		UE_LOG(LogWonderlandProof, Warning, TEXT("BATCHES=%d"), Batches);
		UE_LOG(LogWonderlandProof, Warning, TEXT("INSTANCED_PIECES=%d"), InstancedPieces);
		UE_LOG(LogWonderlandProof, Warning, TEXT("LOOSE_PIECES=%d"), LoosePieces);
		UE_LOG(LogWonderlandProof, Warning, TEXT("VISIBLE_PIECES=%d"),
			   InstancedPieces + LoosePieces);
		if (BodylessDogs > 0)
		{
			UE_LOG(LogWonderlandProof, Error,
				   TEXT("RELAY_DOGS_WITHOUT_A_BODY=%d — these are counted above and "
						"cannot be seen. Treat RELAY_DOGS as %d visible."),
				   BodylessDogs, Dogs - BodylessDogs);
		}

		// -WonderlandMinActors is still honoured, but it now only guards against a
		// world with almost no actors AT ALL. It is no longer the world-loaded
		// signal — see GExpectedMinPieces — and leaving it as a dead variable
		// would have tripped this project's warnings-as-errors build anyway.
		int32 ExpectedActors = GExpectedMinActors;
		FParse::Value(FCommandLine::Get(), TEXT("-WonderlandMinActors="), ExpectedActors);
		int32 ExpectedPieces = GExpectedMinPieces;
		FParse::Value(FCommandLine::Get(), TEXT("-WonderlandMinPieces="), ExpectedPieces);
		const int32 Pieces = InstancedPieces + LoosePieces;

		// STATE THE MISMATCH LOUDLY. This is the exact failure that reached a
		// founder's browser: the stream was healthy and the world was not the
		// one that was built.
		if (!MapName.Contains(TEXT("WonderlandHub")))
		{
			UE_LOG(LogWonderlandProof, Error,
				TEXT("WORLD_MISMATCH: expected WonderlandHub, loaded '%s'. The package ")
				TEXT("has no map pinned, or the cook did not include the generated world."),
				*MapName);
		}
		else if (Actors < ExpectedActors)
		{
			UE_LOG(LogWonderlandProof, Error,
				TEXT("WORLD_MISMATCH: only %d actors in WonderlandHub (floor %d). Even a fully ")
				TEXT("batched world keeps its lights, cameras, markers and Dogs."),
				Actors, ExpectedActors);
		}
		else if (Pieces < ExpectedPieces)
		{
			// The message names PIECES, because that is what is being tested.
			// Leaving the old wording would have been a gate reporting one
			// quantity and explaining a different one, which is worse than no
			// message: the reader goes and checks the actor count and finds it
			// fine.
			UE_LOG(LogWonderlandProof, Error,
				TEXT("WORLD_MISMATCH: WonderlandHub loaded with only %d visible pieces ")
				TEXT("(%d instanced + %d loose, across %d actors; expected at least %d). ")
				TEXT("The cooked map is older or smaller than the generated one."),
				Pieces, InstancedPieces, LoosePieces, Actors, ExpectedPieces);
		}
		else
		{
			UE_LOG(LogWonderlandProof, Warning, TEXT("WORLD_OK=1"));
		}
	}

	void Register()
	{
		if (GHandle.IsValid())
		{
			return;
		}
		GHandle = FWorldDelegates::OnWorldInitializedActors.AddStatic(&ReportWorld);
	}

	void Unregister()
	{
		if (GHandle.IsValid())
		{
			FWorldDelegates::OnWorldInitializedActors.Remove(GHandle);
			GHandle.Reset();
		}
	}
}

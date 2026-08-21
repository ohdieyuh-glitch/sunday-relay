#include "WonderlandWorldProof.h"

#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

#include "WonderlandDogPawn.h"

DEFINE_LOG_CATEGORY(LogWonderlandProof);

namespace WonderlandWorldProof
{
	// A DELIBERATELY LOW FLOOR. The generated Hub carries tens of thousands of
	// actors; the engine's default map carries a handful. Anything in between is
	// still wrong, but this number only has to separate "the world loaded" from
	// "a template loaded" without becoming a maintenance burden every time the
	// art changes. Overridable so a deliberately small test map is not a failure.
	int32 GExpectedMinActors = 500;

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

		for (TActorIterator<AActor> It(World); It; ++It)
		{
			AActor* Actor = *It;
			++Actors;

			if (Cast<AWonderlandDogPawn>(Actor) != nullptr)
			{
				++Dogs;
				// A Compound Agent is a Dog that carries the agent tag. Counted
				// separately because "a dog is present" and "an agent is bound to
				// it" are different claims and the founder asked for both.
				if (Actor->Tags.ContainsByPredicate([](const FName& Tag)
					{
						return Tag.ToString().Contains(TEXT("CompoundAgent"))
							|| Tag.ToString().Contains(TEXT("Agent"));
					}))
				{
					++CompoundAgents;
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

		int32 Expected = GExpectedMinActors;
		FParse::Value(FCommandLine::Get(), TEXT("-WonderlandMinActors="), Expected);

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
		else if (Actors < Expected)
		{
			UE_LOG(LogWonderlandProof, Error,
				TEXT("WORLD_MISMATCH: WonderlandHub loaded with only %d actors (expected at ")
				TEXT("least %d). The cooked map is older or smaller than the generated one."),
				Actors, Expected);
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

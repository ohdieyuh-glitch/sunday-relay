#include "WonderlandWorldProof.h"

#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

#include "WonderlandDogPawn.h"
#include "WonderlandStrollingDog.h"

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
		int32 BodylessDogs = 0;

		for (TActorIterator<AActor> It(World); It; ++It)
		{
			AActor* Actor = *It;
			++Actors;

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
		if (BodylessDogs > 0)
		{
			UE_LOG(LogWonderlandProof, Error,
				   TEXT("RELAY_DOGS_WITHOUT_A_BODY=%d — these are counted above and "
						"cannot be seen. Treat RELAY_DOGS as %d visible."),
				   BodylessDogs, Dogs - BodylessDogs);
		}

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

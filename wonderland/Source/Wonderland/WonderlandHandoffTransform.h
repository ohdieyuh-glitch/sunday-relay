// Copyright Wonderland. THE TRANSFORMATION: each companion becoming its own sword, and coming back.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionHandoff.h"

class AActor;
class UInstancedStaticMeshComponent;

/**
 * FOUNDER CANON (2026-10-02): "the companions become luminous energy; gold forms the LEFT sword, cyan the RIGHT; the swords
 * fly to the hands" -- readable and continuous, NEVER a despawn-then-spawn cut.
 *
 * So the companion body is never popped: while its sword grows out of its light (TRANSFORMING) the body draws in -- the
 * two exchange size over the same seconds, in the same place -- with a stream of motes in the companion's colour pouring
 * out of it into the forming sword. Only once it has drawn to nothing is it veiled (hidden). On the way back (RETURNING) the
 * same happens in reverse: the sword flies home and shrinks into a companion growing back out of it.
 *
 * PURELY VISUAL. A companion's runtime, its console (B63), its provider and its participation in a mission are untouched:
 * this changes how big its body is drawn and whether it is drawn, and puts the scale it found back exactly. Plain C++.
 */
namespace WonderlandHandoffTransform
{
	/** How much of a companion's own body shows at this moment of a handoff: 1 itself, 0 entirely its sword. */
	float CompanionPresence(EWonderlandHandoffState State, float PhaseSeconds);

	/** How much of the energy stream flows at this moment: 0..1. */
	float EnergyFlow(EWonderlandHandoffState State, float PhaseSeconds);

	struct FShowInput
	{
		EWonderlandHandoffState State = EWonderlandHandoffState::Idle;
		float PhaseSeconds = 0.0f;
		/** The LEFT companion (the LLM Companion: its energy is gold) and the RIGHT (Jhinn: cyan), and where their swords are. */
		TWeakObjectPtr<AActor> LeftCompanion;
		TWeakObjectPtr<AActor> RightCompanion;
		FVector LeftSword = FVector::ZeroVector;
		FVector RightSword = FVector::ZeroVector;
		/** Each blade's line (its +Z) and half its drawn length: the breakup's shards re-form along it as the sword grows. */
		FVector LeftSwordAxis = FVector::UpVector;
		FVector RightSwordAxis = FVector::UpVector;
		/** Each blade's OWN half-length (round 6: one value, the left sword's, served both). */
		float LeftSwordReach = 50.0f;
		float RightSwordReach = 50.0f;
		float TimeSeconds = 0.0f;
	};

	class WONDERLAND_API FPresentation
	{
	public:
		/** Makes the energy's components (hidden) on Owner. Builds once. */
		void Build(AActor* Owner);
		void Show(const FShowInput& In);
		/** Gives every companion it changed its own size and visibility back (the owner leaving, or a QA ending). */
		void Release();
		/** For the QA: how present each body is being drawn (1 untouched), and how many energy motes show. */
		float GetPresence() const { return Presence; }
		int32 CountVisibleMotes() const;
		/** For the QA: the light shards of the breakup drawn now (both sides), and each side's shards. */
		int32 CountVisibleShards() const;
		const UInstancedStaticMeshComponent* GetShards(bool bGold) const;
		/** For the QA's continuity check: the state and phase this presentation last DREW (a tick behind the state's own, by tick order). */
		EWonderlandHandoffState GetShownState() const { return ShownState; }
		float GetShownPhase() const { return ShownPhase; }

	private:
		struct FVeiled
		{
			TWeakObjectPtr<AActor> Body;
			FVector RestScale = FVector::OneVector;
			/** The body's middle (from its actor's origin) and its half-size when it was first changed: where its light breaks from. */
			FVector RestOffset = FVector::ZeroVector;
			FVector RestExtent = FVector(30.0);
			bool bHidden = false;
			bool bTouched = false;
		};
		void Veil(FVeiled& Slot, AActor* Body, float Presence);
		void Flow(UInstancedStaticMeshComponent* Mesh, const FVector& From, const FVector& To, float Flow, float TimeSeconds, float Spin);
		/** The breakup at Break (0..1 of the transformation; the return plays it backwards): Body's shards between it and its blade. */
		void Shatter(UInstancedStaticMeshComponent* Mesh, const FVeiled& Slot, const AActor* Body, const FVector& BladeMiddle, const FVector& BladeAxis,
			float Reach, float Break, float Spin);

		FVeiled Left;
		FVeiled Right;
		TWeakObjectPtr<UInstancedStaticMeshComponent> GoldMotes;
		TWeakObjectPtr<UInstancedStaticMeshComponent> CyanMotes;
		TWeakObjectPtr<UInstancedStaticMeshComponent> GoldShards;
		TWeakObjectPtr<UInstancedStaticMeshComponent> CyanShards;
		/** Each shard's own place in the body (in its half-sizes), spin axis and size (of the body's largest half-size): fixed once. */
		TArray<FVector> ShardSeeds;
		TArray<FVector> ShardSpins;
		TArray<float> ShardSizes;
		bool bBuilt = false;
		float Presence = 1.0f;
		EWonderlandHandoffState ShownState = EWonderlandHandoffState::Idle;
		float ShownPhase = 0.0f;
	};

	/** How many motes stream from each companion. */
	inline constexpr int32 MotesPerSide = 28;

	/** How many light shards each companion breaks into (the founder's /handoff canon, 10-03: "luminous breakup; reformation"). */
	inline constexpr int32 ShardsPerSide = 20;
}

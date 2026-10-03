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

	private:
		struct FVeiled
		{
			TWeakObjectPtr<AActor> Body;
			FVector RestScale = FVector::OneVector;
			bool bHidden = false;
			bool bTouched = false;
		};
		void Veil(FVeiled& Slot, AActor* Body, float Presence);
		void Flow(UInstancedStaticMeshComponent* Mesh, const FVector& From, const FVector& To, float Flow, float TimeSeconds, float Spin);

		FVeiled Left;
		FVeiled Right;
		TWeakObjectPtr<UInstancedStaticMeshComponent> GoldMotes;
		TWeakObjectPtr<UInstancedStaticMeshComponent> CyanMotes;
		bool bBuilt = false;
		float Presence = 1.0f;
	};

	/** How many motes stream from each companion. */
	inline constexpr int32 MotesPerSide = 28;
}

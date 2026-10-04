// Copyright Wonderland. THE TRANSFORMATION. See WonderlandHandoffTransform.h.
#include "WonderlandHandoffTransform.h"
#include "WonderlandFinite.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "HAL/IConsoleManager.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

namespace
{
	const TCHAR* const MoteGlowParent = TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");
	const TCHAR* const MoteCubePath = TEXT("/Engine/BasicShapes/Cube.Cube");

	float Ease01(float X)
	{
		const float T = FMath::Clamp(X, 0.0f, 1.0f);
		return T * T * (3.0f - 2.0f * T);
	}

	TAutoConsoleVariable<int32> CVarHandoffBreakup(
		TEXT("wl.Handoff.Breakup"),
		1,
		TEXT("Mission Handoff: 1 (default) = each companion BREAKS into light shards that re-form along its sword, and back on the return (the founder's ")
		TEXT("/handoff canon, 10-03: \"luminous breakup; reformation into each sword\"). 0 = the body only draws in while the motes stream (the 10-02 look)."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarShardBurst(
		TEXT("wl.Handoff.ShardBurst"),
		1.8f,
		TEXT("Mission Handoff: how far each light shard bursts out of the companion before it flies to the sword, in the body's half-extents along the ")
		TEXT("shard's own direction (1.75 and over clears the body's box from any direction)."),
		ECVF_Default);

	UInstancedStaticMeshComponent* MakeMotes(AActor* Owner, const TCHAR* Name, const FLinearColor& Colour, int32 Count = WonderlandHandoffTransform::MotesPerSide)
	{
		UInstancedStaticMeshComponent* Mesh = NewObject<UInstancedStaticMeshComponent>(Owner,
			MakeUniqueObjectName(Owner, UInstancedStaticMeshComponent::StaticClass(), Name));
		Mesh->SetMobility(EComponentMobility::Movable);
		Mesh->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, MoteCubePath));
		if (UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, MoteGlowParent))
		{
			if (UMaterialInstanceDynamic* Mid = UMaterialInstanceDynamic::Create(Parent, Owner))
			{
				Mid->SetVectorParameterValue(TEXT("Color"), Colour);
				Mesh->SetMaterial(0, Mid);
			}
		}
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Mesh->SetGenerateOverlapEvents(false);
		Mesh->SetCanEverAffectNavigation(false);
		Mesh->SetCastShadow(false);
		// WORLD SPACE: each mote is placed in the world every frame, so the component itself stands still at the origin
		Mesh->SetupAttachment(Owner->GetRootComponent());
		Mesh->SetAbsolute(true, true, true);
		Mesh->RegisterComponent();
		Mesh->SetWorldTransform(FTransform::Identity);
		for (int32 i = 0; i < Count; ++i)
		{
			Mesh->AddInstance(FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector(0.01)), true);
		}
		Mesh->SetVisibility(false);
		Mesh->ComponentTags.AddUnique(TEXT("WL_Prop"));
		return Mesh;
	}
}

namespace WonderlandHandoffTransform
{
	float CompanionPresence(EWonderlandHandoffState State, float PhaseSeconds)
	{
		switch (State)
		{
		case EWonderlandHandoffState::Transforming:
			// drawn in over the same seconds the sword grows out of it
			return 1.0f - Ease01(PhaseSeconds / FWonderlandMissionHandoff::TransformSeconds);
		case EWonderlandHandoffState::Delivering:
		case EWonderlandHandoffState::Held:
			return 0.0f;
		case EWonderlandHandoffState::Returning:
			// growing back out of the sword over the return's last third, as the sword shrinks into it
			return Ease01((PhaseSeconds / FWonderlandMissionHandoff::ReturnSeconds - 0.66f) / 0.34f);
		default:
			return 1.0f;
		}
	}

	float EnergyFlow(EWonderlandHandoffState State, float PhaseSeconds)
	{
		switch (State)
		{
		case EWonderlandHandoffState::Acknowledged:
			// the companion answers the terminal: its light gathers
			return 0.6f * Ease01(PhaseSeconds / FWonderlandMissionHandoff::AcknowledgeSeconds);
		case EWonderlandHandoffState::Transforming:
		{
			const float T = PhaseSeconds / FWonderlandMissionHandoff::TransformSeconds;
			return 0.6f + 0.4f * Ease01(T * 3.0f) - Ease01((T - 0.8f) / 0.2f);
		}
		case EWonderlandHandoffState::Returning:
		{
			const float T = PhaseSeconds / FWonderlandMissionHandoff::ReturnSeconds;
			return FMath::Sin(FMath::Clamp((T - 0.45f) / 0.55f, 0.0f, 1.0f) * PI) * 0.8f;
		}
		default:
			return 0.0f;
		}
	}

	void FPresentation::Build(AActor* Owner)
	{
		if (bBuilt || Owner == nullptr)
		{
			return;
		}
		bBuilt = true;
		// the LLM Companion's light is gold, Jhinn's cyan: the colours of the swords they become
		GoldMotes = MakeMotes(Owner, TEXT("HandoffEnergyGold"), FLinearColor(1.0f, 0.74f, 0.28f) * 4000.0f * 2.6f);
		CyanMotes = MakeMotes(Owner, TEXT("HandoffEnergyCyan"), FLinearColor(0.28f, 0.90f, 1.0f) * 4000.0f * 2.6f);
		// THE BREAKUP'S SHARDS: the same light, larger -- pieces of the body, not sparks
		GoldShards = MakeMotes(Owner, TEXT("HandoffShardsGold"), FLinearColor(1.0f, 0.86f, 0.52f) * 4000.0f * 2.0f, ShardsPerSide);
		CyanShards = MakeMotes(Owner, TEXT("HandoffShardsCyan"), FLinearColor(0.45f, 0.92f, 1.0f) * 4000.0f * 2.0f, ShardsPerSide);
		FRandomStream ShardStream(20261003);
		for (int32 Shard = 0; Shard < ShardsPerSide; ++Shard)
		{
			ShardSeeds.Add(ShardStream.GetUnitVector() * ShardStream.FRandRange(0.45f, 1.0f));
			ShardSpins.Add(ShardStream.GetUnitVector());
			ShardSizes.Add(ShardStream.FRandRange(0.10f, 0.20f));
		}
	}

	void FPresentation::Veil(FVeiled& Slot, AActor* Body, float InPresence)
	{
		if (Slot.Body.Get() != Body)
		{
			// a different body than the one changed before (a respawn): the old one gets its own size back first
			if (AActor* Old = Slot.Body.Get())
			{
				if (Slot.bTouched)
				{
					Old->SetActorScale3D(Slot.RestScale);
					if (Slot.bHidden)
					{
						Old->SetActorHiddenInGame(false);
					}
				}
			}
			Slot = FVeiled();
			Slot.Body = Body;
		}
		if (Body == nullptr)
		{
			return;
		}
		if (InPresence >= 0.999f)
		{
			if (Slot.bTouched)
			{
				Body->SetActorScale3D(Slot.RestScale);
				if (Slot.bHidden)
				{
					Body->SetActorHiddenInGame(false);
				}
				Slot.bTouched = false;
				Slot.bHidden = false;
			}
			return;
		}
		if (!Slot.bTouched)
		{
			Slot.RestScale = Body->GetActorScale3D();
			// WHERE ITS LIGHT BREAKS FROM: the body as it stands, before any of it is drawn in
			const FBox RestBox = Body->GetComponentsBoundingBox(true);
			if (RestBox.IsValid && WonderlandFinite::IsDrawableScale(RestBox.GetExtent(), 1000.0))
			{
				Slot.RestOffset = RestBox.GetCenter() - Body->GetActorLocation();
				Slot.RestExtent = RestBox.GetExtent().ComponentMax(FVector(4.0));
			}
			Slot.bTouched = true;
		}
		const bool bHide = InPresence <= 0.01f;
		const FVector VeiledScale = Slot.RestScale * FMath::Max(InPresence, 0.01f);
		// DRAWABLE ONLY (round 4's GPU hang): a size that is not finite is never given to a companion
		if (!FMath::IsFinite(InPresence) || !WonderlandFinite::IsDrawableScale(VeiledScale))
		{
			static bool bVeilWarned = false;
			WonderlandFinite::NoteRefused(bVeilWarned, TEXT("companion veil"), FString::Printf(TEXT("%s: rest %s at presence %.3f"), *Body->GetName(),
				*Slot.RestScale.ToString(), InPresence));
			return;
		}
		Body->SetActorScale3D(VeiledScale);
		if (bHide != Slot.bHidden)
		{
			Body->SetActorHiddenInGame(bHide);
			Slot.bHidden = bHide;
		}
	}

	void FPresentation::Flow(UInstancedStaticMeshComponent* Mesh, const FVector& From, const FVector& To, float InFlow, float TimeSeconds, float Spin)
	{
		if (Mesh == nullptr)
		{
			return;
		}
		// DRAWABLE ONLY (round 4's GPU hang): a stream between points that are not finite is not drawn at all
		if (From.ContainsNaN() || To.ContainsNaN() || !FMath::IsFinite(InFlow) || !FMath::IsFinite(TimeSeconds))
		{
			static bool bFlowWarned = false;
			WonderlandFinite::NoteRefused(bFlowWarned, TEXT("energy motes"), FString::Printf(TEXT("from %s to %s, flow %.3f"), *From.ToString(), *To.ToString(), InFlow));
			if (Mesh->IsVisible())
			{
				Mesh->SetVisibility(false);
			}
			return;
		}
		const bool bShow = InFlow > 0.01f;
		if (Mesh->IsVisible() != bShow)
		{
			Mesh->SetVisibility(bShow);
		}
		if (!bShow)
		{
			return;
		}
		const FVector Line = To - From;
		const FVector Dir = Line.IsNearlyZero() ? FVector::UpVector : Line.GetSafeNormal();
		const FVector Side = FVector::CrossProduct(Dir, FMath::Abs(Dir.Z) > 0.9 ? FVector::ForwardVector : FVector::UpVector).GetSafeNormal();
		const FVector Lift = FVector::CrossProduct(Dir, Side).GetSafeNormal();
		const int32 Count = FMath::Min(Mesh->GetInstanceCount(), MotesPerSide);
		for (int32 i = 0; i < Count; ++i)
		{
			// each mote travels the line on its own phase, spiralling round it and drawing in as it arrives
			const float S = FMath::Frac(static_cast<float>(i) / Count + TimeSeconds * 0.85f);
			const float Angle = Spin * (S * 4.0f * PI + i * 0.9f);
			const float Radius = 14.0f * (1.0f - S) + 2.0f;
			const FVector P = From + Line * S + (Side * FMath::Cos(Angle) + Lift * FMath::Sin(Angle)) * Radius;
			const float Size = (1.4f + 1.6f * FMath::Sin(S * PI)) * InFlow;
			Mesh->UpdateInstanceTransform(i, FTransform(FRotator(S * 360.0f, i * 37.0f, 0.0f), P, FVector(Size / 100.0f)), true, i == Count - 1, true);
		}
	}

	void FPresentation::Shatter(UInstancedStaticMeshComponent* Mesh, const FVeiled& Slot, const AActor* Body, const FVector& BladeMiddle, const FVector& BladeAxis,
		float Reach, float Break, float Spin)
	{
		if (Mesh == nullptr)
		{
			return;
		}
		const bool bShow = Body != nullptr && Break > 0.0f && Break < 1.0f && ShardSeeds.Num() == ShardsPerSide && !BladeMiddle.ContainsNaN()
			&& !BladeAxis.ContainsNaN() && FMath::IsFinite(Reach);
		if (Mesh->IsVisible() != bShow)
		{
			Mesh->SetVisibility(bShow);
		}
		if (!bShow)
		{
			return;
		}
		const FVector Middle = Body->GetActorLocation() + Slot.RestOffset;
		const float Largest = static_cast<float>(Slot.RestExtent.GetMax());
		const FVector Blade = BladeAxis.IsNearlyZero() ? FVector::UpVector : BladeAxis.GetSafeNormal();
		const int32 Count = FMath::Min(Mesh->GetInstanceCount(), ShardsPerSide);
		for (int32 Shard = 0; Shard < Count; ++Shard)
		{
			// EACH SHARD BREAKS AWAY AT ITS OWN MOMENT from its own place in the body, bursts outward past the body's edge, then flies to its
			// own place along the blade and shrinks into it -- the body drawing in as its light leaves it
			const float Leaves = 0.05f + 0.5f * static_cast<float>(Shard) / Count;
			const float Born = Ease01((Break - Leaves) / 0.05f);
			const float Burst = Ease01((Break - Leaves) / 0.25f);
			const float Gather = Ease01((Break - Leaves - 0.25f) / FMath::Max(0.95f - Leaves - 0.25f, 0.05f));
			// OUT PAST THE BODY'S EDGE, EVERY SHARD (SW1c, rounds 3-6: gold 4 of 20, cyan 1 of 20 ever left the body): the burst used to scale
			// the shard's own random seed (0.45-1.0 long) by at most 1.3, so most stayed inside the companion they broke from and the breakup
			// read as a shimmer on the body. Now it starts where its seed puts it inside the body and is carried along the seed's DIRECTION
			// to ShardBurst half-extents -- past the box's surface from any direction at 1.75 -- before it gathers to the blade.
			const FVector BurstDir = ShardSeeds[Shard].GetSafeNormal();
			const float BurstOut = 0.35f * static_cast<float>(ShardSeeds[Shard].Size())
				+ FMath::Clamp(CVarShardBurst.GetValueOnGameThread(), 0.5f, 4.0f) * Burst;
			const FVector FromBody = Middle + BurstDir * Slot.RestExtent * BurstOut;
			const FVector OnBlade = BladeMiddle + Blade * (Reach * (2.0f * (Shard + 0.5f) / Count - 1.0f));
			FVector Place = FMath::Lerp(FromBody, OnBlade, Gather);
			Place.Z += FMath::Sin(Gather * PI) * 0.25f * Largest;
			const float Size = Born * ShardSizes[Shard] * Largest * (1.0f - 0.85f * Gather);
			const FQuat Turn(ShardSpins[Shard], Spin * (Break * 4.0f * PI + Shard));
			Mesh->UpdateInstanceTransform(Shard, FTransform(Turn, Place, FVector(Size / 100.0f)), true, Shard == Count - 1, true);
		}
	}

	void FPresentation::Show(const FShowInput& In)
	{
		ShownState = In.State;
		ShownPhase = In.PhaseSeconds;
		Presence = CompanionPresence(In.State, In.PhaseSeconds);
		Veil(Left, In.LeftCompanion.Get(), Presence);
		Veil(Right, In.RightCompanion.Get(), Presence);
		if (!bBuilt)
		{
			return;
		}
		// THE BREAKUP: across the transformation; the return plays it backwards over its last stretch, as the sword shrinks into the body
		float Break = 0.0f;
		if (CVarHandoffBreakup.GetValueOnGameThread() != 0)
		{
			if (In.State == EWonderlandHandoffState::Transforming)
			{
				Break = In.PhaseSeconds / FWonderlandMissionHandoff::TransformSeconds;
			}
			else if (In.State == EWonderlandHandoffState::Returning)
			{
				Break = 1.0f - FMath::Clamp((In.PhaseSeconds / FWonderlandMissionHandoff::ReturnSeconds - 0.62f) / 0.38f, 0.0f, 1.0f);
			}
		}
		Shatter(GoldShards.Get(), Left, In.LeftCompanion.Get(), In.LeftSword, In.LeftSwordAxis, In.LeftSwordReach, Break, 1.0f);
		Shatter(CyanShards.Get(), Right, In.RightCompanion.Get(), In.RightSword, In.RightSwordAxis, In.RightSwordReach, Break, -1.0f);
		const float Energy = EnergyFlow(In.State, In.PhaseSeconds);
		const AActor* LeftBody = In.LeftCompanion.Get();
		const AActor* RightBody = In.RightCompanion.Get();
		const FVector LeftFrom = LeftBody != nullptr ? LeftBody->GetActorLocation() : In.LeftSword;
		const FVector RightFrom = RightBody != nullptr ? RightBody->GetActorLocation() : In.RightSword;
		// INTO the sword while it forms; back OUT of it into the companion on the return
		const bool bBack = In.State == EWonderlandHandoffState::Returning;
		Flow(GoldMotes.Get(), bBack ? In.LeftSword : LeftFrom, bBack ? LeftFrom : In.LeftSword, Energy, In.TimeSeconds, 1.0f);
		Flow(CyanMotes.Get(), bBack ? In.RightSword : RightFrom, bBack ? RightFrom : In.RightSword, Energy, In.TimeSeconds, -1.0f);
	}

	void FPresentation::Release()
	{
		Veil(Left, nullptr, 1.0f);
		Veil(Right, nullptr, 1.0f);
		// the motes AND the breakup's shards (round 6: Release hid the motes only)
		for (const TWeakObjectPtr<UInstancedStaticMeshComponent>& Motes : { GoldMotes, CyanMotes, GoldShards, CyanShards })
		{
			if (UInstancedStaticMeshComponent* Mesh = Motes.Get())
			{
				Mesh->SetVisibility(false);
			}
		}
		Presence = 1.0f;
	}

	const UInstancedStaticMeshComponent* FPresentation::GetShards(bool bGold) const
	{
		return bGold ? GoldShards.Get() : CyanShards.Get();
	}

	int32 FPresentation::CountVisibleShards() const
	{
		int32 Count = 0;
		for (const TWeakObjectPtr<UInstancedStaticMeshComponent>& Shards : { GoldShards, CyanShards })
		{
			const UInstancedStaticMeshComponent* Mesh = Shards.Get();
			if (Mesh == nullptr || !Mesh->IsVisible())
			{
				continue;
			}
			for (int32 Shard = 0; Shard < Mesh->GetInstanceCount(); ++Shard)
			{
				FTransform ShardXf;
				Count += Mesh->GetInstanceTransform(Shard, ShardXf) && ShardXf.GetScale3D().GetAbsMax() > 0.001 ? 1 : 0;
			}
		}
		return Count;
	}

	int32 FPresentation::CountVisibleMotes() const
	{
		int32 Count = 0;
		for (const TWeakObjectPtr<UInstancedStaticMeshComponent>& Motes : { GoldMotes, CyanMotes })
		{
			const UInstancedStaticMeshComponent* Mesh = Motes.Get();
			Count += Mesh != nullptr && Mesh->IsVisible() ? Mesh->GetInstanceCount() : 0;
		}
		return Count;
	}
}

// Copyright Wonderland. THE TRANSFORMATION. See WonderlandHandoffTransform.h.
#include "WonderlandHandoffTransform.h"

#include "Components/InstancedStaticMeshComponent.h"
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

	UInstancedStaticMeshComponent* MakeMotes(AActor* Owner, const TCHAR* Name, const FLinearColor& Colour)
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
		for (int32 i = 0; i < WonderlandHandoffTransform::MotesPerSide; ++i)
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
			Slot.bTouched = true;
		}
		const bool bHide = InPresence <= 0.01f;
		Body->SetActorScale3D(Slot.RestScale * FMath::Max(InPresence, 0.01f));
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

	void FPresentation::Show(const FShowInput& In)
	{
		Presence = CompanionPresence(In.State, In.PhaseSeconds);
		Veil(Left, In.LeftCompanion.Get(), Presence);
		Veil(Right, In.RightCompanion.Get(), Presence);
		if (!bBuilt)
		{
			return;
		}
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
		for (const TWeakObjectPtr<UInstancedStaticMeshComponent>& Motes : { GoldMotes, CyanMotes })
		{
			if (UInstancedStaticMeshComponent* Mesh = Motes.Get())
			{
				Mesh->SetVisibility(false);
			}
		}
		Presence = 1.0f;
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

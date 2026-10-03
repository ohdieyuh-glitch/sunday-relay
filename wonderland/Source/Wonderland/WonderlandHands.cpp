// Copyright Wonderland. THE HANDS. See WonderlandHands.h.
#include "WonderlandHands.h"

#include "Components/PrimitiveComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "Materials/MaterialInterface.h"

namespace
{
	const TCHAR* const HandCubePath = TEXT("/Engine/BasicShapes/Cube.Cube");

	/** One box of the hand, in the forearm's space: a centre, its long axis, the axis it lies across, and its size. */
	FTransform HandBox(const FVector& Centre, const FVector& LongAxis, const FVector& AcrossAxis, const FVector& SizeAcrossThickLong)
	{
		const FMatrix Basis = FRotationMatrix::MakeFromZX(LongAxis.GetSafeNormal(), AcrossAxis.GetSafeNormal());
		return FTransform(Basis.Rotator(), Centre, SizeAcrossThickLong / 100.0);
	}
}

namespace WonderlandHands
{
	bool FHand::IsOn(const USceneComponent* Forearm) const
	{
		return Forearm != nullptr && On.Get() == Forearm && Boxes.Num() == BoxesPerHand && Boxes[0].IsValid();
	}

	void FHand::Destroy()
	{
		for (const TWeakObjectPtr<UStaticMeshComponent>& Box : Boxes)
		{
			if (UStaticMeshComponent* Mesh = Box.Get())
			{
				Mesh->DestroyComponent();
			}
		}
		Boxes.Reset();
		On.Reset();
		Source.Reset();
		// THE CURL IS KEPT: a hand rebuilt on another forearm while holding (a skin worn, a respawn) starts as the fist it was
		LaidCurl = -1.0f;
	}

	void FHand::Attach(AActor* Owner, USceneComponent* Forearm, const FVector& TipLocal, const FVector& Forward, float SideSign)
	{
		if (Owner == nullptr || Forearm == nullptr || IsOn(Forearm))
		{
			return;
		}
		Destroy();
		Tip = TipLocal;
		Side = SideSign < 0.0f ? -1.0f : 1.0f;
		// THE HAND'S AXES in the forearm's space: down the arm, the body's forward made square to it, and outward
		Along = TipLocal.IsNearlyZero() ? FVector(0.0, 0.0, -1.0) : TipLocal.GetSafeNormal();
		Ahead = Forward - Along * FVector::DotProduct(Forward, Along);
		Ahead = Ahead.IsNearlyZero() ? FVector(1.0, 0.0, 0.0) : Ahead.GetSafeNormal();
		Out = (FVector::CrossProduct(Ahead, Along) * Side).GetSafeNormal();

		// SIZED TO THE ARM AND DRESSED AS IT: the forearm block's own cross-section, and the material of whatever it carries
		// lowest -- the hand's end of that arm, in that skin
		FBox Block(ForceInit);
		UMaterialInterface* Material = nullptr;
		UPrimitiveComponent* MaterialFrom = nullptr;
		double Lowest = -1.0e9;
		TArray<USceneComponent*> Children;
		Forearm->GetChildrenComponents(false, Children);
		for (USceneComponent* Child : Children)
		{
			UPrimitiveComponent* Prim = Cast<UPrimitiveComponent>(Child);
			if (Prim == nullptr || Prim->ComponentHasTag(TEXT("WL_Prop")) || Prim->GetName().StartsWith(TEXT("Mission"))
				|| Prim->GetName().StartsWith(TEXT("Verification")) || Prim->GetName().StartsWith(TEXT("WonderlandHand")))
			{
				continue;
			}
			const FTransform InForearm = Prim->GetComponentTransform().GetRelativeTransform(Forearm->GetComponentTransform());
			const FBox Box = Prim->CalcBounds(InForearm).GetBox();
			if (!Box.IsValid)
			{
				continue;
			}
			Block += Box;
			// how far this one reaches down the arm: the hand's end is the lowest
			const double Reach = FMath::Max(FVector::DotProduct(Box.Min, Along), FVector::DotProduct(Box.Max, Along));
			if (Reach > Lowest && Prim->GetNumMaterials() > 0)
			{
				Lowest = Reach;
				Material = Prim->GetMaterial(0);
				MaterialFrom = Prim;
			}
		}
		const FVector Extent = Block.IsValid ? Block.GetExtent() : FVector(5.0);
		const double Across = FMath::Abs(FVector::DotProduct(Extent, Ahead)) + FMath::Abs(FVector::DotProduct(Extent, Out));
		// a 10 uu forearm block carries a 1.0 hand; within half to double that
		Size = static_cast<float>(FMath::Clamp(Across / 10.0, 0.5, 2.0));

		UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, HandCubePath);
		for (int32 Index = 0; Index < BoxesPerHand; ++Index)
		{
			UStaticMeshComponent* Mesh = NewObject<UStaticMeshComponent>(Owner, MakeUniqueObjectName(Owner, UStaticMeshComponent::StaticClass(),
				*FString::Printf(TEXT("WonderlandHand%s_%d"), Side > 0.0f ? TEXT("PlusY") : TEXT("MinusY"), Index)));
			Mesh->SetMobility(EComponentMobility::Movable);
			Mesh->SetStaticMesh(Cube);
			if (Material != nullptr)
			{
				Mesh->SetMaterial(0, Material);
			}
			Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			Mesh->SetGenerateOverlapEvents(false);
			Mesh->SetCanEverAffectNavigation(false);
			// a few small boxes: no distance field (the figures measured that it costs more than it shows)
			Mesh->bAffectDistanceFieldLighting = false;
			// the Dog's whole-body passes (the canon body's hide, the primary's paint) leave a WL_Prop alone: this code owns these
			Mesh->ComponentTags.AddUnique(TEXT("WL_Prop"));
			Mesh->SetupAttachment(Forearm);
			Mesh->RegisterComponent();
			Mesh->SetVisibility(bShown);
			Boxes.Add(Mesh);
		}
		On = Forearm;
		Source = MaterialFrom;
		Lay();
		LaidCurl = Curl;
	}

	FVector FHand::GripCentreLocal() const
	{
		// the fist's middle: a little more than half a palm down from the arm's end
		return Tip + Along * (6.5f * Size * 0.55f);
	}

	void FHand::Pose(float Grip, float DeltaSeconds, bool bAllowed)
	{
		if (Boxes.Num() != BoxesPerHand || !Boxes[0].IsValid())
		{
			return;
		}
		// THE ARM'S OWN MATERIAL, FOLLOWED: a primary picked while holding, a skin's flame twin or a repaint can swap the forearm's
		// material, and a hand that copied it once would keep the old colour (Second's break-test). Repaints in place need nothing:
		// the hand wears the very same instance.
		if (const UPrimitiveComponent* From = Source.Get())
		{
			UMaterialInterface* Now = From->GetNumMaterials() > 0 ? From->GetMaterial(0) : nullptr;
			if (Now != nullptr && Boxes[0]->GetMaterial(0) != Now)
			{
				for (const TWeakObjectPtr<UStaticMeshComponent>& Box : Boxes)
				{
					if (UStaticMeshComponent* Mesh = Box.Get())
					{
						Mesh->SetMaterial(0, Now);
					}
				}
			}
		}
		const float Want = FMath::Clamp(Grip, 0.0f, 1.0f);
		// EASED, NEVER SNAPPED: the fingers close as the sword arrives and open as it leaves
		Curl = DeltaSeconds > 0.0f ? FMath::FInterpTo(Curl, Want, DeltaSeconds, 9.0f) : Want;
		// ONLY WHEN THE CURL MOVED: the boxes ride on the forearm (their places are relative to it), so a settled hand costs nothing
		if (LaidCurl < 0.0f || FMath::Abs(Curl - LaidCurl) > 0.002f)
		{
			Lay();
			LaidCurl = Curl;
		}
		SetShown(bAllowed && IsArmShown());
	}

	void FHand::Lay()
	{
		const float U = Size;
		const float HandleR = 2.1f * U;
		const float PalmThick = 3.0f * U;
		const float PalmLong = 6.5f * U;
		const float PalmWide = 8.2f * U;
		const FVector Centre = GripCentreLocal();
		TArray<FTransform, TInlineAllocator<BoxesPerHand>> Laid;
		// THE BACK OF THE HAND: on the forearm's line when open, moved out of the way of the grip as the fist closes
		const FVector Palm = Centre + Out * ((HandleR + PalmThick * 0.5f) * Curl) - Along * (PalmLong * 0.05f);
		Laid.Add(HandBox(Palm, Along, Ahead, FVector(PalmWide, PalmThick, PalmLong)));

		// FOUR FINGERS from the palm's inner lower edge, each in two segments: relaxed a light curl, holding a fist round the grip
		const float A1 = FMath::DegreesToRadians(FMath::Lerp(14.0f, 92.0f, Curl));
		const float A2 = FMath::DegreesToRadians(FMath::Lerp(18.0f, 94.0f, Curl));
		const float Proximal = 4.4f * U;
		const float Distal = 3.2f * U;
		const float Spacing = 2.05f * U;
		for (int32 Finger = 0; Finger < 4; ++Finger)
		{
			const float Offset = (Finger - 1.5f) * Spacing;
			const FVector Base = Palm + Along * (PalmLong * 0.5f) - Out * (PalmThick * 0.5f) + Ahead * Offset;
			const FVector D1 = Along * FMath::Cos(A1) - Out * FMath::Sin(A1);
			const FVector D2 = Along * FMath::Cos(A1 + A2) - Out * FMath::Sin(A1 + A2);
			const FVector Joint = Base + D1 * Proximal;
			// the little finger a touch shorter: a hand, not a comb
			const float Shorter = Finger == 0 || Finger == 3 ? 0.85f : 1.0f;
			Laid.Add(HandBox(Base + D1 * (Proximal * 0.5f), D1, Ahead, FVector(1.7f * U, 1.9f * U, Proximal + 0.2f * U)));
			Laid.Add(HandBox(Joint + D2 * (Distal * Shorter * 0.5f), D2, Ahead, FVector(1.6f * U, 1.8f * U, Distal * Shorter)));
		}

		// THE THUMB, at the front of the hand: pointing down and forward relaxed, wrapping over the grip from the inside holding
		const FVector ThumbBase = Palm - Along * (PalmLong * 0.2f) - Out * (PalmThick * 0.5f) + Ahead * (PalmWide * 0.5f - 0.6f * U);
		const FVector T1 = FMath::Lerp(Ahead * 0.75f + Along * 0.65f, -Out * 0.85f - Along * 0.35f + Ahead * 0.25f, Curl).GetSafeNormal();
		const FVector T2 = FMath::Lerp(Ahead * 0.5f + Along * 0.85f, -Out * 0.3f + Along * 0.9f + Ahead * 0.2f, Curl).GetSafeNormal();
		const float ThumbA = 3.4f * U;
		const float ThumbB = 2.6f * U;
		Laid.Add(HandBox(ThumbBase + T1 * (ThumbA * 0.5f), T1, Along, FVector(1.9f * U, 1.9f * U, ThumbA)));
		Laid.Add(HandBox(ThumbBase + T1 * ThumbA + T2 * (ThumbB * 0.5f), T2, Along, FVector(1.7f * U, 1.8f * U, ThumbB)));

		for (int32 Index = 0; Index < Boxes.Num() && Index < Laid.Num(); ++Index)
		{
			if (UStaticMeshComponent* Mesh = Boxes[Index].Get())
			{
				Mesh->SetRelativeTransform(Laid[Index]);
			}
		}
	}

	bool FHand::IsArmShown() const
	{
		const UPrimitiveComponent* From = Source.Get();
		const AActor* Owner = From != nullptr ? From->GetOwner() : nullptr;
		return From != nullptr && From->IsVisible() && !From->bHiddenInGame && (Owner == nullptr || !Owner->IsHidden());
	}

	UMaterialInterface* FHand::GetWornMaterial() const
	{
		const UStaticMeshComponent* Mesh = Boxes.Num() > 0 ? Boxes[0].Get() : nullptr;
		return Mesh != nullptr ? Mesh->GetMaterial(0) : nullptr;
	}

	bool FHand::WearsItsArmsMaterial() const
	{
		// A HAND THAT NEVER FOUND ITS ARM IS NOT WEARING IT (Second): it would be wearing the cube's own, and must not pass
		const UPrimitiveComponent* From = Source.Get();
		const UMaterialInterface* Worn = GetWornMaterial();
		return From != nullptr && Worn != nullptr && From->GetNumMaterials() > 0 && Worn == From->GetMaterial(0);
	}

	void FHand::SetShown(bool bInShown)
	{
		bShown = bInShown;
		for (const TWeakObjectPtr<UStaticMeshComponent>& Box : Boxes)
		{
			if (UStaticMeshComponent* Mesh = Box.Get())
			{
				if (Mesh->IsVisible() != bShown)
				{
					Mesh->SetVisibility(bShown);
				}
			}
		}
	}

	int32 FHand::CountVisibleBoxes() const
	{
		int32 Count = 0;
		for (const TWeakObjectPtr<UStaticMeshComponent>& Box : Boxes)
		{
			const UStaticMeshComponent* Mesh = Box.Get();
			Count += Mesh != nullptr && Mesh->IsVisible() ? 1 : 0;
		}
		return Count;
	}
}

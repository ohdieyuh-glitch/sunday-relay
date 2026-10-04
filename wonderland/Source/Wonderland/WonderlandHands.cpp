// Copyright Wonderland. THE HANDS. See WonderlandHands.h.
#include "WonderlandHands.h"
#include "WonderlandFinite.h"
#include "HAL/IConsoleManager.h"

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

namespace
{
	TAutoConsoleVariable<int32> HandsFistFollowsGrip(TEXT("wl.Handoff.FistFollowsGrip"), 1,
		TEXT("Mission Handoff: 1 = a fist closes ABOUT the grip it holds (the hand rolls to the sword); 0 = laid about the forearm's forward, the old way (a before/after)."));
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

	void FHand::GetBoxes(TArray<const UStaticMeshComponent*>& OutBoxes) const
	{
		OutBoxes.Reset();
		for (const TWeakObjectPtr<UStaticMeshComponent>& Box : Boxes)
		{
			if (const UStaticMeshComponent* Mesh = Box.Get())
			{
				OutBoxes.Add(Mesh);
			}
		}
	}

	FVector FHand::GripCentreLocal() const
	{
		// the fist's middle: a little more than half a palm down from the arm's end, along the hand as it is laid
		return Tip + LaidAlong * (6.5f * Size * 0.55f);
	}

	void FHand::SetGripAxis(const FVector& WorldAxis)
	{
		const USceneComponent* Forearm = On.Get();
		if (Forearm == nullptr || WorldAxis.IsNearlyZero() || HandsFistFollowsGrip.GetValueOnGameThread() == 0)
		{
			ClearGripAxis();
			return;
		}
		const FVector InArm = Forearm->GetComponentTransform().InverseTransformVectorNoScale(WorldAxis).GetSafeNormal();
		// a grip along the arm cannot be wrapped by a fist: the old lay, never a hand folded back on itself
		GripAxis = FMath::Abs(FVector::DotProduct(InArm, Along)) > 0.95 ? FVector::ZeroVector : InArm;
	}

	void FHand::ClearGripAxis()
	{
		GripAxis = FVector::ZeroVector;
	}

	float FHand::GetGripMisalignDeg() const
	{
		return LaidGripAxis.IsNearlyZero() ? 0.0f
			: static_cast<float>(FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FMath::Abs(FVector::DotProduct(LaidAhead, LaidGripAxis)), 0.0, 1.0))));
	}

	float FHand::GetWristBendDeg() const
	{
		return static_cast<float>(FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(LaidAlong, Along), -1.0, 1.0))));
	}

	float FHand::GetWristRollDeg() const
	{
		const FVector Flat = (LaidAhead - Along * FVector::DotProduct(LaidAhead, Along)).GetSafeNormal();
		return Flat.IsNearlyZero() ? 0.0f : static_cast<float>(FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(Flat, Ahead), -1.0, 1.0))));
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
		// ONLY WHEN THE CURL OR THE HELD GRIP MOVED: the boxes ride on the forearm (their places are relative to it), so a settled
		// hand costs nothing; a held grip turns against the arm as the arm moves, so it is followed
		if (LaidCurl < 0.0f || FMath::Abs(Curl - LaidCurl) > 0.002f || !GripAxis.Equals(LaidGripAxis, 0.005))
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
		// THE FRAME THE FIST IS LAID IN: the forearm's own at rest; while a sword is held, turned so the fingers' wrap axis IS the grip's
		// (the blade out of the thumb side), the fingers as near the arm's line as the grip allows -- eased in with the curl
		FVector LayAlong = Along;
		FVector LayAhead = Ahead;
		FVector LayOut = Out;
		if (!GripAxis.IsNearlyZero() && Curl > 0.0f)
		{
			const FVector GripAlong = (Along - GripAxis * FVector::DotProduct(Along, GripAxis)).GetSafeNormal();
			const FQuat Rest(FMatrix(Ahead, Along, FVector::CrossProduct(Ahead, Along), FVector::ZeroVector));
			const FQuat Held(FMatrix(GripAxis, GripAlong, FVector::CrossProduct(GripAxis, GripAlong), FVector::ZeroVector));
			const FQuat Turned = FQuat::Slerp(Rest, Held, Curl).GetNormalized();
			LayAhead = Turned.GetAxisX();
			LayAlong = Turned.GetAxisY();
			LayOut = (Turned.GetAxisZ() * Side).GetSafeNormal();
		}
		LaidAlong = LayAlong;
		LaidAhead = LayAhead;
		LaidGripAxis = GripAxis;
		const FVector Centre = Tip + LayAlong * (PalmLong * 0.55f);
		TArray<FTransform, TInlineAllocator<BoxesPerHand>> Laid;
		// THE BACK OF THE HAND: on the forearm's line when open, moved out of the way of the grip as the fist closes
		const FVector Palm = Centre + LayOut * ((HandleR + PalmThick * 0.5f) * Curl) - LayAlong * (PalmLong * 0.05f);
		Laid.Add(HandBox(Palm, LayAlong, LayAhead, FVector(PalmWide, PalmThick, PalmLong)));

		// FOUR FINGERS from the palm's inner lower edge, each in two segments: relaxed a light curl, holding a fist round the grip
		const float A1 = FMath::DegreesToRadians(FMath::Lerp(14.0f, 80.0f, Curl));
		const float A2 = FMath::DegreesToRadians(FMath::Lerp(18.0f, 84.0f, Curl));
		const float Proximal = 4.4f * U;
		const float Distal = 3.2f * U;
		const float Spacing = 2.05f * U;
		for (int32 Finger = 0; Finger < 4; ++Finger)
		{
			const float Offset = (Finger - 1.5f) * Spacing;
			const FVector Base = Palm + LayAlong * (PalmLong * 0.5f) - LayOut * (PalmThick * 0.5f) + LayAhead * Offset;
			const FVector D1 = LayAlong * FMath::Cos(A1) - LayOut * FMath::Sin(A1);
			const FVector D2 = LayAlong * FMath::Cos(A1 + A2) - LayOut * FMath::Sin(A1 + A2);
			const FVector Joint = Base + D1 * Proximal;
			// the little finger a touch shorter: a hand, not a comb
			const float Shorter = Finger == 0 || Finger == 3 ? 0.85f : 1.0f;
			Laid.Add(HandBox(Base + D1 * (Proximal * 0.5f), D1, LayAhead, FVector(1.7f * U, 1.9f * U, Proximal + 0.2f * U)));
			Laid.Add(HandBox(Joint + D2 * (Distal * Shorter * 0.5f), D2, LayAhead, FVector(1.6f * U, 1.8f * U, Distal * Shorter)));
		}

		// THE THUMB, at the front of the hand: pointing down and forward relaxed, wrapping over the grip from the inside holding
		const FVector ThumbBase = Palm - LayAlong * (PalmLong * 0.2f) - LayOut * (PalmThick * 0.5f) + LayAhead * (PalmWide * 0.5f - 0.6f * U);
		const FVector T1 = FMath::Lerp(LayAhead * 0.75f + LayAlong * 0.65f, -LayOut * 0.4f - LayAlong * 0.85f + LayAhead * 0.25f, Curl).GetSafeNormal();
		const FVector T2 = FMath::Lerp(LayAhead * 0.5f + LayAlong * 0.85f, -LayOut * 0.3f + LayAlong * 0.9f + LayAhead * 0.2f, Curl).GetSafeNormal();
		const float ThumbA = 3.4f * U;
		const float ThumbB = 2.6f * U;
		Laid.Add(HandBox(ThumbBase + T1 * (ThumbA * 0.5f), T1, LayAlong, FVector(1.9f * U, 1.9f * U, ThumbA)));
		Laid.Add(HandBox(ThumbBase + T1 * ThumbA + T2 * (ThumbB * 0.5f), T2, LayAlong, FVector(1.7f * U, 1.8f * U, ThumbB)));

		for (int32 Index = 0; Index < Boxes.Num() && Index < Laid.Num(); ++Index)
		{
			if (UStaticMeshComponent* Mesh = Boxes[Index].Get())
			{
				// DRAWABLE ONLY (round 4's GPU hang): a box whose frame is not finite keeps its last place
				if (WonderlandFinite::IsDrawable(Laid[Index]))
				{
					Mesh->SetRelativeTransform(Laid[Index]);
				}
				else
				{
					static bool bHandBoxWarned = false;
					WonderlandFinite::NoteRefused(bHandBoxWarned, TEXT("hand box"), FString::Printf(TEXT("box %d (%s), hand size %.2f, curl %.2f: %s"), Index,
						*Mesh->GetName(), Size, Curl, *Laid[Index].ToString()));
				}
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

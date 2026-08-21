#include "WonderlandDogBody.h"

#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

namespace WonderlandDogBody
{
	const float ReferenceScale = 1.3f;

	namespace
	{
		FString CoatPath(const FName Coat)
		{
			// Loaded BY PATH at runtime, which means there is no cook-time
			// reference to it. /Game/Wonderland is force-cooked in
			// DefaultGame.ini precisely for this; without that the materials
			// are stripped and every Dog renders black.
			return FString::Printf(TEXT("/Game/Wonderland/Materials/MI_%s.MI_%s"),
								   *Coat.ToString(), *Coat.ToString());
		}

		const TCHAR* const VisorMat = TEXT("/Game/Wonderland/Materials/MI_dog_visor.MI_dog_visor");
		const TCHAR* const EyeMat   = TEXT("/Game/Wonderland/Materials/MI_dog_eye.MI_dog_eye");
		const TCHAR* const GoldMat  = TEXT("/Game/Wonderland/Materials/MI_gold_glow.MI_gold_glow");
	}

	FVector HeadLocation(const FSkin& Skin)
	{
		const float S = Skin.Scale;
		const float LegH = 92.0f * S;
		const float Bz = LegH + 34.0f * S;
		return FVector(84.0f * S, 0.0f, Bz + 50.0f * S - Skin.FootOffset);
	}

	int32 Build(AActor* Owner, USceneComponent* Parent, const FSkin& Skin)
	{
		UStaticMesh* const Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
		if (Cube == nullptr || Owner == nullptr || Parent == nullptr)
		{
			return 0;
		}

		const float S = Skin.Scale;
		const float Foot = Skin.FootOffset;
		const FString Coat = CoatPath(Skin.Coat);
		const TCHAR* const Body = *Coat;
		const TCHAR* const Visor = VisorMat;
		const TCHAR* const Eye = EyeMat;
		const TCHAR* const Gold = GoldMat;

		const float LegH = 92.0f * S;
		const float Bz = LegH + 34.0f * S;
		const float Hz = Bz + 50.0f * S;

		struct FPart { FVector Loc; FVector Scale; FRotator Rot; const TCHAR* Mat; };
		// THE ORIGINAL RELAY DOG, built to the founder's spec sheet.
		//
		// Three things in here are the identity and none of them is decoration:
		//
		//  1. THE VISOR IS A RECESS, NOT A STRIPE. It used to be one dark cube
		//     laid flat on the face, which reads as a painted band. The sheet
		//     shows a slot cut INTO the head — so the head is a brow block and a
		//     jaw block with a gap between them and a back wall closing it, and
		//     the eyes sit INSIDE that gap. The shadow the brow casts into the
		//     recess is what makes the face read as a visor at any distance.
		//  2. THE TAIL IS A STEPPED STAIRCASE rising up and back, three blocks
		//     of decreasing size. A single rotated cube was a stand-in.
		//  3. THERE IS NO CHEST TAG. The sheet's body is plain. One was added
		//     here from an earlier reference and it is removed.
		//
		// Square ears sit on the head's top corners with a notch between them,
		// the face is flat with no snout, and the legs are blocky rather than
		// slender. Proportions are identity: change these numbers and it stops
		// being the Relay Dog.
		const float HeadX = 84.0f * S;          // face plane, forward of the body
		const float LegT = 0.26f * S;           // blocky legs, not posts
		const FPart Parts[] = {
			// four blocky legs, clear gap under the body
			{ FVector(-46.0f * S, -30.0f * S, LegH * 0.5f), FVector(LegT, LegT, LegH / 100.0f), FRotator::ZeroRotator, Body },
			{ FVector(-46.0f * S,  30.0f * S, LegH * 0.5f), FVector(LegT, LegT, LegH / 100.0f), FRotator::ZeroRotator, Body },
			{ FVector( 46.0f * S, -30.0f * S, LegH * 0.5f), FVector(LegT, LegT, LegH / 100.0f), FRotator::ZeroRotator, Body },
			{ FVector( 46.0f * S,  30.0f * S, LegH * 0.5f), FVector(LegT, LegT, LegH / 100.0f), FRotator::ZeroRotator, Body },
			// body
			{ FVector(0.0f, 0.0f, Bz), FVector(1.30f * S, 0.92f * S, 0.76f * S), FRotator::ZeroRotator, Body },
			// HEAD AS THREE BLOCKS — brow, jaw, and the wall behind the slot.
			{ FVector(HeadX, 0.0f, Hz + 22.0f * S), FVector(0.86f * S, 0.90f * S, 0.42f * S), FRotator::ZeroRotator, Body },
			{ FVector(HeadX, 0.0f, Hz - 26.0f * S), FVector(0.86f * S, 0.90f * S, 0.34f * S), FRotator::ZeroRotator, Body },
			{ FVector(HeadX - 30.0f * S, 0.0f, Hz), FVector(0.34f * S, 0.90f * S, 0.94f * S), FRotator::ZeroRotator, Body },
			// the dark interior of the recess, set BACK from the face plane
			{ FVector(HeadX - 6.0f * S, 0.0f, Hz - 4.0f * S), FVector(0.62f * S, 0.80f * S, 0.13f * S), FRotator::ZeroRotator, Visor },
			// two glowing gold eyes INSIDE the slot
			{ FVector(HeadX + 4.0f * S, -22.0f * S, Hz - 4.0f * S), FVector(0.14f * S, 0.26f * S, 0.11f * S), FRotator::ZeroRotator, Eye },
			{ FVector(HeadX + 4.0f * S,  22.0f * S, Hz - 4.0f * S), FVector(0.14f * S, 0.26f * S, 0.11f * S), FRotator::ZeroRotator, Eye },
			// two square ears with a notch between them
			{ FVector(HeadX - 12.0f * S, -28.0f * S, Hz + 62.0f * S), FVector(0.30f * S, 0.26f * S, 0.44f * S), FRotator::ZeroRotator, Body },
			{ FVector(HeadX - 12.0f * S,  28.0f * S, Hz + 62.0f * S), FVector(0.30f * S, 0.26f * S, 0.44f * S), FRotator::ZeroRotator, Body },
			// stepped tail, rising up and back
			{ FVector(-74.0f * S, 0.0f, Bz + 14.0f * S), FVector(0.30f * S, 0.24f * S, 0.24f * S), FRotator::ZeroRotator, Body },
			{ FVector(-90.0f * S, 0.0f, Bz + 34.0f * S), FVector(0.26f * S, 0.22f * S, 0.26f * S), FRotator::ZeroRotator, Body },
			{ FVector(-102.0f * S, 0.0f, Bz + 56.0f * S), FVector(0.22f * S, 0.20f * S, 0.28f * S), FRotator::ZeroRotator, Body },
		};

		int32 Built = 0;
		for (const FPart& Part : Parts)
		{
			UStaticMeshComponent* const Comp = NewObject<UStaticMeshComponent>(
				Owner, FName(*FString::Printf(TEXT("RelayDogPart_%d"), Built)));
			if (Comp == nullptr)
			{
				continue;
			}
			Comp->SetupAttachment(Parent);
			Comp->SetStaticMesh(Cube);
			Comp->SetRelativeLocation(FVector(Part.Loc.X, Part.Loc.Y, Part.Loc.Z - Foot));
			Comp->SetRelativeScale3D(Part.Scale);
			Comp->SetRelativeRotation(Part.Rot);
			Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			if (UMaterialInterface* const M = LoadObject<UMaterialInterface>(nullptr, Part.Mat))
			{
				Comp->SetMaterial(0, M);
			}
			Comp->RegisterComponent();
			++Built;
		}

		// ACCESSORIES SIT ON THE DOG; they never restate it. A hat is two boxes
		// above the head, at the head's own scale, so the silhouette underneath
		// stays exactly the canonical one.
		if (Skin.Accessory == FName(TEXT("tophat")) || Skin.Accessory == FName(TEXT("crown")))
		{
			const FVector Head = HeadLocation(Skin);
			const bool bHat = Skin.Accessory == FName(TEXT("tophat"));
			const FPart Extras[] = {
				{ FVector(Head.X, 0.0f, Head.Z + 52.0f * S),
				  bHat ? FVector(0.62f * S, 0.62f * S, 0.06f * S) : FVector(0.52f * S, 0.52f * S, 0.08f * S),
				  FRotator::ZeroRotator, bHat ? Visor : Gold },
				{ FVector(Head.X, 0.0f, Head.Z + (bHat ? 84.0f : 70.0f) * S),
				  bHat ? FVector(0.40f * S, 0.40f * S, 0.34f * S) : FVector(0.34f * S, 0.34f * S, 0.26f * S),
				  FRotator::ZeroRotator, bHat ? Visor : Gold },
			};
			for (const FPart& Part : Extras)
			{
				UStaticMeshComponent* const Comp = NewObject<UStaticMeshComponent>(
					Owner, FName(*FString::Printf(TEXT("RelayDogPart_%d"), Built)));
				if (Comp == nullptr)
				{
					continue;
				}
				Comp->SetupAttachment(Parent);
				Comp->SetStaticMesh(Cube);
				Comp->SetRelativeLocation(FVector(Part.Loc.X, Part.Loc.Y, Part.Loc.Z - Foot));
				Comp->SetRelativeScale3D(Part.Scale);
				Comp->SetCollisionEnabled(ECollisionEnabled::NoCollision);
				if (UMaterialInterface* const M = LoadObject<UMaterialInterface>(nullptr, Part.Mat))
				{
					Comp->SetMaterial(0, M);
				}
				Comp->RegisterComponent();
				++Built;
			}
		}
		return Built;
	}
}

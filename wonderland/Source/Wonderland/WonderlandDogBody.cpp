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
		const float LegH = 100.0f * S;
		const float Bz = LegH + 34.0f * S;
		return FVector(78.0f * S, 0.0f, Bz + 50.0f * S - Skin.FootOffset);
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

		const float LegH = 100.0f * S;
		const float Bz = LegH + 34.0f * S;
		const float Hz = Bz + 50.0f * S;

		struct FPart { FVector Loc; FVector Scale; FRotator Rot; const TCHAR* Mat; };
		const FPart Parts[] = {
			// four slender legs, clear gap under the body
			{ FVector(-48.0f * S, -30.0f * S, LegH * 0.5f), FVector(0.19f * S, 0.19f * S, LegH / 100.0f), FRotator::ZeroRotator, Body },
			{ FVector(-48.0f * S,  30.0f * S, LegH * 0.5f), FVector(0.19f * S, 0.19f * S, LegH / 100.0f), FRotator::ZeroRotator, Body },
			{ FVector( 48.0f * S, -30.0f * S, LegH * 0.5f), FVector(0.19f * S, 0.19f * S, LegH / 100.0f), FRotator::ZeroRotator, Body },
			{ FVector( 48.0f * S,  30.0f * S, LegH * 0.5f), FVector(0.19f * S, 0.19f * S, LegH / 100.0f), FRotator::ZeroRotator, Body },
			// compact body
			{ FVector(0.0f, 0.0f, Bz), FVector(1.28f * S, 0.86f * S, 0.66f * S), FRotator::ZeroRotator, Body },
			// head at the front (+X), flat face, no snout
			{ FVector(78.0f * S, 0.0f, Hz), FVector(0.80f * S, 0.82f * S, 0.80f * S), FRotator::ZeroRotator, Body },
			// two square ears
			{ FVector(6.0f * S, -26.0f * S, Hz + 46.0f * S), FVector(0.24f * S, 0.2f * S, 0.40f * S), FRotator::ZeroRotator, Body },
			{ FVector(6.0f * S,  26.0f * S, Hz + 46.0f * S), FVector(0.24f * S, 0.2f * S, 0.40f * S), FRotator::ZeroRotator, Body },
			// black visor band across the flat face
			{ FVector(118.0f * S, 0.0f, Hz + 6.0f * S), FVector(0.18f * S, 0.86f * S, 0.30f * S), FRotator::ZeroRotator, Visor },
			// gold glowing eyes
			{ FVector(124.0f * S, -21.0f * S, Hz + 2.0f * S), FVector(0.1f * S, 0.22f * S, 0.13f * S), FRotator::ZeroRotator, Eye },
			{ FVector(124.0f * S,  21.0f * S, Hz + 2.0f * S), FVector(0.1f * S, 0.22f * S, 0.13f * S), FRotator::ZeroRotator, Eye },
			// small gold identity tag at the chest
			{ FVector(60.0f * S, 0.0f, Bz - 2.0f * S), FVector(0.12f * S, 0.26f * S, 0.26f * S), FRotator::ZeroRotator, Gold },
			// up-tail at the back
			{ FVector(-74.0f * S, 0.0f, Bz + 24.0f * S), FVector(0.44f * S, 0.18f * S, 0.20f * S), FRotator(-38.0f, 0.0f, 0.0f), Body },
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

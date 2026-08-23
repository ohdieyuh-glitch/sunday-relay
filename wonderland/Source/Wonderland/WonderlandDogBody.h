// THE CANONICAL RELAY DOG BODY — defined once, built by every Dog in the world.
//
// WHY THIS FILE EXISTS
//
// The founder's identity rule is that a skin transforms the Relay Dog and never
// replaces it: white blocky body, four slender legs with a clear gap, a cube
// head with two square ears, a FLAT face carrying the BLACK VISOR BAND and GOLD
// GLOWING EYES, a small gold chest tag, an up-tail. Proportions are identity.
//
// That table used to live inside AWonderlandDogPawn::BuildVisibleBody, and the
// world's ambient Dogs were supposed to be built from a copy of it. A copy is
// how this project already lost the Dog once: verify-dog-proxy.py exists
// because a transcription of these numbers drifted to 168uu tall against a real
// 325uu Dog — every composition figure quoted for the focal subject of the hero
// frame was wrong by a factor of nearly three, and nothing could have noticed.
//
// So there is one table, here, and both the player's Dog and every ambient Dog
// call into it. A skin may change the COAT MATERIAL and add an ACCESSORY. It
// may not change a single number below.
//
// PRESENTATION ONLY. Every part is NoCollision and none of this reads Relay
// state. A Dog's activity arrives from Relay through ApplyWorldState; nothing
// about its body is allowed to become a second, untruthful status channel.

#pragma once

class UStaticMeshComponent;

#include "CoreMinimal.h"

class AActor;
class USceneComponent;

namespace WonderlandDogBody
{
	/** The scale the canonical proportions are quoted at. verify-dog-proxy.py
	 *  reads this number to check the preview's transcription against them. */
	extern const float ReferenceScale;

	/** How the Dog is dressed. Nothing here can alter the silhouette. */
	struct FSkin
	{
		/** Coat material instance name, e.g. "dog_body" (white), "dog_pink". */
		FName Coat = FName(TEXT("dog_body"));
		/** "none", "tophat", "crown". Rides on the head; never resizes it. */
		FName Accessory = FName(TEXT("none"));
		/** THE EYES ARE PART OF THE SKIN, and they were the one part of the
		 *  identity hard-coded to a single material.
		 *
		 *  The OG Relay Dog's eyes are GOLD and that is canonical. The founder's
		 *  Skeleton Flame variant is the same Dog with blue ghostfire and
		 *  GLOWING BLUE EYES -- a skin, explicitly not a separate species. With
		 *  the eye material fixed at MI_dog_eye there was no way to say that
		 *  without editing the shared body, which is the file whose entire
		 *  purpose is that nobody edits it per-Dog.
		 *
		 *  Changing a COLOUR is a skin. Changing a PROPORTION is not, and this
		 *  cannot: it names a material and nothing else. */
		FName Eyes = FName(TEXT("dog_eye"));
		/** Uniform. There is deliberately no per-axis scale: independent axis
		 *  scaling distorts the body, and that is the rule this whole file is
		 *  protecting. */
		float Scale = 1.3f;
		/** Subtracted from every part's Z. The player's pawn sits ~100uu above
		 *  the ground on its PlayerStart; an actor placed at ground level uses 0. */
		float FootOffset = 0.0f;
	};

	/**
	 * Attach the canonical Dog to `Parent`, owned by `Owner`.
	 *
	 * Returns the number of parts built. Zero means the engine's basic Cube did
	 * not load and NO body was made — the caller must treat that as a visible
	 * failure rather than a Dog that happens to be invisible.
	 */
	/** The parts a gait needs to move, handed back by Build.
	 *
	 *  Build used to return only a COUNT, so nothing downstream could reach a
	 *  leg — which is the mechanical reason the Dogs slid: four cubes welded to
	 *  a root that SetActorLocation translated. Legs are indexed to match
	 *  WonderlandGait::LegPhaseOffset: 0 left-hind, 1 right-hind, 2 left-fore,
	 *  3 right-fore. Any of these may be null if that part failed to build; a
	 *  caller must check rather than assume a complete Dog. */
	struct FRig
	{
		UStaticMeshComponent* Legs[4] = { nullptr, nullptr, nullptr, nullptr };
		UStaticMeshComponent* Torso = nullptr;
		UStaticMeshComponent* Head = nullptr;
		/** Resting local offsets, so animation is relative to the pose the
		 *  canonical proportions put each part at rather than to the origin. */
		FVector LegRest[4] = { FVector::ZeroVector, FVector::ZeroVector,
		                       FVector::ZeroVector, FVector::ZeroVector };
		/** Rest scale of each leg. A limb that swings from the hip needs to know
		 *  where the hip IS — it is half a leg above the rest centre — and it
		 *  stretches, so the length it stretches FROM has to be recorded before
		 *  anything writes to the component. Reading the scale back at pose time
		 *  would compound last frame's stretch into this frame's. */
		FVector LegRestScale[4] = { FVector::OneVector, FVector::OneVector,
		                            FVector::OneVector, FVector::OneVector };
		FVector TorsoRest = FVector::ZeroVector;
		FVector HeadRest = FVector::ZeroVector;
	};

	int32 Build(AActor* Owner, USceneComponent* Parent, const FSkin& Skin,
	            FRig* OutRig = nullptr);

	/** The head's local offset, so an accessory or an animation can find it. */
	FVector HeadLocation(const FSkin& Skin);
}

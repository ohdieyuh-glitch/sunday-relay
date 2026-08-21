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
	int32 Build(AActor* Owner, USceneComponent* Parent, const FSkin& Skin);

	/** The head's local offset, so an accessory or an animation can find it. */
	FVector HeadLocation(const FSkin& Skin);
}

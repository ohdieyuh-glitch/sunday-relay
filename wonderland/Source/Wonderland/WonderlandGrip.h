// Copyright Wonderland. THE ATTACHMENT CONTRACT: how a hand holds a Mission Handoff object.
#pragma once

#include "CoreMinimal.h"

class USceneComponent;

/**
 * ONE CONTRACT FOR EVERY HELD THING (Mission Handoff architecture, 2026-10-02): a held object sits in a hand through a GRIP
 * FRAME -- a transform in the hand's own forearm frame -- and never through a per-mascot special case. The Angelic Twin
 * Swords are its first users; any later handoff form attaches the same way.
 *
 * THE FRAME, in the forearm's own space: the grip's centre in the fist (the limb's measured tip, a little back into the
 * hand), the object's +Z (a sword's blade) leaning out of the fist from the forearm's forward toward its own length by the
 * tilt, its +Y (a sword's guard) across the fist -- MIRRORED by the side, so the pair is a mirrored pair -- and its +X out
 * of the knuckles' side. The numbers are console variables (wl.Handoff.Grip*), settled from game frames, never asserted.
 *
 * Plain C++ (the Niagara FName rule).
 */
namespace WonderlandGrip
{
	/** How a hand holds: degrees and uu at a head width of 60. */
	struct FHold
	{
		/** From the forearm's forward toward its length: 0 holds the blade straight out of the knuckles' line. */
		float TiltDeg = 25.0f;
		/** Twist about the object's own +Z. */
		float RollDeg = 0.0f;
		/** How far back from the limb's tip, into the hand, the grip's centre sits. */
		float IntoHandUU = 4.0f;
		/** Forward of the forearm's line (the fist's middle is ahead of the bone's line). */
		float ForwardUU = 1.5f;
	};

	/** The hold as the console variables have it right now. */
	FHold CurrentHold();

	/**
	 * The world transform of a held object's grip in a hand, with no scale.
	 * @param Forearm           the hand's forearm component (the limb's middle joint).
	 * @param TipLocal          the limb's tip in the forearm's own space (measured at bind).
	 * @param ForwardInForearm  the body's forward in the forearm's own space at rest (the rig's measured face direction).
	 * @param SideSign          +1 for the hand on the body's +Y side, -1 for the other: the mirror.
	 */
	FTransform HandGrip(const USceneComponent* Forearm, const FVector& TipLocal, const FVector& ForwardInForearm, float SideSign, const FHold& Hold);

	/**
	 * The same frame with its centre given: a hand's closed fist (WonderlandHands), where the grip belongs once there are
	 * fingers to close round it. The axes are HandGrip's; IntoHandUU and ForwardUU are not used.
	 */
	FTransform HandGripAt(const USceneComponent* Forearm, const FVector& TipLocal, const FVector& CentreLocal, const FVector& ForwardInForearm,
		float SideSign, const FHold& Hold);

	/**
	 * The grip frame IN THE FOREARM'S OWN SPACE (no scale): what a held object is parented to the forearm with, so it follows
	 * every write of that joint in the same frame -- a worn skin's joints are written after the Dog's, and an object placed in
	 * the world from them would trail the hand by a frame.
	 */
	FTransform HandGripLocal(const FVector& TipLocal, const FVector& CentreLocal, const FVector& ForwardInForearm, float SideSign, const FHold& Hold);
}

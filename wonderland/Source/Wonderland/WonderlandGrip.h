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
		/**
		 * THE V AROUND THE BODY (the founder's stance sheet, check 2: "the blades angled out and up ... no blade lies along the
		 * body, crosses the torso or head, or points into the ground"). On: a held blade's DIRECTION is set in the Dog's own
		 * frame -- up, out to its own side by VDeg, forward by VForwardDeg, its broad face to the camera behind -- so the pair
		 * reads as a V at any arm angle and in any act of locomotion. Off: the blade follows the forearm (TiltDeg / RollDeg).
		 */
		bool bBodyV = true;
		/** Degrees from STRAIGHT UP, out to the blade's own side: under 90 the V points up, over 90 down. The founder's 10-03 stance
		 *  reference holds both blades LOW and diagonal, out and down from the body: 122. */
		float VDeg = 122.0f;
		float VForwardDeg = 10.0f;
		/** In the sprint (eased by the dash's weight): the tips trailing back, like the trails they leave -- as far back as the charge's, so
		 *  a pumping hand never drives a 123 uu blade into the floor (Second's review of 92f83bff: -35 put the tips 15 uu below the soles). */
		float DashVForwardDeg = -72.0f;
		/** THE CHARGING STANCE (founder, 10-04: "arms and swords low, naturally following the charging body"): standing, the blades
		 *  low and trailing -- out and down by ChargeVDeg, back by ChargeVForwardDeg -- behind a body about to run. */
		float ChargeVDeg = 120.0f;
		float ChargeVForwardDeg = -72.0f;
	};

	/** The hold with the sprint's trailing tips eased in by DashWeight (0..1). */
	FHold WithDash(const FHold& Hold, float DashWeight);
	/** The hold with the charging stance's low, trailing blades eased in by ChargeWeight (0..1: armed and standing). */
	FHold WithCharge(const FHold& Hold, float ChargeWeight);

	/** The hold as the console variables have it right now. */
	FHold CurrentHold();

	/**
	 * A held blade's world rotation in the V around the body: +Z up and out to the hand's own side (the Dog's own left is its -Y)
	 * by Hold.VDeg and forward by Hold.VForwardDeg; +X (the broad face) toward the Dog's back. From the actor's transform only,
	 * so it never mirrors with a limb's local axes.
	 */
	FQuat BodyVRotation(const FTransform& ActorWorld, bool bLeftHand, const FHold& Hold);

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

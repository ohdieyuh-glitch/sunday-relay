// Copyright Wonderland. THE HANDS: every mascot's stylized, functional hands, and the fist a held object sits in.
#pragma once

#include "CoreMinimal.h"

class AActor;
class USceneComponent;
class UStaticMeshComponent;
class UMaterialInterface;
class UPrimitiveComponent;

/**
 * FOUNDER (2026-10-02): "Every mascot needs stylized functional hands/fingers and stable dual-grip sockets." The canon
 * body's arms end at the forearm's block (11 joints, no hand), and so does every skin's.
 *
 * BUILT IN CODE, ON THE BODY THE PLAYER SEES: a palm, four fingers in two segments and a thumb, as boxes in Wonderland's
 * own language, on the forearm of whichever body is visible -- Relay OG's canon body, or the worn skin's own forearm -- and
 * wearing THAT forearm's own material, so a hand is the skin's hand (and takes its colourway with it). No asset, no
 * reflected name (the Niagara FName rule), nothing in the skin generator or the shared Content to regenerate.
 *
 * PLAIN STATIC-MESH BOXES, NOT ONE INSTANCED MESH (Second's review, 10-03): an instanced mesh needs its material flagged for
 * instancing, and a cooked build draws the default material where it is not -- while the editor silently sets the flag and
 * looks right. A plain static mesh needs no flag, and the forearm already draws its material as one: cooked-safe by
 * construction. Tagged WL_Prop, so the Dog's whole-body passes (the canon body's hide, the primary's paint) leave them to
 * this code, which shows them, colours them and lays them.
 *
 * FUNCTIONAL: relaxed, the fingers hang lightly curled; holding, they close into a fist round the object's grip -- the
 * curl eased, never snapped, and CARRIED OVER a rebuild (a skin worn while holding keeps the fist closed). The fist's centre
 * is the grip frame's centre (WonderlandGrip), so the sword's grip passes through the closed fingers.
 *
 * NEVER THROUGH A PROP: while a mission act holds the book, the brush, the lens or the scraper, the hands step aside (the
 * founder accepted those acts as they are, handless, 43/43 on 09-30). Never on a hidden body: the hand shows only while
 * the arm it is built on is drawn.
 *
 * A HAND IS NOT A MEASURE. The limb tips the QA and the mission acts measure (the canon's MeasureChain at bind, a skin's
 * figure data) are taken before and apart from these boxes, so no proven hand-gap or height measure moves.
 */
namespace WonderlandHands
{
	/** One hand on one forearm. Plain C++: the boxes belong to the forearm's owning actor; this holds them weakly. */
	class WONDERLAND_API FHand
	{
	public:
		/**
		 * Builds the hand on Forearm, or rebuilds it when the forearm is a different one (a skin worn or taken off).
		 * @param TipLocal  the limb's tip (the end of the forearm's block) in the forearm's own space.
		 * @param Forward   the body's forward in the forearm's own space at rest.
		 * @param SideSign  +1 for the hand on the body's +Y side, -1 for the other: the thumb and the curl mirror.
		 */
		void Attach(AActor* Owner, USceneComponent* Forearm, const FVector& TipLocal, const FVector& Forward, float SideSign);
		/** True when the hand is built on this forearm. */
		bool IsOn(const USceneComponent* Forearm) const;
		/**
		 * Eases the fingers toward a grip (0 relaxed, 1 a closed fist) and lays the boxes when the curl moved (they ride on the
		 * forearm, so a settled hand costs nothing). Shown only when bAllowed (no mission prop in the hands) and its arm is drawn.
		 */
		void Pose(float Grip, float DeltaSeconds, bool bAllowed = true);
		void SetShown(bool bShown);
		void Destroy();
		/** For the QA: how many boxes the hand draws (0 hidden), and how closed it is now. */
		int32 CountVisibleBoxes() const;
		float GetCurl() const { return Curl; }
		/** The closed fist's centre in the forearm's own space: where a held grip's centre belongs. */
		FVector GripCentreLocal() const;
		/** The hand's own axes in the forearm's space, so a grip lies across the fist. */
		FVector GetAlong() const { return Along; }
		FVector GetForward() const { return Ahead; }
		/** For the QA: the material the hand wears now, and whether it is its arm's own -- FALSE for a hand that never found its arm. */
		UMaterialInterface* GetWornMaterial() const;
		bool WearsItsArmsMaterial() const;
		/** True while the arm the hand is built on is itself drawn (its part visible, its actor not hidden). */
		bool IsArmShown() const;
		/**
		 * THE FIST CLOSES ABOUT THE GRIP IT HOLDS (Second's review, 10-03): laid about the forearm's forward, the held grip crossed the
		 * fist at 61-72 deg and sat 3-6 uu inside the palm and a finger. While a sword is held its axis (pommel to point, world) turns
		 * the hand -- the fingers kept as near the arm's line as the grip allows, so mostly a roll about the forearm -- eased in with
		 * the curl, the blade out of the thumb side. wl.Handoff.FistFollowsGrip 0 lays the old way (a before/after).
		 */
		void SetGripAxis(const FVector& WorldAxis);
		void ClearGripAxis();
		/** For the QA, after laying: the angle (deg) between the fist's wrap axis and the held grip's; how far the hand bends off the
		 *  forearm's line; and how far its wrap axis rolled about the forearm. All 0 with no sword held. */
		float GetGripMisalignDeg() const;
		float GetWristBendDeg() const;
		float GetWristRollDeg() const;

	private:
		/** Lays the boxes for the current curl, in the forearm's space. */
		void Lay();

		TWeakObjectPtr<USceneComponent> On;
		TArray<TWeakObjectPtr<UStaticMeshComponent>> Boxes;
		/** The part of the arm whose material the hand wears: followed every pose, never copied once. */
		TWeakObjectPtr<UPrimitiveComponent> Source;
		FVector Tip = FVector::ZeroVector;
		FVector Along = FVector(0.0, 0.0, -1.0);
		FVector Ahead = FVector(1.0, 0.0, 0.0);
		FVector Out = FVector(0.0, 1.0, 0.0);
		float Side = 1.0f;
		/** The forearm block's own thickness across and front to back, measured at build: the hand is sized to the arm. */
		float Size = 1.0f;
		/** Kept across a rebuild: a fist re-made on a new forearm while holding starts closed. */
		float Curl = 0.0f;
		/** The curl the boxes were last laid at (-1: not laid on this forearm yet). */
		float LaidCurl = -1.0f;
		/** The held grip's axis in the forearm's space (zero: no sword held, or the grip lies along the arm), and the frame laid. */
		FVector GripAxis = FVector::ZeroVector;
		FVector LaidGripAxis = FVector::ZeroVector;
		FVector LaidAlong = FVector(0.0, 0.0, -1.0);
		FVector LaidAhead = FVector(1.0, 0.0, 0.0);
		bool bShown = true;
	};

	/** How many boxes one hand is made of: a palm, four fingers of two segments, a thumb of two. */
	inline constexpr int32 BoxesPerHand = 11;
}

// Copyright Wonderland. THE HANDS: every mascot's stylized, functional hands, and the fist a held object sits in.
#pragma once

#include "CoreMinimal.h"

class AActor;
class USceneComponent;
class UInstancedStaticMeshComponent;

/**
 * FOUNDER (2026-10-02): "Every mascot needs stylized functional hands/fingers and stable dual-grip sockets." The canon
 * body's arms end at the forearm's block (11 joints, no hand), and so does every skin's.
 *
 * BUILT IN CODE, ON THE BODY THE PLAYER SEES: a palm, four fingers in two segments and a thumb, as boxes in Wonderland's
 * own language, on the forearm of whichever body is visible -- Relay OG's canon body, or the worn skin's own forearm -- and
 * wearing THAT forearm's own material, so a hand is the skin's hand (and takes its colourway with it). No asset, no
 * reflected name (the Niagara FName rule), nothing in the skin generator or the shared Content to regenerate.
 *
 * FUNCTIONAL: relaxed, the fingers hang lightly curled; holding, they close into a fist round the object's grip -- the
 * curl eased, never snapped. The fist's centre is the grip frame's centre (WonderlandGrip), so the sword's grip passes
 * through the closed fingers rather than floating at a block's end.
 *
 * A HAND IS NOT A MEASURE. The limb tips the QA and the mission acts measure (the canon's MeasureChain at bind, a skin's
 * figure data) are taken before and apart from these boxes, so no proven hand-gap or height measure moves.
 */
namespace WonderlandHands
{
	/** One hand on one forearm. Plain C++: the box component belongs to the forearm's owning actor; this holds it weakly. */
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
		/** Eases the fingers toward a grip (0 relaxed, 1 a closed fist) and lays the boxes. */
		void Pose(float Grip, float DeltaSeconds);
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

	private:
		TWeakObjectPtr<USceneComponent> On;
		TWeakObjectPtr<UInstancedStaticMeshComponent> Boxes;
		FVector Tip = FVector::ZeroVector;
		FVector Along = FVector(0.0, 0.0, -1.0);
		FVector Ahead = FVector(1.0, 0.0, 0.0);
		FVector Out = FVector(0.0, 1.0, 0.0);
		float Side = 1.0f;
		/** The forearm block's own thickness across and front to back, measured at build: the hand is sized to the arm. */
		float Size = 1.0f;
		float Curl = 0.0f;
		bool bShown = true;
	};

	/** How many boxes one hand is made of: a palm, four fingers of two segments, a thumb of two. */
	inline constexpr int32 BoxesPerHand = 11;
}

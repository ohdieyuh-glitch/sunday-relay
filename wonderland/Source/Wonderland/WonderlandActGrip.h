// Copyright Wonderland. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

/**
 * THE ACT TOOLS IN THE FIST (the founder, 10-03: visible proof that the hands and fingers do not pass through the props).
 *
 * The paintbrush and the scraper used to ride on the working forearm with their handles running down its line and into its
 * block, and the hands stepped aside while they showed. A handle along the arm cannot be wrapped by a fist, so a held tool is
 * laid the way a sword is: its handle along the fingers' wrap, turned off the forearm's line toward the thumb, its grip point at
 * the fist's centre, the working end out of the thumb side, and its cross-section fitted to the fist's hollow (its length kept).
 *
 * Plain C++: the maths of the attachment only. The Dog decides which hand holds what and when (RelayDogCharacter::UpdateHands).
 */
namespace WonderlandActGrip
{
	/** A tool's handle in the tool's own space: the way from the butt to the working end, the point the fist closes round, and its half-width. */
	struct FToolHandle
	{
		FVector Toward = FVector(0.0, 0.0, -1.0);
		FVector GripPoint = FVector::ZeroVector;
		double HalfWidth = 2.5;
	};

	/** wl.Dog.ActHands: 1 (default) the brush and the scraper are held by a visible fist; 0 the 09-30 look, the hands aside while any prop shows. */
	WONDERLAND_API bool ToolsInTheFist();

	/** wl.Dog.ActGripTilt: how far the handle is turned off the forearm's line toward the thumb, in degrees (35-90). */
	WONDERLAND_API float ToolTiltDeg();

	/** The grip axis in the forearm's space: the forearm's line (Along) turned TiltDeg toward the thumb side (Ahead). */
	WONDERLAND_API FVector ToolAxisInArm(const FVector& Along, const FVector& Ahead, float TiltDeg);

	/**
	 * The tool's world transform: the handle through FistCentre along GripAxis (the working end toward +GripAxis, out of the thumb
	 * side), the tool's +X toward BackOfHand, and its cross-section scaled so the handle's half-width fits HollowRadius.
	 */
	WONDERLAND_API FTransform ToolWorld(const FToolHandle& Handle, const FVector& FistCentre, const FVector& GripAxis, const FVector& BackOfHand,
		double HollowRadius);
}

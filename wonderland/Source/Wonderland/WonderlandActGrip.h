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

	/**
	 * wl.Dog.ActHold: 1 (default, with wl.Dog.ActHands 1) the magnifying glass is held in the working hand's closed fist, its handle through
	 * the fist (act hands v4); 0 the round-5 look -- the hands step aside while the glass shows. The book's grips are not built: its hands
	 * still step aside either way.
	 */
	WONDERLAND_API bool GlassInTheFist();

	/**
	 * THE GLASS'S GRIP, simulated before it was built (lens_sweep.py: the lens's own boxes, the fist of FHand::Lay closed about the handle,
	 * the forearm's block 5 x hand size thick, the forearm 0-45 deg out of the glass's plane, hand sizes 0.7-2.0): the fist's centre this
	 * far up the handle from where the handle began, and the handle this much longer below (the cap moved with it), in head-width
	 * sixtieths. Feasible grips (no hand box more than 40% of its thickness into the glass, the forearm >= 0.5 uu clear of it) at a 4 longer
	 * handle: size 0.7 at 3.5-13, 1.0 at 5-12.5, 1.32 at 7-10.5, 1.67 at 5-9, 2.0 at -2-9 -- 8 sits inside every band with a 1 margin.
	 * As built (0 longer) a 1.32 hand had NO feasible grip: the cap, wider than the handle, met the forearm's end.
	 */
	inline constexpr double LensGripUp = 8.0;
	inline constexpr double LensHandleLonger = 4.0;

	/**
	 * The glass's handle-up turned within the glass's own plane (Aim kept: the glass still faces along the eye's line) until it is square to
	 * the forearm, at most MaxDeg from Designed. A fist on the handle then lies straight on its arm, and the handle below the fist points
	 * away from the forearm's block -- at the skins' measured 52 deg the handle ran into it (round 4's GEOM lines).
	 */
	WONDERLAND_API FVector LensUpSquareToArm(const FVector& Aim, const FVector& Designed, const FVector& ForearmAlong, float MaxDeg);
}

// Copyright Wonderland. All Rights Reserved.

#include "WonderlandActGrip.h"

#include "HAL/IConsoleManager.h"

namespace
{
	TAutoConsoleVariable<int32> GActGripToolsInFist(
		TEXT("wl.Dog.ActHands"),
		1,
		TEXT("1 (default): the paintbrush and the scraper are held by the working hand's visible fist (the founder, 10-03). ")
		TEXT("0: the 09-30 look -- the tools ride on the forearm and the hands step aside while any act prop shows."),
		ECVF_Default);

	TAutoConsoleVariable<float> GActGripTiltDeg(
		TEXT("wl.Dog.ActGripTilt"),
		60.0f,
		TEXT("Degrees a held tool's handle is turned off the forearm's line toward the thumb (35-90; a handle along the arm cannot be ")
		TEXT("wrapped by a fist). Default 60: a 30-degree wrist, the tool still reaching out ahead of the hand, and its butt clear of ")
		TEXT("the forearm's block (55 sank it 0.1-1.1 uu in; simulated over hand sizes 0.7-1.3, sim_act_grip.py)."),
		ECVF_Default);

	TAutoConsoleVariable<int32> GActGripGlassInFist(
		TEXT("wl.Dog.ActHold"),
		1,
		TEXT("1 (default): the magnifying glass is held in the working hand's closed fist, its handle turned in the glass's own plane square ")
		TEXT("to the forearm (act hands v4). 0: the round-5 look -- the hands step aside while the glass shows. Needs wl.Dog.ActHands 1."),
		ECVF_Default);
}

namespace WonderlandActGrip
{
	bool ToolsInTheFist()
	{
		return GActGripToolsInFist.GetValueOnGameThread() != 0;
	}

	float ToolTiltDeg()
	{
		return FMath::Clamp(GActGripTiltDeg.GetValueOnGameThread(), 35.0f, 90.0f);
	}

	bool GlassInTheFist()
	{
		return ToolsInTheFist() && GActGripGlassInFist.GetValueOnGameThread() != 0;
	}

	FVector LensUpSquareToArm(const FVector& Aim, const FVector& Designed, const FVector& ForearmAlong, float MaxDeg)
	{
		const FVector Out = Aim.GetSafeNormal();
		const FVector Up = (Designed - Out * FVector::DotProduct(Designed, Out)).GetSafeNormal();
		if (Out.IsNearlyZero() || Up.IsNearlyZero())
		{
			return Designed.GetSafeNormal();
		}
		// the forearm's way within the glass's plane; an arm pointing through the glass gives nothing to square to
		const FVector InPlane = ForearmAlong - Out * FVector::DotProduct(ForearmAlong, Out);
		if (InPlane.Size() < 0.2)
		{
			return Up;
		}
		// square to that way, in the plane, on the side nearer the design
		FVector Square = FVector::CrossProduct(Out, InPlane.GetSafeNormal()).GetSafeNormal();
		if (FVector::DotProduct(Square, Up) < 0.0)
		{
			Square = -Square;
		}
		const double Between = FMath::Acos(FMath::Clamp(FVector::DotProduct(Up, Square), -1.0, 1.0));
		const double Most = FMath::DegreesToRadians(static_cast<double>(FMath::Clamp(MaxDeg, 0.0f, 90.0f)));
		if (Between <= Most)
		{
			return Square;
		}
		const FVector Toward = (Square - Up * FVector::DotProduct(Square, Up)).GetSafeNormal();
		return Toward.IsNearlyZero() ? Up : (Up * FMath::Cos(Most) + Toward * FMath::Sin(Most)).GetSafeNormal();
	}

	FVector ToolAxisInArm(const FVector& Along, const FVector& Ahead, float TiltDeg)
	{
		const double Tilt = FMath::DegreesToRadians(static_cast<double>(TiltDeg));
		const FVector Axis = Along * FMath::Cos(Tilt) + Ahead * FMath::Sin(Tilt);
		return Axis.IsNearlyZero() ? Ahead : Axis.GetSafeNormal();
	}

	FTransform ToolWorld(const FToolHandle& Handle, const FVector& FistCentre, const FVector& GripAxis, const FVector& BackOfHand, double HollowRadius)
	{
		// THE TOOL'S OWN FRAME ONTO THE FIST'S: the handle's way to the working end along the grip axis, the tool's +X toward the
		// back of the hand (made square to the grip) -- the scraper's flat blade then faces the palm, as a putty knife's does
		const FVector Way = GripAxis.IsNearlyZero() ? FVector::UpVector : GripAxis.GetSafeNormal();
		FVector Back = BackOfHand - Way * FVector::DotProduct(BackOfHand, Way);
		if (Back.IsNearlyZero())
		{
			Back = FMath::Abs(Way.Z) < 0.9 ? FVector::CrossProduct(Way, FVector::UpVector) : FVector::CrossProduct(Way, FVector::ForwardVector);
		}
		Back = Back.GetSafeNormal();
		// the tool's handle runs along Toward; its +X is square to it: a frame (X, Y, Z) with Toward = -Z for the Dog's tools, built
		// generally so a tool with another Toward still lands right
		const FVector ToolWay = Handle.Toward.IsNearlyZero() ? FVector(0.0, 0.0, -1.0) : Handle.Toward.GetSafeNormal();
		FVector ToolBack = FVector(1.0, 0.0, 0.0) - ToolWay * ToolWay.X;
		if (ToolBack.IsNearlyZero())
		{
			ToolBack = FVector(0.0, 1.0, 0.0) - ToolWay * ToolWay.Y;
		}
		ToolBack = ToolBack.GetSafeNormal();
		const FQuat ToolFrame(FMatrix(ToolWay, ToolBack, FVector::CrossProduct(ToolWay, ToolBack), FVector::ZeroVector));
		const FQuat FistFrame(FMatrix(Way, Back, FVector::CrossProduct(Way, Back), FVector::ZeroVector));
		const FQuat Turn = (FistFrame * ToolFrame.Inverse()).GetNormalized();

		// FITTED TO THE HOLLOW: the cross-section square to the handle scaled so its half-width meets the palm's face, the length kept.
		// From 0.3: a hand of the smallest size (0.5) needs 0.36, and a floor at 0.5 left its handle too thick -- the fingers 48-70% of their
		// thickness into it and its butt in the forearm (Second's review; sim_act_grip.py over hand sizes 0.5-2.0)
		const double Fit = Handle.HalfWidth > KINDA_SMALL_NUMBER ? FMath::Clamp(HollowRadius / Handle.HalfWidth, 0.3, 1.5) : 1.0;
		const FVector Scale(
			FMath::Lerp(Fit, 1.0, FMath::Abs(ToolWay.X)),
			FMath::Lerp(Fit, 1.0, FMath::Abs(ToolWay.Y)),
			FMath::Lerp(Fit, 1.0, FMath::Abs(ToolWay.Z)));
		const FVector GripScaled = Handle.GripPoint * Scale;
		return FTransform(Turn, FistCentre - Turn.RotateVector(GripScaled), Scale);
	}
}

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

		// FITTED TO THE HOLLOW: the cross-section square to the handle scaled so its half-width meets the palm's face, the length kept
		const double Fit = Handle.HalfWidth > KINDA_SMALL_NUMBER ? FMath::Clamp(HollowRadius / Handle.HalfWidth, 0.5, 1.5) : 1.0;
		const FVector Scale(
			FMath::Lerp(Fit, 1.0, FMath::Abs(ToolWay.X)),
			FMath::Lerp(Fit, 1.0, FMath::Abs(ToolWay.Y)),
			FMath::Lerp(Fit, 1.0, FMath::Abs(ToolWay.Z)));
		const FVector GripScaled = Handle.GripPoint * Scale;
		return FTransform(Turn, FistCentre - Turn.RotateVector(GripScaled), Scale);
	}
}

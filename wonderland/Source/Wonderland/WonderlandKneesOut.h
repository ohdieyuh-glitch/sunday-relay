// THE KNEES OUT (wl.Handoff.Stance.KneesOut), one rule for Relay OG and every worn skin.
//
// A knee "out over the toes" is the thigh turned about the line from the HIP to the SOLE: the sole stays exactly where it
// was (it is on the axis) and only the knee swings sideways. The first version (53cb041d) wrote a YAW at the hip with the
// ROLL's measured outward sign. A roll's outward and a yaw's outward are different signs on this rig, so the knees turned IN
// (Second's round-5 review: left knee Y -15.6 -> -9.7, inside the foot at -19.6), the foot slid ~5.5 uu forward, and a worn
// skin, which solves its leg onto the canon's already-moved sole and then copied the yaw again, got it twice.
//
// "Outward" is MEASURED here, on the knee itself, every time: of the two turns, the one that carries the knee farther to
// its own side of the body (Y x SideSign) is taken. No sign is borrowed from another rotation.
//
// Plain C++ (inline, no reflection): the Niagara FName rule.
#pragma once

#include "CoreMinimal.h"

namespace WonderlandKneesOut
{
	/**
	 * The hip's rotation turned by Deg about the hip-to-sole line, toward the knee's own side.
	 * All in the hip pivot's PARENT frame, relative to the hip pivot itself:
	 *   KneeLocal  the knee pivot's offset in the hip's own frame (the thigh as it hangs at rest);
	 *   Knee       the knee's rotation in the hip's frame (its fold);
	 *   ShinUU     the shin's length, hanging along the knee's -Z;
	 *   SideSign   +1 for the +Y leg, -1 for the -Y leg.
	 * Returns Hip unchanged when Deg is ~0 or the leg is degenerate.
	 */
	inline FRotator TurnAboutSole(const FRotator& Hip, const FRotator& Knee, const FVector& KneeLocal, float ShinUU, float SideSign, float Deg)
	{
		if (Deg <= 0.01f || ShinUU <= 0.0f)
		{
			return Hip;
		}
		const FQuat HipQ = Hip.Quaternion();
		const FVector Sole = HipQ.RotateVector(KneeLocal + Knee.Quaternion().RotateVector(FVector(0.0, 0.0, -ShinUU)));
		const FVector Axis = Sole.GetSafeNormal();
		if (Axis.IsNearlyZero())
		{
			return Hip;
		}
		const double Radians = FMath::DegreesToRadians(static_cast<double>(Deg));
		const FQuat Plus = FQuat(Axis, Radians) * HipQ;
		const FQuat Minus = FQuat(Axis, -Radians) * HipQ;
		const double PlusOut = Plus.RotateVector(KneeLocal).Y * SideSign;
		const double MinusOut = Minus.RotateVector(KneeLocal).Y * SideSign;
		return (PlusOut >= MinusOut ? Plus : Minus).Rotator();
	}

	/** How far the knee stands OUT of the hip-to-sole line, toward its own side (uu; negative = inward). For QA. */
	inline double KneeOutOfLine(const FVector& HipAt, const FVector& KneeAt, const FVector& SoleAt, const FVector& Lateral, float SideSign)
	{
		const FVector Line = SoleAt - HipAt;
		const double Len2 = Line.SizeSquared();
		if (Len2 < 1.0)
		{
			return 0.0;
		}
		const FVector OnLine = HipAt + Line * (FVector::DotProduct(KneeAt - HipAt, Line) / Len2);
		return FVector::DotProduct(KneeAt - OnLine, Lateral.GetSafeNormal()) * SideSign;
	}
}

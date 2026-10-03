// Copyright Wonderland. THE ATTACHMENT CONTRACT. See WonderlandGrip.h.
#include "WonderlandGrip.h"

#include "Components/SceneComponent.h"
#include "HAL/IConsoleManager.h"

namespace
{
	TAutoConsoleVariable<float> CVarGripTilt(TEXT("wl.Handoff.GripTilt"), 25.0f,
		TEXT("Mission Handoff grip: degrees the held object leans from the forearm's forward toward its length."));
	TAutoConsoleVariable<float> CVarGripRoll(TEXT("wl.Handoff.GripRoll"), 0.0f,
		TEXT("Mission Handoff grip: degrees of twist about the held object's own long axis."));
	TAutoConsoleVariable<float> CVarGripInto(TEXT("wl.Handoff.GripInto"), 4.0f,
		TEXT("Mission Handoff grip: uu back from the limb's tip into the hand where the grip's centre sits."));
	TAutoConsoleVariable<float> CVarGripForward(TEXT("wl.Handoff.GripForward"), 1.5f,
		TEXT("Mission Handoff grip: uu forward of the forearm's line where the grip's centre sits."));
}

namespace WonderlandGrip
{
	FHold CurrentHold()
	{
		FHold Hold;
		Hold.TiltDeg = FMath::Clamp(CVarGripTilt.GetValueOnGameThread(), -90.0f, 90.0f);
		Hold.RollDeg = FMath::Clamp(CVarGripRoll.GetValueOnGameThread(), -180.0f, 180.0f);
		Hold.IntoHandUU = FMath::Clamp(CVarGripInto.GetValueOnGameThread(), -20.0f, 20.0f);
		Hold.ForwardUU = FMath::Clamp(CVarGripForward.GetValueOnGameThread(), -20.0f, 20.0f);
		return Hold;
	}

	FTransform HandGrip(const USceneComponent* Forearm, const FVector& TipLocal, const FVector& ForwardInForearm, float SideSign, const FHold& Hold)
	{
		if (Forearm == nullptr)
		{
			return FTransform::Identity;
		}
		// THE FOREARM'S OWN AXES: its length (shoulder side to tip), and the body's forward made square to it
		const FVector Along = TipLocal.IsNearlyZero() ? FVector(0.0, 0.0, -1.0) : TipLocal.GetSafeNormal();
		FVector Forward = ForwardInForearm - Along * FVector::DotProduct(ForwardInForearm, Along);
		Forward = Forward.IsNearlyZero() ? FVector(1.0, 0.0, 0.0) : Forward.GetSafeNormal();
		// across the fist, mirrored by the side: the pair is a mirrored pair
		const FVector Across = (FVector::CrossProduct(Along, Forward) * SideSign).GetSafeNormal();

		// THE OBJECT'S AXES: +Z out of the fist, leaning from forward toward the forearm's length by the tilt; then the twist
		const float Tilt = FMath::DegreesToRadians(Hold.TiltDeg);
		const FVector Z = (Forward * FMath::Cos(Tilt) + Along * FMath::Sin(Tilt)).GetSafeNormal();
		FVector Y = (Across - Z * FVector::DotProduct(Across, Z)).GetSafeNormal();
		if (!FMath::IsNearlyZero(Hold.RollDeg))
		{
			Y = Y.RotateAngleAxis(Hold.RollDeg, Z);
		}
		const FVector X = FVector::CrossProduct(Y, Z).GetSafeNormal();

		// THE GRIP'S CENTRE: in the fist, a little back from the limb's tip and ahead of the bone's line
		const FVector Centre = TipLocal - Along * Hold.IntoHandUU + Forward * Hold.ForwardUU;
		const FMatrix Basis(FPlane(X, 0.0f), FPlane(Y, 0.0f), FPlane(Z, 0.0f), FPlane(Centre, 1.0f));
		const FTransform Local(Basis);

		// into the world, without the rig's scale: the object carries its own
		FTransform ForearmWorld = Forearm->GetComponentTransform();
		ForearmWorld.SetScale3D(FVector::OneVector);
		const FVector WorldCentre = Forearm->GetComponentTransform().TransformPosition(Centre);
		FTransform Out = Local * ForearmWorld;
		Out.SetLocation(WorldCentre);
		Out.SetScale3D(FVector::OneVector);
		return Out;
	}
}

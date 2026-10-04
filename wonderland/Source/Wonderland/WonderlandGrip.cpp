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
	TAutoConsoleVariable<int32> CVarSwordBodyV(TEXT("wl.Handoff.SwordBodyV"), 1,
		TEXT("Mission Handoff: 1 = held blades make a V around the body (the founder's stance sheet), 0 = they follow the forearm."));
	TAutoConsoleVariable<float> CVarSwordV(TEXT("wl.Handoff.SwordV"), 122.0f,
		TEXT("Mission Handoff: degrees a held blade points from STRAIGHT UP, out to its own hand's side (under 90 up, over 90 down; the founder's 10-03 stance: 122, low and diagonal)."));
	TAutoConsoleVariable<float> CVarSwordVForward(TEXT("wl.Handoff.SwordVForward"), 10.0f,
		TEXT("Mission Handoff: degrees a held blade leans FORWARD from the V's plane."));
	TAutoConsoleVariable<float> CVarSwordDashV(TEXT("wl.Handoff.SwordDashV"), 104.0f,
		TEXT("Mission Handoff: in the fast hop and the dash, degrees a held blade points from STRAIGHT UP, out to its own side (flatter: the body is bent)."));
	TAutoConsoleVariable<float> CVarSwordChargeV(TEXT("wl.Handoff.SwordChargeV"), 122.0f,
		TEXT("Mission Handoff: in the charging stance (armed, standing), degrees a held blade points from STRAIGHT UP, out to its own side."));
	TAutoConsoleVariable<float> CVarSwordChargeVForward(TEXT("wl.Handoff.SwordChargeVForward"), -64.0f,
		TEXT("Mission Handoff: in the charging stance, degrees a held blade leans FORWARD (negative: trailing back behind the charge)."));
	TAutoConsoleVariable<float> CVarSwordDashVForward(TEXT("wl.Handoff.SwordDashVForward"), -72.0f,
		TEXT("Mission Handoff: in the sprint, degrees a held blade leans FORWARD from the V's plane (negative: the tips trail back)."));
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
		Hold.bBodyV = CVarSwordBodyV.GetValueOnGameThread() != 0;
		Hold.VDeg = FMath::Clamp(CVarSwordV.GetValueOnGameThread(), 0.0f, 170.0f);
		Hold.VForwardDeg = FMath::Clamp(CVarSwordVForward.GetValueOnGameThread(), -60.0f, 60.0f);
		Hold.DashVForwardDeg = FMath::Clamp(CVarSwordDashVForward.GetValueOnGameThread(), -80.0f, 60.0f);
		Hold.ChargeVDeg = FMath::Clamp(CVarSwordChargeV.GetValueOnGameThread(), 0.0f, 170.0f);
		Hold.DashVDeg = FMath::Clamp(CVarSwordDashV.GetValueOnGameThread(), 0.0f, 170.0f);
		Hold.ChargeVForwardDeg = FMath::Clamp(CVarSwordChargeVForward.GetValueOnGameThread(), -85.0f, 60.0f);
		return Hold;
	}

	FHold WithDash(const FHold& Hold, float DashWeight)
	{
		FHold Out = Hold;
		const float W = FMath::Clamp(DashWeight, 0.0f, 1.0f);
		Out.VForwardDeg = Hold.VForwardDeg + (Hold.DashVForwardDeg - Hold.VForwardDeg) * W;
		Out.VDeg = Hold.VDeg + (Hold.DashVDeg - Hold.VDeg) * W;
		return Out;
	}

	FHold WithCharge(const FHold& Hold, float ChargeWeight)
	{
		FHold Out = Hold;
		const float W = FMath::Clamp(ChargeWeight, 0.0f, 1.0f);
		Out.VDeg = Hold.VDeg + (Hold.ChargeVDeg - Hold.VDeg) * W;
		Out.VForwardDeg = Hold.VForwardDeg + (Hold.ChargeVForwardDeg - Hold.VForwardDeg) * W;
		return Out;
	}

	FQuat BodyVRotation(const FTransform& ActorWorld, bool bLeftHand, const FHold& Hold)
	{
		const FQuat Facing = ActorWorld.GetRotation();
		const FVector Forward = Facing.GetForwardVector();
		const FVector Up = Facing.GetUpVector();
		// THE HAND'S OWN SIDE, from the actor and never from a limb: the Dog's own left is its -Y
		const FVector Outward = Facing.GetRightVector() * (bLeftHand ? -1.0f : 1.0f);
		const float V = FMath::DegreesToRadians(Hold.VDeg);
		const float F = FMath::DegreesToRadians(Hold.VForwardDeg);
		const FVector InPlane = Up * FMath::Cos(V) + Outward * FMath::Sin(V);
		const FVector Z = (InPlane * FMath::Cos(F) + Forward * FMath::Sin(F)).GetSafeNormal();
		// the broad face to the camera behind: +X toward the Dog's back, square to the blade; +Y completes the frame as
		// HandGripLocal's does (X = Y x Z, so Y = Z x X)
		FVector X = -Forward - Z * FVector::DotProduct(-Forward, Z);
		X = X.IsNearlyZero() ? FVector::CrossProduct(Outward, Z).GetSafeNormal() : X.GetSafeNormal();
		FVector Y = FVector::CrossProduct(Z, X).GetSafeNormal();
		if (!FMath::IsNearlyZero(Hold.RollDeg))
		{
			Y = Y.RotateAngleAxis(Hold.RollDeg, Z);
			X = FVector::CrossProduct(Y, Z).GetSafeNormal();
		}
		return FMatrix(FPlane(X, 0.0f), FPlane(Y, 0.0f), FPlane(Z, 0.0f), FPlane(0.0f, 0.0f, 0.0f, 1.0f)).ToQuat();
	}

	FTransform HandGrip(const USceneComponent* Forearm, const FVector& TipLocal, const FVector& ForwardInForearm, float SideSign, const FHold& Hold)
	{
		const FVector Along = TipLocal.IsNearlyZero() ? FVector(0.0, 0.0, -1.0) : TipLocal.GetSafeNormal();
		FVector Forward = ForwardInForearm - Along * FVector::DotProduct(ForwardInForearm, Along);
		Forward = Forward.IsNearlyZero() ? FVector(1.0, 0.0, 0.0) : Forward.GetSafeNormal();
		// THE GRIP'S CENTRE with no hand to close round it: a little back from the limb's tip and ahead of the bone's line
		return HandGripAt(Forearm, TipLocal, TipLocal - Along * Hold.IntoHandUU + Forward * Hold.ForwardUU, ForwardInForearm, SideSign, Hold);
	}

	FTransform HandGripAt(const USceneComponent* Forearm, const FVector& TipLocal, const FVector& CentreLocal, const FVector& ForwardInForearm,
		float SideSign, const FHold& Hold)
	{
		if (Forearm == nullptr)
		{
			return FTransform::Identity;
		}
		const FTransform Local = HandGripLocal(TipLocal, CentreLocal, ForwardInForearm, SideSign, Hold);
		// into the world, without the rig's scale: the object carries its own
		FTransform ForearmWorld = Forearm->GetComponentTransform();
		ForearmWorld.SetScale3D(FVector::OneVector);
		FTransform Out = Local * ForearmWorld;
		Out.SetLocation(Forearm->GetComponentTransform().TransformPosition(CentreLocal));
		Out.SetScale3D(FVector::OneVector);
		return Out;
	}

	FTransform HandGripLocal(const FVector& TipLocal, const FVector& CentreLocal, const FVector& ForwardInForearm, float SideSign, const FHold& Hold)
	{
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

		const FMatrix Basis(FPlane(X, 0.0f), FPlane(Y, 0.0f), FPlane(Z, 0.0f), FPlane(CentreLocal, 1.0f));
		FTransform Local(Basis);
		Local.SetScale3D(FVector::OneVector);
		return Local;
	}
}

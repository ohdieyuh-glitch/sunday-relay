#include "RelayDogArmedStance.h"

namespace RelayDogArmedStance
{
	namespace
	{
		float Clamp01(float V) { return V < 0.0f ? 0.0f : (V > 1.0f ? 1.0f : V); }
		float Max(float A, float B) { return A > B ? A : B; }
		float Lerp(float A, float B, float T) { return A + (B - A) * T; }

		RelayDogStride::FArmPose LerpArm(const RelayDogStride::FArmPose& A, const RelayDogStride::FArmPose& B, float T)
		{
			RelayDogStride::FArmPose Out;
			Out.ShoulderDeg = Lerp(A.ShoulderDeg, B.ShoulderDeg, T);
			Out.ElbowDeg = Lerp(A.ElbowDeg, B.ElbowDeg, T);
			Out.ShoulderYawDeg = Lerp(A.ShoulderYawDeg, B.ShoulderYawDeg, T);
			return Out;
		}

		/** A spring that has all but arrived ARRIVES: at rest a weight is exactly 0 or 1, so a Dog that has given the
		 *  swords back is exactly the animator's again, not 0.0003 of a stance away from it. */
		void Settle(RelayDogStride::FSpring& Spring, float Target)
		{
			if ((Target - Spring.Value) * (Target - Spring.Value) < 1.0e-6f && Spring.Velocity * Spring.Velocity < 1.0e-4f)
			{
				Spring.Value = Target;
				Spring.Velocity = 0.0f;
			}
			Spring.Value = Clamp01(Spring.Value);
		}
	}

	void Step(FState& State, bool bArmed, bool bDashing, float DeltaSeconds, const FShape& Shape)
	{
		const float Armed = bArmed ? 1.0f : 0.0f;
		const float Dash = bArmed && bDashing ? 1.0f : 0.0f;
		RelayDogStride::SpringStep(State.Armed, Armed, Shape.ArmedSmoothSeconds, DeltaSeconds);
		RelayDogStride::SpringStep(State.Dash, Dash, Shape.DashSmoothSeconds, DeltaSeconds);
		Settle(State.Armed, Armed);
		Settle(State.Dash, Dash);
	}

	float FeetOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape)
	{
		// Spaced standing and walking; drawn in as the run's arms-back posture comes in, where the legs work fore and aft.
		return Clamp01(ArmedWeight) * Shape.FeetOutDeg * (1.0f - 0.6f * Clamp01(Pose.Stride.ArmsBack));
	}

	void Apply(RelayDogStride::FDogPose& Pose, float ArmedWeight, float DashWeight, float LegLengthUU, float ThighUU, float ShinUU,
		float LeftOutFactor, float RightOutFactor, const FShape& Shape)
	{
		const float W = Clamp01(ArmedWeight);
		const float D = Clamp01(DashWeight);
		if (W <= 0.0f && D <= 0.0f)
		{
			return;   // NORMAL ROAMING: the animator's pose, untouched
		}
		const float Back = Clamp01(Pose.Stride.ArmsBack);
		const float Gait = Clamp01(Pose.GaitWeight);

		// ---------------------------------------------------------------- the body: slightly forward, more in the dash
		Pose.LeanDeg += W * Lerp(Shape.LeanDeg, Shape.RunLeanDeg, Back) + D * Shape.DashLeanDeg;

		// ---------------------------------------------------------------- the legs: the same feet, the pelvis a little lower
		//
		// A READY KNEE. The canon leg is straight at rest, so lowering the pelvis without re-solving the legs would sink the
		// feet into the ground. Each leg is solved twice by RelayDogStride's own two-bone solve, onto the foot where the
		// animator has it, at the hip height it is riding now and at the lowered one, and only the DIFFERENCE is added:
		// the animator's own blending is kept, and at full gait weight the result is exactly the lowered solve. The run
		// already rides 26% low, so the crouch is a standing and walking thing.
		const float Drop = W * Shape.CrouchUU * (1.0f - Back);
		const float Full = ThighUU + ShinUU;
		if (Drop > 0.001f && Full > 1.0f)
		{
			float HipNow = LegLengthUU - Pose.PelvisDropUU;
			HipNow = HipNow < 0.6f * Full ? 0.6f * Full : (HipNow > Full ? Full : HipNow);
			const float HipLow = Max(HipNow - Drop, 0.6f * Full);
			auto Lower = [&](RelayDogStride::FLegPose& Leg, const RelayDogStride::FFootPose& Foot)
			{
				RelayDogStride::FFootPose At = Foot;
				At.Forward *= Gait;
				At.Lift *= Gait;
				const RelayDogStride::FLegPose Base = RelayDogStride::LegPose(At, ThighUU, ShinUU, HipNow);
				const RelayDogStride::FLegPose Low = RelayDogStride::LegPose(At, ThighUU, ShinUU, HipLow);
				Leg.HipDeg += Low.HipDeg - Base.HipDeg;
				Leg.KneeDeg += Low.KneeDeg - Base.KneeDeg;
			};
			Lower(Pose.LegLeft, Pose.FootLeft);
			Lower(Pose.LegRight, Pose.FootRight);
			Pose.PelvisDropUU += HipNow - HipLow;
		}

		// ---------------------------------------------------------------- the arms: the blades carried, never a T-pose
		auto Arm = [&](RelayDogStride::FArmPose& Pose_, float OutFactor)
		{
			// OUTWARD, ON THIS RIG: the stance's sweeps are outward amounts, turned into the writer's sign for this arm
			const float Out = OutFactor < 0.0f ? -1.0f : 1.0f;
			const RelayDogStride::FArmPose Walk = Pose_;
			// Standing and walking: raised forward and out, the forearms up, a little of the walk's swing kept.
			RelayDogStride::FArmPose Ready;
			Ready.ShoulderDeg = Shape.ReadyShoulderDeg + Walk.ShoulderDeg * Shape.SwingKeep;
			Ready.ElbowDeg = Shape.ReadyElbowDeg + Walk.ElbowDeg * Shape.SwingKeep;
			Ready.ShoulderYawDeg = Shape.ReadyOutDeg * Out;
			// Running: the animator's own arms-back posture, swept out at least this far so the blades clear the legs.
			RelayDogStride::FArmPose Run;
			Run.ShoulderDeg = Walk.ShoulderDeg;
			Run.ElbowDeg = Walk.ElbowDeg + Shape.RunElbowAddDeg;
			Run.ShoulderYawDeg = Max(Walk.ShoulderYawDeg * Out, Shape.RunOutDeg) * Out;
			RelayDogStride::FArmPose Armed = LerpArm(Ready, Run, Back);
			// The dash: swept back and out, behind a body leaning into the burst.
			RelayDogStride::FArmPose Dash;
			Dash.ShoulderDeg = Shape.DashShoulderDeg;
			Dash.ElbowDeg = Shape.DashElbowDeg;
			Dash.ShoulderYawDeg = Shape.DashOutDeg * Out;
			Armed = LerpArm(Armed, Dash, D);
			Pose_ = LerpArm(Walk, Armed, Max(W, D));
		};
		Arm(Pose.ArmLeft, LeftOutFactor);
		Arm(Pose.ArmRight, RightOutFactor);
	}
}

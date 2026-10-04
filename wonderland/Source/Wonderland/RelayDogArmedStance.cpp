#include "RelayDogArmedStance.h"

#include <cmath>

namespace RelayDogArmedStance
{
	namespace
	{
		float Clamp01(float V) { return V < 0.0f ? 0.0f : (V > 1.0f ? 1.0f : V); }
		float Max(float A, float B) { return A > B ? A : B; }
		float Lerp(float A, float B, float T) { return A + (B - A) * T; }

		constexpr float StanceDegToRad = 3.14159265358979f / 180.0f;

		/** A vector in the actor's frame (X forward, Y right, Z up), engine-free. */
		struct FStanceVec
		{
			float X = 0.0f;
			float Y = 0.0f;
			float Z = 0.0f;
		};

		/** Where a rotation, given as the rig writes it (pitch, yaw, roll in degrees), carries each unit axis: UE's own
		 *  FRotationMatrix rows, so the arithmetic here and the drawn body cannot disagree about a sign. */
		struct FStanceAxes
		{
			FStanceVec X, Y, Z;
		};

		FStanceAxes RigAxes(float PitchDeg, float YawDeg, float RollDeg)
		{
			const float SP = std::sin(PitchDeg * StanceDegToRad), CP = std::cos(PitchDeg * StanceDegToRad);
			const float SY = std::sin(YawDeg * StanceDegToRad), CY = std::cos(YawDeg * StanceDegToRad);
			const float SR = std::sin(RollDeg * StanceDegToRad), CR = std::cos(RollDeg * StanceDegToRad);
			FStanceAxes A;
			A.X = { CP * CY, CP * SY, SP };
			A.Y = { SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP };
			A.Z = { -(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP };
			return A;
		}

		FStanceVec RigRotate(const FStanceAxes& A, const FStanceVec& V)
		{
			return { V.X * A.X.X + V.Y * A.Y.X + V.Z * A.Z.X, V.X * A.X.Y + V.Y * A.Y.Y + V.Z * A.Z.Y, V.X * A.X.Z + V.Y * A.Y.Z + V.Z * A.Z.Z };
		}

		/** The inverse: a vector in the actor's frame, seen from the rotated body. */
		FStanceVec RigUnrotate(const FStanceAxes& A, const FStanceVec& W)
		{
			return { W.X * A.X.X + W.Y * A.X.Y + W.Z * A.X.Z, W.X * A.Y.X + W.Y * A.Y.Y + W.Z * A.Y.Z, W.X * A.Z.X + W.Y * A.Z.Y + W.Z * A.Z.Z };
		}

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

	float KneesOutDeg(const RelayDogStride::FDogPose& Pose, float ArmedWeight, const FShape& Shape)
	{
		// Standing and walking; gone as the run's arms-back posture comes in, where the legs work straight fore and aft.
		return Clamp01(ArmedWeight) * Shape.KneesOutDeg * (1.0f - Clamp01(Pose.Stride.ArmsBack));
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

		const float Stand = W * (1.0f - Gait);   // the charge is a standing thing: the walk's own body takes over as it comes in

		// ---------------------------------------------------------------- the animator's lean, set aside while armed
		//
		// LeanDeg is written straight into the body's pitch, and on this rig (the face is +X) a positive pitch lifts the face:
		// every "lean into the run" the animator asks for leans the Dog BACK (FStanceBody). While the blades are held the
		// stance owns the body's bend, so that lean -- and the share of it the head was given -- is taken out, not fought.
		const float Cancel = Max(W, D);
		const float Legacy = Pose.LeanDeg;
		Pose.LeanDeg -= Legacy * Cancel;
		Pose.HeadPitchDeg -= 0.55f * Legacy * Cancel;

		// ---------------------------------------------------------------- the body: bent forward about the hips, about to charge
		RelayDogStride::FDogPose::FStanceBody& Body = Pose.Stance;
		Body = RelayDogStride::FDogPose::FStanceBody();
		const float Bend = Lerp(Stand * Shape.BendDeg + W * Gait * Shape.RunBendDeg, Shape.DashBendDeg, D);
		// the front foot hangs on HipYRight's side; its hip is the free one, dropped, and that side leads
		const float FrontY = HipYRight < 0.0f ? -1.0f : 1.0f;
		Body.BendDeg = Bend;
		Body.PivotUU = HipPivotUU;
		Body.PitchDeg = -Bend;                          // the rig's signs: a negative pitch takes the chest forward
		Body.RollDeg = FrontY * Stand * Shape.TiltDeg;  // a positive roll lowers +Y
		Body.YawDeg = -FrontY * Stand * Shape.TurnDeg;  // a positive yaw takes -Y forward
		const FStanceAxes Axes = RigAxes(Body.PitchDeg, Body.YawDeg, Body.RollDeg);
		// TURNED ABOUT THE HIPS, NOT THE SOLES: the root's pivot is on the ground, so its rotation alone would swing the hips
		// forward and down with the chest -- a plank tipping over, the "whole-actor rotation" the founder refused. The root is
		// moved back by exactly what the rotation carried the hips, plus where the stance wants them: a little forward, and
		// across toward the loaded leg.
		const FStanceVec Pivot = { 0.0f, 0.0f, HipPivotUU };
		const FStanceVec Swung = RigRotate(Axes, Pivot);
		const FStanceVec Hips = { Stand * Shape.HipForwardUU, -FrontY * Stand * Shape.HipShiftUU, 0.0f };
		Body.ShiftX = Pivot.X - Swung.X + Hips.X;
		Body.ShiftY = Pivot.Y - Swung.Y + Hips.Y;
		Body.ShiftZ = Pivot.Z - Swung.Z + Hips.Z;
		// THE HEAD forward with the chest and still looking ahead: most of the bend, a share of the tilt and turn, given back.
		Body.HeadPitchDeg = Bend * Shape.HeadKeep;
		Body.HeadRollDeg = -Body.RollDeg * 0.7f;
		Body.HeadYawDeg = -Body.YawDeg * 0.5f;

		// ---------------------------------------------------------------- the legs: planted feet under a bent, lowered body
		//
		// Each leg is solved twice by RelayDogStride's own two-bone solve -- upright onto the foot where the animator has it,
		// and from the hip where the stance has put it onto where the stance wants the foot -- and only the DIFFERENCE is
		// added, so the animator's own blending is kept and at full gait weight the result is exactly the stance's solve.
		// The second solve is made IN THE BODY'S OWN FRAME: the legs are the body's children, so a bent, tilted, turned body
		// carries them with it, and only an angle measured from inside the body puts the sole back on its spot.
		const float Drop = W * Shape.CrouchUU * (1.0f - Back);
		const float Full = ThighUU + ShinUU;
		const float FeetOut = FeetOutDeg(Pose, W, Shape);
		if (Full > 1.0f)
		{
			float HipNow = LegLengthUU - Pose.PelvisDropUU;
			HipNow = HipNow < 0.6f * Full ? 0.6f * Full : (HipNow > Full ? Full : HipNow);
			const float HipLow = Max(HipNow - Drop, 0.6f * Full);
			const float Lowered = HipNow - HipLow;
			auto Solve = [&](RelayDogStride::FLegPose& Leg, const RelayDogStride::FFootPose& Foot, float HipY, float Ahead) -> float
			{
				const float Side = HipY < 0.0f ? -1.0f : 1.0f;
				RelayDogStride::FFootPose At = Foot;
				At.Forward *= Gait;
				At.Lift *= Gait;
				const RelayDogStride::FLegPose Base = RelayDogStride::LegPose(At, ThighUU, ShinUU, HipNow);
				// where this hip is, against where it rests: lowered, carried with the hips, and swung by the body about their middle
				const FStanceVec Across = RigRotate(Axes, FStanceVec{ 0.0f, HipY, 0.0f });
				const FStanceVec HipMoved = { Hips.X + Across.X, Hips.Y + Across.Y - HipY, -Lowered + Across.Z };
				// where the foot goes: the animator's place, this much ahead, swept out by the stance's spacing, on the ground
				const FStanceVec Foot3 = { At.Forward + Ahead, Side * HipNow * std::sin(FeetOut * StanceDegToRad), At.Lift - HipNow };
				const FStanceVec Reach = RigUnrotate(Axes, FStanceVec{ Foot3.X - HipMoved.X, Foot3.Y - HipMoved.Y, Foot3.Z - HipMoved.Z });
				// SOLVED, THEN CHECKED AGAINST THE WRITER'S OWN CHAIN, and the aim corrected: the writer rolls the hip AFTER its pitch
				// (FRotator(hip, 0, roll)), so a foot far forward and out (the front foot: ~76 deg of hip, ~15 of roll) lands 1.6 uu
				// off a solve that treats the two apart. Four passes put it on the spot (charge_model.py: 1.63 -> 0.00 uu).
				// The roll the writer applies is minus the lateral angle on both legs: the rig measured each leg's outward roll as
				// minus its side (WLDOG MEASURED leg L signs +1/-1/-1).
				FStanceVec Aim = Reach;
				RelayDogStride::FLegPose Bent;
				float Lateral = 0.0f;
				for (int Pass = 0; Pass <= 4; ++Pass)
				{
					RelayDogStride::FFootPose To;
					To.Forward = Aim.X;
					To.Lift = 0.0f;
					Bent = RelayDogStride::LegPose(To, ThighUU, ShinUU, std::sqrt(Aim.Y * Aim.Y + Aim.Z * Aim.Z));
					Lateral = std::atan2(Aim.Y, -Aim.Z) / StanceDegToRad;
					if (Pass == 4)
					{
						break;
					}
					const FStanceVec ShinInHip = RigRotate(RigAxes(-Bent.KneeDeg, 0.0f, 0.0f), FStanceVec{ 0.0f, 0.0f, -ShinUU });
					const FStanceVec Chain = RigRotate(RigAxes(Bent.HipDeg, 0.0f, -Lateral), FStanceVec{ ShinInHip.X, ShinInHip.Y, ShinInHip.Z - ThighUU });
					Aim = { Aim.X + Reach.X - Chain.X, Aim.Y + Reach.Y - Chain.Y, Aim.Z + Reach.Z - Chain.Z };
				}
				// THE ANIMATOR'S OWN SHARE IS ITS SOLVE x THE GAIT: standing it writes straight legs (0, 0), not the upright solve
				// (which the 0.995 reach clamp leaves ~8 deg of hip and ~12 of knee off straight), so only the gait's share of that
				// solve is taken back out -- or a standing Dog's knees came out ~12 deg short of the stance's (charge_model.py).
				Leg.HipDeg += Bent.HipDeg - Base.HipDeg * Gait;
				Leg.KneeDeg += Bent.KneeDeg - Base.KneeDeg * Gait;
				// and the sideways part, as a sweep AWAY from the centre line (the writer turns it into the rig's measured roll)
				return Lateral * Side;
			};
			// the canon's LegLeft hangs at +Y, the Dog's own RIGHT: behind, loaded; LegRight (-Y, the Dog's own LEFT): ahead
			Body.LegLeftOutDeg = Solve(Pose.LegLeft, Pose.FootLeft, HipYLeft, -Stand * Shape.RearUU);
			Body.LegRightOutDeg = Solve(Pose.LegRight, Pose.FootRight, HipYRight, Stand * Shape.FrontUU);
			Pose.PelvisDropUU += Lowered;
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
			// THE SPRINT'S ARMS PUMP (the Genshin reference): a little back and out, carrying most of the stride's own swing --
			// the SWING ITSELF, from the stride's phase: the animator's arms are locked back at a run's speed (its anime
			// posture, ArmsBack 1), and keeping a share of a locked arm only swept it further back (Second's review, 10-04).
			const RelayDogStride::FArmPose Swing = RelayDogStride::ArmPose(Pose.StridePhase, &Pose_ == &Pose.ArmLeft, Gait, 0.0f);
			RelayDogStride::FArmPose Dash;
			Dash.ShoulderDeg = Shape.DashShoulderDeg + Swing.ShoulderDeg * Shape.DashSwingKeep;
			Dash.ElbowDeg = Shape.DashElbowDeg + Swing.ElbowDeg * Shape.DashSwingKeep;
			Dash.ShoulderYawDeg = Shape.DashOutDeg * Out;
			Armed = LerpArm(Armed, Dash, D);
			Pose_ = LerpArm(Walk, Armed, Max(W, D));
		};
		Arm(Pose.ArmLeft, LeftOutFactor);
		Arm(Pose.ArmRight, RightOutFactor);
	}
}

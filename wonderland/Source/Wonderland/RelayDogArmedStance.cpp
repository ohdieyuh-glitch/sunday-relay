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
		constexpr float StancePi = 3.14159265358979f;

		float StanceFrac(float V) { return V - std::floor(V); }
		float StanceClamp(float V, float Lo, float Hi) { return V < Lo ? Lo : (V > Hi ? Hi : V); }
		float StanceSmooth(float T) { const float C = Clamp01(T); return C * C * (3.0f - 2.0f * C); }
		float StanceBand(float V, float From, float To) { return To > From ? StanceSmooth((V - From) / (To - From)) : (V >= To ? 1.0f : 0.0f); }

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

	void Step(FState& State, bool bArmed, bool bDashing, float SpeedUU, float DeltaSeconds, const FShape& Shape, float MoveForwardUU, float MoveRightUU,
		float TurnDeg, bool bJumped)
	{
		const float Armed = bArmed ? 1.0f : 0.0f;
		const float Dash = bArmed && bDashing ? 1.0f : 0.0f;
		// FAST: armed and quick (the armed run, the sprint) or dashing -- the hop. A BINARY target with hysteresis: on at FastFullUU, off
		// below FastFromUU, held in between, so no steady speed parks the body at a part weight (the spring is the only blend)
		// (and off only once the speed has stayed under FastFromUU for FastOffSeconds -- or at once under half of it, a real stop -- so a
		// stick wobbling 500 <-> 660 twice a second holds the hop instead of flipping it 4 times a second)
		if (!bArmed)
		{
			State.bFastOn = false;
			State.BelowFor = 0.0f;
		}
		else if (SpeedUU >= Shape.FastFullUU)
		{
			State.bFastOn = true;
			State.BelowFor = 0.0f;
		}
		else if (SpeedUU < Shape.FastFromUU)
		{
			State.BelowFor += DeltaSeconds > 0.0f ? DeltaSeconds : 0.0f;
			if (SpeedUU < 0.5f * Shape.FastFromUU || State.BelowFor >= Shape.FastOffSeconds)
			{
				State.bFastOn = false;
			}
		}
		else
		{
			State.BelowFor = 0.0f;
		}
		const float Fast = bArmed ? Max(State.bFastOn ? 1.0f : 0.0f, Dash) : 0.0f;
		RelayDogStride::SpringStep(State.Armed, Armed, Shape.ArmedSmoothSeconds, DeltaSeconds);
		RelayDogStride::SpringStep(State.Dash, Dash, Shape.DashSmoothSeconds, DeltaSeconds);
		RelayDogStride::SpringStep(State.Fast, Fast, Shape.FastSmoothSeconds, DeltaSeconds);
		Settle(State.Armed, Armed);
		Settle(State.Dash, Dash);
		Settle(State.Fast, Fast);
		// the hops: faster with the speed, counted only while the hop is on, and started on a landing each time it comes in
		State.HopRate = StanceClamp(Shape.HopRateBase + SpeedUU / Max(Shape.HopRatePerUU, 1.0f), Shape.HopRateMin, Shape.HopRateMax);
		State.HopSpeed = SpeedUU;
		if (State.Fast.Value > 0.001f)
		{
			// only while the Dog really moves: at a stop the phase holds and the stride shrinks to nothing (no hopping in place)
			if (SpeedUU > 0.5f * Shape.FastFromUU)
			{
				State.HopPhase += State.HopRate * (DeltaSeconds > 0.0f ? DeltaSeconds : 0.0f);
			}
		}
		else
		{
			State.HopPhase = 0.0f;
		}
		// THE FEET HELD IN THE WORLD, carried through the actor's real motion: a point fixed in the world, seen from the actor after it moved
		// (by Move, in its old frame) and turned (by TurnDeg), is p' = R(-Turn) (p - Move). A discontinuity -- a stall, a teleport, a jump --
		// drops every lock with no catch-up (the foot re-plants at its target: a catch-up across a 200 uu jump would be a slide); so does
		// the hop going off, and the QA's skating control
		FFeetLock& Feet = State.Feet;
		Feet.DeltaSeconds = DeltaSeconds > 0.0f ? DeltaSeconds : 0.0f;
		const bool bJump = bJumped || DeltaSeconds > 0.05f || MoveForwardUU * MoveForwardUU + MoveRightUU * MoveRightUU > 150.0f * 150.0f;
		const bool bOff = State.Fast.Value <= 0.001f || Shape.QaSkate > 0.0f;
		const float Turn = TurnDeg * StanceDegToRad;
		const float C = std::cos(Turn);
		const float S = std::sin(Turn);
		auto Carry = [&](float& X, float& Y)
		{
			const float DX = X - MoveForwardUU;
			const float DY = Y - MoveRightUU;
			X = C * DX + S * DY;
			Y = -S * DX + C * DY;
		};
		for (int I = 0; I < 2; ++I)
		{
			FFootLock& Foot = Feet.Foot[I];
			if (bJump || bOff)
			{
				Feet.Drops += bJump && !bOff && (Foot.bLocked || Foot.StepS < 1.0f) ? 1 : 0;
				Foot = FFootLock();
				continue;
			}
			if (Foot.bLocked)
			{
				Carry(Foot.X, Foot.Y);
			}
			if (Foot.StepS < 1.0f)
			{
				if (Foot.bFromWorld)
				{
					Carry(Foot.FromX, Foot.FromY);
				}
				Foot.StepS = Shape.CatchUpSeconds > 0.0f ? StanceClamp(Foot.StepS + Feet.DeltaSeconds / Shape.CatchUpSeconds, 0.0f, 1.0f) : 1.0f;
			}
		}
	}

	const char* StateName(const FState& State, float GaitWeight)
	{
		if (State.Armed.Value <= 0.001f && State.Dash.Value <= 0.001f)
		{
			return "unarmed";
		}
		if (State.Dash.Value > 0.5f)
		{
			return "dash";
		}
		if (State.Fast.Value > 0.5f)
		{
			return "fast hop";
		}
		if (State.Fast.Value > 0.001f)
		{
			return "into or out of the hop";
		}
		return Clamp01(GaitWeight) > 0.1f ? "moving" : (State.Armed.Value < 0.999f ? "summon / settling" : "ready");
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

	void Apply(RelayDogStride::FDogPose& Pose, float ArmedWeight, float DashWeight, float FastWeight, float HopPhase, float HopRate, float HopSpeedUU,
		float LegLengthUU, float ThighUU, float ShinUU, float LeftOutFactor, float RightOutFactor, float HipPivotUU, float HipYLeft, float HipYRight,
		const FShape& Shape, FFeetLock* Feet)
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
		const float FastW = Clamp01(FastWeight);
		// THE BEND BELONGS TO FAST MOVEMENT (founder, 10-04): upright standing and through the summon, a little at an ordinary pace, and
		// the video's charging bend only as the hop (or the dash) comes in -- and back up as it goes, eased by the weights, never snapped
		// (by the FAST weight alone -- it carries the dash, on a 0.15 s spring: the dash's own 0.07 s one bent the body ~6 deg a frame)
		const float Bend = Lerp(Stand * Shape.BendDeg + W * Gait * Shape.RunBendDeg, Shape.FastBendDeg, FastW);
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
				// ...and as the stance's own weight comes in from 0 the subtraction blends FROM the whole upright solve (Second's review of
				// 92f83bff: at weight 1e-6 the knees popped 7.7 / 12 deg on the first armed frame, and snapped straight a second after the
				// swords went back): at weight 0 the difference is exactly 0, at weight 1 it is the solve less the gait's share
				const float Upright = 1.0f - Cancel * (1.0f - Gait);
				Leg.HipDeg += Bent.HipDeg - Base.HipDeg * Upright;
				Leg.KneeDeg += Bent.KneeDeg - Base.KneeDeg * Upright;
				// and the sideways part, as a sweep AWAY from the centre line (the writer turns it into the rig's measured roll)
				return Lateral * Side;
			};
			// the canon's LegLeft hangs at +Y, the Dog's own RIGHT: behind, loaded; LegRight (-Y, the Dog's own LEFT): ahead
			Body.LegLeftOutDeg = Solve(Pose.LegLeft, Pose.FootLeft, HipYLeft, -Stand * Shape.RearUU);
			Body.LegRightOutDeg = Solve(Pose.LegRight, Pose.FootRight, HipYRight, Stand * Shape.FrontUU);
			Pose.PelvisDropUU += Lowered;

			// ------------------------------------------------------------ THE FAST HOP (founder, 10-04: "NOT normal running")
			//
			// STYLE 0, THE VIDEO (the default -- the founder: "really inspect the LAST VIDEO... the video is the MOVEMENT reference"; studied at
			// 30 fps, and Second read the same frames): a LUNGE-SKIP. The body low and bent; the REAR leg stretched far behind the whole time,
			// skimming the ground; the FRONT foot tapping about every 0.2 s -- planted ahead of the hip for exactly as long as the body takes
			// to pass over it (no slide), pushing, a short low lift, forward again. STYLE 1, the alternating bound (each foot in turn, the
			// swing tucked through), is kept for the founder's side-by-side ruling.
			// ONE speed drives it all -- the raw ground speed and the rate Step advanced the phase by (Second's review: the phase ran on the
			// raw speed while the stride used the filtered one, and the planted feet skated through every change) -- and the stride, the
			// trail and the lifts scale with the pace, so a stopping Dog's feet come home instead of hopping in place.
			if (FastW > 0.001f)
			{
				const float Speed = Max(HopSpeedUU, 0.0f);
				const float Rate = Max(HopRate, 0.5f);
				const float Pace = StanceClamp(Speed / Max(Shape.FastFromUU, 1.0f), 0.0f, 1.0f);
				const float HopLength = Max(Speed / Rate, 1.0f);
				const float Contact = StanceClamp(2.0f * Shape.HopReachUU / HopLength, 0.15f, 0.5f);
				const float Lead = 0.5f * HopLength * Contact;
				const float InHop = StanceFrac(HopPhase);
				const float Arc = Pace * (InHop < Contact ? -Shape.HopCompressUU * std::sin(StancePi * InHop / Contact)
					: Shape.HopApexUU * std::sin(StancePi * (InHop - Contact) / (1.0f - Contact)));
				const float Crouch = Shape.HopCrouchUU * Pace * FastW;
				// THE SWING MEETS THE GROUND STANDING STILL: a planted foot moves back past the hip at the ground speed, so a swing that
				// leaves and lands at that same speed (relative to the hip: -Speed, in S's units the flight's length) lifts off and touches
				// down with no skid in the world (the hop harness: a smooth swing came down at the body's own speed, 6-10 uu a touchdown)
				const float FlightSlope = -Speed * (1.0f - Contact) / Rate;
				auto Swing = [](float P0, float M0, float P1, float M1, float S)
				{
					const float S2 = S * S;
					const float S3 = S2 * S;
					return (2.0f * S3 - 3.0f * S2 + 1.0f) * P0 + (S3 - 2.0f * S2 + S) * M0 + (-2.0f * S3 + 3.0f * S2) * P1 + (S3 - S2) * M1;
				};
				const float BobNow = Lerp(Pose.BobUU, Arc, FastW);
				const float SolveShare = Clamp01(FastW / 0.08f);
				// the skip's front foot: planted, passed over, then a low quick step forward to the next tap (the QA's skating control ends the
				// contact short of -Lead, so the planted foot slides QaSkate x the ground speed in the world)
				const float ContactEnd = -Lead + 2.0f * Lead * StanceClamp(Shape.QaSkate, 0.0f, 1.0f);
				auto TapFoot = [&](float Q, float& OutForward, float& OutLift)
				{
					if (Q < Contact)
					{
						OutForward = Lead - (Lead - ContactEnd) * (Q / Contact);
						OutLift = 0.0f;
					}
					else
					{
						const float S = (Q - Contact) / (1.0f - Contact);
						OutForward = Swing(ContactEnd, FlightSlope, Lead, FlightSlope, S);
						// A TAP: up and down steeply (the root of a sine): a sine's shallow ends carried the foot ~12 uu across the ground in
						// its last frame under 2.5 uu (the Hermite is still in the world only AT the touchdown); this one lands from ~2 uu
						OutLift = Shape.HopTapLiftUU * Pace * std::sqrt(Max(std::sin(StancePi * S), 0.0f));
					}
				};
				// the alternating bound's foot over two hops (style 1): planted, pushed off and trailing, trailing under the other's landing, swung through
				auto BoundFoot = [&](float Q, float& OutForward, float& OutLift)
				{
					const float Trail = Shape.HopTrailUU * Pace;
					const float Tuck = Shape.HopTuckUU * Pace;
					if (Q < Contact)
					{
						OutForward = Lead - 2.0f * Lead * (Q / Contact);
						OutLift = 0.0f;
					}
					else if (Q < 1.0f)
					{
						// LIFTED OFF STILL IN THE WORLD (Second's port: a smoothstep left the ground at the body's own speed, 6-10 uu a frame of
						// skid at <= 1 uu up): it leaves at the planted foot's slope (half the flight's, over half the flight) and settles behind
						const float S = (Q - Contact) / (1.0f - Contact);
						OutForward = S < 0.5f ? Swing(-Lead, 0.5f * FlightSlope, -Trail, 0.0f, 2.0f * S) : -Trail;
						OutLift = Tuck * (0.25f * std::sin(StancePi * S) + 0.2f * S);
					}
					else if (Q < 1.0f + Contact)
					{
						// trailing under the other's landing, held clear of the ground (over PlantBandUU: in the air, never a dragged "down" foot)
						OutForward = -Trail;
						OutLift = Tuck * 0.2f;
					}
					else
					{
						const float S = (Q - 1.0f - Contact) / (1.0f - Contact);
						OutForward = Swing(-Trail, 0.0f, Lead, FlightSlope, S);
						OutLift = Tuck * (std::sqrt(Max(std::sin(StancePi * S), 0.0f)) + 0.2f * (1.0f - S));
					}
				};
				// each leg solved in the body's own frame onto its target, DIRECTLY: no fixed-point correction (Second's review: in a body bent
				// 40+ deg it diverged at touchdown, flicking the sole sideways), the sideways part a plain angle, never more than 20 deg
				// (FootAcross: the foot's place across, from where this hip rests)
				auto HopSolve = [&](RelayDogStride::FLegPose& Leg, float HipY, float FootForward, float FootAcross, float FootLift) -> float
				{
					const FStanceVec Across = RigRotate(Axes, FStanceVec{ 0.0f, HipY, 0.0f });
					const FStanceVec HipMoved = { Hips.X + Across.X, Hips.Y + Across.Y - HipY, -Lowered - Crouch + Across.Z + BobNow };
					const FStanceVec Foot3 = { FootForward, FootAcross, FootLift - HipNow };
					const FStanceVec Reach = RigUnrotate(Axes, FStanceVec{ Foot3.X - HipMoved.X, Foot3.Y - HipMoved.Y, Foot3.Z - HipMoved.Z });
					// THE WRITER'S ORDER, EXACTLY: it pitches the leg, then rolls it about its own forward axis, so the sideways angle is
					// asin(across / reach) and the pitch's line stays atan2(forward, down) at the whole reach. atan2(across, down) -- the
					// standing solve's -- explodes as the leg swings forward and "down" goes to nothing (the hop harness: soles flicking
					// 7-9 uu sideways a frame at a 42 deg bend, the touchdown divergence Second found)
					const float ReachLength = std::sqrt(Reach.X * Reach.X + Reach.Y * Reach.Y + Reach.Z * Reach.Z);
					const float InPlane = std::sqrt(Reach.X * Reach.X + Reach.Z * Reach.Z);
					const float Stretch = InPlane > 0.01f ? ReachLength / InPlane : 1.0f;
					const float LineForward = Reach.X * Stretch;
					const float LineDown = -Reach.Z * Stretch;
					const float Dist = StanceClamp(std::sqrt(LineForward * LineForward + LineDown * LineDown), 0.05f, Full * 0.995f);
					const float KneeInterior = std::acos(StanceClamp((ThighUU * ThighUU + ShinUU * ShinUU - Dist * Dist) / (2.0f * ThighUU * ShinUU), -1.0f, 1.0f));
					const float HipOffset = std::acos(StanceClamp((ThighUU * ThighUU + Dist * Dist - ShinUU * ShinUU) / (2.0f * ThighUU * Dist), -1.0f, 1.0f));
					RelayDogStride::FLegPose Hop;
					Hop.HipDeg = (std::atan2(LineForward, LineDown) + HipOffset) / StanceDegToRad;
					Hop.KneeDeg = (StancePi - KneeInterior) / StanceDegToRad;
					Leg.HipDeg = Lerp(Leg.HipDeg, Hop.HipDeg, SolveShare);
					Leg.KneeDeg = Lerp(Leg.KneeDeg, Hop.KneeDeg, SolveShare);
					const float SideShare = ReachLength > 0.01f ? StanceClamp(Reach.Y / ReachLength, -1.0f, 1.0f) : 0.0f;
					return StanceClamp(std::asin(SideShare) / StanceDegToRad, -20.0f, 20.0f) * (HipY < 0.0f ? -1.0f : 1.0f);
				};
				float HopForward[2] = { 0.0f, 0.0f };
				float HopLift[2] = { 0.0f, 0.0f };
				if (Shape.HopStyle == 0)
				{
					// the canon's LegRight hangs at -Y: the Dog's own LEFT, the stance's front foot -- it taps; LegLeft (+Y) trails, stretched, skimming
					TapFoot(InHop, HopForward[1], HopLift[1]);
					HopForward[0] = -Shape.HopTrailUU * Pace;
					HopLift[0] = Shape.HopSkimUU * Pace;
				}
				else
				{
					BoundFoot(std::fmod(HopPhase, 2.0f), HopForward[0], HopLift[0]);
					BoundFoot(std::fmod(HopPhase + 1.0f, 2.0f), HopForward[1], HopLift[1]);
				}
				// ONE SOLVE, ON BLENDED FEET (Second's port: blending the leg ANGLES of two solutions does not blend the feet -- at the dash start
				// they dragged 35-83 uu a frame and sank 14 uu): each foot's TARGET is the gait's foot (the animator's x the gait, plus the
				// stance's ahead, as its solve above placed it) blended to the hop's by the fast weight, held in the world while it is down, and
				// solved once. That solve takes over from the gait's own over the first 0.08 of the weight, where the two feet all but agree.
				const float GaitForward[2] = { Pose.FootLeft.Forward * Gait - Stand * Shape.RearUU, Pose.FootRight.Forward * Gait + Stand * Shape.FrontUU };
				const float GaitLift[2] = { Pose.FootLeft.Lift * Gait, Pose.FootRight.Lift * Gait };
				const float HipYs[2] = { HipYLeft, HipYRight };
				RelayDogStride::FLegPose* const Legs[2] = { &Pose.LegLeft, &Pose.LegRight };
				float* const OutDeg[2] = { &Body.LegLeftOutDeg, &Body.LegRightOutDeg };
				for (int I = 0; I < 2; ++I)
				{
					const float Side = HipYs[I] < 0.0f ? -1.0f : 1.0f;
					float FootX = Lerp(GaitForward[I], HopForward[I], FastW);
					float FootY = HipYs[I] + Side * HipNow * std::sin(FeetOut * StanceDegToRad);
					float FootZ = Lerp(GaitLift[I], HopLift[I], FastW);
					if (Feet != nullptr && Shape.QaSkate <= 0.0f)
					{
						FFootLock& Lock = Feet->Foot[I];
						const bool bDown = FootZ <= Shape.PlantBandUU;
						if (Lock.StepS < 1.0f)
						{
							if (Lock.bFromWorld)
							{
								// THE CATCH-UP STEP from a spot left still DOWN: lifted at least CatchUpLiftUU at the middle, and across the ground
								// only between 20% and 80% of it, where that lift has it over the band -- below the band it is on its world spot
								// or on its target, never between
								const float Across = StanceSmooth((Lock.StepS - 0.2f) / 0.6f);
								FootX = Lerp(Lock.FromX, FootX, Across);
								FootY = Lerp(Lock.FromY, FootY, Across);
								FootZ = Max(FootZ, Shape.CatchUpLiftUU * std::sin(StancePi * Lock.StepS));
							}
							else
							{
								// the target rose: its own swing, and the lock's last offset from it eased out in the air (lifted over the band
								// meanwhile, should the target dip back into it)
								const float Left = 1.0f - StanceSmooth(Lock.StepS);
								FootX += Lock.FromX * Left;
								FootY += Lock.FromY * Left;
								FootZ = Max(FootZ, Shape.CatchUpLiftUU * std::sin(StancePi * Lock.StepS));
							}
						}
						else if (Lock.bLocked)
						{
							const float DX = FootX - Lock.X;
							const float DY = FootY - Lock.Y;
							const bool bHeld = bDown && DX * DX + DY * DY <= Shape.PlantSlackUU * Shape.PlantSlackUU;
							if (!bHeld)
							{
								// released: ran PlantSlackUU off while still down -- a catch-up step from the spot, held in the world; or its target
								// rose out of the band -- its own swing, with the offset eased out (none at all when the two agree)
								Feet->Overstretches += bDown ? 1 : 0;
								Lock.bLocked = false;
								Lock.bFromWorld = bDown;
								Lock.FromX = bDown ? Lock.X : -DX;
								Lock.FromY = bDown ? Lock.Y : -DY;
								Lock.StepS = bDown || DX * DX + DY * DY > 0.25f ? 0.0f : 1.0f;
							}
							FootX = Lock.X;
							FootY = Lock.Y;
						}
						else if (bDown)
						{
							Lock.bLocked = true;
							Lock.X = FootX;
							Lock.Y = FootY;
						}
					}
					const float HopOut = HopSolve(*Legs[I], HipYs[I], FootX, FootY - HipYs[I], FootZ);
					*OutDeg[I] = Lerp(*OutDeg[I], HopOut, SolveShare);
				}
				Pose.BobUU = BobNow;
				Pose.PelvisDropUU += Crouch;
				// THE HOP OWNS THE BODY: the run's own sway, counter-yaw, roll and pitch wobble move the hips under a planted foot, so they go as the
				// hop comes in; the roll into a turn stays, it is steering
				Pose.SwayUU *= 1.0f - FastW;
				Pose.BodyYawDeg *= 1.0f - FastW;
				Pose.Body.RollDeg *= 1.0f - FastW;
				Pose.Body.PitchDeg *= 1.0f - FastW;
			}
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
			// (in the hop, on the HOP's rhythm: one swing of each arm over two hops)
			const RelayDogStride::FArmPose Swing = RelayDogStride::ArmPose(FastW > 0.001f ? HopPhase * 0.5f : Pose.StridePhase, &Pose_ == &Pose.ArmLeft,
				FastW > 0.001f ? 1.0f : Gait, 0.0f);
			RelayDogStride::FArmPose Dash;
			Dash.ShoulderDeg = Shape.DashShoulderDeg + Swing.ShoulderDeg * Shape.DashSwingKeep;
			Dash.ElbowDeg = Shape.DashElbowDeg + Swing.ElbowDeg * Shape.DashSwingKeep;
			Dash.ShoulderYawDeg = Shape.DashOutDeg * Out;
			Armed = LerpArm(Armed, Dash, Max(D, FastW));
			Pose_ = LerpArm(Walk, Armed, Max(W, D));
		};
		Arm(Pose.ArmLeft, LeftOutFactor);
		Arm(Pose.ArmRight, RightOutFactor);
	}
}

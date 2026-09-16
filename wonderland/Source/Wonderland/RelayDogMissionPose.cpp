#include "RelayDogMissionPose.h"

namespace RelayDogMission
{
	namespace
	{
		/** Ease a weight toward a target at a fixed rate, in seconds-to-travel-the-whole-range. */
		float Approach(float Value, float Target, float Seconds, float DeltaSeconds)
		{
			if (Seconds <= KINDA_SMALL_NUMBER)
			{
				return Target;
			}
			const float Step = DeltaSeconds / Seconds;
			return FMath::Clamp(Value + FMath::Clamp(Target - Value, -Step, Step), 0.0f, 1.0f);
		}

		/** Smoothstep, so a stage arrives and leaves without a corner in its motion. */
		float Smooth(float T)
		{
			const float X = FMath::Clamp(T, 0.0f, 1.0f);
			return X * X * (3.0f - 2.0f * X);
		}
	}

	float PageTurnProgress(const FReadingPose& Pose, float TimeSeconds)
	{
		// ABSOLUTE FROM THE CLOCK, like every other cycle here, so the hand and the page -- which both read
		// this -- can never drift apart, and a long frame cannot leave a page half over.
		const float Cycle = FMath::Frac(TimeSeconds * FMath::Max(Pose.TurnHz, 0.01f));
		const float Frac = FMath::Clamp(Pose.TurnFraction, 0.05f, 0.95f);
		return Cycle < Frac ? Cycle / Frac : -1.0f;
	}

	void ArmAnglesFor(const FWonderlandDogActReading& Reading, float& OutPitchDeg, float& OutRollDeg)
	{
		// THE TABLE SPEAKS IN THE FOUNDER'S TERMS, this rig does not. "Arms 35 degrees DOWN" is measured
		// from the horizontal, but a Relay Dog's arm hangs straight down at zero, so 35 below horizontal is
		// 55 degrees of ROLL away from hanging. ArmOutDeg then opens the limb forward of the lateral plane,
		// which is the "chest open" in the note; a negative ArmDownDeg (the painter reaching up) simply
		// carries the roll past horizontal, which is what painting above the shoulder should look like.
		OutRollDeg = 90.0f - Reading.ArmDownDeg;
		OutPitchDeg = Reading.ArmOutDeg;
	}

	void FPerformer::SetAct(EWonderlandDogAct Act, bool bContractPresent)
	{
		Reported = Act;
		EWonderlandDogAct Want = Current;
		if (Act == EWonderlandDogAct::None)
		{
			// RULE 1. A contract on the table means the mission is still running and this is an interval --
			// a handoff, a repair, a review -- so the Dog keeps performing what it was performing. No
			// contract means the mission has ended, and the performance ends with it.
			if (!bContractPresent)
			{
				Want = EWonderlandDogAct::None;
			}
		}
		else
		{
			Want = Act;
		}
		if (Want == Current)
		{
			return;
		}
		// ONE STAGE DESCENDS INTO THE NEXT. Without this, float -> read would drop the body 64 uu in a
		// single frame: both acts are "performing", so the in/out blend never moves and the lift simply
		// changes value. The spec says no hard cuts, and the seam the founder called out is exactly this
		// one. So the outgoing act is kept and the two are cross-faded.
		Previous = Current;
		Current = Want;
		Cross = 0.0f;
	}

	namespace
	{
		/** One act's contribution to the pose, before any cross-fade. Kept as a struct so two acts can be
		 *  mixed by lerping RESULTS rather than by lerping the table's numbers -- interpolating a stroke's
		 *  frequency would sweep its phase and make the brush stutter as one stage became another. */
		struct FSample
		{
			float LiftUU = 0.0f;
			float HeadPitchDeg = 0.0f;
			float HeadYawDeg = 0.0f;
			float ShoulderPitchLeftDeg = 0.0f;
			float ShoulderPitchRightDeg = 0.0f;
			float ShoulderRollDeg = 0.0f;
			/** Applied to the WORKING arm only: the repair's lateral drag, and the page-turning sweep. */
			float ShoulderRollExtraDeg = 0.0f;
			float ElbowDeg = 0.0f;
			/** The working arm's elbow only. */
			float ElbowExtraDeg = 0.0f;
			/** 1 keeps the walk's arm swing; reading holds the arms still. */
			float ArmStrideKeep = 1.0f;
			float HipDeg = 0.0f;
		};

		FSample SampleAct(const FWonderlandDogActReading& R, const FStageInput& In)
		{
			FSample S;

			// Lift and hover are one number: the body rises to FloatLiftUU and then breathes about it. An
			// act with a hover never sits still, because "never frozen" is in the founder's note.
			S.LiftUU = R.FloatLiftUU;
			if (R.HoverUU > 0.0f)
			{
				const float Period = FMath::Max(R.HoverPeriod, 0.25f);
				S.LiftUU += R.HoverUU * FMath::Sin(2.0f * PI * In.TimeSeconds / Period);
			}

			// Head tracking is the contract's, not the table's: VERIFYING says headTracksContract, and so does
			// PAINTING (founder, 2026-09-16: the Dog must not look away from the thing it is creating), while
			// reading looks down at its own pages.
			S.HeadPitchDeg = R.HeadPitchDeg;
			if ((R.bBeamsTheContract || R.Prop == EWonderlandDogProp::Paintbrush) && In.bHasContract)
			{
				S.HeadPitchDeg = FMath::Clamp(In.ContractPitchDeg, -38.0f, 38.0f);
				S.HeadYawDeg = FMath::Clamp(In.ContractYawDeg, -42.0f, 42.0f);
			}

			float Pitch = 0.0f;
			float Roll = 0.0f;
			ArmAnglesFor(R, Pitch, Roll);

			// THE WORKING MOTION. A stroke is asymmetric on purpose, big on the working arm and small on
			// the other, because a painter's off hand steadies rather than mirrors.
			float Swing = 0.0f;
			float Trail = 0.0f;
			if (R.WorkSwingDeg > 0.0f && R.WorkSwingHz > 0.0f)
			{
				Swing = R.WorkSwingDeg * FMath::Sin(2.0f * PI * R.WorkSwingHz * In.TimeSeconds);
				// The elbow follows a beat behind, which is what makes it a brush and not a pointer.
				Trail = R.WorkSwingDeg * 0.45f * FMath::Sin(2.0f * PI * R.WorkSwingHz * In.TimeSeconds - 0.9f);
			}

			// THE CORRECTIVE CYCLE (REPAIR). The brush comes back, so the stroke alone cannot separate this
			// from implementation -- a repair that merely painted would be implementation wearing another
			// label. What separates them is that a repair KEEPS STOPPING. One cycle is find, take out, put
			// back: the arm holds still over the fault, drags back across it, then paints it in again, and
			// the amplitude is scaled by where in that cycle it is rather than running steadily.
			if (R.bCorrects && R.CorrectCycleSeconds > 0.25f)
			{
				const float Phase = FMath::Frac(In.TimeSeconds / R.CorrectCycleSeconds);
				float Gain = 0.0f;
				float Drag = 0.0f;
				if (Phase < 0.26f)
				{
					Gain = 0.06f;                                  // FIND: held over the fault, barely moving
				}
				else if (Phase < 0.54f)
				{
					// TAKE OUT: a flat lateral drag across the fault rather than a stroke into it.
					const float T = (Phase - 0.26f) / 0.28f;
					Gain = 0.20f;
					Drag = FMath::Sin(PI * T) * -26.0f;
				}
				else
				{
					// PUT BACK: the stroke returns, and finishes the cycle where it began.
					const float T = (Phase - 0.54f) / 0.46f;
					Gain = FMath::Sin(PI * T);
				}
				Swing *= Gain;
				Trail *= Gain;
				S.ShoulderRollExtraDeg = Drag;
			}

			S.ShoulderPitchRightDeg = Pitch + Swing;
			S.ShoulderPitchLeftDeg = Pitch + Swing * 0.22f;
			S.ShoulderRollDeg = Roll;
			S.ElbowDeg = Trail;

			// THE PAGE TURN (PLANNING, RESEARCH). Two hands, and a pose of their own rather than the table's
			// arms-out angles: the left comes forward under the book and holds still, and the right carries a
			// page from the right-hand side to the left in step with the page itself (PageTurnProgress drives
			// both), then goes back to rest on the new right-hand page. It REPLACES the walk's arm swing.
			if (R.bTurnsPages)
			{
				const FReadingPose& P = In.Reading;
				const float Progress = PageTurnProgress(P, In.TimeSeconds);
				float Across = 0.0f;
				float Lift = 0.0f;
				if (Progress >= 0.0f)
				{
					Across = Smooth(Progress);
					Lift = FMath::Sin(PI * Progress);
				}
				else
				{
					// Back to the right-hand page over the first half of the rest.
					const float Frac = FMath::Clamp(P.TurnFraction, 0.05f, 0.95f);
					const float Rest = (FMath::Frac(In.TimeSeconds * FMath::Max(P.TurnHz, 0.01f)) - Frac) / (1.0f - Frac);
					Across = 1.0f - Smooth(Rest * 2.0f);
				}
				S.HeadPitchDeg = P.HeadPitchDeg;
				S.ShoulderPitchLeftDeg = P.HoldPitchDeg;
				S.ShoulderRollDeg = P.HoldRollDeg;
				S.ElbowDeg = P.HoldElbowDeg;
				S.ShoulderPitchRightDeg = P.TurnPitchDeg + Lift * P.SweepPitchDeg;
				S.ShoulderRollExtraDeg = (P.TurnRollDeg - P.HoldRollDeg) + Across * P.SweepRollDeg;
				S.ElbowExtraDeg = (P.TurnElbowDeg - P.HoldElbowDeg) + Lift * P.SweepElbowDeg;
				S.ArmStrideKeep = 0.0f;
			}

			// ONE WORKING ARM (founder, 2026-09-16). A brush or a lens is held in ONE hand and the other hangs at
			// the Dog's side. The table's arm angles apply to both shoulders -- the roll is shared -- so the free
			// arm was raised in a mirror of the working one and the Dog painted with both. The working (right)
			// arm now carries the whole pose through its own roll and elbow, and the free arm keeps only the walk.
			if (R.Prop == EWonderlandDogProp::Paintbrush || R.Prop == EWonderlandDogProp::MagnifyingGlass)
			{
				S.ShoulderRollExtraDeg += S.ShoulderRollDeg;
				S.ShoulderRollDeg = 0.0f;
				S.ElbowExtraDeg += S.ElbowDeg;
				S.ElbowDeg = 0.0f;
				S.ShoulderPitchLeftDeg = 0.0f;
				// THE LENS (REVIEW). The glass comes up to the eye, which is what ArmDownDeg already says at -34,
				// and the head comes down to it -- so the sweep is the LENS moving across the work rather than the
				// whole arm swinging, or it reads as waving rather than looking.
				if (R.Prop == EWonderlandDogProp::MagnifyingGlass)
				{
					S.ElbowExtraDeg *= 0.35f;
				}
			}

			// A floating Dog whose legs are still standing reads as a bug. They hang, and only while lifted.
			S.HipDeg = R.FloatLiftUU > 0.0f ? -14.0f : 0.0f;
			return S;
		}

		FSample Mix(const FSample& A, const FSample& B, float T)
		{
			FSample S;
			S.LiftUU = FMath::Lerp(A.LiftUU, B.LiftUU, T);
			S.HeadPitchDeg = FMath::Lerp(A.HeadPitchDeg, B.HeadPitchDeg, T);
			S.HeadYawDeg = FMath::Lerp(A.HeadYawDeg, B.HeadYawDeg, T);
			S.ShoulderPitchLeftDeg = FMath::Lerp(A.ShoulderPitchLeftDeg, B.ShoulderPitchLeftDeg, T);
			S.ShoulderPitchRightDeg = FMath::Lerp(A.ShoulderPitchRightDeg, B.ShoulderPitchRightDeg, T);
			S.ShoulderRollDeg = FMath::Lerp(A.ShoulderRollDeg, B.ShoulderRollDeg, T);
			S.ShoulderRollExtraDeg = FMath::Lerp(A.ShoulderRollExtraDeg, B.ShoulderRollExtraDeg, T);
			S.ElbowDeg = FMath::Lerp(A.ElbowDeg, B.ElbowDeg, T);
			S.ElbowExtraDeg = FMath::Lerp(A.ElbowExtraDeg, B.ElbowExtraDeg, T);
			S.ArmStrideKeep = FMath::Lerp(A.ArmStrideKeep, B.ArmStrideKeep, T);
			S.HipDeg = FMath::Lerp(A.HipDeg, B.HipDeg, T);
			return S;
		}
	}

	FStageOverlay FPerformer::Update(const FStageInput& In)
	{
		const bool bWant = Current != EWonderlandDogAct::None;
		Weight = Approach(Weight, bWant ? 1.0f : 0.0f, BlendSeconds, In.DeltaSeconds);
		Cross = Approach(Cross, 1.0f, BlendSeconds, In.DeltaSeconds);

		// RULE 2. The beam follows the REPORTED act, never the inherited one, so verifying -> complete puts
		// it out on the transition the spec names rather than leaving it lit through the contract's fade.
		const bool bWantBeam = Reported == EWonderlandDogAct::VerificationBeam && In.bHasContract;
		BeamWeight = Approach(BeamWeight, bWantBeam ? 1.0f : 0.0f, BlendSeconds, In.DeltaSeconds);

		FStageOverlay Out;
		Out.Weight = Smooth(Weight);
		Out.bBeam = BeamWeight > KINDA_SMALL_NUMBER;
		Out.BeamWeight = Smooth(BeamWeight);
		if (Out.Weight <= KINDA_SMALL_NUMBER && !Out.bBeam)
		{
			return Out;
		}

		const FWonderlandDogActReading& Now = WonderlandDogActReading(Current);
		const FWonderlandDogActReading& Was = WonderlandDogActReading(Previous);
		const float T = Smooth(Cross);
		const FSample S = Mix(SampleAct(Was, In), SampleAct(Now, In), T);
		const float W = Out.Weight;

		Out.LiftUU = S.LiftUU * W;
		Out.HeadPitchDeg = S.HeadPitchDeg * W;
		Out.HeadYawDeg = S.HeadYawDeg * W;
		Out.ShoulderPitchLeftDeg = S.ShoulderPitchLeftDeg * W;
		Out.ShoulderPitchRightDeg = S.ShoulderPitchRightDeg * W;
		Out.ShoulderRollDeg = S.ShoulderRollDeg * W;
		Out.ShoulderRollExtraDeg = S.ShoulderRollExtraDeg * W;
		Out.ElbowDeg = S.ElbowDeg * W;
		Out.ElbowExtraDeg = S.ElbowExtraDeg * W;
		Out.ArmStrideKeep = 1.0f - (1.0f - S.ArmStrideKeep) * W;
		Out.HipDeg = S.HipDeg * W;

		// ---------------------------------------------------------------- the facing
		// Derived from the act's own row rather than a new column: a beam is aimed at the contract, a lens
		// is held up to look at it, and a correction is made to it. All three are done AT the work, so all
		// three face it. Reading and painting do not -- they circle, and a walker faces its walk.
		// PAINTING FACES IT TOO (founder, 2026-09-16): the Dog keeps circling while it implements, but it is
		// painting the Contract, so it turns to it and walks its circle sideways rather than waving a brush
		// at the view ahead. Only reading faces its walk -- it is looking at its own book.
		Out.bFaceContract = In.bHasContract
			&& (Now.bBeamsTheContract || Now.bCorrects || Now.Prop == EWonderlandDogProp::MagnifyingGlass
				|| Now.Prop == EWonderlandDogProp::Paintbrush);

		// ---------------------------------------------------------------- the orbit
		// A REAL WALK, not a slide: this returns a bearing and the character moves along it, so the stride
		// system solves the gait and the Dog genuinely circles the contract. It yields to the player at
		// once -- locomotion is protected, and a performance that fought the stick would be a bug.
		if (Now.bOrbitsTheContract && In.bHasContract && !In.bPlayerDriving && Weight > 0.5f && T > 0.35f)
		{
			Out.bOrbit = true;
			// Tangent to the circle about the contract, with a gentle pull toward the radius it wants, so
			// the Dog closes to its ring rather than spiralling away from wherever it started.
			// 340 uu is the contract's own anchor offset (WonderlandMissionOrb FollowOffset, measured
			// 2026-09-16), so the Dog is already standing on its ring when a mission begins and walks a
			// circle rather than first swinging out to find one.
			const float Want = 340.0f;
			const float Err = FMath::Clamp((In.ContractDistanceUU - Want) / Want, -1.0f, 1.0f);
			Out.OrbitBearingDeg = In.ContractYawDeg + 90.0f - Err * 52.0f;
			// AN INSPECTION LINGERS WHERE A STUDY PACES. Review circles the contract at a third of the
			// reading pace, so the two are told apart by how the Dog moves as well as by what it holds.
			Out.OrbitPace = Now.Prop == EWonderlandDogProp::MagnifyingGlass ? 0.34f : 1.0f;
		}

		// ---------------------------------------------------------------- the prop
		// THE PROP LEAVES BEFORE THE NEXT ONE ARRIVES, which is the spec's exit/enter rather than a swap:
		// the outgoing prop fades to nothing by the middle of the cross-fade and the incoming one grows
		// out of it. The prop belongs to the act being PERFORMED, so a handoff mid-implementation keeps
		// the brush -- Current has not changed, so neither has this.
		const bool bSecondHalf = T >= 0.5f;
		Out.Prop = bSecondHalf ? Now.Prop : Was.Prop;
		Out.PropWeight = FMath::Abs(T * 2.0f - 1.0f) * W;
		const bool bReading = Out.Prop == EWonderlandDogProp::Book && (bSecondHalf ? Now.bTurnsPages : Was.bTurnsPages);
		Out.PageTurn = bReading ? PageTurnProgress(In.Reading, In.TimeSeconds) : -1.0f;
		return Out;
	}
}

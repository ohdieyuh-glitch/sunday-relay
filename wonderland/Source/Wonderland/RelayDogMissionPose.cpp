#include "RelayDogMissionPose.h"

namespace RelayDogMission
{
	namespace PoseDetail
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

		/** The lift an act holds once it has fully arrived, hover excluded. */
		float RestLift(EWonderlandDogAct Act, const FTuning& Tuning)
		{
			const FWonderlandDogActReading& R = WonderlandDogActReading(Act);
			if (R.bMeditates)
			{
				return Tuning.MeditateLiftUU;
			}
			if (R.bFlies)
			{
				return Tuning.FlyLiftUU;
			}
			return 0.0f;
		}

		/** One act's lift at a moment: the rest lift, breathing about it. */
		float LiftOf(EWonderlandDogAct Act, const FTuning& Tuning, float TimeSeconds)
		{
			const FWonderlandDogActReading& R = WonderlandDogActReading(Act);
			if (R.bMeditates)
			{
				return Tuning.MeditateLiftUU
					+ Tuning.MeditateHoverUU * FMath::Sin(2.0f * PI * TimeSeconds / FMath::Max(Tuning.MeditateHoverPeriod, 0.25f));
			}
			if (R.bFlies)
			{
				return Tuning.FlyLiftUU
					+ Tuning.FlyHoverUU * FMath::Sin(2.0f * PI * TimeSeconds / FMath::Max(Tuning.FlyHoverPeriod, 0.25f));
			}
			return 0.0f;
		}

		/** The prop an act holds at a moment: a repair changes tool with its moment, every other act holds one throughout. */
		EWonderlandDogProp PropOf(EWonderlandDogAct Act, const FRepairMoment& Repair)
		{
			const FWonderlandDogActReading& R = WonderlandDogActReading(Act);
			if (!R.bCorrects)
			{
				return R.Prop;
			}
			switch (Repair.Stage)
			{
			case ERepairStage::Identify: return EWonderlandDogProp::MagnifyingGlass;
			case ERepairStage::Erase:    return EWonderlandDogProp::Scraper;
			default: break;
			}
			return EWonderlandDogProp::Paintbrush;
		}
	}

	FRepairMoment RepairMomentAt(const FRepairTiming& Timing, float SecondsIntoAct)
	{
		const float A = FMath::Max(Timing.IdentifySeconds, 0.1f);
		const float B = FMath::Max(Timing.EraseSeconds, 0.1f);
		const float C = FMath::Max(Timing.RepaintSeconds, 0.1f);
		const float D = FMath::Max(Timing.SettleSeconds, 0.1f);
		const float Cycle = A + B + C + D;
		const float T = FMath::Fmod(FMath::Max(SecondsIntoAct, 0.0f), Cycle);
		FRepairMoment Moment;
		if (T < A)
		{
			Moment.Stage = ERepairStage::Identify;
			Moment.Progress = T / A;
		}
		else if (T < A + B)
		{
			Moment.Stage = ERepairStage::Erase;
			Moment.Progress = (T - A) / B;
		}
		else if (T < A + B + C)
		{
			Moment.Stage = ERepairStage::Repaint;
			Moment.Progress = (T - A - B) / C;
		}
		else
		{
			Moment.Stage = ERepairStage::Settle;
			Moment.Progress = (T - A - B - C) / D;
		}
		return Moment;
	}

	float PageTurnProgress(float TurnHz, float TurnFraction, float TimeSeconds)
	{
		// ABSOLUTE FROM THE CLOCK, so the hand and the page -- which both read this -- can never drift apart.
		const float Cycle = FMath::Frac(TimeSeconds * FMath::Max(TurnHz, 0.01f));
		const float Frac = FMath::Clamp(TurnFraction, 0.05f, 0.95f);
		return Cycle < Frac ? Cycle / Frac : -1.0f;
	}

	void FPerformer::SetAct(EWonderlandDogAct Act, bool bContractPresent, float TimeSeconds)
	{
		Reported = Act;
		EWonderlandDogAct Want = Current;
		if (Act == EWonderlandDogAct::None)
		{
			// A contract on the table means the mission is still running and this is an interval the world does not stage
			// (a handoff, a checkpoint), so the Dog keeps performing. No contract: the mission has ended.
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
		const FTuning Defaults;
		const float From = PoseDetail::RestLift(Current, Defaults);
		const float To = PoseDetail::RestLift(Want, Defaults);
		const FWonderlandDogActReading& WantReading = WonderlandDogActReading(Want);
		const FWonderlandDogActReading& FromReading = WonderlandDogActReading(Current);
		// A BODY THAT RISES TAKES THE TIME TO RISE. 150 uu in the old 0.45 s blend was a jump, not a flight.
		float Rise = 0.45f;
		if (WantReading.bFlies || FromReading.bFlies)
		{
			Rise = Defaults.FlyRiseSeconds;
		}
		else if (WantReading.bMeditates || FromReading.bMeditates)
		{
			Rise = Defaults.MeditateRiseSeconds;
		}
		CrossSeconds = FMath::Abs(To - From) > 1.0f ? FMath::Max(0.45f, Rise) : 0.45f;
		WeightSeconds = (Current == EWonderlandDogAct::None || Want == EWonderlandDogAct::None) && FMath::Abs(To - From) > 1.0f
			? FMath::Max(0.45f, Rise)
			: 0.45f;
		Previous = Current;
		Current = Want;
		Cross = 0.0f;
		ActStartedAt = TimeSeconds;
	}

	FStageOverlay FPerformer::Update(const FStageInput& In)
	{
		using namespace PoseDetail;
		const bool bWant = Current != EWonderlandDogAct::None;
		Weight = Approach(Weight, bWant ? 1.0f : 0.0f, WeightSeconds, In.DeltaSeconds);
		Cross = Approach(Cross, 1.0f, CrossSeconds, In.DeltaSeconds);

		// THE BEAM follows the REPORTED act, never the inherited one: it lasts exactly as long as verification does.
		const bool bWantBeam = Reported == EWonderlandDogAct::VerificationBeam && In.bHasContract;
		BeamWeight = Approach(BeamWeight, bWantBeam ? 1.0f : 0.0f, 0.6f, In.DeltaSeconds);

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
		const float W = Out.Weight;
		// Leaving a performance for nothing, the outgoing act is the one still being faded: Current is None, so read Was.
		const float NowShare = Current == EWonderlandDogAct::None ? 0.0f : T;
		const float WasShare = Current == EWonderlandDogAct::None ? 1.0f : 1.0f - T;

		auto Share = [&](bool bNow, bool bWas)
		{
			return W * ((bNow ? NowShare : 0.0f) + (bWas ? WasShare : 0.0f));
		};
		Out.Meditate = Share(Now.bMeditates, Was.bMeditates);
		Out.Read = Share(Now.bReadsTheBook, Was.bReadsTheBook);
		Out.Paint = Share(Now.bPaints, Was.bPaints);
		Out.Fly = Share(Now.bFlies, Was.bFlies);
		Out.Inspect = Share(Now.bInspects, Was.bInspects);
		Out.Correct = Share(Now.bCorrects, Was.bCorrects);

		const EWonderlandDogAct Shown = Current == EWonderlandDogAct::None ? Previous : Current;
		Out.SecondsIntoAct = FMath::Max(In.TimeSeconds - ActStartedAt, 0.0f);

		// ---------------------------------------------------------------- the lift
		Out.LiftUU = W * (NowShare * LiftOf(Current, In.Tuning, In.TimeSeconds) + WasShare * LiftOf(Previous, In.Tuning, In.TimeSeconds));

		// ---------------------------------------------------------------- the phases
		Out.PageTurn = Out.Read > KINDA_SMALL_NUMBER ? PageTurnProgress(In.Tuning.TurnHz, In.Tuning.TurnFraction, In.TimeSeconds) : -1.0f;
		Out.StrokePhase = FMath::Frac(In.TimeSeconds * FMath::Max(In.Tuning.StrokeHz, 0.01f));
		Out.SweepPhase = FMath::Frac(In.TimeSeconds * FMath::Max(In.Tuning.SweepHz, 0.01f));
		Out.ScrubPhase = FMath::Frac(In.TimeSeconds * FMath::Max(In.Tuning.ScrubHz, 0.01f));
		if (WonderlandDogActReading(Shown).bCorrects)
		{
			Out.Repair = RepairMomentAt(In.Tuning.Repair, Out.SecondsIntoAct);
		}

		// ---------------------------------------------------------------- meditation
		Out.EyesShut = Out.Meditate;
		Out.Energy = Out.Meditate;

		// ---------------------------------------------------------------- facing and the orbit
		// THE DOG FACES WHERE IT WALKS. Only a stationary act done at the work turns the body to the Contract.
		Out.bFaceContract = In.bHasContract && Now.bFacesTheContract && T > 0.2f;

		if (Now.bOrbitsTheContract && In.bHasContract && !In.bPlayerDriving && Weight > 0.5f && T > 0.35f)
		{
			Out.bOrbit = true;
			// Tangent to the circle about the contract, with a gentle pull toward its radius. The side is the act's: the
			// reader keeps the Contract on its left, the painter and the inspector on the side of the working hand, where
			// the brush and the lens can reach it.
			const float Side = (Now.OrbitSide != 0 ? static_cast<float>(Now.OrbitSide) : -In.WorkingHandSide)
				* (In.OrbitDirection < 0.0f ? -1.0f : 1.0f);
			const float Want = In.OrbitRadiusUU > 1.0f ? In.OrbitRadiusUU : 340.0f;
			const float Err = FMath::Clamp((In.ContractDistanceUU - Want) / Want, -1.0f, 1.0f);
			Out.OrbitBearingDeg = In.ContractYawDeg + Side * (90.0f - Err * 52.0f);
			Out.OrbitPace = Now.OrbitPace;
		}

		// ---------------------------------------------------------------- the prop
		// THE PROP LEAVES BEFORE THE NEXT ONE ARRIVES: the outgoing prop fades by the middle of the cross-fade and the
		// incoming one grows out of it. A REVIEW NEVER SHOWS THE BRUSH: the brush is gone by the time the lens arrives.
		const bool bSecondHalf = T >= 0.5f || Current == EWonderlandDogAct::None;
		const EWonderlandDogAct PropAct = (bSecondHalf && Current != EWonderlandDogAct::None) ? Current : Previous;
		Out.Prop = PropOf(PropAct, Out.Repair);
		Out.PropWeight = (Current == EWonderlandDogAct::None ? 1.0f : FMath::Abs(T * 2.0f - 1.0f)) * W;
		return Out;
	}
}

// MP-VIS-02 REV2 (SPECIFICATION, NOT COMPILED): what a REMOTE figure's handoff is doing, decided from the wire alone.
//
// PURE: no actor, no component, no clock of its own (the caller passes the time). It maps (the persistent form, the latest event with its age)
// to one of four modes and, for a time, to the SAME (state, phase) pair the owner's own FWonderlandMissionHandoff would be in -- built from the
// SAME phase lengths -- so the existing presentations (WonderlandHandoffSwords / WonderlandHandoffTransform) are driven unchanged.
//
// THE RULES (each is a test in TEST_PLAN_REV2.md):
//   - An event is played only when its server seq is NEW for this figure (a duplicate or an older seq is ignored: idempotent, order-proof).
//   - It starts at its AGE (Now - ageMs) PLUS the figure's own draw delay: remote figures are drawn that far in the past (wl.Remote.Interp), so the sequence is
//     drawn on the same past timeline as the figure's movement. A remote that learned of it late plays from where it should be, never from 0.
//   - An event older than its sequence + SlackSeconds is NEVER played (a late joiner, a long hitch): the figure is settled straight into the state
//     the sequence ends in. This is how a late join sees the CURRENT state without replaying an old activation.
//   - The sender can only return from HELD (FWonderlandMissionHandoff::Return), so a DEACTIVATE that finds the remote still activating first
//     finishes the activation at once (no animation), then plays the return from its own age.
//   - The persistent form is the anchor: it never starts an animation, it only settles (a missed event, a restored HELD, a new session).
#pragma once

#include "WonderlandHandoffWire.h"

namespace WonderlandHandoffRemote
{
	enum class EMode : uint8
	{
		Idle,
		Activating,
		Held,
		Returning,
	};

	enum class EAction : uint8
	{
		None,
		/** A new event began playing (from its age). */
		Play,
		/** The figure was put straight into a state without an animation (too old, or the persistent anchor). */
		Settle,
		/** The event's seq was not new. */
		IgnoredStale,
	};

	/** The owner's sequence lengths, from the owner's own constants (never copied): acknowledge, form, fly to the hands. */
	inline constexpr double ActivateSeconds = FWonderlandMissionHandoff::AcknowledgeSeconds + FWonderlandMissionHandoff::TransformSeconds + FWonderlandMissionHandoff::DeliverSeconds;
	inline constexpr double ReturnSeconds = FWonderlandMissionHandoff::ReturnSeconds;
	/** How far past its own length an event may still be played (its remaining part) before it is settled instead. */
	inline constexpr double SlackSeconds = 1.0;
	/** The armed hold eases in over this, as the owner's does (RelayDogArmedStance ArmedSmoothSeconds, 0.22). */
	inline constexpr double ArmedEaseSeconds = 0.22;

	struct FTrack
	{
		EMode Mode = EMode::Idle;
		/** Local clock (FPlatformTime::Seconds) the playing sequence began, back-dated by the event's age. */
		double StartedAt = 0.0;
		int32 LastSeq = 0;
		/** 0..1, eased toward 1 while HELD: the armed hold's weight for the blades' direction. */
		float Armed = 0.0f;
	};

	struct FPose
	{
		EWonderlandHandoffState State = EWonderlandHandoffState::Idle;
		float Phase = 0.0f;
	};

	/** The time-driven ends: an activation ends HELD, a return ends IDLE. */
	inline void TimeStep(FTrack& Track, double Now)
	{
		if (Track.Mode == EMode::Activating && Now - Track.StartedAt >= ActivateSeconds)
		{
			Track.Mode = EMode::Held;
		}
		if (Track.Mode == EMode::Returning && Now - Track.StartedAt >= ReturnSeconds)
		{
			Track.Mode = EMode::Idle;
		}
	}

	/** One view arrived for this figure. Persistent is the form the figure's player reports equipped; Event is their latest event (bValid false: none).
	 *  DrawDelaySeconds is how far in the past this figure is drawn (FRemote::AdaptDelay when interpolating, else 0). */
	inline EAction OnView(FTrack& Track, WonderlandHandoffWire::EForm Persistent, const WonderlandHandoffWire::FWireEvent& Event, double Now, double DrawDelaySeconds = 0.0)
	{
		using namespace WonderlandHandoffWire;
		EAction Did = EAction::None;
		if (Event.bValid && Event.Form == EForm::TwinSwords)
		{
			if (Event.Seq <= Track.LastSeq)
			{
				Did = EAction::IgnoredStale;
			}
			else
			{
				Track.LastSeq = Event.Seq;
				const double Age = FMath::Clamp(Event.AgeMs * 0.001, 0.0, 60.0);
				if (Event.Kind == EKind::Activate)
				{
					if (Age >= ActivateSeconds + SlackSeconds)
					{
						Track.Mode = EMode::Held;
						Did = EAction::Settle;
					}
					else
					{
						Track.Mode = EMode::Activating;
						Track.StartedAt = Now - Age + FMath::Max(DrawDelaySeconds, 0.0);
						Did = EAction::Play;
					}
				}
				else if (Event.Kind == EKind::Deactivate)
				{
					if (Track.Mode == EMode::Activating)
					{
						Track.Mode = EMode::Held;
					}
					if (Age >= ReturnSeconds + SlackSeconds)
					{
						Track.Mode = EMode::Idle;
						Did = EAction::Settle;
					}
					else
					{
						Track.Mode = EMode::Returning;
						Track.StartedAt = Now - Age + FMath::Max(DrawDelaySeconds, 0.0);
						Did = EAction::Play;
					}
				}
			}
		}
		TimeStep(Track, Now);
		// THE ANCHOR: settles, never animates
		if (Persistent == EForm::TwinSwords)
		{
			if (Track.Mode == EMode::Idle || Track.Mode == EMode::Returning)
			{
				Track.Mode = EMode::Held;
				Did = Did == EAction::None ? EAction::Settle : Did;
			}
		}
		else if (Track.Mode == EMode::Held || Track.Mode == EMode::Activating)
		{
			Track.Mode = EMode::Idle;
			Did = Did == EAction::None ? EAction::Settle : Did;
		}
		return Did;
	}

	/** Every frame: the time-driven ends, and the armed weight. */
	inline void Advance(FTrack& Track, double Now, float DeltaSeconds)
	{
		TimeStep(Track, Now);
		const float Target = Track.Mode == EMode::Held ? 1.0f : 0.0f;
		const float Step = static_cast<float>(DeltaSeconds / ArmedEaseSeconds);
		Track.Armed = Track.Armed < Target ? FMath::Min(Track.Armed + Step, Target) : FMath::Max(Track.Armed - Step, Target);
	}

	/** The (state, phase) the owner's own presentation would be in. Held and Idle have no phase. */
	inline FPose PoseAt(const FTrack& Track, double Now)
	{
		FPose Pose;
		const double T = Now - Track.StartedAt;
		switch (Track.Mode)
		{
		case EMode::Activating:
			if (T < FWonderlandMissionHandoff::AcknowledgeSeconds)
			{
				Pose.State = EWonderlandHandoffState::Acknowledged;
				Pose.Phase = static_cast<float>(FMath::Max(T, 0.0));
			}
			else if (T < FWonderlandMissionHandoff::AcknowledgeSeconds + FWonderlandMissionHandoff::TransformSeconds)
			{
				Pose.State = EWonderlandHandoffState::Transforming;
				Pose.Phase = static_cast<float>(T - FWonderlandMissionHandoff::AcknowledgeSeconds);
			}
			else
			{
				Pose.State = EWonderlandHandoffState::Delivering;
				Pose.Phase = static_cast<float>(FMath::Min(T - FWonderlandMissionHandoff::AcknowledgeSeconds - FWonderlandMissionHandoff::TransformSeconds,
					static_cast<double>(FWonderlandMissionHandoff::DeliverSeconds)));
			}
			break;
		case EMode::Held:
			Pose.State = EWonderlandHandoffState::Held;
			break;
		case EMode::Returning:
			Pose.State = EWonderlandHandoffState::Returning;
			Pose.Phase = static_cast<float>(FMath::Clamp(T, 0.0, static_cast<double>(FWonderlandMissionHandoff::ReturnSeconds)));
			break;
		default:
			break;
		}
		return Pose;
	}
}

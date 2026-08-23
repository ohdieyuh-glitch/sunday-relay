// Standing a Relay Dog up, as arithmetic.
//
// WHY THIS IS SEPARATE AND ENGINE-FREE, LIKE THE GAIT
//
// Some Relay work needs paws: implementing, reviewing, repairing, handling a
// component. A Dog that does that on all fours reads as a Dog sniffing the
// ground. So it has to rise — and the one way to get this wrong is to swap the
// pose in a single frame, which is a teleport, and the brief names it: "no
// instant pose swap".
//
// A transition is therefore a CONTINUOUS parameter, and everything about the
// pose is a function of it. That makes the whole thing arithmetic, so it is
// proven here with g++ on a laptop rather than judged from a stream: that the
// pose is continuous, that it starts exactly at the quadruped pose and ends
// exactly at the upright one, that the hind paws stay on the ground throughout,
// and that nothing moves faster at the ends than in the middle.
//
// IDENTITY IS PRESERVED BY CONSTRUCTION. This produces OFFSETS and ROTATIONS
// for the parts WonderlandDogBody already built. It cannot add a limb, change a
// proportion or substitute a humanoid — an upright Relay Dog is the canonical
// Relay Dog standing up, and there is no code path here that could make it
// anything else.
#pragma once

namespace WonderlandPose
{
	/** What a Dog is doing with its paws. The names are Relay's own, because
	 *  the world is supposed to show the real compound-agent process and a
	 *  pose vocabulary that does not match it would drift immediately. */
	enum class EWork : int
	{
		None = 0,        // quadruped, no work
		Meditating,      // beside the Avatar, low and still — incubation
		Channelling,     // both paws raised toward it — building
		Placing,         // one paw forward, holding a component
		Inspecting,      // upright, head tilted, turning it over
		Repairing,       // upright, paws working at a fault
		Approving,       // a single decisive raised paw
	};

	const char* WorkName(EWork Work);

	/** How upright a work state wants the Dog: 0 stays on all fours,
	 *  1 is fully standing. Meditating is deliberately LOW. */
	float UprightTargetFor(EWork Work);

	/** Ease a blend toward its target without overshoot, frame-rate
	 *  independently. Returns the new blend.
	 *
	 *  Exponential rather than linear so the rise starts and ends softly; and
	 *  expressed via a half-life so the same call behaves identically at 20 fps
	 *  and 60, which a naive `Blend += Rate * Dt` does not. */
	float ApproachBlend(float Current, float Target, float DeltaSeconds,
	                    float HalfLifeSeconds = 0.22f);

	/** Where every animated part sits at a given uprightness.
	 *
	 *  All offsets are ADDED to the part's canonical rest position, in Unreal
	 *  units at the Dog's own scale; all angles are degrees. Zero everywhere at
	 *  Blend 0, which is what makes "quadruped" the exact canonical pose rather
	 *  than an approximation of it. */
	struct FUprightPose
	{
		/** Torso rise and its pitch back onto the haunches. */
		float TorsoRise = 0.0f;
		float TorsoPitchDeg = 0.0f;
		/** The head stays level as the body pitches — a standing animal does
		 *  not look at the sky. */
		float HeadPitchDeg = 0.0f;
		float HeadRise = 0.0f;
		/** Forelegs leave the ground and fold in; hind legs take the weight and
		 *  spread slightly for balance. Index order matches the gait:
		 *  0 LH, 1 RH, 2 LF, 3 RF. */
		float LegRise[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
		float LegPitchDeg[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
		float LegSpread[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
		/** Tail counterbalances backwards as the chest comes up. */
		float TailPitchDeg = 0.0f;
		/** Length multiplier for the HIND legs while rearing.
		 *
		 *  A planted hind leg is rigid and its paw does not move, so if the hip
		 *  rises the leg has to span further — exactly the problem LegSwing
		 *  solves for the gait, and it was missed here. The first version raised
		 *  the torso 0.62 of a leg while the hind legs stayed at rest length,
		 *  which detaches the body from its own legs by 52% of a leg. Found by
		 *  drawing it: the strip put the body visibly above its own haunches. */
		float HindStretch = 1.0f;
	};

	/**
	 * @param Blend      0 quadruped .. 1 upright.
	 * @param LegLength  hip-to-paw at rest, uu — everything scales off it so a
	 *                   Dog of any size stands up by the same proportions.
	 * @param WorkPhase  0..1, cycles while working. Drives the small motions
	 *                   that make a held pose look alive rather than frozen.
	 * @param Work       which work state, which decides what the paws do.
	 */
	FUprightPose UprightPose(float Blend, float LegLength, float WorkPhase, EWork Work);
}

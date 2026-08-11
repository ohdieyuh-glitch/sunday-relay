// WONDERLAND — the Relay Dog's animation resolver.
//
// This table is compared clip-for-clip against WONDERLAND_MOTION_ANIMATION in
// src/relay/mission/wonderland/wonderland-contracts.ts. Change one, change both,
// and let wonderland-cpp-parity.test.ts prove it: an earlier repository lesson is
// that a hand-written mirror table changed on one side and nothing caught it.

#include "WonderlandDogAnimation.h"
#include "RelayWorldState.h"

EWonderlandDogAnimation WonderlandAnimationForMotion(EWonderlandDogMotion Motion)
{
	// UNOBSERVED IS NOT IDLE. Relay saying nothing about the Agent's activity is
	// not the Agent idling, so the absence of a motion resolves to Dormant and
	// never to PatrolWalk. This branch is checked separately by the parity test
	// because it is the one that carries the whole rule.
	if (Motion == EWonderlandDogMotion::Unobserved)
	{
		return EWonderlandDogAnimation::Dormant;
	}

	switch (Motion)
	{
	case EWonderlandDogMotion::Patrol:
		return EWonderlandDogAnimation::PatrolWalk;
	case EWonderlandDogMotion::Still:
		return EWonderlandDogAnimation::StandStill;
	case EWonderlandDogMotion::AttentionJump:
		return EWonderlandDogAnimation::AttentionJump;
	case EWonderlandDogMotion::WorkScratch:
		return EWonderlandDogAnimation::WorkScratch;
	case EWonderlandDogMotion::Scan:
		return EWonderlandDogAnimation::ScanSniff;
	case EWonderlandDogMotion::Carry:
		return EWonderlandDogAnimation::CarryWalk;
	case EWonderlandDogMotion::Halt:
		return EWonderlandDogAnimation::HaltSlump;
	case EWonderlandDogMotion::Sleep:
		return EWonderlandDogAnimation::SleepCurl;
	case EWonderlandDogMotion::Dig:
		return EWonderlandDogAnimation::DigForward;
	case EWonderlandDogMotion::CodeProgression:
		return EWonderlandDogAnimation::CodeType;
	default:
		// Reached only if a motion is added to the enum without a clip. Dormant
		// rather than a guess: a new Relay state whose animation nobody chose is
		// an unobserved state as far as this rig is concerned.
		return EWonderlandDogAnimation::Dormant;
	}
}

bool WonderlandOverlayIsAdditive()
{
	return true;
}

EWonderlandDogOverlay WonderlandOverlayForLoops(const TArray<FWonderlandLoopSignal>& Loops)
{
	for (const FWonderlandLoopSignal& Loop : Loops)
	{
		// bExecuting is Relay's own isActiveLoopState. A Loop blocked on
		// approval or budget is making no progress and must not be animated as
		// though it were.
		if (Loop.bExecuting)
		{
			return EWonderlandDogOverlay::LoopMeditationHover;
		}
	}
	return EWonderlandDogOverlay::None;
}

FWonderlandBreath WonderlandBreathAt(float ElapsedSeconds)
{
	FWonderlandBreath Breath;

	// A negative, infinite or NaN elapsed time is not a time. Rest, do not
	// assert: a renderer handed a bad clock should show a still Dog rather than
	// take the world down. `FMath::IsFinite` catches both infinity and NaN.
	const float Usable = (FMath::IsFinite(ElapsedSeconds) && ElapsedSeconds > 0.0f) ? ElapsedSeconds : 0.0f;

	const float Cycles = Usable / WonderlandBreathPeriodSeconds;
	// `Fmod` rather than a subtraction, so a long-running session does not lose
	// precision and drift out of phase after a few hours.
	const float WithinCycle = FMath::Fmod(Cycles, 1.0f);

	// (1 - cos)/2, not a raw sine: the curve runs rest -> inhale -> rest, so the
	// exhale returns the Dog to its own size instead of taking it below. A sine
	// would make it smaller than itself for half of every cycle, which reads as
	// deflating rather than breathing.
	const float Eased = (1.0f - FMath::Cos(2.0f * PI * WithinCycle)) * 0.5f;

	Breath.UniformScale = 1.0f + WonderlandBreathScaleAmplitude * Eased;
	Breath.Phase = Eased;
	return Breath;
}

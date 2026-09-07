// WONDERLAND — JULIUS'S STATE, RESOLVED TO A CLIP.
//
// The world receives an FWonderlandJuliusEmbodiment with Activity, Motion and
// Animation already filled in by Relay. These resolvers exist for the other
// case: a Blueprint, an editor preview or a test that holds only the STATE and
// needs the rest without asking the Bridge.
//
// EVERY TABLE HERE IS MIRRORED, NOT INVENTED. Each switch is compared, case by
// case, against the TypeScript map it mirrors by
// wonderland-cpp-parity.test.ts — the same treatment WonderlandDogAnimation.cpp
// already gets. A second opinion about which clip a state plays is exactly how
// the 3D dog and the 2D dog end up showing different behaviour for the same
// Relay state, and there is no reason for the world to hold one.
//
// NO TIME, NO RANDOMNESS, NO HEURISTIC. Every function below is a pure switch
// on its argument. The clip is chosen by Relay's state and never by a timer, a
// counter or a "looks busy" guess; the breath is the only time-driven layer in
// this module and it deliberately carries no information.

#include "WonderlandJuliusState.h"

EWonderlandDogActivity WonderlandActivityForJuliusState(EWonderlandJuliusState State)
{
	// Unobserved is answered BEFORE the switch, so the absence of an observation
	// has its own branch and its own test. It is not idle: idle is a state Relay
	// observed, and rendering absence as idle is the substitution the whole
	// contract exists to forbid.
	if (State == EWonderlandJuliusState::Unobserved)
	{
		return EWonderlandDogActivity::Unobserved;
	}

	switch (State)
	{
	case EWonderlandJuliusState::Idle:              return EWonderlandDogActivity::Idle;
	case EWonderlandJuliusState::Attention:         return EWonderlandDogActivity::Thinking;
	case EWonderlandJuliusState::PromptArchitect:   return EWonderlandDogActivity::Researching;
	case EWonderlandJuliusState::Coding:            return EWonderlandDogActivity::Implementing;
	case EWonderlandJuliusState::Handoff:           return EWonderlandDogActivity::Handoff;
	case EWonderlandJuliusState::IndependentReview: return EWonderlandDogActivity::Reviewing;
	case EWonderlandJuliusState::Repair:            return EWonderlandDogActivity::Repairing;
	case EWonderlandJuliusState::Verifying:         return EWonderlandDogActivity::Verifying;
	case EWonderlandJuliusState::Complete:          return EWonderlandDogActivity::Complete;
	// A blocked mission needs a human. WaitingForUser is the one activity that
	// asks for attention without claiming a fault, which is why a budget ceiling
	// does not animate as an error.
	case EWonderlandJuliusState::Blocked:           return EWonderlandDogActivity::WaitingForUser;
	case EWonderlandJuliusState::Error:             return EWonderlandDogActivity::Error;
	default:                                        return EWonderlandDogActivity::Unobserved;
	}
}

EWonderlandDogMotion WonderlandMotionForActivity(EWonderlandDogActivity Activity)
{
	if (Activity == EWonderlandDogActivity::Unobserved)
	{
		return EWonderlandDogMotion::Unobserved;
	}

	switch (Activity)
	{
	case EWonderlandDogActivity::Idle:           return EWonderlandDogMotion::Patrol;
	case EWonderlandDogActivity::Thinking:       return EWonderlandDogMotion::Still;
	case EWonderlandDogActivity::WaitingForUser: return EWonderlandDogMotion::AttentionJump;
	case EWonderlandDogActivity::Researching:    return EWonderlandDogMotion::Scan;
	case EWonderlandDogActivity::Implementing:   return EWonderlandDogMotion::CodeProgression;
	case EWonderlandDogActivity::Handoff:        return EWonderlandDogMotion::Carry;
	case EWonderlandDogActivity::Verifying:      return EWonderlandDogMotion::Still;
	case EWonderlandDogActivity::Reviewing:      return EWonderlandDogMotion::Sleep;
	case EWonderlandDogActivity::Repairing:      return EWonderlandDogMotion::Dig;
	case EWonderlandDogActivity::Complete:       return EWonderlandDogMotion::Still;
	case EWonderlandDogActivity::Error:          return EWonderlandDogMotion::Halt;
	default:                                     return EWonderlandDogMotion::Unobserved;
	}
}

EWonderlandDogAnimation WonderlandAnimationForJuliusState(EWonderlandJuliusState State)
{
	// COMPOSED, never a fourth table. A direct state-to-clip map would be a
	// place for the chain to disagree with itself, and the parity test would
	// then have two things to hold against each other instead of one.
	return WonderlandAnimationForMotion(
		WonderlandMotionForActivity(WonderlandActivityForJuliusState(State)));
}

bool WonderlandJuliusStateAsksForAHuman(EWonderlandJuliusState State)
{
	// The two states, and only the two, whose behaviour sets attentionRequired.
	// Stated as its own function rather than as a comparison at each call site,
	// because "does this need me" is the question a HUD asks most often and the
	// answer must not be re-derived by whoever is asking.
	return State == EWonderlandJuliusState::Blocked || State == EWonderlandJuliusState::Error;
}

// WONDERLAND — DETERMINISTIC MISSIONS, WITH NO PROVIDER ANYWHERE NEAR THEM.
//
// A fixture is an ordered list of Julius-shaped events and nothing else. No model is called, no key is
// read, no network is touched, and no paid provider exists in this file or anywhere it reaches. The same
// fixture always produces the same beats, the same chakra sequence and the same ending, which is what
// makes it a proof rather than a demo.
//
// WHAT EACH ONE IS FOR:
//
//   FullLifecycle  a whole task: contract, research, architect, coding, a checkpoint, review, a REPAIR
//                  that sends the work back, a re-review, verification, and a verified completion at
//                  violet. The one fixture that exercises the regression the founder asked to see.
//
//   Blocked        a task stopped by a reviewer's block, FOLLOWED BY EVENTS THAT WOULD HAVE ADVANCED IT.
//                  They are refused, and the refusals are counted. A blocked mission that kept animating
//                  forward would be the world telling a more comfortable story than the run's.
//
//   TwoMissions    one mission to violet, then a second. Proves the second starts at red with nothing
//                  carried over -- and that a REPAIR does not do that, which is a different thing.
//
//   Crossed        two missions interleaved on one stream. Proves an event for one cannot move the other.
//
// THE THREE SIMULATED BEATS ARE LABELLED. Handoff, approval and the return to idle have no Julius event
// (WonderlandMissionBeat.cpp says why, per beat). A fixture may still show them, because a person watching
// plainly sees those moments -- but each such event carries bSimulationOnly, the fold counts them
// separately, and a fixture's report says how many it needed. That number is the honest measure of how far
// Wonderland currently runs ahead of the kernel.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionEvent.h"

/** One deterministic mission, as a stream. */
struct FWonderlandMissionFixture
{
	FName Id;
	const TCHAR* Title = TEXT("");
	const TCHAR* Purpose = TEXT("");
	TArray<FWonderlandMissionEvent> Events;
};

/** How many fixtures this build carries. */
WONDERLAND_API int32 WonderlandMissionFixtureCount();

/** A fixture by index, 0..Count-1. */
WONDERLAND_API const FWonderlandMissionFixture& WonderlandMissionFixtureAt(int32 Index);

/** A fixture by id, e.g. "full_lifecycle". Null when nothing matches. */
WONDERLAND_API const FWonderlandMissionFixture* WonderlandMissionFixture(FName Id);

/**
 * Replay a whole fixture into a fresh fold and report what happened, without drawing anything.
 *
 * THE ARITHMETIC PROOF LIVES HERE, deliberately separate from the world: the beat sequence and the chakra
 * sequence are properties of the event stream and the tables, and can be checked with no actor, no PIE and
 * no camera. A renderer bug cannot make this pass, and a table mistake cannot hide behind one.
 */
WONDERLAND_API void WonderlandReplayFixture(
	const FWonderlandMissionFixture& Fixture,
	FWonderlandMissionFold& OutFold,
	TArray<EWonderlandMissionBeat>* OutBeats = nullptr,
	TArray<int32>* OutChakraSteps = nullptr,
	TArray<EWonderlandEventVerdict>* OutVerdicts = nullptr);

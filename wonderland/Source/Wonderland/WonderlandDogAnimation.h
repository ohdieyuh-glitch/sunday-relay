// WONDERLAND — the Relay Dog's animation resolver and identity constants.
//
// THE ANIMATION STATE IS DRIVEN BY RELAY, NOT BY A TIMER.
//
// `WonderlandAnimationForMotion` is a pure function of the motion Relay
// observed, and it is the ONLY way this module chooses a clip. CLIP SELECTION
// has no elapsed-time input, no random source, no token-rate input and no
// "looks busy" heuristic, because the identity documents are explicit that speed
// is never tied to a token stream and that the animation receives the state and
// never decides it.
//
// `WonderlandBreathAt` below IS time-driven, and that is not an exception to the
// rule above — it is a different layer. It selects no clip, reads no state, and
// carries no information. See its own comment; the distinction is the whole
// reason it is safe.
//
// Its case table is compared against the TypeScript table
// `WONDERLAND_MOTION_ANIMATION` by wonderland-cpp-parity.test.ts — not just for
// coverage but for the actual returned clip, so the 3D dog and the 2D sprite
// cannot show different behaviour for the same Relay state.
//
// The overlay is separate on purpose. A meditation hover while a Loop executes
// is ADDITIVE: `WonderlandOverlayIsAdditive` documents and asserts that the
// overlay never selects the clip, because replacing the clip would give
// Wonderland a silhouette the website never shows.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandTypes.h"
#include "WonderlandDogAnimation.generated.h"

// The canonical identity constants, read back so a renderer can size the rig
// without inventing numbers.
//
// These MIRROR the shared sprite module rather than being authored here, and the
// mirror is checked: wonderland-cpp-parity.test.ts compares the GridWidth and
// GridHeight INITIALIZERS below against OFFICIAL_RELAY_DOG_WIDTH and
// OFFICIAL_RELAY_DOG_HEIGHT. The same values also arrive on FWonderlandDogSkin
// with every snapshot, so a rig built against a stale grid disagrees with the
// data it is handed at runtime as well as failing that test.
//
// ONE UNIFORM SCALE FACTOR DRIVES BOTH AXES. Independent width and height
// scaling is prohibited — it distorts the body — which is why there is a single
// UniformScale field and not an FVector.
USTRUCT(BlueprintType)
struct FWonderlandDogProportions
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	int32 GridWidth = 18;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	int32 GridHeight = 14;

	// Rows 0-5 head, 6-10 body, 11-13 legs. The Dog is a compact front-facing
	// voxel companion with short block legs and short limbs, and these bands are
	// what keep a 3D rig from stretching it into a humanoid.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	int32 HeadRowCount = 6;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	int32 BodyRowCount = 5;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	int32 LegRowCount = 3;

	// Four paws, never three. A side-view quadruped needs a far-side pair for a
	// four-beat gait; with three columns one column does two jobs, which is the
	// synchronised-leg look the design forbids.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	int32 LegCount = 4;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	bool bUniformScaleOnly = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Dog")
	float UniformScale = 1.0f;
};

// THE BREATH — a third layer, and deliberately information-free.
//
// The founder asked for the Relay Dogs to move "like it's breathing in and out".
// Three layers, and only the first two say anything:
//
//   1. the CLIP     chosen by Relay state, never by a timer
//   2. the OVERLAY  additive, e.g. a meditation hover while a Loop executes
//   3. the BREATH   ambient, continuous, and carrying NOTHING
//
// A breath that quickened while a mission was busy would be a second status
// channel, and an untruthful one: a viewer could not tell whether a fast breath
// meant "Relay is working" or "the animation is simply fast". So the period and
// amplitude are constants and `WonderlandBreathAt` takes ELAPSED SECONDS AND
// NOTHING ELSE. There is no state parameter and there must never be one — that
// absence is the guarantee, where a comment promising it would not be.
//
// It swells UNIFORMLY and only uniformly. FWonderlandDogProportions prohibits
// independent width/height scaling because it distorts the body into a humanoid;
// scaling the height alone to fake a chest would break the identity the founder's
// reference image confirms. A vertical rise was drafted and removed: the pawn
// does not know its own grid-unit-to-world size, and inventing a constant to
// convert one would have been a fabricated number in an identity contract.
//
// The initializers below are compared against the TypeScript WONDERLAND_BREATH
// by wonderland-cpp-parity.test.ts, so the 3D Dog and the 2D sprite cannot
// breathe at different rates.
USTRUCT(BlueprintType)
struct FWonderlandBreath
{
	GENERATED_BODY()

	// Multiply the Dog's uniform scale by this. Never below 1: the exhale
	// returns to rest and never shrinks the Dog below its own size, which would
	// read as deflating.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	float UniformScale = 1.0f;

	// 0 at rest, 1 at full inhale. Exposed so a renderer can drive a highlight
	// from the same curve rather than computing a second one.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Dog")
	float Phase = 0.0f;
};

// One full inhale and exhale, in seconds. A calm resting rate, not an exerted
// one — the Dog is alive, not running.
WONDERLAND_API constexpr float WonderlandBreathPeriodSeconds = 4.0f;

// Peak uniform swell. 1.5% reads as alive; more reads as a pulse effect.
WONDERLAND_API constexpr float WonderlandBreathScaleAmplitude = 0.015f;

// The breath at an instant. A negative, infinite or NaN elapsed time is not a
// time and resolves to REST rather than asserting: a renderer handed a bad clock
// should show a still Dog, not take the world down.
WONDERLAND_API FWonderlandBreath WonderlandBreathAt(float ElapsedSeconds);

WONDERLAND_API EWonderlandDogAnimation WonderlandAnimationForMotion(EWonderlandDogMotion Motion);

// True always. Present as a named, testable statement rather than a comment:
// the overlay is a layer, and nothing may route it into clip selection.
WONDERLAND_API bool WonderlandOverlayIsAdditive();

// The overlay for the loops in a snapshot. Reads FWonderlandLoopSignal::bExecuting
// — Relay's own isActiveLoopState, which excludes every wait state — so a Loop
// blocked on approval does not put the Dog into meditation.
struct FWonderlandLoopSignal;
WONDERLAND_API EWonderlandDogOverlay WonderlandOverlayForLoops(
	const TArray<FWonderlandLoopSignal>& Loops);

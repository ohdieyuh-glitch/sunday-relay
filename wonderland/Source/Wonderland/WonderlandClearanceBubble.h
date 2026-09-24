// WONDERLAND — THE PRE-MISSION SPATIAL CLEARANCE BUBBLE.
//
// FOUNDER DIRECTIVE (2026-09-22): "user executes Mission Contract -> 1-2 second clearance bubble/probe -> evaluate
// animation/staging envelope -> choose safe staging position -> begin cutscene", checking the Relay Dog motion
// envelope, vertical and horizontal clearance, Mission Contract manifestation, companion/sub-agent spawn space,
// camera visibility and nearby geometry. "If there is insufficient room: find a nearby safe position. If no
// appropriate position exists: use a compact/fallback mission presentation."
//
// AND THE RULE THAT DECIDES EVERY TRADE-OFF HERE: "MISSION EXECUTION MUST NEVER FAIL because the physical
// presentation area is cramped." So this probe has no failure mode. It answers FULL, COMPACT or COMPACT-IN-PLACE;
// it never answers "no". A mission in a stone corridor is presented differently from a mission in a plaza, and it is
// presented.
//
// WHY A PROBE AND NOT A LEVEL ANNOTATION. Wonderland's sites are built by another lane and go on changing; a list of
// approved staging spots would be a second description of the world that drifts from the world. Tracing the actual
// geometry at the moment the mission starts is the only answer that cannot be stale -- and it is cheap, because it
// happens once per mission rather than per frame.
//
// PURE WHERE IT CAN BE. Scoring a candidate is arithmetic over measured clearances and is tested as such; only the
// measuring touches the world. A probe that could not be reasoned about without an editor would be a probe nobody
// could check.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandClearanceBubble.generated.h"

/**
 * HOW MUCH ROOM A MISSION PRESENTATION NEEDS, in uu, measured from the staging point.
 *
 * These are the founder's list, one field each, so a reader can see that nothing on it was quietly dropped.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandStagingEnvelope
{
	GENERATED_BODY()

	/** The Relay Dog's own motion envelope: the radius it moves through around the Contract. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float DogEnvelopeRadiusUU = 345.0f;

	/** Vertical room the Dog needs, including the lift of the sub-agent ascension. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float VerticalUU = 430.0f;

	/** Where the Mission Contract manifests, and how tall it stands. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float ContractRadiusUU = 190.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float ContractHeightUU = 280.0f;

	/** The dome the sub-agent cubs and the companions occupy above the Dog. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float SpawnDomeRadiusUU = 220.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float SpawnDomeHeightUU = 330.0f;

	/** Where the camera must be able to stand, and see the Contract from. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float CameraDistanceUU = 540.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float CameraHeightUU = 300.0f;
};

/** The full presentation, and the one that fits in a garden arch. */
WONDERLAND_API const FWonderlandStagingEnvelope& WonderlandFullEnvelope();
WONDERLAND_API const FWonderlandStagingEnvelope& WonderlandCompactEnvelope();

/** What the probe decided the mission gets. Never a refusal. */
UENUM(BlueprintType)
enum class EWonderlandStagingFit : uint8
{
	/** The whole presentation, at the place the probe chose. */
	Full,
	/** The compact presentation, at the place the probe chose: room for a smaller staging but not the full one. */
	Compact,
	/**
	 * The compact presentation, where the player already is, because nothing nearby was better.
	 *
	 * STILL A RESULT, NOT A FAILURE. The mission runs. It is named apart from Compact only so a report can say that
	 * the probe searched and found nothing rather than that it found somewhere tight.
	 */
	CompactInPlace
};

WONDERLAND_API const TCHAR* WonderlandStagingFitName(EWonderlandStagingFit Fit);

/** One candidate, measured. */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandStagingCandidate
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	FVector Location = FVector::ZeroVector;

	/** The largest radius clear of geometry around this point, up to the envelope's own. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float ClearRadiusUU = 0.0f;

	/** The headroom above it. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float ClearHeightUU = 0.0f;

	/** Whether a camera at the envelope's distance can see the staging point. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	bool bCameraClear = false;

	/** How far the player would be moved to use it. Nearer is better, all else equal. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	float MoveUU = 0.0f;
};

/**
 * SCORE A CANDIDATE AGAINST AN ENVELOPE. Higher is better; a negative score means it does not fit at all.
 *
 * PURE ARITHMETIC over measured clearances, so the policy -- how much a blocked camera costs, how much being made to
 * walk costs -- can be argued about and tested without an engine. Radius and headroom are what the presentation
 * actually needs, so they dominate; the camera is worth a great deal because a cinematic nobody can see is not one;
 * and distance is a tie-breaker rather than a factor, because a slightly further spot that works beats a near one
 * that does not.
 */
WONDERLAND_API float WonderlandScoreStaging(const FWonderlandStagingCandidate& Candidate, const FWonderlandStagingEnvelope& Envelope);

/** Whether a candidate clears an envelope outright. */
WONDERLAND_API bool WonderlandStagingFits(const FWonderlandStagingCandidate& Candidate, const FWonderlandStagingEnvelope& Envelope);

/** Everything the probe decided, and why. */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandStagingResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	EWonderlandStagingFit Fit = EWonderlandStagingFit::CompactInPlace;

	/** Where the presentation should be staged. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	FVector Location = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	FWonderlandStagingCandidate Chosen;

	/** How many places were measured before this one was picked. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	int32 CandidatesTried = 0;

	/** In words, for the terminal and for a report. Never a stack trace; always what a person would want to know. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Staging")
	TArray<FString> Notes;
};

class UWorld;

/**
 * MEASURE ONE PLACE. Traces the world; everything else in this file is arithmetic over what this returns.
 *
 * `Ignore` keeps the player's own pawn and the mission's own actors out of their own measurement -- a Dog standing at
 * the staging point is not an obstruction at the staging point.
 */
WONDERLAND_API FWonderlandStagingCandidate WonderlandMeasureStaging(
	const UWorld* World, const FVector& At, const FVector& CameraDirection,
	const FWonderlandStagingEnvelope& Envelope, const TArray<const AActor*>& Ignore);

/**
 * THE WHOLE PROBE: measure where the player is, then a ring of nearby places, and choose.
 *
 * Tries the FULL envelope first everywhere, then the COMPACT one everywhere, and only then gives up on moving and
 * stages compactly in place. That order matters: being moved a few metres to get the full presentation is a better
 * outcome than being given a reduced one where you stand, and a reduced presentation somewhere sensible is better
 * than a reduced one in a doorway.
 */
WONDERLAND_API FWonderlandStagingResult WonderlandProbeStaging(
	const UWorld* World, const FVector& Origin, const FVector& Facing, const TArray<const AActor*>& Ignore,
	const FWonderlandStagingEnvelope& Full = WonderlandFullEnvelope());

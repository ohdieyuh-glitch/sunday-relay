#include "WonderlandClearanceBubble.h"

#include "CollisionQueryParams.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

namespace
{
	/** How many radii are tried when measuring how much room a place has. More steps is a finer answer, not a better one. */
	constexpr int32 RadiusSteps = 6;

	/** The ring of alternatives: how far out, and how many places around each ring. */
	constexpr float RingDistances[] = { 450.0f, 850.0f, 1300.0f };
	constexpr int32 RingPlaces = 8;

	/** How far below a candidate the ground is allowed to be before the place is not a place. */
	constexpr float GroundDropUU = 260.0f;
}

const FWonderlandStagingEnvelope& WonderlandFullEnvelope()
{
	static const FWonderlandStagingEnvelope Full;
	return Full;
}

const FWonderlandStagingEnvelope& WonderlandCompactEnvelope()
{
	// THE PRESENTATION THAT FITS IN AN ARCHWAY. Measured against the world lane's own numbers: a 3 m garden arch and
	// 8-9 m street walls. The Dog's envelope collapses to a tight turn rather than an orbit, the Contract manifests
	// close in, the cubs emerge in a low ring rather than a dome, and the camera comes in and drops.
	static const FWonderlandStagingEnvelope Compact = []()
	{
		FWonderlandStagingEnvelope E;
		E.DogEnvelopeRadiusUU = 165.0f;
		E.VerticalUU = 250.0f;
		E.ContractRadiusUU = 95.0f;
		E.ContractHeightUU = 165.0f;
		E.SpawnDomeRadiusUU = 120.0f;
		E.SpawnDomeHeightUU = 175.0f;
		E.CameraDistanceUU = 300.0f;
		E.CameraHeightUU = 170.0f;
		return E;
	}();
	return Compact;
}

const TCHAR* WonderlandStagingFitName(EWonderlandStagingFit Fit)
{
	switch (Fit)
	{
	case EWonderlandStagingFit::Full:           return TEXT("FULL");
	case EWonderlandStagingFit::Compact:        return TEXT("COMPACT");
	case EWonderlandStagingFit::CompactInPlace: return TEXT("COMPACT IN PLACE");
	}
	return TEXT("UNKNOWN");
}

bool WonderlandStagingFits(const FWonderlandStagingCandidate& Candidate, const FWonderlandStagingEnvelope& Envelope)
{
	// THE WIDEST THING THE PRESENTATION DOES, and the tallest. The Dog's own envelope is usually the widest, but the
	// cub dome can exceed it in a compact staging, so both are asked rather than assumed.
	const float NeedRadius = FMath::Max3(Envelope.DogEnvelopeRadiusUU, Envelope.ContractRadiusUU, Envelope.SpawnDomeRadiusUU);
	const float NeedHeight = FMath::Max3(Envelope.VerticalUU, Envelope.ContractHeightUU, Envelope.SpawnDomeHeightUU);
	return Candidate.ClearRadiusUU >= NeedRadius && Candidate.ClearHeightUU >= NeedHeight && Candidate.bCameraClear;
}

float WonderlandScoreStaging(const FWonderlandStagingCandidate& Candidate, const FWonderlandStagingEnvelope& Envelope)
{
	const float NeedRadius = FMath::Max3(Envelope.DogEnvelopeRadiusUU, Envelope.ContractRadiusUU, Envelope.SpawnDomeRadiusUU);
	const float NeedHeight = FMath::Max3(Envelope.VerticalUU, Envelope.ContractHeightUU, Envelope.SpawnDomeHeightUU);
	if (NeedRadius <= 0.0f || NeedHeight <= 0.0f)
	{
		return -1.0f;
	}
	// HOW MUCH OF WHAT IT NEEDS IT HAS, capped at 1: a plaza three times wider than the envelope is not three times
	// better than one that fits, and scoring it that way would send the Dog across the map for no gain.
	const float Radius = FMath::Min(Candidate.ClearRadiusUU / NeedRadius, 1.0f);
	const float Height = FMath::Min(Candidate.ClearHeightUU / NeedHeight, 1.0f);
	if (Radius < 1.0f || Height < 1.0f)
	{
		// DOES NOT FIT. Still ordered, so a caller can see which near-miss was closest when nothing fits at all.
		return -1.0f + 0.5f * (Radius + Height) * 0.5f;
	}
	// A CINEMATIC NOBODY CAN SEE IS NOT ONE, so a blocked camera costs more than any amount of floor space gains.
	float Score = 1.0f + (Candidate.bCameraClear ? 1.0f : -0.75f);
	// And being made to walk is a tie-breaker, never a factor: a slightly further place that works beats a near one
	// that does not, which is why this is small and subtracted last.
	Score -= FMath::Min(Candidate.MoveUU / 4000.0f, 0.35f);
	return Score;
}

FWonderlandStagingCandidate WonderlandMeasureStaging(
	const UWorld* World, const FVector& At, const FVector& CameraDirection,
	const FWonderlandStagingEnvelope& Envelope, const TArray<const AActor*>& Ignore)
{
	FWonderlandStagingCandidate Out;
	Out.Location = At;
	if (World == nullptr)
	{
		return Out;
	}

	FCollisionQueryParams Query(SCENE_QUERY_STAT(WonderlandClearanceBubble), false);
	for (const AActor* Actor : Ignore)
	{
		if (Actor != nullptr)
		{
			Query.AddIgnoredActor(Actor);
		}
	}

	// ---- VERTICAL CLEARANCE, first, because the ascension lifts the Dog and a low ceiling is the commonest problem
	// ---- in a built world. Traced from chest height so a kerb underfoot is not read as a ceiling.
	const FVector Chest = At + FVector(0.0, 0.0, 90.0);
	FHitResult Up;
	const FVector Ceiling = Chest + FVector(0.0, 0.0, Envelope.VerticalUU);
	Out.ClearHeightUU = World->LineTraceSingleByChannel(Up, Chest, Ceiling, ECC_Camera, Query)
		? static_cast<float>(Up.Distance) + 90.0f
		: Envelope.VerticalUU + 90.0f;

	// ---- HORIZONTAL CLEARANCE: the largest sphere that fits, found by widening until something is hit. A single
	// ---- sweep at the envelope's radius would answer yes or no; this answers HOW MUCH, which is what lets a compact
	// ---- staging be chosen over a refusal.
	const float NeedRadius = FMath::Max3(Envelope.DogEnvelopeRadiusUU, Envelope.ContractRadiusUU, Envelope.SpawnDomeRadiusUU);
	Out.ClearRadiusUU = 0.0f;
	for (int32 Step = RadiusSteps; Step >= 1; --Step)
	{
		const float Radius = NeedRadius * static_cast<float>(Step) / RadiusSteps;
		bool bClear = true;
		// Eight directions at two heights: the floor a body moves through, and the height a Contract stands at.
		for (int32 Around = 0; Around < 8 && bClear; ++Around)
		{
			const float Angle = 2.0f * PI * Around / 8.0f;
			const FVector Out2D(FMath::Cos(Angle) * Radius, FMath::Sin(Angle) * Radius, 0.0);
			for (const float Height : { 70.0f, 200.0f })
			{
				const FVector From = At + FVector(0.0, 0.0, Height);
				FHitResult Hit;
				if (World->LineTraceSingleByChannel(Hit, From, From + Out2D, ECC_Camera, Query))
				{
					bClear = false;
					break;
				}
			}
		}
		if (bClear)
		{
			Out.ClearRadiusUU = Radius;
			break;
		}
	}

	// ---- CAMERA LINE OF SIGHT. Where the mission's camera would stand, and whether it can see the staging point.
	const FVector Eye = At - CameraDirection * Envelope.CameraDistanceUU + FVector(0.0, 0.0, Envelope.CameraHeightUU);
	FHitResult Sight;
	Out.bCameraClear = !World->LineTraceSingleByChannel(Sight, Eye, At + FVector(0.0, 0.0, 140.0), ECC_Camera, Query);

	return Out;
}

FWonderlandStagingResult WonderlandProbeStaging(
	const UWorld* World, const FVector& Origin, const FVector& Facing, const TArray<const AActor*>& Ignore,
	const FWonderlandStagingEnvelope& Full)
{
	FWonderlandStagingResult Result;
	Result.Location = Origin;
	if (World == nullptr)
	{
		Result.Notes.Add(TEXT("no world to probe; staging where the player is"));
		return Result;
	}

	const FVector Ahead = Facing.GetSafeNormal2D().IsNearlyZero() ? FVector(1.0, 0.0, 0.0) : Facing.GetSafeNormal2D();
	FCollisionQueryParams Query(SCENE_QUERY_STAT(WonderlandClearanceBubbleGround), false);
	for (const AActor* Actor : Ignore)
	{
		if (Actor != nullptr)
		{
			Query.AddIgnoredActor(Actor);
		}
	}

	// ---- WHERE TO LOOK. Where the player is, first -- staging a mission where somebody already stands is always the
	// least surprising answer -- then rings outward. Places on a ring start AHEAD of the player and alternate to
	// either side, so a mission that has to move goes somewhere the player is already looking.
	TArray<FVector> Places;
	Places.Add(Origin);
	for (const float Distance : RingDistances)
	{
		for (int32 Index = 0; Index < RingPlaces; ++Index)
		{
			const int32 Half = (Index + 1) / 2;
			const float Sign = (Index % 2 == 0) ? 1.0f : -1.0f;
			const float Angle = FMath::DegreesToRadians(Half * (360.0f / RingPlaces) * Sign);
			const FVector Direction = Ahead.RotateAngleAxis(FMath::RadiansToDegrees(Angle), FVector::UpVector);
			FVector Spot = Origin + Direction * Distance;

			// A PLACE HAS TO HAVE A FLOOR. Dropping onto the ground also keeps a candidate on the terrace rather than
			// in the air above the drop beside it.
			FHitResult Ground;
			const FVector From = Spot + FVector(0.0, 0.0, 200.0);
			if (World->LineTraceSingleByChannel(Ground, From, From - FVector(0.0, 0.0, GroundDropUU + 200.0), ECC_Camera, Query))
			{
				Spot = Ground.ImpactPoint;
				Places.Add(Spot);
			}
			// No floor within reach: not a place, and silently skipped rather than scored badly.
		}
	}

	// ---- FULL FIRST, EVERYWHERE, THEN COMPACT. Being walked a few metres to get the whole presentation beats being
	// given a reduced one where you stand.
	const FWonderlandStagingEnvelope* Envelopes[] = { &Full, &WonderlandCompactEnvelope() };
	const EWonderlandStagingFit Fits[] = { EWonderlandStagingFit::Full, EWonderlandStagingFit::Compact };

	for (int32 Pass = 0; Pass < 2; ++Pass)
	{
		const FWonderlandStagingEnvelope& Envelope = *Envelopes[Pass];
		float BestScore = -FLT_MAX;
		FWonderlandStagingCandidate Best;
		bool bFound = false;
		for (const FVector& Place : Places)
		{
			FWonderlandStagingCandidate Candidate = WonderlandMeasureStaging(World, Place, Ahead, Envelope, Ignore);
			Candidate.MoveUU = static_cast<float>(FVector::Dist2D(Place, Origin));
			++Result.CandidatesTried;
			if (!WonderlandStagingFits(Candidate, Envelope))
			{
				continue;
			}
			const float Score = WonderlandScoreStaging(Candidate, Envelope);
			if (Score > BestScore)
			{
				BestScore = Score;
				Best = Candidate;
				bFound = true;
			}
		}
		if (bFound)
		{
			Result.Fit = Fits[Pass];
			Result.Chosen = Best;
			Result.Location = Best.Location;
			Result.Notes.Add(FString::Printf(TEXT("%s staging at %.0f uu from the player: %.0f uu clear, %.0f uu of headroom, camera clear"),
				WonderlandStagingFitName(Result.Fit), Best.MoveUU, Best.ClearRadiusUU, Best.ClearHeightUU));
			if (Pass == 1)
			{
				Result.Notes.Add(TEXT("the full presentation did not fit anywhere nearby, so the mission is staged compactly"));
			}
			return Result;
		}
		Result.Notes.Add(FString::Printf(TEXT("nothing within %.0f uu fits the %s envelope"),
			RingDistances[UE_ARRAY_COUNT(RingDistances) - 1], Pass == 0 ? TEXT("full") : TEXT("compact")));
	}

	// ---- NOTHING FIT ANYWHERE. The mission still runs, compactly, where the player is.
	//
	// THIS IS THE FOUNDER'S HARD RULE IN ONE LINE: "MISSION EXECUTION MUST NEVER FAIL because the physical
	// presentation area is cramped." A probe that could return "no" would be a probe that could cancel a mission.
	Result.Fit = EWonderlandStagingFit::CompactInPlace;
	Result.Chosen = WonderlandMeasureStaging(World, Origin, Ahead, WonderlandCompactEnvelope(), Ignore);
	Result.Location = Origin;
	Result.Notes.Add(TEXT("staging compactly where the player stands; the mission runs regardless"));
	return Result;
}

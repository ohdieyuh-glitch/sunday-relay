// THE ONE POSE CONTRACT SHARED BY THE RELAY DOG AND ANY COSTUME IT WEARS.
//
// In its own header because BOTH sides need the definition and neither should have to include the other: the
// character hands this down, the embodiment wears it, and a proof reads it off both to show they are the same
// numbers rather than merely similar ones.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandWornPose.generated.h"

/**
 * THE CANONICAL POSE, AS A COSTUME CAN WEAR IT.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. DriveGaitFromCanonical handed a costume three numbers -- stride phase, gait
 * weight, ground speed -- and the rest of this body's movement was its OWN: Head, Tail, Spine and the standing
 * half of Stride all ran off ActivityTime, an internal clock, with amplitudes written here rather than by the
 * Dog. Walking, the gait weight carried enough of the truth that it nearly passed. STANDING STILL, where the
 * gait weight is zero, the costume was running entirely on its own invention -- which is exactly why the
 * founder saw the alternate mascots idle nothing like Relay OG. And a Mission Contract act -- meditating,
 * reading, painting, flying to verify -- reached the costume through no channel at all, so a skinned Dog went
 * on doing its idle wobble through the whole performance.
 *
 * So the whole pose comes down, every frame, and the cases in Animate() WEAR it instead of inventing one. Relay
 * OG's animator stays the single authority, and a skin goes back to being a change of appearance and nothing else.
 */
USTRUCT(BlueprintType)
struct FWonderlandWornPose
{
	GENERATED_BODY()

	/** Locomotion -- what the narrow API already carried. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float StridePhase = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float GaitWeight = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float SpeedUU = 0.0f;

	/** The body, composed exactly as the canon body's own root is written -- mission lift included. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float BobUU = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float SwayUU = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float LiftUU = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float BodyPitchDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float BodyYawDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float BodyRollDeg = 0.0f;

	/** Head and tail, in the same degrees the canon pivots are given. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float HeadPitchDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float HeadYawDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float TailPitchDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float TailYawDeg = 0.0f;

	/** 1 while the Dog is off the ground, so the legs stop striding at nothing. THE MISSING JUMP CHANNEL. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float AirborneWeight = 0.0f;

	/** How still the performance is holding the body: 1 while meditating or hovering, 0 while walking. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float Stillness = 0.0f;

	/** False until a Dog has handed one down; the body then keeps its own idle, as a free companion should. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") bool bValid = false;
};

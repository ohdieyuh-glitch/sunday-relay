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

	/**
	 * THE SOLVED JOINTS THEMSELVES, not the phase they were solved from.
	 *
	 * THE LAST GAP IN THE PARITY. Handing down StridePhase let the costume re-derive its own leg swing from it
	 * -- Swing * 27 degrees, its own number, its own easing -- so the skins were walking to the Dog's CLOCK
	 * while still using their own LEGS. The rigs are identical (Celestial Light carries exactly Relay OG's
	 * eleven joints), the pose matched field for field, and the walk still looked wrong, because the one thing
	 * never handed over was the angle each joint should actually be at. These are those angles, straight from
	 * RelayDogStride's own solve, so a skin's knee bends where the Dog's knee bends.
	 */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float HipLeftDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float KneeLeftDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float HipRightDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float KneeRightDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float ShoulderLeftDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float ElbowLeftDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float ShoulderRightDeg = 0.0f;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float ElbowRightDeg = 0.0f;

	/**
	 * THE CANON BODY'S FINAL JOINTS, BY THE SIDE OF THE BODY EACH ONE HANGS ON.
	 *
	 * FOUNDER, 2026-09-29 (post-completion regression): "The animation sequences for the OTHER Relay Dog mascot
	 * skins are glitchy in simulation. The Relay Dog does not move correctly when these skins are active."
	 *
	 * THE DEFECT. The angles above are keyed Left/Right, and the costume guessed which of its joints was which
	 * from each joint's rest offset RELATIVE TO ITS PARENT. A shin hangs straight under its thigh and a forearm
	 * straight under its upper arm, so that offset is zero for all four: every one of them read "not left, not
	 * an arm" and was driven by the RIGHT KNEE, with the opposite sign to the canon's shin. Reverse knees, a
	 * left leg half a cycle out of step, forearms flapping in time with a knee. And the canon's Left limbs hang
	 * at +Y while the costume called -Y left, so even the hips were crossed.
	 *
	 * So the costume is now handed the canon's joints AS WRITTEN -- after ApplyMissionPose, so an act reaches a
	 * skin too -- keyed by PHYSICAL SIDE (+Y / -Y) rather than by a name either rig could spell differently, and
	 * the world position the canon animator put each SOLE at. A costume whose legs are a different length
	 * solves its own knee to put its foot on exactly that spot, so a planted foot stays planted on every skin.
	 */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator HipPlusY = FRotator::ZeroRotator;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator HipMinusY = FRotator::ZeroRotator;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator ShinPlusY = FRotator::ZeroRotator;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator ShinMinusY = FRotator::ZeroRotator;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator ShoulderPlusY = FRotator::ZeroRotator;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator ShoulderMinusY = FRotator::ZeroRotator;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator ForearmPlusY = FRotator::ZeroRotator;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator ForearmMinusY = FRotator::ZeroRotator;
	/** The canon head's own rotation, as written (a mission act turns and bows it). */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FRotator HeadRotation = FRotator::ZeroRotator;
	/** Where the canon animator put each sole this frame, in WORLD space. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector SolePlusY = FVector::ZeroVector;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector SoleMinusY = FVector::ZeroVector;
	/** True when the joints above were filled from a bound canon rig. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") bool bHasCanonJoints = false;
	/**
	 * How much of the legs is a PERFORMED pose rather than the walk: 0 walking, standing or jumping -- the costume then
	 * solves its legs onto the soles -- rising to 1 as the legs cross to meditate (PREPARATION) or trail to fly
	 * (VERIFICATION), poses that leave the sagittal plane a two-bone solve works in, where the canon joints are copied.
	 * The canon itself blends its legs by exactly this share (ApplyMissionPose), so the costume blends the same way.
	 *
	 * IT WAS AN ON/OFF SWITCH ON THE WHOLE ACT, and that was a defect of its own: RESEARCH, IMPLEMENTATION and REVIEW
	 * keep the canon's legs walking the Dog's circle round the Contract, and a costume that stopped solving for the
	 * whole act walked that circle on copied angles meant for a different leg -- feet skating off the canon's.
	 */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float LegPerformWeight = 0.0f;

	/**
	 * THE MISSION CONTRACT'S HANDS (founder correction, 2026-09-29: "The animation problem I am describing is
	 * specifically the MISSION CONTRACT ANIMATION SEQUENCES").
	 *
	 * Every act of the Mission Contract is choreographed on the canon body: the book is opened in front of ITS chest,
	 * the brush and the scraper hang from ITS right forearm, the lens is held on the line from ITS eye to the work.
	 * The costumes' shoulders sit 24.5 uu lower than the canon's (measured on all four skins, zg_07), so a costume
	 * that merely copied the canon's arm ANGLES held its hands a quarter of a metre under every prop. These are where
	 * the canon's hand tips and elbows actually are, in world space, so a worn costume can solve its own arms to put
	 * its hands on the props -- blended in by MissionWeight as the act comes in, and out again as it ends.
	 */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector HandPlusY = FVector::ZeroVector;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector HandMinusY = FVector::ZeroVector;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector ElbowPlusY = FVector::ZeroVector;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector ElbowMinusY = FVector::ZeroVector;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector ShoulderAtPlusY = FVector::ZeroVector;
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") FVector ShoulderAtMinusY = FVector::ZeroVector;
	/** How much of a Mission Contract act is on the body right now (the canon's overlay weight): 0 walking, 1 acting.
	 *  The canon blends its own arms from the walk onto the act's goals by this share; the costume does the same. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") float MissionWeight = 0.0f;

	/** False until a Dog has handed one down; the body then keeps its own idle, as a free companion should. */
	UPROPERTY(BlueprintReadWrite, Category = "Wonderland|Companion") bool bValid = false;

	// THE MISSION HANDOFF STANCE'S LEGS, handed down as NUMBERS rather than read back off the canon hip (round 6). Plain C++
	// members, NOT reflected (the Niagara FName rule): they travel by WearCanonicalPose's C++ copy, never through reflection.
	// The canon hip is now the stance's roll TURNED about its hip-to-sole line (WonderlandKneesOut), so its rotator no longer
	// holds a clean roll to copy; a skin takes the roll from here, solves its own leg onto the canon's (unmoved) sole, and turns
	// its own knee out by the same angle about its OWN hip-to-sole line.
	/** The stance's feet-out roll on each side's hip, as the canon writes it before the knees-out turn (degrees). */
	float StanceHipRollPlusY = 0.0f;
	float StanceHipRollMinusY = 0.0f;
	/** wl.Handoff.Stance.KneesOut as eased in this frame (degrees, >= 0; 0 whenever the swords are not held). */
	float StanceKneesOutDeg = 0.0f;
	/**
	 * THE CHARGING STANCE'S BODY (founder, 10-04), plain like the above. The canon root is moved forward (BodyForwardUU, beside
	 * SwayUU and BobUU) so its bend turns about ITS hips, StancePivotUU above the root's pivot; the Stance* rotation is the part of
	 * the written body rotation that turns about them. A costume whose hips sit at another height re-centres the same rotation on
	 * its own hips, so its body bends where its legs join it rather than a canon hip's height above them.
	 */
	float BodyForwardUU = 0.0f;
	float StancePitchDeg = 0.0f;
	float StanceYawDeg = 0.0f;
	float StanceRollDeg = 0.0f;
	float StancePivotUU = 0.0f;
};

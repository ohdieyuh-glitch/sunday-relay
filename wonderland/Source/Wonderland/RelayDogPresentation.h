// WONDERLAND — THE RELAY DOG'S PRESENTATION: ONE ANIMATOR, MANY APPEARANCES.
//
// FOUNDER, 2026-10-01 (Wardrobe): "All mascot skins must use Relay OG's idle behavior ... The skins are different
// appearances of the SAME Relay Dog / SAME Julius ... A mascot skin should change appearance, NOT the fundamental Relay Dog
// behavior." And: "Do not invent a replacement idle animation if Relay OG's current implementation can be reused."
//
// THE IMPLEMENTATION BEING REUSED. Relay OG's whole motion -- standing, walking, jumping, and the idle the founder pointed
// at (body planted, head glancing about the comfortable cone and coming back to centre) -- is RelayDogStride::FDogAnimator:
// engine-free arithmetic, configured from the canon body's head width, fed speed and heading, returning every angle. The
// interest scheduler inside it (FInterest) is the head look-around. ARelayDogCharacter writes that pose onto the canon body
// and hands the same numbers to whatever costume the Dog is wearing (AWonderlandCompanionEmbodiment::WearCanonicalPose), so
// a worn skin in the world already moves exactly like Relay OG.
//
// WHAT WAS MISSING WAS THE WARDROBE. Its mannequin is a separate body with no Dog behind it, so nothing handed it a pose
// and it fell back on the free-standing COMPANION idle: a hover with two degrees of roll on the whole figure, arms beating
// as wings, legs shuffling, the head on its own sine -- a different creature in every skin, Relay OG's figure included.
//
// So the two pieces of that hand-down that do not need a Dog live here, and both callers use them:
//   - ConfigureCanonAnimator: the animator set up exactly as the canon body sets up its own;
//   - ComposeWornPose: the animator's pose turned into what a costume wears, exactly as the Dog composes it.
// The Dog adds what only a bound rig can supply (the joints read back as written, the soles and hands in the world); the
// wardrobe stage runs its own instance of the same animator standing still. No skin is named anywhere.
#pragma once

#include "CoreMinimal.h"
#include "RelayDogStride.h"
#include "WonderlandWornPose.h"

namespace RelayDogPresentation
{
	/** The canon body's head width, uu, when no bound Dog is at hand to ask. dog_v2 builds at 60 (ARelayDogCharacter::HeadWidthUU). */
	inline constexpr float CanonHeadWidthUU = 60.0f;

	/** Set an animator up exactly as ARelayDogCharacter::BindJoints sets up the canon body's own. */
	WONDERLAND_API void ConfigureCanonAnimator(RelayDogStride::FDogAnimator& Animator, float HeadWidthUU);

	/** One frame of standing still, facing HeadingDeg: no speed, no distance, on the ground, no look target -- so the
	 *  animator's own interest scheduler chooses where the head goes, as it does for a Relay OG nobody is steering. */
	WONDERLAND_API RelayDogStride::FDogInput StandingStill(float DeltaSeconds, float HeadingDeg);

	/**
	 * THE CANONICAL POSE AS A COSTUME WEARS IT, from the animator's numbers alone.
	 *
	 * @param Stillness  how still a performance is holding the body (1 meditating or hovering); 0 for the walk and for idle.
	 * @param LiftUU     how far a performance has lifted the body; 0 for the walk and for idle.
	 *
	 * Only the ANGLES are composed here, field for field what ARelayDogCharacter composed inline before this was shared.
	 * The joints-as-written, the soles and the hands need a bound canon rig, so bHasCanonJoints is left false: the Dog
	 * reads its real joints back on top (and sets it), and a caller with no rig (the wardrobe) has the costume wear the
	 * angles -- AWonderlandCompanionEmbodiment's own path for a pose without canon joints.
	 */
	WONDERLAND_API FWonderlandWornPose ComposeWornPose(const RelayDogStride::FDogPose& Pose, float Stillness, float LiftUU);
}

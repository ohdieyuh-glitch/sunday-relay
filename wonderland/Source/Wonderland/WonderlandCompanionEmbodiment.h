// WONDERLAND — A COMPANION, EMBODIED. The imported companion floating beside the Relay Dog.
//
// THE FOUNDER'S DISTINCTION, 2026-09-15, and the reason this is an actor and not a widget: an imported
// LLM Companion and an imported Jhinn AI Agent are PHYSICALLY PRESENT in the world beside the Compound
// Agent's Dog. Their terminals are separate on-screen panels (SWonderlandCompanionTerminal), owned by the
// UI subsystem; this body is owned by the world. A panel can close without a body vanishing, and a body
// can drift off-screen without its console following it.
//
// WHAT IT DOES, and nothing else:
//
//   BUILDS a body from a figure file (WonderlandCompanionFigure.h): one scene pivot per part, one
//   instanced-mesh component per part and material, runtime material instances only. No asset is
//   created or modified, and no shared material instance is ever touched.
//
//   FOLLOWS the player's pawn -- whichever body the controller wears, so a replaced pawn is followed
//   too -- floating at an offset in the pawn's yaw frame, trailing it with an exponential lag, and
//   snapping after a teleport rather than streaking across the map. Idle, it turns to look at the
//   camera, the way a companion looks back at you; moving, it faces where the Dog is going.
//
//   ANIMATES its parts BOUNDED and ASYNCHRONOUS, the rules UWonderlandHoverComponent set for the few
//   things in Wonderland that float: every pose is computed absolutely from rest, so nothing drifts,
//   and each companion's phase is hashed from its name, so two companions never breathe in step.
//
// NO COLLISION, NO NAVIGATION, NO INPUT. It is a presence, not a physics body, and it cannot block the
// Dog, a camera trace or a travel landing.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandWornPose.h"
#include "GameFramework/Actor.h"
#include "WonderlandCompanionFigure.h"
#include "WonderlandCompanionFormation.h"
#include "WonderlandCompanionEmbodiment.generated.h"

class APlayerController;
class UInstancedStaticMeshComponent;
class UProceduralMeshComponent;
class UMaterialInstanceDynamic;
class UMaterialInterface;

/**
 * WHAT THIS BODY IS, so it knows whose colourway to wear.
 *
 * One actor class does five jobs, and the founder has asked for the mascot, the AI Companions and the
 * Sub-Agent Cubs to be independently customisable -- so a body has to know which of them it is. Sniffing the
 * attach parent would work today and break the first time something is re-parented; this is told, once, by
 * whoever spawned it.
 *
 * Neutral is the default ON PURPOSE. A body nobody has classified keeps exactly the colours its figure was
 * authored in, which is the safe way to be wrong.
 */
UENUM()
enum class EWonderlandBodyRole : uint8
{
	/** Authored colours, untouched by any customisation. Project Avatars, test figures, anything unclassified. */
	Neutral,
	/** The Relay Dog's worn skin, and the Wardrobe mannequin that shows it. Wears the MASCOT colourway. */
	Mascot,
	/** An AI Companion. Wears the COMPANION colourway. */
	Companion,
	/** A Sub-Agent Cub's body. Wears NOTHING: a Cub keeps its own identity and its own colours. */
	SubAgent
};

UCLASS(NotBlueprintable)
class WONDERLAND_API AWonderlandCompanionEmbodiment : public AActor
{
	GENERATED_BODY()

public:
	AWonderlandCompanionEmbodiment();

	virtual void Tick(float DeltaSeconds) override;

	/**
	 * Build the body from a figure file. Returns false -- and leaves any body already standing untouched --
	 * when the file cannot be read or does not parse; the reason is logged and kept in GetLastError().
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	bool LoadFigure(const FString& FilePath);

	/** Rebuild from the file this body was last built from. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	bool ReloadFigure();

	/** Say what this body is, so it wears the right colourway. See EWonderlandBodyRole. */
	void SetBodyRole(EWonderlandBodyRole InRole);

	EWonderlandBodyRole GetBodyRole() const { return BodyRole; }

	/**
	 * PUT THE CURRENT COLOURWAY ON A BODY THAT IS ALREADY STANDING, without rebuilding it.
	 *
	 * The founder's requirement is that a colour chosen in the Wardrobe shows on the preview LIVE, and that the
	 * same colour is already on the Dog when the Wardrobe closes. Rebuilding a 30,000-box figure to change a hue
	 * would be a visible stutter and would restart its animation; this re-sets the three parameters that carry
	 * colour on the material instances the body already has.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void RepaintColourway();

	/**
	 * HOW HARD THIS BODY'S FIRE BURNS, as a multiple of what its figure asked for. 1 is the authored flame.
	 *
	 * FOUNDER, 2026-09-25: the Wardrobe preview must be "significantly larger", and separately, from the run
	 * before: "keep the current flame quality... do not regress them". Both, at once, is the problem this
	 * solves. Photographed after the framing was corrected, Arden Infernal and Celestial Light filled the
	 * preview square with a single blown-out shape -- no dog, no halo, no detail. The flames are authored at
	 * two to thirty THOUSAND times white, which is right at arm's length in a garden and is a white wall when
	 * the same figure is brought close enough to fill a 400-pixel window.
	 *
	 * So the MANNEQUIN in the wardrobe burns lower. It is a different actor from the Dog in the world, and the
	 * Dog is untouched: what the founder approved outdoors stays exactly as approved.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SetGlowScale(float Scale);

	/**
	 * Whether this figure's meshes contribute to global illumination. Must be set BEFORE LoadFigure.
	 *
	 * The per-part meshes take this at construction, because it is the only moment it applies: they are
	 * created and registered inside LoadFigure, so a caller setting the property on the actor afterwards
	 * reaches the default subobjects and none of the figure.
	 *
	 * Default TRUE, so the Dog's costume and the AI Companions light the world exactly as the founder
	 * approved. Project Avatars turn it off -- they are tens of thousands of emissive boxes standing in a
	 * showcase, and they are what item 5 is about.
	 */
	void SetContributeToGlobalIllumination(bool bContribute) { bContributeToGlobalIllumination = bContribute; }

	/** The eye level for a figure that is OFF the day cycle. No effect on an exposure-aware body. */
	void SetShowcaseEyeGlow(float Level);

	/** What the figure's eyes are actually being driven to, for a readback that is not the cvar. */
	float GetEyeGlowScale() const;

	/**
	 * HOW HARD THE GLOWING CHANNELS BURN AGAINST THE NIGHT EXPOSURE. Driven by the day cycle; 1 is noon.
	 *
	 * A lit surface gets darker when the sun goes down. An EMISSIVE one does not -- it renders the value it
	 * was given whatever the sky is doing -- and the night exposure lift of +1.45 EV, which is what makes the
	 * dark world readable at all, then multiplies it by nearly three. Photographed at four in the morning the
	 * Dog was a featureless white starburst with the eyes just visible inside it, and every flame skin does
	 * the same thing. This is the correction, and it is a SEPARATE factor from SetGlowScale so the wardrobe's
	 * 0.10 preview dimming and the clock cannot overwrite one another.
	 */
	void SetNightGlow(float Scale);

	/**
	 * HOW HARD THE SHELL'S RIM READS. 1 is daylight; the day cycle drives it up after dark.
	 *
	 * Exists because the mascot measured DARKER than the ground at the darkest hour. See the implementation
	 * for why more moonlight or more fill cannot fix that -- they both light the ground more than the figure.
	 */
	void SetRimBoost(float Amount);

	/**
	 * HOW HARD THE EYES BURN, WHICH IS A DIFFERENT QUESTION FROM HOW HARD THE FIRE BURNS.
	 *
	 * FOUNDER: "Every mascot skin eyes have to be glowing even when its day time in wonderland."
	 *
	 * The eyes are the one part of a mascot that has to read as LIT rather than as coloured, at every hour,
	 * because they are how a Dog looks alive and how its status is shown. Everything else that glows is
	 * scenery and can fade into a bright afternoon; the eyes cannot. They are driven on their own curve --
	 * brighter than authored in full daylight, where a 70,000 lux sun and a closed exposure would otherwise
	 * flatten them into painted-on squares, and only gently brought down at night rather than taking the same
	 * five-fold cut the body's glow takes. See SetNightGlow for the correction this one deliberately opts out
	 * of.
	 */
	void SetEyeGlow(float Scale);

	/**
	 * WHAT THE FLAME SURFACE IS ACTUALLY WEARING, SECTION BY SECTION.
	 *
	 * Moving the ribbons onto M_WL_Fire took the flames off the mascots and three explanations have now been
	 * offered for it without evidence. What is known: the material draws -- an engine cube wearing it lifted
	 * a checkpoint pylon by 0.065 luma -- and the ribbons do not. Everything between those two facts is the
	 * section: how many vertices it has, which material landed on it, and what colour that material was
	 * given. None of it has ever been read.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	FString DescribeFlames() const;

	/**
	 * Every figure material as it is painted RIGHT NOW: name, the channel its figure declared (if any), and the
	 * Color on its body instance and on its flame twin. One "name|channel|r,g,b|r,g,b" entry per material, joined by
	 * ";" -- what a proof reads to show a skin's secondary accents (Jack Flame's fire, tie and suit) took the colour.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	FString DescribeMaterialColours() const;

	// Plain C++, NOT a UFUNCTION: a new reflected name shifts the FName table Niagara hashes (WonderlandBeta.h).
	/** Whether this figure has fire that follows the mascot's FLAME colour (materials tagged `flame` / `flame_light`). */
	bool DeclaresFlame() const;
	/** Whether this figure has strips that follow the mascot's STRIPS colour, COLOR 3 (materials tagged `strip`). */
	bool DeclaresStrips() const;
	/** QA: what the material named Name is painted with right now -- BaseColor/RimColor on a rim, Color otherwise -- and,
	 *  for a smoke surface, whether its relief texture is bound. False when the figure has no such material. */
	bool QaReadPaint(FName Name, FLinearColor& OutBase, FLinearColor& OutRim, FString& OutRelief) const;

	/**
	 * Whether the clock is allowed to touch this body's glow at all. False for the wardrobe's preview figure,
	 * which stands on its own black stage under its own light: a preview that got dimmer after sunset would
	 * be reporting the weather rather than the skin.
	 */
	void SetExposureAware(bool bAware);

	/**
	 * PUT THIS BODY ON THE SHOWCASE LIGHTING CHANNEL, so the world's sun cannot reach it.
	 *
	 * The wardrobe preview is a figure standing in the open world behind a hole in the panel, so the sun lights
	 * it -- and the measurement is unambiguous: Relay OG reads 0.110 luma in the window at noon and 0.036 at
	 * midnight, while Arden Infernal goes the other way because its fire is emissive. A showcase that changes
	 * with the weather is not a showcase.
	 *
	 * The stage's own key, fill and rim lights were never the problem. Cranked fifty-fold at runtime they took
	 * the window from 0.038 to 0.369, so they reach the figure perfectly well; they are simply outvoted by a
	 * 70,000 lux sun. Making them louder would only mean a preview that is brutal at midnight and merely wrong
	 * at noon.
	 *
	 * Lighting channels are the mechanism that actually answers it. The showcase figure and the three stage
	 * lights move to channel 1; everything else in Wonderland, the sun included, stays on channel 0. The
	 * preview is then lit by its own rig and by nothing else, at every hour, which is what the founder asked
	 * for when they said the preview square shows the Dog on black with no Wonderland in it.
	 */
	void SetShowcaseLit(bool bShowcase);

	/**
	 * THE BOX AROUND THE PHYSICAL MASCOT, WITH ITS EFFECTS LEFT OUT. In world space; invalid if nothing is built.
	 *
	 * FOUNDER, 2026-09-26, with video of the wardrobe showing a tiny mascot adrift in black: "Wardrobe framing
	 * MUST derive from the physical mascot BODY, not total actor bounds ... Explicitly exclude from framing
	 * calculations: halo, flames, particles, glow cards ... Those effects can still render. They simply must
	 * NOT determine camera distance."
	 *
	 * That is exactly the fault. Framing solved on the AGGREGATE bounds, so Celestial Light's halo, Apollo's
	 * crown and Arden's fire were all voting on how far away the camera stood -- and a flame that animates
	 * outward votes differently every frame. The camera backed off to fit the biggest thing the figure had
	 * recently thrown, and what was left in the middle was a small dog.
	 *
	 * This is the framing contract: only Lit and Rim meshes, which is the shell and nothing else.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Test")
	FBox GetFramingBodyBounds() const;

	/**
	 * THE FIGURE'S WHOLE MEANINGFUL SILHOUETTE: every built part that is the figure rather than an effect on it -- the
	 * shared skeleton AND whatever a skin hangs on it that holds still, Baal's antlers, Celestial Light's halo, a mask, a
	 * collar, a hat -- whatever its material. Left out: fire (twinkle parts, which are drawn as flame ribbons and are not
	 * part meshes at all), and anything that moves on its own clock as an effect (trail: a banner, a skirt; float: an aura;
	 * orbit). Same frame as GetFramingBodyBounds (world units at the actor, its yaw taken out, scale kept).
	 *
	 * Founder, 2026-10-01 (Wardrobe): "head/ears/antlers/hats not cropped" and "fire/glow/trails should not incorrectly
	 * force the camera backward". GetFramingBodyBounds is the shared skeleton by NAME, so an antler was never in it.
	 */
	FBox GetSilhouetteBounds() const;

	/** Where the flame ribbons are drawn this frame, same frame as above; invalid for a figure with no fire. */
	FBox GetFlameBounds() const;

	/** Which parts the framing box is made of, and where each sits. See the implementation. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	FString DescribeFramingParts() const;

	float GetGlowScale() const { return GlowScale; }

	/** Follow whatever pawn this controller is wearing, now and after it changes. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SetFollowController(APlayerController* Controller);

	/**
	 * IS THIS BODY A COMPANION IN ITS OWN RIGHT, OR IS IT SOMEBODY'S COSTUME?
	 *
	 * One actor class does four jobs in this world: the two AI Companions, EVERY Sub-Agent Cub's body, the Relay
	 * Dog's own worn skin, and the wardrobe mannequin standing on the skin stage. Only the first drives itself --
	 * it follows a player controller and owns its own transform. The rest are attached to, or posed by, something
	 * else, and a TActorIterator cannot tell them apart.
	 *
	 * FOUNDER, 2026-09-25, WITH VIDEO: summoning Sub-Agent Cubs made the AI Companions "move incorrectly and sink
	 * or merge into the floor". This is why. The companions' keep-apart steering iterated every embodiment in the
	 * world, so each newly spawned cub body counted as a peer to be pushed away from -- at up to 345 uu of shove
	 * per cub, several cubs at once -- and cubs are spawned ABOVE the Dog's feet, so the push carried a DOWNWARD
	 * component and drove a companion whose whole hover is 34 uu straight through the ground.
	 *
	 * Companions and Cubs must remain separate actors with independent transform authority. This is the test that
	 * keeps them separate.
	 */
	bool IsIndependentCompanion() const
	{
		return FollowController.IsValid() && GetAttachParentActor() == nullptr;
	}

	/**
	 * Stand where a mission stage needs this companion to stand, for as long as that stage lasts.
	 *
	 * A TEMPORARY OVERRIDE, NOT A REPLACEMENT. The measured Phase 1 offset is untouched and is returned
	 * to the moment the stage ends -- `Follow` is the default and every transition and ending resolves
	 * there, so a companion cannot be stranded in a formation by a stage that forgot to put it back.
	 *
	 * `Index` and `Count` spread the companions around a shared circle rather than stacking them: two
	 * companions orbiting in the same place is one companion with a shadow.
	 */
	void SetFormation(EWonderlandCompanionFormation Formation, const AActor* Contract, int32 Index, int32 Count);

	/**
	 * WHETHER THIS COMPANION HAS JOINED THE MISSION (simulated /join in), what it contributes as, and the beat its
	 * flight was chosen for. The beat is kept so a proof can compare it with the beat the companion's terminal last
	 * narrated -- the two are set in the same call and must never differ.
	 */
	void SetParticipation(bool bInJoined, bool bInAgent, const FLinearColor& InAccent, FName InFlightBeat);

	/**
	 * WHAT THIS COMPANION'S MIND IS ACTUALLY DOING, from the runtime behind it (WonderlandSidekicks.h): IDLE, LISTENING,
	 * THINKING, WORKING, RESPONDING, WAITING_FOR_AUTH, ERROR or DISCONNECTED.
	 *
	 * FOUNDER RULE (2026-09-17): "Animation/state should come from actual runtime activity, not a canned timer. If the
	 * provider is actually processing: the mascot reflects WORKING. If no provider is connected: do not pretend it is
	 * working." So this is pushed in from the runtime and nothing here invents it: with nothing behind the companion the
	 * activity is DISCONNECTED and the body is nearly still.
	 *
	 * It shapes the EXISTING motion rather than adding a second one -- the same float, the same parts, taken faster or
	 * slower and higher or lower -- so a body never has two ideas about what it is doing.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SetRuntimeActivity(FName Activity);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FName GetRuntimeActivity() const { return RuntimeActivity; }

	/**
	 * HOW FAST THIS BODY IS ACTUALLY TRAVELLING, uu/s, measured from its own movement rather than asked of anything.
	 * The gait runs on this: a creature standing still must not march on the spot, and one crossing a plaza must not
	 * mince. A proof reads it beside the gait phase to show the two agree.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	float GetGroundSpeedUu() const { return GroundSpeedUU; }

	/** How far through the gait cycle the legs are, 0..1. For a proof that has to show the legs are not frozen. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	float GetGaitPhase() const { return FMath::Frac(GaitPhase); }

	/**
	 * HOW MUCH OF THE WALK IS SHOWING, 0 standing to 1 at full stride. Eased, so a body never snaps between standing
	 * and walking -- the snap is itself a kind of stiffness.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	float GetGaitWeight() const { return GaitWeight; }

	/**
	 * DRIVE THIS BODY'S GAIT FROM SOMEWHERE ELSE, and stop it running its own.
	 *
	 * WHY A MASCOT SKIN NEEDS THIS. A worn skin is a costume actor standing in for the Relay Dog's body, and left
	 * alone it computed its own walk: its own phase from its own distance, its own weight from its own speed over
	 * its own WalkSpeedUU, its own easing constant, its own idle cadence. Each is reasonable in isolation and all
	 * of them are DIFFERENT from the canonical Dog's -- so a skinned Dog walked at a subtly wrong rate, eased in
	 * and out of motion at a wrong rate, and idled to a wrong clock. "Nowhere near the same behaviour" is exactly
	 * what two independently-tuned gaits look like side by side.
	 *
	 * A SKIN CHANGES THE APPEARANCE OF THE COMPANION AND NOTHING ELSE. So the Dog hands its own canonical
	 * RelayDogStride pose down each frame and the costume wears that instead of inventing one: one animation
	 * authority, one cadence, one set of transitions, whichever skin is on.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void DriveGaitFromCanonical(float InStridePhase, float InGaitWeight, float InSpeedUU);

	/**
	 * WEAR THE WHOLE CANONICAL POSE, not just its gait. This is the call the Relay Dog makes; everything the
	 * costume would otherwise invent for itself is taken from here instead, for every act and for standing still.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void WearCanonicalPose(const FWonderlandWornPose& InPose);

	/** What this body is currently wearing, for proofs that compare a skin against Relay OG frame by frame. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FWonderlandWornPose GetWornPose() const { return WornPose; }

	/** Hand the gait back to this body's own measurement, for a companion nothing is driving. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void ReleaseCanonicalGait() { bGaitDrivenExternally = false; WornPose.bValid = false; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	bool IsGaitDrivenExternally() const { return bGaitDrivenExternally; }

	/**
	 * WHERE ONE NAMED JOINT IS POINTING RIGHT NOW, relative to its parent. Zero rotation for a part that does not
	 * exist, which a caller can tell from GetPartNames().
	 *
	 * THIS EXISTS BECAUSE "IT LOOKS STIFF" IS NOT MEASURABLE FROM A SCREENSHOT. A proof has to be able to say that
	 * the left hip and the right hip are half a cycle apart, that a knee is running behind the hip above it, and that
	 * both stop when the body stops -- and none of that is visible in a still.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FRotator GetPartRotation(FName PartName) const;

	/** Every joint this figure built, in declaration order. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	TArray<FName> GetPartNames() const;

	/**
	 * WHERE THIS FIGURE'S SOLE IS, in world space, for the leg on the side SideSign names (+1 = +Y, -1 = -Y): the
	 * knee joint's world transform walked down the shin length measured from the figure's own boxes. A worn
	 * costume solves this point onto ARelayDogCharacter::GetCanonSoleWorld, and a proof holds the two together.
	 * ZeroVector when the figure has no leg on that side.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FVector GetSoleWorld(float SideSign) const;

	/**
	 * WHERE THIS FIGURE'S HAND IS, in world space, for the arm on the side SideSign names: the elbow joint's world
	 * transform walked down the forearm length measured from the figure's own boxes. Through a Mission Contract act a
	 * worn costume solves this point onto ARelayDogCharacter::GetCanonHandWorld -- the hand that holds the book, the
	 * brush, the lens -- and a proof holds the two together. ZeroVector when the figure has no arm on that side.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FVector GetHandWorld(float SideSign) const;

	/**
	 * WHERE THIS COSTUME'S ARM ON ONE SIDE HANGS AND HOW FAR IT REACHES (shoulder pivot, upper + lower length, world uu).
	 * The Dog keeps a Mission Contract act's hand goals inside what the worn body can reach, so a prop held by the canon
	 * hand stays in the costume's paw (founder regression G1, 2026-09-30). False when the costume has no arm on that side.
	 */
	bool GetArmReach(float SideSign, FVector& OutShoulderWorld, float& OutLengthUU) const;

	/** How this figure's limbs were classified at load, one line per limb joint (kind, side, lengths). */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FString DescribeLimbs() const;

	EWonderlandCompanionFormation GetFormation() const { return Formation; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FString GetFormationName() const { return WonderlandCompanionFormationName(Formation); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	bool IsJoined() const { return bJoined; }

	/** The beat this companion's flight was last chosen for. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FName GetFlightBeat() const { return FlightBeat; }

	/** The Jhinn's execution beam is lit into the Contract right now. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	bool IsBeamOn() const { return bBeamOn; }

	/** How many support pulses this companion has sent into the Contract. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetPulsesSent() const { return PulsesSent; }

	/** How many pulses are in flight right now. Zero outside the research orbit. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetPulsesInFlight() const;

	/** Jump to the follow position immediately instead of gliding there. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SnapToTarget();

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	APawn* GetFollowPawn() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetBoxCount() const { return BoxCount; }

	/**
	 * How tall the figure it built actually stands, in uu, measured from its own boxes. A size progression that cannot
	 * be measured is three pictures of a creature, so a proof reads this rather than trusting a parameter table.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	float GetFigureHeightUu() const { return FigureHeightUU; }

	/** How wide the staged figure is, ornaments included. The wardrobe frames on height and needs this
	 *  to know that a halo or a banner reaches past the body sideways. */
	float GetFigureWidthUu() const { return FigureWidthUU; }
	/** The figure's lowest point in local uu, measured at load. Spawners use it to sit a figure on the ground
	 *  without walking every instance back out of the render proxy to find out where its feet are. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	float GetFigureLowestUu() const { return FigureLowestUU; }

	/** The canonical body as built: its height, and its lowest point in local uu. 0 for a figure with no `body` record. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	float GetBodyHeightUu() const { return BodyHeightUU; }
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	float GetBodyLowestUu() const { return BodyLowestUU; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetPartCount() const { return PartPivots.Num(); }

	/**
	 * THE HAND ON ONE SIDE (Mission Handoff: a held object sits in the hand the player SEES): the forearm joint on the +Y or
	 * -Y side and its hand tip in that joint's own space -- the lowest box the forearm carries, the same far end the canon
	 * measures for its own arms. False for a figure with no such limb. Plain C++, not reflected (the FName rule).
	 */
	bool GetHandFrame(bool bPlusY, USceneComponent*& OutForearm, FVector& OutTipLocal) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FString GetLastError() const { return LastError; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	FString GetFigurePath() const { return FigurePath; }

	/** The presentation name, e.g. "GPT 6 Astra". */
	UPROPERTY(VisibleAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	FString DisplayName;

	/** What kind of import this is, e.g. "LLM COMPANION" or "JHINN AI AGENT". */
	UPROPERTY(VisibleAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	FString ClassLabel;

	/** Where to float, in the pawn's yaw frame: X forward, Y right, uu. Z is added to HoverHeightUU. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	FVector FollowOffset = FVector(-40.0, -135.0, 0.0);

	/** Height of the figure's origin (its tail tip) above the pawn's feet, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float HoverHeightUU = 34.0f;

	/** Vertical travel either side of the hover height, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float HoverAmplitudeUU = 6.0f;

	/** Seconds for one rise and fall. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float HoverPeriodSeconds = 3.8f;

	/** Time constant of the follow, seconds: how far behind a running Dog the companion trails. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float FollowLagSeconds = 0.30f;

	/** Uniform scale on top of the figure's own voxel size. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float FigureScale = 1.0f;

	/**
	 * THE BODY HEIGHT THIS FIGURE IS SIZED TO, uu; 0 keeps its own. When set, LoadFigure derives FigureScale so the figure's
	 * canonical body (its `body` record) stands exactly this tall -- Relay OG's measured height, for every mascot skin, in
	 * the world and in the Wardrobe (founder, 2026-09-30, a HARD rule: "ALL mascot skins must be the same overall height as the canonical Relay OG mascot skin"). Horns, crowns and fire scale with the body and may reach past it.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float TargetBodyHeightUU = 0.0f;

	/** Turn to face the camera once the pawn has stood still this long. Negative never does. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float FaceCameraAfterIdleSeconds = 1.2f;

	/** Farther than this from the follow position and the companion snaps rather than glides: a teleport. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float SnapDistanceUU = 1800.0f;

	/** Radius of the sphere kept clear of walls around the companion's body, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float BodyClearanceRadiusUU = 38.0f;

	/** Height of the body's centre above the figure origin (its tail tip), where the wall sweep aims, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float BodyClearanceHeightUU = 80.0f;

	/** Closest two companions may come, uu (vertical distance counts half). Whichever is inside steers out. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float CompanionSpacingUU = 230.0f;

	/** Closest a companion's body may come to the Dog, across the ground, in a mission flight, uu. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Wonderland|Companion")
	float DogSpacingUU = 150.0f;

private:
	/** A part's animation state. Parallel to PartPivots; plain data, never serialised. */
	struct FPartMotion
	{
		EWonderlandCompanionMotion Motion = EWonderlandCompanionMotion::None;
		float A = 0.0f;
		float B = 0.0f;
		FVector RestLocation = FVector::ZeroVector;
		/**
		 * WHICH LIMB JOINT THIS IS, decided ONCE at load from the figure's ABSOLUTE pivots and its hierarchy -- never
		 * from RestLocation, which is relative to the parent and is zero sideways for every shin and forearm (the
		 * founder's 2026-09-29 skin-locomotion regression). 0 none, 1 hip, 2 knee, 3 shoulder, 4 elbow.
		 */
		uint8 LimbKind = 0;
		/** +1 when the joint hangs on the +Y side of the figure, -1 on -Y, 0 on the centreline. */
		int8 LimbSide = 0;
		/** A hip's knee joint, or a shoulder's elbow (index into PartPivots), so the limb's solve can write both. */
		int32 LowerIndex = INDEX_NONE;
		/** A knee's hip, or an elbow's shoulder -- the joint whose solve already wrote this one. */
		int32 UpperIndex = INDEX_NONE;
		/** Limb lengths in the part hierarchy's units. A leg: hip to knee, and knee to the ground plane. An arm:
		 *  shoulder to elbow, and elbow to the hand tip (the lowest box the forearm carries). */
		float ThighUU = 0.0f;
		float ShinUU = 0.0f;
		/**
		 * TRUE WHEN A SPINE JOINT ABOVE THIS PART ALREADY CARRIES THE PERFORMANCE LIFT.
		 *
		 * A worn costume's root is written with the Dog's mission lift (72 uu to meditate, 150 to fly and verify), and
		 * everything under it rises with it. A FLOAT part adds the lift itself so that a free-floating ornament keeps up
		 * -- which, under the lifted root, lifted it TWICE: Celestial Light's aura hangs off `root`, and through every
		 * PREPARATION and VERIFICATION it rose to twice the Dog's height above its body (founder correction, 2026-09-29).
		 */
		bool bLiftedByAncestor = false;
	};

	/** A glowing material's rest colour, so a pulse is computed from rest and never accumulates. */
	struct FGlowMaterial
	{
		int32 MaterialIndex = INDEX_NONE;
		FName Parameter;
		FLinearColor Rest = FLinearColor::White;
		/**
		 * TRUE FOR A MATERIAL THAT IS MEANT TO BEAT RATHER THAN BREATHE.
		 *
		 * FOUNDER, 2026-09-25, on Skeleton Flame: "The chest skull must GLOW that exact colour ... NOT
		 * permanently emissive. It should have the same living pulse: glow on -> soften/off -> glow on. The
		 * skull's EYES must visibly pulse ... a dark/black block visible from the SIDE/BACK must also pulse ...
		 * synchronised as one system."
		 *
		 * Marked from the FIGURE FILE rather than from a list in here: a material whose name contains "pulse"
		 * beats deeply. Nothing else in the project has to know which skin this is.
		 */
		bool bHeartbeat = false;
	};

	/**
	 * TRUE WHEN THIS FIGURE DECLARED ANY HEARTBEAT MATERIAL AT ALL.
	 *
	 * It is what keeps the change to ONE skin. A figure with no "pulse" material keeps the gentle ten-percent
	 * breath every glow in Wonderland has always had; a figure that declares one puts its whole glow on a
	 * single clock -- eyes, ghostfire, chest skull, the skull's eyes and the seams down its back, together,
	 * which is the "synchronised as one system" the founder asked for in as many words.
	 */
	bool bHasHeartbeat = false;

	UMaterialInterface* ParentFor(EWonderlandCompanionMaterialKind Kind) const;

	/**
	 * THE ONE PLACE A CHOSEN COLOUR IS ALLOWED TO REACH A MATERIAL.
	 *
	 * Called once per material as the body is built and again for every material on a live repaint, so the two
	 * paths cannot disagree about what a colourway means. Which colourway (mascot, companion, or none at all)
	 * comes from BodyRole; which CHANNELS it may touch comes from WonderlandMascotStyle::ChannelFor; and the
	 * chosen colour is MULTIPLIED over the authored one so a skin keeps its own light and shade.
	 */
	/**
	 * @param bFlameTwin  true when painting a ribbon's own brighter instance rather than the body's.
	 *
	 * IT MATTERS BECAUSE OF WHAT THE ANIMATOR REMEMBERS. Painting ends by writing the new colour back into
	 * FGlowMaterial::Rest, so the pulse beats around the new rest instead of putting the old one back on the
	 * next tick. Both instances for a material share an index, so painting the flame twin was overwriting the
	 * BODY's remembered rest with the flame's much brighter value -- and the animator then drove the body's
	 * glow at flame brightness every frame after a repaint.
	 */
	void ApplyColourway(int32 MaterialIndex, class UMaterialInstanceDynamic* Instance,
		const FWonderlandCompanionMaterial& Def, const FLinearColor& Lit, const FLinearColor& Emissive,
		bool bFlameTwin = false);
	void ClearBody();
	FVector DesiredLocation(const APawn* Pawn) const;
	void Animate(float TimeSeconds);
	/** The hip and knee rotations that put the sole of the leg at HipIndex on SoleWorld (a worn costume's legs). */
	bool SolveLegToSole(int32 HipIndex, const FVector& SoleWorld, FRotator& OutHip, FRotator& OutKnee) const;
	/**
	 * The shoulder and elbow rotations that put the hand of the arm at ShoulderIndex where the canon's hand on the same
	 * side is, bending its elbow toward the side the canon's elbow bends -- corrected as little as possible from the
	 * canon's own joint rotations, which carry the act's twist (a Mission Contract act's hands on its props).
	 */
	bool SolveArmToHand(int32 ShoulderIndex, FQuat& OutShoulder, FQuat& OutElbow) const;

	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Companion")
	TObjectPtr<USceneComponent> Root;

	/** Everything the figure builds hangs from this; the hover moves it, so parts animate on top of the float. */
	UPROPERTY(VisibleAnywhere, Category = "Wonderland|Companion")
	TObjectPtr<USceneComponent> FloatRoot;

	UPROPERTY(Transient)
	TArray<TObjectPtr<USceneComponent>> PartPivots;

	/** The joints' names, parallel to PartPivots. Kept only so a proof can name what it is measuring. */
	TArray<FName> PartNames;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> PartMeshes;

	/**
	 * WHICH OF THOSE MESHES ARE THE FIGURE'S BODY, as opposed to its light. See GetFramingBodyBounds.
	 *
	 * Parallel to PartMeshes: true for a mesh built from a Lit or Rim material -- bone, cloth, plate, chain --
	 * and false for one built from a Glow or Additive material -- a halo, a banner, ghostfire, an ember.
	 */
	TArray<bool> PartMeshIsBody;

	/** The figure part each entry of PartMeshes was built from. See DescribeFramingParts. */
	TArray<FName> PartMeshNames;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> MaterialInstances;
	/**
	 * THE SAME MATERIALS AGAIN, AT THEIR FULL UNCOMPRESSED STRENGTH, for the flame ribbons only.
	 *
	 * A figure's glow materials are shared between its BODY boxes and its FLAME sections -- GPT 6 Astra's
	 * "pale" paints its wings, its tail and its fire. That is fine until the two need different brightness,
	 * which is exactly what the founder asked for: "keep the current flame quality... do not regress them"
	 * and, in the same message, the companions "should not be blown out".
	 *
	 * Brightness alone cannot tell them apart -- a flame and a wing are the same 6,430 -- but a flame SHOULD
	 * clip to white, because that is what white-hot looks like, and a wing should not, because then it is a
	 * white blob with no armour in it. So the body instances take the compression and these do not.
	 */
	//
	// UPROPERTY, AND IT WAS NOT. A TObjectPtr in a bare member does NOT keep its object alive -- only a
	// UPROPERTY is a GC root -- so these material instances were collected while the array went on holding
	// pointers to them. Nothing dereferenced them after the build, so it never showed; the moment a live
	// recolour walked the array the editor died on the first one, inside SetVectorParameterValue, with an
	// access violation at address zero. MaterialInstances directly above has always had it.
	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> FlameMaterialInstances;

	/**
	 * WHETHER THE FLAME TWINS WERE BUILT ON THE FIRE MASTER, because the two surfaces are driven by
	 * different arithmetic and only the build path knew which one it had used.
	 *
	 * RepaintColourway recomputed flame brightness as Strength * Dim -- the FALLBACK card's formula --
	 * whatever the twins were actually built on. Picking a colourway therefore moved every flame off the
	 * fire master's sqrt/FireGain curve, and discarded any dim applied through FireGain entirely. One
	 * helper, WonderlandFlameStrength, now answers for both, and this is the bit of state it needs.
	 */
	bool bFlameOnFireMaster = false;

	/**
	 * WHAT EACH FLAME TWIN'S COLOUR RESTS AT, so the heartbeat can beat it as well.
	 *
	 * The animator only ever drove MaterialInstances, so the ribbons -- which are the part of Skeleton Flame
	 * you can see from behind -- never actually beat. They appeared to, because the old flat glow material
	 * was emissive enough to strobe the whole area through Lumen and the measurement picked THAT up: with the
	 * ribbons on a properly shaped fire material the cyan swing behind the Dog fell from 0.081 to 0.0001 while
	 * the front stayed put. The comment above the animator has always said the ghostfire pulses with the
	 * skull. This is what makes that true rather than incidental.
	 */
	TArray<FLinearColor> FlameRestColours;

	/** One support pulse, travelling from this companion into the Contract. */
	struct FSupportPulse
	{
		FVector From = FVector::ZeroVector;
		float Started = -1.0f;
	};

	void AnimatePulses(float TimeSeconds);
	/** Which flank of the Dog's beam to hold while verifying: the side this companion is already on. */
	bool ChooseFlank(const AActor* Contract) const;
	bool bFlankRight = false;
	/** THE WAY HOME, ROUND THE DOG. Set when a mission flight ends with this companion on the other side of the Dog from
	 *  the one it follows on; while set, the follow target is a pass in front of or behind the Dog instead. */
	FVector RouteHome(const APawn* Pawn, const FVector& FollowTarget, float Now);
	bool bRoutingHome = false;
	float RouteStartedAt = -1.0f;
	/** How far in front of or behind the Dog the pass goes, and how far out to either side, uu. */
	static constexpr double HomeRouteReachUU = 220.0;
	/** Where a pulse or the beam leaves the companion: its body, not its figure origin. */
	FVector ContributionOrigin() const;
	/** Lights per pulse (a head and its trail), and how far behind each other they run, as a fraction of the path. */
	static constexpr int32 PulseSparks = 3;
	static constexpr float PulseTrail = 0.09f;

	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> PulseMesh;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> PulseMid;

	/** The Jhinn's execution beam: a thin lit bar from its hands into the Contract, on for part of each cycle. */
	UPROPERTY(Transient)
	TObjectPtr<UStaticMeshComponent> BeamMesh;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> BeamMid;

	void AnimateBeam(float TimeSeconds, const FWonderlandCompanionOrbit& Orbit, bool bContributing);

	TArray<FSupportPulse> Pulses;
	/** What the runtime says this companion is doing, and when it started doing it (for the settle into a new activity). */
	FName RuntimeActivity = TEXT("DISCONNECTED");
	float ActivityChangedAt = 0.0f;
	/** How far the body has moved into its current activity, 0..1. A body does not snap between moods. */
	float ActivityBlend = 1.0f;
	float ActivityRate = 1.0f;
	float ActivityAmplitude = 1.0f;
	float ActivityHeightUU = 0.0f;
	/** The body's own clock, advanced by the activity's rate rather than by scaling the world's time. */
	float ActivityPhase = 0.0f;
	float LastAnimateSeconds = 0.0f;

	// ---- THE GAIT. Measured, not timed: a creature standing still must not march on the spot.
	/** Ground speed in uu/s, from this actor's own movement, smoothed so one stuttered frame is not a sprint. */
	float GroundSpeedUU = 0.0f;
	FVector LastGroundSpot = FVector::ZeroVector;
	bool bHasGroundSpot = false;
	/** The gait's clock, advanced by DISTANCE travelled rather than by time, so stride length stays constant. */
	float GaitPhase = 0.0f;
	/** 0 standing, 1 walking. Eased both ways, because snapping between them is itself a kind of stiffness. */
	float GaitWeight = 0.0f;
	float GaitMeasuredAt = 0.0f;
	/** True while a Relay Dog is handing this costume its canonical stride; the body stops measuring its own. */
	/**
	 * REAL FIRE, NOT BOXES.
	 *
	 * FOUNDER, repeatedly: the flames on Arden Infernal and Skeleton Flame read as plastic. They were voxel
	 * tongues -- stacked cubes -- and no amount of flicker can make a stack of cubes look like combustion,
	 * because the silhouette is wrong at every instant. Every part the figures tag `twinkle` IS a tongue of
	 * flame, so those parts no longer emit boxes at all: they emit tapered, crossed ribbons that lick upward on
	 * layered noise and taper to nothing at the tip, drawn in the figure's own ember materials.
	 */
	struct FFlameSource
	{
		int32 PartIndex = INDEX_NONE;
		int32 OuterMaterial = INDEX_NONE;
		int32 InnerMaterial = INDEX_NONE;
		FVector Base = FVector::ZeroVector;
		float Height = 0.0f;
		float Width = 0.0f;
		float Seed = 0.0f;
	};
	/**
	 * WHICH TIER OF ITSELF THIS FIGURE IS WEARING.
	 *
	 * THE MEASUREMENT THAT ASKED FOR THIS. Ten Project Avatars put 314,020 instanced boxes in the world and took
	 * the RENDER thread from 109 ms to 499 while the GPU went 48 to 70 -- the hardware was never struggling; the
	 * CPU could not submit that many movable instances. The figure is already a hollow shell (fill ratio 0.173),
	 * so there is no interior fat to trim, and the detail is real: 99.9% of its boxes are under 3 uu.
	 *
	 * But the forge already ships three tiers of every avatar and nothing was using them. Cherubim is 36,025
	 * boxes at Large, 16,920 at Medium and 5,885 at Small -- SIX TIMES cheaper -- and at the distance a crowd
	 * actually stands, nobody can tell which one they are looking at. So the founder's rule is kept exactly:
	 * not one avatar fewer, and the system itself becomes cheaper.
	 */
	FString FigureTierRoot;
	/** How many tiered figures were live at the last tier decision, and the tier ceiling that crowd allows. */
	int32 CrowdSeen = 0;
	int32 CrowdTierCeiling = 2;

public:
	/** What the crowd budget did at the last decision, so a proof can read the reason rather than infer it. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetCrowdSeen() const { return CrowdSeen; }
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetCrowdTierCeiling() const { return CrowdTierCeiling; }
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetFigureTier() const { return FigureTier; }

private:
	int32 FigureTier = INDEX_NONE;
	float NextTierCheckSeconds = 0.0f;
	/** Picks the tier for this distance and reloads if the band changed. Hysteresis keeps it from flickering. */
	void ChooseFigureTier(float DistanceUU, float NowSeconds);

	TArray<FFlameSource> FlameSources;
	UPROPERTY() TObjectPtr<UProceduralMeshComponent> FlameSurface = nullptr;
	/** Lays the flame ribbons down for this frame. Cheap: a few hundred triangles for a whole figure. */
	void RebuildFlames(float TimeSeconds);

	/**
	 * LIVING SHADOW, NOT BOXES (Shadow Flame; founder, 2026-10-01: "animated DARK BLACK STRIPS / SHADOW TENDRILS moving
	 * around the Relay Dog ... NOT ordinary fire ... supernatural shadow ribbons ... The motion should feel ALIVE").
	 *
	 * Every part a figure tags `shadow` is a place where tendrils are born; its boxes are measured, never drawn.
	 * RebuildShadows lays every tendril each frame as a tapered black ribbon (two crossed blades, like the flames, so it
	 * has body from every side) whose spine is a function of time with its OWN speed, curl, height, radius, phase and
	 * lifetime -- no two move together -- and which trails through the Dog's recent path when it moves.
	 */
	struct FShadowSource
	{
		int32 PartIndex = INDEX_NONE;
		int32 Material = INDEX_NONE;
		/** The region the tendrils are born in, in the part's own space, uu. */
		FVector Centre = FVector::ZeroVector;
		FVector HalfSize = FVector::ZeroVector;
	};
	struct FShadowTendril
	{
		int32 Source = INDEX_NONE;
		/** 0 rises off the back and past the head; 1 orbits the torso; 2 sweeps low by the legs and trails. */
		int32 Style = 0;
		/** Where it is born, in its part's space, uu. */
		FVector Anchor = FVector::ZeroVector;
		/** How far it reaches at full length, uu. */
		float Reach = 0.0f;
		/** Everything else about it -- speeds, curls, phases, lifetime -- is drawn from this. */
		float Seed = 0.0f;
	};
	TArray<FShadowSource> ShadowSources;
	TArray<FShadowTendril> ShadowTendrils;
	/**
	 * NOT A UPROPERTY, ON PURPOSE: a new reflected member is a new early FName, and a shifted name table crashed a UE 5.8
	 * package at boot inside Niagara. The actor keeps the component alive through its own component list
	 * (AddInstanceComponent); this is only a handle to it.
	 */
	TWeakObjectPtr<UProceduralMeshComponent> ShadowSurface;
	/** Where the figure has been, newest last (xyz world location, w the time): the tendrils trail through it. */
	TArray<FVector4> ShadowPath;
	/** The detail the mesh section was last built at (0 near, 1 mid, 2 far), so a change rebuilds the topology. */
	int32 ShadowDetail = -1;
	/** Every live tendril's tip after the last rebuild, in actor space: what QA measures motion and independence on. */
	TArray<FVector> ShadowTips;
	/** Each tip's width envelope (0 invisible .. 1 full): a tendril between lifetimes is invisible, and QA must not read
	 *  the jump to its next lifetime as a visible jump. */
	TArray<float> ShadowTipWeights;
	int32 ShadowVertexCount = 0;
	/** Lays the shadow tendrils down for this frame. Cheap: under two thousand triangles for the whole figure. */
	void RebuildShadows(float TimeSeconds);

public:
	/** QA: "tendrils N detail D vertices V material M" -- empty for a figure without shadow. */
	FString DescribeShadows() const;
	/** QA: every live tendril's tip, in actor space, after the last frame. Empty for a figure without shadow. */
	const TArray<FVector>& GetShadowTips() const { return ShadowTips; }
	/** QA: each tip's width envelope, parallel to GetShadowTips (0 invisible, between lifetimes .. 1 full). */
	const TArray<float>& GetShadowTipWeights() const { return ShadowTipWeights; }
	/** QA: whether the shadow surface exists and has something drawn in it right now. */
	bool HasLiveShadows() const;

private:
	bool bGaitDrivenExternally = false;
	FWonderlandWornPose WornPose;

	/**
	 * ONE STRIDE ON THE GROUND, in grid units before the figure's scale. The gait clock turns once per stride, so a
	 * bigger creature covers more ground per step rather than taking the same steps faster -- which is the difference
	 * between a large avatar walking and a small one sped up.
	 */
	float StrideLengthUU = 105.0f;

	/** The speed at which the walk is fully shown. Below it the stride is proportionally smaller, not slower. */
	float WalkSpeedUU = 330.0f;

	TWeakObjectPtr<const AActor> ContractActor;
	EWonderlandCompanionFormation Formation = EWonderlandCompanionFormation::Follow;
	float FormationPhase = 0.0f;
	/** The orbit's running angle, in turns, and the rate it is turning at (eased toward the flight's own). */
	double OrbitTurns = 0.0;
	float OrbitRate = 0.0f;
	float NextPulseAt = -1.0f;
	int32 PulsesSent = 0;
	bool bJoined = false;
	bool bAgent = false;
	bool bBeamOn = false;
	FName FlightBeat;
	FLinearColor ContributionAccent = FLinearColor(0.80f, 0.93f, 1.0f);
	FLinearColor AppliedPulseAccent = FLinearColor::Black;

	TArray<FPartMotion> Motions;
	TArray<FGlowMaterial> GlowMaterials;
	EWonderlandBodyRole BodyRole = EWonderlandBodyRole::Neutral;
	/** See SetGlowScale. 1 is the authored flame, which is what every body in the world wears. */
	float GlowScale = 1.0f;

	/** See SetContributeToGlobalIllumination. Read by LoadFigure as each part mesh is built. */
	bool bContributeToGlobalIllumination = true;

	/** See SetNightGlow. 1 is noon; the day cycle drives it down towards NightGlowFloor after dark. */
	float NightGlowScale = 1.0f;

	/** See SetRimBoost. 1 is daylight. */
	float RimBoost = 1.0f;

	/** See SetEyeGlow. Above 1 in daylight, mildly below it at night. */
	float EyeGlowScale = 1.0f;

	/** See SetExposureAware. */
	bool bExposureAware = true;

	/** See SetShowcaseLit. */
	bool bShowcaseLit = false;
	/**
	 * THE MATERIALS AS THE FIGURE FILE DECLARED THEM -- name, kind, authored colour and strength -- kept beside
	 * MaterialInstances and parallel to it.
	 *
	 * A live repaint has to know what each instance WAS before it can say what it should become: a colourway is
	 * multiplied over the authored colour so that a skin keeps its own light and shade, and there is nowhere
	 * else to read that authored colour back from once the instance has been written to once.
	 */
	TArray<FWonderlandCompanionMaterial> BuiltMaterials;

	TWeakObjectPtr<APlayerController> FollowController;
	FString FigurePath;
	FString LastError;
	int32 BoxCount = 0;
	float FigureHeightUU = 0.0f;
	float FigureWidthUU = 0.0f;
	float FigureLowestUU = 0.0f;
	float BodyHeightUU = 0.0f;
	float BodyLowestUU = 0.0f;
	float Phase = 0.0f;
	float IdleSeconds = 0.0f;
	bool bHasSnapped = false;
};

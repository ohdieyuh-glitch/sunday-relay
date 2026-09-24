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

	/** Follow whatever pawn this controller is wearing, now and after it changes. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	void SetFollowController(APlayerController* Controller);

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
	/** The figure's lowest point in local uu, measured at load. Spawners use it to sit a figure on the ground
	 *  without walking every instance back out of the render proxy to find out where its feet are. */
	float GetFigureLowestUu() const { return FigureLowestUU; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetPartCount() const { return PartPivots.Num(); }

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
	};

	/** A glowing material's rest colour, so a pulse is computed from rest and never accumulates. */
	struct FGlowMaterial
	{
		int32 MaterialIndex = INDEX_NONE;
		FName Parameter;
		FLinearColor Rest = FLinearColor::White;
	};

	UMaterialInterface* ParentFor(EWonderlandCompanionMaterialKind Kind) const;
	void ClearBody();
	FVector DesiredLocation(const APawn* Pawn) const;
	void Animate(float TimeSeconds);

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

	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> MaterialInstances;

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
	TArray<FFlameSource> FlameSources;
	UPROPERTY() TObjectPtr<UProceduralMeshComponent> FlameSurface = nullptr;
	/** Lays the flame ribbons down for this frame. Cheap: a few hundred triangles for a whole figure. */
	void RebuildFlames(float TimeSeconds);

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
	TWeakObjectPtr<APlayerController> FollowController;
	FString FigurePath;
	FString LastError;
	int32 BoxCount = 0;
	float FigureHeightUU = 0.0f;
	float FigureLowestUU = 0.0f;
	float Phase = 0.0f;
	float IdleSeconds = 0.0f;
	bool bHasSnapped = false;
};

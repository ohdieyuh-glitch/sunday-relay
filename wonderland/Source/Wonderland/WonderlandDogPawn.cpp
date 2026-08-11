// WONDERLAND — the third-person Relay Dog pawn.
//
// NOT COMPILED. No Unreal Engine binary exists in this environment.

#include "WonderlandDogPawn.h"

#include "Camera/CameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/SpringArmComponent.h"

AWonderlandDogPawn::AWonderlandDogPawn()
{
	/**
	 * TICKS, FOR THE BREATH AND FOR NOTHING ELSE.
	 *
	 * This was `false`, and the reason given was right: "a tick here would be the
	 * first place a timer started pretending to be an activity." The founder
	 * asked for the Dogs to move as though breathing, which needs a clock, so the
	 * tick is on and the original concern is answered by construction instead of
	 * by abstinence:
	 *
	 *   - `Tick` advances ONE float and touches nothing else. It does not poll
	 *     Relay; `ApplyWorldState` is push, and polling from a frame loop would
	 *     make the world's truth a function of frame rate.
	 *   - `WonderlandBreathAt` takes elapsed seconds and has no state parameter,
	 *     so no timer can reach clip selection even by mistake.
	 *   - The breath carries no information, so it cannot pretend to be an
	 *     activity. That is asserted in wonderland-breath.test.ts, including
	 *     against the function's own source text.
	 */
	PrimaryActorTick.bCanEverTick = true;

	DogMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("DogMesh"));
	SetRootComponent(DogMesh);
	DogMesh->SetCollisionProfileName(TEXT("Pawn"));

	// ONE uniform factor on all three axes. The Dog's proportions are its
	// identity; scaling the axes independently distorts the body and is
	// prohibited by the identity contract.
	DogMesh->SetRelativeScale3D(FVector(Proportions.UniformScale));

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(DogMesh);
	CameraBoom->TargetArmLength = 420.0f;
	CameraBoom->SocketOffset = FVector(0.0f, 0.0f, 90.0f);
	CameraBoom->bUsePawnControlRotation = true;
	CameraBoom->bDoCollisionTest = true;

	FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
	FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	FollowCamera->bUsePawnControlRotation = false;

	bUseControllerRotationYaw = false;
}

void AWonderlandDogPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	if (const APlayerController* PlayerController = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
				ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(
					PlayerController->GetLocalPlayer()))
		{
			if (InputContext)
			{
				Subsystem->AddMappingContext(InputContext, 0);
			}
		}
	}

	// Move and Look are bound in the Blueprint subclass, where the actions live.
	// Nothing is bound here that could act on Relay state.
}

void AWonderlandDogPawn::ApplyWorldState(const FWonderlandWorld& World)
{
	// READ ONLY. Copy the two sections this pawn presents and nothing else. No
	// branch here writes to Relay, and there is no method on this class that
	// could: Wonderland requests missions through FWonderlandMissionRequest,
	// whose Authority is `relay_decides`.
	ObservedAgent = World.Agent;
	ObservedLoops = World.Loops;
	bSnapshotApplied = true;

	if (DogMesh)
	{
		DogMesh->SetRelativeScale3D(FVector(Proportions.UniformScale));
	}
}

EWonderlandDogAnimation AWonderlandDogPawn::ObservedAnimation() const
{
	// Dormant until a snapshot has arrived AND that snapshot asserted a motion.
	// Two separate reasons to be dormant, one answer, and neither of them is the
	// idle patrol clip.
	if (!bSnapshotApplied)
	{
		return EWonderlandDogAnimation::Dormant;
	}
	return WonderlandAnimationForMotion(ObservedAgent.Motion);
}

EWonderlandDogOverlay AWonderlandDogPawn::ObservedOverlay() const
{
	if (!bSnapshotApplied)
	{
		return EWonderlandDogOverlay::None;
	}
	// Relay already decided this on the projection side; recomputing it here from
	// the same field keeps the pawn usable when only the agent section is
	// replicated, and the two paths read the identical bExecuting flag.
	return WonderlandOverlayForLoops(ObservedLoops);
}

bool AWonderlandDogPawn::HasObservedActivity() const
{
	return bSnapshotApplied && ObservedAgent.bObserved;
}

void AWonderlandDogPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// The ONLY thing this Tick does. A pawn Tick is where per-frame Relay polling
	// gets added by somebody in a hurry, and polling Relay from a frame loop
	// would make the world's truth a function of frame rate. `ApplyWorldState` is
	// the only way this pawn learns anything, and it is push, not pull.
	//
	// A non-finite or negative delta is discarded rather than accumulated: one
	// bad frame would otherwise poison the breath clock permanently.
	if (FMath::IsFinite(DeltaSeconds) && DeltaSeconds > 0.0f)
	{
		LifeSeconds += DeltaSeconds;
	}

	// APPLIED, not merely computed. A breath nothing reads is a number in a
	// getter, and the founder asked to see the Dogs move.
	//
	// One uniform factor on all three axes, multiplied into the identity scale
	// rather than replacing it: `Proportions.UniformScale` is the Dog's size and
	// the breath is a modulation of it. Writing the breath alone here would make
	// every Dog snap to 1.0 and lose whatever scale the level gave it.
	if (DogMesh != nullptr)
	{
		const float Swell = WonderlandBreathAt(LifeSeconds).UniformScale;
		DogMesh->SetRelativeScale3D(FVector(Proportions.UniformScale * Swell));
	}
}

FWonderlandBreath AWonderlandDogPawn::CurrentBreath() const
{
	// Reads LifeSeconds and nothing else. Not ObservedAgent, not ObservedLoops,
	// not bSnapshotApplied — see the header.
	return WonderlandBreathAt(LifeSeconds);
}

float AWonderlandDogPawn::BreathElapsedSeconds() const
{
	return LifeSeconds;
}

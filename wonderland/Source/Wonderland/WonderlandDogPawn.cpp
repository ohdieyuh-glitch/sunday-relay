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
	// No tick. The pawn has nothing to do on a clock: its animation state comes
	// from Relay snapshots, and movement is driven by input events. A tick here
	// would be the first place a timer started pretending to be an activity.
	PrimaryActorTick.bCanEverTick = false;

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

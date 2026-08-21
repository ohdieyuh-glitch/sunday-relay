// WONDERLAND — the third-person Relay Dog pawn.
//
// NOT COMPILED. No Unreal Engine binary exists in this environment.

#include "WonderlandDogPawn.h"

#include "WonderlandDogBody.h"

#include "Camera/CameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/Scene.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/GameInstance.h"
#include "GameFramework/FloatingPawnMovement.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputAction.h"
#include "InputActionValue.h"
#include "InputCoreTypes.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "Kismet/GameplayStatics.h"
#include "WonderlandInteractable.h"
#include "WonderlandRelayLink.h"

namespace
{
	// The Relay link is a GameInstance subsystem; reach it through the world's
	// game instance. Null-safe at every hop so a pawn placed in an editor
	// preview (no game instance) simply is not driven, rather than crashing.
	UWonderlandRelayLink* FindRelayLink(const AActor* Actor)
	{
		const UWorld* World = Actor != nullptr ? Actor->GetWorld() : nullptr;
		UGameInstance* GameInstance = World != nullptr ? World->GetGameInstance() : nullptr;
		return GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandRelayLink>() : nullptr;
	}
}

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
	// Framed for the visible Dog now that BuildVisibleBody gives the pawn a body:
	// stand back far enough that the ~2.4m Dog reads in the lower third of frame
	// (third-person over-the-back), not pressed against the lens.
	// COMPOSITION, not just distance. At 680uu with a 150uu socket the camera
	// sat inside the prop field: the Dog filled the centre, mushrooms crowded
	// both edges, and the sky — half the reference's charm — was almost
	// entirely out of frame. Pulling back and lifting puts the plaza, the
	// castle skyline and real sky in the same shot, which is the hierarchy the
	// reference is built on.
	//
	// These live here rather than in hub-layout.json on purpose: the layout's
	// `camera` block is DESIGN DOCUMENTATION, and editing it changes nothing.
	// Anyone tuning framing must edit this constructor.
	CameraBoom->TargetArmLength = 1150.0f;
	CameraBoom->SocketOffset = FVector(0.0f, 0.0f, 420.0f);
	CameraBoom->bUsePawnControlRotation = true;
	// Collision test OFF: the plaza is thick with mushrooms, flowers and props, and
	// the arm was collapsing onto the first one behind the Dog, jamming the camera
	// against the body. An open third-person boom reads far better here than an
	// occasionally-clipping one; the district has no interior walls to hide.
	CameraBoom->bDoCollisionTest = false;

	FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
	FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	FollowCamera->bUsePawnControlRotation = false;

	// STORYBOOK GRADE ON THE CAMERA, not a level PostProcessVolume. The unbound PPV's
	// colour grade was not reaching the packaged stream — a 40% ColorGain change did
	// nothing, with zero override errors — so the look is authored here on the camera
	// the stream actually renders through, where it cannot be bypassed. Auto-exposure
	// is PINNED (min==max) so it stops re-metering the bright frame back to milky
	// mid-grey; the negative bias then holds a jewel-rich exposure, and the grade
	// deepens saturation, de-blows the white Dog/spires, and tints shadows violet.
	{
		FPostProcessSettings& PP = FollowCamera->PostProcessSettings;
		PP.bOverride_AutoExposureMinBrightness = true; PP.AutoExposureMinBrightness = 1.0f;
		PP.bOverride_AutoExposureMaxBrightness = true; PP.AutoExposureMaxBrightness = 1.0f;
		PP.bOverride_AutoExposureBias = true;          PP.AutoExposureBias = -1.6f;
		PP.bOverride_ColorSaturation = true;       PP.ColorSaturation = FVector4(1.52f, 1.48f, 1.62f, 1.0f);
		PP.bOverride_ColorContrast = true;         PP.ColorContrast = FVector4(1.17f, 1.16f, 1.15f, 1.0f);
		PP.bOverride_ColorGamma = true;            PP.ColorGamma = FVector4(0.94f, 0.94f, 0.97f, 1.0f);
		PP.bOverride_ColorGainHighlights = true;   PP.ColorGainHighlights = FVector4(0.80f, 0.76f, 0.66f, 1.0f);
		PP.bOverride_ColorGainShadows = true;      PP.ColorGainShadows = FVector4(0.88f, 0.91f, 1.20f, 1.0f);
		PP.bOverride_BloomIntensity = true;        PP.BloomIntensity = 0.5f;
		PP.bOverride_BloomThreshold = true;        PP.BloomThreshold = 1.4f;
		PP.bOverride_VignetteIntensity = true;     PP.VignetteIntensity = 0.42f;
	}
	FollowCamera->PostProcessBlendWeight = 1.0f;

	// Locomotion on the mesh root. Without this AddMovementInput does nothing and
	// the Dog cannot be explored.
	Movement = CreateDefaultSubobject<UFloatingPawnMovement>(TEXT("Movement"));
	Movement->MaxSpeed = 600.0f;      // cm/s — a calm exploration pace
	Movement->Acceleration = 2048.0f;
	Movement->Deceleration = 2048.0f;

	bUseControllerRotationYaw = false;
}

void AWonderlandDogPawn::BeginPlay()
{
	Super::BeginPlay();
	BuildVisibleBody();
	if (UWonderlandRelayLink* Link = FindRelayLink(this))
	{
		Link->RegisterDogPawn(this);
	}
}

void AWonderlandDogPawn::BuildVisibleBody()
{
	// THE TABLE MOVED, AND THAT IS THE FIX. These proportions used to live here
	// and the world's ambient Dogs were meant to be built from a copy of them.
	// The copy was never written — WonderlandStrollingDog did not exist — so the
	// hero Dog and seven companions were silently absent from every build. Now
	// there is ONE canonical body in WonderlandDogBody and both callers use it,
	// which also removes the transcription that verify-dog-proxy.py exists to
	// police.
	//
	// PRESENTATION ONLY. Every part is NoCollision and none touches Relay state.
	WonderlandDogBody::FSkin Skin;
	Skin.Scale = 1.3f;                 // player Dog size
	Skin.FootOffset = 100.0f;          // PlayerStart sits ~100uu above the ground
	const int32 Built = WonderlandDogBody::Build(this, DogMesh, Skin);
	if (Built == 0)
	{
		UE_LOG(LogTemp, Warning,
			   TEXT("THE PLAYER'S RELAY DOG HAS NO BODY. /Engine/BasicShapes/Cube "
					"or the MI_dog_* materials did not load; the player will see "
					"the world and not their own Agent."));
	}
}

void AWonderlandDogPawn::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWonderlandRelayLink* Link = FindRelayLink(this))
	{
		Link->UnregisterDogPawn(this);
	}
	Super::EndPlay(EndPlayReason);
}

void AWonderlandDogPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	// RUNTIME INPUT SETUP IN C++ (no .uasset required). The level generator spawns
	// this raw pawn with null Enhanced Input UPROPERTYs, and authoring IMC/IA assets
	// from Python proved fragile. Build transient InputAction/MappingContext here and
	// map WASD/arrows -> planar move (SwizzleAxis routes the key's X value onto Y for
	// forward/back; Negate flips sign) and mouse -> look. THIS is the fix that makes
	// the packaged, streamed build actually respond to WASD / mouse-look.
	if (MoveAction == nullptr)
	{
		UInputAction* MoveIA = NewObject<UInputAction>(this, TEXT("IA_Move_RT"));
		MoveIA->ValueType = EInputActionValueType::Axis2D;
		MoveAction = MoveIA;
	}
	if (LookAction == nullptr)
	{
		UInputAction* LookIA = NewObject<UInputAction>(this, TEXT("IA_Look_RT"));
		LookIA->ValueType = EInputActionValueType::Axis2D;
		LookAction = LookIA;
	}
	if (InputContext == nullptr)
	{
		UInputMappingContext* IMC = NewObject<UInputMappingContext>(this, TEXT("IMC_RT"));
		IMC->MapKey(MoveAction, EKeys::W).Modifiers.Add(NewObject<UInputModifierSwizzleAxis>(this));
		{
			FEnhancedActionKeyMapping& M = IMC->MapKey(MoveAction, EKeys::S);
			M.Modifiers.Add(NewObject<UInputModifierSwizzleAxis>(this));
			M.Modifiers.Add(NewObject<UInputModifierNegate>(this));
		}
		IMC->MapKey(MoveAction, EKeys::A).Modifiers.Add(NewObject<UInputModifierNegate>(this));
		IMC->MapKey(MoveAction, EKeys::D);
		IMC->MapKey(MoveAction, EKeys::Up).Modifiers.Add(NewObject<UInputModifierSwizzleAxis>(this));
		{
			FEnhancedActionKeyMapping& M = IMC->MapKey(MoveAction, EKeys::Down);
			M.Modifiers.Add(NewObject<UInputModifierSwizzleAxis>(this));
			M.Modifiers.Add(NewObject<UInputModifierNegate>(this));
		}
		IMC->MapKey(MoveAction, EKeys::Left).Modifiers.Add(NewObject<UInputModifierNegate>(this));
		IMC->MapKey(MoveAction, EKeys::Right);
		IMC->MapKey(LookAction, EKeys::Mouse2D);
		InputContext = IMC;
	}

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

	// Bind Move/Look here so the raw C++ pawn is explorable without a Blueprint
	// subclass (the level generator spawns this class directly). A BP subclass must
	// NOT also bind them, or input would double. Guarded on the actions being
	// assigned; the Enhanced Input assets are Editor/generator-created. Nothing
	// bound here acts on Relay state — Move/Look move the body only.
	if (UEnhancedInputComponent* EnhancedInput = Cast<UEnhancedInputComponent>(PlayerInputComponent))
	{
		if (MoveAction != nullptr)
		{
			EnhancedInput->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AWonderlandDogPawn::Move);
		}
		if (LookAction != nullptr)
		{
			EnhancedInput->BindAction(LookAction, ETriggerEvent::Triggered, this, &AWonderlandDogPawn::Look);
		}
	}

	// Legacy axis binds (Config/DefaultInput.ini) as a robust fallback for the
	// streamed build: WASD -> planar move, mouse -> look. Coexists with Enhanced
	// Input; whichever the runtime delivers, the body moves. PRESENTATION ONLY.
	// Movement via BindAxisKey — explicit FKeys as continuous axes, NO config
	// mapping (config +AxisMappings did not cook reliably). WASD + arrows + mouse.
	PlayerInputComponent->BindAxisKey(EKeys::W, this, &AWonderlandDogPawn::MoveForwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Up, this, &AWonderlandDogPawn::MoveForwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::S, this, &AWonderlandDogPawn::MoveBackwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Down, this, &AWonderlandDogPawn::MoveBackwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::D, this, &AWonderlandDogPawn::MoveRightAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Right, this, &AWonderlandDogPawn::MoveRightAxis);
	PlayerInputComponent->BindAxisKey(EKeys::A, this, &AWonderlandDogPawn::MoveLeftAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Left, this, &AWonderlandDogPawn::MoveLeftAxis);
	PlayerInputComponent->BindAxisKey(EKeys::MouseX, this, &AWonderlandDogPawn::TurnAxis);
	PlayerInputComponent->BindAxisKey(EKeys::MouseY, this, &AWonderlandDogPawn::LookUpAxis);
	// Interact via BindKey — explicit FKeys, NO config mapping needed (the config
	// +AxisMappings/+ActionMappings did not cook reliably). E / Space / F / Enter.
	PlayerInputComponent->BindKey(EKeys::E, IE_Pressed, this, &AWonderlandDogPawn::OnInteract);
	PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &AWonderlandDogPawn::OnInteract);
	PlayerInputComponent->BindKey(EKeys::F, IE_Pressed, this, &AWonderlandDogPawn::OnInteract);
	PlayerInputComponent->BindKey(EKeys::Enter, IE_Pressed, this, &AWonderlandDogPawn::OnInteract);

	UE_LOG(LogTemp, Warning, TEXT("WLINPUT setup: EIC=%d ctx=%d move=%d look=%d controller=%d"),
		Cast<UEnhancedInputComponent>(PlayerInputComponent) != nullptr, InputContext != nullptr,
		MoveAction != nullptr, LookAction != nullptr, GetController() != nullptr);
}

void AWonderlandDogPawn::MoveForwardAxis(float Value)
{
	if (Value != 0.f && Controller != nullptr)
	{
		const FRotator YawRot(0.f, Controller->GetControlRotation().Yaw, 0.f);
		AddMovementInput(FRotationMatrix(YawRot).GetUnitAxis(EAxis::X), Value);
	}
}

void AWonderlandDogPawn::MoveBackwardAxis(float Value)
{
	MoveForwardAxis(-Value);
}

void AWonderlandDogPawn::MoveRightAxis(float Value)
{
	if (Value != 0.f && Controller != nullptr)
	{
		const FRotator YawRot(0.f, Controller->GetControlRotation().Yaw, 0.f);
		AddMovementInput(FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y), Value);
	}
}

void AWonderlandDogPawn::MoveLeftAxis(float Value)
{
	MoveRightAxis(-Value);
}

void AWonderlandDogPawn::TurnAxis(float Value)
{
	if (Value != 0.f)
	{
		AddControllerYawInput(Value);
	}
}

void AWonderlandDogPawn::LookUpAxis(float Value)
{
	if (Value != 0.f)
	{
		AddControllerPitchInput(Value);
	}
}

void AWonderlandDogPawn::InteractAxis(float Value)
{
	// Rising edge (E just pressed) raises the intent once; released resets the latch.
	if (Value > 0.5f)
	{
		if (!bInteractHeld)
		{
			bInteractHeld = true;
			OnInteract();
		}
	}
	else
	{
		bInteractHeld = false;
	}
}

void AWonderlandDogPawn::OnInteract()
{
	// Raise the intent of the nearest interactable the player is standing in. This
	// is the ONLY player path to an intent, and it is a REQUEST: TryInteract() calls
	// the Relay Link, which validates + posts to the Bridge; Relay decides. The pawn
	// performs no privileged work. Fail-closed: with no Link config, nothing is sent.
	TArray<AActor*> Interactables;
	UGameplayStatics::GetAllActorsOfClass(this, AWonderlandInteractable::StaticClass(), Interactables);
	const FVector PawnLoc = GetActorLocation();
	int32 InRange = 0;
	for (AActor* const A : Interactables)
	{
		AWonderlandInteractable* const Anchor = Cast<AWonderlandInteractable>(A);
		if (Anchor == nullptr)
		{
			continue;
		}
		const float Dist = FVector::Dist2D(PawnLoc, Anchor->GetActorLocation());
		if (Dist <= Anchor->ProximityRadiusUu)
		{
			++InRange;
			const bool bRaised = Anchor->TryInteractWithinRange(PawnLoc);
			UE_LOG(LogTemp, Warning, TEXT("WLINTERACT in-range '%s' locus='%s' dist=%.0f -> intent raised=%d"),
				*Anchor->IntentType, *Anchor->Locus, Dist, bRaised ? 1 : 0);
		}
	}
	if (InRange == 0)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLINTERACT OnInteract: no interactable within range (pawn=%s, %d total)"),
			*PawnLoc.ToString(), Interactables.Num());
	}
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

	// FACE WHERE IT WALKS. Turn the body toward the horizontal velocity so the
	// Dog leads with its head instead of sliding sideways. Presentation only:
	// movement is world-space and reads the CONTROL rotation (camera), never the
	// actor's — so rotating the actor here cannot feed back into where it goes,
	// and the spring-arm camera uses control rotation too, so it is undisturbed.
	const FVector Vel = GetVelocity();
	const FVector Flat(Vel.X, Vel.Y, 0.0f);
	if (Flat.SizeSquared() > 400.0f) // ~20 cm/s: ignore idle jitter
	{
		const float TargetYaw = Flat.Rotation().Yaw;
		const float NewYaw = FMath::FInterpTo(GetActorRotation().Yaw, TargetYaw, DeltaSeconds, 7.0f);
		SetActorRotation(FRotator(0.0f, NewYaw, 0.0f));
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

void AWonderlandDogPawn::Move(const FInputActionValue& Value)
{
	UE_LOG(LogTemp, Warning, TEXT("WLINPUT Move (enhanced) %s"), *Value.Get<FVector2D>().ToString());
	// Camera-relative planar movement. PRESENTATION ONLY — it moves the body and
	// touches no Relay field; where the player walks never becomes an activity.
	if (Controller == nullptr)
	{
		return;
	}
	const FVector2D Axis = Value.Get<FVector2D>();
	const FRotator YawRotation(0.0, GetControlRotation().Yaw, 0.0);
	const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);
	AddMovementInput(Forward, Axis.Y);
	AddMovementInput(Right, Axis.X);
}

void AWonderlandDogPawn::Look(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	AddControllerYawInput(Axis.X);
	AddControllerPitchInput(Axis.Y);
}

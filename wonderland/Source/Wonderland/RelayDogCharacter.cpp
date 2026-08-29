#include "RelayDogCharacter.h"

#include "Camera/CameraComponent.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "CollisionQueryParams.h"
#include "Components/CapsuleComponent.h"
#include "Components/InputComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/EngineBaseTypes.h"
#include "Engine/EngineTypes.h"
#include "Engine/World.h"
#include "InputCoreTypes.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "WonderlandDogGait.h"

namespace
{
	/** dog_canon.JOINTS, as the generator names them on the Blueprint. */
	const TCHAR* const PivotBody = TEXT("Body");
	const TCHAR* const PivotHead = TEXT("Pivot_head");
	const TCHAR* const PivotArmLeft = TEXT("Pivot_armLeft");
	const TCHAR* const PivotArmRight = TEXT("Pivot_armRight");
	const TCHAR* const PivotForearmLeft = TEXT("Pivot_forearmLeft");
	const TCHAR* const PivotForearmRight = TEXT("Pivot_forearmRight");
	const TCHAR* const PivotLegLeft = TEXT("Pivot_legLeft");
	const TCHAR* const PivotLegRight = TEXT("Pivot_legRight");
	const TCHAR* const PivotShinLeft = TEXT("Pivot_shinLeft");
	const TCHAR* const PivotShinRight = TEXT("Pivot_shinRight");
	const TCHAR* const PivotTail = TEXT("Pivot_tail");

	USceneComponent* FindPivot(AActor* Actor, const TCHAR* Name)
	{
		if (Actor == nullptr) return nullptr;
		TInlineComponentArray<USceneComponent*> Components;
		Actor->GetComponents<USceneComponent>(Components);
		for (USceneComponent* Component : Components)
		{
			if (Component != nullptr && Component->GetName() == Name)
			{
				return Component;
			}
		}
		return nullptr;
	}
}

ARelayDogCharacter::ARelayDogCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
	// The pose must be written AFTER movement has produced this frame's
	// velocity, or every limb is a frame behind the body — which reads as the
	// legs dragging, exactly the artefact this whole file exists to avoid.
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(GetCapsuleComponent());
	// A THIRD-PERSON CAMERA FOR A 1.74 m CHARACTER, not for a human-scaled one.
	// The Dog is 174 uu tall with 48 uu legs; a 600 uu boom at chest height
	// frames it with the world around it and keeps the feet in shot, which is
	// what a locomotion review has to see.
	CameraBoom->TargetArmLength = 420.0f;
	CameraBoom->SocketOffset = FVector(0.0f, 60.0f, 95.0f);
	CameraBoom->bUsePawnControlRotation = false;
	CameraBoom->bInheritPitch = false;
	CameraBoom->bInheritRoll = false;
	CameraBoom->bInheritYaw = true;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 8.0f;
	CameraBoom->bEnableCameraRotationLag = true;
	CameraBoom->CameraRotationLagSpeed = 7.0f;
	CameraBoom->bDoCollisionTest = true;
	CameraBoom->ProbeSize = 12.0f;

	FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
	FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	FollowCamera->SetRelativeRotation(FRotator(-6.0f, 0.0f, 0.0f));
	FollowCamera->FieldOfView = 75.0f;

	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		// Speeds are set per route leg; these are the ceilings and the feel.
		Move->MaxWalkSpeed = 760.0f;
		Move->MaxAcceleration = 900.0f;
		Move->BrakingDecelerationWalking = 1100.0f;
		Move->GroundFriction = 7.0f;
		Move->RotationRate = FRotator(0.0f, 260.0f, 0.0f);
		Move->bOrientRotationToMovement = true;
		Move->bUseControllerDesiredRotation = false;
		// A 48 uu leg cannot lift onto a 45 uu step. The Golden Arrival stairs
		// are authored well below that; this keeps the Dog from levitating up
		// something it should have to walk around.
		Move->MaxStepHeight = 26.0f;
		Move->SetWalkableFloorAngle(46.0f);
		Move->JumpZVelocity = 420.0f;
		Move->AirControl = 0.35f;
	}
	// THE FOUNDER'S DOG IS THE ONE IN THE WORLD. The playtest possesses the Dog
	// that is already standing in Golden Arrival rather than spawning a second
	// one at a PlayerStart: there is exactly one canonical Relay Dog, and the
	// scale reference in ScaleCam07 and the avatar under the founder's hands
	// are the same animal.
	AutoPossessPlayer = EAutoReceiveInput::Player0;
	bUseControllerRotationYaw = false;
	bUseControllerRotationPitch = false;
	bUseControllerRotationRoll = false;
}

bool ARelayDogCharacter::BindJoints()
{
	BodyRoot = FindPivot(this, PivotBody);
	HeadPivot = FindPivot(this, PivotHead);
	TailPivot = FindPivot(this, PivotTail);
	ArmLeft.Shoulder = FindPivot(this, PivotArmLeft);
	ArmLeft.Forearm = FindPivot(this, PivotForearmLeft);
	ArmRight.Shoulder = FindPivot(this, PivotArmRight);
	ArmRight.Forearm = FindPivot(this, PivotForearmRight);
	LegLeft.Hip = FindPivot(this, PivotLegLeft);
	LegLeft.Shin = FindPivot(this, PivotShinLeft);
	LegRight.Hip = FindPivot(this, PivotLegRight);
	LegRight.Shin = FindPivot(this, PivotShinRight);

	TArray<FString> Missing;
	auto Need = [&Missing](const USceneComponent* Component, const TCHAR* Name)
	{
		if (Component == nullptr) Missing.Add(Name);
	};
	Need(BodyRoot, PivotBody);
	Need(HeadPivot, PivotHead);
	Need(TailPivot, PivotTail);
	Need(ArmLeft.Shoulder, PivotArmLeft);
	Need(ArmLeft.Forearm, PivotForearmLeft);
	Need(ArmRight.Shoulder, PivotArmRight);
	Need(ArmRight.Forearm, PivotForearmRight);
	Need(LegLeft.Hip, PivotLegLeft);
	Need(LegLeft.Shin, PivotShinLeft);
	Need(LegRight.Hip, PivotLegRight);
	Need(LegRight.Shin, PivotShinRight);

	if (Missing.Num() > 0)
	{
		// LOUD, ONCE. A silent miss here is a Dog that stands rigid while the
		// log says everything is fine.
		if (!bLoggedBindFailure)
		{
			bLoggedBindFailure = true;
			UE_LOG(LogTemp, Error,
			       TEXT("WLDOG BIND FAILED: %d joint pivot(s) missing on %s: %s -- the Dog will not animate. ")
			       TEXT("dog_v2.py must build Pivot_<joint> for every name in dog_canon.JOINTS."),
			       Missing.Num(), *GetName(), *FString::Join(Missing, TEXT(", ")));
		}
		return false;
	}

	// Which side each limb hangs on, measured rather than assumed: the canon
	// maps the web's -x to Unreal's +y, so the Dog's own left is +Y here, and
	// hard-coding a sign would sweep one arm into its own hip.
	ArmLeft.SideSign = ArmLeft.Shoulder->GetRelativeLocation().Y >= 0.0f ? 1.0f : -1.0f;
	ArmRight.SideSign = ArmRight.Shoulder->GetRelativeLocation().Y >= 0.0f ? 1.0f : -1.0f;
	LegLeft.LateralUU = LegLeft.Hip->GetRelativeLocation().Y;
	LegRight.LateralUU = LegRight.Hip->GetRelativeLocation().Y;
	BodyRestLocation = BodyRoot->GetRelativeLocation();

	const float LegLengthUU = 0.8f * HeadWidthUU;
	const float ThighUU = (0.8f - 0.5125f) * HeadWidthUU;
	const float ShinUU = 0.5125f * HeadWidthUU;
	Animator.Configure(LegLengthUU, ThighUU, ShinUU, HeadWidthUU);

	UE_LOG(LogTemp, Log,
	       TEXT("WLDOG BOUND: 11 joints on %s (head width %.1f uu, leg %.1f = thigh %.1f + shin %.1f, ")
	       TEXT("arms at Y %+.1f / %+.1f)"),
	       *GetName(), HeadWidthUU, LegLengthUU, ThighUU, ShinUU,
	       ArmLeft.Shoulder->GetRelativeLocation().Y, ArmRight.Shoulder->GetRelativeLocation().Y);
	return true;
}

void ARelayDogCharacter::BuildDefaultRoute()
{
	// THE CAPTURE ROUTE, IN THE ORDER THE FOUNDER ASKED TO SEE IT.
	//
	// Distances are in the Dog's own units so the route works at any scale, and
	// every leg is long enough to hold its gait for a few strides — a two-metre
	// dash through a speed band proves nothing about how that band looks.
	const float Fwd = 1.0f;   // +X is the way the arrival path runs
	const FVector Origin = SpawnLocation;
	const float S = HeadWidthUU;

	Route.Reset();
	auto Add = [this](const FVector& To, float Speed, float Hold, const TCHAR* Label)
	{
		FRelayDogRouteLeg Leg;
		Leg.Target = To;
		Leg.SpeedUU = Speed;
		Leg.HoldSeconds = Hold;
		Leg.Label = Label;
		Route.Add(Leg);
	};

	// Idle first, and long enough for the head to take the place in: the idle
	// glance dwell is up to three seconds and the founder wants to see several.
	Add(Origin, 0.0f, 9.0f, TEXT("idle: head life"));
	Add(Origin + FVector(Fwd * 5.0f * S, 0.0f, 0.0f), 120.0f, 1.2f, TEXT("walk"));
	Add(Origin + FVector(Fwd * 12.0f * S, 0.0f, 0.0f), 220.0f, 0.8f, TEXT("jog"));
	Add(Origin + FVector(Fwd * 24.0f * S, 0.0f, 0.0f), 330.0f, 0.6f, TEXT("run"));
	Add(Origin + FVector(Fwd * 42.0f * S, 0.0f, 0.0f), 560.0f, 0.0f, TEXT("full anime run"));
	Add(Origin + FVector(Fwd * 46.0f * S, 0.0f, 0.0f), 0.0f, 2.5f, TEXT("run -> stop"));
	// Turns, at two speeds, with the corner far enough out that the momentum
	// bank has room to build and come back.
	Add(Origin + FVector(Fwd * 52.0f * S, 8.0f * S, 0.0f), 300.0f, 0.4f, TEXT("running turn right"));
	Add(Origin + FVector(Fwd * 58.0f * S, -8.0f * S, 0.0f), 300.0f, 0.4f, TEXT("running turn left"));
	Add(Origin + FVector(Fwd * 62.0f * S, 0.0f, 0.0f), 130.0f, 0.6f, TEXT("walking turn"));
	// Back down the path at a jog, which is also the elevation change: the
	// arrival plaza rises toward the castle, so this leg crosses real steps.
	Add(Origin + FVector(Fwd * 20.0f * S, 0.0f, 0.0f), 240.0f, 0.5f, TEXT("jog back over the steps"));
	Add(Origin, 130.0f, 6.0f, TEXT("walk home, then idle"));
}

FVector ARelayDogCharacter::StepRoute(float DeltaSeconds)
{
	if (Route.Num() == 0) return FVector::ZeroVector;
	if (RouteIndex >= Route.Num())
	{
		RouteIndex = 0;   // the capture loops, so a long take never runs dry
	}

	const FRelayDogRouteLeg& Leg = Route[RouteIndex];
	const FVector Here = GetActorLocation();
	FVector ToTarget = Leg.Target - Here;
	ToTarget.Z = 0.0f;
	const float Distance = ToTarget.Size();

	// ARRIVAL TOLERANCE SCALES WITH SPEED. A fixed radius at 560 uu/s is
	// overshot inside a single frame, and the Dog then circles the point
	// forever — which looks like a bug in the locomotion and is a bug in the
	// route.
	const float Tolerance = FMath::Max(20.0f, Leg.SpeedUU * 0.12f);
	if (Distance <= Tolerance || Leg.SpeedUU <= 1.0f)
	{
		if (RouteHold <= 0.0f && Distance <= Tolerance)
		{
			RouteHold = Leg.HoldSeconds;
		}
		RouteHold -= DeltaSeconds;
		if (Leg.SpeedUU <= 1.0f)
		{
			// A standing leg still has to arrive first.
			if (Distance > Tolerance)
			{
				return ToTarget.GetSafeNormal() * 120.0f;
			}
		}
		if (RouteHold <= 0.0f)
		{
			RouteIndex = (RouteIndex + 1) % Route.Num();
			RouteHold = 0.0f;
			const FRelayDogRouteLeg& Next = Route[RouteIndex];
			UE_LOG(LogTemp, Log, TEXT("WLDOG ROUTE %d/%d: %s (%.0f uu/s)"),
			       RouteIndex + 1, Route.Num(), *Next.Label, Next.SpeedUU);
		}
		return FVector::ZeroVector;
	}

	return ToTarget.GetSafeNormal() * Leg.SpeedUU;
}

void ARelayDogCharacter::UpdateFootGround(FRelayDogLeg& Leg, float ForwardUU, bool bStance, float DeltaSeconds)
{
	if (Leg.Hip == nullptr) return;
	UWorld* World = GetWorld();
	if (World == nullptr) return;

	// Where this foot is about to be put, in world space: the hip's position
	// plus the stride's forward offset along the body's facing, at the lateral
	// offset the canon gives the leg.
	const FTransform BodyXform = GetActorTransform();
	const FVector HipWorld = Leg.Hip->GetComponentLocation();
	const FVector FootWorld = HipWorld + BodyXform.GetUnitAxis(EAxis::X) * ForwardUU;

	// Trace from knee height to a leg's depth below the sole: far enough to
	// find a step down, short enough that a hole in the collision cannot pull
	// the foot to the floor below.
	const float LegLengthUU = 0.8f * HeadWidthUU;
	const FVector Start = FootWorld + FVector(0.0f, 0.0f, LegLengthUU * 0.6f);
	const FVector End = FootWorld - FVector(0.0f, 0.0f, LegLengthUU * 0.9f);

	FHitResult Hit;
	FCollisionQueryParams Params(FName(TEXT("RelayDogFoot")), false, this);
	Params.bTraceComplex = false;
	float GroundDelta = 0.0f;
	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		// Positive means the ground is ABOVE where the foot would otherwise go,
		// which is what WonderlandGait::PawGroundOffset expects.
		GroundDelta = Hit.ImpactPoint.Z - (FootWorld.Z - LegLengthUU);
	}

	// REUSED, NOT RE-DERIVED. The V1 gait already worked out the rules for this
	// — only a planted foot is placed, only vertically, clamped, and eased by
	// half-life so it behaves the same at 20 fps and 60 — and re-deriving them
	// here would be a second copy to keep in step with the first.
	Leg.GroundOffset = WonderlandGait::PawGroundOffset(
		Leg.GroundOffset, GroundDelta, bStance, LegLengthUU * 0.45f, DeltaSeconds);
}

void ARelayDogCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	if (PlayerInputComponent == nullptr) return;

	// EXPLICIT KEYS, NOT A MAPPING CONTEXT. This is the lesson AWonderlandDogPawn
	// already paid for on this exact streamed build: config +AxisMappings and
	// Enhanced Input assets did not cook reliably, and a founder holding W in a
	// browser with nothing moving cannot tell a broken binding from a broken
	// game. BindAxisKey with real FKeys always cooks.
	PlayerInputComponent->BindAxisKey(EKeys::W, this, &ARelayDogCharacter::MoveForwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Up, this, &ARelayDogCharacter::MoveForwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::S, this, &ARelayDogCharacter::MoveBackwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Down, this, &ARelayDogCharacter::MoveBackwardAxis);
	PlayerInputComponent->BindAxisKey(EKeys::D, this, &ARelayDogCharacter::MoveRightAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Right, this, &ARelayDogCharacter::MoveRightAxis);
	PlayerInputComponent->BindAxisKey(EKeys::A, this, &ARelayDogCharacter::MoveLeftAxis);
	PlayerInputComponent->BindAxisKey(EKeys::Left, this, &ARelayDogCharacter::MoveLeftAxis);
	PlayerInputComponent->BindAxisKey(EKeys::MouseX, this, &ARelayDogCharacter::TurnAxis);
	PlayerInputComponent->BindAxisKey(EKeys::MouseY, this, &ARelayDogCharacter::LookUpAxis);

	PlayerInputComponent->BindKey(EKeys::LeftShift, IE_Pressed, this, &ARelayDogCharacter::OnRunPressed);
	PlayerInputComponent->BindKey(EKeys::LeftShift, IE_Released, this, &ARelayDogCharacter::OnRunReleased);
	PlayerInputComponent->BindKey(EKeys::RightShift, IE_Pressed, this, &ARelayDogCharacter::OnRunPressed);
	PlayerInputComponent->BindKey(EKeys::RightShift, IE_Released, this, &ARelayDogCharacter::OnRunReleased);
	PlayerInputComponent->BindKey(EKeys::LeftControl, IE_Pressed, this, &ARelayDogCharacter::OnWalkPressed);
	PlayerInputComponent->BindKey(EKeys::LeftControl, IE_Released, this, &ARelayDogCharacter::OnWalkReleased);
	PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &ACharacter::Jump);
	PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Released, this, &ACharacter::StopJumping);

	// A possessed Dog steers with the mouse, so the boom follows the controller
	// rather than the body; the capture demo keeps the body-locked boom.
	if (CameraBoom != nullptr && !bAutoDemo)
	{
		CameraBoom->bUsePawnControlRotation = true;
		CameraBoom->bInheritPitch = true;
		CameraBoom->bInheritYaw = true;
	}
	UE_LOG(LogTemp, Log, TEXT("WLDOG INPUT bound on %s (WASD, mouse, shift=run, ctrl=walk, space=jump)"), *GetName());
}

void ARelayDogCharacter::MoveForwardAxis(float Value)
{
	if (Value == 0.0f || Controller == nullptr || bAutoDemo) return;
	const FRotator YawOnly(0.0f, Controller->GetControlRotation().Yaw, 0.0f);
	AddMovementInput(FRotationMatrix(YawOnly).GetUnitAxis(EAxis::X), Value);
}

void ARelayDogCharacter::MoveBackwardAxis(float Value) { MoveForwardAxis(-Value); }

void ARelayDogCharacter::MoveRightAxis(float Value)
{
	if (Value == 0.0f || Controller == nullptr || bAutoDemo) return;
	const FRotator YawOnly(0.0f, Controller->GetControlRotation().Yaw, 0.0f);
	AddMovementInput(FRotationMatrix(YawOnly).GetUnitAxis(EAxis::Y), Value);
}

void ARelayDogCharacter::MoveLeftAxis(float Value) { MoveRightAxis(-Value); }

void ARelayDogCharacter::TurnAxis(float Value)
{
	if (Value != 0.0f) AddControllerYawInput(Value);
}

void ARelayDogCharacter::LookUpAxis(float Value)
{
	// Inverted, as a camera pitch is: pushing the mouse forward looks down.
	if (Value != 0.0f) AddControllerPitchInput(-Value);
}

void ARelayDogCharacter::OnRunPressed() { bRunHeld = true; }
void ARelayDogCharacter::OnRunReleased() { bRunHeld = false; }
void ARelayDogCharacter::OnWalkPressed() { bWalkHeld = true; }
void ARelayDogCharacter::OnWalkReleased() { bWalkHeld = false; }

void ARelayDogCharacter::BeginPlay()
{
	Super::BeginPlay();
	// THE DEMO IS A LAUNCH FLAG, NOT A BUILD FLAG.
	//
	// bAutoDemo used to be baked into the map by the generator from an
	// environment variable, which meant the capture build and the playable
	// build were different cooks — 25 minutes apart, and impossible to have at
	// once. The same package now does both: launched with -wldemo the Dog runs
	// the scripted route for the founder's video, launched without it the Dog
	// is the founder's to drive. Nothing about the world changes between them.
	if (FParse::Param(FCommandLine::Get(), TEXT("wldemo")))
	{
		bAutoDemo = true;
		UE_LOG(LogTemp, Log, TEXT("WLDOG DEMO: -wldemo on the command line; the Dog drives its capture route"));
	}
	SpawnLocation = GetActorLocation();
	SpawnYaw = GetActorRotation().Yaw;
	bJointsBound = BindJoints();
	if (bAutoDemo && bUseDefaultRoute)
	{
		BuildDefaultRoute();
		UE_LOG(LogTemp, Log, TEXT("WLDOG DEMO: %d route legs from (%.0f, %.0f, %.0f)"),
		       Route.Num(), SpawnLocation.X, SpawnLocation.Y, SpawnLocation.Z);
	}
}

void ARelayDogCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bJointsBound)
	{
		// One retry: the Blueprint's components exist by BeginPlay, but a Dog
		// spawned before its own construction script finishes would not.
		bJointsBound = BindJoints();
		if (!bJointsBound) return;
	}

	// ---------------------------------------------------------------- driving
	FVector DesiredVelocity = FVector::ZeroVector;
	if (!bAutoDemo)
	{
		// The player's speed band, chosen by modifier. Set before the movement
		// component consumes this frame's input.
		if (UCharacterMovementComponent* Move = GetCharacterMovement())
		{
			Move->MaxWalkSpeed = bWalkHeld ? WalkSpeedUU : (bRunHeld ? RunSpeedUU : JogSpeedUU);
		}
	}
	if (bAutoDemo)
	{
		DesiredVelocity = StepRoute(DeltaSeconds);
		if (UCharacterMovementComponent* Move = GetCharacterMovement())
		{
			// The movement component still does the moving — collision,
			// stepping and friction are its job — so the demo asks for a
			// direction and a speed rather than teleporting the actor.
			Move->MaxWalkSpeed = FMath::Max(60.0f, DesiredVelocity.Size());
		}
		if (!DesiredVelocity.IsNearlyZero())
		{
			AddMovementInput(DesiredVelocity.GetSafeNormal(), 1.0f);
		}
	}

	// ------------------------------------------------------------ the animator
	const FVector Velocity = GetVelocity();
	const FVector Ground(Velocity.X, Velocity.Y, 0.0f);
	const float SpeedUU = Ground.Size();

	RelayDogStride::FDogInput In;
	In.DeltaSeconds = DeltaSeconds;
	In.SpeedUU = SpeedUU;
	// DISTANCE, MEASURED. Not speed x dt: a Dog pressed against a wall has a
	// velocity and no distance, and cycling its legs there is running on the
	// spot. This is the same reason the phase is not driven by a clock.
	In.DistanceUU = SpeedUU * DeltaSeconds;
	In.HeadingDeg = GetActorRotation().Yaw;
	In.DesiredHeadingDeg = Ground.IsNearlyZero()
		? In.HeadingDeg
		: FMath::RadiansToDegrees(FMath::Atan2(Ground.Y, Ground.X));

	const RelayDogStride::FDogPose& Pose = Animator.Update(In);

	// --------------------------------------------------------- ground under it
	const RelayDogStride::FFootPose FootL = RelayDogStride::FootPose(
		Pose.StridePhase, Pose.Stride.StrideLength, Pose.Stride.LiftHeight, Pose.Stride.DutyFactor);
	const RelayDogStride::FFootPose FootR = RelayDogStride::FootPose(
		Pose.StridePhase + 0.5f, Pose.Stride.StrideLength, Pose.Stride.LiftHeight, Pose.Stride.DutyFactor);
	UpdateFootGround(LegLeft, FootL.Forward, FootL.bStance, DeltaSeconds);
	UpdateFootGround(LegRight, FootR.Forward, FootR.bStance, DeltaSeconds);

	// The ground correction is folded back into the IK as extra lift, so a foot
	// on a higher step is REACHED for by the leg rather than translated into
	// the stone.
	RelayDogStride::FFootPose GroundedL = FootL;
	RelayDogStride::FFootPose GroundedR = FootR;
	GroundedL.Lift += LegLeft.GroundOffset;
	GroundedR.Lift += LegRight.GroundOffset;
	const float ThighUU = (0.8f - 0.5125f) * HeadWidthUU;
	const float ShinUU = 0.5125f * HeadWidthUU;
	const float HipHeight = Pose.Stride.HipHeightUU > 1.0f ? Pose.Stride.HipHeightUU : 0.8f * HeadWidthUU;
	const RelayDogStride::FLegPose SolvedL = RelayDogStride::LegPose(GroundedL, ThighUU, ShinUU, HipHeight);
	const RelayDogStride::FLegPose SolvedR = RelayDogStride::LegPose(GroundedR, ThighUU, ShinUU, HipHeight);
	const float Weight = Pose.GaitWeight;

	// ------------------------------------------------------------- the writing
	//
	// UE's pitch about Y takes a limb's downward axis toward +X, so a POSITIVE
	// pitch swings a hanging limb FORWARD — the same sign the arithmetic uses.
	// The knee and elbow are children of their limb, so their angles are
	// relative and the chain composes on its own.
	if (BodyRoot != nullptr)
	{
		BodyRoot->SetRelativeLocation(BodyRestLocation + FVector(0.0f, Pose.SwayUU, Pose.BobUU - Pose.PelvisDropUU));
		BodyRoot->SetRelativeRotation(FRotator(Pose.LeanDeg + Pose.Body.PitchDeg, 0.0f,
		                                       Pose.Body.RollDeg + Pose.TurnRollDeg));
	}
	if (HeadPivot != nullptr)
	{
		// The head keeps its own level against the body's lean, so the Dog
		// looks where it is going instead of at the floor.
		HeadPivot->SetRelativeRotation(FRotator(Pose.HeadPitchDeg - Pose.LeanDeg, Pose.HeadYawDeg, 0.0f));
	}
	if (TailPivot != nullptr)
	{
		TailPivot->SetRelativeRotation(FRotator(Pose.TailPitchDeg, Pose.TailYawDeg, 0.0f));
	}
	if (LegLeft.Hip != nullptr) LegLeft.Hip->SetRelativeRotation(FRotator(SolvedL.HipDeg * Weight, 0.0f, 0.0f));
	if (LegLeft.Shin != nullptr) LegLeft.Shin->SetRelativeRotation(FRotator(-SolvedL.KneeDeg * Weight, 0.0f, 0.0f));
	if (LegRight.Hip != nullptr) LegRight.Hip->SetRelativeRotation(FRotator(SolvedR.HipDeg * Weight, 0.0f, 0.0f));
	if (LegRight.Shin != nullptr) LegRight.Shin->SetRelativeRotation(FRotator(-SolvedR.KneeDeg * Weight, 0.0f, 0.0f));

	auto WriteArm = [](const FRelayDogArm& Arm, const RelayDogStride::FArmPose& ArmPose)
	{
		if (Arm.Shoulder != nullptr)
		{
			// The outward sweep is a ROLL in Unreal's frame — a roll takes the
			// limb's downward axis toward +Y — and its sign follows which side
			// the arm actually hangs on.
			Arm.Shoulder->SetRelativeRotation(
				FRotator(ArmPose.ShoulderDeg, 0.0f, ArmPose.ShoulderYawDeg * Arm.SideSign));
		}
		if (Arm.Forearm != nullptr)
		{
			Arm.Forearm->SetRelativeRotation(FRotator(ArmPose.ElbowDeg, 0.0f, 0.0f));
		}
	};
	WriteArm(ArmLeft, Pose.ArmLeft);
	WriteArm(ArmRight, Pose.ArmRight);

	// One log line per gait change, so a capture can be read against what the
	// Dog was doing without watching every frame.
	if (FMath::Abs(SpeedUU - LastLoggedSpeed) > 40.0f)
	{
		LastLoggedSpeed = SpeedUU;
		UE_LOG(LogTemp, Log, TEXT("WLDOG %s"), *DescribeState());
	}
}

FString ARelayDogCharacter::DescribeState() const
{
	const RelayDogStride::FDogPose& Pose = Animator.Pose();
	return FString::Printf(
		TEXT("%s speed=%.0f uu/s stride=%.0f duty=%.2f lift=%.1f lean=%.1f armsback=%.2f ")
		TEXT("hipL=%.1f kneeL=%.1f shoulderL=%.1f elbowL=%.1f head=(%.1f,%.1f) weight=%.2f"),
		ANSI_TO_TCHAR(RelayDogStride::GaitName(Pose.Stride.Gait)),
		Pose.SpeedUU, Pose.Stride.StrideLength, Pose.Stride.DutyFactor, Pose.Stride.LiftHeight,
		Pose.LeanDeg, Pose.Stride.ArmsBack,
		Pose.LegLeft.HipDeg, Pose.LegLeft.KneeDeg, Pose.ArmLeft.ShoulderDeg, Pose.ArmLeft.ElbowDeg,
		Pose.HeadYawDeg, Pose.HeadPitchDeg, Pose.GaitWeight);
}

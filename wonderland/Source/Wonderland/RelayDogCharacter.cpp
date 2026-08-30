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
	// FRAMED FROM ABOVE, SO THE BOOM HAS LESS TO HIT.
	//
	// At 420 uu behind the Dog and 95 uu up, the boom swept through the world
	// at roughly body height -- balustrades, hedges, tower bases, the fountain
	// coping -- and every one of them yanked the camera to the hit point. The
	// capture caught the result: several seconds of the inside of the Dog's
	// own shoulder. Shorter, higher and looking further down keeps the arm in
	// the air over most of the district, which prevents the collapse instead
	// of hiding it, and it frames the Dog against the ground it is walking on
	// rather than against whatever is behind it.
	CameraBoom->TargetArmLength = 380.0f;
	CameraBoom->SocketOffset = FVector(0.0f, 55.0f, 135.0f);
	CameraBoom->bUsePawnControlRotation = false;
	CameraBoom->bInheritPitch = false;
	CameraBoom->bInheritRoll = false;
	CameraBoom->bInheritYaw = true;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 8.0f;
	CameraBoom->bEnableCameraRotationLag = true;
	CameraBoom->CameraRotationLagSpeed = 7.0f;
	// The collision test stays -- a camera that slides through a castle wall is
	// worse than one that comes in close -- but a smaller probe means it only
	// reacts to something the camera would really have entered.
	CameraBoom->bDoCollisionTest = true;
	CameraBoom->ProbeSize = 7.0f;

	FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
	FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	FollowCamera->SetRelativeRotation(FRotator(-11.0f, 0.0f, 0.0f));
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
		// THE WORLD'S STEPS ARE 20 AND 26 uu, AND THEY CARRY PERLIN NOISE.
		// At exactly 26 the tallest of them was a coin toss -- a tread whose
		// noise pushed it a millimetre over stopped the Dog dead. Thirty gives
		// the margin and still refuses the next thing up, which is a 120 uu
		// terrace wall the Dog has no business climbing.
		Move->MaxStepHeight = 30.0f;
		Move->SetWalkableFloorAngle(46.0f);
		// LEGACY, NON-PLAYER. Jump is not part of Wonderland locomotion (see
		// SetupPlayerInputComponent). These stay only so that a fall off a
		// step still resolves with sane air physics; nothing in normal
		// gameplay can start a jump.
		Move->JumpZVelocity = 420.0f;
		Move->AirControl = 0.35f;
	}
	// AND THE ABILITY IS REFUSED, not merely unbound. An unbound ability is
	// still reachable from a Blueprint, a gamepad default or a later input
	// mapping, and Wonderland's traversal is now audited on the promise that
	// no route anywhere needs a jump. JumpMaxCount 0 is ACharacter's own
	// answer to "this character does not jump".
	JumpMaxCount = 0;
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
	// THE GAIT DEMO RUNS ALONG THE ARRIVAL AXIS, WHICH IS Y.
	//
	// It used to march +X from the spawn because that is the Dog's own forward
	// vector, and the first capture showed the result: the Dog walked sideways
	// into the plaza's side steps and stood there pushing at a wall for fifty
	// seconds. Golden Arrival's axis runs along Y -- the gate at y = -910, the
	// castle beyond y = 9000 -- and the only stretch long enough for a sprint
	// is the approach that W1 just built. So the demo uses the world's
	// coordinates rather than the Dog's, exactly as the exploration route does.
	const FVector Origin = SpawnLocation;
	Route.Reset();
	auto Add = [this](float X, float Y, float Speed, float Hold, const TCHAR* Label)
	{
		FRelayDogRouteLeg Leg;
		Leg.Target = FVector(X, Y, SpawnLocation.Z);
		Leg.SpeedUU = Speed;
		Leg.HoldSeconds = Hold;
		Leg.Label = Label;
		Route.Add(Leg);
	};

	// Idle first, long enough for several glances: the dwell runs to three
	// seconds and one glance proves nothing about variety.
	Add(Origin.X, Origin.Y, 0.0f, 9.0f, TEXT("idle: head life"));
	// Onto the axis, then the speed ladder up the approach, which is straight
	// and now has something either side of it to move past.
	Add(0.0f, 0.0f, 120.0f, 1.0f, TEXT("walk onto the axis"));
	Add(0.0f, 1400.0f, 120.0f, 1.2f, TEXT("walk up the steps"));
	Add(0.0f, 3000.0f, 230.0f, 0.8f, TEXT("jog into the approach"));
	// AROUND THE FOUNTAIN, NOT THROUGH IT. The basin stands on the axis at
	// (0, 5400) -- which is where a fountain belongs, at the centre of its
	// court -- so a route that walks the axis walks into three metres of
	// stone. The Dog proved it by stopping 132 uu short of a waypoint it had
	// otherwise reached. The court is wide; the path goes round.
	Add(0.0f, 4900.0f, 330.0f, 0.4f, TEXT("run to the fountain court"));
	Add(760.0f, 5400.0f, 300.0f, 0.3f, TEXT("round the fountain"));
	Add(0.0f, 5900.0f, 330.0f, 0.3f, TEXT("back onto the axis"));
	Add(0.0f, 8000.0f, 560.0f, 0.0f, TEXT("full anime run to the castle"));
	Add(0.0f, 8600.0f, 0.0f, 2.5f, TEXT("run -> stop"));
	// Turns at the court's cross-axis, where there is room either side.
	Add(2000.0f, 5400.0f, 300.0f, 0.4f, TEXT("running turn left"));
	Add(-2000.0f, 5400.0f, 300.0f, 0.4f, TEXT("running turn right"));
	Add(0.0f, 4200.0f, 130.0f, 0.6f, TEXT("walking turn"));
	// Back down over the steps -- the elevation change and the stairs.
	Add(0.0f, 900.0f, 240.0f, 0.5f, TEXT("jog back over the steps"));
	Add(Origin.X, Origin.Y, 130.0f, 6.0f, TEXT("walk home, then idle"));
}

void ARelayDogCharacter::BuildExplorationRoute()
{
	// THE WORLD, WALKED -- AND SOLVED, NOT GUESSED.
	//
	// The founder's instruction is that the Relay Dog must walk this world:
	// Golden Arrival, the castle corridor, the garden quarter, the mushroom
	// wood, the clock quarter, the hamlet, and home. Sixty quarters over a
	// 720 m world is past the point where waypoints can be typed by hand.
	// Two hand-placed ones have already been found inside planting -- one in
	// a hedge, one at a fountain -- and each cost a capture, because a leg
	// that cannot be reached films leaves until its budget runs out.
	//
	// These legs are GENERATED by wonderland/v2/tools/route.py against the
	// same obstacle model walkable.py audits with, at an 80 uu capsule --
	// more than twice the Dog's own 34 uu radius, so the tour has margin
	// rather than merely fitting. Regenerate after any layout change:
	//
	//     python3 wonderland/v2/tools/route.py --capsule=80 --cpp
	//
	// The named stops carry the holds; the connectors between them carry
	// only speed, so the Dog pauses at the PLACE and not on the road.
	//
	// The solve is also how the world gets fixed. Its first run reported four
	// broken connections: the centres of the garden quarter and the hamlet
	// were the only two spots in 434,342 cells of open ground a walker could
	// not reach, sealed inside their own parterres by their own flower beds.
	// The parterre generator was repaired -- not the route, and not the Dog.
	//
	// NO LEG NEEDS A JUMP, and none ever will: the Dog has none. Space is the
	// Live Terminal.
	Route.Reset();
	auto Add = [this](float X, float Y, float Speed, float Hold, const TCHAR* Label)
	{
		FRelayDogRouteLeg Leg;
		// Z comes from wherever the Dog currently stands; the movement
		// component and the ground traces put it on the surface.
		Leg.Target = FVector(X, Y, SpawnLocation.Z);
		Leg.SpeedUU = Speed;
		Leg.HoldSeconds = Hold;
		Leg.Label = Label;
		Route.Add(Leg);
	};

	Add(50.0f, -1450.0f, 0.0f, 4.0f, TEXT("spawn: stand and look around"));
	Add(50.0f, -2150.0f, 240.0f, 2.0f, TEXT("out through the arrival gate, and turn"));
	Add(50.0f, 550.0f, 150.0f, 1.5f, TEXT("back in, across the plaza"));
	Add(50.0f, 2350.0f, 300.0f, 0.0f, TEXT(""));
	Add(-50.0f, 3850.0f, 300.0f, 0.0f, TEXT(""));
	Add(50.0f, 4550.0f, 300.0f, 0.0f, TEXT(""));
	Add(950.0f, 4950.0f, 300.0f, 0.0f, TEXT(""));
	Add(950.0f, 5450.0f, 300.0f, 0.0f, TEXT(""));
	Add(450.0f, 5450.0f, 300.0f, 0.0f, TEXT(""));
	Add(450.0f, 5350.0f, 300.0f, 1.0f, TEXT("the fountain court"));
	Add(950.0f, 5650.0f, 300.0f, 0.0f, TEXT(""));
	Add(750.0f, 6050.0f, 300.0f, 0.0f, TEXT(""));
	Add(450.0f, 6450.0f, 300.0f, 0.0f, TEXT(""));
	Add(450.0f, 7050.0f, 300.0f, 0.0f, TEXT(""));
	Add(50.0f, 8250.0f, 300.0f, 3.0f, TEXT("the castle front, look up"));
	Add(1150.0f, 8250.0f, 330.0f, 0.0f, TEXT(""));
	Add(1250.0f, 9150.0f, 330.0f, 0.0f, TEXT(""));
	Add(1550.0f, 10050.0f, 330.0f, 0.0f, TEXT(""));
	Add(2650.0f, 10350.0f, 330.0f, 0.0f, TEXT(""));
	Add(3950.0f, 10150.0f, 330.0f, 0.0f, TEXT(""));
	Add(3950.0f, 9550.0f, 330.0f, 0.0f, TEXT(""));
	Add(4850.0f, 9450.0f, 330.0f, 2.5f, TEXT("the garden quarter"));
	Add(3850.0f, 9550.0f, 420.0f, 0.0f, TEXT(""));
	Add(3850.0f, 10050.0f, 420.0f, 0.0f, TEXT(""));
	Add(2850.0f, 10350.0f, 420.0f, 0.0f, TEXT(""));
	Add(1250.0f, 10150.0f, 420.0f, 0.0f, TEXT(""));
	Add(1250.0f, 8750.0f, 420.0f, 0.0f, TEXT(""));
	Add(1050.0f, 8450.0f, 420.0f, 0.0f, TEXT(""));
	Add(1050.0f, 5950.0f, 420.0f, 0.0f, TEXT(""));
	Add(850.0f, 4850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-50.0f, 4450.0f, 420.0f, 0.0f, TEXT(""));
	Add(50.0f, 150.0f, 420.0f, 0.0f, TEXT(""));
	Add(50.0f, -6250.0f, 420.0f, 0.0f, TEXT(""));
	Add(550.0f, -8650.0f, 420.0f, 0.0f, TEXT(""));
	Add(1450.0f, -10750.0f, 420.0f, 0.0f, TEXT(""));
	Add(1750.0f, -11050.0f, 420.0f, 0.0f, TEXT(""));
	Add(4150.0f, -12250.0f, 420.0f, 0.0f, TEXT(""));
	Add(4850.0f, -12050.0f, 420.0f, 2.5f, TEXT("the mushroom wood"));
	Add(4250.0f, -12250.0f, 420.0f, 0.0f, TEXT(""));
	Add(4550.0f, -13050.0f, 420.0f, 0.0f, TEXT(""));
	Add(4850.0f, -13150.0f, 420.0f, 0.0f, TEXT(""));
	Add(6350.0f, -12450.0f, 420.0f, 0.0f, TEXT(""));
	Add(6450.0f, -11850.0f, 420.0f, 0.0f, TEXT(""));
	Add(9150.0f, -11250.0f, 420.0f, 0.0f, TEXT(""));
	Add(11350.0f, -10950.0f, 420.0f, 0.0f, TEXT(""));
	Add(13350.0f, -10850.0f, 420.0f, 0.0f, TEXT(""));
	Add(13350.0f, -9650.0f, 420.0f, 0.0f, TEXT(""));
	Add(14550.0f, -8050.0f, 420.0f, 0.0f, TEXT(""));
	Add(14550.0f, -7450.0f, 420.0f, 0.0f, TEXT(""));
	Add(13750.0f, -5450.0f, 420.0f, 0.0f, TEXT(""));
	Add(12350.0f, -4450.0f, 420.0f, 0.0f, TEXT(""));
	Add(12250.0f, -3650.0f, 420.0f, 2.5f, TEXT("the clock quarter"));
	Add(10850.0f, -3450.0f, 420.0f, 0.0f, TEXT(""));
	Add(10850.0f, -1550.0f, 420.0f, 0.0f, TEXT(""));
	Add(10550.0f, -1450.0f, 420.0f, 0.0f, TEXT(""));
	Add(7050.0f, -1450.0f, 420.0f, 0.0f, TEXT(""));
	Add(5750.0f, 450.0f, 420.0f, 0.0f, TEXT(""));
	Add(5750.0f, 2050.0f, 420.0f, 0.0f, TEXT(""));
	Add(3350.0f, 3050.0f, 420.0f, 0.0f, TEXT(""));
	Add(3350.0f, 3550.0f, 420.0f, 0.0f, TEXT(""));
	Add(2650.0f, 4050.0f, 420.0f, 0.0f, TEXT(""));
	Add(1050.0f, 4750.0f, 420.0f, 0.0f, TEXT(""));
	Add(950.0f, 5850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-50.0f, 6750.0f, 420.0f, 0.0f, TEXT(""));
	Add(-50.0f, 7150.0f, 420.0f, 0.0f, TEXT(""));
	Add(-1050.0f, 8150.0f, 420.0f, 0.0f, TEXT(""));
	Add(-1050.0f, 8950.0f, 420.0f, 0.0f, TEXT(""));
	Add(-2350.0f, 9150.0f, 420.0f, 0.0f, TEXT(""));
	Add(-3550.0f, 8950.0f, 420.0f, 0.0f, TEXT(""));
	Add(-4050.0f, 10250.0f, 420.0f, 0.0f, TEXT(""));
	Add(-8350.0f, 10750.0f, 420.0f, 0.0f, TEXT(""));
	Add(-8350.0f, 11050.0f, 420.0f, 0.0f, TEXT(""));
	Add(-11950.0f, 11450.0f, 420.0f, 0.0f, TEXT(""));
	Add(-12150.0f, 10650.0f, 420.0f, 0.0f, TEXT(""));
	Add(-10750.0f, 9850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-10950.0f, 8750.0f, 420.0f, 0.0f, TEXT(""));
	Add(-12150.0f, 8650.0f, 420.0f, 2.5f, TEXT("the hamlet"));
	Add(-10750.0f, 8750.0f, 300.0f, 0.0f, TEXT(""));
	Add(-10750.0f, 9950.0f, 300.0f, 0.0f, TEXT(""));
	Add(-12150.0f, 10650.0f, 300.0f, 0.0f, TEXT(""));
	Add(-11850.0f, 11250.0f, 300.0f, 0.0f, TEXT(""));
	Add(-11450.0f, 11450.0f, 300.0f, 0.0f, TEXT(""));
	Add(-5450.0f, 10750.0f, 300.0f, 0.0f, TEXT(""));
	Add(-5350.0f, 10350.0f, 300.0f, 0.0f, TEXT(""));
	Add(-3750.0f, 10250.0f, 300.0f, 0.0f, TEXT(""));
	Add(-3650.0f, 9150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-3250.0f, 8950.0f, 300.0f, 0.0f, TEXT(""));
	Add(-1650.0f, 9150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-1050.0f, 8850.0f, 300.0f, 0.0f, TEXT(""));
	Add(-1150.0f, 6950.0f, 300.0f, 0.0f, TEXT(""));
	Add(-950.0f, 5050.0f, 300.0f, 0.0f, TEXT(""));
	Add(-750.0f, 4850.0f, 300.0f, 0.0f, TEXT(""));
	Add(-50.0f, 4450.0f, 300.0f, 0.0f, TEXT(""));
	Add(50.0f, 150.0f, 300.0f, 0.0f, TEXT(""));
	Add(50.0f, -1450.0f, 300.0f, 5.0f, TEXT("home, and idle"));
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

	// A LEG THAT CANNOT BE REACHED MUST NOT HANG THE WHOLE ROUTE.
	//
	// The first exploration capture spent most of its ninety seconds filming a
	// Dog wedged in a hedge: one waypoint had been placed inside planting, the
	// arrival tolerance was therefore never met, and the route pushed at it
	// forever. Every later leg -- the castle approach, the turns, the look back
	// -- never happened, and the video showed a wall of leaves instead. A
	// waypoint can be wrong; a capture that silently films nothing for a minute
	// is worse. Each leg now gets a generous but finite budget, and giving up
	// says so in the log rather than quietly.
	LegSeconds += DeltaSeconds;
	const float LegBudget = FMath::Max(12.0f, Leg.HoldSeconds + 25.0f);
	if (LegSeconds > LegBudget)
	{
		UE_LOG(LogTemp, Warning,
		       TEXT("WLDOG ROUTE: gave up on leg %d/%d '%s' after %.0f s (%.0f uu short) -- moving on"),
		       RouteIndex + 1, Route.Num(), *Leg.Label, LegSeconds,
		       FVector::Dist2D(Here, Leg.Target));
		RouteIndex = (RouteIndex + 1) % Route.Num();
		RouteHold = 0.0f;
		LegSeconds = 0.0f;
		return FVector::ZeroVector;
	}
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
			LegSeconds = 0.0f;
			const FRelayDogRouteLeg& Next = Route[RouteIndex];
			UE_LOG(LogTemp, Log, TEXT("WLDOG ROUTE %d/%d: %s (%.0f uu/s)"),
			       RouteIndex + 1, Route.Num(), *Next.Label, Next.SpeedUU);
		}
		return FVector::ZeroVector;
	}

	return ToTarget.GetSafeNormal() * Leg.SpeedUU;
}

float ARelayDogCharacter::TraceFootGround(float ForwardUU, float LateralUU) const
{
	const UWorld* World = GetWorld();
	if (World == nullptr) return 0.0f;

	// Where this foot is about to be put, in world space: along the body's
	// facing by the stride's offset, at the lateral offset the canon gives the
	// leg, and the sole is a leg's length below the hip.
	const FTransform BodyXform = GetActorTransform();
	const float LegLengthUU = 0.8f * HeadWidthUU;
	const FVector FootWorld = GetActorLocation()
		+ BodyXform.GetUnitAxis(EAxis::X) * ForwardUU
		+ BodyXform.GetUnitAxis(EAxis::Y) * LateralUU;
	const float SoleZ = GetActorLocation().Z - GetCapsuleComponent()->GetScaledCapsuleHalfHeight();

	// From knee height down to a leg's depth below the sole: far enough to find
	// a step down, short enough that a gap in the collision cannot pull the
	// foot to whatever is underneath the world.
	const FVector Start(FootWorld.X, FootWorld.Y, SoleZ + LegLengthUU * 0.6f);
	const FVector End(FootWorld.X, FootWorld.Y, SoleZ - LegLengthUU * 0.9f);

	FHitResult Hit;
	FCollisionQueryParams Params(FName(TEXT("RelayDogFoot")), false, this);
	Params.bTraceComplex = false;
	if (!World->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		return 0.0f;
	}
	// Positive means the ground is ABOVE where the foot would otherwise go.
	return Hit.ImpactPoint.Z - SoleZ;
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

	// DOUBLE-TAP FORWARD AND HOLD TO RUN. Both forward keys are watched, and
	// the run lasts exactly as long as the key stays down -- releasing it ends
	// the run rather than leaving the Dog sprinting into a hedge.
	PlayerInputComponent->BindKey(EKeys::W, IE_Pressed, this, &ARelayDogCharacter::OnForwardPressed);
	PlayerInputComponent->BindKey(EKeys::W, IE_Released, this, &ARelayDogCharacter::OnForwardReleased);
	PlayerInputComponent->BindKey(EKeys::Up, IE_Pressed, this, &ARelayDogCharacter::OnForwardPressed);
	PlayerInputComponent->BindKey(EKeys::Up, IE_Released, this, &ARelayDogCharacter::OnForwardReleased);

	PlayerInputComponent->BindKey(EKeys::LeftShift, IE_Pressed, this, &ARelayDogCharacter::OnRunPressed);
	PlayerInputComponent->BindKey(EKeys::LeftShift, IE_Released, this, &ARelayDogCharacter::OnRunReleased);
	PlayerInputComponent->BindKey(EKeys::RightShift, IE_Pressed, this, &ARelayDogCharacter::OnRunPressed);
	PlayerInputComponent->BindKey(EKeys::RightShift, IE_Released, this, &ARelayDogCharacter::OnRunReleased);
	PlayerInputComponent->BindKey(EKeys::LeftControl, IE_Pressed, this, &ARelayDogCharacter::OnWalkPressed);
	PlayerInputComponent->BindKey(EKeys::LeftControl, IE_Released, this, &ARelayDogCharacter::OnWalkReleased);
	// SPACE IS THE LIVE TERMINAL. THE RELAY DOG DOES NOT JUMP.
	//
	// Founder canon, 2026-08-30: "Wonderland is an AI creation platform wrapped
	// in an open-world gaming interface, not a conventional game with AI bolted
	// onto it." A traversal mechanic that produces nothing outside the world is
	// the wrong thing to spend the most reachable key on; the participant's
	// direct line to their Compound Agent is the right thing.
	//
	// Jump is not merely unbound -- an unbound ability is still reachable from
	// a Blueprint, a gamepad default or a future input mapping, and the world
	// is now audited on the promise that no route needs it. `bCanJump` refuses
	// it at the character.
	PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this,
	                              &ARelayDogCharacter::OnLiveTerminalPressed);

	// A possessed Dog steers with the mouse, so the boom follows the controller
	// rather than the body; the capture demo keeps the body-locked boom.
	if (CameraBoom != nullptr && !bAutoDemo)
	{
		CameraBoom->bUsePawnControlRotation = true;
		CameraBoom->bInheritPitch = true;
		CameraBoom->bInheritYaw = true;
	}
	UE_LOG(LogTemp, Log, TEXT("WLDOG INPUT bound on %s (WASD, mouse, shift=run, ctrl=walk, SPACE=LIVE TERMINAL; the Dog does not jump)"), *GetName());
}

void ARelayDogCharacter::OnLiveTerminalPressed()
{
	// SPACE OPENS THE LIVE TERMINAL, and the participant's terminal lives in
	// the BROWSER, over the Pixel Streaming view -- it is the founder-approved
	// Relay panel, and re-drawing it in UMG would be redrawing an approved
	// design in a second place where it could drift.
	//
	// So the front end intercepts Space before it is forwarded to the game
	// (see wonderland/web/player), and this handler is the guard for the case
	// where a key still arrives: it must do something that is NOT a jump, and
	// it must say so in the log, because "space did nothing" and "space is
	// wired to the terminal" look identical from a video otherwise.
	UE_LOG(LogTemp, Log, TEXT("WLDOG INPUT: SPACE -> live terminal (the front end owns the panel; the Dog does not jump)"));
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

void ARelayDogCharacter::OnForwardPressed()
{
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0f;
	if (Now - LastForwardPressTime <= DoubleTapWindow)
	{
		bDoubleTapRun = true;
	}
	LastForwardPressTime = Now;
	bForwardHeld = true;
}

void ARelayDogCharacter::OnForwardReleased()
{
	bForwardHeld = false;
	// The run ends with the key. A double tap that latched a sprint the player
	// could not stop by letting go would be a trap, not a control.
	bDoubleTapRun = false;
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
	if (FParse::Param(FCommandLine::Get(), TEXT("wlexplore")))
	{
		bAutoDemo = true;
		bExplorationRoute = true;
		UE_LOG(LogTemp, Log, TEXT("WLDOG DEMO: -wlexplore; the Dog tours the district for the world review"));
	}
	SpawnLocation = GetActorLocation();
	SpawnYaw = GetActorRotation().Yaw;
	bJointsBound = BindJoints();
	if (bAutoDemo && bUseDefaultRoute)
	{
		if (bExplorationRoute) BuildExplorationRoute(); else BuildDefaultRoute();
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
			const bool bRunning = bRunHeld || (bDoubleTapRun && bForwardHeld);
			Move->MaxWalkSpeed = bWalkHeld ? WalkSpeedUU : (bRunning ? RunSpeedUU : JogSpeedUU);
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
	// THE TRACE IS THE ONLY PART OF FOOT PLACEMENT THAT NEEDS AN ENGINE, and it
	// is all this class does about it: where the ground is under the place each
	// foot is about to be put. Everything after that -- clamping, easing by
	// half-life, releasing a swinging foot -- lives in the arithmetic, where a
	// staircase can be walked in a test instead of judged from a stream.
	// Measured from last frame's stride positions, which is what the feet were
	// over when the world was last stepped.
	if (const UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		In.bInAir = Move->IsFalling();
	}
	In.VerticalSpeedUU = Velocity.Z;
	In.GroundDeltaLeft = TraceFootGround(Animator.Pose().FootLeft.Forward, LegLeft.LateralUU);
	In.GroundDeltaRight = TraceFootGround(Animator.Pose().FootRight.Forward, LegRight.LateralUU);

	const RelayDogStride::FDogPose& Pose = Animator.Update(In);

	// THE POSE IS ALREADY BLENDED. FDogAnimator multiplies the solved leg
	// angles by the gait weight before returning them, so weighting them again
	// here would square the blend and leave the Dog half-striding through every
	// start and stop.
	const RelayDogStride::FLegPose& SolvedL = Pose.LegLeft;
	const RelayDogStride::FLegPose& SolvedR = Pose.LegRight;

	// ------------------------------------------------------------- the writing
	//
	// UE's pitch about Y takes a limb's downward axis toward +X, so a POSITIVE
	// pitch swings a hanging limb FORWARD — the same sign the arithmetic uses.
	// The knee and elbow are children of their limb, so their angles are
	// relative and the chain composes on its own.
	if (BodyRoot != nullptr)
	{
		BodyRoot->SetRelativeLocation(BodyRestLocation + FVector(0.0f, Pose.SwayUU, Pose.BobUU - Pose.PelvisDropUU));
		BodyRoot->SetRelativeRotation(FRotator(Pose.LeanDeg + Pose.Body.PitchDeg, Pose.BodyYawDeg,
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
	if (LegLeft.Hip != nullptr) LegLeft.Hip->SetRelativeRotation(FRotator(SolvedL.HipDeg, 0.0f, 0.0f));
	if (LegLeft.Shin != nullptr) LegLeft.Shin->SetRelativeRotation(FRotator(-SolvedL.KneeDeg, 0.0f, 0.0f));
	if (LegRight.Hip != nullptr) LegRight.Hip->SetRelativeRotation(FRotator(SolvedR.HipDeg, 0.0f, 0.0f));
	if (LegRight.Shin != nullptr) LegRight.Shin->SetRelativeRotation(FRotator(-SolvedR.KneeDeg, 0.0f, 0.0f));

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

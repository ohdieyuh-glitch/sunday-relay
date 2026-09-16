#include "RelayDogCharacter.h"

#include "Camera/CameraComponent.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "CollisionQueryParams.h"
#include "Components/CapsuleComponent.h"
#include "Components/InputComponent.h"
#include "GameFramework/PlayerInput.h"
#include "Components/SceneComponent.h"
#include "Engine/EngineBaseTypes.h"
#include "Engine/EngineTypes.h"
#include "Engine/World.h"
#include "InputCoreTypes.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"
#include "HAL/IConsoleManager.h"
#include "EngineUtils.h"
#include "Engine/Engine.h"

// THE READING POSE, TUNABLE LIVE. Named, not anonymous: the module is one unity translation unit.
namespace RelayDogReadTuning
{
	TAutoConsoleVariable<float> CVarBookFwd(TEXT("wl.Dog.Read.BookFwd"), 42.0f, TEXT("The open book's spine, forward of the body centre, in head-width sixtieths."));
	TAutoConsoleVariable<float> CVarBookRight(TEXT("wl.Dog.Read.BookRight"), 0.0f, TEXT("The open book's spine, right of the body centre."));
	TAutoConsoleVariable<float> CVarBookUp(TEXT("wl.Dog.Read.BookUp"), -6.0f, TEXT("The open book's spine, above the body centre."));
	TAutoConsoleVariable<float> CVarBookTilt(TEXT("wl.Dog.Read.BookTilt"), 38.0f, TEXT("Degrees the far edge of the book is raised, turning the pages toward the Dog's face."));
	TAutoConsoleVariable<float> CVarBookOpen(TEXT("wl.Dog.Read.BookOpen"), 28.0f, TEXT("Degrees each half of the open book rises from flat."));
	TAutoConsoleVariable<float> CVarBookScale(TEXT("wl.Dog.Read.BookScale"), 1.3f, TEXT("Size of the open book and its turning page."));
	TAutoConsoleVariable<float> CVarLeafCurl(TEXT("wl.Dog.Read.LeafCurl"), 40.0f, TEXT("Degrees the outer half of a turning page trails its inner half at mid-turn."));
	TAutoConsoleVariable<float> CVarLeafGlow(TEXT("wl.Dog.Read.LeafGlow"), 3.0f, TEXT("Brightness of the turning page, as a fraction of the Dog's glow exposure."));
	TAutoConsoleVariable<float> CVarHoldPitch(TEXT("wl.Dog.Read.HoldPitch"), 62.0f, TEXT("Holding (left) arm: shoulder pitch forward."));
	TAutoConsoleVariable<float> CVarHoldRoll(TEXT("wl.Dog.Read.HoldRoll"), 14.0f, TEXT("Holding arm: shoulder roll outward."));
	TAutoConsoleVariable<float> CVarHoldElbow(TEXT("wl.Dog.Read.HoldElbow"), 48.0f, TEXT("Holding arm: elbow bend."));
	TAutoConsoleVariable<float> CVarTurnPitch(TEXT("wl.Dog.Read.TurnPitch"), 58.0f, TEXT("Turning (right) arm at rest: shoulder pitch forward."));
	TAutoConsoleVariable<float> CVarTurnRoll(TEXT("wl.Dog.Read.TurnRoll"), 16.0f, TEXT("Turning arm at rest: shoulder roll outward."));
	TAutoConsoleVariable<float> CVarTurnElbow(TEXT("wl.Dog.Read.TurnElbow"), 44.0f, TEXT("Turning arm at rest: elbow bend."));
	TAutoConsoleVariable<float> CVarSweepRoll(TEXT("wl.Dog.Read.SweepRoll"), -34.0f, TEXT("Turning arm: roll carried across the book with the page."));
	TAutoConsoleVariable<float> CVarSweepPitch(TEXT("wl.Dog.Read.SweepPitch"), 12.0f, TEXT("Turning arm: pitch added at mid-turn, lifting the page."));
	TAutoConsoleVariable<float> CVarSweepElbow(TEXT("wl.Dog.Read.SweepElbow"), 18.0f, TEXT("Turning arm: elbow added at mid-turn."));
	TAutoConsoleVariable<float> CVarReadHeadPitch(TEXT("wl.Dog.Read.HeadPitch"), 22.0f, TEXT("Head pitch while reading, degrees down toward the book."));
	TAutoConsoleVariable<float> CVarTurnHz(TEXT("wl.Dog.Read.TurnHz"), 0.32f, TEXT("Page turns per second."));
	TAutoConsoleVariable<float> CVarTurnFraction(TEXT("wl.Dog.Read.TurnFraction"), 0.42f, TEXT("Fraction of each turn cycle the page is moving."));

	RelayDogMission::FReadingPose Pose()
	{
		RelayDogMission::FReadingPose P;
		P.HoldPitchDeg = CVarHoldPitch.GetValueOnGameThread();
		P.HoldRollDeg = CVarHoldRoll.GetValueOnGameThread();
		P.HoldElbowDeg = CVarHoldElbow.GetValueOnGameThread();
		P.TurnPitchDeg = CVarTurnPitch.GetValueOnGameThread();
		P.TurnRollDeg = CVarTurnRoll.GetValueOnGameThread();
		P.TurnElbowDeg = CVarTurnElbow.GetValueOnGameThread();
		P.SweepRollDeg = CVarSweepRoll.GetValueOnGameThread();
		P.SweepPitchDeg = CVarSweepPitch.GetValueOnGameThread();
		P.SweepElbowDeg = CVarSweepElbow.GetValueOnGameThread();
		P.HeadPitchDeg = CVarReadHeadPitch.GetValueOnGameThread();
		P.TurnHz = CVarTurnHz.GetValueOnGameThread();
		P.TurnFraction = CVarTurnFraction.GetValueOnGameThread();
		return P;
	}

	/** Page width and spine length of one half, and the thickness of a cover and of a page block. */
	const double HalfWidth = 26.0;
	const double SpineLength = 34.0;
	const double CoverThick = 2.5;
	const double PageThick = 5.0;

	/** A box lying in a half of the book: `Angle` degrees up from flat on the right (+Y), rotated about the spine. */
	FTransform HalfBox(double AngleDeg, double AlongY, double OffNormal, const FVector& Size, double U)
	{
		const double A = FMath::DegreesToRadians(AngleDeg);
		const FVector Along(0.0, FMath::Cos(A), FMath::Sin(A));
		const FVector Normal(0.0, -FMath::Sin(A), FMath::Cos(A));
		// NEGATIVE ROLL CARRIES +Y UP TOWARD +Z on this rig (measured on the forearms, 2026-09-16: roll -75 put the
		// right vector at +96.6 Z), so a box turned by -Angle lies along `Along` with its face along `Normal`.
		return FTransform(FRotator(0.0, 0.0, -AngleDeg), (Along * AlongY + Normal * OffNormal) * U, Size * (U / 100.0));
	}
}

namespace
{
	// THE MISSION PROPS ARE BUILT, NOT IMPORTED. Engine content only, exactly as the Mission Contract is
	// built (WonderlandMissionOrb.cpp): a book and a paintbrush assembled from the engine cube, in the
	// Dog's own voxel language. Nothing comes from the world's Content, so a prop can never be a missing
	// asset in someone's checkout, and there is no placeholder standing in for art that ought to exist.
	const TCHAR* const DogPropLitParent = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
	const TCHAR* const DogPropGlowParent = TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");
	const TCHAR* const DogPropCubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
	/** A BEAM IS ROUND. Built from the cube, the beam was a rectangular bar 86 uu wide over a 420 uu run --
	 *  wider than the Dog's head and reading as a wall crossing the frame rather than a link between two
	 *  things. The engine cylinder is 100 uu across and 100 tall on Z, so an instance pitched 90 degrees
	 *  lays its axis along X and the component's X scale becomes the beam's length. */
	const TCHAR* const DogPropCylinderPath = TEXT("/Engine/BasicShapes/Cylinder.Cylinder");

	/**
	 * WHAT AN UNLIT COLOUR HAS TO BE MULTIPLIED BY TO BE SEEN AT ALL.
	 *
	 * LevelColorationUnlitMaterial emits exactly what is set on it, and Wonderland runs physically-based
	 * daylight exposure, so a colour of about 1.0 is BLACK on screen -- not dim, black. Measured by
	 * kaisi-92 on 2026-09-15 while building the companions: x1, x30 and x300 all read as black, it begins
	 * to read at about x3000, and x4000 is comfortable. The Mission Contract's own glow uses the same
	 * figure, so a glowing thing on the Dog and a glowing thing on the crystal sit at one exposure.
	 *
	 * THIS COST FOUR PASSES. The verification beam was geometrically perfect and rendered a black slab,
	 * which read as an artifact rather than as the beam; widening it only made the black slab wider, and
	 * a colour-counting check saw FEWER cyan pixels as it grew. Magnitude, not thickness and not framing.
	 */
	const float DogGlowExposure = 4000.0f;

	/** The engine cube is 100 uu on a side, so a box is a scale of size/100 about a centre. */
	FTransform DogPropBox(const FVector& Centre, const FVector& SizeUU, const FRotator& Turn = FRotator::ZeroRotator)
	{
		return FTransform(Turn, Centre, SizeUU / 100.0);
	}

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
	const TCHAR* const PivotEyeLeft = TEXT("Pivot_eyeLeft");
	const TCHAR* const PivotEyeRight = TEXT("Pivot_eyeRight");

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
		// THE JUMP IS THE PLAYER'S AGAIN (founder, 2026-09-03). These were
		// kept for falls off a step and are now what a real jump uses.
		Move->JumpZVelocity = 420.0f;
		Move->AirControl = 0.35f;
	}
	// AND THE ABILITY IS ALLOWED AGAIN -- ONCE.
	//
	// This reverses the 2026-08-30 canon, on the founder's instruction, and the
	// old reasoning is worth keeping because it says what to re-check. Jump was
	// refused rather than merely unbound (`JumpMaxCount = 0`) so that no
	// Blueprint, gamepad default or later input mapping could reach it, on the
	// promise that "no route anywhere needs a jump". THAT PROMISE STILL HOLDS
	// and is still audited: the 242 solved route legs are walked, and
	// `route.py` has no notion of jumping, so a leg that needs one is still a
	// world defect rather than something the participant is expected to hop
	// over. What changed is that the participant may now jump because jumping
	// is a thing a body does, not because the world requires it.
	//
	// ONE, not two: JumpMaxCount 1 refuses a double jump, which nothing in
	// Wonderland's movement vocabulary has ever had.
	JumpMaxCount = 1;
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
	// THE EYES ARE OPTIONAL, unlike every limb below. They were generated as joints later than the rest,
	// so a Dog built by an older dog_v2 has none -- and a Compound Agent that cannot blink should still
	// walk. Missing eyes are said once, at Verbose, rather than failing the bind.
	EyeLeftPivot = FindPivot(this, PivotEyeLeft);
	EyeRightPivot = FindPivot(this, PivotEyeRight);
	if (EyeLeftPivot == nullptr || EyeRightPivot == nullptr)
	{
		UE_LOG(LogTemp, Verbose, TEXT("WLDOG no eye pivots (%s/%s); Julius will not blink"),
			PivotEyeLeft, PivotEyeRight);
	}
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
	// Golden Arrival, the castle corridor, the garden quarter, a GROVE and a
	// WATER GARDEN, the mushroom wood, the clock quarter, the hamlet, and
	// home. The grove and the water garden are there because the proof has to
	// cross every surface family the step-height contract governs -- without
	// them the traversal never touches a grove path or a water walk, and
	// would not prove the fix for either. Sixty quarters over a
	// 720 m world is past the point where waypoints can be typed by hand.
	// Two hand-placed ones have already been found inside planting -- one in
	// a hedge, one at a fountain -- and each cost a capture, because a leg
	// that cannot be reached films leaves until its budget runs out.
	//
	// These legs are GENERATED by wonderland/v2/tools/route.py against the
	// same obstacle model walkable.py audits with, at a 60 uu capsule --
	// 1.76x the Dog's own 34 uu radius. 80 was tried and is more
	// conservative than the world affords: the hamlet's parterre cross walk
	// takes a 1.2 m walker and not a 1.6 m one, and refusing the route over
	// that would have been changing the world to suit the solver.
	// Regenerate after any layout change:
	//
	//     python3 wonderland/v2/tools/route.py --capsule=60 --cpp
	//
	// REGENERATED 2026-09-03, and the reason is the whole point of generating
	// them. The solver's obstacle model could not describe a THRESHOLD -- one
	// axis-aligned rectangle per asset can either block a gatehouse's 5.2 m
	// arch or miss its piers entirely -- so `route.py` declared gatehouses
	// SOFT and drew legs straight through them. That is fail-open, and the
	// first real-GPU traversal of this world found it: the Dog wedged inside
	// `DPClockQuarter_Gatehouse`'s wall at (14143, 1086) and failed leg after
	// leg from identical coordinates, so the route never finished. The world
	// was not at fault and neither was the Dog; the MAP THE SOLVER READ was.
	// `layout_v2.FOOT_PARTS` now says piers block and spans do not, and these
	// legs below are the solve against that. 262 -> 242 because a route that
	// goes around a gate it used to walk through is a different route, and
	// 242 -> 196 after the district cameras got built near fields: the solve
	// prefers open ground, so changing what is solid changes which corridor is
	// open, and the tour is 2,322 m against a 1,087 m straight-line lower
	// bound over the same twelve stops. Shorter is not suspicious here; the
	// authority is the in-game run, not the length.
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
	Add(-150.0f, -1550.0f, 150.0f, 0.0f, TEXT(""));
	Add(50.0f, -150.0f, 150.0f, 0.0f, TEXT(""));
	Add(50.0f, 550.0f, 150.0f, 1.5f, TEXT("back in, across the plaza"));
	Add(-50.0f, 1450.0f, 300.0f, 0.0f, TEXT(""));
	Add(-50.0f, 2550.0f, 300.0f, 0.0f, TEXT(""));
	Add(-50.0f, 3650.0f, 300.0f, 0.0f, TEXT(""));
	Add(-50.0f, 4750.0f, 300.0f, 0.0f, TEXT(""));
	Add(-1150.0f, 5150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-1150.0f, 5550.0f, 300.0f, 0.0f, TEXT(""));
	Add(-350.0f, 6250.0f, 300.0f, 0.0f, TEXT(""));
	Add(-250.0f, 5950.0f, 300.0f, 1.0f, TEXT("the fountain court"));
	Add(50.0f, 6950.0f, 300.0f, 0.0f, TEXT(""));
	Add(50.0f, 8250.0f, 300.0f, 3.0f, TEXT("the castle front, look up"));
	Add(1250.0f, 8250.0f, 330.0f, 0.0f, TEXT(""));
	Add(2650.0f, 8050.0f, 330.0f, 0.0f, TEXT(""));
	Add(3450.0f, 8450.0f, 330.0f, 0.0f, TEXT(""));
	Add(3750.0f, 9050.0f, 330.0f, 0.0f, TEXT(""));
	Add(4450.0f, 9450.0f, 330.0f, 2.5f, TEXT("the garden quarter"));
	Add(3550.0f, 8950.0f, 330.0f, 0.0f, TEXT(""));
	Add(2550.0f, 8150.0f, 330.0f, 0.0f, TEXT(""));
	Add(1250.0f, 8250.0f, 330.0f, 0.0f, TEXT(""));
	Add(-50.0f, 8150.0f, 330.0f, 0.0f, TEXT(""));
	Add(-750.0f, 8950.0f, 330.0f, 0.0f, TEXT(""));
	Add(-850.0f, 8850.0f, 330.0f, 0.0f, TEXT(""));
	Add(-2550.0f, 8850.0f, 330.0f, 0.0f, TEXT(""));
	Add(-2850.0f, 8650.0f, 330.0f, 0.0f, TEXT(""));
	Add(-3850.0f, 9050.0f, 330.0f, 0.0f, TEXT(""));
	Add(-4650.0f, 8950.0f, 330.0f, 0.0f, TEXT(""));
	Add(-4650.0f, 8950.0f, 330.0f, 2.0f, TEXT("the grove"));
	Add(-4050.0f, 8850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-2850.0f, 8650.0f, 420.0f, 0.0f, TEXT(""));
	Add(-2350.0f, 8850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-750.0f, 8950.0f, 420.0f, 0.0f, TEXT(""));
	Add(-250.0f, 8450.0f, 420.0f, 0.0f, TEXT(""));
	Add(250.0f, 7350.0f, 420.0f, 0.0f, TEXT(""));
	Add(50.0f, 6450.0f, 420.0f, 0.0f, TEXT(""));
	Add(1150.0f, 5550.0f, 420.0f, 0.0f, TEXT(""));
	Add(1250.0f, 4350.0f, 420.0f, 0.0f, TEXT(""));
	Add(1550.0f, 4050.0f, 420.0f, 0.0f, TEXT(""));
	Add(1950.0f, 4150.0f, 420.0f, 0.0f, TEXT(""));
	Add(2950.0f, 4050.0f, 420.0f, 0.0f, TEXT(""));
	Add(3650.0f, 3150.0f, 420.0f, 0.0f, TEXT(""));
	Add(4450.0f, 2250.0f, 420.0f, 0.0f, TEXT(""));
	Add(5450.0f, 2250.0f, 420.0f, 0.0f, TEXT(""));
	Add(6450.0f, 1650.0f, 420.0f, 0.0f, TEXT(""));
	Add(6350.0f, 1250.0f, 420.0f, 0.0f, TEXT(""));
	Add(6750.0f, 450.0f, 420.0f, 0.0f, TEXT(""));
	Add(6150.0f, -850.0f, 420.0f, 0.0f, TEXT(""));
	Add(5250.0f, -950.0f, 420.0f, 0.0f, TEXT(""));
	Add(4750.0f, -2050.0f, 420.0f, 0.0f, TEXT(""));
	Add(4150.0f, -2850.0f, 420.0f, 0.0f, TEXT(""));
	Add(4550.0f, -5150.0f, 420.0f, 0.0f, TEXT(""));
	Add(4450.0f, -6950.0f, 420.0f, 0.0f, TEXT(""));
	Add(2150.0f, -6350.0f, 420.0f, 0.0f, TEXT(""));
	Add(450.0f, -7250.0f, 420.0f, 0.0f, TEXT(""));
	Add(50.0f, -8150.0f, 420.0f, 0.0f, TEXT(""));
	Add(750.0f, -9450.0f, 420.0f, 0.0f, TEXT(""));
	Add(1450.0f, -10150.0f, 420.0f, 0.0f, TEXT(""));
	Add(1750.0f, -11250.0f, 420.0f, 0.0f, TEXT(""));
	Add(950.0f, -12150.0f, 420.0f, 0.0f, TEXT(""));
	Add(50.0f, -12950.0f, 420.0f, 0.0f, TEXT(""));
	Add(-1150.0f, -11950.0f, 420.0f, 0.0f, TEXT(""));
	Add(-2150.0f, -11250.0f, 420.0f, 0.0f, TEXT(""));
	Add(-2350.0f, -11550.0f, 420.0f, 2.0f, TEXT("the water garden"));
	Add(-1450.0f, -11450.0f, 420.0f, 0.0f, TEXT(""));
	Add(-450.0f, -12450.0f, 420.0f, 0.0f, TEXT(""));
	Add(250.0f, -12950.0f, 420.0f, 0.0f, TEXT(""));
	Add(1750.0f, -11250.0f, 420.0f, 0.0f, TEXT(""));
	Add(2050.0f, -10650.0f, 420.0f, 0.0f, TEXT(""));
	Add(3550.0f, -9950.0f, 420.0f, 0.0f, TEXT(""));
	Add(4750.0f, -9650.0f, 420.0f, 0.0f, TEXT(""));
	Add(5650.0f, -9750.0f, 420.0f, 0.0f, TEXT(""));
	Add(6050.0f, -10850.0f, 420.0f, 2.5f, TEXT("the mushroom wood"));
	Add(6950.0f, -11050.0f, 420.0f, 0.0f, TEXT(""));
	Add(8150.0f, -11350.0f, 420.0f, 0.0f, TEXT(""));
	Add(8850.0f, -10950.0f, 420.0f, 0.0f, TEXT(""));
	Add(9850.0f, -10750.0f, 420.0f, 0.0f, TEXT(""));
	Add(9950.0f, -10350.0f, 420.0f, 0.0f, TEXT(""));
	Add(9850.0f, -9250.0f, 420.0f, 0.0f, TEXT(""));
	Add(10850.0f, -8950.0f, 420.0f, 0.0f, TEXT(""));
	Add(12350.0f, -8650.0f, 420.0f, 0.0f, TEXT(""));
	Add(13450.0f, -9150.0f, 420.0f, 0.0f, TEXT(""));
	Add(14450.0f, -9050.0f, 420.0f, 0.0f, TEXT(""));
	Add(15450.0f, -8250.0f, 420.0f, 0.0f, TEXT(""));
	Add(15150.0f, -7450.0f, 420.0f, 0.0f, TEXT(""));
	Add(14050.0f, -6550.0f, 420.0f, 0.0f, TEXT(""));
	Add(13350.0f, -5350.0f, 420.0f, 0.0f, TEXT(""));
	Add(12350.0f, -4250.0f, 420.0f, 0.0f, TEXT(""));
	Add(12150.0f, -3750.0f, 420.0f, 2.5f, TEXT("the clock quarter"));
	Add(12450.0f, -2750.0f, 420.0f, 0.0f, TEXT(""));
	Add(12650.0f, -1650.0f, 420.0f, 0.0f, TEXT(""));
	Add(13050.0f, -50.0f, 420.0f, 0.0f, TEXT(""));
	Add(12250.0f, 1050.0f, 420.0f, 0.0f, TEXT(""));
	Add(12450.0f, 1750.0f, 420.0f, 0.0f, TEXT(""));
	Add(13550.0f, 1950.0f, 420.0f, 0.0f, TEXT(""));
	Add(14550.0f, 3150.0f, 420.0f, 0.0f, TEXT(""));
	Add(16350.0f, 3450.0f, 420.0f, 0.0f, TEXT(""));
	Add(16850.0f, 3750.0f, 420.0f, 0.0f, TEXT(""));
	Add(18650.0f, 4050.0f, 420.0f, 0.0f, TEXT(""));
	Add(19250.0f, 5050.0f, 420.0f, 0.0f, TEXT(""));
	Add(21050.0f, 5650.0f, 420.0f, 0.0f, TEXT(""));
	Add(22450.0f, 5450.0f, 420.0f, 0.0f, TEXT(""));
	Add(22950.0f, 5950.0f, 420.0f, 0.0f, TEXT(""));
	Add(24150.0f, 7050.0f, 420.0f, 0.0f, TEXT(""));
	Add(25350.0f, 7550.0f, 420.0f, 0.0f, TEXT(""));
	Add(26750.0f, 7950.0f, 420.0f, 0.0f, TEXT(""));
	Add(27350.0f, 8950.0f, 420.0f, 0.0f, TEXT(""));
	Add(27650.0f, 10150.0f, 420.0f, 0.0f, TEXT(""));
	Add(27450.0f, 11450.0f, 420.0f, 0.0f, TEXT(""));
	Add(27250.0f, 12750.0f, 420.0f, 0.0f, TEXT(""));
	Add(25550.0f, 12950.0f, 420.0f, 0.0f, TEXT(""));
	Add(25050.0f, 14350.0f, 420.0f, 0.0f, TEXT(""));
	Add(23850.0f, 15250.0f, 420.0f, 0.0f, TEXT(""));
	Add(22650.0f, 16950.0f, 420.0f, 0.0f, TEXT(""));
	Add(21750.0f, 18850.0f, 420.0f, 0.0f, TEXT(""));
	Add(20850.0f, 19550.0f, 420.0f, 0.0f, TEXT(""));
	Add(19450.0f, 20150.0f, 420.0f, 0.0f, TEXT(""));
	Add(17450.0f, 21150.0f, 420.0f, 0.0f, TEXT(""));
	Add(16850.0f, 22150.0f, 420.0f, 0.0f, TEXT(""));
	Add(17450.0f, 23350.0f, 420.0f, 0.0f, TEXT(""));
	Add(16750.0f, 24650.0f, 420.0f, 0.0f, TEXT(""));
	Add(16950.0f, 25650.0f, 420.0f, 0.0f, TEXT(""));
	Add(17250.0f, 26750.0f, 420.0f, 0.0f, TEXT(""));
	Add(16850.0f, 28150.0f, 420.0f, 0.0f, TEXT(""));
	Add(16550.0f, 28650.0f, 420.0f, 0.0f, TEXT(""));
	Add(14250.0f, 28950.0f, 420.0f, 0.0f, TEXT(""));
	Add(12650.0f, 28850.0f, 420.0f, 0.0f, TEXT(""));
	Add(12550.0f, 29950.0f, 420.0f, 0.0f, TEXT(""));
	Add(11350.0f, 31650.0f, 420.0f, 0.0f, TEXT(""));
	Add(10150.0f, 32450.0f, 420.0f, 0.0f, TEXT(""));
	Add(9150.0f, 31350.0f, 420.0f, 0.0f, TEXT(""));
	Add(7550.0f, 31450.0f, 420.0f, 0.0f, TEXT(""));
	Add(6950.0f, 29450.0f, 420.0f, 0.0f, TEXT(""));
	Add(6050.0f, 29250.0f, 420.0f, 0.0f, TEXT(""));
	Add(4850.0f, 28250.0f, 420.0f, 0.0f, TEXT(""));
	Add(4550.0f, 27150.0f, 420.0f, 0.0f, TEXT(""));
	Add(2950.0f, 27150.0f, 420.0f, 0.0f, TEXT(""));
	Add(1450.0f, 26850.0f, 420.0f, 0.0f, TEXT(""));
	Add(550.0f, 25450.0f, 420.0f, 0.0f, TEXT(""));
	Add(1050.0f, 23950.0f, 420.0f, 0.0f, TEXT(""));
	Add(550.0f, 22850.0f, 420.0f, 0.0f, TEXT(""));
	Add(550.0f, 21850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-50.0f, 20850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-1650.0f, 20250.0f, 420.0f, 0.0f, TEXT(""));
	Add(-2550.0f, 19750.0f, 420.0f, 0.0f, TEXT(""));
	Add(-3850.0f, 18650.0f, 420.0f, 0.0f, TEXT(""));
	Add(-4050.0f, 17350.0f, 420.0f, 0.0f, TEXT(""));
	Add(-4950.0f, 17450.0f, 420.0f, 0.0f, TEXT(""));
	Add(-6350.0f, 17750.0f, 420.0f, 0.0f, TEXT(""));
	Add(-7750.0f, 17350.0f, 420.0f, 0.0f, TEXT(""));
	Add(-8750.0f, 17350.0f, 420.0f, 0.0f, TEXT(""));
	Add(-9650.0f, 17350.0f, 420.0f, 0.0f, TEXT(""));
	Add(-10250.0f, 16850.0f, 420.0f, 0.0f, TEXT(""));
	Add(-10550.0f, 15650.0f, 420.0f, 0.0f, TEXT(""));
	Add(-9850.0f, 13750.0f, 420.0f, 0.0f, TEXT(""));
	Add(-10550.0f, 13450.0f, 420.0f, 0.0f, TEXT(""));
	Add(-11850.0f, 13350.0f, 420.0f, 0.0f, TEXT(""));
	Add(-12250.0f, 11950.0f, 420.0f, 0.0f, TEXT(""));
	Add(-12150.0f, 11250.0f, 420.0f, 0.0f, TEXT(""));
	Add(-12050.0f, 10250.0f, 420.0f, 0.0f, TEXT(""));
	Add(-11550.0f, 10250.0f, 420.0f, 0.0f, TEXT(""));
	Add(-10750.0f, 9950.0f, 420.0f, 0.0f, TEXT(""));
	Add(-11050.0f, 8850.0f, 420.0f, 2.5f, TEXT("the hamlet"));
	Add(-10450.0f, 8750.0f, 300.0f, 0.0f, TEXT(""));
	Add(-10750.0f, 7450.0f, 300.0f, 0.0f, TEXT(""));
	Add(-11250.0f, 7150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-11850.0f, 6250.0f, 300.0f, 0.0f, TEXT(""));
	Add(-12550.0f, 4850.0f, 300.0f, 0.0f, TEXT(""));
	Add(-13150.0f, 4150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-14450.0f, 2850.0f, 300.0f, 0.0f, TEXT(""));
	Add(-15350.0f, 2750.0f, 300.0f, 0.0f, TEXT(""));
	Add(-16450.0f, 2450.0f, 300.0f, 0.0f, TEXT(""));
	Add(-16550.0f, 950.0f, 300.0f, 0.0f, TEXT(""));
	Add(-17450.0f, -350.0f, 300.0f, 0.0f, TEXT(""));
	Add(-17950.0f, -1550.0f, 300.0f, 0.0f, TEXT(""));
	Add(-17250.0f, -1950.0f, 300.0f, 0.0f, TEXT(""));
	Add(-15750.0f, -2650.0f, 300.0f, 0.0f, TEXT(""));
	Add(-14350.0f, -2850.0f, 300.0f, 0.0f, TEXT(""));
	Add(-13950.0f, -4150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-12950.0f, -4350.0f, 300.0f, 0.0f, TEXT(""));
	Add(-12350.0f, -4350.0f, 300.0f, 0.0f, TEXT(""));
	Add(-12250.0f, -4050.0f, 300.0f, 0.0f, TEXT(""));
	Add(-11950.0f, -2950.0f, 300.0f, 0.0f, TEXT(""));
	Add(-10550.0f, -2150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-8950.0f, -2350.0f, 300.0f, 0.0f, TEXT(""));
	Add(-8450.0f, -1150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-7250.0f, -1150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-6350.0f, -850.0f, 300.0f, 0.0f, TEXT(""));
	Add(-5450.0f, -1150.0f, 300.0f, 0.0f, TEXT(""));
	Add(-4450.0f, -1350.0f, 300.0f, 0.0f, TEXT(""));
	Add(-3850.0f, -1250.0f, 300.0f, 0.0f, TEXT(""));
	Add(-2150.0f, -1250.0f, 300.0f, 0.0f, TEXT(""));
	Add(-1750.0f, -1550.0f, 300.0f, 0.0f, TEXT(""));
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
	// A BUDGET PROPORTIONAL TO THE LEG, NOT A FLAT 25 SECONDS.
	//
	// The flat budget was written when the route was 95 short legs. The
	// clearance-preferring solve takes the long way round -- 82 legs over
	// 2,240 m, some of them 40 m across open country -- and a Dog that
	// achieves half its nominal speed over rough ground then runs out of
	// budget on a leg that is not obstructed at all. Measured: 2,777 uu
	// short of a target it had 25 s and 330 uu/s to reach, having covered
	// about 68 uu/s across ground that climbs 93 uu.
	//
	// Three times the honest travel time, plus the hold and a floor. A leg
	// that cannot be reached still gives up; it is no longer the LENGTH of a
	// leg that decides.
	const float LegTravel = (Leg.SpeedUU > 1.0f)
	        ? FVector::Dist2D(Here, Leg.Target) / Leg.SpeedUU : 0.0f;
	const float LegBudget = FMath::Max(12.0f, Leg.HoldSeconds + 10.0f + 3.0f * LegTravel);
	// SIX ATTEMPTS IS THE RECOVERY SAYING IT CANNOT. Where one side is open the
	// sweep finds it on the first or second try; a corner that has defeated six
	// swept attempts is not going to yield to a seventh, and grinding there
	// spends the whole leg budget and then the NEXT leg's -- measured at 111
	// fires on one leg. Abandoning early costs the same single leg and gives
	// the rest of the route its time back.
	if (LegSeconds > LegBudget || UnstickTries >= 6)
	{
		// WHERE IT GAVE UP, NOT JUST HOW FAR SHORT.
		//
		// The shortfall alone sent two rebuilds chasing the wrong obstacle:
		// it says the distance to a target and nothing about which side of
		// what the Dog is standing on. A stuck Dog is a WORLD defect at a
		// COORDINATE, and without the coordinate the only way to find it is
		// to guess from the route and check the guess with a 30-minute
		// build.
		UE_LOG(LogTemp, Warning,
		       TEXT("WLDOG ROUTE: gave up on leg %d/%d '%s' after %.0f s at (%.0f, %.0f, %.0f) "
		            "-- target (%.0f, %.0f), %.0f uu short -- moving on"),
		       RouteIndex + 1, Route.Num(), *Leg.Label, LegSeconds,
		       Here.X, Here.Y, Here.Z, Leg.Target.X, Leg.Target.Y,
		       FVector::Dist2D(Here, Leg.Target));
		RouteIndex = (RouteIndex + 1) % Route.Num();
		RouteHold = 0.0f;
		LegSeconds = 0.0f;
		// a new leg starts with a clean stuck record, or the anchor from the
		// abandoned one makes the next leg look stuck the instant it begins
		StuckAnchor = Here;
		StuckSeconds = 0.0f;
		UnstickSeconds = 0.0f;
		UnstickTries = 0;
		return FVector::ZeroVector;
	}
	FVector ToTarget = Leg.Target - Here;
	ToTarget.Z = 0.0f;
	const float Distance = ToTarget.Size();

	// ---- STUCK ON THE WORLD, AND GETTING OFF IT ---------------------------
	//
	// A leg drives straight at its target. Where the body grazes geometry the
	// capsule slides along it and stops dead, and because nothing ever moves
	// the Dog off what it is caught on, EVERY following leg fails from the
	// identical coordinate. That is what the log looked like on 2026-09-03:
	// seventeen legs abandoned from one spot between two fused trees, then --
	// after the map was corrected -- twelve more from inside a garden wall's
	// footprint at (-7781, -940).
	//
	// FIXING THE MAP WAS NECESSARY AND IS NOT SUFFICIENT. `FOOT_PARTS` taught
	// the solver what a gate is and the route stopped being drawn through
	// masonry; the Dog still has momentum, still slides along a wall it
	// clipped, and a plan-view solve will always call some corner passable
	// that a body with width cannot round cleanly. So the recovery belongs
	// here, in the body, not in the map.
	//
	// It is deliberately the smallest thing that works: notice that the Dog
	// has barely moved while being ASKED to move, then push PERPENDICULAR to
	// the target for a moment. Sideways rather than backwards, because what
	// traps a capsule is a surface it is pressed flat against -- reversing
	// re-approaches the same face at the same angle, while a step along the
	// face slides out of the corner. The side alternates each time so a
	// symmetric trap cannot hold it by pushing it back and forth forever.
	if (UnstickSeconds > 0.0f)
	{
		UnstickSeconds -= DeltaSeconds;
		const FVector Side = FVector::CrossProduct(FVector::UpVector,
		                                           ToTarget.GetSafeNormal());
		// A LITTLE FORWARD TOO. Pure sideways can walk along a wall forever
		// without ever leaving it; the bias keeps the intent of the leg.
		return (Side * UnstickSign + ToTarget.GetSafeNormal() * 0.35f)
		       .GetSafeNormal() * FMath::Max(180.0f, Leg.SpeedUU * 0.6f);
	}
	if (Leg.SpeedUU > 1.0f && Distance > FMath::Max(20.0f, Leg.SpeedUU * 0.12f))
	{
		// Progress is measured against an ANCHOR rather than the last frame:
		// a Dog pressed into a wall still jitters a few uu per frame, and a
		// per-frame test reads that as movement forever.
		if (FVector::Dist2D(Here, StuckAnchor) > 60.0f)
		{
			StuckAnchor = Here;
			StuckSeconds = 0.0f;
		}
		else
		{
			StuckSeconds += DeltaSeconds;
			if (StuckSeconds > 1.5f)
			{
				// WHICH WAY IS OPEN, ASKED RATHER THAN ALTERNATED.
				//
				// The first version simply flipped sides each time. It works
				// where one side is free -- measured at leg 20, where a step
				// right failed, a step left freed the Dog and the leg
				// completed -- and it THRASHES in a concave corner, where both
				// perpendiculars lead back into the same surface: 111 fires at
				// leg 189 against `Q05_clockyard_Wall8`, oscillating between
				// two points 116 uu apart and never leaving.
				//
				// So the two directions are SWEPT with the Dog's own capsule
				// and the roomier one is taken. A blind flip has no way to
				// tell an open side from a wall; a sweep does, and it costs
				// two traces on a frame that is already stuck.
				const FVector Fwd = ToTarget.GetSafeNormal();
				const FVector Side = FVector::CrossProduct(FVector::UpVector, Fwd);
				const float Probe = 220.0f;
				float Room[2] = { 0.0f, 0.0f };
				const UCapsuleComponent* Cap = GetCapsuleComponent();
				const UWorld* W = GetWorld();
				if (W != nullptr && Cap != nullptr)
				{
					FCollisionQueryParams P(FName(TEXT("RelayDogUnstick")), false, this);
					const FCollisionShape Shape = FCollisionShape::MakeCapsule(
						Cap->GetScaledCapsuleRadius() * 0.9f,
						Cap->GetScaledCapsuleHalfHeight() * 0.9f);
					for (int32 s = 0; s < 2; ++s)
					{
						const FVector Dir = (s == 0) ? Side : -Side;
						FHitResult Hit;
						const bool bBlocked = W->SweepSingleByChannel(
							Hit, Here, Here + Dir * Probe, FQuat::Identity,
							ECC_Pawn, Shape, P);
						Room[s] = bBlocked ? (Hit.Distance) : Probe;
					}
				}
				// Ties and a world we cannot trace both fall back to
				// alternating, which is still better than always picking the
				// same wall.
				if (Room[0] > Room[1] + 10.0f)       UnstickSign = 1.0f;
				else if (Room[1] > Room[0] + 10.0f)  UnstickSign = -1.0f;
				else                                 UnstickSign = -UnstickSign;
				UnstickSeconds = 0.6f;
				StuckSeconds = 0.0f;
				StuckAnchor = Here;
				++UnstickTries;
				UE_LOG(LogTemp, Log,
				       TEXT("WLDOG UNSTICK: leg %d/%d, no progress for 1.5 s at "
				            "(%.0f, %.0f) -- room L %.0f R %.0f, stepping %s for 0.6 s"),
				       RouteIndex + 1, Route.Num(), Here.X, Here.Y,
				       Room[0], Room[1],
				       UnstickSign > 0.0f ? TEXT("left") : TEXT("right"));
			}
		}
	}
	else
	{
		StuckAnchor = Here;
		StuckSeconds = 0.0f;
	}

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
			UnstickTries = 0;
			StuckAnchor = Here;
			StuckSeconds = 0.0f;
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
	// game.
	//
	// UE 5.8 RESERVES BindAxisKey FOR ANALOG AXES. FInputAxisKeyBinding now
	// ensures AxisKey.IsAxis1D() (Components/InputComponent.h), and W/S/A/D and
	// the arrows are digital keys, so binding them that way trips an ensure the
	// first time the Dog is possessed (seen in the first 5.8.2 PIE run). The
	// engine's route for a digital key that drives an axis is an axis MAPPING,
	// and an ENGINE-DEFINED mapping is declared here in code -- not in
	// DefaultInput.ini -- so it cooks exactly as reliably as the explicit keys it
	// replaces. Same four handlers, same per-frame values, so opposite keys still
	// cancel and two keys for one direction still clamp to one full input. The
	// mouse axes ARE 1D axes and stay on BindAxisKey.
	static const FName MoveForwardAxisName(TEXT("WLDog_MoveForward"));
	static const FName MoveBackwardAxisName(TEXT("WLDog_MoveBackward"));
	static const FName MoveRightAxisName(TEXT("WLDog_MoveRight"));
	static const FName MoveLeftAxisName(TEXT("WLDog_MoveLeft"));
	static bool bDogAxisMappingsDefined = false;
	if (!bDogAxisMappingsDefined)
	{
		// AddUnique, and it invalidates every live UPlayerInput's key maps, so the
		// mappings apply to a controller that already exists.
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveForwardAxisName, EKeys::W, 1.0f));
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveForwardAxisName, EKeys::Up, 1.0f));
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveBackwardAxisName, EKeys::S, 1.0f));
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveBackwardAxisName, EKeys::Down, 1.0f));
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveRightAxisName, EKeys::D, 1.0f));
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveRightAxisName, EKeys::Right, 1.0f));
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveLeftAxisName, EKeys::A, 1.0f));
		UPlayerInput::AddEngineDefinedAxisMapping(FInputAxisKeyMapping(MoveLeftAxisName, EKeys::Left, 1.0f));
		bDogAxisMappingsDefined = true;
	}
	PlayerInputComponent->BindAxis(MoveForwardAxisName, this, &ARelayDogCharacter::MoveForwardAxis);
	PlayerInputComponent->BindAxis(MoveBackwardAxisName, this, &ARelayDogCharacter::MoveBackwardAxis);
	PlayerInputComponent->BindAxis(MoveRightAxisName, this, &ARelayDogCharacter::MoveRightAxis);
	PlayerInputComponent->BindAxis(MoveLeftAxisName, this, &ARelayDogCharacter::MoveLeftAxis);
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
	// SPACE IS THE JUMP. CTRL+T IS THE LIVE TERMINAL. (founder, 2026-09-03)
	//
	// This replaces the 2026-08-30 arrangement, where Space opened the terminal
	// and the Dog could not jump at all. That reasoning -- "a traversal mechanic
	// that produces nothing outside the world is the wrong thing to spend the
	// most reachable key on" -- was about WHICH key, not about whether the Dog
	// should be able to jump, and the founder has now assigned both: Ctrl+T
	// carries the terminal, Space carries the jump.
	//
	// Bound to ACharacter's own Jump/StopJumping so the hold-to-rise behaviour,
	// the landing and the air control are the engine's, not a reimplementation.
	PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &ACharacter::Jump);
	PlayerInputComponent->BindKey(EKeys::SpaceBar, IE_Released, this, &ACharacter::StopJumping);
	// CTRL+T, both orders of the chord. `BindKey` with an FInputChord matches
	// the modifier, and binding T alone would fire while the participant walks
	// with their hand near it.
	PlayerInputComponent->BindKey(FInputChord(EKeys::T, /*bShift*/ false, /*bCtrl*/ true,
	                                          /*bAlt*/ false, /*bCmd*/ false),
	                              IE_Pressed, this, &ARelayDogCharacter::OnLiveTerminalPressed);

	// A possessed Dog steers with the mouse, so the boom follows the controller
	// rather than the body; the capture demo keeps the body-locked boom.
	if (CameraBoom != nullptr && !bAutoDemo)
	{
		CameraBoom->bUsePawnControlRotation = true;
		CameraBoom->bInheritPitch = true;
		CameraBoom->bInheritYaw = true;
		// AND THE CAMERA STOPS TRAILING THE PLAYER (2026-09-03).
		//
		// The founder reports that walking and running still feel laggy after
		// the renderer was measured at 11.40 ms median and 87.7 fps -- and
		// that report is right, because none of this is a frame-rate problem.
		// The boom is built with `bEnableCameraLag` at speed 8 and
		// `bEnableCameraRotationLag` at speed 7. Those are exponential
		// interpolations: at speed 7 a look input reaches 63% of its travel in
		// about 140 ms and settles around 430 ms. That is FELT AS INPUT
		// LATENCY, it is added on top of the network round trip, and no GPU
		// measurement can see it -- which is exactly why "the GPU is under
		// budget so it is smooth" was the wrong conclusion to reach.
		//
		// The smoothing is right for the CINEMATIC DEMO, where the Dog drives
		// its own route and the lag hides the steering corrections of an
		// auto-pilot. It is wrong for a hand on a mouse. So it is switched off
		// here, inside the branch that already distinguishes the two, and the
		// demo path is untouched.
		CameraBoom->bEnableCameraLag = false;
		CameraBoom->bEnableCameraRotationLag = false;
	}
	UE_LOG(LogTemp, Log, TEXT("WLDOG INPUT bound on %s (WASD, mouse, shift=run, ctrl=walk, SPACE=JUMP, CTRL+T=LIVE TERMINAL)"), *GetName());
}

void ARelayDogCharacter::OnLiveTerminalPressed()
{
	// CTRL+T OPENS THE LIVE TERMINAL, and the participant's terminal lives in
	// the BROWSER, over the Pixel Streaming view -- it is the founder-approved
	// Relay panel, and re-drawing it in UMG would be redrawing an approved
	// design in a second place where it could drift.
	//
	// So the front end intercepts Ctrl+T before it is forwarded to the game
	// (see wonderland/web/player/keys.js), and this handler is the guard for
	// the case where the chord still arrives -- a gamepad, a resumed session, a
	// client that binds its own listener. It must say so in the log, because
	// "the chord did nothing" and "the chord is wired to the terminal" look
	// identical from a video otherwise.
	//
	// It must also NOT be a jump. Space is the jump now, and if these two ever
	// end up on the same key again this log line is how it will be noticed.
	UE_LOG(LogTemp, Log, TEXT("WLDOG INPUT: CTRL+T -> live terminal (the front end owns the panel)"));
}

void ARelayDogCharacter::MoveForwardAxis(float Value)
{
	if (Value == 0.0f || Controller == nullptr || bAutoDemo) return;
	// A PERFORMANCE NEVER FIGHTS THE STICK. Noted here rather than inferred from velocity, because a Dog
	// pressed against a wall has input and no speed, and the orbit must stand down for that too.
	bPlayerDroveThisFrame = true;
	const FRotator YawOnly(0.0f, Controller->GetControlRotation().Yaw, 0.0f);
	AddMovementInput(FRotationMatrix(YawOnly).GetUnitAxis(EAxis::X), Value);
}

void ARelayDogCharacter::MoveBackwardAxis(float Value) { MoveForwardAxis(-Value); }

void ARelayDogCharacter::MoveRightAxis(float Value)
{
	if (Value == 0.0f || Controller == nullptr || bAutoDemo) return;
	bPlayerDroveThisFrame = true;
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

float ARelayDogCharacter::EyeScaleAt(float TimeSeconds) const
{
	const float Period = FMath::Max(BlinkPeriodSeconds, 0.25f);
	const float Close = FMath::Max(BlinkCloseSeconds, 0.02f);

	// Which blink window we are in, and where inside it. Both from the clock, so nothing accumulates.
	const float Index = FMath::FloorToFloat(TimeSeconds / Period);
	const float Cycle = TimeSeconds - Index * Period;

	// A deterministic hash of the window index, 0..1. The same second always produces the same blink,
	// which is what lets a proof job photograph one.
	//
	// THE INDEX IS FOLDED FIRST. It grows without bound over a session, and float sin loses precision on a
	// large argument -- after long enough the jitter would start to correlate or flatten, and the Dog would
	// drift back toward the metronome this exists to avoid (lane owner, 2026-09-16).
	auto Hash = [](float Seed)
	{
		return FMath::Frac(FMath::Sin(FMath::Fmod(Seed, 4096.0f) * 12.9898f) * 43758.5453f);
	};
	const float Roll = Hash(Index);

	// Blink somewhere in the first two thirds of the window, so the gaps vary instead of ticking.
	// CLAMPED AT ZERO: both figures are EditAnywhere, and a close time past a third of the period would
	// otherwise put the blink slightly BEFORE its own window and show as a stutter.
	const float At = FMath::Max(Roll * (Period - Close * 3.0f) * 0.66f, 0.0f);
	// Every fourth window or so, blink twice -- which is what most real blinking is.
	const bool bDouble = Hash(Index + 7.0f) < 0.28f;

	auto Shut = [this, Close](float Since)
	{
		if (Since < 0.0f || Since >= Close)
		{
			return 1.0f;
		}
		// Down and back up, with the closed moment at the middle.
		const float Away = FMath::Abs(Since - Close * 0.5f) / (Close * 0.5f);
		return FMath::Lerp(FMath::Clamp(BlinkSquash, 0.02f, 1.0f), 1.0f, Away);
	};

	float Scale = Shut(Cycle - At);
	if (bDouble)
	{
		Scale = FMath::Min(Scale, Shut(Cycle - (At + Close * 1.9f)));
	}
	return Scale;
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

	// ---------------------------------------------------------------- the face
	// Cheap enough to do before anything else can return early: two scale writes, no allocation, and the
	// Compound Agent blinking is the difference between a companion and a mannequin.
	if (EyeLeftPivot != nullptr || EyeRightPivot != nullptr)
	{
		const UWorld* BlinkWorld = GetWorld();
		const float Scale = EyeScaleAt(BlinkWorld != nullptr ? static_cast<float>(BlinkWorld->GetTimeSeconds()) : 0.0f);
		if (EyeLeftPivot != nullptr)
		{
			EyeLeftPivot->SetRelativeScale3D(FVector(1.0, 1.0, Scale));
		}
		if (EyeRightPivot != nullptr)
		{
			EyeRightPivot->SetRelativeScale3D(FVector(1.0, 1.0, Scale));
		}
	}

	// ------------------------------------------------------- the mission performance, part one
	// Solved HERE, before driving, because an orbit is a real walk: it adds movement input alongside the
	// player's and the stride system then solves the gait for it. The pose half of the overlay is applied
	// after the walk is written, at the bottom of this function.
	BuildMissionProps();
	RelayDogMission::FStageInput MissionIn;
	MissionIn.DeltaSeconds = DeltaSeconds;
	const UWorld* MissionWorld = GetWorld();
	MissionIn.TimeSeconds = MissionWorld != nullptr ? static_cast<float>(MissionWorld->GetTimeSeconds()) : 0.0f;
	MissionIn.bPlayerDriving = bPlayerDroveThisFrame;
	MissionIn.Reading = RelayDogReadTuning::Pose();
	bPlayerDroveThisFrame = false;

	FVector ContractWorld = FVector::ZeroVector;
	if (const AActor* Contract = MissionContract.Get())
	{
		ContractWorld = Contract->GetActorLocation();
		const FVector Here = GetActorLocation();
		const FVector ToContract = ContractWorld - Here;
		const FVector Flat(ToContract.X, ToContract.Y, 0.0);
		MissionIn.bHasContract = true;
		MissionIn.ContractDistanceUU = static_cast<float>(Flat.Size());
		MissionIn.ContractYawDeg = FMath::FindDeltaAngleDegrees(
			GetActorRotation().Yaw,
			Flat.IsNearlyZero() ? GetActorRotation().Yaw : FMath::RadiansToDegrees(FMath::Atan2(Flat.Y, Flat.X)));
		// Negative pitch looks UP, which is where a floating contract is.
		MissionIn.ContractPitchDeg = -FMath::RadiansToDegrees(
			FMath::Atan2(ToContract.Z - 40.0, FMath::Max(MissionIn.ContractDistanceUU, 1.0f)));
	}
	const RelayDogMission::FStageOverlay Overlay = Mission.Update(MissionIn);

	// FACING. An act done at the work is done facing it. This takes the wheel from the movement component
	// only while such an act is running -- orient-to-movement is restored the moment it ends, because a Dog
	// that walks sideways for the rest of the session would be a far worse bug than one that reads a book
	// side-on. It also lets REVIEW walk its circle tangentially while still looking inward at the contract,
	// which is what circling something to examine it actually looks like.
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		const bool bWantFace = Overlay.bFaceContract && Overlay.Weight > 0.35f;
		if (bWantFace)
		{
			Move->bOrientRotationToMovement = false;
			const float Want = GetActorRotation().Yaw + MissionIn.ContractYawDeg;
			const FRotator Now = GetActorRotation();
			// Eased, not snapped: a body turning to look is a movement, and a snap would read as a glitch.
			SetActorRotation(FRotator(Now.Pitch,
				FMath::FInterpTo(Now.Yaw, Want, DeltaSeconds, 3.2f), Now.Roll));
		}
		else if (!Move->bOrientRotationToMovement)
		{
			Move->bOrientRotationToMovement = true;
		}
	}

	if (Overlay.bOrbit)
	{
		const float Bearing = GetActorRotation().Yaw + Overlay.OrbitBearingDeg;
		const FVector Walk = FRotator(0.0f, Bearing, 0.0f).Vector();
		if (UCharacterMovementComponent* Move = GetCharacterMovement())
		{
			// A study pace, not a patrol: the founder asked for deliberate and thoughtful. An INSPECTION is
			// slower again -- it lingers where a study paces -- which is the overlay's own OrbitPace.
			Move->MaxWalkSpeed = FMath::Max(42.0f, 132.0f * Overlay.OrbitPace);
		}
		// FORCED, because the circle is the performance and not the player. An open overlay -- the live terminal
		// the founder watches a mission through -- sets the controller to ignore move input, and an unforced
		// input was silently dropped: for the whole of the first filmed mission the Dog read, painted and
		// inspected standing on one spot. The player still wins: the orbit is only asked for while nobody steers.
		AddMovementInput(Walk, 1.0f, true);
	}

	// ---------------------------------------------------------------- driving
	FVector DesiredVelocity = FVector::ZeroVector;
	// NOT WHILE THE PERFORMANCE WALKS. The player's speed band used to be written straight over the orbit's
	// study pace, so the Dog circled the Contract at a jog (203 uu/s, logged mid-verification-approach).
	if (!bAutoDemo && !Overlay.bOrbit)
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
	// ACharacter sets bPressedJump on the frame Jump() is called and clears it
	// when the jump is consumed or released, so between the key going down and
	// the feet leaving the ground this is true AND IsFalling() is false. That
	// window is the anticipation dip; see the jump block in RelayDogStride.cpp.
	In.bJumpPressed = bPressedJump;
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

	// ------------------------------------------------- the mission performance, part two: the pose
	//
	// ADDED to what the stride system just wrote, never replacing it. That is what makes the Dog keep its
	// walk while it circles the contract reading, and it is why a mission cannot break locomotion: every
	// term below is exactly zero when no mission is running.
	if (Overlay.Weight > KINDA_SMALL_NUMBER)
	{
		if (BodyRoot != nullptr)
		{
			// The whole body leaves the ground -- legs are its children, so the feet come with it, which is
			// the "entire body suspended" in the founder's note rather than a hovering torso on planted feet.
			BodyRoot->SetRelativeLocation(BodyRestLocation
				+ FVector(0.0f, Pose.SwayUU, Pose.BobUU - Pose.PelvisDropUU + Overlay.LiftUU));
		}
		if (HeadPivot != nullptr)
		{
			HeadPivot->SetRelativeRotation(FRotator(
				Pose.HeadPitchDeg - Pose.LeanDeg + Overlay.HeadPitchDeg,
				Pose.HeadYawDeg + Overlay.HeadYawDeg, 0.0f));
		}
		auto AddArm = [&Overlay](const FRelayDogArm& Arm, const RelayDogStride::FArmPose& ArmPose, float ExtraPitch,
			bool bWorkingArm)
		{
			// The walk's own arm swing, kept or not: a hand under an open book does not swing with the stride.
			const float Keep = Overlay.ArmStrideKeep;
			if (Arm.Shoulder != nullptr)
			{
				// The extra roll is the working arm's alone: the repair's drag across the fault and the
				// page-turning sweep. Mirroring it onto the holding arm would undo the two-handedness.
				const float Roll = Overlay.ShoulderRollDeg + (bWorkingArm ? Overlay.ShoulderRollExtraDeg : 0.0f);
				Arm.Shoulder->SetRelativeRotation(FRotator(
					ArmPose.ShoulderDeg * Keep + ExtraPitch, 0.0f,
					(ArmPose.ShoulderYawDeg * Keep + Roll) * Arm.SideSign));
			}
			if (Arm.Forearm != nullptr)
			{
				Arm.Forearm->SetRelativeRotation(FRotator(
					ArmPose.ElbowDeg * Keep + Overlay.ElbowDeg + (bWorkingArm ? Overlay.ElbowExtraDeg : 0.0f), 0.0f, 0.0f));
			}
		};
		AddArm(ArmLeft, Pose.ArmLeft, Overlay.ShoulderPitchLeftDeg, false);
		AddArm(ArmRight, Pose.ArmRight, Overlay.ShoulderPitchRightDeg, true);
		if (Overlay.HipDeg != 0.0f)
		{
			if (LegLeft.Hip != nullptr) LegLeft.Hip->SetRelativeRotation(FRotator(SolvedL.HipDeg + Overlay.HipDeg, 0.0f, 0.0f));
			if (LegRight.Hip != nullptr) LegRight.Hip->SetRelativeRotation(FRotator(SolvedR.HipDeg + Overlay.HipDeg, 0.0f, 0.0f));
		}
	}

	// THE PROPS. Exactly one may be in hand, which is the spec's BOOK = PLANNING and BRUSH = IMPLEMENTING
	// and the test that asserts one stage each. They follow the PERFORMED act, so a handoff arriving mid
	// implementation leaves the brush exactly where it was.
	const bool bBook = Overlay.Prop == EWonderlandDogProp::Book && Overlay.PropWeight > 0.08f;
	const bool bBrush = Overlay.Prop == EWonderlandDogProp::Paintbrush && Overlay.PropWeight > 0.08f;
	const bool bLens = Overlay.Prop == EWonderlandDogProp::MagnifyingGlass && Overlay.PropWeight > 0.08f;
	if (BookMesh != nullptr) BookMesh->SetVisibility(bBook);
	if (BookPagesMesh != nullptr) BookPagesMesh->SetVisibility(bBook);
	PoseBook(bBook, Overlay.PageTurn);
	if (BrushMesh != nullptr) BrushMesh->SetVisibility(bBrush);
	if (BrushHeadMesh != nullptr) BrushHeadMesh->SetVisibility(bBrush);
	if (LensMesh != nullptr) LensMesh->SetVisibility(bLens);
	if (LensGlassMesh != nullptr) LensGlassMesh->SetVisibility(bLens);

	// THE BEAM, from the chest to the contract, for as long as verification runs.
	if (Overlay.bBeam || Mission.Performing() == EWonderlandDogAct::VerificationBeam)
	{
		LastBeamNote = FString::Printf(TEXT("reported=%s performing=%s overlay_beam=%d fade=%.3f weight=%.3f contract=%d body=%d draws=%d dt=%.4f"),
			WonderlandDogActName(Mission.ReportedAct()), WonderlandDogActName(Mission.Performing()), Overlay.bBeam ? 1 : 0,
			Mission.BeamFade(), Overlay.BeamWeight, MissionIn.bHasContract ? 1 : 0, BodyRoot != nullptr ? 1 : 0,
			(Overlay.bBeam && MissionIn.bHasContract && BodyRoot != nullptr) ? 1 : 0, DeltaSeconds);
	}
	if (Overlay.bBeam && MissionIn.bHasContract && BodyRoot != nullptr)
	{
		const FVector Chest = BodyRoot->GetComponentLocation() + GetActorRotation().RotateVector(FVector(18.0, 0.0, 26.0));
		DrawVerificationBeam(Chest, ContractWorld, Overlay.BeamWeight, MissionIn.TimeSeconds);
	}
	else
	{
		DrawVerificationBeam(FVector::ZeroVector, FVector::ZeroVector, 0.0f, MissionIn.TimeSeconds);
	}

	// One log line per gait change, so a capture can be read against what the
	// Dog was doing without watching every frame.
	if (FMath::Abs(SpeedUU - LastLoggedSpeed) > 40.0f)
	{
		LastLoggedSpeed = SpeedUU;
		UE_LOG(LogTemp, Log, TEXT("WLDOG %s"), *DescribeState());
	}
}

/* ==================================================================== the mission performance */

namespace
{
	/**
	 * `wl.Dog.Act <none|float|book|paint|beam>` — drive the BODY on its own, with no mission.
	 *
	 * DEVELOPMENT PREVIEW, and it says so: this poses the Dog directly and is not Julius doing anything.
	 * It exists because the body and the meaning are built by two sessions, and a pose that can only be
	 * reached by folding a real event stream can only be debugged by folding a real event stream. In
	 * production the acts arrive from UWonderlandMissionSubsystem::ShowBeat and nothing else.
	 *
	 * The contract it performs against is whatever Mission Contract is already in the world, so the orbit
	 * and the beam have a real anchor; with no contract the acts still pose, they simply have nothing to
	 * walk around. It never invents one -- a contract that existed because a debug command was typed would
	 * be exactly the fake the founder's canon forbids.
	 */
	FAutoConsoleCommand CmdDogAct(
		TEXT("wl.Dog.Act"),
		TEXT("Pose the Relay Dog in one mission act: none|float|book|paint|beam. DEVELOPMENT PREVIEW: a drawn pose, not Julius execution."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() < 1)
			{
				UE_LOG(LogTemp, Display, TEXT("WLDOG usage: wl.Dog.Act <none|float|book|paint|beam>"));
				return;
			}
			const FString Want = Args[0].ToLower();
			EWonderlandDogAct Act = EWonderlandDogAct::None;
			if (Want == TEXT("float")) Act = EWonderlandDogAct::FloatingActivation;
			else if (Want == TEXT("book")) Act = EWonderlandDogAct::ReadingTheBook;
			else if (Want == TEXT("paint")) Act = EWonderlandDogAct::PaintingTheWork;
			else if (Want == TEXT("beam")) Act = EWonderlandDogAct::VerificationBeam;
			else if (Want != TEXT("none"))
			{
				UE_LOG(LogTemp, Warning, TEXT("WLDOG no such act '%s'"), *Args[0]);
				return;
			}
			for (const FWorldContext& Context : GEngine->GetWorldContexts())
			{
				UWorld* World = Context.World();
				if (World == nullptr || !World->IsGameWorld())
				{
					continue;
				}
				const AActor* Contract = nullptr;
				for (TActorIterator<AActor> It(World); It; ++It)
				{
					if (It->GetClass()->GetName().Contains(TEXT("MissionOrb")))
					{
						Contract = *It;
						break;
					}
				}
				for (TActorIterator<ARelayDogCharacter> It(World); It; ++It)
				{
					It->SetMissionAct(Act, Contract);
				}
			}
		}));
}

void ARelayDogCharacter::SetMissionAct(EWonderlandDogAct Act, const AActor* Contract)
{
	MissionContract = Contract;
	Mission.SetAct(Act, Contract != nullptr);
	// One line per change, not per frame: a capture can then be read against what the Dog was ASKED to
	// perform, which is the only way to tell a wrong pose from a wrong act.
	UE_LOG(LogTemp, Log, TEXT("WLDOG mission act=%s performing=%s contract=%s"),
		WonderlandDogActName(Act), WonderlandDogActName(Mission.Performing()),
		Contract != nullptr ? *Contract->GetName() : TEXT("none"));
}

UInstancedStaticMeshComponent* ARelayDogCharacter::MakePropMesh(FName Name, USceneComponent* Parent, bool bGlow,
	const TArray<FTransform>& Boxes, const FLinearColor& Colour, TObjectPtr<UMaterialInstanceDynamic>& OutMid,
	const TCHAR* MeshPath)
{
	const TCHAR* const Path = MeshPath != nullptr ? MeshPath : DogPropCubePath;
	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, Path);
	if (Cube == nullptr || Parent == nullptr)
	{
		UE_LOG(LogTemp, Error, TEXT("WLDOG no mesh at %s; the mission prop %s cannot be built"),
			Path, *Name.ToString());
		return nullptr;
	}
	UInstancedStaticMeshComponent* Built = NewObject<UInstancedStaticMeshComponent>(
		this, MakeUniqueObjectName(this, UInstancedStaticMeshComponent::StaticClass(), Name));
	Built->SetMobility(EComponentMobility::Movable);
	Built->SetStaticMesh(Cube);
	UMaterialInterface* ParentMaterial = LoadObject<UMaterialInterface>(nullptr, bGlow ? DogPropGlowParent : DogPropLitParent);
	OutMid = ParentMaterial != nullptr ? UMaterialInstanceDynamic::Create(ParentMaterial, this) : nullptr;
	if (OutMid != nullptr)
	{
		// A glowing part is emitting, not being lit, so its colour carries the exposure multiplier.
		OutMid->SetVectorParameterValue(TEXT("Color"), bGlow ? Colour * DogGlowExposure : Colour);
		Built->SetMaterial(0, OutMid.Get());
	}
	else
	{
		// LOUD, NOT SILENT: the prop still draws, in the default material, rather than vanishing.
		UE_LOG(LogTemp, Warning, TEXT("WLDOG no material at %s; %s draws in the default material"),
			bGlow ? DogPropGlowParent : DogPropLitParent, *Name.ToString());
	}
	Built->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Built->SetGenerateOverlapEvents(false);
	Built->SetCanEverAffectNavigation(false);
	// A glowing thing that shadowed the ground would be a dark lamp.
	Built->SetCastShadow(!bGlow);
	Built->SetupAttachment(Parent);
	Built->RegisterComponent();
	for (const FTransform& Box : Boxes)
	{
		Built->AddInstance(Box);
	}
	Built->SetVisibility(false);
	return Built;
}

void ARelayDogCharacter::BuildMissionProps()
{
	if (bMissionPropsBuilt)
	{
		return;
	}
	bMissionPropsBuilt = true;

	// Scaled from the head, which is this rig's unit, so a Dog built at any HeadWidthUU holds a book that
	// fits its hands rather than one sized for the default.
	const double U = FMath::Max(HeadWidthUU, 10.0f) / 60.0;

	// ---------------------------------------------------------------- the book (PLANNING)
	// AN OPEN BOOK IN FRONT OF THE CHEST, FACING THE READER. It used to hang off the left forearm, and with the
	// arms raised to the sides for reading it lay on its side a head-width out to the left with its pages
	// toward the Dog's ribs: from behind a red slab, from the front a closed block, from nowhere a page.
	//
	// So the book has a frame of its own on the body -- X along the spine, Y across to the right-hand page, Z out
	// of the pages -- placed and tilted toward the face by PoseBook, with the holding hand posed up under it. Its
	// halves are laid out there too, because how far the book is open is one of the numbers being tuned.
	BookRoot = NewObject<USceneComponent>(this, MakeUniqueObjectName(this, USceneComponent::StaticClass(), TEXT("MissionBookRoot")));
	BookRoot->SetupAttachment(BodyRoot != nullptr ? BodyRoot.Get() : GetRootComponent());
	BookRoot->RegisterComponent();
	TArray<FTransform> Covers;
	Covers.Init(FTransform::Identity, 3);
	BookMesh = MakePropMesh(TEXT("MissionBook"), BookRoot, false, Covers, FLinearColor(0.42f, 0.13f, 0.16f), BookMid);

	TArray<FTransform> Pages;
	Pages.Init(FTransform::Identity, 2);
	BookPagesMesh = MakePropMesh(TEXT("MissionBookPages"), BookRoot, false, Pages, FLinearColor(0.94f, 0.92f, 0.84f), BookPagesMid);

	// THE TURNING PAGE. Two halves, so the outer half can trail the inner one and the page curls over rather than
	// swinging like a door; and lit from within, because at play distance a white page crossing a white page
	// against a white Dog is invisible, and a page of light turning over in the Dog's hands is unmistakable.
	TArray<FTransform> Leaf;
	Leaf.Init(FTransform::Identity, 2);
	BookLeafMesh = MakePropMesh(TEXT("MissionBookTurningPage"), BookRoot, true, Leaf, FLinearColor(1.0f, 0.74f, 0.26f), BookLeafMid);
	LaidOutBookOpenDeg = -1.0f;

	// ---------------------------------------------------------------- the paintbrush (IMPLEMENTING)
	// Handle, gold ferrule, bristle block. On the RIGHT forearm, which is the arm the stroke swings.
	USceneComponent* BrushHand = ArmRight.Forearm != nullptr ? ArmRight.Forearm.Get() : BodyRoot.Get();
	TArray<FTransform> Handle;
	Handle.Add(DogPropBox(FVector(4.0 * U, 0.0, -34.0 * U), FVector(5.0 * U, 5.0 * U, 46.0 * U)));
	Handle.Add(DogPropBox(FVector(4.0 * U, 0.0, -59.0 * U), FVector(7.0 * U, 7.0 * U, 6.0 * U)));
	BrushMesh = MakePropMesh(TEXT("MissionBrush"), BrushHand, false, Handle, FLinearColor(0.30f, 0.20f, 0.13f), BrushMid);

	TArray<FTransform> Bristles;
	Bristles.Add(DogPropBox(FVector(4.0 * U, 0.0, -70.0 * U), FVector(9.0 * U, 9.0 * U, 16.0 * U)));
	// The tip glows: this is a Wonderland brush painting software into existence, not an easel brush.
	BrushHeadMesh = MakePropMesh(TEXT("MissionBrushTip"), BrushHand, true, Bristles, FLinearColor(0.95f, 0.72f, 0.28f), BrushHeadMid);

	// ---------------------------------------------------------------- the magnifying glass (REVIEW)
	// A rim, a stubby handle and a lens. On the RIGHT forearm, which is the arm the table brings up to the
	// eye at -34 degrees; the left stays down, because one hand holds a glass and the other does not.
	// SMALL, AND HELD OUT TO ONE SIDE. The first version was a disc centred on the body, and from the play
	// camera it sat directly over the crystal -- the instrument hid the object it was inspecting, which is
	// the one thing a magnifying glass must not do. It is now a little over half the size, offset to the
	// working side, and carried on a handle long enough to read as held rather than worn.
	const double LensY = 22.0 * U;
	TArray<FTransform> Rim;
	const int32 RimSides = 10;
	for (int32 i = 0; i < RimSides; ++i)
	{
		const double A = 2.0 * PI * i / RimSides;
		Rim.Add(DogPropBox(FVector(8.0 * U + FMath::Cos(A) * 15.0 * U, LensY + FMath::Sin(A) * 15.0 * U, -46.0 * U),
			FVector(7.0 * U, 7.0 * U, 5.0 * U), FRotator(0.0, FMath::RadiansToDegrees(A), 0.0)));
	}
	// the handle, from the hand out to the rim
	Rim.Add(DogPropBox(FVector(8.0 * U, LensY * 0.45, -22.0 * U), FVector(6.0 * U, 6.0 * U, 34.0 * U),
		FRotator(0.0, 0.0, -26.0)));
	USceneComponent* LensHand = ArmRight.Forearm != nullptr ? ArmRight.Forearm.Get() : BodyRoot.Get();
	LensMesh = MakePropMesh(TEXT("MissionLensRim"), LensHand, false, Rim, FLinearColor(0.72f, 0.58f, 0.24f), LensMid);

	TArray<FTransform> Glass;
	Glass.Add(DogPropBox(FVector(8.0 * U, LensY, -46.0 * U), FVector(25.0 * U, 25.0 * U, 2.0 * U)));
	// LIT, NOT EMISSIVE. A glowing disc is an opaque bright plate and draws the eye harder than the thing
	// being examined; a lit pale glass still catches the light without competing with the contract.
	LensGlassMesh = MakePropMesh(TEXT("MissionLensGlass"), LensHand, false, Glass,
		FLinearColor(0.58f, 0.80f, 0.88f), LensGlassMid);

	// ---------------------------------------------------------------- the beam (VERIFYING)
	// ONE unit cube, stretched along X between the chest and the contract every frame. A beam has to be a
	// world-space thing rather than a child of a swinging arm, so it hangs off the capsule, not the body.
	// ONE CYLINDER. It was two -- a bright core inside a wider sheath -- until the frames showed the beam
	// was still a flat plank however bright the core was set. The reason is that BOTH are OPAQUE: an
	// opaque sheath hides everything inside it perfectly, so the core was never once on screen and every
	// adjustment to it changed nothing at all. Layering only reads with translucency, and there is none
	// here. So the beam is a single thin cylinder, emitting hard enough to tonemap toward white.
	//
	// The halo component is deliberately not built rather than built and hidden, so nobody restores it by
	// unticking a visibility flag and wonders why the core went away again.
	TArray<FTransform> Beam;
	Beam.Add(FTransform(FRotator(90.0, 0.0, 0.0), FVector(50.0, 0.0, 0.0), FVector(1.0, 1.0, 1.0)));
	BeamMesh = MakePropMesh(TEXT("VerificationBeam"), GetRootComponent(), true, Beam,
		FLinearColor(0.62f, 0.94f, 1.0f), BeamMid, DogPropCylinderPath);
	if (BeamMesh != nullptr)
	{
		BeamMesh->SetAbsolute(true, true, true);
	}
}

void ARelayDogCharacter::PoseBook(bool bInHand, float PageTurn)
{
	using namespace RelayDogReadTuning;
	if (BookRoot == nullptr)
	{
		return;
	}
	const bool bTurning = bInHand && PageTurn >= 0.0f && PageTurn <= 1.0f;
	if (BookLeafMesh != nullptr && BookLeafMesh->IsVisible() != bTurning)
	{
		BookLeafMesh->SetVisibility(bTurning);
	}
	if (!bInHand)
	{
		return;
	}
	const double U = FMath::Max(HeadWidthUU, 10.0f) / 60.0;
	BookRoot->SetRelativeLocationAndRotation(
		FVector(CVarBookFwd.GetValueOnGameThread(), CVarBookRight.GetValueOnGameThread(), CVarBookUp.GetValueOnGameThread()) * U,
		FRotator(CVarBookTilt.GetValueOnGameThread(), 0.0f, 0.0f));

	// THE HALVES, laid out only when the opening changes. The right half rises Open degrees from flat; the left
	// half is the same box turned the rest of the way over, (180 - Open), so its face normal points away from the
	// reader and everything on it is offset the other way along it.
	const float Open = FMath::Clamp(CVarBookOpen.GetValueOnGameThread(), 0.0f, 80.0f);
	// The book's own size scales its halves and the page; where it is held stays in the Dog's units.
	const float Scale = FMath::Clamp(CVarBookScale.GetValueOnGameThread(), 0.3f, 3.0f);
	const double B = U * Scale;
	if ((Open != LaidOutBookOpenDeg || Scale != LaidOutBookScale) && BookMesh != nullptr && BookPagesMesh != nullptr
		&& BookMesh->GetInstanceCount() == 3 && BookPagesMesh->GetInstanceCount() == 2)
	{
		LaidOutBookOpenDeg = Open;
		LaidOutBookScale = Scale;
		const FVector CoverSize(SpineLength + 2.0, HalfWidth + 2.0, CoverThick);
		const FVector PageSize(SpineLength - 2.0, HalfWidth - 1.5, PageThick);
		BookMesh->UpdateInstanceTransform(0, HalfBox(Open, HalfWidth * 0.5 + 1.0, -CoverThick * 0.5, CoverSize, B), false, false, true);
		BookMesh->UpdateInstanceTransform(1, HalfBox(180.0 - Open, HalfWidth * 0.5 + 1.0, CoverThick * 0.5, CoverSize, B), false, false, true);
		BookMesh->UpdateInstanceTransform(2, DogPropBox(FVector(0.0, 0.0, -2.5 * B), FVector((SpineLength + 2.0) * B, 5.0 * B, 4.0 * B)), false, true, true);
		BookPagesMesh->UpdateInstanceTransform(0, HalfBox(Open, HalfWidth * 0.5, PageThick * 0.5, PageSize, B), false, false, true);
		BookPagesMesh->UpdateInstanceTransform(1, HalfBox(180.0 - Open, HalfWidth * 0.5, -PageThick * 0.5, PageSize, B), false, true, true);
	}

	if (!bTurning || BookLeafMesh == nullptr || BookLeafMesh->GetInstanceCount() != 2)
	{
		return;
	}
	const float Glow = FMath::Max(CVarLeafGlow.GetValueOnGameThread(), 0.0f);
	if (BookLeafMid != nullptr && Glow != AppliedLeafGlow)
	{
		AppliedLeafGlow = Glow;
		// GOLD, NOT IVORY. An ivory page of light over ivory pages in the hands of a white Dog was measured on film as
		// a pale shape among pale shapes; the Wonderland gold reads against all three.
		BookLeafMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(1.0f, 0.74f, 0.26f) * (DogGlowExposure * Glow));
	}
	// THE TURN. The page leaves the right-hand page, stands up off the spine at mid-turn -- where it is broadside
	// to a camera beside the Dog, which is where the play camera is while the Dog circles -- and lies down on the
	// left. Its outer half trails the inner, most at mid-turn, so it curls over instead of swinging like a door.
	const double P = FMath::Clamp(static_cast<double>(PageTurn), 0.0, 1.0);
	const double Eased = P * P * (3.0 - 2.0 * P);
	const double Phi = FMath::Lerp(static_cast<double>(Open), 180.0 - Open, Eased);
	const double Phi2 = Phi - CVarLeafCurl.GetValueOnGameThread() * FMath::Sin(PI * P);
	// Resting on the right-hand page at the start and on the left-hand one at the end, through the spine between.
	const double Lift = (PageThick + 0.6) * FMath::Cos(PI * Eased);
	const auto AlongAt = [](double Deg)
	{
		const double A = FMath::DegreesToRadians(Deg);
		return FVector(0.0, FMath::Cos(A), FMath::Sin(A));
	};
	const auto NormalAt = [](double Deg)
	{
		const double A = FMath::DegreesToRadians(Deg);
		return FVector(0.0, -FMath::Sin(A), FMath::Cos(A));
	};
	const FVector LeafScale = FVector(SpineLength - 4.0, HalfWidth * 0.5, 0.8) * (B / 100.0);
	const FVector Base = NormalAt(Phi) * Lift;
	BookLeafMesh->UpdateInstanceTransform(0,
		FTransform(FRotator(0.0, 0.0, -Phi), (Base + AlongAt(Phi) * (HalfWidth * 0.25)) * B, LeafScale), false, false, true);
	BookLeafMesh->UpdateInstanceTransform(1,
		FTransform(FRotator(0.0, 0.0, -Phi2), (Base + AlongAt(Phi) * (HalfWidth * 0.5) + AlongAt(Phi2) * (HalfWidth * 0.25)) * B, LeafScale),
		false, true, true);
}

void ARelayDogCharacter::DrawVerificationBeam(const FVector& FromWorld, const FVector& ToWorld, float Weight, float TimeSeconds)
{
	auto Hide = [this]()
	{
		if (BeamMesh != nullptr) BeamMesh->SetVisibility(false);
		if (BeamHaloMesh != nullptr) BeamHaloMesh->SetVisibility(false);
	};
	if (BeamMesh == nullptr || Weight <= KINDA_SMALL_NUMBER)
	{
		Hide();
		return;
	}
	const FVector Along = ToWorld - FromWorld;
	const double Length = Along.Size();
	if (Length < 1.0)
	{
		Hide();
		return;
	}
	const FRotator Aim = Along.Rotation();
	// SUSTAINED, NOT PULSED. The founder's note rules out flashes and bursts, so the thickness breathes by a
	// few per cent and the beam never goes out or restarts -- a held analytical link rather than fire.
	// Length is exact, so it lands ON the contract instead of through it.
	// THE FLOOR IS GUARANTEED, and everything weight does happens ABOVE it. That is the founder's rule and
	// it is the fix for the whole chase: weight modulates pulse and intensity, it never decides whether the
	// beam is visible. BEAM_FLOOR alone is comfortably past the exposure threshold, so even at the first
	// frame of a fade-in the beam is daylight-readable.
	const float BEAM_FLOOR = 2.40f;
	const float BEAM_RANGE = 1.70f;
	// SUSTAINED, NOT PULSED. The founder's note rules out flashes and bursts, so the pulse rides on top of
	// the floor and the beam never goes out, restarts, or reads as a hit.
	const double Pulse = 1.0 + 0.09 * FMath::Sin(2.0 * PI * TimeSeconds / 1.7);
	// 17 uu over a 420 uu run. The first version was 86 uu, wider than the Dog's head, which read as a wall
	// crossing the frame rather than a link between two things. A beam is thin.
	const double Core = (17.0 * Weight * Pulse) / 100.0;

	BeamMesh->SetVisibility(true);
	BeamMesh->SetWorldLocationAndRotation(FromWorld, Aim);
	BeamMesh->SetWorldScale3D(FVector(Length / 100.0, Core, Core));
	if (BeamMid != nullptr)
	{
		// THE SOFT GLOW IS BLOOM, NOT GEOMETRY, and that is deliberate. A dim sheath around a bright core
		// cannot work here: both are opaque, so the sheath hid the core completely and two passes of
		// brightening it changed nothing at all. A thin cylinder driven hard past the threshold blooms in
		// post into exactly the soft cyan halo the founder asked for, and it costs one draw instead of two.
		// Cyan-white rather than cyan: the core tonemaps toward white and the bloom around it carries the
		// colour, which is what a magical link looks like and what a flat blue rod never does.
		const float Intensity = DogGlowExposure * (BEAM_FLOOR + BEAM_RANGE * Weight) * static_cast<float>(Pulse);
		BeamMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.74f, 0.96f, 1.0f) * Intensity);
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

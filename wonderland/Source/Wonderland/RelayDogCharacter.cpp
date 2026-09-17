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
#include "Engine/GameViewportClient.h"
#include "Components/PrimitiveComponent.h"
#include "Framework/Application/IInputProcessor.h"
#include "Framework/Application/SlateApplication.h"
#include "Layout/WidgetPath.h"
#include "Widgets/SViewport.h"
#include "WonderlandMissionOrb.h"

// THE READING POSE, TUNABLE LIVE. Named, not anonymous: the module is one unity translation unit.
namespace RelayDogReadTuning
{
	TAutoConsoleVariable<float> CVarBookFwd(TEXT("wl.Dog.Read.BookFwd"), 30.0f, TEXT("The open book's centre, in front of the neck along the way the Dog's eyes face, in head-width sixtieths."));
	TAutoConsoleVariable<float> CVarBookRight(TEXT("wl.Dog.Read.BookRight"), 0.0f, TEXT("The open book's centre, to the Dog's right of the neck."));
	TAutoConsoleVariable<float> CVarBookUp(TEXT("wl.Dog.Read.BookUp"), -24.0f, TEXT("The open book's centre, above the neck (negative: below it, before the chest)."));
	TAutoConsoleVariable<float> CVarBookTilt(TEXT("wl.Dog.Read.BookTilt"), 50.0f, TEXT("Degrees the far edge of the book is raised, turning the pages toward the Dog's face."));
	TAutoConsoleVariable<float> CVarBookOpen(TEXT("wl.Dog.Read.BookOpen"), 28.0f, TEXT("Degrees each half of the open book rises from flat."));
	TAutoConsoleVariable<float> CVarBookScale(TEXT("wl.Dog.Read.BookScale"), 1.3f, TEXT("Size of the open book and its turning page."));
	TAutoConsoleVariable<float> CVarLeafCurl(TEXT("wl.Dog.Read.LeafCurl"), 40.0f, TEXT("Degrees the outer half of a turning page trails its inner half at mid-turn."));
	// 1.2, not 3: at 3 the gold page tonemapped to a pale yellow that vanished against the white Dog in the filmed mission;
	// at 1.2 it stays a saturated gold turning over the white pages (zc_camera_test, 2026-09-16).
	TAutoConsoleVariable<float> CVarLeafGlow(TEXT("wl.Dog.Read.LeafGlow"), 1.2f, TEXT("Brightness of the turning page, as a fraction of the Dog's glow exposure."));
	TAutoConsoleVariable<float> CVarTurnHz(TEXT("wl.Dog.Read.TurnHz"), 0.32f, TEXT("Page turns per second."));
	TAutoConsoleVariable<float> CVarTurnFraction(TEXT("wl.Dog.Read.TurnFraction"), 0.42f, TEXT("Fraction of each turn cycle the page is moving."));


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

/* ==================================================================== the limbs, solved in world terms */

namespace RelayDogLimbs
{
	namespace
	{
		FVector RawTip(const FChain& Chain, const FRotator& Root, const FRotator& Mid)
		{
			const FTransform RootXf(Root, Chain.RootRel);
			const FTransform MidXf(Mid, Chain.MidRel);
			return RootXf.TransformPosition(MidXf.TransformPosition(Chain.TipLocal));
		}
	}

	FRotator RootRotation(const FChain& Chain, const FVector& Angles, double Twist)
	{
		return FRotator(Angles.X * Chain.ForwardSign, Twist, Angles.Y * Chain.OutwardSign);
	}

	FRotator MidRotation(const FChain& Chain, const FVector& Angles)
	{
		return FRotator(Angles.Z * Chain.BendSign, 0.0f, 0.0f);
	}

	FVector Tip(const FChain& Chain, float Forward, float Outward, float Bend, float Twist)
	{
		const FVector Angles(Forward, Outward, Bend);
		return RawTip(Chain, RootRotation(Chain, Angles, Twist), MidRotation(Chain, Angles));
	}

	float Solve(FChain& Chain, const FVector& TargetInParent, const FVector& Min, const FVector& Max)
	{
		// DAMPED LEAST SQUARES, three angles, a numeric Jacobian. Warm-started from last frame's answer so a hand that is
		// already on the book stays in the same arm shape instead of flipping to the other solution.
		// FOUR ANGLES FOR A THREE-DIMENSIONAL GOAL: forward, outward, bend, and the twist that turns the elbow's plane to
		// contain the goal. Checked offline against this rig's measured chain: every static goal met to 0.3 uu.
		FVector A = Chain.Solved;
		double T = Chain.SolvedTwist;
		const double Lambda2 = 4.0;
		for (int32 Iteration = 0; Iteration < 16; ++Iteration)
		{
			const FVector Now = Tip(Chain, A.X, A.Y, A.Z, T);
			const FVector Err = TargetInParent - Now;
			if (Err.SizeSquared() < 0.09)
			{
				break;
			}
			const double H = 0.5;
			const FVector J0 = (Tip(Chain, A.X + H, A.Y, A.Z, T) - Now) / H;
			const FVector J1 = (Tip(Chain, A.X, A.Y + H, A.Z, T) - Now) / H;
			const FVector J2 = (Tip(Chain, A.X, A.Y, A.Z + H, T) - Now) / H;
			const FVector J3 = (Tip(Chain, A.X, A.Y, A.Z, T + H) - Now) / H;
			// M = J Jt + lambda^2 I, a symmetric 3x3 over the four columns.
			double M[3][3];
			const FVector Cols[4] = { J0, J1, J2, J3 };
			for (int32 Row = 0; Row < 3; ++Row)
			{
				for (int32 Col = 0; Col < 3; ++Col)
				{
					double Sum = 0.0;
					for (int32 K = 0; K < 4; ++K)
					{
						Sum += Cols[K][Row] * Cols[K][Col];
					}
					M[Row][Col] = Sum + (Row == Col ? Lambda2 : 0.0);
				}
			}
			const double Det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
				- M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
				+ M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
			if (FMath::Abs(Det) < 1e-9)
			{
				break;
			}
			const double Inv[3][3] = {
				{ (M[1][1] * M[2][2] - M[1][2] * M[2][1]) / Det, (M[0][2] * M[2][1] - M[0][1] * M[2][2]) / Det, (M[0][1] * M[1][2] - M[0][2] * M[1][1]) / Det },
				{ (M[1][2] * M[2][0] - M[1][0] * M[2][2]) / Det, (M[0][0] * M[2][2] - M[0][2] * M[2][0]) / Det, (M[0][2] * M[1][0] - M[0][0] * M[1][2]) / Det },
				{ (M[1][0] * M[2][1] - M[1][1] * M[2][0]) / Det, (M[0][1] * M[2][0] - M[0][0] * M[2][1]) / Det, (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / Det } };
			const FVector Y(
				Inv[0][0] * Err.X + Inv[0][1] * Err.Y + Inv[0][2] * Err.Z,
				Inv[1][0] * Err.X + Inv[1][1] * Err.Y + Inv[1][2] * Err.Z,
				Inv[2][0] * Err.X + Inv[2][1] * Err.Y + Inv[2][2] * Err.Z);
			FVector Step(FVector::DotProduct(J0, Y), FVector::DotProduct(J1, Y), FVector::DotProduct(J2, Y));
			double TwistStep = FVector::DotProduct(J3, Y);
			const double Largest = FMath::Max(FMath::Max3(FMath::Abs(Step.X), FMath::Abs(Step.Y), FMath::Abs(Step.Z)), FMath::Abs(TwistStep));
			if (Largest > 14.0)
			{
				Step *= 14.0 / Largest;
				TwistStep *= 14.0 / Largest;
			}
			A = FVector(
				FMath::Clamp(A.X + Step.X, Min.X, Max.X),
				FMath::Clamp(A.Y + Step.Y, Min.Y, Max.Y),
				FMath::Clamp(A.Z + Step.Z, Min.Z, Max.Z));
			T = FMath::Clamp(T + TwistStep, -70.0, 70.0);
		}
		Chain.Solved = A;
		Chain.SolvedTwist = T;
		return static_cast<float>((TargetInParent - Tip(Chain, A.X, A.Y, A.Z, T)).Size());
	}
}

namespace RelayDogPoseTuning
{
	TAutoConsoleVariable<float> CVarMedLift(TEXT("wl.Dog.Pose.MeditateLift"), 72.0f, TEXT("PREPARATION: how high the meditating Dog floats, uu."));
	TAutoConsoleVariable<float> CVarMedHipFwd(TEXT("wl.Dog.Pose.MeditateHipForward"), 80.0f, TEXT("PREPARATION: thighs forward, degrees."));
	TAutoConsoleVariable<float> CVarMedHipOut(TEXT("wl.Dog.Pose.MeditateHipOut"), 34.0f, TEXT("PREPARATION: knees apart, degrees."));
	TAutoConsoleVariable<float> CVarMedKnee(TEXT("wl.Dog.Pose.MeditateKnee"), 118.0f, TEXT("PREPARATION: shins folded back under, degrees."));
	TAutoConsoleVariable<float> CVarFlyLift(TEXT("wl.Dog.Pose.FlyLift"), 150.0f, TEXT("VERIFICATION: how high the Dog flies, uu."));
	TAutoConsoleVariable<float> CVarFlyLean(TEXT("wl.Dog.Pose.FlyLean"), 9.0f, TEXT("VERIFICATION: how far the flying Dog leans into its beam, degrees."));
	TAutoConsoleVariable<float> CVarFlyHipFwd(TEXT("wl.Dog.Pose.FlyHipForward"), -14.0f, TEXT("VERIFICATION: thighs trailing, degrees."));
	TAutoConsoleVariable<float> CVarFlyKnee(TEXT("wl.Dog.Pose.FlyKnee"), 40.0f, TEXT("VERIFICATION: knees folded back, degrees."));
	TAutoConsoleVariable<float> CVarStrokeUp(TEXT("wl.Dog.Pose.StrokeHeight"), 15.0f, TEXT("IMPLEMENTATION: how far a brush stroke travels up and down, uu."));
	TAutoConsoleVariable<float> CVarStrokeHz(TEXT("wl.Dog.Pose.StrokeHz"), 0.55f, TEXT("IMPLEMENTATION: brush strokes per second."));
	TAutoConsoleVariable<float> CVarPaintReach(TEXT("wl.Dog.Pose.PaintReach"), 0.82f, TEXT("IMPLEMENTATION: how far out the brush hand reaches, fraction of the arm."));
	TAutoConsoleVariable<float> CVarLensUp(TEXT("wl.Dog.Pose.LensUp"), 18.0f, TEXT("REVIEW: the lens hand above the neck, uu."));
	TAutoConsoleVariable<float> CVarLensFwd(TEXT("wl.Dog.Pose.LensForward"), 30.0f, TEXT("REVIEW: the lens hand in front of the neck, uu."));
	TAutoConsoleVariable<float> CVarScrubHz(TEXT("wl.Dog.Pose.ScrubHz"), 2.4f, TEXT("REPAIR: scraper strokes per second while erasing."));
	TAutoConsoleVariable<float> CVarRepairIdentify(TEXT("wl.Dog.Pose.RepairIdentify"), 4.0f, TEXT("REPAIR: seconds identifying the fault."));
	TAutoConsoleVariable<float> CVarRepairErase(TEXT("wl.Dog.Pose.RepairErase"), 5.0f, TEXT("REPAIR: seconds erasing it."));
	TAutoConsoleVariable<float> CVarRepairRepaint(TEXT("wl.Dog.Pose.RepairRepaint"), 8.0f, TEXT("REPAIR: seconds repainting it."));
	TAutoConsoleVariable<float> CVarRepairSettle(TEXT("wl.Dog.Pose.RepairSettle"), 3.0f, TEXT("REPAIR: seconds settling afterwards."));

	// FRAMED SO THE DOG IS ALWAYS IN SHOT (solved offline, 2026-09-16, against a 75-degree lens and the Julius terminal at its
	// cap). At 540 uu and 52 degrees round, the Dog -- 340 uu from the Contract -- stood 39 degrees off the lens axis, outside
	// the frame: the founder saw the Contract alone and the beam arriving from off screen. At 820 uu, 25 degrees round, a
	// little pitch and the Contract lifted above the middle, the Contract sits centre-top and the whole Dog stands beside it,
	// about 40% of the screen tall, clear of the terminal.
	TAutoConsoleVariable<float> CVarCamArm(TEXT("wl.MissionCam.Arm"), 820.0f, TEXT("Mission camera: distance from the Mission Contract, uu. The whole Dog in shot beside it."));
	TAutoConsoleVariable<float> CVarCamPitch(TEXT("wl.MissionCam.Pitch"), -6.0f, TEXT("Mission camera: the pitch it holds unless the player has dragged it, degrees."));
	TAutoConsoleVariable<float> CVarCamDrop(TEXT("wl.MissionCam.FocusDrop"), 30.0f, TEXT("Mission camera: how far below the Contract's heart it turns about, uu."));
	TAutoConsoleVariable<float> CVarCamLift(TEXT("wl.MissionCam.ScreenLift"), 120.0f, TEXT("Mission camera: how far the Contract sits above the middle of the screen, uu at the focus."));
	TAutoConsoleVariable<float> CVarCamSide(TEXT("wl.MissionCam.SideAngle"), 25.0f, TEXT("Mission camera: how far round the Contract from the Dog it stands, degrees -- a side / three-quarter view."));
	TAutoConsoleVariable<float> CVarCamFollow(TEXT("wl.MissionCam.FollowRate"), 1.4f, TEXT("Mission camera: how quickly it drifts round to keep that view, per second. Never a cut."));
	// VERIFICATION ZOOMS OUT (founder, 2026-09-16: "at the end when it's verifying make sure it zooms out more because I can
	// barely see the relay dog"): the airborne Dog, its beam, the Contract and the companions standing clear, all in shot.
	TAutoConsoleVariable<float> CVarCamFlyArm(TEXT("wl.MissionCam.FlyWiden"), 260.0f, TEXT("Mission camera: how much further out it eases while the Dog is airborne, uu."));
	TAutoConsoleVariable<float> CVarCamFlyPitch(TEXT("wl.MissionCam.FlyPitch"), -9.0f, TEXT("Mission camera: the pitch it eases toward while the Dog is airborne, degrees."));
	TAutoConsoleVariable<float> CVarCamFlyLift(TEXT("wl.MissionCam.FlyScreenLift"), 20.0f, TEXT("Mission camera: the screen lift it eases toward while the Dog is airborne, uu."));
	TAutoConsoleVariable<float> CVarCamDrag(TEXT("wl.MissionCam.DragSensitivity"), 0.25f, TEXT("Mission camera: degrees per pixel of left-drag."));
	TAutoConsoleVariable<float> CVarCamBlend(TEXT("wl.MissionCam.BlendSeconds"), 1.6f, TEXT("Mission camera: seconds to carry the camera to the Contract and back."));
	TAutoConsoleVariable<int32> CVarCamEnabled(TEXT("wl.MissionCam.Enabled"), 1, TEXT("Mission camera: 1 holds the Mission Contract during a mission, 0 keeps following the Dog."));
}

/* ==================================================================== the mission camera's mouse */

/**
 * THE LEFT-DRAG, SEEN BEFORE ANYTHING ELSE SEES IT. During a mission the terminal is usually open, which puts the
 * controller in UI-only input: the game never hears a mouse button. So the drag is read here, ahead of Slate's routing,
 * and taken only when the press lands on the world -- a press on the terminal, a companion console or any panel is left
 * to it. A drag in progress eats its own moves so the ordinary mouse-look cannot also swing the controller.
 */
class FRelayDogMissionCameraInput : public IInputProcessor
{
public:
	explicit FRelayDogMissionCameraInput(ARelayDogCharacter* InDog) : Dog(InDog) {}

	virtual void Tick(const float DeltaTime, FSlateApplication& SlateApp, TSharedRef<ICursor> Cursor) override {}

	virtual bool HandleMouseButtonDownEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override
	{
		ARelayDogCharacter* Owner = Dog.Get();
		if (Owner == nullptr || MouseEvent.GetEffectingButton() != EKeys::LeftMouseButton)
		{
			return false;
		}
		bDragging = Owner->BeginMissionCameraDrag(MouseEvent.GetScreenSpacePosition());
		return bDragging;
	}

	virtual bool HandleMouseButtonUpEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override
	{
		if (!bDragging || MouseEvent.GetEffectingButton() != EKeys::LeftMouseButton)
		{
			return false;
		}
		bDragging = false;
		if (ARelayDogCharacter* Owner = Dog.Get())
		{
			Owner->EndMissionCameraDrag();
		}
		return true;
	}

	virtual bool HandleMouseMoveEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override
	{
		if (!bDragging)
		{
			return false;
		}
		ARelayDogCharacter* Owner = Dog.Get();
		if (Owner == nullptr || !Owner->IsMissionCameraActive())
		{
			bDragging = false;
			return false;
		}
		const FVector2D Delta = MouseEvent.GetCursorDelta();
		const float Sensitivity = RelayDogPoseTuning::CVarCamDrag.GetValueOnGameThread();
		Owner->OrbitMissionCamera(static_cast<float>(Delta.X) * Sensitivity, -static_cast<float>(Delta.Y) * Sensitivity);
		return true;
	}

	virtual bool HandleMouseWheelOrGestureEvent(FSlateApplication& SlateApp, const FPointerEvent& InWheelEvent, const FPointerEvent* InGestureEvent) override
	{
		// THE WHEEL ZOOMS THE MISSION CAMERA over the world; over a panel it is the panel's.
		ARelayDogCharacter* Owner = Dog.Get();
		if (Owner == nullptr || InGestureEvent != nullptr || !Owner->IsMissionCameraActive() || Owner->GetMissionCameraWeight() < 0.5f)
		{
			return false;
		}
		if (!Owner->IsWorldUnderPointer(InWheelEvent.GetScreenSpacePosition()))
		{
			return false;
		}
		Owner->ZoomMissionCamera(-InWheelEvent.GetWheelDelta());
		return true;
	}

	virtual const TCHAR* GetDebugName() const override { return TEXT("RelayDogMissionCamera"); }

private:
	TWeakObjectPtr<ARelayDogCharacter> Dog;
	bool bDragging = false;
};


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
	// From the head joint's RELATIVE place, never from world positions: at bind the components' world transforms are not
	// always updated yet, and one play session measured the head 198.7 uu up the body where the rig puts it at 111.7.
	HeadInBodyRest = HeadPivot->GetAttachParent() == BodyRoot ? HeadPivot->GetRelativeLocation() : FVector(0.0, 0.0, 111.7);

	// THE RIG'S OWN CONVENTIONS, MEASURED: where the face points, and which way each rotation turns each limb.
	MeasureFace();
	ArmChainLeft.BendSign = 1.0f;
	ArmChainRight.BendSign = 1.0f;
	LegChainLeft.BendSign = -1.0f;
	LegChainRight.BendSign = -1.0f;
	MeasureChain(ArmChainLeft, ArmLeft.Shoulder, ArmLeft.Forearm);
	MeasureChain(ArmChainRight, ArmRight.Shoulder, ArmRight.Forearm);
	MeasureChain(LegChainLeft, LegLeft.Hip, LegLeft.Shin);
	MeasureChain(LegChainRight, LegRight.Hip, LegRight.Shin);
	UE_LOG(LogTemp, Log, TEXT("WLDOG MEASURED: face %s eyes %s head down %+.0f right %+.0f | arm L reach %.1f tip %s signs %+.0f/%+.0f/%+.0f | arm R reach %.1f tip %s signs %+.0f/%+.0f/%+.0f | leg L signs %+.0f/%+.0f/%+.0f"),
		*FaceForwardInBody.ToCompactString(), *EyesInHead.ToCompactString(), HeadDownSign, HeadRightSign,
		ArmChainLeft.Reach, *ArmChainLeft.TipLocal.ToCompactString(), ArmChainLeft.ForwardSign, ArmChainLeft.OutwardSign, ArmChainLeft.BendSign,
		ArmChainRight.Reach, *ArmChainRight.TipLocal.ToCompactString(), ArmChainRight.ForwardSign, ArmChainRight.OutwardSign, ArmChainRight.BendSign,
		LegChainLeft.ForwardSign, LegChainLeft.OutwardSign, LegChainLeft.BendSign);

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
	// While the Mission Contract holds the camera, the camera turns only with a left-drag.
	if (MissionCamWeight > 0.01f) return;
	if (Value != 0.0f) AddControllerYawInput(Value);
}

void ARelayDogCharacter::LookUpAxis(float Value)
{
	// Inverted, as a camera pitch is: pushing the mouse forward looks down.
	if (MissionCamWeight > 0.01f) return;
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
	// THE MISSION CAMERA'S LEFT-DRAG is read ahead of Slate's routing (see FRelayDogMissionCameraInput).
	if (FSlateApplication::IsInitialized() && GetWorld() != nullptr && GetWorld()->IsGameWorld() && !MissionCamInput.IsValid())
	{
		MissionCamInput = MakeShared<FRelayDogMissionCameraInput>(this);
		FSlateApplication::Get().RegisterInputPreProcessor(MissionCamInput);
	}
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

	// THE RIG, FOUND AGAIN WHEN THE EDITOR REBUILDS IT. A notified property write on the Dog during play in the editor --
	// a Details panel edit, or a script moving its camera arm -- re-runs its construction: every Blueprint joint is
	// destroyed and made again under the same name. The Dog went on posing the destroyed joints while the new ones stood
	// frozen, and the book, carried on the old Body, was handed to the capsule: over the Dog's head, or on the floor
	// (measured 2026-09-16, zc_book_bisect). Garbage collection nulled the old Body some while later, which is the
	// "body reference lost" the filmed missions logged. So the joints are bound again the frame they stop being valid --
	// once per rebuild, not every frame -- and the props are seated back on the new body and the new working hand. The rest
	// values are the rig's own and are kept: the new joints are made in whatever pose the old ones were caught in.
	if (!IsValid(BodyRoot) || !IsValid(HeadPivot) || !IsValid(ArmRight.Forearm))
	{
		const FVector BodyRest = BodyRestLocation;
		const FVector HeadRest = HeadInBodyRest;
		const bool bRebound = BindJoints();
		BodyRestLocation = BodyRest;
		HeadInBodyRest = HeadRest;
		++RigRebuilds;
		const UWorld* RebuildWorld = GetWorld();
		UE_LOG(LogTemp, Warning, TEXT("WLDOG rig rebuilt by the editor at %.2f s (%s): %s (rebuild %d)"),
			RebuildWorld != nullptr ? RebuildWorld->GetTimeSeconds() : -1.0, WonderlandDogActName(Mission.Performing()),
			bRebound ? TEXT("joints bound again, props seated back on the body and the working hand") : TEXT("the joints could not be bound"),
			RigRebuilds);
		if (!bRebound)
		{
			bJointsBound = false;
			return;
		}
		auto Seat = [](USceneComponent* Prop, USceneComponent* Parent)
		{
			if (IsValid(Prop) && IsValid(Parent) && Prop->GetAttachParent() != Parent)
			{
				Prop->AttachToComponent(Parent, FAttachmentTransformRules::KeepRelativeTransform);
			}
		};
		Seat(BookRoot, BodyRoot);
		Seat(BrushMesh, ArmRight.Forearm);
		Seat(BrushHeadMesh, ArmRight.Forearm);
		Seat(LensMesh, ArmRight.Forearm);
		Seat(LensGlassMesh, ArmRight.Forearm);
	}

	// ---------------------------------------------------------------- the face
	// Cheap enough to do before anything else can return early: two scale writes, no allocation, and the
	// Compound Agent blinking is the difference between a companion and a mannequin.
	if (EyeLeftPivot != nullptr || EyeRightPivot != nullptr)
	{
		const UWorld* BlinkWorld = GetWorld();
		// Shut in meditation, blinking otherwise.
		const float Scale = FMath::Min(EyeScaleAt(BlinkWorld != nullptr ? static_cast<float>(BlinkWorld->GetTimeSeconds()) : 0.0f),
			FMath::Lerp(1.0f, 0.12f, FMath::Clamp(LastEyesShut, 0.0f, 1.0f)));
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
	{
		using namespace RelayDogPoseTuning;
		RelayDogMission::FTuning& Tuning = MissionIn.Tuning;
		Tuning.MeditateLiftUU = CVarMedLift.GetValueOnGameThread();
		Tuning.FlyLiftUU = CVarFlyLift.GetValueOnGameThread();
		Tuning.TurnHz = RelayDogReadTuning::CVarTurnHz.GetValueOnGameThread();
		Tuning.TurnFraction = RelayDogReadTuning::CVarTurnFraction.GetValueOnGameThread();
		Tuning.StrokeHz = CVarStrokeHz.GetValueOnGameThread();
		Tuning.ScrubHz = CVarScrubHz.GetValueOnGameThread();
		Tuning.Repair.IdentifySeconds = CVarRepairIdentify.GetValueOnGameThread();
		Tuning.Repair.EraseSeconds = CVarRepairErase.GetValueOnGameThread();
		Tuning.Repair.RepaintSeconds = CVarRepairRepaint.GetValueOnGameThread();
		Tuning.Repair.SettleSeconds = CVarRepairSettle.GetValueOnGameThread();
	}
	bPlayerDroveThisFrame = false;

	// WHICH SIDE THE WORKING HAND IS ON, measured in the world every frame from where the face and the shoulder are.
	if (BodyRoot != nullptr && ArmRight.Shoulder != nullptr)
	{
		const FTransform BodyXf = BodyRoot->GetComponentTransform();
		const FVector FaceFwd = BodyXf.TransformVectorNoScale(FaceForwardInBody);
		const FVector FaceRight = FVector::CrossProduct(BodyXf.GetUnitAxis(EAxis::Z), FaceFwd);
		WorkingHandSide = FVector::DotProduct(ArmRight.Shoulder->GetComponentLocation() - BodyXf.GetLocation(), FaceRight) >= 0.0 ? 1.0f : -1.0f;
	}
	MissionIn.WorkingHandSide = WorkingHandSide;

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
	}
	const RelayDogMission::FStageOverlay Overlay = Mission.Update(MissionIn);

	// FACING. Only a stationary act done at the work -- hovering to verify, standing at a fault to repair -- turns the
	// body to the Contract (founder, 2026-09-16: the Dog faces where it walks; the camera holds the Contract). This takes
	// the wheel from the movement component only while such an act runs, and orient-to-movement returns the moment it ends.
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
	// WRITTEN OVER what the stride system just wrote, and identical to it when no mission is running: lift, head, arms
	// solved onto the book / brush / lens / Contract, legs crossed or trailing, props, the beam, the energy, the repair.
	ApplyMissionPose(Pose, Overlay, MissionIn, DeltaSeconds);
	UpdateMissionCamera(DeltaSeconds);

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
		TEXT("Pose the Relay Dog in one mission act: none|prepare|book|paint|beam|review|repair. DEVELOPMENT PREVIEW: a drawn pose, not Julius execution."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() < 1)
			{
				UE_LOG(LogTemp, Display, TEXT("WLDOG usage: wl.Dog.Act <none|prepare|book|paint|beam|review|repair>"));
				return;
			}
			const FString Want = Args[0].ToLower();
			EWonderlandDogAct Act = EWonderlandDogAct::None;
			if (Want == TEXT("float") || Want == TEXT("prepare")) Act = EWonderlandDogAct::FloatingActivation;
			else if (Want == TEXT("review")) Act = EWonderlandDogAct::InspectingTheWork;
			else if (Want == TEXT("repair")) Act = EWonderlandDogAct::CorrectingTheWork;
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
	const UWorld* ActWorld = GetWorld();
	Mission.SetAct(Act, Contract != nullptr, ActWorld != nullptr ? static_cast<float>(ActWorld->GetTimeSeconds()) : 0.0f);
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

	// ---------------------------------------------------------------- the scraper (REPAIR: erase)
	// A wooden grip and a flat steel blade, on the working forearm like the brush: the tool that takes the fault out.
	TArray<FTransform> ScraperGrip;
	ScraperGrip.Add(DogPropBox(FVector(4.0 * U, 0.0, -40.0 * U), FVector(5.0 * U, 5.0 * U, 26.0 * U)));
	ScraperMesh = MakePropMesh(TEXT("MissionScraper"), BrushHand, false, ScraperGrip, FLinearColor(0.34f, 0.22f, 0.13f), ScraperMid);
	TArray<FTransform> ScraperBlade;
	ScraperBlade.Add(DogPropBox(FVector(4.0 * U, 0.0, -60.0 * U), FVector(3.0 * U, 24.0 * U, 17.0 * U)));
	ScraperBladeMesh = MakePropMesh(TEXT("MissionScraperBlade"), BrushHand, false, ScraperBlade, FLinearColor(0.66f, 0.68f, 0.72f), ScraperBladeMid);

	// ---------------------------------------------------------------- the energy (PREPARATION)
	// Motes placed in world space every frame, and the seed of light the Contract grows out of.
	TArray<FTransform> Motes;
	Motes.Init(FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector(0.01)), 23);
	EnergyMesh = MakePropMesh(TEXT("MissionEnergy"), GetRootComponent(), true, Motes, FLinearColor(1.0f, 0.80f, 0.42f), EnergyMid);

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

double ARelayDogCharacter::HeadJointHeightInBody() const
{
	// Read live: the head joint's relative place under the body is the rig's own and is never animated (only its
	// rotation is), so this is where the neck is whatever the capsule and the body's origin are doing.
	if (HeadPivot != nullptr && BodyRoot != nullptr && HeadPivot->GetAttachParent() == BodyRoot)
	{
		return HeadPivot->GetRelativeLocation().Z;
	}
	return HeadInBodyRest.Z;
}

void ARelayDogCharacter::PoseBook(bool bInHand, float PageTurn)
{
	using namespace RelayDogReadTuning;
	if (BookRoot == nullptr || BodyRoot == nullptr)
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

	// ---------------------------------------------------------------- where the book is: the Dog's own frame
	// IN FRONT OF THE CHEST, BELOW THE FACE, OPEN TOWARD THE EYES -- measured from the neck along the way the Dog's eyes
	// actually face, never along an axis this file assumed. The book stays a child of the Body, so it walks, bobs and turns
	// with the Dog exactly; the hands are then solved onto it (ApplyMissionPose), which is what makes it held.
	const FTransform BodyXf = BodyRoot->GetComponentTransform();
	const FVector Up = BodyXf.GetUnitAxis(EAxis::Z);
	const FVector Fwd = BodyXf.TransformVectorNoScale(FaceForwardInBody).GetSafeNormal();
	const FVector Right = FVector::CrossProduct(Up, Fwd).GetSafeNormal();
	const FVector Neck = HeadPivot != nullptr ? HeadPivot->GetComponentLocation() : BodyXf.TransformPosition(FVector(0.0, 0.0, HeadJointHeightInBody()));
	const FVector Centre = Neck + Fwd * (CVarBookFwd.GetValueOnGameThread() * U) + Right * (CVarBookRight.GetValueOnGameThread() * U)
		+ Up * (CVarBookUp.GetValueOnGameThread() * U);
	const double Tilt = FMath::DegreesToRadians(CVarBookTilt.GetValueOnGameThread());
	// The spine runs away from the reader and up; the pages face back toward the eyes; the right-hand page is on the right.
	const FVector Spine = (Fwd * FMath::Cos(Tilt) + Up * FMath::Sin(Tilt)).GetSafeNormal();
	const FVector TowardFace = (Up * FMath::Cos(Tilt) - Fwd * FMath::Sin(Tilt)).GetSafeNormal();
	FMatrix Basis = FRotationMatrix::MakeFromXY(Spine, Right);
	if (FVector::DotProduct(Basis.GetUnitAxis(EAxis::Z), TowardFace) < 0.0)
	{
		Basis = FRotationMatrix::MakeFromXY(-Spine, Right);
	}
	BookRoot->SetWorldLocationAndRotation(Centre, Basis.Rotator());
	// Which end of the book's X is the end nearer the reader's hands.
	const double NearEnd = FVector::DotProduct(Basis.GetUnitAxis(EAxis::X), Spine) > 0.0 ? -1.0 : 1.0;

	// THE HALVES, laid out only when the opening changes. The right half rises Open degrees from flat; the left half is the
	// same box turned the rest of the way over, (180 - Open).
	const float Open = FMath::Clamp(CVarBookOpen.GetValueOnGameThread(), 0.0f, 80.0f);
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
	// THE TURN. The page leaves the right-hand page, stands up off the spine at mid-turn and lies down on the left; its outer
	// half trails the inner, most at mid-turn, so it curls over instead of swinging like a door.
	auto LeafAt = [&](double Progress, double& OutPhi, double& OutPhi2, FVector& OutBase)
	{
		const double P = FMath::Clamp(Progress, 0.0, 1.0);
		const double Eased = P * P * (3.0 - 2.0 * P);
		OutPhi = FMath::Lerp(static_cast<double>(Open), 180.0 - Open, Eased);
		OutPhi2 = OutPhi - CVarLeafCurl.GetValueOnGameThread() * FMath::Sin(PI * P);
		const double Lift = (PageThick + 0.6) * FMath::Cos(PI * Eased);
		OutBase = NormalAt(OutPhi) * Lift;
	};
	auto LeafEdge = [&](double Progress)
	{
		double Phi = 0.0, Phi2 = 0.0;
		FVector Base = FVector::ZeroVector;
		LeafAt(Progress, Phi, Phi2, Base);
		return FVector(NearEnd * SpineLength * 0.30, 0.0, 0.0)
			+ Base + AlongAt(Phi) * (HalfWidth * 0.5) + AlongAt(Phi2) * (HalfWidth * 0.45) + NormalAt(Phi2) * 2.5;
	};

	if (bTurning && BookLeafMesh != nullptr && BookLeafMesh->GetInstanceCount() == 2)
	{
		const float Glow = FMath::Max(CVarLeafGlow.GetValueOnGameThread(), 0.0f);
		if (BookLeafMid != nullptr && Glow != AppliedLeafGlow)
		{
			AppliedLeafGlow = Glow;
			BookLeafMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(1.0f, 0.74f, 0.26f) * (DogGlowExposure * Glow));
		}
		double Phi = 0.0, Phi2 = 0.0;
		FVector Base = FVector::ZeroVector;
		LeafAt(PageTurn, Phi, Phi2, Base);
		const FVector LeafScale = FVector(SpineLength - 4.0, HalfWidth * 0.5, 0.8) * (B / 100.0);
		BookLeafMesh->UpdateInstanceTransform(0,
			FTransform(FRotator(0.0, 0.0, -Phi), (Base + AlongAt(Phi) * (HalfWidth * 0.25)) * B, LeafScale), false, false, true);
		BookLeafMesh->UpdateInstanceTransform(1,
			FTransform(FRotator(0.0, 0.0, -Phi2), (Base + AlongAt(Phi) * (HalfWidth * 0.5) + AlongAt(Phi2) * (HalfWidth * 0.25)) * B, LeafScale),
			false, true, true);
	}

	// ---------------------------------------------------------------- the grips the hands are solved onto
	const FTransform BookXf = BookRoot->GetComponentTransform();
	// Under the left-hand cover, toward the reader's end: the supporting hand.
	const FVector Support = FVector(NearEnd * SpineLength * 0.28, 0.0, 0.0)
		+ AlongAt(180.0 - Open) * (HalfWidth * 0.62) + NormalAt(180.0 - Open) * (CoverThick + 3.0);
	// On the right-hand page's outer corner at rest; along the turning page's edge while it turns; carried back afterwards.
	const FVector Rest = FVector(NearEnd * SpineLength * 0.30, 0.0, 0.0)
		+ AlongAt(Open) * (HalfWidth * 0.86) + NormalAt(Open) * (PageThick + 2.0);
	FVector Turning = Rest;
	if (bTurning)
	{
		Turning = LeafEdge(PageTurn);
	}
	else
	{
		const UWorld* World = GetWorld();
		const float Now = World != nullptr ? static_cast<float>(World->GetTimeSeconds()) : 0.0f;
		const float Hz = FMath::Max(CVarTurnHz.GetValueOnGameThread(), 0.01f);
		const float Frac = FMath::Clamp(CVarTurnFraction.GetValueOnGameThread(), 0.05f, 0.95f);
		const float Cycle = FMath::Frac(Now * Hz);
		const float Back = FMath::SmoothStep(0.0f, 1.0f, FMath::Clamp((Cycle - Frac) / ((1.0f - Frac) * 0.45f), 0.0f, 1.0f));
		Turning = FMath::Lerp(LeafEdge(1.0), Rest, static_cast<double>(Back));
	}
	BookPoints[0] = BookXf.TransformPosition(NormalAt(90.0) * (PageThick * B));
	BookPoints[1] = BookXf.TransformPosition(Support * B);
	BookPoints[2] = BookXf.TransformPosition(Turning * B);
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
void ARelayDogCharacter::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (MissionCamInput.IsValid() && FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().UnregisterInputPreProcessor(MissionCamInput);
	}
	MissionCamInput.Reset();
	Super::EndPlay(EndPlayReason);
}

void ARelayDogCharacter::OrbitMissionCamera(float YawDegrees, float PitchDegrees)
{
	MissionCamYaw = FRotator::NormalizeAxis(MissionCamYaw + YawDegrees);
	MissionCamPitch = FMath::Clamp(MissionCamPitch + PitchDegrees, -72.0f, -3.0f);
}

void ARelayDogCharacter::ZoomMissionCamera(float Steps)
{
	MissionCamZoom = FMath::Clamp(MissionCamZoom * FMath::Pow(1.12f, Steps), 0.45f, 2.2f);
}

void ARelayDogCharacter::SetMissionCameraAngles(float YawDegrees, float PitchDegrees)
{
	MissionCamYaw = FRotator::NormalizeAxis(YawDegrees);
	MissionCamPitch = FMath::Clamp(PitchDegrees, -72.0f, -3.0f);
	bMissionCamLatched = MissionContract.IsValid();
	bMissionCamUserPlaced = true;
}

FString ARelayDogCharacter::MissionCameraPressTarget(const FVector2D& ScreenPosition) const
{
	if (!FSlateApplication::IsInitialized())
	{
		return TEXT("outside");
	}
	const UWorld* World = GetWorld();
	UGameViewportClient* ViewportClient = World != nullptr ? World->GetGameViewport() : nullptr;
	const TSharedPtr<SViewport> ViewportWidget = ViewportClient != nullptr ? ViewportClient->GetGameViewportWidget() : nullptr;
	if (!ViewportWidget.IsValid())
	{
		return TEXT("outside");
	}
	const FGeometry& ViewportGeometry = ViewportWidget->GetTickSpaceGeometry();
	if (!ViewportGeometry.IsUnderLocation(ScreenPosition))
	{
		return TEXT("outside");
	}
	FSlateApplication& App = FSlateApplication::Get();
	TArray<TSharedRef<SWindow>> Windows = App.GetInteractiveTopLevelWindows();
	const FWidgetPath Path = App.LocateWindowUnderMouse(ScreenPosition, Windows, false);
	if (!Path.IsValid())
	{
		return TEXT("outside");
	}
	bool bThroughViewport = false;
	for (int32 Index = 0; Index < Path.Widgets.Num(); ++Index)
	{
		if (&Path.Widgets[Index].Widget.Get() == ViewportWidget.Get())
		{
			bThroughViewport = true;
			break;
		}
	}
	if (!bThroughViewport)
	{
		return TEXT("outside");
	}
	// THE DEEPEST WIDGET THAT TAKES A HIT. A full-viewport container (the HUD's canvases, the terminal's own layer) is the
	// world showing through; anything smaller -- a console, a slot, a line of text, a button -- is a panel.
	const FArrangedWidget& Leaf = Path.Widgets.Last();
	const FString Type = Leaf.Widget->GetTypeAsString();
	const FVector2D LeafSize = Leaf.Geometry.GetAbsoluteSize();
	const FVector2D ViewSize = ViewportGeometry.GetAbsoluteSize();
	const bool bFullScreen = ViewSize.X > 1.0 && ViewSize.Y > 1.0
		&& LeafSize.X * LeafSize.Y >= 0.6 * ViewSize.X * ViewSize.Y;
	if (bFullScreen || Type == TEXT("SViewport") || Type == TEXT("SGameLayerManager"))
	{
		return FString();
	}
	return Type;
}

FVector4 ARelayDogCharacter::GetGameViewportScreenRect() const
{
	const UWorld* World = GetWorld();
	UGameViewportClient* ViewportClient = World != nullptr ? World->GetGameViewport() : nullptr;
	const TSharedPtr<SViewport> ViewportWidget = ViewportClient != nullptr ? ViewportClient->GetGameViewportWidget() : nullptr;
	if (!ViewportWidget.IsValid())
	{
		return FVector4(0.0, 0.0, 0.0, 0.0);
	}
	const FGeometry& Geometry = ViewportWidget->GetTickSpaceGeometry();
	const FVector2D At = Geometry.GetAbsolutePosition();
	const FVector2D Size = Geometry.GetAbsoluteSize();
	return FVector4(At.X, At.Y, Size.X, Size.Y);
}

bool ARelayDogCharacter::IsWorldUnderPointer(const FVector2D& ScreenPosition) const
{
	return MissionCameraPressTarget(ScreenPosition).IsEmpty();
}

FString ARelayDogCharacter::DescribeMissionCameraPress(float ScreenX, float ScreenY) const
{
	const FString Target = MissionCameraPressTarget(FVector2D(ScreenX, ScreenY));
	return Target.IsEmpty() ? FString(TEXT("world")) : (Target == TEXT("outside") ? Target : TEXT("ui:") + Target);
}

bool ARelayDogCharacter::BeginMissionCameraDrag(const FVector2D& ScreenPosition)
{
	if (MissionCamWeight < 0.5f || !MissionContract.IsValid())
	{
		return false;
	}
	const FString Target = MissionCameraPressTarget(ScreenPosition);
	if (Target == TEXT("outside"))
	{
		return false;
	}
	if (!Target.IsEmpty())
	{
		++MissionCamUiPresses;
		UE_LOG(LogTemp, Log, TEXT("WLDOG mission camera: left press on %s is the panel's, not a drag"), *Target);
		return false;
	}
	bMissionCamDragging = true;
	bMissionCamUserPlaced = true;
	++MissionCamDrags;
	return true;
}

void ARelayDogCharacter::EndMissionCameraDrag()
{
	if (bMissionCamDragging)
	{
		UE_LOG(LogTemp, Log, TEXT("WLDOG mission camera: dragged to yaw %.1f pitch %.1f (drag %d)"), MissionCamYaw, MissionCamPitch, MissionCamDrags);
	}
	bMissionCamDragging = false;
}

bool ARelayDogCharacter::SimulateMissionCameraDrag(float FromX, float FromY, float ToX, float ToY, int32 Steps)
{
	if (!FSlateApplication::IsInitialized())
	{
		return false;
	}
	FSlateApplication& App = FSlateApplication::Get();
	const uint32 Pointer = FSlateApplicationBase::CursorPointerIndex;
	TSet<FKey> Held;
	Held.Add(EKeys::LeftMouseButton);
	const FVector2D From(FromX, FromY);
	const FPointerEvent Down(0, Pointer, From, From, Held, EKeys::LeftMouseButton, 0.0f, FModifierKeysState());
	App.ProcessMouseButtonDownEvent(nullptr, Down);
	FVector2D Last = From;
	const int32 Count = FMath::Clamp(Steps, 1, 200);
	for (int32 Step = 1; Step <= Count; ++Step)
	{
		const FVector2D At = FMath::Lerp(From, FVector2D(ToX, ToY), static_cast<float>(Step) / static_cast<float>(Count));
		const FPointerEvent Move(0, Pointer, At, Last, Held, FKey(), 0.0f, FModifierKeysState());
		App.ProcessMouseMoveEvent(Move);
		Last = At;
	}
	const FPointerEvent Up(0, Pointer, Last, Last, TSet<FKey>(), EKeys::LeftMouseButton, 0.0f, FModifierKeysState());
	App.ProcessMouseButtonUpEvent(Up);
	return true;
}

void ARelayDogCharacter::UpdateMissionCamera(float DeltaSeconds)
{
	using namespace RelayDogPoseTuning;
	if (CameraBoom == nullptr)
	{
		return;
	}
	const AActor* Contract = MissionContract.Get();
	const bool bWant = Contract != nullptr && !bAutoDemo && CVarCamEnabled.GetValueOnGameThread() != 0;
	if (bWant)
	{
		MissionCamFocus = Contract->GetActorLocation() - FVector(0.0, 0.0, CVarCamDrop.GetValueOnGameThread());
		if (!bMissionCamLatched)
		{
			// THE CAMERA STARTS WHERE THE PLAYER WAS LOOKING, so taking the Contract is a glide, not a cut.
			bMissionCamLatched = true;
			bMissionCamUserPlaced = false;
			MissionCamZoom = 1.0f;
			MissionCamYaw = Controller != nullptr ? Controller->GetControlRotation().Yaw : GetActorRotation().Yaw;
			MissionCamPitch = FMath::Clamp(CVarCamPitch.GetValueOnGameThread(), -72.0f, -3.0f);
			MissionCamArmShown = CVarCamArm.GetValueOnGameThread();
			MissionCamLiftShown = CVarCamLift.GetValueOnGameThread();
		}
		// ONE CONTINUOUS SHOT (founder, 2026-09-16). The Contract is the pivot and the Dog performs around it; the camera
		// never cuts, never resets at a stage change, and does not chase the Dog like a follow camera. It drifts round the
		// Contract -- slowly, continuously -- to keep the Dog to one side of it, seen from the side or three-quarter side,
		// standing ahead of the way the Dog walks so it comes toward the lens. Once the player drags the camera, that angle
		// is theirs for the rest of the mission.
		const FVector Pivot = Contract->GetActorLocation();
		FVector Radial = GetActorLocation() - Pivot;
		Radial.Z = 0.0;
		const float Rate = FMath::Max(CVarCamFollow.GetValueOnGameThread(), 0.0f);
		const float Ease = 1.0f - FMath::Exp(-DeltaSeconds * Rate);
		if (Radial.SizeSquared() > 400.0)
		{
			const FVector Velocity = GetVelocity();
			const double Turning = Radial.X * Velocity.Y - Radial.Y * Velocity.X;
			if (FMath::Abs(Turning) > 3000.0)
			{
				OrbitTravelSign = Turning > 0.0 ? 1.0f : -1.0f;
			}
			if (!bMissionCamUserPlaced)
			{
				const float DogAzimuth = FMath::RadiansToDegrees(FMath::Atan2(Radial.Y, Radial.X));
				const float CameraAzimuth = DogAzimuth + OrbitTravelSign * CVarCamSide.GetValueOnGameThread();
				const float WantYaw = CameraAzimuth + 180.0f;
				MissionCamYaw = FRotator::NormalizeAxis(MissionCamYaw + FMath::FindDeltaAngleDegrees(MissionCamYaw, WantYaw) * Ease);
			}
		}
		// VERIFICATION IS THE SAME SHOT: as the Dog rises the camera eases out and lifts its gaze so both stay in frame.
		const float Fly = FMath::Clamp(LastFlyShare, 0.0f, 1.0f);
		if (!bMissionCamUserPlaced)
		{
			const float WantPitch = FMath::Lerp(CVarCamPitch.GetValueOnGameThread(), CVarCamFlyPitch.GetValueOnGameThread(), Fly);
			MissionCamPitch = FMath::Clamp(FMath::Lerp(MissionCamPitch, WantPitch, 1.0f - FMath::Exp(-DeltaSeconds * 1.2f)), -72.0f, -3.0f);
		}
		const float WantArm = (CVarCamArm.GetValueOnGameThread() + CVarCamFlyArm.GetValueOnGameThread() * Fly) * MissionCamZoom;
		MissionCamArmShown = FMath::Lerp(MissionCamArmShown, WantArm, 1.0f - FMath::Exp(-DeltaSeconds * 2.0f));
		const float WantLift = FMath::Lerp(CVarCamLift.GetValueOnGameThread(), CVarCamFlyLift.GetValueOnGameThread(), Fly);
		MissionCamLiftShown = FMath::Lerp(MissionCamLiftShown, WantLift, 1.0f - FMath::Exp(-DeltaSeconds * 1.2f));
	}
	else
	{
		bMissionCamLatched = false;
		bMissionCamDragging = false;
	}
	const float Blend = FMath::Max(CVarCamBlend.GetValueOnGameThread(), 0.05f);
	MissionCamWeight = FMath::Clamp(MissionCamWeight + (bWant ? 1.0f : -1.0f) * DeltaSeconds / Blend, 0.0f, 1.0f);

	if (MissionCamWeight <= 0.0f)
	{
		if (bMissionCamApplied)
		{
			// BACK TO THE DOG, exactly as the boom was built for a hand on the mouse.
			CameraBoom->SetUsingAbsoluteLocation(false);
			CameraBoom->SetUsingAbsoluteRotation(false);
			CameraBoom->SetRelativeLocationAndRotation(BoomRestLocation, BoomRestRotation);
			CameraBoom->TargetArmLength = BoomRestArm;
			CameraBoom->SocketOffset = BoomRestSocket;
			CameraBoom->bUsePawnControlRotation = true;
			CameraBoom->bInheritPitch = true;
			CameraBoom->bInheritYaw = true;
			CameraBoom->bDoCollisionTest = true;
			if (FollowCamera != nullptr)
			{
				FollowCamera->SetRelativeRotation(FRotator(-11.0f, 0.0f, 0.0f));
			}
			bMissionCamApplied = false;
		}
		return;
	}
	if (!bMissionCamApplied)
	{
		BoomRestArm = CameraBoom->TargetArmLength;
		BoomRestSocket = CameraBoom->SocketOffset;
		BoomRestLocation = CameraBoom->GetRelativeLocation();
		BoomRestRotation = CameraBoom->GetRelativeRotation();
		CameraBoom->SetUsingAbsoluteLocation(true);
		CameraBoom->SetUsingAbsoluteRotation(true);
		CameraBoom->bUsePawnControlRotation = false;
		// NO COLLISION PULL-IN while the Contract holds the camera: a boom that hit a kerb or a step yanked the view down to
		// the paving in the first inspection, with the Dog and the Contract out of frame above it.
		CameraBoom->bDoCollisionTest = false;
		bMissionCamApplied = true;
	}
	const float S = FMath::SmoothStep(0.0f, 1.0f, MissionCamWeight);
	const FVector NormalPivot = GetCapsuleComponent()->GetComponentTransform().TransformPosition(BoomRestLocation);
	const FRotator NormalRot = Controller != nullptr ? Controller->GetControlRotation() : GetActorRotation();
	const FRotator MissionRot(MissionCamPitch, MissionCamYaw, 0.0f);
	CameraBoom->SetWorldLocationAndRotation(FMath::Lerp(NormalPivot, MissionCamFocus, static_cast<double>(S)),
		FQuat::Slerp(NormalRot.Quaternion(), MissionRot.Quaternion(), S));
	CameraBoom->TargetArmLength = FMath::Lerp(BoomRestArm, MissionCamArmShown > 1.0f ? MissionCamArmShown : CVarCamArm.GetValueOnGameThread(), S);
	CameraBoom->SocketOffset = FMath::Lerp(BoomRestSocket, FVector(0.0f, 0.0f, -MissionCamLiftShown), S);
	if (FollowCamera != nullptr)
	{
		// The follow camera's own downward tilt would push the Contract off the top of the frame; it eases out with the blend.
		FollowCamera->SetRelativeRotation(FRotator(FMath::Lerp(-11.0f, 0.0f, S), 0.0f, 0.0f));
	}
	if (bWant && Controller != nullptr)
	{
		// WASD stays relative to what the player sees, and the follow camera picks up at the mission camera's yaw.
		// Only the yaw: the Dog is never turned by this (it faces where it walks), and the pitch blends on its own.
		const FRotator Control = Controller->GetControlRotation();
		Controller->SetControlRotation(FRotator(Control.Pitch, MissionCamYaw, Control.Roll));
	}
}

/* ==================================================================== measuring the rig */

void ARelayDogCharacter::MeasureFace()
{
	// THE FACE IS WHERE THE EYES ARE. Forward in the Body's frame is the eyes' direction from the neck, flattened.
	FaceForwardInBody = FVector::ForwardVector;
	if (HeadPivot != nullptr && EyeLeftPivot != nullptr && EyeRightPivot != nullptr)
	{
		auto InHead = [this](const USceneComponent* Eye)
		{
			return Eye->GetAttachParent() == HeadPivot
				? Eye->GetRelativeLocation()
				: Eye->GetRelativeLocation() - HeadPivot->GetRelativeLocation();
		};
		EyesInHead = (InHead(EyeLeftPivot) + InHead(EyeRightPivot)) * 0.5;
		const FVector Flat(EyesInHead.X, EyesInHead.Y, 0.0);
		if (!Flat.IsNearlyZero())
		{
			FaceForwardInBody = Flat.GetSafeNormal();
		}
	}
	const FVector Look = FVector(FaceForwardInBody.X, FaceForwardInBody.Y, 0.0).GetSafeNormal();
	const FVector BodyRight = FVector::CrossProduct(FVector::UpVector, FaceForwardInBody).GetSafeNormal();
	// Which way a positive head pitch turns the gaze, and a positive yaw.
	HeadDownSign = FRotator(20.0f, 0.0f, 0.0f).RotateVector(Look).Z < 0.0 ? 1.0f : -1.0f;
	HeadRightSign = FVector::DotProduct(FRotator(0.0f, 20.0f, 0.0f).RotateVector(Look), BodyRight) > 0.0 ? 1.0f : -1.0f;
}

void ARelayDogCharacter::MeasureChain(RelayDogLimbs::FChain& Chain, const USceneComponent* Root, const USceneComponent* Mid)
{
	using namespace RelayDogLimbs;
	if (Root == nullptr || Mid == nullptr)
	{
		return;
	}
	const bool bBendForward = Chain.BendSign > 0.0f;
	Chain.RootRel = Root->GetRelativeLocation();
	Chain.MidRel = Mid->GetRelativeLocation();

	// THE TIP IS THE FAR END OF WHAT THE MIDDLE JOINT CARRIES: the bounds of its meshes in its own frame, walked to the end
	// that points away from the joint. The mission props are not the limb, and are skipped.
	FBox Box(ForceInit);
	TArray<USceneComponent*> Carried;
	Mid->GetChildrenComponents(true, Carried);
	for (USceneComponent* Child : Carried)
	{
		const UPrimitiveComponent* Prim = Cast<UPrimitiveComponent>(Child);
		if (Prim == nullptr || Prim->GetName().StartsWith(TEXT("Mission")) || Prim->GetName().StartsWith(TEXT("Verification")))
		{
			continue;
		}
		const FTransform InMid = Prim->GetComponentTransform().GetRelativeTransform(Mid->GetComponentTransform());
		Box += Prim->CalcBounds(InMid).GetBox();
	}
	if (Box.IsValid)
	{
		const FVector Centre = Box.GetCenter();
		const FVector Dir = Centre.IsNearlyZero() ? FVector(0.0, 0.0, -1.0) : Centre.GetSafeNormal();
		const FVector Extent = Box.GetExtent();
		const double Along = FMath::Abs(Dir.X) * Extent.X + FMath::Abs(Dir.Y) * Extent.Y + FMath::Abs(Dir.Z) * Extent.Z;
		Chain.TipLocal = Centre + Dir * Along;
	}

	auto RawTipAt = [&Chain](const FRotator& R, const FRotator& M)
	{
		return FTransform(R, Chain.RootRel).TransformPosition(FTransform(M, Chain.MidRel).TransformPosition(Chain.TipLocal));
	};
	const FVector Rest = RawTipAt(FRotator::ZeroRotator, FRotator::ZeroRotator);
	Chain.Reach = static_cast<float>((Rest - Chain.RootRel).Size());
	const FVector Forward = FaceForwardInBody;
	// FORWARD: which pitch sign carries the tip toward the face.
	Chain.ForwardSign = FVector::DotProduct(RawTipAt(FRotator(30.0f, 0.0f, 0.0f), FRotator::ZeroRotator) - Chain.RootRel, Forward)
		> FVector::DotProduct(RawTipAt(FRotator(-30.0f, 0.0f, 0.0f), FRotator::ZeroRotator) - Chain.RootRel, Forward) ? 1.0f : -1.0f;
	// OUTWARD: which roll sign carries the tip away from the body's centre line.
	const FVector PlusRoll = RawTipAt(FRotator(0.0f, 0.0f, 30.0f), FRotator::ZeroRotator);
	const FVector MinusRoll = RawTipAt(FRotator(0.0f, 0.0f, -30.0f), FRotator::ZeroRotator);
	Chain.OutwardSign = FVector2D(PlusRoll.X, PlusRoll.Y).Size() > FVector2D(MinusRoll.X, MinusRoll.Y).Size() ? 1.0f : -1.0f;
	// BEND: which sign folds the tip forward (an elbow) or back (a knee).
	const double BendPlus = FVector::DotProduct(RawTipAt(FRotator::ZeroRotator, FRotator(40.0f, 0.0f, 0.0f)), Forward);
	const double BendMinus = FVector::DotProduct(RawTipAt(FRotator::ZeroRotator, FRotator(-40.0f, 0.0f, 0.0f)), Forward);
	Chain.BendSign = (BendPlus > BendMinus) == bBendForward ? 1.0f : -1.0f;
	Chain.Solved = FVector(12.0, 6.0, 14.0);
	Chain.bMeasured = true;
}

FVector ARelayDogCharacter::GetHandLocation(bool bWorkingHand) const
{
	const FRelayDogArm& Arm = bWorkingHand ? ArmRight : ArmLeft;
	const RelayDogLimbs::FChain& Chain = bWorkingHand ? ArmChainRight : ArmChainLeft;
	return Arm.Forearm != nullptr ? Arm.Forearm->GetComponentTransform().TransformPosition(Chain.TipLocal) : GetActorLocation();
}

FVector ARelayDogCharacter::GetBookPoint(int32 Which) const
{
	return BookPoints[FMath::Clamp(Which, 0, 2)];
}

/* ==================================================================== the energy that gathers into the Contract */

void ARelayDogCharacter::DrawEnergy(float Energy, float SecondsIntoAct, float TimeSeconds, const FVector& FromWorld, const FVector& ToWorld)
{
	if (EnergyMesh == nullptr)
	{
		return;
	}
	const bool bOn = Energy > 0.02f && !ToWorld.IsNearlyZero();
	if (EnergyMesh->IsVisible() != bOn)
	{
		EnergyMesh->SetVisibility(bOn);
	}
	if (!bOn)
	{
		return;
	}
	const int32 Count = EnergyMesh->GetInstanceCount();
	if (Count < 2)
	{
		return;
	}
	const FVector Axis = ToWorld - FromWorld;
	const double Length = FMath::Max(Axis.Size(), 1.0);
	const FVector Dir = Axis / Length;
	FVector Side = FVector::CrossProduct(Dir, FVector::UpVector);
	Side = Side.IsNearlyZero() ? FVector::RightVector : Side.GetSafeNormal();
	const FVector Lift = FVector::CrossProduct(Side, Dir).GetSafeNormal();
	TArray<FTransform> Placed;
	Placed.Reserve(Count);
	// MOTES SPIRAL IN FROM ROUND THE MEDITATING DOG TO WHERE THE CONTRACT WILL BE, and keep feeding it once it is there.
	const int32 Motes = Count - 1;
	for (int32 Index = 0; Index < Motes; ++Index)
	{
		const float U = FMath::Frac(TimeSeconds / 2.3f + static_cast<float>(Index) * 0.618034f);
		const float Start = 120.0f + 60.0f * FMath::Frac(static_cast<float>(Index) * 0.37f);
		const float Angle = FMath::DegreesToRadians(static_cast<float>(Index) * 137.5f + U * 420.0f);
		const float Radius = Start * (1.0f - U) * (1.0f - U);
		const float Travel = U * U * (3.0f - 2.0f * U);
		const FVector Centre = FromWorld + Dir * (Length * Travel);
		const FVector At = Centre + (Side * FMath::Cos(Angle) + Lift * FMath::Sin(Angle)) * Radius;
		const float Size = (3.0f + 3.5f * (1.0f - U)) * Energy * FMath::Clamp(U * 8.0f, 0.0f, 1.0f);
		Placed.Add(FTransform(FRotator(TimeSeconds * 90.0f + Index * 40.0f, TimeSeconds * 70.0f, 0.0f), At, FVector(Size / 100.0f)));
	}
	// THE SEED: the gathered energy, bright at the Contract's place, until the Contract has grown out of it.
	const float Grow = FMath::Clamp(SecondsIntoAct / 3.0f, 0.0f, 1.0f);
	const float Handover = 1.0f - FMath::SmoothStep(3.0f, 4.2f, SecondsIntoAct);
	const float Seed = FMath::Max(Grow * Handover, 0.0f) * Energy;
	Placed.Add(FTransform(FRotator(TimeSeconds * 120.0f, TimeSeconds * 80.0f, 0.0f), ToWorld, FVector((4.0f + 20.0f * Seed) * Seed / 100.0f)));
	EnergyMesh->BatchUpdateInstancesTransforms(0, Placed, true, true, true);
	if (EnergyMid != nullptr)
	{
		const float Pulse = 0.85f + 0.25f * FMath::Sin(TimeSeconds * 5.0f);
		EnergyMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(1.0f, 0.80f, 0.42f) * (DogGlowExposure * 1.3f * Pulse));
	}
}

/* ==================================================================== the performance, written over the walk */

void ARelayDogCharacter::ApplyMissionPose(const RelayDogStride::FDogPose& Pose, const RelayDogMission::FStageOverlay& O,
	const RelayDogMission::FStageInput& In, float DeltaSeconds)
{
	using namespace RelayDogPoseTuning;
	using RelayDogMission::ERepairStage;
	LastEyesShut = O.EyesShut;
	const float W = O.Weight;
	const AActor* Contract = MissionContract.Get();
	const FVector Heart = Contract != nullptr ? Contract->GetActorLocation() : FVector::ZeroVector;
	const bool bPerforming = W > KINDA_SMALL_NUMBER && BodyRoot != nullptr && ArmChainLeft.bMeasured && ArmChainRight.bMeasured;

	if (bPerforming)
	{
		// ---------------------------------------------------------------- the body: lifted, and still while it floats
		const float Still = FMath::Clamp((O.Meditate + O.Fly) / FMath::Max(W, 0.001f), 0.0f, 1.0f) * W;
		BodyRoot->SetRelativeLocation(BodyRestLocation + FVector(0.0f, Pose.SwayUU * (1.0f - Still),
			(Pose.BobUU - Pose.PelvisDropUU) * (1.0f - Still) + O.LiftUU));
		BodyRoot->SetRelativeRotation(FRotator(Pose.LeanDeg + Pose.Body.PitchDeg + O.Fly * CVarFlyLean.GetValueOnGameThread(),
			Pose.BodyYawDeg * (1.0f - Still), (Pose.Body.RollDeg + Pose.TurnRollDeg) * (1.0f - Still)));
	}

	const FTransform BodyXf = BodyRoot != nullptr ? BodyRoot->GetComponentTransform() : GetActorTransform();
	const FVector Up = BodyXf.GetUnitAxis(EAxis::Z);
	const FVector Fwd = BodyXf.TransformVectorNoScale(FaceForwardInBody).GetSafeNormal();
	const FVector Right = FVector::CrossProduct(Up, Fwd).GetSafeNormal();
	const FVector Neck = HeadPivot != nullptr ? HeadPivot->GetComponentLocation() : BodyXf.TransformPosition(FVector(0.0, 0.0, HeadJointHeightInBody()));
	const FVector Chest = Neck - Up * 20.0 + Fwd * 6.0;
	const float Side = WorkingHandSide;
	const FVector Crown = Heart + FVector(0.0, 0.0, 30.0);

	// ---------------------------------------------------------------- the props
	const bool bBook = O.Prop == EWonderlandDogProp::Book && O.PropWeight > 0.08f;
	const bool bBrush = O.Prop == EWonderlandDogProp::Paintbrush && O.PropWeight > 0.08f;
	const bool bLens = O.Prop == EWonderlandDogProp::MagnifyingGlass && O.PropWeight > 0.08f;
	const bool bScraper = O.Prop == EWonderlandDogProp::Scraper && O.PropWeight > 0.08f;
	if (BookMesh != nullptr) BookMesh->SetVisibility(bBook);
	if (BookPagesMesh != nullptr) BookPagesMesh->SetVisibility(bBook);
	PoseBook(bBook || O.Read > 0.05f, O.PageTurn);
	if (BrushMesh != nullptr) BrushMesh->SetVisibility(bBrush);
	if (BrushHeadMesh != nullptr) BrushHeadMesh->SetVisibility(bBrush);
	if (LensMesh != nullptr) LensMesh->SetVisibility(bLens);
	if (LensGlassMesh != nullptr) LensGlassMesh->SetVisibility(bLens);
	if (ScraperMesh != nullptr) ScraperMesh->SetVisibility(bScraper);
	if (ScraperBladeMesh != nullptr) ScraperBladeMesh->SetVisibility(bScraper);

	float MissWorking = -1.0f;
	float MissFree = -1.0f;
	if (bPerforming)
	{
		// ---------------------------------------------------------------- the legs
		const float LegShare = O.Meditate + O.Fly;
		auto WriteLeg = [&](FRelayDogLeg& Leg, RelayDogLimbs::FChain& Chain, const RelayDogStride::FLegPose& Walk)
		{
			if (Leg.Hip == nullptr || !Chain.bMeasured)
			{
				return;
			}
			const FVector WalkAngles(Walk.HipDeg * Chain.ForwardSign, 0.0f, -Walk.KneeDeg * Chain.BendSign);
			FVector Want = WalkAngles;
			if (LegShare > KINDA_SMALL_NUMBER)
			{
				const FVector Meditating(CVarMedHipFwd.GetValueOnGameThread(), CVarMedHipOut.GetValueOnGameThread(), CVarMedKnee.GetValueOnGameThread());
				const FVector Flying(CVarFlyHipFwd.GetValueOnGameThread(), 4.0f, CVarFlyKnee.GetValueOnGameThread());
				const FVector Performed = (Meditating * O.Meditate + Flying * O.Fly) / LegShare;
				Want = FMath::Lerp(WalkAngles, Performed, static_cast<double>(FMath::Clamp(LegShare, 0.0f, 1.0f)));
			}
			Leg.Hip->SetRelativeRotation(RelayDogLimbs::RootRotation(Chain, Want));
			if (Leg.Shin != nullptr)
			{
				Leg.Shin->SetRelativeRotation(RelayDogLimbs::MidRotation(Chain, Want));
			}
		};
		WriteLeg(LegLeft, LegChainLeft, Pose.LegLeft);
		WriteLeg(LegRight, LegChainRight, Pose.LegRight);

		// ---------------------------------------------------------------- the hands' goals, world space
		const FVector ShoulderW = BodyXf.TransformPosition(ArmChainRight.RootRel);
		const FVector ShoulderF = BodyXf.TransformPosition(ArmChainLeft.RootRel);
		const float ReachW = ArmChainRight.Reach;
		const float ReachF = ArmChainLeft.Reach;
		auto Hanging = [&](const FVector& Shoulder, float Reach, float SwingDeg, float Out)
		{
			const float A = FMath::DegreesToRadians(FMath::Clamp(SwingDeg, -35.0f, 35.0f));
			return Shoulder + (-Up * FMath::Cos(A) + Fwd * FMath::Sin(A)) * (Reach * 0.95) + Right * (Out * 4.0);
		};
		auto Toward = [&](const FVector& From, const FVector& To, float Reach, float Fraction)
		{
			return From + (To - From).GetSafeNormal() * (Reach * Fraction);
		};
		const float SwingF = Pose.ArmLeft.ShoulderDeg * ArmChainLeft.ForwardSign;
		const float SwingW = Pose.ArmRight.ShoulderDeg * ArmChainRight.ForwardSign;
		const FVector FreeRelaxed = Hanging(ShoulderF, ReachF, SwingF * 0.8f, -Side);
		FVector GoalW = FVector::ZeroVector;
		FVector GoalF = FVector::ZeroVector;
		FVector Look = FVector::ZeroVector;
		float Sum = 0.0f;
		auto Add = [&](float Share, const FVector& Working, const FVector& Free, const FVector& LookAt)
		{
			if (Share <= KINDA_SMALL_NUMBER)
			{
				return;
			}
			GoalW += Working * Share;
			GoalF += Free * Share;
			Look += LookAt * Share;
			Sum += Share;
		};

		// PREPARATION: each hand on the knee on its own side.
		if (O.Meditate > KINDA_SMALL_NUMBER)
		{
			auto Knee = [&](const RelayDogLimbs::FChain& Chain)
			{
				const FVector Angles(CVarMedHipFwd.GetValueOnGameThread(), CVarMedHipOut.GetValueOnGameThread(), CVarMedKnee.GetValueOnGameThread());
				return BodyXf.TransformPosition(FTransform(RelayDogLimbs::RootRotation(Chain, Angles), Chain.RootRel).TransformPosition(Chain.MidRel));
			};
			const bool bLeftLegOnWorkingSide = FVector::DotProduct(BodyXf.TransformPosition(LegChainLeft.RootRel) - BodyXf.GetLocation(), Right) * Side > 0.0;
			const FVector KneeW = Knee(bLeftLegOnWorkingSide ? LegChainLeft : LegChainRight) + Up * 7.0 + Fwd * 3.0;
			const FVector KneeF = Knee(bLeftLegOnWorkingSide ? LegChainRight : LegChainLeft) + Up * 7.0 + Fwd * 3.0;
			Add(O.Meditate, KneeW, KneeF, Neck + Fwd * 120.0 - Up * 22.0);
		}
		// RESEARCH: the supporting hand under the book, the turning hand on the page.
		if (O.Read > KINDA_SMALL_NUMBER)
		{
			// The hand on the Dog's right turns the pages; the book's right-hand page is on that side.
			const bool bWorkingTurns = Side > 0.0f;
			Add(O.Read, bWorkingTurns ? BookPoints[2] : BookPoints[1], bWorkingTurns ? BookPoints[1] : BookPoints[2], BookPoints[0]);
		}
		// IMPLEMENTATION: the brush hand reaches toward the Contract and strokes; the other arm hangs.
		FVector BrushGoal = FVector::ZeroVector;
		if (O.Paint > KINDA_SMALL_NUMBER && Contract != nullptr)
		{
			const FVector Reach = ((Heart - ShoulderW).GetSafeNormal() * 0.78 + Right * (Side * 0.22) + Up * 0.12).GetSafeNormal();
			const FVector Across = FVector::CrossProduct(Reach, Up).GetSafeNormal();
			const float Phase = 2.0f * PI * O.StrokePhase;
			BrushGoal = ShoulderW + Reach * (ReachW * CVarPaintReach.GetValueOnGameThread())
				+ Up * (FMath::Sin(Phase) * CVarStrokeUp.GetValueOnGameThread()) + Across * (FMath::Cos(Phase) * 6.0);
			// The painter watches its brush, not the Contract.
			Add(O.Paint, BrushGoal, FreeRelaxed, BrushGoal + (BrushGoal - ShoulderW).GetSafeNormal() * 40.0);
		}
		// REVIEW: the lens up at the eye on the working side, swept slowly across the work.
		if (O.Inspect > KINDA_SMALL_NUMBER)
		{
			const FVector Lens = Neck + Up * CVarLensUp.GetValueOnGameThread() + Fwd * CVarLensFwd.GetValueOnGameThread()
				+ Right * (Side * (12.0 + 7.0 * FMath::Sin(2.0f * PI * O.SweepPhase)));
			// The inspector looks through its lens, at whatever is beyond it.
			Add(O.Inspect, Lens - Up * 6.0, FreeRelaxed, Lens + (Lens - Neck).GetSafeNormal() * 120.0);
		}
		// VERIFICATION: both hands aimed at the Contract's heart.
		if (O.Fly > KINDA_SMALL_NUMBER && Contract != nullptr)
		{
			Add(O.Fly, Toward(ShoulderW, Heart, ReachW, 0.94f), Toward(ShoulderF, Heart, ReachF, 0.94f), Heart);
		}
		// REPAIR: identify with the lens, erase with the scraper, repaint with the brush, then settle.
		if (O.Correct > KINDA_SMALL_NUMBER && Contract != nullptr)
		{
			FVector Tool = FreeRelaxed;
			switch (O.Repair.Stage)
			{
			case ERepairStage::Identify:
				Tool = Neck + Up * (CVarLensUp.GetValueOnGameThread() - 4.0) + (Crown - Neck).GetSafeNormal() * CVarLensFwd.GetValueOnGameThread() - Up * 6.0;
				break;
			case ERepairStage::Erase:
			{
				const FVector Reach = (Crown - ShoulderW).GetSafeNormal();
				const FVector Across = FVector::CrossProduct(Reach, Up).GetSafeNormal();
				Tool = ShoulderW + Reach * (ReachW * 0.88) + Across * (FMath::Sin(2.0f * PI * O.ScrubPhase) * 10.0);
				break;
			}
			case ERepairStage::Repaint:
			{
				const FVector Reach = ((Crown - ShoulderW).GetSafeNormal() * 0.85 + Up * 0.15).GetSafeNormal();
				Tool = ShoulderW + Reach * (ReachW * 0.84) + Up * (FMath::Sin(2.0f * PI * O.StrokePhase * 0.7f) * 11.0);
				break;
			}
			default:
				Tool = Hanging(ShoulderW, ReachW, 8.0f, Side);
				break;
			}
			Add(O.Correct, Tool, FreeRelaxed, Crown);
		}

		// ---------------------------------------------------------------- the arms, solved
		auto WriteArm = [&](const FRelayDogArm& Arm, RelayDogLimbs::FChain& Chain, const RelayDogStride::FArmPose& Walk, const FVector& Goal, float& OutMiss)
		{
			if (Arm.Shoulder == nullptr || Arm.Forearm == nullptr)
			{
				return;
			}
			const FVector WalkAngles(Walk.ShoulderDeg * Chain.ForwardSign, Walk.ShoulderYawDeg * Arm.SideSign * Chain.OutwardSign,
				Walk.ElbowDeg * Chain.BendSign);
			FVector Want = WalkAngles;
			double Twist = 0.0;
			if (Sum > KINDA_SMALL_NUMBER)
			{
				OutMiss = RelayDogLimbs::Solve(Chain, BodyXf.InverseTransformPosition(Goal / Sum), FVector(-60.0, -25.0, 0.0), FVector(175.0, 125.0, 150.0));
				const double Share = FMath::Clamp(Sum, 0.0f, 1.0f);
				Want = FMath::Lerp(WalkAngles, Chain.Solved, Share);
				Twist = Chain.SolvedTwist * Share;
			}
			Arm.Shoulder->SetRelativeRotation(RelayDogLimbs::RootRotation(Chain, Want, Twist));
			Arm.Forearm->SetRelativeRotation(RelayDogLimbs::MidRotation(Chain, Want));
		};
		WriteArm(ArmRight, ArmChainRight, Pose.ArmRight, GoalW, MissWorking);
		WriteArm(ArmLeft, ArmChainLeft, Pose.ArmLeft, GoalF, MissFree);

		// ---------------------------------------------------------------- the head looks at the work
		if (HeadPivot != nullptr && Sum > KINDA_SMALL_NUMBER)
		{
			const FVector HeadRel = HeadPivot->GetRelativeLocation();
			const FVector Target = BodyXf.InverseTransformPosition(Look / Sum);
			const FVector WantDir = (Target - (HeadRel + FVector(0.0, 0.0, EyesInHead.Z))).GetSafeNormal();
			const FVector Face(FaceForwardInBody.X, FaceForwardInBody.Y, 0.0);
			auto Gaze = [&](const FVector2D& Angles)
			{
				return FRotator(Angles.X * HeadDownSign, Angles.Y * HeadRightSign, 0.0f).RotateVector(Face);
			};
			FVector2D Angles = HeadLookSolved;
			for (int32 Iteration = 0; Iteration < 8; ++Iteration)
			{
				const FVector Now = Gaze(Angles);
				const FVector Err = WantDir - Now;
				if (Err.SizeSquared() < 1e-5)
				{
					break;
				}
				const FVector Dd = (Gaze(Angles + FVector2D(0.5, 0.0)) - Now) / 0.5;
				const FVector Dr = (Gaze(Angles + FVector2D(0.0, 0.5)) - Now) / 0.5;
				const double A11 = Dd.SizeSquared() + 1e-4;
				const double A22 = Dr.SizeSquared() + 1e-4;
				const double A12 = FVector::DotProduct(Dd, Dr);
				const double B1 = FVector::DotProduct(Dd, Err);
				const double B2 = FVector::DotProduct(Dr, Err);
				const double Det = A11 * A22 - A12 * A12;
				if (FMath::Abs(Det) < 1e-12)
				{
					break;
				}
				Angles.X = FMath::Clamp(Angles.X + FMath::Clamp((A22 * B1 - A12 * B2) / Det, -10.0, 10.0), -40.0, 55.0);
				Angles.Y = FMath::Clamp(Angles.Y + FMath::Clamp((A11 * B2 - A12 * B1) / Det, -10.0, 10.0), -70.0, 70.0);
			}
			HeadLookSolved = Angles;
			const FVector2D WalkLook((Pose.HeadPitchDeg - Pose.LeanDeg) * HeadDownSign, Pose.HeadYawDeg * HeadRightSign);
			const FVector2D Final = FMath::Lerp(WalkLook, Angles, FMath::Clamp(Sum, 0.0f, 1.0f));
			HeadPivot->SetRelativeRotation(FRotator(Final.X * HeadDownSign, Final.Y * HeadRightSign, 0.0f));
		}
	}

	// ---------------------------------------------------------------- the beam, from the hands to the Contract's heart
	if (O.bBeam || Mission.Performing() == EWonderlandDogAct::VerificationBeam)
	{
		LastBeamNote = FString::Printf(TEXT("reported=%s performing=%s overlay_beam=%d fade=%.3f weight=%.3f contract=%d body=%d fly=%.2f lift=%.0f"),
			WonderlandDogActName(Mission.ReportedAct()), WonderlandDogActName(Mission.Performing()), O.bBeam ? 1 : 0,
			Mission.BeamFade(), O.BeamWeight, Contract != nullptr ? 1 : 0, BodyRoot != nullptr ? 1 : 0, O.Fly, O.LiftUU);
	}
	if (O.bBeam && Contract != nullptr && BodyRoot != nullptr)
	{
		const FVector Hands = (GetHandLocation(true) + GetHandLocation(false)) * 0.5;
		const FVector From = O.Fly > 0.3f ? Hands : Chest + Fwd * 18.0;
		DrawVerificationBeam(From, Heart, O.BeamWeight, In.TimeSeconds);
	}
	else
	{
		DrawVerificationBeam(FVector::ZeroVector, FVector::ZeroVector, 0.0f, In.TimeSeconds);
	}

	// ---------------------------------------------------------------- energy, and the Contract's repair
	DrawEnergy(O.Energy, O.SecondsIntoAct, In.TimeSeconds, Chest + Fwd * 20.0, Heart);
	if (AWonderlandMissionOrb* Orb = Cast<AWonderlandMissionOrb>(const_cast<AActor*>(Contract)))
	{
		Orb->SetRepairState(static_cast<int32>(O.Repair.Stage), O.Repair.Progress, O.Correct);
	}

	LastFlyShare = O.Fly;
	LastPoseNote = FString::Printf(
		TEXT("act=%s w=%.2f med=%.2f read=%.2f paint=%.2f fly=%.2f inspect=%.2f correct=%.2f lift=%.0f prop=%s face=%d orbit=%d repair=%d:%.2f miss_w=%.1f miss_f=%.1f side=%.0f cam=%.2f turn=%.2f"),
		WonderlandDogActName(Mission.Performing()), W, O.Meditate, O.Read, O.Paint, O.Fly, O.Inspect, O.Correct, O.LiftUU,
		WonderlandDogPropName(O.Prop), O.bFaceContract ? 1 : 0, O.bOrbit ? 1 : 0, static_cast<int32>(O.Repair.Stage), O.Repair.Progress,
		MissWorking, MissFree, WorkingHandSide, MissionCamWeight, O.PageTurn);
}

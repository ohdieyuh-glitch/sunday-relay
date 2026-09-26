#include "WonderlandSkinStage.h"

#include "Components/PointLightComponent.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandRelaySkins.h"

namespace
{
	/** A portrait frame: the Dog is taller than it is wide, and a square would be mostly floor and sky. */
	constexpr int32 TargetWidth = 640;
	constexpr int32 TargetHeight = 800;

	/** How often a frame is taken while a surface is watching. Thirty is plenty for a breathing mannequin. */
	constexpr float CaptureInterval = 1.0f / 30.0f;

	/** How long after the last paint the stage keeps capturing, so one skipped frame does not stall the picture. */
	constexpr float ForgetSeconds = 0.75f;

	const TCHAR* const CubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
	const TCHAR* const PlainMaterialPath = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
}

AWonderlandSkinStage::AWonderlandSkinStage()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	// NOT A THING IN THE WORLD. Nothing may collide with the viewing room, and nothing in the world may knock it over.
	SetCanBeDamaged(false);

	StageRoot = CreateDefaultSubobject<USceneComponent>(TEXT("StageRoot"));
	SetRootComponent(StageRoot);

	// THE BACKDROP AND THE PLINTH. A capture that showed only the Dog would show it against whatever sky happened to be
	// behind the stage, which changes with the time of day; a dark wall and a dark disc make one frame that always
	// looks the same, so two skins photographed an hour apart can actually be compared.
	Backdrop = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Backdrop"));
	Backdrop->SetupAttachment(StageRoot);
	Backdrop->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
	Backdrop->SetCastShadow(false);
	Backdrop->SetRelativeLocation(FVector(-420.0, 0.0, 120.0));
	Backdrop->SetRelativeScale3D(FVector(0.2, 14.0, 9.0));

	Plinth = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Plinth"));
	Plinth->SetupAttachment(StageRoot);
	Plinth->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
	Plinth->SetCastShadow(false);
	Plinth->SetRelativeLocation(FVector(0.0, 0.0, -12.0));
	Plinth->SetRelativeScale3D(FVector(2.6, 2.6, 0.24));

	// THREE LIGHTS, carried by the stage. The world's sun reaches up here too, but it moves and it is not this room's
	// business: a preview lit only by the sun would be bright at noon and unreadable at dusk.
	KeyLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("KeyLight"));
	KeyLight->SetupAttachment(StageRoot);
	KeyLight->SetRelativeLocation(FVector(230.0, -190.0, 270.0));
	KeyLight->SetIntensity(90000.0f);
	KeyLight->SetAttenuationRadius(1400.0f);
	KeyLight->SetLightColor(FLinearColor(1.0f, 0.97f, 0.92f));
	KeyLight->SetCastShadows(false);

	FillLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("FillLight"));
	FillLight->SetupAttachment(StageRoot);
	FillLight->SetRelativeLocation(FVector(180.0, 240.0, 90.0));
	FillLight->SetIntensity(26000.0f);
	FillLight->SetAttenuationRadius(1200.0f);
	FillLight->SetLightColor(FLinearColor(0.72f, 0.78f, 1.0f));
	FillLight->SetCastShadows(false);

	RimLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("RimLight"));
	RimLight->SetupAttachment(StageRoot);
	RimLight->SetRelativeLocation(FVector(-250.0, 60.0, 300.0));
	RimLight->SetIntensity(52000.0f);
	RimLight->SetAttenuationRadius(1100.0f);
	RimLight->SetLightColor(FLinearColor(0.62f, 0.70f, 1.0f));
	RimLight->SetCastShadows(false);

	Capture = CreateDefaultSubobject<USceneCaptureComponent2D>(TEXT("Capture"));
	Capture->SetupAttachment(StageRoot);
	// OFF UNTIL ASKED. bCaptureEveryFrame would render the scene a second time forever, for a panel that is shut.
	Capture->bCaptureEveryFrame = false;
	Capture->bCaptureOnMovement = false;
	Capture->CaptureSource = ESceneCaptureSource::SCS_FinalColorLDR;
	Capture->FOVAngle = 34.0f;
	// ONLY WHAT BELONGS ON THE STAGE. The show-only list is filled in when the body exists; until then the capture
	// would draw the whole world, which at this altitude is a picture of the sky.
	Capture->PrimitiveRenderMode = ESceneCapturePrimitiveRenderMode::PRM_UseShowOnlyList;
	ApplyPreviewExposure();
}

void AWonderlandSkinStage::ApplyPreviewExposure()
{
	if (Capture == nullptr)
	{
		return;
	}

	// A ROOM, NOT A WINDOW ONTO THE SKY.
	//
	// THE SHOW-ONLY LIST DOES NOT FILTER THE SKY. It filters PRIMITIVES, and the atmosphere, the height fog and the
	// sky light are none of those -- so a capture a thousand metres up rendered the sky whatever the show-only list
	// said, and the three stage lights were photographing a bright white ceiling. Turning them off here is what
	// makes the dark backdrop the actual background of the shot.
	Capture->ShowFlags.SetAtmosphere(false);
	Capture->ShowFlags.SetFog(false);
	Capture->ShowFlags.SetVolumetricFog(false);
	Capture->ShowFlags.SetMotionBlur(false);
	// The world's own post volumes have no business dressing a wardrobe mirror.
	Capture->bOverride_CustomNearClippingPlane = false;

	Capture->PostProcessBlendWeight = 1.0f;
	FPostProcessSettings& Post = Capture->PostProcessSettings;

	// MANUAL EXPOSURE, PINNED. Min and max equal removes the adaptation entirely, so the picture cannot drift
	// brighter because the room is empty, and two skins photographed a minute apart are actually comparable.
	Post.bOverride_AutoExposureMethod = true;
	Post.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
	Post.bOverride_AutoExposureMinBrightness = true;
	Post.AutoExposureMinBrightness = 1.0f;
	Post.bOverride_AutoExposureMaxBrightness = true;
	Post.AutoExposureMaxBrightness = 1.0f;
	Post.bOverride_AutoExposureBias = true;
	Post.AutoExposureBias = PreviewExposureEv;

	// A LITTLE BLOOM, because the luminous skins -- Celestial Light, Apollo's halo, Skeleton Flame's ghost-fire --
	// are most of their own identity, and none at all makes them read as flat paint.
	Post.bOverride_BloomIntensity = true;
	Post.BloomIntensity = 0.22f;
	// NEUTRAL, so a white skin and a black skin are both readable. The founder asked for lighting that works
	// across white, black, gold, infernal and luminous without a pure-white environment swallowing the white ones.
	Post.bOverride_VignetteIntensity = true;
	Post.VignetteIntensity = 0.28f;
	Post.bOverride_ColorSaturation = true;
	Post.ColorSaturation = FVector4(1.04, 1.04, 1.04, 1.0);
}

void AWonderlandSkinStage::BeginPlay()
{
	Super::BeginPlay();

	RenderTarget = NewObject<UTextureRenderTarget2D>(this, TEXT("SkinStageTarget"));
	RenderTarget->RenderTargetFormat = RTF_RGBA8_SRGB;
	RenderTarget->ClearColor = FLinearColor(0.035f, 0.036f, 0.055f, 1.0f);
	RenderTarget->bAutoGenerateMips = false;
	RenderTarget->InitAutoFormat(TargetWidth, TargetHeight);
	RenderTarget->UpdateResourceImmediate(true);
	Capture->TextureTarget = RenderTarget;

	if (UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, CubePath))
	{
		Backdrop->SetStaticMesh(Cube);
		Plinth->SetStaticMesh(Cube);
	}
	// UNLIT FOR BOTH, because this stage now stands IN THE GARDEN rather than in a dark room of its own.
	//
	// The wall and plinth were painted near-black and then lit by Wonderland's sun, which turned them grey and
	// brown -- photographed in PIE, the preview square's "black" backdrop read as stonework and the plinth read
	// as garden paving, which is exactly the scenery the founder asked to be rid of. Unlit renders the colour as
	// given, whatever the sun is doing.
	UMaterialInterface* Flat = LoadObject<UMaterialInterface>(
		nullptr, TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial"));
	if (Flat == nullptr)
	{
		Flat = LoadObject<UMaterialInterface>(nullptr, PlainMaterialPath);
		UE_LOG(LogTemp, Warning, TEXT("WLSTAGE unlit backdrop material missing; the preview will not read as black"));
	}
	if (UMaterialInterface* Plain = Flat)
	{
		if (UMaterialInstanceDynamic* Dark = UMaterialInstanceDynamic::Create(Plain, this))
		{
			Dark->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.012f, 0.014f, 0.028f, 1.0f));
			Backdrop->SetMaterial(0, Dark);
		}
		if (UMaterialInstanceDynamic* Stone = UMaterialInstanceDynamic::Create(Plain, this))
		{
			// A shade above the wall so the figure still reads as standing ON something rather than floating.
			Stone->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.030f, 0.033f, 0.058f, 1.0f));
			Plinth->SetMaterial(0, Stone);
		}
	}

	EnsureBody();
	AimCamera();

	// WEAR WHAT THE PLAYER IS WEARING. The stage is a view onto the equipped skin, not a second opinion about it, so
	// it follows the registry and never holds a choice of its own.
	if (const UGameInstance* GameInstance = GetGameInstance())
	{
		if (UWonderlandRelaySkinSubsystem* Skins = GameInstance->GetSubsystem<UWonderlandRelaySkinSubsystem>())
		{
			ShowSkin(Skins->GetEquippedSkinId());
			Skins->OnSkinChanged.AddWeakLambda(this, [this](FName SkinId) { ShowSkin(SkinId); });
		}
	}
}

void AWonderlandSkinStage::SetInWorldPreview(bool bOn, FVector Where, FRotator Facing)
{
	EnsureBody();
	// CLOSING THE WARDROBE STOPS THE ROTATION, which the founder asked for explicitly -- and reopening it must
	// start from the front, not from wherever the last inspection was abandoned.
	if (!bOn)
	{
		SetInspectSpin(false);
		Yaw = 0.0f;
		YawTarget = 0.0f;
	}
	bInWorldPreview = bOn;
	const FVector Home = bOn ? Where : StageOrigin();
	SetActorLocation(Home, false, nullptr, ETeleportType::TeleportPhysics);
	SetActorRotation(bOn ? Facing : FRotator::ZeroRotator, ETeleportType::TeleportPhysics);
	if (Body != nullptr)
	{
		// THE BODY IS A SEPARATE ACTOR, not a child, so it has to be carried across by hand. Teleport rather than
		// sweep: it is crossing a kilometre of world and must not try to walk the distance or collide on the way.
		Body->SetActorLocation(Home, false, nullptr, ETeleportType::TeleportPhysics);
		Body->SetActorRotation(bOn ? Facing : FRotator::ZeroRotator, ETeleportType::TeleportPhysics);
	}
	if (Backdrop != nullptr)
	{
		// THE WALL COMES WITH IT NOW, AND THAT IS THE WHOLE POINT.
		//
		// This used to hide the back wall whenever the stage stood in the world, because "a dark wall in the
		// arrival plaza would read as broken scenery" -- true when the preview body stood loose in the open
		// plaza with the player free to walk around it. It is no longer where this stands: the body is placed on
		// the ray leaving the real camera through the centre of the wardrobe's window, so the only thing that
		// ever sees this wall is that window, and a wall is exactly what the founder has asked for there --
		// "a black background preview area... the currently equipped mascot visible there."
		//
		// Behind the body along its own facing, which already points at the viewer, and wide and tall enough
		// that the window's corners are still wall. Square to the body so it never shows an edge.
		Backdrop->SetVisibility(true, true);
		if (bOn)
		{
			const float Reach = FMath::Max(Body != nullptr ? Body->GetFigureHeightUu() : 0.0f, 160.0f);
			Backdrop->SetWorldScale3D(FVector(0.04f, Reach * 0.075f, Reach * 0.055f));
			Backdrop->SetWorldLocation(Home - Facing.Vector() * (Reach * 1.25f) + FVector(0.0, 0.0, Reach * 0.45f));
			Backdrop->SetWorldRotation(Facing + FRotator(0.0, 180.0, 0.0));
		}
	}
	if (Plinth != nullptr)
	{
		// The plinth stays. A figure standing ON something reads as staged; one standing on paving reads as an
		// actor that wandered into the shot.
		Plinth->SetVisibility(true, true);
	}
	UE_LOG(LogTemp, Display, TEXT("WLSKIN in-world preview %s at %s"),
		bOn ? TEXT("ON") : TEXT("OFF"), *Home.ToCompactString());
}

void AWonderlandSkinStage::EnsureBody()
{
	if (Body != nullptr)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return;
	}
	FActorSpawnParameters Params;
	Params.Owner = this;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Body = World->SpawnActor<AWonderlandCompanionEmbodiment>(
		AWonderlandCompanionEmbodiment::StaticClass(), FTransform(GetActorLocation()), Params);
	if (Body == nullptr)
	{
		LastError = TEXT("the stage could not spawn a body");
		return;
	}
	Body->DisplayName = TEXT("RELAY DOG");
	Body->ClassLabel = TEXT("SKIN PREVIEW");
	// THE SAME MASCOT, so what the Wardrobe shows is what the world shows. A preview that ignored the chosen
	// colourway would be showing the player a skin they are not going to get.
	Body->SetBodyRole(EWonderlandBodyRole::Mascot);
#if WITH_EDITOR
	Body->SetActorLabel(TEXT("WL_SkinStage_Dog"), false);
#endif
	// NO CONTROLLER, SO IT FOLLOWS NOBODY and the whole follow path in the embodiment's tick is skipped. This is what
	// keeps it "staying at one place": there is nothing for it to walk toward.
	//
	// AND ITS ACTIVITY IS IDLE AND STAYS IDLE. The runtime activity channel exists so a companion's body reports what
	// its mind is really doing; a mannequin has no mind, and a preview that looked busy would be a claim about an agent.
	Body->SetRuntimeActivity(TEXT("IDLE"));

	Capture->ShowOnlyActors.Reset();
	Capture->ShowOnlyActors.Add(Body);
	Capture->ShowOnlyActors.Add(this);
}

void AWonderlandSkinStage::AimCamera()
{
	// EYE HEIGHT, AND FRAMED TO THE FIGURE THIS SKIN ACTUALLY BUILT. Skins are all one height by construction, but a
	// halo or a crown sticks out above it, so the camera reads the body's measured height rather than a constant and
	// the tallest headpiece in the set still fits in the frame.
	const float Height = Body != nullptr ? FMath::Max(Body->GetFigureHeightUu(), 60.0f) : 160.0f;
	const FVector Eye = FVector(Height * 3.15, -Height * 0.24, Height * 0.62);
	Capture->SetRelativeLocation(Eye);
	Capture->SetRelativeRotation((FVector(0.0, 0.0, Height * 0.50) - Eye).Rotation());
}

bool AWonderlandSkinStage::ShowSkin(FName SkinId)
{
	EnsureBody();
	if (Body == nullptr)
	{
		return false;
	}
	const UGameInstance* GameInstance = GetGameInstance();
	UWonderlandRelaySkinSubsystem* Skins = GameInstance != nullptr
		? GameInstance->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
	if (Skins == nullptr)
	{
		LastError = TEXT("no skin registry");
		return false;
	}
	const FString Figure = Skins->FigurePathFor(SkinId);
	if (Figure.IsEmpty())
	{
		LastError = FString::Printf(TEXT("no figure for skin '%s'"), *SkinId.ToString());
		return false;
	}
	if (!Body->LoadFigure(Figure))
	{
		// THE OLD DRESS STAYS ON. LoadFigure leaves a standing body untouched when it cannot read the new one, so a
		// broken figure file shows the previous skin and an error, never an empty plinth.
		LastError = Body->GetLastError();
		UE_LOG(LogTemp, Warning, TEXT("WLSKINSTAGE could not wear '%s': %s"), *SkinId.ToString(), *LastError);
		return false;
	}
	ShownSkinId = SkinId;
	LastError.Reset();
	AimCamera();
	return true;
}

void AWonderlandSkinStage::MarkWanted()
{
	SinceWanted = 0.0f;
}

void AWonderlandSkinStage::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	SinceWanted += DeltaSeconds;
	const bool bWanted = SinceWanted < ForgetSeconds;
	if (bCapturing != bWanted)
	{
		bCapturing = bWanted;
	}
	if (!bWanted)
	{
		return;
	}

	StepLookAround(DeltaSeconds);

	SinceCapture += DeltaSeconds;
	if (SinceCapture >= CaptureInterval && Capture != nullptr && RenderTarget != nullptr)
	{
		SinceCapture = 0.0f;
		Capture->CaptureScene();
		++FrameCount;
	}
}

void AWonderlandSkinStage::SetInspectSpin(bool bOn)
{
	if (bSpinning == bOn)
	{
		return;
	}
	bSpinning = bOn;
	if (!bSpinning)
	{
		// HOME IS THE FRONT. Wrapped into (-180, 180] first, so a figure stopped at 350 degrees turns the short
		// 10 degrees forward instead of unwinding all the way back round.
		Yaw = FMath::UnwindDegrees(Yaw);
		YawTarget = 0.0f;
	}
	UE_LOG(LogTemp, Display, TEXT("WLSKIN 360 inspection %s"), bOn ? TEXT("ON") : TEXT("OFF"));
}

void AWonderlandSkinStage::StepLookAround(float DeltaSeconds)
{
	if (Body == nullptr)
	{
		return;
	}

	// ---- 360 DEGREE INSPECTION, WHEN THE PLAYER HAS ASKED FOR IT.
	//
	// Twenty-four degrees a second: fifteen seconds for a full turn, which is slow enough to read a ribcage or
	// a chain as it goes past and quick enough that nobody waits for the back. Only the FIGURE turns -- not the
	// stage, not the wardrobe camera, not the player's camera and not the player, which is what the founder
	// asked for in as many words.
	if (bSpinning)
	{
		Yaw += 24.0f * DeltaSeconds;
		if (Yaw >= 360.0f)
		{
			Yaw -= 360.0f;
		}
		YawTarget = Yaw;
		const double SpinNow = GetWorld() != nullptr ? GetWorld()->GetTimeSeconds() : 0.0;
		Body->SetActorLocationAndRotation(
			GetActorLocation() + FVector(0.0, 0.0, static_cast<float>(FMath::Sin(SpinNow * 1.15) * 1.6)),
			FRotator(0.0f, Yaw, 0.0f));
		return;
	}

	// ---- OTHERWISE IT STANDS STILL AND FACES FRONT.
	//
	// FOUNDER, 2026-09-25: "Normal Wardrobe state: STATIC." This used to wander -- a new heading every couple of
	// seconds, up to 52 degrees either way -- which was written when the preview was a viewing room nobody was
	// inspecting a skin in. A player comparing two skins needs them photographed from the same angle, and a
	// player who has just pressed STOP needs the figure to come back to the front rather than stay where it
	// happened to be. The float and the head motion in the figure's own animator carry on underneath, so this
	// is a figure standing still, not a statue.
	if (!FMath::IsNearlyZero(Yaw, 0.05f))
	{
		Yaw = FMath::FInterpTo(Yaw, 0.0f, DeltaSeconds, 3.2f);
	}
	else
	{
		Yaw = 0.0f;
	}
	YawTarget = 0.0f;

	const double Now = GetWorld() != nullptr ? GetWorld()->GetTimeSeconds() : 0.0;
	// A shallow bob the figure's own float does not cover. Small on purpose: this is weight, not a performance.
	const float Bob = static_cast<float>(FMath::Sin(Now * 1.15) * 1.6);
	Body->SetActorLocationAndRotation(
		GetActorLocation() + FVector(0.0, 0.0, Bob),
		FRotator(0.0f, Yaw, 0.0f));
}

AWonderlandSkinStage* AWonderlandSkinStage::Get(UWorld* World)
{
	if (World == nullptr)
	{
		return nullptr;
	}
	for (TActorIterator<AWonderlandSkinStage> It(World); It; ++It)
	{
		return *It;
	}
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	AWonderlandSkinStage* Stage = World->SpawnActor<AWonderlandSkinStage>(
		AWonderlandSkinStage::StaticClass(), FTransform(StageOrigin()), Params);
#if WITH_EDITOR
	if (Stage != nullptr)
	{
		Stage->SetActorLabel(TEXT("WL_SkinStage"), false);
	}
#endif
	return Stage;
}

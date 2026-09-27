#include "WonderlandSkinStage.h"
#include "HAL/IConsoleManager.h"

/**
 * HOW MUCH OF ITS AUTHORED FIRE A FIGURE KEEPS WHILE IT IS IN THE WARDROBE WINDOW.
 *
 * A console variable rather than a literal because the literal went stale without anyone noticing. 0.10 was
 * measured against photographs and was right at the time; two things then moved underneath it -- the founder
 * asked for a close-up preview, so the figure went from filling part of the square to filling 88% of it, and
 * the flames were brought back on the legacy path at wl.Look.FireGain 2.3. Photographed again afterwards,
 * Arden Infernal was a single orange mass with no silhouette in it and the brightest CORNER of the window
 * read 0.98. A number that has to be re-derived every time something near it changes should be a knob.
 *
 * THE 0.98 CORNER WAS A SECOND BUG AND IT IS FIXED SEPARATELY, below in Tick: the scale was applied when the
 * stage changed mode and when the stage loaded a figure, but a skin clicked in the wardrobe's own list goes
 * through the UI rather than the stage, and that body came up wearing its full authored fire. It is now
 * re-applied every frame the wardrobe is open, so there is no path back to the blown state.
 *
 * 0.45, AND IT WAS 0.022 UNTIL THE FIRE MATERIAL SHIPPED. Both came from the same sweep, run twice, and the
 * change between them is a good illustration of why this is a knob rather than a literal.
 *
 * On the legacy voxel glow, 0.022 was the only rung of four that satisfied the wardrobe proof's two
 * conditions for every skin -- corners still the backdrop, middle out-reading them. Then M_WL_Fire was
 * switched on for the world, and it produces far less light per unit of Color than the surface it replaced:
 * the same 0.022 left Arden Infernal's preview at 0.031 luma, a nearly black square, and W12 caught it. The
 * value was never wrong; it was calibrated against a surface that is no longer there.
 *
 * Re-swept on the fire material across 0.45, 0.24, 0.12 and 0.06: Arden's middle goes 0.140, 0.175, 0.120,
 * 0.068 against a backdrop that stays at 0.008, and 0.45 is the rung where Celestial Light's halo sits
 * furthest from the window's corners (0.072, against 0.25 at 0.24 and 0.53 at 0.06).
 *
 * 0.45 was shipped first and W13 caught the other end of the trade: Celestial Light -- a skin that is
 * literally made of light -- filled 0.616 of the whole window against a 0.6 ceiling meant to catch the white
 * brain chamber showing through. 0.32 is between the two measured rungs, which is where the same
 * interpolation-between-two-gate-runs got the night lighting: bright enough that Arden is a figure rather
 * than a black square, dim enough that Celestial Light is a mascot on a stage rather than a lit window.
 */
static float GWonderlandPreviewGlow = 0.32f;
static FAutoConsoleVariableRef GWonderlandPreviewGlowRef(
	TEXT("wl.Look.PreviewGlow"),
	GWonderlandPreviewGlow,
	TEXT("How much of its authored fire a figure keeps in the wardrobe preview window. 1 = untouched."),
	ECVF_Default);

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
	KeyLight->SetIntensity(1150000.0f);
	KeyLight->SetAttenuationRadius(1400.0f);
	KeyLight->SetLightColor(FLinearColor(1.0f, 0.97f, 0.92f));
	KeyLight->SetCastShadows(false);

	FillLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("FillLight"));
	FillLight->SetupAttachment(StageRoot);
	FillLight->SetRelativeLocation(FVector(180.0, 240.0, 90.0));
	FillLight->SetIntensity(332000.0f);
	FillLight->SetAttenuationRadius(1200.0f);
	FillLight->SetLightColor(FLinearColor(0.72f, 0.78f, 1.0f));
	FillLight->SetCastShadows(false);

	RimLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("RimLight"));
	RimLight->SetupAttachment(StageRoot);
	RimLight->SetRelativeLocation(FVector(-250.0, 60.0, 300.0));
	RimLight->SetIntensity(664000.0f);
	RimLight->SetAttenuationRadius(1100.0f);
	RimLight->SetLightColor(FLinearColor(0.62f, 0.70f, 1.0f));
	RimLight->SetCastShadows(false);

	// ---- AND FOUR TIMES THE LIGHT THEY CARRIED, because the channel below only solves half of it.
	//
	// Lighting channels stop the SUN reaching the preview figure, and measured they do exactly that. They do
	// not stop LUMEN: global illumination in UE ignores lighting channels, so the bounce off a sunlit plaza
	// still lands on a figure the sun itself can no longer see. With channels alone the preview went from
	// three times brighter at noon to nearly four, and dimmer overall -- the direct light had gone and the
	// indirect had not.
	//
	// So the rig is made loud enough to swamp what is left. THIRTEEN times, and the way that was arrived at is
	// worth recording, because four looked right first.
	//
	// At four times, Relay OG read 0.0611 at noon and 0.0340 at midnight. The stage contributes the same at
	// both hours, so those two readings separate it from the bounce: the rig is worth about 0.034 and the
	// indirect about 0.027. Doubling should take the spread from 1.8 to about 1.4, and measured it did much
	// better -- 1.09, near perfect. But four was ALSO too dim in absolute terms once the channel had taken
	// the sun away: Relay OG's figure fell to 0.0565 against its own backdrop and Skeleton Flame's to 0.0380,
	// and the wardrobe's own "a figure is standing there" clause failed on both. Taking the sun away means
	// replacing it, not merely balancing it.
	//
	// EIGHT FIXED RELAY OG AND LEFT SKELETON FLAME SHORT, at 0.0202 against the 0.03 its own proof asks for.
	// It is the dimmest skin in the lineup by construction -- bone over a black stage, with a chest skull
	// authored to fall to a twelfth of its brightness between beats -- so it is the one that decides how much
	// light the room needs. Thirteen times is what clears it.
	//
	// ARDEN INFERNAL IS THE COST AND IT IS THE RIGHT ONE TO PAY. A brighter rig lifts a lit body and does
	// nothing for an emissive fire, so the skin that is mostly fire drifts: it reads 1.4x across the day at
	// four times and 2.1x at eight. But it drifts BRIGHTER after dark, which is what fire does, while the
	// alternative was every bone-coated skin going dark -- the fault the founder would actually notice.

	// ---- ALL THREE ON THE SHOWCASE CHANNEL, with the figure and nothing else.
	//
	// Channel 1 is the wardrobe's. Wonderland's sun, moon, fills and every lamp in the world stay on channel
	// 0, so these three cannot spill onto the garden and the garden's light cannot reach the preview. That
	// second half is the point: measured, the preview was three times darker at midnight than at noon because
	// the figure was standing in the open world being lit by the sun through a hole in the panel.
	for (UPointLightComponent* Lamp : {KeyLight.Get(), FillLight.Get(), RimLight.Get()})
	{
		if (Lamp != nullptr)
		{
			Lamp->SetLightingChannels(false, true, false);
		}
	}

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
		// A SIXTH OF THE AUTHORED FIRE WHILE IT IS IN THE WINDOW, and all of it everywhere else.
		//
		// The wardrobe brings the figure close enough to fill a 400-pixel square, and a flame authored at
		// thousands of times white fills that square with one white shape. Measured against the photographs:
		// at 1.0 neither Arden Infernal nor Celestial Light had a readable silhouette; at 0.10 the fire is
		// still plainly fire and the dog inside it is a dog. The Dog standing in the garden is a different
		// actor and is not touched, so the flame quality the founder approved outdoors is exactly as approved.
		Body->SetGlowScale(bOn ? GWonderlandPreviewGlow : 1.0f);
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
	// THE CLOCK DOES NOT REACH THE PREVIEW. See AWonderlandCompanionEmbodiment::SetExposureAware.
	Body->SetExposureAware(false);
	// AND NEITHER DOES THE SUN. The showcase figure and the three lights below share lighting channel 1, so
	// the preview is lit by its own rig at every hour instead of by whatever the sky is doing. See
	// AWonderlandCompanionEmbodiment::SetShowcaseLit for the measurements that made this necessary.
	Body->SetShowcaseLit(true);
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
	// A FRESH FIGURE COMES UP AT ITS AUTHORED FIRE, so a skin clicked while the wardrobe is open has to be
	// told again -- otherwise the second skin the founder tries is the blown-out one.
	Body->SetGlowScale(bInWorldPreview ? GWonderlandPreviewGlow : 1.0f);
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
	// WANTED WHENEVER THE WARDROBE IS SHOWING THIS BODY IN THE WORLD.
	//
	// SinceWanted is fed by the preview BRUSH being painted, which is how the old render-target preview said
	// somebody was looking. The wardrobe no longer draws that brush -- its window is a hole with the figure
	// standing in the world behind it -- so nothing marked the stage wanted, this returned early every frame,
	// and the 360 inspection turned the figure by exactly zero degrees. Measured: eight yaw samples over
	// thirty seconds, all 0.0, with the control reporting itself ON the whole time.
	const bool bWanted = SinceWanted < ForgetSeconds || bInWorldPreview;
	if (bCapturing != bWanted)
	{
		bCapturing = bWanted;
	}
	if (!bWanted)
	{
		return;
	}

	// ---- A NOTE ABOUT THE STAGE LIGHTS, AND A FIX THAT DID NOT WORK.
	//
	// MEASURED (zc_preview_hours): the wardrobe preview is not independent of the world's clock. Relay OG
	// reads 0.1026 luma in the window at noon and 0.0223 at seven in the evening -- four and a half times
	// darker -- while Arden Infernal goes the other way, nearly twice as bright at midnight because its fire
	// is emissive and the night exposure lifts it. Two skins moving in OPPOSITE directions with the clock is
	// the signature of a showcase being lit by the world rather than by its own rig.
	//
	// The obvious cause is that the three lights above are attached to the stage root, and the stage is
	// scaled to about a ninth to bring the figure to the window -- which scales their offsets and their
	// attenuation radii with them. I rewrote them to be placed and sized in world space against the figure
	// every frame, rebuilt, and re-measured: 4.6x became 4.8x. No improvement at all, so the rewrite is not
	// kept -- an unverified change that sounds right is exactly what this project keeps having to undo.
	//
	// So the cause is something else and is NOT YET FOUND. What is ruled out: the lit materials do respond to
	// light (the figure tracks the sun precisely, which is the whole problem), the lights are never switched
	// off in code, and exposure is not it either -- night OPENS the exposure by 1.45 EV, which would make the
	// preview brighter rather than darker. The next thing to check is whether the stage actor's hidden state
	// suppresses its own lights while the wardrobe borrows the world camera.
	//
	// It is left open deliberately rather than papered over. The founder's wardrobe clauses all pass at the
	// hour they are measured at; what does not yet hold is that the preview should look the same at 04:00 as
	// at noon.

	// THE PREVIEW GLOW IS RE-APPLIED RATHER THAN SET ONCE, so wl.Look.PreviewGlow is live. SetGlowScale
	// early-outs unless the value actually moved, so this costs a float compare per frame in the one state
	// where the wardrobe is open.
	if (Body != nullptr && bInWorldPreview)
	{
		Body->SetGlowScale(GWonderlandPreviewGlow);
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
			FRotator(0.0f, static_cast<float>(GetActorRotation().Yaw) + Yaw, 0.0f));
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
	// ---- "FRONT" IS THE STAGE'S FRONT, NOT THE WORLD'S.
	//
	// THE BUG THIS FIXES, and the founder would have seen it before any proof did: the wardrobe was showing
	// the BACK of the mascot. Photographed at noon, Relay OG was a blank pale box with no visor and no status
	// eyes, and Skeleton Flame showed no chest skull and no cyan -- both simply turned away.
	//
	// This line set the figure to world yaw zero. That was correct while the preview was a render target
	// photographed by the stage's own camera, which sat at a fixed angle to the stage: world zero WAS the
	// front. Then the wardrobe became a hole in the panel with the figure standing in the world behind it,
	// the camera became the player's own, and the UI started rotating the STAGE to face wherever that camera
	// is -- while this went on turning the BODY to face world +X. The two disagreed by however far the player
	// happened to be standing round the figure.
	//
	// The inspection yaw is now an offset from the stage's heading rather than an absolute, so 0 means facing
	// the lens and the 360 button still turns the figure and nothing else.
	//
	// Worth saying: zc_wardrobe_pixels passed 12/12 through all of this, because "the corners are black and
	// the middle is brighter" is true of a Dog's back as well as its face.
	Body->SetActorLocationAndRotation(
		GetActorLocation() + FVector(0.0, 0.0, Bob),
		FRotator(0.0f, static_cast<float>(GetActorRotation().Yaw) + Yaw, 0.0f));
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

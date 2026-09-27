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
/**
 * HOW MANY STOPS THE WARDROBE'S OWN CAMERA OPENS.
 *
 * THE REASON THE CAPTURE PATH WAS ABANDONED, and it is one number. The stage's SceneCapture2D was carrying
 * AutoExposureBias = 11, which is a 2048x boost -- so every skin it photographed came back a featureless
 * white silhouette, the path was written off as "wrote pure white in this build under ten configurations",
 * and the wardrobe was rebuilt as a hole in the panel showing the live world. That hole is the reason this
 * square has since shown the brain chamber, the garden, a staircase, the Dog's back and a nearly black frame:
 * anything in Wonderland is a candidate to appear in a window onto Wonderland.
 *
 * The +11 was not absurd when it was written -- the capture was photographing a dark room. Then the sky was
 * switched off in the show flags and three lights were pointed at the figure, and nobody came back to it.
 *
 * A console variable rather than a literal, because this is exactly the kind of number that goes stale when
 * something near it changes, and this file has now been bitten by that twice.
 */
static float GWonderlandPreviewExposure = 0.0f;
static FAutoConsoleVariableRef GWonderlandPreviewExposureRef(
	TEXT("wl.Look.PreviewExposure"),
	GWonderlandPreviewExposure,
	TEXT("Exposure bias, in stops, for the wardrobe's own capture camera."),
	ECVF_Default);

/**
 * HOW BRIGHT THE STAGE LAMPS ARE, AS A FRACTION OF WHAT THEY WERE AUTHORED AT.
 *
 * THE ACTUAL REASON THIS WINDOW HAS BEEN WHITE. The three lamps below are written at 90,000, 26,000 and
 * 52,000 candelas, which are sane numbers for a stage the size of a room. The wardrobe does not use a stage
 * the size of a room -- it shrinks the whole rig down to bring the figure to a small panel, and the lamps
 * came along at full strength. Three of them end up roughly a metre from a figure the size of a hand, which
 * is on the order of fifty thousand lux: direct summer daylight, indoors, pointed at a white dog.
 *
 * That is why thirteen stops of exposure bias changed almost nothing. Exposure was never the saturating
 * term. Measured across a sweep, a twenty-fifth of the authored intensity is where Relay OG stops being a
 * white silhouette and becomes a bone-white figure with shading, feet, ears and gold eyes on black.
 *
 * Kept as a multiplier of the authored values rather than as new literals, so the lighting RATIO the stage
 * was designed with -- key, fill, rim -- survives untouched and only the overall level moves.
 */
/**
 * HOW MUCH OF THE PREVIEW FRAME THE MASCOT'S BODY FILLS.
 *
 * FOUNDER: "75-85% of usable preview height." A control and not a literal because the literal it replaces --
 * a camera distance of Height * 3.15, which works out to 41.5% -- is exactly the kind of number that is
 * written once, is never checked against a photograph, and survives four rounds of "the mascot is tiny".
 */
static float GWonderlandPreviewFill = 0.80f;
static FAutoConsoleVariableRef GWonderlandPreviewFillRef(
	TEXT("wl.Look.PreviewFill"),
	GWonderlandPreviewFill,
	TEXT("Fraction of the wardrobe preview frame the mascot's BODY fills on whichever axis binds."),
	ECVF_Default);

static float GWonderlandPreviewLights = 0.040f;
static FAutoConsoleVariableRef GWonderlandPreviewLightsRef(
	TEXT("wl.Look.PreviewLights"),
	GWonderlandPreviewLights,
	TEXT("Stage lamp intensity in the wardrobe, as a fraction of the authored values. 1 = untouched."),
	ECVF_Default);

/**
 * HOW FAR THE LUMINOUS SKINS ARE ALLOWED TO BLEED.
 *
 * Bloom scales with how far over white a pixel is, so a figure whose fire is authored for a plaza in daylight
 * and then photographed from a metre away does not merely clip -- it throws a halo wide enough to fill the
 * frame. That halo is what has been read as "the preview is empty and white": Arden Infernal at the authored
 * settings is a gold cloud with no dog in it, and the dog is in there, in the middle, about a sixth of the
 * frame wide.
 *
 * This is the second of the two terms. The first is the light level above; this one stops the fire that
 * SURVIVES that reduction from smearing across everything the founder is trying to look at.
 */
static float GWonderlandPreviewBloom = 0.015f;
static FAutoConsoleVariableRef GWonderlandPreviewBloomRef(
	TEXT("wl.Look.PreviewBloom"),
	GWonderlandPreviewBloom,
	TEXT("Bloom intensity for the wardrobe's capture camera, above PreviewBloomFloor."),
	ECVF_Default);

/**
 * HOW BRIGHT A PIXEL HAS TO BE BEFORE IT IS ALLOWED TO BLOOM.
 *
 * The control that was missing entirely. Without it bloom treats a lit white flank the same as a flame, and
 * the wardrobe's black backdrop fills in until there is no figure left to look at. One means "only what is
 * actually brighter than white", which is the fire, the eyes and the halos -- the things whose glow is the
 * point -- and leaves the bone body to be lit rather than smeared.
 */
static float GWonderlandPreviewBloomFloor = 1.0f;
static FAutoConsoleVariableRef GWonderlandPreviewBloomFloorRef(
	TEXT("wl.Look.PreviewBloomFloor"),
	GWonderlandPreviewBloomFloor,
	TEXT("Luminance a pixel must exceed before it blooms in the wardrobe preview."),
	ECVF_Default);

static float GWonderlandPreviewGlow = 0.0015f;
static FAutoConsoleVariableRef GWonderlandPreviewGlowRef(
	TEXT("wl.Look.PreviewGlow"),
	GWonderlandPreviewGlow,
	TEXT("How much of its authored fire a figure keeps in the wardrobe preview window. 1 = untouched. "
	     "0.32 was measured against the OLD wardrobe, which was a hole in the panel showing the figure at "
	     "plaza distance under the world's own exposure. The panel now paints a capture taken from a metre "
	     "away in a black box, and at that range Skeleton Flame's ghostfire measures 70 to 550 in linear -- "
	     "hundreds of times over white -- so it clips and blooms until the frame is a white rectangle. Swept "
	     "against the fixed lamp level, a hundredth is where a body becomes legible underneath its own fire."),
	ECVF_Default);

#include "Components/PointLightComponent.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Engine/TextureRenderTarget2D.h"
#include "TextureResource.h"
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

	// ---- AND FOUR TIMES THE LIGHT THEY CARRIED, because the channel below only solves half of it.
	//
	// Lighting channels stop the SUN reaching the preview figure, and measured they do exactly that. They do
	// not stop LUMEN: global illumination in UE ignores lighting channels, so the bounce off a sunlit plaza
	// still lands on a figure the sun itself can no longer see. With channels alone the preview went from
	// three times brighter at noon to nearly four, and dimmer overall -- the direct light had gone and the
	// indirect had not.
	//
	// AND BACK TO THE VALUES A DARK ROOM NEEDS, because the rig is being photographed by its OWN camera again.
	//
	// These were driven up to thirteen times their authored strength for a preview that was a HOLE in the
	// panel -- the mascot standing in the open world, competing with a 70,000 lux sun. That approach is gone: the
	// wardrobe paints the stage's own SceneCapture2D again, which sees only the body and the stage and is
	// lit by nothing but these three. Exported at thirteen times, every skin came back a featureless white
	// silhouette. A room needs room lighting.

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

	// ---- THE LAMPS COME DOWN TO THE SIZE OF THE STAGE THEY ARE ACTUALLY LIGHTING.
	//
	// Done here, next to the exposure, because these two and the glow are one decision about how bright this
	// little room is, and splitting them across the constructor and the tick is how the stale +11 survived.
	// The authored values are the ratio; the multiplier is the level.
	for (UPointLightComponent* Lamp : {KeyLight.Get(), FillLight.Get(), RimLight.Get()})
	{
		if (Lamp == nullptr)
		{
			continue;
		}
		const float Authored =
			(Lamp == KeyLight.Get()) ? 90000.0f : ((Lamp == FillLight.Get()) ? 26000.0f : 52000.0f);
		const float Wanted = Authored * FMath::Max(GWonderlandPreviewLights, 0.0f);
		if (!FMath::IsNearlyEqual(Lamp->Intensity, Wanted, 0.5f))
		{
			Lamp->SetIntensity(Wanted);
		}
	}

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
	Post.AutoExposureBias = GWonderlandPreviewExposure;

	// A LITTLE BLOOM, because the luminous skins -- Celestial Light, Apollo's halo, Skeleton Flame's ghost-fire --
	// are most of their own identity, and none at all makes them read as flat paint.
	//
	// ---- AND A THRESHOLD, WHICH IS THE THING THAT WAS MISSING AND THE REASON THIS WINDOW STAYED WHITE.
	//
	// Isolated by taking each candidate to zero in turn with the others held. Killing bloom took Celestial
	// Light's mean from 237 to 105 and Skeleton Flame's from 245 to 119; killing the LAMPS changed neither of
	// them by a single count. Meanwhile the flame surface, read back live, was carrying (0.08, 0.24, 0.34) and
	// (0.43, 0.56, 0.59) -- every channel under white. The fire was innocent and correctly scaled the whole
	// time, and three rounds of turning the glow down were chasing the wrong term. The giveaway was the same
	// one that settled the exposure question earlier: a thirty-fold change in glow moved the picture barely at
	// all, and a term that can move that far without mattering is not the term doing the damage.
	//
	// With no threshold set, bloom is applied to EVERYTHING, mid-greys included -- so a lit white dog smears
	// across its own black backdrop until the corners are as bright as the subject. At 1.0 only pixels that
	// are genuinely over white bloom, which is exactly the fire, the eyes and the halos and nothing else. The
	// intensity can therefore go back up: it is now gated by what deserves it rather than applied to all.
	// AND THE THRESHOLD ONLY EXISTS ON ONE OF THE TWO BLOOM METHODS, which is why setting it alone did
	// nothing. Convolution bloom -- the modern default -- convolves the whole image with a kernel and has no
	// threshold to set: the field is simply ignored. Measured, adding the threshold without the method made
	// the picture WORSE, because the raised intensity that was meant to be gated by it applied to everything
	// instead: Celestial Light went from 237 to 251. Standard bloom is the one that can be told what deserves
	// to glow.
	Post.bOverride_BloomMethod = true;
	Post.BloomMethod = EBloomMethod::BM_SOG;
	Post.bOverride_BloomIntensity = true;
	Post.BloomIntensity = GWonderlandPreviewBloom;
	Post.bOverride_BloomThreshold = true;
	Post.BloomThreshold = GWonderlandPreviewBloomFloor;
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

FString AWonderlandSkinStage::MeasureOccupancy() const
{
	// ---- THE VISUAL REGRESSION GATE, IN THE ENGINE, WHERE IT CANNOT BE FORGOTTEN.
	//
	// FOUNDER: "Build a visual regression gate so this class of bug cannot silently return." Until now the
	// occupancy that proves the wardrobe correct was measured OUTSIDE the editor, by decoding the exported
	// PNGs in a script I happened to run. That is not a gate. It is a habit, and habits are exactly what
	// stopped being performed in the four rounds where a passing proof sat beside a broken picture.
	//
	// So the render target is read back here and the subject's bounding box measured from the actual pixels
	// the founder sees. A proof can then FAIL in-engine on the thing that matters -- how much of the frame
	// the mascot fills -- instead of on a camera distance it just finished writing, which is the tautology
	// this whole class of bug hid behind.
	if (RenderTarget == nullptr)
	{
		return TEXT("no render target");
	}
	FTextureRenderTargetResource* Resource = RenderTarget->GameThread_GetRenderTargetResource();
	if (Resource == nullptr)
	{
		return TEXT("no render target resource");
	}
	TArray<FColor> Pixels;
	if (!Resource->ReadPixels(Pixels) || Pixels.Num() <= 0)
	{
		return TEXT("the render target could not be read back");
	}
	const int32 W = RenderTarget->SizeX;
	const int32 H = RenderTarget->SizeY;
	if (W <= 0 || H <= 0 || Pixels.Num() < W * H)
	{
		return FString::Printf(TEXT("unexpected readback: %d pixels for %dx%d"), Pixels.Num(), W, H);
	}

	// THE BACKDROP IS BLACK AND THE FIGURE IS LIT, so a low luma floor separates them cleanly. It is reported
	// beside the answer rather than hidden, because a wrong threshold must not be able to sit inside a number.
	const int32 Floor = 34;
	int32 MinX = W, MinY = H, MaxX = -1, MaxY = -1;
	int64 Lit = 0;
	int64 Total = 0;
	for (int32 Y = 0; Y < H; ++Y)
	{
		for (int32 X = 0; X < W; ++X)
		{
			const FColor& C = Pixels[Y * W + X];
			const int32 Luma = (C.R * 54 + C.G * 183 + C.B * 19) >> 8;
			Total += Luma;
			if (Luma >= Floor)
			{
				++Lit;
				MinX = FMath::Min(MinX, X);
				MaxX = FMath::Max(MaxX, X);
				MinY = FMath::Min(MinY, Y);
				MaxY = FMath::Max(MaxY, Y);
			}
		}
	}
	if (MaxX < 0)
	{
		return FString::Printf(TEXT("empty target=%dx%d threshold=%d mean=0.0"), W, H, Floor);
	}
	const float HeightPct = 100.0f * static_cast<float>(MaxY - MinY + 1) / static_cast<float>(H);
	const float WidthPct = 100.0f * static_cast<float>(MaxX - MinX + 1) / static_cast<float>(W);
	return FString::Printf(
		TEXT("heightPct=%.1f widthPct=%.1f centreXPct=%.1f centreYPct=%.1f litPct=%.1f mean=%.1f ")
		TEXT("target=%dx%d threshold=%d"),
		HeightPct, WidthPct,
		100.0f * (MinX + MaxX) * 0.5f / static_cast<float>(W),
		100.0f * (MinY + MaxY) * 0.5f / static_cast<float>(H),
		100.0f * static_cast<float>(Lit) / static_cast<float>(W * H),
		static_cast<float>(Total) / static_cast<float>(W * H),
		W, H, Floor);
}

void AWonderlandSkinStage::AimCamera()
{
	// ---- THE CAMERA IS SOLVED AGAINST THE BODY, AND THIS IS THE FIX FOR "THE MASCOT RENDERS TINY".
	//
	// WHAT WAS HERE, AND WHY IT COULD NEVER BE RIGHT. The eye stood at a hard literal -- Height * 3.15 -- with
	// a 34 degree lens on a 640x800 target. Work it through: the visible height at that distance is
	// 2 * 3.15H * tan(17deg) / 0.8, which is 2.41H, so a figure of height H covers 41.5% of the frame. Measured
	// off the exported pixels rather than off the camera, the figure covered 42-43%. The arithmetic and the
	// photograph agree, and 41.5% is a long way from the 75-85% the founder asked for.
	//
	// WHY EVERY PREVIOUS FRAMING FIX MISSED IT. They were all made in the UI subsystem, which solves a distance
	// for the PLAYER's 90 degree camera and the window's fraction of the SCREEN. That solve was correct for the
	// old wardrobe, which was a hole in the panel showing the live world. The panel now paints THIS capture
	// instead -- a different camera, a different lens, a different target -- and nothing ever solved it. Two
	// framing systems, one of them unused, and the founder was looking at the one nobody was fixing.
	//
	// AND IT READ THE WRONG HEIGHT. GetFigureHeightUu is the declared envelope: it includes Apollo's crown,
	// Celestial Light's banner and whatever Arden's fire is doing this frame. Framing on it makes the BODY
	// smaller the more ornamented the skin is, and makes an animated flame move the camera every frame. The
	// founder's instruction was explicit -- framing must derive from the physical body, not the total actor
	// bounds -- so this reads GetFramingBodyBounds, which is the lit and rim meshes only and is stateless.
	const float Fallback = Body != nullptr ? FMath::Max(Body->GetFigureHeightUu(), 60.0f) : 160.0f;
	float Tall = Fallback;
	float Wide = Fallback * 0.5f;
	float MeasuredTall = -1.0f;
	float MeasuredWide = -1.0f;
	float MiddleZ = GetActorLocation().Z + Fallback * 0.5f;
	bool bOnBody = false;
	if (Body != nullptr)
	{
		const FBox Drawn = Body->GetFramingBodyBounds();
		if (Drawn.IsValid && Drawn.GetExtent().Z > 1.0)
		{
			const FVector Half = Drawn.GetExtent();
			// THE RAW READING IS KEPT, and it is kept because a floor under it has already lied once. A broken
			// bounds calculation measured every skin at a few uu, the Max below rounded all five up to exactly
			// 30.0, and the framing note then reported a clean identical number for five figures of visibly
			// different sizes. A clamp that cannot be seen is indistinguishable from a measurement.
			MeasuredTall = static_cast<float>(Half.Z) * 2.0f;
			MeasuredWide = FMath::Max(static_cast<float>(Half.X), static_cast<float>(Half.Y)) * 2.0f;
			Tall = FMath::Max(MeasuredTall, 30.0f);
			Wide = FMath::Max(MeasuredWide, 15.0f);
			MiddleZ = static_cast<float>(Drawn.GetCenter().Z);
			bOnBody = true;
		}
	}

	// ---- BOTH AXES, AT THE SAME FILL, AGAINST THIS CAPTURE'S OWN LENS AND ITS OWN TARGET SHAPE.
	// FOVAngle on a scene capture is the HORIZONTAL angle; the vertical follows from the target's aspect.
	const float TanH = FMath::Tan(FMath::DegreesToRadians(FMath::Max(Capture->FOVAngle, 1.0f) * 0.5f));
	const float AspectW = static_cast<float>(FMath::Max(TargetWidth, 1));
	const float AspectH = static_cast<float>(FMath::Max(TargetHeight, 1));
	const float TanV = TanH * (AspectH / AspectW);
	const float Fill = FMath::Clamp(GWonderlandPreviewFill, 0.20f, 0.98f);
	const float FitTall = Tall / (2.0f * Fill * FMath::Max(TanV, KINDA_SMALL_NUMBER));
	const float FitWide = Wide / (2.0f * Fill * FMath::Max(TanH, KINDA_SMALL_NUMBER));
	// ---- HEIGHT IS THE AXIS THE FOUNDER SPECIFIED, AND WIDTH IS ONLY ALLOWED TO PUSH SO FAR.
	//
	// Taking whichever axis bound outright looked reasonable and cost Apollo its framing: its solar geometry is
	// parented to the BODY part rather than to an ornament, so the body box comes out wider than it is tall
	// (47.2 against 32.9). Width then won, the camera backed off to 96, and Apollo photographed at 52% of frame
	// height while every other skin sat at 80. A skin should not shrink because one of its parts is filed under
	// the wrong name.
	//
	// The requirement is "75-85% of usable preview HEIGHT", so height binds. Width may still pull the camera
	// back, but no further than a quarter -- enough that a genuinely broad figure is not sliced down the sides,
	// not so much that one wide part can halve the subject. Ornaments reaching past the frame edge is expected
	// and wanted: the founder's instruction is that framing derives from the body and the VFX are excluded
	// from it, which necessarily means the VFX sometimes leave the picture.
	const float WidthAllowance = 1.25f;
	const float Distance = FMath::Clamp(
		FMath::Min(FMath::Max(FitTall, FitWide), FitTall * WidthAllowance), 40.0f, 6000.0f);

	// A THREE-QUARTER EYE, placed at exactly Distance along its own ray rather than at Distance on X with a
	// side offset added -- the old form made the true distance longer than the solve, which is its own small
	// shrink on top of the large one.
	// ---- AND THE EYE STANDS IN FRONT OF THE FIGURE, NOT AT A FIXED COMPASS BEARING.
	//
	// The ray used to be built in WORLD space. The old camera was placed with SetRelativeLocation, so it turned
	// with the stage for free; moving the solve to world coordinates quietly dropped that, and the camera then
	// stood wherever world +X happened to be. StepLookAround faces the figure along the STAGE's forward, so the
	// two no longer agreed and the wardrobe photographed the Dog's back -- the third time this project has
	// shipped a confident picture of the wrong side of the mascot.
	const float EyeYaw = FMath::DegreesToRadians(-8.0f);
	const FVector Ray = GetActorRotation().RotateVector(
		FVector(FMath::Cos(EyeYaw), FMath::Sin(EyeYaw), 0.0f));
	// Aimed at the body's own middle, so the figure is centred on what is being framed rather than on a
	// fraction of a declared height that no longer describes it.
	const FVector Focus(GetActorLocation().X, GetActorLocation().Y, MiddleZ);
	const FVector Eye = Focus + Ray * Distance;
	Capture->SetWorldLocation(Eye);
	Capture->SetWorldRotation((Focus - Eye).Rotation());

	// EVERYTHING THE SOLVE USED, so the prediction can be put beside the occupancy measured off the exported
	// pixels. The actor SCALE is in here because it is the one term that silently makes the declared envelope
	// and the measured body box disagree: a figure staged at half size is half as tall in world units while
	// still declaring its full height, and without the scale printed the two numbers look like a bug.
	const FVector ShownScale = Body != nullptr ? Body->GetActorScale3D() : FVector::OneVector;
	const float GlowInForce = Body != nullptr ? Body->GetGlowScale() : -1.0f;
	FramingNote = FString::Printf(
		TEXT("onBody=%d bodyTall=%.1f bodyWide=%.1f rawTall=%.1f rawWide=%.1f envelope=%.0f scale=%.3f ")
		TEXT("fill=%.2f glow=%.4f fitTall=%.0f fitWide=%.0f distance=%.0f fov=%.1f target=%dx%d ")
		TEXT("predictedHeightPct=%.1f"),
		bOnBody ? 1 : 0, Tall, Wide, MeasuredTall, MeasuredWide, Fallback, ShownScale.Z,
		Fill, GlowInForce, FitTall, FitWide, Distance,
		Capture->FOVAngle, TargetWidth, TargetHeight,
		100.0f * Tall / FMath::Max(2.0f * Distance * TanV, KINDA_SMALL_NUMBER));
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

	// The exposure is re-applied for the same reason the glow is: so it can be swept in one session.
	ApplyPreviewExposure();

	// ---- AND THE CAMERA IS RE-SOLVED, WHICH IS THE FIX FOR A MASCOT FRAMED OFF A HALF-BUILT FIGURE.
	//
	// AimCamera used to run once, at the moment a skin was shown. At that moment the figure is still being
	// assembled: components are created, attached and registered in a loop, and a component's Bounds is only
	// meaningful once it has been registered. So the solve measured whatever existed when it happened to look.
	//
	// THE EVIDENCE THAT THIS IS THE CAUSE RATHER THAN A THEORY. Summing Relay OG's body parts from the figure
	// itself gives a 53 uu body; the solve recorded 30.0 at the same moment. And the shortfall tracks how much
	// there is to build -- Relay OG and Celestial Light read ~30, Apollo 21.3, Skeleton Flame, the heaviest
	// figure in the set, only 13.1. A measurement that gets worse the more there is to measure is a
	// measurement taken too early, not a bad classifier and not bad geometry.
	//
	// Re-solving every frame the wardrobe is open cannot drift, because the solve is a pure function of a
	// stateless body box: the same skin gives the same distance every time it is asked. It simply stops being
	// able to ask before the answer exists. The cost is a bounds union over a couple of dozen components on
	// one actor, in the one state where a wardrobe is on screen.
	AimCamera();

	// THE PREVIEW GLOW IS RE-APPLIED RATHER THAN SET ONCE, so wl.Look.PreviewGlow is live. SetGlowScale
	// early-outs unless the value actually moved, so this costs a float compare per frame in the one state
	// where the wardrobe is open.
	//
	// AND IT APPLIES WHENEVER THIS STAGE IS BEING LOOKED AT, NOT ONLY IN THE OLD IN-WORLD MODE. The condition
	// here used to be bInWorldPreview, which is the wardrobe-as-a-hole-in-the-panel path. The panel now paints
	// this stage's CAPTURE instead, and on that path bInWorldPreview is false -- so the glow reduction never
	// ran, GlowScale stayed at 1.0, and Skeleton Flame and Celestial Light photographed as white rectangles no
	// matter what wl.Look.PreviewGlow was set to. Lowering the default changed nothing at all, which is the
	// tell: a setting that does not move the picture is a setting that is not being read.
	//
	// Reaching this line already means the stage is wanted -- the early-out above returns otherwise -- so the
	// reduction now follows the thing it was written for: a figure being photographed a metre away in a box.
	if (Body != nullptr)
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
	// The founder's own control always wins over an angle a proof pinned. See SetInspectionYaw.
	bHeldYaw = false;
	if (!bSpinning)
	{
		// HOME IS THE FRONT. Wrapped into (-180, 180] first, so a figure stopped at 350 degrees turns the short
		// 10 degrees forward instead of unwinding all the way back round.
		Yaw = FMath::UnwindDegrees(Yaw);
		YawTarget = 0.0f;
	}
	UE_LOG(LogTemp, Display, TEXT("WLSKIN 360 inspection %s"), bOn ? TEXT("ON") : TEXT("OFF"));
}

void AWonderlandSkinStage::SetInspectionYaw(float Degrees)
{
	// Pinned rather than spun: bSpinning drives the 24-degrees-a-second inspection, and bHeldYaw stops the
	// interpolation back to front that would otherwise erase this before the next capture.
	bSpinning = false;
	bHeldYaw = true;
	Yaw = FRotator::ClampAxis(Degrees);
	YawTarget = Yaw;
	if (Body != nullptr)
	{
		Body->SetActorRotation(FRotator(0.0f, static_cast<float>(GetActorRotation().Yaw) + Yaw, 0.0f));
	}
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
	if (!bHeldYaw && !FMath::IsNearlyZero(Yaw, 0.05f))
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

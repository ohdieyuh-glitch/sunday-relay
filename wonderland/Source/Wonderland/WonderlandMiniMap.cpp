#include "WonderlandMiniMap.h"

#include "Components/SceneCaptureComponent2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Textures/SlateShaderResource.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandMiniMap, Log, All);

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandMiniMapDetail
{
	TAutoConsoleVariable<int32> CVarCapture(
		TEXT("wl.MiniMap.Capture"), 1,
		TEXT("1 photographs the ground for the mini-map; 0 stops the camera and draws the disc without it."));
	TAutoConsoleVariable<int32> CVarSource(
		TEXT("wl.MiniMap.Source"), 0,
		TEXT("0 photographs the ground's BASE COLOUR: unlit, flat, and immune to exposure. 1 photographs the lit final colour under a manual exposure (wl.MiniMap.ExposureBias)."));
	TAutoConsoleVariable<float> CVarExposureBias(
		TEXT("wl.MiniMap.ExposureBias"), -14.0f,
		TEXT("Manual exposure, EV, for the lit photograph (wl.MiniMap.Source 1) only. This world is lit physically, so daylight wants a strongly negative value."));
	TAutoConsoleVariable<float> CVarHz(
		TEXT("wl.MiniMap.Hz"), 0.0f,
		TEXT("Photographs per second, overriding the settings while above zero. For measuring what the rate costs."));
	TAutoConsoleVariable<int32> CVarDebugRaw(
		TEXT("wl.MiniMap.DebugRaw"), 0,
		TEXT("1 also draws the whole raw photograph as a small square in the disc's corner, through a plain image brush: separates 'the capture is wrong' from 'the disc draws it wrong'."));
	TAutoConsoleVariable<int32> CVarDrawMode(
		TEXT("wl.MiniMap.DrawMode"), 4,
		TEXT("How the disc draws the photograph. 4, the default, is a textured fan with UVs inside the texture's proxy region. The rest are kept for comparison: 0 rounded box, ignore alpha, draw tint; 1 square image, ignore alpha, draw tint; 2 rounded box, alpha honoured, brush tint; 3 rounded box, ignore alpha, brush tint; 5 no photograph."));
	TAutoConsoleVariable<int32> CVarLumen(
		TEXT("wl.MiniMap.Lumen"), 0,
		TEXT("1 lets the mini-map photograph use Lumen. Off by default: it is a second view, and a small one."));

	/** A place that can name the region the player stands in. */
	bool NamesARegion(const FWonderlandMiniMapPlace& Place)
	{
		return Place.Kind != EWonderlandTravelKind::Landmark || !Place.Region.IsEmpty();
	}

	FString RegionName(const FWonderlandMiniMapPlace& Place)
	{
		return (Place.Region.IsEmpty() ? Place.Name : Place.Region).ToUpper();
	}

	FVector2f Polar(const FVector2f& Centre, float Radius, float AngleDeg)
	{
		const float A = FMath::DegreesToRadians(AngleDeg);
		return Centre + FVector2f(FMath::Cos(A), FMath::Sin(A)) * Radius;
	}
}

FWonderlandMiniMapLabel WonderlandResolveMiniMapLabel(const TArray<FWonderlandMiniMapPlace>& Places,
	const FVector2D& PlayerXY, double RegionRadiusUU, const FString& WorldName)
{
	FWonderlandMiniMapLabel Label;
	Label.World = WorldName.ToUpper();
	const FWonderlandMiniMapPlace* Nearest = nullptr;
	double NearestDistance = TNumericLimits<double>::Max();
	for (const FWonderlandMiniMapPlace& Place : Places)
	{
		if (!WonderlandMiniMapDetail::NamesARegion(Place))
		{
			continue;
		}
		const double Distance = FVector2D::Distance(Place.XY, PlayerXY);
		if (Distance < NearestDistance)
		{
			NearestDistance = Distance;
			Nearest = &Place;
		}
	}
	if (Nearest == nullptr)
	{
		// No offered place at all: the world's name and nothing else. An empty line is honest; a guessed one is not.
		return Label;
	}
	Label.RegionPlaceId = Nearest->Id;
	Label.RegionDistanceUU = NearestDistance;
	Label.bInsideRegion = NearestDistance <= RegionRadiusUU;
	Label.Region = Label.bInsideRegion
		? WonderlandMiniMapDetail::RegionName(*Nearest)
		: FString::Printf(TEXT("TOWARD %s"), *WonderlandMiniMapDetail::RegionName(*Nearest));
	return Label;
}

// ---------------------------------------------------------------------------------------------------------------- driver

void UWonderlandMiniMapDriver::Start(APlayerController* InController)
{
	Stop();
	Controller = InController;
	const UWonderlandMiniMapSettings* Settings = GetDefault<UWonderlandMiniMapSettings>();
	const int32 Size = FMath::Clamp(Settings->RenderTargetSize, 128, 1024);

	Target = NewObject<UTextureRenderTarget2D>(this, TEXT("WonderlandMiniMapTarget"), RF_Transient);
	Target->RenderTargetFormat = RTF_RGBA8_SRGB;
	Target->ClearColor = FLinearColor(0.010f, 0.012f, 0.020f, 1.0f);
	Target->InitAutoFormat(Size, Size);
	Target->UpdateResourceImmediate(true);

	CaptureBrush = FSlateBrush();
	CaptureBrush.SetResourceObject(Target);
	CaptureBrush.ImageSize = FVector2D(Size, Size);
	CaptureBrush.DrawAs = ESlateBrushDrawType::Image;

	Frame = FWonderlandMiniMapFrame();
	Frame.ViewRadiusUU = Settings->ViewRadiusUU;
	Frame.CaptureWidthUU = Settings->CaptureWidthUU;
	CaptureCount = 0;
	LastCaptureSeconds = -1.0;
	LastPlacesSeconds = -1.0;

	const TWeakObjectPtr<UWonderlandMiniMapDriver> WeakThis(this);
	TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakThis](float DeltaTime)
	{
		return WeakThis.IsValid() ? WeakThis->Tick(DeltaTime) : false;
	}));
}

void UWonderlandMiniMapDriver::Stop()
{
	if (TickHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
		TickHandle.Reset();
	}
	if (AActor* Actor = CaptureActor.Get())
	{
		Actor->Destroy();
	}
	CaptureActor.Reset();
	Capture.Reset();
	Frame.bHasCapture = false;
}

bool UWonderlandMiniMapDriver::IsCaptureInWorld() const
{
	return CaptureActor.IsValid() && Capture.IsValid();
}

bool UWonderlandMiniMapDriver::Tick(float DeltaTime)
{
	const APlayerController* PC = Controller.Get();
	UWorld* World = PC != nullptr ? PC->GetWorld() : nullptr;
	const APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
	if (World == nullptr || Pawn == nullptr)
	{
		Frame.bHasPlayer = false;
		return true;
	}
	const UWonderlandMiniMapSettings* Settings = GetDefault<UWonderlandMiniMapSettings>();
	const double Now = FPlatformTime::Seconds();

	const FVector PawnAt = Pawn->GetActorLocation();
	Frame.bHasPlayer = true;
	Frame.PlayerXY = FVector2D(PawnAt.X, PawnAt.Y);
	Frame.PawnYawDeg = Pawn->GetActorRotation().Yaw;
	Frame.CameraYawDeg = PC->GetControlRotation().Yaw;
	Frame.ViewRadiusUU = Settings->ViewRadiusUU;

	// The registry changes rarely and a travel moves anchors never, so the places are re-read every two seconds.
	if (LastPlacesSeconds < 0.0 || Now - LastPlacesSeconds > 2.0)
	{
		RefreshPlaces(World);
		LastPlacesSeconds = Now;
	}
	Frame.Label = WonderlandResolveMiniMapLabel(Places, Frame.PlayerXY, Settings->RegionRadiusUU, Settings->WorldName);
	Frame.NearbyPlaces.Reset();
	for (const FWonderlandMiniMapPlace& Place : Places)
	{
		if (FVector2D::Distance(Place.XY, Frame.PlayerXY) <= Settings->ViewRadiusUU * 1.05)
		{
			Frame.NearbyPlaces.Add(Place);
		}
	}

	// THE CAMERA RUNS ONLY WHILE THE MAP CAN BE SEEN. Half a second without a paint means a panel is over it.
	const bool bSeen = LastPaintSeconds >= 0.0 && Now - LastPaintSeconds < 0.5;
	if (!bSeen || WonderlandMiniMapDetail::CVarCapture.GetValueOnGameThread() == 0)
	{
		return true;
	}
	if (!EnsureCapture(World))
	{
		return true;
	}
	// A photograph is due on the clock, or at once when the Dog has walked (or travelled) far enough that the disc
	// would run off the edge of the last one.
	const double Slack = Settings->CaptureWidthUU * 0.5 - Settings->ViewRadiusUU * 1.05;
	const bool bDue = !Frame.bHasCapture
		|| Now - LastCaptureSeconds >= 1.0 / FMath::Max(WonderlandMiniMapDetail::CVarHz.GetValueOnGameThread() > 0.0f
			? WonderlandMiniMapDetail::CVarHz.GetValueOnGameThread() : Settings->CaptureHz, 0.5f)
		|| FVector2D::Distance(Frame.PlayerXY, Frame.CaptureCentreXY) > FMath::Max(Slack, 0.0);
	if (bDue)
	{
		USceneCaptureComponent2D* Camera = Capture.Get();
		CaptureActor->SetActorLocationAndRotation(
			FVector(PawnAt.X, PawnAt.Y, PawnAt.Z + Settings->CaptureHeightUU),
			// Looking straight down with the picture's top toward +Y and its right toward -X: the world map's plan.
			FRotator(-90.0f, 90.0f, 0.0f));
		Camera->HiddenActors.Reset();
		Camera->HiddenActors.Add(const_cast<APawn*>(Pawn));
		// THE FIRST PHOTOGRAPH WAS A WHITE DISC. A scene capture does not inherit the main view's auto exposure, and
		// this world is lit physically, so the lit picture saturated completely -- while the proof recorded "photograph
		// drawn", because it was. Base colour is the default now: a flat, unlit plan of what is built, which is what a
		// map wants anyway, and it skips the lighting a map does not need. The lit picture remains under a manual
		// exposure, for comparison.
		const bool bLit = WonderlandMiniMapDetail::CVarSource.GetValueOnGameThread() == 1;
		Camera->CaptureSource = bLit ? ESceneCaptureSource::SCS_FinalColorLDR : ESceneCaptureSource::SCS_BaseColor;
		FPostProcessSettings& Post = Camera->PostProcessSettings;
		Post.bOverride_AutoExposureMethod = true;
		Post.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
		Post.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
		Post.AutoExposureApplyPhysicalCameraExposure = false;
		Post.bOverride_AutoExposureBias = true;
		Post.AutoExposureBias = WonderlandMiniMapDetail::CVarExposureBias.GetValueOnGameThread();
		Camera->CaptureSceneDeferred();
		Frame.CaptureCentreXY = Frame.PlayerXY;
		Frame.CaptureWidthUU = Settings->CaptureWidthUU;
		Frame.bHasCapture = true;
		LastCaptureSeconds = Now;
		++CaptureCount;
	}
	return true;
}

bool UWonderlandMiniMapDriver::EnsureCapture(UWorld* World)
{
	if (CaptureActor.IsValid() && Capture.IsValid() && CaptureActor->GetWorld() == World)
	{
		return true;
	}
	if (AActor* Old = CaptureActor.Get())
	{
		Old->Destroy();
	}
	FActorSpawnParameters Params;
	Params.ObjectFlags |= RF_Transient;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.Name = MakeUniqueObjectName(World->PersistentLevel, AActor::StaticClass(), TEXT("WonderlandMiniMapCamera"));
	AActor* Actor = World->SpawnActor<AActor>(AActor::StaticClass(), FTransform::Identity, Params);
	if (Actor == nullptr)
	{
		UE_LOG(LogWonderlandMiniMap, Warning, TEXT("WLMINIMAP the camera could not be placed; the disc draws without a photograph"));
		return false;
	}
	USceneCaptureComponent2D* Camera = NewObject<USceneCaptureComponent2D>(Actor, TEXT("MiniMapCapture"));
	Actor->SetRootComponent(Camera);
	Camera->RegisterComponent();
	CaptureActor = Actor;
	Capture = Camera;
	ApplyCaptureSettings();
	UE_LOG(LogWonderlandMiniMap, Log, TEXT("WLMINIMAP camera placed (%dpx, %.0f uu across, %.0f uu above the Dog)"),
		Target != nullptr ? Target->SizeX : 0, GetDefault<UWonderlandMiniMapSettings>()->CaptureWidthUU,
		GetDefault<UWonderlandMiniMapSettings>()->CaptureHeightUU);
	return true;
}

void UWonderlandMiniMapDriver::ApplyCaptureSettings()
{
	USceneCaptureComponent2D* Camera = Capture.Get();
	if (Camera == nullptr)
	{
		return;
	}
	const UWonderlandMiniMapSettings* Settings = GetDefault<UWonderlandMiniMapSettings>();
	Camera->ProjectionType = ECameraProjectionMode::Orthographic;
	Camera->OrthoWidth = Settings->CaptureWidthUU;
	Camera->TextureTarget = Target;
	Camera->bCaptureEveryFrame = false;
	Camera->bCaptureOnMovement = false;
	// Kept between photographs so exposure adapts over time instead of starting cold on every one.
	Camera->bAlwaysPersistRenderingState = true;
	Camera->LODDistanceFactor = 2.0f;
	// NOTHING PAST THE PHOTOGRAPH'S OWN CORNERS. The capture looks down from CaptureHeightUU over a square
	// CaptureWidthUU across, so the farthest thing it can use is a corner of that square on the ground; the city
	// beyond it -- nine thousand street pieces as of SD01 -- is culled rather than drawn into a view that clips it.
	Camera->MaxViewDistanceOverride = static_cast<float>(FMath::Sqrt(FMath::Square(Settings->CaptureHeightUU)
		+ 2.0 * FMath::Square(Settings->CaptureWidthUU * 0.5)) * 1.05);

	// A SMALL SECOND VIEW, AND IT IS DRAWN LIKE ONE. Everything that exists to make a close camera cinematic is off:
	// it would cost a pass and read as noise at two hundred pixels. Temporal AA is off because the camera jumps
	// between photographs and would smear the ground behind it.
	const bool bLumen = WonderlandMiniMapDetail::CVarLumen.GetValueOnGameThread() != 0;
	TArray<FEngineShowFlagsSetting> Flags;
	const auto Set = [&Flags](const TCHAR* Name, bool bOn)
	{
		FEngineShowFlagsSetting Setting;
		Setting.ShowFlagName = Name;
		Setting.Enabled = bOn;
		Flags.Add(Setting);
	};
	Set(TEXT("Fog"), false);
	Set(TEXT("VolumetricFog"), false);
	Set(TEXT("Bloom"), false);
	Set(TEXT("MotionBlur"), false);
	Set(TEXT("DepthOfField"), false);
	Set(TEXT("LensFlares"), false);
	Set(TEXT("Particles"), false);
	Set(TEXT("AntiAliasing"), false);
	Set(TEXT("TemporalAA"), false);
	Set(TEXT("Grain"), false);
	Set(TEXT("Vignette"), false);
	Set(TEXT("ScreenSpaceReflections"), false);
	Set(TEXT("LumenReflections"), bLumen);
	Set(TEXT("LumenGlobalIllumination"), bLumen);
	Set(TEXT("DynamicShadows"), Settings->bCaptureShadows);
	Set(TEXT("ContactShadows"), false);
	Camera->SetShowFlagSettings(Flags);
}

void UWonderlandMiniMapDriver::RefreshPlaces(UWorld* World)
{
	Places.Reset();
	const UWonderlandTravelSubsystem* Travel = World->GetSubsystem<UWonderlandTravelSubsystem>();
	if (Travel == nullptr)
	{
		return;
	}
	for (const FWonderlandTravelDestination& Row : Travel->GetOfferedDestinations())
	{
		FWonderlandMiniMapPlace Place;
		Place.Id = Row.Id;
		Place.Name = Row.DisplayName.ToString();
		Place.Region = Row.District;
		Place.Kind = Row.Kind;
		// Where the visitor would actually stand, as the world map draws it; the seed only when no anchor exists.
		const AWonderlandTravelAnchor* Anchor = Travel->FindAnchor(Row.Id);
		Place.XY = Anchor != nullptr ? FVector2D(Anchor->GetActorLocation().X, Anchor->GetActorLocation().Y) : Row.SeedXY;
		Places.Add(MoveTemp(Place));
	}
}

// ---------------------------------------------------------------------------------------------------------------- disc

void SWonderlandMiniMapDisc::Construct(const FArguments& InArgs)
{
	Driver = InArgs._Driver;
	Diameter = InArgs._Diameter;
	// NO ROUNDED-BOX BRUSHES ON THIS DISC. A rounded box whose corner radius is half its size -- a circle -- renders
	// opaque WHITE here whatever its fill, alpha or outline: drawing no photograph at all (draw mode 5) still gave a
	// solid white disc, from the backing fill and its shadow, and the N badge was a white dot for the same reason.
	// Every round shape is a fan of triangles or a line loop instead, the path the arrow and markers always drew right.
}

bool SWonderlandMiniMapDisc::GetDrawnMarkerOffset(FName PlaceId, FVector2D& OutOffset) const
{
	if (const FVector2D* Found = DrawnMarkers.Find(PlaceId))
	{
		OutOffset = *Found;
		return true;
	}
	return false;
}

int32 SWonderlandMiniMapDisc::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	using WonderlandMiniMapDetail::Polar;
	const UWonderlandMiniMapDriver* Source = Driver.Get();
	if (Source != nullptr)
	{
		Source->NotePainted();
	}
	++PaintCount;
	DrawnMarkers.Reset();
	bDrewCapture = false;

	const FVector2f Size(AllottedGeometry.GetLocalSize());
	const float D = FMath::Min(Size.X, Size.Y);
	const FVector2f Centre = Size * 0.5f;
	const float Inset = 7.0f;
	const float R = D * 0.5f - Inset;
	const FSlateRenderTransform& Transform = AllottedGeometry.GetAccumulatedRenderTransform();
	const auto Circle = [&](float Radius) {
		return AllottedGeometry.ToPaintGeometry(FVector2f(Radius * 2.0f, Radius * 2.0f), FSlateLayoutTransform(Centre - FVector2f(Radius, Radius)));
	};

	FSlateRenderer* const Renderer = FSlateApplication::IsInitialized() ? FSlateApplication::Get().GetRenderer() : nullptr;
	const FSlateBrush* White = FCoreStyle::Get().GetBrush("WhiteBrush");
	const FSlateResourceHandle WhiteHandle = Renderer != nullptr ? Renderer->GetResourceHandle(*White) : FSlateResourceHandle();
	// THE WHITE BRUSH LIVES IN AN ATLAS. A UV of (0.5, 0.5) is the middle of the whole atlas page -- some other image,
	// or nothing -- which is why the first arrow and markers never showed. The engine's own fan (STestSuite) samples
	// inside the proxy's region, and so does this.
	const FSlateShaderResourceProxy* WhiteProxy = WhiteHandle.GetResourceProxy();
	const FVector2f WhiteUV = WhiteProxy != nullptr ? WhiteProxy->StartUV + WhiteProxy->SizeUV * 0.5f : FVector2f(0.5f, 0.5f);
	const auto Fan = [&](const TArray<FVector2f>& Points, const FLinearColor& Color, int32 AtLayer)
	{
		if (Renderer == nullptr || Points.Num() < 3)
		{
			return;
		}
		const FColor C = Color.ToFColor(true);
		TArray<FSlateVertex> Verts;
		TArray<SlateIndex> Indices;
		for (const FVector2f& P : Points)
		{
			Verts.Add(FSlateVertex::Make(Transform, P, WhiteUV, C));
		}
		for (int32 Index = 1; Index + 1 < Points.Num(); ++Index)
		{
			Indices.Add(0);
			Indices.Add(static_cast<SlateIndex>(Index));
			Indices.Add(static_cast<SlateIndex>(Index + 1));
		}
		FSlateDrawElement::MakeCustomVerts(OutDrawElements, AtLayer, WhiteHandle, Verts, Indices, nullptr, 0, 0);
	};

	const auto Disc = [&](const FVector2f& At, float Radius, const FLinearColor& Color, int32 AtLayer)
	{
		TArray<FVector2f> Points;
		Points.Reserve(66);
		Points.Add(At);
		for (int32 Step = 0; Step <= 64; ++Step)
		{
			Points.Add(Polar(At, Radius, 360.0f * Step / 64.0f));
		}
		Fan(Points, Color, AtLayer);
	};
	const auto Loop = [&](const FVector2f& At, float Radius, const FLinearColor& Colour, float Thickness, int32 AtLayer)
	{
		TArray<FVector2f> Points;
		Points.Reserve(97);
		for (int32 Step = 0; Step <= 96; ++Step)
		{
			Points.Add(Polar(At, Radius, 360.0f * Step / 96.0f));
		}
		FSlateDrawElement::MakeLines(OutDrawElements, AtLayer, AllottedGeometry.ToPaintGeometry(), Points,
			ESlateDrawEffect::None, Colour, true, Thickness);
	};

	int32 Layer = LayerId;
	Disc(Centre, R + 5.0f, FLinearColor(0.0f, 0.0f, 0.0f, 0.34f), Layer++);
	Disc(Centre, R, WonderlandUi::Srgb(8, 10, 18, 0.80f), Layer++);

	const FWonderlandMiniMapFrame* Frame = Source != nullptr ? &Source->GetFrame() : nullptr;
	const double K = Frame != nullptr ? Frame->ViewRadiusUU / FMath::Max(R, 1.0f) : 1.0;
	DrawnUUPerPixel = K;

	// ----- the photograph, through a round window
	// A TEXTURED FAN (draw mode 4) whose UVs sit inside the render target's proxy region. They span the square of
	// ground the disc covers, shifted by how far the Dog has walked since the photograph was taken, so the ground still
	// slides under the window between captures.
	if (Frame != nullptr && Frame->bHasPlayer && Frame->bHasCapture && Source->GetCaptureBrush() != nullptr)
	{
		const double Width = FMath::Max(Frame->CaptureWidthUU, 1.0);
		const FVector2D Shift = Frame->CaptureCentreXY - Frame->PlayerXY;
		const double Half = Frame->ViewRadiusUU / Width;
		const FVector2D Mid(0.5 + Shift.X / Width, 0.5 + Shift.Y / Width);
		const FLinearColor Tint(0.64f, 0.66f, 0.74f, 0.94f);
		const FBox2f Region(FVector2f(static_cast<float>(Mid.X - Half), static_cast<float>(Mid.Y - Half)),
			FVector2f(static_cast<float>(Mid.X + Half), static_cast<float>(Mid.Y + Half)));
		const int32 Mode = WonderlandMiniMapDetail::CVarDrawMode.GetValueOnGameThread();
		FSlateBrush Photo = *Source->GetCaptureBrush();
		Photo.SetUVRegion(Region);
		if (Mode == 1)
		{
			Photo.DrawAs = ESlateBrushDrawType::Image;
			FSlateDrawElement::MakeBox(OutDrawElements, Layer++, Circle(R), &Photo, ESlateDrawEffect::IgnoreTextureAlpha, Tint);
			bDrewCapture = true;
		}
		else if (Mode == 2 || Mode == 3)
		{
			Photo.DrawAs = ESlateBrushDrawType::RoundedBox;
			Photo.OutlineSettings = FSlateBrushOutlineSettings(R);
			Photo.TintColor = FSlateColor(Tint);
			FSlateDrawElement::MakeBox(OutDrawElements, Layer++, Circle(R), &Photo,
				Mode == 3 ? ESlateDrawEffect::IgnoreTextureAlpha : ESlateDrawEffect::None, FLinearColor::White);
			bDrewCapture = true;
		}
		else if (Mode == 4 && Renderer != nullptr)
		{
			const FSlateResourceHandle Handle = Renderer->GetResourceHandle(Photo);
			const FSlateShaderResourceProxy* Proxy = Handle.GetResourceProxy();
			const FVector2f Start = Proxy != nullptr ? Proxy->StartUV : FVector2f(0.0f, 0.0f);
			const FVector2f Span = Proxy != nullptr ? Proxy->SizeUV : FVector2f(1.0f, 1.0f);
			const FColor Colour = Tint.ToFColor(true);
			TArray<FSlateVertex> Verts;
			TArray<SlateIndex> Indices;
			const auto UvAt = [&](float Ox, float Oy)
			{
				const FVector2f Unit(static_cast<float>(Mid.X + Ox * K / Width), static_cast<float>(Mid.Y + Oy * K / Width));
				return Start + Unit * Span;
			};
			Verts.Add(FSlateVertex::Make(Transform, Centre, UvAt(0.0f, 0.0f), Colour));
			for (int32 Step = 0; Step <= 56; ++Step)
			{
				const FVector2f P = Polar(Centre, R, 360.0f * Step / 56.0f);
				Verts.Add(FSlateVertex::Make(Transform, P, UvAt(P.X - Centre.X, P.Y - Centre.Y), Colour));
				if (Step > 0)
				{
					Indices.Add(0);
					Indices.Add(static_cast<SlateIndex>(Step));
					Indices.Add(static_cast<SlateIndex>(Step + 1));
				}
			}
			FSlateDrawElement::MakeCustomVerts(OutDrawElements, Layer++, Handle, Verts, Indices, nullptr, 0, 0, ESlateDrawEffect::IgnoreTextureAlpha);
			bDrewCapture = true;
			LastProxyNote = Proxy != nullptr ? FString::Printf(TEXT("proxy start %.3f,%.3f size %.3f,%.3f"), Start.X, Start.Y, Span.X, Span.Y) : FString(TEXT("proxy none"));
		}
		else if (Mode == 0)
		{
			Photo.DrawAs = ESlateBrushDrawType::RoundedBox;
			Photo.OutlineSettings = FSlateBrushOutlineSettings(R);
			// A scene capture writes coverage, not opacity, into alpha: honoured, the ground would draw see-through.
			FSlateDrawElement::MakeBox(OutDrawElements, Layer++, Circle(R), &Photo, ESlateDrawEffect::IgnoreTextureAlpha, Tint);
			bDrewCapture = true;
		}

		if (WonderlandMiniMapDetail::CVarDebugRaw.GetValueOnGameThread() != 0)
		{
			FSlateBrush Raw = *Source->GetCaptureBrush();
			Raw.DrawAs = ESlateBrushDrawType::Image;
			FSlateDrawElement::MakeBox(OutDrawElements, Layer + 20, AllottedGeometry.ToPaintGeometry(FVector2f(64.0f, 64.0f), FSlateLayoutTransform(FVector2f(0.0f, 0.0f))),
				&Raw, ESlateDrawEffect::IgnoreTextureAlpha, FLinearColor::White);
		}
	}

	// ----- crosshair
	{
		const FLinearColor Hair = WonderlandUi::Ivory(0.16f);
		FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(),
			TArray<FVector2f>{FVector2f(Centre.X - R, Centre.Y), FVector2f(Centre.X + R, Centre.Y)}, ESlateDrawEffect::None, Hair, true, 1.0f);
		FSlateDrawElement::MakeLines(OutDrawElements, Layer++, AllottedGeometry.ToPaintGeometry(),
			TArray<FVector2f>{FVector2f(Centre.X, Centre.Y - R), FVector2f(Centre.X, Centre.Y + R)}, ESlateDrawEffect::None, Hair, true, 1.0f);
	}

	if (Frame != nullptr && Frame->bHasPlayer)
	{
		// ----- places the registry offers, where they stand
		for (const FWonderlandMiniMapPlace& Place : Frame->NearbyPlaces)
		{
			const FVector2D Offset = WonderlandMiniMapOffset(Place.XY, Frame->PlayerXY, K);
			if (Offset.Size() > R - 9.0)
			{
				continue;
			}
			DrawnMarkers.Add(Place.Id, Offset);
			const FVector2f P = Centre + FVector2f(Offset);
			const bool bLandmark = Place.Kind == EWonderlandTravelKind::Landmark;
			const float S = bLandmark ? 3.2f : 4.6f;
			const FLinearColor Color = Place.Kind == EWonderlandTravelKind::Arrival ? WonderlandUi::Gold(0.95f) : WonderlandUi::Ivory(0.90f);
			Fan({P + FVector2f(0.0f, -S), P + FVector2f(S, 0.0f), P + FVector2f(0.0f, S), P + FVector2f(-S, 0.0f)},
				FLinearColor(0.02f, 0.02f, 0.04f, 0.65f), Layer);
			Fan({P + FVector2f(0.0f, -S + 1.2f), P + FVector2f(S - 1.2f, 0.0f), P + FVector2f(0.0f, S - 1.2f), P + FVector2f(-S + 1.2f, 0.0f)},
				Color, Layer + 1);
		}
		Layer += 2;

		// ----- where the camera looks: a faint wedge
		DrawnViewAngleDeg = WonderlandMiniMapScreenAngle(Frame->CameraYawDeg);
		{
			TArray<FVector2f> Wedge;
			Wedge.Add(Centre);
			for (int32 Step = 0; Step <= 10; ++Step)
			{
				Wedge.Add(Polar(Centre, R * 0.58f, static_cast<float>(DrawnViewAngleDeg) - 34.0f + 68.0f * Step / 10.0f));
			}
			Fan(Wedge, WonderlandUi::Ivory(0.10f), Layer++);
		}

		// ----- the Dog: an arrow that points the way it faces
		DrawnArrowAngleDeg = WonderlandMiniMapScreenAngle(Frame->PawnYawDeg);
		{
			const float A = static_cast<float>(DrawnArrowAngleDeg);
			const TArray<FVector2f> Outline = {Polar(Centre, 11.5f, A), Polar(Centre, 8.5f, A + 140.0f), Polar(Centre, 3.5f, A + 180.0f), Polar(Centre, 8.5f, A - 140.0f)};
			const TArray<FVector2f> Body = {Polar(Centre, 9.5f, A), Polar(Centre, 6.8f, A + 140.0f), Polar(Centre, 2.4f, A + 180.0f), Polar(Centre, 6.8f, A - 140.0f)};
			Fan(Outline, FLinearColor(0.02f, 0.02f, 0.04f, 0.85f), Layer++);
			Fan(Body, WonderlandUi::Ivory(1.0f), Layer++);
		}
	}

	// ----- the compass ring, as line loops
	Loop(Centre, R, WonderlandUi::Ivory(0.82f), 1.5f, Layer);
	Loop(Centre, R + 4.0f, WonderlandUi::Ivory(0.22f), 1.0f, Layer);
	++Layer;
	for (int32 Tick = 0; Tick < 8; ++Tick)
	{
		const float A = -90.0f + 45.0f * Tick;
		const float Length = (Tick % 2 == 0) ? 6.0f : 3.5f;
		FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(),
			TArray<FVector2f>{Polar(Centre, R - Length, A), Polar(Centre, R, A)}, ESlateDrawEffect::None, WonderlandUi::Ivory(0.70f), true, 1.2f);
	}
	++Layer;

	// North stays at the top: the plan never turns, the arrow does.
	{
		const FSlateFontInfo Font = WonderlandUi::Sans(9, true);
		const FVector2f PillSize(18.0f, 16.0f);
		const FVector2f PillAt(Centre.X - PillSize.X * 0.5f, Centre.Y - R - PillSize.Y * 0.5f);
		const FVector2f Badge(Centre.X, Centre.Y - R);
		Disc(Badge, 8.5f, WonderlandUi::Srgb(8, 10, 18, 0.92f), Layer++);
		Loop(Badge, 8.5f, WonderlandUi::Gold(0.70f), 1.0f, Layer++);
		FVector2f Measured(9.0f, 12.0f);
		if (FSlateApplication::IsInitialized())
		{
			Measured = FVector2f(FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(TEXT("N"), Font));
		}
		FSlateDrawElement::MakeText(OutDrawElements, Layer++,
			AllottedGeometry.ToPaintGeometry(Measured, FSlateLayoutTransform(PillAt + (PillSize - Measured) * 0.5f)),
			FString(TEXT("N")), Font, ESlateDrawEffect::None, WonderlandUi::Gold());
	}
	return Layer;
}

// ---------------------------------------------------------------------------------------------------------------- widget

void SWonderlandMiniMap::Construct(const FArguments& InArgs)
{
	Driver = InArgs._Driver;
	ChildSlot
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
		[
			SAssignNew(Disc, SWonderlandMiniMapDisc).Driver(Driver).Diameter(196.0f)
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 6.0f, 0.0f, 0.0f)
		[
			// A soft dark backing: the first frame put gold lettering straight onto sunlit stone, where it barely read.
			SNew(SBorder)
			.BorderImage(&LabelBrush)
			.Padding(FMargin(12.0f, 3.0f, 12.0f, 4.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
				[
					SNew(STextBlock)
					.Text_Lambda([this]() { return FText::FromString(GetWorldLine()); })
					.Font(WonderlandUi::Sans(12, true, 140))
					.ColorAndOpacity(WonderlandUi::Ivory())
					.ShadowOffset(FVector2D(0.0, 1.0))
					.ShadowColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, 0.75f))
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 1.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text_Lambda([this]() { return FText::FromString(GetRegionLine()); })
					.Font(WonderlandUi::Sans(9, true, 180))
					.ColorAndOpacity(WonderlandUi::Gold(0.95f))
					.ShadowOffset(FVector2D(0.0, 1.0))
					.ShadowColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, 0.75f))
				]
			]
		]
	];
}

FString SWonderlandMiniMap::GetWorldLine() const
{
	const UWonderlandMiniMapDriver* Source = Driver.Get();
	return Source != nullptr ? Source->GetFrame().Label.World : FString();
}

FString SWonderlandMiniMap::GetRegionLine() const
{
	const UWonderlandMiniMapDriver* Source = Driver.Get();
	return Source != nullptr ? Source->GetFrame().Label.Region : FString();
}

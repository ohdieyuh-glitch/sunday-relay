#include "WonderlandWonderWebScreen.h"

#include "Camera/CameraComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/WidgetComponent.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "InputCoreTypes.h"
#include "WonderlandWonderWebPanel.h"

namespace WonderWebScreenTuning
{
	// A WORKSPACE IN THE GARDEN, framed by the camera with the world round its edges: stood a little over three metres out
	// ahead of where the player is looking and raised above the Dog, the camera 385 uu back from the glass.
	//
	// THE WINDOW SIZE IS A MULTITASKING SIZE (founder, 2026-09-17: "a little smaller ... 2-3 active Wonder Web surfaces
	// visible simultaneously"): a window's glass is 240 uu wide -- about 40% of the view's width -- so two stand side by side
	// with garden between them and three tile in two rows. A lone window opens a size larger. The window is still rendered
	// at its full design resolution; only the glass it is drawn on is smaller.
	TAutoConsoleVariable<float> CVarWindowWidth(TEXT("wl.WonderWeb.WindowWidth"), 240.0f, TEXT("Wonder Web window: the glass's width at the multitasking size, uu."));
	TAutoConsoleVariable<float> CVarChipScale(TEXT("wl.WonderWeb.ChipScale"), 0.2f, TEXT("Wonder Web window: uu per chip pixel for a minimized window's chip."));
	TAutoConsoleVariable<float> CVarResizeSeconds(TEXT("wl.WonderWeb.ResizeSeconds"), 0.16f, TEXT("Wonder Web window: the timescale of growing or shrinking to a new size, seconds."));
	TAutoConsoleVariable<float> CVarAhead(TEXT("wl.WonderWeb.ScreenAhead"), 330.0f, TEXT("Wonder Web workspace: how far ahead of the Dog it stands, along the player's view, uu."));
	TAutoConsoleVariable<float> CVarUp(TEXT("wl.WonderWeb.ScreenUp"), 150.0f, TEXT("Wonder Web workspace: how high its centre stands above the Dog, uu."));
	TAutoConsoleVariable<float> CVarViewDistance(TEXT("wl.WonderWeb.ViewDistance"), 385.0f, TEXT("Wonder Web workspace: the camera's distance back from the glass, uu."));
	TAutoConsoleVariable<float> CVarViewSide(TEXT("wl.WonderWeb.ViewSide"), -16.0f, TEXT("Wonder Web workspace: the camera's sideways offset, uu."));
	TAutoConsoleVariable<float> CVarViewLift(TEXT("wl.WonderWeb.ViewLift"), 8.0f, TEXT("Wonder Web workspace: the camera's height above the glass's centre, uu."));
	TAutoConsoleVariable<float> CVarViewFov(TEXT("wl.WonderWeb.ViewFov"), 75.0f, TEXT("Wonder Web workspace: the camera's horizontal field of view, degrees."));
	// LIT LIKE A SCREEN IN SUNLIGHT. The garden is exposed for daylight, so an unlit widget colour of 1.0 lands near black
	// (editor 76); 20000 reads the yellow and keeps a disabled control faint, 40000 blooms the active tab.
	TAutoConsoleVariable<float> CVarBrightness(TEXT("wl.WonderWeb.ScreenBrightness"), 20000.0f, TEXT("Wonder Web window: how bright it is drawn in the lit world (a multiplier on its colours)."));
	TAutoConsoleVariable<float> CVarGlideSeconds(TEXT("wl.WonderWeb.GlideSeconds"), 0.18f, TEXT("Wonder Web window: the timescale of its glide to a new place, seconds (critically damped: swift, no overshoot)."));
	TAutoConsoleVariable<float> CVarEdgeMargin(TEXT("wl.WonderWeb.EdgeMargin"), 10.0f, TEXT("Wonder Web window: how far inside the view's edge a side or corner place keeps the glass, uu."));
	TAutoConsoleVariable<float> CVarGrowSeconds(TEXT("wl.WonderWeb.GrowSeconds"), 0.3f, TEXT("Wonder Web window: seconds to open out, fold away, minimize or restore."));
	// A BACKGROUND WINDOW KEEPS WORKING AND IS DRAWN LESS OFTEN: the focused one every frame, the others a dozen times a
	// second, a minimized one only as its chip, four times a second.
	TAutoConsoleVariable<float> CVarBackgroundRedraw(TEXT("wl.WonderWeb.BackgroundRedrawSeconds"), 1.0f / 12.0f, TEXT("Wonder Web window: seconds between redraws of a visible window that is not focused."));
	TAutoConsoleVariable<int32> CVarGlassBlend(TEXT("wl.WonderWeb.GlassBlend"), 1,
		TEXT("Wonder Web window glass: 0 translucent (ghosts changed text under the temporal upscaler), 1 masked, 2 opaque."));
	TAutoConsoleVariable<float> CVarChipRedraw(TEXT("wl.WonderWeb.ChipRedrawSeconds"), 0.25f, TEXT("Wonder Web window: seconds between redraws of a minimized window's chip."));

	UWidgetComponent* MakeGlass(AActor* Owner, USceneComponent* Parent, const TCHAR* Name)
	{
		UWidgetComponent* Glass = Owner->CreateDefaultSubobject<UWonderlandWonderWebGlass>(Name);
		Glass->SetupAttachment(Parent);
		Glass->SetWidgetSpace(EWidgetSpace::World);
		Glass->SetPivot(FVector2D(0.5, 0.5));
		// Masked: an ordinary surface to the temporal upscaler, with the rounded corners still cut out (see UWonderlandWonderWebGlass).
		Glass->SetBlendMode(EWidgetBlendMode::Masked);
		Glass->SetTwoSided(false);
		Glass->SetBackgroundColor(FLinearColor::Transparent);
		Glass->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Glass->SetGenerateOverlapEvents(false);
		Glass->SetCastShadow(false);
		Glass->SetTickWhenOffscreen(true);
		Glass->PrimaryComponentTick.bTickEvenWhenPaused = true;
		return Glass;
	}
}

/* ==================================================================== the workspace */

AWonderlandWonderWebWorkspace::AWonderlandWonderWebWorkspace()
{
	PrimaryActorTick.bCanEverTick = false;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Anchor"));
	SetRootComponent(Root);
	View = CreateDefaultSubobject<UCameraComponent>(TEXT("WonderWebView"));
	View->SetupAttachment(Root);
	View->bConstrainAspectRatio = false;
}

void AWonderlandWonderWebWorkspace::StandBefore(APlayerController* Controller)
{
	using namespace WonderWebScreenTuning;
	if (Controller == nullptr)
	{
		return;
	}
	// WHERE THE PLAYER IS LOOKING, AHEAD OF THE DOG: the frame stands there facing back toward them.
	const APawn* Pawn = Controller->GetPawn();
	const float Yaw = Controller->PlayerCameraManager != nullptr ? Controller->PlayerCameraManager->GetCameraRotation().Yaw : Controller->GetControlRotation().Yaw;
	const FVector Ahead = FRotator(0.0f, Yaw, 0.0f).Vector();
	const FVector From = Pawn != nullptr ? Pawn->GetActorLocation()
		: (Controller->PlayerCameraManager != nullptr ? Controller->PlayerCameraManager->GetCameraLocation() : FVector::ZeroVector);
	SetActorLocationAndRotation(From + Ahead * CVarAhead.GetValueOnGameThread() + FVector(0.0, 0.0, CVarUp.GetValueOnGameThread()),
		FRotator(0.0f, Yaw + 180.0f, 0.0f));
	// THE CAMERA STANDS IN FRONT OF THE GLASS, on +X, looking back along -X: a widget component's front faces +X and its
	// pixels run toward -Y (UWidgetComponent::GetLocalHitLocation), which is this camera's right.
	View->SetRelativeLocationAndRotation(
		FVector(CVarViewDistance.GetValueOnGameThread(), CVarViewSide.GetValueOnGameThread(), CVarViewLift.GetValueOnGameThread()),
		FRotator(-FMath::RadiansToDegrees(FMath::Atan2(CVarViewLift.GetValueOnGameThread(), FMath::Max(CVarViewDistance.GetValueOnGameThread(), 1.0f))), 180.0f, 0.0f));
	View->SetFieldOfView(CVarViewFov.GetValueOnGameThread());
}

FVector2D AWonderlandWonderWebWorkspace::HalfView() const
{
	using namespace WonderWebScreenTuning;
	const double Distance = FMath::Max(CVarViewDistance.GetValueOnGameThread(), 1.0f);
	const double HalfWide = Distance * FMath::Tan(FMath::DegreesToRadians(CVarViewFov.GetValueOnGameThread() * 0.5));
	double Aspect = 16.0 / 9.0;
	if (const UWorld* World = GetWorld())
	{
		if (const UGameViewportClient* ViewportClient = World->GetGameViewport())
		{
			FVector2D Size;
			ViewportClient->GetViewportSize(Size);
			if (Size.Y > 0.0)
			{
				Aspect = Size.X / Size.Y;
			}
		}
	}
	return FVector2D(HalfWide, HalfWide / Aspect);
}

/* ==================================================================== one window */

AWonderlandWonderWebScreen::AWonderlandWonderWebScreen()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = true;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
	Screen = WonderWebScreenTuning::MakeGlass(this, Root, TEXT("WonderWebWindow"));
	Chip = WonderWebScreenTuning::MakeGlass(this, Root, TEXT("WonderWebChip"));
	Chip->SetVisibility(false);

	Interaction = CreateDefaultSubobject<UWonderlandWonderWebInteraction>(TEXT("WonderWebPointer"));
	Interaction->SetupAttachment(Root);
	// The layer supplies where the cursor meets the glass; nothing is traced against the world.
	Interaction->InteractionSource = EWidgetInteractionSource::Custom;
	Interaction->bEnableHitTesting = true;
	Interaction->InteractionDistance = 5000.0f;
	Interaction->VirtualUserIndex = 7;
	Interaction->PointerIndex = 0;

	SetActorHiddenInGame(true);
}

void AWonderlandWonderWebScreen::SetVirtualUser(int32 Index)
{
	Interaction->VirtualUserIndex = Index;
}

void AWonderlandWonderWebScreen::Present(const TSharedRef<SWidget>& Window, const FVector2D& WindowSize, const TSharedRef<SWidget>& InChip, const FVector2D& ChipSize,
	AWonderlandWonderWebWorkspace* InWorkspace)
{
	if (Shown != Window)
	{
		Screen->SetSlateWidget(Window);
		Shown = Window;
	}
	if (ShownChip != InChip)
	{
		Chip->SetSlateWidget(InChip);
		ShownChip = InChip;
	}
	WindowPixels = WindowSize;
	ChipPixels = ChipSize;
	Screen->SetDrawSize(WindowSize);
	Chip->SetDrawSize(ChipSize);
	Workspace = InWorkspace;
	if (InWorkspace != nullptr && GetAttachParentActor() != InWorkspace)
	{
		AttachToComponent(InWorkspace->GetAnchor(), FAttachmentTransformRules::SnapToTargetNotIncludingScale);
	}
	bPresented = true;
	SetActorHiddenInGame(false);
	SetActorTickEnabled(true);
}

void AWonderlandWonderWebScreen::Dismiss()
{
	bPresented = false;
	bDragging = false;
}

void AWonderlandWonderWebScreen::SetFocused(bool bInFocused)
{
	bFocused = bInFocused;
}

void AWonderlandWonderWebScreen::SetMinimized(bool bInMinimized)
{
	bMinimized = bInMinimized;
	if (bMinimized)
	{
		bDragging = false;
	}
}

FVector2D AWonderlandWonderWebScreen::GlassSize() const
{
	const double Width = WonderWebScreenTuning::CVarWindowWidth.GetValueOnGameThread();
	const double Aspect = WindowPixels.X > 0.0 ? WindowPixels.Y / WindowPixels.X : 2.0 / 3.0;
	return FVector2D(Width, Width * Aspect) * SizeFactor;
}

void AWonderlandWonderWebScreen::Tick(float DeltaSeconds)
{
	using namespace WonderWebScreenTuning;
	Super::Tick(DeltaSeconds);
	const float Seconds = FMath::Max(CVarGrowSeconds.GetValueOnGameThread(), 0.01f);
	const bool bWindowShown = bPresented && !bMinimized;
	const bool bChipShown = bPresented && bMinimized;
	Grow = FMath::Clamp(Grow + (bWindowShown ? 1.0f : -1.0f) * DeltaSeconds / Seconds, 0.0f, 1.0f);
	ChipGrow = FMath::Clamp(ChipGrow + (bChipShown ? 1.0f : -1.0f) * DeltaSeconds / Seconds, 0.0f, 1.0f);
	// THE SIZE, critically damped toward the target like the glide: an expanded window grows, and settles, without bounce.
	FMath::CriticallyDampedSmoothing(SizeShown, SizeRate, SizeFactor, 0.0f, FMath::Min(DeltaSeconds, 0.1f), FMath::Max(CVarResizeSeconds.GetValueOnGameThread(), 0.02f));
	if (FMath::IsNearlyEqual(SizeShown, SizeFactor, 0.002f) && FMath::Abs(SizeRate) < 0.05f)
	{
		SizeShown = SizeFactor;
		SizeRate = 0.0f;
	}
	const float Scale = CVarWindowWidth.GetValueOnGameThread() / FMath::Max(static_cast<float>(WindowPixels.X), 1.0f) * SizeShown;

	// It opens out from a line across its middle, like a screen switching on, and folds back the same way.
	const float Open = FMath::SmoothStep(0.0f, 1.0f, Grow);
	Screen->SetRelativeScale3D(FVector(Scale, Scale, Scale * FMath::Max(Open, 0.02f)));
	// MINIMIZED, IT IS NOT DRAWN AT ALL: its work goes on, its presentation stops.
	Screen->SetVisibility(Grow > 0.0f);

	// THE GLIDE. Critically damped toward the target, in short sub-steps so a slow frame is still a smooth curve.
	const FVector2D Limit = Reach();
	if (!bDragging)
	{
		// A window on a named place keeps to it as its size changes; one left where it was dragged stays whole in the view.
		TargetOffset = bOnGrid ? FVector2D(Cell.X * Limit.X, Cell.Y * Limit.Y)
			: FVector2D(FMath::Clamp(TargetOffset.X, -Limit.X, Limit.X), FMath::Clamp(TargetOffset.Y, -Limit.Y, Limit.Y));
	}
	const float Glide = FMath::Max(CVarGlideSeconds.GetValueOnGameThread(), 0.02f);
	float Remaining = FMath::Min(DeltaSeconds, 0.25f);
	while (Remaining > 0.0f)
	{
		const float Slice = FMath::Min(Remaining, Glide * 0.4f);
		FMath::CriticallyDampedSmoothing(Offset, OffsetRate, TargetOffset, FVector2D::ZeroVector, Slice, Glide);
		Remaining -= Slice;
	}
	// IT ARRIVES, AND THEN IT IS STILL: the last creep of a critically damped glide is what the temporal upscaler smeared
	// into doubled text on a translucent screen (editor 78). Within two uu and nearly stopped, it lands exactly.
	if (!bDragging && FVector2D::Distance(Offset, TargetOffset) < 2.0 && OffsetRate.Size() < 30.0)
	{
		Offset = TargetOffset;
		OffsetRate = FVector2D::ZeroVector;
	}
	// Across the view is -Y (the camera looks back along -X), up is +Z; the focused window stands a hair nearer, in front.
	Screen->SetRelativeLocation(FVector(bFocused ? 3.0 : 0.0, -Offset.X, Offset.Y));

	// THE CHIP, along the bottom of the view from the left, while the window is minimized.
	const FVector2D Half = Workspace.IsValid() ? Workspace->HalfView() : FVector2D(295.0, 166.0);
	const FVector2D ChipGlass = ChipPixels * CVarChipScale.GetValueOnGameThread();
	const double Margin = CVarEdgeMargin.GetValueOnGameThread();
	const float ChipOpen = FMath::SmoothStep(0.0f, 1.0f, ChipGrow);
	Chip->SetRelativeLocation(FVector(5.0, -(-Half.X + Margin + ChipGlass.X * 0.5 + DockSlot * (ChipGlass.X + 6.0)), -Half.Y + Margin + ChipGlass.Y * 0.5));
	const float ChipScale = CVarChipScale.GetValueOnGameThread();
	Chip->SetRelativeScale3D(FVector(ChipScale, ChipScale, ChipScale * FMath::Max(ChipOpen, 0.02f)));
	Chip->SetVisibility(ChipGrow > 0.0f);

	const int32 Blend = FMath::Clamp(CVarGlassBlend.GetValueOnGameThread(), 0, 2);
	if (Blend != AppliedBlend)
	{
		const EWidgetBlendMode Mode = Blend == 0 ? EWidgetBlendMode::Transparent : (Blend == 1 ? EWidgetBlendMode::Masked : EWidgetBlendMode::Opaque);
		for (UWidgetComponent* Glass : { Screen.Get(), Chip.Get() })
		{
			Glass->SetBlendMode(Mode);
			if (UWonderlandWonderWebGlass* Rebuilt = Cast<UWonderlandWonderWebGlass>(Glass))
			{
				Rebuilt->RefreshMaterial();
			}
		}
		AppliedBlend = Blend;
		AppliedBrightness = -1.0f;
	}
	const float Brightness = FMath::Max(CVarBrightness.GetValueOnGameThread(), 1.0f);
	if (!FMath::IsNearlyEqual(AppliedBrightness, Brightness))
	{
		Screen->SetTintColorAndOpacity(FLinearColor(Brightness, Brightness, Brightness, 1.0f));
		Chip->SetTintColorAndOpacity(FLinearColor(Brightness, Brightness, Brightness, 1.0f));
		AppliedBrightness = Brightness;
	}
	// DRAWN AS OFTEN AS IT IS LOOKED AT; worked on regardless.
	const float Redraw = bFocused ? 0.0f : CVarBackgroundRedraw.GetValueOnGameThread();
	if (!FMath::IsNearlyEqual(AppliedRedraw, Redraw))
	{
		Screen->SetRedrawTime(Redraw);
		Chip->SetRedrawTime(CVarChipRedraw.GetValueOnGameThread());
		AppliedRedraw = Redraw;
	}
	if (!bPresented && Grow <= 0.0f && ChipGrow <= 0.0f && !IsHidden())
	{
		SetActorHiddenInGame(true);
	}
}

FVector2D AWonderlandWonderWebScreen::Reach() const
{
	using namespace WonderWebScreenTuning;
	// Half the view at the glass's distance, less half the glass and a margin: the glass stays whole in every place.
	const FVector2D Half = Workspace.IsValid() ? Workspace->HalfView() : FVector2D(295.0, 166.0);
	const FVector2D Glass = GlassSize() * 0.5;
	const double Margin = CVarEdgeMargin.GetValueOnGameThread();
	return FVector2D(FMath::Max(Half.X - Glass.X - Margin, 0.0), FMath::Max(Half.Y - Glass.Y - Margin, 0.0));
}

bool AWonderlandWonderWebScreen::MoveTo(FName InPlace)
{
	const FString Name = InPlace.ToString().ToLower();
	FIntPoint To;
	if (Name == TEXT("center") || Name == TEXT("centre") || Name == TEXT("middle")) { To = FIntPoint(0, 0); }
	else if (Name == TEXT("left"))         { To = FIntPoint(-1, 0); }
	else if (Name == TEXT("right"))        { To = FIntPoint(1, 0); }
	else if (Name == TEXT("top"))          { To = FIntPoint(0, 1); }
	else if (Name == TEXT("bottom"))       { To = FIntPoint(0, -1); }
	else if (Name == TEXT("top-left"))     { To = FIntPoint(-1, 1); }
	else if (Name == TEXT("top-right"))    { To = FIntPoint(1, 1); }
	else if (Name == TEXT("bottom-left"))  { To = FIntPoint(-1, -1); }
	else if (Name == TEXT("bottom-right")) { To = FIntPoint(1, -1); }
	else { return false; }
	Cell = To;
	Place = FName(*Name);
	bDragging = false;
	bOnGrid = true;
	const FVector2D Limit = Reach();
	TargetOffset = FVector2D(To.X * Limit.X, To.Y * Limit.Y);
	return true;
}

void AWonderlandWonderWebScreen::PlaceAt(const FVector2D& AcrossUp)
{
	bDragging = false;
	bOnGrid = false;
	Place = TEXT("tiled");
	TargetOffset = AcrossUp;
	const FVector2D Limit = Reach();
	Cell = FIntPoint(Limit.X > 1.0 ? FMath::Clamp(FMath::RoundToInt(AcrossUp.X / Limit.X), -1, 1) : 0, Limit.Y > 1.0 ? FMath::Clamp(FMath::RoundToInt(AcrossUp.Y / Limit.Y), -1, 1) : 0);
}

void AWonderlandWonderWebScreen::Step(int32 Across, int32 Up)
{
	static const TCHAR* Names[3][3] = {
		{ TEXT("bottom-left"), TEXT("left"), TEXT("top-left") },
		{ TEXT("bottom"), TEXT("center"), TEXT("top") },
		{ TEXT("bottom-right"), TEXT("right"), TEXT("top-right") } };
	const int32 X = FMath::Clamp(Cell.X + FMath::Sign(Across), -1, 1);
	const int32 Y = FMath::Clamp(Cell.Y + FMath::Sign(Up), -1, 1);
	MoveTo(Names[X + 1][Y + 1]);
}

bool AWonderlandWonderWebScreen::RayOnPlane(APlayerController* Controller, const FVector2D& ViewportPixel, FVector2D& OutAcrossUp) const
{
	FVector Origin;
	FVector Direction;
	if (Controller == nullptr || !Controller->DeprojectScreenPositionToWorld(ViewportPixel.X, ViewportPixel.Y, Origin, Direction))
	{
		return false;
	}
	const FTransform& RootXf = Root->GetComponentTransform();
	const FPlane Glass(Screen->GetComponentLocation(), RootXf.GetUnitAxis(EAxis::X));
	if (FMath::IsNearlyZero(FVector::DotProduct(Direction, Glass.GetNormal())))
	{
		return false;
	}
	const FVector Local = RootXf.InverseTransformPositionNoScale(FMath::RayPlaneIntersection(Origin, Direction, Glass));
	OutAcrossUp = FVector2D(-Local.Y, Local.Z);
	return true;
}

bool AWonderlandWonderWebScreen::BeginDrag(APlayerController* Controller, const FVector2D& ViewportPixel)
{
	FVector2D Held;
	if (!bPresented || bMinimized || !RayOnPlane(Controller, ViewportPixel, Held))
	{
		return false;
	}
	bDragging = true;
	// Where on the glass it was taken hold of, so it moves with the pointer rather than jumping its centre to it.
	DragGrip = Held - Offset;
	Place = TEXT("free");
	bOnGrid = false;
	return true;
}

void AWonderlandWonderWebScreen::DragTo(APlayerController* Controller, const FVector2D& ViewportPixel)
{
	FVector2D Held;
	if (bDragging && RayOnPlane(Controller, ViewportPixel, Held))
	{
		const FVector2D Limit = Reach();
		const FVector2D Want = Held - DragGrip;
		TargetOffset = FVector2D(FMath::Clamp(Want.X, -Limit.X, Limit.X), FMath::Clamp(Want.Y, -Limit.Y, Limit.Y));
	}
}

void AWonderlandWonderWebScreen::EndDrag()
{
	if (!bDragging)
	{
		return;
	}
	bDragging = false;
	// The nearest place on the grid is remembered for the next keyboard step; the glass stays exactly where it was left.
	const FVector2D Limit = Reach();
	Cell = FIntPoint(Limit.X > 1.0 ? FMath::RoundToInt(TargetOffset.X / Limit.X) : 0, Limit.Y > 1.0 ? FMath::RoundToInt(TargetOffset.Y / Limit.Y) : 0);
}

FVector AWonderlandWonderWebScreen::WindowPixelToWorld(const FVector2D& WindowPixel) const
{
	const UWidgetComponent* Glass = bMinimized ? Chip.Get() : Screen.Get();
	const FVector2D Draw = Glass->GetCurrentDrawSize();
	const FVector2D Pivot = Glass->GetPivot();
	// The inverse of UWidgetComponent::GetLocalHitLocation: x = -Y + Draw.X * Pivot.X, y = -Z + Draw.Y * Pivot.Y.
	const FVector Local(0.0, Draw.X * Pivot.X - WindowPixel.X, Draw.Y * Pivot.Y - WindowPixel.Y);
	return Glass->GetComponentTransform().TransformPosition(Local);
}

bool AWonderlandWonderWebScreen::HitComponent(const UWidgetComponent* Component, APlayerController* Controller, const FVector2D& ViewportPixel,
	double& OutDistance, FVector2D& OutPixel, FVector& OutHit) const
{
	FVector Origin;
	FVector Direction;
	if (Component == nullptr || Controller == nullptr || !Controller->DeprojectScreenPositionToWorld(ViewportPixel.X, ViewportPixel.Y, Origin, Direction))
	{
		return false;
	}
	const FTransform& Xf = Component->GetComponentTransform();
	const FPlane Glass(Xf.GetLocation(), Xf.GetUnitAxis(EAxis::X));
	if (FMath::IsNearlyZero(FVector::DotProduct(Direction, Glass.GetNormal())))
	{
		return false;
	}
	OutHit = FMath::RayPlaneIntersection(Origin, Direction, Glass);
	const FVector Local = Xf.InverseTransformPosition(OutHit);
	const FVector2D Draw = Component->GetCurrentDrawSize();
	OutPixel = FVector2D(-Local.Y + Draw.X * Component->GetPivot().X, -Local.Z + Draw.Y * Component->GetPivot().Y);
	OutDistance = FVector::DotProduct(OutHit - Origin, Direction);
	return OutPixel.X >= 0.0 && OutPixel.Y >= 0.0 && OutPixel.X <= Draw.X && OutPixel.Y <= Draw.Y && OutDistance > 0.0;
}

bool AWonderlandWonderWebScreen::HitTest(APlayerController* Controller, const FVector2D& ViewportPixel, double& OutDistance, FVector2D& OutPixel) const
{
	if (!bPresented)
	{
		return false;
	}
	FVector Hit;
	// A window is only hit while it is open enough to be seen; a minimized one is hit on its chip.
	if (bMinimized)
	{
		return ChipGrow > 0.5f && HitComponent(Chip, Controller, ViewportPixel, OutDistance, OutPixel, Hit);
	}
	return Grow > 0.5f && HitComponent(Screen, Controller, ViewportPixel, OutDistance, OutPixel, Hit);
}

bool AWonderlandWonderWebScreen::AimAtViewportPixel(APlayerController* Controller, const FVector2D& ViewportPixel)
{
	LastAimPixel = FVector2D(-1.0, -1.0);
	UWidgetComponent* Glass = bMinimized ? Chip.Get() : Screen.Get();
	double Distance = 0.0;
	FVector2D Pixel;
	FVector Hit;
	FVector Origin;
	FVector Direction;
	if (Interaction == nullptr || Controller == nullptr || !bPresented || !Controller->DeprojectScreenPositionToWorld(ViewportPixel.X, ViewportPixel.Y, Origin, Direction))
	{
		return false;
	}
	const bool bOnGlass = HitComponent(Glass, Controller, ViewportPixel, Distance, Pixel, Hit);
	LastAimPixel = Pixel;
	FHitResult Result;
	Result.bBlockingHit = bOnGlass;
	Result.Component = Glass;
	Result.Location = Hit;
	Result.ImpactPoint = Hit;
	Result.Normal = Glass->GetComponentTransform().GetUnitAxis(EAxis::X);
	Result.ImpactNormal = Result.Normal;
	Result.TraceStart = Origin;
	Result.TraceEnd = Origin + Direction * 5000.0;
	Result.Distance = static_cast<float>(Distance);
	Interaction->SetCustomHitResult(Result);
	Interaction->RefreshHover();
	return bOnGlass;
}

void AWonderlandWonderWebScreen::AimElsewhere()
{
	if (Interaction != nullptr && Interaction->GetHoveredWidgetComponent() != nullptr)
	{
		Interaction->SetCustomHitResult(FHitResult());
		Interaction->RefreshHover();
	}
}

/* ==================================================================== the input layer */

void SWonderlandWonderWebInputLayer::Construct(const FArguments& InArgs)
{
	Controller = InArgs._Controller;
	GetScreens = InArgs._GetScreens;
	OnFocus = InArgs._OnFocus;
	OnRequestClose = InArgs._OnRequestClose;
	SetVisibility(EVisibility::Visible);
}

bool SWonderlandWonderWebInputLayer::ToViewportPixel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent, FVector2D& OutPixel) const
{
	APlayerController* Player = Controller.Get();
	if (Player == nullptr)
	{
		return false;
	}
	// Slate units to viewport pixels: the layer fills the game viewport.
	const FVector2D Local = MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition());
	const FVector2D LocalSize = MyGeometry.GetLocalSize();
	FVector2D ViewportSize(0.0, 0.0);
	if (const ULocalPlayer* LocalPlayer = Player->GetLocalPlayer())
	{
		if (LocalPlayer->ViewportClient != nullptr)
		{
			LocalPlayer->ViewportClient->GetViewportSize(ViewportSize);
		}
	}
	if (LocalSize.X <= 0.0 || LocalSize.Y <= 0.0 || ViewportSize.X <= 0.0)
	{
		return false;
	}
	OutPixel = Local / LocalSize * ViewportSize;
	return true;
}

AWonderlandWonderWebScreen* SWonderlandWonderWebInputLayer::AimFrontMost(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	FVector2D Pixel;
	if (!GetScreens.IsBound() || !ToViewportPixel(MyGeometry, MouseEvent, Pixel))
	{
		return nullptr;
	}
	const TArray<AWonderlandWonderWebScreen*> Screens = GetScreens.Execute();
	AWonderlandWonderWebScreen* Best = nullptr;
	double BestDistance = TNumericLimits<double>::Max();
	for (AWonderlandWonderWebScreen* Candidate : Screens)
	{
		double Distance = 0.0;
		FVector2D WindowPixel;
		if (Candidate != nullptr && Candidate->HitTest(Controller.Get(), Pixel, Distance, WindowPixel) && Distance < BestDistance)
		{
			Best = Candidate;
			BestDistance = Distance;
		}
	}
	for (AWonderlandWonderWebScreen* Candidate : Screens)
	{
		if (Candidate == nullptr)
		{
			continue;
		}
		if (Candidate == Best)
		{
			Candidate->AimAtViewportPixel(Controller.Get(), Pixel);
		}
		else
		{
			Candidate->AimElsewhere();
		}
	}
	return Best;
}

AWonderlandWonderWebScreen* SWonderlandWonderWebInputLayer::FocusedScreen() const
{
	if (!GetScreens.IsBound())
	{
		return nullptr;
	}
	for (AWonderlandWonderWebScreen* Candidate : GetScreens.Execute())
	{
		if (Candidate != nullptr && Candidate->IsFocused())
		{
			return Candidate;
		}
	}
	return nullptr;
}

FReply SWonderlandWonderWebInputLayer::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	FSlateApplication::Get().SetKeyboardFocus(SharedThis(this), EFocusCause::Mouse);
	AWonderlandWonderWebScreen* Target = AimFrontMost(MyGeometry, MouseEvent);
	Pressed = Target;
	if (Target == nullptr)
	{
		UE_LOG(LogTemp, Log, TEXT("WLWEB press at (%.0f, %.0f): on no window"), MouseEvent.GetScreenSpacePosition().X, MouseEvent.GetScreenSpacePosition().Y);
		return FReply::Handled();
	}
	// A press focuses the window it lands on.
	OnFocus.ExecuteIfBound(Target);
	// TAKEN BY THE TITLE BAR: a left press on the bar's bare space -- not on a tab, not on a window button -- picks the
	// window up. It moves with the pointer until release.
	FVector2D PressPixel;
	if (!Target->IsMinimized() && MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton
		&& Target->GetLastAimPixel().Y < SWonderlandWonderWebPanel::TitleBarHeight() && !Target->GetInteraction()->IsOverInteractableWidget()
		&& ToViewportPixel(MyGeometry, MouseEvent, PressPixel) && Target->BeginDrag(Controller.Get(), PressPixel))
	{
		UE_LOG(LogTemp, Log, TEXT("WLWEB title bar taken at window pixel (%.0f, %.0f)"), Target->GetLastAimPixel().X, Target->GetLastAimPixel().Y);
		return FReply::Handled().CaptureMouse(SharedThis(this));
	}
	Target->GetInteraction()->PressPointerKey(MouseEvent.GetEffectingButton());
	++ForwardedClicks;
	UE_LOG(LogTemp, Log, TEXT("WLWEB press at (%.0f, %.0f) -> window pixel (%.0f, %.0f) on %s"), MouseEvent.GetScreenSpacePosition().X, MouseEvent.GetScreenSpacePosition().Y,
		Target->GetLastAimPixel().X, Target->GetLastAimPixel().Y, *Target->GetName());
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	AWonderlandWonderWebScreen* Target = Pressed.Get();
	Pressed.Reset();
	if (Target != nullptr && Target->IsDragging())
	{
		Target->EndDrag();
		return FReply::Handled().ReleaseMouseCapture();
	}
	FVector2D Pixel;
	if (Target != nullptr && ToViewportPixel(MyGeometry, MouseEvent, Pixel))
	{
		Target->AimAtViewportPixel(Controller.Get(), Pixel);
		Target->GetInteraction()->ReleasePointerKey(MouseEvent.GetEffectingButton());
	}
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	AWonderlandWonderWebScreen* Target = Pressed.Get();
	FVector2D Pixel;
	if (Target != nullptr && Target->IsDragging() && ToViewportPixel(MyGeometry, MouseEvent, Pixel))
	{
		Target->DragTo(Controller.Get(), Pixel);
		return FReply::Handled();
	}
	AimFrontMost(MyGeometry, MouseEvent);
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (AWonderlandWonderWebScreen* Target = AimFrontMost(MyGeometry, MouseEvent))
	{
		Target->GetInteraction()->ScrollWheel(MouseEvent.GetWheelDelta());
	}
	return FReply::Handled();
}

bool SWonderlandWonderWebInputLayer::IsEditingKey(const FKey& Key)
{
	return Key == EKeys::Enter || Key == EKeys::BackSpace || Key == EKeys::Delete || Key == EKeys::Left || Key == EKeys::Right
		|| Key == EKeys::Home || Key == EKeys::End || Key == EKeys::Up || Key == EKeys::Down;
}

FReply SWonderlandWonderWebInputLayer::OnKeyChar(const FGeometry& MyGeometry, const FCharacterEvent& InCharacterEvent)
{
	const TCHAR Character = InCharacterEvent.GetCharacter();
	// Control characters arrive as key downs; only printable text is typed, into the focused window.
	AWonderlandWonderWebScreen* Target = FocusedScreen();
	if (Target != nullptr && Character >= 32 && Character != 127)
	{
		Target->GetInteraction()->SendKeyChar(FString(1, &Character), InCharacterEvent.IsRepeat());
		++ForwardedCharacters;
	}
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::Escape)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	AWonderlandWonderWebScreen* Target = FocusedScreen();
	// CTRL + ARROWS: the focused window steps across the view's grid of places; CTRL + HOME back to the middle.
	if (InKeyEvent.IsControlDown() && Target != nullptr)
	{
		const int32 Across = Key == EKeys::Left ? -1 : (Key == EKeys::Right ? 1 : 0);
		const int32 Up = Key == EKeys::Up ? 1 : (Key == EKeys::Down ? -1 : 0);
		if (Across != 0 || Up != 0)
		{
			Target->Step(Across, Up);
			return FReply::Handled();
		}
		if (Key == EKeys::Home)
		{
			Target->MoveTo(TEXT("center"));
			return FReply::Handled();
		}
	}
	if (IsEditingKey(Key))
	{
		if (Target != nullptr)
		{
			Target->GetInteraction()->PressKey(Key, InKeyEvent.IsRepeat());
		}
		return FReply::Handled();
	}
	// Everything else is left to Slate, so a character key still produces its OnKeyChar.
	return FReply::Unhandled();
}

FReply SWonderlandWonderWebInputLayer::OnKeyUp(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (IsEditingKey(InKeyEvent.GetKey()))
	{
		if (AWonderlandWonderWebScreen* Target = FocusedScreen())
		{
			Target->GetInteraction()->ReleaseKey(InKeyEvent.GetKey());
		}
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

#include "WonderlandWonderWebScreen.h"

#include "Camera/CameraComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "InputCoreTypes.h"
#include "WonderlandWonderWebPanel.h"

namespace WonderWebScreenTuning
{
	// A SCREEN IN THE GARDEN, framed by the camera with the world round its edges: about three metres wide, stood a
	// little over three metres out ahead of where the player is looking and raised above the Dog, the camera held far
	// enough back that the window fills about half the view. SMALLER THAN THE FIRST CUT, ON PURPOSE (founder, 2026-09-17:
	// "minimize the wonder web page box just a little bit, because Julius will be spawning multiple wonder webs"): at
	// 335 uu it filled 60% of the width; at 385 it fills about 52%, and there is world -- and room -- beside it.
	TAutoConsoleVariable<float> CVarScale(TEXT("wl.WonderWeb.ScreenScale"), 0.2f, TEXT("Wonder Web screen: uu per window pixel (the window is 1536 x 1024)."));
	TAutoConsoleVariable<float> CVarAhead(TEXT("wl.WonderWeb.ScreenAhead"), 330.0f, TEXT("Wonder Web screen: how far ahead of the Dog it stands, along the player's view, uu."));
	TAutoConsoleVariable<float> CVarUp(TEXT("wl.WonderWeb.ScreenUp"), 150.0f, TEXT("Wonder Web screen: how high its centre stands above the Dog, uu."));
	TAutoConsoleVariable<float> CVarViewDistance(TEXT("wl.WonderWeb.ViewDistance"), 385.0f, TEXT("Wonder Web screen: the camera's distance back from the glass, uu."));
	TAutoConsoleVariable<float> CVarViewSide(TEXT("wl.WonderWeb.ViewSide"), -16.0f, TEXT("Wonder Web screen: the camera's sideways offset, uu; shifts the window across the view clear of the HUD."));
	TAutoConsoleVariable<float> CVarViewLift(TEXT("wl.WonderWeb.ViewLift"), 8.0f, TEXT("Wonder Web screen: the camera's height above the glass's centre, uu."));
	TAutoConsoleVariable<float> CVarViewFov(TEXT("wl.WonderWeb.ViewFov"), 75.0f, TEXT("Wonder Web screen: the camera's horizontal field of view, degrees."));
	// LIT LIKE A SCREEN IN SUNLIGHT. The garden is lit physically and its exposure is set for daylight, so a widget's
	// unlit colour of 1.0 lands almost black: editor 76 drew the whole window as a black slab while its render target held
	// every yellow line and word. The Dog's glowing props carry the same kind of multiplier (DogGlowExposure). 20000 reads
	// the yellow and keeps a disabled control visibly faint; 40000 starts to bloom the active tab into a bar.
	TAutoConsoleVariable<float> CVarBrightness(TEXT("wl.WonderWeb.ScreenBrightness"), 20000.0f, TEXT("Wonder Web screen: how bright the window is drawn in the lit world (a multiplier on its colours)."));
	TAutoConsoleVariable<float> CVarGlideSeconds(TEXT("wl.WonderWeb.GlideSeconds"), 0.18f, TEXT("Wonder Web screen: the timescale of its glide to a new place, seconds (critically damped: swift, no overshoot)."));
	TAutoConsoleVariable<float> CVarEdgeMargin(TEXT("wl.WonderWeb.EdgeMargin"), 12.0f, TEXT("Wonder Web screen: how far inside the view's edge a corner or side place keeps the glass, uu."));
	TAutoConsoleVariable<float> CVarGrowSeconds(TEXT("wl.WonderWeb.GrowSeconds"), 0.35f, TEXT("Wonder Web screen: seconds to open out or fold away."));
}

AWonderlandWonderWebScreen::AWonderlandWonderWebScreen()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = true;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Screen = CreateDefaultSubobject<UWidgetComponent>(TEXT("WonderWebScreen"));
	Screen->SetupAttachment(Root);
	Screen->SetWidgetSpace(EWidgetSpace::World);
	Screen->SetDrawSize(SWonderlandWonderWebPanel::DesignSize());
	Screen->SetPivot(FVector2D(0.5, 0.5));
	// Transparent, so the text is antialiased and the window's rounded corners show the garden behind them.
	Screen->SetBlendMode(EWidgetBlendMode::Transparent);
	Screen->SetTwoSided(false);
	Screen->SetBackgroundColor(FLinearColor::Transparent);
	Screen->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Screen->SetGenerateOverlapEvents(false);
	Screen->SetCastShadow(false);
	Screen->SetTickWhenOffscreen(true);
	Screen->PrimaryComponentTick.bTickEvenWhenPaused = true;

	Interaction = CreateDefaultSubobject<UWonderlandWonderWebInteraction>(TEXT("WonderWebPointer"));
	Interaction->SetupAttachment(Root);
	// The layer supplies where the cursor meets the glass; nothing is traced against the world.
	Interaction->InteractionSource = EWidgetInteractionSource::Custom;
	Interaction->bEnableHitTesting = true;
	Interaction->InteractionDistance = 5000.0f;
	Interaction->VirtualUserIndex = 7;
	Interaction->PointerIndex = 0;

	View = CreateDefaultSubobject<UCameraComponent>(TEXT("WonderWebView"));
	View->SetupAttachment(Root);
	View->bConstrainAspectRatio = false;

	SetActorHiddenInGame(true);
}

void AWonderlandWonderWebScreen::Present(const TSharedRef<SWidget>& Window, const FVector& Centre, const FRotator& Facing)
{
	using namespace WonderWebScreenTuning;
	if (Shown != Window)
	{
		Screen->SetSlateWidget(Window);
		Shown = Window;
	}
	SetActorLocationAndRotation(Centre, Facing);
	// THE CAMERA STANDS IN FRONT OF THE GLASS, on +X, looking back along -X: a widget component's front faces +X and its
	// pixels run toward -Y (UWidgetComponent::GetLocalHitLocation), which is this camera's right.
	View->SetRelativeLocationAndRotation(
		FVector(CVarViewDistance.GetValueOnGameThread(), CVarViewSide.GetValueOnGameThread(), CVarViewLift.GetValueOnGameThread()),
		FRotator(-FMath::RadiansToDegrees(FMath::Atan2(CVarViewLift.GetValueOnGameThread(), FMath::Max(CVarViewDistance.GetValueOnGameThread(), 1.0f))), 180.0f, 0.0f));
	View->SetFieldOfView(CVarViewFov.GetValueOnGameThread());
	bPresented = true;
	SetActorHiddenInGame(false);
	SetActorTickEnabled(true);
}

void AWonderlandWonderWebScreen::Dismiss()
{
	bPresented = false;
}

void AWonderlandWonderWebScreen::Tick(float DeltaSeconds)
{
	using namespace WonderWebScreenTuning;
	Super::Tick(DeltaSeconds);
	const float Seconds = FMath::Max(CVarGrowSeconds.GetValueOnGameThread(), 0.01f);
	Grow = FMath::Clamp(Grow + (bPresented ? 1.0f : -1.0f) * DeltaSeconds / Seconds, 0.0f, 1.0f);
	// It opens out from a line across its middle, like a screen switching on, and folds back the same way.
	const float Open = FMath::SmoothStep(0.0f, 1.0f, Grow);
	const float Scale = CVarScale.GetValueOnGameThread();
	Screen->SetRelativeScale3D(FVector(Scale, Scale, Scale * FMath::Max(Open, 0.02f)));

	// THE GLIDE. Critically damped toward the target, in short sub-steps so a slow frame is still a smooth curve.
	const FVector2D Limit = Reach();
	if (!bDragging)
	{
		TargetOffset = FVector2D(FMath::Clamp(TargetOffset.X, -Limit.X, Limit.X), FMath::Clamp(TargetOffset.Y, -Limit.Y, Limit.Y));
	}
	const float Glide = FMath::Max(CVarGlideSeconds.GetValueOnGameThread(), 0.02f);
	float Remaining = FMath::Min(DeltaSeconds, 0.25f);
	while (Remaining > 0.0f)
	{
		const float Slice = FMath::Min(Remaining, Glide * 0.4f);
		FMath::CriticallyDampedSmoothing(Offset, OffsetRate, TargetOffset, FVector2D::ZeroVector, Slice, Glide);
		Remaining -= Slice;
	}
	// IT ARRIVES, AND THEN IT IS STILL. A critically damped glide approaches its target forever; the last creep of a few
	// uu is what the temporal upscaler smeared into doubled text on a translucent screen (editor 78: sharp mid-glide,
	// ghosted on arrival). Within two uu and nearly stopped, it lands exactly.
	if (!bDragging && FVector2D::Distance(Offset, TargetOffset) < 2.0 && OffsetRate.Size() < 30.0)
	{
		Offset = TargetOffset;
		OffsetRate = FVector2D::ZeroVector;
	}
	// Across the view is the root's -Y (the camera looks back along -X), up is +Z.
	Screen->SetRelativeLocation(FVector(0.0, -Offset.X, Offset.Y));
	const float Brightness = FMath::Max(CVarBrightness.GetValueOnGameThread(), 1.0f);
	if (!FMath::IsNearlyEqual(AppliedBrightness, Brightness))
	{
		Screen->SetTintColorAndOpacity(FLinearColor(Brightness, Brightness, Brightness, 1.0f));
		AppliedBrightness = Brightness;
	}
	if (!bPresented && Grow <= 0.0f && !IsHidden())
	{
		SetActorHiddenInGame(true);
	}
}

FVector2D AWonderlandWonderWebScreen::Reach() const
{
	using namespace WonderWebScreenTuning;
	// Half the view at the glass's distance, less half the glass and a margin: the glass stays whole in every place.
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
	const double HalfHigh = HalfWide / Aspect;
	const FVector2D Glass = SWonderlandWonderWebPanel::DesignSize() * CVarScale.GetValueOnGameThread() * 0.5;
	const double Margin = CVarEdgeMargin.GetValueOnGameThread();
	return FVector2D(FMath::Max(HalfWide - Glass.X - Margin, 0.0), FMath::Max(HalfHigh - Glass.Y - Margin, 0.0));
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
	const FVector2D Limit = Reach();
	TargetOffset = FVector2D(To.X * Limit.X, To.Y * Limit.Y);
	return true;
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
	if (!bPresented || !RayOnPlane(Controller, ViewportPixel, Held))
	{
		return false;
	}
	bDragging = true;
	// Where on the glass it was taken hold of, so it moves with the pointer rather than jumping its centre to it.
	DragGrip = Held - Offset;
	Place = TEXT("free");
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
	const FVector2D Draw = Screen->GetCurrentDrawSize();
	const FVector2D Pivot = Screen->GetPivot();
	// The inverse of UWidgetComponent::GetLocalHitLocation: x = -Y + Draw.X * Pivot.X, y = -Z + Draw.Y * Pivot.Y.
	const FVector Local(0.0, Draw.X * Pivot.X - WindowPixel.X, Draw.Y * Pivot.Y - WindowPixel.Y);
	return Screen->GetComponentTransform().TransformPosition(Local);
}

bool AWonderlandWonderWebScreen::AimAtViewportPixel(APlayerController* Controller, const FVector2D& ViewportPixel)
{
	LastAimPixel = FVector2D(-1.0, -1.0);
	if (Controller == nullptr || !bPresented || Interaction == nullptr)
	{
		return false;
	}
	FVector Origin;
	FVector Direction;
	if (!Controller->DeprojectScreenPositionToWorld(ViewportPixel.X, ViewportPixel.Y, Origin, Direction))
	{
		return false;
	}
	const FTransform& Xf = Screen->GetComponentTransform();
	const FPlane Glass(Xf.GetLocation(), Xf.GetUnitAxis(EAxis::X));
	const double Facing = FVector::DotProduct(Direction, Glass.GetNormal());
	if (FMath::IsNearlyZero(Facing))
	{
		return false;
	}
	const FVector Hit = FMath::RayPlaneIntersection(Origin, Direction, Glass);
	const FVector Local = Xf.InverseTransformPosition(Hit);
	const FVector2D Draw = Screen->GetCurrentDrawSize();
	const FVector2D Pixel(-Local.Y + Draw.X * Screen->GetPivot().X, -Local.Z + Draw.Y * Screen->GetPivot().Y);
	const bool bOnGlass = Pixel.X >= 0.0 && Pixel.Y >= 0.0 && Pixel.X <= Draw.X && Pixel.Y <= Draw.Y
		&& FVector::DotProduct(Hit - Origin, Direction) > 0.0;
	LastAimPixel = Pixel;

	FHitResult Result;
	Result.bBlockingHit = bOnGlass;
	Result.Component = Screen;
	Result.Location = Hit;
	Result.ImpactPoint = Hit;
	Result.Normal = Glass.GetNormal();
	Result.ImpactNormal = Glass.GetNormal();
	Result.TraceStart = Origin;
	Result.TraceEnd = Origin + Direction * 5000.0;
	Result.Distance = static_cast<float>((Hit - Origin).Size());
	Interaction->SetCustomHitResult(Result);
	Interaction->RefreshHover();
	return bOnGlass;
}

/* ==================================================================== the input layer */

void SWonderlandWonderWebInputLayer::Construct(const FArguments& InArgs)
{
	Screen = InArgs._Screen;
	Controller = InArgs._Controller;
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

bool SWonderlandWonderWebInputLayer::Aim(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	AWonderlandWonderWebScreen* Target = Screen.Get();
	FVector2D Pixel;
	return Target != nullptr && ToViewportPixel(MyGeometry, MouseEvent, Pixel) && Target->AimAtViewportPixel(Controller.Get(), Pixel);
}

FReply SWonderlandWonderWebInputLayer::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	FSlateApplication::Get().SetKeyboardFocus(SharedThis(this), EFocusCause::Mouse);
	const bool bOnGlass = Aim(MyGeometry, MouseEvent);
	// TAKEN BY THE TITLE BAR: a left press on the bar's empty space -- not on a tab, not on a window button -- picks the
	// screen up. It moves with the pointer until release.
	AWonderlandWonderWebScreen* Target = Screen.Get();
	FVector2D PressPixel;
	if (bOnGlass && Target != nullptr && MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton
		&& Target->GetLastAimPixel().Y < 96.0 && !Target->GetInteraction()->IsOverInteractableWidget()
		&& ToViewportPixel(MyGeometry, MouseEvent, PressPixel) && Target->BeginDrag(Controller.Get(), PressPixel))
	{
		UE_LOG(LogTemp, Log, TEXT("WLWEB title bar taken at window pixel (%.0f, %.0f)"), Target->GetLastAimPixel().X, Target->GetLastAimPixel().Y);
		return FReply::Handled().CaptureMouse(SharedThis(this));
	}
	if (bOnGlass)
	{
		if (UWidgetInteractionComponent* Pointer = Screen.IsValid() ? Screen->GetInteraction() : nullptr)
		{
			Pointer->PressPointerKey(MouseEvent.GetEffectingButton());
			++ForwardedClicks;
		}
	}
	const FVector2D Pixel = Screen.IsValid() ? Screen->GetLastAimPixel() : FVector2D(-1.0, -1.0);
	UE_LOG(LogTemp, Log, TEXT("WLWEB press at (%.0f, %.0f) -> window pixel (%.0f, %.0f): %s"), MouseEvent.GetScreenSpacePosition().X, MouseEvent.GetScreenSpacePosition().Y,
		Pixel.X, Pixel.Y, bOnGlass ? TEXT("on the glass") : TEXT("off the glass"));
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (AWonderlandWonderWebScreen* Target = Screen.Get())
	{
		if (Target->IsDragging())
		{
			Target->EndDrag();
			return FReply::Handled().ReleaseMouseCapture();
		}
	}
	Aim(MyGeometry, MouseEvent);
	if (UWidgetInteractionComponent* Pointer = Screen.IsValid() ? Screen->GetInteraction() : nullptr)
	{
		Pointer->ReleasePointerKey(MouseEvent.GetEffectingButton());
	}
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	AWonderlandWonderWebScreen* Target = Screen.Get();
	FVector2D Pixel;
	if (Target != nullptr && Target->IsDragging() && ToViewportPixel(MyGeometry, MouseEvent, Pixel))
	{
		Target->DragTo(Controller.Get(), Pixel);
		return FReply::Handled();
	}
	Aim(MyGeometry, MouseEvent);
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (Aim(MyGeometry, MouseEvent))
	{
		if (UWidgetInteractionComponent* Pointer = Screen.IsValid() ? Screen->GetInteraction() : nullptr)
		{
			Pointer->ScrollWheel(MouseEvent.GetWheelDelta());
		}
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
	// Control characters arrive as key downs; only printable text is typed.
	if (Character >= 32 && Character != 127)
	{
		if (UWidgetInteractionComponent* Pointer = Screen.IsValid() ? Screen->GetInteraction() : nullptr)
		{
			Pointer->SendKeyChar(FString(1, &Character), InCharacterEvent.IsRepeat());
			++ForwardedCharacters;
		}
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
	// CTRL + ARROWS: one step across the view's grid of places; CTRL + HOME back to the middle.
	if (InKeyEvent.IsControlDown() && Screen.IsValid())
	{
		const int32 Across = Key == EKeys::Left ? -1 : (Key == EKeys::Right ? 1 : 0);
		const int32 Up = Key == EKeys::Up ? 1 : (Key == EKeys::Down ? -1 : 0);
		if (Across != 0 || Up != 0)
		{
			Screen->Step(Across, Up);
			return FReply::Handled();
		}
		if (Key == EKeys::Home)
		{
			Screen->MoveTo(TEXT("center"));
			return FReply::Handled();
		}
	}
	if (IsEditingKey(Key))
	{
		if (UWidgetInteractionComponent* Pointer = Screen.IsValid() ? Screen->GetInteraction() : nullptr)
		{
			Pointer->PressKey(Key, InKeyEvent.IsRepeat());
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
		if (UWidgetInteractionComponent* Pointer = Screen.IsValid() ? Screen->GetInteraction() : nullptr)
		{
			Pointer->ReleaseKey(InKeyEvent.GetKey());
		}
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

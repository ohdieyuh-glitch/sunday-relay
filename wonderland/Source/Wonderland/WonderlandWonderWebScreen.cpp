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

bool SWonderlandWonderWebInputLayer::Aim(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	AWonderlandWonderWebScreen* Target = Screen.Get();
	APlayerController* Player = Controller.Get();
	if (Target == nullptr || Player == nullptr)
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
	return Target->AimAtViewportPixel(Player, Local / LocalSize * ViewportSize);
}

FReply SWonderlandWonderWebInputLayer::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	FSlateApplication::Get().SetKeyboardFocus(SharedThis(this), EFocusCause::Mouse);
	const bool bOnGlass = Aim(MyGeometry, MouseEvent);
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
	Aim(MyGeometry, MouseEvent);
	if (UWidgetInteractionComponent* Pointer = Screen.IsValid() ? Screen->GetInteraction() : nullptr)
	{
		Pointer->ReleasePointerKey(MouseEvent.GetEffectingButton());
	}
	return FReply::Handled();
}

FReply SWonderlandWonderWebInputLayer::OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
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

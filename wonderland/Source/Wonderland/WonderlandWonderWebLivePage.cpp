#include "WonderlandWonderWebLivePage.h"

#include "Engine/Texture2D.h"
#include "Rendering/DrawElements.h"
#include "WonderlandWonderWebLive.h"

void SWonderlandWonderWebLivePage::Construct(const FArguments& InArgs)
{
	Live = InArgs._Live;
	SetCanTick(false);
	bCanSupportFocus = true;
	FrameBrush.DrawAs = ESlateBrushDrawType::Image;
	FrameBrush.TintColor = FSlateColor(FLinearColor::White);
	// A white ground, because that is what a browser shows around a page.
	GroundBrush.DrawAs = ESlateBrushDrawType::Image;
	GroundBrush.TintColor = FSlateColor(FLinearColor::White);
}

FVector2D SWonderlandWonderWebLivePage::ComputeDesiredSize(float) const
{
	const UWonderlandWonderWebLiveSubsystem* Subsystem = Live.Get();
	return Subsystem != nullptr ? FVector2D(Subsystem->GetFrameSize()) : FVector2D(1200.0, 800.0);
}

void SWonderlandWonderWebLivePage::PageRect(const FGeometry& Geometry, FVector2D& OutOffset, float& OutScale) const
{
	UWonderlandWonderWebLiveSubsystem* Subsystem = Live.Get();
	if (Subsystem != nullptr)
	{
		// THE PAGE IS THE SHAPE OF THE WINDOW. Asked every time it is drawn, acted on only when it really changes.
		Subsystem->SetViewport(FIntPoint(FMath::RoundToInt(Geometry.GetLocalSize().X), FMath::RoundToInt(Geometry.GetLocalSize().Y)));
	}
	const FVector2D Frame = Subsystem != nullptr ? FVector2D(Subsystem->GetFrameSize()) : FVector2D(1200.0, 800.0);
	const FVector2D Area = Geometry.GetLocalSize();
	// CONTAIN, NEVER STRETCH: the whole rendered page, in its own proportions.
	OutScale = static_cast<float>(FMath::Min(Area.X / FMath::Max(Frame.X, 1.0), Area.Y / FMath::Max(Frame.Y, 1.0)));
	OutOffset = (Area - Frame * OutScale) * 0.5;
}

int32 SWonderlandWonderWebLivePage::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	FSlateDrawElement::MakeBox(OutDrawElements, LayerId, AllottedGeometry.ToPaintGeometry(), &GroundBrush, ESlateDrawEffect::None, FLinearColor::White);
	UWonderlandWonderWebLiveSubsystem* Subsystem = Live.Get();
	UTexture2D* Texture = Subsystem != nullptr ? Subsystem->GetFrame() : nullptr;
	if (Texture == nullptr)
	{
		return LayerId + 1;
	}
	FVector2D Offset;
	float Scale = 1.0f;
	PageRect(AllottedGeometry, Offset, Scale);
	const FVector2D Size = FVector2D(Subsystem->GetFrameSize()) * Scale;
	if (FrameBrush.GetResourceObject() != Texture)
	{
		FrameBrush.SetResourceObject(Texture);
	}
	FrameBrush.ImageSize = FVector2f(Size);
	FSlateDrawElement::MakeBox(OutDrawElements, LayerId + 1,
		AllottedGeometry.ToPaintGeometry(Size, FSlateLayoutTransform(Offset)), &FrameBrush, ESlateDrawEffect::None, FLinearColor::White);
	return LayerId + 2;
}

FReply SWonderlandWonderWebLivePage::OnMouseButtonDown(const FGeometry& Geometry, const FPointerEvent& Event)
{
	UWonderlandWonderWebLiveSubsystem* Subsystem = Live.Get();
	if (Subsystem == nullptr || !Subsystem->HasFrame())
	{
		return FReply::Unhandled();
	}
	FVector2D Offset;
	float Scale = 1.0f;
	PageRect(Geometry, Offset, Scale);
	const FVector2D Local = Geometry.AbsoluteToLocal(Event.GetScreenSpacePosition());
	const FVector2D Page = (Local - Offset) / FMath::Max(Scale, KINDA_SMALL_NUMBER);
	const FVector2D Frame = FVector2D(Subsystem->GetFrameSize());
	if (Page.X < 0.0 || Page.Y < 0.0 || Page.X > Frame.X || Page.Y > Frame.Y)
	{
		// The letterbox around the page is not part of any website: a click there goes nowhere.
		return FReply::Handled();
	}
	Subsystem->SendClick(Page.X, Page.Y);
	// Keyboard focus follows the click, the way it does in a browser: typing then goes to the page.
	return FReply::Handled().SetUserFocus(SharedThis(this), EFocusCause::Mouse);
}

FReply SWonderlandWonderWebLivePage::OnMouseWheel(const FGeometry& Geometry, const FPointerEvent& Event)
{
	UWonderlandWonderWebLiveSubsystem* Subsystem = Live.Get();
	if (Subsystem == nullptr || !Subsystem->HasFrame())
	{
		return FReply::Unhandled();
	}
	Subsystem->SendScroll(Event.GetWheelDelta() * -120.0f);
	return FReply::Handled();
}

FReply SWonderlandWonderWebLivePage::OnKeyChar(const FGeometry& Geometry, const FCharacterEvent& Event)
{
	UWonderlandWonderWebLiveSubsystem* Subsystem = Live.Get();
	const TCHAR Char = Event.GetCharacter();
	if (Subsystem == nullptr || Char < 0x20)
	{
		return FReply::Unhandled();
	}
	// WHAT IS TYPED GOES STRAIGHT TO THE PAGE AND IS NEVER KEPT: it may be a password.
	Subsystem->SendText(FString::Chr(Char));
	return FReply::Handled();
}

FReply SWonderlandWonderWebLivePage::OnKeyDown(const FGeometry& Geometry, const FKeyEvent& Event)
{
	UWonderlandWonderWebLiveSubsystem* Subsystem = Live.Get();
	if (Subsystem == nullptr)
	{
		return FReply::Unhandled();
	}
	static const TMap<FKey, FString> Keys = {
		{ EKeys::Enter, TEXT("Enter") }, { EKeys::BackSpace, TEXT("Backspace") }, { EKeys::Tab, TEXT("Tab") },
		{ EKeys::Delete, TEXT("Delete") }, { EKeys::Escape, TEXT("Escape") },
		{ EKeys::Up, TEXT("ArrowUp") }, { EKeys::Down, TEXT("ArrowDown") },
		{ EKeys::Left, TEXT("ArrowLeft") }, { EKeys::Right, TEXT("ArrowRight") },
		{ EKeys::PageUp, TEXT("PageUp") }, { EKeys::PageDown, TEXT("PageDown") },
		{ EKeys::Home, TEXT("Home") }, { EKeys::End, TEXT("End") } };
	if (const FString* Key = Keys.Find(Event.GetKey()))
	{
		Subsystem->SendKey(*Key);
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

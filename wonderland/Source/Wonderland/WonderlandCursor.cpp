#include "WonderlandCursor.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandUiStyle.h"

namespace
{
	/** The founder's choice, remembered across a session and saved to config the moment it changes. */
	EWonderlandCursorShape GShape = EWonderlandCursorShape::System;
	bool GShapeLoaded = false;

	EWonderlandCursorShape FromName(const FString& Name)
	{
		if (Name.Equals(TEXT("arrow"), ESearchCase::IgnoreCase)) { return EWonderlandCursorShape::Arrow; }
		if (Name.Equals(TEXT("mark"), ESearchCase::IgnoreCase)) { return EWonderlandCursorShape::Mark; }
		if (Name.Equals(TEXT("ring"), ESearchCase::IgnoreCase)) { return EWonderlandCursorShape::Ring; }
		return EWonderlandCursorShape::System;
	}

	/** A line between two points, as a rotated box: Slate has no line primitive that takes a thickness. */
	void Stroke(FSlateWindowElementList& Out, int32 Layer, const FGeometry& Geometry,
				const FVector2f& From, const FVector2f& To, float Thick, const FLinearColor& Colour)
	{
		const FVector2f Span = To - From;
		const float Length = Span.Size();
		if (Length < 0.01f) { return; }
		static const FSlateBrush* White = FCoreStyle::Get().GetBrush("WhiteBrush");
		const float Turn = FMath::Atan2(Span.Y, Span.X);
		FSlateDrawElement::MakeRotatedBox(
			Out, Layer,
			Geometry.ToPaintGeometry(FVector2f(Length, Thick), FSlateLayoutTransform(From - FVector2f(0.0f, Thick * 0.5f))),
			White, ESlateDrawEffect::None, Turn, FVector2f(0.0f, Thick * 0.5f),
			FSlateDrawElement::RelativeToElement, Colour);
	}
}

void SWonderlandCursor::Construct(const FArguments& InArgs)
{
	Shape = InArgs._Shape;
	Size = InArgs._Size;
	SetCanTick(false);
	// A POINTER MUST NEVER EAT A CLICK. It is drawn over everything and must be invisible to hit testing, or it
	// would swallow the very press it is pointing at -- the trap already recorded for HitTestInvisible overlays.
	SetVisibility(EVisibility::HitTestInvisible);
}

FVector2D SWonderlandCursor::ComputeDesiredSize(float) const
{
	const float Edge = FMath::Max(Size.Get(22.0f), 6.0f);
	return FVector2D(Edge, Edge);
}

int32 SWonderlandCursor::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const EWonderlandCursorShape Which = Shape.Get(EWonderlandCursorShape::Arrow);
	if (Which == EWonderlandCursorShape::System)
	{
		return LayerId;
	}
	const float Edge = FMath::Max(Size.Get(22.0f), 6.0f);
	const FLinearColor Accent = WonderlandUi::Gold();
	// A DARK EDGE UNDER EVERY STROKE. Wonderland is pale stone in daylight and near-black at night, and a
	// single-coloured pointer disappears into one of them; the outline is what makes it readable in both.
	const FLinearColor Edging(0.0f, 0.01f, 0.03f, 0.85f);
	int32 Layer = LayerId;

	if (Which == EWonderlandCursorShape::Arrow)
	{
		// The classic pointer, drawn as three strokes from the hot spot at the top left.
		const FVector2f Tip(1.0f, 1.0f);
		const FVector2f Tail(Edge * 0.60f, Edge * 0.86f);
		const FVector2f Barb(Edge * 0.30f, Edge * 0.66f);
		for (int32 Pass = 0; Pass < 2; ++Pass)
		{
			const float Thick = (Pass == 0) ? 4.6f : 2.4f;
			const FLinearColor Ink = (Pass == 0) ? Edging : Accent;
			Stroke(OutDrawElements, Layer + Pass, AllottedGeometry, Tip, Tail, Thick, Ink);
			Stroke(OutDrawElements, Layer + Pass, AllottedGeometry, Tip, Barb, Thick, Ink);
			Stroke(OutDrawElements, Layer + Pass, AllottedGeometry, Barb, Tail, Thick, Ink);
		}
		return Layer + 2;
	}

	static const FSlateBrush* White = FCoreStyle::Get().GetBrush("WhiteBrush");
	const FVector2f Middle(Edge * 0.5f, Edge * 0.5f);
	if (Which == EWonderlandCursorShape::Ring)
	{
		const float Radius = Edge * 0.40f;
		for (int32 Pass = 0; Pass < 2; ++Pass)
		{
			const float Thick = (Pass == 0) ? 3.6f : 1.8f;
			const FLinearColor Ink = (Pass == 0) ? Edging : Accent;
			const int32 Steps = 20;
			for (int32 Step = 0; Step < Steps; ++Step)
			{
				const float A = 2.0f * PI * Step / Steps;
				const float B = 2.0f * PI * (Step + 1) / Steps;
				Stroke(OutDrawElements, Layer + Pass, AllottedGeometry,
					   Middle + FVector2f(FMath::Cos(A), FMath::Sin(A)) * Radius,
					   Middle + FVector2f(FMath::Cos(B), FMath::Sin(B)) * Radius, Thick, Ink);
			}
		}
		FSlateDrawElement::MakeBox(OutDrawElements, Layer + 2,
			AllottedGeometry.ToPaintGeometry(FVector2f(2.6f, 2.6f), FSlateLayoutTransform(Middle - FVector2f(1.3f, 1.3f))),
			White, ESlateDrawEffect::None, Accent);
		return Layer + 3;
	}

	// THE MARK: a ring, and the twin facing curves inside it -- the same figure the companion terminals beat.
	const float Radius = Edge * 0.42f;
	const int32 Steps = 22;
	for (int32 Pass = 0; Pass < 2; ++Pass)
	{
		const float Thick = (Pass == 0) ? 3.4f : 1.7f;
		const FLinearColor Ink = (Pass == 0) ? Edging : Accent;
		for (int32 Step = 0; Step < Steps; ++Step)
		{
			const float A = 2.0f * PI * Step / Steps;
			const float B = 2.0f * PI * (Step + 1) / Steps;
			Stroke(OutDrawElements, Layer + Pass, AllottedGeometry,
				   Middle + FVector2f(FMath::Cos(A), FMath::Sin(A)) * Radius,
				   Middle + FVector2f(FMath::Cos(B), FMath::Sin(B)) * Radius, Thick, Ink);
		}
		for (int32 Side = 0; Side < 2; ++Side)
		{
			const float Turn = (Side == 0) ? 1.0f : -1.0f;
			const float Inner = Radius * 0.52f;
			for (int32 Step = 0; Step < 8; ++Step)
			{
				const float A = PI * (0.25f + 0.5f * Step / 8.0f) * Turn;
				const float B = PI * (0.25f + 0.5f * (Step + 1) / 8.0f) * Turn;
				Stroke(OutDrawElements, Layer + Pass, AllottedGeometry,
					   Middle + FVector2f(FMath::Cos(A) * Turn, FMath::Sin(A)) * Inner,
					   Middle + FVector2f(FMath::Cos(B) * Turn, FMath::Sin(B)) * Inner, Thick * 0.8f, Ink);
			}
		}
	}
	return Layer + 2;
}

namespace WonderlandCursor
{
	EWonderlandCursorShape Chosen()
	{
		if (!GShapeLoaded)
		{
			GShapeLoaded = true;
			if (const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>())
			{
				GShape = FromName(Settings->CursorShape);
			}
		}
		return GShape;
	}

	void Forget()
	{
		GShapeLoaded = false;
	}

	const TCHAR* NameOf(EWonderlandCursorShape InShape)
	{
		switch (InShape)
		{
		case EWonderlandCursorShape::Arrow: return TEXT("arrow");
		case EWonderlandCursorShape::Mark:  return TEXT("mark");
		case EWonderlandCursorShape::Ring:  return TEXT("ring");
		default:                            return TEXT("system");
		}
	}

	void Apply(UGameViewportClient* Viewport)
	{
		if (Viewport == nullptr)
		{
			return;
		}
		const EWonderlandCursorShape Which = Chosen();
		if (Which == EWonderlandCursorShape::System)
		{
			// HANDED BACK, not drawn as nothing: an empty widget would still hide the machine's own pointer.
			Viewport->SetSoftwareCursorWidget(EMouseCursor::Default, TSharedPtr<SWidget>());
			Viewport->SetUseSoftwareCursorWidgets(false);
			return;
		}
		const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>();
		const float Edge = Settings != nullptr ? Settings->CursorSize : 22.0f;
		Viewport->SetSoftwareCursorWidget(EMouseCursor::Default,
			SNew(SWonderlandCursor).Shape(Which).Size(Edge));
		Viewport->SetUseSoftwareCursorWidgets(true);
	}
}

namespace
{
	FAutoConsoleCommandWithWorldAndArgs GCursorShape(
		TEXT("wl.Cursor"),
		TEXT("Wonderland's pointer: wl.Cursor <system|arrow|mark|ring> [size]. Saved."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>();
			if (Settings == nullptr || Args.Num() < 1)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLCURSOR usage: wl.Cursor <system|arrow|mark|ring> [size]"));
				return;
			}
			GShape = FromName(Args[0]);
			GShapeLoaded = true;
			Settings->CursorShape = WonderlandCursor::NameOf(GShape);
			if (Args.Num() > 1)
			{
				Settings->CursorSize = FMath::Clamp(FCString::Atof(*Args[1]), 8.0f, 64.0f);
			}
			Settings->SaveConfig();
			if (World != nullptr)
			{
				WonderlandCursor::Apply(World->GetGameViewport());
			}
			UE_LOG(LogTemp, Display, TEXT("WLCURSOR %s at %.0f px (saved)"), WonderlandCursor::NameOf(GShape), Settings->CursorSize);
		}));
}

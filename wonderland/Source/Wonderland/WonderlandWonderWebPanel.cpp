#include "WonderlandWonderWebPanel.h"

#include "Brushes/SlateRoundedBoxBrush.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableText.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SUniformGridPanel.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"
#include "WonderlandWonderWeb.h"

namespace WonderWebCanvasLook
{
	/** The peer dot palette, by the TOKEN the domain assigns (relay-wonder-web.css). */
	inline FLinearColor Dot(const FString& Token)
	{
		if (Token == TEXT("wonder-dot-amber"))  { return WonderlandUi::Srgb(0xF5, 0xB8, 0x00); }
		if (Token == TEXT("wonder-dot-violet")) { return WonderlandUi::Srgb(0xA8, 0x55, 0xF7); }
		if (Token == TEXT("wonder-dot-azure"))  { return WonderlandUi::Srgb(0x3B, 0x9E, 0xFF); }
		if (Token == TEXT("wonder-dot-rose"))   { return WonderlandUi::Srgb(0xFF, 0x4D, 0x8D); }
		if (Token == TEXT("wonder-dot-jade"))   { return WonderlandUi::Srgb(0x3D, 0xDC, 0x97); }
		if (Token == TEXT("wonder-dot-coral"))  { return WonderlandUi::Srgb(0xFF, 0x7A, 0x45); }
		return WonderWebLook::Line(0.6f);
	}

	/** Pixel Canvas's palette: the sample creation's own colours, not Wonder Web's. */
	inline FLinearColor PaintColour(int32 Index)
	{
		switch (Index)
		{
		case 1: return WonderlandUi::Srgb(0xFF, 0xD4, 0x00);
		case 2: return WonderlandUi::Srgb(0x3B, 0x9E, 0xFF);
		case 3: return WonderlandUi::Srgb(0xFF, 0x4D, 0x8D);
		case 4: return WonderlandUi::Srgb(0x3D, 0xDC, 0x97);
		case 5: return WonderlandUi::Srgb(0x1F, 0x1F, 0x2A);
		default: return WonderlandUi::Srgb(0xF4, 0xF1, 0xE8);
		}
	}

}

/* ==================================================================== glyphs */

void SWonderWebGlyph::Construct(const FArguments& InArgs)
{
	Glyph = InArgs._Glyph;
	Size = InArgs._Size;
	Color = InArgs._Color;
	Thickness = InArgs._Thickness;
}

FVector2D SWonderWebGlyph::ComputeDesiredSize(float) const
{
	return FVector2D(Size, Size);
}

int32 SWonderWebGlyph::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const FVector2D Box = AllottedGeometry.GetLocalSize();
	const double S = FMath::Min(Box.X, Box.Y);
	const FVector2D Origin((Box.X - S) * 0.5, (Box.Y - S) * 0.5);
	const FLinearColor Tint = Color.Get(FSlateColor(FLinearColor::White)).GetSpecifiedColor() * InWidgetStyle.GetColorAndOpacityTint();
	auto P = [&](double X, double Y) { return Origin + FVector2D(X * S, Y * S); };
	auto Stroke = [&](const TArray<FVector2D>& Points, float Width)
	{
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId, AllottedGeometry.ToPaintGeometry(), Points,
			ESlateDrawEffect::None, Tint, true, Width);
	};
	auto Arc = [&](double CX, double CY, double R, double FromDeg, double ToDeg, int32 Steps, float Width)
	{
		TArray<FVector2D> Points;
		for (int32 i = 0; i <= Steps; ++i)
		{
			const double A = FMath::DegreesToRadians(FMath::Lerp(FromDeg, ToDeg, static_cast<double>(i) / Steps));
			Points.Add(P(CX + FMath::Cos(A) * R, CY + FMath::Sin(A) * R));
		}
		Stroke(Points, Width);
	};
	const float W = Thickness;

	switch (Glyph)
	{
	case EWonderWebGlyph::WonderMark:
	{
		// THE WONDER FACE, measured off the founder's reference: a ring; two three-quarter arcs set back to back -- the left
		// opening to the left, the right opening to the right -- joined by a short bar between their backs; a wave beneath.
		const float Stroke7 = static_cast<float>(S * 5.2 / 120.0);
		Arc(0.5, 0.5, 52.0 / 120.0, 0.0, 360.0, 72, Stroke7);
		Arc(45.8 / 120.0, 48.2 / 120.0, 10.4 / 120.0, -138.0, 138.0, 28, Stroke7);
		Arc(74.2 / 120.0, 48.2 / 120.0, 10.4 / 120.0, 42.0, 318.0, 28, Stroke7);
		Stroke({ P(56.2 / 120.0, 48.2 / 120.0), P(63.8 / 120.0, 48.2 / 120.0) }, Stroke7);
		TArray<FVector2D> Wave;
		for (int32 i = 0; i <= 64; ++i)
		{
			const double X = 27.0 + 66.0 * i / 64.0;
			Wave.Add(P(X / 120.0, (82.7 - 2.9 * FMath::Sin(2.0 * PI * (X - 27.0) / 16.5)) / 120.0));
		}
		Stroke(Wave, Stroke7);
		break;
	}
	case EWonderWebGlyph::Back:
	case EWonderWebGlyph::Forward:
	{
		const bool bBack = Glyph == EWonderWebGlyph::Back;
		const double Tip = bBack ? 0.17 : 0.83;
		const double Tail = bBack ? 0.83 : 0.17;
		const double Wing = bBack ? 0.44 : 0.56;
		Stroke({ P(Tail, 0.5), P(Tip, 0.5) }, W);
		Stroke({ P(Wing, 0.22), P(Tip, 0.5), P(Wing, 0.78) }, W);
		break;
	}
	case EWonderWebGlyph::Reload:
		Arc(0.5, 0.52, 0.32, -40.0, 250.0, 28, W);
		Stroke({ P(0.60, 0.12), P(0.77, 0.30), P(0.53, 0.36) }, W);
		break;
	case EWonderWebGlyph::Lock:
		Stroke({ P(0.20, 0.44), P(0.80, 0.44), P(0.80, 0.90), P(0.20, 0.90), P(0.20, 0.44) }, W);
		Arc(0.5, 0.44, 0.19, 180.0, 360.0, 14, W);
		break;
	case EWonderWebGlyph::Star:
	{
		TArray<FVector2D> Points;
		for (int32 i = 0; i <= 10; ++i)
		{
			const double A = FMath::DegreesToRadians(-90.0 + 36.0 * i);
			const double R = (i % 2 == 0) ? 0.42 : 0.18;
			Points.Add(P(0.5 + FMath::Cos(A) * R, 0.53 + FMath::Sin(A) * R));
		}
		Stroke(Points, W);
		break;
	}
	case EWonderWebGlyph::Dots:
		for (const double Y : { 0.2, 0.5, 0.8 })
		{
			Arc(0.5, Y, 0.06, 0.0, 360.0, 10, W * 1.6f);
		}
		break;
	case EWonderWebGlyph::Minimize:
		Stroke({ P(0.18, 0.5), P(0.82, 0.5) }, W);
		break;
	case EWonderWebGlyph::Maximize:
		Stroke({ P(0.2, 0.2), P(0.8, 0.2), P(0.8, 0.8), P(0.2, 0.8), P(0.2, 0.2) }, W);
		break;
	case EWonderWebGlyph::Close:
		Stroke({ P(0.2, 0.2), P(0.8, 0.8) }, W);
		Stroke({ P(0.8, 0.2), P(0.2, 0.8) }, W);
		break;
	case EWonderWebGlyph::Play:
		Stroke({ P(0.26, 0.16), P(0.82, 0.5), P(0.26, 0.84), P(0.26, 0.16) }, W);
		break;
	case EWonderWebGlyph::Check:
		Stroke({ P(0.16, 0.54), P(0.40, 0.78), P(0.86, 0.24) }, W);
		break;
	case EWonderWebGlyph::Trash:
		Stroke({ P(0.14, 0.26), P(0.86, 0.26) }, W);
		Stroke({ P(0.24, 0.26), P(0.30, 0.88), P(0.70, 0.88), P(0.76, 0.26) }, W);
		Stroke({ P(0.38, 0.26), P(0.38, 0.12), P(0.62, 0.12), P(0.62, 0.26) }, W);
		break;
	case EWonderWebGlyph::Plus:
		Stroke({ P(0.5, 0.18), P(0.5, 0.82) }, W);
		Stroke({ P(0.18, 0.5), P(0.82, 0.5) }, W);
		break;
	case EWonderWebGlyph::Prompt:
		Stroke({ P(0.10, 0.24), P(0.40, 0.50), P(0.10, 0.76) }, W);
		Stroke({ P(0.50, 0.80), P(0.92, 0.80) }, W);
		break;
	}
	return LayerId + 1;
}

/* ==================================================================== the window */

void SWonderlandWonderWebPanel::Construct(const FArguments& InArgs)
{
	using namespace WonderWebLook;
	WonderWeb = InArgs._WonderWeb;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestProject = InArgs._OnRequestProject;
	OnRequestMinimize = InArgs._OnRequestMinimize;
	OnRequestExpand = InArgs._OnRequestExpand;
	OnRequestConnections = InArgs._OnRequestConnections;

	WindowBrush = FSlateRoundedBoxBrush(Ink(), 22.0f, Line(), 3.0f);
	LineBrush.DrawAs = ESlateBrushDrawType::Image;
	LineBrush.TintColor = FSlateColor(Line());
	AddressBrush = FSlateRoundedBoxBrush(Ink(), 9.0f, Line(0.85f), 2.0f);
	TabBrush = FSlateRoundedBoxBrush(Ink(), 10.0f, Line(0.45f), 2.0f);
	TabHoverBrush = FSlateRoundedBoxBrush(Ink(), 10.0f, Line(0.85f), 2.0f);
	TabActiveBrush = FSlateRoundedBoxBrush(Line(0.10f), 10.0f, Line(), 2.5f);
	PreviewBrush = FSlateRoundedBoxBrush(Line(0.08f), 6.0f, Line(0.30f), 1.0f);
	ActionBrush = FSlateRoundedBoxBrush(Ink(), 10.0f, Line(0.9f), 2.0f);
	ActionHoverBrush = FSlateRoundedBoxBrush(Line(0.18f), 10.0f, Line(), 2.0f);
	// A PAGE A SHADE DOWN FROM WHITE, AND CELLS WITH A REAL EDGE: at the screen's daylight brightness every near-white
	// value lands on the same white, and editor 77 showed the unpainted grid gone into the page.
	PageBrush = FSlateRoundedBoxBrush(WonderlandUi::Srgb(0xB9, 0xB5, 0xAB), 12.0f, Line(0.0f), 0.0f);
	CellBrush = FSlateRoundedBoxBrush(WonderWebCanvasLook::PaintColour(0), 3.0f, WonderlandUi::Srgb(0xD8, 0xD3, 0xC4), 1.0f);
	ClearBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
	DotBrush = FSlateRoundedBoxBrush(FLinearColor::White, 7.0f, FLinearColor::White, 0.0f);

	TabStyle = FButtonStyle().SetNormal(TabBrush).SetHovered(TabHoverBrush).SetPressed(TabActiveBrush).SetDisabled(TabBrush)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));
	TabActiveStyle = FButtonStyle().SetNormal(TabActiveBrush).SetHovered(TabActiveBrush).SetPressed(TabActiveBrush).SetDisabled(TabActiveBrush)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));
	IconStyle = FButtonStyle().SetNormal(ClearBrush).SetHovered(FSlateRoundedBoxBrush(Line(0.14f), 8.0f, Line(0.0f), 0.0f))
		.SetPressed(FSlateRoundedBoxBrush(Line(0.26f), 8.0f, Line(0.0f), 0.0f)).SetDisabled(ClearBrush)
		.SetNormalPadding(FMargin(8.0f)).SetPressedPadding(FMargin(8.0f));
	ActionStyle = FButtonStyle().SetNormal(ActionBrush).SetHovered(ActionHoverBrush).SetPressed(ActionHoverBrush).SetDisabled(ActionBrush)
		.SetNormalPadding(FMargin(22.0f, 12.0f)).SetPressedPadding(FMargin(22.0f, 13.0f, 22.0f, 11.0f));
	CellStyle = FButtonStyle().SetNormal(ClearBrush).SetHovered(ClearBrush).SetPressed(ClearBrush).SetDisabled(ClearBrush)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));
	for (int32 i = 0; i <= UWonderlandWonderWebSubsystem::PaletteSize; ++i)
	{
		PaintBrushes.Add(FSlateRoundedBoxBrush(i == 0 ? WonderlandUi::Srgb(0xE4, 0xE0, 0xD6) : WonderWebCanvasLook::PaintColour(i), 3.0f,
			i == 0 ? WonderlandUi::Srgb(0x6E, 0x6A, 0x60) : WonderWebCanvasLook::PaintColour(i) * 0.6f, 1.5f));
	}
	for (int32 i = 0; i <= UWonderlandWonderWebSubsystem::PaletteSize; ++i)
	{
		PaintStyles.Add(FButtonStyle().SetNormal(PaintBrushes[i]).SetHovered(PaintBrushes[i]).SetPressed(PaintBrushes[i]).SetDisabled(PaintBrushes[i])
			.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f)));
	}

	FSlateBrush NoBackground;
	NoBackground.DrawAs = ESlateBrushDrawType::NoDrawType;
	InputStyle = FCoreStyle::Get().GetWidgetStyle<FEditableTextStyle>("NormalEditableText");
	InputStyle.SetFont(Mono(17)).SetColorAndOpacity(FSlateColor(Line()));

	const TWeakObjectPtr<UWonderlandWonderWebSubsystem> Weak = WonderWeb;
	const auto Surface = [Weak]() -> const FWonderWebSurface*
	{
		return Weak.IsValid() ? &Weak->GetSurface() : nullptr;
	};

	ChildSlot
	[
		SNew(SBox).WidthOverride(DesignSize().X).HeightOverride(DesignSize().Y)
		[
			SNew(SBorder).BorderImage(&WindowBrush).Padding(FMargin(3.0f))
			[
				SNew(SVerticalBox)
				// ---------------------------------------------------------------- the title bar
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(96.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(28.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::WonderMark).Size(54.0f).Color(FSlateColor(Line()))
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 36.0f, 0.0f)
						[
							SNew(STextBlock).Text(INVTEXT("WONDER WEB")).Font(Sans(26, true, 160)).ColorAndOpacity(Line())
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Bottom)
						[
							SAssignNew(TabsSlot, SBox)
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(12.0f, 0.0f, 22.0f, 0.0f)
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().AutoWidth()
							[
								// Minimize folds the window to a chip along the bottom of the workspace; its work goes on.
								ChromeButton(TEXT("minimize"), EWonderWebGlyph::Minimize, 30.0f, [this]() { return OnRequestMinimize.IsBound(); }, [this]() { OnRequestMinimize.ExecuteIfBound(); })
							]
							+ SHorizontalBox::Slot().AutoWidth().Padding(10.0f, 0.0f)
							[
								// Maximize grows the window larger in the middle of the workspace, and back again.
								ChromeButton(TEXT("maximize"), EWonderWebGlyph::Maximize, 30.0f, [this]() { return OnRequestExpand.IsBound(); }, [this]() { OnRequestExpand.ExecuteIfBound(); })
							]
							+ SHorizontalBox::Slot().AutoWidth()
							[
								ChromeButton(TEXT("close"), EWonderWebGlyph::Close, 30.0f, []() { return true; }, [this]() { OnRequestClose.ExecuteIfBound(); })
							]
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				// ---------------------------------------------------------------- the toolbar
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(86.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(22.0f, 0.0f, 6.0f, 0.0f)
						[
							ChromeButton(TEXT("back"), EWonderWebGlyph::Back, 32.0f,
								[Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Chrome.bCanGoBack; },
								[Weak]() { if (Weak.IsValid()) { Weak->Act(EWonderWebAction::Back); } })
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(6.0f, 0.0f)
						[
							ChromeButton(TEXT("forward"), EWonderWebGlyph::Forward, 32.0f,
								[Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Chrome.bCanGoForward; },
								[Weak]() { if (Weak.IsValid()) { Weak->Act(EWonderWebAction::Forward); } })
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(6.0f, 0.0f, 18.0f, 0.0f)
						[
							ChromeButton(TEXT("reload"), EWonderWebGlyph::Reload, 32.0f,
								[Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Chrome.bCanReload; },
								[Weak]() { if (Weak.IsValid()) { Weak->Act(EWonderWebAction::Reload); } })
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(SBox).HeightOverride(56.0f)
							[
								SNew(SBorder).BorderImage(&AddressBrush).Padding(FMargin(22.0f, 0.0f)).VAlign(VAlign_Center)
								[
									SNew(SHorizontalBox)
									+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 16.0f, 0.0f)
									[
										// THE LOCK IS A FACT about how the bytes reached the frame, not decoration.
										SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Lock).Size(24.0f).Color(FSlateColor(Line())).Thickness(2.2f)
										.Visibility_Lambda([Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Address.bSecure ? EVisibility::Visible : EVisibility::Collapsed; })
									]
									+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
									[
										SNew(STextBlock).Font(Sans(19)).ColorAndOpacity(Line())
										.Text_Lambda([Surface]() { const FWonderWebSurface* S = Surface(); return FText::FromString(S != nullptr ? S->Address.Display : FString()); })
									]
								]
							]
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(18.0f, 0.0f, 6.0f, 0.0f)
						[
							// RETURN TO PROJECT: back to the world, to the project this creation belongs to.
							ChromeButton(TEXT("project"), EWonderWebGlyph::Star, 32.0f,
								[Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Chrome.bCanReturnToProject; },
								[this]() { OnRequestProject.ExecuteIfBound(); })
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(6.0f, 0.0f, 22.0f, 0.0f)
						[
							// THE MENU OPENS JULIUS CONNECT beside this window: a second window, opened in context.
							ChromeButton(TEXT("menu"), EWonderWebGlyph::Dots, 32.0f, [this]() { return OnRequestConnections.IsBound(); }, [this]() { OnRequestConnections.ExecuteIfBound(); })
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				// ---------------------------------------------------------------- what this is, said plainly
				+ SVerticalBox::Slot().AutoHeight().Padding(18.0f, 10.0f, 18.0f, 0.0f)
				[
					SNew(SBorder).BorderImage(&PreviewBrush).Padding(FMargin(14.0f, 6.0f))
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(STextBlock).Font(Sans(12, true, 140)).ColorAndOpacity(Line(0.85f))
							.Text(INVTEXT("DEVELOPMENT PREVIEW  ·  SAMPLE DATA  ·  SIMULATED CREATION  ·  NO RUNTIME OR BRIDGE CONNECTED"))
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock).Font(Sans(12, true, 140)).ColorAndOpacity(Line(0.85f))
							.Text_Lambda([Weak, Surface]()
							{
								const FWonderWebSurface* S = Surface();
								if (S == nullptr || !Weak.IsValid() || !S->Tabs.IsValidIndex(Weak->GetSelectedTab()))
								{
									return FText::GetEmpty();
								}
								const FWonderWebTab& Tab = S->Tabs[Weak->GetSelectedTab()];
								return FText::FromString(Tab.bIsSelf ? TEXT("PEER TABS ARE SAMPLE PEOPLE  ·  OBSERVE ONLY")
									: FString::Printf(TEXT("OBSERVING %s  ·  SAMPLE PEER  ·  NO CONTROL"), *Tab.Label));
							})
						]
					]
				]
				// ---------------------------------------------------------------- the viewport
				+ SVerticalBox::Slot().FillHeight(1.0f).Padding(18.0f, 12.0f)
				[
					SAssignNew(ViewportSlot, SBox)
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				// ---------------------------------------------------------------- the terminal strip
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(250.0f)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(SBox).HeightOverride(66.0f)
							[
								SNew(SHorizontalBox)
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(28.0f, 0.0f, 14.0f, 0.0f)
								[
									SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Prompt).Size(28.0f).Color(FSlateColor(Line())).Thickness(2.6f)
								]
								+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
								[
									SNew(STextBlock).Text(INVTEXT("TERMINAL")).Font(Sans(20, true, 150)).ColorAndOpacity(Line())
								]
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 18.0f, 0.0f)
								[
									Probe(TEXT("clear"),
										SNew(SButton).ButtonStyle(&IconStyle)
										.OnClicked_Lambda([Weak]() { if (Weak.IsValid()) { Weak->ClearTerminal(); } return FReply::Handled(); })
										[
											SNew(STextBlock).Text(INVTEXT("CLEAR")).Font(Sans(15, true, 120)).ColorAndOpacity(Line())
										])
								]
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
								[
									SNew(SBox).WidthOverride(2.0f).HeightOverride(34.0f)[SNew(SImage).Image(&LineBrush).ColorAndOpacity(Line(0.5f))]
								]
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
								[
									ChromeButton(TEXT("restart"), EWonderWebGlyph::Play, 28.0f,
										[Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Chrome.bCanRestart; },
										[Weak]() { if (Weak.IsValid()) { Weak->Act(EWonderWebAction::Restart); } })
								]
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(12.0f, 0.0f)
								[
									ChromeButton(TEXT("rebuild"), EWonderWebGlyph::Check, 28.0f,
										[Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Chrome.bCanRebuild; },
										[Weak]() { if (Weak.IsValid()) { Weak->Act(EWonderWebAction::Rebuild); } })
								]
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 24.0f, 0.0f)
								[
									ChromeButton(TEXT("stop"), EWonderWebGlyph::Trash, 28.0f,
										[Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Chrome.bCanStop; },
										[Weak]() { if (Weak.IsValid()) { Weak->Act(EWonderWebAction::Stop); } })
								]
							]
						]
						+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(1.0f)[SNew(SImage).Image(&LineBrush).ColorAndOpacity(Line(0.25f))]]
						+ SVerticalBox::Slot().FillHeight(1.0f).Padding(28.0f, 10.0f, 28.0f, 0.0f)
						[
							SAssignNew(TerminalScroll, SScrollBox)
							.ScrollBarVisibility(EVisibility::Collapsed)
							+ SScrollBox::Slot()
							[
								SAssignNew(TerminalLinesSlot, SBox)
							]
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(28.0f, 4.0f, 28.0f, 16.0f)
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
							[
								SNew(STextBlock).Font(Mono(17)).ColorAndOpacity(Line())
								.Text_Lambda([Surface]() { const FWonderWebSurface* S = Surface(); return FText::FromString(S != nullptr ? S->Terminal.Prompt : FString()); })
							]
							+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
							[
								Probe(TEXT("terminal"),
									SNew(SOverlay)
									+ SOverlay::Slot()
									[
										SAssignNew(TerminalInput, SEditableText)
										.Style(&InputStyle)
										.HintText(INVTEXT("type help"))
										.ClearKeyboardFocusOnCommit(false)
										.Visibility_Lambda([Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && S->Terminal.bAcceptsInput ? EVisibility::Visible : EVisibility::Collapsed; })
										.OnTextCommitted_Lambda([this, Weak](const FText& Text, ETextCommit::Type How)
										{
											if (How == ETextCommit::OnEnter && Weak.IsValid())
											{
												Weak->SubmitTerminal(Text.ToString());
												if (TerminalInput.IsValid())
												{
													TerminalInput->SetText(FText::GetEmpty());
												}
											}
										})
									]
									+ SOverlay::Slot()
									[
										// An observer is shown the prompt and no place to type: there is no input into somebody else's machine.
										SNew(STextBlock).Font(Mono(16)).ColorAndOpacity(Line(0.55f))
										.Text(INVTEXT("observing: this view takes no input"))
										.Visibility_Lambda([Surface]() { const FWonderWebSurface* S = Surface(); return S != nullptr && !S->Terminal.bAcceptsInput ? EVisibility::Visible : EVisibility::Collapsed; })
									])
							]
						]
					]
				]
			]
		]
	];
	Rebuild();
}

TSharedRef<SWidget> SWonderlandWonderWebPanel::Probe(FName Id, TSharedRef<SWidget> Content)
{
	const TWeakPtr<SWonderlandWonderWebPanel> WeakSelf = StaticCastSharedRef<SWonderlandWonderWebPanel>(AsShared());
	return SNew(SWonderWebProbe, [WeakSelf, Id](const FVector2D& Centre)
	{
		if (const TSharedPtr<SWonderlandWonderWebPanel> Self = WeakSelf.Pin())
		{
			// In the window's own design pixels, however large the window is drawn and wherever it stands.
			Self->ControlCentres.Add(Id, Self->GetTickSpaceGeometry().AbsoluteToLocal(Centre));
			Self->ControlSeenAt.Add(Id, Self->Now);
		}
	})
	[
		Content
	];
}

TSharedRef<SWidget> SWonderlandWonderWebPanel::ChromeButton(FName Id, EWonderWebGlyph Glyph, float GlyphSize, TFunction<bool()> IsEnabled, TFunction<void()> OnClick)
{
	using namespace WonderWebLook;
	return Probe(Id,
		SNew(SButton)
		.ButtonStyle(&IconStyle)
		.IsEnabled_Lambda([IsEnabled]() { return IsEnabled(); })
		.OnClicked_Lambda([OnClick]() { OnClick(); return FReply::Handled(); })
		[
			SNew(SWonderWebGlyph).Glyph(Glyph).Size(GlyphSize).Thickness(2.6f)
			// A control the projection has not enabled is drawn faint, so it reads as unavailable before it is clicked.
			.Color_Lambda([IsEnabled]() { return FSlateColor(IsEnabled() ? Line() : Line(0.28f)); })
		]);
}

bool SWonderlandWonderWebPanel::GetControlCentre(FName Control, FVector2D& OutCentre) const
{
	const FVector2D* Centre = ControlCentres.Find(Control);
	const double* SeenAt = ControlSeenAt.Find(Control);
	// Only a control drawn in the last half second is on screen; a collapsed one keeps its stale entry.
	if (Centre == nullptr || SeenAt == nullptr || Now - *SeenAt > 0.5)
	{
		return false;
	}
	OutCentre = *Centre;
	return true;
}

FString SWonderlandWonderWebPanel::GetTerminalInput() const
{
	return TerminalInput.IsValid() ? TerminalInput->GetText().ToString() : FString();
}

void SWonderlandWonderWebPanel::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	Now = InCurrentTime;
	if (WonderWeb.IsValid() && WonderWeb->GetRevision() != ShownRevision)
	{
		Rebuild();
	}
	// THE NEWEST LINE IN VIEW: scrolled again once the lines just added have been laid out.
	if (ScrollTerminalIn > 0 && --ScrollTerminalIn == 0 && TerminalScroll.IsValid())
	{
		TerminalScroll->ScrollToEnd();
	}
}

FString SWonderlandWonderWebPanel::OwnerLabel(const FWonderWebSurface& Surface, const FString& UserId) const
{
	for (const FWonderWebTab& Tab : Surface.Tabs)
	{
		if (Tab.UserId == UserId)
		{
			return Tab.Label;
		}
	}
	return UserId;
}

void SWonderlandWonderWebPanel::Rebuild()
{
	if (!WonderWeb.IsValid())
	{
		return;
	}
	ShownRevision = WonderWeb->GetRevision();
	const FWonderWebSurface& Surface = WonderWeb->GetSurface();
	// Only the parts a revision can move are rebuilt, and the viewport only when what it shows changed kind or
	// frame -- rebuilding the canvas under a click would drop the click.
	if (TabsSlot.IsValid())
	{
		TabsSlot->SetContent(MakeTabs(Surface));
	}
	const FString SurfaceKey = FString::Printf(TEXT("%d|%s|%d|%s|%s|%d"), WonderWeb->GetSelectedTab(), *WonderWeb->GetFrameName().ToString(),
		static_cast<int32>(Surface.Viewport.Kind), *Surface.Viewport.Status, *Surface.UnavailableReason, Surface.Viewport.bRunning ? 1 : 0);
	if (ViewportSlot.IsValid() && SurfaceKey != ShownSurfaceKey)
	{
		ShownSurfaceKey = SurfaceKey;
		ViewportSlot->SetContent(MakeViewport(Surface));
	}
	if (TerminalLinesSlot.IsValid())
	{
		TerminalLinesSlot->SetContent(MakeTerminalLines(Surface));
		if (TerminalScroll.IsValid())
		{
			TerminalScroll->ScrollToEnd();
			ScrollTerminalIn = 2;
		}
	}
}

TSharedRef<SWidget> SWonderlandWonderWebPanel::MakeTabs(const FWonderWebSurface& Surface)
{
	using namespace WonderWebLook;
	const TWeakObjectPtr<UWonderlandWonderWebSubsystem> Weak = WonderWeb;
	const int32 Selected = WonderWeb.IsValid() ? WonderWeb->GetSelectedTab() : 0;
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	for (int32 Index = 0; Index < Surface.Tabs.Num(); ++Index)
	{
		const FWonderWebTab& Tab = Surface.Tabs[Index];
		const bool bSelected = Index == Selected;
		// An observation reads a shade quieter than the viewer's own tab.
		const FLinearColor Text = Tab.Access == EWonderWebAccess::Observe ? Line(0.82f) : Line();
		const bool bReconnecting = Tab.ConnectionState == TEXT("RECONNECTING");
		Row->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f).VAlign(VAlign_Bottom)
		[
			Probe(FName(*FString::Printf(TEXT("tab:%d"), Index)),
				SNew(SBox).WidthOverride(Tab.bIsSelf ? 176.0f : 148.0f).HeightOverride(62.0f)
				[
					SNew(SButton)
					.ButtonStyle(bSelected ? &TabActiveStyle : &TabStyle)
					.HAlign(HAlign_Center).VAlign(VAlign_Center)
					.OnClicked_Lambda([Weak, Index]() { if (Weak.IsValid()) { Weak->SelectTab(Index); } return FReply::Handled(); })
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(STextBlock).Text(FText::FromString(Tab.Label)).Font(Sans(17, true, 120)).ColorAndOpacity(Text)
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(SBox).WidthOverride(16.0f).HeightOverride(16.0f)
							[
								// A presence dot. Not a rounded box at exactly half its height: that renders as a white square.
								SNew(SImage)
								.Image(&DotBrush)
								.ColorAndOpacity(WonderWebCanvasLook::Dot(Tab.DotColorToken).CopyWithNewOpacity(bReconnecting ? 0.45f : 1.0f))
							]
						]
					]
				])
		];
	}
	// The reference's "+": there is no second view of one's own yet, so it is shown and disabled.
	Row->AddSlot().AutoWidth().VAlign(VAlign_Bottom)
	[
		SNew(SBox).WidthOverride(64.0f).HeightOverride(62.0f)
		[
			SNew(SButton).ButtonStyle(&TabStyle).IsEnabled(false).HAlign(HAlign_Center).VAlign(VAlign_Center)
			[
				SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Plus).Size(26.0f).Color(FSlateColor(Line(0.5f))).Thickness(2.4f)
			]
		]
	];
	return Row;
}

TSharedRef<SWidget> SWonderlandWonderWebPanel::MakeViewport(const FWonderWebSurface& Surface)
{
	using namespace WonderWebLook;
	const TWeakObjectPtr<UWonderlandWonderWebSubsystem> Weak = WonderWeb;
	const FWonderWebViewport& View = Surface.Viewport;

	if (!Surface.UnavailableReason.IsEmpty())
	{
		return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(STextBlock).Text(INVTEXT("WONDER WEB IS UNAVAILABLE")).Font(Sans(30, true, 120)).ColorAndOpacity(Fail())
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 14.0f, 0.0f, 0.0f)
			[
				SNew(SBox).MaxDesiredWidth(1000.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Surface.UnavailableReason)).Font(Sans(18)).ColorAndOpacity(Line(0.85f)).AutoWrapText(true).Justification(ETextJustify::Center)
				]
			]
		];
	}

	switch (View.Kind)
	{
	case EWonderWebViewportKind::Idle:
		// THE RESTING STATE: the Wonder face on black, and -- because this is the project's own view -- the one creation
		// the project has, offered to open.
		return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::WonderMark).Size(236.0f).Color(FSlateColor(Line()))
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 30.0f, 0.0f, 0.0f)
			[
				Probe(TEXT("open-sample"),
					SNew(SButton).ButtonStyle(&ActionStyle)
					.Visibility(Surface.Terminal.bAcceptsInput ? EVisibility::Visible : EVisibility::Collapsed)
					.OnClicked_Lambda([Weak]() { if (Weak.IsValid()) { Weak->Act(EWonderWebAction::OpenSample); } return FReply::Handled(); })
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Play).Size(22.0f).Color(FSlateColor(Line())).Thickness(2.4f)
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(INVTEXT("OPEN SAMPLE CREATION  ·  PIXEL CANVAS")).Font(Sans(17, true, 130)).ColorAndOpacity(Line())
						]
					])
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 12.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(INVTEXT("a simulated web app in this project  ·  or type  open  in the terminal")).Font(Sans(14)).ColorAndOpacity(Line(0.6f))
				.Visibility(Surface.Terminal.bAcceptsInput ? EVisibility::Visible : EVisibility::Collapsed)
			]
		];

	case EWonderWebViewportKind::Working:
	{
		const FString LastLine = Surface.Terminal.Lines.Num() > 0 ? Surface.Terminal.Lines.Last().Text : FString();
		return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::WonderMark).Size(120.0f)
				.Color_Lambda([]() { return FSlateColor(Line(0.45f + 0.35f * FMath::Abs(FMath::Sin(FSlateApplication::Get().GetCurrentTime() * 2.4)))); })
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 26.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(View.Status)).Font(Sans(40, true, 200)).ColorAndOpacity(Line())
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 10.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(View.Message)).Font(Sans(20)).ColorAndOpacity(Line(0.85f))
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 18.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(LastLine)).Font(Mono(16)).ColorAndOpacity(Line(0.6f))
			]
		];
	}

	case EWonderWebViewportKind::Creation:
		return MakeCanvas(Surface);

	case EWonderWebViewportKind::Failed:
		return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(STextBlock).Text(INVTEXT("BUILD FAILED")).Font(Sans(44, true, 200)).ColorAndOpacity(Fail())
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 16.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(View.Summary)).Font(Sans(22)).ColorAndOpacity(Line())
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 8.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("Phase: %s   ·   %s"), *View.Phase, *View.CreationId))).Font(Mono(16)).ColorAndOpacity(Line(0.7f))
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 26.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(INVTEXT("type  rebuild  or press the check mark on the terminal bar to build it again")).Font(Sans(15)).ColorAndOpacity(Line(0.6f))
			]
		];

	case EWonderWebViewportKind::Observed:
	{
		const FString Owner = OwnerLabel(Surface, View.OwnerUserId);
		return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::WonderMark).Size(110.0f).Color(FSlateColor(Line(0.35f)))
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 22.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("%s'S CREATION"), *Owner))).Font(Sans(36, true, 180)).ColorAndOpacity(Line())
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 10.0f, 0.0f, 0.0f)
			[
				SNew(SBorder).BorderImage(&PreviewBrush).Padding(FMargin(16.0f, 6.0f))
				[
					SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("%s  ·  OBSERVE ONLY  ·  SAMPLE PEER"), *View.Status))).Font(Sans(15, true, 160)).ColorAndOpacity(Line())
				]
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 18.0f, 0.0f, 0.0f)
			[
				SNew(SBox).MaxDesiredWidth(960.0f)
				[
					SNew(STextBlock).AutoWrapText(true).Justification(ETextJustify::Center).Font(Sans(19)).ColorAndOpacity(Line(0.8f))
					.Text(FText::FromString(FString::Printf(TEXT("You can see that this creation exists and that it is %s. Opening, running and reading it belong to its owner."), *View.Status)))
				]
			]
		];
	}
	}
	return SNew(SBox);
}

TSharedRef<SWidget> SWonderlandWonderWebPanel::MakeCanvas(const FWonderWebSurface& Surface)
{
	using namespace WonderWebLook;
	const TWeakObjectPtr<UWonderlandWonderWebSubsystem> Weak = WonderWeb;
	const bool bRunning = Surface.Viewport.bRunning;

	TSharedRef<SUniformGridPanel> Grid = SNew(SUniformGridPanel).SlotPadding(FMargin(2.0f));
	for (int32 Row = 0; Row < UWonderlandWonderWebSubsystem::CanvasRows; ++Row)
	{
		for (int32 Column = 0; Column < UWonderlandWonderWebSubsystem::CanvasColumns; ++Column)
		{
			const int32 Index = Row * UWonderlandWonderWebSubsystem::CanvasColumns + Column;
			Grid->AddSlot(Column, Row)
			[
				Probe(FName(*FString::Printf(TEXT("cell:%d"), Index)),
					SNew(SBox).WidthOverride(46.0f).HeightOverride(34.0f)
					[
						SNew(SButton).ButtonStyle(&CellStyle)
						.OnClicked_Lambda([Weak, Index]() { if (Weak.IsValid()) { Weak->PaintCell(Index); } return FReply::Handled(); })
						[
							SNew(SBorder)
							.BorderImage_Lambda([this, Weak, Index]() { return &PaintBrushes[Weak.IsValid() ? FMath::Clamp<int32>(Weak->GetCell(Index), 0, PaintBrushes.Num() - 1) : 0]; })
						]
					])
			];
		}
	}

	TSharedRef<SHorizontalBox> Palette = SNew(SHorizontalBox);
	for (int32 Colour = 1; Colour <= UWonderlandWonderWebSubsystem::PaletteSize; ++Colour)
	{
		Palette->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 12.0f, 0.0f)
		[
			Probe(FName(*FString::Printf(TEXT("paint:%d"), Colour)),
				SNew(SBox).WidthOverride(44.0f).HeightOverride(44.0f)
				[
					SNew(SButton).ButtonStyle(&PaintStyles[Colour])
					.OnClicked_Lambda([Weak, Colour]() { if (Weak.IsValid()) { Weak->SelectPaint(Colour); } return FReply::Handled(); })
					[
						SNew(SBorder).BorderImage(&ClearBrush).HAlign(HAlign_Center).VAlign(VAlign_Center)
						[
							SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Check).Size(22.0f).Thickness(3.0f)
							.Color(FSlateColor(Colour == 5 ? FLinearColor::White : Ink()))
							.Visibility_Lambda([Weak, Colour]() { return Weak.IsValid() && Weak->GetSelectedPaint() == Colour ? EVisibility::HitTestInvisible : EVisibility::Hidden; })
						]
					]
				])
		];
	}

	const FLinearColor PageInk = WonderlandUi::Srgb(0x22, 0x22, 0x2C);
	return SNew(SOverlay)
		+ SOverlay::Slot()
		[
			// THE CREATION'S OWN PAGE: light, like a web page inside the browser -- it is not Wonder Web's chrome.
			SNew(SBorder).BorderImage(&PageBrush).Padding(FMargin(34.0f, 22.0f))
			.ColorAndOpacity(bRunning ? FLinearColor::White : FLinearColor(1.0f, 1.0f, 1.0f, 0.45f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock).Text(INVTEXT("Pixel Canvas")).Font(Sans(30, true)).ColorAndOpacity(PageInk)
						]
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock).Font(Sans(14)).ColorAndOpacity(PageInk.CopyWithNewOpacity(0.6f))
							.Text(FText::FromString(FString::Printf(TEXT("%s  ·  pick a colour, click the grid"), *Surface.Viewport.Entrypoint)))
						]
					]
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
					[
						Palette
					]
				]
				+ SVerticalBox::Slot().FillHeight(1.0f).HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(0.0f, 12.0f)
				[
					Grid
				]
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Font(Sans(15, true)).ColorAndOpacity(PageInk)
						.Text_Lambda([Weak]() { return FText::FromString(FString::Printf(TEXT("%d cells painted"), Weak.IsValid() ? Weak->GetPaintedCells() : 0)); })
					]
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
					[
						Probe(TEXT("canvas-clear"),
							SNew(SButton).ButtonStyle(&CellStyle)
							.OnClicked_Lambda([Weak]() { if (Weak.IsValid()) { Weak->ClearCanvas(); } return FReply::Handled(); })
							[
								SNew(SBorder).BorderImage(&PaintBrushes[5]).Padding(FMargin(18.0f, 8.0f))
								[
									SNew(STextBlock).Text(INVTEXT("Clear canvas")).Font(Sans(14, true)).ColorAndOpacity(FLinearColor::White)
								]
							])
					]
				]
			]
		]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
		[
			SNew(SBorder).BorderImage(&ActionBrush).Padding(FMargin(26.0f, 14.0f))
			.Visibility(bRunning ? EVisibility::Collapsed : EVisibility::HitTestInvisible)
			[
				SNew(STextBlock).Text(INVTEXT("READY  ·  NOT RUNNING  ·  type  run  or press the play mark")).Font(Sans(20, true, 120)).ColorAndOpacity(Line())
			]
		]
		+ SOverlay::Slot().HAlign(HAlign_Right).VAlign(VAlign_Bottom).Padding(0.0f, 0.0f, 10.0f, -8.0f)
		[
			SNew(STextBlock).Font(Sans(11, true, 100)).ColorAndOpacity(PageInk.CopyWithNewOpacity(0.55f))
			.Text(INVTEXT("SIMULATED CREATION · drawn by the development preview, not served by the Wonder Web sandbox"))
		];
}

TSharedRef<SWidget> SWonderlandWonderWebPanel::MakeTerminalLines(const FWonderWebSurface& Surface)
{
	using namespace WonderWebLook;
	TSharedRef<SVerticalBox> Lines = SNew(SVerticalBox);
	if (!WonderWeb.IsValid())
	{
		return Lines;
	}
	const bool bMine = WonderWeb->GetSelectedTab() == 0;
	int32 Shown = 0;
	if (Surface.Terminal.TruncatedFrom >= 0)
	{
		Lines->AddSlot().AutoHeight()
		[
			SNew(STextBlock).Font(Mono(15)).ColorAndOpacity(Line(0.5f))
			.Text(FText::FromString(FString::Printf(TEXT("… earlier output dropped; showing the last %d of %d lines"), Surface.Terminal.Lines.Num(), Surface.Terminal.TruncatedFrom)))
		];
	}
	for (const FWonderWebTerminalLine& Line : Surface.Terminal.Lines)
	{
		if (bMine && Line.Sequence <= WonderWeb->GetClearedThroughSequence())
		{
			continue;
		}
		Lines->AddSlot().AutoHeight()
		[
			SNew(STextBlock).Font(Mono(16)).Text(FText::FromString(Line.Text))
			.ColorAndOpacity(Line.bRuntime ? WonderWebLook::Line() : WonderWebLook::Line(0.62f))
		];
		++Shown;
	}
	if (bMine)
	{
		const TArray<FWonderWebSessionLine>& Session = WonderWeb->GetSessionLines();
		for (int32 Index = WonderWeb->GetClearedSessionLines(); Index < Session.Num(); ++Index)
		{
			Lines->AddSlot().AutoHeight()
			[
				SNew(STextBlock).Font(Mono(16)).Text(FText::FromString(Session[Index].Text))
				.ColorAndOpacity(Session[Index].bTyped ? WonderlandUi::Cream() : WonderWebLook::Line(0.85f))
			];
			++Shown;
		}
	}
	if (Shown == 0 && !Surface.Terminal.bAcceptsInput)
	{
		Lines->AddSlot().AutoHeight()
		[
			SNew(STextBlock).Font(Mono(15)).ColorAndOpacity(Line(0.5f))
			.Text(INVTEXT("an observer does not see the owner's build or runtime output"))
		];
	}
	return Lines;
}

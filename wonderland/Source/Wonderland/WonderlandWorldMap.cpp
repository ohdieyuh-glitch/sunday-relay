#include "WonderlandWorldMap.h"

#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SConstraintCanvas.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

namespace
{
	FLinearColor KindColor(EWonderlandTravelKind Kind)
	{
		switch (Kind)
		{
		case EWonderlandTravelKind::Arrival:  return WonderlandUi::Ivory();
		case EWonderlandTravelKind::Quarter:  return WonderlandUi::Sage();
		case EWonderlandTravelKind::Landmark: return WonderlandUi::Srgb(0xE6, 0xB8, 0xD8);   // soft rose
		default:                              return WonderlandUi::Gold();
		}
	}

	void AddRing(TArray<FVector2f>& Points, const FVector2f& Centre, float Radius, int32 Segments = 40)
	{
		Points.Reset();
		for (int32 Index = 0; Index <= Segments; ++Index)
		{
			const float Angle = 2.0f * PI * Index / Segments;
			Points.Add(Centre + FVector2f(FMath::Cos(Angle), FMath::Sin(Angle)) * Radius);
		}
	}

	FVector2f MeasureText(const FString& Text, const FSlateFontInfo& Font)
	{
		const FVector2D Raw = FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(Text, Font);
		return FVector2f(static_cast<float>(Raw.X), static_cast<float>(Raw.Y));
	}
}

/* ---------------------------------------------------------------- canvas */

void SWonderlandMapCanvas::Construct(const FArguments& InArgs)
{
	OnPick = InArgs._OnPick;
	Circle.DrawAs = ESlateBrushDrawType::RoundedBox;
	Circle.TintColor = FSlateColor(FLinearColor::White);
	Circle.OutlineSettings.RoundingType = ESlateBrushRoundingType::HalfHeightRadius;
	Circle.OutlineSettings.Width = 0.0f;
}

void SWonderlandMapCanvas::SetStops(const TArray<FWonderlandMapStop>& InStops, const FVector2D& InPlayerXY, bool bInHasPlayer, int32 InCurrent)
{
	Stops = InStops;
	PlayerXY = InPlayerXY;
	bHasPlayer = bInHasPlayer;
	Current = InCurrent;
	Hovered = INDEX_NONE;
	RecomputeBounds();
	Invalidate(EInvalidateWidgetReason::Paint);
}

void SWonderlandMapCanvas::SetSelected(int32 Index)
{
	Selected = Index;
	Invalidate(EInvalidateWidgetReason::Paint);
}

void SWonderlandMapCanvas::RecomputeBounds()
{
	FBox2D Box(ForceInit);
	for (const FWonderlandMapStop& Stop : Stops)
	{
		Box += Stop.AnchorXY;
	}
	if (bHasPlayer)
	{
		Box += PlayerXY;
	}
	if (!Box.bIsValid)
	{
		Box = FBox2D(FVector2D(-2000.0, -2000.0), FVector2D(2000.0, 2000.0));
	}
	FVector2D Centre = Box.GetCenter();
	FVector2D Extent = Box.GetExtent();
	Extent.X = FMath::Max(Extent.X * 1.14, 2000.0);
	Extent.Y = FMath::Max(Extent.Y * 1.14, 2000.0);
	BoundsMin = Centre - Extent;
	BoundsMax = Centre + Extent;
}

FVector2f SWonderlandMapCanvas::ToLocal(const FVector2D& WorldXY, const FVector2f& Size) const
{
	// North-up as the arrival sees it: the castle (+Y) is up, and screen-right is -X,
	// which is what is on your right when you stand at the gate.
	const double Pad = 40.0;
	const double SpanX = FMath::Max(BoundsMax.X - BoundsMin.X, 1.0);
	const double SpanY = FMath::Max(BoundsMax.Y - BoundsMin.Y, 1.0);
	const double Scale = FMath::Min((Size.X - 2.0 * Pad) / SpanX, (Size.Y - 2.0 * Pad) / SpanY);
	const double OffX = (Size.X - SpanX * Scale) * 0.5;
	const double OffY = (Size.Y - SpanY * Scale) * 0.5;
	return FVector2f(static_cast<float>(OffX + (BoundsMax.X - WorldXY.X) * Scale),
		static_cast<float>(OffY + (BoundsMax.Y - WorldXY.Y) * Scale));
}

int32 SWonderlandMapCanvas::StopAt(const FGeometry& Geometry, const FVector2D& ScreenPosition) const
{
	const FVector2D LocalMouse = Geometry.AbsoluteToLocal(ScreenPosition);
	const FVector2f Size(static_cast<float>(Geometry.GetLocalSize().X), static_cast<float>(Geometry.GetLocalSize().Y));
	int32 Best = INDEX_NONE;
	double BestDistance = 20.0;
	for (int32 Index = 0; Index < Stops.Num(); ++Index)
	{
		const FVector2f P = ToLocal(Stops[Index].AnchorXY, Size);
		const double Distance = FVector2D::Distance(LocalMouse, FVector2D(P.X, P.Y));
		if (Distance < BestDistance)
		{
			BestDistance = Distance;
			Best = Index;
		}
	}
	return Best;
}

int32 SWonderlandMapCanvas::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const FVector2f Size(static_cast<float>(AllottedGeometry.GetLocalSize().X), static_cast<float>(AllottedGeometry.GetLocalSize().Y));
	const double Now = FSlateApplication::Get().GetCurrentTime();
	int32 Layer = LayerId;
	TArray<FVector2f> Points;

	auto Disc = [&](const FVector2f& Centre, float Diameter, const FLinearColor& Color, int32 AtLayer)
	{
		FSlateDrawElement::MakeBox(OutDrawElements, AtLayer,
			AllottedGeometry.ToPaintGeometry(FVector2f(Diameter, Diameter), FSlateLayoutTransform(Centre - FVector2f(Diameter, Diameter) * 0.5f)),
			&Circle, ESlateDrawEffect::None, Color);
	};
	auto Text = [&](const FString& String, const FVector2f& At, const FSlateFontInfo& Font, const FLinearColor& Color, int32 AtLayer)
	{
		const FVector2f Measured = MeasureText(String, Font);
		FSlateDrawElement::MakeText(OutDrawElements, AtLayer,
			AllottedGeometry.ToPaintGeometry(Measured, FSlateLayoutTransform(At)), String, Font, ESlateDrawEffect::None, Color);
	};

	// MakeBox does not apply a brush's own tint -- SImage and SBorder multiply it in before
	// they call it -- so a rounded brush's fill colour has to be passed as the tint here.
	// Without it the dark plan drew as a white sheet.
	FSlateDrawElement::MakeBox(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), &Backdrop,
		ESlateDrawEffect::None, Backdrop.TintColor.GetSpecifiedColor());
	++Layer;

	// A faint survey grid and gold corner flourishes: a plan, not a screenshot.
	for (int32 Index = 1; Index < 10; ++Index)
	{
		const float X = Size.X * Index / 10.0f;
		const float Y = Size.Y * Index / 10.0f;
		TArray<FVector2f> Vertical = { FVector2f(X, 16.0f), FVector2f(X, Size.Y - 16.0f) };
		TArray<FVector2f> Horizontal = { FVector2f(16.0f, Y), FVector2f(Size.X - 16.0f, Y) };
		FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), Vertical, ESlateDrawEffect::None, WonderlandUi::Gold(0.045f), true, 1.0f);
		FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), Horizontal, ESlateDrawEffect::None, WonderlandUi::Gold(0.045f), true, 1.0f);
	}
	auto Corner = [&](const FVector2f& P, const FVector2f& AlongX, const FVector2f& AlongY)
	{
		TArray<FVector2f> Flourish = { P + AlongY * 34.0f, P, P + AlongX * 34.0f };
		FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), Flourish, ESlateDrawEffect::None, WonderlandUi::Gold(0.65f), true, 1.5f);
	};
	Corner(FVector2f(14.0f, 14.0f), FVector2f(1.0f, 0.0f), FVector2f(0.0f, 1.0f));
	Corner(FVector2f(Size.X - 14.0f, 14.0f), FVector2f(-1.0f, 0.0f), FVector2f(0.0f, 1.0f));
	Corner(FVector2f(14.0f, Size.Y - 14.0f), FVector2f(1.0f, 0.0f), FVector2f(0.0f, -1.0f));
	Corner(FVector2f(Size.X - 14.0f, Size.Y - 14.0f), FVector2f(-1.0f, 0.0f), FVector2f(0.0f, -1.0f));
	Text(TEXT("N"), FVector2f(Size.X - 42.0f, 22.0f), WonderlandUi::Sans(11, true), WonderlandUi::Gold(0.9f), Layer);
	TArray<FVector2f> NorthTick = { FVector2f(Size.X - 37.5f, 42.0f), FVector2f(Size.X - 37.5f, 60.0f) };
	FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), NorthTick, ESlateDrawEffect::None, WonderlandUi::Gold(0.7f), true, 1.5f);
	++Layer;

	// Soft rings around the arrival: where every visit begins.
	for (const FWonderlandMapStop& Stop : Stops)
	{
		if (Stop.Row.Kind == EWonderlandTravelKind::Arrival)
		{
			const FVector2f P = ToLocal(Stop.AnchorXY, Size);
			for (int32 Ring = 1; Ring <= 3; ++Ring)
			{
				AddRing(Points, P, 34.0f * Ring);
				FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, WonderlandUi::Gold(0.10f / Ring), true, 1.0f);
			}
		}
	}
	++Layer;

	const int32 MarkerLayer = Layer;
	const int32 LabelLayer = Layer + 3;
	for (int32 Index = 0; Index < Stops.Num(); ++Index)
	{
		const FWonderlandMapStop& Stop = Stops[Index];
		const FVector2f P = ToLocal(Stop.AnchorXY, Size);
		const bool bHot = Index == Hovered || Index == Selected;
		const FLinearColor Core = KindColor(Stop.Row.Kind);

		Disc(P, bHot ? 38.0f : 26.0f, Core.CopyWithNewOpacity(bHot ? 0.24f : 0.13f), MarkerLayer);
		Disc(P, bHot ? 15.0f : 11.0f, Core, MarkerLayer + 1);
		Disc(P, bHot ? 6.0f : 4.5f, WonderlandUi::Srgb(10, 12, 20), MarkerLayer + 2);
		if (Index == Selected)
		{
			AddRing(Points, P, 21.0f);
			FSlateDrawElement::MakeLines(OutDrawElements, MarkerLayer + 2, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, WonderlandUi::Gold(), true, 2.0f);
		}
		if (Index == Current)
		{
			const float Pulse = 0.5f + 0.5f * FMath::Sin(static_cast<float>(Now) * 3.0f);
			AddRing(Points, P, 16.0f + 7.0f * Pulse);
			FSlateDrawElement::MakeLines(OutDrawElements, MarkerLayer + 2, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, WonderlandUi::Sky(0.9f - 0.5f * Pulse), true, 1.5f);
		}
		const FString Label = Stop.Row.DisplayName.ToString();
		Text(Label, P + FVector2f(bHot ? 20.0f : 15.0f, -10.0f),
			bHot ? WonderlandUi::Sans(12, true, 40) : WonderlandUi::Sans(10, false, 20),
			bHot ? WonderlandUi::Gold() : WonderlandUi::Cream(0.84f), LabelLayer);
	}

	if (bHasPlayer)
	{
		const FVector2f P = ToLocal(PlayerXY, Size);
		const float Pulse = 0.5f + 0.5f * FMath::Sin(static_cast<float>(Now) * 4.0f);
		Disc(P, 22.0f + 10.0f * Pulse, WonderlandUi::Sky(0.22f * (1.0f - Pulse) + 0.05f), LabelLayer + 1);
		Disc(P, 9.0f, WonderlandUi::Sky(), LabelLayer + 2);
		Text(TEXT("YOU"), P + FVector2f(10.0f, 4.0f), WonderlandUi::Sans(9, true, 120), WonderlandUi::Sky(), LabelLayer + 2);
	}
	return LabelLayer + 3;
}

FReply SWonderlandMapCanvas::OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	const int32 Hit = StopAt(MyGeometry, MouseEvent.GetScreenSpacePosition());
	if (Hit != Hovered)
	{
		Hovered = Hit;
		Invalidate(EInvalidateWidgetReason::Paint);
	}
	return FReply::Unhandled();
}

FReply SWonderlandMapCanvas::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton)
	{
		const int32 Hit = StopAt(MyGeometry, MouseEvent.GetScreenSpacePosition());
		if (Hit != INDEX_NONE)
		{
			OnPick.ExecuteIfBound(Hit);
			return FReply::Handled();
		}
	}
	return FReply::Unhandled();
}

void SWonderlandMapCanvas::OnMouseLeave(const FPointerEvent& MouseEvent)
{
	if (Hovered != INDEX_NONE)
	{
		Hovered = INDEX_NONE;
		Invalidate(EInvalidateWidgetReason::Paint);
	}
}

FCursorReply SWonderlandMapCanvas::OnCursorQuery(const FGeometry& MyGeometry, const FPointerEvent& CursorEvent) const
{
	return Hovered != INDEX_NONE ? FCursorReply::Cursor(EMouseCursor::Hand) : FCursorReply::Unhandled();
}

/* ------------------------------------------------------------------ map */

SWonderlandWorldMap::SWonderlandWorldMap()
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::Gold(0.55f), 1.0f)
	, CardBrush(WonderlandUi::Srgb(14, 17, 26, 0.92f), 10.0f, WonderlandUi::GoldDim(), 1.0f)
	, ChipBrush(WonderlandUi::Srgb(20, 26, 22, 0.95f), 9.0f, WonderlandUi::Sage(0.55f), 1.0f)
	, ButtonNormal(WonderlandUi::Srgb(28, 22, 10, 0.92f), 8.0f, WonderlandUi::Gold(0.85f), 1.5f)
	, ButtonHovered(WonderlandUi::Srgb(64, 48, 18, 0.95f), 8.0f, WonderlandUi::Gold(), 2.0f)
	, ButtonPressed(WonderlandUi::Srgb(92, 68, 22, 0.98f), 8.0f, WonderlandUi::Gold(), 2.0f)
	, RuleBrush(WonderlandUi::Gold(0.35f), 0.0f, WonderlandUi::Gold(0.0f), 0.0f)
	, TerritoryChip(WonderlandUi::Srgb(16, 19, 28, 0.90f), 8.0f, WonderlandUi::Ivory(0.20f), 1.0f)
	, TerritoryChipOn(WonderlandUi::Srgb(40, 34, 14, 0.96f), 8.0f, WonderlandUi::Gold(), 1.5f)
{
	TerritoryChipStyle = FButtonStyle()
		.SetNormal(TerritoryChip).SetHovered(TerritoryChipOn).SetPressed(TerritoryChipOn)
		.SetNormalPadding(FMargin(12.0f, 7.0f)).SetPressedPadding(FMargin(12.0f, 7.0f));
}

void SWonderlandWorldMap::Construct(const FArguments& InArgs)
{
	OnRequestClose = InArgs._OnRequestClose;
	OnTravel = InArgs._OnTravel;
	OnRequestTerminal = InArgs._OnRequestTerminal;

	ScrimBrush.DrawAs = ESlateBrushDrawType::Box;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::MapScrim());

	TeleportStyle = FCoreStyle::Get().GetWidgetStyle<FButtonStyle>("Button");
	TeleportStyle.SetNormal(ButtonNormal).SetHovered(ButtonHovered).SetPressed(ButtonPressed)
		.SetNormalPadding(FMargin(0.0f, 10.0f)).SetPressedPadding(FMargin(0.0f, 11.0f, 0.0f, 9.0f));

	const TSharedRef<SWidget> Card =
		SNew(SBorder)
		.BorderImage(&CardBrush)
		.Padding(FMargin(20.0f, 18.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SAssignNew(KindText, STextBlock).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Dim())
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
			[
				SAssignNew(NameText, STextBlock).Font(WonderlandUi::Sans(20, true, 30)).ColorAndOpacity(WonderlandUi::Gold()).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left).Padding(0.0f, 10.0f, 0.0f, 0.0f)
			[
				SNew(SBorder)
				.BorderImage(&ChipBrush)
				.Padding(FMargin(10.0f, 3.0f))
				[
					SAssignNew(StatusText, STextBlock).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Sage())
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
			[
				SAssignNew(DescriptionText, STextBlock).Font(WonderlandUi::Sans(12)).ColorAndOpacity(WonderlandUi::Cream(0.92f)).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 0.0f)
			[
				SAssignNew(DistanceText, STextBlock).Font(WonderlandUi::Mono(10)).ColorAndOpacity(WonderlandUi::Dim())
			]
			+ SVerticalBox::Slot().FillHeight(1.0f)
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 0.0f)
			[
				SNew(SButton)
				.ButtonStyle(&TeleportStyle)
				.HAlign(HAlign_Center)
				.VAlign(VAlign_Center)
				.OnClicked(this, &SWonderlandWorldMap::HandleTeleportClicked)
				[
					SNew(STextBlock).Text(INVTEXT("TELEPORT")).Font(WonderlandUi::Sans(13, true, 260)).ColorAndOpacity(WonderlandUi::Gold())
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
			[
				SAssignNew(NoticeText, STextBlock).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
			]
			// THE SELECTED TERRITORY, in the same column the selected destination uses, because they answer the
			// same question at two scales: which place, and which country the place is in.
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
			[
				SAssignNew(TerritoryDetail, SVerticalBox)
			]
		];

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()
		[
			SNew(SBorder).BorderImage(&ScrimBrush)
		]
		+ SOverlay::Slot()
		[
			SNew(SConstraintCanvas)
			+ SConstraintCanvas::Slot()
			.Anchors(FAnchors(0.07f, 0.075f, 0.93f, 0.925f))
			.Offset(FMargin(0.0f))
			[
				SNew(SBorder)
				.BorderImage(&PanelBrush)
				.Padding(FMargin(26.0f, 20.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom)
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().AutoHeight()
							[
								SNew(STextBlock).Text(INVTEXT("WONDERLAND")).Font(WonderlandUi::Sans(24, true, 420)).ColorAndOpacity(WonderlandUi::Gold())
							]
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
							[
								SNew(STextBlock).Text(INVTEXT("Developed places you can visit now")).Font(WonderlandUi::Sans(11, false, 40)).ColorAndOpacity(WonderlandUi::Dim())
							]
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(INVTEXT("M or Esc to close   \u00B7   click a place, then Teleport")).Font(WonderlandUi::Mono(10)).ColorAndOpacity(WonderlandUi::Dim())
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 14.0f)
					[
						SNew(SBox).HeightOverride(1.0f)
						[
							SNew(SBorder).BorderImage(&RuleBrush)
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 12.0f)
					[
						// ---- THE TERRITORIES, ALONG THE TOP OF THE MAP.
						//
						// The founder asked for world orientation inside the navigation UI rather than beside
						// it, and this is where a player already comes to ask where things are. The chip of the
						// territory being stood in says HERE; every other chip says which way it lies and how
						// far. Selecting one fills the detail column with what the canon says it is for.
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)
						[
							SNew(STextBlock).Text(INVTEXT("TERRITORIES"))
							.Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Dim())
						]
						+ SVerticalBox::Slot().AutoHeight()
						[
							SAssignNew(TerritoryStrip, SHorizontalBox)
						]
					]
					+ SVerticalBox::Slot().FillHeight(1.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(0.67f)
						[
							SAssignNew(Canvas, SWonderlandMapCanvas)
							.OnPick_Lambda([this](int32 Index) { Select(Index); })
						]
						+ SHorizontalBox::Slot().FillWidth(0.33f).Padding(20.0f, 0.0f, 0.0f, 0.0f)
						[
							Card
						]
					]
				]
			]
		]
	];
	Select(INDEX_NONE);
}

void SWonderlandWorldMap::Refresh(const TArray<FWonderlandMapStop>& InStops, FName InCurrentId, const FVector2D& InPlayerXY, bool bInHasPlayer, const FString& Notice)
{
	const FName Previously = GetSelectedId();
	Stops = InStops;
	CurrentId = InCurrentId;
	PlayerXY = InPlayerXY;
	bHasPlayer = bInHasPlayer;

	int32 CurrentIndex = INDEX_NONE;
	int32 KeepIndex = INDEX_NONE;
	for (int32 Index = 0; Index < Stops.Num(); ++Index)
	{
		if (Stops[Index].Row.Id == CurrentId) { CurrentIndex = Index; }
		if (Stops[Index].Row.Id == Previously) { KeepIndex = Index; }
	}
	if (Canvas.IsValid())
	{
		Canvas->SetStops(Stops, PlayerXY, bHasPlayer, CurrentIndex);
	}
	Select(KeepIndex != INDEX_NONE ? KeepIndex : (CurrentIndex != INDEX_NONE ? CurrentIndex : (Stops.Num() > 0 ? 0 : INDEX_NONE)));
	if (NoticeText.IsValid())
	{
		NoticeText->SetText(FText::FromString(Notice));
	}
}

FString SWonderlandWorldMap::KindLabel(const FWonderlandTravelDestination& Row) const
{
	const TCHAR* Kind = TEXT("DISTRICT");
	switch (Row.Kind)
	{
	case EWonderlandTravelKind::Arrival:  Kind = TEXT("ARRIVAL"); break;
	case EWonderlandTravelKind::Quarter:  Kind = TEXT("QUARTER"); break;
	case EWonderlandTravelKind::Landmark: Kind = TEXT("LANDMARK"); break;
	default: break;
	}
	return Row.District.IsEmpty() ? FString(Kind) : FString::Printf(TEXT("%s  \u00B7  %s"), Kind, *Row.District.ToUpper());
}

void SWonderlandWorldMap::Select(int32 Index)
{
	SelectedIndex = Stops.IsValidIndex(Index) ? Index : INDEX_NONE;
	if (Canvas.IsValid())
	{
		Canvas->SetSelected(SelectedIndex);
	}
	if (!NameText.IsValid())
	{
		return;
	}
	if (SelectedIndex == INDEX_NONE)
	{
		KindText->SetText(INVTEXT("NO DESTINATIONS YET"));
		NameText->SetText(INVTEXT("Nothing to visit"));
		StatusText->SetText(FText::GetEmpty());
		DescriptionText->SetText(INVTEXT("No developed place in this world has an arrival point yet."));
		DistanceText->SetText(FText::GetEmpty());
		return;
	}
	const FWonderlandMapStop& Stop = Stops[SelectedIndex];
	KindText->SetText(FText::FromString(KindLabel(Stop.Row)));
	NameText->SetText(Stop.Row.DisplayName);
	StatusText->SetText(Stop.Row.Status == EWonderlandTravelStatus::Developed ? INVTEXT("DEVELOPED") : INVTEXT("AVAILABLE"));
	DescriptionText->SetText(Stop.Row.Description);
	if (Stop.Row.Id == CurrentId)
	{
		DistanceText->SetText(INVTEXT("You are here."));
	}
	else if (bHasPlayer)
	{
		const double Metres = FVector2D::Distance(PlayerXY, Stop.AnchorXY) / 100.0;
		DistanceText->SetText(FText::FromString(FString::Printf(TEXT("%.0f m from you"), Metres)));
	}
	else
	{
		DistanceText->SetText(FText::GetEmpty());
	}
}

FName SWonderlandWorldMap::GetSelectedId() const
{
	return Stops.IsValidIndex(SelectedIndex) ? Stops[SelectedIndex].Row.Id : NAME_None;
}

void SWonderlandWorldMap::SelectById(FName Id)
{
	for (int32 Index = 0; Index < Stops.Num(); ++Index)
	{
		if (Stops[Index].Row.Id == Id)
		{
			Select(Index);
			return;
		}
	}
}

FReply SWonderlandWorldMap::HandleTeleportClicked()
{
	if (Stops.IsValidIndex(SelectedIndex))
	{
		OnTravel.ExecuteIfBound(Stops[SelectedIndex].Row.Id);
	}
	return FReply::Handled();
}

FReply SWonderlandWorldMap::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::T && InKeyEvent.IsControlDown())
	{
		// UI-only input means the game's Ctrl+T binding cannot hear this; the map passes it on.
		OnRequestTerminal.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::M || Key == EKeys::Escape)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::Enter)
	{
		return HandleTeleportClicked();
	}
	if (Stops.Num() > 0 && (Key == EKeys::Right || Key == EKeys::Down || Key == EKeys::Tab))
	{
		Select((SelectedIndex + 1) % Stops.Num());
		return FReply::Handled();
	}
	if (Stops.Num() > 0 && (Key == EKeys::Left || Key == EKeys::Up))
	{
		Select((SelectedIndex - 1 + Stops.Num()) % Stops.Num());
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

/* ------------------------------------------------------------------------------------ the territories */

void SWonderlandWorldMap::RefreshTerritories(const TArray<FWonderlandMapTerritory>& InTerritories)
{
	Territories = InTerritories;
	if (SelectedTerritory.IsNone())
	{
		// OPEN ON WHERE YOU ARE. "Where am I?" is the founder's first question and it should not need a click.
		for (const FWonderlandMapTerritory& Entry : Territories)
		{
			if (Entry.bHere)
			{
				SelectedTerritory = Entry.Row.Id;
				break;
			}
		}
	}
	RebuildTerritoryStrip();
	ShowTerritory(SelectedTerritory);
}

void SWonderlandWorldMap::RebuildTerritoryStrip()
{
	if (!TerritoryStrip.IsValid())
	{
		return;
	}
	TerritoryStrip->ClearChildren();
	for (const FWonderlandMapTerritory& Entry : Territories)
	{
		const FName Id = Entry.Row.Id;
		const FLinearColor Accent = Entry.Row.Accent;
		const bool bHere = Entry.bHere;
		const bool bFound = Entry.bDiscovered;
		// UNDISCOVERED TERRITORIES ARE NAMED BUT NOT DESCRIBED. The founder asked for a discovered/undiscovered
		// state; a chip that hid the name entirely would make the map useless for planning where to go, and one
		// that gave away the whole entry would make discovery meaningless.
		const FString Label = Entry.Row.DisplayName;
		const FString Sub = bHere
			? FString(TEXT("HERE"))
			: (Entry.DistanceM >= 0.0f ? FString::Printf(TEXT("%.0f m"), Entry.DistanceM) : FString(TEXT("--")));
		TerritoryStrip->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			SNew(SButton).ButtonStyle(&TerritoryChipStyle).IsFocusable(false)
			.OnClicked_Lambda([this, Id]() { ShowTerritory(Id); return FReply::Handled(); })
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 8.0f, 0.0f)
				[
					// A pip in the territory's own canon colour, dim until it has been found.
					SNew(SBox).WidthOverride(9.0f).HeightOverride(9.0f)
					[
						SNew(SImage).Image(&ChipBrush)
						.ColorAndOpacity(FSlateColor(bFound ? Accent : Accent * 0.35f))
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Label))
					.Font(WonderlandUi::Sans(11, true, 120))
					.ColorAndOpacity(FSlateColor(bFound ? WonderlandUi::Cream() : WonderlandUi::Dim()))
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(9.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Sub))
					.Font(WonderlandUi::Mono(8))
					.ColorAndOpacity(FSlateColor(bHere ? WonderlandUi::Gold() : WonderlandUi::Dim()))
				]
			]
		];
	}
}

bool SWonderlandWorldMap::SelectTerritory(FName Id)
{
	for (const FWonderlandMapTerritory& Entry : Territories)
	{
		if (Entry.Row.Id == Id)
		{
			ShowTerritory(Id);
			return true;
		}
	}
	return false;
}

void SWonderlandWorldMap::ShowTerritory(FName Id)
{
	SelectedTerritory = Id;
	if (!TerritoryDetail.IsValid())
	{
		return;
	}
	TerritoryDetail->ClearChildren();
	const FWonderlandMapTerritory* Found = Territories.FindByPredicate(
		[Id](const FWonderlandMapTerritory& Entry) { return Entry.Row.Id == Id; });
	if (Found == nullptr)
	{
		return;
	}
	const FWonderlandTerritory& Row = Found->Row;

	auto Line = [this](const FString& Text, const FSlateFontInfo& Font, const FSlateColor& Colour, float Above)
	{
		return SNew(STextBlock).Text(FText::FromString(Text)).Font(Font).ColorAndOpacity(Colour).AutoWrapText(true);
	};

	TerritoryDetail->AddSlot().AutoHeight()
	[
		SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush)]
	];
	TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 0.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Row.DisplayName))
		.Font(WonderlandUi::Sans(15, true, 120)).ColorAndOpacity(FSlateColor(Row.Accent))
	];
	// THE SPECIALISATION, OR THE FACT THAT THE CANON DOES NOT STATE ONE. Never a guess: the founder asked for
	// exactly this rather than invented lore, and Dubel Forest is the territory it applies to.
	TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
	[
		SNew(STextBlock)
		.Text(FText::FromString(Row.bSpecialisationIsCanon && !Row.Specialisation.IsEmpty()
			? Row.Specialisation : FString(TEXT("NEEDS FOUNDER DEFINITION"))))
		.Font(WonderlandUi::Mono(9))
		.ColorAndOpacity(Row.bSpecialisationIsCanon ? WonderlandUi::Sage() : WonderlandUi::Gold())
		.AutoWrapText(true)
	];
	TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
	[
		SNew(STextBlock)
		.Text(FText::FromString(Found->bDiscovered ? TEXT("DISCOVERED") : TEXT("UNDISCOVERED")))
		.Font(WonderlandUi::Mono(8))
		.ColorAndOpacity(Found->bDiscovered ? WonderlandUi::Sage(0.9f) : WonderlandUi::Dim())
	];
	if (!Row.Purpose.IsEmpty())
	{
		TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Row.Purpose))
			.Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Cream(0.90f)).AutoWrapText(true)
		];
	}
	if (Row.Landmarks.Num() > 0)
	{
		TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(INVTEXT("IMPORTANT LOCATIONS"))
			.Font(WonderlandUi::Mono(8)).ColorAndOpacity(WonderlandUi::Dim())
		];
		TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(FString::Join(Row.Landmarks, TEXT("  ·  "))))
			.Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Cream(0.85f)).AutoWrapText(true)
		];
	}
	if (Row.Activities.Num() > 0)
	{
		TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(INVTEXT("AVAILABLE ACTIVITIES"))
			.Font(WonderlandUi::Mono(8)).ColorAndOpacity(WonderlandUi::Dim())
		];
		TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(FString::Join(Row.Activities, TEXT("  ·  "))))
			.Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Cream(0.85f)).AutoWrapText(true)
		];
	}
	// HOW DO I GET THERE. The last of the founder's six questions, answered in one line.
	TerritoryDetail->AddSlot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 0.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Found->Way))
		.Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Gold(0.90f)).AutoWrapText(true)
	];
	RebuildTerritoryStrip();
}

FString SWonderlandWorldMap::DescribeTerritoryPanel() const
{
	const FWonderlandMapTerritory* Found = Territories.FindByPredicate(
		[this](const FWonderlandMapTerritory& Entry) { return Entry.Row.Id == SelectedTerritory; });
	if (Found == nullptr)
	{
		return FString();
	}
	const FWonderlandTerritory& Row = Found->Row;
	TArray<FString> Parts;
	Parts.Add(Row.DisplayName);
	Parts.Add(Row.bSpecialisationIsCanon && !Row.Specialisation.IsEmpty()
		? Row.Specialisation : FString(TEXT("NEEDS FOUNDER DEFINITION")));
	Parts.Add(Found->bDiscovered ? TEXT("DISCOVERED") : TEXT("UNDISCOVERED"));
	Parts.Add(Row.Purpose);
	Parts.Add(FString::Join(Row.Landmarks, TEXT(",")));
	Parts.Add(FString::Join(Row.Activities, TEXT(",")));
	Parts.Add(Found->Way);
	return FString::Join(Parts, TEXT("|"));
}

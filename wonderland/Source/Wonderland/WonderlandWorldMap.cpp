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

namespace
{
	// The zoom controls sit in the canvas's bottom-left corner and the scale bar in its bottom-right; the compass is
	// top-right. Labels keep out of all three.
	constexpr float CanvasMargin = 14.0f;
	constexpr float ControlSize = 26.0f;
	constexpr float ControlGap = 6.0f;
	// Two markers closer than this (centre to centre, px) fold into one group. Wider than two HALOS, so no two drawn
	// markers' glows touch. 17 px (the first cut) left eight of the Golden Arrival's markers within 40 px of the gate at
	// FIT, halo on halo: exactly the knot the founder photographed, only unlabelled.
	constexpr float GroupPx = 28.0f;
	// Label candidates: eight directions, three distances. Ring 0 sits against the marker's halo; rings 1 and 2 stand off
	// on a leader line.
	constexpr float RingStep = 24.0f;

	float MarkerRadius(int32 Tier, bool bHot)
	{
		if (bHot)
		{
			return 7.5f;
		}
		return Tier == 0 ? 6.5f : (Tier == 1 ? 6.0f : 5.5f);
	}

	/** The soft glow round a marker: what the eye reads as the marker's footprint, so it is what labels keep clear of. */
	float HaloRadius(float Radius)
	{
		return Radius * 1.9f;
	}

	/** Two segments properly cross (touching at an end does not count: a line may start where another ends). */
	bool SegmentsCross(const FVector2f& A, const FVector2f& B, const FVector2f& C, const FVector2f& D)
	{
		auto Cross = [](const FVector2f& O, const FVector2f& P, const FVector2f& Q)
		{
			return (P.X - O.X) * (Q.Y - O.Y) - (P.Y - O.Y) * (Q.X - O.X);
		};
		const float D1 = Cross(C, D, A);
		const float D2 = Cross(C, D, B);
		const float D3 = Cross(A, B, C);
		const float D4 = Cross(A, B, D);
		return ((D1 > 0.0f && D2 < 0.0f) || (D1 < 0.0f && D2 > 0.0f)) && ((D3 > 0.0f && D4 < 0.0f) || (D3 < 0.0f && D4 > 0.0f));
	}

	bool SegmentHitsCircle(const FVector2f& A, const FVector2f& B, const FVector2f& C, float R)
	{
		const FVector2f AB = B - A;
		const float Len2 = AB.SizeSquared();
		const float T = Len2 > KINDA_SMALL_NUMBER ? FMath::Clamp(FVector2f::DotProduct(C - A, AB) / Len2, 0.0f, 1.0f) : 0.0f;
		return FVector2f::DistSquared(A + AB * T, C) < R * R;
	}

	bool SegmentHitsRect(const FVector2f& A, const FVector2f& B, const FSlateRect& Rect)
	{
		// sampled: the segments are a few dozen pixels, so nine interior samples cannot step over a label
		for (int32 Step = 1; Step <= 9; ++Step)
		{
			const FVector2f P = A + (B - A) * (Step / 10.0f);
			if (P.X > Rect.Left && P.X < Rect.Right && P.Y > Rect.Top && P.Y < Rect.Bottom)
			{
				return true;
			}
		}
		return false;
	}

	bool RectHitsCircle(const FSlateRect& Rect, const FVector2f& C, float R)
	{
		const float NX = FMath::Clamp(C.X, Rect.Left, Rect.Right);
		const float NY = FMath::Clamp(C.Y, Rect.Top, Rect.Bottom);
		return FMath::Square(NX - C.X) + FMath::Square(NY - C.Y) < R * R;
	}

	bool RectsOverlap(const FSlateRect& A, const FSlateRect& B, float Pad)
	{
		return A.Left < B.Right + Pad && B.Left < A.Right + Pad && A.Top < B.Bottom + Pad && B.Top < A.Bottom + Pad;
	}

	FString JsonNumber(double Value)
	{
		return FString::Printf(TEXT("%.3f"), Value);
	}
}

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
	// THE MAP OPENS ON THE WHOLE WORLD, as it always has; zoom and pan last while it stays open.
	FitView();
}

void SWonderlandMapCanvas::SetSelected(int32 Index)
{
	Selected = Index;
	Invalidate(EInvalidateWidgetReason::Paint);
}

int32 SWonderlandMapCanvas::TierOf(const FWonderlandTravelDestination& Row)
{
	// THE ORDER A NAME IS GIVEN SPACE IN: where every visit begins, then the nation quarters and the core's quarter,
	// then the landmarks, then the districts. The selected and hovered place outrank all of them (see BuildLayout).
	switch (Row.Kind)
	{
	case EWonderlandTravelKind::Arrival:  return 0;
	case EWonderlandTravelKind::Quarter:  return 1;
	case EWonderlandTravelKind::Landmark: return 2;
	default:                              return 3;
	}
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

void SWonderlandMapCanvas::ClampView()
{
	Zoom = FMath::Clamp(Zoom, 1.0f, MaxZoom);
	if (Zoom <= 1.0001f)
	{
		ViewCentre = (BoundsMin + BoundsMax) * 0.5;
		return;
	}
	ViewCentre.X = FMath::Clamp(ViewCentre.X, BoundsMin.X, BoundsMax.X);
	ViewCentre.Y = FMath::Clamp(ViewCentre.Y, BoundsMin.Y, BoundsMax.Y);
}

void SWonderlandMapCanvas::SetZoom(float InZoom)
{
	Zoom = InZoom;
	ClampView();
	Hovered = INDEX_NONE;
	Invalidate(EInvalidateWidgetReason::Paint);
}

void SWonderlandMapCanvas::FitView()
{
	SetZoom(1.0f);
}

void SWonderlandMapCanvas::CentreOn(int32 Index, float MinZoom)
{
	if (!Stops.IsValidIndex(Index))
	{
		return;
	}
	Zoom = FMath::Max(Zoom, MinZoom);
	ViewCentre = Stops[Index].AnchorXY;
	ClampView();
	Invalidate(EInvalidateWidgetReason::Paint);
}

void SWonderlandMapCanvas::EnsureVisible(int32 Index)
{
	if (!Stops.IsValidIndex(Index) || LayoutSize.X <= 1.0f || Zoom <= 1.0001f)
	{
		return;
	}
	const FVector2f P = ToLocal(Stops[Index].AnchorXY, LayoutSize);
	const float Inset = 48.0f;
	if (P.X < Inset || P.Y < Inset || P.X > LayoutSize.X - Inset || P.Y > LayoutSize.Y - Inset)
	{
		ViewCentre = Stops[Index].AnchorXY;
		ClampView();
		Invalidate(EInvalidateWidgetReason::Paint);
	}
}

double SWonderlandMapCanvas::PixelsPerUnit(const FVector2f& Size) const
{
	const double Pad = 40.0;
	const double SpanX = FMath::Max(BoundsMax.X - BoundsMin.X, 1.0);
	const double SpanY = FMath::Max(BoundsMax.Y - BoundsMin.Y, 1.0);
	const double Fit = FMath::Max(FMath::Min((Size.X - 2.0 * Pad) / SpanX, (Size.Y - 2.0 * Pad) / SpanY), 1e-6);
	return Fit * Zoom;
}

FVector2f SWonderlandMapCanvas::ToLocal(const FVector2D& WorldXY, const FVector2f& Size) const
{
	// North-up as the arrival sees it: the castle (+Y) is up, and screen-right is -X, which is what is on your right
	// when you stand at the gate. At zoom 1 this is exactly the old whole-world plan; zoom scales it about ViewCentre.
	const double Scale = PixelsPerUnit(Size);
	return FVector2f(static_cast<float>(Size.X * 0.5 + (ViewCentre.X - WorldXY.X) * Scale),
		static_cast<float>(Size.Y * 0.5 + (ViewCentre.Y - WorldXY.Y) * Scale));
}

void SWonderlandMapCanvas::ZoomAbout(float NewZoom, const FVector2f& LocalPoint, const FVector2f& Size)
{
	// the world point under the cursor stays under the cursor
	const double Before = PixelsPerUnit(Size);
	const FVector2D Under(ViewCentre.X - (LocalPoint.X - Size.X * 0.5) / Before, ViewCentre.Y - (LocalPoint.Y - Size.Y * 0.5) / Before);
	Zoom = FMath::Clamp(NewZoom, 1.0f, MaxZoom);
	const double After = PixelsPerUnit(Size);
	ViewCentre = FVector2D(Under.X + (LocalPoint.X - Size.X * 0.5) / After, Under.Y + (LocalPoint.Y - Size.Y * 0.5) / After);
	ClampView();
	Hovered = INDEX_NONE;
	Invalidate(EInvalidateWidgetReason::Paint);
}

FSlateRect SWonderlandMapCanvas::ControlRect(int32 Which) const
{
	const float Bottom = LayoutSize.Y - CanvasMargin - 4.0f;
	float Left = CanvasMargin + 4.0f;
	for (int32 Index = 0; Index < Which; ++Index)
	{
		Left += (Index == 2 ? 44.0f : ControlSize) + ControlGap;
	}
	const float Width = Which == 2 ? 44.0f : ControlSize;
	return FSlateRect(Left, Bottom - ControlSize, Left + Width, Bottom);
}

int32 SWonderlandMapCanvas::ControlAtLocal(const FVector2f& Local) const
{
	for (int32 Which = 0; Which < 3; ++Which)
	{
		const FSlateRect Rect = ControlRect(Which);
		if (Local.X >= Rect.Left && Local.X <= Rect.Right && Local.Y >= Rect.Top && Local.Y <= Rect.Bottom)
		{
			return Which;
		}
	}
	return INDEX_NONE;
}

void SWonderlandMapCanvas::BuildLayout(const FVector2f& Size) const
{
	LayoutSize = Size;
	Layout.Reset();
	Layout.SetNum(Stops.Num());
	// THE SELECTED AND HOVERED PLACES ALWAYS STAND ALONE. The place being stood at does not need to: the YOU marker says
	// where the player is, and forcing it too let it sit halo-on-halo beside a selected neighbour.
	auto IsForced = [this](int32 Index) { return Index == Selected || Index == Hovered; };

	// ---- 1. EVERY MARKER WHERE ITS ARRIVAL POINT PROJECTS. Nothing below moves one.
	TArray<int32> Order;
	for (int32 Index = 0; Index < Stops.Num(); ++Index)
	{
		FPlaced& Placed = Layout[Index];
		Placed.Index = Index;
		Placed.Tier = TierOf(Stops[Index].Row);
		Placed.Marker = ToLocal(Stops[Index].AnchorXY, Size);
		Placed.Radius = MarkerRadius(Placed.Tier, Index == Selected || Index == Hovered);
		Placed.Halo = HaloRadius(Placed.Radius);
		Placed.bOnScreen = Placed.Marker.X >= 2.0f && Placed.Marker.Y >= 2.0f && Placed.Marker.X <= Size.X - 2.0f && Placed.Marker.Y <= Size.Y - 2.0f;
		if (Placed.bOnScreen)
		{
			Order.Add(Index);
		}
	}
	const FVector2f Middle = Size * 0.5f;
	Order.Sort([this, &IsForced, &Middle](int32 A, int32 B)
	{
		const bool FA = IsForced(A);
		const bool FB = IsForced(B);
		if (FA != FB) { return FA; }
		if (Layout[A].Tier != Layout[B].Tier) { return Layout[A].Tier < Layout[B].Tier; }
		const float DA = FVector2f::DistSquared(Layout[A].Marker, Middle);
		const float DB = FVector2f::DistSquared(Layout[B].Marker, Middle);
		if (!FMath::IsNearlyEqual(DA, DB)) { return DA < DB; }
		return A < B;
	});

	// ---- 2. GROUPS: a marker within GroupPx of one already standing folds into it (the nearest), unless it is the
	// selected, hovered or current place, which always stands on its own.
	TArray<int32> Leaders;
	for (const int32 Index : Order)
	{
		int32 Best = INDEX_NONE;
		float BestDistance = GroupPx;
		if (!IsForced(Index))
		{
			for (const int32 Leader : Leaders)
			{
				const float Distance = FVector2f::Distance(Layout[Index].Marker, Layout[Leader].Marker);
				if (Distance < BestDistance)
				{
					BestDistance = Distance;
					Best = Leader;
				}
			}
		}
		if (Best != INDEX_NONE)
		{
			Layout[Index].Leader = Best;
			++Layout[Best].Members;
		}
		else
		{
			Layout[Index].bDrawn = true;
			Leaders.Add(Index);
		}
	}

	// ---- 3. LABELS, most important first, at the first candidate that collides with nothing already placed: no other
	// label, no marker's halo, no leader line, and -- for a label set off on a line -- a line that crosses no halo, no
	// label and no other line.
	TArray<FSlateRect> Taken;
	TArray<TPair<FVector2f, FVector2f>> Lines;
	struct FDisc { FVector2f Centre; float Radius; int32 Owner; };
	TArray<FDisc> Discs;
	for (const int32 Leader : Leaders)
	{
		// the halo, or the selected ring where that is wider, plus a breath
		const float Ring = Leader == Selected ? Layout[Leader].Radius + (Layout[Leader].Members > 0 ? 9.0f : 6.0f) : 0.0f;
		Discs.Add({ Layout[Leader].Marker, FMath::Max(Layout[Leader].Halo, Ring) + 2.0f, Leader });
	}
	constexpr int32 YouOwner = -2;
	bYouShown = false;
	bYouLabel = false;
	if (bHasPlayer)
	{
		YouAt = ToLocal(PlayerXY, Size);
		bYouShown = YouAt.X >= 0.0f && YouAt.Y >= 0.0f && YouAt.X <= Size.X && YouAt.Y <= Size.Y;
		if (bYouShown)
		{
			Discs.Add({ YouAt, 11.0f, YouOwner });
		}
	}
	const TArray<FSlateRect> KeepOut = {
		FSlateRect(Size.X - 64.0f, 0.0f, Size.X, 72.0f),                                          // compass
		FSlateRect(0.0f, Size.Y - CanvasMargin - ControlSize - 12.0f, 190.0f, Size.Y),            // zoom controls
		FSlateRect(Size.X - 190.0f, Size.Y - CanvasMargin - 30.0f, Size.X, Size.Y),                // scale bar
	};
	static const FVector2f Directions[8] = {
		FVector2f(1.0f, 0.0f), FVector2f(-1.0f, 0.0f), FVector2f(0.7071f, -0.7071f), FVector2f(0.7071f, 0.7071f),
		FVector2f(-0.7071f, -0.7071f), FVector2f(-0.7071f, 0.7071f), FVector2f(0.0f, -1.0f), FVector2f(0.0f, 1.0f),
	};

	// ONE PLACEMENT RULE for every label on the plan, the YOU tag included.
	auto TryPlace = [&](const FVector2f& Marker, float Footprint, const TArray<int32>& Owners, const FVector2f& Box,
		FSlateRect& OutRect, bool& bOutLine, FVector2f& OutFrom, FVector2f& OutTo) -> bool
	{
		for (int32 Ring = 0; Ring < 3; ++Ring)
		{
			for (int32 Octant = 0; Octant < 8; ++Octant)
			{
				const FVector2f D = Directions[Octant];
				const FVector2f A = Marker + D * (Footprint + 3.0f + Ring * RingStep);
				// the box's corner or edge nearest the marker sits on A, so the box extends AWAY from the marker
				const float Left = D.X > 0.1f ? A.X : (D.X < -0.1f ? A.X - Box.X : A.X - Box.X * 0.5f);
				const float Top = D.Y > 0.1f ? A.Y : (D.Y < -0.1f ? A.Y - Box.Y : A.Y - Box.Y * 0.5f);
				const FSlateRect Rect(Left, Top, Left + Box.X, Top + Box.Y);
				if (Rect.Left < CanvasMargin || Rect.Top < CanvasMargin || Rect.Right > Size.X - CanvasMargin || Rect.Bottom > Size.Y - CanvasMargin)
				{
					continue;
				}
				bool bClear = true;
				for (int32 K = 0; bClear && K < KeepOut.Num(); ++K)
				{
					bClear = !RectsOverlap(Rect, KeepOut[K], 0.0f);
				}
				for (int32 T = 0; bClear && T < Taken.Num(); ++T)
				{
					bClear = !RectsOverlap(Rect, Taken[T], 3.0f);
				}
				for (int32 C = 0; bClear && C < Discs.Num(); ++C)
				{
					bClear = Owners.Contains(Discs[C].Owner) || !RectHitsCircle(Rect, Discs[C].Centre, Discs[C].Radius);
				}
				for (int32 L = 0; bClear && L < Lines.Num(); ++L)
				{
					bClear = !SegmentHitsRect(Lines[L].Key, Lines[L].Value, Rect);
				}
				const FVector2f From = Marker + D * Footprint;
				if (bClear && Ring > 0)
				{
					for (int32 C = 0; bClear && C < Discs.Num(); ++C)
					{
						bClear = Owners.Contains(Discs[C].Owner) || !SegmentHitsCircle(From, A, Discs[C].Centre, Discs[C].Radius);
					}
					for (int32 T = 0; bClear && T < Taken.Num(); ++T)
					{
						bClear = !SegmentHitsRect(From, A, Taken[T]);
					}
					for (int32 L = 0; bClear && L < Lines.Num(); ++L)
					{
						bClear = !SegmentsCross(From, A, Lines[L].Key, Lines[L].Value);
					}
				}
				if (!bClear)
				{
					continue;
				}
				OutRect = Rect;
				bOutLine = Ring > 0;
				OutFrom = From;
				OutTo = A;
				Taken.Add(Rect);
				if (Ring > 0)
				{
					Lines.Add(TPair<FVector2f, FVector2f>(From, A));
				}
				return true;
			}
		}
		return false;
	};

	// YOU FIRST: where the player is matters more than any single name, and it must never be printed over a marker.
	if (bYouShown)
	{
		const FVector2f YouText = MeasureText(TEXT("YOU"), WonderlandUi::Sans(9, true, 120));
		bool bLine = false;
		FVector2f From, To;
		// STANDING ON A PLACE -- the usual case, after any teleport -- the YOU marker sits inside that marker's halo, and a
		// tag that kept clear of it from inside could never be placed. So the two are one footprint for the YOU tag.
		TArray<int32> YouOwners = { YouOwner };
		float YouFootprint = 11.0f;
		for (const FDisc& Disc : Discs)
		{
			const float Distance = FVector2f::Distance(Disc.Centre, YouAt);
			if (Disc.Owner >= 0 && Distance < Disc.Radius)
			{
				YouOwners.Add(Disc.Owner);
				YouFootprint = FMath::Max(YouFootprint, Distance + Disc.Radius);
			}
		}
		bYouLabel = TryPlace(YouAt, YouFootprint, YouOwners, FVector2f(YouText.X + 8.0f, YouText.Y + 2.0f), YouLabel, bLine, From, To);
		bYouLine = bLine;
		YouLineFrom = From;
		YouLineTo = To;
	}
	for (const int32 Index : Order)
	{
		FPlaced& Placed = Layout[Index];
		if (!Placed.bDrawn)
		{
			continue;
		}
		const bool bHot = Index == Selected || Index == Hovered;
		const FSlateFontInfo Font = bHot ? WonderlandUi::Sans(12, true, 40)
			: (Placed.Tier <= 1 ? WonderlandUi::Sans(11, true, 30) : WonderlandUi::Sans(10, false, 20));
		FString Text = Stops[Index].Row.DisplayName.ToString();
		if (Placed.Members > 0)
		{
			Text += FString::Printf(TEXT("  +%d"), Placed.Members);
		}
		const FVector2f Measured = MeasureText(Text, Font);
		const FVector2f Box(Measured.X + 10.0f, Measured.Y + 4.0f);
		float Footprint = Discs.FindByPredicate([Index](const FDisc& Disc) { return Disc.Owner == Index; })->Radius;
		TArray<int32> Owners = { Index };
		// and the place the player stands on takes the YOU marker into its own footprint, the same way round
		if (bYouShown && FVector2f::Distance(YouAt, Placed.Marker) < Footprint)
		{
			Owners.Add(YouOwner);
			Footprint = FMath::Max(Footprint, FVector2f::Distance(YouAt, Placed.Marker) + 11.0f);
		}
		Placed.bLabel = TryPlace(Placed.Marker, Footprint, Owners, Box, Placed.Label, Placed.bLeaderLine, Placed.LineFrom, Placed.LineTo);
		if (!Placed.bLabel && IsForced(Index))
		{
			// THE SELECTED OR HOVERED PLACE IS ALWAYS NAMED -- beside its marker, to the side with the most room.
			const float Left = Placed.Marker.X < Size.X * 0.5f ? Placed.Marker.X + Footprint + 3.0f : Placed.Marker.X - Footprint - 3.0f - Box.X;
			Placed.bLabel = true;
			Placed.bLeaderLine = false;
			Placed.Label = FSlateRect(Left, Placed.Marker.Y - Box.Y * 0.5f, Left + Box.X, Placed.Marker.Y + Box.Y * 0.5f);
			Taken.Add(Placed.Label);
		}
	}
}

int32 SWonderlandMapCanvas::StopAtLocal(const FVector2f& Local) const
{
	for (const FPlaced& Placed : Layout)
	{
		if (Placed.bDrawn && Placed.bLabel && Local.X >= Placed.Label.Left - 2.0f && Local.X <= Placed.Label.Right + 2.0f
			&& Local.Y >= Placed.Label.Top - 2.0f && Local.Y <= Placed.Label.Bottom + 2.0f)
		{
			return Placed.Index;
		}
	}
	int32 Best = INDEX_NONE;
	float BestDistance = TNumericLimits<float>::Max();
	for (const FPlaced& Placed : Layout)
	{
		if (!Placed.bDrawn)
		{
			continue;
		}
		const float Distance = FVector2f::Distance(Local, Placed.Marker);
		if (Distance <= FMath::Max(12.0f, Placed.Radius + 6.0f) && Distance < BestDistance)
		{
			BestDistance = Distance;
			Best = Placed.Index;
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
	LayoutAbsolute = FVector2f(static_cast<float>(AllottedGeometry.GetAbsolutePosition().X), static_cast<float>(AllottedGeometry.GetAbsolutePosition().Y));
	LayoutScale = AllottedGeometry.GetAccumulatedLayoutTransform().GetScale();
	BuildLayout(Size);

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
	auto Line = [&](const FVector2f& A, const FVector2f& B, const FLinearColor& Color, float Thickness, int32 AtLayer)
	{
		TArray<FVector2f> Segment = { A, B };
		FSlateDrawElement::MakeLines(OutDrawElements, AtLayer, AllottedGeometry.ToPaintGeometry(), Segment, ESlateDrawEffect::None, Color, true, Thickness);
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
		Line(FVector2f(X, 16.0f), FVector2f(X, Size.Y - 16.0f), WonderlandUi::Gold(0.045f), 1.0f, Layer);
		Line(FVector2f(16.0f, Y), FVector2f(Size.X - 16.0f, Y), WonderlandUi::Gold(0.045f), 1.0f, Layer);
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
	Line(FVector2f(Size.X - 37.5f, 42.0f), FVector2f(Size.X - 37.5f, 60.0f), WonderlandUi::Gold(0.7f), 1.5f, Layer);
	++Layer;

	// Soft rings around the arrival: where every visit begins.
	for (const FPlaced& Placed : Layout)
	{
		if (Placed.bOnScreen && Stops[Placed.Index].Row.Kind == EWonderlandTravelKind::Arrival)
		{
			for (int32 Ring = 1; Ring <= 3; ++Ring)
			{
				AddRing(Points, Placed.Marker, 34.0f * Ring);
				FSlateDrawElement::MakeLines(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, WonderlandUi::Gold(0.10f / Ring), true, 1.0f);
			}
		}
	}
	++Layer;

	// ---- THE FOLDED PLACES, as small dots where they really are, and the leader lines -- under every marker.
	const int32 DotLayer = Layer;
	const int32 MarkerLayer = Layer + 1;
	const int32 LabelLayer = Layer + 5;
	for (const FPlaced& Placed : Layout)
	{
		if (Placed.bOnScreen && !Placed.bDrawn)
		{
			Disc(Placed.Marker, 5.0f, KindColor(Stops[Placed.Index].Row.Kind).CopyWithNewOpacity(0.62f), DotLayer);
		}
		if (Placed.bLabel && Placed.bLeaderLine)
		{
			Line(Placed.LineFrom, Placed.LineTo, WonderlandUi::Gold(0.42f), 1.0f, DotLayer);
		}
	}

	for (const FPlaced& Placed : Layout)
	{
		if (!Placed.bDrawn)
		{
			continue;
		}
		const int32 Index = Placed.Index;
		const FVector2f P = Placed.Marker;
		const bool bHot = Index == Hovered || Index == Selected;
		const FLinearColor Core = KindColor(Stops[Index].Row.Kind);
		const float D = Placed.Radius * 2.0f;
		Disc(P, Placed.Halo * 2.0f, Core.CopyWithNewOpacity(bHot ? 0.24f : 0.13f), MarkerLayer);
		Disc(P, D, Core, MarkerLayer + 1);
		Disc(P, D * 0.4f, WonderlandUi::Srgb(10, 12, 20), MarkerLayer + 2);
		if (Placed.Members > 0)
		{
			// A GROUP: one ring round the marker that stands for it (its label carries the count).
			AddRing(Points, P, Placed.Radius + 4.5f, 28);
			FSlateDrawElement::MakeLines(OutDrawElements, MarkerLayer + 2, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Core.CopyWithNewOpacity(0.75f), true, 1.5f);
		}
		if (Index == Selected)
		{
			AddRing(Points, P, Placed.Radius + (Placed.Members > 0 ? 9.0f : 6.0f));
			FSlateDrawElement::MakeLines(OutDrawElements, MarkerLayer + 3, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, WonderlandUi::Gold(), true, 2.0f);
		}
		if (Index == Current)
		{
			const float Pulse = 0.5f + 0.5f * FMath::Sin(static_cast<float>(Now) * 3.0f);
			AddRing(Points, P, Placed.Radius + 3.0f + 7.0f * Pulse);
			FSlateDrawElement::MakeLines(OutDrawElements, MarkerLayer + 3, AllottedGeometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, WonderlandUi::Sky(0.9f - 0.5f * Pulse), true, 1.5f);
		}
		if (!Placed.bLabel)
		{
			continue;
		}
		// THE LABEL, on a dark plate so it reads over the grid and the rings.
		const FSlateFontInfo Font = bHot ? WonderlandUi::Sans(12, true, 40)
			: (Placed.Tier <= 1 ? WonderlandUi::Sans(11, true, 30) : WonderlandUi::Sans(10, false, 20));
		const FSlateRect& Rect = Placed.Label;
		FSlateDrawElement::MakeBox(OutDrawElements, LabelLayer,
			AllottedGeometry.ToPaintGeometry(FVector2f(Rect.Right - Rect.Left, Rect.Bottom - Rect.Top), FSlateLayoutTransform(FVector2f(Rect.Left, Rect.Top))),
			&Plate, ESlateDrawEffect::None, Plate.TintColor.GetSpecifiedColor());
		const FString Name = Stops[Index].Row.DisplayName.ToString();
		const FLinearColor NameColour = bHot ? WonderlandUi::Gold() : (Placed.Tier <= 1 ? WonderlandUi::Cream(0.96f) : WonderlandUi::Cream(0.84f));
		Text(Name, FVector2f(Rect.Left + 5.0f, Rect.Top + 2.0f), Font, NameColour, LabelLayer + 1);
		if (Placed.Members > 0)
		{
			const FVector2f NameSize = MeasureText(Name, Font);
			Text(FString::Printf(TEXT("  +%d"), Placed.Members), FVector2f(Rect.Left + 5.0f + NameSize.X, Rect.Top + 2.0f), Font, WonderlandUi::Gold(0.85f), LabelLayer + 1);
		}
	}

	if (bYouShown)
	{
		const float Pulse = 0.5f + 0.5f * FMath::Sin(static_cast<float>(Now) * 4.0f);
		Disc(YouAt, 22.0f + 10.0f * Pulse, WonderlandUi::Sky(0.22f * (1.0f - Pulse) + 0.05f), LabelLayer + 2);
		Disc(YouAt, 9.0f, WonderlandUi::Sky(), LabelLayer + 3);
		if (bYouLabel)
		{
			// placed like every other label (BuildLayout), so it is never printed over a marker
			if (bYouLine)
			{
				Line(YouLineFrom, YouLineTo, WonderlandUi::Sky(0.55f), 1.0f, LabelLayer + 2);
			}
			FSlateDrawElement::MakeBox(OutDrawElements, LabelLayer + 2,
				AllottedGeometry.ToPaintGeometry(FVector2f(YouLabel.Right - YouLabel.Left, YouLabel.Bottom - YouLabel.Top), FSlateLayoutTransform(FVector2f(YouLabel.Left, YouLabel.Top))),
				&Plate, ESlateDrawEffect::None, Plate.TintColor.GetSpecifiedColor());
			Text(TEXT("YOU"), FVector2f(YouLabel.Left + 4.0f, YouLabel.Top + 1.0f), WonderlandUi::Sans(9, true, 120), WonderlandUi::Sky(), LabelLayer + 3);
		}
	}

	// ---- THE ZOOM CONTROLS (bottom-left) and THE SCALE BAR (bottom-right): the map is read at more than one scale now,
	// so it says which one it is at.
	static const TCHAR* ControlText[3] = { TEXT("+"), TEXT("–"), TEXT("FIT") };
	for (int32 Which = 0; Which < 3; ++Which)
	{
		const FSlateRect Rect = ControlRect(Which);
		const bool bLit = Which == HoveredControl;
		FSlateDrawElement::MakeBox(OutDrawElements, LabelLayer + 2,
			AllottedGeometry.ToPaintGeometry(FVector2f(Rect.Right - Rect.Left, Rect.Bottom - Rect.Top), FSlateLayoutTransform(FVector2f(Rect.Left, Rect.Top))),
			&ControlBrush, ESlateDrawEffect::None, bLit ? WonderlandUi::Srgb(64, 48, 18, 0.95f) : ControlBrush.TintColor.GetSpecifiedColor());
		const FSlateFontInfo Font = Which == 2 ? WonderlandUi::Sans(9, true, 120) : WonderlandUi::Sans(13, true);
		const FVector2f Measured = MeasureText(ControlText[Which], Font);
		Text(ControlText[Which], FVector2f((Rect.Left + Rect.Right - Measured.X) * 0.5f, (Rect.Top + Rect.Bottom - Measured.Y) * 0.5f),
			Font, WonderlandUi::Gold(bLit ? 1.0f : 0.85f), LabelLayer + 3);
	}
	{
		const FSlateRect Fit = ControlRect(2);
		Text(FString::Printf(TEXT("×%.1f"), Zoom), FVector2f(Fit.Right + 10.0f, Fit.Top + 6.0f), WonderlandUi::Mono(9), WonderlandUi::Dim(), LabelLayer + 3);
	}
	{
		const double PixelsPerMetre = PixelsPerUnit(Size) * 100.0;
		static const int32 Steps[] = { 10, 20, 50, 100, 200, 500, 1000, 2000 };
		int32 Metres = Steps[0];
		for (const int32 Step : Steps)
		{
			if (Step * PixelsPerMetre <= 150.0)
			{
				Metres = Step;
			}
		}
		const float Length = static_cast<float>(Metres * PixelsPerMetre);
		const float Right = Size.X - CanvasMargin - 8.0f;
		const float Y = Size.Y - CanvasMargin - 10.0f;
		Line(FVector2f(Right - Length, Y), FVector2f(Right, Y), WonderlandUi::Gold(0.75f), 1.5f, LabelLayer + 2);
		Line(FVector2f(Right - Length, Y - 4.0f), FVector2f(Right - Length, Y + 1.0f), WonderlandUi::Gold(0.75f), 1.5f, LabelLayer + 2);
		Line(FVector2f(Right, Y - 4.0f), FVector2f(Right, Y + 1.0f), WonderlandUi::Gold(0.75f), 1.5f, LabelLayer + 2);
		const FString Caption = Metres >= 1000 ? FString::Printf(TEXT("%d km"), Metres / 1000) : FString::Printf(TEXT("%d m"), Metres);
		const FVector2f Measured = MeasureText(Caption, WonderlandUi::Mono(9));
		Text(Caption, FVector2f(Right - Length * 0.5f - Measured.X * 0.5f, Y - 6.0f - Measured.Y), WonderlandUi::Mono(9), WonderlandUi::Dim(), LabelLayer + 2);
	}
	return LabelLayer + 4;
}

FReply SWonderlandMapCanvas::OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	const FVector2D Raw = MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition());
	const FVector2f Local(static_cast<float>(Raw.X), static_cast<float>(Raw.Y));
	if (bPressed && HasMouseCapture())
	{
		if (!bDragged && FVector2f::Distance(Local, PressLocal) > 4.0f)
		{
			bDragged = true;
		}
		if (bDragged && Zoom > 1.0001f)
		{
			// PAN: the plan follows the pointer
			const FVector2f Delta = Local - LastDragLocal;
			const double Scale = PixelsPerUnit(LayoutSize.X > 1.0f ? LayoutSize
				: FVector2f(static_cast<float>(MyGeometry.GetLocalSize().X), static_cast<float>(MyGeometry.GetLocalSize().Y)));
			ViewCentre += FVector2D(Delta.X / Scale, Delta.Y / Scale);
			ClampView();
			Invalidate(EInvalidateWidgetReason::Paint);
		}
		LastDragLocal = Local;
		return FReply::Handled();
	}
	const int32 Control = ControlAtLocal(Local);
	const int32 Hit = Control == INDEX_NONE ? StopAtLocal(Local) : INDEX_NONE;
	if (Hit != Hovered || Control != HoveredControl)
	{
		Hovered = Hit;
		HoveredControl = Control;
		Invalidate(EInvalidateWidgetReason::Paint);
	}
	return FReply::Unhandled();
}

FReply SWonderlandMapCanvas::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (MouseEvent.GetEffectingButton() != EKeys::LeftMouseButton)
	{
		return FReply::Unhandled();
	}
	const FVector2D Raw = MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition());
	bPressed = true;
	bDragged = false;
	PressLocal = FVector2f(static_cast<float>(Raw.X), static_cast<float>(Raw.Y));
	LastDragLocal = PressLocal;
	return FReply::Handled().CaptureMouse(SharedThis(this));
}

FReply SWonderlandMapCanvas::OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	if (MouseEvent.GetEffectingButton() != EKeys::LeftMouseButton || !bPressed)
	{
		return FReply::Unhandled();
	}
	bPressed = false;
	FReply Reply = FReply::Handled().ReleaseMouseCapture();
	if (bDragged)
	{
		bDragged = false;
		return Reply;
	}
	const FVector2D Raw = MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition());
	const FVector2f Local(static_cast<float>(Raw.X), static_cast<float>(Raw.Y));
	const FVector2f Size(static_cast<float>(MyGeometry.GetLocalSize().X), static_cast<float>(MyGeometry.GetLocalSize().Y));
	const int32 Control = ControlAtLocal(Local);
	if (Control == 0 || Control == 1)
	{
		ZoomAbout(Control == 0 ? Zoom * 1.6f : Zoom / 1.6f, Size * 0.5f, Size);
		return Reply;
	}
	if (Control == 2)
	{
		FitView();
		return Reply;
	}
	const int32 Hit = StopAtLocal(Local);
	if (Hit == INDEX_NONE)
	{
		return Reply;
	}
	OnPick.ExecuteIfBound(Hit);
	// A GROUP OPENS UP WHEN IT IS CLICKED: the place it is named for is selected, and the view closes in on the group
	// until its members stand apart.
	if (Layout.IsValidIndex(Hit) && Layout[Hit].Members > 0 && Zoom < MaxZoom)
	{
		FVector2D Sum = Stops[Hit].AnchorXY;
		int32 Count = 1;
		for (const FPlaced& Placed : Layout)
		{
			if (Placed.Leader == Hit)
			{
				Sum += Stops[Placed.Index].AnchorXY;
				++Count;
			}
		}
		Zoom = FMath::Min(Zoom * 2.5f, MaxZoom);
		ViewCentre = Sum / Count;
		ClampView();
		Invalidate(EInvalidateWidgetReason::Paint);
	}
	return Reply;
}

FReply SWonderlandMapCanvas::OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	const FVector2D Raw = MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition());
	const FVector2f Size(static_cast<float>(MyGeometry.GetLocalSize().X), static_cast<float>(MyGeometry.GetLocalSize().Y));
	ZoomAbout(Zoom * FMath::Pow(1.3f, MouseEvent.GetWheelDelta()), FVector2f(static_cast<float>(Raw.X), static_cast<float>(Raw.Y)), Size);
	return FReply::Handled();
}

void SWonderlandMapCanvas::OnMouseLeave(const FPointerEvent& MouseEvent)
{
	if (Hovered != INDEX_NONE || HoveredControl != INDEX_NONE)
	{
		Hovered = INDEX_NONE;
		HoveredControl = INDEX_NONE;
		Invalidate(EInvalidateWidgetReason::Paint);
	}
}

FCursorReply SWonderlandMapCanvas::OnCursorQuery(const FGeometry& MyGeometry, const FPointerEvent& CursorEvent) const
{
	if (bDragged)
	{
		return FCursorReply::Cursor(EMouseCursor::GrabHandClosed);
	}
	if (Hovered != INDEX_NONE || HoveredControl != INDEX_NONE)
	{
		return FCursorReply::Cursor(EMouseCursor::Hand);
	}
	return Zoom > 1.0001f ? FCursorReply::Cursor(EMouseCursor::GrabHand) : FCursorReply::Unhandled();
}

FString SWonderlandMapCanvas::DescribeLayout() const
{
	TArray<FString> Rows;
	for (const FPlaced& Placed : Layout)
	{
		if (!Stops.IsValidIndex(Placed.Index))
		{
			continue;
		}
		const FString Label = Placed.bLabel
			? FString::Printf(TEXT("[%s,%s,%s,%s]"), *JsonNumber(Placed.Label.Left), *JsonNumber(Placed.Label.Top),
				*JsonNumber(Placed.Label.Right - Placed.Label.Left), *JsonNumber(Placed.Label.Bottom - Placed.Label.Top))
			: FString(TEXT("null"));
		Rows.Add(FString::Printf(
			TEXT("{\"id\":\"%s\",\"tier\":%d,\"marker\":[%s,%s],\"radius\":%s,\"halo\":%s,\"on_screen\":%s,\"drawn\":%s,\"in_cluster\":%s,\"leader\":\"%s\",\"members\":%d,\"label\":%s,\"line\":%s}"),
			*Stops[Placed.Index].Row.Id.ToString(), Placed.Tier, *JsonNumber(Placed.Marker.X), *JsonNumber(Placed.Marker.Y), *JsonNumber(Placed.Radius),
			*JsonNumber(Placed.Halo),
			Placed.bOnScreen ? TEXT("true") : TEXT("false"), Placed.bDrawn ? TEXT("true") : TEXT("false"),
			Placed.Leader != INDEX_NONE ? TEXT("true") : TEXT("false"),
			Placed.Leader != INDEX_NONE && Stops.IsValidIndex(Placed.Leader) ? *Stops[Placed.Leader].Row.Id.ToString() : TEXT(""),
			Placed.Members, *Label,
			Placed.bLabel && Placed.bLeaderLine
				? *FString::Printf(TEXT("[%s,%s,%s,%s]"), *JsonNumber(Placed.LineFrom.X), *JsonNumber(Placed.LineFrom.Y), *JsonNumber(Placed.LineTo.X), *JsonNumber(Placed.LineTo.Y))
				: TEXT("null")));
	}
	const FString You = !bYouShown ? FString(TEXT("null")) : FString::Printf(TEXT("{\"marker\":[%s,%s],\"label\":%s}"),
		*JsonNumber(YouAt.X), *JsonNumber(YouAt.Y),
		bYouLabel ? *FString::Printf(TEXT("[%s,%s,%s,%s]"), *JsonNumber(YouLabel.Left), *JsonNumber(YouLabel.Top),
			*JsonNumber(YouLabel.Right - YouLabel.Left), *JsonNumber(YouLabel.Bottom - YouLabel.Top)) : TEXT("null"));
	return FString::Printf(TEXT("{\"size\":[%s,%s],\"centre\":[%s,%s],\"scale\":%s,\"zoom\":%s,\"abs\":[%s,%s],\"dpi\":%s,\"you\":%s,\"stops\":[%s]}"),
		*JsonNumber(LayoutSize.X), *JsonNumber(LayoutSize.Y), *JsonNumber(ViewCentre.X), *JsonNumber(ViewCentre.Y),
		*FString::Printf(TEXT("%.8f"), PixelsPerUnit(LayoutSize)), *JsonNumber(Zoom),
		*JsonNumber(LayoutAbsolute.X), *JsonNumber(LayoutAbsolute.Y), *JsonNumber(LayoutScale), *You, *FString::Join(Rows, TEXT(",")));
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
							SNew(STextBlock).Text(INVTEXT("M or Esc to close   \u00B7   scroll or + / \u2013 to zoom, drag to pan   \u00B7   click a place, then Teleport")).Font(WonderlandUi::Mono(10)).ColorAndOpacity(WonderlandUi::Dim())
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
		// a place chosen from the keyboard while the map is zoomed is brought onto the canvas
		Canvas->EnsureVisible(SelectedIndex);
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

void SWonderlandWorldMap::SetMapZoom(float Zoom)
{
	if (Canvas.IsValid())
	{
		Canvas->SetZoom(Zoom);
	}
}

float SWonderlandWorldMap::GetMapZoom() const
{
	return Canvas.IsValid() ? Canvas->GetZoom() : 1.0f;
}

void SWonderlandWorldMap::FitMap()
{
	if (Canvas.IsValid())
	{
		Canvas->FitView();
	}
}

bool SWonderlandWorldMap::CentreMapOn(FName Id)
{
	for (int32 Index = 0; Index < Stops.Num(); ++Index)
	{
		if (Stops[Index].Row.Id == Id && Canvas.IsValid())
		{
			Canvas->CentreOn(Index, 8.0f);
			return true;
		}
	}
	return false;
}

FString SWonderlandWorldMap::DescribeMapLayout() const
{
	return Canvas.IsValid() ? Canvas->DescribeLayout() : FString();
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
	// THE PLAN'S ZOOM FROM THE KEYBOARD: + and - (either row), Home for the whole world.
	if (Canvas.IsValid() && (Key == EKeys::Add || Key == EKeys::Equals))
	{
		Canvas->SetZoom(Canvas->GetZoom() * 1.6f);
		return FReply::Handled();
	}
	if (Canvas.IsValid() && (Key == EKeys::Subtract || Key == EKeys::Hyphen))
	{
		Canvas->SetZoom(Canvas->GetZoom() / 1.6f);
		return FReply::Handled();
	}
	if (Canvas.IsValid() && Key == EKeys::Home)
	{
		Canvas->FitView();
		return FReply::Handled();
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

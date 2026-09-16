// WONDERLAND — PIXEL DISPLAY TYPE, for the companion terminal titles.
//
// The founder's frame (2026-09-15) sets "> GPT 6 ASTRA" and "> CLAUDE CODE FABLE 5" in a chunky pixel display
// face. The engine carries no such font, and importing one would be a Content change in the world's asset lane,
// so the letters are drawn here as cells from a 5x7 table: each lit cell a box, a little wider than the grid so
// strokes read bold, over a soft shadow so gold holds its edge on the black panel.
//
// Upper-case letters, digits, space and a few marks. Lower case is drawn upper-case; anything else is a space.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

class WONDERLAND_API SWonderlandPixelText : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandPixelText)
		: _CellSize(3.4f)
		, _Color(FLinearColor::White)
		, _ShadowColor(FLinearColor(0.0f, 0.0f, 0.0f, 0.6f))
	{}
		/** An attribute: the companion titles are fixed, the mission strip's label changes every beat. */
		SLATE_ATTRIBUTE(FString, Text)
		/** Slate units per cell. A glyph is 5 cells wide and 7 tall, with one cell between glyphs. */
		SLATE_ATTRIBUTE(float, CellSize)
		SLATE_ARGUMENT(FLinearColor, Color)
		SLATE_ARGUMENT(FLinearColor, ShadowColor)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

private:
	TAttribute<FString> Text;
	TAttribute<float> CellSize;
	FLinearColor Color = FLinearColor::White;
	FLinearColor ShadowColor = FLinearColor::Black;
};

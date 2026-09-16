// WONDERLAND — PROJECT BRAIN LINE ICONS.
//
// The founder's Project Brain frame (2026-09-15) marks every panel, card and tile with a thin luminous line
// icon. The engine ships no icon font a game may use and an icon atlas would be a Content asset, so each glyph is
// a handful of strokes drawn in a unit box and scaled to the widget -- crisp at any size, tinted per surface.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

enum class EWonderlandBrainGlyph : uint8
{
	Folder,
	File,
	Person,
	Clock,
	Gear,
	Layers,
	Document,
	Nodes,
	Sparkle,
	Arrows,
	Pulse,
	People,
	Feather,
	Code,
	Magnifier,
	Lock,
	Target,
	Shield,
	Check,
	Link,
	Brain,
	// The HUD's bottom shortcuts (WonderlandNavBar.h) draw in the same hand as the Brain's panels.
	Agent,
	Missions,
	Commands,
	Menu,
	Wallet
};

class WONDERLAND_API SWonderlandBrainIcon : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandBrainIcon)
		: _Glyph(EWonderlandBrainGlyph::Folder)
		, _Size(22.0f)
		, _Color(FLinearColor::White)
		, _Thickness(1.6f)
	{}
		SLATE_ARGUMENT(EWonderlandBrainGlyph, Glyph)
		SLATE_ARGUMENT(float, Size)
		SLATE_ARGUMENT(FLinearColor, Color)
		SLATE_ARGUMENT(float, Thickness)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

private:
	EWonderlandBrainGlyph Glyph = EWonderlandBrainGlyph::Folder;
	float Size = 22.0f;
	FLinearColor Color = FLinearColor::White;
	float Thickness = 1.6f;
};

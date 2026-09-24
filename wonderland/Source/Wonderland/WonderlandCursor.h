// WONDERLAND — THE POINTER ITSELF.
//
// FOUNDER, 2026-09-24: "Add Wonderland cursor customization."
//
// DRAWN, NOT LOADED. A hardware cursor needs a .cur or .png shipped per platform and per size, and changing its
// colour would mean shipping another one; a Slate cursor is painted from the same accent every other control
// reads, so the founder's theme moves the pointer with everything else and nothing has to be authored.
//
// It is only ever SHOWN when asked for. An install that has not chosen a cursor keeps the operating system's,
// because a custom pointer that cannot be turned off is a worse default than the one the machine already has.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

/** How the Wonderland pointer is drawn. The founder picks one; each is painted, none is an asset. */
enum class EWonderlandCursorShape : uint8
{
	/** The operating system's own. Nothing is drawn and nothing is registered. */
	System,
	/** A clean arrow in the theme accent, with a dark edge so it reads on light stone and dark sky alike. */
	Arrow,
	/** The i.Wonder mark, small: a ring and the twin facing curves. */
	Mark,
	/** A precise ring with a centre dot, for pointing at something rather than at a button. */
	Ring,
};

/**
 * THE POINTER, PAINTED.
 *
 * A leaf widget rather than a UserWidget, so it needs no Blueprint asset and can be handed straight to
 * UGameViewportClient::SetSoftwareCursorWidget.
 */
class WONDERLAND_API SWonderlandCursor : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandCursor)
		: _Shape(EWonderlandCursorShape::Arrow), _Size(22.0f) {}
		SLATE_ATTRIBUTE(EWonderlandCursorShape, Shape)
		SLATE_ATTRIBUTE(float, Size)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual FVector2D ComputeDesiredSize(float) const override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle,
		bool bParentEnabled) const override;

private:
	TAttribute<EWonderlandCursorShape> Shape;
	TAttribute<float> Size;
};

namespace WonderlandCursor
{
	/** Read the founder's choice and register or clear the pointer on this viewport. Safe to call repeatedly. */
	WONDERLAND_API void Apply(class UGameViewportClient* Viewport);
	/** The shape currently chosen, for a proof to read back. */
	WONDERLAND_API EWonderlandCursorShape Chosen();
	WONDERLAND_API const TCHAR* NameOf(EWonderlandCursorShape InShape);
}

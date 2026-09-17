// WONDERLAND — THE LIVE PAGE: the real website, drawn inside the Wonder Web shell.
//
// This widget draws the frames the runtime's browser produces (WonderlandWonderWebLive.h) and sends back what the founder
// does to them: where they clicked in the page's own pixels, how far they scrolled, what they typed. It decides nothing
// and knows nothing about any site; it is a window onto a browser that is running somewhere else on this machine.
//
// WHAT IT SHOWS IS WHAT THE BROWSER RENDERED. The frame is drawn whole and centred, never stretched, so the page on
// screen is the page the browser laid out -- not a Wonderland impression of it.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

class UWonderlandWonderWebLiveSubsystem;

class WONDERLAND_API SWonderlandWonderWebLivePage : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWonderWebLivePage) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandWonderWebLiveSubsystem>, Live)
		/** Which window's page this draws. Several Wonder Webs are the point, so nothing here is the only page. */
		SLATE_ARGUMENT(FString, Tab)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float) const override;
	virtual bool SupportsKeyboardFocus() const override { return true; }

	virtual FReply OnMouseButtonDown(const FGeometry& Geometry, const FPointerEvent& Event) override;
	virtual FReply OnMouseWheel(const FGeometry& Geometry, const FPointerEvent& Event) override;
	virtual FReply OnKeyChar(const FGeometry& Geometry, const FCharacterEvent& Event) override;
	virtual FReply OnKeyDown(const FGeometry& Geometry, const FKeyEvent& Event) override;

	/** Where the page sits inside this widget, and how much it is scaled, so a click can be put back into page pixels. */
	void PageRect(const FGeometry& Geometry, FVector2D& OutOffset, float& OutScale) const;

private:
	TWeakObjectPtr<UWonderlandWonderWebLiveSubsystem> Live;
	FString Tab;
	/** The brush the frame is drawn through; its texture is replaced as frames arrive. */
	mutable FSlateBrush FrameBrush;
	mutable FSlateBrush GroundBrush;
};

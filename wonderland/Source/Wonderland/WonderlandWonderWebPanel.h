// WONDERLAND — THE WONDER WEB WINDOW, drawn from the founder's reference.
//
// A black window with one saturated yellow line: the Wonder mark and WONDER WEB, MY VIEW and the peers' tabs with their
// presence dots, back / forward / reload, the wonder.app address behind its lock, the big viewport, and the >_ TERMINAL
// strip with wonder@project:~$ (src/relay/ui/wonder-web/RelayWonderWeb.tsx is the browser rendering of the same
// projection, and its stylesheet the palette: --rww-line #FFD400 on --rww-ink #05050A).
//
// IT RENDERS A PROJECTION AND DECIDES NOTHING. Every enabled control, every tab's access, what the viewport shows and
// whether the terminal takes a keystroke are fields of the `FWonderWebSurface` the Wonder Web subsystem hands it; the
// widget draws them and forwards clicks to the subsystem, which refuses anything that surface does not allow.
//
// It is designed at a fixed 1536 x 1024, and the workspace layer draws it scaled to where its glass stands
// (WonderlandWonderWebScreen.h).
#pragma once

#include "CoreMinimal.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"
#include "WonderlandUiStyle.h"

class SBox;
class SEditableText;
class SHorizontalBox;
class SScrollBox;
class SVerticalBox;
class UWonderlandWonderWebSubsystem;
struct FWonderWebSurface;

/** THE WONDER WEB LOOK, shared by every Wonder Web window (the creation view, Julius Connect ...). */
namespace WonderWebLook
{
	/** --rww-line and --rww-ink: one saturated yellow on an unlit black. */
	inline FLinearColor Line(float A = 1.0f) { return WonderlandUi::Srgb(0xFF, 0xD4, 0x00, A); }
	inline FLinearColor Ink(float A = 1.0f)  { return WonderlandUi::Srgb(0x05, 0x05, 0x0A, A); }
	inline FLinearColor Fail(float A = 1.0f) { return WonderlandUi::Srgb(0xFF, 0x6B, 0x4A, A); }
	inline FLinearColor Good(float A = 1.0f) { return WonderlandUi::Srgb(0x3D, 0xDC, 0x97, A); }
	inline FSlateFontInfo Sans(int32 Size, bool bBold = false, int32 Spacing = 0) { return WonderlandUi::Sans(Size, bBold, Spacing); }
	inline FSlateFontInfo Mono(int32 Size) { return WonderlandUi::Mono(Size); }
}

/** Pixel Canvas's palette: the sample creation's own colours, not Wonder Web's. 0 is unpainted. */
namespace WonderWebCanvasLook
{
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

/** A control whose drawn centre is reported every frame, so the proof job can click it through the real input path. */
class WONDERLAND_API SWonderWebProbe : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderWebProbe) {}
		SLATE_DEFAULT_SLOT(FArguments, Content)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs, TFunction<void(const FVector2D&)> InReport)
	{
		Report = MoveTemp(InReport);
		ChildSlot[InArgs._Content.Widget];
	}

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override
	{
		if (Report)
		{
			Report(AllottedGeometry.GetAbsolutePositionAtCoordinates(FVector2D(0.5, 0.5)));
		}
	}

private:
	TFunction<void(const FVector2D&)> Report;
};

/** The line icons the window's chrome uses, drawn as strokes in a unit box so they stay crisp at any size. */
enum class EWonderWebGlyph : uint8
{
	WonderMark,
	Back,
	Forward,
	Reload,
	Lock,
	Star,
	Dots,
	Minimize,
	Maximize,
	Close,
	Play,
	Check,
	Trash,
	Plus,
	Prompt
};

class WONDERLAND_API SWonderWebGlyph : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderWebGlyph)
		: _Glyph(EWonderWebGlyph::WonderMark)
		, _Size(24.0f)
		, _Color(FLinearColor::White)
		, _Thickness(2.0f)
	{}
		SLATE_ARGUMENT(EWonderWebGlyph, Glyph)
		SLATE_ARGUMENT(float, Size)
		SLATE_ATTRIBUTE(FSlateColor, Color)
		SLATE_ARGUMENT(float, Thickness)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

private:
	EWonderWebGlyph Glyph = EWonderWebGlyph::WonderMark;
	float Size = 24.0f;
	TAttribute<FSlateColor> Color;
	float Thickness = 2.0f;
};

class WONDERLAND_API SWonderlandWonderWebPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWonderWebPanel) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandWonderWebSubsystem>, WonderWeb)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FSimpleDelegate, OnRequestProject)
		/** The window buttons: fold to a chip, and grow the focused window larger (and back). */
		SLATE_EVENT(FSimpleDelegate, OnRequestMinimize)
		SLATE_EVENT(FSimpleDelegate, OnRequestExpand)
		/** The window's menu: open Julius Connect beside this window. */
		SLATE_EVENT(FSimpleDelegate, OnRequestConnections)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	/** The window's design size; the in-world screen renders it at exactly this. */
	static FVector2D DesignSize() { return FVector2D(1536.0, 1024.0); }
	/** The title bar's height from the window's top, in window pixels: a press on its bare space picks the window up. */
	static float TitleBarHeight() { return 99.0f; }

	/**
	 * Where a named control sits in the window, in window pixels, from the last frame it was drawn ("tab:0", "close",
	 * "stop", "rebuild", "restart", "clear", "open-sample", "terminal", "cell:17", "paint:2" ...). False when it is not
	 * on screen. The proof job clicks these through the real input path.
	 */
	bool GetControlCentre(FName Control, FVector2D& OutCentre) const;

	/** The terminal line's text, for tests. */
	FString GetTerminalInput() const;

private:
	void Rebuild();
	TSharedRef<SWidget> MakeTabs(const FWonderWebSurface& Surface);
	TSharedRef<SWidget> MakeViewport(const FWonderWebSurface& Surface);
	TSharedRef<SWidget> MakeTerminalLines(const FWonderWebSurface& Surface);
	TSharedRef<SWidget> MakeCanvas(const FWonderWebSurface& Surface);
	TSharedRef<SWidget> ChromeButton(FName Id, EWonderWebGlyph Glyph, float GlyphSize, TFunction<bool()> IsEnabled, TFunction<void()> OnClick);
	/** Wrap a control so its drawn position is recorded under its name. */
	TSharedRef<SWidget> Probe(FName Id, TSharedRef<SWidget> Content);
	FString OwnerLabel(const FWonderWebSurface& Surface, const FString& UserId) const;

	TWeakObjectPtr<UWonderlandWonderWebSubsystem> WonderWeb;
	FSimpleDelegate OnRequestClose;
	FSimpleDelegate OnRequestProject;
	FSimpleDelegate OnRequestMinimize;
	FSimpleDelegate OnRequestExpand;
	FSimpleDelegate OnRequestConnections;

	int32 ShownRevision = -1;
	FString ShownSurfaceKey;
	TSharedPtr<SBox> TabsSlot;
	TSharedPtr<SBox> ViewportSlot;
	TSharedPtr<SBox> TerminalLinesSlot;
	TSharedPtr<SScrollBox> TerminalScroll;
	TSharedPtr<SEditableText> TerminalInput;

	/** Window-space geometry of every probed control, refreshed each frame it is drawn. */
	TMap<FName, FVector2D> ControlCentres;
	TMap<FName, double> ControlSeenAt;
	double Now = 0.0;
	/** Frames left before the terminal scrolls to its newest line: new lines must be laid out before the end is known. */
	int32 ScrollTerminalIn = 0;

	FSlateBrush WindowBrush;
	FSlateBrush LineBrush;
	FSlateBrush AddressBrush;
	FSlateBrush TabBrush;
	FSlateBrush TabActiveBrush;
	FSlateBrush TabHoverBrush;
	FSlateBrush PreviewBrush;
	FSlateBrush ActionBrush;
	FSlateBrush ActionHoverBrush;
	FSlateBrush PageBrush;
	FSlateBrush CellBrush;
	FSlateBrush ClearBrush;
	FSlateBrush DotBrush;
	FButtonStyle TabStyle;
	FButtonStyle TabActiveStyle;
	FButtonStyle IconStyle;
	FButtonStyle ActionStyle;
	FButtonStyle CellStyle;
	FEditableTextStyle InputStyle;
	TArray<FSlateBrush> PaintBrushes;
	TArray<FButtonStyle> PaintStyles;
};

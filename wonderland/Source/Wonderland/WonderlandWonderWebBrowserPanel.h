// WONDERLAND — THE WONDER WEB BROWSER WINDOW: Wonderland outside, the ordinary web inside.
//
// FOUNDER DIRECTION (2026-09-17): "Wonder Web outside = Wonderland black/yellow shell. Website inside = normal real web
// experience. Do NOT make the internal webpages look like fake sci-fi panels."
//
// So this window is two things, deliberately unalike:
//   THE SHELL is Wonder Web: the Wonder mark, WONDER WEB, the tab strip, the address bar, the window buttons, black with
//   one saturated yellow line -- and the badge that says the page is simulated, which is the shell's job to say.
//   THE PAGE is a website: white ground, dark text, blue links, a site bar, a profile, a photo grid, a post with
//   comments, search results, an inbox, an article, a cart. Nothing in there is Wonderland-styled.
//
// The page comes from the projection (WonderlandWonderWebBrowse.h); this widget draws it and decides nothing. Julius's
// own work in the browser -- opening the profile, typing the caption, publishing -- follows the Julius Connect task, so
// the page moves only as the capability gate allows.
#pragma once

#include "CoreMinimal.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"

class SBox;
class SScrollBox;
class SWonderlandWonderWebLivePage;
class SVerticalBox;
class UWonderlandWonderWebBrowseSubsystem;
class UWonderlandWonderWebLiveSubsystem;
class UWonderlandWonderWebSubsystem;
class UWonderlandJuliusConnectSubsystem;
struct FWonderWebBrowseTab;
struct FWonderWebPageBlock;

class WONDERLAND_API SWonderlandWonderWebBrowserPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWonderWebBrowserPanel) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem>, Browse)
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandJuliusConnectSubsystem>, Connect)
		/** The creation, so the post Julius publishes shows the picture that was actually painted. */
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandWonderWebSubsystem>, Creation)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FSimpleDelegate, OnRequestMinimize)
		SLATE_EVENT(FSimpleDelegate, OnRequestExpand)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	static FVector2D DesignSize() { return FVector2D(1536.0, 1024.0); }

	/** Where a named control sits, in window pixels, from the last frame it was drawn ("tab:social", "post", "close"). */
	bool GetControlCentre(FName Control, FVector2D& OutCentre) const;

	/**
	 * Where a point of the live page is drawn, in window pixels. The page belongs to somebody else's website and has no
	 * controls this build can name, so this is how a proof reaches a search box or a link on it.
	 */
	bool GetLivePagePoint(const FVector2D& PagePixel, FVector2D& OutWindowPixel) const;

private:
	void Rebuild();
	TSharedRef<SWidget> MakeTabs();
	TSharedRef<SWidget> MakePage(const FWonderWebBrowseTab& Tab);
	TSharedRef<SWidget> MakeBlock(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeSiteBar(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeProfile(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeGrid(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakePost(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeCompose(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeResults(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeList(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeArticle(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeCart(const FWonderWebPageBlock& Block);
	TSharedRef<SWidget> MakeFooter(const FWonderWebPageBlock& Block);
	/** Julius's post, as the page shows it once it is published. */
	TSharedRef<SWidget> MakeJuliusPost();
	/** The picture from Pixel Canvas, drawn as a post's image. */
	TSharedRef<SWidget> MakeCanvasPicture();
	TSharedRef<SWidget> Probe(FName Id, TSharedRef<SWidget> Content);
	/** A brush for a page colour, kept alive as long as the page it belongs to. */
	const FSlateBrush* PageTint(const FString& Hex, float Corner = 0.0f);

	TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem> Browse;
	/** The live browser, for real mode: it holds the frames and takes the input back. */
	TWeakObjectPtr<UWonderlandWonderWebLiveSubsystem> Live;
	TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> Connect;
	TWeakObjectPtr<UWonderlandWonderWebSubsystem> Creation;
	FSimpleDelegate OnRequestClose;
	FSimpleDelegate OnRequestMinimize;
	FSimpleDelegate OnRequestExpand;

	int32 ShownRevision = -1;
	FString ShownPageKey;
	TSharedPtr<SBox> TabsSlot;
	TSharedPtr<SBox> PageSlot;
	TSharedPtr<SScrollBox> PageScroll;

	TMap<FName, FVector2D> ControlCentres;
	TMap<FName, double> ControlSeenAt;
	double Now = 0.0;

	/**
	 * THE REAL PAGE. Real mode hands the page area to the live page, which draws the frames a real browser renders on this
	 * machine (WonderlandWonderWebLive.h) and sends back clicks, scrolling and typing. Made when real mode goes on, dropped
	 * when it goes off, so nothing keeps loading behind the sample pages.
	 */
	TSharedPtr<SWonderlandWonderWebLivePage> LivePage;
	FString ShownRealUrl;

	/** Brushes for the page being drawn; replaced with it. */
	TArray<TSharedPtr<FSlateBrush>> PageBrushes;

	FSlateBrush WindowBrush;
	FSlateBrush LineBrush;
	FSlateBrush AddressBrush;
	FSlateBrush TabBrush;
	FSlateBrush TabActiveBrush;
	FSlateBrush BadgeBrush;
	FSlateBrush PageBrush;
	FSlateBrush CardBrush;
	FSlateBrush SearchBrush;
	FSlateBrush ButtonBrush;
	FSlateBrush DividerBrush;
	FSlateBrush ClearBrush;
	FButtonStyle TabStyle;
	FButtonStyle TabActiveStyle;
	FButtonStyle IconStyle;
	FButtonStyle WebButtonStyle;
	/** One brush per Pixel Canvas colour, 0 unpainted. */
	TArray<FSlateBrush> PaintBrushes;
};

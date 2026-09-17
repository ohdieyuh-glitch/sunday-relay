#include "WonderlandWonderWebBrowserPanel.h"

#include "Brushes/SlateRoundedBoxBrush.h"
#include "Engine/GameInstance.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableText.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SUniformGridPanel.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandJuliusConnect.h"
#include "WonderlandUiStyle.h"
#include "WonderlandWonderWeb.h"
#include "WonderlandWonderWebBrowse.h"
#include "WonderlandWonderWebLive.h"
#include "WonderlandWonderWebLivePage.h"
#include "WonderlandWonderWebPanel.h"

using namespace WonderWebLook;

/**
 * THE PAGE'S OWN COLOURS. A website's, not Wonderland's: a white ground, near-black text, grey secondary text, a hairline
 * border, a blue link and a blue button. Nothing in here is yellow.
 */
namespace WebLook
{
	inline FLinearColor Page()      { return WonderlandUi::Srgb(0xFF, 0xFF, 0xFF); }
	inline FLinearColor Soft()      { return WonderlandUi::Srgb(0xFA, 0xFA, 0xFA); }
	inline FLinearColor Ink()       { return WonderlandUi::Srgb(0x26, 0x26, 0x26); }
	inline FLinearColor Grey()      { return WonderlandUi::Srgb(0x8E, 0x8E, 0x8E); }
	inline FLinearColor Hair()      { return WonderlandUi::Srgb(0xDB, 0xDB, 0xDB); }
	inline FLinearColor Link()      { return WonderlandUi::Srgb(0x1A, 0x0D, 0xAB); }
	inline FLinearColor UrlGreen()  { return WonderlandUi::Srgb(0x00, 0x66, 0x21); }
	inline FLinearColor Blue()      { return WonderlandUi::Srgb(0x00, 0x95, 0xF6); }
	inline FSlateFontInfo Sans(int32 Size, bool bBold = false, int32 Spacing = 0) { return WonderlandUi::Sans(Size, bBold, Spacing); }
}

/* ==================================================================== the window */

void SWonderlandWonderWebBrowserPanel::Construct(const FArguments& InArgs)
{
	Browse = InArgs._Browse;
	Connect = InArgs._Connect;
	Creation = InArgs._Creation;
	LiveTab = InArgs._LiveTab.IsEmpty() ? FString(TEXT("browser")) : InArgs._LiveTab;
	if (UWonderlandWonderWebBrowseSubsystem* Pages = Browse.Get())
	{
		if (UGameInstance* GameInstance = Pages->GetGameInstance())
		{
			Live = GameInstance->GetSubsystem<UWonderlandWonderWebLiveSubsystem>();
		}
	}
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestMinimize = InArgs._OnRequestMinimize;
	OnRequestExpand = InArgs._OnRequestExpand;

	// The shell: Wonderland's black and one saturated yellow.
	WindowBrush = FSlateRoundedBoxBrush(WonderWebLook::Ink(), 22.0f, WonderWebLook::Line(), 3.0f);
	LineBrush.DrawAs = ESlateBrushDrawType::Image;
	LineBrush.TintColor = FSlateColor(WonderWebLook::Line());
	AddressBrush = FSlateRoundedBoxBrush(WonderWebLook::Ink(), 9.0f, WonderWebLook::Line(0.85f), 2.0f);
	TabBrush = FSlateRoundedBoxBrush(WonderWebLook::Ink(), 10.0f, WonderWebLook::Line(0.45f), 2.0f);
	TabActiveBrush = FSlateRoundedBoxBrush(WonderWebLook::Line(0.12f), 10.0f, WonderWebLook::Line(), 2.5f);
	BadgeBrush = FSlateRoundedBoxBrush(WonderWebLook::Line(0.12f), 8.0f, WonderWebLook::Line(0.8f), 1.5f);
	ClearBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
	// The page: a website's.
	PageBrush = FSlateRoundedBoxBrush(WebLook::Page(), 0.0f, WebLook::Page(), 0.0f);
	CardBrush = FSlateRoundedBoxBrush(WebLook::Page(), 8.0f, WebLook::Hair(), 1.5f);
	SearchBrush = FSlateRoundedBoxBrush(WonderlandUi::Srgb(0xEF, 0xEF, 0xEF), 10.0f, WonderlandUi::Srgb(0xEF, 0xEF, 0xEF), 0.0f);
	ButtonBrush = FSlateRoundedBoxBrush(WebLook::Blue(), 8.0f, WebLook::Blue(), 0.0f);
	DividerBrush = FSlateRoundedBoxBrush(WebLook::Hair(), 0.0f, WebLook::Hair(), 0.0f);
	for (int32 Colour = 0; Colour <= UWonderlandWonderWebSubsystem::PaletteSize; ++Colour)
	{
		PaintBrushes.Add(FSlateRoundedBoxBrush(WonderWebCanvasLook::PaintColour(Colour), 2.0f, WonderWebCanvasLook::PaintColour(Colour), 0.0f));
	}

	TabStyle = FButtonStyle().SetNormal(TabBrush).SetHovered(TabActiveBrush).SetPressed(TabActiveBrush).SetDisabled(TabBrush)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));
	TabActiveStyle = FButtonStyle().SetNormal(TabActiveBrush).SetHovered(TabActiveBrush).SetPressed(TabActiveBrush).SetDisabled(TabActiveBrush)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));
	IconStyle = FButtonStyle().SetNormal(ClearBrush).SetHovered(FSlateRoundedBoxBrush(WonderWebLook::Line(0.14f), 8.0f, WonderWebLook::Line(0.0f), 0.0f))
		.SetPressed(FSlateRoundedBoxBrush(WonderWebLook::Line(0.26f), 8.0f, WonderWebLook::Line(0.0f), 0.0f)).SetDisabled(ClearBrush)
		.SetNormalPadding(FMargin(8.0f)).SetPressedPadding(FMargin(8.0f));
	WebButtonStyle = FButtonStyle().SetNormal(ButtonBrush).SetHovered(ButtonBrush).SetPressed(ButtonBrush).SetDisabled(ButtonBrush)
		.SetNormalPadding(FMargin(18.0f, 8.0f)).SetPressedPadding(FMargin(18.0f, 9.0f, 18.0f, 7.0f));

	const TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem> WeakBrowse = Browse;
	const TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> WeakConnect = Connect;
	auto ChromeButton = [this](FName Id, EWonderWebGlyph Glyph, TFunction<bool()> IsEnabled, TFunction<void()> OnClick)
	{
		return Probe(Id,
			SNew(SButton).ButtonStyle(&IconStyle)
			.IsEnabled_Lambda([IsEnabled]() { return IsEnabled(); })
			.OnClicked_Lambda([OnClick]() { OnClick(); return FReply::Handled(); })
			[
				SNew(SWonderWebGlyph).Glyph(Glyph).Size(30.0f).Thickness(2.6f)
				.Color_Lambda([IsEnabled]() { return FSlateColor(IsEnabled() ? WonderWebLook::Line() : WonderWebLook::Line(0.28f)); })
			]);
	};

	ChildSlot
	[
		SNew(SBox).WidthOverride(DesignSize().X).HeightOverride(DesignSize().Y)
		[
			SNew(SBorder).BorderImage(&WindowBrush).Padding(FMargin(3.0f))
			[
				SNew(SVerticalBox)
				// ---------------------------------------------------------------- the shell's title bar
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(96.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(28.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::WonderMark).Size(54.0f).Color(FSlateColor(WonderWebLook::Line()))
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 28.0f, 0.0f)
						[
							SNew(STextBlock).Text(INVTEXT("WONDER WEB")).Font(WonderWebLook::Sans(26, true, 160)).ColorAndOpacity(WonderWebLook::Line())
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
								ChromeButton(TEXT("minimize"), EWonderWebGlyph::Minimize, [this]() { return OnRequestMinimize.IsBound(); }, [this]() { OnRequestMinimize.ExecuteIfBound(); })
							]
							+ SHorizontalBox::Slot().AutoWidth().Padding(10.0f, 0.0f)
							[
								ChromeButton(TEXT("maximize"), EWonderWebGlyph::Maximize, [this]() { return OnRequestExpand.IsBound(); }, [this]() { OnRequestExpand.ExecuteIfBound(); })
							]
							+ SHorizontalBox::Slot().AutoWidth()
							[
								ChromeButton(TEXT("close"), EWonderWebGlyph::Close, []() { return true; }, [this]() { OnRequestClose.ExecuteIfBound(); })
							]
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				// ---------------------------------------------------------------- the address, and what the page is
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(78.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(22.0f, 0.0f, 8.0f, 0.0f)
						[
							// BACK, AND IT GOES BACK. The runtime's browser keeps this page's history, the way any browser does.
							ChromeButton(TEXT("back"), EWonderWebGlyph::Back,
								[this]() { return Live.IsValid() && Live->HasFrame(LiveTab); },
								[this]() { if (Live.IsValid()) { Live->SendBack(LiveTab); } })
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 16.0f, 0.0f)
						[
							ChromeButton(TEXT("reload"), EWonderWebGlyph::Reload,
								[this]() { return Live.IsValid() && !Live->GetLiveUrl(LiveTab).IsEmpty(); },
								[this]() { if (Live.IsValid()) { Live->Navigate(LiveTab, Live->GetLiveUrl(LiveTab)); } })
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(SBox).HeightOverride(54.0f)
							[
								SNew(SBorder).BorderImage(&AddressBrush).Padding(FMargin(20.0f, 0.0f)).VAlign(VAlign_Center)
								[
									SNew(SHorizontalBox)
									+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
									[
										SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Lock).Size(22.0f).Color(FSlateColor(WonderWebLook::Line())).Thickness(2.2f)
									]
									+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
									[
										// TYPE AN ADDRESS HERE, as in any browser: enter sends this window to it, and a host that is not allowed is
										// refused with the reason in the page area. It shows the page's own address the rest of the time.
										SAssignNew(AddressBox, SEditableText).Font(WonderWebLook::Sans(20)).ColorAndOpacity(WonderWebLook::Line())
										.SelectAllTextWhenFocused(true).ClearKeyboardFocusOnCommit(true)
										.OnTextCommitted(this, &SWonderlandWonderWebBrowserPanel::OnAddressCommitted)
										.Text_Lambda([WeakBrowse, WeakLive = Live, Watched = LiveTab]()
										{
											// THE ADDRESS IS THE PAGE'S OWN, wherever it came from: the founder's navigation, or the page Julius opened.
											if (WeakLive.IsValid() && WeakLive->HasFrame(Watched) && !WeakLive->GetLiveUrl(Watched).IsEmpty())
											{
												return FText::FromString(WeakLive->GetLiveUrl(Watched));
											}
											if (WeakBrowse.IsValid() && WeakBrowse->IsRealMode() && !WeakBrowse->GetRealUrl().IsEmpty())
											{
												return FText::FromString(WeakBrowse->GetRealUrl());
											}
											const FWonderWebBrowseTab* Tab = WeakBrowse.IsValid() ? WeakBrowse->GetSelected() : nullptr;
											return FText::FromString(Tab != nullptr ? Tab->Url : FString(TEXT("wonder.web")));
										})
									]
								]
							]
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(16.0f, 0.0f, 24.0f, 0.0f)
						[
							// THE SHELL SAYS WHAT THE PAGE IS. The page itself looks like the web; this badge is why that is honest.
							SNew(SBorder).BorderImage(&BadgeBrush).Padding(FMargin(14.0f, 6.0f))
							[
								SNew(STextBlock).Font(WonderWebLook::Sans(15, true, 120)).ColorAndOpacity(WonderWebLook::Line())
								.Text_Lambda([WeakBrowse, WeakLive = Live, Watched = LiveTab]()
								{
									// THE LABEL MATCHES WHAT IS ON SCREEN, always: a live frame means a live page, whoever opened it.
									if (WeakLive.IsValid() && WeakLive->HasFrame(Watched))
									{
										FString Host;
										UWonderlandWonderWebBrowseSubsystem::IsHostAllowed(WeakLive->GetLiveUrl(Watched), Host);
										return FText::FromString(FString::Printf(TEXT("LIVE PAGE  ·  %s%s"), *Host.ToUpper(),
											WeakLive->IsFollowing(Watched) ? TEXT("  ·  JULIUS IS BROWSING") : TEXT("")));
									}
									return FText::FromString(WeakBrowse.IsValid() ? WeakBrowse->PageLabel() : FString(TEXT("NO PAGES")));
								})
							]
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				// ---------------------------------------------------------------- the page: a website
				+ SVerticalBox::Slot().FillHeight(1.0f).Padding(14.0f, 12.0f)
				[
					SNew(SBorder).BorderImage(&PageBrush).Padding(FMargin(0.0f))
					[
						SAssignNew(PageSlot, SBox)
					]
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				// ---------------------------------------------------------------- what Julius is doing in here
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(86.0f).Padding(FMargin(24.0f, 10.0f))
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock).Font(WonderWebLook::Sans(18, true, 110)).ColorAndOpacity(WonderWebLook::Line()).AutoWrapText(true)
							.Text_Lambda([WeakBrowse]()
							{
								const FString Line = WeakBrowse.IsValid() ? WeakBrowse->GetJuliusLine() : FString();
								return FText::FromString(Line.IsEmpty() ? TEXT("JULIUS is not working in the browser right now") : Line);
							})
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
						[
							SNew(STextBlock).Font(WonderWebLook::Sans(15)).ColorAndOpacity(WonderWebLook::Line(0.7f)).AutoWrapText(true)
							.Text_Lambda([WeakConnect]()
							{
								if (!WeakConnect.IsValid() || WeakConnect->GetLink() != EJuliusConnectLink::Online)
								{
									return INVTEXT("Julius Connect is offline: the browser connection cannot be authorized, so nothing here can act.");
								}
								const FJuliusConnectTask* Task = WeakConnect->GetSurface().CurrentTask();
								if (Task == nullptr)
								{
									return INVTEXT("GOVERNED BROWSER  ·  Julius acts here only through an authorized connection");
								}
								return FText::FromString(FString::Printf(TEXT("%s  ·  %s  ·  step %d of %d  ·  %s"), *Task->Title, *Task->RunState,
									FMath::Min(Task->Progress + 1, Task->Total), Task->Total,
									Task->BlockedReason.IsEmpty() ? TEXT("governed browser authorized") : *Task->BlockedReason));
							})
						]
					]
				]
			]
		]
	];
	Rebuild();
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::Probe(FName Id, TSharedRef<SWidget> Content)
{
	const TWeakPtr<SWonderlandWonderWebBrowserPanel> WeakSelf = StaticCastSharedRef<SWonderlandWonderWebBrowserPanel>(AsShared());
	return SNew(SWonderWebProbe, [WeakSelf, Id](const FVector2D& Centre)
	{
		if (const TSharedPtr<SWonderlandWonderWebBrowserPanel> Self = WeakSelf.Pin())
		{
			Self->ControlCentres.Add(Id, Self->GetTickSpaceGeometry().AbsoluteToLocal(Centre));
			Self->ControlSeenAt.Add(Id, Self->Now);
		}
	})
	[
		Content
	];
}

bool SWonderlandWonderWebBrowserPanel::GetLivePagePoint(const FVector2D& PagePixel, FVector2D& OutWindowPixel) const
{
	if (!LivePage.IsValid() || !Live.IsValid() || !Live->HasFrame(LiveTab))
	{
		return false;
	}
	const FGeometry& PageGeometry = LivePage->GetCachedGeometry();
	FVector2D Offset;
	float Scale = 1.0f;
	LivePage->PageRect(PageGeometry, Offset, Scale);
	const FVector2D Absolute = PageGeometry.LocalToAbsolute(Offset + PagePixel * Scale);
	OutWindowPixel = GetTickSpaceGeometry().AbsoluteToLocal(Absolute);
	return true;
}

bool SWonderlandWonderWebBrowserPanel::IsPrimary() const
{
	return LiveTab == TEXT("browser");
}

const FWonderWebBrowseTab* SWonderlandWonderWebBrowserPanel::CurrentTab() const
{
	if (!Browse.IsValid())
	{
		return nullptr;
	}
	// THE FIRST WINDOW FOLLOWS THE SHARED SELECTION, because that is the one Julius's own story drives. Every other window
	// is the founder's to point wherever they like.
	return IsPrimary() ? Browse->GetSelected() : Browse->GetTab(OwnSite);
}

bool SWonderlandWonderWebBrowserPanel::GetControlCentre(FName Control, FVector2D& OutCentre) const
{
	const FVector2D* Centre = ControlCentres.Find(Control);
	const double* SeenAt = ControlSeenAt.Find(Control);
	if (Centre == nullptr || SeenAt == nullptr || Now - *SeenAt > 0.5)
	{
		return false;
	}
	OutCentre = *Centre;
	return true;
}

const FSlateBrush* SWonderlandWonderWebBrowserPanel::PageTint(const FString& Hex, float Corner)
{
	FColor Colour = FColor::FromHex(Hex.IsEmpty() ? TEXT("#E0E0E0") : Hex);
	const FLinearColor Linear = WonderlandUi::Srgb(Colour.R, Colour.G, Colour.B);
	TSharedPtr<FSlateBrush> Brush = MakeShared<FSlateRoundedBoxBrush>(Linear, Corner, Linear, 0.0f);
	PageBrushes.Add(Brush);
	return Brush.Get();
}

void SWonderlandWonderWebBrowserPanel::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	Now = InCurrentTime;
	if (Browse.IsValid() && (Browse->GetRevision() != ShownRevision || OwnSite != ShownOwnSite))
	{
		Rebuild();
	}
}

void SWonderlandWonderWebBrowserPanel::Rebuild()
{
	if (!Browse.IsValid())
	{
		return;
	}
	ShownRevision = Browse->GetRevision();
	if (TabsSlot.IsValid())
	{
		TabsSlot->SetContent(MakeTabs());
	}
	ShownOwnSite = OwnSite;
	const FWonderWebBrowseTab* Tab = CurrentTab();
	// THE REAL WEB, WHEN IT IS ASKED FOR (founder, 2026-09-17: "it should not be a simulation should be real"). Real mode
	// hands the page area to the live page: a real browser on this machine renders the real address, Wonderland draws its
	// frames, and what the founder does here goes back to it. With real mode off, nothing is loaded and the sample page is
	// drawn instead.
	const TWeakObjectPtr<UWonderlandWonderWebLiveSubsystem> WeakLive = Live;
	UWonderlandWonderWebLiveSubsystem* LiveWeb = Live.Get();
	if (Browse->IsRealMode())
	{
		// WHERE THIS WINDOW SHOULD BE. The first window follows the shared address, which is what Julius's story and
		// wl.WonderWeb.Go drive; the others are at whatever site they were pointed at.
		const FString Url = IsPrimary() ? Browse->GetRealUrl() : (Tab != nullptr ? Tab->RealUrl : FString());
		if (!LivePage.IsValid())
		{
			ShownPageKey.Reset();
			PageBrushes.Reset();
			ShownRealUrl.Reset();
			SAssignNew(LivePage, SWonderlandWonderWebLivePage).Live(Live).Tab(LiveTab);
			if (PageSlot.IsValid())
			{
				PageSlot->SetContent(
					SNew(SOverlay)
					+ SOverlay::Slot()[LivePage.ToSharedRef()]
					+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
					[
						// WHAT IS HAPPENING, IN PLAIN WORDS: waiting for the first frame, or the reason there is none.
						SNew(STextBlock).Font(WebLook::Sans(20)).ColorAndOpacity(WebLook::Grey()).Justification(ETextJustify::Center).AutoWrapText(true)
						.Visibility_Lambda([WeakLive, Watched = LiveTab]() { return WeakLive.IsValid() && WeakLive->HasFrame(Watched) ? EVisibility::Collapsed : EVisibility::HitTestInvisible; })
						.Text_Lambda([WeakLive, Watched = LiveTab]()
						{
							if (!WeakLive.IsValid())
							{
								return INVTEXT("The live browser is not available in this build.");
							}
							return FText::FromString(WeakLive->GetProblem(Watched).IsEmpty()
								? FString::Printf(TEXT("Loading %s…"), *WeakLive->GetLiveUrl(Watched))
								: WeakLive->GetProblem(Watched));
						})
					]);
			}
		}
		if (LiveWeb != nullptr && IsPrimary() && Browse->IsFollowingJulius())
		{
			// JULIUS IS DRIVING. The first window watches Julius's own tab: it navigates nothing, so what is on screen is the
			// page Julius was allowed to open, as it opens it.
			LiveWeb->Follow(UWonderlandWonderWebBrowseSubsystem::JuliusTab());
			ShownRealUrl.Reset();
		}
		else if (LiveWeb != nullptr && Url != ShownRealUrl)
		{
			ShownRealUrl = Url;
			if (Url.IsEmpty())
			{
				LiveWeb->CloseTab(LiveTab);
			}
			else
			{
				LiveWeb->Navigate(LiveTab, Url);
			}
		}
		return;
	}
	if (LivePage.IsValid())
	{
		// Out of real mode: the live page is dropped and the runtime is told to close its page, so nothing keeps loading
		// behind the sample ones.
		if (LiveWeb != nullptr)
		{
			LiveWeb->CloseTab(LiveTab);
		}
		LivePage.Reset();
		ShownRealUrl.Reset();
		ShownPageKey.Reset();
	}
	// The page is rebuilt when the tab changes, or when Julius's caption or post changes what is on it.
	const FString Key = FString::Printf(TEXT("%s|%s|%d"), Tab != nullptr ? *Tab->TabId : TEXT("-"), *Browse->GetCaption(), Browse->IsPosted() ? 1 : 0);
	if (PageSlot.IsValid() && Key != ShownPageKey)
	{
		ShownPageKey = Key;
		// The brushes of the page just drawn go with it; the new page brings its own.
		PageBrushes.Reset();
		PageSlot->SetContent(Tab != nullptr ? MakePage(*Tab) : SNullWidget::NullWidget);
	}
}

void SWonderlandWonderWebBrowserPanel::OnAddressCommitted(const FText& Text, ETextCommit::Type How)
{
	if (How != ETextCommit::OnEnter)
	{
		return;
	}
	FString Url = Text.ToString().TrimStartAndEnd();
	if (Url.IsEmpty())
	{
		return;
	}
	// A BARE HOST IS AN ADDRESS TOO: "en.wikipedia.org" means https, the way a browser's bar does.
	if (!Url.StartsWith(TEXT("http://")) && !Url.StartsWith(TEXT("https://")))
	{
		Url = TEXT("https://") + Url;
	}
	if (IsPrimary() && Browse.IsValid())
	{
		// The first window goes through the shared browse state, which is what Julius's story and the label follow.
		FString Refusal;
		if (!Browse->Navigate(Url, Refusal))
		{
			UE_LOG(LogTemp, Warning, TEXT("WLBROWSE address bar: %s"), *Refusal);
		}
		return;
	}
	if (Live.IsValid())
	{
		Live->Navigate(LiveTab, Url);
	}
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeTabs()
{
	const TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem> WeakBrowse = Browse;
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	if (!Browse.IsValid())
	{
		return Row;
	}
	const int32 Selected = IsPrimary() ? Browse->GetSelectedTab() : OwnSite;
	const TWeakPtr<SWonderlandWonderWebBrowserPanel> WeakSelf = StaticCastSharedRef<SWonderlandWonderWebBrowserPanel>(AsShared());
	const bool bPrimary = IsPrimary();
	for (int32 Index = 0; Index < Browse->GetModel().Tabs.Num(); ++Index)
	{
		const FWonderWebBrowseTab& Tab = Browse->GetModel().Tabs[Index];
		const bool bActive = Index == Selected;
		Row->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f).VAlign(VAlign_Bottom)
		[
			Probe(FName(*(TEXT("tab:") + Tab.TabId)),
				SNew(SBox).HeightOverride(62.0f).MinDesiredWidth(150.0f)
				[
					SNew(SButton)
					.ButtonStyle(bActive ? &TabActiveStyle : &TabStyle)
					.HAlign(HAlign_Center).VAlign(VAlign_Center)
					.OnClicked_Lambda([WeakBrowse, WeakSelf, Index, bPrimary]()
					{
						if (bPrimary)
						{
							if (WeakBrowse.IsValid())
							{
								WeakBrowse->SelectTabIndex(Index);
							}
						}
						else if (const TSharedPtr<SWonderlandWonderWebBrowserPanel> Self = WeakSelf.Pin())
						{
							// THIS WINDOW'S OWN CHOICE. Several Wonder Webs are the point: one window changing site does not
							// move the others.
							Self->OwnSite = Index;
							Self->Rebuild();
						}
						return FReply::Handled();
					})
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(14.0f, 0.0f, 10.0f, 0.0f)
						[
							// The site's initial, the way a favicon sits on a tab.
							SNew(SBox).WidthOverride(26.0f).HeightOverride(26.0f)
							[
								SNew(SBorder).BorderImage(&TabActiveBrush).HAlign(HAlign_Center).VAlign(VAlign_Center)
								[
									SNew(STextBlock).Text(FText::FromString(Tab.Letter)).Font(WonderWebLook::Sans(15, true)).ColorAndOpacity(WonderWebLook::Line())
								]
							]
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(STextBlock).Text(FText::FromString(Tab.Title)).Font(WonderWebLook::Sans(17, bActive, 110))
							.ColorAndOpacity(bActive ? WonderWebLook::Line() : WonderWebLook::Line(0.75f))
						]
					]
				])
		];
	}
	return Row;
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakePage(const FWonderWebBrowseTab& Tab)
{
	TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);
	for (const FWonderWebPageBlock& Block : Tab.Blocks)
	{
		Column->AddSlot().AutoHeight()[MakeBlock(Block)];
		// Julius's own post, in view straight under the profile, where a new post appears.
		if (Block.Kind == TEXT("profile") && Browse.IsValid() && Browse->IsPosted())
		{
			Column->AddSlot().AutoHeight()[MakeJuliusPost()];
		}
	}
	return SAssignNew(PageScroll, SScrollBox).ScrollBarVisibility(EVisibility::Collapsed) + SScrollBox::Slot()[Column];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeBlock(const FWonderWebPageBlock& Block)
{
	if (Block.Kind == TEXT("site_bar")) { return MakeSiteBar(Block); }
	if (Block.Kind == TEXT("profile"))  { return MakeProfile(Block); }
	if (Block.Kind == TEXT("grid"))     { return MakeGrid(Block); }
	if (Block.Kind == TEXT("post"))     { return MakePost(Block); }
	if (Block.Kind == TEXT("compose"))  { return MakeCompose(Block); }
	if (Block.Kind == TEXT("results"))  { return MakeResults(Block); }
	if (Block.Kind == TEXT("list"))     { return MakeList(Block); }
	if (Block.Kind == TEXT("article"))  { return MakeArticle(Block); }
	if (Block.Kind == TEXT("cart"))     { return MakeCart(Block); }
	return MakeFooter(Block);
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeSiteBar(const FWonderWebPageBlock& Block)
{
	TSharedRef<SHorizontalBox> Links = SNew(SHorizontalBox);
	for (const FString& Link : Block.Links)
	{
		Links->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 26.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Link)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Ink())
		];
	}
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SBox).HeightOverride(74.0f).Padding(FMargin(26.0f, 0.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 34.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Block.Brand)).Font(WebLook::Sans(28, true)).ColorAndOpacity(WebLook::Ink())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 34.0f, 0.0f)
				[
					SNew(SBox).WidthOverride(360.0f).HeightOverride(40.0f)
					[
						SNew(SBorder).BorderImage(&SearchBrush).Padding(FMargin(14.0f, 0.0f)).VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(FText::FromString(Block.Query)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Grey())
						]
					]
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).HAlign(HAlign_Right).VAlign(VAlign_Center)
				[
					Links
				]
			]
		]
		+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(1.5f)[SNew(SImage).Image(&DividerBrush)]];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeProfile(const FWonderWebPageBlock& Block)
{
	TSharedRef<SHorizontalBox> Stats = SNew(SHorizontalBox);
	for (const FString& Stat : Block.Stats)
	{
		Stats->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 34.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Stat)).Font(WebLook::Sans(18)).ColorAndOpacity(WebLook::Ink())
		];
	}
	TSharedRef<SVerticalBox> Bio = SNew(SVerticalBox);
	for (const FString& Line : Block.Lines)
	{
		Bio->AddSlot().AutoHeight()
		[
			SNew(STextBlock).Text(FText::FromString(Line)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Ink()).AutoWrapText(true)
		];
	}
	return SNew(SBox).Padding(FMargin(26.0f, 22.0f))
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Top).Padding(0.0f, 0.0f, 34.0f, 0.0f)
		[
			SNew(SBox).WidthOverride(130.0f).HeightOverride(130.0f)
			[
				SNew(SImage).Image(PageTint(Block.Tint, 65.0f))
			]
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Top)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 22.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Block.Title)).Font(WebLook::Sans(24)).ColorAndOpacity(WebLook::Ink())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SBox).HeightOverride(36.0f)
					[
						SNew(SBorder).BorderImage(&SearchBrush).Padding(FMargin(16.0f, 0.0f)).VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(FText::FromString(Block.Button)).Font(WebLook::Sans(16, true)).ColorAndOpacity(WebLook::Ink())
						]
					]
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)[Stats]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Block.Subtitle)).Font(WebLook::Sans(18, true)).ColorAndOpacity(WebLook::Ink())
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)[Bio]
		]
	];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeGrid(const FWonderWebPageBlock& Block)
{
	TSharedRef<SUniformGridPanel> Grid = SNew(SUniformGridPanel).SlotPadding(FMargin(3.0f));
	for (int32 Index = 0; Index < Block.Cells.Num(); ++Index)
	{
		Grid->AddSlot(Index % 3, Index / 3)
		[
			SNew(SBox).HeightOverride(150.0f)
			[
				SNew(SImage).Image(PageTint(Block.Cells[Index]))
			]
		];
	}
	return SNew(SBox).Padding(FMargin(26.0f, 0.0f, 26.0f, 22.0f))[Grid];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakePost(const FWonderWebPageBlock& Block)
{
	TSharedRef<SVerticalBox> Comments = SNew(SVerticalBox);
	for (const FWonderWebPageRow& Row : Block.Rows)
	{
		Comments->AddSlot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().Padding(0.0f, 0.0f, 10.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Row.Title)).Font(WebLook::Sans(17, true)).ColorAndOpacity(WebLook::Ink())
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Row.Snippet)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Ink()).AutoWrapText(true)
			]
		];
	}
	return SNew(SBox).Padding(FMargin(26.0f, 0.0f, 26.0f, 18.0f))
	[
		SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(0.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 12.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
				[
					SNew(SBox).WidthOverride(44.0f).HeightOverride(44.0f)[SNew(SImage).Image(PageTint(Block.Tint, 22.0f))]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Block.Title)).Font(WebLook::Sans(18, true)).ColorAndOpacity(WebLook::Ink())
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Block.Meta)).Font(WebLook::Sans(16)).ColorAndOpacity(WebLook::Grey())
				]
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SBox).HeightOverride(static_cast<float>(FMath::Max(Block.Height, 120)))[SNew(SImage).Image(PageTint(Block.Tint))]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 12.0f, 16.0f, 4.0f))
			[
				SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("%d likes"), Block.Likes))).Font(WebLook::Sans(17, true)).ColorAndOpacity(WebLook::Ink())
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 0.0f, 16.0f, 8.0f))
			[
				SNew(STextBlock).Text(FText::FromString(Block.Text)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Ink()).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 0.0f, 16.0f, 14.0f))[Comments]
		]
	];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeCompose(const FWonderWebPageBlock& Block)
{
	const TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem> WeakBrowse = Browse;
	return SNew(SBox).Padding(FMargin(26.0f, 0.0f, 26.0f, 22.0f))
	[
		SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(16.0f, 12.0f))
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				// What Julius has typed so far, or the placeholder -- an ordinary caption box.
				SNew(STextBlock).Font(WebLook::Sans(18)).AutoWrapText(true)
				.ColorAndOpacity_Lambda([WeakBrowse]() { return FSlateColor(WeakBrowse.IsValid() && !WeakBrowse->GetCaption().IsEmpty() ? WebLook::Ink() : WebLook::Grey()); })
				.Text_Lambda([WeakBrowse, Placeholder = Block.Text]()
				{
					const FString Typed = WeakBrowse.IsValid() ? WeakBrowse->GetCaption() : FString();
					return FText::FromString(Typed.IsEmpty() ? Placeholder : Typed);
				})
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(16.0f, 0.0f, 0.0f, 0.0f)
			[
				Probe(TEXT("post"),
					SNew(SButton).ButtonStyle(&WebButtonStyle)
					.OnClicked_Lambda([WeakBrowse]()
					{
						if (WeakBrowse.IsValid())
						{
							WeakBrowse->Publish();
						}
						return FReply::Handled();
					})
					[
						SNew(STextBlock).Text(FText::FromString(Block.Button)).Font(WebLook::Sans(17, true)).ColorAndOpacity(FLinearColor::White)
					])
			]
		]
	];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeResults(const FWonderWebPageBlock& Block)
{
	TSharedRef<SVerticalBox> Rows = SNew(SVerticalBox);
	Rows->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 18.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Block.Meta)).Font(WebLook::Sans(15)).ColorAndOpacity(WebLook::Grey())
	];
	for (const FWonderWebPageRow& Row : Block.Rows)
	{
		Rows->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 22.0f)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(FText::FromString(Row.Meta)).Font(WebLook::Sans(15)).ColorAndOpacity(WebLook::UrlGreen())
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(FText::FromString(Row.Title)).Font(WebLook::Sans(23)).ColorAndOpacity(WebLook::Link()).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(FText::FromString(Row.Snippet)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Grey()).AutoWrapText(true)
			]
		];
	}
	return SNew(SBox).Padding(FMargin(120.0f, 24.0f, 60.0f, 24.0f))[Rows];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeList(const FWonderWebPageBlock& Block)
{
	TSharedRef<SVerticalBox> Rows = SNew(SVerticalBox);
	Rows->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 14.0f)
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().Padding(0.0f, 0.0f, 16.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Block.Title)).Font(WebLook::Sans(26, true)).ColorAndOpacity(WebLook::Ink())
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Bottom)
		[
			SNew(STextBlock).Text(FText::FromString(Block.Meta)).Font(WebLook::Sans(16)).ColorAndOpacity(WebLook::Grey())
		]
	];
	for (const FWonderWebPageRow& Row : Block.Rows)
	{
		Rows->AddSlot().AutoHeight()
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 10.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 20.0f, 0.0f)
				[
					SNew(SBox).WidthOverride(240.0f)
					[
						SNew(STextBlock).Text(FText::FromString(Row.Title)).Font(WebLook::Sans(18, true)).ColorAndOpacity(WebLook::Ink())
					]
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Row.Snippet)).Font(WebLook::Sans(18)).ColorAndOpacity(WebLook::Ink())
					.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(20.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Row.Meta)).Font(WebLook::Sans(16)).ColorAndOpacity(WebLook::Grey())
				]
			]
			+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(1.5f)[SNew(SImage).Image(&DividerBrush)]]
		];
	}
	return SNew(SBox).Padding(FMargin(40.0f, 24.0f))[Rows];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeArticle(const FWonderWebPageBlock& Block)
{
	TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);
	Column->AddSlot().AutoHeight()
	[
		SNew(STextBlock).Text(FText::FromString(Block.Title)).Font(WebLook::Sans(36, true)).ColorAndOpacity(WebLook::Ink())
	];
	Column->AddSlot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 22.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Block.Subtitle)).Font(WebLook::Sans(16)).ColorAndOpacity(WebLook::Grey())
	];
	for (const FString& Line : Block.Lines)
	{
		Column->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 14.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Line)).Font(WebLook::Sans(19)).ColorAndOpacity(WebLook::Ink()).AutoWrapText(true)
		];
	}
	return SNew(SBox).Padding(FMargin(90.0f, 28.0f, 90.0f, 28.0f))[Column];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeCart(const FWonderWebPageBlock& Block)
{
	TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);
	Column->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 18.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Block.Title)).Font(WebLook::Sans(28, true)).ColorAndOpacity(WebLook::Ink())
	];
	for (const FWonderWebPageRow& Row : Block.Rows)
	{
		Column->AddSlot().AutoHeight()
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 12.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Row.Title)).Font(WebLook::Sans(19)).ColorAndOpacity(WebLook::Ink())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(20.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Row.Meta)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Grey())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Row.Snippet)).Font(WebLook::Sans(19, true)).ColorAndOpacity(WebLook::Ink())
				]
			]
			+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(1.5f)[SNew(SImage).Image(&DividerBrush)]]
		];
	}
	for (const FString& Line : Block.Lines)
	{
		Column->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Line)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Grey())
		];
	}
	Column->AddSlot().AutoHeight().Padding(0.0f, 20.0f, 0.0f, 0.0f)
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 24.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("Total %s"), *Block.Total))).Font(WebLook::Sans(22, true)).ColorAndOpacity(WebLook::Ink())
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
		[
			Probe(TEXT("order"),
				SNew(SButton).ButtonStyle(&WebButtonStyle)
				[
					SNew(STextBlock).Text(FText::FromString(Block.Button)).Font(WebLook::Sans(18, true)).ColorAndOpacity(FLinearColor::White)
				])
		]
	];
	return SNew(SBox).Padding(FMargin(60.0f, 26.0f))[Column];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeFooter(const FWonderWebPageBlock& Block)
{
	return SNew(SBox).Padding(FMargin(26.0f, 18.0f, 26.0f, 26.0f))
	[
		SNew(STextBlock).Text(FText::FromString(Block.Text)).Font(WebLook::Sans(15)).ColorAndOpacity(WebLook::Grey()).AutoWrapText(true)
	];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeCanvasPicture()
{
	// THE PICTURE THAT WAS PAINTED, not a stand-in: the cells of the creation's own canvas, as the post's image.
	const UWonderlandWonderWebSubsystem* Canvas = Creation.Get();
	if (Canvas == nullptr)
	{
		return SNew(SBox).HeightOverride(240.0f)[SNew(SImage).Image(PageTint(TEXT("#C9D6E3")))];
	}
	TSharedRef<SUniformGridPanel> Grid = SNew(SUniformGridPanel).SlotPadding(FMargin(1.0f));
	for (int32 Row = 0; Row < UWonderlandWonderWebSubsystem::CanvasRows; ++Row)
	{
		for (int32 Column = 0; Column < UWonderlandWonderWebSubsystem::CanvasColumns; ++Column)
		{
			const int32 Index = Row * UWonderlandWonderWebSubsystem::CanvasColumns + Column;
			const int32 Colour = FMath::Clamp<int32>(Canvas->GetCell(Index), 0, PaintBrushes.Num() - 1);
			Grid->AddSlot(Column, Row)[SNew(SImage).Image(&PaintBrushes[Colour])];
		}
	}
	return SNew(SBox).HeightOverride(250.0f).Padding(FMargin(0.0f))
	[
		SNew(SBorder).BorderImage(PageTint(TEXT("#F4F1E8"))).Padding(FMargin(10.0f))
		[
			Grid
		]
	];
}

TSharedRef<SWidget> SWonderlandWonderWebBrowserPanel::MakeJuliusPost()
{
	const TWeakObjectPtr<UWonderlandWonderWebBrowseSubsystem> WeakBrowse = Browse;
	const FString Caption = Browse.IsValid() ? Browse->GetCaption() : FString();
	const int32 Likes = Browse.IsValid() ? Browse->GetPostedLikes() : 0;
	return SNew(SBox).Padding(FMargin(26.0f, 0.0f, 26.0f, 18.0f))
	[
		SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(0.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 12.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
				[
					SNew(SBox).WidthOverride(44.0f).HeightOverride(44.0f)[SNew(SImage).Image(PageTint(TEXT("#E7D8C9"), 22.0f))]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
				[
					SNew(STextBlock).Text(INVTEXT("wonderland.studio")).Font(WebLook::Sans(18, true)).ColorAndOpacity(WebLook::Ink())
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(INVTEXT("just now")).Font(WebLook::Sans(16)).ColorAndOpacity(WebLook::Grey())
				]
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeCanvasPicture()
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 12.0f, 16.0f, 4.0f))
			[
				SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("%d likes"), Likes))).Font(WebLook::Sans(17, true)).ColorAndOpacity(WebLook::Ink())
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 0.0f, 16.0f, 10.0f))
			[
				SNew(STextBlock).Text(FText::FromString(Caption)).Font(WebLook::Sans(17)).ColorAndOpacity(WebLook::Ink()).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(16.0f, 0.0f, 16.0f, 14.0f))
			[
				// SAID ON THE POST ITSELF, not only in the shell: this went nowhere.
				SNew(STextBlock).Text(INVTEXT("SIMULATED POST · published by Julius in the development browser · nothing left this machine"))
				.Font(WebLook::Sans(14, true, 100)).ColorAndOpacity(WebLook::Grey()).AutoWrapText(true)
			]
		]
	];
}

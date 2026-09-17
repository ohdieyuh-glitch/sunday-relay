#include "WonderlandJuliusConnectPanel.h"

#include "Brushes/SlateRoundedBoxBrush.h"
#include "Framework/Application/SlateApplication.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableText.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandJuliusConnect.h"
#include "WonderlandUiStyle.h"
#include "WonderlandWonderWebPanel.h"

using namespace WonderWebLook;

namespace
{
	/** The state's colour: connected green, waiting on the user yellow, a refusal state warm red, the rest quiet. */
	FLinearColor StateColour(const FString& State)
	{
		if (State == TEXT("CONNECTED")) { return Good(); }
		if (State == TEXT("AUTHORIZATION_REQUIRED") || State == TEXT("CREDENTIAL_REQUIRED") || State == TEXT("CONNECTING")) { return Line(); }
		if (State == TEXT("REVOKED") || State == TEXT("FAILED") || State == TEXT("EXPIRED") || State == TEXT("RATE_LIMITED")
			|| State == TEXT("UNAVAILABLE") || State == TEXT("RECONNECT_REQUIRED")) { return Fail(); }
		return Line(0.55f);
	}

	FLinearColor RunColour(const FString& RunState)
	{
		if (RunState == TEXT("COMPLETED")) { return Good(); }
		if (RunState == TEXT("BLOCKED") || RunState == TEXT("FAILED")) { return Fail(); }
		return Line();
	}

	/** "2026-09-17T12:00:03.000Z" -> "12:00:03". */
	FString ClockOf(const FString& Iso)
	{
		int32 T = INDEX_NONE;
		return Iso.FindChar(TEXT('T'), T) && Iso.Len() >= T + 9 ? Iso.Mid(T + 1, 8) : Iso;
	}

	FString JoinOr(const TArray<FString>& Items, const TCHAR* Empty)
	{
		return Items.Num() > 0 ? FString::Join(Items, TEXT("  ")) : FString(Empty);
	}
}

/* ==================================================================== the window */

void SWonderlandJuliusConnectPanel::Construct(const FArguments& InArgs)
{
	Connect = InArgs._Connect;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestMinimize = InArgs._OnRequestMinimize;
	OnRequestExpand = InArgs._OnRequestExpand;

	WindowBrush = FSlateRoundedBoxBrush(Ink(), 22.0f, Line(), 3.0f);
	LineBrush.DrawAs = ESlateBrushDrawType::Image;
	LineBrush.TintColor = FSlateColor(Line());
	AddressBrush = FSlateRoundedBoxBrush(Ink(), 9.0f, Line(0.85f), 2.0f);
	TabActiveBrush = FSlateRoundedBoxBrush(Line(0.10f), 10.0f, Line(), 2.5f);
	NoticeBrush = FSlateRoundedBoxBrush(Line(0.08f), 6.0f, Line(0.30f), 1.0f);
	CardBrush = FSlateRoundedBoxBrush(Ink(), 12.0f, Line(0.35f), 1.5f);
	PromptBrush = FSlateRoundedBoxBrush(Line(0.07f), 14.0f, Line(), 3.0f);
	PillBrush = FSlateRoundedBoxBrush(FLinearColor::White, 8.0f, FLinearColor::White, 0.0f);
	BarBrush = FSlateRoundedBoxBrush(FLinearColor::White, 5.0f, FLinearColor::White, 0.0f);
	PrimaryBrush = FSlateRoundedBoxBrush(Line(), 10.0f, Line(), 2.0f);
	PrimaryHoverBrush = FSlateRoundedBoxBrush(Line(0.8f), 10.0f, Line(), 2.0f);
	ActionBrush = FSlateRoundedBoxBrush(Ink(), 10.0f, Line(0.9f), 2.0f);
	ActionHoverBrush = FSlateRoundedBoxBrush(Line(0.18f), 10.0f, Line(), 2.0f);
	ClearBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
	DotBrush = FSlateRoundedBoxBrush(FLinearColor::White, 7.0f, FLinearColor::White, 0.0f);

	IconStyle = FButtonStyle().SetNormal(ClearBrush).SetHovered(FSlateRoundedBoxBrush(Line(0.14f), 8.0f, Line(0.0f), 0.0f))
		.SetPressed(FSlateRoundedBoxBrush(Line(0.26f), 8.0f, Line(0.0f), 0.0f)).SetDisabled(ClearBrush)
		.SetNormalPadding(FMargin(8.0f)).SetPressedPadding(FMargin(8.0f));
	PrimaryStyle = FButtonStyle().SetNormal(PrimaryBrush).SetHovered(PrimaryHoverBrush).SetPressed(PrimaryHoverBrush).SetDisabled(ActionBrush)
		.SetNormalPadding(FMargin(26.0f, 12.0f)).SetPressedPadding(FMargin(26.0f, 13.0f, 26.0f, 11.0f));
	ActionStyle = FButtonStyle().SetNormal(ActionBrush).SetHovered(ActionHoverBrush).SetPressed(ActionHoverBrush).SetDisabled(ActionBrush)
		.SetNormalPadding(FMargin(20.0f, 10.0f)).SetPressedPadding(FMargin(20.0f, 11.0f, 20.0f, 9.0f));
	InputStyle = FCoreStyle::Get().GetWidgetStyle<FEditableTextStyle>("NormalEditableText");
	InputStyle.SetFont(Mono(19)).SetColorAndOpacity(FSlateColor(Line()));

	const TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> Weak = Connect;
	auto ChromeButton = [this](FName Id, EWonderWebGlyph Glyph, TFunction<bool()> IsEnabled, TFunction<void()> OnClick)
	{
		return Probe(Id,
			SNew(SButton).ButtonStyle(&IconStyle)
			.IsEnabled_Lambda([IsEnabled]() { return IsEnabled(); })
			.OnClicked_Lambda([OnClick]() { OnClick(); return FReply::Handled(); })
			[
				SNew(SWonderWebGlyph).Glyph(Glyph).Size(30.0f).Thickness(2.6f)
				.Color_Lambda([IsEnabled]() { return FSlateColor(IsEnabled() ? Line() : Line(0.28f)); })
			]);
	};
	const auto Online = [Weak]() { return Weak.IsValid() && Weak->GetLink() == EJuliusConnectLink::Online; };

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
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom)
						[
							Probe(TEXT("tab:0"),
								SNew(SBox).WidthOverride(300.0f).HeightOverride(62.0f)
								[
									SNew(SBorder).BorderImage(&TabActiveBrush).HAlign(HAlign_Center).VAlign(VAlign_Center)
									[
										SNew(SHorizontalBox)
										+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
										[
											SNew(STextBlock).Text(INVTEXT("JULIUS CONNECT")).Font(Sans(19, true, 120)).ColorAndOpacity(Line())
										]
										+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
										[
											SNew(SBox).WidthOverride(16.0f).HeightOverride(16.0f)
											[
												SNew(SImage).Image(&DotBrush)
												.ColorAndOpacity_Lambda([Online]() { return FSlateColor(Online() ? Good() : Fail()); })
											]
										]
									]
								])
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f)
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
				// ---------------------------------------------------------------- the address: where this is, and whether it is live
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(78.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(22.0f, 0.0f, 16.0f, 0.0f)
						[
							SNew(SBox).HeightOverride(54.0f)
							[
								SNew(SBorder).BorderImage(&AddressBrush).Padding(FMargin(22.0f, 0.0f)).VAlign(VAlign_Center)
								[
									SNew(SHorizontalBox)
									+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 16.0f, 0.0f)
									[
										SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Lock).Size(24.0f).Color(FSlateColor(Line())).Thickness(2.2f)
									]
									+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
									[
										SNew(STextBlock).Font(Sans(20)).ColorAndOpacity(Line())
										.Text_Lambda([Weak]()
										{
											const FString Project = Weak.IsValid() && !Weak->GetSurface().ProjectId.IsEmpty() ? Weak->GetSurface().ProjectId : TEXT("-");
											return FText::FromString(FString::Printf(TEXT("julius://connections   ·   project %s"), *Project));
										})
									]
								]
							]
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 24.0f, 0.0f)
						[
							SNew(SBorder).BorderImage(&PillBrush).Padding(FMargin(16.0f, 8.0f))
							.BorderBackgroundColor_Lambda([Online]() { return FSlateColor(Online() ? Good(0.22f) : Fail(0.25f)); })
							[
								SNew(STextBlock).Font(Sans(17, true, 120))
								.ColorAndOpacity_Lambda([Online]() { return FSlateColor(Online() ? Good() : Fail()); })
								.Text_Lambda([Online]() { return Online() ? INVTEXT("LIVE  ·  DEVELOPMENT SERVICE") : INVTEXT("OFFLINE"); })
							]
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				+ SVerticalBox::Slot().AutoHeight().Padding(18.0f, 10.0f, 18.0f, 0.0f)
				[
					SNew(SBorder).BorderImage(&NoticeBrush).Padding(FMargin(14.0f, 6.0f))
					[
						SNew(STextBlock).Font(Sans(14, true, 120)).ColorAndOpacity(Line(0.85f))
						.Text(INVTEXT("DEVELOPMENT CONNECTORS  ·  PROVIDER-FREE: NOTHING EXTERNAL IS CONTACTED  ·  NO CREDENTIAL IS EVER SHOWN HERE"))
					]
				]
				// ---------------------------------------------------------------- connections | the prompt or Julius's task
				+ SVerticalBox::Slot().FillHeight(1.0f).Padding(18.0f, 12.0f)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()
					[
						SNew(SHorizontalBox)
						.Visibility_Lambda([Online]() { return Online() ? EVisibility::Visible : EVisibility::Collapsed; })
						+ SHorizontalBox::Slot().FillWidth(0.54f).Padding(0.0f, 0.0f, 16.0f, 0.0f)
						[
							SAssignNew(ServicesSlot, SBox)
						]
						+ SHorizontalBox::Slot().FillWidth(0.46f)
						[
							SAssignNew(RightSlot, SBox)
						]
					]
					+ SOverlay::Slot()
					[
						SNew(SBox).Visibility_Lambda([Online]() { return Online() ? EVisibility::Collapsed : EVisibility::Visible; })
						[
							MakeOffline()
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight()[SNew(SBox).HeightOverride(2.5f)[SNew(SImage).Image(&LineBrush)]]
				// ---------------------------------------------------------------- audit | terminal
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SBox).HeightOverride(236.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(0.54f).Padding(28.0f, 12.0f, 16.0f, 12.0f)
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 6.0f)
							[
								SNew(STextBlock).Text(INVTEXT("AUDIT  ·  every use and decision, attributable, no secrets")).Font(Sans(16, true, 120)).ColorAndOpacity(Line())
							]
							+ SVerticalBox::Slot().FillHeight(1.0f)
							[
								SAssignNew(AuditSlot, SBox)
							]
						]
						+ SHorizontalBox::Slot().AutoWidth()
						[
							SNew(SBox).WidthOverride(2.0f)[SNew(SImage).Image(&LineBrush).ColorAndOpacity(Line(0.4f))]
						]
						+ SHorizontalBox::Slot().FillWidth(0.46f).Padding(20.0f, 12.0f, 24.0f, 12.0f)
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 4.0f)
							[
								SNew(SHorizontalBox)
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
								[
									SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Prompt).Size(22.0f).Color(FSlateColor(Line())).Thickness(2.4f)
								]
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
								[
									SNew(STextBlock).Text(INVTEXT("TERMINAL  ·  not a shell")).Font(Sans(16, true, 120)).ColorAndOpacity(Line())
								]
							]
							+ SVerticalBox::Slot().FillHeight(1.0f)
							[
								SAssignNew(TerminalScroll, SScrollBox).ScrollBarVisibility(EVisibility::Collapsed)
								+ SScrollBox::Slot()
								[
									SAssignNew(TerminalLinesSlot, SBox)
								]
							]
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
							[
								SNew(SHorizontalBox)
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
								[
									SNew(STextBlock).Text(INVTEXT("julius@connect:~$")).Font(Mono(19)).ColorAndOpacity(Line())
								]
								+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
								[
									Probe(TEXT("terminal"),
										SAssignNew(TerminalInput, SEditableText)
										.Style(&InputStyle)
										.HintText(INVTEXT("type help"))
										.ClearKeyboardFocusOnCommit(false)
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
										}))
								]
							]
						]
					]
				]
			]
		]
	];
	Rebuild();
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::Probe(FName Id, TSharedRef<SWidget> Content)
{
	const TWeakPtr<SWonderlandJuliusConnectPanel> WeakSelf = StaticCastSharedRef<SWonderlandJuliusConnectPanel>(AsShared());
	return SNew(SWonderWebProbe, [WeakSelf, Id](const FVector2D& Centre)
	{
		if (const TSharedPtr<SWonderlandJuliusConnectPanel> Self = WeakSelf.Pin())
		{
			Self->ControlCentres.Add(Id, Centre);
			Self->ControlSeenAt.Add(Id, Self->Now);
		}
	})
	[
		Content
	];
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::ActionButton(FName Id, const FText& Label, bool bPrimary, TFunction<void()> OnClick, int32 FontSize)
{
	return Probe(Id,
		SNew(SButton).ButtonStyle(bPrimary ? &PrimaryStyle : &ActionStyle)
		.OnClicked_Lambda([OnClick]() { OnClick(); return FReply::Handled(); })
		[
			SNew(STextBlock).Text(Label).Font(Sans(FontSize, true, 130)).ColorAndOpacity(bPrimary ? Ink() : Line())
		]);
}

bool SWonderlandJuliusConnectPanel::GetControlCentre(FName Control, FVector2D& OutCentre) const
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

void SWonderlandJuliusConnectPanel::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	Now = InCurrentTime;
	if (Connect.IsValid() && Connect->GetRevision() != ShownRevision)
	{
		Rebuild();
	}
}

void SWonderlandJuliusConnectPanel::Rebuild()
{
	if (!Connect.IsValid())
	{
		return;
	}
	ShownRevision = Connect->GetRevision();
	const FJuliusConnectSurface& Surface = Connect->GetSurface();

	// ONLY WHAT MOVED IS REBUILT, so a button being pressed is not pulled out from under the pointer by a step Julius took.
	FString Services;
	for (const FJuliusConnectService& Service : Surface.Services)
	{
		Services += FString::Printf(TEXT("%s|%s|%s|%s|%s|%s|%d%d%d;"), *Service.ConnectorId, *Service.State, *Service.AccountLabel,
			*FString::Join(Service.ProjectScope, TEXT(",")), *FString::Join(Service.Denied, TEXT(",")), *FString::Join(Service.Missions, TEXT(",")),
			Service.bCanRevoke ? 1 : 0, Service.bCanConnect ? 1 : 0, Service.bAwaitingUser ? 1 : 0);
	}
	if (ServicesSlot.IsValid() && Services != ServicesKey)
	{
		ServicesKey = Services;
		ServicesSlot->SetContent(MakeServices(Surface));
	}

	const FJuliusConnectTask* Task = Surface.CurrentTask();
	const FString Right = Surface.bHasPrompt
		? FString::Printf(TEXT("prompt|%s|%d|%d"), *Surface.Prompt.RequestId, bShowDetails ? 1 : 0, Surface.Setup.Num())
		: FString::Printf(TEXT("task|%s|%s|%d|%s|%d"), Task != nullptr ? *Task->TaskId : TEXT("-"), Task != nullptr ? *Task->RunState : TEXT("-"),
			Task != nullptr ? Task->Progress : -1, Task != nullptr && Task->Timeline.Num() > 0 ? *Task->Timeline.Last().At : TEXT("-"), Surface.Setup.Num());
	if (RightSlot.IsValid() && Right != RightKey)
	{
		RightKey = Right;
		RightSlot->SetContent(MakeRight(Surface));
	}

	const FString Audit = Surface.Audit.Num() > 0 ? Surface.Audit[0].At + Surface.Audit[0].Action + FString::FromInt(Surface.Audit.Num()) : TEXT("none");
	if (AuditSlot.IsValid() && Audit != AuditKey)
	{
		AuditKey = Audit;
		AuditSlot->SetContent(MakeAudit(Surface));
	}

	if (TerminalLinesSlot.IsValid() && ShownLines != Connect->GetTerminalLines().Num())
	{
		ShownLines = Connect->GetTerminalLines().Num();
		TerminalLinesSlot->SetContent(MakeTerminalLines());
		if (TerminalScroll.IsValid())
		{
			TerminalScroll->ScrollToEnd();
		}
	}
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::MakeOffline()
{
	const TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> Weak = Connect;
	return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
		[
			SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::WonderMark).Size(120.0f).Color(FSlateColor(Line(0.35f)))
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 24.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(34, true, 140)).ColorAndOpacity(Fail())
			.Text_Lambda([Weak]() { return Weak.IsValid() && Weak->GetLink() == EJuliusConnectLink::Connecting ? INVTEXT("REACHING JULIUS CONNECT ...") : INVTEXT("JULIUS CONNECT IS OFFLINE"); })
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 14.0f, 0.0f, 0.0f)
		[
			SNew(SBox).MaxDesiredWidth(1100.0f)
			[
				SNew(STextBlock).Font(Sans(20)).ColorAndOpacity(Line(0.85f)).AutoWrapText(true).Justification(ETextJustify::Center)
				.Text_Lambda([Weak]() { return FText::FromString(Weak.IsValid() ? Weak->GetProblem() : FString()); })
			]
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 18.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(18)).ColorAndOpacity(Line(0.7f))
			.Text(INVTEXT("No connection state is shown without the service: nothing here is remembered or invented. Start it with"))
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(SBorder).BorderImage(&NoticeBrush).Padding(FMargin(18.0f, 8.0f))
			[
				SNew(STextBlock).Font(Mono(19)).ColorAndOpacity(Line()).Text(FText::FromString(UWonderlandJuliusConnectSubsystem::StartCommand()))
			]
		]
	];
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::MakeServices(const FJuliusConnectSurface& Surface)
{
	TSharedRef<SVerticalBox> Column = SNew(SVerticalBox);
	Column->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 10.0f)
	[
		SNew(STextBlock).Text(INVTEXT("CONNECTIONS")).Font(Sans(22, true, 160)).ColorAndOpacity(Line())
	];
	TArray<FString> RealServices;
	for (const FJuliusConnectService& Service : Surface.Services)
	{
		if (Service.Kind == TEXT("DEVELOPMENT CONNECTOR"))
		{
			Column->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)[MakeServiceRow(Service)];
		}
		else if (Service.ConnectionId.IsEmpty())
		{
			RealServices.Add(Service.DisplayName);
		}
		else
		{
			Column->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 10.0f)[MakeServiceRow(Service)];
		}
	}
	if (RealServices.Num() > 0)
	{
		Column->AddSlot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(17)).ColorAndOpacity(Line(0.65f)).AutoWrapText(true)
			.Text(FText::FromString(FString::Printf(TEXT("REAL SERVICES  ·  %s  ·  INTEGRATION NOT BUILT: Julius will not claim to connect them"), *FString::Join(RealServices, TEXT(", ")))))
		];
	}
	return SNew(SScrollBox).ScrollBarVisibility(EVisibility::Collapsed) + SScrollBox::Slot()[Column];
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::MakeServiceRow(const FJuliusConnectService& Service)
{
	const TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> Weak = Connect;
	const FString ConnectorId = Service.ConnectorId;
	const FLinearColor Colour = StateColour(Service.State);
	const bool bLive = !Service.ConnectionId.IsEmpty();

	TSharedRef<SHorizontalBox> Buttons = SNew(SHorizontalBox);
	if (Service.bCanRevoke)
	{
		Buttons->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			ActionButton(FName(*(TEXT("revoke:") + ConnectorId)), INVTEXT("REVOKE"), false, [Weak, ConnectorId]() { if (Weak.IsValid()) { Weak->Revoke(ConnectorId); } }, 17)
		];
	}
	if (Service.bCanConnect)
	{
		Buttons->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			ActionButton(FName(*(TEXT("connect:") + ConnectorId)), FText::FromString(Service.ConnectLabel), false, [Weak, ConnectorId]() { if (Weak.IsValid()) { Weak->Connect(ConnectorId); } }, 17)
		];
	}
	if (bLive)
	{
		// TEST ACCESS asks the gate, on the record, whether Julius may use the connection's first capability right now.
		const FString Capability = Service.Granted.Num() > 0 ? Service.Granted[0] : (Service.Denied.Num() > 0 ? Service.Denied[0] : FString());
		if (!Capability.IsEmpty())
		{
			Buttons->AddSlot().AutoWidth()
			[
				ActionButton(FName(*(TEXT("test:") + ConnectorId)), INVTEXT("TEST ACCESS"), false, [Weak, ConnectorId, Capability]() { if (Weak.IsValid()) { Weak->TestAccess(ConnectorId, Capability); } }, 17)
			];
		}
	}

	TSharedRef<SVerticalBox> Detail = SNew(SVerticalBox);
	// THE FIRST LINE: the service, its state, how it is reached -- and, for a service with no connection yet, its button.
	// The name gives way (with an ellipsis) before the state or the button ever does.
	TSharedRef<SHorizontalBox> Heading = SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Service.DisplayName)).Font(Sans(23, true)).ColorAndOpacity(Line())
			.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, bLive ? 12.0f : 10.0f, 0.0f)
		[
			SNew(SBorder).BorderImage(&PillBrush).BorderBackgroundColor(FSlateColor(Colour.CopyWithNewOpacity(0.22f))).Padding(FMargin(12.0f, 4.0f))
			[
				SNew(STextBlock).Text(FText::FromString(Service.StateLabel)).Font(Sans(17, true, 100)).ColorAndOpacity(Colour)
			]
		];
	if (bLive)
	{
		Heading->AddSlot().AutoWidth().VAlign(VAlign_Center)
		[
			SNew(STextBlock).Text(FText::FromString(Service.RouteLabel)).Font(Sans(16, true, 100)).ColorAndOpacity(Line(0.6f))
		];
	}
	else
	{
		Heading->AddSlot().AutoWidth().VAlign(VAlign_Center)[Buttons];
	}
	Detail->AddSlot().AutoHeight()[Heading];
	if (!bLive && !Service.bReachable)
	{
		Detail->AddSlot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(17)).ColorAndOpacity(Line(0.7f)).AutoWrapText(true).Text(FText::FromString(Service.UnavailableReason))
		];
	}
	if (bLive)
	{
		Detail->AddSlot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(20, true)).ColorAndOpacity(Line()).AutoWrapText(true)
			.Text(FText::FromString(FString::Printf(TEXT("THIS PROJECT MAY USE  %s"), *JoinOr(Service.ProjectScope, TEXT("nothing")))))
		];
		Detail->AddSlot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			.Visibility(Service.Granted.Num() + Service.Denied.Num() > 0 ? EVisibility::Visible : EVisibility::Collapsed)
			+ SHorizontalBox::Slot().AutoWidth().Padding(0.0f, 0.0f, 22.0f, 0.0f)
			[
				SNew(STextBlock).Font(Mono(17)).ColorAndOpacity(Good())
				.Text(FText::FromString(FString::Printf(TEXT("GRANTED  %s"), *JoinOr(Service.Granted, TEXT("-")))))
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Font(Mono(17)).ColorAndOpacity(Fail(0.9f)).AutoWrapText(true)
				.Text(FText::FromString(FString::Printf(TEXT("DENIED  %s"), *JoinOr(Service.Denied, TEXT("-")))))
			]
		];
		Detail->AddSlot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(16)).ColorAndOpacity(Line(0.7f)).AutoWrapText(true)
			.Text_Lambda([Weak, ConnectorId]()
			{
				const FJuliusConnectService* Current = Weak.IsValid() ? Weak->GetSurface().FindService(ConnectorId) : nullptr;
				if (Current == nullptr)
				{
					return FText::GetEmpty();
				}
				return FText::FromString(FString::Printf(TEXT("%s  ·  missions %s  ·  %s  ·  last activity %s"),
					Current->AccountLabel.IsEmpty() ? TEXT("no account yet") : *Current->AccountLabel, *JoinOr(Current->Missions, TEXT("none")), *Current->HealthDetail,
					Current->LastActivityAt.IsEmpty() ? TEXT("-") : *ClockOf(Current->LastActivityAt)));
			})
		];
		Detail->AddSlot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)[Buttons];
	}

	return SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(18.0f, 10.0f))
		.BorderBackgroundColor(FSlateColor(bLive ? Colour.CopyWithNewOpacity(0.9f) : Line(0.35f)))
		[
			Detail
		];
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::MakeRight(const FJuliusConnectSurface& Surface)
{
	const TWeakObjectPtr<UWonderlandJuliusConnectSubsystem> Weak = Connect;
	if (Surface.bHasPrompt)
	{
		// THE TRUST BOUNDARY. Julius has done everything it can; this is the one step that is the user's.
		const FJuliusConnectPrompt& Prompt = Surface.Prompt;
		TSharedRef<SVerticalBox> Card = SNew(SVerticalBox);
		Card->AddSlot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
			[
				SNew(SBorder).BorderImage(&PillBrush).BorderBackgroundColor(FSlateColor(Fail(0.25f))).Padding(FMargin(12.0f, 4.0f))
				[
					SNew(STextBlock).Text(FText::FromString(Prompt.Banner)).Font(Sans(16, true, 130)).ColorAndOpacity(Fail())
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(Prompt.Kind)).Font(Sans(14, true, 120)).ColorAndOpacity(Line(0.7f)).OverflowPolicy(ETextOverflowPolicy::Ellipsis)
			]
		];
		Card->AddSlot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Prompt.Headline)).Font(Sans(29, true, 60)).ColorAndOpacity(Line()).AutoWrapText(true)
		];
		Card->AddSlot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("Needed for: %s"), *Prompt.NeededFor))).Font(Sans(19)).ColorAndOpacity(Line(0.9f)).AutoWrapText(true)
		];
		if (!bShowDetails)
		{
			for (const FJuliusConnectCapability& Capability : Prompt.Requested)
			{
				Card->AddSlot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
					[
						SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Check).Size(22.0f).Thickness(3.0f).Color(FSlateColor(Good()))
					]
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Font(Sans(20, true)).ColorAndOpacity(Good())
						.Text(FText::FromString(FString::Printf(TEXT("%s   REQUESTED"), *Capability.Label)))
					]
				];
			}
			for (const FJuliusConnectCapability& Capability : Prompt.NotRequested)
			{
				Card->AddSlot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
					[
						SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::Close).Size(20.0f).Thickness(2.6f).Color(FSlateColor(Line(0.55f)))
					]
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Font(Sans(17)).ColorAndOpacity(Line(0.55f))
						.Text(FText::FromString(FString::Printf(TEXT("%s   NOT REQUESTED"), *Capability.Label)))
					]
				];
			}
		}
		else
		{
			Card->AddSlot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(INVTEXT("JULIUS ALREADY DID")).Font(Sans(16, true, 130)).ColorAndOpacity(Line())
			];
			for (const FString& Done : Prompt.JuliusDid)
			{
				Card->AddSlot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock).Font(Sans(17)).ColorAndOpacity(Line(0.85f)).AutoWrapText(true).Text(FText::FromString(FString::Printf(TEXT("done  ·  %s"), *Done)))
				];
			}
			Card->AddSlot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Font(Mono(15)).ColorAndOpacity(Line(0.65f))
				.Text(FText::FromString(FString::Printf(TEXT("route %s  ·  mission %s  ·  request %s"), *Prompt.RouteLabel,
					Prompt.MissionId.IsEmpty() ? TEXT("-") : *Prompt.MissionId, *Prompt.RequestId)))
			];
		}
		Card->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(17)).ColorAndOpacity(Line(0.9f)).AutoWrapText(true)
			.Text(FText::FromString(FString::Printf(TEXT("YOUR STEP: %s"), *Prompt.HumanStep)))
		];
		Card->AddSlot().FillHeight(1.0f);
		Card->AddSlot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().Padding(0.0f, 0.0f, 10.0f, 0.0f)
			[
				ActionButton(TEXT("approve"), Prompt.bCredentialFlow ? INVTEXT("CONTINUE") : INVTEXT("CONNECT"), true, [Weak]() { if (Weak.IsValid()) { Weak->ApprovePrompt(); } }, 21)
			]
			+ SHorizontalBox::Slot().AutoWidth().Padding(0.0f, 0.0f, 12.0f, 0.0f)
			[
				ActionButton(TEXT("decline"), INVTEXT("NOT NOW"), false, [Weak]() { if (Weak.IsValid()) { Weak->DeclinePrompt(); } }, 20)
			]
			+ SHorizontalBox::Slot().AutoWidth()
			[
				ActionButton(TEXT("details"), bShowDetails ? INVTEXT("HIDE DETAILS") : INVTEXT("VIEW DETAILS"), false,
					[this]() { bShowDetails = !bShowDetails; RightKey.Reset(); ShownRevision = -1; }, 20)
			]
		];
		if (Surface.Setup.Num() > 1)
		{
			Card->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Font(Sans(15, true, 100)).ColorAndOpacity(Line(0.7f))
				.Text(FText::FromString(FString::Printf(TEXT("CONNECTION SETUP  ·  %d services waiting on you, this one first"), Surface.Setup.Num())))
			];
		}
		return SNew(SBorder).BorderImage(&PromptBrush).Padding(FMargin(24.0f, 18.0f))[Card];
	}

	// No decision waiting: what Julius is doing.
	const FJuliusConnectTask* Task = Surface.CurrentTask();
	TSharedRef<SVerticalBox> Card = SNew(SVerticalBox);
	Card->AddSlot().AutoHeight()
	[
		SNew(STextBlock).Text(INVTEXT("JULIUS")).Font(Sans(22, true, 160)).ColorAndOpacity(Line())
	];
	if (Task == nullptr)
	{
		Card->AddSlot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(20)).ColorAndOpacity(Line(0.85f)).AutoWrapText(true)
			.Text(INVTEXT("No task is using an external capability. Give Julius the design task: it needs a design-tool connection this project does not have yet."))
		];
		Card->AddSlot().AutoHeight().Padding(0.0f, 18.0f, 0.0f, 0.0f).HAlign(HAlign_Left)
		[
			ActionButton(TEXT("ask-task"), INVTEXT("ASK JULIUS: SYNC DESIGN TOKENS"), true, [Weak]() { if (Weak.IsValid()) { Weak->StartTask(TEXT("design-sync")); } }, 20)
		];
		Card->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Font(Sans(16)).ColorAndOpacity(Line(0.6f)).Text(INVTEXT("or type  julius sync design tokens  below"))
		];
	}
	else
	{
		const FLinearColor Run = RunColour(Task->RunState);
		const bool bDone = Task->RunState == TEXT("COMPLETED");
		Card->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Task->Title)).Font(Sans(25, true)).ColorAndOpacity(Line()).AutoWrapText(true)
		];
		Card->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
			[
				SNew(SBorder).BorderImage(&PillBrush).BorderBackgroundColor(FSlateColor(Run.CopyWithNewOpacity(0.22f))).Padding(FMargin(12.0f, 4.0f))
				[
					SNew(STextBlock).Text(FText::FromString(Task->RunState)).Font(Sans(17, true, 120)).ColorAndOpacity(Run)
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Font(Sans(17)).ColorAndOpacity(Line(0.85f)).AutoWrapText(true)
				.Text(FText::FromString(bDone ? FString::Printf(TEXT("all %d steps done"), Task->Total)
					: FString::Printf(TEXT("step %d of %d  ·  %s"), FMath::Min(Task->Progress + 1, Task->Total), Task->Total, *Task->StepLabel)))
			]
		];
		const float Fraction = Task->Total > 0 ? static_cast<float>(Task->Progress) / static_cast<float>(Task->Total) : 0.0f;
		Card->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(SBox).HeightOverride(12.0f)
			[
				SNew(SOverlay)
				+ SOverlay::Slot()[SNew(SImage).Image(&BarBrush).ColorAndOpacity(Line(0.15f))]
				+ SOverlay::Slot().HAlign(HAlign_Left)
				[
					SNew(SBox).WidthOverride(FMath::Max(12.0f, 600.0f * Fraction))[SNew(SImage).Image(&BarBrush).ColorAndOpacity(Run)]
				]
			]
		];
		if (!Task->BlockedReason.IsEmpty())
		{
			Card->AddSlot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Font(Sans(19, true)).ColorAndOpacity(Fail()).AutoWrapText(true)
				.Text(FText::FromString(FString::Printf(TEXT("%s  ·  waiting for %s"), *Task->BlockedReason, *JoinOr(Task->BlockedOn, TEXT("the connection")))))
			];
		}
		Card->AddSlot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 4.0f)
		[
			SNew(STextBlock).Text(INVTEXT("RUN")).Font(Sans(15, true, 130)).ColorAndOpacity(Line(0.7f))
		];
		for (int32 Index = FMath::Max(0, Task->Timeline.Num() - 5); Index < Task->Timeline.Num(); ++Index)
		{
			const FJuliusConnectTimelineRow& Row = Task->Timeline[Index];
			Card->AddSlot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Font(Mono(15)).ColorAndOpacity(Row.State == TEXT("BLOCKED") ? Fail(0.9f) : Line(0.85f)).AutoWrapText(true)
				.Text(FText::FromString(FString::Printf(TEXT("%s %-9s %s"), *ClockOf(Row.At), *Row.State, *Row.Summary)))
			];
		}
		if (bDone || Task->RunState == TEXT("FAILED"))
		{
			Card->AddSlot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f).HAlign(HAlign_Left)
			[
				ActionButton(TEXT("ask-task"), INVTEXT("RUN IT AGAIN"), false, [Weak]() { if (Weak.IsValid()) { Weak->StartTask(TEXT("design-sync")); } }, 18)
			];
		}
	}
	return SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(24.0f, 18.0f))[Card];
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::MakeAudit(const FJuliusConnectSurface& Surface)
{
	TSharedRef<SVerticalBox> Rows = SNew(SVerticalBox);
	if (Surface.Audit.Num() == 0)
	{
		Rows->AddSlot().AutoHeight()[SNew(STextBlock).Font(Mono(15)).ColorAndOpacity(Line(0.5f)).Text(INVTEXT("nothing has happened yet"))];
	}
	for (int32 Index = 0; Index < FMath::Min(7, Surface.Audit.Num()); ++Index)
	{
		const FJuliusConnectAuditRow& Row = Surface.Audit[Index];
		const FLinearColor Colour = Row.Outcome == TEXT("success") ? Line(0.9f) : (Row.Outcome == TEXT("pending") ? Line(0.6f) : Fail(0.9f));
		Rows->AddSlot().AutoHeight()
		[
			SNew(STextBlock).Font(Mono(15)).ColorAndOpacity(Colour).OverflowPolicy(ETextOverflowPolicy::Ellipsis)
			.Text(FText::FromString(FString::Printf(TEXT("%s %-6s %-22s %-24s %-14s %s"), *ClockOf(Row.At), *Row.Actor, *Row.Action, *Row.Service,
				Row.Capability.IsEmpty() ? TEXT("-") : *Row.Capability, *Row.Outcome)))
		];
	}
	return Rows;
}

TSharedRef<SWidget> SWonderlandJuliusConnectPanel::MakeTerminalLines()
{
	TSharedRef<SVerticalBox> Lines = SNew(SVerticalBox);
	if (!Connect.IsValid())
	{
		return Lines;
	}
	const TArray<UWonderlandJuliusConnectSubsystem::FLine>& All = Connect->GetTerminalLines();
	for (int32 Index = FMath::Max(0, All.Num() - 12); Index < All.Num(); ++Index)
	{
		Lines->AddSlot().AutoHeight()
		[
			SNew(STextBlock).Font(Mono(15)).AutoWrapText(true).Text(FText::FromString(All[Index].Text))
			.ColorAndOpacity(All[Index].bProblem ? Fail() : (All[Index].bTyped ? WonderlandUi::Cream() : Line(0.85f)))
		];
	}
	return Lines;
}

/* ==================================================================== a minimized window */

void SWonderWebWindowChip::Construct(const FArguments& InArgs)
{
	ChipBrush = FSlateRoundedBoxBrush(Ink(), 18.0f, Line(), 3.0f);
	ChipHoverBrush = FSlateRoundedBoxBrush(Line(0.16f), 18.0f, Line(), 3.0f);
	ChipStyle = FButtonStyle().SetNormal(ChipBrush).SetHovered(ChipHoverBrush).SetPressed(ChipHoverBrush).SetDisabled(ChipBrush)
		.SetNormalPadding(FMargin(20.0f, 0.0f)).SetPressedPadding(FMargin(20.0f, 0.0f));
	const FSimpleDelegate OnRestore = InArgs._OnRestore;
	ChildSlot
	[
		SNew(SBox).WidthOverride(DesignSize().X).HeightOverride(DesignSize().Y)
		[
			SNew(SButton).ButtonStyle(&ChipStyle).VAlign(VAlign_Center)
			.OnClicked_Lambda([OnRestore]() { OnRestore.ExecuteIfBound(); return FReply::Handled(); })
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 16.0f, 0.0f)
				[
					SNew(SWonderWebGlyph).Glyph(EWonderWebGlyph::WonderMark).Size(52.0f).Color(FSlateColor(Line()))
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(InArgs._Title).Font(Sans(26, true, 110)).ColorAndOpacity(Line())
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(InArgs._Status).Font(Sans(20, true, 60)).ColorAndOpacity(InArgs._StatusColor)
					]
				]
			]
		]
	];
}

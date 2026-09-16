#include "WonderlandHudPanels.h"

#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SNullWidget.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandBrainIcon.h"
#include "WonderlandMissionBeat.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandUiStyle.h"

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandHudPanelLook
{
	TSharedRef<SWidget> Header(EWonderlandBrainGlyph Glyph, const TCHAR* Title, const TCHAR* Subtitle, TSharedRef<SWidget> Trailing)
	{
		return SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
			[
				SNew(SWonderlandBrainIcon).Glyph(Glyph).Size(32.0f).Color(WonderlandUi::Gold()).Thickness(1.8f)
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Text(FText::FromString(Title)).Font(WonderlandUi::Sans(20, true, 140)).ColorAndOpacity(WonderlandUi::Ivory())
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Subtitle)).Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Dim())
				]
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				Trailing
			];
	}

	TSharedRef<SWidget> Row(const TCHAR* Key, TAttribute<FText> Value)
	{
		return SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SBox).WidthOverride(130.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Key)).Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(Value).Font(WonderlandUi::Mono(11)).ColorAndOpacity(WonderlandUi::Cream())
			];
	}
}

// ---------------------------------------------------------------------------------------------------------------- missions

SWonderlandMissionsPanel::SWonderlandMissionsPanel()
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::Gold(0.34f), 1.0f)
	, SectionBrush(WonderlandUi::Srgb(14, 16, 26, 0.72f), 10.0f, WonderlandUi::Ivory(0.10f), 1.0f)
	, PreviewBrush(WonderlandUi::Srgb(40, 20, 14, 0.80f), 6.0f, WonderlandUi::Coral(0.70f), 1.0f)
	, RuleBrush(WonderlandUi::Gold(0.22f), 0.0f, FLinearColor::Transparent, 0.0f)
	, HumanBrush(WonderlandUi::Srgb(44, 34, 12, 0.90f), 6.0f, WonderlandUi::Gold(0.95f), 1.2f)
	, ButtonNormal(WonderlandUi::Srgb(24, 26, 38, 0.90f), 7.0f, WonderlandUi::Ivory(0.24f), 1.0f)
	, ButtonHovered(WonderlandUi::Srgb(40, 34, 18, 0.95f), 7.0f, WonderlandUi::Gold(0.90f), 1.2f)
	, PipUnreached(FLinearColor::Transparent, 8.0f, WonderlandUi::Ivory(0.30f), 1.2f)
{
	PipLit.Reserve(WonderlandChakraSteps);
	PipReached.Reserve(WonderlandChakraSteps);
	for (int32 Step = 1; Step <= WonderlandChakraSteps; ++Step)
	{
		// The orb's own colours, so the ladder here and the crystal in the world can never disagree.
		const FLinearColor Colour = WonderlandChakraColour(WonderlandChakraForStep(Step));
		PipLit.Add(FSlateRoundedBoxBrush(Colour, 8.0f, WonderlandUi::Ivory(0.95f), 1.6f));
		PipReached.Add(FSlateRoundedBoxBrush(Colour.CopyWithNewOpacity(0.55f), 8.0f, FLinearColor::Transparent, 0.0f));
	}
}

void SWonderlandMissionsPanel::Construct(const FArguments& InArgs)
{
	using namespace WonderlandHudPanelLook;
	Missions = InArgs._Missions;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestNavigate = InArgs._OnRequestNavigate;
	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::MapScrim());
	ButtonStyle = FButtonStyle().SetNormal(ButtonNormal).SetHovered(ButtonHovered).SetPressed(ButtonHovered)
		.SetNormalPadding(FMargin(12.0f, 5.0f)).SetPressedPadding(FMargin(12.0f, 6.0f, 12.0f, 4.0f));

	const TWeakObjectPtr<UWonderlandMissionSubsystem> Weak = Missions;
	TSharedRef<SHorizontalBox> Ladder = SNew(SHorizontalBox);
	for (int32 Step = 1; Step <= WonderlandChakraSteps; ++Step)
	{
		Ladder->AddSlot().AutoWidth().Padding(Step == 1 ? 0.0f : 10.0f, 0.0f, 0.0f, 0.0f)
		[
			SNew(SBox).WidthOverride(26.0f).HeightOverride(16.0f)
			[
				SNew(SBorder)
				.Padding(0.0f)
				.BorderImage_Lambda([this, Weak, Step]() -> const FSlateBrush*
				{
					const int32 Current = Weak.IsValid() ? Weak->GetChakraStep() : 0;
					return Step == Current ? &PipLit[Step - 1] : (Step < Current ? &PipReached[Step - 1] : &PipUnreached);
				})
			]
		];
	}

	TSharedRef<SWidget> Running =
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(STextBlock).Text_Lambda([this]() { return FText::FromString(GetStageLine()); })
			.Font(WonderlandUi::Sans(24, true, 80)).ColorAndOpacity(WonderlandUi::Ivory())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 6.0f)
		[
			Ladder
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 16.0f)
		[
			SNew(STextBlock)
			.Text_Lambda([Weak]() { return FText::FromString(Weak.IsValid()
				? FString::Printf(TEXT("%s · %d / %d"), *Weak->GetChakraName().ToUpper(), Weak->GetChakraStep(), WonderlandChakraSteps) : FString()); })
			.Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::Dim())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)
		[
			Row(TEXT("MISSION"), TAttribute<FText>::CreateLambda([Weak]() {
				if (!Weak.IsValid()) { return FText::GetEmpty(); }
				FString Line = Weak->GetFoldMissionId().ToString();
				if (Weak->IsFixtureRunning())
				{
					Line += FString::Printf(TEXT("   (fixture %s, event %d of %d)"), *Weak->GetFixtureId().ToString(), Weak->GetFixtureProgress(), Weak->GetFixtureEventCount());
				}
				return FText::FromString(Line); }))
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)
		[
			Row(TEXT("RELAY DOG"), TAttribute<FText>::CreateLambda([Weak]() { return FText::FromString(Weak.IsValid() ? Weak->GetDogPerformingLabel() : FString()); }))
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)
		[
			Row(TEXT("COMPANIONS"), TAttribute<FText>::CreateLambda([Weak]() { return FText::FromString(Weak.IsValid() ? Weak->GetCompanionFormation() : FString()); }))
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 12.0f)
		[
			Row(TEXT("LAST EVENT"), TAttribute<FText>::CreateLambda([Weak]() {
				return FText::FromString(Weak.IsValid() ? FString::Printf(TEXT("%s  %s"), *Weak->GetLastEventType().ToString(), *Weak->GetLastEventVerdict()) : FString()); }))
		]
		+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Left)
		[
			SNew(SBorder)
			.BorderImage(&HumanBrush)
			.Padding(FMargin(10.0f, 5.0f))
			.Visibility_Lambda([Weak]() { return Weak.IsValid() && Weak->DoesBeatAskForAHuman(Weak->GetBeatId()) ? EVisibility::Visible : EVisibility::Collapsed; })
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("THIS STAGE IS WAITING ON A PERSON"))).Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::Gold())
			]
		];

	TSharedRef<SWidget> Idle =
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(STextBlock).Text(FText::FromString(TEXT("No mission is running."))).Font(WonderlandUi::Sans(20, true)).ColorAndOpacity(WonderlandUi::Ivory())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock)
			.Text(FText::FromString(TEXT("A Mission Contract appears only while a task runs through Julius, a Jhinn or an LLM Companion, and this panel follows it from red to violet.")))
			.Font(WonderlandUi::Sans(11)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
		];

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()[SNew(SBorder).BorderImage(&ScrimBrush)]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(40.0f)
		[
			SNew(SBox).WidthOverride(720.0f)
			[
				SNew(SBorder).BorderImage(&PanelBrush).Padding(FMargin(28.0f, 22.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						Header(EWonderlandBrainGlyph::Missions, TEXT("MISSIONS"), TEXT("The Mission Contract for the task that is running."),
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
							[
								SNew(SBorder).BorderImage(&PreviewBrush).Padding(FMargin(10.0f, 4.0f))
								[
									SNew(STextBlock).Text(FText::FromString(TEXT("DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION")))
									.Font(WonderlandUi::Sans(8, true, 120)).ColorAndOpacity(WonderlandUi::Coral())
								]
							]
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
							[
								SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false)
								.OnClicked_Lambda([this]() { OnRequestClose.ExecuteIfBound(); return FReply::Handled(); })
								[
									SNew(STextBlock).Text(FText::FromString(TEXT("CLOSE  ·  J"))).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::Cream())
								]
							])
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 16.0f)
					[
						SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush)]
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(20.0f, 18.0f))
						[
							SNew(SOverlay)
							+ SOverlay::Slot()
							[
								SNew(SBox).Visibility_Lambda([this]() { return IsShowingMission() ? EVisibility::Visible : EVisibility::Collapsed; })[Running]
							]
							+ SOverlay::Slot()
							[
								SNew(SBox).Visibility_Lambda([this]() { return IsShowingMission() ? EVisibility::Collapsed : EVisibility::Visible; })[Idle]
							]
						]
					]
				]
			]
		]
	];
}

bool SWonderlandMissionsPanel::IsShowingMission() const
{
	// The Contract's own rule: a mission is running exactly when the subsystem holds a contract for one.
	const UWonderlandMissionSubsystem* Subsystem = Missions.Get();
	return Subsystem != nullptr && Subsystem->IsOrbInWorld();
}

FString SWonderlandMissionsPanel::GetStageLine() const
{
	const UWonderlandMissionSubsystem* Subsystem = Missions.Get();
	return Subsystem != nullptr ? Subsystem->GetBeatLabel().ToUpper() : FString();
}

FReply SWonderlandMissionsPanel::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::Escape || Key == EKeys::J)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::T && InKeyEvent.IsControlDown())
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Agent);
		return FReply::Handled();
	}
	if (Key == EKeys::B)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Brain);
		return FReply::Handled();
	}
	if (Key == EKeys::C)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Commands);
		return FReply::Handled();
	}
	if (Key == EKeys::Tab)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Menu);
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

// ---------------------------------------------------------------------------------------------------------------- menu

SWonderlandMenuPanel::SWonderlandMenuPanel()
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::Gold(0.34f), 1.0f)
	, RuleBrush(WonderlandUi::Gold(0.22f), 0.0f, FLinearColor::Transparent, 0.0f)
	, RowNormal(WonderlandUi::Srgb(16, 18, 28, 0.80f), 9.0f, WonderlandUi::Ivory(0.14f), 1.0f)
	, RowHovered(WonderlandUi::Srgb(38, 32, 16, 0.92f), 9.0f, WonderlandUi::Gold(0.90f), 1.3f)
	, RowPressed(WonderlandUi::Srgb(54, 44, 20, 1.0f), 9.0f, WonderlandUi::Gold(1.0f), 1.5f)
{
}

void SWonderlandMenuPanel::Construct(const FArguments& InArgs)
{
	using namespace WonderlandHudPanelLook;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestMap = InArgs._OnRequestMap;
	OnRequestWallet = InArgs._OnRequestWallet;
	OnRequestNavigate = InArgs._OnRequestNavigate;
	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::MapScrim());
	RowStyle = FButtonStyle().SetNormal(RowNormal).SetHovered(RowHovered).SetPressed(RowPressed)
		.SetNormalPadding(FMargin(16.0f, 10.0f)).SetPressedPadding(FMargin(16.0f, 11.0f, 16.0f, 9.0f));

	struct FRow { EWonderlandBrainGlyph Glyph; const TCHAR* Title; const TCHAR* Key; TFunction<void()> Go; };
	TArray<FRow> Rows;
	Rows.Add({EWonderlandBrainGlyph::Arrows, TEXT("RESUME"), TEXT("TAB"), [this]() { OnRequestClose.ExecuteIfBound(); }});
	Rows.Add({EWonderlandBrainGlyph::Target, TEXT("WORLD MAP"), TEXT("M"), [this]() { OnRequestMap.ExecuteIfBound(); }});
	Rows.Add({EWonderlandBrainGlyph::Agent, TEXT("AGENT TERMINALS"), TEXT("CTRL T"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Agent); }});
	Rows.Add({EWonderlandBrainGlyph::Missions, TEXT("MISSIONS"), TEXT("J"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Missions); }});
	Rows.Add({EWonderlandBrainGlyph::Brain, TEXT("PROJECT BRAIN"), TEXT("B"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Brain); }});
	Rows.Add({EWonderlandBrainGlyph::Commands, TEXT("COMMAND PRESETS"), TEXT("C"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Commands); }});
	Rows.Add({EWonderlandBrainGlyph::Wallet, TEXT("WONDER WEB WALLET"), TEXT("SANDBOX"), [this]() { OnRequestWallet.ExecuteIfBound(); }});

	TSharedRef<SVerticalBox> List = SNew(SVerticalBox);
	for (const FRow& Row : Rows)
	{
		RowTitles.Add(Row.Title);
		const TFunction<void()> Go = Row.Go;
		List->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
		[
			SNew(SButton).ButtonStyle(&RowStyle).IsFocusable(false)
			.OnClicked_Lambda([Go]() { if (Go) { Go(); } return FReply::Handled(); })
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
				[
					SNew(SWonderlandBrainIcon).Glyph(Row.Glyph).Size(22.0f).Color(WonderlandUi::Ivory(0.90f)).Thickness(1.5f)
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Row.Title)).Font(WonderlandUi::Sans(13, true, 140)).ColorAndOpacity(WonderlandUi::Ivory())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Row.Key)).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::Gold(0.80f))
				]
			]
		];
	}

	// The controls, as the pawn and this HUD actually bind them.
	struct FControl { const TCHAR* Keys; const TCHAR* Does; };
	static const FControl Controls[] = {
		{TEXT("W A S D"), TEXT("Move")},
		{TEXT("SHIFT"), TEXT("Run")},
		{TEXT("CTRL"), TEXT("Walk")},
		{TEXT("SPACE"), TEXT("Jump")},
		{TEXT("MOUSE"), TEXT("Look")},
		{TEXT("HOLD ALT"), TEXT("Show the cursor to click the shortcuts")},
	};
	TSharedRef<SVerticalBox> ControlList = SNew(SVerticalBox);
	for (const FControl& Control : Controls)
	{
		ControlList->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 5.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()
			[
				SNew(SBox).WidthOverride(92.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Control.Keys)).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Control.Does)).Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Cream(0.85f))
			]
		];
	}

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()[SNew(SBorder).BorderImage(&ScrimBrush)]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(40.0f)
		[
			SNew(SBox).WidthOverride(760.0f)
			[
				SNew(SBorder).BorderImage(&PanelBrush).Padding(FMargin(28.0f, 22.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						Header(EWonderlandBrainGlyph::Menu, TEXT("MENU"), TEXT("Every panel in reach, and the controls."), SNullWidget::NullWidget)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 16.0f)
					[
						SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush)]
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(0.58f).Padding(0.0f, 0.0f, 24.0f, 0.0f)[List]
						+ SHorizontalBox::Slot().FillWidth(0.42f)
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 10.0f)
							[
								SNew(STextBlock).Text(FText::FromString(TEXT("CONTROLS"))).Font(WonderlandUi::Sans(10, true, 200)).ColorAndOpacity(WonderlandUi::Gold())
							]
							+ SVerticalBox::Slot().AutoHeight()[ControlList]
						]
					]
				]
			]
		]
	];
}

FReply SWonderlandMenuPanel::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::Escape || Key == EKeys::Tab)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::M)
	{
		OnRequestMap.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::T && InKeyEvent.IsControlDown())
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Agent);
		return FReply::Handled();
	}
	if (Key == EKeys::J)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Missions);
		return FReply::Handled();
	}
	if (Key == EKeys::B)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Brain);
		return FReply::Handled();
	}
	if (Key == EKeys::C)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Commands);
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

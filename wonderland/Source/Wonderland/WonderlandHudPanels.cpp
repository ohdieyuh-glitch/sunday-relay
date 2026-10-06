#include "WonderlandHudPanels.h"

#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SWidgetSwitcher.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SNullWidget.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandBrainIcon.h"
#include "WonderlandMissionBeat.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandUiStyle.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandCursor.h"
#include "WonderlandBeta.h"
#include "Engine/Engine.h"
#include "GameFramework/GameUserSettings.h"
#include "HAL/IConsoleManager.h"
#include "Misc/ConfigCacheIni.h"

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandHudPanelLook
{
	TSharedRef<SWidget> Header(EWonderlandBrainGlyph Glyph, const TCHAR* Title, const TCHAR* Subtitle, TSharedRef<SWidget> Trailing)
	{
		return SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
			[
				SNew(SWonderlandBrainIcon).Glyph(Glyph).Size(32.0f).Color(WonderlandUi::MenuGold()).Thickness(1.8f)
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
					SNew(STextBlock).Text(FText::FromString(Key)).Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::MenuGold(0.85f))
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
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::MenuGold(0.34f), 1.0f)
	, SectionBrush(WonderlandUi::Srgb(14, 16, 26, 0.72f), 10.0f, WonderlandUi::Ivory(0.10f), 1.0f)
	, PreviewBrush(WonderlandUi::Srgb(40, 20, 14, 0.80f), 6.0f, WonderlandUi::Coral(0.70f), 1.0f)
	, RuleBrush(WonderlandUi::MenuGold(0.22f), 0.0f, FLinearColor::Transparent, 0.0f)
	, HumanBrush(WonderlandUi::Srgb(44, 34, 12, 0.90f), 6.0f, WonderlandUi::MenuGold(0.95f), 1.2f)
	, ButtonNormal(WonderlandUi::Srgb(24, 26, 38, 0.90f), 7.0f, WonderlandUi::Ivory(0.24f), 1.0f)
	, ButtonHovered(WonderlandUi::Srgb(40, 34, 18, 0.95f), 7.0f, WonderlandUi::MenuGold(0.90f), 1.2f)
	, PipUnreached(WonderlandUi::Srgb(10, 12, 20, 0.85f), 8.0f, WonderlandUi::Ivory(0.30f), 1.2f)
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
				SNew(STextBlock).Text(FText::FromString(TEXT("THIS STAGE IS WAITING ON A PERSON"))).Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::MenuGold())
			]
		];

	// ---- WHAT THE PANEL SAYS WHEN THE FOLD HAS NO BEAT YET.
	//
	// BOTH LINES WERE FIXED TEXT AND ONE OF THEM WAS FALSE. Photographed while the world was following a live
	// Julius run, this panel read "No mission is running." A run had been adopted, the task set held it, and the
	// only surface the founder can see denied it. The fold was empty because an adopted run has produced no
	// event yet -- which is a statement about beats, not about whether a mission exists.
	//
	// SAME SLOTS, SAME SIZES, SAME ORDER: the founder's rule is that a content change is not a layout change,
	// so nothing moves. The two text blocks answer from the subsystem instead of from a literal.
	TSharedRef<SWidget> Idle =
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(STextBlock)
			.Text_Lambda([Weak]()
			{
				if (!Weak.IsValid())
				{
					return FText::FromString(TEXT("No mission is running."));
				}
				const FName Followed = Weak->GetFoldMissionId();
				if (Weak->IsFollowingRealRun() && !Followed.IsNone())
				{
					return FText::FromString(Followed.ToString());
				}
				return FText::FromString(TEXT("No mission is running."));
			})
			.Font(WonderlandUi::Sans(20, true)).ColorAndOpacity(WonderlandUi::Ivory())
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock)
			.Text_Lambda([Weak]()
			{
				// TRUE IN THIS BUILD (private beta): no AI service runs, so a contract the player writes stays QUEUED, and the
				// one way to see a contract play out is the simulation below, which says it is one.
				static const FString Waiting = TEXT("No AI service runs in this beta, so a Mission Contract you write stays QUEUED. "
					"Watch a SIMULATED mission to see how one unfolds: your Relay Dog performs each act at Castle Approach while "
					"this panel follows it from red to violet.");
				if (!Weak.IsValid() || !Weak->IsFollowingRealRun())
				{
					return FText::FromString(Waiting);
				}
				// WHAT JULIUS SAID, AND WHETHER IT HAS SAID ANYTHING. An adopted run whose state has not been
				// reported shows QUEUED and says the state is unreported, rather than presenting the enum's
				// default as something Julius asserted.
				const FString Run = Weak->GetFollowedRunId();
				const FString Said = Weak->GetFollowedJuliusState();
				// THE MAPPED STATE, NOT THE WORD QUEUED. I wrote QUEUED as a literal here half an hour after
				// removing three other literals that had gone stale, and it would have printed "QUEUED through
				// Julius ... Julius reports READY" -- a sentence contradicting itself in its own second clause.
				// The player-facing word (founder's decision 3: WORKING / Julius: EXECUTING), with Julius's raw
				// state beside it in the same sentence.
				const FString Mapped = Weak->GetFollowedStateLabel();
				return FText::FromString(FString::Printf(
					TEXT("%s through Julius. Run %s. Julius reports %s. No event has reached the contract yet, "
						"so the stage ladder below stays unlit until one does."),
					Mapped.IsEmpty() ? TEXT("Followed") : *Mapped.ToUpper(),
					Run.IsEmpty() ? TEXT("unnamed") : *Run,
					Said.IsEmpty() ? TEXT("no state yet") : *Said));
			})
			.Font(WonderlandUi::Sans(11)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
		]
		// A SIMULATED MISSION ON DEMAND (private beta, B18). The founder's mission showcase -- every act the Relay Dog
		// performs for a Mission Contract -- could be started only from the console, so a tester never saw it. This plays
		// the canonical simulation (Scenario D) through the same path the console uses, and the strip and this panel
		// keep saying SIMULATED for every second of it. Hidden while a real Julius run is followed.
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f).HAlign(HAlign_Left)
		[
			SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false)
			.Visibility_Lambda([Weak]() { return (Weak.IsValid() && !Weak->IsFollowingRealRun()) ? EVisibility::Visible : EVisibility::Collapsed; })
			.OnClicked_Lambda([this, Weak]()
			{
				if (UWonderlandMissionSubsystem* Subsystem = Weak.Get())
				{
					const bool bStarted = Subsystem->PlayScenario(FName(TEXT("D")), 10.0f);
					UE_LOG(LogTemp, Display, TEXT("WLMISSION simulated mission from the Missions panel: %s"), bStarted ? TEXT("started") : TEXT("REFUSED"));
					if (bStarted)
					{
						OnRequestClose.ExecuteIfBound();
					}
				}
				return FReply::Handled();
			})
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("WATCH A SIMULATED MISSION  ·  NO AI RUNS"))).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::Cream())
			]
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
									// THE SAME BANNER THE STRIP DRAWS, from the same accessor, so the two can never
									// disagree. They did: this sentence was a literal here and a literal again in
									// WonderlandMissionSubsystem.cpp, and both claimed a simulation over a live run.
									SNew(STextBlock)
									.Text_Lambda([Weak]()
									{
										// THE BADGE SPELLING, NOT THE BANNER: this one shares a row with the subtitle and
										// was cutting it off mid-word. Same claim, run id elided, full id in the
										// contract body an inch below. See GetProvenanceBadge.
										return Weak.IsValid() ? FText::FromString(Weak->GetProvenanceBadge()) : FText::GetEmpty();
									})
									.Font(WonderlandUi::Sans(8, true, 120))
									.ColorAndOpacity_Lambda([Weak]()
									{
										// Coral for a preview, gold for a real run: the colour carries the same claim as
										// the words, so a glance is not misled by a badge that is always the warning one.
										return (Weak.IsValid() && Weak->IsFollowingRealRun())
											? WonderlandUi::MenuGold() : WonderlandUi::Coral();
									})
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
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::MenuGold(0.34f), 1.0f)
	, RuleBrush(WonderlandUi::MenuGold(0.22f), 0.0f, FLinearColor::Transparent, 0.0f)
	, RowNormal(WonderlandUi::Srgb(16, 18, 28, 0.80f), 9.0f, WonderlandUi::Ivory(0.14f), 1.0f)
	, RowHovered(WonderlandUi::Srgb(38, 32, 16, 0.92f), 9.0f, WonderlandUi::MenuGold(0.90f), 1.3f)
	, RowPressed(WonderlandUi::Srgb(54, 44, 20, 1.0f), 9.0f, WonderlandUi::MenuGold(1.0f), 1.5f)
	, SwatchBrush(FLinearColor::White, 4.0f, FLinearColor(0.0f, 0.0f, 0.0f, 0.35f), 1.0f)
	, SwatchRingBrush(FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 5.0f, FLinearColor::White, 1.8f)
	, TabOnBrush(WonderlandUi::Srgb(46, 38, 16, 0.95f), 8.0f, WonderlandUi::MenuGold(1.0f), 1.3f)
	, TabOffBrush(WonderlandUi::Srgb(16, 18, 28, 0.70f), 8.0f, WonderlandUi::Ivory(0.16f), 1.0f)
{
	SwatchStyle = FButtonStyle()
		.SetNormal(FSlateNoResource()).SetHovered(FSlateNoResource()).SetPressed(FSlateNoResource())
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));
	TabStyle = FButtonStyle()
		.SetNormal(TabOffBrush).SetHovered(TabOnBrush).SetPressed(TabOnBrush)
		.SetNormalPadding(FMargin(16.0f, 7.0f)).SetPressedPadding(FMargin(16.0f, 7.0f));
}

/* ------------------------------------------------------------------ THE COLORS PAGE.
 *
 * FOUNDER, 2026-09-25, four separate requests that are one feature:
 *
 *   MENU -- TERMINAL COLOR CUSTOMIZATION, for (A) the Julius Live Terminal and (B) the AI Companion terminals,
 *   "not only through the console".
 *   MENU COLOR/THEME CUSTOMIZATION -- a Menu theme that moves "the intentional accent surfaces WITHOUT making
 *   text unreadable", and does not "indiscriminately tint every element".
 *   MENU -- MASCOT COLOR CUSTOMIZATION -- PRIMARY the body, SECONDARY the Relay Dog's eyes.
 *   MENU -- AI COMPANION COLOR CUSTOMIZATION -- separate from the mascot, never coupled to a Sub-Agent Cub.
 *
 * And, over all four: the SAME canonical state the Wardrobe writes. Every row here reads and writes
 * UWonderlandMascotStyleSettings and applies through WonderlandMascotStyle::SaveAndApply, which is what the
 * Wardrobe's own swatches call -- so the two are not two systems that agree, they are one system.
 *
 * READABILITY IS PROTECTED BY WHAT IS NOT HERE. No row writes a background or a body-text colour. The Menu
 * theme moves accents -- headings, the key hints, the chosen tab -- and the words stay ivory whatever is picked.
 */
TSharedRef<SWidget> SWonderlandMenuPanel::MakeColourRow(const TCHAR* Label, const TCHAR* Note,
	TFunction<FLinearColor()> Read, TFunction<void(FLinearColor)> Write, int32 Keyed)
{
	TSharedRef<SHorizontalBox> Chips = SNew(SHorizontalBox);
	// 1 the MASCOT PRIMARY, 2 the MASCOT STRIPS: both offer DEFAULT, a true WHITE and BLACK, then the shared set
	const bool bMascotPrimary = Keyed == 1;
	const bool bMascotStrip = Keyed == 2;
	for (const TPair<FName, FLinearColor>& Swatch : (bMascotPrimary || bMascotStrip) ? WonderlandMascotStyle::PrimaryPalette() : WonderlandMascotStyle::Palette())
	{
		const FLinearColor Colour = Swatch.Value;
		const FName Key = Swatch.Key;
		// THE MASCOT PRIMARY AND STRIPS KNOW THEIR SWATCH, not just its colour: DEFAULT and WHITE are both (1,1,1).
		TFunction<bool()> IsOn = bMascotPrimary
			? TFunction<bool()>([Key, Colour]() { return WonderlandMascotStyle::IsMascotPrimaryOn(Key, Colour); })
			: bMascotStrip
			? TFunction<bool()>([Key, Colour]() { return WonderlandMascotStyle::IsMascotStripOn(Key, Colour); })
			: TFunction<bool()>([Colour, Read]() { return Read && Read().Equals(Colour, 0.01f); });
		Chips->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 5.0f, 0.0f)
		[
			SNew(SButton).ButtonStyle(&SwatchStyle).IsFocusable(false)
			.ToolTipText(FText::FromName(Swatch.Key))
			.OnClicked_Lambda([Colour, Key, Write, bMascotPrimary, bMascotStrip]()
			{
				if (bMascotPrimary)
				{
					WonderlandMascotStyle::PickMascotPrimary(Key, Colour);   // the state, its file, SaveAndApply
					return FReply::Handled();
				}
				if (bMascotStrip)
				{
					WonderlandMascotStyle::PickMascotStrip(Key, Colour);     // the state, its file, SaveAndApply
					return FReply::Handled();
				}
				if (Write) { Write(Colour); }
				WonderlandMascotStyle::SaveAndApply();
				return FReply::Handled();
			})
			[
				SNew(SBox).WidthOverride(18.0f).HeightOverride(18.0f)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()[SNew(SImage).Image(&SwatchBrush).ColorAndOpacity(FSlateColor(Colour))]
					+ SOverlay::Slot()
					[
						SNew(SImage).Image(&SwatchRingBrush)
						.Visibility_Lambda([IsOn]()
						{
							return IsOn() ? EVisibility::HitTestInvisible : EVisibility::Hidden;
						})
					]
				]
			]
		];
	}
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SBox).WidthOverride(178.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Label))
					.Font(WonderlandUi::Sans(10, true, 160)).ColorAndOpacity(WonderlandUi::MenuGold())
				]
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[Chips]
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 12.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Note))
			.Font(WonderlandUi::Sans(8, false, 140)).ColorAndOpacity(WonderlandUi::Cream(0.70f))
		];
}

TSharedRef<SWidget> SWonderlandMenuPanel::MakeColoursPage()
{
	const auto Style = []() -> UWonderlandMascotStyleSettings*
	{
		return GetMutableDefault<UWonderlandMascotStyleSettings>();
	};
	return SNew(SScrollBox)
		+ SScrollBox::Slot()
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 14.0f)
			[
				SNew(STextBlock)
				.Text(INVTEXT("The same colours the Wardrobe sets. Choose here or there; both read one state."))
				.Font(WonderlandUi::Sans(9, false, 140)).ColorAndOpacity(WonderlandUi::Cream(0.85f))
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("MASCOT  PRIMARY"),
					TEXT("The Relay Dog's shell, on every skin. Halos, banners and the visor stay as authored."),
					[Style]() { return Style() != nullptr ? Style()->Primary : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->Primary = C; Style()->bChosen = true; } },
					/*Keyed: the mascot primary*/1)
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("MASCOT  SECONDARY"),
					TEXT("The Relay Dog's status eyes, and a skin's secondary accents -- Jack Flame's tie and suit, Shadow Flame's marbling."),
					[Style]() { return Style() != nullptr ? Style()->Secondary : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->Secondary = C; Style()->bChosen = true; Style()->bSecondaryChosen = true; } })
			]
			// ---- THE FLAME, ITS OWN ROW (founder, 2026-10-01: "When a flame-bearing mascot is equipped, the Color menu
			// should expose a separate: Flame Color"). Shown only while a skin with fire is worn -- Jack Flame, Skeleton
			// Flame, Baal -- and collapsed again for Relay OG and Celestial Light, live, without reopening the page.
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SBox)
				.Visibility_Lambda([]() { return WonderlandMascotStyle::WornSkinHasFlame() ? EVisibility::Visible : EVisibility::Collapsed; })
				[
					MakeColourRow(TEXT("MASCOT  FLAME"),
						TEXT("The worn skin's fire, on its own. DEFAULT is the fire as designed; the shell, eyes, skull and suit never move with it."),
						[]() { return WonderlandMascotStyle::FlameColour(); },
						[](FLinearColor C) { WonderlandMascotStyle::SetFlameColour(C); })
				]
			]
			// ---- COLOR 3, THE STRIPS, ITS OWN ROW (founder, 2026-10-02: "Shadow needs three independently controllable visual
			// color regions ... COLOR 3 -- STRIPS / RIBBONS / TENDRILS"). Shown only while a skin with strips is worn (Shadow),
			// exactly as the FLAME row is, so no skin gets a settings panel of its own.
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SBox)
				.Visibility_Lambda([]() { return WonderlandMascotStyle::WornSkinHasStrips() ? EVisibility::Visible : EVisibility::Collapsed; })
				[
					MakeColourRow(TEXT("MASCOT  STRIPS"),
						TEXT("The worn skin's flowing strips, on their own. DEFAULT is as designed; the body, eyes, swords and clothes never move with it."),
						[]() { return WonderlandMascotStyle::StripColour(); },
						[](FLinearColor) {},
						/*Keyed: the mascot strips*/2)
				]
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("AI COMPANION  PRIMARY"),
					TEXT("The companions' own shell. Separate from the mascot, and never applied to a Sub-Agent Cub."),
					[Style]() { return Style() != nullptr ? Style()->CompanionPrimary : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->CompanionPrimary = C; Style()->bCompanionChosen = true; } })
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("AI COMPANION  SECONDARY"),
					TEXT("The companions' eyes and accent."),
					[Style]() { return Style() != nullptr ? Style()->CompanionSecondary : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->CompanionSecondary = C; Style()->bCompanionChosen = true; } })
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("JULIUS TERMINAL"),
					TEXT("The Julius Live Terminal's accent. Takes effect on the terminal's next paint."),
					[Style]() { return Style() != nullptr ? Style()->JuliusTerminalAccent : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->JuliusTerminalAccent = C; Style()->bJuliusTerminalAccentChosen = true; } })
			]
			// THE SECONDARY, DIRECTLY UNDER ITS OWN PRIMARY, which is how the mascot rows above are already
			// arranged: a colourway and then the eyes. Founder, 2026-09-28: "a secondary live terminal colors
			// option for the text colors of the words inside the terminal."
			// AND IT IS EVERY TERMINAL'S LETTERING, not only Julius's (founder, 2026-09-28 correction pass: the same
			// Secondary "must change the LETTER COLORS of the companion terminals as well"). Picking it clears the
			// companions' own override, so the last terminal colour picked is the one all three terminals wear.
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("JULIUS TERMINAL  SECONDARY"),
					TEXT("The letters in the Julius Live Terminal and both companion terminals. Key hints keep their cream."),
					[Style]() { return Style() != nullptr ? Style()->JuliusTerminalTextColor : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->JuliusTerminalTextColor = C; Style()->bJuliusTerminalTextChosen = true; Style()->bCompanionTerminalTextChosen = false; } })
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("COMPANION TERMINALS"),
					TEXT("The LLM Companion and Jhinn terminals' accent."),
					[Style]() { return Style() != nullptr ? Style()->CompanionTerminalAccent : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->CompanionTerminalAccent = C; Style()->bCompanionTerminalAccentChosen = true; } })
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("COMPANION TERMINALS  SECONDARY"),
					TEXT("The companions' letters only. Picking the Julius Secondary again brings them back in step."),
					[Style]() { return Style() != nullptr ? Style()->CompanionTerminalTextColor : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->CompanionTerminalTextColor = C; Style()->bCompanionTerminalTextChosen = true; } })
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				MakeColourRow(TEXT("MENU THEME"),
					TEXT("Headings, key hints and the chosen tab. Body text stays readable whatever is picked."),
					[Style]() { return Style() != nullptr ? Style()->MenuAccent : FLinearColor::White; },
					[Style](FLinearColor C) { if (Style()) { Style()->MenuAccent = C; Style()->bMenuAccentChosen = true; } })
			]
			// ---- THE POINTER. FOUNDER, P1 item 8: "Add Wonderland cursor customization."
			//
			// The pointer itself has existed for some time -- four shapes, drawn rather than shipped as an
			// asset, wearing the terminal accent so the founder's theme moves it too. What it did not have was
			// a way to choose one without the console, which is the same gap the mascot and terminal colours
			// had, and the founder named it the same way. SYSTEM stays the default and stays offered: a custom
			// pointer nobody can turn off is a worse default than the machine's own.
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 12.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SBox).WidthOverride(178.0f)
					[
						SNew(STextBlock).Text(INVTEXT("POINTER"))
						.Font(WonderlandUi::Sans(10, true, 160)).ColorAndOpacity(WonderlandUi::MenuGold())
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[MakeCursorRow()]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
			[
				SNew(SButton).ButtonStyle(&RowStyle).IsFocusable(false)
				.OnClicked_Lambda([Style]()
				{
					// BACK TO THE COLOURS EVERYTHING WAS DESIGNED IN, in one press, because a player who has
					// made a mess of it should never have to work out which of seven rows did it.
					if (UWonderlandMascotStyleSettings* S = Style())
					{
						S->Primary = FLinearColor::White;
						S->Secondary = FLinearColor(1.00f, 0.78f, 0.16f, 1.0f);
						S->bChosen = false;
						S->bSecondaryChosen = false;
						S->CompanionPrimary = FLinearColor::White;
						S->CompanionSecondary = FLinearColor(0.42f, 0.80f, 1.00f, 1.0f);
						S->bCompanionChosen = false;
						S->bJuliusTerminalAccentChosen = false;
						S->bCompanionTerminalAccentChosen = false;
						S->bJuliusTerminalTextChosen = false;
						S->bCompanionTerminalTextChosen = false;
						S->bMenuAccentChosen = false;
						S->CursorShape = TEXT("system");
						S->CursorSize = 22.0f;
					}
					// AND THE FIRE, back to each skin's designed flames; the primary's DEFAULT-or-chosen word and the strips
					// too (B65: the reset used to leave PrimaryChoice.txt saying CHOSEN, so a later SECONDARY pick, which
					// sets bChosen, painted Shadow's shell a "chosen" white nobody had picked)
					WonderlandMascotStyle::SetFlameColour(FLinearColor::White);
					WonderlandMascotStyle::ResetChoiceFiles();
					WonderlandCursor::Forget();
					WonderlandMascotStyle::SaveAndApply();
					return FReply::Handled();
				})
				[
					SNew(STextBlock).Text(INVTEXT("RESET EVERY COLOUR"))
					.Font(WonderlandUi::Sans(10, true, 160)).ColorAndOpacity(WonderlandUi::Ivory())
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandMenuPanel::MakeCursorRow()
{
	static const TCHAR* const Shapes[] = {TEXT("system"), TEXT("arrow"), TEXT("mark"), TEXT("ring")};
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	for (const TCHAR* Shape : Shapes)
	{
		const FString Name = Shape;
		Row->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			SNew(SButton).ButtonStyle(&TabStyle).IsFocusable(false)
			.OnClicked_Lambda([Name]()
			{
				if (UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>())
				{
					Style->CursorShape = Name;
				}
				// THE CACHE HAS TO BE DROPPED or the setting changes and the pointer does not. See
				// WonderlandCursor::Forget.
				WonderlandCursor::Forget();
				WonderlandMascotStyle::SaveAndApply();
				return FReply::Handled();
			})
			[
				SNew(STextBlock).Text(FText::FromString(Name.ToUpper()))
				.Font(WonderlandUi::Sans(9, true, 140))
				.ColorAndOpacity_Lambda([Name]()
				{
					const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
					return FSlateColor(Style.CursorShape.Equals(Name, ESearchCase::IgnoreCase)
						? WonderlandUi::MenuGold() : WonderlandUi::Ivory(0.55f));
				})
			]
		];
	}
	// AND ITS SIZE, in three steps rather than a slider: a pointer is either comfortable or it is not, and
	// three named sizes are quicker to choose between than a continuum.
	for (const TPair<const TCHAR*, float>& Size : {TPair<const TCHAR*, float>(TEXT("S"), 16.0f),
												   TPair<const TCHAR*, float>(TEXT("M"), 22.0f),
												   TPair<const TCHAR*, float>(TEXT("L"), 30.0f)})
	{
		const float Edge = Size.Value;
		const FString Label = Size.Key;
		Row->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 5.0f, 0.0f)
		[
			SNew(SButton).ButtonStyle(&TabStyle).IsFocusable(false)
			.OnClicked_Lambda([Edge]()
			{
				if (UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>())
				{
					Style->CursorSize = Edge;
				}
				WonderlandCursor::Forget();
				WonderlandMascotStyle::SaveAndApply();
				return FReply::Handled();
			})
			[
				SNew(STextBlock).Text(FText::FromString(Label))
				.Font(WonderlandUi::Sans(9, true, 140))
				.ColorAndOpacity_Lambda([Edge]()
				{
					const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
					return FSlateColor(FMath::IsNearlyEqual(Style.CursorSize, Edge, 0.5f)
						? WonderlandUi::MenuGold() : WonderlandUi::Ivory(0.55f));
				})
			]
		];
	}
	return Row;
}

TSharedRef<SWidget> SWonderlandMenuPanel::MakeTabBar()
{
	TSharedRef<SHorizontalBox> Bar = SNew(SHorizontalBox);
	static const TCHAR* const Titles[] = { TEXT("MENU"), TEXT("SETTINGS"), TEXT("COLORS") };
	for (int32 Index = 0; Index < 3; ++Index)
	{
		const FString Title = Titles[Index];
		TabTitles.Add(Title);
		Bar->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			SNew(SButton).ButtonStyle(&TabStyle).IsFocusable(false)
			.OnClicked_Lambda([this, Index]()
			{
				OpenPage = Index;
				if (Pages.IsValid()) { Pages->SetActiveWidgetIndex(OpenPage); }
				return FReply::Handled();
			})
			[
				SNew(STextBlock).Text(FText::FromString(Title))
				.Font(WonderlandUi::Sans(10, true, 200))
				.ColorAndOpacity_Lambda([this, Index]()
				{
					return FSlateColor(OpenPage == Index ? WonderlandUi::MenuGold() : WonderlandUi::Ivory(0.55f));
				})
			]
		];
	}
	return Bar;
}

FString SWonderlandMenuPanel::GetOpenTab() const
{
	return OpenPage == 1 ? FString(TEXT("SETTINGS")) : (OpenPage == 2 ? FString(TEXT("COLORS")) : FString(TEXT("MENU")));
}

bool SWonderlandMenuPanel::ShowTab(const FString& Title)
{
	int32 Page = INDEX_NONE;
	if (Title.Equals(TEXT("MENU"), ESearchCase::IgnoreCase)) { Page = 0; }
	else if (Title.Equals(TEXT("SETTINGS"), ESearchCase::IgnoreCase)) { Page = 1; }
	else if (Title.Equals(TEXT("COLORS"), ESearchCase::IgnoreCase)) { Page = 2; }
	if (Page == INDEX_NONE)
	{
		return false;
	}
	OpenPage = Page;
	if (Pages.IsValid())
	{
		Pages->SetActiveWidgetIndex(OpenPage);
	}
	return true;
}

/* ------------------------------------------------------------------ THE SETTINGS PAGE (private beta, B06).
 *
 * The engine's own GameUserSettings, so each choice persists in the player's GameUserSettings.ini exactly as every UE
 * game's does, and nothing here invents a settings store. Ray tracing is the one exception: the renderer decides it at
 * start-up, so it is written to the player's Engine.ini ([SectionsToSave] in DefaultEngine.ini lists the section) and
 * Lumen stops tracing hardware rays at once.
 */
namespace WonderlandMenuSettings
{
	UGameUserSettings* User()
	{
		return GEngine != nullptr ? GEngine->GetGameUserSettings() : nullptr;
	}

	bool HardwareRayTracingWanted()
	{
		bool bOn = true;
		if (GConfig != nullptr)
		{
			GConfig->GetBool(TEXT("/Script/Engine.RendererSettings"), TEXT("r.RayTracing"), bOn, GEngineIni);
		}
		return bOn;
	}

	void SetHardwareRayTracing(bool bOn)
	{
		if (IConsoleVariable* Lumen = IConsoleManager::Get().FindConsoleVariable(TEXT("r.Lumen.HardwareRayTracing")))
		{
			Lumen->Set(bOn ? 1 : 0, ECVF_SetByCode);
		}
		if (GConfig != nullptr)
		{
			GConfig->SetBool(TEXT("/Script/Engine.RendererSettings"), TEXT("r.RayTracing"), bOn, GEngineIni);
			GConfig->SetBool(TEXT("/Script/Engine.RendererSettings"), TEXT("r.Lumen.HardwareRayTracing"), bOn, GEngineIni);
			GConfig->Flush(false, GEngineIni);
		}
		UE_LOG(LogTemp, Display, TEXT("WLSETTINGS hardware ray tracing %s (fully applied on the next launch)"), bOn ? TEXT("ON") : TEXT("OFF"));
	}

	void Commit(UGameUserSettings* Settings)
	{
		Settings->ApplySettings(false);
		Settings->SaveSettings();
	}
}

TSharedRef<SWidget> SWonderlandMenuPanel::MakeChoiceRow(const TCHAR* Label, const TCHAR* Note, const TArray<FString>& Choices,
	TFunction<int32()> Current, TFunction<void(int32)> Choose)
{
	TSharedRef<SHorizontalBox> Buttons = SNew(SHorizontalBox);
	for (int32 Index = 0; Index < Choices.Num(); ++Index)
	{
		Buttons->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 6.0f, 0.0f)
		[
			SNew(SButton).ButtonStyle(&TabStyle).IsFocusable(false)
			.OnClicked_Lambda([Choose, Index]() { if (Choose) { Choose(Index); } return FReply::Handled(); })
			[
				SNew(STextBlock).Text(FText::FromString(Choices[Index]))
				.Font(WonderlandUi::Sans(9, true, 140))
				.ColorAndOpacity_Lambda([Current, Index]()
				{
					return FSlateColor((Current && Current() == Index) ? WonderlandUi::MenuGold() : WonderlandUi::Ivory(0.55f));
				})
			]
		];
	}
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SBox).WidthOverride(190.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Label)).Font(WonderlandUi::Sans(10, true, 160)).ColorAndOpacity(WonderlandUi::MenuGold(0.90f))
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)[Buttons]
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(190.0f, 3.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(Note)).Font(WonderlandUi::Sans(8)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
		];
}

TSharedRef<SWidget> SWonderlandMenuPanel::MakeSettingsPage()
{
	using namespace WonderlandMenuSettings;
	TSharedRef<SVerticalBox> Page = SNew(SVerticalBox);

	Page->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 12.0f)
	[
		MakeChoiceRow(TEXT("QUALITY"), TEXT("Lower it if the world stutters or your PC runs short of memory. EPIC is the look Wonderland was made at."),
			{ TEXT("LOW"), TEXT("MEDIUM"), TEXT("HIGH"), TEXT("EPIC") },
			[]() { const UGameUserSettings* Settings = User(); return Settings != nullptr ? Settings->GetOverallScalabilityLevel() : -1; },
			[](int32 Level)
			{
				if (UGameUserSettings* Settings = User())
				{
					Settings->SetOverallScalabilityLevel(Level);
					Commit(Settings);
					UE_LOG(LogTemp, Display, TEXT("WLSETTINGS quality preset %d"), Level);
				}
			})
	];

	Page->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 12.0f)
	[
		// TWO MODES, NOT THREE (private beta, Second Wonderland's RC2 matrix): exclusive FULLSCREEN asked the display for
		// the game's own resolution, 1536x960 on this DPI-scaled laptop, a mode the panel does not have, and came up as a
		// 640x480 popup in the corner. BORDERLESS covers the screen without changing the display at all.
		MakeChoiceRow(TEXT("WINDOW"), TEXT("BORDERLESS fills the screen and lets you switch apps quickly."),
			{ TEXT("BORDERLESS"), TEXT("WINDOWED") },
			[]()
			{
				const UGameUserSettings* Settings = User();
				if (Settings == nullptr) { return -1; }
				return Settings->GetFullscreenMode() == EWindowMode::Windowed ? 1 : 0;
			},
			[](int32 Choice)
			{
				if (UGameUserSettings* Settings = User())
				{
					Settings->SetFullscreenMode(Choice == 1 ? EWindowMode::Windowed : EWindowMode::WindowedFullscreen);
					Commit(Settings);
					UE_LOG(LogTemp, Display, TEXT("WLSETTINGS window mode %s"), Choice == 1 ? TEXT("WINDOWED") : TEXT("BORDERLESS"));
				}
			})
	];

	Page->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 12.0f)
	[
		MakeChoiceRow(TEXT("RESOLUTION SCALE"), TEXT("Renders fewer pixels and sharpens them back up: the quickest way to a smoother frame rate."),
			{ TEXT("50%"), TEXT("67%"), TEXT("85%"), TEXT("100%") },
			[]()
			{
				const UGameUserSettings* Settings = User();
				if (Settings == nullptr) { return -1; }
				float Normalized = 0.0f, Value = 100.0f, Min = 0.0f, Max = 100.0f;
				Settings->GetResolutionScaleInformationEx(Normalized, Value, Min, Max);
				static const float Steps[] = { 50.0f, 67.0f, 85.0f, 100.0f };
				int32 Best = 3;
				for (int32 Index = 0; Index < 4; ++Index)
				{
					if (FMath::Abs(Steps[Index] - Value) < FMath::Abs(Steps[Best] - Value)) { Best = Index; }
				}
				return Best;
			},
			[](int32 Choice)
			{
				if (UGameUserSettings* Settings = User())
				{
					static const float Steps[] = { 50.0f, 67.0f, 85.0f, 100.0f };
					Settings->SetResolutionScaleValueEx(Steps[FMath::Clamp(Choice, 0, 3)]);
					Commit(Settings);
					UE_LOG(LogTemp, Display, TEXT("WLSETTINGS resolution scale %.0f%%"), Steps[FMath::Clamp(Choice, 0, 3)]);
				}
			})
	];

	Page->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 12.0f)
	[
		MakeChoiceRow(TEXT("FRAME RATE LIMIT"), TEXT("A cap keeps a laptop cooler and quieter."),
			{ TEXT("30"), TEXT("60"), TEXT("120"), TEXT("NONE") },
			[]()
			{
				const UGameUserSettings* Settings = User();
				if (Settings == nullptr) { return -1; }
				const float Limit = Settings->GetFrameRateLimit();
				return Limit <= 0.0f ? 3 : (Limit <= 30.5f ? 0 : (Limit <= 60.5f ? 1 : 2));
			},
			[](int32 Choice)
			{
				if (UGameUserSettings* Settings = User())
				{
					static const float Limits[] = { 30.0f, 60.0f, 120.0f, 0.0f };
					Settings->SetFrameRateLimit(Limits[FMath::Clamp(Choice, 0, 3)]);
					Commit(Settings);
					UE_LOG(LogTemp, Display, TEXT("WLSETTINGS frame rate limit %.0f"), Limits[FMath::Clamp(Choice, 0, 3)]);
				}
			})
	];

	Page->AddSlot().AutoHeight()
	[
		MakeChoiceRow(TEXT("HARDWARE RAY TRACING"), TEXT("OFF saves graphics memory on smaller GPUs. Lumen switches at once; the rest applies the next time you start Wonderland."),
			{ TEXT("ON"), TEXT("OFF") },
			[]() { return HardwareRayTracingWanted() ? 0 : 1; },
			[](int32 Choice) { SetHardwareRayTracing(Choice == 0); })
	];
	return Page;
}

void SWonderlandMenuPanel::Construct(const FArguments& InArgs)
{
	using namespace WonderlandHudPanelLook;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestMap = InArgs._OnRequestMap;
	OnRequestWallet = InArgs._OnRequestWallet;
	OnRequestWelcome = InArgs._OnRequestWelcome;
	OnRequestQuit = InArgs._OnRequestQuit;
	OnRequestNavigate = InArgs._OnRequestNavigate;
	BuildLabel = InArgs._BuildLabel;
	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::MapScrim());
	RowStyle = FButtonStyle().SetNormal(RowNormal).SetHovered(RowHovered).SetPressed(RowPressed)
		.SetNormalPadding(FMargin(16.0f, 10.0f)).SetPressedPadding(FMargin(16.0f, 11.0f, 16.0f, 9.0f));

	struct FRow { EWonderlandBrainGlyph Glyph; const TCHAR* Title; const TCHAR* Key; TFunction<void()> Go; };
	TArray<FRow> Rows;
	Rows.Add({EWonderlandBrainGlyph::Arrows, TEXT("RESUME"), TEXT("ESC"), [this]() { OnRequestClose.ExecuteIfBound(); }});
	Rows.Add({EWonderlandBrainGlyph::Target, TEXT("WORLD MAP"), TEXT("M"), [this]() { OnRequestMap.ExecuteIfBound(); }});
	Rows.Add({EWonderlandBrainGlyph::Agent, TEXT("AGENT TERMINALS"), TEXT("CTRL T"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Agent); }});
	Rows.Add({EWonderlandBrainGlyph::Missions, TEXT("MISSIONS"), TEXT("J"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Missions); }});
	Rows.Add({EWonderlandBrainGlyph::Brain, TEXT("PROJECT BRAIN"), TEXT("B"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Brain); }});
	Rows.Add({EWonderlandBrainGlyph::Commands, TEXT("COMMAND PRESETS"), TEXT("C"), [this]() { OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Commands); }});
	Rows.Add({EWonderlandBrainGlyph::Wallet, TEXT("WONDER WEB WALLET"), TEXT("SANDBOX"), [this]() { OnRequestWallet.ExecuteIfBound(); }});
	Rows.Add({EWonderlandBrainGlyph::Menu, TEXT("HOW TO PLAY"), TEXT("WELCOME"), [this]() { OnRequestWelcome.ExecuteIfBound(); }});
	// QUIT ASKS ONCE (private beta, B05). The Menu had no way out at all, and the game opens fullscreen with the mouse
	// captured: a tester who did not know Alt+F4 was stuck. One click arms it, a second within four seconds leaves.
	Rows.Add({EWonderlandBrainGlyph::Arrows, TEXT("QUIT WONDERLAND"), TEXT("CLICK TWICE"), [this]()
	{
		const double Now = FPlatformTime::Seconds();
		if (QuitArmedAt > 0.0 && Now - QuitArmedAt <= 4.0)
		{
			OnRequestQuit.ExecuteIfBound();
			return;
		}
		QuitArmedAt = Now;
	}});

	TSharedRef<SVerticalBox> List = SNew(SVerticalBox);
	for (const FRow& Row : Rows)
	{
		RowTitles.Add(Row.Title);
		const TFunction<void()> Go = Row.Go;
		const bool bQuit = FCString::Strcmp(Row.Title, TEXT("QUIT WONDERLAND")) == 0;
		const FString Title = Row.Title;
		const FString Key = Row.Key;
		List->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 6.0f)
		[
			SNew(SButton).ButtonStyle(&RowStyle).IsFocusable(false)
			.OnClicked_Lambda([Go]() { if (Go) { Go(); } return FReply::Handled(); })
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
				[
					SNew(SWonderlandBrainIcon).Glyph(Row.Glyph).Size(20.0f).Color(WonderlandUi::Ivory(0.90f)).Thickness(1.5f)
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text_Lambda([this, bQuit, Title]()
					{
						const bool bArmed = bQuit && QuitArmedAt > 0.0 && FPlatformTime::Seconds() - QuitArmedAt <= 4.0;
						return FText::FromString(bArmed ? FString(TEXT("CLICK AGAIN TO QUIT")) : Title);
					})
					.Font(WonderlandUi::Sans(12, true, 140)).ColorAndOpacity(WonderlandUi::Ivory())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Key)).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::MenuGold(0.80f))
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
		{TEXT("M"), TEXT("World map: choose a place, then Teleport")},
		{TEXT("B"), TEXT("Project Brain and the wardrobe")},
		{TEXT("ESC / TAB"), TEXT("This menu: settings, colours, quit")},
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
					SNew(STextBlock).Text(FText::FromString(Control.Keys)).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::MenuGold(0.85f))
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Control.Does)).Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Cream(0.85f)).AutoWrapText(true)
			]
		];
	}

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()[SNew(SBorder).BorderImage(&ScrimBrush)]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(40.0f)
		[
			SNew(SBox).WidthOverride(800.0f)
			[
				SNew(SBorder).BorderImage(&PanelBrush).Padding(FMargin(28.0f, 22.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						Header(EWonderlandBrainGlyph::Menu, TEXT("MENU"), TEXT("Every panel in reach, the controls, your settings."), SNullWidget::NullWidget)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 12.0f)
					[
						MakeTabBar()
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 16.0f)
					[
						SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush)]
					]
					// THREE PAGES, ONE PANEL. All are built now and swapped by the tab bar, so no page is rebuilt every time
					// it is opened and none loses its place.
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SBox).MinDesiredHeight(292.0f)
						[
							SAssignNew(Pages, SWidgetSwitcher)
							+ SWidgetSwitcher::Slot()
							[
								SNew(SHorizontalBox)
								+ SHorizontalBox::Slot().FillWidth(0.56f).Padding(0.0f, 0.0f, 24.0f, 0.0f)[List]
								+ SHorizontalBox::Slot().FillWidth(0.44f)
								[
									SNew(SVerticalBox)
									+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 10.0f)
									[
										SNew(STextBlock).Text(FText::FromString(TEXT("CONTROLS"))).Font(WonderlandUi::Sans(10, true, 200)).ColorAndOpacity(WonderlandUi::MenuGold())
									]
									+ SVerticalBox::Slot().AutoHeight()[ControlList]
								]
							]
							+ SWidgetSwitcher::Slot()
							[
								MakeSettingsPage()
							]
							+ SWidgetSwitcher::Slot()
							[
								MakeColoursPage()
							]
						]
					]
					// THE BUILD, so a report can name it (private beta, B07).
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(FText::FromString(BuildLabel)).Font(WonderlandUi::Sans(8, false, 80)).ColorAndOpacity(WonderlandUi::Dim())
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

// ---------------------------------------------------------------------------------------------------------------- welcome

SWonderlandWelcomePanel::SWonderlandWelcomePanel()
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::MenuGold(0.50f), 1.2f)
	, RuleBrush(WonderlandUi::MenuGold(0.22f), 0.0f, FLinearColor::Transparent, 0.0f)
	, StartNormal(WonderlandUi::Srgb(46, 38, 16, 0.95f), 8.0f, WonderlandUi::MenuGold(0.85f), 1.2f)
	, StartHovered(WonderlandUi::Srgb(64, 52, 20, 1.0f), 8.0f, WonderlandUi::MenuGold(1.0f), 1.6f)
{
	StartStyle = FButtonStyle().SetNormal(StartNormal).SetHovered(StartHovered).SetPressed(StartHovered)
		.SetNormalPadding(FMargin(16.0f, 7.0f)).SetPressedPadding(FMargin(16.0f, 8.0f, 16.0f, 6.0f));
}

void SWonderlandWelcomePanel::Construct(const FArguments& InArgs)
{
	using namespace WonderlandHudPanelLook;
	OnRequestClose = InArgs._OnRequestClose;
	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::MapScrim());

	struct FLine { const TCHAR* Keys; const TCHAR* Does; };
	static const FLine Around[] = {
		{TEXT("W A S D  ·  MOUSE"), TEXT("Move and look. SHIFT runs, CTRL walks, SPACE jumps.")},
		{TEXT("M"), TEXT("The world map. Pick a place, then TELEPORT to go there.")},
		{TEXT("B"), TEXT("The Project Brain. C.A.R.D.'s mascot & visual mods opens the wardrobe.")},
		{TEXT("J  ·  CTRL T"), TEXT("Missions, and the agent terminals where you write tasks.")},
		{TEXT("ESC  ·  TAB"), TEXT("The menu: settings, colours, how to play, and quit.")},
	};
	TSharedRef<SVerticalBox> Lines = SNew(SVerticalBox);
	for (const FLine& Line : Around)
	{
		Lines->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()
			[
				SNew(SBox).WidthOverride(150.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Line.Keys)).Font(WonderlandUi::Sans(10, true, 120)).ColorAndOpacity(WonderlandUi::MenuGold(0.90f))
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Line.Does)).Font(WonderlandUi::Sans(11)).ColorAndOpacity(WonderlandUi::Cream(0.92f)).AutoWrapText(true)
			]
		];
	}

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()[SNew(SBorder).BorderImage(&ScrimBrush)]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(40.0f)
		[
			SNew(SBox).WidthOverride(720.0f)
			[
				SNew(SBorder).BorderImage(&PanelBrush).Padding(FMargin(30.0f, 24.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						Header(EWonderlandBrainGlyph::Target, TEXT("WELCOME TO WONDERLAND"), TEXT("A private beta. Here is what you can do."), SNullWidget::NullWidget)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 14.0f)
					[
						SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush)]
					]
					+ SVerticalBox::Slot().AutoHeight()[Lines]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 6.0f)
					[
						SNew(STextBlock).Text(FText::FromString(TEXT("IN THIS BETA"))).Font(WonderlandUi::Sans(10, true, 200)).ColorAndOpacity(WonderlandUi::MenuGold())
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock)
						.Text(FText::FromString(TEXT(
							"Julius and the AI companions are not connected in this build, and nothing here calls an AI service. "
							"Tasks you write in the agent terminal (press +, then type the objective) are saved as QUEUED Mission "
							"Contracts on this PC, and the Missions panel can play a SIMULATED mission so you can see how one unfolds. "
							"Friends, messages, parties and voice open with /social in the agent terminal. They need a Wonderland social "
							"server, which this build reaches only when one is set up for your test session. Your skin, colours, settings and "
							"tasks are saved on this PC.")))
						.Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Cream(0.80f)).AutoWrapText(true)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 18.0f, 0.0f, 0.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(FText::FromString(InArgs._BuildLabel)).Font(WonderlandUi::Sans(8, false, 80)).ColorAndOpacity(WonderlandUi::Dim())
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							// A BUTTON, NOT THE WHOLE PANEL: the first click on a fresh window is often just the click that gives
							// it focus, and that click used to dismiss the welcome before anyone had read it.
							SNew(SButton).ButtonStyle(&StartStyle).IsFocusable(false)
							.OnClicked_Lambda([this]() { OnRequestClose.ExecuteIfBound(); return FReply::Handled(); })
							[
								SNew(STextBlock).Text(FText::FromString(TEXT("START  ·  ENTER"))).Font(WonderlandUi::Sans(11, true, 160)).ColorAndOpacity(WonderlandUi::MenuGold())
							]
						]
					]
				]
			]
		]
	];
}

FReply SWonderlandWelcomePanel::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::Enter || Key == EKeys::Escape || Key == EKeys::SpaceBar)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return FReply::Handled();
}

FReply SWonderlandWelcomePanel::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	// Swallowed, so a click elsewhere on the welcome neither dismisses it nor reaches the world behind it.
	return FReply::Handled();
}

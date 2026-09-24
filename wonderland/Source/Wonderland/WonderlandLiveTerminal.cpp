#include "WonderlandLiveTerminal.h"

#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Misc/DateTime.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SConstraintCanvas.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandJuliusWorkLog.h"
#include "WonderlandUiStyle.h"

/* ------------------------------------------------------------ hex badge */

void SWonderlandHexBadge::Construct(const FArguments& InArgs)
{
	Label = InArgs._Label;
	Size = InArgs._Size;
	Color = InArgs._Color;
	bInnerMark = InArgs._InnerMark;
}

FVector2D SWonderlandHexBadge::ComputeDesiredSize(float) const
{
	return FVector2D(Size, Size);
}

static void AddHexagon(TArray<FVector2f>& Points, const FVector2f& Centre, float Radius)
{
	Points.Reset();
	for (int32 Index = 0; Index <= 6; ++Index)
	{
		const float Angle = FMath::DegreesToRadians(60.0f * Index - 90.0f);
		Points.Add(Centre + FVector2f(FMath::Cos(Angle), FMath::Sin(Angle)) * Radius);
	}
}

int32 SWonderlandHexBadge::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const FVector2f Local(static_cast<float>(AllottedGeometry.GetLocalSize().X), static_cast<float>(AllottedGeometry.GetLocalSize().Y));
	const FVector2f Centre = Local * 0.5f;
	const float Radius = FMath::Min(Local.X, Local.Y) * 0.44f;
	TArray<FVector2f> Points;

	// A faint outer ring, then the stroke: the frame's badges glow slightly past their edge.
	AddHexagon(Points, Centre, Radius * 1.12f);
	FSlateDrawElement::MakeLines(OutDrawElements, LayerId, AllottedGeometry.ToPaintGeometry(), Points,
		ESlateDrawEffect::None, Color.CopyWithNewOpacity(0.28f), true, 1.0f);
	AddHexagon(Points, Centre, Radius);
	FSlateDrawElement::MakeLines(OutDrawElements, LayerId + 1, AllottedGeometry.ToPaintGeometry(), Points,
		ESlateDrawEffect::None, Color, true, 2.0f);

	if (bInnerMark)
	{
		AddHexagon(Points, Centre, Radius * 0.42f);
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId + 1, AllottedGeometry.ToPaintGeometry(), Points,
			ESlateDrawEffect::None, Color.CopyWithNewOpacity(0.85f), true, 1.5f);
		TArray<FVector2f> Tick = { Centre - FVector2f(0.0f, Radius * 0.12f), Centre + FVector2f(0.0f, Radius * 0.12f) };
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId + 1, AllottedGeometry.ToPaintGeometry(), Tick,
			ESlateDrawEffect::None, Color, true, 2.0f);
	}
	else if (!Label.IsEmpty())
	{
		const FSlateFontInfo Font = WonderlandUi::Sans(FMath::Max(8, FMath::RoundToInt(Size * 0.40f)), true);
		const TSharedRef<FSlateFontMeasure> Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
		const FVector2D Raw = Measure->Measure(Label, Font);
		const FVector2f TextSize(static_cast<float>(Raw.X), static_cast<float>(Raw.Y));
		FSlateDrawElement::MakeText(OutDrawElements, LayerId + 2,
			AllottedGeometry.ToPaintGeometry(TextSize, FSlateLayoutTransform(Centre - TextSize * 0.5f)),
			Label, Font, ESlateDrawEffect::None, WonderlandUi::Cream());
	}
	return LayerId + 2;
}

/* ------------------------------------------------------------- terminal */

SWonderlandLiveTerminal::SWonderlandLiveTerminal()
	: WindowBrush(WonderlandUi::WindowFill(), 10.0f, WonderlandUi::GoldDim(), 1.0f)
	, SectionBrush(WonderlandUi::SectionFill(), 7.0f, WonderlandUi::GoldDim(), 1.0f)
	, InputBrush(WonderlandUi::Srgb(5, 6, 9, 0.72f), 6.0f, WonderlandUi::GoldDim(), 1.0f)
	, SlotBrush(WonderlandUi::Srgb(8, 9, 12, 0.58f), 6.0f, WonderlandUi::Srgb(217, 164, 65, 0.18f), 1.0f)
{
}

void SWonderlandLiveTerminal::Construct(const FArguments& InArgs)
{
	OnRequestClose = InArgs._OnRequestClose;
	OnSubmit = InArgs._OnSubmit;
	OnGetCommandLabel = InArgs._OnGetCommandLabel;
	OnGetTaskTabs = InArgs._OnGetTaskTabs;
	OnSelectTaskTab = InArgs._OnSelectTaskTab;
	OnAddTaskTerminal = InArgs._OnAddTaskTerminal;
	OnCloseTaskTerminal = InArgs._OnCloseTaskTerminal;
	ClosedTaskCount = InArgs._ClosedTaskCount;
	CommandSlotCount = FMath::Clamp(InArgs._CommandSlotCount, 1, 9);

	FSlateBrush NoBackground;
	NoBackground.DrawAs = ESlateBrushDrawType::NoDrawType;
	InputStyle = FCoreStyle::Get().GetWidgetStyle<FEditableTextBoxStyle>("NormalEditableTextBox");
	InputStyle.SetBackgroundImageNormal(NoBackground)
		.SetBackgroundImageHovered(NoBackground)
		.SetBackgroundImageFocused(NoBackground)
		.SetFont(WonderlandUi::Mono(11))
		.SetForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetFocusedForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetPadding(FMargin(4.0f, 3.0f));

	SAssignNew(JuliusBody, SVerticalBox);
	RebuildJuliusBody();

	const TSharedRef<SWidget> Window =
		SAssignNew(WindowWidget, SBorder)
		.BorderImage(&WindowBrush)
		.Padding(FMargin(10.0f, 9.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(2.0f, 0.0f, 0.0f, 4.0f)
			[
				// Never a paid run by accident: while simulated rows are showing, the terminal says so first.
				SNew(SHorizontalBox)
				.Visibility_Lambda([this]() { return bSimulated ? EVisibility::SelfHitTestInvisible : EVisibility::Collapsed; })
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text(FText::FromString(TEXT("DEVELOPMENT PREVIEW \u00B7 SIMULATED JULIUS EXECUTION")))
					.Font(WonderlandUi::Sans(8, true, 140))
					.ColorAndOpacity(WonderlandUi::Coral())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(12.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text_Lambda([this]()
					{
						return FText::Format(INVTEXT("SIM TOKENS {0}"), FText::AsNumber(GetSimulatedTokenCount()));
					})
					.ToolTipText(INVTEXT("Simulated usage: one token per four emitted work-log characters, rounded up. Updates with mission output; no provider telemetry or billable tokens."))
					.Font(WonderlandUi::Mono(8))
					.ColorAndOpacity(WonderlandUi::Cream())
				]
			]
			// THE TASK TERMINALS, ACROSS THE TOP, above PROMPT ARCHITECT -- which is where the founder asked for
			// them: "put a + control at the TOP of the JULIUS LIVE TERMINAL ... the Wonderland equivalent of
			// CLAUDE CODE -> new terminal/tab/task."
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.0f, 0.0f, 0.0f, 6.0f)
			[
				MakeTaskTabs()
			]
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			[
				// THE SECTIONS ARE SIZED TO FIT: the terminal extends and each section shows only as many of its newest lines
				// as the terminal can hold, so this never has anything to scroll.
				SNew(SScrollBox)
				.ScrollBarVisibility(EVisibility::Collapsed)
				+ SScrollBox::Slot().Padding(0.0f, 0.0f, 0.0f, 5.0f)
				[
					MakeSection(TEXT("PROMPT ARCHITECT"), TEXT("WAITING"), MakeWorkLog(TEXT("PROMPT ARCHITECT"), TEXT("No activity yet.")))
				]
				+ SScrollBox::Slot().Padding(0.0f, 0.0f, 0.0f, 5.0f)
				[
					MakeSection(TEXT("CODING AGENT"), TEXT("WAITING"), MakeWorkLog(TEXT("CODING AGENT"), TEXT("No activity yet.")))
				]
				+ SScrollBox::Slot().Padding(0.0f, 0.0f, 0.0f, 5.0f)
				[
					MakeSection(TEXT("JULIUS 3.3"), TEXT("STANDBY"),
						MakeWorkLog(TEXT("JULIUS 3.3"), TEXT("Not connected. Julius execution appears here when Relay is connected.")))
				]
				+ SScrollBox::Slot()
				[
					MakeSection(TEXT("INDEPENDENT REVIEWER"), TEXT("WAITING"),
						MakeWorkLog(TEXT("INDEPENDENT REVIEWER"), TEXT("Reviewer: Independent review begins after Julius verification.")))
				]
			]
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.0f, 6.0f, 0.0f, 0.0f)
			[
				SNew(SBorder)
				.BorderImage(&InputBrush)
				.Padding(FMargin(8.0f, 1.0f))
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					[
						SNew(STextBlock)
						.Text(INVTEXT(">"))
						.Font(WonderlandUi::Mono(12))
						.ColorAndOpacity(WonderlandUi::Gold())
					]
					+ SHorizontalBox::Slot()
					.FillWidth(1.0f)
					.VAlign(VAlign_Center)
					.Padding(6.0f, 0.0f, 0.0f, 0.0f)
					[
						SAssignNew(Input, SEditableTextBox)
						.Style(&InputStyle)
						.HintText(INVTEXT("Message Julius 3.3   \u00B7   Ctrl+T or Esc to close"))
						.ClearKeyboardFocusOnCommit(false)
						.RevertTextOnEscape(false)
						.SelectAllTextWhenFocused(false)
						.OnTextCommitted(this, &SWonderlandLiveTerminal::HandleCommitted)
						.OnKeyDownHandler(this, &SWonderlandLiveTerminal::HandleInputKeyDown)
					]
				]
			]
		];

	ChildSlot
	[
		SNew(SConstraintCanvas)
		// 39.2% wide, 27.3% tall, bottom-centred with a 3.1% margin: the approved web measurement. It EXTENDS vertically --
		// same width, same bottom edge -- only while its work needs the room, and never past its limit (see Tick).
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.304f, 0.696f, 0.696f, 0.969f))
		.Offset_Lambda([this]() { return FMargin(0.0f, -ExtensionShown, 0.0f, 0.0f); })
		[
			Window
		]
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.018f, 0.708f, 0.205f, 0.962f))
		.Offset(FMargin(0.0f))
		[
			MakeSideList(true)
		]
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.795f, 0.708f, 0.982f, 0.962f))
		.Offset(FMargin(0.0f))
		[
			MakeSideList(false)
		]
	];
}

TSharedRef<SWidget> SWonderlandLiveTerminal::MakeTaskTabs()
{
	SAssignNew(TaskTabBox, SHorizontalBox);
	RebuildTaskTabs();
	return SNew(SBox).HeightOverride(24.0f)[TaskTabBox.ToSharedRef()];
}

void SWonderlandLiveTerminal::RebuildTaskTabs()
{
	if (!TaskTabBox.IsValid())
	{
		return;
	}
	TArray<FTaskTab> Tabs;
	if (OnGetTaskTabs.IsBound())
	{
		Tabs = OnGetTaskTabs.Execute();
	}
	TaskTabBox->ClearChildren();

	for (const FTaskTab& Tab : Tabs)
	{
		const FGuid Id = Tab.Id;
		const bool bSelected = Tab.bSelected;
		// A DRAFT TERMINAL SAYS SO. The founder asked that a newly opened one "visibly read as NEW TASK or
		// PENDING TASK until the user enters/submits its objective", which is the same gray-means-empty rule the
		// orb stack already keeps -- one vocabulary, two surfaces.
		const FLinearColor Ink = Tab.bDraft ? WonderlandUi::Faint() : WonderlandUi::Cream();
		TaskTabBox->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 5.0f, 0.0f)
		[
			SNew(SButton)
			.ButtonStyle(FCoreStyle::Get(), "NoBorder")
			.ContentPadding(FMargin(0.0f))
			.ToolTipText(FText::FromString(Tab.bDraft
				? TEXT("An empty task terminal. Type an objective to make it a Mission Contract.")
				: TEXT("Show this task. The others carry on: selection is a view, not a command.")))
			.OnClicked_Lambda([this, Id]()
			{
				OnSelectTaskTab.ExecuteIfBound(Id);
				RebuildTaskTabs();
				return FReply::Handled();
			})
			[
				SNew(SBorder)
				.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
				// THE SELECTED TAB IS THE LIT ONE, and the rest are plainly a step back -- the same relationship
				// the orb stack draws with scale.
				.BorderBackgroundColor(FSlateColor(bSelected
					? FLinearColor(0.20f, 0.19f, 0.28f, 0.95f)
					: FLinearColor(0.10f, 0.10f, 0.15f, 0.65f)))
				.Padding(FMargin(9.0f, 3.0f))
				[
					SNew(STextBlock)
					.Text(FText::FromString(Tab.Label))
					.Font(WonderlandUi::Sans(8, bSelected, 140))
					.ColorAndOpacity(Ink)
				]
			]
		];
	}

	// THE X, LEFT OF THE +, acting on the selected tab: "[TASK 1] [TASK 2] [X][+]". Closing a tab is not
	// cancelling a mission -- a contract keeps everything it is and leaves the workspace; only an empty draft is
	// actually discarded. Shown only while there is a tab to close, so it cannot be pressed at nothing.
	const bool bAnySelected = Tabs.ContainsByPredicate([](const FTaskTab& Tab) { return Tab.bSelected; });
	if (bAnySelected)
	{
		TaskTabBox->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(4.0f, 0.0f, 3.0f, 0.0f))
		[
			SNew(SButton)
			.ButtonStyle(FCoreStyle::Get(), "NoBorder")
			.ContentPadding(FMargin(0.0f))
			.ToolTipText(INVTEXT("Close this task terminal. An empty draft is discarded; a Mission Contract keeps its state and can be reopened with /tasks."))
			.OnClicked_Lambda([this]()
			{
				OnCloseTaskTerminal.ExecuteIfBound();
				RebuildTaskTabs();
				return FReply::Handled();
			})
			[
				SNew(SBorder)
				.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
				.BorderBackgroundColor(FSlateColor(FLinearColor(0.16f, 0.10f, 0.12f, 0.85f)))
				.Padding(FMargin(9.0f, 2.0f))
				[
					SNew(STextBlock)
					.Text(INVTEXT("X"))
					.Font(WonderlandUi::Sans(12, true))
					.ColorAndOpacity(WonderlandUi::Coral())
				]
			]
		];
	}

	// THE +, AT THE END OF THE STRIP, where a new tab appears.
	TaskTabBox->AddSlot().AutoWidth().VAlign(VAlign_Center)
	[
		SNew(SButton)
		.ButtonStyle(FCoreStyle::Get(), "NoBorder")
		.ContentPadding(FMargin(0.0f))
		.ToolTipText(INVTEXT("Open another Julius task terminal. The one you are looking at is not touched."))
		.OnClicked_Lambda([this]()
		{
			OnAddTaskTerminal.ExecuteIfBound();
			RebuildTaskTabs();
			return FReply::Handled();
		})
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.BorderBackgroundColor(FSlateColor(FLinearColor(0.14f, 0.13f, 0.20f, 0.85f)))
			.Padding(FMargin(9.0f, 2.0f))
			[
				SNew(STextBlock)
				.Text(INVTEXT("+"))
				.Font(WonderlandUi::Sans(13, true))
				.ColorAndOpacity(WonderlandUi::GoldDim())
			]
		]
	];

	// And a word, because a bare + beside four agent roles is a control with nothing to explain it.
	TaskTabBox->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(7.0f, 0.0f, 0.0f, 0.0f))
	[
		SNew(STextBlock)
		.Text(INVTEXT("NEW TASK TERMINAL"))
		.Font(WonderlandUi::Sans(7, false, 170))
		.ColorAndOpacity(WonderlandUi::Faint())
	];

	// CLOSED TASKS ARE NOT GONE, and the strip says so. A tab shut with X is a contract still on record; hiding
	// that it exists would be the "destroy evidence/history" the founder ruled out. /tasks lists and reopens them.
	const int32 Closed = ClosedTaskCount.Get(0);
	if (Closed > 0)
	{
		TaskTabBox->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(12.0f, 0.0f, 0.0f, 0.0f))
		[
			SNew(STextBlock)
			.Text(FText::FromString(FString::Printf(TEXT("%d CLOSED  \u00B7  /tasks"), Closed)))
			.Font(WonderlandUi::Sans(7, false, 170))
			.ColorAndOpacity(WonderlandUi::Faint())
		];
	}
}

TSharedRef<SWidget> SWonderlandLiveTerminal::MakeSection(const FString& Title, const FString& State, TSharedRef<SWidget> Body)
{
	RestingStates.Add(Title, State);
	const auto StateNow = [this, Title]() { return GetSectionState(Title); };
	return SNew(SBorder)
		.BorderImage(&SectionBrush)
		.Padding(FMargin(9.0f, 5.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(0.0f, 0.0f, 7.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text(FText::FromString(TEXT("\u25A0")))
					.Font(WonderlandUi::Mono(8))
					.ColorAndOpacity(WonderlandUi::Gold())
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text(FText::FromString(Title))
					.Font(WonderlandUi::Sans(10, true, 130))
					.ColorAndOpacity(WonderlandUi::Gold())
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(8.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text_Lambda([StateNow]() { return FText::FromString(FString::Printf(TEXT("[%s]"), *StateNow())); })
					.Font(WonderlandUi::Mono(9))
					.ColorAndOpacity(WonderlandUi::Cream())
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text_Lambda([StateNow]() { return FText::FromString(StateNow()); })
					.Font(WonderlandUi::Sans(9, true, 120))
					// Bright while a role is working, sage when it has finished, the resting gold otherwise.
					.ColorAndOpacity_Lambda([StateNow]()
					{
						const FString Now = StateNow();
						if (Now == TEXT("DONE") || Now == TEXT("COMPLETE") || Now == TEXT("VERIFIED"))
						{
							return FSlateColor(WonderlandUi::Sage());
						}
						const bool bResting = Now == TEXT("WAITING") || Now == TEXT("STANDBY");
						return FSlateColor(bResting ? WonderlandUi::Gold(0.55f) : WonderlandUi::Gold());
					})
				]
			]
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.0f, 2.0f, 0.0f, 0.0f)
			[
				Body
			]
		];
}

TSharedRef<SWidget> SWonderlandLiveTerminal::MakeRestingLine(const FString& Text)
{
	return SNew(STextBlock)
		.Text(FText::FromString(Text))
		.Font(WonderlandUi::Mono(9))
		.ColorAndOpacity(WonderlandUi::Dim())
		.OverflowPolicy(ETextOverflowPolicy::Ellipsis);
}

TSharedRef<SWidget> SWonderlandLiveTerminal::MakeSideList(bool bLoops)
{
	// The founder's frame: loops down the left in gold, sub-agents down the right in coral.
	//
	// THE LEFT LIST IS THE ACTIVE COMMAND PRESET NOW, not a list. It was a static array of the four loops, which
	// made the founder's first frame the permanent design; the founder asked for those four to become the DEFAULT
	// preset instead (2026-09-15). Each row asks for its slot every paint, so arranging commands in the station
	// changes this list the moment it is saved, with the terminal open or closed.
	static const TCHAR* Agents[] = { TEXT("Scout-01"), TEXT("Forge-02"), TEXT("Sub-Agent Sync"), TEXT("Reviewer Lock") };
	if (bLoops)
	{
		CommandTexts.Reset();
	}

	TSharedRef<SVerticalBox> List = SNew(SVerticalBox);
	const int32 Rows = bLoops ? CommandSlotCount : 4;
	for (int32 Index = 0; Index < Rows; ++Index)
	{
		const FString Number = FString::FromInt(Index + 1);
		TSharedPtr<SWidget> Row;
		if (bLoops)
		{
			Row = SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				[
					SNew(SWonderlandHexBadge).Label(Number).Size(34.0f).Color(WonderlandUi::Gold())
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.VAlign(VAlign_Center)
				.Padding(10.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(SBorder)
					.BorderImage(&SlotBrush)
					.Padding(FMargin(12.0f, 6.0f))
					[
						SAssignNew(CommandTexts.AddDefaulted_GetRef(), STextBlock)
						.Text_Lambda([this, Index]()
						{
							const FString Label = OnGetCommandLabel.IsBound() ? OnGetCommandLabel.Execute(Index) : FString();
							return FText::FromString(Label.IsEmpty() ? TEXT("Empty slot") : Label);
						})
						.Font(WonderlandUi::Sans(12))
						.ColorAndOpacity_Lambda([this, Index]()
						{
							const bool bEmpty = !OnGetCommandLabel.IsBound() || OnGetCommandLabel.Execute(Index).IsEmpty();
							return FSlateColor(bEmpty ? WonderlandUi::Faint() : WonderlandUi::Cream());
						})
					]
				];
		}
		else
		{
			Row = SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.VAlign(VAlign_Center)
				[
					SNew(SBorder)
					.BorderImage(&SlotBrush)
					.Padding(FMargin(12.0f, 6.0f))
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot()
						.AutoWidth()
						.VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Text(FText::FromString(Number))
							.Font(WonderlandUi::Sans(14, true))
							.ColorAndOpacity(WonderlandUi::Coral())
						]
						+ SHorizontalBox::Slot()
						.FillWidth(1.0f)
						.HAlign(HAlign_Right)
						.VAlign(VAlign_Center)
						.Padding(12.0f, 0.0f, 0.0f, 0.0f)
						[
							SNew(STextBlock)
							.Text(FText::FromString(Agents[Index]))
							.Font(WonderlandUi::Sans(12))
							.ColorAndOpacity(WonderlandUi::Cream())
						]
					]
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(10.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(SWonderlandHexBadge).Size(34.0f).Color(WonderlandUi::Coral()).InnerMark(true)
				];
		}
		List->AddSlot()
			.AutoHeight()
			.Padding(0.0f, 0.0f, 0.0f, 8.0f)
			[
				Row.ToSharedRef()
			];
	}
	return List;
}

void SWonderlandLiveTerminal::RebuildJuliusBody()
{
	if (!JuliusBody.IsValid())
	{
		return;
	}
	JuliusBody->ClearChildren();
	if (JuliusRows.Num() == 0)
	{
		JuliusBody->AddSlot().AutoHeight()
		[
			MakeRestingLine(TEXT("Not connected. Julius execution appears here when Relay is connected."))
		];
		return;
	}
	const int32 First = FMath::Max(0, JuliusRows.Num() - 2);
	for (int32 Index = First; Index < JuliusRows.Num(); ++Index)
	{
		const FRow& Row = JuliusRows[Index];
		JuliusBody->AddSlot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 5.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("\u25CF"))).Font(WonderlandUi::Mono(6)).ColorAndOpacity(WonderlandUi::Gold())
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 7.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Row.Time)).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Gold())
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 5.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Row.Role + TEXT(":"))).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Gold(0.9f))
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(Row.Headline)).Font(WonderlandUi::Mono(9)).ColorAndOpacity(WonderlandUi::Cream())
				.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
			]
		];
		// The sub-line only on the newest row, as the approved panel does.
		if (Index == JuliusRows.Num() - 1 && !Row.Detail.IsEmpty())
		{
			JuliusBody->AddSlot().AutoHeight().Padding(18.0f, 0.0f, 0.0f, 0.0f)
			[
				MakeRestingLine(Row.Detail)
			];
		}
	}
}

void SWonderlandLiveTerminal::AddJuliusRow(const FString& Role, const FString& Headline, const FString& Detail)
{
	const FString Time = FDateTime::Now().ToString(TEXT("%H:%M:%S"));
	JuliusRows.Add({ Time, Role, Headline, Detail });
	LatestJuliusHeadline = Headline;
	// The JULIUS 3.3 section draws its rows as the approved terminal always has: bullet, time, role, headline, sub-line.
	if (const TSharedPtr<SWonderlandWorkLog> JuliusLog = GetWorkLog(TEXT("JULIUS 3.3")))
	{
		JuliusLog->AddJuliusRow(Time, Role, Headline, Detail);
	}
}

TSharedRef<SWidget> SWonderlandLiveTerminal::MakeWorkLog(const FString& Section, const FString& Resting)
{
	TSharedPtr<SWonderlandWorkLog> Log;
	SAssignNew(Log, SWonderlandWorkLog).RestingText(Resting);
	WorkLogs.Add(Section, Log);
	return Log.ToSharedRef();
}

TSharedPtr<SWonderlandWorkLog> SWonderlandLiveTerminal::GetWorkLog(const FString& Section) const
{
	const TSharedPtr<SWonderlandWorkLog>* Found = WorkLogs.Find(Section);
	return Found != nullptr ? *Found : TSharedPtr<SWonderlandWorkLog>();
}

int32 SWonderlandLiveTerminal::GetSectionLineCount(const FString& Section) const
{
	const TSharedPtr<SWonderlandWorkLog> Log = GetWorkLog(Section);
	return Log.IsValid() ? Log->GetLineCount() : 0;
}

FString SWonderlandLiveTerminal::DescribeSection(const FString& Section, int32 MaxLines) const
{
	const TSharedPtr<SWonderlandWorkLog> Log = GetWorkLog(Section);
	return Log.IsValid() ? Log->DescribeLines(MaxLines) : FString();
}

int32 SWonderlandLiveTerminal::GetSectionVisibleRows(const FString& Section) const
{
	const TSharedPtr<SWonderlandWorkLog> Log = GetWorkLog(Section);
	return Log.IsValid() ? Log->GetVisibleRows() : 0;
}

TSharedPtr<SWidget> SWonderlandLiveTerminal::GetFocusTarget() const
{
	return Input;
}

FString SWonderlandLiveTerminal::GetInputText() const
{
	return Input.IsValid() ? Input->GetText().ToString() : FString();
}

bool SWonderlandLiveTerminal::IsCloseChord(const FKeyEvent& KeyEvent) const
{
	const FKey Key = KeyEvent.GetKey();
	return Key == EKeys::Escape || (Key == EKeys::T && KeyEvent.IsControlDown());
}

FReply SWonderlandLiveTerminal::HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent)
{
	if (IsCloseChord(KeyEvent))
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

FReply SWonderlandLiveTerminal::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (IsCloseChord(InKeyEvent))
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

void SWonderlandLiveTerminal::HandleCommitted(const FText& Text, ETextCommit::Type CommitType)
{
	if (CommitType != ETextCommit::OnEnter || !Input.IsValid())
	{
		return;
	}
	const FString Trimmed = Text.ToString().TrimStartAndEnd();
	if (Trimmed.IsEmpty())
	{
		return;
	}
	Input->SetText(FText::GetEmpty());
	OnSubmit.ExecuteIfBound(Trimmed);
	FSlateApplication::Get().SetKeyboardFocus(Input, EFocusCause::SetDirectly);
}

FString SWonderlandLiveTerminal::DescribeCommandRows() const
{
	TArray<FString> Parts;
	for (const TSharedPtr<STextBlock>& Text : CommandTexts)
	{
		Parts.Add(Text.IsValid() ? Text->GetText().ToString() : FString());
	}
	return FString::Join(Parts, TEXT("|"));
}

TSharedRef<SWidget> SWonderlandLiveTerminal::MakeLiveLine(const FString& Section, const FString& Resting)
{
	RestingLines.Add(Section, Resting);
	return SNew(STextBlock)
		.Text_Lambda([this, Section, Resting]()
		{
			const FString* Line = SectionLines.Find(Section);
			return FText::FromString(Line != nullptr ? *Line : Resting);
		})
		.Font(WonderlandUi::Mono(9))
		.ColorAndOpacity_Lambda([this, Section]()
		{
			return FSlateColor(SectionLines.Contains(Section) ? WonderlandUi::Cream() : WonderlandUi::Dim());
		})
		.OverflowPolicy(ETextOverflowPolicy::Ellipsis);
}

void SWonderlandLiveTerminal::SetSectionState(const FString& Section, const FString& State, const FString& Line)
{
	if (!State.IsEmpty())
	{
		SectionStates.Add(Section, State);
	}
	if (!Line.IsEmpty())
	{
		SectionLines.Add(Section, Line);
		if (const TSharedPtr<SWonderlandWorkLog> Log = GetWorkLog(Section))
		{
			Log->AddLine(EWonderlandRoleLineKind::Log, Line);
		}
	}
}

FString SWonderlandLiveTerminal::GetSectionState(const FString& Section) const
{
	if (const FString* Live = SectionStates.Find(Section))
	{
		return *Live;
	}
	const FString* Resting = RestingStates.Find(Section);
	return Resting != nullptr ? *Resting : FString();
}

void SWonderlandLiveTerminal::ResetSimulation()
{
	SimulatedCharacters = 0;
	SimulatedCountedLines.Reset();
	SectionStates.Reset();
	SectionLines.Reset();
	JuliusRows.Reset();
	LatestJuliusHeadline.Reset();
	RebuildJuliusBody();
	for (const TPair<FString, TSharedPtr<SWonderlandWorkLog>>& Pair : WorkLogs)
	{
		if (Pair.Value.IsValid())
		{
			Pair.Value->Reset();
		}
	}

}

void SWonderlandLiveTerminal::UpdateSimulatedTokenCount()
{
	if (!bSimulated)
	{
		return;
	}
	// Count only newly emitted text. Including the separator between batches makes the result independent of frame rate.
	// This is a deterministic simulation estimate, never a claim about a provider's tokenizer or billed usage.
	for (const TPair<FString, TSharedPtr<SWonderlandWorkLog>>& Pair : WorkLogs)
	{
		if (!Pair.Value.IsValid())
		{
			continue;
		}
		int32& CountedLines = SimulatedCountedLines.FindOrAdd(Pair.Key);
		const int32 LineCount = Pair.Value->GetLineCount();
		if (LineCount > CountedLines)
		{
			SimulatedCharacters += Pair.Value->DescribeLines(LineCount - CountedLines).Len();
			SimulatedCharacters += CountedLines > 0 ? 1 : 0;
			CountedLines = LineCount;
		}
	}
}

void SWonderlandLiveTerminal::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	// THE TAB STRIP FOLLOWS THE TASK SET, and is rebuilt only when that set actually changes. A signature rather
	// than a rebuild every frame: this terminal redraws constantly, and re-creating a row of buttons sixty times a
	// second to show the same three tabs would be work nobody asked for.
	if (OnGetTaskTabs.IsBound())
	{
		FString Signature;
		for (const FTaskTab& Tab : OnGetTaskTabs.Execute())
		{
			Signature += FString::Printf(TEXT("%s|%s|%d|%d;"),
				*Tab.Id.ToString(EGuidFormats::Digits), *Tab.Label, Tab.bSelected ? 1 : 0, Tab.bDraft ? 1 : 0);
		}
		Signature += FString::Printf(TEXT("closed=%d"), ClosedTaskCount.Get(0));
		if (Signature != TaskTabSignature)
		{
			TaskTabSignature = Signature;
			RebuildTaskTabs();
		}
	}

	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	UpdateSimulatedTokenCount();
	// HOW MANY LINES EACH SECTION SHOWS, AND HOW TALL THE TERMINAL IS. The whole viewport is this widget, so its height is
	// the screen's. The terminal may extend from its approved 27.3% to a hard 42% of the screen; within that, every section
	// shows at least one line (as in the founder's image), the stage's focus section up to ten, a working section up to
	// four, Julius up to three -- trimmed back, focus last, until they all fit. Nothing is ever left to scroll.
	static const TCHAR* const Order[] = { TEXT("PROMPT ARCHITECT"), TEXT("CODING AGENT"), TEXT("JULIUS 3.3"), TEXT("INDEPENDENT REVIEWER") };
	const float ScreenHeight = static_cast<float>(AllottedGeometry.GetLocalSize().Y);
	if (ScreenHeight < 100.0f || !WindowWidget.IsValid())
	{
		return;
	}
	const float BaseHeight = ScreenHeight * (0.969f - 0.696f);
	ExtensionLimit = ScreenHeight * (0.42f - 0.273f);
	const float Row = SWonderlandWorkLog::RowHeight;

	// The window's own chrome: its height now, less the bodies inside it.
	float Bodies = 0.0f;
	TSharedPtr<SWonderlandWorkLog> Logs[4];
	for (int32 Index = 0; Index < 4; ++Index)
	{
		Logs[Index] = GetWorkLog(Order[Index]);
		if (Logs[Index].IsValid())
		{
			Bodies += Logs[Index]->GetShownHeight();
		}
	}
	const float WindowHeight = static_cast<float>(WindowWidget->GetCachedGeometry().GetLocalSize().Y);
	const float Chrome = WindowHeight > 1.0f ? FMath::Max(WindowHeight - Bodies, 60.0f) : 200.0f;
	const int32 Budget = FMath::Max(4, FMath::FloorToInt((BaseHeight + ExtensionLimit - Chrome) / Row));

	int32 Want[4];
	int32 Sum = 0;
	for (int32 Index = 0; Index < 4; ++Index)
	{
		const FString Section = Order[Index];
		const FString State = GetSectionState(Section);
		const bool bResting = State == TEXT("WAITING") || State == TEXT("STANDBY") || State.IsEmpty();
		int32 Cap = bResting ? 1 : 4;
		if (Section == TEXT("JULIUS 3.3"))
		{
			Cap = bResting ? 1 : 3;
		}
		if (Section == FocusSection)
		{
			Cap = 10;
		}
		const int32 Rows = Logs[Index].IsValid() ? Logs[Index]->GetRowCount() : 1;
		Want[Index] = FMath::Clamp(Rows, 1, Cap);
		Sum += Want[Index];
	}
	// Trim to the budget: the others first, down to two lines; then everything down to one; the focus section last.
	for (int32 Floor : { 2, 1 })
	{
		for (int32 Pass = 0; Pass < 2 && Sum > Budget; ++Pass)
		{
			for (int32 Index = 0; Index < 4 && Sum > Budget; ++Index)
			{
				const bool bFocus = FString(Order[Index]) == FocusSection;
				if ((Pass == 0) == bFocus)
				{
					continue;
				}
				while (Want[Index] > Floor && Sum > Budget)
				{
					--Want[Index];
					--Sum;
				}
			}
		}
	}
	for (int32 Index = 0; Index < 4; ++Index)
	{
		if (Logs[Index].IsValid())
		{
			Logs[Index]->SetVisibleRows(Want[Index]);
		}
	}
	// THE TERMINAL EXTENDS ONLY AS FAR AS ITS LINES NEED, easing there rather than jumping.
	const float Needed = Chrome + static_cast<float>(Sum) * Row;
	const float Target = FMath::Clamp(Needed - BaseHeight, 0.0f, ExtensionLimit);
	const float Alpha = 1.0f - FMath::Exp(-FMath::Clamp(InDeltaTime, 0.0f, 0.2f) * 5.0f);
	ExtensionShown = FMath::Abs(Target - ExtensionShown) < 0.5f ? Target : FMath::Lerp(ExtensionShown, Target, Alpha);
}

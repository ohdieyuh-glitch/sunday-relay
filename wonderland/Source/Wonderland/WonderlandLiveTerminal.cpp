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
		SNew(SBorder)
		.BorderImage(&WindowBrush)
		.Padding(FMargin(10.0f, 9.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(2.0f, 0.0f, 0.0f, 4.0f)
			[
				// Never a paid run by accident: while simulated rows are showing, the terminal says so first.
				SNew(STextBlock)
				.Visibility_Lambda([this]() { return bSimulated ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
				.Text(FText::FromString(TEXT("DEVELOPMENT PREVIEW \u00B7 SIMULATED JULIUS EXECUTION")))
				.Font(WonderlandUi::Sans(8, true, 140))
				.ColorAndOpacity(WonderlandUi::Coral())
			]
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			[
				SNew(SScrollBox)
				.ScrollBarVisibility(EVisibility::Collapsed)
				+ SScrollBox::Slot().Padding(0.0f, 0.0f, 0.0f, 5.0f)
				[
					MakeSection(TEXT("PROMPT ARCHITECT"), TEXT("WAITING"), MakeLiveLine(TEXT("PROMPT ARCHITECT"), TEXT("No activity yet.")))
				]
				+ SScrollBox::Slot().Padding(0.0f, 0.0f, 0.0f, 5.0f)
				[
					MakeSection(TEXT("CODING AGENT"), TEXT("WAITING"), MakeLiveLine(TEXT("CODING AGENT"), TEXT("No activity yet.")))
				]
				+ SScrollBox::Slot().Padding(0.0f, 0.0f, 0.0f, 5.0f)
				[
					MakeSection(TEXT("JULIUS 3.3"), TEXT("STANDBY"), JuliusBody.ToSharedRef())
				]
				+ SScrollBox::Slot()
				[
					MakeSection(TEXT("INDEPENDENT REVIEWER"), TEXT("WAITING"),
						MakeLiveLine(TEXT("INDEPENDENT REVIEWER"), TEXT("Reviewer: Independent review begins after Julius verification.")))
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
		// 39.2% wide, 27.3% tall, bottom-centred with a 3.1% margin: the approved web measurement.
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.304f, 0.696f, 0.696f, 0.969f))
		.Offset(FMargin(0.0f))
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
	JuliusRows.Add({ FDateTime::Now().ToString(TEXT("%H:%M:%S")), Role, Headline, Detail });
	RebuildJuliusBody();
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
	SectionStates.Reset();
	SectionLines.Reset();
	JuliusRows.Reset();
	RebuildJuliusBody();
}


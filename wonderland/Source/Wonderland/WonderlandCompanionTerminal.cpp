#include "WonderlandCompanionTerminal.h"

#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandPixelText.h"
#include "WonderlandUiStyle.h"

namespace
{
	// Named for this file alone: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
	TAutoConsoleVariable<float> CVarCompanionTerminalTitleCell(
		TEXT("wl.Companion.TitleCell"), 3.4f,
		TEXT("Slate units per cell of the companion terminal titles' pixel type."));

	// The frame's gold is warmer and brighter than the Julius window's hairline: in the founder's frame these panels
	// sit at the screen's edge over bright stone and carry a heavy amber border.
	FLinearColor CompanionFrameGold(float Alpha = 1.0f) { return WonderlandUi::Srgb(0xE3, 0xA5, 0x3E, Alpha); }
	FLinearColor CompanionTitleGold() { return WonderlandUi::Srgb(0xF4, 0xAA, 0x3E); }
}

SWonderlandCompanionTerminal::SWonderlandCompanionTerminal()
	: FrameBrush(WonderlandUi::Srgb(4, 4, 6, 0.93f), 8.0f, CompanionFrameGold(), 2.5f)
	, RuleBrush(CompanionFrameGold(0.9f), 0.0f)
{
}

void SWonderlandCompanionTerminal::Construct(const FArguments& InArgs)
{
	Title = InArgs._Title;
	Accent = InArgs._Accent;
	OnSubmit = InArgs._OnSubmit;
	OnRequestClose = InArgs._OnRequestClose;

	FSlateBrush NoBackground;
	NoBackground.DrawAs = ESlateBrushDrawType::NoDrawType;
	InputStyle = FCoreStyle::Get().GetWidgetStyle<FEditableTextBoxStyle>("NormalEditableTextBox");
	InputStyle.SetBackgroundImageNormal(NoBackground)
		.SetBackgroundImageHovered(NoBackground)
		.SetBackgroundImageFocused(NoBackground)
		.SetFont(WonderlandUi::Mono(11))
		.SetForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetFocusedForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetPadding(FMargin(2.0f, 3.0f));

	SAssignNew(Log, SVerticalBox);
	RebuildLog();

	const TAttribute<float> TitleCell = TAttribute<float>::CreateLambda([]() { return CVarCompanionTerminalTitleCell.GetValueOnGameThread(); });
	FSlateFontInfo IntroFont = WonderlandUi::Mono(12);
	IntroFont.LetterSpacing = 90;
	const FSlateFontInfo RowFont = WonderlandUi::Mono(11);

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(&FrameBrush)
		.Padding(FMargin(2.5f))
		[
			SNew(SVerticalBox)
			// THE TITLE: the chevron and the name in gold pixel type, WAITING at the right.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(16.0f, 14.0f, 14.0f, 0.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(0.0f, 0.0f, 12.0f, 0.0f)
				[
					SNew(SWonderlandPixelText)
					.Text(TEXT(">"))
					.CellSize(TitleCell)
					.Color(CompanionTitleGold())
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.HAlign(HAlign_Left)
				.VAlign(VAlign_Center)
				[
					SNew(SWonderlandPixelText)
					.Text(Title.ToUpper())
					.CellSize(TitleCell)
					.Color(CompanionTitleGold())
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Top)
				.Padding(10.0f, 1.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text(INVTEXT("WAITING"))
					.Font(WonderlandUi::Mono(10))
					.ColorAndOpacity(CompanionFrameGold())
				]
			]
			// THE COMPANION'S LINE, in wide cream capitals.
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(16.0f, 13.0f, 14.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(InArgs._Intro.ToUpper()))
				.Font(IntroFont)
				.ColorAndOpacity(WonderlandUi::Cream())
				.LineHeightPercentage(1.2f)
			]
			// THE LOG: open until a line is recorded.
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			.Padding(16.0f, 8.0f, 14.0f, 6.0f)
			[
				Log.ToSharedRef()
			]
			// THE RULE, edge to edge inside the frame.
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SBox)
				.HeightOverride(1.5f)
				[
					SNew(SBorder)
					.BorderImage(&RuleBrush)
					.Padding(0.0f)
				]
			]
			// THE COMMAND LINE: chevron and input, then Send and its chord ruled off at the right.
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SBox)
				.HeightOverride(38.0f)
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(16.0f, 0.0f, 6.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT(">"))
						.Font(WonderlandUi::Mono(12))
						.ColorAndOpacity(WonderlandUi::Cream())
					]
					+ SHorizontalBox::Slot()
					.FillWidth(1.0f)
					.VAlign(VAlign_Center)
					.Padding(0.0f, 0.0f, 8.0f, 0.0f)
					[
						SAssignNew(Input, SEditableTextBox)
						.Style(&InputStyle)
						.ClearKeyboardFocusOnCommit(false)
						.RevertTextOnEscape(false)
						.SelectAllTextWhenFocused(false)
						.OnKeyDownHandler(this, &SWonderlandCompanionTerminal::HandleInputKeyDown)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Fill)
					[
						SNew(SBox)
						.WidthOverride(1.5f)
						[
							SNew(SBorder)
							.BorderImage(&RuleBrush)
							.Padding(0.0f)
						]
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(16.0f, 0.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT("Send"))
						.Font(RowFont)
						.ColorAndOpacity(WonderlandUi::Cream())
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(14.0f, 0.0f, 16.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT("Ctrl+Enter"))
						.Font(RowFont)
						.ColorAndOpacity(WonderlandUi::Cream())
					]
				]
			]
		]
	];
}

void SWonderlandCompanionTerminal::RebuildLog()
{
	if (!Log.IsValid())
	{
		return;
	}
	Log->ClearChildren();
	for (int32 Index = FMath::Max(0, Lines.Num() - 2); Index < Lines.Num(); ++Index)
	{
		const FLine& Line = Lines[Index];
		Log->AddSlot()
		.AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(0.0f, 0.0f, Line.Speaker.IsEmpty() ? 0.0f : 6.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(Line.Speaker.IsEmpty() ? FString() : Line.Speaker + TEXT(":")))
				.Font(WonderlandUi::Mono(10))
				.ColorAndOpacity(Accent)
			]
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			.VAlign(VAlign_Center)
			[
				SNew(STextBlock)
				.Text(FText::FromString(Line.Text))
				.Font(WonderlandUi::Mono(10))
				.ColorAndOpacity(Line.bDim ? WonderlandUi::Dim() : WonderlandUi::Cream())
				.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
			]
		];
	}
}

void SWonderlandCompanionTerminal::AddLine(const FString& Speaker, const FString& Text, bool bDim)
{
	Lines.Add({Speaker, Text, bDim});
	RebuildLog();
}

TSharedPtr<SWidget> SWonderlandCompanionTerminal::GetFocusTarget() const
{
	return Input;
}

FString SWonderlandCompanionTerminal::GetInputText() const
{
	return Input.IsValid() ? Input->GetText().ToString() : FString();
}

void SWonderlandCompanionTerminal::Submit()
{
	if (!Input.IsValid())
	{
		return;
	}
	const FString Trimmed = Input->GetText().ToString().TrimStartAndEnd();
	if (Trimmed.IsEmpty())
	{
		return;
	}
	Input->SetText(FText::GetEmpty());
	OnSubmit.ExecuteIfBound(Trimmed);
	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetKeyboardFocus(Input, EFocusCause::SetDirectly);
	}
}

FReply SWonderlandCompanionTerminal::HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent)
{
	const FKey Key = KeyEvent.GetKey();
	// Enter sends, and so does the Ctrl+Enter the panel advertises. Handled here, first, so the text box never
	// also commits the same line.
	if (Key == EKeys::Enter)
	{
		Submit();
		return FReply::Handled();
	}
	// The Live Terminal's close chords, so a companion line being typed never traps the keyboard.
	if (Key == EKeys::Escape || (Key == EKeys::T && KeyEvent.IsControlDown()))
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

#include "WonderlandCompanionTerminal.h"

#include "Framework/Application/SlateApplication.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

SWonderlandCompanionTerminal::SWonderlandCompanionTerminal()
	// Darker and more opaque than the Julius window, which sits over the lower third: a companion terminal
	// sits over bright stone and sky at the screen's edge and must read as a black console there.
	: WindowBrush(WonderlandUi::Srgb(5, 6, 9, 0.90f), 9.0f, WonderlandUi::Gold(0.78f), 1.5f)
	, InputBrush(WonderlandUi::Srgb(2, 3, 5, 0.94f), 5.0f, WonderlandUi::GoldDim(), 1.0f)
	, DividerBrush(WonderlandUi::GoldDim(), 0.0f)
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
		.SetFont(WonderlandUi::Mono(10))
		.SetForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetFocusedForegroundColor(FSlateColor(WonderlandUi::Cream()))
		.SetPadding(FMargin(4.0f, 3.0f));

	SAssignNew(Log, SVerticalBox);
	RebuildLog();

	// The title is set in the terminal's monospace, weighted by a one-pixel shadow in its own gold: the
	// engine carries no bold monospace, and a sans title would stop the panel reading as a CLI.
	const FSlateFontInfo TitleFont = WonderlandUi::Mono(16);
	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(&WindowBrush)
		.Padding(FMargin(14.0f, 10.0f, 14.0f, 10.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(0.0f, 0.0f, 9.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text(INVTEXT(">"))
					.Font(TitleFont)
					.ColorAndOpacity(WonderlandUi::Gold())
					.ShadowOffset(FVector2D(1.0f, 0.0f))
					.ShadowColorAndOpacity(WonderlandUi::Gold())
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text(FText::FromString(Title.ToUpper()))
					.Font(TitleFont)
					.ColorAndOpacity(WonderlandUi::Gold())
					.ShadowOffset(FVector2D(1.0f, 0.0f))
					.ShadowColorAndOpacity(WonderlandUi::Gold())
					.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(10.0f, 0.0f, 6.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text(FText::FromString(TEXT("●")))
					.Font(WonderlandUi::Mono(8))
					.ColorAndOpacity(Accent)
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text(INVTEXT("WAITING"))
					.Font(WonderlandUi::Sans(9, true, 120))
					.ColorAndOpacity(WonderlandUi::Gold())
				]
			]
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.0f, 1.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(InArgs._ClassLine))
				.Font(WonderlandUi::Mono(8))
				.ColorAndOpacity(WonderlandUi::Dim())
			]
			+ SVerticalBox::Slot()
			.AutoHeight()
			.Padding(0.0f, 8.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock)
				.Text(FText::FromString(InArgs._Intro.ToUpper()))
				.Font(WonderlandUi::Mono(10))
				.ColorAndOpacity(WonderlandUi::Cream())
				.AutoWrapText(true)
			]
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			.Padding(0.0f, 6.0f, 0.0f, 7.0f)
			[
				Log.ToSharedRef()
			]
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SBorder)
				.BorderImage(&InputBrush)
				.Padding(FMargin(9.0f, 1.0f, 10.0f, 1.0f))
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					[
						SNew(STextBlock)
						.Text(INVTEXT(">"))
						.Font(WonderlandUi::Mono(11))
						.ColorAndOpacity(WonderlandUi::Gold())
					]
					+ SHorizontalBox::Slot()
					.FillWidth(1.0f)
					.VAlign(VAlign_Center)
					.Padding(6.0f, 0.0f, 8.0f, 0.0f)
					[
						SAssignNew(Input, SEditableTextBox)
						.Style(&InputStyle)
						.HintText(FText::FromString(FString::Printf(TEXT("Message %s"), *Title)))
						.ClearKeyboardFocusOnCommit(false)
						.RevertTextOnEscape(false)
						.SelectAllTextWhenFocused(false)
						.OnKeyDownHandler(this, &SWonderlandCompanionTerminal::HandleInputKeyDown)
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Fill)
					.Padding(0.0f, 5.0f, 0.0f, 5.0f)
					[
						SNew(SBox)
						.WidthOverride(1.0f)
						[
							SNew(SBorder)
							.BorderImage(&DividerBrush)
							.Padding(0.0f)
						]
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(11.0f, 0.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT("Send"))
						.Font(WonderlandUi::Sans(10, true))
						.ColorAndOpacity(WonderlandUi::Cream())
					]
					+ SHorizontalBox::Slot()
					.AutoWidth()
					.VAlign(VAlign_Center)
					.Padding(9.0f, 0.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(INVTEXT("Ctrl+Enter"))
						.Font(WonderlandUi::Mono(9))
						.ColorAndOpacity(WonderlandUi::Dim())
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
	if (Lines.Num() == 0)
	{
		Log->AddSlot()
		.AutoHeight()
		[
			SNew(STextBlock)
			.Text(FText::FromString(FString::Printf(TEXT("Not connected. %s is not imported into this world yet."), *Title)))
			.Font(WonderlandUi::Mono(9))
			.ColorAndOpacity(WonderlandUi::Dim())
			.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
		];
		return;
	}
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
				.Font(WonderlandUi::Mono(9))
				.ColorAndOpacity(Accent)
			]
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			.VAlign(VAlign_Center)
			[
				SNew(STextBlock)
				.Text(FText::FromString(Line.Text))
				.Font(WonderlandUi::Mono(9))
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

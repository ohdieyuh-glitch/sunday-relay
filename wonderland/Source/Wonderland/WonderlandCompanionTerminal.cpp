#include "WonderlandCompanionTerminal.h"

#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SScrollBox.h"
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
	, RuleBrush(WonderlandUi::Srgb(58, 58, 61), 0.0f)
	, BodyBrush(WonderlandUi::Srgb(22, 22, 24), 0.0f)
	, CommandBrush(WonderlandUi::Srgb(43, 43, 46), 2.0f)
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
	Intro = InArgs._Intro.Replace(TEXT("\n"), TEXT(" "));
	// Only the supplied asset is used. No substitute branding is drawn when it is absent.
	const FString SymbolPath = FPaths::ProjectContentDir() / TEXT("UI/iWonderActivity.png");
	if (IFileManager::Get().FileExists(*SymbolPath))
	{
		ActivityBrush = MakeShared<FSlateDynamicImageBrush>(FName(*SymbolPath), FVector2D(16.0f, 16.0f));
	}
	RebuildLog();

	const TAttribute<float> TitleCell = TAttribute<float>::CreateLambda([]() { return CVarCompanionTerminalTitleCell.GetValueOnGameThread(); });
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
				// CLIPPED, so a long name can never draw over the state at the right. A companion called "Claude Code
				// Fable 5" is wider than one called "Astra", and the state is the part that must stay readable.
				SNew(SHorizontalBox)
				.Clipping(EWidgetClipping::ClipToBounds)
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
					.Text_Lambda([this]() { return FText::FromString(Status); })
					.Font(WonderlandUi::Mono(10))
					// Waiting in the frame's gold; working in the companion's own colour, so it is plain which is live.
					.ColorAndOpacity_Lambda([this]() { return FSlateColor(Status == TEXT("WAITING") ? CompanionFrameGold() : Accent); })
				]
			]
			// Everything below the locked title is a compact terminal body.
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			.Padding(0.0f, 8.0f, 0.0f, 0.0f)
			[
				SNew(SBorder).BorderImage(&BodyBrush).Padding(0.0f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(12.0f, 5.0f, 12.0f, 3.0f)
					[
						SNew(STextBlock)
						.Visibility_Lambda([this]() { return IsSimulatedActivity() ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
						.Text(INVTEXT("DEVELOPMENT PREVIEW · SIMULATED /JOIN IN"))
						.Font(WonderlandUi::Mono(8))
						.ColorAndOpacity(WonderlandUi::Srgb(152, 152, 158))
					]
					+ SVerticalBox::Slot().FillHeight(1.0f).Padding(10.0f, 2.0f, 8.0f, 2.0f)
					[
						SAssignNew(Transcript, SScrollBox)
						.Orientation(Orient_Vertical)
						.ScrollBarThickness(FVector2D(3.0f, 3.0f))
						.AnimateWheelScrolling(false)
						.OnUserScrolled_Lambda([this](float Offset)
						{
							bFollowOutput = Transcript.IsValid() && Offset >= Transcript->GetScrollOffsetOfEnd() - 2.0f;
						})
						+ SScrollBox::Slot()[Log.ToSharedRef()]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(12.0f, 3.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 6.0f, 0.0f)
						[
							SNew(SBox).WidthOverride(16.0f).HeightOverride(16.0f)
							.Visibility(ActivityBrush.IsValid() ? EVisibility::HitTestInvisible : EVisibility::Collapsed)
							[
								SAssignNew(ActivitySymbol, SImage).Image(ActivityBrush.Get())
							]
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Text_Lambda([this]() { return FText::FromString(GetActivityLabel()); })
							.Font(WonderlandUi::Mono(9))
							.ColorAndOpacity(WonderlandUi::Srgb(190, 190, 196))
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock)
							.Text_Lambda([this]() { return FText::Format(INVTEXT("{0} LINES"), FText::AsNumber(Lines.Num())); })
							.Font(WonderlandUi::Mono(8))
							.ColorAndOpacity(WonderlandUi::Srgb(136, 136, 142))
						]
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SBox).HeightOverride(1.0f)
						[SNew(SBorder).BorderImage(&RuleBrush).Padding(0.0f)]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(8.0f, 5.0f)
					[
						SNew(SBorder).BorderImage(&CommandBrush).Padding(5.0f, 1.0f)
						[
							SNew(SHorizontalBox)
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(2.0f, 0.0f, 6.0f, 0.0f)
							[SNew(STextBlock).Text(INVTEXT(">" )).Font(RowFont).ColorAndOpacity(WonderlandUi::Cream())]
							+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
							[
								SAssignNew(Input, SEditableTextBox).Style(&InputStyle)
								.ClearKeyboardFocusOnCommit(false).RevertTextOnEscape(false).SelectAllTextWhenFocused(false)
								.OnKeyDownHandler(this, &SWonderlandCompanionTerminal::HandleInputKeyDown)
							]
							+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(6.0f, 0.0f)
							[SNew(STextBlock).Text(INVTEXT("Ctrl+Enter")).Font(WonderlandUi::Mono(8)).ColorAndOpacity(WonderlandUi::Srgb(152, 152, 158))]
						]
					]
				]
			]
		]
	];
}

void SWonderlandCompanionTerminal::RebuildLog()
{
	if (!Log.IsValid()) { return; }
	Log->ClearChildren();
	Log->AddSlot().AutoHeight().Padding(2.0f, 3.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Intro))
		.Visibility_Lambda([this]() { return Lines.IsEmpty() ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
		.Font(WonderlandUi::Mono(10)).ColorAndOpacity(WonderlandUi::Srgb(148, 148, 154))
		.AutoWrapText(true)
	];
	for (const FLine& Line : Lines) { AppendLogRow(Line); }
}

void SWonderlandCompanionTerminal::AppendLogRow(const FLine& Line)
{
	const bool bCommand = Line.Speaker.Equals(TEXT("You"), ESearchCase::IgnoreCase);
	Log->AddSlot().AutoHeight().Padding(0.0f, 1.0f)
	[
		SNew(SBorder).BorderImage(bCommand ? &CommandBrush : &BodyBrush).Padding(3.0f, 2.0f)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock)
				.Visibility(Line.Speaker.IsEmpty() ? EVisibility::Collapsed : EVisibility::HitTestInvisible)
				.Text(FText::FromString(bCommand ? TEXT("> You") : Line.Speaker))
				.Font(WonderlandUi::Mono(8)).ColorAndOpacity(WonderlandUi::Srgb(165, 165, 173))
			]
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(FText::FromString(Line.Text))
				.Font(WonderlandUi::Mono(10)).AutoWrapText(true)
				.ColorAndOpacity(Line.bDim ? WonderlandUi::Srgb(148, 148, 154) : WonderlandUi::Srgb(218, 218, 222))
			]
		]
	];
}

void SWonderlandCompanionTerminal::AddLine(const FString& Speaker, const FString& Text, bool bDim)
{
	Lines.Add({Speaker, Text, bDim});
	if (Log.IsValid()) { AppendLogRow(Lines.Last()); }
	// Appending does not rebuild prior rows or steal the position from a reader who scrolled up.
	if (bFollowOutput && Transcript.IsValid()) { Transcript->ScrollToEnd(); }
}

void SWonderlandCompanionTerminal::SetStatus(const FString& InStatus)
{
	Status = InStatus;
}

bool SWonderlandCompanionTerminal::IsSimulatedActivity() const
{
	return Status.Contains(TEXT("JOINED")) || !NarratedBeat.IsNone();
}

FString SWonderlandCompanionTerminal::GetActivityLabel() const
{
	if (Status.Contains(TEXT("DONE"))) { return TEXT("COMPLETED"); }
	if (!Status.Contains(TEXT("JOINED"))) { return Status; }
	if (LatestActivity == TEXT("STOPPED")) { return TEXT("FAILED"); }
	if (LatestActivity == TEXT("WAITING") || LatestActivity == TEXT("HOLDING CLEAR")
		|| LatestActivity == TEXT("RETURNED WORK") || LatestActivity == TEXT("HANDOFF")) { return TEXT("WAITING"); }
	if (LatestActivity == TEXT("RESEARCHING")) { return TEXT("SEARCHING"); }
	if (LatestActivity == TEXT("REASONING") || LatestActivity == TEXT("PLANNING")
		|| LatestActivity == TEXT("CROSS-CHECKING")) { return TEXT("ANALYSING"); }
	if (LatestActivity.StartsWith(TEXT("EXECUTING"))) { return TEXT("RUNNING"); }
	return TEXT("WORKING");
}

bool SWonderlandCompanionTerminal::IsProcessing() const
{
	const FString Activity = GetActivityLabel();
	return Activity == TEXT("THINKING") || Activity == TEXT("ANALYSING") || Activity == TEXT("SEARCHING")
		|| Activity == TEXT("WORKING") || Activity == TEXT("RUNNING");
}

void SWonderlandCompanionTerminal::Tick(const FGeometry& Geometry, const double Time, const float DeltaTime)
{
	SCompoundWidget::Tick(Geometry, Time, DeltaTime);
	// A small pulse only while the observed state is active; idle, auth and failure settle immediately.
	if (IsProcessing()) { ActivityPhase += FMath::Max(DeltaTime, 0.0f) * 4.0f; }
	else { ActivityPhase = 0.0f; }
	if (ActivitySymbol.IsValid())
	{
		// Rotate the founder-supplied mark only for an observed active companion state.
		// A coin-like horizontal spin: the mark narrows to its edge, then reveals its reverse face.
		ActivitySymbol->SetRenderTransform(FSlateRenderTransform(FScale2D(FMath::Cos(ActivityPhase), 1.0f)));
		ActivitySymbol->SetRenderTransformPivot(FVector2D(0.5f, 0.5f));
		ActivitySymbol->SetRenderOpacity(IsProcessing() ? 1.0f : 0.72f);
	}
}

void SWonderlandCompanionTerminal::ClearLines()
{
	Lines.Reset();
	LatestActivity.Reset();
	NarratedBeat = NAME_None;
	bFollowOutput = true;
	RebuildLog();
	if (Transcript.IsValid()) { Transcript->ScrollToStart(); }
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

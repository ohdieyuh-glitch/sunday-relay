#include "WonderlandCompanionConsole.h"

#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

// Named for this file alone: the module is one unity translation unit.
namespace WonderlandConsoleDetail
{
	/**
	 * THE CYCLE, MEASURED FROM THE REFERENCE. The glyph goes from its dot to its fullest shape and back to the dot in
	 * 2.0 s (IMG_2179.mov, 30 fps: dot at 4.0-4.4 s and again at 6.1-6.4 s), and the verb changes colour twice in the
	 * same 2 s -- pale while the glyph grows, red while it shrinks. Twelve frames of 167 ms: six shapes out, six back.
	 */
	constexpr float CycleSeconds = 2.0f;
	/** Waiting is the same cycle, slower: the founder's "WAITING (slower cadence)". */
	constexpr float WaitCycleSeconds = 3.2f;
	/** A rising line settles in about a sixth of a second; a burst bigger than the view jumps most of the way first. */
	constexpr float ScrollRate = 16.0f;
	/** A new line fades up from this much light over FadeSeconds, so lines arrive rather than blink in. */
	constexpr float FadeFloor = 0.35f;
	constexpr float FadeSeconds = 0.14f;
	/** History kept per console; the oldest go in blocks so the rows are rebuilt rarely. */
	constexpr int32 MaxLines = 400;
	constexpr int32 DropBlock = 50;
	/** A backlog longer than this plays four times as fast: activity can accelerate, nothing is skipped. */
	constexpr int32 BacklogFast = 10;
	/** Float, so the cycle's trigonometry stays in float (UE's PI is a double). */
	constexpr float TwoPi = 6.28318530718f;

	/**
	 * HOW LONG THE VERB TAKES TO PASS THROUGH ORANGE AND GOLD, as a fraction of the cycle, each way. The reference passes
	 * quickly (one to five frames); the founder asked that it "feel like a living glow ... cycling/fading naturally". A
	 * knob, so the founder's eye on the video can set it without a build.
	 */
	TAutoConsoleVariable<float> CVarConsoleWarmPassage(
		TEXT("wl.Console.WarmPassage"), 0.14f,
		TEXT("Fraction of the companion console's 2 s cycle the verb spends passing between red and cream, each way (0.02-0.4)."));

	inline FLinearColor Lin(uint8 R, uint8 G, uint8 B, float A = 1.0f) { return WonderlandUi::Srgb(R, G, B, A); }

	// THE WARM BAND. The reference's verb sits in a salmon red half the cycle and a pale cream the other half; the founder
	// reads the passage between as "red/pink, orange, yellow/gold". These are its stops, in that order.
	FLinearColor WarmStop(int32 Index)
	{
		switch (Index)
		{
		case 0:  return Lin(0xEA, 0x63, 0x70);
		case 1:  return Lin(0xF2, 0x8C, 0x42);
		case 2:  return Lin(0xF6, 0xC4, 0x4F);
		default: return Lin(0xF4, 0xEB, 0xD8);
		}
	}
	/** The i.Wonder mark's own yellow, at rest (founder, P1 item 9). The same value the older terminal drew it in. */
	FLinearColor RestGold() { return FLinearColor(1.00f, 0.78f, 0.16f, 1.0f); }
	FLinearColor ErrorRed() { return Lin(0xEF, 0x5B, 0x5B); }
	FLinearColor OkGreen() { return Lin(0x6F, 0xC2, 0x76); }
	FLinearColor AddedInk() { return Lin(0x8C, 0xCF, 0x8E); }
	FLinearColor RemovedInk() { return Lin(0xE3, 0x86, 0x86); }

	/**
	 * DEEP BLACK (founder, item 11), with the faintest trace of the theme so a theme still reads across the panel. The
	 * weight is LINEAR light: 0.018 lifted the plate to about sRGB (38, 32, 13), an olive the film showed; 0.004 keeps it
	 * near (17, 15, 9).
	 */
	FLinearColor Plate() { return WonderlandUi::TintPlate(Lin(5, 5, 7, 0.97f), WonderlandUi::CompanionGold(), 0.004f); }
	FLinearColor Frame(const FLinearColor& Accent) { return FLinearColor(Accent.R, Accent.G, Accent.B, 0.85f); }

	float Smooth(float T) { T = FMath::Clamp(T, 0.0f, 1.0f); return T * T * (3.0f - 2.0f * T); }

	bool IsOutputKind(EWonderlandConsoleLine Kind)
	{
		return Kind == EWonderlandConsoleLine::Output || Kind == EWonderlandConsoleLine::Added || Kind == EWonderlandConsoleLine::Removed
			|| Kind == EWonderlandConsoleLine::Success || Kind == EWonderlandConsoleLine::Failure;
	}
	/** A block starts with these, and the reference's blank-line rhythm puts a blank row above each. */
	bool StartsBlock(EWonderlandConsoleLine Kind)
	{
		return Kind == EWonderlandConsoleLine::Say || Kind == EWonderlandConsoleLine::Tool || Kind == EWonderlandConsoleLine::Prompt
			|| Kind == EWonderlandConsoleLine::Rule || Kind == EWonderlandConsoleLine::Done;
	}
	/** Cells before the text, by kind: bullet lines at 2, commands at 4, output under the elbow at 5, marks at 7. */
	int32 IndentFor(EWonderlandConsoleLine Kind)
	{
		switch (Kind)
		{
		case EWonderlandConsoleLine::Command:  return 4;
		case EWonderlandConsoleLine::Output:
		case EWonderlandConsoleLine::Added:
		case EWonderlandConsoleLine::Removed:  return 5;
		case EWonderlandConsoleLine::Success:
		case EWonderlandConsoleLine::Failure:  return 7;
		case EWonderlandConsoleLine::Rule:
		case EWonderlandConsoleLine::Blank:    return 0;
		default:                               return 2;
		}
	}
}

/* ================================================================================================== the painted strip */

void SWonderlandConsoleStrip::Construct(const FArguments& InArgs)
{
	Height = InArgs._Height;
	OnPaintStrip = InArgs._OnPaintStrip;
	OnWheel = InArgs._OnWheel;
	OnPress = InArgs._OnPress;
	// EVERY FRAME, NOT ON CHANGE: the timer, the emblem and the rising lines move whether or not anything was invalidated.
	ForceVolatile(true);
}

int32 SWonderlandConsoleStrip::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	return OnPaintStrip.IsBound() ? OnPaintStrip.Execute(AllottedGeometry, MyCullingRect, OutDrawElements, LayerId) : LayerId;
}

FReply SWonderlandConsoleStrip::OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	return OnWheel.IsBound() ? OnWheel.Execute(MyGeometry, MouseEvent) : FReply::Unhandled();
}

FReply SWonderlandConsoleStrip::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	return OnPress.IsBound() ? OnPress.Execute(MyGeometry, MouseEvent) : FReply::Unhandled();
}

/* ======================================================================================================= the console */

SWonderlandCompanionConsole::SWonderlandCompanionConsole()
	: FrameBrush(FLinearColor::Black, 6.0f, FLinearColor::White, 1.5f)
	, PillBrush(FLinearColor::Black, 7.0f, FLinearColor::White, 1.0f)
	, DotBrush(FLinearColor::White, 3.0f)
{
}

void SWonderlandCompanionConsole::Construct(const FArguments& InArgs)
{
	using namespace WonderlandConsoleDetail;
	Title = InArgs._Title;
	Accent = InArgs._Accent;
	Emblem = InArgs._Emblem;
	OnSubmit = InArgs._OnSubmit;
	OnInterrupt = InArgs._OnInterrupt;
	OnRequestClose = InArgs._OnRequestClose;

	// COMPACT MONOSPACE, NOT HUD TYPE (founder, item 10). One size for the whole surface, as a terminal has.
	Font = WonderlandUi::Mono(9);

	BrushAccent = WonderlandUi::CompanionGold();
	FrameBrush = FSlateRoundedBoxBrush(Plate(), 6.0f, Frame(BrushAccent), 1.5f);
	PillBrush = FSlateRoundedBoxBrush(Lin(10, 10, 12, 0.97f), 7.0f, Frame(BrushAccent), 1.0f);
	// TWICE A SECOND, not every frame: a theme changes when the founder changes it and never on its own.
	RegisterActiveTimer(0.5f, FWidgetActiveTimerDelegate::CreateSP(this, &SWonderlandCompanionConsole::FollowTheme));

	FSlateBrush NoBackground;
	NoBackground.DrawAs = ESlateBrushDrawType::NoDrawType;
	InputStyle = FCoreStyle::Get().GetWidgetStyle<FEditableTextBoxStyle>("NormalEditableTextBox");
	InputStyle.SetBackgroundImageNormal(NoBackground)
		.SetBackgroundImageHovered(NoBackground)
		.SetBackgroundImageFocused(NoBackground)
		.SetBackgroundImageReadOnly(NoBackground)
		.SetFont(Font)
		.SetPadding(FMargin(0.0f, 2.0f));

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(&FrameBrush)
		.Padding(FMargin(10.0f, 6.0f, 10.0f, 3.0f))
		[
			SNew(SVerticalBox)
			// THE TITLE, THE TRANSCRIPT, THE STATUS ROW, ITS TIP AND THE RULE OVER THE INPUT: one painted strip.
			+ SVerticalBox::Slot()
			.FillHeight(1.0f)
			[
				SNew(SWonderlandConsoleStrip)
				.OnPaintStrip_Lambda([this](const FGeometry& G, const FSlateRect& C, FSlateWindowElementList& O, int32 L) { return PaintMain(G, C, O, L); })
				.OnWheel_Lambda([this](const FGeometry& G, const FPointerEvent& E) { return HandleWheel(G, E); })
				.OnPress_Lambda([this](const FGeometry& G, const FPointerEvent& E) { return HandlePress(G, E); })
			]
			// THE INPUT: "› " and the line being typed, where the reference has its "› |".
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.AutoWidth()
				.VAlign(VAlign_Center)
				.Padding(0.0f, 0.0f, 6.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text(FText::FromString(FString(TEXT("›"))))
					.Font(Font)
					.ColorAndOpacity_Lambda([this]() { return FSlateColor(WonderlandUi::CompanionText()); })
				]
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.VAlign(VAlign_Center)
				[
					SAssignNew(Input, SEditableTextBox)
					.Style(&InputStyle)
					.ForegroundColor_Lambda([]() { return FSlateColor(WonderlandUi::CompanionText()); })
					.FocusedForegroundColor_Lambda([]() { return FSlateColor(WonderlandUi::CompanionText()); })
					.HintText_Lambda([this]() { return FText::FromString(InputHint); })
					.ClearKeyboardFocusOnCommit(false)
					.RevertTextOnEscape(false)
					.SelectAllTextWhenFocused(false)
					.OnKeyDownHandler(this, &SWonderlandCompanionConsole::HandleInputKeyDown)
				]
			]
			// THE RULE UNDER THE INPUT AND THE FOOTER OF MODES.
			+ SVerticalBox::Slot()
			.AutoHeight()
			[
				SNew(SWonderlandConsoleStrip)
				.Height_Lambda([this]() { MeasureFont(); return LineH + 5.0f; })
				.OnPaintStrip_Lambda([this](const FGeometry& G, const FSlateRect& C, FSlateWindowElementList& O, int32 L) { return PaintFooter(G, C, O, L); })
			]
		]
	];
	IdleText = TEXT("Ready");
}

/* --------------------------------------------------------------------------------------------------- the transcript */

void SWonderlandCompanionConsole::Print(EWonderlandConsoleLine Kind, const FString& Text, const FString& Detail, float Pace)
{
	Print(FWonderlandConsoleLine(Kind, Text, Detail, Pace));
}

void SWonderlandCompanionConsole::PrintAll(const TArray<FWonderlandConsoleLine>& InLines)
{
	for (const FWonderlandConsoleLine& Line : InLines)
	{
		Print(Line);
	}
}

void SWonderlandCompanionConsole::Print(const FWonderlandConsoleLine& Line)
{
	// A LINE WITH NEWLINES IS SEVERAL LINES, each keeping the indentation it came with; what follows the first continues
	// it in the same voice -- more output under an output, more words under the companion's words.
	if (Line.Text.Contains(TEXT("\n")))
	{
		TArray<FString> Parts;
		Line.Text.ParseIntoArray(Parts, TEXT("\n"), false);
		for (int32 Index = 0; Index < Parts.Num(); ++Index)
		{
			FWonderlandConsoleLine Part = Line;
			Part.Text = Parts[Index].Replace(TEXT("\r"), TEXT(""));
			if (Index > 0)
			{
				Part.Detail.Reset();
				Part.Pace = 0.04f;
				if (Line.Kind == EWonderlandConsoleLine::Say || Line.Kind == EWonderlandConsoleLine::Tool)
				{
					Part.Kind = EWonderlandConsoleLine::Continue;
				}
				else if (Line.Kind == EWonderlandConsoleLine::Command)
				{
					Part.Kind = EWonderlandConsoleLine::Output;
				}
			}
			Print(Part);
		}
		return;
	}
	const double Now = NowSeconds();
	if (Queue.Num() == 0)
	{
		NextRevealAt = FMath::Max(NextRevealAt, Now + PaceFor(Line));
		if (NextRevealAt > Now + 5.0)
		{
			NextRevealAt = Now + PaceFor(Line);
		}
	}
	Queue.Add(Line);
}

float SWonderlandCompanionConsole::PaceFor(const FWonderlandConsoleLine& Line) const
{
	if (Line.Pace >= 0.0f)
	{
		return Line.Pace;
	}
	// THE RHYTHM OF WORK, not of typing: a pause before the companion speaks or reaches for a tool, then its output in a
	// quick run. Jittered a little so a block never reads as a metronome.
	const float Jitter = 0.8f + 0.4f * FMath::FRand();
	switch (Line.Kind)
	{
	case EWonderlandConsoleLine::Say:      return 0.55f * Jitter;
	case EWonderlandConsoleLine::Tool:     return 0.75f * Jitter;
	case EWonderlandConsoleLine::Command:  return 0.40f * Jitter;
	case EWonderlandConsoleLine::Continue: return 0.06f * Jitter;
	case EWonderlandConsoleLine::Output:
	case EWonderlandConsoleLine::Added:
	case EWonderlandConsoleLine::Removed:  return 0.09f * Jitter;
	case EWonderlandConsoleLine::Success:
	case EWonderlandConsoleLine::Failure:  return 0.30f * Jitter;
	case EWonderlandConsoleLine::Done:     return 0.20f;
	default:                               return 0.0f;
	}
}

void SWonderlandCompanionConsole::RevealDue(double Now)
{
	using namespace WonderlandConsoleDetail;
	int32 Guard = 0;
	while (Queue.Num() > 0 && Now >= NextRevealAt && Guard++ < 64)
	{
		const FWonderlandConsoleLine Next = Queue[0];
		Queue.RemoveAt(0);
		Reveal(Next, Now);
		if (Queue.Num() > 0)
		{
			// A FINISHED TASK'S LAST OUTPUT ARRIVES QUICKLY: the work is over and only the telling is left
			const float Speed = Queue.Num() > BacklogFast ? 0.25f : 1.0f;
			NextRevealAt = Now + (bFinishPending ? 0.06f : PaceFor(Queue[0]) * Speed);
		}
	}
}

void SWonderlandCompanionConsole::Reveal(const FWonderlandConsoleLine& Line, double Now)
{
	using namespace WonderlandConsoleDetail;
	// THE BLANK-LINE RHYTHM: a block -- the companion's words, a tool call, a prompt, a lifecycle line -- has a blank row
	// above it, as in the reference; output stays tight under its call.
	if (StartsBlock(Line.Kind) && Lines.Num() > 0 && Lines.Last().Kind != EWonderlandConsoleLine::Blank)
	{
		FLine Blank;
		Blank.Kind = EWonderlandConsoleLine::Blank;
		Blank.ShownAt = Now;
		AppendLine(Blank);
	}
	// A TOOL'S BULLET RESOLVES when what follows says how it went: its output (done), a failure (failed), or the next
	// block (done). Until then it blinks: the reference's tool in flight.
	if (Line.Kind == EWonderlandConsoleLine::Failure)
	{
		ResolveRunningTool(2);
	}
	else if (Line.Kind != EWonderlandConsoleLine::Blank && Line.Kind != EWonderlandConsoleLine::Note)
	{
		ResolveRunningTool(1);
	}

	FLine Out;
	Out.Kind = Line.Kind;
	Out.ShownAt = Now;
	if (Line.Kind == EWonderlandConsoleLine::Tool)
	{
		Out.Text = Line.Detail.IsEmpty() ? Line.Text : FString::Printf(TEXT("%s(%s)"), *Line.Text, *Line.Detail);
		Out.NameLen = Line.Text.Len();
	}
	else
	{
		Out.Text = Line.Text;
	}
	if (IsOutputKind(Line.Kind))
	{
		// the first output line under a call carries the elbow; the rest sit under it
		int32 Prev = Lines.Num() - 1;
		Out.bElbow = !(Prev >= 0 && IsOutputKind(Lines[Prev].Kind));
	}
	AppendLine(Out);
	if (Line.Kind != EWonderlandConsoleLine::Blank)
	{
		++PrintedThisTask;
		if (bCountLines)
		{
			Counter = PrintedThisTask;
		}
	}
}

int32 SWonderlandCompanionConsole::AppendLine(const FLine& Line)
{
	using namespace WonderlandConsoleDetail;
	const int32 Index = Lines.Add(Line);
	if (Lines.Num() > MaxLines + DropBlock && !bStreaming)
	{
		// THE OLDEST GO IN A BLOCK, so the rows are rebuilt once per fifty lines rather than every line.
		Lines.RemoveAt(0, DropBlock);
		const int32 RowsBefore = Rows.Num();
		Rows.Reset();
		RowsBuiltForLines = 0;
		EnsureRows();
		const float Removed = static_cast<float>(RowsBefore + 1 - Rows.Num());
		ScrollPos = FMath::Max(0.0f, ScrollPos - Removed);
		ScrollTarget = FMath::Max(0.0f, ScrollTarget - Removed);
		RowsWhenLeft = FMath::Max(0, RowsWhenLeft - static_cast<int32>(Removed));
		return Lines.Num() - 1;
	}
	return Index;
}

void SWonderlandCompanionConsole::ResolveRunningTool(uint8 State)
{
	for (int32 Index = Lines.Num() - 1; Index >= 0; --Index)
	{
		if (Lines[Index].Kind == EWonderlandConsoleLine::Tool)
		{
			if (Lines[Index].ToolState == 0)
			{
				Lines[Index].ToolState = State;
			}
			return;
		}
	}
}

void SWonderlandCompanionConsole::MarkLinesChanged(int32 FromLine)
{
	int32 Keep = Rows.Num();
	while (Keep > 0 && Rows[Keep - 1].Line >= FromLine)
	{
		--Keep;
	}
	Rows.SetNum(Keep);
	RowsBuiltForLines = FMath::Min(RowsBuiltForLines, FromLine);
}

void SWonderlandCompanionConsole::StreamText(const FString& Cumulative)
{
	const double Now = NowSeconds();
	if (!bStreaming)
	{
		// the queue shows first: the stream continues the transcript, it does not cut into it
		while (Queue.Num() > 0)
		{
			const FWonderlandConsoleLine Next = Queue[0];
			Queue.RemoveAt(0);
			Reveal(Next, Now);
		}
		bStreaming = true;
		StreamShown.Reset();
		StreamFirstLine = INDEX_NONE;
	}
	else if (!Cumulative.StartsWith(StreamShown))
	{
		// NOT AN EXTENSION OF WHAT WAS SHOWN: the runtime replaced its text, so the streamed lines are redrawn from it
		StreamShown.Reset();
	}
	StreamTarget = Cumulative;
	StreamCatchUpBy = Now + 0.25;
}

void SWonderlandCompanionConsole::EndStream()
{
	if (!bStreaming)
	{
		return;
	}
	StreamShown = StreamTarget;
	ApplyStreamShown(NowSeconds());
	bStreaming = false;
	StreamFirstLine = INDEX_NONE;
	StreamTarget.Reset();
	StreamShown.Reset();
}

void SWonderlandCompanionConsole::AdvanceStream(double Now, float DeltaTime)
{
	if (!bStreaming || StreamShown.Len() >= StreamTarget.Len())
	{
		return;
	}
	// THE NEWEST CHUNK OVER A QUARTER SECOND, a word at a time at least: a poll's worth of text arrives as a stream,
	// and never runs further behind than the runtime itself.
	const int32 Remaining = StreamTarget.Len() - StreamShown.Len();
	const double Left = FMath::Max(0.016, StreamCatchUpBy - Now);
	int32 Take = FMath::Max(1, static_cast<int32>(FMath::CeilToDouble(Remaining * FMath::Min(1.0, DeltaTime / Left))));
	int32 To = FMath::Min(StreamTarget.Len(), StreamShown.Len() + Take);
	while (To < StreamTarget.Len() && StreamTarget[To] != TEXT(' ') && StreamTarget[To] != TEXT('\n'))
	{
		++To;
	}
	StreamShown = StreamTarget.Left(To);
	ApplyStreamShown(Now);
}

void SWonderlandCompanionConsole::ApplyStreamShown(double Now)
{
	using namespace WonderlandConsoleDetail;
	TArray<FString> Parts;
	StreamShown.ParseIntoArray(Parts, TEXT("\n"), false);
	if (Parts.Num() == 0)
	{
		return;
	}
	if (StreamFirstLine == INDEX_NONE)
	{
		if (Lines.Num() > 0 && Lines.Last().Kind != EWonderlandConsoleLine::Blank)
		{
			FLine Blank;
			Blank.Kind = EWonderlandConsoleLine::Blank;
			Blank.ShownAt = Now;
			AppendLine(Blank);
		}
		StreamFirstLine = Lines.Num();
		++PrintedThisTask;
	}
	for (int32 Index = 0; Index < Parts.Num(); ++Index)
	{
		const int32 At = StreamFirstLine + Index;
		const EWonderlandConsoleLine Kind = Index == 0 ? EWonderlandConsoleLine::Say : EWonderlandConsoleLine::Continue;
		const FString Text = Parts[Index].Replace(TEXT("\r"), TEXT(""));
		if (Lines.IsValidIndex(At))
		{
			if (Lines[At].Text != Text || Lines[At].Kind != Kind)
			{
				Lines[At].Text = Text;
				Lines[At].Kind = Kind;
				MarkLinesChanged(At);
			}
		}
		else
		{
			FLine Line;
			Line.Kind = Kind;
			Line.Text = Text;
			Line.ShownAt = Now;
			Lines.Add(Line);
		}
	}
	// a replaced text can be shorter than what was shown
	const int32 End = StreamFirstLine + Parts.Num();
	if (Lines.Num() > End)
	{
		Lines.SetNum(End);
		MarkLinesChanged(End);
	}
}

int32 SWonderlandCompanionConsole::GetRevealedWordCount() const
{
	TArray<FString> Words;
	StreamShown.ParseIntoArrayWS(Words);
	return Words.Num();
}

void SWonderlandCompanionConsole::ClearLines()
{
	EndStream();
	Lines.Reset();
	Queue.Reset();
	Rows.Reset();
	RowsBuiltForLines = 0;
	ScrollPos = 0.0f;
	ScrollTarget = 0.0f;
	bFollow = true;
	RowsWhenLeft = 0;
	LatestActivity.Reset();
	NarratedBeat = NAME_None;
}

void SWonderlandCompanionConsole::AdoptStateFrom(const SWonderlandCompanionConsole& Old)
{
	// the transcript, and what is still on its way to it
	Lines = Old.Lines;
	Queue = Old.Queue;
	NextRevealAt = Old.NextRevealAt;
	PrintedThisTask = Old.PrintedThisTask;
	bStreaming = Old.bStreaming;
	StreamFirstLine = Old.StreamFirstLine;
	StreamTarget = Old.StreamTarget;
	StreamShown = Old.StreamShown;
	StreamCatchUpBy = Old.StreamCatchUpBy;
	// the task and its clock: every time here is the application's (NowSeconds), so the timer simply keeps counting
	Activity = Old.Activity;
	Verb = Old.Verb;
	TaskStartedAt = Old.TaskStartedAt;
	TaskEndedAt = Old.TaskEndedAt;
	CycleOrigin = Old.CycleOrigin;
	Counter = Old.Counter;
	CounterUnit = Old.CounterUnit;
	bCountLines = Old.bCountLines;
	bInterruptible = Old.bInterruptible;
	bFinishPending = Old.bFinishPending;
	FinishAt = Old.FinishAt;
	FinishSummary = Old.FinishSummary;
	FailReason = Old.FailReason;
	// the row, the footer and the labels
	IdleText = Old.IdleText;
	bQuiet = Old.bQuiet;
	Subline = Old.Subline;
	SessionLabel = Old.SessionLabel;
	Mode = Old.Mode;
	Status = Old.Status;
	InputHint = Old.InputHint;
	LatestActivity = Old.LatestActivity;
	NarratedBeat = Old.NarratedBeat;
	// the view: rows are rebuilt for this console's own width (lazily, as ClearLines leaves them); the reading position
	// and whether it follows the newest line are kept
	Rows.Reset();
	RowsBuiltForLines = 0;
	ScrollPos = Old.ScrollPos;
	ScrollTarget = Old.ScrollTarget;
	bFollow = Old.bFollow;
	RowsWhenLeft = Old.RowsWhenLeft;
	// anything typed and not yet sent
	if (Input.IsValid() && Old.Input.IsValid())
	{
		Input->SetText(Old.Input->GetText());
	}
}

void SWonderlandCompanionConsole::AddLine(const FString& Speaker, const FString& Text, bool bDim)
{
	if (Speaker == TEXT("You"))
	{
		Print(EWonderlandConsoleLine::Prompt, Text);
	}
	else if (Speaker.IsEmpty() || bDim)
	{
		Print(EWonderlandConsoleLine::Note, Text);
	}
	else
	{
		Print(EWonderlandConsoleLine::Say, Text);
	}
}

/* ------------------------------------------------------------------------------------------------------- the task */

void SWonderlandCompanionConsole::BeginTask(EWonderlandConsoleActivity InActivity, const FString& InVerb)
{
	const double Now = NowSeconds();
	Activity = InActivity == EWonderlandConsoleActivity::Idle ? EWonderlandConsoleActivity::Working : InActivity;
	Verb = InVerb;
	TaskStartedAt = Now;
	CycleOrigin = Now;
	Counter = 0;
	CounterUnit.Reset();
	bCountLines = false;
	PrintedThisTask = 0;
	bFinishPending = false;
	FinishSummary.Reset();
	FailReason.Reset();
}

void SWonderlandCompanionConsole::SetActivity(EWonderlandConsoleActivity InActivity, const FString& InVerb)
{
	if (!IsTaskActive())
	{
		BeginTask(InActivity, InVerb);
		return;
	}
	if (InActivity == EWonderlandConsoleActivity::Idle)
	{
		return;
	}
	if ((Activity == EWonderlandConsoleActivity::Waiting) != (InActivity == EWonderlandConsoleActivity::Waiting))
	{
		// the cadence changes; restart the cycle at the dot so the emblem never jumps mid-shape
		CycleOrigin = NowSeconds();
	}
	Activity = InActivity;
	Verb = InVerb;
	// still working: a finish that was waiting for the queue is no longer the last word
	bFinishPending = false;
}

void SWonderlandCompanionConsole::FinishTask(const FString& Summary)
{
	if (!IsTaskActive())
	{
		return;
	}
	bFinishPending = true;
	FinishSummary = Summary;
	// THE CLOCK STOPS NOW, not when the queued lines have finished showing (Second Wonderland's review): the work ended
	// when the feed said so, and the row must not count past it while the transcript catches up.
	FinishAt = NowSeconds();
	NextRevealAt = FMath::Min(NextRevealAt, FinishAt + 0.06);
}

void SWonderlandCompanionConsole::FailTask(const FString& Why)
{
	const double Now = NowSeconds();
	EndStream();
	// what was queued happened before the failure: it shows first, at once
	while (Queue.Num() > 0)
	{
		const FWonderlandConsoleLine Next = Queue[0];
		Queue.RemoveAt(0);
		Reveal(Next, Now);
	}
	Reveal(FWonderlandConsoleLine(EWonderlandConsoleLine::Failure, Why), Now);
	if (!IsTaskActive())
	{
		TaskStartedAt = Now;
	}
	Activity = EWonderlandConsoleActivity::Error;
	FailReason = Why;
	TaskEndedAt = Now;
	bInterruptible = false;
	bFinishPending = false;
}

void SWonderlandCompanionConsole::SetCounter(int64 Value, const FString& Unit)
{
	Counter = Value;
	CounterUnit = Unit;
	bCountLines = false;
}

void SWonderlandCompanionConsole::CountPrintedLines()
{
	bCountLines = true;
	CounterUnit = TEXT("lines");
	Counter = PrintedThisTask;
}

void SWonderlandCompanionConsole::SetInterruptible(bool bInInterruptible)
{
	bInterruptible = bInInterruptible;
}

void SWonderlandCompanionConsole::SetIdleText(const FString& Text, bool bInQuiet)
{
	IdleText = Text;
	bQuiet = bInQuiet;
}

void SWonderlandCompanionConsole::SetSubline(const FString& Text)
{
	Subline = Text;
}

void SWonderlandCompanionConsole::SetSessionLabel(const FString& Text)
{
	SessionLabel = Text;
}

void SWonderlandCompanionConsole::SetMode(const FString& Text)
{
	Mode = Text;
}

void SWonderlandCompanionConsole::SetStatus(const FString& InStatus)
{
	Status = InStatus;
}

FString SWonderlandCompanionConsole::GetShownStatus() const
{
	return bStreaming ? FString(TEXT("STREAMING")) : Status;
}

void SWonderlandCompanionConsole::SetInputHint(const FString& Text)
{
	InputHint = Text;
}

/* ----------------------------------------------------------------------------------------------------------- tick */

void SWonderlandCompanionConsole::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	using namespace WonderlandConsoleDetail;
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	const double Now = NowSeconds();
	if (!bStreaming)
	{
		RevealDue(Now);
	}
	AdvanceStream(Now, InDeltaTime);

	// THE TASK'S LAST LINE WAITS FOR ITS WORK TO SHOW: the summary lands after the lines it summarises.
	if (bFinishPending && Queue.Num() == 0 && !bStreaming)
	{
		const FString Count = CounterUnit.IsEmpty() ? FString() : FString::Printf(TEXT("%s %s"), *FormatCount(Counter), *CounterUnit);
		const FString Summary = FinishSummary.Replace(TEXT("{time}"), *FormatElapsed(FinishAt - TaskStartedAt)).Replace(TEXT("{count}"), *Count);
		Reveal(FWonderlandConsoleLine(EWonderlandConsoleLine::Done, Summary), Now);
		ResolveRunningTool(1);
		Activity = EWonderlandConsoleActivity::Idle;
		TaskEndedAt = FinishAt;
		bFinishPending = false;
		bInterruptible = false;
	}

	// THE VIEW FOLLOWS THE NEWEST LINE, eased: a new row rises into place instead of the page jumping.
	EnsureRows();
	const float Total = static_cast<float>(Rows.Num());
	if (bFollow)
	{
		ScrollTarget = Total;
	}
	const float Floor = FMath::Min(Total, static_cast<float>(FMath::Max(1, VisibleRows)));
	ScrollTarget = FMath::Clamp(ScrollTarget, Floor, Total);
	float Gap = ScrollTarget - ScrollPos;
	if (FMath::Abs(Gap) > static_cast<float>(FMath::Max(2, VisibleRows)))
	{
		// a burst bigger than the view: most of the way at once, the last half-view eased
		ScrollPos = ScrollTarget - FMath::Sign(Gap) * VisibleRows * 0.5f;
		Gap = ScrollTarget - ScrollPos;
	}
	ScrollPos += Gap * (1.0f - FMath::Exp(-InDeltaTime * ScrollRate));
	if (FMath::Abs(ScrollTarget - ScrollPos) < 0.004f)
	{
		ScrollPos = ScrollTarget;
	}
}

/* ----------------------------------------------------------------------------------------------------------- rows */

int32 SWonderlandCompanionConsole::CellsOf(TCHAR C)
{
	// East Asian wide forms take two cells, as a terminal gives them
	if ((C >= 0x1100 && C <= 0x115F) || (C >= 0x2E80 && C <= 0xA4CF) || (C >= 0xAC00 && C <= 0xD7A3) || (C >= 0xF900 && C <= 0xFAFF)
		|| (C >= 0xFE30 && C <= 0xFE4F) || (C >= 0xFF00 && C <= 0xFF60) || (C >= 0xFFE0 && C <= 0xFFE6) || (C >= 0xD800 && C <= 0xDBFF))
	{
		return 2;
	}
	return (C >= 0xDC00 && C <= 0xDFFF) ? 0 : 1;
}

void SWonderlandCompanionConsole::EnsureRows() const
{
	if (RowCols <= 0)
	{
		return;
	}
	for (int32 Index = RowsBuiltForLines; Index < Lines.Num(); ++Index)
	{
		BuildRowsFor(Index);
	}
	RowsBuiltForLines = Lines.Num();
}

void SWonderlandCompanionConsole::BuildRowsFor(int32 LineIndex) const
{
	using namespace WonderlandConsoleDetail;
	const FLine& Line = Lines[LineIndex];
	const int32 Indent = IndentFor(Line.Kind);
	const FString& Text = Line.Text;
	if (Line.Kind == EWonderlandConsoleLine::Blank || Line.Kind == EWonderlandConsoleLine::Rule || Text.IsEmpty())
	{
		Rows.Add({LineIndex, 0, Text.Len(), Indent, true});
		return;
	}
	// WRAPPED AT WORDS, INDENTATION KEPT: a continuation row hangs under the line's own leading spaces, so indented output
	// stays a column; a word longer than the row is broken where the row ends, as a terminal breaks it.
	const int32 Avail = FMath::Max(8, RowCols - Indent);
	int32 Lead = 0;
	while (Lead < Text.Len() && Text[Lead] == TEXT(' '))
	{
		++Lead;
	}
	const int32 Hang = FMath::Min(Lead, Avail / 2);
	int32 Pos = 0;
	bool bFirst = true;
	int32 Guard = 0;
	while ((bFirst || Pos < Text.Len()) && Guard++ < 400)
	{
		const int32 Width = bFirst ? Avail : Avail - Hang;
		int32 Cells = 0;
		int32 End = Pos;
		int32 LastSpace = INDEX_NONE;
		while (End < Text.Len())
		{
			const int32 W = CellsOf(Text[End]);
			if (Cells + W > Width)
			{
				break;
			}
			if (Text[End] == TEXT(' ') && End > Pos)
			{
				LastSpace = End;
			}
			Cells += W;
			++End;
		}
		int32 Next = End;
		if (End < Text.Len())
		{
			if (Text[End] == TEXT(' '))
			{
				Next = End + 1;
			}
			else if (LastSpace != INDEX_NONE && LastSpace > Pos + Width / 3)
			{
				End = LastSpace;
				Next = LastSpace + 1;
			}
		}
		if (End <= Pos)
		{
			End = FMath::Min(Text.Len(), Pos + 1);
			Next = End;
		}
		Rows.Add({LineIndex, Pos, End, bFirst ? Indent : Indent + Hang, bFirst});
		Pos = Next;
		bFirst = false;
		while (Pos < Text.Len() && Text[Pos] == TEXT(' '))
		{
			++Pos;
		}
	}
}

/* ---------------------------------------------------------------------------------------------- the moving parts */

double SWonderlandCompanionConsole::NowSeconds() const
{
	return FSlateApplication::IsInitialized() ? FSlateApplication::Get().GetCurrentTime() : FPlatformTime::Seconds();
}

float SWonderlandCompanionConsole::CyclePhase(double Now) const
{
	using namespace WonderlandConsoleDetail;
	const float Cycle = Activity == EWonderlandConsoleActivity::Waiting ? WaitCycleSeconds : CycleSeconds;
	return FMath::Frac(static_cast<float>((Now - CycleOrigin) / Cycle));
}

float SWonderlandCompanionConsole::Warmth(double Now) const
{
	using namespace WonderlandConsoleDetail;
	// PALE WHILE THE MARK GROWS, RED WHILE IT SHRINKS (the reference: white from the dot onward, red from the peak), with
	// the passage between taken slowly enough to show the orange and gold the founder described.
	const float P = CyclePhase(Now);
	const float Pass = FMath::Clamp(CVarConsoleWarmPassage.GetValueOnGameThread(), 0.02f, 0.4f);
	if (P < Pass) return Smooth(P / Pass);
	if (P < 0.50f) return 1.0f;
	if (P < 0.50f + Pass) return 1.0f - Smooth((P - 0.50f) / Pass);
	return 0.0f;
}

FLinearColor SWonderlandCompanionConsole::WarmColour(float T, bool bVerb) const
{
	using namespace WonderlandConsoleDetail;
	// the verb runs the whole band to cream; the mark stops at gold, so it stays a warm light rather than going white
	const float Along = FMath::Clamp(bVerb ? T : T * 0.66f, 0.0f, 1.0f) * 3.0f;
	const int32 Stop = FMath::Min(2, FMath::FloorToInt(Along));
	return FLinearColor::LerpUsingHSV(WarmStop(Stop), WarmStop(Stop + 1), Along - Stop);
}

FLinearColor SWonderlandCompanionConsole::GetVerbColour() const
{
	using namespace WonderlandConsoleDetail;
	const double Now = NowSeconds();
	if (Activity == EWonderlandConsoleActivity::Error)
	{
		return ErrorRed();
	}
	if (!IsTaskActive())
	{
		return WonderlandUi::CompanionTextDim();
	}
	FLinearColor C = WarmColour(Warmth(Now), true);
	// a subtle breath of light across the cycle
	const float Breath = 0.93f + 0.07f * FMath::Sin(CyclePhase(Now) * TwoPi);
	C = FLinearColor(C.R * Breath, C.G * Breath, C.B * Breath, 1.0f);
	if (Activity == EWonderlandConsoleActivity::Waiting)
	{
		C = FMath::Lerp(C, WonderlandUi::CompanionTextDim(), 0.30f);
	}
	return C;
}

int32 SWonderlandCompanionConsole::GetEmblemStage() const
{
	if (!IsTaskActive())
	{
		return -1;
	}
	const int32 Frame = FMath::Clamp(FMath::FloorToInt(CyclePhase(NowSeconds()) * 12.0f), 0, 11);
	return Frame < 6 ? Frame : 11 - Frame;
}

int32 SWonderlandCompanionConsole::GetElapsedSeconds() const
{
	if (Activity == EWonderlandConsoleActivity::Idle && TaskStartedAt <= 0.0)
	{
		return 0;
	}
	const double End = IsTaskActive() ? (bFinishPending ? FinishAt : NowSeconds()) : TaskEndedAt;
	return FMath::Max(0, FMath::FloorToInt(static_cast<float>(End - TaskStartedAt)));
}

FString SWonderlandCompanionConsole::FormatElapsed(double Seconds) const
{
	const int32 Total = FMath::Max(0, FMath::FloorToInt(static_cast<float>(Seconds)));
	if (Total < 60)
	{
		return FString::Printf(TEXT("%ds"), Total);
	}
	if (Total < 3600)
	{
		return FString::Printf(TEXT("%dm %ds"), Total / 60, Total % 60);
	}
	return FString::Printf(TEXT("%dh %dm"), Total / 3600, (Total / 60) % 60);
}

FString SWonderlandCompanionConsole::FormatCount(int64 Value) const
{
	// as the reference counts: 951, then 1.0k, 1.1k
	if (Value < 1000)
	{
		return FString::Printf(TEXT("%lld"), Value);
	}
	if (Value < 100000)
	{
		return FString::Printf(TEXT("%.1fk"), static_cast<double>(Value) / 1000.0);
	}
	return FString::Printf(TEXT("%lldk"), Value / 1000);
}

FString SWonderlandCompanionConsole::ComposeStatus(double Now) const
{
	if (Activity == EWonderlandConsoleActivity::Error)
	{
		return FString::Printf(TEXT("Stopped (%s)"), *FormatElapsed(TaskEndedAt - TaskStartedAt));
	}
	if (!IsTaskActive())
	{
		return IdleText;
	}
	FString Out = FString::Printf(TEXT("%s… (%s"), *Verb, *FormatElapsed((bFinishPending ? FinishAt : Now) - TaskStartedAt));
	if (!CounterUnit.IsEmpty())
	{
		Out += FString::Printf(TEXT(" · ↓ %s %s"), *FormatCount(Counter), *CounterUnit);
	}
	Out += TEXT(")");
	return Out;
}

FString SWonderlandCompanionConsole::GetStatusRowText() const
{
	return ComposeStatus(NowSeconds());
}

bool SWonderlandCompanionConsole::IsInterruptHintShown() const
{
	return bInterruptible && OnInterrupt.IsBound() && IsTaskActive() && HasInputFocus();
}

FString SWonderlandCompanionConsole::GetFooterText() const
{
	FString Out = Mode;
	if (IsInterruptHintShown())
	{
		Out += Out.IsEmpty() ? TEXT("esc to interrupt") : TEXT(" · esc to interrupt");
	}
	return Out;
}

int32 SWonderlandCompanionConsole::GetLineCount() const
{
	int32 Count = 0;
	for (const FLine& Line : Lines)
	{
		Count += Line.Kind == EWonderlandConsoleLine::Blank ? 0 : 1;
	}
	return Count;
}

FString SWonderlandCompanionConsole::GetLineText(int32 Index) const
{
	for (const FLine& Line : Lines)
	{
		if (Line.Kind == EWonderlandConsoleLine::Blank)
		{
			continue;
		}
		if (Index-- == 0)
		{
			return Line.Text;
		}
	}
	return FString();
}

int32 SWonderlandCompanionConsole::GetUnseenRows() const
{
	return bFollow ? 0 : FMath::Max(0, Rows.Num() - RowsWhenLeft);
}

void SWonderlandCompanionConsole::ScrollRows(float Delta)
{
	EnsureRows();
	const float Total = static_cast<float>(Rows.Num());
	const float Floor = FMath::Min(Total, static_cast<float>(FMath::Max(1, VisibleRows)));
	if (Total <= Floor)
	{
		return;
	}
	const bool bWasFollowing = bFollow;
	ScrollTarget = FMath::Clamp(ScrollTarget + Delta, Floor, Total);
	bFollow = ScrollTarget >= Total - 0.01f;
	if (bWasFollowing && !bFollow)
	{
		RowsWhenLeft = Rows.Num();
	}
}

void SWonderlandCompanionConsole::FollowLive()
{
	EnsureRows();
	bFollow = true;
	ScrollTarget = static_cast<float>(Rows.Num());
}

FReply SWonderlandCompanionConsole::HandleWheel(const FGeometry& Geometry, const FPointerEvent& Event)
{
	// UP TO READ BACK, and the view stays there however much arrives -- until the visitor comes back down or asks.
	ScrollRows(-Event.GetWheelDelta() * 3.0f);
	return FReply::Handled();
}

FReply SWonderlandCompanionConsole::HandlePress(const FGeometry& Geometry, const FPointerEvent& Event)
{
	if (!bFollow && Event.GetEffectingButton() == EKeys::LeftMouseButton)
	{
		const FVector2D Local = Geometry.AbsoluteToLocal(Event.GetScreenSpacePosition());
		if (PillRect.ContainsPoint(FVector2f(Local)))
		{
			FollowLive();
			return FReply::Handled();
		}
	}
	return FReply::Unhandled();
}

/* -------------------------------------------------------------------------------------------------------- paint */

void SWonderlandCompanionConsole::MeasureFont(float Scale) const
{
	if (Scale <= 0.0f)
	{
		Scale = MeasuredForScale > 0.0f ? MeasuredForScale : 1.0f;
	}
	Scale = FMath::Clamp(Scale, 0.25f, 8.0f);
	if ((CellW > 0.0f && FMath::IsNearlyEqual(MeasuredForScale, Scale, 0.0005f))
		|| !FSlateApplication::IsInitialized() || FSlateApplication::Get().GetRenderer() == nullptr)
	{
		return;
	}
	// MEASURED AT THE SCALE IT IS DRAWN AT. The font is rasterised at a whole pixel size -- 9 pt at the 1920x1200 scale is
	// drawn at 14 px, not 13.3 -- so a measure taken at scale 1 ran 5% narrow and every long row ran four characters past
	// the frame (film3). Measured here, the cell is the one actually drawn.
	const TSharedRef<FSlateFontMeasure> Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
	const FVector2D Ten = Measure->Measure(FString(TEXT("0000000000")), Font, Scale);
	CellW = FMath::Max(1.0f, static_cast<float>(Ten.X) / 10.0f / Scale);
	LineH = FMath::Max(8.0f, static_cast<float>(Measure->GetMaxCharacterHeight(Font, Scale)) / Scale);
	MeasuredForScale = Scale;
	const float Dot = FMath::RoundToFloat(LineH * 0.36f);
	DotBrush = FSlateRoundedBoxBrush(FLinearColor::White, Dot * 0.5f);
	// a new cell width rewraps everything once
	RowCols = 0;
}

void SWonderlandCompanionConsole::PaintText(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, const FString& Text,
	float X, float Y, const FLinearColor& Ink) const
{
	if (Text.IsEmpty())
	{
		return;
	}
	const FVector2D Local = Geometry.GetLocalSize();
	FSlateDrawElement::MakeText(Out, Layer,
		Geometry.ToPaintGeometry(FVector2f(FMath::Max(1.0f, static_cast<float>(Local.X) - X), LineH), FSlateLayoutTransform(FVector2f(X, Y))),
		Text, Font, ESlateDrawEffect::None, Ink);
}

void SWonderlandCompanionConsole::PaintRule(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, float X0, float X1, float Y,
	const FLinearColor& Ink) const
{
	if (X1 <= X0)
	{
		return;
	}
	TArray<FVector2D> Points = {FVector2D(X0, Y), FVector2D(X1, Y)};
	FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Ink, true, 1.0f);
}

void SWonderlandCompanionConsole::PaintEmblem(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, const FVector2D& Centre,
	float Size, int32 Stage, const FLinearColor& Ink, float Weight) const
{
	const bool bHeavy = Stage >= 5;
	const float R = Size * 0.44f * (bHeavy ? 1.06f : 1.0f);
	const float Thick = FMath::Max(1.0f, Size * 0.085f) * Weight * (bHeavy ? 1.45f : 1.0f);
	auto Stroke = [&](const TArray<FVector2D>& Points, float Width)
	{
		FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Ink, true, Width);
	};
	auto Arc = [&](float Cx, float Cy, float Radius, float FromDeg, float ToDeg, int32 Steps, float Width)
	{
		TArray<FVector2D> Points;
		for (int32 S = 0; S <= Steps; ++S)
		{
			const float Rad = FMath::DegreesToRadians(FMath::Lerp(FromDeg, ToDeg, static_cast<float>(S) / Steps));
			Points.Add(Centre + FVector2D(Cx + FMath::Cos(Rad) * Radius, Cy + FMath::Sin(Rad) * Radius));
		}
		Stroke(Points, Width);
	};
	if (Stage <= 0)
	{
		// the dot: a ring as thick as it is wide
		Arc(0.0f, 0.0f, R * 0.10f, 0.0f, 360.0f, 10, R * 0.22f);
		return;
	}

	if (Emblem == EWonderlandConsoleEmblem::Star)
	{
		// the reference's own progression for a companion with no mark: four spokes, eight thin, six, eight, eight heavy
		const int32 Spokes = Stage == 1 ? 4 : (Stage == 3 ? 6 : 8);
		const float Inner = R * (Stage >= 4 ? 0.0f : 0.18f);
		const float Width = Thick * (Stage == 1 || Stage == 2 ? 0.8f : (Stage == 3 ? 1.2f : 1.4f));
		for (int32 S = 0; S < Spokes; ++S)
		{
			const float Rad = WonderlandConsoleDetail::TwoPi * S / Spokes - WonderlandConsoleDetail::TwoPi * 0.25f;
			const FVector2D Dir(FMath::Cos(Rad), FMath::Sin(Rad));
			Stroke({Centre + Dir * Inner, Centre + Dir * R}, Width);
		}
		return;
	}

	// THE i.WONDER MARK, BUILT UP AND TAKEN DOWN: broken ring, ring, ring and eyes, the whole mark, the whole mark heavy.
	if (Stage == 1)
	{
		for (int32 Q = 0; Q < 4; ++Q)
		{
			const float Mid = 45.0f + 90.0f * Q;
			Arc(0.0f, 0.0f, R, Mid - 26.0f, Mid + 26.0f, 8, Thick * 0.9f);
		}
		return;
	}
	Arc(0.0f, 0.0f, R, 0.0f, 360.0f, 36, Thick);
	if (Stage >= 3)
	{
		const float Eye = R * 0.30f;
		const float Gap = R * 0.34f;
		Arc(-Gap, -R * 0.12f, Eye, 300.0f, 420.0f, 12, Thick * 0.9f);
		Arc(Gap, -R * 0.12f, Eye, 120.0f, 240.0f, 12, Thick * 0.9f);
		Stroke({Centre + FVector2D(-Gap + Eye * 0.5f, -R * 0.12f), Centre + FVector2D(Gap - Eye * 0.5f, -R * 0.12f)}, Thick * 0.9f);
	}
	if (Stage >= 4)
	{
		TArray<FVector2D> Wave;
		for (int32 S = 0; S <= 16; ++S)
		{
			const float T = static_cast<float>(S) / 16.0f;
			Wave.Add(Centre + FVector2D(FMath::Lerp(-R * 0.62f, R * 0.62f, T), R * 0.40f + FMath::Sin(T * WonderlandConsoleDetail::TwoPi * 2.0f) * R * 0.10f));
		}
		Stroke(Wave, Thick * 0.9f);
	}
}

void SWonderlandCompanionConsole::PaintRow(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, const FRow& Row,
	float X, float Y, double Now) const
{
	using namespace WonderlandConsoleDetail;
	if (!Lines.IsValidIndex(Row.Line))
	{
		return;
	}
	const FLine& Line = Lines[Row.Line];
	const float Light = FadeFloor + (1.0f - FadeFloor) * Smooth(static_cast<float>((Now - Line.ShownAt) / FadeSeconds));
	auto Lit = [Light](FLinearColor C) { C.A *= Light; return C; };
	const FLinearColor Text = Lit(WonderlandUi::CompanionText());
	const FLinearColor Dim = Lit(WonderlandUi::CompanionTextDim());
	const float TextX = X + Row.Indent * CellW;
	const float Mid = Y + LineH * 0.5f;
	const FString Part = Line.Text.Mid(Row.Start, Row.End - Row.Start);

	auto Dot = [&](float Cx, const FLinearColor& Ink)
	{
		const float D = FMath::RoundToFloat(LineH * 0.36f);
		FSlateDrawElement::MakeBox(Out, Layer,
			Geometry.ToPaintGeometry(FVector2f(D, D), FSlateLayoutTransform(FVector2f(Cx - D * 0.5f, Mid - D * 0.5f))),
			&DotBrush, ESlateDrawEffect::None, Ink);
	};
	auto Elbow = [&](const FLinearColor& Ink)
	{
		const float Ex = X + CellW * 2.45f;
		TArray<FVector2D> Points = {FVector2D(Ex, Y + LineH * 0.12f), FVector2D(Ex, Mid + LineH * 0.05f), FVector2D(Ex + CellW * 1.25f, Mid + LineH * 0.05f)};
		FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Ink, true, 1.0f);
	};

	switch (Line.Kind)
	{
	case EWonderlandConsoleLine::Blank:
		return;
	case EWonderlandConsoleLine::Rule:
	{
		// a lifecycle line: a short rule, the words, the rule on to the edge
		const FLinearColor Ink = Lit(WonderlandUi::CompanionTextDim().CopyWithNewOpacity(0.8f));
		const float Right = static_cast<float>(Geometry.GetLocalSize().X);
		PaintRule(Geometry, Out, Layer, X, X + CellW * 3.0f, Mid, Ink);
		const FString Label = Line.Text.Left(FMath::Max(0, RowCols - 8));
		PaintText(Geometry, Out, Layer, Label, X + CellW * 4.0f, Y, Dim);
		PaintRule(Geometry, Out, Layer, X + CellW * (5.0f + Label.Len()), Right, Mid, Ink);
		return;
	}
	case EWonderlandConsoleLine::Prompt:
		if (Row.bFirst)
		{
			PaintText(Geometry, Out, Layer, TEXT(">"), X, Y, Dim);
		}
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Lit(FMath::Lerp(WonderlandUi::CompanionText(), WonderlandUi::CompanionTextDim(), 0.35f)));
		return;
	case EWonderlandConsoleLine::Say:
		if (Row.bFirst)
		{
			Dot(X + CellW * 0.55f, Lit(Accent));
		}
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Text);
		return;
	case EWonderlandConsoleLine::Tool:
	{
		if (Row.bFirst)
		{
			FLinearColor Bullet = OkGreen();
			if (Line.ToolState == 2)
			{
				Bullet = ErrorRed();
			}
			else if (Line.ToolState == 0)
			{
				// IN FLIGHT: the bullet blinks, a second a beat
				const float Blink = 0.5f + 0.5f * FMath::Cos(static_cast<float>(Now - Line.ShownAt) * TwoPi);
				Bullet = FMath::Lerp(WonderlandUi::CompanionTextDim(), WonderlandUi::CompanionText(), Blink);
			}
			Dot(X + CellW * 0.55f, Lit(Bullet));
		}
		// the tool's name bright, its argument in the body colour
		const int32 NameEnd = FMath::Clamp(Line.NameLen, Row.Start, Row.End);
		if (NameEnd > Row.Start)
		{
			PaintText(Geometry, Out, Layer, Line.Text.Mid(Row.Start, NameEnd - Row.Start), TextX, Y, Lit(WonderlandUi::CompanionText()));
		}
		if (Row.End > NameEnd)
		{
			PaintText(Geometry, Out, Layer, Line.Text.Mid(NameEnd, Row.End - NameEnd), TextX + (NameEnd - Row.Start) * CellW, Y,
				Lit(FMath::Lerp(WonderlandUi::CompanionText(), WonderlandUi::CompanionTextDim(), 0.45f)));
		}
		return;
	}
	case EWonderlandConsoleLine::Command:
		if (Row.bFirst)
		{
			PaintText(Geometry, Out, Layer, TEXT("$"), X + CellW * 2.0f, Y, Lit(WonderlandUi::CompanionGold(0.9f)));
		}
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Text);
		return;
	case EWonderlandConsoleLine::Output:
	case EWonderlandConsoleLine::Added:
	case EWonderlandConsoleLine::Removed:
	{
		if (Row.bFirst && Line.bElbow)
		{
			Elbow(Dim);
		}
		const FLinearColor Ink = Line.Kind == EWonderlandConsoleLine::Added ? Lit(AddedInk())
			: (Line.Kind == EWonderlandConsoleLine::Removed ? Lit(RemovedInk()) : Dim);
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Ink);
		return;
	}
	case EWonderlandConsoleLine::Success:
	case EWonderlandConsoleLine::Failure:
	{
		const bool bOk = Line.Kind == EWonderlandConsoleLine::Success;
		const FLinearColor Ink = Lit(bOk ? OkGreen() : ErrorRed());
		if (Row.bFirst)
		{
			if (Line.bElbow)
			{
				Elbow(Dim);
			}
			const float Mx = X + CellW * 5.0f;
			if (bOk)
			{
				TArray<FVector2D> Check = {FVector2D(Mx + CellW * 0.10f, Mid), FVector2D(Mx + CellW * 0.40f, Mid + LineH * 0.22f),
					FVector2D(Mx + CellW * 0.95f, Mid - LineH * 0.26f)};
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Check, ESlateDrawEffect::None, Ink, true, 1.4f);
			}
			else
			{
				const float H = LineH * 0.22f;
				const float Cx = Mx + CellW * 0.5f;
				const TArray<FVector2D> Down = {FVector2D(Cx - H, Mid - H), FVector2D(Cx + H, Mid + H)};
				const TArray<FVector2D> Up = {FVector2D(Cx - H, Mid + H), FVector2D(Cx + H, Mid - H)};
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Down, ESlateDrawEffect::None, Ink, true, 1.4f);
				FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Up, ESlateDrawEffect::None, Ink, true, 1.4f);
			}
		}
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Ink);
		return;
	}
	case EWonderlandConsoleLine::Done:
		if (Row.bFirst)
		{
			FLinearColor Mark = RestGold();
			Mark.A = 0.7f * Light;
			PaintEmblem(Geometry, Out, Layer, FVector2D(X + CellW * 0.6f, Mid), LineH * 0.9f, 4, Mark, 0.9f);
		}
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Dim);
		return;
	case EWonderlandConsoleLine::Note:
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Dim);
		return;
	default:
		PaintText(Geometry, Out, Layer, Part, TextX, Y, Text);
		return;
	}
}

int32 SWonderlandCompanionConsole::PaintMain(const FGeometry& Geometry, const FSlateRect& Culling, FSlateWindowElementList& Out, int32 LayerId) const
{
	using namespace WonderlandConsoleDetail;
	MeasureFont(Geometry.Scale);
	if (CellW <= 0.0f)
	{
		return LayerId;
	}
	const double Now = NowSeconds();
	const FVector2D Size = Geometry.GetLocalSize();
	const float W = static_cast<float>(Size.X);
	const float H = static_cast<float>(Size.Y);
	int32 Layer = LayerId + 1;

	// ---- the width decides the rows: a resize rewraps everything once
	// one cell kept clear at the right, as a terminal keeps its last column for the cursor
	const int32 Cols = FMath::Max(12, FMath::FloorToInt(W / CellW) - 1);
	if (Cols != RowCols)
	{
		RowCols = Cols;
		Rows.Reset();
		RowsBuiltForLines = 0;
		EnsureRows();
		if (bFollow)
		{
			ScrollTarget = ScrollPos = static_cast<float>(Rows.Num());
		}
	}
	EnsureRows();

	// ---- the title: the companion's name in the theme's accent, its state at the right
	const FLinearColor Dim = WonderlandUi::CompanionTextDim();
	PaintText(Geometry, Out, Layer, Title.ToUpper(), 0.0f, 0.0f, WonderlandUi::CompanionGold());
	{
		const FString State = GetShownStatus();
		const float StateX = W - State.Len() * CellW;
		if (StateX > (Title.Len() + 2) * CellW)
		{
			PaintText(Geometry, Out, Layer, State, StateX, 0.0f, IsTaskActive() ? Accent : Dim);
		}
	}

	// ---- the bottom of the strip, upward: the rule over the input, the tip, the status row
	const float RuleH = LineH;
	const bool bSub = IsTaskActive() && !Subline.IsEmpty();
	const float SubH = bSub ? LineH : 0.0f;
	const float StatusY = H - RuleH - SubH - LineH;
	const float Top = LineH + 4.0f;
	const float Bottom = StatusY - 3.0f;
	VisibleRows = FMath::Max(1, FMath::FloorToInt((Bottom - Top) / LineH));
	// WHOLE ROWS, as a terminal shows them: the band starts where its top row starts, so the oldest row on screen is never
	// half under the title (the QA frame showed one cut through the middle)
	const float BandTop = Bottom - VisibleRows * LineH;

	// ---- the transcript, clipped to its band; the bottom row sits on the band's bottom edge
	if (Bottom > Top)
	{
		Out.PushClip(FSlateClippingZone(Geometry.GetLayoutBoundingRect(FSlateRect(0.0f, BandTop, W, Bottom))));
		const int32 First = FMath::Max(0, FMath::FloorToInt(ScrollPos) - VisibleRows - 2);
		const int32 Last = FMath::Min(Rows.Num() - 1, FMath::CeilToInt(ScrollPos) + 1);
		for (int32 Index = First; Index <= Last; ++Index)
		{
			const float Y = Bottom - (ScrollPos - Index) * LineH;
			if (Y + LineH < BandTop || Y > Bottom)
			{
				continue;
			}
			PaintRow(Geometry, Out, Layer, Rows[Index], 0.0f, Y, Now);
		}
		Out.PopClip();

		// ---- scrolled away from the live end: the marker that says what arrived, and brings the view back when clicked
		PillRect = FSlateRect(0, 0, 0, 0);
		if (!bFollow)
		{
			const int32 Unseen = GetUnseenRows();
			const FString Pill = Unseen > 0
				? FString::Printf(TEXT("↓ %d new line%s"), Unseen, Unseen == 1 ? TEXT("") : TEXT("s"))
				: FString(TEXT("↓ back to live"));
			const float PillW = (Pill.Len() + 2) * CellW;
			const float PillX = (W - PillW) * 0.5f;
			const float PillY = Bottom - LineH - 4.0f;
			PillRect = FSlateRect(PillX, PillY, PillX + PillW, PillY + LineH + 2.0f);
			FSlateDrawElement::MakeBox(Out, Layer + 1,
				Geometry.ToPaintGeometry(FVector2f(PillW, LineH + 2.0f), FSlateLayoutTransform(FVector2f(PillX, PillY))),
				&PillBrush, ESlateDrawEffect::None, FLinearColor::White);
			PaintText(Geometry, Out, Layer + 2, Pill, PillX + CellW, PillY + 1.0f, WonderlandUi::CompanionGold());
		}
	}

	// ---- THE STATUS ROW, UPDATED IN PLACE: the mark, the verb in the warm band, then the timer and the counter
	{
		const FVector2D MarkCentre(CellW * 0.9f, StatusY + LineH * 0.5f);
		const float MarkSizeNow = LineH * 1.12f;
		int32 Stage = 4;
		FLinearColor Ink = RestGold();
		float Weight = 1.0f;
		if (IsTaskActive())
		{
			Stage = GetEmblemStage();
			const float Lift = 0.72f + 0.28f * (Stage / 5.0f);
			Ink = WarmColour(Warmth(Now), false);
			Ink = FLinearColor(Ink.R * Lift, Ink.G * Lift, Ink.B * Lift, 1.0f);
			if (Activity == EWonderlandConsoleActivity::Waiting)
			{
				Ink.A = 0.80f;
			}
		}
		else if (Activity == EWonderlandConsoleActivity::Error)
		{
			Ink = ErrorRed();
		}
		else
		{
			// AT REST: the yellow mark alone, a little dimmer; quieter still with nothing behind the companion
			Ink.A = bQuiet ? 0.45f : 0.85f;
			Weight = 0.9f;
		}
		PaintEmblem(Geometry, Out, Layer, MarkCentre, MarkSizeNow, Stage, Ink, Weight);
		MarkTopLeft = Geometry.LocalToAbsolute(MarkCentre - FVector2D(MarkSizeNow * 0.5f));
		MarkSize = FVector2D(MarkSizeNow) * static_cast<double>(Geometry.GetAccumulatedLayoutTransform().GetScale());

		const float TextX = CellW * 2.2f;
		if (IsTaskActive() || Activity == EWonderlandConsoleActivity::Error)
		{
			const FString Row = ComposeStatus(Now);
			int32 Split = Row.Find(TEXT(" ("));
			Split = Split == INDEX_NONE ? Row.Len() : Split;
			PaintText(Geometry, Out, Layer, Row.Left(Split), TextX, StatusY, GetVerbColour());
			PaintText(Geometry, Out, Layer, Row.Mid(Split), TextX + Split * CellW, StatusY, WonderlandUi::CompanionText());
		}
		else
		{
			PaintText(Geometry, Out, Layer, IdleText, TextX, StatusY, Dim);
		}
	}

	// ---- the tip line under it while the task runs
	if (bSub)
	{
		const float Y = StatusY + LineH;
		const float Ex = CellW * 2.45f;
		TArray<FVector2D> Points = {FVector2D(Ex, Y + LineH * 0.12f), FVector2D(Ex, Y + LineH * 0.55f), FVector2D(Ex + CellW * 1.25f, Y + LineH * 0.55f)};
		FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Points, ESlateDrawEffect::None, Dim, true, 1.0f);
		PaintText(Geometry, Out, Layer, Subline.Left(FMath::Max(0, RowCols - 6)), CellW * 5.0f, Y, Dim);
	}

	// ---- the rule over the input, the session inset at its right: "──── LLM COMPANION session continued ─"
	{
		const float Y = H - RuleH * 0.5f;
		const FLinearColor Ink = WonderlandUi::CompanionTextDim().CopyWithNewOpacity(0.75f);
		const FString Label = SessionLabel.Left(FMath::Max(0, RowCols - 8));
		if (Label.IsEmpty())
		{
			PaintRule(Geometry, Out, Layer, 0.0f, W, Y, Ink);
		}
		else
		{
			const float LabelW = Label.Len() * CellW;
			const float LabelX = W - CellW * 2.5f - LabelW;
			PaintRule(Geometry, Out, Layer, 0.0f, LabelX - CellW * 0.6f, Y, Ink);
			PaintText(Geometry, Out, Layer, Label, LabelX, H - RuleH, Dim);
			PaintRule(Geometry, Out, Layer, LabelX + LabelW + CellW * 0.6f, W, Y, Ink);
		}
	}
	return Layer + 2;
}

int32 SWonderlandCompanionConsole::PaintFooter(const FGeometry& Geometry, const FSlateRect& Culling, FSlateWindowElementList& Out, int32 LayerId) const
{
	MeasureFont(Geometry.Scale);
	if (CellW <= 0.0f)
	{
		return LayerId;
	}
	const int32 Layer = LayerId + 1;
	const float W = static_cast<float>(Geometry.GetLocalSize().X);
	const FLinearColor Dim = WonderlandUi::CompanionTextDim();
	PaintRule(Geometry, Out, Layer, 0.0f, W, 1.5f, WonderlandUi::CompanionTextDim().CopyWithNewOpacity(0.75f));
	const FString Footer = GetFooterText();
	if (Footer.IsEmpty())
	{
		return Layer;
	}
	// "⏵⏵": two small play marks in the companion's colour, then the modes in force
	const float Y = 4.0f;
	const float Mid = Y + LineH * 0.5f;
	for (int32 Mark = 0; Mark < 2; ++Mark)
	{
		const float Mx = CellW * (0.25f + Mark * 0.85f);
		TArray<FVector2D> Tri = {FVector2D(Mx, Mid - LineH * 0.20f), FVector2D(Mx + CellW * 0.62f, Mid), FVector2D(Mx, Mid + LineH * 0.20f),
			FVector2D(Mx, Mid - LineH * 0.20f)};
		FSlateDrawElement::MakeLines(Out, Layer, Geometry.ToPaintGeometry(), Tri, ESlateDrawEffect::None, Accent, true, 1.5f);
	}
	// as many cells as are left after the marks; a footer that still does not fit ends in an ellipsis rather than mid-word
	const int32 Room = FMath::Max(0, FMath::FloorToInt(W / CellW) - 3);
	const FString Shown = Footer.Len() <= Room ? Footer : Footer.Left(FMath::Max(0, Room - 1)) + TEXT("…");
	PaintText(Geometry, Out, Layer, Shown, CellW * 2.4f, Y, Dim);
	return Layer;
}

/* ------------------------------------------------------------------------------------------------- input and theme */

TSharedPtr<SWidget> SWonderlandCompanionConsole::GetFocusTarget() const
{
	return Input;
}

FString SWonderlandCompanionConsole::GetInputText() const
{
	return Input.IsValid() ? Input->GetText().ToString() : FString();
}

bool SWonderlandCompanionConsole::HasInputFocus() const
{
	return Input.IsValid() && (Input->HasKeyboardFocus() || Input->HasFocusedDescendants());
}

void SWonderlandCompanionConsole::Submit()
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
	FollowLive();
	OnSubmit.ExecuteIfBound(Trimmed);
	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetKeyboardFocus(Input, EFocusCause::SetDirectly);
	}
}

FReply SWonderlandCompanionConsole::HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent)
{
	const FKey Key = KeyEvent.GetKey();
	if (Key == EKeys::Enter)
	{
		Submit();
		return FReply::Handled();
	}
	if (Key == EKeys::Escape)
	{
		// ESC STOPS THE WORK WHEN THE WORK CAN BE STOPPED -- the footer said so -- and otherwise closes, as it always has
		if (bInterruptible && OnInterrupt.IsBound() && IsTaskActive())
		{
			OnInterrupt.Execute();
			return FReply::Handled();
		}
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::T && KeyEvent.IsControlDown())
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::PageUp || Key == EKeys::PageDown)
	{
		ScrollRows((Key == EKeys::PageUp ? -1.0f : 1.0f) * FMath::Max(1, VisibleRows - 1));
		return FReply::Handled();
	}
	if (Key == EKeys::End && KeyEvent.IsControlDown())
	{
		FollowLive();
		return FReply::Handled();
	}
	return FReply::Unhandled();
}

bool SWonderlandCompanionConsole::GetMarkAbsoluteRect(FVector2D& OutTopLeft, FVector2D& OutSize) const
{
	OutTopLeft = MarkTopLeft;
	OutSize = MarkSize;
	return OutSize.X >= 1.0 && OutSize.Y >= 1.0;
}

bool SWonderlandCompanionConsole::GetFrameAbsoluteRect(FVector2D& OutTopLeft, FVector2D& OutSize) const
{
	const FGeometry& G = GetCachedGeometry();
	OutTopLeft = G.GetAbsolutePosition();
	OutSize = G.GetAbsoluteSize();
	return OutSize.X >= 1.0 && OutSize.Y >= 1.0;
}

EActiveTimerReturnType SWonderlandCompanionConsole::FollowTheme(double InCurrentTime, float InDeltaTime)
{
	using namespace WonderlandConsoleDetail;
	const FLinearColor Now = WonderlandUi::CompanionGold();
	if (!BrushAccent.Equals(Now, 0.002f))
	{
		BrushAccent = Now;
		FrameBrush = FSlateRoundedBoxBrush(Plate(), 6.0f, Frame(BrushAccent), 1.5f);
		PillBrush = FSlateRoundedBoxBrush(Lin(10, 10, 12, 0.97f), 7.0f, Frame(BrushAccent), 1.0f);
		Invalidate(EInvalidateWidgetReason::Paint | EInvalidateWidgetReason::Layout);
	}
	return EActiveTimerReturnType::Continue;
}

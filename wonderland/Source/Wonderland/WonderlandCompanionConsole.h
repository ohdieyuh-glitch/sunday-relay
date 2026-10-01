// WONDERLAND — THE COMPANION CONSOLE. One companion's terminal, drawn and behaving like the Claude Code terminal.
//
// FOUNDER, 2026-10-01: "COMPANION TERMINALS MUST MATCH THE CLAUDE CODE TERMINAL EXPERIENCE ... This is NOT a request to
// make the companion terminals merely 'terminal-looking.' The companion terminals inside Wonderland must act, animate,
// scroll, pulse, and communicate activity like the Claude Code terminal in the reference." And: "BUILD THIS AS A
// REUSABLE COMPANION TERMINAL COMPONENT. Do not hard-code the demo. The terminal should consume actual companion
// events/telemetry and render this behavior for any Companion AI operating inside Wonderland."
//
// WHAT THE REFERENCE SHOWS, MEASURED FRAME BY FRAME (IMG_2179.mov, 30 fps), and what this draws for it:
// - a status row that updates IN PLACE: an emblem cycling through its shapes and back (about 2 s a cycle), a verb whose
//   colour moves between a warm red and a pale cream in step with it, and "(34s · ↓ 1.1k tokens)" -- a timer that ticks
//   once a second and a counter that rises as output arrives;
// - under it a dim "⎿ Tip:" line; then a rule with the session inset at its right ("Wonderland session continued");
//   the "› " input between two rules; and a footer of the modes in force ("⏵⏵ auto mode on ... · esc to interrupt").
// - The transcript above takes each new line at the bottom and moves the rest up.
//
// ONE COMPONENT, ANY COMPANION. Everything companion-specific arrives as arguments (name, accent, emblem) or as events
// (Print, BeginTask, StreamText, FinishTask ...). The sidekick runtime and the simulated mission are just two feeds of
// the same calls (UWonderlandUiSubsystem). Nothing in here knows which one is talking.
//
// TRUTHFUL BY CONSTRUCTION -- the founder's rules, kept where they cannot be bypassed:
// - the timer is real seconds since the task began, read at paint; nothing sets it;
// - the counter shows only what a feed reports, in the feed's own unit, and nothing at all when it reports nothing
//   ("do NOT fabricate token usage ... Never display fake telemetry merely to imitate Claude");
// - "esc to interrupt" appears only while an interrupt handler is bound, the feed says the work can be stopped, AND
//   this console's input holds the keyboard -- the only moment Esc here reaches that handler ("Only display it if the
//   control actually works");
// - the footer says the mode the feed says, and advertises no key that does nothing ("Do not fabricate a keybinding");
// - the emblem animates only while a task is in flight and settles when it ends ("Do not create a perpetual fake
//   'working' animation while nothing is happening");
// - no line is made up here: the console paces and draws what it is handed, and the feed says what it is.
//
// THE i.WONDER MARK IS THE EMBLEM (founder, P1 item 9: "The emblem is the i.Wonder logo. It must be YELLOW. ONLY THE
// LOGO."). At rest it is that yellow mark, alone. Working, it runs a six-shape cycle and back the way the reference's
// glyph does -- dot, broken ring, ring, ring and eyes, the whole mark, the whole mark heavy -- and its colour and light
// move through the warm band with the verb (founder, item 4: "the emblem participates"). Claude's own star is the
// Claude-specific branding the founder said to replace with the companion's identity.
//
// DRAWN, NOT TYPESET, WHERE THE ENGINE FONT HAS NO GLYPH. DroidSansMono carries ASCII and ·›…•—× and nothing of
// ● ⎿ ⏵ ✻ ✓ ✗ (checked with fontTools, 2026-10-01); those are painted as shapes in their own cells, so the grid stays
// monospace and nothing falls back to a CJK-width glyph mid-line.
//
// THE LAYOUT IS THE PANEL'S OWN. The console fills the slot UWonderlandUiSubsystem gives it; it moves nothing on the
// HUD (founder, PERMANENT: a content request is not a layout redesign).
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"

class SEditableTextBox;

/** What a companion is doing, as its feed reports it. Drives the status row and the emblem; never inferred here. */
enum class EWonderlandConsoleActivity : uint8
{
	/** Nothing in flight: the emblem settles, the row shows the feed's resting words. */
	Idle,
	/** Planning or reasoning: the row pulses. */
	Thinking,
	/** Tools and commands running, output arriving. */
	Working,
	/** Held on someone else -- a checkpoint, an approval, a review: the same row at a slower cadence. */
	Waiting,
	/** Stopped by a failure: the row says so in red and stays still; the history is kept. */
	Error,
};

/** How one transcript line is drawn. */
enum class EWonderlandConsoleLine : uint8
{
	/** What the visitor asked: "> text". */
	Prompt,
	/** The companion's own words: "● text". */
	Say,
	/** More of the same words, under the bullet. */
	Continue,
	/** A tool call: "● Name(detail)" -- the bullet blinks while it runs, then turns green, or red if it failed. */
	Tool,
	/** A shell command: "  $ text". */
	Command,
	/** Output under the call above it: "  ⎿  text" for the first line, indented under it for the rest. */
	Output,
	/** Output lines a diff adds and removes. */
	Added,
	Removed,
	/** A result line: "  ⎿  ✓ text" in green, "✗ text" in red. */
	Success,
	Failure,
	/** The runtime talking about the companion rather than the companion talking: dim. */
	Note,
	/** A lifecycle line across the transcript: "──── Connection restored ────". */
	Rule,
	/** The line a finished task leaves behind: the mark at rest, then the summary. */
	Done,
	/** An empty row, for the blank-line rhythm between blocks. */
	Blank,
};

/** One line handed to a console. */
struct FWonderlandConsoleLine
{
	EWonderlandConsoleLine Kind = EWonderlandConsoleLine::Say;
	FString Text;
	/** A tool's argument, drawn after its name in brackets. */
	FString Detail;
	/** Seconds after the previous line before this one shows; negative for the kind's natural rhythm. */
	float Pace = -1.0f;

	FWonderlandConsoleLine() = default;
	FWonderlandConsoleLine(EWonderlandConsoleLine InKind, const FString& InText, const FString& InDetail = FString(), float InPace = -1.0f)
		: Kind(InKind), Text(InText), Detail(InDetail), Pace(InPace)
	{
	}
};

/** The mark a companion's console works under. */
enum class EWonderlandConsoleEmblem : uint8
{
	/** The i.Wonder mark: Wonderland's own companions. */
	IWonderMark,
	/** A spoked star, for a companion that arrives without a mark of its own. */
	Star,
};

/** A painted strip of a console: the console draws it and takes its mouse. */
class WONDERLAND_API SWonderlandConsoleStrip : public SLeafWidget
{
public:
	DECLARE_DELEGATE_RetVal_FourParams(int32, FOnPaintStrip, const FGeometry&, const FSlateRect&, FSlateWindowElementList&, int32);
	DECLARE_DELEGATE_RetVal_TwoParams(FReply, FOnStripPointer, const FGeometry&, const FPointerEvent&);

	SLATE_BEGIN_ARGS(SWonderlandConsoleStrip)
		: _Height(0.0f)
	{}
		/** Desired height; zero for a strip that only fills what its slot gives it. */
		SLATE_ATTRIBUTE(float, Height)
		SLATE_EVENT(FOnPaintStrip, OnPaintStrip)
		SLATE_EVENT(FOnStripPointer, OnWheel)
		SLATE_EVENT(FOnStripPointer, OnPress)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(0.0, Height.Get(0.0f)); }
	virtual FReply OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;

private:
	TAttribute<float> Height;
	FOnPaintStrip OnPaintStrip;
	FOnStripPointer OnWheel;
	FOnStripPointer OnPress;
};

class WONDERLAND_API SWonderlandCompanionConsole : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnSubmit, const FString& /*Text*/);

	SLATE_BEGIN_ARGS(SWonderlandCompanionConsole)
		: _Accent(FLinearColor::White)
		, _Emblem(EWonderlandConsoleEmblem::IWonderMark)
	{}
		/** The companion's presentation name, e.g. "LLM COMPANION". */
		SLATE_ARGUMENT(FString, Title)
		/** The companion's own colour, the one its embodiment glows in: its bullet and its prompt chevron. */
		SLATE_ARGUMENT(FLinearColor, Accent)
		SLATE_ARGUMENT(EWonderlandConsoleEmblem, Emblem)
		/** A line typed into the input and sent with Enter. */
		SLATE_EVENT(FOnSubmit, OnSubmit)
		/** Esc while the work can be stopped. Unbound, the console never offers "esc to interrupt". */
		SLATE_EVENT(FSimpleDelegate, OnInterrupt)
		/** Esc with nothing to stop, and Ctrl+T: the terminals' own close chords. */
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	SWonderlandCompanionConsole();
	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	/* ------------------------------------------------------------------------------------------------ the transcript */

	/** Queue a line. Lines show in order at their own rhythm; a long backlog is played faster, never dropped. */
	void Print(const FWonderlandConsoleLine& Line);
	void Print(EWonderlandConsoleLine Kind, const FString& Text, const FString& Detail = FString(), float Pace = -1.0f);
	void PrintAll(const TArray<FWonderlandConsoleLine>& InLines);

	/**
	 * A RUNTIME'S ANSWER AS IT ARRIVES: the whole text so far, each time it grows. Shown as the companion's words, the
	 * newest part revealed over the next quarter second so a poll's chunk arrives as a stream rather than a block.
	 * Text that no longer extends what was shown replaces it.
	 */
	void StreamText(const FString& Cumulative);
	/** The answer is complete: show the rest at once and stop treating it as live. */
	void EndStream();

	/** Clear the history, as a new mission does. The status row and modes are the feed's and stay. */
	void ClearLines();

	/** The older terminals' call: "You" is a prompt, an empty speaker or a dim line is a note, anything else words. */
	void AddLine(const FString& Speaker, const FString& Text, bool bDim);

	/* ------------------------------------------------------------------------- the task, and the row that reports it */

	/** A task begins now: the timer starts, the counter resets, and the row comes alive with this verb. */
	void BeginTask(EWonderlandConsoleActivity Activity, const FString& Verb);
	/** The same task changes what it is doing; the timer keeps running. Begins a task if none is in flight. */
	void SetActivity(EWonderlandConsoleActivity Activity, const FString& Verb);
	/**
	 * The task is done. When the lines already queued have shown, a Done line is printed and the row settles.
	 * "{time}" and "{count}" in the summary become the task's own elapsed time and counter.
	 */
	void FinishTask(const FString& Summary);
	/** The task stopped on a failure: the reason is printed in red, the row stops in red, the history stays. */
	void FailTask(const FString& Why);
	bool IsTaskActive() const { return Activity != EWonderlandConsoleActivity::Idle && Activity != EWonderlandConsoleActivity::Error; }
	EWonderlandConsoleActivity GetActivity() const { return Activity; }

	/** The counter, in the feed's unit ("tokens", "chars"). An empty unit shows no counter at all. */
	void SetCounter(int64 Value, const FString& Unit);
	/** The counter becomes the lines this console has printed during the task, in "lines". */
	void CountPrintedLines();
	/** Whether the feed can stop the work in flight. Shown only with a bound handler and the keyboard here. */
	void SetInterruptible(bool bInInterruptible);

	/** What the row says while nothing is in flight. Quiet dims the mark as well, e.g. for a companion with no runtime. */
	void SetIdleText(const FString& Text, bool bQuiet);
	/** The dim line under the row while a task runs ("⎿ ..."): the reference's Tip line. Empty hides it. */
	void SetSubline(const FString& Text);
	/** The label inset in the rule above the input, as the reference's "Wonderland session continued". */
	void SetSessionLabel(const FString& Text);
	/** The modes in force, first in the footer: "conversation mode · simulated". */
	void SetMode(const FString& Text);

	/** The word at the top right, as the older terminal's state: OFFLINE, WAITING, ACTIVE · JOINED ... */
	void SetStatus(const FString& InStatus);
	const FString& GetStatus() const { return Status; }
	/** STREAMING while a runtime's answer is arriving, else the state above. */
	FString GetShownStatus() const;

	/** The activity the newest narrated line was spoken as, and the beat it narrated (for the mission proofs). */
	const FString& GetLatestActivity() const { return LatestActivity; }
	FName GetNarratedBeat() const { return NarratedBeat; }
	void NoteNarration(const FString& InActivity, FName Beat) { LatestActivity = InActivity; NarratedBeat = Beat; }

	/* --------------------------------------------------------------------------------------------- the input and focus */

	TSharedPtr<SWidget> GetFocusTarget() const;
	FString GetInputText() const;
	/** Whether this console's input holds the keyboard now. */
	bool HasInputFocus() const;
	/** Words in grey in the empty input: what typing here will do. */
	void SetInputHint(const FString& Text);

	/* -------------------------------------------------------------------------------------------- reading it back */

	const FString& GetTitle() const { return Title; }
	/** Lines in the history, not counting blank rhythm rows and not counting lines still queued. */
	int32 GetLineCount() const;
	int32 GetQueuedCount() const { return Queue.Num(); }
	/** The text of history line Index (blank rows skipped), for a proof that reads what was printed. */
	FString GetLineText(int32 Index) const;
	/** True while the mark is running its cycle (a task in flight). */
	bool IsPulsing() const { return IsTaskActive(); }
	bool IsStreaming() const { return bStreaming; }
	int32 GetRevealedWordCount() const;
	/** The emblem's shape now: 0..5 while it cycles, and -1 when it is at rest. */
	int32 GetEmblemStage() const;
	/** The status row exactly as it is drawn now, e.g. "Researching… (34s · ↓ 18 lines)". */
	FString GetStatusRowText() const;
	/** The colour the verb is drawn in now. */
	FLinearColor GetVerbColour() const;
	/** Whole seconds since the task began; zero with no task. */
	int32 GetElapsedSeconds() const;
	FString GetFooterText() const;
	const FString& GetSessionLabel() const { return SessionLabel; }
	bool IsInterruptHintShown() const;
	/** The transcript follows the newest line; false after the visitor scrolls up. */
	bool IsFollowing() const { return bFollow; }
	/** Rows printed since the visitor scrolled away from the bottom. */
	int32 GetUnseenRows() const;
	/** Scroll the transcript, as the wheel does: negative is up. */
	void ScrollRows(float Rows);
	/** Back to the newest line, as the "new output" marker does when clicked. */
	void FollowLive();
	/** Esc exactly as the input receives it -- through the real key handler -- for the filmed acceptance run. */
	void PressEscapeForQa() { HandleInputKeyDown(FGeometry(), FKeyEvent(EKeys::Escape, FModifierKeysState(), 0, false, 0, 0)); }

	/** The accent the frame is drawn in as of its last theme follow (P1 item 9's proof). */
	FLinearColor GetPaintedAccent() const { return BrushAccent; }
	/** Where the mark is drawn, absolute Slate space, as of the last paint. */
	bool GetMarkAbsoluteRect(FVector2D& OutTopLeft, FVector2D& OutSize) const;
	bool GetFrameAbsoluteRect(FVector2D& OutTopLeft, FVector2D& OutSize) const;

private:
	struct FLine
	{
		EWonderlandConsoleLine Kind = EWonderlandConsoleLine::Say;
		/** As drawn: a tool's name and bracketed detail joined. */
		FString Text;
		/** A tool's name length: those characters draw bright. */
		int32 NameLen = 0;
		/** The first output line of a block carries the ⎿. */
		bool bElbow = false;
		/** A tool's bullet: 0 running, 1 done, 2 failed. */
		uint8 ToolState = 0;
		double ShownAt = 0.0;
	};
	struct FRow
	{
		int32 Line = INDEX_NONE;
		int32 Start = 0;
		int32 End = 0;
		/** Cells before the text on this row. */
		int32 Indent = 0;
		bool bFirst = false;
	};

	/* the queue and the stream */
	void RevealDue(double Now);
	void Reveal(const FWonderlandConsoleLine& Line, double Now);
	void AdvanceStream(double Now, float DeltaTime);
	void ApplyStreamShown(double Now);
	float PaceFor(const FWonderlandConsoleLine& Line) const;
	int32 AppendLine(const FLine& Line);
	void ResolveRunningTool(uint8 State);
	void MarkLinesChanged(int32 FromLine);

	/* rows */
	void EnsureRows() const;
	void BuildRowsFor(int32 LineIndex) const;
	static int32 CellsOf(TCHAR C);

	/* paint */
	int32 PaintMain(const FGeometry& Geometry, const FSlateRect& Culling, FSlateWindowElementList& Out, int32 LayerId) const;
	int32 PaintFooter(const FGeometry& Geometry, const FSlateRect& Culling, FSlateWindowElementList& Out, int32 LayerId) const;
	void PaintRow(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, const FRow& Row, float X, float Y, double Now) const;
	void PaintEmblem(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, const FVector2D& Centre, float Size,
		int32 Stage, const FLinearColor& Ink, float Weight) const;
	void PaintRule(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, float X0, float X1, float Y, const FLinearColor& Ink) const;
	void PaintText(const FGeometry& Geometry, FSlateWindowElementList& Out, int32 Layer, const FString& Text, float X, float Y,
		const FLinearColor& Ink) const;
	FReply HandleWheel(const FGeometry& Geometry, const FPointerEvent& Event);
	FReply HandlePress(const FGeometry& Geometry, const FPointerEvent& Event);

	/* the moving parts */
	double NowSeconds() const;
	float CyclePhase(double Now) const;
	float Warmth(double Now) const;
	FLinearColor WarmColour(float T, bool bVerb) const;
	FString FormatElapsed(double Seconds) const;
	FString FormatCount(int64 Value) const;
	FString ComposeStatus(double Now) const;

	/* input */
	FReply HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent);
	void Submit();
	EActiveTimerReturnType FollowTheme(double InCurrentTime, float InDeltaTime);
	/** Measures the cell at the scale the console is drawn at; no scale reuses the last one. */
	void MeasureFont(float Scale = -1.0f) const;

	FString Title;
	FLinearColor Accent = FLinearColor::White;
	EWonderlandConsoleEmblem Emblem = EWonderlandConsoleEmblem::IWonderMark;
	FOnSubmit OnSubmit;
	FSimpleDelegate OnInterrupt;
	FSimpleDelegate OnRequestClose;

	TArray<FLine> Lines;
	TArray<FWonderlandConsoleLine> Queue;
	double NextRevealAt = 0.0;
	/** Lines printed since the task began, for the "lines" counter. */
	int32 PrintedThisTask = 0;

	/* the stream */
	bool bStreaming = false;
	int32 StreamFirstLine = INDEX_NONE;
	FString StreamTarget;
	FString StreamShown;
	double StreamCatchUpBy = 0.0;

	/* the task */
	EWonderlandConsoleActivity Activity = EWonderlandConsoleActivity::Idle;
	FString Verb;
	double TaskStartedAt = 0.0;
	double TaskEndedAt = 0.0;
	double CycleOrigin = 0.0;
	int64 Counter = 0;
	FString CounterUnit;
	bool bCountLines = false;
	bool bInterruptible = false;
	bool bFinishPending = false;
	/** When FinishTask was called: the row's clock stops there while the queued lines finish showing. */
	double FinishAt = 0.0;
	FString FinishSummary;
	FString FailReason;
	FString IdleText;
	bool bQuiet = false;
	FString Subline;
	FString SessionLabel;
	FString Mode;
	FString Status;
	FString InputHint;
	FString LatestActivity;
	FName NarratedBeat;

	/* rows and scrolling (built lazily from the width last painted) */
	mutable TArray<FRow> Rows;
	mutable int32 RowsBuiltForLines = 0;
	mutable int32 RowCols = 0;
	mutable float CellW = 0.0f;
	mutable float LineH = 0.0f;
	mutable float MeasuredForScale = -1.0f;
	mutable int32 VisibleRows = 1;
	mutable FVector2D MarkTopLeft = FVector2D::ZeroVector;
	mutable FVector2D MarkSize = FVector2D::ZeroVector;
	mutable FSlateRect PillRect = FSlateRect(0, 0, 0, 0);
	/** The row index at the transcript's bottom edge, eased toward its target: following, the target is the newest row. */
	mutable float ScrollPos = 0.0f;
	mutable float ScrollTarget = 0.0f;
	bool bFollow = true;
	int32 RowsWhenLeft = 0;

	TSharedPtr<SEditableTextBox> Input;
	FEditableTextBoxStyle InputStyle;
	FSlateFontInfo Font;
	FSlateRoundedBoxBrush FrameBrush;
	FSlateRoundedBoxBrush PillBrush;
	mutable FSlateRoundedBoxBrush DotBrush;
	FLinearColor BrushAccent = FLinearColor::White;
};

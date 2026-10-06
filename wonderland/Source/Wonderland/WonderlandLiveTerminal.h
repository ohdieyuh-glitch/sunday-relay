// WONDERLAND — the Julius Live Terminal, drawn in Unreal.
//
// WHY CTRL+T STOPPED WORKING, recorded where the fix lives. The Live Terminal was
// never an Unreal widget. It was an overlay on the Pixel Streaming page
// (wonderland/web/player/{terminal,keys,feed,mount}.js on relay/wonderland-v2): the
// browser caught Ctrl+T before forwarding keys to the stream and mounted the panel
// over the video. RelayDogCharacter's own Ctrl+T handler only logs "the front end
// owns the panel". Running the game natively in UE 5.8 PIE there is no page, so
// the chord reached a handler that, correctly, did nothing.
//
// SO THIS IS A PORT, NOT A REDESIGN. Every decision below was already made and
// approved on the web: one outlined window 39.2% of the viewport wide and 27.3%
// tall, bottom-centred with a 3.1% margin; four stacked sections in the founder's
// order with the orchestration layer THIRD; a gold square, a gold title, the state
// bracketed beside the name and repeated on the right; the detail sub-line only in
// the section that is working; a command line underneath. The one change is the
// founder's own, 2026-09-12: the orchestration section reads JULIUS 3.3.
//
// NOTHING HERE PRETENDS TO BE CONNECTED. With no real Julius run followed, the
// panel says STANDBY rather than LIVE. While one IS followed (2026-09-27), the
// JULIUS 3.3 section carries that run's state and the banner line names the run
// and Julius's own word for its state -- fed from what the world holds, by
// UWonderlandUiSubsystem, never invented here. A command typed into it is recorded
// as yours and marked "not sent" — never answered — which is the web panel's rule:
// "a command typed with nowhere to send it says so rather than being answered."
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"

class SEditableTextBox;
class SScrollBox;
class STextBlock;
class SVerticalBox;
class SWonderlandWorkLog;

/** A numbered hexagon slot, as in the founder's frame. */
class WONDERLAND_API SWonderlandHexBadge : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandHexBadge)
		: _Size(34.0f)
		, _Color(FLinearColor::White)
		, _InnerMark(false)
	{}
		SLATE_ARGUMENT(FString, Label)
		SLATE_ARGUMENT(float, Size)
		SLATE_ARGUMENT(FLinearColor, Color)
		/** Draw an inner hexagon and centre point instead of a label. */
		SLATE_ARGUMENT(bool, InnerMark)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual FVector2D ComputeDesiredSize(float) const override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

private:
	FString Label;
	float Size = 34.0f;
	FLinearColor Color = FLinearColor::White;
	bool bInnerMark = false;
};

class WONDERLAND_API SWonderlandLiveTerminal : public SCompoundWidget
{
public:
	/**
	 * ONE JULIUS TASK TERMINAL, as the tab strip needs to draw it.
	 *
	 * THE ID IS THE TASK'S OWN. The founder was explicit that a terminal tab, its Mission Contract and its orb are
	 * one thing seen three ways -- "Do not create three independent representations with unrelated ids" -- so this
	 * carries FWonderlandMissionTask::LocalId and invents no identity of its own.
	 */
	struct FTaskTab
	{
		FGuid Id;
		FString Label;
		bool bSelected = false;
		bool bDraft = false;
	};

	DECLARE_DELEGATE_RetVal(TArray<FTaskTab>, FOnGetTaskTabs);
	DECLARE_DELEGATE_OneParam(FOnSelectTaskTab, FGuid /*Id*/);
	DECLARE_DELEGATE_OneParam(FOnSubmit, const FString& /*Text*/);
	DECLARE_DELEGATE_RetVal_OneParam(FString, FOnGetCommandLabel, int32 /*Slot*/);

	SLATE_BEGIN_ARGS(SWonderlandLiveTerminal)
		: _CommandSlotCount(4)
	{}
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FOnSubmit, OnSubmit)
		/** The open Julius task terminals, asked for fresh rather than remembered. */
		SLATE_EVENT(FOnGetTaskTabs, OnGetTaskTabs)
		SLATE_EVENT(FOnSelectTaskTab, OnSelectTaskTab)
		/** Press +: open ANOTHER Julius task terminal. Never overwrites the one being viewed. */
		SLATE_EVENT(FSimpleDelegate, OnAddTaskTerminal)
		/** Press X: close the SELECTED task terminal. A draft is discarded; a contract keeps its truth. */
		SLATE_EVENT(FSimpleDelegate, OnCloseTaskTerminal)
		/** How many tasks are closed but remembered, so the strip can say so instead of hiding them. */
		SLATE_ATTRIBUTE(int32, ClosedTaskCount)
		/** How many command rows the left list draws: the preset station's quick slot count. */
		SLATE_ARGUMENT(int32, CommandSlotCount)
		/** The command in a quick slot of the active layout, read every paint; empty for an empty slot. */
		SLATE_EVENT(FOnGetCommandLabel, OnGetCommandLabel)
	SLATE_END_ARGS()

	SWonderlandLiveTerminal();
	void Construct(const FArguments& InArgs);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	/** What should hold keyboard focus while the terminal is open. */
	TSharedPtr<SWidget> GetFocusTarget() const;

	/** Record a line in the JULIUS 3.3 section. The newest line is the one with a sub-line. */
	void AddJuliusRow(const FString& Role, const FString& Headline, const FString& Detail);

	FString GetInputText() const;
	int32 GetJuliusRowCount() const { return JuliusRows.Num(); }

	/** The command rows as they read on screen, "|"-joined. */
	FString DescribeCommandRows() const;

	// ---------------------------------------------------------------- simulated execution
	// THE TERMINAL NARRATES A SIMULATED MISSION when one runs (WonderlandMissionNarration.h). While it shows simulated
	// rows it carries DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION above its sections, so a deterministic fixture
	// can never be read as a paid Julius run.

	/** Show or hide the simulated-execution banner. */
	void SetSimulated(bool bInSimulated) { bSimulated = bInSimulated; }
	bool IsSimulated() const { return bSimulated; }
	/** Deterministic estimate from emitted work-log characters, not provider usage or billing. */
	int64 GetSimulatedTokenCount() const { return (SimulatedCharacters + 3) / 4; }

	/** Move one section: PROMPT ARCHITECT, CODING AGENT, INDEPENDENT REVIEWER (state and line) or JULIUS 3.3 (state). */
	void SetSectionState(const FString& Section, const FString& State, const FString& Line);

	/** A section's state as it reads now. */
	FString GetSectionState(const FString& Section) const;

	/** The newest JULIUS 3.3 headline, or empty. */
	FString GetLatestJuliusHeadline() const { return !LatestJuliusHeadline.IsEmpty() ? LatestJuliusHeadline : (JuliusRows.Num() > 0 ? JuliusRows.Last().Headline : FString()); }

	/** The newest JULIUS 3.3 row as drawn -- "<headline> | <answer>" (both masked as the row is) -- or empty. Read-only, for QA. */
	FString GetLatestJuliusRow() const { return JuliusRows.Num() > 0 ? JuliusRows.Last().Headline + TEXT(" | ") + JuliusRows.Last().Detail : FString(); }

	/** Record Julius's newest line without drawing a row for it (the work log has drawn it). */
	void NoteJuliusHeadline(const FString& Headline) { LatestJuliusHeadline = Headline; }

	/** A new mission: the simulated rows and section states go back to rest. */
	void ResetSimulation();

	// ---------------------------------------------------------------- a REAL Julius run (founder, 2026-09-27)
	// The banner line that says DEVELOPMENT PREVIEW over a simulation names the run instead while a real one is
	// followed: JULIUS LIVE, the run, and Julius's own word for its state. The same line, never a new element.

	/**
	 * The followed run's provenance, or empty when no real run is followed. A simulation's warning still wins.
	 *
	 * THE TERMINAL IS GIVEN UWonderlandMissionSubsystem::GetProvenanceBanner() VERBATIM -- the same sentence the strip
	 * and the Missions panel badge draw, so the three cannot disagree. The price of that is deliberate: a change to
	 * that sentence's wording moves all three surfaces at once. Edit it there, never here.
	 */
	void SetLiveProvenance(const FString& InProvenance) { LiveProvenance = InProvenance; }

	/** What the banner line reads now: the simulation's warning, the live run's provenance, or empty. For proof jobs. */
	FString GetBannerText() const;

	// ---------------------------------------------------------------- the four components at work (founder, 2026-09-16)
	// THE TERMINAL ALWAYS LOOKS LIKE THE FOUNDER'S IMAGE: these four sections, their headers, the message line. Each
	// section's body is a rolling log of its component's work (WonderlandJuliusWorkLog.h). When there is more to show the
	// terminal EXTENDS VERTICALLY -- same width, same bottom edge -- to a hard limit, and each section shows as many of its
	// newest lines as fit; nothing ever has to be scrolled to be seen. The stage's focus section gets the most lines.

	/** A section's work log: PROMPT ARCHITECT, CODING AGENT, JULIUS 3.3 or INDEPENDENT REVIEWER. */
	TSharedPtr<SWonderlandWorkLog> GetWorkLog(const FString& Section) const;

	/** The section the terminal keeps its newest work in view for. */
	void SetFocusSection(const FString& Section) { FocusSection = Section; }
	FString GetFocusSection() const { return FocusSection; }

	/** Lines written into a section this mission, and its newest lines, "\n"-joined. For proof jobs. */
	int32 GetSectionLineCount(const FString& Section) const;
	FString DescribeSection(const FString& Section, int32 MaxLines) const;

	/** How far the terminal has extended above its approved height, and its limit, in slate units. */
	float GetExtension() const { return ExtensionShown; }
	float GetExtensionLimit() const { return ExtensionLimit; }
	/** How many rows a section is showing now. */
	int32 GetSectionVisibleRows(const FString& Section) const;

private:
	struct FRow
	{
		FString Time;
		FString Role;
		FString Headline;
		FString Detail;
	};

	TSharedRef<SWidget> MakeSection(const FString& Title, const FString& State, TSharedRef<SWidget> Body);
	TSharedRef<SWidget> MakeRestingLine(const FString& Text);
	/** A section's line that follows SetSectionState, showing Resting until the section has been moved. */
	TSharedRef<SWidget> MakeLiveLine(const FString& Section, const FString& Resting);
	TSharedRef<SWidget> MakeSideList(bool bLoops);
	void RebuildJuliusBody();
	void HandleCommitted(const FText& Text, ETextCommit::Type CommitType);
	FReply HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent);
	bool IsCloseChord(const FKeyEvent& KeyEvent) const;
	void UpdateSimulatedTokenCount();

	FSimpleDelegate OnRequestClose;
	FOnSubmit OnSubmit;
	FOnGetTaskTabs OnGetTaskTabs;
	FOnSelectTaskTab OnSelectTaskTab;
	FSimpleDelegate OnAddTaskTerminal;
	FSimpleDelegate OnCloseTaskTerminal;
	TAttribute<int32> ClosedTaskCount;

	/** The strip of task terminals across the top, and the + that opens another. */
	TSharedRef<SWidget> MakeTaskTabs();
	void RebuildTaskTabs();
	TSharedPtr<class SHorizontalBox> TaskTabBox;
	/** What the strip was last built from, so it is rebuilt when the set changes and not every frame. */
	FString TaskTabSignature;
	FOnGetCommandLabel OnGetCommandLabel;
	int32 CommandSlotCount = 4;
	bool bSimulated = false;
	FString LiveProvenance;
	int64 SimulatedCharacters = 0;
	TMap<FString, int32> SimulatedCountedLines;
	TMap<FString, FString> SectionStates;
	TMap<FString, FString> SectionLines;
	TMap<FString, FString> RestingStates;
	TMap<FString, FString> RestingLines;
	TArray<TSharedPtr<STextBlock>> CommandTexts;

	TSharedPtr<SEditableTextBox> Input;
	TSharedPtr<SVerticalBox> JuliusBody;
	TArray<FRow> JuliusRows;

	TMap<FString, TSharedPtr<SWonderlandWorkLog>> WorkLogs;
	FString LatestJuliusHeadline;
	FString FocusSection;
	/** The window, so its height can be measured; how far it has extended, where it is heading, and its hard limit. */
	TSharedPtr<SWidget> WindowWidget;
	float ExtensionShown = 0.0f;
	float ExtensionLimit = 0.0f;
	TSharedRef<SWidget> MakeWorkLog(const FString& Section, const FString& Resting);

	FSlateRoundedBoxBrush WindowBrush;
	/** The plate of all four panels (Architect, Coder, JULIUS 3.3, Reviewer): one black, the darkest in the terminal. */
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush InputBrush;
	FSlateRoundedBoxBrush SlotBrush;
	FEditableTextBoxStyle InputStyle;

	/**
	 * THE ACCENT THESE FOUR BRUSHES WERE BUILT FROM, AND THE TIMER THAT NOTICES IT CHANGING.
	 *
	 * FOUNDER, P1 item 9: "Add Julius + Companion Terminal color customization", then 2026-09-28: "just make
	 * the terminal color change more apparent."
	 *
	 * THIS WINDOW FOLLOWED NOTHING. The Companion terminal has had a FollowTheme since it was written; this
	 * one never did. Its four brushes were built once in the constructor and never rebuilt, so choosing a new
	 * Julius colour repainted only the text that calls JuliusGold() during paint -- the window frame, the
	 * section frames, the input box and the command slots all kept whatever they were constructed with.
	 *
	 * Worse, they were constructed from GoldDim(), which is the GENERAL THEME accent, not JuliusAccent(). So
	 * the Julius terminal's own colour never reached its own chrome even in principle. That is the larger part
	 * of why the change did not look apparent, and it is a defect rather than a matter of degree.
	 */
	FLinearColor BrushAccent;
	EActiveTimerReturnType FollowTheme(double InCurrentTime, float InDeltaTime);
	void RebuildChrome();
};

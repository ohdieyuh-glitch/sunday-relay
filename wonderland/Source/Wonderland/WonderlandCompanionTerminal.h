// WONDERLAND — A COMPANION TERMINAL. The on-screen console of one imported companion.
//
// NOT THE EMBODIMENT. The companion itself floats in the world beside the Relay Dog
// (AWonderlandCompanionEmbodiment, owned by the world). This is the panel you type into, owned by
// UWonderlandUiSubsystem with everything else drawn over the world. The founder was explicit that the two
// must never be confused (2026-09-15), and keeping them in different owners is what makes that structural.
//
// DRAWN TO THE FOUNDER'S FRAME (2026-09-15), in the Julius Live Terminal's colourway: a near-black panel in a
// heavy gold frame; the title in chunky gold pixel type behind the CLI chevron (SWonderlandPixelText), WAITING
// at the right; the companion's line in wide cream capitals; an open log; and, under a gold rule, the command
// line -- a chevron, the input, and a ruled-off "Send  Ctrl+Enter".
//
// NOTHING HERE PRETENDS TO BE CONNECTED. No companion is imported into Wonderland yet, so the state reads
// WAITING, and a line typed into the panel is recorded as yours and marked not sent -- the Live Terminal's
// rule, "a command typed with nowhere to send it says so rather than being answered."
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"

class SEditableTextBox;
class SVerticalBox;

class WONDERLAND_API SWonderlandCompanionTerminal : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnSubmit, const FString& /*Text*/);

	SLATE_BEGIN_ARGS(SWonderlandCompanionTerminal)
		: _Accent(FLinearColor::White)
	{}
		/** The presentation name, e.g. "GPT 6 Astra". Drawn upper-case in pixel type. */
		SLATE_ARGUMENT(FString, Title)
		/** The companion's line under the title. A "\n" breaks it where the frame breaks it. */
		SLATE_ARGUMENT(FString, Intro)
		/** The companion's own colour, the one its embodiment glows in: the speaker mark on a recorded line. */
		SLATE_ARGUMENT(FLinearColor, Accent)
		SLATE_EVENT(FOnSubmit, OnSubmit)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	SWonderlandCompanionTerminal();
	void Construct(const FArguments& InArgs);

	/** Record one line under the intro. The newest two show; older lines scroll away. */
	void AddLine(const FString& Speaker, const FString& Text, bool bDim);

	/**
	 * THE STATE AT THE RIGHT OF THE TITLE. WAITING until the companion joins a mission; ACTIVE · JOINED while it takes
	 * part. The banner under it -- DEVELOPMENT PREVIEW · SIMULATED /JOIN IN -- shows whenever the state is not WAITING,
	 * because nothing is imported and a joined companion here is a simulation.
	 */
	void SetStatus(const FString& InStatus);
	const FString& GetStatus() const { return Status; }

	/** The activity the newest line was spoken as, e.g. RESEARCHING, and the beat it narrated. */
	const FString& GetLatestActivity() const { return LatestActivity; }
	FName GetNarratedBeat() const { return NarratedBeat; }
	void NoteNarration(const FString& Activity, FName Beat) { LatestActivity = Activity; NarratedBeat = Beat; }

	/** Clear the log, as a new mission does. */
	void ClearLines();

	/** What should hold keyboard focus when this terminal is being typed into. */
	TSharedPtr<SWidget> GetFocusTarget() const;

	FString GetInputText() const;
	int32 GetLineCount() const { return Lines.Num(); }
	const FString& GetTitle() const { return Title; }

private:
	struct FLine
	{
		FString Speaker;
		FString Text;
		bool bDim = false;
	};

	void RebuildLog();
	void Submit();
	FReply HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent);

	FString Title;
	FString Status = TEXT("WAITING");
	FString LatestActivity;
	FName NarratedBeat;
	FLinearColor Accent = FLinearColor::White;
	FOnSubmit OnSubmit;
	FSimpleDelegate OnRequestClose;

	TSharedPtr<SEditableTextBox> Input;
	TSharedPtr<SVerticalBox> Log;
	TArray<FLine> Lines;

	FSlateRoundedBoxBrush FrameBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FEditableTextBoxStyle InputStyle;
};

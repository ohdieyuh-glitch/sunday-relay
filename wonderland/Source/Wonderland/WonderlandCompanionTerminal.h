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

/**
 * THE i.WONDER PULSE: the mark, beating while a companion works.
 *
 * Three nested arcs in the HUD's own colours, painted as lines so they scale cleanly, on a heartbeat envelope --
 * a quick rise, a slower fall, a smaller second beat, a rest. Not a spinner: nothing rotates, the mark breathes.
 */
class WONDERLAND_API SWonderlandPulseMark : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandPulseMark)
		: _Size(26.0f), _Beating(true) {}
		SLATE_ARGUMENT(float, Size)
		/** Beating while the companion works; still and dim otherwise. */
		SLATE_ATTRIBUTE(bool, Beating)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(Size, Size); }

	/** The envelope, 0..1, for a proof to read: it must move while beating and sit at zero while still. */
	float GetEnvelope() const;

private:
	float Size = 26.0f;
	TAttribute<bool> Beating;
};

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

	/**
	 * Record one line under the intro. The newest two show; older lines scroll away.
	 *
	 * A COMPANION'S OWN LINE STREAMS IN word by word rather than landing whole; a note (no speaker, dim) lands
	 * at once, because a note is the runtime talking about the companion, not the companion talking.
	 */
	void AddLine(const FString& Speaker, const FString& Text, bool bDim);

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	/* ------------------------------------------------ the working rhythm, for the founder and for a proof */

	/** True while the mark is beating: the runtime says the companion is working and no words are being revealed. */
	bool IsPulsing() const;
	/** True while a line is being revealed word by word. */
	bool IsStreaming() const { return !Reveal.Pending.IsEmpty(); }
	/** The label actually shown at the top right: STREAMING while revealing, else the runtime's own state. */
	FString GetShownStatus() const;
	/** How many words have been revealed of the line currently streaming. */
	int32 GetRevealedWordCount() const { return Reveal.Revealed; }

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

	/**
	 * THE REVEAL. A companion line is appended to Lines with empty text and its words are moved across from
	 * Pending one at a time on a cadence, so the founder watches it arrive. Whole lines queue behind it.
	 */
	struct FReveal
	{
		TArray<FString> Pending;
		int32 Revealed = 0;
		int32 LineIndex = INDEX_NONE;
		double NextWordAt = 0.0;
		TArray<TPair<FString, FString>> Queue;
	} Reveal;
	void StartReveal(const FString& Speaker, const FString& Text, double Now);
	TSharedPtr<SWonderlandPulseMark> Pulse;
	/** The canonical i.Wonder mark, when Content has it; the drawn pulse is the fallback. */
	TSharedPtr<FSlateDynamicImageBrush> LogoBrush;
	TSharedPtr<class SImage> LogoImage;

	FSlateRoundedBoxBrush FrameBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FEditableTextBoxStyle InputStyle;
};

// WONDERLAND — WHAT A JULIUS COMPONENT IS DOING, AS WORK YOU CAN WATCH. The body of one section of the Julius Live
// Terminal (founder, 2026-09-16 evening).
//
// "I want to visibly WATCH CODE BEING WRITTEN." A section is no longer one line of status: it is a log of the component's
// actual work -- source code typed line by line with line numbers, colours and +/- markers; an outbound prompt preview in
// its own box with its target; a review checklist; a finding with its severity and file; commands and test results.
//
// COMPONENT BOXES ARE CONTENT-DRIVEN AND GROW DOWNWARD (permanent founder rule). This widget takes exactly the height its
// work needs; the terminal around it scrolls. Nothing is truncated to keep boxes equal: a line too long for the width
// wraps. When a component moves on to new work its previous EPISODE collapses to one summary line, and a click on that
// line opens it again -- the full detail stays in the terminal's history.
//
// INSIDE THE EXISTING TERMINAL ONLY. This is a section's body; the terminal's place, width and four sections are
// unchanged, and the HUD around it is not touched.
//
// DEVELOPMENT PREVIEW. Every line comes from a deterministic fixture (WonderlandRoleScript.h); no provider is called.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"
#include "WonderlandRoleScript.h"

class SVerticalBox;

/**
 * One line of code or prompt text, painted token by token so it can be TYPED: only the first `Reveal` characters are
 * drawn, with a cursor after them while it is typing. Its desired width is the whole line's, so the layout does not move
 * as the characters arrive.
 */
class WONDERLAND_API SWonderlandTypedText : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandTypedText)
		: _Syntax(true)
		, _Color(FLinearColor::White)
	{}
		SLATE_ARGUMENT(FString, Text)
		SLATE_ARGUMENT(FSlateFontInfo, Font)
		/** Colour by syntax (code), or draw the whole line in `Color` (prompt text). */
		SLATE_ARGUMENT(bool, Syntax)
		SLATE_ARGUMENT(FLinearColor, Color)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

	/** How many characters are shown; negative shows them all. */
	void SetReveal(int32 Chars) { Reveal = Chars; }
	int32 GetLength() const { return Text.Len(); }

private:
	struct FToken
	{
		int32 Start = 0;
		int32 Length = 0;
		FLinearColor Color = FLinearColor::White;
	};
	void Tokenize(bool bSyntax, const FLinearColor& Plain);

	FString Text;
	FSlateFontInfo Font;
	TArray<FToken> Tokens;
	int32 Reveal = -1;
};

/** The work log that is one Julius component's section body. */
class WONDERLAND_API SWonderlandWorkLog : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWorkLog) {}
		/** What the section says before any work has been written into it. */
		SLATE_ARGUMENT(FString, RestingText)
	SLATE_END_ARGS()

	SWonderlandWorkLog();
	void Construct(const FArguments& InArgs);

	/** A new mission: everything goes, and the resting line returns. */
	void Reset();

	/** Begin a new piece of work. The previous one collapses to its summary line, which a click reopens. */
	void BeginEpisode(const FString& Title);

	/** The summary a collapsed episode shows. Written by the script, or built from the episode's own diff counts. */
	void SetEpisodeSummary(const FString& Summary);

	/** Write a line of work. Returns an id for a line that TYPES (code, prompt text), else INDEX_NONE. */
	int32 AddLine(EWonderlandRoleLineKind Kind, const FString& Text);

	/** How far a typing line has got, in characters; its full length. */
	void SetReveal(int32 LineId, int32 Chars);
	int32 GetLineLength(int32 LineId) const;

	/** The widget of the newest line, so the terminal can keep it in view. */
	TSharedPtr<SWidget> GetNewestWidget() const { return Newest; }
	/** Bumped each time a line is written or a typing line grows. */
	int32 GetChangeSerial() const { return ChangeSerial; }

	int32 GetLineCount() const { return LineCount; }
	int32 GetEpisodeCount() const { return Episodes.Num(); }
	FString GetNewestText() const { return NewestText; }
	/** Every line written this mission, newest last, "\n"-joined: what a proof job reads. */
	FString DescribeLines(int32 MaxLines) const;

private:
	struct FEpisode
	{
		FString Title;
		FString Summary;
		FString File;
		int32 Added = 0;
		int32 Removed = 0;
		bool bCollapsed = false;
		TSharedPtr<SVerticalBox> Body;
	};

	TSharedRef<SWidget> MakeLineWidget(EWonderlandRoleLineKind Kind, const FString& Text, TSharedPtr<SWonderlandTypedText>& OutTyper);
	TSharedRef<SWidget> MakeCodeRow(const FString& Number, TCHAR Marker, const FString& Code, TSharedPtr<SWonderlandTypedText>& OutTyper);
	void EnsureEpisode();
	FString EpisodeSummaryText(const FEpisode& Episode) const;

	FString RestingText;
	TSharedPtr<SVerticalBox> Root;
	TArray<TSharedPtr<FEpisode>> Episodes;
	/** While a prompt preview box is open, its lines go inside it. */
	TSharedPtr<SVerticalBox> OpenPrompt;
	TArray<TSharedPtr<SWonderlandTypedText>> Typers;
	TSharedPtr<SWidget> Newest;
	FString NewestText;
	TArray<FString> Written;
	int32 LineCount = 0;
	int32 ChangeSerial = 0;

	FSlateRoundedBoxBrush PromptBrush;
	FSlateRoundedBoxBrush FindingBrush;
	FSlateRoundedBoxBrush AddBrush;
	FSlateRoundedBoxBrush RemoveBrush;
	FSlateRoundedBoxBrush SummaryBrush;
};

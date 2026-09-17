// WONDERLAND — WHAT A JULIUS COMPONENT IS DOING, IN THE TERMINAL THE FOUNDER APPROVED. The body of one section of the
// Julius Live Terminal.
//
// THE TERMINAL LOOKS LIKE THE FOUNDER'S IMAGE, ALWAYS (founder, 2026-09-16, repeated with the picture): four sections --
// PROMPT ARCHITECT, CODING AGENT, JULIUS 3.3, INDEPENDENT REVIEWER -- each a header and its lines, and the message line
// underneath. No new panels, no strips, no boxes inside boxes. When there is more work to show, the terminal EXTENDS
// VERTICALLY to a hard limit and each section shows more of its newest lines; it never grows so far that anything has to
// be scrolled to be seen. Everything stays right there.
//
// So this is a ROLLING LOG: every line is kept, the newest `VisibleLines` are shown, and the terminal decides how many
// each section gets (the stage's focus gets the most). The body eases to its new height rather than jumping.
//
// THE LINES ARE WORK, NOT STATUS: code typed character by character with line numbers, colours and +/- markers; an
// outbound prompt with its target; checklist items; a finding with its severity and file; commands and test results.
// DEVELOPMENT PREVIEW -- every line comes from a deterministic fixture (WonderlandRoleScript.h); no provider is called.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"
#include "WonderlandRoleScript.h"

class SVerticalBox;

/**
 * One line of code or prompt text, painted token by token so it can be TYPED: only the first `Reveal` characters are
 * drawn, with a cursor after them while it is typing.
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

/** The rolling log that is one Julius component's section body. */
class WONDERLAND_API SWonderlandWorkLog : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWorkLog) {}
		/** What the section says before any work has been written into it. */
		SLATE_ARGUMENT(FString, RestingText)
	SLATE_END_ARGS()

	SWonderlandWorkLog();
	void Construct(const FArguments& InArgs);
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	/** A new mission: everything goes, and the resting line returns. */
	void Reset();

	/** Write a line of work. Returns an id for a line that TYPES (code, prompt text), else INDEX_NONE. */
	int32 AddLine(EWonderlandRoleLineKind Kind, const FString& Text);

	/**
	 * A JULIUS 3.3 row, exactly as the approved terminal draws one: a gold bullet, the time, "Role:", the headline -- and
	 * the dim sub-line only under the newest row.
	 */
	void AddJuliusRow(const FString& Time, const FString& Role, const FString& Headline, const FString& Detail);

	/** How far a typing line has got, in characters; its full length. */
	void SetReveal(int32 LineId, int32 Chars);
	int32 GetLineLength(int32 LineId) const;

	/** How many of the newest rows to show. The terminal sets this; the body eases to the height it needs. */
	void SetVisibleRows(int32 Count) { VisibleRows = FMath::Max(Count, 1); UpdateVisibleFrom(); }
	int32 GetVisibleRows() const { return VisibleRows; }
	/** Rows written this mission (the resting line counts as one before any are). */
	int32 GetRowCount() const { return FMath::Max(RowSeqs.Num(), 1); }
	/** The body's height now, and the height it is easing toward, in slate units. */
	float GetShownHeight() const { return ShownHeight; }
	float GetTargetHeight() const;
	/** The height of one row. */
	static constexpr float RowHeight = 14.0f;

	int32 GetLineCount() const { return LineCount; }
	FString GetNewestText() const { return NewestText; }
	/** The newest lines written this mission, "\n"-joined: what a proof job reads. */
	FString DescribeLines(int32 MaxLines) const;

private:
	/** Add one drawn row (a line can be several: a finding is three). Returns its sequence number. */
	int32 AddRow(TSharedRef<SWidget> Row);
	void RemoveRow(int32 Seq);
	void UpdateVisibleFrom();
	TSharedRef<SWidget> CodeRow(const FString& Number, TCHAR Marker, const FString& Code, TSharedPtr<SWonderlandTypedText>& OutTyper);
	TSharedRef<SWidget> TextRow(const FString& Text, const FLinearColor& Color, bool bBold = false, float Indent = 0.0f);

	FString RestingText;
	TSharedPtr<SVerticalBox> Root;
	/** The rows in order, by sequence number, with the slot widget each sits in. */
	TArray<int32> RowSeqs;
	TArray<TSharedRef<SWidget>> RowSlots;
	int32 NextSeq = 0;
	/** Rows with a sequence number below this are older than the newest VisibleRows and are collapsed. */
	int32 VisibleFromSeq = 0;
	/** The dim sub-line under the newest Julius row, removed when the next row comes. */
	int32 JuliusDetailSeq = INDEX_NONE;
	TArray<TSharedPtr<SWonderlandTypedText>> Typers;
	TArray<FString> Written;
	FString NewestText;
	int32 LineCount = 0;
	int32 VisibleRows = 1;
	float ShownHeight = RowHeight;

	FSlateRoundedBoxBrush AddBrush;
	FSlateRoundedBoxBrush RemoveBrush;
};

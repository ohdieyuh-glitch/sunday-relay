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
// NOTHING HERE PRETENDS TO BE CONNECTED. Julius is not wired to the world yet, and
// the panel says STANDBY rather than LIVE. A command typed into it is recorded as
// yours and marked "not sent" — never answered — which is the web panel's rule:
// "a command typed with nowhere to send it says so rather than being answered."
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SLeafWidget.h"

class SEditableTextBox;
class STextBlock;
class SVerticalBox;

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
	DECLARE_DELEGATE_OneParam(FOnSubmit, const FString& /*Text*/);
	DECLARE_DELEGATE_RetVal_OneParam(FString, FOnGetCommandLabel, int32 /*Slot*/);

	SLATE_BEGIN_ARGS(SWonderlandLiveTerminal)
		: _CommandSlotCount(4)
	{}
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FOnSubmit, OnSubmit)
		/** How many command rows the left list draws: the preset station's quick slot count. */
		SLATE_ARGUMENT(int32, CommandSlotCount)
		/** The command in a quick slot of the active layout, read every paint; empty for an empty slot. */
		SLATE_EVENT(FOnGetCommandLabel, OnGetCommandLabel)
	SLATE_END_ARGS()

	SWonderlandLiveTerminal();
	void Construct(const FArguments& InArgs);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	/** What should hold keyboard focus while the terminal is open. */
	TSharedPtr<SWidget> GetFocusTarget() const;

	/** Record a line in the JULIUS 3.3 section. The newest line is the one with a sub-line. */
	void AddJuliusRow(const FString& Role, const FString& Headline, const FString& Detail);

	FString GetInputText() const;
	int32 GetJuliusRowCount() const { return JuliusRows.Num(); }

	/** The command rows as they read on screen, "|"-joined. */
	FString DescribeCommandRows() const;

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
	TSharedRef<SWidget> MakeSideList(bool bLoops);
	void RebuildJuliusBody();
	void HandleCommitted(const FText& Text, ETextCommit::Type CommitType);
	FReply HandleInputKeyDown(const FGeometry& Geometry, const FKeyEvent& KeyEvent);
	bool IsCloseChord(const FKeyEvent& KeyEvent) const;

	FSimpleDelegate OnRequestClose;
	FOnSubmit OnSubmit;
	FOnGetCommandLabel OnGetCommandLabel;
	int32 CommandSlotCount = 4;
	TArray<TSharedPtr<STextBlock>> CommandTexts;

	TSharedPtr<SEditableTextBox> Input;
	TSharedPtr<SVerticalBox> JuliusBody;
	TArray<FRow> JuliusRows;

	FSlateRoundedBoxBrush WindowBrush;
	FSlateRoundedBoxBrush SectionBrush;
	FSlateRoundedBoxBrush InputBrush;
	FSlateRoundedBoxBrush SlotBrush;
	FEditableTextBoxStyle InputStyle;
};

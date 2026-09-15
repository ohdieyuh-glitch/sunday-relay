// WONDERLAND — A COMPANION TERMINAL. The on-screen console of one imported companion.
//
// NOT THE EMBODIMENT. The companion itself floats in the world beside the Relay Dog
// (AWonderlandCompanionEmbodiment, owned by the world). This is the panel you type into, owned by
// UWonderlandUiSubsystem with everything else drawn over the world. The founder was explicit that the two
// must never be confused (2026-09-15), and keeping them in different owners is what makes that structural.
//
// THE JULIUS LIVE TERMINAL'S COLOURWAY, AT COMPANION SIZE. A near-black body, a gold hairline, a gold
// title behind the CLI chevron, cream monospace text and a command line along the bottom with its Send
// affordance -- wider than tall, sized to sit at the edge of the screen rather than open over the world
// (founder: "black terminal-like body", "chatbox at the bottom", "more square / wider, less narrow",
// "companion terminals, not giant windows").
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
		/** The presentation name, e.g. "GPT 6 Astra". Drawn upper-case in the title. */
		SLATE_ARGUMENT(FString, Title)
		/** What kind of companion this is, e.g. "LLM COMPANION · IMPORTED". */
		SLATE_ARGUMENT(FString, ClassLine)
		/** The one sentence under the title. */
		SLATE_ARGUMENT(FString, Intro)
		/** The companion's own colour, the one its embodiment glows in: the status pip and the speaker mark. */
		SLATE_ARGUMENT(FLinearColor, Accent)
		SLATE_EVENT(FOnSubmit, OnSubmit)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	SWonderlandCompanionTerminal();
	void Construct(const FArguments& InArgs);

	/** Record one line under the intro. The newest two show; older lines scroll away. */
	void AddLine(const FString& Speaker, const FString& Text, bool bDim);

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
	FLinearColor Accent = FLinearColor::White;
	FOnSubmit OnSubmit;
	FSimpleDelegate OnRequestClose;

	TSharedPtr<SEditableTextBox> Input;
	TSharedPtr<SVerticalBox> Log;
	TArray<FLine> Lines;

	FSlateRoundedBoxBrush WindowBrush;
	FSlateRoundedBoxBrush InputBrush;
	FSlateRoundedBoxBrush DividerBrush;
	FEditableTextBoxStyle InputStyle;
};

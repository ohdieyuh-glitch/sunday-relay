// WONDERLAND — one live console of the Julius mission deck (founder, 2026-09-16).
//
// While a simulated mission runs, the Julius Live Terminal becomes a deck along the bottom of the screen: JULIUS, the
// largest, with the command line, flanked by PROMPT ARCHITECT, CODING AGENT and INDEPENDENT REVIEWER. Each console
// writes its own work line by line from the same event stream the Relay Dog performs (WonderlandRoleScript.h), so the
// world and all four consoles move together, and the world above the deck stays in view.
//
// A console shows its role, what it is doing now (the status at the right), a tag that says it is a Julius component
// running a SIMULATION, and its newest lines: packets being composed, diffs, test runs, criteria, findings, decisions.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandRoleScript.h"

class SVerticalBox;

class WONDERLAND_API SWonderlandRoleConsole : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandRoleConsole)
		: _MaxLines(14)
		, _bFramed(true)
		, _TitleSize(10)
		, _LineSize(9)
	{}
		SLATE_ARGUMENT(FString, Title)
		/** The small line under the title, e.g. "JULIUS COMPONENT · SIMULATED". Empty hides it. */
		SLATE_ARGUMENT(FString, Subtitle)
		/** Lines kept on screen; older ones scroll away. */
		SLATE_ARGUMENT(int32, MaxLines)
		/** Draw its own frame. The Julius console sits inside the terminal's window and has none. */
		SLATE_ARGUMENT(bool, bFramed)
		SLATE_ARGUMENT(int32, TitleSize)
		SLATE_ARGUMENT(int32, LineSize)
	SLATE_END_ARGS()

	SWonderlandRoleConsole();
	void Construct(const FArguments& InArgs);

	void AddLine(const FWonderlandRoleLine& Line);
	void SetStatus(const FString& InStatus) { Status = InStatus; }
	const FString& GetStatus() const { return Status; }
	/** Lines written since the console was last cleared, including those that have scrolled away. */
	int32 GetWrittenCount() const { return Written; }
	/** The newest line's text, or empty. */
	FString GetLatestText() const { return Lines.Num() > 0 ? Lines.Last().Text : FString(); }
	/** The newest line's kind, e.g. "DiffAdd", for tests. */
	FString GetLatestKind() const;
	void Clear();

private:
	TSharedRef<SWidget> MakeRow(const FWonderlandRoleLine& Line) const;

	FString Title;
	FString Subtitle;
	FString Status = TEXT("STANDBY");
	int32 MaxLines = 14;
	int32 LineSize = 9;
	int32 Written = 0;
	TArray<FWonderlandRoleLine> Lines;
	TArray<TSharedRef<SWidget>> Rows;
	TSharedPtr<SVerticalBox> Body;
	FSlateRoundedBoxBrush FrameBrush;
};

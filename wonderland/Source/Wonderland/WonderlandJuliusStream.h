// WONDERLAND — the live work of Julius and its three components, INSIDE the Julius Live Terminal (founder, 2026-09-16).
//
// ONE TERMINAL, ONE STREAM. The Julius Live Terminal keeps its established place and size; while a simulated mission
// runs, the body of its window shows a single chronological stream of what the Compound AI Agent is doing -- Julius's
// orchestration, then the component each event hands work to: [PROMPT ARCHITECT] composing a packet, [CODING AGENT]
// writing a diff and running tests, [INDEPENDENT REVIEWER] checking criteria and raising a finding -- each block under
// a tag naming the component and its status. The stream grows downward, keeps its history in a vertical scroll, and
// follows the newest line. Over it, one line says what all four are doing at this moment.
//
// A request for more information in a terminal is a change to its CONTENT, never to the HUD's layout (the founder's
// permanent rule). Nothing here moves or resizes anything outside the terminal's own window.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandRoleScript.h"

class SScrollBox;
class SVerticalBox;

class WONDERLAND_API SWonderlandJuliusStream : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandJuliusStream)
		: _MaxLines(160)
		, _LineSize(9)
	{}
		/** Lines kept in the scrollback. */
		SLATE_ARGUMENT(int32, MaxLines)
		SLATE_ARGUMENT(int32, LineSize)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Write one line of a role's work. A line from a different role than the last opens with that role's tag. */
	void AddRoleLine(EWonderlandJuliusRole Role, const FWonderlandRoleLine& Line);
	/** What a role is doing now, for the status line at the top. */
	void SetRoleStatus(EWonderlandJuliusRole Role, const FString& Status);
	const FString& GetRoleStatus(EWonderlandJuliusRole Role) const;
	/** Lines a role has written since the stream was cleared, tags not counted. */
	int32 GetRoleWrittenCount(EWonderlandJuliusRole Role) const;
	/** A role's newest line and its kind ("DiffAdd", "Preview"...). */
	FString GetRoleLatestText(EWonderlandJuliusRole Role) const;
	FString GetRoleLatestKind(EWonderlandJuliusRole Role) const;
	/** Every line on screen, tags included. */
	int32 GetLineCount() const { return Rows.Num(); }
	void Clear();

private:
	void AddRow(const FString& Text, const FLinearColor& Colour, bool bTag);

	int32 MaxLines = 160;
	int32 LineSize = 9;
	TOptional<EWonderlandJuliusRole> LastRole;
	FString LastStatusTagged[WonderlandJuliusRoleCount];
	FString Statuses[WonderlandJuliusRoleCount];
	int32 Written[WonderlandJuliusRoleCount] = {0, 0, 0, 0};
	FWonderlandRoleLine Latest[WonderlandJuliusRoleCount];
	TArray<TSharedRef<SWidget>> Rows;
	TSharedPtr<SVerticalBox> Body;
	TSharedPtr<SScrollBox> Scroll;
};

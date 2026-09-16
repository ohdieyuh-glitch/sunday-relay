// WONDERLAND — the two small panels behind the bottom shortcuts: MISSIONS and MENU.
//
// MISSIONS SHOWS THE MISSION THAT IS RUNNING, OR SAYS THAT NONE IS. It reads the mission subsystem live -- stage,
// chakra, what the Dog and the companions are doing, the last event and whether it asks for a human -- and when
// there is no task it says so rather than filling the space. The Mission Contract only exists while a task runs,
// and this panel keeps the same rule. It stays labelled SIMULATED JULIUS EXECUTION for as long as that is true.
//
// MENU IS THE WAY TO EVERYTHING ELSE. Every panel the HUD has, with its key, and the controls. There is no settings
// page listed because there is no settings page: a menu row that opens nothing is the one thing a menu must not
// have.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandNavBar.h"

class UWonderlandMissionSubsystem;

class WONDERLAND_API SWonderlandMissionsPanel : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnRequestNavigate, EWonderlandNavTarget);

	SLATE_BEGIN_ARGS(SWonderlandMissionsPanel) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandMissionSubsystem>, Missions)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FOnRequestNavigate, OnRequestNavigate)
	SLATE_END_ARGS()

	SWonderlandMissionsPanel();
	void Construct(const FArguments& InArgs);

	/** True when the panel is showing a running mission rather than the empty state. */
	bool IsShowingMission() const;
	/** The stage line exactly as the panel draws it. */
	FString GetStageLine() const;

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

private:
	TWeakObjectPtr<UWonderlandMissionSubsystem> Missions;
	FSimpleDelegate OnRequestClose;
	FOnRequestNavigate OnRequestNavigate;

	FSlateBrush ScrimBrush;
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush SectionBrush;
	FSlateRoundedBoxBrush PreviewBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FSlateRoundedBoxBrush HumanBrush;
	FSlateRoundedBoxBrush ButtonNormal;
	FSlateRoundedBoxBrush ButtonHovered;
	FButtonStyle ButtonStyle;
	TArray<FSlateRoundedBoxBrush> PipLit;
	TArray<FSlateRoundedBoxBrush> PipReached;
	FSlateRoundedBoxBrush PipUnreached;
};

class WONDERLAND_API SWonderlandMenuPanel : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnRequestNavigate, EWonderlandNavTarget);

	SLATE_BEGIN_ARGS(SWonderlandMenuPanel) {}
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FSimpleDelegate, OnRequestMap)
		SLATE_EVENT(FOnRequestNavigate, OnRequestNavigate)
	SLATE_END_ARGS()

	SWonderlandMenuPanel();
	void Construct(const FArguments& InArgs);

	/** The row titles as built, "|"-joined. */
	FString DescribeRows() const { return FString::Join(RowTitles, TEXT("|")); }

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

private:
	FSimpleDelegate OnRequestClose;
	FSimpleDelegate OnRequestMap;
	FOnRequestNavigate OnRequestNavigate;
	TArray<FString> RowTitles;

	FSlateBrush ScrimBrush;
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FSlateRoundedBoxBrush RowNormal;
	FSlateRoundedBoxBrush RowHovered;
	FSlateRoundedBoxBrush RowPressed;
	FButtonStyle RowStyle;
};

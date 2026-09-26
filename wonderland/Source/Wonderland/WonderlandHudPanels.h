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
		SLATE_EVENT(FSimpleDelegate, OnRequestWallet)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FSimpleDelegate, OnRequestMap)
		SLATE_EVENT(FOnRequestNavigate, OnRequestNavigate)
	SLATE_END_ARGS()

	SWonderlandMenuPanel();
	void Construct(const FArguments& InArgs);

	/** The row titles as built, "|"-joined. */
	FString DescribeRows() const { return FString::Join(RowTitles, TEXT("|")); }

	/** The tab titles as built, "|"-joined, so a proof can read the tab bar rather than a screenshot of it. */
	FString DescribeTabs() const { return FString::Join(TabTitles, TEXT("|")); }

	/** Which tab is showing: "MENU" or "COLORS". */
	FString GetOpenTab() const { return bColorsOpen ? TEXT("COLORS") : TEXT("MENU"); }

	/** Press a tab by name, exactly as clicking it does. False for a name this panel does not have. */
	bool ShowTab(const FString& Title);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

private:
	FSimpleDelegate OnRequestClose;
	FSimpleDelegate OnRequestMap;
	FSimpleDelegate OnRequestWallet;
	FOnRequestNavigate OnRequestNavigate;
	TArray<FString> RowTitles;
	TArray<FString> TabTitles;
	/**
	 * FOUNDER, 2026-09-25: "The new tab in the Menu for the overall color section of wonderland should be
	 * titled COLORS." One extra page rather than a second panel, because everything the founder listed --
	 * mascot, AI Companions, the two terminals, the Menu's own theme -- is the same kind of choice and belongs
	 * in one place the player can find.
	 */
	bool bColorsOpen = false;

	/** Built once and swapped by the tab bar, so switching pages costs nothing and loses no scroll position. */
	TSharedPtr<class SWidgetSwitcher> Pages;

	TSharedRef<SWidget> MakeColoursPage();
	TSharedRef<SWidget> MakeColourRow(const TCHAR* Label, const TCHAR* Note,
		TFunction<FLinearColor()> Read, TFunction<void(FLinearColor)> Write);
	TSharedRef<SWidget> MakeTabBar();
	/** The pointer's shape and size, in the Colors tab. See P1 item 8. */
	TSharedRef<SWidget> MakeCursorRow();

	FSlateBrush ScrimBrush;
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FSlateRoundedBoxBrush RowNormal;
	FSlateRoundedBoxBrush RowHovered;
	FSlateRoundedBoxBrush RowPressed;
	FButtonStyle RowStyle;
	FSlateRoundedBoxBrush SwatchBrush;
	FSlateRoundedBoxBrush SwatchRingBrush;
	FSlateRoundedBoxBrush TabOnBrush;
	FSlateRoundedBoxBrush TabOffBrush;
	FButtonStyle SwatchStyle;
	FButtonStyle TabStyle;
};

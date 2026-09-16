// WONDERLAND — the bottom shortcuts: AGENT · MISSIONS · BRAIN · COMMANDS · MENU.
//
// FIVE DOORS, AND EACH OPENS SOMETHING THAT IS THERE. AGENT raises the three consoles the Compound Agent already
// has; BRAIN opens the Project Brain panel; MISSIONS shows the mission that is (or is not) running; COMMANDS opens
// the command preset station; MENU is the way to all of them and to the controls. None of them is a door painted
// on a wall. INVENTORY is not one of them: the founder replaced it with COMMANDS (2026-09-15), and the order below
// is the canonical order of the strip.
//
// FURNITURE WHILE YOU PLAY, OUT OF THE WAY WHILE A PANEL IS UP. The bar sits on the bottom edge during play and
// steps aside whenever any panel is open -- the Julius terminal owns the whole bottom band, and a strip of
// shortcuts drawn over a panel would be a second way to do everything and a collision with the first.
//
// TWO WAYS IN. Every shortcut has a key, shown on its tile, and holding Left Alt shows the cursor so the tiles can
// be clicked without giving up the camera for good.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandBrainIcon.h"

class SButton;
class STextBlock;

/** Where a shortcut leads. A plain enum: presentation vocabulary, never sent anywhere. */
enum class EWonderlandNavTarget : uint8
{
	Agent,
	Missions,
	Brain,
	Commands,
	Menu
};

struct FWonderlandNavEntry
{
	EWonderlandNavTarget Target = EWonderlandNavTarget::Menu;
	FName Id;
	const TCHAR* Label = TEXT("");
	const TCHAR* KeyHint = TEXT("");
	EWonderlandBrainGlyph Glyph = EWonderlandBrainGlyph::Menu;
};

/** The strip, in its canonical order. */
WONDERLAND_API const TArray<FWonderlandNavEntry>& WonderlandNavEntries();

/** The entry for an id ("agent", "missions", "brain", "commands", "menu"), or null. */
WONDERLAND_API const FWonderlandNavEntry* WonderlandFindNavEntry(FName Id);

class WONDERLAND_API SWonderlandNavBar : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnNavigate, EWonderlandNavTarget);

	SLATE_BEGIN_ARGS(SWonderlandNavBar) {}
		SLATE_EVENT(FOnNavigate, OnNavigate)
		/** True while the cursor is out: the tiles brighten to say they can be clicked. */
		SLATE_ATTRIBUTE(bool, Pointing)
	SLATE_END_ARGS()

	SWonderlandNavBar();
	void Construct(const FArguments& InArgs);

	/** The labels as the built tiles read them, "|"-joined: what a visitor would read off the screen. */
	FString DescribeLabels() const;

	/** A tile's rectangle in absolute (desktop) pixels from its last layout. False before the first paint. */
	bool GetTileAbsoluteRect(FName Id, FSlateRect& OutRect) const;

	/** How many times a tile has been clicked -- by a pointer, not by its key. */
	int32 GetClickCount(FName Id) const;

private:
	FReply HandleClicked(int32 Index);

	FOnNavigate OnNavigate;
	TAttribute<bool> Pointing;
	TArray<TSharedPtr<SButton>> Buttons;
	TArray<TSharedPtr<STextBlock>> Labels;
	TArray<int32> Clicks;

	FSlateRoundedBoxBrush PlateBrush;
	FSlateRoundedBoxBrush TileNormal;
	FSlateRoundedBoxBrush TileHovered;
	FSlateRoundedBoxBrush TilePressed;
	FButtonStyle TileStyle;
};

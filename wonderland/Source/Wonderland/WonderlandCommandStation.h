// WONDERLAND — the command preset station: where a visitor arranges the commands they keep within reach.
//
// A STATION, NOT A SETTINGS PAGE. Quick slots down the left, every command the catalog offers down the right, and
// the layouts across the top: pick a slot, equip a command to it, move it, clear it, start a new layout from this
// one, or put the defaults back. Everything saves as it happens.
//
// THE PANEL HOLDS NO RECORD. Every button calls the preset subsystem, the subsystem validates and saves and says it
// changed, and the panel redraws from it -- the Project Brain panel's rule. So what the station shows is what the
// terminal lists, always, because both read the same layout.
//
// IT SAYS WHAT IT IS. DEVELOPMENT PREVIEW, and commands do not run from Wonderland yet: arranging a command changes
// which commands are listed, and nothing here runs one. Not "not connected to Julius" -- the Gauntlet Loop is not a
// Julius feature at all (src/relay/mission/gauntlet), and a label that implied it was would be its own small lie.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandNavBar.h"

class SHorizontalBox;
class STextBlock;
class SVerticalBox;
class UWonderlandCommandPresetSubsystem;

class WONDERLAND_API SWonderlandCommandStation : public SCompoundWidget
{
public:
	DECLARE_DELEGATE_OneParam(FOnRequestNavigate, EWonderlandNavTarget);

	SLATE_BEGIN_ARGS(SWonderlandCommandStation) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandCommandPresetSubsystem>, Presets)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
		SLATE_EVENT(FOnRequestNavigate, OnRequestNavigate)
	SLATE_END_ARGS()

	SWonderlandCommandStation();
	virtual ~SWonderlandCommandStation() override;
	void Construct(const FArguments& InArgs);

	/** Redraw every list from the preset subsystem. */
	void Refresh();

	// The same paths the station's own buttons take.
	void SelectSlot(int32 Slot);
	int32 GetSelectedSlot() const { return SelectedSlot; }
	bool EquipToSelectedSlot(FName CommandId);
	void PressRestoreDefaults();
	int32 PressNewLayout();

	/** The quick slots as the built rows read them, "|"-joined: what a visitor would read off the screen. */
	FString DescribeSlotRows() const;

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

private:
	UWonderlandCommandPresetSubsystem* GetPresets() const;
	void RebuildLayouts();
	void RebuildSlots();
	void RebuildCommands();
	TSharedRef<SWidget> MakeSmallButton(const FText& Text, TFunction<void()> OnPressed, TAttribute<bool> Enabled);

	TWeakObjectPtr<UWonderlandCommandPresetSubsystem> Presets;
	FSimpleDelegate OnRequestClose;
	FOnRequestNavigate OnRequestNavigate;
	FDelegateHandle ChangedHandle;
	int32 SelectedSlot = 0;

	TSharedPtr<SHorizontalBox> LayoutRow;
	TSharedPtr<SVerticalBox> SlotList;
	TSharedPtr<SVerticalBox> CommandList;
	TArray<TSharedPtr<STextBlock>> SlotTexts;

	FSlateBrush ScrimBrush;
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush SectionBrush;
	FSlateRoundedBoxBrush SlotBrush;
	FSlateRoundedBoxBrush SlotSelectedBrush;
	FSlateRoundedBoxBrush CardBrush;
	FSlateRoundedBoxBrush ChipBrush;
	FSlateRoundedBoxBrush PreviewBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FSlateRoundedBoxBrush ButtonNormal;
	FSlateRoundedBoxBrush ButtonHovered;
	FSlateRoundedBoxBrush ButtonPressed;
	FSlateRoundedBoxBrush TabSelected;
	FButtonStyle ButtonStyle;
	FButtonStyle RowStyle;
	FButtonStyle TabStyle;
	FButtonStyle TabSelectedStyle;
};

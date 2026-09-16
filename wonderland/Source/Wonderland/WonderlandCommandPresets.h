// WONDERLAND — command presets: the commands a visitor keeps within reach.
//
// THE FOUR LOOPS WERE A LIST, AND NOW THEY ARE A PRESET. The Julius terminal drew Gauntlet Loop, Goal Loop,
// Eval Loop and Unchained from a static array, which made the founder's frame the permanent design. They are
// the DEFAULT layout now: the catalog below says which commands exist, a layout says which of them sit in the
// quick slots, and the terminal draws whatever the active layout holds.
//
// THREE PIECES, THE TRAVEL REGISTRY'S SHAPE.
//
//   UWonderlandCommandSettings        WHICH commands exist and whether the station may offer them.
//                                     Config-backed (DefaultGame.ini), so a newly built command is a data edit,
//                                     and the default layout is data too.
//   UWonderlandCommandPresetSubsystem THE VISITOR'S LAYOUTS: equip, clear, reorder, new layout, restore defaults.
//                                     Saved to a local save slot, and every change is validated against the
//                                     catalog, so a layout can never hold a command the station would not offer.
//   SWonderlandCommandStation         The screen (WonderlandCommandStation.h).
//
// A COMMAND THAT DOES NOT EXIST IS NOT OFFERED. Stack-Up Loop, Multi-Hop Loop and /join in are registered so
// that offering them later is one status edit, and they are WITHHELD until then -- the world map's rule for
// districts, applied to commands: an entry with a label and nothing behind it is exactly what a visitor should
// never be shown.
//
// NOTHING HERE EXECUTES. Equipping a command changes what the terminal lists. No command runs from Wonderland yet,
// and the station says so on every screen.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "GameFramework/SaveGame.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "WonderlandCommandPresets.generated.h"

/** Whether the station may offer a command. Ordinal 0 is the truthful default: nobody has said. */
UENUM(BlueprintType)
enum class EWonderlandCommandStatus : uint8
{
	/** Nobody has assessed it. Never offered. */
	Unassessed,
	/** Built enough to keep in a quick slot. Offered. */
	Offered,
	/** Registered, not built. Never offered. */
	Withheld
};

/** One command in the catalog. */
USTRUCT(BlueprintType)
struct FWonderlandCommandDefinition
{
	GENERATED_BODY()

	/** Stable id. Layouts hold this and nothing else, so renaming a command never breaks a saved layout. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	FName Id;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	FText Summary;

	/** A grouping word for the station: Loop, Autonomy, Collaboration. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	FString Family;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	EWonderlandCommandStatus Status = EWonderlandCommandStatus::Unassessed;

	/** Why the status is what it is. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	FString DevelopmentNote;
};

/** One named arrangement of the quick slots. An empty slot holds NAME_None. */
USTRUCT(BlueprintType)
struct FWonderlandCommandLayout
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	FString Name;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Wonderland|Commands")
	TArray<FName> Slots;
};

/** The catalog. Project Settings > Game > Wonderland Commands, stored in DefaultGame.ini. */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Commands"))
class WONDERLAND_API UWonderlandCommandSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UPROPERTY(Config, EditAnywhere, Category = "Catalog")
	TArray<FWonderlandCommandDefinition> Commands;

	/** The DEFAULT layout, slot by slot. Restoring defaults puts exactly these back. */
	UPROPERTY(Config, EditAnywhere, Category = "Layouts")
	TArray<FName> DefaultSlots;

	UPROPERTY(Config, EditAnywhere, Category = "Layouts", meta = (ClampMin = "1", ClampMax = "9"))
	int32 QuickSlotCount = 4;

	UPROPERTY(Config, EditAnywhere, Category = "Layouts", meta = (ClampMin = "1", ClampMax = "8"))
	int32 MaxLayouts = 4;

	virtual FName GetCategoryName() const override { return TEXT("Game"); }

	const FWonderlandCommandDefinition* FindCommand(FName Id) const;
	bool IsOffered(FName Id) const;
};

/** What is written to the save slot. Versioned so a later shape can read an earlier one. */
UCLASS()
class WONDERLAND_API UWonderlandCommandPresetSave : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY()
	int32 Version = 1;

	UPROPERTY()
	TArray<FWonderlandCommandLayout> Layouts;

	UPROPERTY()
	int32 ActiveLayout = 0;
};

DECLARE_MULTICAST_DELEGATE(FWonderlandCommandPresetsChanged);

/** The visitor's layouts. One per game instance; every change is validated, broadcast and saved. */
UCLASS()
class WONDERLAND_API UWonderlandCommandPresetSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	/** Commands the station may show, in catalog order. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	TArray<FWonderlandCommandDefinition> GetOfferedCommands() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	int32 GetSlotCount() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	FName GetSlotCommand(int32 Slot) const;

	/** The command's display name, or empty for an empty slot. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	FString GetSlotLabel(int32 Slot) const;

	/** Every slot of the active layout, "|"-joined, "-" for an empty one. For tests and logs. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	FString DescribeActiveLayout() const;

	/** The slot a command sits in on the active layout, or -1. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	int32 FindEquippedSlot(FName CommandId) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	int32 GetLayoutCount() const { return Layouts.Num(); }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	int32 GetActiveLayoutIndex() const { return ActiveLayout; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	FString GetLayoutName(int32 Index) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Commands")
	int32 GetMaxLayouts() const;

	/**
	 * Put a command in a slot. A command already equipped elsewhere SWAPS with whatever the slot held, so a
	 * layout never lists one command twice. False, and nothing changes, for an unknown or withheld command.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Commands")
	bool EquipCommand(int32 Slot, FName CommandId);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Commands")
	bool ClearSlot(int32 Slot);

	/** Move a slot's command up (-1) or down (+1), swapping with its neighbour. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Commands")
	bool MoveSlot(int32 Slot, int32 Delta);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Commands")
	bool SelectLayout(int32 Index);

	/** A new layout copied from the active one, made active. -1 at the layout limit. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Commands")
	int32 CreateLayout();

	/** Put the configured DEFAULT slots back into the active layout. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Commands")
	void RestoreDefaults();

	/** Forget every layout and the save slot: back to the single DEFAULT layout. For tests. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Commands")
	void ResetAllLayouts();

	FWonderlandCommandPresetsChanged OnPresetsChanged;

private:
	FWonderlandCommandLayout MakeDefaultLayout() const;
	/** Pad or trim to the slot count, and empty any slot whose command the catalog would not offer. */
	void Sanitise(FWonderlandCommandLayout& Layout) const;
	void Load();
	void Changed();

	TArray<FWonderlandCommandLayout> Layouts;
	int32 ActiveLayout = 0;
};

#include "WonderlandCommandPresets.h"

#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandCommands, Log, All);

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandCommandPresetDetail
{
	const TCHAR* const SaveSlot = TEXT("WonderlandCommandPresets");
	const int32 SaveUser = 0;
}

const FWonderlandCommandDefinition* UWonderlandCommandSettings::FindCommand(FName Id) const
{
	if (Id.IsNone())
	{
		return nullptr;
	}
	return Commands.FindByPredicate([Id](const FWonderlandCommandDefinition& Row) { return Row.Id == Id; });
}

bool UWonderlandCommandSettings::IsOffered(FName Id) const
{
	const FWonderlandCommandDefinition* Row = FindCommand(Id);
	return Row != nullptr && Row->Status == EWonderlandCommandStatus::Offered;
}

void UWonderlandCommandPresetSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Load();
}

TArray<FWonderlandCommandDefinition> UWonderlandCommandPresetSubsystem::GetOfferedCommands() const
{
	TArray<FWonderlandCommandDefinition> Offered;
	for (const FWonderlandCommandDefinition& Row : GetDefault<UWonderlandCommandSettings>()->Commands)
	{
		if (Row.Status == EWonderlandCommandStatus::Offered && !Row.Id.IsNone())
		{
			Offered.Add(Row);
		}
	}
	return Offered;
}

int32 UWonderlandCommandPresetSubsystem::GetSlotCount() const
{
	return FMath::Clamp(GetDefault<UWonderlandCommandSettings>()->QuickSlotCount, 1, 9);
}

int32 UWonderlandCommandPresetSubsystem::GetMaxLayouts() const
{
	return FMath::Clamp(GetDefault<UWonderlandCommandSettings>()->MaxLayouts, 1, 8);
}

FName UWonderlandCommandPresetSubsystem::GetSlotCommand(int32 Slot) const
{
	if (!Layouts.IsValidIndex(ActiveLayout) || !Layouts[ActiveLayout].Slots.IsValidIndex(Slot))
	{
		return NAME_None;
	}
	return Layouts[ActiveLayout].Slots[Slot];
}

FString UWonderlandCommandPresetSubsystem::GetSlotLabel(int32 Slot) const
{
	const FWonderlandCommandDefinition* Row = GetDefault<UWonderlandCommandSettings>()->FindCommand(GetSlotCommand(Slot));
	return Row != nullptr ? Row->DisplayName.ToString() : FString();
}

FString UWonderlandCommandPresetSubsystem::DescribeActiveLayout() const
{
	TArray<FString> Parts;
	for (int32 Slot = 0; Slot < GetSlotCount(); ++Slot)
	{
		const FName Id = GetSlotCommand(Slot);
		Parts.Add(Id.IsNone() ? TEXT("-") : Id.ToString());
	}
	return FString::Join(Parts, TEXT("|"));
}

int32 UWonderlandCommandPresetSubsystem::FindEquippedSlot(FName CommandId) const
{
	if (CommandId.IsNone() || !Layouts.IsValidIndex(ActiveLayout))
	{
		return INDEX_NONE;
	}
	return Layouts[ActiveLayout].Slots.IndexOfByKey(CommandId);
}

FString UWonderlandCommandPresetSubsystem::GetLayoutName(int32 Index) const
{
	return Layouts.IsValidIndex(Index) ? Layouts[Index].Name : FString();
}

bool UWonderlandCommandPresetSubsystem::EquipCommand(int32 Slot, FName CommandId)
{
	if (!Layouts.IsValidIndex(ActiveLayout) || Slot < 0 || Slot >= GetSlotCount()
		|| !GetDefault<UWonderlandCommandSettings>()->IsOffered(CommandId))
	{
		return false;
	}
	TArray<FName>& Slots = Layouts[ActiveLayout].Slots;
	const int32 Already = Slots.IndexOfByKey(CommandId);
	if (Already == Slot)
	{
		return true;
	}
	// A SWAP, NOT A DUPLICATE. The command leaves its old slot and takes the new one, and whatever the new slot
	// held moves into the gap -- so a visitor rearranging by equipping never loses a command they had placed.
	if (Already != INDEX_NONE)
	{
		Slots[Already] = Slots[Slot];
	}
	Slots[Slot] = CommandId;
	Changed();
	return true;
}

bool UWonderlandCommandPresetSubsystem::ClearSlot(int32 Slot)
{
	if (!Layouts.IsValidIndex(ActiveLayout) || !Layouts[ActiveLayout].Slots.IsValidIndex(Slot)
		|| Layouts[ActiveLayout].Slots[Slot].IsNone())
	{
		return false;
	}
	Layouts[ActiveLayout].Slots[Slot] = NAME_None;
	Changed();
	return true;
}

bool UWonderlandCommandPresetSubsystem::MoveSlot(int32 Slot, int32 Delta)
{
	if (!Layouts.IsValidIndex(ActiveLayout) || (Delta != -1 && Delta != 1))
	{
		return false;
	}
	TArray<FName>& Slots = Layouts[ActiveLayout].Slots;
	const int32 Target = Slot + Delta;
	if (!Slots.IsValidIndex(Slot) || !Slots.IsValidIndex(Target))
	{
		return false;
	}
	Slots.Swap(Slot, Target);
	Changed();
	return true;
}

bool UWonderlandCommandPresetSubsystem::SelectLayout(int32 Index)
{
	if (!Layouts.IsValidIndex(Index))
	{
		return false;
	}
	if (Index != ActiveLayout)
	{
		ActiveLayout = Index;
		Changed();
	}
	return true;
}

int32 UWonderlandCommandPresetSubsystem::CreateLayout()
{
	if (Layouts.Num() >= GetMaxLayouts() || !Layouts.IsValidIndex(ActiveLayout))
	{
		return INDEX_NONE;
	}
	FWonderlandCommandLayout Copy = Layouts[ActiveLayout];
	// Numbered by position rather than by a counter, so deleting and recreating never produces "LAYOUT 7" of four.
	Copy.Name = FString::Printf(TEXT("LAYOUT %d"), Layouts.Num() + 1);
	ActiveLayout = Layouts.Add(MoveTemp(Copy));
	Changed();
	return ActiveLayout;
}

void UWonderlandCommandPresetSubsystem::RestoreDefaults()
{
	if (!Layouts.IsValidIndex(ActiveLayout))
	{
		Layouts = {MakeDefaultLayout()};
		ActiveLayout = 0;
	}
	else
	{
		const FString Name = Layouts[ActiveLayout].Name;
		Layouts[ActiveLayout] = MakeDefaultLayout();
		Layouts[ActiveLayout].Name = Name;
	}
	Changed();
}

void UWonderlandCommandPresetSubsystem::ResetAllLayouts()
{
	UGameplayStatics::DeleteGameInSlot(WonderlandCommandPresetDetail::SaveSlot, WonderlandCommandPresetDetail::SaveUser);
	Layouts = {MakeDefaultLayout()};
	ActiveLayout = 0;
	OnPresetsChanged.Broadcast();
	UE_LOG(LogWonderlandCommands, Log, TEXT("WLCOMMANDS reset to DEFAULT: %s"), *DescribeActiveLayout());
}

FWonderlandCommandLayout UWonderlandCommandPresetSubsystem::MakeDefaultLayout() const
{
	FWonderlandCommandLayout Layout;
	Layout.Name = TEXT("DEFAULT");
	Layout.Slots = GetDefault<UWonderlandCommandSettings>()->DefaultSlots;
	Sanitise(Layout);
	return Layout;
}

void UWonderlandCommandPresetSubsystem::Sanitise(FWonderlandCommandLayout& Layout) const
{
	const UWonderlandCommandSettings* Settings = GetDefault<UWonderlandCommandSettings>();
	Layout.Slots.SetNum(GetSlotCount());
	TSet<FName> Seen;
	for (FName& Id : Layout.Slots)
	{
		// A saved layout can outlive its catalog: a command withheld again, or renamed out of existence. The slot
		// empties rather than showing a command the station would refuse to offer, and a duplicate empties too.
		if (!Id.IsNone() && (!Settings->IsOffered(Id) || Seen.Contains(Id)))
		{
			Id = NAME_None;
		}
		if (!Id.IsNone())
		{
			Seen.Add(Id);
		}
	}
	if (Layout.Name.IsEmpty())
	{
		Layout.Name = TEXT("LAYOUT");
	}
}

void UWonderlandCommandPresetSubsystem::Load()
{
	Layouts.Reset();
	ActiveLayout = 0;
	if (UGameplayStatics::DoesSaveGameExist(WonderlandCommandPresetDetail::SaveSlot, WonderlandCommandPresetDetail::SaveUser))
	{
		if (const UWonderlandCommandPresetSave* Save = Cast<UWonderlandCommandPresetSave>(
			UGameplayStatics::LoadGameFromSlot(WonderlandCommandPresetDetail::SaveSlot, WonderlandCommandPresetDetail::SaveUser)))
		{
			Layouts = Save->Layouts;
			ActiveLayout = Save->ActiveLayout;
		}
	}
	for (FWonderlandCommandLayout& Layout : Layouts)
	{
		Sanitise(Layout);
	}
	if (Layouts.Num() == 0)
	{
		Layouts.Add(MakeDefaultLayout());
	}
	if (Layouts.Num() > GetMaxLayouts())
	{
		Layouts.SetNum(GetMaxLayouts());
	}
	ActiveLayout = FMath::Clamp(ActiveLayout, 0, Layouts.Num() - 1);
	UE_LOG(LogWonderlandCommands, Log, TEXT("WLCOMMANDS loaded %d layout(s), active '%s': %s"),
		Layouts.Num(), *GetLayoutName(ActiveLayout), *DescribeActiveLayout());
}

void UWonderlandCommandPresetSubsystem::Changed()
{
	UWonderlandCommandPresetSave* Save = Cast<UWonderlandCommandPresetSave>(
		UGameplayStatics::CreateSaveGameObject(UWonderlandCommandPresetSave::StaticClass()));
	if (Save != nullptr)
	{
		Save->Layouts = Layouts;
		Save->ActiveLayout = ActiveLayout;
		if (!UGameplayStatics::SaveGameToSlot(Save, WonderlandCommandPresetDetail::SaveSlot, WonderlandCommandPresetDetail::SaveUser))
		{
			UE_LOG(LogWonderlandCommands, Warning, TEXT("WLCOMMANDS layout not saved; it holds for this session only"));
		}
	}
	OnPresetsChanged.Broadcast();
	UE_LOG(LogWonderlandCommands, Log, TEXT("WLCOMMANDS '%s': %s"), *GetLayoutName(ActiveLayout), *DescribeActiveLayout());
}

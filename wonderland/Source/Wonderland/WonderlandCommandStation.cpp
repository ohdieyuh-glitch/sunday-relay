#include "WonderlandCommandStation.h"

#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandBrainIcon.h"
#include "WonderlandCommandPresets.h"
#include "WonderlandLiveTerminal.h"
#include "WonderlandUiStyle.h"

SWonderlandCommandStation::SWonderlandCommandStation()
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::Gold(0.34f), 1.0f)
	, SectionBrush(WonderlandUi::Srgb(14, 16, 26, 0.72f), 10.0f, WonderlandUi::Ivory(0.10f), 1.0f)
	, SlotBrush(WonderlandUi::Srgb(20, 22, 32, 0.80f), 8.0f, WonderlandUi::Ivory(0.16f), 1.0f)
	, SlotSelectedBrush(WonderlandUi::Srgb(34, 28, 14, 0.90f), 8.0f, WonderlandUi::Gold(0.95f), 1.4f)
	, CardBrush(WonderlandUi::Srgb(18, 20, 30, 0.78f), 9.0f, WonderlandUi::Ivory(0.12f), 1.0f)
	, ChipBrush(WonderlandUi::Srgb(40, 34, 20, 0.70f), 6.0f, WonderlandUi::Gold(0.40f), 1.0f)
	, PreviewBrush(WonderlandUi::Srgb(40, 20, 14, 0.80f), 6.0f, WonderlandUi::Coral(0.70f), 1.0f)
	, RuleBrush(WonderlandUi::Gold(0.22f), 0.0f, FLinearColor::Transparent, 0.0f)
	, ButtonNormal(WonderlandUi::Srgb(24, 26, 38, 0.90f), 7.0f, WonderlandUi::Ivory(0.24f), 1.0f)
	, ButtonHovered(WonderlandUi::Srgb(40, 34, 18, 0.95f), 7.0f, WonderlandUi::Gold(0.90f), 1.2f)
	, ButtonPressed(WonderlandUi::Srgb(54, 44, 20, 1.0f), 7.0f, WonderlandUi::Gold(1.0f), 1.4f)
	, TabSelected(WonderlandUi::Srgb(40, 34, 18, 0.95f), 7.0f, WonderlandUi::Gold(1.0f), 1.4f)
{
}

SWonderlandCommandStation::~SWonderlandCommandStation()
{
	if (UWonderlandCommandPresetSubsystem* Subsystem = Presets.Get())
	{
		Subsystem->OnPresetsChanged.Remove(ChangedHandle);
	}
}

UWonderlandCommandPresetSubsystem* SWonderlandCommandStation::GetPresets() const
{
	return Presets.Get();
}

void SWonderlandCommandStation::Construct(const FArguments& InArgs)
{
	Presets = InArgs._Presets;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestNavigate = InArgs._OnRequestNavigate;

	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::MapScrim());
	ButtonStyle = FButtonStyle().SetNormal(ButtonNormal).SetHovered(ButtonHovered).SetPressed(ButtonPressed)
		.SetDisabled(FSlateRoundedBoxBrush(WonderlandUi::Srgb(20, 20, 26, 0.50f), 7.0f, WonderlandUi::Ivory(0.08f), 1.0f))
		.SetNormalPadding(FMargin(12.0f, 5.0f)).SetPressedPadding(FMargin(12.0f, 6.0f, 12.0f, 4.0f));
	TabStyle = ButtonStyle;
	TabSelectedStyle = FButtonStyle(ButtonStyle).SetNormal(TabSelected).SetHovered(TabSelected);
	FSlateBrush Clear;
	Clear.DrawAs = ESlateBrushDrawType::NoDrawType;
	RowStyle = FButtonStyle().SetNormal(Clear).SetHovered(Clear).SetPressed(Clear)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));

	if (UWonderlandCommandPresetSubsystem* Subsystem = Presets.Get())
	{
		ChangedHandle = Subsystem->OnPresetsChanged.AddSP(this, &SWonderlandCommandStation::Refresh);
	}

	const auto SectionTitle = [](const TCHAR* Text)
	{
		return SNew(STextBlock).Text(FText::FromString(Text)).Font(WonderlandUi::Sans(10, true, 200)).ColorAndOpacity(WonderlandUi::Gold());
	};

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()
		[
			SNew(SBorder).BorderImage(&ScrimBrush)
		]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(40.0f)
		[
			SNew(SBox).WidthOverride(1060.0f).MaxDesiredHeight(640.0f)
			[
				SNew(SBorder)
				.BorderImage(&PanelBrush)
				.Padding(FMargin(28.0f, 22.0f))
				[
					SNew(SVerticalBox)
					// ---- header
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::Commands).Size(34.0f).Color(WonderlandUi::Gold()).Thickness(1.8f)
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().AutoHeight()
							[
								SNew(STextBlock).Text(FText::FromString(TEXT("COMMAND PRESETS"))).Font(WonderlandUi::Sans(20, true, 140)).ColorAndOpacity(WonderlandUi::Ivory())
							]
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
							[
								SNew(STextBlock).Text(FText::FromString(TEXT("Choose the commands you keep within reach, and the order you keep them in.")))
								.Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Dim())
							]
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(12.0f, 0.0f)
						[
							SNew(SBorder).BorderImage(&PreviewBrush).Padding(FMargin(10.0f, 4.0f))
							[
								SNew(STextBlock).Text(FText::FromString(TEXT("DEVELOPMENT PREVIEW · COMMANDS DO NOT RUN FROM WONDERLAND YET")))
								.Font(WonderlandUi::Sans(8, true, 120)).ColorAndOpacity(WonderlandUi::Coral())
							]
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							MakeSmallButton(FText::FromString(TEXT("CLOSE  ·  C")), [this]() { OnRequestClose.ExecuteIfBound(); }, true)
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 14.0f)
					[
						SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush)]
					]
					// ---- layouts
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 12.0f, 0.0f)
						[
							SectionTitle(TEXT("LAYOUT"))
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SAssignNew(LayoutRow, SHorizontalBox)
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							MakeSmallButton(FText::FromString(TEXT("RESTORE DEFAULTS")), [this]() { PressRestoreDefaults(); }, true)
						]
					]
					// ---- slots and commands
					+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 16.0f, 0.0f, 0.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(0.42f).Padding(0.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(16.0f, 14.0f))
							[
								SNew(SVerticalBox)
								+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 10.0f)[SectionTitle(TEXT("QUICK SLOTS"))]
								+ SVerticalBox::Slot().FillHeight(1.0f)[SAssignNew(SlotList, SVerticalBox)]
							]
						]
						+ SHorizontalBox::Slot().FillWidth(0.58f)
						[
							SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(16.0f, 14.0f))
							[
								SNew(SVerticalBox)
								+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 10.0f)[SectionTitle(TEXT("AVAILABLE COMMANDS"))]
								+ SVerticalBox::Slot().FillHeight(1.0f)
								[
									SNew(SScrollBox)
									+ SScrollBox::Slot()[SAssignNew(CommandList, SVerticalBox)]
								]
							]
						]
					]
					// ---- footer
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(FText::FromString(TEXT("Select a slot, then equip a command to it. Layouts save on this machine. More commands appear here as they are built.")))
						.Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Faint())
					]
				]
			]
		]
	];
	Refresh();
}

TSharedRef<SWidget> SWonderlandCommandStation::MakeSmallButton(const FText& Text, TFunction<void()> OnPressed, TAttribute<bool> Enabled)
{
	return SNew(SButton)
		.ButtonStyle(&ButtonStyle)
		.IsFocusable(false)
		.IsEnabled(Enabled)
		.OnClicked_Lambda([OnPressed]() { if (OnPressed) { OnPressed(); } return FReply::Handled(); })
		[
			SNew(STextBlock).Text(Text).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::Cream())
		];
}

void SWonderlandCommandStation::Refresh()
{
	const UWonderlandCommandPresetSubsystem* Subsystem = GetPresets();
	SelectedSlot = Subsystem != nullptr ? FMath::Clamp(SelectedSlot, 0, Subsystem->GetSlotCount() - 1) : 0;
	RebuildLayouts();
	RebuildSlots();
	RebuildCommands();
}

void SWonderlandCommandStation::RebuildLayouts()
{
	if (!LayoutRow.IsValid())
	{
		return;
	}
	LayoutRow->ClearChildren();
	UWonderlandCommandPresetSubsystem* Subsystem = GetPresets();
	if (Subsystem == nullptr)
	{
		return;
	}
	const TWeakObjectPtr<UWonderlandCommandPresetSubsystem> Weak(Subsystem);
	for (int32 Index = 0; Index < Subsystem->GetLayoutCount(); ++Index)
	{
		const bool bActive = Index == Subsystem->GetActiveLayoutIndex();
		LayoutRow->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			SNew(SButton)
			.ButtonStyle(bActive ? &TabSelectedStyle : &TabStyle)
			.IsFocusable(false)
			.OnClicked_Lambda([Weak, Index]() { if (Weak.IsValid()) { Weak->SelectLayout(Index); } return FReply::Handled(); })
			[
				SNew(STextBlock).Text(FText::FromString(Subsystem->GetLayoutName(Index)))
				.Font(WonderlandUi::Sans(9, true, 140)).ColorAndOpacity(bActive ? WonderlandUi::Gold() : WonderlandUi::Cream(0.80f))
			]
		];
	}
	LayoutRow->AddSlot().AutoWidth()
	[
		MakeSmallButton(FText::FromString(TEXT("+ NEW LAYOUT")), [this]() { PressNewLayout(); },
			TAttribute<bool>::CreateLambda([Weak]() { return Weak.IsValid() && Weak->GetLayoutCount() < Weak->GetMaxLayouts(); }))
	];
}

void SWonderlandCommandStation::RebuildSlots()
{
	if (!SlotList.IsValid())
	{
		return;
	}
	SlotList->ClearChildren();
	SlotTexts.Reset();
	UWonderlandCommandPresetSubsystem* Subsystem = GetPresets();
	if (Subsystem == nullptr)
	{
		return;
	}
	const TWeakObjectPtr<UWonderlandCommandPresetSubsystem> Weak(Subsystem);
	const int32 Count = Subsystem->GetSlotCount();
	for (int32 Slot = 0; Slot < Count; ++Slot)
	{
		const FString Label = Subsystem->GetSlotLabel(Slot);
		const bool bEmpty = Label.IsEmpty();
		const bool bSelected = Slot == SelectedSlot;
		TSharedPtr<STextBlock> Text;
		SlotList->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SWonderlandHexBadge).Label(FString::FromInt(Slot + 1)).Size(34.0f).Color(bSelected ? WonderlandUi::Gold() : WonderlandUi::Gold(0.55f))
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(10.0f, 0.0f, 8.0f, 0.0f)
			[
				SNew(SButton)
				.ButtonStyle(&RowStyle)
				.IsFocusable(false)
				.OnClicked_Lambda([this, Slot]() { SelectSlot(Slot); return FReply::Handled(); })
				[
					SNew(SBorder)
					.BorderImage(bSelected ? &SlotSelectedBrush : &SlotBrush)
					.Padding(FMargin(12.0f, 8.0f))
					[
						SAssignNew(Text, STextBlock)
						.Text(FText::FromString(bEmpty ? TEXT("Empty slot") : Label))
						.Font(WonderlandUi::Sans(12, !bEmpty))
						.ColorAndOpacity(bEmpty ? WonderlandUi::Faint() : WonderlandUi::Cream())
					]
				]
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 4.0f, 0.0f)
			[
				MakeSmallButton(FText::FromString(TEXT("UP")), [Weak, Slot, this]() { if (Weak.IsValid() && Weak->MoveSlot(Slot, -1)) { SelectSlot(Slot - 1); } },
					Slot > 0)
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 4.0f, 0.0f)
			[
				MakeSmallButton(FText::FromString(TEXT("DOWN")), [Weak, Slot, this]() { if (Weak.IsValid() && Weak->MoveSlot(Slot, 1)) { SelectSlot(Slot + 1); } },
					Slot + 1 < Count)
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				MakeSmallButton(FText::FromString(TEXT("CLEAR")), [Weak, Slot]() { if (Weak.IsValid()) { Weak->ClearSlot(Slot); } }, !bEmpty)
			]
		];
		SlotTexts.Add(Text);
	}
}

void SWonderlandCommandStation::RebuildCommands()
{
	if (!CommandList.IsValid())
	{
		return;
	}
	CommandList->ClearChildren();
	const UWonderlandCommandPresetSubsystem* Subsystem = GetPresets();
	if (Subsystem == nullptr)
	{
		return;
	}
	const TArray<FWonderlandCommandDefinition> Offered = Subsystem->GetOfferedCommands();
	if (Offered.Num() == 0)
	{
		CommandList->AddSlot().AutoHeight()
		[
			SNew(STextBlock).Text(FText::FromString(TEXT("No command is offered in this build yet.")))
			.Font(WonderlandUi::Sans(11)).ColorAndOpacity(WonderlandUi::Dim())
		];
		return;
	}
	for (const FWonderlandCommandDefinition& Command : Offered)
	{
		const int32 InSlot = Subsystem->FindEquippedSlot(Command.Id);
		const bool bHere = InSlot == SelectedSlot;
		const FName Id = Command.Id;
		const FString Status = InSlot == INDEX_NONE ? FString(TEXT("NOT EQUIPPED")) : FString::Printf(TEXT("IN SLOT %d"), InSlot + 1);
		CommandList->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 6.0f, 8.0f)
		[
			SNew(SBorder).BorderImage(&CardBrush).Padding(FMargin(14.0f, 10.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(Command.DisplayName).Font(WonderlandUi::Sans(13, true)).ColorAndOpacity(WonderlandUi::Ivory())
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f, 0.0f, 0.0f)
						[
							SNew(SBorder).BorderImage(&ChipBrush).Padding(FMargin(7.0f, 2.0f))
							[
								SNew(STextBlock).Text(FText::FromString(Command.Family.ToUpper())).Font(WonderlandUi::Sans(7, true, 140)).ColorAndOpacity(WonderlandUi::Gold())
							]
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(Command.Summary).Font(WonderlandUi::Sans(9)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(FText::FromString(Status)).Font(WonderlandUi::Sans(8, true, 140))
						.ColorAndOpacity(InSlot == INDEX_NONE ? WonderlandUi::Faint() : WonderlandUi::Sage())
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(12.0f, 0.0f, 0.0f, 0.0f)
				[
					MakeSmallButton(
						FText::FromString(bHere ? FString(TEXT("EQUIPPED")) : FString::Printf(TEXT("EQUIP TO SLOT %d"), SelectedSlot + 1)),
						[this, Id]() { EquipToSelectedSlot(Id); }, !bHere)
				]
			]
		];
	}
}

void SWonderlandCommandStation::SelectSlot(int32 Slot)
{
	const UWonderlandCommandPresetSubsystem* Subsystem = GetPresets();
	if (Subsystem == nullptr || Slot < 0 || Slot >= Subsystem->GetSlotCount())
	{
		return;
	}
	SelectedSlot = Slot;
	RebuildSlots();
	RebuildCommands();
}

bool SWonderlandCommandStation::EquipToSelectedSlot(FName CommandId)
{
	UWonderlandCommandPresetSubsystem* Subsystem = GetPresets();
	return Subsystem != nullptr && Subsystem->EquipCommand(SelectedSlot, CommandId);
}

void SWonderlandCommandStation::PressRestoreDefaults()
{
	if (UWonderlandCommandPresetSubsystem* Subsystem = GetPresets())
	{
		Subsystem->RestoreDefaults();
	}
}

int32 SWonderlandCommandStation::PressNewLayout()
{
	UWonderlandCommandPresetSubsystem* Subsystem = GetPresets();
	return Subsystem != nullptr ? Subsystem->CreateLayout() : INDEX_NONE;
}

FString SWonderlandCommandStation::DescribeSlotRows() const
{
	TArray<FString> Parts;
	for (const TSharedPtr<STextBlock>& Text : SlotTexts)
	{
		Parts.Add(Text.IsValid() ? Text->GetText().ToString() : FString());
	}
	return FString::Join(Parts, TEXT("|"));
}

FReply SWonderlandCommandStation::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::Escape || Key == EKeys::C)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::Up)
	{
		SelectSlot(SelectedSlot - 1);
		return FReply::Handled();
	}
	if (Key == EKeys::Down)
	{
		SelectSlot(SelectedSlot + 1);
		return FReply::Handled();
	}
	if (Key == EKeys::T && InKeyEvent.IsControlDown())
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Agent);
		return FReply::Handled();
	}
	if (Key == EKeys::J)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Missions);
		return FReply::Handled();
	}
	if (Key == EKeys::B)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Brain);
		return FReply::Handled();
	}
	if (Key == EKeys::Tab)
	{
		OnRequestNavigate.ExecuteIfBound(EWonderlandNavTarget::Menu);
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

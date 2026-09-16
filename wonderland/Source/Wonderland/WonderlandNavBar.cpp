#include "WonderlandNavBar.h"

#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"

const TArray<FWonderlandNavEntry>& WonderlandNavEntries()
{
	// THE CANONICAL STRIP. Order, labels and keys in one table: the bar builds from it, the subsystem binds its keys
	// from the same letters, and a test reads the built tiles back rather than this table.
	static const TArray<FWonderlandNavEntry> Entries = []()
	{
		TArray<FWonderlandNavEntry> Rows;
		const auto Add = [&Rows](EWonderlandNavTarget Target, const TCHAR* Id, const TCHAR* Label, const TCHAR* Key, EWonderlandBrainGlyph Glyph)
		{
			FWonderlandNavEntry Row;
			Row.Target = Target;
			Row.Id = FName(Id);
			Row.Label = Label;
			Row.KeyHint = Key;
			Row.Glyph = Glyph;
			Rows.Add(Row);
		};
		Add(EWonderlandNavTarget::Agent, TEXT("agent"), TEXT("AGENT"), TEXT("CTRL T"), EWonderlandBrainGlyph::Agent);
		Add(EWonderlandNavTarget::Missions, TEXT("missions"), TEXT("MISSIONS"), TEXT("J"), EWonderlandBrainGlyph::Missions);
		Add(EWonderlandNavTarget::Brain, TEXT("brain"), TEXT("BRAIN"), TEXT("B"), EWonderlandBrainGlyph::Brain);
		Add(EWonderlandNavTarget::Commands, TEXT("commands"), TEXT("COMMANDS"), TEXT("C"), EWonderlandBrainGlyph::Commands);
		Add(EWonderlandNavTarget::Menu, TEXT("menu"), TEXT("MENU"), TEXT("TAB"), EWonderlandBrainGlyph::Menu);
		return Rows;
	}();
	return Entries;
}

const FWonderlandNavEntry* WonderlandFindNavEntry(FName Id)
{
	return WonderlandNavEntries().FindByPredicate([Id](const FWonderlandNavEntry& Row) { return Row.Id == Id; });
}

SWonderlandNavBar::SWonderlandNavBar()
	: PlateBrush(WonderlandUi::Srgb(6, 8, 14, 0.40f), 16.0f, WonderlandUi::Gold(0.20f), 1.0f)
	, TileNormal(WonderlandUi::Srgb(9, 11, 19, 0.70f), 11.0f, WonderlandUi::Ivory(0.30f), 1.0f)
	, TileHovered(WonderlandUi::Srgb(20, 20, 28, 0.84f), 11.0f, WonderlandUi::Gold(0.90f), 1.3f)
	, TilePressed(WonderlandUi::Srgb(30, 24, 12, 0.90f), 11.0f, WonderlandUi::Gold(1.0f), 1.6f)
{
}

void SWonderlandNavBar::Construct(const FArguments& InArgs)
{
	OnNavigate = InArgs._OnNavigate;
	Pointing = InArgs._Pointing;
	TileStyle = FButtonStyle()
		.SetNormal(TileNormal)
		.SetHovered(TileHovered)
		.SetPressed(TilePressed)
		.SetNormalPadding(FMargin(0.0f))
		.SetPressedPadding(FMargin(0.0f, 1.0f, 0.0f, 0.0f));

	const TArray<FWonderlandNavEntry>& Entries = WonderlandNavEntries();
	Buttons.SetNum(Entries.Num());
	Labels.SetNum(Entries.Num());
	Clicks.Init(0, Entries.Num());

	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	for (int32 Index = 0; Index < Entries.Num(); ++Index)
	{
		const FWonderlandNavEntry& Entry = Entries[Index];
		Row->AddSlot()
		.AutoWidth()
		.Padding(Index == 0 ? 0.0f : 12.0f, 0.0f, 0.0f, 0.0f)
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
			[
				SNew(SBox).WidthOverride(62.0f).HeightOverride(62.0f)
				[
					SAssignNew(Buttons[Index], SButton)
					.ButtonStyle(&TileStyle)
					.ContentPadding(FMargin(0.0f))
					.HAlign(HAlign_Fill)
					.VAlign(VAlign_Fill)
					.IsFocusable(false)
					.OnClicked(this, &SWonderlandNavBar::HandleClicked, Index)
					[
						SNew(SOverlay)
						+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center)
						[
							// Gold under the pointer, ivory at rest: the icon answers the hover as the frame does.
							SNew(SBorder)
							.BorderImage(FCoreStyle::Get().GetBrush("NoBorder"))
							.Padding(0.0f)
							.ColorAndOpacity_Lambda([this, Index]()
							{
								const bool bHot = Buttons.IsValidIndex(Index) && Buttons[Index].IsValid() && Buttons[Index]->IsHovered();
								return bHot ? WonderlandUi::Gold() : WonderlandUi::Ivory(0.94f);
							})
							[
								SNew(SWonderlandBrainIcon).Glyph(Entry.Glyph).Size(30.0f).Color(FLinearColor::White).Thickness(1.7f)
							]
						]
						+ SOverlay::Slot().HAlign(HAlign_Right).VAlign(VAlign_Top).Padding(0.0f, 4.0f, 6.0f, 0.0f)
						[
							SNew(STextBlock)
							.Text(FText::FromString(Entry.KeyHint))
							.Font(WonderlandUi::Sans(6, true, 60))
							.ColorAndOpacity(WonderlandUi::Ivory(0.46f))
						]
					]
				]
			]
			+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 5.0f, 0.0f, 0.0f)
			[
				SAssignNew(Labels[Index], STextBlock)
				.Text(FText::FromString(Entry.Label))
				.Font(WonderlandUi::Sans(9, true, 150))
				.ColorAndOpacity(WonderlandUi::Ivory(0.95f))
				.ShadowOffset(FVector2D(0.0, 1.0))
				.ShadowColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, 0.80f))
			]
		];
	}

	ChildSlot
	[
		SNew(SBorder)
		.BorderImage(&PlateBrush)
		.Padding(FMargin(16.0f, 10.0f, 16.0f, 8.0f))
		// Slightly dimmer while the camera has the mouse: present, not asking for attention.
		.ColorAndOpacity_Lambda([this]() { return FLinearColor(1.0f, 1.0f, 1.0f, Pointing.Get(false) ? 1.0f : 0.84f); })
		[
			Row
		]
	];
}

FReply SWonderlandNavBar::HandleClicked(int32 Index)
{
	const TArray<FWonderlandNavEntry>& Entries = WonderlandNavEntries();
	if (!Entries.IsValidIndex(Index))
	{
		return FReply::Unhandled();
	}
	++Clicks[Index];
	OnNavigate.ExecuteIfBound(Entries[Index].Target);
	return FReply::Handled();
}

FString SWonderlandNavBar::DescribeLabels() const
{
	TArray<FString> Parts;
	for (const TSharedPtr<STextBlock>& Label : Labels)
	{
		Parts.Add(Label.IsValid() ? Label->GetText().ToString() : FString());
	}
	return FString::Join(Parts, TEXT("|"));
}

bool SWonderlandNavBar::GetTileAbsoluteRect(FName Id, FSlateRect& OutRect) const
{
	const TArray<FWonderlandNavEntry>& Entries = WonderlandNavEntries();
	for (int32 Index = 0; Index < Entries.Num(); ++Index)
	{
		if (Entries[Index].Id != Id || !Buttons.IsValidIndex(Index) || !Buttons[Index].IsValid())
		{
			continue;
		}
		const FGeometry& Geometry = Buttons[Index]->GetCachedGeometry();
		if (Geometry.GetLocalSize().IsNearlyZero())
		{
			return false;
		}
		OutRect = Geometry.GetLayoutBoundingRect();
		return true;
	}
	return false;
}

int32 SWonderlandNavBar::GetClickCount(FName Id) const
{
	const TArray<FWonderlandNavEntry>& Entries = WonderlandNavEntries();
	for (int32 Index = 0; Index < Entries.Num(); ++Index)
	{
		if (Entries[Index].Id == Id && Clicks.IsValidIndex(Index))
		{
			return Clicks[Index];
		}
	}
	return 0;
}

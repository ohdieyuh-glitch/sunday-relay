#include "WonderlandWallet.h"

#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandBrainIcon.h"
#include "WonderlandUiStyle.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandWallet, Log, All);

FString WonderlandFormatMoneyMinor(int64 AmountMinor, const FString& Currency)
{
	// Relay's formatMoney, for USD: "$" + whole + "." + two digits. Integer arithmetic only, as Relay does it.
	const int64 Safe = FMath::Max<int64>(AmountMinor, 0);
	const FString Digits = FString::Printf(TEXT("%lld.%02lld"), Safe / 100, Safe % 100);
	return Currency == TEXT("USD") ? FString::Printf(TEXT("$%s"), *Digits) : FString::Printf(TEXT("%s %s"), *Digits, *Currency);
}

// ---------------------------------------------------------------------------------------------------------------- source

void UWonderlandWalletSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Refresh();
}

void UWonderlandWalletSubsystem::Refresh()
{
	const UWonderlandWalletHudSettings* Settings = GetDefault<UWonderlandWalletHudSettings>();
	Snapshot = FWonderlandWalletSnapshot();
	Snapshot.SourceName = Settings->Source;
	if (Settings->Source == TEXT("SandboxPreview"))
	{
		// What Relay's openSandboxWallet creates, and nothing it does not: the opening balance, nothing reserved,
		// funded by SANDBOX, ACTIVE, and JULIUS_SPEND_DISABLED -- a new wallet holds money and permits nothing.
		Snapshot.bKnown = true;
		Snapshot.AvailableMinor = FMath::Max<int64>(Settings->SandboxOpeningBalanceMinor, 0);
		Snapshot.ReservedMinor = 0;
		Snapshot.Currency = Settings->SandboxCurrency;
		Snapshot.FundingSource = TEXT("SANDBOX");
		Snapshot.Status = TEXT("ACTIVE");
		Snapshot.bJuliusSpendEnabled = false;
		Snapshot.HonestyLabel = Settings->SandboxLabel;
	}
	else
	{
		// No read path to the Relay wallet exists yet. Showing a number here would be inventing one.
		Snapshot.bKnown = false;
		Snapshot.HonestyLabel = TEXT("WALLET NOT CONNECTED");
	}
	UE_LOG(LogWonderlandWallet, Log, TEXT("WLWALLET source %s: %s (%s)"), *Snapshot.SourceName,
		Snapshot.bKnown ? *WonderlandFormatMoneyMinor(Snapshot.AvailableMinor, Snapshot.Currency) : TEXT("no balance"), *Snapshot.HonestyLabel);
}

FString UWonderlandWalletSubsystem::GetAvailableText() const
{
	return Snapshot.bKnown ? WonderlandFormatMoneyMinor(Snapshot.AvailableMinor, Snapshot.Currency) : FString(TEXT("--"));
}

// ---------------------------------------------------------------------------------------------------------------- chip

SWonderlandWalletChip::SWonderlandWalletChip()
	: Normal(WonderlandUi::Srgb(8, 10, 18, 0.78f), 10.0f, WonderlandUi::Gold(0.42f), 1.0f)
	, Hovered(WonderlandUi::Srgb(22, 20, 14, 0.88f), 10.0f, WonderlandUi::Gold(0.95f), 1.3f)
	, Pressed(WonderlandUi::Srgb(34, 28, 12, 0.92f), 10.0f, WonderlandUi::Gold(1.0f), 1.6f)
{
}

void SWonderlandWalletChip::Construct(const FArguments& InArgs)
{
	Wallet = InArgs._Wallet;
	OnOpen = InArgs._OnOpen;
	Pointing = InArgs._Pointing;
	Style = FButtonStyle().SetNormal(Normal).SetHovered(Hovered).SetPressed(Pressed)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f, 1.0f, 0.0f, 0.0f));
	const TWeakObjectPtr<UWonderlandWalletSubsystem> Weak = Wallet;

	ChildSlot
	[
		SNew(SBox).WidthOverride(240.0f)
		[
			SAssignNew(Button, SButton)
			.ButtonStyle(&Style)
			.IsFocusable(false)
			.ContentPadding(FMargin(10.0f, 6.0f, 12.0f, 6.0f))
			.OnClicked_Lambda([this]() { ++OpenClicks; OnOpen.ExecuteIfBound(); return FReply::Handled(); })
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
				[
					SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::Wallet).Size(24.0f).Color(WonderlandUi::Gold()).Thickness(1.6f)
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(FText::FromString(TEXT("WONDER WEB WALLET")))
						.Font(WonderlandUi::Sans(7, true, 160)).ColorAndOpacity(WonderlandUi::Ivory(0.72f))
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom)
						[
							SAssignNew(BalanceText, STextBlock)
							.Text_Lambda([Weak]() { return FText::FromString(Weak.IsValid() ? Weak->GetAvailableText() : FString(TEXT("--"))); })
							.Font(WonderlandUi::Sans(15, true, 40)).ColorAndOpacity(WonderlandUi::Ivory())
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom).Padding(6.0f, 0.0f, 0.0f, 2.0f)
						[
							SAssignNew(UnitText, STextBlock)
							.Text_Lambda([Weak]() { return FText::FromString(Weak.IsValid() && Weak->IsWalletKnown() ? Weak->GetSnapshot().Currency : FString()); })
							.Font(WonderlandUi::Sans(8, true, 120)).ColorAndOpacity(WonderlandUi::Gold(0.90f))
						]
					]
					// THE CLAIM IS PART OF THE BALANCE, not a footnote under it: no sandbox figure is ever shown bare.
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 1.0f, 0.0f, 0.0f)
					[
						SAssignNew(ClaimText, STextBlock)
						.Text_Lambda([Weak]()
						{
							if (!Weak.IsValid())
							{
								return FText::GetEmpty();
							}
							// The compact form of Relay's label; the fuller surface shows it word for word.
							return FText::FromString(Weak->GetFundingSource() == TEXT("SANDBOX") ? FString(TEXT("SANDBOX · NOT REAL MONEY")) : Weak->GetHonestyLabel());
						})
						.Font(WonderlandUi::Sans(7, true, 110)).ColorAndOpacity(WonderlandUi::Coral(0.95f))
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
				[
					// The way in: brighter when the cursor is out, because that is when it can be pressed.
					SNew(STextBlock).Text(FText::FromString(TEXT("OPEN >")))
					.Font(WonderlandUi::Sans(7, true, 140))
					.ColorAndOpacity_Lambda([this]() { return FSlateColor(WonderlandUi::Gold(Pointing.Get(false) ? 1.0f : 0.55f)); })
				]
			]
		]
	];
}

FString SWonderlandWalletChip::GetDrawnBalance() const
{
	return BalanceText.IsValid() ? BalanceText->GetText().ToString() : FString();
}

FString SWonderlandWalletChip::GetDrawnUnit() const
{
	return UnitText.IsValid() ? UnitText->GetText().ToString() : FString();
}

FString SWonderlandWalletChip::GetDrawnClaim() const
{
	return ClaimText.IsValid() ? ClaimText->GetText().ToString() : FString();
}

// ---------------------------------------------------------------------------------------------------------------- panel

SWonderlandWalletPanel::SWonderlandWalletPanel()
	: PanelBrush(WonderlandUi::MapFill(), 14.0f, WonderlandUi::Gold(0.34f), 1.0f)
	, SectionBrush(WonderlandUi::Srgb(14, 16, 26, 0.72f), 10.0f, WonderlandUi::Ivory(0.10f), 1.0f)
	, ClaimBrush(WonderlandUi::Srgb(40, 20, 14, 0.85f), 7.0f, WonderlandUi::Coral(0.80f), 1.2f)
	, RuleBrush(WonderlandUi::Gold(0.22f), 0.0f, FLinearColor::Transparent, 0.0f)
	, ButtonNormal(WonderlandUi::Srgb(24, 26, 38, 0.90f), 7.0f, WonderlandUi::Ivory(0.24f), 1.0f)
	, ButtonHovered(WonderlandUi::Srgb(40, 34, 18, 0.95f), 7.0f, WonderlandUi::Gold(0.90f), 1.2f)
{
}

void SWonderlandWalletPanel::Construct(const FArguments& InArgs)
{
	Wallet = InArgs._Wallet;
	OnRequestClose = InArgs._OnRequestClose;
	ScrimBrush.DrawAs = ESlateBrushDrawType::Image;
	ScrimBrush.TintColor = FSlateColor(WonderlandUi::MapScrim());
	ButtonStyle = FButtonStyle().SetNormal(ButtonNormal).SetHovered(ButtonHovered).SetPressed(ButtonHovered)
		.SetNormalPadding(FMargin(12.0f, 5.0f)).SetPressedPadding(FMargin(12.0f, 6.0f, 12.0f, 4.0f));
	const TWeakObjectPtr<UWonderlandWalletSubsystem> Weak = Wallet;

	const auto Row = [](const TCHAR* Key, TAttribute<FText> Value)
	{
		return SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()
			[
				SNew(SBox).WidthOverride(170.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Key)).Font(WonderlandUi::Sans(9, true, 160)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
				]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Text(Value).Font(WonderlandUi::Mono(11)).ColorAndOpacity(WonderlandUi::Cream())
			];
	};
	const auto Snap = [Weak]() -> FWonderlandWalletSnapshot { return Weak.IsValid() ? Weak->GetSnapshot() : FWonderlandWalletSnapshot(); };

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()[SNew(SBorder).BorderImage(&ScrimBrush)]
		+ SOverlay::Slot().HAlign(HAlign_Center).VAlign(VAlign_Center).Padding(40.0f)
		[
			SNew(SBox).WidthOverride(680.0f)
			[
				SNew(SBorder).BorderImage(&PanelBrush).Padding(FMargin(28.0f, 22.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 14.0f, 0.0f)
						[
							SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::Wallet).Size(32.0f).Color(WonderlandUi::Gold()).Thickness(1.8f)
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(FText::FromString(TEXT("WONDER WEB WALLET"))).Font(WonderlandUi::Sans(20, true, 140)).ColorAndOpacity(WonderlandUi::Ivory())
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(SButton).ButtonStyle(&ButtonStyle).IsFocusable(false)
							.OnClicked_Lambda([this]() { OnRequestClose.ExecuteIfBound(); return FReply::Handled(); })
							[
								SNew(STextBlock).Text(FText::FromString(TEXT("CLOSE"))).Font(WonderlandUi::Sans(9, true, 120)).ColorAndOpacity(WonderlandUi::Cream())
							]
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f).HAlign(HAlign_Left)
					[
						// Relay's label, word for word, at the top of the surface rather than at the bottom of it.
						SNew(SBorder).BorderImage(&ClaimBrush).Padding(FMargin(12.0f, 6.0f))
						[
							SNew(STextBlock).Text_Lambda([Weak]() { return FText::FromString(Weak.IsValid() ? Weak->GetHonestyLabel() : FString()); })
							.Font(WonderlandUi::Sans(10, true, 120)).ColorAndOpacity(WonderlandUi::Coral())
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 16.0f)
					[
						SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush)]
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SBorder).BorderImage(&SectionBrush).Padding(FMargin(20.0f, 16.0f))
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
							[
								Row(TEXT("AVAILABLE"), TAttribute<FText>::CreateLambda([Weak]() { return FText::FromString(Weak.IsValid() ? Weak->GetAvailableText() : FString()); }))
							]
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
							[
								Row(TEXT("RESERVED"), TAttribute<FText>::CreateLambda([Snap]() { const FWonderlandWalletSnapshot S = Snap();
									return FText::FromString(S.bKnown ? WonderlandFormatMoneyMinor(S.ReservedMinor, S.Currency) : FString(TEXT("--"))); }))
							]
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
							[
								Row(TEXT("FUNDING SOURCE"), TAttribute<FText>::CreateLambda([Snap]() { const FWonderlandWalletSnapshot S = Snap();
									return FText::FromString(S.bKnown ? S.FundingSource : FString(TEXT("--"))); }))
							]
							+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
							[
								Row(TEXT("STATUS"), TAttribute<FText>::CreateLambda([Snap]() { const FWonderlandWalletSnapshot S = Snap();
									return FText::FromString(S.bKnown ? S.Status : FString(TEXT("--"))); }))
							]
							+ SVerticalBox::Slot().AutoHeight()
							[
								Row(TEXT("JULIUS SPENDING"), TAttribute<FText>::CreateLambda([Snap]() { const FWonderlandWalletSnapshot S = Snap();
									return FText::FromString(!S.bKnown ? FString(TEXT("--")) : (S.bJuliusSpendEnabled ? FString(TEXT("ON")) : FString(TEXT("OFF -- a new wallet holds funds and permits nothing")))); }))
							]
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock)
						.Text(FText::FromString(TEXT("Funding, purchases, payment providers, banks and custody are not connected in this build. Nothing here moves money.")))
						.Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
					]
				]
			]
		]
	];
}

FReply SWonderlandWalletPanel::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	if (InKeyEvent.GetKey() == EKeys::Escape)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

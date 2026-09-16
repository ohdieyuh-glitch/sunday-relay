// WONDERLAND — the Wonder Web Wallet on the HUD: a compact status in the top right, and a fuller surface behind it.
//
// THE WALLET IS NOT DECIDED HERE. Its rules live in Relay (src/relay/mission/wallet on relay/wonderland-core-systems,
// wallet v1 at 9b49dc60): money is an INTEGER of minor units, the ledger is the authority on balance, and the only
// funding source this build has is SANDBOX -- real-money custody and payment are deliberately not implemented. This
// file only SHOWS a snapshot of a wallet, and never computes one.
//
// ONE SOURCE TODAY, AND IT SAYS WHAT IT IS. Unreal has no read path to the Relay wallet yet: no bridge route serves it,
// and Wonder Web's own architecture document says there is no Unreal surface. So the snapshot comes from a SANDBOX
// PREVIEW that mirrors exactly what Relay's openSandboxWallet creates -- the deterministic opening balance, USD,
// funding SANDBOX, status ACTIVE, Julius spending disabled -- and it carries Relay's own label, word for word:
// "DEVELOPMENT / SANDBOX FUNDS — NOT REAL MONEY". When a read path exists, the RelayWallet source replaces the preview
// behind this same snapshot; until then choosing it shows "not connected" rather than a number.
//
// NOTHING HERE MOVES MONEY. No funding, no purchase, no provider, no bank, no custody. The fuller surface lists the
// wallet's state and says in so many words what is not connected.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Engine/DeveloperSettings.h"
#include "Styling/SlateTypes.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandWallet.generated.h"

class SButton;
class STextBlock;

/**
 * A wallet as the HUD shows it. Plain data, never reflected: it is a display copy, and a TypeScript mirror of it would
 * be a second definition of a Relay contract that already has one.
 */
struct FWonderlandWalletSnapshot
{
	/** False when the configured source has nothing to show. The HUD then says so instead of showing a number. */
	bool bKnown = false;
	int64 AvailableMinor = 0;
	int64 ReservedMinor = 0;
	FString Currency = TEXT("USD");
	/** SANDBOX or PROVIDER, as Relay names the funding source. */
	FString FundingSource;
	/** ACTIVE, FROZEN or CLOSED. */
	FString Status;
	bool bJuliusSpendEnabled = false;
	/** Rendered wherever the balance is. Not decoration -- a claim. */
	FString HonestyLabel;
	/** Where the snapshot came from, for the fuller surface and for tests. */
	FString SourceName;

	/** Real money only when a real provider funds a wallet read from Relay. Never true in this build. */
	bool IsRealMoney() const { return bKnown && FundingSource == TEXT("PROVIDER") && SourceName == TEXT("RelayWallet"); }
};

/** Relay's formatMoney: whole units and exactly two minor digits. Display only -- never parsed back. */
WONDERLAND_API FString WonderlandFormatMoneyMinor(int64 AmountMinor, const FString& Currency);

/** Project Settings > Game > Wonderland Wallet HUD, stored in DefaultGame.ini. */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Wallet HUD"))
class WONDERLAND_API UWonderlandWalletHudSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UPROPERTY(Config, EditAnywhere, Category = "Wallet")
	bool bShowWallet = true;

	/** "SandboxPreview" (the only source that can show a balance in this build) or "RelayWallet" (not connected yet). */
	UPROPERTY(Config, EditAnywhere, Category = "Wallet")
	FString Source = TEXT("SandboxPreview");

	/** Relay's SANDBOX_OPENING_BALANCE_MINOR. Minor units, an integer, as Relay keeps every amount. */
	UPROPERTY(Config, EditAnywhere, Category = "Sandbox preview", meta = (ClampMin = "0"))
	int64 SandboxOpeningBalanceMinor = 50000;

	UPROPERTY(Config, EditAnywhere, Category = "Sandbox preview")
	FString SandboxCurrency = TEXT("USD");

	/** Relay's SANDBOX_FUNDS_LABEL, word for word. */
	UPROPERTY(Config, EditAnywhere, Category = "Sandbox preview")
	FString SandboxLabel = TEXT("DEVELOPMENT / SANDBOX FUNDS — NOT REAL MONEY");

	virtual FName GetCategoryName() const override { return TEXT("Game"); }
};

/** The one seam the HUD reads a wallet through. A Relay read path plugs in here, behind the same snapshot. */
UCLASS()
class WONDERLAND_API UWonderlandWalletSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	/** Re-read the configured source. */
	void Refresh();

	const FWonderlandWalletSnapshot& GetSnapshot() const { return Snapshot; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Wallet")
	bool IsWalletKnown() const { return Snapshot.bKnown; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Wallet")
	FString GetAvailableText() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Wallet")
	int64 GetAvailableMinor() const { return Snapshot.AvailableMinor; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Wallet")
	FString GetFundingSource() const { return Snapshot.FundingSource; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Wallet")
	FString GetHonestyLabel() const { return Snapshot.HonestyLabel; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Wallet")
	FString GetSourceName() const { return Snapshot.SourceName; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Wallet")
	bool IsRealMoney() const { return Snapshot.IsRealMoney(); }

private:
	FWonderlandWalletSnapshot Snapshot;
};

/** The compact HUD status: identity, balance, unit, the sandbox claim, and a way in. */
class WONDERLAND_API SWonderlandWalletChip : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWalletChip) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandWalletSubsystem>, Wallet)
		SLATE_EVENT(FSimpleDelegate, OnOpen)
		SLATE_ATTRIBUTE(bool, Pointing)
	SLATE_END_ARGS()

	SWonderlandWalletChip();
	void Construct(const FArguments& InArgs);

	TSharedPtr<SButton> GetButton() const { return Button; }
	int32 GetOpenClicks() const { return OpenClicks; }
	/** The balance, unit and claim exactly as the built text blocks read. */
	FString GetDrawnBalance() const;
	FString GetDrawnUnit() const;
	FString GetDrawnClaim() const;

private:
	TWeakObjectPtr<UWonderlandWalletSubsystem> Wallet;
	FSimpleDelegate OnOpen;
	TAttribute<bool> Pointing;
	TSharedPtr<SButton> Button;
	TSharedPtr<STextBlock> BalanceText;
	TSharedPtr<STextBlock> UnitText;
	TSharedPtr<STextBlock> ClaimText;
	int32 OpenClicks = 0;

	FSlateRoundedBoxBrush Normal;
	FSlateRoundedBoxBrush Hovered;
	FSlateRoundedBoxBrush Pressed;
	FButtonStyle Style;
};

/** The fuller wallet surface: the snapshot's state, and plainly what is not connected. */
class WONDERLAND_API SWonderlandWalletPanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandWalletPanel) {}
		SLATE_ARGUMENT(TWeakObjectPtr<UWonderlandWalletSubsystem>, Wallet)
		SLATE_EVENT(FSimpleDelegate, OnRequestClose)
	SLATE_END_ARGS()

	SWonderlandWalletPanel();
	void Construct(const FArguments& InArgs);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

private:
	TWeakObjectPtr<UWonderlandWalletSubsystem> Wallet;
	FSimpleDelegate OnRequestClose;
	FSlateBrush ScrimBrush;
	FSlateRoundedBoxBrush PanelBrush;
	FSlateRoundedBoxBrush SectionBrush;
	FSlateRoundedBoxBrush ClaimBrush;
	FSlateRoundedBoxBrush RuleBrush;
	FSlateRoundedBoxBrush ButtonNormal;
	FSlateRoundedBoxBrush ButtonHovered;
	FButtonStyle ButtonStyle;
};

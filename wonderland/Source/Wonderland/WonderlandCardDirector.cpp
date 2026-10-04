// Copyright Wonderland. C.A.R.D. SELECT. See WonderlandCardDirector.h.
#include "WonderlandCardDirector.h"

#include "Containers/Ticker.h"
#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "WonderlandCard.h"
#include "WonderlandCardCapabilities.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandRelaySkins.h"
#include "WonderlandSidekicks.h"

namespace
{
	// THE ENVELOPE: at most one card's companions wait (a newer SELECT replaces an older one), with the world to apply them in
	FString GCardWaitingId;
	/** Shown to a person: the card's name, never its id. */
	FString GCardWaitingName;
	FString GCardWaitingWhy;
	TWeakObjectPtr<UWorld> GCardWaitingWorld;
	FTSTicker::FDelegateHandle GCardWaitingTicker;
	int32 GCardConnectsSent = 0;

	UWonderlandSidekickSubsystem* CardSidekicks(const UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
	}

	UWonderlandRelaySkinSubsystem* CardSkins(const UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
	}

	const UWonderlandMissionSubsystem* CardMission(const UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionSubsystem>() : nullptr;
	}

	/** The card a person named: by id, else by name ignoring case. */
	/**
	 * THE PLAYER'S CHANGE, ON DISK (Second's review, 10-03, by real input: a card the player made, dressed, saved and switched
	 * never reached Cards.sav -- the director changed the store in memory only, and M0's P1 passed because that QA called Save()
	 * itself). Every successful change ends here: the whole store written, sealed and atomically (FWonderlandCardStore::Save logs
	 * "WLCARD saved"). Empty when written; otherwise the sentence saying it was NOT -- a change is never reported as saved alone.
	 */
	FString CardWriteToDisk(const FWonderlandCardStore& Store)
	{
		if (Store.Save())
		{
			return FString();
		}
		return Store.IsReadOnly()
			? FString(TEXT("NOT saved to disk: the C.A.R.D. file was refused when the game started, so it is kept read-only this session"))
			: FString(TEXT("NOT saved to disk: the write failed, so this change lasts only until the game closes"));
	}

	/** Writes the store and, when that fails, says so at the end of what the caller says. */
	void CardSayWrite(const FWonderlandCardStore& Store, FString& InOutSaid)
	{
		const FString Disk = CardWriteToDisk(Store);
		if (!Disk.IsEmpty())
		{
			InOutSaid += FString::Printf(TEXT(" -- %s"), *Disk);
			UE_LOG(LogTemp, Warning, TEXT("WLCARD %s"), *InOutSaid);
		}
	}

	const FWonderlandCard* FindNamedCard(const FWonderlandCardStore& Store, const FString& IdOrName)
	{
		const FString Wanted = IdOrName.TrimStartAndEnd();
		if (const FWonderlandCard* ById = Store.Find(Wanted))
		{
			return ById;
		}
		for (const FWonderlandCard& Card : Store.GetCards())
		{
			if (Card.Name.Equals(Wanted, ESearchCase::IgnoreCase))
			{
				return &Card;
			}
		}
		return nullptr;
	}

	/** DEFAULT (the skin's own design) for a card that never chose a primary; else that key's swatch in this build's palette. */
	bool CardPrimarySwatch(const FWonderlandCardPrimary& Primary, FName& OutKey, FLinearColor& OutColour)
	{
		const FString Key = Primary.bChosen ? Primary.Key : FString(TEXT("DEFAULT"));
		for (const TPair<FName, FLinearColor>& Swatch : WonderlandMascotStyle::PrimaryPalette())
		{
			if (Swatch.Key.ToString().Equals(Key, ESearchCase::IgnoreCase))
			{
				OutKey = Swatch.Key;
				OutColour = Swatch.Value;
				return true;
			}
		}
		return false;
	}

	/*
	 * COLOR 2, COLOR 3 AND THE FIRE ON A C.A.R.D. (founder, 10-04 ~01:45Z: "COLOR 1 = body/base, COLOR 2 = secondary/accent/marbling,
	 * COLOR 3 = strips/ribbons/tendrils ... through the REAL Project Brain/C.A.R.D. path"). The live channel is read from, and written
	 * through, the SAME authorities the Wardrobe and the Menu rows use (the mascot settings' Secondary, StripColour.txt, FlameColour.txt)
	 * -- a card never paints a material itself, so nothing here can reach the eyes, swords, clothes or body by another road.
	 */
	FWonderlandCardColour CardLiveSecondary()
	{
		FWonderlandCardColour Out;
		Out.bRecorded = true;
		const UWonderlandMascotStyleSettings* Style = GetDefault<UWonderlandMascotStyleSettings>();
		Out.bChosen = Style != nullptr && Style->HasChosenSecondary();
		Out.Colour = Out.bChosen ? FLinearColor(Style->Secondary.R, Style->Secondary.G, Style->Secondary.B, 1.0f) : FLinearColor::Black;
		return Out;
	}

	FWonderlandCardColour CardLiveStrips()
	{
		FWonderlandCardColour Out;
		Out.bRecorded = true;
		Out.bChosen = WonderlandMascotStyle::HasChosenStrip();
		const FLinearColor Strip = WonderlandMascotStyle::StripColour();
		Out.Colour = Out.bChosen ? FLinearColor(Strip.R, Strip.G, Strip.B, 1.0f) : FLinearColor::Black;
		return Out;
	}

	FWonderlandCardColour CardLiveFlame()
	{
		FWonderlandCardColour Out;
		Out.bRecorded = true;
		Out.bChosen = WonderlandMascotStyle::HasChosenFlame();
		const FLinearColor Fire = WonderlandMascotStyle::FlameColour();
		Out.Colour = Out.bChosen ? FLinearColor(Fire.R, Fire.G, Fire.B, 1.0f) : FLinearColor::Black;
		return Out;
	}

	/** The same choice: both DEFAULT, or both chosen with the same colour (to the file's 4 decimals). */
	bool CardSameColour(const FWonderlandCardColour& A, const FWonderlandCardColour& B)
	{
		return A.bChosen == B.bChosen && (!A.bChosen || A.Colour.Equals(B.Colour, 0.0005f));
	}

	/** A channel as a person reads it: DEFAULT, a palette name when the colour is one (the PRIMARY/STRIPS rows' palette, then the
	 *  SECONDARY row's shared one), else r,g,b. */
	FString CardColourWord(const FWonderlandCardColour& Channel)
	{
		if (!Channel.bChosen)
		{
			return TEXT("DEFAULT");
		}
		for (const TArray<TPair<FName, FLinearColor>>* Swatches : { &WonderlandMascotStyle::PrimaryPalette(), &WonderlandMascotStyle::Palette() })
		{
			for (const TPair<FName, FLinearColor>& Swatch : *Swatches)
			{
				if (!Swatch.Key.ToString().Equals(TEXT("DEFAULT"), ESearchCase::IgnoreCase) && Swatch.Value.Equals(Channel.Colour, 0.0005f))
				{
					return Swatch.Key.ToString();
				}
			}
		}
		return FString::Printf(TEXT("%.2f,%.2f,%.2f"), Channel.Colour.R, Channel.Colour.G, Channel.Colour.B);
	}

	/** Puts a recorded channel on the Dog through its own authority; says what it did. An unrecorded channel is left alone. */
	FString CardApplyColour(const TCHAR* What, const FWonderlandCardColour& Want, const FWonderlandCardColour& Live, TFunctionRef<void()> Apply)
	{
		if (!Want.bRecorded)
		{
			return FString::Printf(TEXT("%s not recorded on this card (kept %s)"), What, *CardColourWord(Live));
		}
		if (CardSameColour(Want, Live))
		{
			return FString::Printf(TEXT("%s %s (already)"), What, *CardColourWord(Want));
		}
		Apply();
		return FString::Printf(TEXT("%s %s"), What, *CardColourWord(Want));
	}

	void CardPutSecondary(const FWonderlandCardColour& Want)
	{
		if (UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>())
		{
			// THE SECONDARY ROW'S OWN WRITE (the Project Brain wardrobe), and back to the designed value for DEFAULT
			Style->Secondary = Want.bChosen ? Want.Colour : UWonderlandMascotStyleSettings::DefaultSecondary();
			Style->bSecondaryChosen = Want.bChosen;
			Style->bChosen |= Want.bChosen;
			WonderlandMascotStyle::SaveAndApply();
		}
	}

	void CardPutStrips(const FWonderlandCardColour& Want)
	{
		// THE STRIPS ROW'S OWN PICK: any key but DEFAULT means chosen (the palette name when the colour is one)
		static const FName Default(TEXT("DEFAULT"));
		static const FName Custom(TEXT("CARD"));
		FName Key = Default;
		if (Want.bChosen)
		{
			Key = Custom;
			for (const TPair<FName, FLinearColor>& Swatch : WonderlandMascotStyle::PrimaryPalette())
			{
				if (Swatch.Key != Default && Swatch.Value.Equals(Want.Colour, 0.0005f))
				{
					Key = Swatch.Key;
					break;
				}
			}
		}
		WonderlandMascotStyle::PickMascotStrip(Key, Want.bChosen ? Want.Colour : FLinearColor::Black);
	}

	void CardPutFlame(const FWonderlandCardColour& Want)
	{
		// THE FLAME ROW'S OWN WRITE; DEFAULT is the designed fire, which the file holds as white
		WonderlandMascotStyle::SetFlameColour(Want.bChosen ? Want.Colour : FLinearColor::White);
		WonderlandMascotStyle::SaveAndApply();
	}

	/** Why the companions cannot be put behind the slots now, or empty when they can. */
	FString CardCompanionsBlocked(const UWorld* World)
	{
		// THE ENVELOPE: a running mission keeps the companions it started with
		const UWonderlandMissionSubsystem* Mission = CardMission(World);
		const FString Running = Mission != nullptr ? Mission->GetRunningMissionId() : FString();
		if (!Running.IsEmpty())
		{
			return FString::Printf(TEXT("mission %s is running and keeps the companions it started with"), *Running);
		}
		// AND NOTHING IS SENT TO A RUNTIME THAT IS NOT THERE
		const UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			return TEXT("this game has no companion runtime client");
		}
		if (Sidekicks->GetLink() != EWonderlandSidekickLink::Online)
		{
			return FString::Printf(TEXT("the companion runtime is %s"),
				Sidekicks->GetLink() == EWonderlandSidekickLink::Connecting ? TEXT("still connecting") : TEXT("offline"));
		}
		return FString();
	}

	/** Each slot's provider put behind its companion where it differs; a reference that cannot fill its slot is not sent. */
	FString CardApplyCompanions(UWorld* World, const FWonderlandCard& Card)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			return TEXT("no companion runtime client");
		}
		const WonderlandCardCapabilities::FReading Reading = WonderlandCardCapabilities::Read(World != nullptr ? World->GetGameInstance() : nullptr);
		TArray<FString> Did;
		for (const FWonderlandCompanionRef& Ref : Card.Companions)
		{
			if (Ref.ProviderId.IsEmpty())
			{
				continue;
			}
			// THE RESOLVER'S RULES ARE THE GATE (the sides, the authority separation, a provider this runtime has): an unusable
			// reference is reported, never sent
			const FWonderlandCardRefStatus Status = WonderlandCardCapabilities::ResolveCompanion(Ref, Reading);
			if (Status.Status == EWonderlandCardStatus::Unavailable)
			{
				Did.Add(FString::Printf(TEXT("slot %d not sent (%s)"), Ref.Slot, *Status.Reason));
				continue;
			}
			const TCHAR* const SidekickId = Ref.Slot == 0 ? TEXT("llm-companion") : TEXT("jhinn");
			const FWonderlandSidekick* Live = Sidekicks->Find(SidekickId);
			if (Live != nullptr && Live->ProviderId == Ref.ProviderId)
			{
				Did.Add(FString::Printf(TEXT("%s already on %s"), SidekickId, *Ref.ProviderId));
				continue;
			}
			Sidekicks->Connect(SidekickId, Ref.ProviderId);
			++GCardConnectsSent;
			Did.Add(FString::Printf(TEXT("%s -> %s"), SidekickId, *Ref.ProviderId));
		}
		return Did.Num() > 0 ? FString::Join(Did, TEXT(", ")) : FString(TEXT("none chosen (the runtime's own stay)"));
	}

	void CardStopWaiting()
	{
		if (GCardWaitingTicker.IsValid())
		{
			FTSTicker::GetCoreTicker().RemoveTicker(GCardWaitingTicker);
		}
		GCardWaitingTicker.Reset();
		GCardWaitingId.Reset();
		GCardWaitingName.Reset();
		GCardWaitingWhy.Reset();
		GCardWaitingWorld.Reset();
	}

	/** Once a second while companions wait: applied the moment nothing blocks them, dropped when a newer SELECT replaced them. */
	bool CardTickWaiting(float);

	/** The companions of the card now, between missions with the runtime there; otherwise they wait, and why is said. */
	FString CardApplyOrWait(UWorld* World, const FWonderlandCard& Card)
	{
		const FString Blocked = CardCompanionsBlocked(World);
		if (Blocked.IsEmpty())
		{
			CardStopWaiting();
			return FString::Printf(TEXT("companions: %s"), *CardApplyCompanions(World, Card));
		}
		GCardWaitingId = Card.Id;
		GCardWaitingName = Card.Name;
		GCardWaitingWhy = Blocked;
		GCardWaitingWorld = World;
		if (!GCardWaitingTicker.IsValid())
		{
			GCardWaitingTicker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&CardTickWaiting), 1.0f);
		}
		return FString::Printf(TEXT("companions wait: %s"), *Blocked);
	}

	bool CardTickWaiting(float)
	{
		UWorld* World = GCardWaitingWorld.Get();
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		const FWonderlandCard* Card = Sidekicks != nullptr ? Sidekicks->GetCardStore().Find(GCardWaitingId) : nullptr;
		if (World == nullptr || Sidekicks == nullptr || Card == nullptr || Sidekicks->GetCardStore().GetActiveId() != GCardWaitingId)
		{
			// the world went, the card went, or another card was selected since: nothing of this one waits any more
			GCardWaitingTicker.Reset();
			GCardWaitingId.Reset();
			GCardWaitingName.Reset();
			GCardWaitingWhy.Reset();
			GCardWaitingWorld.Reset();
			return false;
		}
		const FString Blocked = CardCompanionsBlocked(World);
		if (!Blocked.IsEmpty())
		{
			GCardWaitingWhy = Blocked;
			return true;
		}
		const FWonderlandCard Applying = *Card;
		GCardWaitingTicker.Reset();
		GCardWaitingId.Reset();
		GCardWaitingName.Reset();
		GCardWaitingWhy.Reset();
		GCardWaitingWorld.Reset();
		UE_LOG(LogTemp, Display, TEXT("WLCARD the waiting companions of %s are applied now: %s"), *FWonderlandCardStore::MaskForDisplay(Applying.Name), *FWonderlandCardStore::MaskForDisplay(CardApplyCompanions(World, Applying)));
		return false;
	}
}

namespace WonderlandCardDirector
{
	bool Select(UWorld* World, const FString& CardIdOrName, FString& OutSaid)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			OutSaid = TEXT("C.A.R.D. is not available in this game");
			return false;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		const FWonderlandCard* Named = FindNamedCard(Store, CardIdOrName);
		if (Named == nullptr)
		{
			OutSaid = FString::Printf(TEXT("no C.A.R.D. called '%s'"), *WonderlandCardCapabilities::CleanReason(CardIdOrName));
			return false;
		}
		const FString Id = Named->Id;
		const FString Name = Named->Name;
		FString Why;
		if (!Store.Select(Id, Why))
		{
			OutSaid = FString::Printf(TEXT("could not select %s: %s"), *Name, *Why);
			return false;
		}
		// a COPY: applying goes through other systems, and no pointer into the store is held across them
		const FWonderlandCard Card = Store.GetActive();
		TArray<FString> Said;
		Said.Add(FString::Printf(TEXT("C.A.R.D. %s selected"), *Card.Name));
		{
			const FString Disk = CardWriteToDisk(Store);
			if (!Disk.IsEmpty())
			{
				Said.Add(Disk);
			}
		}

		// THE SKIN, through the one door the wardrobe uses (the stage and the Dog follow the registry)
		if (UWonderlandRelaySkinSubsystem* Skins = CardSkins(World))
		{
			if (Skins->GetEquippedSkinId().ToString().Equals(Card.Skin, ESearchCase::IgnoreCase))
			{
				Said.Add(FString::Printf(TEXT("skin %s (already worn)"), *Card.Skin));
			}
			else if (Skins->EquipSkin(FName(*Card.Skin)))
			{
				Said.Add(FString::Printf(TEXT("skin %s"), *Card.Skin));
			}
			else
			{
				Said.Add(FString::Printf(TEXT("skin %s is not in this build; the worn skin is kept"), *Card.Skin));
			}
		}

		// THE PRIMARY, through the wardrobe's own pick (its state, its file, SaveAndApply)
		FName Key;
		FLinearColor Colour = FLinearColor::White;
		if (CardPrimarySwatch(Card.Primary, Key, Colour))
		{
			if (!WonderlandMascotStyle::IsMascotPrimaryOn(Key, Colour))
			{
				WonderlandMascotStyle::PickMascotPrimary(Key, Colour);
			}
			Said.Add(FString::Printf(TEXT("primary %s"), *Key.ToString()));
		}
		else
		{
			Said.Add(FString::Printf(TEXT("primary %s is not in this build's palette; the primary is kept"), *Card.Primary.Key));
		}

		// COLOR 2, COLOR 3, THE FIRE: each through its own row's authority, each only if this card recorded it
		Said.Add(CardApplyColour(TEXT("colour 2 (secondary)"), Card.Secondary, CardLiveSecondary(), [&Card]() { CardPutSecondary(Card.Secondary); }));
		Said.Add(CardApplyColour(TEXT("colour 3 (strips)"), Card.Strips, CardLiveStrips(), [&Card]() { CardPutStrips(Card.Strips); }));
		Said.Add(CardApplyColour(TEXT("flame"), Card.Flame, CardLiveFlame(), [&Card]() { CardPutFlame(Card.Flame); }));

		// THE COMPANIONS: now between missions with the runtime there; otherwise they wait, and why is said
		Said.Add(CardApplyOrWait(World, Card));

		// THE MISSION HANDOFF FORM is read when the next handoff begins: swords are never swapped in a hand
		Said.Add(FString::Printf(TEXT("Mission Handoff %s from the next handoff"), *Card.MissionHandoff));
		OutSaid = FString::Join(Said, TEXT("; "));
		UE_LOG(LogTemp, Display, TEXT("WLCARD %s"), *FWonderlandCardStore::MaskForDisplay(OutSaid));
		return true;
	}

	bool IsModified(const UWorld* World, FString* OutWhat)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		const UWonderlandRelaySkinSubsystem* Skins = CardSkins(World);
		if (Sidekicks == nullptr)
		{
			return false;
		}
		const FWonderlandCard& Card = Sidekicks->GetCardStore().GetActive();
		TArray<FString> What;
		if (Skins != nullptr && !Skins->GetEquippedSkinId().ToString().Equals(Card.Skin, ESearchCase::IgnoreCase))
		{
			What.Add(FString::Printf(TEXT("skin %s is worn, the card says %s"), *Skins->GetEquippedSkinId().ToString(), *Card.Skin));
		}
		FName Key;
		FLinearColor Colour = FLinearColor::White;
		if (CardPrimarySwatch(Card.Primary, Key, Colour) && !WonderlandMascotStyle::IsMascotPrimaryOn(Key, Colour))
		{
			What.Add(FString::Printf(TEXT("the primary is not the card's %s"), *Key.ToString()));
		}
		// COLOR 2 / COLOR 3 / the fire, where the card recorded them
		struct FChannelCheck { const TCHAR* What; const FWonderlandCardColour& Card; FWonderlandCardColour Live; };
		const FChannelCheck Checks[] = {
			{ TEXT("colour 2 (secondary)"), Card.Secondary, CardLiveSecondary() },
			{ TEXT("colour 3 (strips)"), Card.Strips, CardLiveStrips() },
			{ TEXT("the flame"), Card.Flame, CardLiveFlame() },
		};
		for (const FChannelCheck& Check : Checks)
		{
			if (Check.Card.bRecorded && !CardSameColour(Check.Card, Check.Live))
			{
				What.Add(FString::Printf(TEXT("%s is %s, the card says %s"), Check.What, *CardColourWord(Check.Live), *CardColourWord(Check.Card)));
			}
		}
		if (OutWhat != nullptr)
		{
			*OutWhat = FString::Join(What, TEXT("; "));
		}
		return What.Num() > 0;
	}

	FString DescribeColour(const FWonderlandCardColour& Channel)
	{
		if (!Channel.bRecorded)
		{
			return TEXT("NOT SAVED");
		}
		return Channel.bChosen ? CardColourWord(Channel).ToUpper() : FString(TEXT("AS DESIGNED"));
	}

	bool SaveLiveToActive(UWorld* World, FString& OutSaid)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		const UWonderlandRelaySkinSubsystem* Skins = CardSkins(World);
		if (Sidekicks == nullptr || Skins == nullptr)
		{
			OutSaid = TEXT("C.A.R.D. is not available in this game");
			return false;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		FWonderlandCard Card = Store.GetActive();
		Card.Skin = Skins->GetEquippedSkinId().ToString();
		// THE PRIMARY AS THE WARDROBE HAS IT NOW: a palette key, or DEFAULT (the skin's design). A typed colour is no key.
		Card.Primary.Key = TEXT("DEFAULT");
		Card.Primary.bChosen = false;
		bool bTyped = false;
		if (WonderlandMascotStyle::HasChosenPrimary())
		{
			bTyped = true;
			for (const TPair<FName, FLinearColor>& Swatch : WonderlandMascotStyle::PrimaryPalette())
			{
				if (!Swatch.Key.ToString().Equals(TEXT("DEFAULT"), ESearchCase::IgnoreCase) && WonderlandMascotStyle::IsMascotPrimaryOn(Swatch.Key, Swatch.Value))
				{
					Card.Primary.Key = Swatch.Key.ToString();
					Card.Primary.bChosen = true;
					bTyped = false;
					break;
				}
			}
		}
		// COLOR 2, COLOR 3 AND THE FIRE AS THE DOG WEARS THEM NOW (recorded, so selecting this card restores exactly these)
		Card.Secondary = CardLiveSecondary();
		Card.Strips = CardLiveStrips();
		Card.Flame = CardLiveFlame();
		FString Why;
		if (!Store.Update(Card, Why))
		{
			OutSaid = FString::Printf(TEXT("could not save to C.A.R.D. %s: %s"), *Card.Name, *Why);
			return false;
		}
		OutSaid = FString::Printf(TEXT("saved to C.A.R.D. %s: skin %s, primary %s, colour 2 %s, colour 3 %s, flame %s%s"), *Card.Name, *Card.Skin,
			*Card.Primary.Key, *CardColourWord(Card.Secondary), *CardColourWord(Card.Strips), *CardColourWord(Card.Flame),
			bTyped ? TEXT(" (the primary on the Dog is a typed colour, which a C.A.R.D. cannot hold: palette keys only)") : TEXT(""));
		CardSayWrite(Store, OutSaid);
		UE_LOG(LogTemp, Display, TEXT("WLCARD %s"), *FWonderlandCardStore::MaskForDisplay(OutSaid));
		return true;
	}

	FString DescribeWaiting()
	{
		return GCardWaitingId.IsEmpty() ? FString() : FString::Printf(TEXT("the companions of C.A.R.D. %s wait: %s"), *GCardWaitingName, *GCardWaitingWhy);
	}

	int32 GetConnectsSent()
	{
		return GCardConnectsSent;
	}

	bool Create(UWorld* World, const FString& Name, FString& OutId, FString& OutSaid)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			OutSaid = TEXT("C.A.R.D. is not available in this game");
			return false;
		}
		FString Why;
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		OutId = Store.Create(Name, Why);
		if (OutId.IsEmpty())
		{
			OutSaid = FString::Printf(TEXT("no new C.A.R.D.: %s"), *Why);
			return false;
		}
		OutSaid = FString::Printf(TEXT("C.A.R.D. %s made"), *Name);
		CardSayWrite(Store, OutSaid);
		return true;
	}

	bool Delete(UWorld* World, const FString& IdOrName, FString& OutSaid)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			OutSaid = TEXT("C.A.R.D. is not available in this game");
			return false;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		const FWonderlandCard* Named = FindNamedCard(Store, IdOrName);
		if (Named == nullptr)
		{
			OutSaid = FString::Printf(TEXT("no C.A.R.D. called '%s'"), *WonderlandCardCapabilities::CleanReason(IdOrName));
			return false;
		}
		const FString Id = Named->Id;
		const FString Name = Named->Name;
		FString Why;
		if (!Store.Delete(Id, Why))
		{
			OutSaid = FString::Printf(TEXT("%s not deleted: %s"), *Name, *Why);
			return false;
		}
		OutSaid = FString::Printf(TEXT("%s deleted; the active C.A.R.D. is %s"), *Name, *Store.GetActive().Name);
		CardSayWrite(Store, OutSaid);
		return true;
	}

	bool Attach(UWorld* World, EWonderlandCapabilityKind Kind, const FString& Id, const FString& Label, FString& OutSaid)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			OutSaid = TEXT("C.A.R.D. is not available in this game");
			return false;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		FWonderlandCard Card = Store.GetActive();
		FWonderlandCapabilityRef& Ref = Card.Capabilities.AddDefaulted_GetRef();
		Ref.Kind = Kind;
		Ref.Id = Id.TrimStartAndEnd();
		Ref.Label = Label.TrimStartAndEnd();
		FString Why;
		// THE STORE IS THE GATE: an unsafe id, a credential-shaped id or label, too many references -- refused there, said here
		if (!Store.Update(Card, Why))
		{
			OutSaid = FString::Printf(TEXT("not attached: %s"), *Why);
			return false;
		}
		const WonderlandCardCapabilities::FReading Reading = WonderlandCardCapabilities::Read(World != nullptr ? World->GetGameInstance() : nullptr);
		OutSaid = FString::Printf(TEXT("attached to %s: %s"), *Card.Name,
			*WonderlandCardCapabilities::Describe(WonderlandCardCapabilities::ResolveCapability(Card.Capabilities.Last(), Reading)));
		CardSayWrite(Store, OutSaid);
		return true;
	}

	bool Detach(UWorld* World, int32 Index, FString& OutSaid)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			OutSaid = TEXT("C.A.R.D. is not available in this game");
			return false;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		FWonderlandCard Card = Store.GetActive();
		if (!Card.Capabilities.IsValidIndex(Index))
		{
			OutSaid = FString::Printf(TEXT("%s has no reference %d"), *Card.Name, Index + 1);
			return false;
		}
		const FString Gone = Card.Capabilities[Index].Id;
		Card.Capabilities.RemoveAt(Index);
		FString Why;
		if (!Store.Update(Card, Why))
		{
			OutSaid = FString::Printf(TEXT("not detached: %s"), *Why);
			return false;
		}
		OutSaid = FString::Printf(TEXT("%s detached from %s"), *Gone, *Card.Name);
		CardSayWrite(Store, OutSaid);
		return true;
	}

	bool SetCompanion(UWorld* World, int32 Slot, EWonderlandCardCompanionKind Kind, const FString& ProviderId, FString& OutSaid)
	{
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			OutSaid = TEXT("C.A.R.D. is not available in this game");
			return false;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		FWonderlandCard Card = Store.GetActive();
		Card.Companions.RemoveAll([Slot](const FWonderlandCompanionRef& Each) { return Each.Slot == Slot; });
		FWonderlandCompanionRef& Ref = Card.Companions.AddDefaulted_GetRef();
		Ref.Slot = Slot;
		Ref.Kind = Kind;
		Ref.ProviderId = ProviderId.TrimStartAndEnd();
		FString Why;
		if (!Store.Update(Card, Why))
		{
			OutSaid = FString::Printf(TEXT("companion not set: %s"), *Why);
			return false;
		}
		const FWonderlandCard Saved = Store.GetActive();
		OutSaid = FString::Printf(TEXT("%s: slot %d is %s; %s"), *Saved.Name, Slot, *Ref.ProviderId, *CardApplyOrWait(World, Saved));
		CardSayWrite(Store, OutSaid);
		UE_LOG(LogTemp, Display, TEXT("WLCARD %s"), *FWonderlandCardStore::MaskForDisplay(OutSaid));
		return true;
	}

	FString MaskForEcho(const FString& Line)
	{
		return FWonderlandCardStore::MaskForDisplay(Line);
	}

	bool HandleTerminalLine(UWorld* World, const FString& Line, TArray<FString>& OutRows)
	{
		const FString Text = Line.TrimStartAndEnd();
		if (!Text.StartsWith(TEXT("/card"), ESearchCase::IgnoreCase))
		{
			return false;
		}
		FString Rest = Text.Mid(5);
		if (Rest.StartsWith(TEXT("s"), ESearchCase::IgnoreCase))
		{
			Rest = Rest.Mid(1);   // "/cards" too
		}
		if (!Rest.IsEmpty() && !FChar::IsWhitespace(Rest[0]))
		{
			return false;   // "/cardigan" is not ours
		}
		Rest.TrimStartAndEndInline();
		FString Verb = Rest;
		FString Arg;
		Rest.Split(TEXT(" "), &Verb, &Arg);
		Verb.TrimStartAndEndInline();
		Arg.TrimStartAndEndInline();
		UWonderlandSidekickSubsystem* Sidekicks = CardSidekicks(World);
		if (Sidekicks == nullptr)
		{
			OutRows.Add(TEXT("C.A.R.D. is not available in this game"));
			return true;
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		FString Said;
		FString Why;
		if (Verb.IsEmpty() || Verb.Equals(TEXT("status"), ESearchCase::IgnoreCase))
		{
			OutRows.Append(WonderlandCardCapabilities::DescribeCard(Store.GetActive(), WonderlandCardCapabilities::Read(World != nullptr ? World->GetGameInstance() : nullptr)));
			FString What;
			if (IsModified(World, &What))
			{
				OutRows.Add(FString::Printf(TEXT("MODIFIED: %s -- /card save writes the live look into this C.A.R.D."), *What));
			}
			const FString Waiting = DescribeWaiting();
			if (!Waiting.IsEmpty())
			{
				OutRows.Add(Waiting);
			}
		}
		else if (Verb.Equals(TEXT("list"), ESearchCase::IgnoreCase))
		{
			for (const FWonderlandCard& Card : Store.GetCards())
			{
				OutRows.Add(FString::Printf(TEXT("%s %s (%s)%s"), Card.Id == Store.GetActiveId() ? TEXT("*") : TEXT(" "), *Card.Name, *Card.Id,
					Card.bBuiltIn ? TEXT(", built in") : TEXT("")));
			}
		}
		else if (Verb.Equals(TEXT("select"), ESearchCase::IgnoreCase))
		{
			Select(World, Arg, Said);
			OutRows.Add(Said);
		}
		else if (Verb.Equals(TEXT("new"), ESearchCase::IgnoreCase))
		{
			FString Id;
			OutRows.Add(Create(World, Arg, Id, Said) ? FString::Printf(TEXT("%s (%s); /card select %s to use it"), *Said, *Id, *Id) : Said);
		}
		else if (Verb.Equals(TEXT("rename"), ESearchCase::IgnoreCase))
		{
			const FString Id = Store.GetActiveId();
			if (Store.Rename(Id, Arg, Why))
			{
				FString Renamed = FString::Printf(TEXT("this C.A.R.D. is now called %s"), *Store.GetActive().Name);
				CardSayWrite(Store, Renamed);
				OutRows.Add(Renamed);
			}
			else
			{
				OutRows.Add(FString::Printf(TEXT("not renamed: %s"), *Why));
			}
		}
		else if (Verb.Equals(TEXT("save"), ESearchCase::IgnoreCase))
		{
			SaveLiveToActive(World, Said);
			OutRows.Add(Said);
		}
		else if (Verb.Equals(TEXT("delete"), ESearchCase::IgnoreCase))
		{
			Delete(World, Arg, Said);
			OutRows.Add(Said);
		}
		else if (Verb.Equals(TEXT("attach"), ESearchCase::IgnoreCase))
		{
			// /card attach mcp|api|skill <id> [label]
			FString KindWord = Arg;
			FString IdAndLabel;
			Arg.Split(TEXT(" "), &KindWord, &IdAndLabel);
			FString Id = IdAndLabel.TrimStartAndEnd();
			FString Label;
			IdAndLabel.TrimStartAndEnd().Split(TEXT(" "), &Id, &Label);
			const bool bMcp = KindWord.Equals(TEXT("mcp"), ESearchCase::IgnoreCase);
			const bool bApi = KindWord.Equals(TEXT("api"), ESearchCase::IgnoreCase);
			const bool bSkill = KindWord.Equals(TEXT("skill"), ESearchCase::IgnoreCase);
			if ((!bMcp && !bApi && !bSkill) || Id.IsEmpty())
			{
				OutRows.Add(TEXT("/card attach mcp|api|skill <id> [label] -- an MCP server or an API by its Julius Connect id, a skill by id; never a key"));
			}
			else
			{
				Attach(World, bMcp ? EWonderlandCapabilityKind::Mcp : (bApi ? EWonderlandCapabilityKind::Api : EWonderlandCapabilityKind::Skill), Id, Label, Said);
				OutRows.Add(Said);
			}
		}
		else if (Verb.Equals(TEXT("detach"), ESearchCase::IgnoreCase))
		{
			// /card detach <n>, counting from 1 as /card status lists them
			Detach(World, FCString::Atoi(*Arg) - 1, Said);
			OutRows.Add(Said);
		}
		else if (Verb.Equals(TEXT("companion"), ESearchCase::IgnoreCase))
		{
			// /card companion left|right <provider-id> [llm|agent|harness]
			FString SideWord = Arg;
			FString Rest2;
			Arg.Split(TEXT(" "), &SideWord, &Rest2);
			FString Provider = Rest2.TrimStartAndEnd();
			FString KindWord;
			Rest2.TrimStartAndEnd().Split(TEXT(" "), &Provider, &KindWord);
			const bool bLeft = SideWord.Equals(TEXT("left"), ESearchCase::IgnoreCase);
			const bool bRight = SideWord.Equals(TEXT("right"), ESearchCase::IgnoreCase);
			if ((!bLeft && !bRight) || Provider.IsEmpty())
			{
				OutRows.Add(TEXT("/card companion left|right <provider-id> [llm|agent|harness] -- LEFT is the LLM Companion, RIGHT is Jhinn"));
			}
			else
			{
				EWonderlandCardCompanionKind Kind = bLeft ? EWonderlandCardCompanionKind::Llm : EWonderlandCardCompanionKind::Agent;
				if (KindWord.Equals(TEXT("harness"), ESearchCase::IgnoreCase))
				{
					Kind = EWonderlandCardCompanionKind::Harness;
				}
				else if (KindWord.Equals(TEXT("agent"), ESearchCase::IgnoreCase))
				{
					Kind = EWonderlandCardCompanionKind::Agent;
				}
				else if (KindWord.Equals(TEXT("llm"), ESearchCase::IgnoreCase))
				{
					Kind = EWonderlandCardCompanionKind::Llm;
				}
				SetCompanion(World, bLeft ? 0 : 1, Kind, Provider, Said);
				OutRows.Add(Said);
			}
		}
		else
		{
			OutRows.Add(TEXT("/card [status] | list | select <name> | new <name> | rename <name> | save | delete <name> | attach mcp|api|skill <id> [label] | ")
				TEXT("detach <n> | companion left|right <provider-id> [llm|agent|harness]"));
		}
		return true;
	}
}

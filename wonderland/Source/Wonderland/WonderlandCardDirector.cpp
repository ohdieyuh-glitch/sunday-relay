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
		GCardWaitingWhy.Reset();
		GCardWaitingWorld.Reset();
		UE_LOG(LogTemp, Display, TEXT("WLCARD the waiting companions of %s are applied now: %s"), *Applying.Name, *CardApplyCompanions(World, Applying));
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

		// THE COMPANIONS: now between missions with the runtime there; otherwise they wait, and why is said
		Said.Add(CardApplyOrWait(World, Card));

		// THE MISSION HANDOFF FORM is read when the next handoff begins: swords are never swapped in a hand
		Said.Add(FString::Printf(TEXT("Mission Handoff %s from the next handoff"), *Card.MissionHandoff));
		OutSaid = FString::Join(Said, TEXT("; "));
		UE_LOG(LogTemp, Display, TEXT("WLCARD %s"), *OutSaid);
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
		if (OutWhat != nullptr)
		{
			*OutWhat = FString::Join(What, TEXT("; "));
		}
		return What.Num() > 0;
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
		FString Why;
		if (!Store.Update(Card, Why))
		{
			OutSaid = FString::Printf(TEXT("could not save to C.A.R.D. %s: %s"), *Card.Name, *Why);
			return false;
		}
		OutSaid = FString::Printf(TEXT("saved to C.A.R.D. %s: skin %s, primary %s%s"), *Card.Name, *Card.Skin, *Card.Primary.Key,
			bTyped ? TEXT(" (the primary on the Dog is a typed colour, which a C.A.R.D. cannot hold: palette keys only)") : TEXT(""));
		UE_LOG(LogTemp, Display, TEXT("WLCARD %s"), *OutSaid);
		return true;
	}

	FString DescribeWaiting()
	{
		return GCardWaitingId.IsEmpty() ? FString() : FString::Printf(TEXT("the companions of C.A.R.D. %s wait: %s"), *GCardWaitingId, *GCardWaitingWhy);
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
		OutId = Sidekicks->GetCardStore().Create(Name, Why);
		OutSaid = OutId.IsEmpty() ? FString::Printf(TEXT("no new C.A.R.D.: %s"), *Why) : FString::Printf(TEXT("C.A.R.D. %s made"), *Name);
		return !OutId.IsEmpty();
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
		UE_LOG(LogTemp, Display, TEXT("WLCARD %s"), *OutSaid);
		return true;
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
			OutRows.Add(Store.Rename(Id, Arg, Why) ? FString::Printf(TEXT("this C.A.R.D. is now called %s"), *Store.GetActive().Name)
				: FString::Printf(TEXT("not renamed: %s"), *Why));
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

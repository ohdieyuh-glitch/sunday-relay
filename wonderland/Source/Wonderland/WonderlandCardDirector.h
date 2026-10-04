// Copyright Wonderland. C.A.R.D. SELECT: a card applied through the authorities it references -- never as one itself.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandCard.h"

class UWorld;

/**
 * THE ONLY PATH THAT APPLIES A C.A.R.D. (M7b). A card is a reference; selecting it asks each real authority in turn:
 *   - the SKIN through the skin registry (UWonderlandRelaySkinSubsystem::EquipSkin), the one door the wardrobe uses;
 *   - the PRIMARY (COLOR 1) through WonderlandMascotStyle::PickMascotPrimary (a card that never chose one is the skin's design: DEFAULT);
 *   - COLOR 2 (the secondary: accents, status eyes, Shadow Flame's marbling), COLOR 3 (the strips) and the FLAME, each through
 *     its own row's authority (the mascot settings' Secondary + SaveAndApply, PickMascotStrip, SetFlameColour) -- and only when
 *     the card RECORDED that channel: a card saved before the channel existed leaves the live colour alone;
 *   - the COMPANIONS through the companion runtime (UWonderlandSidekickSubsystem::Connect), and ONLY between missions: a running
 *     mission keeps the companions it started with (the envelope), and a switch waits for it to end. With the runtime offline they
 *     wait for it too, rather than firing intents at nothing; the reason waiting is always said;
 *   - the MISSION HANDOFF FORM at the next handoff (the handoff reads the active card when it begins; swords never swap in a hand).
 * Capabilities are references only: Julius Connect grants them, so selecting a card asks nothing of it.
 *
 * At boot the live files win and no card is re-applied (WonderlandCard.h). A pick in the wardrobe after a SELECT makes the active
 * card MODIFIED, and SAVE TO C.A.R.D. writes the live look back into it -- the store is the one writer of Cards.sav.
 *
 * Plain C++ (the FName rule). Shared by the Live Terminal's /card, the C.A.R.D. section and the QA.
 */
namespace WonderlandCardDirector
{
	/** Make a card the active one and apply it (see above). By id, or by name ignoring case. */
	WONDERLAND_API bool Select(UWorld* World, const FString& CardIdOrName, FString& OutSaid);

	/** True when the live look differs from the active card's: a skin, a primary or a recorded colour channel picked since. OutWhat says which. */
	WONDERLAND_API bool IsModified(const UWorld* World, FString* OutWhat = nullptr);

	/** SAVE TO C.A.R.D.: the worn skin, the chosen primary, COLOR 2, COLOR 3 and the flame written into the active card. */
	WONDERLAND_API bool SaveLiveToActive(UWorld* World, FString& OutSaid);

	/** One colour channel of a card as a person reads it: "NOT SAVED" (never recorded), "AS DESIGNED", a palette name, or r,g,b. */
	WONDERLAND_API FString DescribeColour(const FWonderlandCardColour& Channel);

	/** What is waiting to be applied and why (a mission running, the runtime offline), or empty when nothing waits. */
	WONDERLAND_API FString DescribeWaiting();

	/** For the QA: how many Connect intents SELECT has sent to the companion runtime this session. */
	WONDERLAND_API int32 GetConnectsSent();

	/** A new card by name (the store's defaults: Relay OG, as designed, the Angelic Twin Swords, no references). */
	WONDERLAND_API bool Create(UWorld* World, const FString& Name, FString& OutId, FString& OutSaid);

	/** Delete a card by id or name. Deleting the active one falls back to the built-in default; the Dog's look is untouched. */
	WONDERLAND_API bool Delete(UWorld* World, const FString& IdOrName, FString& OutSaid);

	/** Attach a typed reference to the active card (an MCP server or an API by its Julius Connect id, a skill by id). Never a
	 *  key: the store refuses a credential-shaped value, and the credential stays with Julius Connect. */
	WONDERLAND_API bool Attach(UWorld* World, EWonderlandCapabilityKind Kind, const FString& Id, const FString& Label, FString& OutSaid);

	/** Detach the active card's Nth reference (0-based). */
	WONDERLAND_API bool Detach(UWorld* World, int32 Index, FString& OutSaid);

	/** Put a provider in one of the active card's companion slots (0 LEFT, 1 RIGHT), and apply it as SELECT would: now
	 *  between missions with the runtime there, otherwise waiting (and why). An unusable reference is stored, reported, not sent. */
	WONDERLAND_API bool SetCompanion(UWorld* World, int32 Slot, EWonderlandCardCompanionKind Kind, const FString& ProviderId, FString& OutSaid);

	/** The Live Terminal's /card: status, list, select, new, rename, save, delete, attach, detach, companion. */
	WONDERLAND_API bool HandleTerminalLine(UWorld* World, const FString& Line, TArray<FString>& OutRows);

	/** The typed line as the terminal may SHOW it back: every word the C.A.R.D. secret refusal flags (a provider key, a token)
	 *  replaced -- a key typed into "/card attach api <key>" is refused by the store AND never shown (Second's review, 10-03). */
	WONDERLAND_API FString MaskForEcho(const FString& Line);
}

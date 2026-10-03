// Copyright Wonderland. C.A.R.D. SELECT: a card applied through the authorities it references -- never as one itself.
#pragma once

#include "CoreMinimal.h"

class UWorld;

/**
 * THE ONLY PATH THAT APPLIES A C.A.R.D. (M7b). A card is a reference; selecting it asks each real authority in turn:
 *   - the SKIN through the skin registry (UWonderlandRelaySkinSubsystem::EquipSkin), the one door the wardrobe uses;
 *   - the PRIMARY through WonderlandMascotStyle::PickMascotPrimary (a card that never chose one is the skin's design: DEFAULT);
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

	/** True when the live look differs from the active card's: a skin or a primary picked since. OutWhat says which. */
	WONDERLAND_API bool IsModified(const UWorld* World, FString* OutWhat = nullptr);

	/** SAVE TO C.A.R.D.: the worn skin and the chosen primary written into the active card. */
	WONDERLAND_API bool SaveLiveToActive(UWorld* World, FString& OutSaid);

	/** What is waiting to be applied and why (a mission running, the runtime offline), or empty when nothing waits. */
	WONDERLAND_API FString DescribeWaiting();

	/** For the QA: how many Connect intents SELECT has sent to the companion runtime this session. */
	WONDERLAND_API int32 GetConnectsSent();

	/** The Live Terminal's /card: status, list, select <id|name>, new <name>, rename <name>, save, delete <id|name>. */
	WONDERLAND_API bool HandleTerminalLine(UWorld* World, const FString& Line, TArray<FString>& OutRows);
}

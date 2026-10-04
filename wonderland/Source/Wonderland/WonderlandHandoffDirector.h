// Copyright Wonderland. MISSION HANDOFF, ORCHESTRATED: what taking up and giving back the swords means for one player.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionHandoff.h"

class ULocalPlayer;

/**
 * THE ONE PLACE A HANDOFF IS STARTED OR ENDED FOR A PLAYER. The Live Terminal's /handoff (founder, 2026-10-02: the
 * transformation is started from the Julius Live Terminal), the QA and the non-shipping wl.Handoff.* commands all come
 * through here, so they behave identically.
 *
 * It READS -- the companions' bodies, the running mission, the active C.A.R.D. -- and drives the state machine
 * (WonderlandMissionHandoff.h). It never writes mission truth: the mission presentation leaves and resumes the animation
 * on the state machine's own changes (UWonderlandMissionSubsystem), and the write spy counts anything that writes.
 *
 * Plain C++ (the Niagara FName rule, WonderlandBeta.h): no reflected type, no log category.
 */
namespace WonderlandHandoffDirector
{
	/** The handoff state of this player's game instance, or nullptr. */
	WONDERLAND_API FWonderlandMissionHandoff* StateFor(const ULocalPlayer* Player);

	/** Whether both companions' bodies are in the world and showing (Second's V2-2: the bodies are the gate, never the provider). */
	WONDERLAND_API FWonderlandMissionHandoff::FCompanionsPresent ReadCompanions(const ULocalPlayer* Player);

	/**
	 * Take up the swords. Entry B (MID-MISSION) while a mission's animation runs, Entry A (ROAMING) otherwise -- and with no
	 * mission running nothing mission-shaped is attached or created. The form is the active C.A.R.D.'s. OutSaid is one
	 * sentence for the user, success or refusal.
	 */
	WONDERLAND_API bool Equip(ULocalPlayer* Player, FString& OutSaid);

	/** Give the swords back: they become the companions again, and a running mission's presentation resumes at its current beat. */
	WONDERLAND_API bool Return(ULocalPlayer* Player, FString& OutSaid);

	/** One line: the state, the form, the mission attached (or none) and how it was entered. */
	WONDERLAND_API FString Describe(const ULocalPlayer* Player);

	/**
	 * THE LIVE TERMINAL'S /handoff. `/handoff` takes the swords up, or gives them back while they are held; `/handoff return`
	 * gives them back; `/handoff status` says where things stand. bOutCloseTerminal is set when the swords were just taken up,
	 * so the terminal steps aside and the user is roaming again. Always handled (an unknown argument is answered, not sent on).
	 */
	WONDERLAND_API void HandleTerminalLine(ULocalPlayer* Player, const FString& Argument, FString& OutSaid, bool& bOutCloseTerminal);
}

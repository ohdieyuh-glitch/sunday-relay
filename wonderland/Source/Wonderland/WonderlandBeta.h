// WONDERLAND -- the private beta: one place that knows whether this is a PLAYER'S session or a DEVELOPER'S.
//
// FOUNDER, 2026-09-30: drive Wonderland to TRUE private-beta readiness -- "no developer-only knowledge required",
// "no developer-only debug controls exposed unintentionally", "do not fake unavailable Julius production
// functionality". The beta ships as a Development build (Shipping would drop the mission presentation and the
// companion previews, and ignores -ExecCmds, which the in-package QA runs through), so what makes the package a
// PLAYER'S build is decided here, at runtime:
//
//  - the console key and the engine's debug keys (F1 wireframe, F5 shader complexity, ';' debug camera ...) are taken
//    away unless the session is a developer's: the editor, or a package started with -wldev;
//  - the local AI services on 127.0.0.1:8795 (Julius Connect, the companions' runtime, live Wonder Web pages) are not
//    contacted unless asked for: the editor, or -wllocalai. An outside tester has none of them, and the founder's own
//    machine must answer exactly like theirs when it plays the package -- the clean-user baseline on this laptop was
//    reading the founder's development service and drawing its provider advice across the world;
//  - developer instructions (npm commands, paths on the founder's disk) are shown to developers only.
//
// Every wl.* command stays reachable to QA through -ExecCmds, which needs no console.
#pragma once

#include "CoreMinimal.h"

class APlayerController;

namespace WonderlandBeta
{
	/** The editor, or a packaged build started with -wldev. A beta tester's session is never one. */
	WONDERLAND_API bool IsDeveloperSession();

	/** The local AI services are contacted only in the editor or with -wllocalai. */
	WONDERLAND_API bool UseLocalAiServices();

	/**
	 * "Private Beta 0.1.0 · build abc1234 · 2026-10-01", read once from <ProjectDir>/BuildInfo/BuildInfo.txt, which the
	 * release script writes. "Development build" when no such file ships (the editor, a hand-made package).
	 */
	WONDERLAND_API const FString& BuildLabel();

	/** Takes the console's activation keys and the engine's debug key bindings away from a player's session. */
	WONDERLAND_API void LockDownPlayer(APlayerController* Controller);

	/** "Wonderland — <build label>" on the game window, so every screenshot and bug report names its build. */
	WONDERLAND_API void StampWindowTitle();

	/**
	 * A WHOLE FILE OR NOTHING: written to a temporary beside it, then moved over it. A save this laptop's low-memory
	 * reaper kills halfway leaves the previous file (or the complete temporary, which LoadTextWithRecovery adopts),
	 * never a truncated one.
	 */
	WONDERLAND_API bool SaveTextAtomically(const FString& Path, const FString& Text);
	WONDERLAND_API bool SaveBytesAtomically(const FString& Path, const TArray<uint8>& Bytes);

	/** If Path is missing but a complete temporary from an interrupted save is beside it, adopt that temporary. */
	WONDERLAND_API void RecoverInterruptedSave(const FString& Path);

	/**
	 * A short identifier safe to turn into an FName: 1-64 characters of letters, digits, '_', '-' and '.'. A longer or
	 * stranger line from a hand-edited or corrupted file is refused instead of tripping FName's 1024-character check,
	 * which is fatal in this build and would crash every launch until the file was found and deleted.
	 */
	WONDERLAND_API bool IsSafeId(const FString& Text);

	/** The one sentence a player sees wherever an AI surface would need a service this beta does not ship. */
	WONDERLAND_API const TCHAR* AiUnavailableSentence();

	/** Whether the first-launch welcome has been dismissed on this machine (a file in the player's Saved folder). */
	WONDERLAND_API bool HasSeenWelcome();
	WONDERLAND_API void MarkWelcomeSeen();
}

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
//
// AND A WARNING THAT COST A RELEASE CANDIDATE: NO NEW STATIC-TIME FNAMES HERE (no log category of its own, no namespace-
// scope FName). Niagara keys its type registry on a hash of FName entry ids (FNiagaraTypeDefinition::GeneratePathNameHash),
// a weak combine under which some name-table layouts collide, and every name made before Niagara starts moves the layout.
// RC1 crashed on every boot for exactly that reason. Boot-verify every build.
#pragma once

#include "CoreMinimal.h"

class APlayerController;
class UClass;
class USaveGame;

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

	/**
	 * Switches set once per game instance, before the first world exists: no Gameplay Debugger in a player's session, and
	 * no network listener -- the engine's trace control port (TCP 1985 on every interface, unauthenticated) is closed
	 * one frame after the engine opens it.
	 */
	WONDERLAND_API void ApplyPlayerSessionSwitches();

	/** Takes the console's activation keys and the engine's debug key bindings away from a player's session. */
	WONDERLAND_API void LockDownPlayer(APlayerController* Controller);

	/** "Wonderland — <build label>" on the game window, so every screenshot and bug report names its build. */
	WONDERLAND_API void StampWindowTitle();

	/**
	 * A saved EXCLUSIVE fullscreen comes back as borderless. Exclusive mode asks the display for the game's resolution,
	 * which on a DPI-scaled laptop is a mode the panel does not have: it came up as a 640x480 popup (Second Wonderland,
	 * RC2). Settings no longer offers it; this carries a profile that chose it forward.
	 */
	WONDERLAND_API void MigrateWindowMode();

	/**
	 * A WHOLE FILE OR NOTHING: written to a temporary beside it, then swapped over it in one atomic step (MoveFileExW,
	 * REPLACE_EXISTING). A save this laptop's low-memory reaper kills halfway, or one an anti-virus scan blocks, leaves
	 * the previous file exactly as it was -- never a truncated one, and never no file at all.
	 */
	WONDERLAND_API bool SaveTextAtomically(const FString& Path, const FString& Text);
	WONDERLAND_API bool SaveBytesAtomically(const FString& Path, const TArray<uint8>& Bytes);

	/** Discards a temporary left by a write that never completed (it may be half a file); the real save is untouched. */
	WONDERLAND_API void RecoverInterruptedSave(const FString& Path);

	/**
	 * A SAVE GAME, SEALED. The engine's loader (UGameplayStatics::LoadGameFromMemory) reads a class path and then the
	 * object's properties straight out of the bytes, with no bounds check before it makes names of them: a corrupted file
	 * -- a disk error, a sync tool, a hand edit -- can ask for a name thousands of characters long, which is fatal in this
	 * build, on EVERY launch until someone finds and deletes the file. So what this build writes carries a seal after the
	 * bytes (a tag, their length and their CRC-32), and a file whose seal does not hold is never handed to the loader.
	 * Written atomically, like every save here.
	 */
	WONDERLAND_API bool SaveSealedGame(USaveGame* Save, const FString& Path);

	/**
	 * The save at Path, when its seal holds and it is an Expected. A file written before saves were sealed is read only
	 * in a DEVELOPER'S session, and only if its header names Expected; the next save seals it. A player's build refuses
	 * every unsealed file. Anything refused is nullptr with OutWhy saying why -- and a missing file is nullptr with OutWhy
	 * empty.
	 */
	WONDERLAND_API USaveGame* LoadSealedGame(const FString& Path, UClass* Expected, FString& OutWhy);

	/** Moves a refused save beside itself as <name>.refused-<UTC><ext>, so the next save cannot overwrite it; the new path, or empty. */
	WONDERLAND_API FString SetAsideRefusedSave(const FString& Path);

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

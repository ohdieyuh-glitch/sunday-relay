// WONDERLAND -- the private beta's player/developer switch. See WonderlandBeta.h.
#include "WonderlandBeta.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/InputSettings.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformProcess.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Widgets/SWindow.h"

#if PLATFORM_WINDOWS
#include "Windows/WindowsHWrapper.h"
#endif

// NO LOG CATEGORY OF ITS OWN, ON PURPOSE. A log category is an FName made during static initialisation, before the
// engine registers Niagara's types -- and Niagara keys its type registry on a hash of FName ENTRY IDS
// (FNiagaraTypeDefinition::GeneratePathNameHash, NiagaraModule.cpp), a weak combine under which some layouts collide:
// RC1 crashed on every boot ("NewType: NiagaraPosition, OldType: NiagaraInt32", NiagaraTypeRegistry.cpp:338) because
// new names shifted the layout. See the memory note "Niagara FName-hash crash"; boot-verify every release build.

namespace WonderlandBeta
{
	bool IsDeveloperSession()
	{
		static const bool bDeveloper = GIsEditor || FParse::Param(FCommandLine::Get(), TEXT("wldev"));
		return bDeveloper;
	}

	bool UseLocalAiServices()
	{
		static const bool bLocal = GIsEditor || FParse::Param(FCommandLine::Get(), TEXT("wllocalai"));
		return bLocal;
	}

	const FString& BuildLabel()
	{
		static const FString Label = []()
		{
			FString Text;
			const FString Path = FPaths::Combine(FPaths::ProjectDir(), TEXT("BuildInfo"), TEXT("BuildInfo.txt"));
			if (FFileHelper::LoadFileToString(Text, *Path))
			{
				// ONE PRINTABLE LINE, BOUNDED: it goes on the window title and into every log.
				int32 NewLine = INDEX_NONE;
				if (Text.FindChar(TEXT('\n'), NewLine))
				{
					Text.LeftInline(NewLine);
				}
				Text.TrimStartAndEndInline();
				Text.LeftInline(120);
			}
			return Text.IsEmpty() ? FString(TEXT("Development build")) : Text;
		}();
		return Label;
	}

	void LockDownPlayer(APlayerController* Controller)
	{
		if (IsDeveloperSession())
		{
			return;
		}
		// THE CONSOLE OPENS ON A KEY THE ENGINE READS FROM THESE SETTINGS ON EVERY PRESS (Console.cpp), so with no keys
		// there is no way in from the keyboard. -ExecCmds still reaches every command.
		if (UInputSettings* Settings = GetMutableDefault<UInputSettings>())
		{
			Settings->ConsoleKeys.Reset();
		}
		// AND THE ENGINE'S OWN DEBUG KEYS: F1 wireframe, F2 unlit, F5 shader complexity, F9 screenshots, ';' a free debug
		// camera that writes the map's internal path on screen. Second Wonderland pressed them in the clean-user
		// baseline and every one answered.
		if (Controller != nullptr && Controller->PlayerInput != nullptr)
		{
			Controller->PlayerInput->DebugExecBindings.Reset();
		}
	}

	void StampWindowTitle()
	{
		if (GEngine == nullptr || GEngine->GameViewport == nullptr)
		{
			return;
		}
		const TSharedPtr<SWindow> Window = GEngine->GameViewport->GetWindow();
		if (Window.IsValid())
		{
			Window->SetTitle(FText::FromString(FString::Printf(TEXT("Wonderland — %s"), *BuildLabel())));
		}
	}

	void ApplyPlayerSessionSwitches()
	{
		if (IsDeveloperSession())
		{
			return;
		}
		// THE GAMEPLAY DEBUGGER ('): a Development build compiles it in and binds the apostrophe for every player, and it
		// draws the engine's AI and actor debug overlays across the world (Second Wonderland's review). Its manager is made
		// as each world initialises (GameplayDebuggerModule.cpp), so switching auto-creation off here -- from a game-instance
		// subsystem, before the map's world exists -- means a player's session never gets one.
		if (IConsoleVariable* AutoCreate = IConsoleManager::Get().FindConsoleVariable(TEXT("GameplayDebugger.AutoCreateGameplayDebuggerManager")))
		{
			AutoCreate->Set(0, ECVF_SetByCode);
		}
	}

	namespace
	{
		/**
		 * ONE ATOMIC STEP, AND THE NEW FILE IS NEVER THROWN AWAY. IFileManager::Move(Replace) deletes the destination first
		 * and then moves, so a move that failed -- anti-virus or an indexer holding the fresh temporary -- left NEITHER file,
		 * and the first version of this then deleted the temporary as well (Second Wonderland's review of 458f5448).
		 * MoveFileExW(MOVEFILE_REPLACE_EXISTING) swaps the file in one operation; when it fails, the previous save is
		 * untouched.
		 */
		bool Adopt(const FString& Path, const FString& Temp)
		{
			const FString FullPath = FPaths::ConvertRelativePathToFull(Path);
			const FString FullTemp = FPaths::ConvertRelativePathToFull(Temp);
#if PLATFORM_WINDOWS
			for (int32 Attempt = 0; Attempt < 5; ++Attempt)
			{
				if (::MoveFileExW(*FullTemp, *FullPath, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
				{
					return true;
				}
				FPlatformProcess::Sleep(0.05f);
			}
			UE_LOG(LogTemp, Warning, TEXT("WLSAVE could not replace %s (Windows error %u); the previous save is kept unchanged"),
				*FullPath, static_cast<uint32>(::GetLastError()));
			return false;
#else
			return IFileManager::Get().Move(*FullPath, *FullTemp, /*bReplace*/ true, /*bEvenIfReadOnly*/ true);
#endif
		}
	}

	bool SaveTextAtomically(const FString& Path, const FString& Text)
	{
		const FString Temp = Path + TEXT(".tmp");
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), /*Tree*/ true);
		if (!FFileHelper::SaveStringToFile(Text, *Temp))
		{
			UE_LOG(LogTemp, Warning, TEXT("WLSAVE could not write %s (is the folder writable?)"), *Temp);
			return false;
		}
		return Adopt(Path, Temp);
	}

	bool SaveBytesAtomically(const FString& Path, const TArray<uint8>& Bytes)
	{
		const FString Temp = Path + TEXT(".tmp");
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), /*Tree*/ true);
		if (!FFileHelper::SaveArrayToFile(Bytes, *Temp))
		{
			UE_LOG(LogTemp, Warning, TEXT("WLSAVE could not write %s (is the folder writable?)"), *Temp);
			return false;
		}
		return Adopt(Path, Temp);
	}

	void RecoverInterruptedSave(const FString& Path)
	{
		// WITH AN ATOMIC REPLACE THERE IS NO MOMENT WHEN THE SAVE IS MISSING, so a temporary left beside it comes from a
		// write that never completed -- possibly half a file. It is discarded, never adopted: adopting any non-empty
		// temporary could bring back a stale or half-written set (Second Wonderland's review).
		IFileManager& Files = IFileManager::Get();
		const FString Temp = Path + TEXT(".tmp");
		if (Files.FileExists(*Temp))
		{
			const bool bGone = Files.Delete(*Temp, /*RequireExists*/ false, /*EvenReadOnly*/ true, /*Quiet*/ true);
			UE_LOG(LogTemp, Display, TEXT("WLSAVE discarded an unfinished temporary beside %s: %s"), *Path, bGone ? TEXT("ok") : TEXT("FAILED"));
		}
	}

	bool IsSafeId(const FString& Text)
	{
		if (Text.IsEmpty() || Text.Len() > 64)
		{
			return false;
		}
		for (const TCHAR Char : Text)
		{
			if (!FChar::IsAlnum(Char) && Char != TEXT('_') && Char != TEXT('-') && Char != TEXT('.'))
			{
				return false;
			}
		}
		return true;
	}

	const TCHAR* AiUnavailableSentence()
	{
		return TEXT("Julius and the AI companions are not part of this private beta build: nothing here calls an AI service.");
	}

	namespace
	{
		FString WelcomePath()
		{
			return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("WelcomeSeen.txt"));
		}
	}

	bool HasSeenWelcome()
	{
		return IFileManager::Get().FileExists(*WelcomePath());
	}

	void MarkWelcomeSeen()
	{
		SaveTextAtomically(WelcomePath(), BuildLabel());
	}
}

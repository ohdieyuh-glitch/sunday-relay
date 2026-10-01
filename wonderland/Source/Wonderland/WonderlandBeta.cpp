// WONDERLAND -- the private beta's player/developer switch. See WonderlandBeta.h.
#include "WonderlandBeta.h"

#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/InputSettings.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"
#include "HAL/FileManager.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Widgets/SWindow.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandBeta, Log, All);

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

	namespace
	{
		bool Adopt(const FString& Path, const FString& Temp)
		{
			IFileManager& Files = IFileManager::Get();
			if (!Files.Move(*Path, *Temp, /*bReplace*/ true, /*bEvenIfReadOnly*/ true))
			{
				Files.Delete(*Temp);
				UE_LOG(LogWonderlandBeta, Warning, TEXT("WLSAVE could not move %s over %s; the previous file is kept"), *Temp, *Path);
				return false;
			}
			return true;
		}
	}

	bool SaveTextAtomically(const FString& Path, const FString& Text)
	{
		const FString Temp = Path + TEXT(".tmp");
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), /*Tree*/ true);
		if (!FFileHelper::SaveStringToFile(Text, *Temp))
		{
			UE_LOG(LogWonderlandBeta, Warning, TEXT("WLSAVE could not write %s (is the folder writable?)"), *Temp);
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
			UE_LOG(LogWonderlandBeta, Warning, TEXT("WLSAVE could not write %s (is the folder writable?)"), *Temp);
			return false;
		}
		return Adopt(Path, Temp);
	}

	void RecoverInterruptedSave(const FString& Path)
	{
		IFileManager& Files = IFileManager::Get();
		const FString Temp = Path + TEXT(".tmp");
		if (!Files.FileExists(*Path) && Files.FileExists(*Temp) && Files.FileSize(*Temp) > 0)
		{
			// The move was interrupted after the old file went and before the new one arrived: the temporary is the
			// complete newer save, so it is the one to keep.
			const bool bAdopted = Files.Move(*Path, *Temp, /*bReplace*/ true, /*bEvenIfReadOnly*/ true);
			UE_LOG(LogWonderlandBeta, Display, TEXT("WLSAVE %s was interrupted mid-save; the complete temporary was %s"),
				*Path, bAdopted ? TEXT("adopted") : TEXT("NOT adopted"));
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

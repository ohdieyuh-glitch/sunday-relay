// WONDERLAND -- the private beta's player/developer switch. See WonderlandBeta.h.
#include "WonderlandBeta.h"

#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/GameUserSettings.h"
#include "GameFramework/InputSettings.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"
#include "GameFramework/SaveGame.h"
#include "GenericPlatform/GenericPlatformFile.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformFileManager.h"
#include "HAL/PlatformProcess.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Crc.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "ProfilingDebugging/TraceAuxiliary.h"
#include "Widgets/SWindow.h"

#if PLATFORM_WINDOWS
#include "Windows/WindowsHWrapper.h"
#endif

// THE ENGINE'S TRACE CONTROL SERVER, CLOSED FROM OUTSIDE (private beta, Second Wonderland's RC2 finding). TraceLog opens
// an unauthenticated command port -- TCP 1985 on EVERY interface (WindowsTrace.cpp, TcpSocketListen binds INADDR_ANY) --
// in every build that is not Shipping, and nothing in the launcher engine's configuration turns it off. Its commands
// include "SendTo <host>", which streams the session's trace, log channel included, to any host that asks.
// Writer_ShutdownControl is TraceLog's own close of that listener (Control.cpp). It is not exported from the editor's
// TraceLog DLL, but the game is ONE monolithic executable, where it links like any other function -- hence the guard.
#define WONDERLAND_CLOSE_TRACE_CONTROL (IS_MONOLITHIC && !WITH_EDITOR && !UE_BUILD_SHIPPING && PLATFORM_WINDOWS)
#if WONDERLAND_CLOSE_TRACE_CONTROL
namespace UE { namespace Trace { namespace Private {
	void Writer_ShutdownControl();
} } }
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

	void MigrateWindowMode()
	{
		if (GIsEditor || GEngine == nullptr)
		{
			return;
		}
		UGameUserSettings* Settings = GEngine->GetGameUserSettings();
		if (Settings != nullptr && Settings->GetFullscreenMode() == EWindowMode::Fullscreen)
		{
			Settings->SetFullscreenMode(EWindowMode::WindowedFullscreen);
			Settings->ApplySettings(false);
			Settings->SaveSettings();
			UE_LOG(LogTemp, Display, TEXT("WLSETTINGS a saved exclusive FULLSCREEN is now BORDERLESS (exclusive mode came up as a 640x480 popup)"));
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

#if WONDERLAND_CLOSE_TRACE_CONTROL
		// NO NETWORK LISTENER IN A PLAYER'S SESSION. A packaged game runs the trace without a worker thread: it updates
		// from FCoreDelegates::OnEndFrame (FTraceAuxiliary's FrameBasedUpdate), so the control port opens on the game
		// thread at the end of the FIRST frame -- after this runs, which is why it cannot simply be prevented, and why a
		// first launch from a new folder still raises the Windows Firewall prompt once. This core ticker, early in every
		// frame, closes the listener the frame after it opens. The trace's next accept on the closed handle fails, and
		// Writer_ControlAccept then marks control FAILED, a state Writer_UpdateControl never retries: the port is gone for
		// the rest of the session, also for a tester who clicked Allow. NEVER WHILE A TRACE WORKER THREAD MAY EXIST: the
		// close is not synchronised with a worker's update (Second Wonderland's review), and the engine starts one when a
		// trace is asked for on the command line or Unreal Insights connects -- an outside tester does neither.
		const TCHAR* const CommandLine = FCommandLine::Get();
		FString TraceArgument;
		const bool bTraceAskedFor = FParse::Param(CommandLine, TEXT("trace")) || FParse::Value(CommandLine, TEXT("-trace="), TraceArgument)
			|| FParse::Value(CommandLine, TEXT("-tracehost="), TraceArgument) || FParse::Value(CommandLine, TEXT("-tracefile="), TraceArgument)
			|| FParse::Param(CommandLine, TEXT("tracefile"));
		// HOW LONG IT KEEPS CLOSING is counted from its OWN first tick, never from here: this runs at game-instance init,
		// before the startup map loads, and the core ticker does not tick during that load. A window counted from here
		// could expire on a slow PC before the port ever opened (Second Wonderland's review). After its first tick it keeps
		// going for at least 600 ticks AND 30 seconds; once closed, the call is one check of a static, so the margin is free.
		static bool bArmed = false;
		if (!bArmed && !bTraceAskedFor)
		{
			bArmed = true;
			TSharedRef<double> FirstTick = MakeShared<double>(-1.0);
			TSharedRef<int32> Ticks = MakeShared<int32>(0);
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([FirstTick, Ticks](float)
			{
				if (FTraceAuxiliary::IsConnected())
				{
					return false;
				}
				UE::Trace::Private::Writer_ShutdownControl();
				const double Now = FPlatformTime::Seconds();
				if (*FirstTick < 0.0)
				{
					*FirstTick = Now;
				}
				if (++(*Ticks) < 600 || Now - *FirstTick < 30.0)
				{
					return true;
				}
				UE_LOG(LogTemp, Display, TEXT("WLBETA trace control port closed for this player session (no network listener; %d ticks)"), *Ticks);
				return false;
			}));
		}
#endif
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
			// Up to about a second: an anti-virus scan of the fresh temporary usually lets go well within that.
			for (int32 Attempt = 0; Attempt < 8; ++Attempt)
			{
				if (::MoveFileExW(*FullTemp, *FullPath, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
				{
					return true;
				}
				FPlatformProcess::Sleep(0.1f);
			}
			UE_LOG(LogTemp, Warning, TEXT("WLSAVE could not replace %s (Windows error %u); the previous save is kept unchanged"),
				*FullPath, static_cast<uint32>(::GetLastError()));
			return false;
#else
			return IFileManager::Get().Move(*FullPath, *FullTemp, /*bReplace*/ true, /*bEvenIfReadOnly*/ true);
#endif
		}

		/**
		 * THE TEMPORARY'S BYTES ON THE DISK BEFORE THE SWAP. The rename is atomic, but without this the new name could
		 * reach the disk before the data does, and a power cut right after a save would leave a garbage file under it
		 * (Second Wonderland's review). FlushFileBuffers flushes the file's cached data whichever handle wrote it.
		 */
		void FlushToDisk(const FString& Temp)
		{
			TUniquePtr<IFileHandle> Handle(FPlatformFileManager::Get().GetPlatformFile().OpenWrite(*Temp, /*bAppend*/ true));
			if (Handle.IsValid())
			{
				Handle->Flush(/*bFullFlush*/ true);
			}
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
		FlushToDisk(Temp);
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
		FlushToDisk(Temp);
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

	namespace
	{
		// THE SEAL, after the save's own bytes: "WLSEAL01", then their length and their CRC-32, little-endian. 16 bytes.
		const uint8 SealTag[8] = { 'W', 'L', 'S', 'E', 'A', 'L', '0', '1' };
		constexpr int32 SealSize = 16;
		// No save of this game comes near this; a bigger file is refused before it is read into memory at all.
		constexpr int64 MaxSaveBytes = 32LL * 1024 * 1024;

		void PutU32(TArray<uint8>& Bytes, uint32 Value)
		{
			for (int32 Shift = 0; Shift < 32; Shift += 8)
			{
				Bytes.Add(static_cast<uint8>((Value >> Shift) & 0xFFu));
			}
		}

		uint32 GetU32(const uint8* At)
		{
			return static_cast<uint32>(At[0]) | (static_cast<uint32>(At[1]) << 8) | (static_cast<uint32>(At[2]) << 16)
				| (static_cast<uint32>(At[3]) << 24);
		}

		/**
		 * A SAVE FROM BEFORE THE SEAL, recognised by its header: the engine's "GVAS" tag first, then -- before any
		 * property -- the class path as a length-prefixed string. The one shape of garbage that crashes the loader before
		 * it reads a single property is a wild class name; a file that names Expected exactly cannot be that.
		 */
		bool LooksLikeUnsealedSave(const TArray<uint8>& File, const UClass* Expected)
		{
			if (Expected == nullptr || File.Num() < 8 || File[0] != 'G' || File[1] != 'V' || File[2] != 'A' || File[3] != 'S')
			{
				return false;
			}
			const FString ClassPath = Expected->GetPathName();
			TArray<uint8> Needle;
			PutU32(Needle, static_cast<uint32>(ClassPath.Len() + 1));
			for (const TCHAR Char : ClassPath)
			{
				Needle.Add(static_cast<uint8>(Char));
			}
			Needle.Add(0);
			// The header is the tag, versions and the engine's custom-version list: a few kilobytes at most.
			const int32 Window = FMath::Min(File.Num(), 64 * 1024);
			for (int32 At = 4; At + Needle.Num() <= Window; ++At)
			{
				if (FMemory::Memcmp(File.GetData() + At, Needle.GetData(), Needle.Num()) == 0)
				{
					return true;
				}
			}
			return false;
		}
	}

	bool SaveSealedGame(USaveGame* Save, const FString& Path)
	{
		TArray<uint8> Bytes;
		if (Save == nullptr || !UGameplayStatics::SaveGameToMemory(Save, Bytes) || Bytes.Num() == 0)
		{
			UE_LOG(LogTemp, Warning, TEXT("WLSAVE could not serialise the save for %s"), *Path);
			return false;
		}
		const uint32 Length = static_cast<uint32>(Bytes.Num());
		const uint32 Crc = FCrc::MemCrc32(Bytes.GetData(), Bytes.Num());
		Bytes.Append(SealTag, UE_ARRAY_COUNT(SealTag));
		PutU32(Bytes, Length);
		PutU32(Bytes, Crc);
		return SaveBytesAtomically(Path, Bytes);
	}

	USaveGame* LoadSealedGame(const FString& Path, UClass* Expected, FString& OutWhy)
	{
		OutWhy.Reset();
		IFileManager& Files = IFileManager::Get();
		if (!Files.FileExists(*Path))
		{
			return nullptr;
		}
		const int64 Size = Files.FileSize(*Path);
		if (Size <= 0 || Size > MaxSaveBytes)
		{
			OutWhy = FString::Printf(TEXT("it is %lld bytes"), Size);
			return nullptr;
		}
		TArray<uint8> File;
		if (!FFileHelper::LoadFileToArray(File, *Path))
		{
			OutWhy = TEXT("it could not be read");
			return nullptr;
		}
		TArray<uint8> Payload;
		const uint8* Seal = File.Num() > SealSize ? File.GetData() + File.Num() - SealSize : nullptr;
		if (Seal != nullptr && FMemory::Memcmp(Seal, SealTag, UE_ARRAY_COUNT(SealTag)) == 0)
		{
			const uint32 Length = GetU32(Seal + 8);
			const uint32 Crc = GetU32(Seal + 12);
			if (static_cast<int64>(Length) != static_cast<int64>(File.Num() - SealSize))
			{
				OutWhy = FString::Printf(TEXT("its seal names %u bytes but %d precede it"), Length, File.Num() - SealSize);
				return nullptr;
			}
			if (FCrc::MemCrc32(File.GetData(), static_cast<int32>(Length)) != Crc)
			{
				OutWhy = TEXT("its bytes no longer match their seal");
				return nullptr;
			}
			Payload.Append(File.GetData(), static_cast<int32>(Length));
		}
		// AN UNSEALED FILE IS A DEVELOPER'S ONLY. Every save a player's build has ever written is sealed (the beta's first
		// sealed build is RC3), so in a player's session an unsealed file is refused outright and nothing unchecked reaches
		// the loader. The editor and -wldev still read a pre-seal file whose header names the expected class -- the
		// founder's own layouts and contracts -- and the next save seals it (Second Wonderland's review).
		else if (IsDeveloperSession() && LooksLikeUnsealedSave(File, Expected))
		{
			UE_LOG(LogTemp, Display, TEXT("WLSAVE %s was written before saves were sealed; read once, the next save seals it"), *Path);
			Payload = MoveTemp(File);
		}
		else
		{
			OutWhy = TEXT("it carries no seal and no save header this build recognises");
			return nullptr;
		}
		USaveGame* Loaded = UGameplayStatics::LoadGameFromMemory(Payload);
		if (Loaded == nullptr || Expected == nullptr || !Loaded->IsA(Expected))
		{
			OutWhy = TEXT("it does not hold the expected save");
			return nullptr;
		}
		return Loaded;
	}

	FString SetAsideRefusedSave(const FString& Path)
	{
		// THE FILE NAME ONLY is rewritten, never the folders above it.
		const FString Aside = FPaths::Combine(FPaths::GetPath(Path), FString::Printf(TEXT("%s.refused-%s%s"),
			*FPaths::GetBaseFilename(Path), *FDateTime::UtcNow().ToString(TEXT("%Y%m%d-%H%M%S")),
			*FPaths::GetExtension(Path, /*bIncludeDot*/ true)));
		return IFileManager::Get().Move(*Aside, *Path, /*bReplace*/ true, /*bEvenIfReadOnly*/ true) ? Aside : FString();
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

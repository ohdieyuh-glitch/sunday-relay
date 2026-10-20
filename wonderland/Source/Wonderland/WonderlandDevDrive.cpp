// WDEV 2026-10-19: DEV-ONLY scripted drive for automated rehearsals (never in a Shipping build, and refused without -wldev).
// It lets a test harness control a game it launched WITHOUT any operating-system input (no SendInput, no focus, nothing taken from the person at the keyboard):
//   wl.Dev.CmdFile <path>   follow a text file: every line appended to it is executed as a console command (lines are read as they are written)
//   wl.Dev.Key <name> <down|up>   press / release a key THROUGH the game's own input path (the player controller's InputKey): W A S D Space LeftShift ... exactly what the real bindings see
//   wl.Dev.Hold <name> <seconds>  press a key and release it that long after
//   wl.Dev.Move <fwd> <right> <seconds>   walk (camera-relative, like W/A/S/D) for that long
//   wl.Dev.Jump [seconds]   press jump and hold it that long (default 0.15, the hold-to-rise of the key)
//   wl.Dev.Yaw <degrees>    face the controller (and so the walk) that way
//   wl.Dev.Tp <x> <y> <z>   place the pawn (a teleport; the remote figure sees a normal report)
//   wl.Dev.Social <operation> <subject>   the SAME action a hub button presses (UWonderlandUiSubsystem::RequestSocialAction: requests.send/accept/decline/cancel, friends.remove, blocks.add (the first press only warns, a second confirms a shared-party block), mutes.set, reports.file, presence.set, conversations.open ...)
//   wl.Dev.Say <text>   submit a line to the Julius terminal exactly as typing it and pressing Enter does (UWonderlandUiSubsystem::SubmitTerminalLine): /social, /handoff, a Mission Contract ...
//   wl.Dev.Go <id>   go where a nav-bar shortcut goes (NavigateTo: agent, missions, brain, commands, menu)
//   wl.Dev.Voice <command> [subject]   the hub voice buttons' handler (connect, disconnect, mic.mute, local.mute ...)
//   wl.Dev.Watch   the Missions panel WATCH A SIMULATED MISSION button's call (PlayScenario D, 10 s per event)
//   wl.Dev.Pos              one log line: WLDEV pos x y z yaw
// Everything is log-visible (WLDEV lines). A developer tool: not a gameplay path, no wire change.
#include "CoreMinimal.h"

#if !UE_BUILD_SHIPPING
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/Character.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"
#include "InputCoreTypes.h"
#include "HAL/FileManager.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Serialization/Archive.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandUiSubsystem.h"

namespace WonderlandDevDriveDetail
{
	struct FDriveState
	{
		FTSTicker::FDelegateHandle Handle;
		FString FilePath;
		int64 Offset = 0;
		FString Partial;
		double MoveUntil = 0.0;
		float MoveForward = 0.0f;
		float MoveRight = 0.0f;
		double JumpUntil = 0.0;
		bool bJumping = false;
		struct FRelease { FKey Key; double At = 0.0; };
		TArray<FRelease> Releases;
	};

	FDriveState& DriveState()
	{
		static FDriveState S;
		return S;
	}

	bool DeveloperSession()
	{
		return FParse::Param(FCommandLine::Get(), TEXT("wldev"));
	}

	UWorld* DriveGameWorld()
	{
		if (GEngine == nullptr)
		{
			return nullptr;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			if (Context.WorldType == EWorldType::Game && Context.World() != nullptr)
			{
				return Context.World();
			}
		}
		return nullptr;
	}

	ACharacter* DriveLocalCharacter(UWorld* World)
	{
		APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		return Controller != nullptr ? Cast<ACharacter>(Controller->GetPawn()) : nullptr;
	}

	void ReadNewLines(FDriveState& S, UWorld* World)
	{
		if (S.FilePath.IsEmpty())
		{
			return;
		}
		const int64 Size = IFileManager::Get().FileSize(*S.FilePath);
		if (Size <= S.Offset)
		{
			return;
		}
		TUniquePtr<FArchive> Reader(IFileManager::Get().CreateFileReader(*S.FilePath, FILEREAD_AllowWrite));
		if (!Reader)
		{
			return;
		}
		const int64 Take = Size - S.Offset;
		TArray<uint8> Bytes;
		Bytes.SetNumUninitialized(static_cast<int32>(Take));
		Reader->Seek(S.Offset);
		Reader->Serialize(Bytes.GetData(), Take);
		S.Offset = Size;
		Bytes.Add(0);
		S.Partial += FString(UTF8_TO_TCHAR(reinterpret_cast<const char*>(Bytes.GetData())));
		int32 Newline = INDEX_NONE;
		while (S.Partial.FindChar(TEXT('\n'), Newline))
		{
			const FString Line = S.Partial.Left(Newline).TrimStartAndEnd();
			S.Partial.RightChopInline(Newline + 1);
			if (!Line.IsEmpty() && !Line.StartsWith(TEXT("#")))
			{
				UE_LOG(LogTemp, Display, TEXT("WLDEV exec: %s"), *Line);
				GEngine->Exec(World, *Line);
			}
		}
	}

	bool DriveTick(float)
	{
		FDriveState& S = DriveState();
		UWorld* World = DriveGameWorld();
		if (World == nullptr)
		{
			return true;
		}
		ReadNewLines(S, World);
		if (S.Releases.Num() > 0)
		{
			APlayerController* Pc = World->GetFirstPlayerController();
			const double At = FPlatformTime::Seconds();
			for (int32 I = S.Releases.Num() - 1; I >= 0; --I)
			{
				if (At >= S.Releases[I].At)
				{
					if (Pc != nullptr)
					{
						Pc->InputKey(FInputKeyParams(S.Releases[I].Key, IE_Released, 0.0, false));
					}
					S.Releases.RemoveAtSwap(I);
				}
			}
		}
		ACharacter* Dog = DriveLocalCharacter(World);
		const double Now = FPlatformTime::Seconds();
		if (Dog != nullptr && Now < S.MoveUntil)
		{
			const FRotator Yaw(0.0, Dog->GetControlRotation().Yaw, 0.0);
			Dog->AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::X), S.MoveForward);
			Dog->AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::Y), S.MoveRight);
		}
		if (Dog != nullptr && S.bJumping)
		{
			if (Now < S.JumpUntil)
			{
				Dog->Jump();
			}
			else
			{
				Dog->StopJumping();
				S.bJumping = false;
			}
		}
		return true;
	}

	void EnsureDriveTicker()
	{
		FDriveState& S = DriveState();
		if (!S.Handle.IsValid())
		{
			S.Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&DriveTick), 0.02f);
		}
	}

	bool DriveRefused()
	{
		if (!DeveloperSession())
		{
			UE_LOG(LogTemp, Display, TEXT("WLDEV refused: wl.Dev.* needs a developer session (-wldev)"));
			return true;
		}
		return false;
	}

	FAutoConsoleCommand GDevCmdFile(
		TEXT("wl.Dev.CmdFile"),
		TEXT("DEV (-wldev): wl.Dev.CmdFile <path> follows a text file and runs each line appended to it as a console command."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 1)
			{
				return;
			}
			FDriveState& S = DriveState();
			S.FilePath = Args[0];
			S.Offset = 0;
			S.Partial.Reset();
			EnsureDriveTicker();
			UE_LOG(LogTemp, Display, TEXT("WLDEV cmdfile following %s"), *S.FilePath);
		}));

	FAutoConsoleCommand GDevMove(
		TEXT("wl.Dev.Move"),
		TEXT("DEV (-wldev): wl.Dev.Move <forward -1..1> <right -1..1> <seconds> walks like W/A/S/D for that long."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 3)
			{
				return;
			}
			FDriveState& S = DriveState();
			S.MoveForward = FMath::Clamp(FCString::Atof(*Args[0]), -1.0f, 1.0f);
			S.MoveRight = FMath::Clamp(FCString::Atof(*Args[1]), -1.0f, 1.0f);
			S.MoveUntil = FPlatformTime::Seconds() + FMath::Clamp(FCString::Atod(*Args[2]), 0.0, 120.0);
			EnsureDriveTicker();
			UE_LOG(LogTemp, Display, TEXT("WLDEV move fwd=%.2f right=%.2f for %s s"), S.MoveForward, S.MoveRight, *Args[2]);
		}));

	FAutoConsoleCommand GDevJump(
		TEXT("wl.Dev.Jump"),
		TEXT("DEV (-wldev): wl.Dev.Jump [seconds] presses jump and holds it that long (default 0.15)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused())
			{
				return;
			}
			FDriveState& S = DriveState();
			S.JumpUntil = FPlatformTime::Seconds() + (Args.Num() > 0 ? FMath::Clamp(FCString::Atod(*Args[0]), 0.02, 3.0) : 0.15);
			S.bJumping = true;
			EnsureDriveTicker();
			UE_LOG(LogTemp, Display, TEXT("WLDEV jump"));
		}));


	FAutoConsoleCommand GDevKey(
		TEXT("wl.Dev.Key"),
		TEXT("DEV (-wldev): wl.Dev.Key <name> <down|up> sends a key through the player controller's input path (the game's real bindings see it)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 2)
			{
				return;
			}
			UWorld* World = DriveGameWorld();
			APlayerController* Pc = World != nullptr ? World->GetFirstPlayerController() : nullptr;
			const FKey Key(*Args[0]);
			if (Pc != nullptr && Key.IsValid())
			{
				const bool bDown = Args[1].Equals(TEXT("down"), ESearchCase::IgnoreCase);
				Pc->InputKey(FInputKeyParams(Key, bDown ? IE_Pressed : IE_Released, bDown ? 1.0 : 0.0, false));
				EnsureDriveTicker();
				UE_LOG(LogTemp, Display, TEXT("WLDEV key %s %s"), *Args[0], bDown ? TEXT("down") : TEXT("up"));
			}
		}));

	FAutoConsoleCommand GDevHold(
		TEXT("wl.Dev.Hold"),
		TEXT("DEV (-wldev): wl.Dev.Hold <name> <seconds> presses a key through the input path and releases it that long after."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 2)
			{
				return;
			}
			UWorld* World = DriveGameWorld();
			APlayerController* Pc = World != nullptr ? World->GetFirstPlayerController() : nullptr;
			const FKey Key(*Args[0]);
			if (Pc != nullptr && Key.IsValid())
			{
				Pc->InputKey(FInputKeyParams(Key, IE_Pressed, 1.0, false));
				FDriveState::FRelease Release;
				Release.Key = Key;
				Release.At = FPlatformTime::Seconds() + FMath::Clamp(FCString::Atod(*Args[1]), 0.02, 120.0);
				DriveState().Releases.Add(Release);
				EnsureDriveTicker();
				UE_LOG(LogTemp, Display, TEXT("WLDEV hold %s for %s s"), *Args[0], *Args[1]);
			}
		}));

	FAutoConsoleCommand GDevYaw(
		TEXT("wl.Dev.Yaw"),
		TEXT("DEV (-wldev): wl.Dev.Yaw <degrees> turns the controller (and so the walk) that way."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 1)
			{
				return;
			}
			UWorld* World = DriveGameWorld();
			APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
			if (Controller != nullptr)
			{
				FRotator Rotation = Controller->GetControlRotation();
				Rotation.Yaw = FCString::Atod(*Args[0]);
				Controller->SetControlRotation(Rotation);
				UE_LOG(LogTemp, Display, TEXT("WLDEV yaw %.1f"), Rotation.Yaw);
			}
		}));

	FAutoConsoleCommand GDevTp(
		TEXT("wl.Dev.Tp"),
		TEXT("DEV (-wldev): wl.Dev.Tp <x> <y> <z> places the pawn there (a teleport)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 3)
			{
				return;
			}
			ACharacter* Dog = DriveLocalCharacter(DriveGameWorld());
			if (Dog != nullptr)
			{
				Dog->SetActorLocation(FVector(FCString::Atod(*Args[0]), FCString::Atod(*Args[1]), FCString::Atod(*Args[2])), false, nullptr, ETeleportType::TeleportPhysics);
				UE_LOG(LogTemp, Display, TEXT("WLDEV tp %s %s %s"), *Args[0], *Args[1], *Args[2]);
			}
		}));

	FAutoConsoleCommand GDevSocial(
		TEXT("wl.Dev.Social"),
		TEXT("DEV (-wldev): wl.Dev.Social <operation> <subject> presses the hub button's action (the real UI action path), e.g. wl.Dev.Social requests.decline <requestId>."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 1)
			{
				return;
			}
			UWorld* World = DriveGameWorld();
			ULocalPlayer* Player = World != nullptr ? World->GetFirstLocalPlayerFromController() : nullptr;
			UWonderlandUiSubsystem* Ui = Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
			if (Ui != nullptr)
			{
				UE_LOG(LogTemp, Display, TEXT("WLDEV social %s %s"), *Args[0], Args.Num() > 1 ? *Args[1] : TEXT(""));
				Ui->RequestSocialAction(Args[0], Args.Num() > 1 ? Args[1] : FString());
			}
			else
			{
				UE_LOG(LogTemp, Display, TEXT("WLDEV social: no UI subsystem"));
			}
		}));

	UWonderlandUiSubsystem* DriveUi()
	{
		UWorld* World = DriveGameWorld();
		ULocalPlayer* Player = World != nullptr ? World->GetFirstLocalPlayerFromController() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	FAutoConsoleCommand GDevSay(
		TEXT("wl.Dev.Say"),
		TEXT("DEV (-wldev): wl.Dev.Say <text> submits a line to the Julius terminal exactly as typing it and pressing Enter does."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 1)
			{
				return;
			}
			if (UWonderlandUiSubsystem* Ui = DriveUi())
			{
				const FString Text = FString::Join(Args, TEXT(" "));
				UE_LOG(LogTemp, Display, TEXT("WLDEV say: %s"), *Text.Left(80));
				Ui->SubmitTerminalLine(Text);
			}
		}));

	FAutoConsoleCommand GDevGo(
		TEXT("wl.Dev.Go"),
		TEXT("DEV (-wldev): wl.Dev.Go <id> goes where a nav-bar shortcut goes (agent, missions, brain, commands, menu)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 1)
			{
				return;
			}
			if (UWonderlandUiSubsystem* Ui = DriveUi())
			{
				UE_LOG(LogTemp, Display, TEXT("WLDEV go %s: %s"), *Args[0], Ui->NavigateTo(FName(*Args[0])) ? TEXT("ok") : TEXT("unknown shortcut"));
			}
		}));

	FAutoConsoleCommand GDevVoice(
		TEXT("wl.Dev.Voice"),
		TEXT("DEV (-wldev): wl.Dev.Voice <command> [subject] is the hub voice buttons' handler (connect, disconnect, mic.mute, local.mute ...)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (DriveRefused() || Args.Num() < 1)
			{
				return;
			}
			if (UWonderlandUiSubsystem* Ui = DriveUi())
			{
				UE_LOG(LogTemp, Display, TEXT("WLDEV voice %s"), *Args[0]);
				Ui->HandleVoiceCommand(Args[0], Args.Num() > 1 ? Args[1] : FString());
			}
		}));

	FAutoConsoleCommand GDevWatch(
		TEXT("wl.Dev.Watch"),
		TEXT("DEV (-wldev): wl.Dev.Watch is the Missions panel's WATCH A SIMULATED MISSION button (PlayScenario D, 10 s per event)."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>&)
		{
			if (DriveRefused())
			{
				return;
			}
			UWorld* World = DriveGameWorld();
			ULocalPlayer* Player = World != nullptr ? World->GetFirstLocalPlayerFromController() : nullptr;
			if (UWonderlandMissionSubsystem* Missions = Player != nullptr ? Player->GetSubsystem<UWonderlandMissionSubsystem>() : nullptr)
			{
				const bool bStarted = Missions->PlayScenario(FName(TEXT("D")), 10.0f);
				UE_LOG(LogTemp, Display, TEXT("WLDEV watch: simulated mission %s"), bStarted ? TEXT("started") : TEXT("REFUSED"));
			}
		}));

	FAutoConsoleCommand GDevPos(
		TEXT("wl.Dev.Pos"),
		TEXT("DEV (-wldev): one log line with the pawn's position and facing."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			if (DriveRefused())   // RV-DEV-F6: the same -wldev rule as every other wl.Dev.* command
			{
				return;
			}
			ACharacter* Dog = DriveLocalCharacter(DriveGameWorld());
			if (Dog != nullptr)
			{
				const FVector P = Dog->GetActorLocation();
				UE_LOG(LogTemp, Display, TEXT("WLDEV pos %.1f %.1f %.1f yaw %.1f"), P.X, P.Y, P.Z, Dog->GetActorRotation().Yaw);
			}
		}));
}
#endif

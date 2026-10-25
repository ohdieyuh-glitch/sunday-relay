// QA event commands. Not registered in shipping builds.
// Equip and Return are the public functions on WonderlandHandoffDirector.h.
// This file does not change the director.
#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/DateTime.h"
#include "WonderlandBeta.h"
#include "WonderlandHandoffDirector.h"
#include "WonderlandHandoffWire.h"
#include "WonderlandQaFormat.h"
#include "WonderlandSocialLive.h"
#include "WonderlandSocialReconnectPolicy.h"
#include "WonderlandSocialSubsystem.h"
#include "WonderlandSidekicks.h"

#if !UE_BUILD_SHIPPING

namespace WonderlandQaEventCommands
{
	ULocalPlayer* QaConsolePlayer(UWorld* World)
	{
		return World != nullptr ? World->GetFirstLocalPlayerFromController() : nullptr;
	}

	void QaPlain(const char* Text)
	{
		UE_LOG(LogTemp, Display, TEXT("%s"), *FString(ANSI_TO_TCHAR(Text)));
	}

	void QaEmit(const std::string& Line)
	{
		if (!Line.empty())
		{
			UE_LOG(LogTemp, Display, TEXT("%s"), *FString(ANSI_TO_TCHAR(Line.c_str())));
		}
	}

	int64 QaNowMs()
	{
		const FDateTime Now = FDateTime::UtcNow();
		return static_cast<int64>(Now.ToUnixTimestamp()) * 1000 + static_cast<int64>(Now.GetMillisecond());
	}

	int32 ReadPolicy(const TCHAR* Name, bool& bFound)
	{
		IConsoleVariable* Variable = IConsoleManager::Get().FindConsoleVariable(Name);
		bFound = Variable != nullptr;
		return bFound ? Variable->GetInt() : 0;
	}

	WonderlandQa::FDropFacts QaDropFacts(UWorld* World)
	{
		WonderlandQa::FDropFacts Facts;
		Facts.TsMs = QaNowMs();
		Facts.SessionSource = "none";
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		if (UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr)
		{
			if (FWonderlandSocialLiveService* Live = Social->GetLive())
			{
				const FWonderlandWorldView& View = Live->GetWorldView();
				if (View.bInWorld && !View.ContextId.IsEmpty())
				{
					Facts.bHasSession = true;
					Facts.SessionId = TCHAR_TO_UTF8(*View.ContextId);
					Facts.SessionSource = "world_context";
				}
			}
			if (!Facts.bHasSession)
			{
				if (const FWonderlandSocialSnapshot* Snap = Social->GetSnapshot())
				{
					if (!Snap->ViewerId.IsEmpty())
					{
						Facts.bHasSession = true;
						Facts.SessionId = TCHAR_TO_UTF8(*Snap->ViewerId);
						Facts.SessionSource = "viewer";
					}
				}
			}
		}
		if (const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr)
		{
			if (const APawn* Pawn = Controller->GetPawn())
			{
				const FVector At = Pawn->GetActorLocation();
				Facts.bHasPose = true;
				Facts.X = At.X;
				Facts.Y = At.Y;
				Facts.Z = At.Z;
				Facts.Yaw = Pawn->GetActorRotation().Yaw;
			}
		}
		if (UWonderlandSidekickSubsystem* Sidekicks = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr)
		{
			Facts.bHasPhase = true;
			Facts.Phase = static_cast<int>(Sidekicks->GetMissionHandoff().GetState());
		}
		if (WonderlandQa::HasOutstandingActivation())
		{
			Facts.bHasActivationCorr = true;
			Facts.ActivationCorr = WonderlandQa::OutstandingActivationCorr();
		}
		bool bFound404 = false;
		bool bFoundKeep = false;
		bool bFoundLeave = false;
		const int32 Rejoin404 = ReadPolicy(TEXT("wl.Remote.Rejoin404Replan"), bFound404);
		const int32 RejoinKeep = ReadPolicy(TEXT("wl.Remote.RejoinKeepTarget"), bFoundKeep);
		const int32 LeaveRetry = ReadPolicy(TEXT("wl.Remote.LeaveRetry"), bFoundLeave);
		Facts.bHasRejoin404 = bFound404;
		Facts.Rejoin404 = Rejoin404;
		Facts.bHasRejoinKeep = bFoundKeep;
		Facts.RejoinKeep = RejoinKeep;
		Facts.bHasLeaveRetry = bFoundLeave;
		Facts.LeaveRetry = LeaveRetry;
		if (bFoundLeave)
		{
			Facts.bHasLeaveWould = true;
			Facts.bLeaveRetryWouldApply = WonderlandSocialReconnectPolicy::ShouldRetryLeave(0, false, LeaveRetry != 0);
		}
		return Facts;
	}

	/**
	 * DEVELOPER SESSIONS ONLY (editor or -wldev), like wl.Qa.FollowRemote and the J1 paid doors (REVIEW #456 H1): Development
	 * packages reach players and -ExecCmds reaches every command there. Measured before this gate: a player-session launch with
	 * "wl.Qa.Enabled 1,wl.Qa.Mission.Handoff equip" equipped the swords and the handoff was saved (restored HELD next launch).
	 */
	bool QaDeveloperDoor(const char* Name)
	{
		if (WonderlandBeta::IsDeveloperSession()) { return true; }
		UE_LOG(LogTemp, Display, TEXT("%s: developer sessions only (-wldev)"), UTF8_TO_TCHAR(Name));
		return false;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaEnabledCommand(
		TEXT("wl.Qa.Enabled"),
		TEXT("QA event line. No argument prints on or off. 1 turns it on for this process. 0 turns it off. Not in shipping builds."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld*)
		{
			if (!QaDeveloperDoor("wl.Qa.Enabled")) { return; }
			if (Args.Num() == 0)
			{
				QaPlain(WonderlandQa::IsEnabled() ? "QA instrumentation on" : "QA instrumentation off");
				return;
			}
			if (Args[0] != TEXT("0") && Args[0] != TEXT("1"))
			{
				QaPlain("QA instrumentation expects 0 or 1");
				return;
			}
			const bool bOn = Args[0] == TEXT("1");
			WonderlandQa::SetEnabled(bOn);
			WonderlandHandoffWire::SetQaReplication(bOn);
			QaPlain(bOn ? "QA instrumentation on" : "QA instrumentation off");
		}));

	FAutoConsoleCommandWithWorldAndArgs GQaHandoffCommand(
		TEXT("wl.Qa.Mission.Handoff"),
		TEXT("QA: take up the swords, or 'end' to give them back, through the existing handoff. Does not start a mission. Not in shipping builds."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (!QaDeveloperDoor("wl.Qa.Mission.Handoff")) { return; }
			if (!WonderlandQa::IsEnabled())
			{
				QaPlain(WonderlandQa::DisabledRefusal());
				return;
			}
			// Exactly one of the two words: a typo ("return", "off") must not silently equip.
			const bool bEquip = Args.Num() == 0 || Args[0].Equals(TEXT("equip"), ESearchCase::IgnoreCase);
			const bool bEnd = Args.Num() > 0 && Args[0].Equals(TEXT("end"), ESearchCase::IgnoreCase);
			if (!bEquip && !bEnd)
			{
				QaPlain("usage: wl.Qa.Mission.Handoff [equip|end]");
				return;
			}
			FString Said;
			if (bEnd)
			{
				WonderlandHandoffDirector::Return(QaConsolePlayer(World), Said);
			}
			else
			{
				WonderlandHandoffDirector::Equip(QaConsolePlayer(World), Said);
			}
			UE_LOG(LogTemp, Display, TEXT("WLHANDOFF %s"), *Said);
		}));

	FAutoConsoleCommandWithWorldAndArgs GQaNetDropCommand(
		TEXT("wl.Qa.Net.Drop"),
		TEXT("QA: record a local drop and the snapshot already on this client. Seconds default 2, clamped 0 to 30. Not in shipping builds."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (!QaDeveloperDoor("wl.Qa.Net.Drop")) { return; }
			if (!WonderlandQa::IsEnabled())
			{
				QaPlain(WonderlandQa::DisabledRefusal());
				return;
			}
			float Seconds = 2.0f;
			if (Args.Num() > 0)
			{
				Seconds = FCString::Atof(*Args[0]);
			}
			Seconds = FMath::Clamp(Seconds, 0.0f, 30.0f);
			const WonderlandQa::FDropFacts Facts = QaDropFacts(World);
			QaEmit(WonderlandQa::DropLine(Facts, WonderlandQa::kDisconnect, false));
			QaEmit(WonderlandQa::DropLine(Facts, WonderlandQa::kReconnectAttempt, false));
			auto Finish = [Facts]()
			{
				WonderlandQa::FDropFacts Later = Facts;
				Later.TsMs = QaNowMs();
				QaEmit(WonderlandQa::DropLine(Later, WonderlandQa::kReconnected, false));
				QaEmit(WonderlandQa::DropLine(Later, WonderlandQa::kStateRestored, true));
				return false;
			};
			if (Seconds <= 0.0f)
			{
				Finish();
				return;
			}
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Finish](float)
			{
				return Finish();
			}), Seconds);
		}));
}

#endif

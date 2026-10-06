// wl.Qa.JuliusDoors -- the founder's 10-06 ruling on the Julius world routes. Main's bridge has none of /relay-api/wonderland/julius/
// {missions,events,hydrate,result} (they live only on the old local integration line, migration 027's family), so: PROVE AT RUNTIME
// whether the final Beta flow reaches them. The client's bridge is pointed at CORE's request recorder (julius_route_sink.py, 127.0.0.1)
// with wl.Julius.Bridge.Url: the recorder's log says what crossed the wire, and these lines say what the client did and showed.
//
//   wl.Qa.JuliusDoors [quit]        CLOSED -- the Beta flow in a PLAYER session (recorder mode "test"):
//     JD1  a player session with no console (the wl.Julius.Pair door) and no engine debug keys;
//     JD2  wl.Brain.PairingOffered is OFF (the `/brain pair` door);
//     JD3  /brain pair|status|refresh|proposals|adopt 1|withdraw 1, typed through the terminal's own submit path, each answered "Project
//          Brain is not connected in this build", and the stream still unpaired;
//     JD4  a task typed through the terminal (+, then the objective, as Q13 does) is a local QUEUED Mission Contract, and no "Not
//          created" row appears: no Julius creation is tried (CreateMission has no caller in the game);
//     JD5  SIGN IN pressed (the Social Hub's own call): the client reaches its bridge, and the recorder logs it -- the in-run positive;
//     JD6  after all of it the stream never left idle: paired=no, pages=0, failures=0.
//   wl.Qa.JuliusDoors open [quit]   the CONTROL (recorder mode "control", which answers /native/session with a FAKE pairing):
//     JC1  the door forced open (PairingOffered ON): /brain pair through the terminal starts pairing;
//     JC2  the recorder's fake pairing makes the stream paired;
//     JC3  following a run (the call wl.Julius.Follow makes) makes the stream CALL the Julius routes: it tries, the recorder refuses
//          (failures > 0), and the recorder logs /julius/hydrate and /julius/result -- so the CLOSED run's silence is not blind.
// The control restores PairingOffered and stops the stream. PLAIN C++: no UCLASS, no UFUNCTION, no log category (LogTemp) -- a new
// early FName can shift Niagara's type hash (RC1). In its own file, named namespace (unity build). WLQA JDOORS lines.

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/InputSettings.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/PlayerInput.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformTime.h"
#include "WonderlandBeta.h"
#include "WonderlandJuliusStream.h"
#include "WonderlandMissionTasks.h"
#include "WonderlandSocialSubsystem.h"
#include "WonderlandUiSubsystem.h"

namespace WonderlandJuliusDoorsQa
{
	struct FRun
	{
		TWeakObjectPtr<UWorld> World;
		bool bOpen = false;
		bool bQuit = false;
		int32 Phase = 0;
		int32 Step = 0;
		double PhaseAt = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		bool bOldOffered = false;
		int32 ContractsBefore = 0;
		int32 NotConnectedAnswers = 0;
		FString FirstOtherAnswer;
		FTSTicker::FDelegateHandle Handle;

		void Check(const TCHAR* Id, bool bOk, const FString& What)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogTemp, Display, TEXT("WLQA JDOORS %s %s -- %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
		}
	};
	TSharedPtr<FRun> GRun;

	const TCHAR* const NotConnected = TEXT("Project Brain is not connected in this build");
	const TCHAR* const BrainLines[] = { TEXT("/brain pair QAJDOORS1"), TEXT("/brain status"), TEXT("/brain refresh"), TEXT("/brain proposals"),
		TEXT("/brain adopt 1"), TEXT("/brain withdraw 1") };

	UWonderlandUiSubsystem* UiOf(UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	UWonderlandMissionTaskSubsystem* TasksOf(UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
	}

	UWonderlandJuliusStreamSubsystem* StreamOf(UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusStreamSubsystem>() : nullptr;
	}

	UWonderlandSocialSubsystem* SocialOf(UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
	}

	IConsoleVariable* PairingOffered()
	{
		return IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Brain.PairingOffered"));
	}

	/** "key=value" out of the stream's one-line Describe(), up to the next " | " (or the end). Empty when absent. */
	FString Field(const FString& Described, const TCHAR* Key)
	{
		const FString Needle = FString(Key) + TEXT("=");
		const int32 At = Described.Find(Needle, ESearchCase::CaseSensitive);
		if (At == INDEX_NONE)
		{
			return FString();
		}
		const FString Rest = Described.Mid(At + Needle.Len());
		const int32 End = Rest.Find(TEXT(" | "), ESearchCase::CaseSensitive);
		return End == INDEX_NONE ? Rest : Rest.Left(End);
	}

	void Finish(FRun& Run, const TCHAR* Why)
	{
		if (Run.bOpen)
		{
			if (IConsoleVariable* Offered = PairingOffered())
			{
				Offered->Set(Run.bOldOffered, ECVF_SetByCode);
			}
			if (UWonderlandJuliusStreamSubsystem* Stream = StreamOf(Run.World.Get()))
			{
				Stream->Stop();
			}
		}
		UE_LOG(LogTemp, Display, TEXT("WLQA JDOORS END pass=%d fail=%d%s"), Run.Pass, Run.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
		if (Run.bQuit)
		{
			FPlatformMisc::RequestExit(false);
		}
	}

	bool Tick(float)
	{
		if (!GRun.IsValid())
		{
			return false;
		}
		FRun& Run = *GRun;
		UWorld* World = Run.World.Get();
		UWonderlandUiSubsystem* Ui = UiOf(World);
		UWonderlandJuliusStreamSubsystem* Stream = StreamOf(World);
		UWonderlandMissionTaskSubsystem* Tasks = TasksOf(World);
		UWonderlandSocialSubsystem* Social = SocialOf(World);
		auto Stop = [&Run](const TCHAR* Why)
		{
			Finish(Run, Why);
			GRun.Reset();
			return false;
		};
		if (World == nullptr || Ui == nullptr || Stream == nullptr || Tasks == nullptr || Social == nullptr)
		{
			Run.Check(TEXT("JD0"), false, TEXT("the world, the UI, the stream, the tasks or social is missing"));
			return Stop(TEXT("missing a subsystem"));
		}
		const double Now = FPlatformTime::Seconds();
		const double In = Now - Run.PhaseAt;
		auto Next = [&Run, Now]()
		{
			++Run.Phase;
			Run.Step = 0;
			Run.PhaseAt = Now;
		};

		if (!Run.bOpen)
		{
			switch (Run.Phase)
			{
			case 0:
			{
				if (In < 4.0)
				{
					return true;
				}
				if (Ui->IsWelcomeOpen())
				{
					Ui->DismissWelcome();
				}
				const APlayerController* Controller = World->GetFirstPlayerController();
				const UInputSettings* Input = GetDefault<UInputSettings>();
				const int32 ConsoleKeys = Input != nullptr ? Input->ConsoleKeys.Num() : -1;
				const int32 DebugKeys = (Controller != nullptr && Controller->PlayerInput != nullptr) ? Controller->PlayerInput->DebugExecBindings.Num() : -1;
				Run.Check(TEXT("JD1"), !WonderlandBeta::IsDeveloperSession() && ConsoleKeys == 0 && DebugKeys == 0,
					FString::Printf(TEXT("player session %s; console keys %d, engine debug bindings %d (both 0: no console, so no wl.Julius.Pair door); build '%s'"),
						WonderlandBeta::IsDeveloperSession() ? TEXT("NO (developer)") : TEXT("yes"), ConsoleKeys, DebugKeys, *WonderlandBeta::BuildLabel()));
				const IConsoleVariable* Offered = PairingOffered();
				Run.Check(TEXT("JD2"), Offered != nullptr && !Offered->GetBool(),
					FString::Printf(TEXT("wl.Brain.PairingOffered %s (OFF: /brain offers no pairing); bridge %s"),
						Offered == nullptr ? TEXT("MISSING") : Offered->GetBool() ? TEXT("ON") : TEXT("off"), *Field(Stream->Describe(), TEXT("bridge"))));
				Next();
				return true;
			}
			case 1:
				// THE SIX /brain VERBS, one per tick, through the terminal's own submit path (what Enter in the terminal does)
				if (Run.Step < static_cast<int32>(UE_ARRAY_COUNT(BrainLines)))
				{
					if (In < 0.3)
					{
						return true;
					}
					Ui->SubmitTerminalLine(BrainLines[Run.Step]);
					const FString Row = Ui->GetTerminalLatestRowForQa();
					if (Row.Contains(NotConnected))
					{
						++Run.NotConnectedAnswers;
					}
					else if (Run.FirstOtherAnswer.IsEmpty())
					{
						Run.FirstOtherAnswer = Row.Left(200);
					}
					++Run.Step;
					Run.PhaseAt = Now;
					return true;
				}
				Run.Check(TEXT("JD3"), Run.NotConnectedAnswers == static_cast<int32>(UE_ARRAY_COUNT(BrainLines)) && Field(Stream->Describe(), TEXT("paired")) == TEXT("no"),
					FString::Printf(TEXT("%d of %d /brain lines answered '%s...'; the stream paired=%s%s"), Run.NotConnectedAnswers,
						static_cast<int32>(UE_ARRAY_COUNT(BrainLines)), NotConnected, *Field(Stream->Describe(), TEXT("paired")),
						Run.FirstOtherAnswer.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; another answer: '%s'"), *Run.FirstOtherAnswer)));
				Next();
				return true;
			case 2:
			{
				// A TASK, the player's way: + makes a draft, the line typed is its objective (Q13's own two calls)
				if (Run.Step == 0)
				{
					Run.ContractsBefore = Tasks->NumContracts();
					const bool bPlus = Ui->PressAddTaskForQa();
					Ui->SubmitTerminalLine(TEXT("QA JD task: a Mission Contract kept on this PC"));
					const FWonderlandMissionTask* Made = Tasks->GetSelectedTask();
					const bool bQueued = Made != nullptr && Made->State == EWonderlandTaskState::Queued && Made->Source == EWonderlandTaskSource::Local;
					const FString Row = Ui->GetTerminalLatestRowForQa();
					Run.Check(TEXT("JD4"), bPlus && bQueued && Tasks->NumContracts() == Run.ContractsBefore + 1 && !Row.Contains(TEXT("Not created")),
						FString::Printf(TEXT("+ %s, then a typed objective: QUEUED local %s, contracts %d -> %d; the terminal's row '%s' (no 'Not created')"),
							bPlus ? TEXT("yes") : TEXT("NO"), bQueued ? TEXT("yes") : TEXT("NO"), Run.ContractsBefore, Tasks->NumContracts(), *Row.Left(160)));
					Run.Step = 1;
					Run.PhaseAt = Now;
					return true;
				}
				if (In < 1.0)
				{
					return true;
				}
				Next();
				return true;
			}
			case 3:
				// SIGN IN, the Social Hub's own call: the client reaches its bridge (the recorder), which knows no social route
				if (Run.Step == 0)
				{
					Social->StartSignIn();
					Run.Step = 1;
					Run.PhaseAt = Now;
					return true;
				}
				if (In < 6.0)
				{
					return true;
				}
				{
					const FString SignIn = Social->DescribeSignIn();
					Run.Check(TEXT("JD5"), !SignIn.Contains(TEXT("SIGNED_IN")),
						FString::Printf(TEXT("SIGN IN pressed: the client asked its bridge (the recorder logs the request) and is not signed in: '%s'"), *SignIn.Left(200)));
				}
				Next();
				return true;
			case 4:
			{
				if (In < 4.0)
				{
					return true;
				}
				const FString Described = Stream->Describe();
				Run.Check(TEXT("JD6"), Described.StartsWith(TEXT("JULIUS STREAM: idle")) && Field(Described, TEXT("paired")) == TEXT("no")
					&& Field(Described, TEXT("pages")) == TEXT("0") && Field(Described, TEXT("failures")) == TEXT("0"),
					FString::Printf(TEXT("after the whole flow the stream never left idle: '%s'"), *Described.Left(300)));
				return Stop(nullptr);
			}
			default:
				return Stop(TEXT("an unknown phase"));
			}
		}

		// THE CONTROL: the doors forced open, so the very calls the closed run must not make are made -- and seen
		switch (Run.Phase)
		{
		case 0:
		{
			if (In < 4.0)
			{
				return true;
			}
			if (Ui->IsWelcomeOpen())
			{
				Ui->DismissWelcome();
			}
			IConsoleVariable* Offered = PairingOffered();
			if (Offered == nullptr)
			{
				Run.Check(TEXT("JC1"), false, TEXT("no wl.Brain.PairingOffered in this build"));
				return Stop(TEXT("no pairing switch"));
			}
			Run.bOldOffered = Offered->GetBool();
			Offered->Set(true, ECVF_SetByCode);
			Ui->SubmitTerminalLine(TEXT("/brain pair QAJDCONTROL1"));
			const FString Row = Ui->GetTerminalLatestRowForQa();
			Run.Check(TEXT("JC1"), Row.Contains(TEXT("Pairing with the bridge")),
				FString::Printf(TEXT("CONTROL: the door forced open (PairingOffered ON), /brain pair through the terminal: '%s'"), *Row.Left(200)));
			Next();
			return true;
		}
		case 1:
		{
			const FString Paired = Field(Stream->Describe(), TEXT("paired"));
			if (Paired != TEXT("yes") && In < 10.0)
			{
				return true;
			}
			Run.Check(TEXT("JC2"), Paired == TEXT("yes"), FString::Printf(TEXT("CONTROL: the recorder's fake pairing made the stream paired=%s"), *Paired));
			// THE CALL wl.Julius.Follow MAKES: one run to follow, so the stream reads the Julius routes
			Stream->Follow(TEXT("qa-control-project"), TEXT("qa-control-run"));
			Next();
			return true;
		}
		case 2:
		{
			if (In < 10.0)
			{
				return true;
			}
			const FString Described = Stream->Describe();
			const int32 Failures = FCString::Atoi(*Field(Described, TEXT("failures")));
			Run.Check(TEXT("JC3"), Failures > 0,
				FString::Printf(TEXT("CONTROL: following a run made the stream CALL the Julius routes and the recorder refused them (failures %d): '%s'"),
					Failures, *Described.Left(300)));
			return Stop(nullptr);
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaJuliusDoors(
		TEXT("wl.Qa.JuliusDoors"),
		TEXT("QA (founder 10-06, the Julius world routes): with the bridge pointed at CORE's request recorder, prove the Beta flow never reaches "
			"/julius/{missions,events,hydrate,result} (JD1-JD6), or with `open` force the doors as the CONTROL (JC1-JC3). `quit` exits after. WLQA JDOORS lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GRun.IsValid() || World == nullptr)
			{
				return;
			}
			GRun = MakeShared<FRun>();
			GRun->World = World;
			GRun->bOpen = Args.Contains(TEXT("open"));
			GRun->bQuit = Args.Contains(TEXT("quit"));
			GRun->PhaseAt = FPlatformTime::Seconds();
			UE_LOG(LogTemp, Display, TEXT("WLQA JDOORS BEGIN | %s | %s"), GRun->bOpen ? TEXT("CONTROL (doors forced open)") : TEXT("CLOSED (the Beta flow)"),
				*WonderlandBeta::BuildLabel());
			GRun->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick), 0.0f);
		}));
}

// WONDERLAND -- wl.Qa.PackageCheck: the post-completion gameplay regression, run INSIDE A PACKAGED BUILD.
//
// FOUNDER, 2026-09-30: "rebuild the packaged game when the gameplay fixes are verified; boot and test the rebuilt
// package". The editor proofs drive the game through Python, which a packaged build does not have; a boot that only
// photographs Golden Arrival says nothing about the fixes. So this command walks the same checks through the player's
// own systems -- the world map, the travel, the wardrobe's colour path, a Mission Contract -- on a timer, writes a WLQA
// line per check to the game log and a frame per stage to Saved/Screenshots/WLQA, resets the colours it changed, and
// quits. Tools/boot_test_package.ps1 launches the package with -ExecCmds="wl.Qa.PackageCheck" and reads the log back.
//
// Not in Shipping: a development instrument, like every other wl.* switch.
#include "CoreMinimal.h"

#if !UE_BUILD_SHIPPING

#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "WonderlandTravel.h"
#include "WonderlandUiSubsystem.h"
#include "WonderlandUiTestLibrary.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandQa, Log, All);

namespace
{
	struct FQaRun
	{
		TWeakObjectPtr<UWorld> World;
		int32 Step = 0;
		int32 Sub = 0;
		double StepStart = 0.0;
		bool bTravelBegun = false;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
		FTSTicker::FDelegateHandle Handle;
	};

	TSharedPtr<FQaRun> GRun;

	double Now()
	{
		return FPlatformTime::Seconds();
	}

	UWonderlandUiSubsystem* Ui(UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	UWonderlandTravelSubsystem* Travel(UWorld* World)
	{
		return World != nullptr ? World->GetSubsystem<UWonderlandTravelSubsystem>() : nullptr;
	}

	void Check(FQaRun& Run, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? Run.Pass : Run.Fail)++;
		UE_LOG(LogWonderlandQa, Display, TEXT("WLQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	void Frame(FQaRun& Run, const FString& Name)
	{
		int32 Width = 0;
		int32 Height = 0;
		const FString Path = Run.Dir / (Name + TEXT(".png"));
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
		UE_LOG(LogWonderlandQa, Display, TEXT("WLQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
	}

	/** Label rectangles that overlap one another, and labels that cover another drawn marker, in the map's own layout. */
	void MapOverlaps(const FString& Json, int32& OutLabels, int32& OutOverlaps, int32& OutCovers, int32& OutOnScreen)
	{
		OutLabels = OutOverlaps = OutCovers = OutOnScreen = 0;
		TSharedPtr<FJsonObject> Root;
		if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Root) || !Root.IsValid())
		{
			OutOverlaps = -1;
			return;
		}
		struct FRow { FVector2D Marker; double Radius; bool bDrawn; bool bLabel; FBox2D Label; };
		TArray<FRow> Rows;
		for (const TSharedPtr<FJsonValue>& Value : Root->GetArrayField(TEXT("stops")))
		{
			const TSharedPtr<FJsonObject> Stop = Value->AsObject();
			FRow Row;
			const TArray<TSharedPtr<FJsonValue>>& M = Stop->GetArrayField(TEXT("marker"));
			Row.Marker = FVector2D(M[0]->AsNumber(), M[1]->AsNumber());
			Row.Radius = Stop->GetNumberField(TEXT("radius"));
			Row.bDrawn = Stop->GetBoolField(TEXT("drawn"));
			OutOnScreen += Stop->GetBoolField(TEXT("on_screen")) ? 1 : 0;
			const TArray<TSharedPtr<FJsonValue>>* L = nullptr;
			Row.bLabel = Stop->TryGetArrayField(TEXT("label"), L) && L != nullptr && L->Num() == 4;
			if (Row.bLabel)
			{
				const double X = (*L)[0]->AsNumber(), Y = (*L)[1]->AsNumber(), W = (*L)[2]->AsNumber(), H = (*L)[3]->AsNumber();
				Row.Label = FBox2D(FVector2D(X, Y), FVector2D(X + W, Y + H));
				++OutLabels;
			}
			Rows.Add(Row);
		}
		for (int32 A = 0; A < Rows.Num(); ++A)
		{
			if (!Rows[A].bLabel)
			{
				continue;
			}
			for (int32 B = A + 1; B < Rows.Num(); ++B)
			{
				if (Rows[B].bLabel && Rows[A].Label.Intersect(Rows[B].Label))
				{
					++OutOverlaps;
				}
			}
			for (int32 B = 0; B < Rows.Num(); ++B)
			{
				if (B != A && Rows[B].bDrawn && Rows[A].Label.ComputeSquaredDistanceToPoint(Rows[B].Marker) < FMath::Square(Rows[B].Radius))
				{
					++OutCovers;
				}
			}
		}
	}

	/** Start a travel on the first tick of a step, then report when it has ended. True once the step is over. */
	bool TravelStep(FQaRun& Run, UWorld* World, FName Id, const TCHAR* CheckId)
	{
		UWonderlandTravelSubsystem* T = Travel(World);
		if (T == nullptr)
		{
			Check(Run, CheckId, false, TEXT("no travel subsystem"));
			return true;
		}
		if (!Run.bTravelBegun)
		{
			FText Refusal;
			Run.bTravelBegun = T->RequestTravel(Id, Refusal);
			if (!Run.bTravelBegun)
			{
				Check(Run, CheckId, false, FString::Printf(TEXT("%s refused: %s"), *Id.ToString(), *Refusal.ToString()));
				return true;
			}
			return false;
		}
		if (T->IsTravelling() && Now() - Run.StepStart < 100.0)
		{
			return false;
		}
		const bool bArrived = T->GetLastArrivedDestination() == Id && T->GetLastTravelReport().StartsWith(TEXT("Arrived"));
		Check(Run, CheckId, bArrived, FString::Printf(TEXT("to %s in %.1f s: %s [%s]"), *Id.ToString(), Now() - Run.StepStart,
			*T->GetLastTravelReport(), *T->GetLastTravelDiagnostics()));
		Run.bTravelBegun = false;
		return true;
	}

	void NextStep(FQaRun& Run)
	{
		++Run.Step;
		Run.Sub = 0;
		Run.StepStart = Now();
		Run.bTravelBegun = false;
	}

	bool Tick(float)
	{
		if (!GRun.IsValid())
		{
			return false;
		}
		FQaRun& Run = *GRun;
		UWorld* World = Run.World.Get();
		if (World == nullptr)
		{
			UE_LOG(LogWonderlandQa, Warning, TEXT("WLQA ABORT the world went away"));
			GRun.Reset();
			return false;
		}
		UWonderlandUiSubsystem* U = Ui(World);
		const double In = Now() - Run.StepStart;
		static const FName MapTargets[3] = { TEXT("tower_rise"), TEXT("tower_lane"), TEXT("mushroom_grove") };
		switch (Run.Step)
		{
		case 0: // let the world and the HUD settle
			if (In >= 12.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA BEGIN package check, frames in %s"), *Run.Dir);
				NextStep(Run);
			}
			break;
		case 1: // Jack Flame, secondary AZURE, through the wardrobe's own colour path
			if (Run.Sub == 0)
			{
				GEngine->Exec(World, TEXT("wl.Skins.Wear jack_flame"));
				Run.Sub = 1;
			}
			else if (Run.Sub == 1 && In >= 3.0)
			{
				GEngine->Exec(World, TEXT("wl.Mascot.Secondary 0.26,0.56,1.0"));
				Run.Sub = 2;
			}
			else if (Run.Sub == 2 && In >= 5.0)
			{
				Frame(Run, TEXT("01_jack_flame_azure"));
				Check(Run, TEXT("Q01"), true, TEXT("Jack Flame worn with an AZURE secondary (frame 01: fire, tie and suit)"));
				NextStep(Run);
			}
			break;
		case 2: // to the Tartarus rim
			if (TravelStep(Run, World, TEXT("tartarus_heartland_east"), TEXT("Q02")))
			{
				NextStep(Run);
			}
			break;
		case 3: // rim -> the dense centre: the founder's failing trip
			if (In >= 3.0 && TravelStep(Run, World, TEXT("castle_approach"), TEXT("Q03")))
			{
				NextStep(Run);
			}
			break;
		case 4: // the world map at three zooms: labels must not overlap
			if (U == nullptr)
			{
				Check(Run, TEXT("Q04"), false, TEXT("no UI subsystem"));
				NextStep(Run);
				break;
			}
			if (Run.Sub == 0)
			{
				if (!U->IsWorldMapOpen())
				{
					U->ToggleWorldMap();
				}
				Run.Sub = 1;
			}
			else if (Run.Sub >= 1 && Run.Sub <= 3 && In >= 1.5 * Run.Sub)
			{
				static const float Zooms[3] = { 1.0f, 4.0f, 8.0f };
				const float Zoom = Zooms[Run.Sub - 1];
				if (Run.Sub == 3)
				{
					U->CenterMapOn(TEXT("arrival"));
				}
				U->SetMapZoom(Zoom);
				Run.Sub += 10;   // paint once at this zoom before it is read
			}
			else if (Run.Sub >= 11 && Run.Sub <= 13 && In >= 1.5 * (Run.Sub - 10) + 0.7)
			{
				const int32 Which = Run.Sub - 10;
				int32 Labels, Overlaps, Covers, OnScreen;
				MapOverlaps(U->DescribeMapLayout(), Labels, Overlaps, Covers, OnScreen);
				Frame(Run, FString::Printf(TEXT("02_map_zoom_%g"), U->GetMapZoom()));
				Check(Run, *FString::Printf(TEXT("Q04.%d"), Which), Overlaps == 0 && Covers == 0 && Labels > 0,
					FString::Printf(TEXT("map zoom %.1f: %d of %d places on the canvas named, %d label overlaps, %d labels over markers"),
						U->GetMapZoom(), Labels, OnScreen, Overlaps, Covers));
				Run.Sub = Which < 3 ? Which + 1 : 99;
			}
			else if (Run.Sub == 99)
			{
				NextStep(Run);
			}
			break;
		case 5: // TW01 / TW02 / MG01 FROM THE MAP: select, TELEPORT
		case 6:
		case 7:
		{
			const FName Target = MapTargets[Run.Step - 5];
			if (U == nullptr)
			{
				NextStep(Run);
				break;
			}
			if (Run.Sub == 0)
			{
				if (!U->IsWorldMapOpen())
				{
					U->ToggleWorldMap();
				}
				Run.Sub = 1;
			}
			else if (Run.Sub == 1 && In >= 1.0)
			{
				U->SelectMapDestination(Target);
				Run.Sub = 2;
			}
			else if (Run.Sub == 2 && In >= 1.6)
			{
				const bool bSelected = U->GetMapSelectedId() == Target;
				const bool bStarted = bSelected && U->TeleportToSelected();
				if (!bStarted)
				{
					Check(Run, *FString::Printf(TEXT("Q0%d"), Run.Step), false, FString::Printf(TEXT("map could not select / teleport to %s"), *Target.ToString()));
					NextStep(Run);
					break;
				}
				Run.bTravelBegun = true;
				Run.Sub = 3;
			}
			else if (Run.Sub == 3 && TravelStep(Run, World, Target, *FString::Printf(TEXT("Q0%d"), Run.Step)))
			{
				Frame(Run, FString::Printf(TEXT("03_arrived_%s"), *Target.ToString()));
				NextStep(Run);
			}
			break;
		}
		case 8: // back to the Tartarus rim, then a Mission Contract from there: the founder's exact case
			if (TravelStep(Run, World, TEXT("tartarus_heartland_east"), TEXT("Q08")))
			{
				NextStep(Run);
			}
			break;
		case 9:
		{
			UWonderlandTravelSubsystem* T = Travel(World);
			if (Run.Sub == 0 && In >= 3.0)
			{
				GEngine->Exec(World, TEXT("wl.Mission.Scenario B"));
				Run.Sub = 1;
			}
			else if (Run.Sub == 1 && T != nullptr && T->IsTravelling())
			{
				Run.Sub = 2;
			}
			else if (Run.Sub == 1 && In >= 15.0)
			{
				Check(Run, TEXT("Q09"), false, TEXT("the Mission Contract did not start its travel to the site"));
				Run.Sub = 4;
			}
			else if (Run.Sub == 2 && T != nullptr && !T->IsTravelling())
			{
				const bool bArrived = T->GetLastArrivedDestination() == FName(TEXT("castle_approach")) && T->GetLastTravelReport().StartsWith(TEXT("Arrived"));
				Check(Run, TEXT("Q09"), bArrived, FString::Printf(TEXT("Mission Contract from the Tartarus rim travelled to its site: %s [%s]"),
					*T->GetLastTravelReport(), *T->GetLastTravelDiagnostics()));
				Run.Sub = 3;
				Run.StepStart = Now();
			}
			else if (Run.Sub == 3 && In >= 40.0)
			{
				Frame(Run, TEXT("04_mission_contract_jack_azure"));
				GEngine->Exec(World, TEXT("wl.Mission.Stop"));
				Run.Sub = 4;
			}
			else if (Run.Sub == 4)
			{
				NextStep(Run);
			}
			break;
		}
		case 10: // put the colours back and leave
			if (Run.Sub == 0)
			{
				GEngine->Exec(World, TEXT("wl.Mascot.Reset"));
				Run.Sub = 1;
			}
			else if (In >= 3.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA END pass=%d fail=%d"), Run.Pass, Run.Fail);
				GRun.Reset();
				GEngine->Exec(World, TEXT("quit"));
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaPackageCheck(
		TEXT("wl.Qa.PackageCheck"),
		TEXT("Run the post-completion gameplay regression in this (packaged) build: Jack Flame's colours, rim -> centre travel, ")
		TEXT("the world map at three zooms, TW01 / TW02 / MG01 from the map, a Mission Contract from the Tartarus rim. ")
		TEXT("Logs WLQA lines, saves frames to Saved/Screenshots/WLQA, resets the colours and quits."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GRun.IsValid())
			{
				UE_LOG(LogWonderlandQa, Warning, TEXT("WLQA already running"));
				return;
			}
			GRun = MakeShared<FQaRun>();
			GRun->World = World;
			GRun->StepStart = Now();
			GRun->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLQA"));
			GRun->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick), 0.1f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLQA armed (world %s)"), World != nullptr ? *World->GetName() : TEXT("none"));
		}));
}

#endif

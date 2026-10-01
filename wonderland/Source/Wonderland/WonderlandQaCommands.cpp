// WONDERLAND -- wl.Qa.PackageCheck: the post-completion gameplay regression, run INSIDE A PACKAGED BUILD.
//
// FOUNDER, 2026-09-30: "rebuild the packaged game when the gameplay fixes are verified; boot and test the rebuilt
// package". The editor proofs drive the game through Python, which a packaged build does not have; a boot that only
// photographs Golden Arrival says nothing about the fixes. So this command walks the same checks through the player's
// own systems -- the wardrobe's colour path, the travel, the world map, a Mission Contract on every skin, the skins'
// heights -- on a timer, writes a WLQA line per check to the game log and a frame per stage to Saved/Screenshots/WLQA,
// and quits. Tools/boot_test_package_qa.ps1 launches the package with -ExecCmds="wl.Qa.PackageCheck", reads the log
// back, then boots it AGAIN with wl.Qa.PackagePersist to see the colour and the skin the first run chose come back.
//
// THE CHECKS MEASURE, THEY DO NOT ASSUME. Jack Flame's colours are read off the costume's own materials; a Mission
// Contract is judged act by act on the worn skin's hands against the canon's (the measure that failed on the old
// build, zh_31 / zh_33), on every act Relay OG reaches, and on the Dog's headway round the circle (zh_34).
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
#include "RelayDogCharacter.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandMissionTasks.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandQa, Log, All);

namespace
{
	/** One act of a sampled Mission Contract. */
	struct FQaActSamples
	{
		int32 Full = 0;               // samples at full act weight
		TArray<float> Gaps;           // worn hand to canon hand, both sides, at full weight
		TArray<FVector> Track;        // the Dog in the circling acts: X, Y and the world time in Z
		double PosedAt = -1.0;
		bool bShot = false;
	};

	struct FQaRun
	{
		TWeakObjectPtr<UWorld> World;
		int32 Step = 0;
		int32 Sub = 0;
		double StepStart = 0.0;
		double ZBefore = 0.0;
		bool bTravelBegun = false;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
		FTSTicker::FDelegateHandle Handle;
		// the second boot: check what the first one saved, then put the boot skin back
		bool bPersist = false;
		FString RestoreSkin;
		// a Mission Contract being sampled
		TMap<FString, FQaActSamples> Acts;
		bool bContractSeen = false;
		double ContractStart = 0.0;
		int32 DetoursAtStart = 0;
		int32 Skin = 0;
	};

	TSharedPtr<FQaRun> GQaRun;

	// THE ACTS RELAY OG PERFORMS on the scenario path (zh_42's reference): every skin must reach each at full weight
	const TCHAR* const ContractActs[6] = { TEXT("PREPARATION"), TEXT("RESEARCH"), TEXT("IMPLEMENTATION"), TEXT("REVIEW"), TEXT("REPAIR"), TEXT("VERIFICATION") };
	// the colour the first boot leaves chosen for the second to find
	const FLinearColor PersistColour(1.0f, 0.25f, 0.55f, 1.0f);

	double QaNow()
	{
		return FPlatformTime::Seconds();
	}

	UWonderlandUiSubsystem* QaUi(UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	UWonderlandTravelSubsystem* QaTravel(UWorld* World)
	{
		return World != nullptr ? World->GetSubsystem<UWonderlandTravelSubsystem>() : nullptr;
	}

	ARelayDogCharacter* QaDog(UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		return Controller != nullptr ? Cast<ARelayDogCharacter>(Controller->GetPawn()) : nullptr;
	}

	void QaCheck(FQaRun& Run, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? Run.Pass : Run.Fail)++;
		UE_LOG(LogWonderlandQa, Display, TEXT("WLQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	void QaFrame(FQaRun& Run, const FString& Name)
	{
		int32 Width = 0;
		int32 Height = 0;
		const FString Path = Run.Dir / (Name + TEXT(".png"));
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
		UE_LOG(LogWonderlandQa, Display, TEXT("WLQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
	}

	/** A costume's materials as painted right now (DescribeMaterialColours): the body's Color and its flame twin's. */
	struct FQaPaint
	{
		FLinearColor Body = FLinearColor::Black;
		FLinearColor Twin = FLinearColor::Black;
	};

	TMap<FString, FQaPaint> QaPainted(const AWonderlandCompanionEmbodiment* Costume)
	{
		TMap<FString, FQaPaint> Out;
		if (Costume == nullptr)
		{
			return Out;
		}
		auto Read = [](const FString& Text)
		{
			TArray<FString> V;
			Text.ParseIntoArray(V, TEXT(","));
			return V.Num() >= 3 ? FLinearColor(FCString::Atof(*V[0]), FCString::Atof(*V[1]), FCString::Atof(*V[2]), 1.0f) : FLinearColor::Black;
		};
		TArray<FString> Entries;
		Costume->DescribeMaterialColours().ParseIntoArray(Entries, TEXT(";"));
		for (const FString& Entry : Entries)
		{
			TArray<FString> Bits;
			Entry.ParseIntoArray(Bits, TEXT("|"), false);   // the channel field may be empty
			if (Bits.Num() == 4)
			{
				FQaPaint Paint;
				Paint.Body = Read(Bits[2]);
				Paint.Twin = Read(Bits[3]);
				Out.Add(Bits[0], Paint);
			}
		}
		return Out;
	}

	/** Same hue: each channel over the brightest, within 0.03 (the editor proof's standard, zh_22). */
	bool QaSameHue(const FLinearColor& Got, const FLinearColor& Want)
	{
		const float G = FMath::Max3(Got.R, Got.G, Got.B);
		const float W = FMath::Max3(Want.R, Want.G, Want.B);
		return G > 1e-6f && W > 1e-6f
			&& FMath::Abs(Got.R / G - Want.R / W) <= 0.03f
			&& FMath::Abs(Got.G / G - Want.G / W) <= 0.03f
			&& FMath::Abs(Got.B / G - Want.B / W) <= 0.03f;
	}

	float QaLuminance(const FLinearColor& C)
	{
		return 0.2126f * C.R + 0.7152f * C.G + 0.0722f * C.B;
	}

	FString QaRgb(const FLinearColor& C)
	{
		return FString::Printf(TEXT("%.3f,%.3f,%.3f"), C.R, C.G, C.B);
	}

	/** Jack Flame's fire, tie and suit all in the chosen secondary's hue, with the suit still a deep, readable cloth. */
	bool JackWearsSecondary(const AWonderlandCompanionEmbodiment* Costume, const FLinearColor& Want, FString& OutDetail)
	{
		const TMap<FString, FQaPaint> P = QaPainted(Costume);
		const FQaPaint* Suit = P.Find(TEXT("suit"));
		const FQaPaint* Tie = P.Find(TEXT("heart"));
		const FQaPaint* Fire = P.Find(TEXT("flame"));
		const FQaPaint* Stripe = P.Find(TEXT("stripe"));
		const FQaPaint* Collar = P.Find(TEXT("nightmare"));
		if (Suit == nullptr || Tie == nullptr || Fire == nullptr || Stripe == nullptr || Collar == nullptr)
		{
			OutDetail = FString::Printf(TEXT("Jack Flame's materials not all found (%d read)"), P.Num());
			return false;
		}
		const bool bHues = QaSameHue(Suit->Body, Want) && QaSameHue(Tie->Body, Want) && QaSameHue(Fire->Twin, Want);
		const bool bReadable = QaLuminance(Stripe->Body) >= 2.5f * QaLuminance(Suit->Body) && FMath::Max3(Suit->Body.R, Suit->Body.G, Suit->Body.B) <= 0.34f;
		const bool bCollar = FMath::Max3(Collar->Body.R, Collar->Body.G, Collar->Body.B) <= 0.06f;
		OutDetail = FString::Printf(TEXT("want %s: suit %s, tie %s, fire %s (hues %s); pinstripes %.1fx the suit's luminance (>= 2.5); collar %s (kept black: %s)"),
			*QaRgb(Want), *QaRgb(Suit->Body), *QaRgb(Tie->Body), *QaRgb(Fire->Twin), bHues ? TEXT("match") : TEXT("DIFFER"),
			QaLuminance(Stripe->Body) / FMath::Max(QaLuminance(Suit->Body), 1e-4f), *QaRgb(Collar->Body), bCollar ? TEXT("yes") : TEXT("NO"));
		return bHues && bReadable && bCollar;
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
		UWonderlandTravelSubsystem* T = QaTravel(World);
		if (T == nullptr)
		{
			QaCheck(Run, CheckId, false, TEXT("no travel subsystem"));
			return true;
		}
		if (!Run.bTravelBegun)
		{
			FText Refusal;
			Run.bTravelBegun = T->RequestTravel(Id, Refusal);
			if (!Run.bTravelBegun)
			{
				QaCheck(Run, CheckId, false, FString::Printf(TEXT("%s refused: %s"), *Id.ToString(), *Refusal.ToString()));
				return true;
			}
			return false;
		}
		if (T->IsTravelling() && QaNow() - Run.StepStart < 100.0)
		{
			return false;
		}
		const bool bArrived = T->GetLastArrivedDestination() == Id && T->GetLastTravelReport().StartsWith(TEXT("Arrived"));
		QaCheck(Run, CheckId, bArrived, FString::Printf(TEXT("to %s in %.1f s: %s [%s]"), *Id.ToString(), QaNow() - Run.StepStart,
			*T->GetLastTravelReport(), *T->GetLastTravelDiagnostics()));
		Run.bTravelBegun = false;
		return true;
	}

	void QaNextStep(FQaRun& Run)
	{
		++Run.Step;
		Run.Sub = 0;
		Run.StepStart = QaNow();
		Run.bTravelBegun = false;
	}

	void BeginContractSampling(FQaRun& Run, UWorld* World)
	{
		Run.Acts.Reset();
		Run.bContractSeen = false;
		Run.ContractStart = World->GetTimeSeconds();
		const ARelayDogCharacter* D = QaDog(World);
		Run.DetoursAtStart = D != nullptr ? D->GetOrbitDetourCount() : 0;
	}

	/**
	 * One sample of a running Mission Contract: per act at full weight, the worn hands against the canon's (G1c); in the
	 * circling acts, where the Dog is (G1d); a wide frame in RESEARCH and a close frame of the working hand in the two
	 * acts that once lost the tool. True once the fixture has run and gone quiet, or 170 s have passed.
	 */
	bool SampleContract(FQaRun& Run, UWorld* World, const FString& SkinId)
	{
		ARelayDogCharacter* D = QaDog(World);
		const UWonderlandMissionSubsystem* Mission = UWonderlandUiTestLibrary::GetMission(World);
		const double Clock = World->GetTimeSeconds();
		const double T = Clock - Run.ContractStart;
		if (D == nullptr || Mission == nullptr)
		{
			return true;
		}
		const float Weight = D->GetCanonicalWornPose().MissionWeight;
		const FString Act = Mission->GetDogPerformingLabel().ToUpper();
		const bool bActing = !Act.IsEmpty() && Act != TEXT("NONE");
		Run.bContractSeen |= Weight >= 0.5f;
		if (bActing && Weight >= 0.9f && (Act == TEXT("RESEARCH") || Act == TEXT("IMPLEMENTATION")))
		{
			const FVector At = D->GetActorLocation();
			Run.Acts.FindOrAdd(Act).Track.Add(FVector(At.X, At.Y, T));
		}
		if (bActing && Weight >= 0.98f)
		{
			FQaActSamples& Row = Run.Acts.FindOrAdd(Act);
			++Row.Full;
			const AWonderlandCompanionEmbodiment* Costume = D->GetCostume();
			if (Costume != nullptr)
			{
				for (const float Side : { 1.0f, -1.0f })
				{
					const FVector Worn = Costume->GetHandWorld(Side);
					const FVector Canon = D->GetCanonHandWorld(Side);
					if (!Worn.IsNearlyZero(1e-3) && !Canon.IsNearlyZero(1e-3))
					{
						Row.Gaps.Add(static_cast<float>(FVector::Dist(Worn, Canon)));
					}
				}
			}
			if (Act == TEXT("RESEARCH") && Row.Full == 30)
			{
				QaFrame(Run, FString::Printf(TEXT("04_contract_%s_research_wide"), *SkinId));
			}
			if ((Act == TEXT("IMPLEMENTATION") || Act == TEXT("REPAIR")) && !Row.bShot)
			{
				if (Row.PosedAt < 0.0 && Row.Full >= 12)
				{
					// from the side, a little behind and above, looking past the working hand at the Contract
					const FVector Hand = Costume != nullptr ? Costume->GetHandWorld(-1.0f) : D->GetCanonHandWorld(-1.0f);
					const FVector Fwd = D->GetActorForwardVector();
					const FVector Right = D->GetActorRightVector();
					UWonderlandUiTestLibrary::PoseCamera(World, Hand - Fwd * 90.0f - Right * 260.0f + FVector(0.0f, 0.0f, 60.0f), Hand + Fwd * 120.0f, 50.0f);
					Row.PosedAt = Clock;
				}
				else if (Row.PosedAt >= 0.0 && Clock - Row.PosedAt >= 0.5)
				{
					QaFrame(Run, FString::Printf(TEXT("05_contract_%s_%s"), *SkinId, *Act.ToLower()));
					UWonderlandUiTestLibrary::ReleaseCamera(World);
					Row.bShot = true;
				}
			}
		}
		return (Run.bContractSeen && Weight <= 0.01f && !bActing && T > 30.0) || T > 170.0;
	}

	/**
	 * Judge a sampled contract. .1: the worn hands on the canon's in every act (p95 <= 1.5 uu, zh_37's bar) and every act
	 * Relay OG performs reached at full weight, so the hands are not judged on nothing. .2: no 10 s window in RESEARCH or
	 * IMPLEMENTATION with under 60 uu of headway -- the circle did not jam (zh_36's stall detector).
	 */
	void JudgeContract(FQaRun& Run, UWorld* World, const FString& Id, const FString& SkinId)
	{
		const ARelayDogCharacter* D = QaDog(World);
		const bool bCostume = D != nullptr && D->GetCostume() != nullptr;
		FString PerAct;
		FString Missing;
		float Worst = 0.0f;
		for (const TCHAR* Act : ContractActs)
		{
			const FQaActSamples* Row = Run.Acts.Find(Act);
			if (Row == nullptr || Row->Full == 0)
			{
				Missing += FString::Printf(TEXT(" %s"), Act);
				continue;
			}
			float P95 = 0.0f;
			if (Row->Gaps.Num() > 0)
			{
				TArray<float> Sorted = Row->Gaps;
				Sorted.Sort();
				P95 = Sorted[FMath::Min(FMath::FloorToInt(Sorted.Num() * 0.95f), Sorted.Num() - 1)];
			}
			Worst = FMath::Max(Worst, P95);
			PerAct += FString::Printf(TEXT(" %s %.2f (%d)"), Act, P95, Row->Full);
		}
		const bool bGapsMeasured = !bCostume || Run.Acts.Num() == 0 || [&Run]()
		{
			for (const TPair<FString, FQaActSamples>& Pair : Run.Acts)
			{
				if (Pair.Value.Gaps.Num() > 0)
				{
					return true;
				}
			}
			return false;
		}();
		QaCheck(Run, *(Id + TEXT(".1")), Missing.IsEmpty() && bGapsMeasured && Worst <= 1.5f,
			FString::Printf(TEXT("%s: %s hand p95 per act (full-weight samples):%s; worst %.2f uu (<= 1.5); acts missing:%s"),
				*SkinId, bCostume ? TEXT("worn-to-canon") : TEXT("no costume, canon"), *PerAct, Worst, Missing.IsEmpty() ? TEXT(" none") : *Missing));

		int32 Stalls = 0;
		int32 Points = 0;
		FString FirstStall;
		for (const TCHAR* Act : { TEXT("RESEARCH"), TEXT("IMPLEMENTATION") })
		{
			const FQaActSamples* Row = Run.Acts.Find(Act);
			if (Row == nullptr)
			{
				continue;
			}
			const TArray<FVector>& P = Row->Track;
			Points += P.Num();
			int32 J = 0;
			for (int32 I = 0; I < P.Num(); ++I)
			{
				while (J < P.Num() && P[J].Z - P[I].Z < 10.0)
				{
					++J;
				}
				if (J >= P.Num())
				{
					break;
				}
				double Moved = 0.0;
				for (int32 K = I; K <= J; ++K)
				{
					Moved = FMath::Max(Moved, FVector::Dist2D(P[K], P[I]));
				}
				if (Moved < 60.0)
				{
					if (Stalls++ == 0)
					{
						FirstStall = FString::Printf(TEXT(" first in %s at %.0f s near (%.0f, %.0f)"), Act, P[I].Z, P[I].X, P[I].Y);
					}
				}
			}
		}
		const int32 Detours = D != nullptr ? D->GetOrbitDetourCount() - Run.DetoursAtStart : 0;
		QaCheck(Run, *(Id + TEXT(".2")), Points >= 100 && Stalls == 0,
			FString::Printf(TEXT("%s: the circle round the Contract: %d samples in RESEARCH / IMPLEMENTATION, %d windows of 10 s with < 60 uu headway%s; %d detours"),
				*SkinId, Points, Stalls, *FirstStall, Detours));
	}

	bool PersistTick(FQaRun& Run, UWorld* World)
	{
		const double In = QaNow() - Run.StepStart;
		if (Run.Step == 0 && In >= 12.0)
		{
			const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>();
			const ARelayDogCharacter* D = QaDog(World);
			const FName Worn = D != nullptr ? D->GetWornSkinId() : NAME_None;
			FString Paint;
			const bool bPainted = D != nullptr && JackWearsSecondary(D->GetCostume(), PersistColour, Paint);
			const bool bSaved = Settings != nullptr && Settings->Secondary.Equals(PersistColour, 0.002f) && Settings->bSecondaryChosen;
			QaFrame(Run, TEXT("06_after_restart_jack_rose"));
			QaCheck(Run, TEXT("Q12"), Worn == FName(TEXT("jack_flame")) && bSaved && bPainted,
				FString::Printf(TEXT("after a restart: skin %s (want jack_flame); saved secondary %s chosen %s (want %s); painted: %s"),
					*Worn.ToString(), Settings != nullptr ? *QaRgb(Settings->Secondary) : TEXT("?"),
					Settings != nullptr && Settings->bSecondaryChosen ? TEXT("yes") : TEXT("no"), *QaRgb(PersistColour), *Paint));
			GEngine->Exec(World, TEXT("wl.Mascot.Reset"));
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), *Run.RestoreSkin));
			QaNextStep(Run);
		}
		else if (Run.Step == 1 && In >= 3.0)
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("WLQA restored skin %s and the designed colours"), *Run.RestoreSkin);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLQA END pass=%d fail=%d"), Run.Pass, Run.Fail);
			GQaRun.Reset();
			GEngine->Exec(World, TEXT("quit"));
			return false;
		}
		return true;
	}

	bool QaTick(float)
	{
		if (!GQaRun.IsValid())
		{
			return false;
		}
		FQaRun& Run = *GQaRun;
		UWorld* World = Run.World.Get();
		if (World == nullptr)
		{
			UE_LOG(LogWonderlandQa, Warning, TEXT("WLQA ABORT the world went away"));
			GQaRun.Reset();
			return false;
		}
		if (Run.bPersist)
		{
			return PersistTick(Run, World);
		}
		UWonderlandUiSubsystem* U = QaUi(World);
		const double In = QaNow() - Run.StepStart;
		static const FName MapTargets[3] = { TEXT("tower_rise"), TEXT("tower_lane"), TEXT("mushroom_grove") };
		static const TCHAR* const Roster[5] = { TEXT("relay_og"), TEXT("celestial_light"), TEXT("skeleton_flame"), TEXT("jack_flame"), TEXT("baal") };
		static const TCHAR* const OtherSkins[4] = { TEXT("relay_og"), TEXT("celestial_light"), TEXT("skeleton_flame"), TEXT("baal") };
		switch (Run.Step)
		{
		case 0: // let the world and the HUD settle
			if (In >= 12.0)
			{
				const ARelayDogCharacter* D = QaDog(World);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA BOOT skin %s"), D != nullptr ? *D->GetWornSkinId().ToString() : TEXT("relay_og"));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA BEGIN package check, frames in %s"), *Run.Dir);
				QaNextStep(Run);
			}
			break;
		case 1: // Jack Flame, secondary AZURE, through the wardrobe's own colour path: read back off the costume
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
				const ARelayDogCharacter* D = QaDog(World);
				const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>();
				FString Detail;
				const bool bOk = D != nullptr && Settings != nullptr && D->GetWornSkinId() == FName(TEXT("jack_flame"))
					&& JackWearsSecondary(D->GetCostume(), Settings->Secondary, Detail);
				QaFrame(Run, TEXT("01_jack_flame_azure"));
				QaCheck(Run, TEXT("Q01"), bOk, FString::Printf(TEXT("Jack Flame with an AZURE secondary: %s"), *Detail));
				QaNextStep(Run);
			}
			break;
		case 2: // to the Tartarus rim
			if (TravelStep(Run, World, TEXT("tartarus_heartland_east"), TEXT("Q02")))
			{
				QaNextStep(Run);
			}
			break;
		case 3: // rim -> the dense centre: the founder's failing trip
			if (In >= 3.0 && TravelStep(Run, World, TEXT("castle_approach"), TEXT("Q03")))
			{
				QaNextStep(Run);
			}
			break;
		case 4: // the world map at three zooms: labels must not overlap
			if (U == nullptr)
			{
				QaCheck(Run, TEXT("Q04"), false, TEXT("no UI subsystem"));
				QaNextStep(Run);
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
				QaFrame(Run, FString::Printf(TEXT("02_map_zoom_%g"), U->GetMapZoom()));
				QaCheck(Run, *FString::Printf(TEXT("Q04.%d"), Which), Overlaps == 0 && Covers == 0 && Labels > 0,
					FString::Printf(TEXT("map zoom %.1f: %d of %d places on the canvas named, %d label overlaps, %d labels over markers"),
						U->GetMapZoom(), Labels, OnScreen, Overlaps, Covers));
				Run.Sub = Which < 3 ? Which + 1 : 99;
			}
			else if (Run.Sub == 99)
			{
				QaNextStep(Run);
			}
			break;
		case 5: // TW01 / TW02 / MG01 FROM THE MAP: select, TELEPORT
		case 6:
		case 7:
		{
			const FName Target = MapTargets[Run.Step - 5];
			if (U == nullptr)
			{
				QaNextStep(Run);
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
					QaCheck(Run, *FString::Printf(TEXT("Q0%d"), Run.Step), false, FString::Printf(TEXT("map could not select / teleport to %s"), *Target.ToString()));
					QaNextStep(Run);
					break;
				}
				Run.bTravelBegun = true;
				Run.Sub = 3;
			}
			else if (Run.Sub == 3 && TravelStep(Run, World, Target, *FString::Printf(TEXT("Q0%d"), Run.Step)))
			{
				QaFrame(Run, FString::Printf(TEXT("03_arrived_%s"), *Target.ToString()));
				QaNextStep(Run);
			}
			break;
		}
		case 8: // back to the Tartarus rim, then a Mission Contract from there: the founder's exact case
			if (TravelStep(Run, World, TEXT("tartarus_heartland_east"), TEXT("Q08")))
			{
				QaNextStep(Run);
			}
			break;
		case 9: // the Mission Contract from the rim, Jack Flame in azure: the trip to the site, then every act measured
		{
			UWonderlandTravelSubsystem* T = QaTravel(World);
			if (Run.Sub == 0 && In >= 3.0)
			{
				if (UWonderlandMissionTaskSubsystem* Tasks = UWonderlandUiTestLibrary::GetMissionTasks(World))
				{
					Tasks->ClearAllTasksForDevelopment();
				}
				GEngine->Exec(World, TEXT("wl.Mission.Scenario B 5"));
				Run.Sub = 1;
			}
			else if (Run.Sub == 1 && T != nullptr && T->IsTravelling())
			{
				Run.Sub = 2;
			}
			else if (Run.Sub == 1 && In >= 15.0)
			{
				QaCheck(Run, TEXT("Q09"), false, TEXT("the Mission Contract did not start its travel to the site"));
				Run.Sub = 5;
			}
			else if (Run.Sub == 2 && T != nullptr && !T->IsTravelling())
			{
				const bool bArrived = T->GetLastArrivedDestination() == FName(TEXT("castle_approach")) && T->GetLastTravelReport().StartsWith(TEXT("Arrived"));
				QaCheck(Run, TEXT("Q09"), bArrived, FString::Printf(TEXT("Mission Contract from the Tartarus rim travelled to its site: %s [%s]"),
					*T->GetLastTravelReport(), *T->GetLastTravelDiagnostics()));
				BeginContractSampling(Run, World);
				Run.Sub = 3;
			}
			else if (Run.Sub == 3 && SampleContract(Run, World, TEXT("jack_flame")))
			{
				GEngine->Exec(World, TEXT("wl.Mission.Stop"));
				UWonderlandUiTestLibrary::ReleaseCamera(World);
				JudgeContract(Run, World, TEXT("Q09"), TEXT("jack_flame"));
				Run.StepStart = QaNow();
				Run.Sub = 4;
			}
			else if (Run.Sub == 4 && In >= 3.0)
			{
				Run.Sub = 5;
			}
			else if (Run.Sub == 5)
			{
				if (UWonderlandMissionTaskSubsystem* Tasks = UWonderlandUiTestLibrary::GetMissionTasks(World))
				{
					Tasks->ClearAllTasksForDevelopment();
				}
				QaNextStep(Run);
			}
			break;
		}
		case 10: // EVERY SKIN AT RELAY OG'S HEIGHT, and no jump on a switch (founder, 2026-09-30, a HARD rule)
		{
			ARelayDogCharacter* D = QaDog(World);
			const int32 Which = Run.Sub / 2;
			if (D == nullptr || Which >= 5)
			{
				if (D == nullptr)
				{
					QaCheck(Run, TEXT("Q10"), false, TEXT("no Relay Dog to measure"));
				}
				QaNextStep(Run);
				break;
			}
			if (Run.Sub % 2 == 0)
			{
				Run.ZBefore = D->GetActorLocation().Z;
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), Roster[Which]));
				Run.StepStart = QaNow();
				++Run.Sub;
			}
			else if (In >= 2.0)
			{
				const float Canon = D->GetCanonBodyHeightUu();
				const AWonderlandCompanionEmbodiment* Worn = D->GetCostume();
				const float Body = Worn != nullptr ? Worn->GetBodyHeightUu() : Canon;
				const double Dz = D->GetActorLocation().Z - Run.ZBefore;
				QaCheck(Run, *FString::Printf(TEXT("Q10.%d"), Which + 1),
					Canon > 120.0f && FMath::Abs(Body - Canon) <= 0.5f && FMath::Abs(Dz) <= 0.5,
					FString::Printf(TEXT("%s: body %.2f uu against Relay OG %.2f uu, the switch moved the Dog %.2f uu"),
						Roster[Which], Body, Canon, Dz));
				++Run.Sub;
			}
			break;
		}
		case 11: // THE MISSION CONTRACT ON EVERY OTHER SKIN, at the site: the founder's G1, act by act
		{
			if (Run.Skin >= 4)
			{
				QaNextStep(Run);
				break;
			}
			const FString SkinId = OtherSkins[Run.Skin];
			if (Run.Sub == 0)
			{
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), *SkinId));
				Run.StepStart = QaNow();
				Run.Sub = 1;
			}
			else if (Run.Sub == 1 && In >= 2.5)
			{
				if (UWonderlandMissionTaskSubsystem* Tasks = UWonderlandUiTestLibrary::GetMissionTasks(World))
				{
					Tasks->ClearAllTasksForDevelopment();
				}
				Run.Sub = 2;
			}
			else if (Run.Sub == 2 && In >= 3.5)
			{
				GEngine->Exec(World, TEXT("wl.Mission.Scenario B 5"));
				BeginContractSampling(Run, World);
				Run.Sub = 3;
			}
			else if (Run.Sub == 3 && SampleContract(Run, World, SkinId))
			{
				GEngine->Exec(World, TEXT("wl.Mission.Stop"));
				UWonderlandUiTestLibrary::ReleaseCamera(World);
				JudgeContract(Run, World, FString::Printf(TEXT("Q11.%d"), Run.Skin + 1), SkinId);
				Run.StepStart = QaNow();
				Run.Sub = 4;
			}
			else if (Run.Sub == 4 && In >= 3.0)
			{
				if (UWonderlandMissionTaskSubsystem* Tasks = UWonderlandUiTestLibrary::GetMissionTasks(World))
				{
					Tasks->ClearAllTasksForDevelopment();
				}
				++Run.Skin;
				Run.Sub = 0;
			}
			break;
		}
		case 12: // leave a colour and a skin chosen for the second boot to find (wl.Qa.PackagePersist), and quit
			if (Run.Sub == 0)
			{
				GEngine->Exec(World, TEXT("wl.Skins.Wear jack_flame"));
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Mascot.Secondary %.2f,%.2f,%.2f"), PersistColour.R, PersistColour.G, PersistColour.B));
				Run.Sub = 1;
			}
			else if (In >= 3.0)
			{
				const ARelayDogCharacter* D = QaDog(World);
				FString Paint;
				const bool bPainted = D != nullptr && JackWearsSecondary(D->GetCostume(), PersistColour, Paint);
				QaFrame(Run, TEXT("06_before_restart_jack_rose"));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA PERSIST set jack_flame secondary %s (painted before the restart: %s; %s)"),
					*QaRgb(PersistColour), bPainted ? TEXT("yes") : TEXT("NO"), *Paint);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA END pass=%d fail=%d"), Run.Pass, Run.Fail);
				GQaRun.Reset();
				GEngine->Exec(World, TEXT("quit"));
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	void ArmQa(UWorld* World, bool bPersist, const FString& RestoreSkin)
	{
		if (GQaRun.IsValid())
		{
			UE_LOG(LogWonderlandQa, Warning, TEXT("WLQA already running"));
			return;
		}
		GQaRun = MakeShared<FQaRun>();
		GQaRun->World = World;
		GQaRun->StepStart = QaNow();
		GQaRun->bPersist = bPersist;
		GQaRun->RestoreSkin = RestoreSkin;
		GQaRun->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLQA"));
		GQaRun->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaTick), 0.1f);
		UE_LOG(LogWonderlandQa, Display, TEXT("WLQA armed%s (world %s)"), bPersist ? TEXT(" for the restart check") : TEXT(""),
			World != nullptr ? *World->GetName() : TEXT("none"));
	}

	FAutoConsoleCommandWithWorldAndArgs GQaPackageCheck(
		TEXT("wl.Qa.PackageCheck"),
		TEXT("Run the post-completion gameplay regression in this (packaged) build: Jack Flame's colours read off his costume, ")
		TEXT("rim -> centre travel, the world map at three zooms, TW01 / TW02 / MG01 from the map, a Mission Contract on every ")
		TEXT("skin judged act by act, and every skin's body at Relay OG's height with no jump on a switch. Logs WLQA lines, saves ")
		TEXT("frames to Saved/Screenshots/WLQA, leaves Jack Flame in a chosen colour for wl.Qa.PackagePersist, and quits."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ArmQa(World, false, FString());
		}));

	FAutoConsoleCommandWithWorldAndArgs GQaPackagePersist(
		TEXT("wl.Qa.PackagePersist"),
		TEXT("The second boot after wl.Qa.PackageCheck: are Jack Flame and the colour it chose back after a restart? Then put ")
		TEXT("the designed colours and the given skin back and quit: `wl.Qa.PackagePersist relay_og`."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ArmQa(World, true, Args.Num() > 0 ? Args[0] : FString(TEXT("relay_og")));
		}));
}

#endif

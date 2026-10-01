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
#include "Misc/CoreDelegates.h"
#include "WonderlandCompanionConsole.h"

#if !UE_BUILD_SHIPPING

#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Widgets/SWindow.h"
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
#include "GameFramework/InputSettings.h"
#include "GameFramework/PlayerInput.h"
#include "HAL/FileManager.h"
#include "Materials/MaterialInterface.h"
#include "Misc/App.h"
#include "UObject/UObjectArray.h"
#include "WonderlandBeta.h"
#include "WonderlandCommandPresets.h"
#include "WonderlandCompanionSubsystem.h"
#include "WonderlandJuliusConnect.h"
#include "WonderlandPracticalLights.h"
#include "WonderlandRelaySkins.h"
#include "WonderlandSidekicks.h"
#include "WonderlandTerritory.h"
#include "EngineUtils.h"
#include "Misc/FileHelper.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"

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
		// the private beta: was the welcome already dismissed on this machine when the run began, and how many of the
		// creation loop's steps through the terminal missed
		bool bWelcomeSeenAtBoot = false;
		int32 CreationMisses = 0;
		bool bTravelBegun = false;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
		FTSTicker::FDelegateHandle Handle;
		// the second boot: check what the first one saved, then put the boot skin back
		bool bPersist = false;
		FString RestoreSkin;
		// the third boot: start on files the QA script corrupted on purpose (wl.Qa.PackageHostile)
		bool bHostile = false;
		// the simulated mission the Missions panel plays (Q17)
		bool bScenarioStarted = false;
		// THE COMPANION CONSOLES while it plays (Q22-Q24; founder, 2026-10-01): what was sampled
		int32 ConsoleLines = 0;
		int32 ConsoleElapsed = 0;
		double ConsoleAt = 0.0;
		int32 ConsoleStages[2] = {0, 0};
		bool bVerbRed = false;
		bool bVerbPale = false;
		bool bStatusInHistory = false;
		bool bConsoleFrame = false;
		bool bScrolledAway = false;
		bool bTerminalOpened = false;
		// the FLAME row hidden on the two skins without fire (Q01e)
		bool bOgHidden = false;
		bool bClHidden = false;
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
	// and the FLAME it leaves chosen with it (founder, 2026-10-01): VIOLET, so it can be told from the rose secondary
	const FLinearColor PersistFlame(0.56f, 0.34f, 0.96f, 1.0f);

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

	/* ================================================================ Q25: THE EYES INSIDE THE FACE
	 *
	 * FOUNDER CORRECTION, 2026-10-01: "the two glowing eyes are currently positioned/protruding OUTSIDE the black square/
	 * face area ... Add a QA/regression check where practical so future skin generation cannot move the eyes back outside
	 * the facial housing ... face bounds, eye bounds, eye forward depth ... Do not use a test so loose that the current
	 * incorrect protruding version would pass." The rules of wonderland/Tools/skin_eye_check.py (which the generator also
	 * enforces), applied here to the figure file the worn costume ACTUALLY loaded in this build. Every RC6 figure fails
	 * them (visor box 0.40 proud of the head, eyes 0.15 proud of that, halos 2.88 tall on a 2.70 visor):
	 *   E1 black seen beyond every edge of each visible eye, judged on the face -- dress worn proud of it set aside;
	 *   E2 no eye's face further forward than the face that rims its housing;
	 *   E3 visible halo light only over the black housing or an eye, behind the eyes' faces, never between them;
	 *   E4 the visible eyes in mirrored pairs.
	 * Figure space, grid units: X forward, Y across, Z up.
	 */
	struct FQaFaceBox
	{
		int32 Index = 0;
		FName Mat;
		bool bDark = false;
		bool bEye = false;
		double Y0 = 0.0, Y1 = 0.0, Z0 = 0.0, Z1 = 0.0, Front = 0.0;
	};

	struct FQaFace
	{
		TArray<FQaFaceBox> Surfaces;
		TArray<FQaFaceBox> Halos;

		/** The surface a camera in front sees at (Y, Z): the front-most one, edges inclusive (surfaces that meet leave no
		 *  gap), considering only those no further forward than Limit -- the face without the dress worn over it. */
		const FQaFaceBox* FrontAt(double Y, double Z, double Limit = TNumericLimits<double>::Max()) const
		{
			const FQaFaceBox* Best = nullptr;
			for (const FQaFaceBox& S : Surfaces)
			{
				if (S.Front <= Limit && Y >= S.Y0 - 1e-4 && Y <= S.Y1 + 1e-4 && Z >= S.Z0 - 1e-4 && Z <= S.Z1 + 1e-4
					&& (Best == nullptr || S.Front > Best->Front))
				{
					Best = &S;
				}
			}
			return Best;
		}
	};

	bool QaEyesInsideFace(const FWonderlandCompanionFigure& Figure, FString& OutDetail)
	{
		constexpr double Margin = 0.12, Tolerance = 0.02, HaloMargin = 0.10, DarkLuma = 0.10, Step = 0.05, Scan = 6.0;
		FQaFace Face;
		for (int32 I = 0; I < Figure.Boxes.Num(); ++I)
		{
			const FWonderlandCompanionBox& B = Figure.Boxes[I];
			if (!B.Rotation.IsNearlyZero(1e-3) || !Figure.Parts.IsValidIndex(B.Part) || !Figure.Materials.IsValidIndex(B.Material)
				|| Figure.Parts[B.Part].Motion == EWonderlandCompanionMotion::Twinkle)
			{
				continue;   // fire is drawn as fire, not as its boxes; rotated boxes are never on a face
			}
			const FWonderlandCompanionMaterial& M = Figure.Materials[B.Material];
			FQaFaceBox S;
			S.Index = I;
			S.Mat = M.Name;
			S.Y0 = B.Centre.Y - B.Size.Y * 0.5;
			S.Y1 = B.Centre.Y + B.Size.Y * 0.5;
			S.Z0 = B.Centre.Z - B.Size.Z * 0.5;
			S.Z1 = B.Centre.Z + B.Size.Z * 0.5;
			S.Front = B.Centre.X + B.Size.X * 0.5;
			if (M.Kind == EWonderlandCompanionMaterialKind::Additive)
			{
				if (M.Name.ToString().Contains(TEXT("halo")))
				{
					Face.Halos.Add(S);
				}
				continue;   // additive light is never a surface
			}
			const double Luma = 0.2126 * M.Color.R + 0.7152 * M.Color.G + 0.0722 * M.Color.B;
			S.bDark = M.Kind != EWonderlandCompanionMaterialKind::Glow && Luma < DarkLuma;
			S.bEye = M.Name == FName(TEXT("eye"));
			Face.Surfaces.Add(S);
		}
		TArray<FQaFaceBox> Visible;
		for (const FQaFaceBox& E : Face.Surfaces)
		{
			if (!E.bEye)
			{
				continue;
			}
			const FQaFaceBox* Top = Face.FrontAt((E.Y0 + E.Y1) * 0.5, (E.Z0 + E.Z1) * 0.5);
			if (Top != nullptr && Top->Index != E.Index && Top->Front > E.Front + 1e-6)
			{
				continue;   // hidden behind something (Baal's own visor eyes, behind its skull)
			}
			Visible.Add(E);
		}
		if (Visible.Num() < 2)
		{
			OutDetail = FString::Printf(TEXT("no visible pair of status eyes (%d visible)"), Visible.Num());
			return false;
		}
		TArray<FString> Faults;
		double WorstBehind = TNumericLimits<double>::Max();
		double LeastBlack = TNumericLimits<double>::Max();
		double InnerEdge = TNumericLimits<double>::Max();
		for (const FQaFaceBox& E : Visible)
		{
			InnerEdge = FMath::Min(InnerEdge, FMath::Min(FMath::Abs(E.Y0), FMath::Abs(E.Y1)));
		}
		for (const FQaFaceBox& E : Visible)
		{
			const double CY = (E.Y0 + E.Y1) * 0.5, CZ = (E.Z0 + E.Z1) * 0.5;
			// out from each edge across the housing until the black ends: (distance, rim) per direction
			auto ScanOut = [&](double Limit, double OutDist[4], const FQaFaceBox* OutRim[4])
			{
				const double DY[4] = {1.0, -1.0, 0.0, 0.0}, DZ[4] = {0.0, 0.0, 1.0, -1.0};
				const double Start[4] = {E.Y1, E.Y0, E.Z1, E.Z0};
				for (int32 K = 0; K < 4; ++K)
				{
					OutRim[K] = nullptr;
					double D = Step;
					for (; D <= Scan; D += Step)
					{
						const double Y = DY[K] != 0.0 ? Start[K] + DY[K] * D : CY;
						const double Z = DZ[K] != 0.0 ? Start[K] + DZ[K] * D : CZ;
						const FQaFaceBox* S = Face.FrontAt(Y, Z, Limit);
						if (S == nullptr || (!S->bDark && !S->bEye))
						{
							OutRim[K] = S;
							break;
						}
					}
					OutDist[K] = D;
				}
			};
			double Dist[4];
			const FQaFaceBox* Rim[4];
			ScanOut(TNumericLimits<double>::Max(), Dist, Rim);
			double Plane = TNumericLimits<double>::Max();
			int32 Rims = 0;
			for (int32 K = 0; K < 4; ++K)
			{
				if (Rim[K] != nullptr)
				{
					Plane = FMath::Min(Plane, Rim[K]->Front);
					++Rims;
				}
			}
			if (Rims < 4)
			{
				Faults.Add(FString::Printf(TEXT("E2 eye at y %+.2f: no face round its housing in %d direction(s)"), CY, 4 - Rims));
				continue;
			}
			const double Limit = Plane + Tolerance;
			// E2: not proud of the face that rims the housing
			if (E.Front > Limit)
			{
				Faults.Add(FString::Printf(TEXT("E2 eye at y %+.2f: its face at x %.2f stands %.2f PROUD of the face round it (x %.2f)"), CY, E.Front, E.Front - Plane, Plane));
			}
			WorstBehind = FMath::Min(WorstBehind, Plane - E.Front);
			ScanOut(Limit, Dist, Rim);
			for (int32 K = 0; K < 4; ++K)
			{
				LeastBlack = FMath::Min(LeastBlack, Dist[K] - Step);
			}
			// E1: black beyond every edge, on the face
			for (int32 K = 0; K <= 8; ++K)
			{
				const double T = K / 8.0;
				const double Ys = E.Y0 - Margin + (E.Y1 - E.Y0 + 2.0 * Margin) * T;
				const double Zs = E.Z0 - Margin + (E.Z1 - E.Z0 + 2.0 * Margin) * T;
				const FVector2D Ring[4] = {FVector2D(Ys, E.Z0 - Margin), FVector2D(Ys, E.Z1 + Margin), FVector2D(E.Y0 - Margin, Zs), FVector2D(E.Y1 + Margin, Zs)};
				for (const FVector2D& P : Ring)
				{
					const FQaFaceBox* S = Face.FrontAt(P.X, P.Y, Limit);
					if (S == nullptr || !S->bDark)
					{
						Faults.AddUnique(FString::Printf(TEXT("E1 eye at y %+.2f: not black %.2f beyond its edge (%s at %.2f, %.2f)"),
							CY, Margin, S != nullptr ? *S->Mat.ToString() : TEXT("nothing"), P.X, P.Y));
					}
				}
			}
			// E4: a mirrored partner
			const bool bMate = Visible.ContainsByPredicate([&](const FQaFaceBox& F)
			{
				return FMath::Abs((F.Y0 + F.Y1) * 0.5 + CY) < 0.02 && FMath::Abs(F.Z0 - E.Z0) < 0.02 && FMath::Abs((F.Y1 - F.Y0) - (E.Y1 - E.Y0)) < 0.02;
			});
			if (!bMate)
			{
				Faults.Add(FString::Printf(TEXT("E4 eye at y %+.2f has no mirrored partner"), CY));
			}
		}
		// E3: visible halo light only over the black housing or an eye, behind the eyes' faces, not between the eyes
		double EyeFront = -TNumericLimits<double>::Max();
		for (const FQaFaceBox& E : Visible)
		{
			EyeFront = FMath::Max(EyeFront, E.Front);
		}
		int32 HaloPoints = 0;
		for (const FQaFaceBox& H : Face.Halos)
		{
			const int32 NY = FMath::Max(2, static_cast<int32>((H.Y1 - H.Y0) / 0.1));
			const int32 NZ = FMath::Max(2, static_cast<int32>((H.Z1 - H.Z0) / 0.1));
			int32 Bad = 0, Between = 0, Seen = 0;
			for (int32 IY = 0; IY <= NY; ++IY)
			{
				for (int32 IZ = 0; IZ <= NZ; ++IZ)
				{
					const double Y = H.Y0 + 0.01 + (H.Y1 - H.Y0 - 0.02) * IY / NY;
					const double Z = H.Z0 + 0.01 + (H.Z1 - H.Z0 - 0.02) * IZ / NZ;
					const FQaFaceBox* S = Face.FrontAt(Y, Z);
					if (S != nullptr && S->Front > H.Front + 1e-6)
					{
						continue;   // hidden behind a surface
					}
					++Seen;
					++HaloPoints;
					const double Off[5][2] = {{0, 0}, {HaloMargin, 0}, {-HaloMargin, 0}, {0, HaloMargin}, {0, -HaloMargin}};
					for (const auto& O : Off)
					{
						const FQaFaceBox* T = Face.FrontAt(Y + O[0], Z + O[1]);
						if (T == nullptr || !(T->bDark || T->bEye || T->Front > H.Front + 1e-6))
						{
							++Bad;
							break;
						}
					}
					if (FMath::Abs(Y) < InnerEdge - 0.01)
					{
						++Between;
					}
				}
			}
			const double HY = (H.Y0 + H.Y1) * 0.5;
			if (Bad > 0)
			{
				Faults.Add(FString::Printf(TEXT("E3 halo at y %+.2f: %d visible point(s) light something that is not the black housing"), HY, Bad));
			}
			if (H.Front > EyeFront + 1e-6 && Seen > 0)
			{
				Faults.Add(FString::Printf(TEXT("E3 halo at y %+.2f stands in front of the eyes' faces (x %.2f > %.2f)"), HY, H.Front, EyeFront));
			}
			if (Between > 0)
			{
				Faults.Add(FString::Printf(TEXT("E3 halo at y %+.2f reaches inward past the eyes at %d point(s)"), HY, Between));
			}
		}
		if (Faults.Num() > 0)
		{
			OutDetail = FString::Join(Faults, TEXT("; "));
			return false;
		}
		OutDetail = FString::Printf(TEXT("%d visible eyes, each face %.2f+ behind the face round its housing, black %.2f+ beyond every edge (black %.2f+ across its housing), %d halo pane(s) lighting only the black housing (%d visible points)"),
			Visible.Num(), WorstBehind, Margin, LeastBlack, Face.Halos.Num(), HaloPoints);
		return true;
	}

	/** Q25 on the costume a Dog wears now: parse the figure file it loaded and judge its eyes. */
	bool QaWornEyesInsideFace(const AWonderlandCompanionEmbodiment* Worn, FString& OutDetail)
	{
		if (Worn == nullptr)
		{
			OutDetail = TEXT("no costume to read");
			return false;
		}
		FString Text, Error;
		FWonderlandCompanionFigure Figure;
		const FString Path = Worn->GetFigurePath();
		if (!FFileHelper::LoadFileToString(Text, *Path) || !FWonderlandCompanionFigure::Parse(Text, Figure, Error))
		{
			OutDetail = FString::Printf(TEXT("could not read the worn figure '%s' (%s)"), *Path, *Error);
			return false;
		}
		const bool bOk = QaEyesInsideFace(Figure, OutDetail);
		OutDetail = FPaths::GetCleanFilename(Path) + TEXT(": ") + OutDetail;
		return bOk;
	}

	/** A costume's materials as painted right now (DescribeMaterialColours): the body's Color and its flame twin's. */
	struct FQaPaint
	{
		FLinearColor Body = FLinearColor::Black;
		FLinearColor Twin = FLinearColor::Black;
		FString Channel;   // what the figure declared: secondary, flame, flame_light ... or empty
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
				Paint.Channel = Bits[1];
				Paint.Body = Read(Bits[2]);
				Paint.Twin = Read(Bits[3]);
				Out.Add(Bits[0], Paint);
			}
		}
		return Out;
	}

	/** A flame skin's paint with FLAME at DEFAULT, taken before a FLAME is chosen (Q01b-Q01d). */
	TMap<FString, FQaPaint> GQaFlameBefore;

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

	/** A hue lifted 40% of the way toward white at its own peak: what AccentColour does for a pale core (`_light`). */
	FLinearColor QaLifted(const FLinearColor& C)
	{
		const float Top = FMath::Max3(C.R, C.G, C.B);
		return FLinearColor(C.R + (Top - C.R) * 0.40f, C.G + (Top - C.G) * 0.40f, C.B + (Top - C.B) * 0.40f, 1.0f);
	}

	bool QaIsWhite(const FLinearColor& C)
	{
		return C.R >= 0.995f && C.G >= 0.995f && C.B >= 0.995f;
	}

	/** A material painted in a hue on its body AND on its flame twin, when it has one -- both instances of the fire are drawn. */
	bool QaPaintedIn(const FQaPaint& Paint, const FLinearColor& Want)
	{
		const bool bTwin = FMath::Max3(Paint.Twin.R, Paint.Twin.G, Paint.Twin.B) > 1e-6f;
		return QaSameHue(Paint.Body, Want) && (!bTwin || QaSameHue(Paint.Twin, Want));
	}

	/** The same hue as before on both instances; a glow's heartbeat moves its brightness, never its hue. Black stays black. */
	bool QaHueKept(const FQaPaint& Was, const FQaPaint& Now)
	{
		auto Same = [](const FLinearColor& A, const FLinearColor& B)
		{
			const bool bDarkA = FMath::Max3(A.R, A.G, A.B) < 1e-4f;
			const bool bDarkB = FMath::Max3(B.R, B.G, B.B) < 1e-4f;
			return (bDarkA && bDarkB) || (!bDarkA && !bDarkB && QaSameHue(A, B));
		};
		return Same(Was.Body, Now.Body) && Same(Was.Twin, Now.Twin);
	}

	/**
	 * JACK FLAME'S COLOURS (founder, 2026-10-01: "Secondary Color controls suit/tie customization; Flame Color controls
	 * head flames, hand flames, foot flames, tail-tip flame"). The tie and the suit in the SECONDARY's hue; the fire and its
	 * pale core -- on the body AND the flame twin -- in the FLAME's hue, or the designed orange when FLAME is White; the
	 * suit still a deep, readable cloth and the collar still black.
	 */
	bool JackWears(const AWonderlandCompanionEmbodiment* Costume, const FLinearColor& WantSecondary, const FLinearColor& WantFlame, FString& OutDetail)
	{
		const TMap<FString, FQaPaint> P = QaPainted(Costume);
		const FQaPaint* Suit = P.Find(TEXT("suit"));
		const FQaPaint* Tie = P.Find(TEXT("heart"));
		const FQaPaint* Fire = P.Find(TEXT("flame"));
		const FQaPaint* Core = P.Find(TEXT("flamepale"));
		const FQaPaint* Stripe = P.Find(TEXT("stripe"));
		const FQaPaint* Collar = P.Find(TEXT("nightmare"));
		if (Suit == nullptr || Tie == nullptr || Fire == nullptr || Core == nullptr || Stripe == nullptr || Collar == nullptr)
		{
			OutDetail = FString::Printf(TEXT("Jack Flame's materials not all found (%d read)"), P.Num());
			return false;
		}
		// the designed fire is the figure's own orange (relay_dog_skins.py): flame 1.00,0.20,0.02, its pale core 1.00,0.44,0.06
		const bool bDesigned = QaIsWhite(WantFlame);
		const FLinearColor FireHue = bDesigned ? FLinearColor(1.00f, 0.20f, 0.02f) : WantFlame;
		const FLinearColor CoreHue = bDesigned ? FLinearColor(1.00f, 0.44f, 0.06f) : QaLifted(WantFlame);
		const bool bClothes = QaSameHue(Suit->Body, WantSecondary) && QaSameHue(Tie->Body, WantSecondary);
		const bool bFire = QaPaintedIn(*Fire, FireHue) && QaPaintedIn(*Core, CoreHue);
		const bool bReadable = QaLuminance(Stripe->Body) >= 2.5f * QaLuminance(Suit->Body) && FMath::Max3(Suit->Body.R, Suit->Body.G, Suit->Body.B) <= 0.34f;
		const bool bCollar = FMath::Max3(Collar->Body.R, Collar->Body.G, Collar->Body.B) <= 0.06f;
		OutDetail = FString::Printf(TEXT("secondary %s: suit %s, tie %s (%s); flame %s: fire %s twin %s, core %s twin %s (%s); pinstripes %.1fx the suit's luminance (>= 2.5); collar %s (kept black: %s)"),
			*QaRgb(WantSecondary), *QaRgb(Suit->Body), *QaRgb(Tie->Body), bClothes ? TEXT("match") : TEXT("DIFFER"),
			bDesigned ? TEXT("as designed") : *QaRgb(WantFlame), *QaRgb(Fire->Body), *QaRgb(Fire->Twin), *QaRgb(Core->Body), *QaRgb(Core->Twin),
			bFire ? TEXT("match") : TEXT("DIFFER"), QaLuminance(Stripe->Body) / FMath::Max(QaLuminance(Suit->Body), 1e-4f),
			*QaRgb(Collar->Body), bCollar ? TEXT("yes") : TEXT("NO"));
		return bClothes && bFire && bReadable && bCollar;
	}

	/**
	 * A FLAME SKIN'S FIRE AND NOTHING ELSE (founder, 2026-10-01: "independent from normal body/secondary color";
	 * Skeleton Flame's "skull/body are not recolored by it ... eyes remain glow treatment"). Between Before (taken with
	 * FLAME at DEFAULT) and now (a chosen FLAME): every material the figure tags `flame` / `flame_light` is in the chosen
	 * hue, lifted for the pale core, on its body and its twin; every other material keeps exactly the hue it had.
	 */
	bool QaFlameOnly(const AWonderlandCompanionEmbodiment* Costume, const TMap<FString, FQaPaint>& Before, const FLinearColor& Want, FString& OutDetail)
	{
		const TMap<FString, FQaPaint> After = QaPainted(Costume);
		int32 Fires = 0;
		int32 FiresOk = 0;
		int32 Others = 0;
		int32 Moved = 0;
		FString Missed;
		FString MovedNames;
		for (const TPair<FString, FQaPaint>& Entry : After)
		{
			if (Entry.Value.Channel == TEXT("flame") || Entry.Value.Channel == TEXT("flame_light"))
			{
				++Fires;
				const FLinearColor Hue = Entry.Value.Channel == TEXT("flame_light") ? QaLifted(Want) : Want;
				if (QaPaintedIn(Entry.Value, Hue))
				{
					++FiresOk;
				}
				else
				{
					Missed += Entry.Key + TEXT(" ");
				}
				continue;
			}
			++Others;
			const FQaPaint* Was = Before.Find(Entry.Key);
			if (Was == nullptr || !QaHueKept(*Was, Entry.Value))
			{
				++Moved;
				MovedNames += Entry.Key + TEXT(" ");
			}
		}
		OutDetail = FString::Printf(TEXT("FLAME %s: %d fire material(s), %d in its hue on body and twin%s%s; %d other material(s), %d moved%s%s"),
			*QaRgb(Want), Fires, FiresOk, Missed.IsEmpty() ? TEXT("") : TEXT(" -- missed: "), *Missed, Others, Moved,
			MovedNames.IsEmpty() ? TEXT("") : TEXT(" -- moved: "), *MovedNames);
		return Fires > 0 && FiresOk == Fires && Moved == 0 && After.Num() == Before.Num();
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

	/**
	 * THE PRIVATE BETA'S PLAYER SESSION, MEASURED IN THE PACKAGE. Q00.2: no console keys and no engine debug keys in a
	 * player's session. Q00.3: the local AI services are not contacted and both clients say why in the beta's own
	 * sentence. Q00.4: the content the package used to drop is there -- the engine unlit material the mission orb, the
	 * Dog's beam and props and the wardrobe backdrop load by path (B13), and the approved night's practical lights (B14).
	 */
	void CheckBetaSession(FQaRun& Run, UWorld* World)
	{
		const APlayerController* Controller = World->GetFirstPlayerController();
		const UInputSettings* Input = GetDefault<UInputSettings>();
		const int32 ConsoleKeys = Input != nullptr ? Input->ConsoleKeys.Num() : -1;
		const int32 DebugKeys = (Controller != nullptr && Controller->PlayerInput != nullptr) ? Controller->PlayerInput->DebugExecBindings.Num() : -1;
		// THE GAMEPLAY DEBUGGER: auto-creation off, and no manager actor in the world (the apostrophe has nothing to open)
		const IConsoleVariable* AutoCreate = IConsoleManager::Get().FindConsoleVariable(TEXT("GameplayDebugger.AutoCreateGameplayDebuggerManager"));
		int32 DebuggerManagers = 0;
		for (TActorIterator<AActor> It(World); It; ++It)
		{
			DebuggerManagers += It->GetClass()->GetName().Contains(TEXT("GameplayDebuggerPlayerManager")) ? 1 : 0;
		}
		const bool bDebuggerOff = (AutoCreate == nullptr || !AutoCreate->GetBool()) && DebuggerManagers == 0;
		QaCheck(Run, TEXT("Q00.2"), !WonderlandBeta::IsDeveloperSession() && ConsoleKeys == 0 && DebugKeys == 0 && bDebuggerOff,
			FString::Printf(TEXT("player session %s; console keys %d, engine debug key bindings %d (both must be 0); gameplay debugger %s (%d managers); build '%s'"),
				WonderlandBeta::IsDeveloperSession() ? TEXT("NO (developer)") : TEXT("yes"), ConsoleKeys, DebugKeys,
				bDebuggerOff ? TEXT("off") : TEXT("ON"), DebuggerManagers, *WonderlandBeta::BuildLabel()));

		UGameInstance* Instance = World->GetGameInstance();
		const UWonderlandSidekickSubsystem* Sidekicks = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
		const UWonderlandJuliusConnectSubsystem* Connect = Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusConnectSubsystem>() : nullptr;
		const FString Sentence = WonderlandBeta::AiUnavailableSentence();
		const bool bSidekicksOff = Sidekicks != nullptr && Sidekicks->GetLink() == EWonderlandSidekickLink::Offline && Sidekicks->GetLinkProblem() == Sentence;
		const bool bConnectOff = Connect != nullptr && Connect->GetLink() == EJuliusConnectLink::Offline && Connect->GetLinkProblem() == Sentence;
		QaCheck(Run, TEXT("Q00.3"), !WonderlandBeta::UseLocalAiServices() && bSidekicksOff && bConnectOff,
			FString::Printf(TEXT("local AI services %s; companions link '%s'; Julius Connect '%s'"),
				WonderlandBeta::UseLocalAiServices() ? TEXT("CONTACTED") : TEXT("off"),
				Sidekicks != nullptr ? *Sidekicks->GetLinkProblem() : TEXT("(none)"),
				Connect != nullptr ? *Connect->GetLinkProblem() : TEXT("(none)")));

		const UMaterialInterface* Unlit = LoadObject<UMaterialInterface>(nullptr,
			TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial"));
		const UWonderlandPracticalLightsSubsystem* Lamps = World->GetSubsystem<UWonderlandPracticalLightsSubsystem>();
		const int32 Defined = Lamps != nullptr ? Lamps->GetDefinedCount() : -1;
		QaCheck(Run, TEXT("Q00.4"), Unlit != nullptr && Defined > 1000,
			FString::Printf(TEXT("engine unlit material %s (mission orb, Dog beam and props, wardrobe backdrop); practical lights defined %d (want > 1000)"),
				Unlit != nullptr ? TEXT("loaded") : TEXT("MISSING"), Defined));

		// Q00.5 (founder, 2026-10-01, D3): a tester's build names the companions by their roles, and opens no sample browser
		// window by either route -- the window itself or the workspace's Ctrl+W
		const UWonderlandCompanionPreviewSettings* Names = GetDefault<UWonderlandCompanionPreviewSettings>();
		const bool bRoleNames = Names != nullptr && Names->LlmCompanionName == TEXT("LLM COMPANION") && Names->AgentName == TEXT("JHINN");
		UWonderlandUiSubsystem* Ui = QaUi(World);
		const bool bWindowRefused = Ui != nullptr && !Ui->OpenWonderWebWindow(FName(TEXT("browser")));
		const bool bSpawnRefused = Ui != nullptr && !Ui->SpawnWonderWebWindow();
		QaCheck(Run, TEXT("Q00.5"), bRoleNames && bWindowRefused && bSpawnRefused,
			FString::Printf(TEXT("companions named '%s' and '%s' (want LLM COMPANION / JHINN); sample browser window refused %s, Ctrl+W refused %s"),
				Names != nullptr ? *Names->LlmCompanionName : TEXT("?"), Names != nullptr ? *Names->AgentName : TEXT("?"),
				bWindowRefused ? TEXT("yes") : TEXT("NO"), bSpawnRefused ? TEXT("yes") : TEXT("NO")));

		// Q00.6 (Second Wonderland, RC3): the game window says which build it is -- the taskbar and Alt+Tab show this title
		FString Title;
		if (GEngine != nullptr && GEngine->GameViewport != nullptr && GEngine->GameViewport->GetWindow().IsValid())
		{
			Title = GEngine->GameViewport->GetWindow()->GetTitle().ToString();
		}
		QaCheck(Run, TEXT("Q00.6"), Title.Contains(WonderlandBeta::BuildLabel()),
			FString::Printf(TEXT("window title '%s' (want it to carry '%s')"), *Title, *WonderlandBeta::BuildLabel()));
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
			const bool bPainted = D != nullptr && JackWears(D->GetCostume(), PersistColour, PersistFlame, Paint);
			const bool bSaved = Settings != nullptr && Settings->Secondary.Equals(PersistColour, 0.002f) && Settings->bSecondaryChosen;
			// AND THE FLAME, from its own file (founder, 2026-10-01): chosen in the first boot, back in this one
			const bool bFlameSaved = WonderlandMascotStyle::FlameColour().Equals(PersistFlame, 0.002f);
			QaFrame(Run, TEXT("06_after_restart_jack_rose"));
			QaCheck(Run, TEXT("Q12"), Worn == FName(TEXT("jack_flame")) && bSaved && bFlameSaved && bPainted,
				FString::Printf(TEXT("after a restart: skin %s (want jack_flame); saved secondary %s chosen %s (want %s); saved flame %s (want %s); painted: %s"),
					*Worn.ToString(), Settings != nullptr ? *QaRgb(Settings->Secondary) : TEXT("?"),
					Settings != nullptr && Settings->bSecondaryChosen ? TEXT("yes") : TEXT("no"), *QaRgb(PersistColour),
					*QaRgb(WonderlandMascotStyle::FlameColour()), *QaRgb(PersistFlame), *Paint));
			// THE CONTRACTS THE FIRST BOOT WROTE THROUGH THE TERMINAL: all eight back, none reopened (B04 used to keep six)
			UWonderlandMissionTaskSubsystem* Set = UWonderlandUiTestLibrary::GetMissionTasks(World);
			int32 Open = 0;
			if (Set != nullptr)
			{
				for (const FWonderlandMissionTask& Task : Set->GetTasks())
				{
					Open += Task.bInWorkspace ? 1 : 0;
				}
			}
			QaCheck(Run, TEXT("Q14"), Set != nullptr && Set->NumContracts() == 8 && Open == 0,
				FString::Printf(TEXT("after a restart: %d Mission Contracts restored (want all 8 -- more than the six tabs), %d reopened (want 0)"),
					Set != nullptr ? Set->NumContracts() : -1, Open));
			const UWonderlandUiSubsystem* U = QaUi(World);
			QaCheck(Run, TEXT("Q16"), U != nullptr && !U->IsWelcomeOpen() && WonderlandBeta::HasSeenWelcome(),
				FString::Printf(TEXT("the welcome is not shown again after a restart (open %s, remembered %s)"),
					U != nullptr && U->IsWelcomeOpen() ? TEXT("YES") : TEXT("no"), WonderlandBeta::HasSeenWelcome() ? TEXT("yes") : TEXT("NO")));
			QaNextStep(Run);
		}
		else if (Run.Step == 1)
		{
			// DELETE THEM THROUGH THE TERMINAL, as a player would: /tasks delete 1, eight times
			UWonderlandUiSubsystem* U = QaUi(World);
			UWonderlandMissionTaskSubsystem* Set = UWonderlandUiTestLibrary::GetMissionTasks(World);
			if (U != nullptr)
			{
				for (int32 Index = 0; Index < 8; ++Index)
				{
					U->SubmitTerminalLine(TEXT("/tasks delete 1"));
				}
			}
			const bool bFileGone = !IFileManager::Get().FileExists(*UWonderlandMissionTaskSubsystem::SlotPath());
			QaCheck(Run, TEXT("Q15"), Set != nullptr && Set->NumContracts() == 0 && bFileGone,
				FString::Printf(TEXT("/tasks delete through the terminal: %d contracts left (want 0), save file %s"),
					Set != nullptr ? Set->NumContracts() : -1, bFileGone ? TEXT("removed") : TEXT("STILL THERE")));
			GEngine->Exec(World, TEXT("wl.Mascot.Reset"));
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), *Run.RestoreSkin));
			QaNextStep(Run);
		}
		else if (Run.Step == 2 && In >= 3.0)
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("WLQA restored skin %s and the designed colours"), *Run.RestoreSkin);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLQA END pass=%d fail=%d"), Run.Pass, Run.Fail);
			GQaRun.Reset();
			GEngine->Exec(World, TEXT("quit"));
			return false;
		}
		return true;
	}

	/**
	 * THE THIRD BOOT, ON FILES CORRUPTED ON PURPOSE (private beta, R8 / R9). boot_test_package_qa.ps1 plants, before it:
	 * the first boot's sealed contracts file cut short, with a stale .tmp beside it; a command-presets file whose "class
	 * name" is 3,000 characters long (the old loader made an FName of it -- fatal, on every start); a 2,000-character skin
	 * id; and a discoveries file holding one good id and one 2,000-character line. The game must start, set the bad files
	 * aside or skip the bad lines, keep the good one, and seal the next save it writes.
	 */
	bool HostileTick(FQaRun& Run, UWorld* World)
	{
		const double In = QaNow() - Run.StepStart;
		if (Run.Step == 0 && In >= 12.0)
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("WLQA BEGIN hostile saves"));
			IFileManager& Files = IFileManager::Get();
			const FString ContractsPath = UWonderlandMissionTaskSubsystem::SlotPath();
			const FString SaveDir = FPaths::GetPath(ContractsPath);
			TArray<FString> RefusedContracts;
			Files.FindFiles(RefusedContracts, *(SaveDir / TEXT("WonderlandMissionContracts.refused-*.sav")), /*Files*/ true, /*Directories*/ false);
			TArray<FString> RefusedPresets;
			Files.FindFiles(RefusedPresets, *(SaveDir / TEXT("WonderlandCommandPresets.refused-*.sav")), /*Files*/ true, /*Directories*/ false);
			const UWonderlandMissionTaskSubsystem* Set = UWonderlandUiTestLibrary::GetMissionTasks(World);
			const bool bTmpGone = !Files.FileExists(*(ContractsPath + TEXT(".tmp")));
			const bool bCutGone = !Files.FileExists(*ContractsPath);
			QaCheck(Run, TEXT("Q21.1"), Set != nullptr && Set->NumContracts() == 0 && RefusedContracts.Num() == 1 && bCutGone && bTmpGone,
				FString::Printf(TEXT("a cut-short contracts file: %d restored (want 0), %d set aside (want 1), original %s, stale .tmp %s"),
					Set != nullptr ? Set->NumContracts() : -1, RefusedContracts.Num(), bCutGone ? TEXT("moved") : TEXT("STILL THERE"),
					bTmpGone ? TEXT("discarded") : TEXT("STILL THERE")));

			UGameInstance* Instance = World->GetGameInstance();
			const UWonderlandCommandPresetSubsystem* Presets = Instance != nullptr ? Instance->GetSubsystem<UWonderlandCommandPresetSubsystem>() : nullptr;
			const FString FirstLayout = Presets != nullptr && Presets->GetLayoutCount() > 0 ? Presets->GetLayoutName(0) : FString(TEXT("?"));
			QaCheck(Run, TEXT("Q21.2"), Presets != nullptr && RefusedPresets.Num() == 1 && Presets->GetLayoutCount() == 1 && FirstLayout == TEXT("DEFAULT"),
				FString::Printf(TEXT("a presets file with a 3,000-character class name: %d set aside (want 1); %d layout(s), the first '%s' (want DEFAULT)"),
					RefusedPresets.Num(), Presets != nullptr ? Presets->GetLayoutCount() : -1, *FirstLayout));

			const UWonderlandRelaySkinSubsystem* Skins = Instance != nullptr ? Instance->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
			const ARelayDogCharacter* D = QaDog(World);
			const FName Equipped = Skins != nullptr ? Skins->GetEquippedSkinId() : NAME_None;
			const FName Worn = D != nullptr ? D->GetWornSkinId() : NAME_None;
			QaCheck(Run, TEXT("Q21.3"), Equipped == FName(TEXT("relay_og")) && Worn == FName(TEXT("relay_og")),
				FString::Printf(TEXT("a 2,000-character remembered skin id: equipped %s, worn %s (want relay_og)"), *Equipped.ToString(), *Worn.ToString()));

			const UWonderlandTerritorySubsystem* Territory = World->GetSubsystem<UWonderlandTerritorySubsystem>();
			const bool bGoodKept = Territory != nullptr && Territory->IsDiscovered(FName(TEXT("noctis")));
			QaCheck(Run, TEXT("Q21.4"), bGoodKept,
				FString::Printf(TEXT("a discoveries file with a 2,000-character line: the good line (noctis) %s; %d discovered"),
					bGoodKept ? TEXT("kept") : TEXT("LOST"), Territory != nullptr ? Territory->GetDiscoveredCount() : -1));

			// Q21.6: a FLAME file of 2,000 characters means the designed fire, and the next pick rewrites it whole
			const bool bDesignedAtBoot = !WonderlandMascotStyle::HasChosenFlame();
			GEngine->Exec(World, TEXT("wl.Mascot.Flame 0.30,0.90,1.00"));
			FString Rewritten;
			FLinearColor ReadBack = FLinearColor::Black;
			const FString FlamePath = FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("FlameColour.txt"));
			const bool bRewritten = FFileHelper::LoadFileToString(Rewritten, *FlamePath) && WonderlandMascotStyle::ParseFlameColour(Rewritten, ReadBack)
				&& ReadBack.Equals(FLinearColor(0.30f, 0.90f, 1.00f, 1.0f), 0.002f);
			GEngine->Exec(World, TEXT("wl.Mascot.Flame default"));
			QaCheck(Run, TEXT("Q21.6"), bDesignedAtBoot && bRewritten,
				FString::Printf(TEXT("a 2,000-character flame file: the fire %s at start; the next pick rewrote it whole: %s ('%s')"),
					bDesignedAtBoot ? TEXT("as designed") : TEXT("RECOLOURED"), bRewritten ? TEXT("yes") : TEXT("NO"), *Rewritten.Left(40)));

			// Q21.7: the reader refuses every hostile shape and takes a real colour
			const TCHAR* const Hostile[] = { TEXT("nan nan nan"), TEXT("-5 2 9e9"), TEXT(""), TEXT("0.5 0.5"), TEXT("1.5 0 0"),
				TEXT("0.2 0.2 0.2 0.2"), TEXT("inf 0 0"), TEXT("0x10 0 0") };
			int32 Refused = 0;
			FString Taken;
			for (const TCHAR* Text : Hostile)
			{
				FLinearColor Ignored;
				if (!WonderlandMascotStyle::ParseFlameColour(Text, Ignored))
				{
					++Refused;
				}
				else
				{
					Taken += FString::Printf(TEXT("'%s' "), Text);
				}
			}
			FLinearColor Good;
			const bool bGood = WonderlandMascotStyle::ParseFlameColour(TEXT(" 0.2 0.86 0.6 "), Good) && Good.Equals(FLinearColor(0.2f, 0.86f, 0.6f, 1.0f), 0.002f);
			FLinearColor Long;
			const bool bLongRefused = !WonderlandMascotStyle::ParseFlameColour(FString::ChrN(2000, TEXT('x')), Long);
			QaCheck(Run, TEXT("Q21.7"), Refused == (int32)UE_ARRAY_COUNT(Hostile) && bGood && bLongRefused,
				FString::Printf(TEXT("the flame file reader: %d of %d hostile texts refused%s%s; 2,000 characters refused %s; a real colour read: %s"),
					Refused, (int32)UE_ARRAY_COUNT(Hostile), Taken.IsEmpty() ? TEXT("") : TEXT(" -- TAKEN: "), *Taken,
					bLongRefused ? TEXT("yes") : TEXT("NO"), bGood ? TEXT("yes") : TEXT("NO")));
			QaNextStep(Run);
		}
		else if (Run.Step == 1)
		{
			// AND THE NEXT SAVE IS SEALED: a contract through the terminal, read back as bytes, then deleted again
			UWonderlandUiSubsystem* U = QaUi(World);
			UWonderlandMissionTaskSubsystem* Set = UWonderlandUiTestLibrary::GetMissionTasks(World);
			bool bSealed = false;
			int32 Made = -1;
			if (U != nullptr && Set != nullptr)
			{
				U->PressAddTaskForQa();
				U->SubmitTerminalLine(TEXT("QA contract after a refused file: is it saved sealed?"));
				Made = Set->NumContracts();
				TArray<uint8> Bytes;
				if (FFileHelper::LoadFileToArray(Bytes, *UWonderlandMissionTaskSubsystem::SlotPath()) && Bytes.Num() > 16)
				{
					bSealed = FMemory::Memcmp(Bytes.GetData() + Bytes.Num() - 16, "WLSEAL01", 8) == 0;
				}
				U->SubmitTerminalLine(TEXT("/tasks delete 1"));
			}
			QaCheck(Run, TEXT("Q21.5"), Made == 1 && bSealed && Set != nullptr && Set->NumContracts() == 0,
				FString::Printf(TEXT("after the refusal a new contract is written (%d) and saved sealed: %s; deleted again, %d left"),
					Made, bSealed ? TEXT("yes") : TEXT("NO"), Set != nullptr ? Set->NumContracts() : -1));
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
		if (Run.bHostile)
		{
			return HostileTick(Run, World);
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
				// THE FIRST LAUNCH ON A MACHINE SHOWS THE WELCOME; ANY LATER ONE DOES NOT (private beta, B19)
				const bool bWelcomeOpen = U != nullptr && U->IsWelcomeOpen();
				QaFrame(Run, TEXT("00_first_launch"));
				QaCheck(Run, TEXT("Q00.1"), bWelcomeOpen == !Run.bWelcomeSeenAtBoot,
					FString::Printf(TEXT("welcome %s; dismissed on this machine before %s"),
						bWelcomeOpen ? TEXT("shown") : TEXT("not shown"), Run.bWelcomeSeenAtBoot ? TEXT("yes") : TEXT("no")));
				if (U != nullptr)
				{
					U->DismissWelcome();
				}
				CheckBetaSession(Run, World);
				QaNextStep(Run);
			}
			break;
		case 1: // THE SECONDARY AND THE FLAME, through the same console doors the Wardrobe and the Menu write through, read back
		        // off the costume -- both instances of the fire -- and photographed (founder, 2026-10-01: a separate Flame Color)
		{
			const ARelayDogCharacter* D = QaDog(World);
			const AWonderlandCompanionEmbodiment* Costume = D != nullptr ? D->GetCostume() : nullptr;
			const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>();
			const FLinearColor Azure(0.26f, 0.56f, 1.0f, 1.0f);
			const FLinearColor Jade(0.20f, 0.86f, 0.60f, 1.0f);
			const FLinearColor Gold(1.00f, 0.78f, 0.26f, 1.0f);
			const FLinearColor Crimson(0.82f, 0.14f, 0.18f, 1.0f);
			if (Run.Sub == 0)
			{
				GEngine->Exec(World, TEXT("wl.Mascot.Flame default"));
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
				// Q01: an AZURE secondary moves Jack Flame's tie and suit -- and NOT the fire, which stays the designed orange
				FString Detail;
				const bool bOk = D != nullptr && Settings != nullptr && D->GetWornSkinId() == FName(TEXT("jack_flame"))
					&& JackWears(Costume, Settings->Secondary, FLinearColor::White, Detail);
				QaFrame(Run, TEXT("01_jack_flame_azure"));
				QaCheck(Run, TEXT("Q01"), bOk, FString::Printf(TEXT("Jack Flame with an AZURE secondary and the designed fire: %s"), *Detail));
				GQaFlameBefore = QaPainted(Costume);
				GEngine->Exec(World, TEXT("wl.Mascot.Flame 0.20,0.86,0.60"));
				Run.Sub = 3;
			}
			else if (Run.Sub == 3 && In >= 7.0)
			{
				// Q01b: a JADE flame moves the head, paw, foot and tail fire on the body and the twin, and nothing else
				FString Clothes;
				FString Only;
				const bool bClothes = Settings != nullptr && JackWears(Costume, Settings->Secondary, Jade, Clothes);
				const bool bOnly = QaFlameOnly(Costume, GQaFlameBefore, Jade, Only);
				const bool bRow = WonderlandMascotStyle::WornSkinHasFlame();
				QaFrame(Run, TEXT("01b_jack_jade_flame_azure_suit"));
				QaCheck(Run, TEXT("Q01b"), bClothes && bOnly && bRow,
					FString::Printf(TEXT("Jack Flame, a JADE flame over an AZURE secondary: %s | %s | FLAME row %s"), *Clothes, *Only, bRow ? TEXT("shown") : TEXT("HIDDEN")));
				// THE COLORS PAGE WITH ITS FLAME ROW, at this window's size: the page grows in place (the founder's layout rule)
				if (U != nullptr)
				{
					if (!U->IsMenuOpen())
					{
						U->ToggleMenu();
					}
					U->ShowMenuTab(TEXT("COLORS"));
				}
				Run.Sub = 4;
			}
			else if (Run.Sub == 4 && In >= 8.5)
			{
				QaFrame(Run, TEXT("01h_colors_page_flame_row"));
				if (U != nullptr && U->IsMenuOpen())
				{
					U->ToggleMenu();
				}
				GEngine->Exec(World, TEXT("wl.Mascot.Flame default"));
				GEngine->Exec(World, TEXT("wl.Skins.Wear skeleton_flame"));
				Run.Sub = 5;
			}
			else if (Run.Sub == 5 && In >= 11.5)
			{
				GQaFlameBefore = QaPainted(Costume);
				GEngine->Exec(World, TEXT("wl.Mascot.Flame 1.0,0.78,0.26"));
				Run.Sub = 6;
			}
			else if (Run.Sub == 6 && In >= 13.5)
			{
				// Q01c: Skeleton Flame's spectral fire in GOLD; the grey skull, the soul glows and the eyes keep their hue
				FString Only;
				const bool bOk = D != nullptr && D->GetWornSkinId() == FName(TEXT("skeleton_flame"))
					&& QaFlameOnly(Costume, GQaFlameBefore, Gold, Only) && WonderlandMascotStyle::WornSkinHasFlame();
				QaFrame(Run, TEXT("01c_skeleton_gold_flame"));
				QaCheck(Run, TEXT("Q01c"), bOk, FString::Printf(TEXT("Skeleton Flame, a GOLD flame: %s"), *Only));
				GEngine->Exec(World, TEXT("wl.Mascot.Flame default"));
				GEngine->Exec(World, TEXT("wl.Skins.Wear baal"));
				Run.Sub = 7;
			}
			else if (Run.Sub == 7 && In >= 16.5)
			{
				GQaFlameBefore = QaPainted(Costume);
				GEngine->Exec(World, TEXT("wl.Mascot.Flame 0.82,0.14,0.18"));
				Run.Sub = 8;
			}
			else if (Run.Sub == 8 && In >= 18.5)
			{
				// Q01d: Baal's blue flame layer in CRIMSON; the armour, antlers, gold and bone keep their hue
				FString Only;
				const bool bOk = D != nullptr && D->GetWornSkinId() == FName(TEXT("baal"))
					&& QaFlameOnly(Costume, GQaFlameBefore, Crimson, Only) && WonderlandMascotStyle::WornSkinHasFlame();
				QaFrame(Run, TEXT("01d_baal_crimson_flame"));
				QaCheck(Run, TEXT("Q01d"), bOk, FString::Printf(TEXT("Baal, a CRIMSON flame: %s"), *Only));
				// the crimson stays chosen: the next steps visit the skins without fire and come back to one
				GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
				Run.Sub = 9;
			}
			else if (Run.Sub == 9 && In >= 21.0)
			{
				Run.bOgHidden = D != nullptr && D->GetWornSkinId() == FName(TEXT("relay_og")) && !WonderlandMascotStyle::WornSkinHasFlame();
				GEngine->Exec(World, TEXT("wl.Skins.Wear celestial_light"));
				Run.Sub = 10;
			}
			else if (Run.Sub == 10 && In >= 23.5)
			{
				Run.bClHidden = D != nullptr && D->GetWornSkinId() == FName(TEXT("celestial_light")) && !WonderlandMascotStyle::WornSkinHasFlame();
				GEngine->Exec(World, TEXT("wl.Skins.Wear jack_flame"));
				Run.Sub = 11;
			}
			else if (Run.Sub == 11 && In >= 26.5)
			{
				// Q01e: the FLAME row is gone on Relay OG and Celestial Light and back on Jack Flame, whose fire comes back in the
				// CHOSEN crimson, not the designed orange; the azure tie and suit come back with it
				FString Detail;
				const bool bBack = D != nullptr && Settings != nullptr && D->GetWornSkinId() == FName(TEXT("jack_flame"))
					&& JackWears(Costume, Settings->Secondary, Crimson, Detail) && WonderlandMascotStyle::WornSkinHasFlame();
				QaCheck(Run, TEXT("Q01e"), Run.bOgHidden && Run.bClHidden && bBack,
					FString::Printf(TEXT("FLAME row hidden on Relay OG %s, on Celestial Light %s; back on Jack Flame in the chosen flame: %s"),
						Run.bOgHidden ? TEXT("yes") : TEXT("NO"), Run.bClHidden ? TEXT("yes") : TEXT("NO"), *Detail));
				GEngine->Exec(World, TEXT("wl.Mascot.Flame default"));
				Run.Sub = 12;
			}
			else if (Run.Sub == 12 && In >= 28.5)
			{
				// Q01f: DEFAULT puts the designed orange back on the body and the twin, and the secondary is untouched
				FString Detail;
				const bool bOk = Settings != nullptr && !WonderlandMascotStyle::HasChosenFlame()
					&& JackWears(Costume, Settings->Secondary, FLinearColor::White, Detail) && QaSameHue(Settings->Secondary, Azure);
				QaFrame(Run, TEXT("01f_jack_designed_fire"));
				QaCheck(Run, TEXT("Q01f"), bOk, FString::Printf(TEXT("FLAME back to DEFAULT: %s"), *Detail));
				QaNextStep(Run);
			}
			break;
		}
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
				// Q25 (founder correction, 2026-10-01): the costume's eyes INSIDE its face, judged on the figure it loaded.
				// Relay OG wears no costume: its canon body is the reference the founder named, and it is not judged here.
				if (Which > 0)
				{
					FString EyeDetail;
					const bool bEyes = QaWornEyesInsideFace(Worn, EyeDetail);
					QaCheck(Run, *FString::Printf(TEXT("Q25.%d"), Which + 1), bEyes, FString::Printf(TEXT("%s: %s"), Roster[Which], *EyeDetail));
				}
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
		case 12: // THE CREATION LOOP THROUGH THE TERMINAL (private beta, B01 / B04): +, type the objective, Enter -- eight times
		{
			UWonderlandMissionTaskSubsystem* Set = UWonderlandUiTestLibrary::GetMissionTasks(World);
			if (U == nullptr || Set == nullptr)
			{
				QaCheck(Run, TEXT("Q13"), false, TEXT("no UI or task set"));
				QaNextStep(Run);
				break;
			}
			if (Run.Sub == 0)
			{
				Set->ClearAllTasksForDevelopment();
				Run.CreationMisses = 0;
				Run.Sub = 1;
			}
			else if (Run.Sub >= 1 && Run.Sub <= 8)
			{
				// + makes a gray draft and selects it; the line typed is its objective; the tab's X then closes it, so the
				// six open tabs never stop the next +. Eight is more than the six the old restore kept.
				const bool bPlus = U->PressAddTaskForQa();
				U->SubmitTerminalLine(FString::Printf(TEXT("QA contract %d: prove the beta's creation loop"), Run.Sub));
				const FWonderlandMissionTask* Made = Set->GetSelectedTask();
				const bool bQueued = Made != nullptr && Made->State == EWonderlandTaskState::Queued && Made->Source == EWonderlandTaskSource::Local;
				if (Made != nullptr)
				{
					Set->CloseFromWorkspace(Made->LocalId);
				}
				Run.CreationMisses += (bPlus && bQueued) ? 0 : 1;
				++Run.Sub;
			}
			else
			{
				const bool bFile = IFileManager::Get().FileExists(*UWonderlandMissionTaskSubsystem::SlotPath());
				QaCheck(Run, TEXT("Q13"), Set->NumContracts() == 8 && bFile && Run.CreationMisses == 0,
					FString::Printf(TEXT("+ then a typed objective, 8 times: %d QUEUED local Mission Contracts (want 8), %d misses, saved to %s: %s"),
						Set->NumContracts(), Run.CreationMisses, *UWonderlandMissionTaskSubsystem::SlotPath(), bFile ? TEXT("yes") : TEXT("NO")));
				QaNextStep(Run);
			}
			break;
		}
		case 13: // THE BETA'S OTHER PLAYER PATHS (private beta, RC3): the simulated mission, /pa, bad input, the contract limit
		{
			UWonderlandMissionTaskSubsystem* Set = UWonderlandUiTestLibrary::GetMissionTasks(World);
			UWonderlandMissionSubsystem* Missions = UWonderlandUiTestLibrary::GetMission(World);
			if (U == nullptr || Set == nullptr || Missions == nullptr)
			{
				QaCheck(Run, TEXT("Q17"), false, TEXT("no UI, task set or mission subsystem"));
				QaNextStep(Run);
				break;
			}
			SWonderlandCompanionConsole* Llm = U->GetCompanionConsoleForQa(0);
			SWonderlandCompanionConsole* Agent = U->GetCompanionConsoleForQa(1);
			if (Run.Sub == 0)
			{
				// Q17 (B18): the call the Missions panel's WATCH A SIMULATED MISSION button makes -- Scenario D, ten
				// seconds an event -- and every surface keeps saying SIMULATED while it plays
				Run.bScenarioStarted = Missions->PlayScenario(FName(TEXT("D")), 10.0f);
				// THE TERMINALS UP (Ctrl+T), so the companion consoles are drawn while the mission plays and their frames show them
				Run.bTerminalOpened = !U->IsLiveTerminalOpen();
				if (Run.bTerminalOpened)
				{
					U->ToggleLiveTerminal();
				}
				Run.Sub = 1;
			}
			else if (Run.Sub == 1 && In >= 4.0)
			{
				const FString Badge = Missions->GetProvenanceBadge();
				const FString Banner = Missions->GetProvenanceBanner();
				const bool bRunning = Missions->IsFixtureRunning();
				const bool bSaysSimulated = Badge.Contains(TEXT("SIMULATED")) || Banner.Contains(TEXT("SIMULATED"));
				QaFrame(Run, TEXT("07_simulated_mission"));
				QaCheck(Run, TEXT("Q17"), Run.bScenarioStarted && bRunning && bSaysSimulated && Missions->IsDevelopmentPreview(),
					FString::Printf(TEXT("the Missions panel's simulated mission: started %s, playing %s, badge '%s', banner '%s'"),
						Run.bScenarioStarted ? TEXT("yes") : TEXT("NO"), bRunning ? TEXT("yes") : TEXT("NO"), *Badge, *Banner.Left(120)));
				Run.Sub = 7;
			}
			else if (Run.Sub == 7)
			{
				// THE COMPANIONS JOIN WHEN THE MISSION IS AT ITS SITE, after the trip there -- 3 s in one run, 12 s in another
				// (the first QA on the console sampled before they had joined). Sampling starts when both are working.
				if ((Llm != nullptr && Agent != nullptr && Llm->IsPulsing() && Agent->IsPulsing()) || In >= 45.0)
				{
					Run.ConsoleLines = Llm != nullptr ? Llm->GetLineCount() : 0;
					Run.ConsoleElapsed = Llm != nullptr ? Llm->GetElapsedSeconds() : 0;
					Run.ConsoleAt = In;
					Run.Sub = 2;
				}
			}
			else if (Run.Sub == 2)
			{
				// SAMPLED EVERY TICK FOR FIVE SECONDS: the mark's shapes, the verb's colour, and whether the status row ever
				// leaked into the history (it must update in place)
				SWonderlandCompanionConsole* Both[2] = {Llm, Agent};
				for (int32 Which = 0; Which < 2; ++Which)
				{
					if (Both[Which] != nullptr && Both[Which]->GetEmblemStage() >= 0)
					{
						Run.ConsoleStages[Which] |= 1 << Both[Which]->GetEmblemStage();
					}
				}
				if (Llm != nullptr)
				{
					const FColor Verb = Llm->GetVerbColour().ToFColor(true);
					Run.bVerbRed |= Verb.G < Verb.R * 0.62f;
					Run.bVerbPale |= Verb.G > Verb.R * 0.85f && Verb.B > Verb.R * 0.70f;
					for (int32 Line = 0; Line < Llm->GetLineCount(); ++Line)
					{
						const FString Text = Llm->GetLineText(Line);
						Run.bStatusInHistory |= Text.Contains(TEXT("\u2026 (")) && Text.Contains(TEXT("\u2193"));
					}
				}
				if (In >= Run.ConsoleAt + 2.5 && !Run.bConsoleFrame)
				{
					Run.bConsoleFrame = true;
					QaFrame(Run, TEXT("07b_companion_consoles"));
				}
				if (In >= Run.ConsoleAt + 5.0)
				{
					auto Shapes = [](int32 Bits) { int32 N = 0; for (int32 B = 0; B < 6; ++B) { N += (Bits >> B) & 1; } return N; };
					const int32 Lines = Llm != nullptr ? Llm->GetLineCount() : 0;
					const int32 Elapsed = Llm != nullptr ? Llm->GetElapsedSeconds() : 0;
					const double Span = In - Run.ConsoleAt;
					const FString Row = Llm != nullptr ? Llm->GetStatusRowText() : FString();
					const FString Footer = Llm != nullptr ? Llm->GetFooterText() : FString();
					const FString Session = Llm != nullptr ? Llm->GetSessionLabel() : FString();
					// Q22: the reference terminal's behaviour, measured in the package -- the mark cycles (four shapes or more
					// in both consoles), the timer moves with the clock, output arrived, the verb passed through red and pale,
					// the counter is lines (no tokens: nothing produced any), Esc is not offered (the simulation cannot be
					// stopped from here), and the mode and the session inset say SIMULATED
					const bool bTimer = FMath::Abs((Elapsed - Run.ConsoleElapsed) - Span) <= 1.5;
					const bool bTruthful = Row.Contains(TEXT(" lines)")) && !Row.Contains(TEXT("token")) && Llm != nullptr && !Llm->IsInterruptHintShown()
						&& Footer.Contains(TEXT("simulated")) && Session.Contains(TEXT("simulated"));
					QaCheck(Run, TEXT("Q22"), Llm != nullptr && Agent != nullptr && Llm->IsPulsing() && Agent->IsPulsing()
						&& Shapes(Run.ConsoleStages[0]) >= 4 && Shapes(Run.ConsoleStages[1]) >= 4 && bTimer && Lines > Run.ConsoleLines
						&& Run.bVerbRed && Run.bVerbPale && !Run.bStatusInHistory && bTruthful,
						FString::Printf(TEXT("companion consoles while the simulated mission plays: pulsing %s/%s, mark shapes %d and %d (want 4+), ")
							TEXT("timer %ds -> %ds over %.1fs, lines %d -> %d, verb red %s pale %s, status in history %s, row '%s', footer '%s', session '%s'"),
							Llm != nullptr && Llm->IsPulsing() ? TEXT("yes") : TEXT("NO"), Agent != nullptr && Agent->IsPulsing() ? TEXT("yes") : TEXT("NO"),
							Shapes(Run.ConsoleStages[0]), Shapes(Run.ConsoleStages[1]), Run.ConsoleElapsed, Elapsed, Span, Run.ConsoleLines, Lines,
							Run.bVerbRed ? TEXT("yes") : TEXT("NO"), Run.bVerbPale ? TEXT("yes") : TEXT("NO"), Run.bStatusInHistory ? TEXT("YES") : TEXT("no"),
							*Row, *Footer, *Session));
					// then READ BACK: four rows up, as a wheel notch and a bit -- and output keeps arriving while the visitor reads.
					// The QA prints it itself: between two stages of the mission the companion can be quiet for ten seconds, and
					// what is measured here is the console, not the script's timing.
					if (Llm != nullptr)
					{
						Llm->ScrollRows(-4.0f);
						Run.bScrolledAway = !Llm->IsFollowing();
						for (int32 Extra = 1; Extra <= 3; ++Extra)
						{
							Llm->Print(EWonderlandConsoleLine::Note, FString::Printf(TEXT("QA: output %d arriving while the view is scrolled back"), Extra), FString(), 0.3f);
						}
					}
					Run.ConsoleAt = In;
					Run.Sub = 3;
				}
			}
			else if (Run.Sub == 3 && In >= Run.ConsoleAt + 5.0)
			{
				// Q23: the view stays where the visitor left it while output keeps arriving, says how much arrived, and a click
				// on that marker (FollowLive) brings it back to the live end
				const bool bHeld = Llm != nullptr && !Llm->IsFollowing();
				const int32 Unseen = Llm != nullptr ? Llm->GetUnseenRows() : 0;
				QaFrame(Run, TEXT("07c_companion_scrolled_back"));
				if (Llm != nullptr)
				{
					Llm->FollowLive();
				}
				QaCheck(Run, TEXT("Q23"), Run.bScrolledAway && bHeld && Unseen > 0 && Llm != nullptr && Llm->IsFollowing(),
					FString::Printf(TEXT("scrolled back 4 rows: left the live end %s, still there 5 s later %s, %d new rows marked, back to live %s"),
						Run.bScrolledAway ? TEXT("yes") : TEXT("NO"), bHeld ? TEXT("yes") : TEXT("NO"), Unseen,
						Llm != nullptr && Llm->IsFollowing() ? TEXT("yes") : TEXT("NO")));
				Missions->StopFixture();
				Run.ConsoleAt = In;
				Run.Sub = 4;
			}
			else if (Run.Sub == 4 && In >= Run.ConsoleAt + 4.0)
			{
				// Q24: STOPPED, IT SETTLES -- no task in flight, the mark at rest, and a last line that says what it was. The
				// founder: "Do not create a perpetual fake 'working' animation while nothing is happening."
				auto Settled = [](const SWonderlandCompanionConsole* C)
				{
					return C != nullptr && !C->IsPulsing() && C->GetEmblemStage() < 0 && C->GetQueuedCount() == 0
						&& C->GetLineText(C->GetLineCount() - 1).Contains(TEXT("simulated"));
				};
				QaFrame(Run, TEXT("07d_companion_settled"));
				QaCheck(Run, TEXT("Q24"), Settled(Llm) && Settled(Agent),
					FString::Printf(TEXT("after the stop: LLM settled %s ('%s'), Jhinn settled %s ('%s')"),
						Settled(Llm) ? TEXT("yes") : TEXT("NO"), Llm != nullptr ? *Llm->GetLineText(Llm->GetLineCount() - 1).Left(90) : TEXT("-"),
						Settled(Agent) ? TEXT("yes") : TEXT("NO"), Agent != nullptr ? *Agent->GetLineText(Agent->GetLineCount() - 1).Left(90) : TEXT("-")));
				if (Run.bTerminalOpened && U->IsLiveTerminalOpen())
				{
					U->ToggleLiveTerminal();
				}
				Run.ConsoleAt = In;
				Run.Sub = 5;
			}
			else if (Run.Sub == 5 && In >= Run.ConsoleAt + 1.0)
			{
				// Q18 (B08): /pa is the founder's showcase of ~95,000 boxes; in a player's session it changes nothing
				int32 Before = 0;
				for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
				{
					++Before;
				}
				U->SubmitTerminalLine(TEXT("/pa"));
				int32 After = 0;
				for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
				{
					++After;
				}
				QaCheck(Run, TEXT("Q18"), !WonderlandBeta::IsDeveloperSession() && After == Before,
					FString::Printf(TEXT("/pa in a player's session: %d figures before, %d after (want no change)"), Before, After));

				// Q19 (R9): bad input through the terminal changes nothing and crashes nothing
				const int32 ContractsBefore = Set->NumContracts();
				const ARelayDogCharacter* D = QaDog(World);
				const FName WornBefore = D != nullptr ? D->GetWornSkinId() : NAME_None;
				U->SubmitTerminalLine(TEXT("/tasks delete 3abc"));
				U->SubmitTerminalLine(TEXT("/tasks delete 99"));
				U->SubmitTerminalLine(TEXT("/tasks delete -1"));
				U->SubmitTerminalLine(TEXT("/skin ") + FString::ChrN(2000, TEXT('x')));
				U->SubmitTerminalLine(TEXT("/skin ../../Saved/elsewhere"));
				U->SubmitTerminalLine(FString::ChrN(5000, TEXT('y')));
				const FName WornAfter = D != nullptr ? D->GetWornSkinId() : NAME_None;
				QaCheck(Run, TEXT("Q19"), Set->NumContracts() == ContractsBefore && WornAfter == WornBefore,
					FString::Printf(TEXT("bad terminal input (/tasks delete 3abc / 99 / -1, a 2,000-character and a path-like /skin, a 5,000-character line): contracts %d -> %d, skin %s -> %s (want no change)"),
						ContractsBefore, Set->NumContracts(), *WornBefore.ToString(), *WornAfter.ToString()));
				Run.Sub = 6;
			}
			else if (Run.Sub == 6)
			{
				// Q20 (B04): the record keeps GetContractLimit() contracts, refuses the next one and says so, and the
				// extra ones delete back down to the eight Q13 wrote, for the restart check
				const int32 Limit = Set->GetContractLimit();
				for (int32 Guard = 0; Guard < 100 && Set->NumContracts() < Limit; ++Guard)
				{
					U->PressAddTaskForQa();
					U->SubmitTerminalLine(FString::Printf(TEXT("QA limit contract %d"), Set->NumContracts() + 1));
					if (const FWonderlandMissionTask* Made = Set->GetSelectedTask())
					{
						Set->CloseFromWorkspace(Made->LocalId);
					}
				}
				const int32 AtLimit = Set->NumContracts();
				U->PressAddTaskForQa();
				U->SubmitTerminalLine(TEXT("QA contract over the limit"));
				const int32 Over = Set->NumContracts();
				if (const FWonderlandMissionTask* Left = Set->GetSelectedTask())
				{
					Set->CloseFromWorkspace(Left->LocalId);
				}
				for (int32 Guard = 0; Guard < 100 && Set->NumContracts() > 8; ++Guard)
				{
					U->SubmitTerminalLine(TEXT("/tasks delete 9"));
				}
				QaCheck(Run, TEXT("Q20"), AtLimit == Limit && Over == Limit && Set->NumContracts() == 8 && !Set->DidLastSaveFail(),
					FString::Printf(TEXT("the contract limit: %d kept (want %d), the next refused (%d after it), deleted back to %d (want 8), last save %s"),
						AtLimit, Limit, Over, Set->NumContracts(), Set->DidLastSaveFail() ? TEXT("FAILED") : TEXT("ok")));
				QaNextStep(Run);
			}
			break;
		}
		case 14: // leave a colour and a skin chosen for the second boot to find (wl.Qa.PackagePersist), and quit
			if (Run.Sub == 0)
			{
				GEngine->Exec(World, TEXT("wl.Skins.Wear jack_flame"));
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Mascot.Secondary %.2f,%.2f,%.2f"), PersistColour.R, PersistColour.G, PersistColour.B));
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Mascot.Flame %.2f,%.2f,%.2f"), PersistFlame.R, PersistFlame.G, PersistFlame.B));
				Run.Sub = 1;
			}
			else if (In >= 3.0)
			{
				const ARelayDogCharacter* D = QaDog(World);
				FString Paint;
				const bool bPainted = D != nullptr && JackWears(D->GetCostume(), PersistColour, PersistFlame, Paint);
				QaFrame(Run, TEXT("06_before_restart_jack_rose"));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA PERSIST set jack_flame secondary %s flame %s (painted before the restart: %s; %s)"),
					*QaRgb(PersistColour), *QaRgb(PersistFlame), bPainted ? TEXT("yes") : TEXT("NO"), *Paint);
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

	void ArmQa(UWorld* World, bool bPersist, const FString& RestoreSkin, bool bHostile = false)
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
		GQaRun->bHostile = bHostile;
		GQaRun->bWelcomeSeenAtBoot = WonderlandBeta::HasSeenWelcome();
		UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF startup %.1f s from engine start to the QA armed in a loaded world"),
			FPlatformTime::Seconds() - GStartTime);
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

	FAutoConsoleCommandWithWorldAndArgs GQaPackageHostile(
		TEXT("wl.Qa.PackageHostile"),
		TEXT("The third boot, on save files boot_test_package_qa.ps1 corrupted on purpose: does the game start, set the bad ")
		TEXT("files aside, skip the bad lines, keep the good one, and seal the next save it writes? Then quit."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ArmQa(World, false, FString(), true);
		}));

	/* ================================================================ wl.Qa.ConsoleFilm (founder, 2026-10-01)
	 *
	 * THE COMPANION TERMINALS ARE ACCEPTED ON VIDEO: "record a 30-45 second video of a companion actively performing a real
	 * task ... Do not call it PASS from static screenshots." This sets the scene for the recorder and gets out of the way: it
	 * lets the world settle, raises the terminals, starts the work, logs WLFILM lines the recorder keys on, lets the consoles
	 * settle on camera when the work is over, and quits. It moves no input of its own.
	 *   `wl.Qa.ConsoleFilm mission 70` -- the Missions panel's simulated mission (Scenario D, both companions joined)
	 *   `wl.Qa.ConsoleFilm runtime 70` -- a developer session's sidekick runtime (-wldev -wllocalai): each companion asked in
	 *                                    turn, through the same call Enter in its console makes
	 */
	struct FQaFilm
	{
		TWeakObjectPtr<UWorld> World;
		FString Mode;
		double Seconds = 70.0;
		double Start = 0.0;
		int32 Step = 0;
		int32 Asked = 0;
		int32 EscPressedFor = INDEX_NONE;
		FTSTicker::FDelegateHandle Handle;
	};
	TSharedPtr<FQaFilm> GQaFilm;

	bool QaFilmTick(float)
	{
		if (!GQaFilm.IsValid())
		{
			return false;
		}
		FQaFilm& Film = *GQaFilm;
		UWorld* World = Film.World.Get();
		UWonderlandUiSubsystem* U = QaUi(World);
		UWonderlandMissionSubsystem* Missions = UWonderlandUiTestLibrary::GetMission(World);
		const double In = QaNow() - Film.Start;
		if (World == nullptr || U == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM quit: no world or UI"));
				FPlatformMisc::RequestExit(false);
				return false;
			}
			return true;
		}
		// THE RUNTIME'S ASKS, spaced so the clip holds several whole turns -- ask, think, stream, done -- in both consoles
		// Each: when (seconds into the work), which console, what is asked, and how long into the turn Esc is pressed (0: never).
		struct FFilmAsk
		{
			double At;
			int32 Console;
			const TCHAR* Ask;
			double EscAfter;
		};
		static const FFilmAsk Asks[] = {
			{1.0, 0, TEXT("What does the Mission Contract at Castle Approach ask for?"), 0.0},
			{9.0, 1, TEXT("List the files in your scope, then check them."), 0.0},
			{13.0, 0, TEXT("Summarise what Jhinn just reported, in two sentences."), 1.8},
			{20.0, 0, TEXT("Which part of that should Julius verify first?"), 0.0},
			{28.0, 1, TEXT("Run the scoped check again and report what changed."), 0.0},
			{32.0, 0, TEXT("Thank you. Anything else before the review?"), 0.0},
		};
		switch (Film.Step)
		{
		case 0:
			// the world and the HUD settle first, as the QA lets them
			if (In >= 10.0 && QaDog(World) != nullptr)
			{
				if (!U->IsLiveTerminalOpen())
				{
					U->ToggleLiveTerminal();
				}
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM begin %s"), *Film.Mode);
				Film.Start = QaNow();
				Film.Step = 1;
			}
			break;
		case 1:
			// the work begins three seconds in, so the clip opens on both consoles at rest
			if (In >= 3.0)
			{
				if (Film.Mode == TEXT("runtime"))
				{
					// THE RUNTIME'S OWN SLOW DEVELOPMENT MODEL ("slow enough to watch thinking and cancellation") -- chosen the
					// way the console command chooses it; a new model is a new session, which the console announces. Put back
					// when the film ends.
					GEngine->Exec(World, TEXT("wl.Sidekicks.Model llm fixture-chat-slow"));
					// the keyboard in the LLM Companion's console, as a visitor typing there would leave it
					U->FocusCompanionTerminal(0);
				}
				else if (Missions != nullptr)
				{
					Missions->PlayScenario(FName(TEXT("D")), 10.0f);
				}
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM work started at %.1f s"), In);
				Film.Step = 2;
			}
			break;
		case 2:
			if (Film.Mode == TEXT("runtime"))
			{
				const double Work = In - 3.0;
				if (Film.Asked < static_cast<int32>(UE_ARRAY_COUNT(Asks)) && Work >= Asks[Film.Asked].At)
				{
					U->SubmitCompanionLineForQa(Asks[Film.Asked].Console, Asks[Film.Asked].Ask);
					UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM asked console %d at %.1f s"), Asks[Film.Asked].Console, Work);
					++Film.Asked;
				}
				// ESC, ONLY WHILE THE CONSOLE OFFERS IT -- through its real key handler, so what is filmed is the control working
				const int32 Last = Film.Asked - 1;
				if (Last >= 0 && Asks[Last].EscAfter > 0.0 && Film.EscPressedFor != Last && Work >= Asks[Last].At + Asks[Last].EscAfter)
				{
					Film.EscPressedFor = Last;
					SWonderlandCompanionConsole* Console = U->GetCompanionConsoleForQa(Asks[Last].Console);
					if (Console != nullptr && Console->IsInterruptHintShown())
					{
						UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM Esc pressed in console %d at %.1f s (footer '%s')"), Asks[Last].Console, Work,
							*Console->GetFooterText());
						Console->PressEscapeForQa();
					}
					else
					{
						UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM Esc NOT pressed: console %d offered no 'esc to interrupt' (footer '%s')"),
							Asks[Last].Console, Console != nullptr ? *Console->GetFooterText() : TEXT("-"));
					}
				}
			}
			if (In >= Film.Seconds)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM work stopped at %.1f s"), In);
				if (Missions != nullptr && Missions->IsFixtureRunning())
				{
					Missions->StopFixture();
				}
				if (Film.Mode == TEXT("runtime"))
				{
					// the runtime as the film found it
					GEngine->Exec(World, TEXT("wl.Sidekicks.Model llm fixture-chat"));
				}
				Film.Step = 3;
			}
			break;
		case 3:
			// the consoles settle on camera before the game goes
			if (In >= Film.Seconds + 8.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM quit"));
				FPlatformMisc::RequestExit(false);
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	/* ================================================================ wl.Qa.HangOnExit (RC6)
	 *
	 * THE EXIT WATCHDOG, PROVED RATHER THAN TRUSTED. RC5's soak ended with the engine's teardown deadlocked and the process
	 * alive ten minutes later (WonderlandBeta::ArmExitWatchdog). That hang cannot be summoned on demand, so this makes one:
	 * fifteen seconds after the world is up it quits, and its exit then sleeps for 60 s. The watchdog must end the process
	 * about 20 s into the exit; the boot script measures when the process went.
	 */
	FAutoConsoleCommand GQaHangOnExit(
		TEXT("wl.Qa.HangOnExit"),
		TEXT("Test of the exit watchdog: quits 15 s from now with an exit that hangs 60 s on purpose. The process must end ~20 s into the exit."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			FCoreDelegates::OnExit.AddLambda([]()
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA HangOnExit: the exit now hangs for 60 s on purpose"));
				GLog->Flush();
				FPlatformProcess::Sleep(60.0f);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA HangOnExit: the hang ended by itself -- the watchdog did NOT end the process"));
			});
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([](float)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLQA HangOnExit: quitting now"));
				FPlatformMisc::RequestExit(false);
				return false;
			}), 15.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLQA HangOnExit armed: quitting in 15 s with an exit that hangs"));
		}));

	/* ================================================================ wl.Qa.SkinFaces (founder, 2026-10-01)
	 *
	 * THE EYE CORRECTION, PHOTOGRAPHED IN THE GAME. The founder: "Do not accept this from source inspection alone. After
	 * the fix: equip all five skins one by one in Wonderland. For each skin capture a FRONT-FACING close view where the
	 * face is clearly visible ... Check them at: close distance, normal gameplay distance." For each skin in the roster's
	 * order this wears it, waits for the costume, logs Q25's verdict on the figure it loaded, stands a camera in front of
	 * the Dog's face and saves four frames to Saved/Screenshots/WLFACES -- close front, close three-quarter, close side (is
	 * anything proud of the face?), and front from a normal play distance -- then puts Relay OG back and quits. It moves no
	 * input of its own; the Dog stands where it spawned.
	 */
	struct FQaFaceShot
	{
		const TCHAR* Name;
		double Yaw;        // degrees round the Dog from straight in front of its face
		double Distance;   // uu from the eyes
		double Rise;       // uu the camera stands above the eyes
		float Fov;
	};
	const FQaFaceShot FaceShots[] = {
		{TEXT("close_front"), 0.0, 150.0, 4.0, 40.0f},
		{TEXT("close_34"), 40.0, 150.0, 4.0, 40.0f},
		{TEXT("close_side"), 86.0, 150.0, 4.0, 40.0f},
		{TEXT("play_front"), 0.0, 480.0, 90.0, 70.0f},
	};
	const TCHAR* const FaceRoster[5] = { TEXT("relay_og"), TEXT("celestial_light"), TEXT("skeleton_flame"), TEXT("jack_flame"), TEXT("baal") };
	// The eyes stand at 0.715 of the canonical body's height: visor_z 19.14 in the generator's body record -0.044..26.79.
	constexpr double FaceEyeHeight = 0.715;

	struct FQaFaces
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ACameraActor> Camera;
		int32 Skin = 0;
		int32 Shot = 0;
		int32 Phase = 0;
		double At = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
	};
	TSharedPtr<FQaFaces> GQaFaces;

	bool QaFacesTick(float)
	{
		if (!GQaFaces.IsValid())
		{
			return false;
		}
		FQaFaces& F = *GQaFaces;
		UWorld* World = F.World.Get();
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ARelayDogCharacter* D = QaDog(World);
		const double In = QaNow() - F.At;
		if (World == nullptr || PC == nullptr || D == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES quit: no world or Relay Dog"));
				FPlatformMisc::RequestExit(false);
				return false;
			}
			return true;
		}
		switch (F.Phase)
		{
		case 0:
			// the world settles first, as the QA lets it; the first-launch welcome is put away so it covers no face
			if (In >= 8.0)
			{
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					U->DismissWelcome();
					U->CloseOverlay();
				}
				F.Phase = 1;
				F.At = QaNow();
			}
			break;
		case 1:
			if (F.Skin >= 5)
			{
				F.Phase = 9;
				F.At = QaNow();
				break;
			}
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), FaceRoster[F.Skin]));
			F.Shot = 0;
			F.Phase = 2;
			F.At = QaNow();
			break;
		case 2:
			// the costume built and settled; then Q25 on the figure it loaded
			if (In >= 3.0)
			{
				if (F.Skin > 0)
				{
					FString Detail;
					const bool bOk = QaWornEyesInsideFace(D->GetCostume(), Detail);
					(bOk ? F.Pass : F.Fail)++;
					UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES Q25.%d %s | %s: %s"), F.Skin + 1, bOk ? TEXT("PASS") : TEXT("FAIL"), FaceRoster[F.Skin], *Detail);
				}
				else
				{
					UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES relay_og: the canon body, no costume -- the founder's reference, not judged (worn %s)"),
						*D->GetWornSkinId().ToString());
				}
				F.Phase = 3;
				F.At = QaNow();
			}
			break;
		case 3:
		{
			if (F.Shot >= static_cast<int32>(UE_ARRAY_COUNT(FaceShots)))
			{
				++F.Skin;
				F.Phase = 1;
				F.At = QaNow();
				break;
			}
			const FQaFaceShot& S = FaceShots[F.Shot];
			const FVector Feet = D->GetActorLocation() - FVector(0.0, 0.0, D->GetSimpleCollisionHalfHeight());
			const FVector Eyes = Feet + FVector(0.0, 0.0, D->GetCanonBodyHeightUu() * FaceEyeHeight);
			const FVector Toward = D->GetActorForwardVector().GetSafeNormal2D().RotateAngleAxis(S.Yaw, FVector::UpVector);
			const FVector Where = Eyes + Toward * S.Distance + FVector(0.0, 0.0, S.Rise);
			ACameraActor* Cam = F.Camera.Get();
			if (Cam == nullptr)
			{
				FActorSpawnParameters Params;
				Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
				Cam = World->SpawnActor<ACameraActor>(Where, FRotator::ZeroRotator, Params);
				F.Camera = Cam;
			}
			if (Cam != nullptr)
			{
				Cam->SetActorLocationAndRotation(Where, (Eyes - Where).Rotation());
				Cam->GetCameraComponent()->SetFieldOfView(S.Fov);
				Cam->GetCameraComponent()->SetConstraintAspectRatio(false);
				PC->SetViewTargetWithBlend(Cam, 0.0f);
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES camera %s %s: %.0f uu from the eyes, %.0f deg round, fov %.0f (eyes at %s)"),
				FaceRoster[F.Skin], S.Name, S.Distance, S.Yaw, S.Fov, *Eyes.ToCompactString());
			F.Phase = 4;
			F.At = QaNow();
			break;
		}
		case 4:
			// the image settles after the cut (temporal AA converges), then it is saved
			if (In >= 1.2)
			{
				const FQaFaceShot& S = FaceShots[F.Shot];
				int32 W = 0;
				int32 H = 0;
				const FString Path = F.Dir / FString::Printf(TEXT("%d_%s_%s.png"), F.Skin + 1, FaceRoster[F.Skin], S.Name);
				const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, W, H);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), W, H);
				++F.Shot;
				F.Phase = 3;
				F.At = QaNow();
			}
			break;
		case 9:
			// Relay OG back, the Dog's own camera back, and quit
			if (In >= 0.5)
			{
				PC->SetViewTargetWithBlend(D, 0.0f);
				if (ACameraActor* Cam = F.Camera.Get())
				{
					Cam->Destroy();
				}
				GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES END pass=%d fail=%d"), F.Pass, F.Fail);
				F.Phase = 10;
				F.At = QaNow();
			}
			break;
		case 10:
			if (In >= 1.0)
			{
				GQaFaces.Reset();
				FPlatformMisc::RequestExit(false);
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSkinFaces(
		TEXT("wl.Qa.SkinFaces"),
		TEXT("Photograph every Relay Dog skin's face in this build -- close front, close three-quarter, close side and front from a ")
		TEXT("play distance -- with Q25's eyes-inside-the-face verdict on each costume, into Saved/Screenshots/WLFACES; then quit."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaFaces.IsValid())
			{
				return;
			}
			GQaFaces = MakeShared<FQaFaces>();
			GQaFaces->World = World;
			GQaFaces->At = QaNow();
			GQaFaces->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLFACES"));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaFacesTick), 0.1f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES armed: five skins, %d frames each"), static_cast<int32>(UE_ARRAY_COUNT(FaceShots)));
		}));

	FAutoConsoleCommandWithWorldAndArgs GQaConsoleFilm(
		TEXT("wl.Qa.ConsoleFilm"),
		TEXT("Set the scene for the companion-terminal video and quit after it: `wl.Qa.ConsoleFilm mission 70` (the simulated ")
		TEXT("mission) or `wl.Qa.ConsoleFilm runtime 70` (a developer session's sidekick runtime, -wldev -wllocalai). Logs WLFILM lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaFilm.IsValid())
			{
				return;
			}
			GQaFilm = MakeShared<FQaFilm>();
			GQaFilm->World = World;
			GQaFilm->Mode = Args.Num() > 0 ? Args[0].ToLower() : FString(TEXT("mission"));
			GQaFilm->Seconds = Args.Num() > 1 ? FMath::Clamp(FCString::Atod(*Args[1]), 20.0, 600.0) : 70.0;
			GQaFilm->Start = QaNow();
			GQaFilm->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaFilmTick), 0.1f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLFILM armed: %s, %.0f s of work"), *GQaFilm->Mode, GQaFilm->Seconds);
		}));

	/* ================================================================ wl.Qa.Perf and wl.Qa.Soak (private beta, R10 / R11 / R14)
	 *
	 * FOUNDER, 2026-09-30: "Measure the package, not just the editor" -- startup, average FPS, 1% low, hitches, memory,
	 * streaming hitches, traversal, teleport, Mission Contract, map, wardrobe, creation -- and "explicitly test Wonderland
	 * for long-session memory growth ... Do not let local background watchers themselves distort the memory test."
	 * Both run INSIDE the packaged game, drive it through the player's own systems and log WLPERF / WLSOAK lines; the
	 * boot script samples the process's working set, private bytes and dedicated GPU memory from outside, every five
	 * seconds, with one lightweight counter read and nothing else running.
	 */
	struct FQaPerfRun
	{
		TWeakObjectPtr<UWorld> World;
		bool bSoak = false;
		int32 Step = 0;
		int32 Sub = 0;
		double StepStart = 0.0;
		double SubStart = 0.0;
		double Began = 0.0;
		double SoakSeconds = 0.0;
		double NextSampleAt = 0.0;
		int32 Cycle = 0;
		int32 Hop = 0;
		FString Phase;
		bool bWalking = false;
		float Yaw = 0.0f;
		double WalkBegan = 0.0;
		TArray<float> Frames;
		TArray<FVector> Trend;          // minutes, used MB, UObjects
		int32 SoakHitches = 0;
		float SoakWorst = 0.0f;
		FName BootSkin;
		FTSTicker::FDelegateHandle FrameHandle;
		FTSTicker::FDelegateHandle StepHandle;
	};

	TSharedPtr<FQaPerfRun> GQaPerf;

	double QaUsedMb()
	{
		return static_cast<double>(FPlatformMemory::GetStats().UsedPhysical) / (1024.0 * 1024.0);
	}

	double QaPeakMb()
	{
		return static_cast<double>(FPlatformMemory::GetStats().PeakUsedPhysical) / (1024.0 * 1024.0);
	}

	int32 QaObjects()
	{
		return GUObjectArray.GetObjectArrayNumMinusAvailable();
	}

	/** avg FPS, p50 / p95 / p99 frame time, the 1% low (FPS over the slowest 1% of frames), hitches and the worst frame */
	FString QaFrameStats(const TArray<float>& Frames)
	{
		if (Frames.Num() == 0)
		{
			return TEXT("frames 0");
		}
		TArray<float> Sorted = Frames;
		Sorted.Sort();
		double Sum = 0.0;
		int32 Over50 = 0;
		int32 Over100 = 0;
		for (const float Frame : Frames)
		{
			Sum += Frame;
			if (Frame > 0.050f) { ++Over50; }
			if (Frame > 0.100f) { ++Over100; }
		}
		const int32 Count = Sorted.Num();
		auto At = [&Sorted, Count](double Share) { return static_cast<double>(Sorted[FMath::Clamp(FMath::FloorToInt(Count * Share), 0, Count - 1)]); };
		const int32 Slowest = FMath::Max(1, Count / 100);
		double SlowSum = 0.0;
		for (int32 Index = Count - Slowest; Index < Count; ++Index)
		{
			SlowSum += Sorted[Index];
		}
		return FString::Printf(TEXT("frames %d avg_fps %.1f p50_ms %.1f p95_ms %.1f p99_ms %.1f low1_fps %.1f over50ms %d over100ms %d max_ms %.0f"),
			Count, Count / FMath::Max(Sum, 1e-6), At(0.50) * 1000.0, At(0.95) * 1000.0, At(0.99) * 1000.0,
			Slowest / FMath::Max(SlowSum, 1e-6), Over50, Over100, static_cast<double>(Sorted.Last()) * 1000.0);
	}

	void QaPerfPhase(FQaPerfRun& P, const TCHAR* Name)
	{
		if (!P.Phase.IsEmpty())
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF %s %s | used_mb %.0f peak_mb %.0f uobjects %d"),
				*P.Phase, *QaFrameStats(P.Frames), QaUsedMb(), QaPeakMb(), QaObjects());
		}
		P.Phase = Name != nullptr ? FString(Name) : FString();
		P.Frames.Reset();
	}

	bool QaPerfFrame(float)
	{
		if (!GQaPerf.IsValid())
		{
			return false;
		}
		FQaPerfRun& P = *GQaPerf;
		const float Delta = static_cast<float>(FApp::GetDeltaTime());
		P.Frames.Add(Delta);
		if (P.bSoak)
		{
			if (Delta > 0.100f) { ++P.SoakHitches; }
			P.SoakWorst = FMath::Max(P.SoakWorst, Delta);
		}
		// TRAVERSAL: walk every frame, turning 60 degrees every five seconds so no wall holds the walk still
		if (P.bWalking)
		{
			UWorld* World = P.World.Get();
			APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
			APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
			if (Controller != nullptr && Pawn != nullptr)
			{
				const float Want = FMath::FloorToFloat(static_cast<float>((QaNow() - P.WalkBegan) / 5.0)) * 60.0f;
				if (!FMath::IsNearlyEqual(Want, P.Yaw))
				{
					P.Yaw = Want;
					Controller->SetControlRotation(FRotator(-8.0f, P.Yaw, 0.0f));
				}
				Pawn->AddMovementInput(FRotator(0.0f, P.Yaw, 0.0f).Vector(), 1.0f);
			}
		}
		return true;
	}

	void QaPerfFinish(FQaPerfRun& P, UWorld* World)
	{
		QaPerfPhase(P, nullptr);
		if (P.bSoak)
		{
			// THE TREND FROM A WARM START: the first five minutes fill caches, streaming and shader pipelines, so the
			// growth that matters is from the first sample at five minutes or later to the last.
			int32 From = 0;
			while (From < P.Trend.Num() - 1 && P.Trend[From].X < 5.0f)
			{
				++From;
			}
			const FVector First = P.Trend.IsValidIndex(From) ? P.Trend[From] : FVector::ZeroVector;
			const FVector Last = P.Trend.Num() > 0 ? P.Trend.Last() : FVector::ZeroVector;
			const double Hours = FMath::Max((Last.X - First.X) / 60.0, 1e-3);
			const double MbPerHour = (Last.Y - First.Y) / Hours;
			const double ObjectGrowth = First.Z > 0.0 ? (Last.Z - First.Z) / First.Z : 0.0;
			const bool bLong = Last.X - First.X >= 10.0;
			const bool bPass = bLong && MbPerHour <= 300.0 && ObjectGrowth <= 0.10;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSOAK END %s | %.1f min, %d cycles, used %.0f -> %.0f MB (%.0f MB/hour from minute %.1f), peak %.0f MB, uobjects %.0f -> %.0f (%+.1f%%), hitches over 100 ms %d, worst frame %.0f ms, crashes 0 (the run finished)"),
				bPass ? TEXT("PASS") : TEXT("FAIL"), (QaNow() - P.Began) / 60.0, P.Cycle, First.Y, Last.Y, MbPerHour, First.X,
				QaPeakMb(), First.Z, Last.Z, ObjectGrowth * 100.0, P.SoakHitches, P.SoakWorst * 1000.0);
		}
		// leave the player as they were: their skin, no QA contracts, no mission
		GEngine->Exec(World, TEXT("wl.Mission.Stop"));
		if (UWonderlandMissionTaskSubsystem* Set = UWonderlandUiTestLibrary::GetMissionTasks(World))
		{
			Set->ClearAllTasksForDevelopment();
		}
		if (!P.BootSkin.IsNone())
		{
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), *P.BootSkin.ToString()));
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF END"));
		if (P.FrameHandle.IsValid())
		{
			FTSTicker::GetCoreTicker().RemoveTicker(P.FrameHandle);
		}
		GQaPerf.Reset();
		GEngine->Exec(World, TEXT("quit"));
	}

	/** One travel: request on the first call, true once it has ended (arrived or abandoned), logging the time. */
	bool QaPerfTravel(FQaPerfRun& P, UWorld* World, FName Id)
	{
		UWonderlandTravelSubsystem* T = QaTravel(World);
		if (T == nullptr)
		{
			return true;
		}
		if (P.Sub == 0)
		{
			FText Refusal;
			if (!T->RequestTravel(Id, Refusal))
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF travel %s refused: %s"), *Id.ToString(), *Refusal.ToString());
				return true;
			}
			P.Sub = 1;
			P.SubStart = QaNow();
			return false;
		}
		if (T->IsTravelling() && QaNow() - P.SubStart < 100.0)
		{
			return false;
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF travel %s %.1f s: %s"), *Id.ToString(), QaNow() - P.SubStart, *T->GetLastTravelReport());
		P.Sub = 0;
		return true;
	}

	bool QaPerfTick(float)
	{
		if (!GQaPerf.IsValid())
		{
			return false;
		}
		FQaPerfRun& P = *GQaPerf;
		UWorld* World = P.World.Get();
		if (World == nullptr)
		{
			GQaPerf.Reset();
			return false;
		}
		UWonderlandUiSubsystem* U = QaUi(World);
		const double In = QaNow() - P.StepStart;
		auto Next = [&P]() { ++P.Step; P.Sub = 0; P.StepStart = QaNow(); };
		static const FName Hops[6] = { TEXT("castle_approach"), TEXT("tower_rise"), TEXT("mushroom_grove"),
			TEXT("tartarus_heartland_east"), TEXT("tower_lane"), TEXT("noctis_heartland_west") };
		static const TCHAR* const Skins[5] = { TEXT("relay_og"), TEXT("celestial_light"), TEXT("skeleton_flame"), TEXT("jack_flame"), TEXT("baal") };

		if (P.Step == 0)
		{
			if (In >= 12.0)
			{
				if (U != nullptr) { U->DismissWelcome(); }
				const ARelayDogCharacter* D = QaDog(World);
				P.BootSkin = D != nullptr ? D->GetWornSkinId() : NAME_None;
				P.Began = QaNow();
				P.NextSampleAt = P.Began + 60.0;
				P.Trend.Add(FVector(0.0f, static_cast<float>(QaUsedMb()), static_cast<float>(QaObjects())));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF BEGIN %s | used_mb %.0f uobjects %d | %s"), P.bSoak ? TEXT("soak") : TEXT("perf"),
					QaUsedMb(), QaObjects(), *WonderlandBeta::BuildLabel());
				QaPerfPhase(P, TEXT("idle"));
				Next();
			}
			return true;
		}

		if (P.bSoak)
		{
			// ONE SAMPLE A MINUTE: memory, objects and the frame stats since the last sample
			if (QaNow() >= P.NextSampleAt)
			{
				const float Minutes = static_cast<float>((QaNow() - P.Began) / 60.0);
				P.Trend.Add(FVector(Minutes, static_cast<float>(QaUsedMb()), static_cast<float>(QaObjects())));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSOAK t_min %.1f cycle %d used_mb %.0f peak_mb %.0f uobjects %d | %s"),
					Minutes, P.Cycle, QaUsedMb(), QaPeakMb(), QaObjects(), *QaFrameStats(P.Frames));
				P.Frames.Reset();
				P.NextSampleAt += 60.0;
			}
			if (QaNow() - P.Began >= P.SoakSeconds && P.Sub == 0)
			{
				QaPerfFinish(P, World);
				return false;
			}
			// THE CYCLE: travel, a skin, the map, the wardrobe, a Mission Contract every third cycle, and a contract
			// written and deleted through the terminal -- every repeated thing the founder listed.
			switch (P.Step)
			{
			case 1:
				if (QaPerfTravel(P, World, Hops[P.Cycle % 6])) { Next(); }
				break;
			case 2:
				if (P.Sub == 0) { GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), Skins[P.Cycle % 5])); P.Sub = 1; }
				else if (In >= 2.0) { Next(); }
				break;
			case 3:
				if (P.Sub == 0 && U != nullptr) { if (!U->IsWorldMapOpen()) { U->ToggleWorldMap(); } P.Sub = 1; }
				else if (In >= 1.5) { if (U != nullptr && U->IsWorldMapOpen()) { U->ToggleWorldMap(); } Next(); }
				break;
			case 4:
				if (P.Sub == 0 && U != nullptr) { U->ToggleProjectBrain(); U->SetBrainSkinsOpen(true); P.Sub = 1; }
				else if (In >= 2.5) { if (U != nullptr) { U->SetBrainSkinsOpen(false); U->ToggleProjectBrain(); } Next(); }
				break;
			case 5:
				if (P.Cycle % 3 != 0) { Next(); break; }
				if (P.Sub == 0) { GEngine->Exec(World, TEXT("wl.Mission.Scenario B 5")); P.Sub = 1; }
				else if (In >= 40.0) { GEngine->Exec(World, TEXT("wl.Mission.Stop")); Next(); }
				break;
			case 6:
				if (U != nullptr)
				{
					U->PressAddTaskForQa();
					U->SubmitTerminalLine(FString::Printf(TEXT("soak note %d"), P.Cycle));
					U->SubmitTerminalLine(TEXT("/tasks delete 1"));
				}
				++P.Cycle;
				P.Step = 1;
				P.Sub = 0;
				P.StepStart = QaNow();
				break;
			default:
				P.Step = 1;
				break;
			}
			return true;
		}

		// PERF: one phase per thing the founder listed, each long enough for stable numbers
		switch (P.Step)
		{
		case 1: // idle where the player spawns
			if (In >= 20.0) { QaPerfPhase(P, TEXT("travel_warm")); Next(); }
			break;
		case 2: // to Castle Approach, the dense centre, before walking there
			if (QaPerfTravel(P, World, TEXT("castle_approach"))) { QaPerfPhase(P, TEXT("walk")); P.bWalking = true; P.WalkBegan = QaNow(); P.Yaw = 0.0f; Next(); }
			break;
		case 3: // traversal: thirty seconds of walking through the centre
			if (In >= 30.0) { P.bWalking = false; QaPerfPhase(P, TEXT("teleport")); P.Hop = 1; Next(); }
			break;
		case 4: // teleport: five hops across the world
			if (QaPerfTravel(P, World, Hops[P.Hop]))
			{
				if (++P.Hop >= 6) { QaPerfPhase(P, TEXT("map")); Next(); }
			}
			break;
		case 5: // the map, opened and closed eight times
			if (U != nullptr && In >= 1.0 * (P.Sub + 1))
			{
				U->ToggleWorldMap();
				if (++P.Sub >= 16) { if (U->IsWorldMapOpen()) { U->ToggleWorldMap(); } QaPerfPhase(P, TEXT("wardrobe")); Next(); }
			}
			break;
		case 6: // the wardrobe: open it and wear all five skins
			if (P.Sub == 0 && U != nullptr) { U->ToggleProjectBrain(); U->SetBrainSkinsOpen(true); P.Sub = 1; P.SubStart = QaNow(); }
			else if (P.Sub >= 1 && P.Sub <= 5 && QaNow() - P.SubStart >= 2.0)
			{
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), Skins[P.Sub - 1]));
				++P.Sub;
				P.SubStart = QaNow();
			}
			else if (P.Sub == 6 && QaNow() - P.SubStart >= 2.0)
			{
				if (U != nullptr) { U->SetBrainSkinsOpen(false); U->ToggleProjectBrain(); }
				QaPerfPhase(P, TEXT("contract"));
				Next();
			}
			break;
		case 7: // a Mission Contract, one minute of it
			if (P.Sub == 0) { GEngine->Exec(World, TEXT("wl.Mission.Scenario B 5")); P.Sub = 1; }
			else if (In >= 60.0) { GEngine->Exec(World, TEXT("wl.Mission.Stop")); QaPerfPhase(P, TEXT("creation")); Next(); }
			break;
		case 8: // creation through the terminal: three contracts written, then deleted
			if (U != nullptr && P.Sub < 3) { U->PressAddTaskForQa(); U->SubmitTerminalLine(FString::Printf(TEXT("perf note %d"), P.Sub)); ++P.Sub; }
			else if (U != nullptr && P.Sub < 6) { U->SubmitTerminalLine(TEXT("/tasks delete 1")); ++P.Sub; }
			else if (In >= 4.0) { QaPerfFinish(P, World); return false; }
			break;
		default:
			break;
		}
		return true;
	}

	void ArmQaPerf(UWorld* World, bool bSoak, double Minutes)
	{
		if (GQaPerf.IsValid() || GQaRun.IsValid())
		{
			UE_LOG(LogWonderlandQa, Warning, TEXT("WLPERF a QA run is already going"));
			return;
		}
		GQaPerf = MakeShared<FQaPerfRun>();
		GQaPerf->World = World;
		GQaPerf->bSoak = bSoak;
		GQaPerf->SoakSeconds = FMath::Clamp(Minutes, 1.0, 600.0) * 60.0;
		GQaPerf->StepStart = QaNow();
		GQaPerf->FrameHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaPerfFrame), 0.0f);
		GQaPerf->StepHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaPerfTick), 0.1f);
		UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF armed (%s%s); startup %.1f s from engine start to a loaded world"),
			bSoak ? TEXT("soak ") : TEXT("perf"), bSoak ? *FString::Printf(TEXT("%.0f min"), Minutes) : TEXT(""), FPlatformTime::Seconds() - GStartTime);
	}

	FAutoConsoleCommandWithWorldAndArgs GQaPerfCommand(
		TEXT("wl.Qa.Perf"),
		TEXT("Measure this (packaged) build: idle, a walk through the centre, five teleports, the map, the wardrobe, a Mission ")
		TEXT("Contract and creation through the terminal. Logs WLPERF lines (FPS, 1% low, hitches, memory, UObjects) and quits."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ArmQaPerf(World, false, 0.0);
		}));

	FAutoConsoleCommandWithWorldAndArgs GQaSoakCommand(
		TEXT("wl.Qa.Soak"),
		TEXT("Soak this (packaged) build for N minutes (default 30): travel, skins, map, wardrobe, Mission Contracts and terminal ")
		TEXT("contracts on repeat, with a WLSOAK memory / UObject / frame sample every minute and a growth verdict. Quits at the end."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			ArmQaPerf(World, true, Args.Num() > 0 ? FCString::Atod(*Args[0]) : 30.0);
		}));
}

#endif

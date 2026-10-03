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
#include "WonderlandSkinStage.h"
#include "WonderlandCard.h"
#include "WonderlandMissionHandoff.h"
#include "WonderlandHandoffDirector.h"
#include "WonderlandCompanionFormation.h"
#include "WonderlandDogPerformance.h"
#include "WonderlandMissionOrb.h"
#include "Components/BoxComponent.h"
#include "Components/CapsuleComponent.h"
#include "Engine/CollisionProfile.h"
#include "GameFramework/CharacterMovementComponent.h"

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
		// B63 (Q26): both consoles as they were just before a mid-mission colour change remounted them
		TArray<FString> RemountText[2];
		FString RemountStatus[2];
		FString RemountFooter[2];
		int32 RemountElapsed[2] = {0, 0};
		int32 RemountJoined[2] = {0, 0};
		const void* RemountOld[2] = {nullptr, nullptr};
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
				|| Figure.Parts[B.Part].Motion == EWonderlandCompanionMotion::Twinkle
				|| Figure.Parts[B.Part].Motion == EWonderlandCompanionMotion::Shadow)
			{
				continue;   // fire and shadow strips are drawn live, not as their boxes; rotated boxes are never on a face
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
			// THE COAT IS THE FACE, WHATEVER ITS COLOUR (Shadow Flame, 2026-10-01; mirrors skin_eye_check.py COAT): base_dog
			// builds the head shell round the visor window from `bone`/`bonedeep`, so they are never the black housing. Every
			// other skin's coat is light and was never dark; a near-black coat made the whole head read as housing.
			const bool bCoat = M.Name == FName(TEXT("bone")) || M.Name == FName(TEXT("bonedeep"));
			S.bDark = !bCoat && M.Kind != EWonderlandCompanionMaterialKind::Glow && Luma < DarkLuma;
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

	/** Q25 on a figure file as the game would load it: parse it and judge its eyes. */
	bool QaFigureFileEyesInsideFace(const FString& Path, FString& OutDetail)
	{
		FString Text, Error;
		FWonderlandCompanionFigure Figure;
		if (Path.IsEmpty() || !FFileHelper::LoadFileToString(Text, *Path) || !FWonderlandCompanionFigure::Parse(Text, Figure, Error))
		{
			OutDetail = FString::Printf(TEXT("could not read the figure '%s' (%s)"), *Path, *Error);
			return false;
		}
		const bool bOk = QaEyesInsideFace(Figure, OutDetail);
		OutDetail = FPaths::GetCleanFilename(Path) + TEXT(": ") + OutDetail;
		return bOk;
	}

	/** Q25 on the costume a Dog wears now: the figure file it loaded. */
	bool QaWornEyesInsideFace(const AWonderlandCompanionEmbodiment* Worn, FString& OutDetail)
	{
		if (Worn == nullptr)
		{
			OutDetail = TEXT("no costume to read");
			return false;
		}
		return QaFigureFileEyesInsideFace(Worn->GetFigurePath(), OutDetail);
	}

	/** Q25.1: Relay OG wears no costume in play -- the canon body -- but its WARDROBE figure is the file the skin registry
	 *  resolves for relay_og, and it is held to the same rules (founder, 2026-10-01: "Change the relay og wardrobe preview
	 *  to the correct visuals"). */
	bool QaRelayOgPreviewEyesInsideFace(UWorld* World, FString& OutDetail)
	{
		const UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		const UWonderlandRelaySkinSubsystem* Skins = Instance != nullptr ? Instance->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
		if (Skins == nullptr)
		{
			OutDetail = TEXT("no skin registry");
			return false;
		}
		return QaFigureFileEyesInsideFace(Skins->FigurePathFor(FName(TEXT("relay_og"))), OutDetail);
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
		static const TCHAR* const Roster[] = { TEXT("relay_og"), TEXT("celestial_light"), TEXT("skeleton_flame"), TEXT("jack_flame"), TEXT("baal"), TEXT("shadow_flame") };
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
			if (D == nullptr || Which >= static_cast<int32>(UE_ARRAY_COUNT(Roster)))
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
				// Relay OG wears no costume in play (its canon body is the founder's reference); Q25.1 judges its WARDROBE figure.
				FString EyeDetail;
				const bool bEyes = Which > 0 ? QaWornEyesInsideFace(Worn, EyeDetail) : QaRelayOgPreviewEyesInsideFace(World, EyeDetail);
				QaCheck(Run, *FString::Printf(TEXT("Q25.%d"), Which + 1), bEyes, FString::Printf(TEXT("%s%s: %s"), Roster[Which],
					Which > 0 ? TEXT("") : TEXT(" wardrobe figure"), *EyeDetail));
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
				// then B63: a colour change while the mission plays. Both consoles are read as they are, and the chrome is
				// rebuilt through the one route every colour writer takes (SaveAndApply -> OnChanged -> RefreshChrome), the
				// Wardrobe's and the Menu's swatches included; nothing about the colours themselves changes.
				const SWonderlandCompanionConsole* Before[2] = {Llm, Agent};
				for (int32 C = 0; C < 2; ++C)
				{
					Run.RemountOld[C] = Before[C];
					Run.RemountText[C].Reset();
					Run.RemountJoined[C] = 0;
					if (Before[C] != nullptr)
					{
						for (int32 Line = 0; Line < Before[C]->GetLineCount(); ++Line)
						{
							Run.RemountText[C].Add(Before[C]->GetLineText(Line));
							Run.RemountJoined[C] += Before[C]->GetLineText(Line).Contains(TEXT("mission joined")) ? 1 : 0;
						}
						Run.RemountStatus[C] = Before[C]->GetStatus();
						Run.RemountFooter[C] = Before[C]->GetFooterText();
						Run.RemountElapsed[C] = Before[C]->GetElapsedSeconds();
					}
				}
				WonderlandMascotStyle::SaveAndApply();
				Run.ConsoleAt = In;
				Run.Sub = 30;
			}
			else if (Run.Sub == 30 && In >= Run.ConsoleAt + 3.0)
			{
				// Q26 (B63): A COLOUR CHANGE MID-MISSION KEEPS BOTH CONSOLES. Three seconds after the remount each NEW console
				// still shows the old one's history line for line (and may have added to it), the same status and footer
				// modes, a task timer that kept counting rather than starting again, and no second "mission joined": the
				// feed knows these consoles were already told. Before the fix both came back as a fresh mount (Second, RC11
				// P10: JHINN's intro and "Planning… (2s)" where it had read task J-07 for 20 s).
				const SWonderlandCompanionConsole* After[2] = {Llm, Agent};
				bool bKept[2] = {false, false};
				FString Why[2];
				for (int32 C = 0; C < 2; ++C)
				{
					const SWonderlandCompanionConsole* A = After[C];
					if (A == nullptr || static_cast<const void*>(A) == Run.RemountOld[C])
					{
						Why[C] = A == nullptr ? TEXT("no console") : TEXT("NOT remounted (same widget)");
						continue;
					}
					int32 Same = 0;
					int32 Joined = 0;
					for (int32 Line = 0; Line < A->GetLineCount(); ++Line)
					{
						Joined += A->GetLineText(Line).Contains(TEXT("mission joined")) ? 1 : 0;
					}
					while (Same < Run.RemountText[C].Num() && Same < A->GetLineCount() && A->GetLineText(Same) == Run.RemountText[C][Same])
					{
						++Same;
					}
					const int32 Elapsed = A->GetElapsedSeconds();
					bKept[C] = Run.RemountText[C].Num() > 0 && Same == Run.RemountText[C].Num() && A->GetStatus() == Run.RemountStatus[C]
						&& A->GetFooterText() == Run.RemountFooter[C] && Elapsed >= Run.RemountElapsed[C] && Joined == Run.RemountJoined[C];
					Why[C] = FString::Printf(TEXT("history %d/%d lines kept (now %d), status '%s'->'%s', timer %ds->%ds, 'mission joined' %d->%d"),
						Same, Run.RemountText[C].Num(), A->GetLineCount(), *Run.RemountStatus[C], *A->GetStatus(), Run.RemountElapsed[C], Elapsed,
						Run.RemountJoined[C], Joined);
				}
				QaFrame(Run, TEXT("07e_companion_after_remount"));
				QaCheck(Run, TEXT("Q26"), bKept[0] && bKept[1],
					FString::Printf(TEXT("a colour change mid-mission (B63): LLM %s -- %s | Jhinn %s -- %s"),
						bKept[0] ? TEXT("kept") : TEXT("LOST"), *Why[0], bKept[1] ? TEXT("kept") : TEXT("LOST"), *Why[1]));
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
	const TCHAR* const FaceRoster[] = { TEXT("relay_og"), TEXT("celestial_light"), TEXT("skeleton_flame"), TEXT("jack_flame"), TEXT("baal"), TEXT("shadow_flame") };
	// The eyes stand at 0.715 of the canonical body's height: visor_z 19.14 in the generator's body record -0.044..26.79.
	constexpr double FaceEyeHeight = 0.715;

	struct FQaFaces
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ACameraActor> Camera;
		int32 Skin = 0;
		int32 Shot = 0;
		int32 Phase = 0;
		int32 WSkin = 0;   // the wardrobe pass's skin
		double At = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
		// THE COMPANIONS AND CUBS STAND ASIDE FOR THE CAMERA: they escort the Dog at arm's length, and the first run's side
		// views photographed the LLM Companion's robe instead of the Dog's face. Hidden for the shots, shown again at the end.
		TArray<TWeakObjectPtr<AActor>> Hidden;
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
			if (F.Skin >= static_cast<int32>(UE_ARRAY_COUNT(FaceRoster)))
			{
				F.Phase = 20;   // then the wardrobe's own preview of each skin
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
					// in play Relay OG is the canon body (no costume); its wardrobe figure is judged instead (Q25.1)
					FString Detail;
					const bool bOk = QaRelayOgPreviewEyesInsideFace(World, Detail);
					(bOk ? F.Pass : F.Fail)++;
					UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES Q25.1 %s | relay_og wardrobe figure (worn in play: %s, the canon body): %s"),
						bOk ? TEXT("PASS") : TEXT("FAIL"), *D->GetWornSkinId().ToString(), *Detail);
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
			// every figure but the Dog's own costume out of the shot (a cub set is rebuilt for each skin, so this runs per shot) --
			// and never the wardrobe stage's own figure, which the stage owns: hidden, the wardrobe's preview rendered black
			for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
			{
				if (*It != D->GetCostume() && !It->IsHidden() && Cast<AWonderlandSkinStage>(It->GetOwner()) == nullptr)
				{
					It->SetActorHiddenInGame(true);
					F.Hidden.Add(*It);
				}
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
		case 20:
			// THE WARDROBE'S PREVIEW (founder, 2026-10-01: "Change the relay og wardrobe preview to the correct visuals"):
			// the Dog's own camera back, then the Project Brain's wardrobe opened the way the perf run opens it
			if (In >= 0.5)
			{
				PC->SetViewTargetWithBlend(D, 0.0f);
				// every figure the shots hid comes back first: the wardrobe is seen as a player sees it
				for (const TWeakObjectPtr<AActor>& Figure : F.Hidden)
				{
					if (AActor* A = Figure.Get())
					{
						A->SetActorHiddenInGame(false);
					}
				}
				F.Hidden.Reset();
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					U->ToggleProjectBrain();
					U->SetBrainSkinsOpen(true);
				}
				F.WSkin = 0;
				F.Phase = 21;
				F.At = QaNow();
			}
			break;
		case 21:
			if (In >= 1.0)
			{
				if (F.WSkin >= static_cast<int32>(UE_ARRAY_COUNT(FaceRoster)))
				{
					if (UWonderlandUiSubsystem* U = QaUi(World))
					{
						U->SetBrainSkinsOpen(false);
						U->ToggleProjectBrain();
					}
					F.Phase = 9;
					F.At = QaNow();
					break;
				}
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), FaceRoster[F.WSkin]));
				F.Phase = 22;
				F.At = QaNow();
			}
			break;
		case 22:
			// the stage shows the skin and the figure settles facing its camera, then the whole screen is saved
			if (In >= 4.0)
			{
				const AWonderlandSkinStage* Stage = AWonderlandSkinStage::Get(World);
				int32 W = 0;
				int32 H = 0;
				const FString Path = F.Dir / FString::Printf(TEXT("%d_%s_wardrobe.png"), F.WSkin + 1, FaceRoster[F.WSkin]);
				const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, W, H);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES wardrobe %s: the stage shows %s | frame %s %s %dx%d"), FaceRoster[F.WSkin],
					Stage != nullptr ? *Stage->GetShownSkinId().ToString() : TEXT("(no stage)"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), W, H);
				++F.WSkin;
				F.Phase = 21;
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
				for (const TWeakObjectPtr<AActor>& Figure : F.Hidden)
				{
					if (AActor* A = Figure.Get())
					{
						A->SetActorHiddenInGame(false);
					}
				}
				F.Hidden.Reset();
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
			UE_LOG(LogWonderlandQa, Display, TEXT("WLFACES armed: %d skins, %d frames each"), static_cast<int32>(UE_ARRAY_COUNT(FaceRoster)), static_cast<int32>(UE_ARRAY_COUNT(FaceShots)));
		}));

	/* ================================================================ wl.Qa.ShadowFlame (founder, 2026-10-01)
	 *
	 * "BUILD THE SHADOW FLAME RELAY DOG SKIN" -- the founder's fifteen runtime checks, measured in the client on what the
	 * worn costume actually does, plus the front / three-quarter / wardrobe frames and a 25 s hold for the motion film:
	 *   S1 the skin is worn                 S2 the canonical upright body at Relay OG's height
	 *   S3 no clothing (canonical parts, the tail and the shadow anchors only)   S4 yellow eyes inside the face (Q25)
	 *   S5 the strips exist                 S6 they animate continuously        S7 they move independently
	 *   S8 smoothly (no visible jumps)      S9 idle is stable and the strips stay attached
	 *   S10 walking stretches them behind and stopping curls them back, never tearing loose
	 *   S11 switching away removes every strip   S12 switching back restores them   S13 the wardrobe preview has them
	 *   S14 the choice is saved             S15 no strip leaks onto another skin
	 * `wl.Qa.ShadowFlame restart` is the second boot of S14: the skin and its strips came back. Frames to
	 * Saved/Screenshots/WLSHADOW. Leaves Shadow Flame worn, for the restart boot, and quits.
	 */
	struct FQaShadow
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ACameraActor> Camera;
		TArray<TWeakObjectPtr<AActor>> Hidden;
		int32 Phase = 0;
		double At = 0.0;
		double NextSample = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		bool bRestart = false;
		FString Dir;
		int32 Tendrils = 0;
		// samples: actor-space tips, their weights, and the Dog's location, at 10 Hz
		TArray<TArray<FVector>> Tips;
		TArray<TArray<float>> Weights;
		TArray<FVector> DogAt;
		FVector IdleMean = FVector::ZeroVector;
		FVector WalkMean = FVector::ZeroVector;
		FVector WalkStart = FVector::ZeroVector;
	};
	TSharedPtr<FQaShadow> GQaShadow;

	void QaShadowCheck(FQaShadow& S, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? S.Pass : S.Fail)++;
		UE_LOG(LogWonderlandQa, Display, TEXT("WLSHADOW %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	/** Every figure in the world drawing live shadow strips, except the one given; with the wardrobe stage's figure counted. */
	int32 QaShadowLeaks(UWorld* World, const AWonderlandCompanionEmbodiment* Allowed, FString& OutWho)
	{
		int32 Leaks = 0;
		for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
		{
			if (*It != Allowed && It->HasLiveShadows())
			{
				++Leaks;
				OutWho += FString::Printf(TEXT("%s%s"), OutWho.IsEmpty() ? TEXT("") : TEXT(", "), *It->GetName());
			}
		}
		return Leaks;
	}

	/** The mean tip (weighted by visibility) of one sample, actor space. */
	FVector QaShadowMeanTip(const TArray<FVector>& Tips, const TArray<float>& Weights)
	{
		FVector Sum = FVector::ZeroVector;
		double W = 0.0;
		for (int32 I = 0; I < Tips.Num() && I < Weights.Num(); ++I)
		{
			Sum += Tips[I] * Weights[I];
			W += Weights[I];
		}
		return W > 1e-3 ? Sum / W : FVector::ZeroVector;
	}

	void QaShadowSample(FQaShadow& S, const AWonderlandCompanionEmbodiment* Costume, const ARelayDogCharacter* D)
	{
		S.Tips.Add(Costume != nullptr ? Costume->GetShadowTips() : TArray<FVector>());
		S.Weights.Add(Costume != nullptr ? Costume->GetShadowTipWeights() : TArray<float>());
		S.DogAt.Add(D->GetActorLocation());
	}

	/** Places the QA camera round the Dog: Yaw degrees from its front, Distance from the body's middle. */
	void QaShadowCamera(FQaShadow& S, UWorld* World, APlayerController* PC, ARelayDogCharacter* D, double Yaw, double Distance)
	{
		const FVector Feet = D->GetActorLocation() - FVector(0.0, 0.0, D->GetSimpleCollisionHalfHeight());
		const FVector Middle = Feet + FVector(0.0, 0.0, D->GetCanonBodyHeightUu() * 0.62);
		const FVector Toward = D->GetActorForwardVector().GetSafeNormal2D().RotateAngleAxis(Yaw, FVector::UpVector);
		const FVector Where = Middle + Toward * Distance + FVector(0.0, 0.0, 40.0);
		ACameraActor* Cam = S.Camera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Cam = World->SpawnActor<ACameraActor>(Where, FRotator::ZeroRotator, Params);
			S.Camera = Cam;
		}
		if (Cam != nullptr)
		{
			Cam->SetActorLocationAndRotation(Where, (Middle - Where).Rotation());
			Cam->GetCameraComponent()->SetFieldOfView(48.0f);
			Cam->GetCameraComponent()->SetConstraintAspectRatio(false);
			PC->SetViewTargetWithBlend(Cam, 0.0f);
		}
	}

	void QaShadowShot(FQaShadow& S, const TCHAR* Name)
	{
		int32 W = 0;
		int32 H = 0;
		const FString Path = S.Dir / FString::Printf(TEXT("%s.png"), Name);
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, W, H);
		UE_LOG(LogWonderlandQa, Display, TEXT("WLSHADOW frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), W, H);
	}

	bool QaShadowTick(float)
	{
		if (!GQaShadow.IsValid())
		{
			return false;
		}
		FQaShadow& S = *GQaShadow;
		UWorld* World = S.World.Get();
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ARelayDogCharacter* D = QaDog(World);
		const double Now = QaNow();
		const double In = Now - S.At;
		if (World == nullptr || PC == nullptr || D == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSHADOW quit: no world or Relay Dog"));
				FPlatformMisc::RequestExit(false);
				return false;
			}
			return true;
		}
		const FName Shadow(TEXT("shadow_flame"));
		const AWonderlandCompanionEmbodiment* Costume = D->GetCostume();
		const float BodyH = FMath::Max(D->GetCanonBodyHeightUu(), 1.0f);
		const auto Next = [&S](int32 Phase) { S.Phase = Phase; S.At = QaNow(); S.NextSample = QaNow(); };
		switch (S.Phase)
		{
		case 0:
			// the world settles first, as every QA lets it; the welcome is put away so it covers nothing
			if (In >= 8.0)
			{
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					U->DismissWelcome();
					U->CloseOverlay();
				}
				if (S.bRestart)
				{
					Next(50);
					break;
				}
				GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				Next(1);
			}
			break;
		case 1:
			if (In >= 3.0)
			{
				// S1-S5: worn, upright canonical body, no clothing, the eyes, the strips
				QaShadowCheck(S, TEXT("S1"), D->GetWornSkinId() == Shadow && Costume != nullptr,
					FString::Printf(TEXT("worn '%s', costume %s"), *D->GetWornSkinId().ToString(), Costume != nullptr ? TEXT("built") : TEXT("MISSING")));
				const float Body = Costume != nullptr ? Costume->GetBodyHeightUu() : 0.0f;
				const TArray<FName> Parts = Costume != nullptr ? Costume->GetPartNames() : TArray<FName>();
				static const TCHAR* const Canon[] = { TEXT("root"), TEXT("body"), TEXT("head"), TEXT("arm_l"), TEXT("arm_l_fore"), TEXT("arm_r"),
					TEXT("arm_r_fore"), TEXT("leg_l"), TEXT("leg_l_shin"), TEXT("leg_r"), TEXT("leg_r_shin") };
				int32 CanonFound = 0;
				FString Extra;
				for (const FName& P : Parts)
				{
					const FString N = P.ToString().ToLower();
					bool bCanon = false;
					for (const TCHAR* C : Canon)
					{
						bCanon |= N == C;
					}
					CanonFound += bCanon ? 1 : 0;
					if (!bCanon && N != TEXT("tail") && !N.StartsWith(TEXT("shadow_")))
					{
						Extra += FString::Printf(TEXT("%s%s"), Extra.IsEmpty() ? TEXT("") : TEXT(", "), *N);
					}
				}
				QaShadowCheck(S, TEXT("S2"), Costume != nullptr && FMath::Abs(Body - BodyH) <= 0.5f && CanonFound == static_cast<int32>(UE_ARRAY_COUNT(Canon)),
					FString::Printf(TEXT("body %.2f uu against Relay OG %.2f uu; the standing biped's %d of %d canonical parts (no quadruped legs)"),
						Body, BodyH, CanonFound, static_cast<int32>(UE_ARRAY_COUNT(Canon))));
				QaShadowCheck(S, TEXT("S3"), Costume != nullptr && Extra.IsEmpty(),
					Extra.IsEmpty() ? FString::Printf(TEXT("%d parts: the canonical body, the tail and shadow anchors only -- no clothing"), Parts.Num())
						: FString::Printf(TEXT("parts beyond the body, tail and shadow anchors: %s"), *Extra));
				FString Eyes;
				const bool bEyes = QaWornEyesInsideFace(Costume, Eyes);
				const UGameInstance* Instance = World->GetGameInstance();
				const UWonderlandRelaySkinSubsystem* Skins = Instance != nullptr ? Instance->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
				const FWonderlandRelaySkin* Def = Skins != nullptr ? Skins->Find(Shadow) : nullptr;
				const bool bYellow = Def != nullptr && Def->EyeColour.R > 0.9f && Def->EyeColour.G > 0.6f && Def->EyeColour.B < 0.35f;
				QaShadowCheck(S, TEXT("S4"), bEyes && bYellow, FString::Printf(TEXT("eye colour %s (yellow %s); %s"),
					Def != nullptr ? *Def->EyeColour.ToString() : TEXT("(no skin)"), bYellow ? TEXT("yes") : TEXT("NO"), *Eyes));
				S.Tendrils = Costume != nullptr ? Costume->GetShadowTips().Num() : 0;
				QaShadowCheck(S, TEXT("S5"), Costume != nullptr && Costume->HasLiveShadows() && S.Tendrils >= 10,
					FString::Printf(TEXT("%d tendrils | %s"), S.Tendrils, Costume != nullptr ? *Costume->DescribeShadows() : TEXT("-")));
				Next(2);
			}
			break;
		case 2:
			// IDLE: eight seconds of the strips at 10 Hz, the Dog standing
			if (Now >= S.NextSample)
			{
				QaShadowSample(S, Costume, D);
				S.NextSample += 0.1;
			}
			if (In >= 8.0)
			{
				// S6 continuous, S7 independent, S8 smooth, S9 stable and attached
				const int32 N = S.Tendrils;
				int32 Eligible = 0, Moving = 0, Jumps = 0, Detached = 0;
				TArray<double> Steps;
				double CosSum = 0.0;
				int32 CosN = 0;
				int32 Clockwise = 0, Counter = 0;
				TArray<int32> SeenEligible;
				SeenEligible.SetNumZeroed(N);
				for (int32 T = 1; T < S.Tips.Num(); ++T)
				{
					const TArray<FVector>& A = S.Tips[T - 1];
					const TArray<FVector>& B = S.Tips[T];
					if (A.Num() != N || B.Num() != N || S.Weights[T - 1].Num() != N || S.Weights[T].Num() != N)
					{
						continue;
					}
					TArray<FVector> V;
					TArray<bool> Ok;
					V.SetNum(N);
					Ok.SetNum(N);
					for (int32 I = 0; I < N; ++I)
					{
						Ok[I] = S.Weights[T - 1][I] > 0.15f && S.Weights[T][I] > 0.15f;
						V[I] = B[I] - A[I];
						if (!Ok[I])
						{
							continue;
						}
						++Eligible;
						++SeenEligible[I];
						const double Step = V[I].Size();
						Steps.Add(Step);
						Moving += Step > 0.2 ? 1 : 0;
						Jumps += Step > 60.0 ? 1 : 0;
						const double Reach = FVector2D(B[I].X, B[I].Y).Size();
						Detached += (Reach > 2.0 * BodyH || B[I].Z > 2.2 * BodyH || B[I].Z < -0.5 * BodyH) ? 1 : 0;
						const double Spin = A[I].X * V[I].Y - A[I].Y * V[I].X;
						(Spin >= 0.0 ? Counter : Clockwise)++;
					}
					for (int32 I = 0; I < N; ++I)
					{
						for (int32 J = I + 1; J < N; ++J)
						{
							if (Ok[I] && Ok[J] && V[I].SizeSquared() > 1e-4 && V[J].SizeSquared() > 1e-4)
							{
								CosSum += FVector::DotProduct(V[I].GetSafeNormal(), V[J].GetSafeNormal());
								++CosN;
							}
						}
					}
				}
				Steps.Sort();
				const double P95 = Steps.Num() > 0 ? Steps[FMath::Min(Steps.Num() - 1, static_cast<int32>(Steps.Num() * 0.95))] : 0.0;
				const double MeanCos = CosN > 0 ? CosSum / CosN : 1.0;
				int32 SeenWell = 0;
				for (const int32 Seen : SeenEligible)
				{
					SeenWell += Seen >= (S.Tips.Num() / 4) ? 1 : 0;
				}
				const double Frac = Eligible > 0 ? static_cast<double>(Moving) / Eligible : 0.0;
				QaShadowCheck(S, TEXT("S6"), N >= 10 && Frac >= 0.9 && SeenWell >= N * 3 / 4,
					FString::Printf(TEXT("%d samples over 8 s: visible tips moved in %.0f%% of 0.1 s steps (want >= 90%%); %d of %d tendrils visible for a quarter of the time or more"),
						S.Tips.Num(), Frac * 100.0, SeenWell, N));
				QaShadowCheck(S, TEXT("S7"), MeanCos < 0.5 && Clockwise > 0 && Counter > 0,
					FString::Printf(TEXT("mean cosine between two tendrils' motions %.2f (want < 0.50: not moving together); turning one way %d steps, the other %d"),
						MeanCos, Counter, Clockwise));
				QaShadowCheck(S, TEXT("S8"), Jumps == 0 && P95 <= 30.0,
					FString::Printf(TEXT("visible tip step p95 %.1f uu per 0.1 s (want <= 30), jumps over 60 uu: %d"), P95, Jumps));
				const double DogDrift = S.DogAt.Num() > 1 ? FVector::Dist(S.DogAt[0], S.DogAt.Last()) : 0.0;
				QaShadowCheck(S, TEXT("S9"), DogDrift <= 3.0 && Detached == 0,
					FString::Printf(TEXT("the Dog drifted %.1f uu standing (want <= 3); tips beyond the aura (2.0 x body out, 2.2 x up, 0.5 x down): %d"), DogDrift, Detached));
				// the idle mean, for S10
				FVector Sum = FVector::ZeroVector;
				for (int32 T = 0; T < S.Tips.Num(); ++T)
				{
					Sum += QaShadowMeanTip(S.Tips[T], S.Weights[T]);
				}
				S.IdleMean = S.Tips.Num() > 0 ? Sum / S.Tips.Num() : FVector::ZeroVector;
				S.Tips.Reset();
				S.Weights.Reset();
				S.DogAt.Reset();
				S.WalkStart = D->GetActorLocation();
				Next(3);
			}
			break;
		case 3:
			// WALKING: three seconds straight ahead by the Dog's own movement input, sampled at 10 Hz
			D->AddMovementInput(D->GetActorForwardVector(), 1.0f);
			if (Now >= S.NextSample)
			{
				QaShadowSample(S, Costume, D);
				S.NextSample += 0.1;
			}
			if (In >= 3.0)
			{
				FVector Sum = FVector::ZeroVector;
				int32 Count = 0;
				for (int32 T = S.Tips.Num() / 2; T < S.Tips.Num(); ++T)
				{
					Sum += QaShadowMeanTip(S.Tips[T], S.Weights[T]);
					++Count;
				}
				S.WalkMean = Count > 0 ? Sum / Count : S.IdleMean;
				Next(4);
			}
			break;
		case 4:
			// STOPPED: three seconds more, for the curl back
			if (Now >= S.NextSample)
			{
				QaShadowSample(S, Costume, D);
				S.NextSample += 0.1;
			}
			if (In >= 3.0)
			{
				const double Walked = FVector::Dist2D(S.WalkStart, D->GetActorLocation());
				int32 Detached = 0;
				for (int32 T = 0; T < S.Tips.Num(); ++T)
				{
					for (int32 I = 0; I < S.Tips[T].Num() && I < S.Weights[T].Num(); ++I)
					{
						const FVector& P = S.Tips[T][I];
						Detached += (S.Weights[T][I] > 0.15f && (FVector2D(P.X, P.Y).Size() > 2.4 * BodyH || P.Z > 2.4 * BodyH || P.Z < -0.6 * BodyH)) ? 1 : 0;
					}
				}
				// the LAST SECOND stopped, averaged: the tips orbit, so one sample is noise, not a position
				FVector EndSum = FVector::ZeroVector;
				int32 EndN = 0;
				for (int32 T = FMath::Max(0, S.Tips.Num() - 10); T < S.Tips.Num(); ++T)
				{
					EndSum += QaShadowMeanTip(S.Tips[T], S.Weights[T]);
					++EndN;
				}
				const FVector End = EndN > 0 ? EndSum / EndN : S.IdleMean;
				// actor space: +X is the way the Dog faces, so a trail behind is a mean tip moved toward -X while walking
				const double Behind = S.IdleMean.X - S.WalkMean.X;
				const double Back = FMath::Abs(End.X - S.IdleMean.X);
				const double BackLimit = FMath::Max(Behind * 0.75, 8.0);
				QaShadowCheck(S, TEXT("S10"), Walked >= 80.0 && Detached == 0 && Behind > 2.0 && Back < BackLimit,
					FString::Printf(TEXT("walked %.0f uu; the strips' mean tip moved %.1f uu BEHIND while walking (want > 2), and came back to within %.1f uu of idle after stopping (want < %.1f); tips torn loose: %d"),
						Walked, Behind, Back, BackLimit, Detached));
				S.Tips.Reset();
				S.Weights.Reset();
				S.DogAt.Reset();
				GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
				Next(5);
			}
			break;
		case 5:
			if (In >= 2.5)
			{
				FString Who;
				const int32 Leaks = QaShadowLeaks(World, nullptr, Who);
				QaShadowCheck(S, TEXT("S11"), Leaks == 0 && D->GetWornSkinId() == FName(TEXT("relay_og")),
					FString::Printf(TEXT("switched to '%s': figures still drawing shadow strips: %d%s"), *D->GetWornSkinId().ToString(), Leaks,
						Who.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *Who)));
				GEngine->Exec(World, TEXT("wl.Skins.Wear jack_flame"));
				Next(6);
			}
			break;
		case 6:
			if (In >= 3.0)
			{
				FString Who;
				const int32 Leaks = QaShadowLeaks(World, nullptr, Who);
				QaShadowCheck(S, TEXT("S15"), Leaks == 0 && Costume != nullptr && !Costume->HasLiveShadows() && Costume->DescribeShadows().IsEmpty(),
					FString::Printf(TEXT("wearing '%s': its costume has no shadow tendrils (%s); figures drawing strips anywhere: %d%s"),
						*D->GetWornSkinId().ToString(), Costume != nullptr && Costume->DescribeShadows().IsEmpty() ? TEXT("none") : TEXT("SOME"), Leaks,
						Who.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *Who)));
				GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				Next(7);
			}
			break;
		case 7:
			if (In >= 3.0)
			{
				const int32 Back = Costume != nullptr ? Costume->GetShadowTips().Num() : 0;
				QaShadowCheck(S, TEXT("S12"), Costume != nullptr && Costume->HasLiveShadows() && Back == S.Tendrils,
					FString::Printf(TEXT("switched back: %d tendrils (was %d) | %s"), Back, S.Tendrils, Costume != nullptr ? *Costume->DescribeShadows() : TEXT("-")));
				// the frames: every other figure out of the shot (never the wardrobe stage's own)
				for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
				{
					if (*It != Costume && !It->IsHidden() && Cast<AWonderlandSkinStage>(It->GetOwner()) == nullptr)
					{
						It->SetActorHiddenInGame(true);
						S.Hidden.Add(*It);
					}
				}
				QaShadowCamera(S, World, PC, D, 0.0, 720.0);
				Next(8);
			}
			break;
		case 8:
			if (In >= 1.5)
			{
				QaShadowShot(S, TEXT("1_front"));
				QaShadowCamera(S, World, PC, D, 40.0, 720.0);
				Next(9);
			}
			break;
		case 9:
			if (In >= 1.5)
			{
				QaShadowShot(S, TEXT("2_three_quarter"));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSHADOW film begin: 25 s held at three-quarter, the Dog idle"));
				Next(10);
			}
			break;
		case 10:
			// THE FILM HOLD: the founder asks for 20-30 s of the strips moving on their own; a recorder films this window
			if (In >= 25.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSHADOW film end"));
				QaShadowShot(S, TEXT("3_three_quarter_after_25s"));
				PC->SetViewTargetWithBlend(D, 0.0f);
				for (const TWeakObjectPtr<AActor>& Figure : S.Hidden)
				{
					if (AActor* A = Figure.Get())
					{
						A->SetActorHiddenInGame(false);
					}
				}
				S.Hidden.Reset();
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					U->ToggleProjectBrain();
					U->SetBrainSkinsOpen(true);
				}
				GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				Next(11);
			}
			break;
		case 11:
			if (In >= 4.0)
			{
				const AWonderlandSkinStage* Stage = AWonderlandSkinStage::Get(World);
				bool bStageShadows = false;
				for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
				{
					bStageShadows |= Cast<AWonderlandSkinStage>(It->GetOwner()) != nullptr && It->HasLiveShadows();
				}
				QaShadowCheck(S, TEXT("S13"), Stage != nullptr && Stage->GetShownSkinId() == Shadow && bStageShadows,
					FString::Printf(TEXT("the wardrobe shows '%s'; its figure draws shadow strips: %s"),
						Stage != nullptr ? *Stage->GetShownSkinId().ToString() : TEXT("(no stage)"), bStageShadows ? TEXT("yes") : TEXT("NO")));
				QaShadowShot(S, TEXT("4_wardrobe"));
				Next(12);
			}
			break;
		case 12:
			if (In >= 6.0)
			{
				QaShadowShot(S, TEXT("5_wardrobe_6s_later"));
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					U->SetBrainSkinsOpen(false);
					U->ToggleProjectBrain();
				}
				FString Saved;
				FFileHelper::LoadFileToString(Saved, *UWonderlandRelaySkinSubsystem::PersistPath());
				QaShadowCheck(S, TEXT("S14"), Saved.TrimStartAndEnd() == TEXT("shadow_flame"),
					FString::Printf(TEXT("the remembered skin on disk: '%s' (%s); the restart half is `wl.Qa.ShadowFlame restart`"),
						*Saved.TrimStartAndEnd(), *UWonderlandRelaySkinSubsystem::PersistPath()));
				Next(13);
			}
			break;
		case 50:
			// THE RESTART BOOT: the skin and its strips came back on their own
			if (In >= 3.0)
			{
				QaShadowCheck(S, TEXT("S14.restart"), D->GetWornSkinId() == Shadow && Costume != nullptr && Costume->HasLiveShadows(),
					FString::Printf(TEXT("after a restart the Dog wears '%s', strips %s | %s"), *D->GetWornSkinId().ToString(),
						Costume != nullptr && Costume->HasLiveShadows() ? TEXT("live") : TEXT("ABSENT"), Costume != nullptr ? *Costume->DescribeShadows() : TEXT("-")));
				Next(13);
			}
			break;
		case 13:
			if (In >= 1.0)
			{
				if (ACameraActor* Cam = S.Camera.Get())
				{
					Cam->Destroy();
				}
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSHADOW END pass=%d fail=%d"), S.Pass, S.Fail);
				Next(14);
			}
			break;
		case 14:
			if (In >= 1.0)
			{
				GQaShadow.Reset();
				FPlatformMisc::RequestExit(false);
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaShadowFlame(
		TEXT("wl.Qa.ShadowFlame"),
		TEXT("The Shadow Flame skin's runtime checks (S1-S15): worn, upright canonical body, no clothing, yellow eyes, strips that ")
		TEXT("animate continuously, independently and smoothly, idle and walking, switching away and back, the wardrobe, the saved choice; ")
		TEXT("front / three-quarter / wardrobe frames and a 25 s film hold, into Saved/Screenshots/WLSHADOW; then quit. ")
		TEXT("`wl.Qa.ShadowFlame restart` checks the skin came back after a restart."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaShadow.IsValid())
			{
				return;
			}
			GQaShadow = MakeShared<FQaShadow>();
			GQaShadow->World = World;
			GQaShadow->At = QaNow();
			GQaShadow->bRestart = Args.Num() > 0 && Args[0].Equals(TEXT("restart"), ESearchCase::IgnoreCase);
			GQaShadow->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSHADOW"));
			// every frame, not every tenth of a second: the walk is the Dog's own movement input, consumed per frame
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaShadowTick), 0.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSHADOW armed (%s)"), GQaShadow->bRestart ? TEXT("restart check") : TEXT("S1-S15 and the frames"));
		}));

	/* ================================================================ wl.Qa.Wardrobe (founder, 2026-10-01)
	 *
	 * "WONDERLAND WARDROBE -- MASCOT SKIN PRESENTATION FIX": every skin (1) much closer in the Wardrobe's viewer, whole and
	 * centred, and (2) idling as Relay OG does -- body planted, head glancing about -- with Relay OG as the control. Measured
	 * in the package, through the player's own path (the Project Brain, SWITCH SKIN, a skin chosen), on what the preview
	 * actually shows: the occupancy is read off the rendered pixels, the idle off the figure's own joints over six seconds,
	 * and the player's in-world Relay OG head is sampled beside it as the reference. Frames to Saved/Screenshots/WLWARDROBE.
	 */
	const TCHAR* const WardrobeRoster[] = { TEXT("relay_og"), TEXT("celestial_light"), TEXT("skeleton_flame"), TEXT("jack_flame"), TEXT("baal"), TEXT("shadow_flame") };

	struct FQaWardrobe
	{
		TWeakObjectPtr<UWorld> World;
		int32 Phase = 0;
		int32 Skin = 0;
		double At = 0.0;
		double NextSample = 0.0;
		bool bMidShot = false;
		FString Dir;
		int32 Pass = 0;
		int32 Fail = 0;
		// one skin's idle, sampled
		int32 Samples = 0;
		FVector OffsetMin = FVector(1e9), OffsetMax = FVector(-1e9);
		float HeadYawMin = 1e9f, HeadYawMax = -1e9f, HeadPitchMin = 1e9f, HeadPitchMax = -1e9f;
		float RootTiltMax = 0.0f;
		float ArmMin = 1e9f, ArmMax = -1e9f;
		float CanonYawMin = 1e9f, CanonYawMax = -1e9f;
		float BodyTall = 0.0f;
		float DistanceBefore = -1.0f;
	};
	TSharedPtr<FQaWardrobe> GQaWardrobe;

	/** A number named in a "key=value key=value" note, or Fallback. */
	float QaNoteValue(const FString& Note, const TCHAR* Key, float Fallback = -1.0f)
	{
		const FString Find = FString(Key) + TEXT("=");
		const int32 At = Note.Find(Find, ESearchCase::CaseSensitive);
		return At == INDEX_NONE ? Fallback : FCString::Atof(*Note.Mid(At + Find.Len(), 16));
	}

	void QaWardrobeVerdict(FQaWardrobe& F, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? F.Pass : F.Fail)++;
		UE_LOG(LogWonderlandQa, Display, TEXT("WLWARDROBE %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	bool QaWardrobeTick(float)
	{
		if (!GQaWardrobe.IsValid())
		{
			return false;
		}
		FQaWardrobe& F = *GQaWardrobe;
		UWorld* World = F.World.Get();
		ARelayDogCharacter* D = QaDog(World);
		UWonderlandUiSubsystem* U = QaUi(World);
		AWonderlandSkinStage* Stage = World != nullptr ? AWonderlandSkinStage::Get(World) : nullptr;
		AWonderlandCompanionEmbodiment* Body = Stage != nullptr ? Stage->GetBody() : nullptr;
		const double In = QaNow() - F.At;
		if (World == nullptr || D == nullptr || U == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLWARDROBE quit: no world, Relay Dog or UI"));
				FPlatformMisc::RequestExit(false);
				return false;
			}
			return true;
		}
		auto Shot = [&F](const FString& Name)
		{
			int32 W = 0;
			int32 H = 0;
			const FString Path = F.Dir / Name;
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, W, H);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLWARDROBE frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), W, H);
		};
		switch (F.Phase)
		{
		case 0:
			// the world settles, the welcome is put away, then the Project Brain and its wardrobe, the way a player opens them
			if (In >= 8.0)
			{
				U->DismissWelcome();
				U->CloseOverlay();
				U->ToggleProjectBrain();
				U->SetBrainSkinsOpen(true);
				F.Phase = 1;
				F.At = QaNow();
			}
			break;
		case 1:
			if (In >= 1.5)
			{
				if (F.Skin >= static_cast<int32>(UE_ARRAY_COUNT(WardrobeRoster)))
				{
					F.Phase = 30;
					F.At = QaNow();
					break;
				}
				// a card chosen: the panel's OnChooseSkin equips through the registry, which is what this does
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), WardrobeRoster[F.Skin]));
				F.Phase = 2;
				F.At = QaNow();
			}
			break;
		case 2:
			// THE SWITCH ITSELF: a tenth of a second after the new dress, the figure is already wearing the canonical pose
			if (In >= 0.15)
			{
				const bool bWorn = Body != nullptr && Body->GetWornPose().bValid && Body->IsGaitDrivenExternally();
				QaWardrobeVerdict(F, *FString::Printf(TEXT("W%d.1"), F.Skin + 1), bWorn,
					FString::Printf(TEXT("%s: %.2f s after the switch the figure wears the canonical pose (%s)"), WardrobeRoster[F.Skin], In,
						Body == nullptr ? TEXT("no stage figure") : (bWorn ? TEXT("driven by Relay OG's animator") : TEXT("its own companion idle"))));
				F.Phase = 3;
				F.At = QaNow();
			}
			break;
		case 3:
			// settled: the framing, from the solve and from the pixels; then six seconds of idle
			if (In >= 4.0)
			{
				Shot(FString::Printf(TEXT("%d_%s_wardrobe_a.png"), F.Skin + 1, WardrobeRoster[F.Skin]));
				const FString Note = Stage != nullptr ? Stage->DescribeFraming() : FString(TEXT("no stage"));
				const FString Occ = Stage != nullptr ? Stage->MeasureOccupancy() : FString(TEXT("no stage"));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLWARDROBE framing %s | shows %s | solve: %s | pixels: %s"), WardrobeRoster[F.Skin],
					Stage != nullptr ? *Stage->GetShownSkinId().ToString() : TEXT("-"), *Note, *Occ);
				const float HeightPct = QaNoteValue(Occ, TEXT("heightPct"));
				const float CentreY = QaNoteValue(Occ, TEXT("centreYPct"));
				const float Bottom = CentreY + HeightPct * 0.5f;
				const float Top = CentreY - HeightPct * 0.5f;
				const bool bFire = QaNoteValue(Note, TEXT("fireTop"), 0.0f) > 0.0f;
				// SHADOW TENDRILS ARE TREATED AS FIRE IS: the founder's rule is that the wardrobe shows the whole Dog "without
				// shrinking for tendrils", so a riser may leave the top of the frame as a flame tip may (measured 2026-10-02: the
				// head and ears whole at ~13% from the top, the lit row at the edge a strip behind the head).
				const bool bShadowTips = Body != nullptr && Body->HasLiveShadows();
				const bool bShows = Stage != nullptr && Stage->GetShownSkinId() == FName(WardrobeRoster[F.Skin]);
				// CLOSE, AND WHOLE: the lit figure fills at least 70% of the preview's height (the RC7 wardrobe: about a third);
				// its lowest lit pixel stops short of the bottom edge (the feet are in the frame); and for a skin with no fire its
				// highest lit pixel stops short of the top (no head, ear, antler, halo or hat cut off). Fire tips may touch the top.
				const bool bWhole = Bottom <= 99.0f && (bFire || bShadowTips || Top >= 0.5f);
				QaWardrobeVerdict(F, *FString::Printf(TEXT("W%d.2"), F.Skin + 1), bShows && HeightPct >= 70.0f && bWhole,
					FString::Printf(TEXT("%s: figure %.1f%% of the preview height, highest lit row %.1f%%, lowest %.1f%%, centre %.1f%% (want >= 70%%; feet clear of the bottom; %s)"),
						WardrobeRoster[F.Skin], HeightPct, Top, Bottom, CentreY,
						bFire ? TEXT("fire tips may touch the top") : bShadowTips ? TEXT("shadow tips may touch the top") : TEXT("nothing touching the top")));
				F.Samples = 0;
				F.OffsetMin = FVector(1e9);
				F.OffsetMax = FVector(-1e9);
				F.HeadYawMin = F.HeadPitchMin = F.ArmMin = F.CanonYawMin = 1e9f;
				F.HeadYawMax = F.HeadPitchMax = F.ArmMax = F.CanonYawMax = -1e9f;
				F.RootTiltMax = 0.0f;
				F.BodyTall = Body != nullptr ? Body->GetBodyHeightUu() * static_cast<float>(Body->GetActorScale3D().Z) : 0.0f;
				F.bMidShot = false;
				F.NextSample = 0.0;
				F.Phase = 4;
				F.At = QaNow();
			}
			break;
		case 4:
			if (Body != nullptr && Stage != nullptr && In >= F.NextSample && In < 6.0)
			{
				F.NextSample += 0.1;
				// the body's place relative to the stage, in the stage's own frame (it is re-placed in the world as the UI frames it)
				const FVector Offset = Stage->GetActorTransform().InverseTransformPosition(Body->GetActorLocation()) * Stage->GetActorScale3D();
				F.OffsetMin = F.OffsetMin.ComponentMin(Offset);
				F.OffsetMax = F.OffsetMax.ComponentMax(Offset);
				const FRotator Head = Body->GetPartRotation(FName(TEXT("head")));
				const FRotator Root = Body->GetPartRotation(FName(TEXT("root")));
				const FRotator ArmL = Body->GetPartRotation(FName(TEXT("arm_l")));
				const FRotator ArmR = Body->GetPartRotation(FName(TEXT("arm_r")));
				F.HeadYawMin = FMath::Min(F.HeadYawMin, static_cast<float>(Head.Yaw));
				F.HeadYawMax = FMath::Max(F.HeadYawMax, static_cast<float>(Head.Yaw));
				F.HeadPitchMin = FMath::Min(F.HeadPitchMin, static_cast<float>(Head.Pitch));
				F.HeadPitchMax = FMath::Max(F.HeadPitchMax, static_cast<float>(Head.Pitch));
				F.RootTiltMax = FMath::Max(F.RootTiltMax, static_cast<float>(FMath::Max(FMath::Abs(Root.Pitch), FMath::Abs(Root.Roll))));
				for (const FRotator& Arm : {ArmL, ArmR})
				{
					const float Swing = static_cast<float>(FMath::Max3(FMath::Abs(Arm.Pitch), FMath::Abs(Arm.Yaw), FMath::Abs(Arm.Roll)));
					F.ArmMin = FMath::Min(F.ArmMin, Swing);
					F.ArmMax = FMath::Max(F.ArmMax, Swing);
				}
				const float Canon = D->GetCanonicalWornPose().HeadYawDeg;
				F.CanonYawMin = FMath::Min(F.CanonYawMin, Canon);
				F.CanonYawMax = FMath::Max(F.CanonYawMax, Canon);
				++F.Samples;
			}
			if (!F.bMidShot && In >= 3.0)
			{
				F.bMidShot = true;
				Shot(FString::Printf(TEXT("%d_%s_wardrobe_b.png"), F.Skin + 1, WardrobeRoster[F.Skin]));
			}
			if (In >= 6.0)
			{
				const FVector Drift = F.OffsetMax - F.OffsetMin;
				const float DriftMax = static_cast<float>(Drift.GetMax());
				const float DriftShare = F.BodyTall > 1.0f ? DriftMax / F.BodyTall : 1.0f;
				const float HeadRange = F.HeadYawMax - F.HeadYawMin;
				const float HeadReach = FMath::Max(FMath::Abs(F.HeadYawMax), FMath::Abs(F.HeadYawMin));
				const float ArmRange = F.ArmMax - F.ArmMin;
				// PLANTED: the body stays where it stands (under 1% of its own height of travel) and does not rock or flap
				QaWardrobeVerdict(F, *FString::Printf(TEXT("W%d.3"), F.Skin + 1),
					F.Samples >= 40 && DriftShare <= 0.01f && F.RootTiltMax <= 2.5f && ArmRange <= 5.0f,
					FString::Printf(TEXT("%s body over %d samples: travel %.2f uu (%.2f%% of its %.1f uu height; want <= 1%%), root tilt max %.2f deg (<= 2.5), arm swing range %.2f deg (<= 5)"),
						WardrobeRoster[F.Skin], F.Samples, DriftMax, 100.0f * DriftShare, F.BodyTall, F.RootTiltMax, ArmRange));
				// THE HEAD LOOKS ABOUT, inside the canon's cone -- the same class of motion as the in-world Relay OG beside it
				QaWardrobeVerdict(F, *FString::Printf(TEXT("W%d.4"), F.Skin + 1),
					F.Samples >= 40 && HeadRange >= 2.0f && HeadReach <= 16.0f,
					FString::Printf(TEXT("%s head yaw %.1f..%.1f deg (range %.1f; want >= 2 and |yaw| <= 16), pitch %.1f..%.1f | in-world Relay OG head yaw over the same window %.1f..%.1f"),
						WardrobeRoster[F.Skin], F.HeadYawMin, F.HeadYawMax, HeadRange, F.HeadPitchMin, F.HeadPitchMax, F.CanonYawMin, F.CanonYawMax));
				++F.Skin;
				F.Phase = 1;
				F.At = QaNow();
			}
			break;
		case 30:
			// 360 STILL WORKS, AND DOES NOT RESIZE THE SHOT: the button's own toggle, three seconds of turning, then stop
			F.DistanceBefore = Stage != nullptr ? QaNoteValue(Stage->DescribeFraming(), TEXT("distance")) : -1.0f;
			U->ToggleWardrobeInspect();
			F.Phase = 31;
			F.At = QaNow();
			break;
		case 31:
			if (In >= 3.0)
			{
				const float Yaw = Stage != nullptr ? Stage->GetInspectYaw() : 0.0f;
				const float DistanceTurning = Stage != nullptr ? QaNoteValue(Stage->DescribeFraming(), TEXT("distance")) : -1.0f;
				Shot(TEXT("6_360_turning.png"));
				const bool bTurned = U->IsWardrobeInspecting() && Yaw >= 30.0f;
				const bool bSameShot = F.DistanceBefore > 0.0f && FMath::Abs(DistanceTurning - F.DistanceBefore) <= 0.02f * F.DistanceBefore;
				QaWardrobeVerdict(F, *FString::Printf(TEXT("W%d.1"), static_cast<int32>(UE_ARRAY_COUNT(WardrobeRoster)) + 1), bTurned && bSameShot,
					FString::Printf(TEXT("360 on: the figure turned %.0f deg in 3 s; camera distance %.1f before, %.1f turning (want the same within 2%%)"),
						Yaw, F.DistanceBefore, DistanceTurning));
				U->ToggleWardrobeInspect();
				F.Phase = 32;
				F.At = QaNow();
			}
			break;
		case 32:
			if (In >= 3.0)
			{
				const float Yaw = Stage != nullptr ? FMath::Abs(FMath::UnwindDegrees(Stage->GetInspectYaw())) : 999.0f;
				Shot(TEXT("7_360_stopped.png"));
				QaWardrobeVerdict(F, *FString::Printf(TEXT("W%d.2"), static_cast<int32>(UE_ARRAY_COUNT(WardrobeRoster)) + 1), !U->IsWardrobeInspecting() && Yaw <= 2.0f,
					FString::Printf(TEXT("360 off: back to the front, %.1f deg from it after 3 s (want <= 2)"), Yaw));
				U->SetBrainSkinsOpen(false);
				U->ToggleProjectBrain();
				GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
				UE_LOG(LogWonderlandQa, Display, TEXT("WLWARDROBE END pass=%d fail=%d"), F.Pass, F.Fail);
				F.Phase = 33;
				F.At = QaNow();
			}
			break;
		case 33:
			if (In >= 1.0)
			{
				GQaWardrobe.Reset();
				FPlatformMisc::RequestExit(false);
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaWardrobeCommand(
		TEXT("wl.Qa.Wardrobe"),
		TEXT("Prove the Wardrobe's presentation in this build: open it the player's way, wear each of the six skins, and log how much of ")
		TEXT("the preview each fills (from its pixels), whether its body stays planted and its head looks about as Relay OG's does, and ")
		TEXT("that 360 turns without resizing the shot. Frames to Saved/Screenshots/WLWARDROBE; then quit."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaWardrobe.IsValid())
			{
				return;
			}
			GQaWardrobe = MakeShared<FQaWardrobe>();
			GQaWardrobe->World = World;
			GQaWardrobe->At = QaNow();
			GQaWardrobe->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLWARDROBE"));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaWardrobeTick), 0.05f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLWARDROBE armed: %d skins, framing from the pixels, six seconds of idle each, then 360"), static_cast<int32>(UE_ARRAY_COUNT(WardrobeRoster)));
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

	/* ================================================================ wl.Qa.Card: C.A.R.D. + Mission Handoff, M0 (the model)
	 * Runs on a SCRATCH store (Saved/Wonderland/QaCards), never the player's Cards.sav, except the persist phases, which
	 * prove the real store across a restart (founder: "persistence across restart"). Every line: WLCARDQA <id> PASS|FAIL.
	 */
	struct FCardQa
	{
		int32 Pass = 0;
		int32 Fail = 0;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCARDQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
	};

	FString QaCardDir()
	{
		return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("QaCards"));
	}

	/** A sealed file holding exactly this text (the store's own seal), for the hostile and fallback cases. */
	void QaSealed(const FString& Path, const FString& Text)
	{
		WonderlandBeta::SaveSealedText(Path, Text);
	}

	bool QaFileHas(const FString& Path, const TCHAR* Needle)
	{
		TArray<uint8> Bytes;
		if (!FFileHelper::LoadFileToArray(Bytes, *Path))
		{
			return false;
		}
		// the whole file, seal included: its 16 binary bytes cannot spell a needle
		return FString::ConstructFromPtrSize(reinterpret_cast<const UTF8CHAR*>(Bytes.GetData()), Bytes.Num()).Contains(Needle, ESearchCase::IgnoreCase);
	}

	int32 QaRefusedBeside(const FString& Path)
	{
		TArray<FString> Found;
		IFileManager::Get().FindFiles(Found, *FPaths::Combine(FPaths::GetPath(Path), FPaths::GetBaseFilename(Path) + TEXT(".refused-*")), true, false);
		return Found.Num();
	}

	void RunCardQa()
	{
		FCardQa Q;
		IFileManager& Files = IFileManager::Get();
		const FString Dir = QaCardDir();
		Files.DeleteDirectory(*Dir, /*RequireExists*/ false, /*Tree*/ true);
		Files.MakeDirectory(*Dir, /*Tree*/ true);
		const FString P = FPaths::Combine(Dir, TEXT("Cards.sav"));

		// C1: A FRESH STORE -- the built-in card, active, with the two companions on their canonical sides
		{
			FWonderlandCardStore S(P);
			S.Load();
			const FWonderlandCard& A = S.GetActive();
			Q.Check(TEXT("C1"), S.GetCards().Num() == 1 && S.GetActiveId() == FWonderlandCardStore::BuiltInId() && A.bBuiltIn && A.Companions.Num() == 2
				&& A.Companions[0].Slot == 0 && A.Companions[0].Kind == EWonderlandCardCompanionKind::Llm && A.Companions[1].Slot == 1
				&& A.MissionHandoff == TEXT("angelic_twin_swords") && S.GetLoadNote().IsEmpty(),
				FString::Printf(TEXT("fresh store: %d card(s), active '%s', handoff '%s', LEFT slot0 %s, RIGHT slot1 %s"), S.GetCards().Num(), *S.GetActiveId(),
					*A.MissionHandoff, A.Companions.Num() > 0 ? *A.Companions[0].ProviderId : TEXT("-"), A.Companions.Num() > 1 ? *A.Companions[1].ProviderId : TEXT("-")));
		}
		// C2: CREATE, EDIT, SELECT, SAVE, RELOAD
		FString NewId;
		{
			FWonderlandCardStore S(P);
			S.Load();
			FString Why;
			NewId = S.Create(TEXT("Explorer"), Why);
			bool bUpdated = false;
			if (const FWonderlandCard* Made = S.Find(NewId))
			{
				FWonderlandCard C = *Made;
				C.Skin = TEXT("shadow_flame");
				C.Primary.Key = TEXT("WHITE");
				C.Primary.bChosen = true;
				FWonderlandCapabilityRef Cap;
				Cap.Kind = EWonderlandCapabilityKind::Mcp;
				Cap.Id = TEXT("filesystem");
				Cap.Label = TEXT("Files");
				C.Capabilities.Add(Cap);
				bUpdated = S.Update(C, Why);
			}
			const bool bSelected = S.Select(NewId, Why);
			const bool bSaved = S.Save();
			FWonderlandCardStore R(P);
			R.Load();
			const FWonderlandCard* Back = R.Find(NewId);
			Q.Check(TEXT("C2"), !NewId.IsEmpty() && bUpdated && bSelected && bSaved && Back != nullptr && R.GetActiveId() == NewId
				&& Back->Skin == TEXT("shadow_flame") && Back->Primary.Key == TEXT("WHITE") && Back->Primary.bChosen && Back->Capabilities.Num() == 1
				&& Back->Capabilities[0].Kind == EWonderlandCapabilityKind::Mcp && Back->Name == TEXT("Explorer") && R.GetLoadNote().IsEmpty(),
				FString::Printf(TEXT("created '%s', edited, selected, saved %s; reloaded: active '%s', skin %s, primary %s/%s, %d capability, note '%s'"),
					*NewId, bSaved ? TEXT("ok") : TEXT("FAILED"), *R.GetActiveId(), Back != nullptr ? *Back->Skin : TEXT("-"),
					Back != nullptr ? *Back->Primary.Key : TEXT("-"), Back != nullptr && Back->Primary.bChosen ? TEXT("chosen") : TEXT("-"),
					Back != nullptr ? Back->Capabilities.Num() : -1, *R.GetLoadNote()));
		}
		// C3: SWITCH back to the default; the active id persists across a reload
		{
			FWonderlandCardStore S(P);
			S.Load();
			FString Why;
			const bool bSel = S.Select(FWonderlandCardStore::BuiltInId(), Why) && S.Save();
			FWonderlandCardStore R(P);
			R.Load();
			Q.Check(TEXT("C3"), bSel && R.GetActiveId() == FWonderlandCardStore::BuiltInId() && R.Find(NewId) != nullptr,
				FString::Printf(TEXT("switched to the default and reloaded: active '%s', '%s' still stored %s"), *R.GetActiveId(), *NewId,
					R.Find(NewId) != nullptr ? TEXT("yes") : TEXT("NO")));
		}
		// C4: DELETE -- the active card falls back to the built-in; the built-in cannot be deleted; the last user card can
		{
			FWonderlandCardStore S(P);
			S.Load();
			FString Why;
			S.Select(NewId, Why);
			const bool bDeleted = S.Delete(NewId, Why);
			const FString ActiveAfter = S.GetActiveId();
			FString WhyBuiltIn;
			const bool bBuiltInRefused = !S.Delete(FWonderlandCardStore::BuiltInId(), WhyBuiltIn);
			Q.Check(TEXT("C4"), bDeleted && ActiveAfter == FWonderlandCardStore::BuiltInId() && bBuiltInRefused && S.GetCards().Num() == 1,
				FString::Printf(TEXT("deleted the active '%s': %s, active now '%s'; deleting the built-in refused %s ('%s'); %d card(s) left"),
					*NewId, bDeleted ? TEXT("yes") : TEXT("NO"), *ActiveAfter, bBuiltInRefused ? TEXT("yes") : TEXT("NO"), *WhyBuiltIn, S.GetCards().Num()));
		}
		// C5: SECRETS ARE REFUSED, NOT STORED -- names and labels shaped like keys, tokens, private keys, credential refs
		{
			FWonderlandCardStore S(P);
			S.Load();
			// ASSEMBLED AT RUN TIME: a literal key prefix would sit in the package, where the release scan (pii_scan.py) reads
			// for exactly those -- and a hit there must always mean a real leak
			const FString Sk = FString(TEXT("sk")) + TEXT("-");
			const FString Gh = FString(TEXT("gh")) + TEXT("p_");
			const FString Pem = FString(TEXT("-----BEGIN PRIV")) + TEXT("ATE KEY----- MIIE");
			const FString Tail = TEXT("0123456789abcdefghijklmnopqrstuvwxyzAB");
			const FString Hostile[] = { Sk + TEXT("proj-") + Tail, TEXT("https://api.example.com/x?token=abc123"), Pem,
				TEXT("credentialRef: vault://julius/openai"), TEXT("Bearer eyJhbGciOi"), Gh + Tail,
				// split by a control character, which cleaning would remove: the key must not be reassembled into the file
				Sk + TEXT("\nproj-") + Tail, FString(TEXT("gh\tp_")) + Tail };
			int32 Refused = 0;
			for (const FString& Text : Hostile)
			{
				FString Why;
				if (S.Create(Text, Why).IsEmpty())
				{
					++Refused;
				}
				FWonderlandCard C = S.GetActive();
				FWonderlandCapabilityRef Cap;
				Cap.Kind = EWonderlandCapabilityKind::Api;
				Cap.Id = TEXT("weather");
				Cap.Label = Text;
				C.Capabilities.Add(Cap);
				if (!S.Update(C, Why))
				{
					++Refused;
				}
			}
			// an ID shaped like a key is refused too (it is safe for an FName, and still never stored)
			FString WhyId;
			FWonderlandCard KeyId = S.GetActive();
			FWonderlandCapabilityRef Cap;
			Cap.Kind = EWonderlandCapabilityKind::Mcp;
			Cap.Id = Gh + Tail;
			Cap.Label = TEXT("Files");
			KeyId.Capabilities.Add(Cap);
			const bool bIdRefused = WonderlandBeta::IsSafeId(Cap.Id) && !S.Update(KeyId, WhyId);
			S.Save();
			const bool bClean = !QaFileHas(P, *(Sk + TEXT("proj"))) && !QaFileHas(P, TEXT("token=")) && !QaFileHas(P, TEXT("BEGIN PRIV"))
				&& !QaFileHas(P, TEXT("vault://")) && !QaFileHas(P, TEXT("Bearer ")) && !QaFileHas(P, *Gh) && !QaFileHas(P, *Tail);
			const int32 Expected = 2 * static_cast<int32>(UE_ARRAY_COUNT(Hostile));
			Q.Check(TEXT("C5"), Refused == Expected && bIdRefused && bClean,
				FString::Printf(TEXT("secret-shaped names and labels refused %d of %d; a key-shaped capability id refused %s; the saved file ")
					TEXT("holds none of them: %s"), Refused, Expected, bIdRefused ? TEXT("yes") : TEXT("NO"), bClean ? TEXT("yes") : TEXT("NO")));
		}
		// C5b: AN INVISIBLE CHARACTER NEVER HIDES A KEY (Second's M0-3) -- a key split by a zero-width space, a soft hyphen, a
		// BOM, a C1 control, a TAG character, a word joiner or a bidi override is refused; one in an ordinary name is dropped;
		// ordinary spaces stay (a key deliberately split by spaces is the documented limit)
		{
			FWonderlandCardStore S(P);
			S.Load();
			const FString Gh = FString(TEXT("gh")) + TEXT("p_");
			const FString Half1 = TEXT("0123456789abcdef");
			const FString Half2 = TEXT("ghijklmnopqrstuvwxyzAB");
			FString Tag;  // U+E0041 as UTF-16
			Tag.AppendChar(static_cast<TCHAR>(0xDB40));
			Tag.AppendChar(static_cast<TCHAR>(0xDC41));
			const FString Splitters[] = { FString::Chr(static_cast<TCHAR>(0x200B)), FString::Chr(static_cast<TCHAR>(0x00AD)),
				FString::Chr(static_cast<TCHAR>(0xFEFF)), FString::Chr(static_cast<TCHAR>(0x0085)), Tag, FString::Chr(static_cast<TCHAR>(0x2060)),
				FString::Chr(static_cast<TCHAR>(0x202E)) };
			int32 Refused = 0;
			for (const FString& Split : Splitters)
			{
				FString Why;
				if (S.Create(Gh + Half1 + Split + Half2, Why).IsEmpty())
				{
					++Refused;
				}
			}
			FString Why;
			const FString KeptId = S.Create(FString(TEXT("Files")) + FString::Chr(static_cast<TCHAR>(0x200B)) + TEXT(" (local)"), Why);
			const FString SpacedId = S.Create(TEXT("my notes part one two"), Why);
			const FWonderlandCard* Kept = S.Find(KeptId);
			const FWonderlandCard* Spaced = S.Find(SpacedId);
			const bool bNames = Kept != nullptr && Kept->Name == TEXT("Files (local)") && Spaced != nullptr && Spaced->Name == TEXT("my notes part one two");
			const int32 Expected = static_cast<int32>(UE_ARRAY_COUNT(Splitters));
			Q.Check(TEXT("C5b"), Refused == Expected && bNames,
				FString::Printf(TEXT("a key split by an invisible character (zero-width space, soft hyphen, BOM, C1, TAG, word joiner, bidi) ")
					TEXT("refused %d of %d; a zero-width space in an ordinary name dropped, its spaces kept: %s"), Refused, Expected,
					bNames ? TEXT("yes") : TEXT("NO")));
		}
		// C6: NAMES ARE CLEANED -- control characters and newlines stripped; a 10 kB name capped
		{
			FWonderlandCardStore S(P);
			S.Load();
			FString Why;
			// (never a QA token in the hostile text: this line is echoed, and a harness counting PASS lines must not see one)
			const FString Id1 = S.Create(TEXT("Line one\nforged second line\tend"), Why);
			const FString Id2 = S.Create(FString::ChrN(10240, TEXT('x')), Why);
			const FWonderlandCard* C1 = S.Find(Id1);
			const FWonderlandCard* C2 = S.Find(Id2);
			Q.Check(TEXT("C6"), C1 != nullptr && !C1->Name.Contains(TEXT("\n")) && !C1->Name.Contains(TEXT("\t")) && C2 != nullptr
				&& C2->Name.Len() == FWonderlandCardStore::MaxLabelChars,
				FString::Printf(TEXT("a name with a newline and a tab stored as '%s'; a 10240-char name stored at %d chars"),
					C1 != nullptr ? *C1->Name : TEXT("-"), C2 != nullptr ? C2->Name.Len() : -1));
		}
		// C7: UNKNOWN IDS FALL BACK, WITH A NOTE -- a skin id that is not an id, a handoff id that is not an id
		{
			// (and two companion references: one with a slot no integer can hold, refused before any conversion; one valid)
			QaSealed(P, TEXT("{\"format\":\"wonderland.cards.v1\",\"active\":\"x1\",\"cards\":[{\"id\":\"x1\",\"name\":\"Odd\",\"skin\":\"bad skin!!\",")
				TEXT("\"missionHandoff\":\"../../etc\",\"primary\":{\"key\":\"WHITE\",\"chosen\":true},\"companions\":[")
				TEXT("{\"slot\":1e300,\"kind\":\"llm\",\"provider\":\"dev-companion\",\"label\":\"Huge\"},")
				TEXT("{\"slot\":1,\"kind\":\"agent\",\"provider\":\"dev-single-agent\",\"label\":\"JHINN\"}]},")
				// (Second's M0-5: a CLEAN id that names a form this build does not have; DEFAULT marked chosen)
				TEXT("{\"id\":\"x2\",\"name\":\"Two\",\"missionHandoff\":\"excalibur\",\"primary\":{\"key\":\"DEFAULT\",\"chosen\":true}}]}"));
			FWonderlandCardStore S(P);
			S.Load();
			const FWonderlandCard* C = S.Find(TEXT("x1"));
			const FWonderlandCard* C2 = S.Find(TEXT("x2"));
			const bool bSlots = C != nullptr && C->Companions.Num() == 1 && C->Companions[0].Slot == 1
				&& S.GetLoadNote().Contains(TEXT("companion reference was refused"));
			const bool bForm = C2 != nullptr && C2->MissionHandoff == TEXT("angelic_twin_swords") && S.GetLoadNote().Contains(TEXT("card x2: unknown Mission Handoff"))
				&& C2->Primary.Key == TEXT("DEFAULT") && !C2->Primary.bChosen;
			Q.Check(TEXT("C7"), C != nullptr && C->Skin == TEXT("relay_og") && C->MissionHandoff == TEXT("angelic_twin_swords") && S.GetActiveId() == TEXT("x1")
				&& S.GetLoadNote().Contains(TEXT("unknown skin")) && S.Find(FWonderlandCardStore::BuiltInId()) != nullptr && bSlots && bForm,
				FString::Printf(TEXT("a card naming an invalid skin and handoff: skin -> %s, handoff -> %s, built-in restored %s; a slot of 1e300 ")
					TEXT("refused and the valid companion kept %s; a clean but unknown form falls back and DEFAULT is stored not chosen %s; note '%s'"),
					C != nullptr ? *C->Skin : TEXT("-"), C != nullptr ? *C->MissionHandoff : TEXT("-"),
					S.Find(FWonderlandCardStore::BuiltInId()) != nullptr ? TEXT("yes") : TEXT("NO"), bSlots ? TEXT("yes") : TEXT("NO"),
					bForm ? TEXT("yes") : TEXT("NO"), *S.GetLoadNote()));
		}
		// C8: HOSTILE FILES -- each is set aside, the store starts from the default, nothing crashes
		{
			struct FCase { const TCHAR* Name; TFunction<void()> Plant; };
			const FString Big = FString::ChrN(2 * 1024 * 1024, TEXT('a'));
			TArray<FCase> Cases;
			Cases.Add({ TEXT("truncated"), [&P]() { TArray<uint8> B; B.Add('{'); B.Add('"'); FFileHelper::SaveArrayToFile(B, *P); } });
			Cases.Add({ TEXT("bad CRC"), [&P]() { WonderlandBeta::SaveSealedText(P, TEXT("{\"format\":\"wonderland.cards.v1\",\"cards\":[]}"));
				TArray<uint8> B; FFileHelper::LoadFileToArray(B, *P); B[2] ^= 0x20; FFileHelper::SaveArrayToFile(B, *P); } });
			Cases.Add({ TEXT("a valid seal around invalid JSON"), [&P]() { QaSealed(P, TEXT("{\"format\": \"wonderland.cards.v1\", \"cards\": [ {")); } });
			Cases.Add({ TEXT("a 2 MB field"), [&P, &Big]() { QaSealed(P, FString::Printf(TEXT("{\"format\":\"wonderland.cards.v1\",\"cards\":[{\"id\":\"big\",\"name\":\"%s\"}]}"), *Big)); } });
			Cases.Add({ TEXT("another format"), [&P]() { QaSealed(P, TEXT("{\"format\":\"wonderland.cards.v99\",\"cards\":[]}")); } });
			Cases.Add({ TEXT("a nesting bomb"), [&P]() { QaSealed(P, FString::ChrN(20000, TEXT('[')) + FString::ChrN(20000, TEXT(']'))); } });
			int32 Ok = 0;
			FString Detail;
			for (const FCase& Case : Cases)
			{
				Files.DeleteDirectory(*Dir, false, true);
				Files.MakeDirectory(*Dir, true);
				Case.Plant();
				FWonderlandCardStore S(P);
				S.Load();
				const bool bAside = QaRefusedBeside(P) == 1 && !Files.FileExists(*P);
				const bool bDefault = S.GetCards().Num() == 1 && S.GetActiveId() == FWonderlandCardStore::BuiltInId();
				Ok += (bAside && bDefault && !S.GetLoadNote().IsEmpty()) ? 1 : 0;
				Detail += FString::Printf(TEXT("%s%s: set aside %s, default %s"), Detail.IsEmpty() ? TEXT("") : TEXT("; "), Case.Name,
					bAside ? TEXT("yes") : TEXT("NO"), bDefault ? TEXT("yes") : TEXT("NO"));
			}
			// and an active id naming no card: kept file, the default active, noted
			Files.DeleteDirectory(*Dir, false, true);
			Files.MakeDirectory(*Dir, true);
			QaSealed(P, TEXT("{\"format\":\"wonderland.cards.v1\",\"active\":\"ghost\",\"cards\":[{\"id\":\"real\",\"name\":\"Real\"}]}"));
			FWonderlandCardStore S(P);
			S.Load();
			const bool bGhost = S.GetActiveId() == FWonderlandCardStore::BuiltInId() && S.Find(TEXT("real")) != nullptr && S.GetLoadNote().Contains(TEXT("named no card"));
			Q.Check(TEXT("C8"), Ok == Cases.Num() && bGhost,
				FString::Printf(TEXT("%s; an active id naming no card -> default active, the real card kept: %s"), *Detail, bGhost ? TEXT("yes") : TEXT("NO")));
		}
		// C9: FIELDS A LATER BUILD ADDED -- a safe one kept and written back; a secret-shaped one and the excess dropped
		{
			Files.DeleteDirectory(*Dir, false, true);
			Files.MakeDirectory(*Dir, true);
			FString Extra;
			for (int32 N = 0; N < 20; ++N)
			{
				Extra += FString::Printf(TEXT(",\"future_%d\":%d"), N, N);
			}
			// the secret-shaped value assembled at run time (see C5)
			const FString Secret = FString(TEXT("sk")) + TEXT("-proj-abcdefghijklmnopqrstuvwxyz0123456789");
			QaSealed(P, FString::Printf(TEXT("{\"format\":\"wonderland.cards.v1\",\"active\":\"f1\",\"cards\":[{\"id\":\"f1\",\"name\":\"Future\",")
				TEXT("\"aura\":\"silver\",\"leak\":\"%s\"%s}]}"), *Secret, *Extra));
			FWonderlandCardStore S(P);
			S.Load();
			const FWonderlandCard* C = S.Find(TEXT("f1"));
			const int32 Kept = C != nullptr && C->Unknown.IsValid() ? C->Unknown->Values.Num() : 0;
			const bool bAura = C != nullptr && C->Unknown.IsValid() && C->Unknown->HasField(TEXT("aura"));
			const bool bLeak = C != nullptr && C->Unknown.IsValid() && C->Unknown->HasField(TEXT("leak"));
			S.Save();
			const bool bWrittenBack = QaFileHas(P, TEXT("silver"));
			const bool bSecretGone = !QaFileHas(P, TEXT("abcdefghijklmnopqrstuvwxyz0123456789"));
			Q.Check(TEXT("C9"), Kept == FWonderlandCardStore::MaxUnknownFields && bAura && !bLeak && bWrittenBack && bSecretGone,
				FString::Printf(TEXT("22 unknown fields: %d kept (cap %d), 'aura' kept %s and written back %s, the secret-shaped 'leak' dropped %s"), Kept,
					FWonderlandCardStore::MaxUnknownFields, bAura ? TEXT("yes") : TEXT("NO"), bWrittenBack ? TEXT("yes") : TEXT("NO"),
					!bLeak && bSecretGone ? TEXT("yes") : TEXT("NO")));
		}
		// C9b: A SECRET NESTED IN A PASSTHROUGH VALUE (Second's M0-2) -- a key split by a newline inside an array, and one as a
		// nested KEY, are dropped with their fields; an ordinary nested value is kept and written back
		{
			Files.DeleteDirectory(*Dir, false, true);
			Files.MakeDirectory(*Dir, true);
			// 20 + 20 key characters: no run reaches 32 until the newline between them is gone
			const FString A20 = TEXT("abcdefghij0123456789");
			const FString B20 = TEXT("klmnopqrst9876543210");
			QaSealed(P, FString::Printf(TEXT("{\"format\":\"wonderland.cards.v1\",\"active\":\"n1\",\"cards\":[{\"id\":\"n1\",\"name\":\"Nested\",")
				TEXT("\"inArray\":{\"x\":[\"%s\\n%s\"]},\"asKey\":{\"y\":{\"%s\\n%s\":1}},\"benign\":{\"deep\":[1,\"two\",{\"three\":true}]}}]}"),
				*A20, *B20, *A20, *B20));
			FWonderlandCardStore S(P);
			S.Load();
			const FWonderlandCard* C = S.Find(TEXT("n1"));
			const bool bArrayDropped = C != nullptr && (!C->Unknown.IsValid() || !C->Unknown->HasField(TEXT("inArray")));
			const bool bKeyDropped = C != nullptr && (!C->Unknown.IsValid() || !C->Unknown->HasField(TEXT("asKey")));
			const bool bBenignKept = C != nullptr && C->Unknown.IsValid() && C->Unknown->HasField(TEXT("benign"));
			S.Save();
			const bool bGone = !QaFileHas(P, *A20) && !QaFileHas(P, *B20) && QaFileHas(P, TEXT("three"));
			Q.Check(TEXT("C9b"), bArrayDropped && bKeyDropped && bBenignKept && bGone,
				FString::Printf(TEXT("a key split by a newline inside a nested array dropped %s; one as a nested key dropped %s; an ordinary nested ")
					TEXT("value kept %s; the saved file holds neither half, and the ordinary value: %s"), bArrayDropped ? TEXT("yes") : TEXT("NO"),
					bKeyDropped ? TEXT("yes") : TEXT("NO"), bBenignKept ? TEXT("yes") : TEXT("NO"), bGone ? TEXT("yes") : TEXT("NO")));
		}
		// C10: THE FILE NEVER OUTGROWS ITS LOADER (Second's M0-1) -- copies of a card carrying 16 large passthrough fields are
		// made until one would not fit: that one is refused and undone, the store saves, and a reload keeps EVERY card
		{
			Files.DeleteDirectory(*Dir, false, true);
			Files.MakeDirectory(*Dir, true);
			const FString Filler = FString::ChrN(3900, TEXT('a'));
			FString Fields;
			for (int32 N = 0; N < FWonderlandCardStore::MaxUnknownFields; ++N)
			{
				Fields += FString::Printf(TEXT(",\"pad%d\":\"%s\""), N, *Filler);
			}
			QaSealed(P, FString::Printf(TEXT("{\"format\":\"wonderland.cards.v1\",\"active\":\"heavy\",\"cards\":[{\"id\":\"heavy\",\"name\":\"Heavy\"%s}]}"), *Fields));
			FWonderlandCardStore S(P);
			S.Load();
			int32 Made = 0;
			FString RefusedWhy;
			for (int32 N = 0; N < 12; ++N)
			{
				FString Why;
				if (S.Create(FString::Printf(TEXT("Copy %d"), N + 1), Why).IsEmpty())
				{
					RefusedWhy = Why;
					break;
				}
				++Made;
			}
			const int32 Before = S.GetCards().Num();
			const bool bSaved = S.Save();
			FWonderlandCardStore R(P);
			R.Load();
			const int64 Bytes = IFileManager::Get().FileSize(*P);
			Q.Check(TEXT("C10"), Made >= 1 && RefusedWhy.Contains(TEXT("no longer fit")) && bSaved && R.GetCards().Num() == Before && R.GetLoadNote().IsEmpty()
				&& Bytes > 0 && Bytes <= FWonderlandCardStore::MaxFileBytes + 16,
				FString::Printf(TEXT("a card carrying 16 x 3.9 KB of passthrough: %d copies made, the next refused ('%s'); saved %s at %lld bytes ")
					TEXT("(cap %lld + the seal); a reload keeps %d of %d card(s), note '%s'"), Made, *RefusedWhy, bSaved ? TEXT("yes") : TEXT("NO"), Bytes,
					FWonderlandCardStore::MaxFileBytes, R.GetCards().Num(), Before, *R.GetLoadNote()));
		}
		// C11: A REFUSED FILE THAT CANNOT BE SET ASIDE (Second's M0-6) -- the store goes read-only: a change and a save are both
		// refused and the original bytes are never overwritten. The set-aside is blocked by directories holding every name it
		// could take in the next 40 s (the engine retries a failed move for ~5 s, logging that it could not).
		{
			Files.DeleteDirectory(*Dir, false, true);
			Files.MakeDirectory(*Dir, true);
			QaSealed(P, TEXT("{\"format\": \"wonderland.cards.v1\", \"cards\": [ {"));
			TArray<uint8> Original;
			FFileHelper::LoadFileToArray(Original, *P);
			const FDateTime Now = FDateTime::UtcNow();
			for (int32 Offset = -2; Offset <= 40; ++Offset)
			{
				const FDateTime At = Now + FTimespan::FromSeconds(Offset);
				Files.MakeDirectory(*FPaths::Combine(Dir, FString::Printf(TEXT("Cards.refused-%s.sav"), *At.ToString(TEXT("%Y%m%d-%H%M%S")))), true);
			}
			FWonderlandCardStore S(P);
			S.Load();
			FString WhyCreate;
			const bool bCreateRefused = S.Create(TEXT("Blocked"), WhyCreate).IsEmpty();
			const bool bSaveRefused = !S.Save();
			TArray<uint8> After;
			FFileHelper::LoadFileToArray(After, *P);
			const bool bUntouched = Original.Num() > 0 && After == Original;
			Q.Check(TEXT("C11"), S.IsReadOnly() && bCreateRefused && WhyCreate.Contains(TEXT("read-only")) && bSaveRefused && bUntouched
				&& S.GetLoadNote().Contains(TEXT("could not be set aside")),
				FString::Printf(TEXT("a refused file whose set-aside was blocked: read-only %s, a change refused %s ('%s'), a save refused %s, the ")
					TEXT("original bytes untouched %s; note '%s'"), S.IsReadOnly() ? TEXT("yes") : TEXT("NO"), bCreateRefused ? TEXT("yes") : TEXT("NO"),
					*WhyCreate, bSaveRefused ? TEXT("yes") : TEXT("NO"), bUntouched ? TEXT("yes") : TEXT("NO"), *S.GetLoadNote()));
			Files.DeleteDirectory(*Dir, false, true);
			Files.MakeDirectory(*Dir, true);
		}

		// --- the Mission Handoff MODEL (M0: no visuals; the terminal action and the presentation come in M1)
		const FString H = FPaths::Combine(Dir, TEXT("MissionHandoff.sav"));
		FWonderlandMissionHandoff::FCompanionsPresent Both;
		Both.bLeft = true;
		Both.bRight = true;
		// H1: a handoff runs its phases to HELD, and the write spy counts 0 along the way
		{
			FWonderlandMissionHandoff::ResetSpy();
			FWonderlandMissionHandoff M(H);
			M.Load([](const FString&) { return false; });
			FString Why;
			const bool bBegun = M.Begin(TEXT("angelic_twin_swords"), TEXT("m-qa-1"), EWonderlandHandoffEntry::MidMission, Both, Why);
			TArray<FString> Seen;
			Seen.Add(FWonderlandMissionHandoff::StateName(M.GetState()));
			bool bArmedEarly = M.IsArmed();
			for (int32 Step = 0; Step < 100 && M.GetState() != EWonderlandHandoffState::Held; ++Step)
			{
				if (M.Tick(0.1f))
				{
					Seen.Add(FWonderlandMissionHandoff::StateName(M.GetState()));
				}
				bArmedEarly |= M.IsArmed() && M.GetState() != EWonderlandHandoffState::Held;
			}
			const FString Path = FString::Join(Seen, TEXT(" > "));
			Q.Check(TEXT("H1"), bBegun && Path == TEXT("ACKNOWLEDGED > TRANSFORMING > DELIVERING > HELD") && M.GetMissionId() == TEXT("m-qa-1")
				&& !bArmedEarly && M.IsArmed() && FWonderlandMissionHandoff::GetMutationsInScope() == 0,
				FString::Printf(TEXT("begin %s; phases %s; armed before HELD %s, at HELD %s; mission '%s'; writes counted inside the handoff ")
					TEXT("path: %d (M0: the model's own path only; the mission/task mutators report to the spy from M1)"), bBegun ? TEXT("ok") : *Why,
					*Path, bArmedEarly ? TEXT("YES") : TEXT("no"), M.IsArmed() ? TEXT("yes") : TEXT("NO"), *M.GetMissionId(),
					FWonderlandMissionHandoff::GetMutationsInScope()));
		}
		// H2: refused while equipped, and without a companion body (named)
		{
			FWonderlandMissionHandoff M(FPaths::Combine(Dir, TEXT("MissionHandoff2.sav")));
			M.Load([](const FString&) { return false; });
			FString Why1;
			FString Why2;
			FString Why3;
			FWonderlandMissionHandoff::FCompanionsPresent NoLeft = Both;
			NoLeft.bLeft = false;
			const bool bNoLeft = !M.Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, NoLeft, Why1);
			M.Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why2);
			const bool bTwice = !M.Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why3);
			Q.Check(TEXT("H2"), bNoLeft && Why1.Contains(TEXT("LLM Companion")) && bTwice,
				FString::Printf(TEXT("without the LEFT body: refused %s ('%s'); a second begin while equipped refused %s ('%s')"),
					bNoLeft ? TEXT("yes") : TEXT("NO"), *Why1, bTwice ? TEXT("yes") : TEXT("NO"), *Why3));
		}
		// H3: ROAMING WITH NO MISSION -- allowed, visual only, nothing mission-shaped
		{
			FWonderlandMissionHandoff M(FPaths::Combine(Dir, TEXT("MissionHandoff3.sav")));
			M.Load([](const FString&) { return false; });
			FString Why;
			const bool bBegun = M.Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why);
			Q.Check(TEXT("H3"), bBegun && M.GetMissionId().IsEmpty() && M.GetEntry() == EWonderlandHandoffEntry::Roaming,
				FString::Printf(TEXT("roaming, no mission: begun %s, mission '%s' (must be empty)"), bBegun ? TEXT("yes") : *Why, *M.GetMissionId()));
		}
		// H4: RECONNECT RESTORES -- HELD, attached when the mission still runs; roaming with a note when it does not
		{
			FWonderlandMissionHandoff Alive(H);
			Alive.Load([](const FString& Id) { return Id == TEXT("m-qa-1"); });
			FWonderlandMissionHandoff Gone(H);
			Gone.Load([](const FString&) { return false; });
			Q.Check(TEXT("H4"), Alive.GetState() == EWonderlandHandoffState::Held && Alive.GetMissionId() == TEXT("m-qa-1")
				&& Gone.GetState() == EWonderlandHandoffState::Held && Gone.GetMissionId().IsEmpty() && !Gone.GetLoadNote().IsEmpty(),
				FString::Printf(TEXT("restored with the mission running: %s attached to '%s'; with it gone: %s, mission '%s', note '%s'"),
					FWonderlandMissionHandoff::StateName(Alive.GetState()), *Alive.GetMissionId(), FWonderlandMissionHandoff::StateName(Gone.GetState()),
					*Gone.GetMissionId(), *Gone.GetLoadNote()));
		}
		// H5: RETURN -- HELD > RETURNING > IDLE, and a reload is not equipped
		{
			FWonderlandMissionHandoff M(H);
			M.Load([](const FString& Id) { return Id == TEXT("m-qa-1"); });
			FString Why;
			const bool bArmedBefore = M.IsArmed();
			const bool bReturned = M.Return(Why);
			// the founder's deactivation rule: nothing of the traversal state outlives the return's first moment
			const bool bArmedAfterReturn = M.IsArmed();
			for (int32 Step = 0; Step < 100 && M.GetState() != EWonderlandHandoffState::Idle; ++Step)
			{
				M.Tick(0.1f);
			}
			FWonderlandMissionHandoff R(H);
			R.Load([](const FString&) { return true; });
			Q.Check(TEXT("H5"), bArmedBefore && bReturned && !bArmedAfterReturn && M.GetState() == EWonderlandHandoffState::Idle
				&& R.GetState() == EWonderlandHandoffState::Idle,
				FString::Printf(TEXT("armed before the return %s; return %s; armed right after it %s; state %s; after a reload %s"),
					bArmedBefore ? TEXT("yes") : TEXT("NO"), bReturned ? TEXT("ok") : *Why, bArmedAfterReturn ? TEXT("YES") : TEXT("no"),
					FWonderlandMissionHandoff::StateName(M.GetState()), FWonderlandMissionHandoff::StateName(R.GetState())));
		}
		// H6: THE SPY'S POSITIVE CONTROL -- a write inside a handoff scope IS counted; one outside is not
		{
			FWonderlandMissionHandoff::ResetSpy();
			FWonderlandMissionHandoff::NoteMutation(TEXT("QA outside any scope"));
			const int32 Outside = FWonderlandMissionHandoff::GetMutationsInScope();
			{
				FWonderlandMissionHandoff::FScope Scope;
				FWonderlandMissionHandoff::NoteMutation(TEXT("QA positive control"));
			}
			const int32 Inside = FWonderlandMissionHandoff::GetMutationsInScope();
			const FString Last = FWonderlandMissionHandoff::GetLastMutationInScope();
			FWonderlandMissionHandoff::ResetSpy();
			Q.Check(TEXT("H6"), Outside == 0 && Inside == 1 && Last == TEXT("QA positive control"),
				FString::Printf(TEXT("the spy: outside a scope %d (want 0), inside %d (want 1, '%s')"), Outside, Inside, *Last));
		}
		// H7: A HOSTILE RECORD -- set aside, not equipped
		{
			const FString HB = FPaths::Combine(Dir, TEXT("MissionHandoff7.sav"));
			TArray<uint8> Bytes;
			Bytes.Append(reinterpret_cast<const uint8*>("equipped=1"), 10);
			FFileHelper::SaveArrayToFile(Bytes, *HB);
			FWonderlandMissionHandoff M(HB);
			M.Load([](const FString&) { return true; });
			Q.Check(TEXT("H7"), M.GetState() == EWonderlandHandoffState::Idle && QaRefusedBeside(HB) == 1,
				FString::Printf(TEXT("an unsealed 'equipped=1': state %s, set aside %s"), FWonderlandMissionHandoff::StateName(M.GetState()),
					QaRefusedBeside(HB) == 1 ? TEXT("yes") : TEXT("NO")));
		}
		// H8: A RESTART DURING THE RETURN does not bring the swords back (Second's M0-4): the record says not equipped the moment
		// the return begins, while a restart while HELD still restores them
		{
			const FString H8 = FPaths::Combine(Dir, TEXT("MissionHandoff8.sav"));
			FWonderlandMissionHandoff M(H8);
			M.Load([](const FString&) { return false; });
			FString Why;
			M.Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why);
			for (int32 Step = 0; Step < 100 && M.GetState() != EWonderlandHandoffState::Held; ++Step)
			{
				M.Tick(0.1f);
			}
			FWonderlandMissionHandoff WhileHeld(H8);
			WhileHeld.Load([](const FString&) { return true; });
			const bool bReturned = M.Return(Why);
			FWonderlandMissionHandoff WhileReturning(H8);
			WhileReturning.Load([](const FString&) { return true; });
			Q.Check(TEXT("H8"), WhileHeld.GetState() == EWonderlandHandoffState::Held && bReturned && M.GetState() == EWonderlandHandoffState::Returning
				&& WhileReturning.GetState() == EWonderlandHandoffState::Idle,
				FString::Printf(TEXT("a restart while held restores %s; return %s, now %s; a restart during the return restores %s (want IDLE)"),
					FWonderlandMissionHandoff::StateName(WhileHeld.GetState()), bReturned ? TEXT("ok") : *Why, FWonderlandMissionHandoff::StateName(M.GetState()),
					FWonderlandMissionHandoff::StateName(WhileReturning.GetState())));
		}
		// H9: A FORM THIS BUILD DOES NOT HAVE (Second's M0-5) -- Begin refuses it; a sealed record naming one restores not equipped
		{
			const FString H9 = FPaths::Combine(Dir, TEXT("MissionHandoff9.sav"));
			FWonderlandMissionHandoff M(H9);
			M.Load([](const FString&) { return false; });
			FString Why;
			const bool bRefused = !M.Begin(TEXT("excalibur"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why);
			QaSealed(H9, TEXT("wonderland.handoff.v1\nequipped=1\nobject=excalibur\nmission=-\nentry=roaming\n"));
			FWonderlandMissionHandoff R(H9);
			R.Load([](const FString&) { return true; });
			Q.Check(TEXT("H9"), bRefused && R.GetState() == EWonderlandHandoffState::Idle && R.GetLoadNote().Contains(TEXT("does not have")),
				FString::Printf(TEXT("begin with an unknown form refused %s ('%s'); a sealed record naming one restores %s, note '%s'"),
					bRefused ? TEXT("yes") : TEXT("NO"), *Why, FWonderlandMissionHandoff::StateName(R.GetState()), *R.GetLoadNote()));
		}
		Files.DeleteDirectory(*Dir, false, true);
		UE_LOG(LogWonderlandQa, Display, TEXT("WLCARDQA END model pass=%d fail=%d"), Q.Pass, Q.Fail);
	}

	UWonderlandSidekickSubsystem* QaSidekicks(UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
	}

	/** RESTART, FIRST BOOT: the REAL stores (the profile's Saved/Wonderland), as the subsystem owns them. */
	void RunCardPersistWrite(UWorld* World)
	{
		FCardQa Q;
		UWonderlandSidekickSubsystem* Sidekicks = QaSidekicks(World);
		if (Sidekicks == nullptr)
		{
			Q.Check(TEXT("P1"), false, TEXT("no sidekick subsystem: the real stores cannot be reached"));
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCARDQA END persist-write pass=%d fail=%d"), Q.Pass, Q.Fail);
			return;
		}
		// P1: a card created, edited, selected and saved in the real store; the file on disk is sealed
		FWonderlandCardStore& S = Sidekicks->GetCardStore();
		FString Why;
		const FString Id = S.Create(TEXT("Persisted"), Why);
		bool bEdited = false;
		if (const FWonderlandCard* Made = S.Find(Id))
		{
			FWonderlandCard C = *Made;
			C.Skin = TEXT("shadow_flame");
			C.Primary.Key = TEXT("WHITE");
			C.Primary.bChosen = true;
			bEdited = S.Update(C, Why);
		}
		const bool bSelected = S.Select(Id, Why);
		const bool bSaved = S.Save();
		FString Text;
		FString LoadWhy;
		const bool bSealed = WonderlandBeta::LoadSealedText(S.GetPath(), FWonderlandCardStore::MaxFileBytes, Text, LoadWhy);
		Q.Check(TEXT("P1"), !Id.IsEmpty() && bEdited && bSelected && bSaved && bSealed && S.GetPath() == FWonderlandCardStore::DefaultPath(),
			FString::Printf(TEXT("the real store (%s): created '%s', edited %s, selected %s, saved %s, sealed on disk %s"),
				*FPaths::GetCleanFilename(S.GetPath()), *Id, bEdited ? TEXT("yes") : *Why, bSelected ? TEXT("yes") : TEXT("NO"),
				bSaved ? TEXT("yes") : TEXT("NO"), bSealed ? TEXT("yes") : *LoadWhy));
		// P2: the real handoff record, begun mid-mission and driven to HELD
		FWonderlandMissionHandoff& M = Sidekicks->GetMissionHandoff();
		FWonderlandMissionHandoff::FCompanionsPresent Both;
		Both.bLeft = true;
		Both.bRight = true;
		const bool bBegun = M.Begin(TEXT("angelic_twin_swords"), TEXT("m-persist"), EWonderlandHandoffEntry::MidMission, Both, Why);
		for (int32 Step = 0; Step < 100 && M.GetState() != EWonderlandHandoffState::Held; ++Step)
		{
			M.Tick(0.1f);
		}
		const bool bOnDisk = IFileManager::Get().FileExists(*FWonderlandMissionHandoff::DefaultPath());
		Q.Check(TEXT("P2"), bBegun && M.IsArmed() && M.GetMissionId() == TEXT("m-persist") && bOnDisk,
			FString::Printf(TEXT("the real handoff: begun %s, state %s, mission '%s', record on disk %s"), bBegun ? TEXT("yes") : *Why,
				FWonderlandMissionHandoff::StateName(M.GetState()), *M.GetMissionId(), bOnDisk ? TEXT("yes") : TEXT("NO")));
		UE_LOG(LogWonderlandQa, Display, TEXT("WLCARDQA END persist-write pass=%d fail=%d"), Q.Pass, Q.Fail);
	}

	/** RESTART, SECOND BOOT: what the subsystem loaded AT BOOT, before anything here touched it; then a clean profile. */
	void RunCardPersistCheck(UWorld* World)
	{
		FCardQa Q;
		UWonderlandSidekickSubsystem* Sidekicks = QaSidekicks(World);
		if (Sidekicks == nullptr)
		{
			Q.Check(TEXT("P3"), false, TEXT("no sidekick subsystem: the real stores cannot be reached"));
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCARDQA END persist-check pass=%d fail=%d"), Q.Pass, Q.Fail);
			return;
		}
		// P3: the card came back, active, as it was saved
		FWonderlandCardStore& S = Sidekicks->GetCardStore();
		const FWonderlandCard Active = S.GetActive();
		Q.Check(TEXT("P3"), Active.Name == TEXT("Persisted") && Active.Skin == TEXT("shadow_flame") && Active.Primary.Key == TEXT("WHITE")
			&& Active.Primary.bChosen && !Active.bBuiltIn && S.GetCards().Num() == 2 && S.GetLoadNote().IsEmpty(),
			FString::Printf(TEXT("after the restart: %d card(s), active '%s' named '%s', skin %s, primary %s%s, note '%s'"), S.GetCards().Num(),
				*Active.Id, *Active.Name, *Active.Skin, *Active.Primary.Key, Active.Primary.bChosen ? TEXT(" (chosen)") : TEXT(""), *S.GetLoadNote()));
		// P4: the handoff came back HELD without a replay. The mission it named is not running after a restart (M0 wires no
		// mission source), so it is restored ROAMING with a note: nothing fabricated.
		FWonderlandMissionHandoff& M = Sidekicks->GetMissionHandoff();
		Q.Check(TEXT("P4"), M.GetState() == EWonderlandHandoffState::Held && M.IsArmed() && M.GetMissionId().IsEmpty()
			&& M.GetEntry() == EWonderlandHandoffEntry::Roaming && M.GetLoadNote().Contains(TEXT("no longer running")),
			FString::Printf(TEXT("after the restart: %s, mission '%s', entry %s, note '%s'"), FWonderlandMissionHandoff::StateName(M.GetState()),
				*M.GetMissionId(), M.GetEntry() == EWonderlandHandoffEntry::Roaming ? TEXT("roaming") : TEXT("mid-mission"), *M.GetLoadNote()));
		// P5: the profile left clean (Second's H5: a bed must never boot armed): the card deleted, the swords returned, and a
		// fresh read of both files agrees
		FString Why;
		const bool bDeleted = S.Delete(Active.Id, Why) && S.Save();
		const bool bReturned = M.Return(Why);
		for (int32 Step = 0; Step < 100 && M.GetState() != EWonderlandHandoffState::Idle; ++Step)
		{
			M.Tick(0.1f);
		}
		FWonderlandCardStore Fresh(FWonderlandCardStore::DefaultPath());
		Fresh.Load();
		FWonderlandMissionHandoff FreshHandoff(FWonderlandMissionHandoff::DefaultPath());
		FreshHandoff.Load([](const FString&) { return true; });
		Q.Check(TEXT("P5"), bDeleted && bReturned && Fresh.GetActiveId() == FWonderlandCardStore::BuiltInId() && Fresh.GetCards().Num() == 1
			&& FreshHandoff.GetState() == EWonderlandHandoffState::Idle,
			FString::Printf(TEXT("clean-up: card deleted %s, swords returned %s; a fresh read: active '%s', %d card(s), handoff %s"),
				bDeleted ? TEXT("yes") : TEXT("NO"), bReturned ? TEXT("yes") : TEXT("NO"), *Fresh.GetActiveId(), Fresh.GetCards().Num(),
				FWonderlandMissionHandoff::StateName(FreshHandoff.GetState())));
		UE_LOG(LogWonderlandQa, Display, TEXT("WLCARDQA END persist-check pass=%d fail=%d"), Q.Pass, Q.Fail);
	}

	FAutoConsoleCommandWithWorldAndArgs GQaCardCommand(
		TEXT("wl.Qa.Card"),
		TEXT("C.A.R.D. + Mission Handoff, M0. No argument: the model on a scratch store -- the store (create, save, reload, switch, ")
		TEXT("delete, secret refusal, hostile files, passthrough) and the handoff (phases, gates, roaming, restore, return, the write ")
		TEXT("spy). `persist-write` then `persist-check` on the next boot: the REAL stores across a restart. `quit` exits after. ")
		TEXT("Logs WLCARDQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (Args.Contains(TEXT("persist-write")))
			{
				RunCardPersistWrite(World);
			}
			else if (Args.Contains(TEXT("persist-check")))
			{
				RunCardPersistCheck(World);
			}
			else
			{
				RunCardQa();
			}
			if (Args.Contains(TEXT("quit")))
			{
				FPlatformMisc::RequestExit(false);
			}
		}));

	/* ================================================================ wl.Qa.Handoff: Mission Handoff traversal, M1
	 * The founder's acceptance list, measured in the PACKAGED game with the real movement component:
	 *   S1-S3  normal run vs Mission Handoff run vs dash. Pre-registered before any measurement: the handoff run is at least
	 *          1.35x the normal run, and the dash peaks at at least 2.0x the HANDOFF run;
	 *   I1-I9  the Forward rules, delivered exactly as BindKey delivers them (the character's own key handlers);
	 *   W1     a dash into a blocking wall never passes through it -- and does reach it;
	 *   R1     giving the swords back restores every speed.
	 * Real-key abuse (the OS's key repeat, focus loss) is Second's, by real input. Logs WLHANDQA lines; `quit` exits after.
	 */
	struct FHandKey
	{
		float At;
		bool bUpArrow;
		bool bDown;
	};

	struct FHandTest
	{
		const TCHAR* Id;
		const TCHAR* What;
		TArray<FHandKey> Keys;
		int32 WantDashes;
		int32 WantRefusals;
		/** Wait out the dash cooldown before this test (false only for the test that must land INSIDE it). */
		bool bAfterCooldown;
	};

	struct FQaHand
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ARelayDogCharacter> Dog;
		TWeakObjectPtr<AActor> Wall;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		float PhaseAt = 0.0f;
		float LastNow = 0.0f;
		FVector Forward = FVector::ForwardVector;
		float SpeedSum = 0.0f;
		int32 Samples = 0;
		float NormalRun = 0.0f;
		float HandoffRun = 0.0f;
		float DashPeak = 0.0f;
		float DashSeconds = 0.0f;
		TArray<FHandTest> Tests;
		int32 TestIndex = 0;
		int32 KeyIndex = 0;
		bool bTestStarted = false;
		int32 DashBase = 0;
		int32 RefusedBase = 0;
		bool bReturnedMidDash = false;
		float MidDashAt = 0.0f;
		bool bMidDashWasDashing = false;
		bool bMidDashChecked = false;
		bool bMidDashEnded = false;
		FVector WallCenter = FVector::ZeroVector;
		float MaxAlong = -1.0e9f;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLHANDQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
	};
	TSharedPtr<FQaHand> GQaHand;

	FWonderlandMissionHandoff* QaHandoff(UWorld* World)
	{
		UWonderlandSidekickSubsystem* Sidekicks = QaSidekicks(World);
		return Sidekicks != nullptr ? &Sidekicks->GetMissionHandoff() : nullptr;
	}

	/** The clearest heading across open ground from the Dog: 16 headings, a sphere of the capsule's radius swept at its height. */
	float QaClearHeading(UWorld* World, ARelayDogCharacter* Dog, float Want, FVector& OutForward)
	{
		const float Radius = Dog->GetCapsuleComponent()->GetScaledCapsuleRadius();
		const FVector Start = Dog->GetActorLocation() + FVector(0.0f, 0.0f, 20.0f);
		FCollisionQueryParams Params;
		Params.AddIgnoredActor(Dog);
		float Best = -1.0f;
		for (int32 N = 0; N < 16; ++N)
		{
			const FVector Way = FRotator(0.0f, N * 22.5f, 0.0f).Vector();
			FHitResult Hit;
			const bool bHit = World->SweepSingleByChannel(Hit, Start, Start + Way * Want, FQuat::Identity, ECC_Pawn, FCollisionShape::MakeSphere(Radius), Params);
			const float Free = bHit ? Hit.Distance : Want;
			if (Free > Best)
			{
				Best = Free;
				OutForward = Way;
			}
		}
		return Best;
	}

	/** Faces the camera (and so the Forward key and the dash) along a heading. */
	void QaFace(ARelayDogCharacter* Dog, const FVector& Forward)
	{
		if (AController* Controller = Dog->GetController())
		{
			Controller->SetControlRotation(FRotator(0.0f, Forward.Rotation().Yaw, 0.0f));
		}
	}

	void QaHandRelease(ARelayDogCharacter* Dog)
	{
		Dog->QaForwardKey(false, false);
		Dog->QaForwardKey(true, false);
		Dog->QaRunKey(false);
	}

	void QaHandFinish(FQaHand& H, const TCHAR* Why)
	{
		if (ARelayDogCharacter* Dog = H.Dog.Get())
		{
			QaHandRelease(Dog);
		}
		if (AActor* Wall = H.Wall.Get())
		{
			Wall->Destroy();
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLHANDQA END pass=%d fail=%d%s"), H.Pass, H.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
		if (H.bQuit)
		{
			FPlatformMisc::RequestExit(false);
		}
	}

	TArray<FHandTest> QaHandTests()
	{
		TArray<FHandTest> T;
		T.Add({ TEXT("I1"), TEXT("one tap"), { { 0.00f, false, true }, { 0.06f, false, false } }, 0, 0, true });
		T.Add({ TEXT("I2"), TEXT("two taps 0.45 s apart (slower than the window)"),
			{ { 0.00f, false, true }, { 0.06f, false, false }, { 0.45f, false, true }, { 0.51f, false, false } }, 0, 0, true });
		T.Add({ TEXT("I3"), TEXT("W held while Up is tapped twice (no new Forward press)"),
			{ { 0.00f, false, true }, { 0.10f, true, true }, { 0.15f, true, false }, { 0.20f, true, true }, { 0.25f, true, false }, { 0.40f, false, false } }, 0, 0, true });
		T.Add({ TEXT("I4"), TEXT("W held with the key repeating (repeated presses while down)"),
			{ { 0.00f, false, true }, { 0.05f, false, true }, { 0.10f, false, true }, { 0.15f, false, true }, { 0.30f, false, false } }, 0, 0, true });
		T.Add({ TEXT("I5"), TEXT("W tapped, then Up 0.15 s later (one semantic Forward)"),
			{ { 0.00f, false, true }, { 0.06f, false, false }, { 0.15f, true, true }, { 0.30f, true, false } }, 1, 0, true });
		T.Add({ TEXT("I6"), TEXT("a double tap inside the cooldown"),
			{ { 0.00f, false, true }, { 0.05f, false, false }, { 0.12f, false, true }, { 0.17f, false, false } }, 0, 1, false });
		T.Add({ TEXT("I7"), TEXT("three quick taps (no chaining)"),
			{ { 0.00f, false, true }, { 0.05f, false, false }, { 0.10f, false, true }, { 0.15f, false, false }, { 0.20f, false, true }, { 0.25f, false, false } }, 1, 0, true });
		T.Add({ TEXT("I10"), TEXT("a teleport 0.1 s into a dash"),
			{ { 0.00f, false, true }, { 0.05f, false, false }, { 0.10f, false, true }, { 0.60f, false, false } }, 1, 0, true });
		T.Add({ TEXT("I11"), TEXT("the menu opened 0.1 s into a dash"),
			{ { 0.00f, false, true }, { 0.05f, false, false }, { 0.10f, false, true }, { 0.60f, false, false } }, 1, 0, true });
		T.Add({ TEXT("I8"), TEXT("the swords given back mid-dash"),
			{ { 0.00f, false, true }, { 0.05f, false, false }, { 0.10f, false, true }, { 0.60f, false, false } }, 1, 0, true });
		T.Add({ TEXT("I9"), TEXT("a double tap with no swords held"),
			{ { 0.00f, false, true }, { 0.05f, false, false }, { 0.10f, false, true }, { 0.20f, false, false } }, 0, 0, true });
		return T;
	}

	bool QaHandTick(float)
	{
		if (!GQaHand.IsValid())
		{
			return false;
		}
		FQaHand& H = *GQaHand;
		UWorld* World = H.World.Get();
		ARelayDogCharacter* Dog = H.Dog.Get();
		FWonderlandMissionHandoff* Handoff = QaHandoff(World);
		if (World == nullptr || Dog == nullptr || Handoff == nullptr || Dog->GetCharacterMovement() == nullptr)
		{
			QaHandFinish(H, TEXT("the world, the Dog or the handoff went away"));
			GQaHand.Reset();
			return false;
		}
		UCharacterMovementComponent* Move = Dog->GetCharacterMovement();
		const float Now = World->GetTimeSeconds();
		const float Dt = FMath::Max(0.0f, Now - H.LastNow);
		H.LastNow = Now;
		const float In = Now - H.PhaseAt;
		const float Ground = FVector(Dog->GetVelocity().X, Dog->GetVelocity().Y, 0.0f).Size();
		const float Radius = Dog->GetCapsuleComponent()->GetScaledCapsuleRadius();
		FString Why;
		auto Next = [&H, Now]()
		{
			++H.Phase;
			H.PhaseAt = Now;
			H.SpeedSum = 0.0f;
			H.Samples = 0;
		};
		auto Stop = [&H](const TCHAR* Reason)
		{
			QaHandFinish(H, Reason);
			GQaHand.Reset();
			return false;
		};
		FWonderlandMissionHandoff::FCompanionsPresent Both;
		Both.bLeft = true;
		Both.bRight = true;

		switch (H.Phase)
		{
		case 0:
		{
			// THE WORLD READY: the first launch's welcome closed, and the Dog standing on loaded ground for a moment
			if (UWonderlandUiSubsystem* U = QaUi(World))
			{
				if (U->IsWelcomeOpen())
				{
					U->DismissWelcome();
				}
			}
			if (In < 3.0f || !Move->IsMovingOnGround())
			{
				return In < 30.0f ? true : Stop(TEXT("the Dog never stood on loaded ground"));
			}
			// START UNEQUIPPED: a bed that last ran armed must not measure the "normal" run armed (Second's H5)
			if (Handoff->GetState() == EWonderlandHandoffState::Held)
			{
				Handoff->Return(Why);
			}
			if (Handoff->GetState() != EWonderlandHandoffState::Idle)
			{
				return In < 38.0f ? true : Stop(TEXT("the handoff did not return to idle"));
			}
			Next();
			return true;
		}
		case 1:
		{
			// S1, THE NORMAL RUN: Forward and Shift held across open ground
			const float Clear = QaClearHeading(World, Dog, 2600.0f, H.Forward);
			if (Clear < 1400.0f)
			{
				H.Check(TEXT("S1"), false, FString::Printf(TEXT("no open ground for the measurement (best heading clear for %.0f uu)"), Clear));
				return Stop(TEXT("no open ground"));
			}
			QaFace(Dog, H.Forward);
			Dog->QaRunKey(true);
			Dog->QaForwardKey(false, true);
			Next();
			return true;
		}
		case 2:
			Dog->AddMovementInput(H.Forward, 1.0f);
			if (In >= 1.2f)
			{
				H.SpeedSum += Ground;
				++H.Samples;
			}
			if (In >= 1.8f)
			{
				H.NormalRun = H.Samples > 0 ? H.SpeedSum / H.Samples : 0.0f;
				H.Check(TEXT("S1"), H.NormalRun > 0.9f * Dog->RunSpeedUU && H.NormalRun < 1.1f * Dog->RunSpeedUU && !Dog->IsHandoffArmed(),
					FString::Printf(TEXT("normal run, no swords: %.0f uu/s (the run band is %.0f)"), H.NormalRun, Dog->RunSpeedUU));
				QaHandRelease(Dog);
				Next();
			}
			return true;
		case 3:
			if (In < 1.0f)
			{
				return true;
			}
			// THE SWORDS TAKEN UP (roaming, no mission). M1's QA states the companions present; the terminal action (M1b) reads
			// them from their bodies.
			if (!Handoff->Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why))
			{
				H.Check(TEXT("S2"), false, FString::Printf(TEXT("the handoff could not begin: %s"), *Why));
				return Stop(TEXT("no handoff"));
			}
			Next();
			return true;
		case 4:
		{
			if (!Dog->IsHandoffArmed())
			{
				return In < 8.0f ? true : Stop(TEXT("the swords were never held"));
			}
			const float Clear = QaClearHeading(World, Dog, 2600.0f, H.Forward);
			if (Clear < 1600.0f)
			{
				H.Check(TEXT("S2"), false, FString::Printf(TEXT("no open ground for the measurement (best heading clear for %.0f uu)"), Clear));
				return Stop(TEXT("no open ground"));
			}
			QaFace(Dog, H.Forward);
			Dog->QaRunKey(true);
			Dog->QaForwardKey(false, true);
			Next();
			return true;
		}
		case 5:
			// S2, THE HANDOFF RUN; then, still running, S3's double tap
			Dog->AddMovementInput(H.Forward, 1.0f);
			if (In >= 1.2f && In < 1.8f)
			{
				H.SpeedSum += Ground;
				++H.Samples;
			}
			if (In >= 1.8f)
			{
				H.HandoffRun = H.Samples > 0 ? H.SpeedSum / H.Samples : 0.0f;
				const float Ratio = H.NormalRun > 0.0f ? H.HandoffRun / H.NormalRun : 0.0f;
				H.Check(TEXT("S2"), Ratio >= 1.35f,
					FString::Printf(TEXT("Mission Handoff run: %.0f uu/s = %.2fx the normal run (pre-registered: >= 1.35x)"), H.HandoffRun, Ratio));
				H.DashBase = Dog->GetDashCount();
				Next();
			}
			return true;
		case 6:
			// S3, THE DASH from the handoff run: W up, down, up, down -- the second press within the window
			Dog->AddMovementInput(H.Forward, 1.0f);
			if (H.KeyIndex == 0 && In >= 0.00f) { Dog->QaForwardKey(false, false); H.KeyIndex = 1; }
			if (H.KeyIndex == 1 && In >= 0.04f) { Dog->QaForwardKey(false, true); H.KeyIndex = 2; }
			if (H.KeyIndex == 2 && In >= 0.08f) { Dog->QaForwardKey(false, false); H.KeyIndex = 3; }
			if (H.KeyIndex == 3 && In >= 0.12f) { Dog->QaForwardKey(false, true); H.KeyIndex = 4; }
			if (Dog->IsDashing())
			{
				H.DashPeak = FMath::Max(H.DashPeak, Ground);
				H.DashSeconds += Dt;
			}
			if (In >= 1.0f)
			{
				const float Ratio = H.HandoffRun > 0.0f ? H.DashPeak / H.HandoffRun : 0.0f;
				const bool bOne = Dog->GetDashCount() == H.DashBase + 1;
				H.Check(TEXT("S3"), bOne && Ratio >= 2.0f,
					FString::Printf(TEXT("dash: %d started, peak %.0f uu/s = %.2fx the handoff run (pre-registered: >= 2.0x), %.2fx the normal run"),
						Dog->GetDashCount() - H.DashBase, H.DashPeak, Ratio, H.NormalRun > 0.0f ? H.DashPeak / H.NormalRun : 0.0f));
				H.Check(TEXT("S3b"), H.DashSeconds > 0.35f && H.DashSeconds < 0.60f,
					FString::Printf(TEXT("the dash lasted %.2f s (wl.Handoff.DashSeconds 0.45)"), H.DashSeconds));
				QaHandRelease(Dog);
				H.KeyIndex = 0;
				H.Tests = QaHandTests();
				H.TestIndex = 0;
				H.bTestStarted = false;
				Next();
			}
			return true;
		case 7:
		{
			// I1-I9, ONE AT A TIME
			if (H.TestIndex >= H.Tests.Num())
			{
				Next();
				return true;
			}
			FHandTest& Test = H.Tests[H.TestIndex];
			const bool bWantArmed = FCString::Strcmp(Test.Id, TEXT("I9")) != 0;
			if (!H.bTestStarted)
			{
				// the right handoff state, the cooldown waited out where asked, and open ground ahead for a dash
				if (bWantArmed && !Dog->IsHandoffArmed())
				{
					if (Handoff->GetState() == EWonderlandHandoffState::Idle)
					{
						Handoff->Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why);
					}
					return In < 10.0f ? true : Stop(TEXT("the swords could not be taken up for a test"));
				}
				if (!bWantArmed && Handoff->GetState() != EWonderlandHandoffState::Idle)
				{
					return In < 10.0f ? true : Stop(TEXT("the handoff did not return for the unarmed test"));
				}
				if (Test.bAfterCooldown && In < 1.6f)
				{
					return true;
				}
				QaClearHeading(World, Dog, 1200.0f, H.Forward);
				QaFace(Dog, H.Forward);
				H.DashBase = Dog->GetDashCount();
				H.RefusedBase = Dog->GetDashesRefused();
				H.KeyIndex = 0;
				H.bReturnedMidDash = false;
				H.bMidDashWasDashing = false;
				H.bMidDashChecked = false;
				H.bMidDashEnded = false;
				H.bTestStarted = true;
				H.PhaseAt = Now;
				return true;
			}
			while (H.KeyIndex < Test.Keys.Num() && In >= Test.Keys[H.KeyIndex].At)
			{
				Dog->QaForwardKey(Test.Keys[H.KeyIndex].bUpArrow, Test.Keys[H.KeyIndex].bDown);
				++H.KeyIndex;
			}
			// I8: THE SWORDS GIVEN BACK 0.1 s INTO THE DASH; one frame later nothing of the traversal may remain
			if (FCString::Strcmp(Test.Id, TEXT("I8")) == 0 && !H.bReturnedMidDash && In >= 0.20f)
			{
				const bool bWasDashing = Dog->IsDashing();
				Handoff->Return(Why);
				H.bReturnedMidDash = true;
				H.Check(TEXT("I8a"), bWasDashing, FString::Printf(TEXT("a dash was under way when the swords were given back: %s"), bWasDashing ? TEXT("yes") : TEXT("NO")));
			}
			// I10 / I11: A TELEPORT, OR A PANEL OPENED, 0.1 s INTO THE DASH (Second's V2-5): the dash must end at once. It is
			// read 0.1 s after the event, still inside the dash's own 0.45 s, so a dash that ran on would be caught.
			const bool bI10 = FCString::Strcmp(Test.Id, TEXT("I10")) == 0;
			const bool bI11 = FCString::Strcmp(Test.Id, TEXT("I11")) == 0;
			if ((bI10 || bI11) && !H.bReturnedMidDash && In >= 0.20f)
			{
				H.bMidDashWasDashing = Dog->IsDashing();
				if (bI10)
				{
					Dog->TeleportTo(Dog->GetActorLocation() + FVector(0.0f, 0.0f, 5.0f), Dog->GetActorRotation(), false, true);
				}
				else if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					if (!U->IsMenuOpen())
					{
						U->ToggleMenu();
					}
				}
				H.bReturnedMidDash = true;
				H.MidDashAt = Now;
			}
			if ((bI10 || bI11) && H.bReturnedMidDash && !H.bMidDashChecked && Now - H.MidDashAt >= 0.10f)
			{
				H.bMidDashEnded = !Dog->IsDashing();
				H.bMidDashChecked = true;
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					if (bI11 && U->IsMenuOpen())
					{
						U->ToggleMenu();
					}
				}
			}
			const float LastKey = Test.Keys.Num() > 0 ? Test.Keys.Last().At : 0.0f;
			if (In < LastKey + 0.8f)
			{
				return true;
			}
			const int32 Dashes = Dog->GetDashCount() - H.DashBase;
			const int32 Refusals = Dog->GetDashesRefused() - H.RefusedBase;
			FString Extra;
			bool bOk = Dashes == Test.WantDashes && Refusals == Test.WantRefusals;
			if (bI10 || bI11)
			{
				bOk &= H.bMidDashWasDashing && H.bMidDashEnded;
				Extra = FString::Printf(TEXT("; dashing when it happened %s, the dash over 0.1 s later %s"), H.bMidDashWasDashing ? TEXT("yes") : TEXT("NO"),
					H.bMidDashEnded ? TEXT("yes") : TEXT("NO"));
			}
			if (FCString::Strcmp(Test.Id, TEXT("I8")) == 0)
			{
				const bool bRestored = !Dog->IsDashing() && !Dog->IsHandoffArmed() && FMath::IsNearlyEqual(Move->MaxAcceleration, Dog->GetNormalAcceleration(), 0.5f)
					&& Move->MaxWalkSpeed <= Dog->RunSpeedUU + 0.5f;
				bOk &= bRestored;
				Extra = FString::Printf(TEXT("; after the return: dashing %s, armed %s, acceleration %.0f (normal %.0f), speed cap %.0f (run band %.0f)"),
					Dog->IsDashing() ? TEXT("YES") : TEXT("no"), Dog->IsHandoffArmed() ? TEXT("YES") : TEXT("no"), Move->MaxAcceleration, Dog->GetNormalAcceleration(),
					Move->MaxWalkSpeed, Dog->RunSpeedUU);
			}
			H.Check(Test.Id, bOk, FString::Printf(TEXT("%s: dashes %d (want %d), refused %d (want %d)%s"), Test.What, Dashes, Test.WantDashes, Refusals,
				Test.WantRefusals, *Extra));
			QaHandRelease(Dog);
			++H.TestIndex;
			H.bTestStarted = false;
			H.PhaseAt = Now;
			return true;
		}
		case 8:
		{
			// W1, THE WALL: the swords taken up again, a blocking wall 380 uu ahead, a dash straight at it
			if (!Dog->IsHandoffArmed())
			{
				if (Handoff->GetState() == EWonderlandHandoffState::Idle)
				{
					Handoff->Begin(TEXT("angelic_twin_swords"), FString(), EWonderlandHandoffEntry::Roaming, Both, Why);
				}
				return In < 10.0f ? true : Stop(TEXT("the swords could not be taken up for the wall"));
			}
			if (In < 1.6f)
			{
				return true;
			}
			const float Clear = QaClearHeading(World, Dog, 900.0f, H.Forward);
			if (Clear < 600.0f)
			{
				H.Check(TEXT("W1"), false, FString::Printf(TEXT("no open ground before the wall (best heading clear for %.0f uu)"), Clear));
				return Stop(TEXT("no open ground"));
			}
			QaFace(Dog, H.Forward);
			H.WallCenter = Dog->GetActorLocation() + H.Forward * 380.0f;
			FActorSpawnParameters Spawn;
			Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			AActor* Wall = World->SpawnActor<AActor>(AActor::StaticClass(), H.WallCenter, H.Forward.Rotation(), Spawn);
			if (Wall == nullptr)
			{
				H.Check(TEXT("W1"), false, TEXT("the wall could not be spawned"));
				return Stop(TEXT("no wall"));
			}
			UBoxComponent* Box = NewObject<UBoxComponent>(Wall);
			Box->SetBoxExtent(FVector(20.0f, 400.0f, 300.0f));
			Box->SetCollisionProfileName(UCollisionProfile::BlockAll_ProfileName);
			Wall->SetRootComponent(Box);
			Box->RegisterComponent();
			Box->SetWorldLocationAndRotation(H.WallCenter, H.Forward.Rotation());
			H.Wall = Wall;
			H.MaxAlong = -1.0e9f;
			H.DashBase = Dog->GetDashCount();
			H.KeyIndex = 0;
			Next();
			return true;
		}
		case 9:
		{
			Dog->AddMovementInput(H.Forward, 1.0f);
			if (H.KeyIndex == 0 && In >= 0.00f) { Dog->QaForwardKey(false, true); H.KeyIndex = 1; }
			if (H.KeyIndex == 1 && In >= 0.05f) { Dog->QaForwardKey(false, false); H.KeyIndex = 2; }
			if (H.KeyIndex == 2 && In >= 0.10f) { Dog->QaForwardKey(false, true); H.KeyIndex = 3; }
			// how far along the dash the Dog's centre came, measured from the wall's centre (its near face is at -20)
			H.MaxAlong = FMath::Max(H.MaxAlong, FVector::DotProduct(Dog->GetActorLocation() - H.WallCenter, H.Forward));
			if (In < 1.0f)
			{
				return true;
			}
			const float Touch = -20.0f - Radius;
			const bool bDashed = Dog->GetDashCount() == H.DashBase + 1;
			const bool bHeld = H.MaxAlong <= Touch + 2.0f;
			const bool bReached = H.MaxAlong >= Touch - 40.0f;
			H.Check(TEXT("W1"), bDashed && bHeld && bReached,
				FString::Printf(TEXT("a dash at a blocking wall 380 uu ahead: dashed %s; the Dog's centre came to %.1f uu of touching the wall's face ")
					TEXT("(contact at %.1f, at most 2 uu past it allowed): passed through %s, reached it %s"), bDashed ? TEXT("yes") : TEXT("NO"),
					Touch - H.MaxAlong, Touch, bHeld ? TEXT("no") : TEXT("YES"), bReached ? TEXT("yes") : TEXT("NO")));
			QaHandRelease(Dog);
			if (AActor* Wall = H.Wall.Get())
			{
				Wall->Destroy();
			}
			Next();
			return true;
		}
		case 10:
			// R1, THE RETURN: every speed restored
			if (Handoff->GetState() == EWonderlandHandoffState::Held)
			{
				Handoff->Return(Why);
			}
			if (Handoff->GetState() != EWonderlandHandoffState::Idle && In < 6.0f)
			{
				return true;
			}
			if (In < 0.3f)
			{
				return true;
			}
			H.Check(TEXT("R1"), Handoff->GetState() == EWonderlandHandoffState::Idle && !Dog->IsHandoffArmed() && !Dog->IsDashing()
				&& FMath::IsNearlyEqual(Move->MaxAcceleration, Dog->GetNormalAcceleration(), 0.5f) && Move->MaxWalkSpeed <= Dog->RunSpeedUU + 0.5f,
				FString::Printf(TEXT("after the return: handoff %s, armed %s, dashing %s, acceleration %.0f (normal %.0f), speed cap %.0f"),
					FWonderlandMissionHandoff::StateName(Handoff->GetState()), Dog->IsHandoffArmed() ? TEXT("YES") : TEXT("no"),
					Dog->IsDashing() ? TEXT("YES") : TEXT("no"), Move->MaxAcceleration, Dog->GetNormalAcceleration(), Move->MaxWalkSpeed));
			return Stop(nullptr);
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaHandoffCommand(
		TEXT("wl.Qa.Handoff"),
		TEXT("Mission Handoff traversal, M1, in this (packaged) build: the normal run vs the handoff run vs the dash (pre-registered ")
		TEXT("ratios), the Forward rules through the character's own key handlers, a dash into a blocking wall, and the return ")
		TEXT("restoring every speed. Logs WLHANDQA lines; `quit` exits after."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaHand.IsValid())
			{
				return;
			}
			ARelayDogCharacter* Dog = QaDog(World);
			if (Dog == nullptr || World == nullptr)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLHANDQA END pass=0 fail=1 (no Relay Dog to drive)"));
				if (Args.Contains(TEXT("quit")))
				{
					FPlatformMisc::RequestExit(false);
				}
				return;
			}
			GQaHand = MakeShared<FQaHand>();
			GQaHand->World = World;
			GQaHand->Dog = Dog;
			GQaHand->bQuit = Args.Contains(TEXT("quit"));
			GQaHand->PhaseAt = World->GetTimeSeconds();
			GQaHand->LastNow = GQaHand->PhaseAt;
			GQaHand->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaHandTick), 0.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLHANDQA armed at (%.0f, %.0f, %.0f)"), Dog->GetActorLocation().X, Dog->GetActorLocation().Y,
				Dog->GetActorLocation().Z);
		}));

	/* ================================================================ wl.Qa.HandoffMission: Mission Handoff M1b, the mission paths
	 * The founder's canonical paths (2026-10-02), in the PACKAGED game, through the real routes (the Live Terminal's /handoff):
	 *   A1-A8  Entry A, ROAMING with NO mission: the swords taken up through the terminal, which steps aside; NOTHING mission-
	 *          shaped created (no Contract actor, task, fixture or attachment); the write spy 0. Its POSITIVE controls: a real
	 *          mission write and a real task write made inside a handoff scope ARE counted; one outside a scope is not.
	 *   C0     Scenario D, plain: the control run's record.
	 *   H1-H3  Scenario D again, handed off (Entry B) at RESEARCH, REPAIR and VERIFICATION: the act lets go at once (no act, no
	 *          props, the mission camera released, the companions out of the formation) while the mission runs on;
	 *   R1-R2  the swords given back mid-mission (REVIEW): the CURRENT beat's act resumes, the Contract re-staged by the Dog;
	 *   D1     a dash while the mission runs;
	 *   C1-C5  the control run, PRE-REGISTERED: the same events, verdicts and beats in the same order, every event within 1.0 s
	 *          of the plain run's time; the approval and the completion surfaced while handed off; the terminals told as often;
	 *          the write spy 0 for the whole run; the mission's end leaves the swords held and clears the attachment;
	 *   S1-S3  a mission STARTING while handed off (the founder's play command): no travel, no terminal taking the keyboard, no
	 *          act, the attachment on the new mission; its end clears it; the swords given back.
	 * Logs WLHMQA lines, frames to Saved/Screenshots/WLHANDOFF; `quit` exits after.
	 */
	struct FHmStep
	{
		const TCHAR* Id;
		/** Take the swords up (at a beat whose act is WhenAct, from IDLE) or give them back (at such a beat, while HELD). */
		bool bEquip;
		EWonderlandDogAct WhenAct;
		const TCHAR* What;
	};

	struct FQaHm
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ARelayDogCharacter> Dog;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		float PhaseAt = 0.0f;
		FString Dir;
		int32 OrbActors0 = 0;
		int32 Tasks0 = 0;
		int32 Contracts0 = 0;
		FVector At0 = FVector::ZeroVector;
		TArray<FWonderlandOfferedEvent> Plain;
		int32 PlainNarrations = 0;
		TArray<FHmStep> Steps;
		int32 StepIndex = 0;
		float StepAt = -1.0f;
		float IdleAt = -1.0f;
		bool bStepChecked = false;
		int32 ResumesBase = 0;
		bool bDashTried = false;
		bool bDashChecked = false;
		int32 DashBase = 0;
		int32 DashKey = 0;
		float DashAt = -1.0f;
		FVector DashForward = FVector::ForwardVector;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLHMQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
		void Frame(const FString& Name)
		{
			int32 Width = 0;
			int32 Height = 0;
			const FString Path = Dir / (Name + TEXT(".png"));
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLHMQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
		}
	};
	TSharedPtr<FQaHm> GQaHm;

	ULocalPlayer* QaLocalPlayer(UWorld* World)
	{
		const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		return Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	}

	UWonderlandMissionSubsystem* QaMissions(UWorld* World)
	{
		ULocalPlayer* Player = QaLocalPlayer(World);
		return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionSubsystem>() : nullptr;
	}

	UWonderlandMissionTaskSubsystem* QaTaskSet(UWorld* World)
	{
		ULocalPlayer* Player = QaLocalPlayer(World);
		return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
	}

	int32 QaOrbActors(UWorld* World)
	{
		int32 Count = 0;
		for (TActorIterator<AWonderlandMissionOrb> It(World); It; ++It)
		{
			Count += IsValid(*It) ? 1 : 0;
		}
		return Count;
	}

	EWonderlandDogAct QaBeatAct(const UWonderlandMissionSubsystem* Mission)
	{
		return WonderlandDogActForBeat(WonderlandBeatFromId(Mission->GetBeatId()));
	}

	/** The detached presentation, as the player would see it: no act, no prop, no mission camera, no companion in the formation. */
	FString QaDetachedReading(const ARelayDogCharacter* Dog, const UWonderlandMissionSubsystem* Mission, bool& bOutOk)
	{
		const FString Follow = WonderlandCompanionFormationName(EWonderlandCompanionFormation::Follow);
		const bool bNoAct = Dog->PerformingAct() == EWonderlandDogAct::None;
		const int32 Props = Dog->CountVisibleActProps();
		const float Cam = Dog->GetMissionCameraWeight();
		const bool bLeftOut = !Mission->IsCompanionJoined(0) && Mission->GetCompanionFlight(0) == Follow;
		const bool bRightOut = !Mission->IsCompanionJoined(1) && Mission->GetCompanionFlight(1) == Follow;
		bOutOk = bNoAct && Props == 0 && Cam <= 0.01f && bLeftOut && bRightOut && Mission->IsPresentationDetached();
		return FString::Printf(TEXT("act %s, act props visible %d, mission camera %.2f, LLM Companion %s/%s, Jhinn %s/%s, presentation %s"),
			WonderlandDogActName(Dog->PerformingAct()), Props, Cam, Mission->IsCompanionJoined(0) ? TEXT("JOINED") : TEXT("not joined"),
			*Mission->GetCompanionFlight(0), Mission->IsCompanionJoined(1) ? TEXT("JOINED") : TEXT("not joined"), *Mission->GetCompanionFlight(1),
			Mission->IsPresentationDetached() ? TEXT("left") : TEXT("RUNNING"));
	}

	void QaHmFinish(FQaHm& H, const TCHAR* Why)
	{
		if (ARelayDogCharacter* Dog = H.Dog.Get())
		{
			QaHandRelease(Dog);
		}
		// NEVER LEAVE A BED ARMED (Second's H5): the next mascot QA must start with the companions as companions
		if (FWonderlandMissionHandoff* State = QaHandoff(H.World.Get()))
		{
			FString Ignored;
			State->Return(Ignored);
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLHMQA END pass=%d fail=%d%s"), H.Pass, H.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
		if (H.bQuit)
		{
			FPlatformMisc::RequestExit(false);
		}
	}

	bool QaHmTick(float)
	{
		if (!GQaHm.IsValid())
		{
			return false;
		}
		FQaHm& H = *GQaHm;
		UWorld* World = H.World.Get();
		ARelayDogCharacter* Dog = H.Dog.Get();
		FWonderlandMissionHandoff* State = QaHandoff(World);
		UWonderlandMissionSubsystem* Mission = QaMissions(World);
		UWonderlandMissionTaskSubsystem* Tasks = QaTaskSet(World);
		UWonderlandUiSubsystem* Ui = QaUi(World);
		if (World == nullptr || Dog == nullptr || State == nullptr || Mission == nullptr || Tasks == nullptr || Ui == nullptr
			|| Dog->GetCharacterMovement() == nullptr)
		{
			QaHmFinish(H, TEXT("the world, the Dog, the handoff, the missions, the tasks or the UI went away"));
			GQaHm.Reset();
			return false;
		}
		const float Now = World->GetTimeSeconds();
		const float In = Now - H.PhaseAt;
		auto Next = [&H, Now]()
		{
			++H.Phase;
			H.PhaseAt = Now;
		};
		auto Stop = [&H](const TCHAR* Reason)
		{
			QaHmFinish(H, Reason);
			GQaHm.Reset();
			return false;
		};
		auto Terminal = [Ui](const TCHAR* Line)
		{
			Ui->SubmitTerminalLine(Line);
		};

		switch (H.Phase)
		{
		case 0:
		{
			// READY: the welcome closed, the Dog on loaded ground, no mission playing, the companions companions
			if (Ui->IsWelcomeOpen())
			{
				Ui->DismissWelcome();
			}
			if (Mission->IsFixtureRunning())
			{
				Mission->StopFixture();
				Mission->SetBeatById(TEXT("idle"));
			}
			if (State->IsArmed())
			{
				FString Ignored;
				State->Return(Ignored);
			}
			if (In < 3.0f || !Dog->GetCharacterMovement()->IsMovingOnGround() || State->IsEquipped())
			{
				return In < 40.0f ? true : Stop(TEXT("the Dog never stood ready with the swords put away"));
			}
			const FWonderlandMissionHandoff::FCompanionsPresent Present = WonderlandHandoffDirector::ReadCompanions(QaLocalPlayer(World));
			if (!Present.bLeft || !Present.bRight)
			{
				H.Check(TEXT("A0"), false, FString::Printf(TEXT("the companions' bodies: LLM Companion %s, Jhinn %s -- nothing to transform"),
					Present.bLeft ? TEXT("here") : TEXT("MISSING"), Present.bRight ? TEXT("here") : TEXT("MISSING")));
				return Stop(TEXT("no companions"));
			}
			H.OrbActors0 = QaOrbActors(World);
			H.Tasks0 = Tasks->GetTasks().Num();
			H.Contracts0 = Mission->GetContractsManifested();
			FWonderlandMissionHandoff::ResetSpy();
			if (!Ui->IsLiveTerminalOpen())
			{
				Ui->ToggleLiveTerminal();
			}
			Next();
			return true;
		}
		case 1:
		{
			if (In < 0.5f)
			{
				return true;
			}
			// A1: ENTRY A THROUGH THE LIVE TERMINAL, with no mission running
			Terminal(TEXT("/handoff"));
			H.Check(TEXT("A1"), State->GetState() == EWonderlandHandoffState::Acknowledged && State->GetEntry() == EWonderlandHandoffEntry::Roaming
				&& State->GetMissionId().IsEmpty() && Mission->GetRunningMissionId().IsEmpty(),
				FString::Printf(TEXT("/handoff typed in the Live Terminal with no mission: handoff %s, entry %s, attached to '%s' (running mission '%s')"),
					FWonderlandMissionHandoff::StateName(State->GetState()), State->GetEntry() == EWonderlandHandoffEntry::Roaming ? TEXT("roaming") : TEXT("MID-MISSION"),
					*State->GetMissionId(), *Mission->GetRunningMissionId()));
			Next();
			return true;
		}
		case 2:
		{
			// held only after the transformation's 3.3 s: the terminal's next-frame step aside is long done by then
			if (!State->IsArmed())
			{
				return In < 6.0f ? true : Stop(TEXT("the swords were never held"));
			}
			H.Check(TEXT("A2"), !Ui->IsLiveTerminalOpen(), FString::Printf(TEXT("the terminal stepped aside once the swords were taken up: %s"),
				Ui->IsLiveTerminalOpen() ? TEXT("STILL OPEN") : TEXT("closed")));
			const int32 Orbs = QaOrbActors(World);
			const int32 TaskCount = Tasks->GetTasks().Num();
			const bool bNothing = Orbs == H.OrbActors0 && TaskCount == H.Tasks0 && Mission->GetContractsManifested() == H.Contracts0 && !Mission->IsFixtureRunning()
				&& !Mission->IsOrbInWorld() && State->GetMissionId().IsEmpty() && Mission->GetRunningMissionId().IsEmpty();
			H.Check(TEXT("A3"), bNothing && FWonderlandMissionHandoff::GetMutationsInScope() == 0,
				FString::Printf(TEXT("held, roaming: nothing mission-shaped -- Contract actors %d (before %d), tasks %d (before %d), contracts manifested %d (before %d), ")
					TEXT("fixture %s, attached '%s'; writes inside the handoff path %d%s"), Orbs, H.OrbActors0, TaskCount, H.Tasks0, Mission->GetContractsManifested(),
					H.Contracts0, Mission->IsFixtureRunning() ? TEXT("RUNNING") : TEXT("none"), *State->GetMissionId(), FWonderlandMissionHandoff::GetMutationsInScope(),
					FWonderlandMissionHandoff::GetMutationsInScope() > 0 ? *FString::Printf(TEXT(" (last: %s)"), *FWonderlandMissionHandoff::GetLastMutationInScope()) : TEXT("")));
			H.Frame(TEXT("hm_a_roaming_held_no_mission"));
			Next();
			return true;
		}
		case 3:
		{
			// THE SPY'S CONTROLS: a real write inside a handoff scope is counted; the same write outside one is not
			const bool bLlm = Mission->IsLlmCompanionJoined();
			const bool bJhinn = Mission->IsJhinnJoined();
			FWonderlandMissionHandoff::ResetSpy();
			{
				FWonderlandMissionHandoff::FScope Scope;
				Mission->SetJoinedIn(bLlm, bJhinn);
			}
			const int32 MissionCount = FWonderlandMissionHandoff::GetMutationsInScope();
			const FString MissionLast = FWonderlandMissionHandoff::GetLastMutationInScope();
			H.Check(TEXT("A4"), MissionCount == 1 && MissionLast.Contains(TEXT("SetJoinedIn")),
				FString::Printf(TEXT("positive control, the mission: SetJoinedIn (unchanged values) inside a handoff scope counted %d (last '%s')"), MissionCount, *MissionLast));
			FWonderlandMissionHandoff::ResetSpy();
			FGuid Draft;
			{
				FWonderlandMissionHandoff::FScope Scope;
				Draft = Tasks->AddDraft();
				if (Draft.IsValid())
				{
					Tasks->DismissDraft(Draft);
				}
			}
			const int32 TaskWrites = FWonderlandMissionHandoff::GetMutationsInScope();
			H.Check(TEXT("A5"), Draft.IsValid() && TaskWrites == 2 && Tasks->GetTasks().Num() == H.Tasks0,
				FString::Printf(TEXT("positive control, the task set: a draft added and dismissed inside a handoff scope counted %d writes (want 2; the draft %s), tasks back to %d"),
					TaskWrites, Draft.IsValid() ? TEXT("made") : TEXT("REFUSED"), Tasks->GetTasks().Num()));
			FWonderlandMissionHandoff::ResetSpy();
			Mission->SetJoinedIn(bLlm, bJhinn);
			H.Check(TEXT("A6"), FWonderlandMissionHandoff::GetMutationsInScope() == 0,
				FString::Printf(TEXT("negative control: the same mission write OUTSIDE any handoff scope counted %d"), FWonderlandMissionHandoff::GetMutationsInScope()));
			FWonderlandMissionHandoff::ResetSpy();
			// and /handoff again: the swords given back
			Terminal(TEXT("/handoff"));
			H.Check(TEXT("A7"), State->GetState() == EWonderlandHandoffState::Returning,
				FString::Printf(TEXT("/handoff typed again while held: handoff %s"), FWonderlandMissionHandoff::StateName(State->GetState())));
			Next();
			return true;
		}
		case 4:
		{
			if (State->IsEquipped())
			{
				return In < 5.0f ? true : Stop(TEXT("the swords were never given back"));
			}
			UCharacterMovementComponent* Move = Dog->GetCharacterMovement();
			H.Check(TEXT("A8"), FWonderlandMissionHandoff::GetMutationsInScope() == 0 && !Dog->IsHandoffArmed()
				&& FMath::IsNearlyEqual(Move->MaxAcceleration, Dog->GetNormalAcceleration(), 0.5f),
				FString::Printf(TEXT("given back: handoff %s, writes inside the handoff path %d, acceleration %.0f (normal %.0f)"),
					FWonderlandMissionHandoff::StateName(State->GetState()), FWonderlandMissionHandoff::GetMutationsInScope(), Move->MaxAcceleration, Dog->GetNormalAcceleration()));
			// C0: SCENARIO D, PLAIN -- the control run's record
			if (!Mission->RunScenario(TEXT("D"), 3.0f))
			{
				H.Check(TEXT("C0"), false, TEXT("Scenario D did not start"));
				return Stop(TEXT("no scenario"));
			}
			Next();
			return true;
		}
		case 5:
		{
			if (Mission->IsFixtureRunning())
			{
				return In < 150.0f ? true : Stop(TEXT("the plain Scenario D never finished"));
			}
			H.Plain = Mission->GetOfferedRecord();
			H.PlainNarrations = Mission->GetTerminalNarrations();
			const bool bCompleted = H.Plain.ContainsByPredicate([](const FWonderlandOfferedEvent& Row) { return Row.Beat == WonderlandBeatId(EWonderlandMissionBeat::CompleteVerified); });
			H.Check(TEXT("C0"), H.Plain.Num() > 10 && bCompleted,
				FString::Printf(TEXT("the plain run (the control): %d events offered, completion %s, terminals told %d times"), H.Plain.Num(),
					bCompleted ? TEXT("reached") : TEXT("NOT reached"), H.PlainNarrations));
			Next();
			return true;
		}
		case 6:
		{
			if (In < 2.0f)
			{
				return true;
			}
			// THE HANDED-OFF RUN: the same scenario, the same pace; the user leaves and comes back at the founder's points
			H.Steps.Reset();
			H.Steps.Add({ TEXT("H1"), true, EWonderlandDogAct::ReadingTheBook, TEXT("handed off at RESEARCH") });
			H.Steps.Add({ TEXT("R1"), false, EWonderlandDogAct::InspectingTheWork, TEXT("given back at REVIEW") });
			H.Steps.Add({ TEXT("H2"), true, EWonderlandDogAct::CorrectingTheWork, TEXT("handed off at REPAIR") });
			H.Steps.Add({ TEXT("R2"), false, EWonderlandDogAct::InspectingTheWork, TEXT("given back at the re-review") });
			H.Steps.Add({ TEXT("H3"), true, EWonderlandDogAct::VerificationBeam, TEXT("handed off at VERIFICATION") });
			H.StepIndex = 0;
			H.StepAt = -1.0f;
			H.IdleAt = -1.0f;
			H.bStepChecked = false;
			FWonderlandMissionHandoff::ResetSpy();
			if (!Mission->RunScenario(TEXT("D"), 3.0f))
			{
				H.Check(TEXT("C1"), false, TEXT("Scenario D did not start the second time"));
				return Stop(TEXT("no scenario"));
			}
			Next();
			return true;
		}
		case 7:
		{
			// D1: A DASH WHILE THE MISSION RUNS (H1 held, its checks done)
			if (H.StepIndex == 1 && H.bStepChecked && !H.bDashChecked)
			{
				if (!H.bDashTried)
				{
					const float Clear = QaClearHeading(World, Dog, 900.0f, H.DashForward);
					if (Clear < 700.0f)
					{
						H.Check(TEXT("D1"), false, FString::Printf(TEXT("no open ground for a dash beside the mission (best heading clear for %.0f uu)"), Clear));
						H.bDashChecked = true;
					}
					else
					{
						QaFace(Dog, H.DashForward);
						H.DashBase = Dog->GetDashCount();
						H.DashKey = 0;
						H.DashAt = Now;
						H.bDashTried = true;
					}
				}
				else
				{
					const float Since = Now - H.DashAt;
					if (H.DashKey == 0) { Dog->QaForwardKey(false, true); H.DashKey = 1; }
					if (H.DashKey == 1 && Since >= 0.05f) { Dog->QaForwardKey(false, false); H.DashKey = 2; }
					if (H.DashKey == 2 && Since >= 0.10f) { Dog->QaForwardKey(false, true); H.DashKey = 3; }
					if (H.DashKey == 3 && Since >= 0.60f) { Dog->QaForwardKey(false, false); H.DashKey = 4; }
					if (Since >= 1.2f)
					{
						H.Check(TEXT("D1"), Dog->GetDashCount() == H.DashBase + 1 && Mission->IsFixtureRunning(),
							FString::Printf(TEXT("a double tap while handed off mid-mission: %d dash(es), the mission still playing %s"), Dog->GetDashCount() - H.DashBase,
								Mission->IsFixtureRunning() ? TEXT("yes") : TEXT("NO")));
						H.bDashChecked = true;
						H.Frame(TEXT("hm_d1_after_dash_mission_running"));
					}
				}
			}
			// THE PLAN, step by step: each fires at its beat, and is checked before the next may fire
			if (H.StepIndex < H.Steps.Num())
			{
				const FHmStep& Step = H.Steps[H.StepIndex];
				if (H.StepAt < 0.0f)
				{
					const bool bReady = Step.bEquip ? State->GetState() == EWonderlandHandoffState::Idle : State->IsArmed();
					if (Mission->IsFixtureRunning() && bReady && QaBeatAct(Mission) == Step.WhenAct && (Step.bEquip || H.bDashChecked || H.StepIndex != 1))
					{
						H.Frame(FString::Printf(TEXT("hm_%s_before"), Step.Id));
						H.ResumesBase = Mission->GetPresentationResumes();
						Terminal(TEXT("/handoff"));
						H.StepAt = Now;
						H.IdleAt = -1.0f;
						H.bStepChecked = false;
						if (Step.bEquip)
						{
							// AT ONCE, never waited out: the act is gone the moment the handoff begins
							const FString Running = Mission->GetRunningMissionId();
							H.Check(*FString::Printf(TEXT("%sa"), Step.Id), State->GetState() == EWonderlandHandoffState::Acknowledged
								&& State->GetEntry() == EWonderlandHandoffEntry::MidMission && !Running.IsEmpty() && State->GetMissionId() == Running
								&& Dog->PerformingAct() == EWonderlandDogAct::None && Mission->IsPresentationDetached(),
								FString::Printf(TEXT("%s (beat %s): handoff %s, entry %s, attached to '%s' (running '%s'); the Dog's act at once: %s"), Step.What,
									*Mission->GetBeatId().ToString(), FWonderlandMissionHandoff::StateName(State->GetState()),
									State->GetEntry() == EWonderlandHandoffEntry::MidMission ? TEXT("mid-mission") : TEXT("ROAMING"), *State->GetMissionId(), *Running,
									WonderlandDogActName(Dog->PerformingAct())));
						}
						else
						{
							H.Check(*FString::Printf(TEXT("%sa"), Step.Id), State->GetState() == EWonderlandHandoffState::Returning,
								FString::Printf(TEXT("%s (beat %s): handoff %s"), Step.What, *Mission->GetBeatId().ToString(), FWonderlandMissionHandoff::StateName(State->GetState())));
						}
					}
				}
				else if (Step.bEquip && !H.bStepChecked && Now - H.StepAt >= 3.8f)
				{
					// the swords held; the camera's blend (1.6 s) and the act's crossfade long over
					bool bOk = false;
					const FString Reading = QaDetachedReading(Dog, Mission, bOk);
					H.Check(*FString::Printf(TEXT("%sb"), Step.Id), bOk && State->IsArmed() && Mission->IsFixtureRunning(),
						FString::Printf(TEXT("%s, 3.8 s later: handoff %s, the mission still playing %s (beat %s); %s"), Step.What, FWonderlandMissionHandoff::StateName(State->GetState()),
							Mission->IsFixtureRunning() ? TEXT("yes") : TEXT("NO"), *Mission->GetBeatId().ToString(), *Reading));
					H.Frame(FString::Printf(TEXT("hm_%s_held"), Step.Id));
					H.bStepChecked = true;
					++H.StepIndex;
					H.StepAt = -1.0f;
				}
				else if (!Step.bEquip && !H.bStepChecked)
				{
					if (H.IdleAt < 0.0f)
					{
						if (State->GetState() == EWonderlandHandoffState::Idle)
						{
							H.IdleAt = Now;
						}
						else if (Now - H.StepAt > 4.0f)
						{
							H.Check(*FString::Printf(TEXT("%sb"), Step.Id), false, TEXT("the swords never became the companions again"));
							H.bStepChecked = true;
							++H.StepIndex;
							H.StepAt = -1.0f;
						}
					}
					else if (Now - H.IdleAt >= 1.2f)
					{
						// THE CURRENT BEAT'S ACT, the Contract staged by the Dog, the mission camera taking it back
						const EWonderlandDogAct Want = QaBeatAct(Mission);
						const bool bAct = Want == EWonderlandDogAct::None ? true : Dog->PerformingAct() == Want;
						const float Reach = Mission->IsContractAnchored() ? FVector::Dist2D(Mission->GetContractAnchor(), Dog->GetActorLocation()) : -1.0f;
						const bool bStaged = Want == EWonderlandDogAct::None || (Reach >= 0.0f && Reach < 1200.0f);
						H.Check(*FString::Printf(TEXT("%sb"), Step.Id), bAct && bStaged && Mission->GetPresentationResumes() == H.ResumesBase + 1 && !Mission->IsPresentationDetached()
							&& Dog->GetMissionCameraWeight() > 0.3f,
							FString::Printf(TEXT("%s, 1.2 s after the swords were companions again: beat %s wants %s, the Dog performs %s; the Contract anchored %.0f uu from the Dog ")
								TEXT("(re-staged where it stands: < 1200); presentation resumes %d (+%d); mission camera %.2f"), Step.What, *Mission->GetBeatId().ToString(),
								WonderlandDogActName(Want), WonderlandDogActName(Dog->PerformingAct()), Reach, Mission->GetPresentationResumes(),
								Mission->GetPresentationResumes() - H.ResumesBase, Dog->GetMissionCameraWeight()));
						H.Frame(FString::Printf(TEXT("hm_%s_resumed"), Step.Id));
						H.bStepChecked = true;
						++H.StepIndex;
						H.StepAt = -1.0f;
					}
				}
			}
			if (Mission->IsFixtureRunning())
			{
				return In < 160.0f ? true : Stop(TEXT("the handed-off Scenario D never finished"));
			}
			// THE MISSION HAS ENDED: every step must have fired
			for (int32 Missing = H.StepIndex; Missing < H.Steps.Num(); ++Missing)
			{
				H.Check(H.Steps[Missing].Id, false, FString::Printf(TEXT("%s never happened: the mission ended first"), H.Steps[Missing].What));
			}
			Next();
			return true;
		}
		case 8:
		{
			if (In < 0.5f)
			{
				return true;
			}
			// C1-C5: THE CONTROL RUN
			const TArray<FWonderlandOfferedEvent>& Handed = Mission->GetOfferedRecord();
			bool bSame = Handed.Num() == H.Plain.Num();
			float Worst = 0.0f;
			FString FirstDiff;
			for (int32 Index = 0; Index < FMath::Min(Handed.Num(), H.Plain.Num()); ++Index)
			{
				const FWonderlandOfferedEvent& A = H.Plain[Index];
				const FWonderlandOfferedEvent& B = Handed[Index];
				if (A.EventType != B.EventType || A.Verdict != B.Verdict || A.Beat != B.Beat)
				{
					if (bSame)
					{
						FirstDiff = FString::Printf(TEXT(" first difference at %d: %s/%s/%s vs %s/%s/%s"), Index, *A.EventType.ToString(), *A.Verdict, *A.Beat.ToString(),
							*B.EventType.ToString(), *B.Verdict, *B.Beat.ToString());
					}
					bSame = false;
				}
				Worst = FMath::Max(Worst, FMath::Abs(A.AtSeconds - B.AtSeconds));
			}
			H.Check(TEXT("C1"), bSame && Worst <= 1.0f,
				FString::Printf(TEXT("the control run: %d events handed off vs %d plain, the same events, verdicts and beats in the same order %s; ")
					TEXT("the largest timing difference %.2f s (pre-registered: <= 1.0 s)%s"), Handed.Num(), H.Plain.Num(), bSame ? TEXT("yes") : TEXT("NO"), Worst, *FirstDiff));
			const FWonderlandOfferedEvent* Approval = Handed.FindByPredicate([](const FWonderlandOfferedEvent& Row) { return Row.Beat == WonderlandBeatId(EWonderlandMissionBeat::ApprovalContinue); });
			const FWonderlandOfferedEvent* Done = Handed.FindByPredicate([](const FWonderlandOfferedEvent& Row) { return Row.Beat == WonderlandBeatId(EWonderlandMissionBeat::CompleteVerified); });
			H.Check(TEXT("C2"), Approval != nullptr && Approval->bHandedOff && Done != nullptr && Done->bHandedOff,
				FString::Printf(TEXT("surfaced while handed off: the approval %s, the completion %s"),
					Approval == nullptr ? TEXT("NEVER CAME") : (Approval->bHandedOff ? TEXT("yes") : TEXT("came while NOT handed off")),
					Done == nullptr ? TEXT("NEVER CAME") : (Done->bHandedOff ? TEXT("yes") : TEXT("came while NOT handed off"))));
			H.Check(TEXT("C3"), Mission->GetTerminalNarrations() == H.PlainNarrations && H.PlainNarrations > 0,
				FString::Printf(TEXT("the terminals kept being told: %d times handed off, %d plain"), Mission->GetTerminalNarrations(), H.PlainNarrations));
			H.Check(TEXT("C4"), FWonderlandMissionHandoff::GetMutationsInScope() == 0,
				FString::Printf(TEXT("the write spy over the whole handed-off run (three handoffs, two returns, a dash): %d writes inside the handoff path%s"),
					FWonderlandMissionHandoff::GetMutationsInScope(), FWonderlandMissionHandoff::GetMutationsInScope() > 0
						? *FString::Printf(TEXT(" (last: %s)"), *FWonderlandMissionHandoff::GetLastMutationInScope()) : TEXT("")));
			bool bDetached = false;
			const FString Reading = QaDetachedReading(Dog, Mission, bDetached);
			H.Check(TEXT("C5"), State->IsArmed() && State->GetMissionId().IsEmpty() && bDetached,
				FString::Printf(TEXT("the mission ended while handed off: handoff %s, attached to '%s' (want none), completion did not take the Dog: %s"),
					FWonderlandMissionHandoff::StateName(State->GetState()), *State->GetMissionId(), *Reading));
			H.Frame(TEXT("hm_c5_mission_ended_still_held"));
			Terminal(TEXT("/handoff"));
			Next();
			return true;
		}
		case 9:
		{
			if (State->IsEquipped())
			{
				return In < 5.0f ? true : Stop(TEXT("the swords were never given back after the mission"));
			}
			if (In < 1.0f)
			{
				return true;
			}
			// S: A MISSION STARTING WHILE HANDED OFF -- the swords first, roaming
			FWonderlandMissionHandoff::ResetSpy();
			Terminal(TEXT("/handoff"));
			Next();
			return true;
		}
		case 10:
		{
			if (!State->IsArmed())
			{
				return In < 6.0f ? true : Stop(TEXT("the swords were never held for the starting mission"));
			}
			if (Ui->IsLiveTerminalOpen())
			{
				return In < 7.0f ? true : Stop(TEXT("the terminal never stepped aside"));
			}
			H.At0 = Dog->GetActorLocation();
			// THE FOUNDER'S PLAY COMMAND, which would travel to the site and open the terminal
			Mission->PlayScenario(TEXT("D"), 1.0f);
			Next();
			return true;
		}
		case 11:
		{
			if (!Mission->IsFixtureRunning() || In < 4.5f)
			{
				return In < 12.0f ? true : Stop(TEXT("the play command never started its mission"));
			}
			bool bDetached = false;
			const FString Reading = QaDetachedReading(Dog, Mission, bDetached);
			const float Moved = FVector::Dist2D(Dog->GetActorLocation(), H.At0);
			const FString Running = Mission->GetRunningMissionId();
			H.Check(TEXT("S1"), Moved < 400.0f && !Ui->IsLiveTerminalOpen() && bDetached && !Running.IsEmpty() && State->GetMissionId() == Running,
				FString::Printf(TEXT("a mission started while handed off: the Dog moved %.0f uu (no travel: < 400), the terminal %s, attached to '%s' (running '%s'); %s"),
					Moved, Ui->IsLiveTerminalOpen() ? TEXT("OPENED") : TEXT("left closed"), *State->GetMissionId(), *Running, *Reading));
			H.Frame(TEXT("hm_s1_mission_started_while_held"));
			// its end (the QA stops it: a write of the QA's own, outside the handoff path)
			Mission->StopFixture();
			Mission->SetBeatById(TEXT("idle"));
			Next();
			return true;
		}
		case 12:
		{
			if (In < 0.5f)
			{
				return true;
			}
			H.Check(TEXT("S2"), State->IsArmed() && State->GetMissionId().IsEmpty() && Mission->IsPresentationDetached(),
				FString::Printf(TEXT("that mission stopped: handoff %s, attached to '%s' (want none)"), FWonderlandMissionHandoff::StateName(State->GetState()), *State->GetMissionId()));
			Terminal(TEXT("/handoff"));
			Next();
			return true;
		}
		case 13:
		{
			if (State->IsEquipped())
			{
				return In < 5.0f ? true : Stop(TEXT("the swords were never given back at the end"));
			}
			H.Check(TEXT("S3"), FWonderlandMissionHandoff::GetMutationsInScope() == 0 && !Mission->IsPresentationDetached(),
				FString::Printf(TEXT("given back: handoff %s, the presentation %s, writes inside the handoff path %d"), FWonderlandMissionHandoff::StateName(State->GetState()),
					Mission->IsPresentationDetached() ? TEXT("STILL LEFT") : TEXT("back"), FWonderlandMissionHandoff::GetMutationsInScope()));
			return Stop(nullptr);
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaHandoffMissionCommand(
		TEXT("wl.Qa.HandoffMission"),
		TEXT("Mission Handoff M1b, the mission paths, in this (packaged) build: roaming with no mission through the Live Terminal's /handoff ")
		TEXT("(nothing fabricated; the write spy and its controls), Scenario D plain vs handed off at RESEARCH, REPAIR and VERIFICATION with ")
		TEXT("returns mid-mission (the pre-registered control run), and a mission starting while handed off. Logs WLHMQA lines; `quit` exits after."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaHm.IsValid())
			{
				return;
			}
			ARelayDogCharacter* Dog = QaDog(World);
			if (Dog == nullptr || World == nullptr)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLHMQA END pass=0 fail=1 (no Relay Dog to drive)"));
				if (Args.Contains(TEXT("quit")))
				{
					FPlatformMisc::RequestExit(false);
				}
				return;
			}
			GQaHm = MakeShared<FQaHm>();
			GQaHm->World = World;
			GQaHm->Dog = Dog;
			GQaHm->bQuit = Args.Contains(TEXT("quit"));
			GQaHm->PhaseAt = World->GetTimeSeconds();
			GQaHm->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLHANDOFF"));
			GQaHm->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaHmTick), 0.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLHMQA armed at (%.0f, %.0f, %.0f)"), Dog->GetActorLocation().X, Dog->GetActorLocation().Y, Dog->GetActorLocation().Z);
		}));

	/* ================================================================ wl.Qa.HandoffStance: the attack-ready stance, M2
	 * The founder's COMBAT STANCE (2026-10-02), on every skin in the faces QA's roster:
	 *   ST1  standing unarmed: the baseline, measured on the canon's own joints and photographed front, side and from behind;
	 *   ST2  the swords taken up (the terminal's path): the stance, MEASURED -- the hands come forward and out (the blades carried
	 *        out from the body), the body leans, the feet are spaced, and the soles stay on the ground (a ready knee, the same
	 *        feet) -- and photographed from the same three places;
	 *   ST3  given back: every measure home to the baseline (normal roaming unchanged).
	 * Then on Relay OG and Shadow Flame, armed and moving, photographed from the side as it goes: ST4 walking, ST5 running
	 * (the blades trailing, swept out), ST6 a dash (the dash pose comes in). Frames to Saved/Screenshots/WLSTANCE. The swords
	 * themselves arrive in M3: these frames show the stance only. WLSTQA lines; `quit` exits after.
	 */
	struct FStanceShot
	{
		const TCHAR* Name;
		double Yaw;
		double Distance;
		double Rise;
		float Fov;
	};
	const FStanceShot StanceShots[] = {
		{ TEXT("front"), 0.0, 340.0, 20.0, 50.0f },
		{ TEXT("side"), 90.0, 340.0, 20.0, 50.0f },
		{ TEXT("behind"), 165.0, 340.0, 70.0, 50.0f },
	};

	struct FStanceReading
	{
		float HandForward = 0.0f;
		float HandSpread = 0.0f;
		float SoleSpread = 0.0f;
		float SoleHeight = 0.0f;
		float Pitch = 0.0f;
	};

	struct FQaStance
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ARelayDogCharacter> Dog;
		TWeakObjectPtr<ACameraActor> Camera;
		TArray<TWeakObjectPtr<AActor>> Hidden;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		float PhaseAt = 0.0f;
		int32 Skin = 0;
		int32 Shot = 0;
		bool bArmedShots = false;
		FString Dir;
		FStanceReading Base;
		int32 Moving = 0;
		float Seen = 0.0f;
		float SeenOut = 0.0f;
		int32 DashBase = 0;
		int32 Key = 0;
		FVector Forward = FVector::ForwardVector;
		void Check(const FString& Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSTQA %s %s | %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
	};
	TSharedPtr<FQaStance> GQaStance;

	/** The stance, read off the canon body (every skin wears exactly these joints). */
	FStanceReading QaReadStance(const ARelayDogCharacter* Dog)
	{
		FStanceReading R;
		const FVector At = Dog->GetActorLocation();
		const FVector Fwd = Dog->GetActorForwardVector().GetSafeNormal2D();
		const FVector HandA = Dog->GetCanonHandWorld(1.0f);
		const FVector HandB = Dog->GetCanonHandWorld(-1.0f);
		const FVector SoleA = Dog->GetCanonSoleWorld(1.0f);
		const FVector SoleB = Dog->GetCanonSoleWorld(-1.0f);
		R.HandForward = static_cast<float>((FVector::DotProduct(HandA - At, Fwd) + FVector::DotProduct(HandB - At, Fwd)) * 0.5);
		R.HandSpread = static_cast<float>(FVector::Dist2D(HandA, HandB));
		R.SoleSpread = static_cast<float>(FVector::Dist2D(SoleA, SoleB));
		R.SoleHeight = static_cast<float>((SoleA.Z + SoleB.Z) * 0.5 - At.Z);
		R.Pitch = Dog->GetCanonBodyPitch();
		return R;
	}

	FString QaDescribeStance(const FStanceReading& R)
	{
		return FString::Printf(TEXT("hands %.1f uu ahead, %.1f apart; soles %.1f apart at %.1f; body pitch %.1f"), R.HandForward, R.HandSpread, R.SoleSpread,
			R.SoleHeight, R.Pitch);
	}

	void QaStanceShow(FQaStance& S, UWorld* World, ARelayDogCharacter* Dog, bool bHideOthers)
	{
		// the companions, cubs and every other figure out of the shot -- never the Dog's costume, never the wardrobe stage's own
		for (const TWeakObjectPtr<AActor>& Figure : S.Hidden)
		{
			if (AActor* A = Figure.Get())
			{
				A->SetActorHiddenInGame(false);
			}
		}
		S.Hidden.Reset();
		if (!bHideOthers)
		{
			return;
		}
		for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
		{
			if (*It != Dog->GetCostume() && !It->IsHidden() && Cast<AWonderlandSkinStage>(It->GetOwner()) == nullptr)
			{
				It->SetActorHiddenInGame(true);
				S.Hidden.Add(*It);
			}
		}
	}

	void QaStanceCamera(FQaStance& S, UWorld* World, ARelayDogCharacter* Dog, double Yaw, double Distance, double Rise, float Fov)
	{
		APlayerController* PC = World->GetFirstPlayerController();
		const FVector Feet = Dog->GetActorLocation() - FVector(0.0, 0.0, Dog->GetSimpleCollisionHalfHeight());
		const FVector Middle = Feet + FVector(0.0, 0.0, Dog->GetCanonBodyHeightUu() * 0.5);
		const FVector Toward = Dog->GetActorForwardVector().GetSafeNormal2D().RotateAngleAxis(Yaw, FVector::UpVector);
		const FVector Where = Middle + Toward * Distance + FVector(0.0, 0.0, Rise);
		ACameraActor* Cam = S.Camera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Cam = World->SpawnActor<ACameraActor>(Where, FRotator::ZeroRotator, Params);
			S.Camera = Cam;
		}
		if (Cam != nullptr && PC != nullptr)
		{
			Cam->SetActorLocationAndRotation(Where, (Middle - Where).Rotation());
			Cam->GetCameraComponent()->SetFieldOfView(Fov);
			Cam->GetCameraComponent()->SetConstraintAspectRatio(false);
			if (PC->GetViewTarget() != Cam)
			{
				PC->SetViewTargetWithBlend(Cam, 0.0f);
			}
		}
	}

	void QaStanceFrame(FQaStance& S, const FString& Name)
	{
		int32 Width = 0;
		int32 Height = 0;
		const FString Path = S.Dir / (Name + TEXT(".png"));
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
		UE_LOG(LogWonderlandQa, Display, TEXT("WLSTQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
	}

	void QaStanceFinish(FQaStance& S, const TCHAR* Why)
	{
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = S.Dog.Get();
		if (Dog != nullptr)
		{
			QaHandRelease(Dog);
			Dog->QaWalkKey(false);
		}
		if (World != nullptr)
		{
			if (FWonderlandMissionHandoff* State = QaHandoff(World))
			{
				FString Ignored;
				State->Return(Ignored);
			}
			if (Dog != nullptr)
			{
				QaStanceShow(S, World, Dog, false);
				if (APlayerController* PC = World->GetFirstPlayerController())
				{
					PC->SetViewTargetWithBlend(Dog, 0.0f);
				}
				GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
			}
		}
		if (ACameraActor* Cam = S.Camera.Get())
		{
			Cam->Destroy();
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLSTQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
		if (S.bQuit)
		{
			FPlatformMisc::RequestExit(false);
		}
	}

	bool QaStanceTick(float)
	{
		if (!GQaStance.IsValid())
		{
			return false;
		}
		FQaStance& S = *GQaStance;
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = S.Dog.Get();
		FWonderlandMissionHandoff* State = QaHandoff(World);
		UWonderlandUiSubsystem* Ui = QaUi(World);
		if (World == nullptr || Dog == nullptr || State == nullptr || Ui == nullptr || Dog->GetCharacterMovement() == nullptr)
		{
			QaStanceFinish(S, TEXT("the world, the Dog, the handoff or the UI went away"));
			GQaStance.Reset();
			return false;
		}
		const float Now = World->GetTimeSeconds();
		const float In = Now - S.PhaseAt;
		const int32 Skins = static_cast<int32>(UE_ARRAY_COUNT(FaceRoster));
		const int32 Shots = static_cast<int32>(UE_ARRAY_COUNT(StanceShots));
		auto Next = [&S, Now](int32 To)
		{
			S.Phase = To;
			S.PhaseAt = Now;
		};
		auto Stop = [&S](const TCHAR* Reason)
		{
			QaStanceFinish(S, Reason);
			GQaStance.Reset();
			return false;
		};
		const FString SkinName = S.Skin < Skins ? FaceRoster[S.Skin] : TEXT("relay_og");

		switch (S.Phase)
		{
		case 0:
			// READY: the welcome put away, the Dog on loaded ground, the swords put away
			if (Ui->IsWelcomeOpen())
			{
				Ui->DismissWelcome();
			}
			if (State->IsArmed())
			{
				FString Ignored;
				State->Return(Ignored);
			}
			if (In < 4.0f || !Dog->GetCharacterMovement()->IsMovingOnGround() || State->IsEquipped())
			{
				return In < 40.0f ? true : Stop(TEXT("the Dog never stood ready with the swords put away"));
			}
			Next(1);
			return true;
		case 1:
			// THE NEXT SKIN, unarmed
			if (S.Skin >= Skins)
			{
				Next(20);
				return true;
			}
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), *SkinName));
			Next(2);
			return true;
		case 2:
			if (In < 3.0f)
			{
				return true;
			}
			S.Base = QaReadStance(Dog);
			S.Check(FString::Printf(TEXT("ST1.%d"), S.Skin + 1), Dog->GetArmedStanceWeight() == 0.0f,
				FString::Printf(TEXT("%s unarmed (the baseline): stance weight %.3f; %s"), *SkinName, Dog->GetArmedStanceWeight(), *QaDescribeStance(S.Base)));
			S.Shot = 0;
			S.bArmedShots = false;
			QaStanceShow(S, World, Dog, true);
			Next(3);
			return true;
		case 3:
		{
			// THE THREE SHOTS (unarmed, then armed), each after the cut has settled
			if (S.Shot >= Shots)
			{
				QaStanceShow(S, World, Dog, false);
				Next(S.bArmedShots ? 6 : 4);
				return true;
			}
			const FStanceShot& Shot = StanceShots[S.Shot];
			QaStanceCamera(S, World, Dog, Shot.Yaw, Shot.Distance, Shot.Rise, Shot.Fov);
			if (In < 1.2f)
			{
				return true;
			}
			QaStanceFrame(S, FString::Printf(TEXT("%d_%s_%s_%s"), S.Skin + 1, *SkinName, S.bArmedShots ? TEXT("armed") : TEXT("unarmed"), Shot.Name));
			++S.Shot;
			S.PhaseAt = Now;
			return true;
		}
		case 4:
		{
			// THE SWORDS TAKEN UP, the way the terminal takes them
			APlayerController* PC = World->GetFirstPlayerController();
			if (PC != nullptr)
			{
				PC->SetViewTargetWithBlend(Dog, 0.0f);
			}
			FString Said;
			if (!WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said))
			{
				S.Check(FString::Printf(TEXT("ST2.%d"), S.Skin + 1), false, FString::Printf(TEXT("%s: the swords could not be taken up: %s"), *SkinName, *Said));
				return Stop(TEXT("no handoff"));
			}
			Next(5);
			return true;
		}
		case 5:
		{
			if (!State->IsArmed() || In < 4.5f)
			{
				return In < 10.0f ? true : Stop(TEXT("the swords were never held"));
			}
			const FStanceReading R = QaReadStance(Dog);
			const float Ahead = R.HandForward - S.Base.HandForward;
			const float Out = R.HandSpread - S.Base.HandSpread;
			const float Feet = R.SoleSpread - S.Base.SoleSpread;
			const float Sink = R.SoleHeight - S.Base.SoleHeight;
			const float Lean = FMath::Abs(R.Pitch - S.Base.Pitch);
			const bool bOk = Dog->GetArmedStanceWeight() == 1.0f && Ahead >= 10.0f && Out >= 6.0f && Feet >= 5.0f && FMath::Abs(Sink) <= 1.5f && Lean >= 5.0f;
			S.Check(FString::Printf(TEXT("ST2.%d"), S.Skin + 1), bOk,
				FString::Printf(TEXT("%s armed, standing: stance weight %.3f; hands %+.1f uu forward (>= 10) and %+.1f apart (>= 6); soles %+.1f apart (>= 5), ")
					TEXT("%+.1f uu off the ground they stood on (within 1.5: the same feet); body pitch moved %.1f deg (>= 5) | %s"),
					*SkinName, Dog->GetArmedStanceWeight(), Ahead, Out, Feet, Sink, Lean, *QaDescribeStance(R)));
			S.Shot = 0;
			S.bArmedShots = true;
			QaStanceShow(S, World, Dog, true);
			Next(3);
			return true;
		}
		case 6:
		{
			// GIVEN BACK: every measure home
			APlayerController* PC = World->GetFirstPlayerController();
			if (PC != nullptr && PC->GetViewTarget() != Dog)
			{
				PC->SetViewTargetWithBlend(Dog, 0.0f);
			}
			if (State->IsArmed())
			{
				FString Said;
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
			}
			if (State->IsEquipped() || In < 3.0f)
			{
				return In < 10.0f ? true : Stop(TEXT("the swords were never given back"));
			}
			const FStanceReading R = QaReadStance(Dog);
			const bool bHome = Dog->GetArmedStanceWeight() == 0.0f && FMath::Abs(R.HandForward - S.Base.HandForward) <= 2.0f
				&& FMath::Abs(R.HandSpread - S.Base.HandSpread) <= 2.0f && FMath::Abs(R.SoleSpread - S.Base.SoleSpread) <= 0.5f
				&& FMath::Abs(R.SoleHeight - S.Base.SoleHeight) <= 0.5f && FMath::Abs(R.Pitch - S.Base.Pitch) <= 1.0f;
			S.Check(FString::Printf(TEXT("ST3.%d"), S.Skin + 1), bHome,
				FString::Printf(TEXT("%s given back: stance weight %.3f; %s (the baseline: %s)"), *SkinName, Dog->GetArmedStanceWeight(), *QaDescribeStance(R),
					*QaDescribeStance(S.Base)));
			++S.Skin;
			Next(1);
			return true;
		}
		case 20:
		{
			// ARMED AND MOVING, on Relay OG then Shadow Flame: a walk, a run, a dash, photographed from the side as it goes
			if (S.Moving >= 2)
			{
				return Stop(nullptr);
			}
			GEngine->Exec(World, S.Moving == 0 ? TEXT("wl.Skins.Wear relay_og") : TEXT("wl.Skins.Wear shadow_flame"));
			Next(21);
			return true;
		}
		case 21:
		{
			if (In < 3.0f)
			{
				return true;
			}
			if (!State->IsArmed())
			{
				if (State->GetState() == EWonderlandHandoffState::Idle)
				{
					FString Said;
					WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
				}
				return In < 12.0f ? true : Stop(TEXT("the swords could not be taken up to move"));
			}
			const float Clear = QaClearHeading(World, Dog, 1800.0f, S.Forward);
			if (Clear < 1300.0f)
			{
				S.Check(FString::Printf(TEXT("ST4.%d"), S.Moving + 1), false, FString::Printf(TEXT("no open ground to move armed (best heading clear for %.0f uu)"), Clear));
				return Stop(TEXT("no open ground"));
			}
			QaFace(Dog, S.Forward);
			S.Seen = 0.0f;
			S.SeenOut = 0.0f;
			S.Key = 0;
			QaStanceShow(S, World, Dog, true);
			// the WALK: Ctrl's band (the default without a key is the jog)
			Dog->QaWalkKey(true);
			Next(22);
			return true;
		}
		case 22:
		case 23:
		case 24:
		{
			// 22 WALK (no run key), 23 RUN, 24 DASH -- the camera riding beside the Dog, looking at it
			const FString Moving = S.Moving == 0 ? FString(TEXT("relay_og")) : FString(TEXT("shadow_flame"));
			Dog->AddMovementInput(S.Forward, 1.0f);
			QaStanceCamera(S, World, Dog, 90.0, 420.0, 30.0, 55.0f);
			const float Ground = FVector(Dog->GetVelocity().X, Dog->GetVelocity().Y, 0.0f).Size();
			if (S.Phase == 22)
			{
				if (In >= 1.4f && S.Key == 0)
				{
					QaStanceFrame(S, FString::Printf(TEXT("m%d_%s_armed_walk_side"), S.Moving + 1, *Moving));
					S.Check(FString::Printf(TEXT("ST4.%d"), S.Moving + 1), Dog->GetArmedStanceWeight() == 1.0f && Ground > 30.0f,
						FString::Printf(TEXT("%s armed, walking at %.0f uu/s: stance weight %.2f"), *Moving, Ground, Dog->GetArmedStanceWeight()));
					S.Key = 1;
				}
				if (In >= 1.6f)
				{
					Dog->QaWalkKey(false);
					Dog->QaRunKey(true);
					S.Key = 0;
					Next(23);
				}
				return true;
			}
			if (S.Phase == 23)
			{
				// OUT, NOT IN (the ST2 lesson): the hands' spread while running against the unarmed standing baseline, by position
				if (In >= 0.9f)
				{
					S.SeenOut = FMath::Max(S.SeenOut, QaReadStance(Dog).HandSpread);
				}
				if (In >= 1.5f && S.Key == 0)
				{
					QaStanceFrame(S, FString::Printf(TEXT("m%d_%s_armed_run_side"), S.Moving + 1, *Moving));
					S.Check(FString::Printf(TEXT("ST5.%d"), S.Moving + 1), Dog->GetArmedStanceWeight() == 1.0f && Ground > 600.0f && S.SeenOut >= S.Base.HandSpread + 6.0f,
						FString::Printf(TEXT("%s armed, running at %.0f uu/s: the hands %.1f uu apart (the unarmed stand: %.1f; >= +6: swept OUT so the blades clear the legs); ")
							TEXT("stance weight %.2f"), *Moving, Ground, S.SeenOut, S.Base.HandSpread, Dog->GetArmedStanceWeight()));
					S.Key = 1;
				}
				if (In >= 1.7f)
				{
					// the dash, from the run: W up, down, up, down
					S.DashBase = Dog->GetDashCount();
					S.Key = 0;
					Next(24);
				}
				return true;
			}
			// 24: THE DASH
			if (S.Key == 0 && In >= 0.00f) { Dog->QaForwardKey(false, false); S.Key = 1; }
			if (S.Key == 1 && In >= 0.04f) { Dog->QaForwardKey(false, true); S.Key = 2; }
			if (S.Key == 2 && In >= 0.08f) { Dog->QaForwardKey(false, false); S.Key = 3; }
			if (S.Key == 3 && In >= 0.12f) { Dog->QaForwardKey(false, true); S.Key = 4; }
			S.Seen = FMath::Max(S.Seen, Dog->GetDashStanceWeight());
			if (S.Key == 4 && Dog->IsDashing() && Dog->GetDashStanceWeight() > 0.6f)
			{
				QaStanceFrame(S, FString::Printf(TEXT("m%d_%s_armed_dash_side"), S.Moving + 1, *Moving));
				S.Key = 5;
			}
			if (In >= 1.2f)
			{
				S.Check(FString::Printf(TEXT("ST6.%d"), S.Moving + 1), Dog->GetDashCount() == S.DashBase + 1 && S.Seen >= 0.6f && S.Key == 5,
					FString::Printf(TEXT("%s armed, a dash from the run: %d dash(es), the dash pose's weight reached %.2f (>= 0.6), a frame mid-dash %s"),
						*Moving, Dog->GetDashCount() - S.DashBase, S.Seen, S.Key == 5 ? TEXT("saved") : TEXT("NOT taken")));
				QaHandRelease(Dog);
				QaStanceShow(S, World, Dog, false);
				if (APlayerController* PC = World->GetFirstPlayerController())
				{
					PC->SetViewTargetWithBlend(Dog, 0.0f);
				}
				++S.Moving;
				Next(20);
			}
			return true;
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaHandoffStanceCommand(
		TEXT("wl.Qa.HandoffStance"),
		TEXT("Mission Handoff M2, the attack-ready stance, in this (packaged) build: on every skin unarmed vs armed vs given back, measured ")
		TEXT("on the canon's joints and photographed front, side and behind; then armed walking, running and dashing on Relay OG and Shadow ")
		TEXT("Flame. Frames to Saved/Screenshots/WLSTANCE; WLSTQA lines; `quit` exits after."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaStance.IsValid())
			{
				return;
			}
			ARelayDogCharacter* Dog = QaDog(World);
			if (Dog == nullptr || World == nullptr)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSTQA END pass=0 fail=1 (no Relay Dog to drive)"));
				if (Args.Contains(TEXT("quit")))
				{
					FPlatformMisc::RequestExit(false);
				}
				return;
			}
			GQaStance = MakeShared<FQaStance>();
			GQaStance->World = World;
			GQaStance->Dog = Dog;
			GQaStance->bQuit = Args.Contains(TEXT("quit"));
			GQaStance->PhaseAt = World->GetTimeSeconds();
			GQaStance->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSTANCE"));
			GQaStance->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaStanceTick), 0.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSTQA armed at (%.0f, %.0f, %.0f)"), Dog->GetActorLocation().X, Dog->GetActorLocation().Y, Dog->GetActorLocation().Z);
		}));

	/* ================================================================ wl.Qa.HandoffSwords: the swords and the transformation, M3a
	 * Against the founder's sheet and canon (2026-10-02), in the packaged game, through the terminal's own path:
	 *   SW1  the transformation is an EXCHANGE, never a cut: half-way through, each companion is partly itself and its sword
	 *        partly formed, their shares summing to about one, with its light streaming into the sword;
	 *   SW2  delivered: the GOLD sword in the Dog's own LEFT hand's grip and the CYAN in the RIGHT's (to 1 uu);
	 *   SW3  the sides as the player sees them: from behind the Dog the gold sword is on the LEFT of the screen;
	 *   SW4  while held, both companions are veiled (they ARE the swords) and the swords are whole;
	 *   SW5  given back: the companions exactly as they were (size and visibility), the swords and the light gone;
	 *   SW6  every skin holds both swords (frames, judged by eye; the costume hands onto the grips in M4).
	 * Frames at noon and at night (wl.Sky.Hour) to Saved/Screenshots/WLSWORDS, judged against the sheet's checks 1-11.
	 * WLSWQA lines; `quit` exits after.
	 */
	struct FQaSwords
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ARelayDogCharacter> Dog;
		TWeakObjectPtr<ACameraActor> Camera;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		float PhaseAt = 0.0f;
		FString Dir;
		bool bMidChecked = false;
		bool bDeliverShot = false;
		bool bReturnShot = false;
		FVector LeftScale = FVector::OneVector;
		FVector RightScale = FVector::OneVector;
		int32 Skin = 1;
		int32 Shot = 0;
		void Check(const FString& Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSWQA %s %s | %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
		void Frame(const FString& Name)
		{
			int32 Width = 0;
			int32 Height = 0;
			const FString Path = Dir / (Name + TEXT(".png"));
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSWQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
		}
	};
	TSharedPtr<FQaSwords> GQaSwords;

	const FStanceShot SwordShots[] = {
		{ TEXT("front"), 0.0, 300.0, 40.0, 50.0f },
		{ TEXT("34"), 40.0, 300.0, 40.0, 50.0f },
		{ TEXT("behind"), 180.0, 320.0, 70.0, 50.0f },
		{ TEXT("side"), 90.0, 300.0, 30.0, 50.0f },
	};

	AActor* QaCompanionBody(UWorld* World, int32 Index)
	{
		ULocalPlayer* Player = QaLocalPlayer(World);
		const UWonderlandCompanionSubsystem* Companions = Player != nullptr ? Player->GetSubsystem<UWonderlandCompanionSubsystem>() : nullptr;
		return Companions != nullptr ? Companions->GetEmbodiment(Index) : nullptr;
	}

	void QaSwordsFinish(FQaSwords& S, const TCHAR* Why)
	{
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = S.Dog.Get();
		if (World != nullptr)
		{
			if (FWonderlandMissionHandoff* State = QaHandoff(World))
			{
				FString Ignored;
				State->Return(Ignored);
			}
			if (Dog != nullptr)
			{
				if (APlayerController* PC = World->GetFirstPlayerController())
				{
					PC->SetViewTargetWithBlend(Dog, 0.0f);
				}
			}
			GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
			GEngine->Exec(World, TEXT("wl.Sky.Hour 12"));
		}
		if (ACameraActor* Cam = S.Camera.Get())
		{
			Cam->Destroy();
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLSWQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
		if (S.bQuit)
		{
			FPlatformMisc::RequestExit(false);
		}
	}

	/** The QA camera, in the same frame as the stance QA's (placed round the Dog's middle). */
	void QaSwordsCamera(FQaSwords& S, UWorld* World, ARelayDogCharacter* Dog, const FStanceShot& Shot)
	{
		FQaStance Shim;
		Shim.Camera = S.Camera;
		QaStanceCamera(Shim, World, Dog, Shot.Yaw, Shot.Distance, Shot.Rise, Shot.Fov);
		S.Camera = Shim.Camera;
	}

	bool QaSwordsTick(float)
	{
		if (!GQaSwords.IsValid())
		{
			return false;
		}
		FQaSwords& S = *GQaSwords;
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = S.Dog.Get();
		FWonderlandMissionHandoff* State = QaHandoff(World);
		UWonderlandUiSubsystem* Ui = QaUi(World);
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		if (World == nullptr || Dog == nullptr || State == nullptr || Ui == nullptr || PC == nullptr)
		{
			QaSwordsFinish(S, TEXT("the world, the Dog, the handoff or the UI went away"));
			GQaSwords.Reset();
			return false;
		}
		const float Now = World->GetTimeSeconds();
		const float In = Now - S.PhaseAt;
		auto Next = [&S, Now](int32 To)
		{
			S.Phase = To;
			S.PhaseAt = Now;
		};
		auto Stop = [&S](const TCHAR* Reason)
		{
			QaSwordsFinish(S, Reason);
			GQaSwords.Reset();
			return false;
		};
		const WonderlandHandoffSwords::FPresentation& Swords = Dog->GetHandoffSwords();
		const WonderlandHandoffTransform::FPresentation& Change = Dog->GetHandoffTransform();
		AActor* LeftBody = QaCompanionBody(World, 0);
		AActor* RightBody = QaCompanionBody(World, 1);
		const int32 Skins = static_cast<int32>(UE_ARRAY_COUNT(FaceRoster));
		const int32 Shots = static_cast<int32>(UE_ARRAY_COUNT(SwordShots));

		switch (S.Phase)
		{
		case 0:
			if (Ui->IsWelcomeOpen())
			{
				Ui->DismissWelcome();
			}
			if (State->IsArmed())
			{
				FString Ignored;
				State->Return(Ignored);
			}
			if (In < 4.0f || !Dog->GetCharacterMovement()->IsMovingOnGround() || State->IsEquipped() || LeftBody == nullptr || RightBody == nullptr)
			{
				return In < 40.0f ? true : Stop(TEXT("never ready: the Dog on the ground, the swords away, both companions here"));
			}
			GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
			GEngine->Exec(World, TEXT("wl.Sky.Hour 12"));
			S.LeftScale = LeftBody->GetActorScale3D();
			S.RightScale = RightBody->GetActorScale3D();
			Next(1);
			return true;
		case 1:
		{
			if (In < 2.0f)
			{
				return true;
			}
			FString Said;
			if (!WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said))
			{
				S.Check(TEXT("SW1"), false, FString::Printf(TEXT("the swords could not be taken up: %s"), *Said));
				return Stop(TEXT("no handoff"));
			}
			S.bMidChecked = false;
			S.bDeliverShot = false;
			Next(2);
			return true;
		}
		case 2:
		{
			// SW1, HALF-WAY THROUGH THE TRANSFORMATION
			if (!S.bMidChecked && State->GetState() == EWonderlandHandoffState::Transforming
				&& State->GetPhaseSeconds() >= FWonderlandMissionHandoff::TransformSeconds * 0.5f)
			{
				const float Body = Change.GetPresence();
				const float Sword = Swords.GetPresence();
				const int32 Motes = Change.CountVisibleMotes();
				S.Check(TEXT("SW1"), Body > 0.1f && Body < 0.9f && Sword > 0.1f && Sword < 0.9f && FMath::Abs(Body + Sword - 1.0f) <= 0.25f && Motes > 0,
					FString::Printf(TEXT("half-way through the transformation: each companion %.2f itself, each sword %.2f formed (an exchange: both partial, ")
						TEXT("summing to %.2f), %d motes of light streaming"), Body, Sword, Body + Sword, Motes));
				S.Frame(TEXT("sw_1_transforming_noon"));
				S.bMidChecked = true;
			}
			if (!S.bDeliverShot && State->GetState() == EWonderlandHandoffState::Delivering
				&& State->GetPhaseSeconds() >= FWonderlandMissionHandoff::DeliverSeconds * 0.45f)
			{
				S.Frame(TEXT("sw_2_delivering_noon"));
				S.bDeliverShot = true;
			}
			if (!State->IsArmed())
			{
				return In < 8.0f ? true : Stop(TEXT("the swords were never held"));
			}
			if (In < 4.5f)
			{
				return true;
			}
			// SW2: EACH SWORD IN ITS OWN HAND
			const FVector GoldAt = Swords.GetSwordWorld(true).GetLocation();
			const FVector CyanAt = Swords.GetSwordWorld(false).GetLocation();
			const float GoldOff = FVector::Dist(GoldAt, Dog->GetHandoffGripWorld(true).GetLocation());
			const float CyanOff = FVector::Dist(CyanAt, Dog->GetHandoffGripWorld(false).GetLocation());
			S.Check(TEXT("SW2"), GoldOff <= 1.0f && CyanOff <= 1.0f,
				FString::Printf(TEXT("held: the gold sword %.2f uu from the LEFT hand's grip, the cyan %.2f uu from the RIGHT's"), GoldOff, CyanOff));
			// SW3: AS THE PLAYER SEES THEM, from the Dog's own camera behind it
			FVector2D GoldScreen, CyanScreen;
			const FVector GoldBlade = Swords.GetSwordWorld(true).TransformPosition(FVector(0.0f, 0.0f, 50.0f));
			const FVector CyanBlade = Swords.GetSwordWorld(false).TransformPosition(FVector(0.0f, 0.0f, 50.0f));
			const bool bProjected = PC->ProjectWorldLocationToScreen(GoldBlade, GoldScreen) && PC->ProjectWorldLocationToScreen(CyanBlade, CyanScreen);
			S.Check(TEXT("SW3"), bProjected && GoldScreen.X < CyanScreen.X,
				FString::Printf(TEXT("from the Dog's own camera behind it: the gold blade at x %.0f, the cyan at x %.0f (gold on the LEFT: %s)"),
					GoldScreen.X, CyanScreen.X, bProjected && GoldScreen.X < CyanScreen.X ? TEXT("yes") : TEXT("NO")));
			S.Frame(TEXT("sw_3_held_gameplay_camera_noon"));
			// SW4: THE COMPANIONS ARE THE SWORDS NOW
			const int32 Boxes = Swords.CountVisibleBoxes();
			S.Check(TEXT("SW4"), LeftBody->IsHidden() && RightBody->IsHidden() && Change.GetPresence() == 0.0f && Swords.GetPresence() == 1.0f && Boxes > 300,
				FString::Printf(TEXT("held: the LLM Companion %s, Jhinn %s (veiled: they are the swords), the swords whole %.2f with %d boxes drawn"),
					LeftBody->IsHidden() ? TEXT("veiled") : TEXT("STILL SHOWN"), RightBody->IsHidden() ? TEXT("veiled") : TEXT("STILL SHOWN"), Swords.GetPresence(), Boxes));
			S.Shot = 0;
			Next(3);
			return true;
		}
		case 3:
		case 4:
		{
			// THE HELD SWORDS FROM FOUR PLACES: at noon (3), then at night (4)
			if (S.Shot >= Shots)
			{
				if (S.Phase == 3)
				{
					GEngine->Exec(World, TEXT("wl.Sky.Hour 23"));
					S.Shot = 0;
					Next(4);
					return true;
				}
				GEngine->Exec(World, TEXT("wl.Sky.Hour 12"));
				PC->SetViewTargetWithBlend(Dog, 0.0f);
				Next(5);
				return true;
			}
			QaSwordsCamera(S, World, Dog, SwordShots[S.Shot]);
			if (In < (S.Phase == 4 && S.Shot == 0 ? 2.5f : 1.2f))
			{
				return true;
			}
			S.Frame(FString::Printf(TEXT("sw_4_held_%s_%s"), S.Phase == 3 ? TEXT("noon") : TEXT("night"), SwordShots[S.Shot].Name));
			++S.Shot;
			S.PhaseAt = Now;
			return true;
		}
		case 5:
		{
			// SW5: GIVEN BACK
			if (In < 1.0f)
			{
				return true;
			}
			if (State->IsArmed())
			{
				FString Said;
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
				S.bReturnShot = false;
			}
			if (!S.bReturnShot && State->GetState() == EWonderlandHandoffState::Returning
				&& State->GetPhaseSeconds() >= FWonderlandMissionHandoff::ReturnSeconds * 0.75f)
			{
				S.Frame(TEXT("sw_5_returning_noon"));
				S.bReturnShot = true;
			}
			if (State->IsEquipped())
			{
				return In < 8.0f ? true : Stop(TEXT("the swords were never given back"));
			}
			if (In < 2.5f)
			{
				return true;
			}
			const bool bBack = !LeftBody->IsHidden() && !RightBody->IsHidden() && LeftBody->GetActorScale3D().Equals(S.LeftScale, 1.0e-4f)
				&& RightBody->GetActorScale3D().Equals(S.RightScale, 1.0e-4f) && Swords.CountVisibleBoxes() == 0 && Change.CountVisibleMotes() == 0;
			S.Check(TEXT("SW5"), bBack,
				FString::Printf(TEXT("given back: the LLM Companion %s at scale %s (was %s), Jhinn %s at %s (was %s); sword boxes drawn %d, motes %d"),
					LeftBody->IsHidden() ? TEXT("HIDDEN") : TEXT("shown"), *LeftBody->GetActorScale3D().ToCompactString(), *S.LeftScale.ToCompactString(),
					RightBody->IsHidden() ? TEXT("HIDDEN") : TEXT("shown"), *RightBody->GetActorScale3D().ToCompactString(), *S.RightScale.ToCompactString(),
					Swords.CountVisibleBoxes(), Change.CountVisibleMotes()));
			S.Skin = 1;
			Next(6);
			return true;
		}
		case 6:
			// SW6: EVERY SKIN HOLDING BOTH SWORDS
			if (S.Skin >= Skins)
			{
				return Stop(nullptr);
			}
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), FaceRoster[S.Skin]));
			Next(7);
			return true;
		case 7:
		{
			if (In < 3.0f)
			{
				return true;
			}
			FString Said;
			WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
			Next(8);
			return true;
		}
		case 8:
			if (!State->IsArmed() || In < 4.6f)
			{
				return In < 10.0f ? true : Stop(TEXT("a skin's swords were never held"));
			}
			S.Check(FString::Printf(TEXT("SW6.%d"), S.Skin + 1), Swords.CountVisibleBoxes() > 300 && Swords.GetPresence() == 1.0f,
				FString::Printf(TEXT("%s holding both swords: %d boxes drawn (frames judged by eye; costume hands onto the grips: M4)"), FaceRoster[S.Skin],
					Swords.CountVisibleBoxes()));
			S.Shot = 0;
			Next(9);
			return true;
		case 9:
		{
			// front and behind for each skin
			if (S.Shot >= 2)
			{
				PC->SetViewTargetWithBlend(Dog, 0.0f);
				FString Said;
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
				Next(10);
				return true;
			}
			const FStanceShot& Shot = SwordShots[S.Shot == 0 ? 0 : 2];
			QaSwordsCamera(S, World, Dog, Shot);
			if (In < 1.2f)
			{
				return true;
			}
			S.Frame(FString::Printf(TEXT("sw_6_%d_%s_%s"), S.Skin + 1, FaceRoster[S.Skin], Shot.Name));
			++S.Shot;
			S.PhaseAt = Now;
			return true;
		}
		case 10:
			if (State->IsEquipped())
			{
				return In < 8.0f ? true : Stop(TEXT("a skin's swords were never given back"));
			}
			++S.Skin;
			Next(6);
			return true;
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaHandoffSwordsCommand(
		TEXT("wl.Qa.HandoffSwords"),
		TEXT("Mission Handoff M3a, the swords and the transformation, in this (packaged) build: the exchange half-way through, gold in the ")
		TEXT("LEFT hand and cyan in the RIGHT (and on the left of the screen from behind), the companions veiled while held and restored ")
		TEXT("after, and every skin holding both. Frames at noon and night to Saved/Screenshots/WLSWORDS; WLSWQA lines; `quit` exits after."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaSwords.IsValid())
			{
				return;
			}
			ARelayDogCharacter* Dog = QaDog(World);
			if (Dog == nullptr || World == nullptr)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSWQA END pass=0 fail=1 (no Relay Dog to drive)"));
				if (Args.Contains(TEXT("quit")))
				{
					FPlatformMisc::RequestExit(false);
				}
				return;
			}
			GQaSwords = MakeShared<FQaSwords>();
			GQaSwords->World = World;
			GQaSwords->Dog = Dog;
			GQaSwords->bQuit = Args.Contains(TEXT("quit"));
			GQaSwords->PhaseAt = World->GetTimeSeconds();
			GQaSwords->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSWORDS"));
			GQaSwords->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaSwordsTick), 0.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSWQA armed at (%.0f, %.0f, %.0f)"), Dog->GetActorLocation().X, Dog->GetActorLocation().Y, Dog->GetActorLocation().Z);
		}));
}

#endif

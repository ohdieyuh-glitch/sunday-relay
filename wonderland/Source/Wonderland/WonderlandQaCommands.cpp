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
#include "WonderlandKneesOut.h"
#include "WonderlandFinite.h"
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
#include "Engine/DirectionalLight.h"
#include "Components/LightComponent.h"
#include "UObject/UObjectIterator.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformOutputDevices.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "WonderlandSkinStage.h"
#include "WonderlandCard.h"
#include "WonderlandCardCapabilities.h"
#include "WonderlandCardDirector.h"
#include "WonderlandMissionHandoff.h"
#include "WonderlandHandoffDirector.h"
#include "WonderlandCompanionFormation.h"
#include "WonderlandDogPerformance.h"
#include "WonderlandMissionOrb.h"
#include "Components/BoxComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
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

	// defined with the Mission Handoff QA below; the perf run's handoff phases and the C.A.R.D. QA use them too
	ULocalPlayer* QaLocalPlayer(UWorld* World);
	FWonderlandMissionHandoff* QaHandoff(UWorld* World);
	float QaClearViewHeading(UWorld* World, ARelayDogCharacter* Dog, APlayerController* PC);
	UWonderlandMissionSubsystem* QaMissions(UWorld* World);
	AActor* QaCompanionBody(UWorld* World, int32 Index);

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

	// ---- IN THE SUN, OR SAID TO BE IN THE SHADE (Second, B65.4, 10-03). Round 3b's "noon" colourway frames were shot where
	// ---- the Dog spawned, under a tree: CORE's pixel read of WHITE (157,135,113) was a white in warm shade, not at noon. The
	// ---- founder's bar is "WHITE must read genuinely WHITE at noon", so the frames stand in the sun, or the log says they don't.
	TAutoConsoleVariable<int32> CVarQaCwSunSpot(TEXT("wl.Qa.CwSunSpot"), 1,
		TEXT("wl.Qa.ShadowColorways at noon: 1 moves the Dog (up to 15 m) to flat, open, SUNLIT ground when it spawned in shade; 0 keeps the spawn."));

	/** The direction TOWARD the sun (the brightest directional light's rays reversed), or zero when there is none. */
	FVector QaSunToward(UWorld* World)
	{
		const ADirectionalLight* Best = nullptr;
		float BestIntensity = -1.0f;
		for (TActorIterator<ADirectionalLight> It(World); It; ++It)
		{
			const ULightComponent* Light = It->GetLightComponent();
			const float Intensity = Light != nullptr && Light->IsVisible() ? Light->Intensity : -1.0f;
			if (Intensity > BestIntensity)
			{
				BestIntensity = Intensity;
				Best = *It;
			}
		}
		return Best != nullptr ? -Best->GetActorForwardVector().GetSafeNormal() : FVector::ZeroVector;
	}

	/**
	 * Does an INSTANCED shadow caster stand on the sun ray? The garden is instanced and its canopies need no collision, so a
	 * trace alone would call the shade under a tree "sunlit". Instance BOUNDS are tested instead, every 100 uu for 25 m: a
	 * conservative read (a bounding box shades more than its leaves), which is the right error for "is this frame at noon".
	 */
	bool QaInstancesOnRay(UWorld* World, const ARelayDogCharacter* D, const FVector& From, const FVector& Toward)
	{
		const FVector To = From + Toward * 2500.0;
		FBox RayBox(ForceInit);
		RayBox += From;
		RayBox += To;
		RayBox = RayBox.ExpandBy(80.0);
		TArray<AActor*> Worn;
		D->GetAttachedActors(Worn, true, true);
		for (TObjectIterator<UInstancedStaticMeshComponent> It; It; ++It)
		{
			const UInstancedStaticMeshComponent* Ism = *It;
			if (Ism == nullptr || Ism->GetWorld() != World || !Ism->IsRegistered() || !Ism->IsVisible() || !Ism->CastShadow
				|| Ism->GetInstanceCount() == 0 || !Ism->Bounds.GetBox().Intersect(RayBox))
			{
				continue;
			}
			const AActor* Owner = Ism->GetOwner();
			if (Owner == D || Worn.ContainsByPredicate([Owner](const AActor* Each) { return Each == Owner; }))
			{
				continue;
			}
			for (double T = 0.0; T <= 2500.0; T += 100.0)
			{
				if (Ism->GetInstancesOverlappingSphere(From + Toward * T, 40.0f, true).Num() > 0)
				{
					return true;
				}
			}
		}
		return false;
	}

	/** Is this point lit by the sun? A trace from just outside the body toward the sun (the Dog and what it wears ignored) AND
	 *  no instanced caster's bounds on that ray. */
	bool QaSunlitAt(UWorld* World, const ARelayDogCharacter* D, const FVector& Point, const FVector& Toward)
	{
		if (Toward.IsNearlyZero() || Toward.Z <= 0.05)
		{
			return false;
		}
		FCollisionQueryParams Params(SCENE_QUERY_STAT(WlQaSun), false);
		Params.AddIgnoredActor(D);
		TArray<AActor*> Worn;
		D->GetAttachedActors(Worn, true, true);
		Params.AddIgnoredActors(Worn);
		FHitResult Hit;
		const FVector From = Point + Toward * 60.0;
		return !World->LineTraceSingleByChannel(Hit, From, Point + Toward * 30000.0, ECC_Visibility, Params)
			&& !QaInstancesOnRay(World, D, From, Toward);
	}

	/** Flat ground near Base, within MaxRise of its height, with nothing in the camera ring (8 x 320 uu) at head height. */
	bool QaOpenGround(UWorld* World, const ARelayDogCharacter* D, const FVector& Candidate, double BaseFeetZ, double HeadUp, FVector& OutFeet)
	{
		FCollisionQueryParams Params(SCENE_QUERY_STAT(WlQaGround), false);
		Params.AddIgnoredActor(D);
		TArray<AActor*> Worn;
		D->GetAttachedActors(Worn, true, true);
		Params.AddIgnoredActors(Worn);
		FHitResult Floor;
		if (!World->LineTraceSingleByChannel(Floor, Candidate + FVector(0.0, 0.0, 400.0), Candidate - FVector(0.0, 0.0, 600.0), ECC_Visibility, Params)
			|| Floor.ImpactNormal.Z < 0.9 || FMath::Abs(Floor.ImpactPoint.Z - BaseFeetZ) > 120.0)
		{
			return false;
		}
		const FVector Head = Floor.ImpactPoint + FVector(0.0, 0.0, HeadUp);
		for (int32 K = 0; K < 8; ++K)
		{
			const FVector Out = FVector(1.0, 0.0, 0.0).RotateAngleAxis(45.0 * K, FVector::UpVector);
			FHitResult Wall;
			if (World->LineTraceSingleByChannel(Wall, Head, Head + Out * 320.0, ECC_Visibility, Params))
			{
				return false;
			}
		}
		OutFeet = Floor.ImpactPoint;
		return true;
	}

	/** At noon, stand the Dog in the sun (or say why not). Returns the line the QA logs. */
	FString QaStandInSun(UWorld* World, ARelayDogCharacter* D)
	{
		const FVector Toward = QaSunToward(World);
		const double Half = D->GetSimpleCollisionHalfHeight();
		const FVector Feet = D->GetActorLocation() - FVector(0.0, 0.0, Half);
		const double HeadUp = D->GetCanonBodyHeightUu() * 0.85;
		if (QaSunlitAt(World, D, Feet + FVector(0.0, 0.0, HeadUp), Toward))
		{
			return FString::Printf(TEXT("head SUNLIT at the spawn %s (sun toward %s)"), *Feet.ToCompactString(), *Toward.ToCompactString());
		}
		if (CVarQaCwSunSpot.GetValueOnGameThread() == 0 || Toward.IsNearlyZero())
		{
			return FString::Printf(TEXT("head in SHADE at the spawn %s, kept (%s)"), *Feet.ToCompactString(),
				Toward.IsNearlyZero() ? TEXT("no sun found") : TEXT("wl.Qa.CwSunSpot 0"));
		}
		static const double Radii[] = { 300.0, 600.0, 900.0, 1200.0, 1500.0 };
		for (const double Radius : Radii)
		{
			for (int32 K = 0; K < 16; ++K)
			{
				const FVector Candidate = Feet + FVector(Radius, 0.0, 0.0).RotateAngleAxis(22.5 * K, FVector::UpVector);
				FVector Ground;
				if (!QaOpenGround(World, D, Candidate, Feet.Z, HeadUp, Ground) || !QaSunlitAt(World, D, Ground + FVector(0.0, 0.0, HeadUp), Toward)
					|| !QaSunlitAt(World, D, Ground + FVector(0.0, 0.0, HeadUp * 0.35), Toward))
				{
					continue;
				}
				const FVector To = Ground + FVector(0.0, 0.0, Half + 2.0);
				if (D->TeleportTo(To, D->GetActorRotation(), false, true))
				{
					return FString::Printf(TEXT("head in SHADE at the spawn %s; MOVED %.0f uu to sunlit open ground %s (sun toward %s)"),
						*Feet.ToCompactString(), Radius, *Ground.ToCompactString(), *Toward.ToCompactString());
				}
			}
		}
		return FString::Printf(TEXT("head in SHADE at the spawn %s and no sunlit open ground within 15 m: frames are SHADE frames"), *Feet.ToCompactString());
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

	/* ================================================================ wl.Qa.ShadowFlameColour (founder, 2026-10-02)
	 *
	 * THE SHADOW FLAME PRIMARY IS PURE: "WHITE -> pure white ... BLACK renders black ... a saturated color such as RED renders as
	 * that selected red without dark tint ... switching colors repeatedly does not retain prior tint/state". Wears Shadow Flame,
	 * picks PRIMARY swatches through the one door the Wardrobe and the Menu use (WonderlandMascotStyle::PickMascotPrimary, so
	 * SaveAndApply -- the route B63's Q26 exercises), and reads back what each surface is PAINTED with (DescribeMaterialColours;
	 * BaseColor on a rim). A frame per colour, three-quarter, into Saved/Screenshots/WLSFCOLOUR, for the pixel read.
	 *   C1 WHITE: the coat is (1,1,1)   C2 BLACK: (0,0,0)   C3 CRIMSON: exactly the swatch, no dark tint
	 *   C4 nine switches, each exactly the current pick (no prior tint)   C5 strips, visor, eyes and void edges never move with it
	 *   C6 DEFAULT gives back the designed coat   C7 the rings: one PRIMARY swatch on, DEFAULT and WHITE told apart
	 *   C8 an UNTAGGED shell keeps its multiply: Skeleton Flame's bone (not tagged `primary`) under CRIMSON is exactly its own
	 *      WHITE reading times the swatch. (Not Relay OG: wearing Relay OG takes the costume off and shows the canon body,
	 *      so there is no costume to read -- the first draft of C8 would have failed on a correct build.)
	 * `restart`: C9 after a restart with WHITE chosen, the coat is still white.
	 */
	struct FQaSfColour
	{
		TWeakObjectPtr<UWorld> World;
		FQaShadow View;   // the Shadow Flame QA's camera and frame writer
		int32 Phase = 0;
		double At = 0.0;
		int32 Step = 0;
		int32 Pass = 0;
		int32 Fail = 0;
		bool bRestart = false;
		bool bAllExact = true;
		bool bFixedHeld = true;
		FString Trail;
		FString FixedTrail;
		TMap<FString, FQaPaint> Fixed;   // strips, visor, eyes, void edges after the first pick
		FQaPaint UntaggedWhite;          // C8: Skeleton Flame's bone with WHITE picked, the multiply's own calibration
	};
	TSharedPtr<FQaSfColour> GQaSfColour;

	void QaSfCheck(FQaSfColour& S, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? S.Pass : S.Fail)++;
		UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLOUR %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	const TPair<FName, FLinearColor>* QaPrimarySwatch(const TCHAR* Key)
	{
		const FName Want(Key);
		return WonderlandMascotStyle::PrimaryPalette().FindByPredicate([&Want](const TPair<FName, FLinearColor>& S) { return S.Key == Want; });
	}

	bool QaExact(const FLinearColor& Got, const FLinearColor& Want)
	{
		return FMath::Abs(Got.R - Want.R) <= 0.002f && FMath::Abs(Got.G - Want.G) <= 0.002f && FMath::Abs(Got.B - Want.B) <= 0.002f;
	}

	// QaRgb: the one above (Wardrobe/skin QA), "r,g,b"

	/** How many PRIMARY swatches show their ring, and their names. */
	int32 QaPrimaryRings(FString& OutOn)
	{
		int32 On = 0;
		for (const TPair<FName, FLinearColor>& Swatch : WonderlandMascotStyle::PrimaryPalette())
		{
			if (WonderlandMascotStyle::IsMascotPrimaryOn(Swatch.Key, Swatch.Value))
			{
				++On;
				OutOn += FString::Printf(TEXT("%s%s"), OutOn.IsEmpty() ? TEXT("") : TEXT(","), *Swatch.Key.ToString());
			}
		}
		return On;
	}

	FLinearColor QaPaintOf(const TMap<FString, FQaPaint>& P, const TCHAR* Name)
	{
		const FQaPaint* Found = P.Find(Name);
		return Found != nullptr ? Found->Body : FLinearColor(-1.0f, -1.0f, -1.0f, 1.0f);
	}

	bool QaSfColourTick(float)
	{
		if (!GQaSfColour.IsValid())
		{
			return false;
		}
		FQaSfColour& S = *GQaSfColour;
		UWorld* World = S.World.Get();
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ARelayDogCharacter* D = QaDog(World);
		const double In = QaNow() - S.At;
		const auto Next = [&S](int32 Phase) { S.Phase = Phase; S.At = QaNow(); };
		const auto Finish = [&S]()
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLOUR END pass=%d fail=%d"), S.Pass, S.Fail);
			GQaSfColour.Reset();
			FPlatformMisc::RequestExit(false);
		};
		if (World == nullptr || PC == nullptr || D == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLOUR quit: no world or Relay Dog"));
				Finish();
				return false;
			}
			return true;
		}
		const AWonderlandCompanionEmbodiment* Costume = D->GetCostume();
		// THE NINE PICKS (C1-C4): every colour more than once, a dark one between light ones, so a tint left behind shows.
		static const TCHAR* const Picks[] = { TEXT("WHITE"), TEXT("BLACK"), TEXT("CRIMSON"), TEXT("WHITE"), TEXT("AZURE"),
			TEXT("JADE"), TEXT("BLACK"), TEXT("CRIMSON"), TEXT("WHITE") };
		static const TCHAR* const FixedNames[] = { TEXT("shadow"), TEXT("visor"), TEXT("eye"), TEXT("eyehalo"), TEXT("voidedge") };
		const int32 NumPicks = static_cast<int32>(UE_ARRAY_COUNT(Picks));
		switch (S.Phase)
		{
		case 0:
			if (In >= 8.0)
			{
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					U->DismissWelcome();
					U->CloseOverlay();
				}
				if (!S.bRestart)
				{
					GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				}
				Next(S.bRestart ? 50 : 1);
			}
			break;
		case 1:
			if (In >= 3.0)
			{
				QaShadowCamera(S.View, World, PC, D, 35.0, 260.0);
				Next(2);
			}
			break;
		case 2:   // pick the next swatch, through the Wardrobe's and the Menu's own door
		{
			const TPair<FName, FLinearColor>* Swatch = QaPrimarySwatch(Picks[S.Step]);
			if (Swatch == nullptr)
			{
				QaSfCheck(S, TEXT("C4"), false, FString::Printf(TEXT("no PRIMARY swatch named %s"), Picks[S.Step]));
				Finish();
				return false;
			}
			WonderlandMascotStyle::PickMascotPrimary(Swatch->Key, Swatch->Value);
			Next(3);
			break;
		}
		case 3:   // what the coat is painted with now, and the surfaces that must not move
			if (In >= 0.8)
			{
				const FString Key = Picks[S.Step];
				const TPair<FName, FLinearColor>* Swatch = QaPrimarySwatch(Picks[S.Step]);
				const TMap<FString, FQaPaint> P = QaPainted(Costume);
				const FLinearColor Bone = QaPaintOf(P, TEXT("bone"));
				const FLinearColor Deep = QaPaintOf(P, TEXT("bonedeep"));
				// B65: the shell is the pick EXACTLY; the deep coat (cuffs, soles) a 0.62 shade of the same pick. B65.3: a DARK pick's
				// shell is its smoke grey (its cells stay black), so the shell is compared with the profile's base
				const FLinearColor WantShell = Swatch != nullptr ? WonderlandMascotStyle::SmokeBaseFor(Swatch->Value, false) : FLinearColor(-1, -1, -1);
				const bool bExact = Swatch != nullptr && QaExact(Bone, WantShell) && QaExact(Deep, Swatch->Value * 0.62f);
				S.bAllExact &= bExact;
				S.Trail += FString::Printf(TEXT("%s%s %s/%s%s"), S.Trail.IsEmpty() ? TEXT("") : TEXT(" -> "), *Key,
					*QaRgb(Bone), *QaRgb(Deep), bExact ? TEXT("") : TEXT(" (WRONG)"));
				// C5: the first pick is the reference; every later pick must leave these where they were (glows: the same hue)
				for (const TCHAR* Name : FixedNames)
				{
					const FQaPaint* Now = P.Find(Name);
					if (S.Step == 0)
					{
						if (Now != nullptr) { S.Fixed.Add(Name, *Now); }
						continue;
					}
					const FQaPaint* Was = S.Fixed.Find(Name);
					const bool bGlow = FString(Name).StartsWith(TEXT("eye")) || FString(Name) == TEXT("voidedge");
					const bool bHeld = Now != nullptr && Was != nullptr && (bGlow ? QaSameHue(Now->Body, Was->Body) : QaExact(Now->Body, Was->Body));
					if (!bHeld)
					{
						S.bFixedHeld = false;
						S.FixedTrail += FString::Printf(TEXT(" %s moved at %s: %s -> %s;"), Name, *Key,
							Was != nullptr ? *QaRgb(Was->Body) : TEXT("?"), Now != nullptr ? *QaRgb(Now->Body) : TEXT("?"));
					}
				}
				if (S.Step <= 2)
				{
					const TCHAR* Id = S.Step == 0 ? TEXT("C1") : S.Step == 1 ? TEXT("C2") : TEXT("C3");
					QaSfCheck(S, Id, bExact, FString::Printf(TEXT("%s picked: the coat (bone, bonedeep) painted %s / %s, want %s exactly (bonedeep x0.62 of the pick; profile %s)"),
						*Key, *QaRgb(Bone), *QaRgb(Deep), *QaRgb(WantShell), Swatch != nullptr ? *WonderlandMascotStyle::SmokeProfileName(Swatch->Value, false) : TEXT("?")));
				}
				if (S.Step == 0)
				{
					FString On;
					const int32 Rings = QaPrimaryRings(On);
					QaSfCheck(S, TEXT("C7"), Rings == 1 && On == TEXT("WHITE"),
						FString::Printf(TEXT("after WHITE: %d PRIMARY ring(s) on (%s), want exactly WHITE -- not DEFAULT, though both are (1,1,1)"), Rings, *On));
				}
				if (S.Step <= 5)
				{
					QaShadowShot(S.View, *FString::Printf(TEXT("%d_%s"), S.Step + 1, *Key.ToLower()));
				}
				++S.Step;
				Next(S.Step < NumPicks ? 2 : 4);
			}
			break;
		case 4:
			QaSfCheck(S, TEXT("C4"), S.bAllExact, FString::Printf(TEXT("%d switches, each exactly the current pick: %s"), NumPicks, *S.Trail));
			QaSfCheck(S, TEXT("C5"), S.bFixedHeld, S.bFixedHeld
				? FString::Printf(TEXT("strips, visor, eyes, eye halos and void edges unchanged through %d switches"), NumPicks)
				: FString::Printf(TEXT("moved:%s"), *S.FixedTrail));
			if (const TPair<FName, FLinearColor>* Default = QaPrimarySwatch(TEXT("DEFAULT")))
			{
				WonderlandMascotStyle::PickMascotPrimary(Default->Key, Default->Value);
			}
			Next(5);
			break;
		case 5:
			if (In >= 0.8)
			{
				// C6: the coat as ShadowFlame.wlvox designs it
				const TMap<FString, FQaPaint> P = QaPainted(Costume);
				const FLinearColor Bone = QaPaintOf(P, TEXT("bone"));
				const FLinearColor Deep = QaPaintOf(P, TEXT("bonedeep"));
				FString On;
				const int32 Rings = QaPrimaryRings(On);
				// B65.3: with the smoke on DEFAULT the designed shell is painted with its VEIN blue (its tone map's floor brings the
				// cells down to the designed navy); the deep coat stays the designed navy
				const FLinearColor DesignedShell(0.016f, 0.019f, 0.042f);
				const FLinearColor WantShell = WonderlandMascotStyle::SmokeOnDefault() ? WonderlandMascotStyle::SmokeBaseFor(DesignedShell, true) : DesignedShell;
				QaSfCheck(S, TEXT("C6"), QaExact(Bone, WantShell) && QaExact(Deep, FLinearColor(0.009f, 0.010f, 0.022f))
					&& Rings == 1 && On == TEXT("DEFAULT"),
					FString::Printf(TEXT("DEFAULT: the coat %s / %s (want %s / designed (0.009,0.010,0.022)); rings on: %s"),
						*QaRgb(Bone), *QaRgb(Deep), *QaRgb(WantShell), *On));
				QaShadowShot(S.View, TEXT("7_default"));
				GEngine->Exec(World, TEXT("wl.Skins.Wear skeleton_flame"));
				Next(6);
			}
			break;
		case 6:
			if (In >= 3.0)
			{
				if (const TPair<FName, FLinearColor>* White = QaPrimarySwatch(TEXT("WHITE")))
				{
					WonderlandMascotStyle::PickMascotPrimary(White->Key, White->Value);
				}
				Next(9);
			}
			break;
		case 9:   // C8's calibration: the untagged shell under WHITE is its authored colour, whatever this bed's figure authors
			if (In >= 0.8)
			{
				const TMap<FString, FQaPaint> P = QaPainted(D->GetCostume());
				const FQaPaint* Bone = P.Find(TEXT("bone"));
				S.UntaggedWhite = Bone != nullptr ? *Bone : FQaPaint();
				if (Bone == nullptr)
				{
					S.UntaggedWhite.Body = FLinearColor(-1.0f, -1.0f, -1.0f, 1.0f);
				}
				if (const TPair<FName, FLinearColor>* Crimson = QaPrimarySwatch(TEXT("CRIMSON")))
				{
					WonderlandMascotStyle::PickMascotPrimary(Crimson->Key, Crimson->Value);
				}
				Next(7);
			}
			break;
		case 7:
			if (In >= 0.8)
			{
				// C8: Skeleton Flame's shell is not tagged `primary`, so it keeps the multiply -- its WHITE reading times CRIMSON
				const TMap<FString, FQaPaint> P = QaPainted(D->GetCostume());
				const FQaPaint* Bone = P.Find(TEXT("bone"));
				const TPair<FName, FLinearColor>* Crimson = QaPrimarySwatch(TEXT("CRIMSON"));
				// an untagged material reports its channel as "None" (NAME_None), not an empty string
				const bool bUntagged = Bone != nullptr && (Bone->Channel.IsEmpty() || Bone->Channel == TEXT("None"));
				const FLinearColor Want = Crimson != nullptr ? S.UntaggedWhite.Body * Crimson->Value : FLinearColor::Black;
				const bool bCalibrated = S.UntaggedWhite.Body.R > 0.05f;   // a real shell was read under WHITE
				const bool bMultiply = bUntagged && bCalibrated && Crimson != nullptr && QaExact(Bone->Body, Want);
				QaSfCheck(S, TEXT("C8"), bMultiply, FString::Printf(TEXT("Skeleton Flame bone (channel '%s'): WHITE %s, CRIMSON %s, want %s (its WHITE x the swatch): the multiply, unchanged"),
					Bone != nullptr ? *Bone->Channel : TEXT("?"), *QaRgb(S.UntaggedWhite.Body), Bone != nullptr ? *QaRgb(Bone->Body) : TEXT("MISSING"),
					*QaRgb(Want)));
				// leave Shadow Flame worn in WHITE, for the restart boot
				GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				if (const TPair<FName, FLinearColor>* White = QaPrimarySwatch(TEXT("WHITE")))
				{
					WonderlandMascotStyle::PickMascotPrimary(White->Key, White->Value);
				}
				Next(8);
			}
			break;
		case 8:
			if (In >= 3.0)
			{
				PC->SetViewTargetWithBlend(D, 0.0f);
				Finish();
				return false;
			}
			break;
		case 50:   // `restart`
			if (In >= 4.0)
			{
				const TMap<FString, FQaPaint> P = QaPainted(Costume);
				const FLinearColor Bone = QaPaintOf(P, TEXT("bone"));
				const FLinearColor Deep = QaPaintOf(P, TEXT("bonedeep"));
				FString On;
				QaPrimaryRings(On);
				QaSfCheck(S, TEXT("C9"), D->GetWornSkinId() == FName(TEXT("shadow_flame")) && QaExact(Bone, FLinearColor::White)
					&& QaExact(Deep, FLinearColor::White * 0.62f) && On == TEXT("WHITE"),
					FString::Printf(TEXT("after a restart: wears '%s', the coat %s / %s, rings on: %s (want shadow_flame, white, WHITE)"),
						*D->GetWornSkinId().ToString(), *QaRgb(Bone), *QaRgb(Deep), *On));
				QaShadowCamera(S.View, World, PC, D, 35.0, 260.0);
				Next(51);
			}
			break;
		case 51:
			if (In >= 1.0)
			{
				QaShadowShot(S.View, TEXT("8_restart_white"));
				Finish();
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaShadowFlameColour(
		TEXT("wl.Qa.ShadowFlameColour"),
		TEXT("The Shadow Flame PRIMARY is pure (C1-C8): WHITE, BLACK and CRIMSON painted exactly, nine switches with no prior tint, ")
		TEXT("strips/visor/eyes/void edges untouched, DEFAULT back to the designed coat, the rings, Relay OG's multiply unchanged; frames ")
		TEXT("into Saved/Screenshots/WLSFCOLOUR; leaves WHITE chosen and quits. `wl.Qa.ShadowFlameColour restart`: still white (C9)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaSfColour.IsValid())
			{
				return;
			}
			GQaSfColour = MakeShared<FQaSfColour>();
			GQaSfColour->World = World;
			GQaSfColour->At = QaNow();
			GQaSfColour->bRestart = Args.Num() > 0 && Args[0].Equals(TEXT("restart"), ESearchCase::IgnoreCase);
			GQaSfColour->View.Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSFCOLOUR"));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaSfColourTick), 0.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLOUR armed (%s)"), GQaSfColour->bRestart ? TEXT("restart check") : TEXT("C1-C8 and the frames"));
		}));

	/* ================================================================ wl.Qa.ShadowColorways (B65, founder, 2026-10-02)
	 *
	 * "SHADOW MASCOT COLORWAYS + THIRD COLOR CHANNEL": every primary keeps the SAME smoky detail, COLOR 3 (the strips) is its
	 * own channel, and all three persist. Wears Shadow Flame under a HELD sky (noon; `night` for 22:30) and steps through the
	 * founder's matrix -- DEFAULT, WHITE, BLACK, CRIMSON, AZURE, JADE with the strips as designed; the strip combos
	 * white/black, white/cyan, crimson/gold, black/white, azure/crimson; then white + GOLD eyes + cyan strips and crimson +
	 * OBSIDIAN eyes (the darkest secondary offered) + white strips -- each through the Wardrobe's and the Menu's own doors
	 * (PickMascotPrimary, PickMascotStrip, the secondary's SaveAndApply), reading back what every surface is painted with:
	 *   K1 the body EXACTLY the pick (DEFAULT: the designed navy)    K2 the deep coat a 0.62 shade of the same pick
	 *   K3 the strips EXACTLY their pick (DEFAULT: designed black)   K4 the smoke relief bound on body AND strips, every step
	 *   K5 the rim = SmokeRimTint(base) x gain, same hue as the base K6 visor and void edges never move; eyes only with SECONDARY
	 *   K7 a strip change leaves the body; a body change the strips K8 one PRIMARY ring and one STRIPS ring, the picked ones
	 * Two frames a step (three-quarter, and the face from below, the founder's photo's view) into
	 * Saved/Screenshots/WLSFCOLORWAYS_<noon|night>; leaves crimson / obsidian eyes / white strips chosen and quits.
	 * `restart`: K9 the three channels came back after a restart, rings included, and the same two frames.
	 */
	struct FQaCwStep
	{
		const TCHAR* Body;
		const TCHAR* Strip;
		const TCHAR* Eyes;   // a SECONDARY swatch (the shared palette), or nullptr to leave the eyes alone
	};
	const FQaCwStep QaCwSteps[] = {
		{TEXT("DEFAULT"), TEXT("DEFAULT"), nullptr}, {TEXT("WHITE"), TEXT("DEFAULT"), nullptr}, {TEXT("BLACK"), TEXT("DEFAULT"), nullptr},
		{TEXT("CRIMSON"), TEXT("DEFAULT"), nullptr}, {TEXT("AZURE"), TEXT("DEFAULT"), nullptr}, {TEXT("JADE"), TEXT("DEFAULT"), nullptr},
		{TEXT("WHITE"), TEXT("BLACK"), nullptr}, {TEXT("WHITE"), TEXT("CYAN"), nullptr}, {TEXT("CRIMSON"), TEXT("GOLD"), nullptr},
		{TEXT("BLACK"), TEXT("WHITE"), nullptr}, {TEXT("AZURE"), TEXT("CRIMSON"), nullptr},
		{TEXT("WHITE"), TEXT("CYAN"), TEXT("GOLD")}, {TEXT("CRIMSON"), TEXT("WHITE"), TEXT("OBSIDIAN")},
	};

	struct FQaCwPaint
	{
		FLinearColor Body, BodyRim, Deep, Strip, StripRim, Visor, Edge, Eye;
		FString BodyRelief, StripRelief;
		bool bRead = false;
	};

	struct FQaColorways
	{
		TWeakObjectPtr<UWorld> World;
		FQaShadow View;
		int32 Phase = 0;
		double At = 0.0;
		int32 Step = 0;
		int32 Pass = 0;
		int32 Fail = 0;
		bool bRestart = false;
		bool bNight = false;
		FQaCwPaint First;   // step 0, DEFAULT/DEFAULT: the designed paint every later DEFAULT is held to
		FQaCwPaint Prev;
	};
	TSharedPtr<FQaColorways> GQaColorways;

	void QaCwCheck(FQaColorways& S, const FString& Id, bool bOk, const FString& Detail)
	{
		(bOk ? S.Pass : S.Fail)++;
		UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLORWAYS %s %s | %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	FQaCwPaint QaCwRead(const AWonderlandCompanionEmbodiment* Costume)
	{
		FQaCwPaint P;
		if (Costume == nullptr)
		{
			return P;
		}
		FLinearColor Unused;
		FString NoRelief;
		P.bRead = Costume->QaReadPaint(FName(TEXT("bone")), P.Body, P.BodyRim, P.BodyRelief)
			&& Costume->QaReadPaint(FName(TEXT("bonedeep")), P.Deep, Unused, NoRelief)
			&& Costume->QaReadPaint(FName(TEXT("shadow")), P.Strip, P.StripRim, P.StripRelief)
			&& Costume->QaReadPaint(FName(TEXT("visor")), P.Visor, Unused, NoRelief)
			&& Costume->QaReadPaint(FName(TEXT("voidedge")), P.Edge, Unused, NoRelief)
			&& Costume->QaReadPaint(FName(TEXT("eye")), P.Eye, Unused, NoRelief);
		return P;
	}

	const TPair<FName, FLinearColor>* QaSharedSwatch(const TCHAR* Key)
	{
		const FName Want(Key);
		return WonderlandMascotStyle::Palette().FindByPredicate([&Want](const TPair<FName, FLinearColor>& S) { return S.Key == Want; });
	}

	/** Which swatches of the PRIMARY palette show a ring on the PRIMARY (bStrips false) or the STRIPS row. */
	FString QaCwRings(bool bStrips, int32& OutCount)
	{
		FString On;
		OutCount = 0;
		for (const TPair<FName, FLinearColor>& Swatch : WonderlandMascotStyle::PrimaryPalette())
		{
			const bool bOn = bStrips ? WonderlandMascotStyle::IsMascotStripOn(Swatch.Key, Swatch.Value)
				: WonderlandMascotStyle::IsMascotPrimaryOn(Swatch.Key, Swatch.Value);
			if (bOn)
			{
				++OutCount;
				On += FString::Printf(TEXT("%s%s"), On.IsEmpty() ? TEXT("") : TEXT(","), *Swatch.Key.ToString());
			}
		}
		return On;
	}

	/** The founder's photo's view: close in front of the head, a little below it, looking up into the face. */
	void QaCwFaceCamera(FQaShadow& V, UWorld* World, APlayerController* PC, ARelayDogCharacter* D)
	{
		const FVector Feet = D->GetActorLocation() - FVector(0.0, 0.0, D->GetSimpleCollisionHalfHeight());
		const FVector Head = Feet + FVector(0.0, 0.0, D->GetCanonBodyHeightUu() * 0.80);
		const FVector Toward = D->GetActorForwardVector().GetSafeNormal2D().RotateAngleAxis(-18.0, FVector::UpVector);
		const FVector Where = Head + Toward * 150.0 - FVector(0.0, 0.0, 55.0);
		ACameraActor* Cam = V.Camera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Cam = World->SpawnActor<ACameraActor>(Where, FRotator::ZeroRotator, Params);
			V.Camera = Cam;
		}
		if (Cam != nullptr)
		{
			Cam->SetActorLocationAndRotation(Where, (Head - Where).Rotation());
			Cam->GetCameraComponent()->SetFieldOfView(52.0f);
			Cam->GetCameraComponent()->SetConstraintAspectRatio(false);
			PC->SetViewTargetWithBlend(Cam, 0.0f);
		}
	}

	/** The hue angle in degrees (0..360), or -1 for a grey: "the same hue" by angle, so a highlight lifted a little toward
	 *  white still counts as the same crimson while a navy one never would. */
	float QaHueDeg(const FLinearColor& C)
	{
		const float Max = FMath::Max3(C.R, C.G, C.B);
		const float Min = FMath::Min3(C.R, C.G, C.B);
		const float Span = Max - Min;
		if (Max <= 1e-6f || Span / Max < 0.05f)
		{
			return -1.0f;
		}
		float H = 0.0f;
		if (Max == C.R) { H = 60.0f * FMath::Fmod((C.G - C.B) / Span, 6.0f); }
		else if (Max == C.G) { H = 60.0f * ((C.B - C.R) / Span + 2.0f); }
		else { H = 60.0f * ((C.R - C.G) / Span + 4.0f); }
		return H < 0.0f ? H + 360.0f : H;
	}

	/** K1-K8 on the step just painted. */
	void QaCwVerify(FQaColorways& S, const FQaCwStep& Step, const FQaCwPaint& P)
	{
		const FString Tag = FString::Printf(TEXT("%02d %s/%s%s"), S.Step, Step.Body, Step.Strip, Step.Eyes != nullptr ? *FString::Printf(TEXT(" eyes %s"), Step.Eyes) : TEXT(""));
		if (!P.bRead)
		{
			QaCwCheck(S, TEXT("K0"), false, Tag + TEXT(": the costume's paint could not be read (bone/bonedeep/shadow/visor/voidedge/eye)"));
			return;
		}
		const bool bBodyDefault = FCString::Strcmp(Step.Body, TEXT("DEFAULT")) == 0;
		const bool bStripDefault = FCString::Strcmp(Step.Strip, TEXT("DEFAULT")) == 0;
		const TPair<FName, FLinearColor>* BodySwatch = QaPrimarySwatch(Step.Body);
		const TPair<FName, FLinearColor>* StripSwatch = QaPrimarySwatch(Step.Strip);
		// the designed colours, as the figure file declares them (RelaySkins/ShadowFlame.wlvox)
		const FLinearColor DesignedBody(0.0160f, 0.0190f, 0.0420f), DesignedDeep(0.0090f, 0.0100f, 0.0220f), DesignedStrip(0.0100f, 0.0120f, 0.0300f);
		const FLinearColor PickBody = bBodyDefault ? DesignedBody : (BodySwatch != nullptr ? BodySwatch->Value : FLinearColor(-1, -1, -1));
		const FLinearColor PickStrip = bStripDefault ? DesignedStrip : (StripSwatch != nullptr ? StripSwatch->Value : FLinearColor(-1, -1, -1));
		// B65.3: the BASE by the colour's profile -- a light or any other pick EXACTLY itself (the pure-colour rule), a dark pick
		// its smoke grey, the designed body (with the smoke on DEFAULT) its vein blue; the deep coat is unaffected (Lit)
		const FLinearColor WantBody = bBodyDefault
			? (WonderlandMascotStyle::SmokeOnDefault() ? WonderlandMascotStyle::SmokeBaseFor(DesignedBody, true) : DesignedBody)
			: WonderlandMascotStyle::SmokeBaseFor(PickBody, false);
		const FLinearColor WantDeep = bBodyDefault ? DesignedDeep : PickBody * 0.62f;
		const FLinearColor WantStrip = bStripDefault ? DesignedStrip
			: (WonderlandMascotStyle::SmokeStripRelief() ? WonderlandMascotStyle::SmokeBaseFor(PickStrip, false) : PickStrip);
		QaCwCheck(S, TEXT("K1"), QaExact(P.Body, WantBody), FString::Printf(TEXT("%s: the body painted %s, want %s exactly"), *Tag, *QaRgb(P.Body), *QaRgb(WantBody)));
		QaCwCheck(S, TEXT("K2"), QaExact(P.Deep, FLinearColor(WantDeep.R, WantDeep.G, WantDeep.B)),
			FString::Printf(TEXT("%s: the deep coat %s, want %s (the same pick, deeper)"), *Tag, *QaRgb(P.Deep), *QaRgb(WantDeep)));
		QaCwCheck(S, TEXT("K3"), QaExact(P.Strip, WantStrip), FString::Printf(TEXT("%s: the strips painted %s, want %s exactly"), *Tag, *QaRgb(P.Strip), *QaRgb(WantStrip)));
		// RECOLOURED surfaces wear the smoke look; DESIGNED ones (DEFAULT) keep exactly what step 0 read, unless wl.Shadow.OnDefault
		const bool bOnDefault = WonderlandMascotStyle::SmokeOnDefault();
		const FString Smoke = WonderlandMascotStyle::SmokeTextureName();
		const FString WantBodyRelief = (!bBodyDefault || bOnDefault) ? Smoke : S.First.BodyRelief;
		// B65.3: the DESIGNED strips stay the designed black tendrils (no smoke); a picked strip colour takes it
		const FString WantStripRelief = (!bStripDefault && WonderlandMascotStyle::SmokeStripRelief()) ? Smoke : S.First.StripRelief;
		QaCwCheck(S, TEXT("K4"), Smoke != TEXT("none") && P.BodyRelief == WantBodyRelief && P.StripRelief == WantStripRelief,
			FString::Printf(TEXT("%s: relief on the body '%s' (want '%s'), on the strips '%s' (want '%s'); the smoke texture '%s'"), *Tag,
				*P.BodyRelief, *WantBodyRelief, *P.StripRelief, *WantStripRelief, *Smoke));
		// the rims follow the PICK (the embodiment tints from the chosen colour, never from a profile's base)
		const FLinearColor WantBodyRim = bBodyDefault ? S.First.BodyRim : WonderlandMascotStyle::SmokeRimTint(PickBody) * WonderlandMascotStyle::SmokeRimGain();
		const FLinearColor WantStripRim = bStripDefault ? S.First.StripRim : WonderlandMascotStyle::SmokeRimTint(PickStrip) * WonderlandMascotStyle::SmokeStripRimGain();
		const FLinearColor BodyTint = WonderlandMascotStyle::SmokeRimTint(PickBody);
		const float HueBase = QaHueDeg(PickBody);
		const float HueTint = QaHueDeg(BodyTint);
		const float HueGap = (HueBase < 0.0f || HueTint < 0.0f) ? 0.0f : FMath::Min(FMath::Abs(HueBase - HueTint), 360.0f - FMath::Abs(HueBase - HueTint));
		const bool bBodyHue = bBodyDefault || HueBase < 0.0f || HueGap <= 6.0f;
		const bool bBrighter = bBodyDefault || FMath::Max3(BodyTint.R, BodyTint.G, BodyTint.B) >= FMath::Max3(PickBody.R, PickBody.G, PickBody.B) - 0.001f;
		QaCwCheck(S, TEXT("K5"), (S.Step == 0 || (QaExact(P.BodyRim, WantBodyRim) && QaExact(P.StripRim, WantStripRim))) && bBodyHue && bBrighter,
			FString::Printf(TEXT("%s: rims body %s strips %s, want %s / %s; the body rim's hue %.1f vs the colour's %.1f deg (recoloured: the same hue, brighter, black a grey floor; DEFAULT: as designed)"), *Tag,
				*QaRgb(P.BodyRim), *QaRgb(P.StripRim), *QaRgb(WantBodyRim), *QaRgb(WantStripRim), HueTint, HueBase));
		if (S.Step > 0)
		{
			const bool bFixed = QaExact(P.Visor, S.First.Visor) && QaSameHue(P.Edge, S.First.Edge);
			const bool bEyes = Step.Eyes != nullptr ? !QaSameHue(P.Eye, S.First.Eye) || !QaExact(P.Eye, S.First.Eye) : QaSameHue(P.Eye, S.First.Eye);
			QaCwCheck(S, TEXT("K6"), bFixed && bEyes, FString::Printf(TEXT("%s: visor %s (first %s), void edges %s (first %s), eyes %s (first %s) -- %s"), *Tag,
				*QaRgb(P.Visor), *QaRgb(S.First.Visor), *QaRgb(P.Edge), *QaRgb(S.First.Edge), *QaRgb(P.Eye), *QaRgb(S.First.Eye),
				Step.Eyes != nullptr ? TEXT("the eyes follow the SECONDARY picked") : TEXT("the eyes keep their colour")));
			const FQaCwStep& Before = QaCwSteps[S.Step - 1];
			const bool bSameBody = FCString::Strcmp(Before.Body, Step.Body) == 0;
			const bool bSameStrip = FCString::Strcmp(Before.Strip, Step.Strip) == 0;
			if (bSameBody || bSameStrip)
			{
				const bool bKept = (!bSameBody || (QaExact(P.Body, S.Prev.Body) && QaExact(P.BodyRim, S.Prev.BodyRim)))
					&& (!bSameStrip || (QaExact(P.Strip, S.Prev.Strip) && QaExact(P.StripRim, S.Prev.StripRim)));
				QaCwCheck(S, TEXT("K7"), bKept, FString::Printf(TEXT("%s: %s unchanged from the step before"), *Tag,
					bSameBody && bSameStrip ? TEXT("body and strips") : (bSameBody ? TEXT("the body (only the strips were picked)") : TEXT("the strips (only the body was picked)"))));
			}
		}
		int32 PrimaryRings = 0;
		int32 StripRings = 0;
		const FString PrimaryOn = QaCwRings(false, PrimaryRings);
		const FString StripOn = QaCwRings(true, StripRings);
		QaCwCheck(S, TEXT("K8"), PrimaryRings == 1 && StripRings == 1 && PrimaryOn == Step.Body && StripOn == Step.Strip,
			FString::Printf(TEXT("%s: PRIMARY ring(s) %d (%s), STRIPS ring(s) %d (%s)"), *Tag, PrimaryRings, *PrimaryOn, StripRings, *StripOn));
	}

	bool QaColorwaysTick(float)
	{
		if (!GQaColorways.IsValid())
		{
			return false;
		}
		FQaColorways& S = *GQaColorways;
		UWorld* World = S.World.Get();
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ARelayDogCharacter* D = QaDog(World);
		const double In = QaNow() - S.At;
		const auto Next = [&S](int32 Phase) { S.Phase = Phase; S.At = QaNow(); };
		const auto Finish = [&S]()
		{
			if (ACameraActor* Cam = S.View.Camera.Get())
			{
				Cam->Destroy();
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLORWAYS END pass=%d fail=%d"), S.Pass, S.Fail);
			GQaColorways.Reset();
			FPlatformMisc::RequestExit(false);
		};
		if (World == nullptr || PC == nullptr || D == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLORWAYS quit: no world or Relay Dog"));
				Finish();
				return false;
			}
			return true;
		}
		const AWonderlandCompanionEmbodiment* Costume = D->GetCostume();
		const int32 NumSteps = static_cast<int32>(UE_ARRAY_COUNT(QaCwSteps));
		switch (S.Phase)
		{
		case 0:
			if (In >= 8.0)
			{
				if (UWonderlandUiSubsystem* U = QaUi(World))
				{
					U->DismissWelcome();
					U->CloseOverlay();
				}
				// THE SKY HELD STILL, so every frame of the matrix is lit the same and default vs recolour compare honestly
				GEngine->Exec(World, TEXT("wl.Sky.DayMinutes 0"));
				GEngine->Exec(World, S.bNight ? TEXT("wl.Sky.Hour 22.5") : TEXT("wl.Sky.Hour 12.5"));
				if (!S.bRestart)
				{
					GEngine->Exec(World, TEXT("wl.Mascot.Reset"));
					GEngine->Exec(World, TEXT("wl.Skins.Wear shadow_flame"));
				}
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLORWAYS look: %s"), *WonderlandMascotStyle::DescribeSmokeLook());
				Next(S.bRestart ? 50 : 1);
			}
			break;
		case 1:
			if (In >= 3.0)
			{
				// B65.4: noon frames stand in the sun, or say they don't (night and the restart check keep the spawn)
				const FString Light = S.bNight ? FString(TEXT("night: the spawn kept (no sun to stand in)")) : QaStandInSun(World, D);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLORWAYS light: %s"), *Light);
				Next(2);
			}
			break;
		case 2:   // pick this step's colours, through the rows' own doors
		{
			const FQaCwStep& Step = QaCwSteps[S.Step];
			if (const TPair<FName, FLinearColor>* Body = QaPrimarySwatch(Step.Body))
			{
				WonderlandMascotStyle::PickMascotPrimary(Body->Key, Body->Value);
			}
			if (const TPair<FName, FLinearColor>* Strip = QaPrimarySwatch(Step.Strip))
			{
				WonderlandMascotStyle::PickMascotStrip(Strip->Key, Strip->Value);
			}
			if (Step.Eyes != nullptr)
			{
				const TPair<FName, FLinearColor>* Eyes = QaSharedSwatch(Step.Eyes);
				if (UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>(); Style != nullptr && Eyes != nullptr)
				{
					Style->Secondary = Eyes->Value;
					Style->bChosen = true;
					Style->bSecondaryChosen = true;
					WonderlandMascotStyle::SaveAndApply();
				}
			}
			Next(3);
			break;
		}
		case 3:   // settled: read, check, and the three-quarter frame
			if (In >= 1.5)
			{
				const FQaCwStep& Step = QaCwSteps[S.Step];
				const FQaCwPaint P = QaCwRead(Costume);
				if (S.Step == 0)
				{
					S.First = P;
				}
				QaCwVerify(S, Step, P);
				S.Prev = P;
				QaShadowCamera(S.View, World, PC, D, 35.0, 230.0);
				Next(4);
			}
			break;
		case 4:
			if (In >= 0.6)
			{
				const FQaCwStep& Step = QaCwSteps[S.Step];
				QaShadowShot(S.View, *FString::Printf(TEXT("%02d_%s_%s%s_threequarter"), S.Step, Step.Body, Step.Strip,
					Step.Eyes != nullptr ? *FString::Printf(TEXT("_eyes_%s"), Step.Eyes) : TEXT("")).ToLower());
				QaCwFaceCamera(S.View, World, PC, D);
				Next(5);
			}
			break;
		case 5:
			if (In >= 0.6)
			{
				const FQaCwStep& Step = QaCwSteps[S.Step];
				QaShadowShot(S.View, *FString::Printf(TEXT("%02d_%s_%s%s_face"), S.Step, Step.Body, Step.Strip,
					Step.Eyes != nullptr ? *FString::Printf(TEXT("_eyes_%s"), Step.Eyes) : TEXT("")).ToLower());
				++S.Step;
				if (S.Step < NumSteps)
				{
					Next(2);
				}
				else
				{
					Next(9);
				}
			}
			break;
		case 9:
			if (In >= 0.5)
			{
				Finish();
				return false;
			}
			break;
		case 50:   // THE RESTART BOOT: nothing picked; what came back by itself
			if (In >= 4.0)
			{
				const FQaCwPaint P = QaCwRead(Costume);
				const TPair<FName, FLinearColor>* Crimson = QaPrimarySwatch(TEXT("CRIMSON"));
				const TPair<FName, FLinearColor>* White = QaPrimarySwatch(TEXT("WHITE"));
				const TPair<FName, FLinearColor>* Obsidian = QaSharedSwatch(TEXT("OBSIDIAN"));
				int32 PrimaryRings = 0;
				int32 StripRings = 0;
				const FString PrimaryOn = QaCwRings(false, PrimaryRings);
				const FString StripOn = QaCwRings(true, StripRings);
				const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
				const bool bOk = P.bRead && D->GetWornSkinId() == FName(TEXT("shadow_flame")) && Crimson != nullptr && White != nullptr && Obsidian != nullptr
					&& QaExact(P.Body, Crimson->Value) && QaExact(P.Strip, White->Value) && Style.Secondary.Equals(Obsidian->Value, 0.002f)
					&& PrimaryOn == TEXT("CRIMSON") && StripOn == TEXT("WHITE") && P.BodyRelief != TEXT("none");
				QaCwCheck(S, TEXT("K9"), bOk, FString::Printf(TEXT("after a restart: wears '%s', body %s, strips %s, secondary %s, rings PRIMARY %s STRIPS %s, relief %s (want shadow_flame, crimson, white, obsidian)"),
					*D->GetWornSkinId().ToString(), *QaRgb(P.Body), *QaRgb(P.Strip), *QaRgb(Style.Secondary), *PrimaryOn, *StripOn, *P.BodyRelief));
				QaShadowCamera(S.View, World, PC, D, 35.0, 230.0);
				Next(51);
			}
			break;
		case 51:
			if (In >= 0.6)
			{
				QaShadowShot(S.View, TEXT("restart_crimson_white_eyes_obsidian_threequarter"));
				QaCwFaceCamera(S.View, World, PC, D);
				Next(52);
			}
			break;
		case 52:
			if (In >= 0.6)
			{
				QaShadowShot(S.View, TEXT("restart_crimson_white_eyes_obsidian_face"));
				Next(9);
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaShadowColorways(
		TEXT("wl.Qa.ShadowColorways"),
		TEXT("B65: Shadow's colourways keep their detail and its strips are COLOR 3 (K1-K8 over the founder's matrix, two frames a step, ")
		TEXT("into Saved/Screenshots/WLSFCOLORWAYS_<noon|night>); `night` holds the sky at 22:30 instead of noon; `restart`: K9 the three ")
		TEXT("channels came back. Quits after."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaColorways.IsValid())
			{
				return;
			}
			GQaColorways = MakeShared<FQaColorways>();
			GQaColorways->World = World;
			GQaColorways->At = QaNow();
			GQaColorways->bRestart = Args.ContainsByPredicate([](const FString& A) { return A.Equals(TEXT("restart"), ESearchCase::IgnoreCase); });
			GQaColorways->bNight = Args.ContainsByPredicate([](const FString& A) { return A.Equals(TEXT("night"), ESearchCase::IgnoreCase); });
			GQaColorways->View.Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots")
				/ (GQaColorways->bNight ? TEXT("WLSFCOLORWAYS_night") : TEXT("WLSFCOLORWAYS_noon")));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaColorwaysTick), 0.0f);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSFCOLORWAYS armed (%s, %s)"), GQaColorways->bRestart ? TEXT("restart check") : TEXT("K1-K8 and the frames"),
				GQaColorways->bNight ? TEXT("night 22:30") : TEXT("noon 12:30"));
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
		int32 DashesBefore = 0;         // the Mission Handoff's dash phase: the Dog's counts as it began
		int32 RefusedBefore = 0;
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
			else if (In >= 4.0)
			{
				// THE MISSION HANDOFF PHASES (pre-registered with Second, 2026-10-03, BEFORE any measurement), APPENDED so every phase
				// above runs exactly as it always has: the travel back and the swords' arrival are a throwaway "handoff_setup" phase
				// that nothing is compared on; then "handoff_walk" (the walk phase's own route and turns, swords held) and
				// "handoff_dash" (the same with a dash pair every 1.6 s), each compared with the baseline's "walk" under the same
				// fixed tolerance as every other phase.
				QaPerfPhase(P, TEXT("handoff_setup"));
				Next();
			}
			break;
		case 9: // back to the walk's place, then the swords taken up the way the terminal takes them
			if (P.Sub < 2)
			{
				if (QaPerfTravel(P, World, TEXT("castle_approach"))) { P.Sub = 2; P.SubStart = QaNow(); }
			}
			else if (P.Sub == 2)
			{
				FString Said;
				WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF handoff equip: %s"), *Said);
				P.Sub = 3;
				P.SubStart = QaNow();
			}
			else
			{
				const FWonderlandMissionHandoff* State = QaHandoff(World);
				const bool bHeld = State != nullptr && State->IsArmed();
				if ((bHeld && QaNow() - P.SubStart >= 4.5) || QaNow() - P.SubStart >= 12.0)
				{
					UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF handoff %s"), bHeld ? TEXT("held") : TEXT("NEVER HELD: the handoff phases measure the unarmed Dog"));
					QaPerfPhase(P, TEXT("handoff_walk"));
					P.bWalking = true;
					P.WalkBegan = QaNow();
					P.Yaw = 0.0f;
					Next();
				}
			}
			break;
		case 10: // handoff_walk: the walk's thirty seconds with the swords held
			if (In >= 30.0)
			{
				// BACK TO THE WALK'S START before the dash phase (pre-registration rev 3): a walk keeps its ARRIVAL heading for its first
				// five seconds (the yaw is only set at the first 60-degree step), so without this the dash phase began where
				// handoff_walk ended, facing 300 degrees -- not the route it claims. A throwaway phase, compared on nothing.
				P.bWalking = false;
				QaPerfPhase(P, TEXT("handoff_travel"));
				Next();
			}
			break;
		case 11: // the travel back, the swords held through it
			if (QaPerfTravel(P, World, TEXT("castle_approach")))
			{
				QaPerfPhase(P, TEXT("handoff_dash"));
				P.bWalking = true;
				P.WalkBegan = QaNow();
				P.Yaw = 0.0f;
				Next();
			}
			break;
		case 12: // handoff_dash: the same, and a double tap of W every 1.6 s
		{
			ARelayDogCharacter* Dog = QaDog(World);
			if (Dog != nullptr && In < 30.0)
			{
				if (P.Sub == 0)
				{
					P.DashesBefore = Dog->GetDashCount();
					P.RefusedBefore = Dog->GetDashesRefused();
				}
				// THIS STEP TICKS EVERY 0.1 s, too coarse to give each half of a tap its own tick inside the 0.30 s window
				// reliably, so the pair is pressed inside ONE tick (down, up, down: two rising edges) and let go on the next.
				// The dash and its trails are what this phase measures; the real-input timing is G3's real-input pass.
				// Sub: even = waiting for pair Sub/2, due at Sub/2 x 1.6 s; odd = pressed, let go on this tick.
				if (P.Sub % 2 == 1)
				{
					Dog->QaForwardKey(false, false);
					++P.Sub;
				}
				else if (In >= (P.Sub / 2) * 1.6)
				{
					Dog->QaForwardKey(false, true);
					Dog->QaForwardKey(false, false);
					Dog->QaForwardKey(false, true);
					++P.Sub;
				}
			}
			if (In >= 30.0)
			{
				P.bWalking = false;
				if (Dog != nullptr)
				{
					Dog->QaForwardKey(false, false);
					UE_LOG(LogWonderlandQa, Display, TEXT("WLPERF handoff pairs %d, dashes %d, refused %d"), (P.Sub + 1) / 2,
						Dog->GetDashCount() - P.DashesBefore, Dog->GetDashesRefused() - P.RefusedBefore);
				}
				FString Said;
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
				QaPerfFinish(P, World);
				return false;
			}
			break;
		}
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

	/* ================================================================ wl.Qa.CardRefs: C.A.R.D.'s references, RESOLVED (M7a)
	 * Every rule of WonderlandCardCapabilities, proved on readings built here -- each state of both authorities, the founder's
	 * locks, the authority separation, untrusted text -- then THIS boot's own reading. Read-only by design: Cards.sav is
	 * hashed before and after. Every line: WLCRQA <id> PASS|FAIL | detail.
	 */
	struct FCardRefQa
	{
		int32 Pass = 0;
		int32 Fail = 0;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCRQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
	};

	FWonderlandCompanionRef QaCrCompanion(int32 Slot, EWonderlandCardCompanionKind Kind, const TCHAR* ProviderId)
	{
		FWonderlandCompanionRef Ref;
		Ref.Slot = Slot;
		Ref.Kind = Kind;
		Ref.ProviderId = ProviderId;
		return Ref;
	}

	FWonderlandCapabilityRef QaCrCapability(EWonderlandCapabilityKind Kind, const TCHAR* Id)
	{
		FWonderlandCapabilityRef Ref;
		Ref.Kind = Kind;
		Ref.Id = Id;
		return Ref;
	}

	void QaCrProvider(WonderlandCardCapabilities::FReading& Reading, const TCHAR* Id, const TCHAR* Backs, bool bReady, const FString& Detail)
	{
		FWonderlandSidekickProvider& Provider = Reading.Providers.AddDefaulted_GetRef();
		Provider.ProviderId = Id;
		Provider.DisplayName = FString::Printf(TEXT("QA provider %s"), Id);
		Provider.Backs = Backs;
		Provider.bReady = bReady;
		Provider.Detail = Detail;
	}

	FWonderlandSidekick& QaCrLive(WonderlandCardCapabilities::FReading& Reading, const TCHAR* SidekickId, const TCHAR* ProviderId, const TCHAR* State)
	{
		FWonderlandSidekick& Live = Reading.Sidekicks.AddDefaulted_GetRef();
		Live.SidekickId = SidekickId;
		Live.ProviderId = ProviderId;
		Live.State = State;
		return Live;
	}

	FJuliusConnectService& QaCrService(WonderlandCardCapabilities::FReading& Reading, const TCHAR* Id, const TCHAR* State)
	{
		FJuliusConnectService& Service = Reading.Services.AddDefaulted_GetRef();
		Service.ConnectorId = Id;
		Service.DisplayName = FString::Printf(TEXT("QA connector %s"), Id);
		Service.Kind = TEXT("REAL SERVICE");
		Service.State = State;
		Service.StateLabel = FString(State).Replace(TEXT("_"), TEXT(" ")).ToLower();
		Service.bReachable = true;
		Service.RouteLabel = TEXT("QA route");
		return Service;
	}

	/** Both authorities online: providers for every rule, the LLM Companion connected to qa-llm, Jhinn on the fixture. */
	WonderlandCardCapabilities::FReading QaCrOnline()
	{
		WonderlandCardCapabilities::FReading Reading;
		Reading.CompanionLink = EWonderlandSidekickLink::Online;
		Reading.ConnectLink = EJuliusConnectLink::Online;
		QaCrProvider(Reading, TEXT("dev-companion"), TEXT("llm_companion"), true, TEXT("built in"));
		QaCrProvider(Reading, TEXT("dev-single-agent"), TEXT("single_agent"), true, TEXT("built in"));
		QaCrProvider(Reading, TEXT("qa-llm"), TEXT("llm_companion"), true, TEXT("ready"));
		QaCrProvider(Reading, TEXT("qa-agent"), TEXT("single_agent"), false, TEXT("sign in to the QA agent first"));
		QaCrProvider(Reading, TEXT("qa-harness"), TEXT("single_agent"), true, TEXT("ready"));
		QaCrLive(Reading, TEXT("llm-companion"), TEXT("qa-llm"), TEXT("CONNECTED")).ModelId = TEXT("qa-model");
		QaCrLive(Reading, TEXT("jhinn"), TEXT("dev-single-agent"), TEXT("SIMULATED"));
		return Reading;
	}

	void RunCardRefsQa(UWorld* World)
	{
		namespace CardCaps = WonderlandCardCapabilities;
		using St = EWonderlandCardStatus;
		using Ck = EWonderlandCardCompanionKind;
		using Cp = EWonderlandCapabilityKind;
		FCardRefQa Q;
		UE_LOG(LogWonderlandQa, Display, TEXT("WLCRQA BEGIN | %s"), *WonderlandBeta::BuildLabel());

		// READ-ONLY: the store's bytes before and after everything below
		const FString CardsPath = FWonderlandCardStore::DefaultPath();
		auto StoreHash = [&CardsPath]()
		{
			TArray<uint8> Bytes;
			const bool bThere = FFileHelper::LoadFileToArray(Bytes, *CardsPath, FILEREAD_Silent);
			return bThere ? FString::Printf(TEXT("%d bytes crc %08x"), Bytes.Num(), FCrc::MemCrc32(Bytes.GetData(), Bytes.Num())) : FString(TEXT("absent"));
		};
		const FString StoreBefore = StoreHash();

		// ---- THE COMPANION RUNTIME
		CardCaps::FReading Off;
		Off.CompanionProblem = TEXT("QA: nothing listening");
		Off.ConnectProblem = TEXT("QA: the service is not running");
		{
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-llm")), Off);
			Q.Check(TEXT("CR1"), R.Status == St::Unavailable && R.Reason.Contains(TEXT("offline")) && R.Reason.Contains(TEXT("QA: nothing listening")),
				FString::Printf(TEXT("runtime offline -> %s"), *CardCaps::Describe(R)));
		}
		{
			CardCaps::FReading StillConnecting = QaCrOnline();
			StillConnecting.CompanionLink = EWonderlandSidekickLink::Connecting;
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-llm")), StillConnecting);
			Q.Check(TEXT("CR2"), R.Status == St::Unavailable && R.Reason.Contains(TEXT("still connecting")),
				FString::Printf(TEXT("runtime connecting (a provider ready on it) -> %s"), *CardCaps::Describe(R)));
		}
		const CardCaps::FReading On = QaCrOnline();
		{
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-nobody")), On);
			Q.Check(TEXT("CR3"), R.Status == St::Unavailable && R.Reason.Contains(TEXT("offers no provider")), FString::Printf(TEXT("unknown provider -> %s"), *CardCaps::Describe(R)));
		}
		{
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-harness")), On);
			Q.Check(TEXT("CR4"), R.Status == St::Unavailable && R.Reason.Contains(TEXT("backs single_agent")),
				FString::Printf(TEXT("a single agent in the LLM Companion's slot -> %s"), *CardCaps::Describe(R)));
		}
		{
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(1, Ck::Agent, TEXT("qa-agent")), On);
			Q.Check(TEXT("CR5"), R.Status == St::Unconfigured && R.Reason == TEXT("sign in to the QA agent first") && !R.bSimulated,
				FString::Printf(TEXT("not ready: the provider's own words, verbatim -> %s"), *CardCaps::Describe(R)));
		}
		{
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(1, Ck::Harness, TEXT("qa-harness")), On);
			Q.Check(TEXT("CR6"), R.Status == St::Ready && !R.bSimulated && R.Reason.Contains(TEXT("not connected")),
				FString::Printf(TEXT("a harness ready on the machine, not in the slot yet -> %s"), *CardCaps::Describe(R)));
		}
		{
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-llm")), On);
			Q.Check(TEXT("CR7"), R.Status == St::Ready && !R.bSimulated && R.Reason.Contains(TEXT("qa-model")),
				FString::Printf(TEXT("connected in its slot -> %s"), *CardCaps::Describe(R)));
		}
		{
			// THE FOUNDER'S LOCK: the provider says ready, the companion in the slot still waits for the go-ahead
			CardCaps::FReading Locked = QaCrOnline();
			Locked.Sidekicks[0].State = TEXT("AUTH_REQUIRED");
			Locked.Sidekicks[0].Note = TEXT("QA: live use is not allowed yet");
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-llm")), Locked);
			Q.Check(TEXT("CR8"), R.Status == St::Unconfigured && R.Reason.StartsWith(TEXT("AUTH_REQUIRED")) && R.Reason.Contains(TEXT("not allowed yet")),
				FString::Printf(TEXT("ready provider, AUTH_REQUIRED in the slot -> %s"), *CardCaps::Describe(R)));
		}
		{
			// CR8b (Second's read of M7a): the SLOT is locked -- its companion is AUTH_REQUIRED on ANOTHER provider -- so a real provider
			// that reports ready but is not in the slot yet must not read READY; a fixture in the same slot still does (simulated)
			CardCaps::FReading SlotLocked = QaCrOnline();
			SlotLocked.Sidekicks[0].ProviderId = TEXT("qa-other");
			SlotLocked.Sidekicks[0].State = TEXT("AUTH_REQUIRED");
			SlotLocked.Sidekicks[0].Note = TEXT("QA: live use is not allowed yet");
			const FWonderlandCardRefStatus Real = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-llm")), SlotLocked);
			const FWonderlandCardRefStatus Fixture = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("dev-companion")), SlotLocked);
			Q.Check(TEXT("CR8b"), Real.Status == St::Unconfigured && Real.Reason.Contains(TEXT("waiting for authorisation")) && Fixture.Status == St::Ready
				&& Fixture.bSimulated,
				FString::Printf(TEXT("the slot locked on another provider: a ready real provider -> %s; a fixture -> %s"), *CardCaps::Describe(Real),
					*CardCaps::Describe(Fixture)));
		}
		{
			const FWonderlandCardRefStatus InSlot = CardCaps::ResolveCompanion(QaCrCompanion(1, Ck::Agent, TEXT("dev-single-agent")), On);
			const FWonderlandCardRefStatus NotInSlot = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("dev-companion")), On);
			Q.Check(TEXT("CR9"), InSlot.Status == St::Ready && InSlot.bSimulated && NotInSlot.Status == St::Ready && NotInSlot.bSimulated
				&& CardCaps::Describe(InSlot).StartsWith(TEXT("READY (SIMULATED)")),
				FString::Printf(TEXT("fixtures are marked: in the slot -> %s; not in it -> %s"), *CardCaps::Describe(InSlot), *CardCaps::Describe(NotInSlot)));
		}
		{
			CardCaps::FReading Failed = QaCrOnline();
			Failed.Sidekicks[0].State = TEXT("FAILED");
			Failed.Sidekicks[0].Failure = TEXT("QA: the provider answered 500");
			const FWonderlandCardRefStatus R = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Llm, TEXT("qa-llm")), Failed);
			Q.Check(TEXT("CR10"), R.Status == St::Unavailable && R.Reason.Contains(TEXT("FAILED")) && R.Reason.Contains(TEXT("answered 500")),
				FString::Printf(TEXT("FAILED in the slot -> %s"), *CardCaps::Describe(R)));
		}
		{
			// THE AUTHORITY SEPARATION: Julius is the only compound agent; no card can seat one, on either side
			const FWonderlandCardRefStatus LeftSeat = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::CompoundAgent, TEXT("qa-llm")), On);
			const FWonderlandCardRefStatus RightSeat = CardCaps::ResolveCompanion(QaCrCompanion(1, Ck::CompoundAgent, TEXT("qa-harness")), On);
			Q.Check(TEXT("CR11"), LeftSeat.Status == St::Unavailable && RightSeat.Status == St::Unavailable && LeftSeat.Reason.Contains(TEXT("Julius")),
				FString::Printf(TEXT("compound agent -> %s"), *CardCaps::Describe(LeftSeat)));
		}
		{
			const FWonderlandCardRefStatus LlmRight = CardCaps::ResolveCompanion(QaCrCompanion(1, Ck::Llm, TEXT("qa-llm")), On);
			const FWonderlandCardRefStatus AgentLeft = CardCaps::ResolveCompanion(QaCrCompanion(0, Ck::Agent, TEXT("qa-agent")), On);
			const FWonderlandCardRefStatus Third = CardCaps::ResolveCompanion(QaCrCompanion(2, Ck::Agent, TEXT("qa-agent")), On);
			Q.Check(TEXT("CR12"), LlmRight.Status == St::Unavailable && AgentLeft.Status == St::Unavailable && Third.Status == St::Unavailable,
				FString::Printf(TEXT("the sides never swap: LLM on the RIGHT -> %s; agent on the LEFT -> %s; slot 2 -> %s"),
					*CardCaps::Describe(LlmRight), *CardCaps::Describe(AgentLeft), *CardCaps::Describe(Third)));
		}

		// ---- JULIUS CONNECT (MCP servers and APIs) AND SKILLS
		{
			const FWonderlandCardRefStatus Mcp = CardCaps::ResolveCapability(QaCrCapability(Cp::Mcp, TEXT("qa-files")), Off);
			const FWonderlandCardRefStatus Api = CardCaps::ResolveCapability(QaCrCapability(Cp::Api, TEXT("qa-mail")), Off);
			Q.Check(TEXT("CR13"), Mcp.Status == St::Unavailable && Api.Status == St::Unavailable && Mcp.Reason.Contains(TEXT("Julius Connect is offline"))
				&& Mcp.Reason.Contains(TEXT("QA: the service is not running")), FString::Printf(TEXT("Connect offline -> %s"), *CardCaps::Describe(Mcp)));
		}
		{
			const FWonderlandCardRefStatus R = CardCaps::ResolveCapability(QaCrCapability(Cp::Mcp, TEXT("qa-nothing")), On);
			Q.Check(TEXT("CR14"), R.Status == St::Unavailable && R.Reason.Contains(TEXT("lists no connector")), FString::Printf(TEXT("unknown connector -> %s"), *CardCaps::Describe(R)));
		}
		{
			CardCaps::FReading Connected = QaCrOnline();
			QaCrService(Connected, TEXT("qa-files"), TEXT("CONNECTED"));
			QaCrService(Connected, TEXT("qa-devfiles"), TEXT("CONNECTED")).Kind = TEXT("DEVELOPMENT CONNECTOR");
			const FWonderlandCardRefStatus Real = CardCaps::ResolveCapability(QaCrCapability(Cp::Mcp, TEXT("qa-files")), Connected);
			const FWonderlandCardRefStatus Fixture = CardCaps::ResolveCapability(QaCrCapability(Cp::Api, TEXT("qa-devfiles")), Connected);
			Q.Check(TEXT("CR15"), Real.Status == St::Ready && !Real.bSimulated && Real.Reason.Contains(TEXT("QA route")) && Fixture.Status == St::Ready && Fixture.bSimulated,
				FString::Printf(TEXT("CONNECTED -> %s; a development connector -> %s"), *CardCaps::Describe(Real), *CardCaps::Describe(Fixture)));
		}
		{
			CardCaps::FReading States = QaCrOnline();
			static const TCHAR* const Fixable[] = { TEXT("CREDENTIAL_REQUIRED"), TEXT("AUTHORIZATION_REQUIRED"), TEXT("CONNECTING"), TEXT("RECONNECT_REQUIRED"),
				TEXT("REVOKED"), TEXT("EXPIRED") };
			static const TCHAR* const Broken[] = { TEXT("RATE_LIMITED"), TEXT("FAILED"), TEXT("UNAVAILABLE"), TEXT("QA_STRANGE") };
			for (const TCHAR* State : Fixable) { QaCrService(States, State, State); }
			for (const TCHAR* State : Broken) { QaCrService(States, State, State); }
			FJuliusConnectService& Down = QaCrService(States, TEXT("qa-down"), TEXT("CONNECTED"));
			Down.bReachable = false;
			Down.UnavailableReason = TEXT("QA: the route is down");
			int32 Mapped = 0;
			FString Wrong;
			for (const TCHAR* State : Fixable)
			{
				const FWonderlandCardRefStatus R = CardCaps::ResolveCapability(QaCrCapability(Cp::Api, State), States);
				if (R.Status == St::Unconfigured) { ++Mapped; } else { Wrong += FString::Printf(TEXT(" %s=%s"), State, CardCaps::StatusWord(R.Status)); }
			}
			for (const TCHAR* State : Broken)
			{
				const FWonderlandCardRefStatus R = CardCaps::ResolveCapability(QaCrCapability(Cp::Mcp, State), States);
				if (R.Status == St::Unavailable) { ++Mapped; } else { Wrong += FString::Printf(TEXT(" %s=%s"), State, CardCaps::StatusWord(R.Status)); }
			}
			const FWonderlandCardRefStatus DownR = CardCaps::ResolveCapability(QaCrCapability(Cp::Mcp, TEXT("qa-down")), States);
			const bool bDown = DownR.Status == St::Unavailable && DownR.Reason.Contains(TEXT("the route is down"));
			Q.Check(TEXT("CR16"), Mapped == static_cast<int32>(UE_ARRAY_COUNT(Fixable) + UE_ARRAY_COUNT(Broken)) && bDown,
				FString::Printf(TEXT("%d of %d states mapped (a person can fix: UNCONFIGURED; broken or unknown: UNAVAILABLE)%s; unreachable -> %s"),
					Mapped, static_cast<int32>(UE_ARRAY_COUNT(Fixable) + UE_ARRAY_COUNT(Broken)), Wrong.IsEmpty() ? TEXT("") : *(TEXT(", wrong:") + Wrong), *CardCaps::Describe(DownR)));
		}
		{
			const FWonderlandCardRefStatus SkillOn = CardCaps::ResolveCapability(QaCrCapability(Cp::Skill, TEXT("qa-skill")), On);
			const FWonderlandCardRefStatus SkillOff = CardCaps::ResolveCapability(QaCrCapability(Cp::Skill, TEXT("qa-skill")), Off);
			Q.Check(TEXT("CR17"), SkillOn.Status == St::Unavailable && SkillOff.Status == St::Unavailable && SkillOn.Reason.Contains(TEXT("no skill registry")),
				FString::Printf(TEXT("a skill cannot be checked from here, so it is never READY -> %s"), *CardCaps::Describe(SkillOn)));
		}

		// ---- UNTRUSTED TEXT: a runtime's reason is shown, so it is cleaned, capped, and never a credential
		{
			// a credential-SHAPED run, built at run time so no key-shaped literal is planted in the package (the release scan)
			FString Shaped;
			for (int32 Index = 0; Index < 20; ++Index) { Shaped += TEXT("q7"); }
			CardCaps::FReading Hostile = QaCrOnline();
			Hostile.Providers[3].Detail = FString::Printf(TEXT("sign in with %s"), *Shaped);
			const FWonderlandCardRefStatus Key = CardCaps::ResolveCompanion(QaCrCompanion(1, Ck::Agent, TEXT("qa-agent")), Hostile);
			// the same run split by a ZERO WIDTH SPACE: whole only once the invisible character is dropped
			FString SplitRaw = Shaped.Left(20);
			SplitRaw.AppendChar(static_cast<TCHAR>(0x200B));
			SplitRaw += Shaped.Mid(20);
			const FString Split = CardCaps::CleanReason(SplitRaw);
			// controls, a right-to-left override, a TAG character (U+E0041 as its surrogate pair), a line break
			FString MessyRaw = TEXT("plain");
			MessyRaw.AppendChar(static_cast<TCHAR>(0x202E));
			MessyRaw += TEXT(" evil");
			MessyRaw.AppendChar(static_cast<TCHAR>(0x01));
			MessyRaw.AppendChar(static_cast<TCHAR>(0xDB40));
			MessyRaw.AppendChar(static_cast<TCHAR>(0xDC41));
			MessyRaw.AppendChar(static_cast<TCHAR>(0x0A));
			MessyRaw += TEXT("next line");
			const FString Messy = CardCaps::CleanReason(MessyRaw);
			const FString Long = CardCaps::CleanReason(FString::ChrN(1000, TEXT('x')));
			const bool bKey = Key.Status == St::Unconfigured && !Key.Reason.Contains(Shaped) && Key.Reason.Contains(TEXT("withheld"));
			const bool bSplit = Split.Contains(TEXT("withheld"));
			const bool bMessy = Messy == TEXT("plain evil next line");
			const bool bLong = Long.Len() == 160;
			Q.Check(TEXT("CR18"), bKey && bSplit && bMessy && bLong,
				FString::Printf(TEXT("a key-shaped reason -> '%s'; split by a zero width -> '%s'; controls/bidi/tag/newline -> '%s'; 1000 chars -> %d"),
					*Key.Reason, *Split, *Messy, Long.Len()));
		}

		// ---- THIS BOOT: the real reading, as the C.A.R.D. section will show it
		{
			const CardCaps::FReading Real = CardCaps::Read(World != nullptr ? World->GetGameInstance() : nullptr);
			FWonderlandCard Probe;
			Probe.Id = TEXT("qa-probe");
			Probe.Name = TEXT("QA probe");
			Probe.Companions = { QaCrCompanion(0, Ck::Llm, TEXT("dev-companion")), QaCrCompanion(1, Ck::Agent, TEXT("dev-single-agent")) };
			Probe.Capabilities = { QaCrCapability(Cp::Mcp, TEXT("qa-files")), QaCrCapability(Cp::Skill, TEXT("qa-skill")) };
			const TArray<FString> Lines = CardCaps::DescribeCard(Probe, Real);
			bool bWords = true;
			bool bClean = true;
			for (const FString& Line : Lines)
			{
				UE_LOG(LogWonderlandQa, Display, TEXT("WLCRQA card | %s"), *Line);
				bClean &= !FWonderlandCardStore::LooksLikeSecret(Line);
			}
			// what this boot's links are decides what every reference may say: an offline authority vouches for nothing
			const FWonderlandCardRefStatus Companion = CardCaps::ResolveCompanion(Probe.Companions[0], Real);
			const FWonderlandCardRefStatus Mcp = CardCaps::ResolveCapability(Probe.Capabilities[0], Real);
			const bool bCompanionHonest = Real.CompanionLink == EWonderlandSidekickLink::Online || Companion.Status == St::Unavailable;
			const bool bMcpHonest = Real.ConnectLink == EJuliusConnectLink::Online || Mcp.Status == St::Unavailable;
			for (const FString& Line : Lines)
			{
				if (Line.StartsWith(TEXT("C.A.R.D."))) { continue; }
				bWords &= Line.Contains(TEXT(": READY")) || Line.Contains(TEXT(" READY")) || Line.Contains(TEXT("UNCONFIGURED")) || Line.Contains(TEXT("UNAVAILABLE"))
					|| Line.Contains(TEXT("none chosen")) || Line.Contains(TEXT("none attached"));
			}
			Q.Check(TEXT("CR19"), Lines.Num() == 5 && bWords && bClean && bCompanionHonest && bMcpHonest,
				FString::Printf(TEXT("this boot: companion runtime %s, Julius Connect %s; %d lines, each with one of the three words, none credential-shaped"),
					Real.CompanionLink == EWonderlandSidekickLink::Online ? TEXT("ONLINE") : TEXT("not online"),
					Real.ConnectLink == EJuliusConnectLink::Online ? TEXT("ONLINE") : TEXT("not online"), Lines.Num()));
		}

		const FString StoreAfter = StoreHash();
		Q.Check(TEXT("CR20"), StoreBefore == StoreAfter, FString::Printf(TEXT("read-only: Cards.sav %s before, %s after"), *StoreBefore, *StoreAfter));
		UE_LOG(LogWonderlandQa, Display, TEXT("WLCRQA END %d pass, %d fail"), Q.Pass, Q.Fail);
	}

	FAutoConsoleCommandWithWorldAndArgs GQaCardRefsCommand(
		TEXT("wl.Qa.CardRefs"),
		TEXT("C.A.R.D. M7a: every rule that resolves a card's companions and capabilities to READY / UNCONFIGURED / UNAVAILABLE, on ")
		TEXT("built readings (every state, the founder's locks, the authority separation, untrusted text), then this boot's own ")
		TEXT("reading. Read-only. `quit` exits after. Logs WLCRQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			RunCardRefsQa(World);
			if (Args.Contains(TEXT("quit")))
			{
				FPlatformMisc::RequestExit(false);
			}
		}));

	/* ================================================================ wl.Qa.CardSelect: C.A.R.D. SELECT through the authorities (M7b)
	 * On the player's REAL store: two QA cards are made and removed, and the card that was active is selected again at the end.
	 *   CS1 SELECT while roaming: the skin through the registry, the primary through the wardrobe's pick; the companions now -- or,
	 *       with the companion runtime offline (every bed), WAITING with that reason and nothing sent at it;
	 *   CS2 a pick through the wardrobe's own door makes the card MODIFIED; SAVE TO C.A.R.D. writes the live look back and clears it;
	 *   CS3 SELECT MID-MISSION: the look hot-swaps, the companions wait for the mission (the envelope), and the write spy counts
	 *       nothing the running mission owns -- a positive control first proves the spy counts;
	 *   CS4 the mission ends: the companions stop waiting for it;
	 *   CS5 ten switches in two seconds while the swords form (Second's rule): settled, exactly the built swords drawn, no costume
	 *       left behind, the last selection active;
	 *   CS6 deleting the active card falls back to the built-in default (the look is not changed by a delete).
	 * Every line: WLCSQA <id> PASS|FAIL | detail.
	 */
	struct FQaCardSelect
	{
		TWeakObjectPtr<UWorld> World;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		int32 Sub = 0;
		double PhaseAt = 0.0;
		double LastSwitchAt = 0.0;
		FString OriginalActive;
		FString CardA;
		FString CardB;
		FString RunningAtSelect;
		FString LastSelected;
		int32 ConnectsBefore = 0;
		int32 SpyControl = -1;
		int32 SpyCounted = -1;
		FString SpyLast;
		int32 Switches = 0;
		int32 FiguresBefore = 0;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCSQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
	};
	TSharedPtr<FQaCardSelect> GQaCardSelect;

	UWonderlandSidekickSubsystem* QaCsSidekicks(UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
	}

	UWonderlandRelaySkinSubsystem* QaCsSkins(UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandRelaySkinSubsystem>() : nullptr;
	}

	bool QaCsWears(UWorld* World, const TCHAR* SkinId)
	{
		const UWonderlandRelaySkinSubsystem* Skins = QaCsSkins(World);
		return Skins != nullptr && Skins->GetEquippedSkinId().ToString().Equals(SkinId, ESearchCase::IgnoreCase);
	}

	bool QaCsPrimaryIs(const TCHAR* Key)
	{
		for (const TPair<FName, FLinearColor>& Swatch : WonderlandMascotStyle::PrimaryPalette())
		{
			if (Swatch.Key.ToString().Equals(Key, ESearchCase::IgnoreCase))
			{
				return WonderlandMascotStyle::IsMascotPrimaryOn(Swatch.Key, Swatch.Value);
			}
		}
		return false;
	}

	/** Every figure on show that is not the Dog's costume, a companion, or the wardrobe stage's own: a left-behind costume adds one. */
	int32 QaCsLooseFigures(UWorld* World)
	{
		const ARelayDogCharacter* Dog = QaDog(World);
		const AActor* Left = QaCompanionBody(World, 0);
		const AActor* Right = QaCompanionBody(World, 1);
		int32 Count = 0;
		for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
		{
			if (!It->IsHidden() && (Dog == nullptr || *It != Dog->GetCostume()) && *It != Left && *It != Right
				&& Cast<AWonderlandSkinStage>(It->GetOwner()) == nullptr)
			{
				++Count;
			}
		}
		return Count;
	}

	void QaCardSelectFinish(FQaCardSelect& S, const TCHAR* Why)
	{
		UWorld* World = S.World.Get();
		if (World != nullptr)
		{
			if (FWonderlandMissionHandoff* State = QaHandoff(World))
			{
				FString Ignored;
				State->Return(Ignored);
			}
			GEngine->Exec(World, TEXT("wl.Mission.Stop"));
			if (UWonderlandSidekickSubsystem* Sidekicks = QaCsSidekicks(World))
			{
				// PUT IT BACK: the QA cards removed, the card that was active selected again (its look applied through the authorities)
				FWonderlandCardStore& Store = Sidekicks->GetCardStore();
				FString Ignored;
				const FString Back = Store.Find(S.OriginalActive) != nullptr ? S.OriginalActive : FString(FWonderlandCardStore::BuiltInId());
				WonderlandCardDirector::Select(World, Back, Ignored);
				for (const FString& Id : { S.CardA, S.CardB })
				{
					if (!Id.IsEmpty() && Store.Find(Id) != nullptr)
					{
						Store.Delete(Id, Ignored);
					}
				}
			}
		}
		if (S.Handle.IsValid())
		{
			FTSTicker::GetCoreTicker().RemoveTicker(S.Handle);
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLCSQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
		if (S.bQuit)
		{
			FPlatformMisc::RequestExit(false);
		}
	}

	bool QaCardSelectTick(float)
	{
		if (!GQaCardSelect.IsValid())
		{
			return false;
		}
		FQaCardSelect& S = *GQaCardSelect;
		UWorld* World = S.World.Get();
		UWonderlandSidekickSubsystem* Sidekicks = QaCsSidekicks(World);
		UWonderlandRelaySkinSubsystem* Skins = QaCsSkins(World);
		UWonderlandMissionSubsystem* Mission = QaMissions(World);
		FWonderlandMissionHandoff* Handoff = QaHandoff(World);
		ARelayDogCharacter* Dog = QaDog(World);
		auto Stop = [&S](const TCHAR* Why)
		{
			S.Handle.Reset();   // the ticker ends by returning false; Finish must not remove it a second time
			QaCardSelectFinish(S, Why);
			GQaCardSelect.Reset();
			return false;
		};
		if (World == nullptr || Sidekicks == nullptr || Skins == nullptr || Mission == nullptr || Handoff == nullptr || Dog == nullptr)
		{
			return Stop(TEXT("the world, the store, the registry, the mission, the handoff or the Dog went away"));
		}
		FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		const double Now = QaNow();
		const double In = Now - S.PhaseAt;
		auto Next = [&S, Now](int32 To)
		{
			S.Phase = To;
			S.Sub = 0;
			S.PhaseAt = Now;
		};
		const bool bRuntimeOnline = Sidekicks->GetLink() == EWonderlandSidekickLink::Online;
		FString Said;
		FString Why;

		switch (S.Phase)
		{
		case 0:
		{
			if (UWonderlandUiSubsystem* Ui = QaUi(World))
			{
				if (Ui->IsWelcomeOpen())
				{
					Ui->DismissWelcome();
				}
			}
			if (In < 4.0 || Handoff->IsEquipped())
			{
				if (Handoff->IsArmed())
				{
					Handoff->Return(Why);
				}
				return In < 40.0 ? true : Stop(TEXT("never ready: the swords away"));
			}
			S.OriginalActive = Store.GetActiveId();
			S.CardA = Store.Create(TEXT("QA Select A"), Why);
			S.CardB = Store.Create(TEXT("QA Select B"), Why);
			const FWonderlandCard* MadeA = Store.Find(S.CardA);
			const FWonderlandCard* MadeB = Store.Find(S.CardB);
			bool bMade = MadeA != nullptr && MadeB != nullptr;
			if (bMade)
			{
				FWonderlandCard A = *MadeA;
				A.Skin = TEXT("celestial_light");
				A.Primary.Key = TEXT("WHITE");
				A.Primary.bChosen = true;
				A.Companions = { QaCrCompanion(0, EWonderlandCardCompanionKind::Llm, TEXT("dev-companion")),
					QaCrCompanion(1, EWonderlandCardCompanionKind::Agent, TEXT("dev-single-agent")) };
				FWonderlandCard B = *MadeB;
				B.Skin = TEXT("jack_flame");
				B.Primary.Key = TEXT("BLACK");
				B.Primary.bChosen = true;
				B.Companions = A.Companions;
				bMade = Store.Update(A, Why) && Store.Update(B, Why);
			}
			S.Check(TEXT("CS0"), bMade, FString::Printf(TEXT("two QA cards on the real store (the active one was %s): %s"), *S.OriginalActive,
				bMade ? TEXT("made") : *FString::Printf(TEXT("NOT made: %s"), *Why)));
			if (!bMade)
			{
				return Stop(TEXT("no QA cards"));
			}
			Next(1);
			return true;
		}
		case 1:
			// CS1: SELECT WHILE ROAMING
			if (S.Sub == 0)
			{
				S.ConnectsBefore = WonderlandCardDirector::GetConnectsSent();
				WonderlandCardDirector::Select(World, S.CardA, Said);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLCSQA select A: %s"), *Said);
				S.Sub = 1;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 3.0)
			{
				return true;
			}
			{
				const FString Waiting = WonderlandCardDirector::DescribeWaiting();
				const int32 Sent = WonderlandCardDirector::GetConnectsSent() - S.ConnectsBefore;
				// online: applied now and nothing waits; offline (every bed): they WAIT, saying why, and nothing was sent at a dead runtime
				const bool bCompanions = bRuntimeOnline ? Waiting.IsEmpty() : (Waiting.Contains(TEXT("companion runtime")) && Sent == 0);
				FString What;
				const bool bModified = WonderlandCardDirector::IsModified(World, &What);
				S.Check(TEXT("CS1"), Store.GetActiveId() == S.CardA && QaCsWears(World, TEXT("celestial_light")) && QaCsPrimaryIs(TEXT("WHITE")) && !bModified && bCompanions,
					FString::Printf(TEXT("selected while roaming: active %s, skin celestial_light %s, primary WHITE %s, modified %s; the runtime %s, companions %s (%d sent)"),
						Store.GetActiveId() == S.CardA ? TEXT("yes") : TEXT("NO"), QaCsWears(World, TEXT("celestial_light")) ? TEXT("worn") : TEXT("NOT worn"),
						QaCsPrimaryIs(TEXT("WHITE")) ? TEXT("on") : TEXT("NOT on"), bModified ? *What : TEXT("no"), bRuntimeOnline ? TEXT("online") : TEXT("offline"),
						Waiting.IsEmpty() ? TEXT("applied") : *Waiting, Sent));
			}
			Next(2);
			return true;
		case 2:
			// CS2: MODIFIED, then SAVE TO C.A.R.D.
			if (S.Sub == 0)
			{
				Skins->EquipSkin(FName(TEXT("baal")));
				S.Sub = 1;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 3.0)
			{
				return true;
			}
			{
				FString What;
				const bool bModifiedBefore = WonderlandCardDirector::IsModified(World, &What);
				const bool bSaved = WonderlandCardDirector::SaveLiveToActive(World, Said);
				const FWonderlandCard* A = Store.Find(S.CardA);
				const bool bModifiedAfter = WonderlandCardDirector::IsModified(World);
				S.Check(TEXT("CS2"), bModifiedBefore && What.Contains(TEXT("baal")) && bSaved && A != nullptr && A->Skin.Equals(TEXT("baal"), ESearchCase::IgnoreCase)
					&& !bModifiedAfter,
					FString::Printf(TEXT("a wardrobe pick: MODIFIED %s ('%s'); SAVE TO C.A.R.D.: %s; the card's skin now %s; modified after %s"),
						bModifiedBefore ? TEXT("yes") : TEXT("NO"), *What, *Said, A != nullptr ? *A->Skin : TEXT("(gone)"), bModifiedAfter ? TEXT("STILL") : TEXT("no")));
			}
			Next(3);
			return true;
		case 3:
			// CS3: SELECT MID-MISSION (the envelope)
			if (S.Sub == 0)
			{
				GEngine->Exec(World, TEXT("wl.Mission.Scenario B 5"));
				S.Sub = 1;
				return true;
			}
			if (S.Sub == 1)
			{
				if (Mission->GetRunningMissionId().IsEmpty())
				{
					return In < 20.0 ? true : Stop(TEXT("CS3: the QA mission never ran"));
				}
				S.RunningAtSelect = Mission->GetRunningMissionId();
				// THE SPY COUNTS: a mutation noted inside a scope on purpose must read 1
				FWonderlandMissionHandoff::ResetSpy();
				{
					FWonderlandMissionHandoff::FScope Scope;
					FWonderlandMissionHandoff::NoteMutation(TEXT("wl.Qa.CardSelect positive control"));
				}
				S.SpyControl = FWonderlandMissionHandoff::GetMutationsInScope();
				// THEN THE SELECT, inside a scope: nothing the running mission owns may be written by it
				FWonderlandMissionHandoff::ResetSpy();
				S.ConnectsBefore = WonderlandCardDirector::GetConnectsSent();
				{
					FWonderlandMissionHandoff::FScope Scope;
					WonderlandCardDirector::Select(World, S.CardB, Said);
				}
				S.SpyCounted = FWonderlandMissionHandoff::GetMutationsInScope();
				S.SpyLast = FWonderlandMissionHandoff::GetLastMutationInScope();
				UE_LOG(LogWonderlandQa, Display, TEXT("WLCSQA select B mid-mission %s: %s"), *S.RunningAtSelect, *Said);
				S.Sub = 2;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 3.0)
			{
				return true;
			}
			{
				const FString Waiting = WonderlandCardDirector::DescribeWaiting();
				const int32 Sent = WonderlandCardDirector::GetConnectsSent() - S.ConnectsBefore;
				const bool bStillRunning = Mission->GetRunningMissionId() == S.RunningAtSelect;
				S.Check(TEXT("CS3"), S.SpyControl == 1 && S.SpyCounted == 0 && QaCsWears(World, TEXT("jack_flame")) && QaCsPrimaryIs(TEXT("BLACK"))
					&& Waiting.Contains(TEXT("mission")) && Sent == 0 && bStillRunning,
					FString::Printf(TEXT("mid-mission %s: the look hot-swapped (jack_flame %s, BLACK %s); the companions wait for the mission (%s), %d sent; ")
						TEXT("the spy counted %d of the mission's writes (control %d)%s; the mission %s"), *S.RunningAtSelect,
						QaCsWears(World, TEXT("jack_flame")) ? TEXT("worn") : TEXT("NOT worn"), QaCsPrimaryIs(TEXT("BLACK")) ? TEXT("on") : TEXT("NOT on"),
						Waiting.IsEmpty() ? TEXT("NOTHING WAITS") : *Waiting, Sent, S.SpyCounted, S.SpyControl,
						S.SpyLast.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(", last '%s'"), *S.SpyLast), bStillRunning ? TEXT("runs on") : TEXT("CHANGED")));
			}
			Next(4);
			return true;
		case 4:
			// CS4: THE MISSION ENDS, and the companions stop waiting for it
			if (S.Sub == 0)
			{
				S.ConnectsBefore = WonderlandCardDirector::GetConnectsSent();
				GEngine->Exec(World, TEXT("wl.Mission.Stop"));
				S.Sub = 1;
				return true;
			}
			if (S.Sub == 1)
			{
				if (!Mission->GetRunningMissionId().IsEmpty())
				{
					return In < 15.0 ? true : Stop(TEXT("CS4: the QA mission never ended"));
				}
				S.Sub = 2;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 2.5)
			{
				return true;
			}
			{
				const FString Waiting = WonderlandCardDirector::DescribeWaiting();
				const int32 Sent = WonderlandCardDirector::GetConnectsSent() - S.ConnectsBefore;
				const bool bMoved = !Waiting.Contains(TEXT("mission")) && (bRuntimeOnline ? Waiting.IsEmpty() : Waiting.Contains(TEXT("companion runtime")));
				S.Check(TEXT("CS4"), bMoved, FString::Printf(TEXT("the mission ended: the companions %s (%d sent since; the runtime %s)"),
					Waiting.IsEmpty() ? TEXT("are applied") : *Waiting, Sent, bRuntimeOnline ? TEXT("online") : TEXT("offline")));
			}
			Next(5);
			return true;
		case 5:
		{
			// CS5: TEN SWITCHES IN TWO SECONDS WHILE THE SWORDS FORM
			if (S.Sub == 0)
			{
				S.FiguresBefore = QaCsLooseFigures(World);
				if (!WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said))
				{
					S.Check(TEXT("CS5"), false, FString::Printf(TEXT("the swords could not be taken up: %s"), *Said));
					Next(6);
					return true;
				}
				S.Switches = 0;
				S.LastSwitchAt = 0.0;
				S.Sub = 1;
				return true;
			}
			if (S.Sub == 1)
			{
				if (Handoff->GetState() != EWonderlandHandoffState::Transforming && S.Switches == 0)
				{
					return In < 10.0 ? true : Stop(TEXT("CS5: the swords never began to form"));
				}
				if (S.Switches < 10 && Now - S.LastSwitchAt >= 0.2)
				{
					S.LastSelected = S.Switches % 2 == 0 ? S.CardA : S.CardB;
					WonderlandCardDirector::Select(World, S.LastSelected, Said);
					S.LastSwitchAt = Now;
					++S.Switches;
				}
				if (S.Switches >= 10)
				{
					S.Sub = 2;
				}
				return true;
			}
			if (S.Sub == 2)
			{
				if (!Handoff->IsArmed())
				{
					return In < 25.0 ? true : Stop(TEXT("CS5: the swords were never held after the switching"));
				}
				S.Sub = 3;
				S.PhaseAt = Now;
				return true;
			}
			if (S.Sub == 3)
			{
				if (In < 2.5)
				{
					return true;
				}
				const WonderlandHandoffSwords::FPresentation& Swords = Dog->GetHandoffSwords();
				const int32 Loose = QaCsLooseFigures(World);
				S.Check(TEXT("CS5"), Store.GetActiveId() == S.LastSelected && Swords.GetBuiltBoxes() > 0 && Swords.CountVisibleBoxes() == Swords.GetBuiltBoxes()
					&& Loose <= S.FiguresBefore && Handoff->IsArmed(),
					FString::Printf(TEXT("10 switches while the swords formed: settled HELD %s, the last selection active %s, %d of %d sword boxes drawn, loose figures %d (was %d)"),
						Handoff->IsArmed() ? TEXT("yes") : TEXT("NO"), Store.GetActiveId() == S.LastSelected ? TEXT("yes") : TEXT("NO"), Swords.CountVisibleBoxes(),
						Swords.GetBuiltBoxes(), Loose, S.FiguresBefore));
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
				S.Sub = 4;
				S.PhaseAt = Now;
				return true;
			}
			if (Handoff->IsEquipped())
			{
				return In < 10.0 ? true : Stop(TEXT("CS5: the swords were never given back"));
			}
			Next(6);
			return true;
		}
		case 6:
		{
			// CS6: DELETING THE ACTIVE CARD falls back to the built-in default, and a delete changes nothing on the Dog
			if (S.Sub == 0)
			{
				WonderlandCardDirector::Select(World, S.CardA, Said);
				S.Sub = 1;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 2.0)
			{
				return true;
			}
			const FString SkinBefore = Skins->GetEquippedSkinId().ToString();
			const bool bDeleted = Store.Delete(S.CardA, Why);
			const bool bDefault = Store.GetActiveId() == FWonderlandCardStore::BuiltInId();
			const bool bLookKept = Skins->GetEquippedSkinId().ToString() == SkinBefore;
			S.Check(TEXT("CS6"), bDeleted && bDefault && bLookKept && Store.Find(S.CardA) == nullptr,
				FString::Printf(TEXT("the active card deleted %s%s: the active one is now %s (built in %s); the Dog still wears %s (%s)"),
					bDeleted ? TEXT("yes") : TEXT("NO"), bDeleted ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *Why), *Store.GetActiveId(),
					bDefault ? TEXT("yes") : TEXT("NO"), *Skins->GetEquippedSkinId().ToString(), bLookKept ? TEXT("kept") : TEXT("CHANGED")));
			return Stop(nullptr);
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaCardSelectCommand(
		TEXT("wl.Qa.CardSelect"),
		TEXT("C.A.R.D. M7b: SELECT through the authorities on the real store (two QA cards made and removed, the active card put back): ")
		TEXT("the skin and primary, the companions now or waiting (and why), MODIFIED and SAVE TO C.A.R.D., a mid-mission select under the ")
		TEXT("write spy (the envelope), ten switches while the swords form, and deleting the active card. `quit` exits after. WLCSQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaCardSelect.IsValid() || World == nullptr)
			{
				return;
			}
			GQaCardSelect = MakeShared<FQaCardSelect>();
			GQaCardSelect->World = World;
			GQaCardSelect->bQuit = Args.Contains(TEXT("quit"));
			GQaCardSelect->PhaseAt = QaNow();
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCSQA BEGIN | %s"), *WonderlandBeta::BuildLabel());
			GQaCardSelect->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaCardSelectTick), 0.0f);
		}));

	/* ================================================================ wl.Qa.BrainFrames: Project Brain in five sections (M6)
	 * The founder's re-layout, photographed in the package: the five-section view, then C.A.R.D.'s page on each tab, then the
	 * wardrobe opening over it (the page steps aside; the Dog still framed in its window). Frames to Saved/Screenshots/WLBRAIN,
	 * judged by eye (and by Second's real-input before/after at 1080p and the founder's resolution). WLBFQA lines.
	 */
	struct FQaBrainFrames
	{
		TWeakObjectPtr<UWorld> World;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		int32 Tab = 0;
		double PhaseAt = 0.0;
		FString Dir;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLBFQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
		void Frame(const FString& Name)
		{
			int32 Width = 0;
			int32 Height = 0;
			const FString Path = Dir / (Name + TEXT(".png"));
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLBFQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
		}
	};
	TSharedPtr<FQaBrainFrames> GQaBrainFrames;

	bool QaBrainFramesTick(float)
	{
		if (!GQaBrainFrames.IsValid())
		{
			return false;
		}
		FQaBrainFrames& S = *GQaBrainFrames;
		UWorld* World = S.World.Get();
		UWonderlandUiSubsystem* Ui = QaUi(World);
		auto Stop = [&S](const TCHAR* Why)
		{
			if (UWonderlandUiSubsystem* U = QaUi(S.World.Get()))
			{
				U->OpenBrainCardTab(NAME_None);
				U->SetBrainSkinsOpen(false);
				if (U->IsProjectBrainOpen())
				{
					U->ToggleProjectBrain();
				}
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLBFQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
			const bool bQuit = S.bQuit;
			GQaBrainFrames.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Ui == nullptr)
		{
			return Stop(TEXT("the world or the UI went away"));
		}
		const double Now = QaNow();
		const double In = Now - S.PhaseAt;
		static const TCHAR* const Tabs[] = { TEXT("handoff"), TEXT("mascot"), TEXT("companions"), TEXT("capabilities"), TEXT("saved") };
		switch (S.Phase)
		{
		case 0:
			if (Ui->IsWelcomeOpen())
			{
				Ui->DismissWelcome();
			}
			if (In < 5.0)
			{
				return true;
			}
			GEngine->Exec(World, TEXT("wl.Sky.Hour 12"));
			if (!Ui->IsProjectBrainOpen())
			{
				Ui->ToggleProjectBrain();
			}
			S.Phase = 1;
			S.PhaseAt = Now;
			return true;
		case 1:
			// the living brain stages into its window first
			if (In < 3.5)
			{
				return true;
			}
			S.Check(TEXT("BF1"), Ui->IsProjectBrainOpen() && Ui->GetBrainCardTab().IsNone(),
				FString::Printf(TEXT("Project Brain open in five sections, nothing over the brain (C.A.R.D. tab '%s'): frame brain_five_sections"),
					*Ui->GetBrainCardTab().ToString()));
			S.Frame(TEXT("brain_five_sections"));
			S.Tab = 0;
			S.Phase = 2;
			S.PhaseAt = Now;
			return true;
		case 2:
			// C.A.R.D.'s page on each tab, opened the way a tile click opens it
			if (S.Tab >= static_cast<int32>(UE_ARRAY_COUNT(Tabs)))
			{
				Ui->OpenBrainCardTab(NAME_None);
				S.Phase = 3;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 0.1)
			{
				return true;
			}
			if (Ui->GetBrainCardTab().ToString() != Tabs[S.Tab])
			{
				Ui->OpenBrainCardTab(FName(Tabs[S.Tab]));
				S.PhaseAt = Now;
				return true;
			}
			if (In < 1.2)
			{
				return true;
			}
			S.Check(*FString::Printf(TEXT("BF2.%d"), S.Tab + 1), Ui->GetBrainCardTab().ToString() == Tabs[S.Tab],
				FString::Printf(TEXT("C.A.R.D.'s page on %s: frame card_%s"), Tabs[S.Tab], Tabs[S.Tab]));
			S.Frame(FString::Printf(TEXT("card_%d_%s"), S.Tab + 1, Tabs[S.Tab]));
			++S.Tab;
			S.PhaseAt = Now;
			return true;
		case 3:
			// THE WARDROBE OVER IT: the page steps aside for the wardrobe, and the Dog is framed in the wardrobe's window
			if (In < 0.5)
			{
				return true;
			}
			if (S.Tab >= 0)
			{
				Ui->OpenBrainCardTab(FName(TEXT("mascot")));
				Ui->SetBrainSkinsOpen(true);
				S.Tab = -1;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 2.5)
			{
				return true;
			}
			S.Check(TEXT("BF3"), Ui->IsProjectBrainOpen(), TEXT("the wardrobe opened from C.A.R.D.'s mascot page: frame wardrobe_over_card (the Dog framed in its window, the page hidden)"));
			S.Frame(TEXT("wardrobe_over_card"));
			Ui->SetBrainSkinsOpen(false);
			S.Phase = 4;
			S.PhaseAt = Now;
			return true;
		case 4:
			if (In < 1.5)
			{
				return true;
			}
			// one step back at a time: with the wardrobe shut, the page it covered is back
			S.Check(TEXT("BF4"), Ui->GetBrainCardTab().ToString() == TEXT("mascot"),
				FString::Printf(TEXT("the wardrobe shut: C.A.R.D.'s page is back on '%s': frame card_after_wardrobe"), *Ui->GetBrainCardTab().ToString()));
			S.Frame(TEXT("card_after_wardrobe"));
			return Stop(nullptr);
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaBrainFramesCommand(
		TEXT("wl.Qa.BrainFrames"),
		TEXT("Project Brain M6: the five-section view, C.A.R.D.'s page on each tab, and the wardrobe over it, photographed to ")
		TEXT("Saved/Screenshots/WLBRAIN. `quit` exits after. WLBFQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaBrainFrames.IsValid() || World == nullptr)
			{
				return;
			}
			GQaBrainFrames = MakeShared<FQaBrainFrames>();
			GQaBrainFrames->World = World;
			GQaBrainFrames->bQuit = Args.Contains(TEXT("quit"));
			GQaBrainFrames->PhaseAt = QaNow();
			GQaBrainFrames->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLBRAIN"));
			UE_LOG(LogWonderlandQa, Display, TEXT("WLBFQA BEGIN | %s"), *WonderlandBeta::BuildLabel());
			GQaBrainFrames->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaBrainFramesTick), 0.0f);
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

	/** The knees' bend now, degrees (Second, 10-03: "visible leg bend" needs a number, not only a pelvis drop): the angle between each thigh's
	 *  long axis and its shin's -- Relay OG's own leg pivots, which a worn skin's legs follow. -1 where a pivot is missing. */
	void QaKneeBend(const ARelayDogCharacter* Dog, float& OutLeft, float& OutRight, bool bFromBehind = false)
	{
		OutLeft = -1.0f;
		OutRight = -1.0f;
		const USceneComponent* Thighs[2] = { nullptr, nullptr };
		const USceneComponent* Shins[2] = { nullptr, nullptr };
		TInlineComponentArray<USceneComponent*> LegParts;
		Dog->GetComponents<USceneComponent>(LegParts);
		for (const USceneComponent* LegPart : LegParts)
		{
			const FString LegName = LegPart != nullptr ? LegPart->GetName() : FString();
			if (LegName == TEXT("Pivot_legLeft"))
			{
				Thighs[0] = LegPart;
			}
			else if (LegName == TEXT("Pivot_legRight"))
			{
				Thighs[1] = LegPart;
			}
			else if (LegName == TEXT("Pivot_shinLeft"))
			{
				Shins[0] = LegPart;
			}
			else if (LegName == TEXT("Pivot_shinRight"))
			{
				Shins[1] = LegPart;
			}
		}
		for (int32 LegSide = 0; LegSide < 2; ++LegSide)
		{
			if (Thighs[LegSide] == nullptr || Shins[LegSide] == nullptr)
			{
				continue;
			}
			// the canon's legs hang down their pivots' -Z (dog_v2.py builds every part in its joint's own frame)
			FVector ThighDown = -Thighs[LegSide]->GetComponentQuat().GetAxisZ();
			FVector ShinDown = -Shins[LegSide]->GetComponentQuat().GetAxisZ();
			if (bFromBehind)
			{
				// AS THE GAMEPLAY CAMERA SEES IT, from behind: the Dog's own forward taken out of both, the angle left in its side-up plane
				const FVector DogAhead = Dog->GetActorForwardVector().GetSafeNormal();
				ThighDown = (ThighDown - DogAhead * FVector::DotProduct(ThighDown, DogAhead)).GetSafeNormal();
				ShinDown = (ShinDown - DogAhead * FVector::DotProduct(ShinDown, DogAhead)).GetSafeNormal();
				if (ThighDown.IsNearlyZero() || ShinDown.IsNearlyZero())
				{
					continue;
				}
			}
			(LegSide == 0 ? OutLeft : OutRight) = static_cast<float>(FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(ThighDown, ShinDown), -1.0, 1.0))));
		}
	}

	/** THE KNEES OUT, SIGNED (round 6; Second's review of 53cb041d: the from-behind bend is unsigned and only reported, so knees turned
	 *  IN passed). On the body the player SEES -- the worn costume's own legs, else Relay OG's -- for the +Y leg [0] and the -Y leg
	 *  [1]: how far the knee stands OUT of its hip-to-sole line toward its own side (uu; negative = inward), and where the sole is. */
	bool QaKneesOutOfLine(const ARelayDogCharacter* Dog, float OutOff[2], FVector OutSole[2], FString& OutWhose)
	{
		const FVector Lateral = Dog->GetActorRightVector();
		const AWonderlandCompanionEmbodiment* Costume = Dog->GetCostume();
		const bool bCostume = IsValid(Costume) && !Dog->GetWornSkinId().IsNone();
		OutWhose = bCostume ? FString::Printf(TEXT("%s's own legs"), *Dog->GetWornSkinId().ToString()) : FString(TEXT("Relay OG's legs"));
		TInlineComponentArray<USceneComponent*> LegParts;
		if (!bCostume)
		{
			Dog->GetComponents<USceneComponent>(LegParts);
		}
		for (int32 Side = 0; Side < 2; ++Side)
		{
			const float SideSign = Side == 0 ? 1.0f : -1.0f;
			FVector Hip;
			FVector Knee;
			FVector Sole;
			bool bFound = false;
			if (bCostume)
			{
				bFound = Costume->QaLegAt(SideSign, Hip, Knee, Sole);
			}
			else
			{
				const USceneComponent* Thigh = nullptr;
				const USceneComponent* Shin = nullptr;
				// QaKneeBend's names: Pivot_leg<Left|Right> and its Pivot_shin<Left|Right>; the side by where the hip hangs
				for (const TCHAR* Which : { TEXT("Left"), TEXT("Right") })
				{
					const USceneComponent* ThighFound = nullptr;
					const USceneComponent* ShinFound = nullptr;
					for (const USceneComponent* LegPart : LegParts)
					{
						const FString LegName = LegPart != nullptr ? LegPart->GetName() : FString();
						if (LegName == FString(TEXT("Pivot_leg")) + Which)
						{
							ThighFound = LegPart;
						}
						else if (LegName == FString(TEXT("Pivot_shin")) + Which)
						{
							ShinFound = LegPart;
						}
					}
					if (ThighFound != nullptr && ShinFound != nullptr && (ThighFound->GetRelativeLocation().Y >= 0.0) == (SideSign > 0.0f))
					{
						Thigh = ThighFound;
						Shin = ShinFound;
					}
				}
				if (Thigh != nullptr && Shin != nullptr)
				{
					Hip = Thigh->GetComponentLocation();
					Knee = Shin->GetComponentLocation();
					Sole = Dog->GetCanonSoleWorld(SideSign);
					bFound = true;
				}
			}
			if (!bFound)
			{
				return false;
			}
			OutOff[Side] = static_cast<float>(WonderlandKneesOut::KneeOutOfLine(Hip, Knee, Sole, Lateral, SideSign));
			OutSole[Side] = Sole;
		}
		return true;
	}

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
		/** ST2K (round 6): each knee's offset out of its hip-to-sole line and each sole at KneesOut as found, and that value (restored). */
		float KneeOffBase[2] = { 0.0f, 0.0f };
		FVector SoleBase[2] = { FVector::ZeroVector, FVector::ZeroVector };
		FString KneesOutWas;
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
			// THE CLEAR VIEW (Second's review, 10-03: a birdbath hid the rear shots): face a heading where the front, the back and the
			// side all see the Dog unobstructed -- every shot is placed from the Dog's own forward, and it stands still until phase 20
			if (APlayerController* ViewPC = World->GetFirstPlayerController())
			{
				QaClearViewHeading(World, Dog, ViewPC);
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
			// A VISIBLE BEND (Second, 10-03, from the founder's "improve visible leg bend"): both knees bent at least 15 deg, measured
			float KneeLeft = -1.0f;
			float KneeRight = -1.0f;
			QaKneeBend(Dog, KneeLeft, KneeRight);
			float BehindLeft = -1.0f;
			float BehindRight = -1.0f;
			QaKneeBend(Dog, BehindLeft, BehindRight, true);
			const bool bOk = Dog->GetArmedStanceWeight() == 1.0f && Ahead >= 10.0f && Out >= 6.0f && Feet >= 5.0f && FMath::Abs(Sink) <= 1.5f && Lean >= 5.0f
				&& KneeLeft >= 15.0f && KneeRight >= 15.0f;
			S.Check(FString::Printf(TEXT("ST2.%d"), S.Skin + 1), bOk,
				FString::Printf(TEXT("%s armed, standing: stance weight %.3f; hands %+.1f uu forward (>= 10) and %+.1f apart (>= 6); soles %+.1f apart (>= 5), ")
					TEXT("%+.1f uu off the ground they stood on (within 1.5: the same feet); body pitch moved %.1f deg (>= 5); knees bent %.0f / %.0f deg (>= 15: a visible bend), ")
					TEXT("%.0f / %.0f deg of it seen from behind (the gameplay camera's view; reported) | %s"),
					*SkinName, Dog->GetArmedStanceWeight(), Ahead, Out, Feet, Sink, Lean, KneeLeft, KneeRight, BehindLeft, BehindRight, *QaDescribeStance(R)));
			// ST2K next (round 6): the knees turned out by a known angle on the body the player sees, then the armed frames as built
			{
				FString Whose;
				if (!QaKneesOutOfLine(Dog, S.KneeOffBase, S.SoleBase, Whose))
				{
					S.KneeOffBase[0] = S.KneeOffBase[1] = TNumericLimits<float>::Max();   // ST2K then FAILS: the legs were not found
				}
				const IConsoleVariable* KneesVar = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Handoff.Stance.KneesOut"));
				S.KneesOutWas = KneesVar != nullptr ? KneesVar->GetString() : FString(TEXT("0"));
				GEngine->Exec(World, TEXT("wl.Handoff.Stance.KneesOut 25"));
			}
			Next(7);
			return true;
		}
		case 7:
		{
			// ST2K: KneesOut 25 -- each knee OUT of its hip-to-sole line by >= 3 uu more than as found (a knee turned IN reads negative,
			// a turn that never reached the legs reads ~0: both FAIL), and each sole within 1 uu of where it stood (the foot planted).
			// Measured on the worn costume's OWN legs when a skin is worn (round 5 measured Relay OG's for every skin). Then restored.
			if (In < 0.6f)
			{
				return true;
			}
			float Off[2] = { 0.0f, 0.0f };
			FVector Sole[2];
			FString Whose;
			const bool bRead = QaKneesOutOfLine(Dog, Off, Sole, Whose);
			const float DriftPlus = bRead ? static_cast<float>(FVector::Dist(Sole[0], S.SoleBase[0])) : -1.0f;
			const float DriftMinus = bRead ? static_cast<float>(FVector::Dist(Sole[1], S.SoleBase[1])) : -1.0f;
			const bool bOk = bRead && Off[0] - S.KneeOffBase[0] >= 3.0f && Off[1] - S.KneeOffBase[1] >= 3.0f && Off[0] >= 2.0f && Off[1] >= 2.0f
				&& DriftPlus >= 0.0f && DriftPlus <= 1.0f && DriftMinus >= 0.0f && DriftMinus <= 1.0f;
			S.Check(FString::Printf(TEXT("ST2K.%d"), S.Skin + 1), bOk,
				FString::Printf(TEXT("%s, KneesOut 25 on %s: knees out of their hip-to-sole lines %+.1f / %+.1f uu (+Y / -Y leg; as found %+.1f / %+.1f; ")
					TEXT("want >= +3 more and >= +2: OUT, not in); soles moved %.2f / %.2f uu (<= 1: planted)"),
					*SkinName, *Whose, Off[0], Off[1], S.KneeOffBase[0], S.KneeOffBase[1], DriftPlus, DriftMinus));
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Handoff.Stance.KneesOut %s"), *S.KneesOutWas));
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
	/**
	 * A CLEAR VIEW FOR THE FRAMES (Second, 10-03: a birdbath in the foreground hid the gold sword in every rear frame). Turns the Dog
	 * and the player's camera to the first heading, in 30-degree steps from its own, from which the cameras behind, in front and at
	 * the side all see its chest unobstructed (a sphere swept on the visibility channel, the Dog, its costume and the companions
	 * ignored). Says which heading it chose, and says so when none was clear rather than pretending.
	 */
	float QaClearViewHeading(UWorld* World, ARelayDogCharacter* Dog, APlayerController* PC)
	{
		const FVector Chest = Dog->GetActorLocation() + FVector(0.0f, 0.0f, 30.0f);
		FCollisionQueryParams Params(FName(TEXT("WLQaView")), false);
		Params.AddIgnoredActor(Dog);
		if (AActor* Worn = Dog->GetCostume())
		{
			Params.AddIgnoredActor(Worn);
		}
		for (int32 Index = 0; Index < 2; ++Index)
		{
			if (AActor* Companion = QaCompanionBody(World, Index))
			{
				Params.AddIgnoredActor(Companion);
			}
		}
		const float BaseYaw = Dog->GetActorRotation().Yaw;
		float Chosen = BaseYaw;
		bool bClear = false;
		for (int32 Step = 0; Step < 12 && !bClear; ++Step)
		{
			const float Yaw = BaseYaw + Step * 30.0f;
			const FVector Ahead = FRotator(0.0f, Yaw, 0.0f).Vector();
			const FVector Aside = FRotator(0.0f, Yaw + 90.0f, 0.0f).Vector();
			const FVector Eyes[3] = { Chest - Ahead * 340.0f + FVector(0.0f, 0.0f, 90.0f), Chest + Ahead * 300.0f + FVector(0.0f, 0.0f, 20.0f),
				Chest + Aside * 300.0f + FVector(0.0f, 0.0f, 20.0f) };
			bool bAll = true;
			for (const FVector& Eye : Eyes)
			{
				FHitResult Hit;
				bAll &= !World->SweepSingleByChannel(Hit, Eye, Chest, FQuat::Identity, ECC_Visibility, FCollisionShape::MakeSphere(20.0f), Params);
			}
			if (bAll)
			{
				Chosen = Yaw;
				bClear = true;
			}
		}
		Dog->SetActorRotation(FRotator(0.0f, Chosen, 0.0f));
		if (PC != nullptr)
		{
			PC->SetControlRotation(FRotator(-12.0f, Chosen, 0.0f));
		}
		UE_LOG(LogWonderlandQa, Display, TEXT("WLQA view: heading %.0f (%s)"), Chosen,
			bClear ? TEXT("clear behind, in front and at the side") : TEXT("NO clear heading found; frames may be occluded"));
		return Chosen;
	}

	/** One tick of a handoff change, as the presentation DREW it (Second's continuity spec, round 4's SW5). */
	struct FQaFlowRead
	{
		EWonderlandHandoffState Shown = EWonderlandHandoffState::Idle;
		float Phase = 0.0f;
		/** The companions' drawn size against their rest (the smaller of the two; 0 hidden), and what the presentation asked for. */
		float Body = 1.0f;
		float BodyAsked = 1.0f;
		float Sword = 0.0f;
		int32 Boxes = 0;
	};

	/** A timed handoff state's length; -1 for one that waits (Idle, Held). */
	float QaFlowLength(EWonderlandHandoffState State)
	{
		switch (State)
		{
		case EWonderlandHandoffState::Acknowledged:
			return FWonderlandMissionHandoff::AcknowledgeSeconds;
		case EWonderlandHandoffState::Transforming:
			return FWonderlandMissionHandoff::TransformSeconds;
		case EWonderlandHandoffState::Delivering:
			return FWonderlandMissionHandoff::DeliverSeconds;
		case EWonderlandHandoffState::Returning:
			return FWonderlandMissionHandoff::ReturnSeconds;
		default:
			return -1.0f;
		}
	}

	FQaFlowRead QaFlowSample(const AActor* LeftBody, const AActor* RightBody, const FVector& LeftRest, const FVector& RightRest,
		const WonderlandHandoffTransform::FPresentation& Change, const WonderlandHandoffSwords::FPresentation& Swords)
	{
		FQaFlowRead Read;
		Read.Shown = Change.GetShownState();
		Read.Phase = Change.GetShownPhase();
		auto Drawn = [](const AActor* Body, const FVector& Rest)
		{
			return Body == nullptr || Body->IsHidden() || Rest.X <= KINDA_SMALL_NUMBER ? 0.0f : static_cast<float>(Body->GetActorScale3D().X / Rest.X);
		};
		Read.Body = FMath::Min(Drawn(LeftBody, LeftRest), Drawn(RightBody, RightRest));
		// the veil hides a body at 1% and never draws it smaller than 1%
		const float Asked = Change.GetPresence();
		Read.BodyAsked = Asked <= 0.01f ? 0.0f : Asked;
		Read.Sword = Swords.GetPresence();
		Read.Boxes = Swords.CountVisibleBoxes();
		return Read;
	}

	/**
	 * A CHANGE IS CONTINUOUS (Second's spec, round 5), over every tick it was sampled:
	 *   no skip -- within a state the drawn phase never advanced more than the cap in one tick (a hitch pauses the change, never skips it);
	 *   every timed state drawn AT its end before the next state was drawn (WantEnds such changes seen at least);
	 *   the companions drawn at the size the presentation asked (the veil applied exactly);
	 *   the swords' boxes never hidden while the swords are present (no despawn);
	 *   no step of the companions or the swords larger than 0.4 -- the steepest the curves take at the cap is 0.32 (the return's last third).
	 * Second's 0.15-per-frame bar is not used: at the bed's ~10 fps the designed curve itself moves 0.32 a frame. The steps are reported.
	 */
	bool QaFlowContinuous(const TArray<FQaFlowRead>& Reads, int32 WantEnds, FString& OutDetail)
	{
		int32 Skips = 0;
		int32 EndsSeen = 0;
		int32 EndsMissed = 0;
		int32 Unapplied = 0;
		int32 Despawned = 0;
		int32 Steep = 0;
		float MostPhaseStep = 0.0f;
		float MostBodyStep = 0.0f;
		float MostSwordStep = 0.0f;
		FString FirstFault;
		auto Fault = [&FirstFault](const FString& What)
		{
			if (FirstFault.IsEmpty())
			{
				FirstFault = What;
			}
		};
		for (int32 ReadIndex = 0; ReadIndex < Reads.Num(); ++ReadIndex)
		{
			const FQaFlowRead& This = Reads[ReadIndex];
			if (FMath::Abs(This.Body - This.BodyAsked) > 0.002f)
			{
				++Unapplied;
				Fault(FString::Printf(TEXT("read %d (%s %.3f s): the companions drawn at %.3f, asked %.3f"), ReadIndex, FWonderlandMissionHandoff::StateName(This.Shown),
					This.Phase, This.Body, This.BodyAsked));
			}
			if (This.Boxes == 0 && This.Sword > 0.01f)
			{
				++Despawned;
				Fault(FString::Printf(TEXT("read %d (%s %.3f s): the swords HIDDEN at %.2f of themselves"), ReadIndex, FWonderlandMissionHandoff::StateName(This.Shown),
					This.Phase, This.Sword));
			}
			if (ReadIndex == 0)
			{
				continue;
			}
			const FQaFlowRead& Was = Reads[ReadIndex - 1];
			const float BodyStep = FMath::Abs(This.Body - Was.Body);
			const float SwordStep = FMath::Abs(This.Sword - Was.Sword);
			MostBodyStep = FMath::Max(MostBodyStep, BodyStep);
			MostSwordStep = FMath::Max(MostSwordStep, SwordStep);
			if (BodyStep > 0.4f || SwordStep > 0.4f)
			{
				++Steep;
				Fault(FString::Printf(TEXT("read %d: a step of %.2f (companions) / %.2f (swords) from %s %.3f s to %s %.3f s"), ReadIndex, BodyStep, SwordStep,
					FWonderlandMissionHandoff::StateName(Was.Shown), Was.Phase, FWonderlandMissionHandoff::StateName(This.Shown), This.Phase));
			}
			if (This.Shown == Was.Shown)
			{
				const float PhaseStep = This.Phase - Was.Phase;
				MostPhaseStep = FMath::Max(MostPhaseStep, PhaseStep);
				if (PhaseStep > FWonderlandMissionHandoff::MaxPhaseStepSeconds + 0.002f)
				{
					++Skips;
					Fault(FString::Printf(TEXT("read %d: %s skipped %.3f s in one tick"), ReadIndex, FWonderlandMissionHandoff::StateName(This.Shown), PhaseStep));
				}
				continue;
			}
			const float Length = QaFlowLength(Was.Shown);
			if (Length > 0.0f)
			{
				++EndsSeen;
				if (FMath::Abs(Was.Phase - Length) > 0.002f)
				{
					++EndsMissed;
					Fault(FString::Printf(TEXT("read %d: %s last drawn at %.3f s of %.2f before %s"), ReadIndex, FWonderlandMissionHandoff::StateName(Was.Shown), Was.Phase,
						Length, FWonderlandMissionHandoff::StateName(This.Shown)));
				}
			}
		}
		OutDetail = FString::Printf(TEXT("%d reads; the drawn phase's largest step %.3f s (cap %.2f), skips %d; timed states drawn at their end %d of %d (want >= %d); ")
			TEXT("the companions drawn as asked on every read (%d off); swords hidden while present %d; the largest step of the companions %.2f and of the swords %.2f (bar 0.40)%s"),
			Reads.Num(), MostPhaseStep, FWonderlandMissionHandoff::MaxPhaseStepSeconds, Skips, EndsSeen - EndsMissed, EndsSeen, WantEnds, Unapplied, Despawned, MostBodyStep,
			MostSwordStep, FirstFault.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; first fault: %s"), *FirstFault));
		return Reads.Num() >= 5 && Skips == 0 && EndsSeen >= WantEnds && EndsMissed == 0 && Unapplied == 0 && Despawned == 0 && Steep == 0;
	}

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
		// Second's break-tests (10-03): a step within a phase, what an equip mid-return said, the Dog a travel began with
		int32 Sub = 0;
		bool bInterruptRefused = false;
		FString InterruptSaid;
		TWeakObjectPtr<ARelayDogCharacter> TravelDog;
		bool bRecoloured = false;
		// THE CONTINUITY SAMPLES (Second's spec, round 5): every tick of the equip and of the return, and when the rest began
		TArray<FQaFlowRead> EquipFlow;
		TArray<FQaFlowRead> ReturnFlow;
		float IdleAt = -1.0f;
		// SW1c (round 6, Second's finding 8): each companion's ORIGINAL body, taken by the QA itself before the equip (offset from its actor,
		// half-size), and per side over the whole transformation the most shards drawn at once, outside that body (the burst), and flown
		FVector RestOffset[2] = { FVector::ZeroVector, FVector::ZeroVector };
		FVector RestExtent[2] = { FVector::ZeroVector, FVector::ZeroVector };
		int32 ShardsMost[2] = { 0, 0 };
		int32 BurstMost[2] = { 0, 0 };
		int32 FlightMost[2] = { 0, 0 };
		bool bBreakupJudged = false;
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
			if (S.bRecoloured)
			{
				GEngine->Exec(World, TEXT("wl.Mascot.Reset"));
			}
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
		if (Dog == nullptr && World != nullptr)
		{
			// A FAR TRAVEL CAN REPLACE THE PAWN (a Dog left outside its streamed cell is destroyed and respawned): follow the new one
			Dog = QaDog(World);
			S.Dog = Dog;
		}
		FWonderlandMissionHandoff* State = QaHandoff(World);
		UWonderlandUiSubsystem* Ui = QaUi(World);
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		if (World == nullptr || State == nullptr || Ui == nullptr || PC == nullptr || (Dog == nullptr && S.Phase != 24))
		{
			QaSwordsFinish(S, TEXT("the world, the Dog, the handoff or the UI went away"));
			GQaSwords.Reset();
			return false;
		}
		if (Dog == nullptr)
		{
			// the far travel's phase waits for its Dog (and times out on its own)
			if (World->GetTimeSeconds() - S.PhaseAt < 100.0f)
			{
				return true;
			}
			QaSwordsFinish(S, TEXT("no Dog after the far travel"));
			GQaSwords.Reset();
			return false;
		}
		const float Now = World->GetTimeSeconds();
		const float In = Now - S.PhaseAt;
		auto Next = [&S, Now](int32 To)
		{
			S.Phase = To;
			S.PhaseAt = Now;
			S.Sub = 0;
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
			QaClearViewHeading(World, Dog, PC);
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
			// SW1c's reference: each companion's body as it stands BEFORE anything is drawn in (the QA's own measure, not the product's record)
			for (int32 Side = 0; Side < 2; ++Side)
			{
				const AActor* Whole = Side == 0 ? LeftBody : RightBody;
				const FBox WholeBox = Whole != nullptr ? Whole->GetComponentsBoundingBox(true) : FBox(ForceInit);
				S.RestOffset[Side] = WholeBox.IsValid ? WholeBox.GetCenter() - Whole->GetActorLocation() : FVector::ZeroVector;
				S.RestExtent[Side] = WholeBox.IsValid ? WholeBox.GetExtent() : FVector::ZeroVector;
				S.ShardsMost[Side] = 0;
				S.BurstMost[Side] = 0;
				S.FlightMost[Side] = 0;
			}
			S.bBreakupJudged = false;
			FString Said;
			if (!WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said))
			{
				S.Check(TEXT("SW1"), false, FString::Printf(TEXT("the swords could not be taken up: %s"), *Said));
				return Stop(TEXT("no handoff"));
			}
			S.bMidChecked = false;
			S.bDeliverShot = false;
			S.EquipFlow.Reset();
			Next(2);
			return true;
		}
		case 2:
		{
			// EVERY TICK OF THE EQUIP, sampled for SW1b
			S.EquipFlow.Add(QaFlowSample(LeftBody, RightBody, S.LeftScale, S.RightScale, Change, Swords));
			// SW1c: EVERY TICK of the transformation, EACH SIDE ON ITS OWN, against that companion's ORIGINAL body (Second's finding 8: SW1 compared
			// the shards with the SHRUNK body, so shards only filling the old outline passed; a speck of 0.1 uu counted; 20 of 40 across both
			// sides passed with one side dark). Drawn = >= 0.5 uu across; the BURST = drawn and outside the original body; FLOWN = outside it and
			// nearer its OWN blade than that body (>= 0.3 uu: shards shrink as they merge). The bed runs ~10 fps, so a test that needs a
			// shard ON the blade in the transformation's last few frames could miss it; "nearer the blade than the body" holds for most of the
			// gather, and a shard that never left the outline can never meet it.
			if (State->GetState() == EWonderlandHandoffState::Transforming)
			{
				for (int32 Side = 0; Side < 2; ++Side)
				{
					const UInstancedStaticMeshComponent* SideShards = Change.GetShards(Side == 0);
					const AActor* SideBody = Side == 0 ? LeftBody : RightBody;
					if (SideShards == nullptr || !SideShards->IsVisible() || SideBody == nullptr || S.RestExtent[Side].IsNearlyZero())
					{
						continue;
					}
					const FBox Original = FBox::BuildAABB(SideBody->GetActorLocation() + S.RestOffset[Side], S.RestExtent[Side] * 1.05);
					const FTransform SideSword = Swords.GetSwordWorld(Side == 0);
					const FVector BladeFrom = SideSword.TransformPosition(FVector::ZeroVector);
					const FVector BladeTo = SideSword.TransformPosition(FVector(0.0, 0.0, 100.0));
					int32 Drawn = 0;
					int32 Outside = 0;
					int32 Flown = 0;
					for (int32 Shard = 0; Shard < SideShards->GetInstanceCount(); ++Shard)
					{
						FTransform ShardXf;
						if (!SideShards->GetInstanceTransform(Shard, ShardXf, true))
						{
							continue;
						}
						const double Across = ShardXf.GetScale3D().GetAbsMax() * 100.0;   // the shard mesh is 100 uu across at scale 1
						const FVector ShardAt = ShardXf.GetLocation();
						const bool bOutside = !Original.IsInsideOrOn(ShardAt);
						Drawn += Across >= 0.5 ? 1 : 0;
						Outside += Across >= 0.5 && bOutside ? 1 : 0;
						Flown += Across >= 0.3 && bOutside
							&& FMath::PointDistToSegment(ShardAt, BladeFrom, BladeTo) < FMath::Sqrt(Original.ComputeSquaredDistanceToPoint(ShardAt)) ? 1 : 0;
					}
					S.ShardsMost[Side] = FMath::Max(S.ShardsMost[Side], Drawn);
					S.BurstMost[Side] = FMath::Max(S.BurstMost[Side], Outside);
					S.FlightMost[Side] = FMath::Max(S.FlightMost[Side], Flown);
				}
			}
			else if (S.bMidChecked && !S.bBreakupJudged)
			{
				S.bBreakupJudged = true;
				const int32 Want = WonderlandHandoffTransform::ShardsPerSide;
				const bool bBrokeUp = S.ShardsMost[0] >= Want && S.ShardsMost[1] >= Want && S.BurstMost[0] >= 6 && S.BurstMost[1] >= 6
					&& S.FlightMost[0] >= 10 && S.FlightMost[1] >= 10;
				S.Check(TEXT("SW1c"), bBrokeUp,
					FString::Printf(TEXT("the breakup over the whole transformation, each side on its own, against each companion's ORIGINAL body: gold %d drawn ")
						TEXT("at once (want %d), %d outside that body (the burst; want >= 6), %d flown, i.e. outside it and nearer its own blade than the body (want >= 10); ")
						TEXT("cyan %d / %d / %d"), S.ShardsMost[0], Want, S.BurstMost[0], S.FlightMost[0], S.ShardsMost[1], S.BurstMost[1], S.FlightMost[1]));
			}
			// SW1, HALF-WAY THROUGH THE TRANSFORMATION
			if (!S.bMidChecked && State->GetState() == EWonderlandHandoffState::Transforming
				&& State->GetPhaseSeconds() >= FWonderlandMissionHandoff::TransformSeconds * 0.5f)
			{
				const float Body = Change.GetPresence();
				const float Sword = Swords.GetPresence();
				const int32 Motes = Change.CountVisibleMotes();
				// THE BREAKUP (the founder's /handoff canon, 10-03: "luminous breakup; reformation into each sword"): both companions' light shards
				// drawn, spread wider than what is left of each body -- the body breaking up, not only shrinking
				int32 ShardsDrawn = 0;
				double SpreadLeast = TNumericLimits<double>::Max();
				for (const bool bGold : { true, false })
				{
					const UInstancedStaticMeshComponent* Shards = Change.GetShards(bGold);
					const AActor* ShardBody = bGold ? LeftBody : RightBody;
					FBox ShardBox(ForceInit);
					if (Shards != nullptr && Shards->IsVisible())
					{
						for (int32 Shard = 0; Shard < Shards->GetInstanceCount(); ++Shard)
						{
							FTransform ShardXf;
							if (Shards->GetInstanceTransform(Shard, ShardXf, true) && ShardXf.GetScale3D().GetAbsMax() > 0.001)
							{
								++ShardsDrawn;
								ShardBox += ShardXf.GetLocation();
							}
						}
					}
					const FBox BodyNow = ShardBody != nullptr ? ShardBody->GetComponentsBoundingBox(true) : FBox(ForceInit);
					SpreadLeast = FMath::Min(SpreadLeast, ShardBox.IsValid && BodyNow.IsValid && BodyNow.GetExtent().GetMax() > KINDA_SMALL_NUMBER
						? ShardBox.GetExtent().GetMax() / BodyNow.GetExtent().GetMax() : 0.0);
				}
				S.Check(TEXT("SW1"), Body > 0.1f && Body < 0.9f && Sword > 0.1f && Sword < 0.9f && FMath::Abs(Body + Sword - 1.0f) <= 0.25f && Motes > 0,
					FString::Printf(TEXT("half-way through the transformation: each companion %.2f itself, each sword %.2f formed (an exchange: both partial, ")
						TEXT("summing to %.2f), %d motes of light streaming; the breakup: %d light shards drawn (want >= %d of both sides' %d), spread %.2fx the ")
						TEXT("body left (the least side; REPORTED only: SW1c judges the breakup, per side, against the ORIGINAL body)"), Body, Sword, Body + Sword, Motes, ShardsDrawn,
						WonderlandHandoffTransform::ShardsPerSide, 2 * WonderlandHandoffTransform::ShardsPerSide, SpreadLeast >= TNumericLimits<double>::Max() ? 0.0 : SpreadLeast));
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
			FVector2D GoldScreen(0.0, 0.0);
			FVector2D CyanScreen(0.0, 0.0);
			const FVector GoldBlade = Swords.GetSwordWorld(true).TransformPosition(FVector(0.0f, 0.0f, 50.0f));
			const FVector CyanBlade = Swords.GetSwordWorld(false).TransformPosition(FVector(0.0f, 0.0f, 50.0f));
			const bool bProjected = PC->ProjectWorldLocationToScreen(GoldBlade, GoldScreen) && PC->ProjectWorldLocationToScreen(CyanBlade, CyanScreen);
			S.Check(TEXT("SW3"), bProjected && GoldScreen.X < CyanScreen.X,
				FString::Printf(TEXT("from the Dog's own camera behind it: the gold blade at x %.0f, the cyan at x %.0f (gold on the LEFT: %s)"),
					GoldScreen.X, CyanScreen.X, bProjected && GoldScreen.X < CyanScreen.X ? TEXT("yes") : TEXT("NO")));
			S.Frame(TEXT("sw_3_held_gameplay_camera_noon"));
			// SW4: THE COMPANIONS ARE THE SWORDS NOW
			// whole = every box the pair was built from is drawn (the first build's "> 300" was a guess, and the pair has 282)
			const int32 Boxes = Swords.CountVisibleBoxes();
			S.Check(TEXT("SW4"), LeftBody->IsHidden() && RightBody->IsHidden() && Change.GetPresence() == 0.0f && Swords.GetPresence() == 1.0f && Boxes > 0
				&& Boxes == Swords.GetBuiltBoxes() && Change.CountVisibleShards() == 0,
				FString::Printf(TEXT("held: the LLM Companion %s, Jhinn %s (veiled: they are the swords), the swords whole %.2f with %d of %d boxes drawn, light shards left %d"),
					LeftBody->IsHidden() ? TEXT("veiled") : TEXT("STILL SHOWN"), RightBody->IsHidden() ? TEXT("veiled") : TEXT("STILL SHOWN"), Swords.GetPresence(), Boxes,
					Swords.GetBuiltBoxes(), Change.CountVisibleShards()));
			// HD1: RELAY OG'S OWN HANDS, closed round the grips (the founder: functional hands and stable dual-grip sockets)
			S.Check(TEXT("HD1"), Dog->GetHand(true).CountVisibleBoxes() == WonderlandHands::BoxesPerHand && Dog->GetHand(false).CountVisibleBoxes() == WonderlandHands::BoxesPerHand
				&& Dog->GetHand(true).GetCurl() >= 0.9f && Dog->GetHand(false).GetCurl() >= 0.9f,
				FString::Printf(TEXT("held: Relay OG's hands drawn %d + %d boxes, fists closed %.2f / %.2f (>= 0.9)"), Dog->GetHand(true).CountVisibleBoxes(),
					Dog->GetHand(false).CountVisibleBoxes(), Dog->GetHand(true).GetCurl(), Dog->GetHand(false).GetCurl()));
			// SW1b: THE EQUIP IS CONTINUOUS, every tick from the word to the swords held (acknowledged, transforming, delivering: three ends)
			FString EquipFlowDetail;
			const bool bEquipFlow = QaFlowContinuous(S.EquipFlow, 3, EquipFlowDetail);
			S.Check(TEXT("SW1b"), bEquipFlow, FString::Printf(TEXT("the equip, every tick: %s"), *EquipFlowDetail));
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
			// SW3b, THE MIRROR TRAP (Second's H6): facing the Dog, its LEFT hand -- the gold -- is on the RIGHT of the screen
			if (S.Phase == 3 && S.Shot == 0)
			{
				FVector2D GoldFront(0.0, 0.0);
				FVector2D CyanFront(0.0, 0.0);
				const bool bSeen = PC->ProjectWorldLocationToScreen(Swords.GetSwordWorld(true).TransformPosition(FVector(0.0f, 0.0f, 50.0f)), GoldFront)
					&& PC->ProjectWorldLocationToScreen(Swords.GetSwordWorld(false).TransformPosition(FVector(0.0f, 0.0f, 50.0f)), CyanFront);
				S.Check(TEXT("SW3b"), bSeen && GoldFront.X > CyanFront.X,
					FString::Printf(TEXT("from IN FRONT of the Dog (the mirror trap): the gold blade at x %.0f, the cyan at x %.0f (gold on the screen's RIGHT, the Dog's own LEFT: %s)"),
						GoldFront.X, CyanFront.X, bSeen && GoldFront.X > CyanFront.X ? TEXT("yes") : TEXT("NO")));
			}
			S.Frame(FString::Printf(TEXT("sw_4_held_%s_%s"), S.Phase == 3 ? TEXT("noon") : TEXT("night"), SwordShots[S.Shot].Name));
			++S.Shot;
			S.PhaseAt = Now;
			return true;
		}
		case 5:
		{
			// SW5: GIVEN BACK -- and CONTINUOUSLY (Second, round 4: the companions read 0.26 and the swords whole in the frame the state ended)
			if (In < 1.0f)
			{
				return true;
			}
			if (State->IsArmed())
			{
				FString Said;
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
				S.bReturnShot = false;
				S.ReturnFlow.Reset();
				S.IdleAt = -1.0f;
			}
			S.ReturnFlow.Add(QaFlowSample(LeftBody, RightBody, S.LeftScale, S.RightScale, Change, Swords));
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
			// SAMPLED ON INTO THE REST for 0.3 s, then judged: the rest itself, and every tick that led to it
			if (S.IdleAt < 0.0f)
			{
				S.IdleAt = Now;
			}
			if (Now - S.IdleAt < 0.3f)
			{
				return true;
			}
			FString ReturnFlowDetail;
			const bool bReturnFlow = QaFlowContinuous(S.ReturnFlow, 1, ReturnFlowDetail);
			const bool bBack = !LeftBody->IsHidden() && !RightBody->IsHidden() && LeftBody->GetActorScale3D().Equals(S.LeftScale, 1.0e-4f)
				&& RightBody->GetActorScale3D().Equals(S.RightScale, 1.0e-4f) && Swords.CountVisibleBoxes() == 0 && Change.CountVisibleMotes() == 0
				&& Change.CountVisibleShards() == 0;
			S.Check(TEXT("SW5"), bBack && bReturnFlow,
				FString::Printf(TEXT("given back: the LLM Companion %s at scale %s (was %s), Jhinn %s at %s (was %s); sword boxes drawn %d, motes %d, light shards %d; the return, every tick: %s"),
					LeftBody->IsHidden() ? TEXT("HIDDEN") : TEXT("shown"), *LeftBody->GetActorScale3D().ToCompactString(), *S.LeftScale.ToCompactString(),
					RightBody->IsHidden() ? TEXT("HIDDEN") : TEXT("shown"), *RightBody->GetActorScale3D().ToCompactString(), *S.RightScale.ToCompactString(),
					Swords.CountVisibleBoxes(), Change.CountVisibleMotes(), Change.CountVisibleShards(), *ReturnFlowDetail));
			// HD2: the hands stay, and open again (functional hands: a fist only round something held)
			S.Check(TEXT("HD2"), Dog->GetHand(true).CountVisibleBoxes() == WonderlandHands::BoxesPerHand && Dog->GetHand(false).CountVisibleBoxes() == WonderlandHands::BoxesPerHand
				&& Dog->GetHand(true).GetCurl() <= 0.1f && Dog->GetHand(false).GetCurl() <= 0.1f,
				FString::Printf(TEXT("given back: Relay OG's hands drawn %d + %d boxes, open (curl %.2f / %.2f, want <= 0.1)"), Dog->GetHand(true).CountVisibleBoxes(),
					Dog->GetHand(false).CountVisibleBoxes(), Dog->GetHand(true).GetCurl(), Dog->GetHand(false).GetCurl()));
			S.Skin = 1;
			Next(6);
			return true;
		}
		case 6:
			// SW6: EVERY SKIN HOLDING BOTH SWORDS
			if (S.Skin >= Skins)
			{
				Next(20);
				return true;
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
		{
			// the SKIN'S OWN hands hold them: built on its forearms, closed into fists, each sword's grip in its fist
			const float GoldOff = FVector::Dist(Swords.GetSwordWorld(true).GetLocation(), Dog->GetHandoffGripWorld(true).GetLocation());
			const float CyanOff = FVector::Dist(Swords.GetSwordWorld(false).GetLocation(), Dog->GetHandoffGripWorld(false).GetLocation());
			const bool bHands = Dog->GetHand(true).CountVisibleBoxes() == WonderlandHands::BoxesPerHand && Dog->GetHand(false).CountVisibleBoxes() == WonderlandHands::BoxesPerHand
				&& Dog->GetHand(true).GetCurl() >= 0.9f && Dog->GetHand(false).GetCurl() >= 0.9f;
			S.Check(FString::Printf(TEXT("SW6.%d"), S.Skin + 1), Swords.CountVisibleBoxes() == Swords.GetBuiltBoxes() && Swords.GetBuiltBoxes() > 0 && Swords.GetPresence() == 1.0f
				&& bHands && GoldOff <= 1.0f && CyanOff <= 1.0f,
				FString::Printf(TEXT("%s holding both swords: %d of %d boxes drawn; its own hands %d + %d boxes, fists closed %.2f / %.2f (>= 0.9); the grips %.2f / %.2f uu ")
					TEXT("from the fists (frames judged by eye)"), FaceRoster[S.Skin], Swords.CountVisibleBoxes(), Swords.GetBuiltBoxes(), Dog->GetHand(true).CountVisibleBoxes(),
					Dog->GetHand(false).CountVisibleBoxes(), Dog->GetHand(true).GetCurl(), Dog->GetHand(false).GetCurl(), GoldOff, CyanOff));
		}
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
		case 20:
			// SECOND'S BREAK-TESTS (10-03), run here first. SW3c: Relay OG, the QA camera IN FRONT before the swords start forming
			if (S.Sub == 0)
			{
				GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
				S.Sub = 1;
			}
			QaSwordsCamera(S, World, Dog, SwordShots[0]);
			if (In < 3.0f)
			{
				return true;
			}
			{
				FString Said;
				if (!WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said))
				{
					S.Check(TEXT("SW3c.front"), false, FString::Printf(TEXT("the swords could not be taken up for the break-tests: %s"), *Said));
					return Stop(TEXT("no handoff for the break-tests"));
				}
			}
			Next(21);
			return true;
		case 21:
		{
			// SW3c: WHILE THE SWORDS FORM the pair's sides already hold -- a sword turning its face to the camera must never swap them.
			// From IN FRONT at 55% of the transformation (gold on the screen's RIGHT), then from BEHIND at 85% (gold on its LEFT)
			const bool bFront = S.Sub == 0;
			const float Through = State->GetPhaseSeconds() / FWonderlandMissionHandoff::TransformSeconds;
			QaSwordsCamera(S, World, Dog, SwordShots[bFront ? 0 : 2]);
			if (S.Sub < 2 && State->GetState() == EWonderlandHandoffState::Transforming && Through >= (bFront ? 0.55f : 0.85f))
			{
				FVector2D Gold(0.0, 0.0);
				FVector2D Cyan(0.0, 0.0);
				const bool bSeen = PC->ProjectWorldLocationToScreen(Swords.GetSwordWorld(true).GetLocation(), Gold)
					&& PC->ProjectWorldLocationToScreen(Swords.GetSwordWorld(false).GetLocation(), Cyan);
				const bool bSides = bSeen && (bFront ? Gold.X > Cyan.X : Gold.X < Cyan.X);
				S.Check(bFront ? TEXT("SW3c.front") : TEXT("SW3c.behind"), bSides && Swords.GetPresence() > 0.2f,
					FString::Printf(TEXT("forming (%.0f%% through, the swords %.2f formed), seen from %s: gold at x %.0f, cyan at x %.0f (gold on the screen's %s: %s)"),
						Through * 100.0f, Swords.GetPresence(), bFront ? TEXT("IN FRONT") : TEXT("BEHIND"), Gold.X, Cyan.X,
						bFront ? TEXT("RIGHT") : TEXT("LEFT"), bSides ? TEXT("yes") : TEXT("NO")));
				S.Frame(bFront ? TEXT("sw_7_forming_front") : TEXT("sw_7_forming_behind"));
				++S.Sub;
			}
			if (State->IsArmed() || In > 6.0f)
			{
				if (S.Sub < 2)
				{
					S.Check(S.Sub == 0 ? TEXT("SW3c.front") : TEXT("SW3c.behind"), false,
						FString::Printf(TEXT("only %d of the 2 forming views were taken before the swords were held"), S.Sub));
				}
				PC->SetViewTargetWithBlend(Dog, 0.0f);
				Next(22);
			}
			return true;
		}
		case 22:
			if (!State->IsArmed() || In < 1.5f)
			{
				return In < 10.0f ? true : Stop(TEXT("the break-test swords were never held"));
			}
			if (S.Sub == 0)
			{
				// HD3: A PRIMARY PICKED WHILE HOLDING -- the fists must take their arms' colour now, never keep the old one
				GEngine->Exec(World, TEXT("wl.Mascot.Primary #3D7BFF"));
				S.bRecoloured = true;
				S.Sub = 1;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 1.0f)
			{
				return true;
			}
			{
				const WonderlandHands::FHand& LeftHand = Dog->GetHand(true);
				const WonderlandHands::FHand& RightHand = Dog->GetHand(false);
				const bool bLeftWorn = LeftHand.GetWornMaterial() != nullptr && LeftHand.WearsItsArmsMaterial();
				const bool bRightWorn = RightHand.GetWornMaterial() != nullptr && RightHand.WearsItsArmsMaterial();
				S.Check(TEXT("HD3"), bLeftWorn && bRightWorn && LeftHand.GetCurl() >= 0.9f && RightHand.GetCurl() >= 0.9f,
					FString::Printf(TEXT("a primary picked while holding: each fist wears its arm's own material now (LEFT %s, RIGHT %s), still closed %.2f / %.2f ")
						TEXT("(the colour is judged on the frame)"), bLeftWorn ? TEXT("yes") : TEXT("NO"), bRightWorn ? TEXT("yes") : TEXT("NO"), LeftHand.GetCurl(), RightHand.GetCurl()));
				S.Frame(TEXT("sw_8_recoloured_held"));
			}
			Next(23);
			return true;
		case 23:
			if (S.Sub == 0)
			{
				// RP1: ANOTHER SKIN WORN WHILE HOLDING -- the old forearms go with the old body; the swords must move to the new ones
				GEngine->Exec(World, TEXT("wl.Skins.Wear celestial_light"));
				S.Sub = 1;
				return true;
			}
			if (In < 3.0f)
			{
				return true;
			}
			{
				const USceneComponent* LeftArm = Dog->GetVisibleForearm(true);
				const USceneComponent* RightArm = Dog->GetVisibleForearm(false);
				const bool bOnArms = LeftArm != nullptr && RightArm != nullptr && LeftArm->GetOwner() != Dog && Swords.GetHeldBy(true) == LeftArm
					&& Swords.GetHeldBy(false) == RightArm;
				const float GoldOff = FVector::Dist(Swords.GetSwordWorld(true).GetLocation(), Dog->GetHandoffGripWorld(true).GetLocation());
				const float CyanOff = FVector::Dist(Swords.GetSwordWorld(false).GetLocation(), Dog->GetHandoffGripWorld(false).GetLocation());
				const WonderlandHands::FHand& LeftHand = Dog->GetHand(true);
				const WonderlandHands::FHand& RightHand = Dog->GetHand(false);
				const bool bHands = LeftHand.IsOn(LeftArm) && RightHand.IsOn(RightArm) && LeftHand.GetCurl() >= 0.9f && RightHand.GetCurl() >= 0.9f
					&& LeftHand.WearsItsArmsMaterial() && RightHand.WearsItsArmsMaterial();
				S.Check(TEXT("RP1"), State->IsArmed() && bOnArms && bHands && GoldOff <= 1.0f && CyanOff <= 1.0f && Swords.CountVisibleBoxes() == Swords.GetBuiltBoxes(),
					FString::Printf(TEXT("a skin worn while holding: the swords hang from the new skin's own forearms (%s), its own fists closed %.2f / %.2f in its own material (%s), ")
						TEXT("the grips %.2f / %.2f uu from them, %d of %d boxes drawn"), bOnArms ? TEXT("yes") : TEXT("NO"), LeftHand.GetCurl(), RightHand.GetCurl(),
						bHands ? TEXT("yes") : TEXT("NO"), GoldOff, CyanOff, Swords.CountVisibleBoxes(), Swords.GetBuiltBoxes()));
				S.Frame(TEXT("sw_9_skin_changed_held"));
			}
			Next(24);
			return true;
		case 24:
		{
			// RP2: A FAR TRAVEL WHILE HOLDING (Second: the Dog-dies-outside-its-cell trap). Survived or replaced, the Dog at the other end
			// must hold the swords in its own hands, the companions still veiled
			UWonderlandTravelSubsystem* Travel = QaTravel(World);
			if (S.Sub == 0)
			{
				FText Refusal;
				S.TravelDog = Dog;
				if (Travel == nullptr || !Travel->RequestTravel(TEXT("noctis_heartland_west"), Refusal))
				{
					S.Check(TEXT("RP2"), false, FString::Printf(TEXT("a far travel while holding was refused: %s"),
						Travel == nullptr ? TEXT("no travel subsystem") : *Refusal.ToString()));
					Next(26);
					return true;
				}
				S.Sub = 1;
				return true;
			}
			if (S.Sub == 1)
			{
				if (Travel != nullptr && Travel->IsTravelling() && In < 100.0f)
				{
					return true;
				}
				S.Sub = 2;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 3.0f)
			{
				return true;
			}
			{
				const bool bSameDog = S.TravelDog.IsValid() && S.TravelDog.Get() == Dog;
				const USceneComponent* LeftArm = Dog->GetVisibleForearm(true);
				const USceneComponent* RightArm = Dog->GetVisibleForearm(false);
				const bool bOnArms = LeftArm != nullptr && RightArm != nullptr && Swords.GetHeldBy(true) == LeftArm && Swords.GetHeldBy(false) == RightArm;
				const float GoldOff = FVector::Dist(Swords.GetSwordWorld(true).GetLocation(), Dog->GetHandoffGripWorld(true).GetLocation());
				const float CyanOff = FVector::Dist(Swords.GetSwordWorld(false).GetLocation(), Dog->GetHandoffGripWorld(false).GetLocation());
				const bool bVeiled = LeftBody != nullptr && RightBody != nullptr && LeftBody->IsHidden() && RightBody->IsHidden();
				S.Check(TEXT("RP2"), State->IsArmed() && bOnArms && GoldOff <= 1.0f && CyanOff <= 1.0f && Swords.CountVisibleBoxes() == Swords.GetBuiltBoxes()
					&& Swords.GetBuiltBoxes() > 0 && bVeiled,
					FString::Printf(TEXT("after a far travel while holding (the Dog %s; %s): held %s, the swords in its own hands %s, the grips %.2f / %.2f uu, %d of %d boxes ")
						TEXT("drawn, the companions veiled %s"), bSameDog ? TEXT("survived") : TEXT("was REPLACED"),
						Travel != nullptr ? *Travel->GetLastTravelReport() : TEXT("no report"), State->IsArmed() ? TEXT("yes") : TEXT("NO"),
						bOnArms ? TEXT("yes") : TEXT("NO"), GoldOff, CyanOff, Swords.CountVisibleBoxes(), Swords.GetBuiltBoxes(), bVeiled ? TEXT("yes") : TEXT("NO")));
				S.Frame(TEXT("sw_10_after_far_travel_held"));
			}
			Next(26);
			return true;
		}
		case 26:
			// HD4: A RETURN INTERRUPTED -- an equip asked for while the swords go back (either entry) is refused, the handoff still being
			// active; the return finishes, and no fist stays closed on nothing
			if (S.Sub == 0)
			{
				if (!State->IsArmed())
				{
					if (!State->IsEquipped())
					{
						FString Said;
						WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
					}
					return In < 12.0f ? true : Stop(TEXT("HD4: no swords held to give back"));
				}
				FString Said;
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
				S.Sub = 1;
				return true;
			}
			if (S.Sub == 1)
			{
				if (State->GetState() == EWonderlandHandoffState::Returning && State->GetPhaseSeconds() >= 0.3f)
				{
					FString Said;
					S.bInterruptRefused = !WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
					S.InterruptSaid = Said;
					S.Sub = 2;
				}
				return In < 16.0f ? true : Stop(TEXT("HD4: the return never got under way"));
			}
			if (State->IsEquipped())
			{
				return In < 20.0f ? true : Stop(TEXT("HD4: the swords were never given back"));
			}
			if (S.Sub == 2)
			{
				S.Sub = 3;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 1.0f)
			{
				return true;
			}
			S.Check(TEXT("HD4"), S.bInterruptRefused && Dog->GetHand(true).GetCurl() <= 0.1f && Dog->GetHand(false).GetCurl() <= 0.1f && Swords.CountVisibleBoxes() == 0,
				FString::Printf(TEXT("an equip asked for mid-return was %s ('%s'); the return finished: fists open %.2f / %.2f (want <= 0.1), sword boxes drawn %d"),
					S.bInterruptRefused ? TEXT("refused") : TEXT("ACCEPTED"), *S.InterruptSaid, Dog->GetHand(true).GetCurl(), Dog->GetHand(false).GetCurl(),
					Swords.CountVisibleBoxes()));
			Next(27);
			return true;
		case 27:
			// HD5: A SKIN WORN WHILE THE SWORDS GO BACK -- the new body's own hands must end open too
			if (S.Sub == 0)
			{
				if (!State->IsEquipped())
				{
					FString Said;
					WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
				}
				S.Sub = 1;
				return true;
			}
			if (S.Sub == 1)
			{
				if (!State->IsArmed() || In < 4.6f)
				{
					return In < 12.0f ? true : Stop(TEXT("HD5: the swords were never held"));
				}
				FString Said;
				WonderlandHandoffDirector::Return(QaLocalPlayer(World), Said);
				S.Sub = 2;
				return true;
			}
			if (S.Sub == 2)
			{
				if (State->GetState() == EWonderlandHandoffState::Returning && State->GetPhaseSeconds() >= 0.3f)
				{
					GEngine->Exec(World, TEXT("wl.Skins.Wear jack_flame"));
					S.Sub = 3;
				}
				return In < 16.0f ? true : Stop(TEXT("HD5: the return never got under way"));
			}
			if (State->IsEquipped())
			{
				return In < 20.0f ? true : Stop(TEXT("HD5: the swords were never given back"));
			}
			if (S.Sub == 3)
			{
				S.Sub = 4;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 3.0f)
			{
				return true;
			}
			{
				const USceneComponent* LeftArm = Dog->GetVisibleForearm(true);
				const USceneComponent* RightArm = Dog->GetVisibleForearm(false);
				const WonderlandHands::FHand& LeftHand = Dog->GetHand(true);
				const WonderlandHands::FHand& RightHand = Dog->GetHand(false);
				const bool bNewHands = LeftArm != nullptr && RightArm != nullptr && LeftArm->GetOwner() != Dog && LeftHand.IsOn(LeftArm) && RightHand.IsOn(RightArm);
				S.Check(TEXT("HD5"), bNewHands && LeftHand.GetCurl() <= 0.1f && RightHand.GetCurl() <= 0.1f && LeftHand.CountVisibleBoxes() == WonderlandHands::BoxesPerHand
					&& RightHand.CountVisibleBoxes() == WonderlandHands::BoxesPerHand,
					FString::Printf(TEXT("a skin worn mid-return: the new skin's own hands (%s), drawn %d + %d boxes, open %.2f / %.2f (want <= 0.1)"),
						bNewHands ? TEXT("yes") : TEXT("NO"), LeftHand.CountVisibleBoxes(), RightHand.CountVisibleBoxes(), LeftHand.GetCurl(), RightHand.GetCurl()));
				S.Frame(TEXT("sw_11_skin_changed_mid_return"));
			}
			return Stop(nullptr);
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	/* ================================================================ wl.Qa.StanceCalib: the stance and the V, judged on frames
	 * The founder's stance sheet (checks 1-2): grounded and wide, the arms out and down, the blades angled OUT and UP around the
	 * body -- never along it, across it or into the ground. Second read the first M6 frames: from the gameplay camera the blades
	 * could show as glints at the feet. One boot, swords held on Relay OG, four presets set through the live CVars:
	 *   P0 BEFORE (the forearm grip, the old stance), P1 the new defaults, P2 wider, P3 narrower.
	 * Each: the player's own camera behind, a front and a side frame; P0 and P1 also running, from behind. Measured on the camera
	 * behind: each blade's tip above its own fist by a share of the body's height on screen, and outside the body's edge on its own
	 * side (gold on the screen's LEFT). SC1 asserts it for P1, the defaults; the other presets are logged for the judgement.
	 * Frames to Saved/Screenshots/WLSTANCE. WLSCQA lines.
	 */
	struct FQaStanceCalib
	{
		TWeakObjectPtr<UWorld> World;
		TWeakObjectPtr<ACameraActor> Camera;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		int32 Preset = 0;
		int32 Shot = 0;
		double PhaseAt = 0.0;
		FString Dir;
		// THE SAME PLACE FOR EVERY PRESET (round 2's presets were shot where the last run ended -- a pillar, tree shade -- so the
		// comparison mixed the pose with the place and the light): where the clear view was found, and its heading
		FVector Start = FVector::ZeroVector;
		float StartYaw = 0.0f;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSCQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
		void Frame(const FString& Name)
		{
			int32 Width = 0;
			int32 Height = 0;
			const FString Path = Dir / (Name + TEXT(".png"));
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSCQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
		}
	};
	TSharedPtr<FQaStanceCalib> GQaStanceCalib;

	struct FQaStancePreset
	{
		const TCHAR* Name;
		const TCHAR* Commands;
	};

	const FQaStancePreset StancePresets[] = {
		{ TEXT("P0_before"), TEXT("wl.Handoff.SwordBodyV 0;wl.Handoff.Stance.Out 18;wl.Handoff.Stance.Shoulder 22;wl.Handoff.Stance.Elbow 50;wl.Handoff.Stance.FeetOut 6;wl.Handoff.Stance.Crouch 2;wl.Handoff.Stance.RunOut 16") },
		// index 1 is THE DEFAULT (SC1/SC2 measure it): P2 canonical (the founder, 10-03) -- its V and arms-out -- with readiness and legs
		// improved as the founder asked (round 3b's ST2 read the P2 hands only +8.7 uu forward); index 2 is P2 as round 3b built it
		{ TEXT("P1_ready_default"), TEXT("wl.Handoff.SwordBodyV 1;wl.Handoff.SwordV 42;wl.Handoff.SwordVForward 12;wl.Handoff.Stance.Out 44;wl.Handoff.Stance.Shoulder 12;wl.Handoff.Stance.Elbow 25;wl.Handoff.Stance.FeetOut 19;wl.Handoff.Stance.Crouch 10;wl.Handoff.Stance.RunOut 32") },
		{ TEXT("P2_round3b"), TEXT("wl.Handoff.SwordBodyV 1;wl.Handoff.SwordV 42;wl.Handoff.SwordVForward 12;wl.Handoff.Stance.Out 44;wl.Handoff.Stance.Shoulder 10;wl.Handoff.Stance.Elbow 22;wl.Handoff.Stance.FeetOut 16;wl.Handoff.Stance.Crouch 7;wl.Handoff.Stance.RunOut 32") },
		{ TEXT("P3_narrower"), TEXT("wl.Handoff.SwordBodyV 1;wl.Handoff.SwordV 24;wl.Handoff.SwordVForward 24;wl.Handoff.Stance.Out 26;wl.Handoff.Stance.Shoulder 18;wl.Handoff.Stance.Elbow 34;wl.Handoff.Stance.FeetOut 10;wl.Handoff.Stance.Crouch 5;wl.Handoff.Stance.RunOut 20") },
		// THE LEGS FOR THE FOUNDER TO PICK (Second, 10-03: round 4's knees read as straight). The knees DID bend (~58 deg at crouch 8 on a
		// 48-uu leg) but in a plane facing forward, which the gameplay camera behind the Dog barely sees. So: today's look, then the knees
		// turned out over the toes (wl.Handoff.Stance.KneesOut) with the feet a little wider -- framed BEHIND and at the SIDE from knee
		// height, each with the true knee bend and the bend seen from behind, measured
		{ TEXT("L1_crouch10_feet19_knees0"), TEXT("wl.Handoff.SwordBodyV 1;wl.Handoff.SwordV 42;wl.Handoff.SwordVForward 12;wl.Handoff.Stance.Out 44;wl.Handoff.Stance.Shoulder 12;wl.Handoff.Stance.Elbow 25;wl.Handoff.Stance.FeetOut 19;wl.Handoff.Stance.Crouch 10;wl.Handoff.Stance.KneesOut 0;wl.Handoff.Stance.RunOut 32") },
		{ TEXT("L2_crouch8_feet22_knees20"), TEXT("wl.Handoff.SwordBodyV 1;wl.Handoff.SwordV 42;wl.Handoff.SwordVForward 12;wl.Handoff.Stance.Out 44;wl.Handoff.Stance.Shoulder 12;wl.Handoff.Stance.Elbow 25;wl.Handoff.Stance.FeetOut 22;wl.Handoff.Stance.Crouch 8;wl.Handoff.Stance.KneesOut 20;wl.Handoff.Stance.RunOut 32") },
		{ TEXT("L3_crouch10_feet24_knees30"), TEXT("wl.Handoff.SwordBodyV 1;wl.Handoff.SwordV 42;wl.Handoff.SwordVForward 12;wl.Handoff.Stance.Out 44;wl.Handoff.Stance.Shoulder 12;wl.Handoff.Stance.Elbow 25;wl.Handoff.Stance.FeetOut 24;wl.Handoff.Stance.Crouch 10;wl.Handoff.Stance.KneesOut 30;wl.Handoff.Stance.RunOut 32") },
		{ TEXT("L4_crouch12_feet26_knees40"), TEXT("wl.Handoff.SwordBodyV 1;wl.Handoff.SwordV 42;wl.Handoff.SwordVForward 12;wl.Handoff.Stance.Out 44;wl.Handoff.Stance.Shoulder 12;wl.Handoff.Stance.Elbow 25;wl.Handoff.Stance.FeetOut 26;wl.Handoff.Stance.Crouch 12;wl.Handoff.Stance.KneesOut 40;wl.Handoff.Stance.RunOut 32") },
	};

	void QaStanceApply(UWorld* World, const TCHAR* Commands)
	{
		TArray<FString> Each;
		FString(Commands).ParseIntoArray(Each, TEXT(";"), true);
		for (const FString& Command : Each)
		{
			GEngine->Exec(World, *Command);
		}
	}

	/** On the camera now: each tip's rise above its fist (share of the body's screen height) and its distance outside the body's edge
	 *  on its own side, px (positive = outside). From behind the Dog's left is the screen's left; in front it is mirrored. */
	FString QaStanceMeasure(APlayerController* PC, ARelayDogCharacter* Dog, bool bFromFront, bool& bOutV)
	{
		const WonderlandHandoffSwords::FPresentation& Swords = Dog->GetHandoffSwords();
		const UCapsuleComponent* Capsule = Dog->GetCapsuleComponent();
		const float Half = Capsule != nullptr ? Capsule->GetScaledCapsuleHalfHeight() : 90.0f;
		const float Radius = Capsule != nullptr ? Capsule->GetScaledCapsuleRadius() : 40.0f;
		const FVector At = Dog->GetActorLocation();
		const FVector Right = Dog->GetActorRightVector();
		FVector2D Top(0.0, 0.0), Bottom(0.0, 0.0), LeftEdge(0.0, 0.0), RightEdge(0.0, 0.0);
		bool bSeen = PC->ProjectWorldLocationToScreen(At + FVector(0.0f, 0.0f, Half), Top) && PC->ProjectWorldLocationToScreen(At - FVector(0.0f, 0.0f, Half), Bottom)
			&& PC->ProjectWorldLocationToScreen(At - Right * Radius, LeftEdge) && PC->ProjectWorldLocationToScreen(At + Right * Radius, RightEdge);
		const double BodyH = FMath::Max(FMath::Abs(Bottom.Y - Top.Y), 1.0);
		double Rise[2] = { 0.0, 0.0 };
		double Outside[2] = { 0.0, 0.0 };
		for (int32 Side = 0; Side < 2; ++Side)
		{
			const bool bGold = Side == 0;
			const FTransform Blade = Swords.GetSwordWorld(bGold);
			FVector2D Tip(0.0, 0.0), Grip(0.0, 0.0);
			bSeen &= PC->ProjectWorldLocationToScreen(Blade.TransformPosition(FVector(0.0f, 0.0f, WonderlandHandoffSwords::TipZ)), Tip)
				&& PC->ProjectWorldLocationToScreen(Blade.GetLocation(), Grip);
			Rise[Side] = (Grip.Y - Tip.Y) / BodyH;
			// the Dog's own left edge is LeftEdge (its -Y); from behind it is on the screen's left, from in front on the right
			const FVector2D& Edge = bGold ? LeftEdge : RightEdge;
			const bool bEdgeIsScreenLeft = (Edge.X < (bGold ? RightEdge.X : LeftEdge.X));
			Outside[Side] = bEdgeIsScreenLeft ? Edge.X - Tip.X : Tip.X - Edge.X;
		}
		bOutV = bSeen && Rise[0] >= 0.20 && Rise[1] >= 0.20 && Outside[0] >= 0.0 && Outside[1] >= 0.0;
		return FString::Printf(TEXT("%s: gold tip %+.0f%% of the body's height above its fist, %+.0f px outside the body's left edge; cyan %+.0f%%, %+.0f px outside its right edge"),
			bFromFront ? TEXT("in front") : TEXT("behind"), Rise[0] * 100.0, Outside[0], Rise[1] * 100.0, Outside[1]);
	}

	bool QaStanceCalibTick(float)
	{
		if (!GQaStanceCalib.IsValid())
		{
			return false;
		}
		FQaStanceCalib& S = *GQaStanceCalib;
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = QaDog(World);
		FWonderlandMissionHandoff* Handoff = QaHandoff(World);
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		auto Stop = [&S](const TCHAR* Why)
		{
			if (UWorld* W = S.World.Get())
			{
				// the defaults back, the swords given back, the player's own camera
				QaStanceApply(W, StancePresets[1].Commands);
				if (FWonderlandMissionHandoff* H = QaHandoff(W))
				{
					FString Ignored;
					H->Return(Ignored);
				}
				if (APlayerController* P = W->GetFirstPlayerController())
				{
					if (ARelayDogCharacter* D = QaDog(W))
					{
						P->SetViewTargetWithBlend(D, 0.0f);
					}
				}
			}
			if (ACameraActor* Cam = S.Camera.Get())
			{
				Cam->Destroy();
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSCQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
			const bool bQuit = S.bQuit;
			GQaStanceCalib.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Dog == nullptr || Handoff == nullptr || PC == nullptr)
		{
			return Stop(TEXT("the world, the Dog or the handoff went away"));
		}
		const double Now = QaNow();
		const double In = Now - S.PhaseAt;
		const int32 Presets = static_cast<int32>(UE_ARRAY_COUNT(StancePresets));
		switch (S.Phase)
		{
		case 0:
			if (UWonderlandUiSubsystem* Ui = QaUi(World))
			{
				if (Ui->IsWelcomeOpen())
				{
					Ui->DismissWelcome();
				}
			}
			if (In < 4.0 || !Dog->GetCharacterMovement()->IsMovingOnGround())
			{
				return In < 40.0 ? true : Stop(TEXT("never ready"));
			}
			GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
			GEngine->Exec(World, TEXT("wl.Sky.Hour 12"));
			if (!Handoff->IsEquipped())
			{
				FString Said;
				WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
			}
			S.Phase = 1;
			S.PhaseAt = Now;
			return true;
		case 1:
			if (!Handoff->IsArmed())
			{
				return In < 12.0 ? true : Stop(TEXT("the swords were never held"));
			}
			S.Preset = 0;
			S.Shot = 0;
			S.StartYaw = QaClearViewHeading(World, Dog, PC);
			S.Start = Dog->GetActorLocation();
			QaStanceApply(World, StancePresets[0].Commands);
			S.Phase = 2;
			S.PhaseAt = Now;
			return true;
		case 2:
		{
			// ONE PRESET: settle, then behind (the player's own camera), in front, at the side; P0 and P1 also running from behind
			const FQaStancePreset& Preset = StancePresets[S.Preset];
			const bool bRun = S.Preset <= 1;
			// a LEG preset (L*): in front and at the side, from knee height
			const bool bLegs = Preset.Name[0] == TEXT('L');
			const int32 Shots = bLegs ? 2 : (bRun ? 4 : 3);
			if (S.Shot >= Shots)
			{
				Dog->QaWalkKey(false);
				// back to the start (a short hop on the same streamed ground), the same heading, the camera behind it
				Dog->SetActorLocation(S.Start, false, nullptr, ETeleportType::TeleportPhysics);
				Dog->SetActorRotation(FRotator(0.0f, S.StartYaw, 0.0f));
				PC->SetControlRotation(FRotator(-12.0f, S.StartYaw, 0.0f));
				if (UCharacterMovementComponent* Move = Dog->GetCharacterMovement())
				{
					Move->StopMovementImmediately();
				}
				if (++S.Preset >= Presets)
				{
					return Stop(nullptr);
				}
				QaStanceApply(World, StancePresets[S.Preset].Commands);
				S.Shot = 0;
				S.PhaseAt = Now;
				return true;
			}
			if (bLegs)
			{
				FQaStance Shim;
				Shim.Camera = S.Camera;
				// 160 uu off, the camera 60 uu below the body's middle: at the knees -- BEHIND (where the player's camera is) and at the side
				QaStanceCamera(Shim, World, Dog, S.Shot == 0 ? 180.0 : 90.0, 160.0, -60.0, 45.0f);
				S.Camera = Shim.Camera;
				if (In < 1.2)
				{
					return true;
				}
				float KneeLeft = -1.0f;
				float KneeRight = -1.0f;
				QaKneeBend(Dog, KneeLeft, KneeRight);
				float BehindLeft = -1.0f;
				float BehindRight = -1.0f;
				QaKneeBend(Dog, BehindLeft, BehindRight, true);
				static const TCHAR* const KneeShots[] = { TEXT("behind_knee"), TEXT("side_knee") };
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSCQA %s %s | knees bent %.0f / %.0f deg, %.0f / %.0f deg of it seen from behind; stance weight %.2f"), Preset.Name,
					KneeShots[S.Shot], KneeLeft, KneeRight, BehindLeft, BehindRight, Dog->GetArmedStanceWeight());
				S.Frame(FString::Printf(TEXT("stance_%s_%s"), Preset.Name, KneeShots[S.Shot]));
				++S.Shot;
				S.PhaseAt = Now;
				return true;
			}
			if (S.Shot == 0 || S.Shot == 3)
			{
				PC->SetViewTargetWithBlend(Dog, 0.0f);
				if (S.Shot == 3)
				{
					// running with the swords held, the player's camera behind: forward input every tick
					Dog->AddMovementInput(Dog->GetActorForwardVector(), 1.0f);
				}
			}
			else
			{
				FQaStance Shim;
				Shim.Camera = S.Camera;
				QaStanceCamera(Shim, World, Dog, S.Shot == 1 ? 0.0 : 90.0, 300.0, 40.0, 50.0f);
				S.Camera = Shim.Camera;
			}
			if (In < (S.Shot == 0 ? 2.2 : (S.Shot == 3 ? 2.0 : 1.2)))
			{
				return true;
			}
			static const TCHAR* const ShotNames[] = { TEXT("behind"), TEXT("front"), TEXT("side"), TEXT("running_behind") };
			if (S.Shot == 0 || S.Shot == 1)
			{
				bool bV = false;
				const FString Reading = QaStanceMeasure(PC, Dog, S.Shot == 1, bV);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLSCQA %s %s | %s"), Preset.Name, ShotNames[S.Shot], *Reading);
				if (S.Preset == 1 && S.Shot == 0)
				{
					S.Check(TEXT("SC1"), bV, FString::Printf(TEXT("the defaults, the player's own camera behind, held and standing: both blades rise above their fists (>= 20%% of the body) and stand outside the body on their own sides -- %s"), *Reading));
				}
				if (S.Preset == 1 && S.Shot == 1)
				{
					S.Check(TEXT("SC2"), bV, FString::Printf(TEXT("the defaults, in front (mirrored: gold on the screen's RIGHT): the V holds -- %s"), *Reading));
				}
			}
			S.Frame(FString::Printf(TEXT("stance_%s_%s"), Preset.Name, ShotNames[S.Shot]));
			++S.Shot;
			S.PhaseAt = Now;
			return true;
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaStanceCalibCommand(
		TEXT("wl.Qa.StanceCalib"),
		TEXT("The stance and the V around the body, judged on frames: swords held on Relay OG under four presets (P0 before, P1 the ")
		TEXT("defaults, P2 wider, P3 narrower) -- behind, in front, at the side, and running. SC1/SC2 measure the defaults' V. Frames to ")
		TEXT("Saved/Screenshots/WLSTANCE. `quit` exits after. WLSCQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaStanceCalib.IsValid() || World == nullptr)
			{
				return;
			}
			GQaStanceCalib = MakeShared<FQaStanceCalib>();
			GQaStanceCalib->World = World;
			GQaStanceCalib->bQuit = Args.Contains(TEXT("quit"));
			GQaStanceCalib->PhaseAt = QaNow();
			GQaStanceCalib->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSTANCE"));
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSCQA BEGIN | %s"), *WonderlandBeta::BuildLabel());
			GQaStanceCalib->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaStanceCalibTick), 0.0f);
		}));

	/* ================================================================ box geometry for the QAs (wl.Qa.DashTrails, wl.Qa.SwordClip)
	 * Every QA here measures what is DRAWN: an instanced mesh's instances, or a mesh, as oriented boxes from the mesh's own bounds.
	 */
	/** An oriented box in the world: its centre, unit axes, half sizes, the half size of its world-aligned bounds, and whose it is. */
	struct FQaObb
	{
		const USceneComponent* Mesh = nullptr;
		int32 Instance = INDEX_NONE;
		FVector Centre = FVector::ZeroVector;
		FVector Axis[3] = { FVector::ForwardVector, FVector::RightVector, FVector::UpVector };
		FVector Half = FVector::ZeroVector;
		FVector Reach = FVector::ZeroVector;
	};

	/** The box a unit cube's [-50, 50]^3 becomes under UnitToWorld (built from a mesh's own bounds: no rotation in the child, so no shear). */
	FQaObb QaObb(const USceneComponent* Mesh, int32 Instance, const FTransform& UnitToWorld)
	{
		FQaObb Box;
		Box.Mesh = Mesh;
		Box.Instance = Instance;
		Box.Centre = UnitToWorld.GetTranslation();
		const FQuat Turn = UnitToWorld.GetRotation();
		Box.Axis[0] = Turn.GetAxisX();
		Box.Axis[1] = Turn.GetAxisY();
		Box.Axis[2] = Turn.GetAxisZ();
		Box.Half = UnitToWorld.GetScale3D().GetAbs() * 50.0;
		for (int32 K = 0; K < 3; ++K)
		{
			Box.Reach[K] = Box.Half.X * FMath::Abs(Box.Axis[0][K]) + Box.Half.Y * FMath::Abs(Box.Axis[1][K]) + Box.Half.Z * FMath::Abs(Box.Axis[2][K]);
		}
		return Box;
	}

	/** How deep two boxes overlap, in uu: the distance that would push them apart, the least over the 15 separating axes; 0 when apart. */
	double QaObbDepth(const FQaObb& A, const FQaObb& B)
	{
		const FVector Between = B.Centre - A.Centre;
		for (int32 K = 0; K < 3; ++K)
		{
			if (FMath::Abs(Between[K]) >= A.Reach[K] + B.Reach[K])
			{
				return 0.0;
			}
		}
		double Depth = TNumericLimits<double>::Max();
		auto Along = [&A, &B, &Between, &Depth](const FVector& Raw)
		{
			const double Size = Raw.Size();
			if (Size < 1e-6)
			{
				return true;
			}
			const FVector AxisN = Raw / Size;
			const double RA = A.Half.X * FMath::Abs(FVector::DotProduct(A.Axis[0], AxisN)) + A.Half.Y * FMath::Abs(FVector::DotProduct(A.Axis[1], AxisN))
				+ A.Half.Z * FMath::Abs(FVector::DotProduct(A.Axis[2], AxisN));
			const double RB = B.Half.X * FMath::Abs(FVector::DotProduct(B.Axis[0], AxisN)) + B.Half.Y * FMath::Abs(FVector::DotProduct(B.Axis[1], AxisN))
				+ B.Half.Z * FMath::Abs(FVector::DotProduct(B.Axis[2], AxisN));
			const double Overlap = RA + RB - FMath::Abs(FVector::DotProduct(Between, AxisN));
			Depth = FMath::Min(Depth, Overlap);
			return Overlap > 0.0;
		};
		for (int32 I = 0; I < 3; ++I)
		{
			if (!Along(A.Axis[I]) || !Along(B.Axis[I]))
			{
				return 0.0;
			}
		}
		for (int32 I = 0; I < 3; ++I)
		{
			for (int32 J = 0; J < 3; ++J)
			{
				if (!Along(FVector::CrossProduct(A.Axis[I], B.Axis[J])))
				{
					return 0.0;
				}
			}
		}
		return Depth;
	}

	/** A mesh's boxes in the world: each instance of an instanced mesh, or the mesh itself -- its own bounds as a unit cube's. */
	void QaMeshObbs(const UStaticMeshComponent* Mesh, TArray<FQaObb>& Out)
	{
		const FBoxSphereBounds Local = Mesh->GetStaticMesh()->GetBounds();
		const FTransform Unit(FQuat::Identity, Local.Origin, Local.BoxExtent * 2.0 / 100.0);
		const UInstancedStaticMeshComponent* Instanced = Cast<UInstancedStaticMeshComponent>(Mesh);
		if (Instanced == nullptr)
		{
			Out.Add(QaObb(Mesh, INDEX_NONE, Unit * Mesh->GetComponentTransform()));
			return;
		}
		for (int32 Instance = 0; Instance < Instanced->GetInstanceCount(); ++Instance)
		{
			FTransform InstanceWorld;
			if (Instanced->GetInstanceTransform(Instance, InstanceWorld, true))
			{
				Out.Add(QaObb(Mesh, Instance, Unit * InstanceWorld));
			}
		}
	}

	/**
	 * A box's area on screen (px^2) and its centre's x, as drawn: the box clipped at the camera's near plane (the corners in front,
	 * and where each of its 12 edges crosses the plane), projected, the convex hull of those points (a convex body in front of the
	 * camera projects to the hull of its vertices), clipped to the frame (Sutherland-Hodgman), by the shoelace formula. Validated in
	 * Python against rays cast through random pixels: 400 boxes in front of, around and behind the camera, no area beyond 4 sigma,
	 * no centre off by 25 px. OutFailed counts points in front of the camera that the view still refused to project.
	 */
	double QaBoxScreenArea(APlayerController* PC, const FQaObb& Box, const FVector& CamLoc, const FVector& CamFwd, const FVector2D& Size,
		double& OutCentreX, int32& OutFailed)
	{
		constexpr double NearUU = 10.0;
		OutCentreX = 0.0;
		FVector Corners[8];
		double Ahead[8];
		const double Plane = FVector::DotProduct(CamFwd, CamLoc) + NearUU;
		for (int32 Corner = 0; Corner < 8; ++Corner)
		{
			Corners[Corner] = Box.Centre
				+ Box.Axis[0] * ((Corner & 1) ? Box.Half.X : -Box.Half.X)
				+ Box.Axis[1] * ((Corner & 2) ? Box.Half.Y : -Box.Half.Y)
				+ Box.Axis[2] * ((Corner & 4) ? Box.Half.Z : -Box.Half.Z);
			Ahead[Corner] = FVector::DotProduct(CamFwd, Corners[Corner]) - Plane;
		}
		TArray<FVector, TInlineAllocator<20>> Front;
		for (int32 Corner = 0; Corner < 8; ++Corner)
		{
			if (Ahead[Corner] >= 0.0)
			{
				Front.Add(Corners[Corner]);
			}
		}
		for (int32 From = 0; From < 8; ++From)
		{
			for (const int32 Bit : { 1, 2, 4 })
			{
				const int32 To = From | Bit;
				if (To != From && (Ahead[From] < 0.0) != (Ahead[To] < 0.0))
				{
					Front.Add(Corners[From] + (Corners[To] - Corners[From]) * (Ahead[From] / (Ahead[From] - Ahead[To])));
				}
			}
		}
		if (Front.Num() < 3)
		{
			return 0.0;
		}
		TArray<FVector2D, TInlineAllocator<20>> Points;
		for (const FVector& Point : Front)
		{
			FVector2D OnScreen = FVector2D::ZeroVector;
			if (PC->ProjectWorldLocationToScreen(Point, OnScreen))
			{
				Points.Add(OnScreen);
			}
			else
			{
				++OutFailed;
			}
		}
		if (Points.Num() < 3)
		{
			return 0.0;
		}
		// the convex hull (Andrew's monotone chain: the lower chain, then the upper)
		Points.Sort([](const FVector2D& L, const FVector2D& R) { return L.X < R.X || (L.X == R.X && L.Y < R.Y); });
		auto Turn = [](const FVector2D& O, const FVector2D& P, const FVector2D& Q) { return (P.X - O.X) * (Q.Y - O.Y) - (P.Y - O.Y) * (Q.X - O.X); };
		TArray<FVector2D, TInlineAllocator<32>> Poly;
		for (int32 Chain = 0; Chain < 2; ++Chain)
		{
			const int32 First = Poly.Num();
			for (int32 Index = 0; Index < Points.Num(); ++Index)
			{
				const FVector2D& Point = Points[Chain == 0 ? Index : Points.Num() - 1 - Index];
				while (Poly.Num() >= First + 2 && Turn(Poly[Poly.Num() - 2], Poly[Poly.Num() - 1], Point) <= 0.0)
				{
					Poly.Pop();
				}
				Poly.Add(Point);
			}
			Poly.Pop();
		}
		// the frame: keep what lies inside each of its four edges
		TArray<FVector2D, TInlineAllocator<32>> Kept;
		for (int32 Edge = 0; Edge < 4 && Poly.Num() >= 3; ++Edge)
		{
			const bool bAlongX = Edge < 2;
			const bool bAbove = Edge == 0 || Edge == 2;
			const double Limit = Edge == 1 ? Size.X : (Edge == 3 ? Size.Y : 0.0);
			auto Inside = [bAlongX, bAbove, Limit](const FVector2D& P) { const double V = bAlongX ? P.X : P.Y; return bAbove ? V >= Limit : V <= Limit; };
			auto Crossing = [bAlongX, Limit](const FVector2D& P, const FVector2D& Q)
			{
				if (bAlongX)
				{
					return FVector2D(Limit, P.Y + (Q.Y - P.Y) * (Limit - P.X) / (Q.X - P.X));
				}
				return FVector2D(P.X + (Q.X - P.X) * (Limit - P.Y) / (Q.Y - P.Y), Limit);
			};
			Kept.Reset();
			for (int32 Index = 0; Index < Poly.Num(); ++Index)
			{
				const FVector2D& Cur = Poly[Index];
				const FVector2D& Prev = Poly[(Index + Poly.Num() - 1) % Poly.Num()];
				if (Inside(Cur))
				{
					if (!Inside(Prev))
					{
						Kept.Add(Crossing(Prev, Cur));
					}
					Kept.Add(Cur);
				}
				else if (Inside(Prev))
				{
					Kept.Add(Crossing(Prev, Cur));
				}
			}
			Poly = Kept;
		}
		if (Poly.Num() < 3)
		{
			return 0.0;
		}
		double Twice = 0.0;
		double SumX = 0.0;
		for (int32 Index = 0; Index < Poly.Num(); ++Index)
		{
			const FVector2D& P = Poly[Index];
			const FVector2D& Q = Poly[(Index + 1) % Poly.Num()];
			const double Wedge = P.X * Q.Y - Q.X * P.Y;
			Twice += Wedge;
			SumX += (P.X + Q.X) * Wedge;
		}
		if (FMath::Abs(Twice) < 1e-9)
		{
			return 0.0;
		}
		OutCentreX = SumX / (3.0 * Twice);
		return FMath::Abs(Twice) * 0.5;
	}

	/** One sword's dash trail on screen as drawn: every segment's box (QaBoxScreenArea), summed, and their area-weighted centre x. */
	double QaTrailOnScreen(APlayerController* PC, const UInstancedStaticMeshComponent* Trail, const FVector& CamLoc, const FVector& CamFwd,
		const FVector2D& Size, double& OutCentreX, int32& OutFailed)
	{
		OutCentreX = 0.0;
		if (Trail == nullptr || Trail->GetStaticMesh() == nullptr)
		{
			return 0.0;
		}
		TArray<FQaObb> Segments;
		QaMeshObbs(Trail, Segments);
		double Area = 0.0;
		double Weighted = 0.0;
		for (const FQaObb& Segment : Segments)
		{
			double CentreX = 0.0;
			const double Part = QaBoxScreenArea(PC, Segment, CamLoc, CamFwd, Size, CentreX, OutFailed);
			Area += Part;
			Weighted += Part * CentreX;
		}
		OutCentreX = Area > 0.0 ? Weighted / Area : 0.0;
		return Area;
	}

	/* ================================================================ wl.Qa.DashTrails: the dash's two trails, measured on screen
	 * The founder's directive (H9): the dash leaves a gold trail from the LEFT hand and a cyan one from the RIGHT, never filling the
	 * screen. From the player's own camera behind, three real dashes (a double tap of W, held swords): each frame of each dash, every
	 * segment each trail DRAWS (the trail mesh's instances, already narrowed by their fade) is clipped at the camera's near plane and
	 * at the frame and its area summed (QaBoxScreenArea) -- so a trail sweeping past or through the camera counts in full, never
	 * skipped. DT1: the most they cover is at most 15% of the frame, more than nothing (they draw), and the view refused no point.
	 * DT2: at that moment the gold trail's centre is on the screen's LEFT of the cyan's. A frame to Saved/Screenshots/WLDASH.
	 */
	struct FQaDashTrails
	{
		TWeakObjectPtr<UWorld> World;
		FTSTicker::FDelegateHandle Handle;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		int32 Sub = 0;
		int32 Dash = 0;
		double PhaseAt = 0.0;
		double MaxCover = 0.0;
		double GoldXAtMax = 0.0;
		double CyanXAtMax = 0.0;
		int32 FramesWithTrails = 0;
		int32 Failed = 0;
		bool bShot = false;
		FString Dir;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLDTQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
		void Frame(const FString& Name)
		{
			int32 Width = 0;
			int32 Height = 0;
			const FString Path = Dir / (Name + TEXT(".png"));
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLDTQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
		}
	};
	TSharedPtr<FQaDashTrails> GQaDashTrails;

	bool QaDashTrailsTick(float)
	{
		if (!GQaDashTrails.IsValid())
		{
			return false;
		}
		FQaDashTrails& S = *GQaDashTrails;
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = QaDog(World);
		FWonderlandMissionHandoff* Handoff = QaHandoff(World);
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		auto Stop = [&S](const TCHAR* Why)
		{
			if (UWorld* W = S.World.Get())
			{
				if (ARelayDogCharacter* D = QaDog(W))
				{
					D->QaForwardKey(false, false);
				}
				if (FWonderlandMissionHandoff* H = QaHandoff(W))
				{
					FString Ignored;
					H->Return(Ignored);
				}
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLDTQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
			const bool bQuit = S.bQuit;
			GQaDashTrails.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Dog == nullptr || Handoff == nullptr || PC == nullptr)
		{
			return Stop(TEXT("the world, the Dog or the handoff went away"));
		}
		const double Now = QaNow();
		const double In = Now - S.PhaseAt;
		switch (S.Phase)
		{
		case 0:
			if (UWonderlandUiSubsystem* Ui = QaUi(World))
			{
				if (Ui->IsWelcomeOpen())
				{
					Ui->DismissWelcome();
				}
			}
			if (In < 4.0 || !Dog->GetCharacterMovement()->IsMovingOnGround())
			{
				return In < 40.0 ? true : Stop(TEXT("never ready"));
			}
			GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
			GEngine->Exec(World, TEXT("wl.Sky.Hour 12"));
			PC->SetViewTargetWithBlend(Dog, 0.0f);
			if (!Handoff->IsEquipped())
			{
				FString Said;
				WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
			}
			S.Phase = 1;
			S.PhaseAt = Now;
			return true;
		case 1:
			if (!Handoff->IsArmed() || In < 5.0)
			{
				return In < 15.0 ? true : Stop(TEXT("the swords were never held"));
			}
			// across open ground, the player's camera behind (QaClearHeading: the M1a dash QA's own open-ground heading)
			{
				FVector Ahead = FVector::ForwardVector;
				QaClearHeading(World, Dog, 1200.0f, Ahead);
				const float Yaw = static_cast<float>(Ahead.Rotation().Yaw);
				Dog->SetActorRotation(FRotator(0.0f, Yaw, 0.0f));
				PC->SetControlRotation(FRotator(-12.0f, Yaw, 0.0f));
			}
			S.Phase = 2;
			S.Sub = 0;
			S.PhaseAt = Now;
			return true;
		case 2:
		{
			// THREE DASHES: a double tap (both presses in one tick), let go on the next, then 0.8 s of the trails measured
			if (S.Sub == 0)
			{
				if (In < 1.6)
				{
					return true;
				}
				Dog->QaForwardKey(false, true);
				Dog->QaForwardKey(false, false);
				Dog->QaForwardKey(false, true);
				S.Sub = 1;
				S.PhaseAt = Now;
				return true;
			}
			if (S.Sub == 1)
			{
				Dog->QaForwardKey(false, false);
				S.Sub = 2;
				return true;
			}
			const WonderlandHandoffSwords::FPresentation& Swords = Dog->GetHandoffSwords();
			FVector2D Size(1280.0, 800.0);
			if (GEngine != nullptr && GEngine->GameViewport != nullptr)
			{
				GEngine->GameViewport->GetViewportSize(Size);
			}
			FVector CamLoc = FVector::ZeroVector;
			FRotator CamRot = FRotator::ZeroRotator;
			PC->GetPlayerViewPoint(CamLoc, CamRot);
			const FVector CamFwd = CamRot.Vector();
			double GoldX = 0.0;
			double CyanX = 0.0;
			const double Gold = QaTrailOnScreen(PC, Swords.GetTrailMesh(true), CamLoc, CamFwd, Size, GoldX, S.Failed);
			const double Cyan = QaTrailOnScreen(PC, Swords.GetTrailMesh(false), CamLoc, CamFwd, Size, CyanX, S.Failed);
			const double Cover = (Gold + Cyan) / FMath::Max(Size.X * Size.Y, 1.0);
			if (Gold > 0.0 && Cyan > 0.0)
			{
				++S.FramesWithTrails;
				if (Cover > S.MaxCover)
				{
					S.MaxCover = Cover;
					S.GoldXAtMax = GoldX;
					S.CyanXAtMax = CyanX;
				}
				if (!S.bShot && In >= 0.25)
				{
					S.Frame(TEXT("dash_trails_player_camera_behind"));
					S.bShot = true;
				}
			}
			if (In < 0.8)
			{
				return true;
			}
			if (++S.Dash < 3)
			{
				S.Sub = 0;
				S.PhaseAt = Now;
				return true;
			}
			S.Check(TEXT("DT1"), S.MaxCover <= 0.15 && S.MaxCover > 0.0005 && S.FramesWithTrails >= 3 && S.Failed == 0,
				FString::Printf(TEXT("three dashes from the player's camera: both trails drawn in %d frames, covering at most %.1f%% of the frame (<= 15%%; every drawn segment clipped at the camera and the frame; points the view refused: %d)"),
					S.FramesWithTrails, S.MaxCover * 100.0, S.Failed));
			S.Check(TEXT("DT2"), S.MaxCover > 0.0 && S.GoldXAtMax < S.CyanXAtMax,
				FString::Printf(TEXT("at the widest moment the gold trail's centre is at x %.0f and the cyan's at x %.0f (gold on the screen's LEFT, from the LEFT hand: %s)"),
					S.GoldXAtMax, S.CyanXAtMax, S.GoldXAtMax < S.CyanXAtMax ? TEXT("yes") : TEXT("NO")));
			return Stop(nullptr);
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaDashTrailsCommand(
		TEXT("wl.Qa.DashTrails"),
		TEXT("The dash's trails on screen (the founder's H9): three real dashes holding the swords, from the player's camera behind -- the ")
		TEXT("ribbons' true coverage at most 15% of the frame (DT1), gold on the LEFT of cyan (DT2); a frame to Saved/Screenshots/WLDASH. ")
		TEXT("`quit` exits after. WLDTQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaDashTrails.IsValid() || World == nullptr)
			{
				return;
			}
			GQaDashTrails = MakeShared<FQaDashTrails>();
			GQaDashTrails->World = World;
			GQaDashTrails->bQuit = Args.Contains(TEXT("quit"));
			GQaDashTrails->PhaseAt = QaNow();
			GQaDashTrails->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLDASH"));
			UE_LOG(LogWonderlandQa, Display, TEXT("WLDTQA BEGIN | %s"), *WonderlandBeta::BuildLabel());
			GQaDashTrails->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaDashTrailsTick), 0.0f);
		}));

	/* ================================================================ wl.Qa.SwordClip: no sword through the body that holds it (A5)
	 * The founder: "verify clothes/wings/swords do not materially clip". For every skin holding the swords in the V, standing and then
	 * walking: EVERY BOX OF BOTH SWORDS (blade, fuller, guard, grip, feathered wings, core -- as drawn, instance by instance) against
	 * every box of the body that holds them -- a worn skin's BODY boxes (bone, cloth, plate, wings; never its light), or Relay OG's
	 * own meshes -- leaving out the arm's end (the forearm and what hangs from it, where the grip sits by design) and every WL_Prop.
	 * A pair's depth is the distance that would push the two apart (the least overlap over the 15 separating axes of two boxes; the
	 * logic validated against a corner-projection reference, 20000/20000). A MATERIAL clip is deeper than 3 uu (a twentieth of the
	 * head). THE INSTRUMENT CAN FAIL: a probe down the body's centreline must hit its boxes every frame, and both the body's boxes
	 * and each sword's are counted. CL1-CL6. WLCLQA lines.
	 */
	constexpr double QaMaterialClipUU = 3.0;
	/** The grip -- and the lattice lying on it -- may sit this far into the fist that holds it (the fingers pressed on it). */
	constexpr double QaGripContactUU = 1.0;
	/** Anything else meeting a hand box deeper than this fails: a guard, a collar, a pommel, a blade, a feather, the other hand. */
	constexpr double QaHandTouchUU = 0.25;
	/** Solid depths are measured to this cap: the verdict only needs to know a part went deeper than QaMaterialClipUU. */
	constexpr double QaSolidCapUU = 12.0;
	constexpr double QaSolidCellUU = 8.0;

	// GENERATED from wonderland-blender-forge/wonderland/v2/dog_canon.py by gen_canon_boxes.py (37 boxes): the Relay OG body as
	// dog_v2.py builds it -- per mesh Mesh_<joint>_<surface>, in that joint's own frame, Unreal axes, in head widths.
	struct FQaCanonBox
	{
		const TCHAR* Name;
		const TCHAR* Mesh;
		bool bSolid;
		double CX, CY, CZ, SX, SY, SZ;
	};
	const FQaCanonBox QaCanonBoxes[] = {
		{ TEXT("headBrow"), TEXT("Mesh_head_ivory"), true, 0.000000, -0.000000, 0.675000, 0.725000, 1.000000, 0.250000 },
		{ TEXT("headJaw"), TEXT("Mesh_head_ivory"), true, 0.000000, -0.000000, 0.125000, 0.725000, 1.000000, 0.250000 },
		{ TEXT("headStub"), TEXT("Mesh_head_ivory"), true, 0.000000, -0.000000, -0.075000, 0.300000, 0.300000, 0.150000 },
		{ TEXT("headFrameLeft"), TEXT("Mesh_head_ivory"), true, 0.000000, 0.412500, 0.400000, 0.725000, 0.175000, 0.300000 },
		{ TEXT("headFrameRight"), TEXT("Mesh_head_ivory"), true, 0.000000, -0.412500, 0.400000, 0.725000, 0.175000, 0.300000 },
		{ TEXT("headBack"), TEXT("Mesh_head_ivory"), true, -0.110000, -0.000000, 0.400000, 0.505000, 0.650000, 0.300000 },
		{ TEXT("earLeft"), TEXT("Mesh_head_ivory"), true, -0.025000, 0.320000, 0.920000, 0.200000, 0.190000, 0.240000 },
		{ TEXT("earRight"), TEXT("Mesh_head_ivory"), true, -0.025000, -0.320000, 0.920000, 0.200000, 0.190000, 0.240000 },
		{ TEXT("visorInterior"), TEXT("Mesh_head_visor"), true, 0.155000, -0.000000, 0.400000, 0.025000, 0.650000, 0.300000 },
		{ TEXT("eyeLeft"), TEXT("Mesh_head_eye"), false, 0.182500, 0.122500, 0.365000, 0.025000, 0.135000, 0.135000 },
		{ TEXT("eyeRight"), TEXT("Mesh_head_eye"), false, 0.182500, -0.122500, 0.365000, 0.025000, 0.135000, 0.135000 },
		{ TEXT("neck"), TEXT("Mesh_root_ivory"), true, 0.000000, -0.000000, 1.812500, 0.325000, 0.325000, 0.175000 },
		{ TEXT("upperTorso"), TEXT("Mesh_root_ivory"), true, 0.000000, -0.000000, 1.668750, 0.450000, 0.620000, 0.387500 },
		{ TEXT("midTorso"), TEXT("Mesh_root_ivory"), true, 0.000000, -0.000000, 1.325000, 0.450000, 0.620000, 0.300000 },
		{ TEXT("lowerTorso"), TEXT("Mesh_root_ivory"), true, 0.000000, -0.000000, 1.081250, 0.400000, 0.487500, 0.187500 },
		{ TEXT("pelvisStep"), TEXT("Mesh_root_ivory"), true, 0.000000, -0.000000, 0.881250, 0.337500, 0.362500, 0.212500 },
		{ TEXT("armLeftUpper"), TEXT("Mesh_armLeft_ivory"), true, 0.000000, 0.130000, -0.294200, 0.212500, 0.200000, 0.400000 },
		{ TEXT("armLeftElbow"), TEXT("Mesh_armLeft_ivory"), true, 0.006300, 0.136300, -0.494200, 0.160000, 0.160000, 0.090000 },
		{ TEXT("armLeftForearm"), TEXT("Mesh_forearmLeft_ivory"), true, 0.006200, 0.006200, -0.187500, 0.200000, 0.190000, 0.375000 },
		{ TEXT("armLeftHand"), TEXT("Mesh_forearmLeft_ivory"), true, 0.018700, 0.016200, -0.475000, 0.225000, 0.205000, 0.200000 },
		{ TEXT("armRightUpper"), TEXT("Mesh_armRight_ivory"), true, 0.000000, -0.130000, -0.294200, 0.212500, 0.200000, 0.400000 },
		{ TEXT("armRightElbow"), TEXT("Mesh_armRight_ivory"), true, 0.006300, -0.136300, -0.494200, 0.160000, 0.160000, 0.090000 },
		{ TEXT("armRightForearm"), TEXT("Mesh_forearmRight_ivory"), true, 0.006200, -0.006200, -0.187500, 0.200000, 0.190000, 0.375000 },
		{ TEXT("armRightHand"), TEXT("Mesh_forearmRight_ivory"), true, 0.018700, -0.016200, -0.475000, 0.225000, 0.205000, 0.200000 },
		{ TEXT("legLeftThigh"), TEXT("Mesh_legLeft_ivory"), true, 0.000000, -0.000000, -0.143750, 0.225000, 0.190000, 0.287500 },
		{ TEXT("legRightThigh"), TEXT("Mesh_legRight_ivory"), true, 0.000000, -0.000000, -0.143750, 0.225000, 0.190000, 0.287500 },
		{ TEXT("legLeftKnee"), TEXT("Mesh_legLeft_ivory"), true, 0.000000, -0.000000, -0.287500, 0.180000, 0.150000, 0.080000 },
		{ TEXT("legRightKnee"), TEXT("Mesh_legRight_ivory"), true, 0.000000, -0.000000, -0.287500, 0.180000, 0.150000, 0.080000 },
		{ TEXT("legLeftShin"), TEXT("Mesh_shinLeft_ivory"), true, 0.000000, -0.000000, -0.143750, 0.225000, 0.190000, 0.287500 },
		{ TEXT("legRightShin"), TEXT("Mesh_shinRight_ivory"), true, 0.000000, -0.000000, -0.143750, 0.225000, 0.190000, 0.287500 },
		{ TEXT("footLeft"), TEXT("Mesh_shinLeft_ivory"), true, 0.062500, 0.012500, -0.400000, 0.375000, 0.275000, 0.225000 },
		{ TEXT("footRight"), TEXT("Mesh_shinRight_ivory"), true, 0.062500, -0.012500, -0.400000, 0.375000, 0.275000, 0.225000 },
		{ TEXT("tail01"), TEXT("Mesh_tail_ivory"), true, -0.037500, -0.000000, -0.050000, 0.175000, 0.162500, 0.162500 },
		{ TEXT("tail02"), TEXT("Mesh_tail_ivory"), true, -0.137500, -0.000000, -0.012500, 0.157000, 0.144500, 0.144500 },
		{ TEXT("tail03"), TEXT("Mesh_tail_ivory"), true, -0.200000, -0.000000, 0.075000, 0.137500, 0.125000, 0.125000 },
		{ TEXT("tail04"), TEXT("Mesh_tail_ivory"), true, -0.237500, -0.000000, 0.187500, 0.125000, 0.112500, 0.112500 },
		{ TEXT("tailTip"), TEXT("Mesh_tail_ivory"), true, -0.250000, -0.000000, 0.287500, 0.112500, 0.100000, 0.100000 },
	};
	/**
	 * A BODY AS ONE SOLID (Second's attack on SwordClip v1, finding 1: per-box depth has a ceiling -- a thin part pushed out of
	 * one voxel is pushed into the next, so a blade buried in a torso read 3-5 uu "however deep"): its boxes, a uniform grid over
	 * them, and the depth of a point as the distance it must travel to leave the UNION of them. Each box's part is an index into
	 * Labels, named only when a verdict reports it (Second's v2 review: a string per box per sample costs frames).
	 */
	struct FQaSolid
	{
		TArray<FQaObb> Boxes;
		TArray<int32> LabelOf;
		TArray<FString> Labels;
		TMap<FIntVector, TArray<int32>> Cells;
		TArray<int32> Stamp;
		int32 StampNow = 0;
		FBox Bounds = FBox(ForceInit);
		void Reset()
		{
			Boxes.Reset();
			LabelOf.Reset();
			Cells.Reset();
			Bounds = FBox(ForceInit);
		}
		int32 LabelIndex(const FString& Label)
		{
			const int32 Found = Labels.Find(Label);
			return Found != INDEX_NONE ? Found : Labels.Add(Label);
		}
		void Add(const FQaObb& Box, int32 Label)
		{
			Boxes.Add(Box);
			LabelOf.Add(Label);
		}
		FString NameOf(int32 Index) const
		{
			if (!Boxes.IsValidIndex(Index) || !LabelOf.IsValidIndex(Index) || !Labels.IsValidIndex(LabelOf[Index]))
			{
				return TEXT("?");
			}
			return Boxes[Index].Instance == INDEX_NONE ? Labels[LabelOf[Index]] : FString::Printf(TEXT("%s#%d"), *Labels[LabelOf[Index]], Boxes[Index].Instance);
		}
		static FIntVector CellOf(const FVector& Point)
		{
			return FIntVector(FMath::FloorToInt32(Point.X / QaSolidCellUU), FMath::FloorToInt32(Point.Y / QaSolidCellUU), FMath::FloorToInt32(Point.Z / QaSolidCellUU));
		}
		void Build()
		{
			Cells.Reset();
			Stamp.Init(0, Boxes.Num());
			StampNow = 0;
			Bounds = FBox(ForceInit);
			for (int32 Index = 0; Index < Boxes.Num(); ++Index)
			{
				const FQaObb& Box = Boxes[Index];
				Bounds += FBox::BuildAABB(Box.Centre, Box.Reach);
				const FIntVector Low = CellOf(Box.Centre - Box.Reach);
				const FIntVector High = CellOf(Box.Centre + Box.Reach);
				for (int32 CellX = Low.X; CellX <= High.X; ++CellX)
				{
					for (int32 CellY = Low.Y; CellY <= High.Y; ++CellY)
					{
						for (int32 CellZ = Low.Z; CellZ <= High.Z; ++CellZ)
						{
							Cells.FindOrAdd(FIntVector(CellX, CellY, CellZ)).Add(Index);
						}
					}
				}
			}
		}
		/** Every box with a cell within Radius of Point, each once. */
		void Near(const FVector& Point, double Radius, TArray<int32>& OutIndices)
		{
			OutIndices.Reset();
			++StampNow;
			const FIntVector Low = CellOf(Point - FVector(Radius));
			const FIntVector High = CellOf(Point + FVector(Radius));
			for (int32 CellX = Low.X; CellX <= High.X; ++CellX)
			{
				for (int32 CellY = Low.Y; CellY <= High.Y; ++CellY)
				{
					for (int32 CellZ = Low.Z; CellZ <= High.Z; ++CellZ)
					{
						if (const TArray<int32>* InCell = Cells.Find(FIntVector(CellX, CellY, CellZ)))
						{
							for (const int32 Index : *InCell)
							{
								if (Stamp[Index] != StampNow)
								{
									Stamp[Index] = StampNow;
									OutIndices.Add(Index);
								}
							}
						}
					}
				}
			}
		}
		/** The first box holding Point, or INDEX_NONE. */
		int32 InsideAt(const FVector& Point) const;
	};

	bool QaObbHolds(const FQaObb& Box, const FVector& Point)
	{
		const FVector Offset = Point - Box.Centre;
		for (int32 AxisAt = 0; AxisAt < 3; ++AxisAt)
		{
			if (FMath::Abs(FVector::DotProduct(Offset, Box.Axis[AxisAt])) > Box.Half[AxisAt])
			{
				return false;
			}
		}
		return true;
	}

	int32 FQaSolid::InsideAt(const FVector& Point) const
	{
		if (const TArray<int32>* InCell = Cells.Find(CellOf(Point)))
		{
			for (const int32 Index : *InCell)
			{
				if (QaObbHolds(Boxes[Index], Point))
				{
					return Index;
				}
			}
		}
		return INDEX_NONE;
	}

	/** Where a ray from From along the unit Way enters and leaves a box (its slabs); false when its line misses the box. */
	bool QaRayObb(const FQaObb& Box, const FVector& From, const FVector& Way, double& OutEnter, double& OutExit)
	{
		double Enter = -TNumericLimits<double>::Max();
		double Exit = TNumericLimits<double>::Max();
		const FVector Offset = From - Box.Centre;
		for (int32 AxisAt = 0; AxisAt < 3; ++AxisAt)
		{
			const double Start = FVector::DotProduct(Offset, Box.Axis[AxisAt]);
			const double Speed = FVector::DotProduct(Way, Box.Axis[AxisAt]);
			if (FMath::Abs(Speed) < 1.0e-9)
			{
				if (FMath::Abs(Start) > Box.Half[AxisAt])
				{
					return false;
				}
				continue;
			}
			double Near0 = (-Box.Half[AxisAt] - Start) / Speed;
			double Far0 = (Box.Half[AxisAt] - Start) / Speed;
			if (Near0 > Far0)
			{
				Swap(Near0, Far0);
			}
			Enter = FMath::Max(Enter, Near0);
			Exit = FMath::Min(Exit, Far0);
			if (Enter > Exit)
			{
				return false;
			}
		}
		OutEnter = Enter;
		OutExit = Exit;
		return true;
	}

	/**
	 * How deep Point is in the solid: the shortest way out of the UNION of its boxes, over 26 directions (the axes, the face and the
	 * corner diagonals -- at most 12% over the true distance), capped at QaSolidCapUU. 0 outside. OutBox: the box holding it.
	 */
	double QaSolidDepth(FQaSolid& Solid, const FVector& Point, int32& OutBox)
	{
		OutBox = Solid.InsideAt(Point);
		if (OutBox == INDEX_NONE)
		{
			return 0.0;
		}
		static TArray<FVector> Ways;
		if (Ways.Num() == 0)
		{
			for (int32 WayX = -1; WayX <= 1; ++WayX)
			{
				for (int32 WayY = -1; WayY <= 1; ++WayY)
				{
					for (int32 WayZ = -1; WayZ <= 1; ++WayZ)
					{
						if (WayX != 0 || WayY != 0 || WayZ != 0)
						{
							Ways.Add(FVector(WayX, WayY, WayZ).GetSafeNormal());
						}
					}
				}
			}
		}
		TArray<int32> Around;
		Solid.Near(Point, QaSolidCapUU + 1.0, Around);
		double Least = QaSolidCapUU;
		TArray<FVector2D, TInlineAllocator<64>> Spans;
		for (const FVector& Way : Ways)
		{
			Spans.Reset();
			for (const int32 Index : Around)
			{
				double Enter = 0.0;
				double Exit = 0.0;
				if (QaRayObb(Solid.Boxes[Index], Point, Way, Enter, Exit) && Exit > 0.0 && Enter < Least)
				{
					Spans.Add(FVector2D(Enter, Exit));
				}
			}
			// THE WAY OUT OF THE UNION: from where the point is, through every span that begins before the ray has left
			double Reached = 0.0;
			bool bGrew = true;
			while (bGrew && Reached < Least)
			{
				bGrew = false;
				for (const FVector2D& Span : Spans)
				{
					if (Span.X <= Reached + 0.01 && Span.Y > Reached)
					{
						Reached = Span.Y;
						bGrew = true;
					}
				}
			}
			Least = FMath::Min(Least, Reached);
			if (Least <= 0.0)
			{
				break;
			}
		}
		return Least;
	}

	/** Where a ray first enters the solid within Reach (OutT along the unit Way); false when it never does. */
	bool QaSolidEntry(const FQaSolid& Solid, const FVector& From, const FVector& Way, double Reach, double& OutT)
	{
		OutT = Reach;
		bool bMet = false;
		for (const FQaObb& Box : Solid.Boxes)
		{
			double Enter = 0.0;
			double Exit = 0.0;
			if (QaRayObb(Box, From, Way, Enter, Exit) && Exit > 0.0 && Enter >= 0.0 && Enter < OutT)
			{
				OutT = Enter;
				bMet = true;
			}
		}
		return bMet;
	}

	/**
	 * A box's sample LINES: along its longest side every 2 uu (2 to 80 samples, both ENDS included), at 9 places across it -- the centre,
	 * the middle of each face and each edge (Second's v2 review: samples inset to 0.8-0.9 never saw an end or a corner -- a feather tip
	 * 4.2 uu in read 3.00). OutPoints[LineIndex * Slices + Slice]; returns Slices.
	 */
	int32 QaBoxPoints(const FQaObb& Box, TArray<FVector>& OutPoints)
	{
		OutPoints.Reset();
		int32 Long = 0;
		for (int32 AxisAt = 1; AxisAt < 3; ++AxisAt)
		{
			Long = Box.Half[AxisAt] > Box.Half[Long] ? AxisAt : Long;
		}
		const int32 AcrossA = (Long + 1) % 3;
		const int32 AcrossB = (Long + 2) % 3;
		const int32 Slices = FMath::Clamp(FMath::CeilToInt32(Box.Half[Long]) + 1, 2, 80);
		for (const double AtA : { -1.0, 0.0, 1.0 })
		{
			for (const double AtB : { -1.0, 0.0, 1.0 })
			{
				for (int32 Slice = 0; Slice < Slices; ++Slice)
				{
					const double Along = -1.0 + 2.0 * Slice / (Slices - 1);
					OutPoints.Add(Box.Centre + Box.Axis[Long] * (Along * Box.Half[Long]) + Box.Axis[AcrossA] * (AtA * Box.Half[AcrossA])
						+ Box.Axis[AcrossB] * (AtB * Box.Half[AcrossB]));
				}
			}
		}
		return Slices;
	}

	/**
	 * HOW A BOX MEETS THE SOLID. A point counts as IN only 0.25 uu inside the union (a face lying on a surface is not a clip).
	 * OutDepth: the deepest point (up to 64 of those in, spread evenly). OutPierced: how many of its 9 lines go IN and come OUT again --
	 * a part speared THROUGH a thin piece of the body, failed at ANY depth (Second's v2 review: the nearest way out is at most half a
	 * part's thickness, so a blade across a 4 uu skirt read 2 uu). OutBox: where.
	 */
	void QaBoxClip(FQaSolid& Solid, const FQaObb& Box, TArray<FVector>& Points, double& OutDepth, int32& OutPierced, int32& OutBox)
	{
		OutDepth = 0.0;
		OutPierced = 0;
		OutBox = INDEX_NONE;
		if (!Solid.Bounds.IsValid || !Solid.Bounds.Intersect(FBox::BuildAABB(Box.Centre, Box.Reach)))
		{
			return;
		}
		const int32 Slices = QaBoxPoints(Box, Points);
		TArray<bool, TInlineAllocator<720>> In;
		In.Init(false, Points.Num());
		TArray<int32, TInlineAllocator<128>> Inside;
		for (int32 Index = 0; Index < Points.Num(); ++Index)
		{
			const int32 Holder = Solid.InsideAt(Points[Index]);
			if (Holder == INDEX_NONE)
			{
				continue;
			}
			// IN ITS OWN BOX by more than the graze: in the union by at least as much (cheap); near its box's face: the union decides
			const FQaObb& Held = Solid.Boxes[Holder];
			const FVector Offset = Points[Index] - Held.Centre;
			double OwnDepth = TNumericLimits<double>::Max();
			for (int32 AxisAt = 0; AxisAt < 3; ++AxisAt)
			{
				OwnDepth = FMath::Min(OwnDepth, Held.Half[AxisAt] - FMath::Abs(FVector::DotProduct(Offset, Held.Axis[AxisAt])));
			}
			int32 UnionBox = Holder;
			In[Index] = OwnDepth >= 0.25 || QaSolidDepth(Solid, Points[Index], UnionBox) >= 0.25;
			if (In[Index])
			{
				Inside.Add(Index);
				if (OutBox == INDEX_NONE)
				{
					OutBox = Holder;
				}
			}
		}
		if (Inside.Num() == 0)
		{
			return;
		}
		const int32 Stride = FMath::Max(1, (Inside.Num() + 63) / 64);
		for (int32 Pick = 0; Pick < Inside.Num(); Pick += Stride)
		{
			int32 InBox = INDEX_NONE;
			const double Depth = QaSolidDepth(Solid, Points[Inside[Pick]], InBox);
			if (Depth > OutDepth)
			{
				OutDepth = Depth;
				OutBox = InBox;
			}
		}
		// THROUGH: a line that is out, then in, then out again
		for (int32 LineIndex = 0; LineIndex < 9; ++LineIndex)
		{
			bool bWasOut = false;
			bool bInAfterOut = false;
			for (int32 Slice = 0; Slice < Slices; ++Slice)
			{
				if (!In[LineIndex * Slices + Slice])
				{
					if (bInAfterOut)
					{
						++OutPierced;
						break;
					}
					bWasOut = true;
				}
				else if (bWasOut)
				{
					bInAfterOut = true;
				}
			}
		}
	}

	/** One box of a sword: its name (the part's own component and instance) and whether it is the grip's wrap -- the grip, or the lattice on it. */
	struct FQaSwordPart
	{
		FQaObb Box;
		FString Name;
		bool bGrip = false;
	};

	void QaSwordParts(const ARelayDogCharacter* Dog, bool bGold, TArray<FQaSwordPart>& OutParts)
	{
		OutParts.Reset();
		const WonderlandHandoffSwords::FPresentation& Swords = Dog->GetHandoffSwords();
		const FTransform SwordXf = Swords.GetSwordWorld(bGold);
		TArray<const UInstancedStaticMeshComponent*> PartMeshes;
		Swords.GetPartMeshes(bGold, PartMeshes);
		for (const UInstancedStaticMeshComponent* PartMesh : PartMeshes)
		{
			if (PartMesh == nullptr || !PartMesh->IsVisible() || PartMesh->GetStaticMesh() == nullptr)
			{
				continue;
			}
			TArray<FQaObb> PartBoxes;
			QaMeshObbs(PartMesh, PartBoxes);
			const FString MeshName = PartMesh->GetName();
			const bool bGripMesh = MeshName.Contains(TEXT("Grip"));
			const bool bMetalMesh = MeshName.Contains(TEXT("Metal"));
			for (const FQaObb& PartBox : PartBoxes)
			{
				// THE GRIP'S WRAP: the lattice of metal lying on the grip between its collars is what the fist holds, as the grip is
				const FVector InSword = SwordXf.InverseTransformPosition(PartBox.Centre);
				const bool bWrap = bMetalMesh && FMath::Abs(InSword.Z) < WonderlandHandoffSwords::GripHalfUU - 0.8 && FVector2D(InSword.X, InSword.Y).Size() < 2.7;
				FQaSwordPart& Part = OutParts.AddDefaulted_GetRef();
				Part.Box = PartBox;
				Part.Name = FString::Printf(TEXT("%s#%d"), *MeshName, PartBox.Instance);
				Part.bGrip = bGripMesh || bWrap;
			}
		}
	}

	void QaHandObbs(const WonderlandHands::FHand& Hand, TArray<FQaObb>& OutBoxes)
	{
		OutBoxes.Reset();
		TArray<const UStaticMeshComponent*> HandParts;
		Hand.GetBoxes(HandParts);
		for (const UStaticMeshComponent* HandPart : HandParts)
		{
			if (HandPart != nullptr && HandPart->IsVisible() && HandPart->GetStaticMesh() != nullptr)
			{
				QaMeshObbs(HandPart, OutBoxes);
			}
		}
	}

	/** Relay OG's own meshes by name (Mesh_<joint>_<surface>, as dog_v2.py names them), and its head width off the head's mesh. */
	double QaCanonMeshes(const ARelayDogCharacter* Dog, TMap<FString, const UStaticMeshComponent*>& OutByName)
	{
		OutByName.Reset();
		TInlineComponentArray<UStaticMeshComponent*> DogMeshes;
		Dog->GetComponents<UStaticMeshComponent>(DogMeshes);
		for (const UStaticMeshComponent* DogMesh : DogMeshes)
		{
			if (DogMesh != nullptr && DogMesh->GetStaticMesh() != nullptr && DogMesh->GetName().StartsWith(TEXT("Mesh_")))
			{
				OutByName.Add(DogMesh->GetName(), DogMesh);
			}
		}
		const UStaticMeshComponent* const* HeadMesh = OutByName.Find(TEXT("Mesh_head_ivory"));
		// THE BROW IS ONE HEAD WIDTH ACROSS (the mesh's Y)
		return HeadMesh != nullptr ? (*HeadMesh)->GetStaticMesh()->GetBounds().BoxExtent.Y * 2.0 : 0.0;
	}

	/**
	 * RELAY OG AS ITS GENERATOR BUILT IT (Second's finding 6: per-mesh bounding boxes hold empty space -- the head fills 41% of its own):
	 * the generator's boxes on Relay OG's own meshes. EVERY MESH'S BOUNDS ARE CHECKED against the table first; a mismatch, or a solid
	 * mesh missing, is BLIND (OutWhy), never a guess.
	 */
	bool QaCanonSolid(const ARelayDogCharacter* Dog, FQaSolid& OutSolid, FString& OutWhy)
	{
		TMap<FString, const UStaticMeshComponent*> ByName;
		const double HeadWidth = QaCanonMeshes(Dog, ByName);
		if (HeadWidth < 10.0)
		{
			OutWhy = TEXT("Relay OG's head mesh (Mesh_head_ivory) not found: the generator's boxes cannot be placed");
			return false;
		}
		TMap<FString, FBox> Union;
		TSet<FString> SolidMeshes;
		for (const FQaCanonBox& CanonRow : QaCanonBoxes)
		{
			const FVector RowCentre(CanonRow.CX, CanonRow.CY, CanonRow.CZ);
			const FVector RowSize(CanonRow.SX, CanonRow.SY, CanonRow.SZ);
			Union.FindOrAdd(FString(CanonRow.Mesh), FBox(ForceInit)) += FBox(RowCentre - RowSize * 0.5, RowCentre + RowSize * 0.5);
			if (CanonRow.bSolid)
			{
				SolidMeshes.Add(FString(CanonRow.Mesh));
			}
		}
		for (const TPair<FString, FBox>& Expected : Union)
		{
			const UStaticMeshComponent* const* Found = ByName.Find(Expected.Key);
			if (Found == nullptr)
			{
				if (SolidMeshes.Contains(Expected.Key))
				{
					OutWhy += FString::Printf(TEXT("%s%s missing"), OutWhy.IsEmpty() ? TEXT("") : TEXT("; "), *Expected.Key);
				}
				continue;
			}
			const FBoxSphereBounds Shipped = (*Found)->GetStaticMesh()->GetBounds();
			const FVector ShippedLow = Shipped.Origin - Shipped.BoxExtent;
			const FVector ShippedHigh = Shipped.Origin + Shipped.BoxExtent;
			const double Off = FMath::Max((ShippedLow - Expected.Value.Min * HeadWidth).GetAbsMax(), (ShippedHigh - Expected.Value.Max * HeadWidth).GetAbsMax());
			if (Off > FMath::Max(0.75, HeadWidth * 0.0125))
			{
				OutWhy += FString::Printf(TEXT("%s%s is %.1f uu off the generator's boxes"), OutWhy.IsEmpty() ? TEXT("") : TEXT("; "), *Expected.Key, Off);
			}
		}
		if (!OutWhy.IsEmpty())
		{
			return false;
		}
		for (int32 RowIndex = 0; RowIndex < static_cast<int32>(UE_ARRAY_COUNT(QaCanonBoxes)); ++RowIndex)
		{
			const FQaCanonBox& CanonRow = QaCanonBoxes[RowIndex];
			const UStaticMeshComponent* const* Found = ByName.Find(FString(CanonRow.Mesh));
			if (!CanonRow.bSolid || Found == nullptr || !(*Found)->IsVisible())
			{
				continue;
			}
			const FTransform Unit(FQuat::Identity, FVector(CanonRow.CX, CanonRow.CY, CanonRow.CZ) * HeadWidth, FVector(CanonRow.SX, CanonRow.SY, CanonRow.SZ) * (HeadWidth / 100.0));
			OutSolid.Add(QaObb(*Found, RowIndex, Unit * (*Found)->GetComponentTransform()), OutSolid.LabelIndex(FString(CanonRow.Name)));
		}
		return true;
	}

	/** A named box of Relay OG's generator, where it is now in the world (its mesh followed even while a skin hides it). */
	bool QaCanonPoint(const ARelayDogCharacter* Dog, const TCHAR* BoxName, FVector& OutPoint)
	{
		TMap<FString, const UStaticMeshComponent*> ByName;
		const double HeadWidth = QaCanonMeshes(Dog, ByName);
		for (const FQaCanonBox& CanonRow : QaCanonBoxes)
		{
			if (FCString::Strcmp(CanonRow.Name, BoxName) == 0)
			{
				const UStaticMeshComponent* const* Found = ByName.Find(FString(CanonRow.Mesh));
				if (Found == nullptr || HeadWidth < 10.0)
				{
					return false;
				}
				OutPoint = (*Found)->GetComponentTransform().TransformPosition(FVector(CanonRow.CX, CanonRow.CY, CanonRow.CZ) * HeadWidth);
				return true;
			}
		}
		return false;
	}

	/**
	 * THE BODY HOLDING THE SWORDS, AS ONE SOLID (Second's findings 1, 3, 6, 7, 8 on v1; v2 review 2 and 10): a worn skin's parts drawn
	 * OPAQUE -- Lit, Rim and Glow (Glow is opaque and unlit; only Additive is light), whatever they are called -- else Relay OG's generator
	 * boxes. Both arms stay in, for both swords. Within (optional): only boxes meeting that region are built (the swords and the chest);
	 * OutAllSolid counts every solid box regardless, for the floors. False (OutWhy) when the instrument cannot see a body: no solid at the
	 * chest is BLIND.
	 */
	bool QaBodySolid(const ARelayDogCharacter* Dog, FQaSolid& OutSolid, FString& OutWhy, FString& OutNote, bool& bOutCostume, const FBox* Within = nullptr,
		int32* OutAllSolid = nullptr)
	{
		OutSolid.Reset();
		OutWhy.Reset();
		OutNote.Reset();
		int32 AllSolid = 0;
		const AWonderlandCompanionEmbodiment* Worn = Dog->GetCostume();
		bOutCostume = Worn != nullptr && !Worn->IsHidden();
		if (bOutCostume)
		{
			TInlineComponentArray<UInstancedStaticMeshComponent*> WornMeshes;
			Worn->GetComponents<UInstancedStaticMeshComponent>(WornMeshes);
			int32 LightMeshes = 0;
			int32 SolidMeshes = 0;
			for (const UInstancedStaticMeshComponent* WornMesh : WornMeshes)
			{
				if (WornMesh == nullptr || !WornMesh->IsVisible() || WornMesh->GetStaticMesh() == nullptr)
				{
					continue;
				}
				const FName WornPart = Worn->GetPartMeshName(WornMesh);
				if (WornPart.IsNone())
				{
					continue;
				}
				if (!Worn->IsSolidMesh(WornMesh))
				{
					++LightMeshes;
					continue;
				}
				++SolidMeshes;
				AllSolid += WornMesh->GetInstanceCount();
				if (Within != nullptr && !Within->Intersect(WornMesh->Bounds.GetBox()))
				{
					continue;
				}
				const int32 Label = OutSolid.LabelIndex(WornPart.ToString());
				TArray<FQaObb> WornBoxes;
				QaMeshObbs(WornMesh, WornBoxes);
				for (const FQaObb& WornBox : WornBoxes)
				{
					if (Within == nullptr || Within->Intersect(FBox::BuildAABB(WornBox.Centre, WornBox.Reach)))
					{
						OutSolid.Add(WornBox, Label);
					}
				}
			}
			OutNote = FString::Printf(TEXT("%d opaque part mesh(es) (Lit, Rim, Glow), %d Additive left out; flames and strips (procedural) NOT MEASURED"),
				SolidMeshes, LightMeshes);
		}
		else if (!QaCanonSolid(Dog, OutSolid, OutWhy))
		{
			return false;
		}
		else
		{
			AllSolid = OutSolid.Boxes.Num();
		}
		if (OutAllSolid != nullptr)
		{
			*OutAllSolid = AllSolid;
		}
		if (OutSolid.Boxes.Num() == 0)
		{
			OutWhy = TEXT("no solid box at all");
			return false;
		}
		OutSolid.Build();
		FVector Chest = FVector::ZeroVector;
		if (!QaCanonPoint(Dog, TEXT("upperTorso"), Chest) || OutSolid.InsideAt(Chest) == INDEX_NONE)
		{
			OutWhy = TEXT("nothing solid at the chest: the instrument cannot see the torso");
			return false;
		}
		return true;
	}

	/** The phases a sword clip is sampled through, from Equip to Return (Second's finding 4; v2 review 4: the real walk, jog and run keys). */
	enum class EQaClipPhase : uint8
	{
		Forming,
		Stand,
		Walk,
		Jog,
		Run,
		Dash,
		Stop,
		Turn,
		Jump,
		SkinChange,
		Return,
		Count
	};
	const TCHAR* const QaClipPhaseNames[] = { TEXT("forming"), TEXT("stand"), TEXT("walk"), TEXT("jog"), TEXT("run"), TEXT("dash x3"), TEXT("stop"),
		TEXT("turn 180"), TEXT("jump"), TEXT("skin change held"), TEXT("return") };
	/** When a phase's mid-phase controls run (s into it): the pose then, not the standing one after the trip home (Second's v2 review 6). */
	const double QaClipPhaseMid[] = { 0.0, 1.0, 1.0, 1.0, 1.0, 2.7, 0.75, 1.25, 0.6, 0.8, 0.3 };

	/** The phases the swords are HELD in: IsArmed and a closed fist required. */
	bool QaClipHeldPhase(EQaClipPhase Phase)
	{
		return Phase != EQaClipPhase::Forming && Phase != EQaClipPhase::Return;
	}

	struct FQaClipStats
	{
		int32 Samples = 0;
		int32 BlindSamples = 0;
		FString Blind;
		int32 NotArmed = 0;
		double TopSpeed = 0.0;
		double LastSpeed = 0.0;
		int32 Dashes = 0;
		int32 DashFrames = 0;
		double Turned = 0.0;
		bool bLeftGround = false;
		bool bCostumeSeen = false;
		bool bCanonSeen = false;
		double DeepestBody = 0.0;
		FString DeepestBodyPair;
		int32 MaterialHits = 0;
		int32 Pierced = 0;
		FString PiercePair;
		double GripContact = 0.0;
		double OtherContact = 0.0;
		int32 HandHits = 0;
		double WorstHand = 0.0;
		FString WorstHandPair;
		int32 HeldFaults = 0;
		FString HeldFaultWhy;
		double SwordCross = 0.0;
		double FistInBody = 0.0;
		int32 FistThrough = 0;
		FString FistInBodyPair;
		float Misalign[2] = { 0.0f, 0.0f };
		float Bend[2] = { 0.0f, 0.0f };
		FString Note;
		int32 ControlsRun = 0;
		int32 ControlsBad = 0;
		FString ControlsDetail;
		bool bMidControls = false;
		bool bDashControls = false;
		int32 MinCostumeBoxes = MAX_int32;
		int32 MinCanonBoxes = MAX_int32;
		int32 FirstCostumeBoxes = 0;
		int32 MinNearSword[2] = { MAX_int32, MAX_int32 };
		// the boxes the region filter kept, against the whole solid body (Second: the filter must be seen not to drop a swept part)
		int32 KeptLeast = MAX_int32;
		int32 KeptMost = 0;
		int32 AllMost = 0;
	};

	struct FQaSwordClip
	{
		TWeakObjectPtr<UWorld> World;
		FTSTicker::FDelegateHandle Handle;
		TWeakObjectPtr<ACameraActor> Camera;
		FString Dir;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		int32 Skin = 0;
		double PhaseAt = 0.0;
		FVector Start = FVector::ZeroVector;
		FVector Ahead = FVector::ForwardVector;
		float StartYaw = 0.0f;
		// one skin's run through the phases
		int32 Step = 0;
		double StepAt = 0.0;
		double LastSampleAt = -1.0;
		float LastYaw = 0.0f;
		int32 DashBase = 0;
		int32 DashKey = 0;
		int32 Shots = 0;
		int32 DashShot = 0;
		int32 FramesSaved = 0;
		int32 FramesFailed = 0;
		bool bJumpAvailable = false;
		bool bJumpRead = false;
		bool bReturnAsked = false;
		bool bReturnAccepted = false;
		bool bSwordsLeft = false;
		FString ReturnWhy;
		FString SkinWhy;
		TArray<FQaClipStats> Stats;
		FQaSolid Solid;
		TArray<FVector> Points;
		void Check(const FString& Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCLQA %s %s | %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
		void Frame(const FString& Name)
		{
			int32 Width = 0;
			int32 Height = 0;
			const FString Path = Dir / (Name + TEXT(".png"));
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height) && IFileManager::Get().FileExists(*Path);
			(bOk ? FramesSaved : FramesFailed) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCLQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
		}
	};
	TSharedPtr<FQaSwordClip> GQaSwordClip;

	bool QaClipHangsFrom(const USceneComponent* Part, const USceneComponent* Arm)
	{
		for (const USceneComponent* Up = Part; Up != nullptr && Arm != nullptr; Up = Up->GetAttachParent())
		{
			if (Up == Arm)
			{
				return true;
			}
		}
		return false;
	}

	/** The region worth measuring: both swords' parts and the chest, grown by 40 uu (Second's v2 review 10: the whole skin every sample cost frames). */
	FBox QaClipRegion(const ARelayDogCharacter* Dog)
	{
		FBox Region(ForceInit);
		for (int32 Side = 0; Side < 2; ++Side)
		{
			TArray<const UInstancedStaticMeshComponent*> PartMeshes;
			Dog->GetHandoffSwords().GetPartMeshes(Side == 0, PartMeshes);
			for (const UInstancedStaticMeshComponent* PartMesh : PartMeshes)
			{
				if (PartMesh != nullptr && PartMesh->IsVisible())
				{
					Region += PartMesh->Bounds.GetBox();
				}
			}
		}
		FVector Chest = FVector::ZeroVector;
		if (QaCanonPoint(Dog, TEXT("upperTorso"), Chest))
		{
			Region += FBox::BuildAABB(Chest, FVector(30.0));
		}
		return Region.IsValid ? Region.ExpandBy(40.0) : Region;
	}

	FQaObb QaClipPlant(const FVector& Centre, const FVector& AxisX, const FVector& AxisY, const FVector& AxisZ, const FVector& Half)
	{
		FQaObb Planted;
		Planted.Mesh = nullptr;
		Planted.Instance = INDEX_NONE;
		Planted.Centre = Centre;
		Planted.Axis[0] = AxisX;
		Planted.Axis[1] = AxisY;
		Planted.Axis[2] = AxisZ;
		Planted.Half = Half;
		for (int32 AxisAt = 0; AxisAt < 3; ++AxisAt)
		{
			Planted.Reach[AxisAt] = Half.X * FMath::Abs(AxisX[AxisAt]) + Half.Y * FMath::Abs(AxisY[AxisAt]) + Half.Z * FMath::Abs(AxisZ[AxisAt]);
		}
		return Planted;
	}

	/**
	 * ONE SAMPLE: both swords against the body (one solid: depth AND pierce), against both hands (their own class), against each other,
	 * and the fists against the body; in a held phase, each sword HELD by a drawn closed fist on the visible forearm, its grip inside the
	 * fingers as the boxes show it (Second's v2 review 3: no hands, or a grip 5 uu outside the fist, read "no fault").
	 */
	void QaClipMeasure(FQaSwordClip& S, ARelayDogCharacter* Dog, FQaClipStats& Into, bool bHeld)
	{
		FString Why;
		FString Note;
		bool bCostume = false;
		int32 AllSolid = 0;
		const FBox Region = QaClipRegion(Dog);
		if (!QaBodySolid(Dog, S.Solid, Why, Note, bCostume, Region.IsValid ? &Region : nullptr, &AllSolid))
		{
			++Into.BlindSamples;
			if (Into.Blind.IsEmpty())
			{
				Into.Blind = Why;
			}
			return;
		}
		(bCostume ? Into.bCostumeSeen : Into.bCanonSeen) = true;
		if (!Note.IsEmpty())
		{
			Into.Note = Note;
		}
		Into.KeptLeast = FMath::Min(Into.KeptLeast, S.Solid.Boxes.Num());
		Into.KeptMost = FMath::Max(Into.KeptMost, S.Solid.Boxes.Num());
		Into.AllMost = FMath::Max(Into.AllMost, AllSolid);
		int32& MinBoxes = bCostume ? Into.MinCostumeBoxes : Into.MinCanonBoxes;
		MinBoxes = FMath::Min(MinBoxes, AllSolid);
		if (bCostume && Into.FirstCostumeBoxes == 0)
		{
			Into.FirstCostumeBoxes = AllSolid;
		}
		const WonderlandHandoffSwords::FPresentation& Swords = Dog->GetHandoffSwords();
		for (int32 Side = 0; Side < 2; ++Side)
		{
			TArray<int32> NearGrip;
			S.Solid.Near(Swords.GetSwordWorld(Side == 0).GetLocation(), 30.0, NearGrip);
			Into.MinNearSword[Side] = FMath::Min(Into.MinNearSword[Side], NearGrip.Num());
		}
		TArray<FQaObb> HandBoxes[2];
		QaHandObbs(Dog->GetHand(true), HandBoxes[0]);
		QaHandObbs(Dog->GetHand(false), HandBoxes[1]);
		TArray<FQaSwordPart> SwordParts[2];
		int32 SwordBoxes = 0;
		for (int32 Side = 0; Side < 2; ++Side)
		{
			QaSwordParts(Dog, Side == 0, SwordParts[Side]);
			SwordBoxes += SwordParts[Side].Num();
		}
		for (int32 Side = 0; Side < 2; ++Side)
		{
			// the gold is the Dog's own -Y hand's (GetHand(true)), the cyan the +Y hand's
			const bool bGold = Side == 0;
			for (const FQaSwordPart& SwordPart : SwordParts[Side])
			{
				double Depth = 0.0;
				int32 Pierced = 0;
				int32 InBox = INDEX_NONE;
				QaBoxClip(S.Solid, SwordPart.Box, S.Points, Depth, Pierced, InBox);
				if (Depth > Into.DeepestBody)
				{
					Into.DeepestBody = Depth;
					Into.DeepestBodyPair = FString::Printf(TEXT("%s %s in %s"), bGold ? TEXT("gold") : TEXT("cyan"), *SwordPart.Name, *S.Solid.NameOf(InBox));
				}
				Into.MaterialHits += Depth > QaMaterialClipUU ? 1 : 0;
				if (Pierced > 0)
				{
					++Into.Pierced;
					if (Into.PiercePair.IsEmpty())
					{
						Into.PiercePair = FString::Printf(TEXT("%s %s THROUGH %s (%d of 9 lines)"), bGold ? TEXT("gold") : TEXT("cyan"), *SwordPart.Name,
							*S.Solid.NameOf(InBox), Pierced);
					}
				}
				// THE HANDS AS THEIR OWN CLASS: the grip's wrap may meet its own fist; nothing else meets a hand
				for (int32 HandSide = 0; HandSide < 2; ++HandSide)
				{
					const bool bHolding = HandSide == Side;
					for (const FQaObb& HandPiece : HandBoxes[HandSide])
					{
						const FVector Gap = (HandPiece.Centre - SwordPart.Box.Centre).GetAbs() - HandPiece.Reach - SwordPart.Box.Reach;
						if (Gap.X > 0.0 || Gap.Y > 0.0 || Gap.Z > 0.0)
						{
							continue;
						}
						const double Touch = QaObbDepth(SwordPart.Box, HandPiece);
						if (Touch <= 0.0)
						{
							continue;
						}
						const bool bGripInItsFist = bHolding && SwordPart.bGrip;
						(bGripInItsFist ? Into.GripContact : Into.OtherContact) = FMath::Max(bGripInItsFist ? Into.GripContact : Into.OtherContact, Touch);
						if (Touch > (bGripInItsFist ? QaGripContactUU : QaHandTouchUU))
						{
							++Into.HandHits;
							if (Touch > Into.WorstHand)
							{
								Into.WorstHand = Touch;
								Into.WorstHandPair = FString::Printf(TEXT("%s %s in the %s hand (%s)"), bGold ? TEXT("gold") : TEXT("cyan"), *SwordPart.Name,
									HandSide == 0 ? TEXT("left") : TEXT("right"), bHolding ? TEXT("its own") : TEXT("the OTHER"));
							}
						}
					}
				}
				// SWORD AGAINST SWORD
				if (Side == 0)
				{
					for (const FQaSwordPart& OtherPart : SwordParts[1])
					{
						Into.SwordCross = FMath::Max(Into.SwordCross, QaObbDepth(SwordPart.Box, OtherPart.Box));
					}
				}
			}
			// HELD BY A DRAWN CLOSED FIST ON THE VISIBLE FOREARM, the grip inside its fingers as the boxes show it
			if (bHeld)
			{
				const WonderlandHands::FHand& Hand = Dog->GetHand(bGold);
				const USceneComponent* Arm = Dog->GetVisibleForearm(bGold);
				FString Fault;
				if (HandBoxes[Side].Num() != WonderlandHands::BoxesPerHand)
				{
					Fault = FString::Printf(TEXT("%d hand boxes drawn"), HandBoxes[Side].Num());
				}
				else if (Arm == nullptr || !Hand.IsOn(Arm))
				{
					Fault = TEXT("the hand is not on the visible forearm");
				}
				else if (Swords.GetHeldBy(bGold) != Arm)
				{
					Fault = TEXT("the sword is not held by the visible forearm");
				}
				else if (Hand.GetCurl() < 0.95f)
				{
					Fault = FString::Printf(TEXT("the fist open (curl %.2f)"), Hand.GetCurl());
				}
				else
				{
					int32 Wrapped = 0;
					int32 GripBoxes = 0;
					for (const FQaSwordPart& SwordPart : SwordParts[Side])
					{
						if (!SwordPart.Name.Contains(TEXT("Grip")))
						{
							continue;
						}
						++GripBoxes;
						FQaObb Grown = SwordPart.Box;
						Grown.Half += FVector(0.5);
						Grown = QaClipPlant(Grown.Centre, Grown.Axis[0], Grown.Axis[1], Grown.Axis[2], Grown.Half);
						for (int32 Finger = 1; Finger <= 8 && Finger < HandBoxes[Side].Num(); ++Finger)
						{
							Wrapped += QaObbDepth(Grown, HandBoxes[Side][Finger]) > 0.0 ? 1 : 0;
						}
					}
					if (GripBoxes == 0 || Wrapped < 3)
					{
						Fault = FString::Printf(TEXT("the grip not inside the fingers (%d of 8 finger boxes meet it)"), Wrapped);
					}
				}
				if (!Fault.IsEmpty())
				{
					++Into.HeldFaults;
					if (Into.HeldFaultWhy.IsEmpty())
					{
						Into.HeldFaultWhy = FString::Printf(TEXT("%s: %s"), bGold ? TEXT("gold") : TEXT("cyan"), *Fault);
					}
				}
			}
			Into.Misalign[Side] = FMath::Max(Into.Misalign[Side], Dog->GetHand(bGold).GetGripMisalignDeg());
			Into.Bend[Side] = FMath::Max(Into.Bend[Side], Dog->GetHand(bGold).GetWristBendDeg());
		}
		// THE FISTS AGAINST THE BODY: a finger or thumb box deeper than 1 uu in it, or through it (the forearm the hand hangs from aside)
		for (int32 Side = 0; Side < 2; ++Side)
		{
			const USceneComponent* OwnArm = Dog->GetVisibleForearm(Side == 0);
			for (int32 Piece = 1; Piece < HandBoxes[Side].Num(); ++Piece)
			{
				double Depth = 0.0;
				int32 Pierced = 0;
				int32 InBox = INDEX_NONE;
				QaBoxClip(S.Solid, HandBoxes[Side][Piece], S.Points, Depth, Pierced, InBox);
				if (InBox == INDEX_NONE || QaClipHangsFrom(S.Solid.Boxes[InBox].Mesh, OwnArm))
				{
					continue;
				}
				Into.FistThrough += Pierced > 0 ? 1 : 0;
				if (Depth > Into.FistInBody)
				{
					Into.FistInBody = Depth;
					Into.FistInBodyPair = FString::Printf(TEXT("the %s hand's box %d in %s"), Side == 0 ? TEXT("left") : TEXT("right"), Piece, *S.Solid.NameOf(InBox));
				}
			}
		}
		if (SwordBoxes > 0)
		{
			++Into.Samples;
		}
		Into.LastSpeed = Dog->GetVelocity().Size2D();
		Into.TopSpeed = FMath::Max(Into.TopSpeed, Into.LastSpeed);
		Into.DashFrames += Dog->IsDashing() ? 1 : 0;
	}

	/**
	 * THE CONTROLS, on the solid this very sample built (Second: a control at the start cannot see a phase go blind):
	 *   a feather and a blade segment planted 5 uu inside the chest (found by a ray from in front) must read MATERIAL;
	 *   a blade TIP-first 3.5 uu into the chest must read MATERIAL (its end is sampled now);
	 *   a blade across a 4 uu slab (a solid of its own) must read THROUGH (the pierce test can fail);
	 *   a feather 30 uu off the GENERATOR's chest face must read nothing -- found without the solid, so the solid cannot make it pass;
	 *   in a held phase, a box planted in a finger must read a hand fault (the hands are there and measured).
	 */
	bool QaClipControls(FQaSwordClip& S, ARelayDogCharacter* Dog, bool bHeld, FString& OutDetail)
	{
		OutDetail.Reset();
		FVector Chest = FVector::ZeroVector;
		TMap<FString, const UStaticMeshComponent*> ByName;
		const double HeadWidth = QaCanonMeshes(Dog, ByName);
		if (!QaCanonPoint(Dog, TEXT("upperTorso"), Chest) || HeadWidth < 10.0)
		{
			OutDetail = TEXT("BLIND: no chest point");
			return false;
		}
		const FVector Front = Dog->GetActorForwardVector().GetSafeNormal2D();
		const FVector Across = FVector::CrossProduct(FVector::UpVector, Front).GetSafeNormal();
		const FVector RayFrom = Chest + Front * 90.0;
		double Met = 0.0;
		if (!QaSolidEntry(S.Solid, RayFrom, -Front, 90.0, Met))
		{
			OutDetail = TEXT("BLIND: a ray from in front never met the chest");
			return false;
		}
		const FVector Surface = RayFrom - Front * Met;
		bool bAllRight = true;
		auto Note = [&OutDetail, &bAllRight](const TCHAR* What, double Reading, bool bRight)
		{
			bAllRight &= bRight;
			OutDetail += FString::Printf(TEXT("%s%s %.1f%s"), OutDetail.IsEmpty() ? TEXT("") : TEXT(", "), What, Reading, bRight ? TEXT("") : TEXT(" WRONG"));
		};
		double Depth = 0.0;
		int32 Pierced = 0;
		int32 InBox = INDEX_NONE;
		QaBoxClip(S.Solid, QaClipPlant(Surface - Front * 5.3, Front, Across, FVector::UpVector, FVector(0.3, 4.0, 8.0)), S.Points, Depth, Pierced, InBox);
		Note(TEXT("feather 5 in"), Depth, Depth > QaMaterialClipUU);
		QaBoxClip(S.Solid, QaClipPlant(Surface - Front * 5.75, Front, Across, FVector::UpVector, FVector(0.75, 2.5, 6.0)), S.Points, Depth, Pierced, InBox);
		Note(TEXT("blade 5 in"), Depth, Depth > QaMaterialClipUU);
		QaBoxClip(S.Solid, QaClipPlant(Surface + Front * 6.5, Front, Across, FVector::UpVector, FVector(10.0, 2.5, 0.75)), S.Points, Depth, Pierced, InBox);
		Note(TEXT("blade tip 3.5 in"), Depth, Depth > QaMaterialClipUU);
		// THE PIERCE TEST CAN FAIL: a 4 uu slab of its own, well in front of everything, and a blade across it
		FQaSolid Slab;
		const FVector SlabAt = Chest + Front * 120.0;
		Slab.Add(QaClipPlant(SlabAt, Front, Across, FVector::UpVector, FVector(2.0, 12.0, 12.0)), Slab.LabelIndex(TEXT("control slab")));
		Slab.Build();
		QaBoxClip(Slab, QaClipPlant(SlabAt, Front, Across, FVector::UpVector, FVector(10.0, 1.5, 0.4)), S.Points, Depth, Pierced, InBox);
		Note(TEXT("blade through a 4 uu slab, lines through"), static_cast<double>(Pierced), Pierced >= 1);
		// OUTSIDE, found WITHOUT the solid: 30 uu off the generator's chest face (upperTorso is 0.45 head widths deep)
		const FVector OffChest = Chest + Front * (0.225 * HeadWidth + 30.0);
		QaBoxClip(S.Solid, QaClipPlant(OffChest, Front, Across, FVector::UpVector, FVector(0.3, 4.0, 8.0)), S.Points, Depth, Pierced, InBox);
		Note(TEXT("feather 30 off the chest"), Depth + Pierced, Depth <= 0.0 && Pierced == 0);
		if (bHeld)
		{
			TArray<FQaObb> LeftHand;
			QaHandObbs(Dog->GetHand(true), LeftHand);
			const double FingerTouch = LeftHand.Num() > 1
				? QaObbDepth(QaClipPlant(LeftHand[1].Centre, LeftHand[1].Axis[0], LeftHand[1].Axis[1], LeftHand[1].Axis[2], FVector(0.5)), LeftHand[1]) : 0.0;
			Note(TEXT("a box in a finger"), FingerTouch, FingerTouch > QaHandTouchUU);
		}
		return bAllRight;
	}

	/** A close camera on a point, from a direction (the fists from the side and from above). */
	void QaClipCamera(FQaSwordClip& S, UWorld* World, const FVector& Look, const FVector& From, float Fov)
	{
		APlayerController* PC = World->GetFirstPlayerController();
		ACameraActor* Cam = S.Camera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Cam = World->SpawnActor<ACameraActor>(From, FRotator::ZeroRotator, Params);
			S.Camera = Cam;
		}
		if (Cam != nullptr && PC != nullptr)
		{
			Cam->SetActorLocationAndRotation(From, (Look - From).Rotation());
			Cam->GetCameraComponent()->SetFieldOfView(Fov);
			Cam->GetCameraComponent()->SetConstraintAspectRatio(false);
			if (PC->GetViewTarget() != Cam)
			{
				PC->SetViewTargetWithBlend(Cam, 0.0f);
			}
		}
	}

	bool QaClipFist(const ARelayDogCharacter* Dog, bool bLeft, FVector& OutFist)
	{
		const USceneComponent* Arm = Dog->GetVisibleForearm(bLeft);
		if (Arm == nullptr)
		{
			return false;
		}
		OutFist = Arm->GetComponentTransform().TransformPosition(Dog->GetHand(bLeft).GripCentreLocal());
		return true;
	}

	bool QaSwordClipTick(float)
	{
		if (!GQaSwordClip.IsValid())
		{
			return false;
		}
		FQaSwordClip& S = *GQaSwordClip;
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = QaDog(World);
		FWonderlandMissionHandoff* Handoff = QaHandoff(World);
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const int32 Skins = static_cast<int32>(UE_ARRAY_COUNT(FaceRoster));
		auto ReleaseKeys = [](ARelayDogCharacter* D)
		{
			if (D != nullptr)
			{
				D->QaForwardKey(false, false);
				D->QaWalkKey(false);
				D->QaRunKey(false);
			}
		};
		auto Stop = [&S, Skins, &ReleaseKeys](const TCHAR* Why)
		{
			// AN ABNORMAL STOP NAMES EVERY SKIN LEFT UNTESTED (Second's finding 9): a BLIND verdict, never a silent short count
			if (Why != nullptr)
			{
				for (int32 Untested = S.Skin; Untested < Skins; ++Untested)
				{
					S.Check(FString::Printf(TEXT("CL%d"), Untested + 1), false, FString::Printf(TEXT("BLIND -- %s not measured: %s"), FaceRoster[Untested], Why));
				}
			}
			if (UWorld* W = S.World.Get())
			{
				if (FWonderlandMissionHandoff* H = QaHandoff(W))
				{
					FString Ignored;
					H->Return(Ignored);
				}
				GEngine->Exec(W, TEXT("wl.Skins.Wear relay_og"));
				if (APlayerController* P = W->GetFirstPlayerController())
				{
					if (ARelayDogCharacter* D = QaDog(W))
					{
						ReleaseKeys(D);
						P->SetViewTargetWithBlend(D, 0.0f);
					}
				}
			}
			if (ACameraActor* Cam = S.Camera.Get())
			{
				Cam->Destroy();
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCLQA END pass=%d fail=%d expected=%d frames saved %d, failed %d%s"), S.Pass, S.Fail, Skins, S.FramesSaved,
				S.FramesFailed, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
			const bool bQuit = S.bQuit;
			GQaSwordClip.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Dog == nullptr || Handoff == nullptr || PC == nullptr)
		{
			return Stop(TEXT("the world, the Dog or the handoff went away"));
		}
		const double Now = QaNow();
		const double In = Now - S.PhaseAt;
		switch (S.Phase)
		{
		case 0:
		{
			if (UWonderlandUiSubsystem* Ui = QaUi(World))
			{
				if (Ui->IsWelcomeOpen())
				{
					Ui->DismissWelcome();
				}
			}
			if (In < 4.0 || !Dog->GetCharacterMovement()->IsMovingOnGround())
			{
				return In < 40.0 ? true : Stop(TEXT("never ready"));
			}
			QaClearHeading(World, Dog, 1500.0f, S.Ahead);
			S.StartYaw = static_cast<float>(S.Ahead.Rotation().Yaw);
			S.Start = Dog->GetActorLocation();
			S.Skin = 0;
			// THE SETTINGS THIS VERDICT COVERS (Second's finding 11): every Mission Handoff console variable, as it is now
			FString Settings;
			IConsoleManager::Get().ForEachConsoleObjectThatStartsWith(FConsoleObjectVisitor::CreateLambda([&Settings](const TCHAR* Name, IConsoleObject* Object)
			{
				if (IConsoleVariable* Variable = Object != nullptr ? Object->AsVariable() : nullptr)
				{
					Settings += FString::Printf(TEXT(" %s=%s"), Name, *Variable->GetString());
				}
			}), TEXT("wl.Handoff."));
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCLQA SETTINGS%s"), *Settings);
			S.Phase = 1;
			S.PhaseAt = Now;
			return true;
		}
		case 1:
			// ONE SKIN: the swords given back, the Dog home at the start, the skin worn
			if (S.Skin >= Skins)
			{
				return Stop(nullptr);
			}
			if (Handoff->IsEquipped())
			{
				if (Handoff->IsArmed())
				{
					FString Ignored;
					Handoff->Return(Ignored);
				}
				return In < 15.0 ? true : Stop(TEXT("the swords were never given back"));
			}
			ReleaseKeys(Dog);
			Dog->SetActorLocation(S.Start, false, nullptr, ETeleportType::TeleportPhysics);
			Dog->SetActorRotation(FRotator(0.0f, S.StartYaw, 0.0f));
			PC->SetControlRotation(FRotator(-12.0f, S.StartYaw, 0.0f));
			Dog->GetCharacterMovement()->StopMovementImmediately();
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), FaceRoster[S.Skin]));
			S.Phase = 2;
			S.PhaseAt = Now;
			return true;
		case 2:
		{
			if (In < 3.0)
			{
				return true;
			}
			// THE SKIN IS THE ONE ASKED FOR (Second's v2 review 7: a refused wear measured the previous body)
			const FName WornNow = Dog->GetWornSkinId();
			const bool bSkinOk = S.Skin == 0 ? (WornNow.IsNone() || WornNow == FName(TEXT("relay_og"))) : WornNow == FName(FaceRoster[S.Skin]);
			S.SkinWhy = bSkinOk ? FString() : FString::Printf(TEXT("the skin worn is '%s', not %s"), *WornNow.ToString(), FaceRoster[S.Skin]);
			FString Said;
			WonderlandHandoffDirector::Equip(QaLocalPlayer(World), Said);
			S.Stats.Reset();
			S.Stats.SetNum(static_cast<int32>(EQaClipPhase::Count));
			S.Step = static_cast<int32>(EQaClipPhase::Forming);
			S.StepAt = Now;
			S.LastSampleAt = -1.0;
			S.Shots = 0;
			S.DashShot = 0;
			S.bJumpAvailable = false;
			S.bJumpRead = false;
			S.bReturnAsked = false;
			S.bReturnAccepted = false;
			S.bSwordsLeft = false;
			S.ReturnWhy.Reset();
			S.Phase = 3;
			S.PhaseAt = Now;
			return true;
		}
		case 3:
		{
			const EQaClipPhase ClipStep = static_cast<EQaClipPhase>(S.Step);
			const double StepIn = Now - S.StepAt;
			FQaClipStats& Stats = S.Stats[S.Step];
			auto Next = [&S, Now, Dog, PC, &ReleaseKeys](EQaClipPhase To, bool bHome)
			{
				ReleaseKeys(Dog);
				S.Step = static_cast<int32>(To);
				S.StepAt = Now;
				S.DashKey = 0;
				if (bHome)
				{
					Dog->SetActorLocation(S.Start, false, nullptr, ETeleportType::TeleportPhysics);
					Dog->SetActorRotation(FRotator(0.0f, S.StartYaw, 0.0f));
					PC->SetControlRotation(FRotator(-12.0f, S.StartYaw, 0.0f));
					Dog->GetCharacterMovement()->StopMovementImmediately();
				}
				// the yaw a phase's turning is counted from, AFTER the trip home (a teleport is not a turn)
				S.LastYaw = static_cast<float>(Dog->GetActorRotation().Yaw);
			};
			// EVERY PHASE SAMPLED, at most 20 times a second
			if (Now - S.LastSampleAt >= 1.0 / 20.0)
			{
				S.LastSampleAt = Now;
				const bool bHeld = QaClipHeldPhase(ClipStep);
				const int32 BlindBefore = Stats.BlindSamples;
				QaClipMeasure(S, Dog, Stats, bHeld);
				if (bHeld && !Handoff->IsArmed())
				{
					++Stats.NotArmed;
				}
				// THIS PHASE'S CONTROLS on the very solid this sample measured: at its first sample, at its middle, and in a dash while dashing
				const bool bMid = !Stats.bMidControls && StepIn >= QaClipPhaseMid[S.Step] && QaClipPhaseMid[S.Step] > 0.0;
				const bool bInDash = ClipStep == EQaClipPhase::Dash && !Stats.bDashControls && Dog->IsDashing();
				if (Stats.BlindSamples == BlindBefore && (Stats.ControlsRun == 0 || bMid || bInDash))
				{
					Stats.bMidControls |= bMid;
					Stats.bDashControls |= bInDash;
					++Stats.ControlsRun;
					FString Detail;
					if (!QaClipControls(S, Dog, bHeld, Detail))
					{
						++Stats.ControlsBad;
						if (Stats.ControlsDetail.IsEmpty() || !Stats.ControlsDetail.Contains(TEXT("WRONG")))
						{
							Stats.ControlsDetail = Detail;
						}
					}
					else if (Stats.ControlsDetail.IsEmpty())
					{
						Stats.ControlsDetail = Detail;
					}
				}
				const float Yaw = static_cast<float>(Dog->GetActorRotation().Yaw);
				Stats.Turned += FMath::Abs(FMath::FindDeltaAngleDegrees(S.LastYaw, Yaw));
				S.LastYaw = Yaw;
				Stats.bLeftGround |= Dog->GetCharacterMovement()->IsFalling();
			}
			switch (ClipStep)
			{
			case EQaClipPhase::Forming:
				if (Handoff->IsArmed())
				{
					Next(EQaClipPhase::Stand, false);
				}
				else if (StepIn > 12.0)
				{
					Stats.Blind = TEXT("the swords were never held");
					S.Phase = 4;
				}
				return true;
			case EQaClipPhase::Stand:
			{
				// THE FISTS FROM THE SIDE AND FROM ABOVE (Second: "shoot the held fists from the side and from above")
				FVector LeftFist = FVector::ZeroVector;
				FVector RightFist = FVector::ZeroVector;
				const bool bFists = QaClipFist(Dog, true, LeftFist) && QaClipFist(Dog, false, RightFist);
				const FVector Toward = Dog->GetActorRightVector().GetSafeNormal2D();
				const FVector Front = Dog->GetActorForwardVector().GetSafeNormal2D();
				static const double ShotAt[] = { 0.5, 0.9, 1.3 };
				for (int32 ShotIndex = 0; ShotIndex < 3 && bFists; ++ShotIndex)
				{
					if (S.Shots == ShotIndex && StepIn >= ShotAt[ShotIndex])
					{
						const FVector Look = ShotIndex == 0 ? LeftFist : ShotIndex == 1 ? RightFist : (LeftFist + RightFist) * 0.5;
						const FVector From = ShotIndex == 0 ? LeftFist - Toward * 55.0 + FVector(0.0, 0.0, 8.0)
							: ShotIndex == 1 ? RightFist + Toward * 55.0 + FVector(0.0, 0.0, 8.0) : Look + FVector(0.0, 0.0, 110.0) + Front * 12.0;
						QaClipCamera(S, World, Look, From, ShotIndex == 2 ? 50.0f : 40.0f);
						S.Shots = ShotIndex + 10;
					}
					if (S.Shots == ShotIndex + 10 && StepIn >= ShotAt[ShotIndex] + 0.3)
					{
						static const TCHAR* const ShotNames[] = { TEXT("left_fist_side"), TEXT("right_fist_side"), TEXT("fists_from_above") };
						S.Frame(FString::Printf(TEXT("clip_%s_%s"), FaceRoster[S.Skin], ShotNames[ShotIndex]));
						S.Shots = ShotIndex + 1;
					}
				}
				if (StepIn >= 1.8 && PC->GetViewTarget() != Dog)
				{
					PC->SetViewTargetWithBlend(Dog, 0.0f);
				}
				if (StepIn >= 2.2)
				{
					Next(EQaClipPhase::Walk, true);
				}
				return true;
			}
			case EQaClipPhase::Walk:
				// THE PLAYER'S OWN KEYS (Second's v2 review 4): the walk modifier held
				Dog->QaWalkKey(true);
				Dog->AddMovementInput(S.Ahead, 1.0f);
				if (StepIn >= 2.0)
				{
					Next(EQaClipPhase::Jog, true);
				}
				return true;
			case EQaClipPhase::Jog:
				Dog->AddMovementInput(S.Ahead, 1.0f);
				if (StepIn >= 2.0)
				{
					Next(EQaClipPhase::Run, true);
				}
				return true;
			case EQaClipPhase::Run:
				Dog->QaRunKey(true);
				Dog->AddMovementInput(S.Ahead, 1.0f);
				if (StepIn >= 2.0)
				{
					S.DashBase = Dog->GetDashCount();
					Next(EQaClipPhase::Dash, true);
				}
				return true;
			case EQaClipPhase::Dash:
			{
				// THREE DASHES by the player's own double tap of W, each from home: run up, down, up, down, up (as the handoff QA's D1)
				const int32 DashIndex = FMath::Min(static_cast<int32>(StepIn / 1.8), 2);
				const double DashIn = StepIn - DashIndex * 1.8;
				if (DashIndex > 0 && S.DashKey == 4)
				{
					S.DashKey = 0;
					Dog->SetActorLocation(S.Start, false, nullptr, ETeleportType::TeleportPhysics);
					Dog->SetActorRotation(FRotator(0.0f, S.StartYaw, 0.0f));
					Dog->GetCharacterMovement()->StopMovementImmediately();
				}
				Dog->AddMovementInput(S.Ahead, 1.0f);
				if (S.DashKey == 0 && DashIn >= 0.5) { Dog->QaForwardKey(false, true); S.DashKey = 1; }
				if (S.DashKey == 1 && DashIn >= 0.55) { Dog->QaForwardKey(false, false); S.DashKey = 2; }
				if (S.DashKey == 2 && DashIn >= 0.60) { Dog->QaForwardKey(false, true); S.DashKey = 3; }
				if (S.DashKey == 3 && DashIn >= 1.10) { Dog->QaForwardKey(false, false); S.DashKey = 4; }
				Stats.Dashes = Dog->GetDashCount() - S.DashBase;
				// THE FISTS MID-DASH (Second: the -70 deg shoulders), ONLY WHILE THE DOG IS DASHING, the camera following them
				if (DashIndex == 1 && S.DashShot < 2 && Dog->IsDashing())
				{
					FVector LeftFist = FVector::ZeroVector;
					FVector RightFist = FVector::ZeroVector;
					if (QaClipFist(Dog, true, LeftFist) && QaClipFist(Dog, false, RightFist))
					{
						const FVector Look = (LeftFist + RightFist) * 0.5;
						QaClipCamera(S, World, Look, Look - Dog->GetActorRightVector().GetSafeNormal2D() * 130.0 + FVector(0.0, 0.0, 20.0), 55.0f);
						if (S.DashShot == 1)
						{
							S.Frame(FString::Printf(TEXT("clip_%s_fists_mid_dash"), FaceRoster[S.Skin]));
							S.DashShot = 2;
						}
						else
						{
							S.DashShot = 1;
						}
					}
				}
				if (S.DashShot >= 1 && DashIn >= 1.3 && PC->GetViewTarget() != Dog)
				{
					PC->SetViewTargetWithBlend(Dog, 0.0f);
				}
				if (StepIn >= 5.4)
				{
					Next(EQaClipPhase::Stop, false);
				}
				return true;
			}
			case EQaClipPhase::Stop:
				if (StepIn >= 1.5)
				{
					Next(EQaClipPhase::Turn, true);
				}
				return true;
			case EQaClipPhase::Turn:
				Dog->AddMovementInput(StepIn < 1.0 ? S.Ahead : -S.Ahead, 1.0f);
				if (StepIn >= 2.5)
				{
					Next(EQaClipPhase::Jump, true);
				}
				return true;
			case EQaClipPhase::Jump:
				// CAN IT JUMP, read on the ground after the trip home has settled (Second's v2 review 8)
				if (!S.bJumpRead && StepIn >= 0.3)
				{
					S.bJumpRead = true;
					S.bJumpAvailable = Dog->GetCharacterMovement()->IsMovingOnGround() && Dog->CanJump();
					if (S.bJumpAvailable)
					{
						Dog->Jump();
					}
				}
				if (StepIn >= 0.6)
				{
					Dog->StopJumping();
				}
				if (StepIn >= 1.8)
				{
					if (S.Skin == 0)
					{
						Next(EQaClipPhase::SkinChange, false);
						GEngine->Exec(World, TEXT("wl.Skins.Wear celestial_light"));
					}
					else
					{
						Next(EQaClipPhase::Return, false);
					}
				}
				return true;
			case EQaClipPhase::SkinChange:
				// A SKIN CHANGED WHILE THE SWORDS ARE HELD: Relay OG's run only, to celestial_light and back
				if (S.DashKey == 0 && StepIn >= 1.5)
				{
					GEngine->Exec(World, TEXT("wl.Skins.Wear relay_og"));
					S.DashKey = 1;
				}
				if (StepIn >= 3.0)
				{
					Next(EQaClipPhase::Return, false);
				}
				return true;
			case EQaClipPhase::Return:
				// THE RETURN, ASKED AND SEEN: its answer kept, and the swords must actually leave (Second's v2 review 9)
				if (!S.bReturnAsked)
				{
					S.bReturnAsked = true;
					S.bReturnAccepted = Handoff->Return(S.ReturnWhy);
				}
				if (StepIn >= 0.5 && !Handoff->IsEquipped())
				{
					S.bSwordsLeft = true;
				}
				if (S.bSwordsLeft || StepIn >= 3.0)
				{
					S.Phase = 4;
					S.PhaseAt = Now;
				}
				return true;
			default:
				return Stop(TEXT("an unknown step"));
			}
		}
		case 4:
		{
			// THE VERDICT FOR ONE SKIN: every phase happened and saw the body; its controls read right; nothing through or deeper than 3 uu in
			// the body; the swords held by drawn closed fists; no hand met by anything but its own grip's wrap; the swords apart; the fists
			// out of the body
			const IConsoleVariable* MoveMultiplierVar = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Handoff.MoveMultiplier"));
			const double Faster = MoveMultiplierVar != nullptr ? MoveMultiplierVar->GetFloat() : 1.0;
			const double WantSpeed[] = { Dog->WalkSpeedUU * Faster, Dog->JogSpeedUU * Faster, Dog->RunSpeedUU * Faster };
			const FQaClipStats& Stand = S.Stats[static_cast<int32>(EQaClipPhase::Stand)];
			FString Phases;
			FString Missing;
			double DeepestBody = 0.0;
			FString DeepestBodyPair;
			double GripContact = 0.0;
			double OtherContact = 0.0;
			double WorstHand = 0.0;
			FString WorstHandPair;
			int32 MaterialHits = 0;
			int32 PiercedParts = 0;
			FString PiercePair;
			int32 HandHits = 0;
			int32 HeldFaults = 0;
			FString HeldFaultWhy;
			double SwordCross = 0.0;
			double FistInBody = 0.0;
			int32 FistThrough = 0;
			FString FistInBodyPair;
			float Misalign[2] = { 0.0f, 0.0f };
			float Bend[2] = { 0.0f, 0.0f };
			int32 ControlsRun = 0;
			int32 ControlsBad = 0;
			FString StandControls = Stand.ControlsDetail;
			FString Note;
			for (int32 Index = 0; Index < static_cast<int32>(EQaClipPhase::Count); ++Index)
			{
				const EQaClipPhase Which = static_cast<EQaClipPhase>(Index);
				const FQaClipStats& One = S.Stats[Index];
				const bool bApplies = !(Which == EQaClipPhase::SkinChange && S.Skin != 0);
				if (!bApplies)
				{
					continue;
				}
				FString Why;
				const int32 WantSamples = Which == EQaClipPhase::Forming || Which == EQaClipPhase::Return ? 2 : 10;
				if (One.Samples < WantSamples)
				{
					Why = FString::Printf(TEXT("%d samples"), One.Samples);
				}
				else if (One.BlindSamples > 0)
				{
					Why = One.Blind;
				}
				else if (QaClipHeldPhase(Which) && One.NotArmed > 0)
				{
					Why = FString::Printf(TEXT("not armed in %d samples"), One.NotArmed);
				}
				else if (One.ControlsRun < (QaClipPhaseMid[Index] > 0.0 ? 2 : 1) || One.ControlsBad > 0)
				{
					Why = FString::Printf(TEXT("controls %d run, %d wrong (%s)"), One.ControlsRun, One.ControlsBad, *One.ControlsDetail);
				}
				switch (Which)
				{
				case EQaClipPhase::Walk:
				case EQaClipPhase::Jog:
				case EQaClipPhase::Run:
				{
					const double Want = WantSpeed[static_cast<int32>(Which) - static_cast<int32>(EQaClipPhase::Walk)];
					if (Why.IsEmpty() && (One.TopSpeed < Want * 0.8 || One.TopSpeed > Want * 1.2))
					{
						Why = FString::Printf(TEXT("top %.0f uu/s, not %.0f +-20%%"), One.TopSpeed, Want);
					}
					break;
				}
				case EQaClipPhase::Dash:
					if (Why.IsEmpty() && (One.Dashes < 3 || One.DashFrames < 6))
					{
						Why = FString::Printf(TEXT("%d dashes, %d dashing samples"), One.Dashes, One.DashFrames);
					}
					break;
				case EQaClipPhase::Stop:
					if (Why.IsEmpty() && One.LastSpeed > 30.0)
					{
						Why = FString::Printf(TEXT("still %.0f uu/s"), One.LastSpeed);
					}
					break;
				case EQaClipPhase::Turn:
					if (Why.IsEmpty() && One.Turned < 150.0)
					{
						Why = FString::Printf(TEXT("turned %.0f deg"), One.Turned);
					}
					break;
				case EQaClipPhase::Jump:
					if (Why.IsEmpty() && (!S.bJumpAvailable || !One.bLeftGround))
					{
						Why = S.bJumpAvailable ? TEXT("never off the ground") : TEXT("CanJump false on the ground");
					}
					break;
				case EQaClipPhase::SkinChange:
					if (Why.IsEmpty() && (!One.bCostumeSeen || !One.bCanonSeen || One.MinCostumeBoxes < One.FirstCostumeBoxes * 99 / 100
						|| One.MinCanonBoxes != Stand.MinCanonBoxes))
					{
						Why = FString::Printf(TEXT("bodies seen: skin %d, Relay OG %d; boxes %d of %d skin, %d of %d Relay OG"), One.bCostumeSeen ? 1 : 0, One.bCanonSeen ? 1 : 0,
							One.MinCostumeBoxes == MAX_int32 ? 0 : One.MinCostumeBoxes, One.FirstCostumeBoxes, One.MinCanonBoxes == MAX_int32 ? 0 : One.MinCanonBoxes,
							Stand.MinCanonBoxes == MAX_int32 ? 0 : Stand.MinCanonBoxes);
					}
					break;
				case EQaClipPhase::Return:
					if (Why.IsEmpty() && (!S.bReturnAccepted || !S.bSwordsLeft))
					{
						Why = FString::Printf(TEXT("the return %s, the swords %s"), S.bReturnAccepted ? TEXT("accepted") : *FString::Printf(TEXT("REFUSED (%s)"), *S.ReturnWhy),
							S.bSwordsLeft ? TEXT("gone") : TEXT("NEVER LEFT"));
					}
					break;
				default:
					break;
				}
				// THE FLOORS (Second's v2 review 6): Relay OG's boxes all there, a skin's within 1% of its stand; the body near each grip whenever
				// the stand had it there
				if (Why.IsEmpty() && Which != EQaClipPhase::SkinChange && Which != EQaClipPhase::Stand)
				{
					const bool bThinner = (One.MinCanonBoxes != MAX_int32 && Stand.MinCanonBoxes != MAX_int32 && One.MinCanonBoxes < Stand.MinCanonBoxes)
						|| (One.MinCostumeBoxes != MAX_int32 && Stand.MinCostumeBoxes != MAX_int32 && One.MinCostumeBoxes < Stand.MinCostumeBoxes * 99 / 100);
					const bool bLostGrip = (Stand.MinNearSword[0] != MAX_int32 && Stand.MinNearSword[0] > 0 && One.MinNearSword[0] == 0)
						|| (Stand.MinNearSword[1] != MAX_int32 && Stand.MinNearSword[1] > 0 && One.MinNearSword[1] == 0);
					if (bThinner || bLostGrip)
					{
						Why = FString::Printf(TEXT("the body thinner than the stand's (%d skin / %d Relay OG boxes) or gone from a grip (%d / %d near)"),
							One.MinCostumeBoxes == MAX_int32 ? 0 : One.MinCostumeBoxes, One.MinCanonBoxes == MAX_int32 ? 0 : One.MinCanonBoxes,
							One.MinNearSword[0] == MAX_int32 ? 0 : One.MinNearSword[0], One.MinNearSword[1] == MAX_int32 ? 0 : One.MinNearSword[1]);
					}
				}
				if (!Why.IsEmpty())
				{
					Missing += FString::Printf(TEXT("%s%s (%s)"), Missing.IsEmpty() ? TEXT("") : TEXT(", "), QaClipPhaseNames[Index], *Why);
				}
				Phases += FString::Printf(TEXT("%s%s %d f, top %.0f, deepest %.1f, through %d"), Phases.IsEmpty() ? TEXT("") : TEXT("; "), QaClipPhaseNames[Index],
					One.Samples, One.TopSpeed, One.DeepestBody, One.Pierced);
				UE_LOG(LogWonderlandQa, Display, TEXT("WLCLQA PHASE %s %s: %d samples (%d blind%s, %d unarmed), top %.0f uu/s, last %.0f, dashes %d (%d dashing samples), turned %.0f deg, off the ground %d; body boxes at least %d skin / %d Relay OG (the filter kept %d-%d of %d), within 30 uu of the grips %d/%d; controls %d run, %d wrong (%s); body deepest %.2f uu (%s), MATERIAL %d, THROUGH %d (%s); held faults %d (%s); grip in its fist %.2f, anything else on a hand %.2f, hand faults %d (%s); swords crossing %.2f; fists in the body %.2f (%s), through %d; misalign %.0f/%.0f deg, wrist %.0f/%.0f deg"),
					FaceRoster[S.Skin], QaClipPhaseNames[Index], One.Samples, One.BlindSamples, One.Blind.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(": %s"), *One.Blind),
					One.NotArmed, One.TopSpeed, One.LastSpeed, One.Dashes, One.DashFrames, One.Turned, One.bLeftGround ? 1 : 0,
					One.MinCostumeBoxes == MAX_int32 ? 0 : One.MinCostumeBoxes, One.MinCanonBoxes == MAX_int32 ? 0 : One.MinCanonBoxes,
					One.KeptLeast == MAX_int32 ? 0 : One.KeptLeast, One.KeptMost, One.AllMost,
					One.MinNearSword[0] == MAX_int32 ? 0 : One.MinNearSword[0], One.MinNearSword[1] == MAX_int32 ? 0 : One.MinNearSword[1],
					One.ControlsRun, One.ControlsBad, *One.ControlsDetail, One.DeepestBody, One.DeepestBodyPair.IsEmpty() ? TEXT("none") : *One.DeepestBodyPair,
					One.MaterialHits, One.Pierced, One.PiercePair.IsEmpty() ? TEXT("none") : *One.PiercePair, One.HeldFaults,
					One.HeldFaultWhy.IsEmpty() ? TEXT("none") : *One.HeldFaultWhy, One.GripContact, One.OtherContact, One.HandHits,
					One.WorstHandPair.IsEmpty() ? TEXT("none") : *One.WorstHandPair, One.SwordCross, One.FistInBody,
					One.FistInBodyPair.IsEmpty() ? TEXT("none") : *One.FistInBodyPair, One.FistThrough, One.Misalign[0], One.Misalign[1], One.Bend[0], One.Bend[1]);
				if (One.DeepestBody > DeepestBody)
				{
					DeepestBody = One.DeepestBody;
					DeepestBodyPair = FString::Printf(TEXT("%s, %s"), *One.DeepestBodyPair, QaClipPhaseNames[Index]);
				}
				if (One.WorstHand > WorstHand)
				{
					WorstHand = One.WorstHand;
					WorstHandPair = FString::Printf(TEXT("%s, %s"), *One.WorstHandPair, QaClipPhaseNames[Index]);
				}
				if (One.FistInBody > FistInBody)
				{
					FistInBody = One.FistInBody;
					FistInBodyPair = FString::Printf(TEXT("%s, %s"), *One.FistInBodyPair, QaClipPhaseNames[Index]);
				}
				if (PiercePair.IsEmpty() && !One.PiercePair.IsEmpty())
				{
					PiercePair = FString::Printf(TEXT("%s, %s"), *One.PiercePair, QaClipPhaseNames[Index]);
				}
				if (HeldFaultWhy.IsEmpty() && !One.HeldFaultWhy.IsEmpty())
				{
					HeldFaultWhy = FString::Printf(TEXT("%s, %s"), *One.HeldFaultWhy, QaClipPhaseNames[Index]);
				}
				GripContact = FMath::Max(GripContact, One.GripContact);
				OtherContact = FMath::Max(OtherContact, One.OtherContact);
				SwordCross = FMath::Max(SwordCross, One.SwordCross);
				MaterialHits += One.MaterialHits;
				PiercedParts += One.Pierced;
				HandHits += One.HandHits;
				HeldFaults += One.HeldFaults;
				FistThrough += One.FistThrough;
				ControlsRun += One.ControlsRun;
				ControlsBad += One.ControlsBad;
				for (int32 Side = 0; Side < 2; ++Side)
				{
					Misalign[Side] = FMath::Max(Misalign[Side], One.Misalign[Side]);
					Bend[Side] = FMath::Max(Bend[Side], One.Bend[Side]);
				}
				if (!One.Note.IsEmpty())
				{
					Note = One.Note;
				}
			}
			if (!S.SkinWhy.IsEmpty())
			{
				Missing += FString::Printf(TEXT("%s%s"), Missing.IsEmpty() ? TEXT("") : TEXT(", "), *S.SkinWhy);
			}
			const bool bSaw = Missing.IsEmpty();
			const bool bClean = MaterialHits == 0 && PiercedParts == 0 && HandHits == 0 && HeldFaults == 0 && SwordCross <= QaHandTouchUU && FistInBody <= 1.0
				&& FistThrough == 0;
			S.Check(FString::Printf(TEXT("CL%d"), S.Skin + 1), bSaw && bClean,
				FString::Printf(TEXT("%s, Equip to Return (the instrument %s): %s. Controls: %d run, %d wrong (the stand's: %s). Body as ONE solid: deepest %.1f uu (%s), %d part-samples MATERIAL (> %.0f uu), %d THROUGH a part at any depth%s. Held: %d faults%s. Hands: the grip in its own fist at most %.2f uu (allowed %.1f), anything else on a hand at most %.2f uu (allowed %.2f), %d faults%s. The swords crossing %.2f uu; the fists in the body %.2f uu%s, through it %d. Grip off the fist's wrap at most %.0f/%.0f deg, wrist bent at most %.0f/%.0f deg (gold/cyan)%s"),
					FaceRoster[S.Skin], bSaw ? TEXT("saw every phase") : *FString::Printf(TEXT("BLIND -- no verdict: %s"), *Missing), *Phases, ControlsRun, ControlsBad,
					StandControls.IsEmpty() ? TEXT("NOT RUN") : *StandControls, DeepestBody, DeepestBodyPair.IsEmpty() ? TEXT("none") : *DeepestBodyPair, MaterialHits,
					QaMaterialClipUU, PiercedParts, PiercePair.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (first: %s)"), *PiercePair), HeldFaults,
					HeldFaultWhy.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (first: %s)"), *HeldFaultWhy), GripContact, QaGripContactUU, OtherContact, QaHandTouchUU,
					HandHits, WorstHandPair.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (worst: %s)"), *WorstHandPair), SwordCross, FistInBody,
					FistInBodyPair.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *FistInBodyPair), FistThrough, Misalign[0], Misalign[1], Bend[0], Bend[1],
					Note.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; %s"), *Note)));
			ReleaseKeys(Dog);
			++S.Skin;
			S.Phase = 1;
			S.PhaseAt = Now;
			return true;
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSwordClipCommand(
		TEXT("wl.Qa.SwordClip"),
		TEXT("v3 (Second's eleven findings on v1, ten on v2): no sword through the body or a hand. Every skin from Equip to Return -- forming, ")
		TEXT("standing, the walk, jog and run KEYS, three dashes, a stop, a 180, a jump, a skin change while held (Relay OG), the return. The ")
		TEXT("body is ONE opaque solid (a skin's Lit/Rim/Glow parts; Relay OG's generator boxes, checked against its meshes); deeper than 3 uu ")
		TEXT("is MATERIAL and any part speared THROUGH fails at any depth; controls run in every phase. The swords must be held by drawn closed ")
		TEXT("fists with the grip inside the fingers; only the grip's wrap may meet its fist (1 uu). Fists framed from the side, above, mid-dash. ")
		TEXT("`quit` exits after. WLCLQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaSwordClip.IsValid() || World == nullptr)
			{
				return;
			}
			GQaSwordClip = MakeShared<FQaSwordClip>();
			GQaSwordClip->World = World;
			GQaSwordClip->bQuit = Args.Contains(TEXT("quit"));
			GQaSwordClip->PhaseAt = QaNow();
			GQaSwordClip->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLCLIP"));
			TArray<FString> OldFrames;
			IFileManager::Get().FindFiles(OldFrames, *(GQaSwordClip->Dir / TEXT("*.png")), true, false);
			for (const FString& OldFrame : OldFrames)
			{
				IFileManager::Get().Delete(*(GQaSwordClip->Dir / OldFrame));
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCLQA BEGIN | %s | %d old frame(s) cleared"), *WonderlandBeta::BuildLabel(), OldFrames.Num());
			GQaSwordClip->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaSwordClipTick), 0.0f);
		}));

	/* ================================================================ wl.Qa.CardDisk: what the PLAYER does to a C.A.R.D. reaches the disk
	 * Second's review (10-03, by real input): a card created, dressed, saved and switched in the game never reached Cards.sav -- the
	 * director changed the store in memory only, and M0's P1 passed because that QA called Save() itself. This QA drives the director
	 * exactly as the terminal does (HandleTerminalLine) and NEVER calls Save(): after each step it reads the C.A.R.D.s AS THE FILE
	 * HOLDS THEM (a fresh store loaded from the live store's own path).
	 *   CD0 the live store is the profile's Cards.sav, writable    CD1 /card new           CD2 /card select
	 *   CD3 /card attach x2 + /card detach 2                       CD4 /card rename        CD5 /card save (a skin worn first)
	 *   CD6 /card new + /card delete                               CD8 a key typed into /card attach: refused, absent from the
	 *                                                                  file's text, and masked in what the terminal shows
	 * `restart` (the same profile, booted again): CD7 the game's own store, loaded at boot, holds the renamed card ACTIVE with its
	 * skill and its saved skin, and not the deleted card. `quit` exits after. WLCDQA lines.
	 */
	struct FQaCardDisk
	{
		TWeakObjectPtr<UWorld> World;
		bool bQuit = false;
		bool bRestart = false;
		int32 Pass = 0;
		int32 Fail = 0;
		int32 Phase = 0;
		double PhaseAt = 0.0;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCDQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
	};
	TSharedPtr<FQaCardDisk> GQaCardDisk;

	/** The C.A.R.D.s as the FILE holds them: a fresh store loaded from the live store's own path -- never the live memory. */
	bool QaCardsOnDisk(const FWonderlandCardStore& Live, TArray<FWonderlandCard>& OutCards, FString& OutActiveId, FString& OutNote)
	{
		OutCards.Reset();
		OutActiveId.Reset();
		if (!FPaths::FileExists(Live.GetPath()))
		{
			OutNote = TEXT("no Cards.sav on disk");
			return false;
		}
		FWonderlandCardStore Disk(Live.GetPath());
		Disk.Load();
		OutCards = Disk.GetCards();
		OutActiveId = Disk.GetActiveId();
		OutNote = Disk.GetLoadNote();
		return OutNote.IsEmpty();
	}

	const FWonderlandCard* QaCardNamed(const TArray<FWonderlandCard>& Cards, const FString& Name)
	{
		return Cards.FindByPredicate([&Name](const FWonderlandCard& Card) { return Card.Name.Equals(Name, ESearchCase::CaseSensitive); });
	}

	/** One line typed into the terminal, answered as the terminal answers it; logged masked, as the terminal shows it. */
	FString QaCardType(UWorld* World, const FString& Line)
	{
		TArray<FString> Rows;
		WonderlandCardDirector::HandleTerminalLine(World, Line, Rows);
		const FString Answer = FString::Join(Rows, TEXT(" / "));
		UE_LOG(LogWonderlandQa, Display, TEXT("WLCDQA typed: %s -> %s"), *WonderlandCardDirector::MaskForEcho(Line), *WonderlandCardDirector::MaskForEcho(Answer));
		return Answer;
	}

	bool QaCardDiskTick(float)
	{
		if (!GQaCardDisk.IsValid())
		{
			return false;
		}
		FQaCardDisk& S = *GQaCardDisk;
		UWorld* World = S.World.Get();
		UWonderlandSidekickSubsystem* Sidekicks = QaSidekicks(World);
		ARelayDogCharacter* Dog = QaDog(World);
		auto Stop = [&S](const TCHAR* Why)
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCDQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
			const bool bQuit = S.bQuit;
			GQaCardDisk.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Sidekicks == nullptr)
		{
			return Stop(TEXT("the world or the sidekick subsystem went away"));
		}
		const double Now = QaNow();
		const double In = Now - S.PhaseAt;
		const FWonderlandCardStore& Live = Sidekicks->GetCardStore();
		TArray<FWonderlandCard> Cards;
		FString ActiveId;
		FString Note;
		if (S.Phase == 0)
		{
			if (UWonderlandUiSubsystem* Ui = QaUi(World))
			{
				if (Ui->IsWelcomeOpen())
				{
					Ui->DismissWelcome();
				}
			}
			if (In < 4.0 || Dog == nullptr || !Dog->GetCharacterMovement()->IsMovingOnGround())
			{
				return In < 40.0 ? true : Stop(TEXT("never ready"));
			}
			if (S.bRestart)
			{
				// CD7: the game loaded its store from the file at boot; nothing in this boot has written it
				const FWonderlandCard* Kept = QaCardNamed(Live.GetCards(), TEXT("QaDiskRenamed"));
				const bool bActive = Kept != nullptr && Live.GetActiveId() == Kept->Id;
				const bool bSkill = Kept != nullptr && Kept->Capabilities.Num() == 1 && Kept->Capabilities[0].Id == TEXT("qa_disk_skill");
				const bool bSkin = Kept != nullptr && Kept->Skin.Equals(TEXT("jack_flame"), ESearchCase::IgnoreCase);
				const bool bGone = QaCardNamed(Live.GetCards(), TEXT("QaDiskGone")) == nullptr;
				S.Check(TEXT("CD7"), bActive && bSkill && bSkin && bGone && Live.GetLoadNote().IsEmpty(),
					FString::Printf(TEXT("after a restart the game's own store (%s, load note '%s') holds %d C.A.R.D.(s): QaDiskRenamed %s, active %s, its skill %s, its skin %s; QaDiskGone %s"),
						*Live.GetPath(), *Live.GetLoadNote(), Live.GetCards().Num(), Kept != nullptr ? TEXT("present") : TEXT("MISSING"),
						bActive ? TEXT("yes") : TEXT("NO"), bSkill ? TEXT("kept") : TEXT("LOST"), Kept != nullptr ? *Kept->Skin : TEXT("-"),
						bGone ? TEXT("still deleted") : TEXT("BACK")));
				return Stop(nullptr);
			}
			S.Check(TEXT("CD0"), Live.GetPath() == FWonderlandCardStore::DefaultPath() && !Live.IsReadOnly(),
				FString::Printf(TEXT("the live store is %s (the profile's own: %s), writable %s; this QA never calls Save()"), *Live.GetPath(),
					Live.GetPath() == FWonderlandCardStore::DefaultPath() ? TEXT("yes") : TEXT("NO"), Live.IsReadOnly() ? TEXT("NO") : TEXT("yes")));

			QaCardType(World, TEXT("/card new QaDisk"));
			QaCardsOnDisk(Live, Cards, ActiveId, Note);
			const FWonderlandCard* Made = QaCardNamed(Cards, TEXT("QaDisk"));
			S.Check(TEXT("CD1"), Made != nullptr && Note.IsEmpty(), FString::Printf(TEXT("/card new QaDisk: the file holds %d C.A.R.D.(s), QaDisk %s (load note '%s')"),
				Cards.Num(), Made != nullptr ? TEXT("among them") : TEXT("ABSENT"), *Note));
			const FString MadeId = Made != nullptr ? Made->Id : FString();

			QaCardType(World, TEXT("/card select QaDisk"));
			QaCardsOnDisk(Live, Cards, ActiveId, Note);
			S.Check(TEXT("CD2"), !MadeId.IsEmpty() && ActiveId == MadeId, FString::Printf(TEXT("/card select QaDisk: the file's active C.A.R.D. is '%s' (want QaDisk's '%s')"), *ActiveId, *MadeId));

			QaCardType(World, TEXT("/card attach skill qa_disk_skill QaDiskSkill"));
			QaCardType(World, TEXT("/card attach skill qa_disk_two Two"));
			QaCardType(World, TEXT("/card detach 2"));
			QaCardsOnDisk(Live, Cards, ActiveId, Note);
			const FWonderlandCard* Dressed = QaCardNamed(Cards, TEXT("QaDisk"));
			const bool bOneSkill = Dressed != nullptr && Dressed->Capabilities.Num() == 1 && Dressed->Capabilities[0].Id == TEXT("qa_disk_skill");
			S.Check(TEXT("CD3"), bOneSkill, FString::Printf(TEXT("two attaches and /card detach 2: the file's QaDisk holds %d reference(s)%s"),
				Dressed != nullptr ? Dressed->Capabilities.Num() : -1, bOneSkill ? TEXT(", qa_disk_skill") : TEXT(" (want exactly qa_disk_skill)")));

			QaCardType(World, TEXT("/card rename QaDiskRenamed"));
			QaCardsOnDisk(Live, Cards, ActiveId, Note);
			const FWonderlandCard* Renamed = QaCardNamed(Cards, TEXT("QaDiskRenamed"));
			S.Check(TEXT("CD4"), Renamed != nullptr && Renamed->Id == MadeId && QaCardNamed(Cards, TEXT("QaDisk")) == nullptr,
				FString::Printf(TEXT("/card rename QaDiskRenamed: the file's card '%s' is %s"), *MadeId, Renamed != nullptr ? TEXT("renamed") : TEXT("NOT renamed")));

			GEngine->Exec(World, TEXT("wl.Skins.Wear jack_flame"));
			S.Phase = 1;
			S.PhaseAt = Now;
			return true;
		}
		if (S.Phase == 1)
		{
			if (In < 3.0)
			{
				return true;
			}
			QaCardType(World, TEXT("/card save"));
			QaCardsOnDisk(Live, Cards, ActiveId, Note);
			const FWonderlandCard* Saved = QaCardNamed(Cards, TEXT("QaDiskRenamed"));
			S.Check(TEXT("CD5"), Saved != nullptr && Saved->Skin.Equals(TEXT("jack_flame"), ESearchCase::IgnoreCase),
				FString::Printf(TEXT("jack_flame worn, /card save: the file's QaDiskRenamed wears '%s'"), Saved != nullptr ? *Saved->Skin : TEXT("(no card)")));

			QaCardType(World, TEXT("/card new QaDiskGone"));
			QaCardType(World, TEXT("/card delete QaDiskGone"));
			QaCardsOnDisk(Live, Cards, ActiveId, Note);
			const FWonderlandCard* Still = QaCardNamed(Cards, TEXT("QaDiskRenamed"));
			S.Check(TEXT("CD6"), QaCardNamed(Cards, TEXT("QaDiskGone")) == nullptr && Still != nullptr && ActiveId == Still->Id,
				FString::Printf(TEXT("/card new + /card delete QaDiskGone: the file %s it, and QaDiskRenamed is %s"),
					QaCardNamed(Cards, TEXT("QaDiskGone")) == nullptr ? TEXT("no longer holds") : TEXT("STILL holds"),
					Still != nullptr && ActiveId == Still->Id ? TEXT("still active") : TEXT("NOT active")));

			// CD8: a key typed where a reference belongs -- built at run time, so no key shape is in the binary
			const FString Key = FString(TEXT("s")) + TEXT("k-") + FGuid::NewGuid().ToString(EGuidFormats::Digits);
			const FString Typed = FString(TEXT("/card attach api ")) + Key;
			const FString Answer = QaCardType(World, Typed);
			const FString Shown = WonderlandCardDirector::MaskForEcho(Typed);
			FString FileText;
			FFileHelper::LoadFileToString(FileText, *Live.GetPath());
			const FString Front = Key.Left(16);
			const FString Back = Key.Right(16);
			auto Holds = [&Front, &Back, &Key](const FString& Text) { return Text.Contains(Key) || Text.Contains(Front) || Text.Contains(Back); };
			QaCardsOnDisk(Live, Cards, ActiveId, Note);
			const FWonderlandCard* After = QaCardNamed(Cards, TEXT("QaDiskRenamed"));
			const bool bRefused = After != nullptr && After->Capabilities.Num() == 1;
			S.Check(TEXT("CD8"), FWonderlandCardStore::LooksLikeSecret(Key) && bRefused && !FileText.IsEmpty() && !Holds(FileText) && !Holds(Shown) && !Holds(Answer),
				FString::Printf(TEXT("a run-time key typed into /card attach api: the store's refusal flags it %s; the card %s; the file's text %s; the terminal shows '%s'; the answer %s"),
					FWonderlandCardStore::LooksLikeSecret(Key) ? TEXT("yes") : TEXT("NO"), bRefused ? TEXT("still holds only its skill") : TEXT("TOOK IT"),
					FileText.IsEmpty() ? TEXT("could not be read") : (Holds(FileText) ? TEXT("HOLDS a part of it") : TEXT("holds no part of it")),
					*Shown, Holds(Answer) ? TEXT("REPEATS a part of it") : TEXT("repeats no part of it")));
			return Stop(nullptr);
		}
		return Stop(TEXT("an unknown phase"));
	}

	FAutoConsoleCommandWithWorldAndArgs GQaCardDiskCommand(
		TEXT("wl.Qa.CardDisk"),
		TEXT("What the player does to a C.A.R.D. reaches the disk (Second's review): the director driven as the terminal drives it, never ")
		TEXT("Save() by the QA, every step read back from Cards.sav (CD0-CD6, CD8 a typed key refused, off the file and masked on screen); ")
		TEXT("`restart`: CD7 the game's own store after a reboot on the same profile. `quit` exits after. WLCDQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaCardDisk.IsValid() || World == nullptr)
			{
				return;
			}
			GQaCardDisk = MakeShared<FQaCardDisk>();
			GQaCardDisk->World = World;
			GQaCardDisk->bQuit = Args.Contains(TEXT("quit"));
			GQaCardDisk->bRestart = Args.Contains(TEXT("restart"));
			GQaCardDisk->PhaseAt = QaNow();
			UE_LOG(LogWonderlandQa, Display, TEXT("WLCDQA BEGIN (%s) | %s"), GQaCardDisk->bRestart ? TEXT("restart") : TEXT("write"), *WonderlandBeta::BuildLabel());
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaCardDiskTick), 0.0f);
		}));

	/* ================================================================ wl.Qa.SecretInput: a key typed anywhere is never kept, never shown
	 * The founder: secrets are never persisted in the Project Brain or C.A.R.D.; fail-closed validation or redaction per field (10-03).
	 * The objective screen v2 (Second's direction; COMBO B measured on Second's corpus) REDACTS every flagged word and keeps the task:
	 * a CERTAIN shape always, a STATISTICAL one unless the player's explicit /keep. Keys are built at run time (no key shape in the
	 * binary). Every search proves itself first: a marker the QA put there must be FOUND in the same bytes.
	 *   SI4 (first) the control: an ordinary objective (a 12-character commit id in it) ACCEPTED, stored unchanged, its marker found
	 *   SI1 a key as an objective: accepted with the key REDACTED -- no part of it in the stored objective, the contracts file (as bytes
	 *       and as UTF-16) nor the log (whose own marker IS found)
	 *   SI2 the same with a zero-width space inside the key (which the raw rule misses): redacted too
	 *   SI3 what the terminal draws for typed lines (MaskForDisplay): no part of either key, nor of a short "Bearer" token
	 *   SI5 Second's certain shapes (an underscore-prefixed vendor key, a JWT-like token, password=..., a vendor key split by a
	 *       zero-width space) and a 24-hex run: each redacted on submit; the certain ones STILL redacted after /keep; none in the file
	 *       nor the log; masked on screen
	 *   SI6 ten real objectives (a pull-request URL, a UUID, a path, a version, a date, code identifiers, an e-mail) stored UNCHANGED
	 *   SI7 the transcription check: random letter/digit tokens of 20, 24, 32 and 44 (300 each, a FIXED seed) caught at COMBO B's
	 *       measured rates (99.7-100%), at least 95% -- the rate is reported, never a lucky token
	 *   SI8 /keep: a random-looking identifier redacted, then stored exactly as typed; a vendor key beside it still removed
	 *   SI9 C.A.R.D. (Second's finding 3): a 24-character key given as a card's name through the terminal is refused, never stored
	 *   SI10 credentials by their LABEL (Second's sink audit): a 12-character password after "password:", "pwd=", "passwd is",
	 *        "secret:"; a 16-hex value after "api key:" and "api_key:"; "Authorization: Basic <base64>"; a password in a URL's
	 *        userinfo; env-style and compound labels (DB_PASSWORD=, auth_token:, "secret key:") -- every one below the statistical
	 *        rules, every one redacted on submit, still after /keep, masked on screen
	 *   SI11 patterns a person types are not keys (round 4's card C6: ten thousand 'x' read as random): zero-entropy runs -- Zzzz..., abab...,
	 *        xxxx..., 1111..., lolol... -- stored exactly as typed (the statistical class needs 8 distinct characters, 6 for digits only)
	 */
	struct FQaSecretInput
	{
		TWeakObjectPtr<UWorld> World;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		double StartedAt = 0.0;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSIQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
	};
	TSharedPtr<FQaSecretInput> GQaSecretInput;

	/** True when the bytes hold the text as single bytes (a pure-ASCII string in a save) or as UTF-16LE. */
	bool QaBytesHold(const TArray<uint8>& Bytes, const FString& Needle)
	{
		for (int32 Wide = 0; Wide < 2; ++Wide)
		{
			TArray<uint8> Pattern;
			for (int32 Index = 0; Index < Needle.Len(); ++Index)
			{
				const uint32 Code = static_cast<uint32>(Needle[Index]);
				Pattern.Add(static_cast<uint8>(Code & 0xFF));
				if (Wide == 1)
				{
					Pattern.Add(static_cast<uint8>((Code >> 8) & 0xFF));
				}
			}
			if (Pattern.Num() == 0 || Pattern.Num() > Bytes.Num())
			{
				continue;
			}
			for (int32 At = 0; At + Pattern.Num() <= Bytes.Num(); ++At)
			{
				if (FMemory::Memcmp(Bytes.GetData() + At, Pattern.GetData(), Pattern.Num()) == 0)
				{
					return true;
				}
			}
		}
		return false;
	}

	bool QaSecretInputTick(float)
	{
		if (!GQaSecretInput.IsValid())
		{
			return false;
		}
		FQaSecretInput& S = *GQaSecretInput;
		UWorld* World = S.World.Get();
		UWonderlandMissionTaskSubsystem* Set = QaTaskSet(World);
		UWonderlandSidekickSubsystem* Sidekicks = QaSidekicks(World);
		ARelayDogCharacter* Dog = QaDog(World);
		auto Stop = [&S](const TCHAR* Why)
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSIQA END pass=%d fail=%d%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
			const bool bQuit = S.bQuit;
			GQaSecretInput.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Set == nullptr || Sidekicks == nullptr)
		{
			return Stop(TEXT("the world, the task set or the sidekick subsystem went away"));
		}
		if (QaNow() - S.StartedAt < 4.0 || Dog == nullptr || !Dog->GetCharacterMovement()->IsMovingOnGround())
		{
			return QaNow() - S.StartedAt < 40.0 ? true : Stop(TEXT("never ready"));
		}
		const FString Marker = TEXT("[a key: never shown or stored]");
		FRandomStream Stream(20261003);
		auto Random = [&Stream](const TCHAR* Alphabet, int32 Count)
		{
			const int32 Size = FCString::Strlen(Alphabet);
			FString Out;
			for (int32 Index = 0; Index < Count; ++Index)
			{
				Out.AppendChar(Alphabet[Stream.RandRange(0, Size - 1)]);
			}
			return Out;
		};
		const TCHAR* const Base62 = TEXT("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
		const TCHAR* const Base64Url = TEXT("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
		const FString Digits = FGuid::NewGuid().ToString(EGuidFormats::Digits);
		const FString Prefix = FString(TEXT("s")) + TEXT("k-");
		const FString KeyOne = Prefix + FGuid::NewGuid().ToString(EGuidFormats::Digits);
		FString KeyTwo = Prefix + Digits.Left(10);
		KeyTwo.AppendChar(static_cast<TCHAR>(0x200B));
		KeyTwo += Digits.Right(22);
		const FString KeyTwoWhole = Prefix + Digits;
		auto Parts = [](const FString& Key) { return TArray<FString>{ Key.Left(16), Key.Right(16) }; };
		auto Holds = [&Parts](const FString& Text, const FString& Key)
		{
			for (const FString& Part : Parts(Key))
			{
				if (Text.Contains(Part))
				{
					return true;
				}
			}
			return false;
		};
		// ONE OBJECTIVE THROUGH THE SCREEN, the door both the "+" tab and the terminal use: accepted, what was removed, what was kept
		struct FSubmitted
		{
			bool bAccepted = false;
			int32 Certain = 0;
			int32 Statistical = 0;
			FString Kept;
			FGuid Id;
			bool bNoSlot = false;
		};
		TArray<FGuid> SlotsMade;
		int32 SlotsMissed = 0;
		auto Submit = [Set, &SlotsMade, &SlotsMissed](const FString& Objective)
		{
			FSubmitted Out;
			Out.Id = Set->AddDraft();
			if (!Out.Id.IsValid())
			{
				// NO FREE TASK SLOT (round 4: six open, and every case after the sixth submitted into nothing): BLIND, never "lost"
				Out.bNoSlot = true;
				++SlotsMissed;
				return Out;
			}
			SlotsMade.Add(Out.Id);
			Out.bAccepted = Set->SubmitDraftScreened(Out.Id, Objective, false, Out.Certain, Out.Statistical);
			const FWonderlandMissionTask* Task = Set->Find(Out.Id);
			Out.Kept = Task != nullptr ? Task->Objective : FString();
			return Out;
		};
		// EVERY CASE GIVES ITS SLOTS BACK (the open tabs are capped at six): its drafts dismissed, its own contracts deleted -- none of
		// them ever held a run
		auto FreeSlots = [Set, &SlotsMade]()
		{
			for (const FGuid& Made : SlotsMade)
			{
				if (!Set->DismissDraft(Made))
				{
					Set->DeleteLocalContract(Made);
				}
			}
			SlotsMade.Reset();
		};
		// A CASE THAT FOUND NO SLOT IS BLIND: it fails, and says so
		int32 CaseMissedAt = 0;
		auto SlotNote = [&SlotsMissed, &CaseMissedAt]()
		{
			return SlotsMissed > CaseMissedAt ? FString::Printf(TEXT("BLIND: %d submission(s) found no free task slot -- "), SlotsMissed - CaseMissedAt) : FString();
		};
		auto ReadFile = []()
		{
			TArray<uint8> Bytes;
			FFileHelper::LoadFileToArray(Bytes, *UWonderlandMissionTaskSubsystem::SlotPath());
			return Bytes;
		};
		auto ReadLog = [](const FString& LogMarker, bool& bOutRead)
		{
			UE_LOG(LogWonderlandQa, Display, TEXT("%s"), *LogMarker);
			GLog->Flush();
			FString Text;
			// THE LOG IS OPEN FOR WRITING by the engine: a plain read asks for no writers and Windows refuses it (round 3b's SI1: "its
			// own marker NOT found: the log could not be read") -- read it as a file still being written
			FFileHelper::LoadFileToString(Text, *FPlatformOutputDevices::GetAbsoluteLogFilename(), FFileHelper::EHashOptions::None, FILEREAD_AllowWrite);
			bOutRead = Text.Contains(LogMarker);
			return Text;
		};

		// SI4 FIRST: the control -- the contracts file exists and the byte search is proven on it
		const FString ControlMarker = FString(TEXT("QaSI")) + Digits.Left(8);
		const FString Ordinary = FString::Printf(TEXT("fix the login bug from commit 3f9a2b7c1d0e -- %s"), *ControlMarker);
		CaseMissedAt = SlotsMissed;
		const FSubmitted Control = Submit(Ordinary);
		TArray<uint8> FileBytes = ReadFile();
		const bool bMarkerInFile = QaBytesHold(FileBytes, ControlMarker);
		S.Check(TEXT("SI4"), SlotsMissed == CaseMissedAt && Control.bAccepted && Control.Certain + Control.Statistical == 0 && Control.Kept == Ordinary && bMarkerInFile,
			SlotNote() + FString::Printf(TEXT("an ordinary objective with a 12-character commit id: %s, %s; its marker %s in the contracts file (%d bytes) -- the byte search %s"),
				Control.bAccepted ? TEXT("accepted") : TEXT("REFUSED"), Control.Kept == Ordinary ? TEXT("stored unchanged") : TEXT("ALTERED"),
				bMarkerInFile ? TEXT("found") : TEXT("NOT found"), FileBytes.Num(), bMarkerInFile ? TEXT("works") : TEXT("is BLIND")));
		FreeSlots();

		// SI1 and SI2: the keys as objectives
		CaseMissedAt = SlotsMissed;
		const FSubmitted One = Submit(FString::Printf(TEXT("deploy with %s please"), *KeyOne));
		const FSubmitted Two = Submit(FString::Printf(TEXT("deploy with %s please"), *KeyTwo));
		FileBytes = ReadFile();
		bool bInFile = QaBytesHold(FileBytes, Digits.Right(22));
		for (const FString& Part : Parts(KeyOne))
		{
			bInFile |= QaBytesHold(FileBytes, Part);
		}
		for (const FString& Part : Parts(KeyTwoWhole))
		{
			bInFile |= QaBytesHold(FileBytes, Part);
		}
		bool bLogRead = false;
		const FString LogText = ReadLog(FString(TEXT("WLSIQA log marker ")) + FGuid::NewGuid().ToString(EGuidFormats::Digits).Left(12), bLogRead);
		const bool bInLog = Holds(LogText, KeyOne) || Holds(LogText, KeyTwoWhole) || LogText.Contains(Digits.Right(22));
		const FString KeysSlotNote = SlotNote();
		const bool bKeysHadSlots = SlotsMissed == CaseMissedAt;
		S.Check(TEXT("SI1"), bKeysHadSlots && One.bAccepted && One.Certain >= 1 && One.Kept.Contains(Marker) && !Holds(One.Kept, KeyOne) && FileBytes.Num() > 0 && !bInFile && bLogRead && !bInLog,
			KeysSlotNote + FString::Printf(TEXT("a run-time key as an objective: %s with %d part(s) redacted; the stored objective '%s'; the contracts file (%d bytes) %s; the log (its own marker %s) %s"),
				One.bAccepted ? TEXT("accepted") : TEXT("REFUSED"), One.Certain + One.Statistical, *One.Kept, FileBytes.Num(),
				bInFile ? TEXT("HOLDS a part of a key") : TEXT("holds no part of either key"), bLogRead ? TEXT("found") : TEXT("NOT found: the log could not be read"),
				bInLog ? TEXT("HOLDS a part of a key") : TEXT("holds no part of either key")));
		S.Check(TEXT("SI2"), bKeysHadSlots && Two.bAccepted && Two.Certain + Two.Statistical >= 1 && !Holds(Two.Kept, KeyTwoWhole) && !Two.Kept.Contains(Digits.Right(22))
			&& !FWonderlandCardStore::LooksLikeSecret(KeyTwo) && FWonderlandCardStore::HoldsSecret(KeyTwo),
			KeysSlotNote + FString::Printf(TEXT("the key with a zero-width space inside (the raw rule alone misses it: %s): %s with %d part(s) redacted; the stored objective '%s'"),
				FWonderlandCardStore::LooksLikeSecret(KeyTwo) ? TEXT("it does NOT") : TEXT("yes"), Two.bAccepted ? TEXT("accepted") : TEXT("REFUSED"),
				Two.Certain + Two.Statistical, *Two.Kept));
		FreeSlots();

		// SI3: what the terminal draws
		const FString ShownOne = FWonderlandCardStore::MaskForDisplay(FString(TEXT("/card attach api ")) + KeyOne);
		const FString ShownTwo = FWonderlandCardStore::MaskForDisplay(FString::Printf(TEXT("deploy with %s please"), *KeyTwo));
		const FString Token = FString(TEXT("ab")) + TEXT("12cd");
		const FString ShownThree = FWonderlandCardStore::MaskForDisplay(FString(TEXT("Authorization: Bearer ")) + Token);
		// each drawn line: no part of its key, and the line as drawn does not itself read as holding one (the marker is not a key)
		auto ShownVerdict = [](bool bKeyGone, const FString& Shown)
		{
			return !bKeyGone ? FString(TEXT("A PART OF THE KEY SHOWS")) : FWonderlandCardStore::HoldsSecret(Shown) ? FString(TEXT("the drawn line STILL READS AS A KEY"))
				: FString(TEXT("clean"));
		};
		const bool bOneGone = !Holds(ShownOne, KeyOne);
		const bool bTwoGone = !Holds(ShownTwo, KeyTwoWhole) && !ShownTwo.Contains(Digits.Right(22));
		// "Bearer" is the scheme, not the credential: it stays readable and only the token is masked (Second, 10-03)
		const bool bThreeGone = !ShownThree.Contains(Token);
		const bool bSchemeReadable = ShownThree.StartsWith(TEXT("Authorization: Bearer ["));
		const bool bShownClean = bOneGone && bTwoGone && bThreeGone && bSchemeReadable && !FWonderlandCardStore::HoldsSecret(ShownOne)
			&& !FWonderlandCardStore::HoldsSecret(ShownTwo) && !FWonderlandCardStore::HoldsSecret(ShownThree);
		S.Check(TEXT("SI3"), bShownClean, FString::Printf(TEXT("the terminal draws '%s' (%s), '%s' (%s) and '%s' (%s; the scheme word %s)"), *ShownOne,
			*ShownVerdict(bOneGone, ShownOne), *ShownTwo, *ShownVerdict(bTwoGone, ShownTwo), *ShownThree, *ShownVerdict(bThreeGone, ShownThree),
			bSchemeReadable ? TEXT("readable, only the token masked") : TEXT("NOT readable: 'Bearer' was taken as the credential")));

		// SI5: Second's certain shapes (and a 24-hex run, statistical): redacted on submit; the certain ones still after /keep
		const FString VendorFront = FString(TEXT("xo")) + TEXT("xb-") + Random(Base62, 20) + TEXT("a1");
		const FString VendorBack = Random(Base62, 20) + TEXT("b2");
		FString SplitVendor = VendorFront;
		SplitVendor.AppendChar(static_cast<TCHAR>(0x200B));
		SplitVendor += VendorBack;
		struct FSecretShape
		{
			const TCHAR* Name;
			FString Value;
			FString Whole;
			bool bCertain;
		};
		TArray<FSecretShape> Shapes;
		{
			const FString Under = FString(TEXT("gh")) + TEXT("p_") + Random(Base62, 34) + TEXT("c3");
			Shapes.Add({ TEXT("an underscore-prefixed vendor key"), Under, Under, true });
			const FString Dotted = Random(Base64Url, 18) + TEXT("d4.") + Random(Base64Url, 18) + TEXT("e5.") + Random(Base64Url, 18) + TEXT("f6");
			Shapes.Add({ TEXT("a JWT-like token"), Dotted, Dotted, true });
			const FString Pass = FString(TEXT("pass")) + TEXT("word=") + Random(Base62, 10);
			Shapes.Add({ TEXT("password=..."), Pass, Pass, true });
			Shapes.Add({ TEXT("a vendor key split by a zero-width space"), SplitVendor, VendorFront + VendorBack, true });
			const FString Hex = Random(TEXT("0123456789abcdef"), 22) + TEXT("a7");
			Shapes.Add({ TEXT("a 24-hex run"), Hex, Hex, false });
		}
		FString ShapeDetail;
		bool bShapesClean = true;
		CaseMissedAt = SlotsMissed;
		for (const FSecretShape& Shape : Shapes)
		{
			const FString Typed = FString::Printf(TEXT("use %s for the deploy"), *Shape.Value);
			const FSubmitted Done = Submit(Typed);
			if (Done.bNoSlot)
			{
				ShapeDetail += FString::Printf(TEXT("%s%s NOT MEASURED (no slot)"), ShapeDetail.IsEmpty() ? TEXT("") : TEXT("; "), Shape.Name);
				continue;
			}
			bool bOk = Done.bAccepted && Done.Certain + Done.Statistical >= 1 && !Holds(Done.Kept, Shape.Whole)
				&& !Holds(FWonderlandCardStore::MaskForDisplay(Typed), Shape.Whole);
			if (bOk && Shape.bCertain)
			{
				int32 StillRemoved = 0;
				const bool bKeptCall = Set->KeepObjectiveAsTyped(Done.Id, Typed, StillRemoved);
				const FWonderlandMissionTask* After = Set->Find(Done.Id);
				bOk = bKeptCall && StillRemoved >= 1 && After != nullptr && !Holds(After->Objective, Shape.Whole);
			}
			bShapesClean &= bOk;
			ShapeDetail += FString::Printf(TEXT("%s%s %s"), ShapeDetail.IsEmpty() ? TEXT("") : TEXT("; "), Shape.Name,
				bOk ? (Shape.bCertain ? TEXT("redacted, and still after /keep") : TEXT("redacted")) : TEXT("GOT THROUGH"));
		}
		const TArray<uint8> ShapeBytes = ReadFile();
		bool bShapeLogRead = false;
		const FString ShapeLog = ReadLog(FString(TEXT("WLSIQA shape marker ")) + FGuid::NewGuid().ToString(EGuidFormats::Digits).Left(12), bShapeLogRead);
		bool bShapeOnDisk = false;
		for (const FSecretShape& Shape : Shapes)
		{
			for (const FString& Part : Parts(Shape.Whole))
			{
				bShapeOnDisk |= QaBytesHold(ShapeBytes, Part) || ShapeLog.Contains(Part);
			}
		}
		S.Check(TEXT("SI5"), SlotsMissed == CaseMissedAt && bShapesClean && !bShapeOnDisk && ShapeBytes.Num() > 0 && bShapeLogRead,
			SlotNote() + FString::Printf(TEXT("Second's shapes: %s; any part in the contracts file or the log (its marker %s): %s"), *ShapeDetail,
				bShapeLogRead ? TEXT("found") : TEXT("NOT found"), bShapeOnDisk ? TEXT("YES") : TEXT("none")));
		FreeSlots();

		// SI6: real objectives are tasks, not keys -- stored exactly as typed
		static const TCHAR* const RealObjectives[] = {
			TEXT("review PR https://github.com/i-wonder/sunday-relay/pull/1234 before Friday"),
			TEXT("check record 550e8400-e29b-41d4-a716-446655440000 in the contracts table"),
			TEXT("rename wonderland_social_backend_integration_test to social_e2e"),
			TEXT("update docs/architecture/MISSION_HANDOFF_CARD_ARCHITECTURE.md with the C.A.R.D. section"),
			TEXT("investigate why build 5b125d56 boots slowly on the laptop"),
			TEXT("support the DE-AT-CH locale and ISO-8601 dates like 2026-10-03T11:35:16Z"),
			TEXT("port handleOAuth2CallbackRequest to the new auth flow"),
			TEXT("add tests for SHA256HMACSigner2024 and the md5 fallback"),
			TEXT("set wl.Handoff.Stance.Crouch to 11 and wl.Handoff.Stance.FeetOut to 20"),
			TEXT("email beta-tester@example.com about the Saturday build"),
			// a label word with an ordinary word after it is not a credential (the control for round 5's label-then-value rule)
			TEXT("send the password reset link to the beta testers") };
		// EVERY ONE ACCEPTED and none loses a word for good (no certain find); the random-looking finds are EXACTLY the ones Second's
		// reference COMBO B flags on these ten -- one, SHA256HMACSigner2024 (three letter/digit switches; core_v2f_vs_comboB.py) -- and
		// each comes back exactly as typed by /keep. The statistical class is redacted-then-recoverable by design (COMBO B flags 2 of
		// Second's 23 real objectives): demanding none would test a screen this is not. The label rules lose no word of these ten, of
		// Second's 23, or of 31,974 identifiers (core_label_rule_check.py).
		static const TCHAR* const ReferenceFlags = TEXT("SHA256HMACSigner2024");
		int32 RealAsTyped = 0;
		int32 KeptBack = 0;
		int32 Lost = 0;
		bool bReferenceAgrees = true;
		FString RealDetail;
		CaseMissedAt = SlotsMissed;
		for (const TCHAR* Objective : RealObjectives)
		{
			const FSubmitted Done = Submit(Objective);
			if (Done.bNoSlot)
			{
				continue;
			}
			const bool bReferenceFlags = FCString::Strstr(Objective, ReferenceFlags) != nullptr;
			if (Done.bAccepted && Done.Certain + Done.Statistical == 0 && Done.Kept == Objective)
			{
				++RealAsTyped;
				bReferenceAgrees &= !bReferenceFlags;
				continue;
			}
			int32 StillCertain = 0;
			const bool bKeptCall = Done.bAccepted && Done.Certain == 0 && Set->KeepObjectiveAsTyped(Done.Id, Objective, StillCertain);
			const FWonderlandMissionTask* KeptTask = Set->Find(Done.Id);
			if (bKeptCall && StillCertain == 0 && KeptTask != nullptr && KeptTask->Objective == Objective)
			{
				++KeptBack;
				bReferenceAgrees &= bReferenceFlags;
				RealDetail += FString::Printf(TEXT("%s'%s' redacted as random-looking (%d), /keep gave it back exactly"), RealDetail.IsEmpty() ? TEXT("") : TEXT("; "),
					Objective, Done.Statistical);
			}
			else
			{
				++Lost;
				bReferenceAgrees = false;
				RealDetail += FString::Printf(TEXT("%sLOST '%s' -> '%s' (accepted %d, certain %d, random-looking %d)"), RealDetail.IsEmpty() ? TEXT("") : TEXT("; "),
					Objective, *Done.Kept, Done.bAccepted ? 1 : 0, Done.Certain, Done.Statistical);
			}
		}
		const int32 RealCount = static_cast<int32>(UE_ARRAY_COUNT(RealObjectives));
		S.Check(TEXT("SI6"), SlotsMissed == CaseMissedAt && RealAsTyped + KeptBack == RealCount && Lost == 0 && bReferenceAgrees,
			SlotNote() + FString::Printf(TEXT("%d real objectives (URL, UUID, path, version, date, identifiers, e-mail): %d stored exactly as typed at once, %d redacted as random-looking and given back exactly by /keep, %d lost; the random-looking finds %s Second's reference (it flags only %s)%s"),
				RealCount, RealAsTyped, KeptBack, Lost, bReferenceAgrees ? TEXT("MATCH") : TEXT("do NOT match"), ReferenceFlags,
				RealDetail.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" -- %s"), *RealDetail)));
		FreeSlots();

		// SI7: the transcription check -- a fixed seed, COMBO B's measured rates
		const int32 Lengths[] = { 20, 24, 32, 44 };
		FRandomStream RateStream(1003);
		bool bRatesIn = true;
		FString RateDetail;
		for (const int32 Length : Lengths)
		{
			int32 Caught = 0;
			for (int32 Sample = 0; Sample < 300; ++Sample)
			{
				FString RateToken;
				for (int32 Index = 0; Index < Length; ++Index)
				{
					RateToken.AppendChar(Base62[RateStream.RandRange(0, 61)]);
				}
				Caught += FWonderlandCardStore::HoldsSecret(FString::Printf(TEXT("please use %s for the deploy"), *RateToken)) ? 1 : 0;
			}
			const int32 Percent = FMath::RoundToInt(Caught * 100.0 / 300.0);
			bRatesIn &= Percent >= 95;
			RateDetail += FString::Printf(TEXT("%s%d chars %d%%"), RateDetail.IsEmpty() ? TEXT("") : TEXT("; "), Length, Percent);
		}
		S.Check(TEXT("SI7"), bRatesIn, FString::Printf(TEXT("random letter/digit tokens caught by shape (300 each, fixed seed; COMBO B measured 99.7-100%%, floor 95%%): %s"), *RateDetail));

		// SI8: /keep stores a random-looking identifier as typed -- never a certain shape beside it
		const FString Identifier = TEXT("clean up K8sClusterRBACv2Config before the release");
		CaseMissedAt = SlotsMissed;
		const FSubmitted Flagged = Submit(Identifier);
		int32 KeptRemoved = -1;
		const bool bIdentifierKept = Flagged.bAccepted && Set->KeepObjectiveAsTyped(Flagged.Id, Identifier, KeptRemoved);
		const FWonderlandMissionTask* AsTyped = Set->Find(Flagged.Id);
		const FString Vendor = FString(TEXT("gh")) + TEXT("p_") + Random(Base62, 34) + TEXT("e7");
		const FString Mixed = FString::Printf(TEXT("ship %s with K8sClusterRBACv2Config"), *Vendor);
		const FSubmitted MixedDone = Submit(Mixed);
		int32 MixedRemoved = 0;
		const bool bMixedCall = MixedDone.bAccepted && Set->KeepObjectiveAsTyped(MixedDone.Id, Mixed, MixedRemoved);
		const FWonderlandMissionTask* MixedTask = Set->Find(MixedDone.Id);
		const bool bMixedOk = bMixedCall && MixedRemoved >= 1 && MixedTask != nullptr && MixedTask->Objective.Contains(TEXT("K8sClusterRBACv2Config"))
			&& !Holds(MixedTask->Objective, Vendor);
		S.Check(TEXT("SI8"), SlotsMissed == CaseMissedAt && Flagged.Statistical >= 1 && Flagged.Certain == 0 && Flagged.Kept.Contains(Marker) && bIdentifierKept && KeptRemoved == 0 && AsTyped != nullptr
			&& AsTyped->Objective == Identifier && bMixedOk,
			SlotNote() + FString::Printf(TEXT("a random-looking identifier: redacted (%d statistical) then /keep stored it %s; beside a vendor key, /keep kept the identifier and removed the key: %s"),
				Flagged.Statistical, AsTyped != nullptr && AsTyped->Objective == Identifier ? TEXT("exactly as typed") : TEXT("NOT as typed"), bMixedOk ? TEXT("yes") : TEXT("NO")));
		FreeSlots();

		// SI9: C.A.R.D. -- a 24-character key as a card's name, through the terminal, is refused and never stored
		const FString CardKey = Random(Base62, 22) + TEXT("x9");
		TArray<FString> Rows;
		WonderlandCardDirector::HandleTerminalLine(World, FString(TEXT("/card new ")) + CardKey, Rows);
		const FWonderlandCardStore& Store = Sidekicks->GetCardStore();
		bool bCardKept = false;
		for (const FWonderlandCard& Card : Store.GetCards())
		{
			bCardKept |= Holds(Card.Name, CardKey);
		}
		TArray<uint8> CardBytes;
		FFileHelper::LoadFileToArray(CardBytes, *Store.GetPath());
		bool bCardOnDisk = false;
		for (const FString& Part : Parts(CardKey))
		{
			bCardOnDisk |= QaBytesHold(CardBytes, Part);
		}
		S.Check(TEXT("SI9"), FWonderlandCardStore::HoldsSecret(CardKey) && !bCardKept && !bCardOnDisk,
			FString::Printf(TEXT("a 24-character key given as a C.A.R.D. name through the terminal: the screen flags it %s; a card holds it: %s; Cards.sav (%d bytes) holds a part: %s"),
				FWonderlandCardStore::HoldsSecret(CardKey) ? TEXT("yes") : TEXT("NO"), bCardKept ? TEXT("YES") : TEXT("no"), CardBytes.Num(), bCardOnDisk ? TEXT("YES") : TEXT("no")));

		// SI10: credentials by their LABEL -- values no statistic sees, taken with the label that names them
		const FString ShortPassword = FString(TEXT("Tr0ub")) + TEXT("4dor&3x");
		const FString HexValue = Random(TEXT("0123456789abcdef"), 14) + TEXT("9f");
		const FString BasicValue = FString(TEXT("dXNlcj")) + TEXT("pwYXNz");
		// the URL's scheme in halves: the release scan reads the package for the whole one, and a hit there must mean a real leak
		const FString DatabaseScheme = FString(TEXT("postg")) + TEXT("res");
		const FString Labelled[] = {
			FString::Printf(TEXT("login with password: %s today"), *ShortPassword),
			FString::Printf(TEXT("set pwd=%s on the box"), *ShortPassword),
			FString::Printf(TEXT("the passwd is %s for now"), *ShortPassword),
			FString::Printf(TEXT("rotate the secret: %s soon"), *ShortPassword),
			FString::Printf(TEXT("use api key: %s for staging"), *HexValue),
			FString::Printf(TEXT("restore api_key: %s from the vault"), *HexValue),
			FString::Printf(TEXT("send Authorization: Basic %s to the proxy"), *BasicValue),
			FString::Printf(TEXT("migrate %s://app:%s@10.0.0.5/prod tonight"), *DatabaseScheme, *ShortPassword),
			FString::Printf(TEXT("export DB_PASSWORD=%s before the run"), *ShortPassword),
			FString::Printf(TEXT("rotate auth_token: %s weekly"), *ShortPassword),
			FString::Printf(TEXT("the secret key: %s is old"), *ShortPassword),
			// a label then its value, nothing between (Second's real-input leak on round 4)
			FString::Printf(TEXT("the passwd %s is on the card"), *ShortPassword),
			FString::Printf(TEXT("my password %s for staging"), *ShortPassword) };
		auto HoldsValue = [&ShortPassword, &HexValue, &BasicValue](const FString& Text)
		{
			return Text.Contains(ShortPassword) || Text.Contains(HexValue) || Text.Contains(BasicValue);
		};
		int32 LabelledClean = 0;
		FString LabelledDetail;
		CaseMissedAt = SlotsMissed;
		for (const FString& Typed : Labelled)
		{
			const FSubmitted Done = Submit(Typed);
			if (Done.bNoSlot)
			{
				continue;
			}
			int32 Still = 0;
			const bool bKeepCall = Done.bAccepted && Set->KeepObjectiveAsTyped(Done.Id, Typed, Still);
			const FWonderlandMissionTask* After = Set->Find(Done.Id);
			const FString Stored = After != nullptr ? After->Objective : Done.Kept;
			const bool bClean = Done.bAccepted && Done.Certain >= 1 && !HoldsValue(Done.Kept) && bKeepCall && Still >= 1 && !HoldsValue(Stored)
				&& !HoldsValue(FWonderlandCardStore::MaskForDisplay(Typed));
			LabelledClean += bClean ? 1 : 0;
			if (!bClean)
			{
				// WHICH PART FAILED (Second: round 4's list showed masked text and no reason)
				LabelledDetail += FString::Printf(TEXT("%s'%s' (accepted %d, certain %d, the stored text %s, /keep %s with %d still removed, kept after /keep %s, on screen %s)"),
					LabelledDetail.IsEmpty() ? TEXT("") : TEXT(", "), *FWonderlandCardStore::MaskForDisplay(Typed), Done.bAccepted ? 1 : 0, Done.Certain,
					HoldsValue(Done.Kept) ? TEXT("HOLDS IT") : TEXT("clean"), bKeepCall ? TEXT("ran") : TEXT("REFUSED"), Still,
					HoldsValue(Stored) ? TEXT("HOLDS IT") : TEXT("clean"), HoldsValue(FWonderlandCardStore::MaskForDisplay(Typed)) ? TEXT("SHOWS IT") : TEXT("masked"));
			}
		}
		// THE VALUE WHOLE (round 5): a password ending in punctuation keeps no part of itself -- trimmed, "password: <v>!" left its "!" behind
		const FString Bang = FString::Printf(TEXT("login with password: %s! today"), *ShortPassword);
		const FSubmitted BangDone = Submit(Bang);
		const bool bBangWhole = !BangDone.bNoSlot && BangDone.bAccepted && BangDone.Certain >= 1 && !BangDone.Kept.Contains(TEXT("]!")) && !HoldsValue(BangDone.Kept);
		S.Check(TEXT("SI10"), SlotsMissed == CaseMissedAt && LabelledClean == static_cast<int32>(UE_ARRAY_COUNT(Labelled)) && bBangWhole,
			SlotNote() + FString::Printf(TEXT("%d of %d labelled credentials (password: / pwd= / passwd is / secret: / api key: / api_key: / Basic / URL userinfo / a label then its value) redacted on submit, still after /keep, masked on screen%s"),
				LabelledClean, static_cast<int32>(UE_ARRAY_COUNT(Labelled)), LabelledDetail.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; GOT THROUGH: %s"), *LabelledDetail))
				+ FString::Printf(TEXT("; a password ending in '!' redacted whole: %s (stored '%s')"), bBangWhole ? TEXT("yes") : TEXT("NO"), *BangDone.Kept));
		FreeSlots();

		// SI11: PATTERNS A PERSON TYPES ARE NOT KEYS (Second's degenerate strings; round 4's card C6)
		static const TCHAR* const Patterns[] = {
			TEXT("rename Zzzzzzzzzzzzzzzzzzzzzzzz to the sleepy one"),
			TEXT("repeat abababababababababababab twice"),
			TEXT("replace the xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx placeholder"),
			TEXT("count 11111111111111111111 ones"),
			TEXT("stop the lolololololololololololol spam") };
		int32 PatternsKept = 0;
		FString PatternsAltered;
		CaseMissedAt = SlotsMissed;
		for (const TCHAR* Pattern : Patterns)
		{
			const FSubmitted Done = Submit(Pattern);
			if (Done.bNoSlot)
			{
				continue;
			}
			if (Done.bAccepted && Done.Certain + Done.Statistical == 0 && Done.Kept == Pattern)
			{
				++PatternsKept;
			}
			else
			{
				PatternsAltered += FString::Printf(TEXT("%s'%s' -> '%s'"), PatternsAltered.IsEmpty() ? TEXT("") : TEXT(", "), Pattern, *Done.Kept);
			}
		}
		const int32 PatternCount = static_cast<int32>(UE_ARRAY_COUNT(Patterns));
		S.Check(TEXT("SI11"), SlotsMissed == CaseMissedAt && PatternsKept == PatternCount,
			SlotNote() + FString::Printf(TEXT("%d of %d typed patterns (Zzzz, abab, xxxx, 1111, lolol runs of 20+) stored exactly as typed%s"), PatternsKept, PatternCount,
				PatternsAltered.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; ALTERED: %s"), *PatternsAltered)));

		// SI12: THE SCREEN IS IDEMPOTENT, AND A RESTART KEEPS WHAT /keep GAVE (Second's R8a: the restore re-redacted "client secret: [marker]"
		// on every load; CORE's read of the same code: it also took back every /keep). Every line this QA typed, screened twice, is what it
		// was screened once; the restore's own rule (ScreenRestoredObjective) leaves a /keep'd word and a stored marker alone and still
		// redacts a key nobody kept
		TArray<FString> EveryLine = { Ordinary, FString::Printf(TEXT("deploy with %s please"), *KeyOne), FString::Printf(TEXT("deploy with %s please"), *KeyTwo),
			FString(TEXT("Authorization: Bearer ")) + Token, Bang };
		for (const FSecretShape& Shape : Shapes)
		{
			EveryLine.Add(FString::Printf(TEXT("use %s for the deploy"), *Shape.Value));
		}
		for (const TCHAR* Objective : RealObjectives)
		{
			EveryLine.Add(Objective);
		}
		for (const FString& Typed : Labelled)
		{
			EveryLine.Add(Typed);
		}
		for (const TCHAR* Pattern : Patterns)
		{
			EveryLine.Add(Pattern);
		}
		int32 NotIdempotent = 0;
		FString FirstNotIdempotent;
		for (const FString& Line : EveryLine)
		{
			const FString Once = FWonderlandCardStore::MaskForDisplay(Line);
			const FString Twice = FWonderlandCardStore::MaskForDisplay(Once);
			if (!Once.Equals(Twice, ESearchCase::CaseSensitive))
			{
				++NotIdempotent;
				if (FirstNotIdempotent.IsEmpty())
				{
					FirstNotIdempotent = FString::Printf(TEXT("'%s' -> '%s'"), *Once, *Twice);
				}
			}
		}
		CaseMissedAt = SlotsMissed;
		const FString KeepWord = TEXT("clean up K8sClusterRBACv2Config before the release");
		const FSubmitted KeepDone = Submit(KeepWord);
		int32 KeepRemoved = 0;
		const bool bKeepRan = KeepDone.bAccepted && Set->KeepObjectiveAsTyped(KeepDone.Id, KeepWord, KeepRemoved);
		const FWonderlandMissionTask* KeptTask = Set->Find(KeepDone.Id);
		bool bKeptRescreened = true;
		const FString KeptRestored = KeptTask != nullptr ? UWonderlandMissionTaskSubsystem::ScreenRestoredObjective(*KeptTask, bKeptRescreened) : FString();
		const bool bKeepSurvives = bKeepRan && KeptTask != nullptr && !bKeptRescreened && KeptRestored.Equals(KeepWord, ESearchCase::CaseSensitive);
		const FSubmitted MarkerDone = Submit(FString::Printf(TEXT("deploy with %s please"), *KeyOne));
		const FWonderlandMissionTask* MarkerTask = Set->Find(MarkerDone.Id);
		bool bMarkerRescreened = true;
		const FString MarkerRestored = MarkerTask != nullptr ? UWonderlandMissionTaskSubsystem::ScreenRestoredObjective(*MarkerTask, bMarkerRescreened) : FString();
		const bool bMarkerStable = MarkerTask != nullptr && !bMarkerRescreened && MarkerRestored.Equals(MarkerTask->Objective, ESearchCase::CaseSensitive);
		// a key from before the screen, never kept: built in memory, as a legacy file would bring it back
		FWonderlandMissionTask Legacy;
		const FString LegacyToken = Random(Base62, 30) + TEXT("q7");
		Legacy.Objective = FString::Printf(TEXT("use %s for the deploy"), *LegacyToken);
		bool bLegacyRescreened = false;
		const FString LegacyRestored = UWonderlandMissionTaskSubsystem::ScreenRestoredObjective(Legacy, bLegacyRescreened);
		const bool bLegacyRedacted = bLegacyRescreened && !Holds(LegacyRestored, LegacyToken);
		S.Check(TEXT("SI12"), SlotsMissed == CaseMissedAt && NotIdempotent == 0 && bKeepSurvives && bMarkerStable && bLegacyRedacted,
			SlotNote() + FString::Printf(TEXT("%d of %d typed lines screened twice equal screened once%s; the restore's rule: a /keep'd word %s, a stored marker %s, a key nobody kept %s"),
				EveryLine.Num() - NotIdempotent, EveryLine.Num(), FirstNotIdempotent.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (first that changed: %s)"), *FirstNotIdempotent),
				bKeepSurvives ? TEXT("survives a restart's screen") : *FString::Printf(TEXT("is TAKEN BACK ('%s')"), *KeptRestored),
				bMarkerStable ? TEXT("is left alone") : *FString::Printf(TEXT("is RE-REDACTED ('%s')"), *MarkerRestored),
				bLegacyRedacted ? TEXT("is redacted") : TEXT("SURVIVES")));
		FreeSlots();

		FreeSlots();
		return Stop(nullptr);
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSecretInputCommand(
		TEXT("wl.Qa.SecretInput"),
		TEXT("A key typed anywhere is never kept and never shown (the founder's fail-closed; Second's review): objectives keep the task and lose ")
		TEXT("the key (SI1-SI2, SI5), real objectives stay as typed (SI6), the terminal masks (SI3), COMBO B's rates hold (SI7), /keep never ")
		TEXT("stores a certain shape (SI8), a key cannot name a C.A.R.D. (SI9). `quit` exits after. WLSIQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaSecretInput.IsValid() || World == nullptr)
			{
				return;
			}
			GQaSecretInput = MakeShared<FQaSecretInput>();
			GQaSecretInput->World = World;
			GQaSecretInput->bQuit = Args.Contains(TEXT("quit"));
			GQaSecretInput->StartedAt = QaNow();
			UE_LOG(LogWonderlandQa, Display, TEXT("WLSIQA BEGIN | %s"), *WonderlandBeta::BuildLabel());
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaSecretInputTick), 0.0f);
		}));

	/* ================================================================ wl.Qa.ActHands: hands seen holding, never through a prop
	 * The founder (10-03): a founder-facing PASS needs VISIBLE proof that the hands and fingers do not pass through the props, in
	 * close frames of each prop, the scraper included. Second (10-03): a PASS by absence proves nothing; then eleven findings on its
	 * first rebuild (9383e168) -- frames counted that never saved, controls that bypassed the measure, absolute bars a half-buried
	 * finger passes, a line of sight blind to the Dog's own body, no per-prop gate, a vacuous HP7, aborts without a verdict. So:
	 *   HP1/HP3 Relay OG / celestial_light through a real mission fixture, EVERY frame: the brush (and the scraper, if the fixture
	 *        shows it) held in the tool hand's drawn closed fist (>= 10 brush frames), measured box against box each frame -- no hand
	 *        box more than 45% of its own thickness into a prop, no prop more than 0.5 uu into a forearm's own blocks; the book and
	 *        the glass (>= 10 frames each) with no hand drawn (not held yet); the sets seen must include book, brush and glass
	 *   HP2/HP4 after the mission both hands back, open
	 *   HP5 ALL SIX skins: every prop act posed through SetMissionAct (wl.Dog.Act, the call a mission's beats make), each act's OWN prop
	 *        waited for (the scraper's too); the tools framed from the side, three-quarters and a fist close-up, the book and the glass
	 *        from the side and three-quarters; each view's line of sight clear of the world AND of the Dog's own body (its head, its
	 *        other arm); every frame actually SAVED -- 60 of them
	 *   HP6 the TOOLS, every tick of each held act and at every shot: the hand drawn whole round the tool, the depth bars above, and
	 *        two planted controls run through the very same measure -- the handle pushed 3 uu toward the palm must break the hand bar,
	 *        a box planted in the tool-side forearm's block must break the arm bar -- with the boxes counted (props, arms per side)
	 *   HP7 the BOOK and the GLASS the same way, plus CONTACT (a holding hand within 0.5 uu of the prop) and a palm control: FAILS
	 *        until they are held (their hands still step aside)
	 * An aborted run marks every unchecked HP as SKIPPED (a fail). Frames to Saved/Screenshots/WLACTS (cleared at BEGIN); WLAHQA lines,
	 * one SHOT line per frame with its depths, counts, controls, hand size and the Contract the act works on.
	 */
	/** How far a hand box may go into a prop: a share of the hand box's own thickness (its thinnest side), so a small hand gets no slack. */
	constexpr double QaActHandShareBar = 0.45;
	/** How far a prop may go into a forearm's own blocks. */
	constexpr double QaActPropArmBarUU = 0.5;

	/** The act's boxes as drawn now: the tool hand's [0] and the other's [1], the props shown, the forearms' own blocks (per side). */
	struct FQaActBoxes
	{
		TArray<FQaObb> Hands[2];
		TArray<FQaObb> Props;
		TArray<FQaObb> Arms;
		int32 ArmsBySide[2] = { 0, 0 };
		int32 HandleIndex = INDEX_NONE;
		float HandSize[2] = { 0.0f, 0.0f };
	};

	void QaActBoxReach(FQaObb& Box)
	{
		for (int32 AxisAt = 0; AxisAt < 3; ++AxisAt)
		{
			Box.Reach[AxisAt] = Box.Half.X * FMath::Abs(Box.Axis[0][AxisAt]) + Box.Half.Y * FMath::Abs(Box.Axis[1][AxisAt])
				+ Box.Half.Z * FMath::Abs(Box.Axis[2][AxisAt]);
		}
	}

	bool QaActHangsFrom(const USceneComponent* Part, const USceneComponent* Arm)
	{
		for (const USceneComponent* Up = Part; Up != nullptr && Arm != nullptr; Up = Up->GetAttachParent())
		{
			if (Up == Arm)
			{
				return true;
			}
		}
		return false;
	}

	void QaActBoxes(const ARelayDogCharacter* Dog, FQaActBoxes& Out)
	{
		const bool bLeftTool = Dog->IsToolHandLeft();
		for (int32 Which = 0; Which < 2; ++Which)
		{
			const bool bLeftSide = Which == 0 ? bLeftTool : !bLeftTool;
			const WonderlandHands::FHand& SideHand = Dog->GetHand(bLeftSide);
			TArray<const UStaticMeshComponent*> HandParts;
			SideHand.GetBoxes(HandParts);
			for (const UStaticMeshComponent* HandPart : HandParts)
			{
				if (HandPart != nullptr && HandPart->IsVisible() && HandPart->GetStaticMesh() != nullptr)
				{
					QaMeshObbs(HandPart, Out.Hands[Which]);
				}
			}
			// THE ARM'S OWN BLOCKS, every level down (a skin's forearm can nest its meshes): not the props riding on it, not the hand
			if (const USceneComponent* ArmOn = Dog->GetVisibleForearm(bLeftSide))
			{
				Out.HandSize[Which] = SideHand.GetSize() * static_cast<float>(ArmOn->GetComponentTransform().GetScale3D().GetAbsMin());
				const int32 Before = Out.Arms.Num();
				TArray<USceneComponent*> ArmChildren;
				ArmOn->GetChildrenComponents(true, ArmChildren);
				ArmChildren.Add(const_cast<USceneComponent*>(ArmOn));
				for (const USceneComponent* ArmChild : ArmChildren)
				{
					const UStaticMeshComponent* ArmBlock = Cast<UStaticMeshComponent>(ArmChild);
					if (ArmBlock == nullptr || !ArmBlock->IsVisible() || ArmBlock->GetStaticMesh() == nullptr || ArmBlock->ComponentHasTag(TEXT("WL_Prop")))
					{
						continue;
					}
					const FString BlockName = ArmBlock->GetName();
					if (BlockName.StartsWith(TEXT("Mission")) || BlockName.StartsWith(TEXT("Verification")) || BlockName.StartsWith(TEXT("WonderlandHand"))
						|| BlockName.StartsWith(TEXT("HandoffSword")))
					{
						continue;
					}
					QaMeshObbs(ArmBlock, Out.Arms);
				}
				Out.ArmsBySide[Which] = Out.Arms.Num() - Before;
			}
		}
		// THE PROPS: the Dog's own Mission* parts, wherever they ride now (a held tool rides on the visible forearm, a skin's or Relay OG's)
		const UInstancedStaticMeshComponent* ToolMesh = Dog->GetShownToolHandle();
		TInlineComponentArray<UStaticMeshComponent*> DogMeshes;
		Dog->GetComponents<UStaticMeshComponent>(DogMeshes);
		for (const UStaticMeshComponent* DogMesh : DogMeshes)
		{
			if (DogMesh != nullptr && DogMesh->IsVisible() && DogMesh->GetStaticMesh() != nullptr && DogMesh->GetName().StartsWith(TEXT("Mission"))
				&& !DogMesh->GetName().StartsWith(TEXT("MissionEnergy")))
			{
				const int32 First = Out.Props.Num();
				QaMeshObbs(DogMesh, Out.Props);
				if (DogMesh == ToolMesh && Out.Props.Num() > First)
				{
					Out.HandleIndex = First;
				}
			}
		}
	}

	/** The deepest overlap between any box of A and any of B (uu; 0 when none touch), and which pair. */
	double QaDeepestPair(const TArray<FQaObb>& A, const TArray<FQaObb>& B, FString& OutPair)
	{
		double Deepest = 0.0;
		for (const FQaObb& FromA : A)
		{
			for (const FQaObb& FromB : B)
			{
				const double PairDepth = QaObbDepth(FromA, FromB);
				if (PairDepth > Deepest)
				{
					Deepest = PairDepth;
					OutPair = FString::Printf(TEXT("%s in %s"), FromA.Mesh != nullptr ? *FromA.Mesh->GetName() : TEXT("planted"),
						FromB.Mesh != nullptr ? *FromB.Mesh->GetName() : TEXT("planted"));
				}
			}
		}
		return Deepest;
	}

	/** The deepest a hand box goes into a prop as a SHARE OF THAT HAND BOX'S OWN THICKNESS (Second: an absolute bar lets a half-buried finger
	 *  pass, and a small hand's whole finger); OutDepth the uu of that pair. 0 when no pair touches. */
	double QaDeepestHandShare(const TArray<FQaObb>& HandBoxes, const TArray<FQaObb>& PropBoxes, double& OutDepth, FString& OutPair)
	{
		double Deepest = 0.0;
		OutDepth = 0.0;
		for (const FQaObb& HandPiece : HandBoxes)
		{
			const double Thickness = 2.0 * FMath::Max(0.01, FMath::Min3(HandPiece.Half.X, HandPiece.Half.Y, HandPiece.Half.Z));
			for (const FQaObb& PropPiece : PropBoxes)
			{
				const double PairDepth = QaObbDepth(HandPiece, PropPiece);
				if (PairDepth <= 0.0 || PairDepth / Thickness <= Deepest)
				{
					continue;
				}
				Deepest = PairDepth / Thickness;
				OutDepth = PairDepth;
				OutPair = FString::Printf(TEXT("%s in %s"), HandPiece.Mesh != nullptr ? *HandPiece.Mesh->GetName() : TEXT("planted"),
					PropPiece.Mesh != nullptr ? *PropPiece.Mesh->GetName() : TEXT("planted"));
			}
		}
		return Deepest;
	}

	/** A hand within Within uu of a prop: the hand's boxes grown by Within meet a prop box (contact, for HP7's "held"). */
	bool QaActTouching(const TArray<FQaObb>& HandBoxes, const TArray<FQaObb>& PropBoxes, double Within)
	{
		for (const FQaObb& HandPiece : HandBoxes)
		{
			FQaObb Grown = HandPiece;
			Grown.Half += FVector(Within);
			QaActBoxReach(Grown);
			for (const FQaObb& PropPiece : PropBoxes)
			{
				if (QaObbDepth(Grown, PropPiece) > 0.0)
				{
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * THE HAND CONTROL, through the very measure the verdict uses (Second): the shown tool's handle pushed 3 uu toward the palm, square to its
	 * own length, among the real props -- the hand share must break the bar. For a book or a glass (no handle), a prop box set on the palm.
	 * -1 when there is nothing to plant (no hand drawn, no prop).
	 */
	double QaActHandControl(const FQaActBoxes& Boxes, const TArray<FQaObb>& BothHands)
	{
		const TArray<FQaObb>& Holding = Boxes.Hands[0].Num() > 0 ? Boxes.Hands[0] : Boxes.Hands[1];
		if (Holding.Num() == 0 || Boxes.Props.Num() == 0)
		{
			return -1.0;
		}
		TArray<FQaObb> Planted = Boxes.Props;
		const FQaObb& Palm = Holding[0];
		FQaObb& Pushed = Planted[Boxes.HandleIndex != INDEX_NONE ? Boxes.HandleIndex : 0];
		if (Boxes.HandleIndex != INDEX_NONE)
		{
			int32 LongAxis = 0;
			for (int32 AxisAt = 1; AxisAt < 3; ++AxisAt)
			{
				LongAxis = Pushed.Half[AxisAt] > Pushed.Half[LongAxis] ? AxisAt : LongAxis;
			}
			FVector ToPalm = Palm.Centre - Pushed.Centre;
			ToPalm -= Pushed.Axis[LongAxis] * FVector::DotProduct(ToPalm, Pushed.Axis[LongAxis]);
			Pushed.Centre += ToPalm.GetSafeNormal() * 3.0;
		}
		else
		{
			Pushed.Centre = Palm.Centre;
		}
		double Depth = 0.0;
		FString Pair;
		return QaDeepestHandShare(BothHands, Planted, Depth, Pair);
	}

	/** THE ARM CONTROL: a 1.5 uu box set at the centre of the tool-side forearm's first block must break the arm bar. -1 with no arm block. */
	double QaActArmControl(const FQaActBoxes& Boxes)
	{
		if (Boxes.ArmsBySide[0] == 0 || Boxes.Arms.Num() == 0)
		{
			return -1.0;
		}
		FQaObb Planted = Boxes.Arms[0];
		Planted.Mesh = nullptr;
		Planted.Half = FVector(0.75);
		QaActBoxReach(Planted);
		TArray<FQaObb> One;
		One.Add(Planted);
		FString Pair;
		return QaDeepestPair(One, Boxes.Arms, Pair);
	}

	/**
	 * NOTHING BETWEEN THE CAMERA AND THE WORK (Second: one world ray to the tool's centre missed the Dog's own head and other arm): the world
	 * both ways, the Dog and its skin aside, AND the Dog's own body as one solid (its boxes, less those hanging from SkipA / SkipB -- the
	 * forearm the fist is on). bOutBodySeen false when the body could not be modelled (the world check then stands alone, and is logged).
	 */
	bool QaActSightClear(UWorld* World, const ARelayDogCharacter* Dog, const FVector& Eye, const FVector& Work, const USceneComponent* SkipA,
		const USceneComponent* SkipB, FQaSolid& Body, bool& bOutBodySeen)
	{
		FCollisionQueryParams Sight = FCollisionQueryParams::DefaultQueryParam;
		Sight.AddIgnoredActor(Dog);
		if (const AActor* Worn = Dog->GetCostume())
		{
			Sight.AddIgnoredActor(Worn);
		}
		FHitResult SightHit;
		if (World->LineTraceSingleByChannel(SightHit, Eye, Work, ECC_Visibility, Sight) || World->LineTraceSingleByChannel(SightHit, Work, Eye, ECC_Visibility, Sight))
		{
			return false;
		}
		FString Why;
		FString Note;
		bool bCostume = false;
		bOutBodySeen = QaBodySolid(Dog, Body, Why, Note, bCostume);
		if (!bOutBodySeen)
		{
			return true;
		}
		const FVector Toward = Work - Eye;
		const double Length = Toward.Size();
		if (Length < 1.0)
		{
			return true;
		}
		const FVector Unit = Toward / Length;
		for (const FQaObb& BodyPiece : Body.Boxes)
		{
			if (QaActHangsFrom(BodyPiece.Mesh, SkipA) || QaActHangsFrom(BodyPiece.Mesh, SkipB))
			{
				continue;
			}
			double Enter = 0.0;
			double Exit = 0.0;
			if (QaRayObb(BodyPiece, Eye, Unit, Enter, Exit) && Exit > 0.0 && Enter < Length - 1.0)
			{
				return false;
			}
		}
		return true;
	}

	/** The fist's centre in the world (the hand's laid grip centre on its visible forearm). */
	bool QaActFist(const ARelayDogCharacter* Dog, bool bLeft, FVector& OutFist)
	{
		const USceneComponent* Arm = Dog->GetVisibleForearm(bLeft);
		if (Arm == nullptr)
		{
			return false;
		}
		OutFist = Arm->GetComponentTransform().TransformPosition(Dog->GetHand(bLeft).GripCentreLocal());
		return true;
	}

	/**
	 * NO PLANT BETWEEN THE CAMERA AND WHAT IT FRAMES (round 4: skeleton_flame's repair frames were shot from inside a flowerbed and read
	 * "sight clear" -- the plants have no collision, so the line trace saw nothing). Every instanced mesh of the world near the line -- the
	 * Dog's, its costume's and the companions' aside -- tested instance by instance as a box (its mesh's bounds, conservative). False when
	 * one crosses the line or holds the camera; OutBlocker names it.
	 */
	bool QaActPlantsClear(UWorld* World, const ARelayDogCharacter* Dog, const FVector& Eye, const FVector& Work, FString& OutBlocker)
	{
		const FVector Toward = Work - Eye;
		const double Length = Toward.Size();
		if (Length < 1.0)
		{
			return true;
		}
		const FVector Unit = Toward / Length;
		FBox Around(ForceInit);
		Around += Eye;
		Around += Work;
		Around = Around.ExpandBy(40.0);
		const AActor* Worn = Dog->GetCostume();
		for (TObjectIterator<UInstancedStaticMeshComponent> It; It; ++It)
		{
			const UInstancedStaticMeshComponent* Plants = *It;
			if (Plants == nullptr || Plants->GetWorld() != World || !Plants->IsRegistered() || !Plants->IsVisible() || Plants->GetStaticMesh() == nullptr
				|| !Plants->Bounds.GetBox().Intersect(Around))
			{
				continue;
			}
			const AActor* PlantsOwner = Plants->GetOwner();
			if (PlantsOwner == Dog || (Worn != nullptr && PlantsOwner == Worn) || (PlantsOwner != nullptr && PlantsOwner->IsA<AWonderlandCompanionEmbodiment>()))
			{
				continue;
			}
			const FBoxSphereBounds PlantBounds = Plants->GetStaticMesh()->GetBounds();
			for (const int32 Instance : Plants->GetInstancesOverlappingBox(Around, true))
			{
				FTransform PlantXf;
				if (!Plants->GetInstanceTransform(Instance, PlantXf, true))
				{
					continue;
				}
				FQaObb Plant;
				Plant.Mesh = Plants;
				Plant.Instance = Instance;
				Plant.Centre = PlantXf.TransformPosition(PlantBounds.Origin);
				const FQuat PlantTurn = PlantXf.GetRotation();
				Plant.Axis[0] = PlantTurn.GetAxisX();
				Plant.Axis[1] = PlantTurn.GetAxisY();
				Plant.Axis[2] = PlantTurn.GetAxisZ();
				Plant.Half = PlantBounds.BoxExtent * PlantXf.GetScale3D().GetAbs();
				double Enter = 0.0;
				double Exit = 0.0;
				if (QaRayObb(Plant, Eye, Unit, Enter, Exit) && Exit > 0.0 && Enter < Length - 2.0)
				{
					OutBlocker = FString::Printf(TEXT("%s instance %d of %s (%s)"), *GetNameSafe(Plants->GetStaticMesh()), Instance, *Plants->GetName(),
						PlantsOwner != nullptr ? *PlantsOwner->GetName() : TEXT("-"));
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * THE RENDER INPUTS, every tick (Second, round 4's GPU hang): the view, and every part of the Dog, its costume and both companions --
	 * each component and each instance of an instanced one -- finite and within reach. Nothing is changed; the FIRST fault is returned, to
	 * be logged once, so a hang that repeats names what fed it.
	 */
	FString QaActRenderFault(UWorld* World, const ARelayDogCharacter* Dog, const APlayerController* PC)
	{
		if (PC != nullptr && PC->PlayerCameraManager != nullptr)
		{
			const FVector Eye = PC->PlayerCameraManager->GetCameraLocation();
			const FRotator Look = PC->PlayerCameraManager->GetCameraRotation();
			if (Eye.ContainsNaN() || Look.ContainsNaN() || Eye.GetAbsMax() > 2.0e6)
			{
				return FString::Printf(TEXT("the view at %s looking %s"), *Eye.ToString(), *Look.ToString());
			}
		}
		const AActor* Owners[] = { Dog, Dog->GetCostume(), QaCompanionBody(World, 0), QaCompanionBody(World, 1) };
		for (const AActor* Owner : Owners)
		{
			if (Owner == nullptr)
			{
				continue;
			}
			TInlineComponentArray<USceneComponent*> Parts;
			Owner->GetComponents<USceneComponent>(Parts);
			for (const USceneComponent* Part : Parts)
			{
				if (Part == nullptr || !Part->IsRegistered())
				{
					continue;
				}
				if (!WonderlandFinite::IsDrawable(Part->GetComponentTransform(), 1000.0))
				{
					return FString::Printf(TEXT("%s on %s at %s"), *Part->GetName(), *Owner->GetName(), *Part->GetComponentTransform().ToString());
				}
				const UInstancedStaticMeshComponent* Instanced = Cast<UInstancedStaticMeshComponent>(Part);
				if (Instanced == nullptr || !Instanced->IsVisible())
				{
					continue;
				}
				for (int32 Instance = 0; Instance < Instanced->GetInstanceCount(); ++Instance)
				{
					FTransform InstanceXf;
					if (Instanced->GetInstanceTransform(Instance, InstanceXf, true) && !WonderlandFinite::IsDrawable(InstanceXf, 1000.0))
					{
						return FString::Printf(TEXT("instance %d of %s on %s at %s"), Instance, *Part->GetName(), *Owner->GetName(), *InstanceXf.ToString());
					}
				}
			}
		}
		return FString();
	}

	struct FQaActHands
	{
		TWeakObjectPtr<UWorld> World;
		FTSTicker::FDelegateHandle Handle;
		TWeakObjectPtr<ACameraActor> Camera;
		bool bQuit = false;
		int32 Pass = 0;
		int32 Fail = 0;
		TSet<FString> Checked;
		int32 Phase = 0;
		int32 SkinIndex = 0;
		double PhaseAt = 0.0;
		FString Dir;
		// the mission, per skin: per-prop frames, held / bare, and the measured worst
		int32 PropFrames = 0;
		int32 BrushFrames = 0;
		int32 BrushHeld = 0;
		int32 ScraperFrames = 0;
		int32 ScraperHeld = 0;
		int32 BookFrames = 0;
		int32 BookBare = 0;
		int32 LensFrames = 0;
		int32 LensBare = 0;
		double MissionHandShare = 0.0;
		double MissionPropArm = 0.0;
		FString MissionWorst;
		FString FirstLoose;
		int32 SeenMasks = 0;
		int32 LastMask = 0;
		double MaskSince = 0.0;
		// the close shots, over every skin
		int32 ActIndex = 0;
		int32 ViewIndex = 0;
		bool bActIssued = false;
		double ShotAt = 0.0;
		int32 Tries = 0;
		int32 CloseShots = 0;
		int32 FrameFails = 0;
		int32 CloseMasks = 0;
		int32 Blocked = 0;
		int32 BodyBlind = 0;
		FString MissedActs;
		int32 CloseTool = 0;
		int32 CloseToolOk = 0;
		double ToolHandShare = 0.0;
		double ToolPropArm = 0.0;
		double LeastHandControl = 1.0e9;
		double LeastArmControl = 1.0e9;
		FString WorstTool;
		int32 CloseHeld = 0;
		int32 CloseHeldOk = 0;
		FString WorstHeld;
		FQaSolid Body;
		// round 4's GPU hang (Second): the render probe's first fault, where the QA is, and the open ground the close shots are taken from
		FString ProbeFault;
		bool bCameraFault = false;
		int32 LoggedPhase = -1;
		int32 LoggedSkin = -1;
		int32 LoggedAct = -1;
		bool bHomeSet = false;
		FVector Home = FVector::ZeroVector;
		FRotator HomeFacing = FRotator::ZeroRotator;
		bool bAtHome = false;
		int32 PlantBlocked = 0;
		void Check(const TCHAR* Id, bool bOk, const FString& Detail)
		{
			Checked.Add(Id);
			(bOk ? Pass : Fail) += 1;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
		}
		bool Frame(const FString& Name)
		{
			int32 Width = 0;
			int32 Height = 0;
			const FString Path = Dir / (Name + TEXT(".png"));
			const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, Width, Height) && IFileManager::Get().FileExists(*Path);
			UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), Width, Height);
			return bOk;
		}
	};
	TSharedPtr<FQaActHands> GQaActHands;

	bool QaActHandsTick(float)
	{
		if (!GQaActHands.IsValid())
		{
			return false;
		}
		FQaActHands& S = *GQaActHands;
		UWorld* World = S.World.Get();
		ARelayDogCharacter* Dog = QaDog(World);
		FWonderlandMissionHandoff* Handoff = QaHandoff(World);
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		const int32 SkinCount = static_cast<int32>(UE_ARRAY_COUNT(FaceRoster));
		// the missions run on the first two skins; the close shots on all six
		constexpr int32 MissionSkins = 2;
		auto Stop = [&S](const TCHAR* Why)
		{
			// AN ABORT IS A VERDICT (Second): every HP not yet checked is SKIPPED, a fail -- never "fail=0"
			if (Why != nullptr)
			{
				static const TCHAR* const AllIds[] = { TEXT("HP1"), TEXT("HP2"), TEXT("HP3"), TEXT("HP4"), TEXT("HP5"), TEXT("HP6"), TEXT("HP7") };
				for (const TCHAR* Id : AllIds)
				{
					if (!S.Checked.Contains(Id))
					{
						S.Check(Id, false, FString::Printf(TEXT("SKIPPED -- the run stopped: %s"), Why));
					}
				}
			}
			if (UWorld* W = S.World.Get())
			{
				GEngine->Exec(W, TEXT("wl.Dog.Act none"));
				GEngine->Exec(W, TEXT("wl.Mission.Stop"));
				GEngine->Exec(W, TEXT("wl.Skins.Wear relay_og"));
				if (APlayerController* P = W->GetFirstPlayerController())
				{
					if (ARelayDogCharacter* D = QaDog(W))
					{
						P->SetViewTargetWithBlend(D, 0.0f);
					}
				}
			}
			if (ACameraActor* Cam = S.Camera.Get())
			{
				Cam->Destroy();
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA END pass=%d fail=%d expected=7%s"), S.Pass, S.Fail, Why != nullptr ? *FString::Printf(TEXT(" (%s)"), Why) : TEXT(""));
			const bool bQuit = S.bQuit;
			GQaActHands.Reset();
			if (bQuit)
			{
				FPlatformMisc::RequestExit(false);
			}
			return false;
		};
		if (World == nullptr || Dog == nullptr || Handoff == nullptr || PC == nullptr)
		{
			return Stop(TEXT("the world, the Dog or the handoff went away"));
		}
		const double Now = QaNow();
		const double In = Now - S.PhaseAt;
		const TCHAR* const Skin = FaceRoster[FMath::Clamp(S.SkinIndex, 0, SkinCount - 1)];
		// WHERE THE QA IS, written at every change and flushed (Second's ask: round 4's hang left the next skin and act unwritten)
		if (S.Phase != S.LoggedPhase || S.SkinIndex != S.LoggedSkin || S.ActIndex != S.LoggedAct)
		{
			S.LoggedPhase = S.Phase;
			S.LoggedSkin = S.SkinIndex;
			S.LoggedAct = S.ActIndex;
			UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA STEP skin %s, phase %d, act %d, view %d"), Skin, S.Phase, S.ActIndex, S.ViewIndex);
			GLog->Flush();
		}
		// THE RENDER INPUTS, every tick: the first non-finite or runaway one is written once, flushed, and fails HP5
		if (S.ProbeFault.IsEmpty())
		{
			S.ProbeFault = QaActRenderFault(World, Dog, PC);
			if (!S.ProbeFault.IsEmpty())
			{
				UE_LOG(LogWonderlandQa, Warning, TEXT("WLAHQA PROBE the first non-finite or runaway render input: %s"), *S.ProbeFault);
				GLog->Flush();
			}
		}
		switch (S.Phase)
		{
		case 0:
			// READY: the welcome gone, no swords held, the skin worn
			if (UWonderlandUiSubsystem* Ui = QaUi(World))
			{
				if (Ui->IsWelcomeOpen())
				{
					Ui->DismissWelcome();
				}
			}
			if (Handoff->IsArmed())
			{
				FString Ignored;
				Handoff->Return(Ignored);
			}
			if (In < 4.0 || Handoff->IsEquipped())
			{
				return In < 40.0 ? true : Stop(TEXT("never ready: the swords away"));
			}
			if (!S.bHomeSet)
			{
				// WHERE THE CLOSE SHOTS ARE TAKEN FROM: the open ground this QA started on (round 4: a flowerbed, after the missions)
				S.Home = Dog->GetActorLocation();
				S.HomeFacing = Dog->GetActorRotation();
				S.bHomeSet = true;
			}
			GEngine->Exec(World, *FString::Printf(TEXT("wl.Skins.Wear %s"), Skin));
			S.Phase = 1;
			S.PhaseAt = Now;
			return true;
		case 1:
			if (In < 3.0)
			{
				return true;
			}
			if (S.SkinIndex >= MissionSkins)
			{
				// the close shots only, on this skin
				S.Phase = 4;
				S.ActIndex = 0;
				S.bActIssued = false;
				S.PhaseAt = Now;
				return true;
			}
			GEngine->Exec(World, TEXT("wl.Mission.Scenario B 5"));
			S.PropFrames = 0;
			S.BrushFrames = S.BrushHeld = S.ScraperFrames = S.ScraperHeld = 0;
			S.BookFrames = S.BookBare = S.LensFrames = S.LensBare = 0;
			S.MissionHandShare = 0.0;
			S.MissionPropArm = 0.0;
			S.MissionWorst.Reset();
			S.FirstLoose.Reset();
			S.SeenMasks = 0;
			S.LastMask = 0;
			S.MaskSince = Now;
			S.Phase = 2;
			S.PhaseAt = Now;
			return true;
		case 2:
		{
			// EVERY FRAME OF THE MISSION, PER PROP: a tool held in the drawn closed fist and MEASURED; the book or the glass, no hand drawn
			const int32 Mask = Dog->GetVisibleActPropMask();
			const WonderlandHands::FHand& ToolHand = Dog->GetHand(Dog->IsToolHandLeft());
			const int32 HandBoxCount = Dog->GetHand(true).CountVisibleBoxes() + Dog->GetHand(false).CountVisibleBoxes();
			const bool bHeldWhole = ToolHand.CountVisibleBoxes() == WonderlandHands::BoxesPerHand && ToolHand.GetCurl() >= 0.95f && Dog->IsToolInFist();
			S.PropFrames += Mask != 0 ? 1 : 0;
			if ((Mask & (2 | 8)) != 0)
			{
				((Mask & 2) != 0 ? S.BrushFrames : S.ScraperFrames) += 1;
				((Mask & 2) != 0 ? S.BrushHeld : S.ScraperHeld) += bHeldWhole ? 1 : 0;
				if (!bHeldWhole && S.FirstLoose.IsEmpty())
				{
					S.FirstLoose = FString::Printf(TEXT("tool 0x%X at %.1f s: hand %d boxes, curl %.2f, in the fist %d"), Mask, In,
						ToolHand.CountVisibleBoxes(), ToolHand.GetCurl(), Dog->IsToolInFist() ? 1 : 0);
				}
				// MEASURED EVERY FRAME (Second): the worst of the whole hold, not a few instants
				FQaActBoxes Live;
				QaActBoxes(Dog, Live);
				TArray<FQaObb> LiveHands = Live.Hands[0];
				LiveHands.Append(Live.Hands[1]);
				double LiveDepth = 0.0;
				FString LivePair;
				FString ArmPair;
				const double LiveShare = QaDeepestHandShare(LiveHands, Live.Props, LiveDepth, LivePair);
				const double LiveArm = QaDeepestPair(Live.Props, Live.Arms, ArmPair);
				if (LiveShare > S.MissionHandShare || LiveArm > S.MissionPropArm)
				{
					S.MissionWorst = FString::Printf(TEXT("at %.1f s: hand %.0f%% of its thickness (%.2f uu, %s), prop-in-arm %.2f uu (%s)"), In, LiveShare * 100.0,
						LiveDepth, LivePair.IsEmpty() ? TEXT("none") : *LivePair, LiveArm, ArmPair.IsEmpty() ? TEXT("none") : *ArmPair);
				}
				S.MissionHandShare = FMath::Max(S.MissionHandShare, LiveShare);
				S.MissionPropArm = FMath::Max(S.MissionPropArm, LiveArm);
			}
			if ((Mask & 1) != 0)
			{
				++S.BookFrames;
				S.BookBare += HandBoxCount == 0 ? 1 : 0;
			}
			if ((Mask & 4) != 0)
			{
				++S.LensFrames;
				S.LensBare += HandBoxCount == 0 ? 1 : 0;
			}
			if (Mask != S.LastMask)
			{
				S.LastMask = Mask;
				S.MaskSince = Now;
				// the mission's Live Terminal covers the lower half of the frame: shut it for the shot that follows in 0.6 s
				if (UWonderlandUiSubsystem* Ui = QaUi(World))
				{
					if (Mask != 0 && Ui->IsLiveTerminalOpen())
					{
						Ui->ToggleLiveTerminal();
					}
				}
			}
			FQaStance Shim;
			Shim.Camera = S.Camera;
			QaStanceCamera(Shim, World, Dog, 40.0, 330.0, 70.0, 50.0f);
			S.Camera = Shim.Camera;
			if (Mask != 0 && (S.SeenMasks & Mask) != Mask && Now - S.MaskSince >= 0.6)
			{
				S.Frame(FString::Printf(TEXT("act_%s_props_%X"), Skin, Mask));
				S.SeenMasks |= Mask;
			}
			if (In < 75.0 && !(S.SeenMasks == 0xF && In > 30.0))
			{
				return true;
			}
			GEngine->Exec(World, TEXT("wl.Mission.Stop"));
			PC->SetViewTargetWithBlend(Dog, 0.0f);
			const bool bTools = S.BrushFrames >= 10 && S.BrushHeld == S.BrushFrames && S.ScraperHeld == S.ScraperFrames
				&& S.MissionHandShare <= QaActHandShareBar && S.MissionPropArm <= QaActPropArmBarUU;
			const bool bBare = S.BookFrames >= 10 && S.BookBare == S.BookFrames && S.LensFrames >= 10 && S.LensBare == S.LensFrames;
			S.Check(S.SkinIndex == 0 ? TEXT("HP1") : TEXT("HP3"), S.PropFrames >= 30 && (S.SeenMasks & 0x7) == 0x7 && bTools && bBare,
				FString::Printf(TEXT("%s through a mission: props in %d frames, sets seen 0x%X (want book 1 + brush 2 + glass 4; the scraper %s); the brush in %d frames, held in the drawn closed fist in %d (want all, >= 10); the scraper in %d, held in %d%s; measured EVERY tool frame: the worst hand %.0f%% of its thickness into a prop (bar %.0f%%), the worst prop %.2f uu into a forearm (bar %.1f)%s; the book in %d frames, bare in %d; the glass in %d, bare in %d (want all, >= 10 each: not held yet)"),
					Skin, S.PropFrames, S.SeenMasks, (S.SeenMasks & 8) != 0 ? TEXT("seen too") : TEXT("not in this fixture's window -- HP6 forces it"),
					S.BrushFrames, S.BrushHeld, S.ScraperFrames, S.ScraperHeld, S.FirstLoose.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (first loose: %s)"), *S.FirstLoose),
					S.MissionHandShare * 100.0, QaActHandShareBar * 100.0, S.MissionPropArm, QaActPropArmBarUU,
					S.MissionWorst.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (worst %s)"), *S.MissionWorst), S.BookFrames, S.BookBare, S.LensFrames, S.LensBare));
			S.Phase = 3;
			S.PhaseAt = Now;
			return true;
		}
		case 3:
		{
			if (In < 3.0)
			{
				return true;
			}
			const WonderlandHands::FHand& Left = Dog->GetHand(true);
			const WonderlandHands::FHand& Right = Dog->GetHand(false);
			const bool bBack = Dog->CountVisibleActProps() == 0 && Left.CountVisibleBoxes() == WonderlandHands::BoxesPerHand
				&& Right.CountVisibleBoxes() == WonderlandHands::BoxesPerHand && Left.GetCurl() <= 0.1f && Right.GetCurl() <= 0.1f;
			S.Check(S.SkinIndex == 0 ? TEXT("HP2") : TEXT("HP4"), bBack,
				FString::Printf(TEXT("%s after the mission: props drawn %d; hands drawn %d + %d boxes, open %.2f / %.2f"), Skin, Dog->CountVisibleActProps(),
					Left.CountVisibleBoxes(), Right.CountVisibleBoxes(), Left.GetCurl(), Right.GetCurl()));
			S.Phase = 4;
			S.ActIndex = 0;
			S.bActIssued = false;
			S.PhaseAt = Now;
			return true;
		}
		case 4:
		{
			// THE CLOSE SHOTS on this skin: every prop act posed through SetMissionAct, its OWN prop waited for, framed with a clear line of
			// sight, measured every tick it is held and at every shot
			static const TCHAR* const CloseActs[] = { TEXT("book"), TEXT("paint"), TEXT("review"), TEXT("repair") };
			static const int32 CloseWants[] = { 1, 2, 4, 8 };
			const int32 ActCount = static_cast<int32>(UE_ARRAY_COUNT(CloseActs));
			if (S.ActIndex >= ActCount)
			{
				GEngine->Exec(World, TEXT("wl.Dog.Act none"));
				PC->SetViewTargetWithBlend(Dog, 0.0f);
				S.bAtHome = false;
				if (S.SkinIndex + 1 < SkinCount)
				{
					++S.SkinIndex;
					S.Phase = 0;
					S.PhaseAt = Now;
					return true;
				}
				// tools: 3 views, the book and the glass: 2 -- on every skin
				const int32 WantShots = SkinCount * (2 * 3 + 2 * 2);
				S.Check(TEXT("HP5"), S.CloseShots == WantShots && S.FrameFails == 0 && S.Blocked == 0 && (S.CloseMasks & 0xF) == 0xF && S.MissedActs.IsEmpty()
					&& S.ProbeFault.IsEmpty() && !S.bCameraFault,
					FString::Printf(TEXT("close frames of every prop act on all %d skins, each act's own prop waited for (the scraper's too): %d frames SAVED (want %d), %d failed to save, %d with the line of sight blocked by the world, a plant or the Dog's own body (want 0; %d of them by plants; the body could not be modelled for %d), prop sets seen 0x%X (want 0xF); every render input finite on every tick: %s%s"),
						SkinCount, S.CloseShots, WantShots, S.FrameFails, S.Blocked, S.PlantBlocked, S.BodyBlind, S.CloseMasks,
						S.ProbeFault.IsEmpty() && !S.bCameraFault ? TEXT("yes") : *FString::Printf(TEXT("NO -- %s"), S.ProbeFault.IsEmpty() ? TEXT("a close camera's place") : *S.ProbeFault),
						S.MissedActs.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; NEVER SHOWN: %s"), *S.MissedActs)));
				S.Check(TEXT("HP6"), S.CloseTool == SkinCount * 2 * 3 && S.CloseToolOk == S.CloseTool && S.ToolHandShare <= QaActHandShareBar && S.ToolPropArm <= QaActPropArmBarUU,
					FString::Printf(TEXT("the tools in the hand on all %d skins (brush, scraper; side, three-quarters, the fist close): %d of %d shots held -- the hand drawn whole round the tool, in the fist, the boxes counted, the controls breaking their bars through the same measure (least: hand %.0f%%, arm %.2f uu), the line of sight clear; over EVERY tick of the holds the worst hand %.0f%% of its thickness into a prop (bar %.0f%%) and the worst prop %.2f uu into a forearm (bar %.1f)%s"),
						SkinCount, S.CloseToolOk, S.CloseTool, S.LeastHandControl > 1.0e8 ? -100.0 : S.LeastHandControl * 100.0, S.LeastArmControl > 1.0e8 ? -1.0 : S.LeastArmControl,
						S.ToolHandShare * 100.0, QaActHandShareBar * 100.0, S.ToolPropArm, QaActPropArmBarUU,
						S.WorstTool.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; first fault: %s"), *S.WorstTool)));
				S.Check(TEXT("HP7"), S.CloseHeld == SkinCount * 2 * 2 && S.CloseHeldOk == S.CloseHeld,
					FString::Printf(TEXT("the book and the glass held on all %d skins: %d of %d shots with a hand drawn, IN CONTACT (within 0.5 uu), under the depth bars, and the palm control breaking the bar -- NOT HELD YET: their hands still step aside (stated, never passed until they hold)%s"),
						SkinCount, S.CloseHeldOk, S.CloseHeld, S.WorstHeld.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; first: %s"), *S.WorstHeld)));
				return Stop(nullptr);
			}
			if (!S.bAtHome)
			{
				// EACH SKIN'S ACTS FROM THE OPEN GROUND THE QA STARTED ON (round 4: skeleton_flame's repair frames from inside a flowerbed)
				Dog->SetActorLocationAndRotation(S.Home, S.HomeFacing, false, nullptr, ETeleportType::TeleportPhysics);
				S.bAtHome = true;
				S.PhaseAt = Now;
				return true;
			}
			if (In < 1.0 && !S.bActIssued)
			{
				return true;
			}
			if (!S.bActIssued)
			{
				GEngine->Exec(World, *FString::Printf(TEXT("wl.Dog.Act %s"), CloseActs[S.ActIndex]));
				// THE CONTRACT THE ACT WORKS ON (Second: wl.Dog.Act takes the first *MissionOrb*; which one was never logged)
				FString Contract = TEXT("NONE in the world (an act that turns to it holds still)");
				for (TActorIterator<AActor> It(World); It; ++It)
				{
					if (It->GetName().Contains(TEXT("MissionOrb")))
					{
						Contract = It->GetName();
						break;
					}
				}
				UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA ACT %s %s: the Contract %s"), Skin, CloseActs[S.ActIndex], *Contract);
				S.bActIssued = true;
				S.ViewIndex = 0;
				S.ShotAt = 0.0;
				S.Tries = 0;
				S.PhaseAt = Now;
				return true;
			}
			const int32 Want = CloseWants[S.ActIndex];
			const bool bToolAct = (Want & (2 | 8)) != 0;
			const int32 Views = bToolAct ? 3 : 2;
			const int32 Mask = Dog->GetVisibleActPropMask();
			if (In < 1.5 || ((Mask & Want) == 0 && In < 15.0))
			{
				// the act's own prop is not up (the repair act names the fault with the glass between scrapes): the settle restarts
				S.ShotAt = 0.0;
				return true;
			}
			if ((Mask & Want) == 0)
			{
				S.MissedActs += FString::Printf(TEXT("%s%s %s (0x%X)"), S.MissedActs.IsEmpty() ? TEXT("") : TEXT(", "), Skin, CloseActs[S.ActIndex], Want);
				++S.ActIndex;
				S.bActIssued = false;
				return true;
			}
			FQaActBoxes ActBoxes;
			QaActBoxes(Dog, ActBoxes);
			TArray<FQaObb> BothHands = ActBoxes.Hands[0];
			BothHands.Append(ActBoxes.Hands[1]);
			double HandDepth = 0.0;
			FString HandPair;
			FString ArmPair;
			const double HandShare = QaDeepestHandShare(BothHands, ActBoxes.Props, HandDepth, HandPair);
			const double ArmDepth = QaDeepestPair(ActBoxes.Props, ActBoxes.Arms, ArmPair);
			// EVERY TICK OF THE HOLD counts, not only the shots
			if (bToolAct)
			{
				S.ToolHandShare = FMath::Max(S.ToolHandShare, HandShare);
				S.ToolPropArm = FMath::Max(S.ToolPropArm, ArmDepth);
			}
			ACameraActor* CloseCam = S.Camera.Get();
			if (CloseCam == nullptr)
			{
				FQaStance Shim;
				QaStanceCamera(Shim, World, Dog, 40.0, 330.0, 70.0, 50.0f);
				S.Camera = Shim.Camera;
				return true;
			}
			// THE VIEW: the fist (tools) or the prop (book, glass), from the tool hand's side, three-quarters, or a fist close-up; tried round
			// in steps when the world or the Dog's own body is in the way
			FBox PropBox(ForceInit);
			for (const FQaObb& PropPiece : ActBoxes.Props)
			{
				PropBox += FBox::BuildAABB(PropPiece.Centre, PropPiece.Reach);
			}
			const bool bLeftTool = Dog->IsToolHandLeft();
			FVector Fist = FVector::ZeroVector;
			const bool bFist = QaActFist(Dog, bLeftTool, Fist);
			if (!PropBox.IsValid || (bToolAct && !bFist))
			{
				return In < 15.0 ? true : Stop(TEXT("an act showed no prop or no fist to frame"));
			}
			const FVector Grip = ActBoxes.HandleIndex != INDEX_NONE ? ActBoxes.Props[ActBoxes.HandleIndex].Centre : PropBox.GetCenter();
			const FVector AimAt = bToolAct ? (S.ViewIndex == 2 ? Fist : (Fist + PropBox.GetCenter()) * 0.5) : PropBox.GetCenter();
			const double Reach = S.ViewIndex == 2 ? 35.0 : FMath::Clamp(PropBox.GetExtent().Size() * 2.6, 60.0, 150.0);
			const double SideSign = bLeftTool ? -1.0 : 1.0;
			static const double TryOffsets[] = { 0.0, 25.0, -25.0, 50.0, -50.0, 75.0, -75.0, 100.0, -100.0, 125.0 };
			const double ViewAngle = SideSign * (S.ViewIndex == 1 ? 40.0 : 90.0) + TryOffsets[FMath::Clamp(S.Tries, 0, 9)];
			const FVector CloseWhere = AimAt + Dog->GetActorForwardVector().GetSafeNormal2D().RotateAngleAxis(ViewAngle, FVector::UpVector) * Reach
				+ FVector(0.0, 0.0, Reach * (S.ViewIndex == 2 ? 0.2 : 0.25));
			if (CloseWhere.ContainsNaN() || AimAt.ContainsNaN())
			{
				// DRAWABLE ONLY (round 4's GPU hang): a camera is never placed at a point that is not finite
				if (!S.bCameraFault)
				{
					S.bCameraFault = true;
					UE_LOG(LogWonderlandQa, Warning, TEXT("WLAHQA PROBE a close camera would have gone to %s aiming at %s (not placed)"), *CloseWhere.ToString(),
						*AimAt.ToString());
					GLog->Flush();
				}
				return In < 15.0 ? true : Stop(TEXT("the close camera's place was not finite"));
			}
			CloseCam->SetActorLocationAndRotation(CloseWhere, (AimAt - CloseWhere).Rotation());
			CloseCam->GetCameraComponent()->SetFieldOfView(S.ViewIndex == 2 ? 40.0f : 45.0f);
			if (PC->GetViewTarget() != CloseCam)
			{
				PC->SetViewTargetWithBlend(CloseCam, 0.0f);
			}
			const USceneComponent* ToolArm = Dog->GetVisibleForearm(bLeftTool);
			const USceneComponent* OtherArm = bToolAct ? nullptr : Dog->GetVisibleForearm(!bLeftTool);
			bool bBodySeen = true;
			bool bClear = QaActSightClear(World, Dog, CloseWhere, bToolAct ? Fist : AimAt, ToolArm, OtherArm, S.Body, bBodySeen);
			if (bClear && bToolAct && S.ViewIndex != 2)
			{
				bool bGripBodySeen = true;
				bClear = QaActSightClear(World, Dog, CloseWhere, Grip, ToolArm, OtherArm, S.Body, bGripBodySeen);
			}
			// AND NO PLANT IN THE WAY (round 4: frames shot from inside a flowerbed read "sight clear"; plants have no collision)
			FString PlantBlocker;
			const bool bPlantsClear = !bClear || QaActPlantsClear(World, Dog, CloseWhere, bToolAct ? Fist : AimAt, PlantBlocker);
			if (bClear && !bPlantsClear)
			{
				bClear = false;
				if (S.Tries >= 9)
				{
					++S.PlantBlocked;
					UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA BLOCKED %s %s view %d: %s"), Skin, CloseActs[S.ActIndex], S.ViewIndex, *PlantBlocker);
				}
			}
			if (!bClear && S.Tries < 9)
			{
				++S.Tries;
				S.ShotAt = 0.0;
				return true;
			}
			if (S.ShotAt <= 0.0)
			{
				S.ShotAt = Now;
			}
			// HELD ON THE TARGET for half a second: the image is the frame rendered with the camera placed a tick before
			if (Now - S.ShotAt < 0.5)
			{
				return true;
			}
			// THE SHOT: the controls through the very measure, the counts, the verdict for this view
			const double HandControl = QaActHandControl(ActBoxes, BothHands);
			const double ArmControl = QaActArmControl(ActBoxes);
			const int32 ToolHandBoxes = ActBoxes.Hands[0].Num();
			const bool bCounts = ActBoxes.Props.Num() >= 2 && ActBoxes.ArmsBySide[0] >= 1 && ActBoxes.ArmsBySide[1] >= 1;
			static const TCHAR* const ViewNames[] = { TEXT("side"), TEXT("threequarter"), TEXT("fist") };
			const FString ShotName = FString::Printf(TEXT("close_%s_%s_%s"), Skin, CloseActs[S.ActIndex], ViewNames[S.ViewIndex]);
			const bool bSaved = S.Frame(ShotName);
			S.CloseShots += bSaved ? 1 : 0;
			S.FrameFails += bSaved ? 0 : 1;
			S.CloseMasks |= Mask;
			S.Blocked += bClear ? 0 : 1;
			S.BodyBlind += bBodySeen ? 0 : 1;
			const bool bControls = HandControl > QaActHandShareBar && ArmControl > QaActPropArmBarUU;
			if (bToolAct)
			{
				++S.CloseTool;
				const bool bHeldWell = ToolHandBoxes == WonderlandHands::BoxesPerHand && Dog->IsToolInFist() && bCounts && bControls && bClear && bSaved
					&& HandShare <= QaActHandShareBar && ArmDepth <= QaActPropArmBarUU;
				S.CloseToolOk += bHeldWell ? 1 : 0;
				if (HandControl >= 0.0)
				{
					S.LeastHandControl = FMath::Min(S.LeastHandControl, HandControl);
				}
				if (ArmControl >= 0.0)
				{
					S.LeastArmControl = FMath::Min(S.LeastArmControl, ArmControl);
				}
				if (!bHeldWell && S.WorstTool.IsEmpty())
				{
					S.WorstTool = FString::Printf(TEXT("%s: hand %d boxes, in the fist %d, counts %d, controls %.2f/%.2f, sight %d, saved %d, hand %.0f%% (%s), arm %.2f uu (%s)"),
						*ShotName, ToolHandBoxes, Dog->IsToolInFist() ? 1 : 0, bCounts ? 1 : 0, HandControl, ArmControl, bClear ? 1 : 0, bSaved ? 1 : 0, HandShare * 100.0,
						*HandPair, ArmDepth, *ArmPair);
				}
			}
			else
			{
				++S.CloseHeld;
				const bool bInContact = BothHands.Num() > 0 && QaActTouching(BothHands, ActBoxes.Props, 0.5);
				const bool bHeldWell = bInContact && bControls && bClear && bSaved && HandShare <= QaActHandShareBar && ArmDepth <= QaActPropArmBarUU;
				S.CloseHeldOk += bHeldWell ? 1 : 0;
				if (!bHeldWell && S.WorstHeld.IsEmpty())
				{
					S.WorstHeld = FString::Printf(TEXT("%s: hands drawn %d boxes, in contact %d, controls %.2f/%.2f"), *ShotName, BothHands.Num(), bInContact ? 1 : 0,
						HandControl, ArmControl);
				}
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA SHOT %s props 0x%X sight %s (tries %d, the body %s) tool hand %d boxes, other %d, in the fist %d, curl %.2f, wrist %.1f deg, hand size %.2f/%.2f; boxes: props %d, arms %d+%d; hand %.0f%% of its thickness (%.2f uu, %s); prop-in-arm %.2f uu (%s); controls: hand %.0f%%, arm %.2f uu"),
				*ShotName, Mask, bClear ? TEXT("clear") : TEXT("BLOCKED"), S.Tries, bBodySeen ? TEXT("modelled") : TEXT("NOT modelled"), ToolHandBoxes, ActBoxes.Hands[1].Num(),
				Dog->IsToolInFist() ? 1 : 0, Dog->GetHand(bLeftTool).GetCurl(), Dog->GetHand(bLeftTool).GetWristBendDeg(), ActBoxes.HandSize[0], ActBoxes.HandSize[1],
				ActBoxes.Props.Num(), ActBoxes.ArmsBySide[0], ActBoxes.ArmsBySide[1], HandShare * 100.0, HandDepth, HandPair.IsEmpty() ? TEXT("none") : *HandPair,
				ArmDepth, ArmPair.IsEmpty() ? TEXT("none") : *ArmPair, HandControl * 100.0, ArmControl);
			// the GEOM lines for round 5's book and glass grips: each forearm's tip and axes in the prop's own frame
			if (!bToolAct)
			{
				const TCHAR* const FrameName = Want == 1 ? TEXT("MissionBook") : TEXT("MissionLensHandle");
				const UStaticMeshComponent* FramePart = nullptr;
				TInlineComponentArray<UStaticMeshComponent*> FrameParts;
				Dog->GetComponents<UStaticMeshComponent>(FrameParts);
				for (const UStaticMeshComponent* Candidate : FrameParts)
				{
					if (Candidate != nullptr && Candidate->IsVisible() && Candidate->GetName().StartsWith(FrameName)
						&& !Candidate->GetName().StartsWith(TEXT("MissionBookPages")) && !Candidate->GetName().StartsWith(TEXT("MissionBookTurningPage")))
					{
						FramePart = Candidate;
						break;
					}
				}
				if (FramePart != nullptr)
				{
					const FTransform PropXf = FramePart->GetComponentTransform();
					for (const bool bLeftSide : { true, false })
					{
						const USceneComponent* GeomArm = Dog->GetVisibleForearm(bLeftSide);
						const WonderlandHands::FHand& GeomHand = Dog->GetHand(bLeftSide);
						if (GeomArm == nullptr)
						{
							continue;
						}
						const FTransform GeomArmXf = GeomArm->GetComponentTransform();
						const FVector TipInProp = PropXf.InverseTransformPosition(GeomArmXf.TransformPosition(GeomHand.GetTipLocal()));
						const FVector AlongInProp = PropXf.InverseTransformVectorNoScale(GeomArmXf.TransformVectorNoScale(GeomHand.GetAlong()));
						const FVector AheadInProp = PropXf.InverseTransformVectorNoScale(GeomArmXf.TransformVectorNoScale(GeomHand.GetForward()));
						UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA GEOM %s %s hand (%s): in the frame of %s, tip (%.1f, %.1f, %.1f) uu, along (%.2f, %.2f, %.2f), thumb side (%.2f, %.2f, %.2f), hand size %.2f, arm scale %.2f"),
							*ShotName, bLeftSide ? TEXT("left") : TEXT("right"), bLeftSide == bLeftTool ? TEXT("working") : TEXT("free"),
							*FramePart->GetName(), TipInProp.X, TipInProp.Y, TipInProp.Z, AlongInProp.X, AlongInProp.Y, AlongInProp.Z,
							AheadInProp.X, AheadInProp.Y, AheadInProp.Z, GeomHand.GetSize(), GeomArmXf.GetScale3D().GetAbsMin());
					}
				}
			}
			S.ShotAt = 0.0;
			S.Tries = 0;
			// the next view waits afresh: 15 s from now for its own prop, not from the act's start
			S.PhaseAt = Now;
			if (++S.ViewIndex >= Views)
			{
				++S.ActIndex;
				S.bActIssued = false;
			}
			return true;
		}
		default:
			return Stop(TEXT("an unknown phase"));
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GQaActHandsCommand(
		TEXT("wl.Qa.ActHands"),
		TEXT("Hands seen holding, never through a prop: Relay OG and celestial_light through a real mission fixture, every frame measured; then ")
		TEXT("every prop act on all six skins framed and measured (controls through the same measure, sight clear of the world and the Dog's ")
		TEXT("own body, frames counted only when saved). HP1-HP7; HP7 (the book and the glass) fails until they are held. Frames to ")
		TEXT("Saved/Screenshots/WLACTS (cleared at BEGIN). `quit` exits after. WLAHQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GQaActHands.IsValid() || World == nullptr)
			{
				return;
			}
			GQaActHands = MakeShared<FQaActHands>();
			GQaActHands->World = World;
			GQaActHands->bQuit = Args.Contains(TEXT("quit"));
			GQaActHands->PhaseAt = QaNow();
			GQaActHands->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLACTS"));
			// NO OLD FRAME PASSES FOR A NEW ONE (Second): this run's folder starts empty of images
			TArray<FString> OldFrames;
			IFileManager::Get().FindFiles(OldFrames, *(GQaActHands->Dir / TEXT("*.png")), true, false);
			for (const FString& OldFrame : OldFrames)
			{
				IFileManager::Get().Delete(*(GQaActHands->Dir / OldFrame));
			}
			UE_LOG(LogWonderlandQa, Display, TEXT("WLAHQA BEGIN | %s | %d old frame(s) cleared"), *WonderlandBeta::BuildLabel(), OldFrames.Num());
			GQaActHands->Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&QaActHandsTick), 0.0f);
		}));

	FAutoConsoleCommandWithWorldAndArgs GQaHandoffSwordsCommand(
		TEXT("wl.Qa.HandoffSwords"),
		TEXT("Mission Handoff M3a, the swords and the transformation, in this (packaged) build: the exchange half-way through, gold in the ")
		TEXT("LEFT hand and cyan in the RIGHT (and on the left of the screen from behind), the companions veiled while held and restored ")
		TEXT("after, and every skin holding both; then Second's break-tests: the sides while forming (SW3c), a recolour (HD3), a skin (RP1) and a ")
		TEXT("far travel (RP2) while held, and interrupted returns (HD4, HD5). Frames at noon and night to Saved/Screenshots/WLSWORDS; WLSWQA lines; ")
		TEXT("`quit` exits after."),
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

#include "WonderlandMissionSubsystem.h"
#include "WonderlandMissionTasks.h"

#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Layout/Geometry.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "UObject/UObjectIterator.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SConstraintCanvas.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandCompanionFormation.h"
#include "WonderlandCompanionSubsystem.h"
#include "RelayDogCharacter.h"
#include "WonderlandDogPerformance.h"
#include "WonderlandMissionFixture.h"
#include "WonderlandMissionNarration.h"
#include "WonderlandUiSubsystem.h"
#include "GameFramework/WorldSettings.h"
#include "WonderlandMissionOrb.h"
#include "WonderlandPixelText.h"
#include "WonderlandTravel.h"
#include "WonderlandUiStyle.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandMissionUi, Log, All);

namespace
{
	/* ------------------------------------------------------------ the seven, on screen */

	// THE SAME READ-OUT THE ORB GIVES, in the corner of the eye: seven marks, each in its own chakra,
	// burning up to the step the task has reached. A viewer who learns it on the orb already knows it here.
	class SWonderlandChakraPips : public SLeafWidget
	{
	public:
		SLATE_BEGIN_ARGS(SWonderlandChakraPips) : _PipSize(9.0f), _Gap(6.0f) {}
			SLATE_ATTRIBUTE(int32, Step)
			SLATE_ARGUMENT(float, PipSize)
			SLATE_ARGUMENT(float, Gap)
		SLATE_END_ARGS()

		void Construct(const FArguments& InArgs)
		{
			Step = InArgs._Step;
			PipSize = InArgs._PipSize;
			Gap = InArgs._Gap;
			SetCanTick(false);
		}

		virtual FVector2D ComputeDesiredSize(float) const override
		{
			return FVector2D(WonderlandChakraSteps * PipSize + (WonderlandChakraSteps - 1) * Gap, PipSize);
		}

		virtual int32 OnPaint(const FPaintArgs&, const FGeometry& AllottedGeometry, const FSlateRect&,
			FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle&, bool) const override
		{
			const FSlateBrush* Box = FCoreStyle::Get().GetBrush("WhiteBrush");
			const int32 Reached = FMath::Clamp(Step.Get(0), 0, WonderlandChakraSteps);
			for (int32 Index = 0; Index < WonderlandChakraSteps; ++Index)
			{
				const FLinearColor Own = WonderlandChakraColour(WonderlandChakraForStep(Index + 1));
				const bool bLit = (Index + 1) <= Reached;
				// Unreached marks stay in their own hue at a fifth of the alpha, so the set still reads as an
				// ordered seven rather than as "one colour and six greys".
				const FLinearColor Paint(Own.R, Own.G, Own.B, bLit ? 1.0f : 0.20f);
				const float X = Index * (PipSize + Gap);
				FSlateDrawElement::MakeBox(OutDrawElements, LayerId,
					AllottedGeometry.ToPaintGeometry(FVector2f(PipSize, PipSize), FSlateLayoutTransform(FVector2f(X, 0.0f))),
					Box, ESlateDrawEffect::None, Paint);
			}
			return LayerId + 1;
		}

	private:
		TAttribute<int32> Step;
		float PipSize = 9.0f;
		float Gap = 6.0f;
	};

	/* ------------------------------------------------------------ console */

	void ForEachMission(TFunctionRef<void(UWonderlandMissionSubsystem&)> Body)
	{
		for (TObjectIterator<UWonderlandMissionSubsystem> It; It; ++It)
		{
			if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject))
			{
				// TObjectIterator dereferences to a POINTER, so one star is still T*.
				Body(**It);
			}
		}
	}

	FAutoConsoleCommand CmdMissionBeat(
		TEXT("wl.Mission.Beat"),
		TEXT("Show a mission beat on the Mission Contract Orb, e.g. `wl.Mission.Beat repair_required`. DEVELOPMENT PREVIEW: this is a drawn state, not Julius execution."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			if (Args.Num() < 1)
			{
				UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION usage: wl.Mission.Beat <beat id>"));
				return;
			}
			const FName Id(*Args[0]);
			ForEachMission([Id](UWonderlandMissionSubsystem& Mission)
			{
				UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION beat %s -> %s"), *Id.ToString(),
					Mission.SetBeatById(Id) ? TEXT("shown") : TEXT("NO SUCH BEAT"));
			});
		}));

	FAutoConsoleCommand CmdMissionNext(
		TEXT("wl.Mission.Next"),
		TEXT("Step the Mission Contract Orb to the next beat in the founder's order."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachMission([](UWonderlandMissionSubsystem& Mission)
			{
				UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION beat %s"), *Mission.AdvanceBeat().ToString());
			});
		}));

	FAutoConsoleCommand CmdMissionRun(
		TEXT("wl.Mission.Run"),
		TEXT("Play a deterministic mission fixture into the Mission Contract, e.g. `wl.Mission.Run full_lifecycle`. "
		     "No providers are called and nothing is paid for: the events come from a table. DEVELOPMENT PREVIEW."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Id(Args.Num() > 0 ? *Args[0] : TEXT("full_lifecycle"));
			const float Pace = Args.Num() > 1 ? FCString::Atof(*Args[1]) : 1.6f;
			ForEachMission([Id, Pace](UWonderlandMissionSubsystem& Mission)
			{
				UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION fixture %s -> %s"), *Id.ToString(),
					Mission.StartFixture(Id, Pace) ? TEXT("running") : TEXT("NO SUCH FIXTURE"));
			});
		}));

	FAutoConsoleCommand CmdMissionJoin(
		TEXT("wl.Mission.Join"),
		TEXT("Simulated /join in for the Mission Contract: `wl.Mission.Join none|llm|jhinn|both`. A joined companion flies about "
		     "the Contract and contributes to it, and its terminal narrates its part. DEVELOPMENT PREVIEW: nothing is imported."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FString Who = Args.Num() > 0 ? Args[0].ToLower() : FString(TEXT("both"));
			const bool bLlm = Who == TEXT("llm") || Who == TEXT("both");
			const bool bJhinn = Who == TEXT("jhinn") || Who == TEXT("both");
			ForEachMission([bLlm, bJhinn](UWonderlandMissionSubsystem& Mission) { Mission.SetJoinedIn(bLlm, bJhinn); });
		}));

	// WHERE THE FOUNDER'S PLAY COMMAND STAGES A MISSION (founder, 2026-09-16: "the location you are at is not ideal"): a
	// travel destination with open ground for the Dog's circle and the companions' orbit. Castle Approach's round paved
	// plaza, chosen from a survey of four sites in PIE: South Meadows' arrival arch stood in the Dog's circle and hid the
	// Dog and the Contract for most of a filmed mission; Grand Clock has flower beds against the Dog.
	TAutoConsoleVariable<FString> CVarMissionSite(TEXT("wl.Mission.Site"), TEXT("castle_approach"),
		TEXT("Where `wl.Mission.Scenario` plays a mission: a travel destination id (see the world map), or `none` to play it where the Dog stands."));

	FAutoConsoleCommand CmdMissionScenario(
		TEXT("wl.Mission.Scenario"),
		TEXT("Play a full simulated mission with a participation scenario at the simulation site (wl.Mission.Site) and open the "
		     "Julius Live Terminal to watch it: `wl.Mission.Scenario D` (seconds per event optional, default 10). A Julius only; "
		     "B + LLM Companion; C + Jhinn; D + both. Running it again restarts. No provider is called. DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			const FName Letter(Args.Num() > 0 ? *Args[0].ToUpper() : TEXT("D"));
			// TEN SECONDS AN EVENT BY DEFAULT: the pace the Julius terminal's stream needs to write each stage's work at
			// a readable speed (founder playtest, 2026-09-16). A number after the letter still sets it.
			const float Pace = Args.Num() > 1 ? FCString::Atof(*Args[1]) : 10.0f;
			ForEachMission([Letter, Pace](UWonderlandMissionSubsystem& Mission)
			{
				if (!Mission.PlayScenario(Letter, Pace))
				{
					UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION scenario %s -> NO SUCH SCENARIO (A, B, C or D)"), *Letter.ToString());
				}
			});
		}));

	FAutoConsoleCommand CmdMissionClearance(
		TEXT("wl.Mission.Clearance"),
		TEXT("Run the pre-mission spatial clearance probe where the Dog stands and print what it decided, without "
		     "starting anything. Use it to check a cramped location: `wl.Mission.Clearance`."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachMission([](UWonderlandMissionSubsystem& Mission)
			{
				const FWonderlandStagingResult Staging = Mission.ProbeClearanceNow();
				UE_LOG(LogWonderlandMissionUi, Display,
					TEXT("WLCLEARANCE %s  clear radius %.0f uu  headroom %.0f uu  camera %s  move %.0f uu  %d places measured"),
					WonderlandStagingFitName(Staging.Fit), Staging.Chosen.ClearRadiusUU, Staging.Chosen.ClearHeightUU,
					Staging.Chosen.bCameraClear ? TEXT("clear") : TEXT("BLOCKED"), Staging.Chosen.MoveUU, Staging.CandidatesTried);
			});
		}));

	FAutoConsoleCommand CmdMissionStop(
		TEXT("wl.Mission.Stop"),
		TEXT("Stop the running fixture and let the Mission Contract go: the world returns to idle and the companions to follow."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachMission([](UWonderlandMissionSubsystem& Mission)
			{
				Mission.StopFixture();
				Mission.SetBeatById(TEXT("idle"));
			});
		}));

	FAutoConsoleCommand CmdMissionFixtures(
		TEXT("wl.Mission.Fixtures"),
		TEXT("List the deterministic mission fixtures this build carries."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			for (int32 Index = 0; Index < WonderlandMissionFixtureCount(); ++Index)
			{
				const FWonderlandMissionFixture& Fixture = WonderlandMissionFixtureAt(Index);
				UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION fixture %-16s %d events  %s"),
					*Fixture.Id.ToString(), Fixture.Events.Num(), Fixture.Title);
			}
		}));

	FAutoConsoleCommand CmdMissionReset(
		TEXT("wl.Mission.Reset"),
		TEXT("Put the orb's chakra progression back to nothing, as the start of a new task does."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachMission([](UWonderlandMissionSubsystem& Mission) { Mission.ResetProgression(); });
		}));

	/** A UENUM member's name, e.g. "PromptArchitect". The enum is the one mirrored to TypeScript. */
	template <typename TEnum>
	FString EnumMemberName(TEnum Value)
	{
		const UEnum* Definition = StaticEnum<TEnum>();
		return Definition != nullptr
			? Definition->GetNameStringByValue(static_cast<int64>(Value))
			: FString(TEXT("Unknown"));
	}
}

/* ------------------------------------------------------------------ lifetime */

void UWonderlandMissionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	if (ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>())
	{
		ControllerChangedHandle = LocalPlayer->OnPlayerControllerChanged().AddUObject(this, &UWonderlandMissionSubsystem::HandlePlayerControllerChanged);
		if (LocalPlayer->PlayerController != nullptr)
		{
			HandlePlayerControllerChanged(LocalPlayer->PlayerController);
		}
	}
}

void UWonderlandMissionSubsystem::Deinitialize()
{
	StopFixture();
	if (PendingTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(PendingTicker);
		PendingTicker.Reset();
	}
	PendingScenario = NAME_None;
	Detach();
	if (ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>())
	{
		LocalPlayer->OnPlayerControllerChanged().Remove(ControllerChangedHandle);
	}
	Super::Deinitialize();
}

void UWonderlandMissionSubsystem::HandlePlayerControllerChanged(APlayerController* NewController)
{
	if (NewController == BoundController.Get())
	{
		return;
	}
	Detach();
	if (NewController == nullptr || NewController->GetWorld() == nullptr || !NewController->GetWorld()->IsGameWorld())
	{
		return;
	}
	// The orb rides with the companion preview: one switch turns the whole development world on and off.
	if (!UWonderlandCompanionSubsystem::IsPreviewEnabled())
	{
		UE_LOG(LogWonderlandMissionUi, Log, TEXT("WLMISSION preview off; no Mission Contract Orb spawned"));
		return;
	}
	BoundController = NewController;
	Attach(NewController);
}

void UWonderlandMissionSubsystem::Attach(APlayerController* Controller)
{
	// NOTHING IS SPAWNED HERE, and that is the founder's canon of 2026-09-16. Attaching to a controller
	// means a player is present in Wonderland; it does not mean a task is being executed. The contract is
	// manifested by ShowBeat when a beat arrives that describes a running task, and by nothing else.
	MountStrip();

	// FOLLOW THE TASK SET FROM HERE ON. Attaching still spawns nothing -- a player being present is not a task being
	// executed, which is the founder's canon of 2026-09-16 -- but a task EXISTING is, and that is what this listens
	// for. Bound at attach rather than inside the handler, which is where it was and where nothing could reach it.
	if (ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>())
	{
		if (UWonderlandMissionTaskSubsystem* TaskSet = Player->GetSubsystem<UWonderlandMissionTaskSubsystem>())
		{
			if (!bBoundToTasks)
			{
				bBoundToTasks = true;
				TWeakObjectPtr<UWonderlandMissionSubsystem> WeakThis(this);
				TaskSet->OnTasksChanged.AddLambda([WeakThis]()
				{
					if (WeakThis.IsValid())
					{
						WeakThis->SyncTaskOrbs();
						// AND THE DOG, because a contract changing stage IS the thing it performs. TellTheDog used to
						// run only from ShowBeat, so with no kernel attached there were no beats, it was never called,
						// and a contract could walk its whole lifecycle with the mascot standing still -- measured in
						// PIE as seven stages with dog_act NONE seven times.
						WeakThis->TellTheDog();
					}
				});
			}
			// And catch up with whatever already exists, so a set built before the attach is not invisible.
			SyncTaskOrbs();
			TellTheDog();
		}
	}

	UE_LOG(LogWonderlandMissionUi, Log, TEXT("WLMISSION attached to %s, strip %s, no contract (nothing is executing)"),
		*Controller->GetName(), MissionStrip.IsValid() ? TEXT("on screen") : TEXT("FAILED"));
}

/**
 * Bring a Mission Contract into the world if one is not already here, and hand it the beat.
 *
 * A CONTRACT IS PER TASK, so a fresh one starts with no chakra -- which the crystal draws as red, the
 * colour the founder's canon begins every task at. Nothing carries over from the contract before it.
 */
AWonderlandMissionOrb* UWonderlandMissionSubsystem::EnsureContract()
{
	if (AWonderlandMissionOrb* Existing = Orb.Get())
	{
		Existing->SetManifest(1.0f);
		return Existing;
	}
	APlayerController* Controller = BoundController.Get();
	UWorld* World = Controller != nullptr ? Controller->GetWorld() : nullptr;
	if (World == nullptr)
	{
		return nullptr;
	}
	const APawn* Pawn = Controller->GetPawn();
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;
	AWonderlandMissionOrb* Spawned = World->SpawnActor<AWonderlandMissionOrb>(
		AWonderlandMissionOrb::StaticClass(), Pawn != nullptr ? Pawn->GetActorTransform() : FTransform::Identity, Params);
	if (Spawned == nullptr)
	{
		UE_LOG(LogWonderlandMissionUi, Error, TEXT("WLMISSION could not manifest a Mission Contract"));
		return nullptr;
	}
#if WITH_EDITOR
	Spawned->SetActorLabel(TEXT("WL_MissionContract"), false);
#endif
	Spawned->SetFollowController(Controller);
	Spawned->SetManifest(1.0f);
	Spawned->SnapToTarget();
	Orb = Spawned;
	++ContractsManifested;
	UE_LOG(LogWonderlandMissionUi, Log, TEXT("WLMISSION contract %d manifested (DEVELOPMENT PREVIEW)"), ContractsManifested);
	return Spawned;
}

/** Let the contract fade and dismiss itself. It destroys its own actor once it has finished leaving. */
void UWonderlandMissionSubsystem::DismissContract()
{
	if (AWonderlandMissionOrb* Existing = Orb.Get())
	{
		Existing->SetManifest(0.0f);
		Existing->ReleaseAnchor();
		// THE POINTER IS KEPT THROUGH THE FADE, deliberately. The actor clears it by destroying itself, and
		// a mission that starts mid-fade revives this crystal instead of spawning a second one beside it.
		// What ENDS at the mission's end is not the actor but the CONTRACT, and TellTheDog draws that line.
	}
}

/**
 * THE ONE PLACE THE BODY IS TOLD, and the only place that knows both the beat and the crystal.
 *
 * THE NULL IS LOAD-BEARING, not tidiness. The Dog's `None` act cannot mean "stop", because handoff lands
 * there and a handoff mid-implementation must KEEP the brush -- but completion and idle land there too and
 * need the opposite. The animation layer tells them apart by whether a contract came with the act, which
 * only works if the contract pointer is live for exactly as long as the mission (lane owner, 2026-09-16).
 *
 * So it is bound to the BEAT, not to the actor: the moment a beat stops describing a running task the Dog
 * is handed nullptr, whether or not the crystal is still fading out of the air. Tying it to the actor
 * instead would leave the Dog painting through the fade with no way to know it should stop.
 */
void UWonderlandMissionSubsystem::TellTheDog()
{
	APlayerController* Controller = BoundController.Get();
	APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	ARelayDogCharacter* Dog = Cast<ARelayDogCharacter>(Pawn);
	if (Dog == nullptr)
	{
		// Not every body the player can wear is the canonical Dog -- the hub pawn and a spectator are not.
		return;
	}
	bool bMissionRunning = WonderlandBeatShowsContract(Beat);
	EWonderlandDogAct Act = WonderlandDogActForBeat(Beat);

	// ---- AND A MISSION CONTRACT THE FOUNDER CAN SEE PERFORMS WHEN NO BEAT SAYS OTHERWISE.
	//
	// THE DEFECT THIS CLOSES, measured in PIE. A contract driven through its whole lifecycle -- PREPARATION,
	// RESEARCH, IMPLEMENTATION, VERIFICATION, REVIEW, REPAIR, COMPLETED -- changed state correctly at every
	// step and the Dog performed NONE at every step, because this function only ever read the BEAT and beats
	// come from Julius. With no kernel attached there are no beats, so the mascot stood still through the
	// entire performance the founder was watching for. It was never a skin fault: Relay OG did nothing either.
	//
	// NOTHING IS PRETENDED HERE. This does not invent progress or mark anything as Julius-reported; it reads
	// the state the contract is ALREADY in and performs it. A contract that is merely QUEUED still maps to
	// None, so a queued contract remains a Dog standing still, exactly as before.
	if (const ULocalPlayer* Instance = Controller->GetLocalPlayer())
	{
		if (const UWonderlandMissionTaskSubsystem* Tasks = Instance->GetSubsystem<UWonderlandMissionTaskSubsystem>())
		{
			const EWonderlandDogAct FromContract = WonderlandDogActForTaskState(Tasks->GetPerformingState());
			// AND ONLY WHERE THE BEAT HAS NOTHING TO SAY. A connected kernel stays the authority it already was:
			// this fills the silence that was leaving the Dog motionless and never overrides a real beat, so the
			// Julius-driven path behaves today exactly as it did before this existed.
			if (Act == EWonderlandDogAct::None && FromContract != EWonderlandDogAct::None)
			{
				Act = FromContract;
				bMissionRunning = true;
			}
		}
	}
	Dog->SetMissionAct(Act, bMissionRunning ? Orb.Get() : nullptr);
}

void UWonderlandMissionSubsystem::Detach()
{
	if (AWonderlandMissionOrb* Body = Orb.Get())
	{
		Body->Destroy();
	}
	Orb.Reset();
	if (MissionStrip.IsValid())
	{
		if (ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>())
		{
			if (LocalPlayer->ViewportClient != nullptr)
			{
				LocalPlayer->ViewportClient->RemoveViewportWidgetForPlayer(LocalPlayer, MissionStrip.ToSharedRef());
			}
		}
		MissionStrip.Reset();
		MissionStripBar.Reset();
	}
	BoundController.Reset();
}

/* ------------------------------------------------------------------ the strip */

void UWonderlandMissionSubsystem::MountStrip()
{
	ULocalPlayer* LocalPlayer = GetLocalPlayer<ULocalPlayer>();
	if (MissionStrip.IsValid() || LocalPlayer == nullptr || LocalPlayer->ViewportClient == nullptr)
	{
		return;
	}
	const TWeakObjectPtr<UWonderlandMissionSubsystem> WeakThis(this);
	const FSlateBrush* Box = FCoreStyle::Get().GetBrush("WhiteBrush");

	// TOP CENTRE, which is the one band of the play frame nothing else claims: the usage HUD owns the top
	// left, the companion consoles the two flanks, and the Julius terminal the floor.
	TSharedRef<SWidget> Bar =
		SNew(SBorder)
		.BorderImage(Box)
		.BorderBackgroundColor(WonderlandUi::Srgb(4, 4, 6, 0.80f))
		.Padding(FMargin(16.0f, 9.0f, 16.0f, 8.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Font(WonderlandUi::Sans(9, true, 3))
					.ColorAndOpacity(WonderlandUi::GoldDim())
					.Text(NSLOCTEXT("Wonderland", "MissionContract", "MISSION CONTRACT"))
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(FMargin(14.0f, 0.0f, 14.0f, 0.0f))
				[
					SNew(SWonderlandPixelText)
					.CellSize(2.9f)
					.Color(WonderlandUi::Cream())
					.Text_Lambda([WeakThis]() { return WeakThis.IsValid() ? WeakThis->GetBeatLabel() : FString(); })
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(SWonderlandChakraPips)
					.Step_Lambda([WeakThis]() { return WeakThis.IsValid() ? WeakThis->GetChakraStep() : 0; })
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(FMargin(0.0f, 5.0f, 0.0f, 0.0f))
			[
				// NEVER WITHOUT THIS LINE. A drawn beat that read as a running mission is the confusion the
				// founder forbade, so the label travels with the strip and not in a settings page.
				SNew(STextBlock)
				.Font(WonderlandUi::Sans(8, false, 2))
				.ColorAndOpacity(WonderlandUi::Faint())
				.Text_Lambda([WeakThis]()
				{
					if (!WeakThis.IsValid())
					{
						return FText::GetEmpty();
					}
					UWonderlandMissionSubsystem* Mission = WeakThis.Get();
					// MISSION, EVENT, JULIUS STATE, CHAKRA, STATUS -- the five the founder asked for, on one
					// line, and the last of them is never omitted.
					const FString Where = Mission->IsFixtureRunning()
						? FString::Printf(TEXT("%s  %d/%d"), *Mission->GetFixtureId().ToString(),
							Mission->GetFixtureProgress(), Mission->GetFixtureEventCount())
						: FString(TEXT("no fixture"));
					const FName MissionId = Mission->GetFoldMissionId();
					// THE BANNER IS ASKED FOR RATHER THAN ASSERTED. This line carried the words DEVELOPMENT PREVIEW
					// and SIMULATED JULIUS EXECUTION as literals, so it printed them over a real Julius run, next to
					// MISSION none, while the task set was correctly following that run. Both were true sentences
					// about a build that could not do this yet and false the moment it could.
					return FText::FromString(FString::Printf(
						TEXT("%s   |   MISSION %s · EVENT %s (%s) · STATE %s · %s %d/%d · DOG %s%s · COMPANIONS %s%s   |   %s"),
						*Mission->GetProvenanceBanner(),
						MissionId.IsNone() ? TEXT("none") : *MissionId.ToString(),
						Mission->GetPresentedEventType().IsNone() ? TEXT("-") : *Mission->GetPresentedEventType().ToString(),
						*Mission->GetLastEventVerdict(),
						*Mission->GetBeatPhase(Mission->GetBeatId()),
						*Mission->GetChakraName(), Mission->GetChakraStep(), WonderlandChakraSteps,
						*Mission->GetDogActLabel(), Mission->IsContractAnchored() ? TEXT(" · ANCHORED") : TEXT(""),
						*Mission->GetCompanionFormation(),
						Mission->IsLlmCompanionJoined() || Mission->IsJhinnJoined()
							? *FString::Printf(TEXT(" · SIMULATED /JOIN IN %s"), Mission->IsLlmCompanionJoined() && Mission->IsJhinnJoined()
								? TEXT("LLM + JHINN") : (Mission->IsLlmCompanionJoined() ? TEXT("LLM") : TEXT("JHINN")))
							: TEXT(""),
						*Where));
				})
			]
		];

	MissionStrip = SNew(SConstraintCanvas)
		.Visibility(EVisibility::HitTestInvisible)
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.5f, 0.022f, 0.5f, 0.022f))
		.Alignment(FVector2D(0.5f, 0.0f))
		.AutoSize(true)
		.Offset(FMargin(0.0f))
		[
			Bar
		];
	MissionStripBar = Bar;
	// Above the usage HUD, below the companion consoles (20) and every panel.
	LocalPlayer->ViewportClient->AddViewportWidgetForPlayer(LocalPlayer, MissionStrip.ToSharedRef(), 18);
}

bool UWonderlandMissionSubsystem::GetMissionStripAbsoluteRect(FSlateRect& OutRect) const
{
	if (!MissionStripBar.IsValid())
	{
		return false;
	}
	const FGeometry& Geometry = MissionStripBar->GetCachedGeometry();
	if (Geometry.GetLocalSize().IsNearlyZero())
	{
		return false;
	}
	OutRect = Geometry.GetLayoutBoundingRect();
	return true;
}

/* ------------------------------------------------------------------ the beat */

bool UWonderlandMissionSubsystem::SetBeatById(FName BeatId)
{
	const EWonderlandMissionBeat Wanted = WonderlandBeatFromId(BeatId);
	// Unobserved is a real beat and must be selectable; anything else resolving there is a name that missed.
	if (Wanted == EWonderlandMissionBeat::Unobserved && WonderlandBeatId(Wanted) != BeatId)
	{
		return false;
	}
	ShowBeat(Wanted);
	return true;
}

/**
 * THE ONE PLACE A BEAT BECOMES A WORLD. Everything that drives the contract -- a console command, the
 * deterministic simulator, and in Phase 4 a Julius event -- arrives here, and this decides whether a
 * crystal exists, not the caller.
 */
void UWonderlandMissionSubsystem::ShowBeat(EWonderlandMissionBeat Wanted)
{
	const bool bWasShowing = WonderlandBeatShowsContract(Beat);
	const bool bShowing = WonderlandBeatShowsContract(Wanted);
	Beat = Wanted;

	if (!bShowing)
	{
		DismissContract();
		TellTheDog();
		TellTheCompanions();
		return;
	}
	if (AWonderlandMissionOrb* Body = EnsureContract())
	{
		if (!bWasShowing)
		{
			// A NEW TASK STARTS AT RED. The contract that just arrived carries nothing from the last one,
			// so the progression is cleared before the first beat lands on it.
			Body->ResetProgression();
			Body->ReleaseAnchor();
			// AND IT APPEARS OUT OF THE ENERGY THE RELAY DOG GATHERS (founder, 2026-09-16): the Dog meditates, the energy
			// gathers where the Contract will be, and the Contract grows out of it a few seconds into preparation.
			if (Beat == EWonderlandMissionBeat::MissionStart)
			{
				Body->ManifestAfter(3.2f);
			}
		}
		Body->SetBeat(Beat);

		// ---------------------------------------------------------------- it becomes a place
		// ANCHORED FOR THE WHOLE MISSION, not per performance. The founder's four performances need the
		// contract to hold still -- you cannot circle a point that moves with you, and "face the contract"
		// is degenerate when it is always straight ahead. But anchoring and releasing per stage would make
		// it slide every time the mission passed through research or a handoff, so the anchor is taken at
		// the first PERFORMED act and held until the mission ends.
		if (!Body->IsAnchored() && WonderlandDogActForBeat(Beat) != EWonderlandDogAct::None)
		{
			Body->AnchorHere();
		}
	}
	TellTheDog();
	TellTheCompanions();
}

FName UWonderlandMissionSubsystem::AdvanceBeat()
{
	const int32 Next = (static_cast<int32>(Beat) + 1) % WonderlandMissionBeatCount;
	ShowBeat(static_cast<EWonderlandMissionBeat>(Next));
	return WonderlandBeatId(Beat);
}

void UWonderlandMissionSubsystem::ResetProgression()
{
	if (AWonderlandMissionOrb* Body = Orb.Get())
	{
		Body->ResetProgression();
	}
}

FName UWonderlandMissionSubsystem::GetBeatId() const
{
	return WonderlandBeatId(Beat);
}

FString UWonderlandMissionSubsystem::GetBeatLabel() const
{
	return WonderlandBeatReading(Beat).Label;
}

int32 UWonderlandMissionSubsystem::GetChakraStep() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return Body != nullptr ? Body->GetChakraStep() : 0;
}

FString UWonderlandMissionSubsystem::GetChakraName() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return WonderlandChakraName(Body != nullptr ? Body->GetChakra() : EWonderlandChakra::None);
}

FName UWonderlandMissionSubsystem::GetBeatIdAt(int32 Index) const
{
	return (Index >= 0 && Index < WonderlandMissionBeatCount)
		? WonderlandBeatId(static_cast<EWonderlandMissionBeat>(Index))
		: NAME_None;
}

FString UWonderlandMissionSubsystem::GetBeatPhase(FName BeatId) const
{
	return EnumMemberName(WonderlandBeatReading(WonderlandBeatFromId(BeatId)).Phase);
}

FString UWonderlandMissionSubsystem::GetBeatAccent(FName BeatId) const
{
	return EnumMemberName(WonderlandBeatReading(WonderlandBeatFromId(BeatId)).Accent);
}

FString UWonderlandMissionSubsystem::GetBeatEvents(FName BeatId) const
{
	return WonderlandBeatReading(WonderlandBeatFromId(BeatId)).Events;
}

FString UWonderlandMissionSubsystem::GetBeatNotYetEmitted(FName BeatId) const
{
	return WonderlandBeatReading(WonderlandBeatFromId(BeatId)).NotYetEmitted;
}

int32 UWonderlandMissionSubsystem::GetBeatChakraStep(FName BeatId, int32 PreviousStep) const
{
	const EWonderlandChakra Previous = WonderlandChakraForStep(PreviousStep);
	return WonderlandChakraStep(WonderlandChakraForBeat(WonderlandBeatFromId(BeatId), Previous));
}

bool UWonderlandMissionSubsystem::DoesBeatAskForAHuman(FName BeatId) const
{
	return WonderlandBeatReading(WonderlandBeatFromId(BeatId)).bAsksForAHuman;
}

bool UWonderlandMissionSubsystem::SetOrbScale(float Scale)
{
	if (AWonderlandMissionOrb* Body = Orb.Get())
	{
		Body->SetOrbScale(Scale);
		return true;
	}
	return false;
}

bool UWonderlandMissionSubsystem::SetOrbFollowOffset(float Forward, float Right)
{
	if (AWonderlandMissionOrb* Body = Orb.Get())
	{
		Body->SetFollowOffset(Forward, Right);
		return true;
	}
	return false;
}

float UWonderlandMissionSubsystem::GetOrbHeightUU() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return Body != nullptr ? Body->GetOrbHeightUU() : 0.0f;
}

/**
 * THE SAME BEAT DRIVES THE COMPANIONS. Not a second stream and not their own timer -- one source of stage
 * truth in the world, so the companions cannot disagree with the Dog about what is happening.
 */
void UWonderlandMissionSubsystem::TellTheCompanions()
{
	UWonderlandCompanionSubsystem* Companions = GetLocalPlayer<ULocalPlayer>() != nullptr
		? GetLocalPlayer<ULocalPlayer>()->GetSubsystem<UWonderlandCompanionSubsystem>()
		: nullptr;
	if (Companions == nullptr)
	{
		return;
	}
	const bool bMissionRunning = WonderlandBeatShowsContract(Beat);
	const int32 Count = Companions->GetEmbodimentCount();
	// Joined companions share a circle between themselves, opposite each other, so they never meet.
	const int32 JoinedCount = (bLlmJoined ? 1 : 0) + (bJhinnJoined ? 1 : 0);
	int32 JoinedSlot = 0;
	for (int32 Index = 0; Index < Count; ++Index)
	{
		AWonderlandCompanionEmbodiment* Body = Companions->GetEmbodiment(Index);
		if (Body == nullptr)
		{
			continue;
		}
		const bool bAgent = Index == 1;
		const bool bJoined = bMissionRunning && (bAgent ? bJhinnJoined : bLlmJoined);
		// THE SAME BEAT, THE SAME CALL: the flight here and the line on this companion's terminal come from one beat.
		const EWonderlandCompanionFormation Wanted = bMissionRunning
			? WonderlandCompanionFlightForBeat(Beat, bJoined, Body->GetFormation())
			: EWonderlandCompanionFormation::Follow;
		const int32 Slot = bJoined ? JoinedSlot++ : Index;
		const int32 Slots = bJoined ? FMath::Max(JoinedCount, 1) : Count;
		Body->SetFormation(Wanted, bMissionRunning ? Orb.Get() : nullptr, Slot, Slots);
		// Each companion's contribution is in its own colour: starlight for the LLM Companion, imported cyan for the Jhinn.
		Body->SetParticipation(bJoined, bAgent, bAgent ? WonderlandUi::Srgb(0x5C, 0xDB, 0xFF) : WonderlandUi::Srgb(0xF4, 0xF7, 0xFF),
			WonderlandBeatId(Beat));
	}
}

FString UWonderlandMissionSubsystem::GetCompanionFormation() const
{
	// The flight of the first companion taking part, or the flight every companion is in when none has joined.
	for (int32 Index = 0; Index < 2; ++Index)
	{
		const AWonderlandCompanionEmbodiment* Body = Companion(Index);
		if (Body != nullptr && Body->IsJoined())
		{
			return Body->GetFormationName();
		}
	}
	const AWonderlandCompanionEmbodiment* Any = Companion(0);
	return Any != nullptr ? Any->GetFormationName() : WonderlandCompanionFormationName(EWonderlandCompanionFormation::Follow);
}

AWonderlandCompanionEmbodiment* UWonderlandMissionSubsystem::Companion(int32 Index) const
{
	const ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	const UWonderlandCompanionSubsystem* Companions = Player != nullptr ? Player->GetSubsystem<UWonderlandCompanionSubsystem>() : nullptr;
	return Companions != nullptr ? Companions->GetEmbodiment(Index) : nullptr;
}

void UWonderlandMissionSubsystem::SetJoinedIn(bool bLlmCompanion, bool bJhinnAgent)
{
	bLlmJoined = bLlmCompanion;
	bJhinnJoined = bJhinnAgent;
	UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION simulated /join in: LLM Companion %s, Jhinn %s"),
		bLlmJoined ? TEXT("joined") : TEXT("not joined"), bJhinnJoined ? TEXT("joined") : TEXT("not joined"));
	TellTheCompanions();
}

bool UWonderlandMissionSubsystem::RunScenario(FName ScenarioLetter, float SecondsPerEvent)
{
	const FString Letter = ScenarioLetter.ToString().ToUpper();
	if (Letter != TEXT("A") && Letter != TEXT("B") && Letter != TEXT("C") && Letter != TEXT("D"))
	{
		return false;
	}
	Scenario = FName(*Letter);
	SetJoinedIn(Letter == TEXT("B") || Letter == TEXT("D"), Letter == TEXT("C") || Letter == TEXT("D"));
	return StartFixture(TEXT("full_lifecycle"), SecondsPerEvent);
}

bool UWonderlandMissionSubsystem::PlayScenario(FName ScenarioLetter, float SecondsPerEvent)
{
	const FString Letter = ScenarioLetter.ToString().ToUpper();
	if (Letter != TEXT("A") && Letter != TEXT("B") && Letter != TEXT("C") && Letter != TEXT("D"))
	{
		return false;
	}
	// A clean start: whatever was running stops, and the world is idle while the Dog goes to the site.
	StopFixture();
	SetBeatById(TEXT("idle"));
	PendingScenario = NAME_None;
	if (PendingTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(PendingTicker);
		PendingTicker.Reset();
	}

	const FName Site(*CVarMissionSite.GetValueOnGameThread().TrimStartAndEnd());
	UWorld* World = GetWorld();
	UWonderlandTravelSubsystem* Travel = World != nullptr ? World->GetSubsystem<UWonderlandTravelSubsystem>() : nullptr;
	const bool bStayHere = Site.IsNone() || Site == FName(TEXT("none")) || Travel == nullptr
		|| Travel->GetNearestOfferedDestination(1500.0) == Site;
	if (!bStayHere)
	{
		FText Refusal;
		if (Travel->RequestTravel(Site, Refusal))
		{
			PendingScenario = FName(*Letter);
			PendingPace = SecondsPerEvent;
			PendingArrivedAt = -1.0;
			PendingTicker = FTSTicker::GetCoreTicker().AddTicker(
				FTickerDelegate::CreateUObject(this, &UWonderlandMissionSubsystem::StepPendingScenario), 0.0f);
			UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION scenario %s: travelling to the simulation site '%s' first"), *Letter, *Site.ToString());
			return true;
		}
		UE_LOG(LogWonderlandMissionUi, Warning, TEXT("WLMISSION scenario %s: cannot reach the simulation site '%s' (%s); playing it here"),
			*Letter, *Site.ToString(), *Refusal.ToString());
	}
	// EVERY PATH INTO THE CUTSCENE GOES THROUGH THE BUBBLE, including this one. A probe that only ran on the
	// travelling path would be a probe that missed exactly the missions played where the player happens to stand.
	return BeginMissionWithClearance(FName(*Letter), SecondsPerEvent);
}

namespace
{
	/**
	 * HOW FAR APART THE ORBS SIT, in uu -- WHICH IS THE HEIGHT OF ONE ORB, so their tips meet and the column is
	 * one object rather than several.
	 *
	 * FOUNDER, on the first filmed stack: "The orbs should not be that spread apart, they should be touching."
	 *
	 * THE OLD NUMBER CAME FROM A WRONG MEASUREMENT. The comment that used to stand here said a Mission Contract orb
	 * is "about 80 uu tall" and chose 105 to leave it a little air. The geometry says 2 * CrystalHalfHeightUU =
	 * 56 uu, so 105 was not a small gap above an orb -- it was most of a second orb of empty sky between each one,
	 * and the filmed stack read as three separate distant objects exactly as the founder said.
	 *
	 * TIPS MEETING, NOT OVERLAPPING. The crystal is a bipyramid reaching CrystalHalfHeightUU above and below its
	 * origin, so a step of exactly twice that puts the point of one orb on the point of the next. An unselected orb
	 * draws at 0.86 and leaves a few uu of air, which still reads as a stack; a smaller step would drive one
	 * crystal through another and stop it reading as orbs at all.
	 */
	constexpr float OrbStackSpacingUU = 56.0f;
}

float UWonderlandMissionSubsystem::GetStackHeightUu() const
{
	// One orb is the Contract's own height; each one above adds a step. Never less than one orb's worth, because a
	// mission with no task list still manifests a Contract.
	const int32 Orbs = FMath::Max(TaskOrbs.Num(), 1);
	return (Orbs - 1) * OrbStackSpacingUU;
}

void UWonderlandMissionSubsystem::SyncTaskOrbs()
{
	ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	UWonderlandMissionTaskSubsystem* Tasks = Player != nullptr
		? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
	// The subscription is made at Attach, not here: binding inside the handler meant nothing ever subscribed.
	APlayerController* Controller = BoundController.Get();
	UWorld* World = Controller != nullptr ? Controller->GetWorld() : nullptr;
	if (Tasks == nullptr || World == nullptr)
	{
		return;
	}

	const TArray<FWonderlandMissionTask>& Rows = Tasks->GetTasks();

	// ---- take away the orbs whose tasks have gone OR ARE NO LONGER PRESENTED. A dismissed draft leaves nothing
	// ---- behind; a tab closed with X takes its orb with it and keeps its record; a completed or failed contract
	// ---- keeps its tab and loses its orb, because the orb is an ACTIVE-task visualisation and nothing else.
	TArray<FGuid> Gone;
	for (const TPair<FGuid, TWeakObjectPtr<AWonderlandMissionOrb>>& Pair : TaskOrbs)
	{
		if (!Tasks->ShouldPresentOrb(Pair.Key))
		{
			Gone.Add(Pair.Key);
		}
	}
	for (const FGuid& Id : Gone)
	{
		if (AWonderlandMissionOrb* Stacked = TaskOrbs[Id].Get())
		{
			Stacked->Destroy();
		}
		TaskOrbs.Remove(Id);
	}

	// ---- and bring the rest into line, bottom to top. THE STACK INDEX COUNTS ONLY PRESENTED ORBS, so a closed
	// ---- tab in the middle of the list does not leave a gap of air in the column.
	int32 Index = -1;
	for (const FWonderlandMissionTask& Task : Rows)
	{
		if (!Tasks->ShouldPresentOrb(Task.LocalId))
		{
			continue;
		}
		++Index;
		TWeakObjectPtr<AWonderlandMissionOrb>* Found = TaskOrbs.Find(Task.LocalId);
		AWonderlandMissionOrb* Stacked = Found != nullptr ? Found->Get() : nullptr;
		if (Stacked == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Params.ObjectFlags |= RF_Transient;
			const APawn* Pawn = Controller->GetPawn();
			Stacked = World->SpawnActor<AWonderlandMissionOrb>(AWonderlandMissionOrb::StaticClass(),
				Pawn != nullptr ? Pawn->GetActorTransform() : FTransform::Identity, Params);
			if (Stacked == nullptr)
			{
				continue;
			}
#if WITH_EDITOR
			Stacked->SetActorLabel(FString::Printf(TEXT("WL_MissionContract_%d"), Index), false);
#endif
			Stacked->SetFollowController(Controller);
			Stacked->SetManifest(1.0f);
			Stacked->SnapToTarget();
			TaskOrbs.Add(Task.LocalId, Stacked);
		}
		// GRAY WHILE THE SLOT IS EMPTY, coloured once a contract exists. One question, asked of the task.
		Stacked->SetDraft(!WonderlandTaskIsContract(Task.State));
		// Index 0 sits where the Contract has always sat; each one above is a step higher.
		Stacked->SetStackLift(Index * OrbStackSpacingUU);
		// THE SELECTED TASK'S ORB IS THE FULL-SIZED ONE. The others stand back a little so the stack reads as a
		// stack with a current member rather than as a row of equals.
		// 0.72 made the unselected orbs read as distant rather than as smaller, and two frames taken with different
		// selections were indistinguishable. 0.86 is still plainly a step down from the current contract.
		Stacked->SetOrbScale(Task.LocalId == Tasks->GetSelected() ? 1.0f : 0.86f);
	}
}

TArray<FString> UWonderlandMissionSubsystem::DescribeOrbStack() const
{
	TArray<FString> Lines;
	const ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	const UWonderlandMissionTaskSubsystem* Tasks = Player != nullptr
		? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
	if (Tasks == nullptr)
	{
		Lines.Add(TEXT("no task subsystem"));
		return Lines;
	}
	Lines.Add(FString::Printf(TEXT("ORB STACK  %d orb(s)  ·  %.0f uu tall"), TaskOrbs.Num(), GetStackHeightUu()));
	const TArray<FWonderlandMissionTask>& Rows = Tasks->GetTasks();
	for (int32 Index = 0; Index < Rows.Num(); ++Index)
	{
		const TWeakObjectPtr<AWonderlandMissionOrb>* Found = TaskOrbs.Find(Rows[Index].LocalId);
		const AWonderlandMissionOrb* Stacked = Found != nullptr ? Found->Get() : nullptr;
		Lines.Add(FString::Printf(TEXT("  %d %s %-5s lift %4.0f uu  %s"),
			Index,
			Rows[Index].LocalId == Tasks->GetSelected() ? TEXT("*") : TEXT(" "),
			Stacked == nullptr ? TEXT("-") : (Stacked->IsDraft() ? TEXT("GRAY") : TEXT("RED")),
			Index * OrbStackSpacingUU,
			*Rows[Index].Objective.Left(48)));
	}
	return Lines;
}

FWonderlandStagingResult UWonderlandMissionSubsystem::ProbeClearanceNow()
{
	UWorld* World = GetWorld();
	APlayerController* Controller = BoundController.Get();
	APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	const FVector Origin = Pawn != nullptr ? Pawn->GetActorLocation() : FVector::ZeroVector;
	const FVector Facing = Pawn != nullptr ? Pawn->GetActorForwardVector() : FVector(1.0, 0.0, 0.0);

	// THE MISSION'S OWN ACTORS ARE NOT OBSTRUCTIONS TO THE MISSION. A Dog standing at the staging point does not
	// block the staging point, and neither does the Contract it is about to manifest.
	TArray<const AActor*> Ignore;
	Ignore.Add(Pawn);
	Ignore.Add(Orb.Get());

	// THE WHOLE STACK IS WHAT HAS TO FIT, not one Contract. A second orb above the first raises the envelope, so
	// the probe is told how tall the presentation actually stands before it measures anything.
	FWonderlandStagingEnvelope Full = WonderlandFullEnvelope();
	Full.VerticalUU += GetStackHeightUu();
	Full.ContractHeightUU += GetStackHeightUu();
	LastStaging = WonderlandProbeStaging(World, Origin, Facing, Ignore, Full);
	for (const FString& Note : LastStaging.Notes)
	{
		UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLCLEARANCE %s"), *Note);
	}
	return LastStaging;
}

void UWonderlandMissionSubsystem::ApplyStaging(const FWonderlandStagingResult& Staging)
{
	APlayerController* Controller = BoundController.Get();
	const APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	const bool bCompact = Staging.Fit != EWonderlandStagingFit::Full;

	// A COMPACT PRESENTATION IS THE SAME PRESENTATION, SMALLER AND CLOSER. Both of these are knobs the mission
	// already has, so nothing downstream has to know a probe happened.
	SetOrbScale(bCompact ? 0.62f : 1.0f);

	// AND THE CONTRACT MANIFESTS TOWARD THE CLEAR SPACE. The Contract already stands at an offset from the Dog, so
	// aiming that offset is how a chosen position is honoured -- nobody is teleported, and the Dog walks to its own
	// mark as it always did.
	float Forward = bCompact ? 190.0f : 340.0f;
	float Right = bCompact ? 20.0f : 40.0f;
	if (Pawn != nullptr && Staging.Chosen.MoveUU > 1.0f)
	{
		const FVector Toward = Staging.Location - Pawn->GetActorLocation();
		const float Reach = FMath::Min(static_cast<float>(Toward.Size2D()), bCompact ? 240.0f : 520.0f);
		const FVector Unit = Toward.GetSafeNormal2D();
		Forward = static_cast<float>(FVector::DotProduct(Unit, Pawn->GetActorForwardVector())) * Reach;
		Right = static_cast<float>(FVector::DotProduct(Unit, Pawn->GetActorRightVector())) * Reach;
		// Never behind the Dog: a Contract manifesting out of shot is worse than one manifesting a little close.
		Forward = FMath::Max(Forward, bCompact ? 150.0f : 260.0f);
	}
	SetOrbFollowOffset(Forward, Right);

	UE_LOG(LogWonderlandMissionUi, Display,
		TEXT("WLCLEARANCE staging %s: contract at (%.0f, %.0f) from the Dog, orb scale %.2f, %d places measured"),
		WonderlandStagingFitName(Staging.Fit), Forward, Right, bCompact ? 0.62f : 1.0f, Staging.CandidatesTried);
}

bool UWonderlandMissionSubsystem::BeginMissionWithClearance(FName ScenarioLetter, float SecondsPerEvent)
{
	const FString Letter = ScenarioLetter.ToString().ToUpper();
	if (Letter != TEXT("A") && Letter != TEXT("B") && Letter != TEXT("C") && Letter != TEXT("D"))
	{
		return false;
	}
	UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return false;
	}

	// THE PROBE RUNS AT ONCE; THE BUBBLE IS WHAT TAKES A MOMENT. Tracing a dozen places is microseconds, so holding
	// the mission for a second and a half is a deliberate beat rather than a wait for arithmetic: the founder asked
	// for a bubble the player sees, and a probe nobody notices would not be one.
	ProbeClearanceNow();
	ClearanceScenario = FName(*Letter);
	ClearancePace = SecondsPerEvent;
	ClearanceStartedAt = World->GetTimeSeconds();
	ClearanceUntil = ClearanceStartedAt + 1.4;
	if (ClearanceTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(ClearanceTicker);
	}
	ClearanceTicker = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateUObject(this, &UWonderlandMissionSubsystem::StepClearance), 0.0f);
	return true;
}

bool UWonderlandMissionSubsystem::StepClearance(float DeltaSeconds)
{
	UWorld* World = GetWorld();
	if (World == nullptr || ClearanceScenario == NAME_None)
	{
		ClearanceUntil = 0.0;
		ClearanceTicker.Reset();
		return false;
	}
	if (World->GetTimeSeconds() < ClearanceUntil)
	{
		return true;
	}
	const FName Letter = ClearanceScenario;
	ClearanceScenario = NAME_None;
	ClearanceUntil = 0.0;
	ClearanceTicker.Reset();
	ApplyStaging(LastStaging);
	// AND THE CUTSCENE BEGINS -- whatever the probe found. There is no branch here that does not start the mission.
	StartScenarioAndWatch(Letter, ClearancePace);
	return false;
}

bool UWonderlandMissionSubsystem::StepPendingScenario(float DeltaSeconds)
{
	UWorld* World = GetWorld();
	const UWonderlandTravelSubsystem* Travel = World != nullptr ? World->GetSubsystem<UWonderlandTravelSubsystem>() : nullptr;
	if (PendingScenario == NAME_None || World == nullptr)
	{
		PendingTicker.Reset();
		return false;
	}
	if (Travel != nullptr && Travel->IsTravelling())
	{
		return true;
	}
	// A breath after the landing, so the world around the site has streamed in and the fade has cleared.
	if (PendingArrivedAt < 0.0)
	{
		PendingArrivedAt = World->GetTimeSeconds();
		return true;
	}
	if (World->GetTimeSeconds() - PendingArrivedAt < 1.0)
	{
		return true;
	}
	const FName Letter = PendingScenario;
	PendingScenario = NAME_None;
	PendingTicker.Reset();
	BeginMissionWithClearance(Letter, PendingPace);
	return false;
}

void UWonderlandMissionSubsystem::StartScenarioAndWatch(FName ScenarioLetter, float SecondsPerEvent)
{
	const bool bRunning = RunScenario(ScenarioLetter, SecondsPerEvent);
	UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION scenario %s at %.1f s per event -> %s"), *ScenarioLetter.ToString(),
		SecondsPerEvent, bRunning ? TEXT("running") : TEXT("did not start"));
	// ONE COMMAND TO WATCH IT: the terminal the mission narrates into opens with it.
	ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	UWonderlandUiSubsystem* Ui = Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	if (bRunning && Ui != nullptr && !Ui->IsLiveTerminalOpen())
	{
		Ui->ToggleLiveTerminal();
	}
}

FString UWonderlandMissionSubsystem::GetCompanionFlight(int32 Index) const
{
	const AWonderlandCompanionEmbodiment* Body = Companion(Index);
	return Body != nullptr ? Body->GetFormationName() : FString();
}

FName UWonderlandMissionSubsystem::GetCompanionFlightBeat(int32 Index) const
{
	const AWonderlandCompanionEmbodiment* Body = Companion(Index);
	return Body != nullptr ? Body->GetFlightBeat() : NAME_None;
}

bool UWonderlandMissionSubsystem::IsCompanionJoined(int32 Index) const
{
	const AWonderlandCompanionEmbodiment* Body = Companion(Index);
	return Body != nullptr && Body->IsJoined();
}

bool UWonderlandMissionSubsystem::IsCompanionBeamOn(int32 Index) const
{
	const AWonderlandCompanionEmbodiment* Body = Companion(Index);
	return Body != nullptr && Body->IsBeamOn();
}

int32 UWonderlandMissionSubsystem::GetCompanionPulsesInFlightFor(int32 Index) const
{
	const AWonderlandCompanionEmbodiment* Body = Companion(Index);
	return Body != nullptr ? Body->GetPulsesInFlight() : 0;
}

FVector UWonderlandMissionSubsystem::GetCompanionLocation(int32 Index) const
{
	const AWonderlandCompanionEmbodiment* Body = Companion(Index);
	return Body != nullptr ? Body->GetActorLocation() : FVector::ZeroVector;
}

void UWonderlandMissionSubsystem::TellTheTerminals(FName EventType, bool bBeatChanged, bool bNewMission)
{
	const ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	UWonderlandUiSubsystem* Ui = Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	if (Ui == nullptr)
	{
		return;
	}
	Ui->NarrateMissionEvent(EventType, Beat, FString::Printf(TEXT("%s %d/%d"), *GetChakraName(), GetChakraStep(), WonderlandChakraSteps),
		bBeatChanged, bNewMission, bLlmJoined, bJhinnJoined);
}

int32 UWonderlandMissionSubsystem::GetCompanionPulsesSent() const
{
	int32 Sent = 0;
	if (ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>())
	{
		if (UWonderlandCompanionSubsystem* Companions = Player->GetSubsystem<UWonderlandCompanionSubsystem>())
		{
			for (int32 Index = 0; Index < Companions->GetEmbodimentCount(); ++Index)
			{
				if (const AWonderlandCompanionEmbodiment* Body = Companions->GetEmbodiment(Index))
				{
					Sent += Body->GetPulsesSent();
				}
			}
		}
	}
	return Sent;
}

int32 UWonderlandMissionSubsystem::GetCompanionPulsesInFlight() const
{
	int32 Flying = 0;
	if (ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>())
	{
		if (UWonderlandCompanionSubsystem* Companions = Player->GetSubsystem<UWonderlandCompanionSubsystem>())
		{
			for (int32 Index = 0; Index < Companions->GetEmbodimentCount(); ++Index)
			{
				if (const AWonderlandCompanionEmbodiment* Body = Companions->GetEmbodiment(Index))
				{
					Flying += Body->GetPulsesInFlight();
				}
			}
		}
	}
	return Flying;
}

bool UWonderlandMissionSubsystem::IsContractAnchored() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return Body != nullptr && Body->IsAnchored();
}

FVector UWonderlandMissionSubsystem::GetContractAnchor() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return Body != nullptr && Body->IsAnchored() ? Body->GetAnchorPoint() : FVector::ZeroVector;
}

FString UWonderlandMissionSubsystem::GetDogPerformingLabel() const
{
	APlayerController* Controller = BoundController.Get();
	APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	const ARelayDogCharacter* Dog = Cast<ARelayDogCharacter>(Pawn);
	return Dog != nullptr ? WonderlandDogActName(Dog->PerformingAct()) : FString(TEXT("NO DOG"));
}

FString UWonderlandMissionSubsystem::GetDogActLabel() const
{
	return WonderlandDogActName(WonderlandDogActForBeat(Beat));
}

float UWonderlandMissionSubsystem::GetContractManifest() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return Body != nullptr ? Body->GetManifest() : 0.0f;
}

bool UWonderlandMissionSubsystem::IsOrbInWorld() const
{
	// A CONTRACT, NOT AN ACTOR. The crystal outlives the mission by the length of its fade, and during that
	// half second there is no contract -- which is the same line TellTheDog draws for the Dog.
	return Orb.IsValid() && WonderlandBeatShowsContract(Beat);
}

int32 UWonderlandMissionSubsystem::GetOrbBoxCount() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return Body != nullptr ? Body->GetBoxCount() : 0;
}

FVector UWonderlandMissionSubsystem::GetOrbLocation() const
{
	const AWonderlandMissionOrb* Body = Orb.Get();
	return Body != nullptr ? Body->GetActorLocation() : FVector::ZeroVector;
}

AWonderlandMissionOrb* UWonderlandMissionSubsystem::GetOrb() const
{
	return Orb.Get();
}

/* ------------------------------------------------------------------ the deterministic simulation */

bool UWonderlandMissionSubsystem::StartFixture(FName FixtureId, float SecondsPerEvent)
{
	const FWonderlandMissionFixture* Found = WonderlandMissionFixture(FixtureId);
	if (Found == nullptr)
	{
		return false;
	}
	StopFixture();
	Playing = Found;
	Fold = FWonderlandMissionFold();
	PlayIndex = 0;
	PlayClock = 0.0f;
	FinishHold = 0.0f;
	LastEventType = NAME_None;
	PresentedEventType = NAME_None;
	WithheldHandoffs = 0;
	PlaySecondsPerEvent = FMath::Clamp(SecondsPerEvent, 0.05f, 30.0f);

	// A TICKER RATHER THAN AN ACTOR. The simulation is not a thing in the world -- it is a stream being
	// read -- so it must keep running while the contract it drives is spawned, dismissed and spawned again.
	PlayTicker = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateUObject(this, &UWonderlandMissionSubsystem::StepFixture), 0.0f);

	UE_LOG(LogWonderlandMissionUi, Display,
		TEXT("WLMISSION SIMULATED JULIUS EXECUTION -- fixture '%s', %d events, %.2f s each. No provider is called."),
		*Playing->Id.ToString(), Playing->Events.Num(), PlaySecondsPerEvent);
	return true;
}

void UWonderlandMissionSubsystem::StopFixture()
{
	if (PlayTicker.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(PlayTicker);
		PlayTicker.Reset();
	}
	Playing = nullptr;
	PlayIndex = 0;
	PlayClock = 0.0f;
	FinishHold = 0.0f;
}

FName UWonderlandMissionSubsystem::GetFixtureId() const
{
	return Playing != nullptr ? Playing->Id : NAME_None;
}

int32 UWonderlandMissionSubsystem::GetFixtureEventCount() const
{
	return Playing != nullptr ? Playing->Events.Num() : 0;
}

FString UWonderlandMissionSubsystem::GetLastEventVerdict() const
{
	return WonderlandEventVerdictName(LastVerdict);
}

void UWonderlandMissionSubsystem::OfferEvent(const FWonderlandMissionEvent& Event)
{
	LastEventType = Event.Type;
	// A labelled stand-in names its beat; a real event is resolved from its type. Both go through the same
	// fold, so the counters mean the same thing either way.
	LastVerdict = Event.bSimulationOnly
		? WonderlandApplySimulatedEvent(Fold, Event)
		: WonderlandApplyEvent(Fold, Event);

	UE_LOG(LogWonderlandMissionUi, Verbose, TEXT("WLMISSION event %s -> %s | %s"),
		*Event.Type.ToString(), WonderlandEventVerdictName(LastVerdict), *WonderlandDescribeFold(Fold));

	// THE WORLD ONLY EVER SEES THE FOLD. It is never handed an event, and never decides what one means.
	if (LastVerdict == EWonderlandEventVerdict::Applied)
	{
		// HANDOFF DOES NOT EXIST FOR THE PLAYER (founder, 2026-09-16). The fold has recorded it -- the event is Julius's and
		// is not deleted -- but the world, the strip and the terminals go on presenting the stage in progress: no banner,
		// no pose, no camera beat, no terminal handoff, and nothing already performing is interrupted.
		if (Fold.Beat == EWonderlandMissionBeat::Handoff)
		{
			++WithheldHandoffs;
			UE_LOG(LogWonderlandMissionUi, Verbose, TEXT("WLMISSION %s withheld from the world (handoff %d)"),
				*Event.Type.ToString(), WithheldHandoffs);
			return;
		}
		PresentedEventType = Event.Type;
		const EWonderlandMissionBeat Before = Beat;
		const bool bWasRunning = WonderlandBeatShowsContract(Before);
		ShowBeat(Fold.Beat);
		// The terminals are told in the same breath as the world, from the beat the world now shows.
		TellTheTerminals(Event.Type, Before != Beat, !bWasRunning && WonderlandBeatShowsContract(Beat));
	}
}

bool UWonderlandMissionSubsystem::StepFixture(float DeltaSeconds)
{
	if (Playing == nullptr)
	{
		return false;
	}
	// THE STORY RUNS ON THE WORLD'S CLOCK. The ticker is real time, but the Dog, the Contract and the companions
	// animate on world time; under slow motion (a film, or a player pausing) an unscaled fixture would race ahead of
	// the performance it drives, and terminal and world would stop telling the same story.
	if (const APlayerController* Controller = BoundController.Get())
	{
		if (const UWorld* World = Controller->GetWorld())
		{
			const AWorldSettings* Settings = World->GetWorldSettings();
			DeltaSeconds *= World->IsPaused() ? 0.0f : (Settings != nullptr ? Settings->GetEffectiveTimeDilation() : 1.0f);
		}
	}
	PlayClock += DeltaSeconds;

	if (PlayIndex >= Playing->Events.Num())
	{
		// THE COMPLETION IS ALLOWED TO LAND before the contract goes. A crystal that vanished on the same
		// frame it reached violet would hide the one moment the whole progression was building toward.
		FinishHold += DeltaSeconds;
		if (FinishHold >= 3.0f)
		{
			UE_LOG(LogWonderlandMissionUi, Display, TEXT("WLMISSION fixture '%s' finished | %s"),
				*Playing->Id.ToString(), *WonderlandDescribeFold(Fold));
			// Back to rest, which dismisses the contract. This is one of the three beats Julius cannot
			// emit, and the world taking itself back to idle is exactly the gap that records.
			ShowBeat(EWonderlandMissionBeat::Idle);
			TellTheTerminals(NAME_None, true, false);
			StopFixture();
		}
		return true;
	}

	while (PlayIndex < Playing->Events.Num() && PlayClock >= PlaySecondsPerEvent)
	{
		PlayClock -= PlaySecondsPerEvent;
		OfferEvent(Playing->Events[PlayIndex]);
		++PlayIndex;
	}
	return true;
}

/* ------------------------------------------------------------------ the arithmetic proof */

int32 UWonderlandMissionSubsystem::GetFixtureCount() const
{
	return WonderlandMissionFixtureCount();
}

FName UWonderlandMissionSubsystem::GetFixtureIdAt(int32 Index) const
{
	return (Index >= 0 && Index < WonderlandMissionFixtureCount())
		? WonderlandMissionFixtureAt(Index).Id
		: NAME_None;
}

namespace
{
	/** Replay a fixture by id, or leave everything empty when nothing has that name. */
	bool MissionReplay(FName FixtureId, FWonderlandMissionFold& Fold,
		TArray<EWonderlandMissionBeat>* Beats, TArray<int32>* Steps, TArray<EWonderlandEventVerdict>* Verdicts)
	{
		const FWonderlandMissionFixture* Fixture = WonderlandMissionFixture(FixtureId);
		if (Fixture == nullptr)
		{
			return false;
		}
		WonderlandReplayFixture(*Fixture, Fold, Beats, Steps, Verdicts);
		return true;
	}
}

FString UWonderlandMissionSubsystem::ReplayChakraSteps(FName FixtureId) const
{
	FWonderlandMissionFold Replayed;
	TArray<int32> Steps;
	if (!MissionReplay(FixtureId, Replayed, nullptr, &Steps, nullptr))
	{
		return FString();
	}
	TArray<FString> Text;
	for (int32 Step : Steps)
	{
		Text.Add(FString::FromInt(Step));
	}
	return FString::Join(Text, TEXT(","));
}

FString UWonderlandMissionSubsystem::ReplayBeats(FName FixtureId) const
{
	FWonderlandMissionFold Replayed;
	TArray<EWonderlandMissionBeat> Beats;
	if (!MissionReplay(FixtureId, Replayed, &Beats, nullptr, nullptr))
	{
		return FString();
	}
	TArray<FString> Text;
	for (EWonderlandMissionBeat Each : Beats)
	{
		Text.Add(WonderlandBeatId(Each).ToString());
	}
	return FString::Join(Text, TEXT(","));
}

FString UWonderlandMissionSubsystem::ReplayVerdicts(FName FixtureId) const
{
	FWonderlandMissionFold Replayed;
	TArray<EWonderlandEventVerdict> Verdicts;
	if (!MissionReplay(FixtureId, Replayed, nullptr, nullptr, &Verdicts))
	{
		return FString();
	}
	TArray<FString> Text;
	for (EWonderlandEventVerdict Each : Verdicts)
	{
		Text.Add(WonderlandEventVerdictName(Each));
	}
	return FString::Join(Text, TEXT(","));
}

FString UWonderlandMissionSubsystem::ReplaySummary(FName FixtureId) const
{
	FWonderlandMissionFold Replayed;
	if (!MissionReplay(FixtureId, Replayed, nullptr, nullptr, nullptr))
	{
		return FString();
	}
	return WonderlandDescribeFold(Replayed);
}

// ---------------------------------------------------------------- what is actually being followed

const UWonderlandMissionTaskSubsystem* UWonderlandMissionSubsystem::TaskSet() const
{
	// ULocalPlayerSubsystem knows its own player, so this needs no controller and works while the HUD draws.
	const ULocalPlayer* Player = GetLocalPlayer<ULocalPlayer>();
	return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
}

bool UWonderlandMissionSubsystem::IsDevelopmentPreview() const
{
	// A FIXTURE IS ALWAYS A PREVIEW, even if a real run is followed beside it: while this class is generating
	// beats itself, what the surfaces are drawing is a simulation and must say so.
	if (IsFixtureRunning())
	{
		return true;
	}
	const UWonderlandMissionTaskSubsystem* Tasks = TaskSet();
	return Tasks == nullptr || !Tasks->IsFollowingJuliusRun();
}

FString UWonderlandMissionSubsystem::GetFollowedRunId() const
{
	const UWonderlandMissionTaskSubsystem* Tasks = TaskSet();
	return Tasks != nullptr ? Tasks->GetFollowedRunId() : FString();
}

FString UWonderlandMissionSubsystem::GetFollowedJuliusState() const
{
	const UWonderlandMissionTaskSubsystem* Tasks = TaskSet();
	return Tasks != nullptr ? Tasks->GetFollowedJuliusState() : FString();
}

FString UWonderlandMissionSubsystem::GetProvenanceBanner() const
{
	if (IsDevelopmentPreview())
	{
		return TEXT("DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION");
	}
	// A REAL RUN, NAMED. The run id is what the founder's acceptance says the contract must follow, so it is on
	// screen rather than inferred from the mission id. Julius's own word for the state travels with it, and
	// when Julius has not said anything yet the banner says that instead of borrowing the mapped enum's name.
	const FString Run = GetFollowedRunId();
	const FString Said = GetFollowedJuliusState();
	return FString::Printf(TEXT("JULIUS LIVE · RUN %s · %s"),
		Run.IsEmpty() ? TEXT("unnamed") : *Run,
		Said.IsEmpty() ? TEXT("NO STATE REPORTED YET") : *Said.ToUpper());
}

FName UWonderlandMissionSubsystem::GetFoldMissionId() const
{
	if (!Fold.MissionId.IsNone())
	{
		return Fold.MissionId;
	}
	const UWonderlandMissionTaskSubsystem* Tasks = TaskSet();
	if (Tasks != nullptr && !IsFixtureRunning())
	{
		const FString Followed = Tasks->GetFollowedMissionId();
		if (!Followed.IsEmpty())
		{
			return FName(*Followed);
		}
	}
	return Fold.MissionId;
}

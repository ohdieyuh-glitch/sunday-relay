#include "WonderlandMissionSubsystem.h"

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
#include "WonderlandCompanionSubsystem.h"
#include "WonderlandDogPerformance.h"
#include "WonderlandMissionFixture.h"
#include "WonderlandMissionOrb.h"
#include "WonderlandPixelText.h"
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

	FAutoConsoleCommand CmdMissionStop(
		TEXT("wl.Mission.Stop"),
		TEXT("Stop the running fixture and let the Mission Contract go."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			ForEachMission([](UWonderlandMissionSubsystem& Mission) { Mission.StopFixture(); });
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
		Orb.Reset();
	}
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
					return FText::FromString(FString::Printf(
						TEXT("DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION   |   MISSION %s · EVENT %s (%s) · STATE %s · %s %d/%d · DOG %s%s   |   %s"),
						MissionId.IsNone() ? TEXT("none") : *MissionId.ToString(),
						Mission->GetLastEventType().IsNone() ? TEXT("-") : *Mission->GetLastEventType().ToString(),
						*Mission->GetLastEventVerdict(),
						*Mission->GetBeatPhase(Mission->GetBeatId()),
						*Mission->GetChakraName(), Mission->GetChakraStep(), WonderlandChakraSteps,
						*Mission->GetDogActLabel(), Mission->IsContractAnchored() ? TEXT(" · ANCHORED") : TEXT(""),
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
	// Above the usage HUD, below the companion consoles (20) and every panel.
	LocalPlayer->ViewportClient->AddViewportWidgetForPlayer(LocalPlayer, MissionStrip.ToSharedRef(), 18);
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
	return Orb.IsValid();
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
		ShowBeat(Fold.Beat);
	}
}

bool UWonderlandMissionSubsystem::StepFixture(float DeltaSeconds)
{
	if (Playing == nullptr)
	{
		return false;
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

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
	UWorld* World = Controller->GetWorld();
	if (World == nullptr)
	{
		return;
	}
	const APawn* Pawn = Controller->GetPawn();
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;
	AWonderlandMissionOrb* Spawned = World->SpawnActor<AWonderlandMissionOrb>(
		AWonderlandMissionOrb::StaticClass(), Pawn != nullptr ? Pawn->GetActorTransform() : FTransform::Identity, Params);
	if (Spawned == nullptr)
	{
		UE_LOG(LogWonderlandMissionUi, Error, TEXT("WLMISSION could not spawn the Mission Contract Orb"));
		return;
	}
#if WITH_EDITOR
	Spawned->SetActorLabel(TEXT("WL_MissionContractOrb"), false);
#endif
	Spawned->SetFollowController(Controller);
	Spawned->SetBeat(Beat);
	Spawned->SnapToTarget();
	Orb = Spawned;
	MountStrip();
	UE_LOG(LogWonderlandMissionUi, Log, TEXT("WLMISSION orb at the Dog's feet, strip %s, beat %s (DEVELOPMENT PREVIEW)"),
		MissionStrip.IsValid() ? TEXT("on screen") : TEXT("FAILED"), *WonderlandBeatId(Beat).ToString());
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
					const FString Chakra = WeakThis.IsValid() ? WeakThis->GetChakraName() : FString(TEXT("NONE"));
					const int32 Step = WeakThis.IsValid() ? WeakThis->GetChakraStep() : 0;
					return FText::FromString(FString::Printf(
						TEXT("DEVELOPMENT PREVIEW  ·  SIMULATED BEAT, NOT JULIUS EXECUTION  ·  %s %d/%d"),
						*Chakra, Step, WonderlandChakraSteps));
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
	Beat = Wanted;
	if (AWonderlandMissionOrb* Body = Orb.Get())
	{
		Body->SetBeat(Beat);
	}
	return true;
}

FName UWonderlandMissionSubsystem::AdvanceBeat()
{
	const int32 Next = (static_cast<int32>(Beat) + 1) % WonderlandMissionBeatCount;
	Beat = static_cast<EWonderlandMissionBeat>(Next);
	if (AWonderlandMissionOrb* Body = Orb.Get())
	{
		Body->SetBeat(Beat);
	}
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

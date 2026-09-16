// WONDERLAND — WHO HOLDS THE MISSION BEAT. One owner per player, beside the companions.
//
// It keeps the beat, puts a small strip on screen naming it, and MANIFESTS A MISSION CONTRACT when — and
// only when — a beat arrives that describes a task actually being executed. A player standing in Wonderland
// has no contract; a player whose task is running has one floating beside them.
//
// IT IS NOT THE SOURCE OF MISSION TRUTH, and the founder's Phase 4 note says so in as many words: Unreal
// must never become the thing that decides what a mission is doing. Every beat here arrives from outside —
// today a console command or a test, in Phase 3B a deterministic fixture, in Phase 4 a Julius event — and
// this subsystem holds the latest one and draws it. There is no member below that could advance a mission,
// approve anything, or authorise a spend.
//
// AND IT SAYS WHAT IT IS. IsDevelopmentPreview() is true for everything this class can currently produce,
// and the strip carries DEVELOPMENT PREVIEW on screen, because a simulated beat that looked like a real one
// is exactly the confusion the founder forbade.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/LocalPlayerSubsystem.h"
#include "Containers/Ticker.h"
#include "WonderlandMissionBeat.h"
#include "WonderlandMissionEvent.h"
#include "WonderlandMissionSubsystem.generated.h"

class APlayerController;
class AWonderlandMissionOrb;
class SWidget;

UCLASS()
class WONDERLAND_API UWonderlandMissionSubsystem : public ULocalPlayerSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Show a beat by its id, e.g. "repair_required". False when no beat has that name. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	bool SetBeatById(FName BeatId);

	/** Step to the next beat in the founder's order, wrapping. Returns the beat now showing. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	FName AdvanceBeat();

	/** Put the progression back to nothing without changing the beat, as a new task does. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void ResetProgression();

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetBeatId() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetBeatLabel() const;

	/** 0 before a task has started, else 1..7. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetChakraStep() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetChakraName() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetBeatCount() const { return WonderlandMissionBeatCount; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetBeatIdAt(int32 Index) const;

	/**
	 * THE PHASE 4 BINDING, READABLE FROM A TEST. Which runtime phase a beat resolves to, e.g. "Coding" --
	 * a member of EWonderlandJuliusState, which is mirrored to TypeScript and guarded by the parity test.
	 * A beat that resolved to nothing would be a visual with no future, and this is how that gets caught.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetBeatPhase(FName BeatId) const;

	/** The runtime's second axis for a beat, e.g. "AwaitingInput". "Unobserved" means the phase carries it alone. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetBeatAccent(FName BeatId) const;

	/** The Julius events that will resolve to a beat in Phase 4, comma separated. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetBeatEvents(FName BeatId) const;

	/**
	 * What Julius would have to emit for a beat nothing currently reaches. Empty when a real event does.
	 * Two of the seventeen are in this state; the sentence says which moment is missing and why the
	 * nearest existing event was NOT used for it.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetBeatNotYetEmitted(FName BeatId) const;

	/** The pure fold: what step a beat leaves the progression on, given the step before it. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetBeatChakraStep(FName BeatId, int32 PreviousStep) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool DoesBeatAskForAHuman(FName BeatId) const;

	/** True for every beat this build can currently produce. Nothing here is real Julius execution. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsDevelopmentPreview() const { return true; }

	/* ------------------------------------------------------------ the deterministic simulation */

	/**
	 * Play a fixture, one event at a time, into the same door a Julius event will use in Phase 4.
	 *
	 * NOTHING IS TYPED BY HAND while this runs. The founder's Phase 3B rule is that the orb stops being
	 * manually controlled state: a fixture produces events, the fold interprets them, and the world draws
	 * whatever comes out. False when no fixture has that id.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	bool StartFixture(FName FixtureId, float SecondsPerEvent = 1.6f);

	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void StopFixture();

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsFixtureRunning() const { return Playing != nullptr; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetFixtureId() const;

	/** How many of the fixture's events have been offered so far. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetFixtureProgress() const { return PlayIndex; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetFixtureEventCount() const;

	/** The last event type offered, exactly as the stream spelled it. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetLastEventType() const { return LastEventType; }

	/** What the fold did with it: applied, stale, foreign, refused after ending, refused unlabelled gap. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetLastEventVerdict() const;

	/** The mission the contract currently belongs to. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetFoldMissionId() const { return Fold.MissionId; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetFoldChakraStep() const { return WonderlandChakraStep(Fold.Chakra); }

	/** Beats shown that no Julius event can produce. A non-zero count is how far this runs ahead of the kernel. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetFoldSimulatedBeats() const { return Fold.SimulatedBeats; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetFoldRefusedAfterEnding() const { return Fold.RefusedAfterEnding; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetFoldForeign() const { return Fold.Foreign; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString DescribeFold() const { return WonderlandDescribeFold(Fold); }

	/* ------------------------------------------------------------ the arithmetic proof */
	//
	// REPLAY WITHOUT DRAWING. The beat sequence, the chakra sequence and the verdicts are properties of the
	// event stream and the tables -- so they can be checked with no actor, no PIE camera and no frame. A
	// renderer bug cannot make these pass, and a table mistake cannot hide behind one.

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetFixtureCount() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetFixtureIdAt(int32 Index) const;

	/** The chakra step after each event, comma separated, e.g. "1,1,2,2,2,3". */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString ReplayChakraSteps(FName FixtureId) const;

	/** The beat after each event, comma separated. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString ReplayBeats(FName FixtureId) const;

	/** What the fold did with each event, comma separated. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString ReplayVerdicts(FName FixtureId) const;

	/** The finished fold, as one line. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString ReplaySummary(FName FixtureId) const;

	/** Grow or shrink the orb. For the placement probe; the built-in size is what ships. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	bool SetOrbScale(float Scale);

	/** Move the orb in the pawn's yaw frame, uu forward and right. For the placement probe. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	bool SetOrbFollowOffset(float Forward, float Right);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	float GetOrbHeightUU() const;

	/** True while a Mission Contract is manifested. False whenever no task is being executed. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsOrbInWorld() const;

	/** How many contracts this session has manifested. A second mission increments it. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetContractsManifested() const { return ContractsManifested; }

	/** 0 while nothing is executing, rising to 1 as a contract draws itself in. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	float GetContractManifest() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetOrbBoxCount() const;

	/** Where the orb is standing, world space. Zero when there is no orb. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FVector GetOrbLocation() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsMissionStripOnScreen() const { return MissionStrip.IsValid(); }

	/** True once the contract has stopped following and become a place the Dog performs around. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsContractAnchored() const;

	/** Where the contract is holding, world space. Zero when nothing is anchored. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FVector GetContractAnchor() const;

	/** What the Relay Dog should be performing for the current beat, e.g. "PLANNING". */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetDogActLabel() const;

	AWonderlandMissionOrb* GetOrb() const;

private:
	void HandlePlayerControllerChanged(APlayerController* NewController);
	void Attach(APlayerController* Controller);
	void Detach();
	void MountStrip();
	/** Beat in, world out. The one place that decides whether a crystal exists. */
	void ShowBeat(EWonderlandMissionBeat Wanted);
	AWonderlandMissionOrb* EnsureContract();
	void DismissContract();
	bool StepFixture(float DeltaSeconds);
	void OfferEvent(const FWonderlandMissionEvent& Event);

	TWeakObjectPtr<APlayerController> BoundController;
	TWeakObjectPtr<AWonderlandMissionOrb> Orb;
	TSharedPtr<SWidget> MissionStrip;
	EWonderlandMissionBeat Beat = EWonderlandMissionBeat::Unobserved;
	int32 ContractsManifested = 0;

	/** The fixture being played, owned by WonderlandMissionFixture.cpp's static table and never by this. */
	const struct FWonderlandMissionFixture* Playing = nullptr;
	FWonderlandMissionFold Fold;
	FName LastEventType;
	EWonderlandEventVerdict LastVerdict = EWonderlandEventVerdict::Applied;
	int32 PlayIndex = 0;
	float PlayClock = 0.0f;
	float PlaySecondsPerEvent = 1.6f;
	/** After the last event, hold the finished contract on screen before letting it go. */
	float FinishHold = 0.0f;
	FTSTicker::FDelegateHandle PlayTicker;
	FDelegateHandle ControllerChangedHandle;
};

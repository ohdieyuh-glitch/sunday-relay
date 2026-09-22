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
#include "WonderlandClearanceBubble.h"
#include "WonderlandMissionTasks.h"
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

	/**
	 * The last event the PLAYER was shown: the world, the strip and the terminals all present this one. It differs from
	 * GetLastEventType only while a handoff has arrived, which the world withholds (founder, 2026-09-16).
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetPresentedEventType() const { return PresentedEventType; }

	/** How many handoffs this mission's fold recorded and the world did not stage. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetWithheldHandoffs() const { return WithheldHandoffs; }

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

	/** The strip's own box in absolute (desktop) pixels from its last layout, for the HUD's overlap checks. */
	bool GetMissionStripAbsoluteRect(FSlateRect& OutRect) const;

	/** True once the contract has stopped following and become a place the Dog performs around. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsContractAnchored() const;

	/** Where the contract is holding, world space. Zero when nothing is anchored. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FVector GetContractAnchor() const;

	/** What the Relay Dog should be performing for the current beat, e.g. "PLANNING". */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetDogActLabel() const;

	/** Where the companions are standing for the current beat, e.g. "RESEARCH ORBIT". */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetCompanionFormation() const;

	/* ------------------------------------------------------------ /join in, simulated (founder, 2026-09-16) */

	/**
	 * WHO HAS JOINED THE MISSION CONTRACT. A joined companion is an active participant: it flies about the Contract
	 * and contributes to it while the Relay Dog performs, and its terminal narrates its part. SIMULATED -- nothing is
	 * imported and /join in is not wired to anything; this is the participation the world will draw when it is.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void SetJoinedIn(bool bLlmCompanion, bool bJhinnAgent);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsLlmCompanionJoined() const { return bLlmJoined; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsJhinnJoined() const { return bJhinnJoined; }

	/**
	 * The founder's four participation scenarios, each a full deterministic lifecycle: A Julius only, B with the LLM
	 * Companion joined, C with the Jhinn joined, D with both. False for an unknown letter.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	bool RunScenario(FName ScenarioLetter, float SecondsPerEvent = 3.0f);

	/**
	 * THE FOUNDER'S PLAY COMMAND (wl.Mission.Scenario): take the Dog to the simulation site (wl.Mission.Site, a travel
	 * destination; "none" plays where the Dog stands), then run the scenario and open the Julius Live Terminal to watch
	 * it. False only for a letter that is not A, B, C or D. The travel is the map's own, with its fade and its landing.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	bool PlayScenario(FName ScenarioLetter, float SecondsPerEvent = 10.0f);

	/* ------------------------------------------------- the pre-mission clearance bubble */

	/**
	 * PROBE THE ROOM, THEN PLAY. The founder's sequence: a 1-2 second bubble, an evaluation of the staging envelope,
	 * a safe position, and only then the cutscene.
	 *
	 * IT NEVER REFUSES. Cramped surroundings change how a mission is presented and never whether it runs.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	bool BeginMissionWithClearance(FName ScenarioLetter, float SecondsPerEvent = 10.0f);

	/** Run the probe alone and keep the answer, without starting anything. For a proof, and for `wl.Mission.Clearance`. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	FWonderlandStagingResult ProbeClearanceNow();

	/** True while the bubble is up. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsClearanceProbing() const { return ClearanceUntil > 0.0; }

	/** What the last probe decided, and why. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	const FWonderlandStagingResult& GetLastStaging() const { return LastStaging; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetLastStagingFitName() const { return WonderlandStagingFitName(LastStaging.Fit); }

	/* ------------------------------------------------- the Mission Contract stack */

	/**
	 * BRING THE ORBS INTO LINE WITH THE TASKS: one orb per task, stacked in the task list's order, gray where the
	 * slot is empty and coloured where a contract exists.
	 *
	 * Called whenever the task set changes. Idempotent, so calling it twice costs nothing and leaves the same stack.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Mission")
	void SyncTaskOrbs();

	/** How many orbs are standing in the stack right now. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetStackedOrbCount() const { return TaskOrbs.Num(); }

	/**
	 * HOW TALL THE WHOLE PRESENTATION STANDS, in uu, with this many orbs in the stack. The clearance probe asks for
	 * this rather than assuming one orb: a second Contract above the first raises the envelope, and a staging that
	 * fit one would put the next one through a ceiling.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	float GetStackHeightUu() const;

	/** The gray/red state of each orb, bottom to top, for a proof and for `wl.Tasks.Status`. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	TArray<FString> DescribeOrbStack() const;

	/** A scenario is waiting for the travel to the simulation site to finish. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsScenarioWaitingForSite() const { return PendingScenario != NAME_None; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetScenario() const { return Scenario; }

	/** Companion 0 is the LLM Companion, 1 the Jhinn. Its flight, e.g. "SUPPORT ORBIT". */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetCompanionFlight(int32 Index) const;

	/** The beat that companion's flight was chosen for. Must equal the beat its terminal last narrated. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FName GetCompanionFlightBeat(int32 Index) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsCompanionJoined(int32 Index) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsCompanionBeamOn(int32 Index) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetCompanionPulsesInFlightFor(int32 Index) const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FVector GetCompanionLocation(int32 Index) const;

	/** Support pulses sent into the Contract by all companions during study. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetCompanionPulsesSent() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetCompanionPulsesInFlight() const;

	/**
	 * What the body is ACTUALLY performing, which during a handoff is the inherited act rather than None.
	 * Reported through this subsystem so the Dog's own header needs no Blueprint plumbing added to it.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FString GetDogPerformingLabel() const;

	AWonderlandMissionOrb* GetOrb() const;

private:
	void HandlePlayerControllerChanged(APlayerController* NewController);
	void Attach(APlayerController* Controller);
	void Detach();
	void MountStrip();
	/** Beat in, world out. The one place that decides whether a crystal exists. */
	void ShowBeat(EWonderlandMissionBeat Wanted);
	/** Hand the Relay Dog the act for the current beat, and the contract to perform it around. */
	void TellTheDog();
	/** Put the companions where this stage needs them, and take them back afterwards. */
	void TellTheCompanions();
	/** Narrate one applied event on the Julius terminal and, for joined companions, on theirs. */
	void TellTheTerminals(FName EventType, bool bBeatChanged, bool bNewMission);
	class AWonderlandCompanionEmbodiment* Companion(int32 Index) const;
	AWonderlandMissionOrb* EnsureContract();
	void DismissContract();
	bool StepFixture(float DeltaSeconds);
	void OfferEvent(const FWonderlandMissionEvent& Event);

	TWeakObjectPtr<APlayerController> BoundController;
	TWeakObjectPtr<AWonderlandMissionOrb> Orb;
	TSharedPtr<SWidget> MissionStrip;
	/** The bar inside the strip's full-viewport canvas: the part that actually takes space. */
	TSharedPtr<SWidget> MissionStripBar;
	EWonderlandMissionBeat Beat = EWonderlandMissionBeat::Unobserved;
	int32 ContractsManifested = 0;

	/** The fixture being played, owned by WonderlandMissionFixture.cpp's static table and never by this. */
	const struct FWonderlandMissionFixture* Playing = nullptr;
	FWonderlandMissionFold Fold;
	FName LastEventType;
	FName PresentedEventType;
	int32 WithheldHandoffs = 0;
	EWonderlandEventVerdict LastVerdict = EWonderlandEventVerdict::Applied;
	int32 PlayIndex = 0;
	float PlayClock = 0.0f;
	float PlaySecondsPerEvent = 1.6f;
	/** After the last event, hold the finished contract on screen before letting it go. */
	float FinishHold = 0.0f;
	FTSTicker::FDelegateHandle PlayTicker;
	/** One orb per task, keyed by the task's local id. Weak: the world may take an actor away at any time. */
	TMap<FGuid, TWeakObjectPtr<class AWonderlandMissionOrb>> TaskOrbs;
	/** Bound once, so the stack follows the task set without anybody having to remember to call Sync. */
	bool bBoundToTasks = false;

	/** The clearance bubble: what it decided, when it must lift, and what is waiting behind it. */
	FWonderlandStagingResult LastStaging;
	double ClearanceUntil = 0.0;
	double ClearanceStartedAt = 0.0;
	FName ClearanceScenario;
	float ClearancePace = 10.0f;
	FTSTicker::FDelegateHandle ClearanceTicker;
	bool StepClearance(float DeltaSeconds);
	void ApplyStaging(const FWonderlandStagingResult& Staging);

	/** A scenario waiting on the travel to the simulation site, its pace, and the world time the travel ended. */
	FName PendingScenario;
	float PendingPace = 10.0f;
	double PendingArrivedAt = -1.0;
	FTSTicker::FDelegateHandle PendingTicker;
	bool StepPendingScenario(float DeltaSeconds);
	void StartScenarioAndWatch(FName ScenarioLetter, float SecondsPerEvent);
	FDelegateHandle ControllerChangedHandle;
	bool bLlmJoined = false;
	bool bJhinnJoined = false;
	FName Scenario;
};

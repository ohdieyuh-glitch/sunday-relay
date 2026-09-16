// WONDERLAND — WHO HOLDS THE MISSION BEAT. One owner per player, beside the companions.
//
// It spawns the Mission Contract Orb at the Dog's feet, keeps the beat the orb is drawing, and puts a small
// strip on screen naming it — because seventeen states are only legible in a screenshot if the screenshot
// says which one it is.
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
#include "WonderlandMissionBeat.h"
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

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsOrbInWorld() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	int32 GetOrbBoxCount() const;

	/** Where the orb is standing, world space. Zero when there is no orb. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	FVector GetOrbLocation() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Mission")
	bool IsMissionStripOnScreen() const { return MissionStrip.IsValid(); }

	AWonderlandMissionOrb* GetOrb() const;

private:
	void HandlePlayerControllerChanged(APlayerController* NewController);
	void Attach(APlayerController* Controller);
	void Detach();
	void MountStrip();

	TWeakObjectPtr<APlayerController> BoundController;
	TWeakObjectPtr<AWonderlandMissionOrb> Orb;
	TSharedPtr<SWidget> MissionStrip;
	EWonderlandMissionBeat Beat = EWonderlandMissionBeat::Unobserved;
	FDelegateHandle ControllerChangedHandle;
};

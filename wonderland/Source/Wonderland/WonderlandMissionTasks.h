// WONDERLAND — MULTIPLE MISSION CONTRACTS, ONE JULIUS.
//
// FOUNDER DIRECTIVE (2026-09-22): "Add a Wonderland-native way for a user to add another Julius task while another
// task is already present or being worked on. The founder analogy is: CLAUDE CODE TABS -> but translated into
// WONDERLAND as MISSION CONTRACT ORBS. This is NOT a conventional tab bar."
//
// WHAT THIS CREATES, AND WHAT IT DOES NOT. It creates additional Mission Contracts. It does NOT create another
// Julius, another Relay Dog, another Compound AI Agent, /MAS, or ordinary sub-agents. One Julius owns many
// contracts, exactly as one person owns many appointments.
//
// THE TWO COLOURS ARE THE WHOLE VOCABULARY:
//   GRAY = an empty draft slot. No task has been entered. It is local to this session and exists nowhere else.
//   RED  = a real Mission Contract. A task was entered and accepted.
// Gray does not mean failure and red does not mean error. Whatever else is layered on later, those two survive.
//
// EACH ORB IS ITS OWN CONTRACT, which is the point the founder underlined: "Do NOT merge the prompts together ...
// Not: three visual orbs pointing at one mixed prompt." So every task here carries its own identity, objective,
// state, lifecycle, evidence and accounting, and selecting one switches what the world is showing rather than
// merging anything.
//
// AND IT DOES NOT FAKE CONCURRENCY. "Wonderland does not get to pretend three missions are running when Julius is
// actually executing only one." Wonderland has no Julius link in this build, so a submitted contract is QUEUED and
// says where that answer came from. When a real scheduler exists, `ApplySchedulerState` is where its truth lands,
// and nothing in the presentation has to change to believe it.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/LocalPlayerSubsystem.h"
#include "WonderlandMissionTasks.generated.h"

/**
 * WHERE A TASK IS IN ITS LIFE. The founder's own list, unchanged.
 *
 * DRAFT is the only state a task can be created in, and the only one that is not a Mission Contract.
 */
UENUM(BlueprintType)
enum class EWonderlandTaskState : uint8
{
	/** An empty slot. Gray. Local to this session, known to no backend, and recorded in no history. */
	Draft,
	/** A real contract, waiting for Julius to reach it. Red. */
	Queued,
	Preparation,
	Research,
	Implementation,
	Verification,
	Review,
	Repair,
	Completed,
	Failed,
	Paused
};

WONDERLAND_API const TCHAR* WonderlandTaskStateName(EWonderlandTaskState State);

/** True for every state that means a real Mission Contract exists -- that is, everything but DRAFT. */
WONDERLAND_API bool WonderlandTaskIsContract(EWonderlandTaskState State);

/**
 * WHO SAID SO. A state with no provenance is a state nobody can check, and this feature's whole risk is a
 * presentation that claims more than the backend does.
 */
UENUM(BlueprintType)
enum class EWonderlandTaskSource : uint8
{
	/** Held in this session only. Every DRAFT is this, and so is a submitted contract that has not reached Julius. */
	Local,
	/** Julius reported this state. The only thing that may drive a running mission. */
	Julius
};

/**
 * ONE TASK, AND EVERYTHING THAT IS ITS OWN.
 *
 * The founder listed what must be isolated per task and each line below is one of them. Nothing here is shared
 * between tasks by reference, so two contracts cannot come to hold one objective by accident.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandMissionTask
{
	GENERATED_BODY()

	/** This session's handle on the task. Stable across a reorder; meaningless outside this machine. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FGuid LocalId;

	/**
	 * THE BACKEND'S OWN IDENTITY FOR THE CONTRACT, and empty until a backend has given one.
	 *
	 * This is what must survive a restart, and it is deliberately NOT the local id: a mission's identity belongs to
	 * whoever is running it. An empty ContractId on a red orb means "accepted here, not yet acknowledged there",
	 * which is a true and visible state rather than a hidden one.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FString ContractId;

	/** What the user asked for. One task's words, never joined with another's. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FString Objective;

	/** What this contract must satisfy to be complete. Empty until a backend states it; never invented here. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	TArray<FString> AcceptanceCriteria;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	EWonderlandTaskState State = EWonderlandTaskState::Draft;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	EWonderlandTaskSource Source = EWonderlandTaskSource::Local;

	/** Every state this task has been in, in order, so a lifecycle can be read rather than guessed. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	TArray<FString> Lifecycle;

	/** What this task produced. Counted per task, because evidence belongs to the contract that earned it. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	int32 EvidenceCount = 0;

	/**
	 * TOKENS THIS TASK HAS SPENT, or -1 for "nobody has told us".
	 *
	 * NEGATIVE IS NOT ZERO. Zero is a measurement and would be a lie here: no provider telemetry reaches this build,
	 * so a surface must be able to show "unknown" rather than an invented zero next to a running contract.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	int64 TokensUsed = -1;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FDateTime CreatedAt;

	/** Why this task failed, when it did. Empty otherwise. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FString Failure;
};

DECLARE_MULTICAST_DELEGATE(FOnWonderlandTasksChanged);

/**
 * THE TASK SET.
 *
 * A LocalPlayer subsystem, beside the mission subsystem it feeds: which contracts this player has open is a
 * property of the player, not of the level or of the whole game instance.
 */
UCLASS()
class WONDERLAND_API UWonderlandMissionTaskSubsystem : public ULocalPlayerSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	/* -------------------------------------------------------------- the + */

	/**
	 * A NEW EMPTY SLOT, which is what pressing + does and the whole of what it does.
	 *
	 * It creates NO mission, touches no backend, and writes nothing to Project Brain -- the founder was explicit
	 * that an abandoned empty slot must leave no history. Returns an invalid id when the set is full.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	FGuid AddDraft();

	/**
	 * ENTER A TASK INTO A DRAFT SLOT, turning it into a real Mission Contract: gray becomes red.
	 *
	 * Refuses a blank objective, because an empty string is not a task and a red orb standing for nothing is the one
	 * outcome this whole colour rule exists to prevent. Refuses a slot that is already a contract.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool SubmitDraft(FGuid LocalId, const FString& Objective);

	/** Throw away an unused slot. Refuses once it is a contract: a real mission is not dismissed by tidying. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool DismissDraft(FGuid LocalId);

	/* --------------------------------------------------------- the task set */

	const TArray<FWonderlandMissionTask>& GetTasks() const { return Tasks; }

	/**
	 * THE SAME LIST, BY VALUE, so a proof can read it. The reference above is what C++ callers want and is not
	 * reflected; a UFUNCTION cannot return a reference to an array, so this copies rather than leaving Python with
	 * no way to see the set it is supposed to be checking.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	TArray<FWonderlandMissionTask> GetTaskList() const { return Tasks; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	int32 NumTasks() const { return Tasks.Num(); }

	/** How many may exist at once. Configurable, and not a tier: no account economy is invented here. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	int32 GetTaskCapacity() const;

	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	bool CanAddTask() const { return Tasks.Num() < GetTaskCapacity(); }

	const FWonderlandMissionTask* Find(FGuid LocalId) const;

	/** Which task the world is currently showing. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	FGuid GetSelected() const { return Selected; }

	/**
	 * SHOW A DIFFERENT TASK. Changes what is displayed and NOTHING about what any task is doing -- the others carry
	 * on according to whatever Julius says, because selection is a view and not a command.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool SelectTask(FGuid LocalId);

	/** The selected task, or null when there is none. */
	const FWonderlandMissionTask* GetSelectedTask() const { return Find(Selected); }

	/* ------------------------------------------------------- backend truth */

	/**
	 * WHAT JULIUS SAYS ABOUT A CONTRACT. The only way a task reaches a running state.
	 *
	 * Matched on the BACKEND's id rather than the local one, because after a restart the local ids are new and the
	 * contract ids are not -- which is exactly the case the founder's persistence rule is about.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool ApplySchedulerState(const FString& ContractId, EWonderlandTaskState State, int64 TokensUsed, int32 EvidenceCount);

	/** Give a locally-accepted contract the identity the backend assigned it. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool AdoptContractId(FGuid LocalId, const FString& ContractId);

	/**
	 * HOW MANY CONTRACTS JULIUS IS ACTUALLY EXECUTING AT ONCE, as far as this build has been told.
	 *
	 * Zero until something says otherwise, and a surface showing several red orbs must show this rather than imply
	 * that all of them are running.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	int32 GetRunningCount() const;

	/** Everything spent across every task, or -1 when nothing has reported. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	int64 GetTotalTokens() const;

	/** The set as lines, for `wl.Tasks.Status` and for a proof. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	TArray<FString> DescribeTasks() const;

	FOnWonderlandTasksChanged OnTasksChanged;

private:
	void Touch(FWonderlandMissionTask& Task, EWonderlandTaskState To, EWonderlandTaskSource From);
	FWonderlandMissionTask* FindMutable(FGuid LocalId);

	/**
	 * IN STACK ORDER, OLDEST FIRST. Index 0 is the bottom of the stack -- the orb that was already there -- and a new
	 * one goes on the end, which is the top. The founder asked for a new orb ABOVE the current one, so the array's
	 * order IS the vertical order and nothing has to reconcile two.
	 */
	TArray<FWonderlandMissionTask> Tasks;
	FGuid Selected;
};

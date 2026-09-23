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
#include "GameFramework/SaveGame.h"
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
	 * WHICH ARTEFACTS, by the backend's own reference, and empty until a backend names them.
	 *
	 * A COUNT IS NOT A REFERENCE. "3 pieces of evidence" survives a restart as a number nobody can open; the
	 * founder's persistence list asks for evidence REFERENCES, and RelayWorldState already carries EvidenceIds
	 * for exactly this, so a task carries the same kind of thing rather than a second, different idea of evidence.
	 *
	 * NEVER INVENTED HERE, the same rule AcceptanceCriteria keeps. A scheduler may legitimately report a count
	 * before it can report the list -- it knows how many it made, and has not sent them -- so these two are
	 * reported separately and an empty list beside a non-zero count is a true state, not a missing one.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	TArray<FString> EvidenceIds;

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

/**
 * THE MISSION CONTRACTS ON DISK.
 *
 * Contracts only -- never a draft. And nothing secret: an objective is the user's own sentence, the same words
 * they typed into the world, so this file holds no key, no token and no credential of any kind. If a backend
 * identity ever needs a secret beside it, that secret belongs behind a credential reference and not in here.
 */
UCLASS()
class WONDERLAND_API UWonderlandMissionTaskSave : public USaveGame
{
	GENERATED_BODY()

public:
	/** Which shape this file is, so an older one can be refused rather than misread. */
	UPROPERTY()
	int32 Version = 1;

	UPROPERTY()
	TArray<FWonderlandMissionTask> Contracts;

	/**
	 * WHICH CONTRACT WAS BEING LOOKED AT, by POSITION rather than by id.
	 *
	 * The local ids are deliberately not the ones that come back -- see RestoreContracts -- so an id saved here
	 * would point at nothing. The stack's order is what the user actually remembers.
	 */
	UPROPERTY()
	int32 SelectedIndex = INDEX_NONE;
};

/*
 * ==========================================================================================================
 * MULTIPLAYER AUTHORITY: WHAT IS MISSING, NAMED RATHER THAN GUESSED AT.
 * ==========================================================================================================
 *
 * THIS FEATURE IS SINGLE-OWNER TODAY AND SAYS SO. Wonderland has no completed multiplayer authority layer, so
 * nothing here enforces ownership, and nothing here pretends to. Writing speculative ownership rules that no
 * test can exercise would produce code that LOOKS enforced and is not, which is worse than an absent layer --
 * a reviewer would stop asking the question. Formal multi-mission authority belongs with Julius Formal.
 *
 * WHAT IS TRUE RIGHT NOW: this is a LocalPlayerSubsystem, so a task set belongs to one local player and reaches
 * no other machine. There is no replication, no server, no RPC and no permission check anywhere in this file.
 *
 * THE FOUR SEAMS AN OWNERSHIP LAYER WOULD ATTACH TO, all of which already exist for other reasons:
 *
 *   1. IDENTITY IS ALREADY EXTERNAL. ContractId is the backend's name for a mission, and every state change
 *      arrives through ApplySchedulerState/ReportEvidence addressed by it. An authority layer rejects or admits
 *      a message at that boundary; it does not need a new identity to do it.
 *
 *   2. SOURCE ALREADY RECORDS WHO SAID SO. EWonderlandTaskSource distinguishes what this session asserted from
 *      what a backend reported, and GetRunningCount() already trusts only the latter. An owner field would be a
 *      third answer to the same question this enum is asking, and belongs beside it rather than instead of it.
 *
 *   3. THE MUTATORS ARE ALREADY A CLOSED SET. AddDraft, SubmitDraft, DismissDraft, SelectTask, AdoptContractId,
 *      ApplySchedulerState, ReportEvidence. Nothing else changes a task. A permission check has exactly seven
 *      places to live, and they are all in this header.
 *
 *   4. AND SELECTION IS DELIBERATELY NOT A COMMAND. SelectTask changes what is shown and nothing about what any
 *      task is doing, so it is the one mutator that would stay unguarded per-viewer in any sane ownership model.
 *
 * WHAT WOULD HAVE TO BE DECIDED BY SOMEBODY, and is NOT decided here: whether a contract is owned by the player
 * who submitted it or by the Julius account behind them; whether a second player may watch a mission they do not
 * own; whether the orb stack is per-player or shared in one world; and who may dismiss or end another's mission.
 * Each of those is a product decision with a different answer per game mode, and none of them is a detail.
 *
 * DO NOT READ THIS BLOCK AS A CLAIM THAT MULTIPLAYER AUTHORITY IS COMPLETE. It is a list of where it would go.
 */

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

	/**
	 * WHAT A CONTRACT PRODUCED, by reference.
	 *
	 * Separate from ApplySchedulerState on purpose: a state report and an evidence list arrive at different
	 * moments and from different places, and folding them into one call would force a caller to restate a task's
	 * whole condition every time it finished writing a file. Addressed by contract id, like every other thing a
	 * backend says, so it reaches a contract that has survived a restart.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool ReportEvidence(const FString& ContractId, const TArray<FString>& EvidenceIds);

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

	/* -------------------------------------------------------- across a restart */

	/**
	 * WRITE THE CONTRACTS DOWN. Called after every change that alters what a contract IS; selection counts,
	 * because coming back to a different task than you left on is its own small lie about where you were.
	 *
	 * DRAFTS ARE NEVER WRITTEN, which is the founder's rule that an abandoned empty slot leaves no history.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool SaveContracts() const;

	/**
	 * READ THEM BACK, at Initialize.
	 *
	 * NEW LOCAL IDS, OLD CONTRACT IDS. The local id is this session's handle and is minted fresh; the contract id
	 * is the backend's own and is carried over untouched, because that is the only thing a scheduler can address
	 * a restarted mission by.
	 *
	 * AND EVERY RESTORED CONTRACT COMES BACK AS LOCAL. Its last known state is kept -- that is genuinely what we
	 * last heard -- but the source drops to Local, because Julius has said nothing this session and a surface
	 * that showed three contracts "running" on the strength of a file would be inventing concurrency out of disk.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	int32 RestoreContracts();

	/**
	 * Throw the saved contracts away. What a test calls so it does not inherit the last session's set.
	 *
	 * STATIC, because it touches the file and not this set: forgetting what was written down is not the same act
	 * as closing the contracts that are open right now, and nothing here should be able to confuse the two.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	static bool ForgetSavedContracts();

	/** True when a file exists to restore from. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	static bool HasSavedContracts();

	/**
	 * CLOSE EVERY CONTRACT AND EVERY SLOT AT ONCE. A DEVELOPMENT AFFORDANCE, named so it cannot be mistaken for
	 * product behaviour -- the same way ReportActiveSubAgentsForDevelopment is.
	 *
	 * WHY IT HAS TO EXIST. Contracts now survive a restart, which means a test that opens three of them inherits
	 * the last run's three as well and measures a set it did not build. That is how a green suite starts lying.
	 * DismissDraft deliberately refuses a real contract -- "a real mission is not dismissed by tidying" -- so
	 * this is the separate, deliberate, logged act, and it is not what the DISMISS control calls.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	int32 ClearAllTasksForDevelopment();

	static const TCHAR* SaveSlotName();

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

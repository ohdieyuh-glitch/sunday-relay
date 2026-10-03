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
#include "WonderlandTypes.h"        // FWonderlandText, FWonderlandNumber: absence is not emptiness
#include "WonderlandMissionTasks.generated.h"

/**
 * WHERE A TASK IS IN ITS LIFE. The founder's own list.
 *
 * DRAFT is the only state a task can be created in, and the only one that is not a Mission Contract.
 *
 * BLOCKED, WAITING AND CANCELLED were added by founder decision on 2026-09-27, because Julius reports all
 * three and the list had no honest place for any of them: a blocked run is not PAUSED (nobody chose to stop
 * it), a waiting run is not running (it is waiting on a person), and a cancelled run is not FAILED (it was
 * stopped on purpose). They are APPENDED so every earlier ordinal is unchanged and Draft stays at 0.
 * wonderland-julius-task-state.ts maps Julius's states onto this list one-for-one, and
 * wonderland-cpp-parity.test.ts fails if the two lists ever disagree.
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
	Paused,
	/** A reviewer or a policy stopped the run. Not a choice, and not a failure. */
	Blocked,
	/** The run is waiting on a person -- an approval or a checkpoint. Not running. */
	Waiting,
	/** Someone stopped the run on purpose. Not a failure. */
	Cancelled
};

WONDERLAND_API const TCHAR* WonderlandTaskStateName(EWonderlandTaskState State);

/**
 * THE WORD A PLAYER READS for a state -- the founder's decision 3 (2026-09-27): show a user-friendly state AND
 * Julius's authoritative raw state beside it (QUEUED / Julius: READY, WORKING / Julius: EXECUTING, COMPLETE /
 * Julius: COMPLETED). Separate from WonderlandTaskStateName on purpose: that one is an IDENTIFIER the task
 * set parses back when it reloads, so its words cannot change for readability. Readability never changes a
 * meaning either: BLOCKED is not paused, WAITING is not working, CANCELLED is not failed.
 */
WONDERLAND_API const TCHAR* WonderlandTaskStateDisplayLabel(EWonderlandTaskState State);

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
 * ONE THING A CONTRACT MUST SATISFY, ADDRESSABLE.
 *
 * The acceptance criteria used to be a list of sentences, which is enough to DISPLAY and not enough for
 * anything else. To create a mission from a contract the backend needs to be handed criteria it can key
 * results to; to report progress it has to name which one was met. Two criteria with identical words are the
 * same criterion to a list of strings and different criteria to the people who wrote them.
 *
 * `bBlocking` is the field that carries meaning rather than identity. A criterion that must hold before a
 * contract may complete and one that is merely wanted look the same in a sentence, and a mission that
 * completes with its blocking criterion unmet is the specific failure worth preventing.
 *
 * Never invented in this build: empty until a backend states it, the same rule the list kept.
 */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandAcceptanceCriterion
{
	GENERATED_BODY()

	/** The backend's own identifier for this criterion. Empty only if the backend sent none. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FString Id;

	/** What it says, in the words the backend used. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FString Text;

	/** True when the contract may not complete until this holds. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	bool bBlocking = false;
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

	/**
	 * WHAT THIS CONTRACT MUST SATISFY. Empty until a backend states it; never invented here.
	 *
	 * A BARE STRING CANNOT BE ANSWERED. The world has to be able to create a mission from these and then
	 * report which of them a run satisfied, and neither is possible against a list of sentences: there is
	 * nothing to key a result to, and two criteria with the same words are the same criterion. So each
	 * carries the backend's own ID, its text, and whether it BLOCKS completion -- a criterion that must
	 * hold is a different thing from one that is merely desirable, and collapsing them is how a mission
	 * completes with its real requirement unmet.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	TArray<FWonderlandAcceptanceCriterion> AcceptanceCriteria;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	EWonderlandTaskState State = EWonderlandTaskState::Draft;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	EWonderlandTaskSource Source = EWonderlandTaskSource::Local;

	/** Every state this task has been in, in order, so a lifecycle can be read rather than guessed. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	TArray<FString> Lifecycle;

	/**
	 * WHAT THIS TASK PRODUCED, or nothing at all if no backend has said.
	 *
	 * FOUNDER: unknown evidence stays UNKNOWN, never "0 evidence". An int32 defaulting to zero cannot
	 * express that -- a task nobody has reported on and a task that genuinely produced nothing are the
	 * same value, and the Mission Contract then shows a confident zero beside a run that has not
	 * answered. The same absence-versus-emptiness distinction FWonderlandText exists for.
	 *
	 * Counted per task, because evidence belongs to the contract that earned it.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FWonderlandTally EvidenceCount;

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
	 * TOKENS THIS TASK HAS SPENT, or nothing if nobody has told us.
	 *
	 * UNKNOWN ON EVERY JULIUS TASK TODAY, and that is a property of the backend rather than a gap here: no
	 * Julius read route serves tokens. Effort is per-dispatch diagnostics, read after a mission, with nulls
	 * that stay null. Do not build a surface that needs this to arrive.
	 *
	 * NEGATIVE IS NOT ZERO, and -1 WAS THE WRONG WAY TO SAY IT. Zero is a measurement and would be a lie:
	 * no provider telemetry reaches this build, so a surface must show "unknown" rather than an invented
	 * zero beside a running contract. A sentinel says that only to code that remembers the convention --
	 * every reader has to know that -1 is special, and the first one that forgets prints "-1 tokens".
	 * The carrier says it in the type.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FWonderlandTally TokensUsed;

	/**
	 * THE JULIUS RUN THIS TASK IS FOLLOWING, exactly as Julius returned it, or nothing before it answers.
	 *
	 * The founder's acceptance is that the Mission Contract follows the EXACT runId Julius returned. With
	 * no field for it there is nothing to key a run's state to a task: a world that hydrates three runs
	 * cannot say which contract each belongs to, and "the Mission Contract shows QUEUED for this run" has
	 * no subject. Nullable because a task exists before it is dispatched, and an empty string would be a
	 * run whose id happens to be blank.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FWonderlandText RunId;

	/**
	 * WHAT JULIUS CALLED IT, verbatim, beside the state this build mapped it to.
	 *
	 * EWonderlandTaskState's zero member is Draft. So a Julius state this build does not know does not
	 * fail and does not blank -- it silently becomes DRAFT, the most misleading value in the enum, on a
	 * contract that is actually running. A surface showing DRAFT for a run Julius calls READY is worse
	 * than one showing READY and admitting it has no mapping for it.
	 *
	 * So the raw string travels with the mapped enum and unknown stays visibly unknown, which is the same
	 * rule every carrier in this struct exists for.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FWonderlandText JuliusState;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FDateTime CreatedAt;

	/** Why this task failed, when it did. Empty otherwise. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	FString Failure;

	/**
	 * WHETHER THIS TASK IS OPEN IN THE WORKSPACE RIGHT NOW: a tab in the Julius terminal and an orb beside the Dog.
	 *
	 * PRESENTATION, NOT TRUTH. The record above is what the task IS; this is only whether the world is showing it.
	 * The founder's rule: "merely spawning into Wonderland should NOT resurrect a stack of task orbs", and closing
	 * a tab "does NOT automatically mean CANCEL THE MISSION". So a task restored from disk comes back with this
	 * false -- remembered, untouched, and invisible until the user reopens it -- and X on a tab clears it without
	 * touching state, source, contract id, lifecycle or evidence.
	 *
	 * ONE FLAG FOR BOTH SURFACES, so a tab and an orb can never disagree about whether a task is open.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Tasks")
	bool bInWorkspace = true;
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

	/**
	 * THE OBJECTIVE AS IT MAY BE KEPT (the founder's fail-closed; Second's review, 10-03): every word the free-text screen
	 * (FWonderlandCardStore::FindSecrets) flags is REDACTED before anything is saved -- a CERTAIN one always, a STATISTICAL one unless
	 * bKeepAsTyped (the player's explicit /keep). Counts what was removed. An objective that was nothing but a key is refused.
	 * SubmitDraft is this with bKeepAsTyped false. Plain C++: no reflection.
	 */
	bool SubmitDraftScreened(FGuid LocalId, const FString& Objective, bool bKeepAsTyped, int32& OutRedactedCertain, int32& OutRedactedStatistical);
	/** /keep: a contract's objective stored again as typed -- its CERTAIN finds still removed. False when it is not a contract. */
	bool KeepObjectiveAsTyped(FGuid LocalId, const FString& Typed, int32& OutRedactedCertain);

	/** Throw away an unused slot. Refuses once it is a contract: a real mission is not dismissed by tidying. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool DismissDraft(FGuid LocalId);

	/* ---------------------------------------------------------- the workspace */

	/**
	 * THE X ON A TAB. Closes the task's terminal tab and takes its orb out of the world -- and changes NOTHING
	 * about the task. A draft has no truth to keep, so a draft is simply dismissed. A contract keeps its state,
	 * source, id, lifecycle and evidence, stays on disk, and reopens with ReopenInWorkspace.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool CloseFromWorkspace(FGuid LocalId);

	/** Bring a closed task back as a tab and an orb, and look at it. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	bool ReopenInWorkspace(FGuid LocalId);

	/** How many tasks are open in the workspace. Zero means no tabs and no orbs, whatever is on disk. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	int32 GetWorkspaceCount() const;

	/**
	 * WHETHER A TASK SHOULD HAVE AN ORB BESIDE THE DOG: open in the workspace, and not finished. A completed or
	 * failed contract keeps its tab and its record; its active-follow presentation is over.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	bool ShouldPresentOrb(FGuid LocalId) const;

	/* --------------------------------------------------------- the task set */

	const TArray<FWonderlandMissionTask>& GetTasks() const { return Tasks; }

	/**
	 * THE TASK THAT IS FOLLOWING A REAL JULIUS RUN, or nullptr when none is.
	 *
	 * WHY THIS EXISTS: the data path reached this task set and stopped there. The integration lane photographed
	 * the Missions panel while a live run was followed and it read "No mission is running.", with the strip
	 * underneath it saying SIMULATED JULIUS EXECUTION and STATE Unobserved. Every acceptance clause passed and
	 * the screen stated two things that were false, which is the one outcome the founder's no-fake-passes rule
	 * is about. The surfaces read the mission subsystem, the run lives here, and nothing connected them.
	 *
	 * A REAL RUN IS A JULIUS-SOURCED TASK IN THE WORKSPACE WITH A KNOWN RunId. Source alone is not enough: a
	 * task can be Julius-sourced before anything is dispatched. The RunId is the thing only a real backend
	 * produces, which is why FollowJuliusRun records it verbatim and never synthesises one.
	 *
	 * THE MISSION THIS SESSION WAS LAST ASKED TO FOLLOW, when there are several -- not the first in insertion
	 * order, which is what this used to return and what acceptance #5 caught.
	 *
	 * The old rule was chosen for stability: "the oldest followed run does not change under the reader when a
	 * second run is adopted." That is true, and it is the wrong goal. FollowJuliusRun APPENDS, so when a
	 * mission was created from inside the world the earlier task -- including contracts restored at startup --
	 * stayed ahead of it, and every consumer kept naming the old one while the transport followed the new one.
	 * The strip read "RUN run:b0f61d6d82c0161ae5169dc8 · READY" for a mission that had been replaced, and
	 * JULIUS 3.3 said it was following mission:wonderland-integration-e2e-1. A stale mission masqueraded as
	 * the followed one, which is exactly what the no-fake-passes rule exists to prevent: the screen stated
	 * something false while the clauses underneath it passed.
	 *
	 * Stability is not worth a lie about which mission is live. A06c and A06d never caught it because they
	 * switch runs within the SAME mission, so the task stays first either way.
	 *
	 * Falls back to the first live row when nothing has been followed yet this session, which is the restored-
	 * contract case: the world has adopted nothing, and a panel still has to name something rather than claim
	 * that nothing is running.
	 */
	const FWonderlandMissionTask* FindFollowedJuliusTask() const;

	/** True while any task is following a real Julius run. The one question both HUD surfaces need. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	bool IsFollowingJuliusRun() const { return FindFollowedJuliusTask() != nullptr; }

	/** The followed mission id, or empty. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	FString GetFollowedMissionId() const;

	/** The run id Julius returned, verbatim, or empty. Never synthesised. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	FString GetFollowedRunId() const;

	/** What Julius itself called the state, or empty when it has not said. Not the mapped enum. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	FString GetFollowedJuliusState() const;

	/** The state this build mapped Julius's to, for a surface that wants the enum rather than the string. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	EWonderlandTaskState GetFollowedState() const;

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

	/** Capacity is a readability limit on what is OPEN. A closed history must not stop the + from working. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Tasks")
	bool CanAddTask() const { return GetWorkspaceCount() < GetTaskCapacity(); }

	/**
	 * THE MOST MISSION CONTRACTS ONE PC KEEPS (private beta, B04). The OPEN tabs are capped by GetTaskCapacity; the
	 * record is capped here. Restoring at startup used to stop at the tab capacity (6) and the next save then rewrote
	 * the file with only those six, so every newer contract was silently lost. Now every saved contract is restored,
	 * and a draft refuses to become a contract once the record is full -- with a reason on screen -- instead.
	 */
	// Plain C++, NOT a UFUNCTION: see the note on reflected names in WonderlandBeta.h.
	int32 GetContractLimit() const { return 48; }

	// Plain C++, NOT a UFUNCTION: see the note on reflected names in WonderlandBeta.h.
	int32 NumContracts() const;

	// Plain C++, NOT a UFUNCTION: see the note on reflected names in WonderlandBeta.h.
	bool IsAtContractLimit() const { return NumContracts() >= GetContractLimit(); }

	/**
	 * DELETE A CONTRACT THE PLAYER WROTE AND NO JULIUS RUN EVER HELD (no RunId). That is the player's own note and
	 * theirs to remove; a contract that belongs to a real run is refused, because it is not this PC's alone.
	 */
	// Plain C++, NOT a UFUNCTION: see the note on reflected names in WonderlandBeta.h.
	bool DeleteLocalContract(FGuid LocalId);

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

	/**
	 * THE STATE THE DOG SHOULD BE PERFORMING: the first contract actually being worked, or the selected one.
	 *
	 * A WORKING contract outranks the selection because the founder watches whatever is RUNNING, not whatever
	 * he last clicked -- and a draft or a queued row must never take the performance away from a contract
	 * mid-verification. Returns Draft when there is nothing to perform, which maps to no act at all.
	 */
	EWonderlandTaskState GetPerformingState() const
	{
		for (const FWonderlandMissionTask& Row : Tasks)
		{
			switch (Row.State)
			{
			case EWonderlandTaskState::Preparation:
			case EWonderlandTaskState::Research:
			case EWonderlandTaskState::Implementation:
			case EWonderlandTaskState::Verification:
			case EWonderlandTaskState::Review:
			case EWonderlandTaskState::Repair:
				return Row.State;
			default:
				break;
			}
		}
		const FWonderlandMissionTask* Chosen = Find(Selected);
		return Chosen != nullptr ? Chosen->State : EWonderlandTaskState::Draft;
	}


	/* ------------------------------------------------------- backend truth */

	/**
	 * WHAT JULIUS SAYS ABOUT A CONTRACT. The only way a task reaches a running state.
	 *
	 * Matched on the BACKEND's id rather than the local one, because after a restart the local ids are new and the
	 * contract ids are not -- which is exactly the case the founder's persistence rule is about.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Tasks")
	/** The integer form kept for existing callers: a negative token or evidence count means UNKNOWN. */
	bool ApplySchedulerState(const FString& ContractId, EWonderlandTaskState State, int64 TokensUsed, int32 EvidenceCount);

	/**
	 * The form a transport should use: each number says for itself whether anyone asserted it, and the run
	 * Julius named travels with the state it belongs to. A carrier that is not known leaves the task's
	 * existing value alone rather than overwriting it -- silence is not a correction.
	 */
	bool ApplySchedulerState(const FString& ContractId, EWonderlandTaskState State,
		const FWonderlandTally& TokensUsed, const FWonderlandTally& EvidenceCount,
		const FWonderlandText& RunId, const FWonderlandText& JuliusState);

	/**
	 * FORGET EVERY JULIUS-SOURCED CARRIER ON THIS TASK: state, evidence count, tokens, all back to unknown.
	 *
	 * "A carrier that is not known leaves the existing value alone" is right WITHIN one run -- a report that
	 * omits tokens is a quieter message, not a correction. It is wrong across a REPLACEMENT, and there are
	 * exactly two of those.
	 *
	 * A RUN CHANGE is handled automatically inside ApplySchedulerState, because a caller can forget it: if a
	 * report carries a RunId that is not the one the task already holds, everything describing the old run
	 * is cleared BEFORE the new report is applied. Otherwise a task shows the previous run's READY and its
	 * evidence count underneath a different runId -- a false statement assembled entirely from true parts.
	 *
	 * A HYDRATION is this call, because only the transport knows one happened. A snapshot REPLACES what the
	 * world held rather than adding to it, so a snapshot that does not carry tokens means tokens are unknown
	 * again -- not whatever the last stream happened to say before the connection dropped.
	 */
	bool ResetJuliusCarriers(const FString& ContractId);

	/**
	 * THIS WORLD IS NOW FOLLOWING THIS RUN. Finds or creates the contract, and asserts nothing else.
	 *
	 * ApplySchedulerState can only UPDATE a task already bound to a contract id, which is right for a
	 * mission the player authored and wrong for the case the founder's acceptance actually describes: a run
	 * created by an operator, adopted by a world that has never heard of it. Nothing would appear, and
	 * "the Mission Contract visibly shows QUEUED" would have no subject. Routing it through SubmitDraft
	 * instead would present it as a contract the PLAYER wrote, which is a lie about provenance.
	 *
	 * SO THIS COMMANDS NOTHING AND INVENTS NOTHING. It sets the contract id, marks the source Julius, opens
	 * the slot, and records the run. JuliusState and both tallies stay UNKNOWN until a report says
	 * otherwise, and the objective stays the mission id, because a hydration carries no objective and a
	 * plausible invented title is worse than an honest identifier. Idempotent on the contract id: following
	 * the same run twice is following it once.
	 *
	 * Returns the task's local id, or an invalid guid if the workspace is full.
	 */
	FGuid FollowJuliusRun(const FString& MissionId, const FWonderlandText& RunId);

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

	/** Whether the most recent save of the contracts failed (a read-only folder, a full disk). Plain C++. */
	bool DidLastSaveFail() const { return bLastSaveFailed; }
	mutable bool bLastSaveFailed = false;

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

	/** Where the generic save system keeps the slot: Saved/SaveGames/<slot>.sav. Written atomically by SaveContracts. */
	static FString SlotPath();

	FOnWonderlandTasksChanged OnTasksChanged;

private:
	void Touch(FWonderlandMissionTask& Task, EWonderlandTaskState To, EWonderlandTaskSource From);
	FWonderlandMissionTask* FindMutable(FGuid LocalId);
	/**
	 * EVERY CHANGE TO THE TASK SET GOES OUT THROUGH HERE: the Mission Handoff's write spy counts it (WonderlandMissionHandoff.h)
	 * -- a handoff must never be what changed a task -- and then the listeners hear it.
	 */
	void BroadcastTasksChanged(const TCHAR* What);

	/**
	 * IN STACK ORDER, OLDEST FIRST. Index 0 is the bottom of the stack -- the orb that was already there -- and a new
	 * one goes on the end, which is the top. The founder asked for a new orb ABOVE the current one, so the array's
	 * order IS the vertical order and nothing has to reconcile two.
	 */
	TArray<FWonderlandMissionTask> Tasks;

	/**
	 * THE CONTRACT THIS SESSION WAS LAST ASKED TO FOLLOW. Deliberately NOT saved with the contracts.
	 *
	 * It means "what the transport has adopted since this process started", not "what was open last time".
	 * Persisting it would make a restored contract claim to be followed before anything had adopted it, which
	 * is the same class of false statement in the other direction.
	 */
	FString FollowedContractId;
	FGuid Selected;
};

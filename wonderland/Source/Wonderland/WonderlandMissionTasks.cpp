#include "WonderlandMissionTasks.h"

#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "HAL/FileManager.h"
#include "Misc/App.h"
#include "Misc/Paths.h"
#include "WonderlandBeta.h"
#include "WonderlandCard.h"
#include "WonderlandMissionHandoff.h"

namespace
{
	/**
	 * HOW MANY MISSION CONTRACTS MAY BE OPEN AT ONCE.
	 *
	 * A number, not a tier. The founder said "Do not invent a final account-tier task limit unless one already
	 * exists" and none does, so this is a readability limit -- past about six the vertical stack stops being
	 * glanceable -- and it is a CVar so raising it is a setting rather than a change.
	 */
	TAutoConsoleVariable<int32> CVarTaskCapacity(TEXT("wl.Tasks.Capacity"), 6,
		TEXT("How many Mission Contract task slots may exist at once, drafts included."));
}

namespace
{
	UWonderlandMissionTaskSubsystem* TasksFor(UWorld* World)
	{
		const APlayerController* Controller = UGameplayStatics::GetPlayerController(World, 0);
		ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
	}

	/** Tasks are addressed by their position in the stack, because a GUID is not something anybody types. */
	FGuid AtIndex(const UWonderlandMissionTaskSubsystem& Tasks, int32 Index)
	{
		const TArray<FWonderlandMissionTask>& Rows = Tasks.GetTasks();
		return Rows.IsValidIndex(Index) ? Rows[Index].LocalId : FGuid();
	}

	FAutoConsoleCommandWithWorldAndArgs GTaskReset(
		TEXT("wl.Tasks.Reset"),
		TEXT("DEVELOPMENT: close every slot and forget the saved set. Not what the DISMISS control does."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr) { UE_LOG(LogTemp, Warning, TEXT("WLTASK no task subsystem")); return; }
			UE_LOG(LogTemp, Display, TEXT("WLTASK reset -> closed %d"), Tasks->ClearAllTasksForDevelopment());
		}));

	FAutoConsoleCommandWithWorldAndArgs GTaskForget(
		TEXT("wl.Tasks.Forget"),
		TEXT("Throw away the SAVED Mission Contracts on disk. Does not touch the contracts open right now."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr) { UE_LOG(LogTemp, Warning, TEXT("WLTASK no task subsystem")); return; }
			UE_LOG(LogTemp, Display, TEXT("WLTASK forget saved contracts -> %s"),
				Tasks->ForgetSavedContracts() ? TEXT("ok") : TEXT("FAILED"));
		}));

	FAutoConsoleCommandWithWorldAndArgs GTaskStatus(
		TEXT("wl.Tasks.Status"),
		TEXT("The Mission Contract task set: what exists, what colour each orb is, and who said so."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			const UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr) { UE_LOG(LogTemp, Warning, TEXT("WLTASK no task subsystem")); return; }
			for (const FString& Line : Tasks->DescribeTasks()) { UE_LOG(LogTemp, Display, TEXT("WLTASK %s"), *Line); }
		}));

	FAutoConsoleCommandWithWorldAndArgs GTaskAdd(
		TEXT("wl.Tasks.Add"),
		TEXT("Press +: make a new GRAY empty Mission Contract slot above the current one. Creates no mission."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr) { UE_LOG(LogTemp, Warning, TEXT("WLTASK no task subsystem")); return; }
			const FGuid Id = Tasks->AddDraft();
			UE_LOG(LogTemp, Display, TEXT("WLTASK add -> %s"), Id.IsValid() ? TEXT("new gray slot") : TEXT("REFUSED (at capacity)"));
		}));

	FAutoConsoleCommandWithWorldAndArgs GTaskSubmit(
		TEXT("wl.Tasks.Submit"),
		TEXT("Enter a task into a slot, turning it from GRAY to RED: wl.Tasks.Submit <index> <the task>"),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr || Args.Num() < 2)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLTASK usage: wl.Tasks.Submit <index> <the task>"));
				return;
			}
			const int32 Index = FCString::Atoi(*Args[0]);
			TArray<FString> Words = Args;
			Words.RemoveAt(0);
			const FString Objective = FString::Join(Words, TEXT(" "));
			UE_LOG(LogTemp, Display, TEXT("WLTASK submit %d -> %s"), Index,
				Tasks->SubmitDraft(AtIndex(*Tasks, Index), Objective) ? TEXT("RED, queued") : TEXT("REFUSED"));
		}));

	FAutoConsoleCommandWithWorldAndArgs GTaskSelect(
		TEXT("wl.Tasks.Select"),
		TEXT("Show a different task: wl.Tasks.Select <index>. Changes the view and nothing any task is doing."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr || Args.Num() < 1) { UE_LOG(LogTemp, Warning, TEXT("WLTASK usage: wl.Tasks.Select <index>")); return; }
			const int32 Index = FCString::Atoi(*Args[0]);
			UE_LOG(LogTemp, Display, TEXT("WLTASK select %d -> %s"), Index,
				Tasks->SelectTask(AtIndex(*Tasks, Index)) ? TEXT("showing it") : TEXT("no such task"));
		}));

	FAutoConsoleCommandWithWorldAndArgs GTaskDismiss(
		TEXT("wl.Tasks.Dismiss"),
		TEXT("Throw away an unused GRAY slot: wl.Tasks.Dismiss <index>. Refuses once it holds a contract."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr || Args.Num() < 1) { UE_LOG(LogTemp, Warning, TEXT("WLTASK usage: wl.Tasks.Dismiss <index>")); return; }
			const int32 Index = FCString::Atoi(*Args[0]);
			UE_LOG(LogTemp, Display, TEXT("WLTASK dismiss %d -> %s"), Index,
				Tasks->DismissDraft(AtIndex(*Tasks, Index)) ? TEXT("gone, no mission created") : TEXT("REFUSED"));
		}));

	FAutoConsoleCommandWithWorldAndArgs GTaskScheduler(
		TEXT("wl.Tasks.Scheduler"),
		TEXT("Stand in for Julius's scheduler, for a proof: wl.Tasks.Scheduler <index> <STATE>. Marks the task as "
		     "Julius-reported, which is the only way it counts as running."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			UWonderlandMissionTaskSubsystem* Tasks = TasksFor(World);
			if (Tasks == nullptr || Args.Num() < 2)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLTASK usage: wl.Tasks.Scheduler <index> <QUEUED|RESEARCH|IMPLEMENTATION|...>"));
				return;
			}
			const int32 Index = FCString::Atoi(*Args[0]);
			const FGuid Id = AtIndex(*Tasks, Index);
			const FWonderlandMissionTask* Row = Tasks->Find(Id);
			if (Row == nullptr) { UE_LOG(LogTemp, Warning, TEXT("WLTASK no task %d"), Index); return; }
			// A scheduler addresses contracts by THEIR id, so give the task one if it has not got one yet.
			FString ContractId = Row->ContractId;
			if (ContractId.IsEmpty())
			{
				ContractId = FString::Printf(TEXT("dev-contract-%d"), Index);
				Tasks->AdoptContractId(Id, ContractId);
			}
			const FString Want = Args[1].ToUpper();
			EWonderlandTaskState State = EWonderlandTaskState::Queued;
			// Bounded by the LAST member. This read `<= Paused` until Blocked/Waiting/Cancelled were appended, which
			// would have parsed "BLOCKED" as the Queued default above.
			for (int32 Value = 0; Value <= static_cast<int32>(EWonderlandTaskState::Cancelled); ++Value)
			{
				if (Want == WonderlandTaskStateName(static_cast<EWonderlandTaskState>(Value)))
				{
					State = static_cast<EWonderlandTaskState>(Value);
					break;
				}
			}
			UE_LOG(LogTemp, Display, TEXT("WLTASK scheduler %s -> %s : %s"), *ContractId, *Want,
				Tasks->ApplySchedulerState(ContractId, State, -1, 0) ? TEXT("applied") : TEXT("REFUSED"));
		}));
}

const TCHAR* WonderlandTaskStateName(EWonderlandTaskState State)
{
	switch (State)
	{
	case EWonderlandTaskState::Draft:          return TEXT("DRAFT");
	case EWonderlandTaskState::Queued:         return TEXT("QUEUED");
	case EWonderlandTaskState::Preparation:    return TEXT("PREPARATION");
	case EWonderlandTaskState::Research:       return TEXT("RESEARCH");
	case EWonderlandTaskState::Implementation: return TEXT("IMPLEMENTATION");
	case EWonderlandTaskState::Verification:   return TEXT("VERIFICATION");
	case EWonderlandTaskState::Review:         return TEXT("REVIEW");
	case EWonderlandTaskState::Repair:         return TEXT("REPAIR");
	case EWonderlandTaskState::Completed:      return TEXT("COMPLETED");
	case EWonderlandTaskState::Failed:         return TEXT("FAILED");
	case EWonderlandTaskState::Paused:         return TEXT("PAUSED");
	case EWonderlandTaskState::Blocked:        return TEXT("BLOCKED");
	case EWonderlandTaskState::Waiting:        return TEXT("WAITING");
	case EWonderlandTaskState::Cancelled:      return TEXT("CANCELLED");
	}
	return TEXT("UNKNOWN");
}

const TCHAR* WonderlandTaskStateDisplayLabel(EWonderlandTaskState State)
{
	// The founder's words where he gave them (QUEUED, WORKING, WAITING, BLOCKED, REVIEWING, REPAIRING, CANCELLED,
	// COMPLETE, FAILED), and the same register for the rest. A switch with no default, so a state added later is a
	// compile warning here rather than a silently mislabelled row.
	switch (State)
	{
	case EWonderlandTaskState::Draft:          return TEXT("DRAFT");
	case EWonderlandTaskState::Queued:         return TEXT("QUEUED");
	case EWonderlandTaskState::Preparation:    return TEXT("PLANNING");
	case EWonderlandTaskState::Research:       return TEXT("RESEARCHING");
	case EWonderlandTaskState::Implementation: return TEXT("WORKING");
	case EWonderlandTaskState::Verification:   return TEXT("VERIFYING");
	case EWonderlandTaskState::Review:         return TEXT("REVIEWING");
	case EWonderlandTaskState::Repair:         return TEXT("REPAIRING");
	case EWonderlandTaskState::Completed:      return TEXT("COMPLETE");
	case EWonderlandTaskState::Failed:         return TEXT("FAILED");
	case EWonderlandTaskState::Paused:         return TEXT("PAUSED");
	case EWonderlandTaskState::Blocked:        return TEXT("BLOCKED");
	case EWonderlandTaskState::Waiting:        return TEXT("WAITING");
	case EWonderlandTaskState::Cancelled:      return TEXT("CANCELLED");
	}
	return TEXT("UNKNOWN");
}

bool WonderlandTaskIsContract(EWonderlandTaskState State)
{
	// EVERYTHING BUT DRAFT. Written as a negation on purpose: a state added later is a contract unless somebody
	// deliberately makes it another kind of empty, and the compiler will not remind anyone to update a list.
	return State != EWonderlandTaskState::Draft;
}

void UWonderlandMissionTaskSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Tasks.Reset();
	Selected.Invalidate();
	// CONTRACTS OUTLIVE A SESSION; the world coming back with the missions you opened still open is the whole
	// point of a contract having a backend identity at all.
	RestoreContracts();
}

int32 UWonderlandMissionTaskSubsystem::ClearAllTasksForDevelopment()
{
	const int32 Closed = Tasks.Num();
	if (Closed == 0)
	{
		return 0;
	}
	Tasks.Reset();
	Selected.Invalidate();
	// THE FILE GOES TOO, or the next Initialize brings them all straight back and this cleared nothing.
	ForgetSavedContracts();
	UE_LOG(LogTemp, Display, TEXT("WLTASK development: closed all %d slot(s) and forgot the saved set"), Closed);
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return Closed;
}

const TCHAR* UWonderlandMissionTaskSubsystem::SaveSlotName()
{
	return TEXT("WonderlandMissionContracts");
}

bool UWonderlandMissionTaskSubsystem::HasSavedContracts()
{
	return UGameplayStatics::DoesSaveGameExist(SaveSlotName(), 0);
}

bool UWonderlandMissionTaskSubsystem::SaveContracts() const
{
	UWonderlandMissionTaskSave* Save = Cast<UWonderlandMissionTaskSave>(
		UGameplayStatics::CreateSaveGameObject(UWonderlandMissionTaskSave::StaticClass()));
	if (Save == nullptr)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK could not make a save object; contracts will not survive a restart"));
		return false;
	}
	// CONTRACTS ONLY. An empty slot is local to the session and leaves no history, which is the founder's rule
	// about an abandoned draft -- so it is not written here, and closing the game with one open loses nothing
	// because there was nothing to lose.
	int32 SelectedIndex = INDEX_NONE;
	for (const FWonderlandMissionTask& Task : Tasks)
	{
		if (!WonderlandTaskIsContract(Task.State))
		{
			continue;
		}
		if (Task.LocalId == Selected)
		{
			SelectedIndex = Save->Contracts.Num();
		}
		Save->Contracts.Add(Task);
	}
	Save->SelectedIndex = SelectedIndex;
	if (Save->Contracts.Num() == 0)
	{
		// NOTHING LEFT MEANS NOTHING KEPT. Writing an empty file would make the next session restore a set of no
		// contracts over a set of no contracts, which is harmless but leaves a file claiming a state nobody has.
		return ForgetSavedContracts();
	}
	// A WHOLE FILE OR NOTHING (private beta, B24). SaveGameToSlot truncates the slot and writes it in place, so a
	// process killed mid-write -- this laptop's low-memory reaper -- left a truncated file that restored PART of the
	// set. The bytes are serialised here and moved over the slot in one step, at the generic save system's own path
	// (Saved/SaveGames/<slot>.sav). AND SEALED: a file corrupted afterwards is set aside at the next start instead of
	// crashing it (WonderlandBeta::SaveSealedGame).
	const bool bWrote = WonderlandBeta::SaveSealedGame(Save, SlotPath());
	bLastSaveFailed = !bWrote;
	if (!bWrote)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK could NOT save %d contract(s) to %s; they are kept in this session only"),
			Save->Contracts.Num(), *SlotPath());
	}
	UE_LOG(LogTemp, Verbose, TEXT("WLTASK saved %d contract(s): %s"),
		Save->Contracts.Num(), bWrote ? TEXT("ok") : TEXT("FAILED"));
	return bWrote;
}

FString UWonderlandMissionTaskSubsystem::SlotPath()
{
	return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("SaveGames"), FString(SaveSlotName()) + TEXT(".sav"));
}

int32 UWonderlandMissionTaskSubsystem::NumContracts() const
{
	int32 Count = 0;
	for (const FWonderlandMissionTask& Task : Tasks)
	{
		Count += WonderlandTaskIsContract(Task.State) ? 1 : 0;
	}
	return Count;
}

bool UWonderlandMissionTaskSubsystem::DeleteLocalContract(FGuid LocalId)
{
	const FWonderlandMissionTask* Task = Find(LocalId);
	if (Task == nullptr)
	{
		return false;
	}
	if (!WonderlandTaskIsContract(Task->State))
	{
		return DismissDraft(LocalId);
	}
	if (Task->RunId.bKnown)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused to delete a contract of %d characters: it belongs to Julius run %s"),
			Task->Objective.Len(), *Task->RunId.Value);
		return false;
	}
	// THE LENGTH, NOT THE TEXT: a tester attaches this log to a bug report, and what they wrote is theirs (Second
	// Wonderland's review; the submit path logs only the length too).
	const int32 ObjectiveLength = Task->Objective.Len();
	const bool bWasSelected = Selected == LocalId;
	Tasks.RemoveAll([LocalId](const FWonderlandMissionTask& Row) { return Row.LocalId == LocalId; });
	if (bWasSelected)
	{
		Selected.Invalidate();
		for (int32 Index = Tasks.Num() - 1; Index >= 0; --Index)
		{
			if (Tasks[Index].bInWorkspace) { Selected = Tasks[Index].LocalId; break; }
		}
	}
	UE_LOG(LogTemp, Display, TEXT("WLTASK deleted one of the player's contracts (%d-character objective; never part of a Julius run)"), ObjectiveLength);
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

int32 UWonderlandMissionTaskSubsystem::RestoreContracts()
{
	// A temporary beside the save is a write that never finished (the swap is atomic): it is discarded, never adopted.
	WonderlandBeta::RecoverInterruptedSave(SlotPath());
	if (!HasSavedContracts())
	{
		return 0;
	}
	// ONLY SEALED BYTES reach the engine's loader, which trusts what it reads (WonderlandBeta::LoadSealedGame).
	FString Why;
	UWonderlandMissionTaskSave* Save = Cast<UWonderlandMissionTaskSave>(
		WonderlandBeta::LoadSealedGame(SlotPath(), UWonderlandMissionTaskSave::StaticClass(), Why));
	if (Save != nullptr && Save->Version != 1)
	{
		Why = FString::Printf(TEXT("it is version %d, not 1"), Save->Version);
		Save = nullptr;
	}
	if (Save == nullptr)
	{
		// REFUSED, NOT GUESSED AT. A file of a shape this build does not know is not read as though it were this one;
		// a misread contract is worse than a forgotten one. AND IT IS SET ASIDE, NOT OVERWRITTEN: the first save of this
		// session would otherwise replace it (private beta, B24), so it is moved beside itself first.
		const FString Aside = WonderlandBeta::SetAsideRefusedSave(SlotPath());
		UE_LOG(LogTemp, Warning, TEXT("WLTASK the saved contracts could not be used (%s); set aside as %s"),
			Why.IsEmpty() ? TEXT("unreadable") : *Why, Aside.IsEmpty() ? TEXT("(the move FAILED)") : *Aside);
		// the set-aside copy is NOT screened (it could not be read): it may hold text typed before the secret screen existed
		UE_LOG(LogTemp, Warning, TEXT("WLTASK the set-aside copy may hold objectives typed before the secret screen existed; delete it once it is no longer needed"));
		return 0;
	}
	const FString When = FDateTime::UtcNow().ToIso8601();
	int32 Restored = 0;
	int32 Redacted = 0;
	for (const FWonderlandMissionTask& Saved : Save->Contracts)
	{
		if (!WonderlandTaskIsContract(Saved.State))
		{
			// Belt and braces: a draft should never have been written, and is not read back if one ever is.
			continue;
		}
		// EVERY SAVED CONTRACT COMES BACK (private beta, B04). This loop used to stop at the OPEN-tab capacity (6), and
		// the next save rewrote the file with only those six: every newer contract was silently lost at the first
		// select, close or submit after a restart. Restored contracts come back CLOSED (below), so they never count
		// against the open tabs, and the record's own limit is applied where contracts are created, not here.
		FWonderlandMissionTask Task = Saved;
		// A KEY KEPT BEFORE THE OBJECTIVE SCREEN EXISTED (Second's review, 10-03) is redacted as it comes back and the file is
		// rewritten below: fail-closed per field, never shown, never logged, never kept
		bool bObjectiveRescreened = false;
		const FString RescreenedObjective = ScreenRestoredObjective(Task, bObjectiveRescreened);
		if (bObjectiveRescreened)
		{
			Task.Objective = RescreenedObjective;
			++Redacted;
		}
		// A NEW HANDLE FOR A NEW SESSION. The local id means nothing outside the machine it was minted on, and
		// ApplySchedulerState deliberately does not use it; the CONTRACT id is what came back unchanged.
		Task.LocalId = FGuid::NewGuid();
		// REMEMBERED, NOT REOPENED. The founder respawned into a stack of orbs for tasks they had not touched,
		// because every restored contract came straight back into the workspace. A restored task now waits in
		// the record -- no tab, no orb -- until the user reopens it or a scheduler reports on it.
		Task.bInWorkspace = false;
		// AND NOBODY HAS CONFIRMED ANY OF THIS YET. The state is what we last heard and is kept as such, but the
		// source drops to Local so that nothing counts as running on the strength of a file. GetRunningCount()
		// counts Julius-sourced work only, so it reads zero until a scheduler speaks -- and when one does, it
		// addresses this contract by the id above and the task picks up its real state.
		Task.Source = EWonderlandTaskSource::Local;
		Task.Lifecycle.Add(FString::Printf(TEXT("%s RESTORED (%s, unconfirmed since restart)"),
			*When, WonderlandTaskStateName(Task.State)));
		Tasks.Add(Task);
		++Restored;
	}
	// NOTHING IS SELECTED, because nothing is open. Selecting a task that is not in the workspace would put the
	// mission strip on it and hand the + a slot the user cannot see.
	Selected.Invalidate();
	if (Redacted > 0)
	{
		const bool bRewritten = SaveContracts();
		UE_LOG(LogTemp, Warning, TEXT("WLTASK %d restored objective(s) held something shaped like a key or password: redacted; the file %s"), Redacted,
			bRewritten ? TEXT("rewritten") : TEXT("NOT rewritten (the write failed): the redaction holds for this session only"));
	}
	if (Restored > 0)
	{
		UE_LOG(LogTemp, Display, TEXT("WLTASK restored %d Mission Contract(s); none is running until Julius says so"),
			Restored);
		BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	}
	return Restored;
}

bool UWonderlandMissionTaskSubsystem::ForgetSavedContracts()
{
	if (!HasSavedContracts())
	{
		return true;
	}
	const bool bGone = UGameplayStatics::DeleteGameInSlot(SaveSlotName(), 0);
	// AND ANY UNFINISHED TEMPORARY BESIDE IT, so a forgotten set cannot come back from it (Second Wonderland's review).
	WonderlandBeta::RecoverInterruptedSave(SlotPath());
	UE_LOG(LogTemp, Display, TEXT("WLTASK saved contracts forgotten: %s"), bGone ? TEXT("ok") : TEXT("FAILED"));
	return bGone;
}

int32 UWonderlandMissionTaskSubsystem::GetTaskCapacity() const
{
	return FMath::Clamp(CVarTaskCapacity.GetValueOnGameThread(), 1, 24);
}

FWonderlandMissionTask* UWonderlandMissionTaskSubsystem::FindMutable(FGuid LocalId)
{
	return Tasks.FindByPredicate([LocalId](const FWonderlandMissionTask& Task) { return Task.LocalId == LocalId; });
}

const FWonderlandMissionTask* UWonderlandMissionTaskSubsystem::Find(FGuid LocalId) const
{
	return Tasks.FindByPredicate([LocalId](const FWonderlandMissionTask& Task) { return Task.LocalId == LocalId; });
}

void UWonderlandMissionTaskSubsystem::Touch(FWonderlandMissionTask& Task, EWonderlandTaskState To, EWonderlandTaskSource From)
{
	Task.State = To;
	Task.Source = From;
	// THE LIFECYCLE IS APPENDED, NEVER REWRITTEN. A task that went to REPAIR and back is a different thing from one
	// that never left IMPLEMENTATION, and only the record can tell them apart afterwards.
	Task.Lifecycle.Add(FString::Printf(TEXT("%s %s"),
		*FDateTime::UtcNow().ToIso8601(), WonderlandTaskStateName(To)));
}

void UWonderlandMissionTaskSubsystem::BroadcastTasksChanged(const TCHAR* What)
{
	FWonderlandMissionHandoff::NoteMutation(What);
	OnTasksChanged.Broadcast();
}

FGuid UWonderlandMissionTaskSubsystem::AddDraft()
{
	if (!CanAddTask())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused a new slot: %d of %d already open"), GetWorkspaceCount(), GetTaskCapacity());
		return FGuid();
	}
	FWonderlandMissionTask Task;
	Task.LocalId = FGuid::NewGuid();
	Task.CreatedAt = FDateTime::UtcNow();
	// A DRAFT IS LOCAL AND NOTHING ELSE. No contract id, no backend call, no history: an abandoned slot must be able
	// to vanish without ever having existed anywhere.
	Touch(Task, EWonderlandTaskState::Draft, EWonderlandTaskSource::Local);
	Tasks.Add(Task);
	// THE NEW SLOT IS THE ONE YOU ARE LOOKING AT, because the next thing anybody does after pressing + is type into
	// it. Selecting anything else would make the button take two clicks to mean one thing.
	Selected = Task.LocalId;
	UE_LOG(LogTemp, Display, TEXT("WLTASK new draft slot (%d of %d)"), Tasks.Num(), GetTaskCapacity());
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return Task.LocalId;
}

bool UWonderlandMissionTaskSubsystem::SubmitDraft(FGuid LocalId, const FString& Objective)
{
	int32 RedactedCertain = 0;
	int32 RedactedStatistical = 0;
	return SubmitDraftScreened(LocalId, Objective, false, RedactedCertain, RedactedStatistical);
}

namespace
{
	/** The objective as the free-text screen lets it be kept: screened as every redacting caller screens (ScreenText: space-like
	 *  characters kept as spaces, invisibles gone, both views read -- Second's round-5 MAJORs 1-3), every find redacted (the statistical
	 *  ones only without /keep). Counts what was removed.
	 *  r7 (Second's (b)), bForRestore: a RESTART applies no label's weak value -- a pre-r7 contract's prose ("update the password Policy page")
	 *  is never rewritten -- and to a /keep'd objective only what is certain by its own SHAPE, so the player's word survives whatever its
	 *  neighbours became. */
	FString WonderlandScreenObjective(const FString& Typed, bool bKeepAsTyped, int32& OutCertain, int32& OutStatistical, bool bForRestore = false)
	{
		OutCertain = 0;
		OutStatistical = 0;
		FString Screened;
		TArray<FWonderlandCardStore::FSecretFind> Finds;
		FWonderlandCardStore::ScreenText(Typed, Screened, Finds);
		if (bForRestore && (FWonderlandCardStore::QaRulesOff() & FWonderlandCardStore::QaRuleClasses) == 0)
		{
			Finds.RemoveAll([bKeepAsTyped](const FWonderlandCardStore::FSecretFind& Find) { return bKeepAsTyped ? !Find.bShape : Find.bWeak; });
		}
		if (Finds.Num() == 0)
		{
			return Typed;
		}
		for (const FWonderlandCardStore::FSecretFind& Find : Finds)
		{
			(Find.bCertain ? OutCertain : OutStatistical) += Find.bCertain || !bKeepAsTyped ? 1 : 0;
		}
		return FWonderlandCardStore::RedactSecrets(Screened, Finds, bKeepAsTyped);
	}

	/** The lifecycle line /keep leaves: the objective is the player's own word, and a restart's restore must not take it back. */
	const TCHAR* const WonderlandKeptMark = TEXT("KEPT AS TYPED (/keep)");

	/** True when nothing but redaction markers and spaces is left: a contract must stand for a task. */
	bool WonderlandOnlyRedacted(const FString& Kept)
	{
		return Kept.Replace(TEXT("[a key: never shown or stored]"), TEXT("")).TrimStartAndEnd().IsEmpty();
	}
}

bool UWonderlandMissionTaskSubsystem::SubmitDraftScreened(FGuid LocalId, const FString& Objective, bool bKeepAsTyped, int32& OutRedactedCertain,
	int32& OutRedactedStatistical)
{
	OutRedactedCertain = 0;
	OutRedactedStatistical = 0;
	FWonderlandMissionTask* Task = FindMutable(LocalId);
	if (Task == nullptr)
	{
		return false;
	}
	if (WonderlandTaskIsContract(Task->State))
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused: that slot is already a Mission Contract"));
		return false;
	}
	const FString Trimmed = Objective.TrimStartAndEnd();
	if (Trimmed.IsEmpty())
	{
		// A RED ORB STANDING FOR NOTHING is the one outcome the gray/red rule exists to prevent.
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused: a Mission Contract needs an objective"));
		return false;
	}
	// NEVER A SECRET ON DISK (the founder: secrets are never persisted in the Project Brain, and Mission Context is its section 04;
	// Second's review, 10-03): every flagged word is redacted before the first write -- the objective is kept, the key is not
	const FString Kept = WonderlandScreenObjective(Trimmed, bKeepAsTyped, OutRedactedCertain, OutRedactedStatistical);
	if (WonderlandOnlyRedacted(Kept))
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused: the objective was nothing but something shaped like a key or password; nothing was saved"));
		return false;
	}
	if (IsAtContractLimit())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused: %d Mission Contracts kept, the most this PC stores"), NumContracts());
		return false;
	}
	Task->Objective = Kept;
	if (OutRedactedCertain + OutRedactedStatistical > 0)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK %d part(s) of the objective shaped like a key or password redacted before saving (%d certain)"),
			OutRedactedCertain + OutRedactedStatistical, OutRedactedCertain);
	}
	// QUEUED, AND LOCAL, BECAUSE THAT IS THE TRUTH IN THIS BUILD. No Julius link reaches this world, so the contract
	// is real and waiting, and the source says who said so. When a scheduler exists it reports through
	// ApplySchedulerState and this same task moves on -- nothing in the presentation has to change to believe it.
	Touch(*Task, EWonderlandTaskState::Queued, EWonderlandTaskSource::Local);
	UE_LOG(LogTemp, Display, TEXT("WLTASK contract accepted, QUEUED (local: Julius has not acknowledged it)"));
	// GRAY BECOMING RED IS THE MOMENT SOMETHING WORTH KEEPING EXISTS, so this is the first write.
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

bool UWonderlandMissionTaskSubsystem::KeepObjectiveAsTyped(FGuid LocalId, const FString& Typed, int32& OutRedactedCertain)
{
	OutRedactedCertain = 0;
	FWonderlandMissionTask* Task = FindMutable(LocalId);
	if (Task == nullptr || !WonderlandTaskIsContract(Task->State))
	{
		return false;
	}
	int32 Statistical = 0;
	const FString Kept = WonderlandScreenObjective(Typed.TrimStartAndEnd(), true, OutRedactedCertain, Statistical);
	if (WonderlandOnlyRedacted(Kept))
	{
		return false;
	}
	Task->Objective = Kept;
	// MARKED AS THE PLAYER'S OWN WORD, so a restart's restore does not take back what /keep gave (ScreenRestoredObjective)
	Task->Lifecycle.Add(FString::Printf(TEXT("%s %s"), *FDateTime::UtcNow().ToIso8601(), WonderlandKeptMark));
	UE_LOG(LogTemp, Display, TEXT("WLTASK /keep: the objective stored as typed (%d certain part(s) still removed)"), OutRedactedCertain);
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

FString UWonderlandMissionTaskSubsystem::ScreenRestoredObjective(const FWonderlandMissionTask& Task, bool& bOutChanged)
{
	// A WORD THE PLAYER KEPT WITH /keep IS THEIRS (CORE's read, round 5: the restore screened every objective in full, so the next restart
	// undid every /keep). A kept task is re-screened for what is certain by its own SHAPE only (r7): a key never survives, a kept word does.
	// Any other objective gets the screen fail-closed -- a key or a strong password kept before the screen existed -- except a label's WEAK
	// value (r7, Second's (b)): r6 rewrote "update the password Policy page" for good at the first restart. Either way it is idempotent -- the
	// redaction's marker is never a find, and the screen runs to its fixpoint -- so a restored objective is not re-redacted on every load.
	const bool bPlayerKept = Task.Lifecycle.ContainsByPredicate([](const FString& Entry) { return Entry.Contains(WonderlandKeptMark); });
	int32 Certain = 0;
	int32 Statistical = 0;
	const FString Screened = WonderlandScreenObjective(Task.Objective, bPlayerKept, Certain, Statistical, true);
	bOutChanged = Certain + Statistical > 0;
	return bOutChanged ? Screened : Task.Objective;
}

bool UWonderlandMissionTaskSubsystem::DismissDraft(FGuid LocalId)
{
	const FWonderlandMissionTask* Task = Find(LocalId);
	if (Task == nullptr)
	{
		return false;
	}
	if (WonderlandTaskIsContract(Task->State))
	{
		// A REAL MISSION IS NOT DISMISSED BY TIDYING. Ending one is a different act with different consequences.
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused: that slot holds a Mission Contract, not an empty draft"));
		return false;
	}
	const bool bWasSelected = Selected == LocalId;
	Tasks.RemoveAll([LocalId](const FWonderlandMissionTask& Row) { return Row.LocalId == LocalId; });
	if (bWasSelected)
	{
		// Fall back to the top of the stack, which is where the eye already is.
		Selected = Tasks.Num() > 0 ? Tasks.Last().LocalId : FGuid();
	}
	UE_LOG(LogTemp, Display, TEXT("WLTASK empty slot dismissed; no mission was created"));
	// The dismissed slot was never written, but the SELECTION moved, and coming back to a different contract
	// than you left on is its own small untruth about where you were.
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

bool UWonderlandMissionTaskSubsystem::CloseFromWorkspace(FGuid LocalId)
{
	FWonderlandMissionTask* Task = FindMutable(LocalId);
	if (Task == nullptr)
	{
		return false;
	}
	if (!WonderlandTaskIsContract(Task->State))
	{
		// A DRAFT HAS NO TRUTH TO KEEP. Closing an empty slot is dismissing it.
		return DismissDraft(LocalId);
	}
	if (!Task->bInWorkspace)
	{
		return true;
	}
	// THE TAB AND THE ORB GO; THE TASK STAYS. State, source, contract id, lifecycle, evidence: none of it moves.
	Task->bInWorkspace = false;
	if (Selected == LocalId)
	{
		// Look at the nearest open tab, or at nothing. Never at a closed one.
		Selected.Invalidate();
		for (int32 Index = Tasks.Num() - 1; Index >= 0; --Index)
		{
			if (Tasks[Index].bInWorkspace) { Selected = Tasks[Index].LocalId; break; }
		}
	}
	UE_LOG(LogTemp, Display, TEXT("WLTASK tab closed: a contract of %d characters stays %s, out of the workspace"),
		Task->Objective.Len(), WonderlandTaskStateName(Task->State));
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

bool UWonderlandMissionTaskSubsystem::ReopenInWorkspace(FGuid LocalId)
{
	FWonderlandMissionTask* Task = FindMutable(LocalId);
	if (Task == nullptr)
	{
		return false;
	}
	if (!Task->bInWorkspace && GetWorkspaceCount() >= GetTaskCapacity())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLTASK cannot reopen: %d of %d already open"), GetWorkspaceCount(), GetTaskCapacity());
		return false;
	}
	Task->bInWorkspace = true;
	Selected = LocalId;
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

int32 UWonderlandMissionTaskSubsystem::GetWorkspaceCount() const
{
	int32 Count = 0;
	for (const FWonderlandMissionTask& Task : Tasks) { Count += Task.bInWorkspace ? 1 : 0; }
	return Count;
}

bool UWonderlandMissionTaskSubsystem::ShouldPresentOrb(FGuid LocalId) const
{
	const FWonderlandMissionTask* Task = Find(LocalId);
	if (Task == nullptr || !Task->bInWorkspace)
	{
		return false;
	}
	// A DRAFT IS A TAB, NOT A CONTRACT, AND IT GETS NO ORB IN THE WORLD.
	//
	// This is where the founder's "two gray mission orbs following me around the open world" came from. Pressing
	// + makes an empty Draft, a Draft counted as presentable, and so an uncommitted slot immediately hung a grey
	// orb beside the Dog and walked around with him. Press + twice and there are two, for two missions that do
	// not exist. Nothing was leaking and nothing was duplicated -- the orb was doing exactly what it was told.
	//
	// It is also what the founder asked for on the other side of the same feature: until Enter is pressed, "do
	// not attach it beside the Relay Dog". ENTER IS THE COMMIT BOUNDARY, so the orb -- which is the world's
	// picture of a real mission -- begins at the commit and not before it. The pending tab still exists, still
	// shows grey in the strip above the running contract, and still belongs to the founder; it just has not
	// earned a place in the world yet.
	if (!WonderlandTaskIsContract(Task->State))
	{
		return false;
	}
	// FINISHED IS COMPLETED, FAILED OR CANCELLED. Blocked and Waiting are alive -- Waiting in particular is a run
	// that needs a person -- so their orb stays.
	return Task->State != EWonderlandTaskState::Completed && Task->State != EWonderlandTaskState::Failed
		&& Task->State != EWonderlandTaskState::Cancelled;
}

bool UWonderlandMissionTaskSubsystem::SelectTask(FGuid LocalId)
{
	if (Find(LocalId) == nullptr)
	{
		return false;
	}
	if (Selected == LocalId)
	{
		return true;
	}
	Selected = LocalId;
	// NOTHING ELSE HAPPENS. The other tasks are not paused, reset or touched: selection is a view.
	// The view is worth remembering, though: coming back to a different contract than you left on is a small
	// untruth about where you were, and it costs one file write to be right about.
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

bool UWonderlandMissionTaskSubsystem::ReportEvidence(const FString& ContractId, const TArray<FString>& EvidenceIds)
{
	if (ContractId.IsEmpty())
	{
		return false;
	}
	FWonderlandMissionTask* Task = Tasks.FindByPredicate(
		[&ContractId](const FWonderlandMissionTask& Row) { return Row.ContractId == ContractId; });
	if (Task == nullptr)
	{
		return false;
	}
	Task->EvidenceIds = EvidenceIds;
	// THE COUNT FOLLOWS THE LIST ONCE THERE IS ONE. A scheduler that has named three artefacts has told us the
	// count as well, and leaving a stale smaller number beside them would be a contradiction on the same task.
	// NAMING ARTEFACTS IS ITSELF AN ASSERTION, so this is one of the two places the count becomes KNOWN: a
	// backend that lists three has said there are at least three, whether or not it also sent a number.
	const int64 Named = static_cast<int64>(EvidenceIds.Num());
	Task->EvidenceCount.Value = Task->EvidenceCount.bKnown ? FMath::Max(Task->EvidenceCount.Value, Named) : Named;
	Task->EvidenceCount.bKnown = true;
	// A LIST OF NAMES IS STILL A FLOOR. A backend that sent three references has not said there are only
	// three, and this call cannot tell a full set from a first instalment.
	UE_LOG(LogTemp, Display, TEXT("WLTASK %s reported %d evidence reference(s)"), *ContractId, EvidenceIds.Num());
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

bool UWonderlandMissionTaskSubsystem::AdoptContractId(FGuid LocalId, const FString& ContractId)
{
	FWonderlandMissionTask* Task = FindMutable(LocalId);
	if (Task == nullptr || ContractId.IsEmpty() || !WonderlandTaskIsContract(Task->State))
	{
		return false;
	}
	Task->ContractId = ContractId;
	// THIS IS THE ONE FIELD A RESTART CANNOT REGENERATE, so it is written the instant it arrives. Without it a
	// restored contract is a mission no scheduler can address by name.
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

bool UWonderlandMissionTaskSubsystem::ApplySchedulerState(
	const FString& ContractId, EWonderlandTaskState State, int64 TokensUsed, int32 EvidenceCount)
{
	// THE OLD SIGNATURE, KEPT, AND WHAT IT NOW MEANS. Callers that pass plain integers cannot express "I was
	// not told", so the sentinels they have always used are translated here rather than at every call site:
	// a negative token count and a negative evidence count mean UNKNOWN, everything else is an assertion.
	// Anything that genuinely knows should call the overload below and say so in the type.
	FWonderlandTally Tokens;
	Tokens.bKnown = TokensUsed >= 0;
	Tokens.Value = TokensUsed;
	// AN INTEGER CALLER CANNOT SAY WHETHER ITS TOTAL IS FINAL, so it is recorded as a floor. Claiming
	// completeness on behalf of a caller that has no way to express it is how a running total becomes a
	// final one; the overload below is where a transport says so properly.
	Tokens.bComplete = false;
	FWonderlandTally Evidence;
	Evidence.bKnown = EvidenceCount >= 0;
	Evidence.Value = EvidenceCount;
	Evidence.bComplete = false;
	return ApplySchedulerState(ContractId, State, Tokens, Evidence, FWonderlandText(), FWonderlandText());
}

bool UWonderlandMissionTaskSubsystem::ApplySchedulerState(
	const FString& ContractId, EWonderlandTaskState State, const FWonderlandTally& TokensUsed,
	const FWonderlandTally& EvidenceCount, const FWonderlandText& RunId,
	const FWonderlandText& JuliusState)
{
	if (ContractId.IsEmpty())
	{
		return false;
	}
	// MATCHED ON THE BACKEND'S ID. After a restart the local ids are all new and the contract ids are not, which is
	// exactly the case that must not reorder or merge mission identities.
	FWonderlandMissionTask* Task = Tasks.FindByPredicate(
		[&ContractId](const FWonderlandMissionTask& Row) { return Row.ContractId == ContractId; });
	if (Task == nullptr)
	{
		return false;
	}
	if (State == EWonderlandTaskState::Draft)
	{
		// A BACKEND CANNOT MAKE A CONTRACT EMPTY AGAIN. Draft is a local-only idea and accepting this would erase a
		// real mission's identity on a bad message.
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused: a scheduler may not move a contract back to DRAFT"));
		return false;
	}
	// ---- A DIFFERENT RUN IS A REPLACEMENT, NOT A CONTINUATION.
	//
	// Everything below preserves a carrier the report does not mention, which is right while one run is
	// talking. The moment the runId changes -- an explicit rerun, or the world following a different run --
	// the state, the evidence count and the tokens all describe the OLD run, and preserving them would
	// assemble a false statement out of true parts: the previous run's READY and its evidence, shown
	// under the new runId. So they are forgotten first, and the new report fills in whatever it knows.
	//
	// Done here rather than at the call site because it is the case a caller forgets.
	if (RunId.bKnown && (!Task->RunId.bKnown || Task->RunId.Value != RunId.Value))
	{
		Task->JuliusState = FWonderlandText();
		Task->EvidenceCount = FWonderlandTally();
		Task->TokensUsed = FWonderlandTally();
		UE_LOG(LogTemp, Display, TEXT("WLTASK %s follows a new run; its Julius carriers are unknown again"),
			*ContractId);
	}
	Touch(*Task, State, EWonderlandTaskSource::Julius);
	// ONLY AN ASSERTION OVERWRITES AN ASSERTION. A report that does not carry tokens must not erase the
	// tokens a previous report did carry -- "unknown" arriving after "1,400" is a quieter message, not a
	// correction to zero, and the founder's rule is that unknown stays unknown rather than becoming a number.
	if (TokensUsed.bKnown)
	{
		Task->TokensUsed = TokensUsed;
	}
	if (EvidenceCount.bKnown)
	{
		Task->EvidenceCount = EvidenceCount;
	}
	// AND THE RUN IT IS FOLLOWING, once Julius has named one. The founder's acceptance is that the Mission
	// Contract follows the EXACT runId Julius returned, so it is recorded verbatim and never synthesised.
	if (RunId.bKnown)
	{
		Task->RunId = RunId;
	}
	// AND WHAT JULIUS CALLED THE STATE, so an unmapped one shows as itself rather than as Draft.
	if (JuliusState.bKnown)
	{
		Task->JuliusState = JuliusState;
	}
	// A CONTRACT JULIUS IS WORKING IS AN ACTIVE TASK, which is exactly what the orb is a visualisation of. The
	// founder's rule reads "ACTIVE TASK(S) -> their appropriate orb presentation may remain visible", so a live
	// report reopens the task if it was closed -- and a finished state is handled by ShouldPresentOrb.
	if (!Task->bInWorkspace && State != EWonderlandTaskState::Completed && State != EWonderlandTaskState::Failed
		&& State != EWonderlandTaskState::Cancelled)
	{
		Task->bInWorkspace = true;
		if (!Selected.IsValid()) { Selected = Task->LocalId; }
	}
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

int32 UWonderlandMissionTaskSubsystem::GetRunningCount() const
{
	int32 Running = 0;
	for (const FWonderlandMissionTask& Task : Tasks)
	{
		// RUNNING MEANS JULIUS SAID SO. A locally queued contract is not running however red its orb is, and
		// counting it would be the exact pretence the founder ruled out.
		if (Task.Source != EWonderlandTaskSource::Julius)
		{
			continue;
		}
		switch (Task.State)
		{
		case EWonderlandTaskState::Preparation:
		case EWonderlandTaskState::Research:
		case EWonderlandTaskState::Implementation:
		case EWonderlandTaskState::Verification:
		case EWonderlandTaskState::Review:
		case EWonderlandTaskState::Repair:
			++Running;
			break;
		default:
			break;
		}
	}
	return Running;
}

FGuid UWonderlandMissionTaskSubsystem::FollowJuliusRun(const FString& MissionId, const FWonderlandText& RunId)
{
	if (MissionId.IsEmpty())
	{
		return FGuid();
	}
	FWonderlandMissionTask* Task = Tasks.FindByPredicate(
		[&MissionId](const FWonderlandMissionTask& Row) { return Row.ContractId == MissionId; });
	if (Task == nullptr)
	{
		if (!CanAddTask())
		{
			// REFUSED, NOT SQUEEZED IN. The workspace cap is the founder's and a run arriving from outside does
			// not get to exceed it; the transport can report that it could not be shown.
			UE_LOG(LogTemp, Warning, TEXT("WLTASK cannot follow %s: %d of %d slots already open"),
				*MissionId, GetWorkspaceCount(), GetTaskCapacity());
			return FGuid();
		}
		FWonderlandMissionTask Fresh;
		Fresh.LocalId = FGuid::NewGuid();
		Fresh.CreatedAt = FDateTime::UtcNow();
		Fresh.ContractId = MissionId;
		// THE MISSION ID IS THE HONEST TITLE. A hydration carries no objective -- only the id -- and a
		// plausible invented one would be indistinguishable from something Julius said.
		Fresh.Objective = MissionId;
		// QUEUED, NOT DRAFT. Draft is the local idea of a slot nobody has sent anywhere, and this run exists
		// on a backend already. The real state arrives with the first report; until then the contract says it
		// is waiting, which is true of every run the world has adopted and not yet heard from.
		Touch(Fresh, EWonderlandTaskState::Queued, EWonderlandTaskSource::Julius);
		Tasks.Add(Fresh);
		Task = &Tasks.Last();
		UE_LOG(LogTemp, Display, TEXT("WLTASK following Julius mission %s"), *MissionId);
	}
	// A DIFFERENT RUN ON THE SAME MISSION IS STILL A REPLACEMENT, and the rule is the one ApplySchedulerState
	// applies: what described the old run is forgotten before the new one is recorded.
	if (RunId.bKnown && Task->RunId.bKnown && Task->RunId.Value != RunId.Value)
	{
		Task->JuliusState = FWonderlandText();
		Task->EvidenceCount = FWonderlandTally();
		Task->TokensUsed = FWonderlandTally();
	}
	if (RunId.bKnown)
	{
		Task->RunId = RunId;
	}
	Task->Source = EWonderlandTaskSource::Julius;
	Task->bInWorkspace = true;
	// ---- AND THIS IS NOW THE FOLLOWED CONTRACT, on every call, including one that found an existing task.
	//
	// Without this line the readers pick the first Julius row in insertion order, and because this function
	// APPENDS, a mission created from inside the world lands behind whatever was already there. The transport
	// then follows the new run while every surface names the old one.
	FollowedContractId = MissionId;
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return Task->LocalId;
}

const FWonderlandMissionTask* UWonderlandMissionTaskSubsystem::FindFollowedJuliusTask() const
{
	// THE SAME TEST IN BOTH PLACES, WRITTEN ONCE. Two copies of this predicate would be free to drift, and a
	// preferred lookup that accepted a row the fallback would reject is a defect that only appears once a
	// second mission is adopted -- which is the exact case this function already got wrong once.
	//
	// bInWorkspace, because a task the player has put away is not what a panel should present as running.
	// RunId known and non-empty, because the run id is the thing only a real backend produces: Source alone is
	// satisfied by a Julius task before anything has been dispatched.
	const auto IsLiveJuliusRow = [](const FWonderlandMissionTask& Row)
	{
		return Row.Source == EWonderlandTaskSource::Julius && Row.bInWorkspace && Row.RunId.bKnown
			&& !Row.RunId.Value.IsEmpty();
	};

	// ---- WHAT THIS SESSION WAS LAST ASKED TO FOLLOW, and NOTHING ELSE once something has been asked for.
	//
	// REFUSING BEATS GUESSING HERE, which is the Julius lane's point and it is right. If the followed contract
	// has been put away, or has lost its run, the honest answer is that nothing is being followed -- not some
	// other mission that happens to sit first in the array. Falling back in that case would be the same false
	// statement this function was just fixed for, narrowed to a case nobody had exercised: acceptance #5's
	// A06o switches runs with every task still in the workspace, so the put-away path is untested by it.
	//
	// A surface that reads empty is a surface saying "no mission is running", which is true. A surface naming
	// a mission the player never asked to follow is a surface lying quietly.
	if (!FollowedContractId.IsEmpty())
	{
		for (const FWonderlandMissionTask& Row : Tasks)
		{
			if (Row.ContractId == FollowedContractId && IsLiveJuliusRow(Row))
			{
				return &Row;
			}
		}
		return nullptr;
	}

	// ---- THE FIRST LIVE ROW, ONLY WHEN NOTHING HAS BEEN FOLLOWED THIS SESSION. That is the restored-contract
	// case: contracts came back from disk, the transport has adopted nothing yet, and the panel still has to
	// name something rather than report that nothing is running.
	for (const FWonderlandMissionTask& Row : Tasks)
	{
		if (IsLiveJuliusRow(Row))
		{
			return &Row;
		}
	}
	return nullptr;
}

FString UWonderlandMissionTaskSubsystem::GetFollowedMissionId() const
{
	const FWonderlandMissionTask* Task = FindFollowedJuliusTask();
	return Task != nullptr ? Task->ContractId : FString();
}

FString UWonderlandMissionTaskSubsystem::GetFollowedRunId() const
{
	const FWonderlandMissionTask* Task = FindFollowedJuliusTask();
	return Task != nullptr ? Task->RunId.Value : FString();
}

FString UWonderlandMissionTaskSubsystem::GetFollowedJuliusState() const
{
	const FWonderlandMissionTask* Task = FindFollowedJuliusTask();
	// EMPTY WHEN UNKNOWN, NOT THE MAPPED ENUM'S NAME. A caller asking what Julius called it must be able to
	// tell "Julius said READY" from "this build guessed READY", which is the whole reason JuliusState exists.
	return (Task != nullptr && Task->JuliusState.bKnown) ? Task->JuliusState.Value : FString();
}

EWonderlandTaskState UWonderlandMissionTaskSubsystem::GetFollowedState() const
{
	const FWonderlandMissionTask* Task = FindFollowedJuliusTask();
	return Task != nullptr ? Task->State : EWonderlandTaskState::Draft;
}

bool UWonderlandMissionTaskSubsystem::ResetJuliusCarriers(const FString& ContractId)
{
	if (ContractId.IsEmpty())
	{
		return false;
	}
	FWonderlandMissionTask* Task = Tasks.FindByPredicate(
		[&ContractId](const FWonderlandMissionTask& Row) { return Row.ContractId == ContractId; });
	if (Task == nullptr)
	{
		return false;
	}
	// THE STATE ITSELF IS NOT TOUCHED, and neither is RunId. A hydration is about to state both, and
	// blanking the mapped state would flip the contract to Draft for however long the snapshot takes to
	// arrive -- the exact misleading value JuliusState exists to prevent. Only what DESCRIBES the run is
	// forgotten: what Julius called it, how much evidence, how many tokens.
	Task->JuliusState = FWonderlandText();
	Task->EvidenceCount = FWonderlandTally();
	Task->TokensUsed = FWonderlandTally();
	UE_LOG(LogTemp, Display, TEXT("WLTASK %s adopted a snapshot; its Julius carriers are unknown again"),
		*ContractId);
	SaveContracts();
	BroadcastTasksChanged(ANSI_TO_TCHAR(__FUNCTION__));
	return true;
}

int64 UWonderlandMissionTaskSubsystem::GetTotalTokens() const
{
	int64 Total = -1;
	for (const FWonderlandMissionTask& Task : Tasks)
	{
		// bKnown, not a sign test: the carrier says whether anyone reported, and a reported zero is a real
		// measurement that belongs in the total.
		if (Task.TokensUsed.bKnown)
		{
			Total = (Total < 0 ? 0 : Total) + Task.TokensUsed.Value;
		}
	}
	// STILL -1 IF NOBODY REPORTED ANYTHING. A total of zero beside several contracts would read as a measurement.
	return Total;
}

TArray<FString> UWonderlandMissionTaskSubsystem::DescribeTasks() const
{
	TArray<FString> Lines;
	const int64 Total = GetTotalTokens();
	Lines.Add(FString::Printf(TEXT("MISSION CONTRACTS  %d of %d  ·  %d running (Julius-reported)  ·  total tokens %s"),
		Tasks.Num(), GetTaskCapacity(), GetRunningCount(),
		Total < 0 ? TEXT("not reported") : *FString::Printf(TEXT("%lld"), Total)));
	for (int32 Index = 0; Index < Tasks.Num(); ++Index)
	{
		const FWonderlandMissionTask& Task = Tasks[Index];
		Lines.Add(FString::Printf(TEXT("  %d %s %-14s %-8s %-10s %s%s"),
			Index,
			Task.LocalId == Selected ? TEXT("*") : TEXT(" "),
			WonderlandTaskStateName(Task.State),
			WonderlandTaskIsContract(Task.State) ? TEXT("RED") : TEXT("GRAY"),
			Task.Source == EWonderlandTaskSource::Julius ? TEXT("julius") : TEXT("local"),
			Task.ContractId.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("[%s] "), *Task.ContractId),
			Task.Objective.IsEmpty() ? TEXT("(no task entered)") : *FWonderlandCardStore::MaskForDisplay(Task.Objective).Left(58)));
	}
	return Lines;
}

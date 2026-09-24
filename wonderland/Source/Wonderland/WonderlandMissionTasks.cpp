#include "WonderlandMissionTasks.h"

#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/App.h"

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
			for (int32 Value = 0; Value <= static_cast<int32>(EWonderlandTaskState::Paused); ++Value)
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
	OnTasksChanged.Broadcast();
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
	const bool bWrote = UGameplayStatics::SaveGameToSlot(Save, SaveSlotName(), 0);
	UE_LOG(LogTemp, Verbose, TEXT("WLTASK saved %d contract(s): %s"),
		Save->Contracts.Num(), bWrote ? TEXT("ok") : TEXT("FAILED"));
	return bWrote;
}

int32 UWonderlandMissionTaskSubsystem::RestoreContracts()
{
	if (!HasSavedContracts())
	{
		return 0;
	}
	UWonderlandMissionTaskSave* Save = Cast<UWonderlandMissionTaskSave>(
		UGameplayStatics::LoadGameFromSlot(SaveSlotName(), 0));
	if (Save == nullptr || Save->Version != 1)
	{
		// REFUSED, NOT GUESSED AT. A file of a shape this build does not know is left alone rather than read as
		// though it were this one; a misread contract is worse than a forgotten one.
		UE_LOG(LogTemp, Warning, TEXT("WLTASK saved contracts are version %d, not 1; leaving them alone"),
			Save != nullptr ? Save->Version : -1);
		return 0;
	}
	const FString When = FDateTime::UtcNow().ToIso8601();
	int32 Restored = 0;
	for (const FWonderlandMissionTask& Saved : Save->Contracts)
	{
		if (!WonderlandTaskIsContract(Saved.State))
		{
			// Belt and braces: a draft should never have been written, and is not read back if one ever is.
			continue;
		}
		if (Tasks.Num() >= GetTaskCapacity())
		{
			UE_LOG(LogTemp, Warning, TEXT("WLTASK capacity %d reached while restoring; %d contract(s) left on disk"),
				GetTaskCapacity(), Save->Contracts.Num() - Restored);
			break;
		}
		FWonderlandMissionTask Task = Saved;
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
	if (Restored > 0)
	{
		UE_LOG(LogTemp, Display, TEXT("WLTASK restored %d Mission Contract(s); none is running until Julius says so"),
			Restored);
		OnTasksChanged.Broadcast();
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
	OnTasksChanged.Broadcast();
	return Task.LocalId;
}

bool UWonderlandMissionTaskSubsystem::SubmitDraft(FGuid LocalId, const FString& Objective)
{
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
	Task->Objective = Trimmed;
	// QUEUED, AND LOCAL, BECAUSE THAT IS THE TRUTH IN THIS BUILD. No Julius link reaches this world, so the contract
	// is real and waiting, and the source says who said so. When a scheduler exists it reports through
	// ApplySchedulerState and this same task moves on -- nothing in the presentation has to change to believe it.
	Touch(*Task, EWonderlandTaskState::Queued, EWonderlandTaskSource::Local);
	UE_LOG(LogTemp, Display, TEXT("WLTASK contract accepted, QUEUED (local: Julius has not acknowledged it)"));
	// GRAY BECOMING RED IS THE MOMENT SOMETHING WORTH KEEPING EXISTS, so this is the first write.
	SaveContracts();
	OnTasksChanged.Broadcast();
	return true;
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
	OnTasksChanged.Broadcast();
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
	UE_LOG(LogTemp, Display, TEXT("WLTASK tab closed: '%s' stays a %s contract, out of the workspace"),
		*Task->Objective.Left(40), WonderlandTaskStateName(Task->State));
	SaveContracts();
	OnTasksChanged.Broadcast();
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
	OnTasksChanged.Broadcast();
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
	return Task->State != EWonderlandTaskState::Completed && Task->State != EWonderlandTaskState::Failed;
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
	OnTasksChanged.Broadcast();
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
	Task->EvidenceCount = FMath::Max(Task->EvidenceCount, EvidenceIds.Num());
	UE_LOG(LogTemp, Display, TEXT("WLTASK %s reported %d evidence reference(s)"), *ContractId, EvidenceIds.Num());
	SaveContracts();
	OnTasksChanged.Broadcast();
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
	OnTasksChanged.Broadcast();
	return true;
}

bool UWonderlandMissionTaskSubsystem::ApplySchedulerState(
	const FString& ContractId, EWonderlandTaskState State, int64 TokensUsed, int32 EvidenceCount)
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
	Touch(*Task, State, EWonderlandTaskSource::Julius);
	Task->TokensUsed = TokensUsed;
	Task->EvidenceCount = EvidenceCount;
	// A CONTRACT JULIUS IS WORKING IS AN ACTIVE TASK, which is exactly what the orb is a visualisation of. The
	// founder's rule reads "ACTIVE TASK(S) -> their appropriate orb presentation may remain visible", so a live
	// report reopens the task if it was closed -- and a finished state is handled by ShouldPresentOrb.
	if (!Task->bInWorkspace && State != EWonderlandTaskState::Completed && State != EWonderlandTaskState::Failed)
	{
		Task->bInWorkspace = true;
		if (!Selected.IsValid()) { Selected = Task->LocalId; }
	}
	SaveContracts();
	OnTasksChanged.Broadcast();
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

int64 UWonderlandMissionTaskSubsystem::GetTotalTokens() const
{
	int64 Total = -1;
	for (const FWonderlandMissionTask& Task : Tasks)
	{
		if (Task.TokensUsed >= 0)
		{
			Total = (Total < 0 ? 0 : Total) + Task.TokensUsed;
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
			Task.Objective.IsEmpty() ? TEXT("(no task entered)") : *Task.Objective.Left(58)));
	}
	return Lines;
}

#include "WonderlandMissionTasks.h"

#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"

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
		UE_LOG(LogTemp, Warning, TEXT("WLTASK refused a new slot: %d of %d already open"), Tasks.Num(), GetTaskCapacity());
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
	OnTasksChanged.Broadcast();
	return true;
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

// JULIUS RUN STATE -> THE MISSION CONTRACT'S TASK STATE, IN THE ENGINE.
//
// The C++ half of src/relay/mission/wonderland/wonderland-julius-task-state.ts. Julius reports a run's state as one
// of its thirteen JULIUS_MISSION_STATES; the Mission Contract shows one of EWonderlandTaskState's fourteen. This is
// the one place the engine turns the first into the second, and it is a TABLE rather than a switch so that
// wonderland-julius-task-state.test.ts can read it straight out of this header and fail if it ever disagrees with
// the TypeScript map, entry for entry.
//
// The rules the table keeps, each of them a founder decision:
//   CREATED and READY are Queued, never running -- a mission created over the bridge is dispatched:false.
//   BLOCKED is Blocked, not Paused; WAITING is Waiting, not running; CANCELLED is Cancelled, not Failed.
//   Only Julius's own COMPLETED reaches Completed.
//   Julius never produces Draft (local only) or Research (Julius has no research phase).
//
// A state this build does not know is NOT guessed at: the lookup says it did not know, and the caller shows Unknown.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandMissionTasks.h"

namespace WonderlandJuliusTaskState
{
	struct FEntry
	{
		const TCHAR* JuliusState;
		EWonderlandTaskState TaskState;
	};

	// WONDERLAND_JULIUS_TASK_STATE_TABLE_BEGIN -- parsed by wonderland-julius-task-state.test.ts; keep one entry per line.
	inline constexpr FEntry Table[] = {
		{ TEXT("CREATED"),   EWonderlandTaskState::Queued },
		{ TEXT("READY"),     EWonderlandTaskState::Queued },
		{ TEXT("PLANNING"),  EWonderlandTaskState::Preparation },
		{ TEXT("EXECUTING"), EWonderlandTaskState::Implementation },
		{ TEXT("WAITING"),   EWonderlandTaskState::Waiting },
		{ TEXT("REVIEWING"), EWonderlandTaskState::Review },
		{ TEXT("REPAIRING"), EWonderlandTaskState::Repair },
		{ TEXT("VERIFYING"), EWonderlandTaskState::Verification },
		{ TEXT("BLOCKED"),   EWonderlandTaskState::Blocked },
		{ TEXT("PAUSED"),    EWonderlandTaskState::Paused },
		{ TEXT("FAILED"),    EWonderlandTaskState::Failed },
		{ TEXT("COMPLETED"), EWonderlandTaskState::Completed },
		{ TEXT("CANCELLED"), EWonderlandTaskState::Cancelled },
	};
	// WONDERLAND_JULIUS_TASK_STATE_TABLE_END

	/**
	 * The Mission Contract state for what Julius reported. False when this build does not know the state -- a newer
	 * Julius can send one it was never taught -- and OutState is then untouched, so the caller keeps showing what it
	 * had rather than a guess. The comparison is exact: "completed" is not COMPLETED.
	 */
	inline bool TaskStateForJuliusState(const FString& JuliusState, EWonderlandTaskState& OutState)
	{
		for (const FEntry& Entry : Table)
		{
			if (JuliusState.Equals(Entry.JuliusState, ESearchCase::CaseSensitive))
			{
				OutState = Entry.TaskState;
				return true;
			}
		}
		return false;
	}
}

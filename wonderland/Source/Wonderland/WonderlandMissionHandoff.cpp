// Copyright Wonderland. MISSION HANDOFF state. See WonderlandMissionHandoff.h.
#include "WonderlandMissionHandoff.h"

#include "Misc/Paths.h"
#include "WonderlandBeta.h"

namespace
{
	const TCHAR* const RecordFormat = TEXT("wonderland.handoff.v1");
	constexpr int64 MaxRecordBytes = 4 * 1024;

	// The spy's counters: function-local, so no static of this file runs before the engine is up.
	int32& ScopeDepth()
	{
		static int32 Depth = 0;
		return Depth;
	}
	int32& Mutations()
	{
		static int32 Count = 0;
		return Count;
	}
	FString& LastMutation()
	{
		static FString Last;
		return Last;
	}
}

FString FWonderlandMissionHandoff::DefaultPath()
{
	return FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Wonderland"), TEXT("MissionHandoff.sav"));
}

FWonderlandMissionHandoff::FWonderlandMissionHandoff(const FString& InPath)
	: Path(InPath)
{
}

const TCHAR* FWonderlandMissionHandoff::StateName(EWonderlandHandoffState InState)
{
	switch (InState)
	{
	case EWonderlandHandoffState::Acknowledged: return TEXT("ACKNOWLEDGED");
	case EWonderlandHandoffState::Transforming: return TEXT("TRANSFORMING");
	case EWonderlandHandoffState::Delivering: return TEXT("DELIVERING");
	case EWonderlandHandoffState::Held: return TEXT("HELD");
	case EWonderlandHandoffState::Returning: return TEXT("RETURNING");
	default: return TEXT("IDLE");
	}
}

FWonderlandMissionHandoff::FScope::FScope()
{
	++ScopeDepth();
}

FWonderlandMissionHandoff::FScope::~FScope()
{
	--ScopeDepth();
}

bool FWonderlandMissionHandoff::IsInScope()
{
	return ScopeDepth() > 0;
}

void FWonderlandMissionHandoff::NoteMutation(const TCHAR* What)
{
	if (ScopeDepth() > 0)
	{
		++Mutations();
		LastMutation() = What != nullptr ? What : TEXT("?");
		UE_LOG(LogTemp, Warning, TEXT("WLHANDOFF a mission/task write ran inside the handoff path: %s"), *LastMutation());
	}
}

int32 FWonderlandMissionHandoff::GetMutationsInScope()
{
	return Mutations();
}

FString FWonderlandMissionHandoff::GetLastMutationInScope()
{
	return LastMutation();
}

void FWonderlandMissionHandoff::ResetSpy()
{
	Mutations() = 0;
	LastMutation().Reset();
}

void FWonderlandMissionHandoff::SetState(EWonderlandHandoffState Next)
{
	if (Next == State)
	{
		return;
	}
	UE_LOG(LogTemp, Display, TEXT("WLHANDOFF %s -> %s | object %s | mission %s | entry %s"), StateName(State), StateName(Next),
		ObjectId.IsEmpty() ? TEXT("-") : *ObjectId, MissionId.IsEmpty() ? TEXT("none") : *MissionId,
		Entry == EWonderlandHandoffEntry::MidMission ? TEXT("mid-mission") : TEXT("roaming"));
	const bool bWasRecorded = IsRecordedEquipped();
	const EWonderlandHandoffState Was = State;
	State = Next;
	PhaseSeconds = 0.0f;
	bEndHeld = false;
	// THE RECORD FOLLOWS THE EQUIPPED STATE: written when a handoff begins, cleared the moment the return BEGINS. A restart
	// in the middle of a transformation restores HELD, as the founder's reconnect rule asks; a restart during the return
	// does not bring back swords the user already gave back.
	if (bWasRecorded != IsRecordedEquipped())
	{
		Persist();
	}
	// INSIDE THE SCOPE: every caller of SetState holds an FScope, so whatever a listener does is on the spy's books
	FScope Scope;
	OnStateChanged.Broadcast(Was, State);
}

bool FWonderlandMissionHandoff::Persist() const
{
	if (bReadOnly)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLHANDOFF not remembered this session: the record could not be set aside, so it is never overwritten"));
		return false;
	}
	const FString Text = FString::Printf(TEXT("%s\nequipped=%d\nobject=%s\nmission=%s\nentry=%s\n"), RecordFormat, IsRecordedEquipped() ? 1 : 0,
		ObjectId.IsEmpty() ? TEXT("-") : *ObjectId, MissionId.IsEmpty() ? TEXT("-") : *MissionId,
		Entry == EWonderlandHandoffEntry::MidMission ? TEXT("mid_mission") : TEXT("roaming"));
	return WonderlandBeta::SaveSealedText(Path, Text);
}

FString FWonderlandMissionHandoff::Refuse(const FString& Why)
{
	const FString Aside = WonderlandBeta::SetAsideRefusedSave(Path);
	if (Aside.IsEmpty())
	{
		// THE ORIGINAL STAYS UNTOUCHED: a record that cannot be moved aside must not be overwritten by the next write either
		bReadOnly = true;
		return FString::Printf(TEXT("%s, and it could not be set aside; not equipped, and the handoff is not remembered this session"), *Why);
	}
	return FString::Printf(TEXT("%s; set aside as %s; not equipped"), *Why, *FPaths::GetCleanFilename(Aside));
}

bool FWonderlandMissionHandoff::IsKnownForm(const FString& InObjectId)
{
	// One place for the list: the C.A.R.D. store and the record both check against it.
	static const TCHAR* const Forms[] = { TEXT("angelic_twin_swords") };
	for (const TCHAR* Form : Forms)
	{
		if (InObjectId == Form)
		{
			return true;
		}
	}
	return false;
}

void FWonderlandMissionHandoff::Load(TFunctionRef<bool(const FString& MissionId)> MissionStillActive)
{
	State = EWonderlandHandoffState::Idle;
	Entry = EWonderlandHandoffEntry::Roaming;
	ObjectId.Reset();
	MissionId.Reset();
	PhaseSeconds = 0.0f;
	bEndHeld = false;
	LoadNote.Reset();
	bReadOnly = false;
	WonderlandBeta::RecoverInterruptedSave(Path);
	FString Text;
	FString Why;
	if (!WonderlandBeta::LoadSealedText(Path, MaxRecordBytes, Text, Why))
	{
		if (!Why.IsEmpty())
		{
			LoadNote = Refuse(FString::Printf(TEXT("the handoff record could not be used (%s)"), *Why));
			UE_LOG(LogTemp, Warning, TEXT("WLHANDOFF %s"), *LoadNote);
		}
		return;
	}
	TArray<FString> Lines;
	Text.ParseIntoArrayLines(Lines);
	TMap<FString, FString> Fields;
	for (int32 Index = 1; Index < Lines.Num(); ++Index)
	{
		FString Key;
		FString Value;
		if (Lines[Index].Split(TEXT("="), &Key, &Value))
		{
			Fields.Add(Key, Value);
		}
	}
	const FString* Equipped = Fields.Find(TEXT("equipped"));
	const FString* Object = Fields.Find(TEXT("object"));
	const FString* Mission = Fields.Find(TEXT("mission"));
	const FString* InEntry = Fields.Find(TEXT("entry"));
	if (Lines.Num() == 0 || Lines[0] != RecordFormat || Equipped == nullptr || Object == nullptr || Mission == nullptr || InEntry == nullptr)
	{
		LoadNote = Refuse(FString::Printf(TEXT("the handoff record is sealed but not a %s record"), RecordFormat));
		UE_LOG(LogTemp, Warning, TEXT("WLHANDOFF %s"), *LoadNote);
		return;
	}
	if (*Equipped != TEXT("1"))
	{
		return;
	}
	// A FORM THIS BUILD DOES NOT HAVE (a newer build's, or a hand edit) is never restored as something to hold
	if (!WonderlandBeta::IsSafeId(*Object) || !IsKnownForm(*Object))
	{
		LoadNote = TEXT("the handoff record names a Mission Handoff form this build does not have; not equipped");
		UE_LOG(LogTemp, Warning, TEXT("WLHANDOFF %s"), *LoadNote);
		return;
	}
	ObjectId = *Object;
	Entry = *InEntry == TEXT("mid_mission") ? EWonderlandHandoffEntry::MidMission : EWonderlandHandoffEntry::Roaming;
	if (*Mission != TEXT("-") && WonderlandBeta::IsSafeId(*Mission) && MissionStillActive(*Mission))
	{
		MissionId = *Mission;
	}
	else if (*Mission != TEXT("-"))
	{
		// THE MISSION IS GONE (it ended, or a restart ended a simulated fixture): roaming, attachment cleared, nothing invented
		LoadNote = TEXT("the mission it was attached to is no longer running; restored as roaming");
		Entry = EWonderlandHandoffEntry::Roaming;
	}
	State = EWonderlandHandoffState::Held;
	UE_LOG(LogTemp, Display, TEXT("WLHANDOFF restored HELD | object %s | mission %s%s"), *ObjectId, MissionId.IsEmpty() ? TEXT("none") : *MissionId,
		LoadNote.IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" | %s"), *LoadNote));
}

bool FWonderlandMissionHandoff::Begin(const FString& InObjectId, const FString& InMissionId, EWonderlandHandoffEntry InEntry,
	const FCompanionsPresent& Companions, FString& OutWhy)
{
	FScope Scope;
	if (IsEquipped())
	{
		OutWhy = TEXT("the Mission Handoff is already active");
		return false;
	}
	if (!WonderlandBeta::IsSafeId(InObjectId) || !IsKnownForm(InObjectId))
	{
		OutWhy = TEXT("the active C.A.R.D. names no Mission Handoff form this build has");
		return false;
	}
	if (!InMissionId.IsEmpty() && !WonderlandBeta::IsSafeId(InMissionId))
	{
		OutWhy = TEXT("the running mission has no usable id");
		return false;
	}
	// THE BODIES ARE THE SOURCE OF THE SWORDS. Without both companions in the world there is nothing to transform; the
	// provider's state (SIMULATED until the founder connects one) is not the gate.
	if (!Companions.bLeft || !Companions.bRight)
	{
		OutWhy = FString::Printf(TEXT("the companions are not here to transform (%s missing)"),
			!Companions.bLeft && !Companions.bRight ? TEXT("both") : (!Companions.bLeft ? TEXT("the LLM Companion") : TEXT("Jhinn")));
		return false;
	}
	ObjectId = InObjectId;
	MissionId = InMissionId;
	Entry = InEntry;
	SetState(EWonderlandHandoffState::Acknowledged);
	return true;
}

bool FWonderlandMissionHandoff::Return(FString& OutWhy)
{
	FScope Scope;
	if (State != EWonderlandHandoffState::Held)
	{
		OutWhy = State == EWonderlandHandoffState::Idle ? TEXT("no Mission Handoff is active") : TEXT("the swords are still forming");
		return false;
	}
	SetState(EWonderlandHandoffState::Returning);
	return true;
}

void FWonderlandMissionHandoff::DetachMission(const FString& EndedMissionId)
{
	FScope Scope;
	if (IsEquipped() && !MissionId.IsEmpty() && MissionId == EndedMissionId)
	{
		UE_LOG(LogTemp, Display, TEXT("WLHANDOFF the mission %s ended; the swords stay, roaming"), *MissionId);
		MissionId.Reset();
		Entry = EWonderlandHandoffEntry::Roaming;
		Persist();
	}
}

void FWonderlandMissionHandoff::AttachMission(const FString& NewMissionId)
{
	FScope Scope;
	if (IsEquipped() && WonderlandBeta::IsSafeId(NewMissionId) && NewMissionId != MissionId)
	{
		UE_LOG(LogTemp, Display, TEXT("WLHANDOFF a mission started while equipped: attached to %s, its presentation detached (was %s)"),
			*NewMissionId, MissionId.IsEmpty() ? TEXT("none") : *MissionId);
		MissionId = NewMissionId;
		Persist();
	}
}

bool FWonderlandMissionHandoff::EndHeld(float Length)
{
	if (PhaseSeconds < Length)
	{
		return false;
	}
	// EVERY PHASE SHOWS ITS END BEFORE THE NEXT BEGINS: the first tick past its length holds the phase AT its length, so the presentation
	// draws its last pose once -- the companions whole, the swords gone -- and the next tick moves on from exactly that pose
	if (!bEndHeld)
	{
		PhaseSeconds = Length;
		bEndHeld = true;
		return false;
	}
	return true;
}

bool FWonderlandMissionHandoff::Tick(float DeltaSeconds)
{
	FScope Scope;
	if (State == EWonderlandHandoffState::Idle || State == EWonderlandHandoffState::Held)
	{
		return false;
	}
	PhaseSeconds += FMath::Clamp(DeltaSeconds, 0.0f, MaxPhaseStepSeconds);
	const EWonderlandHandoffState Before = State;
	switch (State)
	{
	case EWonderlandHandoffState::Acknowledged:
		if (EndHeld(AcknowledgeSeconds)) { SetState(EWonderlandHandoffState::Transforming); }
		break;
	case EWonderlandHandoffState::Transforming:
		if (EndHeld(TransformSeconds)) { SetState(EWonderlandHandoffState::Delivering); }
		break;
	case EWonderlandHandoffState::Delivering:
		if (EndHeld(DeliverSeconds)) { SetState(EWonderlandHandoffState::Held); }
		break;
	case EWonderlandHandoffState::Returning:
		if (EndHeld(ReturnSeconds))
		{
			SetState(EWonderlandHandoffState::Idle);
			ObjectId.Reset();
			MissionId.Reset();
			Entry = EWonderlandHandoffEntry::Roaming;
		}
		break;
	default:
		break;
	}
	return State != Before;
}

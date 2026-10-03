// Copyright Wonderland. MISSION HANDOFF, ORCHESTRATED. See WonderlandHandoffDirector.h.
#include "WonderlandHandoffDirector.h"

#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "WonderlandCard.h"
#include "WonderlandCompanionEmbodiment.h"
#include "WonderlandCompanionSubsystem.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandSidekicks.h"

namespace
{
	UWonderlandSidekickSubsystem* SidekicksFor(const ULocalPlayer* Player)
	{
		UGameInstance* Instance = Player != nullptr ? Player->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandSidekickSubsystem>() : nullptr;
	}

	/** A companion is THERE when its body exists and shows: a hidden or dying body has nothing to become a sword. */
	bool Shows(const AWonderlandCompanionEmbodiment* Body)
	{
		return Body != nullptr && !Body->IsActorBeingDestroyed() && !Body->IsHidden();
	}

	const TCHAR* EntryWord(EWonderlandHandoffEntry Entry)
	{
		return Entry == EWonderlandHandoffEntry::MidMission ? TEXT("mid-mission") : TEXT("roaming");
	}
}

FWonderlandMissionHandoff* WonderlandHandoffDirector::StateFor(const ULocalPlayer* Player)
{
	UWonderlandSidekickSubsystem* Sidekicks = SidekicksFor(Player);
	return Sidekicks != nullptr ? &Sidekicks->GetMissionHandoff() : nullptr;
}

FWonderlandMissionHandoff::FCompanionsPresent WonderlandHandoffDirector::ReadCompanions(const ULocalPlayer* Player)
{
	FWonderlandMissionHandoff::FCompanionsPresent Present;
	const UWonderlandCompanionSubsystem* Companions = Player != nullptr ? Player->GetSubsystem<UWonderlandCompanionSubsystem>() : nullptr;
	if (Companions != nullptr)
	{
		// 0 is the LLM Companion (LEFT), 1 the Jhinn (RIGHT): the companion subsystem's own order and the founder's sides
		Present.bLeft = Shows(Companions->GetEmbodiment(0));
		Present.bRight = Shows(Companions->GetEmbodiment(1));
	}
	return Present;
}

bool WonderlandHandoffDirector::Equip(ULocalPlayer* Player, FString& OutSaid)
{
	UWonderlandSidekickSubsystem* Sidekicks = SidekicksFor(Player);
	if (Sidekicks == nullptr)
	{
		OutSaid = TEXT("Mission Handoff is not available in this world.");
		return false;
	}
	FWonderlandMissionHandoff& State = Sidekicks->GetMissionHandoff();
	const UWonderlandMissionSubsystem* Mission = Player->GetSubsystem<UWonderlandMissionSubsystem>();
	// ENTRY B WHILE THE ANIMATION RUNS, ENTRY A OTHERWISE. Read, never written: the running mission's id is only what the
	// handoff is ATTACHED to (and with none running, nothing is attached and nothing is created).
	const bool bMidMission = Mission != nullptr && Mission->IsMissionAnimationRunning();
	const FString MissionId = Mission != nullptr ? Mission->GetRunningMissionId() : FString();
	const FWonderlandCard& Card = Sidekicks->GetCardStore().GetActive();
	FString Why;
	if (!State.Begin(Card.MissionHandoff, MissionId, bMidMission ? EWonderlandHandoffEntry::MidMission : EWonderlandHandoffEntry::Roaming,
		ReadCompanions(Player), Why))
	{
		OutSaid = FString::Printf(TEXT("Mission Handoff not started: %s."), *Why);
		UE_LOG(LogTemp, Display, TEXT("WLHANDOFF equip refused: %s"), *Why);
		return false;
	}
	// WHAT IS SAID FOLLOWS WHAT IS TRUE (the founder's /handoff canon, 10-03): a mission running while its animation is not showing still
	// carries on and is still followed -- "no mission is running" is said only when none is
	OutSaid = bMidMission
		? FString::Printf(TEXT("MISSION HANDOFF. You leave the mission's animation and roam; the mission carries on (%s), and this terminal, the strip and the "
			"companions' consoles keep following it. Faster roaming; double-tap W or Up to dash. /handoff again gives the swords back."),
			MissionId.IsEmpty() ? TEXT("a mission") : *MissionId)
		: !MissionId.IsEmpty()
		? FString::Printf(TEXT("MISSION HANDOFF. The mission carries on (%s), and this terminal, the strip and the companions' consoles keep following it. "
			"Faster roaming; double-tap W or Up to dash. /handoff again gives the swords back."), *MissionId)
		: FString(TEXT("MISSION HANDOFF. No mission is running, so nothing mission-shaped was started: this is your roaming form. Faster roaming; "
			"double-tap W or Up to dash. /handoff again gives the swords back."));
	UE_LOG(LogTemp, Display, TEXT("WLHANDOFF equip: %s, form %s (C.A.R.D. %s), mission %s"), EntryWord(State.GetEntry()), *Card.MissionHandoff, *Card.Id,
		MissionId.IsEmpty() ? TEXT("none") : *MissionId);
	return true;
}

bool WonderlandHandoffDirector::Return(ULocalPlayer* Player, FString& OutSaid)
{
	FWonderlandMissionHandoff* State = StateFor(Player);
	if (State == nullptr)
	{
		OutSaid = TEXT("Mission Handoff is not available in this world.");
		return false;
	}
	const bool bWithMission = !State->GetMissionId().IsEmpty();
	FString Why;
	if (!State->Return(Why))
	{
		OutSaid = FString::Printf(TEXT("The swords stay: %s."), *Why);
		return false;
	}
	OutSaid = bWithMission
		? FString(TEXT("The swords become the companions again, and the mission's animation picks up where the mission is now -- nothing replayed."))
		: FString(TEXT("The swords become the companions again."));
	UE_LOG(LogTemp, Display, TEXT("WLHANDOFF return: the swords given back%s"), bWithMission ? TEXT(" mid-mission") : TEXT(""));
	return true;
}

FString WonderlandHandoffDirector::Describe(const ULocalPlayer* Player)
{
	const FWonderlandMissionHandoff* State = StateFor(Player);
	if (State == nullptr)
	{
		return TEXT("Mission Handoff is not available in this world.");
	}
	if (!State->IsEquipped())
	{
		const FWonderlandMissionHandoff::FCompanionsPresent Present = ReadCompanions(Player);
		return Present.bLeft && Present.bRight
			? FString(TEXT("Mission Handoff: ready. /handoff takes the swords up."))
			: FString::Printf(TEXT("Mission Handoff: unavailable -- the companions are not here to transform (LLM Companion %s, Jhinn %s)."),
				Present.bLeft ? TEXT("here") : TEXT("missing"), Present.bRight ? TEXT("here") : TEXT("missing"));
	}
	return FString::Printf(TEXT("Mission Handoff: %s, %s, mission %s%s."), FWonderlandMissionHandoff::StateName(State->GetState()), EntryWord(State->GetEntry()),
		State->GetMissionId().IsEmpty() ? TEXT("none") : *State->GetMissionId(),
		State->GetLoadNote().IsEmpty() ? TEXT("") : *FString::Printf(TEXT(" (%s)"), *State->GetLoadNote()));
}

void WonderlandHandoffDirector::HandleTerminalLine(ULocalPlayer* Player, const FString& Argument, FString& OutSaid, bool& bOutCloseTerminal)
{
	bOutCloseTerminal = false;
	const FString Word = Argument.TrimStartAndEnd().ToLower();
	const FWonderlandMissionHandoff* State = StateFor(Player);
	if (Word == TEXT("status"))
	{
		OutSaid = Describe(Player);
		return;
	}
	if (Word == TEXT("return") || Word == TEXT("off"))
	{
		Return(Player, OutSaid);
		return;
	}
	if (!Word.IsEmpty() && Word != TEXT("on"))
	{
		OutSaid = TEXT("/handoff takes the swords up (or gives them back); /handoff return gives them back; /handoff status says where things stand.");
		return;
	}
	// `/handoff` ON ITS OWN IS THE ONE ACTION: up when the companions are companions, back when the swords are held
	if (State != nullptr && State->IsArmed() && Word.IsEmpty())
	{
		Return(Player, OutSaid);
		return;
	}
	bOutCloseTerminal = Equip(Player, OutSaid);
}

#if !UE_BUILD_SHIPPING
namespace
{
	ULocalPlayer* ConsolePlayer(UWorld* World)
	{
		return World != nullptr ? World->GetFirstLocalPlayerFromController() : nullptr;
	}

	/** For Second's real-input runs and the founder's own checks: the terminal's path, with no terminal in the way. */
	FAutoConsoleCommandWithWorldAndArgs GHandoffEquipCommand(
		TEXT("wl.Handoff.Equip"),
		TEXT("Mission Handoff: take up the swords, exactly as the Live Terminal's /handoff does (not in shipping builds)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			FString Said;
			WonderlandHandoffDirector::Equip(ConsolePlayer(World), Said);
			UE_LOG(LogTemp, Display, TEXT("WLHANDOFF wl.Handoff.Equip: %s"), *Said);
		}));

	FAutoConsoleCommandWithWorldAndArgs GHandoffReturnCommand(
		TEXT("wl.Handoff.Return"),
		TEXT("Mission Handoff: give the swords back, exactly as the Live Terminal's /handoff return does (not in shipping builds)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			FString Said;
			WonderlandHandoffDirector::Return(ConsolePlayer(World), Said);
			UE_LOG(LogTemp, Display, TEXT("WLHANDOFF wl.Handoff.Return: %s"), *Said);
		}));

	FAutoConsoleCommandWithWorldAndArgs GHandoffStatusCommand(
		TEXT("wl.Handoff.Status"),
		TEXT("Mission Handoff: one line on the state, the form, the attached mission and the entry (not in shipping builds)."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UE_LOG(LogTemp, Display, TEXT("WLHANDOFF status: %s"), *WonderlandHandoffDirector::Describe(ConsolePlayer(World)));
		}));
}
#endif

// Copyright Wonderland. MISSION HANDOFF: the state behind the companions becoming the user's twin swords.
#pragma once

#include "CoreMinimal.h"
#include "Templates/Function.h"

/**
 * MISSION HANDOFF (founder, 2026-10-02, CANONICAL). It exists for the user who does NOT want to stay inside the
 * mission's animation sequence while Julius and the AI components work.
 *
 * - Entry A, ROAMING: equip any time. With an active mission, the mission continues in the background. With NONE, the
 *   handoff is visual only and NOTHING mission-shaped is created.
 * - Entry B, MID-MISSION: at ANY point of the player-facing animation. The presentation is EXITED (never waited out),
 *   the companions become the swords, control returns. The mission contract, Julius runtime/task state, Project Brain,
 *   approvals, reviewer, budget and provider state are all left exactly as they were: this object writes NONE of them.
 * - The sides never swap: the LLM Companion's GOLD sword in the LEFT hand, Jhinn's CYAN sword in the RIGHT.
 * - Reconnect restores the handoff: the equipped state is persisted, sealed, and comes back HELD without replaying the
 *   transformation.
 *
 * PRESENTATION AND ORCHESTRATION ONLY. The mission's truth stays where it is (MissionTasks / Julius); this object only
 * reads which mission is running. The write spy below proves that: every mission/task mutator reports to it, and inside
 * a handoff scope the count must stay 0.
 *
 * Plain C++ on purpose (the Niagara FName rule, WonderlandBeta.h), owned by UWonderlandSidekickSubsystem.
 */
enum class EWonderlandHandoffState : uint8
{
	/** The companions are companions. */
	Idle,
	/** The terminal has acknowledged the handoff; the companions react. */
	Acknowledged,
	/** Each companion becomes luminous energy and its sword forms from it. */
	Transforming,
	/** The swords fly into the hands. */
	Delivering,
	/** The user holds both swords and roams; the dash is available. */
	Held,
	/** The swords return to being the companions. */
	Returning,
};

enum class EWonderlandHandoffEntry : uint8
{
	Roaming,
	MidMission,
};

class WONDERLAND_API FWonderlandMissionHandoff
{
public:
	/** Saved/Wonderland/MissionHandoff.sav (sealed text). */
	static FString DefaultPath();

	explicit FWonderlandMissionHandoff(const FString& InPath);

	/**
	 * BOOT / RECONNECT. A sealed record of an equipped handoff comes back HELD (no transformation replay). It stays
	 * attached to its mission only if MissionStillActive says that mission still exists; otherwise it is restored as
	 * roaming with the attachment cleared -- nothing is fabricated. A corrupt record is set aside: not equipped.
	 */
	void Load(TFunctionRef<bool(const FString& MissionId)> MissionStillActive);

	EWonderlandHandoffState GetState() const { return State; }
	bool IsEquipped() const { return State != EWonderlandHandoffState::Idle; }
	/**
	 * THE TRAVERSAL STATE (founder, COMBAT STANCE + HIGH-SPEED ROAMING): the attack-ready stance, the speed multiplier and
	 * the dash apply only while the swords are HELD. False the moment the return begins, so none of it outlives a
	 * deactivation.
	 */
	bool IsArmed() const { return State == EWonderlandHandoffState::Held; }
	EWonderlandHandoffEntry GetEntry() const { return Entry; }
	const FString& GetObjectId() const { return ObjectId; }
	/** The mission this handoff is attached to; empty while roaming with no mission. */
	const FString& GetMissionId() const { return MissionId; }
	float GetPhaseSeconds() const { return PhaseSeconds; }
	/** Empty after a clean load; otherwise why the record was set aside or the attachment cleared. */
	const FString& GetLoadNote() const { return LoadNote; }

	/** Whether the two companions' embodiments exist and show (the gate is the bodies, never the provider: V2-2). */
	struct FCompanionsPresent
	{
		bool bLeft = false;
		bool bRight = false;
	};

	/**
	 * Begin a handoff. InMissionId empty = roaming with no mission (allowed, visual only). OutWhy says why it was refused:
	 * already equipped, or a companion body is absent (the transformation would have no source).
	 */
	bool Begin(const FString& InObjectId, const FString& InMissionId, EWonderlandHandoffEntry InEntry, const FCompanionsPresent& Companions,
		FString& OutWhy);
	/** The user returns the swords: Held -> Returning -> Idle. */
	bool Return(FString& OutWhy);
	/** The attached mission ended (completed, failed, cancelled): the swords stay equipped; the attachment clears to roaming. */
	void DetachMission(const FString& EndedMissionId);
	/** A mission started (or restarted) while equipped: it starts DETACHED and the attachment moves to it -- never two. */
	void AttachMission(const FString& NewMissionId);
	/** Advances the timed phases. True when the state changed. */
	bool Tick(float DeltaSeconds);

	/** The phases' lengths: readable and continuous, never a despawn-to-spawn cut. */
	static constexpr float AcknowledgeSeconds = 0.6f;
	static constexpr float TransformSeconds = 1.8f;
	static constexpr float DeliverSeconds = 0.9f;
	static constexpr float ReturnSeconds = 1.4f;

	static const TCHAR* StateName(EWonderlandHandoffState InState);

	/**
	 * THE WRITE SPY (Second's B3). FScope marks the handoff path (every tick and transition runs inside one). Every
	 * mission/task mutator calls NoteMutation; one that runs inside a scope is counted -- and the count must stay 0.
	 * The QA's positive control calls NoteMutation inside a scope on purpose and expects the count to move, so a spy that
	 * never counts cannot pass as one that saw nothing.
	 */
	class WONDERLAND_API FScope
	{
	public:
		FScope();
		~FScope();
	};
	static bool IsInScope();
	static void NoteMutation(const TCHAR* What);
	static int32 GetMutationsInScope();
	static FString GetLastMutationInScope();
	static void ResetSpy();

private:
	void SetState(EWonderlandHandoffState Next);
	bool Persist() const;

	FString Path;
	EWonderlandHandoffState State = EWonderlandHandoffState::Idle;
	EWonderlandHandoffEntry Entry = EWonderlandHandoffEntry::Roaming;
	FString ObjectId;
	FString MissionId;
	float PhaseSeconds = 0.0f;
	FString LoadNote;
};

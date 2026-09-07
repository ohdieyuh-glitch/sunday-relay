// WONDERLAND — JULIUS, EMBODIED. The state the world animates.
//
// Mirrors `JuliusEmbodiment` in
// src/relay/mission/wonderland/wonderland-julius-state.ts, field for field, and
// wonderland-cpp-parity.test.ts fails when the two drift in either direction.
//
// WHY THIS EXISTS BESIDE FWonderlandWorld. The world document is a SNAPSHOT: it
// says what is true at one instant and carries no history. This struct is the
// FOLD of an event stream — it knows which sequence it has applied, how many
// stale deliveries it rejected and whether the stream had a gap. A renderer
// needs both: the snapshot to draw the world, and this to know whether what it
// is drawing is current.
//
// THE HONESTY RULES, and where each one lives here:
//
//  - UNKNOWN IS NEVER IDLE. EWonderlandJuliusState's ordinal 0 is `Unobserved`,
//    and a default-constructed embodiment therefore says Relay has not spoken
//    rather than claiming an idle agent. Animation defaults to `Dormant` for
//    the same reason: idle patrol is an observed state and dormant is not.
//
//  - A DISCONNECTION IS NEVER A COMPLETION. `bTerminal` is set by the
//    TypeScript reducer only from an event that reports a real ending. Nothing
//    in C++ may set it, which is why it has no setter and arrives only inside a
//    whole applied struct.
//
//  - THE COUNTERS ARE PART OF THE TRUTH. A client that has rejected forty stale
//    events and seen two sequence gaps is in a different situation from one
//    with a clean stream. Hiding that behind a boolean `bHealthy` would make a
//    lossy stream indistinguishable from a good one.
//
// NOTHING HERE DECIDES ANYTHING. There is no member of any struct in this file
// that could express a mission verdict, an approval, or a spend authorization.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandTypes.h"
#include "WonderlandJuliusState.generated.h"

/* ------------------------------------------------------------ the state */

// Mirrors JULIUS_VISUAL_STATES. What Julius is DOING, in the product's own
// words — never which provider happens to occupy a role slot.
//
// Each member is a bijection partner of one EWonderlandDogActivity, so a
// renderer that has a state also has exactly one activity, one motion and one
// clip, with no branch that could pick two.
UENUM(BlueprintType)
enum class EWonderlandJuliusState : uint8
{
	// Ordinal 0. Relay has said nothing. NOT `Idle`.
	Unobserved,
	Idle,
	// Intent received; a role is engaged and none is working yet.
	Attention,
	PromptArchitect,
	Coding,
	// Work product moving between roles. No role is executing.
	Handoff,
	IndependentReview,
	Repair,
	Verifying,
	// The only member that claims a validated, successful ending.
	Complete,
	// Stopped without a fault: a ceiling, a gate, a cancellation.
	Blocked,
	// Stopped by a fault.
	Error
};

// Mirrors JULIUS_STATE_SOURCES. Which link produced the state, most precise
// first — the kernel's own guarded machine, the runtime's persisted phase, or
// the event's name. A renderer may show a precise reading differently from an
// inferred one; it may never present the third as the first.
UENUM(BlueprintType)
enum class EWonderlandJuliusStateSource : uint8
{
	Unobserved,
	JuliusRunState,
	RelayPhase,
	EventType
};

/* -------------------------------------------------------- the embodiment */

// Mirrors JuliusEmbodiment. One Julius instance, as the world holds it.
USTRUCT(BlueprintType)
struct FWonderlandJuliusEmbodiment
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FString SchemaVersion;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FString ProjectId;

	// Null until an event names one. Never invented from a run or worker id.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandText MissionId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandText AgentId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandJuliusState VisualState = EWonderlandJuliusState::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandJuliusStateSource StateSource = EWonderlandJuliusStateSource::Unobserved;

	// The runtime phase behind the state, when one travelled. Text rather than a
	// 28-member enum: nothing in the world switches on a phase, and a mirrored
	// vocabulary nothing reads is a migration cost with no reader.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandText RelayPhase;

	// The raw upstream state string, whatever vocabulary produced it. The same
	// role FWonderlandAgent::WorkspaceState plays: the visual layer collapses
	// distinctions the world has no separate behaviour for, and this means the
	// collapse destroys nothing.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandText SourceState;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandDogActivity Activity = EWonderlandDogActivity::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandDogMotion Motion = EWonderlandDogMotion::Unobserved;

	// `Dormant` whenever the state is unobserved. Never `PatrolWalk`.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandDogAnimation Animation = EWonderlandDogAnimation::Dormant;

	// Null when unobserved — an unknown state neither asks for a human nor rests.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandFlag AttentionRequired;

	// Set by the reducer from a real ending event and by nothing else.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	bool bTerminal = false;

	// A sentence whenever VisualState is Unobserved. Never a bare flag.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandText UnobservedReason;

	// Highest applied project sequence. Resume a stream from exactly this.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 Sequence = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandText ObservedAtIso;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 StaleEventsRejected = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 ForeignProjectEventsRejected = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 ForeignMissionEventsSkipped = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 UnmodelledEventsIgnored = 0;

	// Times the sequence jumped by more than one. Replay is how it is repaired.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 SequenceGapsObserved = 0;
};

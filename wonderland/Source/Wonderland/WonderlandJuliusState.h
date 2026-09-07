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
#include "WonderlandDogAnimation.h"
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

	// Events that arrived IN ORDER and were still refused, because applying them
	// would have taken back a completion the founder already saw. Distinct from
	// StaleEventsRejected on purpose: that counter is about the wire, this one is
	// about a contradiction the wire delivered perfectly.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 UncompletingEventsRefused = 0;

	// Second, DIFFERENT endings refused. A mission that reports completed and
	// then failed is a contradiction, and the first authoritative ending is the
	// one that happened; a world showing whichever landed last would flip its
	// verdict on delivery order.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int64 ContradictoryEndingsRefused = 0;
};

/* -------------------------------------------------------- the animation */

// Mirrors WONDERLAND_ANIMATION_TRANSITIONS. HOW to get from the clip that is
// playing to the one that should be.
//
// This is a CONTRACT rather than a renderer's business because two surfaces draw
// this dog: if each decided its own blend rules, the browser would ease into an
// error the world cut to, and the same mission would feel urgent in one and calm
// in the other.
UENUM(BlueprintType)
enum class EWonderlandAnimationTransition : uint8
{
	// Ordinal 0. The same clip. Do NOT restart it — a looping walk that restarted
	// on every unrelated event twitches once per event, which reads as the world
	// stuttering.
	Hold,
	// From Dormant. The world has just learned what Julius is doing.
	Wake,
	// The ordinary case: one piece of work becoming another.
	CrossFade,
	// A state that needs a person. CUTS, at zero milliseconds. A graceful
	// quarter-second fade into "your agent stopped" is a quarter second spent
	// making the most important frame in the session look like the others.
	Interrupt,
	// Into a real ending. Slower than a cross-fade on purpose: a finish that
	// snaps reads as a failure.
	Settle,
	// Back to no observation. The only transition that REMOVES information, so it
	// is slow and never a cut.
	Dormant
};

// Mirrors WonderlandAnimationPlan. What a renderer should DO at the moment a
// state changes — decided in TypeScript, executed here.
//
// It names no asset. That is what makes the clips replaceable: a real animation
// drops in behind a plan that never mentioned it.
USTRUCT(BlueprintType)
struct FWonderlandAnimationPlan
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FString SchemaVersion;

	// The clip currently playing. Dormant when nothing has been observed.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandDogAnimation From = EWonderlandDogAnimation::Dormant;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandDogAnimation To = EWonderlandDogAnimation::Dormant;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandAnimationTransition Transition = EWonderlandAnimationTransition::Hold;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	int32 BlendMs = 0;

	// Whether the destination clip loops. A one-shot must be allowed to finish.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	bool bLoop = false;

	// Additive, never a replacement. Rides on top of whatever is playing.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	EWonderlandDogOverlay Overlay = EWonderlandDogOverlay::None;

	// Null when unobserved — an unknown state neither asks nor rests.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FWonderlandFlag AttentionRequired;

	// Always a sentence. A renderer logging a transition should log WHY.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Julius")
	FString Reason;
};

/* ------------------------------------------------------------- resolvers */

// The world receives Activity, Motion and Animation already filled in by Relay.
// These exist for the other case: a Blueprint, an editor preview or a test that
// holds only the STATE.
//
// Every one is a pure switch mirroring a TypeScript table, compared case by case
// by wonderland-cpp-parity.test.ts — the same treatment the motion→clip resolver
// gets. A second opinion about which clip a state plays is how the 3D dog and
// the 2D dog end up showing different behaviour for the same Relay state.

// Idle is a state Relay observed; Unobserved is the absence of one. They do not
// collapse, here or anywhere.
WONDERLAND_API EWonderlandDogActivity WonderlandActivityForJuliusState(EWonderlandJuliusState State);

WONDERLAND_API EWonderlandDogMotion WonderlandMotionForActivity(EWonderlandDogActivity Activity);

// Composed from the two above and the motion→clip resolver, never a fourth
// table: a direct state-to-clip map would be a place for the chain to disagree
// with itself.
WONDERLAND_API EWonderlandDogAnimation WonderlandAnimationForJuliusState(EWonderlandJuliusState State);

// True for Blocked and Error, and for nothing else. Stated once because "does
// this need me" is the question a HUD asks most often.
WONDERLAND_API bool WonderlandJuliusStateAsksForAHuman(EWonderlandJuliusState State);

// The blend duration for a transition, in milliseconds. Interrupt and Hold are
// both 0 and they are not the same thing: Hold plays on, Interrupt cuts.
WONDERLAND_API int32 WonderlandAnimationBlendMs(EWonderlandAnimationTransition Transition);

// Whether a clip loops. `HaltSlump` does not: a stopped agent settles once and
// stays stopped, and a looping collapse reads as repeatedly falling over.
WONDERLAND_API bool WonderlandAnimationLoops(EWonderlandDogAnimation Animation);

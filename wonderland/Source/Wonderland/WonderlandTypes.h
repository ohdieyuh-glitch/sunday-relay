// WONDERLAND — the shared vocabulary, mirrored from Relay.
//
// Every enum here mirrors a real Relay vocabulary, and a test proves it:
// src/relay/mission/wonderland/wonderland-cpp-parity.test.ts reads this file,
// normalizes each member name, and compares the set against the array named in
// WONDERLAND_CPP_ENUM_PARITY. An enum member with no Relay counterpart fails
// that test, and so does a Relay member with no enum entry.
//
// ORDINAL 0 IS LOAD-BEARING.
//
// Unreal cannot hold a null enum, and a default-constructed USTRUCT zero-fills.
// Whatever sits first is therefore what a renderer sees before anything has been
// assigned, which means the first member has to be the one that says "Relay has
// not told us". Getting that wrong would defeat "unknown is never a default"
// through C++ initialization semantics rather than through anybody's decision,
// and the parity test asserts the first member of every enum against the
// zeroMember column of the table.
//
// `Unobserved` is the sentinel for a vocabulary whose Relay field is nullable. It
// is deliberately spelled differently from Relay's own `not_observed` (which is a
// REASON a figure is unknown, not the absence of an observation) so the two
// cannot be confused after normalization.
//
// This file supersedes the ad-hoc FRelayMaybeInt/Float/String and
// ERelayMissionPhase sketched in the first draft of RelayWorldState.h. The design
// is the same — a known flag beside every value, a phase vocabulary that keeps
// disconnection separate from completion — but the vocabularies now come FROM
// Relay instead of being restated beside it, which is what made them checkable.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandTypes.generated.h"

/* ------------------------------------------------------------- carriers */

// A string Relay either asserted or did not.
//
// An empty FString is a string. It is not an absence, and the difference is the
// whole reason this struct exists rather than a bare FString with a convention
// attached to it.
USTRUCT(BlueprintType)
struct FWonderlandText
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bKnown = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Value;
};

// A number Relay either asserted or did not. Zero is a measurement.
USTRUCT(BlueprintType)
struct FWonderlandNumber
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bKnown = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	double Value = 0.0;
};

// A boolean Relay either asserted or did not. `false` is an answer.
USTRUCT(BlueprintType)
struct FWonderlandFlag
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bKnown = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bValue = false;
};

/* --------------------------------------------------------- provenance */

// Mirrors PROVENANCES. Simulated is ordinal 0 on purpose: an unset provenance
// must never read as live, and of the four values only `simulated` is safe to be
// wrong about in the direction a zero-fill would take it.
UENUM(BlueprintType)
enum class EWonderlandProvenance : uint8
{
	Simulated,
	Live,
	Imported,
	Manual
};

/* ------------------------------------------------------------ missions */

// Mirrors MISSION_STATUSES.
UENUM(BlueprintType)
enum class EWonderlandMissionStatus : uint8
{
	Unobserved,
	Draft,
	Locked,
	InProgress,
	Blocked,
	VerifiedComplete,
	Cancelled
};

// Mirrors MISSION_VERDICTS. The eight verdicts are not aliases: `approved` is
// not `verified_complete`, and reviewer approval never substitutes for a missing
// required test.
UENUM(BlueprintType)
enum class EWonderlandMissionVerdict : uint8
{
	Unobserved,
	ClaimedComplete,
	Reviewed,
	Approved,
	VerifiedComplete,
	PartiallyComplete,
	Blocked,
	Failed,
	NeedsHuman
};

// The four status dimensions, mirrored separately because they never collapse:
// execution completed != outcome satisfied != verification complete != release
// authorized. A world that reduced them to one "done" would re-introduce the
// ambiguity Relay's status model exists to remove.
UENUM(BlueprintType)
enum class EWonderlandExecutionStatus : uint8
{
	Unobserved,
	NotStarted,
	Starting,
	Running,
	Waiting,
	Completed,
	Failed,
	Cancelled
};

UENUM(BlueprintType)
enum class EWonderlandOutcomeStatus : uint8
{
	Unobserved,
	Unknown,
	Partial,
	Satisfied,
	Violated
};

UENUM(BlueprintType)
enum class EWonderlandVerificationStatus : uint8
{
	Unobserved,
	Unverified,
	Reviewing,
	ChangesRequired,
	Approved,
	Verified
};

UENUM(BlueprintType)
enum class EWonderlandReleaseStatus : uint8
{
	Unobserved,
	NotEligible,
	HumanApprovalRequired,
	Eligible,
	Released,
	RolledBack
};

/* ---------------------------------------------------------------- loops */

// Mirrors RELAY_LOOP_RUNTIME_STATES — the states a running Loop can actually
// report. EVERY EXHAUSTION IS TERMINAL AND NONE OF THEM IS COMPLETION: the five
// limits are listed separately because a user fixes them differently, and
// `TimedOut` is distinct again because a wall-clock deadline is not a consumed
// resource. `RecoveryRequired` is not terminal — an unconfirmable Loop is
// unfinished, not finished.
UENUM(BlueprintType)
enum class EWonderlandLoopState : uint8
{
	Unobserved,
	Draft,
	Validating,
	AwaitingConfirmation,
	Queued,
	Starting,
	Planning,
	Running,
	Observing,
	CompletionCheck,
	WaitingApproval,
	WaitingBudget,
	WaitingDependency,
	RateLimited,
	BackingOff,
	Pausing,
	Paused,
	Resuming,
	Stopping,
	Stopped,
	Completed,
	IterationExhausted,
	DurationExhausted,
	BudgetExhausted,
	TokenExhausted,
	ProviderCallExhausted,
	TimedOut,
	Failed,
	RecoveryRequired
};

/* ------------------------------------------------------------ the dog */

// Mirrors OFFICIAL_RELAY_DOG_ACTIVITIES — the canonical activity vocabulary the
// website and the CLI already share.
UENUM(BlueprintType)
enum class EWonderlandDogActivity : uint8
{
	Unobserved,
	Idle,
	Thinking,
	WaitingForUser,
	Researching,
	Implementing,
	Handoff,
	Verifying,
	Reviewing,
	Repairing,
	Complete,
	Error
};

// Mirrors OFFICIAL_RELAY_DOG_POSE_NAMES. The pose is the Dog's IDENTITY: the
// silhouette, ears, visor, eyes and proportions may not be overridden by a skin,
// so the 3D rig reads the same pose the 18x14 sprite draws.
UENUM(BlueprintType)
enum class EWonderlandDogPose : uint8
{
	Unobserved,
	Standing,
	Trotting,
	Running,
	Sitting,
	Lying,
	Carrying,
	Reaching,
	Sleeping,
	Digging,
	Coding
};

// Mirrors WONDERLAND_DOG_MOTIONS (which is OfficialRelayDogMotion).
UENUM(BlueprintType)
enum class EWonderlandDogMotion : uint8
{
	Unobserved,
	Patrol,
	Still,
	AttentionJump,
	WorkScratch,
	Scan,
	Carry,
	Halt,
	Sleep,
	Dig,
	CodeProgression
};

// The 3D clips. `Dormant` is ordinal 0 and is NOT PatrolWalk: idle is an
// observed Relay state, dormant is the absence of an observation, and animating
// the second as the first is the substitution the whole contract forbids.
UENUM(BlueprintType)
enum class EWonderlandDogAnimation : uint8
{
	Dormant,
	PatrolWalk,
	StandStill,
	AttentionJump,
	WorkScratch,
	ScanSniff,
	CarryWalk,
	HaltSlump,
	SleepCurl,
	DigForward,
	CodeType
};

// An ADDITIVE layer over the clip, never a replacement. The meditation hover
// rides on top of whatever the observed activity is drawing, so Wonderland can
// never show a silhouette the website does not.
UENUM(BlueprintType)
enum class EWonderlandDogOverlay : uint8
{
	None,
	LoopMeditationHover
};

/* -------------------------------------------------------- world entities */

// Mirrors WONDERLAND_PROJECT_CATEGORIES.
UENUM(BlueprintType)
enum class EWonderlandProjectCategory : uint8
{
	Unobserved,
	Unknown,
	Game3dShooter,
	DatabasePlatform,
	AiSystem,
	Devtool,
	CloudSystem,
	WebApplication,
	MobileApplication,
	ResearchCodebase
};

// Mirrors WONDERLAND_ENTITY_FORMS. FoggedUnknown is ordinal 0: repositories are
// not all skyscrapers, and the way they become skyscrapers anyway is a silent
// fallback to one shape.
UENUM(BlueprintType)
enum class EWonderlandEntityForm : uint8
{
	FoggedUnknown,
	WarCreature,
	DataVessel,
	MythicOrganism,
	ClockworkEntity,
	SkyCarrier,
	GlassPavilion,
	WandererCaravan,
	LibraryLandmark
};

/* --------------------------------------------------------------- brain */

// Mirrors RELAY_HEALTH_STATES. Unknown is ordinal 0 because A SILENT SYSTEM IS
// NOT A HEALTHY ONE, and a zero-filled weather struct claiming `Healthy` is the
// most common way a dashboard lies.
UENUM(BlueprintType)
enum class EWonderlandHealth : uint8
{
	Unknown,
	Healthy,
	Degraded,
	Failing
};

// Mirrors RELAY_UNKNOWN_REASONS. `Unobserved` here means the figure is KNOWN and
// therefore carries no reason — distinct from `NotObserved`, which is Relay's
// reason for a figure it never saw.
UENUM(BlueprintType)
enum class EWonderlandUnknownReason : uint8
{
	Unobserved,
	NotObserved,
	InsufficientSamples,
	UnknownDenominator,
	Stale,
	Unreadable
};

/* ----------------------------------------------------------------- GVE */

UENUM(BlueprintType)
enum class EWonderlandGveClass : uint8
{
	Project,
	Agent,
	Hybrid
};

UENUM(BlueprintType)
enum class EWonderlandGveId : uint8
{
	RunawayDogResearchChase
};

// Unavailable is ordinal 0: with no backing Relay work there is no experience to
// be in, so a zero-filled GVE offers nothing.
UENUM(BlueprintType)
enum class EWonderlandGvePhase : uint8
{
	Unavailable,
	Offered,
	ChaseActive,
	BackendRunning,
	CaptureReady,
	Captured,
	Resolved,
	Abandoned
};

/* ------------------------------------------------------------- classes */

// Mirrors WONDERLAND_ENGINEER_CLASSES. Users are MULTI-CLASS: a standing exists
// for every one of these, always, and there is no "primary class" field anywhere
// for a later feature to start reading.
UENUM(BlueprintType)
enum class EWonderlandEngineerClass : uint8
{
	AgenticEngineer,
	AiEngineer,
	ForwardDeployedEngineer,
	SoftwareEngineer,
	GameDeveloper,
	ResearchEngineer,
	SystemsInfrastructureEngineer
};

/* ------------------------------------------------------------ terminal */

// Mirrors ConnectionState from src/relay/mission/terminal.ts.
UENUM(BlueprintType)
enum class EWonderlandConnectionState : uint8
{
	Unobserved,
	Offline,
	Reconnecting,
	Live
};

// Mirrors TerminalProvenanceLabel. Simulated first among the real values, for
// the same reason EWonderlandProvenance starts there.
UENUM(BlueprintType)
enum class EWonderlandTerminalProvenance : uint8
{
	Unobserved,
	Simulated,
	LiveLocal,
	LiveProvider
};

/* --------------------------------------------- the link (C++ only) */

// The client's relationship to the Bridge, kept strictly separate from world
// content. Relay does not model the client's socket, so there is nothing here to
// mirror and the parity test records this enum as C++-only.
//
// Stale keeps the last snapshot and the world must DIM: it never pretends a dead
// link is a live one, and it never blanks the world either, because "we lost
// contact 40 seconds ago" is more useful than an empty scene.
UENUM(BlueprintType)
enum class EWonderlandLinkState : uint8
{
	NeverConnected,
	Pairing,
	Live,
	Stale,
	SessionExpired,
	Refused
};

USTRUCT(BlueprintType)
struct FWonderlandLinkStatus
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandLinkState State = EWonderlandLinkState::NeverConnected;

	// When the last snapshot was accepted. Absent until one has been.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText LastSnapshotAtIso;

	// Always a sentence. A dimmed world has to be able to say why it is dimmed.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Explanation;
};

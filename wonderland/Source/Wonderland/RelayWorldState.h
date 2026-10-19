// WONDERLAND — the World State read model, v1. Wonderland's only source of
// Relay truth.
//
// Each struct below mirrors one interface in
// src/relay/mission/wonderland/wonderland-contracts.ts, field for field, and
// wonderland-cpp-parity.test.ts fails when they drift in either direction. The
// mapping is mechanical: Unreal's PascalCase and boolean `b` prefix normalize to
// the TypeScript camelCase name, so `bKnown` is `known` and
// `BlockingFindingsOpen` is `blockingFindingsOpen`.
//
// THE HONESTY RULES, and where each one lives in this file:
//
//  - UNKNOWN IS NEVER ZERO. Every value Relay did not assert arrives in a carrier
//    that can say so: FWonderlandText, FWonderlandNumber, FWonderlandFlag, or an
//    enum whose ordinal 0 is `Unobserved`. There is no field a renderer can read
//    as a number without first reading a flag.
//
//  - REQUESTED AND ACTUAL ARE SEPARATE. FWonderlandAttestation carries both, and
//    `bAttested` is true only when Relay observed both names and they matched.
//
//  - A DISCONNECTION IS NEVER A COMPLETION. Link state lives in
//    FWonderlandLinkStatus (WonderlandTypes.h) and is not part of the world
//    document at all, so a lost connection cannot be mistaken for a mission
//    result.
//
//  - SIMULATED SAYS SO. FWonderlandWorld carries bSimulated and a
//    ProvenanceLabel sentence, and a renderer reaches no world content without
//    passing them.
//
// NOTHING IN THIS FILE DECIDES ANYTHING. There is no mutation, no verdict, no
// permission check and no orchestration. The only outbound shape is
// FWonderlandMissionRequest, whose Authority field is the string
// `relay_decides` — there is no member of any struct here that could express
// "Wonderland approved this".

#pragma once

#include "CoreMinimal.h"
#include "WonderlandTypes.h"
#include "RelayWorldState.generated.h"

/* -------------------------------------------------------------- figures */

// Mirrors WonderlandFigure, which is RelayFigure in a shape a USTRUCT can hold.
// `Value` is meaningless unless `bKnown`; the parity test records that this
// struct IS its own absence carrier, which is why Value is a bare double.
USTRUCT(BlueprintType)
struct FWonderlandFigure
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bKnown = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	double Value = 0.0;

	// Relay's own reason. `Unobserved` when the figure is known.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandUnknownReason Reason = EWonderlandUnknownReason::NotObserved;
};

/* ---------------------------------------------------------- attestation */

// Mirrors WonderlandAttestation. A missing served model is NOT agreement.
USTRUCT(BlueprintType)
struct FWonderlandAttestation
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText RequestedModel;

	// The name the runtime reported. Never inferred from configuration.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText ServedModel;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bAttested = false;

	// A sentence whenever bAttested is false.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText UnattestedReason;
};

/* ------------------------------------------------------------- missions */

// Mirrors WonderlandMission. All four status dimensions travel, each nullable on
// its own; none of them is derived from another here.
USTRUCT(BlueprintType)
struct FWonderlandMission
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString MissionId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bObserved = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText UnobservedReason;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandMissionStatus MissionStatus = EWonderlandMissionStatus::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandMissionVerdict Verdict = EWonderlandMissionVerdict::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandExecutionStatus ExecutionStatus = EWonderlandExecutionStatus::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandOutcomeStatus OutcomeStatus = EWonderlandOutcomeStatus::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandVerificationStatus VerificationStatus = EWonderlandVerificationStatus::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandReleaseStatus ReleaseStatus = EWonderlandReleaseStatus::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandFigure BlockingFindingsOpen;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandAttestation ReviewerAttestation;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText UpdatedAtIso;
};

/* ---------------------------------------------------------------- loops */

// Mirrors WonderlandLoopSignal. bExecuting comes from Relay's own
// isActiveLoopState and deliberately excludes every wait state: a run blocked on
// approval is making no progress, and animating it would be a lie told once a
// frame.
USTRUCT(BlueprintType)
struct FWonderlandLoopSignal
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString LoopId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bObserved = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandLoopState State = EWonderlandLoopState::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bExecuting = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bWaiting = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bTerminal = false;
};

/* ---------------------------------------------------------------- skins */

// Mirrors WonderlandDogSkin.
//
// A SKIN TRANSFORMS THE RELAY DOG. IT NEVER REPLACES IT. The palette may be
// overridden; the silhouette, ears, visor, eyes and PROPORTIONS may not. So there
// is no width, height, pose or mesh field a skin could set: GridWidth and
// GridHeight are READ-BACK identity constants stamped from the canonical 18x14
// sprite, and bUniformScaleOnly is always true because independent width and
// height scaling distorts the body.
USTRUCT(BlueprintType)
struct FWonderlandDogSkin
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString SkinId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString DisplayName;

	// Progression accent, or absent for the Dog exactly as shipped.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText ChakraTier;

	// Eyes and collar are the only recolourable letters in the canonical palette.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString EyeColor;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString CollarColor;

	// Body, shading and visor are the animal. They arrive from the canonical
	// palette and a skin has no way to change them.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString BodyColor;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString ShadowColor;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString VisorColor;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int32 GridWidth = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int32 GridHeight = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bUniformScaleOnly = false;
};

/* ---------------------------------------------------------------- agent */

// Mirrors WonderlandAgent — the user's Compound AI Agent, embodied.
//
// Animation is derived from Motion alone, and Motion is `Unobserved` unless Relay
// asserted a recognised dog state. Travelling and AttentionRequired are
// FWonderlandFlag rather than bool for the same reason: an unobserved Agent is
// not a resting one, and `false` would be an answer.
USTRUCT(BlueprintType)
struct FWonderlandAgent
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString AgentId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bObserved = false;

	// The raw workspace state Relay produced, kept for traceability.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText WorkspaceState;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandDogActivity Activity = EWonderlandDogActivity::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandDogPose Pose = EWonderlandDogPose::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandDogMotion Motion = EWonderlandDogMotion::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandDogAnimation Animation = EWonderlandDogAnimation::Dormant;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandDogOverlay Overlay = EWonderlandDogOverlay::None;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandFlag Travelling;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandFlag AttentionRequired;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText ActivityLabel;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandDogSkin Skin;
};

/* ------------------------------------------------------------- terminal */

// Mirrors WonderlandTerminalLine. Headline and Detail are COPIED from a Relay
// terminal event that was already redacted and already stripped of private
// reasoning. Nothing in Unreal composes terminal text.
USTRUCT(BlueprintType)
struct FWonderlandTerminalLine
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int64 Sequence = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Headline;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Detail;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText Severity;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandProvenance Provenance = EWonderlandProvenance::Simulated;

	// Relay removed hidden reasoning from this line. The panel can say so
	// without knowing what it was.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bOmittedPrivateReasoning = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int32 RedactionsApplied = 0;
};

// Mirrors WonderlandTerminalPanel — the small, wide, minimal transparent panel
// beneath the Dog. `bPresent` false is a state the panel SHOWS: a terminal with
// no stream renders the reason, not an empty frame that reads as a quiet system.
USTRUCT(BlueprintType)
struct FWonderlandTerminalPanel
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bPresent = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText UnavailableReason;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandConnectionState ConnectionState = EWonderlandConnectionState::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandTerminalProvenance Provenance = EWonderlandTerminalProvenance::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText RunId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText MissionId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandTerminalLine> Lines;

	// How many lines Relay had, when the panel carries fewer. A window presented
	// as a whole is the same class of lie as a percentile from three samples.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandNumber TruncatedFrom;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandNumber LastSequence;
};

/* ------------------------------------------------------- world entities */

// Mirrors WonderlandProjectEntity.
//
// EVOLUTION IS DRIVEN BY VERIFIED MEANINGFUL DEVELOPMENT. There is no commit
// count here, and there is none in the projection that fills it: a field that
// existed would eventually be read by something that needed a number to go up.
// `Stage` is absent (not zero) for a project Relay has never observed; zero is a
// real measurement, reserved for a project Relay watched that verified nothing.
USTRUCT(BlueprintType)
struct FWonderlandProjectEntity
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString ProjectId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bObserved = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandProjectCategory Category = EWonderlandProjectCategory::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandEntityForm Form = EWonderlandEntityForm::FoggedUnknown;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandNumber Stage;

	// Verified missions that qualified. Never a commit or an event count.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int32 EvolutionEvidenceCount = 0;

	// Work Relay saw and did not verify. Shown, and structurally unable to
	// move Stage.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int32 UnverifiedActivityCount = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString NextStageRequirement;
};

/* -------------------------------------------------------- brain weather */

// Mirrors WonderlandBrainWeather — the Project Brain's operational signals as
// the world's atmosphere. Every figure comes from Relay's own operations view;
// nothing here is recomputed.
USTRUCT(BlueprintType)
struct FWonderlandBrainWeather
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bPresent = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText ProjectId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandHealth Health = EWonderlandHealth::Unknown;

	// Always a sentence, in Relay's own words.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString HealthReason;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandFigure ErrorRate;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandFigure SignalAgeMs;

	// Known only when Relay's count is exact. An evicted window yields a floor,
	// and a floor rendered as a count would imply every error was recovered.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandFigure UnrecoveredErrorCount;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bWaitingOnUserOpen = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandFigure OpenRepairLoops;
};

/* ----------------------------------------------------------------- GVE */

// Mirrors WonderlandRecommendation. A recommendation with no evidence is
// WITHHELD: its Headline is the withholding sentence and the original text is not
// carried anywhere this struct can reach. The chase is allowed to end
// disappointingly; it is not allowed to end with invented copy.
USTRUCT(BlueprintType)
struct FWonderlandRecommendation
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString RecommendationId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Headline;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FString> EvidenceIds;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText EvidenceFreshness;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bWithheld = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText WithheldReason;
};

// Mirrors WonderlandMissionRequest. Authority is always the string
// `relay_decides`, and there is no field here that could say otherwise: the world
// asks, Relay answers.
USTRUCT(BlueprintType)
struct FWonderlandMissionRequest
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString RequestId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Objective;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandGveId SourceGveId = EWonderlandGveId::RunawayDogResearchChase;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Authority;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FString> EvidenceIds;
};

// Mirrors WonderlandGve. bCaptureUnlocked requires the backing Loop to have
// reached Completed — the Loop Engine's only successful terminal state. A chase
// whose research ran out of budget stays locked and says which limit stopped it.
USTRUCT(BlueprintType)
struct FWonderlandGve
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandGveId GveId = EWonderlandGveId::RunawayDogResearchChase;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandGveClass GveClass = EWonderlandGveClass::Hybrid;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandGvePhase Phase = EWonderlandGvePhase::Unavailable;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText BackingLoopId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandLoopState BackingLoopState = EWonderlandLoopState::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bCaptureUnlocked = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandText CaptureBlockedReason;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandRecommendation> Recommendations;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandMissionRequest> MissionRequests;
};

/* ------------------------------------------------------------- classes */

// Mirrors WonderlandBadge. A badge is VERIFIED mastery: EvidenceMissionId is not
// optional, so a badge without a mission behind it is unrepresentable.
USTRUCT(BlueprintType)
struct FWonderlandBadge
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString BadgeId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandEngineerClass EngineerClass = EWonderlandEngineerClass::AgenticEngineer;

	// A real Relay skill id — Skill Plugins are Relay capabilities.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString SkillId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString EvidenceMissionId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString AwardedAtIso;
};

// Mirrors WonderlandClassStanding. The badge list and the claim COUNT are
// separate fields with different types, so no aggregation can merge them: a
// claim has no mission id to become a badge with.
USTRUCT(BlueprintType)
struct FWonderlandClassStanding
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandEngineerClass EngineerClass = EWonderlandEngineerClass::AgenticEngineer;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandBadge> VerifiedBadges;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int32 UnverifiedClaimCount = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FString> SkillPluginIds;
};

/* ---------------------------------------------------------- replication */

// Mirrors WonderlandReplication — the multiplayer authority boundary as data.
//
// FOUNDATION ONLY. What is declared: who is authoritative, that this client is
// presentational, the monotonic revision a client must not render backwards
// over, and which document sections are owner-only. What is NOT built: clans, a
// Battle Pass, a Coliseum, boss economies, a marketplace, or world scale. None of
// them appears in this struct, and docs/relay/WONDERLAND.md records them as
// planned rather than as present.
USTRUCT(BlueprintType)
struct FWonderlandReplication
{
	GENERATED_BODY()

	// Always `relay`.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString Authority;

	// Always `presentational`.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString ClientRole;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int64 Revision = -1;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FString> OwnerOnlySections;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FString> WorldVisibleSections;
};

/* -------------------------------------------------------- the document */

// Mirrors WonderlandWorld. One observation, one revision.
//
// Gve is a value rather than a pointer because absence is already expressible:
// EWonderlandGvePhase::Unavailable is that enum's ordinal 0, so a zero-filled
// FWonderlandGve reads as "no experience is available" without a second flag.
USTRUCT(BlueprintType)
struct FWonderlandWorld
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString SchemaVersion;

	// The instant Relay computed this projection FOR. Never a local clock read.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString ObservedAtIso;

	// Monotonic. A client holding a higher revision must not be overwritten.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	int64 Revision = -1;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	EWonderlandProvenance Provenance = EWonderlandProvenance::Simulated;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	bool bSimulated = true;

	// Always a sentence. A one-word badge is what lets a simulated world get
	// mistaken for a live one at a glance.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FString ProvenanceLabel;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandAgent Agent;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandLoopSignal> Loops;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandMission> Missions;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandProjectEntity> Entities;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandBrainWeather Brain;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandTerminalPanel Terminal;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandGve Gve;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	TArray<FWonderlandClassStanding> Classes;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland")
	FWonderlandReplication Replication;
};

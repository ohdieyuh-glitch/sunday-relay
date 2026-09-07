// WONDERLAND — THE ENVELOPE, THE CURSOR AND THE SNAPSHOT.
//
// Mirrors `WonderlandEnvelope`, `WonderlandCursor` and `WonderlandRunSnapshot`
// in src/relay/mission/wonderland/, field for field, and
// wonderland-cpp-parity.test.ts fails when the two drift in either direction.
//
// WHAT THIS FILE IS FOR. Everything the world is ever told about a Julius
// mission arrives as an FWonderlandEnvelope, and the receiving side decides
// whether to believe it using an FWonderlandCursor. Both halves are here so a
// client can be written without reading the TypeScript.
//
// THE RULE THAT SHAPES THE ENVELOPE: no provider payload reaches a world. There
// is no field on this struct that a prompt, a completion, a stack trace or a
// credential could occupy — Metadata is scalars only, bounded, with
// secret-shaped keys already dropped on the Relay side. DO NOT ADD ONE.
//
// AND THE RULE THAT SHAPES THE CURSOR: an event arriving last is not an event
// that happened last. See EWonderlandOrderingVerdict.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandTypes.h"
#include "WonderlandJuliusState.h"
#include "WonderlandUsageHud.h"
#include "WonderlandEnvelope.generated.h"

/* ---------------------------------------------------------- worker roles */

// Mirrors WONDERLAND_WORKER_ROLES. WHICH FUNCTION acted — never which provider.
//
// The three named slots are Julius's own permanent roles. `Specialist` is a
// collapse: Julius spawns specialists under its own policy and names them
// freely at run time, and letting an orchestrator-chosen string reach a
// renderer would make that name a de-facto vocabulary. The token says a
// specialist acted; which one is Julius's business.
UENUM(BlueprintType)
enum class EWonderlandWorkerRole : uint8
{
	// Ordinal 0. No role travelled. NOT a default of any slot — attributing
	// unlabelled work to the Coding Agent would put it on the wrong instrument.
	Unobserved,
	PromptArchitect,
	CodingAgent,
	IndependentReviewer,
	Specialist
};

/* ------------------------------------------------------------ the envelope */

// Mirrors WonderlandEnvelope. One fact about one Julius mission, crossing once.
USTRUCT(BlueprintType)
struct FWonderlandEnvelope
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString SchemaVersion;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString EventId;

	// The one identifier that is never absent. A world always belongs to a
	// project, and an envelope that did not name one could not be routed.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString ProjectId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText WorldSessionId;

	// WHICH Julius. Two instances' streams must never be merged, and a client
	// that ignored this would animate one mission with another's events.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText JuliusInstanceId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText MissionId;

	// The ORDERING SCOPE. Sequence is allocated per run, so a cursor that is not
	// scoped to a run is not merely imprecise — it is wrong.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText RunId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText TaskId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	EWonderlandWorkerRole WorkerRole = EWonderlandWorkerRole::Unobserved;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	EWonderlandJuliusState State = EWonderlandJuliusState::Unobserved;

	// Which vocabulary produced the state. Precision travels with the reading,
	// because only a kernel-sourced state may be held to the kernel's table.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	EWonderlandJuliusStateSource StateSource = EWonderlandJuliusStateSource::Unobserved;

	// The upstream word, kept so the visual collapse destroys nothing.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText SourceState;

	// Set only by an event that reports a real ending. A transport condition
	// can never set it.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	bool bTerminal = false;

	// Per RUN, monotonic. Orders EVENTS.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Sequence = 0;

	// `julius_runs.version`. Orders STATES. Not interchangeable with Sequence:
	// several events share one revision, and a snapshot has a revision and no
	// sequence at all.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Revision = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString OccurredAt;

	// Scalars only, bounded in length and count, secret-shaped keys already
	// dropped. Represented as strings because Blueprint has no sum type; the
	// Relay side guarantees each value was a string, number, bool or null.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	TMap<FString, FString> Metadata;

	// Entries the sanitiser removed. NEVER what they were — naming a dropped
	// credential key would tell a viewer a credential exists.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 MetadataDropped = 0;
};

/* ------------------------------------------------------------- the verdict */

// Mirrors WONDERLAND_ORDERING_VERDICTS. What happened to an arriving envelope.
//
// Every refusal is its own member rather than a shared `Rejected`, because the
// counts are a diagnosis: forty StaleSequence is a chatty replay and is fine;
// one ForeignProject is a routing bug and is not.
UENUM(BlueprintType)
enum class EWonderlandOrderingVerdict : uint8
{
	// Ordinal 0. The only verdict that changes what a world shows. Named for
	// what happens rather than for a decision: "accepted" reads as approval, and
	// nothing in this seam has the authority to approve anything.
	Applied,
	// The same event id again. The wire retried.
	Duplicate,
	// In order for its sender, behind our cursor.
	StaleSequence,
	// Its run has already moved past the state this describes. Checked BEFORE
	// sequence: a stale replica can deliver an event whose sequence is ahead on
	// its own stream while the run has moved on, and the sequence check alone
	// would accept it and walk the world backwards.
	StaleRevision,
	ForeignProject,
	ForeignJulius,
	ForeignRun,
	Malformed
};

/* -------------------------------------------------------------- the cursor */

// Mirrors WonderlandCursor. What this client has accepted, for ONE run.
USTRUCT(BlueprintType)
struct FWonderlandCursor
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString SchemaVersion;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString ProjectId;

	// Bound on first acceptance and never unlearned by a later envelope that
	// happened not to name them.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText JuliusInstanceId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText RunId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Sequence = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Revision = 0;

	// Whether Revision came from a SNAPSHOT rather than an event, which changes
	// what a tie means. Two events may share a revision and are peers; a
	// snapshot is the run's own row at that revision and outranks its whole
	// generation. Without this a replayed CODING event at the snapshot's
	// revision overwrites a COMPLETE recovered at the same revision.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	bool bRevisionFromSnapshot = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText LastEventId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText LastAppliedAtIso;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Applied = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Duplicates = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 StaleSequences = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 StaleRevisions = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 ForeignProjects = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 ForeignJulius = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 ForeignRuns = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Malformed = 0;

	// Sequence jumps greater than one. Replay is how they are repaired, and a
	// stream with holes is degraded even when everything that arrived was
	// accepted.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Gaps = 0;
};

/* ------------------------------------------------------------ the snapshot */

// Mirrors WonderlandRunSnapshot — the run as `inspectRun` reports it NOW.
//
// A snapshot SETS the state; it never replays one. Recovering CODING means
// showing CODING, not performing the transitions that led there while nobody
// was watching.
USTRUCT(BlueprintType)
struct FWonderlandRunSnapshot
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString SchemaVersion;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString ProjectId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText JuliusInstanceId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString RunId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandText MissionId;

	// The KERNEL's own word, as text: nothing in the world switches on a
	// thirteen-member run-state enum, and a mirrored vocabulary nothing reads is
	// a migration cost with no reader. The drawable state is on the envelope.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString State;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	int64 Revision = 0;

	// When the snapshot was TAKEN, not when the run last changed.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FString ObservedAtIso;

	// Null when the reader could not supply it. Never a guessed zero — "no
	// tasks are running" and "nobody counted" are different facts.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandNumber ActiveTasks;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandNumber PendingApprovals;
};

/* ---------------------------------------------------------- attribution */

// Mirrors WONDERLAND_USAGE_ATTRIBUTIONS. Which meter a unit of work belongs to.
//
// ATTRIBUTION FOLLOWS THE ORCHESTRATOR, NOT THE WORKER. A single model does the
// work in both cases, so attributing by who DID it would put identical activity
// in both channels with no principled way to choose. A unit of work has exactly
// one orchestrator, or none, and never two.
UENUM(BlueprintType)
enum class EWonderlandUsageAttribution : uint8
{
	// Ordinal 0, and the only safe default: a record nobody filled in has not
	// been attributed to anything, and defaulting it to Compound would put
	// unexplained spend on a founder's main meter.
	Unattributed,
	// Julius orchestrated it. Every worker slot's spend inside a run is here,
	// the Coding Agent's included — a founder bought a Compound Agent and the
	// slots are what it is made of.
	CompoundOrchestrated,
	// An agent working outside any orchestration.
	SingleAgent
};

/* ------------------------------------------------------------- resolvers */

// True for the one verdict that changes what a world shows.
WONDERLAND_API bool WonderlandOrderingVerdictApplies(EWonderlandOrderingVerdict Verdict);

// The channel an attribution draws into. Unattributed draws into NEITHER, and
// the caller must render UNKNOWN rather than choosing one.
WONDERLAND_API bool WonderlandAttributionChannel(
	EWonderlandUsageAttribution Attribution,
	EWonderlandUsageChannel& OutChannel);

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

	/**
	 * The ledger sequence this snapshot is consistent with, when the reader
	 * could say. Unknown otherwise — never guessed, because too high skips
	 * events and too low claims to have applied events nobody saw.
	 *
	 * WHY IT EXISTS, and the failure it closes. Only a state TRANSITION bumps
	 * `julius_runs.version`; `review.started`, `finding.recorded` and both
	 * subagent events do not. So after adopting a snapshot at revision 10,
	 * every genuinely new event of those kinds also arrived at revision 10 and
	 * the revision tie-break refused all of them — the world went DEAF until
	 * the run happened to change state. With a position, the far more precise
	 * sequence check does that job instead.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Envelope")
	FWonderlandNumber AtSequence;

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

/* --------------------------------------------------------- the hydration */

// Mirrors WONDERLAND_AUTONOMY_LEVELS. Whether the run will stop and ask.
UENUM(BlueprintType)
enum class EWonderlandAutonomy : uint8
{
	// Ordinal 0. The record did not say. NOT `Supervised` — guessing the
	// cautious level still claims a fact nobody stated.
	Unobserved,
	Supervised,
	Autonomous,
	Unchained
};

// Mirrors WonderlandCardScope. What a world may know about a C.A.R.D.
//
// DELIBERATELY LITTLE. `CardVersion` carries `models` — PROVIDER AND MODEL
// NAMES — along with tools, permissions and budgets. None of it may reach a
// world: the visual vocabulary is provider-free by construction and a test
// asserts it, so leaking the names through the C.A.R.D. would undo that from
// the side door, on the surface a player can inspect.
//
// A role slot is therefore reported as FILLED OR NOT, never by whom. Which
// model occupies the Coding Agent slot is Relay's business and changes nothing
// a world draws. Budgets are absent for a different reason: the usage authority
// already owns capacity, and a second source for "how much is left" is the
// duplicated authority the ownership table forbids.
USTRUCT(BlueprintType)
struct FWonderlandCardScope
{
	GENERATED_BODY()

	// Opaque handle. Compared, never parsed.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Card")
	FString CardRevision;

	// A SLOT, OR THE ABSENCE OF AN ANSWER. FWonderlandFlag rather than bool
	// because a zero-filled USTRUCT would otherwise hand a renderer `false` —
	// "the Coding Agent slot is empty" — for a hydration whose reader simply
	// could not resolve the C.A.R.D. behind the run. `bKnown` false means
	// nobody looked; only `bKnown && !bValue` is an empty slot.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Card")
	FWonderlandFlag HasPromptArchitect;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Card")
	FWonderlandFlag HasCodingAgent;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Card")
	FWonderlandFlag HasIndependentReviewer;

	// MAY spawn a swarm, which is not "is running one" — that is `Swarming` on
	// the activity axis. A world needs this one to leave room before any clone
	// exists.
	//
	// A CARRIER, FOR THE SAME REASON THE THREE SLOTS ARE. It was a bare bool,
	// and a reader that could not resolve the C.A.R.D. — which is every reader
	// today, since C.A.R.D. policy is not persisted at all — reported `false`:
	// "this run may not spawn a swarm", a confident claim nobody made, drawn
	// beside three slots that correctly said UNKNOWN. `bKnown` false means
	// nobody looked; only `bKnown && !bValue` is a C.A.R.D. that forbids one.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Card")
	FWonderlandFlag SwarmEligible;

	// From the repository's own closed role vocabulary, safe to carry precisely
	// because it is closed: these are Relay's words for functions, not anybody's
	// product names.
	//
	// MEANINGLESS ON ITS OWN. Empty is both "permits no roles" and "nobody could
	// look"; `SwarmEligible` is what tells them apart, and a renderer must read
	// it first. There is no carrier for a TArray, so the distinction lives on
	// the flag beside it rather than on the list.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Card")
	TArray<FString> EligibleSwarmRoles;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Card")
	EWonderlandAutonomy Autonomy = EWonderlandAutonomy::Unobserved;
};

// Mirrors WONDERLAND_GATED_OPERATIONS, itself the kernel's JuliusPolicyOperation.
//
// WHAT C.A.R.D. CAN GATE. Safe to mirror because it is closed and it is OURS:
// these are Relay's words for KINDS OF ACTION, not any provider's product names
// and not anybody's prose.
UENUM(BlueprintType)
enum class EWonderlandGatedOperation : uint8
{
	// Ordinal 0. No operation occupies it, so a TArray element nobody wrote —
	// or a token this build cannot name — never reads as a real gate.
	Unobserved,
	DispatchWorker,
	UseCapability,
	UseProvider,
	UseTool,
	ReadFilesystem,
	ExecuteProcess,
	AccessNetwork,
	MutateFilesystem,
	SpawnSubagent,
	ContinueIterativeReview,
	FallbackProvider,
	AutomaticRetry,
	UnchainedContinuation
};

// Mirrors WonderlandHumanGate. ONE THING A RUN IS WAITING FOR A PERSON TO DO.
//
// A WORKER NEVER PUT ANYTHING HERE. A worker asks C.A.R.D. whether an operation
// is permitted — a question about a capability boundary — and Julius alone
// turns REQUIRE_APPROVAL into a gate, owns the record and owns the resume.
// Nothing a worker produced reaches this struct.
//
// AND IT CARRIES NO PROSE. `julius_approvals.safe_rationale` is a real column
// and a genuinely safe sentence, and it still does not cross: a game client is
// the least trusted process in the system, and a sentence is the one field on
// this record that could be made to carry something a person wrote. The
// OPERATION says what is gated, which is what a world draws.
USTRUCT(BlueprintType)
struct FWonderlandHumanGate
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	FString SchemaVersion;

	// Its OWN identity, like the citation's. A hydration is adopted wholesale,
	// so a gate assembled into an otherwise correct payload would put another
	// run's held decision onto this world with nothing to contradict it.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	FString ProjectId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	FString RunId;

	// Opaque handle. Grouped by, never parsed.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	FString GateId;

	// Absent for a gate on the RUN rather than on one task.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	FWonderlandText TaskId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	EWonderlandGatedOperation Operation = EWonderlandGatedOperation::Unobserved;

	// The policy's machine name for why, e.g. CARD_APPROVAL_REQUIRED. A stable
	// token a program compares, never a sentence — how a surface words it
	// belongs to whatever draws it. EMPTY means the kernel reported a code the
	// server would not repeat, which is an absence rather than a sentence.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	FString ReasonCode;

	// When the gate opened. How long a person has been waited on.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Gate")
	FString RequestedAtIso;
};

// Mirrors WonderlandHydration. Everything a world needs to draw itself cold.
//
// TWO KINDS OF THING TRAVEL ON THIS SEAM, and the split is the design.
// FWonderlandEnvelope is INCREMENTAL: one event, lean, ordered by sequence,
// carrying a phase and its identity and nothing more, because it arrives
// constantly and anything on it is paid for every time. This is the SNAPSHOT:
// sent once on join and once per reconnect, so usage, Project Brain, C.A.R.D.
// and activity live here where they cost nothing per event.
//
// WHICH IS WHY USAGE IS NOT ON THE ENVELOPE. Capacity does not change per
// event; a meter reading on every transition would send the same two numbers
// thousands of times and still be stale in between, because usage moves on its
// own schedule. It is a report with its own revision.
//
// A HYDRATION IS ADOPTED WHOLESALE, which is what makes its identity checks the
// most important ones on the seam: a mis-routed one replaces everything at once
// with another project's picture, and nothing arriving later contradicts it.
USTRUCT(BlueprintType)
struct FWonderlandHydration
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FString SchemaVersion;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FString ProjectId;

	// The world session this was cut for. Absent when unscoped.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FWonderlandText WorldSessionId;

	// The run, its state, its revision, and the sequence it is consistent with.
	// The tail resumes from exactly there — never the transcript.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FWonderlandRunSnapshot Run;

	// Both meters as the usage authority projected them. Never recomputed here.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FWonderlandUsageHud Usage;

	// How much to believe those figures. Relay's verdict, carried verbatim.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FWonderlandUsageAuthorityStatus UsageStatus;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FWonderlandActivityReading Activity;

	// Counts and revisions. Never content.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FWonderlandBrainCitation Brain;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FWonderlandCardScope Card;

	// WHAT A PERSON IS BEING WAITED ON FOR, typed.
	//
	// `Run.PendingApprovals` is the authority on HOW MANY; this says WHICH, and
	// may carry fewer. Both are read in one statement so they cannot disagree
	// about a moment, and where they disagree about a COUNT that difference is
	// the report: a gate whose operation this build cannot name is counted and
	// not described. Same shape as a Project Brain kind with no bucket.
	//
	// EMPTY IS NOT UNKNOWN HERE. The count beside it carries the absence — a
	// PendingApprovals nobody could compute is an unknown carrier, while an
	// empty list beside a known zero is "nothing is gated".
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	TArray<FWonderlandHumanGate> HumanGates;

	// When this was cut, not when anything in it last changed.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Hydration")
	FString ObservedAtIso;
};

// WONDERLAND — THE WIRE DECODER.
//
// Relay's JSON becomes a validated C++ envelope here, and nowhere else. The two
// shapes DO NOT correspond one to one, which is the entire reason this file
// exists rather than a call to a name-matching converter:
//
//   ABSENCE. TypeScript has null; Unreal's numerics, strings and bools do not.
//   A nullable field arrives as a value OR null and lands in a carrier that
//   owns its own bKnown. A converter matching by name leaves the carrier
//   zero-filled, and a zero-filled carrier reads as "Relay did not say" for a
//   figure Relay did say. FALSE IS NOT UNKNOWN. ZERO IS NOT UNKNOWN. MISSING IS
//   NOT EMPTY.
//
//   VOCABULARY. Relay's tokens are snake_case, SCREAMING_SNAKE and — in one
//   vocabulary — SPACE SEPARATED. Members here are PascalCase. An unmatched
//   token must never land on ordinal 0: zero is Unobserved in every enum this
//   reads, so a decoder that fell back to it would make a broken client look
//   like a silent Relay, which is the hardest symptom there is to diagnose.
//
// SO EVERY REFUSAL IS NAMED AND NOTHING IS DEFAULTED. There is no path through
// this file on which a malformed, unknown or out-of-range input produces an
// envelope. The caller gets a reason and a field, and the subsystem is never
// reached — identity is checked BEFORE anything could be applied.
//
// THE TABLES ARE GENERATED. `WonderlandWireDecode.tables.cpp` is written by
// `npm run wonderland:wire:export` from the same parity tables that hold these
// headers to the TypeScript, so a member named there always exists.
//
// WHY IT PARSES ITS OWN JSON. The parser below is deliberately small, strict
// and dependency-free: the same code that ships is the code the offline harness
// runs, with no engine present. A decoder built on an engine JSON API could not
// be executed in this environment at all, and would be shipped unproven.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandEnvelope.h"
#include "WonderlandJuliusState.h"
#include "WonderlandUsageHud.h"

/* ------------------------------------------------------------- refusals */

// Why a payload produced nothing. Each names a different thing to fix, and
// every one of them is preferable to a default.
enum class EWonderlandWireError : uint8
{
	// Ordinal 0 is success, so a zero-initialised result is not a refusal
	// carrying a reason nobody set.
	None = 0,
	// The bytes are not JSON, or there is trailing content after the value.
	NotJson,
	// Valid JSON, but not an object at the top level.
	NotObject,
	// A field the envelope cannot be built without is absent.
	MissingField,
	// Present, with a JSON type this field cannot carry.
	WrongType,
	// A string where an enum was expected, naming nothing in the vocabulary.
	UnknownToken,
	// NaN or infinity. Relay never sends one; a client must never invent one.
	NumberNotFinite,
	// A fraction where a sequence or a revision was expected.
	NumberNotInteger,
	// Beyond what an int64 — or a double's exact-integer range — can hold.
	NumberOutOfRange,
	// Structurally fine and unusable: a blank project, a blank event id.
	IdentityRejected,
	// Deeper, longer or larger than this decoder will read. A bound, not a bug.
	TooLarge,
	// The same key twice in one object. Ambiguous, and an override risk.
	DuplicateKey,
	// A payload naming a schema this build does not implement.
	//
	// LAST, so no ordinal above it moves — every generated table and every
	// fixture's expected name is keyed on these, and renumbering them would
	// change what a refusal MEANS without changing a line that mentions it.
	//
	// SEPARATE FROM UnknownToken, and the distinction is operational. An
	// unknown token is one field this build cannot read; an unknown schema is a
	// payload whose every field may mean something else, and the two want
	// different things done about them. Coercing it would be guessing at the
	// meaning of fields this build does not have — silently — and refusing is
	// what lets a bridge and a client be deployed at different times without
	// one of them inventing the other's contract.
	SchemaRejected
};

// A refusal, with the field that caused it. The field name is one of OURS —
// a literal from this file — never a string the payload supplied.
struct FWonderlandWireRefusal
{
	EWonderlandWireError Error = EWonderlandWireError::None;
	FString Field;
};

struct FWonderlandEnvelopeDecode
{
	bool bOk = false;
	FWonderlandWireRefusal Refusal;
	FWonderlandEnvelope Envelope;
};

/* --------------------------------------------------------- enum tables */

// One Relay token and the member it names. Generated.
struct FWonderlandWireToken
{
	const char* Token;
	uint8 Value;
};

struct FWonderlandWireEnumTable
{
	const char* EnumName;
	const FWonderlandWireToken* Tokens;
	int32 Count;
	// Whether Relay can report nothing for it — and therefore whether JSON null
	// is a legitimate value rather than a missing field.
	bool bNullable;
};

extern const FWonderlandWireEnumTable WonderlandWireEnumTables[];
extern const int32 WonderlandWireEnumTableCount;

// Look a token up in one generated table. False when the table does not name
// it — the caller then REFUSES; it does not fall back to zero.
bool WonderlandWireLookupToken(const char* EnumName, const FString& Token, uint8& OutValue);

/* ------------------------------------------------------------- limits */

// Bounds, so a hostile or broken payload cannot exhaust the client. Each is
// generous next to anything Relay actually sends.
enum : int32
{
	WonderlandWireMaxBytes = 262144,
	WonderlandWireMaxDepth = 32,
	WonderlandWireMaxKeys = 128,
	WonderlandWireMaxStringBytes = 8192
};

/* ------------------------------------------------------------ the entry */

// Decode one Wonderland envelope from Relay's JSON.
//
// The ONLY way an FWonderlandEnvelope should ever be built from a payload. On
// refusal the envelope is untouched and the subsystem must not be called.
//
// BYTES, NOT AN FString, AND DELIBERATELY. An SSE frame arrives as UTF-8 bytes
// with a known length; the engine's FString is UTF-16 and the offline harness's
// is not, so a decoder taking one would have a conversion in it that could only
// ever be compiled in one of the two places — and would therefore ship
// unproven. The conversion belongs to the caller, at its own boundary, where
// the engine session can see it.
FWonderlandEnvelopeDecode WonderlandDecodeEnvelopeBytes(const char* Bytes, int32 Length);

/* ------------------------------------------------------- the delivery */

// WHAT AN SSE FRAME ACTUALLY CARRIES.
//
// The bridge writes `data: {"envelope":…,"activity":…}` — a WonderlandDelivery,
// not a bare envelope. Both halves are needed together, because
// `UWonderlandJuliusSubsystem::ApplyEnvelope` takes the activity beside the
// envelope: the reduction that produced it lives in TypeScript and is tested
// there, and a second reduction in C++ would be a second answer to "what is
// this run doing".
//
// The ACTIVITY IS SHIPPED WHOLE rather than as a delta, so a client that just
// reconnected can adopt it without having applied every previous one.
struct FWonderlandDeliveryDecode
{
	bool bOk = false;
	FWonderlandWireRefusal Refusal;
	FWonderlandEnvelope Envelope;
	FWonderlandActivityReading Activity;
};

// Decode one delivery. The envelope half is decoded by exactly the same code
// path as above; there is no second envelope reader to drift from the first.
FWonderlandDeliveryDecode WonderlandDecodeDeliveryBytes(const char* Bytes, int32 Length);

/* ---------------------------------------------------------- the usage */

// The HUD, decoded for `UWonderlandUsageSubsystem::ApplyUsage`.
//
// EVERY FIGURE IS A CARRIER, and that is the point of decoding it separately
// from everything else. `FWonderlandFigure` is `{ bKnown, Value, Reason }`: a
// meter whose capacity arrived as `null` must draw a track and NO REMAINDER,
// and a decoder that mapped by name would hand it 0.0 with bKnown false — which
// renders as an empty meter, a claim that the founder has nothing left.
//
// The REASON travels with the absence. "Not reported" and "stale" are different
// facts about the same missing number, and the HUD says which.
struct FWonderlandUsageDecode
{
	bool bOk = false;
	FWonderlandWireRefusal Refusal;
	FWonderlandUsageHud Hud;
};

FWonderlandUsageDecode WonderlandDecodeUsageBytes(const char* Bytes, int32 Length);

/* ------------------------------------------------------ the hydration */

// THE SNAPSHOT, WHOLE — what `GET /wonderland/julius/hydrate` answers.
//
// The envelope path decodes what CHANGED. This decodes what is TRUE NOW, and it
// is the payload a world joining a run that has been going for an hour, or
// coming back from a dropped link, starts from. A reconnect costs one of these
// plus the tail after the sequence it names — never the transcript.
//
// WHY IT IS ITS OWN ENTRY POINT rather than four calls a client composes. A
// hydration is adopted WHOLESALE: it replaces the run state, both meters, the
// activity, the citation and the C.A.R.D. in one act, and nothing arriving
// afterwards contradicts it. So the cross-field agreement — that the run, the
// activity and the citation all name the project the hydration names, and that
// each meter sits in its own slot — has to be decided BEFORE any of it is
// visible. A client assembling it from parts would have every part decode
// cleanly and the assembly still be a mis-routed picture of somebody else's
// mission, and there would be no later evidence of it.
//
// EVERY HALF IS READ BY THE SAME CODE THAT READS IT ALONE. The activity here is
// the delivery's activity reader; the usage here is the usage entry's reader.
// A second implementation of either would be a second set of rules to drift,
// and drift on this seam is silent by construction.
struct FWonderlandHydrationDecode
{
	bool bOk = false;
	FWonderlandWireRefusal Refusal;
	FWonderlandHydration Hydration;
};

// Decode one hydration. On refusal the hydration is untouched and NOTHING may
// be adopted from it — not the half that parsed, not the meters, not the run.
FWonderlandHydrationDecode WonderlandDecodeHydrationBytes(const char* Bytes, int32 Length);

// The schema this build implements. A payload naming another is refused with
// `SchemaRejected` rather than read against the fields this build happens to
// know — see the enum member for why that is not pedantry.
extern const char* const WonderlandWireHydrationSchema;

// How many members `EWonderlandBrainKind` has, `Unobserved` included.
//
// `FWonderlandBrainCitation::KindCounts` is INDEXED BY ORDINAL and sized to
// this, so `KindCounts[(int32)EWonderlandBrainKind::Finding]` is that kind's
// count with no arithmetic in the caller. An array of nine would need every
// reader to subtract one, and an off-by-one there is exactly the class of
// silent wrongness this file exists to refuse: it would report every kind's
// count under its neighbour's name and look completely plausible.
//
// Slot 0 is `Unobserved`, which is not a kind, and is always zero.
enum : int32 { WonderlandBrainKindSlots = 10 };

/* ------------------------------------------------------- the SSE frame */

// Find the `data:` payload inside one SSE frame.
//
// Part of the path and therefore part of what is proven: a frame is
// `id: …\nevent: …\ndata: …\n\n`, comment lines begin with `:`, and a
// heartbeat carries no data at all. Returns false for a frame with no data
// line — which is not an error, just nothing to apply.
bool WonderlandWireReadSseData(const char* Frame, int32 Length, int32& OutStart, int32& OutLength);

// A refusal as a stable, payload-free string, for a log line. Every value is a
// literal from this file: there is no path by which a project's own text
// reaches a log through this.
const char* WonderlandWireErrorName(EWonderlandWireError Error);

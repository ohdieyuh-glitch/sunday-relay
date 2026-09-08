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
	DuplicateKey
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

// A refusal as a stable, payload-free string, for a log line. Every value is a
// literal from this file: there is no path by which a project's own text
// reaches a log through this.
const char* WonderlandWireErrorName(EWonderlandWireError Error);

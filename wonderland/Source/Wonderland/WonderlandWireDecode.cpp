#include "WonderlandWireDecode.h"

#include <cmath>
#include <cstring>
#include <string>
#include <vector>

/**
 * A STRICT JSON READER, AND A DECODER THAT DEFAULTS NOTHING.
 *
 * The reader below accepts RFC 8259 and refuses several things it permits,
 * every one of them because permitting it would let a payload change what a
 * world believes without saying so:
 *
 *   DUPLICATE KEYS. RFC 8259 leaves them to the implementation. Two `state`
 *   fields would then mean whatever the last writer chose, which is an override
 *   with no audit. Refused.
 *
 *   TRAILING CONTENT. A second value after the first is not a longer document;
 *   it is a second document nobody asked for. Refused.
 *
 *   NaN AND INFINITY. Not JSON, not something Relay sends, and both survive
 *   arithmetic as a value that compares false against everything. Refused.
 *
 *   DEPTH, LENGTH, KEY COUNT. Bounds, so a hostile payload costs a refusal
 *   rather than a stack.
 *
 * `std::string` is used INSIDE the parser and never crosses the boundary,
 * because the engine's FString is UTF-16 and the offline harness's is not — and
 * an implementation that reached into either would compile in one place only.
 * Bytes in, FString out, at exactly one point per field.
 */

namespace
{

enum class EJsonKind : uint8 { Null, Bool, Number, String, Array, Object };

struct FJsonValue
{
	EJsonKind Kind = EJsonKind::Null;
	bool bBool = false;
	double Number = 0.0;
	std::string Text;
	// Objects only. Parallel arrays rather than a map: order is preserved, and
	// the duplicate check below is explicit rather than a side effect of
	// insertion losing one.
	std::vector<std::string> Keys;
	std::vector<FJsonValue> Values;
	// Arrays only.
	std::vector<FJsonValue> Items;
};

struct FParser
{
	const char* Data = nullptr;
	int32 Length = 0;
	int32 At = 0;
	int32 Depth = 0;
	EWonderlandWireError Error = EWonderlandWireError::None;

	bool Fail(EWonderlandWireError Reason)
	{
		if (Error == EWonderlandWireError::None) { Error = Reason; }
		return false;
	}

	void SkipSpace()
	{
		while (At < Length)
		{
			const char C = Data[At];
			if (C == ' ' || C == '\t' || C == '\n' || C == '\r') { At += 1; }
			else { break; }
		}
	}

	bool Literal(const char* Word, int32 WordLength)
	{
		if (At + WordLength > Length) { return Fail(EWonderlandWireError::NotJson); }
		if (std::memcmp(Data + At, Word, static_cast<size_t>(WordLength)) != 0)
		{
			return Fail(EWonderlandWireError::NotJson);
		}
		At += WordLength;
		return true;
	}

	// Four hex digits after \u. Returns false rather than guessing a codepoint.
	bool ReadHex4(unsigned int& Out)
	{
		if (At + 4 > Length) { return Fail(EWonderlandWireError::NotJson); }
		Out = 0;
		for (int32 i = 0; i < 4; i += 1)
		{
			const char C = Data[At + i];
			unsigned int Digit = 0;
			if (C >= '0' && C <= '9') { Digit = static_cast<unsigned int>(C - '0'); }
			else if (C >= 'a' && C <= 'f') { Digit = static_cast<unsigned int>(C - 'a') + 10u; }
			else if (C >= 'A' && C <= 'F') { Digit = static_cast<unsigned int>(C - 'A') + 10u; }
			else { return Fail(EWonderlandWireError::NotJson); }
			Out = (Out << 4) | Digit;
		}
		At += 4;
		return true;
	}

	static void AppendUtf8(std::string& Out, unsigned int Code)
	{
		if (Code < 0x80u) { Out.push_back(static_cast<char>(Code)); }
		else if (Code < 0x800u)
		{
			Out.push_back(static_cast<char>(0xC0u | (Code >> 6)));
			Out.push_back(static_cast<char>(0x80u | (Code & 0x3Fu)));
		}
		else if (Code < 0x10000u)
		{
			Out.push_back(static_cast<char>(0xE0u | (Code >> 12)));
			Out.push_back(static_cast<char>(0x80u | ((Code >> 6) & 0x3Fu)));
			Out.push_back(static_cast<char>(0x80u | (Code & 0x3Fu)));
		}
		else
		{
			Out.push_back(static_cast<char>(0xF0u | (Code >> 18)));
			Out.push_back(static_cast<char>(0x80u | ((Code >> 12) & 0x3Fu)));
			Out.push_back(static_cast<char>(0x80u | ((Code >> 6) & 0x3Fu)));
			Out.push_back(static_cast<char>(0x80u | (Code & 0x3Fu)));
		}
	}

	bool ReadString(std::string& Out)
	{
		if (At >= Length || Data[At] != '"') { return Fail(EWonderlandWireError::NotJson); }
		At += 1;
		Out.clear();
		while (true)
		{
			if (At >= Length) { return Fail(EWonderlandWireError::NotJson); }
			if (static_cast<int32>(Out.size()) > WonderlandWireMaxStringBytes)
			{
				return Fail(EWonderlandWireError::TooLarge);
			}
			const char C = Data[At];
			if (C == '"') { At += 1; return true; }
			if (C == '\\')
			{
				At += 1;
				if (At >= Length) { return Fail(EWonderlandWireError::NotJson); }
				const char Esc = Data[At];
				At += 1;
				switch (Esc)
				{
					case '"': Out.push_back('"'); break;
					case '\\': Out.push_back('\\'); break;
					case '/': Out.push_back('/'); break;
					case 'b': Out.push_back('\b'); break;
					case 'f': Out.push_back('\f'); break;
					case 'n': Out.push_back('\n'); break;
					case 'r': Out.push_back('\r'); break;
					case 't': Out.push_back('\t'); break;
					case 'u':
					{
						unsigned int Code = 0;
						if (!ReadHex4(Code)) { return false; }
						// A leading surrogate must be followed by its pair. A
						// lone one is not a character, and inventing U+FFFD
						// would put a glyph on screen nobody sent.
						if (Code >= 0xD800u && Code <= 0xDBFFu)
						{
							if (At + 1 >= Length || Data[At] != '\\' || Data[At + 1] != 'u')
							{
								return Fail(EWonderlandWireError::NotJson);
							}
							At += 2;
							unsigned int Low = 0;
							if (!ReadHex4(Low)) { return false; }
							if (Low < 0xDC00u || Low > 0xDFFFu) { return Fail(EWonderlandWireError::NotJson); }
							Code = 0x10000u + ((Code - 0xD800u) << 10) + (Low - 0xDC00u);
						}
						else if (Code >= 0xDC00u && Code <= 0xDFFFu)
						{
							return Fail(EWonderlandWireError::NotJson);
						}
						AppendUtf8(Out, Code);
						break;
					}
					default: return Fail(EWonderlandWireError::NotJson);
				}
				continue;
			}
			// Raw control characters are not permitted in a JSON string, and
			// letting one through would put an unprintable byte into an
			// identifier a world compares.
			if (static_cast<unsigned char>(C) < 0x20u) { return Fail(EWonderlandWireError::NotJson); }
			Out.push_back(C);
			At += 1;
		}
	}

	bool ReadNumber(double& Out)
	{
		const int32 Start = At;
		if (At < Length && Data[At] == '-') { At += 1; }
		// JSON forbids a leading zero on a multi-digit integer, and forbids a
		// bare `.5` or `5.`. Accepting them would mean this reader disagrees
		// with the writer about what a number is.
		if (At >= Length) { return Fail(EWonderlandWireError::NotJson); }
		if (Data[At] == '0') { At += 1; }
		else if (Data[At] >= '1' && Data[At] <= '9')
		{
			while (At < Length && Data[At] >= '0' && Data[At] <= '9') { At += 1; }
		}
		else { return Fail(EWonderlandWireError::NotJson); }

		if (At < Length && Data[At] == '.')
		{
			At += 1;
			if (At >= Length || Data[At] < '0' || Data[At] > '9') { return Fail(EWonderlandWireError::NotJson); }
			while (At < Length && Data[At] >= '0' && Data[At] <= '9') { At += 1; }
		}
		if (At < Length && (Data[At] == 'e' || Data[At] == 'E'))
		{
			At += 1;
			if (At < Length && (Data[At] == '+' || Data[At] == '-')) { At += 1; }
			if (At >= Length || Data[At] < '0' || Data[At] > '9') { return Fail(EWonderlandWireError::NotJson); }
			while (At < Length && Data[At] >= '0' && Data[At] <= '9') { At += 1; }
		}

		const std::string Text(Data + Start, static_cast<size_t>(At - Start));
		try { Out = std::stod(Text); }
		catch (...) { return Fail(EWonderlandWireError::NumberOutOfRange); }
		// `1e400` parses and overflows to infinity. A world must never be
		// handed one, whatever the writer meant by it.
		if (!std::isfinite(Out)) { return Fail(EWonderlandWireError::NumberNotFinite); }
		return true;
	}

	bool ReadValue(FJsonValue& Out)
	{
		if (Depth >= WonderlandWireMaxDepth) { return Fail(EWonderlandWireError::TooLarge); }
		SkipSpace();
		if (At >= Length) { return Fail(EWonderlandWireError::NotJson); }

		const char C = Data[At];
		if (C == 'n') { Out.Kind = EJsonKind::Null; return Literal("null", 4); }
		if (C == 't') { Out.Kind = EJsonKind::Bool; Out.bBool = true; return Literal("true", 4); }
		if (C == 'f') { Out.Kind = EJsonKind::Bool; Out.bBool = false; return Literal("false", 5); }
		if (C == '"') { Out.Kind = EJsonKind::String; return ReadString(Out.Text); }
		if (C == '-' || (C >= '0' && C <= '9')) { Out.Kind = EJsonKind::Number; return ReadNumber(Out.Number); }

		if (C == '[')
		{
			Out.Kind = EJsonKind::Array;
			At += 1; Depth += 1;
			SkipSpace();
			if (At < Length && Data[At] == ']') { At += 1; Depth -= 1; return true; }
			while (true)
			{
				FJsonValue Item;
				if (!ReadValue(Item)) { return false; }
				Out.Items.push_back(Item);
				SkipSpace();
				if (At < Length && Data[At] == ',') { At += 1; continue; }
				if (At < Length && Data[At] == ']') { At += 1; Depth -= 1; return true; }
				return Fail(EWonderlandWireError::NotJson);
			}
		}

		if (C == '{')
		{
			Out.Kind = EJsonKind::Object;
			At += 1; Depth += 1;
			SkipSpace();
			if (At < Length && Data[At] == '}') { At += 1; Depth -= 1; return true; }
			while (true)
			{
				SkipSpace();
				std::string Key;
				if (!ReadString(Key)) { return false; }
				for (const std::string& Seen : Out.Keys)
				{
					if (Seen == Key) { return Fail(EWonderlandWireError::DuplicateKey); }
				}
				if (static_cast<int32>(Out.Keys.size()) >= WonderlandWireMaxKeys)
				{
					return Fail(EWonderlandWireError::TooLarge);
				}
				SkipSpace();
				if (At >= Length || Data[At] != ':') { return Fail(EWonderlandWireError::NotJson); }
				At += 1;
				FJsonValue Value;
				if (!ReadValue(Value)) { return false; }
				Out.Keys.push_back(Key);
				Out.Values.push_back(Value);
				SkipSpace();
				if (At < Length && Data[At] == ',') { At += 1; continue; }
				if (At < Length && Data[At] == '}') { At += 1; Depth -= 1; return true; }
				return Fail(EWonderlandWireError::NotJson);
			}
		}

		return Fail(EWonderlandWireError::NotJson);
	}
};

const FJsonValue* Field(const FJsonValue& Object, const char* Name)
{
	for (size_t i = 0; i < Object.Keys.size(); i += 1)
	{
		if (Object.Keys[i] == Name) { return &Object.Values[i]; }
	}
	return nullptr;
}

/* ------------------------------------------------- typed field readers */

struct FFieldReader
{
	const FJsonValue& Object;
	FWonderlandWireRefusal& Refusal;
	bool bFailed = false;

	// RECORDS THE FIRST REASON AND SETS bFailed ITSELF. Setting bFailed before
	// calling this SILENCES the reason — the refusal then comes back with
	// `None`, which reads as "no error" and is exactly the quiet failure this
	// file exists to prevent. It happened here, and the harness caught it.
	bool Reject(EWonderlandWireError Error, const char* Name)
	{
		if (!bFailed)
		{
			bFailed = true;
			Refusal.Error = Error;
			// OUR literal, never the payload's text.
			Refusal.Field = FString(Name);
		}
		return false;
	}

	// A required string. Absent, null, or any other type is a refusal — this is
	// how MISSING stays different from EMPTY.
	bool RequiredString(const char* Name, FString& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind != EJsonKind::String) { return Reject(EWonderlandWireError::WrongType, Name); }
		Out = FString(Value->Text.c_str());
		return true;
	}

	// A required, non-blank identifier. Blank is structurally a string and
	// semantically nothing, and a world cannot be scoped to nothing.
	bool RequiredIdentity(const char* Name, FString& Out)
	{
		if (!RequiredString(Name, Out)) { return false; }
		// Checked on the PARSED BYTES rather than through FString, which has no
		// trimming in either build. Whitespace-only is rejected as well as
		// empty: a world scoped to "   " is scoped to nothing, and the space
		// would make it look scoped in every log that printed it.
		const FJsonValue* Value = Field(Object, Name);
		bool bHasContent = false;
		for (char C : Value->Text)
		{
			if (C != ' ' && C != '\t' && C != '\n' && C != '\r') { bHasContent = true; break; }
		}
		if (!bHasContent) { return Reject(EWonderlandWireError::IdentityRejected, Name); }
		return true;
	}

	// A nullable string, into its carrier. null is KNOWN-TO-BE-ABSENT; a
	// missing key is a malformed envelope, and the two are not the same.
	bool NullableText(const char* Name, FWonderlandText& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind == EJsonKind::Null) { Out.bKnown = false; Out.Value = FString(""); return true; }
		if (Value->Kind != EJsonKind::String) { return Reject(EWonderlandWireError::WrongType, Name); }
		Out.bKnown = true;
		Out.Value = FString(Value->Text.c_str());
		return true;
	}

	bool RequiredBool(const char* Name, bool& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind != EJsonKind::Bool) { return Reject(EWonderlandWireError::WrongType, Name); }
		Out = Value->bBool;
		return true;
	}

	// A whole number, in the range a double represents exactly. Beyond
	// 2^53 a double silently rounds, so a sequence past it would compare equal
	// to its neighbour and ordering would stop working — refused instead.
	bool RequiredInteger(const char* Name, int64& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind != EJsonKind::Number) { return Reject(EWonderlandWireError::WrongType, Name); }
		const double N = Value->Number;
		if (!std::isfinite(N)) { return Reject(EWonderlandWireError::NumberNotFinite, Name); }
		if (N != std::floor(N)) { return Reject(EWonderlandWireError::NumberNotInteger, Name); }
		if (N > 9007199254740991.0 || N < -9007199254740991.0)
		{
			return Reject(EWonderlandWireError::NumberOutOfRange, Name);
		}
		Out = static_cast<int64>(N);
		return true;
	}

	// A nullable whole number, into its carrier. Null is KNOWN-TO-BE-ABSENT and
	// leaves the carrier's Value at zero WITH bKnown false — which is the whole
	// reason the carrier exists. `activeTasks: null` is "nobody counted", and a
	// decoder that wrote 0 with bKnown true would draw "no tasks are running",
	// a different and confident claim.
	bool NullableInteger(const char* Name, FWonderlandNumber& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind == EJsonKind::Null) { Out.bKnown = false; Out.Value = 0.0; return true; }
		if (Value->Kind != EJsonKind::Number) { return Reject(EWonderlandWireError::WrongType, Name); }
		const double N = Value->Number;
		if (!std::isfinite(N)) { return Reject(EWonderlandWireError::NumberNotFinite, Name); }
		if (N != std::floor(N)) { return Reject(EWonderlandWireError::NumberNotInteger, Name); }
		if (N > 9007199254740991.0 || N < -9007199254740991.0)
		{
			return Reject(EWonderlandWireError::NumberOutOfRange, Name);
		}
		Out.bKnown = true;
		// The carrier holds a double. Assigned DIRECTLY rather than through an
		// int64: the range check above is what makes the value exact, and a
		// round trip through an integer type would add a second conversion with
		// nothing to gain from it.
		Out.Value = N;
		return true;
	}

	// A nullable bool, into its carrier. THE THREE-WAY FIELD, and the one a
	// name-matching converter destroys most quietly: `hasCodingAgent: null` is
	// "nobody could resolve the C.A.R.D.", `false` is "the slot is empty", and
	// a bool cannot hold both. Only bKnown && !bValue is an empty slot.
	bool NullableFlag(const char* Name, FWonderlandFlag& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind == EJsonKind::Null) { Out.bKnown = false; Out.bValue = false; return true; }
		if (Value->Kind != EJsonKind::Bool) { return Reject(EWonderlandWireError::WrongType, Name); }
		Out.bKnown = true;
		Out.bValue = Value->bBool;
		return true;
	}

	// An enum whose wire value may be null. Null means Relay reported nothing
	// and lands on the zero member BY DESIGN; an unrecognised string does not.
	bool NullableEnum(const char* Name, const char* EnumName, uint8& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind == EJsonKind::Null) { Out = 0; return true; }
		if (Value->Kind != EJsonKind::String) { return Reject(EWonderlandWireError::WrongType, Name); }
		uint8 Found = 0;
		if (!WonderlandWireLookupToken(EnumName, FString(Value->Text.c_str()), Found))
		{
			return Reject(EWonderlandWireError::UnknownToken, Name);
		}
		Out = Found;
		return true;
	}

	// An enum that must be present and must name something. There is no
	// fallback: leaving it at zero would report `Unobserved`, which is a claim
	// that Relay said nothing when in fact Relay said something unreadable.
	bool RequiredEnum(const char* Name, const char* EnumName, uint8& Out)
	{
		const FJsonValue* Value = Field(Object, Name);
		if (Value == nullptr) { return Reject(EWonderlandWireError::MissingField, Name); }
		if (Value->Kind != EJsonKind::String) { return Reject(EWonderlandWireError::WrongType, Name); }
		uint8 Found = 0;
		if (!WonderlandWireLookupToken(EnumName, FString(Value->Text.c_str()), Found))
		{
			return Reject(EWonderlandWireError::UnknownToken, Name);
		}
		Out = Found;
		return true;
	}
};

} // namespace

/* ---------------------------------------------------------- the tables */

bool WonderlandWireLookupToken(const char* EnumName, const FString& Token, uint8& OutValue)
{
	for (int32 t = 0; t < WonderlandWireEnumTableCount; t += 1)
	{
		const FWonderlandWireEnumTable& Table = WonderlandWireEnumTables[t];
		if (std::strcmp(Table.EnumName, EnumName) != 0) { continue; }
		for (int32 i = 0; i < Table.Count; i += 1)
		{
			if (Token == FString(Table.Tokens[i].Token))
			{
				OutValue = Table.Tokens[i].Value;
				return true;
			}
		}
		return false;
	}
	return false;
}

const char* WonderlandWireErrorName(EWonderlandWireError Error)
{
	switch (Error)
	{
		case EWonderlandWireError::None: return "none";
		case EWonderlandWireError::NotJson: return "not_json";
		case EWonderlandWireError::NotObject: return "not_object";
		case EWonderlandWireError::MissingField: return "missing_field";
		case EWonderlandWireError::WrongType: return "wrong_type";
		case EWonderlandWireError::UnknownToken: return "unknown_token";
		case EWonderlandWireError::NumberNotFinite: return "number_not_finite";
		case EWonderlandWireError::NumberNotInteger: return "number_not_integer";
		case EWonderlandWireError::NumberOutOfRange: return "number_out_of_range";
		case EWonderlandWireError::IdentityRejected: return "identity_rejected";
		case EWonderlandWireError::TooLarge: return "too_large";
		case EWonderlandWireError::DuplicateKey: return "duplicate_key";
		case EWonderlandWireError::SchemaRejected: return "schema_rejected";
	}
	return "none";
}

/* --------------------------------------------------------- the envelope */

namespace
{

// Parse bytes into one JSON value, with every document-level rule applied.
bool ParseDocument(const char* Bytes, int32 Length, FJsonValue& Out, EWonderlandWireError& Error)
{
	if (Bytes == nullptr || Length <= 0) { Error = EWonderlandWireError::NotJson; return false; }
	if (Length > WonderlandWireMaxBytes) { Error = EWonderlandWireError::TooLarge; return false; }

	FParser Parser;
	Parser.Data = Bytes;
	Parser.Length = Length;
	if (!Parser.ReadValue(Out)) { Error = Parser.Error; return false; }
	Parser.SkipSpace();
	// A second value after the first is a second document, not a longer one.
	if (Parser.At != Parser.Length) { Error = EWonderlandWireError::NotJson; return false; }
	if (Out.Kind != EJsonKind::Object) { Error = EWonderlandWireError::NotObject; return false; }
	return true;
}

// The envelope, from an object already parsed. ONE implementation, used by both
// the bare-envelope entry point and the delivery one — a second reader would be
// a second set of rules to drift.
FWonderlandEnvelopeDecode DecodeEnvelopeObject(const FJsonValue& Root)
{
	FWonderlandEnvelopeDecode Result;
	FWonderlandEnvelope Envelope;
	FFieldReader Reader{ Root, Result.Refusal };

	// IDENTITY FIRST, and the whole of it before anything else is read. A
	// subsystem must never be handed a partly-decoded envelope, and a caller
	// that stopped at the first readable field would have one.
	Reader.RequiredString("schemaVersion", Envelope.SchemaVersion);
	Reader.RequiredIdentity("eventId", Envelope.EventId);
	Reader.RequiredIdentity("projectId", Envelope.ProjectId);

	Reader.NullableText("worldSessionId", Envelope.WorldSessionId);
	Reader.NullableText("juliusInstanceId", Envelope.JuliusInstanceId);
	Reader.NullableText("missionId", Envelope.MissionId);
	Reader.NullableText("runId", Envelope.RunId);
	Reader.NullableText("taskId", Envelope.TaskId);
	Reader.NullableText("sourceState", Envelope.SourceState);

	uint8 WorkerRole = 0;
	uint8 State = 0;
	uint8 StateSource = 0;
	Reader.NullableEnum("workerRole", "EWonderlandWorkerRole", WorkerRole);
	Reader.RequiredEnum("state", "EWonderlandJuliusState", State);
	Reader.RequiredEnum("stateSource", "EWonderlandJuliusStateSource", StateSource);

	Reader.RequiredBool("terminal", Envelope.bTerminal);

	int64 Sequence = 0;
	int64 Revision = 0;
	int64 MetadataDropped = 0;
	Reader.RequiredInteger("sequence", Sequence);
	Reader.RequiredInteger("revision", Revision);
	Reader.RequiredInteger("metadataDropped", MetadataDropped);
	Reader.RequiredString("occurredAt", Envelope.OccurredAt);

	// METADATA IS SCALARS ONLY, and this is the second place that is enforced —
	// Relay's sanitiser is the first. A nested object or array here is a payload
	// that did not come through the sanitiser, and it is refused rather than
	// flattened into something a renderer would print.
	const FJsonValue* Metadata = Field(Root, "metadata");
	if (Metadata == nullptr) { Reader.Reject(EWonderlandWireError::MissingField, "metadata"); }
	else if (Metadata->Kind != EJsonKind::Object) { Reader.Reject(EWonderlandWireError::WrongType, "metadata"); }
	else
	{
		for (size_t i = 0; i < Metadata->Keys.size() && !Reader.bFailed; i += 1)
		{
			const FJsonValue& Item = Metadata->Values[i];
			if (Item.Kind == EJsonKind::Array || Item.Kind == EJsonKind::Object)
			{
				Reader.Reject(EWonderlandWireError::WrongType, "metadata");
				break;
			}
			// Represented as strings because Blueprint has no sum type. The
			// Relay side guarantees each was a string, number, bool or null.
			std::string Text;
			if (Item.Kind == EJsonKind::String) { Text = Item.Text; }
			else if (Item.Kind == EJsonKind::Bool) { Text = Item.bBool ? "true" : "false"; }
			else if (Item.Kind == EJsonKind::Null) { Text = "null"; }
			else
			{
				if (!std::isfinite(Item.Number))
				{
					Reader.Reject(EWonderlandWireError::NumberNotFinite, "metadata");
					break;
				}
				Text = std::to_string(Item.Number);
			}
			Envelope.Metadata.Add(FString(Metadata->Keys[i].c_str()), FString(Text.c_str()));
		}
	}

	if (Reader.bFailed) { return Result; }

	// Ranges LAST, after every field has been read, so the refusal names the
	// field that is wrong rather than the first one that happened to be read.
	if (Sequence < 0) { Result.Refusal = { EWonderlandWireError::NumberOutOfRange, FString("sequence") }; return Result; }
	if (Revision < 0) { Result.Refusal = { EWonderlandWireError::NumberOutOfRange, FString("revision") }; return Result; }
	if (MetadataDropped < 0) { Result.Refusal = { EWonderlandWireError::NumberOutOfRange, FString("metadataDropped") }; return Result; }

	Envelope.WorkerRole = static_cast<EWonderlandWorkerRole>(WorkerRole);
	Envelope.State = static_cast<EWonderlandJuliusState>(State);
	Envelope.StateSource = static_cast<EWonderlandJuliusStateSource>(StateSource);
	Envelope.Sequence = Sequence;
	Envelope.Revision = Revision;
	Envelope.MetadataDropped = MetadataDropped;

	Result.bOk = true;
	Result.Envelope = Envelope;
	return Result;
}

// The activity reading, from an object already parsed. ONE implementation,
// shared by the delivery path and the hydration path — a second reader would be
// a second set of rules, and the rules here (an unknown signal refuses rather
// than being skipped) are exactly the kind that drift quietly.
//
// IT DOES NOT CHECK IDENTITY. Whose run this belongs to is a question about the
// PAYLOAD AROUND IT — the envelope beside it, or the hydration above it — and
// each caller answers it against what it actually has.
bool DecodeActivityObject(
	const FJsonValue& Object,
	FWonderlandWireRefusal& Refusal,
	FWonderlandActivityReading& Out)
{
	FWonderlandActivityReading Activity;
	FFieldReader Reader{ Object, Refusal };
	Reader.RequiredString("schemaVersion", Activity.SchemaVersion);
	Reader.RequiredIdentity("projectId", Activity.ProjectId);
	Reader.RequiredString("runId", Activity.RunId);
	Reader.NullableText("observedAtIso", Activity.ObservedAtIso);

	int64 ActiveSubagents = 0;
	int64 SubagentsDenied = 0;
	int64 UnusedEvents = 0;
	Reader.RequiredInteger("activeSubagents", ActiveSubagents);
	Reader.RequiredInteger("subagentsDenied", SubagentsDenied);
	Reader.RequiredInteger("unusedEvents", UnusedEvents);

	// SIGNALS. Every member is looked up, and an unknown one is refused rather
	// than skipped: a signal Relay raised and this build cannot name is a world
	// showing LESS than is true, which reads as a calm run.
	const FJsonValue* Signals = Field(Object, "signals");
	if (Signals == nullptr) { Reader.Reject(EWonderlandWireError::MissingField, "signals"); }
	else if (Signals->Kind != EJsonKind::Array) { Reader.Reject(EWonderlandWireError::WrongType, "signals"); }
	else
	{
		for (const FJsonValue& Item : Signals->Items)
		{
			if (Item.Kind != EJsonKind::String)
			{
				Reader.Reject(EWonderlandWireError::WrongType, "signals");
				break;
			}
			uint8 Found = 0;
			if (!WonderlandWireLookupToken("EWonderlandActivitySignal", FString(Item.Text.c_str()), Found))
			{
				Reader.Reject(EWonderlandWireError::UnknownToken, "signals");
				break;
			}
			Activity.Signals.Add(static_cast<EWonderlandActivitySignal>(Found));
		}
	}

	// WORKERS. The per-worker fold, same rule for its own signals.
	const FJsonValue* Workers = Field(Object, "workers");
	if (Workers == nullptr) { Reader.Reject(EWonderlandWireError::MissingField, "workers"); }
	else if (Workers->Kind != EJsonKind::Array) { Reader.Reject(EWonderlandWireError::WrongType, "workers"); }
	else
	{
		for (const FJsonValue& Item : Workers->Items)
		{
			if (Reader.bFailed) { break; }
			if (Item.Kind != EJsonKind::Object)
			{
				Reader.Reject(EWonderlandWireError::WrongType, "workers");
				break;
			}
			FWonderlandWorkerActivity Worker;
			FFieldReader WorkerReader{ Item, Refusal };
			WorkerReader.RequiredIdentity("workerId", Worker.WorkerId);
			if (WorkerReader.bFailed) { Reader.bFailed = true; break; }

			const FJsonValue* WorkerSignals = Field(Item, "signals");
			if (WorkerSignals == nullptr || WorkerSignals->Kind != EJsonKind::Array)
			{
				Reader.Reject(EWonderlandWireError::MissingField, "workers.signals");
				break;
			}
			for (const FJsonValue& Signal : WorkerSignals->Items)
			{
				if (Signal.Kind != EJsonKind::String)
				{
					Reader.Reject(EWonderlandWireError::WrongType, "workers.signals");
					break;
				}
				uint8 Found = 0;
				if (!WonderlandWireLookupToken("EWonderlandActivitySignal", FString(Signal.Text.c_str()), Found))
				{
					Reader.Reject(EWonderlandWireError::UnknownToken, "workers.signals");
					break;
				}
				Worker.Signals.Add(static_cast<EWonderlandActivitySignal>(Found));
			}
			if (Reader.bFailed) { break; }
			Activity.Workers.Add(Worker);
		}
	}

	if (Reader.bFailed) { return false; }

	// Counts are counts. A negative one is not a smaller number, it is a
	// different kind of thing, and it would render as a subagent that unspawned.
	if (ActiveSubagents < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("activeSubagents") }; return false; }
	if (SubagentsDenied < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("subagentsDenied") }; return false; }
	if (UnusedEvents < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("unusedEvents") }; return false; }

	Activity.ActiveSubagents = ActiveSubagents;
	Activity.SubagentsDenied = SubagentsDenied;
	Activity.UnusedEvents = UnusedEvents;
	Out = Activity;
	return true;
}

} // namespace

FWonderlandEnvelopeDecode WonderlandDecodeEnvelopeBytes(const char* Bytes, int32 Length)
{
	FWonderlandEnvelopeDecode Result;
	FJsonValue Root;
	EWonderlandWireError Error = EWonderlandWireError::None;
	if (!ParseDocument(Bytes, Length, Root, Error))
	{
		Result.Refusal.Error = Error;
		return Result;
	}
	return DecodeEnvelopeObject(Root);
}

/* --------------------------------------------------------- the delivery */

FWonderlandDeliveryDecode WonderlandDecodeDeliveryBytes(const char* Bytes, int32 Length)
{
	FWonderlandDeliveryDecode Result;

	FJsonValue Root;
	EWonderlandWireError Error = EWonderlandWireError::None;
	if (!ParseDocument(Bytes, Length, Root, Error))
	{
		Result.Refusal.Error = Error;
		return Result;
	}

	const FJsonValue* EnvelopeValue = Field(Root, "envelope");
	if (EnvelopeValue == nullptr)
	{
		Result.Refusal = { EWonderlandWireError::MissingField, FString("envelope") };
		return Result;
	}
	if (EnvelopeValue->Kind != EJsonKind::Object)
	{
		Result.Refusal = { EWonderlandWireError::WrongType, FString("envelope") };
		return Result;
	}

	// THE SAME READER, not a second one. Every rule proven for a bare envelope
	// holds here without being restated.
	const FWonderlandEnvelopeDecode Envelope = DecodeEnvelopeObject(*EnvelopeValue);
	if (!Envelope.bOk)
	{
		Result.Refusal = Envelope.Refusal;
		return Result;
	}

	const FJsonValue* ActivityValue = Field(Root, "activity");
	if (ActivityValue == nullptr)
	{
		Result.Refusal = { EWonderlandWireError::MissingField, FString("activity") };
		return Result;
	}
	if (ActivityValue->Kind != EJsonKind::Object)
	{
		Result.Refusal = { EWonderlandWireError::WrongType, FString("activity") };
		return Result;
	}

	FWonderlandActivityReading Activity;
	if (!DecodeActivityObject(*ActivityValue, Result.Refusal, Activity)) { return Result; }

	// THE TWO HALVES MUST AGREE ABOUT WHOSE RUN THIS IS. A delivery whose
	// activity named another project would push one run's signals onto another's
	// world, and every downstream check compares against the envelope alone.
	if (!(Activity.ProjectId == Envelope.Envelope.ProjectId))
	{
		Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("activity.projectId") };
		return Result;
	}
	if (Envelope.Envelope.RunId.bKnown && !(Activity.RunId == Envelope.Envelope.RunId.Value))
	{
		Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("activity.runId") };
		return Result;
	}

	Result.bOk = true;
	Result.Envelope = Envelope.Envelope;
	Result.Activity = Activity;
	return Result;
}

/* -------------------------------------------------------- the SSE frame */

bool WonderlandWireReadSseData(const char* Frame, int32 Length, int32& OutStart, int32& OutLength)
{
	OutStart = 0;
	OutLength = 0;
	if (Frame == nullptr || Length <= 0) { return false; }

	int32 At = 0;
	while (At < Length)
	{
		int32 LineEnd = At;
		while (LineEnd < Length && Frame[LineEnd] != '\n') { LineEnd += 1; }

		// `: heartbeat` is a comment line and carries nothing to apply. Not an
		// error — a stream that says nothing is still a live stream.
		const int32 LineLength = LineEnd - At;
		if (LineLength >= 5 && std::memcmp(Frame + At, "data:", 5) == 0)
		{
			int32 Start = At + 5;
			// Exactly one optional space after the colon, per the SSE grammar.
			if (Start < LineEnd && Frame[Start] == ' ') { Start += 1; }
			OutStart = Start;
			OutLength = LineEnd - Start;
			// A `data:` line with nothing after it is an empty payload, which
			// is not a document — reported as no data rather than as JSON.
			return OutLength > 0;
		}
		At = LineEnd + 1;
	}
	return false;
}

/* ------------------------------------------------------------ the usage */

namespace
{

// A figure, with its absence and the REASON for it. Three fields, and getting
// any of them wrong draws a number the founder does not have.
bool ReadFigure(const FJsonValue& Owner, const char* Name, FFieldReader& Reader, FWonderlandFigure& Out)
{
	const FJsonValue* Value = Field(Owner, Name);
	if (Value == nullptr) { return Reader.Reject(EWonderlandWireError::MissingField, Name); }
	if (Value->Kind != EJsonKind::Object) { return Reader.Reject(EWonderlandWireError::WrongType, Name); }

	FFieldReader Inner{ *Value, Reader.Refusal };
	bool bKnown = false;
	if (!Inner.RequiredBool("known", bKnown)) { Reader.bFailed = true; return false; }

	const FJsonValue* Number = Field(*Value, "value");
	if (Number == nullptr) { return Reader.Reject(EWonderlandWireError::MissingField, Name); }

	if (bKnown)
	{
		// KNOWN AND NULL IS A CONTRADICTION, and the one worth refusing: it is
		// the shape a partly-written report has, and accepting it would draw
		// 0.0 as a measurement.
		if (Number->Kind != EJsonKind::Number)
		{
			return Reader.Reject(EWonderlandWireError::WrongType, Name);
		}
		if (!std::isfinite(Number->Number))
		{
			return Reader.Reject(EWonderlandWireError::NumberNotFinite, Name);
		}
		Out.bKnown = true;
		Out.Value = Number->Number;
	}
	else
	{
		// UNKNOWN AND A VALUE is the other contradiction. A figure that says it
		// was not observed and carries a number would let a renderer read
		// either half and get a different answer.
		if (Number->Kind != EJsonKind::Null)
		{
			return Reader.Reject(EWonderlandWireError::WrongType, Name);
		}
		Out.bKnown = false;
		Out.Value = 0.0;
	}

	// The reason for the absence. Null means Relay did not say WHY, which is
	// itself an answer and maps to the zero member.
	uint8 Reason = 0;
	if (!Inner.NullableEnum("reason", "EWonderlandUnknownReason", Reason))
	{
		Reader.bFailed = true;
		return false;
	}
	Out.Reason = static_cast<EWonderlandUnknownReason>(Reason);
	return true;
}

bool ReadMeter(const FJsonValue& Owner, const char* Name, FFieldReader& Reader, FWonderlandUsageMeter& Out)
{
	const FJsonValue* Value = Field(Owner, Name);
	if (Value == nullptr) { return Reader.Reject(EWonderlandWireError::MissingField, Name); }
	if (Value->Kind != EJsonKind::Object) { return Reader.Reject(EWonderlandWireError::WrongType, Name); }

	FFieldReader Meter{ *Value, Reader.Refusal };
	Meter.RequiredString("schemaVersion", Out.SchemaVersion);
	Meter.RequiredString("observedAtIso", Out.ObservedAtIso);
	Meter.NullableText("tierId", Out.TierId);
	Meter.NullableText("tierLabel", Out.TierLabel);
	Meter.NullableText("unitLabel", Out.UnitLabel);
	Meter.NullableText("unavailableReason", Out.UnavailableReason);

	uint8 Channel = 0;
	uint8 Status = 0;
	uint8 Provenance = 0;
	uint8 Anchor = 0;
	Meter.RequiredEnum("channel", "EWonderlandUsageChannel", Channel);
	Meter.RequiredEnum("status", "EWonderlandUsageStatus", Status);
	Meter.RequiredEnum("provenance", "EWonderlandProvenance", Provenance);
	Meter.RequiredEnum("anchor", "EWonderlandHudAnchor", Anchor);
	Meter.RequiredBool("simulated", Out.bSimulated);

	ReadFigure(*Value, "capacityUnits", Meter, Out.CapacityUnits);
	ReadFigure(*Value, "usedUnits", Meter, Out.UsedUnits);
	ReadFigure(*Value, "remainingUnits", Meter, Out.RemainingUnits);
	ReadFigure(*Value, "referenceCapacityUnits", Meter, Out.ReferenceCapacityUnits);
	ReadFigure(*Value, "capacitySpan", Meter, Out.CapacitySpan);
	ReadFigure(*Value, "fillFraction", Meter, Out.FillFraction);
	ReadFigure(*Value, "remainingFraction", Meter, Out.RemainingFraction);

	if (Meter.bFailed) { Reader.bFailed = true; return false; }

	Out.Channel = static_cast<EWonderlandUsageChannel>(Channel);
	Out.Status = static_cast<EWonderlandUsageStatus>(Status);
	Out.Provenance = static_cast<EWonderlandProvenance>(Provenance);
	Out.Anchor = static_cast<EWonderlandHudAnchor>(Anchor);
	return true;
}

// The HUD, from an object already parsed. ONE implementation, shared by the
// usage entry point and the hydration path.
//
// THE CHANNEL CHECK IS PART OF IT rather than of the caller. The two meters
// are not interchangeable, and a hydration that composed the reader without
// the check would be exactly as swappable as a bare payload — every number on
// screen real, and every one attributed to the wrong instrument.
bool DecodeUsageHudObject(
	const FJsonValue& Object,
	FWonderlandWireRefusal& Refusal,
	FWonderlandUsageHud& Out)
{
	FWonderlandUsageHud Hud;
	FFieldReader Reader{ Object, Refusal };
	Reader.RequiredString("schemaVersion", Hud.SchemaVersion);
	Reader.RequiredString("observedAtIso", Hud.ObservedAtIso);

	uint8 Anchor = 0;
	Reader.RequiredEnum("anchor", "EWonderlandHudAnchor", Anchor);

	ReadMeter(Object, "compoundAgent", Reader, Hud.CompoundAgent);
	ReadMeter(Object, "singleAgent", Reader, Hud.SingleAgent);

	if (Reader.bFailed) { return false; }

	// THE TWO METERS ARE NOT INTERCHANGEABLE, and this is the second line of
	// defence for it — `wonderlandHydrationVerdict` is the first. Swapped, the
	// green Compound arc would draw the single agent's spend and the blue one
	// the compound's, and every number on screen would be real and attributed
	// to the wrong instrument.
	if (Hud.CompoundAgent.Channel != EWonderlandUsageChannel::CompoundAgent)
	{
		Refusal = { EWonderlandWireError::IdentityRejected, FString("compoundAgent.channel") };
		return false;
	}
	if (Hud.SingleAgent.Channel != EWonderlandUsageChannel::SingleAgent)
	{
		Refusal = { EWonderlandWireError::IdentityRejected, FString("singleAgent.channel") };
		return false;
	}

	Hud.Anchor = static_cast<EWonderlandHudAnchor>(Anchor);
	Out = Hud;
	return true;
}

} // namespace

FWonderlandUsageDecode WonderlandDecodeUsageBytes(const char* Bytes, int32 Length)
{
	FWonderlandUsageDecode Result;

	FJsonValue Root;
	EWonderlandWireError Error = EWonderlandWireError::None;
	if (!ParseDocument(Bytes, Length, Root, Error))
	{
		Result.Refusal.Error = Error;
		return Result;
	}

	FWonderlandUsageHud Hud;
	if (!DecodeUsageHudObject(Root, Result.Refusal, Hud)) { return Result; }

	Result.bOk = true;
	Result.Hud = Hud;
	return Result;
}

/* ------------------------------------------------------- the hydration */

const char* const WonderlandWireHydrationSchema = "relay-wonderland-hydration.v1";

namespace
{

// The run, from an object already parsed.
//
// `State` IS READ AS TEXT and that is deliberate: nothing in the world switches
// on a thirteen-member run-state vocabulary, the drawable state rides on the
// envelope, and a mirrored enum nobody reads is a migration cost with no
// reader. Reading it as a token would also make a kernel that learned a
// fourteenth state refuse a hydration it has no other reason to refuse.
bool DecodeRunSnapshotObject(
	const FJsonValue& Object,
	FWonderlandWireRefusal& Refusal,
	FWonderlandRunSnapshot& Out)
{
	FWonderlandRunSnapshot Run;
	FFieldReader Reader{ Object, Refusal };
	Reader.RequiredString("schemaVersion", Run.SchemaVersion);
	Reader.RequiredIdentity("projectId", Run.ProjectId);
	Reader.RequiredIdentity("runId", Run.RunId);
	Reader.NullableText("juliusInstanceId", Run.JuliusInstanceId);
	Reader.NullableText("missionId", Run.MissionId);
	Reader.RequiredString("state", Run.State);
	Reader.RequiredString("observedAtIso", Run.ObservedAtIso);

	int64 Revision = 0;
	Reader.RequiredInteger("revision", Revision);

	// THE THREE CARRIERS, and every one of them is a place a name-matching
	// converter would draw a confident zero. `atSequence: null` is "the reader
	// could not say where this sits"; `activeTasks: null` is "nobody counted".
	// Neither is a count of nothing.
	Reader.NullableInteger("atSequence", Run.AtSequence);
	Reader.NullableInteger("activeTasks", Run.ActiveTasks);
	Reader.NullableInteger("pendingApprovals", Run.PendingApprovals);

	if (Reader.bFailed) { return false; }

	// Ranges after every field, so a refusal names the field that is wrong
	// rather than the first one read.
	if (Revision < 0)
	{
		Refusal = { EWonderlandWireError::NumberOutOfRange, FString("run.revision") };
		return false;
	}
	// A NEGATIVE POSITION IS NOT A SMALL ONE. Adopted, it would make the world
	// resume from before the beginning and replay a run it has already seen —
	// and every event of that replay would look new.
	if (Run.AtSequence.bKnown && Run.AtSequence.Value < 0.0)
	{
		Refusal = { EWonderlandWireError::NumberOutOfRange, FString("run.atSequence") };
		return false;
	}
	if (Run.ActiveTasks.bKnown && Run.ActiveTasks.Value < 0.0)
	{
		Refusal = { EWonderlandWireError::NumberOutOfRange, FString("run.activeTasks") };
		return false;
	}
	if (Run.PendingApprovals.bKnown && Run.PendingApprovals.Value < 0.0)
	{
		Refusal = { EWonderlandWireError::NumberOutOfRange, FString("run.pendingApprovals") };
		return false;
	}

	Run.Revision = Revision;
	Out = Run;
	return true;
}

// How much to believe the meters. Relay's verdict, carried verbatim.
//
// THE COUNTERS ARE CARRIED, not summed into one. A mis-routed fan-out, a schema
// drift and ordinary replay traffic are three problems, and one counter would
// present them as one.
bool DecodeUsageStatusObject(
	const FJsonValue& Object,
	FWonderlandWireRefusal& Refusal,
	FWonderlandUsageAuthorityStatus& Out)
{
	FWonderlandUsageAuthorityStatus Status;
	FFieldReader Reader{ Object, Refusal };

	uint8 Reading = 0;
	Reader.RequiredEnum("reading", "EWonderlandUsageReading", Reading);
	Reader.NullableText("reason", Status.Reason);
	Reader.NullableText("authorityId", Status.AuthorityId);

	// AGE IS A DOUBLE ON THE WIRE — a fraction of a second is a legitimate age,
	// unlike a sequence — so it is read as a figure rather than through the
	// whole-number reader, which would refuse 1.5 as "not an integer".
	const FJsonValue* Age = Field(Object, "ageSeconds");
	if (Age == nullptr) { Reader.Reject(EWonderlandWireError::MissingField, "ageSeconds"); }
	else if (Age->Kind == EJsonKind::Null) { Status.AgeSeconds.bKnown = false; Status.AgeSeconds.Value = 0.0; }
	else if (Age->Kind != EJsonKind::Number) { Reader.Reject(EWonderlandWireError::WrongType, "ageSeconds"); }
	else if (!std::isfinite(Age->Number)) { Reader.Reject(EWonderlandWireError::NumberNotFinite, "ageSeconds"); }
	else if (Age->Number < 0.0) { Reader.Reject(EWonderlandWireError::NumberOutOfRange, "ageSeconds"); }
	else { Status.AgeSeconds.bKnown = true; Status.AgeSeconds.Value = Age->Number; }

	int64 Revision = 0;
	int64 Foreign = 0;
	int64 Stale = 0;
	int64 Malformed = 0;
	Reader.RequiredInteger("revision", Revision);
	Reader.RequiredInteger("foreignProjectReportsRejected", Foreign);
	Reader.RequiredInteger("staleRevisionsRejected", Stale);
	Reader.RequiredInteger("malformedReportsRejected", Malformed);

	if (Reader.bFailed) { return false; }

	if (Revision < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("usageStatus.revision") }; return false; }
	if (Foreign < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("usageStatus.foreignProjectReportsRejected") }; return false; }
	if (Stale < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("usageStatus.staleRevisionsRejected") }; return false; }
	if (Malformed < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("usageStatus.malformedReportsRejected") }; return false; }

	Status.Reading = static_cast<EWonderlandUsageReading>(Reading);
	Status.Revision = Revision;
	Status.ForeignProjectReportsRejected = Foreign;
	Status.StaleRevisionsRejected = Stale;
	Status.MalformedReportsRejected = Malformed;
	Out = Status;
	return true;
}

// The Project Brain citation: counts, revisions and opaque handles.
//
// WHAT IS NOT HERE IS THE POINT. There is no entry text, no summary, no title
// — the struct has nowhere to put one, and this reader has no expression that
// could copy one if a bridge started sending it. A world learns THAT context
// was retrieved and how much of it; the substance of somebody's work stays out
// of the least trusted process in the system.
bool DecodeBrainCitationObject(
	const FJsonValue& Object,
	FWonderlandWireRefusal& Refusal,
	FWonderlandBrainCitation& Out)
{
	FWonderlandBrainCitation Brain;
	FFieldReader Reader{ Object, Refusal };
	Reader.RequiredString("schemaVersion", Brain.SchemaVersion);
	Reader.RequiredIdentity("projectId", Brain.ProjectId);
	Reader.RequiredString("runId", Brain.RunId);
	Reader.RequiredString("taskId", Brain.TaskId);
	Reader.RequiredString("contentHash", Brain.ContentHash);
	Reader.RequiredString("observedAtIso", Brain.ObservedAtIso);
	Reader.RequiredBool("truncated", Brain.bTruncated);

	int64 BrainRevision = 0;
	int64 EntryCount = 0;
	int64 CharacterCount = 0;
	int64 RedactionCount = 0;
	Reader.RequiredInteger("brainRevision", BrainRevision);
	Reader.RequiredInteger("entryCount", EntryCount);
	Reader.RequiredInteger("characterCount", CharacterCount);
	Reader.RequiredInteger("redactionCount", RedactionCount);

	// THE KIND COUNTS, KEYED BY TOKEN AND STORED BY ORDINAL.
	//
	// A KNOWN KIND MUST BE PRESENT. Relay sends all of them, every time, so a
	// zero is a REPORTED zero — and a missing key would otherwise become one
	// indistinguishable from it.
	//
	// AN UNKNOWN KIND IS TOLERATED, and this is the one place in this file
	// where an unrecognised token is not a refusal. A kind is a member of a
	// vocabulary the kernel owns and may extend; refusing would take a world
	// dark the moment Relay learned a tenth kind, which is by far the more
	// expensive failure. It lands in no bucket, so `EntryCount` and the sum of
	// the buckets disagree — which IS the signal, visible without a debugger,
	// that this build's vocabulary is behind.
	// Plain locals rather than TArrays: this is scratch, it is fixed-size, and
	// `TArray<bool>` is a bit-packed vector in the offline stub whose elements
	// cannot be bound by reference. Neither leaves this function.
	int64 Counts[WonderlandBrainKindSlots] = { 0 };
	bool Seen[WonderlandBrainKindSlots] = { false };

	const FJsonValue* Kinds = Field(Object, "kindCounts");
	if (Kinds == nullptr) { Reader.Reject(EWonderlandWireError::MissingField, "kindCounts"); }
	else if (Kinds->Kind != EJsonKind::Object) { Reader.Reject(EWonderlandWireError::WrongType, "kindCounts"); }
	else
	{
		for (size_t i = 0; i < Kinds->Keys.size() && !Reader.bFailed; i += 1)
		{
			const FJsonValue& Item = Kinds->Values[i];
			if (Item.Kind != EJsonKind::Number)
			{
				Reader.Reject(EWonderlandWireError::WrongType, "kindCounts");
				break;
			}
			if (!std::isfinite(Item.Number))
			{
				Reader.Reject(EWonderlandWireError::NumberNotFinite, "kindCounts");
				break;
			}
			if (Item.Number != std::floor(Item.Number))
			{
				Reader.Reject(EWonderlandWireError::NumberNotInteger, "kindCounts");
				break;
			}
			if (Item.Number < 0.0 || Item.Number > 9007199254740991.0)
			{
				Reader.Reject(EWonderlandWireError::NumberOutOfRange, "kindCounts");
				break;
			}
			uint8 Kind = 0;
			if (!WonderlandWireLookupToken("EWonderlandBrainKind", FString(Kinds->Keys[i].c_str()), Kind))
			{
				// The tolerated case. Counted nowhere, on purpose.
				continue;
			}
			if (static_cast<int32>(Kind) >= WonderlandBrainKindSlots)
			{
				Reader.Reject(EWonderlandWireError::NumberOutOfRange, "kindCounts");
				break;
			}
			Counts[static_cast<int32>(Kind)] = static_cast<int64>(Item.Number);
			Seen[static_cast<int32>(Kind)] = true;
		}
		// Slot 0 is `Unobserved`, which is not a kind and is never sent.
		for (int32 Slot = 1; Slot < WonderlandBrainKindSlots && !Reader.bFailed; Slot += 1)
		{
			if (!Seen[Slot]) { Reader.Reject(EWonderlandWireError::MissingField, "kindCounts"); }
		}
	}

	if (Reader.bFailed) { return false; }

	if (BrainRevision < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("brain.brainRevision") }; return false; }
	if (EntryCount < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("brain.entryCount") }; return false; }
	if (CharacterCount < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("brain.characterCount") }; return false; }
	if (RedactionCount < 0) { Refusal = { EWonderlandWireError::NumberOutOfRange, FString("brain.redactionCount") }; return false; }

	Brain.BrainRevision = BrainRevision;
	Brain.EntryCount = EntryCount;
	Brain.CharacterCount = CharacterCount;
	Brain.RedactionCount = RedactionCount;
	for (int32 Slot = 0; Slot < WonderlandBrainKindSlots; Slot += 1)
	{
		Brain.KindCounts.Add(Counts[Slot]);
	}
	Out = Brain;
	return true;
}

// What a world may know about a C.A.R.D., which is deliberately little.
//
// THE THREE SLOTS ARE FLAGS, NOT BOOLS, and that carrier is the whole reason
// this cannot be a name-matching conversion. `null` is "nobody could resolve
// the C.A.R.D. behind this run" — which is EVERY reader today — and a bool
// would render it as three empty slots, a confident and wrong claim that this
// run has no Prompt Architect, no Coding Agent and no Reviewer.
bool DecodeCardScopeObject(
	const FJsonValue& Object,
	FWonderlandWireRefusal& Refusal,
	FWonderlandCardScope& Out)
{
	FWonderlandCardScope Card;
	FFieldReader Reader{ Object, Refusal };
	Reader.RequiredString("cardRevision", Card.CardRevision);
	Reader.NullableFlag("hasPromptArchitect", Card.HasPromptArchitect);
	Reader.NullableFlag("hasCodingAgent", Card.HasCodingAgent);
	Reader.NullableFlag("hasIndependentReviewer", Card.HasIndependentReviewer);
	Reader.NullableFlag("swarmEligible", Card.SwarmEligible);

	uint8 Autonomy = 0;
	Reader.NullableEnum("autonomy", "EWonderlandAutonomy", Autonomy);

	// The role vocabulary is Relay's own words for FUNCTIONS, which is what
	// makes it safe to carry at all. Read as strings rather than tokens because
	// the swarm roles are a policy list rather than a mirrored enum — but every
	// element must still BE a string: an object here would be a payload that
	// did not come through Relay's scoping, and the one thing that must never
	// cross on this field is a provider or model name.
	const FJsonValue* Roles = Field(Object, "eligibleSwarmRoles");
	if (Roles == nullptr) { Reader.Reject(EWonderlandWireError::MissingField, "eligibleSwarmRoles"); }
	else if (Roles->Kind != EJsonKind::Array) { Reader.Reject(EWonderlandWireError::WrongType, "eligibleSwarmRoles"); }
	else
	{
		for (const FJsonValue& Item : Roles->Items)
		{
			if (Item.Kind != EJsonKind::String)
			{
				Reader.Reject(EWonderlandWireError::WrongType, "eligibleSwarmRoles");
				break;
			}
			Card.EligibleSwarmRoles.Add(FString(Item.Text.c_str()));
		}
	}

	if (Reader.bFailed) { return false; }

	Card.Autonomy = static_cast<EWonderlandAutonomy>(Autonomy);
	Out = Card;
	return true;
}

// ONE OPEN GATE — what a run is waiting for a person to do.
//
// EVERY ELEMENT IS REFUSED OR DECODED, never skipped. A gate this build cannot
// read is a person being waited on that a world would not draw, and the run
// would look merely slow. The server has already narrowed the operation to a
// closed vocabulary, so a token that fails here means the two sides have moved
// apart — which must be loud.
bool DecodeHumanGateObject(
	const FJsonValue& Object,
	FWonderlandWireRefusal& Refusal,
	FWonderlandHumanGate& Out)
{
	FWonderlandHumanGate Gate;
	FFieldReader Reader{ Object, Refusal };
	Reader.RequiredString("schemaVersion", Gate.SchemaVersion);
	Reader.RequiredIdentity("projectId", Gate.ProjectId);
	Reader.RequiredIdentity("runId", Gate.RunId);
	Reader.RequiredIdentity("gateId", Gate.GateId);
	Reader.NullableText("taskId", Gate.TaskId);
	// A CODE, NOT A SENTENCE — and it may be empty, which is the server saying
	// it would not repeat the kernel's. Read as a plain string rather than an
	// identity for exactly that reason.
	Reader.RequiredString("reasonCode", Gate.ReasonCode);
	Reader.RequiredString("requestedAtIso", Gate.RequestedAtIso);

	uint8 Operation = 0;
	Reader.RequiredEnum("operation", "EWonderlandGatedOperation", Operation);

	if (Reader.bFailed) { return false; }

	Gate.Operation = static_cast<EWonderlandGatedOperation>(Operation);
	Out = Gate;
	return true;
}

// One required nested object, or the refusal that names it.
const FJsonValue* RequiredObject(
	const FJsonValue& Root,
	const char* Name,
	FWonderlandWireRefusal& Refusal)
{
	const FJsonValue* Value = Field(Root, Name);
	if (Value == nullptr) { Refusal = { EWonderlandWireError::MissingField, FString(Name) }; return nullptr; }
	if (Value->Kind != EJsonKind::Object) { Refusal = { EWonderlandWireError::WrongType, FString(Name) }; return nullptr; }
	return Value;
}

} // namespace

FWonderlandHydrationDecode WonderlandDecodeHydrationBytes(const char* Bytes, int32 Length)
{
	FWonderlandHydrationDecode Result;

	FJsonValue Root;
	EWonderlandWireError Error = EWonderlandWireError::None;
	if (!ParseDocument(Bytes, Length, Root, Error))
	{
		Result.Refusal.Error = Error;
		return Result;
	}

	FWonderlandHydration Hydration;
	FFieldReader Reader{ Root, Result.Refusal };
	Reader.RequiredString("schemaVersion", Hydration.SchemaVersion);
	Reader.RequiredIdentity("projectId", Hydration.ProjectId);
	Reader.NullableText("worldSessionId", Hydration.WorldSessionId);
	Reader.RequiredString("observedAtIso", Hydration.ObservedAtIso);
	if (Reader.bFailed) { return Result; }

	// THE SCHEMA, BEFORE ANY FIELD IS BELIEVED. A payload naming another
	// version may mean something else by every key below, and reading it
	// against the fields this build happens to know would be a guess made
	// silently. Refusing is what lets a bridge and a client ship on different
	// days without either inventing the other's contract.
	if (!(Hydration.SchemaVersion == FString(WonderlandWireHydrationSchema)))
	{
		Result.Refusal = { EWonderlandWireError::SchemaRejected, FString("schemaVersion") };
		return Result;
	}

	const FJsonValue* RunValue = RequiredObject(Root, "run", Result.Refusal);
	if (RunValue == nullptr) { return Result; }
	if (!DecodeRunSnapshotObject(*RunValue, Result.Refusal, Hydration.Run)) { return Result; }

	const FJsonValue* UsageValue = RequiredObject(Root, "usage", Result.Refusal);
	if (UsageValue == nullptr) { return Result; }
	if (!DecodeUsageHudObject(*UsageValue, Result.Refusal, Hydration.Usage)) { return Result; }

	const FJsonValue* StatusValue = RequiredObject(Root, "usageStatus", Result.Refusal);
	if (StatusValue == nullptr) { return Result; }
	if (!DecodeUsageStatusObject(*StatusValue, Result.Refusal, Hydration.UsageStatus)) { return Result; }

	const FJsonValue* ActivityValue = RequiredObject(Root, "activity", Result.Refusal);
	if (ActivityValue == nullptr) { return Result; }
	if (!DecodeActivityObject(*ActivityValue, Result.Refusal, Hydration.Activity)) { return Result; }

	const FJsonValue* BrainValue = RequiredObject(Root, "brain", Result.Refusal);
	if (BrainValue == nullptr) { return Result; }
	if (!DecodeBrainCitationObject(*BrainValue, Result.Refusal, Hydration.Brain)) { return Result; }

	const FJsonValue* CardValue = RequiredObject(Root, "card", Result.Refusal);
	if (CardValue == nullptr) { return Result; }
	if (!DecodeCardScopeObject(*CardValue, Result.Refusal, Hydration.Card)) { return Result; }

	// THE GATES. Required as a FIELD and permitted to be EMPTY: an absent key
	// is a bridge that does not send them, which this build cannot tell from a
	// run that is waiting on nobody — and of the two that is the one it must
	// not guess. An empty array beside a known PendingApprovals of zero is the
	// honest "nothing is gated".
	const FJsonValue* Gates = Field(Root, "humanGates");
	if (Gates == nullptr)
	{
		Result.Refusal = { EWonderlandWireError::MissingField, FString("humanGates") };
		return Result;
	}
	if (Gates->Kind != EJsonKind::Array)
	{
		Result.Refusal = { EWonderlandWireError::WrongType, FString("humanGates") };
		return Result;
	}
	for (const FJsonValue& Item : Gates->Items)
	{
		if (Item.Kind != EJsonKind::Object)
		{
			Result.Refusal = { EWonderlandWireError::WrongType, FString("humanGates") };
			return Result;
		}
		FWonderlandHumanGate Gate;
		if (!DecodeHumanGateObject(Item, Result.Refusal, Gate)) { return Result; }
		Hydration.HumanGates.Add(Gate);
	}

	// ─────────────────────────────────────────────────────────────────────
	// EVERY HALF NAMES THE SAME RUN IN THE SAME PROJECT.
	//
	// This mirrors `wonderlandHydrationVerdict` deliberately rather than
	// trusting it. A bridge that assembled correctly makes this redundant; a
	// bridge that did not makes it the only thing standing between a world and
	// a picture of somebody else's mission — and because a hydration is adopted
	// WHOLESALE, nothing arriving afterwards would contradict it. The world
	// would simply be watching the wrong run, with every number on it real.
	// ─────────────────────────────────────────────────────────────────────
	if (!(Hydration.Run.ProjectId == Hydration.ProjectId))
	{
		Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("run.projectId") };
		return Result;
	}
	if (!(Hydration.Activity.ProjectId == Hydration.ProjectId))
	{
		Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("activity.projectId") };
		return Result;
	}
	if (!(Hydration.Activity.RunId == Hydration.Run.RunId))
	{
		Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("activity.runId") };
		return Result;
	}
	if (!(Hydration.Brain.ProjectId == Hydration.ProjectId))
	{
		Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("brain.projectId") };
		return Result;
	}
	// EVERY GATE, NOT A SAMPLE. One foreign gate among correct ones would show a
	// person being waited on for something this world cannot see, and nothing
	// arriving afterwards would withdraw it.
	for (int32 i = 0; i < Hydration.HumanGates.Num(); i += 1)
	{
		const FWonderlandHumanGate& Gate = Hydration.HumanGates[i];
		if (!(Gate.ProjectId == Hydration.ProjectId))
		{
			Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("humanGates.projectId") };
			return Result;
		}
		if (!(Gate.RunId == Hydration.Run.RunId))
		{
			Result.Refusal = { EWonderlandWireError::IdentityRejected, FString("humanGates.runId") };
			return Result;
		}
	}

	Result.bOk = true;
	Result.Hydration = Hydration;
	return Result;
}

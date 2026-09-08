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
	FFieldReader Reader{ *ActivityValue, Result.Refusal };
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
	const FJsonValue* Signals = Field(*ActivityValue, "signals");
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
	const FJsonValue* Workers = Field(*ActivityValue, "workers");
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
			FFieldReader WorkerReader{ Item, Result.Refusal };
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

	if (Reader.bFailed) { return Result; }

	// Counts are counts. A negative one is not a smaller number, it is a
	// different kind of thing, and it would render as a subagent that unspawned.
	if (ActiveSubagents < 0) { Result.Refusal = { EWonderlandWireError::NumberOutOfRange, FString("activeSubagents") }; return Result; }
	if (SubagentsDenied < 0) { Result.Refusal = { EWonderlandWireError::NumberOutOfRange, FString("subagentsDenied") }; return Result; }
	if (UnusedEvents < 0) { Result.Refusal = { EWonderlandWireError::NumberOutOfRange, FString("unusedEvents") }; return Result; }

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

	Activity.ActiveSubagents = ActiveSubagents;
	Activity.SubagentsDenied = SubagentsDenied;
	Activity.UnusedEvents = UnusedEvents;

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

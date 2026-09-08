// THE WIRE DECODER, RUN AGAINST REAL PAYLOADS AND HOSTILE ONES.
//
// The decoder is the one piece of this seam that a broken implementation hides
// rather than announces: an unmatched enum token lands on `Unobserved` and a
// zero-filled carrier reads as "Relay did not say", so a client that decodes
// nothing correctly looks exactly like a Relay that is reporting nothing.
//
// So every case below asserts what the decoder PRODUCED, not merely that it
// survived — and the refusal cases assert the NAMED reason, because "it failed"
// and "it failed for the right reason" are different facts and only the second
// one tells the next person what to fix.
//
// The canonical fixtures are generated from the TypeScript. See
// wire-decode-check.sh.

#include "WonderlandWireDecode.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

static int Failures = 0;
static int Checks = 0;

static void Check(bool Condition, const char* What)
{
	Checks += 1;
	if (!Condition)
	{
		Failures += 1;
		std::printf("FAIL %s\n", What);
	}
}

static void CheckStr(const FString& Actual, const char* Expected, const char* What)
{
	Checks += 1;
	if (!(Actual == FString(Expected)))
	{
		Failures += 1;
		std::printf("FAIL %s (got \"%s\", wanted \"%s\")\n", What, Actual.s.c_str(), Expected);
	}
}

static FWonderlandEnvelopeDecode Decode(const std::string& Json)
{
	return WonderlandDecodeEnvelopeBytes(Json.c_str(), static_cast<int32>(Json.size()));
}

/** A refusal case: the payload must be rejected, for exactly this reason. */
static void Refuses(const std::string& Json, EWonderlandWireError Expected, const char* What)
{
	const FWonderlandEnvelopeDecode Result = Decode(Json);
	Checks += 1;
	if (Result.bOk)
	{
		Failures += 1;
		std::printf("FAIL %s (accepted, should have refused)\n", What);
		return;
	}
	if (Result.Refusal.Error != Expected)
	{
		Failures += 1;
		std::printf("FAIL %s (refused as %s, wanted %s)\n", What,
			WonderlandWireErrorName(Result.Refusal.Error), WonderlandWireErrorName(Expected));
	}
}

// A complete, valid envelope. Every case below is this with one thing changed,
// so a failure names the change rather than the shape.
static std::string Base(const std::string& Overrides = "")
{
	std::string Json =
		"{\"schemaVersion\":\"relay-wonderland-envelope.v1\","
		"\"eventId\":\"evt-1\",\"projectId\":\"project-alpha\","
		"\"worldSessionId\":null,\"juliusInstanceId\":\"julius-1\","
		"\"missionId\":null,\"runId\":\"run-1\",\"taskId\":null,"
		"\"workerRole\":\"CODING_AGENT\",\"state\":\"independent_review\","
		"\"stateSource\":\"julius_run_state\",\"sourceState\":\"REVIEWING\","
		"\"terminal\":false,\"sequence\":42,\"revision\":7,"
		"\"occurredAt\":\"2026-09-08T00:00:00.000Z\","
		"\"metadata\":{},\"metadataDropped\":0}";
	if (!Overrides.empty()) { return Overrides; }
	return Json;
}

// Replace one `"key":<value>` in the base payload. Crude and exact: the tests
// below are about single-field changes and a JSON builder would be a second
// implementation to get wrong.
static std::string With(const char* Key, const char* Value)
{
	std::string Json = Base();
	const std::string Needle = std::string("\"") + Key + "\":";
	const size_t At = Json.find(Needle);
	if (At == std::string::npos) { std::printf("FAIL fixture has no key %s\n", Key); Failures += 1; return Json; }
	size_t End = At + Needle.size();
	int Depth = 0;
	bool InString = false;
	while (End < Json.size())
	{
		const char C = Json[End];
		if (InString) { if (C == '\\') { End += 2; continue; } if (C == '"') { InString = false; } }
		else if (C == '"') { InString = true; }
		else if (C == '{' || C == '[') { Depth += 1; }
		else if (C == '}' || C == ']') { if (Depth == 0) { break; } Depth -= 1; }
		else if (C == ',' && Depth == 0) { break; }
		End += 1;
	}
	return Json.substr(0, At + Needle.size()) + Value + Json.substr(End);
}

int main(int argc, char** argv)
{
	/* ------------------------------------------------ the ordinary case */
	{
		const FWonderlandEnvelopeDecode R = Decode(Base());
		Check(R.bOk, "a complete envelope decodes");
		CheckStr(R.Envelope.EventId, "evt-1", "eventId");
		CheckStr(R.Envelope.ProjectId, "project-alpha", "projectId");
		Check(R.Envelope.State == EWonderlandJuliusState::IndependentReview, "state maps by token, not by name");
		Check(R.Envelope.StateSource == EWonderlandJuliusStateSource::JuliusRunState, "stateSource maps");
		Check(R.Envelope.WorkerRole == EWonderlandWorkerRole::CodingAgent, "SCREAMING_SNAKE role maps");
		Check(R.Envelope.Sequence == 42, "sequence");
		Check(R.Envelope.Revision == 7, "revision");
		Check(R.Envelope.bTerminal == false, "terminal false is carried as false");
	}

	/* -------------------------------- absence is not emptiness, or falsity */
	{
		const FWonderlandEnvelopeDecode R = Decode(Base());
		Check(R.bOk, "base decodes for the carrier checks");
		// null -> the carrier says NOTHING WAS SAID.
		Check(R.Envelope.WorldSessionId.bKnown == false, "null worldSessionId is unknown");
		Check(R.Envelope.MissionId.bKnown == false, "null missionId is unknown");
		Check(R.Envelope.TaskId.bKnown == false, "null taskId is unknown");
		// a value -> the carrier says SO, and carries it.
		Check(R.Envelope.RunId.bKnown == true, "a present runId is known");
		CheckStr(R.Envelope.RunId.Value, "run-1", "runId value");
		Check(R.Envelope.JuliusInstanceId.bKnown == true, "a present instance id is known");
	}
	{
		// AN EMPTY STRING IS A VALUE. It is not the same as null, and a decoder
		// that treated "" as absent would erase a distinction Relay makes.
		const FWonderlandEnvelopeDecode R = Decode(With("runId", "\"\""));
		Check(R.bOk, "an empty runId decodes");
		Check(R.Envelope.RunId.bKnown == true, "an empty string is KNOWN, not absent");
		Check(R.Envelope.RunId.Value.IsEmpty(), "and its value is empty");
	}
	{
		// ZERO IS A MEASUREMENT.
		const FWonderlandEnvelopeDecode R = Decode(With("sequence", "0"));
		Check(R.bOk, "sequence 0 decodes");
		Check(R.Envelope.Sequence == 0, "zero is carried as zero");
	}

	/* -------------------------------------------- the vocabulary, exactly */
	{
		// PascalCase is NOT a Relay token. A decoder matching loosely would
		// accept this and one matching by name would too.
		Refuses(With("state", "\"IndependentReview\""), EWonderlandWireError::UnknownToken, "PascalCase state is refused");
		Refuses(With("state", "\"INDEPENDENT_REVIEW\""), EWonderlandWireError::UnknownToken, "SCREAMING state is refused");
		Refuses(With("state", "\"reviewing\""), EWonderlandWireError::UnknownToken, "a kernel word is not a visual token");
		Refuses(With("state", "\"\""), EWonderlandWireError::UnknownToken, "a blank state is refused");
		// AND NOT LEFT AT ZERO. This is the failure the whole file exists for.
		const FWonderlandEnvelopeDecode R = Decode(With("state", "\"not_a_state\""));
		Check(!R.bOk, "an unknown state does not decode");
		Check(R.Envelope.State == EWonderlandJuliusState::Unobserved,
			"and the envelope is untouched, so nothing can read Unobserved as an answer");
	}
	{
		// A NULLABLE enum: null is designed unknown and maps to the zero member.
		const FWonderlandEnvelopeDecode R = Decode(With("workerRole", "null"));
		Check(R.bOk, "a null workerRole decodes");
		Check(R.Envelope.WorkerRole == EWonderlandWorkerRole::Unobserved, "null role is Unobserved BY DESIGN");
		// An unrecognised STRING is not the same thing and is refused.
		Refuses(With("workerRole", "\"ARCHITECT\""), EWonderlandWireError::UnknownToken, "an unknown role string is refused");
	}
	{
		// The token that split on a SPACE — the gap the parity check found.
		uint8 Value = 0;
		Check(WonderlandWireLookupToken("EWonderlandJuliusStateSource", FString("relay_phase"), Value),
			"a snake_case token resolves");
		Check(!WonderlandWireLookupToken("EWonderlandJuliusState", FString("Coding"), Value),
			"a PascalCase token does not resolve");
		Check(!WonderlandWireLookupToken("ENoSuchEnum", FString("coding"), Value),
			"an unknown enum name resolves nothing");
	}

	/* --------------------------------------------------- malformed input */
	Refuses("", EWonderlandWireError::NotJson, "empty input");
	Refuses("null", EWonderlandWireError::NotObject, "a JSON null is not an envelope");
	Refuses("[]", EWonderlandWireError::NotObject, "an array is not an envelope");
	Refuses("{", EWonderlandWireError::NotJson, "an unterminated object");
	Refuses(Base() + "{}", EWonderlandWireError::NotJson, "trailing content after the value");
	Refuses("{\"a\":1,\"a\":2}", EWonderlandWireError::DuplicateKey, "a duplicate key");
	Refuses(With("sequence", "\"42\""), EWonderlandWireError::WrongType, "a stringly-typed sequence");
	Refuses(With("terminal", "\"false\""), EWonderlandWireError::WrongType, "a stringly-typed bool");
	Refuses(With("state", "7"), EWonderlandWireError::WrongType, "a numeric state");
	Refuses(With("projectId", "null"), EWonderlandWireError::WrongType, "a null projectId");
	Refuses(With("projectId", "\"\""), EWonderlandWireError::IdentityRejected, "a blank projectId");
	Refuses(With("projectId", "\"   \""), EWonderlandWireError::IdentityRejected, "a whitespace projectId");
	Refuses(With("eventId", "\"\""), EWonderlandWireError::IdentityRejected, "a blank eventId");

	/* ------------------------------------------------------- the numbers */
	Refuses(With("sequence", "1.5"), EWonderlandWireError::NumberNotInteger, "a fractional sequence");
	Refuses(With("sequence", "-1"), EWonderlandWireError::NumberOutOfRange, "a negative sequence");
	Refuses(With("revision", "-1"), EWonderlandWireError::NumberOutOfRange, "a negative revision");
	Refuses(With("sequence", "9007199254740993"), EWonderlandWireError::NumberOutOfRange, "beyond exact integers");
	// `1e400` exceeds what a double holds and the conversion says so directly,
	// which is a more precise answer than "not finite" — the finite check behind it
	// remains for a platform whose conversion returns HUGE_VAL instead of throwing.
	Refuses(With("sequence", "1e400"), EWonderlandWireError::NumberOutOfRange, "an overflowing exponent");
	Refuses(With("sequence", "NaN"), EWonderlandWireError::NotJson, "NaN is not JSON");
	Refuses(With("sequence", "Infinity"), EWonderlandWireError::NotJson, "Infinity is not JSON");
	Refuses(With("sequence", "01"), EWonderlandWireError::NotJson, "a leading zero");
	Refuses(With("sequence", "+1"), EWonderlandWireError::NotJson, "a leading plus");
	{
		// The largest exactly-representable integer must still work: the bound
		// is a real edge, not a round number chosen for comfort.
		const FWonderlandEnvelopeDecode R = Decode(With("sequence", "9007199254740991"));
		Check(R.bOk, "the largest exact integer decodes");
		Check(R.Envelope.Sequence == 9007199254740991LL, "and survives intact");
	}

	/* ------------------------------------------------- missing != empty */
	{
		std::string Json = Base();
		const size_t At = Json.find(",\"runId\":\"run-1\"");
		Json = Json.substr(0, At) + Json.substr(At + std::strlen(",\"runId\":\"run-1\""));
		Refuses(Json, EWonderlandWireError::MissingField, "an absent nullable field is not the same as null");
	}

	/* ------------------------------------------------------- the metadata */
	{
		const FWonderlandEnvelopeDecode R = Decode(With("metadata", "{\"attempt\":2,\"ok\":true,\"note\":\"x\",\"gone\":null}"));
		Check(R.bOk, "scalar metadata decodes");
		Check(R.Envelope.Metadata.Num() == 4, "every scalar entry is carried");
	}
	Refuses(With("metadata", "{\"nested\":{\"a\":1}}"), EWonderlandWireError::WrongType, "a nested metadata object");
	Refuses(With("metadata", "{\"list\":[1,2]}"), EWonderlandWireError::WrongType, "a metadata array");
	Refuses(With("metadata", "null"), EWonderlandWireError::WrongType, "a null metadata");

	/* ---------------------------------------------------------- the bounds */
	{
		std::string Deep = "{\"metadata\":";
		for (int i = 0; i < 64; i += 1) { Deep += "["; }
		for (int i = 0; i < 64; i += 1) { Deep += "]"; }
		Deep += "}";
		Refuses(Deep, EWonderlandWireError::TooLarge, "a deeply nested payload");
	}
	{
		std::string Huge = "{\"a\":\"";
		Huge.append(300000, 'x');
		Huge += "\"}";
		Refuses(Huge, EWonderlandWireError::TooLarge, "a payload past the byte ceiling");
	}

	/* ------------------------- the generated fixtures, from the TypeScript */
	if (argc > 1)
	{
		std::ifstream File(argv[1]);
		if (!File)
		{
			std::printf("FAIL cannot open fixture file %s\n", argv[1]);
			Failures += 1;
		}
		else
		{
			std::string Line;
			int Cases = 0;
			while (std::getline(File, Line))
			{
				if (Line.empty()) { continue; }
				// `<name>\t<expect>\t<json>` — expect is `ok` or a refusal name.
				const size_t T1 = Line.find('\t');
				const size_t T2 = Line.find('\t', T1 + 1);
				if (T1 == std::string::npos || T2 == std::string::npos)
				{
					std::printf("FAIL malformed fixture line\n"); Failures += 1; continue;
				}
				const std::string Name = Line.substr(0, T1);
				const std::string Expect = Line.substr(T1 + 1, T2 - T1 - 1);
				const std::string Json = Line.substr(T2 + 1);
				const FWonderlandEnvelopeDecode R = Decode(Json);
				Cases += 1;
				Checks += 1;
				if (Expect == "ok")
				{
					if (!R.bOk)
					{
						Failures += 1;
						std::printf("FAIL fixture %s refused as %s\n", Name.c_str(),
							WonderlandWireErrorName(R.Refusal.Error));
					}
				}
				else if (R.bOk)
				{
					Failures += 1;
					std::printf("FAIL fixture %s accepted, wanted %s\n", Name.c_str(), Expect.c_str());
				}
				else if (Expect != WonderlandWireErrorName(R.Refusal.Error))
				{
					Failures += 1;
					std::printf("FAIL fixture %s refused as %s, wanted %s\n", Name.c_str(),
						WonderlandWireErrorName(R.Refusal.Error), Expect.c_str());
				}
			}
			// An empty fixture file passing every case is the regex-that-matched-
			// nothing failure in another costume.
			Check(Cases >= 8, "the generated fixture file carried cases");
			std::printf("fixtures: %d\n", Cases);
		}
	}

	std::printf("checks: %d failures: %d\n", Checks, Failures);
	return Failures == 0 ? 0 : 1;
}

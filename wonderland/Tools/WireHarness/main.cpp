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

	/* --------------------------------------------------- the SSE framing */
	{
		const std::string Frame =
			"id: 42\nevent: wonderland.envelope\ndata: " + Base() + "\n\n";
		int32 Start = 0, Len = 0;
		Check(WonderlandWireReadSseData(Frame.c_str(), (int32)Frame.size(), Start, Len),
			"a real SSE frame yields its data line");
		const FWonderlandEnvelopeDecode R =
			WonderlandDecodeEnvelopeBytes(Frame.c_str() + Start, Len);
		Check(R.bOk, "and the payload inside it decodes");
		Check(R.Envelope.Sequence == 42, "with its fields intact");

		int32 S2 = 0, L2 = 0;
		Check(!WonderlandWireReadSseData(": heartbeat\n\n", 13, S2, L2),
			"a heartbeat carries nothing to apply");
		Check(!WonderlandWireReadSseData("data:\n\n", 7, S2, L2),
			"an empty data line is nothing, not an empty document");
		Check(!WonderlandWireReadSseData("id: 1\nevent: x\n\n", 16, S2, L2),
			"a frame with no data line");
		const char* NoSpace = "data:{\"a\":1}\n\n";
		Check(WonderlandWireReadSseData(NoSpace, (int32)std::strlen(NoSpace), S2, L2),
			"the space after the colon is optional");
		Check(L2 == 7, "and no space is consumed when there is none");
		// EXACTLY ONE, per the SSE grammar — not "as many as there are". The
		// difference is invisible for JSON, whose parser skips leading space
		// anyway, and it is still the spec: a field that begins with a space
		// keeps every space but the first.
		const char* TwoSpaces = "data:  {\"a\":1}\n\n";
		int32 S3 = 0, L3 = 0;
		Check(WonderlandWireReadSseData(TwoSpaces, (int32)std::strlen(TwoSpaces), S3, L3),
			"a double-spaced data line still yields data");
		Check(L3 == 8, "and exactly one of the two spaces is consumed");
	}

	/* -------------------------------------- the delivery, envelope+activity */
	if (argc > 2)
	{
		std::ifstream File(argv[2]);
		if (!File)
		{
			std::printf("FAIL cannot open delivery file %s\n", argv[2]);
			Failures += 1;
		}
		else
		{
			std::string Line;
			int Cases = 0;
			while (std::getline(File, Line))
			{
				if (Line.empty()) { continue; }
				const size_t T1 = Line.find('\t');
				const size_t T2 = Line.find('\t', T1 + 1);
				if (T1 == std::string::npos || T2 == std::string::npos)
				{
					std::printf("FAIL malformed delivery line\n"); Failures += 1; continue;
				}
				const std::string Name = Line.substr(0, T1);
				const std::string Expect = Line.substr(T1 + 1, T2 - T1 - 1);
				const std::string Json = Line.substr(T2 + 1);
				const FWonderlandDeliveryDecode R =
					WonderlandDecodeDeliveryBytes(Json.c_str(), (int32)Json.size());
				Cases += 1;
				Checks += 1;
				if (Expect == "ok")
				{
					if (!R.bOk)
					{
						Failures += 1;
						std::printf("FAIL delivery %s refused as %s (%s)\n", Name.c_str(),
							WonderlandWireErrorName(R.Refusal.Error), R.Refusal.Field.s.c_str());
					}
					else if (Name == "delivery-every-signal")
					{
						// The whole vocabulary, in one reading, and the worker
						// fold beside it.
						Check(R.Activity.Signals.Num() > 0, "signals decode");
						Check(R.Activity.Workers.Num() == 1, "the worker fold decodes");
						Check(R.Activity.ActiveSubagents == 3, "counts decode");
						Check(R.Activity.ObservedAtIso.bKnown, "a present observedAtIso is known");
					}
					else if (Name == "delivery-quiet")
					{
						// A quiet run says so: no signals, and an observation
						// time that is honestly absent rather than zero.
						Check(R.Activity.Signals.Num() == 0, "a quiet reading has no signals");
						Check(!R.Activity.ObservedAtIso.bKnown, "and an unknown observedAtIso");
					}
				}
				else if (R.bOk)
				{
					Failures += 1;
					std::printf("FAIL delivery %s accepted, wanted %s\n", Name.c_str(), Expect.c_str());
				}
				else if (Expect != WonderlandWireErrorName(R.Refusal.Error))
				{
					Failures += 1;
					std::printf("FAIL delivery %s refused as %s, wanted %s\n", Name.c_str(),
						WonderlandWireErrorName(R.Refusal.Error), Expect.c_str());
				}
			}
			Check(Cases >= 5, "the generated delivery file carried cases");
			std::printf("deliveries: %d\n", Cases);
		}
	}

	/* ------------------------------- the usage HUD, for the usage subsystem */
	if (argc > 3)
	{
		std::ifstream File(argv[3]);
		if (!File)
		{
			std::printf("FAIL cannot open usage file %s\n", argv[3]);
			Failures += 1;
		}
		else
		{
			std::string Line;
			int Cases = 0;
			while (std::getline(File, Line))
			{
				if (Line.empty()) { continue; }
				const size_t T1 = Line.find('\t');
				const size_t T2 = Line.find('\t', T1 + 1);
				if (T1 == std::string::npos || T2 == std::string::npos)
				{
					std::printf("FAIL malformed usage line\n"); Failures += 1; continue;
				}
				const std::string Name = Line.substr(0, T1);
				const std::string Expect = Line.substr(T1 + 1, T2 - T1 - 1);
				const std::string Json = Line.substr(T2 + 1);
				const FWonderlandUsageDecode R =
					WonderlandDecodeUsageBytes(Json.c_str(), (int32)Json.size());
				Cases += 1;
				Checks += 1;
				if (Expect == "ok")
				{
					if (!R.bOk)
					{
						Failures += 1;
						std::printf("FAIL usage %s refused as %s (%s)\n", Name.c_str(),
							WonderlandWireErrorName(R.Refusal.Error), R.Refusal.Field.s.c_str());
					}
					else if (Name == "usage-all-unknown")
					{
						// THE PRODUCTION READING. No authority reports into the
						// usage contract, so this is what a world draws today:
						// two tracks and NO remainder. A decoder that mapped by
						// name would hand the widget 0.0 with bKnown false,
						// which renders as an empty meter — a claim that the
						// founder has nothing left.
						Check(!R.Hud.CompoundAgent.CapacityUnits.bKnown, "unknown capacity stays unknown");
						Check(!R.Hud.CompoundAgent.UsedUnits.bKnown, "unknown usage stays unknown");
						Check(!R.Hud.SingleAgent.RemainingUnits.bKnown, "unknown remainder stays unknown");
						Check(R.Hud.CompoundAgent.CapacityUnits.Value == 0.0, "and its value is not a measurement");
						// AND THE REASON TRAVELS WITH THE ABSENCE. "Not
						// observed" and "stale" are different facts about the
						// same missing number, and the HUD says which — a
						// decoder that dropped the reason would flatten them.
						Check(R.Hud.CompoundAgent.CapacityUnits.Reason == EWonderlandUnknownReason::NotObserved,
							"the reason for the absence crosses");
						Check(R.Hud.SingleAgent.UsedUnits.Reason == EWonderlandUnknownReason::NotObserved,
							"on both meters");
						// The two arcs are still told apart.
						Check(R.Hud.CompoundAgent.Channel == EWonderlandUsageChannel::CompoundAgent, "compound channel");
						Check(R.Hud.SingleAgent.Channel == EWonderlandUsageChannel::SingleAgent, "single channel");
					}
					else if (Name == "usage-reason-stale")
					{
						// A reason that is NOT the zero member. Without one of
						// these, a decoder that hardcoded the default would pass
						// every check — the mutation escaped until this existed.
						Check(R.Hud.CompoundAgent.CapacityUnits.Reason == EWonderlandUnknownReason::Stale,
							"a non-default reason crosses intact");
						Check(!R.Hud.CompoundAgent.CapacityUnits.bKnown, "and it is still an absence");
					}
					else if (Name == "usage-reason-unreadable")
					{
						Check(R.Hud.CompoundAgent.CapacityUnits.Reason == EWonderlandUnknownReason::Unreadable,
							"and so does another one");
					}
					else if (Name == "usage-known")
					{
						Check(R.Hud.CompoundAgent.CapacityUnits.bKnown, "a reported capacity is known");
						Check(R.Hud.CompoundAgent.UsedUnits.bKnown, "a reported usage is known");
						Check(R.Hud.CompoundAgent.UsedUnits.Value > 0.0, "and carries its figure");
						// A BIGGER TIER IS A LONGER TRACK — the reference
						// capacity is what makes the arc physically longer, and
						// it has to survive the crossing as a figure.
						Check(R.Hud.CompoundAgent.ReferenceCapacityUnits.bKnown, "the reference capacity crosses");
						Check(R.Hud.CompoundAgent.TierId.bKnown, "the tier id crosses as known");
					}
				}
				else if (R.bOk)
				{
					Failures += 1;
					std::printf("FAIL usage %s accepted, wanted %s\n", Name.c_str(), Expect.c_str());
				}
				else if (Expect != WonderlandWireErrorName(R.Refusal.Error))
				{
					Failures += 1;
					std::printf("FAIL usage %s refused as %s, wanted %s\n", Name.c_str(),
						WonderlandWireErrorName(R.Refusal.Error), Expect.c_str());
				}
			}
			Check(Cases >= 5, "the generated usage file carried cases");
			std::printf("usages: %d\n", Cases);
		}
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

	/* ----------------------- the hydration, the payload adopted WHOLESALE */
	if (argc > 4)
	{
		std::ifstream File(argv[4]);
		if (!File)
		{
			std::printf("FAIL cannot open hydration file %s\n", argv[4]);
			Failures += 1;
		}
		else
		{
			std::string Line;
			int Cases = 0;
			while (std::getline(File, Line))
			{
				if (Line.empty()) { continue; }
				const size_t T1 = Line.find('\t');
				const size_t T2 = Line.find('\t', T1 + 1);
				if (T1 == std::string::npos || T2 == std::string::npos)
				{
					std::printf("FAIL malformed hydration line\n"); Failures += 1; continue;
				}
				const std::string Name = Line.substr(0, T1);
				const std::string Expect = Line.substr(T1 + 1, T2 - T1 - 1);
				const std::string Json = Line.substr(T2 + 1);
				const FWonderlandHydrationDecode R =
					WonderlandDecodeHydrationBytes(Json.c_str(), (int32)Json.size());
				Cases += 1;
				Checks += 1;
				if (Expect == "ok")
				{
					if (!R.bOk)
					{
						Failures += 1;
						std::printf("FAIL hydration %s refused as %s (%s)\n", Name.c_str(),
							WonderlandWireErrorName(R.Refusal.Error), R.Refusal.Field.s.c_str());
						continue;
					}
					// EVERY ACCEPTED CASE ASSERTS WHAT IT PRODUCED. A decoder
					// that returned bOk over a zero-filled struct would pass a
					// "did it refuse" harness completely, and look on screen
					// exactly like a Relay reporting nothing.
					if (Name == "hydration-terminal-complete")
					{
						// THE CASE THE FIELD EXISTS FOR. A completed run sends no
						// further events, so the envelope that normally carries
						// the drawable state never arrives.
						Check(R.Hydration.VisualState == EWonderlandJuliusState::Complete,
							"a finished run hydrates with something to DRAW");
						Check(R.Hydration.bTerminal, "and says it is over");
					}
					else if (Name == "hydration-blocked-not-terminal")
					{
						// DRAWN DIFFERENTLY, AND NOT OVER. `terminal` cannot be
						// recovered from the picture, which is why it is carried.
						Check(R.Hydration.VisualState == EWonderlandJuliusState::Blocked,
							"a blocked run draws as blocked");
						Check(!R.Hydration.bTerminal, "and is NOT over");
					}
					else if (Name == "hydration-failed-is-terminal")
					{
						Check(R.Hydration.VisualState == EWonderlandJuliusState::Error,
							"a failed run draws as error");
						Check(R.Hydration.bTerminal, "and IS over — same axis, different answer");
						Check(R.Hydration.VisualState != EWonderlandJuliusState::Complete,
							"and never as complete");
					}
					else if (Name == "hydration-full")
					{
						Check(R.Hydration.VisualState == EWonderlandJuliusState::Coding,
							"the drawable state decodes from Relay's own mapping");
						Check(!R.Hydration.bTerminal, "an executing run is not over");
						CheckStr(R.Hydration.ProjectId, "project-alpha", "the hydration's project decodes");
						CheckStr(R.Hydration.Run.RunId, "run-1", "the run id decodes");
						CheckStr(R.Hydration.Run.State, "EXECUTING", "the kernel's own word decodes as text");
						Check(R.Hydration.Run.Revision == 7, "the revision decodes");
						Check(R.Hydration.Run.AtSequence.bKnown, "a reported position is KNOWN");
						Check(R.Hydration.Run.AtSequence.Value == 42.0, "and is the position Relay sent");
						Check(R.Hydration.Run.ActiveTasks.bKnown, "a reported task count is known");
						Check(R.Hydration.Run.ActiveTasks.Value == 3.0, "and is the count Relay sent");
						// A REPORTED ZERO. `pendingApprovals: 0` is a real
						// answer, and the carrier must not confuse it with the
						// absence that shares its Value.
						Check(R.Hydration.Run.PendingApprovals.bKnown, "a reported zero is KNOWN");
						Check(R.Hydration.Run.PendingApprovals.Value == 0.0, "and is zero");
						Check(R.Hydration.WorldSessionId.bKnown, "a scoped hydration knows its session");
						CheckStr(R.Hydration.WorldSessionId.Value, "world-1", "and names it");

						// The meters, in their own slots, with real figures.
						Check(R.Hydration.Usage.CompoundAgent.Channel == EWonderlandUsageChannel::CompoundAgent,
							"the compound meter is in the compound slot");
						Check(R.Hydration.Usage.SingleAgent.Channel == EWonderlandUsageChannel::SingleAgent,
							"the single meter is in the single slot");
						Check(R.Hydration.Usage.CompoundAgent.CapacityUnits.bKnown,
							"a reported capacity is known");
						Check(R.Hydration.Usage.CompoundAgent.CapacityUnits.Value == 480.0,
							"and is the capacity Relay sent");

						// The citation: counts, and nothing that was written by
						// a person. Indexed by ordinal, so no caller subtracts.
						Check(R.Hydration.Brain.KindCounts.Num() == WonderlandBrainKindSlots,
							"the citation carries one slot per kind ordinal");
						Check(R.Hydration.Brain.KindCounts[(int32)EWonderlandBrainKind::Objective] == 2,
							"a kind's count lands under ITS OWN ordinal");
						Check(R.Hydration.Brain.KindCounts[(int32)EWonderlandBrainKind::Constraint] == 1,
							"and its neighbour's under its own");
						Check(R.Hydration.Brain.KindCounts[(int32)EWonderlandBrainKind::Repair] == 0,
							"a kind nothing was retrieved for is a REPORTED zero");
						Check(R.Hydration.Brain.KindCounts[(int32)EWonderlandBrainKind::Unobserved] == 0,
							"and slot zero, which is not a kind, stays empty");
						Check(R.Hydration.Brain.EntryCount == 5, "the entry count decodes");
						Check(R.Hydration.Brain.RedactionCount == 2, "redactions are reported as a size");
						Check(R.Hydration.Brain.bTruncated, "a truncated context says so");

						// The C.A.R.D., resolved: two filled slots and one that
						// the record says is genuinely empty.
						Check(R.Hydration.Card.HasPromptArchitect.bKnown,
							"a resolved record KNOWS about the architect slot");
						Check(R.Hydration.Card.HasPromptArchitect.bValue, "and it is filled");
						Check(R.Hydration.Card.HasIndependentReviewer.bKnown,
							"and knows about the reviewer slot");
						Check(!R.Hydration.Card.HasIndependentReviewer.bValue,
							"which the record says is EMPTY — a fact, not an absence");
						Check(R.Hydration.Card.SwarmEligible.bKnown,
							"a resolved record KNOWS whether a swarm is permitted");
						Check(R.Hydration.Card.SwarmEligible.bValue, "and this one permits one");
						Check(R.Hydration.Card.EligibleSwarmRoles.Num() == 2, "and the roles it permits");
						Check(R.Hydration.Card.Autonomy == EWonderlandAutonomy::Autonomous,
							"the autonomy level decodes");

						// THE GATES — what a person is being waited on for.
						Check(R.Hydration.HumanGates.Num() == 2, "both open gates decode");
						Check(R.Hydration.HumanGates[0].Operation == EWonderlandGatedOperation::SpawnSubagent,
							"a gated operation lands on ITS OWN member");
						CheckStr(R.Hydration.HumanGates[0].GateId, "gate-1", "the gate handle decodes");
						Check(R.Hydration.HumanGates[0].TaskId.bKnown, "a task gate names its task");
						CheckStr(R.Hydration.HumanGates[0].ReasonCode, "CARD_APPROVAL_REQUIRED",
							"the reason CODE crosses");
						// A RUN-LEVEL GATE HAS NO TASK, and that is an answer
						// rather than an omission.
						Check(!R.Hydration.HumanGates[1].TaskId.bKnown,
							"a run-level gate reports no task at all");
						Check(R.Hydration.HumanGates[1].Operation == EWonderlandGatedOperation::AccessNetwork,
							"and its own operation");
						// NO PROSE ON THIS RECORD. `safe_rationale` is a real
						// column on the kernel's approval and it has no field
						// here to arrive in.
						CheckStr(R.Hydration.HumanGates[0].ProjectId, "project-alpha",
							"a gate carries its own identity, so a foreign one is checkable");
					}
					else if (Name == "hydration-gate-run-level")
					{
						Check(R.Hydration.HumanGates.Num() == 1, "the run-level gate decodes");
						Check(!R.Hydration.HumanGates[0].TaskId.bKnown, "with no task");
						Check(R.Hydration.HumanGates[0].Operation
								== EWonderlandGatedOperation::UnchainedContinuation,
							"and the operation that stops a whole run");
					}
					else if (Name == "hydration-gate-none")
					{
						// NOBODY IS BEING WAITED ON, and somebody looked. The
						// count beside it is what carries "nobody counted".
						Check(R.Hydration.HumanGates.Num() == 0, "an ungated run has no gates");
						Check(R.Hydration.Run.PendingApprovals.bKnown,
							"and a KNOWN zero beside them, which is a different fact");
						Check(R.Hydration.Run.PendingApprovals.Value == 0.0, "of zero");
					}
					else if (Name == "hydration-gate-unrepeatable-reason")
					{
						// A SENTENCE CANNOT REACH A GAME CLIENT THROUGH THIS
						// FIELD. The server drops a reason that is not a machine
						// name, and what arrives is an absence rather than prose.
						Check(R.Hydration.HumanGates.Num() == 1, "the gate still decodes");
						CheckStr(R.Hydration.HumanGates[0].ReasonCode, "",
							"and its unrepeatable reason arrives EMPTY, not as a sentence");
					}
					else if (Name == "hydration-production-unknowns")
					{
						Check(R.Hydration.HumanGates.Num() == 0,
							"a run nobody is waiting on carries no gates");
						// THE SHAPE PRODUCTION ACTUALLY SERVES, and the one this
						// whole file exists for: everything nobody reported must
						// stay UNKNOWN rather than becoming a confident zero.
						Check(!R.Hydration.Run.AtSequence.bKnown, "an unplaced run has NO position");
						Check(!R.Hydration.Run.ActiveTasks.bKnown, "nobody counted the tasks");
						Check(!R.Hydration.Run.PendingApprovals.bKnown, "nor the approvals");
						Check(!R.Hydration.WorldSessionId.bKnown, "an unscoped hydration says so");
						Check(!R.Hydration.Card.HasPromptArchitect.bKnown,
							"an unresolved C.A.R.D. does not claim the architect slot is empty");
						Check(!R.Hydration.Card.HasCodingAgent.bKnown, "nor the coding agent slot");
						Check(!R.Hydration.Card.HasIndependentReviewer.bKnown, "nor the reviewer slot");
						// AND NOT SWARM ELIGIBILITY, which used to come back
						// `false` here — "this run may not spawn a swarm", drawn
						// beside three slots that correctly said UNKNOWN.
						Check(!R.Hydration.Card.SwarmEligible.bKnown,
							"nor whether a swarm is permitted");
						Check(R.Hydration.Card.EligibleSwarmRoles.Num() == 0,
							"and the role list is empty, which is why it cannot be read alone");
						Check(R.Hydration.Card.Autonomy == EWonderlandAutonomy::Unobserved,
							"and an unstated autonomy is NOT Supervised");
						Check(!R.Hydration.Usage.CompoundAgent.CapacityUnits.bKnown,
							"an unreported capacity draws a track and no remainder");
						Check(R.Hydration.UsageStatus.Reading == EWonderlandUsageReading::NotReported,
							"and the verdict says nobody reported");
						// A citation nobody made is told from a retrieval that
						// found nothing by its EMPTY HASH, not by its zeroes.
						CheckStr(R.Hydration.Brain.ContentHash, "",
							"an uncited retrieval carries no content hash");
					}
					else if (Name == "hydration-card-unresolved")
					{
						Check(!R.Hydration.Card.HasCodingAgent.bKnown,
							"null slots stay unknown");
						Check(!R.Hydration.Card.HasCodingAgent.bValue,
							"and carry no accidental true");
					}
					else if (Name == "hydration-card-no-swarm")
					{
						// THE THIRD ANSWER, and the one that makes the other two
						// mean anything: the record WAS read, and it permits no
						// swarm. Told from "nobody looked" only by bKnown.
						Check(R.Hydration.Card.SwarmEligible.bKnown,
							"a record that was read reports a real answer");
						Check(!R.Hydration.Card.SwarmEligible.bValue,
							"and this one permits no swarm");
					}
					else if (Name == "hydration-autonomy-absent")
					{
						Check(R.Hydration.Card.Autonomy == EWonderlandAutonomy::Unobserved,
							"an absent autonomy lands on Unobserved, by design");
					}
					else if (Name == "hydration-autonomy-UNCHAINED")
					{
						Check(R.Hydration.Card.Autonomy == EWonderlandAutonomy::Unchained,
							"a SCREAMING_SNAKE level maps to its PascalCase member");
					}
					else if (Name == "hydration-brain-future-kind")
					{
						// THE ONE TOLERATED UNKNOWN TOKEN. A kind the kernel
						// learned and this build has not lands in no bucket, and
						// the disagreement between the total and the sum IS the
						// signal that the vocabulary moved.
						int64 Sum = 0;
						for (int32 Slot = 0; Slot < R.Hydration.Brain.KindCounts.Num(); Slot += 1)
						{
							Sum += R.Hydration.Brain.KindCounts[Slot];
						}
						Check(Sum == 5, "a kind this build cannot name lands in NO bucket");
						Check(R.Hydration.Brain.EntryCount == 5,
							"and the total is still what Relay reported");
					}
					else if (Name == "hydration-no-position")
					{
						Check(!R.Hydration.Run.AtSequence.bKnown,
							"a run with no ledger position says so rather than resuming from 0");
					}
				}
				else if (R.bOk)
				{
					Failures += 1;
					std::printf("FAIL hydration %s accepted, wanted %s\n", Name.c_str(), Expect.c_str());
				}
				else if (Expect != WonderlandWireErrorName(R.Refusal.Error))
				{
					Failures += 1;
					std::printf("FAIL hydration %s refused as %s, wanted %s\n", Name.c_str(),
						WonderlandWireErrorName(R.Refusal.Error), Expect.c_str());
				}
			}
			Check(Cases >= 20, "the generated hydration file carried cases");
			std::printf("hydrations: %d\n", Cases);
		}
	}

	std::printf("checks: %d failures: %d\n", Checks, Failures);
	return Failures == 0 ? 0 : 1;
}

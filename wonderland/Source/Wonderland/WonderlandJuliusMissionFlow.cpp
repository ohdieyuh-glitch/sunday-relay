#include "WonderlandJuliusMissionFlow.h"

#include <cctype>
#include <algorithm>
#include <cstdint>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace WonderlandJuliusMissionFlow
{
	using WonderlandJuliusMissionLogic::EMissionProgress;
	using WonderlandJuliusMissionLogic::ProgressDisplayLabel;

	namespace
	{
		constexpr int JsonDepthLimit = 32;
		constexpr std::size_t JsonNodeLimit = 4096;
		/** /events: a full page is <= 500 events of <= 11 values each, plus the envelope. */
		constexpr std::size_t LiveJsonNodeLimit = 8192;

		enum class EJsonKind : std::uint8_t
		{
			Null,
			Bool,
			Number,
			String,
			Array,
			Object,
		};

		struct FJson
		{
			EJsonKind Kind = EJsonKind::Null;
			bool bBool = false;
			bool bInt = false;
			std::int64_t Int = 0;
			std::string Text;
			std::vector<FJson> Array;
			std::vector<std::pair<std::string, FJson>> Object;
		};

		bool SameText(const std::string& Left, std::string_view Right)
		{
			return Left.size() == Right.size() && Left.compare(0, Left.size(), Right.data(), Right.size()) == 0;
		}

		const FJson* Field(const FJson& Object, const char* Name)
		{
			if (Object.Kind != EJsonKind::Object || Name == nullptr) { return nullptr; }
			for (const std::pair<std::string, FJson>& Pair : Object.Object)
			{
				if (Pair.first == Name) { return &Pair.second; }
			}
			return nullptr;
		}

		bool IsExactString(const FJson* Node, const char* Text)
		{
			return Node != nullptr && Node->Kind == EJsonKind::String && Text != nullptr && Node->Text == Text;
		}

		bool Digits(const std::string& Text)
		{
			if (Text.empty() || Text.size() > 20) { return false; }
			for (const char C : Text)
			{
				if (C < '0' || C > '9') { return false; }
			}
			return true;
		}

		bool LowerHex(const std::string& Text, std::size_t Width)
		{
			if (Text.size() != Width) { return false; }
			for (const char C : Text)
			{
				const bool bOk = (C >= '0' && C <= '9') || (C >= 'a' && C <= 'f');
				if (!bOk) { return false; }
			}
			return true;
		}

		bool ParseNonNegativeInt(const std::string& Token, std::int64_t& Out)
		{
			if (Token.empty() || Token.size() > 18) { return false; }
			if (Token.size() > 1 && Token[0] == '0') { return false; }
			std::uint64_t Acc = 0;
			for (const char C : Token)
			{
				if (C < '0' || C > '9') { return false; }
				const std::uint64_t Digit = static_cast<std::uint64_t>(C - '0');
				if (Acc > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max()) / 10ull) { return false; }
				Acc = Acc * 10ull + Digit;
			}
			Out = static_cast<std::int64_t>(Acc);
			return true;
		}

		class FJsonParser
		{
		public:
			explicit FJsonParser(std::string_view In, std::size_t InMaxArray = 64, std::size_t InMaxNodes = JsonNodeLimit)
				: Text(In)
				, MaxArray(InMaxArray)
				, MaxNodes(InMaxNodes)
			{
			}

			bool Parse(FJson& Out)
			{
				Skip();
				if (!ParseValue(Out, 0) || !Ok) { return false; }
				Skip();
				return Index == Text.size();
			}

		private:
			std::string_view Text;
			std::size_t Index = 0;
			std::size_t MaxArray = 64;
			std::size_t MaxNodes = JsonNodeLimit;
			std::size_t Nodes = 0;
			bool Ok = true;

			void Fail() { Ok = false; }

			void Skip()
			{
				while (Ok && Index < Text.size())
				{
					const unsigned char C = static_cast<unsigned char>(Text[Index]);
					if (C != ' ' && C != '\t' && C != '\n' && C != '\r') { return; }
					++Index;
				}
			}

			bool Consume(char C)
			{
				if (!Ok || Index >= Text.size() || Text[Index] != C) { Fail(); return false; }
				++Index;
				return true;
			}

			bool AddNode()
			{
				if (Nodes >= MaxNodes) { Fail(); return false; }
				++Nodes;
				return true;
			}

			bool ParseValue(FJson& Out, int Depth)
			{
				if (!Ok || !AddNode()) { return false; }
				if (Depth > JsonDepthLimit) { Fail(); return false; }
				Skip();
				if (Index >= Text.size()) { Fail(); return false; }
				const char C = Text[Index];
				if (C == '"')
				{
					Out.Kind = EJsonKind::String;
					return ParseString(Out.Text);
				}
				if (C == '{') { return ParseObject(Out, Depth); }
				if (C == '[') { return ParseArray(Out, Depth); }
				if (C == 't') { return ConsumeLiteral("true", Out, true); }
				if (C == 'f') { return ConsumeLiteral("false", Out, false); }
				if (C == 'n')
				{
					if (Text.substr(Index, 4) != "null") { Fail(); return false; }
					Index += 4;
					Out.Kind = EJsonKind::Null;
					return true;
				}
				return ParseNumber(Out);
			}

			bool ConsumeLiteral(const char* Literal, FJson& Out, bool bValue)
			{
				const std::size_t Length = std::char_traits<char>::length(Literal);
				if (Text.substr(Index, Length) != Literal) { Fail(); return false; }
				Index += Length;
				Out.Kind = EJsonKind::Bool;
				Out.bBool = bValue;
				return true;
			}

			int HexNibble(char C)
			{
				if (C >= '0' && C <= '9') { return C - '0'; }
				if (C >= 'a' && C <= 'f') { return C - 'a' + 10; }
				if (C >= 'A' && C <= 'F') { return C - 'A' + 10; }
				return -1;
			}

			bool ParseString(std::string& Out)
			{
				if (!Consume('"')) { return false; }
				Out.clear();
				while (Ok && Index < Text.size())
				{
					const unsigned char C = static_cast<unsigned char>(Text[Index]);
					if (C == '"') { ++Index; return true; }
					if (C < 0x20) { Fail(); return false; }
					if (C != '\\')
					{
						Out.push_back(static_cast<char>(C));
						++Index;
						continue;
					}
					++Index;
					if (Index >= Text.size()) { Fail(); return false; }
					const char Esc = Text[Index++];
					switch (Esc)
					{
					case '"':
					case '\\':
					case '/': Out.push_back(Esc); break;
					case 'b': Out.push_back('\b'); break;
					case 'f': Out.push_back('\f'); break;
					case 'n': Out.push_back('\n'); break;
					case 'r': Out.push_back('\r'); break;
					case 't': Out.push_back('\t'); break;
					case 'u':
					{
						if (Index + 4 > Text.size()) { Fail(); return false; }
						int Code = 0;
						for (int Nibble = 0; Nibble < 4; ++Nibble)
						{
							const int Value = HexNibble(Text[Index++]);
							if (Value < 0) { Fail(); return false; }
							Code = (Code << 4) | Value;
						}
						if (Code < 0x80) { Out.push_back(static_cast<char>(Code)); }
						else if (Code < 0x800)
						{
							Out.push_back(static_cast<char>(0xC0 | (Code >> 6)));
							Out.push_back(static_cast<char>(0x80 | (Code & 0x3F)));
						}
						else
						{
							Out.push_back(static_cast<char>(0xE0 | (Code >> 12)));
							Out.push_back(static_cast<char>(0x80 | ((Code >> 6) & 0x3F)));
							Out.push_back(static_cast<char>(0x80 | (Code & 0x3F)));
						}
						break;
					}
					default: Fail(); return false;
					}
					if (Out.size() > 4000) { Fail(); return false; }
				}
				Fail();
				return false;
			}

			bool ParseNumber(FJson& Out)
			{
				const std::size_t Start = Index;
				if (Index < Text.size() && Text[Index] == '-') { ++Index; }
				if (Index >= Text.size() || Text[Index] < '0' || Text[Index] > '9') { Fail(); return false; }
				if (Text[Index] == '0') { ++Index; }
				else
				{
					while (Index < Text.size() && Text[Index] >= '0' && Text[Index] <= '9') { ++Index; }
				}
				bool bFraction = false;
				if (Index < Text.size() && Text[Index] == '.')
				{
					bFraction = true;
					++Index;
					if (Index >= Text.size() || Text[Index] < '0' || Text[Index] > '9') { Fail(); return false; }
					while (Index < Text.size() && Text[Index] >= '0' && Text[Index] <= '9') { ++Index; }
				}
				if (Index < Text.size() && (Text[Index] == 'e' || Text[Index] == 'E'))
				{
					bFraction = true;
					++Index;
					if (Index < Text.size() && (Text[Index] == '+' || Text[Index] == '-')) { ++Index; }
					if (Index >= Text.size() || Text[Index] < '0' || Text[Index] > '9') { Fail(); return false; }
					while (Index < Text.size() && Text[Index] >= '0' && Text[Index] <= '9') { ++Index; }
				}
				Out.Kind = EJsonKind::Number;
				Out.Text.assign(Text.data() + Start, Index - Start);
				if (!bFraction && !Out.Text.empty() && Out.Text[0] != '-')
				{
					Out.bInt = ParseNonNegativeInt(Out.Text, Out.Int);
				}
				return true;
			}

			bool ParseObject(FJson& Out, int Depth)
			{
				if (!Consume('{')) { return false; }
				Out.Kind = EJsonKind::Object;
				Skip();
				if (Index < Text.size() && Text[Index] == '}') { ++Index; return true; }
				while (Ok)
				{
					Skip();
					std::string Key;
					if (!ParseString(Key)) { return false; }
					for (const std::pair<std::string, FJson>& Pair : Out.Object)
					{
						if (Pair.first == Key) { Fail(); return false; }
					}
					Skip();
					if (!Consume(':')) { return false; }
					FJson Child;
					if (!ParseValue(Child, Depth + 1)) { return false; }
					Out.Object.emplace_back(std::move(Key), std::move(Child));
					if (Out.Object.size() > 64) { Fail(); return false; }
					Skip();
					if (Index < Text.size() && Text[Index] == ',') { ++Index; continue; }
					return Consume('}');
				}
				return false;
			}

			bool ParseArray(FJson& Out, int Depth)
			{
				if (!Consume('[')) { return false; }
				Out.Kind = EJsonKind::Array;
				Skip();
				if (Index < Text.size() && Text[Index] == ']') { ++Index; return true; }
				while (Ok)
				{
					FJson Child;
					if (!ParseValue(Child, Depth + 1)) { return false; }
					Out.Array.push_back(std::move(Child));
					if (Out.Array.size() > MaxArray) { Fail(); return false; } // FLOW_JSON_ARRAY_CAP
					Skip();
					if (Index < Text.size() && Text[Index] == ',') { ++Index; continue; }
					return Consume(']');
				}
				return false;
			}
		};

		bool ParseJson(std::string_view Text, FJson& Out, std::size_t MaxArray = 64, std::size_t MaxNodes = JsonNodeLimit)
		{
			FJsonParser Parser(Text, MaxArray, MaxNodes);
			return Parser.Parse(Out);
		}

		/** A lowercase-hex value of exactly Width characters, or Unknown (known=false) when present but malformed. */
		FReportedString LowerHexOrUnknown(const FReportedString& In, std::size_t Width)
		{
			FReportedString Out;
			Out.bNull = In.bNull;
			Out.bPresent = In.bKnown || In.bNull;
			if (!In.bKnown || In.Text.size() != Width) { return Out; }
			for (const char Ch : In.Text)
			{
				if (!((Ch >= '0' && Ch <= '9') || (Ch >= 'a' && Ch <= 'f'))) { return Out; } // FLOW_CHECKER_HEX_ONLY
			}
			Out.bKnown = true;
			Out.Text = In.Text;
			return Out;
		}

		FReportedString ReadString(const FJson* Object, const char* Name)
		{
			FReportedString Out;
			if (Object == nullptr || Object->Kind != EJsonKind::Object) { return Out; }
			const FJson* Node = Field(*Object, Name);
			if (Node == nullptr) { return Out; }
			if (Node->Kind == EJsonKind::Null) { Out.bNull = true; return Out; }
			if (Node->Kind == EJsonKind::String && !Node->Text.empty())
			{
				Out.bKnown = true;
				Out.Text = Node->Text;
			}
			return Out;
		}

		FReportedInt64 ReadInt(const FJson* Object, const char* Name)
		{
			FReportedInt64 Out;
			if (Object == nullptr || Object->Kind != EJsonKind::Object) { return Out; }
			const FJson* Node = Field(*Object, Name);
			if (Node == nullptr) { return Out; }
			if (Node->Kind == EJsonKind::Null) { Out.bNull = true; return Out; }
			if (Node->Kind == EJsonKind::Number && Node->bInt)
			{
				Out.bKnown = true;
				Out.Value = Node->Int;
			}
			return Out;
		}

		FReportedBool ReadBool(const FJson* Object, const char* Name)
		{
			FReportedBool Out;
			if (Object == nullptr || Object->Kind != EJsonKind::Object) { return Out; }
			const FJson* Node = Field(*Object, Name);
			if (Node == nullptr) { return Out; }
			if (Node->Kind == EJsonKind::Null) { Out.bNull = true; return Out; }
			if (Node->Kind == EJsonKind::Bool)
			{
				Out.bKnown = true;
				Out.bValue = Node->bBool;
			}
			return Out;
		}

		bool BoolIsTrue(const FJson* Object, const char* Name)
		{
			const FReportedBool Flag = ReadBool(Object, Name);
			return Flag.bKnown && Flag.bValue;
		}

		FReportedString ReadFileSha(const FJson* Archive)
		{
			FReportedString Out;
			if (Archive == nullptr || Archive->Kind != EJsonKind::Object) { return Out; }
			const FJson* Files = Field(*Archive, "files");
			if (Files == nullptr || Files->Kind != EJsonKind::Array || Files->Array.empty()) { return Out; }
			if (Files->Array[0].Kind != EJsonKind::Object) { return Out; }
			return ReadString(&Files->Array[0], "sha256");
		}

		void ReadArtifact(const FJson* Completion, FResultRead& Out)
		{
			if (Completion == nullptr || Completion->Kind != EJsonKind::Object) { return; }
			const FJson* Archive = Field(*Completion, "archive");
			if (Archive != nullptr && Archive->Kind == EJsonKind::Object)
			{
				Out.ArtifactName = ReadString(Archive, "artifactName");
				Out.ArtifactDigest = ReadString(Archive, "artifactDigest");
				constexpr bool bInferDigestFromFile = false;
				if (bInferDigestFromFile && !Out.ArtifactDigest.bKnown) { Out.ArtifactDigest = ReadFileSha(Archive); } // FLOW_DIGEST_NOT_INFERRED
			}
			const FJson* Refs = Field(*Completion, "workArtifactRefs");
			if (Refs != nullptr && Refs->Kind == EJsonKind::Array)
			{
				for (const FJson& Item : Refs->Array)
				{
					if (Item.Kind == EJsonKind::String && !Item.Text.empty()) { Out.WorkArtifactRefs.push_back(Item.Text); }
				}
			}
		}

		void ReadCosts(const FJson* Completion, FResultRead& Out)
		{
			if (Completion == nullptr || Completion->Kind != EJsonKind::Object) { return; }
			const FJson* Tag = Field(*Completion, "spendTag");
			if (Tag != nullptr && Tag->Kind == EJsonKind::Object)
			{
				Out.bSpendTagPresent = true;
				Out.ReservedUsdMicros = ReadInt(Tag, "reservedUsdMicros");
			}
			const FJson* Accounting = Field(*Completion, "spendAccounting");
			if (Accounting != nullptr && Accounting->Kind == EJsonKind::Object)
			{
				Out.bSpendAccountingPresent = true;
				Out.SpendAccountingKnownUsdMicros = ReadInt(Accounting, "knownUsdMicros");
			}
			Out.bSpendAccountingNull = Accounting != nullptr && Accounting->Kind == EJsonKind::Null; // #454 reader :623
			const FJson* Coder = Field(*Completion, "coderCost");
			if (Coder != nullptr && Coder->Kind == EJsonKind::Object)
			{
				Out.bCoderCostPresent = true;
				Out.CoderCostUsdMicros = ReadInt(Coder, "costUsdMicros"); // FLOW_COST_AS_REPORTED
				Out.CoderCostBasis = ReadString(Coder, "costBasis");
			}
			const FJson* Mission = Field(*Completion, "missionCost");
			if (Mission != nullptr && Mission->Kind == EJsonKind::Object)
			{
				Out.bMissionCostPresent = true;
				Out.MissionKnownUsdMicros = ReadInt(Mission, "knownUsdMicros");
				Out.MissionUnknownComponents = ReadInt(Mission, "unknownComponents");
				Out.MissionCostComplete = ReadBool(Mission, "complete");
			}
			const FJson* Receipt = Field(*Completion, "providerReceipt");
			if (Receipt != nullptr && Receipt->Kind == EJsonKind::Object)
			{
				Out.ProviderMessageId = ReadString(Receipt, "providerMessageId");
			}
		}

		constexpr std::int64_t MaxSafeInteger = 9007199254740991LL; // Number.MAX_SAFE_INTEGER

		// d9880ad4 julius-mission-evidence.ts:193-194 nonNegativeInt: a number, a safe integer, >= 0.
		bool SafeCount(const FJson* Node, std::int64_t& Out)
		{
			if (Node == nullptr || Node->Kind != EJsonKind::Number || !Node->bInt) { return false; }
			if (Node->Int > MaxSafeInteger) { return false; } // FLOW_SAFE_INTEGER_ONLY
			Out = Node->Int;
			return true;
		}

		// route.ts:145, evidence.ts:423. 0 stays 0. Null stays null. Anything else is Unknown, not 0.
		FReportedInt64 ReadRevision(const FJson* Object, bool& bMalformed)
		{
			FReportedInt64 Out;
			bMalformed = false;
			if (Object == nullptr || Object->Kind != EJsonKind::Object) { return Out; }
			const FJson* Node = Field(*Object, "projectBrainRevision");
			if (Node == nullptr) { return Out; }
			if (Node->Kind == EJsonKind::Null) { Out.bNull = true; return Out; } // FLOW_REVISION_NULL_NOT_ZERO
			if (SafeCount(Node, Out.Value)) { Out.bKnown = true; return Out; } // FLOW_REVISION_ZERO_KEPT
			bMalformed = true; // FLOW_REVISION_MALFORMED_IS_UNKNOWN
			return Out;
		}

		const char* const PhaseRoles[3] = {"PROMPT_ARCHITECT", "CODING_AGENT", "INDEPENDENT_REVIEWER"};

		bool IsPhaseState(const std::string& S)
		{
			return S == "NEVER_DISPATCHED" || S == "ACTIVE" || S == "IDLE" || S == "FAILED"; // FLOW_PHASE_STATE_CLOSED
		}

		bool IsPhaseStage(const std::string& S)
		{
			return S == "plan" || S == "build" || S == "repair:plan" || S == "repair:build"; // FLOW_PHASE_STAGE_CLOSED
		}

		// evidence.ts:347-382. Every key is required; any miss fails the slot, and a failed slot nulls the list.
		bool ReadPhaseSlot(const FJson& Node, const char* Role, FPhaseSlot& Out)
		{
			if (Node.Kind != EJsonKind::Object) { return false; }
			if (!IsExactString(Field(Node, "role"), Role)) { return false; } // FLOW_PHASES_ROLE_ORDER
			const FJson* State = Field(Node, "state");
			if (State == nullptr || State->Kind != EJsonKind::String || !IsPhaseState(State->Text)) { return false; }
			const FJson* Stage = Field(Node, "stage");
			if (Stage == nullptr) { return false; } // FLOW_PHASE_STAGE_KEY_REQUIRED
			if (Stage->Kind == EJsonKind::Null) { Out.Stage.bNull = true; }
			else if (Stage->Kind == EJsonKind::String && IsPhaseStage(Stage->Text)) { Out.Stage.bKnown = true; Out.Stage.Text = Stage->Text; }
			else { return false; }
			const FJson* Attempt = Field(Node, "attempt");
			if (Attempt == nullptr) { return false; } // FLOW_PHASE_ATTEMPT_KEY_REQUIRED
			if (Attempt->Kind == EJsonKind::Null) { Out.Attempt.bNull = true; }
			else if (SafeCount(Attempt, Out.Attempt.Value)) { Out.Attempt.bKnown = true; }
			else { return false; } // FLOW_PHASE_ATTEMPT_SAFE
			const FJson* Span = Field(Node, "spanId");
			if (Span == nullptr || Span->Kind != EJsonKind::Null) { return false; } // FLOW_PHASE_SPAN_ID_NULL
			const FJson* Parent = Field(Node, "traceparent");
			if (Parent == nullptr || Parent->Kind != EJsonKind::Null) { return false; } // FLOW_PHASE_TRACEPARENT_NULL
			if (!SafeCount(Field(Node, "knownUsdMicros"), Out.KnownUsdMicros)) { return false; } // FLOW_PHASE_COST_REQUIRED
			const FJson* Complete = Field(Node, "costComplete");
			if (Complete == nullptr || Complete->Kind != EJsonKind::Bool) { return false; } // FLOW_PHASE_COST_COMPLETE_BOOL
			Out.bCostComplete = Complete->bBool;
			Out.Role = Role;
			Out.State = State->Text;
			return true;
		}

		EPhaseList ReadPhases(const FJson* Object, std::vector<FPhaseSlot>& Out)
		{
			Out.clear();
			if (Object == nullptr || Object->Kind != EJsonKind::Object) { return EPhaseList::Absent; }
			const FJson* Node = Field(*Object, "phases");
			if (Node == nullptr) { return EPhaseList::Absent; }
			if (Node->Kind == EJsonKind::Null) { return EPhaseList::Null; }
			if (Node->Kind != EJsonKind::Array || Node->Array.size() != 3) { return EPhaseList::Malformed; } // FLOW_PHASES_EXACTLY_THREE
			std::vector<FPhaseSlot> Slots(3);
			for (std::size_t I = 0; I < 3; ++I)
			{
				if (!ReadPhaseSlot(Node->Array[I], PhaseRoles[I], Slots[I])) { return EPhaseList::Malformed; } // FLOW_ONE_BAD_SLOT_NULLS_LIST
			}
			Out = std::move(Slots);
			return EPhaseList::Projection;
		}

		// Canonical text of a phase read, so two routes' copies can be compared. Absent, Null and Malformed all read "-".
		std::string PhaseKey(EPhaseList List, const std::vector<FPhaseSlot>& Slots)
		{
			if (List != EPhaseList::Projection) { return "-"; }
			std::string Key;
			for (const FPhaseSlot& Slot : Slots)
			{
				Key += Slot.Role + "|" + Slot.State + "|" + (Slot.Stage.bKnown ? Slot.Stage.Text : std::string("~")) + "|"
					+ (Slot.Attempt.bKnown ? std::to_string(Slot.Attempt.Value) : std::string("~")) + "|"
					+ std::to_string(Slot.KnownUsdMicros) + "|" + (Slot.bCostComplete ? "1" : "0") + ";";
			}
			return Key;
		}

		std::string RevisionKey(const FReportedInt64& Revision)
		{
			return Revision.bKnown ? std::to_string(Revision.Value) : std::string("-");
		}

		std::string ReportedOrUnknown(const FReportedString& Field)
		{
			return Field.bKnown ? Field.Text : std::string("Unknown");
		}

		std::string ReportedOrUnknown(const FReportedInt64& Field)
		{
			return Field.bKnown ? std::to_string(Field.Value) : std::string("Unknown");
		}

		// Phases and the revision are published only on a verified completion (evidence.ts:411-412). Never invented.
		void AppendPhasesAndRevision(std::vector<std::string>& Lines, const FResultRead& Read)
		{
			if (!Read.bVerified) { return; } // FLOW_PHASES_ONLY_IF_VERIFIED
			if (Read.ProjectBrainRevision.bKnown)
			{
				Lines.push_back(std::string("projectBrainRevision: ") + std::to_string(Read.ProjectBrainRevision.Value));
			}
			else
			{
				Lines.push_back("projectBrainRevision: Unknown");
			}
			if (Read.Phases != EPhaseList::Projection)
			{
				Lines.push_back("phases: Unknown"); // FLOW_NULL_PHASES_NOT_INVENTED
				return;
			}
			for (const FPhaseSlot& Slot : Read.PhaseSlots)
			{
				Lines.push_back(std::string("phase ") + Slot.Role + ": " + Slot.State
					+ ", stage " + ReportedOrUnknown(Slot.Stage)
					+ ", attempt " + ReportedOrUnknown(Slot.Attempt)
					+ ", knownUsdMicros " + std::to_string(Slot.KnownUsdMicros) // FLOW_ZERO_COST_IS_ZERO
					+ ", costComplete " + (Slot.bCostComplete ? "true" : "false"));
			}
		}

		bool SpendTagVerifies(const FJson* Completion, std::string_view WljRunId)
		{
			if (Completion == nullptr || Completion->Kind != EJsonKind::Object) { return false; }
			const FJson* Tag = Field(*Completion, "spendTag");
			if (Tag == nullptr || Tag->Kind != EJsonKind::Object) { return false; } // FLOW_SPEND_TAG_REQUIRED
			const FJson* Schema = Field(*Tag, "schema");
			if (!IsExactString(Schema, "julius-run-spent.v1")) { return false; } // FLOW_SPEND_SCHEMA_REQUIRED
			const FReportedString Run = ReadString(Tag, "run");
			if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return false; } // FLOW_SPEND_RUN_REQUIRED
			const FReportedString Namespace = ReadString(Tag, "namespace");
			const FReportedInt64 Reserved = ReadInt(Tag, "reservedUsdMicros");
			const FReportedString Workflow = ReadString(Tag, "workflowRunId");
			const FReportedString Attempt = ReadString(Tag, "workflowRunAttempt");
			const FReportedString Head = ReadString(Tag, "headSha");
			if (!Namespace.bKnown || Namespace.Text.size() > 200) { return false; }
			if (!Reserved.bKnown) { return false; }
			if (!Workflow.bKnown || !Digits(Workflow.Text)) { return false; }
			if (!Attempt.bKnown || !Digits(Attempt.Text)) { return false; }
			if (!Head.bKnown || !LowerHex(Head.Text, 40)) { return false; }
			return true;
		}

		bool EvidenceVerifies(const FJson& Root, const FJson* Completion, std::string_view WljRunId)
		{
			if (Completion == nullptr || Completion->Kind != EJsonKind::Object) { return false; }
			const FJson* State = Field(Root, "state");
			if (!IsExactString(State, "completed")) { return false; } // FLOW_STATE_COMPLETED_REQUIRED
			const FJson* FinalState = Field(*Completion, "juliusFinalState");
			if (!IsExactString(FinalState, "COMPLETED")) { return false; } // FLOW_JULIUS_FINAL_STATE_REQUIRED
			return SpendTagVerifies(Completion, WljRunId);
		}

		bool MissionFlowPastDispatched(EMissionProgress Meaning)
		{
			switch (Meaning)
			{
			case EMissionProgress::Dispatched:
			case EMissionProgress::Running:
			case EMissionProgress::Paused:
			case EMissionProgress::Succeeded:
			case EMissionProgress::Failed:
				return true;
			default:
				return false;
			}
		}

		FProgressPanel MissionFlowCeiling()
		{
			FProgressPanel Out;
			Out.Panel = EFlowPanel::Progress;
			Out.Line = ProgressDisplayLabel(EMissionProgress::OperatorStarted);
			Out.bFinished = false;
			Out.bPaid = false;
			Out.bHeldAtDispatched = true;
			return Out;
		}

		bool HasReportedArtifact(const FResultRead& Read)
		{
			return Read.ArtifactName.bKnown || Read.ArtifactDigest.bKnown || !Read.WorkArtifactRefs.empty();
		}

		void AppendInt(std::vector<std::string>& Lines, const char* Name, const FReportedInt64& Field, bool bSection)
		{
			if (!bSection) { return; }
			if (!Field.bKnown)
			{
				Lines.push_back(std::string(Name) + ": Unknown"); // FLOW_NULL_COST_IS_UNKNOWN
				return;
			}
			Lines.push_back(std::string(Name) + ": " + std::to_string(Field.Value));
		}

		FProgressPanel ProgressForExpiredRoute()
		{
			FProgressPanel Out = PanelForProgress(EMissionProgress::NotStarted);
			Out.Line = ProgressDisplayLabel(EMissionProgress::NotStarted); // FLOW_ROUTE_EXPIRED_SHOWS_NOT_STARTED
			Out.bFinished = false; // FLOW_ROUTE_EXPIRED_NOT_FINISHED
			Out.bNotStarted = true;
			return Out;
		}

		FProgressPanel ProgressForUnknownRoute()
		{
			FProgressPanel Out = PanelForProgress(EMissionProgress::Waiting);
			Out.bFinished = false; // FLOW_ROUTE_UNKNOWN_NOT_FINISHED
			return Out;
		}
	}

	FProgressPanel PanelForProgress(EMissionProgress Meaning)
	{
		if (MissionFlowPastDispatched(Meaning))
		{
			return MissionFlowCeiling();
		}
		FProgressPanel Out;
		Out.Panel = EFlowPanel::Progress;
		Out.bFinished = false;
		Out.Line = ProgressDisplayLabel(Meaning);
		switch (Meaning)
		{
		case EMissionProgress::Waiting:
			Out.bFinished = false; // FLOW_UNKNOWN_NOT_FINISHED
			break;
		case EMissionProgress::NotStarted:
			Out.Line = ProgressDisplayLabel(EMissionProgress::NotStarted); // FLOW_EXPIRED_SHOWS_NOT_STARTED
			Out.bNotStarted = true;
			Out.bFinished = false;
			break;
		case EMissionProgress::OperatorStarted:
			Out.bPaid = true;
			Out.bHeldAtDispatched = true;
			break;
		case EMissionProgress::DispatchUnconfirmed:
			Out.bUnconfirmed = true;
			Out.bPaid = false;
			break;
		default:
			break;
		}
		return Out;
	}

	FProgressPanel PanelForStatusRouteWord(std::string_view Word)
	{
		FProgressPanel Out;
		Out.Panel = EFlowPanel::Progress;
		Out.bFinished = false;
		if (Word == "running" || Word == "completed")
		{
			Out = MissionFlowCeiling();
			Out.bFault = true;
			Out.bPaid = false;
			Out.bFinished = false; // FLOW_STATUS_COMPLETED_NOT_FINISHED
			return Out;
		}
		Out.Line = ProgressDisplayLabel(EMissionProgress::Waiting);
		return Out;
	}

	FProgressPanel PanelForWrapperToken(std::string_view Token)
	{
		if (Token == "running" || Token == "completed")
		{
			return PanelForStatusRouteWord(Token);
		}
		if (Token == "operator_started") { return PanelForProgress(EMissionProgress::OperatorStarted); }
		if (Token == "dispatch_unconfirmed") { return PanelForProgress(EMissionProgress::DispatchUnconfirmed); }
		if (Token == "not_started") { return PanelForProgress(EMissionProgress::NotStarted); }
		if (Token == "admitted_waiting") { return PanelForProgress(EMissionProgress::AdmittedHeld); }
		if (Token == "dispatching") { return PanelForProgress(EMissionProgress::AwaitingDispatchAnswer); }
		if (Token == "refused") { return PanelForProgress(EMissionProgress::Refused); }
		FProgressPanel Out;
		Out.Panel = EFlowPanel::Progress;
		Out.bFinished = false;
		Out.bUsesWrapperLabel = true;
		return Out;
	}

	FResultPanel ResultPanelFor(const FResultRead& Read)
	{
		FResultPanel Out;
		Out.Panel = EFlowPanel::Result;
		Out.bReported = Read.bReported;
		Out.bVerified = Read.bVerified;
		Out.bFinished = Read.bFinished || Read.bVerified;
		if (!Read.bReported && !Read.bVerified)
		{
			Out.Line = CopyNoResultYet;
			return Out;
		}
		if (Read.TraceId.bKnown)
		{
			Out.Lines.push_back(std::string("traceId: ") + Read.TraceId.Text); // FLOW_TRACE_ID_AS_REPORTED
		}
		if (Read.bCheckerReported)
		{
			Out.Lines.push_back(Read.Checker == ECheckerVerdict::Pass
				? (Read.bCheckerUnbound ? "checkerVerdict: PASS (names no judged sha256; not verified)" : "checkerVerdict: PASS")
				: Read.Checker == ECheckerVerdict::Fail ? "checkerVerdict: FAIL" : "checkerVerdict: NOT_RUN");
		}
		if (Read.Checker != ECheckerVerdict::NotRun)
		{
			// Only what the bridge returned: a missing field adds no line, a malformed one reads Unknown.
			if (Read.CheckerGameDigest.bKnown) { Out.Lines.push_back(std::string("checker.gameDigest: ") + Read.CheckerGameDigest.Text); }
			else if (Read.CheckerGameDigest.bPresent) { Out.Lines.push_back("checker.gameDigest: Unknown"); }
			if (Read.CheckerJudgedSha256.bKnown) { Out.Lines.push_back(std::string("checker.judgedTrimmedSha256: ") + Read.CheckerJudgedSha256.Text); }
			else if (Read.CheckerJudgedSha256.bPresent) { Out.Lines.push_back("checker.judgedTrimmedSha256: Unknown"); }
		}
		if (Read.Checker == ECheckerVerdict::Fail)
		{
			// A failed evaluation is shown as failed, never as completed, and offers no artifact (PR-B).
			Out.bVerified = false; // FLOW_CHECKER_FAIL_NOT_VERIFIED
			Out.bFinished = Read.bVerified;
			Out.Line = CopyCheckerFailed;
			AppendPhasesAndRevision(Out.Lines, Read);
			return Out;
		}
		else if (Read.TraceId.bNull)
		{
			Out.Lines.push_back("traceId: Unknown");
		}
		const bool bArtifactAllowed = Read.bVerified; // FLOW_ARTIFACT_ONLY_IF_VERIFIED
		if (bArtifactAllowed && Read.ArtifactName.bKnown)
		{
			Out.Lines.push_back(std::string("archive.artifactName: ") + Read.ArtifactName.Text);
		}
		else if (bArtifactAllowed && Read.ArtifactName.bNull)
		{
			Out.Lines.push_back("archive.artifactName: Unknown");
		}
		if (bArtifactAllowed && Read.ArtifactDigest.bKnown)
		{
			Out.Lines.push_back(std::string("archive.artifactDigest: ") + Read.ArtifactDigest.Text);
		}
		else if (bArtifactAllowed && Read.ArtifactDigest.bNull)
		{
			Out.Lines.push_back("archive.artifactDigest: Unknown");
		}
		if (bArtifactAllowed)
		{
			for (const std::string& Ref : Read.WorkArtifactRefs)
			{
				Out.Lines.push_back(std::string("workArtifactRefs: ") + Ref);
			}
		}
		Out.bShowsArtifact = bArtifactAllowed && HasReportedArtifact(Read);
		AppendPhasesAndRevision(Out.Lines, Read);
		if (!Read.bVerified)
		{
			Out.Line = CopyNoResultYet;
			return Out;
		}
		Out.Line = Read.Checker == ECheckerVerdict::Pass && !Read.bCheckerUnbound ? CopyStateCompletedChecked : CopyStateCompleted; // FLOW_COMPLETED_ONLY_ON_PASS
		if (Read.CompletionTraceId.bKnown)
		{
			Out.Lines.push_back(std::string("completion.traceId: ") + Read.CompletionTraceId.Text);
		}
		else if (Read.CompletionTraceId.bNull)
		{
			Out.Lines.push_back("completion.traceId: Unknown");
		}
		constexpr bool bSynthesizeTraceparent = false; // FLOW_TRACEPARENT_NOT_COMPUTED
		if (Read.CompletionTraceparent.bKnown)
		{
			Out.Lines.push_back(std::string("traceparent: ") + Read.CompletionTraceparent.Text);
		}
		else if (bSynthesizeTraceparent && Read.TraceId.bKnown)
		{
			Out.Lines.push_back(std::string("traceparent: 00-") + Read.TraceId.Text + "-0000000000000001-01");
		}
		AppendInt(Out.Lines, "spendTag.reservedUsdMicros", Read.ReservedUsdMicros, Read.bSpendTagPresent);
		AppendInt(Out.Lines, "spendAccounting.knownUsdMicros", Read.SpendAccountingKnownUsdMicros, Read.bSpendAccountingPresent);
		if (Read.bSpendAccountingNull)
		{
			Out.Lines.push_back("spendAccounting: Unknown"); // FLOW_NULL_SPEND_ACCOUNTING_IS_UNKNOWN
		}
		AppendInt(Out.Lines, "coderCost.costUsdMicros", Read.CoderCostUsdMicros, Read.bCoderCostPresent);
		if (Read.bCoderCostPresent && Read.CoderCostBasis.bKnown)
		{
			Out.Lines.push_back(std::string("coderCost.costBasis: ") + Read.CoderCostBasis.Text);
		}
		AppendInt(Out.Lines, "missionCost.knownUsdMicros", Read.MissionKnownUsdMicros, Read.bMissionCostPresent);
		AppendInt(Out.Lines, "missionCost.unknownComponents", Read.MissionUnknownComponents, Read.bMissionCostPresent);
		if (Read.bMissionCostPresent)
		{
			if (Read.MissionCostComplete.bKnown)
			{
				Out.Lines.push_back(std::string("missionCost.complete: ") + (Read.MissionCostComplete.bValue ? "true" : "false"));
			}
			else
			{
				Out.Lines.push_back("missionCost.complete: Unknown");
			}
		}
		if (Read.bEchoProviderMessageId && Read.ProviderMessageId.bKnown)
		{
			Out.Lines.push_back(std::string("providerMessageId: ") + Read.ProviderMessageId.Text);
		}
		return Out;
	}

	FResultRead ParseBridgeMissionResponses(
		std::string_view WljRunId,
		int ResultStatus,
		std::string_view ResultJson,
		int ProgressStatus,
		std::string_view ProgressJson)
	{
		if (!WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId)) { return {}; }
		if (ResultStatus != 200) { return FResultRead{}; } // FLOW_NON_200_IS_NO_READ
		FJson Root;
		if (!ParseJson(ResultJson, Root) || Root.Kind != EJsonKind::Object) { return {}; }
		if (Field(Root, "error") != nullptr) { return FResultRead{}; } // FLOW_ERROR_BODY_IS_NOT_A_RESULT
		const FReportedString BodyRun = ReadString(&Root, "wljRunId");
		if (!BodyRun.bKnown || !SameText(BodyRun.Text, WljRunId)) { return FResultRead{}; } // FLOW_WLJ_MISMATCH_NO_READ

		FResultRead Out;
		Out.bParsed = true;
		Out.bReported = true;
		Out.TraceId = ReadString(&Root, "traceId");
		const FReportedString Verdict = ReadString(&Root, "checkerVerdict");
		if (Verdict.bKnown && (Verdict.Text == "PASS" || Verdict.Text == "FAIL" || Verdict.Text == "NOT_RUN"))
		{
			Out.bCheckerReported = true;
			Out.Checker = Verdict.Text == "PASS" ? ECheckerVerdict::Pass
				: Verdict.Text == "FAIL" ? ECheckerVerdict::Fail : ECheckerVerdict::NotRun; // FLOW_CHECKER_CLOSED_SET
		}
		const FReportedString State = ReadString(&Root, "state");
		if (State.bKnown) { Out.State = State.Text; }
		// Filled below with the completion object; a PASS must name what it judged (Julius #448 contract).
		const auto BindChecker = [&Out]()
		{
			if (Out.Checker == ECheckerVerdict::Pass && !Out.CheckerJudgedSha256.bKnown)
			{
				Out.bCheckerUnbound = true; // FLOW_PASS_MUST_NAME_JUDGED_SHA
			}
			// The in-game digest is the judged sha256's first 12 hex (bridge-enforced; checked again here, REVIEW #462 LOW).
			if (Out.Checker == ECheckerVerdict::Pass && Out.CheckerJudgedSha256.bKnown && Out.CheckerGameDigest.bKnown
				&& Out.CheckerGameDigest.Text != Out.CheckerJudgedSha256.Text.substr(0, 12))
			{
				Out.bCheckerUnbound = true; // FLOW_PASS_DIGEST_MATCHES_JUDGED
			}
		};
		Out.Cause = ReadString(&Root, "cause");
		// #478: any non-null outcomeUnknown object is OUTCOME UNKNOWN, whatever its cause string says.
		const FJson* Unknown = Field(Root, "outcomeUnknown");
		if (Unknown != nullptr && Unknown->Kind == EJsonKind::Object)
		{
			Out.bOutcomeUnknown = true; // FLOW_OUTCOME_UNKNOWN_ANY_OBJECT
			const FReportedString UnknownCause = ReadString(Unknown, "cause");
			if (UnknownCause.bKnown) { Out.OutcomeUnknownCause = UnknownCause.Text; }
		}
		Out.Phases = ReadPhases(&Root, Out.PhaseSlots);
		Out.ProjectBrainRevision = ReadRevision(&Root, Out.bRevisionMalformed);
		const FJson* Completion = Field(Root, "completion");
		const bool bCompletionObject = Completion != nullptr && Completion->Kind == EJsonKind::Object;
		if (bCompletionObject)
		{
			ReadArtifact(Completion, Out);
			ReadCosts(Completion, Out);
			Out.CompletionTraceId = ReadString(Completion, "traceId");
			const FJson* Checker = Field(*Completion, "checker");
			if (Checker != nullptr && Checker->Kind == EJsonKind::Object)
			{
				Out.CheckerGameDigest = LowerHexOrUnknown(ReadString(Checker, "gameDigest"), 12);
				Out.CheckerJudgedSha256 = LowerHexOrUnknown(ReadString(Checker, "judgedTrimmedSha256"), 64);
			}
			Out.CompletionTraceparent = ReadString(Completion, "traceparent");
			std::vector<FPhaseSlot> CompletionSlots;
			const EPhaseList CompletionPhases = ReadPhases(Completion, CompletionSlots);
			if (CompletionPhases != EPhaseList::Absent && PhaseKey(CompletionPhases, CompletionSlots) != PhaseKey(Out.Phases, Out.PhaseSlots))
			{
				Out.bPhasesSplit = true; // FLOW_COMPLETION_PHASES_AGREE
			}
			bool bCompletionRevisionMalformed = false;
			const FJson* CompletionRevision = Field(*Completion, "projectBrainRevision");
			if (CompletionRevision != nullptr
				&& RevisionKey(ReadRevision(Completion, bCompletionRevisionMalformed)) != RevisionKey(Out.ProjectBrainRevision))
			{
				Out.bRevisionSplit = true; // FLOW_COMPLETION_REVISION_AGREES
			}
		}
		BindChecker();
		constexpr bool bAcceptNullAccountingAsSettled = false; // FLOW_NULL_SPEND_ACCOUNTING_NOT_COMPLETION

		bool bVerified = EvidenceVerifies(Root, bCompletionObject ? Completion : nullptr, WljRunId);
		if (bAcceptNullAccountingAsSettled && Out.bSpendAccountingNull) { bVerified = true; }
		if (Completion == nullptr || Completion->Kind == EJsonKind::Null)
		{
			bVerified = false; // FLOW_NULL_COMPLETION_NOT_VERIFIED
		}
		constexpr bool bAcceptBareCompleted = false; // FLOW_BARE_COMPLETED_IS_NOT_EVIDENCE
		if (bAcceptBareCompleted && BoolIsTrue(&Root, "completed")) { bVerified = true; }

		bool bPhasesPresent = false;
		bool bProgressParsed = false;
		std::string ProgressState;
		const bool bProgressSupplied = ProgressStatus != 0 || !ProgressJson.empty();
		if (bProgressSupplied && ProgressStatus == 200)
		{
			FJson Progress;
			const FReportedString ProgressRun = ParseJson(ProgressJson, Progress) && Progress.Kind == EJsonKind::Object
				? ReadString(&Progress, "wljRunId")
				: FReportedString{};
			if (Progress.Kind == EJsonKind::Object && ProgressRun.bKnown && SameText(ProgressRun.Text, WljRunId))
			{
				bProgressParsed = true;
				const FReportedString ProgressWord = ReadString(&Progress, "state");
				if (ProgressWord.bKnown) { ProgressState = ProgressWord.Text; }
				const FJson* Phases = Field(Progress, "phases");
				bPhasesPresent = Phases != nullptr && Phases->Kind == EJsonKind::Array;
				std::vector<FPhaseSlot> ProgressSlots;
				const EPhaseList ProgressPhases = ReadPhases(&Progress, ProgressSlots);
				if (ProgressPhases != EPhaseList::Absent && PhaseKey(ProgressPhases, ProgressSlots) != PhaseKey(Out.Phases, Out.PhaseSlots))
				{
					Out.bPhasesSplit = true; // FLOW_PROGRESS_PHASES_AGREE
				}
				bool bProgressRevisionMalformed = false;
				if (Field(Progress, "projectBrainRevision") != nullptr
					&& RevisionKey(ReadRevision(&Progress, bProgressRevisionMalformed)) != RevisionKey(Out.ProjectBrainRevision))
				{
					Out.bRevisionSplit = true; // FLOW_PROGRESS_REVISION_AGREES
				}
			}
			else
			{
				bVerified = false;
			}
		}
		constexpr bool bAcceptPhasesAsCompletion = false; // FLOW_PHASES_ARE_NOT_COMPLETION
		if (bAcceptPhasesAsCompletion && bPhasesPresent) { bVerified = true; }
		constexpr bool bAcceptProgressStateCompleted = false; // FLOW_PROGRESS_STATE_IS_NOT_EVIDENCE
		if (bAcceptProgressStateCompleted && ProgressState == "completed") { bVerified = true; }
		if (bProgressParsed && ProgressState != Out.State) { bVerified = false; } // FLOW_SPLIT_STATE_NOT_VERIFIED

		const bool bUnknown = !State.bKnown || State.Text == "unknown";
		const bool bExpired = State.bKnown && State.Text == "failed" && Out.Cause.bKnown
			&& Out.Cause.Text == "AWAITING_OPERATOR_EXPIRED";
		if (bUnknown)
		{
			Out.bUnknownState = true;
			bVerified = false; // FLOW_ROUTE_UNKNOWN_NOT_VERIFIED
			Out.bFinished = false; // FLOW_ROUTE_UNKNOWN_READ_NOT_FINISHED
		}
		else if (bExpired)
		{
			Out.bExpired = true;
			bVerified = false; // FLOW_EXPIRED_NOT_VERIFIED
			Out.bFinished = false; // FLOW_EXPIRED_READ_NOT_FINISHED
		}
		else
		{
			Out.bFinished = bVerified;
		}
		Out.bVerified = bVerified;
		if (Out.bPhasesSplit)
		{
			Out.Phases = EPhaseList::Malformed; // FLOW_SPLIT_PHASES_ARE_UNKNOWN
			Out.PhaseSlots.clear();
		}
		if (Out.bRevisionSplit)
		{
			Out.ProjectBrainRevision = FReportedInt64{}; // FLOW_SPLIT_REVISION_IS_UNKNOWN
		}
		Out.bDispatchedCeiling = Out.bParsed && !Out.bVerified && Out.State == "dispatched";
		Out.bEchoProviderMessageId = false; // FLOW_MESSAGE_ID_IS_NOT_A_RECEIPT
		return Out;
	}

	void FBridgeMissionResultClient::Clear()
	{
		bHaveResult = false;
		ResultStatus = 0;
		ResultJson.clear();
		bHaveProgress = false;
		ProgressStatus = 0;
		ProgressJson.clear();
	}

	void FBridgeMissionResultClient::SetResultResponse(int Status, std::string_view Json)
	{
		bHaveResult = true;
		ResultStatus = Status;
		ResultJson.assign(Json.data(), Json.size());
	}

	void FBridgeMissionResultClient::SetProgressResponse(int Status, std::string_view Json)
	{
		bHaveProgress = true;
		ProgressStatus = Status;
		ProgressJson.assign(Json.data(), Json.size());
	}

	FResultRead FBridgeMissionResultClient::Read(std::string_view WljRunId) const
	{
		if (!bHaveResult && !bHaveProgress) { return {}; }
		return ParseBridgeMissionResponses(
			WljRunId,
			bHaveResult ? ResultStatus : 0,
			bHaveResult ? std::string_view(ResultJson) : std::string_view{},
			bHaveProgress ? ProgressStatus : 0,
			bHaveProgress ? std::string_view(ProgressJson) : std::string_view{});
	}

	void FMissionFlow::SetOffers(std::vector<FMissionOffer> InOffers)
	{
		OfferList = std::move(InOffers);
	}

	void FMissionFlow::InteractWithTerminal()
	{
		if (Step == EFlowStep::AtTerminal) { Step = EFlowStep::Choosing; }
	}

	bool FMissionFlow::ChooseMission(std::string_view MissionId)
	{
		if (Step != EFlowStep::Choosing && Step != EFlowStep::Confirming) { return false; }
		for (const FMissionOffer& Offer : OfferList)
		{
			if (Offer.Id == MissionId)
			{
				ChosenId.assign(MissionId.data(), MissionId.size());
				Step = EFlowStep::Confirming;
				return true;
			}
		}
		return false;
	}

	void FMissionFlow::BackToChoice()
	{
		if (Step == EFlowStep::Confirming)
		{
			Step = EFlowStep::Choosing;
		}
	}

	FDispatchIntent FMissionFlow::Confirm() const
	{
		FDispatchIntent Intent;
		if (Step != EFlowStep::Confirming || ChosenId.empty() || bDispatchHanded) { return Intent; }
		Intent.bSend = true;
		Intent.MissionId = ChosenId;
		return Intent;
	}

	void FMissionFlow::NoteDispatchHandedToWrapper(bool bAccepted)
	{
		if (!bAccepted || Step != EFlowStep::Confirming || ChosenId.empty() || bDispatchHanded) { return; }
		bDispatchHanded = true;
		Step = EFlowStep::Watching;
	}

	bool FMissionFlow::ResumeWatching(std::string_view MissionId)
	{
		if (bDispatchHanded || MissionId.empty()) { return false; } // FLOW_RESUME_ONLY_BEFORE_A_HANDOFF
		bool bOffered = false;
		for (const FMissionOffer& Offer : OfferList)
		{
			if (Offer.Id == MissionId) { bOffered = true; break; }
		}
		if (!bOffered) { return false; } // FLOW_RESUME_ONLY_AN_OFFER
		ChosenId.assign(MissionId.data(), MissionId.size());
		bDispatchHanded = true;
		Step = EFlowStep::Watching;
		return true;
	}

	bool FMissionFlow::StartAgain()
	{
		if (Step != EFlowStep::Watching) { return false; } // FLOW_START_AGAIN_ONLY_FROM_WATCHING
		const std::vector<FMissionOffer> Kept = OfferList;
		*this = FMissionFlow();
		OfferList = Kept;
		Step = EFlowStep::Choosing;
		return true;
	}

	void FMissionFlow::NoteClientRunId(std::string_view WljRunId)
	{
		if (!WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId))
		{
			return;
		}
		ClientRunId.assign(WljRunId.data(), WljRunId.size());
		bRunIdOk = true;
	}

	void FMissionFlow::NoteProgress(EMissionProgress Next)
	{
		Meaning = Next;
		bHaveMeaning = true;
	}

	void FMissionFlow::NoteStatusRouteWord(std::string_view Word)
	{
		StatusWord.assign(Word.data(), Word.size());
		bHaveWord = true;
	}

	void FMissionFlow::NoteWrapperToken(std::string_view Token)
	{
		WrapperToken.assign(Token.data(), Token.size());
		bHaveToken = true;
	}

	void FMissionFlow::NoteResult(const IMissionResultReader& Reader)
	{
		if (!bRunIdOk)
		{
			RouteRead = {};
			Result = ResultPanelFor(RouteRead);
			return;
		}
		RouteRead = Reader.Read(ClientRunId);
		Result = ResultPanelFor(RouteRead);
	}

	FFlowView FMissionFlow::View() const
	{
		FFlowView Out;
		Out.Step = Step;
		Out.bShowChoice = Step == EFlowStep::Choosing || Step == EFlowStep::Confirming;
		Out.bShowConfirm = Step == EFlowStep::Confirming;
		Out.bShowProgress = Step == EFlowStep::Watching;
		Out.bShowResult = Step == EFlowStep::Watching;
		Out.MissionId = ChosenId;
		Out.ClientRunId = ClientRunId;
		Out.bRunIdOk = bRunIdOk;
		Out.bDispatchHanded = bDispatchHanded;
		Out.Result = bRunIdOk ? Result : ResultPanelFor(FResultRead{});
		if (!Out.bShowProgress) { return Out; }

		if (bRunIdOk && RouteRead.bExpired)
		{
			Out.Progress = ProgressForExpiredRoute();
			return Out;
		}
		if (bRunIdOk && RouteRead.bUnknownState)
		{
			Out.Progress = ProgressForUnknownRoute();
			return Out;
		}
		if (bRunIdOk && RouteRead.bParsed && !RouteRead.bVerified && RouteRead.State == "completed")
		{
			Out.Progress = MissionFlowCeiling();
			Out.Progress.bFault = true;
			Out.Progress.bPaid = false;
			Out.Progress.bFinished = false; // FLOW_UNVERIFIED_COMPLETED_STAYS_DISPATCHED
			return Out;
		}
		if (bRunIdOk && RouteRead.bParsed && !RouteRead.bVerified && RouteRead.bDispatchedCeiling)
		{
			Out.Progress = PanelForProgress(EMissionProgress::OperatorStarted);
			Out.Progress.bFinished = false; // FLOW_UNPLUGGED_NOT_FINISHED
			return Out;
		}
		if (bRunIdOk && RouteRead.bParsed && !RouteRead.bVerified && RouteRead.State == "awaiting_operator")
		{
			Out.Progress = PanelForProgress(EMissionProgress::AdmittedHeld);
			Out.Progress.bFinished = false;
			return Out;
		}
		if (bHaveWord && (StatusWord == "running" || StatusWord == "completed"))
		{
			Out.Progress = PanelForStatusRouteWord(StatusWord);
			return Out;
		}
		if (bHaveMeaning)
		{
			Out.Progress = PanelForProgress(Meaning);
			return Out;
		}
		if (bHaveToken)
		{
			Out.Progress = PanelForWrapperToken(WrapperToken);
			return Out;
		}
		if (bHaveWord)
		{
			Out.Progress = PanelForStatusRouteWord(StatusWord);
			return Out;
		}
		Out.Progress = PanelForProgress(EMissionProgress::Waiting);
		return Out;
	}

	namespace
	{
		/** Printable ASCII only, at most MaxLen bytes; anything else is refused (never echoed). */
		bool LivePlainText(const FJson* Node, std::size_t MaxLen, bool bAllowEmpty, std::string& Out)
		{
			if (Node == nullptr || Node->Kind != EJsonKind::String) { return false; }
			if (Node->Text.size() > MaxLen || (!bAllowEmpty && Node->Text.empty())) { return false; }
			for (const char Ch : Node->Text)
			{
				if (Ch < 0x20 || Ch > 0x7E) { return false; } // FLOW_LIVE_PLAIN_TEXT_ONLY
			}
			Out = Node->Text;
			return true;
		}

		/** A closed-vocabulary word: lowercase letters and '_', 1..32. */
		bool LiveWord(const FJson* Node, std::string& Out)
		{
			if (Node == nullptr || Node->Kind != EJsonKind::String || Node->Text.empty() || Node->Text.size() > 32) { return false; }
			for (const char Ch : Node->Text)
			{
				if (!((Ch >= 'a' && Ch <= 'z') || Ch == '_')) { return false; }
			}
			Out = Node->Text;
			return true;
		}

		bool LiveBool(const FJson* Node, bool& Out)
		{
			if (Node == nullptr || Node->Kind != EJsonKind::Bool) { return false; }
			Out = Node->bBool;
			return true;
		}

		bool LiveInt(const FJson* Node, std::int64_t Min, std::int64_t Max, std::int64_t& Out)
		{
			if (Node == nullptr || Node->Kind != EJsonKind::Number || !Node->bInt || Node->Int < Min || Node->Int > Max) { return false; }
			Out = Node->Int;
			return true;
		}

		/** GitHub's own run/job/step status words, passed through by the bridge (rehearsal b, run 40227111617). */
		bool LiveStatusWord(const std::string& S)
		{
			return S == "queued" || S == "in_progress" || S == "completed" || S == "waiting" || S == "pending" || S == "requested";
		}
		/** The bridge's LIVE_PROGRESS_GRAMMAR (338da8b3): `other` is a real runtime value, shown as "other", never a guess. */
		bool LiveRole(const std::string& S) { return S == "architect" || S == "coder" || S == "reviewer" || S == "other"; }
		bool LiveTaskType(const std::string& S)
		{
			return S == "plan" || S == "build" || S == "review" || S == "research" || S == "repair_plan" || S == "repair_build"
				|| S == "repair_guidance" || S == "repair_rebuttal" || S == "repair_audit" || S == "other";
		}
		bool LiveTaskState(const std::string& S)
		{
			return S == "blocked" || S == "runnable" || S == "active" || S == "succeeded" || S == "failed" || S == "cancelled"
				|| S == "skipped" || S == "other";
		}
		bool LiveReason(const std::string& S)
		{
			return S == "not_dispatched" || S == "run_unbound" || S == "run_mismatch" || S == "github_unreadable"
				|| S == "live_view_unconfigured"; // FLOW_LIVE_REASON_VIEW_UNCONFIGURED
		}
	}

	FLiveRead ParseLiveEvents(std::string_view WljRunId, int HttpStatus, std::string_view Json)
	{
		FLiveRead Out;
		if (HttpStatus != 200 || !WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId)) { return Out; }
		FJson Root;
		// An /events page holds up to LiveMaxEventsPerPage events (the result/progress bodies keep the 64 cap); a
		// 106-event recorded page was refused whole under the shared cap (rehearsal, GitHub run 40228072875).
		if (!ParseJson(Json, Root, LiveMaxEventsPerPage, LiveJsonNodeLimit) || Root.Kind != EJsonKind::Object) { return Out; }
		const FReportedString Run = ReadString(&Root, "wljRunId");
		if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return Out; } // FLOW_LIVE_OWN_RUN_ONLY
		FLiveRead Read;
		const FJson* Source = Field(Root, "source");
		if (IsExactString(Source, "github_actions")) { Read.Source = ELiveSource::GithubActions; }
		else if (IsExactString(Source, "github_actions_recorded")) { Read.Source = ELiveSource::GithubActionsRecorded; }
		else if (IsExactString(Source, "none")) { Read.Source = ELiveSource::None; }
		else { return Out; }
		if (!LiveBool(Field(Root, "live"), Read.bLive) || !LiveBool(Field(Root, "stale"), Read.bStale)) { return Out; }
		// The server's live flag is only meaningful for a bound live source; a recorded run or "none" is never live.
		if (Read.bLive && Read.Source != ELiveSource::GithubActions) { return Out; } // FLOW_LIVE_ONLY_FROM_A_BOUND_RUN
		const FJson* Reason = Field(Root, "reason");
		if (Read.Source == ELiveSource::None)
		{
			if (!LiveWord(Reason, Read.Reason) || !LiveReason(Read.Reason)) { return Out; }
		}
		else if (Reason != nullptr && Reason->Kind != EJsonKind::Null) { return Out; }
		const FJson* Mode = Field(Root, "mode");
		if (IsExactString(Mode, "paid")) { Read.Mode = ELiveMode::Paid; }
		else if (IsExactString(Mode, "preflight")) { Read.Mode = ELiveMode::Preflight; }
		else if (Mode != nullptr && Mode->Kind != EJsonKind::Null) { return Out; }
		const FJson* Status = Field(Root, "runStatus");
		if (Status != nullptr && Status->Kind == EJsonKind::String)
		{
			if (Status->Text == "queued") { Read.Run = ELiveRunStatus::Queued; }
			else if (Status->Text == "in_progress") { Read.Run = ELiveRunStatus::InProgress; }
			else if (Status->Text == "completed") { Read.Run = ELiveRunStatus::Completed; }
			else if (Status->Text == "waiting" || Status->Text == "pending" || Status->Text == "requested") { Read.Run = ELiveRunStatus::Queued; }
			else { return Out; }
		}
		else if (Status == nullptr || Status->Kind != EJsonKind::Null) { return Out; }
		if (Read.bLive && Read.Run == ELiveRunStatus::Completed) { return Out; } // a finished run is never live
		const FJson* Conclusion = Field(Root, "runConclusion");
		if (Conclusion != nullptr && Conclusion->Kind != EJsonKind::Null && !LiveWord(Conclusion, Read.RunConclusion)) { return Out; }
		const FJson* Workflow = Field(Root, "workflowRunId");
		if (Workflow != nullptr && Workflow->Kind == EJsonKind::String)
		{
			if (!Digits(Workflow->Text) || Workflow->Text.size() > 20) { return Out; }
			Read.WorkflowRunId = Workflow->Text;
		}
		else if (Workflow == nullptr || Workflow->Kind != EJsonKind::Null) { return Out; }
		if (Read.Source != ELiveSource::None && Read.WorkflowRunId.empty()) { return Out; } // FLOW_LIVE_NEEDS_A_REAL_RUN
		const FJson* Events = Field(Root, "events");
		if (Events == nullptr || Events->Kind != EJsonKind::Array || Events->Array.size() > LiveMaxEventsPerPage) { return Out; }
		if (Read.Source == ELiveSource::None && !Events->Array.empty()) { return Out; }
		// One bad field must not drop a whole page (founder ruling 2026-10-30): an event whose seq is readable but whose
		// other fields are not is SKIPPED (named in SkippedSeqs, never shown, never latched); an unreadable seq or a
		// non-object fails the page, because the seq is what orders and resumes the stream.
		const auto ReadEvent = [](const FJson& Node, FLiveEvent& Event) -> bool
		{
			const FJson* At = Field(Node, "at");
			if (At != nullptr && At->Kind != EJsonKind::Null && !LivePlainText(At, 40, false, Event.At)) { return false; }
			if (At == nullptr) { return false; }
			const FJson* Kind = Field(Node, "kind");
			if (IsExactString(Kind, "job") || IsExactString(Kind, "step"))
			{
				Event.Kind = Kind->Text;
				if (!LivePlainText(Field(Node, "job"), 120, false, Event.Job)) { return false; }
				if (!LivePlainText(Field(Node, "name"), 120, false, Event.Name)) { return false; }
				if (!LiveWord(Field(Node, "status"), Event.Status) || !LiveStatusWord(Event.Status)) { return false; }
				const FJson* EventConclusion = Field(Node, "conclusion");
				if (EventConclusion != nullptr && EventConclusion->Kind != EJsonKind::Null && !LiveWord(EventConclusion, Event.Conclusion)) { return false; }
			}
			else if (IsExactString(Kind, "phase"))
			{
				Event.Kind = "phase";
				const FJson* Marker = Field(Node, "marker");
				if (Marker != nullptr && Marker->Kind != EJsonKind::Null)
				{
					// A marker sample (idle between tasks, or the publisher ended) carries no task fields at all.
					if (!IsExactString(Marker, "idle") && !IsExactString(Marker, "ended")) { return false; } // FLOW_LIVE_MARKERS_ARE_CLOSED
					Event.Marker = Marker->Text;
					for (const char* Name : {"role", "taskType", "state", "ordinal", "repairCycle"})
					{
						const FJson* Rest = Field(Node, Name);
						if (Rest != nullptr && Rest->Kind != EJsonKind::Null) { return false; }
					}
					bool bMarkerSampled = false;
					if (!LiveBool(Field(Node, "sampled"), bMarkerSampled) || !bMarkerSampled) { return false; }
					return true;
				}
				if (!LiveWord(Field(Node, "role"), Event.Role) || !LiveRole(Event.Role)) { return false; } // FLOW_LIVE_ROLES_ARE_CLOSED
				if (!LiveWord(Field(Node, "taskType"), Event.TaskType) || !LiveTaskType(Event.TaskType)) { return false; }
				if (!LiveWord(Field(Node, "state"), Event.State) || !LiveTaskState(Event.State)) { return false; }
				// Phase events are snapshots of the active task (a commit status, at most every 10 s): a short task can be
				// missed between samples, so the server must say so and the panel never presents them as a complete log.
				bool bSampled = false;
				if (!LiveBool(Field(Node, "sampled"), bSampled) || !bSampled) { return false; } // FLOW_LIVE_PHASES_ARE_SAMPLES
				if (!LiveInt(Field(Node, "ordinal"), 0, 1000000, Event.Ordinal)) { return false; }
				// `c x` on the wire is null here: the cycle was not reported. Kept as -1 and never shown as a number.
				const FJson* Cycle = Field(Node, "repairCycle");
				if (Cycle != nullptr && Cycle->Kind == EJsonKind::Null) { Event.RepairCycle = -1; }
				else if (!LiveInt(Cycle, 0, 3, Event.RepairCycle)) { return false; } // FLOW_LIVE_REPAIR_CYCLE_BOUND
			}
			else { return false; }
			return true;
		};
		for (const FJson& Node : Events->Array)
		{
			if (Node.Kind != EJsonKind::Object) { return Out; }
			FLiveEvent Event;
			if (!LiveInt(Field(Node, "seq"), 0, INT64_MAX, Event.Seq)) { return Out; }
			if (ReadEvent(Node, Event)) { Read.Events.push_back(std::move(Event)); }
			else { Read.SkippedSeqs.push_back(Event.Seq); } // FLOW_LIVE_BAD_EVENT_SKIPPED_NOT_PAGE
		}
		const FJson* Reset = Field(Root, "reset");
		if (Reset != nullptr && Reset->Kind != EJsonKind::Null && !LiveBool(Reset, Read.bReset)) { return Out; }
		const FJson* Next = Field(Root, "next");
		if (Next != nullptr && Next->Kind != EJsonKind::Null)
		{
			if (!LivePlainText(Next, 64, false, Read.Next)) { return Out; }
			for (const char Ch : Read.Next)
			{
				if (Ch == ' ') { return Out; } // FLOW_LIVE_CURSOR_MATCHES_REQUEST (LiveEventsRequest refuses <= 0x20)
			}
		}
		Read.bParsed = true;
		return Read;
	}

	void FLiveFeed::Apply(const FLiveRead& Read)
	{
		if (!Read.bParsed) { return; } // a failed read keeps what was shown; it is not a new state
		if (!Workflow.empty() && !Read.WorkflowRunId.empty() && Read.WorkflowRunId != Workflow)
		{
			*this = FLiveFeed(); // a different workflow run is never merged into this one
		}
		if (Read.bReset)
		{
			// The server restarted the stream from seq 1 under a new epoch: replace, never append twice, and forget every
			// latch (a latch from the old epoch is not evidence in the new one). /status is read before anything is trusted.
			const std::size_t Skipped = SkippedCount;
			*this = FLiveFeed(); // FLOW_LIVE_RESET_CLEARS_LATCHES
			SkippedCount = Skipped;
			ResyncWhy = "reset";
		}
		else if (LastSeq >= 0)
		{
			// The bridge's seq is contiguous per run (cache.events.length + 1). The first new seq of a page that is not
			// LastSeq + 1, or a hole inside the page, means events were lost: drop the stream, replay it from the start.
			std::vector<std::int64_t> Fresh = Read.SkippedSeqs;
			for (const FLiveEvent& Event : Read.Events) { Fresh.push_back(Event.Seq); }
			std::sort(Fresh.begin(), Fresh.end());
			std::int64_t NextSeq = LastSeq + 1;
			bool bGap = false;
			for (const std::int64_t Seq : Fresh)
			{
				if (Seq < NextSeq) { continue; } // already held (a resumed page may repeat)
				if (Seq != NextSeq) { bGap = true; break; } // FLOW_LIVE_SEQ_GAP_DETECTED
				++NextSeq;
			}
			if (bGap)
			{
				const std::size_t Skipped = SkippedCount;
				const std::string KeptWorkflow = Workflow;
				*this = FLiveFeed(); // FLOW_LIVE_GAP_CLEARS_LATCHES
				SkippedCount = Skipped;
				bHasRead = true;
				SourceNow = Read.Source;
				Workflow = Read.WorkflowRunId.empty() ? KeptWorkflow : Read.WorkflowRunId; // which run is resyncing
				bResyncing = true;
				ResyncWhy = "seq_gap";
				return;
			}
		}
		bResyncing = false;
		SkippedCount += Read.SkippedSeqs.size();
		bHasRead = true;
		SourceNow = Read.Source;
		ReasonNow = Read.Reason;
		bLiveNow = Read.bLive;
		bStaleNow = Read.bStale;
		ModeNow = Read.Mode;
		RunNow = Read.Run;
		Conclusion = Read.RunConclusion;
		if (!Read.WorkflowRunId.empty()) { Workflow = Read.WorkflowRunId; }
		for (const FLiveEvent& Event : Read.Events)
		{
			if (Event.Seq <= LastSeq) { continue; } // FLOW_LIVE_RESUME_WITHOUT_DUPLICATES
			Latch(Event);
			EventList.push_back(Event);
			LastSeq = Event.Seq;
		}
		for (const std::int64_t Seq : Read.SkippedSeqs)
		{
			if (Seq > LastSeq) { LastSeq = Seq; } // a skipped event still holds its place in the order
		}
		if (EventList.size() > MaxEvents)
		{
			EventList.erase(EventList.begin(), EventList.begin() + static_cast<std::ptrdiff_t>(EventList.size() - MaxEvents));
		}
		if (!Read.Next.empty()) { CursorNow = Read.Next; }
	}

	namespace
	{
		// MAIN JULIUS's execution-state contract (2026-10-26): the workflow's real job/step names, ASCII-folded.
		constexpr const char* LiveJob = "Preflight, then the live mission";
		constexpr const char* LiveStep = "LIVE: run the first real Julius mission";
		constexpr const char* AttemptStepPrefix = "Record that a paid mission was attempted";
		constexpr const char* GradeJob = "J1: grade the final message with the pinned hidden checker";
	}

	void FLiveFeed::Latch(const FLiveEvent& Event)
	{
		if (Event.Kind == "phase")
		{
			if (Event.Marker.empty() && !Event.Role.empty())
			{
				bTaskPhaseSeen = true; // FLOW_EXEC_TASK_PHASE_IS_EXECUTION
				LastTaskPhaseEvent = Event;
			}
			return;
		}
		if (Event.Kind == "step" && Event.Job == LiveJob && Event.Name == LiveStep)
		{
			if (Event.Status == "in_progress" || Event.Status == "completed") { bLiveStepStarted = Event.Status == "in_progress" || Event.Conclusion != "skipped"; } // FLOW_EXEC_LIVE_STEP_IS_EXECUTION
			if (Event.Status == "completed" && Event.Conclusion != "skipped") { bLiveStepFinished = true; } // a skipped LIVE step never ran
			if (Event.Status == "completed")
			{
				LiveConclusion = Event.Conclusion;
				bLiveStepSucceeded = Event.Conclusion == "success";
				// MAIN JULIUS 2026-10-26: a LIVE step that ends failure/cancelled/timed_out interrupts at once.
				bLiveStepInterrupted = Event.Conclusion == "failure" || Event.Conclusion == "cancelled" || Event.Conclusion == "timed_out"; // FLOW_EXEC_LIVE_FAILURE_INTERRUPTS
			}
		}
		if (Event.Kind == "step" && Event.Job == LiveJob && Event.Name.rfind(AttemptStepPrefix, 0) == 0 && Event.Status == "completed" && Event.Conclusion == "success")
		{
			bAttemptRecorded = true;
		}
		if (Event.Kind == "job" && Event.Name == GradeJob && Event.Status == "completed") { bGradeJobFinished = true; }
		if (FirstFailureName.empty() && Event.Status == "completed" && Event.Conclusion == "failure")
		{
			FirstFailureName = Event.Kind == "job" ? Event.Name : Event.Job + " / " + Event.Name;
		}
	}

	FLivePanel LivePanelFor(const FLiveFeed& Feed, std::uint64_t MsSinceLastRead)
	{
		FLivePanel Out;
		if (!Feed.HasRead()) { return Out; }
		if (Feed.Resyncing())
		{
			// Events were lost: nothing from the old stream is shown (never a stale "running") until it is replayed.
			Out.bShow = true;
			Out.Header = "RESYNCING -- events were missed; reading the bridge's /status and replaying the stream"
				+ (Feed.WorkflowRunId().empty() ? std::string() : " (GitHub Actions run " + Feed.WorkflowRunId() + ")");
			return Out; // FLOW_LIVE_RESYNC_SHOWS_NOTHING_OLD
		}
		if (Feed.Source() == ELiveSource::None)
		{
			// not_dispatched is already said by the progress line; anything else says plainly why there is no live view.
			if (Feed.Reason() != "not_dispatched")
			{
				Out.bShow = true;
				Out.Header = std::string("Live view unavailable: ") + Feed.Reason();
			}
			return Out;
		}
		if (Feed.WorkflowRunId().empty()) { return Out; }
		Out.bShow = true;
		// STALE (founder ruling 2026-10-30): the bridge says GitHub is unreadable, or no good read for LiveNoReadAfterMs.
		// The view is then never live and never says "running" or "now": only what was last seen, labelled STALE.
		// (A finished run is not polled any more, so a long silence after the end is not staleness.)
		const bool bStaleView = Feed.IsStale() || (Feed.IsLive() && MsSinceLastRead > LiveNoReadAfterMs); // FLOW_LIVE_SILENCE_IS_STALE
		Out.bLive = Feed.IsLive() && !bStaleView; // FLOW_LIVE_STALE_IS_NEVER_LIVE
		const std::string RunRef = " (GitHub Actions run " + Feed.WorkflowRunId() + ")";
		if (Feed.Source() == ELiveSource::GithubActionsRecorded)
		{
			Out.Header = "RECORDED RUN, NOT LIVE" + RunRef; // FLOW_RECORDED_IS_NEVER_LIVE
			if (!Feed.RunConclusion().empty()) { Out.Header += " -- GitHub workflow conclusion: " + Feed.RunConclusion() + " (not the mission result)"; }
		}
		else if (bStaleView)
		{
			Out.Header = "STALE -- last known state only, not live" + RunRef;
		}
		else if (Out.bLive)
		{
			Out.Header = Feed.Mode() == ELiveMode::Preflight ? "LIVE -- PREFLIGHT (no paid calls)" + RunRef
				: Feed.Mode() == ELiveMode::Paid ? "LIVE -- the paid run is executing" + RunRef
				: "LIVE" + RunRef;
		}
		else
		{
			Out.Header = std::string("GitHub workflow ") + (Feed.Run() == ELiveRunStatus::Completed ? "finished" : "not running")
				+ (Feed.RunConclusion().empty() ? std::string() : ": " + Feed.RunConclusion() + " (workflow conclusion, not the mission result)")
				+ RunRef; // FLOW_LIVE_CONCLUSION_IS_THE_WORKFLOWS
		}
		if (Feed.IsStale())
		{
			Out.Header += " -- connection to GitHub lost, reconnecting";
		}
		else if (bStaleView)
		{
			Out.Header += " -- no update for " + std::to_string(MsSinceLastRead / 1000) + " s, reconnecting";
		}
		const std::vector<FLiveEvent>& Events = Feed.Events();
		for (auto It = Events.rbegin(); It != Events.rend(); ++It)
		{
			if (It->Kind != "phase") { continue; }
			if (!It->Marker.empty())
			{
				Out.Lines.push_back(It->Marker == "idle" ? std::string(Out.bLive ? "now: between tasks (idle)" : "last sampled: between tasks (idle)")
					: std::string("task progress stream ended (only the result says how the mission finished)"));
				Out.Lines.push_back("phase history is sampled every ~10 s; short tasks may not appear");
				break;
			}
			std::string Now = (Out.bLive ? "now: " : "last sampled: ") + It->Role + " / " + It->TaskType + " -- " + It->State;
			if (It->RepairCycle > 0) { Now += " (repair cycle " + std::to_string(It->RepairCycle) + " of 3)"; }
			else if (It->RepairCycle < 0 && It->TaskType.rfind("repair_", 0) == 0) { Now += " (repair cycle not reported)"; }
			Out.Lines.push_back(std::move(Now));
			Out.Lines.push_back("phase history is sampled every ~10 s; short tasks may not appear");
			break;
		}
		// Steps: each job/step collapsed to its LATEST reported state (rehearsal b: a raw tail of the stream was a wall of
		// not-yet-started steps). What runs now first, then how far the run is, then what finished last.
		struct FStepNow
		{
			const FLiveEvent* Latest = nullptr;
			std::int64_t FirstSeq = 0;
		};
		std::vector<std::pair<std::string, FStepNow>> Steps;
		for (const FLiveEvent& E : Events)
		{
			if (E.Kind == "phase") { continue; }
			const std::string Key = E.Kind + "\n" + E.Job + "\n" + E.Name;
			auto It = std::find_if(Steps.begin(), Steps.end(), [&Key](const std::pair<std::string, FStepNow>& Row) { return Row.first == Key; });
			if (It == Steps.end()) { Steps.push_back({Key, FStepNow{&E, E.Seq}}); }
			else { It->second.Latest = &E; }
		}
		std::size_t StepCount = 0;
		std::size_t Finished = 0;
		std::vector<const FLiveEvent*> Running;
		std::vector<const FLiveEvent*> Done;
		for (const auto& Row : Steps)
		{
			const FLiveEvent& E = *Row.second.Latest;
			if (E.Kind == "job")
			{
				if (E.Status == "in_progress") { Running.push_back(&E); }
				continue;
			}
			++StepCount;
			if (E.Status == "completed") { ++Finished; Done.push_back(&E); }
			else if (E.Status == "in_progress") { Running.push_back(&E); }
		}
		for (const FLiveEvent* E : Running)
		{
			// A running job is named only when none of its steps is reported running (the step is the better news).
			if (E->Kind == "job" && std::any_of(Running.begin(), Running.end(), [E](const FLiveEvent* S) { return S->Kind == "step" && S->Job == E->Name; })) { continue; }
			Out.Lines.push_back((Out.bLive ? "now running: " : "was running: ") + (E->Kind == "job" ? "job " + E->Name : E->Job + " / " + E->Name)); // FLOW_LIVE_NOW_RUNNING
		}
		if (StepCount > 0)
		{
			Out.Lines.push_back(std::string(WorkflowProgressLabel) + ": " + std::to_string(Finished) + " of " + std::to_string(StepCount) + " finished"); // FLOW_LIVE_STEPS_ARE_WORKFLOW_STEPS
		}
		std::sort(Done.begin(), Done.end(), [](const FLiveEvent* A, const FLiveEvent* B) { return A->Seq < B->Seq; });
		const std::size_t FirstDone = Done.size() > LivePanelLines ? Done.size() - LivePanelLines : 0;
		for (std::size_t I = FirstDone; I < Done.size(); ++I)
		{
			const FLiveEvent& E = *Done[I];
			std::string Line = "  done: " + E.Job + " / " + E.Name;
			if (!E.Conclusion.empty()) { Line += " (" + E.Conclusion + ")"; }
			Out.Lines.push_back(std::move(Line));
		}
		return Out;
	}

	bool StartConfirmTextOk(std::string_view Typed)
	{
		return Typed == StartConfirmPhrase; // FLOW_START_CONFIRM_EXACT
	}

	FStartAnswer ParseStartAnswer(std::string_view WljRunId, int HttpStatus, std::string_view Json)
	{
		// Contract (MAIN JULIUS, 2026-10-25): 202 = this request made the one dispatch; 200 + replayed:true = the admission
		// was already dispatching/dispatched (any key, any repeat); 409 = claim refused (retry:false); 400 = request
		// refused; 401 = session (re-pair, nothing dispatched); 503 / transport = nothing dispatched, a resend is allowed.
		FStartAnswer Out;
		if (HttpStatus == 0 || HttpStatus == 401 || HttpStatus == 502 || HttpStatus == 503 || HttpStatus == 504)
		{
			Out.Outcome = EStartOutcome::Retryable; // FLOW_START_RETRY_ONLY_TRANSIENT
			return Out;
		}
		FJson Root;
		if (!ParseJson(Json, Root) || Root.Kind != EJsonKind::Object) { return Out; }
		if (HttpStatus == 202 || HttpStatus == 200)
		{
			const FReportedString Run = ReadString(&Root, "wljRunId");
			if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return Out; } // FLOW_START_OWN_RUN_ONLY
			const FJson* State = Field(Root, "state");
			const FJson* Ack = Field(Root, "ack");
			if (Ack != nullptr)
			{
				// A-9 (JULIUS_WONDERLAND_START_ACK): 202 {ack:"accepted", state:"accepted", startKeyHash, acceptedAt, replayed,
				// workflowRunId:null, dispatchedAt:null}. The request was durably RECEIVED; nothing says it was dispatched.
				if (HttpStatus != 202 || !IsExactString(Ack, "accepted") || !IsExactString(State, "accepted")) { return Out; }
				const FJson* AckWorkflow = Field(Root, "workflowRunId");
				const FJson* AckDispatched = Field(Root, "dispatchedAt");
				if (AckWorkflow == nullptr || AckWorkflow->Kind != EJsonKind::Null || AckDispatched == nullptr || AckDispatched->Kind != EJsonKind::Null) { return Out; }
				const FJson* AckReplayed = Field(Root, "replayed");
				if (AckReplayed == nullptr || AckReplayed->Kind != EJsonKind::Bool) { return Out; }
				const FJson* Hash = Field(Root, "startKeyHash");
				if (Hash == nullptr || Hash->Kind != EJsonKind::String || !LowerHex(Hash->Text, 64)) { return Out; }
				Out.bReplayed = AckReplayed->bBool;
				Out.StartKeyHash = Hash->Text;
				Out.State = State->Text;
				Out.Outcome = EStartOutcome::Acknowledged; // FLOW_START_ACK_IS_NOT_DISPATCH
				return Out;
			}
			if (!IsExactString(State, "dispatched") && !IsExactString(State, "dispatching")) { return Out; }
			const FJson* WorkflowNode = Field(Root, "workflowRunId");
			if (WorkflowNode != nullptr && WorkflowNode->Kind == EJsonKind::String)
			{
				if (WorkflowNode->Text.empty() || WorkflowNode->Text.size() > 20 || !Digits(WorkflowNode->Text)) { return Out; }
				Out.WorkflowRunId = WorkflowNode->Text; // null = dispatched, run id pending: /status supplies it
			}
			else if (WorkflowNode == nullptr || WorkflowNode->Kind != EJsonKind::Null) { return Out; }
			const FJson* Replayed = Field(Root, "replayed");
			if (Replayed != nullptr && Replayed->Kind != EJsonKind::Bool) { return Out; }
			Out.bReplayed = Replayed != nullptr && Replayed->bBool;
			Out.State = State->Text;
			if (State->Text == "dispatching")
			{
				// "dispatching" is a record whose dispatch may not have reached GitHub: V2's dispatch_outcome_unknown answers 200
				// replayed:false, and a replay of such a record says the same word. Never bound as started; /status decides.
				if (HttpStatus != 200) { return Out; }
				Out.Outcome = EStartOutcome::Uncertain; // FLOW_START_DISPATCHING_IS_UNCERTAIN
				return Out;
			}
			if ((HttpStatus == 200) != Out.bReplayed) { return Out; } // 202 made it; 200 is only ever a replay
			Out.Outcome = EStartOutcome::Accepted;
			return Out;
		}
		const FJson* Error = Field(Root, "error");
		std::string Kind;
		if (Error != nullptr && Error->Kind == EJsonKind::Object)
		{
			const FJson* KindNode = Field(*Error, "kind");
			if (KindNode != nullptr && KindNode->Kind == EJsonKind::String && !KindNode->Text.empty() && KindNode->Text.size() <= 64)
			{
				for (const char Ch : KindNode->Text)
				{
					if (!((Ch >= 'a' && Ch <= 'z') || (Ch >= '0' && Ch <= '9') || Ch == '_')) { return Out; }
				}
				Kind = KindNode->Text;
			}
		}
		if (Kind.empty()) { return Out; }
		Out.ErrorKind = Kind;
		if (HttpStatus == 409 && Kind == "julius_start_in_progress") { Out.Outcome = EStartOutcome::InProgress; return Out; } // FLOW_START_IN_PROGRESS_POLLS_STATUS
		// The same key with a different body: an earlier Start under this key may be claiming. Not a refusal of THIS run.
		if (HttpStatus == 409 && Kind == "julius_start_key_reused") { Out.Outcome = EStartOutcome::Uncertain; return Out; } // FLOW_START_KEY_REUSED_IS_UNCERTAIN
		if (HttpStatus >= 400 && HttpStatus < 500) { Out.Outcome = EStartOutcome::Refused; }
		return Out;
	}

	EStartRecord StartRecordAfterAnswer(EStartOutcome Outcome, int HttpStatus)
	{
		switch (Outcome)
		{
		case EStartOutcome::Accepted: return EStartRecord::Started;
		case EStartOutcome::Acknowledged: return EStartRecord::Accepted; // FLOW_START_ACK_RECORD_IS_NOT_STARTED
		case EStartOutcome::InProgress: return EStartRecord::Accepted;
		case EStartOutcome::Refused: return EStartRecord::Refused;
		case EStartOutcome::Retryable:
			// Only an answer the bridge GAVE says nothing was dispatched. A lost answer is a timeout: reconcile first.
			return HttpStatus == 401 || HttpStatus == 503 ? EStartRecord::NotStarted : EStartRecord::Sending; // FLOW_START_LOST_ANSWER_BLOCKS
		case EStartOutcome::Uncertain:
		case EStartOutcome::Malformed:
		default: return EStartRecord::Sending; // FLOW_START_UNCERTAIN_BLOCKS
		}
	}

	bool ClientTriggerIdOk(std::string_view Id)
	{
		return LowerHex(std::string(Id), ClientTriggerIdChars);
	}

	FStartGate StartGateFor(std::string_view WrapperToken, bool bHasSession, bool bHasWorkflowRun, EStartRecord Record,
		bool bExplicitClick, std::string_view Typed)
	{
		FStartGate Out;
		if (WrapperToken != "admitted_waiting") { Out.Why = "the run is not waiting for the operator"; return Out; } // FLOW_START_ONLY_WHILE_AWAITING
		if (bHasWorkflowRun) { Out.Why = "this run already has a GitHub Actions run"; return Out; } // FLOW_START_NEVER_AFTER_DISPATCH
		if (Record == EStartRecord::Sending)
		{
			// Founder ruling 2026-10-30: a Start that crashed, timed out or is outcome-unknown is never re-offered and never
			// resent until /status has reconciled it.
			Out.Why = "the last Start is not reconciled yet; waiting for the bridge's /status";
			return Out; // FLOW_START_UNRECONCILED_BLOCKS
		}
		if (Record == EStartRecord::Accepted)
		{
			Out.Why = "the bridge accepted the Start request; waiting for /status to report the dispatch";
			return Out; // FLOW_START_ACCEPTED_NOT_REOFFERED
		}
		if (Record == EStartRecord::Started || Record == EStartRecord::Refused)
		{
			Out.Why = "this run was already started or refused";
			return Out; // FLOW_START_RECORDED_ONCE
		}
		if (!bHasSession) { Out.Why = "not paired"; return Out; }
		Out.bOffer = true;
		if (!bExplicitClick) { Out.Why = "waiting for the founder"; return Out; } // FLOW_START_ONLY_ON_CLICK
		if (!StartConfirmTextOk(Typed)) { Out.Why = "type RUN LIVE MISSION exactly"; return Out; }
		Out.bSend = true;
		Out.Why = "send";
		return Out;
	}

	namespace
	{
		struct FPhaseName
		{
			const char* Word;
			EMissionStatusPhase Phase;
		};
		constexpr FPhaseName PhaseNames[] = {
			{"unknown", EMissionStatusPhase::Unknown}, {"admitted", EMissionStatusPhase::Admitted},
			{"starting", EMissionStatusPhase::Starting}, {"dispatching", EMissionStatusPhase::Dispatching},
			{"dispatched", EMissionStatusPhase::Dispatched}, {"queued", EMissionStatusPhase::Queued},
			{"executing", EMissionStatusPhase::Executing}, {"grading", EMissionStatusPhase::Grading},
			{"completed", EMissionStatusPhase::Completed}, {"failed", EMissionStatusPhase::Failed},
			{"did_not_start", EMissionStatusPhase::DidNotStart}, {"interrupted", EMissionStatusPhase::Interrupted},
			{"expired", EMissionStatusPhase::Expired},
		};

		/** The bridge's TERMINAL_PHASES. */
		bool StatusPhaseTerminal(EMissionStatusPhase Phase)
		{
			return Phase == EMissionStatusPhase::Completed || Phase == EMissionStatusPhase::Failed || Phase == EMissionStatusPhase::DidNotStart
				|| Phase == EMissionStatusPhase::Interrupted || Phase == EMissionStatusPhase::Expired;
		}

		/** null -> -1; an integer in Min..Max -> it; anything else -> false. */
		bool StatusNullableInt(const FJson* Node, std::int64_t Min, std::int64_t Max, int& Out)
		{
			if (Node != nullptr && Node->Kind == EJsonKind::Null) { Out = -1; return true; }
			std::int64_t Value = 0;
			if (!LiveInt(Node, Min, Max, Value)) { return false; }
			Out = static_cast<int>(Value);
			return true;
		}

		/** A checker verdict word: "PASS", "FAIL", "NOT_RUN"... uppercase letters and '_', 1..16. */
		bool StatusVerdictWord(const FJson* Node, std::string& Out)
		{
			if (Node == nullptr || Node->Kind != EJsonKind::String || Node->Text.empty() || Node->Text.size() > 16) { return false; }
			for (const char Ch : Node->Text)
			{
				if (!((Ch >= 'A' && Ch <= 'Z') || Ch == '_')) { return false; }
			}
			Out = Node->Text;
			return true;
		}

		FMissionStatusRead StatusRefused(FMissionStatusRead Out, const char* Why)
		{
			Out.bOk = false;
			Out.Why = Why;
			return Out;
		}
	}

	const char* MissionStatusPhaseWord(EMissionStatusPhase Phase)
	{
		for (const FPhaseName& Name : PhaseNames)
		{
			if (Name.Phase == Phase) { return Name.Word; }
		}
		return "unknown";
	}

	FMissionStatusRead ParseMissionStatus(std::string_view WljRunId, int HttpStatus, std::string_view Json)
	{
		FMissionStatusRead Out;
		Out.HttpStatus = HttpStatus;
		if (HttpStatus != 200) { return StatusRefused(Out, "not_200"); }
		if (!WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId)) { return StatusRefused(Out, "no_run"); }
		FJson Root;
		if (!ParseJson(Json, Root) || Root.Kind != EJsonKind::Object) { return StatusRefused(Out, "not_json"); }
		if (!IsExactString(Field(Root, "schema"), MissionStatusSchema)) { return StatusRefused(Out, "schema"); } // FLOW_STATUS_SCHEMA_EXACT
		const FReportedString Run = ReadString(&Root, "wljRunId");
		if (!Run.bKnown || !SameText(Run.Text, WljRunId)) { return StatusRefused(Out, "other_run"); } // FLOW_STATUS_OWN_RUN_ONLY

		// Strict: what decides the Start record and the ending.
		std::string PhaseWord;
		if (!LiveWord(Field(Root, "phase"), PhaseWord)) { return StatusRefused(Out, "phase"); }
		bool bPhaseKnown = false;
		for (const FPhaseName& Name : PhaseNames)
		{
			if (PhaseWord == Name.Word) { Out.Phase = Name.Phase; bPhaseKnown = true; }
		}
		if (!bPhaseKnown) { return StatusRefused(Out, "phase"); } // FLOW_STATUS_PHASE_CLOSED_SET
		Out.PhaseWord = PhaseWord;
		if (!LiveBool(Field(Root, "terminal"), Out.bTerminal)) { return StatusRefused(Out, "terminal"); }
		if (Out.bTerminal != StatusPhaseTerminal(Out.Phase)) { return StatusRefused(Out, "terminal_mismatch"); } // FLOW_STATUS_TERMINAL_MATCHES_PHASE
		const FJson* Start = Field(Root, "start");
		if (Start == nullptr || Start->Kind != EJsonKind::Object) { return StatusRefused(Out, "start"); }
		if (!LiveBool(Field(*Start, "requested"), Out.bRequested)) { return StatusRefused(Out, "start.requested"); }
		const FJson* Workflow = Field(*Start, "workflowRunId");
		if (Workflow == nullptr || (Workflow->Kind != EJsonKind::Null && (Workflow->Kind != EJsonKind::String || !Digits(Workflow->Text))))
		{
			return StatusRefused(Out, "start.workflowRunId");
		}
		if (Workflow->Kind == EJsonKind::String) { Out.WorkflowRunId = Workflow->Text; }
		const FJson* Request = Field(*Start, "request");
		if (Request != nullptr && Request->Kind != EJsonKind::Null)
		{
			const FJson* RequestState = Request->Kind == EJsonKind::Object ? Field(*Request, "state") : nullptr;
			if (!IsExactString(RequestState, "accepted") && !IsExactString(RequestState, "claiming") && !IsExactString(RequestState, "settled")
				&& !IsExactString(RequestState, "interrupted"))
			{
				return StatusRefused(Out, "start.request.state");
			}
			Out.RequestState = RequestState->Text;
		}
		const FJson* Unreadable = Field(*Start, "requestUnreadable");
		if (Unreadable != nullptr && !LiveBool(Unreadable, Out.bRequestUnreadable)) { return StatusRefused(Out, "start.requestUnreadable"); }
		const FJson* RunNode = Field(Root, "run");
		if (RunNode == nullptr || (RunNode->Kind != EJsonKind::Null && RunNode->Kind != EJsonKind::Object)) { return StatusRefused(Out, "run"); }
		if (RunNode->Kind == EJsonKind::Object)
		{
			Out.bRunPresent = true;
			if (!LiveBool(Field(*RunNode, "live"), Out.bRunLive) || !LiveBool(Field(*RunNode, "stale"), Out.bRunStale)) { return StatusRefused(Out, "run.flags"); }
		}

		// Tolerant per field: what is only shown. A bad field is dropped (and named), never the page.
		const FJson* Result = Field(Root, "result");
		bool bResultOk = Result != nullptr && Result->Kind == EJsonKind::Object;
		if (bResultOk)
		{
			const FJson* Verdict = Field(*Result, "checkerVerdict");
			if (Verdict == nullptr || (Verdict->Kind != EJsonKind::Null && !StatusVerdictWord(Verdict, Out.CheckerVerdict))) { Out.CheckerVerdict.clear(); bResultOk = false; }
			if (!LiveBool(Field(*Result, "outcomeUnknown"), Out.bOutcomeUnknown)) { bResultOk = false; Out.bOutcomeUnknown = true; } // FLOW_STATUS_UNREADABLE_OUTCOME_IS_UNKNOWN
		}
		else
		{
			Out.bOutcomeUnknown = true;
		}
		if (!bResultOk) { Out.Skipped.push_back("result"); }
		const FJson* Progress = Field(Root, "progress");
		int Percent = -1;
		const bool bProgressOk = Progress != nullptr && Progress->Kind == EJsonKind::Object && StatusNullableInt(Field(*Progress, "percent"), 0, 100, Percent)
			&& (IsExactString(Field(*Progress, "basis"), "verified_completion") || IsExactString(Field(*Progress, "basis"), "none"))
			&& (Percent < 0 || IsExactString(Field(*Progress, "basis"), "verified_completion"));
		if (bProgressOk)
		{
			Out.ProgressPercent = Percent;
			Out.ProgressBasis = Field(*Progress, "basis")->Text;
		}
		else
		{
			Out.Skipped.push_back("progress"); // FLOW_STATUS_BAD_FIELD_KEEPS_PAGE
		}
		const FJson* Steps = Field(Root, "workflowProgress");
		int WfPercent = -1;
		int WfDone = -1;
		int WfTotal = -1;
		const bool bStepsOk = Steps != nullptr && Steps->Kind == EJsonKind::Object && IsExactString(Field(*Steps, "label"), WorkflowProgressLabel)
			&& StatusNullableInt(Field(*Steps, "percent"), 0, 100, WfPercent) && StatusNullableInt(Field(*Steps, "stepsCompleted"), 0, 100000, WfDone)
			&& StatusNullableInt(Field(*Steps, "stepsTotal"), 0, 100000, WfTotal) && (WfDone < 0 || WfTotal < 0 || WfDone <= WfTotal);
		if (bStepsOk)
		{
			Out.bWorkflowLabelOk = true;
			Out.WorkflowPercent = WfPercent;
			Out.WorkflowStepsCompleted = WfDone;
			Out.WorkflowStepsTotal = WfTotal;
		}
		else
		{
			Out.Skipped.push_back("workflowProgress");
		}
		const FJson* Poll = Field(Root, "nextPollMs");
		std::int64_t PollMs = 0;
		if (Poll != nullptr && Poll->Kind == EJsonKind::Null && Out.bTerminal)
		{
			Out.NextPollMs = 0; // terminal: the bridge says stop
		}
		else if (LiveInt(Poll, 0, INT64_MAX, PollMs))
		{
			Out.NextPollMs = static_cast<int>(PollMs < StatusPollMinMs ? StatusPollMinMs : PollMs > StatusPollMaxMs ? StatusPollMaxMs : PollMs);
		}
		else
		{
			Out.NextPollMs = Out.bTerminal ? 0 : StatusPollDefaultMs;
			Out.Skipped.push_back("nextPollMs");
		}
		const FJson* Cursor = Field(Root, "eventsCursor");
		if (Cursor != nullptr && Cursor->Kind != EJsonKind::Null && !LivePlainText(Cursor, 64, false, Out.EventsCursor))
		{
			Out.EventsCursor.clear();
			Out.Skipped.push_back("eventsCursor");
		}
		Out.bOk = true;
		return Out;
	}

	bool StatusIsVerifiedSuccess(const FMissionStatusRead& Status)
	{
		return Status.bOk && Status.Phase == EMissionStatusPhase::Completed // FLOW_SUCCESS_NEEDS_COMPLETED
			&& Status.CheckerVerdict == "PASS" // FLOW_SUCCESS_NEEDS_PASS
			&& Status.ProgressBasis == "verified_completion" && Status.ProgressPercent == 100 // FLOW_SUCCESS_NEEDS_VERIFIED_COMPLETION
			&& !Status.bOutcomeUnknown;
	}

	FStatusPanel StatusPanelFor(const FMissionStatusRead& Status)
	{
		FStatusPanel Out;
		if (!Status.bOk) { return Out; }
		Out.bShow = true;
		Out.bSuccess = StatusIsVerifiedSuccess(Status);
		const std::string Verdict = Status.CheckerVerdict.empty() ? std::string("not reported") : Status.CheckerVerdict;
		if (Out.bSuccess)
		{
			Out.Header = "Mission completed -- checker verdict PASS (verified completion)";
		}
		else if (Status.bOutcomeUnknown || Status.Phase == EMissionStatusPhase::Unknown)
		{
			Out.bOutcomeUnknown = true;
			Out.Header = "Outcome unknown -- needs reconciliation (operator)"; // FLOW_STATUS_PANEL_UNKNOWN_IS_LABELLED
		}
		else if (Status.Phase == EMissionStatusPhase::Completed)
		{
			// The run finished but did not pass: never worded or coloured as a success.
			Out.Header = "Mission run finished -- not a success (checker verdict: " + Verdict + ")"; // FLOW_STATUS_PANEL_COMPLETED_IS_NOT_SUCCESS
		}
		else if (Status.bTerminal)
		{
			Out.Header = std::string("Mission did not succeed -- ") + MissionStatusPhaseWord(Status.Phase);
		}
		else
		{
			Out.Header = std::string("Mission status: ") + MissionStatusPhaseWord(Status.Phase);
		}
		// Mission percent ONLY from status.progress, and only as the verified 100 (null = no percent at all).
		if (Out.bSuccess) // FLOW_STATUS_PANEL_PERCENT_GATE
		{
			Out.Lines.push_back("Mission progress: 100% (verified completion)"); // FLOW_STATUS_PANEL_PERCENT_ONLY_VERIFIED
		}
		if (Status.bWorkflowLabelOk) // FLOW_STATUS_PANEL_WORKFLOW_LABELLED
		{
			if (Status.WorkflowStepsCompleted >= 0 && Status.WorkflowStepsTotal > 0)
			{
				Out.Lines.push_back(std::string(WorkflowProgressLabel) + ": " + std::to_string(Status.WorkflowStepsCompleted) + " of "
					+ std::to_string(Status.WorkflowStepsTotal) + " finished");
			}
			else if (Status.WorkflowPercent >= 0)
			{
				Out.Lines.push_back(std::string(WorkflowProgressLabel) + ": " + std::to_string(Status.WorkflowPercent) + "%");
			}
		}
		if (Status.RequestState == "interrupted" && Status.WorkflowRunId.empty() && !Status.bRunPresent)
		{
			// YUJI M-b: explicit, non-dispatching, never re-sent automatically.
			Out.Lines.push_back("Start request interrupted -- nothing was dispatched; it is never re-sent automatically"); // FLOW_STATUS_PANEL_INTERRUPTED_IS_EXPLICIT
		}
		if (Status.bRunStale) { Out.Lines.push_back("GitHub run state is STALE (last known, not live)"); }
		if (!Status.bOutcomeUnknown && !Status.CheckerVerdict.empty() && !Out.bSuccess)
		{
			Out.Lines.push_back("checker verdict: " + Status.CheckerVerdict);
		}
		return Out;
	}

	FStartReconcile StartRecordFromStatus(EStartRecord Current, const FMissionStatusRead& Status)
	{
		using R = EStartRecord;
		using P = EMissionStatusPhase;
		FStartReconcile Out;
		Out.Record = Current;
		const bool bBlocking = Current == R::Sending || Current == R::Accepted;
		if (!Status.bOk)
		{
			if (bBlocking) { Out.Why = "the bridge's /status was not readable; Start stays blocked"; }
			return Out;
		}
		// A run with no local record that the bridge already holds a claim for (another client, a lost save) is never
		// offered: it reconciles like a lost answer.
		// YUJI M-b 2026-10-30: after a bridge restart a saved intent shows start.requested:false and retryStartSafe (the
		// journal alone); only start.request reveals it. So a request of any state opens the reconcile too, and
		// requested:false / retryStartSafe are never read as permission to send.
		const bool bOpen = bBlocking || Current == R::NotStarted || (Current == R::None && Status.bRequested) // FLOW_RECONCILE_CLAIM_WITHOUT_RECORD
			|| (Current == R::None && !Status.RequestState.empty()); // FLOW_RECONCILE_REQUEST_WITHOUT_RECORD
		if (!bOpen) { return Out; }
		const R Waiting = Current == R::Accepted ? R::Accepted : R::Sending;
		const P Ph = Status.Phase;
		const bool bDispatched = Status.bRunPresent || !Status.WorkflowRunId.empty() || Ph == P::Dispatched || Ph == P::Queued
			|| Ph == P::Executing || Ph == P::Grading || Ph == P::Completed;
		if (bDispatched)
		{
			Out.Record = R::Started; // FLOW_RECONCILE_DISPATCH_IS_STARTED
			Out.Why = "the bridge reports the dispatch";
		}
		else if (Ph == P::Unknown || Status.bOutcomeUnknown || Status.bRequestUnreadable)
		{
			Out.Record = Waiting; // FLOW_RECONCILE_UNKNOWN_STAYS_BLOCKED
			Out.Why = "outcome unknown, needs reconciliation (operator); Start stays blocked and nothing is resent";
		}
		else if (Status.RequestState == "interrupted")
		{
			Out.Record = R::Refused; // FLOW_RECONCILE_INTERRUPTED_IS_REFUSED
			Out.Why = "the bridge interrupted this Start request and will not resume it; a new Start needs a new key (never sent automatically)";
		}
		else if (StatusPhaseTerminal(Ph))
		{
			Out.Record = R::Refused; // FLOW_RECONCILE_TERMINAL_WITHOUT_DISPATCH_IS_REFUSED
			Out.Why = "the bridge settled this run without a dispatch";
		}
		else if (Status.RequestState == "accepted" || Status.RequestState == "claiming")
		{
			Out.Record = R::Accepted; // FLOW_RECONCILE_LIVE_REQUEST_BLOCKS
			Out.Why = "the bridge accepted the Start request; waiting for /status to report the dispatch";
		}
		else if (Status.bRequested || Ph != P::Admitted)
		{
			Out.Record = Waiting; // FLOW_RECONCILE_CLAIM_BLOCKS
			Out.Why = "the bridge is still starting this run; waiting for /status";
		}
		else
		{
			// Admitted, no claim, no Start running, no live request: nothing was dispatched. Offered again on a click only.
			Out.Record = R::NotStarted; // FLOW_RECONCILE_NOTHING_HELD_RELEASES
			Out.Why = "the bridge holds no Start for this run; Start may be pressed again (it re-sends the same authorisation)";
		}
		Out.bChanged = Out.Record != Current;
		return Out;
	}

	const char* ExecutionPhaseWord(EExecutionPhase Phase)
	{
		switch (Phase)
		{
		case EExecutionPhase::Starting: return "STARTING";
		case EExecutionPhase::Committing: return "COMMITTING";
		case EExecutionPhase::Executing: return "EXECUTING";
		case EExecutionPhase::Grading: return "GRADING";
		case EExecutionPhase::Completed: return "COMPLETED";
		case EExecutionPhase::Failed: return "FAILED";
		case EExecutionPhase::FailedUnverified: return "FAILED_UNVERIFIED";
		case EExecutionPhase::DidNotStart: return "DID_NOT_START";
		case EExecutionPhase::Cancelled: return "CANCELLED";
		case EExecutionPhase::OutcomeUnknown: return "OUTCOME_UNKNOWN";
		default: return "";
		}
	}

	FExecutionView ExecutionViewFor(const FLiveFeed& Feed, bool bStartAccepted, std::string_view BoundWorkflowRunId,
		const FVerdictRead& Read)
	{
		const ECheckerVerdict Verdict = Read.Verdict;
		const bool bHasCompletion = Read.bHasCompletion;
		FExecutionView Out;
		Out.Phase = bStartAccepted ? EExecutionPhase::Starting : EExecutionPhase::None;
		if (!Feed.HasRead()) { return Out; }
		const bool bSource = Feed.Source() == ELiveSource::GithubActions || Feed.Source() == ELiveSource::GithubActionsRecorded;
		const bool bBoundRun = !Feed.WorkflowRunId().empty() && (BoundWorkflowRunId.empty() || Feed.WorkflowRunId() == BoundWorkflowRunId);
		if (!bSource || Feed.Mode() != ELiveMode::Paid || !bBoundRun) { return Out; } // FLOW_EXEC_BIND_PAID_BOUND_RUN_ONLY
		Out.WorkflowRunId = Feed.WorkflowRunId();
		Out.bStale = Feed.IsStale();
		Out.bRecorded = Feed.Source() == ELiveSource::GithubActionsRecorded;
		const bool bExecutionSeen = Feed.LiveStepStarted() || Feed.TaskPhaseSeen();
		if (Feed.TaskPhaseSeen())
		{
			Out.Role = Feed.LastTaskPhase().Role;
			Out.TaskType = Feed.LastTaskPhase().TaskType;
			Out.RepairCycle = Feed.LastTaskPhase().RepairCycle;
		}
		if (Read.bOutcomeUnknown && bExecutionSeen)
		{
			// #478: a provider call's outcome is unknown; Julius stopped that step and did not retry it. Interrupt, never success.
			Out.Phase = EExecutionPhase::OutcomeUnknown; // FLOW_EXEC_OUTCOME_UNKNOWN_INTERRUPTS
			Out.Detail = Read.OutcomeUnknownCause;
			return Out;
		}
		if (Feed.LiveStepInterrupted())
		{
			// Reported immediately, even while the workflow is still running: never wait for the run to wrap up.
			Out.Phase = Feed.LiveStepConclusion() == "cancelled" ? EExecutionPhase::Cancelled : EExecutionPhase::Failed;
			Out.Detail = std::string(LiveJob) + " / " + LiveStep + " (" + Feed.LiveStepConclusion() + ")";
			return Out;
		}
		if (Feed.Run() == ELiveRunStatus::Completed)
		{
			if (!bExecutionSeen)
			{
				// Julius never ran: say which gate refused (or that it was cancelled), never "Julius failed".
				Out.Phase = EExecutionPhase::DidNotStart; // FLOW_EXEC_NO_LIVE_STEP_IS_DID_NOT_START
				Out.Detail = !Feed.FirstFailure().empty() ? Feed.FirstFailure() : Feed.RunConclusion();
				return Out;
			}
			if (Feed.RunConclusion() == "cancelled") { Out.Phase = EExecutionPhase::Cancelled; return Out; }
			if (!Feed.LiveStepSucceeded())
			{
				// Julius started but the run ended without LIVE success: interrupted, naming where it stopped.
				Out.Phase = EExecutionPhase::Failed; // FLOW_EXEC_ENDED_WITHOUT_LIVE_SUCCESS
				Out.Detail = !Feed.FirstFailure().empty() ? Feed.FirstFailure() : std::string(LiveJob) + " / " + LiveStep + " (did not complete)";
				return Out;
			}
			if (Verdict == ECheckerVerdict::Pass && bHasCompletion) { Out.Phase = EExecutionPhase::Completed; return Out; } // FLOW_EXEC_SUCCESS_ONLY_FROM_RESULT
			if (Verdict == ECheckerVerdict::Fail) { Out.Phase = EExecutionPhase::Failed; Out.Detail = "Checker: FAIL"; return Out; }
			// NO VERDICT YET IS NOT A FAILURE: /result trails the run's completion. A neutral wait until a read made after the
			// completion still says NOT_RUN and the grace has passed; only then unverified, treated as failed -- never success.
			Out.Phase = Read.bNoVerdictIsFinal ? EExecutionPhase::FailedUnverified : EExecutionPhase::Grading; // FLOW_EXEC_NO_VERDICT_YET_IS_GRADING
			return Out;
		}
		if (Feed.LiveStepSucceeded()) { Out.Phase = EExecutionPhase::Grading; return Out; }
		if (bExecutionSeen) { Out.Phase = EExecutionPhase::Executing; return Out; }
		Out.Phase = Feed.AttemptRecorded() ? EExecutionPhase::Committing : EExecutionPhase::Starting; // FLOW_EXEC_GATES_ARE_NOT_EXECUTION
		return Out;
	}

	std::vector<FContractBeat> FContractCursor::Advance(const FExecutionView& View)
	{
		std::vector<FContractBeat> Out;
		if (View.bStale || View.Phase == EExecutionPhase::None || bEnded) { return Out; } // FLOW_CONTRACT_STALE_MOVES_NOTHING
		switch (View.Phase)
		{
		case EExecutionPhase::Failed:
		case EExecutionPhase::FailedUnverified:
		case EExecutionPhase::DidNotStart:
		case EExecutionPhase::Cancelled:
			// Skywalker 2026-10-30: failed, did-not-start and interrupted play the failure ending, once.
			Out.push_back(FContractBeat{"run.failed", std::string(), 0}); // FLOW_CONTRACT_FAILURE_PLAYS_ENDING
			bEnded = true;
			return Out;
		case EExecutionPhase::OutcomeUnknown:
			// No success and no failure animation: the stage clears and the state is labelled (needs reconciliation).
			bReleased = true; // FLOW_CONTRACT_UNKNOWN_PLAYS_NO_ENDING
			bEnded = true;
			return Out;
		case EExecutionPhase::Starting:
		case EExecutionPhase::Committing:
			return Out; // FLOW_CONTRACT_NOTHING_BEFORE_EXECUTION
		default:
			break;
		}
		if (!bStarted)
		{
			Out.push_back(FContractBeat{"run.started", std::string(), 0});
			bStarted = true;
		}
		if (View.Phase == EExecutionPhase::Executing && !View.Role.empty())
		{
			const std::string Key = View.Role + "/" + View.TaskType + "/" + std::to_string(View.RepairCycle);
			if (Key != LastBeatKey)
			{
				LastBeatKey = Key;
				const bool bRepair = View.TaskType.rfind("repair_", 0) == 0;
				const std::int64_t Round = View.RepairCycle > 0 ? View.RepairCycle : 0;
				// ONLY WHAT JULIUS REPORTS (founder 2026-10-26: "only be shown if Julius ever reports that it's doing it"). The
				// publisher samples the one ACTIVE task (JUDEV, julius-live-progress.mjs); each beat below is keyed to a task
				// type Julius actually publishes, never to timing. WAITING / CHECKPOINT has no live signal in J1 (autonomous,
				// no approvals), so it is never emitted here.
				// A cursor that joins mid-round (a reconnect) never SAW the round open: it shows the round's current beat, not a
				// late REPAIR REQUIRED, and replays nothing that came before.
				const bool bRoundOpensHere = bRepair && !bInRepairRound && bSawTask;
				if (bRepair) { bInRepairRound = true; }
				bSawTask = true;
				if (bRoundOpensHere)
				{
					// The reviewer's decision is not published live; the first repair task after other work IS the proof the
					// work was sent back. REPAIR REQUIRED is shown on that sample, once per round.
					Out.push_back(FContractBeat{"review.repair_required", View.Role, Round}); // FLOW_CONTRACT_REPAIR_REQUIRED_ON_ROUND_START
				}
				else if (View.TaskType == "research") { Out.push_back(FContractBeat{"research.requested", View.Role, Round}); } // FLOW_CONTRACT_RESEARCH_ONLY_WHEN_REPORTED
				else if (View.TaskType == "repair_guidance") { Out.push_back(FContractBeat{"architect.guidance", View.Role, Round}); } // FLOW_CONTRACT_GUIDANCE_ONLY_WHEN_REPORTED
				// RepairCycle -1 is "not reported" (JSON null): never read as repaired work (REVIEW F1).
				else if (View.Role == "reviewer" && (View.TaskType == "repair_audit" || View.RepairCycle > 0)) // FLOW_CONTRACT_VERIFYING_NEEDS_A_REPORTED_CYCLE
				{
					// The Independent Reviewer checking repaired work: VERIFYING ("the repair is being checked against the contract").
					Out.push_back(FContractBeat{"repair.completed", View.Role, Round}); // FLOW_CONTRACT_VERIFYING_IS_REVIEWER_ON_REPAIR
				}
				else if (bRepair) { Out.push_back(FContractBeat{"repair.started", View.Role, Round}); }
				else if (View.Role == "reviewer") { Out.push_back(FContractBeat{"review.started", View.Role, Round}); }
				else if (View.Role == "coder") { Out.push_back(FContractBeat{"coder.started", View.Role, Round}); }
				else if (View.Role == "architect") { Out.push_back(FContractBeat{"architect.started", View.Role, Round}); }
				if (!bRepair) { bInRepairRound = false; } // a non-repair task closes the round; the next repair task opens a new one
			}
		}
		if (View.Phase == EExecutionPhase::Completed)
		{
			Out.push_back(FContractBeat{"run.completed", std::string(), 0}); // FLOW_CONTRACT_SUCCESS_ONLY_ON_COMPLETED
			bEnded = true;
		}
		return Out;
	}

	bool TaskRowMayPerform(bool bBoundToJuliusRun, bool bJuliusConfirmedThisSession)
	{
		return !bBoundToJuliusRun || bJuliusConfirmedThisSession; // FLOW_TASK_RESTORED_ROW_IS_INERT
	}

	bool AdoptingRunResetsToQueued(bool bRowHadRun, std::string_view RowRunId, std::string_view NewRunId)
	{
		return !bRowHadRun || RowRunId != NewRunId; // FLOW_TASK_NEW_RUN_STARTS_QUEUED
	}

	bool UnmappedReportMayApply(bool bRowConfirmedThisSession)
	{
		return bRowConfirmedThisSession; // FLOW_TASK_UNMAPPED_REPORT_NEVER_CONFIRMS
	}

	bool AdmissionEndsWithWorkflow(bool bRunCompletedSeen, EExecutionPhase Phase, bool bAwaitingVerdict)
	{
		const bool bTerminalNonSuccess = Phase == EExecutionPhase::Failed || Phase == EExecutionPhase::FailedUnverified
			|| Phase == EExecutionPhase::DidNotStart || Phase == EExecutionPhase::Cancelled || Phase == EExecutionPhase::OutcomeUnknown;
		return bRunCompletedSeen && bTerminalNonSuccess && !bAwaitingVerdict; // FLOW_ADMISSION_ENDS_WITH_WORKFLOW
	}

	bool KeepReadingResultAfterStop(bool bStoppedAfterExecution, bool bOutcomeUnknownSeen, bool bRunCompletedSeen,
		std::uint64_t MsSinceRunCompleted, std::uint64_t GraceMs)
	{
		return bStoppedAfterExecution && !bOutcomeUnknownSeen && (!bRunCompletedSeen || MsSinceRunCompleted < GraceMs); // FLOW_RESULT_READ_AFTER_STOP
	}

	bool ConnectionUncertain(bool bStale, bool bHasSession, bool bEverRead, std::uint64_t MsSinceLastGoodRead)
	{
		return bStale || !bHasSession || (bEverRead && MsSinceLastGoodRead > LiveNoReadAfterMs); // FLOW_CONTRACT_UNCERTAIN_SUSPENDS
	}

	const char* ContractTaskStateFor(const FExecutionView& View)
	{
		switch (View.Phase)
		{
		case EExecutionPhase::Starting:
		case EExecutionPhase::Committing: return "queued"; // not a performance: the Dog does not act before execution
		case EExecutionPhase::Executing:
			if (View.TaskType.rfind("repair_", 0) == 0) { return "repair"; }
			if (View.Role == "reviewer") { return "review"; }
			if (View.Role == "architect") { return "preparation"; }
			return "implementation";
		case EExecutionPhase::Grading: return "verification"; // FLOW_CONTRACT_GRADING_IS_VERIFICATION (never a blank beat)
		case EExecutionPhase::Completed: return "completed";
		case EExecutionPhase::OutcomeUnknown: return "waiting"; // FLOW_CONTRACT_UNKNOWN_IS_NEITHER
		case EExecutionPhase::Failed:
		case EExecutionPhase::FailedUnverified:
		case EExecutionPhase::DidNotStart: return "failed";
		case EExecutionPhase::Cancelled: return "cancelled";
		default: return "";
		}
	}

	EExecutionPhase SuccessGatedByStatus(EExecutionPhase Phase, const FMissionStatusRead* Status)
	{
		if (Phase != EExecutionPhase::Completed || Status == nullptr || !Status->bOk) { return Phase; }
		return StatusIsVerifiedSuccess(*Status) ? Phase : EExecutionPhase::Grading; // FLOW_SUCCESS_GATED_BY_STATUS
	}

	FStartGate RecordedReplayGate(const FStartGate& Gate, bool bRecordedReplay)
	{
		if (!bRecordedReplay) { return Gate; }
		FStartGate Out;
		Out.bOffer = false;
		Out.bSend = false; // FLOW_RECORDED_REPLAY_REFUSES_START
		Out.Why = RecordedReplayWhy;
		return Out;
	}

	namespace
	{
		std::string LogString(std::string_view Value)
		{
			std::string Out = "\"";
			for (const char C : Value)
			{
				const unsigned char U = static_cast<unsigned char>(C);
				if (C == '"' || C == '\\') { Out += '\\'; Out += C; } // FLOW_LOG_ESCAPES
				else if (U < 0x20) { static const char Hex[] = "0123456789abcdef"; Out += "\\u00"; Out += Hex[U >> 4]; Out += Hex[U & 15]; }
				else { Out += C; }
			}
			return Out + "\"";
		}
		std::string LogStringOrNull(std::string_view Value) { return Value.empty() ? std::string("null") : LogString(Value); }
		std::string LogIntOrNull(std::int64_t Value) { return Value < 0 ? std::string("null") : std::to_string(Value); } // FLOW_LOG_ABSENT_IS_NULL
		const char* LogBool(bool b) { return b ? "true" : "false"; }
	}

	std::string FormatStatusReadLog(std::string_view WljRunId, const FMissionStatusRead& Status)
	{
		std::string Out = "{\"event\":\"status_read\",\"wlj_run_id\":" + LogString(WljRunId);
		Out += ",\"http\":" + std::to_string(Status.HttpStatus);
		Out += ",\"ok\":"; Out += LogBool(Status.bOk);
		if (!Status.bOk) { return Out + ",\"why\":" + LogString(Status.Why) + "}"; }
		Out += ",\"phase\":" + LogStringOrNull(Status.PhaseWord);
		Out += ",\"terminal\":"; Out += LogBool(Status.bTerminal);
		Out += ",\"requested\":"; Out += LogBool(Status.bRequested);
		Out += ",\"request_state\":" + LogStringOrNull(Status.RequestState);
		Out += ",\"workflow_run_id\":" + LogStringOrNull(Status.WorkflowRunId);
		Out += ",\"progress_percent\":" + LogIntOrNull(Status.ProgressPercent);
		Out += ",\"checker_verdict\":" + LogStringOrNull(Status.CheckerVerdict);
		Out += ",\"outcome_unknown\":"; Out += LogBool(Status.bOutcomeUnknown);
		Out += ",\"verified_success\":"; Out += LogBool(StatusIsVerifiedSuccess(Status)); // FLOW_LOG_SUCCESS_IS_VERIFIED
		Out += ",\"next_poll_ms\":" + (Status.NextPollMs == 0 ? std::string("null") : std::to_string(Status.NextPollMs));
		Out += ",\"skipped_fields\":" + std::to_string(Status.Skipped.size());
		return Out + "}";
	}

	std::string FormatResyncLog(std::string_view WljRunId, std::string_view Why, std::size_t SkippedEvents, std::int64_t LastSeq)
	{
		return "{\"event\":\"resync\",\"wlj_run_id\":" + LogString(WljRunId) + ",\"reason\":" + LogStringOrNull(Why) // FLOW_LOG_RESYNC_REASON
			+ ",\"events_skipped\":" + std::to_string(SkippedEvents) + ",\"last_seq\":" + LogIntOrNull(LastSeq) + ",\"next\":\"status_read\"}";
	}

	std::string FormatBeatLog(std::string_view WljRunId, std::string_view BeatType, EExecutionPhase Phase, std::int64_t SourceSeq,
		const FMissionStatusRead* Status, bool bApplied, std::string_view StageLabel)
	{
		const bool bStatus = Status != nullptr && Status->bOk;
		std::string Out = "{\"event\":\"beat\",\"wlj_run_id\":" + LogString(WljRunId) + ",\"type\":" + LogString(BeatType);
		Out += ",\"phase\":" + LogString(ExecutionPhaseWord(Phase));
		Out += ",\"source_seq\":" + LogIntOrNull(SourceSeq); // FLOW_LOG_BEAT_CARRIES_SEQ
		Out += ",\"status_phase\":" + (bStatus ? LogStringOrNull(Status->PhaseWord) : std::string("null"));
		Out += ",\"verified_success\":"; Out += LogBool(bStatus && StatusIsVerifiedSuccess(*Status));
		Out += ",\"applied\":"; Out += LogBool(bApplied);
		return Out + ",\"stage\":" + LogStringOrNull(StageLabel) + "}";
	}
}

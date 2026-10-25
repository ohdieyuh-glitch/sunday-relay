#include "WonderlandJuliusMissionFlow.h"

#include <cctype>
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
			explicit FJsonParser(std::string_view In)
				: Text(In)
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
				if (Nodes >= JsonNodeLimit) { Fail(); return false; }
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
					if (Out.Array.size() > 64) { Fail(); return false; }
					Skip();
					if (Index < Text.size() && Text[Index] == ',') { ++Index; continue; }
					return Consume(']');
				}
				return false;
			}
		};

		bool ParseJson(std::string_view Text, FJson& Out)
		{
			FJsonParser Parser(Text);
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
		};
		Out.Cause = ReadString(&Root, "cause");
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
}

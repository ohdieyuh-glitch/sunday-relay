// WONDERLAND -- companion pure logic. See WonderlandCompanionLogic.h for the contract and the rules.
#include "WonderlandCompanionLogic.h"

#include "WonderlandJuliusMissionLogic.h"
#include "WonderlandJuliusMissionProgress.h"

#include <algorithm>

namespace WonderlandCompanionLogic
{
	namespace
	{
		// Strict UTF-8 decode of one code point at Text[Pos]. Returns its length (1-4) or 0 when malformed.
		std::size_t DecodeUtf8(std::string_view Text, std::size_t Pos, char32_t& Out)
		{
			const auto Byte = [&](std::size_t I) { return static_cast<unsigned char>(Text[I]); };
			const unsigned char B0 = Byte(Pos);
			if (B0 < 0x80)
			{
				Out = B0;
				return 1;
			}
			std::size_t Len = 0;
			char32_t Min = 0;
			if (B0 >= 0xC2 && B0 <= 0xDF) { Len = 2; Out = B0 & 0x1Fu; Min = 0x80; }
			else if (B0 >= 0xE0 && B0 <= 0xEF) { Len = 3; Out = B0 & 0x0Fu; Min = 0x800; }
			else if (B0 >= 0xF0 && B0 <= 0xF4) { Len = 4; Out = B0 & 0x07u; Min = 0x10000; }
			else { return 0; }
			if (Pos + Len > Text.size())
			{
				return 0;
			}
			for (std::size_t I = 1; I < Len; ++I)
			{
				const unsigned char B = Byte(Pos + I);
				if ((B & 0xC0u) != 0x80u)
				{
					return 0;
				}
				Out = (Out << 6) | (B & 0x3Fu);
			}
			if (Out < Min || Out > 0x10FFFF || (Out >= 0xD800 && Out <= 0xDFFF))
			{
				return 0;
			}
			return Len;
		}

		void AppendUtf8(std::string& Out, char32_t Cp)
		{
			if (Cp < 0x80) { Out.push_back(static_cast<char>(Cp)); }
			else if (Cp < 0x800)
			{
				Out.push_back(static_cast<char>(0xC0 | (Cp >> 6)));
				Out.push_back(static_cast<char>(0x80 | (Cp & 0x3F)));
			}
			else if (Cp < 0x10000)
			{
				// Also used for a lone surrogate (WTF-8): ED A0..BF xx.
				Out.push_back(static_cast<char>(0xE0 | (Cp >> 12)));
				Out.push_back(static_cast<char>(0x80 | ((Cp >> 6) & 0x3F)));
				Out.push_back(static_cast<char>(0x80 | (Cp & 0x3F)));
			}
			else
			{
				Out.push_back(static_cast<char>(0xF0 | (Cp >> 18)));
				Out.push_back(static_cast<char>(0x80 | ((Cp >> 12) & 0x3F)));
				Out.push_back(static_cast<char>(0x80 | ((Cp >> 6) & 0x3F)));
				Out.push_back(static_cast<char>(0x80 | (Cp & 0x3F)));
			}
		}

		// A WTF-8 encoded surrogate code unit at Pos (ED A0..BF 80..BF). Returns true and the unit.
		bool DecodeWtf8Surrogate(std::string_view Text, std::size_t Pos, char32_t& Out)
		{
			if (Pos + 3 > Text.size())
			{
				return false;
			}
			const unsigned char B0 = static_cast<unsigned char>(Text[Pos]);
			const unsigned char B1 = static_cast<unsigned char>(Text[Pos + 1]);
			const unsigned char B2 = static_cast<unsigned char>(Text[Pos + 2]);
			if (B0 != 0xED || B1 < 0xA0 || B1 > 0xBF || (B2 & 0xC0u) != 0x80u)
			{
				return false;
			}
			Out = 0xD000u | (static_cast<char32_t>(B1 & 0x3Fu) << 6) | (B2 & 0x3Fu);
			return true;
		}

		int HexValue(char C)
		{
			if (C >= '0' && C <= '9') { return C - '0'; }
			if (C >= 'a' && C <= 'f') { return C - 'a' + 10; }
			if (C >= 'A' && C <= 'F') { return C - 'A' + 10; }
			return -1;
		}

		class FJsonReader
		{
		public:
			explicit FJsonReader(std::string_view InText) : Text(InText) {}

			bool Document(FJsonValue& Out)
			{
				SkipSpace();
				if (!Value(Out, 0))
				{
					return false;
				}
				SkipSpace();
				return Pos == Text.size();
			}

		private:
			void SkipSpace()
			{
				while (Pos < Text.size() && (Text[Pos] == ' ' || Text[Pos] == '\t' || Text[Pos] == '\n' || Text[Pos] == '\r'))
				{
					++Pos;
				}
			}

			bool Literal(std::string_view Word)
			{
				if (Text.substr(Pos, Word.size()) != Word)
				{
					return false;
				}
				Pos += Word.size();
				return true;
			}

			bool Value(FJsonValue& Out, std::size_t Depth)
			{
				if (Pos >= Text.size())
				{
					return false;
				}
				const char C = Text[Pos];
				if (C == '{') { return Object(Out, Depth + 1); }
				if (C == '[') { return Array(Out, Depth + 1); }
				if (C == '"') { Out.Kind = FJsonValue::EKind::String; return String(Out.Text); }
				if (C == 't') { Out.Kind = FJsonValue::EKind::Bool; Out.bBool = true; return Literal("true"); }
				if (C == 'f') { Out.Kind = FJsonValue::EKind::Bool; Out.bBool = false; return Literal("false"); }
				if (C == 'n') { Out.Kind = FJsonValue::EKind::Null; return Literal("null"); }
				return Number(Out);
			}

			bool Number(FJsonValue& Out)
			{
				const std::size_t Start = Pos;
				const auto Digit = [&]() { return Pos < Text.size() && Text[Pos] >= '0' && Text[Pos] <= '9'; };
				if (Pos < Text.size() && Text[Pos] == '-') { ++Pos; }
				if (!Digit()) { return false; }
				if (Text[Pos] == '0') { ++Pos; }
				else { while (Digit()) { ++Pos; } }
				if (Pos < Text.size() && Text[Pos] == '.')
				{
					++Pos;
					if (!Digit()) { return false; }
					while (Digit()) { ++Pos; }
				}
				if (Pos < Text.size() && (Text[Pos] == 'e' || Text[Pos] == 'E'))
				{
					++Pos;
					if (Pos < Text.size() && (Text[Pos] == '+' || Text[Pos] == '-')) { ++Pos; }
					if (!Digit()) { return false; }
					while (Digit()) { ++Pos; }
				}
				Out.Kind = FJsonValue::EKind::Number;
				Out.Text.assign(Text.substr(Start, Pos - Start));
				return true;
			}

			bool Hex4(char32_t& Out)
			{
				if (Pos + 4 > Text.size()) { return false; }
				Out = 0;
				for (int I = 0; I < 4; ++I)
				{
					const int H = HexValue(Text[Pos + static_cast<std::size_t>(I)]);
					if (H < 0) { return false; }
					Out = (Out << 4) | static_cast<char32_t>(H);
				}
				Pos += 4;
				return true;
			}

			bool String(std::string& Out)
			{
				++Pos; // opening quote
				Out.clear();
				while (Pos < Text.size())
				{
					const unsigned char C = static_cast<unsigned char>(Text[Pos]);
					if (C == '"') { ++Pos; return true; }
					if (C < 0x20) { return false; }
					if (C != '\\')
					{
						char32_t Cp = 0;
						const std::size_t Len = DecodeUtf8(Text, Pos, Cp);
						if (Len == 0) { return false; }
						Out.append(Text.substr(Pos, Len));
						Pos += Len;
						continue;
					}
					++Pos;
					if (Pos >= Text.size()) { return false; }
					const char E = Text[Pos++];
					switch (E)
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
						char32_t Unit = 0;
						if (!Hex4(Unit)) { return false; }
						if (Unit >= 0xD800 && Unit <= 0xDBFF && Text.substr(Pos, 2) == "\\u")
						{
							const std::size_t Save = Pos;
							Pos += 2;
							char32_t Low = 0;
							if (Hex4(Low) && Low >= 0xDC00 && Low <= 0xDFFF)
							{
								AppendUtf8(Out, 0x10000 + ((Unit - 0xD800) << 10) + (Low - 0xDC00));
								break;
							}
							Pos = Save;
						}
						AppendUtf8(Out, Unit); // a lone surrogate stays WTF-8; SanitizeUntrustedText settles it
						break;
					}
					default: return false;
					}
				}
				return false;
			}

			bool Array(FJsonValue& Out, std::size_t Depth)
			{
				if (Depth > JsonMaxDepth) { return false; }
				Out.Kind = FJsonValue::EKind::Array;
				++Pos;
				SkipSpace();
				if (Pos < Text.size() && Text[Pos] == ']') { ++Pos; return true; }
				for (;;)
				{
					Out.Items.emplace_back();
					SkipSpace();
					if (!Value(Out.Items.back(), Depth)) { return false; }
					SkipSpace();
					if (Pos >= Text.size()) { return false; }
					if (Text[Pos] == ',') { ++Pos; continue; }
					if (Text[Pos] == ']') { ++Pos; return true; }
					return false;
				}
			}

			bool Object(FJsonValue& Out, std::size_t Depth)
			{
				if (Depth > JsonMaxDepth) { return false; }
				Out.Kind = FJsonValue::EKind::Object;
				++Pos;
				SkipSpace();
				if (Pos < Text.size() && Text[Pos] == '}') { ++Pos; return true; }
				for (;;)
				{
					SkipSpace();
					if (Pos >= Text.size() || Text[Pos] != '"') { return false; }
					std::string Key;
					if (!String(Key)) { return false; }
					if (Out.Find(Key) != nullptr) { return false; } // duplicate keys are ambiguous: refused
					SkipSpace();
					if (Pos >= Text.size() || Text[Pos] != ':') { return false; }
					++Pos;
					SkipSpace();
					Out.Members.emplace_back(std::move(Key), FJsonValue());
					if (!Value(Out.Members.back().second, Depth)) { return false; }
					SkipSpace();
					if (Pos >= Text.size()) { return false; }
					if (Text[Pos] == ',') { ++Pos; continue; }
					if (Text[Pos] == '}') { ++Pos; return true; }
					return false;
				}
			}

			std::string_view Text;
			std::size_t Pos = 0;
		};

		bool IsPrintableAscii(std::string_view Text, std::size_t MinLen, std::size_t MaxLen)
		{
			if (Text.size() < MinLen || Text.size() > MaxLen) { return false; }
			for (const char C : Text)
			{
				if (C < 0x20 || C > 0x7E) { return false; }
			}
			return true;
		}

		bool IsSnakeKind(std::string_view Text)
		{
			if (Text.empty() || Text.size() > 64) { return false; }
			for (const char C : Text)
			{
				if (!((C >= 'a' && C <= 'z') || (C >= '0' && C <= '9') || C == '_')) { return false; }
			}
			return true;
		}

		bool HasPrefixedUuid(std::string_view Text, std::string_view Prefix)
		{
			return Text.size() > Prefix.size() && Text.substr(0, Prefix.size()) == Prefix
				&& WonderlandJuliusMissionLogic::IsCanonicalUuidV4(Text.substr(Prefix.size()));
		}

		const FJsonValue* FindString(const FJsonValue& Object, std::string_view Key)
		{
			const FJsonValue* Value = Object.Find(Key);
			return (Value != nullptr && Value->IsString()) ? Value : nullptr;
		}

		void SecureZero(char* Data, std::size_t Size)
		{
			volatile char* Bytes = Data;
			for (std::size_t I = 0; I < Size; ++I) { Bytes[I] = 0; }
		}

		std::size_t Utf16Units(std::string_view Utf8)
		{
			std::size_t Units = 0;
			for (std::size_t Pos = 0; Pos < Utf8.size();)
			{
				char32_t Cp = 0;
				const std::size_t Len = DecodeUtf8(Utf8, Pos, Cp);
				if (Len == 0) { return static_cast<std::size_t>(-1); }
				Units += Cp >= 0x10000 ? 2 : 1;
				Pos += Len;
			}
			return Units;
		}

		// {"error":{"kind":"...","message":"..."}} -> kind, or empty.
		std::string ErrorKindOf(std::string_view Body)
		{
			FJsonValue Root;
			if (Body.size() > ListMaxBodyBytes || !ParseJson(Body, Root) || !Root.IsObject()) { return std::string(); }
			const FJsonValue* Error = Root.Find("error");
			if (Error == nullptr || !Error->IsObject()) { return std::string(); }
			const FJsonValue* Kind = FindString(*Error, "kind");
			return (Kind != nullptr && IsSnakeKind(Kind->Text)) ? Kind->Text : std::string();
		}

		bool ParseRetryAfterSeconds(std::string_view Header, std::uint64_t& OutMs)
		{
			// Q8: integer delta-seconds >= 1 only (no HTTP date, no 0, no leading zero), <= 999999 s.
			if (Header.empty() || Header.size() > 6 || Header[0] == '0') { return false; }
			std::uint64_t Seconds = 0;
			for (const char C : Header)
			{
				if (C < '0' || C > '9') { return false; }
				Seconds = Seconds * 10 + static_cast<std::uint64_t>(C - '0');
			}
			OutMs = Seconds * 1000;
			return true;
		}
	}

	/* ---------------------------------------------------------------- JSON */

	const FJsonValue* FJsonValue::Find(std::string_view Key) const
	{
		for (const auto& Member : Members)
		{
			if (Member.first == Key) { return &Member.second; }
		}
		return nullptr;
	}

	bool ParseJson(std::string_view Utf8, FJsonValue& Out)
	{
		Out = FJsonValue();
		FJsonReader Reader(Utf8);
		return Reader.Document(Out);
	}

	bool JsonToSafeUnsigned(const FJsonValue& Value, std::uint64_t& Out)
	{
		if (Value.Kind != FJsonValue::EKind::Number || Value.Text.empty() || Value.Text.size() > 16) { return false; }
		std::uint64_t N = 0;
		for (const char C : Value.Text)
		{
			if (C < '0' || C > '9') { return false; }
			N = N * 10 + static_cast<std::uint64_t>(C - '0');
		}
		if (N > 9007199254740991ull) { return false; }
		Out = N;
		return true;
	}

	void AppendJsonString(std::string& Out, std::string_view Text)
	{
		static const char Hex[] = "0123456789abcdef";
		Out.push_back('"');
		for (const char C : Text)
		{
			const unsigned char U = static_cast<unsigned char>(C);
			if (C == '"') { Out += "\\\""; }
			else if (C == '\\') { Out += "\\\\"; }
			else if (U < 0x20)
			{
				Out += "\\u00";
				Out.push_back(Hex[U >> 4]);
				Out.push_back(Hex[U & 0xF]);
			}
			else { Out.push_back(C); }
		}
		Out.push_back('"');
	}

	bool IsValidUtf8(std::string_view Text)
	{
		for (std::size_t Pos = 0; Pos < Text.size();)
		{
			char32_t Cp = 0;
			const std::size_t Len = DecodeUtf8(Text, Pos, Cp);
			if (Len == 0) { return false; }
			Pos += Len;
		}
		return true;
	}

	std::string SanitizeUntrustedText(std::string_view Text)
	{
		std::string Out;
		Out.reserve(Text.size());
		for (std::size_t Pos = 0; Pos < Text.size();)
		{
			char32_t Cp = 0;
			char32_t Unit = 0;
			std::size_t Len = 0;
			if (DecodeWtf8Surrogate(Text, Pos, Unit))
			{
				char32_t Low = 0;
				if (Unit <= 0xDBFF && DecodeWtf8Surrogate(Text, Pos + 3, Low) && Low >= 0xDC00)
				{
					Cp = 0x10000 + ((Unit - 0xD800) << 10) + (Low - 0xDC00);
					Len = 6;
				}
				else
				{
					Cp = 0xFFFD;
					Len = 3;
				}
			}
			else
			{
				Len = DecodeUtf8(Text, Pos, Cp);
				if (Len == 0)
				{
					Cp = 0xFFFD;
					Len = 1;
				}
			}
			Pos += Len;
			if (Cp == '\r')
			{
				if (Pos < Text.size() && Text[Pos] == '\n') { continue; }
				Cp = '\n';
			}
			const bool bDrop = (Cp < 0x20 && Cp != '\n' && Cp != '\t') || (Cp >= 0x7F && Cp <= 0x9F)
				|| (Cp >= 0x202A && Cp <= 0x202E) || (Cp >= 0x2066 && Cp <= 0x2069);
			if (!bDrop) { AppendUtf8(Out, Cp); }
		}
		return Out;
	}

	/* ---------------------------------------------------------------- SSE */

	FSseParser::FSseParser(std::size_t InMaxLineBytes, std::size_t InMaxEventDataBytes)
		: MaxLineBytes(InMaxLineBytes), MaxEventDataBytes(InMaxEventDataBytes)
	{
	}

	bool FSseParser::Feed(std::string_view Chunk, std::vector<FSseEvent>& Out)
	{
		for (const char Byte : Chunk)
		{
			if (Failed()) { return false; }
			if (!bBomResolved)
			{
				// A UTF-8 BOM is dropped only at the very start of the stream, even when split across chunks.
				static constexpr char Bom[] = {'\xEF', '\xBB', '\xBF'};
				if (Byte == Bom[BomPending.size()])
				{
					BomPending.push_back(Byte);
					if (BomPending.size() == 3)
					{
						BomPending.clear();
						bBomResolved = true;
					}
					continue;
				}
				bBomResolved = true;
				const std::string Held = BomPending;
				BomPending.clear();
				for (const char HeldByte : Held) { FeedByte(HeldByte, Out); }
				if (Failed()) { return false; }
			}
			FeedByte(Byte, Out);
		}
		return !Failed();
	}

	void FSseParser::FeedByte(char Byte, std::vector<FSseEvent>& Out)
	{
		if (Byte == '\n' && bAfterCr)
		{
			bAfterCr = false; // the LF of a CRLF, even when the CR ended the previous chunk
			return;
		}
		bAfterCr = false;
		if (Byte == '\r' || Byte == '\n')
		{
			bAfterCr = Byte == '\r';
			ProcessLine(Out);
			Line.clear();
			return;
		}
		if (Line.size() >= MaxLineBytes)
		{
			Fault = ESseFault::LineTooLong;
			return;
		}
		Line.push_back(Byte);
	}

	void FSseParser::ProcessLine(std::vector<FSseEvent>& Out)
	{
		if (Line.empty())
		{
			Dispatch(Out);
			return;
		}
		if (Line[0] == ':')
		{
			++Comments;
			return;
		}
		const std::size_t Colon = Line.find(':');
		const std::string_view Whole(Line);
		const std::string_view Field = Colon == std::string::npos ? Whole : Whole.substr(0, Colon);
		std::string_view Value = Colon == std::string::npos ? std::string_view() : Whole.substr(Colon + 1);
		if (!Value.empty() && Value[0] == ' ') { Value.remove_prefix(1); }
		if (Field == "event")
		{
			EventType.assign(Value);
		}
		else if (Field == "data")
		{
			if (Data.size() + Value.size() + 1 > MaxEventDataBytes)
			{
				Fault = ESseFault::EventTooLarge;
				return;
			}
			Data.append(Value);
			Data.push_back('\n');
			bHaveDataField = true;
		}
		else if (Field == "id")
		{
			++IdFields;
			bIdOrRetryInEvent = true; // Q2: never sent on the v0.1 chat stream; the decoder faults on it
			if (Value.find('\0') == std::string_view::npos) { LastId.assign(Value); }
		}
		else if (Field == "retry")
		{
			++RetryFields;
			bIdOrRetryInEvent = true; // Q2; the client never reconnects on its own either way
		}
		// Unknown fields are ignored (WHATWG).
	}

	void FSseParser::Dispatch(std::vector<FSseEvent>& Out)
	{
		if (!bHaveDataField)
		{
			EventType.clear();
			return; // an id/retry-only block stays flagged until the next event; FChatStreamDecoder::Feed checks the counts
		}
		FSseEvent Event;
		Event.Event = EventType.empty() ? std::string("message") : EventType;
		Event.Data = Data;
		Event.Data.pop_back(); // the final LF
		Event.LastEventId = LastId;
		Event.bHadIdOrRetry = bIdOrRetryInEvent;
		bIdOrRetryInEvent = false;
		Out.push_back(std::move(Event));
		Data.clear();
		EventType.clear();
		bHaveDataField = false;
	}

	bool FSseParser::FinishHadPartialEvent()
	{
		const bool bPartial = bHaveDataField || !Line.empty();
		Data.clear();
		EventType.clear();
		Line.clear();
		bHaveDataField = false;
		return bPartial;
	}

	/* ---------------------------------------------------------------- chat stream */

	const char* ChatProtocolFaultName(EChatProtocolFault Fault)
	{
		switch (Fault)
		{
		case EChatProtocolFault::None: return "none";
		case EChatProtocolFault::SseLineTooLong: return "sse_line_too_long";
		case EChatProtocolFault::SseEventTooLarge: return "sse_event_too_large";
		case EChatProtocolFault::BadJson: return "bad_json";
		case EChatProtocolFault::UnknownEvent: return "unknown_event";
		case EChatProtocolFault::MetaMissing: return "meta_missing";
		case EChatProtocolFault::MetaDuplicate: return "meta_duplicate";
		case EChatProtocolFault::MetaWrongProvider: return "meta_wrong_provider";
		case EChatProtocolFault::MetaWrongMode: return "meta_wrong_mode";
		case EChatProtocolFault::MetaBadConversationId: return "meta_bad_conversation_id";
		case EChatProtocolFault::ConversationMismatch: return "conversation_mismatch";
		case EChatProtocolFault::MetaBadMessageId: return "meta_bad_message_id";
		case EChatProtocolFault::MetaBadModel: return "meta_bad_model";
		case EChatProtocolFault::MetaBadSimulated: return "meta_bad_simulated";
		case EChatProtocolFault::MetaSimulatedTrue: return "meta_simulated_true";
		case EChatProtocolFault::MetaBadReplayed: return "meta_bad_replayed";
		case EChatProtocolFault::ReplayMessageMismatch: return "replay_message_mismatch";
		case EChatProtocolFault::ReplaySequence: return "replay_sequence";
		case EChatProtocolFault::ForbiddenSseField: return "forbidden_sse_field";
		case EChatProtocolFault::DeltaBadText: return "delta_bad_text";
		case EChatProtocolFault::ReplyTooLarge: return "reply_too_large";
		case EChatProtocolFault::DoneBadFields: return "done_bad_fields";
		case EChatProtocolFault::DoneMessageMismatch: return "done_message_mismatch";
		case EChatProtocolFault::ErrorBadFields: return "error_bad_fields";
		case EChatProtocolFault::Truncated: return "truncated";
		}
		return "?";
	}

	EChatErrorKind ClassifyChatErrorKind(std::string_view Kind)
	{
		if (Kind == "provider_auth_failed") { return EChatErrorKind::ProviderAuthFailed; }
		if (Kind == "provider_quota_exhausted") { return EChatErrorKind::ProviderQuotaExhausted; }
		if (Kind == "provider_rate_limited") { return EChatErrorKind::ProviderRateLimited; }
		if (Kind == "provider_unavailable") { return EChatErrorKind::ProviderUnavailable; }
		if (Kind == "provider_refused") { return EChatErrorKind::ProviderRefused; }
		if (Kind == "companion_internal") { return EChatErrorKind::CompanionInternal; }
		return EChatErrorKind::Unknown;
	}

	bool IsConversationId(std::string_view Text) { return HasPrefixedUuid(Text, "cnv_"); }
	bool IsCompanionTaskId(std::string_view Text) { return HasPrefixedUuid(Text, "cmp_"); }
	bool IsMessageId(std::string_view Text) { return HasPrefixedUuid(Text, "msg_"); }

	FChatStreamDecoder::FChatStreamDecoder(std::string ExpectedConversationId, bool bReplayResend, std::string ExpectedMessageId)
		: ExpectedConv(std::move(ExpectedConversationId)), bReplay(bReplayResend), ExpectedMsg(std::move(ExpectedMessageId))
	{
		ConvId = ExpectedConv;
	}

	void FChatStreamDecoder::Fail(EChatProtocolFault Why)
	{
		State = EChatStreamOutcome::ProtocolError;
		ProtocolFault = Why;
		Reply.clear(); // a broken stream is never shown as if it were a reply
	}

	EChatStreamOutcome FChatStreamDecoder::Feed(std::string_view Chunk)
	{
		std::vector<FSseEvent> Events;
		const bool bOk = Sse.Feed(Chunk, Events);
		for (const FSseEvent& Event : Events) { OnEvent(Event); }
		if (State == EChatStreamOutcome::Open && (Sse.IdFieldCount() != 0 || Sse.RetryFieldCount() != 0))
		{
			Fail(EChatProtocolFault::ForbiddenSseField); // Q2, also when the field's block never became an event
		}
		if (!bOk && State == EChatStreamOutcome::Open)
		{
			Fail(Sse.GetFault() == ESseFault::LineTooLong ? EChatProtocolFault::SseLineTooLong : EChatProtocolFault::SseEventTooLarge);
		}
		return State;
	}

	EChatStreamOutcome FChatStreamDecoder::Finish()
	{
		Sse.FinishHadPartialEvent();
		if (State == EChatStreamOutcome::Open) { Fail(EChatProtocolFault::Truncated); }
		return State;
	}

	std::string FChatStreamDecoder::ReplyForDisplay() const
	{
		if (State != EChatStreamOutcome::Open && State != EChatStreamOutcome::Done) { return std::string(); }
		return SanitizeUntrustedText(Reply);
	}

	void FChatStreamDecoder::OnEvent(const FSseEvent& Event)
	{
		if (State != EChatStreamOutcome::Open)
		{
			++Ignored; // terminals are sticky
			return;
		}
		if (Event.bHadIdOrRetry) { Fail(EChatProtocolFault::ForbiddenSseField); return; } // Q2
		FJsonValue Root;
		if (!ParseJson(Event.Data, Root) || !Root.IsObject())
		{
			Fail(EChatProtocolFault::BadJson);
			return;
		}
		if (Event.Event == "meta")
		{
			if (bHaveMeta) { Fail(EChatProtocolFault::MetaDuplicate); return; }
			const FJsonValue* Provider = FindString(Root, "provider");
			const FJsonValue* Mode = FindString(Root, "mode");
			const FJsonValue* Conv = FindString(Root, "conversationId");
			const FJsonValue* Msg = FindString(Root, "messageId");
			const FJsonValue* Model = FindString(Root, "model");
			const FJsonValue* Simulated = Root.Find("simulated");
			const FJsonValue* Replayed = Root.Find("replayed");
			if (Provider == nullptr || Provider->Text != "openai") { Fail(EChatProtocolFault::MetaWrongProvider); return; }
			if (Mode == nullptr || Mode->Text != "api_key") { Fail(EChatProtocolFault::MetaWrongMode); return; }
			if (Conv == nullptr || !IsConversationId(Conv->Text)) { Fail(EChatProtocolFault::MetaBadConversationId); return; }
			if (!ExpectedConv.empty() && Conv->Text != ExpectedConv) { Fail(EChatProtocolFault::ConversationMismatch); return; }
			if (Msg == nullptr || !IsMessageId(Msg->Text)) { Fail(EChatProtocolFault::MetaBadMessageId); return; } // Q1
			if (Model == nullptr || !IsPrintableAscii(Model->Text, 1, 128)) { Fail(EChatProtocolFault::MetaBadModel); return; }
			if (Simulated != nullptr && Simulated->Kind != FJsonValue::EKind::Bool) { Fail(EChatProtocolFault::MetaBadSimulated); return; }
			if (Simulated != nullptr && Simulated->bBool) { Fail(EChatProtocolFault::MetaSimulatedTrue); return; } // Q11
			if (Replayed != nullptr && Replayed->Kind != FJsonValue::EKind::Bool) { Fail(EChatProtocolFault::MetaBadReplayed); return; }
			const bool bMetaReplayed = Replayed != nullptr && Replayed->bBool;
			if (bMetaReplayed && !bReplay) { Fail(EChatProtocolFault::MetaBadReplayed); return; } // Q3: a fresh key has nothing to replay
			if (!ExpectedMsg.empty() && Msg->Text != ExpectedMsg) { Fail(EChatProtocolFault::ReplayMessageMismatch); return; } // Q1
			bHaveMeta = true;
			bReplayed = bMetaReplayed;
			ConvId = Conv->Text;
			MsgId = Msg->Text;
			ModelName = Model->Text;
			return;
		}
		if (!bHaveMeta) { Fail(EChatProtocolFault::MetaMissing); return; } // Q3: meta is first on every stream, replays included
		if (Event.Event == "delta")
		{
			if (bReplayed && Deltas != 0) { Fail(EChatProtocolFault::ReplaySequence); return; } // Q3: one stored delta
			const FJsonValue* Text = FindString(Root, "text");
			if (Text == nullptr) { Fail(EChatProtocolFault::DeltaBadText); return; }
			if (Reply.size() + Text->Text.size() > ChatMaxReplyBytes) { Fail(EChatProtocolFault::ReplyTooLarge); return; }
			Reply += Text->Text;
			++Deltas;
			return;
		}
		if (Event.Event == "done")
		{
			if (bReplayed && Deltas != 1) { Fail(EChatProtocolFault::ReplaySequence); return; } // Q3: meta, delta, done
			const FJsonValue* Msg = FindString(Root, "messageId");
			const FJsonValue* Reason = FindString(Root, "finishReason");
			const FJsonValue* Usage = Root.Find("usage");
			if (Msg == nullptr || !IsMessageId(Msg->Text) || Reason == nullptr || !IsPrintableAscii(Reason->Text, 1, 64)
				|| Usage == nullptr || !Usage->IsObject())
			{
				Fail(EChatProtocolFault::DoneBadFields);
				return;
			}
			const FJsonValue* In = Usage->Find("inputTokens");
			const FJsonValue* OutTok = Usage->Find("outputTokens");
			std::uint64_t InN = 0;
			std::uint64_t OutN = 0;
			if (In == nullptr || OutTok == nullptr || !JsonToSafeUnsigned(*In, InN) || !JsonToSafeUnsigned(*OutTok, OutN))
			{
				Fail(EChatProtocolFault::DoneBadFields);
				return;
			}
			if (Msg->Text != MsgId) { Fail(EChatProtocolFault::DoneMessageMismatch); return; } // Q1
			Finish_ = Reason->Text;
			InTokens = InN;
			OutTokens = OutN;
			State = EChatStreamOutcome::Done;
			return;
		}
		if (Event.Event == "error")
		{
			if (bReplayed && Deltas != 0) { Fail(EChatProtocolFault::ReplaySequence); return; } // Q3: meta, error
			const FJsonValue* Kind = FindString(Root, "kind");
			const FJsonValue* Message = FindString(Root, "message");
			const FJsonValue* Retry = Root.Find("retryAfterMs");
			std::uint64_t RetryMs = 0;
			if (Kind == nullptr || !IsSnakeKind(Kind->Text) || Message == nullptr || Message->Text.size() > ErrorMessageMaxBytes
				|| (Retry != nullptr && !JsonToSafeUnsigned(*Retry, RetryMs))) // Q8: integer >= 0 or absent; null is a fault
			{
				Fail(EChatProtocolFault::ErrorBadFields);
				return;
			}
			ErrKind = ClassifyChatErrorKind(Kind->Text);
			ErrMessage = SanitizeUntrustedText(Message->Text);
			bHasRetryAfter = Retry != nullptr;
			RetryAfter = RetryMs;
			Reply.clear();
			State = EChatStreamOutcome::ProviderError;
			return;
		}
		Fail(EChatProtocolFault::UnknownEvent); // Q2: the contract's event set is closed
	}

	/* ---------------------------------------------------------------- key field and handoff */

	bool IsLoopbackRelayOrigin(std::string_view Origin)
	{
		std::string_view Rest;
		if (Origin.substr(0, 17) == "http://127.0.0.1:") { Rest = Origin.substr(17); }
		else if (Origin.substr(0, 13) == "http://[::1]:") { Rest = Origin.substr(13); }
		else { return false; }
		if (Rest.empty() || Rest.size() > 5 || Rest[0] == '0') { return false; }
		std::uint32_t Port = 0;
		for (const char C : Rest)
		{
			if (C < '0' || C > '9') { return false; }
			Port = Port * 10 + static_cast<std::uint32_t>(C - '0');
		}
		return Port >= 1 && Port <= 65535;
	}

	std::string RelayOriginFromJ1Endpoint(std::string_view J1BaseUrl)
	{
		std::string_view Origin = J1BaseUrl;
		if (!Origin.empty() && Origin.back() == '/') { Origin.remove_suffix(1); }
		return IsLoopbackRelayOrigin(Origin) ? std::string(Origin) : std::string();
	}

	FMaskedKeyField::FMaskedKeyField() { SecureZero(Buffer, sizeof(Buffer)); }
	FMaskedKeyField::~FMaskedKeyField() { Wipe(); }

	void FMaskedKeyField::Append(std::string_view Typed)
	{
		for (const char C : Typed)
		{
			if (Length >= ApiKeyMaxBytes)
			{
				bOverlong = true;
				return;
			}
			Buffer[Length++] = C;
		}
	}

	void FMaskedKeyField::Backspace()
	{
		if (Length > 0) { Buffer[--Length] = 0; }
	}

	void FMaskedKeyField::Clear() { Wipe(); }

	std::string_view FMaskedKeyField::MaskText() const
	{
		// Eight U+2022 bullets, whatever was typed: no length, no prefix, no last four.
		static constexpr std::string_view Mask = "\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2";
		return Length == 0 ? std::string_view() : Mask;
	}

	void FMaskedKeyField::Wipe()
	{
		SecureZero(Buffer, sizeof(Buffer));
		Length = 0;
		bOverlong = false;
	}

	FKeyHandoff::~FKeyHandoff() { Wipe(); }

	FKeyHandoff::FKeyHandoff(FKeyHandoff&& Other) noexcept
		: MethodName(std::move(Other.MethodName)), Url(std::move(Other.Url)), IdemKey(std::move(Other.IdemKey)),
		  BodyBytes(std::move(Other.BodyBytes))
	{
		Other.Wipe();
	}

	FKeyHandoff& FKeyHandoff::operator=(FKeyHandoff&& Other) noexcept
	{
		if (this != &Other)
		{
			Wipe();
			MethodName = std::move(Other.MethodName);
			Url = std::move(Other.Url);
			IdemKey = std::move(Other.IdemKey);
			BodyBytes = std::move(Other.BodyBytes);
			Other.Wipe();
		}
		return *this;
	}

	void FKeyHandoff::MarkSent() { Wipe(); }

	void FKeyHandoff::Wipe()
	{
		if (!BodyBytes.empty()) { SecureZero(&BodyBytes[0], BodyBytes.size()); }
		BodyBytes.clear();
		BodyBytes.shrink_to_fit();
	}

	/* ---------------------------------------------------------------- history */

	void FTurnHistory::Add(FTurn Turn)
	{
		Turns.push_back(std::move(Turn));
		while (Turns.size() > HistoryMaxTurns) { Turns.pop_front(); }
	}

	/* ---------------------------------------------------------------- the session */

	namespace
	{
		constexpr const char* LineConnect = "Connect your OpenAI key";
		constexpr const char* LineRejected = "Your key was rejected";
		constexpr const char* LineOutOfCredit = "Your OpenAI account is out of credit";
		constexpr const char* LineRetryLater = "Retry later";
		constexpr const char* LineSlowDown = "Slow down";
		constexpr const char* LineRefused = "The provider refused this message";
		constexpr const char* LineCutOff = "The reply was cut off; resend to get it";
		constexpr const char* LineError = "Companion error";
		constexpr const char* LineTooLong = "Message too long";
		constexpr const char* LineNotLoopback = "Companion relay must be on this machine";
		constexpr const char* LineProvidersUnknown = "Companion unavailable";
		constexpr const char* LineModeUnavailable = "Key connection is not available";
		constexpr const char* LineConnecting = "Connecting";
		constexpr const char* LineConnFailed = "Could not connect the key";
		constexpr const char* LineConnError = "Connection error; reconnect your OpenAI key";
		constexpr const char* LineLengthLimit = "The reply reached the length limit";
		constexpr const char* LineNoRandom = "Secure random unavailable; try again";
		constexpr const char* LineDeliveryFailed = "Companion delivery failed";
		constexpr std::size_t TraceMaxLines = 256;

		bool IsConnState(std::string_view S)
		{
			return S == "not_connected" || S == "connected_unverified" || S == "connected" || S == "invalid" || S == "revoked"
				|| S == "pending_authorization" || S == "error";
		}

		bool IsDisplayLabel(std::string_view Text)
		{
			if (Text.empty() || Text.size() > ProviderLabelMaxBytes || !IsValidUtf8(Text)) { return false; }
			return SanitizeUntrustedText(Text) == Text && Text.find('\n') == std::string_view::npos && Text.find('\t') == std::string_view::npos;
		}

		// Q15: lastErrorKind -> its 2.3 text; nullptr for null or a word outside the closed set (never the raw word).
		const char* LastErrorLineFor(std::string_view Kind)
		{
			if (Kind == "provider_auth_failed") { return LineRejected; }
			if (Kind == "provider_quota_exhausted") { return LineOutOfCredit; }
			if (Kind == "provider_rate_limited" || Kind == "provider_unavailable") { return LineRetryLater; }
			if (Kind == "provider_refused") { return LineRefused; }
			if (Kind == "companion_internal") { return LineError; }
			if (Kind == "delivery_failed") { return LineDeliveryFailed; }
			return nullptr;
		}
	}

	FOpenAiCompanionSession::FOpenAiCompanionSession(std::string RelayOrigin)
		: Origin(std::move(RelayOrigin)), bOriginOk(IsLoopbackRelayOrigin(Origin))
	{
		Recompute();
	}

	std::string FOpenAiCompanionSession::Url(std::string_view Path) const
	{
		std::string Out = Origin;
		Out += RelayBasePath;
		Out += Path;
		return Out;
	}

	void FOpenAiCompanionSession::Note(std::string Word)
	{
		if (TraceLines.size() >= TraceMaxLines) { TraceLines.erase(TraceLines.begin()); }
		TraceLines.push_back(std::move(Word));
	}

	void FOpenAiCompanionSession::SetError(const char* Line, const char* TraceWord)
	{
		Transient = ECompanionState::Error;
		TransientLine = Line;
		Note(TraceWord);
	}

	FRelayRequest FOpenAiCompanionSession::ProvidersRequest() const
	{
		FRelayRequest Out;
		if (bOriginOk)
		{
			Out.Method = "GET";
			Out.Url = Url("/companions/providers");
		}
		return Out;
	}

	void FOpenAiCompanionSession::ApplyProvidersAnswer(int HttpStatus, std::string_view Body)
	{
		bProvidersOk = false;
		bApiKeyModeAvailable = false;
		Labels.clear();
		FJsonValue Root;
		const FJsonValue* List = nullptr;
		if (HttpStatus == 200 && Body.size() <= ListMaxBodyBytes && ParseJson(Body, Root) && Root.IsObject())
		{
			List = Root.Find("providers");
		}
		if (List == nullptr || List->Kind != FJsonValue::EKind::Array)
		{
			Note("providers_refused");
			Recompute();
			return;
		}
		std::vector<std::pair<std::string, std::vector<std::pair<std::string, std::string>>>> NewLabels;
		bool bOpenAiApiKey = false;
		for (const FJsonValue& Entry : List->Items)
		{
			// Q10: "labels" has one label per mode in "modes"; the deprecated "label" is never read.
			const FJsonValue* Provider = Entry.IsObject() ? FindString(Entry, "provider") : nullptr;
			const FJsonValue* Modes = Entry.IsObject() ? Entry.Find("modes") : nullptr;
			const FJsonValue* LabelMap = Entry.IsObject() ? Entry.Find("labels") : nullptr;
			const FJsonValue* Avail = Entry.IsObject() ? Entry.Find("modeAvailability") : nullptr;
			bool bEntryOk = Provider != nullptr && IsSnakeKind(Provider->Text) && Modes != nullptr && Modes->Kind == FJsonValue::EKind::Array
				&& !Modes->Items.empty() && LabelMap != nullptr && LabelMap->IsObject() && Avail != nullptr && Avail->IsObject();
			std::vector<std::pair<std::string, std::string>> ModeLabels;
			for (std::size_t I = 0; bEntryOk && I < Modes->Items.size(); ++I)
			{
				const FJsonValue& Mode = Modes->Items[I];
				const FJsonValue* ModeLabel = Mode.IsString() ? FindString(*LabelMap, Mode.Text) : nullptr;
				bEntryOk = Mode.IsString() && IsSnakeKind(Mode.Text) && ModeLabel != nullptr && IsDisplayLabel(ModeLabel->Text);
				for (const auto& Seen : ModeLabels)
				{
					if (bEntryOk && Seen.first == Mode.Text) { bEntryOk = false; } // a mode listed twice
				}
				if (bEntryOk) { ModeLabels.emplace_back(Mode.Text, ModeLabel->Text); }
			}
			if (!bEntryOk)
			{
				Note("providers_refused");
				Recompute();
				return; // one malformed entry: the whole list is untrusted
			}
			for (const auto& Known : NewLabels)
			{
				if (Known.first == Provider->Text)
				{
					Note("providers_refused");
					Recompute();
					return;
				}
			}
			NewLabels.emplace_back(Provider->Text, std::move(ModeLabels));
			if (Provider->Text == "openai")
			{
				const FJsonValue* ApiKey = FindString(*Avail, "api_key");
				bOpenAiApiKey = ApiKey != nullptr && ApiKey->Text == "available";
			}
		}
		Labels = std::move(NewLabels);
		bProvidersOk = !LabelFor("openai", "api_key").empty();
		bApiKeyModeAvailable = bProvidersOk && bOpenAiApiKey;
		Note(bProvidersOk ? "providers_ok" : "providers_no_openai");
		Recompute();
	}

	std::string FOpenAiCompanionSession::LabelFor(std::string_view Provider, std::string_view Mode) const
	{
		for (const auto& Entry : Labels)
		{
			if (Entry.first != Provider) { continue; }
			for (const auto& ModeLabel : Entry.second)
			{
				if (ModeLabel.first == Mode) { return ModeLabel.second; }
			}
		}
		return std::string();
	}

	FRelayRequest FOpenAiCompanionSession::ConnectionsRequest() const
	{
		FRelayRequest Out;
		if (bOriginOk)
		{
			Out.Method = "GET";
			Out.Url = Url("/companions/connections");
		}
		return Out;
	}

	void FOpenAiCompanionSession::ApplyConnectionsAnswer(int HttpStatus, std::string_view Body)
	{
		FJsonValue Root;
		const FJsonValue* List = nullptr;
		if (HttpStatus == 200 && Body.size() <= ListMaxBodyBytes && ParseJson(Body, Root) && Root.IsObject())
		{
			List = Root.Find("connections");
		}
		if (List == nullptr || List->Kind != FJsonValue::EKind::Array)
		{
			ConnState.clear(); // unknown: not a real connection
			Note("connections_refused");
			Recompute();
			return;
		}
		std::string Found;
		const char* FoundErrorLine = nullptr;
		for (const FJsonValue& Entry : List->Items)
		{
			const FJsonValue* Provider = Entry.IsObject() ? FindString(Entry, "provider") : nullptr;
			if (Provider == nullptr || Provider->Text != "openai") { continue; }
			const FJsonValue* Mode = FindString(Entry, "mode");
			const FJsonValue* State = FindString(Entry, "state");
			const FJsonValue* LastError = Entry.Find("lastErrorKind");
			if (LastError != nullptr && !LastError->IsNull())
			{
				// Q15: display-only; a word outside the closed set (or a non-string) is null, logged, never a fault.
				FoundErrorLine = LastError->IsString() ? LastErrorLineFor(LastError->Text) : nullptr;
				if (FoundErrorLine == nullptr) { Note("connections_last_error_unknown"); }
			}
			if (!Found.empty() || State == nullptr || !IsConnState(State->Text))
			{
				Found = "error"; // duplicate or unknown state word: fail closed
				break;
			}
			// v0 chat is api_key mode only; any other mode is not a usable connection for this terminal.
			const bool bApiKey = Mode != nullptr && Mode->Text == "api_key";
			Found = (bApiKey || State->Text == "not_connected") ? State->Text : std::string("not_connected");
		}
		ConnState = Found.empty() ? std::string("not_connected") : Found;
		LastErrorLine = Found == "error" ? nullptr : FoundErrorLine;
		Note("connections_" + ConnState);
		Recompute();
	}

	bool FOpenAiCompanionSession::BeginConnect(FMaskedKeyField& Field, std::string_view IdempotencyKey, FKeyHandoff& Out)
	{
		struct FWipeOnExit
		{
			FMaskedKeyField& F;
			~FWipeOnExit() { F.Wipe(); }
		} WipeOnExit{Field};

		Out.Wipe();
		Out.MethodName.clear();
		Out.Url.clear();
		Out.IdemKey.clear();
		const bool bKeyFresh = std::find(UsedKeys.begin(), UsedKeys.end(), IdempotencyKey) == UsedKeys.end();
		if (!bOriginOk || !bProvidersOk || !bApiKeyModeAvailable || bConnecting || bStreaming
			|| !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(IdempotencyKey) || !bKeyFresh || Field.bOverlong)
		{
			Note("connect_refused");
			Recompute();
			return false;
		}
		std::size_t Begin = 0;
		std::size_t End = Field.Length;
		const auto IsSpace = [](char C) { return C == ' ' || C == '\t' || C == '\r' || C == '\n'; };
		while (Begin < End && IsSpace(Field.Buffer[Begin])) { ++Begin; }
		while (End > Begin && IsSpace(Field.Buffer[End - 1])) { --End; }
		if (Begin == End)
		{
			Note("connect_refused");
			Recompute();
			return false;
		}
		for (std::size_t I = Begin; I < End; ++I)
		{
			const char C = Field.Buffer[I];
			if (C < 0x21 || C > 0x7E)
			{
				Note("connect_refused");
				Recompute();
				return false;
			}
		}
		static constexpr std::string_view Head = "{\"mode\":\"api_key\",\"apiKey\":\"";
		static constexpr std::string_view Tail = "\"}";
		// Reserved once so the key bytes are never left behind in a reallocated buffer.
		Out.BodyBytes.reserve(Head.size() + 2 * (End - Begin) + Tail.size());
		Out.BodyBytes.append(Head);
		for (std::size_t I = Begin; I < End; ++I)
		{
			const char C = Field.Buffer[I];
			if (C == '"' || C == '\\') { Out.BodyBytes.push_back('\\'); }
			Out.BodyBytes.push_back(C);
		}
		Out.BodyBytes.append(Tail);
		Out.MethodName = "PUT";
		Out.Url = Url("/companions/connections/openai");
		Out.IdemKey.assign(IdempotencyKey);
		UsedKeys.emplace_back(IdempotencyKey);
		bConnecting = true;
		ConnectNotice = nullptr;
		Note("connect_begin");
		Recompute();
		return true;
	}

	void FOpenAiCompanionSession::ApplyConnectAnswer(int HttpStatus, std::string_view Body, std::uint64_t NowMs)
	{
		(void)NowMs;
		if (!bConnecting) { Note("connect_answer_unexpected"); return; }
		bConnecting = false;
		if (HttpStatus == 200)
		{
			FJsonValue Root;
			bool bOk = Body.size() <= ListMaxBodyBytes && ParseJson(Body, Root) && Root.IsObject();
			if (bOk)
			{
				// Contract 1.2: the answer carries no key, key hint or last-4. One that does is refused outright.
				static constexpr std::string_view Forbidden[] = {"apiKey", "key", "keyHint", "last4", "apiKeyLast4", "hint", "secret"};
				for (const std::string_view Name : Forbidden)
				{
					if (Root.Find(Name) != nullptr) { bOk = false; }
				}
			}
			const FJsonValue* Provider = bOk ? FindString(Root, "provider") : nullptr;
			const FJsonValue* Mode = bOk ? FindString(Root, "mode") : nullptr;
			const FJsonValue* State = bOk ? FindString(Root, "state") : nullptr;
			// Q14: connectedAt is always a UTC instant; verifiedAt is one for "connected" and null for "connected_unverified".
			const FJsonValue* ConnectedAt = bOk ? FindString(Root, "connectedAt") : nullptr;
			const FJsonValue* VerifiedAt = bOk ? Root.Find("verifiedAt") : nullptr;
			std::uint64_t AtMs = 0;
			const bool bConnectedAtOk = ConnectedAt != nullptr && WonderlandJuliusMissionLogic::ParseBridgeUtcTimestampMs(ConnectedAt->Text, AtMs);
			const bool bVerifiedUtc = VerifiedAt != nullptr && VerifiedAt->IsString()
				&& WonderlandJuliusMissionLogic::ParseBridgeUtcTimestampMs(VerifiedAt->Text, AtMs);
			const bool bVerifiedNull = VerifiedAt != nullptr && VerifiedAt->IsNull();
			if (Provider != nullptr && Provider->Text == "openai" && Mode != nullptr && Mode->Text == "api_key" && State != nullptr
				&& bConnectedAtOk && ((State->Text == "connected" && bVerifiedUtc) || (State->Text == "connected_unverified" && bVerifiedNull)))
			{
				ConnState = State->Text;
				bKeyRejected = false; // Q12: the only place the sticky rejection is cleared
				LastErrorLine = nullptr;
				Transient = ECompanionState::Ready;
				TransientLine = nullptr;
				Refusal.clear();
				Note("connect_ok");
				Recompute();
				return;
			}
			ConnectNotice = LineConnFailed;
			Note("connect_answer_refused");
			Recompute();
			return;
		}
		const std::string Kind = ErrorKindOf(Body);
		if (HttpStatus == 403 && (Kind == "companion_mode_not_eligible" || Kind == "companion_provider_not_in_v0"))
		{
			bApiKeyModeAvailable = false;
			ConnectNotice = nullptr;
		}
		else if (HttpStatus == 422 && Kind == "companion_credential_rejected")
		{
			ConnectNotice = LineRejected; // Q14: not stored; the previous connection (and its state) is unchanged
		}
		else if (HttpStatus == 429) { ConnectNotice = LineSlowDown; }
		else if (HttpStatus == 503) { ConnectNotice = LineRetryLater; }
		else { ConnectNotice = LineConnFailed; }
		Note("connect_failed");
		Recompute();
	}

	FRelayRequest FOpenAiCompanionSession::BeginDisconnect()
	{
		FRelayRequest Out;
		if (!bOriginOk || bStreaming || bConnecting)
		{
			Note("disconnect_refused");
			return Out;
		}
		Out.Method = "DELETE";
		Out.Url = Url("/companions/connections/openai");
		Note("disconnect_begin");
		return Out;
	}

	void FOpenAiCompanionSession::ApplyDisconnectAnswer(int HttpStatus)
	{
		if (HttpStatus == 204)
		{
			ConnState = "not_connected"; // Q12: bKeyRejected stays: only a successful PUT clears it
			LastErrorLine = nullptr;
			Transient = ECompanionState::Ready;
			TransientLine = nullptr;
			Refusal.clear();
			bResendAllowed = false;
			ConnectNotice = nullptr;
			Note("disconnect_ok");
		}
		else
		{
			Note("disconnect_failed");
		}
		Recompute();
	}

	void FOpenAiCompanionSession::ApplyKeyMintFailure()
	{
		SetError(LineNoRandom, "key_mint_failed"); // nothing was sent; no fallback key
		Recompute();
	}

	namespace
	{
		std::string BuildChatBody(std::string_view ConvId, std::string_view RunId, std::string_view Message)
		{
			// No "model" field, ever: the server picks the model (contract 2.1).
			std::string Body = "{\"conversationId\":";
			if (ConvId.empty()) { Body += "null"; } else { AppendJsonString(Body, ConvId); }
			Body += ",\"wljRunId\":";
			if (RunId.empty()) { Body += "null"; } else { AppendJsonString(Body, RunId); }
			Body += ",\"message\":";
			AppendJsonString(Body, Message);
			Body += "}";
			return Body;
		}
	}

	bool FOpenAiCompanionSession::BeginMessage(std::string_view Message, std::string_view IdempotencyKey, std::string_view WljRunId,
		std::uint64_t NowMs, FRelayRequest& Out)
	{
		Out = FRelayRequest();
		const bool bKeyFresh = std::find(UsedKeys.begin(), UsedKeys.end(), IdempotencyKey) == UsedKeys.end();
		const std::size_t Units = Utf16Units(Message);
		const bool bRunOk = WljRunId.empty() || WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId);
		if (!ViewState.bCanSend || NowMs < RetryNotBefore || !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(IdempotencyKey)
			|| !bKeyFresh || Message.empty() || Units == static_cast<std::size_t>(-1) || Units > ChatMaxMessageUtf16Units || !bRunOk)
		{
			Note("chat_refused");
			return false;
		}
		UsedKeys.emplace_back(IdempotencyKey);
		PendingMessage.assign(Message);
		PendingKey.assign(IdempotencyKey);
		PendingRunId.assign(WljRunId);
		PendingConvSent = ConvId;
		PendingConvSeen.clear();
		PendingMsgSeen.clear();
		ConnectNotice = nullptr; // Q14: a 422 notice lasts until the next connect or message
		Out.Method = "POST";
		Out.Url = Url("/companions/openai/chat");
		Out.IdempotencyKey = PendingKey;
		Out.Body = BuildChatBody(PendingConvSent, PendingRunId, PendingMessage);
		Decoder = FChatStreamDecoder(PendingConvSent, false);
		bStreaming = true;
		bResendAllowed = false;
		Transient = ECompanionState::Ready;
		TransientLine = nullptr;
		Refusal.clear();
		Note("chat_begin");
		Recompute();
		return true;
	}

	bool FOpenAiCompanionSession::BeginResend(std::uint64_t NowMs, FRelayRequest& Out)
	{
		Out = FRelayRequest();
		const bool bReal = (ConnState == "connected" || ConnState == "connected_unverified") && !bKeyRejected;
		if (!bResendAllowed || !bReal || bStreaming || bConnecting || NowMs < RetryNotBefore || PendingKey.empty() || !bOriginOk)
		{
			Note("resend_refused");
			return false;
		}
		Out.Method = "POST";
		Out.Url = Url("/companions/openai/chat");
		Out.IdempotencyKey = PendingKey; // the SAME key: the server replays a finished reply
		Out.Body = BuildChatBody(PendingConvSent, PendingRunId, PendingMessage);
		// Q1/Q3: the replay must show the cnv_ and msg_ ids an earlier attempt of this key already showed.
		Decoder = FChatStreamDecoder(PendingConvSeen.empty() ? PendingConvSent : PendingConvSeen, true, PendingMsgSeen);
		bStreaming = true;
		bResendAllowed = false;
		Transient = ECompanionState::Ready;
		TransientLine = nullptr;
		Refusal.clear();
		Note("resend_begin");
		Recompute();
		return true;
	}

	void FOpenAiCompanionSession::ApplyChatHttpAnswer(int HttpStatus, std::string_view RetryAfterHeader, std::string_view Body,
		std::uint64_t NowMs)
	{
		if (!bStreaming) { Note("chat_answer_unexpected"); return; }
		bStreaming = false;
		const std::string Kind = ErrorKindOf(Body);
		if (HttpStatus == 409 && Kind == "companion_not_connected")
		{
			ConnState = "not_connected";
			Transient = ECompanionState::Ready;
			TransientLine = nullptr;
			Note("chat_not_connected");
		}
		else if (HttpStatus == 409 && Kind == "companion_message_in_progress")
		{
			Transient = ECompanionState::RetryLater;
			TransientLine = LineRetryLater;
			bResendAllowed = true;
			RetryNotBefore = NowMs + ChatInProgressBackoffMs; // Q4: back off 2 s, then the SAME key
			Note("chat_in_progress");
		}
		else if (HttpStatus == 429 && Kind == "companion_rate_limited")
		{
			std::uint64_t WaitMs = 0;
			if (!ParseRetryAfterSeconds(RetryAfterHeader, WaitMs)) { WaitMs = DefaultRetryWaitMs; }
			Transient = ECompanionState::SlowDown;
			TransientLine = LineSlowDown;
			RetryNotBefore = NowMs + WaitMs;
			Note("chat_slow_down");
		}
		else if (HttpStatus == 503)
		{
			Transient = ECompanionState::RetryLater;
			TransientLine = LineRetryLater;
			bResendAllowed = true;
			Note("chat_unavailable");
		}
		else if (HttpStatus == 413) { SetError(LineTooLong, "chat_too_large"); } // Q6: companion_message_too_large
		else if (HttpStatus == 400) { SetError(LineError, "chat_body_invalid"); } // Q6: companion_body_invalid
		else { SetError(LineError, "chat_http_error"); }
		Recompute();
	}

	void FOpenAiCompanionSession::FeedChatBytes(std::string_view Chunk, std::uint64_t NowMs)
	{
		if (!bStreaming) { return; }
		if (Decoder.Feed(Chunk) != EChatStreamOutcome::Open)
		{
			ApplyStreamOutcome(NowMs);
			return;
		}
		Recompute();
	}

	void FOpenAiCompanionSession::FinishChatStream(std::uint64_t NowMs)
	{
		if (!bStreaming) { return; }
		Decoder.Finish();
		ApplyStreamOutcome(NowMs);
	}

	void FOpenAiCompanionSession::ApplyChatTransportFailure(std::uint64_t NowMs)
	{
		(void)NowMs;
		if (!bStreaming) { return; }
		bStreaming = false;
		Transient = ECompanionState::RetryLater;
		TransientLine = LineRetryLater;
		bResendAllowed = true;
		Note("chat_transport_failed");
		Recompute();
	}

	void FOpenAiCompanionSession::ApplyStreamOutcome(std::uint64_t NowMs)
	{
		bStreaming = false;
		if (Decoder.HasMeta())
		{
			ConvId = Decoder.ConversationId();
			PendingConvSeen = Decoder.ConversationId();
			PendingMsgSeen = Decoder.MessageId();
		}
		switch (Decoder.Outcome())
		{
		case EChatStreamOutcome::Done:
		{
			FTurn Turn;
			Turn.PlayerText = SanitizeUntrustedText(PendingMessage);
			Turn.ReplyText = Decoder.ReplyForDisplay();
			Turn.MessageId = Decoder.MessageId();
			Turn.Model = Decoder.Model();
			Turn.FinishReason = Decoder.FinishReason();
			Turn.bHitLengthLimit = Decoder.HitLengthLimit();
			Turns.Add(std::move(Turn));
			Transient = ECompanionState::Ready;
			TransientLine = Decoder.HitLengthLimit() ? LineLengthLimit : nullptr; // Q5
			bResendAllowed = false;
			Note(Decoder.HitLengthLimit() ? "chat_done_max_length" : "chat_done");
			break;
		}
		case EChatStreamOutcome::ProviderError:
			bResendAllowed = false;
			switch (Decoder.ErrorKind())
			{
			case EChatErrorKind::ProviderAuthFailed:
				bKeyRejected = true;
				ConnState = "invalid";
				Transient = ECompanionState::Ready;
				TransientLine = nullptr;
				Note("chat_key_rejected");
				break;
			case EChatErrorKind::ProviderQuotaExhausted:
				Transient = ECompanionState::OutOfCredit;
				TransientLine = LineOutOfCredit;
				Note("chat_out_of_credit");
				break;
			case EChatErrorKind::ProviderRateLimited:
				Transient = ECompanionState::RetryLater;
				TransientLine = LineRetryLater;
				RetryNotBefore = NowMs + (Decoder.HasRetryAfter() ? Decoder.RetryAfterMs() : DefaultRetryWaitMs); // Q8
				Note("chat_provider_rate_limited");
				break;
			case EChatErrorKind::ProviderUnavailable:
				Transient = ECompanionState::RetryLater;
				TransientLine = LineRetryLater;
				Note("chat_provider_unavailable");
				break;
			case EChatErrorKind::ProviderRefused:
				Transient = ECompanionState::Refused;
				TransientLine = LineRefused;
				Refusal = Decoder.ErrorMessage();
				Note("chat_provider_refused");
				break;
			case EChatErrorKind::CompanionInternal:
			case EChatErrorKind::Unknown:
			case EChatErrorKind::None:
				SetError(LineError, "chat_error_event");
				break;
			}
			break;
		case EChatStreamOutcome::ProtocolError:
			SetError(LineCutOff, "chat_protocol_fault");
			Note(std::string("chat_fault_") + ChatProtocolFaultName(Decoder.Fault()));
			bResendAllowed = true;
			break;
		case EChatStreamOutcome::Open:
			break;
		}
		Recompute();
	}

	FRelayRequest FOpenAiCompanionSession::BeginDeleteHistory()
	{
		FRelayRequest Out;
		if (bStreaming)
		{
			Note("delete_history_refused");
			return Out;
		}
		Turns.Clear();
		PendingMessage.clear();
		PendingKey.clear();
		PendingRunId.clear();
		PendingConvSent.clear();
		PendingConvSeen.clear();
		PendingMsgSeen.clear();
		bResendAllowed = false;
		if (!ConvId.empty())
		{
			DeletePendingConv = ConvId;
			ConvId.clear();
		}
		if (!DeletePendingConv.empty() && bOriginOk)
		{
			Out.Method = "DELETE";
			Out.Url = Url("/companions/openai/conversations/" + DeletePendingConv);
		}
		Note("delete_history_local");
		Recompute();
		return Out;
	}

	void FOpenAiCompanionSession::ApplyDeleteHistoryAnswer(int HttpStatus)
	{
		if (HttpStatus == 204 || HttpStatus == 404) // Q7: a 409 (stream still active) stays pending and is resent
		{
			DeletePendingConv.clear();
			Note("delete_history_ok");
		}
		else
		{
			Note("delete_history_pending");
		}
	}

	void FOpenAiCompanionSession::Recompute()
	{
		FCompanionView V;
		V.ProviderLabel = LabelFor("openai", "api_key"); // Q10: labels[connection.mode]; v0 chat is api_key only
		V.LastErrorLine = LastErrorLine != nullptr ? LastErrorLine : "";
		const bool bReal = (ConnState == "connected" || ConnState == "connected_unverified") && !bKeyRejected;
		V.bShowSimulatedBanner = !bReal;
		V.RetryNotBeforeMs = RetryNotBefore;
		const auto Offline = [&](EOfflineReason Why, const char* Line, bool bCanConnect) {
			V.State = ECompanionState::Offline;
			V.Offline = Why;
			V.StatusLine = Line;
			V.bCanConnect = bCanConnect;
		};
		if (!bOriginOk) { Offline(EOfflineReason::RelayNotLoopback, LineNotLoopback, false); }
		else if (!bProvidersOk) { Offline(EOfflineReason::ProvidersUnknown, LineProvidersUnknown, false); }
		else if (!bApiKeyModeAvailable) { Offline(EOfflineReason::ModeUnavailable, LineModeUnavailable, false); }
		else if (bConnecting)
		{
			V.State = ECompanionState::Connecting;
			V.Offline = EOfflineReason::None;
			V.StatusLine = LineConnecting;
		}
		else if (bKeyRejected || ConnState == "invalid") { Offline(EOfflineReason::KeyRejected, LineRejected, true); }
		else if (ConnState == "error")
		{
			V.State = ECompanionState::Error;
			V.Offline = EOfflineReason::None;
			V.StatusLine = LineConnError;
			V.bCanConnect = true;
		}
		else if (ConnState == "revoked") { Offline(EOfflineReason::Revoked, LineConnect, true); }
		else if (!bReal) { Offline(EOfflineReason::NotConnected, LineConnect, true); }
		else if (bStreaming)
		{
			V.State = ECompanionState::Streaming;
			V.Offline = EOfflineReason::None;
			V.PartialReply = Decoder.ReplyForDisplay();
		}
		else
		{
			V.State = Transient;
			V.Offline = EOfflineReason::None;
			V.StatusLine = TransientLine != nullptr ? TransientLine : "";
			V.RefusalText = Transient == ECompanionState::Refused ? Refusal : std::string();
			V.bCanConnect = true;
			V.bCanSend = true;
			V.bCanResend = bResendAllowed && !PendingKey.empty();
		}
		if (ConnectNotice != nullptr && V.bCanConnect
			&& (V.State == ECompanionState::Offline || (V.State == ECompanionState::Ready && V.StatusLine.empty())))
		{
			V.StatusLine = ConnectNotice; // Q14: a refused PUT leaves the old connection, so Ready shows it too
		}
		ViewState = std::move(V);
	}

	/* ---------------------------------------------------------------- idempotency keys */

	EKeyMint FIdempotencyKeyMinter::Mint(WonderlandJuliusMissionLogic::IRandomBytes16& Source, std::string& OutKey)
	{
		OutKey.clear();
		std::uint8_t Bytes[16] = {};
		const bool bFilled = Source.Fill(Bytes);
		std::string Key = bFilled ? WonderlandJuliusMissionLogic::FormatUuidV4FromBytes(Bytes) : std::string();
		SecureZero(reinterpret_cast<char*>(Bytes), sizeof(Bytes));
		if (!bFilled || !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(Key)) { return EKeyMint::RandomUnavailable; }
		if (!Issued.insert(Key).second) { return EKeyMint::RandomRepeated; }
		OutKey = std::move(Key);
		return EKeyMint::Minted;
	}

	/* ---------------------------------------------------------------- mission status (contract v0.1 4.2) */

	namespace
	{
		bool StateFromWord(std::string_view W, EStatusState& Out)
		{
			static constexpr std::pair<std::string_view, EStatusState> Table[] = {
				{"held", EStatusState::Held}, {"awaiting_operator", EStatusState::AwaitingOperator},
				{"reserved", EStatusState::Reserved}, {"dispatched", EStatusState::Dispatched},
				{"unknown", EStatusState::Unknown}, {"ledger_unwritten", EStatusState::LedgerUnwritten},
				{"interrupted", EStatusState::Interrupted}, {"failed", EStatusState::Failed},
				{"dispatch_failed", EStatusState::DispatchFailed}, {"already_spent", EStatusState::AlreadySpent},
			};
			for (const auto& Row : Table)
			{
				if (Row.first == W) { Out = Row.second; return true; }
			}
			return false;
		}

		bool CauseFromWord(std::string_view W, EStatusCause& Out)
		{
			static constexpr std::pair<std::string_view, EStatusCause> Table[] = {
				{"RUN_ID_ALREADY_SPENT", EStatusCause::RunIdAlreadySpent},
				{"SPENT_TAG_UNVERIFIED", EStatusCause::SpentTagUnverified},
				{"gh_workflow_run_failed", EStatusCause::GhWorkflowRunFailed},
				{"AWAITING_OPERATOR_EXPIRED", EStatusCause::AwaitingOperatorExpired},
			};
			for (const auto& Row : Table)
			{
				if (Row.first == W) { Out = Row.second; return true; }
			}
			return false;
		}

		bool CompanionStateFromWord(std::string_view W, ECompanionTaskState& Out)
		{
			static constexpr std::pair<std::string_view, ECompanionTaskState> Table[] = {
				{"none", ECompanionTaskState::None}, {"invited", ECompanionTaskState::Invited},
				{"delivered", ECompanionTaskState::Delivered}, {"delivery_failed", ECompanionTaskState::DeliveryFailed},
				{"result_received", ECompanionTaskState::ResultReceived}, {"integrated", ECompanionTaskState::Integrated},
				{"rejected", ECompanionTaskState::Rejected}, {"timed_out", ECompanionTaskState::TimedOut},
				{"no_result", ECompanionTaskState::NoResult}, {"cancelled", ECompanionTaskState::Cancelled},
			};
			for (const auto& Row : Table)
			{
				if (Row.first == W) { Out = Row.second; return true; }
			}
			return false;
		}

		// 1-64 of [A-Za-z0-9_-]: safe in a query string without escaping.
		bool IsQuerySafeProjectId(std::string_view Text)
		{
			if (Text.empty() || Text.size() > 64) { return false; }
			for (const char C : Text)
			{
				const bool bOk = (C >= 'a' && C <= 'z') || (C >= 'A' && C <= 'Z') || (C >= '0' && C <= '9') || C == '_' || C == '-';
				if (!bOk) { return false; }
			}
			return true;
		}
	}

	const char* StatusParseName(EStatusParse Result)
	{
		switch (Result)
		{
		case EStatusParse::Ok: return "ok";
		case EStatusParse::BodyTooLarge: return "body_too_large";
		case EStatusParse::BadJson: return "bad_json";
		case EStatusParse::NotObject: return "not_object";
		case EStatusParse::BadWljRunId: return "bad_wlj_run_id";
		case EStatusParse::BadLegacyRunId: return "bad_legacy_run_id";
		case EStatusParse::BadServerRunId: return "bad_server_run_id";
		case EStatusParse::RunIdsDisagree: return "run_ids_disagree";
		case EStatusParse::BadPhase: return "bad_phase";
		case EStatusParse::BadCause: return "bad_cause";
		case EStatusParse::BadDispatchedAt: return "bad_dispatched_at";
		case EStatusParse::BadUpdatedAt: return "bad_updated_at";
		case EStatusParse::BadWorkflowRunId: return "bad_workflow_run_id";
		}
		return "?";
	}

	bool IsTerminalState(EStatusState State)
	{
		switch (State)
		{
		case EStatusState::LedgerUnwritten:
		case EStatusState::Interrupted:
		case EStatusState::Failed:
		case EStatusState::DispatchFailed:
		case EStatusState::AlreadySpent:
			return true;
		case EStatusState::Held:
		case EStatusState::AwaitingOperator:
		case EStatusState::Reserved:
		case EStatusState::Dispatched:
		case EStatusState::Unknown:
			return false;
		}
		return false;
	}

	EStatusParse ParseMissionStatus(std::string_view Body, FMissionStatus& Out)
	{
		return ParseMissionStatus(Body, Out, WonderlandJuliusMissionLogic::bStatusRouteRequiresLegacyRunId);
	}

	EStatusParse ParseMissionStatus(std::string_view Body, FMissionStatus& Out, bool bRequireLegacyRunId)
	{
		Out = FMissionStatus();
		if (Body.size() > StatusMaxBodyBytes) { return EStatusParse::BodyTooLarge; }
		FJsonValue Root;
		if (!ParseJson(Body, Root)) { return EStatusParse::BadJson; }
		if (!Root.IsObject()) { return EStatusParse::NotObject; }
		// Q19: the body is top-level. A v0 "data" wrapper or "phase" field is a fault, never read as a synonym.
		if (Root.Find("data") != nullptr || Root.Find("phase") != nullptr) { return EStatusParse::BadPhase; }

		const FJsonValue* Wlj = FindString(Root, "wljRunId");
		if (Wlj == nullptr || !WonderlandJuliusMissionLogic::IsClientMintedRunId(Wlj->Text)) { return EStatusParse::BadWljRunId; }

		// Q21 rule 2: legacyRunId is null or run:<24 hex>. v0.1 Clarification 1: an absent key is allowed only while
		// WonderlandJuliusMissionLogic::bStatusRouteRequiresLegacyRunId (the one switch, shared with #444) is false.
		const FJsonValue* LegacySlot = Root.Find("legacyRunId");
		const bool bLegacyPresent = LegacySlot != nullptr;
		if (!bLegacyPresent && bRequireLegacyRunId) { return EStatusParse::BadLegacyRunId; }
		std::string Legacy;
		if (bLegacyPresent && !LegacySlot->IsNull())
		{
			if (!LegacySlot->IsString() || !WonderlandJuliusMissionLogic::IsServerRunId(LegacySlot->Text)) { return EStatusParse::BadLegacyRunId; }
			Legacy = LegacySlot->Text;
		}

		const FJsonValue* ServerSlot = Root.Find("serverRunId");
		const bool bServerPresent = ServerSlot != nullptr;
		if (bServerPresent)
		{
			const bool bServerShapeOk = ServerSlot->IsString()
				&& (WonderlandJuliusMissionLogic::IsServerRunId(ServerSlot->Text) || WonderlandJuliusMissionLogic::IsClientMintedRunId(ServerSlot->Text));
			if (!bServerShapeOk) { return EStatusParse::BadServerRunId; }
		}

		bool bLegacyFromServer = false;
		if (bServerPresent)
		{
			const std::string& Server = ServerSlot->Text;
			if (!Legacy.empty())
			{
				if (Server != Legacy) { return EStatusParse::RunIdsDisagree; } // Q21 rule 3, non-null legacyRunId
			}
			else if (!bLegacyPresent && WonderlandJuliusMissionLogic::IsServerRunId(Server))
			{
				// Q21 interim: today's #407 body has serverRunId = run:<24 hex> and no legacyRunId key. That run: id is
				// the legacy row; it is pinned like a legacyRunId. Once legacyRunId is sent (even as null) this path is off.
				Legacy = Server;
				bLegacyFromServer = true;
			}
			else if (Server != Wlj->Text) { return EStatusParse::RunIdsDisagree; } // Q21 rule 3, null legacyRunId
		}

		EStatusState State = EStatusState::Unknown;
		const FJsonValue* StateWord = FindString(Root, "state");
		if (StateWord == nullptr || !StateFromWord(StateWord->Text, State)) { return EStatusParse::BadPhase; }

		EStatusCause Cause = EStatusCause::None;
		if (const FJsonValue* C = Root.Find("cause"); C != nullptr && !C->IsNull())
		{
			if (!C->IsString() || !CauseFromWord(C->Text, Cause)) { return EStatusParse::BadCause; }
		}
		// The expiry cause means "not started, unpaid" only on failed; on any other state it is contradictory.
		if (Cause == EStatusCause::AwaitingOperatorExpired && State != EStatusState::Failed) { return EStatusParse::BadCause; }

		// dispatchedAt matches #444 (P9 / P10): absent or null is no dispatch time (on "dispatched": DispatchUnconfirmed);
		// a non-string is a fault; a string that is not strict UTC (e.g. a 1-2 or 4-9 digit fraction, or an offset) is
		// also no dispatch time (DispatchUnconfirmed, flagged bDispatchedAtUnconfirmed), never a fault.
		bool bHasDispatchedAt = false;
		bool bDispatchedAtUnconfirmed = false;
		std::uint64_t DispatchedAt = 0;
		if (const FJsonValue* Dispatched = Root.Find("dispatchedAt"); Dispatched != nullptr && !Dispatched->IsNull())
		{
			if (!Dispatched->IsString()) { return EStatusParse::BadDispatchedAt; }
			if (WonderlandJuliusMissionLogic::ParseBridgeUtcTimestampMs(Dispatched->Text, DispatchedAt)) { bHasDispatchedAt = true; }
			else
			{
				DispatchedAt = 0;
				bDispatchedAtUnconfirmed = true;
			}
		}

		// v0.1 Clarification 3: workflowRunId is optional and opaque (null, or 1..StatusRouteWorkflowRunIdMaxBytes of
		// printable ASCII without space, the same cap as #444's P10). Never stored, displayed or logged.
		if (const FJsonValue* Workflow = Root.Find("workflowRunId"); Workflow != nullptr && !Workflow->IsNull())
		{
			bool bWorkflowOk = Workflow->IsString() && !Workflow->Text.empty()
				&& Workflow->Text.size() <= WonderlandJuliusMissionLogic::StatusRouteWorkflowRunIdMaxBytes;
			for (std::size_t Index = 0; bWorkflowOk && Index < Workflow->Text.size(); ++Index)
			{
				const unsigned char Byte = static_cast<unsigned char>(Workflow->Text[Index]);
				bWorkflowOk = Byte >= 0x21 && Byte <= 0x7E;
			}
			if (!bWorkflowOk) { return EStatusParse::BadWorkflowRunId; }
		}

		std::uint64_t UpdatedAt = 0;
		const FJsonValue* At = FindString(Root, "updatedAt");
		if (At == nullptr || !WonderlandJuliusMissionLogic::ParseBridgeUtcTimestampMs(At->Text, UpdatedAt)) { return EStatusParse::BadUpdatedAt; }

		Out.WljRunId = Wlj->Text;
		Out.LegacyRunId = Legacy;
		Out.bLegacyFromServerRunIdOnly = bLegacyFromServer;
		Out.State = State;
		Out.Cause = Cause;
		Out.bHasDispatchedAt = bHasDispatchedAt;
		Out.bDispatchedAtUnconfirmed = bDispatchedAtUnconfirmed;
		Out.DispatchedAtMs = DispatchedAt;
		Out.UpdatedAtMs = UpdatedAt;
		return EStatusParse::Ok;
	}

	EStatusMeaning StatusMeaning(const FMissionStatus& Status)
	{
		switch (Status.State)
		{
		case EStatusState::Dispatched:
			// #444 P9: only a well-formed dispatchedAt confirms the dispatch; absent, null or unparseable fails closed.
			return Status.bHasDispatchedAt ? EStatusMeaning::DispatchedNotReported : EStatusMeaning::DispatchUnconfirmed;
		case EStatusState::Failed:
			return Status.Cause == EStatusCause::AwaitingOperatorExpired ? EStatusMeaning::NotStartedOperatorWindowExpired
																		 : EStatusMeaning::AdmissionEnded;
		case EStatusState::Interrupted:
		case EStatusState::LedgerUnwritten: return EStatusMeaning::AdmissionEnded;
		case EStatusState::DispatchFailed: return EStatusMeaning::DispatchFailed;
		case EStatusState::AlreadySpent: return EStatusMeaning::AlreadySpent;
		case EStatusState::Held:
		case EStatusState::AwaitingOperator:
		case EStatusState::Reserved:
		case EStatusState::Unknown: return EStatusMeaning::Waiting;
		}
		return EStatusMeaning::Waiting;
	}

	const char* StatusMeaningLabel(EStatusMeaning Meaning)
	{
		switch (Meaning)
		{
		case EStatusMeaning::Waiting: return "Waiting for the operator (unpaid)";
		case EStatusMeaning::DispatchedNotReported: return "Dispatched; run status not yet reported";
		case EStatusMeaning::DispatchUnconfirmed: return "Can't confirm when the run was started \xE2\x80\x94 still checking with the bridge";
		case EStatusMeaning::NotStartedOperatorWindowExpired: return "Not started: the operator window expired (unpaid)";
		case EStatusMeaning::AdmissionEnded: return "Not started: the admission ended";
		case EStatusMeaning::DispatchFailed: return "Dispatch failed";
		case EStatusMeaning::AlreadySpent: return "This run id was already used";
		}
		return "";
	}

	FRelayRequest MissionStatusRequest(std::string_view RelayOrigin, std::string_view RunId, std::string_view ProjectId)
	{
		FRelayRequest Out;
		const bool bRunIdOk = WonderlandJuliusMissionLogic::IsClientMintedRunId(RunId) || WonderlandJuliusMissionLogic::IsServerRunId(RunId);
		if (!IsLoopbackRelayOrigin(RelayOrigin) || !bRunIdOk || !IsQuerySafeProjectId(ProjectId)) { return Out; }
		Out.Method = "GET";
		Out.Url = std::string(RelayOrigin) + std::string(RelayBasePath) + "/julius/status?runId=" + std::string(RunId)
			+ "&projectId=" + std::string(ProjectId);
		return Out;
	}

	FStatusPin::FStatusPin(std::string OwnWljRunId) : Own(std::move(OwnWljRunId))
	{
		if (!WonderlandJuliusMissionLogic::IsClientMintedRunId(Own)) { bMismatch = true; }
	}

	EPinVerdict FStatusPin::Apply(const FMissionStatus& Status)
	{
		if (bMismatch) { return EPinVerdict::Mismatch; }
		// #444: the run id is this client's own wlj_ id, byte for byte. Anything else is another run.
		if (Status.WljRunId != Own || !WonderlandJuliusMissionLogic::IsAcceptedServerRunId(Status.WljRunId, Own))
		{
			bMismatch = true;
			return EPinVerdict::Mismatch;
		}
		// Identity checks come before ordering: an old answer naming another legacy row is still another run.
		if (bHaveAny && Status.LegacyRunId != Current.LegacyRunId)
		{
			bMismatch = true; // the legacy id is pinned once; a change (also to or from null) is a different run
			return EPinVerdict::Mismatch;
		}
		if (bHaveAny && Current.bHasDispatchedAt && Status.bHasDispatchedAt && Status.DispatchedAtMs != Current.DispatchedAtMs)
		{
			bMismatch = true; // dispatchedAt is written once and never moves (v0.1 4.2)
			return EPinVerdict::Mismatch;
		}
		if (bHaveAny && IsTerminalState(Current.State)) { return EPinVerdict::Stale; }
		if (bHaveAny && Status.UpdatedAtMs < Current.UpdatedAtMs) { return EPinVerdict::Stale; }
		if (bHaveAny && Status.State == EStatusState::Unknown && Current.State != EStatusState::Unknown) { return EPinVerdict::Stale; }
		if (bHaveAny && Current.State == EStatusState::Dispatched && Status.State != EStatusState::Dispatched
			&& Status.State != EStatusState::DispatchFailed && Status.State != EStatusState::AlreadySpent)
		{
			return EPinVerdict::Stale;
		}
		const bool bKeepDispatchedAt = bHaveAny && Current.bHasDispatchedAt && !Status.bHasDispatchedAt;
		const std::uint64_t KeptDispatchedAt = Current.DispatchedAtMs;
		Current = Status;
		if (bKeepDispatchedAt)
		{
			Current.bHasDispatchedAt = true; // a later answer without the key does not erase a recorded dispatch time
			Current.DispatchedAtMs = KeptDispatchedAt;
			Current.bDispatchedAtUnconfirmed = false; // the recorded dispatch time stands; an unparseable later one never moves it
		}
		bHaveAny = true;
		return EPinVerdict::Applied;
	}

	/* ---------------------------------------------------------------- Grok Bot result and provenance */

	const char* ResultParseName(EResultParse Result)
	{
		switch (Result)
		{
		case EResultParse::Ok: return "ok";
		case EResultParse::TooLarge: return "too_large";
		case EResultParse::BadJson: return "bad_json";
		case EResultParse::BadSchema: return "bad_schema";
		case EResultParse::BadTaskId: return "bad_task_id";
		case EResultParse::RunIdMismatch: return "run_id_mismatch";
		case EResultParse::BadSummary: return "bad_summary";
		case EResultParse::BadArtifact: return "bad_artifact";
		case EResultParse::BadAgent: return "bad_agent";
		}
		return "?";
	}

	EResultParse ParseCompanionResultV0(std::string_view Body, std::string_view OwnWljRunId, FCompanionResultView& Out)
	{
		Out = FCompanionResultView();
		if (Body.size() > CompanionResultMaxBytes) { return EResultParse::TooLarge; } // before any parsing
		FJsonValue Root;
		if (!ParseJson(Body, Root) || !Root.IsObject()) { return EResultParse::BadJson; }
		const FJsonValue* Schema = FindString(Root, "schema");
		if (Schema == nullptr || Schema->Text != "wonderland.companion_result.v0") { return EResultParse::BadSchema; }
		const FJsonValue* Task = FindString(Root, "taskId");
		if (Task == nullptr || !IsCompanionTaskId(Task->Text)) { return EResultParse::BadTaskId; }
		const FJsonValue* Wlj = FindString(Root, "wljRunId");
		if (Wlj == nullptr || !WonderlandJuliusMissionLogic::IsClientMintedRunId(OwnWljRunId) || Wlj->Text != OwnWljRunId)
		{
			return EResultParse::RunIdMismatch;
		}
		const FJsonValue* Summary = FindString(Root, "summary");
		if (Summary == nullptr || Summary->Text.size() > CompanionSummaryMaxBytes) { return EResultParse::BadSummary; }
		const FJsonValue* Artifact = Root.Find("artifact");
		const FJsonValue* Kind = (Artifact != nullptr && Artifact->IsObject()) ? FindString(*Artifact, "kind") : nullptr;
		const FJsonValue* Content = (Artifact != nullptr && Artifact->IsObject()) ? FindString(*Artifact, "content") : nullptr;
		EArtifactKind ArtifactKind = EArtifactKind::Text;
		if (Kind == nullptr || Content == nullptr) { return EResultParse::BadArtifact; }
		if (Kind->Text == "text") { ArtifactKind = EArtifactKind::Text; }
		else if (Kind->Text == "patch") { ArtifactKind = EArtifactKind::Patch; }
		else if (Kind->Text == "json") { ArtifactKind = EArtifactKind::Json; }
		else { return EResultParse::BadArtifact; }
		const FJsonValue* Agent = Root.Find("agent");
		const FJsonValue* Name = (Agent != nullptr && Agent->IsObject()) ? FindString(*Agent, "selfReportedName") : nullptr;
		if (Name == nullptr || Name->Text.size() > ProviderLabelMaxBytes) { return EResultParse::BadAgent; }
		const FJsonValue* RunUrl = Agent->Find("selfReportedRunUrl");
		if (RunUrl != nullptr && !RunUrl->IsNull() && !RunUrl->IsString()) { return EResultParse::BadAgent; }

		Out.TaskId = Task->Text;
		Out.WljRunId = Wlj->Text;
		Out.Summary = SanitizeUntrustedText(Summary->Text);
		Out.ArtifactKind = ArtifactKind;
		Out.ArtifactContent = SanitizeUntrustedText(Content->Text);
		Out.SelfReportedName = SanitizeUntrustedText(Name->Text);
		Out.bUntrusted = true;
		return EResultParse::Ok;
	}

	namespace
	{
		EProvenanceParse ParseProvenanceObject(const FJsonValue& Root, FCompanionProvenanceView& Out)
		{
			Out = FCompanionProvenanceView();
			if (!Root.IsObject()) { return EProvenanceParse::BadJson; }
			const FJsonValue* Source = FindString(Root, "source");
			if (Source == nullptr || (Source->Text != "grok_bot" && Source->Text != "simulated")) { return EProvenanceParse::BadSource; }
			const FJsonValue* Simulated = Root.Find("simulated");
			if (Simulated == nullptr || Simulated->Kind != FJsonValue::EKind::Bool) { return EProvenanceParse::BadFields; }
			const bool bSimSource = Source->Text == "simulated";
			if (Simulated->bBool != bSimSource) { return EProvenanceParse::SimulatedInconsistent; }
			const FJsonValue* VerifiedBy = Root.Find("verifiedBy");
			const bool bHasVerifiedBy = VerifiedBy != nullptr && !VerifiedBy->IsNull();
			if (Simulated->bBool && bHasVerifiedBy) { return EProvenanceParse::SimulatedVerified; }
			if (bHasVerifiedBy && (!VerifiedBy->IsString() || VerifiedBy->Text != "task_token_round_trip")) { return EProvenanceParse::BadFields; }
			std::string Sha;
			if (const FJsonValue* S = Root.Find("resultSha256"); S != nullptr && !S->IsNull())
			{
				if (!S->IsString() || !WonderlandJuliusMissionLogic::IsLowerHex64(S->Text)) { return EProvenanceParse::BadFields; }
				Sha = S->Text;
			}
			std::string Name;
			if (const FJsonValue* SR = Root.Find("selfReported"); SR != nullptr && !SR->IsNull())
			{
				const FJsonValue* N = SR->IsObject() ? FindString(*SR, "name") : nullptr;
				if (N == nullptr || N->Text.size() > ProviderLabelMaxBytes) { return EProvenanceParse::BadFields; }
				Name = SanitizeUntrustedText(N->Text);
			}
			Out.bSimulated = Simulated->bBool;
			Out.bVerifiedByTokenRoundTrip = !Simulated->bBool && bHasVerifiedBy;
			Out.SelfReportedName = Name;
			Out.ResultSha256 = Sha;
			return EProvenanceParse::Ok;
		}
	}

	EProvenanceParse ParseCompanionProvenanceV0(std::string_view Body, FCompanionProvenanceView& Out)
	{
		Out = FCompanionProvenanceView();
		if (Body.size() > ListMaxBodyBytes) { return EProvenanceParse::TooLarge; }
		FJsonValue Root;
		if (!ParseJson(Body, Root) || !Root.IsObject()) { return EProvenanceParse::BadJson; }
		return ParseProvenanceObject(Root, Out);
	}

	/* ---------------------------------------------------------------- Grok Bot result read route (contract v0.1 3.7) */

	bool IsTerminalCompanionState(ECompanionTaskState State)
	{
		switch (State)
		{
		case ECompanionTaskState::DeliveryFailed:
		case ECompanionTaskState::Integrated:
		case ECompanionTaskState::Rejected:
		case ECompanionTaskState::TimedOut:
		case ECompanionTaskState::NoResult:
		case ECompanionTaskState::Cancelled:
			return true;
		case ECompanionTaskState::None:
		case ECompanionTaskState::Invited:
		case ECompanionTaskState::Delivered:
		case ECompanionTaskState::ResultReceived:
			return false;
		}
		return false;
	}

	FRelayRequest CompanionMissionRequest(std::string_view RelayOrigin, std::string_view WljRunId, std::string_view ProjectId)
	{
		FRelayRequest Out;
		// Q22: keyed by wlj_ only. A legacy run: id has no companion task and is never sent on this route.
		if (!IsLoopbackRelayOrigin(RelayOrigin) || !WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId) || !IsQuerySafeProjectId(ProjectId))
		{
			return Out;
		}
		Out.Method = "GET";
		Out.Url = std::string(RelayOrigin) + std::string(RelayBasePath) + "/julius/missions/" + std::string(WljRunId)
			+ "/companion?projectId=" + std::string(ProjectId);
		return Out;
	}

	const char* CompanionMissionParseName(ECompanionMissionParse Result)
	{
		switch (Result)
		{
		case ECompanionMissionParse::Ok: return "ok";
		case ECompanionMissionParse::NotOk: return "not_ok";
		case ECompanionMissionParse::TooLarge: return "too_large";
		case ECompanionMissionParse::BadJson: return "bad_json";
		case ECompanionMissionParse::RunIdMismatch: return "run_id_mismatch";
		case ECompanionMissionParse::BadTaskId: return "bad_task_id";
		case ECompanionMissionParse::BadState: return "bad_state";
		case ECompanionMissionParse::BadResult: return "bad_result";
		case ECompanionMissionParse::BadProvenance: return "bad_provenance";
		case ECompanionMissionParse::ResultTooEarly: return "result_too_early";
		case ECompanionMissionParse::BadUpdatedAt: return "bad_updated_at";
		}
		return "?";
	}

	ECompanionMissionParse ParseCompanionMission(int HttpStatus, std::string_view Body, std::string_view OwnWljRunId,
		FCompanionMissionView& Out)
	{
		Out = FCompanionMissionView();
		if (HttpStatus != 200) { return ECompanionMissionParse::NotOk; } // 404 / 409 / 503 / missing route: no result
		if (Body.size() > StatusMaxBodyBytes) { return ECompanionMissionParse::TooLarge; }
		FJsonValue Root;
		if (!ParseJson(Body, Root) || !Root.IsObject()) { return ECompanionMissionParse::BadJson; }

		const FJsonValue* Wlj = FindString(Root, "wljRunId");
		if (Wlj == nullptr || !WonderlandJuliusMissionLogic::IsClientMintedRunId(OwnWljRunId) || Wlj->Text != OwnWljRunId)
		{
			return ECompanionMissionParse::RunIdMismatch;
		}

		const FJsonValue* Task = Root.Find("taskId");
		if (Task == nullptr || (!Task->IsNull() && !(Task->IsString() && IsCompanionTaskId(Task->Text)))) { return ECompanionMissionParse::BadTaskId; }

		const FJsonValue* Companion = Root.Find("companion");
		const FJsonValue* StateWord = (Companion != nullptr && Companion->IsObject()) ? FindString(*Companion, "state") : nullptr;
		ECompanionTaskState State = ECompanionTaskState::None;
		if (StateWord == nullptr || !CompanionStateFromWord(StateWord->Text, State)) { return ECompanionMissionParse::BadState; }

		const FJsonValue* Result = Root.Find("result");
		if (Result == nullptr) { return ECompanionMissionParse::BadResult; }
		const bool bHasResult = !Result->IsNull();
		std::string Summary;
		EArtifactKind Kind = EArtifactKind::Text;
		std::string Sha;
		std::uint64_t ByteLength = 0;
		if (bHasResult)
		{
			if (!Result->IsObject()) { return ECompanionMissionParse::BadResult; }
			const FJsonValue* Untrusted = Result->Find("untrusted");
			if (Untrusted == nullptr || Untrusted->Kind != FJsonValue::EKind::Bool || !Untrusted->bBool) { return ECompanionMissionParse::BadResult; }
			const FJsonValue* S = FindString(*Result, "summary");
			if (S == nullptr || S->Text.size() > CompanionSummaryMaxBytes) { return ECompanionMissionParse::BadResult; }
			const FJsonValue* Artifact = Result->Find("artifact");
			if (Artifact == nullptr || !Artifact->IsObject()) { return ECompanionMissionParse::BadResult; }
			if (Artifact->Find("content") != nullptr) { return ECompanionMissionParse::BadResult; } // never on this route
			const FJsonValue* K = FindString(*Artifact, "kind");
			const FJsonValue* H = FindString(*Artifact, "sha256");
			const FJsonValue* L = Artifact->Find("byteLength");
			if (K == nullptr || H == nullptr || L == nullptr) { return ECompanionMissionParse::BadResult; }
			if (K->Text == "text") { Kind = EArtifactKind::Text; }
			else if (K->Text == "patch") { Kind = EArtifactKind::Patch; }
			else if (K->Text == "json") { Kind = EArtifactKind::Json; }
			else { return ECompanionMissionParse::BadResult; }
			if (!WonderlandJuliusMissionLogic::IsLowerHex64(H->Text) || !JsonToSafeUnsigned(*L, ByteLength)) { return ECompanionMissionParse::BadResult; }
			Summary = SanitizeUntrustedText(S->Text);
			Sha = H->Text;
		}

		const FJsonValue* Provenance = Root.Find("provenance");
		if (Provenance == nullptr) { return ECompanionMissionParse::BadProvenance; }
		const bool bHasProvenance = !Provenance->IsNull();
		FCompanionProvenanceView ProvenanceView;
		if (bHasProvenance && ParseProvenanceObject(*Provenance, ProvenanceView) != EProvenanceParse::Ok)
		{
			return ECompanionMissionParse::BadProvenance;
		}

		// v0.1 3.7: result and provenance stay null until result_received.
		const bool bResultAllowed = State == ECompanionTaskState::ResultReceived || State == ECompanionTaskState::Integrated
			|| State == ECompanionTaskState::Rejected;
		if ((bHasResult || bHasProvenance) && !bResultAllowed) { return ECompanionMissionParse::ResultTooEarly; }

		std::uint64_t UpdatedAt = 0;
		const FJsonValue* At = FindString(Root, "updatedAt");
		if (At == nullptr || !WonderlandJuliusMissionLogic::ParseBridgeUtcTimestampMs(At->Text, UpdatedAt)) { return ECompanionMissionParse::BadUpdatedAt; }

		Out.bHasAnswer = true;
		Out.TaskId = Task->IsNull() ? std::string() : Task->Text;
		Out.State = State;
		Out.bHasResult = bHasResult;
		Out.Summary = Summary;
		Out.ArtifactKind = Kind;
		Out.ArtifactSha256 = Sha;
		Out.ArtifactByteLength = ByteLength;
		Out.bHasProvenance = bHasProvenance;
		Out.Provenance = ProvenanceView;
		Out.bShowVerified = bHasProvenance && !ProvenanceView.bSimulated && ProvenanceView.bVerifiedByTokenRoundTrip;
		Out.UpdatedAtMs = UpdatedAt;
		return ECompanionMissionParse::Ok;
	}
}

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

	FChatStreamDecoder::FChatStreamDecoder(std::string ExpectedProviderId, std::string ExpectedConversationId, bool bReplayResend,
		std::string ExpectedMessageId)
		: ExpectedProvider(std::move(ExpectedProviderId)), ExpectedConv(std::move(ExpectedConversationId)), bReplay(bReplayResend),
		  ExpectedMsg(std::move(ExpectedMessageId))
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
			if (Provider == nullptr || Provider->Text.empty() || Provider->Text != ExpectedProvider) { Fail(EChatProtocolFault::MetaWrongProvider); return; }
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

	bool MayCarrySession(std::string_view Url, std::string_view RelayOrigin)
	{
		if (RelayOrigin.empty() || !IsLoopbackRelayOrigin(RelayOrigin)) { return false; }
		if (Url.size() <= RelayOrigin.size() || Url.compare(0, RelayOrigin.size(), RelayOrigin) != 0) { return false; }
		return Url[RelayOrigin.size()] == '/';
	}

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

	/* ---------------------------------------------------------------- history */

	void FTurnHistory::Add(FTurn Turn)
	{
		Turns.push_back(std::move(Turn));
		while (Turns.size() > HistoryMaxTurns) { Turns.pop_front(); }
	}

	/* ---------------------------------------------------------------- agents (BRIDGE 7e5e1e30: registry.ts, route.ts) */

	namespace
	{
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

		// What String.prototype.trim() removes (ECMAScript WhiteSpace + LineTerminator), for BRIDGE's "non-blank" checks.
		bool IsJsTrimSpace(char32_t Cp)
		{
			return Cp == 0x09 || Cp == 0x0A || Cp == 0x0B || Cp == 0x0C || Cp == 0x0D || Cp == 0x20 || Cp == 0xA0 || Cp == 0x1680
				|| (Cp >= 0x2000 && Cp <= 0x200A) || Cp == 0x2028 || Cp == 0x2029 || Cp == 0x202F || Cp == 0x205F || Cp == 0x3000
				|| Cp == 0xFEFF;
		}

		// Valid UTF-8, 1..MaxUnits UTF-16 units, and not all trim-space: BRIDGE's providerId / displayName rule.
		bool IsNonBlankText(std::string_view Text, std::size_t MaxUnits)
		{
			const std::size_t Units = Utf16Units(Text);
			if (Units == static_cast<std::size_t>(-1) || Units == 0 || Units > MaxUnits) { return false; }
			for (std::size_t Pos = 0; Pos < Text.size();)
			{
				char32_t Cp = 0;
				const std::size_t Len = DecodeUtf8(Text, Pos, Cp);
				if (!IsJsTrimSpace(Cp)) { return true; }
				Pos += Len;
			}
			return false;
		}

		bool IsTokenChar(char C, bool bAllowDotColon)
		{
			if ((C >= 'a' && C <= 'z') || (C >= 'A' && C <= 'Z') || (C >= '0' && C <= '9') || C == '_' || C == '-') { return true; }
			return bAllowDotColon && (C == '.' || C == ':');
		}

		bool IsToken(std::string_view Text, std::size_t MaxLen, bool bAllowDotColon)
		{
			if (Text.empty() || Text.size() > MaxLen) { return false; }
			for (const char C : Text)
			{
				if (!IsTokenChar(C, bAllowDotColon)) { return false; }
			}
			return true;
		}

		// A capability list: an array of distinct capability words, at most CapabilityListMaxCount.
		bool ReadCapabilities(const FJsonValue* List, std::vector<std::string>& Out)
		{
			Out.clear();
			if (List == nullptr || List->Kind != FJsonValue::EKind::Array || List->Items.size() > CapabilityListMaxCount) { return false; }
			for (const FJsonValue& Item : List->Items)
			{
				if (!Item.IsString() || !IsCapabilityWord(Item.Text) || HasCapability(Out, Item.Text)) { Out.clear(); return false; }
				Out.push_back(Item.Text);
			}
			return true;
		}

		bool ConnectionFromWord(std::string_view W, EAgentConnection& Out)
		{
			if (W == "connected") { Out = EAgentConnection::Connected; return true; }
			if (W == "disconnected") { Out = EAgentConnection::Disconnected; return true; }
			if (W == "unsupported") { Out = EAgentConnection::Unsupported; return true; }
			if (W == "error") { Out = EAgentConnection::Error; return true; }
			return false;
		}

		FAgentSlot FaultSlot(std::string AgentId, EAgentSlotFault Why)
		{
			FAgentSlot S;
			S.Descriptor.AgentId = std::move(AgentId);
			S.Descriptor.Connection = EAgentConnection::Error;
			S.Fault = Why;
			return S;
		}
	}

	bool IsAgentId(std::string_view Text) { return HasPrefixedUuid(Text, "agt_"); }
	bool IsProviderId(std::string_view Text) { return IsNonBlankText(Text, ProviderIdMaxUtf16Units); }
	bool IsAgentDisplayName(std::string_view Text) { return IsNonBlankText(Text, DisplayNameMaxUtf16Units); }
	bool IsCapabilityWord(std::string_view Text) { return IsToken(Text, CapabilityMaxBytes, true); }

	bool HasCapability(const std::vector<std::string>& List, std::string_view Capability)
	{
		return std::find(List.begin(), List.end(), Capability) != List.end();
	}

	const char* AgentSlotFaultName(EAgentSlotFault Fault)
	{
		switch (Fault)
		{
		case EAgentSlotFault::None: return "none";
		case EAgentSlotFault::NotObject: return "not_object";
		case EAgentSlotFault::BadAgentId: return "bad_agent_id";
		case EAgentSlotFault::BadProviderId: return "bad_provider_id";
		case EAgentSlotFault::BadDisplayName: return "bad_display_name";
		case EAgentSlotFault::BadKind: return "bad_kind";
		case EAgentSlotFault::BadAdapterVersion: return "bad_adapter_version";
		case EAgentSlotFault::BadDeclaredCapabilities: return "bad_declared_capabilities";
		case EAgentSlotFault::BadAuthorizedCapabilities: return "bad_authorized_capabilities";
		case EAgentSlotFault::AuthorizedNotDeclared: return "authorized_not_declared";
		case EAgentSlotFault::BadConnection: return "bad_connection";
		case EAgentSlotFault::BadVerified: return "bad_verified";
		case EAgentSlotFault::InconsistentConnection: return "inconsistent_connection";
		case EAgentSlotFault::DuplicateAgentId: return "duplicate_agent_id";
		case EAgentSlotFault::TooMany: return "too_many";
		}
		return "?";
	}

	const char* AgentListParseName(EAgentListParse Result)
	{
		switch (Result)
		{
		case EAgentListParse::Ok: return "ok";
		case EAgentListParse::Absent: return "absent";
		case EAgentListParse::NotArray: return "not_array";
		}
		return "?";
	}

	FAgentSlot ParseAgentDescriptor(const FJsonValue& Entry)
	{
		if (!Entry.IsObject()) { return FaultSlot(std::string(), EAgentSlotFault::NotObject); }
		const FJsonValue* Id = FindString(Entry, "agentId");
		if (Id == nullptr || !IsAgentId(Id->Text)) { return FaultSlot(std::string(), EAgentSlotFault::BadAgentId); }
		const std::string AgentId = Id->Text;
		const FJsonValue* Provider = FindString(Entry, "providerId");
		if (Provider == nullptr || !IsProviderId(Provider->Text)) { return FaultSlot(AgentId, EAgentSlotFault::BadProviderId); }
		// displayName: string | null (registry.ts:31); BRIDGE publishes no blank string (registry.ts:197).
		const FJsonValue* Name = Entry.Find("displayName");
		if (Name == nullptr || !(Name->IsNull() || (Name->IsString() && IsAgentDisplayName(Name->Text)))) { return FaultSlot(AgentId, EAgentSlotFault::BadDisplayName); }
		const bool bHasName = Name->IsString();
		// kind: "single" | "compound" | null (registry.ts:32); null reads Unknown (contract:67).
		const FJsonValue* KindValue = Entry.Find("kind");
		EAgentKind Kind = EAgentKind::Unknown;
		if (KindValue != nullptr && KindValue->IsNull()) { Kind = EAgentKind::Unknown; }
		else if (KindValue != nullptr && KindValue->IsString() && KindValue->Text == "single") { Kind = EAgentKind::Single; }
		else if (KindValue != nullptr && KindValue->IsString() && KindValue->Text == "compound") { Kind = EAgentKind::Compound; }
		else { return FaultSlot(AgentId, EAgentSlotFault::BadKind); }
		// adapterVersion: string | null (registry.ts:33); the 1-64 printable bound is the client's guess (open).
		const FJsonValue* Version = Entry.Find("adapterVersion");
		if (Version == nullptr || !(Version->IsNull() || (Version->IsString() && IsPrintableAscii(Version->Text, 1, AdapterVersionMaxBytes))))
		{
			return FaultSlot(AgentId, EAgentSlotFault::BadAdapterVersion);
		}
		std::vector<std::string> Declared;
		if (!ReadCapabilities(Entry.Find("declaredCapabilities"), Declared)) { return FaultSlot(AgentId, EAgentSlotFault::BadDeclaredCapabilities); }
		std::vector<std::string> Authorized;
		if (!ReadCapabilities(Entry.Find("authorizedCapabilities"), Authorized)) { return FaultSlot(AgentId, EAgentSlotFault::BadAuthorizedCapabilities); }
		for (const std::string& Cap : Authorized)
		{
			if (!HasCapability(Declared, Cap)) { return FaultSlot(AgentId, EAgentSlotFault::AuthorizedNotDeclared); } // A6
		}
		const FJsonValue* ConnWord = FindString(Entry, "connection");
		EAgentConnection Connection = EAgentConnection::Error;
		if (ConnWord == nullptr || !ConnectionFromWord(ConnWord->Text, Connection)) { return FaultSlot(AgentId, EAgentSlotFault::BadConnection); }
		// No AgentDescriptor carries "verified" (registry.ts:28-37): any such key is a claim nothing backs.
		if (Entry.Find("verified") != nullptr) { return FaultSlot(AgentId, EAgentSlotFault::BadVerified); }
		// publishAgentDescriptor's guarantees (registry.ts:198-212); a descriptor that breaks one is not BRIDGE's.
		const bool bHidden = Connection == EAgentConnection::Unsupported || Connection == EAgentConnection::Error;
		if ((Connection == EAgentConnection::Connected && (!bHasName || Kind == EAgentKind::Unknown))
			|| (bHidden && (Kind != EAgentKind::Unknown || !Declared.empty() || !Authorized.empty()))
			|| (Connection == EAgentConnection::Unsupported && !Version->IsNull()))
		{
			return FaultSlot(AgentId, EAgentSlotFault::InconsistentConnection);
		}
		FAgentSlot Out;
		Out.Descriptor.AgentId = AgentId;
		Out.Descriptor.ProviderId = Provider->Text;
		Out.Descriptor.DisplayName = bHasName ? SanitizeUntrustedText(Name->Text) : std::string();
		Out.Descriptor.Kind = Kind;
		Out.Descriptor.AdapterVersion = Version->IsNull() ? std::string() : Version->Text;
		Out.Descriptor.DeclaredCapabilities = std::move(Declared);
		Out.Descriptor.AuthorizedCapabilities = std::move(Authorized);
		Out.Descriptor.Connection = Connection;
		return Out;
	}

	EAgentListParse ParseAgentList(const FJsonValue& Root, std::vector<FAgentSlot>& Out)
	{
		Out.clear();
		const FJsonValue* List = Root.IsObject() ? Root.Find("agents") : nullptr;
		if (List == nullptr) { return EAgentListParse::Absent; }
		if (List->Kind != FJsonValue::EKind::Array) { return EAgentListParse::NotArray; }
		const std::size_t Count = std::min(List->Items.size(), AgentListMaxEntries);
		for (std::size_t I = 0; I < Count; ++I) { Out.push_back(ParseAgentDescriptor(List->Items[I])); }
		if (List->Items.size() > AgentListMaxEntries) { Out.push_back(FaultSlot(std::string(), EAgentSlotFault::TooMany)); }
		// The same agentId twice: neither entry can be trusted to be "the" agent.
		for (std::size_t I = 0; I < Out.size(); ++I)
		{
			const std::string Id = Out[I].Descriptor.AgentId;
			if (Id.empty()) { continue; }
			bool bDup = false;
			for (std::size_t J = 0; J < Out.size(); ++J)
			{
				if (J != I && Out[J].Descriptor.AgentId == Id) { bDup = true; }
			}
			if (bDup) { Out[I] = FaultSlot(Id, EAgentSlotFault::DuplicateAgentId); }
		}
		return EAgentListParse::Ok;
	}

	/* ---------------------------------------------------------------- the session: an agent registry */

	namespace
	{
		constexpr const char* LineConnect = "Connect your agent";
		constexpr const char* LineRejected = "Your key was rejected";
		constexpr const char* LineOutOfCredit = "Your provider account is out of credit";
		constexpr const char* LineRetryLater = "Retry later";
		constexpr const char* LineSlowDown = "Slow down";
		constexpr const char* LineRefused = "The provider refused this message";
		constexpr const char* LineCutOff = "The reply was cut off; resend to get it";
		constexpr const char* LineError = "Companion error";
		constexpr const char* LineTooLong = "Message too long";
		constexpr const char* LineNotLoopback = "Companion relay must be on this machine";
		constexpr const char* LineConnecting = "Connecting";
		constexpr const char* LineConnFailed = "Could not connect the agent";
		constexpr const char* LineConnError = "Connection error; reconnect your agent";
		constexpr const char* LineUnsupported = "This agent is not supported yet";
		constexpr const char* LineNotAuthorized = "This agent has not authorized chat";
		constexpr const char* LineChatNotServed = "Chat with agents is not available on this relay yet";
		constexpr const char* LineNoProject = "Companion needs a paired project";
		constexpr const char* LineUnreadable = "Agent details could not be read";
		constexpr const char* LineIdentityChanged = "Agent identity changed; this agent is not used";
		constexpr const char* LineLengthLimit = "The reply reached the length limit";
		constexpr const char* LineNoRandom = "Secure random unavailable; try again";
		constexpr std::size_t TraceMaxLines = 256;

		const char* ConnectionWord(EAgentConnection C)
		{
			switch (C)
			{
			case EAgentConnection::Connected: return "connected";
			case EAgentConnection::Disconnected: return "disconnected";
			case EAgentConnection::Unsupported: return "unsupported";
			case EAgentConnection::Error: return "error";
			}
			return "error";
		}
	}

	FCompanionSession::FCompanionSession(std::string RelayOrigin, std::string ProjectId, bool bChatRouteServed)
		: Origin(std::move(RelayOrigin)), bOriginOk(IsLoopbackRelayOrigin(Origin)), Project(std::move(ProjectId)),
		  bProjectOk(IsQuerySafeProjectId(Project)), bChatServed(bChatRouteServed)
	{
		RecomputeSession();
	}

	std::string FCompanionSession::Url(std::string_view Path) const
	{
		std::string Out = Origin;
		Out += RelayBasePath;
		Out += Path;
		return Out;
	}

	std::string FCompanionSession::AgentUrl(const FAgent& A, std::string_view Suffix) const
	{
		// The provider never appears in a URL: only the agentId (IsAgentId: agt_ + UUID, path-segment safe).
		std::string Out = Url(AgentsPath);
		Out += '/';
		Out += A.Descriptor.AgentId;
		Out += Suffix;
		Out += "?projectId="; // the dispatch guard needs it on every route (admission-route.ts:288)
		Out += Project;
		return Out;
	}

	void FCompanionSession::Note(std::string Word)
	{
		if (TraceLines.size() >= TraceMaxLines) { TraceLines.erase(TraceLines.begin()); }
		TraceLines.push_back(std::move(Word));
	}

	void FCompanionSession::SetError(FAgent& A, const char* Line, const char* TraceWord)
	{
		A.Transient = ECompanionState::Error;
		A.TransientLine = Line;
		Note(TraceWord);
	}

	FCompanionSession::FAgent* FCompanionSession::Find(std::string_view AgentId)
	{
		for (const std::unique_ptr<FAgent>& A : Agents)
		{
			if (!AgentId.empty() && A->Descriptor.AgentId == AgentId) { return A.get(); }
		}
		return nullptr;
	}

	const FCompanionSession::FAgent* FCompanionSession::Find(std::string_view AgentId) const
	{
		for (const std::unique_ptr<FAgent>& A : Agents)
		{
			if (!AgentId.empty() && A->Descriptor.AgentId == AgentId) { return A.get(); }
		}
		return nullptr;
	}

	FCompanionSession::FAgent* FCompanionSession::FindOrAdd(const std::string& AgentId)
	{
		if (FAgent* Known = Find(AgentId)) { return Known; }
		if (Agents.size() >= AgentRegistryMaxSlots) { return nullptr; }
		Agents.push_back(std::make_unique<FAgent>());
		Agents.back()->Descriptor.AgentId = AgentId;
		return Agents.back().get();
	}

	bool FCompanionSession::ApplySlot(FAgent& A, const FAgentSlot& Slot)
	{
		if (Slot.Fault != EAgentSlotFault::None)
		{
			// Fail closed for THIS agent only: no capabilities, no chat. Its identity (providerId) is kept.
			A.Fault = Slot.Fault;
			A.Descriptor.DeclaredCapabilities.clear();
			A.Descriptor.AuthorizedCapabilities.clear();
			A.Descriptor.Connection = EAgentConnection::Error;
			Note(std::string("agent_slot_") + AgentSlotFaultName(Slot.Fault));
			return true;
		}
		if (!A.Descriptor.ProviderId.empty() && Slot.Descriptor.ProviderId != A.Descriptor.ProviderId)
		{
			A.bIdentityChanged = true; // the same agentId now claims another provider: never the player's agent
			Note("agent_identity_changed");
			return false;
		}
		A.Fault = EAgentSlotFault::None;
		A.Descriptor = Slot.Descriptor;
		Note(std::string("agent_") + ConnectionWord(Slot.Descriptor.Connection));
		return true;
	}

	void FCompanionSession::ApplyAgentSlots(const std::vector<FAgentSlot>& Slots)
	{
		UnreadableSlots = 0;
		for (const FAgentSlot& Slot : Slots)
		{
			if (Slot.Descriptor.AgentId.empty())
			{
				++UnreadableSlots;
				Note(std::string("agent_slot_unreadable_") + AgentSlotFaultName(Slot.Fault));
				continue;
			}
			FAgent* A = FindOrAdd(Slot.Descriptor.AgentId);
			if (A == nullptr)
			{
				++UnreadableSlots;
				Note("agent_registry_full");
				continue;
			}
			ApplySlot(*A, Slot);
			Recompute(*A);
		}
		RecomputeSession();
	}

	std::vector<std::string> FCompanionSession::AgentIds() const
	{
		std::vector<std::string> Out;
		for (const std::unique_ptr<FAgent>& A : Agents) { Out.push_back(A->Descriptor.AgentId); }
		return Out;
	}

	const FAgentView* FCompanionSession::View(std::string_view AgentId) const
	{
		const FAgent* A = Find(AgentId);
		return A != nullptr ? &A->View : nullptr;
	}

	std::string FCompanionSession::ProviderIdOf(std::string_view AgentId) const
	{
		const FAgent* A = Find(AgentId);
		return A != nullptr ? A->Descriptor.ProviderId : std::string();
	}

	const FTurnHistory* FCompanionSession::History(std::string_view AgentId) const
	{
		const FAgent* A = Find(AgentId);
		return A != nullptr ? &A->Turns : nullptr;
	}

	std::string FCompanionSession::ConversationId(std::string_view AgentId) const
	{
		const FAgent* A = Find(AgentId);
		return A != nullptr ? A->ConvId : std::string();
	}

	bool FCompanionSession::BeginConnect(std::string_view ProviderId, std::string_view WljRunId, std::string_view DisplayLabel, FRelayRequest& Out)
	{
		Out = FRelayRequest();
		const bool bRunOk = WljRunId.empty() || WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId);
		const bool bLabelOk = DisplayLabel.empty() || IsAgentDisplayName(DisplayLabel);
		if (!bOriginOk || !bProjectOk || bConnecting || !IsProviderId(ProviderId) || !bRunOk || !bLabelOk)
		{
			Note("connect_refused");
			RecomputeSession();
			return false;
		}
		// route.ts:288-311, contract:113-125: {providerId[, wljRunId][, displayName]}. No credential field of any kind:
		// the route refuses apiKey / token / password at any depth (route.ts:58,367-375) and nothing else carries a key.
		// No idempotency key: the route reads none and every POST mints a new slot (registry.ts:246); never resent.
		std::string Body = "{\"providerId\":";
		AppendJsonString(Body, ProviderId);
		if (!WljRunId.empty())
		{
			Body += ",\"wljRunId\":";
			AppendJsonString(Body, WljRunId);
		}
		if (!DisplayLabel.empty())
		{
			Body += ",\"displayName\":";
			AppendJsonString(Body, DisplayLabel);
		}
		Body += "}";
		Out.Method = "POST";
		Out.Url = Url(AgentsPath) + "?projectId=" + Project;
		Out.Body = std::move(Body);
		bConnecting = true;
		ConnectingProviderId.assign(ProviderId);
		Notice = nullptr;
		Note("connect_begin");
		RecomputeSession();
		return true;
	}

	namespace
	{
		bool EqualsAsciiNoCase(std::string_view A, std::string_view B)
		{
			if (A.size() != B.size()) { return false; }
			for (std::size_t I = 0; I < A.size(); ++I)
			{
				const char X = (A[I] >= 'A' && A[I] <= 'Z') ? static_cast<char>(A[I] + 32) : A[I];
				if (X != B[I]) { return false; }
			}
			return true;
		}

		// BRIDGE's containsCredentialField (route.ts:58,367-375): /^(apikey|token|password)$/i at any depth, plus the
		// client's own key / hint / last-4 words (contract 1.2). The names are lower case; the match folds ASCII case.
		bool HasCredentialKey(const FJsonValue& Value)
		{
			static constexpr std::string_view Forbidden[] = {"apikey", "token", "password", "key", "keyhint", "last4", "apikeylast4", "hint", "secret"};
			for (const FJsonValue& Item : Value.Items)
			{
				if (HasCredentialKey(Item)) { return true; }
			}
			for (const std::pair<std::string, FJsonValue>& Member : Value.Members)
			{
				for (const std::string_view Name : Forbidden)
				{
					if (EqualsAsciiNoCase(Member.first, Name)) { return true; }
				}
				if (HasCredentialKey(Member.second)) { return true; }
			}
			return false;
		}

		// One AgentDescriptor answer body (connect 201, GET 200, DELETE 200). Not JSON, not an object, too large, or
		// carrying a key / hint / credential name anywhere: a NotObject slot with no agentId.
		FAgentSlot DescriptorFromBody(std::string_view Body)
		{
			FJsonValue Root;
			if (Body.size() > ListMaxBodyBytes || !ParseJson(Body, Root) || !Root.IsObject()) { return FaultSlot(std::string(), EAgentSlotFault::NotObject); }
			if (HasCredentialKey(Root)) { return FaultSlot(std::string(), EAgentSlotFault::NotObject); }
			return ParseAgentDescriptor(Root);
		}

		// An answer to a per-agent route must describe THAT agent; anything else is a fault slot for it.
		FAgentSlot ForAgent(const FAgentSlot& Slot, const std::string& AgentId)
		{
			if (Slot.Descriptor.AgentId == AgentId) { return Slot; }
			return FaultSlot(AgentId, Slot.Fault == EAgentSlotFault::None ? EAgentSlotFault::BadAgentId : Slot.Fault);
		}
	}

	void FCompanionSession::ApplyConnectAnswer(int HttpStatus, std::string_view Body, std::uint64_t NowMs)
	{
		(void)NowMs;
		if (!bConnecting) { Note("connect_answer_unexpected"); return; }
		bConnecting = false;
		const std::string Requested = std::move(ConnectingProviderId);
		ConnectingProviderId.clear();
		if (HttpStatus == 201) // route.ts:319: 201 and one AgentDescriptor; nothing else is a success
		{
			const FAgentSlot Slot = DescriptorFromBody(Body);
			if (Slot.Fault != EAgentSlotFault::None)
			{
				Notice = LineConnFailed;
				Note("connect_answer_refused");
				RecomputeSession();
				return;
			}
			if (Slot.Descriptor.ProviderId != Requested)
			{
				Notice = LineConnFailed; // the server answered for another provider; never shown as the player's agent
				Note("connect_answer_provider_mismatch");
				RecomputeSession();
				return;
			}
			FAgent* A = FindOrAdd(Slot.Descriptor.AgentId);
			if (A == nullptr)
			{
				Notice = LineConnFailed;
				Note("agent_registry_full");
				RecomputeSession();
				return;
			}
			if (!ApplySlot(*A, Slot))
			{
				Notice = LineConnFailed;
				Recompute(*A);
				RecomputeSession();
				return;
			}
			LastConnected = A->Descriptor.AgentId;
			switch (Slot.Descriptor.Connection)
			{
			case EAgentConnection::Connected:
				A->bKeyRejected = false; // Q12: the only place an agent's sticky rejection is cleared
				A->Transient = ECompanionState::Ready;
				A->TransientLine = nullptr;
				A->Refusal.clear();
				Notice = nullptr;
				Note("connect_ok");
				break;
			case EAgentConnection::Unsupported:
				Notice = LineUnsupported; // an unknown provider is an unsupported slot, never a fault
				Note("connect_unsupported");
				break;
			case EAgentConnection::Disconnected:
			case EAgentConnection::Error:
				Notice = LineConnFailed;
				Note("connect_not_connected");
				break;
			}
			Recompute(*A);
			RecomputeSession();
			return;
		}
		// 503: julius_dispatch_unavailable / _disabled / _not_configured (route.ts:315; admission-route.ts:262-281).
		// Everything else (400 companion_request_invalid / companion_credentials_rejected / julius_dispatch_run_invalid,
		// 401 sign_in_required, 403 guard kinds, 405) leaves every agent as it was.
		Notice = HttpStatus == 503 ? LineRetryLater : LineConnFailed;
		Note("connect_failed");
		RecomputeSession();
	}

	FRelayRequest FCompanionSession::BeginReadAgent(std::string_view AgentId)
	{
		FRelayRequest Out;
		const FAgent* A = Find(AgentId);
		if (!bOriginOk || !bProjectOk || A == nullptr)
		{
			Note("agent_read_refused");
			return Out;
		}
		Out.Method = "GET"; // route.ts:325-337
		Out.Url = AgentUrl(*A, std::string_view());
		Note("agent_read_begin");
		return Out;
	}

	void FCompanionSession::ApplyReadAgentAnswer(std::string_view AgentId, int HttpStatus, std::string_view Body)
	{
		FAgent* A = Find(AgentId);
		if (A == nullptr) { Note("agent_read_unexpected"); return; }
		if (HttpStatus == 200) { ApplySlot(*A, ForAgent(DescriptorFromBody(Body), A->Descriptor.AgentId)); }
		else if (HttpStatus == 404) // route.ts:269,330: no such slot here
		{
			ForceDisconnected(*A);
			Note("agent_read_not_found");
		}
		else { Note("agent_read_failed"); }
		Recompute(*A);
		RecomputeSession();
	}

	void FCompanionSession::ForceDisconnected(FAgent& A)
	{
		A.Descriptor.Connection = EAgentConnection::Disconnected; // Q12: bKeyRejected stays
		A.Descriptor.AuthorizedCapabilities.clear();
		A.Transient = ECompanionState::Ready;
		A.TransientLine = nullptr;
		A.Refusal.clear();
		A.bResendAllowed = false;
	}

	FRelayRequest FCompanionSession::BeginDisconnect(std::string_view AgentId)
	{
		FRelayRequest Out;
		const FAgent* A = Find(AgentId);
		if (!bOriginOk || !bProjectOk || A == nullptr || A->bStreaming)
		{
			Note("disconnect_refused");
			return Out;
		}
		Out.Method = "DELETE"; // Q13: no idempotency key, no body
		Out.Url = AgentUrl(*A, std::string_view());
		Note("disconnect_begin");
		return Out;
	}

	void FCompanionSession::ApplyDisconnectAnswer(std::string_view AgentId, int HttpStatus, std::string_view Body)
	{
		FAgent* A = Find(AgentId);
		if (A == nullptr) { Note("disconnect_answer_unexpected"); return; }
		if (HttpStatus == 200) // route.ts:347: 200 + the descriptor, connection "disconnected" for good (registry.ts:233,272-283)
		{
			const FAgentSlot Slot = ForAgent(DescriptorFromBody(Body), A->Descriptor.AgentId);
			const bool bGood = Slot.Fault == EAgentSlotFault::None && Slot.Descriptor.Connection == EAgentConnection::Disconnected && ApplySlot(*A, Slot);
			// The DELETE happened either way: the agent is disconnected; an odd answer is only noted.
			ForceDisconnected(*A);
			Notice = nullptr;
			Note(bGood ? "disconnect_ok" : "disconnect_answer_refused");
		}
		else if (HttpStatus == 404) // route.ts:345: no such slot; nothing to use
		{
			ForceDisconnected(*A);
			Note("disconnect_not_found");
		}
		else
		{
			Note("disconnect_failed");
		}
		Recompute(*A);
		RecomputeSession();
	}

	void FCompanionSession::ApplyKeyMintFailure(std::string_view AgentId)
	{
		Notice = LineNoRandom; // nothing was sent; no fallback key
		Note("key_mint_failed");
		if (FAgent* A = Find(AgentId))
		{
			A->Transient = ECompanionState::Error;
			A->TransientLine = LineNoRandom;
			Recompute(*A);
		}
		RecomputeSession();
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

	bool FCompanionSession::BeginMessage(std::string_view AgentId, std::string_view Message, std::string_view IdempotencyKey,
		std::string_view WljRunId, std::uint64_t NowMs, FRelayRequest& Out)
	{
		Out = FRelayRequest();
		FAgent* A = Find(AgentId);
		const bool bKeyFresh = std::find(UsedKeys.begin(), UsedKeys.end(), IdempotencyKey) == UsedKeys.end();
		const std::size_t Units = Utf16Units(Message);
		const bool bRunOk = WljRunId.empty() || WonderlandJuliusMissionLogic::IsClientMintedRunId(WljRunId);
		if (A == nullptr || !A->View.bCanSend || NowMs < A->RetryNotBefore || !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(IdempotencyKey)
			|| !bKeyFresh || Message.empty() || Units == static_cast<std::size_t>(-1) || Units > ChatMaxMessageUtf16Units || !bRunOk)
		{
			Note("chat_refused");
			return false;
		}
		UsedKeys.emplace_back(IdempotencyKey);
		A->PendingMessage.assign(Message);
		A->PendingKey.assign(IdempotencyKey);
		A->PendingRunId.assign(WljRunId);
		A->PendingConvSent = A->ConvId;
		A->PendingConvSeen.clear();
		A->PendingMsgSeen.clear();
		Notice = nullptr; // Q14: a 422 notice lasts until the next connect or message
		Out.Method = "POST";
		Out.Url = AgentUrl(*A, AgentChatSuffix);
		Out.IdempotencyKey = A->PendingKey;
		Out.Body = BuildChatBody(A->PendingConvSent, A->PendingRunId, A->PendingMessage);
		A->Decoder = FChatStreamDecoder(A->Descriptor.ProviderId, A->PendingConvSent, false);
		A->bStreaming = true;
		A->bResendAllowed = false;
		A->Transient = ECompanionState::Ready;
		A->TransientLine = nullptr;
		A->Refusal.clear();
		Note("chat_begin");
		Recompute(*A);
		RecomputeSession();
		return true;
	}

	bool FCompanionSession::BeginResend(std::string_view AgentId, std::uint64_t NowMs, FRelayRequest& Out)
	{
		Out = FRelayRequest();
		FAgent* A = Find(AgentId);
		if (A == nullptr || !A->bResendAllowed || !CanChat(*A) || A->bStreaming || NowMs < A->RetryNotBefore || A->PendingKey.empty() || !bOriginOk)
		{
			Note("resend_refused");
			return false;
		}
		Out.Method = "POST";
		Out.Url = AgentUrl(*A, AgentChatSuffix);
		Out.IdempotencyKey = A->PendingKey; // the SAME key: the server replays a finished reply
		Out.Body = BuildChatBody(A->PendingConvSent, A->PendingRunId, A->PendingMessage);
		// Q1/Q3: the replay must show the cnv_ and msg_ ids an earlier attempt of this key already showed.
		A->Decoder = FChatStreamDecoder(A->Descriptor.ProviderId, A->PendingConvSeen.empty() ? A->PendingConvSent : A->PendingConvSeen, true, A->PendingMsgSeen);
		A->bStreaming = true;
		A->bResendAllowed = false;
		A->Transient = ECompanionState::Ready;
		A->TransientLine = nullptr;
		A->Refusal.clear();
		Note("resend_begin");
		Recompute(*A);
		return true;
	}

	void FCompanionSession::ApplyChatHttpAnswer(std::string_view AgentId, int HttpStatus, std::string_view RetryAfterHeader,
		std::string_view Body, std::uint64_t NowMs)
	{
		FAgent* A = Find(AgentId);
		if (A == nullptr || !A->bStreaming) { Note("chat_answer_unexpected"); return; }
		A->bStreaming = false;
		const std::string Kind = ErrorKindOf(Body);
		if (HttpStatus == 409 && Kind == "companion_not_connected")
		{
			A->Descriptor.Connection = EAgentConnection::Disconnected; // this agent only
			A->Transient = ECompanionState::Ready;
			A->TransientLine = nullptr;
			Note("chat_not_connected");
		}
		else if (HttpStatus == 409 && Kind == "companion_message_in_progress")
		{
			A->Transient = ECompanionState::RetryLater;
			A->TransientLine = LineRetryLater;
			A->bResendAllowed = true;
			A->RetryNotBefore = NowMs + ChatInProgressBackoffMs; // Q4: back off 2 s, then the SAME key
			Note("chat_in_progress");
		}
		else if (HttpStatus == 429 && Kind == "companion_rate_limited")
		{
			std::uint64_t WaitMs = 0;
			if (!ParseRetryAfterSeconds(RetryAfterHeader, WaitMs)) { WaitMs = DefaultRetryWaitMs; }
			A->Transient = ECompanionState::SlowDown;
			A->TransientLine = LineSlowDown;
			A->RetryNotBefore = NowMs + WaitMs;
			Note("chat_slow_down");
		}
		else if (HttpStatus == 503)
		{
			A->Transient = ECompanionState::RetryLater;
			A->TransientLine = LineRetryLater;
			A->bResendAllowed = true;
			Note("chat_unavailable");
		}
		else if (HttpStatus == 413) { SetError(*A, LineTooLong, "chat_too_large"); } // Q6: companion_message_too_large
		else if (HttpStatus == 400) { SetError(*A, LineError, "chat_body_invalid"); } // Q6: companion_body_invalid
		else { SetError(*A, LineError, "chat_http_error"); }
		Recompute(*A);
		RecomputeSession();
	}

	void FCompanionSession::FeedChatBytes(std::string_view AgentId, std::string_view Chunk, std::uint64_t NowMs)
	{
		FAgent* A = Find(AgentId);
		if (A == nullptr || !A->bStreaming) { return; }
		if (A->Decoder.Feed(Chunk) != EChatStreamOutcome::Open)
		{
			ApplyStreamOutcome(*A, NowMs);
			return;
		}
		Recompute(*A);
	}

	void FCompanionSession::FinishChatStream(std::string_view AgentId, std::uint64_t NowMs)
	{
		FAgent* A = Find(AgentId);
		if (A == nullptr || !A->bStreaming) { return; }
		A->Decoder.Finish();
		ApplyStreamOutcome(*A, NowMs);
	}

	void FCompanionSession::ApplyChatTransportFailure(std::string_view AgentId, std::uint64_t NowMs)
	{
		(void)NowMs;
		FAgent* A = Find(AgentId);
		if (A == nullptr || !A->bStreaming) { return; }
		A->bStreaming = false;
		A->Transient = ECompanionState::RetryLater;
		A->TransientLine = LineRetryLater;
		A->bResendAllowed = true;
		Note("chat_transport_failed");
		Recompute(*A);
	}

	void FCompanionSession::ApplyStreamOutcome(FAgent& A, std::uint64_t NowMs)
	{
		const FChatStreamDecoder& Decoder = A.Decoder;
		A.bStreaming = false;
		if (Decoder.HasMeta())
		{
			A.ConvId = Decoder.ConversationId();
			A.PendingConvSeen = Decoder.ConversationId();
			A.PendingMsgSeen = Decoder.MessageId();
		}
		switch (Decoder.Outcome())
		{
		case EChatStreamOutcome::Done:
		{
			FTurn Turn;
			Turn.PlayerText = SanitizeUntrustedText(A.PendingMessage);
			Turn.ReplyText = Decoder.ReplyForDisplay();
			Turn.MessageId = Decoder.MessageId();
			Turn.Model = Decoder.Model();
			Turn.FinishReason = Decoder.FinishReason();
			Turn.bHitLengthLimit = Decoder.HitLengthLimit();
			A.Turns.Add(std::move(Turn));
			A.Transient = ECompanionState::Ready;
			A.TransientLine = Decoder.HitLengthLimit() ? LineLengthLimit : nullptr; // Q5
			A.bResendAllowed = false;
			Note(Decoder.HitLengthLimit() ? "chat_done_max_length" : "chat_done");
			break;
		}
		case EChatStreamOutcome::ProviderError:
			A.bResendAllowed = false;
			switch (Decoder.ErrorKind())
			{
			case EChatErrorKind::ProviderAuthFailed:
				A.bKeyRejected = true; // sticky (Q12), this agent only
				A.Transient = ECompanionState::Ready;
				A.TransientLine = nullptr;
				Note("chat_key_rejected");
				break;
			case EChatErrorKind::ProviderQuotaExhausted:
				A.Transient = ECompanionState::OutOfCredit;
				A.TransientLine = LineOutOfCredit;
				Note("chat_out_of_credit");
				break;
			case EChatErrorKind::ProviderRateLimited:
				A.Transient = ECompanionState::RetryLater;
				A.TransientLine = LineRetryLater;
				A.RetryNotBefore = NowMs + (Decoder.HasRetryAfter() ? Decoder.RetryAfterMs() : DefaultRetryWaitMs); // Q8
				Note("chat_provider_rate_limited");
				break;
			case EChatErrorKind::ProviderUnavailable:
				A.Transient = ECompanionState::RetryLater;
				A.TransientLine = LineRetryLater;
				Note("chat_provider_unavailable");
				break;
			case EChatErrorKind::ProviderRefused:
				A.Transient = ECompanionState::Refused;
				A.TransientLine = LineRefused;
				A.Refusal = Decoder.ErrorMessage();
				Note("chat_provider_refused");
				break;
			case EChatErrorKind::CompanionInternal:
			case EChatErrorKind::Unknown:
			case EChatErrorKind::None:
				SetError(A, LineError, "chat_error_event");
				break;
			}
			break;
		case EChatStreamOutcome::ProtocolError:
			SetError(A, LineCutOff, "chat_protocol_fault");
			Note(std::string("chat_fault_") + ChatProtocolFaultName(Decoder.Fault()));
			A.bResendAllowed = true;
			break;
		case EChatStreamOutcome::Open:
			break;
		}
		Recompute(A);
		RecomputeSession();
	}

	FRelayRequest FCompanionSession::BeginDeleteHistory(std::string_view AgentId)
	{
		FRelayRequest Out;
		FAgent* A = Find(AgentId);
		if (A == nullptr || A->bStreaming)
		{
			Note("delete_history_refused");
			return Out;
		}
		A->Turns.Clear();
		A->PendingMessage.clear();
		A->PendingKey.clear();
		A->PendingRunId.clear();
		A->PendingConvSent.clear();
		A->PendingConvSeen.clear();
		A->PendingMsgSeen.clear();
		A->bResendAllowed = false;
		if (!A->ConvId.empty())
		{
			A->DeletePendingConv = A->ConvId;
			A->ConvId.clear();
		}
		if (!A->DeletePendingConv.empty() && bOriginOk)
		{
			Out.Method = "DELETE";
			Out.Url = AgentUrl(*A, std::string(AgentConversationsSuffix) + A->DeletePendingConv);
		}
		Note("delete_history_local");
		Recompute(*A);
		return Out;
	}

	void FCompanionSession::ApplyDeleteHistoryAnswer(std::string_view AgentId, int HttpStatus)
	{
		FAgent* A = Find(AgentId);
		if (A == nullptr) { Note("delete_history_unexpected"); return; }
		if (HttpStatus == 204 || HttpStatus == 404) // Q7: a 409 (stream still active) stays pending and is resent
		{
			A->DeletePendingConv.clear();
			Note("delete_history_ok");
		}
		else
		{
			Note("delete_history_pending");
		}
	}

	bool FCompanionSession::IsReal(const FAgent& A) const
	{
		return A.Fault == EAgentSlotFault::None && !A.bIdentityChanged && A.Descriptor.Connection == EAgentConnection::Connected && !A.bKeyRejected;
	}

	bool FCompanionSession::IsChatAuthorized(const FAgent& A) const
	{
		// No inference: a connected agent chats only if the server authorized the chat capability.
		return IsReal(A) && HasCapability(A.Descriptor.AuthorizedCapabilities, CapabilityChat);
	}

	bool FCompanionSession::CanChat(const FAgent& A) const
	{
		// And only on a relay that serves the chat route at all (none at 7e5e1e30: contract:46,139).
		return bChatServed && bProjectOk && IsChatAuthorized(A);
	}

	void FCompanionSession::Recompute(FAgent& A)
	{
		FAgentView V;
		const bool bReadable = A.Fault == EAgentSlotFault::None && !A.bIdentityChanged;
		const bool bReal = IsReal(A);
		V.AgentId = A.Descriptor.AgentId;
		V.DisplayName = bReadable ? A.Descriptor.DisplayName : std::string();
		V.Kind = bReadable ? A.Descriptor.Kind : EAgentKind::Unknown;
		V.AdapterVersion = bReadable ? A.Descriptor.AdapterVersion : std::string();
		V.Connection = bReadable ? A.Descriptor.Connection : EAgentConnection::Error;
		V.bMalformed = !bReadable;
		// Only authorized capabilities, only while really connected. Declared ones are never shown.
		V.AuthorizedCapabilities = bReal ? A.Descriptor.AuthorizedCapabilities : std::vector<std::string>();
		V.bVerified = false; // no descriptor carries "verified" (registry.ts:28-37); a key that claims it faults the slot
		V.bShowSimulatedBanner = !bReal;
		V.RetryNotBeforeMs = A.RetryNotBefore;
		const auto Offline = [&](EOfflineReason Why, const char* Line, bool bCanConnect) {
			V.State = ECompanionState::Offline;
			V.Offline = Why;
			V.StatusLine = Line;
			V.bCanConnect = bCanConnect;
		};
		const auto Errored = [&](const char* Line, bool bCanConnect) {
			V.State = ECompanionState::Error;
			V.Offline = EOfflineReason::None;
			V.StatusLine = Line;
			V.bCanConnect = bCanConnect;
		};
		if (!bOriginOk) { Offline(EOfflineReason::RelayNotLoopback, LineNotLoopback, false); }
		else if (!bProjectOk) { Offline(EOfflineReason::NoProject, LineNoProject, false); }
		else if (A.bIdentityChanged) { Errored(LineIdentityChanged, false); } // permanent for this session: reconnecting cannot clear it
		else if (A.Fault != EAgentSlotFault::None) { Errored(LineUnreadable, false); }
		else if (A.Descriptor.Connection == EAgentConnection::Unsupported) { Offline(EOfflineReason::Unsupported, LineUnsupported, false); }
		else if (A.bKeyRejected) { Offline(EOfflineReason::KeyRejected, LineRejected, true); }
		else if (A.Descriptor.Connection == EAgentConnection::Error) { Errored(LineConnError, true); }
		else if (!bReal) { Offline(EOfflineReason::NotConnected, LineConnect, true); }
		else if (!IsChatAuthorized(A)) { Offline(EOfflineReason::NotAuthorized, LineNotAuthorized, true); }
		else if (!CanChat(A)) { Offline(EOfflineReason::ChatNotServed, LineChatNotServed, false); }
		else if (A.bStreaming)
		{
			V.State = ECompanionState::Streaming;
			V.Offline = EOfflineReason::None;
			V.PartialReply = A.Decoder.ReplyForDisplay();
		}
		else
		{
			V.State = A.Transient;
			V.Offline = EOfflineReason::None;
			V.StatusLine = A.TransientLine != nullptr ? A.TransientLine : "";
			V.RefusalText = A.Transient == ECompanionState::Refused ? A.Refusal : std::string();
			V.bCanConnect = true;
			V.bCanSend = true;
			V.bCanResend = A.bResendAllowed && !A.PendingKey.empty();
		}
		A.View = std::move(V);
	}

	void FCompanionSession::RecomputeSession()
	{
		FCompanionSessionView S;
		S.bOriginOk = bOriginOk;
		S.bProjectOk = bProjectOk;
		S.bConnecting = bConnecting;
		S.bCanConnect = bOriginOk && bProjectOk && !bConnecting;
		if (!bOriginOk) { S.StatusLine = LineNotLoopback; }
		else if (!bProjectOk) { S.StatusLine = LineNoProject; }
		else if (bConnecting) { S.StatusLine = LineConnecting; }
		else if (Notice != nullptr) { S.StatusLine = Notice; }
		S.AgentCount = Agents.size();
		S.UnreadableSlots = UnreadableSlots;
		for (const std::unique_ptr<FAgent>& A : Agents)
		{
			if (IsReal(*A)) { S.bShowSimulatedBanner = false; }
		}
		SessionViewState = std::move(S);
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

	/* ---------------------------------------------------------------- agent result and provenance */

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

	EResultParse ParseAgentResult(std::string_view Body, std::string_view OwnWljRunId, FAgentResultView& Out)
	{
		Out = FAgentResultView();
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
		EProvenanceParse ParseProvenanceObject(const FJsonValue& Root, FAgentProvenanceView& Out)
		{
			Out = FAgentProvenanceView();
			if (!Root.IsObject()) { return EProvenanceParse::BadJson; }
			const FJsonValue* Source = FindString(Root, "source");
			// A8: BRIDGE's closed set (route.ts:108): "companion_port" or "simulated". No provider is ever a source.
			if (Source == nullptr || (Source->Text != "simulated" && Source->Text != "companion_port")) { return EProvenanceParse::BadSource; }
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

		// The mission route's provenance (route.ts:107-112, provenanceOf 593-611). Every key is required; verified /
		// verifiedBy refused; nothing in it is a verification.
		bool ParseMissionProvenance(const FJsonValue& P, FAgentProvenanceView& Out)
		{
			Out = FAgentProvenanceView();
			if (!P.IsObject()) { return false; }
			const FJsonValue* Source = FindString(P, "source");
			if (Source == nullptr || (Source->Text != "companion_port" && Source->Text != "simulated")) { return false; }
			const FJsonValue* Wake = P.Find("wakeId");
			if (Wake == nullptr || !(Wake->IsNull() || (Wake->IsString() && Wake->Text.size() <= ProvenanceWakeIdMaxBytes))) { return false; }
			const FJsonValue* Digest = P.Find("bodyDigest");
			if (Digest == nullptr || !(Digest->IsNull() || (Digest->IsString() && WonderlandJuliusMissionLogic::IsLowerHex64(Digest->Text)))) { return false; }
			const FJsonValue* Content = FindString(P, "contentSha256");
			if (Content == nullptr || !WonderlandJuliusMissionLogic::IsLowerHex64(Content->Text)) { return false; }
			if (P.Find("verified") != nullptr || P.Find("verifiedBy") != nullptr) { return false; }
			Out.bSimulated = Source->Text == "simulated";
			Out.ResultSha256 = Content->Text;
			Out.WakeId = Wake->IsNull() ? std::string() : SanitizeUntrustedText(Wake->Text);
			Out.BodyDigest = Digest->IsNull() ? std::string() : Digest->Text;
			return true;
		}
	}

	EProvenanceParse ParseAgentProvenance(std::string_view Body, FAgentProvenanceView& Out)
	{
		Out = FAgentProvenanceView();
		if (Body.size() > ListMaxBodyBytes) { return EProvenanceParse::TooLarge; }
		FJsonValue Root;
		if (!ParseJson(Body, Root) || !Root.IsObject()) { return EProvenanceParse::BadJson; }
		return ParseProvenanceObject(Root, Out);
	}

	/* ---------------------------------------------------------------- mission companion read route (contract v0.1 3.7 + v0.2 agents[]) */

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
		case ECompanionMissionParse::BadVerified: return "bad_verified";
		}
		return "?";
	}

	const char* TraceIdParseName(ETraceIdParse Result)
	{
		switch (Result)
		{
		case ETraceIdParse::Absent: return "absent";
		case ETraceIdParse::Null: return "null";
		case ETraceIdParse::Ok: return "ok";
		case ETraceIdParse::Malformed: return "malformed";
		}
		return "?";
	}

	bool IsMissionTraceId(std::string_view Text)
	{
		if (Text.size() != 32) { return false; } // TRACE_LENGTH_EXACT
		bool bNonZero = false;
		for (const char C : Text)
		{
			const bool bHex = (C >= '0' && C <= '9') || (C >= 'a' && C <= 'f'); // TRACE_LOWER_HEX_ONLY
			if (!bHex) { return false; }
			if (C != '0') { bNonZero = true; }
		}
		return bNonZero; // TRACE_ALL_ZERO_IS_INVALID
	}

	ETraceIdParse ParseMissionTraceId(const FJsonValue& Root, std::string& Out)
	{
		Out.clear();
		const FJsonValue* Trace = Root.Find("traceId");
		if (Trace == nullptr) { return ETraceIdParse::Absent; }
		if (Trace->IsNull()) { return ETraceIdParse::Null; }
		if (!Trace->IsString() || !IsMissionTraceId(Trace->Text)) { return ETraceIdParse::Malformed; }
		Out = Trace->Text;
		return ETraceIdParse::Ok;
	}

	bool SameMissionTrace(const FCompanionMissionView& Companion, std::string_view ResultTraceId)
	{
		if (!Companion.bHasAnswer || Companion.TraceIdParse != ETraceIdParse::Ok) { return false; }
		if (!IsMissionTraceId(Companion.TraceId) || !IsMissionTraceId(ResultTraceId)) { return false; }
		return Companion.TraceId == ResultTraceId;
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

		// v0.2 agents[]: read per slot, fail closed per slot, before (and independent of) the v0.1 checks below.
		Out.AgentsParse = ParseAgentList(Root, Out.Agents);

		// route.ts:249: verified is the literal false, whatever the row says. Absent or anything else: not this route.
		const FJsonValue* Verified = Root.Find("verified");
		if (Verified == nullptr || Verified->Kind != FJsonValue::EKind::Bool || Verified->bBool) { return ECompanionMissionParse::BadVerified; }

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
		FAgentProvenanceView ProvenanceView;
		if (bHasProvenance && !ParseMissionProvenance(*Provenance, ProvenanceView)) { return ECompanionMissionParse::BadProvenance; }

		// v0.1 3.7: result and provenance stay null until result_received.
		const bool bResultAllowed = State == ECompanionTaskState::ResultReceived || State == ECompanionTaskState::Integrated
			|| State == ECompanionTaskState::Rejected;
		if ((bHasResult || bHasProvenance) && !bResultAllowed) { return ECompanionMissionParse::ResultTooEarly; }
		// route.ts:246: provenance only alongside a result; route.ts:603: it names the artifact's own sha256.
		if (bHasProvenance && (!bHasResult || ProvenanceView.ResultSha256 != Sha)) { return ECompanionMissionParse::BadProvenance; }

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
		Out.bShowVerified = false; // route.ts:249: never verified
		Out.UpdatedAtMs = UpdatedAt;
		// #447: parsed, never computed. Only a body that passed every check above exposes one.
		Out.TraceIdParse = ParseMissionTraceId(Root, Out.TraceId);
		return ECompanionMissionParse::Ok;
	}
}

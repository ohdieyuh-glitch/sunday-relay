// WONDERLAND -- J1 client wrapper, pure logic. No Unreal, no network, no provider.
#include "WonderlandJuliusMissionClient.h"

#include <cstring>
#include <limits>

namespace WonderlandJuliusMissionClient
{
	namespace
	{
		constexpr int JsonDepthLimit = 8;

		struct FJson
		{
			enum class EKind : std::uint8_t { Null, Bool, Number, String, Object, Array };
			EKind Kind = EKind::Null;
			bool BoolValue = false;
			std::string NumberToken;
			std::string StringValue;
			std::vector<std::pair<std::string, FJson>> ObjectValue;

			const FJson* Find(std::string_view Key) const
			{
				for (const std::pair<std::string, FJson>& Field : ObjectValue)
				{
					if (Field.first == Key) { return &Field.second; }
				}
				return nullptr;
			}
		};

		void AppendUtf8(std::string& Out, char32_t CodePoint)
		{
			if (CodePoint > 0x10FFFF) { CodePoint = 0xFFFD; }
			if (CodePoint < 0x80)
			{
				Out.push_back(static_cast<char>(CodePoint));
			}
			else if (CodePoint < 0x800)
			{
				Out.push_back(static_cast<char>(0xC0 | (CodePoint >> 6)));
				Out.push_back(static_cast<char>(0x80 | (CodePoint & 0x3F)));
			}
			else if (CodePoint < 0x10000)
			{
				Out.push_back(static_cast<char>(0xE0 | (CodePoint >> 12)));
				Out.push_back(static_cast<char>(0x80 | ((CodePoint >> 6) & 0x3F)));
				Out.push_back(static_cast<char>(0x80 | (CodePoint & 0x3F)));
			}
			else
			{
				Out.push_back(static_cast<char>(0xF0 | (CodePoint >> 18)));
				Out.push_back(static_cast<char>(0x80 | ((CodePoint >> 12) & 0x3F)));
				Out.push_back(static_cast<char>(0x80 | ((CodePoint >> 6) & 0x3F)));
				Out.push_back(static_cast<char>(0x80 | (CodePoint & 0x3F)));
			}
		}

		class FJsonParser
		{
		public:
			explicit FJsonParser(std::string_view Text) : In(Text) {}

			bool Parse(FJson& Out)
			{
				Skip();
				if (!ParseValue(Out, 0)) { return false; }
				Skip();
				return Ok && Index == In.size();
			}

		private:
			std::string_view In;
			std::size_t Index = 0;
			bool Ok = true;

			void Fail() { Ok = false; }

			void Skip()
			{
				while (Index < In.size())
				{
					const unsigned char C = static_cast<unsigned char>(In[Index]);
					if (C != ' ' && C != '\t' && C != '\n' && C != '\r') { break; }
					++Index;
				}
			}

			bool Consume(char Expected)
			{
				if (Index >= In.size() || In[Index] != Expected) { Fail(); return false; }
				++Index;
				return true;
			}

			int HexNibble(char C) const
			{
				if (C >= '0' && C <= '9') { return C - '0'; }
				if (C >= 'a' && C <= 'f') { return C - 'a' + 10; }
				if (C >= 'A' && C <= 'F') { return C - 'A' + 10; }
				return -1;
			}

			bool ParseHex4(char32_t& Out)
			{
				if (Index + 4 > In.size()) { Fail(); return false; }
				int Value = 0;
				for (int Step = 0; Step < 4; ++Step)
				{
					const int Nibble = HexNibble(In[Index + static_cast<std::size_t>(Step)]);
					if (Nibble < 0) { Fail(); return false; }
					Value = (Value << 4) | Nibble;
				}
				Index += 4;
				Out = static_cast<char32_t>(Value);
				return true;
			}

			bool ParseString(std::string& Out)
			{
				Out.clear();
				if (!Consume('"')) { return false; }
				while (Ok && Index < In.size())
				{
					const unsigned char C = static_cast<unsigned char>(In[Index]);
					if (C == '"') { ++Index; return true; }
					if (C == '\\')
					{
						++Index;
						if (Index >= In.size()) { Fail(); return false; }
						const char Esc = In[Index++];
						switch (Esc)
						{
						case '"': case '\\': case '/': Out.push_back(Esc); break;
						case 'b': Out.push_back('\b'); break;
						case 'f': Out.push_back('\f'); break;
						case 'n': Out.push_back('\n'); break;
						case 'r': Out.push_back('\r'); break;
						case 't': Out.push_back('\t'); break;
						case 'u':
						{
							char32_t Unit = 0;
							if (!ParseHex4(Unit)) { return false; }
							if (Unit >= 0xD800 && Unit <= 0xDBFF)
							{
								const std::size_t Mark = Index;
								if (Index + 2 <= In.size() && In[Index] == '\\' && In[Index + 1] == 'u')
								{
									Index += 2;
									char32_t Low = 0;
									if (!ParseHex4(Low)) { return false; }
									if (Low >= 0xDC00 && Low <= 0xDFFF)
									{
										const char32_t Point = 0x10000 + (((Unit - 0xD800) << 10) | (Low - 0xDC00));
										AppendUtf8(Out, Point);
										break;
									}
								}
								Index = Mark;
								AppendUtf8(Out, 0xFFFD);
								break;
							}
							if (Unit >= 0xDC00 && Unit <= 0xDFFF) { AppendUtf8(Out, 0xFFFD); break; }
							AppendUtf8(Out, Unit);
							break;
						}
						default: Fail(); return false;
						}
						continue;
					}
					if (C < 0x20) { Fail(); return false; }
					Out.push_back(static_cast<char>(C));
					++Index;
				}
				Fail();
				return false;
			}

			bool ParseValue(FJson& Out, int Depth)
			{
				if (!Ok) { return false; }
				if (Depth > JsonDepthLimit) { Fail(); return false; }
				Skip();
				if (Index >= In.size()) { Fail(); return false; }
				const char C = In[Index];
				if (C == '"')
				{
					Out.Kind = FJson::EKind::String;
					return ParseString(Out.StringValue);
				}
				if (C == '{') { return ParseObject(Out, Depth); }
				if (C == '[') { return ParseArray(Depth); }
				if (C == 't') { return ConsumeLiteral("true", Out, true); }
				if (C == 'f') { return ConsumeLiteral("false", Out, false); }
				if (C == 'n')
				{
					if (In.substr(Index, 4) != "null") { Fail(); return false; }
					Index += 4;
					Out.Kind = FJson::EKind::Null;
					return true;
				}
				return ParseNumber(Out);
			}

			bool ConsumeLiteral(const char* Literal, FJson& Out, bool BoolValue)
			{
				const std::size_t Length = std::strlen(Literal);
				if (In.substr(Index, Length) != Literal) { Fail(); return false; }
				Index += Length;
				Out.Kind = FJson::EKind::Bool;
				Out.BoolValue = BoolValue;
				return true;
			}

			bool ParseNumber(FJson& Out)
			{
				const std::size_t Start = Index;
				if (Index < In.size() && In[Index] == '-') { ++Index; }
				if (Index >= In.size() || In[Index] < '0' || In[Index] > '9') { Fail(); return false; }
				if (In[Index] == '0') { ++Index; }
				else { while (Index < In.size() && In[Index] >= '0' && In[Index] <= '9') { ++Index; } }
				if (Index < In.size() && In[Index] == '.')
				{
					++Index;
					if (Index >= In.size() || In[Index] < '0' || In[Index] > '9') { Fail(); return false; }
					while (Index < In.size() && In[Index] >= '0' && In[Index] <= '9') { ++Index; }
				}
				if (Index < In.size() && (In[Index] == 'e' || In[Index] == 'E'))
				{
					++Index;
					if (Index < In.size() && (In[Index] == '+' || In[Index] == '-')) { ++Index; }
					if (Index >= In.size() || In[Index] < '0' || In[Index] > '9') { Fail(); return false; }
					while (Index < In.size() && In[Index] >= '0' && In[Index] <= '9') { ++Index; }
				}
				Out.Kind = FJson::EKind::Number;
				Out.NumberToken.assign(In.data() + Start, Index - Start);
				return true;
			}

			bool ParseObject(FJson& Out, int Depth)
			{
				if (!Consume('{')) { return false; }
				Out.Kind = FJson::EKind::Object;
				Skip();
				if (Index < In.size() && In[Index] == '}') { ++Index; return true; }
				while (Ok)
				{
					Skip();
					std::string Key;
					if (!ParseString(Key)) { return false; }
					Skip();
					if (!Consume(':')) { return false; }
					FJson Child;
					if (!ParseValue(Child, Depth + 1)) { return false; }
					Out.ObjectValue.emplace_back(std::move(Key), std::move(Child));
					Skip();
					if (Index < In.size() && In[Index] == ',') { ++Index; continue; }
					return Consume('}');
				}
				return false;
			}

			bool ParseArray(int Depth)
			{
				if (!Consume('[')) { return false; }
				Skip();
				if (Index < In.size() && In[Index] == ']') { ++Index; return true; }
				while (Ok)
				{
					FJson Ignored;
					if (!ParseValue(Ignored, Depth + 1)) { return false; }
					Skip();
					if (Index < In.size() && In[Index] == ',') { ++Index; continue; }
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

		std::string JsonString(std::string_view Text)
		{
			std::string Out;
			Out.push_back('"');
			for (unsigned char C : Text)
			{
				switch (C)
				{
				case '"': Out += "\\\""; break;
				case '\\': Out += "\\\\"; break;
				case '\n': Out += "\\n"; break;
				case '\r': Out += "\\r"; break;
				case '\t': Out += "\\t"; break;
				default:
					if (C < 0x20)
					{
						constexpr char Hex[] = "0123456789abcdef";
						Out += "\\u00";
						Out.push_back(Hex[C >> 4]);
						Out.push_back(Hex[C & 0x0F]);
					}
					else { Out.push_back(static_cast<char>(C)); }
					break;
				}
			}
			Out.push_back('"');
			return Out;
		}

		std::string JsonStringOrNull(std::string_view Text)
		{
			return Text.empty() ? std::string("null") : JsonString(Text);
		}

		std::string HexOf(const std::uint8_t* Bytes, std::size_t Length)
		{
			constexpr char Hex[] = "0123456789abcdef";
			std::string Out;
			Out.resize(Length * 2);
			for (std::size_t Index = 0; Index < Length; ++Index)
			{
				Out[Index * 2] = Hex[Bytes[Index] >> 4];
				Out[Index * 2 + 1] = Hex[Bytes[Index] & 0x0F];
			}
			return Out;
		}

		bool IsSafeToken(std::string_view Text, std::size_t MaxLen, bool bAllowEmpty)
		{
			if (Text.empty()) { return bAllowEmpty; }
			if (Text.size() > MaxLen) { return false; }
			for (const unsigned char C : Text)
			{
				const bool bOk = (C >= 'A' && C <= 'Z') || (C >= 'a' && C <= 'z') || (C >= '0' && C <= '9')
					|| C == '.' || C == '_' || C == ':' || C == '-';
				if (!bOk) { return false; }
			}
			return true;
		}

		bool IsProjectId(std::string_view Text)
		{
			if (Text.empty() || Text.size() > 128) { return false; }
			const unsigned char First = static_cast<unsigned char>(Text[0]);
			if (!((First >= 'A' && First <= 'Z') || (First >= 'a' && First <= 'z') || (First >= '0' && First <= '9'))) { return false; }
			return IsSafeToken(Text, 128, false);
		}

		std::string PercentEncode(std::string_view Text)
		{
			constexpr char Hex[] = "0123456789ABCDEF";
			std::string Out;
			for (const unsigned char C : Text)
			{
				const bool bPlain = (C >= 'A' && C <= 'Z') || (C >= 'a' && C <= 'z') || (C >= '0' && C <= '9')
					|| C == '-' || C == '_' || C == '.' || C == '~';
				if (bPlain) { Out.push_back(static_cast<char>(C)); }
				else
				{
					Out.push_back('%');
					Out.push_back(Hex[C >> 4]);
					Out.push_back(Hex[C & 0x0F]);
				}
			}
			return Out;
		}

		std::string JoinBase(std::string Base, std::string_view PathAndQuery)
		{
			while (!Base.empty() && Base.back() == '/') { Base.pop_back(); }
			Base.append(PathAndQuery.data(), PathAndQuery.size());
			return Base;
		}

		const char* AnswerToken(WonderlandJuliusMissionLogic::EDispatchAnswer Answer)
		{
			using WonderlandJuliusMissionLogic::EDispatchAnswer;
			switch (Answer)
			{
			case EDispatchAnswer::Accepted: return "Accepted";
			case EDispatchAnswer::Refused: return "Refused";
			case EDispatchAnswer::NoAnswer: return "NoAnswer";
			}
			return "NoAnswer";
		}

		bool ParseU64(std::string_view Text, std::uint64_t& Out)
		{
			if (Text.empty()) { return false; }
			std::uint64_t Value = 0;
			for (const char C : Text)
			{
				if (C < '0' || C > '9') { return false; }
				const std::uint64_t Digit = static_cast<std::uint64_t>(C - '0');
				if (Value > (std::numeric_limits<std::uint64_t>::max() - Digit) / 10) { return false; }
				Value = Value * 10 + Digit;
			}
			Out = Value;
			return true;
		}

		bool ParseU32(std::string_view Text, std::uint32_t& Out)
		{
			std::uint64_t Value = 0;
			if (!ParseU64(Text, Value) || Value > std::numeric_limits<std::uint32_t>::max()) { return false; }
			Out = static_cast<std::uint32_t>(Value);
			return true;
		}

		void Append2(std::string& Out, unsigned Value)
		{
			Out.push_back(static_cast<char>('0' + (Value / 10) % 10));
			Out.push_back(static_cast<char>('0' + Value % 10));
		}

		void CivilFromDays(std::int64_t Z, int& Year, unsigned& Month, unsigned& Day)
		{
			Z += 719468;
			const std::int64_t Era = (Z >= 0 ? Z : Z - 146096) / 146097;
			const unsigned Doe = static_cast<unsigned>(Z - Era * 146097);
			const unsigned Yoe = (Doe - Doe / 1460 + Doe / 36524 - Doe / 146096) / 365;
			Year = static_cast<int>(Yoe) + static_cast<int>(Era * 400);
			const unsigned Doy = Doe - (365 * Yoe + Yoe / 4 - Yoe / 100);
			const unsigned Mp = (5 * Doy + 2) / 153;
			Day = Doy - (153 * Mp + 2) / 5 + 1;
			Month = Mp + (Mp < 10 ? 3 : -9);
			Year += (Month <= 2);
		}

		std::string LowerHost(std::string_view Text)
		{
			std::string Out(Text);
			for (char& C : Out)
			{
				if (C >= 'A' && C <= 'Z') { C = static_cast<char>(C - 'A' + 'a'); }
			}
			return Out;
		}

		bool ParsePort(std::string_view Text)
		{
			if (Text.empty() || Text.size() > 5) { return false; }
			unsigned Value = 0;
			for (const char C : Text)
			{
				if (C < '0' || C > '9') { return false; }
				Value = Value * 10 + static_cast<unsigned>(C - '0');
			}
			return Value >= 1 && Value <= 65535;
		}

		const FJson* Child(const FJson& Object, std::string_view Key)
		{
			return Object.Kind == FJson::EKind::Object ? Object.Find(Key) : nullptr;
		}

		bool StringField(const FJson& Object, std::string_view Key, std::string& Out, bool& bPresent)
		{
			bPresent = false;
			Out.clear();
			const FJson* Field = Child(Object, Key);
			if (Field == nullptr || Field->Kind == FJson::EKind::Null) { return true; }
			if (Field->Kind != FJson::EKind::String) { return false; }
			bPresent = true;
			Out = Field->StringValue;
			return true;
		}
	}

	const char* UiStateToken(EJuliusUiState State)
	{
		switch (State)
		{
		case EJuliusUiState::Idle: return "idle";
		case EJuliusUiState::Dispatching: return "dispatching";
		case EJuliusUiState::AdmittedWaiting: return "admitted_waiting";
		case EJuliusUiState::StillWaiting: return "still_waiting";
		case EJuliusUiState::QueuedBusy: return "queued_busy";
		case EJuliusUiState::Running: return "running";
		case EJuliusUiState::Completed: return "completed";
		case EJuliusUiState::Refused: return "refused";
		case EJuliusUiState::Failed: return "failed";
		case EJuliusUiState::OperatorStarted: return "operator_started";
		case EJuliusUiState::DispatchUnconfirmed: return "dispatch_unconfirmed";
		case EJuliusUiState::NotStarted: return "not_started";
		}
		return "failed";
	}

	bool IsLoopbackBaseUrl(std::string_view Url)
	{
		if (Url.empty() || Url.size() > 256) { return false; }
		for (const unsigned char C : Url)
		{
			if (C <= 0x20 || C == '\\' || C == '@' || C == '#') { return false; }
		}
		const std::string Lower = LowerHost(Url);
		std::string_view Rest;
		if (Lower.compare(0, 7, "http://") == 0) { Rest = std::string_view(Lower).substr(7); }
		else if (Lower.compare(0, 8, "https://") == 0) { Rest = std::string_view(Lower).substr(8); }
		else { return false; }
		if (Rest.empty() || Rest[0] == '/' || Rest[0] == '?' || Rest[0] == ':') { return false; }
		const std::size_t Cut = Rest.find_first_of("/?");
		const std::string_view HostPort = Cut == std::string_view::npos ? Rest : Rest.substr(0, Cut);
		std::string Host;
		std::string_view Port;
		if (!HostPort.empty() && HostPort[0] == '[')
		{
			const std::size_t End = HostPort.find(']');
			if (End == std::string_view::npos) { return false; }
			Host.assign(HostPort.data() + 1, End - 1);
			if (End + 1 < HostPort.size())
			{
				if (HostPort[End + 1] != ':') { return false; }
				Port = HostPort.substr(End + 2);
			}
		}
		else
		{
			const std::size_t Colon = HostPort.rfind(':');
			if (Colon != std::string_view::npos)
			{
				Host.assign(HostPort.data(), Colon);
				Port = HostPort.substr(Colon + 1);
			}
			else { Host.assign(HostPort.data(), HostPort.size()); }
		}
		if (!Port.empty() && !ParsePort(Port)) { return false; }
		// Literal addresses only (REVIEW #456 LOW): "localhost" is whatever the hosts file says.
		return Host == "127.0.0.1" || Host == "::1";
	}

	std::string JuliusTraceFilePath(std::string_view ProjectSavedDir, std::string_view RunId)
	{
		const bool bNamed = RunId == UnmintedTraceName
			|| (WonderlandJuliusMissionLogic::IsStrictRunId(RunId) && RunId.size() > WonderlandJuliusMissionLogic::RunIdPrefix.size()
				&& RunId.substr(0, WonderlandJuliusMissionLogic::RunIdPrefix.size()) == WonderlandJuliusMissionLogic::RunIdPrefix);
		if (!bNamed) { return {}; }
		std::string Root(ProjectSavedDir);
		while (!Root.empty() && (Root.back() == '/' || Root.back() == '\\')) { Root.pop_back(); }
		if (Root.empty()) { return {}; }
		Root += "/Logs/JuliusTrace/";
		Root.append(RunId.data(), RunId.size());
		Root += ".jsonl";
		return Root;
	}

	std::string FormatIso8601UtcMs(std::uint64_t UtcMs)
	{
		const std::uint64_t Seconds = UtcMs / 1000;
		const unsigned Millis = static_cast<unsigned>(UtcMs % 1000);
		int Year = 1970;
		unsigned Month = 1;
		unsigned Day = 1;
		CivilFromDays(static_cast<std::int64_t>(Seconds / 86400), Year, Month, Day);
		const unsigned Sod = static_cast<unsigned>(Seconds % 86400);
		const unsigned Hour = Sod / 3600;
		const unsigned Minute = (Sod % 3600) / 60;
		const unsigned Second = Sod % 60;
		std::string Out;
		Out.reserve(24);
		const unsigned YearValue = static_cast<unsigned>(Year);
		Out.push_back(static_cast<char>('0' + (YearValue / 1000) % 10));
		Out.push_back(static_cast<char>('0' + (YearValue / 100) % 10));
		Append2(Out, YearValue % 100);
		Out.push_back('-');
		Append2(Out, Month);
		Out.push_back('-');
		Append2(Out, Day);
		Out.push_back('T');
		Append2(Out, Hour);
		Out.push_back(':');
		Append2(Out, Minute);
		Out.push_back(':');
		Append2(Out, Second);
		Out.push_back('.');
		Out.push_back(static_cast<char>('0' + (Millis / 100) % 10));
		Out.push_back(static_cast<char>('0' + (Millis / 10) % 10));
		Out.push_back(static_cast<char>('0' + Millis % 10));
		Out.push_back('Z');
		return Out;
	}

	namespace
	{
		EJuliusUiState TokenToUi(std::string_view Token, bool& bOk)
		{
			bOk = true;
			if (Token == "idle") { return EJuliusUiState::Idle; }
			if (Token == "dispatching") { return EJuliusUiState::Dispatching; }
			if (Token == "admitted_waiting") { return EJuliusUiState::AdmittedWaiting; }
			if (Token == "still_waiting") { return EJuliusUiState::StillWaiting; }
			if (Token == "queued_busy") { return EJuliusUiState::QueuedBusy; }
			if (Token == "running") { return EJuliusUiState::Running; }
			if (Token == "completed") { return EJuliusUiState::Completed; }
			if (Token == "refused") { return EJuliusUiState::Refused; }
			if (Token == "failed") { return EJuliusUiState::Failed; }
			if (Token == "operator_started") { return EJuliusUiState::OperatorStarted; }
			if (Token == "dispatch_unconfirmed") { return EJuliusUiState::DispatchUnconfirmed; }
			if (Token == "not_started") { return EJuliusUiState::NotStarted; }
			bOk = false;
			return EJuliusUiState::Failed;
		}

		std::string PhaseName(bool bFailClosed, bool bFinished, bool bRefused, bool bAdmitted, bool bPairOpen)
		{
			if (bFailClosed) { return "failed_closed"; }
			if (bFinished) { return "finished"; }
			if (bRefused) { return "refused"; }
			if (bAdmitted) { return "admitted"; }
			if (bPairOpen) { return "open"; }
			return "idle";
		}
	}

	FJuliusMissionSession::FJuliusMissionSession(WonderlandJuliusMissionLogic::IRandomBytes16& InRandom, IUtcClock& InClock,
		ITraceSink& InTrace, ITextStore& InStore)
		: Random(InRandom), Clock(InClock), Trace(InTrace), Store(InStore)
	{
	}

	bool FJuliusMissionSession::SetBaseUrl(std::string_view InBaseUrl)
	{
		if (!IsLoopbackBaseUrl(InBaseUrl))
		{
			BaseUrl.clear();
			return false;
		}
		BaseUrl.assign(InBaseUrl.data(), InBaseUrl.size());
		while (!BaseUrl.empty() && BaseUrl.back() == '/') { BaseUrl.pop_back(); }
		return true;
	}

	void FJuliusMissionSession::SetProjectId(std::string_view InProjectId) { ProjectId.assign(InProjectId.data(), InProjectId.size()); }
	void FJuliusMissionSession::SetPlayerNetId(std::string_view InPlayerNetId) { PlayerNetId.assign(InPlayerNetId.data(), InPlayerNetId.size()); }
	void FJuliusMissionSession::SetBuildIdentity(std::string_view InBuildSha, std::string_view InPackageId)
	{
		BuildSha.assign(InBuildSha.data(), InBuildSha.size());
		PackageId.assign(InPackageId.data(), InPackageId.size());
	}
	void FJuliusMissionSession::SetExpectedResultMode(std::string_view Mode) { ExpectedMode.assign(Mode.data(), Mode.size()); }
	void FJuliusMissionSession::SetNativeSessionToken(std::string_view Token) { SessionToken.assign(Token.data(), Token.size()); }
	void FJuliusMissionSession::SetClockOffset(bool bKnown, std::int64_t OffsetMs, std::string_view Source)
	{
		bClockOffsetKnown = bKnown;
		ClockOffsetMs = bKnown ? OffsetMs : 0;
		ClockOffsetSource = bKnown ? std::string(Source) : std::string();
	}

	bool FJuliusMissionSession::IncludeServerRunOnTrace() const { return bSawAdmissionResponse; }

	std::string FJuliusMissionSession::BaseTracePrefix(std::string_view Event) const
	{
		std::string Out;
		Out += "\"ts_utc_ms\":";
		Out += std::to_string(Clock.NowUtcMs());
		Out += ",\"client_role\":\"sender\"";
		Out += ",\"player_net_id\":";
		Out += JsonStringOrNull(PlayerNetId);
		Out += ",\"build_sha\":";
		Out += JsonStringOrNull(BuildSha);
		Out += ",\"package_id\":";
		Out += JsonStringOrNull(PackageId);
		Out += ",\"wlj_run_id\":";
		Out += JsonStringOrNull(CurrentRunId);
		Out += ",\"event\":";
		Out += JsonString(Event);
		Out += ",\"ui_state\":";
		Out += JsonString(Label);
		Out += ",\"ui_state_enum\":";
		Out += JsonString(UiStateToken(Ui));
		return Out;
	}

	void FJuliusMissionSession::WriteTrace(std::string_view Event, std::string_view ExtraJson)
	{
		std::string Line = "{";
		Line += BaseTracePrefix(Event);
		if (IncludeServerRunOnTrace())
		{
			Line += ",\"server_run_id\":";
			Line += bServerRunIdKnown ? JsonString(CurrentServerRunId) : "null";
		}
		if (!ExtraJson.empty())
		{
			Line.push_back(',');
			Line.append(ExtraJson.data(), ExtraJson.size());
		}
		Line += "}\n";
		const std::string Bucket = CurrentRunId.empty() ? std::string(UnmintedTraceName) : CurrentRunId;
		Trace.Append(Bucket, Line);
	}

	void FJuliusMissionSession::SetUi(EJuliusUiState Next, std::string_view NextLabel)
	{
		const bool bChanged = Ui != Next;
		const std::string From(UiStateToken(Ui));
		Ui = Next;
		Label.assign(NextLabel.data(), NextLabel.size());
		if (!bChanged) { return; }
		std::string Extra = "\"from\":";
		Extra += JsonString(From);
		Extra += ",\"to\":";
		Extra += JsonString(UiStateToken(Next));
		WriteTrace("state_change", Extra);
	}

	void FJuliusMissionSession::TouchActivity(std::uint64_t NowMs)
	{
		if (NextHeartbeatAtUtcMs == 0) { NextHeartbeatAtUtcMs = NowMs + HeartbeatPeriodMs; }
	}

	std::uint64_t FJuliusMissionSession::WaitedMs(std::uint64_t NowMs) const
	{
		if (FirstSentUtcMs == 0 || NowMs < FirstSentUtcMs) { return 0; }
		return NowMs - FirstSentUtcMs;
	}

	bool FJuliusMissionSession::ConcludeAfterWorkflowEnded(std::string_view RunId, std::string_view Outcome)
	{
		if (!bAdmitted || bFinished || bRefused || bFailClosed || RunId.empty() || RunId != CurrentRunId) { return false; } // CLIENT_CONCLUDE_ONLY_THIS_ADMITTED_RUN
		SetUi(EJuliusUiState::Failed, "Julius ended this run without a result");
		WriteTrace("result_received", std::string("\"finished\":\"WorkflowEnded\",\"outcome\":") + JsonString(Outcome));
		bFinished = true;
		bRunning = false;
		NextPollAtUtcMs = 0;
		Persist();
		return true;
	}

	bool FJuliusMissionSession::BlocksMint() const
	{
		return bFailClosed || bStillWaiting || bPairOpen || bInFlight || (bAdmitted && !bFinished && !bRefused);
	}

	std::string FJuliusMissionSession::ClientLogHashFor(std::string_view LineWithNewline) const
	{
		return WonderlandJuliusMissionLogic::Sha256Hex(LineWithNewline);
	}

	void FJuliusMissionSession::MaybeHeartbeat(std::uint64_t NowMs)
	{
		const bool bActive = Ui != EJuliusUiState::Idle || bPairOpen || bAdmitted || bFailClosed || bFinished || bRefused;
		if (!bActive) { return; }
		if (NextHeartbeatAtUtcMs == 0) { NextHeartbeatAtUtcMs = NowMs + HeartbeatPeriodMs; return; }
		if (NowMs < NextHeartbeatAtUtcMs) { return; }
		std::string Extra = "\"system_clock_utc_ms\":";
		Extra += std::to_string(NowMs);
		Extra += ",\"ntp_offset_ms\":";
		if (bClockOffsetKnown && ClockOffsetSource == "ntp") { Extra += std::to_string(ClockOffsetMs); }
		else { Extra += "null"; }
		Extra += ",\"clock_offset_source\":";
		Extra += (bClockOffsetKnown && !ClockOffsetSource.empty()) ? JsonString(ClockOffsetSource) : "null";
		WriteTrace("heartbeat", Extra);
		NextHeartbeatAtUtcMs = NowMs + HeartbeatPeriodMs;
	}

	void FJuliusMissionSession::Persist()
	{
		const std::uint64_t NowMs = Clock.NowUtcMs();
		auto Line = [](const char* Key, const std::string& Value) {
			std::string Out(Key);
			Out.push_back(' ');
			Out += Value;
			Out.push_back('\n');
			return Out;
		};
		auto Flag = [](bool Value) { return std::string(Value ? "1" : "0"); };
		std::string Text = "WJ1OPEN 1\n";
		Text += Line("phase", PhaseName(bFailClosed, bFinished, bRefused, bAdmitted, bPairOpen));
		Text += Line("run_id", CurrentRunId);
		const bool bKeepKey = bPairOpen && !bAdmitted && !bFailClosed && !bRefused && !bFinished;
		Text += Line("key", bKeepKey ? CurrentKey : std::string());
		Text += Line("attempt_count", std::to_string(AttemptCount));
		Text += Line("resends_sent", std::to_string(ResendsSent));
		Text += Line("waited_ms", std::to_string(WaitedMs(NowMs)));
		Text += Line("first_sent_utc_ms", std::to_string(FirstSentUtcMs));
		Text += Line("mission_id", MissionId);
		Text += Line("ui_state", UiStateToken(Ui));
		Text += Line("ui_label", Label);
		Text += Line("pair_id", PairId);
		Text += Line("server_run_id", bServerRunIdKnown ? CurrentServerRunId : std::string());
		Text += Line("server_run_known", Flag(bServerRunIdKnown));
		Text += Line("saw_admission", Flag(bSawAdmissionResponse));
		Text += Line("admitted", Flag(bAdmitted));
		Text += Line("pair_open", Flag(bPairOpen));
		Text += Line("still_waiting", Flag(bStillWaiting));
		Text += Line("fail_closed", Flag(bFailClosed));
		Text += Line("refused", Flag(bRefused));
		Text += Line("finished", Flag(bFinished));
		Text += Line("running", Flag(bRunning));
		Text += Line("project_id", ProjectId);
		Text += Line("expected_mode", ExpectedMode);
		Text += Line("build_sha", BuildSha);
		Text += Line("package_id", PackageId);
		Text += Line("player_net_id", PlayerNetId);
		Text += Line("artifact_label", ArtifactQualification);
		Text += Line("artifact_digest12", Digest12);
		Text += Line("next_resend_at", std::to_string(NextResendAtUtcMs));
		LastSaved = Text;
		Store.Write(Text);
	}

	bool FJuliusMissionSession::Load()
	{
		std::string Text;
		if (!Store.Read(Text) || Text.empty()) { return false; }
		std::vector<std::pair<std::string, std::string>> Rows;
		std::size_t Cursor = 0;
		while (Cursor < Text.size())
		{
			std::size_t End = Text.find('\n', Cursor);
			if (End == std::string::npos) { End = Text.size(); }
			const std::string_view Row(Text.data() + Cursor, End - Cursor);
			if (!Row.empty() && Row.back() == '\r') { /* drop CR */ }
			const std::string_view Trimmed = ( !Row.empty() && Row.back() == '\r') ? Row.substr(0, Row.size() - 1) : Row;
			if (!Trimmed.empty())
			{
				const std::size_t Space = Trimmed.find(' ');
				if (Space == std::string_view::npos) { return false; }
				Rows.emplace_back(std::string(Trimmed.substr(0, Space)), std::string(Trimmed.substr(Space + 1)));
			}
			Cursor = End + (End < Text.size() ? 1 : 0);
		}
		if (Rows.empty() || Rows[0].first != "WJ1OPEN" || Rows[0].second != "1") { return false; }
		auto Find = [&Rows](const char* Key) -> const std::string* {
			for (const std::pair<std::string, std::string>& Row : Rows)
			{
				if (Row.first == Key) { return &Row.second; }
			}
			return nullptr;
		};
		const char* Keys[] = {
			"phase", "run_id", "key", "attempt_count", "resends_sent", "waited_ms", "first_sent_utc_ms", "mission_id",
			"ui_state", "ui_label", "pair_id", "server_run_id", "server_run_known", "saw_admission", "admitted",
			"pair_open", "still_waiting", "fail_closed", "refused", "finished", "running", "project_id",
			"expected_mode", "build_sha", "package_id", "player_net_id", "artifact_label", "artifact_digest12",
			"next_resend_at",
		};
		for (const char* Key : Keys)
		{
			if (Find(Key) == nullptr) { return false; }
		}
		auto Flag = [&Find](const char* Key, bool& Out) {
			const std::string* Value = Find(Key);
			if (Value == nullptr || (*Value != "0" && *Value != "1")) { return false; }
			Out = *Value == "1";
			return true;
		};
		bool bKnown = false, bSaw = false, bAdm = false, bOpen = false, bStill = false, bFail = false, bRef = false, bDone = false, bRun = false;
		if (!Flag("server_run_known", bKnown) || !Flag("saw_admission", bSaw) || !Flag("admitted", bAdm) || !Flag("pair_open", bOpen)
			|| !Flag("still_waiting", bStill) || !Flag("fail_closed", bFail) || !Flag("refused", bRef) || !Flag("finished", bDone)
			|| !Flag("running", bRun))
		{
			return false;
		}
		std::uint32_t Attempts = 0, Resends = 0;
		std::uint64_t First = 0, NextResend = 0;
		if (!ParseU32(*Find("attempt_count"), Attempts) || !ParseU32(*Find("resends_sent"), Resends)
			|| !ParseU64(*Find("first_sent_utc_ms"), First) || !ParseU64(*Find("next_resend_at"), NextResend))
		{
			return false;
		}
		std::uint64_t IgnoredWaited = 0;
		if (!ParseU64(*Find("waited_ms"), IgnoredWaited)) { return false; }
		bool bUiOk = false;
		const EJuliusUiState LoadedUi = TokenToUi(*Find("ui_state"), bUiOk);
		if (!bUiOk) { return false; }
		const std::string& LoadedRun = *Find("run_id");
		const std::string& LoadedKey = *Find("key");
		if (!LoadedRun.empty() && (LoadedRun.compare(0, 4, "wlj_") != 0 || !WonderlandJuliusMissionLogic::IsStrictRunId(LoadedRun))) { return false; }
		if (!LoadedKey.empty() && !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(LoadedKey)) { return false; }
		const std::string ExpectedPhase = PhaseName(bFail, bDone, bRef, bAdm, bOpen);
		if (*Find("phase") != ExpectedPhase) { return false; }
		if (bOpen && (LoadedRun.empty() || LoadedKey.empty() || bAdm || bFail || bRef || bDone)) { return false; }
		if (bKnown && Find("server_run_id")->empty()) { return false; }
		if (!bKnown && !Find("server_run_id")->empty()) { return false; }

		if (bOpen)
		{
			WonderlandJuliusMissionLogic::FDispatchAttempt Pair;
			Pair.RunId = LoadedRun;
			Pair.IdempotencyKey = LoadedKey;
			if (Tracker.BeginAttempt(Pair) != WonderlandJuliusMissionLogic::EAttemptVerdict::Admitted) { return false; }
		}

		CurrentRunId = LoadedRun;
		Progress.reset();
		AdmittedAtUtcMs = 0;
		if (!CurrentRunId.empty())
		{
			Progress.emplace(CurrentRunId);
			if (bAdm) { AdmittedAtUtcMs = Clock.NowUtcMs(); }
		}
		CurrentKey = bOpen ? LoadedKey : std::string();
		MissionId = *Find("mission_id");
		Label = *Find("ui_label");
		Ui = LoadedUi;
		PairId = *Find("pair_id");
		bServerRunIdKnown = bKnown;
		CurrentServerRunId = bKnown ? *Find("server_run_id") : std::string();
		bSawAdmissionResponse = bSaw;
		bAdmitted = bAdm;
		bPairOpen = bOpen;
		bStillWaiting = bStill;
		bFailClosed = bFail;
		bRefused = bRef;
		bFinished = bDone;
		bRunning = bRun;
		AttemptCount = Attempts;
		ResendsSent = Resends;
		FirstSentUtcMs = First;
		NextResendAtUtcMs = NextResend;
		ProjectId = *Find("project_id");
		ExpectedMode = *Find("expected_mode");
		BuildSha = *Find("build_sha");
		PackageId = *Find("package_id");
		PlayerNetId = *Find("player_net_id");
		ArtifactQualification = *Find("artifact_label");
		Digest12 = *Find("artifact_digest12");
		if (bAdmitted && !bFinished && !bFailClosed && !bRefused)
		{
			const std::uint64_t NowMs = Clock.NowUtcMs();
			NextPollAtUtcMs = NowMs;
			TouchActivity(NowMs);
			// RESTORED ADMISSION (REVIEW, 2026-10-25): the tracker above was rebuilt empty, so it would ignore the status
			// route's answers -- a restored held run never followed BRIDGE's AWAITING_OPERATOR_EXPIRED or "dispatched".
			// Replay the admission the save already proves (Accepted), silently: no trace line, no UI change. The status
			// route then decides, and the local hold window is only the no-answer fallback, timed from this restore.
			if (Progress.has_value())
			{
				WonderlandJuliusMissionLogic::FStatusAnswer Fields;
				Fields.HttpStatus = 202;
				Fields.bHasData = true;
				Fields.Vocabulary = WonderlandJuliusMissionLogic::EStatusVocabulary::Admission;
				Fields.ClientRunId = CurrentRunId;
				Fields.ServerRunId = bServerRunIdKnown ? CurrentServerRunId : std::string();
				Fields.Status = "ADMISSION_HELD";
				Fields.ReceivedUtcMs = NowMs;
				Progress->RecordDispatchAnswer(WonderlandJuliusMissionLogic::EDispatchAnswer::Accepted, Fields); // FLOW_RESTORE_REPLAYS_ADMISSION
			}
		}
		if (bOpen && !bStillWaiting && !bFailClosed && NextResendAtUtcMs == 0)
		{
			const WonderlandJuliusMissionLogic::FResendDecision Decision = WonderlandJuliusMissionLogic::NextResend(ResendsSent, WaitedMs(Clock.NowUtcMs()));
			if (Decision.Step == WonderlandJuliusMissionLogic::EResendStep::StillWaiting)
			{
				bStillWaiting = true;
				Ui = EJuliusUiState::StillWaiting;
				Label = LabelStillWaiting;
			}
			else { NextResendAtUtcMs = Clock.NowUtcMs() + Decision.DelayMs; }
		}
		LastSaved = Text;
		return true;
	}

	FWireRequest FJuliusMissionSession::MakeDispatchRequest(bool bResend, std::string_view LogHash, std::string_view RequestId) const
	{
		FWireRequest Request;
		Request.Method = "POST";
		Request.bResend = bResend;
		Request.RunId = CurrentRunId;
		Request.RequestId = std::string(RequestId);
		Request.Url = JoinBase(BaseUrl, DispatchRelativePath);
		Request.Url += "?projectId=";
		Request.Url += PercentEncode(ProjectId);
		Request.Headers.emplace_back("Content-Type", "application/json");
		Request.Headers.emplace_back("Authorization", std::string("Relay-Session ") + SessionToken);
		Request.Headers.emplace_back("x-relay-idempotency-key", CurrentKey);
		std::string Body = "{\"runId\":";
		Body += JsonString(CurrentRunId);
		Body += ",\"clientTriggerId\":";
		Body += JsonString(RequestId);
		Body += ",\"clientLogSha256\":";
		Body += JsonString(LogHash);
		Body += ",\"clientUiActionUtc\":";
		Body += JsonString(FormatIso8601UtcMs(Clock.NowUtcMs()));
		if (bClockOffsetKnown)
		{
			Body += ",\"clientOffsetMs\":";
			Body += std::to_string(ClockOffsetMs);
		}
		Body.push_back('}');
		Request.Body = std::move(Body);
		return Request;
	}

	FWireRequest FJuliusMissionSession::MakeStatusRequest() const
	{
		FWireRequest Request;
		Request.Method = "GET";
		Request.bStatusPoll = true;
		Request.RunId = CurrentRunId;
		Request.Url = JoinBase(BaseUrl, StatusRelativePath);
		Request.Url += "?runId=";
		Request.Url += PercentEncode(CurrentRunId);
		Request.Url += "&projectId=";
		Request.Url += PercentEncode(ProjectId);
		Request.Headers.emplace_back("Authorization", std::string("Relay-Session ") + SessionToken);
		return Request;
	}

	FCommandOutcome FJuliusMissionSession::MissionReadRequest(bool bProgress) const
	{
		FCommandOutcome Outcome;
		if (CurrentRunId.empty()) { Outcome.Detail = "no run to read"; return Outcome; }
		if (SessionToken.empty() || SessionToken.find_first_of(" \r\n\t") != std::string::npos)
		{
			Outcome.Detail = "native session is not set";
			return Outcome;
		}
		if (!IsLoopbackBaseUrl(BaseUrl)) { Outcome.Detail = "endpoint is not loopback"; return Outcome; }
		FWireRequest Request;
		Request.Method = "GET";
		Request.RunId = CurrentRunId;
		Request.Url = JoinBase(BaseUrl, MissionReadRelativePrefix);
		Request.Url += PercentEncode(CurrentRunId);
		Request.Url += bProgress ? "/progress" : "/result";
		// juliusLoopbackGuard (#448) checks ?projectId= against the paired project on every route, reads included;
		// without it the bridge answers 403 julius_dispatch_wrong_project (seen in the loopback rehearsal).
		Request.Url += "?projectId=";
		Request.Url += PercentEncode(ProjectId);
		Request.Headers.emplace_back("Authorization", std::string("Relay-Session ") + SessionToken);
		Outcome.bSent = true;
		Outcome.Request = std::move(Request);
		return Outcome;
	}

	bool FJuliusMissionSession::MintStartKey(std::string& OutKey)
	{
		std::uint8_t Bytes[16] = {};
		if (!Random.Fill(Bytes)) { return false; }
		OutKey = WonderlandJuliusMissionLogic::FormatUuidV4FromBytes(Bytes);
		return WonderlandJuliusMissionLogic::IsCanonicalUuidV4(OutKey);
	}

	FCommandOutcome FJuliusMissionSession::StartRequest(std::string_view Confirm, const std::string& StartKey)
	{
		FCommandOutcome Outcome;
		if (Confirm != "RUN LIVE MISSION") { Outcome.Detail = "the confirmation phrase was not typed exactly"; return Outcome; } // CLIENT_START_CONFIRM_EXACT
		if (!WonderlandJuliusMissionLogic::IsCanonicalUuidV4(StartKey)) { Outcome.Detail = "start key is malformed"; return Outcome; }
		Outcome = MissionReadRequest(false); // the same run, session and loopback refusals as every read
		if (!Outcome.bSent) { return Outcome; }
		std::uint8_t TriggerBytes[16] = {};
		if (!Random.Fill(TriggerBytes)) { Outcome = FCommandOutcome(); Outcome.Detail = LabelRandomUnavailable; return Outcome; }
		Outcome.Request.Method = "POST";
		Outcome.Request.Url = JoinBase(BaseUrl, MissionReadRelativePrefix);
		Outcome.Request.Url += PercentEncode(CurrentRunId);
		Outcome.Request.Url += "/start?projectId=";
		Outcome.Request.Url += PercentEncode(ProjectId);
		Outcome.Request.Headers.emplace_back("Content-Type", "application/json");
		Outcome.Request.Headers.emplace_back("x-relay-idempotency-key", StartKey);
		std::string Body = "{\"wljRunId\":";
		Body += JsonString(CurrentRunId);
		Body += ",\"confirm\":\"RUN LIVE MISSION\",\"clientTriggerId\":";
		Body += JsonString(HexOf(TriggerBytes, 16));
		Body += ",\"clientUiActionUtc\":";
		Body += JsonString(FormatIso8601UtcMs(Clock.NowUtcMs()));
		Body.push_back('}');
		Outcome.Request.Body = std::move(Body);
		return Outcome;
	}

	FCommandOutcome FJuliusMissionSession::LiveEventsRequest(const std::string& Cursor) const
	{
		FCommandOutcome Outcome;
		if (Cursor.size() > LiveCursorMaxBytes) { Outcome.Detail = "live cursor is malformed"; return Outcome; }
		for (const char Ch : Cursor)
		{
			if (Ch <= 0x20 || Ch > 0x7E) { Outcome.Detail = "live cursor is malformed"; return Outcome; }
		}
		Outcome = MissionReadRequest(false);
		if (!Outcome.bSent) { return Outcome; }
		Outcome.Request.Url = JoinBase(BaseUrl, MissionReadRelativePrefix);
		Outcome.Request.Url += PercentEncode(CurrentRunId);
		Outcome.Request.Url += "/events?projectId=";
		Outcome.Request.Url += PercentEncode(ProjectId);
		if (!Cursor.empty())
		{
			Outcome.Request.Url += "&after=";
			Outcome.Request.Url += PercentEncode(Cursor);
		}
		return Outcome;
	}

	FCommandOutcome FJuliusMissionSession::SendOpenPair(bool bFromSchedule)
	{
		FCommandOutcome Outcome;
		if (bFailClosed || !bPairOpen || CurrentKey.empty() || bAdmitted || bRefused || bFinished || bInFlight)
		{
			Outcome.Detail = "no open pair to resend";
			return Outcome;
		}
		if (!IsLoopbackBaseUrl(BaseUrl))
		{
			Outcome.Detail = "endpoint is not loopback";
			return Outcome;
		}
		const std::uint64_t NowMs = Clock.NowUtcMs();
		const WonderlandJuliusMissionLogic::FResendDecision Decision = WonderlandJuliusMissionLogic::NextResend(ResendsSent, WaitedMs(NowMs));
		if (Decision.Step == WonderlandJuliusMissionLogic::EResendStep::StillWaiting || bStillWaiting)
		{
			bStillWaiting = true;
			NextResendAtUtcMs = 0;
			SetUi(EJuliusUiState::StillWaiting, LabelStillWaiting);
			Persist();
			Outcome.Detail = LabelStillWaiting;
			return Outcome;
		}
		if (bFromSchedule && NowMs < NextResendAtUtcMs) { Outcome.Detail = "resend is waiting"; return Outcome; }
		WonderlandJuliusMissionLogic::FDispatchAttempt Pair;
		Pair.RunId = CurrentRunId;
		Pair.IdempotencyKey = CurrentKey;
		if (Tracker.BeginAttempt(Pair) != WonderlandJuliusMissionLogic::EAttemptVerdict::Admitted)
		{
			Outcome.Detail = "open pair was not admitted by the tracker";
			return Outcome;
		}
		std::uint8_t RequestBytes[16] = {};
		if (!Random.Fill(RequestBytes))
		{
			WriteTrace("error", "\"reason\":\"random_unavailable\"");
			Persist();
			Outcome.Detail = LabelRandomUnavailable;
			return Outcome;
		}
		const std::string RequestId = HexOf(RequestBytes, 16);
		InFlightRequestId = RequestId;
		const std::string PriorLabel = Label;
		const EJuliusUiState Prior = Ui;
		Label = LabelDispatching;
		Ui = EJuliusUiState::Dispatching;
		std::string Extra = "\"request_id\":";
		Extra += JsonString(RequestId);
		Extra += ",\"mission_id\":";
		Extra += JsonString(MissionId);
		Extra += ",\"pair_id\":";
		Extra += PairId.empty() ? "null" : JsonString(PairId);
		Extra += ",\"resend\":true";
		std::string Line = "{";
		Line += BaseTracePrefix("dispatch_requested");
		if (IncludeServerRunOnTrace())
		{
			Line += ",\"server_run_id\":";
			Line += bServerRunIdKnown ? JsonString(CurrentServerRunId) : "null";
		}
		Line.push_back(',');
		Line += Extra;
		Line += "}\n";
		if (!Trace.Append(CurrentRunId, Line))
		{
			const WonderlandJuliusMissionLogic::FResendDecision Retry = WonderlandJuliusMissionLogic::NextResend(ResendsSent, WaitedMs(NowMs));
			if (Retry.Step == WonderlandJuliusMissionLogic::EResendStep::StillWaiting)
			{
				bStillWaiting = true;
				NextResendAtUtcMs = 0;
				SetUi(EJuliusUiState::StillWaiting, LabelStillWaiting);
			}
			else { NextResendAtUtcMs = NowMs + Retry.DelayMs; }
			Outcome.Detail = "trace was not written";
			Persist();
			return Outcome;
		}
		if (Prior != Ui)
		{
			std::string Change = "\"from\":";
			Change += JsonString(UiStateToken(Prior));
			Change += ",\"to\":\"dispatching\"";
			WriteTrace("state_change", Change);
		}
		else { Label = PriorLabel; }
		const std::string Hash = ClientLogHashFor(Line);
		++ResendsSent;
		++AttemptCount;
		bInFlight = true;
		NextResendAtUtcMs = 0;
		TouchActivity(NowMs);
		Outcome.bSent = true;
		Outcome.Request = MakeDispatchRequest(true, Hash, RequestId);
		Persist();
		return Outcome;
	}

	FCommandOutcome FJuliusMissionSession::Dispatch(std::string_view InMissionId, std::string_view InPairId)
	{
		FCommandOutcome Outcome;
		if (BlocksMint()) { Outcome.Detail = "a pair is already open"; return Outcome; }
		if (SessionToken.empty() || SessionToken.find_first_of(" \r\n\t") != std::string::npos)
		{
			Outcome.Detail = "native session is not set";
			return Outcome;
		}
		if (!IsLoopbackBaseUrl(BaseUrl)) { Outcome.Detail = "endpoint is not loopback"; return Outcome; }
		if (!IsProjectId(ProjectId)) { Outcome.Detail = "project id is not set"; return Outcome; }
		if (!IsSafeToken(InMissionId, 128, false)) { Outcome.Detail = "mission id is not usable"; return Outcome; }
		if (!IsSafeToken(InPairId, 128, true)) { Outcome.Detail = "pair id is not usable"; return Outcome; }

		WonderlandJuliusMissionLogic::FDispatchAttempt Minted;
		const WonderlandJuliusMissionLogic::EMintResult MintedResult = Tracker.MintAttempt(Random, Minted);
		if (MintedResult != WonderlandJuliusMissionLogic::EMintResult::Minted)
		{
			WriteTrace("error", "\"reason\":\"random_unavailable\"");
			Outcome.Detail = LabelRandomUnavailable;
			return Outcome;
		}
		std::uint8_t RequestBytes[16] = {};
		if (!Random.Fill(RequestBytes))
		{
			WriteTrace("error", "\"reason\":\"random_unavailable\"");
			Outcome.Detail = LabelRandomUnavailable;
			return Outcome;
		}
		if (Tracker.BeginAttempt(Minted) != WonderlandJuliusMissionLogic::EAttemptVerdict::Admitted)
		{
			WriteTrace("error", "\"reason\":\"attempt_not_admitted\"");
			Outcome.Detail = "attempt was not admitted";
			return Outcome;
		}

		const std::string PriorToken(UiStateToken(Ui));
		CurrentRunId = Minted.RunId;
		Progress.reset();
		Progress.emplace(CurrentRunId);
		AdmittedAtUtcMs = 0;
		CurrentKey = Minted.IdempotencyKey;
		MissionId.assign(InMissionId.data(), InMissionId.size());
		PairId.assign(InPairId.data(), InPairId.size());
		bPairOpen = true;
		bAdmitted = false;
		bRefused = false;
		bFinished = false;
		bFailClosed = false;
		bStillWaiting = false;
		bRunning = false;
		bServerRunIdKnown = false;
		CurrentServerRunId.clear();
		bSawAdmissionResponse = false;
		ArtifactQualification.clear();
		Digest12.clear();
		AttemptCount = 1;
		ResendsSent = 0;
		const std::uint64_t NowMs = Clock.NowUtcMs();
		FirstSentUtcMs = NowMs;
		NextResendAtUtcMs = 0;
		NextPollAtUtcMs = 0;
		const std::string RequestId = HexOf(RequestBytes, 16);
		InFlightRequestId = RequestId;
		Label = LabelDispatching;
		Ui = EJuliusUiState::Dispatching;
		std::string Extra = "\"request_id\":";
		Extra += JsonString(RequestId);
		Extra += ",\"mission_id\":";
		Extra += JsonString(MissionId);
		Extra += ",\"pair_id\":";
		Extra += PairId.empty() ? "null" : JsonString(PairId);
		Extra += ",\"resend\":false";
		std::string Line = "{";
		Line += BaseTracePrefix("dispatch_requested");
		Line.push_back(',');
		Line += Extra;
		Line += "}\n";
		if (!Trace.Append(CurrentRunId, Line))
		{
			NextResendAtUtcMs = NowMs + WonderlandJuliusMissionLogic::NextResend(0, 0).DelayMs;
			Outcome.Detail = "trace was not written";
			Persist();
			return Outcome;
		}
		WriteTrace("state_change", std::string("\"from\":") + JsonString(PriorToken) + ",\"to\":\"dispatching\"");
		const std::string Hash = ClientLogHashFor(Line);
		bInFlight = true;
		TouchActivity(NowMs);
		Outcome.bSent = true;
		Outcome.Request = MakeDispatchRequest(false, Hash, RequestId);
		Persist();
		return Outcome;
	}

	FCommandOutcome FJuliusMissionSession::Resend()
	{
		FCommandOutcome Outcome;
		if (bFailClosed) { Outcome.Detail = LabelServerRunMismatch; return Outcome; }
		if (bStillWaiting) { Outcome.Detail = LabelStillWaiting; return Outcome; }
		if (bAdmitted) { Outcome.Detail = "admitted; status is polled"; return Outcome; }
		if (!bPairOpen) { Outcome.Detail = "no open pair"; return Outcome; }
		return SendOpenPair(false);
	}

	FTickOutcome FJuliusMissionSession::Tick()
	{
		const std::uint64_t NowMs = Clock.NowUtcMs();
		MaybeHeartbeat(NowMs);
		FTickOutcome Outcome;
		if (bInFlight || bFailClosed) { return Outcome; }
		if (bPairOpen && !bAdmitted && !bStillWaiting && !bRefused && !bFinished && NextResendAtUtcMs != 0 && NowMs >= NextResendAtUtcMs)
		{
			const FCommandOutcome Sent = SendOpenPair(true);
			if (Sent.bSent) { Outcome.bSend = true; Outcome.Request = Sent.Request; }
			return Outcome;
		}
		// NO SESSION, NO POLL: a run restored after a restart has no native session until the player pairs again (the
		// bridge keeps sessions in memory; the client never saves the token). The poll waits, due, and goes out on the
		// first tick after pairing -- same wlj_, nothing re-sent, nothing minted.
		const bool bSessionReady = !SessionToken.empty() && SessionToken.find_first_of(" \r\n\t") == std::string::npos;
		if (bAdmitted && !bFinished && !bRefused && NextPollAtUtcMs != 0 && NowMs >= NextPollAtUtcMs && bSessionReady) // CLIENT_NO_POLL_WITHOUT_SESSION
		{
			std::uint32_t DelayMs = StatusPollPeriodMs;
			if (ProgressOwnsPoll())
			{
				const std::size_t Before = Progress->Trace().size();
				const WonderlandJuliusMissionLogic::FPollDecision Decision = Progress->NextPollStep(NowMs - AdmittedAtUtcMs);
				PublishProgress(Before);
				if (Decision.Step != WonderlandJuliusMissionLogic::EPollStep::WaitThenPoll)
				{
					NextPollAtUtcMs = 0;
					ApplyProgressUi();
					Persist();
					return Outcome;
				}
				DelayMs = Decision.DelayMs == 0 ? static_cast<std::uint32_t>(StatusPollPeriodMs) : Decision.DelayMs;
			}
			if (!IsLoopbackBaseUrl(BaseUrl)) { return Outcome; }
			Outcome.bSend = true;
			Outcome.Request = MakeStatusRequest();
			bInFlight = true;
			NextPollAtUtcMs = NowMs + DelayMs;
			Persist();
		}
		return Outcome;
	}

	namespace
	{
		bool FillAdmission(const FJson& Root, FJuliusMissionSession::FAdmissionView& Out)
		{
			Out.bParsed = true;
			const FJson* Error = Root.Find("error");
			if (Error != nullptr)
			{
				Out.bHasError = true;
				if (Error->Kind == FJson::EKind::Object)
				{
					const FJson* Kind = Error->Find("kind");
					if (Kind != nullptr && Kind->Kind == FJson::EKind::String) { Out.ErrorKind = Kind->StringValue; }
				}
			}
			const FJson* Data = Root.Find("data");
			if (Data != nullptr && Data->Kind == FJson::EKind::Object)
			{
				Out.bHasData = true;
				const FJson* State = Data->Find("state");
				if (State != nullptr && State->Kind == FJson::EKind::String) { Out.DataState = State->StringValue; }
				bool bIgnored = false;
				StringField(*Data, "dispatchedAt", Out.DispatchedAt, bIgnored);
				StringField(*Data, "cause", Out.Cause, bIgnored);
				const FJson* Dispatched = Data->Find("dispatched");
				if (Dispatched != nullptr && Dispatched->Kind == FJson::EKind::Bool)
				{
					Out.bDispatchedPresent = true;
					Out.bDispatched = Dispatched->BoolValue;
				}
				const FJson* Run = Data->Find("runId");
				if (Run != nullptr && Run->Kind == FJson::EKind::String)
				{
					Out.bDataRunIdPresent = true;
					Out.DataRunId = Run->StringValue;
				}
				const FJson* ServerRun = Data->Find("serverRunId");
				if (ServerRun != nullptr && ServerRun->Kind != FJson::EKind::Null)
				{
					if (ServerRun->Kind != FJson::EKind::String) { Out.bServerRunIdInvalid = true; }
					else if (!ServerRun->StringValue.empty())
					{
						bool bHostile = ServerRun->StringValue.size() > 128;
						for (const unsigned char C : ServerRun->StringValue)
						{
							if (C <= 0x20 || C >= 0x7F) { bHostile = true; }
						}
						if (bHostile) { Out.bServerRunIdInvalid = true; }
						else
						{
							Out.bServerRunIdPresent = true;
							Out.ServerRunId = ServerRun->StringValue;
						}
					}
				}
			}
			return true;
		}
	}

	void FJuliusMissionSession::RememberServerRun(const FAdmissionView& View, bool& bMismatch, std::string& Conflicting)
	{
		bMismatch = false;
		Conflicting.clear();
		if (View.bServerRunIdInvalid) { bMismatch = true; return; }
		if (!View.bServerRunIdPresent) { return; }
		if (!bServerRunIdKnown)
		{
			CurrentServerRunId = View.ServerRunId;
			bServerRunIdKnown = true;
			return;
		}
		if (View.ServerRunId != CurrentServerRunId)
		{
			bMismatch = true;
			Conflicting = View.ServerRunId;
		}
	}

	void FJuliusMissionSession::FailClosedMismatch(const std::string& Conflicting, const FHttpResult& Http, const FAdmissionView& View)
	{
		bFailClosed = true;
		bSawAdmissionResponse = true;
		bInFlight = false;
		NextResendAtUtcMs = 0;
		NextPollAtUtcMs = 0;
		const bool bTransport = Http.bTransportError || Http.Status == 0 || !View.bParsed;
		WonderlandJuliusMissionLogic::EDispatchAnswer Answer = WonderlandJuliusMissionLogic::EDispatchAnswer::NoAnswer;
		if (!bTransport)
		{
			Answer = WonderlandJuliusMissionLogic::ClassifyDispatchAnswer(Http.Status, View.bHasError, View.ErrorKind);
		}
		std::string Code = "unreadable";
		if (Http.bTransportError || Http.Status == 0) { Code = "transport"; }
		else if (!View.ErrorKind.empty()) { Code = View.ErrorKind; }
		else if (!View.DataState.empty()) { Code = View.DataState; }
		std::string HttpExtra = "\"http_status\":";
		HttpExtra += std::to_string(Http.Status);
		HttpExtra += ",\"code\":";
		HttpExtra += JsonString(Code);
		HttpExtra += ",\"latency_ms\":";
		HttpExtra += std::to_string(Http.LatencyMs);
		HttpExtra += ",\"classified_answer\":";
		HttpExtra += JsonString(AnswerToken(Answer));
		HttpExtra += ",\"request_id\":";
		HttpExtra += JsonStringOrNull(InFlightRequestId);
		HttpExtra += ",\"resend\":";
		HttpExtra += Http.bResend ? "true" : "false";
		WriteTrace("http_response", HttpExtra);
		std::string Reason = "server_run_id_mismatch";
		if (View.bServerRunIdInvalid) { Reason = "server_run_id_unreadable"; }
		else if (View.bDataRunIdPresent && View.DataRunId != CurrentRunId) { Reason = "admission_run_mismatch"; }
		std::string ErrorExtra = "\"reason\":";
		ErrorExtra += JsonString(Reason);
		ErrorExtra += ",\"conflicting_server_run_id\":";
		ErrorExtra += Conflicting.empty() ? "null" : JsonString(Conflicting);
		WriteTrace("error", ErrorExtra);
		SetUi(EJuliusUiState::Failed, LabelServerRunMismatch);
		Persist();
	}

	void FJuliusMissionSession::ApplyDispatchClassification(const FHttpResult& Http, const FAdmissionView& View)
	{
		using WonderlandJuliusMissionLogic::EDispatchAnswer;
		const bool bTransport = Http.bTransportError || Http.Status == 0 || !View.bParsed;
		EDispatchAnswer Answer = EDispatchAnswer::NoAnswer;
		if (!bTransport)
		{
			Answer = WonderlandJuliusMissionLogic::ClassifyDispatchAnswer(Http.Status, View.bHasError, View.ErrorKind);
		}
		if (!bTransport) { bSawAdmissionResponse = true; }
		std::string Code;
		if (Http.bTransportError || Http.Status == 0) { Code = "transport"; }
		else if (!View.bParsed) { Code = "unreadable"; }
		else if (!View.ErrorKind.empty()) { Code = View.ErrorKind; }
		else if (!View.DataState.empty()) { Code = View.DataState; }
		std::string HttpExtra = "\"http_status\":";
		HttpExtra += std::to_string(Http.Status);
		HttpExtra += ",\"code\":";
		HttpExtra += Code.empty() ? "null" : JsonString(Code);
		HttpExtra += ",\"latency_ms\":";
		HttpExtra += std::to_string(Http.LatencyMs);
		HttpExtra += ",\"classified_answer\":";
		HttpExtra += JsonString(AnswerToken(Answer));
		HttpExtra += ",\"request_id\":";
		HttpExtra += JsonStringOrNull(InFlightRequestId);
		HttpExtra += ",\"resend\":";
		HttpExtra += Http.bResend ? "true" : "false";
		WriteTrace("http_response", HttpExtra);

		if (bAdmitted || bFinished || bRefused || bFailClosed)
		{
			Persist();
			return;
		}

		const std::uint64_t NowMs = Clock.NowUtcMs();
		if (Answer == EDispatchAnswer::Accepted)
		{
			Tracker.RecordAnswer(Answer);
			bAdmitted = true;
			bPairOpen = false;
			CurrentKey.clear();
			NextResendAtUtcMs = 0;
			if (AdmittedAtUtcMs == 0) { AdmittedAtUtcMs = NowMs; }
			SetUi(EJuliusUiState::AdmittedWaiting, LabelAdmitted);
			NoteDispatchProgress(Http, View, Answer);
			if (Ui == EJuliusUiState::NotStarted)
			{
				NextPollAtUtcMs = 0;
			}
			else if (ProgressOwnsPoll())
			{
				ArmPoll(NowMs);
			}
			else
			{
				NextPollAtUtcMs = NowMs + StatusPollPeriodMs;
			}
		}
		else if (Answer == EDispatchAnswer::Refused)
		{
			Tracker.RecordAnswer(Answer);
			bPairOpen = false;
			bRefused = true;
			CurrentKey.clear();
			NextResendAtUtcMs = 0;
			const std::string Reason = View.ErrorKind.empty() ? std::string("refused") : View.ErrorKind;
			SetUi(EJuliusUiState::Refused, Reason);
			WriteTrace("refusal_shown", std::string("\"reason_code\":") + JsonString(Reason));
		}
		else
		{
			Tracker.RecordAnswer(EDispatchAnswer::NoAnswer);
			const WonderlandJuliusMissionLogic::FResendDecision Decision = WonderlandJuliusMissionLogic::NextResend(ResendsSent, WaitedMs(NowMs));
			if (Decision.Step == WonderlandJuliusMissionLogic::EResendStep::StillWaiting)
			{
				bStillWaiting = true;
				NextResendAtUtcMs = 0;
				SetUi(EJuliusUiState::StillWaiting, LabelStillWaiting);
			}
			else if (View.ErrorKind == "julius_dispatch_busy")
			{
				NextResendAtUtcMs = NowMs + Decision.DelayMs;
				SetUi(EJuliusUiState::QueuedBusy, LabelQueuedBusy);
			}
			else
			{
				NextResendAtUtcMs = NowMs + Decision.DelayMs;
				SetUi(EJuliusUiState::StillWaiting, LabelStillWaiting);
			}
		}
		Persist();
	}

	void FJuliusMissionSession::OnDispatchHttp(const FHttpResult& Http)
	{
		bInFlight = false;
		FAdmissionView View;
		if (!Http.bTransportError && Http.Status != 0 && !Http.Body.empty())
		{
			FJson Root;
			if (ParseJson(Http.Body, Root) && Root.Kind == FJson::EKind::Object) { FillAdmission(Root, View); }
		}
		if (!Http.bTransportError && Http.Status != 0 && View.bParsed && View.bDataRunIdPresent && View.DataRunId != CurrentRunId)
		{
			FailClosedMismatch("", Http, View);
			return;
		}
		bool bMismatch = false;
		std::string Conflicting;
		if (!Http.bTransportError && Http.Status != 0 && View.bParsed)
		{
			RememberServerRun(View, bMismatch, Conflicting);
			if (bMismatch)
			{
				FailClosedMismatch(Conflicting, Http, View);
				return;
			}
		}
		ApplyDispatchClassification(Http, View);
	}

	namespace
	{
		bool IsStatusRouteBody(const FJson& Root)
		{
			if (Root.Find("wljRunId") != nullptr) { return true; }
			if (Root.Find("data") != nullptr) { return false; }
			const FJson* State = Root.Find("state");
			return State != nullptr && State->Kind == FJson::EKind::String;
		}

		void ReadIdSlot(const FJson& Object, const char* Key, std::string& Text, WonderlandJuliusMissionLogic::EJsonSlot& Slot, bool& bWrongType)
		{
			using WonderlandJuliusMissionLogic::EJsonSlot;
			Text.clear();
			const FJson* Field = Object.Find(Key);
			if (Field == nullptr) { Slot = EJsonSlot::Absent; return; }
			if (Field->Kind == FJson::EKind::Null) { Slot = EJsonSlot::Null; return; }
			if (Field->Kind == FJson::EKind::String) { Slot = EJsonSlot::String; Text = Field->StringValue; return; }
			Slot = EJsonSlot::Absent;
			bWrongType = true;
		}

		void ReadRouteString(const FJson& Object, const char* Key, std::string& Text, bool bNullAllowed, bool& bWrongType)
		{
			Text.clear();
			const FJson* Field = Object.Find(Key);
			if (Field == nullptr) { return; }
			if (Field->Kind == FJson::EKind::Null)
			{
				if (!bNullAllowed) { bWrongType = true; }
				return;
			}
			if (Field->Kind == FJson::EKind::String) { Text = Field->StringValue; return; }
			bWrongType = true;
		}

		void ReadStatusRoute(const FJson& Root, FJuliusMissionSession::FStatusView& Out)
		{
			Out.bStatusRoute = true;
			ReadRouteString(Root, "wljRunId", Out.WljRunId, false, Out.bStatusWrongFieldType);
			ReadRouteString(Root, "serverRunId", Out.ServerRunId, false, Out.bStatusWrongFieldType);
			ReadRouteString(Root, "state", Out.DataState, false, Out.bStatusWrongFieldType);
			ReadRouteString(Root, "cause", Out.Cause, true, Out.bStatusWrongFieldType);
			ReadRouteString(Root, "dispatchedAt", Out.DispatchedAt, true, Out.bStatusWrongFieldType);
			ReadIdSlot(Root, "legacyRunId", Out.LegacyRunId, Out.LegacyRunIdSlot, Out.bStatusWrongFieldType);
			ReadIdSlot(Root, "workflowRunId", Out.WorkflowRunId, Out.WorkflowRunIdSlot, Out.bStatusWrongFieldType);
		}

		void ReadProposed(const FJson& Data, FJuliusMissionSession::FStatusView& Out)
		{
			const FJson* Running = Data.Find("providersRunning");
			if (Running != nullptr && Running->Kind == FJson::EKind::Bool)
			{
				Out.bProvidersRunningPresent = true;
				Out.bProvidersRunning = Running->BoolValue;
			}
			const FJson* Pct = Data.Find("progressPct");
			if (Pct != nullptr && Pct->Kind == FJson::EKind::Number) { Out.bProgressPctPresent = true; }
			const FJson* Step = Data.Find("progressStep");
			if (Step != nullptr && Step->Kind == FJson::EKind::String)
			{
				Out.bProgressStepPresent = true;
				Out.ProgressStep = Step->StringValue;
			}
			if (!StringField(Data, "providerRequestId", Out.ProviderRequestId, Out.bProviderRequestIdPresent))
			{
				Out.bProviderRequestIdPresent = false;
			}
			if (!StringField(Data, "modelId", Out.ModelId, Out.bModelIdPresent)) { Out.bModelIdPresent = false; }
			if (!StringField(Data, "artifactId", Out.ArtifactId, Out.bArtifactIdPresent)) { Out.bArtifactIdPresent = false; }
			if (!StringField(Data, "mime", Out.Mime, Out.bMimePresent)) { Out.bMimePresent = false; }
			const FJson* State = Data.Find("state");
			if (State != nullptr && State->Kind == FJson::EKind::String) { Out.DataState = State->StringValue; }
			const FJson* Mode = Data.Find("mode");
			if (Mode != nullptr && Mode->Kind == FJson::EKind::String) { Out.DataMode = Mode->StringValue; }
			const FJson* Run = Data.Find("runId");
			if (Run != nullptr && Run->Kind == FJson::EKind::String) { Out.DataRunId = Run->StringValue; }
			bool bServerPresent = false;
			if (!StringField(Data, "serverRunId", Out.ServerRunId, bServerPresent)) { Out.ServerRunId.clear(); }
			bool bDispatchedAtPresent = false;
			if (!StringField(Data, "dispatchedAt", Out.DispatchedAt, bDispatchedAtPresent)) { Out.DispatchedAt.clear(); }
			bool bCausePresent = false;
			if (!StringField(Data, "cause", Out.Cause, bCausePresent)) { Out.Cause.clear(); }
			const FJson* ResultSha = Data.Find("resultSha256");
			const FJson* ResultText = Data.Find("resultText");
			if (ResultText != nullptr && ResultText->Kind == FJson::EKind::String && ResultSha != nullptr && ResultSha->Kind == FJson::EKind::String)
			{
				Out.bHasResult = true;
				Out.ResultText = ResultText->StringValue;
				Out.ResultSha256 = ResultSha->StringValue;
			}
		}

		std::string ProviderExtra(const FJuliusMissionSession::FStatusView& Status)
		{
			std::string Extra = "\"provider_request_id\":";
			Extra += Status.bProviderRequestIdPresent ? JsonString(Status.ProviderRequestId) : "null";
			Extra += ",\"model_id\":";
			Extra += Status.bModelIdPresent ? JsonString(Status.ModelId) : "null";
			Extra += ",\"provider_fields\":\"PROPOSED\"";
			return Extra;
		}
	}

	void FJuliusMissionSession::ApplyFinishedResult(const FStatusView& Status)
	{
		using namespace WonderlandJuliusMissionLogic;
		FJson Inner;
		if (!ParseJson(Status.ResultText, Inner) || Inner.Kind != FJson::EKind::Object)
		{
			SetUi(EJuliusUiState::Failed, LabelArrivedDamaged);
			WriteTrace("result_received", std::string("\"finished\":\"Unreadable\",") + ProviderExtra(Status));
			bFinished = true;
			NextPollAtUtcMs = 0;
			return;
		}
		auto Str = [&Inner](const char* Key, std::string& Out, bool& bNull) {
			bNull = true;
			Out.clear();
			const FJson* Field = Inner.Find(Key);
			if (Field == nullptr || Field->Kind == FJson::EKind::Null) { return; }
			if (Field->Kind == FJson::EKind::String) { bNull = false; Out = Field->StringValue; }
		};
		std::string InnerRun, InnerMode, InnerState, Failure, ArtifactSha, ArtifactText, InnerMission;
		bool bFailureNull = true, bShaNull = true, bTextNull = true, bMissionNull = true, bRunNull = true, bModeNull = true, bStateNull = true;
		Str("runId", InnerRun, bRunNull);
		Str("mode", InnerMode, bModeNull);
		Str("state", InnerState, bStateNull);
		Str("failure", Failure, bFailureNull);
		Str("artifactSha256", ArtifactSha, bShaNull);
		Str("artifactText", ArtifactText, bTextNull);
		Str("missionId", InnerMission, bMissionNull);
		(void)bRunNull; (void)bModeNull; (void)bStateNull;
		if (bMissionNull || InnerMission != MissionId)
		{
			SetUi(EJuliusUiState::Failed, "wrong run");
			WriteTrace("result_received", std::string("\"finished\":\"WrongRun\",") + ProviderExtra(Status));
			bFinished = true;
			NextPollAtUtcMs = 0;
			return;
		}
		const EResultEnvelope Envelope = ClassifyResultEnvelope(200, true, false, "", Status.DataRunId.empty() ? CurrentRunId : Status.DataRunId,
			CurrentRunId, Status.ResultText, Status.ResultSha256);
		if (Envelope != EResultEnvelope::BodyIntact)
		{
			const char* Finished = Envelope == EResultEnvelope::Refused ? "Refused" : Envelope == EResultEnvelope::WrongRun ? "WrongRun" : "Damaged";
			SetUi(EJuliusUiState::Failed, Envelope == EResultEnvelope::WrongRun ? "wrong run" : LabelArrivedDamaged);
			WriteTrace("result_received", std::string("\"finished\":\"") + Finished + "\"," + ProviderExtra(Status));
			bFinished = true;
			NextPollAtUtcMs = 0;
			return;
		}
		FFinishedResultFields Fields;
		Fields.ExpectedRunId = CurrentRunId;
		Fields.ExpectedMode = ExpectedMode;
		Fields.DataState = Status.DataState;
		Fields.DataMode = Status.DataMode;
		Fields.InnerRunId = InnerRun;
		Fields.Mode = InnerMode;
		Fields.bFailureIsNull = bFailureNull;
		Fields.Failure = Failure;
		Fields.State = InnerState;
		Fields.bArtifactSha256IsNull = bShaNull;
		Fields.ArtifactSha256 = ArtifactSha;
		Fields.bArtifactTextIsNull = bTextNull;
		Fields.ArtifactText = ArtifactText;
		std::string ShownDigest;
		const EFinishedResult Finished = ClassifyFinishedResult(Fields, ShownDigest);
		FTransformEvidence Evidence;
		const EArtifactQualification Qualification = ClassifyArtifactQualification(Finished, ArtifactText, ArtifactSha, Evidence);
		const EQualificationDisplay Display = DisplayQualification(Qualification);
		const char* QualLabel = QualificationDisplayLabel(Display);
		std::string FinishedToken = "FailureOutcome";
		switch (Finished)
		{
		case EFinishedResult::Completed: FinishedToken = "Completed"; break;
		case EFinishedResult::FailureOutcome: FinishedToken = "FailureOutcome"; break;
		case EFinishedResult::NoArtifact: FinishedToken = "NoArtifact"; break;
		case EFinishedResult::Damaged: FinishedToken = "Damaged"; break;
		case EFinishedResult::WrongRun: FinishedToken = "WrongRun"; break;
		case EFinishedResult::ModeMismatch: FinishedToken = "ModeMismatch"; break;
		}
		WriteTrace("result_received", std::string("\"finished\":\"") + FinishedToken + "\"," + ProviderExtra(Status));
		bFinished = true;
		NextPollAtUtcMs = 0;
		bRunning = false;
		if (Finished == EFinishedResult::Completed)
		{
			Digest12 = ShownDigest;
			ArtifactQualification = QualLabel;
			SetUi(EJuliusUiState::Completed, QualLabel);
			std::string Shown = "\"artifact_id\":";
			Shown += Status.bArtifactIdPresent ? JsonString(Status.ArtifactId) : "null";
			Shown += ",\"sha256\":";
			Shown += JsonString(ArtifactSha);
			Shown += ",\"mime\":";
			Shown += Status.bMimePresent ? JsonString(Status.Mime) : "null";
			Shown += ",";
			Shown += ProviderExtra(Status);
			WriteTrace("artifact_shown", Shown);
			return;
		}
		Digest12.clear();
		ArtifactQualification = QualLabel;
		if (Finished == EFinishedResult::Damaged) { SetUi(EJuliusUiState::Failed, LabelArrivedDamaged); }
		else if (Finished == EFinishedResult::WrongRun) { SetUi(EJuliusUiState::Failed, "wrong run"); }
		else if (Finished == EFinishedResult::FailureOutcome && !bFailureNull && !Failure.empty()) { SetUi(EJuliusUiState::Failed, Failure); }
		else { SetUi(EJuliusUiState::Failed, QualLabel); }
	}

	void FJuliusMissionSession::EnsureProgress()
	{
		if (!Progress.has_value() && !CurrentRunId.empty()) { Progress.emplace(CurrentRunId); }
	}

	void FJuliusMissionSession::PublishProgress(std::size_t From)
	{
		using namespace WonderlandJuliusMissionLogic;
		if (!Progress.has_value()) { return; }
		const std::vector<FProgressTrace>& Events = Progress->Trace();
		for (std::size_t Index = From; Index < Events.size(); ++Index)
		{
			const char* Name = ProgressEventName(Events[Index].Event);
			if (std::strcmp(Name, "hold_window_expired") != 0 && std::strcmp(Name, "poll_limit_reached") != 0) { continue; }
			WriteTrace(Name, std::string("\"progress_state\":") + JsonString(ProgressStateName(Events[Index].To)));
		}
	}

	void FJuliusMissionSession::ApplyProgressUi()
	{
		using namespace WonderlandJuliusMissionLogic;
		if (!Progress.has_value() || Progress->Trace().empty()) { return; }
		const EMissionProgress State = Progress->Current();
		const EProgressEvent Event = Progress->Trace().back().Event;
		if (State == EMissionProgress::NotStarted)
		{
			// Neutral. The watch stops. This is not a refusal and not a failure.
			bRunning = false;
			NextPollAtUtcMs = 0;
			SetUi(EJuliusUiState::NotStarted, ProgressDisplayLabel(State));
			return;
		}
		if (State == EMissionProgress::OperatorStarted)
		{
			SetUi(EJuliusUiState::OperatorStarted, ProgressDisplayLabel(State));
			return;
		}
		if (State == EMissionProgress::DispatchUnconfirmed)
		{
			SetUi(EJuliusUiState::DispatchUnconfirmed, ProgressDisplayLabel(State));
			return;
		}
		if (State == EMissionProgress::AdmittedHeld && Event == EProgressEvent::StatusApplied)
		{
			SetUi(EJuliusUiState::AdmittedWaiting, ProgressDisplayLabel(State));
		}
	}

	bool FJuliusMissionSession::ProgressOwnsPoll() const
	{
		using namespace WonderlandJuliusMissionLogic;
		if (!Progress.has_value()) { return false; }
		switch (Progress->Current())
		{
		case EMissionProgress::AdmittedHeld:
		case EMissionProgress::OperatorStarted:
		case EMissionProgress::DispatchUnconfirmed:
		case EMissionProgress::Dispatched:
		case EMissionProgress::Running:
		case EMissionProgress::Paused:
		case EMissionProgress::Waiting:
			return true;
		default:
			return false;
		}
	}

	void FJuliusMissionSession::ArmPoll(std::uint64_t NowMs)
	{
		using namespace WonderlandJuliusMissionLogic;
		if (!ProgressOwnsPoll()) { return; }
		if (AdmittedAtUtcMs == 0) { AdmittedAtUtcMs = NowMs; }
		const std::uint64_t WatchedMs = NowMs >= AdmittedAtUtcMs ? NowMs - AdmittedAtUtcMs : 0;
		const std::size_t Before = Progress->Trace().size();
		const FPollDecision Decision = Progress->NextPollStep(WatchedMs);
		PublishProgress(Before);
		if (Decision.Step != EPollStep::WaitThenPoll)
		{
			NextPollAtUtcMs = 0;
			ApplyProgressUi();
			return;
		}
		NextPollAtUtcMs = NowMs + (Decision.DelayMs == 0 ? StatusPollPeriodMs : Decision.DelayMs);
	}

	void FJuliusMissionSession::NoteDispatchProgress(const FHttpResult& Http, const FAdmissionView& View, WonderlandJuliusMissionLogic::EDispatchAnswer Answer)
	{
		using namespace WonderlandJuliusMissionLogic;
		EnsureProgress();
		if (!Progress.has_value()) { return; }
		FStatusAnswer Fields;
		Fields.HttpStatus = Http.bTransportError ? 0 : Http.Status;
		Fields.bHasError = View.bHasError;
		Fields.ErrorKind = View.ErrorKind;
		Fields.bHasData = View.bHasData;
		Fields.Vocabulary = EStatusVocabulary::Admission;
		Fields.ClientRunId = View.DataRunId;
		Fields.ServerRunId = View.ServerRunId;
		Fields.Status = View.DataState;
		Fields.DispatchedAt = View.DispatchedAt;
		Fields.Cause = View.Cause;
		Fields.ReceivedUtcMs = Clock.NowUtcMs();
		const std::size_t Before = Progress->Trace().size();
		Progress->RecordDispatchAnswer(Answer, Fields);
		PublishProgress(Before);
		ApplyProgressUi();
	}

	void FJuliusMissionSession::NoteStatusProgress(const FHttpResult& Http, const FStatusView& Status)
	{
		using namespace WonderlandJuliusMissionLogic;
		EnsureProgress();
		if (!Progress.has_value()) { return; }
		FStatusAnswer Fields;
		Fields.HttpStatus = Http.bTransportError ? 0 : Http.Status;
		Fields.bHasError = Status.bHasError;
		Fields.ErrorKind = Status.ErrorKind;
		if (Status.bStatusRoute)
		{
			Fields.bHasData = true;
			Fields.Vocabulary = EStatusVocabulary::StatusRoute;
			Fields.ClientRunId = Status.WljRunId;
			Fields.ServerRunId = Status.ServerRunId;
			Fields.Status = Status.DataState;
			Fields.DispatchedAt = Status.DispatchedAt;
			Fields.Cause = Status.Cause;
			Fields.LegacyRunIdSlot = Status.LegacyRunIdSlot;
			Fields.LegacyRunId = Status.LegacyRunId;
			Fields.WorkflowRunIdSlot = Status.WorkflowRunIdSlot;
			Fields.WorkflowRunId = Status.WorkflowRunId;
			Fields.bWrongFieldType = Status.bStatusWrongFieldType;
		}
		else
		{
			Fields.bHasData = !Status.DataState.empty() || !Status.ServerRunId.empty() || !Status.DispatchedAt.empty() || !Status.Cause.empty() || !Status.DataRunId.empty();
			if (Status.DataMode == "julius" || Status.DataMode == "julius_run") { Fields.Vocabulary = EStatusVocabulary::JuliusRun; }
			else if (Status.DataMode.empty() || Status.DataMode == "admission") { Fields.Vocabulary = EStatusVocabulary::Admission; }
			else { Fields.Vocabulary = EStatusVocabulary::Unknown; }
			Fields.ClientRunId = Status.DataRunId;
			Fields.ServerRunId = Status.ServerRunId;
			Fields.Status = Status.DataState;
			Fields.DispatchedAt = Status.DispatchedAt;
			Fields.Cause = Status.Cause;
		}
		Fields.ReceivedUtcMs = Clock.NowUtcMs();
		const std::size_t Before = Progress->Trace().size();
		Progress->RecordPollAnswer(Fields);
		PublishProgress(Before);
		ApplyProgressUi();
		if (Ui != EJuliusUiState::NotStarted) { ArmPoll(Clock.NowUtcMs()); }
	}

	void FJuliusMissionSession::OnStatusHttp(const FHttpResult& Http)
	{
		bInFlight = false;
		FStatusView Status;
		std::string ProgressToken;
		if (!Http.bTransportError && Http.Status != 0 && !Http.Body.empty())
		{
			FJson Root;
			if (ParseJson(Http.Body, Root) && Root.Kind == FJson::EKind::Object)
			{
				Status.bParsed = true;
				const FJson* Error = Root.Find("error");
				if (Error != nullptr)
				{
					Status.bHasError = true;
					if (Error->Kind == FJson::EKind::Object)
					{
						const FJson* Kind = Error->Find("kind");
						if (Kind != nullptr && Kind->Kind == FJson::EKind::String) { Status.ErrorKind = Kind->StringValue; }
					}
				}
				if (IsStatusRouteBody(Root))
				{
					ReadStatusRoute(Root, Status);
				}
				else
				{
					const FJson* Data = Root.Find("data");
					if (Data != nullptr && Data->Kind == FJson::EKind::Object)
					{
						ReadProposed(*Data, Status);
						const FJson* Pct = Data->Find("progressPct");
						if (Pct != nullptr && Pct->Kind == FJson::EKind::Number) { ProgressToken = Pct->NumberToken; }
					}
				}
			}
		}
		std::string Poll = "\"http_status\":";
		Poll += std::to_string(Http.Status);
		Poll += ",\"code\":";
		if (!Status.ErrorKind.empty()) { Poll += JsonString(Status.ErrorKind); }
		else if (!Status.DataState.empty()) { Poll += JsonString(Status.DataState); }
		else if (Http.bTransportError || Http.Status == 0) { Poll += "\"transport\""; }
		else { Poll += "null"; }
		Poll += ",\"latency_ms\":";
		Poll += std::to_string(Http.LatencyMs);
		Poll += ",";
		Poll += ProviderExtra(Status);
		WriteTrace("poll", Poll);

		if (bFailClosed || bFinished || bRefused || !bAdmitted)
		{
			Persist();
			return;
		}
		NoteStatusProgress(Http, Status);
		if (Ui == EJuliusUiState::NotStarted)
		{
			Persist();
			return;
		}
		if (Status.bProvidersRunningPresent && Status.bProvidersRunning)
		{
			bRunning = true;
			SetUi(EJuliusUiState::Running, LabelRunning);
		}
		else if (Status.bProvidersRunningPresent && !Status.bProvidersRunning && bRunning)
		{
			bRunning = false;
			SetUi(EJuliusUiState::AdmittedWaiting, LabelAdmitted);
		}
		if (Status.bProgressPctPresent || Status.bProgressStepPresent)
		{
			std::string ProgressJson = "\"pct\":";
			ProgressJson += Status.bProgressPctPresent ? ProgressToken : "null";
			ProgressJson += ",\"step\":";
			ProgressJson += Status.bProgressStepPresent ? JsonString(Status.ProgressStep) : "null";
			ProgressJson += ",";
			ProgressJson += ProviderExtra(Status);
			WriteTrace("progress", ProgressJson);
		}
		if (Status.bHasResult) { ApplyFinishedResult(Status); }
		Persist();
	}

	void FJuliusMissionSession::NoteObserverReceipt(const FObserverReceipt& Receipt)
	{
		if (!WonderlandJuliusMissionLogic::IsStrictRunId(Receipt.RunId)) { return; }
		if (Receipt.RunId.compare(0, WonderlandJuliusMissionLogic::RunIdPrefix.size(), WonderlandJuliusMissionLogic::RunIdPrefix) != 0) { return; }
		std::string Line = "{\"ts_utc_ms\":";
		Line += std::to_string(Clock.NowUtcMs());
		Line += ",\"client_role\":\"observer\"";
		Line += ",\"player_net_id\":";
		Line += JsonStringOrNull(Receipt.PlayerNetId);
		Line += ",\"build_sha\":";
		Line += JsonStringOrNull(BuildSha);
		Line += ",\"package_id\":";
		Line += JsonStringOrNull(PackageId);
		Line += ",\"wlj_run_id\":";
		Line += JsonString(Receipt.RunId);
		Line += ",\"event\":\"state_change\"";
		Line += ",\"ui_state\":";
		Line += JsonString(Receipt.UiLabel);
		Line += ",\"ui_state_enum\":";
		Line += JsonString(Receipt.UiStateToken);
		if (Receipt.bServerRunIdKnown)
		{
			Line += ",\"server_run_id\":";
			Line += Receipt.ServerRunId.empty() ? "null" : JsonString(Receipt.ServerRunId);
		}
		Line += ",\"observer_hook\":true}\n";
		Trace.Append(Receipt.RunId, Line);
	}

	std::string FJuliusMissionSession::StatusJson() const
	{
		const std::uint64_t NowMs = Clock.NowUtcMs();
		std::string Out = "{\"ui_state\":";
		Out += JsonString(UiStateToken(Ui));
		Out += ",\"ui_label\":";
		Out += JsonString(Label);
		Out += ",\"wlj_run_id\":";
		Out += JsonStringOrNull(CurrentRunId);
		Out += ",\"server_run_id\":";
		Out += bServerRunIdKnown ? JsonString(CurrentServerRunId) : "null";
		Out += ",\"mission_id\":";
		Out += JsonStringOrNull(MissionId);
		Out += ",\"attempt_count\":";
		Out += std::to_string(AttemptCount);
		Out += ",\"resends_sent\":";
		Out += std::to_string(ResendsSent);
		Out += ",\"waited_ms\":";
		Out += std::to_string(WaitedMs(NowMs));
		Out += ",\"open\":";
		Out += bPairOpen ? "true" : "false";
		Out += ",\"admitted\":";
		Out += bAdmitted ? "true" : "false";
		Out += ",\"fail_closed\":";
		Out += bFailClosed ? "true" : "false";
		Out += ",\"artifact_label\":";
		Out += ArtifactQualification.empty() ? "null" : JsonString(ArtifactQualification);
		Out += ",\"artifact_digest12\":";
		Out += Digest12.empty() ? "null" : JsonString(Digest12);
		Out += ",\"trace_file\":";
		Out += JsonStringOrNull(TraceLocation());
		Out += "}";
		return Out;
	}

	std::string FJuliusMissionSession::TraceLocation() const
	{
		if (!CurrentRunId.empty()) { return Trace.PathFor(CurrentRunId); }
		return Trace.PathFor(UnmintedTraceName);
	}
}

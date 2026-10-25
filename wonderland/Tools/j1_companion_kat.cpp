// j1_companion_kat.cpp -- standalone known-answer test for WonderlandCompanionLogic (no Unreal, no network).
// Build: see /workspace/cosmo-work/companion/build_and_test.sh. Exit 0 and one "J1 COMPANION KAT PASS" line, or
// exit 1 with every failing check named.
#include "WonderlandCompanionLogic.h"
#include "WonderlandJuliusMissionProgress.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_set>
#include <vector>

using namespace WonderlandCompanionLogic;

namespace
{
	int Failures = 0;
	enum ESection { Json, Sse, Chat, Session, Key, Status, Pin, History, Result, Route, Answers, Mint, Agents, Multi, Unsupported, Isolation, Caps,
		Verified, Bridge, Trace, SectionCount };
	int Checks[SectionCount] = {};
	const char* SectionNames[SectionCount] = {"json", "sse", "chat", "session", "key", "status", "pin", "history", "result", "route", "answers", "mint",
		"agents", "multi", "unsupported", "isolation", "caps", "verified", "bridge", "trace"};

	void Expect(ESection S, bool bOk, const char* What, int Line)
	{
		++Checks[S];
		if (!bOk)
		{
			++Failures;
			std::printf("FAIL [%s] line %d: %s\n", SectionNames[S], Line, What);
		}
	}
#define EXPECT(S, Cond) Expect(S, (Cond), #Cond, __LINE__)

	const std::string U1 = "123e4567-e89b-42d3-a456-426614174000";
	const std::string U2 = "9b2f1c3e-0d4a-4e5f-8a6b-7c8d9e0f1a2b";
	const std::string U3 = "00000000-0000-4000-8000-000000000003";
	const std::string Wlj = "wlj_" + U1;
	const std::string OtherWlj = "wlj_" + U2;
	const std::string Conv = "cnv_" + U2;
	const std::string Origin = "http://127.0.0.1:47123";
	const std::string Msg1 = "msg_" + U1;
	const std::string Msg2 = "msg_" + U2;

	std::string Idem(int N)
	{
		char Buf[40];
		std::snprintf(Buf, sizeof(Buf), "00000000-0000-4000-8000-%012d", N);
		return Buf;
	}

	std::string Ev(const std::string& Name, const std::string& Data) { return "event: " + Name + "\ndata: " + Data + "\n\n"; }

	// BRIDGE 7e5e1e30 agentIds are "agt_" + a canonical UUIDv4 (registry.ts:21). Test ids are a fixed function of a tag.
	std::string Ag(const std::string& Tag)
	{
		static const char* Hex = "0123456789abcdef";
		std::string U;
		for (std::uint64_t Seed : {1469598103934665603ULL, 1099511628211ULL})
		{
			std::uint64_t H = Seed;
			for (const char C : Tag) { H = (H ^ static_cast<unsigned char>(C)) * 1099511628211ULL; }
			for (int I = 0; I < 16; ++I) { U += Hex[(H >> (4 * I)) & 0xF]; }
		}
		U[12] = '4';
		U[16] = Hex[8 + (U[16] % 4)];
		return "agt_" + U.substr(0, 8) + "-" + U.substr(8, 4) + "-" + U.substr(12, 4) + "-" + U.substr(16, 4) + "-" + U.substr(20, 12);
	}
	// The paired project every companion route names (?projectId=, admission-route.ts:288).
	const std::string Project = "project-1";
	const std::string PQ = "?projectId=" + Project;

	// Test data only: providerIds are opaque strings to the core. The default test agent's provider, and a second one.
	const std::string TestProvider = "openai";
	const std::string OtherProvider = "acme.local:v2";

	std::string MetaFor(const std::string& Provider, const std::string& ConvId = Conv, const std::string& Extra = "", const std::string& MsgId = Msg1)
	{
		return Ev("meta", "{\"conversationId\":\"" + ConvId + "\",\"messageId\":\"" + MsgId + "\",\"provider\":\"" + Provider + "\",\"mode\":\"api_key\",\"model\":\"srv-model-x\"" + Extra + "}");
	}
	std::string Meta(const std::string& ConvId = Conv, const std::string& Extra = "", const std::string& MsgId = Msg1)
	{
		return MetaFor(TestProvider, ConvId, Extra, MsgId);
	}
	std::string Replayed(const std::string& ConvId = Conv, const std::string& MsgId = Msg1) { return Meta(ConvId, ",\"replayed\":true", MsgId); }
	std::string Delta(const std::string& Text) { return Ev("delta", "{\"text\":\"" + Text + "\"}"); }
	std::string Done(const std::string& Msg = Msg1, const std::string& Reason = "stop")
	{
		return Ev("done", "{\"messageId\":\"" + Msg + "\",\"finishReason\":\"" + Reason + "\",\"usage\":{\"inputTokens\":12,\"outputTokens\":34}}");
	}
	std::string Err(const std::string& Kind, const std::string& Msg, const std::string& Extra = "")
	{
		return Ev("error", "{\"kind\":\"" + Kind + "\",\"message\":\"" + Msg + "\"" + Extra + "}");
	}

	std::string Flatten(const std::vector<FSseEvent>& Events)
	{
		std::string Out;
		for (const FSseEvent& E : Events) { Out += "[" + E.Event + "|" + E.Data + "|" + E.LastEventId + "]"; }
		return Out;
	}

	std::string ParseAll(const std::string& Stream, std::size_t Split1 = std::string::npos, bool bByteWise = false, bool* bFailed = nullptr)
	{
		FSseParser P;
		std::vector<FSseEvent> Out;
		if (bByteWise)
		{
			for (const char C : Stream) { P.Feed(std::string_view(&C, 1), Out); }
		}
		else if (Split1 == std::string::npos) { P.Feed(Stream, Out); }
		else
		{
			P.Feed(std::string_view(Stream).substr(0, Split1), Out);
			P.Feed(std::string_view(Stream).substr(Split1), Out);
		}
		if (bFailed != nullptr) { *bFailed = P.Failed(); }
		return Flatten(Out) + "#c" + std::to_string(P.CommentCount());
	}

	bool AllSplitsAgree(const std::string& Stream)
	{
		const std::string Want = ParseAll(Stream);
		for (std::size_t I = 0; I <= Stream.size(); ++I)
		{
			if (ParseAll(Stream, I) != Want) { return false; }
		}
		return ParseAll(Stream, std::string::npos, true) == Want;
	}

	struct FChatRun
	{
		EChatStreamOutcome Outcome;
		EChatProtocolFault Fault;
		std::string Reply;
	};

	FChatRun RunChat(const std::string& Stream, const std::string& Expected = "", bool bReplay = false, std::size_t Split = std::string::npos,
		const std::string& ExpectedMsg = "")
	{
		FChatStreamDecoder D(TestProvider, Expected, bReplay, ExpectedMsg);
		if (Split == std::string::npos) { D.Feed(Stream); }
		else
		{
			D.Feed(std::string_view(Stream).substr(0, Split));
			D.Feed(std::string_view(Stream).substr(Split));
		}
		D.Finish();
		return {D.Outcome(), D.Fault(), D.ReplyForDisplay()};
	}

	bool Contains(const std::string& Hay, const std::string& Needle) { return Hay.find(Needle) != std::string::npos; }

	/* ------------------------------------------------------------ JSON */
	void TestJson()
	{
		FJsonValue V;
		EXPECT(Json, ParseJson("{\"a\":[1,true,null,\"x\"],\"b\":{\"c\":-1.5e3}}", V) && V.IsObject() && V.Members.size() == 2);
		EXPECT(Json, ParseJson(" \"\\u00e9\\n\" ", V) && V.Text == "\xC3\xA9\n");
		EXPECT(Json, !ParseJson("{\"a\":1,\"a\":2}", V));
		EXPECT(Json, !ParseJson("{\"a\":1} x", V));
		EXPECT(Json, !ParseJson("{\"a\":1,}", V));
		EXPECT(Json, !ParseJson("[01]", V));
		EXPECT(Json, !ParseJson("\"\x01\"", V));
		EXPECT(Json, !ParseJson("\"\xC0\xAF\"", V));
		EXPECT(Json, !ParseJson("\"\xED\xA0\x80\"", V));
		EXPECT(Json, !ParseJson("'a'", V));
		EXPECT(Json, !ParseJson("", V));
		EXPECT(Json, ParseJson(std::string(16, '[') + std::string(16, ']'), V));
		EXPECT(Json, !ParseJson(std::string(17, '[') + std::string(17, ']'), V));
		EXPECT(Json, ParseJson("\"\\ud83d\\ude00\"", V) && V.Text == "\xF0\x9F\x98\x80");
		EXPECT(Json, ParseJson("\"\\ud83d\"", V) && V.Text == "\xED\xA0\xBD");
		std::uint64_t N = 0;
		EXPECT(Json, ParseJson("9007199254740991", V) && JsonToSafeUnsigned(V, N) && N == 9007199254740991ull);
		EXPECT(Json, ParseJson("9007199254740992", V) && !JsonToSafeUnsigned(V, N));
		EXPECT(Json, ParseJson("-1", V) && !JsonToSafeUnsigned(V, N));
		EXPECT(Json, ParseJson("1.0", V) && !JsonToSafeUnsigned(V, N));
		std::string S;
		AppendJsonString(S, "a\"b\\c\n\x01");
		EXPECT(Json, S == "\"a\\\"b\\\\c\\u000a\\u0001\"");
		EXPECT(Json, ParseJson(S, V) && V.Text == "a\"b\\c\n\x01");
		EXPECT(Json, SanitizeUntrustedText("a\r\nb\rc\x07\x7f" "\xC2\x85" "d\t") == "a\nb\ncd\t");
		EXPECT(Json, SanitizeUntrustedText("x\xE2\x80\xAEy\xE2\x81\xA6z") == "xyz");
		EXPECT(Json, SanitizeUntrustedText("\xED\xA0\xBD\xED\xB8\x80") == "\xF0\x9F\x98\x80");
		EXPECT(Json, SanitizeUntrustedText("\xED\xA0\xBD!") == "\xEF\xBF\xBD!");
		EXPECT(Json, SanitizeUntrustedText("\xFF") == "\xEF\xBF\xBD");
		EXPECT(Json, IsValidUtf8("\xF0\x9F\x98\x80") && !IsValidUtf8("\xF4\x90\x80\x80"));
	}

	/* ------------------------------------------------------------ SSE */
	void TestSse()
	{
		const std::string Canon = ": hello\nevent: meta\ndata: {\"a\":1}\nid: 7\n\ndata: line1\ndata:line2\ndata\n\n: ping\n\nevent: x\n\ndata: tail\n\n";
		const std::string Want = "[meta|{\"a\":1}|7][message|line1\nline2\n|7][message|tail|7]#c2";
		EXPECT(Sse, ParseAll(Canon) == Want);
		EXPECT(Sse, AllSplitsAgree(Canon));
		std::string Cr = Canon;
		for (char& C : Cr) { if (C == '\n') { C = '\r'; } }
		EXPECT(Sse, ParseAll(Cr) == Want);
		EXPECT(Sse, AllSplitsAgree(Cr));
		std::string Crlf;
		for (const char C : Canon) { if (C == '\n') { Crlf += "\r\n"; } else { Crlf += C; } }
		EXPECT(Sse, ParseAll(Crlf) == Want);
		EXPECT(Sse, AllSplitsAgree(Crlf));
		// CR then LF in the next chunk is ONE line end, not two (an empty line would dispatch early).
		EXPECT(Sse, ParseAll("data: a\r\ndata: b\r\n\r\n", 8) == "[message|a\nb|]#c0");
		EXPECT(Sse, ParseAll("data: a\r\ndata: b\r\n\r\n", 18) == "[message|a\nb|]#c0");
		// A comment line is never a field.
		EXPECT(Sse, ParseAll(":data: x\n\n") == "#c1");
		EXPECT(Sse, ParseAll(": event: error\ndata: y\n\n") == "[message|y|]#c1");
		EXPECT(Sse, ParseAll("data:  two\n\n") == "[message| two|]#c0");
		EXPECT(Sse, ParseAll("event: meta\n\ndata: z\n\n") == "[message|z|]#c0");
		EXPECT(Sse, ParseAll("\xEF\xBB\xBF" "data: bom\n\n") == "[message|bom|]#c0");
		EXPECT(Sse, AllSplitsAgree("\xEF\xBB\xBF" "data: bom\n\n"));
		EXPECT(Sse, ParseAll("\xEF\xBB" "data: x\n\n") == "#c0");
		EXPECT(Sse, ParseAll("data: x\n\n\xEF\xBB\xBF" "data: y\n\n") == "[message|x|]#c0");
		EXPECT(Sse, ParseAll("retry: 10\nfoo: bar\ndata: k\n\n") == "[message|k|]#c0");
		{
			FSseParser P;
			std::vector<FSseEvent> Out;
			P.Feed("data: partial", Out);
			EXPECT(Sse, Out.empty() && P.FinishHadPartialEvent());
			FSseParser Q;
			Q.Feed("data: done\n\n", Out);
			EXPECT(Sse, Out.size() == 1 && !Q.FinishHadPartialEvent());
		}
		{
			FSseParser P(16, 64);
			std::vector<FSseEvent> Out;
			EXPECT(Sse, P.Feed(std::string("data: ") + std::string(10, 'a') + "\n\n", Out) && Out.size() == 1);
			EXPECT(Sse, !P.Feed(std::string("data: ") + std::string(11, 'a') + "\n\n", Out) && P.GetFault() == ESseFault::LineTooLong);
			EXPECT(Sse, !P.Feed("data: ok\n\n", Out) && Out.size() == 1);
		}
		{
			FSseParser P(1024, 8);
			std::vector<FSseEvent> Out;
			EXPECT(Sse, P.Feed("data: 1234567\n\n", Out) && Out.size() == 1);
			EXPECT(Sse, P.Feed("data: 123\ndata: 123\n\n", Out) && Out.size() == 2);
			EXPECT(Sse, !P.Feed("data: 1234\ndata: 1234\n\n", Out) && P.GetFault() == ESseFault::EventTooLarge && Out.size() == 2);
		}
		{
			FSseParser P;
			std::vector<FSseEvent> Out;
			const std::string Big(SseMaxLineBytes - 6, 'q');
			EXPECT(Sse, P.Feed("data: " + Big + "\n\n", Out) && Out.size() == 1);
			EXPECT(Sse, !P.Feed("data: " + Big + "q\n\n", Out));
		}
	}

	/* ------------------------------------------------------------ chat stream */
	void TestChat()
	{
		const std::string Good = Meta() + ": ping\n\n" + Delta("Hel") + Delta("lo") + Done();
		{
			FChatStreamDecoder D(TestProvider, "", false);
			D.Feed(Good);
			EXPECT(Chat, D.Outcome() == EChatStreamOutcome::Done && D.ReplyForDisplay() == "Hello" && D.Model() == "srv-model-x");
			EXPECT(Chat, D.ConversationId() == Conv && D.MessageId() == Msg1 && D.FinishReason() == "stop");
			EXPECT(Chat, D.InputTokens() == 12 && D.OutputTokens() == 34 && D.Pings() == 1 && !D.IsReplayed() && !D.HitLengthLimit());
			D.Feed(Delta("more") + Done());
			EXPECT(Chat, D.IgnoredAfterEnd() == 2 && D.ReplyForDisplay() == "Hello");
		}
		bool bSplitsOk = true;
		for (std::size_t I = 0; I <= Good.size(); ++I)
		{
			const FChatRun R = RunChat(Good, "", false, I);
			if (R.Outcome != EChatStreamOutcome::Done || R.Reply != "Hello") { bSplitsOk = false; }
		}
		EXPECT(Chat, bSplitsOk);
		EXPECT(Chat, RunChat(Good, Conv).Outcome == EChatStreamOutcome::Done);
		EXPECT(Chat, RunChat(Good, "cnv_" + U3).Fault == EChatProtocolFault::ConversationMismatch);
		EXPECT(Chat, RunChat(Delta("x") + Done()).Fault == EChatProtocolFault::MetaMissing);
		EXPECT(Chat, RunChat(Done()).Fault == EChatProtocolFault::MetaMissing);
		EXPECT(Chat, RunChat(Replayed() + Delta("again") + Done(), Conv, true).Outcome == EChatStreamOutcome::Done);
		EXPECT(Chat, RunChat(Replayed() + Delta("again") + Done(), Conv, true).Reply == "again");
		EXPECT(Chat, RunChat(Meta() + Meta() + Done()).Fault == EChatProtocolFault::MetaDuplicate);
		std::string WrongProvider = Meta();
		WrongProvider.replace(WrongProvider.find("\"openai\""), 8, "\"xai\"");
		EXPECT(Chat, RunChat(WrongProvider + Done()).Fault == EChatProtocolFault::MetaWrongProvider);
		// A7: meta "provider" must equal THIS agent's providerId (opaque); an empty expectation never matches.
		{
			FChatStreamDecoder D(OtherProvider, "", false);
			D.Feed(MetaFor(OtherProvider) + Delta("x") + Done());
			EXPECT(Chat, D.Outcome() == EChatStreamOutcome::Done);
			FChatStreamDecoder E(OtherProvider, "", false);
			E.Feed(Meta() + Delta("x") + Done());
			EXPECT(Chat, E.Fault() == EChatProtocolFault::MetaWrongProvider);
			FChatStreamDecoder Z("", "", false);
			Z.Feed(MetaFor("") + Delta("x") + Done());
			EXPECT(Chat, Z.Fault() == EChatProtocolFault::MetaWrongProvider);
		}
		std::string WrongMode = Meta();
		WrongMode.replace(WrongMode.find("\"api_key\""), 9, "\"siwc_plan\"");
		EXPECT(Chat, RunChat(WrongMode + Done()).Fault == EChatProtocolFault::MetaWrongMode);
		EXPECT(Chat, RunChat(Meta("cnv_" + U1.substr(0, 35)) + Done()).Fault == EChatProtocolFault::MetaBadConversationId);
		EXPECT(Chat, RunChat(Meta("CNV_" + U2) + Done()).Fault == EChatProtocolFault::MetaBadConversationId);
		EXPECT(Chat, RunChat(Meta(Conv, ",\"simulated\":\"yes\"") + Done()).Fault == EChatProtocolFault::MetaBadSimulated);
		EXPECT(Chat, RunChat(Meta() + Delta("x") + Done(Msg2)).Fault == EChatProtocolFault::DoneMessageMismatch);
		EXPECT(Chat, RunChat(Meta() + Ev("done", "{\"messageId\":\"" + Msg1 + "\",\"finishReason\":\"stop\"}")).Fault == EChatProtocolFault::DoneBadFields);
		EXPECT(Chat, RunChat(Meta() + Ev("done", "{\"messageId\":\"" + Msg1 + "\",\"finishReason\":\"stop\",\"usage\":{\"inputTokens\":-1,\"outputTokens\":0}}")).Fault == EChatProtocolFault::DoneBadFields);
		EXPECT(Chat, RunChat(Meta() + Ev("delta", "{\"text\":5}")).Fault == EChatProtocolFault::DeltaBadText);
		EXPECT(Chat, RunChat(Meta() + Ev("delta", "{\"text\":\"a\"")).Fault == EChatProtocolFault::BadJson);
		EXPECT(Chat, RunChat(Meta() + Ev("tool_call", "{}")).Fault == EChatProtocolFault::UnknownEvent);
		EXPECT(Chat, RunChat(Meta() + "data: {}\n\n").Fault == EChatProtocolFault::UnknownEvent);
		const FChatRun Cut = RunChat(Meta() + Delta("half"));
		EXPECT(Chat, Cut.Outcome == EChatStreamOutcome::ProtocolError && Cut.Fault == EChatProtocolFault::Truncated && Cut.Reply.empty());
		EXPECT(Chat, RunChat(Meta() + Delta("x") + "event: done\ndata: {").Fault == EChatProtocolFault::Truncated);
		{
			FChatStreamDecoder D(TestProvider, "", false);
			D.Feed(Meta() + Delta("partial") + Err("provider_rate_limited", "slow", ",\"retryAfterMs\":2500"));
			EXPECT(Chat, D.Outcome() == EChatStreamOutcome::ProviderError && D.ErrorKind() == EChatErrorKind::ProviderRateLimited);
			EXPECT(Chat, D.HasRetryAfter() && D.RetryAfterMs() == 2500 && D.ReplyForDisplay().empty());
		}
		{
			FChatStreamDecoder D(TestProvider, "", false);
			D.Feed(Meta() + Err("provider_refused", "No.\\u202e evil\\r\\nline"));
			EXPECT(Chat, D.ErrorKind() == EChatErrorKind::ProviderRefused && D.ErrorMessage() == "No. evil\nline");
		}
		EXPECT(Chat, ClassifyChatErrorKind("provider_auth_failed") == EChatErrorKind::ProviderAuthFailed);
		EXPECT(Chat, ClassifyChatErrorKind("provider_quota_exhausted") == EChatErrorKind::ProviderQuotaExhausted);
		EXPECT(Chat, ClassifyChatErrorKind("provider_unavailable") == EChatErrorKind::ProviderUnavailable);
		EXPECT(Chat, ClassifyChatErrorKind("companion_internal") == EChatErrorKind::CompanionInternal);
		EXPECT(Chat, ClassifyChatErrorKind("fallback_used") == EChatErrorKind::Unknown);
		EXPECT(Chat, RunChat(Meta() + Err("Bad Kind", "x")).Fault == EChatProtocolFault::ErrorBadFields);
		EXPECT(Chat, RunChat(Meta() + Err("provider_unavailable", std::string(ErrorMessageMaxBytes + 1, 'm'))).Fault == EChatProtocolFault::ErrorBadFields);
		EXPECT(Chat, RunChat(Meta() + Delta("\\ud83d") + Delta("\\ude00") + Done()).Reply == "\xF0\x9F\x98\x80");
		EXPECT(Chat, RunChat(Meta() + Delta("a\\u0007b\\u202ec") + Done()).Reply == "abc");
		{
			// Exactly ChatMaxReplyBytes of delta text is accepted; one more byte fails closed and clears the reply.
			std::string Stream = Meta();
			std::size_t Left = ChatMaxReplyBytes;
			while (Left > 0)
			{
				const std::size_t N = Left < 60000 ? Left : 60000;
				Stream += Delta(std::string(N, 'r'));
				Left -= N;
			}
			FChatStreamDecoder D(TestProvider, "", false);
			D.Feed(Stream + Done());
			EXPECT(Chat, D.Outcome() == EChatStreamOutcome::Done && D.ReplyBytes() == ChatMaxReplyBytes);
			FChatStreamDecoder E(TestProvider, "", false);
			E.Feed(Stream + Delta("r") + Done());
			EXPECT(Chat, E.Fault() == EChatProtocolFault::ReplyTooLarge && E.ReplyBytes() == 0);
		}
		EXPECT(Chat, RunChat(Meta() + "data: " + std::string(SseMaxLineBytes, 'x') + "\n\n").Fault == EChatProtocolFault::SseLineTooLong);
		EXPECT(Chat, IsConversationId(Conv) && !IsConversationId(Wlj) && !IsConversationId("cnv_"));
		EXPECT(Chat, std::strcmp(ChatProtocolFaultName(EChatProtocolFault::Truncated), "truncated") == 0);
	}

	/* ------------------------------------------------------------ session helpers */
	const std::string OddLabel = "Lbl-From-Server \xE2\x9C\x93 #7";
	const std::string TestAgent = Ag("main");
	const std::string DeclaredDefault = "[\"chat\",\"history\"]";
	const std::string AuthorizedDefault = "[\"chat\"]";
	const std::string Auto = "<auto>";

	std::string JsonOrNull(const std::string& V) { return V == "null" ? V : "\"" + V + "\""; }

	/**
	 * One AgentDescriptor as BRIDGE publishes it (registry.ts:28-37, 189-214). Auto: unsupported / error carry no kind
	 * and no capability, unsupported no adapterVersion; otherwise kind "single" and the default capabilities.
	 * Name or Kind "null" emits JSON null.
	 */
	std::string Descriptor(const std::string& AgentId, const std::string& Provider, const std::string& Connection = "connected",
		const std::string& Declared = Auto, const std::string& Authorized = Auto, const std::string& Extra = "",
		const std::string& Name = "Agent One", const std::string& Kind = Auto)
	{
		const bool bHidden = Connection == "unsupported" || Connection == "error";
		const std::string D = Declared != Auto ? Declared : (bHidden ? "[]" : DeclaredDefault);
		const std::string A = Authorized != Auto ? Authorized : (bHidden ? "[]" : AuthorizedDefault);
		const std::string K = Kind != Auto ? Kind : (bHidden ? "null" : "single");
		const std::string V = Connection == "unsupported" ? "null" : "\"1.4.2\"";
		return "{\"agentId\":\"" + AgentId + "\",\"providerId\":\"" + Provider + "\",\"displayName\":" + JsonOrNull(Name) + ",\"kind\":" + JsonOrNull(K)
			+ ",\"adapterVersion\":" + V + ",\"declaredCapabilities\":" + D + ",\"authorizedCapabilities\":" + A
			+ ",\"connection\":\"" + Connection + "\"" + Extra + "}";
	}
	const std::string ConnectOk = Descriptor(TestAgent, TestProvider);
	const std::string Sentinel = "sk-SENTINEL-9f8e7d-KEYMATERIAL";
	std::string Gone(const std::string& Id, const std::string& Provider = TestProvider) { return Descriptor(Id, Provider, "disconnected", DeclaredDefault, "[]"); }

	FAgentSlot SlotOf(const std::string& Json)
	{
		FJsonValue V;
		if (!ParseJson(Json, V)) { return FAgentSlot(); }
		return ParseAgentDescriptor(V);
	}

	/** {"agents": <ListJson>} through ParseAgentList. */
	std::vector<FAgentSlot> Slots(const std::string& ListJson)
	{
		FJsonValue V;
		std::vector<FAgentSlot> Out;
		if (ParseJson("{\"agents\":" + ListJson + "}", V)) { ParseAgentList(V, Out); }
		return Out;
	}

	const FAgentView& MissingView()
	{
		static const FAgentView V = [] {
			FAgentView M;
			M.StatusLine = "<no such agent>";
			return M;
		}();
		return V;
	}
	const FTurnHistory& EmptyHistory()
	{
		static const FTurnHistory H;
		return H;
	}

	/** Test-side view of ONE agent of a registry session (the v0.1 tests' single-companion calls, per agentId). */
	struct FOneAgent
	{
		FCompanionSession S;
		std::string Id = TestAgent;
		std::string Provider = TestProvider;

		// The v0.1 chat tests drive a relay that serves the (not yet served) chat route.
		explicit FOneAgent(const std::string& RelayOrigin) : S(RelayOrigin, Project, true) {}
		bool Has() const { return S.View(Id) != nullptr; }
		const FAgentView& View() const
		{
			const FAgentView* V = S.View(Id);
			return V != nullptr ? *V : MissingView();
		}
		const FCompanionSessionView& SessionView() const { return S.SessionView(); }
		bool BeginConnect(FRelayRequest& Out, const std::string& Run = "", const std::string& Label = "") { return S.BeginConnect(Provider, Run, Label, Out); }
		void ApplyConnectAnswer(int Status, const std::string& Body, std::uint64_t Now) { S.ApplyConnectAnswer(Status, Body, Now); }
		FRelayRequest BeginDisconnect() { return S.BeginDisconnect(Id); }
		void ApplyDisconnectAnswer(int Status, const std::string& Body) { S.ApplyDisconnectAnswer(Id, Status, Body); }
		void ApplyKeyMintFailure() { S.ApplyKeyMintFailure(Id); }
		bool BeginMessage(const std::string& M, const std::string& K, const std::string& Run, std::uint64_t Now, FRelayRequest& Out)
		{
			return S.BeginMessage(Id, M, K, Run, Now, Out);
		}
		void ApplyChatHttpAnswer(int Status, const std::string& RetryAfter, const std::string& Body, std::uint64_t Now)
		{
			S.ApplyChatHttpAnswer(Id, Status, RetryAfter, Body, Now);
		}
		void FeedChatBytes(const std::string& Chunk, std::uint64_t Now) { S.FeedChatBytes(Id, Chunk, Now); }
		void FinishChatStream(std::uint64_t Now) { S.FinishChatStream(Id, Now); }
		void ApplyChatTransportFailure(std::uint64_t Now) { S.ApplyChatTransportFailure(Id, Now); }
		bool BeginResend(std::uint64_t Now, FRelayRequest& Out) { return S.BeginResend(Id, Now, Out); }
		const FTurnHistory& History() const
		{
			const FTurnHistory* H = S.History(Id);
			return H != nullptr ? *H : EmptyHistory();
		}
		FRelayRequest BeginDeleteHistory() { return S.BeginDeleteHistory(Id); }
		void ApplyDeleteHistoryAnswer(int Status) { S.ApplyDeleteHistoryAnswer(Id, Status); }
		std::string ConversationId() const { return S.ConversationId(Id); }
		const std::vector<std::string>& Trace() const { return S.Trace(); }
	};

	std::string Everything(const FCompanionSession& S)
	{
		std::string All;
		for (const std::string& L : S.Trace()) { All += L + "\n"; }
		All += S.SessionView().StatusLine;
		for (const std::string& Id : S.AgentIds())
		{
			const FAgentView& V = *S.View(Id);
			All += V.DisplayName + V.AdapterVersion + V.StatusLine + V.RefusalText + V.PartialReply + S.ConversationId(Id);
			for (const std::string& C : V.AuthorizedCapabilities) { All += C; }
			const FTurnHistory& H = *S.History(Id);
			for (std::size_t I = 0; I < H.Size(); ++I)
			{
				const FTurn& T = H.At(I);
				All += T.PlayerText + T.ReplyText + T.MessageId + T.Model + T.FinishReason;
			}
		}
		return All;
	}
	std::string Everything(const FOneAgent& A) { return Everything(A.S); }

	// Connect Provider (no key: BRIDGE refuses credentials); the answer is Answer. Returns false if BeginConnect refused.
	bool ConnectAs(FCompanionSession& S, const std::string& Provider, int Status, const std::string& Answer)
	{
		FRelayRequest R;
		if (!S.BeginConnect(Provider, "", "", R)) { return false; }
		S.ApplyConnectAnswer(Status, Answer, 0);
		return true;
	}

	// The test agent reached Ready. Returns false if any step misbehaved.
	bool MakeReady(FOneAgent& S)
	{
		if (!ConnectAs(S.S, S.Provider, 201, Descriptor(S.Id, S.Provider))) { return false; }
		return S.View().State == ECompanionState::Ready && S.S.LastConnectedAgentId() == S.Id;
	}

	bool Send(FOneAgent& S, const std::string& Msg, int K, std::uint64_t Now = 0, const std::string& Run = "", FRelayRequest* Out = nullptr)
	{
		FRelayRequest R;
		const bool bOk = S.BeginMessage(Msg, Idem(K), Run, Now, R);
		if (Out != nullptr) { *Out = R; }
		return bOk;
	}

	bool SendTo(FCompanionSession& S, const std::string& Agent, const std::string& Msg, int K, std::uint64_t Now = 0, FRelayRequest* Out = nullptr)
	{
		FRelayRequest R;
		const bool bOk = S.BeginMessage(Agent, Msg, Idem(K), "", Now, R);
		if (Out != nullptr) { *Out = R; }
		return bOk;
	}

	std::string KindBody0(const std::string& Kind) { return "{\"error\":{\"kind\":\"" + Kind + "\",\"message\":\"x\"}}"; }
	bool TraceHas0(const FCompanionSession& S, const std::string& Word)
	{
		for (const std::string& L : S.Trace())
		{
			if (L == Word) { return true; }
		}
		return false;
	}

	/* ------------------------------------------------------------ key handling and connect */
	void TestKey()
	{
		EXPECT(Key, IsLoopbackRelayOrigin("http://127.0.0.1:1") && IsLoopbackRelayOrigin("http://127.0.0.1:65535"));
		EXPECT(Key, IsLoopbackRelayOrigin("http://[::1]:8080"));
		EXPECT(Key, !IsLoopbackRelayOrigin("http://127.0.0.1:0") && !IsLoopbackRelayOrigin("http://127.0.0.1:65536"));
		EXPECT(Key, !IsLoopbackRelayOrigin("http://127.0.0.1:08080") && !IsLoopbackRelayOrigin("http://127.0.0.1"));
		EXPECT(Key, !IsLoopbackRelayOrigin("http://localhost:8080") && !IsLoopbackRelayOrigin("https://127.0.0.1:8080"));
		EXPECT(Key, !IsLoopbackRelayOrigin("http://127.0.0.1:8080/") && !IsLoopbackRelayOrigin("http://127.0.0.1.evil.com:80"));
		EXPECT(Key, !IsLoopbackRelayOrigin("http://127.0.0.2:8080") && !IsLoopbackRelayOrigin("http://user@127.0.0.1:8080"));
		EXPECT(Key, !IsLoopbackRelayOrigin("https://api.openai.com:443"));
		{
			FMaskedKeyField A;
			FMaskedKeyField B;
			EXPECT(Key, A.IsEmpty() && A.MaskText().empty());
			A.Append("sk-a");
			B.Append(Sentinel + Sentinel);
			EXPECT(Key, A.MaskText() == B.MaskText() && !A.MaskText().empty());
			EXPECT(Key, !Contains(std::string(A.MaskText()), "sk") && !Contains(std::string(B.MaskText()), "L"));
			A.Backspace();
			A.Clear();
			EXPECT(Key, A.IsEmpty());
		}
		{
			// Connect (route.ts:288-319, contract:111-131): providerId only, no credential, no idempotency key, 201.
			FOneAgent S(Origin);
			FRelayRequest R;
			EXPECT(Key, S.BeginConnect(R) && R.Method == "POST" && R.Url == Origin + "/relay-api/wonderland/companions/agents" + PQ);
			EXPECT(Key, R.Body == "{\"providerId\":\"" + TestProvider + "\"}" && R.IdempotencyKey.empty());
			for (const char* Word : {"apiKey", "key", "token", "password", "secret", "mode", "agentId"}) { EXPECT(Key, !Contains(R.Body, std::string("\"") + Word + "\"")); }
			EXPECT(Key, S.SessionView().bConnecting && S.SessionView().StatusLine == "Connecting" && !S.SessionView().bCanConnect);
			S.ApplyConnectAnswer(201, ConnectOk, 0);
			EXPECT(Key, S.View().State == ECompanionState::Ready && !S.View().bShowSimulatedBanner && !S.SessionView().bShowSimulatedBanner);
			EXPECT(Key, S.BeginMessage("hi", Idem(2), "", 0, R) && !Contains(R.Body, "apiKey"));
			S.FeedChatBytes(Meta() + Delta("ok") + Done(), 0);
			EXPECT(Key, !Contains(Everything(S), TestAgent) && !Contains(Everything(S), TestProvider + "\n")); // trace words carry no ids
		}
		{
			// Optional wljRunId (wlj_ only) and displayName (non-blank, <= 200 UTF-16 units), JSON-escaped.
			FOneAgent S(Origin);
			FRelayRequest R;
			EXPECT(Key, S.BeginConnect(R, Wlj, "My \"agent\" \\ \xE2\x9C\x93"));
			EXPECT(Key, R.Body == "{\"providerId\":\"" + TestProvider + "\",\"wljRunId\":\"" + Wlj + "\",\"displayName\":\"My \\\"agent\\\" \\\\ \xE2\x9C\x93\"}");
			FJsonValue V;
			EXPECT(Key, ParseJson(R.Body, V) && V.Find("displayName")->Text == "My \"agent\" \\ \xE2\x9C\x93");
			S.ApplyConnectAnswer(503, KindBody0("julius_dispatch_unavailable"), 0);
			EXPECT(Key, !S.Has() && S.SessionView().StatusLine == "Retry later" && S.SessionView().bCanConnect);
			EXPECT(Key, !S.BeginConnect(R, "run:0123456789abcdef01234567") && R.Method.empty() && !S.BeginConnect(R, "WLJ_" + U1) && !S.BeginConnect(R, "wlj_" + U1 + " "));
			EXPECT(Key, !S.BeginConnect(R, "", "   ") && !S.BeginConnect(R, "", std::string(201, 'n')) && !S.BeginConnect(R, "", "bad\xFF"));
			std::string Emoji100;
			for (int I = 0; I < 100; ++I) { Emoji100 += "\xF0\x9F\x98\x80"; }
			EXPECT(Key, !S.BeginConnect(R, "", Emoji100 + "n"));
			EXPECT(Key, S.BeginConnect(R, "", Emoji100) && Contains(R.Body, Emoji100));
			S.ApplyConnectAnswer(400, KindBody0("companion_request_invalid"), 0);
			EXPECT(Key, S.BeginConnect(R, "", std::string(200, 'n')));
			S.ApplyConnectAnswer(400, KindBody0("companion_request_invalid"), 0);
			EXPECT(Key, S.SessionView().StatusLine == "Could not connect the agent" && TraceHas0(S.S, "connect_failed"));
		}
		{
			// providerId is opaque (route.ts:60,292-294): any non-blank string of <= 200 UTF-16 units; blank by JS trim().
			FCompanionSession S(Origin, Project, true);
			FRelayRequest R;
			for (const std::string& Bad : {std::string(), std::string("   "), std::string("\t\n\r"), std::string("\xC2\xA0\xE3\x80\x80"), std::string("\xEF\xBB\xBF"),
					 std::string("\xE2\x80\xA8\xE2\x80\x8A"), std::string(201, 'p'), std::string("p\xFF")})
			{
				EXPECT(Key, !S.BeginConnect(Bad, "", "", R) && R.Method.empty());
			}
			std::string Long;
			for (int I = 0; I < 100; ++I) { Long += "\xF0\x9F\x98\x80"; }
			for (const std::string& Good : {std::string(200, 'p'), std::string("has space"), std::string("../x"), std::string(" x "), Long, std::string("\xC2\x85")})
			{
				EXPECT(Key, S.BeginConnect(Good, "", "", R) && Contains(R.Body, Good));
				S.ApplyConnectAnswer(503, "", 0);
			}
			EXPECT(Key, !S.BeginConnect(Long + "p", "", "", R));
		}
		{
			FOneAgent S("http://localhost:47123");
			FRelayRequest R;
			EXPECT(Key, !S.BeginConnect(R) && R.Method.empty());
			EXPECT(Key, !S.SessionView().bOriginOk && S.SessionView().StatusLine == "Companion relay must be on this machine" && !S.SessionView().bCanConnect);
			S.S.ApplyAgentSlots(Slots("[" + ConnectOk + "]"));
			EXPECT(Key, S.View().Offline == EOfflineReason::RelayNotLoopback && !S.BeginMessage("hi", Idem(12), "", 0, R) && R.Method.empty());
		}
		{
			// One connect at a time: a second BeginConnect while the first is in flight sends nothing.
			FOneAgent S(Origin);
			FRelayRequest R;
			FRelayRequest R2;
			EXPECT(Key, S.BeginConnect(R));
			EXPECT(Key, !S.BeginConnect(R2) && R2.Method.empty());
		}
	}

	/* ------------------------------------------------------------ session */
	void TestSession()
	{
		{
			FOneAgent S(Origin);
			EXPECT(Session, !S.Has() && S.S.AgentIds().empty() && S.SessionView().AgentCount == 0);
			EXPECT(Session, S.SessionView().bShowSimulatedBanner && S.SessionView().bCanConnect && S.SessionView().StatusLine.empty());
			FRelayRequest R;
			EXPECT(Session, !S.BeginMessage("hi", Idem(1), "", 0, R) && R.Method.empty());
			S.S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "disconnected", DeclaredDefault, "[]") + "]"));
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.View().Offline == EOfflineReason::NotConnected && S.View().StatusLine == "Connect your agent");
			EXPECT(Session, S.View().bCanConnect && !S.View().bCanSend && S.View().bShowSimulatedBanner && S.View().DisplayName == "Agent One");
			EXPECT(Session, S.SessionView().AgentCount == 1 && S.SessionView().bShowSimulatedBanner && S.S.ProviderIdOf(TestAgent) == TestProvider);
			S.S.ApplyAgentSlots(Slots("[" + ConnectOk + "]"));
			EXPECT(Session, S.View().State == ECompanionState::Ready && S.View().bCanSend && !S.View().bShowSimulatedBanner && !S.SessionView().bShowSimulatedBanner);
			EXPECT(Session, S.View().AdapterVersion == "1.4.2" && S.View().Kind == EAgentKind::Single && S.View().Connection == EAgentConnection::Connected);
			S.S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "error") + "]"));
			EXPECT(Session, S.View().State == ECompanionState::Error && S.View().StatusLine == "Connection error; reconnect your agent");
			EXPECT(Session, !S.View().bCanSend && S.View().bCanConnect && S.View().bShowSimulatedBanner);
			S.S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "disconnected") + "]"));
			EXPECT(Session, S.View().Offline == EOfflineReason::NotConnected && !S.View().bCanSend);
			S.S.ApplyAgentSlots(Slots("[]"));
			EXPECT(Session, S.Has() && S.View().Offline == EOfflineReason::NotConnected); // upsert only: absent from a list is not removed
		}
		{
			// displayName is the server's, verbatim, whatever it says (A10; replaces the v0.1 Q10 labels).
			FOneAgent S(Origin);
			S.S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", OddLabel) + "]"));
			EXPECT(Session, S.View().DisplayName == OddLabel);
			S.S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", "zzz") + "]"));
			EXPECT(Session, S.View().DisplayName == "zzz");
			S.S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", "bad\\u202elabel") + "]"));
			EXPECT(Session, !S.View().bMalformed && S.View().DisplayName == "badlabel" && S.View().State == ECompanionState::Ready);
			S.S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", "   ") + "]"));
			EXPECT(Session, S.View().bMalformed && S.View().DisplayName.empty() && S.View().State == ECompanionState::Error);
			EXPECT(Session, S.View().StatusLine == "Agent details could not be read" && !S.View().bCanSend && !S.View().bCanConnect);
		}
		{
			FOneAgent S(Origin);
			EXPECT(Session, MakeReady(S));
			FRelayRequest R;
			EXPECT(Session, Send(S, "Hello there", 10, 0, Wlj, &R));
			EXPECT(Session, R.Method == "POST" && R.Url == Origin + "/relay-api/wonderland/companions/agents/" + TestAgent + "/chat" + PQ && R.IdempotencyKey == Idem(10));
			EXPECT(Session, R.Body == "{\"conversationId\":null,\"wljRunId\":\"" + Wlj + "\",\"message\":\"Hello there\"}");
			EXPECT(Session, !Contains(R.Body, "model"));
			EXPECT(Session, S.View().State == ECompanionState::Streaming && !S.View().bCanSend);
			S.FeedChatBytes(Meta() + Delta("Hi"), 0);
			EXPECT(Session, S.View().PartialReply == "Hi" && S.View().State == ECompanionState::Streaming);
			S.FeedChatBytes(Delta(" you") + Done(), 0);
			EXPECT(Session, S.View().State == ECompanionState::Ready && S.History().Size() == 1 && S.ConversationId() == Conv);
			EXPECT(Session, S.History().At(0).ReplyText == "Hi you" && S.History().At(0).Model == "srv-model-x" && !S.History().At(0).bHitLengthLimit);
			EXPECT(Session, S.History().At(0).PlayerText == "Hello there");
			EXPECT(Session, Send(S, "second", 11, 0, "", &R) && Contains(R.Body, "\"conversationId\":\"" + Conv + "\"") && Contains(R.Body, "\"wljRunId\":null"));
			S.FeedChatBytes(Meta(Conv, "", Msg2) + Delta("s"), 0);
			EXPECT(Session, S.View().PartialReply == "s");
			S.FinishChatStream(0);
			EXPECT(Session, S.View().State == ECompanionState::Error && S.View().bCanResend && S.History().Size() == 1);
			FRelayRequest Re;
			EXPECT(Session, S.BeginResend(0, Re) && Re.IdempotencyKey == Idem(11) && Re.Body == R.Body);
			S.FeedChatBytes(Replayed(Conv, Msg2) + Delta("full reply") + Done(Msg2), 0);
			EXPECT(Session, S.History().Size() == 2 && S.History().At(1).ReplyText == "full reply" && S.History().At(1).MessageId == Msg2);
			EXPECT(Session, !S.BeginResend(0, Re));
			EXPECT(Session, !Send(S, "reuse", 10));
			EXPECT(Session, !Send(S, "", 12));
			EXPECT(Session, !Send(S, "x", 13, 0, "run:0123456789abcdef01234567"));
			EXPECT(Session, !Send(S, "x", 14, 0, "wlj_" + U1.substr(0, 35) + "A"));
			EXPECT(Session, !Send(S, "x", 15, 0, "WLJ_" + U1));
			EXPECT(Session, !Send(S, "x\xFF", 16));
			EXPECT(Session, !Send(S, std::string(8001, 'a'), 17));
			EXPECT(Session, Send(S, std::string(8000, 'a'), 18));
			S.ApplyChatTransportFailure(0);
			EXPECT(Session, S.View().State == ECompanionState::RetryLater && S.View().StatusLine == "Retry later" && S.View().bCanResend);
			std::string Emoji;
			for (int I = 0; I < 4000; ++I) { Emoji += "\xF0\x9F\x98\x80"; }
			EXPECT(Session, Send(S, Emoji, 19));
			S.ApplyChatTransportFailure(0);
			EXPECT(Session, !Send(S, Emoji + "a", 20));
			EXPECT(Session, Send(S, "x", 21, 0, OtherWlj)); // any canonical wlj_ is context only; the pin is the HUD's job
			S.FeedChatBytes(Meta() + Done(), 0);
		}
		{
			// Contract 2.3, one row at a time.
			struct FRow { std::string Stream; ECompanionState State; const char* Line; bool bOffline; };
			const FRow Rows[] = {
				{Err("provider_auth_failed", "bad key"), ECompanionState::Offline, "Your key was rejected", true},
				{Err("provider_quota_exhausted", "pay"), ECompanionState::OutOfCredit, "Your provider account is out of credit", false},
				{Err("provider_rate_limited", "wait", ",\"retryAfterMs\":5000"), ECompanionState::RetryLater, "Retry later", false},
				{Err("provider_unavailable", "down"), ECompanionState::RetryLater, "Retry later", false},
				{Err("provider_refused", "I can't help with that."), ECompanionState::Refused, "The provider refused this message", false},
				{Err("companion_internal", "x"), ECompanionState::Error, "Companion error", false},
			};
			int K = 100;
			for (const FRow& Row : Rows)
			{
				FOneAgent S(Origin);
				EXPECT(Session, MakeReady(S));
				EXPECT(Session, Send(S, "q", K++, 1000));
				S.FeedChatBytes(Meta() + Delta("partial") + Row.Stream, 1000);
				EXPECT(Session, S.View().State == Row.State && S.View().StatusLine == Row.Line);
				EXPECT(Session, S.View().PartialReply.empty() && S.History().Size() == 0);
				EXPECT(Session, S.View().bShowSimulatedBanner == Row.bOffline);
				if (Row.State == ECompanionState::Refused) { EXPECT(Session, S.View().RefusalText == "I can't help with that."); }
				if (Row.bOffline)
				{
					// No fallback: nothing can be sent until the player reconnects their own key.
					EXPECT(Session, !Send(S, "again", K++, 1000) && S.View().bCanConnect && !S.View().bCanSend);
					S.S.ApplyAgentSlots(Slots("[" + ConnectOk + "]")); // a list never clears a rejection (Q12)
					EXPECT(Session, S.View().State == ECompanionState::Offline);
					FRelayRequest C;
					EXPECT(Session, S.BeginConnect(C));
					S.ApplyConnectAnswer(201, ConnectOk, 0);
					EXPECT(Session, S.View().State == ECompanionState::Ready);
				}
				if (Row.Stream.find("retryAfterMs") != std::string::npos)
				{
					EXPECT(Session, S.View().RetryNotBeforeMs == 6000 && !Send(S, "early", K++, 5999) && Send(S, "ok", K++, 6000));
				}
			}
		}
		{
			FOneAgent S(Origin);
			EXPECT(Session, MakeReady(S));
			EXPECT(Session, Send(S, "q", 30, 10000));
			S.ApplyChatHttpAnswer(429, "7", "{\"error\":{\"kind\":\"companion_rate_limited\",\"message\":\"x\"}}", 10000);
			EXPECT(Session, S.View().State == ECompanionState::SlowDown && S.View().StatusLine == "Slow down");
			EXPECT(Session, !Send(S, "q", 31, 16999) && Send(S, "q", 32, 17000));
			S.ApplyChatHttpAnswer(429, "Fri, 23 Oct 2026 22:00:00 GMT", "{\"error\":{\"kind\":\"companion_rate_limited\",\"message\":\"x\"}}", 20000);
			EXPECT(Session, S.View().RetryNotBeforeMs == 80000);
			EXPECT(Session, Send(S, "q", 33, 80000));
			S.ApplyChatHttpAnswer(409, "", "{\"error\":{\"kind\":\"companion_message_in_progress\",\"message\":\"x\"}}", 80000);
			EXPECT(Session, S.View().State == ECompanionState::RetryLater && S.View().bCanResend);
			S.ApplyChatHttpAnswer(409, "", "{\"error\":{\"kind\":\"companion_not_connected\",\"message\":\"x\"}}", 80000);
			EXPECT(Session, S.View().State == ECompanionState::RetryLater); // not streaming: ignored
			FRelayRequest Re;
			// Q4: 409 companion_message_in_progress -> back off 2 s, then the SAME key.
			EXPECT(Session, S.View().RetryNotBeforeMs == 82000 && !S.BeginResend(81999, Re));
			EXPECT(Session, S.BeginResend(82000, Re) && Re.IdempotencyKey == Idem(33));
			S.ApplyChatHttpAnswer(409, "", "{\"error\":{\"kind\":\"companion_not_connected\",\"message\":\"x\"}}", 82000);
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.View().StatusLine == "Connect your agent" && S.View().bShowSimulatedBanner);
		}
		{
			FOneAgent S(Origin);
			FRelayRequest C;
			EXPECT(Session, S.BeginConnect(C));
			S.ApplyConnectAnswer(429, "{}", 0); // BRIDGE never answers connect 429; any non-201 is a plain failure
			EXPECT(Session, S.SessionView().StatusLine == "Could not connect the agent" && !S.Has() && S.SessionView().bCanConnect);
			EXPECT(Session, S.BeginConnect(C));
			S.ApplyConnectAnswer(503, "{}", 0);
			EXPECT(Session, S.SessionView().StatusLine == "Retry later" && !S.Has());
			EXPECT(Session, S.BeginConnect(C));
			S.ApplyConnectAnswer(201, Gone(TestAgent), 0);
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.SessionView().StatusLine == "Could not connect the agent");
			S.S.ApplyAgentSlots(Slots("[" + ConnectOk + "]"));
			EXPECT(Session, S.View().State == ECompanionState::Ready);
			const FRelayRequest D = S.BeginDisconnect();
			EXPECT(Session, D.Method == "DELETE" && D.Url == Origin + "/relay-api/wonderland/companions/agents/" + TestAgent + PQ);
			S.ApplyDisconnectAnswer(200, Gone(TestAgent));
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.View().Offline == EOfflineReason::NotConnected && S.View().bShowSimulatedBanner);
			EXPECT(Session, S.View().AuthorizedCapabilities.empty() && S.SessionView().bShowSimulatedBanner);
			S.ApplyConnectAnswer(201, ConnectOk, 0);
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.Trace().back() == "connect_answer_unexpected");
			EXPECT(Session, S.S.BeginDisconnect(Ag("nobody")).Method.empty());
		}
	}

	/* ------------------------------------------------------------ status (contract v0.1 4.2) */
	const std::string Legacy = "run:0123456789abcdef01234567";
	const std::string Legacy2 = "run:fedcba9876543210fedcba98";
	const std::string T0 = "2026-10-24T05:01:02.345Z";
	const std::string T1 = "2026-10-24T05:01:03.000Z";
	const std::string T2 = "2026-10-24T11:01:02.346Z";

	std::string Q(const std::string& S) { return "\"" + S + "\""; }
	std::string LegacyField(const std::string& V) { return "\"legacyRunId\":" + V; }
	std::string ServerField(const std::string& V) { return "\"serverRunId\":" + V; }
	/** A v0.1 body: top-level, "state", no cause key unless Rest adds one. RunIds may be empty (no id keys). */
	std::string StatusBody(const std::string& RunIds, const std::string& State = "held", const std::string& Rest = "", const std::string& At = T0)
	{
		return "{\"wljRunId\":\"" + Wlj + "\"," + (RunIds.empty() ? std::string() : RunIds + ",") + "\"state\":\"" + State + "\""
			+ Rest + ",\"updatedAt\":\"" + At + "\"}";
	}
	std::string NewRun() { return LegacyField("null") + "," + ServerField(Q(Wlj)); }

	EStatusParse ParseS(const std::string& Body, FMissionStatus& St) { return ParseMissionStatus(Body, St); }

	void TestStatus()
	{
		FMissionStatus St;
		// The v0.1 new-run shape.
		EXPECT(Status, ParseS(StatusBody(NewRun()), St) == EStatusParse::Ok);
		EXPECT(Status, St.WljRunId == Wlj && St.LegacyRunId.empty() && St.State == EStatusState::Held && St.Cause == EStatusCause::None);
		EXPECT(Status, !St.bHasDispatchedAt && St.UpdatedAtMs == 1792818062345ull && !St.bLegacyFromServerRunIdOnly);
		// Today's #407 candidate body, verbatim shape (candidate-407.patch statusBody): serverRunId run:, no legacyRunId.
		const std::string Today = "{\"wljRunId\":\"" + Wlj + "\",\"serverRunId\":\"" + Legacy + "\",\"state\":\"awaiting_operator\",\"updatedAt\":\"" + T0 + "\"}";
		EXPECT(Status, ParseS(Today, St) == EStatusParse::Ok && St.LegacyRunId == Legacy && St.bLegacyFromServerRunIdOnly && St.State == EStatusState::AwaitingOperator);
		const std::string Expired = "{\"wljRunId\":\"" + Wlj + "\",\"serverRunId\":\"" + Legacy + "\",\"state\":\"failed\",\"cause\":\"AWAITING_OPERATOR_EXPIRED\",\"updatedAt\":\"" + T2 + "\"}";
		EXPECT(Status, ParseS(Expired, St) == EStatusParse::Ok && St.State == EStatusState::Failed && St.Cause == EStatusCause::AwaitingOperatorExpired);
		EXPECT(Status, StatusMeaning(St) == EStatusMeaning::NotStartedOperatorWindowExpired && IsTerminalState(St.State));
		// Q21 rules.
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q(Legacy)) + "," + ServerField(Q(Legacy))), St) == EStatusParse::Ok && St.LegacyRunId == Legacy && !St.bLegacyFromServerRunIdOnly);
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q(Legacy))), St) == EStatusParse::Ok && St.LegacyRunId == Legacy);
		EXPECT(Status, ParseS(StatusBody(LegacyField("null")), St) == EStatusParse::Ok && St.LegacyRunId.empty());
		EXPECT(Status, ParseS(StatusBody(""), St) == EStatusParse::Ok && St.LegacyRunId.empty());
		EXPECT(Status, ParseS(StatusBody(ServerField(Q(Wlj))), St) == EStatusParse::Ok && St.LegacyRunId.empty() && !St.bLegacyFromServerRunIdOnly);
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q(Legacy)) + "," + ServerField(Q(Legacy2))), St) == EStatusParse::RunIdsDisagree && St.WljRunId.empty());
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q(Legacy)) + "," + ServerField(Q(Wlj))), St) == EStatusParse::RunIdsDisagree);
		EXPECT(Status, ParseS(StatusBody(LegacyField("null") + "," + ServerField(Q(Legacy))), St) == EStatusParse::RunIdsDisagree);
		EXPECT(Status, ParseS(StatusBody(LegacyField("null") + "," + ServerField(Q(OtherWlj))), St) == EStatusParse::RunIdsDisagree);
		EXPECT(Status, ParseS(StatusBody(ServerField(Q(OtherWlj))), St) == EStatusParse::RunIdsDisagree);
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q(Legacy)) + "," + ServerField("null")), St) == EStatusParse::BadServerRunId);
		EXPECT(Status, ParseS(StatusBody(ServerField("null")), St) == EStatusParse::BadServerRunId);
		EXPECT(Status, ParseS(StatusBody(ServerField(Q("run:0123456789ABCDEF01234567"))), St) == EStatusParse::BadServerRunId);
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q(Wlj))), St) == EStatusParse::BadLegacyRunId);
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q("run:0123456789ABCDEF01234567"))), St) == EStatusParse::BadLegacyRunId);
		EXPECT(Status, ParseS(StatusBody(LegacyField("7")), St) == EStatusParse::BadLegacyRunId);
		EXPECT(Status, ParseS(StatusBody(LegacyField("null") + "," + LegacyField("null")), St) == EStatusParse::BadJson);
		// v0.1 Clarification 1: the legacy-key switch, one constexpr shared with #444, off today; both settings.
		EXPECT(Status, !WonderlandJuliusMissionLogic::bStatusRouteRequiresLegacyRunId);
		EXPECT(Status, ParseMissionStatus(Today, St, true) == EStatusParse::BadLegacyRunId && St.WljRunId.empty());
		EXPECT(Status, ParseMissionStatus(StatusBody(ServerField(Q(Wlj))), St, true) == EStatusParse::BadLegacyRunId);
		EXPECT(Status, ParseMissionStatus(StatusBody(""), St, true) == EStatusParse::BadLegacyRunId);
		EXPECT(Status, ParseMissionStatus(StatusBody(NewRun()), St, true) == EStatusParse::Ok && St.LegacyRunId.empty());
		EXPECT(Status, ParseMissionStatus(StatusBody(LegacyField(Q(Legacy)) + "," + ServerField(Q(Legacy))), St, true) == EStatusParse::Ok && St.LegacyRunId == Legacy);
		EXPECT(Status, ParseMissionStatus(Today, St, false) == EStatusParse::Ok && St.bLegacyFromServerRunIdOnly);
		// v0.1 Clarification 3: workflowRunId optional, opaque, capped, never stored; only a malformed one faults.
		const std::string WorkflowAtCap(WonderlandJuliusMissionLogic::StatusRouteWorkflowRunIdMaxBytes, '7');
		EXPECT(Status, WonderlandJuliusMissionLogic::StatusRouteWorkflowRunIdMaxBytes == 128);
		const std::string WorkflowKey = ",\"workflowRunId\":";
		for (const std::string& Good : {WorkflowKey + Q("18843025517"), WorkflowKey + "null", WorkflowKey + Q(WorkflowAtCap), WorkflowKey + Q("x"),
			WorkflowKey + Q("wf-18843025517/attempt:2")})
		{
			EXPECT(Status, ParseS(StatusBody(NewRun(), "held", Good), St) == EStatusParse::Ok && St.State == EStatusState::Held);
		}
		const std::string TodayWorkflow = "{\"wljRunId\":\"" + Wlj + "\",\"serverRunId\":\"" + Legacy + "\",\"state\":\"dispatched\",\"dispatchedAt\":\"" + T1
			+ "\",\"workflowRunId\":\"18843025517\",\"updatedAt\":\"" + T1 + "\"}";
		EXPECT(Status, ParseS(TodayWorkflow, St) == EStatusParse::Ok && St.LegacyRunId == Legacy && St.State == EStatusState::Dispatched && St.bHasDispatchedAt);
		EXPECT(Status, ParseS(StatusBody(LegacyField(Q(Legacy)) + "," + ServerField(Q(Legacy)), "dispatch_failed",
			",\"cause\":\"gh_workflow_run_failed\"" + WorkflowKey + Q("18843025517")), St) == EStatusParse::Ok && St.State == EStatusState::DispatchFailed);
		for (const std::string& Bad : {WorkflowKey + Q(WorkflowAtCap + "7"), WorkflowKey + Q(""), WorkflowKey + Q("1884 3025517"),
			WorkflowKey + Q("18843025517\\n"), WorkflowKey + Q("\\u00e9"), WorkflowKey + "18843025517", WorkflowKey + "true", WorkflowKey + "{}",
			WorkflowKey + "[\"1\"]"})
		{
			EXPECT(Status, ParseS(StatusBody(NewRun(), "held", Bad), St) == EStatusParse::BadWorkflowRunId && St.WljRunId.empty());
		}
		EXPECT(Status, ParseS(StatusBody(NewRun(), "held", WorkflowKey + Q("1") + WorkflowKey + Q("2")), St) == EStatusParse::BadJson);
		EXPECT(Status, std::string(StatusParseName(EStatusParse::BadWorkflowRunId)) == "bad_workflow_run_id");
		// v0 shapes are faults, never synonyms (Q19).
		const std::string Wrapped = "{\"data\":" + StatusBody(NewRun()) + "}";
		EXPECT(Status, ParseS(Wrapped, St) == EStatusParse::BadPhase);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "held", ",\"data\":null"), St) == EStatusParse::BadPhase);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "held", ",\"phase\":\"held\""), St) == EStatusParse::BadPhase);
		std::string NoState = StatusBody(NewRun());
		NoState.replace(NoState.find("\"state\""), 7, "\"phase\"");
		EXPECT(Status, ParseS(NoState, St) == EStatusParse::BadPhase);
		NoState = StatusBody(NewRun());
		NoState.replace(NoState.find("\"state\""), 7, "\"stat_\"");
		EXPECT(Status, ParseS(NoState, St) == EStatusParse::BadPhase);
		// The closed state list: running / completed / expired are withdrawn (Q18).
		for (const char* Word : {"running", "completed", "expired", "HELD", "Held", "providers_running", "", "awaiting operator"})
		{
			EXPECT(Status, ParseS(StatusBody(NewRun(), Word), St) == EStatusParse::BadPhase);
		}
		const std::pair<const char*, EStatusState> States[] = {
			{"held", EStatusState::Held}, {"awaiting_operator", EStatusState::AwaitingOperator}, {"reserved", EStatusState::Reserved},
			{"dispatched", EStatusState::Dispatched}, {"unknown", EStatusState::Unknown}, {"ledger_unwritten", EStatusState::LedgerUnwritten},
			{"interrupted", EStatusState::Interrupted}, {"failed", EStatusState::Failed}, {"dispatch_failed", EStatusState::DispatchFailed},
			{"already_spent", EStatusState::AlreadySpent},
		};
		for (const auto& Row : States)
		{
			EXPECT(Status, ParseS(StatusBody(NewRun(), Row.first), St) == EStatusParse::Ok && St.State == Row.second);
		}
		// Terminal list (Q18): exactly these five.
		EXPECT(Status, IsTerminalState(EStatusState::LedgerUnwritten) && IsTerminalState(EStatusState::Interrupted) && IsTerminalState(EStatusState::Failed));
		EXPECT(Status, IsTerminalState(EStatusState::DispatchFailed) && IsTerminalState(EStatusState::AlreadySpent));
		EXPECT(Status, !IsTerminalState(EStatusState::Held) && !IsTerminalState(EStatusState::AwaitingOperator) && !IsTerminalState(EStatusState::Reserved));
		EXPECT(Status, !IsTerminalState(EStatusState::Dispatched) && !IsTerminalState(EStatusState::Unknown));
		// cause: omitted / null = none; closed; the old client spelling is refused; expiry only on failed.
		EXPECT(Status, ParseS(StatusBody(NewRun(), "held", ",\"cause\":null"), St) == EStatusParse::Ok && St.Cause == EStatusCause::None);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "failed", ",\"cause\":\"operator_window_expired\""), St) == EStatusParse::BadCause);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "failed", ",\"cause\":\"awaiting_operator_expired\""), St) == EStatusParse::BadCause);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "failed", ",\"cause\":\"AWAITING_OPERATOR_EXPIRED \""), St) == EStatusParse::BadCause);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "failed", ",\"cause\":7"), St) == EStatusParse::BadCause);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "awaiting_operator", ",\"cause\":\"AWAITING_OPERATOR_EXPIRED\""), St) == EStatusParse::BadCause);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatch_failed", ",\"cause\":\"AWAITING_OPERATOR_EXPIRED\""), St) == EStatusParse::BadCause);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "already_spent", ",\"cause\":\"RUN_ID_ALREADY_SPENT\""), St) == EStatusParse::Ok && St.Cause == EStatusCause::RunIdAlreadySpent);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatch_failed", ",\"cause\":\"SPENT_TAG_UNVERIFIED\""), St) == EStatusParse::Ok && St.Cause == EStatusCause::SpentTagUnverified);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatch_failed", ",\"cause\":\"gh_workflow_run_failed\""), St) == EStatusParse::Ok && St.Cause == EStatusCause::GhWorkflowRunFailed);
		// seq / progress / companion are ignored, whatever they hold (Q19, Q20, Q24).
		EXPECT(Status, ParseS(StatusBody(NewRun(), "held", ",\"seq\":-3,\"progress\":\"x\",\"companion\":{\"state\":\"paid\"}"), St) == EStatusParse::Ok);
		// dispatchedAt: absent / null / strict UTC; a string #444 does not accept is DispatchUnconfirmed, never a fault.
		// #444 P9: dispatched with dispatchedAt absent or null is DispatchUnconfirmed (never confirmed, never a fault).
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":null"), St) == EStatusParse::Ok && !St.bHasDispatchedAt && !St.bDispatchedAtUnconfirmed && StatusMeaning(St) == EStatusMeaning::DispatchUnconfirmed);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched"), St) == EStatusParse::Ok && !St.bHasDispatchedAt && !St.bDispatchedAtUnconfirmed && StatusMeaning(St) == EStatusMeaning::DispatchUnconfirmed);
		EXPECT(Status, std::string(StatusMeaningLabel(StatusMeaning(St))) == "Can't confirm when the run was started \xE2\x80\x94 still checking with the bridge");
		EXPECT(Status, ParseS(StatusBody(NewRun(), "held", ",\"dispatchedAt\":null"), St) == EStatusParse::Ok && StatusMeaning(St) == EStatusMeaning::Waiting);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatch_failed", ",\"dispatchedAt\":null"), St) == EStatusParse::Ok && StatusMeaning(St) == EStatusMeaning::DispatchFailed);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + T1 + "\""), St) == EStatusParse::Ok && StatusMeaning(St) == EStatusMeaning::DispatchedNotReported);
		for (int Digits = 1; Digits <= 9; ++Digits)
		{
			const std::string Fraction = "2026-10-24T05:01:03." + std::string("123456789").substr(0, static_cast<std::size_t>(Digits)) + "Z";
			const bool bParses = ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + Fraction + "\""), St) == EStatusParse::Ok;
			if (Digits == 3)
			{
				EXPECT(Status, bParses && St.bHasDispatchedAt && !St.bDispatchedAtUnconfirmed && St.DispatchedAtMs == 1792818063123ull && StatusMeaning(St) == EStatusMeaning::DispatchedNotReported);
			}
			else
			{
				EXPECT(Status, bParses && !St.bHasDispatchedAt && St.bDispatchedAtUnconfirmed && St.DispatchedAtMs == 0 && StatusMeaning(St) == EStatusMeaning::DispatchUnconfirmed);
			}
			// On a state other than dispatched the same string is ignored, as #444 does: still never a fault.
			EXPECT(Status, ParseS(StatusBody(NewRun(), "held", ",\"dispatchedAt\":\"" + Fraction + "\""), St) == EStatusParse::Ok && StatusMeaning(St) == EStatusMeaning::Waiting);
		}
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"\""), St) == EStatusParse::Ok && St.bDispatchedAtUnconfirmed && StatusMeaning(St) == EStatusMeaning::DispatchUnconfirmed);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":true"), St) == EStatusParse::BadDispatchedAt);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":{}"), St) == EStatusParse::BadDispatchedAt);
		EXPECT(Status, std::string(StatusMeaningLabel(EStatusMeaning::DispatchUnconfirmed)) == "Can't confirm when the run was started \xE2\x80\x94 still checking with the bridge");
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + T1 + "\""), St) == EStatusParse::Ok && St.bHasDispatchedAt && St.DispatchedAtMs == 1792818063000ull);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"2026-10-24T05:01:03+00:00\""), St) == EStatusParse::Ok && St.bDispatchedAtUnconfirmed && !St.bHasDispatchedAt);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":1792818063000"), St) == EStatusParse::BadDispatchedAt);
		EXPECT(Status, ParseS(StatusBody(NewRun(), "held", "", "2026-10-24T05:01:02.345+00:00"), St) == EStatusParse::BadUpdatedAt);
		std::string W = StatusBody(NewRun());
		W.replace(W.find(Wlj), Wlj.size(), Legacy);
		EXPECT(Status, ParseS(W, St) == EStatusParse::BadWljRunId);
		EXPECT(Status, ParseS("[1]", St) == EStatusParse::NotObject);
		EXPECT(Status, ParseS(std::string(StatusMaxBodyBytes + 1, ' '), St) == EStatusParse::BodyTooLarge);
		// Meanings (Q17): expiry is never a mission failure or spend; dispatched never claims a run.
		FMissionStatus M;
		M.State = EStatusState::Failed;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::AdmissionEnded);
		M.Cause = EStatusCause::AwaitingOperatorExpired;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::NotStartedOperatorWindowExpired);
		M = FMissionStatus();
		for (EStatusState S : {EStatusState::Held, EStatusState::AwaitingOperator, EStatusState::Reserved, EStatusState::Unknown})
		{
			M.State = S;
			EXPECT(Status, StatusMeaning(M) == EStatusMeaning::Waiting);
		}
		M.State = EStatusState::Dispatched;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::DispatchUnconfirmed); // no dispatch time: never confirmed
		M.bHasDispatchedAt = true;
		M.DispatchedAtMs = 1792818063000ull;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::DispatchedNotReported);
		M.bHasDispatchedAt = false;
		M.DispatchedAtMs = 0;
		EXPECT(Status, std::string(StatusMeaningLabel(EStatusMeaning::DispatchedNotReported)) == "Dispatched; run status not yet reported");
		const std::string ExpiredLabel = StatusMeaningLabel(EStatusMeaning::NotStartedOperatorWindowExpired);
		EXPECT(Status, ExpiredLabel.find("Not started") == 0 && ExpiredLabel.find("unpaid") != std::string::npos && ExpiredLabel.find("fail") == std::string::npos);
		M.State = EStatusState::Interrupted;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::AdmissionEnded);
		M.State = EStatusState::LedgerUnwritten;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::AdmissionEnded);
		M.State = EStatusState::DispatchFailed;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::DispatchFailed);
		M.State = EStatusState::AlreadySpent;
		EXPECT(Status, StatusMeaning(M) == EStatusMeaning::AlreadySpent);
		// The status request.
		const FRelayRequest R = MissionStatusRequest(Origin, Wlj, "project-1");
		EXPECT(Status, R.Method == "GET" && R.Url == Origin + "/relay-api/wonderland/julius/status?runId=" + Wlj + "&projectId=project-1");
		EXPECT(Status, MissionStatusRequest(Origin, Legacy, "project-1").Method == "GET");
		EXPECT(Status, MissionStatusRequest(Origin, "WLJ_" + U1, "project-1").Method.empty());
		EXPECT(Status, MissionStatusRequest(Origin, Wlj, "p&x=1").Method.empty() && MissionStatusRequest(Origin, Wlj, "").Method.empty());
		EXPECT(Status, MissionStatusRequest("https://relay.example.com", Wlj, "project-1").Method.empty());
		EXPECT(Status, std::strcmp(StatusParseName(EStatusParse::RunIdsDisagree), "run_ids_disagree") == 0);
		EXPECT(Status, std::strcmp(StatusParseName(EStatusParse::BadPhase), "bad_phase") == 0);
	}

	/* ------------------------------------------------------------ pin (#444, v0.1 poll-only ordering) */
	FMissionStatus Parsed(const std::string& Body)
	{
		FMissionStatus St;
		ParseMissionStatus(Body, St);
		return St;
	}

	void TestPin()
	{
		{
			FStatusPin P(Wlj);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "held", "", T1))) == EPinVerdict::Applied && P.LastUpdatedAtMs() == 1792818063000ull);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "held", "", T1))) == EPinVerdict::Applied); // same instant: re-applied
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "reserved", "", T0))) == EPinVerdict::Stale && P.PinnedState() == EStatusState::Held);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "awaiting_operator", "", T1))) == EPinVerdict::Applied);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "unknown", "", T2))) == EPinVerdict::Stale && P.PinnedState() == EStatusState::AwaitingOperator);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "failed", ",\"cause\":\"AWAITING_OPERATOR_EXPIRED\"", T2))) == EPinVerdict::Applied);
			EXPECT(Pin, P.PinnedState() == EStatusState::Failed && StatusMeaning(P.Applied()) == EStatusMeaning::NotStartedOperatorWindowExpired);
			// Terminal is sticky: a later dispatched (a racing claim) never revives an expired run.
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + T2 + "\"", "2026-10-24T12:00:00.000Z"))) == EPinVerdict::Stale);
			EXPECT(Pin, P.PinnedState() == EStatusState::Failed && !P.IsMismatched());
			EXPECT(Pin, P.Apply(Parsed(StatusBody(LegacyField(Q(Legacy)), "held", "", T2))) == EPinVerdict::Mismatch && P.IsMismatched());
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "held", "", T2))) == EPinVerdict::Mismatch);
		}
		{
			FStatusPin P(Wlj);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "held", "", T0))) == EPinVerdict::Applied);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(LegacyField(Q(Legacy)), "held", "", T0))) == EPinVerdict::Mismatch); // null -> run: is another run
		}
		{
			FStatusPin P(Wlj);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(ServerField(Q(Legacy)), "held", "", T0))) == EPinVerdict::Applied && P.PinnedLegacyRunId() == Legacy);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(LegacyField(Q(Legacy)) + "," + ServerField(Q(Legacy)), "awaiting_operator", "", T1))) == EPinVerdict::Applied);
			// An older answer naming another legacy row is still another run: identity before ordering.
			EXPECT(Pin, P.Apply(Parsed(StatusBody(LegacyField(Q(Legacy2)), "held", "", T0))) == EPinVerdict::Mismatch);
		}
		{
			FStatusPin P(Wlj);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "unknown", "", T0))) == EPinVerdict::Applied); // first answer may be unknown
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "held", "", T0))) == EPinVerdict::Applied);    // a real state follows it
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + T1 + "\"", T1))) == EPinVerdict::Applied);
			EXPECT(Pin, P.Applied().bHasDispatchedAt && P.Applied().DispatchedAtMs == 1792818063000ull);
			// After a recorded dispatch the server refuses admission states; the pin ignores them.
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "awaiting_operator", "", T2))) == EPinVerdict::Stale);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "failed", ",\"cause\":\"AWAITING_OPERATOR_EXPIRED\"", T2))) == EPinVerdict::Stale);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "interrupted", "", T2))) == EPinVerdict::Stale && P.PinnedState() == EStatusState::Dispatched);
			// dispatchedAt omitted later: kept. Unparseable later: kept, not a mismatch, still confirmed. Moved: sticky mismatch.
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", "", T2))) == EPinVerdict::Applied && P.Applied().bHasDispatchedAt);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"2026-10-24T05:01:04.5Z\"", T2))) == EPinVerdict::Applied && !P.IsMismatched());
			EXPECT(Pin, P.Applied().bHasDispatchedAt && P.Applied().DispatchedAtMs == 1792818063000ull && !P.Applied().bDispatchedAtUnconfirmed);
			EXPECT(Pin, StatusMeaning(P.Applied()) == EStatusMeaning::DispatchedNotReported);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + T2 + "\"", T2))) == EPinVerdict::Mismatch && P.IsMismatched());
		}
		{
			// Absent, then null: never confirmed by the pin. A later good time confirms; a later absent one keeps it.
			FStatusPin P(Wlj);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", "", T0))) == EPinVerdict::Applied);
			EXPECT(Pin, !P.Applied().bHasDispatchedAt && StatusMeaning(P.Applied()) == EStatusMeaning::DispatchUnconfirmed);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":null", T1))) == EPinVerdict::Applied);
			EXPECT(Pin, !P.Applied().bHasDispatchedAt && StatusMeaning(P.Applied()) == EStatusMeaning::DispatchUnconfirmed);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + T1 + "\"", T2))) == EPinVerdict::Applied && !P.IsMismatched());
			EXPECT(Pin, P.Applied().bHasDispatchedAt && P.Applied().DispatchedAtMs == 1792818063000ull && StatusMeaning(P.Applied()) == EStatusMeaning::DispatchedNotReported);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":null", T2))) == EPinVerdict::Applied);
			EXPECT(Pin, P.Applied().bHasDispatchedAt && P.Applied().DispatchedAtMs == 1792818063000ull && StatusMeaning(P.Applied()) == EStatusMeaning::DispatchedNotReported);
		}
		{
			// Unconfirmed first, confirmed later (#444: a later good dispatchedAt confirms it).
			FStatusPin P(Wlj);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"2026-10-24T05:01:03.123456Z\"", T1))) == EPinVerdict::Applied);
			EXPECT(Pin, StatusMeaning(P.Applied()) == EStatusMeaning::DispatchUnconfirmed && !P.Applied().bHasDispatchedAt);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", ",\"dispatchedAt\":\"" + T1 + "\"", T2))) == EPinVerdict::Applied);
			EXPECT(Pin, StatusMeaning(P.Applied()) == EStatusMeaning::DispatchedNotReported && P.Applied().DispatchedAtMs == 1792818063000ull);
		}
		{
			FStatusPin P(Wlj);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatched", "", T0))) == EPinVerdict::Applied);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "dispatch_failed", ",\"cause\":\"gh_workflow_run_failed\"", T1))) == EPinVerdict::Applied);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "already_spent", ",\"cause\":\"RUN_ID_ALREADY_SPENT\"", T2))) == EPinVerdict::Stale);
			EXPECT(Pin, P.PinnedState() == EStatusState::DispatchFailed);
		}
		{
			FStatusPin P(OtherWlj); // another client's watch never accepts our run
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun()))) == EPinVerdict::Mismatch);
		}
		{
			FStatusPin P(Wlj);
			FMissionStatus Fake = Parsed(StatusBody(NewRun()));
			Fake.WljRunId = "wlj_" + U1.substr(0, 35) + "1"; // one byte off
			EXPECT(Pin, P.Apply(Fake) == EPinVerdict::Mismatch);
			EXPECT(Pin, P.Apply(Parsed(StatusBody(NewRun(), "held", "", T1))) == EPinVerdict::Mismatch); // sticky
		}
		{
			FStatusPin P(Wlj);
			FMissionStatus Fake = Parsed(StatusBody(NewRun()));
			Fake.WljRunId = Legacy; // a legacy id in the wlj slot
			EXPECT(Pin, P.Apply(Fake) == EPinVerdict::Mismatch);
		}
		{
			FStatusPin Upper("WLJ_" + U1);
			EXPECT(Pin, Upper.IsMismatched());
			FStatusPin Legacyish(Legacy);
			EXPECT(Pin, Legacyish.Apply(Parsed(StatusBody(NewRun()))) == EPinVerdict::Mismatch);
		}
		EXPECT(Pin, WonderlandJuliusMissionLogic::IsAcceptedServerRunId(Wlj, Wlj) && !WonderlandJuliusMissionLogic::IsAcceptedServerRunId(OtherWlj, Wlj));
	}

	/* ------------------------------------------------------------ history */
	void TestHistory()
	{
		{
			FTurnHistory H;
			for (int I = 0; I < 25; ++I)
			{
				FTurn T;
				T.PlayerText = "p" + std::to_string(I);
				H.Add(T);
			}
			EXPECT(History, H.Size() == HistoryMaxTurns && HistoryMaxTurns == 20);
			EXPECT(History, H.At(0).PlayerText == "p5" && H.At(19).PlayerText == "p24");
			H.Clear();
			EXPECT(History, H.Size() == 0);
		}
		{
			FOneAgent S(Origin);
			EXPECT(History, MakeReady(S));
			for (int I = 0; I < 21; ++I)
			{
				EXPECT(History, Send(S, "m" + std::to_string(I), 200 + I));
				S.FeedChatBytes(Meta() + Delta("r" + std::to_string(I)) + Done(), 0);
			}
			EXPECT(History, S.History().Size() == 20 && S.History().At(0).PlayerText == "m1" && S.History().At(19).ReplyText == "r20");
			EXPECT(History, Send(S, "mid-stream", 300));
			EXPECT(History, S.BeginDeleteHistory().Method.empty() && S.History().Size() == 20);
			S.FeedChatBytes(Meta() + Done(), 0);
			FRelayRequest D = S.BeginDeleteHistory();
			EXPECT(History, D.Method == "DELETE" && D.Url == Origin + "/relay-api/wonderland/companions/agents/" + TestAgent + "/conversations/" + Conv + PQ);
			EXPECT(History, S.History().Size() == 0 && S.ConversationId().empty() && !S.View().bCanResend);
			S.ApplyDeleteHistoryAnswer(503);
			D = S.BeginDeleteHistory();
			EXPECT(History, D.Method == "DELETE" && Contains(D.Url, Conv));
			S.ApplyDeleteHistoryAnswer(204);
			EXPECT(History, S.BeginDeleteHistory().Method.empty());
			FRelayRequest R;
			EXPECT(History, Send(S, "fresh", 301, 0, "", &R) && Contains(R.Body, "\"conversationId\":null"));
		}
	}

	/* ------------------------------------------------------------ agent result and provenance */
	std::string ResultBody(const std::string& Content, const std::string& Run = Wlj, const std::string& Summary = "did it",
		const std::string& Kind = "patch", const std::string& Schema = "wonderland.companion_result.v0")
	{
		return "{\"schema\":\"" + Schema + "\",\"taskId\":\"cmp_" + U3 + "\",\"wljRunId\":\"" + Run + "\",\"summary\":\"" + Summary
			+ "\",\"artifact\":{\"kind\":\"" + Kind + "\",\"content\":\"" + Content + "\"},\"agent\":{\"selfReportedName\":\"Grok Bot (self)\",\"selfReportedRunUrl\":null}}";
	}

	void TestResult()
	{
		FAgentResultView V;
		EXPECT(Result, ParseAgentResult(ResultBody("diff --git a b"), Wlj, V) == EResultParse::Ok);
		EXPECT(Result, V.bUntrusted && V.ArtifactKind == EArtifactKind::Patch && V.SelfReportedName == "Grok Bot (self)" && V.TaskId == "cmp_" + U3);
		const std::size_t Overhead = ResultBody("").size();
		const std::string Exact = ResultBody(std::string(CompanionResultMaxBytes - Overhead, 'c'));
		EXPECT(Result, Exact.size() == CompanionResultMaxBytes && ParseAgentResult(Exact, Wlj, V) == EResultParse::Ok);
		const std::string Over = ResultBody(std::string(CompanionResultMaxBytes - Overhead + 1, 'c'));
		EXPECT(Result, ParseAgentResult(Over, Wlj, V) == EResultParse::TooLarge && V.ArtifactContent.empty());
		EXPECT(Result, ParseAgentResult(std::string(CompanionResultMaxBytes + 1, '{'), Wlj, V) == EResultParse::TooLarge);
		EXPECT(Result, ParseAgentResult(ResultBody("x", OtherWlj), Wlj, V) == EResultParse::RunIdMismatch);
		EXPECT(Result, ParseAgentResult(ResultBody("x", Legacy), Wlj, V) == EResultParse::RunIdMismatch);
		EXPECT(Result, ParseAgentResult(ResultBody("x"), "WLJ_" + U1, V) == EResultParse::RunIdMismatch);
		EXPECT(Result, ParseAgentResult(ResultBody("x", Wlj, std::string(CompanionSummaryMaxBytes, 's')), Wlj, V) == EResultParse::Ok);
		EXPECT(Result, ParseAgentResult(ResultBody("x", Wlj, std::string(CompanionSummaryMaxBytes + 1, 's')), Wlj, V) == EResultParse::BadSummary);
		EXPECT(Result, ParseAgentResult(ResultBody("x", Wlj, "s", "exe"), Wlj, V) == EResultParse::BadArtifact);
		EXPECT(Result, ParseAgentResult(ResultBody("x", Wlj, "s", "text", "wonderland.companion_result.v1"), Wlj, V) == EResultParse::BadSchema);
		std::string BadTask = ResultBody("x");
		BadTask.replace(BadTask.find("cmp_"), 4, "tsk_");
		EXPECT(Result, ParseAgentResult(BadTask, Wlj, V) == EResultParse::BadTaskId);
		EXPECT(Result, ParseAgentResult(ResultBody("rm -rf \\u202e/\\u0007"), Wlj, V) == EResultParse::Ok && V.ArtifactContent == "rm -rf /");

		FAgentProvenanceView P;
		const std::string Real = "{\"source\":\"companion_port\",\"connectionMode\":\"agent_webhook\",\"simulated\":false,\"resultSha256\":\""
			+ std::string(64, 'a') + "\",\"verifiedBy\":\"task_token_round_trip\",\"selfReported\":{\"name\":\"Bot\",\"runUrl\":null}}";
		EXPECT(Result, ParseAgentProvenance(Real, P) == EProvenanceParse::Ok && !P.bSimulated && P.bVerifiedByTokenRoundTrip && P.SelfReportedName == "Bot");
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"simulated\",\"simulated\":true}", P) == EProvenanceParse::Ok && P.bSimulated && !P.bVerifiedByTokenRoundTrip);
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"simulated\",\"simulated\":true,\"verifiedBy\":\"task_token_round_trip\"}", P) == EProvenanceParse::SimulatedVerified && P.bSimulated);
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"companion_port\",\"simulated\":true}", P) == EProvenanceParse::SimulatedInconsistent);
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"simulated\",\"simulated\":false}", P) == EProvenanceParse::SimulatedInconsistent);
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"companion_port\"}", P) == EProvenanceParse::BadFields && P.bSimulated);
		// A8: source is BRIDGE's closed set, "companion_port" | "simulated" (route.ts:108). A providerId is never a source.
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"companion_port\",\"simulated\":false}", P) == EProvenanceParse::Ok && !P.bSimulated);
		for (const char* Bad : {"openai", "grok_bot", "acme.local:v2", "", "has space", "Companion_port", "companion_port "})
		{
			EXPECT(Result, ParseAgentProvenance(std::string("{\"source\":\"") + Bad + "\",\"simulated\":false}", P) == EProvenanceParse::BadSource);
		}
		EXPECT(Result, ParseAgentProvenance("{\"source\":7,\"simulated\":false}", P) == EProvenanceParse::BadSource);
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"companion_port\",\"simulated\":false,\"verifiedBy\":\"vibes\"}", P) == EProvenanceParse::BadFields);
		EXPECT(Result, ParseAgentProvenance("{\"source\":\"companion_port\",\"simulated\":false}", P) == EProvenanceParse::Ok && !P.bVerifiedByTokenRoundTrip);
		EXPECT(Result, IsCompanionTaskId("cmp_" + U3) && !IsCompanionTaskId("cmp_" + U3 + " "));
		EXPECT(Result, std::strcmp(ResultParseName(EResultParse::RunIdMismatch), "run_id_mismatch") == 0);
	}

	/* ------------------------------------------------------------ mission companion read route (contract v0.1 3.7) */
	const std::string ArtifactOk = "{\"kind\":\"patch\",\"sha256\":\"" + std::string(64, 'b') + "\",\"byteLength\":1234}";
	std::string Prov(const std::string& Source = "\"companion_port\"", const std::string& Wake = "\"wake-7\"", const std::string& Digest = "\"" + std::string(64, 'c') + "\"",
		const std::string& Content = "\"" + std::string(64, 'b') + "\"", const std::string& Extra = "")
	{
		return "{\"source\":" + Source + ",\"wakeId\":" + Wake + ",\"bodyDigest\":" + Digest + ",\"contentSha256\":" + Content + Extra + "}";
	}
	const std::string RealProvenance = Prov();

	std::string CompanionResult(const std::string& Summary = "did it", const std::string& Artifact = ArtifactOk, const std::string& Untrusted = "true")
	{
		return "{\"untrusted\":" + Untrusted + ",\"summary\":\"" + Summary + "\",\"artifact\":" + Artifact + "}";
	}
	std::string MissionBody(const std::string& State, const std::string& Result = "null", const std::string& Provenance = "null",
		const std::string& Run = Wlj, const std::string& Task = "\"cmp_" + U3 + "\"", const std::string& Verified = ",\"verified\":false")
	{
		return "{\"wljRunId\":\"" + Run + "\",\"legacyRunId\":null,\"taskId\":" + Task + ",\"companion\":{\"state\":\"" + State + "\"},\"result\":" + Result
			+ ",\"provenance\":" + Provenance + ",\"updatedAt\":\"" + T0 + "\"" + Verified + "}";
	}

	/* ------------------------------------------------------------ #447 081d46e6: companion GET traceId */
	// BRIDGE's vectors, verbatim from scripts/julius-mission-trace.test.mjs / JULIUS_MISSION_TRACE.md at 081d46e6:
	//   wlj_01234567-89ab-4cde-8fab-0123456789ab -> 192b1fbb866790da0ba590b4a8f45144
	//   wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d -> 0ef34f0df7cf2cf89b844dcfa5fe084f
	// The client parses these; it does not compute them (no SHA-256 in the core).
	const std::string TraceRunA = "wlj_01234567-89ab-4cde-8fab-0123456789ab";
	const std::string TraceA = "192b1fbb866790da0ba590b4a8f45144";
	const std::string TraceRunB = "wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d";
	const std::string TraceB = "0ef34f0df7cf2cf89b844dcfa5fe084f";

	std::string TracedBody(const std::string& Run, const std::string& TraceJson, const std::string& State = "delivered")
	{
		return MissionBody(State, "null", "null", Run, "\"cmp_" + U3 + "\"", ",\"verified\":false,\"traceId\":" + TraceJson);
	}

	void TestTrace()
	{
		FCompanionMissionView V;
		// The two BRIDGE vectors, read as reported.
		EXPECT(Trace, ParseCompanionMission(200, TracedBody(TraceRunA, "\"" + TraceA + "\""), TraceRunA, V) == ECompanionMissionParse::Ok);
		EXPECT(Trace, V.bHasAnswer && V.TraceIdParse == ETraceIdParse::Ok && V.TraceId == TraceA);
		EXPECT(Trace, SameMissionTrace(V, TraceA) && !SameMissionTrace(V, TraceB));
		const std::string WithResult = MissionBody("result_received", CompanionResult(), "null", TraceRunB, "\"cmp_" + U3 + "\"",
			",\"verified\":false,\"traceId\":\"" + TraceB + "\"");
		EXPECT(Trace, ParseCompanionMission(200, WithResult, TraceRunB, V) == ECompanionMissionParse::Ok);
		EXPECT(Trace, V.bHasResult && V.TraceIdParse == ETraceIdParse::Ok && V.TraceId == TraceB && SameMissionTrace(V, TraceB));
		EXPECT(Trace, !V.bShowVerified); // a trace id is a correlation key, never evidence
		// Absent: a route before #447. The v0.1 read still works; no trace id is invented.
		EXPECT(Trace, ParseCompanionMission(200, MissionBody("delivered", "null", "null", TraceRunA), TraceRunA, V) == ECompanionMissionParse::Ok);
		EXPECT(Trace, V.bHasAnswer && V.TraceIdParse == ETraceIdParse::Absent && V.TraceId.empty());
		EXPECT(Trace, !SameMissionTrace(V, TraceA) && !SameMissionTrace(V, ""));
		// null (BRIDGE: derivation found no wlj_ id).
		EXPECT(Trace, ParseCompanionMission(200, TracedBody(TraceRunA, "null"), TraceRunA, V) == ECompanionMissionParse::Ok);
		EXPECT(Trace, V.bHasAnswer && V.TraceIdParse == ETraceIdParse::Null && V.TraceId.empty() && !SameMissionTrace(V, TraceA));
		// Malformed: each is no trace id, and never fails the v0.1 read.
		const std::string Malformed[] = {
			"\"" + std::string("192B1FBB866790DA0BA590B4A8F45144") + "\"", // uppercase
			"\"" + TraceA.substr(0, 31) + "\"",                            // 31
			"\"" + TraceA + "0\"",                                          // 33
			"\"" + std::string(32, '0') + "\"",                             // all zero (W3C invalid)
			"\"" + std::string(31, 'a') + "g\"",                            // not hex
			"\"00-" + TraceA + "-20d74ea3e2204340-01\"",                    // a traceparent is not a trace id
			"\"\"", "1234", "true", "[\"" + TraceA + "\"]", "{\"traceId\":\"" + TraceA + "\"}"};
		for (const std::string& Bad : Malformed)
		{
			const bool bOk = ParseCompanionMission(200, TracedBody(TraceRunA, Bad), TraceRunA, V) == ECompanionMissionParse::Ok;
			EXPECT(Trace, bOk && V.bHasAnswer && V.TraceIdParse == ETraceIdParse::Malformed && V.TraceId.empty() && !SameMissionTrace(V, TraceA));
		}
		// A body that fails a v0.1 check exposes no trace id, even a well-formed one.
		EXPECT(Trace, ParseCompanionMission(200, TracedBody(TraceRunA, "\"" + TraceA + "\"", "paid"), TraceRunA, V) == ECompanionMissionParse::BadState);
		EXPECT(Trace, !V.bHasAnswer && V.TraceId.empty() && V.TraceIdParse == ETraceIdParse::Absent && !SameMissionTrace(V, TraceA));
		// Another run's body is not read for a trace id.
		EXPECT(Trace, ParseCompanionMission(200, TracedBody(TraceRunB, "\"" + TraceB + "\""), TraceRunA, V) == ECompanionMissionParse::RunIdMismatch);
		EXPECT(Trace, V.TraceId.empty() && !SameMissionTrace(V, TraceB));
		// Non-200 (BRIDGE's 404 body has no traceId; a 404 with one is still no answer).
		for (int Code : {404, 409, 503})
		{
			EXPECT(Trace, ParseCompanionMission(Code, TracedBody(TraceRunA, "\"" + TraceA + "\""), TraceRunA, V) == ECompanionMissionParse::NotOk);
			EXPECT(Trace, V.TraceId.empty() && !SameMissionTrace(V, TraceA));
		}
		// The trace id is not a stand-in for the wljRunId and is not the other vector's id.
		EXPECT(Trace, ParseCompanionMission(200, TracedBody(TraceRunA, "\"" + TraceB + "\""), TraceRunA, V) == ECompanionMissionParse::Ok);
		EXPECT(Trace, V.TraceId == TraceB && !SameMissionTrace(V, TraceA)); // reported as is: the client does not re-derive
		// SameMissionTrace never matches a malformed result id, even one equal to the companion's text.
		FCompanionMissionView Forged;
		Forged.bHasAnswer = true;
		Forged.TraceIdParse = ETraceIdParse::Ok;
		Forged.TraceId = std::string(32, '0');
		EXPECT(Trace, !SameMissionTrace(Forged, std::string(32, '0')));
		Forged.TraceId = "192B1FBB866790DA0BA590B4A8F45144";
		EXPECT(Trace, !SameMissionTrace(Forged, "192B1FBB866790DA0BA590B4A8F45144"));
		Forged.TraceId.clear();
		EXPECT(Trace, !SameMissionTrace(Forged, ""));
		Forged.TraceId = TraceA;
		EXPECT(Trace, SameMissionTrace(Forged, TraceA));
		Forged.bHasAnswer = false; // a view without an answer never matches, whatever it holds
		EXPECT(Trace, !SameMissionTrace(Forged, TraceA));
		Forged.bHasAnswer = true;
		Forged.TraceIdParse = ETraceIdParse::Malformed;
		EXPECT(Trace, !SameMissionTrace(Forged, TraceA));
		// The client never sends a traceId: the request carries none in the URL or the body.
		const FRelayRequest R = CompanionMissionRequest(Origin, TraceRunA, "project-1");
		EXPECT(Trace, R.Method == "GET" && R.Url.find("traceId") == std::string::npos && R.Url.find(TraceA) == std::string::npos && R.Body.empty());
		// Names.
		EXPECT(Trace, std::strcmp(TraceIdParseName(ETraceIdParse::Ok), "ok") == 0 && std::strcmp(TraceIdParseName(ETraceIdParse::Malformed), "malformed") == 0);
		EXPECT(Trace, std::strcmp(TraceIdParseName(ETraceIdParse::Absent), "absent") == 0 && std::strcmp(TraceIdParseName(ETraceIdParse::Null), "null") == 0);
		EXPECT(Trace, IsMissionTraceId(TraceA) && IsMissionTraceId(TraceB) && !IsMissionTraceId(std::string(32, '0')) && IsMissionTraceId(std::string(31, '0') + "1"));
	}

	void TestRoute()
	{
		// The request: wlj_ only, loopback only, query-safe projectId.
		const FRelayRequest R = CompanionMissionRequest(Origin, Wlj, "project-1");
		EXPECT(Route, R.Method == "GET" && R.Url == Origin + "/relay-api/wonderland/julius/missions/" + Wlj + "/companion?projectId=project-1");
		EXPECT(Route, R.Body.empty() && R.IdempotencyKey.empty());
		EXPECT(Route, CompanionMissionRequest(Origin, Legacy, "project-1").Method.empty());
		EXPECT(Route, CompanionMissionRequest(Origin, "WLJ_" + U1, "project-1").Method.empty());
		EXPECT(Route, CompanionMissionRequest(Origin, Wlj + "/../x", "project-1").Method.empty());
		EXPECT(Route, CompanionMissionRequest(Origin, Wlj, "a b").Method.empty() && CompanionMissionRequest(Origin, Wlj, std::string(65, 'p')).Method.empty());
		EXPECT(Route, CompanionMissionRequest(Origin, Wlj, std::string(64, 'p')).Method == "GET");
		EXPECT(Route, CompanionMissionRequest("http://192.168.1.2:47123", Wlj, "project-1").Method.empty());

		FCompanionMissionView V;
		// Q22: any non-200 is "no result", even with a body that would parse.
		for (int Code : {201, 204, 304, 400, 404, 409, 500, 503, 0, -1})
		{
			EXPECT(Route, ParseCompanionMission(Code, MissionBody("result_received", CompanionResult(), RealProvenance), Wlj, V) == ECompanionMissionParse::NotOk);
			EXPECT(Route, !V.bHasAnswer && !V.bShowVerified && !V.bHasResult);
		}
		// Before any result.
		EXPECT(Route, ParseCompanionMission(200, MissionBody("delivered"), Wlj, V) == ECompanionMissionParse::Ok && V.bHasAnswer);
		EXPECT(Route, V.State == ECompanionTaskState::Delivered && !V.bHasResult && !V.bHasProvenance && !V.bShowVerified && V.TaskId == "cmp_" + U3);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("none", "null", "null", Wlj, "null"), Wlj, V) == ECompanionMissionParse::Ok && V.TaskId.empty());
		EXPECT(Route, ParseCompanionMission(200, MissionBody("no_result"), Wlj, V) == ECompanionMissionParse::Ok && V.State == ECompanionTaskState::NoResult);
		// A result with BRIDGE's provenance: shown, never verified (route.ts:249).
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), RealProvenance), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, V.bHasResult && V.Summary == "did it" && V.ArtifactKind == EArtifactKind::Patch && V.ArtifactSha256 == std::string(64, 'b'));
		EXPECT(Route, V.ArtifactByteLength == 1234 && V.bHasProvenance && !V.bShowVerified && !V.Provenance.bSimulated && !V.Provenance.bVerifiedByTokenRoundTrip);
		EXPECT(Route, V.Provenance.WakeId == "wake-7" && V.Provenance.BodyDigest == std::string(64, 'c') && V.Provenance.ResultSha256 == std::string(64, 'b'));
		EXPECT(Route, ParseCompanionMission(200, MissionBody("integrated", CompanionResult(), RealProvenance), Wlj, V) == ECompanionMissionParse::Ok && !V.bShowVerified);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("rejected", CompanionResult(), RealProvenance), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), Prov("\"simulated\"", "null", "null")), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, V.Provenance.bSimulated && !V.bShowVerified && V.Provenance.WakeId.empty() && V.Provenance.BodyDigest.empty());
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), Prov("\"companion_port\"", "\"" + std::string(ProvenanceWakeIdMaxBytes, 'w') + "\"")), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), Prov("\"companion_port\"", "\"w\\u202ex\"")), Wlj, V) == ECompanionMissionParse::Ok && V.Provenance.WakeId == "wx");
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult()), Wlj, V) == ECompanionMissionParse::Ok && !V.bHasProvenance);
		// provenanceOf (route.ts:593-611): every key, closed source, hex digests, the artifact's own sha, no verified / verifiedBy.
		{
			const std::string B64 = "\"" + std::string(64, 'b') + "\"";
			const std::string Bad[] = {
				Prov("\"grok_bot\""), Prov("\"openai\""), Prov("\"Simulated\""), Prov("null"), Prov("7"),
				Prov("\"companion_port\"", "7"), Prov("\"companion_port\"", "\"" + std::string(ProvenanceWakeIdMaxBytes + 1, 'w') + "\""),
				Prov("\"companion_port\"", "\"w\"", "\"" + std::string(64, 'C') + "\""), Prov("\"companion_port\"", "\"w\"", "\"abc\""), Prov("\"companion_port\"", "\"w\"", "1"),
				Prov("\"companion_port\"", "\"w\"", "null", "null"), Prov("\"companion_port\"", "\"w\"", "null", "\"" + std::string(64, 'a') + "\""),
				Prov("\"companion_port\"", "\"w\"", "null", B64, ",\"verified\":false"),
				Prov("\"companion_port\"", "\"w\"", "null", B64, ",\"verifiedBy\":null"),
				Prov("\"simulated\"", "null", "null", B64, ",\"verifiedBy\":\"task_token_round_trip\""),
				"{\"source\":\"companion_port\",\"bodyDigest\":null,\"contentSha256\":" + B64 + "}",
				"{\"source\":\"companion_port\",\"wakeId\":null,\"contentSha256\":" + B64 + "}",
				"\"verified\"", "[]",
			};
			int Row = 0;
			for (const std::string& P : Bad)
			{
				const bool bRefused = ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), P), Wlj, V) == ECompanionMissionParse::BadProvenance && !V.bHasAnswer;
				if (!bRefused) { std::printf("  provenance row %d accepted\n", Row); }
				EXPECT(Route, bRefused);
				++Row;
			}
		}
		// route.ts:246: provenance only with a result.
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", "null", RealProvenance), Wlj, V) == ECompanionMissionParse::BadProvenance && !V.bHasAnswer);
		// route.ts:249: verified is the literal false; absent or anything else is not this route.
		for (const std::string& Verified : {std::string(), std::string(",\"verified\":true"), std::string(",\"verified\":\"false\""), std::string(",\"verified\":null"),
				 std::string(",\"verified\":0")})
		{
			EXPECT(Route, ParseCompanionMission(200, MissionBody("delivered", "null", "null", Wlj, "\"cmp_" + U3 + "\"", Verified), Wlj, V) == ECompanionMissionParse::BadVerified);
			EXPECT(Route, !V.bHasAnswer && !V.bShowVerified);
		}
		EXPECT(Route, std::strcmp(CompanionMissionParseName(ECompanionMissionParse::BadVerified), "bad_verified") == 0);
		// Results only after result_received.
		for (const char* Early : {"none", "invited", "delivered", "delivery_failed", "timed_out", "no_result", "cancelled"})
		{
			EXPECT(Route, ParseCompanionMission(200, MissionBody(Early, CompanionResult()), Wlj, V) == ECompanionMissionParse::ResultTooEarly && !V.bHasAnswer);
			EXPECT(Route, ParseCompanionMission(200, MissionBody(Early, "null", RealProvenance), Wlj, V) == ECompanionMissionParse::ResultTooEarly && !V.bShowVerified);
		}
		// The result object.
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult("s", ArtifactOk, "false")), Wlj, V) == ECompanionMissionParse::BadResult);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult("s", ArtifactOk, "\"true\"")), Wlj, V) == ECompanionMissionParse::BadResult);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(std::string(CompanionSummaryMaxBytes, 's'))), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(std::string(CompanionSummaryMaxBytes + 1, 's'))), Wlj, V) == ECompanionMissionParse::BadResult);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult("s", "{\"kind\":\"exe\",\"sha256\":\"" + std::string(64, 'b') + "\",\"byteLength\":1}")), Wlj, V) == ECompanionMissionParse::BadResult);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult("s", "{\"kind\":\"text\",\"sha256\":\"" + std::string(64, 'B') + "\",\"byteLength\":1}")), Wlj, V) == ECompanionMissionParse::BadResult);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult("s", "{\"kind\":\"text\",\"sha256\":\"" + std::string(64, 'b') + "\",\"byteLength\":-1}")), Wlj, V) == ECompanionMissionParse::BadResult);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult("s", "{\"kind\":\"text\",\"sha256\":\"" + std::string(64, 'b') + "\",\"byteLength\":1,\"content\":\"rm -rf /\"}")), Wlj, V) == ECompanionMissionParse::BadResult);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult("rm -rf \\u202e/\\u0007")), Wlj, V) == ECompanionMissionParse::Ok && V.Summary == "rm -rf /");
		// Identity, state, shape.
		EXPECT(Route, ParseCompanionMission(200, MissionBody("delivered", "null", "null", OtherWlj), Wlj, V) == ECompanionMissionParse::RunIdMismatch);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("delivered", "null", "null", Legacy), Wlj, V) == ECompanionMissionParse::RunIdMismatch);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("delivered"), Legacy, V) == ECompanionMissionParse::RunIdMismatch);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("delivered", "null", "null", Wlj, "\"tsk_" + U3 + "\""), Wlj, V) == ECompanionMissionParse::BadTaskId);
		std::string NoTask = MissionBody("delivered");
		NoTask.replace(NoTask.find("\"taskId\""), 8, "\"taskID\"");
		EXPECT(Route, ParseCompanionMission(200, NoTask, Wlj, V) == ECompanionMissionParse::BadTaskId);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("paid"), Wlj, V) == ECompanionMissionParse::BadState);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("refused"), Wlj, V) == ECompanionMissionParse::BadState); // a #440 status, not a 3.6 state
		std::string NoResultKey = MissionBody("delivered");
		NoResultKey.replace(NoResultKey.find("\"result\""), 8, "\"resul_\"");
		EXPECT(Route, ParseCompanionMission(200, NoResultKey, Wlj, V) == ECompanionMissionParse::BadResult);
		std::string NoProvKey = MissionBody("delivered");
		NoProvKey.replace(NoProvKey.find("\"provenance\""), 12, "\"provenanc_\"");
		EXPECT(Route, ParseCompanionMission(200, NoProvKey, Wlj, V) == ECompanionMissionParse::BadProvenance);
		std::string BadAt = MissionBody("delivered");
		BadAt.replace(BadAt.find(".345Z"), 5, ".345+00:00");
		EXPECT(Route, ParseCompanionMission(200, BadAt, Wlj, V) == ECompanionMissionParse::BadUpdatedAt);
		EXPECT(Route, ParseCompanionMission(200, "{\"data\":" + MissionBody("delivered") + "}", Wlj, V) == ECompanionMissionParse::RunIdMismatch);
		EXPECT(Route, ParseCompanionMission(200, std::string(StatusMaxBodyBytes + 1, ' '), Wlj, V) == ECompanionMissionParse::TooLarge);
		EXPECT(Route, ParseCompanionMission(200, "[]", Wlj, V) == ECompanionMissionParse::BadJson && !V.bHasAnswer);
		// Terminal companion states (v0.1 3.6).
		for (ECompanionTaskState S : {ECompanionTaskState::DeliveryFailed, ECompanionTaskState::Integrated, ECompanionTaskState::Rejected,
				 ECompanionTaskState::TimedOut, ECompanionTaskState::NoResult, ECompanionTaskState::Cancelled})
		{
			EXPECT(Route, IsTerminalCompanionState(S));
		}
		for (ECompanionTaskState S : {ECompanionTaskState::None, ECompanionTaskState::Invited, ECompanionTaskState::Delivered, ECompanionTaskState::ResultReceived})
		{
			EXPECT(Route, !IsTerminalCompanionState(S));
		}
		EXPECT(Route, std::strcmp(CompanionMissionParseName(ECompanionMissionParse::NotOk), "not_ok") == 0);
	}

	/* ------------------------------------------------------------ BRIDGE chat answers Q1-Q15 */
	const std::string KindBody(const std::string& Kind) { return "{\"error\":{\"kind\":\"" + Kind + "\",\"message\":\"x\"}}"; }

	bool TraceHas(const FCompanionSession& S, const std::string& Word)
	{
		for (const std::string& L : S.Trace())
		{
			if (L == Word) { return true; }
		}
		return false;
	}

	bool TraceHas(const FOneAgent& S, const std::string& Word) { return TraceHas(S.S, Word); }

	bool ConnectWith(FOneAgent& S, int Status, const std::string& Body) { return ConnectAs(S.S, S.Provider, Status, Body); }

	void TestAnswers()
	{
		/* Q1: messageId is "msg_" + canonical lowercase UUIDv4, in meta, done and the replay. */
		EXPECT(Answers, IsMessageId(Msg1) && IsMessageId(Msg2));
		EXPECT(Answers, !IsMessageId("msg_1") && !IsMessageId("msg_") && !IsMessageId("cnv_" + U1) && !IsMessageId(U1));
		EXPECT(Answers, !IsMessageId("msg_123E4567-E89B-42D3-A456-426614174000") && !IsMessageId("msg_123e4567-e89b-12d3-a456-426614174000"));
		EXPECT(Answers, RunChat(Meta(Conv, "", "msg_1") + Done("msg_1")).Fault == EChatProtocolFault::MetaBadMessageId);
		EXPECT(Answers, RunChat(Meta() + Done("msg_1")).Fault == EChatProtocolFault::DoneBadFields);
		EXPECT(Answers, RunChat(Meta() + Done(Msg2)).Fault == EChatProtocolFault::DoneMessageMismatch);
		EXPECT(Answers, RunChat(Replayed(Conv, Msg2) + Delta("x") + Done(Msg2), Conv, true, std::string::npos, Msg1).Fault == EChatProtocolFault::ReplayMessageMismatch);
		EXPECT(Answers, RunChat(Replayed(Conv, Msg1) + Delta("x") + Done(), Conv, true, std::string::npos, Msg1).Outcome == EChatStreamOutcome::Done);
		{
			// The resend's replay must carry the messageId the first attempt's meta showed.
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S));
			EXPECT(Answers, Send(S, "q1", 1001));
			S.FeedChatBytes(Meta(Conv, "", Msg2) + Delta("part"), 0);
			S.FinishChatStream(0);
			FRelayRequest Re;
			EXPECT(Answers, S.BeginResend(0, Re) && Re.IdempotencyKey == Idem(1001));
			S.FeedChatBytes(Replayed(Conv, Msg1) + Delta("full") + Done(Msg1), 0);
			EXPECT(Answers, S.History().Size() == 0 && TraceHas(S, "chat_fault_replay_message_mismatch"));
			EXPECT(Answers, S.View().StatusLine == "The reply was cut off; resend to get it");
		}
		{
			// A first message has no conversationId to send; the replay must match the one the first meta showed.
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S));
			EXPECT(Answers, Send(S, "q1b", 1002));
			S.FeedChatBytes(Meta(Conv, "", Msg2), 0);
			S.FinishChatStream(0);
			FRelayRequest Re;
			EXPECT(Answers, S.BeginResend(0, Re));
			S.FeedChatBytes(Replayed("cnv_" + U3, Msg2) + Delta("full") + Done(Msg2), 0);
			EXPECT(Answers, S.History().Size() == 0 && TraceHas(S, "chat_fault_conversation_mismatch"));
		}

		/* Q2: SSE id and retry fields are never sent; any is a protocol fault. */
		{
			FSseParser P;
			std::vector<FSseEvent> Out;
			P.Feed("retry: 10\ndata: k\n\nid: 7\ndata: j\n\ndata: plain\n\n", Out);
			EXPECT(Answers, Out.size() == 3 && Out[0].bHadIdOrRetry && Out[1].bHadIdOrRetry && !Out[2].bHadIdOrRetry);
			EXPECT(Answers, P.RetryFieldCount() == 1 && P.IdFieldCount() == 1);
		}
		EXPECT(Answers, RunChat(Meta() + "id: 5\n" + Delta("x") + Done()).Fault == EChatProtocolFault::ForbiddenSseField);
		EXPECT(Answers, RunChat("retry: 3000\n" + Meta() + Delta("x") + Done()).Fault == EChatProtocolFault::ForbiddenSseField);
		EXPECT(Answers, RunChat(Meta() + "retry: 1000\n\n" + Delta("x") + Done()).Fault == EChatProtocolFault::ForbiddenSseField);
		EXPECT(Answers, RunChat(Meta() + Delta("x") + "retry: 5\n").Fault == EChatProtocolFault::ForbiddenSseField);
		EXPECT(Answers, RunChat(Meta() + Delta("x") + "id\n\n").Fault == EChatProtocolFault::ForbiddenSseField);
		{
			const std::string Stream = Meta() + "id: 1\n" + Delta("x") + Done();
			bool bAll = true;
			for (std::size_t I = 0; I <= Stream.size(); ++I)
			{
				if (RunChat(Stream, "", false, I).Fault != EChatProtocolFault::ForbiddenSseField) { bAll = false; }
			}
			EXPECT(Answers, bAll);
		}
		EXPECT(Answers, std::strcmp(ChatProtocolFaultName(EChatProtocolFault::ForbiddenSseField), "forbidden_sse_field") == 0);

		/* Q3: a replay is exactly meta(replayed:true) + one delta + done, or meta + error. */
		EXPECT(Answers, RunChat(Delta("x") + Done(), Conv, true).Fault == EChatProtocolFault::MetaMissing);
		EXPECT(Answers, RunChat(Err("provider_unavailable", "x")).Fault == EChatProtocolFault::MetaMissing);
		EXPECT(Answers, RunChat(Meta() + Err("provider_unavailable", "x")).Outcome == EChatStreamOutcome::ProviderError);
		EXPECT(Answers, RunChat(Replayed() + Delta("x") + Done()).Fault == EChatProtocolFault::MetaBadReplayed);
		EXPECT(Answers, RunChat(Meta(Conv, ",\"replayed\":\"yes\"") + Delta("x") + Done(), Conv, true).Fault == EChatProtocolFault::MetaBadReplayed);
		EXPECT(Answers, RunChat(Meta(Conv, ",\"replayed\":1") + Delta("x") + Done()).Fault == EChatProtocolFault::MetaBadReplayed);
		EXPECT(Answers, RunChat(Meta(Conv, ",\"replayed\":false") + Delta("a") + Delta("b") + Done(), Conv, true).Outcome == EChatStreamOutcome::Done);
		EXPECT(Answers, RunChat(Replayed() + Delta("a") + Delta("b") + Done(), Conv, true).Fault == EChatProtocolFault::ReplaySequence);
		EXPECT(Answers, RunChat(Replayed() + Done(), Conv, true).Fault == EChatProtocolFault::ReplaySequence);
		EXPECT(Answers, RunChat(Replayed() + Delta("a") + Delta("b"), Conv, true).Fault == EChatProtocolFault::ReplaySequence);
		EXPECT(Answers, RunChat(Replayed() + Delta("a") + Err("provider_unavailable", "x"), Conv, true).Fault == EChatProtocolFault::ReplaySequence);
		EXPECT(Answers, RunChat(Replayed() + Err("provider_unavailable", "x"), Conv, true).Outcome == EChatStreamOutcome::ProviderError);
		{
			FChatStreamDecoder D(TestProvider, Conv, true, Msg1);
			D.Feed(Replayed() + Delta("whole reply") + Done());
			D.Finish();
			EXPECT(Answers, D.IsReplayed() && D.Outcome() == EChatStreamOutcome::Done && D.ReplyForDisplay() == "whole reply");
			FChatStreamDecoder L(TestProvider, Conv, true, Msg1);
			L.Feed(Meta() + Delta("a") + Done());
			EXPECT(Answers, !L.IsReplayed() && L.Outcome() == EChatStreamOutcome::Done);
		}

		/* Q4: 409 in_progress backs off ChatInProgressBackoffMs (session rows); the constant itself: */
		EXPECT(Answers, ChatInProgressBackoffMs == 2000);

		/* Q5: finishReason max_length is a complete reply with a fixed line. */
		{
			FChatStreamDecoder D(TestProvider, "", false);
			D.Feed(Meta() + Delta("long") + Done(Msg1, "max_length"));
			EXPECT(Answers, D.Outcome() == EChatStreamOutcome::Done && D.HitLengthLimit() && D.FinishReason() == "max_length");
			FChatStreamDecoder E(TestProvider, "", false);
			E.Feed(Meta() + Delta("short") + Done());
			EXPECT(Answers, E.Outcome() == EChatStreamOutcome::Done && !E.HitLengthLimit());
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q5", 1050));
			S.FeedChatBytes(Meta() + Delta("long") + Done(Msg1, "max_length"), 0);
			EXPECT(Answers, S.View().State == ECompanionState::Ready && S.View().StatusLine == "The reply reached the length limit");
			EXPECT(Answers, S.History().Size() == 1 && S.History().At(0).bHitLengthLimit && S.History().At(0).ReplyText == "long");
			EXPECT(Answers, TraceHas(S, "chat_done_max_length") && S.View().bCanSend && !S.View().bCanResend);
			EXPECT(Answers, Send(S, "q5b", 1051));
			S.FeedChatBytes(Meta() + Delta("ok") + Done(), 0);
			EXPECT(Answers, S.View().StatusLine.empty() && !S.History().At(1).bHitLengthLimit);
		}
		EXPECT(Answers, ChatServerMaxReplyBytes == 128 * 1024 && ChatServerMaxReplyBytes <= ChatMaxReplyBytes);

		/* Q6: 413 too large, 400 body invalid; the worst-case 8000-unit body fits the 64 KiB server cap. */
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q6", 1060));
			S.ApplyChatHttpAnswer(413, "", KindBody("companion_message_too_large"), 0);
			EXPECT(Answers, S.View().State == ECompanionState::Error && S.View().StatusLine == "Message too long" && TraceHas(S, "chat_too_large"));
			EXPECT(Answers, Send(S, "q6b", 1061));
			S.ApplyChatHttpAnswer(400, "", KindBody("companion_body_invalid"), 0);
			EXPECT(Answers, S.View().State == ECompanionState::Error && S.View().StatusLine == "Companion error" && TraceHas(S, "chat_body_invalid"));
			FRelayRequest R;
			EXPECT(Answers, Send(S, std::string(ChatMaxMessageUtf16Units, '\x01'), 1062, 0, Wlj, &R) && R.Body.size() <= ChatMaxRequestBodyBytes);
			EXPECT(Answers, Contains(R.Body, "\\u0001") && R.Body.size() > 6 * ChatMaxMessageUtf16Units);
			S.ApplyChatHttpAnswer(503, "", "", 0);
			std::string Emoji;
			for (std::size_t I = 0; I < ChatMaxMessageUtf16Units / 2; ++I) { Emoji += "\xF0\x9F\x98\x80"; }
			EXPECT(Answers, Send(S, Emoji, 1063, 0, Wlj, &R) && R.Body.size() <= ChatMaxRequestBodyBytes);
			EXPECT(Answers, ChatMaxRequestBodyBytes == 64 * 1024);
		}

		/* Q7: DELETE history 409 (a turn in flight server-side) stays pending; the next delete re-sends. */
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q7", 1070));
			S.FeedChatBytes(Meta() + Delta("r") + Done(), 0);
			FRelayRequest D = S.BeginDeleteHistory();
			EXPECT(Answers, D.Method == "DELETE" && Contains(D.Url, Conv));
			S.ApplyDeleteHistoryAnswer(409);
			D = S.BeginDeleteHistory();
			EXPECT(Answers, D.Method == "DELETE" && Contains(D.Url, Conv));
			S.ApplyDeleteHistoryAnswer(204);
			EXPECT(Answers, S.BeginDeleteHistory().Method.empty());
		}

		/* Q8: Retry-After is a positive delta-seconds without leading zero, else 60 s; retryAfterMs absent -> 60 s. */
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S));
			const std::pair<const char*, std::uint64_t> Rows[] = {{"0", 60000}, {"05", 60000}, {"1", 1000}, {"", 60000}, {"-1", 60000}, {"1.5", 60000}};
			int K = 1080;
			std::uint64_t Now = 100000;
			for (const auto& Row : Rows)
			{
				EXPECT(Answers, Send(S, "q8", K, Now));
				S.ApplyChatHttpAnswer(429, Row.first, KindBody("companion_rate_limited"), Now);
				EXPECT(Answers, S.View().State == ECompanionState::SlowDown && S.View().RetryNotBeforeMs == Now + Row.second);
				++K;
				Now += 100000;
			}
		}
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q8b", 1090, 5000));
			S.FeedChatBytes(Meta() + Err("provider_rate_limited", "slow"), 5000);
			EXPECT(Answers, S.View().State == ECompanionState::RetryLater && S.View().RetryNotBeforeMs == 5000 + DefaultRetryWaitMs);
			EXPECT(Answers, Send(S, "q8c", 1091, 70000));
			S.FeedChatBytes(Meta() + Err("provider_rate_limited", "slow", ",\"retryAfterMs\":0"), 70000);
			EXPECT(Answers, S.View().RetryNotBeforeMs == 70000);
		}
		EXPECT(Answers, DefaultRetryWaitMs == 60000);
		EXPECT(Answers, RunChat(Meta() + Err("provider_rate_limited", "x", ",\"retryAfterMs\":null")).Fault == EChatProtocolFault::ErrorBadFields);
		EXPECT(Answers, RunChat(Meta() + Err("provider_rate_limited", "x", ",\"retryAfterMs\":1.5")).Fault == EChatProtocolFault::ErrorBadFields);

		/* Q9: the companion origin is the J1 relay endpoint with at most one trailing slash removed. */
		EXPECT(Answers, RelayOriginFromJ1Endpoint("http://127.0.0.1:47123") == Origin);
		EXPECT(Answers, RelayOriginFromJ1Endpoint("http://127.0.0.1:47123/") == Origin);
		EXPECT(Answers, RelayOriginFromJ1Endpoint("http://[::1]:8080/") == "http://[::1]:8080");
		EXPECT(Answers, RelayOriginFromJ1Endpoint("http://127.0.0.1:47123//").empty() && RelayOriginFromJ1Endpoint("http://127.0.0.1:47123/relay-api").empty());
		EXPECT(Answers, RelayOriginFromJ1Endpoint("http://localhost:47123").empty() && RelayOriginFromJ1Endpoint("").empty() && RelayOriginFromJ1Endpoint("/").empty());
		EXPECT(Answers, RelayOriginFromJ1Endpoint("https://127.0.0.1:47123").empty());
		{
			FOneAgent S(RelayOriginFromJ1Endpoint("http://localhost:47123/"));
			EXPECT(Answers, !S.SessionView().bOriginOk && S.SessionView().StatusLine == "Companion relay must be on this machine");
		}

		/* Q10 (labels per mode) is retired in v0.2: the agent's displayName replaces it (A10); see the session and agents sections. */

		/* Q11: v0 never sends simulated:true; it is a protocol fault, never shown as a reply. */
		EXPECT(Answers, RunChat(Meta(Conv, ",\"simulated\":true") + Delta("fake") + Done()).Fault == EChatProtocolFault::MetaSimulatedTrue);
		EXPECT(Answers, RunChat(Meta(Conv, ",\"simulated\":false") + Delta("real") + Done()).Outcome == EChatStreamOutcome::Done);
		EXPECT(Answers, RunChat(Meta(Conv, ",\"simulated\":\"no\"") + Delta("x") + Done()).Fault == EChatProtocolFault::MetaBadSimulated);
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q11", 1110));
			S.FeedChatBytes(Meta(Conv, ",\"simulated\":true") + Delta("FAKE-REPLY") + Done(), 0);
			EXPECT(Answers, S.History().Size() == 0 && !Contains(Everything(S), "FAKE-REPLY") && TraceHas(S, "chat_fault_meta_simulated_true"));
			EXPECT(Answers, S.View().PartialReply.empty() && S.View().State == ECompanionState::Error);
		}

		/* Q12: a rejection survives disconnect and agent lists; only a successful connect answer for that agent clears it. */
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q12", 1120));
			S.FeedChatBytes(Meta() + Err("provider_auth_failed", "bad key"), 0);
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected);
			EXPECT(Answers, !S.BeginDisconnect().Method.empty());
			S.ApplyDisconnectAnswer(200, Gone(TestAgent));
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected && S.View().StatusLine == "Your key was rejected" && S.View().bShowSimulatedBanner);
			S.S.ApplyAgentSlots(Slots("[" + ConnectOk + "]"));
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected && !S.View().bCanSend);
			EXPECT(Answers, ConnectWith(S, 400, KindBody("companion_credentials_rejected")));
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected);
			EXPECT(Answers, ConnectWith(S, 201, ConnectOk));
			EXPECT(Answers, S.View().State == ECompanionState::Ready && S.View().Offline == EOfflineReason::None && S.View().bCanSend);
		}

		/* Q13: DELETE agent carries no idempotency key and no body. */
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S));
			const FRelayRequest D = S.BeginDisconnect();
			EXPECT(Answers, D.Method == "DELETE" && D.IdempotencyKey.empty() && D.Body.empty());
		}

		/* Q14: a refused connect (400 companion_credentials_rejected, route.ts:288) leaves the old connection; the 201 answer is strict. */
		{
			FOneAgent S(Origin);
			EXPECT(Answers, MakeReady(S));
			EXPECT(Answers, ConnectWith(S, 400, KindBody("companion_credentials_rejected")));
			EXPECT(Answers, S.View().State == ECompanionState::Ready && S.SessionView().StatusLine == "Could not connect the agent" && S.View().bCanSend);
			EXPECT(Answers, !S.View().bShowSimulatedBanner && TraceHas(S, "connect_failed"));
			EXPECT(Answers, Send(S, "q14", 1141));
			S.FeedChatBytes(Meta() + Delta("ok") + Done(), 0);
			EXPECT(Answers, S.View().State == ECompanionState::Ready && S.SessionView().StatusLine.empty() && S.History().Size() == 1);
		}
		{
			FOneAgent S(Origin);
			EXPECT(Answers, ConnectWith(S, 400, KindBody("companion_credentials_rejected")));
			EXPECT(Answers, !S.Has() && S.SessionView().StatusLine == "Could not connect the agent");
			for (int Code : {200, 202, 204, 400, 401, 403, 404, 405, 409, 422, 429, 500, 0})
			{
				EXPECT(Answers, ConnectWith(S, Code, ConnectOk) && !S.Has() && S.SessionView().StatusLine == "Could not connect the agent");
			}
			EXPECT(Answers, ConnectWith(S, 503, KindBody("julius_dispatch_unavailable")) && !S.Has() && S.SessionView().StatusLine == "Retry later");
		}
		{
			const std::string Bad[] = {
				"{\"providerId\":\"openai\",\"displayName\":\"A\",\"kind\":\"single\",\"adapterVersion\":\"1\",\"declaredCapabilities\":[],\"authorizedCapabilities\":[],\"connection\":\"connected\"}",
				Descriptor("agt main", TestProvider),
				Descriptor(TestAgent, "open ai"),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", ""),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", "Agent One", "triple"),
				Descriptor(TestAgent, TestProvider, "connected", "\"chat\"", AuthorizedDefault),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, "[\"tools.run\"]"),
				Descriptor(TestAgent, TestProvider, "connected_unverified"),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":\"yes\""),
				Descriptor(TestAgent, OtherProvider), // answered for another provider: never substituted
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"apiKey\":\"sk-x\""),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"token\":\"t\""),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"password\":\"p\""),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"last4\":\"1234\""),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":false"),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", "null"),
				Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, "", "Agent One", "null"),
				Descriptor(TestAgent, TestProvider, "unsupported", "[]", "[]", "", "Agent One", "single"),
				"[" + ConnectOk + "]",
			};
			int Row = 0;
			for (const std::string& Body : Bad)
			{
				FOneAgent S(Origin);
				const bool bSent = ConnectWith(S, 201, Body);
				const bool bRefused = bSent && !S.Has() && S.S.AgentIds().empty() && S.SessionView().StatusLine == "Could not connect the agent";
				if (!bRefused) { std::printf("  q14 row %d accepted\n", Row); }
				EXPECT(Answers, bRefused);
				++Row;
			}
			FOneAgent S(Origin);
			EXPECT(Answers, ConnectWith(S, 201, ConnectOk) && S.View().State == ECompanionState::Ready && !S.View().bShowSimulatedBanner);
		}
		/* Q15 (lastErrorKind on the connections list) is retired with that route in v0.2 (open question). */
	}

	/* ------------------------------------------------------------ idempotency-key minting */
	struct FScriptedBytes final : WonderlandJuliusMissionLogic::IRandomBytes16
	{
		std::uint8_t Next[16] = {};
		bool bOk = true;
		int Calls = 0;
		bool Fill(std::uint8_t (&Out)[16]) override
		{
			++Calls;
			if (!bOk) { return false; }
			std::memcpy(Out, Next, sizeof(Out));
			return true;
		}
	};

	struct FXorShiftBytes final : WonderlandJuliusMissionLogic::IRandomBytes16
	{
		std::uint64_t State = 0x9E3779B97F4A7C15ull;
		bool Fill(std::uint8_t (&Out)[16]) override
		{
			for (int I = 0; I < 16; ++I)
			{
				State ^= State << 13;
				State ^= State >> 7;
				State ^= State << 17;
				Out[I] = static_cast<std::uint8_t>(State >> 56);
			}
			return true;
		}
	};

	bool LooksV4(const std::string& K)
	{
		if (K.size() != 36 || K[8] != '-' || K[13] != '-' || K[18] != '-' || K[23] != '-') { return false; }
		for (std::size_t I = 0; I < K.size(); ++I)
		{
			if (I == 8 || I == 13 || I == 18 || I == 23) { continue; }
			const char C = K[I];
			if (!((C >= '0' && C <= '9') || (C >= 'a' && C <= 'f'))) { return false; }
		}
		return K[14] == '4' && (K[19] == '8' || K[19] == '9' || K[19] == 'a' || K[19] == 'b');
	}

	void TestMint()
	{
		{
			FScriptedBytes Src;
			for (int I = 0; I < 16; ++I) { Src.Next[I] = static_cast<std::uint8_t>(I); }
			FIdempotencyKeyMinter M;
			std::string K;
			EXPECT(Mint, M.Mint(Src, K) == EKeyMint::Minted && K == "00010203-0405-4607-8809-0a0b0c0d0e0f" && Src.Calls == 1);
			std::memset(Src.Next, 0xFF, sizeof(Src.Next));
			EXPECT(Mint, M.Mint(Src, K) == EKeyMint::Minted && K == "ffffffff-ffff-4fff-bfff-ffffffffffff" && Src.Calls == 2);
			std::memset(Src.Next, 0x00, sizeof(Src.Next));
			EXPECT(Mint, M.Mint(Src, K) == EKeyMint::Minted && K == "00000000-0000-4000-8000-000000000000");
			EXPECT(Mint, LooksV4(K) && M.IssuedCount() == 3);
			// A stuck source repeats: refused, key left empty, the repeat is not counted as issued.
			EXPECT(Mint, M.Mint(Src, K) == EKeyMint::RandomRepeated && K.empty() && M.IssuedCount() == 3);
			// A failing source: refused, any stale key cleared.
			Src.bOk = false;
			K = "stale-" + U1;
			EXPECT(Mint, M.Mint(Src, K) == EKeyMint::RandomUnavailable && K.empty() && M.IssuedCount() == 3);
		}
		{
			// Version / variant nibbles over every value of bytes 6 and 8.
			FScriptedBytes Src;
			FIdempotencyKeyMinter M;
			bool bAll = true;
			for (int V = 0; V < 256; ++V)
			{
				Src.Next[6] = static_cast<std::uint8_t>(V);
				Src.Next[8] = static_cast<std::uint8_t>(255 - V);
				Src.Next[0] = static_cast<std::uint8_t>(V);
				std::string K;
				if (M.Mint(Src, K) != EKeyMint::Minted || !LooksV4(K)) { bAll = false; }
			}
			EXPECT(Mint, bAll && M.IssuedCount() == 256);
		}
		{
			FXorShiftBytes Src;
			FIdempotencyKeyMinter M;
			std::unordered_set<std::string> Seen;
			bool bAll = true;
			for (int I = 0; I < 10000; ++I)
			{
				std::string K;
				if (M.Mint(Src, K) != EKeyMint::Minted || !LooksV4(K) || !WonderlandJuliusMissionLogic::IsCanonicalUuidV4(K)) { bAll = false; }
				Seen.insert(K);
			}
			EXPECT(Mint, bAll && Seen.size() == 10000 && M.IssuedCount() == 10000);
			// Minted keys are accepted by the session as idempotency keys.
			FOneAgent S(Origin);
			EXPECT(Mint, MakeReady(S));
			std::string K;
			EXPECT(Mint, M.Mint(Src, K) == EKeyMint::Minted);
			FRelayRequest R;
			EXPECT(Mint, S.BeginMessage("hi", K, "", 0, R) && R.IdempotencyKey == K);
		}
		{
			// The failure path in the session: a fixed error, nothing sent, and an empty key is refused.
			FOneAgent S(Origin);
			EXPECT(Mint, MakeReady(S));
			S.ApplyKeyMintFailure();
			EXPECT(Mint, S.View().State == ECompanionState::Error && S.View().StatusLine == "Secure random unavailable; try again");
			EXPECT(Mint, TraceHas(S, "key_mint_failed") && S.View().bCanSend && S.SessionView().StatusLine == "Secure random unavailable; try again");
			FRelayRequest R;
			EXPECT(Mint, !S.BeginMessage("hi", "", "", 0, R) && R.Method.empty());
			EXPECT(Mint, Send(S, "after", 1200) && S.View().State == ECompanionState::Streaming && S.SessionView().StatusLine.empty());
		}
		{
			// A connect-path mint failure (no agent yet): the session line shows it, nothing is registered.
			FCompanionSession S(Origin, Project, true);
			S.ApplyKeyMintFailure();
			EXPECT(Mint, S.SessionView().StatusLine == "Secure random unavailable; try again" && S.AgentIds().empty());
		}
	}

	/* ------------------------------------------------------------ v0.2 agents[]: descriptor and list parsing */
	std::string MissionWithAgents(const std::string& AgentsJson, const std::string& State = "delivered", const std::string& Run = Wlj)
	{
		return "{\"agents\":" + AgentsJson + "," + MissionBody(State, "null", "null", Run).substr(1);
	}

	void TestAgents()
	{
		{
			const FAgentSlot G = SlotOf(Descriptor(Ag("A-1"), OtherProvider, "connected", "[\"chat\",\"history\",\"tools.run\"]", "[\"chat\",\"history\"]",
				"", "Agent \xE2\x9C\x93", "compound"));
			EXPECT(Agents, G.Fault == EAgentSlotFault::None && G.Descriptor.AgentId == Ag("A-1") && G.Descriptor.ProviderId == OtherProvider);
			EXPECT(Agents, G.Descriptor.DisplayName == "Agent \xE2\x9C\x93" && G.Descriptor.Kind == EAgentKind::Compound && G.Descriptor.AdapterVersion == "1.4.2");
			EXPECT(Agents, G.Descriptor.DeclaredCapabilities.size() == 3 && G.Descriptor.AuthorizedCapabilities.size() == 2);
			EXPECT(Agents, G.Descriptor.Connection == EAgentConnection::Connected);
			EXPECT(Agents, SlotOf(Descriptor(TestAgent, TestProvider)).Descriptor.Kind == EAgentKind::Single);
			// Nullable fields (registry.ts:31-33): null displayName / kind / adapterVersion where BRIDGE publishes them.
			const FAgentSlot U = SlotOf(Descriptor(TestAgent, "zz", "unsupported", Auto, Auto, "", "null"));
			EXPECT(Agents, U.Fault == EAgentSlotFault::None && U.Descriptor.DisplayName.empty() && U.Descriptor.Kind == EAgentKind::Unknown && U.Descriptor.AdapterVersion.empty());
			const FAgentSlot E = SlotOf(Descriptor(TestAgent, TestProvider, "error", Auto, Auto, "", "Label"));
			EXPECT(Agents, E.Fault == EAgentSlotFault::None && E.Descriptor.Kind == EAgentKind::Unknown && E.Descriptor.AdapterVersion == "1.4.2" && E.Descriptor.DisplayName == "Label");
			const FAgentSlot D = SlotOf(Descriptor(TestAgent, TestProvider, "disconnected", DeclaredDefault, "[]", "", "null", "null"));
			EXPECT(Agents, D.Fault == EAgentSlotFault::None && D.Descriptor.Kind == EAgentKind::Unknown && D.Descriptor.DeclaredCapabilities.size() == 2);
			std::string NullVersion = Descriptor(TestAgent, TestProvider);
			NullVersion.replace(NullVersion.find("\"1.4.2\""), 7, "null");
			EXPECT(Agents, SlotOf(NullVersion).Fault == EAgentSlotFault::None && SlotOf(NullVersion).Descriptor.AdapterVersion.empty());
		}
		{
			struct FRow { std::string Json; EAgentSlotFault Fault; bool bKeepsId; };
			const std::string A = TestAgent;
			const std::string P = TestProvider;
			std::string SixtyFive = "[";
			for (int I = 0; I < 65; ++I) { SixtyFive += std::string(I ? "," : "") + "\"c" + std::to_string(I) + "\""; }
			SixtyFive += "]";
			const FRow Rows[] = {
				{"[]", EAgentSlotFault::NotObject, false},
				{"\"agt\"", EAgentSlotFault::NotObject, false},
				{Descriptor("", P), EAgentSlotFault::BadAgentId, false},
				{Descriptor("agt main", P), EAgentSlotFault::BadAgentId, false},
				{Descriptor("agt/x", P), EAgentSlotFault::BadAgentId, false},
				{Descriptor("agt.x", P), EAgentSlotFault::BadAgentId, false},
				{Descriptor("agt_main", P), EAgentSlotFault::BadAgentId, false},
				{Descriptor("agt_" + U1.substr(0, 14) + "1" + U1.substr(15), P), EAgentSlotFault::BadAgentId, false},
				{Descriptor("agt_" + U1.substr(0, 35) + "A", P), EAgentSlotFault::BadAgentId, false},
				{Descriptor("AGT_" + U1, P), EAgentSlotFault::BadAgentId, false},
				{Descriptor(A + " ", P), EAgentSlotFault::BadAgentId, false},
				{Descriptor(A, ""), EAgentSlotFault::BadProviderId, true},
				{Descriptor(A, "  "), EAgentSlotFault::BadProviderId, true},
				{Descriptor(A, std::string(201, 'p')), EAgentSlotFault::BadProviderId, true},
				{"{\"agentId\":\"" + A + "\",\"providerId\":7,\"displayName\":\"N\",\"kind\":\"single\",\"adapterVersion\":\"1\",\"declaredCapabilities\":[],\"authorizedCapabilities\":[],\"connection\":\"connected\"}",
					EAgentSlotFault::BadProviderId, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, "", ""), EAgentSlotFault::BadDisplayName, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, "", " \\t "), EAgentSlotFault::BadDisplayName, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, "", std::string(201, 'n')), EAgentSlotFault::BadDisplayName, true},
				{"{\"agentId\":\"" + A + "\",\"providerId\":\"" + P + "\",\"kind\":\"single\",\"adapterVersion\":\"1\",\"declaredCapabilities\":[],\"authorizedCapabilities\":[],\"connection\":\"disconnected\"}",
					EAgentSlotFault::BadDisplayName, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, "", "Agent One", "Single"), EAgentSlotFault::BadKind, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, "", "Agent One", ""), EAgentSlotFault::BadKind, true},
				{"{\"agentId\":\"" + A + "\",\"providerId\":\"" + P + "\",\"displayName\":\"N\",\"kind\":\"single\",\"declaredCapabilities\":[],\"authorizedCapabilities\":[],\"connection\":\"connected\"}",
					EAgentSlotFault::BadAdapterVersion, true},
				{Descriptor(A, P).replace(Descriptor(A, P).find("1.4.2"), 5, std::string(AdapterVersionMaxBytes + 1, 'v')), EAgentSlotFault::BadAdapterVersion, true},
				{Descriptor(A, P, "connected", "{}", "[]"), EAgentSlotFault::BadDeclaredCapabilities, true},
				{Descriptor(A, P, "connected", "[\"chat\",7]", "[]"), EAgentSlotFault::BadDeclaredCapabilities, true},
				{Descriptor(A, P, "connected", "[\"chat\",\"chat\"]", "[]"), EAgentSlotFault::BadDeclaredCapabilities, true},
				{Descriptor(A, P, "connected", "[\"chat\",\"tools/run\"]", "[]"), EAgentSlotFault::BadDeclaredCapabilities, true}, // O2: client grammar
				{Descriptor(A, P, "connected", "[\"ch at\"]", "[]"), EAgentSlotFault::BadDeclaredCapabilities, true},
				{Descriptor(A, P, "connected", SixtyFive, "[]"), EAgentSlotFault::BadDeclaredCapabilities, true},
				{Descriptor(A, P, "connected", DeclaredDefault, "null"), EAgentSlotFault::BadAuthorizedCapabilities, true},
				{Descriptor(A, P, "connected", DeclaredDefault, "[\"chat\",\"chat\"]"), EAgentSlotFault::BadAuthorizedCapabilities, true},
				{Descriptor(A, P, "connected", "[\"history\"]", "[\"chat\"]"), EAgentSlotFault::AuthorizedNotDeclared, true},
				{Descriptor(A, P, "connecting"), EAgentSlotFault::BadConnection, true},
				{Descriptor(A, P, "Connected"), EAgentSlotFault::BadConnection, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":\"true\""), EAgentSlotFault::BadVerified, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":1"), EAgentSlotFault::BadVerified, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":false"), EAgentSlotFault::BadVerified, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":true"), EAgentSlotFault::BadVerified, true},
				// publishAgentDescriptor's guarantees (registry.ts:198-212).
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, "", "null"), EAgentSlotFault::InconsistentConnection, true},
				{Descriptor(A, P, "connected", DeclaredDefault, AuthorizedDefault, "", "Agent One", "null"), EAgentSlotFault::InconsistentConnection, true},
				{Descriptor(A, P, "unsupported", "[]", "[]", "", "Agent One", "single"), EAgentSlotFault::InconsistentConnection, true},
				{Descriptor(A, P, "error", "[]", "[]", "", "Agent One", "compound"), EAgentSlotFault::InconsistentConnection, true},
				{Descriptor(A, P, "unsupported", "[\"chat\"]", "[]"), EAgentSlotFault::InconsistentConnection, true},
				{Descriptor(A, P, "error", "[\"chat\"]", "[\"chat\"]"), EAgentSlotFault::InconsistentConnection, true},
				{Descriptor(A, P, "error", "[\"chat\"]", "[]"), EAgentSlotFault::InconsistentConnection, true},
				{Descriptor(A, P, "unsupported").replace(Descriptor(A, P, "unsupported").find("\"adapterVersion\":null"), 21, "\"adapterVersion\":\"1\""),
					EAgentSlotFault::InconsistentConnection, true},
			};
			int Row = 0;
			for (const FRow& R : Rows)
			{
				const FAgentSlot S = SlotOf(R.Json);
				const bool bOk = S.Fault == R.Fault && (S.Descriptor.AgentId == (R.bKeepsId ? A : std::string()))
					&& S.Descriptor.Connection == EAgentConnection::Error && S.Descriptor.AuthorizedCapabilities.empty() && S.Descriptor.ProviderId.empty();
				if (!bOk) { std::printf("  agents row %d -> %s\n", Row, AgentSlotFaultName(S.Fault)); }
				EXPECT(Agents, bOk);
				++Row;
			}
			std::string SixtyFour = "[";
			for (int I = 0; I < 64; ++I) { SixtyFour += std::string(I ? "," : "") + "\"c" + std::to_string(I) + "\""; }
			SixtyFour += "]";
			EXPECT(Agents, SlotOf(Descriptor(A, P, "connected", SixtyFour, "[]")).Fault == EAgentSlotFault::None);
			std::string Emoji100;
			for (int I = 0; I < 100; ++I) { Emoji100 += "\xF0\x9F\x98\x80"; }
			EXPECT(Agents, SlotOf(Descriptor(A, std::string(200, 'p'), "connected", Auto, Auto, "", Emoji100)).Fault == EAgentSlotFault::None);
			EXPECT(Agents, SlotOf(Descriptor(A, Emoji100, "connected", Auto, Auto, "", std::string(200, 'n'))).Fault == EAgentSlotFault::None);
			EXPECT(Agents, SlotOf(Descriptor(A, Emoji100 + "p")).Fault == EAgentSlotFault::BadProviderId);
			EXPECT(Agents, SlotOf(Descriptor(A, "a/b c")).Fault == EAgentSlotFault::None); // opaque: any non-blank string
		}
		{
			EXPECT(Agents, IsAgentId(Ag("1-A")) && IsAgentId("agt_" + U1) && !IsAgentId(U1) && !IsAgentId("agt_1-A") && !IsAgentId("agt:1") && !IsAgentId("") && !IsAgentId("agt%2F"));
			EXPECT(Agents, IsProviderId("acme.local:v2") && IsProviderId("x") && IsProviderId("a b") && IsProviderId("a/b") && !IsProviderId("") && !IsProviderId(" \t"));
			EXPECT(Agents, IsAgentDisplayName("A") && !IsAgentDisplayName("") && !IsAgentDisplayName("\xE3\x80\x80") && IsAgentDisplayName(std::string(200, 'n')) && !IsAgentDisplayName(std::string(201, 'n')));
			EXPECT(Agents, ProviderIdMaxUtf16Units == 200 && DisplayNameMaxUtf16Units == 200);
			EXPECT(Agents, std::strcmp(AgentSlotFaultName(EAgentSlotFault::InconsistentConnection), "inconsistent_connection") == 0);
			EXPECT(Agents, IsCapabilityWord("tools.run") && !IsCapabilityWord(std::string(CapabilityMaxBytes + 1, 'c')) && IsCapabilityWord(std::string(CapabilityMaxBytes, 'c')));
			EXPECT(Agents, std::strcmp(AgentSlotFaultName(EAgentSlotFault::AuthorizedNotDeclared), "authorized_not_declared") == 0);
			EXPECT(Agents, std::strcmp(AgentListParseName(EAgentListParse::NotArray), "not_array") == 0);
		}
		{
			std::vector<FAgentSlot> Out(3);
			FJsonValue V;
			EXPECT(Agents, ParseJson("{\"x\":1}", V) && ParseAgentList(V, Out) == EAgentListParse::Absent && Out.empty());
			EXPECT(Agents, ParseJson("{\"agents\":{}}", V) && ParseAgentList(V, Out) == EAgentListParse::NotArray && Out.empty());
			EXPECT(Agents, ParseJson("{\"agents\":null}", V) && ParseAgentList(V, Out) == EAgentListParse::NotArray);
			EXPECT(Agents, ParseJson("{\"agents\":[]}", V) && ParseAgentList(V, Out) == EAgentListParse::Ok && Out.empty());
			// One bad entry never poisons the others.
			const std::vector<FAgentSlot> Mixed = Slots("[" + Descriptor(Ag("a"), TestProvider) + ",{\"agentId\":7}," + Descriptor(Ag("b"), OtherProvider, "bogus") + ","
				+ Descriptor(Ag("c"), OtherProvider) + "]");
			EXPECT(Agents, Mixed.size() == 4 && Mixed[0].Fault == EAgentSlotFault::None && Mixed[1].Fault == EAgentSlotFault::BadAgentId);
			EXPECT(Agents, Mixed[2].Fault == EAgentSlotFault::BadConnection && Mixed[2].Descriptor.AgentId == Ag("b") && Mixed[3].Fault == EAgentSlotFault::None);
			// The same agentId twice: both entries are faulted, never "the first wins".
			const std::vector<FAgentSlot> Dup = Slots("[" + Descriptor(Ag("a"), TestProvider) + "," + Descriptor(Ag("x"), TestProvider) + "," + Descriptor(Ag("a"), OtherProvider) + "]");
			EXPECT(Agents, Dup.size() == 3 && Dup[0].Fault == EAgentSlotFault::DuplicateAgentId && Dup[2].Fault == EAgentSlotFault::DuplicateAgentId);
			EXPECT(Agents, Dup[1].Fault == EAgentSlotFault::None && Dup[0].Descriptor.AgentId == Ag("a") && Dup[0].Descriptor.ProviderId.empty());
			std::string Many = "[";
			for (std::size_t I = 0; I < AgentListMaxEntries + 1; ++I) { Many += std::string(I ? "," : "") + Descriptor(Ag(std::to_string(I)), TestProvider); }
			Many += "]";
			const std::vector<FAgentSlot> Capped = Slots(Many);
			EXPECT(Agents, Capped.size() == AgentListMaxEntries + 1 && Capped.back().Fault == EAgentSlotFault::TooMany && Capped.back().Descriptor.AgentId.empty());
			EXPECT(Agents, Capped[AgentListMaxEntries - 1].Fault == EAgentSlotFault::None && Capped[AgentListMaxEntries - 1].Descriptor.AgentId == Ag("63"));
			EXPECT(Agents, AgentListMaxEntries == 64 && AgentRegistryMaxSlots == 32);
		}
		{
			// The mission route: agents[] read per slot, independent of (and never changing) the v0.1 result.
			FCompanionMissionView V;
			const std::string Two = "[" + Descriptor(Ag("a"), TestProvider) + "," + Descriptor(Ag("b"), OtherProvider, "unsupported", "[]", "[]") + "]";
			EXPECT(Agents, ParseCompanionMission(200, MissionWithAgents(Two), Wlj, V) == ECompanionMissionParse::Ok && V.AgentsParse == EAgentListParse::Ok);
			EXPECT(Agents, V.Agents.size() == 2 && V.Agents[1].Descriptor.Connection == EAgentConnection::Unsupported && V.State == ECompanionTaskState::Delivered);
			EXPECT(Agents, ParseCompanionMission(200, MissionBody("delivered"), Wlj, V) == ECompanionMissionParse::Ok && V.AgentsParse == EAgentListParse::Absent && V.Agents.empty());
			EXPECT(Agents, ParseCompanionMission(200, MissionWithAgents("{}"), Wlj, V) == ECompanionMissionParse::Ok && V.AgentsParse == EAgentListParse::NotArray);
			EXPECT(Agents, ParseCompanionMission(200, MissionWithAgents("[{\"agentId\":1}]"), Wlj, V) == ECompanionMissionParse::Ok && V.Agents.size() == 1);
			EXPECT(Agents, ParseCompanionMission(200, MissionWithAgents(Two, "paid"), Wlj, V) == ECompanionMissionParse::BadState && V.Agents.size() == 2);
			EXPECT(Agents, ParseCompanionMission(200, MissionWithAgents(Two, "delivered", OtherWlj), Wlj, V) == ECompanionMissionParse::RunIdMismatch && V.Agents.empty());
			EXPECT(Agents, ParseCompanionMission(404, MissionWithAgents(Two), Wlj, V) == ECompanionMissionParse::NotOk && V.Agents.empty());
		}
		{
			// Registry: upsert per agentId; a slot with no id, or past the cap, is counted unreadable and touches nobody.
			FCompanionSession S(Origin, Project, true);
			S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("a"), TestProvider) + ",{\"agentId\":\"bad id\"}," + Descriptor(Ag("b"), OtherProvider) + "]"));
			EXPECT(Agents, S.AgentIds() == std::vector<std::string>({Ag("a"), Ag("b")}) && S.SessionView().UnreadableSlots == 1 && S.SessionView().AgentCount == 2);
			EXPECT(Agents, TraceHas(S, "agent_slot_unreadable_bad_agent_id"));
			S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("b"), OtherProvider, "disconnected") + "]"));
			EXPECT(Agents, S.SessionView().UnreadableSlots == 0 && S.AgentIds().size() == 2 && S.View(Ag("a"))->State == ECompanionState::Ready);
			EXPECT(Agents, S.View(Ag("b"))->Offline == EOfflineReason::NotConnected && S.View(Ag("nobody")) == nullptr && S.History(Ag("nobody")) == nullptr);
			std::string Many = "[";
			for (std::size_t I = 0; I < AgentRegistryMaxSlots; ++I) { Many += std::string(I ? "," : "") + Descriptor(Ag("n" + std::to_string(I)), TestProvider); }
			Many += "]";
			S.ApplyAgentSlots(Slots(Many));
			EXPECT(Agents, S.AgentIds().size() == AgentRegistryMaxSlots && S.SessionView().UnreadableSlots == 2 && TraceHas(S, "agent_registry_full"));
			EXPECT(Agents, S.View(Ag("a")) != nullptr && S.View(Ag("n29")) != nullptr && S.View(Ag("n30")) == nullptr);
		}
	}

	/* ------------------------------------------------------------ several agents at once */
	void TestMulti()
	{
		FCompanionSession S(Origin, Project, true);
		EXPECT(Multi, ConnectAs(S, TestProvider, 201, Descriptor(Ag("a"), TestProvider)) && S.LastConnectedAgentId() == Ag("a"));
		EXPECT(Multi, ConnectAs(S, OtherProvider, 201, Descriptor(Ag("b"), OtherProvider, "connected", DeclaredDefault, AuthorizedDefault, "", "Second")));
		EXPECT(Multi, S.LastConnectedAgentId() == Ag("b") && S.AgentIds().size() == 2);
		// The same provider twice (two accounts): two agents, each its own identity.
		EXPECT(Multi, ConnectAs(S, TestProvider, 201, Descriptor(Ag("c"), TestProvider)) && S.AgentIds().size() == 3);
		EXPECT(Multi, S.View(Ag("a"))->State == ECompanionState::Ready && S.View(Ag("b"))->State == ECompanionState::Ready && S.View(Ag("c"))->bCanSend);
		EXPECT(Multi, S.View(Ag("b"))->DisplayName == "Second" && S.ProviderIdOf(Ag("b")) == OtherProvider && S.ProviderIdOf(Ag("c")) == TestProvider);
		EXPECT(Multi, !S.SessionView().bShowSimulatedBanner);
		FRelayRequest Ra;
		FRelayRequest Rb;
		EXPECT(Multi, SendTo(S, Ag("a"), "to a", 3010, 0, &Ra) && SendTo(S, Ag("b"), "to b", 3011, 0, &Rb));
		EXPECT(Multi, Ra.Url == Origin + "/relay-api/wonderland/companions/agents/" + Ag("a") + "/chat" + PQ && Rb.Url == Origin + "/relay-api/wonderland/companions/agents/" + Ag("b") + "/chat" + PQ);
		EXPECT(Multi, !Contains(Ra.Url, TestProvider) && !Contains(Rb.Url, OtherProvider) && !Contains(Ra.Body, TestProvider));
		// Idempotency keys are session-wide: one agent can never reuse another's.
		EXPECT(Multi, !SendTo(S, Ag("c"), "dup key", 3010));
		// Interleaved streams; each agent's decoder expects its own providerId.
		S.FeedChatBytes(Ag("a"), MetaFor(TestProvider) + Delta("A1"), 0);
		S.FeedChatBytes(Ag("b"), MetaFor(OtherProvider, "cnv_" + U3) + Delta("B1"), 0);
		EXPECT(Multi, S.View(Ag("a"))->PartialReply == "A1" && S.View(Ag("b"))->PartialReply == "B1");
		S.FeedChatBytes(Ag("b"), Done(), 0);
		S.FeedChatBytes(Ag("a"), Delta("A2") + Done(), 0);
		EXPECT(Multi, S.History(Ag("a"))->Size() == 1 && S.History(Ag("a"))->At(0).ReplyText == "A1A2" && S.ConversationId(Ag("a")) == Conv);
		EXPECT(Multi, S.History(Ag("b"))->Size() == 1 && S.History(Ag("b"))->At(0).ReplyText == "B1" && S.ConversationId(Ag("b")) == "cnv_" + U3);
		EXPECT(Multi, S.History(Ag("c"))->Size() == 0);
		// A stream that claims another agent's provider is a fault for that agent only.
		EXPECT(Multi, SendTo(S, Ag("a"), "x", 3012) && SendTo(S, Ag("b"), "y", 3013));
		S.FeedChatBytes(Ag("a"), MetaFor(OtherProvider) + Delta("spoof") + Done(), 0);
		EXPECT(Multi, S.View(Ag("a"))->State == ECompanionState::Error && TraceHas(S, "chat_fault_meta_wrong_provider") && S.History(Ag("a"))->Size() == 1);
		EXPECT(Multi, S.View(Ag("b"))->State == ECompanionState::Streaming);
		// A connect while another agent streams is fine.
		EXPECT(Multi, ConnectAs(S, "made.up", 201, Descriptor(Ag("d"), "made.up", "unsupported", "[]", "[]")) && S.View(Ag("b"))->State == ECompanionState::Streaming);
		S.FeedChatBytes(Ag("b"), MetaFor(OtherProvider, "cnv_" + U3, "", Msg2) + Delta("ok") + Done(Msg2), 0);
		EXPECT(Multi, S.History(Ag("b"))->Size() == 2 && S.View(Ag("b"))->State == ECompanionState::Ready);
		// Answers for the wrong agent are not taken.
		S.ApplyChatHttpAnswer(Ag("c"), 503, "", "", 0);
		EXPECT(Multi, S.View(Ag("c"))->State == ECompanionState::Ready && TraceHas(S, "chat_answer_unexpected"));
		EXPECT(Multi, !SendTo(S, Ag("nobody"), "x", 3015));
	}

	/* ------------------------------------------------------------ an unknown provider is an unsupported slot */
	void TestUnsupported()
	{
		{
			FCompanionSession S(Origin, Project, true);
			EXPECT(Unsupported, ConnectAs(S, TestProvider, 201, Descriptor(Ag("a"), TestProvider)));
			EXPECT(Unsupported, ConnectAs(S, "never.heard-of:it", 201, Descriptor(Ag("u"), "never.heard-of:it", "unsupported", "[]", "[]", "", "Unknown agent")));
			const FAgentView* U = S.View(Ag("u"));
			EXPECT(Unsupported, U != nullptr && U->State == ECompanionState::Offline && U->Offline == EOfflineReason::Unsupported);
			EXPECT(Unsupported, U->StatusLine == "This agent is not supported yet" && !U->bCanSend && !U->bCanConnect && !U->bMalformed && U->bShowSimulatedBanner);
			EXPECT(Unsupported, S.SessionView().StatusLine == "This agent is not supported yet" && TraceHas(S, "connect_unsupported") && !TraceHas(S, "connect_answer_refused"));
			EXPECT(Unsupported, S.LastConnectedAgentId() == Ag("u") && U->Connection == EAgentConnection::Unsupported && U->DisplayName == "Unknown agent");
			EXPECT(Unsupported, S.View(Ag("a"))->State == ECompanionState::Ready && S.View(Ag("a"))->bCanSend && !S.SessionView().bShowSimulatedBanner);
			EXPECT(Unsupported, !SendTo(S, Ag("u"), "hello?", 3102) && SendTo(S, Ag("a"), "hello", 3103));
			// A later connect for a supported agent replaces the notice.
			EXPECT(Unsupported, ConnectAs(S, OtherProvider, 201, Descriptor(Ag("b"), OtherProvider)) && S.SessionView().StatusLine.empty());
		}
		{
			// From a list: unsupported is a state, not a fault; claims of chat are not honoured for it.
			FCompanionSession S(Origin, Project, true);
			S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("u"), "zz", "unsupported") + "," + Descriptor(Ag("a"), TestProvider) + "]"));
			EXPECT(Unsupported, S.View(Ag("u"))->Offline == EOfflineReason::Unsupported && !S.View(Ag("u"))->bMalformed && S.SessionView().UnreadableSlots == 0);
			EXPECT(Unsupported, S.View(Ag("u"))->AuthorizedCapabilities.empty() && !SendTo(S, Ag("u"), "x", 3110));
			EXPECT(Unsupported, S.View(Ag("a"))->bCanSend && SendTo(S, Ag("a"), "y", 3111));
			EXPECT(Unsupported, S.BeginDisconnect(Ag("u")).Method == "DELETE");
		}
		{
			// Only the server's word: a 4xx on connect is a connect failure, never an invented unsupported slot.
			FCompanionSession S(Origin, Project, true);
			EXPECT(Unsupported, ConnectAs(S, "zz", 404, KindBody("companion_provider_unknown")));
			EXPECT(Unsupported, S.AgentIds().empty() && S.SessionView().StatusLine == "Could not connect the agent");
		}
	}

	/* ------------------------------------------------------------ one agent never breaks another */
	void TestIsolation()
	{
		FCompanionSession S(Origin, Project, true);
		EXPECT(Isolation, ConnectAs(S, TestProvider, 201, Descriptor(Ag("a"), TestProvider)));
		EXPECT(Isolation, ConnectAs(S, OtherProvider, 201, Descriptor(Ag("b"), OtherProvider)));
		const auto AOk = [&S] { const FAgentView* A = S.View(Ag("a")); return A != nullptr && A->State == ECompanionState::Ready && A->bCanSend && !A->bShowSimulatedBanner; };
		// 409 not_connected on B disconnects B only.
		EXPECT(Isolation, SendTo(S, Ag("b"), "b1", 3210));
		S.ApplyChatHttpAnswer(Ag("b"), 409, "", KindBody("companion_not_connected"), 0);
		EXPECT(Isolation, S.View(Ag("b"))->Offline == EOfflineReason::NotConnected && AOk() && !S.SessionView().bShowSimulatedBanner);
		// A key rejection on B is B's alone.
		EXPECT(Isolation, ConnectAs(S, OtherProvider, 201, Descriptor(Ag("b"), OtherProvider)) && SendTo(S, Ag("b"), "b2", 3212));
		S.FeedChatBytes(Ag("b"), MetaFor(OtherProvider) + Err("provider_auth_failed", "bad"), 0);
		EXPECT(Isolation, S.View(Ag("b"))->Offline == EOfflineReason::KeyRejected && AOk());
		// A malformed slot for B in a later list: B fails closed, A untouched, B keeps its identity.
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("a"), TestProvider) + "," + Descriptor(Ag("b"), OtherProvider, "connected", DeclaredDefault, "[\"nope\"]") + "]"));
		EXPECT(Isolation, S.View(Ag("b"))->bMalformed && S.View(Ag("b"))->State == ECompanionState::Error && S.View(Ag("b"))->StatusLine == "Agent details could not be read");
		EXPECT(Isolation, S.ProviderIdOf(Ag("b")) == OtherProvider && AOk() && S.AgentIds().size() == 2 && S.SessionView().UnreadableSlots == 0);
		// An anonymous bad slot touches nobody.
		S.ApplyAgentSlots(Slots("[{\"agentId\":\"\"}]"));
		EXPECT(Isolation, AOk() && S.View(Ag("b"))->bMalformed && S.SessionView().UnreadableSlots == 1);
		// Connection error on B, then B disconnected: A still fine; B's DELETE names B.
		EXPECT(Isolation, ConnectAs(S, OtherProvider, 201, Descriptor(Ag("b"), OtherProvider)) && !S.View(Ag("b"))->bMalformed && S.View(Ag("b"))->bCanSend);
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("b"), OtherProvider, "error") + "]"));
		EXPECT(Isolation, S.View(Ag("b"))->StatusLine == "Connection error; reconnect your agent" && AOk());
		const FRelayRequest D = S.BeginDisconnect(Ag("b"));
		EXPECT(Isolation, D.Url == Origin + "/relay-api/wonderland/companions/agents/" + Ag("b") + PQ);
		S.ApplyDisconnectAnswer(Ag("b"), 200, Gone(Ag("b"), OtherProvider));
		EXPECT(Isolation, S.View(Ag("b"))->Offline == EOfflineReason::NotConnected && AOk());
		// A's rate limit or history delete never blocks or clears B, and the reverse.
		EXPECT(Isolation, ConnectAs(S, OtherProvider, 201, Descriptor(Ag("b"), OtherProvider)));
		EXPECT(Isolation, SendTo(S, Ag("b"), "b3", 3215, 1000));
		S.FeedChatBytes(Ag("b"), MetaFor(OtherProvider) + Delta("kept") + Done(), 1000);
		EXPECT(Isolation, SendTo(S, Ag("a"), "a1", 3216, 1000));
		S.ApplyChatHttpAnswer(Ag("a"), 429, "30", KindBody("companion_rate_limited"), 1000);
		EXPECT(Isolation, S.View(Ag("a"))->State == ECompanionState::SlowDown && SendTo(S, Ag("b"), "b4", 3217, 1001));
		S.ApplyChatTransportFailure(Ag("b"), 1001);
		const FRelayRequest H = S.BeginDeleteHistory(Ag("a"));
		EXPECT(Isolation, H.Method.empty() && S.History(Ag("b"))->Size() == 1);
		// Identity: the same agentId later claiming another provider is refused for that agent only, never shown as it.
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("b"), "impostor") + "]"));
		EXPECT(Isolation, S.View(Ag("b"))->State == ECompanionState::Error && S.View(Ag("b"))->StatusLine == "Agent identity changed; this agent is not used");
		EXPECT(Isolation, !S.View(Ag("b"))->bCanSend && !S.View(Ag("b"))->bCanConnect && S.ProviderIdOf(Ag("b")) == OtherProvider && TraceHas(S, "agent_identity_changed"));
		EXPECT(Isolation, S.View(Ag("a"))->State == ECompanionState::SlowDown && !S.View(Ag("a"))->bMalformed);
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("b"), OtherProvider) + "]"));
		EXPECT(Isolation, S.View(Ag("b"))->State == ECompanionState::Error && !S.View(Ag("b"))->bCanSend); // sticky
		EXPECT(Isolation, ConnectAs(S, "impostor", 201, Descriptor(Ag("b"), "impostor")) && S.SessionView().StatusLine == "Could not connect the agent");
	}

	/* ------------------------------------------------------------ authorized vs declared; nothing inferred */
	void TestCaps()
	{
		FCompanionSession S(Origin, Project, true);
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("a"), TestProvider, "connected", "[\"chat\",\"history\",\"tools.run\"]", "[\"chat\",\"history\"]") + "]"));
		EXPECT(Caps, S.View(Ag("a"))->AuthorizedCapabilities == std::vector<std::string>({"chat", "history"}) && S.View(Ag("a"))->bCanSend);
		EXPECT(Caps, !Contains(Everything(S), "tools.run")); // declared-only is never shown
		// Declared chat without authorized chat: no sending, and nothing claims it is authorized.
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("b"), TestProvider, "connected", "[\"chat\",\"history\"]", "[\"history\"]") + "]"));
		const FAgentView* B = S.View(Ag("b"));
		EXPECT(Caps, B->State == ECompanionState::Offline && B->Offline == EOfflineReason::NotAuthorized && B->StatusLine == "This agent has not authorized chat");
		EXPECT(Caps, !B->bCanSend && B->bCanConnect && B->AuthorizedCapabilities == std::vector<std::string>({"history"}) && !SendTo(S, Ag("b"), "x", 3300));
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("c"), TestProvider, "connected", "[\"chat\"]", "[]") + "]"));
		EXPECT(Caps, S.View(Ag("c"))->Offline == EOfflineReason::NotAuthorized && S.View(Ag("c"))->AuthorizedCapabilities.empty());
		// No normalisation and no inference from kind, name or provider.
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("d"), TestProvider, "connected", "[\"Chat\"]", "[\"Chat\"]") + "]"));
		EXPECT(Caps, S.View(Ag("d"))->Offline == EOfflineReason::NotAuthorized);
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("e"), TestProvider, "connected", "[\"chat.v2\"]", "[\"chat.v2\"]", "", "Chat Agent", "compound") + "]"));
		EXPECT(Caps, S.View(Ag("e"))->Offline == EOfflineReason::NotAuthorized && !S.View(Ag("e"))->bCanSend);
		// Capabilities show only while really connected.
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("f"), TestProvider, "disconnected") + "," + Descriptor(Ag("g"), TestProvider, "error") + "]"));
		EXPECT(Caps, S.View(Ag("f"))->AuthorizedCapabilities.empty() && S.View(Ag("g"))->AuthorizedCapabilities.empty());
		EXPECT(Caps, SendTo(S, Ag("a"), "q", 3301));
		S.FeedChatBytes(Ag("a"), Meta() + Err("provider_auth_failed", "bad"), 0);
		EXPECT(Caps, S.View(Ag("a"))->Offline == EOfflineReason::KeyRejected && S.View(Ag("a"))->AuthorizedCapabilities.empty());
		// A later descriptor narrowing the authorization takes effect at once.
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("h"), TestProvider) + "]"));
		EXPECT(Caps, S.View(Ag("h"))->bCanSend);
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("h"), TestProvider, "connected", DeclaredDefault, "[]") + "]"));
		EXPECT(Caps, !S.View(Ag("h"))->bCanSend && S.View(Ag("h"))->Offline == EOfflineReason::NotAuthorized);
		EXPECT(Caps, CapabilityChat == std::string_view("chat") && HasCapability({"a", "chat"}, "chat") && !HasCapability({"chats"}, "chat"));
	}

	/* ------------------------------------------------------------ verified stays false */
	void TestVerified()
	{
		EXPECT(Verified, !bAgentVerificationAvailable);
		// No AgentDescriptor carries "verified" (registry.ts:28-37): any such key is refused, whatever its value.
		for (const char* Claim : {",\"verified\":true", ",\"verified\":false", ",\"verified\":\"yes\""})
		{
			EXPECT(Verified, SlotOf(Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, Claim)).Fault == EAgentSlotFault::BadVerified);
		}
		FCompanionSession S(Origin, Project, true);
		EXPECT(Verified, ConnectAs(S, TestProvider, 201, Descriptor(Ag("a"), TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":true")));
		EXPECT(Verified, S.View(Ag("a")) == nullptr && S.SessionView().StatusLine == "Could not connect the agent");
		EXPECT(Verified, ConnectAs(S, TestProvider, 201, Descriptor(Ag("a"), TestProvider)) && S.View(Ag("a"))->State == ECompanionState::Ready && !S.View(Ag("a"))->bVerified);
		S.ApplyAgentSlots(Slots("[" + Descriptor(Ag("a"), TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":true") + "]"));
		EXPECT(Verified, S.View(Ag("a"))->bMalformed && !S.View(Ag("a"))->bVerified && !S.View(Ag("a"))->bCanSend);
		EXPECT(Verified, S.View(Ag("a"))->State == ECompanionState::Error && !Contains(S.View(Ag("a"))->StatusLine, "erified") && !Contains(S.SessionView().StatusLine, "erified"));
		EXPECT(Verified, SlotOf(Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"verified\":null")).Fault == EAgentSlotFault::BadVerified);
	}

	/* ------------------------------------------------------------ BRIDGE 7e5e1e30 as served: routes, project, chat */
	void TestBridge()
	{
		{
			// Only POST / GET / DELETE agents[/{agentId}] are served (route.ts:55-57); chat is not (contract:46,139).
			FCompanionSession S(Origin, Project);
			EXPECT(Bridge, S.SessionView().bProjectOk && S.SessionView().bCanConnect);
			EXPECT(Bridge, ConnectAs(S, TestProvider, 201, ConnectOk));
			const FAgentView* V = S.View(TestAgent);
			EXPECT(Bridge, V->State == ECompanionState::Offline && V->Offline == EOfflineReason::ChatNotServed);
			EXPECT(Bridge, V->StatusLine == "Chat with agents is not available on this relay yet" && !V->bCanSend && !V->bCanConnect);
			EXPECT(Bridge, !V->bShowSimulatedBanner); // the agent IS connected per the relay; only the chat route is missing
			EXPECT(Bridge, V->AuthorizedCapabilities == std::vector<std::string>({"chat"}) && V->Connection == EAgentConnection::Connected);
			FRelayRequest R;
			EXPECT(Bridge, !SendTo(S, TestAgent, "hi", 4000, 0, &R) && R.Method.empty() && S.BeginDeleteHistory(TestAgent).Method.empty());
			EXPECT(Bridge, !S.SessionView().bShowSimulatedBanner);
			// Not authorized still reads as not authorized first.
			S.ApplyAgentSlots(Slots("[" + Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, "[]") + "]"));
			EXPECT(Bridge, S.View(TestAgent)->Offline == EOfflineReason::NotAuthorized);
			// GET and DELETE are served and work without chat.
			EXPECT(Bridge, S.BeginReadAgent(TestAgent).Method == "GET" && S.BeginDisconnect(TestAgent).Method == "DELETE");
		}
		{
			// No paired project: nothing is sent and the HUD says why (admission-route.ts:288 requires projectId).
			for (const std::string& Bad : {std::string(), std::string("a b"), std::string("p/q"), std::string("p?x=1"), std::string(65, 'p')})
			{
				FCompanionSession S(Origin, Bad, true);
				FRelayRequest R;
				EXPECT(Bridge, !S.SessionView().bProjectOk && !S.SessionView().bCanConnect && S.SessionView().StatusLine == "Companion needs a paired project");
				EXPECT(Bridge, !S.BeginConnect(TestProvider, "", "", R) && R.Method.empty());
				S.ApplyAgentSlots(Slots("[" + ConnectOk + "]"));
				EXPECT(Bridge, S.View(TestAgent)->Offline == EOfflineReason::NoProject && !S.View(TestAgent)->bCanSend && !S.View(TestAgent)->bCanConnect);
				EXPECT(Bridge, S.BeginReadAgent(TestAgent).Method.empty() && S.BeginDisconnect(TestAgent).Method.empty() && !SendTo(S, TestAgent, "x", 4010));
			}
			FCompanionSession S(Origin, std::string(64, 'p'), true);
			FRelayRequest R;
			EXPECT(Bridge, S.SessionView().bProjectOk && S.BeginConnect(TestProvider, "", "", R) && R.Url == Origin + "/relay-api/wonderland/companions/agents?projectId=" + std::string(64, 'p'));
		}
		{
			// GET /agents/{agentId} (route.ts:325-337): 200 one descriptor for THAT agent; 404 not here.
			FCompanionSession S(Origin, Project, true);
			EXPECT(Bridge, ConnectAs(S, TestProvider, 201, ConnectOk));
			FRelayRequest G = S.BeginReadAgent(TestAgent);
			EXPECT(Bridge, G.Method == "GET" && G.Url == Origin + "/relay-api/wonderland/companions/agents/" + TestAgent + PQ && G.Body.empty() && G.IdempotencyKey.empty());
			EXPECT(Bridge, S.BeginReadAgent(Ag("nobody")).Method.empty());
			S.ApplyReadAgentAnswer(TestAgent, 200, Descriptor(TestAgent, TestProvider, "connected", DeclaredDefault, "[]"));
			EXPECT(Bridge, S.View(TestAgent)->Offline == EOfflineReason::NotAuthorized && !S.View(TestAgent)->bMalformed);
			S.ApplyReadAgentAnswer(TestAgent, 200, ConnectOk);
			EXPECT(Bridge, S.View(TestAgent)->State == ECompanionState::Ready);
			S.ApplyReadAgentAnswer(TestAgent, 503, "");
			S.ApplyReadAgentAnswer(TestAgent, 401, KindBody("sign_in_required"));
			EXPECT(Bridge, S.View(TestAgent)->State == ECompanionState::Ready && TraceHas(S, "agent_read_failed"));
			S.ApplyReadAgentAnswer(TestAgent, 200, Descriptor(Ag("other"), TestProvider)); // answered for another agent
			EXPECT(Bridge, S.View(TestAgent)->bMalformed && !S.View(TestAgent)->bCanSend && S.View(Ag("other")) == nullptr);
			EXPECT(Bridge, ConnectAs(S, TestProvider, 201, Descriptor(Ag("two"), TestProvider)));
			S.ApplyReadAgentAnswer(Ag("two"), 200, Descriptor(Ag("two"), TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"token\":\"t\""));
			EXPECT(Bridge, S.View(Ag("two"))->bMalformed);
			// route.ts:58,367-375: /^(apikey|token|password)$/i at any depth; the client refuses the same in every answer.
			for (const char* Extra : {",\"APIKEY\":\"x\"", ",\"Token\":1", ",\"PassWord\":null", ",\"meta\":{\"apiKey\":\"x\"}", ",\"meta\":[{\"ok\":1},{\"token\":\"t\"}]",
				",\"meta\":{\"inner\":{\"Last4\":\"1234\"}}", ",\"HINT\":\"x\""})
			{
				EXPECT(Bridge, ConnectAs(S, TestProvider, 201, Descriptor(Ag("cred"), TestProvider, "connected", DeclaredDefault, AuthorizedDefault, Extra)));
				EXPECT(Bridge, S.View(Ag("cred")) == nullptr && S.SessionView().StatusLine == "Could not connect the agent");
			}
			EXPECT(Bridge, ConnectAs(S, TestProvider, 201, Descriptor(Ag("cred"), TestProvider, "connected", DeclaredDefault, AuthorizedDefault, ",\"meta\":{\"tokens\":1,\"apiKeyId\":2}")));
			EXPECT(Bridge, S.View(Ag("cred")) != nullptr && S.View(Ag("cred"))->State == ECompanionState::Ready); // whole-name match only
			EXPECT(Bridge, ConnectAs(S, TestProvider, 201, Descriptor(Ag("three"), TestProvider)));
			S.ApplyReadAgentAnswer(Ag("three"), 404, KindBody("not_found"));
			EXPECT(Bridge, S.View(Ag("three"))->Offline == EOfflineReason::NotConnected && S.View(Ag("three"))->AuthorizedCapabilities.empty() && TraceHas(S, "agent_read_not_found"));
			S.ApplyReadAgentAnswer(Ag("nobody"), 200, ConnectOk);
			EXPECT(Bridge, TraceHas(S, "agent_read_unexpected") && S.View(Ag("nobody")) == nullptr);
		}
		{
			// DELETE (route.ts:339-351): 200 + the descriptor, disconnected for good; 404 unknown; else nothing changes.
			FCompanionSession S(Origin, Project, true);
			for (const char* Tag : {"d1", "d2", "d3", "d4", "d5", "d6"}) { EXPECT(Bridge, ConnectAs(S, TestProvider, 201, Descriptor(Ag(Tag), TestProvider))); }
			S.ApplyDisconnectAnswer(Ag("d1"), 200, Gone(Ag("d1")));
			EXPECT(Bridge, S.View(Ag("d1"))->Offline == EOfflineReason::NotConnected && TraceHas(S, "disconnect_ok"));
			S.ApplyDisconnectAnswer(Ag("d2"), 200, Descriptor(Ag("d2"), TestProvider)); // odd: "connected" in a DELETE answer
			EXPECT(Bridge, S.View(Ag("d2"))->Offline == EOfflineReason::NotConnected && !S.View(Ag("d2"))->bCanSend && TraceHas(S, "disconnect_answer_refused"));
			S.ApplyDisconnectAnswer(Ag("d3"), 200, "not json");
			EXPECT(Bridge, S.View(Ag("d3"))->Offline == EOfflineReason::NotConnected && !S.View(Ag("d3"))->bCanSend);
			S.ApplyDisconnectAnswer(Ag("d4"), 404, KindBody("not_found"));
			EXPECT(Bridge, S.View(Ag("d4"))->Offline == EOfflineReason::NotConnected && TraceHas(S, "disconnect_not_found"));
			for (int Code : {204, 202, 401, 403, 405, 500, 503, 0})
			{
				S.ApplyDisconnectAnswer(Ag("d5"), Code, Gone(Ag("d5")));
				EXPECT(Bridge, S.View(Ag("d5"))->State == ECompanionState::Ready && S.View(Ag("d5"))->bCanSend);
			}
			EXPECT(Bridge, TraceHas(S, "disconnect_failed"));
			S.ApplyDisconnectAnswer(Ag("d6"), 200, Gone(Ag("other")));
			EXPECT(Bridge, S.View(Ag("d6"))->Offline == EOfflineReason::NotConnected && S.View(Ag("other")) == nullptr);
			// The server keeps a deleted slot disconnected (registry.ts:272-283); the client reads what it publishes.
			S.ApplyAgentSlots(Slots("[" + Gone(Ag("d1")) + "]"));
			EXPECT(Bridge, S.View(Ag("d1"))->Offline == EOfflineReason::NotConnected);
		}
	}
}

int main()
{
	TestJson();
	TestSse();
	TestChat();
	TestKey();
	TestSession();
	TestStatus();
	TestPin();
	TestHistory();
	TestResult();
	TestRoute();
	TestAnswers();
	TestMint();
	TestAgents();
	TestMulti();
	TestUnsupported();
	TestIsolation();
	TestCaps();
	TestVerified();
	TestBridge();
	TestTrace();
	if (Failures != 0)
	{
		std::printf("J1 COMPANION KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::string Line = "J1 COMPANION KAT PASS";
	for (int I = 0; I < SectionCount; ++I) { Line += std::string(" ") + SectionNames[I] + "=" + std::to_string(Checks[I]); }
	std::printf("%s\n", Line.c_str());
	return 0;
}

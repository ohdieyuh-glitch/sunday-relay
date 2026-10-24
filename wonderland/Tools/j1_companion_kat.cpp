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
	int Checks[16] = {};
	enum ESection { Json, Sse, Chat, Session, Key, Status, Pin, History, Result, Route, Answers, Mint, SectionCount };
	const char* SectionNames[SectionCount] = {"json", "sse", "chat", "session", "key", "status", "pin", "history", "result", "route", "answers", "mint"};

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

	std::string Meta(const std::string& ConvId = Conv, const std::string& Extra = "", const std::string& MsgId = Msg1)
	{
		return Ev("meta", "{\"conversationId\":\"" + ConvId + "\",\"messageId\":\"" + MsgId + "\",\"provider\":\"openai\",\"mode\":\"api_key\",\"model\":\"srv-model-x\"" + Extra + "}");
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
		FChatStreamDecoder D(Expected, bReplay, ExpectedMsg);
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
			FChatStreamDecoder D("", false);
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
			FChatStreamDecoder D("", false);
			D.Feed(Meta() + Delta("partial") + Err("provider_rate_limited", "slow", ",\"retryAfterMs\":2500"));
			EXPECT(Chat, D.Outcome() == EChatStreamOutcome::ProviderError && D.ErrorKind() == EChatErrorKind::ProviderRateLimited);
			EXPECT(Chat, D.HasRetryAfter() && D.RetryAfterMs() == 2500 && D.ReplyForDisplay().empty());
		}
		{
			FChatStreamDecoder D("", false);
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
			FChatStreamDecoder D("", false);
			D.Feed(Stream + Done());
			EXPECT(Chat, D.Outcome() == EChatStreamOutcome::Done && D.ReplyBytes() == ChatMaxReplyBytes);
			FChatStreamDecoder E("", false);
			E.Feed(Stream + Delta("r") + Done());
			EXPECT(Chat, E.Fault() == EChatProtocolFault::ReplyTooLarge && E.ReplyBytes() == 0);
		}
		EXPECT(Chat, RunChat(Meta() + "data: " + std::string(SseMaxLineBytes, 'x') + "\n\n").Fault == EChatProtocolFault::SseLineTooLong);
		EXPECT(Chat, IsConversationId(Conv) && !IsConversationId(Wlj) && !IsConversationId("cnv_"));
		EXPECT(Chat, std::strcmp(ChatProtocolFaultName(EChatProtocolFault::Truncated), "truncated") == 0);
	}

	/* ------------------------------------------------------------ session helpers */
	const std::string OddLabel = "Lbl-From-Server \xE2\x9C\x93 #7";
	// Q10: labels per mode; the deprecated "label" carries a decoy so a client that still reads it is caught.
	std::string Providers(const std::string& ApiKeyAvail = "available", const std::string& Label = OddLabel)
	{
		return "{\"providers\":[{\"provider\":\"openai\",\"label\":\"DEPRECATED-LABEL\",\"labels\":{\"api_key\":\"" + Label
			+ "\",\"siwc_plan\":\"Plan label P\"},\"modes\":[\"api_key\",\"siwc_plan\"],"
			"\"modeAvailability\":{\"api_key\":\"" + ApiKeyAvail + "\",\"siwc_plan\":\"not_eligible\"}},"
			"{\"provider\":\"grok_bot\",\"label\":\"Bot label B\",\"labels\":{\"agent_webhook\":\"Bot label B\"},\"modes\":[\"agent_webhook\"],"
			"\"modeAvailability\":{\"agent_webhook\":\"available\"}}]}";
	}
	std::string Connections(const std::string& State, const std::string& LastError = "null")
	{
		return "{\"connections\":[{\"provider\":\"openai\",\"mode\":\"api_key\",\"state\":\"" + State + "\",\"connectedAt\":null,\"verifiedAt\":null,\"lastErrorKind\":" + LastError + "}]}";
	}
	// Q14: 200 {provider, mode, state, connectedAt, verifiedAt}; "connected" carries a verifiedAt instant.
	const std::string ConnectOk = "{\"provider\":\"openai\",\"mode\":\"api_key\",\"state\":\"connected\",\"connectedAt\":\"2026-10-23T22:00:00Z\",\"verifiedAt\":\"2026-10-23T22:00:01.250Z\"}";
	const std::string ConnectUnverified = "{\"provider\":\"openai\",\"mode\":\"api_key\",\"state\":\"connected_unverified\",\"connectedAt\":\"2026-10-23T22:00:00Z\",\"verifiedAt\":null}";
	const std::string Sentinel = "sk-SENTINEL-9f8e7d-KEYMATERIAL";

	std::string Everything(const FOpenAiCompanionSession& S)
	{
		std::string All;
		for (const std::string& L : S.Trace()) { All += L + "\n"; }
		const FCompanionView& V = S.View();
		All += V.ProviderLabel + V.StatusLine + V.RefusalText + V.PartialReply + S.ConversationId();
		for (std::size_t I = 0; I < S.History().Size(); ++I)
		{
			const FTurn& T = S.History().At(I);
			All += T.PlayerText + T.ReplyText + T.MessageId + T.Model + T.FinishReason;
		}
		return All;
	}

	// A session that reached Ready with the sentinel key. Returns false if any step misbehaved.
	bool MakeReady(FOpenAiCompanionSession& S, int KeyBase = 900)
	{
		S.ApplyProvidersAnswer(200, Providers());
		S.ApplyConnectionsAnswer(200, Connections("not_connected"));
		FMaskedKeyField F;
		F.Append(Sentinel);
		FKeyHandoff H;
		if (!S.BeginConnect(F, Idem(KeyBase), H)) { return false; }
		H.MarkSent();
		S.ApplyConnectAnswer(200, ConnectOk, 0);
		return S.View().State == ECompanionState::Ready;
	}

	bool Send(FOpenAiCompanionSession& S, const std::string& Msg, int K, std::uint64_t Now = 0, const std::string& Run = "", FRelayRequest* Out = nullptr)
	{
		FRelayRequest R;
		const bool bOk = S.BeginMessage(Msg, Idem(K), Run, Now, R);
		if (Out != nullptr) { *Out = R; }
		return bOk;
	}

	/* ------------------------------------------------------------ key handling */
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
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers());
			S.ApplyConnectionsAnswer(200, Connections("not_connected"));
			FMaskedKeyField F;
			F.Append("  " + Sentinel + "\n");
			FKeyHandoff H;
			EXPECT(Key, S.BeginConnect(F, Idem(1), H) && H.IsValid());
			EXPECT(Key, F.IsEmpty() && F.MaskText().empty());
			EXPECT(Key, H.Method() == "PUT" && H.TargetUrl() == Origin + "/relay-api/wonderland/companions/connections/openai");
			EXPECT(Key, H.IdempotencyKey() == Idem(1));
			EXPECT(Key, H.Body() == "{\"mode\":\"api_key\",\"apiKey\":\"" + Sentinel + "\"}");
			EXPECT(Key, S.View().State == ECompanionState::Connecting);
			FKeyHandoff Moved(std::move(H));
			EXPECT(Key, H.Body().empty() && Contains(std::string(Moved.Body()), Sentinel));
			Moved.MarkSent();
			EXPECT(Key, Moved.Body().empty());
			S.ApplyConnectAnswer(200, ConnectOk, 0);
			EXPECT(Key, S.View().State == ECompanionState::Ready && !S.View().bShowSimulatedBanner);
			FRelayRequest R;
			EXPECT(Key, S.BeginMessage("hi", Idem(2), "", 0, R) && !Contains(R.Body, Sentinel) && !Contains(R.Body, "apiKey"));
			S.FeedChatBytes(Meta() + Delta("ok") + Done(), 0);
			EXPECT(Key, !Contains(Everything(S), Sentinel) && !Contains(Everything(S), "SENTINEL"));
		}
		{
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers());
			FMaskedKeyField F;
			F.Append("sk-has space");
			FKeyHandoff H;
			EXPECT(Key, !S.BeginConnect(F, Idem(3), H) && F.IsEmpty() && !H.IsValid());
			F.Append("sk-\"quote\\");
			EXPECT(Key, S.BeginConnect(F, Idem(4), H) && H.Body() == "{\"mode\":\"api_key\",\"apiKey\":\"sk-\\\"quote\\\\\"}");
			FJsonValue V;
			EXPECT(Key, ParseJson(H.Body(), V) && V.Find("apiKey")->Text == "sk-\"quote\\");
			// Otherwise a valid Q14 body, so only the last4 echo refuses it.
			S.ApplyConnectAnswer(200, "{\"provider\":\"openai\",\"mode\":\"api_key\",\"state\":\"connected\",\"connectedAt\":\"2026-10-23T22:00:00Z\",\"verifiedAt\":\"2026-10-23T22:00:01Z\",\"last4\":\"uote\"}", 0);
			EXPECT(Key, S.View().State == ECompanionState::Offline && S.View().StatusLine == "Could not connect the key");
			F.Append("sk-x");
			EXPECT(Key, !S.BeginConnect(F, Idem(4), H)); // idempotency key reused
			F.Append(std::string(ApiKeyMaxBytes + 1, 'k'));
			EXPECT(Key, !S.BeginConnect(F, Idem(5), H) && F.IsEmpty());
			F.Append("sk-y");
			EXPECT(Key, !S.BeginConnect(F, "not-a-uuid", H) && F.IsEmpty());
			F.Append("   ");
			EXPECT(Key, !S.BeginConnect(F, Idem(6), H));
			F.Append("sk-\xC3\xA9");
			EXPECT(Key, !S.BeginConnect(F, Idem(7), H));
		}
		{
			FOpenAiCompanionSession S("http://localhost:47123");
			S.ApplyProvidersAnswer(200, Providers());
			FMaskedKeyField F;
			F.Append(Sentinel);
			FKeyHandoff H;
			EXPECT(Key, !S.BeginConnect(F, Idem(8), H) && F.IsEmpty() && !H.IsValid());
			EXPECT(Key, S.View().Offline == EOfflineReason::RelayNotLoopback && S.ProvidersRequest().Method.empty());
		}
		{
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers("not_eligible"));
			FMaskedKeyField F;
			F.Append(Sentinel);
			FKeyHandoff H;
			EXPECT(Key, !S.BeginConnect(F, Idem(9), H) && F.IsEmpty());
		}
	}

	/* ------------------------------------------------------------ session */
	void TestSession()
	{
		{
			FOpenAiCompanionSession S(Origin);
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.View().Offline == EOfflineReason::ProvidersUnknown);
			EXPECT(Session, S.View().bShowSimulatedBanner && !S.View().bCanSend && !S.View().bCanConnect && S.View().ProviderLabel.empty());
			EXPECT(Session, S.ProvidersRequest().Url == Origin + "/relay-api/wonderland/companions/providers");
			EXPECT(Session, S.ConnectionsRequest().Url == Origin + "/relay-api/wonderland/companions/connections");
			FRelayRequest R;
			EXPECT(Session, !S.BeginMessage("hi", Idem(1), "", 0, R) && R.Method.empty());
			S.ApplyProvidersAnswer(200, Providers());
			EXPECT(Session, S.View().ProviderLabel == OddLabel && S.LabelFor("grok_bot", "agent_webhook") == "Bot label B");
			EXPECT(Session, S.View().Offline == EOfflineReason::NotConnected && S.View().StatusLine == "Connect your OpenAI key");
			S.ApplyConnectionsAnswer(200, Connections("not_connected"));
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.View().bCanConnect && !S.View().bCanSend && S.View().bShowSimulatedBanner);
			S.ApplyConnectionsAnswer(200, Connections("connected_unverified"));
			EXPECT(Session, S.View().State == ECompanionState::Ready && S.View().bCanSend && !S.View().bShowSimulatedBanner);
			S.ApplyConnectionsAnswer(200, Connections("revoked"));
			EXPECT(Session, S.View().Offline == EOfflineReason::Revoked && S.View().bShowSimulatedBanner && !S.View().bCanSend);
			S.ApplyConnectionsAnswer(200, Connections("telepathic"));
			EXPECT(Session, S.View().State == ECompanionState::Error && !S.View().bCanSend);
			S.ApplyConnectionsAnswer(500, "{}");
			EXPECT(Session, S.View().State == ECompanionState::Offline && !S.View().bCanSend);
			S.ApplyConnectionsAnswer(200, "{\"connections\":[]}");
			EXPECT(Session, S.View().Offline == EOfflineReason::NotConnected);
			S.ApplyProvidersAnswer(200, Providers("available", "bad\\u202elabel"));
			EXPECT(Session, S.View().Offline == EOfflineReason::ProvidersUnknown && S.View().ProviderLabel.empty());
			S.ApplyProvidersAnswer(200, "{\"providers\":[{\"provider\":\"grok_bot\",\"label\":\"B\",\"modeAvailability\":{}}]}");
			EXPECT(Session, S.View().Offline == EOfflineReason::ProvidersUnknown);
			S.ApplyProvidersAnswer(200, Providers("not_in_v0"));
			EXPECT(Session, S.View().Offline == EOfflineReason::ModeUnavailable && !S.View().bCanConnect);
		}
		{
			// The label is the server's, verbatim, whatever it says.
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers("available", "ChatGPT via your OpenAI key"));
			EXPECT(Session, S.View().ProviderLabel == "ChatGPT via your OpenAI key");
			S.ApplyProvidersAnswer(200, Providers("available", "zzz"));
			EXPECT(Session, S.View().ProviderLabel == "zzz");
		}
		{
			FOpenAiCompanionSession S(Origin);
			EXPECT(Session, MakeReady(S));
			FRelayRequest R;
			EXPECT(Session, Send(S, "Hello there", 10, 0, Wlj, &R));
			EXPECT(Session, R.Method == "POST" && R.Url == Origin + "/relay-api/wonderland/companions/openai/chat" && R.IdempotencyKey == Idem(10));
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
				{Err("provider_quota_exhausted", "pay"), ECompanionState::OutOfCredit, "Your OpenAI account is out of credit", false},
				{Err("provider_rate_limited", "wait", ",\"retryAfterMs\":5000"), ECompanionState::RetryLater, "Retry later", false},
				{Err("provider_unavailable", "down"), ECompanionState::RetryLater, "Retry later", false},
				{Err("provider_refused", "I can't help with that."), ECompanionState::Refused, "The provider refused this message", false},
				{Err("companion_internal", "x"), ECompanionState::Error, "Companion error", false},
			};
			int K = 100;
			for (const FRow& Row : Rows)
			{
				FOpenAiCompanionSession S(Origin);
				EXPECT(Session, MakeReady(S, K++));
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
					S.ApplyConnectionsAnswer(200, Connections("connected"));
					EXPECT(Session, S.View().State == ECompanionState::Offline);
					FMaskedKeyField F;
					F.Append("sk-new");
					FKeyHandoff H;
					EXPECT(Session, S.BeginConnect(F, Idem(K++), H));
					S.ApplyConnectAnswer(200, ConnectOk, 0);
					EXPECT(Session, S.View().State == ECompanionState::Ready);
				}
				if (Row.Stream.find("retryAfterMs") != std::string::npos)
				{
					EXPECT(Session, S.View().RetryNotBeforeMs == 6000 && !Send(S, "early", K++, 5999) && Send(S, "ok", K++, 6000));
				}
			}
		}
		{
			FOpenAiCompanionSession S(Origin);
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
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.View().StatusLine == "Connect your OpenAI key" && S.View().bShowSimulatedBanner);
		}
		{
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers());
			FMaskedKeyField F;
			F.Append("sk-z");
			FKeyHandoff H;
			EXPECT(Session, S.BeginConnect(F, Idem(40), H));
			S.ApplyConnectAnswer(403, "{\"error\":{\"kind\":\"companion_mode_not_eligible\",\"message\":\"x\"}}", 0);
			EXPECT(Session, S.View().Offline == EOfflineReason::ModeUnavailable);
			S.ApplyProvidersAnswer(200, Providers());
			F.Append("sk-z");
			EXPECT(Session, S.BeginConnect(F, Idem(41), H));
			S.ApplyConnectAnswer(429, "{}", 0);
			EXPECT(Session, S.View().StatusLine == "Slow down" && S.View().State == ECompanionState::Offline);
			F.Append("sk-z");
			EXPECT(Session, S.BeginConnect(F, Idem(42), H));
			S.ApplyConnectAnswer(200, "{\"provider\":\"openai\",\"mode\":\"api_key\",\"state\":\"invalid\"}", 0);
			EXPECT(Session, S.View().State == ECompanionState::Offline);
			S.ApplyConnectionsAnswer(200, Connections("connected"));
			EXPECT(Session, S.View().State == ECompanionState::Ready);
			const FRelayRequest D = S.BeginDisconnect();
			EXPECT(Session, D.Method == "DELETE" && D.Url == Origin + "/relay-api/wonderland/companions/connections/openai");
			S.ApplyDisconnectAnswer(204);
			EXPECT(Session, S.View().State == ECompanionState::Offline && S.View().bShowSimulatedBanner);
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
			FOpenAiCompanionSession S(Origin);
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
			EXPECT(History, D.Method == "DELETE" && D.Url == Origin + "/relay-api/wonderland/companions/openai/conversations/" + Conv);
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

	/* ------------------------------------------------------------ Grok Bot result and provenance */
	std::string ResultBody(const std::string& Content, const std::string& Run = Wlj, const std::string& Summary = "did it",
		const std::string& Kind = "patch", const std::string& Schema = "wonderland.companion_result.v0")
	{
		return "{\"schema\":\"" + Schema + "\",\"taskId\":\"cmp_" + U3 + "\",\"wljRunId\":\"" + Run + "\",\"summary\":\"" + Summary
			+ "\",\"artifact\":{\"kind\":\"" + Kind + "\",\"content\":\"" + Content + "\"},\"agent\":{\"selfReportedName\":\"Grok Bot (self)\",\"selfReportedRunUrl\":null}}";
	}

	void TestResult()
	{
		FCompanionResultView V;
		EXPECT(Result, ParseCompanionResultV0(ResultBody("diff --git a b"), Wlj, V) == EResultParse::Ok);
		EXPECT(Result, V.bUntrusted && V.ArtifactKind == EArtifactKind::Patch && V.SelfReportedName == "Grok Bot (self)" && V.TaskId == "cmp_" + U3);
		const std::size_t Overhead = ResultBody("").size();
		const std::string Exact = ResultBody(std::string(CompanionResultMaxBytes - Overhead, 'c'));
		EXPECT(Result, Exact.size() == CompanionResultMaxBytes && ParseCompanionResultV0(Exact, Wlj, V) == EResultParse::Ok);
		const std::string Over = ResultBody(std::string(CompanionResultMaxBytes - Overhead + 1, 'c'));
		EXPECT(Result, ParseCompanionResultV0(Over, Wlj, V) == EResultParse::TooLarge && V.ArtifactContent.empty());
		EXPECT(Result, ParseCompanionResultV0(std::string(CompanionResultMaxBytes + 1, '{'), Wlj, V) == EResultParse::TooLarge);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("x", OtherWlj), Wlj, V) == EResultParse::RunIdMismatch);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("x", Legacy), Wlj, V) == EResultParse::RunIdMismatch);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("x"), "WLJ_" + U1, V) == EResultParse::RunIdMismatch);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("x", Wlj, std::string(CompanionSummaryMaxBytes, 's')), Wlj, V) == EResultParse::Ok);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("x", Wlj, std::string(CompanionSummaryMaxBytes + 1, 's')), Wlj, V) == EResultParse::BadSummary);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("x", Wlj, "s", "exe"), Wlj, V) == EResultParse::BadArtifact);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("x", Wlj, "s", "text", "wonderland.companion_result.v1"), Wlj, V) == EResultParse::BadSchema);
		std::string BadTask = ResultBody("x");
		BadTask.replace(BadTask.find("cmp_"), 4, "tsk_");
		EXPECT(Result, ParseCompanionResultV0(BadTask, Wlj, V) == EResultParse::BadTaskId);
		EXPECT(Result, ParseCompanionResultV0(ResultBody("rm -rf \\u202e/\\u0007"), Wlj, V) == EResultParse::Ok && V.ArtifactContent == "rm -rf /");

		FCompanionProvenanceView P;
		const std::string Real = "{\"source\":\"grok_bot\",\"connectionMode\":\"agent_webhook\",\"simulated\":false,\"resultSha256\":\""
			+ std::string(64, 'a') + "\",\"verifiedBy\":\"task_token_round_trip\",\"selfReported\":{\"name\":\"Bot\",\"runUrl\":null}}";
		EXPECT(Result, ParseCompanionProvenanceV0(Real, P) == EProvenanceParse::Ok && !P.bSimulated && P.bVerifiedByTokenRoundTrip && P.SelfReportedName == "Bot");
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"simulated\",\"simulated\":true}", P) == EProvenanceParse::Ok && P.bSimulated && !P.bVerifiedByTokenRoundTrip);
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"simulated\",\"simulated\":true,\"verifiedBy\":\"task_token_round_trip\"}", P) == EProvenanceParse::SimulatedVerified && P.bSimulated);
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"grok_bot\",\"simulated\":true}", P) == EProvenanceParse::SimulatedInconsistent);
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"simulated\",\"simulated\":false}", P) == EProvenanceParse::SimulatedInconsistent);
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"grok_bot\"}", P) == EProvenanceParse::BadFields && P.bSimulated);
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"openai\",\"simulated\":false}", P) == EProvenanceParse::BadSource);
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"grok_bot\",\"simulated\":false,\"verifiedBy\":\"vibes\"}", P) == EProvenanceParse::BadFields);
		EXPECT(Result, ParseCompanionProvenanceV0("{\"source\":\"grok_bot\",\"simulated\":false}", P) == EProvenanceParse::Ok && !P.bVerifiedByTokenRoundTrip);
		EXPECT(Result, IsCompanionTaskId("cmp_" + U3) && !IsCompanionTaskId("cmp_" + U3 + " "));
		EXPECT(Result, std::strcmp(ResultParseName(EResultParse::RunIdMismatch), "run_id_mismatch") == 0);
	}

	/* ------------------------------------------------------------ Grok Bot result read route (contract v0.1 3.7) */
	const std::string RealProvenance = "{\"source\":\"grok_bot\",\"connectionMode\":\"agent_webhook\",\"simulated\":false,\"resultSha256\":\""
		+ std::string(64, 'a') + "\",\"verifiedBy\":\"task_token_round_trip\",\"selfReported\":{\"name\":\"Bot\",\"runUrl\":null}}";
	const std::string ArtifactOk = "{\"kind\":\"patch\",\"sha256\":\"" + std::string(64, 'b') + "\",\"byteLength\":1234}";

	std::string CompanionResult(const std::string& Summary = "did it", const std::string& Artifact = ArtifactOk, const std::string& Untrusted = "true")
	{
		return "{\"untrusted\":" + Untrusted + ",\"summary\":\"" + Summary + "\",\"artifact\":" + Artifact + "}";
	}
	std::string MissionBody(const std::string& State, const std::string& Result = "null", const std::string& Provenance = "null",
		const std::string& Run = Wlj, const std::string& Task = "\"cmp_" + U3 + "\"")
	{
		return "{\"wljRunId\":\"" + Run + "\",\"taskId\":" + Task + ",\"companion\":{\"state\":\"" + State + "\"},\"result\":" + Result
			+ ",\"provenance\":" + Provenance + ",\"updatedAt\":\"" + T0 + "\"}";
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
		// A real, verified result.
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), RealProvenance), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, V.bHasResult && V.Summary == "did it" && V.ArtifactKind == EArtifactKind::Patch && V.ArtifactSha256 == std::string(64, 'b'));
		EXPECT(Route, V.ArtifactByteLength == 1234 && V.bHasProvenance && V.bShowVerified && V.Provenance.SelfReportedName == "Bot");
		EXPECT(Route, ParseCompanionMission(200, MissionBody("integrated", CompanionResult(), RealProvenance), Wlj, V) == ECompanionMissionParse::Ok && V.bShowVerified);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("rejected", CompanionResult(), RealProvenance), Wlj, V) == ECompanionMissionParse::Ok);
		// Never "verified" without the round trip, or when simulated.
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), "{\"source\":\"grok_bot\",\"simulated\":false}"), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, V.bHasProvenance && !V.bShowVerified);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), "{\"source\":\"simulated\",\"simulated\":true}"), Wlj, V) == ECompanionMissionParse::Ok);
		EXPECT(Route, V.Provenance.bSimulated && !V.bShowVerified);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), "{\"source\":\"simulated\",\"simulated\":true,\"verifiedBy\":\"task_token_round_trip\"}"), Wlj, V) == ECompanionMissionParse::BadProvenance);
		EXPECT(Route, !V.bHasAnswer && !V.bShowVerified);
		EXPECT(Route, ParseCompanionMission(200, MissionBody("result_received", CompanionResult(), "\"verified\""), Wlj, V) == ECompanionMissionParse::BadProvenance);
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

	bool TraceHas(const FOpenAiCompanionSession& S, const std::string& Word)
	{
		for (const std::string& L : S.Trace())
		{
			if (L == Word) { return true; }
		}
		return false;
	}

	bool ConnectWith(FOpenAiCompanionSession& S, int K, int Status, const std::string& Body)
	{
		FMaskedKeyField F;
		F.Append(Sentinel);
		FKeyHandoff H;
		if (!S.BeginConnect(F, Idem(K), H)) { return false; }
		H.MarkSent();
		S.ApplyConnectAnswer(Status, Body, 0);
		return true;
	}

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
			FOpenAiCompanionSession S(Origin);
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
			FOpenAiCompanionSession S(Origin);
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
			FChatStreamDecoder D(Conv, true, Msg1);
			D.Feed(Replayed() + Delta("whole reply") + Done());
			D.Finish();
			EXPECT(Answers, D.IsReplayed() && D.Outcome() == EChatStreamOutcome::Done && D.ReplyForDisplay() == "whole reply");
			FChatStreamDecoder L(Conv, true, Msg1);
			L.Feed(Meta() + Delta("a") + Done());
			EXPECT(Answers, !L.IsReplayed() && L.Outcome() == EChatStreamOutcome::Done);
		}

		/* Q4: 409 in_progress backs off ChatInProgressBackoffMs (session rows); the constant itself: */
		EXPECT(Answers, ChatInProgressBackoffMs == 2000);

		/* Q5: finishReason max_length is a complete reply with a fixed line. */
		{
			FChatStreamDecoder D("", false);
			D.Feed(Meta() + Delta("long") + Done(Msg1, "max_length"));
			EXPECT(Answers, D.Outcome() == EChatStreamOutcome::Done && D.HitLengthLimit() && D.FinishReason() == "max_length");
			FChatStreamDecoder E("", false);
			E.Feed(Meta() + Delta("short") + Done());
			EXPECT(Answers, E.Outcome() == EChatStreamOutcome::Done && !E.HitLengthLimit());
			FOpenAiCompanionSession S(Origin);
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
			FOpenAiCompanionSession S(Origin);
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
			FOpenAiCompanionSession S(Origin);
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
			FOpenAiCompanionSession S(Origin);
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
			FOpenAiCompanionSession S(Origin);
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
			FOpenAiCompanionSession S(RelayOriginFromJ1Endpoint("http://localhost:47123/"));
			EXPECT(Answers, S.View().Offline == EOfflineReason::RelayNotLoopback && S.ProvidersRequest().Method.empty());
		}

		/* Q10: label = labels[mode]; "label" is deprecated and never read; one bad entry -> the list is untrusted. */
		{
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers());
			EXPECT(Answers, S.View().ProviderLabel == OddLabel && !Contains(Everything(S), "DEPRECATED"));
			EXPECT(Answers, S.LabelFor("openai", "siwc_plan") == "Plan label P" && S.LabelFor("openai", "agent_webhook").empty());
			EXPECT(Answers, S.LabelFor("grok_bot", "api_key").empty() && S.LabelFor("nobody", "api_key").empty());
		}
		{
			const std::string Bad[] = {
				// a listed mode with no label
				"{\"providers\":[{\"provider\":\"openai\",\"labels\":{\"api_key\":\"A\"},\"modes\":[\"api_key\",\"siwc_plan\"],\"modeAvailability\":{\"api_key\":\"available\",\"siwc_plan\":\"not_eligible\"}}]}",
				// the v0 shape: "label" only
				"{\"providers\":[{\"provider\":\"openai\",\"label\":\"A\",\"modes\":[\"api_key\"],\"modeAvailability\":{\"api_key\":\"available\"}}]}",
				// no modes
				"{\"providers\":[{\"provider\":\"openai\",\"labels\":{\"api_key\":\"A\"},\"modeAvailability\":{\"api_key\":\"available\"}}]}",
				// duplicate mode
				"{\"providers\":[{\"provider\":\"openai\",\"labels\":{\"api_key\":\"A\"},\"modes\":[\"api_key\",\"api_key\"],\"modeAvailability\":{\"api_key\":\"available\"}}]}",
				// empty label
				"{\"providers\":[{\"provider\":\"openai\",\"labels\":{\"api_key\":\"\"},\"modes\":[\"api_key\"],\"modeAvailability\":{\"api_key\":\"available\"}}]}",
				// a bad label on ANOTHER provider still poisons the list
				"{\"providers\":[{\"provider\":\"openai\",\"labels\":{\"api_key\":\"A\"},\"modes\":[\"api_key\"],\"modeAvailability\":{\"api_key\":\"available\"}},"
				"{\"provider\":\"grok_bot\",\"labels\":{\"agent_webhook\":7},\"modes\":[\"agent_webhook\"],\"modeAvailability\":{\"agent_webhook\":\"available\"}}]}",
				// non-snake mode
				"{\"providers\":[{\"provider\":\"openai\",\"labels\":{\"Api-Key\":\"A\"},\"modes\":[\"Api-Key\"],\"modeAvailability\":{\"Api-Key\":\"available\"}}]}",
			};
			int Row = 0;
			for (const std::string& Body : Bad)
			{
				FOpenAiCompanionSession S(Origin);
				S.ApplyProvidersAnswer(200, Body);
				const bool bRefused = S.View().Offline == EOfflineReason::ProvidersUnknown && S.View().ProviderLabel.empty() && S.LabelFor("openai", "api_key").empty();
				if (!bRefused) { std::printf("  q10 row %d accepted\n", Row); }
				EXPECT(Answers, bRefused);
				++Row;
			}
		}

		/* Q11: v0 never sends simulated:true; it is a protocol fault, never shown as a reply. */
		EXPECT(Answers, RunChat(Meta(Conv, ",\"simulated\":true") + Delta("fake") + Done()).Fault == EChatProtocolFault::MetaSimulatedTrue);
		EXPECT(Answers, RunChat(Meta(Conv, ",\"simulated\":false") + Delta("real") + Done()).Outcome == EChatStreamOutcome::Done);
		EXPECT(Answers, RunChat(Meta(Conv, ",\"simulated\":\"no\"") + Delta("x") + Done()).Fault == EChatProtocolFault::MetaBadSimulated);
		{
			FOpenAiCompanionSession S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q11", 1110));
			S.FeedChatBytes(Meta(Conv, ",\"simulated\":true") + Delta("FAKE-REPLY") + Done(), 0);
			EXPECT(Answers, S.History().Size() == 0 && !Contains(Everything(S), "FAKE-REPLY") && TraceHas(S, "chat_fault_meta_simulated_true"));
			EXPECT(Answers, S.View().PartialReply.empty() && S.View().State == ECompanionState::Error);
		}

		/* Q12: a rejection survives disconnect; only a successful PUT clears it. */
		{
			FOpenAiCompanionSession S(Origin);
			EXPECT(Answers, MakeReady(S) && Send(S, "q12", 1120));
			S.FeedChatBytes(Meta() + Err("provider_auth_failed", "bad key"), 0);
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected);
			EXPECT(Answers, !S.BeginDisconnect().Method.empty());
			S.ApplyDisconnectAnswer(204);
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected && S.View().StatusLine == "Your key was rejected" && S.View().bShowSimulatedBanner);
			S.ApplyConnectionsAnswer(200, Connections("connected"));
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected && !S.View().bCanSend);
			EXPECT(Answers, ConnectWith(S, 1121, 422, KindBody("companion_credential_rejected")));
			EXPECT(Answers, S.View().Offline == EOfflineReason::KeyRejected);
			EXPECT(Answers, ConnectWith(S, 1122, 200, ConnectOk));
			EXPECT(Answers, S.View().State == ECompanionState::Ready && S.View().Offline == EOfflineReason::None && S.View().bCanSend);
		}

		/* Q13: DELETE connection carries no idempotency key and no body. */
		{
			FOpenAiCompanionSession S(Origin);
			EXPECT(Answers, MakeReady(S));
			const FRelayRequest D = S.BeginDisconnect();
			EXPECT(Answers, D.Method == "DELETE" && D.IdempotencyKey.empty() && D.Body.empty());
		}

		/* Q14: 422 credential_rejected leaves the old connection; the 200 shape is strict. */
		{
			FOpenAiCompanionSession S(Origin);
			EXPECT(Answers, MakeReady(S));
			EXPECT(Answers, ConnectWith(S, 1140, 422, KindBody("companion_credential_rejected")));
			EXPECT(Answers, S.View().State == ECompanionState::Ready && S.View().StatusLine == "Your key was rejected" && S.View().bCanSend);
			EXPECT(Answers, !S.View().bShowSimulatedBanner && TraceHas(S, "connect_failed"));
			EXPECT(Answers, Send(S, "q14", 1141));
			S.FeedChatBytes(Meta() + Delta("ok") + Done(), 0);
			EXPECT(Answers, S.View().State == ECompanionState::Ready && S.View().StatusLine.empty() && S.History().Size() == 1);
		}
		{
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers());
			S.ApplyConnectionsAnswer(200, Connections("not_connected"));
			EXPECT(Answers, ConnectWith(S, 1142, 422, KindBody("companion_credential_rejected")));
			EXPECT(Answers, S.View().Offline == EOfflineReason::NotConnected && S.View().StatusLine == "Your key was rejected");
			EXPECT(Answers, ConnectWith(S, 1143, 422, KindBody("companion_body_invalid")));
			EXPECT(Answers, S.View().StatusLine == "Could not connect the key");
		}
		{
			const std::string Head = "{\"provider\":\"openai\",\"mode\":\"api_key\",";
			const std::string Bad[] = {
				Head + "\"state\":\"connected\",\"verifiedAt\":\"2026-10-23T22:00:01Z\"}",
				Head + "\"state\":\"connected\",\"connectedAt\":\"2026-10-23T22:00:00Z\",\"verifiedAt\":null}",
				Head + "\"state\":\"connected\",\"connectedAt\":\"2026-10-23T22:00:00Z\"}",
				Head + "\"state\":\"connected_unverified\",\"connectedAt\":\"2026-10-23T22:00:00Z\",\"verifiedAt\":\"2026-10-23T22:00:01Z\"}",
				Head + "\"state\":\"connected_unverified\",\"connectedAt\":\"2026-10-23T22:00:00Z\"}",
				Head + "\"state\":\"connected\",\"connectedAt\":\"2026-10-23 22:00:00\",\"verifiedAt\":\"2026-10-23T22:00:01Z\"}",
				Head + "\"state\":\"connected\",\"connectedAt\":null,\"verifiedAt\":\"2026-10-23T22:00:01Z\"}",
				Head + "\"state\":\"connected\",\"connectedAt\":\"2026-10-23T22:00:00Z\",\"verifiedAt\":\"yesterday\"}",
			};
			int Row = 0;
			for (const std::string& Body : Bad)
			{
				FOpenAiCompanionSession S(Origin);
				S.ApplyProvidersAnswer(200, Providers());
				S.ApplyConnectionsAnswer(200, Connections("not_connected"));
				const bool bSent = ConnectWith(S, 1150 + Row, 200, Body);
				const bool bRefused = bSent && S.View().State == ECompanionState::Offline && S.View().StatusLine == "Could not connect the key";
				if (!bRefused) { std::printf("  q14 row %d accepted\n", Row); }
				EXPECT(Answers, bRefused);
				++Row;
			}
			FOpenAiCompanionSession S(Origin);
			S.ApplyProvidersAnswer(200, Providers());
			S.ApplyConnectionsAnswer(200, Connections("not_connected"));
			EXPECT(Answers, ConnectWith(S, 1160, 200, ConnectUnverified) && S.View().State == ECompanionState::Ready && !S.View().bShowSimulatedBanner);
		}

		/* Q15: lastErrorKind shown only as its fixed line; unknown words show nothing (traced). */
		{
			const std::pair<const char*, const char*> Rows[] = {
				{"provider_auth_failed", "Your key was rejected"},
				{"provider_quota_exhausted", "Your OpenAI account is out of credit"},
				{"provider_rate_limited", "Retry later"},
				{"provider_unavailable", "Retry later"},
				{"provider_refused", "The provider refused this message"},
				{"companion_internal", "Companion error"},
				{"delivery_failed", "Companion delivery failed"},
			};
			for (const auto& Row : Rows)
			{
				FOpenAiCompanionSession S(Origin);
				S.ApplyProvidersAnswer(200, Providers());
				S.ApplyConnectionsAnswer(200, Connections("connected", std::string("\"") + Row.first + "\""));
				const bool bOk = S.View().LastErrorLine == Row.second && S.View().State == ECompanionState::Ready
					&& !Contains(S.View().LastErrorLine, "provider_") && !Contains(S.View().LastErrorLine, "companion_");
				if (!bOk) { std::printf("  q15 %s -> '%s'\n", Row.first, S.View().LastErrorLine.c_str()); }
				EXPECT(Answers, bOk);
			}
			for (const char* Odd : {"\"fallback_used\"", "5", "null", "\"\"", "\"Provider_Auth_Failed\""})
			{
				FOpenAiCompanionSession S(Origin);
				S.ApplyProvidersAnswer(200, Providers());
				S.ApplyConnectionsAnswer(200, Connections("connected", Odd));
				const bool bQuiet = S.View().LastErrorLine.empty() && S.View().State == ECompanionState::Ready && !Contains(Everything(S), "fallback_used");
				if (!bQuiet) { std::printf("  q15 odd %s -> '%s'\n", Odd, S.View().LastErrorLine.c_str()); }
				EXPECT(Answers, bQuiet);
			}
			{
				FOpenAiCompanionSession S(Origin);
				S.ApplyProvidersAnswer(200, Providers());
				S.ApplyConnectionsAnswer(200, Connections("connected", "\"fallback_used\""));
				EXPECT(Answers, TraceHas(S, "connections_last_error_unknown"));
			}
			{
				FOpenAiCompanionSession S(Origin);
				S.ApplyProvidersAnswer(200, Providers());
				S.ApplyConnectionsAnswer(200, Connections("connected", "\"provider_quota_exhausted\""));
				EXPECT(Answers, !S.BeginDisconnect().Method.empty());
				S.ApplyDisconnectAnswer(204);
				EXPECT(Answers, S.View().LastErrorLine.empty());
				S.ApplyConnectionsAnswer(200, Connections("connected", "\"provider_quota_exhausted\""));
				EXPECT(Answers, ConnectWith(S, 1170, 200, ConnectOk) && S.View().LastErrorLine.empty());
			}
		}
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
			FOpenAiCompanionSession S(Origin);
			EXPECT(Mint, MakeReady(S));
			std::string K;
			EXPECT(Mint, M.Mint(Src, K) == EKeyMint::Minted);
			FRelayRequest R;
			EXPECT(Mint, S.BeginMessage("hi", K, "", 0, R) && R.IdempotencyKey == K);
		}
		{
			// The failure path in the session: a fixed error, nothing sent, and an empty key is refused.
			FOpenAiCompanionSession S(Origin);
			EXPECT(Mint, MakeReady(S));
			S.ApplyKeyMintFailure();
			EXPECT(Mint, S.View().State == ECompanionState::Error && S.View().StatusLine == "Secure random unavailable; try again");
			EXPECT(Mint, TraceHas(S, "key_mint_failed") && S.View().bCanSend);
			FRelayRequest R;
			EXPECT(Mint, !S.BeginMessage("hi", "", "", 0, R) && R.Method.empty());
			FMaskedKeyField F;
			F.Append(Sentinel);
			FKeyHandoff H;
			EXPECT(Mint, !S.BeginConnect(F, "", H) && F.IsEmpty() && !H.IsValid());
			EXPECT(Mint, Send(S, "after", 1200) && S.View().State == ECompanionState::Streaming);
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
	if (Failures != 0)
	{
		std::printf("J1 COMPANION KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::printf("J1 COMPANION KAT PASS json=%d sse=%d chat=%d session=%d key=%d status=%d pin=%d history=%d result=%d route=%d answers=%d mint=%d\n",
		Checks[Json], Checks[Sse], Checks[Chat], Checks[Session], Checks[Key], Checks[Status], Checks[Pin], Checks[History], Checks[Result], Checks[Route], Checks[Answers], Checks[Mint]);
	return 0;
}

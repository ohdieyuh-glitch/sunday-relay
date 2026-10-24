// WONDERLAND -- ChatGPT side companion and Grok Bot HUD: the client's PURE LOGIC, standard C++17, no Unreal include.
//
// WHAT THIS IS. The parts of the companion terminal that must be exactly right and can be proven without an engine:
//   1. FSseParser: a WHATWG text/event-stream parser for POST /companions/openai/chat, robust to any chunk split,
//      CR / LF / CRLF (also a CRLF split across chunks), comments (": ping"), multi-line data, a leading BOM, and
//      oversize lines or events (capped; the parser then fails closed and stays failed).
//   2. ParseJson: a strict RFC 8259 reader (depth cap, duplicate keys refused, no trailing bytes) for event data,
//      status bodies and result bodies.
//   3. FChatStreamDecoder: the meta / delta / done / error event grammar of contract v0 section 2.1.
//   4. FOpenAiCompanionSession: OFFLINE until the PLAYER connects THEIR OWN OpenAI key (BYOAI only; there is no
//      i.Wonder-funded key, endpoint or provider fallback anywhere in this file), then connecting / ready /
//      streaming and the terminal error states of contract section 2.3. The provider label is the server's text,
//      verbatim (GET /companions/providers); this file holds no provider label of its own.
//   5. FMaskedKeyField / FKeyHandoff: the key is typed into a masked field, passed ONCE to the loopback-only relay
//      (PUT /relay-api/wonderland/companions/connections/openai) and wiped. It is never stored, logged, traced or
//      displayed; the mask is the same fixed text whatever the key's length.
//   6. ParseMissionStatus / FStatusPin: contract v0.1 section 4.2 status body: top-level (a "data" or "phase" key is
//      a fault), field "state" from a closed list, cause omitted or closed, legacyRunId / serverRunId per Q21,
//      dispatchedAt written once, no seq / progress / companion (ignored), poll-only ordering by updatedAt (Q24).
//      The run pin is #444's rule: the client's own wlj_ id, byte for byte (IsClientMintedRunId /
//      IsAcceptedServerRunId). running / completed are withdrawn: the HUD stops at "dispatched".
//   7. FTurnHistory: the server picks the model (the client never sends one), the last 20 turns are kept, and the
//      player can delete them (local copy first, then DELETE on the server's conversation).
//   8. ParseCompanionResultV0 / ParseCompanionProvenanceV0: Grok Bot output is UNTRUSTED, capped at 256 KiB before
//      parsing, never executed; simulated:true is always shown as simulated.
//   9. CompanionMissionRequest / ParseCompanionMission: contract v0.1 section 3.7, the loopback read of the Grok Bot
//      result and provenance (GET .../julius/missions/{wljRunId}/companion). wlj_ only; any non-200 answer, and any
//      body that fails a check, is "no companion result" and never "verified".
//
// THE CONTRACT this follows is BRIDGE's DRAFT /workspace/bridge/companion-contract-v0.1.md (file written Fri 2026-10-23 22:28 PT),
// which supersedes v0 (~21:50 PT) and answers Q1-Q24 (ANSWERS_FROM_BRIDGE.md).
// Where it is ambiguous the choice made here is the fail-closed one and the question is written down in
// OPEN_QUESTIONS_FOR_BRIDGE.md (Qn numbers are cited inline below).
//
//  10. FIdempotencyKeyMinter: x-relay-idempotency-key values, a canonical lowercase UUIDv4 from 16 bytes of a
//      CALLER-INJECTED source (WonderlandJuliusMissionLogic::IRandomBytes16; the UE adapter passes #433's
//      FWonderlandJuliusPlatformCryptoRandom, IPlatformCrypto CreateRandomBytes). A failed or repeating source mints
//      nothing (fail closed, no fallback); the session then refuses the request.
//
// CHAT ANSWERS Q1-Q15 (BRIDGE, ANSWERS_FROM_BRIDGE.md, contract v0.1) are applied: msg_<uuidv4> message ids (Q1), a
// closed event set with no id:/retry: fields (Q2), meta first on every stream incl. replays with "replayed" (Q3),
// Truncated -> same-key resend, 409 in progress -> 2 s back-off (Q4), max_length finish (Q5), 413/400 (Q6), DELETE
// 409 retried (Q7), Retry-After >= 1 s / retryAfterMs integer-or-absent, 60 s otherwise (Q8), the relay origin taken
// from the J1 endpoint config (Q9), labels[mode] (Q10), chat never simulated (Q11), sticky rejection cleared only by
// a successful PUT (Q12), DELETE connection without a key (Q13), the PUT 200 / 422 shapes (Q14), lastErrorKind (Q15).
//
// WHAT IS NOT HERE. No HTTP, no sockets, no clock, no RNG of its own (randomness only through IRandomBytes16), no
// logging, no Unreal types. The Unreal adapter seam is WonderlandCompanionClient.h.
#pragma once

#include "WonderlandJuliusMissionLogic.h"

#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

namespace WonderlandCompanionLogic
{
	/* ---------------------------------------------------------------- limits (all fail closed when exceeded) */

	/** One SSE line, bytes, without its terminator. Outer guard: the server promises <= 16 KiB (Q5). */
	inline constexpr std::size_t SseMaxLineBytes = 64 * 1024;
	/** One SSE event's joined data, bytes. Outer guard: the server promises <= 16 KiB (Q5). */
	inline constexpr std::size_t SseMaxEventDataBytes = 64 * 1024;
	/** One assistant reply, the sum of all delta text, bytes. Outer guard: the server promises <= 128 KiB (Q5). */
	inline constexpr std::size_t ChatMaxReplyBytes = 256 * 1024;
	/** Q5: the server's own reply cap; a reply that hits it ends with done.finishReason "max_length". Informational. */
	inline constexpr std::size_t ChatServerMaxReplyBytes = 128 * 1024;
	/** Q6: the server refuses a request body over 64 KiB (413). The client's worst case (8000 units) stays under it. */
	inline constexpr std::size_t ChatMaxRequestBodyBytes = 64 * 1024;
	/** Q4: 409 companion_message_in_progress -> wait this long, then resend the SAME key. */
	inline constexpr std::uint64_t ChatInProgressBackoffMs = 2000;
	/** Q8: Retry-After missing / not integer seconds >= 1, or retryAfterMs absent: wait this long. */
	inline constexpr std::uint64_t DefaultRetryWaitMs = 60 * 1000;
	/** Contract 2.1: message <= 8000 chars, counted here as UTF-16 code units like the TypeScript server. Q6. */
	inline constexpr std::size_t ChatMaxMessageUtf16Units = 8000;
	/** Contract 3.4: a Grok Bot result body is at most 256 KiB. Checked BEFORE any parsing. */
	inline constexpr std::size_t CompanionResultMaxBytes = 256 * 1024;
	/** Contract 3.4: summary <= 4 KiB (bytes). */
	inline constexpr std::size_t CompanionSummaryMaxBytes = 4 * 1024;
	/** Status and section 3.7 companion bodies are small; anything larger is refused unread. */
	inline constexpr std::size_t StatusMaxBodyBytes = 64 * 1024;
	/** Provider list / connection list bodies. */
	inline constexpr std::size_t ListMaxBodyBytes = 64 * 1024;
	/** Turns kept on the client (and, per the task's default, on the server). Q7. */
	inline constexpr std::size_t HistoryMaxTurns = 20;
	inline constexpr std::size_t JsonMaxDepth = 16;
	inline constexpr std::size_t ProviderLabelMaxBytes = 128;
	inline constexpr std::size_t ApiKeyMaxBytes = 512;
	inline constexpr std::size_t ErrorMessageMaxBytes = 4 * 1024;

	/** The only base path the client ever calls (contract 0). */
	inline constexpr std::string_view RelayBasePath = "/relay-api/wonderland";

	/* ---------------------------------------------------------------- strict JSON */

	struct FJsonValue
	{
		enum class EKind : std::uint8_t { Null, Bool, Number, String, Array, Object };
		EKind Kind = EKind::Null;
		bool bBool = false;
		/** String: the decoded text (UTF-8; a lone \uD800-\uDFFF escape is kept as its 3-byte WTF-8 form so that a
		 *  surrogate pair split across two deltas can be rejoined, see SanitizeUntrustedText). Number: the literal. */
		std::string Text;
		std::vector<FJsonValue> Items;
		std::vector<std::pair<std::string, FJsonValue>> Members;

		const FJsonValue* Find(std::string_view Key) const;
		bool IsString() const { return Kind == EKind::String; }
		bool IsNull() const { return Kind == EKind::Null; }
		bool IsObject() const { return Kind == EKind::Object; }
	};

	/** RFC 8259, whole input, strict UTF-8, depth <= JsonMaxDepth, duplicate object keys refused. */
	bool ParseJson(std::string_view Utf8, FJsonValue& Out);
	/** A JSON integer literal (no fraction, no exponent, no minus) <= 2^53 - 1. */
	bool JsonToSafeUnsigned(const FJsonValue& Value, std::uint64_t& Out);
	/** Writes Text as a JSON string literal with quotes; Text must be valid UTF-8. */
	void AppendJsonString(std::string& Out, std::string_view Text);
	/** Strict UTF-8 (no overlongs, no surrogates, <= U+10FFFF). */
	bool IsValidUtf8(std::string_view Text);

	/**
	 * For display of any server or companion text: rejoins WTF-8 surrogate pairs, turns lone surrogates into U+FFFD,
	 * turns CRLF / CR into LF, and drops C0 controls other than LF and TAB, DEL, C1 controls, and the bidi embedding,
	 * override and isolate controls (U+202A-202E, U+2066-2069), so untrusted text cannot fake terminal chrome.
	 */
	std::string SanitizeUntrustedText(std::string_view Text);

	/* ---------------------------------------------------------------- SSE */

	struct FSseEvent
	{
		/** "message" when the stream gave no event field. */
		std::string Event;
		/** The data lines joined with LF, without the final LF. */
		std::string Data;
		std::string LastEventId;
		/** An "id" or "retry" field appeared while this event was built (WHATWG-valid; a v0.1 chat fault, Q2). */
		bool bHadIdOrRetry = false;
	};

	enum class ESseFault : std::uint8_t { None, LineTooLong, EventTooLarge };

	class FSseParser
	{
	public:
		explicit FSseParser(std::size_t InMaxLineBytes = SseMaxLineBytes, std::size_t InMaxEventDataBytes = SseMaxEventDataBytes);
		/** Appends every event this chunk completes. Returns false once the parser has failed (sticky). */
		bool Feed(std::string_view Chunk, std::vector<FSseEvent>& Out);
		/** End of stream. A half-built event is discarded (WHATWG). Returns true when one was pending. */
		bool FinishHadPartialEvent();
		bool Failed() const { return Fault != ESseFault::None; }
		ESseFault GetFault() const { return Fault; }
		std::size_t CommentCount() const { return Comments; }
		/** "id" and "retry" fields seen (WHATWG-valid, but outside the v0.1 chat stream, Q2). */
		std::size_t IdFieldCount() const { return IdFields; }
		std::size_t RetryFieldCount() const { return RetryFields; }

	private:
		void FeedByte(char Byte, std::vector<FSseEvent>& Out);
		void ProcessLine(std::vector<FSseEvent>& Out);
		void Dispatch(std::vector<FSseEvent>& Out);

		std::size_t MaxLineBytes;
		std::size_t MaxEventDataBytes;
		std::string Line;
		std::string Data;
		std::string EventType;
		std::string LastId;
		std::string BomPending;
		bool bBomResolved = false;
		bool bAfterCr = false;
		bool bHaveDataField = false;
		bool bIdOrRetryInEvent = false;
		std::size_t Comments = 0;
		std::size_t IdFields = 0;
		std::size_t RetryFields = 0;
		ESseFault Fault = ESseFault::None;
	};

	/* ---------------------------------------------------------------- chat stream (contract 2.1) */

	enum class EChatStreamOutcome : std::uint8_t { Open, Done, ProviderError, ProtocolError };

	enum class EChatErrorKind : std::uint8_t
	{
		None,
		ProviderAuthFailed,
		ProviderQuotaExhausted,
		ProviderRateLimited,
		ProviderUnavailable,
		ProviderRefused,
		CompanionInternal,
		/** A well-formed error event whose kind is not in the contract's list: shown as a generic error. */
		Unknown,
	};

	enum class EChatProtocolFault : std::uint8_t
	{
		None,
		SseLineTooLong,
		SseEventTooLarge,
		BadJson,
		UnknownEvent,
		MetaMissing,
		MetaDuplicate,
		MetaWrongProvider,
		MetaWrongMode,
		MetaBadConversationId,
		ConversationMismatch,
		MetaBadMessageId,
		MetaBadModel,
		/** "simulated" present and not a boolean. */
		MetaBadSimulated,
		/** Q11: chat is never simulated; meta "simulated":true is a fault, never shown as a real reply. */
		MetaSimulatedTrue,
		/** Q3: "replayed" not a boolean, or true on a stream that answers a fresh (never sent) key. */
		MetaBadReplayed,
		/** Q1/Q3: a replay must carry the messageId (and cnv_ id) an earlier attempt of the same key already showed. */
		ReplayMessageMismatch,
		/** Q3: a replayed stream is meta, at most one delta, done -- or meta, error. */
		ReplaySequence,
		/** Q2: an SSE "id:" or "retry:" field. */
		ForbiddenSseField,
		DeltaBadText,
		ReplyTooLarge,
		DoneBadFields,
		DoneMessageMismatch,
		ErrorBadFields,
		Truncated,
	};

	const char* ChatProtocolFaultName(EChatProtocolFault Fault);
	EChatErrorKind ClassifyChatErrorKind(std::string_view Kind);

	/** "cnv_" + canonical lowercase UUIDv4 (contract 2.1). */
	bool IsConversationId(std::string_view Text);
	/** "msg_" + canonical lowercase UUIDv4 (Q1). */
	bool IsMessageId(std::string_view Text);

	class FChatStreamDecoder
	{
	public:
		/**
		 * ExpectedConversationId: empty for a new conversation, else the cnv_ id meta must echo (the request's, or on
		 * a resend the one an earlier attempt of the same key already showed). bReplayResend: this stream answers a
		 * resend of the SAME idempotency key, so meta may carry "replayed":true (Q3); meta is required either way.
		 * ExpectedMessageId: on a resend, the msg_ id an earlier attempt showed (empty if none): meta and done must
		 * carry it (Q1 "a replay returns the same id").
		 */
		FChatStreamDecoder(std::string ExpectedConversationId, bool bReplayResend, std::string ExpectedMessageId = std::string());

		EChatStreamOutcome Feed(std::string_view Chunk);
		/** The transport reported end of body. A stream that ends Open is ProtocolError / Truncated (Q4). */
		EChatStreamOutcome Finish();

		EChatStreamOutcome Outcome() const { return State; }
		EChatProtocolFault Fault() const { return ProtocolFault; }
		bool HasMeta() const { return bHaveMeta; }
		const std::string& ConversationId() const { return ConvId; }
		const std::string& MessageId() const { return MsgId; }
		const std::string& Model() const { return ModelName; }
		/** Q3: meta said "replayed":true (only possible on a same-key resend). */
		bool IsReplayed() const { return bReplayed; }
		/** Q5: done.finishReason was "max_length": the reply is whole but the model hit the length cap. */
		bool HitLengthLimit() const { return Finish_ == "max_length"; }
		/** Display-ready (SanitizeUntrustedText of all deltas). Empty unless Outcome is Open or Done. */
		std::string ReplyForDisplay() const;
		std::size_t ReplyBytes() const { return Reply.size(); }
		const std::string& FinishReason() const { return Finish_; }
		std::uint64_t InputTokens() const { return InTokens; }
		std::uint64_t OutputTokens() const { return OutTokens; }
		EChatErrorKind ErrorKind() const { return ErrKind; }
		/** Display-ready provider message of the error event (sanitized, capped). */
		const std::string& ErrorMessage() const { return ErrMessage; }
		bool HasRetryAfter() const { return bHasRetryAfter; }
		std::uint64_t RetryAfterMs() const { return RetryAfter; }
		std::size_t IgnoredAfterEnd() const { return Ignored; }
		std::size_t Pings() const { return Sse.CommentCount(); }

	private:
		void OnEvent(const FSseEvent& Event);
		void Fail(EChatProtocolFault Why);

		FSseParser Sse;
		std::string ExpectedConv;
		bool bReplay;
		std::string ExpectedMsg;
		bool bReplayed = false;
		std::size_t Deltas = 0;
		EChatStreamOutcome State = EChatStreamOutcome::Open;
		EChatProtocolFault ProtocolFault = EChatProtocolFault::None;
		bool bHaveMeta = false;
		std::string ConvId;
		std::string MsgId;
		std::string ModelName;
		std::string Reply;
		std::string Finish_;
		std::uint64_t InTokens = 0;
		std::uint64_t OutTokens = 0;
		EChatErrorKind ErrKind = EChatErrorKind::None;
		std::string ErrMessage;
		bool bHasRetryAfter = false;
		std::uint64_t RetryAfter = 0;
		std::size_t Ignored = 0;
	};

	/* ---------------------------------------------------------------- the API key: masked field and one-shot handoff */

	/** ^http://(127.0.0.1|[::1]):<1-65535>$ exactly: loopback literal, no name lookup, no path, no userinfo. Q9. */
	bool IsLoopbackRelayOrigin(std::string_view Origin);
	/**
	 * Q9: the companion's relay origin is the SAME configured endpoint the J1 dispatch path (#433) uses; there is no
	 * discovery and pairing returns no port. Returns J1BaseUrl (one trailing '/' dropped) when it is a strict
	 * loopback origin per IsLoopbackRelayOrigin, else empty: #433 also accepts "localhost", which the companion
	 * refuses (the key never follows a name lookup), so that config keeps the companion Offline.
	 */
	std::string RelayOriginFromJ1Endpoint(std::string_view J1BaseUrl);

	class FMaskedKeyField
	{
	public:
		FMaskedKeyField();
		~FMaskedKeyField();
		FMaskedKeyField(const FMaskedKeyField&) = delete;
		FMaskedKeyField& operator=(const FMaskedKeyField&) = delete;

		/** Typed or pasted text. Input past ApiKeyMaxBytes is dropped and the field marked overlong (refused later). */
		void Append(std::string_view Typed);
		void Backspace();
		void Clear();
		bool IsEmpty() const { return Length == 0; }
		/** Fixed text, independent of the key's length or content; empty when the field is empty. */
		std::string_view MaskText() const;

	private:
		friend class FOpenAiCompanionSession;
		void Wipe();
		char Buffer[ApiKeyMaxBytes + 1];
		std::size_t Length = 0;
		bool bOverlong = false;
	};

	/**
	 * The ONE request that carries the key. Move-only; its body is wiped by MarkSent and by the destructor. It is
	 * never stored by the session and never appears in a trace.
	 */
	class FKeyHandoff
	{
	public:
		FKeyHandoff() = default;
		~FKeyHandoff();
		FKeyHandoff(FKeyHandoff&& Other) noexcept;
		FKeyHandoff& operator=(FKeyHandoff&& Other) noexcept;
		FKeyHandoff(const FKeyHandoff&) = delete;
		FKeyHandoff& operator=(const FKeyHandoff&) = delete;

		bool IsValid() const { return !Url.empty() && !BodyBytes.empty(); }
		const std::string& Method() const { return MethodName; }
		const std::string& TargetUrl() const { return Url; }
		const std::string& IdempotencyKey() const { return IdemKey; }
		/** The JSON body, for the transport's single send. Empty after MarkSent. */
		std::string_view Body() const { return BodyBytes; }
		/** Call right after the transport copied the body out. Wipes the body. */
		void MarkSent();

	private:
		friend class FOpenAiCompanionSession;
		void Wipe();
		std::string MethodName;
		std::string Url;
		std::string IdemKey;
		std::string BodyBytes;
	};

	/* ---------------------------------------------------------------- turn history (contract 2.1 / 2.2) */

	struct FTurn
	{
		std::string PlayerText;
		/** Display-ready reply. */
		std::string ReplyText;
		std::string MessageId;
		/** Server-picked model as reported in meta; display only. */
		std::string Model;
		std::string FinishReason;
		/** Q5: finishReason "max_length". */
		bool bHitLengthLimit = false;
	};

	class FTurnHistory
	{
	public:
		void Add(FTurn Turn);
		void Clear() { Turns.clear(); }
		std::size_t Size() const { return Turns.size(); }
		const FTurn& At(std::size_t Index) const { return Turns[Index]; }

	private:
		std::deque<FTurn> Turns;
	};

	/* ---------------------------------------------------------------- the session */

	struct FRelayRequest
	{
		std::string Method;
		std::string Url;
		/** Empty when the route needs none. */
		std::string IdempotencyKey;
		std::string Body;
	};

	enum class ECompanionState : std::uint8_t
	{
		/** No usable connection: not connected, key rejected, revoked, mode unavailable, or provider list unknown. */
		Offline,
		/** PUT in flight (or SIWC pending_authorization, not in v0). */
		Connecting,
		Ready,
		Streaming,
		/** provider_rate_limited, provider_unavailable, companion_store_unavailable, message in progress, transport. */
		RetryLater,
		/** Our per-player limit: 429 companion_rate_limited. */
		SlowDown,
		/** provider_quota_exhausted. */
		OutOfCredit,
		/** provider_refused: the provider's text is shown as given. */
		Refused,
		Error,
	};

	enum class EOfflineReason : std::uint8_t { None, ProvidersUnknown, ModeUnavailable, NotConnected, KeyRejected, Revoked, RelayNotLoopback };

	struct FCompanionView
	{
		ECompanionState State = ECompanionState::Offline;
		EOfflineReason Offline = EOfflineReason::ProvidersUnknown;
		/** The server's label, verbatim; empty until GET /companions/providers succeeded. */
		std::string ProviderLabel;
		/** Contract 2.3 "Terminal shows" text, or a fixed notice. Never contains provider or companion output. */
		std::string StatusLine;
		/** provider_refused only: the provider's refusal, sanitized, as given. */
		std::string RefusalText;
		/** Streaming: the reply so far (sanitized). */
		std::string PartialReply;
		/**
		 * Q15: GET /companions/connections lastErrorKind, ONLY as its 2.3 text (never the raw word); empty for null or
		 * a word outside the closed set.
		 */
		std::string LastErrorLine;
		/** Contract 3.5: the SIMULATED banner shows whenever no real connection exists. */
		bool bShowSimulatedBanner = true;
		bool bCanConnect = false;
		bool bCanSend = false;
		bool bCanResend = false;
		std::uint64_t RetryNotBeforeMs = 0;
	};

	class FOpenAiCompanionSession
	{
	public:
		/** RelayOrigin: "http://127.0.0.1:<port>" or "http://[::1]:<port>". Anything else: permanently Offline. */
		explicit FOpenAiCompanionSession(std::string RelayOrigin);

		/* provider list and connections (contract 1.1, 1.4) */
		FRelayRequest ProvidersRequest() const;
		void ApplyProvidersAnswer(int HttpStatus, std::string_view Body);
		FRelayRequest ConnectionsRequest() const;
		void ApplyConnectionsAnswer(int HttpStatus, std::string_view Body);
		/** Q10: labels[Mode] of a provider ("openai"/"api_key", "grok_bot"/...), verbatim, or empty. "label" is never read. */
		std::string LabelFor(std::string_view Provider, std::string_view Mode) const;

		/* connect / disconnect (contract 1.2, 1.3). BeginConnect wipes the field whatever it returns. */
		bool BeginConnect(FMaskedKeyField& Field, std::string_view IdempotencyKey, FKeyHandoff& Out);
		void ApplyConnectAnswer(int HttpStatus, std::string_view Body, std::uint64_t NowMs);
		FRelayRequest BeginDisconnect();
		void ApplyDisconnectAnswer(int HttpStatus);
		/** The adapter's FIdempotencyKeyMinter failed (no secure random): nothing is sent, a fixed error is shown. */
		void ApplyKeyMintFailure();

		/* chat (contract 2.1). WljRunId: empty, or this client's own canonical wlj_ id (legacy run: refused). */
		bool BeginMessage(std::string_view Message, std::string_view IdempotencyKey, std::string_view WljRunId,
			std::uint64_t NowMs, FRelayRequest& Out);
		/** A non-SSE answer to the chat POST (any status other than 200 text/event-stream). */
		void ApplyChatHttpAnswer(int HttpStatus, std::string_view RetryAfterHeader, std::string_view Body, std::uint64_t NowMs);
		/** 200 text/event-stream body bytes, as they arrive. */
		void FeedChatBytes(std::string_view Chunk, std::uint64_t NowMs);
		void FinishChatStream(std::uint64_t NowMs);
		/** No HTTP answer at all (connection reset, timeout before headers). */
		void ApplyChatTransportFailure(std::uint64_t NowMs);
		/** Resend the last message with the SAME key (contract 2.1 replay). Only after a broken or unanswered stream. */
		bool BeginResend(std::uint64_t NowMs, FRelayRequest& Out);

		/* history (contract 2.2) */
		const FTurnHistory& History() const { return Turns; }
		/** Clears the local turns at once. Out is the server DELETE, or Method empty when there is no conversation. */
		FRelayRequest BeginDeleteHistory();
		void ApplyDeleteHistoryAnswer(int HttpStatus);
		const std::string& ConversationId() const { return ConvId; }

		const FCompanionView& View() const { return ViewState; }
		/** Event words only; never text, never key material. */
		const std::vector<std::string>& Trace() const { return TraceLines; }

	private:
		void Recompute();
		void SetError(const char* Line, const char* TraceWord);
		void ApplyStreamOutcome(std::uint64_t NowMs);
		void Note(std::string Word);
		std::string Url(std::string_view Path) const;

		std::string Origin;
		bool bOriginOk = false;
		/** provider -> (mode -> label), Q10. */
		std::vector<std::pair<std::string, std::vector<std::pair<std::string, std::string>>>> Labels;
		bool bProvidersOk = false;
		bool bApiKeyModeAvailable = false;
		/** Connection state word for openai as last reported; empty = unknown. */
		std::string ConnState;
		bool bConnecting = false;
		/** Sticky until the next successful reconnect: provider_auth_failed. */
		bool bKeyRejected = false;

		ECompanionState Transient = ECompanionState::Ready;
		const char* TransientLine = nullptr;
		std::string Refusal;
		std::uint64_t RetryNotBefore = 0;

		bool bStreaming = false;
		FChatStreamDecoder Decoder{std::string(), false};
		std::string PendingMessage;
		std::string PendingKey;
		std::string PendingRunId;
		std::string PendingConvSent;
		/** What an earlier attempt of the pending key showed in meta (Q1, Q3): a resend's replay must match it. */
		std::string PendingConvSeen;
		std::string PendingMsgSeen;
		bool bResendAllowed = false;
		std::vector<std::string> UsedKeys;

		std::string ConvId;
		/** A conversation whose server DELETE has not been confirmed yet; BeginDeleteHistory resends it. */
		std::string DeletePendingConv;
		/**
		 * After a refused connect: shown while Offline, and (Q14 422: the old connection is unchanged) while Ready,
		 * until the next connect or message. Never contains key material.
		 */
		const char* ConnectNotice = nullptr;
		/** Q15: the 2.3 line for the last lastErrorKind, or nullptr. */
		const char* LastErrorLine = nullptr;
		FTurnHistory Turns;
		FCompanionView ViewState;
		std::vector<std::string> TraceLines;
	};

	/* ---------------------------------------------------------------- idempotency keys */

	enum class EKeyMint : std::uint8_t
	{
		Minted,
		/** The injected source reported failure: nothing minted, no fallback. */
		RandomUnavailable,
		/** The source produced a key this minter already issued: refused (a stuck source must not reuse a key). */
		RandomRepeated,
	};

	/**
	 * x-relay-idempotency-key values: canonical lowercase UUIDv4 (version nibble 4, variant 8/9/a/b) from 16 bytes of
	 * the CALLER'S IRandomBytes16 (WonderlandJuliusMissionLogic::FormatUuidV4FromBytes). The core never seeds or owns an
	 * RNG. On any failure OutKey is left EMPTY and the caller must not send (session: ApplyKeyMintFailure).
	 */
	class FIdempotencyKeyMinter
	{
	public:
		EKeyMint Mint(WonderlandJuliusMissionLogic::IRandomBytes16& Source, std::string& OutKey);
		std::size_t IssuedCount() const { return Issued.size(); }

	private:
		std::unordered_set<std::string> Issued;
	};

	/* ---------------------------------------------------------------- mission status (contract v0.1 4.2) */

	/**
	 * Contract v0.1 4.2 "state", closed (#407 candidate acc96ab0 WONDERLAND_STATUS_STATES + awaiting_operator). There
	 * is no running / completed / expired: expiry is Failed + cause AWAITING_OPERATOR_EXPIRED (Q17, Q18).
	 */
	enum class EStatusState : std::uint8_t
	{
		Held, AwaitingOperator, Reserved, Dispatched, Unknown, LedgerUnwritten, Interrupted, Failed, DispatchFailed,
		AlreadySpent,
	};
	/** Contract v0.1 4.2 "cause", closed. None when the key is omitted or null. */
	enum class EStatusCause : std::uint8_t
	{
		None, RunIdAlreadySpent, SpentTagUnverified, GhWorkflowRunFailed, AwaitingOperatorExpired,
	};
	/** Contract 3.6 (v0.1), closed; NoResult is new in v0.1 (#440 "missing"). */
	enum class ECompanionTaskState : std::uint8_t
	{
		None, Invited, Delivered, DeliveryFailed, ResultReceived, Integrated, Rejected, TimedOut, NoResult, Cancelled,
	};

	struct FMissionStatus
	{
		std::string WljRunId;
		/** Empty when null (a new wlj_ run). The run:<24 hex> of a legacy row. */
		std::string LegacyRunId;
		/**
		 * True when legacyRunId was absent and the run: id came from serverRunId (today's #407 candidate body, which
		 * has no legacyRunId key yet; Q21 interim). See ParseMissionStatus.
		 */
		bool bLegacyFromServerRunIdOnly = false;
		EStatusState State = EStatusState::Unknown;
		EStatusCause Cause = EStatusCause::None;
		/** False when the key is absent (today's server) or null, or when it is a string that is not strict UTC. */
		bool bHasDispatchedAt = false;
		/**
		 * #444 P9: dispatchedAt was a string ParseBridgeUtcTimestampMs does not accept (only 0 or 3 fraction digits
		 * are; a 1-2 or 4-9 digit fraction, an offset or any other text is not). Not a fault: on "dispatched" the
		 * meaning is DispatchUnconfirmed, and the pin never compares or stores it.
		 */
		bool bDispatchedAtUnconfirmed = false;
		std::uint64_t DispatchedAtMs = 0;
		std::uint64_t UpdatedAtMs = 0;
	};

	enum class EStatusParse : std::uint8_t
	{
		Ok, BodyTooLarge, BadJson, NotObject, BadWljRunId, BadLegacyRunId, BadServerRunId, RunIdsDisagree, BadPhase,
		BadCause, BadDispatchedAt, BadUpdatedAt, BadWorkflowRunId,
	};
	const char* StatusParseName(EStatusParse Result);
	/** v0.1 terminal list: ledger_unwritten, interrupted, failed, dispatch_failed, already_spent (Q18). */
	bool IsTerminalState(EStatusState State);

	/**
	 * Contract v0.1 4.2. Fails closed on: a body over StatusMaxBodyBytes; bad JSON or not an object; a "data" or
	 * "phase" key (BadPhase: v0 shapes, never synonyms); wljRunId not a canonical wlj_; legacyRunId not null or
	 * run:<24 hex>; serverRunId not run:<24 hex> or a canonical wlj_; the Q21 rule broken (legacyRunId non-null:
	 * serverRunId == legacyRunId; legacyRunId null: serverRunId == wljRunId; serverRunId absent: skipped); state
	 * missing or outside the closed list; cause outside the closed list, or AWAITING_OPERATOR_EXPIRED on a state other
	 * than failed; dispatchedAt not a string or null (a string that is not strict UTC is Ok with
	 * bDispatchedAtUnconfirmed, matching #444's DispatchUnconfirmed); updatedAt not strict UTC. "progress", "companion" and "seq" are ignored (Q19, Q20,
	 * Q24). Absent legacyRunId with a run: serverRunId reads as that legacy row (today's server; Q21 interim, v0.1
	 * Clarification 1); the two-argument form uses WonderlandJuliusMissionLogic::bStatusRouteRequiresLegacyRunId (the
	 * single switch, in WonderlandJuliusMissionProgress.h; false today), and when it is true an absent legacyRunId key
	 * is BadLegacyRunId. workflowRunId (Clarification 3) is optional: null or 1..128 bytes of printable ASCII without
	 * space, never stored; anything else is BadWorkflowRunId.
	 */
	EStatusParse ParseMissionStatus(std::string_view Body, FMissionStatus& Out);
	/** The same, with the legacy-key switch passed in (the KAT checks both settings). */
	EStatusParse ParseMissionStatus(std::string_view Body, FMissionStatus& Out, bool bRequireLegacyRunId);

	/** What the HUD may say for an applied status (Q17 table). Never claims spend, PASS, running or completion. */
	enum class EStatusMeaning : std::uint8_t
	{
		/** held, awaiting_operator, reserved, unknown: waiting, unpaid. */
		Waiting,
		/** dispatched with a well-formed dispatchedAt: "Dispatched; run status not yet reported" (running / completed are withdrawn, Q18). */
		DispatchedNotReported,
		/** dispatched with dispatchedAt absent, null or a string that is not strict UTC: #444's DispatchUnconfirmed text, never a fault. */
		DispatchUnconfirmed,
		/** failed + AWAITING_OPERATOR_EXPIRED: not started, unpaid, final. Never a mission failure, never spend. */
		NotStartedOperatorWindowExpired,
		/** failed (no cause), interrupted, ledger_unwritten: the admission ended. */
		AdmissionEnded,
		/** dispatch_failed (any cause; SPENT_TAG_UNVERIFIED shows no tag text, Q23). */
		DispatchFailed,
		/** already_spent. */
		AlreadySpent,
	};
	EStatusMeaning StatusMeaning(const FMissionStatus& Status);
	const char* StatusMeaningLabel(EStatusMeaning Meaning);

	/**
	 * GET /relay-api/wonderland/julius/status?runId=..&projectId=.. (contract v0.1 4.2). RunId: a canonical wlj_ (the
	 * v0.1 primary form) or run:<24 hex> (recorded rows). ProjectId: 1-64 of [A-Za-z0-9_-]. Empty Method when the
	 * origin is not loopback or an input is malformed.
	 */
	FRelayRequest MissionStatusRequest(std::string_view RelayOrigin, std::string_view RunId, std::string_view ProjectId);

	enum class EPinVerdict : std::uint8_t { Applied, Stale, Mismatch };

	/**
	 * One per mission watch, created with the wlj_ id this client minted. Poll-only (Q24): Mismatch is sticky; a
	 * terminal state is sticky (later answers are Stale); an earlier updatedAt than the last applied one is Stale;
	 * wljRunId, a non-null legacyRunId and a non-null dispatchedAt are pinned once and a later change is a sticky
	 * Mismatch. After "dispatched" only dispatched / dispatch_failed / already_spent are applied (the server refuses
	 * anything else after a recorded dispatch); "unknown" never overwrites a known state. Both are Stale.
	 */
	class FStatusPin
	{
	public:
		explicit FStatusPin(std::string OwnWljRunId);
		EPinVerdict Apply(const FMissionStatus& Status);
		bool IsMismatched() const { return bMismatch; }
		bool HasState() const { return bHaveAny; }
		EStatusState PinnedState() const { return Current.State; }
		const FMissionStatus& Applied() const { return Current; }
		const std::string& PinnedLegacyRunId() const { return Current.LegacyRunId; }
		std::uint64_t LastUpdatedAtMs() const { return Current.UpdatedAtMs; }

	private:
		std::string Own;
		FMissionStatus Current;
		bool bHaveAny = false;
		bool bMismatch = false;
	};

	/* ---------------------------------------------------------------- Grok Bot result and provenance (contract 3.4, 3.5) */

	enum class EArtifactKind : std::uint8_t { Text, Patch, Json };

	struct FCompanionResultView
	{
		std::string TaskId;
		std::string WljRunId;
		/** Sanitized. Untrusted: shown as text, never executed, never applied. */
		std::string Summary;
		EArtifactKind ArtifactKind = EArtifactKind::Text;
		std::string ArtifactContent;
		/** Self-reported by whoever answered the webhook; must be labelled "self-reported". */
		std::string SelfReportedName;
		bool bUntrusted = true;
	};

	enum class EResultParse : std::uint8_t
	{
		Ok, TooLarge, BadJson, BadSchema, BadTaskId, RunIdMismatch, BadSummary, BadArtifact, BadAgent,
	};
	const char* ResultParseName(EResultParse Result);

	/** Body over CompanionResultMaxBytes is refused unread. WljRunId must be OwnWljRunId byte for byte (#444). */
	EResultParse ParseCompanionResultV0(std::string_view Body, std::string_view OwnWljRunId, FCompanionResultView& Out);

	struct FCompanionProvenanceView
	{
		bool bSimulated = true;
		bool bVerifiedByTokenRoundTrip = false;
		std::string SelfReportedName;
		std::string ResultSha256;
	};

	enum class EProvenanceParse : std::uint8_t { Ok, TooLarge, BadJson, BadSource, SimulatedInconsistent, SimulatedVerified, BadFields };
	EProvenanceParse ParseCompanionProvenanceV0(std::string_view Body, FCompanionProvenanceView& Out);

	/** "cmp_" + canonical lowercase UUIDv4. */
	bool IsCompanionTaskId(std::string_view Text);

	/* ---------------------------------------------------------------- Grok Bot result read route (contract v0.1 3.7) */

	/** Contract v0.1 3.6 terminal: delivery_failed, integrated, rejected, timed_out, no_result, cancelled. */
	bool IsTerminalCompanionState(ECompanionTaskState State);

	/**
	 * GET /relay-api/wonderland/julius/missions/{wljRunId}/companion?projectId=.. (contract v0.1 3.7, Q22). wlj_ ONLY:
	 * a legacy run: id, any other form, a bad ProjectId (1-64 of [A-Za-z0-9_-]) or a non-loopback origin gives an
	 * empty Method (send nothing).
	 */
	FRelayRequest CompanionMissionRequest(std::string_view RelayOrigin, std::string_view WljRunId, std::string_view ProjectId);

	struct FCompanionMissionView
	{
		/** False: "no companion result" -- show nothing about the companion. Every non-Ok parse leaves it false. */
		bool bHasAnswer = false;
		std::string TaskId;
		ECompanionTaskState State = ECompanionTaskState::None;
		bool bHasResult = false;
		/** Sanitized. Untrusted: shown as text, never executed, never applied. */
		std::string Summary;
		EArtifactKind ArtifactKind = EArtifactKind::Text;
		std::string ArtifactSha256;
		std::uint64_t ArtifactByteLength = 0;
		bool bHasProvenance = false;
		FCompanionProvenanceView Provenance;
		/** True only for a real (not simulated) provenance with verifiedBy "task_token_round_trip". */
		bool bShowVerified = false;
		std::uint64_t UpdatedAtMs = 0;
	};

	enum class ECompanionMissionParse : std::uint8_t
	{
		Ok, NotOk, TooLarge, BadJson, RunIdMismatch, BadTaskId, BadState, BadResult, BadProvenance, ResultTooEarly,
		BadUpdatedAt,
	};
	const char* CompanionMissionParseName(ECompanionMissionParse Result);

	/**
	 * Contract v0.1 3.7. HttpStatus other than 200 is NotOk (no result, Q22 fail-closed default, also for today's
	 * missing route). wljRunId must be OwnWljRunId byte for byte (a canonical wlj_). result: null or
	 * {untrusted:true, summary <= 4 KiB, artifact:{kind text|patch|json, sha256 64 lowercase hex, byteLength}} with no
	 * "content" (artifact content is never returned on this route). provenance: null or the v0 3.5 object.
	 * result / provenance non-null only in result_received, integrated or rejected (ResultTooEarly otherwise).
	 */
	ECompanionMissionParse ParseCompanionMission(int HttpStatus, std::string_view Body, std::string_view OwnWljRunId,
		FCompanionMissionView& Out);
}

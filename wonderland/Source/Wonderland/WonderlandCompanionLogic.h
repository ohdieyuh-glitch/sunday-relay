// WONDERLAND -- provider-agnostic BYOAI companion terminal and HUD: the client's PURE LOGIC, standard C++17, no Unreal
// include.
//
// ONE ROUTE, MANY AGENTS (founder ruling Sat 2026-10-24 04:53 PT). Aligned with BRIDGE's code at
// bridge/wonderland-julius-companion-route-20261024 @ 7e5e1e30 (docs/companion/universal-companion-contract-v0.2.md,
// relay-bridge/wonderland-companion-route.ts, relay-bridge/wonderland-companion-registry.ts; blobs and lines in the
// README). The player connects THEIR OWN AI agents through ONE universal route. Each agent is a slot keyed by its
// server-assigned agentId, carrying an OPAQUE providerId that this file stores, compares for identity and sends back,
// but never switches on. Provider auth and protocol live in the relay's adapters; no provider name, endpoint, label or
// rule appears in this file (build_and_test.sh lints for it). A generic model is never shown as the player's agent.
//
// WHAT THIS IS. The parts of the companion terminal that must be exactly right and can be proven without an engine:
//   1. FSseParser: a WHATWG text/event-stream parser for an agent's chat stream, robust to any chunk split,
//      CR / LF / CRLF (also a CRLF split across chunks), comments (": ping"), multi-line data, a leading BOM, and
//      oversize lines or events (capped; the parser then fails closed and stays failed).
//   2. ParseJson: a strict RFC 8259 reader (depth cap, duplicate keys refused, no trailing bytes) for event data,
//      status bodies, agent descriptors and result bodies.
//   3. FChatStreamDecoder: the meta / delta / done / error event grammar of contract v0 section 2.1; meta must name
//      the SAME opaque providerId as the agent slot it answers (no substitution).
//   4. ParseAgentDescriptor / ParseAgentList: AgentDescriptor and agents[] (v0.2), fail closed PER SLOT: one bad entry
//      is an error slot of its own and never breaks the other agents or the v0.1 status read. Declared capabilities
//      are informational; only authorized capabilities are shown, and none is ever inferred. "verified" is never
//      shown (no real provider verification exists yet: bAgentVerificationAvailable).
//   5. FCompanionSession: the agent registry. Every agent has its own connection, capabilities, conversation,
//      history, stream and error state, so an unsupported, disconnected, rejected or malformed agent stays contained.
//      OFFLINE until the PLAYER connects their own agent (BYOAI only; no i.Wonder-funded key, endpoint or fallback).
//   6. FMaskedKeyField: masked key entry, wiped. BRIDGE's connect route REFUSES credentials (400
//      companion_credentials_rejected, route.ts:58,288), so the session sends no key at all; the field stays for the
//      adapter auth flow BRIDGE has not specified (open). A key is never stored, logged, traced or shown.
//   7. ParseMissionStatus / FStatusPin: contract v0.1 section 4.2 status body: top-level (a "data" or "phase" key is
//      a fault), field "state" from a closed list, cause omitted or closed, legacyRunId / serverRunId per Q21,
//      dispatchedAt written once, no seq / progress / companion (ignored), poll-only ordering by updatedAt (Q24).
//      The run pin is #444's rule: the client's own wlj_ id, byte for byte (IsClientMintedRunId /
//      IsAcceptedServerRunId). running / completed are withdrawn: the HUD stops at "dispatched".
//   8. FTurnHistory: the server picks the model (the client never sends one), the last 20 turns are kept per agent,
//      and the player can delete them (local copy first, then DELETE on the server's conversation).
//   9. ParseAgentResult / ParseAgentProvenance: agent output is UNTRUSTED, capped at 256 KiB before parsing, never
//      executed; simulated:true is always shown as simulated.
//  10. CompanionMissionRequest / ParseCompanionMission: contract v0.1 section 3.7, the loopback read of an agent's
//      result and provenance (GET .../julius/missions/{wljRunId}/companion), plus v0.2 agents[]. wlj_ only; any
//      non-200 answer, and any body that fails a check, is "no companion result" and never "verified".
//      #447 (081d46e6) adds top-level traceId (string | null): parsed as reported, exactly 32 lowercase hex and not
//      all zero, else no trace id. The client never computes one and never sends one (SameMissionTrace matches it to
//      the #448 result's traceId).
//
// THE CONTRACT this follows is BRIDGE's DRAFT /workspace/bridge/companion-contract-v0.1.md (file written Fri 2026-10-23 22:28 PT),
// which supersedes v0 (~21:50 PT) and answers Q1-Q24 (ANSWERS_FROM_BRIDGE.md), plus the v0.2 interface BRIDGE posted
// in the room on Sat 2026-10-24 (status route + agents[], /companions/agents routes). Where either is ambiguous the
// choice made here is the fail-closed one and the question is written down in OPEN_QUESTIONS_FOR_BRIDGE.md (Qn / An
// numbers are cited inline below). Paths and words marked PROVISIONAL are such guesses, each in exactly one place.
//
//  11. FIdempotencyKeyMinter: x-relay-idempotency-key values, a canonical lowercase UUIDv4 from 16 bytes of a
//      CALLER-INJECTED source (WonderlandJuliusMissionLogic::IRandomBytes16; the UE adapter passes #433's
//      FWonderlandJuliusPlatformCryptoRandom, IPlatformCrypto CreateRandomBytes). A failed or repeating source mints
//      nothing (fail closed, no fallback); the session then refuses the request.
//
// CHAT ANSWERS (BRIDGE, ANSWERS_FROM_BRIDGE.md, contract v0.1) still applied per agent: msg_<uuidv4> message ids (Q1),
// a closed event set with no id:/retry: fields (Q2), meta first on every stream incl. replays with "replayed" (Q3),
// Truncated -> same-key resend, 409 in progress -> 2 s back-off (Q4), max_length finish (Q5), 413/400 (Q6), DELETE
// 409 retried (Q7), Retry-After >= 1 s / retryAfterMs integer-or-absent, 60 s otherwise (Q8), the relay origin taken
// from the J1 endpoint config (Q9), chat never simulated (Q11), sticky rejection cleared only by a successful connect
// answer for that agent (Q12), DELETE without a key (Q13), 422 credential_rejected leaves the old state (Q14).
// Q10 (providers labels[mode]) and Q15 (connections lastErrorKind) belonged to the per-provider routes v0.2 collapses;
// the agent's displayName replaces the label (A10).
//
// WHAT IS NOT HERE. No HTTP, no sockets, no clock, no RNG of its own (randomness only through IRandomBytes16), no
// logging, no Unreal types, no provider names. The Unreal adapter seam is WonderlandCompanionClient.h.
#pragma once

#include "WonderlandJuliusMissionLogic.h"

#include <cstddef>
#include <cstdint>
#include <deque>
#include <memory>
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
	/** Contract 3.4: an agent result body is at most 256 KiB. Checked BEFORE any parsing. */
	inline constexpr std::size_t CompanionResultMaxBytes = 256 * 1024;
	/** Contract 3.4: summary <= 4 KiB (bytes). */
	inline constexpr std::size_t CompanionSummaryMaxBytes = 4 * 1024;
	/** Status and section 3.7 companion bodies are small; anything larger is refused unread. */
	inline constexpr std::size_t StatusMaxBodyBytes = 64 * 1024;
	/** Connect answers, error bodies and provenance bodies. */
	inline constexpr std::size_t ListMaxBodyBytes = 64 * 1024;
	/** Turns kept on the client (and, per the task's default, on the server). Q7. */
	inline constexpr std::size_t HistoryMaxTurns = 20;
	inline constexpr std::size_t JsonMaxDepth = 16;
	/** A display label (agent displayName, self-reported names), bytes. */
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
		 * carry it (Q1 "a replay returns the same id"). ExpectedProviderId: the agent slot's opaque providerId; meta's
		 * "provider" must equal it byte for byte (A7: no substitution). Empty never matches.
		 */
		FChatStreamDecoder(std::string ExpectedProviderId, std::string ExpectedConversationId, bool bReplayResend,
			std::string ExpectedMessageId = std::string());

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
		std::string ExpectedProvider;
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
	 * REVIEW #467 (defense in depth): may a request to Url carry the paired native session? Only when RelayOrigin is a
	 * strict loopback relay origin and Url is exactly that origin followed by a path ('/'): never a look-alike host or port,
	 * never another scheme, never a provider URL a future adapter might hand the client.
	 */
	bool MayCarrySession(std::string_view Url, std::string_view RelayOrigin);
	/**
	 * Q9: the companion's relay origin is the SAME configured endpoint the J1 dispatch path (#433) uses; there is no
	 * discovery and pairing returns no port. Returns J1BaseUrl (one trailing '/' dropped) when it is a strict
	 * loopback origin per IsLoopbackRelayOrigin, else empty: #433 also accepts "localhost", which the companion
	 * refuses (the key never follows a name lookup), so that config keeps the companion Offline.
	 */
	std::string RelayOriginFromJ1Endpoint(std::string_view J1BaseUrl);

	/**
	 * Masked key entry; wiped on Clear and destruction. NOT USED BY THE SESSION at 7e5e1e30: BRIDGE's connect route
	 * refuses credentials (route.ts:58,288) and no route takes a key. Kept for the adapter auth flow BRIDGE has not
	 * specified (OPEN_QUESTIONS); the one-shot handoff that sent a key on connect is removed with that body.
	 */
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
		void Wipe();
		char Buffer[ApiKeyMaxBytes + 1];
		std::size_t Length = 0;
		bool bOverlong = false;
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

	/* ---------------------------------------------------------------- agents (v0.2 interface: AgentDescriptor, agents[]) */

	/** Agents held by one session; a slot past this is counted unreadable, never evicts a known agent. CLIENT CAP: BRIDGE has no limit (open, A15). */
	inline constexpr std::size_t AgentRegistryMaxSlots = 32;
	/** agents[] entries read from one body; one TooMany slot stands for the rest. CLIENT CAP (open, A15). */
	inline constexpr std::size_t AgentListMaxEntries = 64;
	/** providerId: any non-blank string of at most 200 UTF-16 units (route.ts:60 PROVIDER_ID_MAX, :293). Opaque: never parsed, never in a URL. A5. */
	inline constexpr std::size_t ProviderIdMaxUtf16Units = 200;
	/** displayName: null, or a non-blank string; the connect label is capped at 200 UTF-16 units (route.ts:59 DISPLAY_NAME_MAX, :300). The
	 *  adapter's session name has no BRIDGE cap; the client applies the same 200 (open). */
	inline constexpr std::size_t DisplayNameMaxUtf16Units = 200;
	/** adapterVersion: null, or 1-64 printable ASCII. CLIENT GUESS: BRIDGE does not bound it (open). */
	inline constexpr std::size_t AdapterVersionMaxBytes = 64;
	/** One capability word: 1-64 of [A-Za-z0-9_.:-]; at most CapabilityListMaxCount per list. CLIENT GUESS: BRIDGE accepts any non-empty
	 *  string, any count, and defines no vocabulary (registry.ts:357-366; open, A3). */
	inline constexpr std::size_t CapabilityMaxBytes = 64;
	inline constexpr std::size_t CapabilityListMaxCount = 64;
	/** PROVISIONAL (A3): the AUTHORIZED capability that lets the terminal chat with an agent. Never inferred. BRIDGE defines no word. */
	inline constexpr std::string_view CapabilityChat = "chat";
	/** No descriptor carries "verified" (registry.ts:28-37); the mission route's top-level verified is a literal false (route.ts:249). */
	inline constexpr bool bAgentVerificationAvailable = false;
	/** Served at 7e5e1e30 (route.ts:55-57,253-273): POST AgentsPath, GET and DELETE AgentsPath + "/" + agentId, each with ?projectId=. */
	inline constexpr std::string_view AgentsPath = "/companions/agents";
	/** PROVISIONAL (A2), NOT SERVED at 7e5e1e30 (contract:46,139: nothing under {agentId}/ is routed). Used only by a session built with
	 *  bChatRouteServed = true; a default session never sends to them. */
	inline constexpr std::string_view AgentChatSuffix = "/chat";
	inline constexpr std::string_view AgentConversationsSuffix = "/conversations/";

	/** registry.ts:32 kind: "single" | "compound" | null; null reads Unknown (contract:67). */
	enum class EAgentKind : std::uint8_t { Single, Compound, Unknown };
	/** v0.2 connection words, closed: connected | disconnected | unsupported | error. */
	enum class EAgentConnection : std::uint8_t { Connected, Disconnected, Unsupported, Error };

	enum class EAgentSlotFault : std::uint8_t
	{
		None,
		NotObject,
		BadAgentId,
		BadProviderId,
		BadDisplayName,
		BadKind,
		BadAdapterVersion,
		BadDeclaredCapabilities,
		BadAuthorizedCapabilities,
		/** An authorized capability the agent does not declare (A6). */
		AuthorizedNotDeclared,
		BadConnection,
		/** A "verified" key: no AgentDescriptor carries one (registry.ts:28-37). */
		BadVerified,
		/** Breaks what publishAgentDescriptor guarantees (registry.ts:189-214): connected without displayName or kind;
		 *  unsupported / error with a kind or any capability; unsupported with an adapterVersion. */
		InconsistentConnection,
		/** The same agentId twice in one list: every entry with it is an error slot. */
		DuplicateAgentId,
		/** Entries past AgentListMaxEntries. */
		TooMany,
	};
	const char* AgentSlotFaultName(EAgentSlotFault Fault);

	struct FAgentDescriptor
	{
		/** "agt_" + canonical lowercase UUIDv4, minted by the server (registry.ts:21,246). */
		std::string AgentId;
		/** Opaque. Compared for identity, sent back on connect, never displayed, never switched on. */
		std::string ProviderId;
		/** The server's text through SanitizeUntrustedText. Empty = null (rendered as unnamed). */
		std::string DisplayName;
		EAgentKind Kind = EAgentKind::Unknown;
		/** Empty = null. */
		std::string AdapterVersion;
		/** Informational only: never shown as something the agent can do. */
		std::vector<std::string> DeclaredCapabilities;
		/** Server-clamped to a subset of declared (registry.ts:153-163); the only capabilities the HUD shows. */
		std::vector<std::string> AuthorizedCapabilities;
		EAgentConnection Connection = EAgentConnection::Error;
	};

	/** One agents[] entry or connect answer. Fault != None: Connection Error, no capabilities, AgentId kept only if valid. */
	struct FAgentSlot
	{
		FAgentDescriptor Descriptor;
		EAgentSlotFault Fault = EAgentSlotFault::None;
	};

	/** "agt_" + canonical lowercase UUIDv4 (registry.ts:21; route.ts:89-92 answers 404 for anything else). */
	bool IsAgentId(std::string_view Text);
	/** Valid UTF-8, 1-200 UTF-16 units, not blank (route.ts:292-294). */
	bool IsProviderId(std::string_view Text);
	/** Valid UTF-8, 1-200 UTF-16 units, not blank (route.ts:297-301). */
	bool IsAgentDisplayName(std::string_view Text);
	bool IsCapabilityWord(std::string_view Text);
	bool HasCapability(const std::vector<std::string>& List, std::string_view Capability);

	/** One AgentDescriptor object, fail closed per field (see FAgentSlot). Never throws, never touches other slots. */
	FAgentSlot ParseAgentDescriptor(const FJsonValue& Entry);

	enum class EAgentListParse : std::uint8_t
	{
		/** agents[] read; each entry is a slot (possibly an error slot). */
		Ok,
		/** No "agents" key: a v0.1 server. No agents, not a fault (A9). */
		Absent,
		/** "agents" is not an array: no agents; the v0.1 fields are unaffected. */
		NotArray,
	};
	const char* AgentListParseName(EAgentListParse Result);
	/** Root's "agents". Duplicated agentIds are all DuplicateAgentId slots; entries past the cap become one TooMany slot. */
	EAgentListParse ParseAgentList(const FJsonValue& Root, std::vector<FAgentSlot>& Out);

	/* ---------------------------------------------------------------- the session: an agent registry */

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
		/** No usable connection: not connected, key rejected, unsupported, chat not authorized, or no loopback relay. */
		Offline,
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
		/** Includes connection "error", a malformed slot and a changed identity. */
		Error,
	};

	enum class EOfflineReason : std::uint8_t
	{
		None, NotConnected, KeyRejected, Unsupported, NotAuthorized, RelayNotLoopback,
		/** Connected and chat-authorized, but this relay serves no chat route (7e5e1e30: contract:46,139). */
		ChatNotServed,
		/** No query-safe projectId: every agent route needs ?projectId= (admission-route.ts:288). */
		NoProject,
	};

	/** What the HUD shows for ONE agent. Only authorized capabilities; never declared ones, never inferred ones. */
	struct FAgentView
	{
		std::string AgentId;
		/** The server's displayName, sanitized; empty when null or for a malformed slot. */
		std::string DisplayName;
		EAgentKind Kind = EAgentKind::Unknown;
		std::string AdapterVersion;
		EAgentConnection Connection = EAgentConnection::Error;
		/** authorizedCapabilities, only while the agent is really connected; empty otherwise. */
		std::vector<std::string> AuthorizedCapabilities;
		/** Always false: nothing in BRIDGE's code verifies an agent. */
		bool bVerified = false;
		/** The last descriptor for this agentId failed a check (or its providerId changed): fail closed. */
		bool bMalformed = false;
		ECompanionState State = ECompanionState::Offline;
		EOfflineReason Offline = EOfflineReason::NotConnected;
		/** Contract 2.3 "Terminal shows" text, or a fixed line. Never contains provider or companion output. */
		std::string StatusLine;
		/** provider_refused only: the provider's refusal, sanitized, as given. */
		std::string RefusalText;
		/** Streaming: the reply so far (sanitized). */
		std::string PartialReply;
		/** Contract 3.5: the SIMULATED banner shows whenever this agent has no real connection. */
		bool bShowSimulatedBanner = true;
		bool bCanConnect = false;
		bool bCanSend = false;
		bool bCanResend = false;
		std::uint64_t RetryNotBeforeMs = 0;
	};

	/** Session-wide lines: the relay origin, an agent connect in flight, its outcome notice, unreadable slots. */
	struct FCompanionSessionView
	{
		bool bOriginOk = false;
		bool bProjectOk = false;
		bool bConnecting = false;
		bool bCanConnect = false;
		/** Not loopback / Connecting / the last connect notice (Q14) / a key-mint failure. Never key material. */
		std::string StatusLine;
		std::size_t AgentCount = 0;
		/** Slots of the last applied list that had no usable agentId (or did not fit the registry). */
		std::size_t UnreadableSlots = 0;
		/** True unless at least one agent has a real connection. */
		bool bShowSimulatedBanner = true;
	};

	class FCompanionSession
	{
	public:
		/**
		 * RelayOrigin: "http://127.0.0.1:<port>" or "http://[::1]:<port>". Anything else: permanently Offline.
		 * ProjectId: the paired project, 1-64 of [A-Za-z0-9_-]; every agent route carries it as ?projectId= (the
		 * dispatch guard refuses a missing or other one, admission-route.ts:288). Anything else: nothing is sent.
		 * bChatRouteServed: false at 7e5e1e30 (no chat route exists); only then can CanChat be true.
		 */
		explicit FCompanionSession(std::string RelayOrigin, std::string ProjectId = std::string(), bool bChatRouteServed = false);

		const std::string& RelayOrigin() const { return Origin; }

		/* agents (v0.2 status route agents[], or any list of descriptors). Upsert per agentId; a slot never touches another. */
		void ApplyAgentSlots(const std::vector<FAgentSlot>& Slots);
		/** Registry order (first seen first). */
		std::vector<std::string> AgentIds() const;
		/** nullptr for an agentId the session does not hold. */
		const FAgentView* View(std::string_view AgentId) const;
		/** The opaque providerId of a held agent (a reconnect is a new BeginConnect, which mints a new agentId), or empty. */
		std::string ProviderIdOf(std::string_view AgentId) const;
		const FCompanionSessionView& SessionView() const { return SessionViewState; }

		/*
		 * connect (A1): POST AgentsPath?projectId= {providerId[, wljRunId][, displayName]} (route.ts:275-323,
		 * contract:111-131). NO key, NO credential field (the route refuses apiKey/token/password), NO idempotency key
		 * (every POST mints a new slot, registry.ts:246). WljRunId: empty or this client's canonical wlj_. DisplayLabel:
		 * empty, or IsAgentDisplayName. The server picks the adapter; an unknown providerId answers 201 "unsupported".
		 */
		bool BeginConnect(std::string_view ProviderId, std::string_view WljRunId, std::string_view DisplayLabel, FRelayRequest& Out);
		/** 201 + AgentDescriptor only (route.ts:319). */
		void ApplyConnectAnswer(int HttpStatus, std::string_view Body, std::uint64_t NowMs);
		/** The agentId of the last connect answer that registered a slot, or empty. */
		const std::string& LastConnectedAgentId() const { return LastConnected; }
		/** GET AgentsPath/{agentId}?projectId= (route.ts:325-337): 200 descriptor, 404 not found. */
		FRelayRequest BeginReadAgent(std::string_view AgentId);
		void ApplyReadAgentAnswer(std::string_view AgentId, int HttpStatus, std::string_view Body);
		/** DELETE AgentsPath/{agentId}?projectId=, no key, no body (Q13; route.ts:339-351). */
		FRelayRequest BeginDisconnect(std::string_view AgentId);
		/** 200 + the descriptor, connection "disconnected" (registry.ts:272-283); 404: the slot is gone. */
		void ApplyDisconnectAnswer(std::string_view AgentId, int HttpStatus, std::string_view Body);
		/** The adapter's FIdempotencyKeyMinter failed (no secure random): nothing is sent, a fixed error is shown. */
		void ApplyKeyMintFailure(std::string_view AgentId = std::string_view());

		/* chat (contract 2.1) on ONE agent. WljRunId: empty, or this client's own canonical wlj_ id (legacy: refused). */
		bool BeginMessage(std::string_view AgentId, std::string_view Message, std::string_view IdempotencyKey, std::string_view WljRunId,
			std::uint64_t NowMs, FRelayRequest& Out);
		/** A non-SSE answer to the chat POST (any status other than 200 text/event-stream). */
		void ApplyChatHttpAnswer(std::string_view AgentId, int HttpStatus, std::string_view RetryAfterHeader, std::string_view Body,
			std::uint64_t NowMs);
		/** 200 text/event-stream body bytes, as they arrive. */
		void FeedChatBytes(std::string_view AgentId, std::string_view Chunk, std::uint64_t NowMs);
		void FinishChatStream(std::string_view AgentId, std::uint64_t NowMs);
		/** No HTTP answer at all (connection reset, timeout before headers). */
		void ApplyChatTransportFailure(std::string_view AgentId, std::uint64_t NowMs);
		/** Resend the last message with the SAME key (contract 2.1 replay). Only after a broken or unanswered stream. */
		bool BeginResend(std::string_view AgentId, std::uint64_t NowMs, FRelayRequest& Out);

		/* history (contract 2.2), per agent */
		/** nullptr for an unknown agent. */
		const FTurnHistory* History(std::string_view AgentId) const;
		/** Clears the agent's local turns at once. Out is the server DELETE, or Method empty when there is none. */
		FRelayRequest BeginDeleteHistory(std::string_view AgentId);
		void ApplyDeleteHistoryAnswer(std::string_view AgentId, int HttpStatus);
		std::string ConversationId(std::string_view AgentId) const;

		/** Event words only; never text, never key material, never an agentId or providerId. */
		const std::vector<std::string>& Trace() const { return TraceLines; }

	private:
		struct FAgent
		{
			FAgentDescriptor Descriptor;
			EAgentSlotFault Fault = EAgentSlotFault::None;
			/** Sticky: a later descriptor for this agentId named another providerId. */
			bool bIdentityChanged = false;
			/** Sticky until a successful connect answer for THIS agent: provider_auth_failed (Q12). */
			bool bKeyRejected = false;
			ECompanionState Transient = ECompanionState::Ready;
			const char* TransientLine = nullptr;
			std::string Refusal;
			std::uint64_t RetryNotBefore = 0;
			bool bStreaming = false;
			FChatStreamDecoder Decoder{std::string(), std::string(), false};
			std::string PendingMessage;
			std::string PendingKey;
			std::string PendingRunId;
			std::string PendingConvSent;
			/** What an earlier attempt of the pending key showed in meta (Q1, Q3): a resend's replay must match it. */
			std::string PendingConvSeen;
			std::string PendingMsgSeen;
			bool bResendAllowed = false;
			std::string ConvId;
			/** A conversation whose server DELETE has not been confirmed yet; BeginDeleteHistory resends it. */
			std::string DeletePendingConv;
			FTurnHistory Turns;
			FAgentView View;
		};

		FAgent* Find(std::string_view AgentId);
		const FAgent* Find(std::string_view AgentId) const;
		/** nullptr when the registry is full. */
		FAgent* FindOrAdd(const std::string& AgentId);
		/** Applies one well-formed or malformed slot to its agent. False if the identity check refused it. */
		bool ApplySlot(FAgent& A, const FAgentSlot& Slot);
		bool IsReal(const FAgent& A) const;
		bool IsChatAuthorized(const FAgent& A) const;
		bool CanChat(const FAgent& A) const;
		/** A 200 / 404 answer says the slot is (or is now) disconnected: no capabilities, nothing in flight. */
		void ForceDisconnected(FAgent& A);
		void Recompute(FAgent& A);
		void RecomputeSession();
		void SetError(FAgent& A, const char* Line, const char* TraceWord);
		void ApplyStreamOutcome(FAgent& A, std::uint64_t NowMs);
		void Note(std::string Word);
		std::string Url(std::string_view Path) const;
		/** Origin + base + AgentsPath + "/" + agentId + Suffix + "?projectId=" + ProjectId. */
		std::string AgentUrl(const FAgent& A, std::string_view Suffix) const;

		std::string Origin;
		bool bOriginOk = false;
		std::string Project;
		bool bProjectOk = false;
		bool bChatServed = false;
		std::vector<std::unique_ptr<FAgent>> Agents;
		std::size_t UnreadableSlots = 0;
		bool bConnecting = false;
		std::string ConnectingProviderId;
		/** Session-wide notice: the last connect's outcome (Q14), or a key-mint failure. Never key material. */
		const char* Notice = nullptr;
		std::string LastConnected;
		std::vector<std::string> UsedKeys;
		FCompanionSessionView SessionViewState;
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

	/* ---------------------------------------------------------------- agent result and provenance (contract 3.4, 3.5) */

	enum class EArtifactKind : std::uint8_t { Text, Patch, Json };

	struct FAgentResultView
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
	EResultParse ParseAgentResult(std::string_view Body, std::string_view OwnWljRunId, FAgentResultView& Out);

	/** wakeId on the mission route: CLIENT CAP, BRIDGE only requires a string (route.ts:598; open). */
	inline constexpr std::size_t ProvenanceWakeIdMaxBytes = 256;

	struct FAgentProvenanceView
	{
		bool bSimulated = true;
		/** v0 3.5 body only; never true on the mission route (BRIDGE has no verifiedBy, route.ts:604). */
		bool bVerifiedByTokenRoundTrip = false;
		std::string SelfReportedName;
		/** v0 3.5 resultSha256, or the mission route's contentSha256 (== artifact.sha256). */
		std::string ResultSha256;
		/** Mission route only (route.ts:107-112): wakeId (sanitized) and bodyDigest; empty when null. */
		std::string WakeId;
		std::string BodyDigest;
	};

	enum class EProvenanceParse : std::uint8_t { Ok, TooLarge, BadJson, BadSource, SimulatedInconsistent, SimulatedVerified, BadFields };
	/**
	 * The v0 3.5 provenance body. "source" is "companion_port" or "simulated", the closed set of BRIDGE's mission
	 * provenance (route.ts:108; A8). simulated must agree with source; verifiedBy only "task_token_round_trip" and
	 * never with simulated.
	 */
	EProvenanceParse ParseAgentProvenance(std::string_view Body, FAgentProvenanceView& Out);

	/** "cmp_" + canonical lowercase UUIDv4. */
	bool IsCompanionTaskId(std::string_view Text);

	/* ---------------------------------------------------------------- agent result read route (contract v0.1 3.7 + v0.2 agents[]) */

	/** Contract v0.1 3.6 terminal: delivery_failed, integrated, rejected, timed_out, no_result, cancelled. */
	bool IsTerminalCompanionState(ECompanionTaskState State);

	/**
	 * GET /relay-api/wonderland/julius/missions/{wljRunId}/companion?projectId=.. (contract v0.1 3.7, Q22). wlj_ ONLY:
	 * a legacy run: id, any other form, a bad ProjectId (1-64 of [A-Za-z0-9_-]) or a non-loopback origin gives an
	 * empty Method (send nothing).
	 */
	FRelayRequest CompanionMissionRequest(std::string_view RelayOrigin, std::string_view WljRunId, std::string_view ProjectId);

	/**
	 * #447 081d46e6: the companion GET 200 carries top-level "traceId": string | null, derived by BRIDGE from the row's
	 * wljRunId (julius-mission-trace.mjs). The client PARSES it and never computes, repairs or invents one. Absent (a
	 * route before #447), null, or anything but 32 lowercase hex that is not all zero is no trace id, and never fails the
	 * v0.1 read. The 404 body has no traceId; a non-200 answer is never read for one.
	 */
	enum class ETraceIdParse : std::uint8_t { Absent, Null, Ok, Malformed };
	const char* TraceIdParseName(ETraceIdParse Result);
	/** 32 lowercase hex, not all zero (W3C trace-id). */
	bool IsMissionTraceId(std::string_view Text);
	/** Reads Root["traceId"]. Out is set only on Ok and is empty otherwise. */
	ETraceIdParse ParseMissionTraceId(const FJsonValue& Root, std::string& Out);

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
		FAgentProvenanceView Provenance;
		/** Always false: the route's top-level verified is a literal false (route.ts:249) and provenance carries none. */
		bool bShowVerified = false;
		std::uint64_t UpdatedAtMs = 0;
		/**
		 * #447 traceId as BRIDGE reported it. TraceId is non-empty only when bHasAnswer and TraceIdParse == Ok; a body
		 * that fails any v0.1 check exposes no trace id. Shown as text; never sent back, never used as an id.
		 */
		ETraceIdParse TraceIdParse = ETraceIdParse::Absent;
		std::string TraceId;
		/**
		 * v0.2 agents[], read on its own: filled whenever the body is JSON for THIS wljRunId, even if a v0.1 field
		 * fails (and an agents[] problem never fails the v0.1 read). Feed it to FCompanionSession::ApplyAgentSlots.
		 */
		EAgentListParse AgentsParse = EAgentListParse::Absent;
		std::vector<FAgentSlot> Agents;
	};

	enum class ECompanionMissionParse : std::uint8_t
	{
		Ok, NotOk, TooLarge, BadJson, RunIdMismatch, BadTaskId, BadState, BadResult, BadProvenance, ResultTooEarly,
		BadUpdatedAt,
		/** Top-level "verified" missing or anything but false (route.ts:249). */
		BadVerified,
	};
	const char* CompanionMissionParseName(ECompanionMissionParse Result);

	/**
	 * Contract v0.1 3.7. HttpStatus other than 200 is NotOk (no result, Q22 fail-closed default, also for today's
	 * missing route). wljRunId must be OwnWljRunId byte for byte (a canonical wlj_). result: null or
	 * {untrusted:true, summary <= 4 KiB, artifact:{kind text|patch|json, sha256 64 lowercase hex, byteLength}} with no
	 * "content" (artifact content is never returned on this route). provenance: null or BRIDGE's object
	 * {source companion_port|simulated, wakeId string|null, bodyDigest 64-hex|null, contentSha256 64-hex}, with no
	 * verified / verifiedBy (route.ts:107-112,593-611); non-null only with a result, contentSha256 == artifact.sha256
	 * (route.ts:246,603). result / provenance non-null only in result_received, integrated or rejected (ResultTooEarly
	 * otherwise). verified: literal false (route.ts:249). "agents" (optional) is parsed per slot into Out.Agents first,
	 * and never changes the returned value.
	 */
	ECompanionMissionParse ParseCompanionMission(int HttpStatus, std::string_view Body, std::string_view OwnWljRunId,
		FCompanionMissionView& Out);

	/**
	 * True only when the companion read for OwnWljRunId exposed a trace id and it equals ResultTraceId (the #448 mission
	 * result's top-level traceId) byte for byte. Two missing ids never match; a malformed ResultTraceId never matches.
	 */
	bool SameMissionTrace(const FCompanionMissionView& Companion, std::string_view ResultTraceId);
}

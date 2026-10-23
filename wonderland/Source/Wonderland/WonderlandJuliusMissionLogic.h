// WONDERLAND -- J1 in-world mission: the client's PURE LOGIC, in standard C++17 with no Unreal include.
//
// WHAT THIS IS. The pieces of the J1 client that must be exactly right and can be proven without an engine:
// SHA-256 (FIPS 180-4), the JavaScript String.prototype.trim whitespace set over UTF-8, the 12-hex artifact digest
// check, the result-body check, and the run-id format. Every function is deterministic and does no I/O.
//
// WHY ITS OWN SHA-256. On UE 5.8 the engine's FPlatformMisc::GetSHA256Signature is the generic checkf(false) one
// (see the note in WonderlandEosVoice.cpp), so the client carries its own. It is checked against the NIST FIPS 180-2
// example vectors and Node's crypto in wonderland/Tools/j1_logic_kat.cpp and
// src/relay/mission/wonderland/wonderland-j1-logic.test.ts.
//
// THE BRIDGE CONTRACT this follows is relay-bridge/julius-dispatch.ts at commit 31bfc58b (blob 018fb582):
//   - the result route answers {data:{runId,state,mode,resultText,resultSha256}} (:913), where resultSha256 is the
//     sha256 of the resultText string's UTF-8 bytes (:628-631); runId, state and mode outside resultText are NOT
//     covered by that hash, so the client checks them against the hashed copies inside resultText (:624-626);
//   - inside resultText, artifactSha256 is the sha256 of artifactText (:627). The bridge produced that text in this
//     order: scrubKeys removes key values, then cuts to J1_TEXT_MAX_CHARS = 8,000 UTF-16 code units with
//     String.prototype.slice (:55, :333-337), which can split a surrogate pair, then the coder's text is
//     JavaScript-trimmed once (:527-530). It is null when the coder produced no artifact;
//   - a finished run that did not succeed still answers 200, with a non-null `failure` word (:615-627);
//   - every refusal is {error:{kind,message}} (:952), and there is no frozen list of kinds.
// The client therefore compares its digest ONLY with the artifactSha256 carried in resultText, never with any
// ledger value, and treats any error object with a kind, known or not, as a refusal, except a 429 whose kind is not
// one of J1's two pre-chain caps (RID-6, rule 2a of ClassifyDispatchAnswer).
//
// RUN IDS ARE CLIENT-MINTED. Founder ruling (c), 07:27 PT 2026-10-23, DECIDED, recorded verbatim in YUJI's resolutions
// rev 7 (af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md, blob cf528758, [FR-c]; R4-F likewise as [FR-R4F]): a lowercase,
// cryptographically random UUIDv4 per attempt, with a fresh run id AND a fresh idempotency key after any refusal.
// The bridge at 31bfc58b mints no run id the game can reach: its only run-creating route is operator-only, and J1's
// run lookup is a frozen stub that answers READY for any runId (C2/J1 resolutions, conflict 2). The bridge checks the
// run id against ^[A-Za-z0-9:_-]{1,128}$ (:962) and the x-relay-idempotency-key header against ^[A-Za-z0-9_-]{8,80}$
// (:964, :1007). A run id it has seen only in a run_refused row is ADMITTED again (:773-776), so the
// fresh-after-refusal rule is the client's to keep: FDispatchAttemptTracker keeps it.
//
// WHAT IS NOT HERE. No random number SOURCE: the bytes come in through IRandomBytes16, so the known-answer test is
// deterministic. No HTTP, no JSON parsing, no logging, no display. The Unreal wrapper that parses the JSON and draws
// rows is later work.
//
// WHAT THE UNREAL JSON WRAPPER MUST DO (later work; these functions take UTF-8 bytes and cannot do it for it):
//   1. LONE SURROGATES DECODE TO U+FFFD. The 8,000-unit cut can end the artifact on a lone high surrogate (for
//      example 'x'*7999 + U+1F600 keeps 'x'*7999 + \uD83D), and coder output can carry a lone surrogate anywhere.
//      Node hashes the string with update(value,'utf8') (:328, :627), which encodes every lone surrogate as the
//      UTF-8 of U+FFFD, EF BF BD; JSON.stringify (:630) sends it as the six-character escape \ud83d. So the wrapper
//      must decode every lone \uD800-\uDFFF escape in artifactText to U+FFFD (EF BF BD) before it calls
//      CheckArtifactDigest or ClassifyFinishedResult: never to the WTF-8/CESU-8 bytes (ED A0 BD), which JsTrimUtf8
//      refuses as malformed, and never to '?' or nothing. Otherwise a legitimate COMPLETED run shows as "arrived
//      damaged" (this fails closed; it can never pass a wrong artifact). The KAT-DIGEST-CUT rows in
//      wonderland/Tools/j1_logic_kat.cpp pin both forms against Node. resultText itself carries the escape as six
//      ASCII characters, so CheckResultBody over the received resultText string is unaffected.
//   2. THE DIGEST CHECK RE-TRIMS. CheckArtifactDigest computes sha256(UTF-8(JS-trim(ArtifactText))), not the hash of
//      the bytes exactly as received: JS whitespace around the text (KAT rows untrimmed_text_ok and
//      completed_untrimmed_text_ok) still verifies. On real bridge output the re-trim changes nothing, because J1
//      sends the already-trimmed text (:530) and hashes it as-is (:627), and trim is idempotent. The exact bytes are
//      bound by resultSha256 over resultText instead, so the wrapper must reach ClassifyFinishedResult only after
//      ClassifyResultEnvelope returned BodyIntact, and must display the artifactText it parsed from that resultText.
//   3. CHECK missionId. ClassifyFinishedResult does not see resultText's missionId or dispatchId (:625). The wrapper
//      must compare missionId with the mission it triggered and treat any other value as a wrong run, never as a
//      success.
//   4. A CSPRNG BEHIND IRandomBytes16 (YUJI's client requirement). In production the 16 bytes come ONLY from
//      Unreal's IPlatformCrypto (the PlatformCrypto plugin's encryption context, CreateRandomBytes) or from OpenSSL
//      RAND_bytes, and Fill returns true only when that call reported success (EPlatformCryptoResult::Success, or
//      RAND_bytes returning 1). CreateRandomBytes, never CreatePseudoRandomBytes. The production source and the
//      PlatformCrypto or OpenSSL dependency in Wonderland.Build.cs are wrapper work with their own review. On any
//      failure Fill returns false and MintAttempt answers RandomUnavailable: the attempt is REFUSED, no id is
//      produced, and there is NO fallback to any other source. NEVER FGuid::NewGuid or
//      FPlatformMisc::CreateGuid (not a documented CSPRNG, and FGuid's text layout reorders digits), and never
//      FMath::Rand, FRandomStream, std::rand, std::mt19937, std::random_device, a timestamp or a counter. This
//      supersedes the BCryptGenRandom wording of docs/j1_client_plan.md 5a. Run ids and keys carry nothing derived:
//      no player, session, mission, machine, time or counter.
//   5. ONE TRACKER PER SESSION, AND ITS VERDICT IS FINAL. Every dispatch POST goes through
//      FDispatchAttemptTracker::BeginAttempt, and every answer, or the lack of one, goes back through RecordAnswer.
//      A verdict other than Admitted means nothing is sent; the wrapper logs one refused line. After
//      PreviousAttemptUnanswered it resends only the open pair; after any other verdict it mints again.
//      Every HTTP answer goes through ClassifyDispatchAnswer; only a CONCLUSIVE refusal calls for a fresh pair.
//      The tracker lives in memory: an attempt still unanswered when the session ends is forgotten, and the next
//      session's fresh pair may meet a chain the first one started. While an attempt stays unanswered, no new
//      attempt is admitted; the wrapper shows that as its own state ("waiting for the bridge; resending the same
//      request"), never as a refusal. Persisting the open pair across sessions is wrapper work, not done here.
//      RESEND BACKOFF (RID-6): the wrapper WAITS before each resend of the open pair, with a growing delay and a cap,
//      never in a tight loop. A 429 julius_dispatch_busy lasts while J1 is still writing the first request's ledger
//      rows or a chain is running (:760-761, :879), so resending at once only meets it again. Only the identical
//      pair is ever resent; the wait never ends in a fresh pair. The numbers are NextResend (RID-7) below: 2 s
//      doubling to a 30 s cap per wait, at most 8 resends and 180 s in all. Then it answers StillWaiting, which is
//      terminal: nothing more is sent, the pair stays open, the wrapper shows "still waiting for the bridge", and
//      nothing is minted.
//   6. NO TRANSFORM EVIDENCE EXISTS YET (ruling R4-F). At 31bfc58b neither resultText (:624-628) nor the result body
//      (:913) carries anything that confirms the ORIGINAL artifact or the exact scrub-cut-trim transformation: the
//      roles summaries hold outputSha256/outputChars of the text AFTER that transformation (:586-590), and the pre-
//      transformation evidence (artifactJudgedSha256 and the like, :556) lives in the ledger only. So the wrapper
//      passes an EMPTY FTransformEvidence until a reviewed contract change carries evidence the client can
//      authenticate, and a scrubbed or cut artifact is therefore never shown as qualifying. A flag the client cannot
//      authenticate is spoofable and does not count as evidence. FTransformEvidence is CALLER-ASSERTED: wiring any
//      value into it needs an authenticated evidence format whose verification lives in this logic, reviewed as a
//      contract change. Until then it stays empty.
//   7. TRIMMING CAN HIDE A SCRUB AS WELL AS A CUT. J1 cuts at 8,000 units (:337) and then trims (:530), so leading or
//      trailing whitespace can leave fewer than 8,000 units, and a cut can leave only part of the [redacted]
//      marker. Example: " " + 7,994 x + a key gives 7,999 units ending "x[reda": no marker, under the limit. The
//      client can detect neither, so NoTransformSignal never proves that nothing was scrubbed or cut, and only the
//      independent judge can pass anything under R4-F. The wrapper shows NoTransformSignal as "pending judge"
//      (QualificationDisplayLabel), never as qualifying or eligible.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace WonderlandJuliusMissionLogic
{
	using FSha256Digest = std::array<std::uint8_t, 32>;

	/** SHA-256 (FIPS 180-4) of exactly these bytes. Data may be null when Length is 0. */
	FSha256Digest Sha256(const std::uint8_t* Data, std::size_t Length);
	FSha256Digest Sha256(std::string_view Bytes);

	/** 64 lowercase hex characters. */
	std::string HexLower(const FSha256Digest& Digest);
	std::string Sha256Hex(std::string_view Bytes);

	/** True only for exactly 64 characters of [0-9a-f]. Uppercase is refused: the bridge emits lowercase. */
	bool IsLowerHex64(std::string_view Text);

	/** Whether this code point is in the JavaScript String.prototype.trim set (WhiteSpace + LineTerminator). */
	bool IsJsTrimWhitespace(char32_t CodePoint);

	/**
	 * JavaScript trim over UTF-8. False (and Out cleared) when the input is not well-formed UTF-8: overlong forms,
	 * surrogates, code points above U+10FFFF and truncated sequences are all refused rather than guessed at. A lone
	 * surrogate from the bridge must reach this function as U+FFFD (EF BF BD); see the wrapper note at the top.
	 */
	bool JsTrimUtf8(std::string_view Utf8, std::string& Out);

	/**
	 * THE ARTIFACT DIGEST. sha256 over the UTF-8 bytes of JS-trim(ArtifactText) must equal ExpectedArtifactSha256
	 * (the artifactSha256 inside resultText). On success OutDigest12 is its first 12 hex characters, the only form
	 * the game shows; on any failure OutDigest12 is empty and the caller shows "arrived damaged". It trims again
	 * before hashing (wrapper note 2) and needs lone surrogates already decoded to U+FFFD (wrapper note 1).
	 */
	bool CheckArtifactDigest(std::string_view ArtifactText, std::string_view ExpectedArtifactSha256, std::string& OutDigest12);

	/**
	 * THE RESULT-BODY CHECK. sha256 over the UTF-8 bytes of the resultText string must equal resultSha256. The
	 * result hash is checked, never returned: it is NEVER shown or labelled as the artifact hash.
	 */
	bool CheckResultBody(std::string_view ResultText, std::string_view ExpectedResultSha256);

	enum class EResultEnvelope : std::uint8_t
	{
		/** 200, a data object, no error object, and resultText hashes to resultSha256. */
		BodyIntact,
		/** An error object was present: any kind, recognised or not. Shown from the kind only, never as success. */
		Refused,
		/** Not 200 without an error object, or 200 without a data object: "could not read". */
		Unreadable,
		/** resultText does not hash to resultSha256, or resultSha256 is not 64 lowercase hex. */
		Damaged,
		/** data.runId is not the run this client dispatched. */
		WrongRun,
	};

	/**
	 * Classifies the result route's answer from fields the caller's JSON parser extracted. The error kind is never
	 * matched against a list: its presence alone is a refusal, so a kind nobody has named yet cannot read as success.
	 */
	EResultEnvelope ClassifyResultEnvelope(int HttpStatus, bool bHasData, bool bHasError, std::string_view ErrorKind,
		std::string_view DataRunId, std::string_view ExpectedRunId, std::string_view ResultText, std::string_view ResultSha256);

	/**
	 * The fields the client acts on. Inner* and the unprefixed fields come from the parsed resultText (hash-covered);
	 * Data* come from the unhashed data object around it (:913). Null JSON values are carried by the flags.
	 */
	struct FFinishedResultFields
	{
		std::string_view ExpectedRunId;
		std::string_view ExpectedMode;
		std::string_view DataState;
		std::string_view DataMode;
		std::string_view InnerRunId;
		std::string_view Mode;
		bool bFailureIsNull = true;
		std::string_view Failure;
		std::string_view State;
		bool bArtifactSha256IsNull = true;
		std::string_view ArtifactSha256;
		bool bArtifactTextIsNull = true;
		std::string_view ArtifactText;
	};

	enum class EFinishedResult : std::uint8_t
	{
		/** failure null, state COMPLETED, and the artifact digest verified. The only success. */
		Completed,
		/** A non-null failure word (any word, recognised or not), or a state other than COMPLETED. Never PASS. */
		FailureOutcome,
		/** No failure, but artifactSha256 or artifactText is null: nothing can be verified, so nothing is shown. */
		NoArtifact,
		/** The artifact text does not hash to artifactSha256, or data.state/data.mode disagree with resultText. */
		Damaged,
		/** resultText names a run other than the one this client dispatched. */
		WrongRun,
		/** resultText's mode (live/fake) is not this build's mode: a fake answer is never shown as live, nor the reverse. */
		ModeMismatch,
	};

	/**
	 * Call only after ClassifyResultEnvelope returned BodyIntact. OutDigest12 is set only for Completed. missionId and
	 * dispatchId are not inputs: the wrapper checks missionId itself (wrapper note 3).
	 */
	EFinishedResult ClassifyFinishedResult(const FFinishedResultFields& Fields, std::string& OutDigest12);

	/** The fixed run-id prefix: a build constant, the same for every run and every player. */
	inline constexpr std::string_view RunIdPrefix = "wlj_";

	/**
	 * `wlj_` + an RFC 4122 version-4 layout of these 16 bytes, formatted straight from the bytes in order (never via
	 * FGuid, whose Windows layout reorders digits). The caller supplies the bytes; generating them is not done here.
	 */
	std::string FormatRunIdFromBytes(const std::uint8_t (&Bytes)[16]);

	/** ^(wlj_)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ */
	bool IsStrictRunId(std::string_view RunId);

	/** The bridge's own run-id rule, ^[A-Za-z0-9:_-]{1,128}$ (julius-dispatch.ts:962 at 31bfc58b). */
	bool IsBridgeRunId(std::string_view RunId);

	/* ---------------------------------------------------------------- client-minted run ids, ruling (c) */

	/**
	 * The canonical lowercase RFC 4122 / RFC 9562 version-4 UUID of these 16 bytes, in byte order: byte 6 gets the
	 * version nibble 4 and byte 8 the variant bits 10. 36 characters, 122 of the 128 input bits kept. Node's
	 * crypto.randomUUID() has exactly this shape. FormatRunIdFromBytes is RunIdPrefix + this.
	 */
	std::string FormatUuidV4FromBytes(const std::uint8_t (&Bytes)[16]);

	/** ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$: no prefix, lowercase only. */
	bool IsCanonicalUuidV4(std::string_view Text);

	/** The bridge's idempotency-key rule, ^[A-Za-z0-9_-]{8,80}$ (julius-dispatch.ts:964, checked at :1007). */
	bool IsBridgeIdempotencyKey(std::string_view Key);

	/**
	 * The ONLY way randomness reaches this logic. Fill writes 16 bytes and returns true, or returns false when no
	 * cryptographically secure bytes could be had: then the attempt is refused and nothing is minted, with no
	 * fallback. Production: IPlatformCrypto CreateRandomBytes or OpenSSL RAND_bytes; see wrapper note 4.
	 * Tests: a fixed byte script, so every minted id is a known answer.
	 */
	class IRandomBytes16
	{
	public:
		virtual ~IRandomBytes16() = default;
		virtual bool Fill(std::uint8_t (&OutBytes)[16]) = 0;
	};

	/** One dispatch attempt: the runId in the POST body and the x-relay-idempotency-key header. */
	struct FDispatchAttempt
	{
		std::string RunId;
		std::string IdempotencyKey;
	};

	enum class EMintResult : std::uint8_t
	{
		/** Out holds a fresh run id (RunIdPrefix + UUIDv4 of the first 16 bytes) and key (UUIDv4 of the next 16). */
		Minted,
		/** The random source reported failure: the attempt is REFUSED, Out stays empty, and there is no fallback. */
		RandomUnavailable,
		/** The bytes repeat a value already used, or the run id and key came out equal: the source is broken. */
		RandomRepeated,
	};

	/**
	 * How the bridge answered one dispatch POST. An error kind is matched against a list ONLY in rule 2a, and only to
	 * let a 429 refuse; a kind nobody has listed never refuses on a 429.
	 *
	 * THE CLASSIFICATION RULE (bHasError: the body has an error object; ErrorKind: its kind, empty when absent):
	 *   1. 200-299, no error object and no kind ............................................. Accepted
	 *   2. 400-599, an error object WITH a non-empty kind ...................................... Refused
	 *  2a.    except 429: Refused only for kind julius_dispatch_cap_reached or julius_dispatch_mission_cap_reached
	 *         (exact bytes); any other 429 kind, julius_dispatch_busy included, is ..................... NoAnswer
	 *   3. everything else ................................................................... NoAnswer
	 * J1 sends every refusal as {error:{kind,message}} with a 4xx or 5xx status (:952 err, refuse), including its
	 * own 503s (julius_dispatch_disabled, julius_dispatch_ledger_unavailable, ...), so rule 2 is conclusive. A bare
	 * 5xx, any status with no error object outside 2xx (3xx, 4xx, 1xx, 0), an error object without a kind, a kind
	 * without an error object, an error on a 2xx, a status outside 100-599, a transport failure or a timeout does not
	 * say whether J1 refused or started the run: it may already have reserved the run, so minting a fresh pair could
	 * start a second paid chain. Those are NoAnswer: the attempt stays open, only the identical pair may be resent,
	 * and J1 answers that resend with a replay (200, :743-745) or a conclusive refusal.
	 * RID-6 (Skywalker on 8c92608a, reproduced on J1's own code). J1 at 31bfc58b sends exactly three 429 kinds:
	 *   julius_dispatch_busy (:760): taken while ANY request is reserving or a chain is running (inFlight is set at
	 *     :761 and cleared only when the chain ends, :879, or when nothing started, :882). It can answer the identical
	 *     pair's resend while J1 is still writing the FIRST send's ledger rows, and that first send then returns 202
	 *     and starts. Busy never proves this pair started nothing, so it is NoAnswer, on a first send or a resend.
	 *   julius_dispatch_cap_reached (:780) and julius_dispatch_mission_cap_reached (:781): returned inside the
	 *     reservation before run_created (:848) and run_start (:854) are written and before records.set and runChain
	 *     (:873, :877), so the request that drew them started nothing (started stays false, :762, :876); a resend of
	 *     a pair that did start meets the replay (:742-745) or julius_dispatch_already_dispatched (:776) first. They
	 *     are conclusive: Refused.
	 * A 429 kind not named here is NoAnswer: failing closed on a 429 means never minting a fresh pair.
	 */
	enum class EDispatchAnswer : std::uint8_t
	{
		/** Rule 2: 409 repeat_already_used, 429 cap_reached, 429 mission_cap_reached, 403 run_creator_mismatch,
		 *  503 julius_dispatch_disabled, a kind nobody has named yet, ... Both values are spent; mint a fresh pair. */
		Refused,
		/** Rule 1: 202 accepted, or 200 replayed. Both values are spent. */
		Accepted,
		/** Rule 3, rule 2a (429 julius_dispatch_busy, an unlisted 429 kind), or no HTTP answer at all. The bridge may
		 *  or may not have the run; after a wait, resend only the identical pair. */
		NoAnswer,
	};

	EDispatchAnswer ClassifyDispatchAnswer(int HttpStatus, bool bHasError, std::string_view ErrorKind);

	enum class EAttemptVerdict : std::uint8_t
	{
		/** Send it. Either a fresh pair, or the identical pair again after NoAnswer (an idempotent resend). */
		Admitted,
		/** The run id is not RunIdPrefix + a canonical UUIDv4, or fails the bridge's own rule. */
		MalformedRunId,
		/** The key is not a canonical UUIDv4, or fails the bridge's own rule. */
		MalformedKey,
		/** The key's UUID equals the run id's UUID. */
		KeyEqualsRunId,
		/** This run id (or its UUID as a key) was already answered: refused or accepted. Mint a fresh pair. */
		RunIdReused,
		/** This key (or its UUID as a run id) was already answered: refused or accepted. Mint a fresh pair. */
		KeyReused,
		/** An earlier attempt is still unanswered; only that identical pair may be sent until it is answered. */
		PreviousAttemptUnanswered,
	};

	/**
	 * THE FRESH-AFTER-REFUSAL RULE (ruling (c); resolutions F4). Once an attempt is answered, refused OR accepted, its
	 * run id and its key are spent for good: no later attempt may carry either, in either role. Only an attempt that
	 * got NO answer may be sent again, and then only as the identical pair, which the bridge replays instead of
	 * starting a second paid chain (:744-745). Holding the pair until it is answered is deliberate: minting a new pair
	 * while the first may already be running could start a second chain. Values are compared by their UUID, so the
	 * wlj_ prefix cannot disguise a reuse. The tracker never mints by itself and never matches error kinds.
	 */
	class FDispatchAttemptTracker
	{
	public:
		/** Mints a fresh pair from Random: run id from the first 16 bytes, key from the next 16. Out is cleared first. */
		EMintResult MintAttempt(IRandomBytes16& Random, FDispatchAttempt& Out) const;

		/** Admitted means send this attempt now; anything else means send nothing. */
		EAttemptVerdict BeginAttempt(const FDispatchAttempt& Attempt);

		/** Records the answer to the attempt last admitted. False (and no change) when no attempt is open. */
		bool RecordAnswer(EDispatchAnswer Answer);

		bool HasOpenAttempt() const { return bOpen; }

	private:
		bool IsSpent(std::string_view Uuid) const;

		std::vector<std::string> Spent;
		FDispatchAttempt Open;
		bool bOpen = false;
	};

	/* ---------------------------------------------------------------- the resend schedule, RID-7 */

	/**
	 * THE RESEND SCHEDULE (RID-7). After NoAnswer the wrapper resends ONLY the open pair, and only on this schedule.
	 * NextResend is pure and deterministic: it reads no clock, never sleeps and draws no randomness. The wrapper
	 * measures the time itself and passes it in:
	 *   ResendsSent  resends of the open pair already sent (0 when the first send has just gone unanswered);
	 *   WaitedMs     wall time since the open pair was FIRST sent, as the wrapper measured it, including the time the
	 *                requests themselves took and every wait so far.
	 * The delay before resend N (counted from 0) is min(ResendBaseDelayMs * ResendGrowthFactor^N, ResendMaxDelayMs):
	 * 2,000, 4,000, 8,000 and 16,000 ms, then 30,000 ms (the per-wait cap) for every later resend. There are at most
	 * ResendMaxCount = 8 resends, and never a wait that would take WaitedMs past ResendMaxTotalWaitMs = 180,000 ms.
	 * WaitThenResend: wait DelayMs, then send the identical pair through BeginAttempt again.
	 * StillWaiting (DelayMs 0): THE LIMIT IS SPENT, AND THIS IS TERMINAL.
	 * Send nothing more for this pair and keep it open; the wrapper shows "still waiting for the bridge"
	 * (StillWaitingLabel) and leaves the rest to a person or the judge. Running out of patience is not a refusal: the
	 * first chain may still be running. Exhaustion NEVER mints and never admits a new pair: the pair stays open, and
	 * for the rest of the session the tracker answers any fresh pair with PreviousAttemptUnanswered. No step mints.
	 */
	inline constexpr std::uint32_t ResendBaseDelayMs = 2000;
	inline constexpr std::uint32_t ResendGrowthFactor = 2;
	inline constexpr std::uint32_t ResendMaxDelayMs = 30000;
	inline constexpr std::uint32_t ResendMaxCount = 8;
	inline constexpr std::uint64_t ResendMaxTotalWaitMs = 180000;

	enum class EResendStep : std::uint8_t
	{
		/** Wait DelayMs, then resend the identical open pair. */
		WaitThenResend,
		/** Terminal: the limit is spent. Send nothing more, keep the pair open, show "still waiting for the bridge". */
		StillWaiting,
	};

	struct FResendDecision
	{
		EResendStep Step = EResendStep::StillWaiting;
		/** The wait before the resend; 0 when Step is StillWaiting. */
		std::uint32_t DelayMs = 0;
	};

	FResendDecision NextResend(std::uint32_t ResendsSent, std::uint64_t WaitedMs);

	/** "still waiting for the bridge": the words the wrapper shows once NextResend answers StillWaiting. */
	const char* StillWaitingLabel();

	/* ---------------------------------------------------------------- result qualification, ruling R4-F */

	/** What the client can see of the bridge's scrub (:336) and cut (:337) in the artifact text it received. */
	struct FTransformSignals
	{
		/** The text contains the scrub marker "[redacted]". Coder output can contain it too, so it proves nothing. */
		bool bScrubMarker = false;
		/** Exactly J1_TEXT_MAX_CHARS = 8,000 UTF-16 code units: the cut may have happened. */
		bool bAtCutLimit = false;
		/** More than 8,000 UTF-16 code units: no real bridge output can be this long. */
		bool bOverCutLimit = false;
		/** Length in UTF-16 code units (a code point above U+FFFF counts 2; U+FFFD from a lone surrogate counts 1). */
		std::size_t Utf16Units = 0;
	};

	/**
	 * False on malformed UTF-8 (then Out is all false/zero). Trimming can hide a scrub as well as a cut (wrapper note
	 * 7): a cut followed by the trim (:530) can leave fewer than 8,000 units, for example when the cut text ended in
	 * whitespace or began with it, and the cut can leave only part of the [redacted] marker. So NO signal is never
	 * proof that nothing was scrubbed or cut: the client cannot tell, only the independent judge with the ledger can.
	 */
	bool DetectTransformSignals(std::string_view ArtifactText, FTransformSignals& Out);

	/**
	 * Evidence from an INDEPENDENT verifier that it confirmed the original protected artifact and the exact
	 * scrub-cut-trim transformation to this artifactSha256. The bridge carries none today (wrapper note 6), so
	 * production passes it empty. Present means every field is set; anything else is inconsistent. It is
	 * caller-asserted: nothing here authenticates it, which is why production must not fill it yet.
	 */
	struct FTransformEvidence
	{
		bool bPresent = false;
		bool bIndependentlyVerified = false;
		/** sha256 of the original protected artifact, 64 lowercase hex. */
		std::string_view OriginalArtifactSha256;
		/** sha256 the verifier got by applying the exact transformation; must equal resultText's artifactSha256. */
		std::string_view TransformedArtifactSha256;
	};

	enum class EArtifactQualification : std::uint8_t
	{
		/** The finished result was not Completed: never qualifying. */
		NotCompleted,
		/** Completed, no visible scrub or cut signal, no evidence. Shown as "pending judge", NEVER as qualifying or
		 *  eligible: the trim can hide a scrub as well as a cut (wrapper note 7), and only the judge can pass it. */
		NoTransformSignal,
		/** Completed, but the text shows a scrub marker or sits at the cut limit, and no evidence: shown as
		 *  "unverified", NEVER as qualifying. A [redacted] marker or 8,000 units of text alone proves nothing. */
		TransformedUnverified,
		/** Completed, with present, complete and consistent independent evidence whose transformed hash is the
		 *  artifactSha256 that the artifact text itself hashes to. Shown as "pending judge", never as qualifying. */
		TransformedVerified,
		/** Evidence fields set without bPresent, present but incomplete or not matching artifactSha256, or text over
		 *  the cut limit: missing, inconsistent or spoofable evidence never qualifies. */
		EvidenceInconsistent,
		/** The artifact text is not well-formed UTF-8. */
		Unreadable,
	};

	/**
	 * R4-F, fail closed. Call with the EFinishedResult ClassifyFinishedResult returned and the same artifact fields.
	 * No value here is a PASS: qualifying is decided by the independent judge. Show each value only through
	 * DisplayQualification: NoTransformSignal and TransformedVerified are "pending judge", TransformedUnverified is
	 * "unverified", and every other value is "not qualifying". Evidence counts only when sha256(JS-trim(ArtifactText))
	 * is ArtifactSha256 as well.
	 */
	EArtifactQualification ClassifyArtifactQualification(EFinishedResult Finished, std::string_view ArtifactText,
		std::string_view ArtifactSha256, const FTransformEvidence& Evidence);

	/** How the game shows a qualification. There is deliberately no "qualifying" or "eligible" value. */
	enum class EQualificationDisplay : std::uint8_t
	{
		/** "pending judge": NoTransformSignal or TransformedVerified. Only the independent judge can pass it. */
		PendingJudge,
		/** "unverified": TransformedUnverified. A visible scrub or cut with no evidence the client can check. */
		Unverified,
		/** "not qualifying": NotCompleted, EvidenceInconsistent, Unreadable. */
		NotQualifying,
	};

	EQualificationDisplay DisplayQualification(EArtifactQualification Qualification);

	/** The exact words shown: "pending judge", "unverified" or "not qualifying". */
	const char* QualificationDisplayLabel(EQualificationDisplay Display);
}

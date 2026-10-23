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
// ledger value, and treats any error object, known kind or not, as a refusal.
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
//      RAND_bytes returning 1). On any failure Fill returns false and MintAttempt answers RandomUnavailable: the
//      attempt is REFUSED, no id is produced, and there is NO fallback to any other source. NEVER FGuid::NewGuid or
//      FPlatformMisc::CreateGuid (not a documented CSPRNG, and FGuid's text layout reorders digits), and never
//      FMath::Rand, FRandomStream, std::rand, std::mt19937, std::random_device, a timestamp or a counter. This
//      supersedes the BCryptGenRandom wording of docs/j1_client_plan.md 5a. Run ids and keys carry nothing derived:
//      no player, session, mission, machine, time or counter.
//   5. ONE TRACKER PER SESSION, AND ITS VERDICT IS FINAL. Every dispatch POST goes through
//      FDispatchAttemptTracker::BeginAttempt, and every answer, or the lack of one, goes back through RecordAnswer.
//      A verdict other than Admitted means nothing is sent; the wrapper logs one refused line and mints again.
//   6. NO TRANSFORM EVIDENCE EXISTS YET (ruling R4-F). At 31bfc58b neither resultText (:624-628) nor the result body
//      (:913) carries anything that confirms the ORIGINAL artifact or the exact scrub-cut-trim transformation: the
//      roles summaries hold outputSha256/outputChars of the text AFTER that transformation (:586-590), and the pre-
//      transformation evidence (artifactJudgedSha256 and the like, :556) lives in the ledger only. So the wrapper
//      passes an EMPTY FTransformEvidence until a reviewed contract change carries evidence the client can
//      authenticate, and a scrubbed or cut artifact is therefore never shown as qualifying. A flag the client cannot
//      authenticate is spoofable and does not count as evidence.
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

	/** How the bridge answered one dispatch POST. The error kind is never matched against a list. */
	enum class EDispatchAnswer : std::uint8_t
	{
		/** Any error object, whatever its kind and status, or any non-2xx status (409 repeat_already_used, 429
		 *  cap_reached, 429 mission_cap_reached, 403 run_creator_mismatch, a kind nobody has named yet, ...). */
		Refused,
		/** 2xx with no error object: 202 accepted, or 200 replayed. */
		Accepted,
		/** No HTTP answer at all (transport failure, timeout). The bridge may or may not have the run. */
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
	 * False on malformed UTF-8 (then Out is all false/zero). A cut followed by the trim (:530) can leave fewer than
	 * 8,000 units, for example when the cut text ended in whitespace or began with it, so NO signal is never proof
	 * that nothing was cut: the client cannot tell, only the independent judge with the ledger can.
	 */
	bool DetectTransformSignals(std::string_view ArtifactText, FTransformSignals& Out);

	/**
	 * Evidence from an INDEPENDENT verifier that it confirmed the original protected artifact and the exact
	 * scrub-cut-trim transformation to this artifactSha256. The bridge carries none today (wrapper note 6), so
	 * production passes it empty. Present means every field is set; anything else is inconsistent.
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
		/** Completed, no scrub or cut signal, no evidence. May be shown as eligible, pending the independent judge
		 *  (a cut that the trim hid cannot be seen by the client; see DetectTransformSignals). */
		NoTransformSignal,
		/** Completed, but the text shows a scrub marker or sits at the cut limit, and no evidence: shown as
		 *  "unverified", NEVER as qualifying. A [redacted] marker or 8,000 units of text alone proves nothing. */
		TransformedUnverified,
		/** Completed, with present, complete and consistent independent evidence. Eligible, pending the judge. */
		TransformedVerified,
		/** Evidence fields set without bPresent, present but incomplete or not matching artifactSha256, or text over
		 *  the cut limit: missing, inconsistent or spoofable evidence never qualifies. */
		EvidenceInconsistent,
		/** The artifact text is not well-formed UTF-8. */
		Unreadable,
	};

	/**
	 * R4-F, fail closed. Call with the EFinishedResult ClassifyFinishedResult returned and the same artifact fields.
	 * Only NoTransformSignal and TransformedVerified may be shown as eligible; every other value is shown as
	 * unverified and non-qualifying. No value here is a PASS: qualifying is decided by the independent judge.
	 */
	EArtifactQualification ClassifyArtifactQualification(EFinishedResult Finished, std::string_view ArtifactText,
		std::string_view ArtifactSha256, const FTransformEvidence& Evidence);
}

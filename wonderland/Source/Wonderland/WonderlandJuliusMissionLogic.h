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
//     order: scrubKeys removes key values, then cuts to J1_TEXT_MAX_CHARS = 8,000 chars (:55, :333-337), then the
//     coder's text is JavaScript-trimmed once (:527-530). It is null when the coder produced no artifact;
//   - a finished run that did not succeed still answers 200, with a non-null `failure` word (:615-627);
//   - every refusal is {error:{kind,message}} (:952), and there is no frozen list of kinds.
// The client therefore compares its digest ONLY with the artifactSha256 carried in resultText, never with any
// ledger value, and treats any error object, known kind or not, as a refusal.
//
// WHAT IS NOT HERE. No random number generation (the run-id option (a)/(b) is still the founder's decision), no
// HTTP, no JSON parsing, no logging, no display. The Unreal wrapper that parses the JSON and draws rows is later work.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

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
	 * surrogates, code points above U+10FFFF and truncated sequences are all refused rather than guessed at.
	 */
	bool JsTrimUtf8(std::string_view Utf8, std::string& Out);

	/**
	 * THE ARTIFACT DIGEST. sha256 over the UTF-8 bytes of JS-trim(ArtifactText) must equal ExpectedArtifactSha256
	 * (the artifactSha256 inside resultText). On success OutDigest12 is its first 12 hex characters, the only form
	 * the game shows; on any failure OutDigest12 is empty and the caller shows "arrived damaged".
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

	/** Call only after ClassifyResultEnvelope returned BodyIntact. OutDigest12 is set only for Completed. */
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
}

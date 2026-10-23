// WONDERLAND -- J1 in-world mission: the client's pure logic. Standard C++17 only; see the header for the contract.
#include "WonderlandJuliusMissionLogic.h"

#include <cstring>
#include <vector>

namespace WonderlandJuliusMissionLogic
{
	namespace
	{
		/* ------------------------------------------------------------------ SHA-256, FIPS 180-4 section 6.2 */

		constexpr std::uint32_t RoundConstants[64] = {
			0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
			0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
			0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
			0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
			0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
			0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
			0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
			0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
		};

		constexpr std::uint32_t InitialHash[8] = {
			0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au, 0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
		};

		inline std::uint32_t RotateRight(std::uint32_t Value, unsigned Bits)
		{
			return (Value >> Bits) | (Value << (32u - Bits));
		}

		void CompressBlock(std::uint32_t (&State)[8], const std::uint8_t* Block)
		{
			std::uint32_t W[64];
			for (unsigned T = 0; T < 16; ++T)
			{
				W[T] = (static_cast<std::uint32_t>(Block[T * 4]) << 24) | (static_cast<std::uint32_t>(Block[T * 4 + 1]) << 16)
					| (static_cast<std::uint32_t>(Block[T * 4 + 2]) << 8) | static_cast<std::uint32_t>(Block[T * 4 + 3]);
			}
			for (unsigned T = 16; T < 64; ++T)
			{
				const std::uint32_t S0 = RotateRight(W[T - 15], 7) ^ RotateRight(W[T - 15], 18) ^ (W[T - 15] >> 3);
				const std::uint32_t S1 = RotateRight(W[T - 2], 17) ^ RotateRight(W[T - 2], 19) ^ (W[T - 2] >> 10);
				W[T] = W[T - 16] + S0 + W[T - 7] + S1;
			}
			std::uint32_t A = State[0], B = State[1], C = State[2], D = State[3];
			std::uint32_t E = State[4], F = State[5], G = State[6], H = State[7];
			for (unsigned T = 0; T < 64; ++T)
			{
				const std::uint32_t Sigma1 = RotateRight(E, 6) ^ RotateRight(E, 11) ^ RotateRight(E, 25);
				const std::uint32_t Choose = (E & F) ^ (~E & G);
				const std::uint32_t T1 = H + Sigma1 + Choose + RoundConstants[T] + W[T];
				const std::uint32_t Sigma0 = RotateRight(A, 2) ^ RotateRight(A, 13) ^ RotateRight(A, 22);
				const std::uint32_t Majority = (A & B) ^ (A & C) ^ (B & C);
				const std::uint32_t T2 = Sigma0 + Majority;
				H = G; G = F; F = E; E = D + T1; D = C; C = B; B = A; A = T1 + T2;
			}
			State[0] += A; State[1] += B; State[2] += C; State[3] += D;
			State[4] += E; State[5] += F; State[6] += G; State[7] += H;
		}

		constexpr char HexDigits[] = "0123456789abcdef";

		/* ------------------------------------------------------------------ JavaScript trim set */

		struct FCodePointRange
		{
			char32_t First;
			char32_t Last;
		};

		// ECMAScript WhiteSpace (TAB, VT, FF, ZWNBSP, and every Zs code point) plus LineTerminator (LF, CR, LS, PS).
		// NOT U+0085 (NEL) and NOT U+200B (ZWSP), unlike Python's str.strip and Unreal's FChar::IsWhitespace; NOT
		// U+180E, which left Zs in Unicode 6.3. The test derives this set from String.prototype.trim in Node and
		// compares it with the table below, parsed from this file, so the two cannot drift.
		// JS-TRIM-SET-BEGIN
		constexpr FCodePointRange JsTrimSet[] = {
			{ 0x0009, 0x000D }, { 0x0020, 0x0020 }, { 0x00A0, 0x00A0 }, { 0x1680, 0x1680 }, { 0x2000, 0x200A },
			{ 0x2028, 0x2029 }, { 0x202F, 0x202F }, { 0x205F, 0x205F }, { 0x3000, 0x3000 }, { 0xFEFF, 0xFEFF },
		};
		// JS-TRIM-SET-END

		/** Strict UTF-8 decode of one code point at Index; advances Index. False on any malformed sequence. */
		bool DecodeUtf8(std::string_view Text, std::size_t& Index, char32_t& OutCodePoint)
		{
			const auto Byte = [&Text](std::size_t At) { return static_cast<std::uint8_t>(Text[At]); };
			const std::uint8_t Lead = Byte(Index);
			std::size_t Length = 0;
			char32_t CodePoint = 0;
			char32_t Minimum = 0;
			if (Lead < 0x80u) { OutCodePoint = Lead; Index += 1; return true; }
			if (Lead >= 0xC2u && Lead <= 0xDFu) { Length = 2; CodePoint = Lead & 0x1Fu; Minimum = 0x80; }
			else if (Lead >= 0xE0u && Lead <= 0xEFu) { Length = 3; CodePoint = Lead & 0x0Fu; Minimum = 0x800; }
			else if (Lead >= 0xF0u && Lead <= 0xF4u) { Length = 4; CodePoint = Lead & 0x07u; Minimum = 0x10000; }
			else { return false; }
			if (Index + Length > Text.size()) { return false; }
			for (std::size_t Offset = 1; Offset < Length; ++Offset)
			{
				const std::uint8_t Continuation = Byte(Index + Offset);
				if ((Continuation & 0xC0u) != 0x80u) { return false; }
				CodePoint = (CodePoint << 6) | (Continuation & 0x3Fu);
			}
			if (CodePoint < Minimum || CodePoint > 0x10FFFF || (CodePoint >= 0xD800 && CodePoint <= 0xDFFF)) { return false; }
			OutCodePoint = CodePoint;
			Index += Length;
			return true;
		}
	}

	FSha256Digest Sha256(const std::uint8_t* Data, std::size_t Length)
	{
		std::uint32_t State[8];
		std::memcpy(State, InitialHash, sizeof(State));
		const std::size_t FullBlocks = Length / 64;
		for (std::size_t Block = 0; Block < FullBlocks; ++Block)
		{
			CompressBlock(State, Data + Block * 64);
		}
		// Padding: 0x80, zeros, then the message length in bits as a 64-bit big-endian integer (FIPS 180-4 5.1.1).
		std::uint8_t Tail[128] = {};
		const std::size_t Remainder = Length % 64;
		if (Remainder > 0)
		{
			std::memcpy(Tail, Data + FullBlocks * 64, Remainder);
		}
		Tail[Remainder] = 0x80u;
		const std::size_t TailLength = Remainder < 56 ? 64 : 128;
		const std::uint64_t Bits = static_cast<std::uint64_t>(Length) * 8u;
		for (unsigned Shift = 0; Shift < 8; ++Shift)
		{
			Tail[TailLength - 1 - Shift] = static_cast<std::uint8_t>(Bits >> (8u * Shift));
		}
		CompressBlock(State, Tail);
		if (TailLength == 128)
		{
			CompressBlock(State, Tail + 64);
		}
		FSha256Digest Digest{};
		for (unsigned Word = 0; Word < 8; ++Word)
		{
			Digest[Word * 4] = static_cast<std::uint8_t>(State[Word] >> 24);
			Digest[Word * 4 + 1] = static_cast<std::uint8_t>(State[Word] >> 16);
			Digest[Word * 4 + 2] = static_cast<std::uint8_t>(State[Word] >> 8);
			Digest[Word * 4 + 3] = static_cast<std::uint8_t>(State[Word]);
		}
		return Digest;
	}

	FSha256Digest Sha256(std::string_view Bytes)
	{
		return Sha256(reinterpret_cast<const std::uint8_t*>(Bytes.data()), Bytes.size());
	}

	std::string HexLower(const FSha256Digest& Digest)
	{
		std::string Out;
		Out.reserve(64);
		for (const std::uint8_t Byte : Digest)
		{
			Out.push_back(HexDigits[Byte >> 4]);
			Out.push_back(HexDigits[Byte & 0x0Fu]);
		}
		return Out;
	}

	std::string Sha256Hex(std::string_view Bytes)
	{
		return HexLower(Sha256(Bytes));
	}

	bool IsLowerHex64(std::string_view Text)
	{
		if (Text.size() != 64) { return false; }
		for (const char Character : Text)
		{
			if (!((Character >= '0' && Character <= '9') || (Character >= 'a' && Character <= 'f'))) { return false; }
		}
		return true;
	}

	bool IsJsTrimWhitespace(char32_t CodePoint)
	{
		for (const FCodePointRange& Range : JsTrimSet)
		{
			if (CodePoint >= Range.First && CodePoint <= Range.Last) { return true; }
		}
		return false;
	}

	bool JsTrimUtf8(std::string_view Utf8, std::string& Out)
	{
		Out.clear();
		// Decode the whole input first: a malformed byte anywhere refuses, not only one at the edges.
		std::vector<std::size_t> Starts;
		std::vector<bool> Blank;
		std::size_t Index = 0;
		while (Index < Utf8.size())
		{
			const std::size_t Start = Index;
			char32_t CodePoint = 0;
			if (!DecodeUtf8(Utf8, Index, CodePoint)) { return false; }
			Starts.push_back(Start);
			Blank.push_back(IsJsTrimWhitespace(CodePoint));
		}
		std::size_t First = 0;
		while (First < Starts.size() && Blank[First]) { ++First; }
		if (First == Starts.size()) { return true; }
		std::size_t Last = Starts.size() - 1;
		while (Blank[Last]) { --Last; }
		const std::size_t Begin = Starts[First];
		const std::size_t End = Last + 1 < Starts.size() ? Starts[Last + 1] : Utf8.size();
		Out.assign(Utf8.data() + Begin, End - Begin);
		return true;
	}

	bool CheckArtifactDigest(std::string_view ArtifactText, std::string_view ExpectedArtifactSha256, std::string& OutDigest12)
	{
		OutDigest12.clear();
		if (!IsLowerHex64(ExpectedArtifactSha256)) { return false; }
		std::string Trimmed;
		if (!JsTrimUtf8(ArtifactText, Trimmed)) { return false; }
		const std::string Actual = Sha256Hex(Trimmed);
		if (Actual != ExpectedArtifactSha256) { return false; }
		OutDigest12 = Actual.substr(0, 12);
		return true;
	}

	bool CheckResultBody(std::string_view ResultText, std::string_view ExpectedResultSha256)
	{
		return IsLowerHex64(ExpectedResultSha256) && Sha256Hex(ResultText) == ExpectedResultSha256;
	}

	EResultEnvelope ClassifyResultEnvelope(int HttpStatus, bool bHasData, bool bHasError, std::string_view ErrorKind,
		std::string_view DataRunId, std::string_view ExpectedRunId, std::string_view ResultText, std::string_view ResultSha256)
	{
		// AN ERROR OBJECT IS A REFUSAL, WHATEVER ITS KIND AND WHATEVER THE STATUS. The kind is not looked up in any
		// list, so a kind added to the bridge later is still a refusal here, never a success.
		if (bHasError || !ErrorKind.empty()) { return EResultEnvelope::Refused; }
		if (HttpStatus != 200 || !bHasData) { return EResultEnvelope::Unreadable; }
		if (ExpectedRunId.empty() || DataRunId != ExpectedRunId) { return EResultEnvelope::WrongRun; }
		if (!CheckResultBody(ResultText, ResultSha256)) { return EResultEnvelope::Damaged; }
		return EResultEnvelope::BodyIntact;
	}

	EFinishedResult ClassifyFinishedResult(const FFinishedResultFields& Fields, std::string& OutDigest12)
	{
		OutDigest12.clear();
		// The hashed resultText is authoritative. It must name this run, the unhashed data.state and data.mode around
		// it must agree with it, and its mode must be this build's mode, before its outcome is read at all.
		if (Fields.ExpectedRunId.empty() || Fields.InnerRunId != Fields.ExpectedRunId) { return EFinishedResult::WrongRun; }
		if (Fields.DataState != Fields.State || Fields.DataMode != Fields.Mode) { return EFinishedResult::Damaged; }
		if (Fields.ExpectedMode.empty() || Fields.Mode != Fields.ExpectedMode) { return EFinishedResult::ModeMismatch; }
		// A FINISHED RUN CAN FAIL ON A 200. Any failure word, recognised or not, is a failure outcome even when an
		// artifact and a matching hash are present (reviewer_rejected and checker_failed carry both).
		if (!Fields.bFailureIsNull) { return EFinishedResult::FailureOutcome; }
		if (Fields.State != "COMPLETED") { return EFinishedResult::FailureOutcome; }
		if (Fields.bArtifactSha256IsNull || Fields.bArtifactTextIsNull) { return EFinishedResult::NoArtifact; }
		std::string Digest12;
		if (!CheckArtifactDigest(Fields.ArtifactText, Fields.ArtifactSha256, Digest12)) { return EFinishedResult::Damaged; }
		OutDigest12 = Digest12;
		return EFinishedResult::Completed;
	}

	std::string FormatUuidV4FromBytes(const std::uint8_t (&Bytes)[16])
	{
		std::uint8_t Laid[16];
		std::memcpy(Laid, Bytes, sizeof(Laid));
		Laid[6] = static_cast<std::uint8_t>((Laid[6] & 0x0Fu) | 0x40u); // version nibble 4
		Laid[8] = static_cast<std::uint8_t>((Laid[8] & 0x3Fu) | 0x80u); // variant 10xx
		std::string Out;
		Out.reserve(36);
		for (unsigned Index = 0; Index < 16; ++Index)
		{
			if (Index == 4 || Index == 6 || Index == 8 || Index == 10) { Out.push_back('-'); }
			Out.push_back(HexDigits[Laid[Index] >> 4]);
			Out.push_back(HexDigits[Laid[Index] & 0x0Fu]);
		}
		return Out;
	}

	std::string FormatRunIdFromBytes(const std::uint8_t (&Bytes)[16])
	{
		return std::string(RunIdPrefix) + FormatUuidV4FromBytes(Bytes);
	}

	bool IsStrictRunId(std::string_view RunId)
	{
		if (RunId.size() == RunIdPrefix.size() + 36 && RunId.substr(0, RunIdPrefix.size()) == RunIdPrefix)
		{
			RunId.remove_prefix(RunIdPrefix.size());
		}
		if (RunId.size() != 36) { return false; }
		for (std::size_t Index = 0; Index < 36; ++Index)
		{
			const char Character = RunId[Index];
			const bool bHex = (Character >= '0' && Character <= '9') || (Character >= 'a' && Character <= 'f');
			if (Index == 8 || Index == 13 || Index == 18 || Index == 23)
			{
				if (Character != '-') { return false; }
			}
			else if (Index == 14)
			{
				if (Character != '4') { return false; }
			}
			else if (Index == 19)
			{
				if (Character != '8' && Character != '9' && Character != 'a' && Character != 'b') { return false; }
			}
			else if (!bHex)
			{
				return false;
			}
		}
		return true;
	}

	bool IsBridgeRunId(std::string_view RunId)
	{
		if (RunId.empty() || RunId.size() > 128) { return false; }
		for (const char Character : RunId)
		{
			const bool bAllowed = (Character >= 'A' && Character <= 'Z') || (Character >= 'a' && Character <= 'z')
				|| (Character >= '0' && Character <= '9') || Character == ':' || Character == '_' || Character == '-';
			if (!bAllowed) { return false; }
		}
		return true;
	}

	bool IsCanonicalUuidV4(std::string_view Text)
	{
		return Text.size() == 36 && IsStrictRunId(Text);
	}

	bool IsBridgeIdempotencyKey(std::string_view Key)
	{
		if (Key.size() < 8 || Key.size() > 80) { return false; }
		for (const char Character : Key)
		{
			const bool bAllowed = (Character >= 'A' && Character <= 'Z') || (Character >= 'a' && Character <= 'z')
				|| (Character >= '0' && Character <= '9') || Character == '_' || Character == '-';
			if (!bAllowed) { return false; }
		}
		return true;
	}

	namespace
	{
		/** Rule 2a: the only 429 kinds J1 sends before any chain can start (julius-dispatch.ts:780-781). Exact bytes. */
		constexpr std::string_view PreChainTooManyRequestsKinds[] = {
			"julius_dispatch_cap_reached",
			"julius_dispatch_mission_cap_reached",
		};
	}

	EDispatchAnswer ClassifyDispatchAnswer(int HttpStatus, bool bHasError, std::string_view ErrorKind)
	{
		// The rule in the header: only a J1-shaped refusal is conclusive; anything inconclusive keeps the pair open.
		const bool bNoError = !bHasError && ErrorKind.empty();
		const bool bErrorWithKind = bHasError && !ErrorKind.empty();
		if (HttpStatus >= 200 && HttpStatus <= 299 && bNoError) { return EDispatchAnswer::Accepted; }
		if (HttpStatus == 429 && bErrorWithKind)
		{
			// RID-6: julius_dispatch_busy (:760) and any unlisted kind may mean this very pair is still being reserved.
			for (const std::string_view Kind : PreChainTooManyRequestsKinds)
			{
				if (ErrorKind == Kind) { return EDispatchAnswer::Refused; }
			}
			return EDispatchAnswer::NoAnswer;
		}
		if (HttpStatus >= 400 && HttpStatus <= 599 && bErrorWithKind) { return EDispatchAnswer::Refused; }
		return EDispatchAnswer::NoAnswer;
	}

	namespace
	{
		/** The UUID of a minted run id (RunIdPrefix + canonical UUIDv4), or empty when it is not one. */
		std::string_view RunIdUuid(std::string_view RunId)
		{
			if (RunId.size() != RunIdPrefix.size() + 36 || RunId.substr(0, RunIdPrefix.size()) != RunIdPrefix) { return {}; }
			const std::string_view Uuid = RunId.substr(RunIdPrefix.size());
			return IsCanonicalUuidV4(Uuid) && IsBridgeRunId(RunId) ? Uuid : std::string_view{};
		}

		/** The UUID of a minted key (a canonical UUIDv4, no prefix), or empty when it is not one. */
		std::string_view KeyUuid(std::string_view Key)
		{
			return IsCanonicalUuidV4(Key) && IsBridgeIdempotencyKey(Key) ? Key : std::string_view{};
		}
	}

	bool FDispatchAttemptTracker::IsSpent(std::string_view Uuid) const
	{
		for (const std::string& Used : Spent)
		{
			if (Used == Uuid) { return true; }
		}
		return false;
	}

	EMintResult FDispatchAttemptTracker::MintAttempt(IRandomBytes16& Random, FDispatchAttempt& Out) const
	{
		Out.RunId.clear();
		Out.IdempotencyKey.clear();
		std::uint8_t RunBytes[16] = {};
		std::uint8_t KeyBytes[16] = {};
		if (!Random.Fill(RunBytes) || !Random.Fill(KeyBytes)) { return EMintResult::RandomUnavailable; }
		const std::string RunUuid = FormatUuidV4FromBytes(RunBytes);
		const std::string KeyText = FormatUuidV4FromBytes(KeyBytes);
		// 122 random bits each: a repeat here means the source is broken, so refuse rather than retry.
		if (RunUuid == KeyText || IsSpent(RunUuid) || IsSpent(KeyText)) { return EMintResult::RandomRepeated; }
		if (bOpen && (RunIdUuid(Open.RunId) == RunUuid || RunIdUuid(Open.RunId) == KeyText
			|| KeyUuid(Open.IdempotencyKey) == RunUuid || KeyUuid(Open.IdempotencyKey) == KeyText))
		{
			return EMintResult::RandomRepeated;
		}
		Out.RunId = std::string(RunIdPrefix) + RunUuid;
		Out.IdempotencyKey = KeyText;
		return EMintResult::Minted;
	}

	EAttemptVerdict FDispatchAttemptTracker::BeginAttempt(const FDispatchAttempt& Attempt)
	{
		const std::string_view RunUuid = RunIdUuid(Attempt.RunId);
		const std::string_view KeyText = KeyUuid(Attempt.IdempotencyKey);
		if (RunUuid.empty()) { return EAttemptVerdict::MalformedRunId; }
		if (KeyText.empty()) { return EAttemptVerdict::MalformedKey; }
		if (RunUuid == KeyText) { return EAttemptVerdict::KeyEqualsRunId; }
		// Spent values first: a value that was answered can never be sent again, open attempt or not.
		if (IsSpent(RunUuid)) { return EAttemptVerdict::RunIdReused; }
		if (IsSpent(KeyText)) { return EAttemptVerdict::KeyReused; }
		if (bOpen)
		{
			const bool bSamePair = Attempt.RunId == Open.RunId && Attempt.IdempotencyKey == Open.IdempotencyKey;
			return bSamePair ? EAttemptVerdict::Admitted : EAttemptVerdict::PreviousAttemptUnanswered;
		}
		Open = Attempt;
		bOpen = true;
		return EAttemptVerdict::Admitted;
	}

	bool FDispatchAttemptTracker::RecordAnswer(EDispatchAnswer Answer)
	{
		if (!bOpen) { return false; }
		if (Answer == EDispatchAnswer::NoAnswer) { return true; }
		// Refused or accepted: both values are spent for good, in either role.
		Spent.emplace_back(RunIdUuid(Open.RunId));
		Spent.emplace_back(KeyUuid(Open.IdempotencyKey));
		Open = FDispatchAttempt{};
		bOpen = false;
		return true;
	}

	bool DetectTransformSignals(std::string_view ArtifactText, FTransformSignals& Out)
	{
		Out = FTransformSignals{};
		std::size_t Units = 0;
		std::size_t Index = 0;
		while (Index < ArtifactText.size())
		{
			char32_t CodePoint = 0;
			if (!DecodeUtf8(ArtifactText, Index, CodePoint)) { return false; }
			Units += CodePoint > 0xFFFF ? 2u : 1u;
		}
		constexpr std::size_t CutLimitUnits = 8000; // J1_TEXT_MAX_CHARS (:55)
		Out.Utf16Units = Units;
		Out.bScrubMarker = ArtifactText.find("[redacted]") != std::string_view::npos;
		Out.bAtCutLimit = Units == CutLimitUnits;
		Out.bOverCutLimit = Units > CutLimitUnits;
		return true;
	}

	EArtifactQualification ClassifyArtifactQualification(EFinishedResult Finished, std::string_view ArtifactText,
		std::string_view ArtifactSha256, const FTransformEvidence& Evidence)
	{
		if (Finished != EFinishedResult::Completed) { return EArtifactQualification::NotCompleted; }
		FTransformSignals Signals;
		if (!DetectTransformSignals(ArtifactText, Signals)) { return EArtifactQualification::Unreadable; }
		if (Signals.bOverCutLimit) { return EArtifactQualification::EvidenceInconsistent; }
		if (!Evidence.bPresent)
		{
			// Half-filled evidence is not "no evidence": it is inconsistent, and it never qualifies.
			if (Evidence.bIndependentlyVerified || !Evidence.OriginalArtifactSha256.empty() || !Evidence.TransformedArtifactSha256.empty())
			{
				return EArtifactQualification::EvidenceInconsistent;
			}
			return Signals.bScrubMarker || Signals.bAtCutLimit ? EArtifactQualification::TransformedUnverified
				: EArtifactQualification::NoTransformSignal;
		}
		std::string Digest12;
		const bool bConsistent = Evidence.bIndependentlyVerified && IsLowerHex64(Evidence.OriginalArtifactSha256)
			&& IsLowerHex64(ArtifactSha256) && Evidence.TransformedArtifactSha256 == ArtifactSha256
			&& CheckArtifactDigest(ArtifactText, ArtifactSha256, Digest12);
		return bConsistent ? EArtifactQualification::TransformedVerified : EArtifactQualification::EvidenceInconsistent;
	}

	EQualificationDisplay DisplayQualification(EArtifactQualification Qualification)
	{
		switch (Qualification)
		{
		case EArtifactQualification::NoTransformSignal: return EQualificationDisplay::PendingJudge;
		case EArtifactQualification::TransformedVerified: return EQualificationDisplay::PendingJudge;
		case EArtifactQualification::TransformedUnverified: return EQualificationDisplay::Unverified;
		case EArtifactQualification::NotCompleted:
		case EArtifactQualification::EvidenceInconsistent:
		case EArtifactQualification::Unreadable:
			return EQualificationDisplay::NotQualifying;
		}
		return EQualificationDisplay::NotQualifying;
	}

	const char* QualificationDisplayLabel(EQualificationDisplay Display)
	{
		switch (Display)
		{
		case EQualificationDisplay::PendingJudge: return "pending judge";
		case EQualificationDisplay::Unverified: return "unverified";
		case EQualificationDisplay::NotQualifying: return "not qualifying";
		}
		return "not qualifying";
	}
}

// WONDERLAND -- J1 client pure logic: KNOWN-ANSWER TEST. No Unreal, no network, no secrets, no randomness: every
// "random" byte the run-id tracker sees here comes from a fixed script (sha256 of a label), never from an RNG.
//
// Build and run from the repository root (any C++17 compiler):
//   g++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I wonderland/Source/Wonderland
//       wonderland/Tools/j1_logic_kat.cpp wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp -o j1_logic_kat
//   (one command line, wrapped here)
//   ./j1_logic_kat        -> prints "J1 LOGIC KAT PASS ..." and exits 0, or names every failure and exits 1.
//
// WHERE THE EXPECTED VALUES COME FROM. The SHA-256 rows named nist_* are the FIPS 180-2 / NIST CSRC example vectors
// ("", "abc", the 448-bit and 896-bit messages, one million 'a'). Every other expected value was computed with Node's
// crypto and String.prototype.trim, and src/relay/mission/wonderland/wonderland-j1-logic.test.ts re-derives each one
// from Node on every run by parsing the tables below, so a value here cannot be edited without that test failing.
// Inputs are hex so that the tables need no escapes. The table markers (KAT-...-BEGIN/END) are read by that test.
// The KAT-DIGEST-CUT rows are the bridge's 8,000-UTF-16-unit cut (:333-337) splitting a surrogate pair: the source
// 'x'*7999 + U+1F600 is cut to 'x'*7999 + a lone \uD83D, which Node hashes as 'x'*7999 + EF BF BD (U+FFFD). Their
// expected hashes were derived by importing the real scrubKeys from relay-bridge/julius-dispatch.ts at 31bfc58b
// (blob 018fb582) and trimming and hashing as J1 does (:530, :328, :627); the test restates that cut on every run.
//
// The result rows follow the bridge contract at sunday-relay commit 31bfc58b, relay-bridge/julius-dispatch.ts:
// result body {data:{runId,state,mode,resultText,resultSha256}} (:913); resultText = JSON.stringify of the object
// at :624-628; error body {error:{kind,message}} (:952); a finished run that failed is a 200 with `failure` set.
//
// RULING (c), 2026-10-23: run ids are client-minted UUIDv4s, and after any refusal the next attempt carries a fresh
// run id AND a fresh idempotency key. KAT-UUID-FORMAT and KAT-KEY pin the formats against the bridge's own rules
// (RUN_ID :962, KEY :964); KAT-ATTEMPT pins FDispatchAttemptTracker after every kind of answer. RULING R4-F: a
// scrubbed or cut artifact qualifies only with independent evidence; KAT-QUALIFICATION pins the fail-closed classifier.
#include "WonderlandJuliusMissionLogic.h"

#include <cstdio>
#include <set>
#include <string>
#include <vector>

namespace
{
	using namespace WonderlandJuliusMissionLogic;

	int Failures = 0;

	void Expect(bool bOk, const std::string& What)
	{
		if (!bOk)
		{
			++Failures;
			std::printf("FAIL %s\n", What.c_str());
		}
	}

	std::string FromHex(const char* Hex)
	{
		std::string Out;
		const auto Nibble = [](char C) { return C <= '9' ? C - '0' : C - 'a' + 10; };
		for (const char* P = Hex; P[0] != '\0' && P[1] != '\0'; P += 2)
		{
			Out.push_back(static_cast<char>((Nibble(P[0]) << 4) | Nibble(P[1])));
		}
		return Out;
	}

	struct FShaRow { const char* Label; const char* InputHex; unsigned long Repeat; const char* Expected; };
	const FShaRow ShaRows[] = {
	// KAT-SHA256-BEGIN
	{ "nist_empty", "", 1, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
	{ "nist_abc", "616263", 1, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
	{ "nist_448bit", "6162636462636465636465666465666765666768666768696768696a68696a6b696a6b6c6a6b6c6d6b6c6d6e6c6d6e6f6d6e6f706e6f7071", 1, "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1" },
	{ "nist_896bit", "61626364656667686263646566676869636465666768696a6465666768696a6b65666768696a6b6c666768696a6b6c6d6768696a6b6c6d6e68696a6b6c6d6e6f696a6b6c6d6e6f706a6b6c6d6e6f70716b6c6d6e6f7071726c6d6e6f707172736d6e6f70717273746e6f707172737475", 1, "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1" },
	{ "nist_million_a", "61", 1000000, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0" },
	{ "pad_a55", "61", 55, "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318" },
	{ "pad_a56", "61", 56, "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a" },
	{ "pad_a63", "61", 63, "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34" },
	{ "pad_a64", "61", 64, "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb" },
	{ "pad_a65", "61", 65, "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0" },
	{ "pad_a119", "61", 119, "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb" },
	{ "pad_a120", "61", 120, "2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c" },
	{ "utf8_2byte_e_acute", "c3a9", 1, "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c" },
	{ "utf8_4byte_u1f600", "f09f9880", 1, "f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9" },
	// KAT-SHA256-END
	};

	struct FTrimRow { const char* Label; const char* InputHex; const char* ExpectedHex; int bValid; };
	const FTrimRow TrimRows[] = {
	// KAT-TRIM-BEGIN
	{ "nbsp_bom_ls_lf", "c2a0efbbbf782079e280a80a", "782079", 1 },
	{ "keeps_u0085", "c28578", "c28578", 1 },
	{ "keeps_u200b", "e2808b78e2808b", "e2808b78e2808b", 1 },
	{ "ascii_controls_ideographic", "090a0b0c0d207820e38080", "78", 1 },
	{ "empty", "", "", 1 },
	{ "only_whitespace", "e28080e2808ae2819fe280af", "", 1 },
	{ "ogham_tail", "78e19a80", "78", 1 },
	{ "keeps_u180e", "e1a08e78", "e1a08e78", 1 },
	{ "interior_kept", "206120c2a0206220", "6120c2a02062", 1 },
	{ "astral_kept", "e280a9f09f9880e280a9", "f09f9880", 1 },
	{ "invalid_ff", "ff", "", 0 },
	{ "overlong_c0af", "c0af", "", 0 },
	{ "surrogate_eda080", "eda080", "", 0 },
	{ "above_10ffff", "f4908080", "", 0 },
	{ "truncated_e282", "e282", "", 0 },
	// KAT-TRIM-END
	};

	struct FDigestRow { const char* Label; const char* ArtifactHex; const char* ExpectedSha256; int bOk; const char* Digest12; };
	const FDigestRow DigestRows[] = {
	// KAT-DIGEST-BEGIN
	{ "trimmed_ok", "782079", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 1, "887fcea6a803" },
	{ "untrimmed_text_ok", "c2a07820790a", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 1, "887fcea6a803" },
	{ "mismatch_damaged", "782079", "187eac87a28477b1a60cf8e5540e347e090e9adef6039d04011736a3a844149c", 0, "" },
	{ "one_hex_digit_off", "782079", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c10", 0, "" },
	{ "uppercase_refused", "782079", "887FCEA6A80333C6C02AE7E79735F0EDAD8D811F0B61431495F796F4BF6A7C19", 0, "" },
	{ "short_hex_refused", "782079", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c1", 0, "" },
	{ "invalid_utf8_refused", "ff", "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", 0, "" },
	// KAT-DIGEST-END
	};

	// The artifact bytes are PrefixHex repeated PrefixRepeat times, then TailHex: what the Unreal JSON wrapper hands
	// over after decoding artifactText. Each row also runs through ClassifyFinishedResult as a COMPLETED fake run.
	struct FDigestCutRow
	{
		const char* Label; const char* PrefixHex; unsigned long PrefixRepeat; const char* TailHex; const char* ExpectedSha256;
		int bOk; const char* Digest12;
	};
	const FDigestCutRow DigestCutRows[] = {
	// KAT-DIGEST-CUT-BEGIN
	{ "cut_splits_pair_lone_surrogate_as_ufffd_ok", "78", 7999, "efbfbd", "b4296284858e3171fbd96d387db64fa551a4173aed40e5ea9bf8dc273465d933", 1, "b4296284858e" },
	{ "cut_splits_pair_lone_surrogate_as_wtf8_refused", "78", 7999, "eda0bd", "b4296284858e3171fbd96d387db64fa551a4173aed40e5ea9bf8dc273465d933", 0, "" },
	{ "pair_fits_at_8000_units_ok", "78", 7998, "f09f9880", "4222777fbde458ad9b9910df41e08b29f483fe60e0d03f62ec95ed3faf98ae49", 1, "4222777fbde4" },
	// KAT-DIGEST-CUT-END
	};

	struct FRunFormatRow { const char* Label; const char* BytesHex; const char* Expected; };
	const FRunFormatRow RunFormatRows[] = {
	// KAT-RUNID-FORMAT-BEGIN
	{ "zeros", "00000000000000000000000000000000", "wlj_00000000-0000-4000-8000-000000000000" },
	{ "ones", "ffffffffffffffffffffffffffffffff", "wlj_ffffffff-ffff-4fff-bfff-ffffffffffff" },
	{ "counting", "000102030405060708090a0b0c0d0e0f", "wlj_00010203-0405-4607-8809-0a0b0c0d0e0f" },
	{ "sha_abc_prefix", "ba7816bf8f01cfea414140de5dae2223", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223" },
	// KAT-RUNID-FORMAT-END
	};

	struct FRunStrictRow { const char* RunId; int bStrict; int bBridge; };
	const FRunStrictRow RunStrictRows[] = {
	// KAT-RUNID-STRICT-BEGIN
	{ "wlj_00000000-0000-4000-8000-000000000000", 1, 1 },
	{ "wlj_ffffffff-ffff-4fff-bfff-ffffffffffff", 1, 1 },
	{ "wlj_00010203-0405-4607-8809-0a0b0c0d0e0f", 1, 1 },
	{ "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", 1, 1 },
	{ "00000000-0000-4000-8000-000000000000", 1, 1 },
	{ "0b7a1c2e-4f3d-9a6b-1c2d-3e4f5a6b7c8d", 0, 1 },
	{ "wlj_0b7a1c2e-4f3d-9a6b-1c2d-3e4f5a6b7c8d", 0, 1 },
	{ "wlj_BA7816BF-8F01-4FEA-8141-40DE5DAE2223", 0, 1 },
	{ "wlx_ba7816bf-8f01-4fea-8141-40de5dae2223", 0, 1 },
	{ "wlj_00000000-0000-4000-c000-000000000000", 0, 1 },
	{ "wlj_00000000-0000-4000-8000-00000000000", 0, 1 },
	{ "wlj_", 0, 1 },
	{ "", 0, 0 },
	{ "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0, 1 },
	{ "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0, 0 },
	// KAT-RUNID-STRICT-END
	};

	// Every envelope row expects this run; the fixture resultText names it too.
	const char* const ExpectedRunId = "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223";

	struct FEnvelopeRow
	{
		const char* Label; int HttpStatus; int bHasData; int bHasError; const char* ErrorKind; const char* DataRunId;
		const char* ResultTextHex; const char* ResultSha256; EResultEnvelope Expected;
	};
	const FEnvelopeRow EnvelopeRows[] = {
	// KAT-ENVELOPE-BEGIN
	{ "completed_body_intact", 200, 1, 0, "", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "7b2272756e4964223a22776c6a5f62613738313662662d386630312d346665612d383134312d343064653564616532323233222c2264697370617463684964223a22666978747572652d6469737061746368222c226d697373696f6e4964223a22666978747572652d6d697373696f6e222c226d6f6465223a2266616b65222c227374617465223a22434f4d504c45544544222c226661696c757265223a6e756c6c2c22726f6c6573223a5b5d2c227370656e64556e6b6e6f776e4c656773223a302c22726576696577657256657264696374223a22617070726f7665222c22636865636b657250617373223a747275652c226172746966616374536861323536223a2238383766636561366138303333336336633032616537653739373335663065646164386438313166306236313433313439356637393666346266366137633139222c22617274696661637454657874223a22782079227d", "ceabbaeb60452f1d23d5da0fda38033c8cce9373c70a7aa2e4a58badc41227dc", EResultEnvelope::BodyIntact },
	{ "result_sha_one_hex_digit_off", 200, 1, 0, "", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "7b2272756e4964223a22776c6a5f62613738313662662d386630312d346665612d383134312d343064653564616532323233222c2264697370617463684964223a22666978747572652d6469737061746368222c226d697373696f6e4964223a22666978747572652d6d697373696f6e222c226d6f6465223a2266616b65222c227374617465223a22434f4d504c45544544222c226661696c757265223a6e756c6c2c22726f6c6573223a5b5d2c227370656e64556e6b6e6f776e4c656773223a302c22726576696577657256657264696374223a22617070726f7665222c22636865636b657250617373223a747275652c226172746966616374536861323536223a2238383766636561366138303333336336633032616537653739373335663065646164386438313166306236313433313439356637393666346266366137633139222c22617274696661637454657874223a22782079227d", "ceabbaeb60452f1d23d5da0fda38033c8cce9373c70a7aa2e4a58badc41227d0", EResultEnvelope::Damaged },
	{ "result_text_one_byte_mutated", 200, 1, 0, "", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "7b2272756e4964223a22776c6a5f62613738313662662d386630312d346665612d383134312d343064653564616532323233222c2264697370617463684964223a22666978747572652d6469737061746368222c226d697373696f6e4964223a22666978747572652d6d697373696f6e222c226d6f6465223a2266616b65222c227374617465223a22434f4d504c45544544222c226661696c757265223a6e756c6c2c22726f6c6573223a5b5d2c227370656e64556e6b6e6f776e4c656773223a302c22726576696577657256657264696374223a22617070726f7665222c22636865636b657250617373223a747275652c226172746966616374536861323536223a2238383766636561366138303333336336633032616537653739373335663065646164386438313166306236313433313439356637393666346266366137633139222c22617274696661637454657874223a2278207a227d", "ceabbaeb60452f1d23d5da0fda38033c8cce9373c70a7aa2e4a58badc41227dc", EResultEnvelope::Damaged },
	{ "result_sha_uppercase", 200, 1, 0, "", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "7b2272756e4964223a22776c6a5f62613738313662662d386630312d346665612d383134312d343064653564616532323233222c2264697370617463684964223a22666978747572652d6469737061746368222c226d697373696f6e4964223a22666978747572652d6d697373696f6e222c226d6f6465223a2266616b65222c227374617465223a22434f4d504c45544544222c226661696c757265223a6e756c6c2c22726f6c6573223a5b5d2c227370656e64556e6b6e6f776e4c656773223a302c22726576696577657256657264696374223a22617070726f7665222c22636865636b657250617373223a747275652c226172746966616374536861323536223a2238383766636561366138303333336336633032616537653739373335663065646164386438313166306236313433313439356637393666346266366137633139222c22617274696661637454657874223a22782079227d", "CEABBAEB60452F1D23D5DA0FDA38033C8CCE9373C70A7AA2E4A58BADC41227DC", EResultEnvelope::Damaged },
	{ "refused_known_kind_409", 409, 0, 1, "julius_dispatch_result_not_ready", "", "", "", EResultEnvelope::Refused },
	{ "unknown_kind_on_200", 200, 0, 1, "julius_dispatch_kind_nobody_has_named", "", "", "", EResultEnvelope::Refused },
	{ "unknown_kind_on_403", 403, 0, 1, "julius_dispatch_kind_nobody_has_named", "", "", "", EResultEnvelope::Refused },
	{ "error_and_data_both", 200, 1, 1, "julius_dispatch_run_orphaned", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "7b2272756e4964223a22776c6a5f62613738313662662d386630312d346665612d383134312d343064653564616532323233222c2264697370617463684964223a22666978747572652d6469737061746368222c226d697373696f6e4964223a22666978747572652d6d697373696f6e222c226d6f6465223a2266616b65222c227374617465223a22434f4d504c45544544222c226661696c757265223a6e756c6c2c22726f6c6573223a5b5d2c227370656e64556e6b6e6f776e4c656773223a302c22726576696577657256657264696374223a22617070726f7665222c22636865636b657250617373223a747275652c226172746966616374536861323536223a2238383766636561366138303333336336633032616537653739373335663065646164386438313166306236313433313439356637393666346266366137633139222c22617274696661637454657874223a22782079227d", "ceabbaeb60452f1d23d5da0fda38033c8cce9373c70a7aa2e4a58badc41227dc", EResultEnvelope::Refused },
	{ "no_data_no_error_200", 200, 0, 0, "", "", "", "", EResultEnvelope::Unreadable },
	{ "status_500_no_error", 500, 0, 0, "", "", "", "", EResultEnvelope::Unreadable },
	{ "data_run_id_other_run", 200, 1, 0, "", "wlj_00000000-0000-4000-8000-000000000000", "7b2272756e4964223a22776c6a5f62613738313662662d386630312d346665612d383134312d343064653564616532323233222c2264697370617463684964223a22666978747572652d6469737061746368222c226d697373696f6e4964223a22666978747572652d6d697373696f6e222c226d6f6465223a2266616b65222c227374617465223a22434f4d504c45544544222c226661696c757265223a6e756c6c2c22726f6c6573223a5b5d2c227370656e64556e6b6e6f776e4c656773223a302c22726576696577657256657264696374223a22617070726f7665222c22636865636b657250617373223a747275652c226172746966616374536861323536223a2238383766636561366138303333336336633032616537653739373335663065646164386438313166306236313433313439356637393666346266366137633139222c22617274696661637454657874223a22782079227d", "ceabbaeb60452f1d23d5da0fda38033c8cce9373c70a7aa2e4a58badc41227dc", EResultEnvelope::WrongRun },
	// KAT-ENVELOPE-END
	};

	struct FResultRow
	{
		const char* Label; const char* DataState; const char* DataMode; const char* InnerRunId; const char* Mode;
		const char* ExpectedMode; int bFailureIsNull; const char* Failure; const char* State; int bArtifactSha256IsNull;
		const char* ArtifactSha256; int bArtifactTextIsNull; const char* ArtifactTextHex; EFinishedResult Expected;
		const char* Digest12;
	};
	const FResultRow ResultRows[] = {
	// KAT-RESULT-BEGIN
	{ "completed_ok", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 1, "", "COMPLETED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::Completed, "887fcea6a803" },
	{ "completed_untrimmed_text_ok", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 1, "", "COMPLETED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "c2a07820790a", EFinishedResult::Completed, "887fcea6a803" },
	{ "failure_reviewer_rejected_on_200", "FAILED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 0, "reviewer_rejected", "FAILED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::FailureOutcome, "" },
	{ "failure_checker_failed_on_200", "FAILED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 0, "checker_failed", "FAILED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::FailureOutcome, "" },
	{ "failure_budget_refused_halted", "HALTED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 0, "budget_refused", "HALTED", 1, "", 1, "", EFinishedResult::FailureOutcome, "" },
	{ "failure_unknown_word_on_200", "FAILED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 0, "a_failure_nobody_has_named", "FAILED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::FailureOutcome, "" },
	{ "failure_empty_string_is_not_null", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 0, "", "COMPLETED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::FailureOutcome, "" },
	{ "state_failed_without_failure_word", "FAILED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 1, "", "FAILED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::FailureOutcome, "" },
	{ "null_artifact_sha256_and_text", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 1, "", "COMPLETED", 1, "", 1, "", EFinishedResult::NoArtifact, "" },
	{ "null_artifact_sha256_text_present", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 1, "", "COMPLETED", 1, "", 0, "782079", EFinishedResult::NoArtifact, "" },
	{ "artifact_sha_mismatch", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 1, "", "COMPLETED", 0, "187eac87a28477b1a60cf8e5540e347e090e9adef6039d04011736a3a844149c", 0, "782079", EFinishedResult::Damaged, "" },
	{ "data_state_disagrees_with_result", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 0, "checker_failed", "FAILED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::Damaged, "" },
	{ "data_mode_disagrees_with_result", "COMPLETED", "live", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "fake", 1, "", "COMPLETED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::Damaged, "" },
	{ "inner_run_id_other_run", "COMPLETED", "fake", "wlj_00000000-0000-4000-8000-000000000000", "fake", "fake", 1, "", "COMPLETED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::WrongRun, "" },
	{ "fake_answer_on_live_build", "COMPLETED", "fake", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "fake", "live", 1, "", "COMPLETED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::ModeMismatch, "" },
	{ "live_answer_on_rehearsal_build", "COMPLETED", "live", "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "live", "fake", 1, "", "COMPLETED", 0, "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", 0, "782079", EFinishedResult::ModeMismatch, "" },
	// KAT-RESULT-END
	};

	struct FUuidFormatRow { const char* Label; const char* BytesHex; const char* Expected; };
	const FUuidFormatRow UuidFormatRows[] = {
	// KAT-UUID-FORMAT-BEGIN
	{ "zeros", "00000000000000000000000000000000", "00000000-0000-4000-8000-000000000000" },
	{ "ones", "ffffffffffffffffffffffffffffffff", "ffffffff-ffff-4fff-bfff-ffffffffffff" },
	{ "counting", "000102030405060708090a0b0c0d0e0f", "00010203-0405-4607-8809-0a0b0c0d0e0f" },
	{ "sha_abc_prefix", "ba7816bf8f01cfea414140de5dae2223", "ba7816bf-8f01-4fea-8141-40de5dae2223" },
	{ "version_variant_clear", "0000000000000f003f00000000000000", "00000000-0000-4f00-bf00-000000000000" },
	{ "version_variant_set", "ffffffffffff40ffbfffffffffffffff", "ffffffff-ffff-40ff-bfff-ffffffffffff" },
	// KAT-UUID-FORMAT-END
	};

	struct FKeyRow { const char* Key; int bCanonicalUuidV4; int bBridgeKey; };
	const FKeyRow KeyRows[] = {
	// KAT-KEY-BEGIN
	{ "00000000-0000-4000-8000-000000000000", 1, 1 },
	{ "ba7816bf-8f01-4fea-8141-40de5dae2223", 1, 1 },
	{ "BA7816BF-8F01-4FEA-8141-40DE5DAE2223", 0, 1 },
	{ "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", 0, 1 },
	{ "ba7816bf-8f01-1fea-8141-40de5dae2223", 0, 1 },
	{ "ba7816bf-8f01-4fea-c141-40de5dae2223", 0, 1 },
	{ "ba7816bf8f014fea814140de5dae2223", 0, 1 },
	{ "ba7816bf:8f01-4fea-8141-40de5dae2223", 0, 0 },
	{ "1234567", 0, 0 },
	{ "12345678", 0, 1 },
	{ "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0, 1 },
	{ "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0, 0 },
	{ "", 0, 0 },
	// KAT-KEY-END
	};

	// One dispatch answered as stated (or not at all), then a second attempt that reuses the first one's values as
	// Reuse says: none (a fresh mint), run, key, both, key_as_run (wlj_ + the old key) or run_as_key (the old run
	// id's UUID as the key). Each row runs on a fresh tracker with scripted bytes: sha256 of the label, then of the
	// label + "#2" for the fresh mint.
	struct FAttemptRow
	{
		const char* Label; int HttpStatus; int bHasError; const char* ErrorKind; int bNoAnswer; const char* Reuse;
		EDispatchAnswer ExpectedAnswer; EAttemptVerdict ExpectedVerdict;
	};
	const FAttemptRow AttemptRows[] = {
	// KAT-ATTEMPT-BEGIN
	{ "repeat_already_used_409_none", 409, 1, "julius_dispatch_repeat_already_used", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "repeat_already_used_409_run", 409, 1, "julius_dispatch_repeat_already_used", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "repeat_already_used_409_key", 409, 1, "julius_dispatch_repeat_already_used", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "repeat_already_used_409_both", 409, 1, "julius_dispatch_repeat_already_used", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "repeat_already_used_409_key_as_run", 409, 1, "julius_dispatch_repeat_already_used", 0, "key_as_run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "repeat_already_used_409_run_as_key", 409, 1, "julius_dispatch_repeat_already_used", 0, "run_as_key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "cap_reached_429_none", 429, 1, "julius_dispatch_cap_reached", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "cap_reached_429_run", 429, 1, "julius_dispatch_cap_reached", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "cap_reached_429_key", 429, 1, "julius_dispatch_cap_reached", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "cap_reached_429_both", 429, 1, "julius_dispatch_cap_reached", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "cap_reached_429_key_as_run", 429, 1, "julius_dispatch_cap_reached", 0, "key_as_run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "cap_reached_429_run_as_key", 429, 1, "julius_dispatch_cap_reached", 0, "run_as_key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "mission_cap_reached_429_none", 429, 1, "julius_dispatch_mission_cap_reached", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "mission_cap_reached_429_run", 429, 1, "julius_dispatch_mission_cap_reached", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "mission_cap_reached_429_key", 429, 1, "julius_dispatch_mission_cap_reached", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "mission_cap_reached_429_both", 429, 1, "julius_dispatch_mission_cap_reached", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "mission_cap_reached_429_key_as_run", 429, 1, "julius_dispatch_mission_cap_reached", 0, "key_as_run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "mission_cap_reached_429_run_as_key", 429, 1, "julius_dispatch_mission_cap_reached", 0, "run_as_key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "creator_mismatch_403_none", 403, 1, "julius_dispatch_run_creator_mismatch", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "creator_mismatch_403_run", 403, 1, "julius_dispatch_run_creator_mismatch", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "creator_mismatch_403_key", 403, 1, "julius_dispatch_run_creator_mismatch", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "creator_mismatch_403_both", 403, 1, "julius_dispatch_run_creator_mismatch", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "key_reused_409_none", 409, 1, "julius_dispatch_key_reused", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "key_reused_409_run", 409, 1, "julius_dispatch_key_reused", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "key_reused_409_key", 409, 1, "julius_dispatch_key_reused", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "key_reused_409_both", 409, 1, "julius_dispatch_key_reused", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "already_dispatched_409_none", 409, 1, "julius_dispatch_already_dispatched", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "already_dispatched_409_run", 409, 1, "julius_dispatch_already_dispatched", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "already_dispatched_409_key", 409, 1, "julius_dispatch_already_dispatched", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "already_dispatched_409_both", 409, 1, "julius_dispatch_already_dispatched", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "busy_429_none", 429, 1, "julius_dispatch_busy", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "busy_429_run", 429, 1, "julius_dispatch_busy", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "busy_429_key", 429, 1, "julius_dispatch_busy", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "busy_429_both", 429, 1, "julius_dispatch_busy", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "busy_429_key_as_run", 429, 1, "julius_dispatch_busy", 0, "key_as_run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "busy_429_run_as_key", 429, 1, "julius_dispatch_busy", 0, "run_as_key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "unknown_kind_on_429_none", 429, 1, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "unknown_kind_on_429_both", 429, 1, "julius_dispatch_kind_nobody_has_named", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "cap_kind_case_variant_429_none", 429, 1, "JULIUS_DISPATCH_CAP_REACHED", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "cap_kind_padded_429_none", 429, 1, "julius_dispatch_cap_reached ", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "flag_without_kind_on_429_none", 429, 1, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "error_kind_on_302_none", 302, 1, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "error_kind_on_302_both", 302, 1, "julius_dispatch_kind_nobody_has_named", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "error_kind_on_300_none", 300, 1, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "error_kind_on_399_none", 399, 1, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_199_no_error_none", 199, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_199_no_error_both", 199, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "error_kind_on_199_none", 199, 1, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "key_invalid_400_none", 400, 1, "julius_dispatch_idempotency_key_invalid", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "key_invalid_400_run", 400, 1, "julius_dispatch_idempotency_key_invalid", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "key_invalid_400_key", 400, 1, "julius_dispatch_idempotency_key_invalid", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "key_invalid_400_both", 400, 1, "julius_dispatch_idempotency_key_invalid", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "unknown_kind_on_200_none", 200, 1, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "unknown_kind_on_200_run", 200, 1, "julius_dispatch_kind_nobody_has_named", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "unknown_kind_on_200_key", 200, 1, "julius_dispatch_kind_nobody_has_named", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "unknown_kind_on_200_both", 200, 1, "julius_dispatch_kind_nobody_has_named", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "flag_without_kind_on_200_none", 200, 1, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "flag_without_kind_on_200_run", 200, 1, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "flag_without_kind_on_200_key", 200, 1, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "flag_without_kind_on_200_both", 200, 1, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "kind_without_flag_on_202_none", 202, 0, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "kind_without_flag_on_202_run", 202, 0, "julius_dispatch_kind_nobody_has_named", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "kind_without_flag_on_202_key", 202, 0, "julius_dispatch_kind_nobody_has_named", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "kind_without_flag_on_202_both", 202, 0, "julius_dispatch_kind_nobody_has_named", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "status_500_no_error_none", 500, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_500_no_error_run", 500, 0, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_500_no_error_key", 500, 0, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_500_no_error_both", 500, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "status_302_no_error_none", 302, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_302_no_error_run", 302, 0, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_302_no_error_key", 302, 0, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_302_no_error_both", 302, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "accepted_202_none", 202, 0, "", 0, "none", EDispatchAnswer::Accepted, EAttemptVerdict::Admitted },
	{ "accepted_202_run", 202, 0, "", 0, "run", EDispatchAnswer::Accepted, EAttemptVerdict::RunIdReused },
	{ "accepted_202_key", 202, 0, "", 0, "key", EDispatchAnswer::Accepted, EAttemptVerdict::KeyReused },
	{ "accepted_202_both", 202, 0, "", 0, "both", EDispatchAnswer::Accepted, EAttemptVerdict::RunIdReused },
	{ "accepted_202_key_as_run", 202, 0, "", 0, "key_as_run", EDispatchAnswer::Accepted, EAttemptVerdict::RunIdReused },
	{ "accepted_202_run_as_key", 202, 0, "", 0, "run_as_key", EDispatchAnswer::Accepted, EAttemptVerdict::KeyReused },
	{ "replayed_200_none", 200, 0, "", 0, "none", EDispatchAnswer::Accepted, EAttemptVerdict::Admitted },
	{ "replayed_200_run", 200, 0, "", 0, "run", EDispatchAnswer::Accepted, EAttemptVerdict::RunIdReused },
	{ "replayed_200_key", 200, 0, "", 0, "key", EDispatchAnswer::Accepted, EAttemptVerdict::KeyReused },
	{ "replayed_200_both", 200, 0, "", 0, "both", EDispatchAnswer::Accepted, EAttemptVerdict::RunIdReused },
	{ "replayed_200_key_as_run", 200, 0, "", 0, "key_as_run", EDispatchAnswer::Accepted, EAttemptVerdict::RunIdReused },
	{ "replayed_200_run_as_key", 200, 0, "", 0, "run_as_key", EDispatchAnswer::Accepted, EAttemptVerdict::KeyReused },
	{ "no_answer_none", 0, 0, "", 1, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "no_answer_run", 0, 0, "", 1, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "no_answer_key", 0, 0, "", 1, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "no_answer_both", 0, 0, "", 1, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "no_answer_key_as_run", 0, 0, "", 1, "key_as_run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "no_answer_run_as_key", 0, 0, "", 1, "run_as_key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_503_no_error_none", 503, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_503_no_error_run", 503, 0, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_503_no_error_key", 503, 0, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_503_no_error_both", 503, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "status_503_no_error_key_as_run", 503, 0, "", 0, "key_as_run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_503_no_error_run_as_key", 503, 0, "", 0, "run_as_key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_502_no_error_none", 502, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_502_no_error_run", 502, 0, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_502_no_error_key", 502, 0, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_502_no_error_both", 502, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "status_404_no_error_none", 404, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_404_no_error_run", 404, 0, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_404_no_error_key", 404, 0, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_404_no_error_both", 404, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "status_0_no_error_none", 0, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_0_no_error_run", 0, 0, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_0_no_error_key", 0, 0, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_0_no_error_both", 0, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "status_101_no_error_none", 101, 0, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_101_no_error_run", 101, 0, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_101_no_error_key", 101, 0, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "status_101_no_error_both", 101, 0, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "disabled_503_none", 503, 1, "julius_dispatch_disabled", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "disabled_503_run", 503, 1, "julius_dispatch_disabled", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "disabled_503_key", 503, 1, "julius_dispatch_disabled", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "disabled_503_both", 503, 1, "julius_dispatch_disabled", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "ledger_unavailable_503_none", 503, 1, "julius_dispatch_ledger_unavailable", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "ledger_unavailable_503_run", 503, 1, "julius_dispatch_ledger_unavailable", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "ledger_unavailable_503_key", 503, 1, "julius_dispatch_ledger_unavailable", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "ledger_unavailable_503_both", 503, 1, "julius_dispatch_ledger_unavailable", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "ledger_unavailable_503_key_as_run", 503, 1, "julius_dispatch_ledger_unavailable", 0, "key_as_run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "ledger_unavailable_503_run_as_key", 503, 1, "julius_dispatch_ledger_unavailable", 0, "run_as_key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "sign_in_required_401_none", 401, 1, "sign_in_required", 0, "none", EDispatchAnswer::Refused, EAttemptVerdict::Admitted },
	{ "sign_in_required_401_run", 401, 1, "sign_in_required", 0, "run", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "sign_in_required_401_key", 401, 1, "sign_in_required", 0, "key", EDispatchAnswer::Refused, EAttemptVerdict::KeyReused },
	{ "sign_in_required_401_both", 401, 1, "sign_in_required", 0, "both", EDispatchAnswer::Refused, EAttemptVerdict::RunIdReused },
	{ "flag_without_kind_on_503_none", 503, 1, "", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "flag_without_kind_on_503_run", 503, 1, "", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "flag_without_kind_on_503_key", 503, 1, "", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "flag_without_kind_on_503_both", 503, 1, "", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "kind_without_flag_on_409_none", 409, 0, "julius_dispatch_already_dispatched", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "kind_without_flag_on_409_run", 409, 0, "julius_dispatch_already_dispatched", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "kind_without_flag_on_409_key", 409, 0, "julius_dispatch_already_dispatched", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "kind_without_flag_on_409_both", 409, 0, "julius_dispatch_already_dispatched", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	{ "error_on_status_600_none", 600, 1, "julius_dispatch_kind_nobody_has_named", 0, "none", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "error_on_status_600_run", 600, 1, "julius_dispatch_kind_nobody_has_named", 0, "run", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "error_on_status_600_key", 600, 1, "julius_dispatch_kind_nobody_has_named", 0, "key", EDispatchAnswer::NoAnswer, EAttemptVerdict::PreviousAttemptUnanswered },
	{ "error_on_status_600_both", 600, 1, "julius_dispatch_kind_nobody_has_named", 0, "both", EDispatchAnswer::NoAnswer, EAttemptVerdict::Admitted },
	// KAT-ATTEMPT-END
	};

	// The artifact is PrefixHex x PrefixRepeat + TailHex, as the wrapper hands it over. Expected signals follow.
	struct FQualificationRow
	{
		const char* Label; const char* PrefixHex; unsigned long PrefixRepeat; const char* TailHex; EFinishedResult Finished;
		int bEvidencePresent; int bIndependentlyVerified; const char* OriginalSha256; const char* TransformedSha256;
		const char* ArtifactSha256; EArtifactQualification Expected; int bScrubMarker; int bAtCutLimit; int bOverCutLimit;
		unsigned long Utf16Units;
	};
	const FQualificationRow QualificationRows[] = {
	// KAT-QUALIFICATION-BEGIN
	{ "plain_short", "782079", 1, "", EFinishedResult::Completed, 0, 0, "", "", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", EArtifactQualification::NoTransformSignal, 0, 0, 0, 3 },
	{ "x_7999_under_limit", "78", 7999, "", EFinishedResult::Completed, 0, 0, "", "", "73567ed88956e8bcdfd402c9fee6e0c901b4da3411a176ec411e8f0a1333d553", EArtifactQualification::NoTransformSignal, 0, 0, 0, 7999 },
	{ "x_8000_at_limit", "78", 8000, "", EFinishedResult::Completed, 0, 0, "", "", "606023a37d97fcdf274ba51ba151162099d397bbe006fcff0868b348c950f51c", EArtifactQualification::TransformedUnverified, 0, 1, 0, 8000 },
	{ "cut_split_pair_ufffd_at_limit", "78", 7999, "efbfbd", EFinishedResult::Completed, 0, 0, "", "", "b4296284858e3171fbd96d387db64fa551a4173aed40e5ea9bf8dc273465d933", EArtifactQualification::TransformedUnverified, 0, 1, 0, 8000 },
	{ "pair_fits_at_limit", "78", 7998, "f09f9880", EFinishedResult::Completed, 0, 0, "", "", "4222777fbde458ad9b9910df41e08b29f483fe60e0d03f62ec95ed3faf98ae49", EArtifactQualification::TransformedUnverified, 0, 1, 0, 8000 },
	{ "over_limit_never_from_bridge", "78", 7999, "f09f9880", EFinishedResult::Completed, 0, 0, "", "", "dfe7ec2caffe73954698fc78ed6f5a794f73e8acac847473305b5a7b6e0b2eb7", EArtifactQualification::EvidenceInconsistent, 0, 0, 1, 8001 },
	{ "over_limit_even_with_evidence", "78", 8001, "", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "6ee9494a9027b9a16e91218594b26ddd379b65f9e6d1739877be658bf2cc6f1e", "6ee9494a9027b9a16e91218594b26ddd379b65f9e6d1739877be658bf2cc6f1e", EArtifactQualification::EvidenceInconsistent, 0, 0, 1, 8001 },
	{ "redacted_marker_short", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 0, 0, "", "", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::TransformedUnverified, 1, 0, 0, 10 },
	{ "redacted_marker_spoofed_by_coder", "616e73776572", 1, "5b72656461637465645d", EFinishedResult::Completed, 0, 0, "", "", "05748f94376a80e8eb9f3afbe161e8e56bf260144cea5120bc44be43e5b644ca", EArtifactQualification::TransformedUnverified, 1, 0, 0, 16 },
	{ "uppercase_marker_is_not_scrub", "5b52454441435445445d", 1, "", EFinishedResult::Completed, 0, 0, "", "", "e54b74eb9192b48055c48d2062bffdd23469ef7d70f960ff1293a47f86c8eba2", EArtifactQualification::NoTransformSignal, 0, 0, 0, 10 },
	{ "partial_marker_cut_at_limit", "78", 7995, "5b72656461", EFinishedResult::Completed, 0, 0, "", "", "00a5ecf9595444194fc494970a115b97cc7c2543de88fec0d82343b520de4247", EArtifactQualification::TransformedUnverified, 0, 1, 0, 8000 },
	{ "marker_with_verified_evidence", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::TransformedVerified, 1, 0, 0, 10 },
	{ "verified_evidence_whitespace_around_text", "20", 1, "5b72656461637465645d0a", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::TransformedVerified, 1, 0, 0, 12 },
	{ "verified_evidence_sha_of_untrimmed_text", "20", 1, "5b72656461637465645d0a", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "d5d24215d7a39f0d23dcd5dff65ce859bd3cae80319c329702bcec21230354c6", "d5d24215d7a39f0d23dcd5dff65ce859bd3cae80319c329702bcec21230354c6", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 12 },
	{ "at_limit_with_verified_evidence", "78", 8000, "", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "606023a37d97fcdf274ba51ba151162099d397bbe006fcff0868b348c950f51c", "606023a37d97fcdf274ba51ba151162099d397bbe006fcff0868b348c950f51c", EArtifactQualification::TransformedVerified, 0, 1, 0, 8000 },
	{ "evidence_not_independently_verified", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 1, 0, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 10 },
	{ "evidence_transformed_hash_mismatch", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 10 },
	{ "evidence_missing_original", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 1, 1, "", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 10 },
	{ "evidence_uppercase_original", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 1, 1, "A8100AE6AA1940D0B663BB31CD466142EBBDBD5187131B92D93818987832EB89", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 10 },
	{ "evidence_short_transformed", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c1", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c1", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 10 },
	{ "verified_flag_without_present", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 0, 1, "", "", "017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 10 },
	{ "hashes_without_present", "782079", 1, "", EFinishedResult::Completed, 0, 0, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", EArtifactQualification::EvidenceInconsistent, 0, 0, 0, 3 },
	{ "not_completed_failure", "5b72656461637465645d", 1, "", EFinishedResult::FailureOutcome, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", EArtifactQualification::NotCompleted, 1, 0, 0, 10 },
	{ "not_completed_damaged", "782079", 1, "", EFinishedResult::Damaged, 0, 0, "", "", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", EArtifactQualification::NotCompleted, 0, 0, 0, 3 },
	{ "not_completed_no_artifact", "", 1, "", EFinishedResult::NoArtifact, 0, 0, "", "", "", EArtifactQualification::NotCompleted, 0, 0, 0, 0 },
	{ "malformed_utf8_unreadable", "78", 7999, "eda0bd", EFinishedResult::Completed, 0, 0, "", "", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", EArtifactQualification::Unreadable, 0, 0, 0, 0 },
	{ "trim_hid_scrub_partial_marker", "78", 7994, "5b72656461", EFinishedResult::Completed, 0, 0, "", "", "bec1a4213b1c245b3be26dc882621bb69a0f1a9579121a21721f8668beb9fa91", EArtifactQualification::NoTransformSignal, 0, 0, 0, 7999 },
	{ "trim_hid_cut", "79", 7999, "", EFinishedResult::Completed, 0, 0, "", "", "5d4cf6d2f04ba905e83644eb987ccd3e34acece56dd83d1c2061e253f41525a6", EArtifactQualification::NoTransformSignal, 0, 0, 0, 7999 },
	{ "verified_evidence_sha_not_of_text", "5b72656461637465645d", 1, "", EFinishedResult::Completed, 1, 1, "a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", "887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19", EArtifactQualification::EvidenceInconsistent, 1, 0, 0, 10 },
	// KAT-QUALIFICATION-END
	};

	// Every qualification and how the game shows it. There is no qualifying value to show.
	struct FDisplayRow { const char* Label; EArtifactQualification Qualification; EQualificationDisplay Expected; const char* Words; };
	const FDisplayRow DisplayRows[] = {
	// KAT-DISPLAY-BEGIN
	{ "not_completed", EArtifactQualification::NotCompleted, EQualificationDisplay::NotQualifying, "not qualifying" },
	{ "no_transform_signal", EArtifactQualification::NoTransformSignal, EQualificationDisplay::PendingJudge, "pending judge" },
	{ "transformed_unverified", EArtifactQualification::TransformedUnverified, EQualificationDisplay::Unverified, "unverified" },
	{ "transformed_verified", EArtifactQualification::TransformedVerified, EQualificationDisplay::PendingJudge, "pending judge" },
	{ "evidence_inconsistent", EArtifactQualification::EvidenceInconsistent, EQualificationDisplay::NotQualifying, "not qualifying" },
	{ "unreadable", EArtifactQualification::Unreadable, EQualificationDisplay::NotQualifying, "not qualifying" },
	// KAT-DISPLAY-END
	};

	// The source hands out Available of the two blocks, then reports failure. A failure is a refusal: no id at all.
	struct FMintRow
	{
		const char* Label; int Available; const char* RunBytesHex; const char* KeyBytesHex; EMintResult Expected;
		const char* RunId; const char* Key;
	};
	const FMintRow MintRows[] = {
	// KAT-MINT-BEGIN
	{ "source_fails_at_once", 0, "ba7816bf8f01cfea414140de5dae2223", "000102030405060708090a0b0c0d0e0f", EMintResult::RandomUnavailable, "", "" },
	{ "source_fails_on_key", 1, "ba7816bf8f01cfea414140de5dae2223", "000102030405060708090a0b0c0d0e0f", EMintResult::RandomUnavailable, "", "" },
	{ "stuck_source", 2, "ba7816bf8f01cfea414140de5dae2223", "ba7816bf8f01cfea414140de5dae2223", EMintResult::RandomRepeated, "", "" },
	{ "bytes_equal_after_version_bits", 2, "ba7816bf8f010fea014140de5dae2223", "ba7816bf8f01cfea814140de5dae2223", EMintResult::RandomRepeated, "", "" },
	{ "both_blocks_ok", 2, "ba7816bf8f01cfea414140de5dae2223", "000102030405060708090a0b0c0d0e0f", EMintResult::Minted, "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "00010203-0405-4607-8809-0a0b0c0d0e0f" },
	{ "uppercase_free_from_high_bytes", 2, "ffffffffffffffffffffffffffffffff", "cafebabedeadbeefcafebabedeadbeef", EMintResult::Minted, "wlj_ffffffff-ffff-4fff-bfff-ffffffffffff", "cafebabe-dead-4eef-8afe-babedeadbeef" },
	// KAT-MINT-END
	};

	/** A scripted byte source: hands out the given 16-byte blocks in order, then fails. Never an RNG. */
	class FScriptedBytes final : public IRandomBytes16
	{
	public:
		std::vector<std::string> Blocks;
		std::size_t Next = 0;
		bool Fill(std::uint8_t (&OutBytes)[16]) override
		{
			if (Next >= Blocks.size()) { return false; }
			for (unsigned Index = 0; Index < 16; ++Index) { OutBytes[Index] = static_cast<std::uint8_t>(Blocks[Next][Index]); }
			++Next;
			return true;
		}
	};

	/** Two 16-byte blocks from sha256(Seed): the first half for a run id, the second for a key. */
	void PushSeed(FScriptedBytes& Source, const std::string& Seed)
	{
		const FSha256Digest Digest = Sha256(Seed);
		Source.Blocks.emplace_back(reinterpret_cast<const char*>(Digest.data()), 16);
		Source.Blocks.emplace_back(reinterpret_cast<const char*>(Digest.data()) + 16, 16);
	}

	template <typename T, std::size_t N>
	constexpr std::size_t CountOf(const T (&)[N]) { return N; }
}

int main()
{
	for (const FShaRow& Row : ShaRows)
	{
		std::string Input;
		const std::string Unit = FromHex(Row.InputHex);
		for (unsigned long Index = 0; Index < Row.Repeat; ++Index) { Input += Unit; }
		const std::string Got = Sha256Hex(Input);
		Expect(Got == Row.Expected, std::string("sha256 ") + Row.Label + ": got " + Got + " want " + Row.Expected);
	}

	for (const FTrimRow& Row : TrimRows)
	{
		std::string Got;
		const bool bValid = JsTrimUtf8(FromHex(Row.InputHex), Got);
		Expect(bValid == (Row.bValid != 0), std::string("trim validity ") + Row.Label);
		Expect(Got == FromHex(Row.ExpectedHex), std::string("trim output ") + Row.Label);
	}
	Expect(!IsJsTrimWhitespace(0x0085) && !IsJsTrimWhitespace(0x200B) && !IsJsTrimWhitespace(0x180E),
		"NEL, ZWSP and U+180E are not JS trim whitespace");

	for (const FDigestRow& Row : DigestRows)
	{
		std::string Digest12 = "not-cleared";
		const bool bOk = CheckArtifactDigest(FromHex(Row.ArtifactHex), Row.ExpectedSha256, Digest12);
		Expect(bOk == (Row.bOk != 0), std::string("digest verdict ") + Row.Label);
		Expect(Digest12 == Row.Digest12, std::string("digest12 ") + Row.Label + ": got " + Digest12);
	}

	for (const FDigestCutRow& Row : DigestCutRows)
	{
		std::string Artifact;
		const std::string Unit = FromHex(Row.PrefixHex);
		for (unsigned long Index = 0; Index < Row.PrefixRepeat; ++Index) { Artifact += Unit; }
		Artifact += FromHex(Row.TailHex);
		std::string Digest12 = "not-cleared";
		const bool bOk = CheckArtifactDigest(Artifact, Row.ExpectedSha256, Digest12);
		Expect(bOk == (Row.bOk != 0), std::string("digest cut verdict ") + Row.Label);
		Expect(Digest12 == Row.Digest12, std::string("digest cut digest12 ") + Row.Label + ": got " + Digest12);

		FFinishedResultFields Fields;
		Fields.ExpectedRunId = ExpectedRunId;
		Fields.ExpectedMode = "fake";
		Fields.DataState = "COMPLETED";
		Fields.DataMode = "fake";
		Fields.InnerRunId = ExpectedRunId;
		Fields.Mode = "fake";
		Fields.State = "COMPLETED";
		Fields.bArtifactSha256IsNull = false;
		Fields.ArtifactSha256 = Row.ExpectedSha256;
		Fields.bArtifactTextIsNull = false;
		Fields.ArtifactText = Artifact;
		std::string ResultDigest12 = "not-cleared";
		const EFinishedResult Got = ClassifyFinishedResult(Fields, ResultDigest12);
		Expect(Got == (Row.bOk != 0 ? EFinishedResult::Completed : EFinishedResult::Damaged),
			std::string("digest cut result ") + Row.Label + ": got " + std::to_string(static_cast<int>(Got)));
		Expect(ResultDigest12 == Row.Digest12, std::string("digest cut result digest12 ") + Row.Label + ": got " + ResultDigest12);
	}

	for (const FRunFormatRow& Row : RunFormatRows)
	{
		const std::string Bytes = FromHex(Row.BytesHex);
		std::uint8_t Raw[16];
		for (unsigned Index = 0; Index < 16; ++Index) { Raw[Index] = static_cast<std::uint8_t>(Bytes[Index]); }
		const std::string Got = FormatRunIdFromBytes(Raw);
		Expect(Got == Row.Expected, std::string("run id format ") + Row.Label + ": got " + Got);
	}

	for (const FRunStrictRow& Row : RunStrictRows)
	{
		Expect(IsStrictRunId(Row.RunId) == (Row.bStrict != 0), std::string("strict run id: ") + Row.RunId);
		Expect(IsBridgeRunId(Row.RunId) == (Row.bBridge != 0), std::string("bridge run id: ") + Row.RunId);
	}

	// 10,000 ids from deterministic bytes (sha256 of a counter; no RNG): every one strict, bridge-valid, 40 chars,
	// prefixed, and all distinct. This exercises the production formatter, not the generator it will later get.
	std::set<std::string> Generated;
	for (int Index = 0; Index < 10000; ++Index)
	{
		const FSha256Digest Seed = Sha256("j1-runid-" + std::to_string(Index));
		std::uint8_t Raw[16];
		for (unsigned Byte = 0; Byte < 16; ++Byte) { Raw[Byte] = Seed[Byte]; }
		const std::string Id = FormatRunIdFromBytes(Raw);
		if (!IsStrictRunId(Id) || !IsBridgeRunId(Id) || Id.size() != 40 || Id.compare(0, 4, "wlj_") != 0)
		{
			Expect(false, "generated run id " + Id);
		}
		Generated.insert(Id);
	}
	Expect(Generated.size() == 10000, "10,000 generated run ids are distinct");

	for (const FEnvelopeRow& Row : EnvelopeRows)
	{
		const std::string Text = FromHex(Row.ResultTextHex);
		const EResultEnvelope Got = ClassifyResultEnvelope(Row.HttpStatus, Row.bHasData != 0, Row.bHasError != 0,
			Row.ErrorKind, Row.DataRunId, ExpectedRunId, Text, Row.ResultSha256);
		Expect(Got == Row.Expected, std::string("envelope ") + Row.Label + ": got " + std::to_string(static_cast<int>(Got)));
	}

	for (const FResultRow& Row : ResultRows)
	{
		const std::string Text = FromHex(Row.ArtifactTextHex);
		FFinishedResultFields Fields;
		Fields.ExpectedRunId = ExpectedRunId;
		Fields.ExpectedMode = Row.ExpectedMode;
		Fields.DataState = Row.DataState;
		Fields.DataMode = Row.DataMode;
		Fields.InnerRunId = Row.InnerRunId;
		Fields.Mode = Row.Mode;
		Fields.bFailureIsNull = Row.bFailureIsNull != 0;
		Fields.Failure = Row.Failure;
		Fields.State = Row.State;
		Fields.bArtifactSha256IsNull = Row.bArtifactSha256IsNull != 0;
		Fields.ArtifactSha256 = Row.ArtifactSha256;
		Fields.bArtifactTextIsNull = Row.bArtifactTextIsNull != 0;
		Fields.ArtifactText = Text;
		std::string Digest12 = "not-cleared";
		const EFinishedResult Got = ClassifyFinishedResult(Fields, Digest12);
		Expect(Got == Row.Expected, std::string("result ") + Row.Label + ": got " + std::to_string(static_cast<int>(Got)));
		Expect(Digest12 == Row.Digest12, std::string("result digest12 ") + Row.Label + ": got " + Digest12);
	}

	for (const FUuidFormatRow& Row : UuidFormatRows)
	{
		const std::string Bytes = FromHex(Row.BytesHex);
		std::uint8_t Raw[16];
		for (unsigned Index = 0; Index < 16; ++Index) { Raw[Index] = static_cast<std::uint8_t>(Bytes[Index]); }
		const std::string Got = FormatUuidV4FromBytes(Raw);
		Expect(Got == Row.Expected, std::string("uuid format ") + Row.Label + ": got " + Got);
		Expect(IsCanonicalUuidV4(Got) && IsBridgeRunId(Got) && IsBridgeIdempotencyKey(Got), std::string("uuid rules ") + Row.Label);
		Expect(FormatRunIdFromBytes(Raw) == std::string(RunIdPrefix) + Got, std::string("run id is the prefix + the uuid ") + Row.Label);
	}

	for (const FKeyRow& Row : KeyRows)
	{
		Expect(IsCanonicalUuidV4(Row.Key) == (Row.bCanonicalUuidV4 != 0), std::string("canonical uuidv4: ") + Row.Key);
		Expect(IsBridgeIdempotencyKey(Row.Key) == (Row.bBridgeKey != 0), std::string("bridge key: ") + Row.Key);
	}

	for (const FAttemptRow& Row : AttemptRows)
	{
		const std::string Label = Row.Label;
		FDispatchAttemptTracker Tracker;
		FScriptedBytes Source;
		PushSeed(Source, Label);
		PushSeed(Source, Label + "#2");
		FDispatchAttempt First;
		Expect(Tracker.MintAttempt(Source, First) == EMintResult::Minted, "attempt first mint " + Label);
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::Admitted, "attempt first admitted " + Label);
		const EDispatchAnswer Answer = Row.bNoAnswer != 0 ? EDispatchAnswer::NoAnswer
			: ClassifyDispatchAnswer(Row.HttpStatus, Row.bHasError != 0, Row.ErrorKind);
		Expect(Answer == Row.ExpectedAnswer, "attempt answer " + Label + ": got " + std::to_string(static_cast<int>(Answer)));
		Expect(Tracker.RecordAnswer(Answer), "attempt answer recorded " + Label);
		FDispatchAttempt Fresh;
		Expect(Tracker.MintAttempt(Source, Fresh) == EMintResult::Minted, "attempt fresh mint " + Label);
		FDispatchAttempt Second = Fresh;
		const std::string Reuse = Row.Reuse;
		if (Reuse == "run" || Reuse == "both") { Second.RunId = First.RunId; }
		if (Reuse == "key" || Reuse == "both") { Second.IdempotencyKey = First.IdempotencyKey; }
		if (Reuse == "key_as_run") { Second.RunId = std::string(RunIdPrefix) + First.IdempotencyKey; }
		if (Reuse == "run_as_key") { Second.IdempotencyKey = First.RunId.substr(RunIdPrefix.size()); }
		const EAttemptVerdict Got = Tracker.BeginAttempt(Second);
		Expect(Got == Row.ExpectedVerdict, "attempt verdict " + Label + ": got " + std::to_string(static_cast<int>(Got)));
	}

	{
		// The mint itself: exact known answers from scripted bytes, the bridge's rules, and every failure path.
		FDispatchAttemptTracker Tracker;
		FScriptedBytes Source;
		Source.Blocks = { FromHex("ba7816bf8f01cfea414140de5dae2223"), FromHex("000102030405060708090a0b0c0d0e0f") };
		FDispatchAttempt Minted;
		Expect(Tracker.MintAttempt(Source, Minted) == EMintResult::Minted, "mint known answer");
		Expect(Minted.RunId == "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "mint run id known answer: " + Minted.RunId);
		Expect(Minted.IdempotencyKey == "00010203-0405-4607-8809-0a0b0c0d0e0f", "mint key known answer: " + Minted.IdempotencyKey);
		Expect(IsStrictRunId(Minted.RunId) && IsBridgeRunId(Minted.RunId), "minted run id passes both run-id rules");
		Expect(IsCanonicalUuidV4(Minted.IdempotencyKey) && IsBridgeIdempotencyKey(Minted.IdempotencyKey), "minted key passes both key rules");
		Expect(!Tracker.HasOpenAttempt(), "minting opens nothing");
		Expect(!Tracker.RecordAnswer(EDispatchAnswer::Refused), "an answer with no open attempt is not recorded");

		FDispatchAttempt Cleared{ "stale", "stale" };
		Expect(Tracker.MintAttempt(Source, Cleared) == EMintResult::RandomUnavailable, "a failed source mints nothing");
		Expect(Cleared.RunId.empty() && Cleared.IdempotencyKey.empty(), "a failed mint clears its output");
		FScriptedBytes HalfSource;
		HalfSource.Blocks = { FromHex("ba7816bf8f01cfea414140de5dae2223") };
		Expect(Tracker.MintAttempt(HalfSource, Cleared) == EMintResult::RandomUnavailable, "a source failing on the key mints nothing");
		Expect(Cleared.RunId.empty(), "a half mint leaves no run id behind");

		FScriptedBytes Stuck;
		Stuck.Blocks = { FromHex("ba7816bf8f01cfea414140de5dae2223"), FromHex("ba7816bf8f01cfea414140de5dae2223") };
		Expect(Tracker.MintAttempt(Stuck, Cleared) == EMintResult::RandomRepeated, "a stuck source (run id == key) is refused");

		Expect(Tracker.BeginAttempt(Minted) == EAttemptVerdict::Admitted, "the minted pair is admitted");
		Expect(Tracker.HasOpenAttempt(), "an admitted attempt is open");
		FScriptedBytes Replay;
		Replay.Blocks = { FromHex("000102030405060708090a0b0c0d0e0f"), FromHex("ffffffffffffffffffffffffffffffff") };
		Expect(Tracker.MintAttempt(Replay, Cleared) == EMintResult::RandomRepeated, "bytes repeating the open key are refused");
		Expect(Tracker.RecordAnswer(EDispatchAnswer::NoAnswer) && Tracker.HasOpenAttempt(), "no answer keeps the attempt open");
		Expect(Tracker.BeginAttempt(Minted) == EAttemptVerdict::Admitted, "the identical pair is resent after no answer");
		Expect(Tracker.RecordAnswer(EDispatchAnswer::Refused) && !Tracker.HasOpenAttempt(), "the refusal closes it");
		Expect(Tracker.BeginAttempt(Minted) == EAttemptVerdict::RunIdReused, "the refused pair is never resent");
		FScriptedBytes Repeat;
		Repeat.Blocks = { FromHex("ba7816bf8f01cfea414140de5dae2223"), FromHex("ffffffffffffffffffffffffffffffff") };
		Expect(Tracker.MintAttempt(Repeat, Cleared) == EMintResult::RandomRepeated, "bytes repeating a spent run id are refused");
		FScriptedBytes RepeatKey;
		RepeatKey.Blocks = { FromHex("ffffffffffffffffffffffffffffffff"), FromHex("000102030405060708090a0b0c0d0e0f") };
		Expect(Tracker.MintAttempt(RepeatKey, Cleared) == EMintResult::RandomRepeated, "bytes repeating a spent key are refused");

		const struct { const char* RunId; const char* Key; EAttemptVerdict Expected; } Malformed[] = {
			{ "ba7816bf-8f01-4fea-8141-40de5dae2224", "11111111-1111-4111-8111-111111111111", EAttemptVerdict::MalformedRunId },
			{ "wlj_BA7816BF-8F01-4FEA-8141-40DE5DAE2224", "11111111-1111-4111-8111-111111111111", EAttemptVerdict::MalformedRunId },
			{ "wlx_ba7816bf-8f01-4fea-8141-40de5dae2224", "11111111-1111-4111-8111-111111111111", EAttemptVerdict::MalformedRunId },
			{ "wlj_ba7816bf-8f01-1fea-8141-40de5dae2224", "11111111-1111-4111-8111-111111111111", EAttemptVerdict::MalformedRunId },
			{ "", "11111111-1111-4111-8111-111111111111", EAttemptVerdict::MalformedRunId },
			{ "wlj_ba7816bf-8f01-4fea-8141-40de5dae2224", "wlj_11111111-1111-4111-8111-111111111111", EAttemptVerdict::MalformedKey },
			{ "wlj_ba7816bf-8f01-4fea-8141-40de5dae2224", "11111111111141118111111111111111", EAttemptVerdict::MalformedKey },
			{ "wlj_ba7816bf-8f01-4fea-8141-40de5dae2224", "", EAttemptVerdict::MalformedKey },
			{ "wlj_ba7816bf-8f01-4fea-8141-40de5dae2224", "ba7816bf-8f01-4fea-8141-40de5dae2224", EAttemptVerdict::KeyEqualsRunId },
		};
		for (const auto& Case : Malformed)
		{
			Expect(Tracker.BeginAttempt(FDispatchAttempt{ Case.RunId, Case.Key }) == Case.Expected,
				std::string("malformed attempt ") + Case.RunId + " / " + Case.Key);
		}
		Expect(!Tracker.HasOpenAttempt(), "a refused verdict opens nothing");
	}

	{
		// RID-6 (Skywalker on 8c92608a): the first send times out; the identical resend meets 429 julius_dispatch_busy
		// while J1 is still reserving the first send, which then starts. Busy keeps the pair open and never re-mints.
		FDispatchAttemptTracker Tracker;
		FScriptedBytes Source;
		PushSeed(Source, "rid6");
		PushSeed(Source, "rid6#2");
		PushSeed(Source, "rid6#3");
		FDispatchAttempt First;
		Expect(Tracker.MintAttempt(Source, First) == EMintResult::Minted, "rid6 first mint");
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::Admitted, "rid6 first send");
		Expect(Tracker.RecordAnswer(EDispatchAnswer::NoAnswer) && Tracker.HasOpenAttempt(), "rid6 timeout keeps it open");
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::Admitted, "rid6 identical resend");
		const EDispatchAnswer Busy = ClassifyDispatchAnswer(429, true, "julius_dispatch_busy");
		Expect(Busy == EDispatchAnswer::NoAnswer, "rid6 busy is no answer");
		Expect(Tracker.RecordAnswer(Busy) && Tracker.HasOpenAttempt(), "rid6 busy keeps the pair open");
		FDispatchAttempt Fresh;
		Expect(Tracker.MintAttempt(Source, Fresh) == EMintResult::Minted, "rid6 fresh mint");
		Expect(Tracker.BeginAttempt(Fresh) == EAttemptVerdict::PreviousAttemptUnanswered, "rid6 no fresh pair while busy");
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::Admitted, "rid6 resend after the wait");
		const EDispatchAnswer Replay = ClassifyDispatchAnswer(200, false, "");
		Expect(Replay == EDispatchAnswer::Accepted, "rid6 replay accepted");
		Expect(Tracker.RecordAnswer(Replay) && !Tracker.HasOpenAttempt(), "rid6 replay closes it");
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::RunIdReused, "rid6 the started pair is never resent");

		// Busy on a FIRST send (another chain running), then the identical resend meets a cap: that refusal is conclusive.
		Expect(Tracker.BeginAttempt(Fresh) == EAttemptVerdict::Admitted, "rid6 second pair sent");
		Expect(Tracker.RecordAnswer(ClassifyDispatchAnswer(429, true, "julius_dispatch_busy")) && Tracker.HasOpenAttempt(),
			"rid6 busy on a first send keeps it open");
		Expect(Tracker.BeginAttempt(Fresh) == EAttemptVerdict::Admitted, "rid6 second pair resent");
		const EDispatchAnswer Cap = ClassifyDispatchAnswer(429, true, "julius_dispatch_cap_reached");
		Expect(Cap == EDispatchAnswer::Refused, "rid6 cap is a refusal");
		Expect(Tracker.RecordAnswer(Cap) && !Tracker.HasOpenAttempt(), "rid6 cap closes it");
		Expect(Tracker.BeginAttempt(Fresh) == EAttemptVerdict::RunIdReused, "rid6 the refused pair is never resent");
		FDispatchAttempt Third;
		Expect(Tracker.MintAttempt(Source, Third) == EMintResult::Minted && Tracker.BeginAttempt(Third) == EAttemptVerdict::Admitted,
			"rid6 a fresh pair after the conclusive refusal");
	}

	// 1,000 refusals in a row, each followed by a fresh mint: every attempt admitted, all 2,000 values distinct.
	std::set<std::string> MintedValues;
	{
		FDispatchAttemptTracker Tracker;
		FScriptedBytes Source;
		for (int Index = 0; Index < 1000; ++Index) { PushSeed(Source, "j1-attempt-" + std::to_string(Index)); }
		for (int Index = 0; Index < 1000; ++Index)
		{
			FDispatchAttempt Attempt;
			const bool bOk = Tracker.MintAttempt(Source, Attempt) == EMintResult::Minted
				&& Tracker.BeginAttempt(Attempt) == EAttemptVerdict::Admitted
				&& Tracker.RecordAnswer(EDispatchAnswer::Refused);
			if (!bOk) { Expect(false, "attempt chain " + std::to_string(Index)); }
			MintedValues.insert(Attempt.RunId.substr(RunIdPrefix.size()));
			MintedValues.insert(Attempt.IdempotencyKey);
		}
	}
	Expect(MintedValues.size() == 2000, "2,000 minted run-id and key UUIDs are distinct");

	for (const FMintRow& Row : MintRows)
	{
		FDispatchAttemptTracker Tracker;
		FScriptedBytes Source;
		if (Row.Available >= 1) { Source.Blocks.push_back(FromHex(Row.RunBytesHex)); }
		if (Row.Available >= 2) { Source.Blocks.push_back(FromHex(Row.KeyBytesHex)); }
		FDispatchAttempt Out{ "stale", "stale" };
		const EMintResult Got = Tracker.MintAttempt(Source, Out);
		Expect(Got == Row.Expected, std::string("mint ") + Row.Label + ": got " + std::to_string(static_cast<int>(Got)));
		Expect(Out.RunId == Row.RunId && Out.IdempotencyKey == Row.Key, std::string("mint output ") + Row.Label + ": " + Out.RunId);
		Expect(!Tracker.HasOpenAttempt(), std::string("mint opens nothing ") + Row.Label);
		if (Got != EMintResult::Minted)
		{
			// A refused mint leaves nothing to send: the empty pair is refused too.
			Expect(Tracker.BeginAttempt(Out) == EAttemptVerdict::MalformedRunId, std::string("refused mint cannot be sent ") + Row.Label);
		}
	}

	for (const FDisplayRow& Row : DisplayRows)
	{
		const EQualificationDisplay Got = DisplayQualification(Row.Qualification);
		Expect(Got == Row.Expected, std::string("display ") + Row.Label);
		Expect(std::string(QualificationDisplayLabel(Got)) == Row.Words, std::string("display words ") + Row.Label);
	}

	{
		// RID-1: a bare 5xx is not a refusal. The pair stays open, no fresh pair is admitted, and only the identical
		// pair is resent until J1 answers it conclusively.
		FDispatchAttemptTracker Tracker;
		const FDispatchAttempt First{ "wlj_ba7816bf-8f01-4fea-8141-40de5dae2223", "00010203-0405-4607-8809-0a0b0c0d0e0f" };
		const FDispatchAttempt Second{ "wlj_ffffffff-ffff-4fff-bfff-ffffffffffff", "cafebabe-dead-4eef-8afe-babedeadbeef" };
		const FDispatchAttempt Third{ "wlj_11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222" };
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::Admitted, "bare 5xx: first pair admitted");
		Expect(ClassifyDispatchAnswer(503, false, "") == EDispatchAnswer::NoAnswer, "a bare 503 is no answer");
		Expect(ClassifyDispatchAnswer(500, false, "") == EDispatchAnswer::NoAnswer, "a bare 500 is no answer");
		Expect(Tracker.RecordAnswer(ClassifyDispatchAnswer(502, false, "")) && Tracker.HasOpenAttempt(), "a bare 502 keeps it open");
		Expect(Tracker.BeginAttempt(Second) == EAttemptVerdict::PreviousAttemptUnanswered, "no fresh pair after a bare 5xx");
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::Admitted, "the identical pair is resent after a bare 5xx");
		Expect(Tracker.RecordAnswer(ClassifyDispatchAnswer(200, false, "")) && !Tracker.HasOpenAttempt(), "the replay closes it");
		Expect(Tracker.BeginAttempt(First) == EAttemptVerdict::RunIdReused, "the replayed pair is spent");
		Expect(Tracker.BeginAttempt(Second) == EAttemptVerdict::Admitted, "a fresh pair after the replay");
		Expect(Tracker.RecordAnswer(ClassifyDispatchAnswer(503, true, "julius_dispatch_ledger_unavailable")), "J1's own 503");
		Expect(!Tracker.HasOpenAttempt(), "a J1 503 with a kind is a conclusive refusal");
		Expect(Tracker.BeginAttempt(Second) == EAttemptVerdict::RunIdReused, "the refused pair is spent");
		Expect(Tracker.BeginAttempt(Third) == EAttemptVerdict::Admitted, "a fresh pair after a conclusive refusal");
	}

	for (const FQualificationRow& Row : QualificationRows)
	{
		std::string Artifact;
		const std::string Unit = FromHex(Row.PrefixHex);
		for (unsigned long Index = 0; Index < Row.PrefixRepeat; ++Index) { Artifact += Unit; }
		Artifact += FromHex(Row.TailHex);
		FTransformEvidence Evidence;
		Evidence.bPresent = Row.bEvidencePresent != 0;
		Evidence.bIndependentlyVerified = Row.bIndependentlyVerified != 0;
		Evidence.OriginalArtifactSha256 = Row.OriginalSha256;
		Evidence.TransformedArtifactSha256 = Row.TransformedSha256;
		const EArtifactQualification Got = ClassifyArtifactQualification(Row.Finished, Artifact, Row.ArtifactSha256, Evidence);
		Expect(Got == Row.Expected, std::string("qualification ") + Row.Label + ": got " + std::to_string(static_cast<int>(Got)));
		FTransformSignals Signals;
		const bool bReadable = DetectTransformSignals(Artifact, Signals);
		Expect(bReadable == (Row.Expected != EArtifactQualification::Unreadable || Row.Finished != EFinishedResult::Completed),
			std::string("signals readable ") + Row.Label);
		Expect(Signals.bScrubMarker == (Row.bScrubMarker != 0) && Signals.bAtCutLimit == (Row.bAtCutLimit != 0)
			&& Signals.bOverCutLimit == (Row.bOverCutLimit != 0) && Signals.Utf16Units == Row.Utf16Units,
			std::string("signals ") + Row.Label + ": units " + std::to_string(Signals.Utf16Units));
	}

	if (Failures != 0)
	{
		std::printf("J1 LOGIC KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::printf("J1 LOGIC KAT PASS sha256=%zu trim=%zu digest=%zu runid_format=%zu runid_strict=%zu generated=%zu envelope=%zu result=%zu digest_cut=%zu"
		" uuid_format=%zu key=%zu attempt=%zu minted=%zu qualification=%zu mint=%zu display=%zu\n",
		CountOf(ShaRows), CountOf(TrimRows), CountOf(DigestRows), CountOf(RunFormatRows), CountOf(RunStrictRows),
		Generated.size(), CountOf(EnvelopeRows), CountOf(ResultRows), CountOf(DigestCutRows),
		CountOf(UuidFormatRows), CountOf(KeyRows), CountOf(AttemptRows), MintedValues.size(), CountOf(QualificationRows), CountOf(MintRows), CountOf(DisplayRows));
	return 0;
}

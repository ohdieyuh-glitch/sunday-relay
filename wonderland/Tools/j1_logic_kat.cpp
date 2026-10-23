// WONDERLAND -- J1 client pure logic: KNOWN-ANSWER TEST. No Unreal, no network, no secrets, no randomness.
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

	if (Failures != 0)
	{
		std::printf("J1 LOGIC KAT FAIL failures=%d\n", Failures);
		return 1;
	}
	std::printf("J1 LOGIC KAT PASS sha256=%zu trim=%zu digest=%zu runid_format=%zu runid_strict=%zu generated=%zu envelope=%zu result=%zu digest_cut=%zu\n",
		CountOf(ShaRows), CountOf(TrimRows), CountOf(DigestRows), CountOf(RunFormatRows), CountOf(RunStrictRows),
		Generated.size(), CountOf(EnvelopeRows), CountOf(ResultRows), CountOf(DigestCutRows));
	return 0;
}

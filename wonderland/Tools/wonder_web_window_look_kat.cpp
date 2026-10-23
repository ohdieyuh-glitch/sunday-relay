// WONDERLAND -- WONDER WEB VM WINDOW LOOK: KNOWN-ANSWER TEST. No Unreal, no network, no secrets, no randomness.
//
// Build and run from the repository root (any C++17 compiler):
//   g++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -DWL_WINDOWLOOK_STANDALONE -I wonderland/Source/Wonderland
//       wonderland/Tools/wonder_web_window_look_kat.cpp wonderland/Source/Wonderland/WonderlandWonderWebWindowLook.cpp
//       -o wonder_web_window_look_kat
//   (one command line, wrapped here)
//   ./wonder_web_window_look_kat   -> prints "WONDER WEB WINDOW LOOK KAT PASS ..." and exits 0, or names every failure and exits 1.
//
// WHAT IT PINS (founder, 2026-10-23): the title "<agent's custom name> — Wonder Web VM <N>", built only from
// agentDisplayName and vmNumber; any name shown exactly as given, provider words included ("Grok" is "Grok — Wonder Web
// VM 3": team decision, BRIDGE/FORGE/YUJI 2026-10-23, no provider-word filter); a missing or null name as the neutral
// "Unnamed agent"; the parent terminal as metadata only; the VM number as shown; the outline colour and its fall back to the legacy #FFD400; the per-terminal companion colour's
// fall back to the shared colour and then the theme; and the visual-intent contract the window manager drives.
// ALIGNED WITH FORGE (wonderland-wonder-web-windows.v1 at 46383abe) AND BRIDGE (wonder-web-vm-session.v1): KAT-MAP pins
// every FORGE animation intent to this file's EVisualIntent one to one; KAT-CAUSE pins BRIDGE's six end causes to their
// badges, with the neutral "VM ended" for none or anything unknown; KAT-ADMIT the over-cap chip; KAT-OBSERVER the
// observerView card's four fields.
// MUTATION CHECK: wonderland/Tools/wonder_web_window_look_mutants.sh re-adds a provider-word filter (to the title, the
// observer card's owner, and the parent line) one at a time and requires this KAT to FAIL on each.
// Inputs with non-ASCII bytes are written as escapes; "\xE2\x80\x94" is U+2014 EM DASH.
#include "WonderlandWonderWebWindowLook.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <type_traits>

namespace
{
	using namespace WonderlandWonderWebWindowLook;

	int Failures = 0;
	int Checks = 0;

	void Expect(bool bOk, const std::string& What)
	{
		++Checks;
		if (!bOk)
		{
			++Failures;
			std::printf("FAIL %s\n", What.c_str());
		}
	}

	bool Near(float A, float B)
	{
		return std::fabs(A - B) < 1e-6f;
	}

	template <typename T, std::size_t N>
	constexpr std::size_t CountOf(const T (&)[N]) { return N; }

	const std::string Dash = "\xE2\x80\x94";

	// THE TITLE HAS ONE SOURCE: FIdentityInput carries no title-like field, so a record's `title` or `windowTitle` has
	// nowhere to land. Checked at compile time: adding such a field breaks this build.
	template <typename T, typename = void> struct THasTitle : std::false_type {};
	template <typename T> struct THasTitle<T, std::void_t<decltype(&T::Title)>> : std::true_type {};
	template <typename T, typename = void> struct THasWindowTitle : std::false_type {};
	template <typename T> struct THasWindowTitle<T, std::void_t<decltype(&T::WindowTitle)>> : std::true_type {};
	static_assert(!THasTitle<FIdentityInput>::value, "the title is built from agentDisplayName + vmNumber only");
	static_assert(!THasWindowTitle<FIdentityInput>::value, "the title is built from agentDisplayName + vmNumber only");

	struct FTitleRow
	{
		const char* Label;
		/** nullptr: agentDisplayName missing or null on the wire. */
		const char* Name;
		int Number;
		const char* ExpectedTitle;
		ENameIssue ExpectedIssue;
	};

	// KAT-TITLE: the name exactly as given (sanitised for drawing only), the number as shown, and "Unnamed agent" only for a
	// missing/null name (or, defensively, one that is empty after sanitising). No word is refused: provider names are names.
	const FTitleRow TitleRows[] = {
		{ "plain",              "Fable",                       1,     "Fable \xE2\x80\x94 Wonder Web VM 1",                       ENameIssue::None },
		{ "two_words",          "Grok Bot",                    2,     "Grok Bot \xE2\x80\x94 Wonder Web VM 2",                    ENameIssue::None },
		{ "dot",                "Dot 3",                       3,     "Dot 3 \xE2\x80\x94 Wonder Web VM 3",                       ENameIssue::None },
		{ "julius_card",        "Julius: ship landing page",   12,    "Julius: ship landing page \xE2\x80\x94 Wonder Web VM 12",  ENameIssue::None },
		{ "custom_with_brand",  "Claude Code Fable 5",         4,     "Claude Code Fable 5 \xE2\x80\x94 Wonder Web VM 4",         ENameIssue::None },
		{ "trimmed",            "   Astra   ",                 1,     "Astra \xE2\x80\x94 Wonder Web VM 1",                       ENameIssue::None },
		{ "collapsed_ws",       "Astra\t\t  Two",              1,     "Astra Two \xE2\x80\x94 Wonder Web VM 1",                   ENameIssue::None },
		{ "newline_is_space",   "Astra\nTwo",                  1,     "Astra Two \xE2\x80\x94 Wonder Web VM 1",                   ENameIssue::None },
		{ "utf8_kept",          "Zo\xC3\xAB \xF0\x9F\x90\xB6", 7,     "Zo\xC3\xAB \xF0\x9F\x90\xB6 \xE2\x80\x94 Wonder Web VM 7", ENameIssue::None },
		{ "bidi_dropped",       "Ast\xE2\x80\xAEra",           1,     "Astra \xE2\x80\x94 Wonder Web VM 1",                       ENameIssue::None },
		{ "zero_width_dropped", "A\xE2\x80\x8B" "stra",        1,     "Astra \xE2\x80\x94 Wonder Web VM 1",                       ENameIssue::None },
		{ "bad_utf8_dropped",   "As\xFFtra\xC3",               1,     "Astra \xE2\x80\x94 Wonder Web VM 1",                       ENameIssue::None },
		{ "overlong_dropped",   "A\xC0\xAFstra",               1,     "Astra \xE2\x80\x94 Wonder Web VM 1",                       ENameIssue::None },
		// TEAM DECISION 2026-10-23: a provider word IS the agent's custom name when that is what was registered.
		{ "name_grok",          "Grok",                        3,     "Grok \xE2\x80\x94 Wonder Web VM 3",                        ENameIssue::None },
		{ "name_claude",        "Claude",                      1,     "Claude \xE2\x80\x94 Wonder Web VM 1",                      ENameIssue::None },
		{ "name_openai",        "OpenAI",                      2,     "OpenAI \xE2\x80\x94 Wonder Web VM 2",                      ENameIssue::None },
		// FLIPPED: these rows expected "Unnamed agent" while the filter existed; now each shows its name as given.
		{ "was_filtered_chatgpt", "chatgpt",                   1,     "chatgpt \xE2\x80\x94 Wonder Web VM 1",                     ENameIssue::None },
		{ "was_filtered_cc_id", "claude-code",                 3,     "claude-code \xE2\x80\x94 Wonder Web VM 3",                 ENameIssue::None },
		{ "was_filtered_grok_caps", "  GROK ",                 1,     "GROK \xE2\x80\x94 Wonder Web VM 1",                        ENameIssue::None },
		{ "was_filtered_gemini", "Gemini",                     1,     "Gemini \xE2\x80\x94 Wonder Web VM 1",                      ENameIssue::None },
		{ "was_filtered_dev_id", "dev-companion",              1,     "dev-companion \xE2\x80\x94 Wonder Web VM 1",               ENameIssue::None },
		{ "was_filtered_zw",    "Ope\xE2\x80\x8BnAI",          1,     "OpenAI \xE2\x80\x94 Wonder Web VM 1",                      ENameIssue::None },
		// MISSING OR NULL: the only production path to the fallback.
		{ "missing_or_null",    nullptr,                       1,     "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",               ENameIssue::Missing },
		{ "missing_or_null_n5", nullptr,                       5,     "Unnamed agent \xE2\x80\x94 Wonder Web VM 5",               ENameIssue::Missing },
		{ "missing_no_number",  nullptr,                       0,     "Unnamed agent \xE2\x80\x94 Wonder Web VM",                 ENameIssue::Missing },
		// EMPTY OR WHITESPACE-ONLY: refused upstream, never in production; if one arrives, the fallback and no failure.
		{ "empty",              "",                            1,     "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",               ENameIssue::Empty },
		{ "only_spaces",        " \t\r\n ",                    2,     "Unnamed agent \xE2\x80\x94 Wonder Web VM 2",               ENameIssue::Empty },
		{ "only_invisible",     "\xE2\x80\x8B\xEF\xBB\xBF",    2,     "Unnamed agent \xE2\x80\x94 Wonder Web VM 2",               ENameIssue::Empty },
		{ "no_number_zero",     "Fable",                       0,     "Fable \xE2\x80\x94 Wonder Web VM",                         ENameIssue::None },
		{ "no_number_negative", "Fable",                       -2,    "Fable \xE2\x80\x94 Wonder Web VM",                         ENameIssue::None },
		{ "no_number_huge",     "Fable",                       10000, "Fable \xE2\x80\x94 Wonder Web VM",                         ENameIssue::None },
		{ "number_max",         "Fable",                       9999,  "Fable \xE2\x80\x94 Wonder Web VM 9999",                    ENameIssue::None },
	};

	struct FNumberRow
	{
		int Number;
		const char* Shown;
	};

	// KAT-NUMBER: N as displayed. N is the window manager's (per parent terminal, reusable); this only formats it.
	const FNumberRow NumberRows[] = {
		{ 1, "1" }, { 2, "2" }, { 9, "9" }, { 10, "10" }, { 42, "42" }, { 9999, "9999" },
		{ 0, "" }, { -1, "" }, { 10000, "" }, { 2147483647, "" },
	};

	struct FAccentRow
	{
		bool bPerTerminal;
		bool bShared;
		EAccentSource Expected;
	};

	// KAT-ACCENT: a companion terminal's colour -- its own, else the shared one every save already has, else the theme.
	const FAccentRow AccentRows[] = {
		{ true,  true,  EAccentSource::PerTerminal },
		{ true,  false, EAccentSource::PerTerminal },
		{ false, true,  EAccentSource::SharedCompanion },
		{ false, false, EAccentSource::Theme },
	};

	struct FIntentRow
	{
		EVisualIntent Intent;
		const char* Name;
		bool bCamera, bOpens, bMinimizes, bDismisses, bMarksEnded, bClearsEnded, bRestores, bCameraReturn, bLeavesAfterVeil;
		EExitStyle Exit;
	};

	// KAT-INTENT (and KAT-MAP): FORGE's intent name -> this file's intent -> what the window does. One row per FORGE intent
	// (wonder-web-windows.ts ANIMATION_INTENTS), in FORGE's order.
	//   FORGE intent         EVisualIntent     camera opens  min    dismiss ended  clears restore camRet afterVeil exit
	const FIntentRow IntentRows[] = {
		{ EVisualIntent::SpawnWithCloseUp, "cinematic_closeup", true,  true,  false, false, false, true,  false, false, false, EExitStyle::Fold },
		{ EVisualIntent::SpawnInline,      "spawn_inline",      false, true,  false, false, false, true,  false, false, false, EExitStyle::Fold },
		{ EVisualIntent::Minimize,         "minimize_fold",     false, false, true,  false, false, false, false, false, false, EExitStyle::Fold },
		{ EVisualIntent::RestoreUnfold,    "restore_unfold",    false, false, false, false, false, false, true,  false, false, EExitStyle::Fold },
		{ EVisualIntent::Close,            "close_anim",        false, false, false, true,  false, false, false, false, false, EExitStyle::Close },
		{ EVisualIntent::CameraReturn,     "camera_return",     false, false, false, false, false, false, false, true,  false, EExitStyle::Fold },
		{ EVisualIntent::VmEnded,          "vm_ended_anim",     false, false, false, true,  true,  false, false, false, true,  EExitStyle::Close },
	};

	struct FAliasRow { const char* Name; EVisualIntent Intent; };
	// This file's first names, still read by ParseIntent (never by PlanForCue).
	const FAliasRow AliasRows[] = {
		{ "spawn_close_up", EVisualIntent::SpawnWithCloseUp },
		{ "minimize",       EVisualIntent::Minimize },
		{ "close",          EVisualIntent::Close },
		{ "vm_ended",       EVisualIntent::VmEnded },
	};

	struct FCauseRow
	{
		const char* Label;
		bool bHasCause;
		const char* Wire;
		EEndCause Expected;
		const char* Badge;
	};

	// KAT-CAUSE: BRIDGE wonder-web-vm-session.v1 endCause on a vm_ended_anim cue -> the badge. Unknown is never an error.
	const FCauseRow CauseRows[] = {
		{ "owner_terminated",      true,  "owner_terminated",      EEndCause::OwnerTerminated,      "VM stopped by owner" },
		{ "idle_timeout",          true,  "idle_timeout",          EEndCause::IdleTimeout,          "VM idle timeout" },
		{ "max_lifetime",          true,  "max_lifetime",          EEndCause::MaxLifetime,          "VM time limit reached" },
		{ "provider_failed",       true,  "provider_failed",       EEndCause::ProviderFailed,       "VM provider failed" },
		{ "cap_exhausted",         true,  "cap_exhausted",         EEndCause::CapExhausted,         "VM cap exhausted" },
		{ "authorization_revoked", true,  "authorization_revoked", EEndCause::AuthorizationRevoked, "VM access revoked" },
		{ "omitted",               false, "",                      EEndCause::None,                 "VM ended" },
		{ "null/empty",            true,  "",                      EEndCause::None,                 "VM ended" },
		{ "FORGE explicit_stop",   true,  "explicit_stop",         EEndCause::Unknown,              "VM ended" },
		{ "FORGE failure",         true,  "failure",               EEndCause::Unknown,              "VM ended" },
		{ "a close is no cause",   true,  "close_anim",            EEndCause::Unknown,              "VM ended" },
		{ "user_closed",           true,  "user_closed",           EEndCause::Unknown,              "VM ended" },
		{ "wrong case",            true,  "Idle_Timeout",          EEndCause::Unknown,              "VM ended" },
		{ "padded",                true,  " idle_timeout",         EEndCause::Unknown,              "VM ended" },
		{ "control bytes",         true,  "idle_timeout\n",        EEndCause::Unknown,              "VM ended" },
		{ "invalid utf-8",         true,  "\xFF\xFE",              EEndCause::Unknown,              "VM ended" },
	};

	struct FObserverRow
	{
		const char* Label;
		bool bHasToken;
		const char* Token;
		const char* Owner;
		bool bHasTitle;
		const char* Title;
		const char* Status;
		bool bOutlineResolved;
		const char* ExpectedOwner;
		bool bTitleShown;
		const char* ExpectedTitle;
		const char* ExpectedStatus;
	};

	// KAT-OBSERVER: FORGE's observerView (outlineColorToken, ownerName, title, status) -> the card. Nothing else exists to draw.
	const FObserverRow ObserverRows[] = {
		{ "plain",            true,  "#3FA7FF", "Fable", true,  "Fable \xE2\x80\x94 Wonder Web VM 2", "focused",   true,  "Fable",         true,  "Fable \xE2\x80\x94 Wonder Web VM 2", "Focused" },
		{ "chip",             true,  "#00ff88", "Dot",   true,  "Dot \xE2\x80\x94 Wonder Web VM 7",   "minimized", true,  "Dot",           true,  "Dot \xE2\x80\x94 Wonder Web VM 7",   "Minimized" },
		{ "null token",       false, "",        "Agent", true,  "Agent \xE2\x80\x94 Wonder Web VM 1", "live",      false, "Agent",         true,  "Agent \xE2\x80\x94 Wonder Web VM 1", "Live" },
		{ "named token",      true,  "companion.accent", "Fable", true, "t",                    "opening",   false, "Fable",         true,  "t",                               "Opening" },
		{ "short hex",        true,  "#FFF",    "Fable", true,  "t",                             "closing",   false, "Fable",         true,  "t",                               "Closing" },
		{ "bad hex",          true,  "#GG0000", "Fable", true,  "t",                             "closed",    false, "Fable",         true,  "t",                               "Closed" },
		{ "null title",       true,  "#112233", "Fable", false, "",                              "live",      true,  "Fable",         false, "",                                "Live" },
		{ "empty owner",      true,  "#112233", "  ",    true,  "t",                             "live",      true,  "Unnamed agent", true,  "t",                               "Live" },
		{ "unknown status",   true,  "#112233", "Fable", true,  "t",                             "paused",    true,  "Fable",         true,  "t",                               "Unknown" },
		{ "owner Grok",       true,  "#3FA7FF", "Grok",   true, "Grok \xE2\x80\x94 Wonder Web VM 3",   "live",    true,  "Grok",          true,  "Grok \xE2\x80\x94 Wonder Web VM 3",   "Live" },
		{ "owner Claude",     true,  "#3FA7FF", "Claude", true, "Claude \xE2\x80\x94 Wonder Web VM 1", "focused", true,  "Claude",        true,  "Claude \xE2\x80\x94 Wonder Web VM 1", "Focused" },
		{ "owner OpenAI",     true,  "#3FA7FF", "OpenAI", true, "OpenAI \xE2\x80\x94 Wonder Web VM 2", "live",    true,  "OpenAI",        true,  "OpenAI \xE2\x80\x94 Wonder Web VM 2", "Live" },
		{ "owner unnamed",    true,  "#3FA7FF", "Unnamed agent", true, "Unnamed agent \xE2\x80\x94 Wonder Web VM 4", "live", true, "Unnamed agent", true, "Unnamed agent \xE2\x80\x94 Wonder Web VM 4", "Live" },
		{ "hostile title",    true,  "#112233", "Fa\xE2\x80\xAE" "ble", true, "a\x1B[2Jb\nc",        "live",      true,  "Fable",         true,  "a [2Jb c",                        "Live" },
	};

	struct FAdmitRow { const char* Wire; EAdmission Expected; bool bStartsAsChip; };
	// KAT-ADMIT: FORGE's admission. Past the cap (a 7th window at the default 6) it is `queued_chip`: a chip from the start.
	const FAdmitRow AdmitRows[] = {
		{ "shown",       EAdmission::Shown,      false },
		{ "queued_chip", EAdmission::QueuedChip, true },
		{ "",            EAdmission::Shown,      false },
		{ "QUEUED_CHIP", EAdmission::Shown,      false },
	};
}

int main()
{
	// ------------------------------------------------------------------------------------------------ KAT-TITLE
	for (const FTitleRow& Row : TitleRows)
	{
		FIdentityInput Input;
		Input.bHasAgentDisplayName = Row.Name != nullptr;
		Input.AgentDisplayName = Row.Name != nullptr ? Row.Name : "";
		Input.VmNumber = Row.Number;
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Title == Row.ExpectedTitle, std::string("title ") + Row.Label + ": got [" + Look.Title + "]");
		Expect(Look.NameIssue == Row.ExpectedIssue, std::string("name issue ") + Row.Label);
		// THE TITLE IS THE SHOWN NAME AND N, NOTHING ELSE.
		Expect(Look.Title == MakeTitle(Look.Name, Row.Number), std::string("title from name + number only ") + Row.Label);
		// THE FALLBACK ONLY WHEN THERE IS NO NAME TO SHOW.
		Expect((Look.Name == UnnamedAgent) == (Row.ExpectedIssue != ENameIssue::None), std::string("fallback only without a name ") + Row.Label);
	}
	{
		// MISSING WINS OVER STALE TEXT: a null name never shows whatever string the struct still holds.
		FIdentityInput Input;
		Input.bHasAgentDisplayName = false;
		Input.AgentDisplayName = "Grok";
		Input.VmNumber = 3;
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Title == std::string("Unnamed agent ") + Dash + " Wonder Web VM 3" && Look.NameIssue == ENameIssue::Missing, "null name ignores stale text");
	}
	{
		// A DEFAULT INPUT IS A PRESENT-BUT-EMPTY NAME (bHasAgentDisplayName defaults true): the fallback, flagged Empty, no failure.
		const FResolvedLook Look = Resolve(FIdentityInput{});
		Expect(Look.Name == UnnamedAgent && Look.NameIssue == ENameIssue::Empty, "default input falls back");
	}
	// THE EXACT BYTES OF THE JOIN: space, U+2014 (E2 80 94), space, "Wonder Web VM", space, N.
	Expect(MakeTitle("A", 1) == std::string("A ") + Dash + " Wonder Web VM 1", "title join bytes");
	Expect(std::string(TitleJoin) == " \xE2\x80\x94 Wonder Web VM", "title join constant");
	Expect(std::string(UnnamedAgent) == "Unnamed agent", "neutral word");
	Expect(std::string(VmEndedBadge) == "VM ENDED", "badge word");

	// THE NAME CAP: 64 bytes, never inside a code point.
	{
		const std::string Long(70, 'a');
		Expect(SanitizeName(Long) == std::string(64, 'a'), "cap ascii");
		std::string Mixed(63, 'a');
		Mixed += "\xC3\xAB" "bbbb"; // the two-byte e-diaeresis straddles byte 64
		Expect(SanitizeName(Mixed) == std::string(63, 'a'), "cap on code point boundary");
		std::string Spaced(63, 'a');
		Spaced += " bbbb";
		Expect(SanitizeName(Spaced) == std::string(63, 'a'), "cap then trim");
		Expect(SanitizeName("\xF0\x9F\x90\xB6\xF0\x9F\x90\xB6", 6) == "\xF0\x9F\x90\xB6", "cap four-byte");
	}
	// NO WORD IS REFUSED: every provider word the old filter listed is shown as the name, in any case.
	{
		const char* const FormerlyFiltered[] = {
			"openai", "open ai", "chatgpt", "chat gpt", "gpt", "codex", "openai codex",
			"anthropic", "claude", "claude code", "claude-code", "claude_code",
			"xai", "x.ai", "x ai", "grok", "Grok", "GROK", "Claude", "OpenAI",
			"google", "gemini", "google gemini", "deepmind",
			"cursor", "meta", "llama", "mistral", "deepseek", "qwen", "perplexity", "copilot", "github copilot",
			"dev-companion", "dev_companion", "dev-single-agent", "dev_single_agent",
		};
		for (const char* Word : FormerlyFiltered)
		{
			FIdentityInput Input;
			Input.AgentDisplayName = Word;
			Input.VmNumber = 3;
			const FResolvedLook Look = Resolve(Input);
			Expect(Look.Name == Word && Look.NameIssue == ENameIssue::None && Look.Title == std::string(Word) + " " + Dash + " Wonder Web VM 3",
				std::string("shown as given: ") + Word);
		}
	}

	// --------------------------------------------------------------------------------------- KAT-METADATA
	{
		FIdentityInput Input;
		Input.AgentDisplayName = "Fable";
		Input.VmNumber = 2;
		Input.ParentTerminalName = "  Astra  Companion ";
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Metadata == "Astra Companion", "metadata is the parent's name, sanitised");
		Expect(Look.Title.find("Astra") == std::string::npos, "parent never in the title");
		Expect(Look.ParentIssue == ENameIssue::None, "parent ok");
	}
	{
		FIdentityInput Input;
		Input.AgentDisplayName = "Fable";
		Input.ParentTerminalName = "Claude Code";
		const FResolvedLook Look = Resolve(Input);
		// FLIPPED: a parent terminal named "Claude Code" is shown as its name (it used to be dropped as a provider label).
		Expect(Look.Metadata == "Claude Code" && Look.ParentIssue == ENameIssue::None, "provider-word parent shown as given");
	}
	for (const char* Parent : { "Grok", "Claude", "OpenAI" })
	{
		FIdentityInput Input;
		Input.AgentDisplayName = "Fable";
		Input.ParentTerminalName = Parent;
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Metadata == Parent && Look.ParentIssue == ENameIssue::None, std::string("parent shown as given: ") + Parent);
	}
	{
		FIdentityInput Input;
		Input.AgentDisplayName = "Fable";
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Metadata.empty() && Look.ParentIssue == ENameIssue::Empty, "missing parent shows no metadata");
	}
	{
		// A MISSING NAME IS NOT FILLED FROM THE PARENT.
		FIdentityInput Input;
		Input.bHasAgentDisplayName = false;
		Input.ParentTerminalName = "Astra";
		Input.VmNumber = 1;
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Name == UnnamedAgent && Look.Metadata == "Astra" && Look.NameIssue == ENameIssue::Missing, "missing name stays neutral");
		Expect(Look.Title.find("Astra") == std::string::npos, "nothing borrowed");
	}

	// ----------------------------------------------------------------------------------------- KAT-NUMBER
	for (const FNumberRow& Row : NumberRows)
	{
		Expect(FormatVmNumber(Row.Number) == Row.Shown, "number " + std::to_string(Row.Number));
		FIdentityInput Input;
		Input.AgentDisplayName = "X";
		Input.VmNumber = Row.Number;
		Expect(Resolve(Input).bNumberShown == (Row.Shown[0] != '\0'), "number shown flag " + std::to_string(Row.Number));
	}

	// ----------------------------------------------------------------------------------------- KAT-OUTLINE
	{
		FIdentityInput Input;
		Input.AgentDisplayName = "Fable";
		const FResolvedLook Legacy = Resolve(Input);
		Expect(Legacy.OutlineSource == EOutlineSource::LegacyYellow, "no colour passed: legacy #FFD400");
		Input.bHasParentAccent = true;
		Input.ParentAccent = FRgb{ 0.2f, 0.4f, 0.6f };
		const FResolvedLook Parent = Resolve(Input);
		Expect(Parent.OutlineSource == EOutlineSource::ParentTerminal && Near(Parent.Outline.R, 0.2f) && Near(Parent.Outline.G, 0.4f)
			&& Near(Parent.Outline.B, 0.6f), "parent colour passed through");
		Input.ParentAccent = FRgb{ -1.0f, 2.0f, std::nanf("") };
		const FResolvedLook Clamped = Resolve(Input);
		Expect(Near(Clamped.Outline.R, 0.0f) && Near(Clamped.Outline.G, 1.0f) && Near(Clamped.Outline.B, 0.0f), "colour clamped, NaN is 0");
	}
	for (const FAccentRow& Row : AccentRows)
	{
		Expect(PickCompanionAccentSource(Row.bPerTerminal, Row.bShared) == Row.Expected,
			std::string("accent source ") + (Row.bPerTerminal ? "own" : "-") + "/" + (Row.bShared ? "shared" : "-"));
	}

	// ---------------------------------------------------------------------------------------- KAT-SESSION
	{
		const ESessionState States[] = { ESessionState::Unknown, ESessionState::Starting, ESessionState::Running, ESessionState::Ended, ESessionState::Failed };
		const bool Ended[] = { false, false, false, true, true };
		for (std::size_t Index = 0; Index < CountOf(States); ++Index)
		{
			FIdentityInput Input;
			Input.AgentDisplayName = "Fable";
			Input.State = States[Index];
			Expect(Resolve(Input).bVmEnded == Ended[Index], "session state " + std::to_string(Index));
		}
	}

	// ----------------------------------------------------------------------------------------- KAT-INTENT
	for (const FIntentRow& Row : IntentRows)
	{
		const FIntentPlan Plan = PlanFor(Row.Intent);
		const std::string Label = std::string("intent ") + Row.Name;
		Expect(Plan.bCameraCloseUp == Row.bCamera, Label + " camera");
		Expect(Plan.bOpens == Row.bOpens, Label + " opens");
		Expect(Plan.bMinimizes == Row.bMinimizes, Label + " minimizes");
		Expect(Plan.bDismisses == Row.bDismisses, Label + " dismisses");
		Expect(Plan.bMarksVmEnded == Row.bMarksEnded, Label + " marks ended");
		Expect(Plan.bClearsVmEnded == Row.bClearsEnded, Label + " clears ended");
		Expect(Plan.Exit == Row.Exit, Label + " exit style");
		Expect(Plan.bRestores == Row.bRestores, Label + " restores");
		Expect(Plan.bCameraReturn == Row.bCameraReturn, Label + " camera return");
		Expect(Plan.bLeavesAfterVeil == Row.bLeavesAfterVeil, Label + " leaves after veil");
		Expect(!Plan.bStartsAsChip, Label + " never starts as chip");
		Expect(std::string(IntentName(Row.Intent)) == Row.Name, Label + " name");
		EVisualIntent Parsed = EVisualIntent::SpawnInline;
		Expect(ParseIntent(Row.Name, Parsed) && Parsed == Row.Intent, Label + " parse");
		// KAT-MAP: FORGE's cue maps to this intent and this plan, with no end cause.
		FForgeCue Cue;
		Cue.Intent = Row.Name;
		Cue.bHasEndCause = true;
		Cue.EndCause = "idle_timeout";
		const FCuePlan Read = PlanForCue(Cue);
		Expect(Read.bKnown && Read.Intent == Row.Intent, Label + " cue maps");
		Expect(Read.Plan.bCameraCloseUp == Plan.bCameraCloseUp && Read.Plan.bDismisses == Plan.bDismisses && Read.Plan.Exit == Plan.Exit, Label + " cue plan");
		Expect((Read.EndCause != EEndCause::None) == (Row.Intent == EVisualIntent::VmEnded), Label + " cause only on vm_ended_anim");
	}
	Expect(CountOf(IntentRows) == 7, "one row per FORGE intent (7)");
	for (const FAliasRow& Row : AliasRows)
	{
		EVisualIntent Parsed = EVisualIntent::CameraReturn;
		Expect(ParseIntent(Row.Name, Parsed) && Parsed == Row.Intent, std::string("alias ") + Row.Name);
		FForgeCue Cue;
		Cue.Intent = Row.Name;
		Expect(!PlanForCue(Cue).bKnown, std::string("alias is not a FORGE cue ") + Row.Name);
	}
	{
		// AN UNKNOWN CUE DOES NOTHING AND NEVER CRASHES.
		const char* Unknown[] = { "", "fold", "CINEMATIC_CLOSEUP", "cinematic_closeup ", "keepalive", "\xFF" };
		for (const char* Name : Unknown)
		{
			FForgeCue Cue;
			Cue.Intent = Name;
			const FCuePlan Read = PlanForCue(Cue);
			Expect(!Read.bKnown && !Read.Plan.bCameraCloseUp && !Read.Plan.bOpens && !Read.Plan.bDismisses && !Read.Plan.bMarksVmEnded
				&& Read.EndCause == EEndCause::None, std::string("unknown cue is a no-op '") + Name + "'");
		}
		// FORGE'S CAMERA RULE (minimized chips keep the workspace held): the look never decides the camera. A window opened
		// while every other window is a chip arrives as spawn_inline, and spawn_inline never moves the camera; only
		// cinematic_closeup does. camera_return moves no window and dismisses nothing (the last HELD window, chips
		// included, already left).
		FForgeCue Inline;
		Inline.Intent = "spawn_inline";
		Expect(!PlanForCue(Inline).Plan.bCameraCloseUp && PlanForCue(Inline).Plan.bOpens, "opened beside only chips: inline, no close-up");
		FForgeCue Return;
		Return.Intent = "camera_return";
		const FIntentPlan ReturnPlan = PlanForCue(Return).Plan;
		Expect(ReturnPlan.bCameraReturn && !ReturnPlan.bDismisses && !ReturnPlan.bMinimizes && !ReturnPlan.bOpens && !ReturnPlan.bMarksVmEnded,
			"camera_return touches no window");
		Expect(!PlanFor(EVisualIntent::Minimize).bCameraReturn && !PlanFor(EVisualIntent::Minimize).bDismisses, "minimize keeps the window held (no camera return)");
		int CloseUps = 0;
		for (const FIntentRow& Row : IntentRows)
		{
			CloseUps += PlanFor(Row.Intent).bCameraCloseUp ? 1 : 0;
		}
		Expect(CloseUps == 1, "only cinematic_closeup moves the camera in");
	}

	// ------------------------------------------------------------------------------------------ KAT-CAUSE
	for (const FCauseRow& Row : CauseRows)
	{
		const std::string Label = std::string("cause ") + Row.Label;
		FForgeCue Cue;
		Cue.Intent = "vm_ended_anim";
		Cue.bHasEndCause = Row.bHasCause;
		Cue.EndCause = Row.Wire;
		const FCuePlan Read = PlanForCue(Cue);
		Expect(Read.bKnown && Read.Intent == EVisualIntent::VmEnded && Read.Plan.bMarksVmEnded, Label + " is vm_ended_anim");
		Expect(Read.EndCause == Row.Expected, Label + " parsed");
		Expect(std::string(EndCauseBadge(Read.EndCause)) == Row.Badge, Label + " badge");
		Expect(std::string(EndCauseBadge(Read.EndCause)).size() <= 24, Label + " badge is short");
		if (Row.Expected != EEndCause::None && Row.Expected != EEndCause::Unknown)
		{
			Expect(std::string(EndCauseName(Read.EndCause)) == Row.Wire, Label + " round-trips");
		}
		// A CLOSE IS NEVER A CAUSE: the same endCause on close_anim is dropped and the close never wears VM ENDED.
		FForgeCue Close = Cue;
		Close.Intent = "close_anim";
		const FCuePlan Closed = PlanForCue(Close);
		Expect(Closed.EndCause == EEndCause::None && !Closed.Plan.bMarksVmEnded, Label + " ignored on close_anim");
	}
	{
		// A CAUSE COUNTS ONLY FOR AN ENDED OR FAILED SESSION.
		const ESessionState States[] = { ESessionState::Unknown, ESessionState::Starting, ESessionState::Running, ESessionState::Paused };
		for (const ESessionState State : States)
		{
			Expect(EffectiveEndCause(State, EEndCause::IdleTimeout) == EEndCause::None, "live state has no cause");
		}
		Expect(EffectiveEndCause(ESessionState::Ended, EEndCause::CapExhausted) == EEndCause::CapExhausted, "ended keeps cause");
		Expect(EffectiveEndCause(ESessionState::Failed, EEndCause::ProviderFailed) == EEndCause::ProviderFailed, "failed keeps cause");
		Expect(std::string(EndCauseBadge(static_cast<EEndCause>(200))) == "VM ended", "out-of-range cause is neutral");
		struct { const char* Wire; ESessionState State; } StateRows[] = {
			{ "provisioning", ESessionState::Starting }, { "running", ESessionState::Running }, { "paused", ESessionState::Paused },
			{ "ended", ESessionState::Ended }, { "failed", ESessionState::Failed }, { "stopped", ESessionState::Unknown }, { "", ESessionState::Unknown } };
		for (const auto& Row : StateRows)
		{
			Expect(ParseSessionState(Row.Wire) == Row.State, std::string("session state '") + Row.Wire + "'");
		}
		FIdentityInput Paused;
		Paused.AgentDisplayName = "Fable";
		Paused.State = ESessionState::Paused;
		Expect(!Resolve(Paused).bVmEnded, "paused is not ended");
		// VM ENDED LEAVES: after the veil's fade plus the hold; a chip at once.
		Expect(Near(VmEndedLeaveDelay(false, 0.45f, 1.6f), 2.05f), "vm ended leaves after veil + hold");
		Expect(Near(VmEndedLeaveDelay(true, 0.45f, 1.6f), 0.0f), "vm ended chip leaves at once");
		Expect(Near(VmEndedLeaveDelay(false, 0.0f, -3.0f), 0.01f), "vm ended delay floored");
	}

	// ------------------------------------------------------------------------------------------ KAT-ADMIT
	for (const FAdmitRow& Row : AdmitRows)
	{
		const std::string Label = std::string("admission '") + Row.Wire + "'";
		Expect(ParseAdmission(Row.Wire) == Row.Expected, Label + " parsed");
		const FIntentPlan Plan = PlanForAdmission(ParseAdmission(Row.Wire));
		Expect(Plan.bStartsAsChip == Row.bStartsAsChip, Label + " chip");
		// THE OVER-CAP WINDOW NEVER STOOD: no camera, no unfold, no fold, no dismissal, no VM ENDED.
		Expect(!Plan.bCameraCloseUp && !Plan.bOpens && !Plan.bMinimizes && !Plan.bDismisses && !Plan.bMarksVmEnded, Label + " plays nothing");
	}

	// --------------------------------------------------------------------------------------- KAT-OBSERVER
	for (const FObserverRow& Row : ObserverRows)
	{
		const std::string Label = std::string("observer ") + Row.Label;
		FObserverViewInput View;
		View.bHasOutlineColorToken = Row.bHasToken;
		View.OutlineColorToken = Row.Token;
		View.OwnerName = Row.Owner;
		View.bHasTitle = Row.bHasTitle;
		View.Title = Row.Title;
		View.Status = Row.Status;
		const FObserverLook Look = ResolveObserver(View);
		Expect(Look.bOutlineResolved == Row.bOutlineResolved, Label + " outline resolved");
		if (!Row.bOutlineResolved)
		{
			// NEVER THE LEGACY YELLOW FOR AN UNREADABLE TOKEN: the neutral grey.
			Expect(Near(Look.Outline.R, ObserverNeutralOutline.R) && Near(Look.Outline.G, ObserverNeutralOutline.G) && Near(Look.Outline.B, ObserverNeutralOutline.B),
				Label + " neutral outline");
		}
		Expect(Look.OwnerName == Row.ExpectedOwner, Label + " owner '" + Look.OwnerName + "'");
		Expect(Look.bTitleShown == Row.bTitleShown, Label + " title shown");
		Expect(Look.Title == Row.ExpectedTitle, Label + " title '" + Look.Title + "'");
		Expect(Look.StatusLabel == Row.ExpectedStatus, Label + " status '" + Look.StatusLabel + "'");
	}
	{
		FRgb Colour;
		Expect(ParseColorToken("#FFFFFF", Colour) && Near(Colour.R, 1.0f) && Near(Colour.G, 1.0f) && Near(Colour.B, 1.0f), "token white");
		Expect(ParseColorToken("#000000", Colour) && Near(Colour.R, 0.0f), "token black");
		// sRGB DECODED like FLinearColor(FColor): 0x80 -> 0.2158605.
		Expect(ParseColorToken("#808080", Colour) && std::fabs(Colour.R - 0.2158605f) < 1e-5f, "token srgb decode");
		Expect(ParseColorToken("#ffd400", Colour) && Near(Colour.R, 1.0f) && std::fabs(Colour.G - 0.6583748f) < 1e-5f && Near(Colour.B, 0.0f), "token lower case");
		FRgb Untouched{ 0.25f, 0.5f, 0.75f };
		Expect(!ParseColorToken("FFD400", Untouched) && Near(Untouched.G, 0.5f), "token without # refused, output untouched");
		Expect(!ParseColorToken("#FFD4000", Untouched) && !ParseColorToken("", Untouched) && !ParseColorToken("#", Untouched), "token length refused");
		// THE TITLE IS CAPPED ON A CODE POINT BOUNDARY.
		FObserverViewInput Long;
		Long.OwnerName = "Fable";
		Long.bHasTitle = true;
		for (int Index = 0; Index < 100; ++Index)
		{
			Long.Title += "\xE2\x80\x94";
		}
		const FObserverLook Capped = ResolveObserver(Long);
		Expect(Capped.Title.size() <= MaxObserverTitleBytes && Capped.Title.size() % 3 == 0, "observer title capped on a code point");
		const char* Phases[] = { "opening", "live", "minimized", "focused", "closing", "closed" };
		for (const char* Phase : Phases)
		{
			Expect(ParsePhase(Phase) != EWindowPhase::Unknown, std::string("phase ") + Phase);
		}
	}
	{
		EVisualIntent Parsed = EVisualIntent::Minimize;
		Expect(!ParseIntent("fold", Parsed) && Parsed == EVisualIntent::Minimize, "unknown intent refused, output untouched");
		// THE TWO RULES THAT MATTER MOST: a close is not the fold, and a close never wears VM ENDED.
		Expect(PlanFor(EVisualIntent::Close).Exit != PlanFor(EVisualIntent::Minimize).Exit, "close is not the fold");
		Expect(!PlanFor(EVisualIntent::Close).bMarksVmEnded, "close never marks VM ended");
		Expect(PlanFor(EVisualIntent::VmEnded).bDismisses && PlanFor(EVisualIntent::VmEnded).bLeavesAfterVeil, "VM ended leaves only after the veil (FORGE: closing)");
		Expect(!PlanFor(EVisualIntent::Close).bLeavesAfterVeil, "close leaves at once");
		Expect(!PlanFor(EVisualIntent::SpawnInline).bCameraCloseUp, "inline spawn never moves the camera");
	}

	// ------------------------------------------------------------------------------------------ KAT-SHAPE
	{
		// THE FOLD IS THE LEGACY TRANSFORM TO THE DIGIT: identity at >= 0.999, else (1, max(Open, 0.01)), opaque.
		const float Opens[] = { 1.0f, 0.999f, 0.5f, 0.2f, 0.01f, 0.005f, 0.0f };
		for (const float Open : Opens)
		{
			for (const bool bLeaving : { false, true })
			{
				const FFrameShape Fold = ShapeFor(EExitStyle::Fold, bLeaving, Open);
				const bool bIdentity = Open >= 0.999f;
				Expect(Fold.bIdentity == bIdentity && Near(Fold.ScaleX, 1.0f) && Near(Fold.Opacity, 1.0f)
					&& (bIdentity ? Near(Fold.ScaleY, 1.0f) : Near(Fold.ScaleY, Open > 0.01f ? Open : 0.01f)),
					"fold shape " + std::to_string(Open) + (bLeaving ? " leaving" : " opening"));
				// OPENING NEVER USES THE CLOSE SHAPE: a window that was closed unfolds when it comes back.
				const FFrameShape OpeningAfterClose = ShapeFor(EExitStyle::Close, false, Open);
				Expect(OpeningAfterClose.bIdentity == Fold.bIdentity && Near(OpeningAfterClose.ScaleY, Fold.ScaleY) && Near(OpeningAfterClose.Opacity, 1.0f),
					"opening after close unfolds " + std::to_string(Open));
			}
		}
		const FFrameShape Half = ShapeFor(EExitStyle::Close, true, 0.5f);
		Expect(!Half.bIdentity && Near(Half.ScaleX, 0.93f) && Near(Half.ScaleY, 0.93f) && Near(Half.Opacity, 0.5f), "close shape half");
		const FFrameShape Gone = ShapeFor(EExitStyle::Close, true, 0.0f);
		Expect(Near(Gone.ScaleX, 0.86f) && Near(Gone.ScaleY, 0.86f) && Near(Gone.Opacity, 0.0f), "close shape gone");
		Expect(ShapeFor(EExitStyle::Close, true, 1.0f).bIdentity, "close shape open is identity");
		Expect(ShapeFor(EExitStyle::Fold, true, std::nanf("")).ScaleY > 0.0f, "NaN open never collapses to zero scale");
		Expect(Near(LeaveSecondsFor(EExitStyle::Fold, 0.3f, 0.22f), 0.3f), "fold keeps 0.3 s");
		Expect(Near(LeaveSecondsFor(EExitStyle::Close, 0.3f, 0.22f), 0.22f), "close uses its own time");
		Expect(Near(LeaveSecondsFor(EExitStyle::Close, 0.3f, 0.0f), 0.01f), "leave time floored");
	}

	// ------------------------------------------------------------------------------------------ KAT-VEIL
	{
		float Veil = 0.0f;
		for (int Step = 0; Step < 9; ++Step)
		{
			Veil = StepVeil(Veil, true, 0.05f, 0.45f);
		}
		Expect(Near(Veil, 1.0f), "veil fully on after its time");
		Expect(Near(StepVeil(1.0f, true, 1.0f, 0.45f), 1.0f), "veil capped at 1");
		Expect(Near(StepVeil(0.5f, false, 0.45f, 0.45f), 0.0f), "veil goes off");
		Expect(Near(StepVeil(0.2f, true, -1.0f, 0.45f), 0.2f), "negative time is no step");
		Expect(VeilDim > 0.0f && VeilDim < 1.0f, "veil dims, never blacks out");
	}

	// THE MAPPING TABLE, printed so a reviewer reads it from the run, not from this file.
	std::printf("KAT-MAP %-18s -> %-17s %s\n", "FORGE intent", "EVisualIntent", "window does");
	for (const FIntentRow& Row : IntentRows)
	{
		const FIntentPlan Plan = PlanFor(Row.Intent);
		std::string Does;
		Does += Plan.bOpens ? (Plan.bCameraCloseUp ? "unfold + camera close-up" : "unfold in place, camera untouched") : "";
		Does += Plan.bMinimizes ? "fold to chip (still held)" : "";
		Does += Plan.bRestores ? "unfold from chip" : "";
		Does += Plan.bMarksVmEnded ? "veil + cause badge, then close shape" : (Plan.bDismisses ? "close shape (no VM ENDED)" : "");
		Does += Plan.bCameraReturn ? "nothing (camera is the manager's)" : "";
		static const char* Enum[] = { "SpawnWithCloseUp", "SpawnInline", "Minimize", "Close", "VmEnded", "RestoreUnfold", "CameraReturn" };
		std::printf("KAT-MAP %-18s -> %-17s %s\n", Row.Name, Enum[static_cast<int>(Row.Intent)], Does.c_str());
	}
	std::printf("KAT-MAP %-18s -> %-17s %s\n", "admission queued_chip", "PresentQueuedChip", "chip from the start, no animation");
	for (const FCauseRow& Row : CauseRows)
	{
		if (Row.Expected != EEndCause::None && Row.Expected != EEndCause::Unknown)
		{
			std::printf("KAT-CAUSE %-22s -> \"%s\"\n", Row.Wire, EndCauseBadge(Row.Expected));
		}
	}
	std::printf("KAT-CAUSE %-22s -> \"%s\"\n", "(none / unknown)", EndCauseBadge(EEndCause::Unknown));

	if (Failures != 0)
	{
		std::printf("WONDER WEB WINDOW LOOK KAT FAIL failures=%d of checks=%d\n", Failures, Checks);
		return 1;
	}
	std::printf("WONDER WEB WINDOW LOOK KAT PASS checks=%d title=%zu number=%zu accent=%zu intent=%zu alias=%zu cause=%zu admit=%zu observer=%zu\n",
		Checks, CountOf(TitleRows), CountOf(NumberRows), CountOf(AccentRows), CountOf(IntentRows), CountOf(AliasRows), CountOf(CauseRows),
		CountOf(AdmitRows), CountOf(ObserverRows));
	return 0;
}

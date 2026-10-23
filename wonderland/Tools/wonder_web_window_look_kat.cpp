// WONDERLAND -- WONDER WEB VM WINDOW LOOK: KNOWN-ANSWER TEST. No Unreal, no network, no secrets, no randomness.
//
// Build and run from the repository root (any C++17 compiler):
//   g++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -DWL_WINDOWLOOK_STANDALONE -I wonderland/Source/Wonderland
//       wonderland/Tools/wonder_web_window_look_kat.cpp wonderland/Source/Wonderland/WonderlandWonderWebWindowLook.cpp
//       -o wonder_web_window_look_kat
//   (one command line, wrapped here)
//   ./wonder_web_window_look_kat   -> prints "WONDER WEB WINDOW LOOK KAT PASS ..." and exits 0, or names every failure and exits 1.
//
// WHAT IT PINS (founder, 2026-10-23): the title "<agent's custom name> — Wonder Web VM <N>"; the parent terminal as
// metadata only; a provider label never standing in for a name (a missing name is the neutral "Unnamed agent"); the
// VM number as shown; the outline colour and its fall back to the legacy #FFD400; the per-terminal companion colour's
// fall back to the shared colour and then the theme; and the visual-intent contract the window manager drives.
// Inputs with non-ASCII bytes are written as escapes; "\xE2\x80\x94" is U+2014 EM DASH.
#include "WonderlandWonderWebWindowLook.h"

#include <cmath>
#include <cstdio>
#include <string>

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

	struct FTitleRow
	{
		const char* Label;
		const char* Name;
		int Number;
		const char* Provider;
		const char* ExpectedTitle;
		ENameIssue ExpectedIssue;
	};

	// KAT-TITLE: the name as given (sanitised), the number as shown, the neutral word for a missing or provider-only name.
	const FTitleRow TitleRows[] = {
		{ "plain",              "Fable",                    1,   "",          "Fable \xE2\x80\x94 Wonder Web VM 1",                 ENameIssue::None },
		{ "two_words",          "Grok Bot",                 2,   "xai",       "Grok Bot \xE2\x80\x94 Wonder Web VM 2",              ENameIssue::None },
		{ "dot",                "Dot 3",                    3,   "",          "Dot 3 \xE2\x80\x94 Wonder Web VM 3",                 ENameIssue::None },
		{ "julius_card",        "Julius: ship landing page",12,  "",          "Julius: ship landing page \xE2\x80\x94 Wonder Web VM 12", ENameIssue::None },
		{ "custom_with_brand",  "Claude Code Fable 5",      4,   "anthropic", "Claude Code Fable 5 \xE2\x80\x94 Wonder Web VM 4",   ENameIssue::None },
		{ "trimmed",            "   Astra   ",              1,   "",          "Astra \xE2\x80\x94 Wonder Web VM 1",                 ENameIssue::None },
		{ "collapsed_ws",       "Astra\t\t  Two",           1,   "",          "Astra Two \xE2\x80\x94 Wonder Web VM 1",             ENameIssue::None },
		{ "newline_is_space",   "Astra\nTwo",               1,   "",          "Astra Two \xE2\x80\x94 Wonder Web VM 1",             ENameIssue::None },
		{ "utf8_kept",          "Zo\xC3\xAB \xF0\x9F\x90\xB6", 7, "",         "Zo\xC3\xAB \xF0\x9F\x90\xB6 \xE2\x80\x94 Wonder Web VM 7", ENameIssue::None },
		{ "bidi_dropped",       "Ast\xE2\x80\xAEra",        1,   "",          "Astra \xE2\x80\x94 Wonder Web VM 1",                 ENameIssue::None },
		{ "zero_width_dropped", "A\xE2\x80\x8B" "stra",     1,   "",          "Astra \xE2\x80\x94 Wonder Web VM 1",                 ENameIssue::None },
		{ "bad_utf8_dropped",   "As\xFFtra\xC3",            1,   "",          "Astra \xE2\x80\x94 Wonder Web VM 1",                 ENameIssue::None },
		{ "overlong_dropped",   "A\xC0\xAFstra",            1,   "",          "Astra \xE2\x80\x94 Wonder Web VM 1",                 ENameIssue::None },
		{ "empty",              "",                         1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::Empty },
		{ "only_spaces",        " \t\r\n ",                 2,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 2",         ENameIssue::Empty },
		{ "only_invisible",     "\xE2\x80\x8B\xEF\xBB\xBF", 2,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 2",         ENameIssue::Empty },
		{ "provider_openai",    "OpenAI",                   1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::ProviderLabel },
		{ "provider_chatgpt",   "chatgpt",                  1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::ProviderLabel },
		{ "provider_claude",    "Claude",                   1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::ProviderLabel },
		{ "provider_cc_id",     "claude-code",              3,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 3",         ENameIssue::ProviderLabel },
		{ "provider_grok_caps", "  GROK ",                  1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::ProviderLabel },
		{ "provider_gemini",    "Gemini",                   1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::ProviderLabel },
		{ "provider_dev_id",    "dev-companion",            1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::ProviderLabel },
		{ "provider_passed",    "Acme Models",              1,   "acme models", "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",       ENameIssue::ProviderLabel },
		{ "provider_zw_hidden", "Ope\xE2\x80\x8BnAI",       1,   "",          "Unnamed agent \xE2\x80\x94 Wonder Web VM 1",         ENameIssue::ProviderLabel },
		{ "no_number_zero",     "Fable",                    0,   "",          "Fable \xE2\x80\x94 Wonder Web VM",                   ENameIssue::None },
		{ "no_number_negative", "Fable",                    -2,  "",          "Fable \xE2\x80\x94 Wonder Web VM",                   ENameIssue::None },
		{ "no_number_huge",     "Fable",                    10000, "",        "Fable \xE2\x80\x94 Wonder Web VM",                   ENameIssue::None },
		{ "number_max",         "Fable",                    9999, "",         "Fable \xE2\x80\x94 Wonder Web VM 9999",              ENameIssue::None },
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
		bool bCamera, bOpens, bMinimizes, bDismisses, bMarksEnded, bClearsEnded;
		EExitStyle Exit;
	};

	// KAT-INTENT: the contract with the window manager.
	const FIntentRow IntentRows[] = {
		{ EVisualIntent::SpawnWithCloseUp, "spawn_close_up", true,  true,  false, false, false, true,  EExitStyle::Fold },
		{ EVisualIntent::SpawnInline,      "spawn_inline",   false, true,  false, false, false, true,  EExitStyle::Fold },
		{ EVisualIntent::Minimize,         "minimize",       false, false, true,  false, false, false, EExitStyle::Fold },
		{ EVisualIntent::Close,            "close",          false, false, false, true,  false, false, EExitStyle::Close },
		{ EVisualIntent::VmEnded,          "vm_ended",       false, false, false, false, true,  false, EExitStyle::Fold },
	};
}

int main()
{
	// ------------------------------------------------------------------------------------------------ KAT-TITLE
	for (const FTitleRow& Row : TitleRows)
	{
		FIdentityInput Input;
		Input.AgentDisplayName = Row.Name;
		Input.VmNumber = Row.Number;
		Input.ProviderLabel = Row.Provider;
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Title == Row.ExpectedTitle, std::string("title ") + Row.Label + ": got [" + Look.Title + "]");
		Expect(Look.NameIssue == Row.ExpectedIssue, std::string("name issue ") + Row.Label);
		// THE PROVIDER NEVER APPEARS IN A TITLE IT WAS REFUSED FROM.
		if (Row.ExpectedIssue == ENameIssue::ProviderLabel)
		{
			Expect(Look.Name == UnnamedAgent, std::string("provider refused ") + Row.Label);
		}
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
	// A CUSTOM NAME THAT CONTAINS A PROVIDER WORD IS STILL THE AGENT'S NAME.
	Expect(!IsProviderLabel("Claude Code Fable 5", ""), "brand inside a name is allowed");
	Expect(!IsProviderLabel("Grok Bot", "xai"), "Grok Bot is a name");
	Expect(IsProviderLabel("grok", ""), "grok alone is a label");
	Expect(!IsProviderLabel("", "openai"), "empty is not a label");

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
		Expect(Look.Metadata.empty() && Look.ParentIssue == ENameIssue::ProviderLabel, "provider-only parent shows no metadata");
	}
	{
		FIdentityInput Input;
		Input.AgentDisplayName = "Fable";
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Metadata.empty() && Look.ParentIssue == ENameIssue::Empty, "missing parent shows no metadata");
	}
	{
		// A MISSING NAME IS NOT FILLED FROM THE PARENT OR THE PROVIDER.
		FIdentityInput Input;
		Input.ParentTerminalName = "Astra";
		Input.ProviderLabel = "openai";
		Input.VmNumber = 1;
		const FResolvedLook Look = Resolve(Input);
		Expect(Look.Name == UnnamedAgent && Look.Metadata == "Astra", "missing name stays neutral");
		Expect(Look.Title.find("openai") == std::string::npos && Look.Title.find("Astra") == std::string::npos, "nothing borrowed");
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
		Expect(std::string(IntentName(Row.Intent)) == Row.Name, Label + " name");
		EVisualIntent Parsed = EVisualIntent::SpawnInline;
		Expect(ParseIntent(Row.Name, Parsed) && Parsed == Row.Intent, Label + " parse");
	}
	{
		EVisualIntent Parsed = EVisualIntent::Minimize;
		Expect(!ParseIntent("fold", Parsed) && Parsed == EVisualIntent::Minimize, "unknown intent refused, output untouched");
		// THE TWO RULES THAT MATTER MOST: a close is not the fold, and a close never wears VM ENDED.
		Expect(PlanFor(EVisualIntent::Close).Exit != PlanFor(EVisualIntent::Minimize).Exit, "close is not the fold");
		Expect(!PlanFor(EVisualIntent::Close).bMarksVmEnded, "close never marks VM ended");
		Expect(!PlanFor(EVisualIntent::VmEnded).bDismisses, "VM ended keeps the window");
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

	if (Failures != 0)
	{
		std::printf("WONDER WEB WINDOW LOOK KAT FAIL failures=%d of checks=%d\n", Failures, Checks);
		return 1;
	}
	std::printf("WONDER WEB WINDOW LOOK KAT PASS checks=%d title=%zu number=%zu accent=%zu intent=%zu\n",
		Checks, CountOf(TitleRows), CountOf(NumberRows), CountOf(AccentRows), CountOf(IntentRows));
	return 0;
}

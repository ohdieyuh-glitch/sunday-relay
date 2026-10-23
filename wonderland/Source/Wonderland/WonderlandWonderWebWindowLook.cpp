// WONDERLAND -- THE LOOK OF ONE WONDER WEB VM WINDOW. See WonderlandWonderWebWindowLook.h for the contract.
#include "WonderlandWonderWebWindowLook.h"

#include <algorithm>
#include <cctype>

namespace WonderlandWonderWebWindowLook
{
	const char* const UnnamedAgent = "Unnamed agent";
	const char* const TitleJoin = " \xE2\x80\x94 Wonder Web VM";
	const char* const VmEndedBadge = "VM ENDED";

	namespace
	{
		/** One code point from Utf8 at Index, or -1 for a malformed sequence (Length is then 1: skip the byte). */
		long DecodeOne(const std::string& Utf8, std::size_t Index, std::size_t& Length)
		{
			const unsigned char Lead = static_cast<unsigned char>(Utf8[Index]);
			Length = 1;
			if (Lead < 0x80)
			{
				return Lead;
			}
			std::size_t Need = 0;
			long Point = 0;
			long Min = 0;
			if ((Lead & 0xE0) == 0xC0) { Need = 1; Point = Lead & 0x1F; Min = 0x80; }
			else if ((Lead & 0xF0) == 0xE0) { Need = 2; Point = Lead & 0x0F; Min = 0x800; }
			else if ((Lead & 0xF8) == 0xF0) { Need = 3; Point = Lead & 0x07; Min = 0x10000; }
			else { return -1; }
			if (Index + Need >= Utf8.size())
			{
				return -1;
			}
			for (std::size_t Step = 1; Step <= Need; ++Step)
			{
				const unsigned char Next = static_cast<unsigned char>(Utf8[Index + Step]);
				if ((Next & 0xC0) != 0x80)
				{
					return -1;
				}
				Point = (Point << 6) | (Next & 0x3F);
			}
			// OVERLONG, SURROGATE OR PAST U+10FFFF: not a character.
			if (Point < Min || (Point >= 0xD800 && Point <= 0xDFFF) || Point > 0x10FFFF)
			{
				return -1;
			}
			Length = Need + 1;
			return Point;
		}

		bool IsSpaceLike(long Point)
		{
			return Point == 0x20 || Point < 0x20 || Point == 0x7F || (Point >= 0x80 && Point <= 0x9F) || Point == 0xA0
				|| Point == 0x1680 || (Point >= 0x2000 && Point <= 0x200A) || Point == 0x2028 || Point == 0x2029
				|| Point == 0x202F || Point == 0x205F || Point == 0x3000;
		}

		/** Invisible characters that can hide or reorder what a title appears to say. */
		bool IsInvisible(long Point)
		{
			return (Point >= 0x200B && Point <= 0x200F) || (Point >= 0x202A && Point <= 0x202E) || (Point >= 0x2060 && Point <= 0x2069)
				|| Point == 0xFEFF || Point == 0x00AD || Point == 0x061C || Point == 0x180E;
		}

		std::string Trim(const std::string& Text)
		{
			const std::size_t First = Text.find_first_not_of(' ');
			if (First == std::string::npos)
			{
				return std::string();
			}
			const std::size_t Last = Text.find_last_not_of(' ');
			return Text.substr(First, Last - First + 1);
		}

		std::string LowerAscii(const std::string& Text)
		{
			std::string Out = Text;
			for (char& Character : Out)
			{
				Character = static_cast<char>(std::tolower(static_cast<unsigned char>(Character)));
			}
			return Out;
		}

		/** Provider labels and the provider ids the client already uses ("dev-companion" is the Dev companion's provider id). */
		const char* const ProviderLabels[] = {
			"openai", "open ai", "chatgpt", "chat gpt", "gpt", "codex", "openai codex",
			"anthropic", "claude", "claude code", "claude-code", "claude_code",
			"xai", "x.ai", "x ai", "grok",
			"google", "gemini", "google gemini", "deepmind",
			"cursor", "meta", "llama", "mistral", "deepseek", "qwen", "perplexity", "copilot", "github copilot",
			"dev-companion", "dev_companion", "dev-single-agent", "dev_single_agent",
		};

		float Clamp01(float Value)
		{
			return Value != Value ? 0.0f : std::min(1.0f, std::max(0.0f, Value));
		}
	}

	std::string SanitizeName(const std::string& Utf8, std::size_t MaxBytes)
	{
		std::string Clean;
		Clean.reserve(Utf8.size());
		bool bPendingSpace = false;
		for (std::size_t Index = 0; Index < Utf8.size();)
		{
			std::size_t Length = 1;
			const long Point = DecodeOne(Utf8, Index, Length);
			if (Point < 0 || IsInvisible(Point))
			{
				Index += Length;
				continue;
			}
			if (IsSpaceLike(Point))
			{
				bPendingSpace = !Clean.empty();
				Index += Length;
				continue;
			}
			if (bPendingSpace)
			{
				Clean.push_back(' ');
				bPendingSpace = false;
			}
			Clean.append(Utf8, Index, Length);
			Index += Length;
		}
		if (Clean.size() > MaxBytes)
		{
			std::size_t Cut = MaxBytes;
			while (Cut > 0 && (static_cast<unsigned char>(Clean[Cut]) & 0xC0) == 0x80)
			{
				--Cut;
			}
			Clean.resize(Cut);
		}
		return Trim(Clean);
	}

	bool IsProviderLabel(const std::string& Name, const std::string& ProviderLabel)
	{
		const std::string Lower = LowerAscii(Trim(Name));
		if (Lower.empty())
		{
			return false;
		}
		for (const char* Label : ProviderLabels)
		{
			if (Lower == Label)
			{
				return true;
			}
		}
		const std::string Given = LowerAscii(SanitizeName(ProviderLabel));
		return !Given.empty() && Lower == Given;
	}

	std::string FormatVmNumber(int VmNumber)
	{
		return VmNumber >= 1 && VmNumber <= 9999 ? std::to_string(VmNumber) : std::string();
	}

	std::string MakeTitle(const std::string& Name, int VmNumber)
	{
		std::string Title = Name;
		Title += TitleJoin;
		const std::string Number = FormatVmNumber(VmNumber);
		if (!Number.empty())
		{
			Title += ' ';
			Title += Number;
		}
		return Title;
	}

	FResolvedLook Resolve(const FIdentityInput& Input)
	{
		FResolvedLook Look;
		const std::string Name = SanitizeName(Input.AgentDisplayName);
		if (Name.empty())
		{
			Look.NameIssue = ENameIssue::Empty;
			Look.Name = UnnamedAgent;
		}
		else if (IsProviderLabel(Name, Input.ProviderLabel))
		{
			// NEVER THE PROVIDER IN THE NAME'S PLACE: a neutral word, and the window manager logs why.
			Look.NameIssue = ENameIssue::ProviderLabel;
			Look.Name = UnnamedAgent;
		}
		else
		{
			Look.Name = Name;
		}
		Look.bNumberShown = !FormatVmNumber(Input.VmNumber).empty();
		Look.Title = MakeTitle(Look.Name, Input.VmNumber);

		const std::string Parent = SanitizeName(Input.ParentTerminalName);
		if (Parent.empty())
		{
			Look.ParentIssue = ENameIssue::Empty;
		}
		else if (IsProviderLabel(Parent, Input.ProviderLabel))
		{
			// THE PARENT LINE IS METADATA, NOT A PROVIDER LABEL: a terminal named only for its provider shows no line.
			Look.ParentIssue = ENameIssue::ProviderLabel;
		}
		else
		{
			Look.Metadata = Parent;
		}

		if (Input.bHasParentAccent)
		{
			Look.OutlineSource = EOutlineSource::ParentTerminal;
			Look.Outline = FRgb{ Clamp01(Input.ParentAccent.R), Clamp01(Input.ParentAccent.G), Clamp01(Input.ParentAccent.B) };
		}
		Look.bVmEnded = Input.State == ESessionState::Ended || Input.State == ESessionState::Failed;
		return Look;
	}

	FIntentPlan PlanFor(EVisualIntent Intent)
	{
		FIntentPlan Plan;
		switch (Intent)
		{
		case EVisualIntent::SpawnWithCloseUp:
			Plan.bCameraCloseUp = true;
			Plan.bOpens = true;
			Plan.bClearsVmEnded = true;
			break;
		case EVisualIntent::SpawnInline:
			Plan.bOpens = true;
			Plan.bClearsVmEnded = true;
			break;
		case EVisualIntent::Minimize:
			Plan.bMinimizes = true;
			Plan.Exit = EExitStyle::Fold;
			break;
		case EVisualIntent::Close:
			// CLOSE IS NOT THE FOLD, AND CLOSE IS NOT "VM ENDED": it says nothing about the VM.
			Plan.bDismisses = true;
			Plan.Exit = EExitStyle::Close;
			break;
		case EVisualIntent::VmEnded:
			// THE WINDOW STAYS: the player sees that it ended, and closes it when they choose.
			Plan.bMarksVmEnded = true;
			break;
		}
		return Plan;
	}

	FFrameShape ShapeFor(EExitStyle Exit, bool bLeaving, float Open)
	{
		const float Value = Clamp01(Open);
		FFrameShape Shape;
		if (Value >= 0.999f)
		{
			return Shape;
		}
		Shape.bIdentity = false;
		if (bLeaving && Exit == EExitStyle::Close)
		{
			const float Scale = 0.86f + 0.14f * Value;
			Shape.ScaleX = Scale;
			Shape.ScaleY = Scale;
			Shape.Opacity = Value;
			return Shape;
		}
		// THE LEGACY FOLD, to the digit: FScale2D(1, max(Open, 0.01)), fully opaque.
		Shape.ScaleY = std::max(Value, 0.01f);
		return Shape;
	}

	float LeaveSecondsFor(EExitStyle Exit, float FoldSeconds, float CloseSeconds)
	{
		return std::max(Exit == EExitStyle::Close ? CloseSeconds : FoldSeconds, 0.01f);
	}

	float StepVeil(float Current, bool bEnded, float DeltaSeconds, float Seconds)
	{
		const float Step = std::max(DeltaSeconds, 0.0f) / std::max(Seconds, 0.01f);
		const float Value = Clamp01(Current);
		return bEnded ? std::min(1.0f, Value + Step) : std::max(0.0f, Value - Step);
	}

	EAccentSource PickCompanionAccentSource(bool bPerTerminalChosen, bool bSharedChosen)
	{
		return bPerTerminalChosen ? EAccentSource::PerTerminal : (bSharedChosen ? EAccentSource::SharedCompanion : EAccentSource::Theme);
	}

	const char* IntentName(EVisualIntent Intent)
	{
		switch (Intent)
		{
		case EVisualIntent::SpawnWithCloseUp: return "spawn_close_up";
		case EVisualIntent::SpawnInline: return "spawn_inline";
		case EVisualIntent::Minimize: return "minimize";
		case EVisualIntent::Close: return "close";
		case EVisualIntent::VmEnded: return "vm_ended";
		}
		return "spawn_inline";
	}

	bool ParseIntent(const std::string& Name, EVisualIntent& OutIntent)
	{
		const EVisualIntent All[] = { EVisualIntent::SpawnWithCloseUp, EVisualIntent::SpawnInline, EVisualIntent::Minimize, EVisualIntent::Close, EVisualIntent::VmEnded };
		for (const EVisualIntent Intent : All)
		{
			if (Name == IntentName(Intent))
			{
				OutIntent = Intent;
				return true;
			}
		}
		return false;
	}
}

#if !defined(WL_WINDOWLOOK_STANDALONE)
// ===================================================================================================== the Unreal half

#include "WonderlandWonderWebPanel.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandUiStyle.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandWonderWebLook, Log, All);

namespace WonderlandWonderWebWindowLook
{
	namespace
	{
		std::string ToUtf8(const FString& Text)
		{
			const FTCHARToUTF8 Converted(*Text);
			return std::string(Converted.Get(), Converted.Length());
		}

		FString FromUtf8(const std::string& Text)
		{
			const FUTF8ToTCHAR Converted(Text.data(), static_cast<int32>(Text.size()));
			return FString(Converted.Length(), Converted.Get());
		}

		/** A missing name is logged once per session, not once per repaint. Bounded: a long session never grows it far. */
		bool FirstReportFor(const FString& SessionId)
		{
			static TSet<FString> Reported;
			if (Reported.Contains(SessionId))
			{
				return false;
			}
			if (Reported.Num() >= 512)
			{
				Reported.Reset();
			}
			Reported.Add(SessionId);
			return true;
		}
	}

	FWonderWebWindowLook ResolveLook(const FWonderWebWindowIdentity& Identity)
	{
		FIdentityInput Input;
		Input.AgentDisplayName = ToUtf8(Identity.AgentDisplayName);
		Input.VmNumber = Identity.VmNumber;
		Input.ParentTerminalName = ToUtf8(Identity.ParentTerminalName);
		Input.bHasParentAccent = Identity.bHasParentAccent;
		Input.ParentAccent = FRgb{ Identity.ParentAccent.R, Identity.ParentAccent.G, Identity.ParentAccent.B };
		Input.State = Identity.State;
		Input.ProviderLabel = ToUtf8(Identity.ProviderLabel);
		const FResolvedLook Resolved = Resolve(Input);

		if (Resolved.NameIssue != ENameIssue::None && FirstReportFor(Identity.VmSessionId))
		{
			// THE SESSION ID AND THE REASON, never the provider and never the rejected text.
			UE_LOG(LogWonderlandWonderWebLook, Warning, TEXT("WLWONDERWEB window for session '%s' has %s agent name; shown as \"%s\""),
				*Identity.VmSessionId.Left(64),
				Resolved.NameIssue == ENameIssue::Empty ? TEXT("no") : TEXT("only a provider label as its"),
				UTF8_TO_TCHAR(UnnamedAgent));
		}

		FWonderWebWindowLook Look;
		Look.bSet = true;
		Look.Title = FromUtf8(Resolved.Title);
		Look.Metadata = FromUtf8(Resolved.Metadata);
		Look.bHasOutline = Resolved.OutlineSource == EOutlineSource::ParentTerminal;
		Look.Outline = Look.bHasOutline ? FLinearColor(Resolved.Outline.R, Resolved.Outline.G, Resolved.Outline.B, 1.0f) : FLinearColor::Transparent;
		Look.bVmEnded = Resolved.bVmEnded;
		Look.bNameMissing = Resolved.NameIssue != ENameIssue::None;
		return Look;
	}

	FLinearColor ParentTerminalOutline(EWonderWebParentKind Kind, int32 TerminalIndex)
	{
		return Kind == EWonderWebParentKind::Julius ? WonderlandUi::JuliusAccent() : WonderlandMascotStyle::CompanionTerminalAccentFor(TerminalIndex);
	}

	TSharedRef<SWidget> MakeTitleBlock(TFunction<const FWonderWebWindowLook*()> GetLook)
	{
		using namespace WonderWebLook;
		auto IsSet = [GetLook]() { const FWonderWebWindowLook* Look = GetLook ? GetLook() : nullptr; return Look != nullptr && Look->bSet; };
		// CAPPED: a long agent name ends in an ellipsis rather than pushing the tabs out of the title bar.
		return SNew(SBox)
			.VAlign(VAlign_Center)
			.MaxDesiredWidth(560.0f)
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot()
				.AutoHeight()
				[
					SNew(STextBlock)
					.Text_Lambda([GetLook, IsSet]() { return IsSet() ? FText::FromString(GetLook()->Title) : INVTEXT("WONDER WEB"); })
					// UNSET IS THE OLD LETTERING EXACTLY: Sans(26, bold, 160) in the Wonder Web's line colour.
					.Font_Lambda([IsSet]() { return IsSet() ? Sans(21, true, 20) : Sans(26, true, 160); })
					.ColorAndOpacity(Line())
					.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
				]
				+ SVerticalBox::Slot()
				.AutoHeight()
				.Padding(0.0f, 2.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text_Lambda([GetLook, IsSet]() { return IsSet() ? FText::FromString(GetLook()->Metadata) : FText::GetEmpty(); })
					.Visibility_Lambda([GetLook, IsSet]() { return IsSet() && !GetLook()->Metadata.IsEmpty() ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
					.Font(Sans(14, false, 20))
					.ColorAndOpacity(Line(0.68f))
					.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
				]
			];
	}
}

void SWonderWebVmEndedVeil::Construct(const FArguments& InArgs)
{
	using namespace WonderWebLook;
	Shown = InArgs._Shown;
	Accent = InArgs._Accent;
	// THE BADGE'S RING IS ITS OWN FILL, TINTED: the outline colour arrives per window, a brush's outline does not.
	BadgeBrush = FSlateRoundedBoxBrush(FLinearColor::White, 16.0f, FLinearColor::White, 0.0f);
	BadgeInnerBrush = FSlateRoundedBoxBrush(Ink(0.94f), 13.0f, Ink(0.0f), 0.0f);

	SetVisibility(TAttribute<EVisibility>::CreateLambda([this]() { return Shown.Get() > 0.001f ? EVisibility::HitTestInvisible : EVisibility::Collapsed; }));
	// ONE FADE FOR THE WHOLE VEIL: everything under it is multiplied by Shown.
	SetColorAndOpacity(TAttribute<FLinearColor>::CreateLambda([this]() { return FLinearColor(1.0f, 1.0f, 1.0f, FMath::Clamp(Shown.Get(), 0.0f, 1.0f)); }));

	ChildSlot
	[
		SNew(SOverlay)
		+ SOverlay::Slot()
		[
			// THE GLASS DIMS: a veil, not a wall -- the last page stays readable under it.
			SNew(SImage)
			.Image(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.ColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, WonderlandWonderWebWindowLook::VeilDim))
		]
		+ SOverlay::Slot()
		.HAlign(HAlign_Center)
		.VAlign(VAlign_Center)
		[
			SNew(SBorder)
			.BorderImage(&BadgeBrush)
			.BorderBackgroundColor_Lambda([this]() { return FSlateColor(Accent.Get()); })
			.Padding(3.0f)
			[
				SNew(SBorder)
				.BorderImage(&BadgeInnerBrush)
				.Padding(FMargin(34.0f, 14.0f))
				[
					SNew(STextBlock)
					.Text(FText::FromString(UTF8_TO_TCHAR(WonderlandWonderWebWindowLook::VmEndedBadge)))
					.Font(Sans(24, true, 200))
					.ColorAndOpacity_Lambda([this]() { return FSlateColor(Accent.Get()); })
				]
			]
		]
	];
}
#endif

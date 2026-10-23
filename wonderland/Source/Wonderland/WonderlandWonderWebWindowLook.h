// WONDERLAND -- THE LOOK OF ONE WONDER WEB VM WINDOW: its title, its outline, and how it comes and goes.
//
// FOUNDER, 2026-10-23: one VM per individual AGENT (each Grok Bot in a group chat, each Dot, each Julius working card).
// A window's title is "<agent's custom name> — Wonder Web VM <N>", N scoped to the parent terminal and reusable behind a
// stable internal session id; the parent companion is SECONDARY metadata; a provider label never replaces the name; the
// outline is the PARENT terminal's own custom outline colour.
//
// THIS FILE DECIDES HOW A WINDOW LOOKS, NEVER WHAT A WINDOW IS. Which windows exist, their numbers, which one gets the
// camera and when one closes are the window manager's (FORGE: WonderlandWonderWebWindows / WonderlandWonderWebWindowLogic).
// It hands this file the window's identity and a VISUAL INTENT; this file answers with the title, the metadata line, the
// outline colour and the animation plan, and the window actor and panels draw exactly that.
//
// THE CONTRACT WITH THE WINDOW MANAGER is EVisualIntent below, one to one with FORGE's animation intents
// (wonderland-wonder-web-windows.v1: WonderlandWonderWebWindowLogic.h AnimationCue, wonder-web-windows.ts
// ANIMATION_INTENTS). This file never decides which one plays -- FORGE does; PlanForCue only reads FORGE's cue:
//   SpawnWithCloseUp  cinematic_closeup  the first HELD window opens; the window manager blends the camera in
//   SpawnInline       spawn_inline       a window opens while any other is held -- shown OR a minimized chip -- so
//                                        a window opened beside nothing but chips is inline, with no close-up
//   Minimize          minimize_fold      the window folds to its chip; its VM keeps running (the existing 0.3 s fold)
//   RestoreUnfold     restore_unfold     a chip unfolds back into its window (the same fold, reversed)
//   Close             close_anim         the user closed the PANEL: its own short shrink and fade, never the fold, and
//                                        never a VM end -- a close is never an end cause
//   VmEnded           vm_ended_anim      the VM session really ended (ended/failed): the glass dims, a badge names the
//                                        end cause, then the panel leaves with the close motion (FORGE puts it in
//                                        `closing`); a chip whose VM ends leaves at once
//   CameraReturn      camera_return      the LAST held window (chips count as held) left while the camera was in the
//                                        close-up; the window manager blends back. Nothing for a window to draw.
// A 7th (over-cap) window arrives with admission `queued_chip` and NO intent: it starts as a chip and never unfolds
// (PlanForAdmission). FORGE's observerView (outline colour token, owner name, title, status -- and nothing else) has its
// own look: ResolveObserver / SWonderWebObserverCard, which draw those four fields and no frame content.
//
// TWO HALVES. The top half is standard C++17 with no Unreal include, so wonderland/Tools/wonder_web_window_look_kat.cpp
// proves it with g++ on any machine (build it with -DWL_WINDOWLOOK_STANDALONE). The bottom half is the thin Unreal
// adapter: FString in, FLinearColor out, the Slate title block and the VM ENDED veil. Nothing here is compiled against
// Unreal on the box this was written on; the Unreal half is unbuilt until an Unreal build runs it.
//
// NO SECRET, NO PROVIDER, NO URL ever reaches a title. The name is sanitised (controls, bidi overrides and zero-width
// characters removed, length-capped on a code point boundary); a name that is missing, or that is only a provider label
// ("OpenAI", "claude-code" ...), is shown as the neutral "Unnamed agent" and logged by session id -- never replaced by
// the provider's name.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace WonderlandWonderWebWindowLook
{
	/** What the window manager asks a window to do, visually. See the contract above. */
	enum class EVisualIntent : std::uint8_t
	{
		SpawnWithCloseUp,
		SpawnInline,
		Minimize,
		Close,
		VmEnded,
		/** restore_unfold. Appended: the values above are unchanged. */
		RestoreUnfold,
		/** camera_return. The window manager's camera move; a window draws nothing for it. */
		CameraReturn,
	};

	/** Why a VM session ended: BRIDGE's endCause (wonder-web-vm-session.v1), set only on `ended` or `failed`. */
	enum class EEndCause : std::uint8_t
	{
		/** No cause given (omitted or null): the neutral "VM ended". */
		None,
		OwnerTerminated,
		IdleTimeout,
		MaxLifetime,
		ProviderFailed,
		CapExhausted,
		AuthorizationRevoked,
		/** A string that is not one of the six: drawn as the neutral "VM ended", never an error. */
		Unknown,
	};

	/** FORGE's admission for a new window: shown, or past the shown cap as a chip (`queued_chip`). */
	enum class EAdmission : std::uint8_t
	{
		Shown,
		QueuedChip,
	};

	/** FORGE's window phase (the observer's `status`). */
	enum class EWindowPhase : std::uint8_t
	{
		Opening,
		Live,
		Minimized,
		Focused,
		Closing,
		Closed,
		/** Anything else: shown as "Unknown", never guessed. */
		Unknown,
	};

	/** The VM session's state as the session service reports it. Only Ended and Failed wear the VM ENDED look. */
	enum class ESessionState : std::uint8_t
	{
		Unknown,
		Starting,
		Running,
		Ended,
		Failed,
		/** paused. Appended: the values above are unchanged. A paused VM is live, not ended. */
		Paused,
	};

	/** How a window that is leaving (or folding) is drawn. Opening always unfolds, as it always has. */
	enum class EExitStyle : std::uint8_t
	{
		/** The existing Y-fold: minimize, and every legacy Dismiss(). */
		Fold,
		/** The distinct close: a short uniform shrink with a fade. */
		Close,
	};

	/** Where the outline colour came from. */
	enum class EOutlineSource : std::uint8_t
	{
		/** The parent terminal's own colour (a companion terminal's, or the Julius Live Terminal's). */
		ParentTerminal,
		/** No colour was passed: the Wonder Web's own #FFD400, exactly as before this file. */
		LegacyYellow,
	};

	/** Which saved colour a companion terminal wears (WonderlandMascotStyle). */
	enum class EAccentSource : std::uint8_t
	{
		/** This terminal's own colour, picked for it alone. */
		PerTerminal,
		/** The one colour every companion terminal shared before per-terminal colours existed. */
		SharedCompanion,
		/** Nothing chosen for companions at all: the theme accent. */
		Theme,
	};

	/** Why a name could not be shown as given. */
	enum class ENameIssue : std::uint8_t
	{
		None,
		/** Empty (or nothing printable) after sanitising. */
		Empty,
		/** Only a provider label or provider id, which must never stand in for an agent's name. */
		ProviderLabel,
	};

	/** A linear colour, 0..1 per channel. */
	struct FRgb
	{
		float R = 0.0f;
		float G = 0.0f;
		float B = 0.0f;
	};

	/** Everything the window manager knows about the window, as UTF-8. */
	struct FIdentityInput
	{
		/** The agent's own custom name (the bot, the Dot, the Julius card). */
		std::string AgentDisplayName;
		/** N in "Wonder Web VM <N>": scoped to the parent terminal, 1 or more. Anything else shows no number. */
		int VmNumber = 0;
		/** The parent companion terminal's (or Julius's) custom name: secondary metadata. */
		std::string ParentTerminalName;
		bool bHasParentAccent = false;
		FRgb ParentAccent;
		ESessionState State = ESessionState::Unknown;
		/** The provider behind the agent, if known. Used ONLY to refuse it as a name; never shown. */
		std::string ProviderLabel;
	};

	/** What the window wears. */
	struct FResolvedLook
	{
		/** "<name> — Wonder Web VM <N>" (U+2014 EM DASH between spaces). */
		std::string Title;
		/** The name as shown: the sanitised agent name, or "Unnamed agent". */
		std::string Name;
		/** The parent terminal's name, sanitised; empty when there is none to show. */
		std::string Metadata;
		ENameIssue NameIssue = ENameIssue::None;
		ENameIssue ParentIssue = ENameIssue::None;
		bool bNumberShown = false;
		EOutlineSource OutlineSource = EOutlineSource::LegacyYellow;
		/** Meaningful only when OutlineSource is ParentTerminal. */
		FRgb Outline;
		bool bVmEnded = false;
	};

	/** What one intent does to a window. */
	struct FIntentPlan
	{
		/** The camera blends to the workspace (the window manager performs it; the window only reports it). */
		bool bCameraCloseUp = false;
		bool bOpens = false;
		bool bMinimizes = false;
		/** The window leaves the workspace. */
		bool bDismisses = false;
		/** The VM ENDED look goes on. */
		bool bMarksVmEnded = false;
		/** The VM ENDED look is cleared (a fresh spawn is a fresh session). */
		bool bClearsVmEnded = false;
		EExitStyle Exit = EExitStyle::Fold;
		/** A chip unfolds back into its window (restore_unfold). */
		bool bRestores = false;
		/** The window manager blends the camera back to the world (camera_return). The window does nothing. */
		bool bCameraReturn = false;
		/** The window starts as a chip and never unfolds: a cap-queued (7th+) window. No animation, no camera. */
		bool bStartsAsChip = false;
		/** VmEnded: the panel leaves only after the veil is up and has been held (VmEndedLeaveDelay). */
		bool bLeavesAfterVeil = false;
	};

	/** FORGE's AnimationCue as it arrives: the intent string and, for vm_ended_anim, the endCause (or none). */
	struct FForgeCue
	{
		std::string Intent;
		bool bHasEndCause = false;
		std::string EndCause;
	};

	/** What a FORGE cue means for the window. An unknown intent is bKnown false and does nothing. */
	struct FCuePlan
	{
		bool bKnown = false;
		EVisualIntent Intent = EVisualIntent::SpawnInline;
		/** None for every intent but VmEnded: a close is never a cause. */
		EEndCause EndCause = EEndCause::None;
		FIntentPlan Plan;
	};

	/** FORGE's observerView, exactly its four fields. There is nowhere to put a frame, a URL, a page or an action. */
	struct FObserverViewInput
	{
		bool bHasOutlineColorToken = false;
		std::string OutlineColorToken;
		std::string OwnerName;
		bool bHasTitle = false;
		std::string Title;
		std::string Status;
	};

	/** What an observer's card draws: the four fields, made safe to draw. */
	struct FObserverLook
	{
		std::string OwnerName;
		std::string Title;
		bool bTitleShown = false;
		EWindowPhase Status = EWindowPhase::Unknown;
		std::string StatusLabel;
		/** The token read as a colour (#RRGGBB). False: the neutral grey, never the legacy #FFD400. */
		bool bOutlineResolved = false;
		FRgb Outline;
	};

	/** How the window's frame is drawn this frame: a scale about its centre and an opacity. */
	struct FFrameShape
	{
		float ScaleX = 1.0f;
		float ScaleY = 1.0f;
		float Opacity = 1.0f;
		/** No transform at all (fully open): the frame is drawn exactly as laid out. */
		bool bIdentity = true;
	};

	/** "Unnamed agent". */
	extern const char* const UnnamedAgent;
	/** " — Wonder Web VM" (with the leading space and EM DASH). */
	extern const char* const TitleJoin;
	/** "VM ENDED". */
	extern const char* const VmEndedBadge;
	/** "VM ended": the badge for no cause or an unknown one. */
	extern const char* const VmEndedNeutral;
	/** The longest observer title drawn, in UTF-8 bytes. */
	constexpr std::size_t MaxObserverTitleBytes = 160;
	/** An observer outline whose token is missing or unreadable (linear grey). */
	constexpr FRgb ObserverNeutralOutline{ 0.32f, 0.32f, 0.34f };
	/** The longest name shown, in UTF-8 bytes; cut on a code point boundary. */
	constexpr std::size_t MaxNameBytes = 64;

	/**
	 * A name fit to be drawn: invalid UTF-8 dropped; C0/C1 controls, DEL and line/paragraph separators read as spaces;
	 * zero-width characters, bidi embeddings/overrides/isolates and BOM removed; whitespace runs collapsed to one space;
	 * trimmed; cut to MaxBytes on a code point boundary (and trimmed again).
	 */
	std::string SanitizeName(const std::string& Utf8, std::size_t MaxBytes = MaxNameBytes);

	/** True when Name (already sanitised) is only a provider label or id -- the fixed list, or the given ProviderLabel. ASCII case-insensitive. */
	bool IsProviderLabel(const std::string& Name, const std::string& ProviderLabel);

	/** N as shown: the decimal number for 1..9999, otherwise empty (no number is better than a wrong one). */
	std::string FormatVmNumber(int VmNumber);

	/** "<Name> — Wonder Web VM <N>", or "<Name> — Wonder Web VM" when N is not shown. Name is used as given. */
	std::string MakeTitle(const std::string& Name, int VmNumber);

	/** The whole look for one window. Pure: the caller logs NameIssue. */
	FResolvedLook Resolve(const FIdentityInput& Input);

	/** The intent contract, as data. */
	FIntentPlan PlanFor(EVisualIntent Intent);

	/**
	 * The frame for a window that is Open (0 folded .. 1 open, already eased) and is either opening/open (bLeaving false)
	 * or leaving/folding (bLeaving true) in the given exit style. Opening always unfolds; Fold leaving is the legacy
	 * FScale2D(1, max(Open, 0.01)); Close leaving is a uniform shrink to 86% with a fade.
	 */
	FFrameShape ShapeFor(EExitStyle Exit, bool bLeaving, float Open);

	/** Seconds the leave takes: the fold's own time for Fold, the close's for Close. Both floored at 0.01 s. */
	float LeaveSecondsFor(EExitStyle Exit, float FoldSeconds, float CloseSeconds);

	/** The VM ENDED veil, 0..1, one step toward on (bEnded) or off over Seconds. */
	float StepVeil(float Current, bool bEnded, float DeltaSeconds, float Seconds);

	/** How much the glass dims under the veil at full strength (0 none .. 1 black). */
	constexpr float VeilDim = 0.55f;

	/** Which saved colour a companion terminal wears: its own if picked, else the shared one if picked, else the theme. */
	EAccentSource PickCompanionAccentSource(bool bPerTerminalChosen, bool bSharedChosen);

	/**
	 * The intent's FORGE contract name ("cinematic_closeup", "spawn_inline", "minimize_fold", "restore_unfold",
	 * "close_anim", "vm_ended_anim", "camera_return") and back. ParseIntent also reads this file's first names
	 * ("spawn_close_up", "minimize", "close", "vm_ended").
	 */
	const char* IntentName(EVisualIntent Intent);
	bool ParseIntent(const std::string& Name, EVisualIntent& OutIntent);

	/** BRIDGE's endCause: "" is None, the six names are themselves, anything else is Unknown. Never fails. */
	EEndCause ParseEndCause(const std::string& Name);
	/** The wire name of a cause; "" for None and Unknown. */
	const char* EndCauseName(EEndCause Cause);
	/** The short badge for a cause ("VM stopped by owner" ...); None and Unknown are "VM ended". */
	const char* EndCauseBadge(EEndCause Cause);
	/** A cause counts only for an ended or failed session; any other state has no cause. */
	EEndCause EffectiveEndCause(ESessionState State, EEndCause Cause);

	/** BRIDGE's sessionState: provisioning, running, paused, ended, failed; anything else Unknown. */
	ESessionState ParseSessionState(const std::string& Name);
	/** FORGE's admission: "queued_chip" is QueuedChip; anything else (and "shown") Shown. */
	EAdmission ParseAdmission(const std::string& Name);
	/** FORGE's phase string, and its label ("Opening", "Live", "Minimized", "Focused", "Closing", "Closed", "Unknown"). */
	EWindowPhase ParsePhase(const std::string& Name);
	const char* PhaseLabel(EWindowPhase Phase);

	/** FORGE's cue, read: the intent, and the end cause only when the intent is vm_ended_anim. */
	FCuePlan PlanForCue(const FForgeCue& Cue);
	/** What admission means before any cue: QueuedChip starts as a chip; Shown waits for its cue. */
	FIntentPlan PlanForAdmission(EAdmission Admission);
	/** Seconds from vm_ended_anim to the panel leaving: at once for a chip, else the veil's fade plus the hold. */
	float VmEndedLeaveDelay(bool bMinimized, float VeilSeconds, float HoldSeconds);

	/** "#RRGGBB" (either case) as a linear colour (sRGB decoded); false for anything else. */
	bool ParseColorToken(const std::string& Token, FRgb& OutColour);
	/** The observer card's look from FORGE's observerView. */
	FObserverLook ResolveObserver(const FObserverViewInput& View);
}

#if !defined(WL_WINDOWLOOK_STANDALONE)
// ===================================================================================================== the Unreal half

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Styling/SlateBrush.h"
#include "Templates/Function.h"

/** The look a window panel and its actor are drawn with. Unset (the default) is the Wonder Web exactly as it was. */
struct FWonderWebWindowLook
{
	bool bSet = false;
	FString Title;
	FString Metadata;
	bool bHasOutline = false;
	FLinearColor Outline = FLinearColor::Transparent;
	bool bVmEnded = false;
	bool bNameMissing = false;
	/** Why the VM ended (None unless bVmEnded), and the badge it draws. */
	WonderlandWonderWebWindowLook::EEndCause EndCause = WonderlandWonderWebWindowLook::EEndCause::None;

	FLinearColor OutlineOr(const FLinearColor& Fallback) const { return bHasOutline ? Outline : Fallback; }
};

/** Which kind of terminal a VM window belongs under. */
enum class EWonderWebParentKind : uint8
{
	/** One of the AI companion terminals, by index. */
	CompanionTerminal,
	/** The Julius Live Terminal (a Julius working card's VM). */
	Julius,
};

/** The window manager's description of one VM window, as Unreal types. */
struct FWonderWebWindowIdentity
{
	FString AgentDisplayName;
	int32 VmNumber = 0;
	FString ParentTerminalName;
	bool bHasParentAccent = false;
	FLinearColor ParentAccent = FLinearColor::Transparent;
	WonderlandWonderWebWindowLook::ESessionState State = WonderlandWonderWebWindowLook::ESessionState::Unknown;
	/** Used only to refuse it as a name. Never shown, never logged. */
	FString ProviderLabel;
	/** The stable internal session id: what a missing name is logged against. Opaque; never a credential. */
	FString VmSessionId;
	/** BRIDGE's endCause, read with ParseEndCause; counts only when State is Ended or Failed. */
	WonderlandWonderWebWindowLook::EEndCause EndCause = WonderlandWonderWebWindowLook::EEndCause::None;
};

/** FORGE's observerView as Unreal types: exactly its four fields. */
struct FWonderWebObserverView
{
	TOptional<FString> OutlineColorToken;
	FString OwnerName;
	TOptional<FString> Title;
	FString Status;
};

/** What an observer's card draws. */
struct FWonderWebObserverLook
{
	FString OwnerName;
	FString Title;
	bool bTitleShown = false;
	FString StatusLabel;
	bool bOutlineResolved = false;
	FLinearColor Outline = FLinearColor::Transparent;
};

namespace WonderlandWonderWebWindowLook
{
	/** The whole look, as Unreal types. A missing or provider-only name is logged once per session id (LogWonderlandWonderWebLook). */
	WONDERLAND_API FWonderWebWindowLook ResolveLook(const FWonderWebWindowIdentity& Identity);

	/** The parent terminal's outline: the Julius Live Terminal's accent, or companion terminal Index's own colour. */
	WONDERLAND_API FLinearColor ParentTerminalOutline(EWonderWebParentKind Kind, int32 TerminalIndex);

	/**
	 * The title block a Wonder Web window's title bar shows: the title and, under it, the parent's name. With an unset
	 * look it is the plain WONDER WEB lettering it always was. GetLook is read every paint, so a new look shows at once.
	 */
	WONDERLAND_API TSharedRef<SWidget> MakeTitleBlock(TFunction<const FWonderWebWindowLook*()> GetLook);

	/** The badge text for a look: its end cause's label, upper-cased like the badge always was. */
	WONDERLAND_API FText VmEndedBadgeText(WonderlandWonderWebWindowLook::EEndCause Cause);

	/** The observer card's look from FORGE's observerView. */
	WONDERLAND_API FWonderWebObserverLook ResolveObserverLook(const FWonderWebObserverView& View);
}

/**
 * WHAT ANOTHER USER SEES OF A VM WINDOW: FORGE's observerView and nothing else -- an outline in the owner terminal's colour
 * token, the owner's name, the title and the status. It has no content slot and no frame, URL, page or action.
 */
class WONDERLAND_API SWonderWebObserverCard : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderWebObserverCard) {}
		SLATE_ARGUMENT(FWonderWebObserverView, View)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);
	/** A new observerView; the card redraws its four fields. */
	void SetView(const FWonderWebObserverView& InView);
	const FWonderWebObserverLook& GetLook() const { return Look; }

private:
	FWonderWebObserverLook Look;
	FSlateBrush CardBrush;
};

/**
 * THE VM ENDED VEIL: the glass dimmed and one badge, over a window whose VM really ended. It takes no input; the window
 * under it can still be read, moved and closed.
 */
class WONDERLAND_API SWonderWebVmEndedVeil : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderWebVmEndedVeil)
		: _Shown(0.0f)
		, _Accent(FLinearColor(FColor(0xFF, 0xD4, 0x00)))
		, _Label(FText::FromString(TEXT("VM ENDED")))
	{}
		/** 0 hidden .. 1 fully on. */
		SLATE_ATTRIBUTE(float, Shown)
		/** The badge's line colour: the window's outline. */
		SLATE_ATTRIBUTE(FLinearColor, Accent)
		/** The badge's words: the end cause's label (VmEndedBadgeText). */
		SLATE_ATTRIBUTE(FText, Label)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	TAttribute<float> Shown;
	TAttribute<FLinearColor> Accent;
	TAttribute<FText> Label;
	FSlateBrush BadgeBrush;
	FSlateBrush BadgeInnerBrush;
};
#endif

// WONDERLAND SOCIAL — LFF, the "Looking For Feed": the Social Hub's sixth tab (the private-Alpha launch gate, founder 2026-10-12).
//
// A player posts what they are looking for (a team, builders, AI engineers, designers, competitors, collaborators); others browse the
// feed and ask to join; the owner accepts or declines. Contract: _qa_handoff/lff/LFF_ALPHA_CONTRACT_r1_20261012.md with its amendment
// r2/r2.1 (the feed lists OPEN posts only; a post whose author the viewer may not see is absent; a request a block crossed vanishes).
//
// TWO PIECES, so that what a player types survives the hub's refreshes (the dependency audit's risk 5, F-21: every live snapshot rebuilds
// the hub, every 2 s while anything happens):
//   - FWonderlandLffModel holds everything LFF knows and every draft -- the feed, the open post, the player's own posts and requests, the
//     create and edit forms, the request note, the filters -- OUTSIDE any widget tree. The social subsystem owns it for the session and
//     drops it when the service changes (a sign-out never leaves one player's feed or drafts for the next).
//   - SWonderlandSocialLffView draws it. Its text boxes are its own, built once and re-slotted on every rebuild, so a rebuild never empties
//     one; the box that had the keyboard focus gets it back with its caret where it was (IsCaretMovedWhenGainFocus is off: Slate's default
//     would jump the caret to the end on that refocus -- the r1 review's M1; wl.Qa.SocialLffScreen CR1/CR2, CRC the control). To Slate the
//     refocus is still a focus change, so a SELECTION is cleared and an IME composition in progress ends at a view rebuild (the hub's own
//     2-s refresh does not rebuild the view). A NEW view (the hub opened again) fills its boxes from the model's drafts.
//
// It decides nothing (WonderlandSocialTypes.h): the server filters the feed, owns every rule, and answers a post the viewer may not see
// as missing. LFF GRANTS NOTHING: after an accept, the two people connect through the EXISTING Add Friend / Message / Invite actions, each
// with its own checks. The preview has no LFF people and no posts: it says LFF needs a live connection. No post text is ever logged.
#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Styling/SlateBrush.h"
#include "Styling/SlateTypes.h"
#include "Widgets/SCompoundWidget.h"
#include "WonderlandSocialProfilePanel.h"
#include "WonderlandSocialService.h"
#include "WonderlandSocialTypes.h"

class SBorder;
class SEditableTextBox;

/** Which part of the LFF tab is showing. */
enum class EWonderlandLffPane : uint8 { Feed, MyPosts, MyRequests, Form };
/** Where one list stands: never asked, asked and waiting, answered, or refused. */
enum class EWonderlandLffLoad : uint8 { Idle, Loading, Loaded, Failed };
/** The lasting actions that wait for a second, explicit press (CONFIRM): the owner's close and delete, an accepted player's leave. */
enum class EWonderlandLffConfirm : uint8 { None, Close, Delete, Leave };
/** The text a player types on the LFF tab (the view's own boxes; their drafts live in the model). */
enum class EWonderlandLffField : uint8 { ProjectFilter, SkillFilter, Title, Description, Project, Skills, Note };
/** Why an answer failed, as a person is told it. */
enum class EWonderlandLffProblem : uint8 { None, NeedsLive, RefusedHere, Unreachable, SignedOut, Permission, NotFound, Validation, Conflict, RateLimited, Unavailable, Other };
/**
 * The server's budget a call is charged to (wonderland-social-routes.ts budgetClassesOf): every read; post (create and edit); invitation
 * (a request to join); every other write. A 429 holds only calls of the kind it answered (the r1 review's m3): a refused create never
 * stops REFRESH, a pane switch or a withdraw.
 */
enum class EWonderlandLffBudget : uint8 { Read, Write, Post, Invitation, Count };

/** The create/edit form as the player is typing it. */
struct FWonderlandLffDraft
{
	/** Empty for a new post; the post's id while editing it. */
	FString EditingPostId;
	/** One of the six, or empty until the player picks one. */
	FString Category;
	FString Title;
	FString Description;
	FString ProjectLabel;
	/** As typed: comma-separated ("Unreal, Level design"). */
	FString Skills;
	int32 OpenSlots = 1;
};

/** LFF's client-side checks and words: what a person is told BEFORE anything is sent. The server holds every rule again. */
namespace WonderlandLff
{
	// The bounds (social-lff.ts, in CODE POINTS as PostgreSQL's char_length counts them). The server holds every one again.
	constexpr int32 TitleMax = 80;
	constexpr int32 DescriptionMax = 1000;
	constexpr int32 ProjectMax = 80;
	constexpr int32 SkillsMax = 8;
	constexpr int32 SkillMax = 32;
	constexpr int32 SlotsMin = 1;
	constexpr int32 SlotsMax = 20;
	constexpr int32 MessageMax = 200;
	/** A feed page as asked for (LFF_FEED_PAGE_MAX). */
	constexpr int32 PageLimit = 50;

	/** Code points, a surrogate pair counted once (an emoji is one character, as the server counts it). */
	int32 CodePoints(const FString& Text);
	/** C0, DEL, C1 (U+0080-U+009F), U+2028 and U+2029: what the server refuses in every LFF field (displayText + C1). */
	bool HasControlCharacter(const FString& Text);
	/** Half of a surrogate pair standing alone: no text at all (the server refuses it). */
	bool HasLoneSurrogate(const FString& Text);
	/** Skills as typed -> items: split on commas, trimmed, empties dropped. */
	TArray<FString> SplitSkills(const FString& Typed);
	/** The form -> the fields to send, trimmed; false with the reason a person can read (the server checks all of it again). */
	bool ValidateDraft(const FWonderlandLffDraft& Draft, FWonderlandLffPostFields& OutFields, FString& OutWhy);
	/** The optional note to the owner (0-200, no control character) -> trimmed; false with why. */
	bool ValidateNote(const FString& Typed, FString& OutNote, FString& OutWhy);
	EWonderlandLffProblem ProblemOf(const FWonderlandLffAnswer& Answer);
	/** What a person is told about a refused answer (a 429 with its Retry-After; a 409 in the server's own sentence). */
	FString ProblemLine(const FWonderlandLffAnswer& Answer);
	/** A requester's own word for their request: PENDING, ACCEPTED, DECLINED, NO LONGER AVAILABLE. */
	FString RequesterWord(const FString& Status);
}

/**
 * EVERYTHING THE LFF TAB KNOWS, outside the widgets (see the top of this file). Asks the CURRENT social service each time (sign-in and
 * sign-out replace it); every answer is checked against the model's generation and its list's sequence, so an answer for a reset model or
 * an older read is dropped. Changes are broadcast; the view redraws at Slate's next pre-tick.
 */
class WONDERLAND_API FWonderlandLffModel : public TSharedFromThis<FWonderlandLffModel>
{
public:
	explicit FWonderlandLffModel(TFunction<IWonderlandSocialService*()> InServiceOf);

	/** The service changed (a sign-in, a sign-out, a preview): what one player saw or typed is dropped; answers on the way are ignored. */
	void Reset();
	/**
	 * The server told this viewer of an LFF change (an lff.* event, a block, a reset): read again now if on screen, else when next shown.
	 * A feed showing more than its first page is NOT folded back to page 1 (the r1 review's m10): it says there is new activity instead.
	 */
	void HandleServerChange();
	/** A view drew the LFF tab: the first time, or after a change it was told of while hidden, the showing lists are read. */
	void NoteOnScreen(double NowSeconds);
	bool IsOnScreen(double NowSeconds) const { return LastOnScreen > 0.0 && NowSeconds - LastOnScreen < 1.0; }

	// ---- panes and lists
	EWonderlandLffPane GetPane() const { return Data.Pane; }
	/** Show a pane (FEED, MY POSTS, MY REQUESTS); its list is read again. */
	void SetPane(EWonderlandLffPane Pane);
	/** REFRESH / RETRY: the showing pane's list and the open post, read again. */
	void Reload();
	const FString& GetCategory() const { return Data.Category; }
	/** A category, or empty for all: the feed is read again from its first page. */
	void SetCategory(const FString& Category);
	/** APPLY: the typed project and skill filters go to the server (percent-encoded) and the feed is read again from its first page. */
	bool ApplyFilters();
	void ClearFilters();
	/** The filters the feed on screen was read with. */
	bool HasAppliedFilters() const { return !Data.AppliedProject.IsEmpty() || !Data.AppliedSkill.IsEmpty(); }
	const TArray<FWonderlandLffPost>& GetFeed() const { return Data.Feed; }
	bool CanLoadMore() const { return !Data.FeedCursor.IsEmpty() && Data.FeedLoad != EWonderlandLffLoad::Loading; }
	/** LOAD MORE: the next page, with the same category and filters. */
	void LoadMore();
	/** An LFF change arrived while more than one feed page was shown: REFRESH reads it (the pages are not folded under the player). */
	bool HasFeedNews() const { return Data.bFeedNews; }
	const TArray<FWonderlandLffPost>& GetMyPosts() const { return Data.MyPosts; }
	bool CanLoadMoreMine() const { return !Data.MineCursor.IsEmpty() && Data.MineLoad != EWonderlandLffLoad::Loading; }
	/** LOAD MORE on MY POSTS: a player's CLOSED and EXPIRED posts stay until they delete them, so their list pages too (m9). */
	void LoadMoreMine();
	/** MY POSTS' "open only" filter: the server's hasOpenSlots (the general feed is OPEN-only already). */
	bool IsMineOpenOnly() const { return Data.bMineOpenOnly; }
	void SetMineOpenOnly(bool bOpenOnly);
	const TArray<FWonderlandLffMyRequest>& GetMyRequests() const { return Data.MyRequests; }
	/**
	 * Requests this viewer knew that the server no longer lists (their post deleted, or out of their sight): their ids ONLY. A tombstone
	 * keeps no title (the security review's m1): what the server withdrew is not kept on screen. An id the server lists again (after an
	 * unblock) leaves this list: its live row replaces the tombstone.
	 */
	const TArray<FString>& GetVanished() const { return Data.Vanished; }
	void DismissVanished(const FString& RequestId);
	EWonderlandLffLoad GetLoad(EWonderlandLffPane Pane) const;
	/** The line a pane's list shows instead of (or above) its rows: loading, empty, refused, new activity. Empty when its rows say it all. */
	FString PaneLine(EWonderlandLffPane Pane) const;

	// ---- the open post
	/** Show this post on the right: its detail, and the owner's inbox when it is the viewer's own. */
	void OpenPost(const FString& PostId);
	const FString& GetOpenPostId() const { return Data.OpenPostId; }
	/** True when the detail on hand is the open post's. */
	bool HasDetail() const { return !Data.OpenPostId.IsEmpty() && Data.Detail.Post.PostId == Data.OpenPostId; }
	const FWonderlandLffPostDetail& GetDetail() const { return Data.Detail; }
	FString DetailLine() const;
	const FWonderlandLffPostRequests& GetInbox() const { return Data.Inbox; }
	FString InboxLine() const;

	// ---- the forms (drafts: kept here, never in a widget). A new post's draft and an edit's are kept apart (m8).
	/** CREATE POST: the new post's draft, as it was left. An edit in progress is kept for its own EDIT. */
	void StartCreate();
	/** EDIT: the open post (the viewer's own, OPEN) into the form -- resuming an edit of the same post already in progress. */
	bool StartEdit();
	/** CANCEL: the showing draft is discarded. */
	void CancelForm();
	/** CREATE POST / SAVE CHANGES: checked here first (nothing is sent when it fails), then sent. */
	bool SubmitForm();
	/** The draft the form shows (the edit's while editing, else the new post's). */
	const FWonderlandLffDraft& GetDraft() const { return Data.bEditingForm ? Data.EditDraft : Data.Draft; }
	bool IsEditingForm() const { return Data.bEditingForm; }
	void SetDraftCategory(const FString& Category);
	void AdjustSlots(int32 Delta);
	const FString& GetFormProblem() const { return Data.FormProblem; }
	/** A text field as the player types it. Nothing is broadcast (a keystroke never rebuilds anything). */
	void SetFieldText(EWonderlandLffField Field, const FString& Text);
	FString GetFieldText(EWonderlandLffField Field) const;
	/** Bumped whenever the model REPLACES what a field holds (a new form, an edit, a sent note, a reset): the view then pushes it. */
	int32 GetTextRevision() const { return TextRevision; }

	// ---- requests and the owner's actions
	/** REQUEST TO JOIN (or, after a decline, REQUEST AGAIN: the server allows it under its own rules) the open post, with the note. */
	bool RequestToJoin();
	void Withdraw(const FString& RequestId);
	void Accept(const FString& RequestId);
	void Decline(const FString& RequestId);
	/** Ask for the second press: CLOSE / DELETE act on the open post (the owner's); LEAVE on the request named (an accepted one). */
	void AskConfirm(EWonderlandLffConfirm What, const FString& RequestId = FString());
	void CancelConfirm();
	void ConfirmPending();
	EWonderlandLffConfirm GetConfirm() const { return Data.Confirm; }
	/** What the confirm acts on: the post's id (close, delete) or the request's (leave). */
	const FString& GetConfirmSubject() const { return Data.ConfirmSubject; }
	/** REPORT: the open post through the existing report flow (reports.file, the post as its subject). */
	void ReportOpenPost();
	/** PROFILE on a person the snapshot does not carry (a requester): the existing profile.read; OnCard runs only with a readable card. */
	void ReadProfile(const FString& UserId, TFunction<void(const FWonderlandSocialProfileView&)> OnCard);

	// ---- what is said
	const FString& GetActionLine() const { return Data.ActionLine; }
	bool IsWriting() const { return Data.bWriting; }
	/** The service cannot reach LFF (the DEVELOPMENT PREVIEW): the tab says so and lists nobody. */
	bool NeedsLive() const { return Data.bNeedsLive; }
	/** A call of this kind may be asked now: a service, and no 429 of this kind still waiting. */
	bool MayAsk(EWonderlandLffBudget Kind) const;
	/** Seconds left of a 429's Retry-After for this kind of call; 0 when nothing waits. */
	int32 RetryAfterLeft(EWonderlandLffBudget Kind) const;
	/** For QA and the log: ids, counts and states ONLY -- never a title, a description, a label, a skill, a filter or a note. */
	FString Describe() const;

	FSimpleMulticastDelegate& OnChanged() { return Changed; }

private:
	IWonderlandSocialService* Service() const { return ServiceOf ? ServiceOf() : nullptr; }
	FString HeldLine(EWonderlandLffBudget Kind) const;
	void ReadFeed(bool bMore);
	void ReadMine(bool bMore);
	void ReadRequests();
	void ReadDetail(const FString& PostId);
	void ReadInbox(const FString& PostId);
	/** Every answer passes here: a preview's "needs live", a 429's wait for its own kind of call. */
	void NoteAnswer(const FWonderlandLffAnswer& Answer, EWonderlandLffBudget Kind);
	/** A post this viewer can no longer see (a 404): gone from every list, the detail says so. */
	void ForgetPost(const FString& PostId);
	void SendWithdraw(const FString& RequestId, const FString& OkLine);
	/** One write at a time: Send asks the service; OnOk runs on success with the created id; OkLine is said. */
	void Write(EWonderlandLffBudget Kind, TFunction<void(IWonderlandSocialService&, FWonderlandLffWriteDone)> Send, const FString& OkLine,
		TFunction<void(FWonderlandLffModel&, const FString&)> OnOk);
	FWonderlandLffDraft& ActiveDraft() { return Data.bEditingForm ? Data.EditDraft : Data.Draft; }

	struct FData
	{
		EWonderlandLffPane Pane = EWonderlandLffPane::Feed;
		EWonderlandLffPane PaneBeforeForm = EWonderlandLffPane::Feed;
		// the feed, filtered by the server: what is typed, and what the feed on screen was read with
		FString Category;
		FString ProjectFilter;
		FString SkillFilter;
		FString AppliedProject;
		FString AppliedSkill;
		EWonderlandLffLoad FeedLoad = EWonderlandLffLoad::Idle;
		FWonderlandLffAnswer FeedAnswer;
		TArray<FWonderlandLffPost> Feed;
		FString FeedCursor;
		int32 FeedSeq = 0;
		/** Pages on screen (1 after a first page; LOAD MORE adds one). */
		int32 FeedPages = 0;
		bool bFeedNews = false;
		// the viewer's own posts (CLOSED and EXPIRED included, unless "open only")
		EWonderlandLffLoad MineLoad = EWonderlandLffLoad::Idle;
		FWonderlandLffAnswer MineAnswer;
		TArray<FWonderlandLffPost> MyPosts;
		FString MineCursor;
		int32 MineSeq = 0;
		bool bMineOpenOnly = false;
		// the viewer's own requests, and the ids of those it knew that are gone
		EWonderlandLffLoad RequestsLoad = EWonderlandLffLoad::Idle;
		FWonderlandLffAnswer RequestsAnswer;
		TArray<FWonderlandLffMyRequest> MyRequests;
		bool bRequestsTruncated = false;
		TSet<FString> KnownRequests;
		TArray<FString> Vanished;
		int32 RequestsSeq = 0;
		// the open post, and its owner's inbox
		FString OpenPostId;
		EWonderlandLffLoad DetailLoad = EWonderlandLffLoad::Idle;
		FWonderlandLffAnswer DetailAnswer;
		FWonderlandLffPostDetail Detail;
		int32 DetailSeq = 0;
		EWonderlandLffLoad InboxLoad = EWonderlandLffLoad::Idle;
		FWonderlandLffAnswer InboxAnswer;
		FWonderlandLffPostRequests Inbox;
		int32 InboxSeq = 0;
		FString Note;
		EWonderlandLffConfirm Confirm = EWonderlandLffConfirm::None;
		FString ConfirmSubject;
		// the forms: a new post's draft and an edit's, kept apart
		FWonderlandLffDraft Draft;
		FWonderlandLffDraft EditDraft;
		bool bEditingForm = false;
		FString FormProblem;
		// what is said
		FString ActionLine;
		bool bWriting = false;
		bool bNeedsLive = false;
		/** A change the viewer was told of while the tab was hidden (or nothing read yet): read when next shown. */
		bool bStale = true;
		/** Each kind's 429 wait, in FPlatformTime seconds (EWonderlandLffBudget order). */
		double NotBefore[static_cast<int32>(EWonderlandLffBudget::Count)] = {0.0, 0.0, 0.0, 0.0};
	};

	TFunction<IWonderlandSocialService*()> ServiceOf;
	FData Data;
	/** Bumped by Reset: an answer asked before it is dropped. */
	int32 Generation = 0;
	int32 TextRevision = 0;
	double LastOnScreen = 0.0;
	FSimpleMulticastDelegate Changed;
};

/** A profile card to open (the LFF answer carries the author's; profile.read a requester's): through the existing profile panel. */
DECLARE_DELEGATE_OneParam(FOnWonderlandLffOpenProfileView, const FWonderlandSocialProfileView& /*View*/);

/** The LFF tab's body: FEED / MY POSTS / MY REQUESTS beside the open post, and the create/edit form. */
class WONDERLAND_API SWonderlandSocialLffView : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandSocialLffView) : _bDevelopmentPreview(false) {}
		SLATE_ARGUMENT(TSharedPtr<FWonderlandLffModel>, Model)
		/** The signed-in player (their own rows offer no connect actions). */
		SLATE_ARGUMENT(FString, ViewerId)
		SLATE_ARGUMENT(bool, bDevelopmentPreview)
		/** ADD FRIEND / MESSAGE / INVITE / BLOCK: the EXISTING social actions, by their own operation ids (the hub's OnAction). */
		SLATE_EVENT(FOnWonderlandSocialAction, OnAction)
		/** PROFILE: a card (the author's, or a requester's read by profile.read), through the existing profile panel. */
		SLATE_EVENT(FOnWonderlandLffOpenProfileView, OnOpenProfileView)
	SLATE_END_ARGS()

	SWonderlandSocialLffView();
	virtual ~SWonderlandSocialLffView();
	void Construct(const FArguments& InArgs);
	/** On screen: the model learns it is shown (its first read, or a change it missed). */
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

	/** The hub's view changed (a live refresh): who the viewer is, whether this is a preview. Redraws only if either changed. */
	void SetContext(const FString& InViewerId, bool bInDevelopmentPreview);
	/** F-21: run a rebuild a change asked for, now (QA; Slate's pre-tick runs it otherwise). */
	void FlushRebuild();
	bool QaRebuildPending() const { return bRebuildPending; }
	/** QA: a field's box as it stands (empty when the box is not built), and typing into it as a player would. */
	FString QaFieldText(EWonderlandLffField Field) const;
	bool QaTypeInto(EWonderlandLffField Field, const FString& Typed);
	/** QA: the box itself (to type into it through the widget, move its caret, give it focus). */
	TSharedPtr<SEditableTextBox> QaBox(EWonderlandLffField Field) const { return BoxOf(Field); }
	/** QA: the box is in the layout this view shows NOW -- placed by the last build AND its parent chain reaches this view. */
	bool QaIsPlaced(EWonderlandLffField Field) const;
	/** QA: what the last build drew -- the needs-live body, and how many post cards. */
	bool QaBuiltNeedsLive() const { return bBuiltNeedsLive; }
	int32 QaBuiltPostCards() const { return BuiltPostCards; }
	/** QA: the lines this view draws now (the pane's, the detail's, the action line), joined. Never logged by the view itself. */
	FString QaLines() const;
	/** QA: the label of the ask-to-join button the last build drew ("REQUEST TO JOIN", "REQUEST AGAIN"), empty when it drew none. */
	const FString& QaBuiltAskLabel() const { return BuiltAskLabel; }
	/** QA: PROFILE on a requester, as its button does; whether a card is waiting for the next pre-tick; that pre-tick, run now. */
	void QaOpenProfileOf(const FString& UserId) { OpenProfileOf(UserId); }
	bool QaProfileOpenPending() const { return bProfileOpenPending; }
	void QaRunPreTick() { HandleSlatePreTick(0.0f); }
	/**
	 * QA: as Tick would leave the view -- drawn ONE frame ago (true: the hub on screen; Slate's pre-tick runs before the frame's paint, so an
	 * on-screen view always reads exactly 1 there) or TWO frames ago (false: the hub closed; the nearest distance that must drop). uint64
	 * arithmetic is modular, so both distances hold at any engine frame, frame 0 included (a product guard "GFrameCounter >= LastDrawnFrame"
	 * would make the frame-0 open check FAIL: loudly, and for this reason).
	 */
	void QaNoteDrawn(bool bOnScreen)
	{
		bEverDrawn = true;
		LastDrawnFrame = GFrameCounter - (bOnScreen ? uint64(1) : uint64(2));
	}
	/** QA: as if Tick never ran (only at frames 0-1 does this differ from "drawn last frame": the bEverDrawn arm). */
	void QaNoteNeverDrawn() { bEverDrawn = false; LastDrawnFrame = 0; }

private:
	void Rebuild();
	void RequestRebuild() { bRebuildPending = true; }
	void HandleSlatePreTick(float DeltaTime);
	/** The box for a field (built once, in Construct). */
	TSharedPtr<SEditableTextBox> BoxOf(EWonderlandLffField Field) const;
	/** Push the model's text into the boxes when the model replaced it (GetTextRevision moved); otherwise the boxes are left alone. */
	void SyncBoxes();
	/** A field's box, placed into the layout being built (once per build: a widget has one parent). */
	TSharedRef<SWidget> PlaceBox(EWonderlandLffField Field);
	/**
	 * PROFILE on a requester: their card by profile.read, then the existing profile panel (only while this view lives). F-21: the card
	 * arrives in an HTTP answer, which lands after the frame's paint, so it is only KEPT there; the panel opens at Slate's next pre-tick
	 * (HandleSlatePreTick), with the view's rebuilds -- never from the answer itself.
	 */
	void OpenProfileOf(const FString& UserId);
	TSharedRef<SWidget> MakeContent();
	TSharedRef<SWidget> MakeHeader();
	TSharedRef<SWidget> MakeNeedsLive();
	TSharedRef<SWidget> MakeFeedList();
	TSharedRef<SWidget> MakeMyPostsList();
	TSharedRef<SWidget> MakeMyRequestsList();
	TSharedRef<SWidget> MakeDetail();
	TSharedRef<SWidget> MakeOwnerSection(const FWonderlandLffPost& Post);
	TSharedRef<SWidget> MakeViewerSection(const FWonderlandLffPostDetail& Detail);
	TSharedRef<SWidget> MakeAskToJoin(const FString& Label);
	TSharedRef<SWidget> MakeConfirmRow(const FString& Question, const FString& ConfirmLabel);
	TSharedRef<SWidget> MakeForm();
	TSharedRef<SWidget> MakePostCard(const FWonderlandLffPost& Post);
	TSharedRef<SWidget> MakePerson(const FWonderlandSocialPersonRow& Person, const FString& Second, const TSharedRef<SWidget>& Actions);
	/** ADD FRIEND / MESSAGE / INVITE for one person, each as the authority allowed it (Can), through the existing actions. */
	TSharedRef<SWidget> MakeConnectActions(const FWonderlandSocialPersonRow& Person);
	TSharedRef<SWidget> MakeSplit(const TSharedRef<SWidget>& List);
	TSharedRef<SWidget> MakeTitle(const FString& Title);
	TSharedRef<SWidget> MakeLine(const FString& Line, bool bWarn = false);
	TSharedRef<SWidget> MakeButton(const FString& Label, bool bAllowed, bool bQuiet, TFunction<void()> OnClick);
	TSharedRef<SWidget> MakeFieldLabel(const FString& Label, EWonderlandLffField Field, int32 Max);

	TSharedPtr<FWonderlandLffModel> Model;
	FString ViewerId;
	bool bDevelopmentPreview = false;
	FOnWonderlandSocialAction OnAction;
	FOnWonderlandLffOpenProfileView OnOpenProfileView;
	FDelegateHandle ModelChangedHandle;
	FDelegateHandle SlatePreTickHandle;
	bool bRebuildPending = false;
	int32 SeenTextRevision = -1;
	bool bBuiltNeedsLive = false;
	int32 BuiltPostCards = 0;
	FString BuiltAskLabel;
	/** A requester's card that profile.read answered, waiting for the next pre-tick to open (F-21). */
	bool bProfileOpenPending = false;
	FWonderlandSocialProfileView PendingProfileCard;
	/** The engine frame this view was last drawn (Tick): a queued card opens only while the view is on screen (r3 review m-r3-1). */
	uint64 LastDrawnFrame = 0;
	/**
	 * Whether Tick ever ran. Frame 0 is NOT "never drawn": GFrameCounter stays 0 through the engine's whole first frame (LaunchEngineLoop
	 * increments it at the frame's end, after the deferred commands a -ExecCmds run executes), so a view drawn then has LastDrawnFrame 0.
	 * Testing "LastDrawnFrame > 0" dropped such a view's card as if it had never been on screen (the in-engine LH9 FAIL, 2026-10-12).
	 */
	bool bEverDrawn = false;

	TSharedPtr<SBorder> ContentHost;
	/** The text boxes, built ONCE: every rebuild re-slots these same widgets (what is typed, the caret and the focus stay; a selection does not). */
	TSharedPtr<SEditableTextBox> ProjectFilterBox;
	TSharedPtr<SEditableTextBox> SkillFilterBox;
	TSharedPtr<SEditableTextBox> TitleBox;
	TSharedPtr<SEditableTextBox> DescriptionBox;
	TSharedPtr<SEditableTextBox> ProjectBox;
	TSharedPtr<SEditableTextBox> SkillsBox;
	TSharedPtr<SEditableTextBox> NoteBox;
	/** The boxes the build in progress placed (the focus goes back only to a box that is on screen). */
	TArray<TSharedPtr<SEditableTextBox>> PlacedBoxes;

	// Built once, as the hub's are.
	FSlateRoundedBoxBrush RowBrush;
	FSlateRoundedBoxBrush RowSelectedBrush;
	FSlateRoundedBoxBrush PaneBrush;
	FSlateRoundedBoxBrush PillBrush;
	FSlateRoundedBoxBrush ButtonNormal;
	FSlateRoundedBoxBrush ButtonHovered;
	FSlateRoundedBoxBrush ButtonDisabled;
	FSlateBrush NoBrush;
	FButtonStyle ButtonStyle;
	FButtonStyle QuietStyle;
};

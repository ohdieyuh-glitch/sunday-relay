#include "WonderlandSocialLffView.h"

#include "Framework/Application/SlateApplication.h"
#include "CoreGlobals.h"   // GFrameCounter: a queued profile opens only while the view was drawn in the previous frame
#include "HAL/PlatformTime.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SWrapBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandSocialHubPanel.h"   // the hub's own words for presence and time (WonderlandSocialHubLook), so both say them alike
#include "WonderlandUiStyle.h"
#include "WonderlandSocialLive.h"   // B35: WonderlandSocialFreshness::EventStamp for the LFF read lines

/* ================================================================================================ the checks and the words */

int32 WonderlandLff::CodePoints(const FString& Text)
{
	int32 Count = 0;
	for (int32 Index = 0; Index < Text.Len(); ++Index)
	{
		const uint32 Code = static_cast<uint32>(Text[Index]);
		if (Code >= 0xD800 && Code <= 0xDBFF && Index + 1 < Text.Len())
		{
			const uint32 Next = static_cast<uint32>(Text[Index + 1]);
			if (Next >= 0xDC00 && Next <= 0xDFFF)
			{
				++Index;   // a pair is one character, as the server's Array.from counts it
			}
		}
		++Count;
	}
	return Count;
}

bool WonderlandLff::HasControlCharacter(const FString& Text)
{
	// THE SERVER'S RULE (social-commands.ts lffText: displayText + C1), judged on the text AS TYPED: a line break forges a log line
	for (const TCHAR Character : Text)
	{
		const uint32 Code = static_cast<uint32>(Character);
		if (Code < 0x20 || Code == 0x7F || (Code >= 0x80 && Code <= 0x9F) || Code == 0x2028 || Code == 0x2029)
		{
			return true;
		}
	}
	return false;
}

bool WonderlandLff::HasLoneSurrogate(const FString& Text)
{
	for (int32 Index = 0; Index < Text.Len(); ++Index)
	{
		const uint32 Code = static_cast<uint32>(Text[Index]);
		if (Code >= 0xDC00 && Code <= 0xDFFF)
		{
			return true;
		}
		if (Code >= 0xD800 && Code <= 0xDBFF)
		{
			const uint32 Next = Index + 1 < Text.Len() ? static_cast<uint32>(Text[Index + 1]) : 0;
			if (Next < 0xDC00 || Next > 0xDFFF)
			{
				return true;
			}
			++Index;
		}
	}
	return false;
}

TArray<FString> WonderlandLff::SplitSkills(const FString& Typed)
{
	TArray<FString> Parts;
	Typed.ParseIntoArray(Parts, TEXT(","), true);
	TArray<FString> Skills;
	for (const FString& Part : Parts)
	{
		const FString Skill = Part.TrimStartAndEnd();
		if (!Skill.IsEmpty())
		{
			Skills.Add(Skill);
		}
	}
	return Skills;
}

bool WonderlandLff::ValidateDraft(const FWonderlandLffDraft& Draft, FWonderlandLffPostFields& OutFields, FString& OutWhy)
{
	if (!WonderlandLffIsCategory(Draft.Category))
	{
		OutWhy = TEXT("Choose a category.");
		return false;
	}
	// CONTROL CHARACTERS ARE REFUSED, NEVER STRIPPED: what is sent is exactly what the player sees, and the server refuses the same
	struct FLffTextCheck
	{
		const TCHAR* Name;
		const FString* Value;
	};
	const FLffTextCheck Checks[] = {
		{TEXT("The title"), &Draft.Title}, {TEXT("The description"), &Draft.Description}, {TEXT("The project or activity"), &Draft.ProjectLabel},
		{TEXT("The skills"), &Draft.Skills}};
	for (const FLffTextCheck& Check : Checks)
	{
		if (HasControlCharacter(*Check.Value))
		{
			OutWhy = FString::Printf(TEXT("%s must not contain a control character or a line break."), Check.Name);
			return false;
		}
		if (HasLoneSurrogate(*Check.Value))
		{
			OutWhy = FString::Printf(TEXT("%s is not valid text."), Check.Name);
			return false;
		}
	}
	const FString Title = Draft.Title.TrimStartAndEnd();
	const FString Description = Draft.Description.TrimStartAndEnd();
	const FString Project = Draft.ProjectLabel.TrimStartAndEnd();
	if (CodePoints(Title) < 1)
	{
		OutWhy = TEXT("Give the post a title.");
		return false;
	}
	if (CodePoints(Title) > TitleMax)
	{
		OutWhy = FString::Printf(TEXT("The title is longer than %d characters."), TitleMax);
		return false;
	}
	if (CodePoints(Description) > DescriptionMax)
	{
		OutWhy = FString::Printf(TEXT("The description is longer than %d characters."), DescriptionMax);
		return false;
	}
	if (CodePoints(Project) > ProjectMax)
	{
		OutWhy = FString::Printf(TEXT("The project or activity is longer than %d characters."), ProjectMax);
		return false;
	}
	const TArray<FString> Skills = SplitSkills(Draft.Skills);
	if (Skills.Num() > SkillsMax)
	{
		OutWhy = FString::Printf(TEXT("List at most %d skills."), SkillsMax);
		return false;
	}
	for (const FString& Skill : Skills)
	{
		if (CodePoints(Skill) > SkillMax)
		{
			OutWhy = FString::Printf(TEXT("Each skill is at most %d characters."), SkillMax);
			return false;
		}
	}
	if (Draft.OpenSlots < SlotsMin || Draft.OpenSlots > SlotsMax)
	{
		OutWhy = FString::Printf(TEXT("Look for %d to %d people."), SlotsMin, SlotsMax);
		return false;
	}
	OutFields.Category = Draft.Category;
	OutFields.Title = Title;
	OutFields.Description = Description;
	OutFields.ProjectLabel = Project;
	OutFields.Skills = Skills;
	OutFields.OpenSlots = Draft.OpenSlots;
	return true;
}

bool WonderlandLff::ValidateNote(const FString& Typed, FString& OutNote, FString& OutWhy)
{
	if (HasControlCharacter(Typed))
	{
		OutWhy = TEXT("The note must not contain a control character or a line break.");
		return false;
	}
	if (HasLoneSurrogate(Typed))
	{
		OutWhy = TEXT("The note is not valid text.");
		return false;
	}
	const FString Note = Typed.TrimStartAndEnd();
	if (CodePoints(Note) > MessageMax)
	{
		OutWhy = FString::Printf(TEXT("The note is longer than %d characters."), MessageMax);
		return false;
	}
	OutNote = Note;
	return true;
}

EWonderlandLffProblem WonderlandLff::ProblemOf(const FWonderlandLffAnswer& Answer)
{
	if (Answer.IsOk()) return EWonderlandLffProblem::None;
	if (Answer.bNeedsLive) return EWonderlandLffProblem::NeedsLive;
	if (Answer.bRefusedHere) return EWonderlandLffProblem::RefusedHere;
	switch (Answer.Status)
	{
	case 0:   return EWonderlandLffProblem::Unreachable;
	case 400: return EWonderlandLffProblem::Validation;
	case 401: return EWonderlandLffProblem::SignedOut;
	case 403: return EWonderlandLffProblem::Permission;
	case 404: return EWonderlandLffProblem::NotFound;
	case 409: return EWonderlandLffProblem::Conflict;
	case 429: return EWonderlandLffProblem::RateLimited;
	default:  return Answer.Status >= 500 ? EWonderlandLffProblem::Unavailable : EWonderlandLffProblem::Other;
	}
}

FString WonderlandLff::ProblemLine(const FWonderlandLffAnswer& Answer)
{
	switch (ProblemOf(Answer))
	{
	case EWonderlandLffProblem::None:
		return FString();
	case EWonderlandLffProblem::NeedsLive:
		return FWonderlandSocialPreviewService::LffNeedsLive().Problem;
	case EWonderlandLffProblem::Unreachable:
		return TEXT("Can't reach Wonderland social right now. Check your connection, then REFRESH.");
	case EWonderlandLffProblem::SignedOut:
		return TEXT("Your Wonderland session ended. Sign in again.");
	case EWonderlandLffProblem::Permission:
		return TEXT("The Looking For Feed isn't available to this session.");
	case EWonderlandLffProblem::NotFound:
		// THE ONE ABSENCE (social-lff.ts lffNotFound): missing, not the viewer's, or out of their sight -- never which
		return TEXT("That post or request is no longer available.");
	case EWonderlandLffProblem::RateLimited:
		return FString::Printf(TEXT("Too many requests. Try again in %d s."), FMath::Max(1, Answer.RetryAfterSeconds));
	case EWonderlandLffProblem::Unavailable:
		return TEXT("The Looking For Feed is unavailable right now (the server is busy or restarting). Try again shortly.");
	case EWonderlandLffProblem::Validation:
		return Answer.Problem.IsEmpty() ? FString(TEXT("The server refused that.")) : FString::Printf(TEXT("The server refused that: %s."), *Answer.Problem);
	default:
		// RefusedHere, Conflict (a cap, a closed post: the server's own sentence), Other
		return Answer.Problem.IsEmpty() ? FString::Printf(TEXT("Something went wrong (HTTP %d)."), Answer.Status) : Answer.Problem;
	}
}

FString WonderlandLff::RequesterWord(const FString& Status)
{
	if (Status == TEXT("NO_LONGER_AVAILABLE")) return TEXT("NO LONGER AVAILABLE");
	return Status;   // PENDING, ACCEPTED, DECLINED as they are
}

/* ================================================================================================ the model */

namespace WonderlandLffModelDetail
{
	int32 KindIndex(EWonderlandLffBudget Kind)
	{
		return FMath::Clamp(static_cast<int32>(Kind), 0, static_cast<int32>(EWonderlandLffBudget::Count) - 1);
	}

	int32 ReadIndex(EWonderlandLffRead Read)
	{
		return FMath::Clamp(static_cast<int32>(Read), 0, static_cast<int32>(EWonderlandLffRead::Count) - 1);
	}

	/** B35: what a withheld list says -- the hub's own word for Recent Players while it waits for a read after the open. */
	const TCHAR* const UpdatingLine = TEXT("Updating…");
}

FWonderlandLffModel::FWonderlandLffModel(TFunction<IWonderlandSocialService*()> InServiceOf)
	: ServiceOf(MoveTemp(InServiceOf))
{
}

void FWonderlandLffModel::Reset()
{
	// ONE PLAYER'S FEED AND DRAFTS NEVER REACH THE NEXT: everything goes, and every answer still on its way is dropped (Generation)
	++Generation;
	Data = FData();
	++TextRevision;
	LastOnScreen = 0.0;
	Changed.Broadcast();
}

bool FWonderlandLffModel::MayAsk(EWonderlandLffBudget Kind) const
{
	return Service() != nullptr && FPlatformTime::Seconds() >= Data.NotBefore[WonderlandLffModelDetail::KindIndex(Kind)];
}

int32 FWonderlandLffModel::RetryAfterLeft(EWonderlandLffBudget Kind) const
{
	return FMath::Max(0, FMath::CeilToInt32(Data.NotBefore[WonderlandLffModelDetail::KindIndex(Kind)] - FPlatformTime::Seconds()));
}

FString FWonderlandLffModel::HeldLine(EWonderlandLffBudget Kind) const
{
	return FString::Printf(TEXT("Too many requests. Try again in %d s."), FMath::Max(1, RetryAfterLeft(Kind)));
}

void FWonderlandLffModel::HandleServerChange()
{
	// TOLD, NOT SHOWN: the event says only that something changed; the lists are read again (now if on screen, else when next shown)
	if (!IsOnScreen(FPlatformTime::Seconds()) || !MayAsk(EWonderlandLffBudget::Read))
	{
		Data.bStale = true;
		return;
	}
	Data.bStale = false;
	// MORE THAN ONE FEED PAGE ON SCREEN: re-reading page 1 would fold away the pages the player loaded (m10); it says so instead, and the
	// open post (the one the player is looking at) is read again. B35: pages WITHHELD by the open gate are not on screen -- nothing to keep,
	// and only a first-page read lifts the gate -- so the feed is read again from page 1 then.
	if (Data.Pane == EWonderlandLffPane::Feed && Data.FeedPages > 1 && !IsReadWithheld(EWonderlandLffRead::Feed))
	{
		Data.bFeedNews = true;
		if (!Data.OpenPostId.IsEmpty())
		{
			ReadDetail(Data.OpenPostId);
		}
		Changed.Broadcast();
		return;
	}
	Reload();
}

void FWonderlandLffModel::NoteOnScreen(double NowSeconds)
{
	LastOnScreen = NowSeconds;
	if (Data.bStale && MayAsk(EWonderlandLffBudget::Read))
	{
		Data.bStale = false;
		Reload();
	}
	if (Data.bOpenGate)
	{
		RereadOpenSurface(NowSeconds);
	}
}

void FWonderlandLffModel::RereadOpenSurface(double NowSeconds)
{
	// B35 (R16 privacy, SC1): AN OPEN SURFACE NEVER DRAWS AN OLD VIEW. What the tab shows is read again OpenRereadSeconds after its last read
	// was asked, so a player who hid from the viewer (no event reaches it) leaves the screen within one read; a part not read in time is
	// withheld by its age (IsReadWithheld). Nothing while a 429 waits (the parts age out and are withheld, never drawn stale); nothing on
	// the form (it lists nobody); the preview has nothing to read.
	if (Service() == nullptr || Data.bNeedsLive || Data.Pane == EWonderlandLffPane::Form || !MayAsk(EWonderlandLffBudget::Read))
	{
		return;
	}
	switch (Data.Pane)
	{
	case EWonderlandLffPane::Feed:
		// MORE THAN ONE PAGE: page 1 is read again all the same and the further pages fold (privacy wins over m10: pages older than the age
		// rule are never kept on screen, and a re-read of page 1 alone cannot vouch for them)
		if (IsRereadDue(EWonderlandLffRead::Feed, NowSeconds))
		{
			ReadFeed(false, true);
		}
		break;
	case EWonderlandLffPane::MyPosts:
		if (IsRereadDue(EWonderlandLffRead::Mine, NowSeconds))
		{
			ReadMine(false, true);
		}
		break;
	case EWonderlandLffPane::MyRequests:
		if (IsRereadDue(EWonderlandLffRead::Requests, NowSeconds))
		{
			ReadRequests(true);
		}
		break;
	default:
		break;
	}
	// THE OPEN POST (and, through its answer, its owner's inbox)
	if (!Data.OpenPostId.IsEmpty() && IsRereadDue(EWonderlandLffRead::Detail, NowSeconds))
	{
		ReadDetail(Data.OpenPostId, true);
	}
}

EWonderlandLffLoad FWonderlandLffModel::LoadOfRead(EWonderlandLffRead Read) const
{
	switch (Read)
	{
	case EWonderlandLffRead::Feed:     return Data.FeedLoad;
	case EWonderlandLffRead::Mine:     return Data.MineLoad;
	case EWonderlandLffRead::Requests: return Data.RequestsLoad;
	case EWonderlandLffRead::Detail:   return Data.DetailLoad;
	case EWonderlandLffRead::Inbox:    return Data.InboxLoad;
	default:                           return EWonderlandLffLoad::Idle;
	}
}

bool FWonderlandLffModel::IsRereadDue(EWonderlandLffRead Read, double NowSeconds) const
{
	// ONE AT A TIME: a read still on its way is never replaced by the period (a slow server would otherwise never land one); the part it
	// shows ages out and is withheld meanwhile
	if (LoadOfRead(Read) == EWonderlandLffLoad::Loading)
	{
		return false;
	}
	// A FAILED READ BACKS OFF: 2 s, then 4, 8, 16 s ... at most 30 s after it was asked -- never once a frame
	const int32 Index = WonderlandLffModelDetail::ReadIndex(Read);
	const int32 Fails = FMath::Clamp(Data.FailedReads[Index], 0, 8);
	const double Wait = FMath::Min(WonderlandLff::OpenRereadSeconds * static_cast<double>(1 << Fails), WonderlandLff::OpenRetryMaxSeconds);
	return NowSeconds - Data.LastAskedAt[Index] >= Wait;
}

void FWonderlandLffModel::NoteAsked(EWonderlandLffRead Read, double AskedAt)
{
	Data.LastAskedAt[WonderlandLffModelDetail::ReadIndex(Read)] = AskedAt;
}

void FWonderlandLffModel::NoteReadFailed(EWonderlandLffRead Read)
{
	int32& Fails = Data.FailedReads[WonderlandLffModelDetail::ReadIndex(Read)];
	Fails = FMath::Min(Fails + 1, 8);
}

void FWonderlandLffModel::BeginOpenGate(double NowSeconds)
{
	// B35 (R16 privacy, SC1): THE HUB WAS OPENED. Everything this model holds was read before this moment, so nothing listing another player
	// is drawn until a read asked from now on has landed for it (IsReadWithheld). The data itself is kept (drafts, filters, the open post's
	// id, the requests it knew: the vanished check needs them); only DRAWING it waits.
	Data.bOpenGate = true;
	Data.OpenGateSeconds = NowSeconds;
	Data.bStale = true;
	if (IsOnScreen(NowSeconds))
	{
		// THE TAB IS ON SCREEN ALREADY (the hub reopened within a second, or opened again while open): its reads go now. A 429 still waiting
		// holds them as everywhere else: Reload says how long and leaves the data stale, so the first NoteOnScreen after the wait reads.
		Data.bStale = !MayAsk(EWonderlandLffBudget::Read);
		Reload();
	}
	else if (Service() != nullptr && !MayAsk(EWonderlandLffBudget::Read))
	{
		Data.ActionLine = HeldLine(EWonderlandLffBudget::Read);   // the tab will say "Updating…": this says why it may take a while
	}
	Changed.Broadcast();
}

bool FWonderlandLffModel::IsReadWithheld(EWonderlandLffRead Read) const
{
	return IsReadWithheldAt(Read, FPlatformTime::Seconds());
}

bool FWonderlandLffModel::IsReadWithheldAt(EWonderlandLffRead Read, double NowSeconds) const
{
	if (!Data.bOpenGate)
	{
		return false;
	}
	// ASKED BEFORE THE OPEN, OR NEVER LANDED: withheld. Not withheld from the same instant on (">="): FPlatformTime is monotonic, so a read
	// asked after BeginOpenGate returned (or inside it) is stamped at or after the open. One asked before it never counts, even landing after.
	const double AskedAt = Data.LandedAskedAt[WonderlandLffModelDetail::ReadIndex(Read)];
	if (AskedAt < Data.OpenGateSeconds)
	{
		return true;
	}
	// TOO OLD (the age rule): asked longer ago than OpenMaxAgeSeconds -- judged OpenAgeMarginSeconds early, so the frame built from this
	// answer is painted before it is that old. A read held by a 429, late or failed leaves the part withheld, never drawn stale.
	return NowSeconds - AskedAt > WonderlandLff::OpenMaxAgeSeconds - WonderlandLff::OpenAgeMarginSeconds;
}

uint8 FWonderlandLffModel::GetWithheldMask() const
{
	const double Now = FPlatformTime::Seconds();
	uint8 Mask = 0;
	for (int32 Index = 0; Index < static_cast<int32>(EWonderlandLffRead::Count); ++Index)
	{
		if (IsReadWithheldAt(static_cast<EWonderlandLffRead>(Index), Now))
		{
			Mask |= static_cast<uint8>(1u << Index);
		}
	}
	return Mask;
}

void FWonderlandLffModel::QaShiftClock(double Seconds)
{
	// AS IF SECONDS HAD PASSED: every kept time moves back (a sentinel -1, "never", stays); nothing is read or broadcast
	Data.OpenGateSeconds -= Seconds;
	for (int32 Index = 0; Index < static_cast<int32>(EWonderlandLffRead::Count); ++Index)
	{
		if (Data.LandedAskedAt[Index] >= 0.0)
		{
			Data.LandedAskedAt[Index] -= Seconds;
		}
		if (Data.LastAskedAt[Index] >= 0.0)
		{
			Data.LastAskedAt[Index] -= Seconds;
		}
	}
	for (int32 Index = 0; Index < static_cast<int32>(EWonderlandLffBudget::Count); ++Index)
	{
		if (Data.NotBefore[Index] > 0.0)
		{
			Data.NotBefore[Index] -= Seconds;
		}
	}
	if (LastOnScreen > 0.0)
	{
		LastOnScreen -= Seconds;
	}
}

bool FWonderlandLffModel::IsPaneWithheld(EWonderlandLffPane Pane) const
{
	switch (Pane)
	{
	case EWonderlandLffPane::Feed:       return IsReadWithheld(EWonderlandLffRead::Feed);
	case EWonderlandLffPane::MyPosts:    return IsReadWithheld(EWonderlandLffRead::Mine);
	case EWonderlandLffPane::MyRequests: return IsReadWithheld(EWonderlandLffRead::Requests);
	default:                             return false;   // the form: the player's own draft, nobody else
	}
}

bool FWonderlandLffModel::IsGateUp() const
{
	if (!Data.bOpenGate || Data.Pane == EWonderlandLffPane::Form)
	{
		return false;   // no gate begun; or the form, which draws only the player's own draft
	}
	if (IsPaneWithheld(Data.Pane) || IsDetailWithheld())
	{
		return true;
	}
	// THE OWNER'S INBOX counts only where it is drawn: under the viewer's own post, its detail drawn
	return !Data.OpenPostId.IsEmpty() && Data.Detail.Post.PostId == Data.OpenPostId && Data.Detail.Post.bViewerIsOwner && IsInboxWithheld();
}

void FWonderlandLffModel::NoteLanded(EWonderlandLffRead Read, double AskedAt)
{
	double& Landed = Data.LandedAskedAt[WonderlandLffModelDetail::ReadIndex(Read)];
	Landed = FMath::Max(Landed, AskedAt);
	Data.FailedReads[WonderlandLffModelDetail::ReadIndex(Read)] = 0;   // the back-off ends with an answer
	// B35 (the reviewer's Q-M1-1 item 4): what this read lists -- the posts and the OTHER players in it -- with when it was asked, so a diagnostic
	// can tell whether a read asked after a hide/block still listed that player. Ids only (never a title, a description or a note).
	TArray<FString> Posts;
	TSet<FString> People;
	const auto AddPost = [&Posts, &People](const FWonderlandLffPost& P) { Posts.Add(P.PostId); People.Add(P.Author.UserId); };
	const TCHAR* Kind = TEXT("?");
	switch (Read)
	{
	case EWonderlandLffRead::Feed:     Kind = TEXT("feed");     for (const FWonderlandLffPost& P : Data.Feed) { AddPost(P); } break;
	case EWonderlandLffRead::Mine:     Kind = TEXT("mine");     for (const FWonderlandLffPost& P : Data.MyPosts) { AddPost(P); } break;
	case EWonderlandLffRead::Requests: Kind = TEXT("requests"); for (const FWonderlandLffMyRequest& R : Data.MyRequests) { if (R.bHasPost) { AddPost(R.Post); } } break;
	case EWonderlandLffRead::Detail:
		Kind = TEXT("detail");
		AddPost(Data.Detail.Post);
		if (Data.Detail.bHasAuthorProfile) { People.Add(Data.Detail.AuthorProfile.Profile.UserId); }
		for (const FWonderlandSocialPersonRow& A : Data.Detail.Accepted) { People.Add(A.UserId); }
		break;
	case EWonderlandLffRead::Inbox:    Kind = TEXT("inbox");    for (const FWonderlandLffIncomingRequest& R : Data.Inbox.Requests) { People.Add(R.Requester.UserId); } break;
	default: break;
	}
	People.Remove(FString());
	TArray<FString> PeopleSorted = People.Array();
	PeopleSorted.Sort();
	UE_LOG(LogTemp, Display, TEXT("WLSOCIAL lff read landed: %s asked %.0f ms ago, posts %s, people %s | %s"), Kind, (FPlatformTime::Seconds() - AskedAt) * 1000.0,
		Posts.Num() > 0 ? *FString::Join(Posts, TEXT(",")) : TEXT("none"), PeopleSorted.Num() > 0 ? *FString::Join(PeopleSorted, TEXT(",")) : TEXT("none"),
		*WonderlandSocialFreshness::EventStamp());
}

void FWonderlandLffModel::NoteAnswer(const FWonderlandLffAnswer& Answer, EWonderlandLffBudget Kind)
{
	if (Answer.bNeedsLive)
	{
		Data.bNeedsLive = true;
	}
	// A 429 WAITS ITS RETRY-AFTER, for ITS kind of call only (the server's budgets are per class): nothing of that kind is asked until then
	if (WonderlandLff::ProblemOf(Answer) == EWonderlandLffProblem::RateLimited)
	{
		Data.NotBefore[WonderlandLffModelDetail::KindIndex(Kind)] = FPlatformTime::Seconds() + FMath::Max(1, Answer.RetryAfterSeconds);
	}
}

void FWonderlandLffModel::SetPane(EWonderlandLffPane Pane)
{
	if (Pane == EWonderlandLffPane::Form)
	{
		StartCreate();
		return;
	}
	Data.Pane = Pane;
	Data.Confirm = EWonderlandLffConfirm::None;
	Data.ConfirmSubject.Reset();
	Reload();
	Changed.Broadcast();
}

void FWonderlandLffModel::Reload()
{
	if (Service() == nullptr)
	{
		return;
	}
	if (!MayAsk(EWonderlandLffBudget::Read))
	{
		Data.ActionLine = HeldLine(EWonderlandLffBudget::Read);
		Data.bStale = true;
		Changed.Broadcast();
		return;
	}
	switch (Data.Pane)
	{
	case EWonderlandLffPane::Feed:       ReadFeed(false); break;
	case EWonderlandLffPane::MyPosts:    ReadMine(false); break;
	case EWonderlandLffPane::MyRequests: ReadRequests(); break;
	default: break;
	}
	if (Data.Pane != EWonderlandLffPane::Form && !Data.OpenPostId.IsEmpty())
	{
		ReadDetail(Data.OpenPostId);
	}
}

void FWonderlandLffModel::SetCategory(const FString& Category)
{
	if (!Category.IsEmpty() && !WonderlandLffIsCategory(Category))
	{
		return;
	}
	Data.Category = Category;
	Data.Feed.Reset();
	Data.FeedCursor.Reset();
	Data.FeedPages = 0;
	Data.FeedLoad = EWonderlandLffLoad::Idle;
	if (MayAsk(EWonderlandLffBudget::Read))
	{
		ReadFeed(false);
	}
	else
	{
		Data.ActionLine = HeldLine(EWonderlandLffBudget::Read);
		Data.bStale = true;
	}
	Changed.Broadcast();
}

bool FWonderlandLffModel::ApplyFilters()
{
	// THE SERVER FILTERS (B3.1: a filter value travels percent-encoded and is decoded once there), every page of the feed. The client only
	// refuses what the routes would refuse anyway, before it is sent.
	if (WonderlandLff::HasControlCharacter(Data.ProjectFilter) || WonderlandLff::HasControlCharacter(Data.SkillFilter))
	{
		Data.ActionLine = TEXT("A filter must not contain a control character or a line break.");
		Changed.Broadcast();
		return false;
	}
	if (WonderlandLff::HasLoneSurrogate(Data.ProjectFilter) || WonderlandLff::HasLoneSurrogate(Data.SkillFilter))
	{
		Data.ActionLine = TEXT("A filter is not valid text.");
		Changed.Broadcast();
		return false;
	}
	const FString Project = Data.ProjectFilter.TrimStartAndEnd();
	const FString Skill = Data.SkillFilter.TrimStartAndEnd();
	if (WonderlandLff::CodePoints(Project) > WonderlandLff::ProjectMax || WonderlandLff::CodePoints(Skill) > WonderlandLff::SkillMax)
	{
		Data.ActionLine = FString::Printf(TEXT("A project filter is at most %d characters, a skill at most %d."), WonderlandLff::ProjectMax, WonderlandLff::SkillMax);
		Changed.Broadcast();
		return false;
	}
	Data.AppliedProject = Project;
	Data.AppliedSkill = Skill;
	Data.ActionLine.Reset();
	Data.Feed.Reset();
	Data.FeedCursor.Reset();
	Data.FeedPages = 0;
	Data.FeedLoad = EWonderlandLffLoad::Idle;
	if (MayAsk(EWonderlandLffBudget::Read))
	{
		ReadFeed(false);
	}
	else
	{
		Data.ActionLine = HeldLine(EWonderlandLffBudget::Read);
		Data.bStale = true;
	}
	Changed.Broadcast();
	return true;
}

void FWonderlandLffModel::ClearFilters()
{
	Data.ProjectFilter.Reset();
	Data.SkillFilter.Reset();
	++TextRevision;   // the boxes are emptied too
	ApplyFilters();
}

void FWonderlandLffModel::LoadMore()
{
	if (CanLoadMore() && MayAsk(EWonderlandLffBudget::Read))
	{
		ReadFeed(true);
	}
}

void FWonderlandLffModel::LoadMoreMine()
{
	if (CanLoadMoreMine() && MayAsk(EWonderlandLffBudget::Read))
	{
		ReadMine(true);
	}
}

void FWonderlandLffModel::SetMineOpenOnly(bool bOpenOnly)
{
	Data.bMineOpenOnly = bOpenOnly;
	Data.MyPosts.Reset();
	Data.MineCursor.Reset();
	Data.MineLoad = EWonderlandLffLoad::Idle;
	if (MayAsk(EWonderlandLffBudget::Read))
	{
		ReadMine(false);
	}
	else
	{
		Data.ActionLine = HeldLine(EWonderlandLffBudget::Read);
		Data.bStale = true;
	}
	Changed.Broadcast();
}

void FWonderlandLffModel::ReadFeed(bool bMore, bool bPeriodic)
{
	IWonderlandSocialService* Svc = Service();
	if (Svc == nullptr)
	{
		return;
	}
	FWonderlandLffFeedQuery Query;
	Query.Category = Data.Category;
	Query.ProjectLabel = Data.AppliedProject;
	Query.Skill = Data.AppliedSkill;
	Query.Limit = WonderlandLff::PageLimit;
	Query.Cursor = bMore ? Data.FeedCursor : FString();
	const int32 Seq = ++Data.FeedSeq;
	const int32 Gen = Generation;
	const double AskedAt = FPlatformTime::Seconds();   // B35: the open gate compares the time a read was ASKED, never when it landed
	if (!bMore)
	{
		NoteAsked(EWonderlandLffRead::Feed, AskedAt);   // B35: the period counts from here (a further page never resets it)
	}
	Data.FeedLoad = EWonderlandLffLoad::Loading;
	if (!bPeriodic)
	{
		Changed.Broadcast();   // B35: the period's own ask rebuilds nothing; its answer does
	}
	const TWeakPtr<FWonderlandLffModel> Weak = AsShared();
	Svc->ReadLffFeed(Query, [Weak, Gen, Seq, bMore, AskedAt](const FWonderlandLffAnswer& Answer, const FWonderlandLffFeedPage& Page)
	{
		const TSharedPtr<FWonderlandLffModel> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Generation != Gen || Self->Data.FeedSeq != Seq)
		{
			return;   // a reset model, or a newer read of the feed is on its way: this answer is an older one's
		}
		FData& D = Self->Data;
		Self->NoteAnswer(Answer, EWonderlandLffBudget::Read);
		if (!Answer.IsOk())
		{
			if (!bMore)
			{
				Self->NoteReadFailed(EWonderlandLffRead::Feed);   // B35: the next periodic ask backs off
			}
			D.FeedLoad = EWonderlandLffLoad::Failed;
			D.FeedAnswer = Answer;
			if (Answer.bNeedsLive)
			{
				D.Feed.Reset();
				D.FeedCursor.Reset();
				D.FeedPages = 0;
			}
		}
		else
		{
			if (!bMore)
			{
				D.Feed.Reset();
				D.FeedPages = 0;
				D.bFeedNews = false;
				// B35: page 1 REPLACES the feed, so the feed is as fresh as this read. A further page (bMore) joins pages already held and
				// never lifts the gate: those pages may predate the open.
				Self->NoteLanded(EWonderlandLffRead::Feed, AskedAt);
			}
			for (const FWonderlandLffPost& Post : Page.Posts)
			{
				// a page that repeats a post already shown (the feed moved under the cursor) never shows it twice
				if (!D.Feed.ContainsByPredicate([&Post](const FWonderlandLffPost& Shown) { return Shown.PostId == Post.PostId; }))
				{
					D.Feed.Add(Post);
				}
			}
			D.FeedCursor = Page.NextCursor;
			D.FeedPages += 1;
			D.FeedLoad = EWonderlandLffLoad::Loaded;
			D.FeedAnswer = FWonderlandLffAnswer();
		}
		Self->Changed.Broadcast();
	});
}

void FWonderlandLffModel::ReadMine(bool bMore, bool bPeriodic)
{
	IWonderlandSocialService* Svc = Service();
	if (Svc == nullptr)
	{
		return;
	}
	FWonderlandLffFeedQuery Query;
	Query.bMine = true;
	Query.bHasOpenSlots = Data.bMineOpenOnly;
	Query.Limit = WonderlandLff::PageLimit;
	Query.Cursor = bMore ? Data.MineCursor : FString();
	const int32 Seq = ++Data.MineSeq;
	const int32 Gen = Generation;
	const double AskedAt = FPlatformTime::Seconds();   // B35
	if (!bMore)
	{
		NoteAsked(EWonderlandLffRead::Mine, AskedAt);
	}
	Data.MineLoad = EWonderlandLffLoad::Loading;
	if (!bPeriodic)
	{
		Changed.Broadcast();
	}
	const TWeakPtr<FWonderlandLffModel> Weak = AsShared();
	Svc->ReadLffFeed(Query, [Weak, Gen, Seq, bMore, AskedAt](const FWonderlandLffAnswer& Answer, const FWonderlandLffFeedPage& Page)
	{
		const TSharedPtr<FWonderlandLffModel> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Generation != Gen || Self->Data.MineSeq != Seq)
		{
			return;
		}
		FData& D = Self->Data;
		Self->NoteAnswer(Answer, EWonderlandLffBudget::Read);
		if (!Answer.IsOk())
		{
			if (!bMore)
			{
				Self->NoteReadFailed(EWonderlandLffRead::Mine);
			}
			D.MineLoad = EWonderlandLffLoad::Failed;
			D.MineAnswer = Answer;
		}
		else
		{
			if (!bMore)
			{
				D.MyPosts.Reset();
				Self->NoteLanded(EWonderlandLffRead::Mine, AskedAt);   // B35: the first page replaces the list; a further one never lifts the gate
			}
			for (const FWonderlandLffPost& Post : Page.Posts)
			{
				if (!D.MyPosts.ContainsByPredicate([&Post](const FWonderlandLffPost& Shown) { return Shown.PostId == Post.PostId; }))
				{
					D.MyPosts.Add(Post);
				}
			}
			D.MineCursor = Page.NextCursor;
			D.MineLoad = EWonderlandLffLoad::Loaded;
			D.MineAnswer = FWonderlandLffAnswer();
		}
		Self->Changed.Broadcast();
	});
}

void FWonderlandLffModel::ReadRequests(bool bPeriodic)
{
	IWonderlandSocialService* Svc = Service();
	if (Svc == nullptr)
	{
		return;
	}
	const int32 Seq = ++Data.RequestsSeq;
	const int32 Gen = Generation;
	const double AskedAt = FPlatformTime::Seconds();   // B35
	NoteAsked(EWonderlandLffRead::Requests, AskedAt);
	Data.RequestsLoad = EWonderlandLffLoad::Loading;
	if (!bPeriodic)
	{
		Changed.Broadcast();
	}
	const TWeakPtr<FWonderlandLffModel> Weak = AsShared();
	Svc->ReadLffMyRequests([Weak, Gen, Seq, AskedAt](const FWonderlandLffAnswer& Answer, const FWonderlandLffMyRequests& Listed)
	{
		const TSharedPtr<FWonderlandLffModel> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Generation != Gen || Self->Data.RequestsSeq != Seq)
		{
			return;
		}
		FData& D = Self->Data;
		Self->NoteAnswer(Answer, EWonderlandLffBudget::Read);
		if (!Answer.IsOk())
		{
			Self->NoteReadFailed(EWonderlandLffRead::Requests);
			D.RequestsLoad = EWonderlandLffLoad::Failed;
			D.RequestsAnswer = Answer;
			Self->Changed.Broadcast();
			return;
		}
		// A REQUEST IT KNEW AND NO LONGER FINDS: its post was deleted, or the post is out of the viewer's sight now. A block reads exactly
		// as a deletion (contract r2) and is never named: both say NO LONGER AVAILABLE, by id only (no title is kept: security m1). Not
		// when the answer was cut short (older requests are left out of it, not gone), and never for the viewer's own withdrawal
		// (SendWithdraw forgets it first). A request the server lists AGAIN (after an unblock) leaves the tombstones: its row is back.
		TSet<FString> Known;
		for (const FWonderlandLffMyRequest& Request : Listed.Requests)
		{
			Known.Add(Request.RequestId);
			D.Vanished.Remove(Request.RequestId);
		}
		if (!Listed.bTruncated)
		{
			for (const FString& Before : D.KnownRequests)
			{
				if (!Known.Contains(Before))
				{
					D.Vanished.AddUnique(Before);
				}
			}
		}
		D.KnownRequests = MoveTemp(Known);
		D.MyRequests = Listed.Requests;
		D.bRequestsTruncated = Listed.bTruncated;
		D.RequestsLoad = EWonderlandLffLoad::Loaded;
		D.RequestsAnswer = FWonderlandLffAnswer();
		Self->NoteLanded(EWonderlandLffRead::Requests, AskedAt);   // B35: the whole list replaced (its tombstones judged by this read)
		Self->Changed.Broadcast();
	});
}

void FWonderlandLffModel::ReadDetail(const FString& PostId, bool bPeriodic)
{
	IWonderlandSocialService* Svc = Service();
	if (Svc == nullptr || PostId.IsEmpty())
	{
		return;
	}
	const int32 Seq = ++Data.DetailSeq;
	const int32 Gen = Generation;
	const double AskedAt = FPlatformTime::Seconds();   // B35
	NoteAsked(EWonderlandLffRead::Detail, AskedAt);
	if (Data.Detail.Post.PostId != PostId)
	{
		Data.Detail = FWonderlandLffPostDetail();   // another post's detail never shows under this one while it loads
	}
	Data.DetailLoad = EWonderlandLffLoad::Loading;
	if (!bPeriodic)
	{
		Changed.Broadcast();
	}
	const TWeakPtr<FWonderlandLffModel> Weak = AsShared();
	Svc->ReadLffPost(PostId, [Weak, Gen, Seq, PostId, AskedAt, bPeriodic](const FWonderlandLffAnswer& Answer, const FWonderlandLffPostDetail& Detail)
	{
		const TSharedPtr<FWonderlandLffModel> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Generation != Gen || Self->Data.DetailSeq != Seq || Self->Data.OpenPostId != PostId)
		{
			return;   // reset, a newer read, or the player opened another post meanwhile
		}
		FData& D = Self->Data;
		Self->NoteAnswer(Answer, EWonderlandLffBudget::Read);
		if (Answer.IsOk())
		{
			D.Detail = Detail;
			D.DetailLoad = EWonderlandLffLoad::Loaded;
			D.DetailAnswer = FWonderlandLffAnswer();
			Self->NoteLanded(EWonderlandLffRead::Detail, AskedAt);   // B35: the author, their card and the accepted people, as of this read
			// THE LISTS SHOW THE FRESHER VIEW of the same post; the feed lists OPEN posts only (r2), so a post closed or filled leaves it
			// (m14), and "open only" MY POSTS likewise
			const bool bOpen = Detail.Post.Status == TEXT("OPEN");
			for (FWonderlandLffPost& Shown : D.Feed)
			{
				if (Shown.PostId == PostId)
				{
					Shown = Detail.Post;
				}
			}
			for (FWonderlandLffPost& Shown : D.MyPosts)
			{
				if (Shown.PostId == PostId)
				{
					Shown = Detail.Post;
				}
			}
			if (!bOpen)
			{
				D.Feed.RemoveAll([&PostId](const FWonderlandLffPost& Shown) { return Shown.PostId == PostId; });
				if (D.bMineOpenOnly)
				{
					D.MyPosts.RemoveAll([&PostId](const FWonderlandLffPost& Shown) { return Shown.PostId == PostId; });
				}
			}
			if (Detail.Post.bViewerIsOwner)
			{
				// B35: THE PERIOD'S DETAIL never replaces an inbox read still on its way (a slow inbox would never land), and a failing inbox
				// backs off like every other read; any other detail read (an accept, a decline, an open) reads the inbox at once, as before
				const int32 InboxIndex = static_cast<int32>(EWonderlandLffRead::Inbox);
				const bool bInboxDue = !bPeriodic || (D.InboxLoad != EWonderlandLffLoad::Loading
					&& (D.FailedReads[InboxIndex] == 0 || Self->IsRereadDue(EWonderlandLffRead::Inbox, FPlatformTime::Seconds())));
				if (bInboxDue)
				{
					Self->ReadInbox(PostId);
				}
			}
			else
			{
				D.Inbox = FWonderlandLffPostRequests();
				D.InboxLoad = EWonderlandLffLoad::Idle;
			}
		}
		else if (WonderlandLff::ProblemOf(Answer) == EWonderlandLffProblem::NotFound)
		{
			Self->NoteReadFailed(EWonderlandLffRead::Detail);   // B35: a post gone is asked again only as the back-off allows
			Self->ForgetPost(PostId);
			D.DetailAnswer = Answer;
		}
		else
		{
			Self->NoteReadFailed(EWonderlandLffRead::Detail);
			D.DetailLoad = EWonderlandLffLoad::Failed;
			D.DetailAnswer = Answer;
			if (D.Detail.Post.PostId == PostId)
			{
				D.ActionLine = WonderlandLff::ProblemLine(Answer);   // the detail on screen is the last one read: say why it is not newer
			}
		}
		Self->Changed.Broadcast();
	});
}

void FWonderlandLffModel::ReadInbox(const FString& PostId)
{
	IWonderlandSocialService* Svc = Service();
	if (Svc == nullptr || PostId.IsEmpty())
	{
		return;
	}
	const int32 Seq = ++Data.InboxSeq;
	const int32 Gen = Generation;
	const double AskedAt = FPlatformTime::Seconds();   // B35
	NoteAsked(EWonderlandLffRead::Inbox, AskedAt);
	if (Data.Inbox.PostId != PostId)
	{
		Data.Inbox = FWonderlandLffPostRequests();
	}
	Data.InboxLoad = EWonderlandLffLoad::Loading;
	const TWeakPtr<FWonderlandLffModel> Weak = AsShared();
	Svc->ReadLffPostRequests(PostId, [Weak, Gen, Seq, PostId, AskedAt](const FWonderlandLffAnswer& Answer, const FWonderlandLffPostRequests& Inbox)
	{
		const TSharedPtr<FWonderlandLffModel> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Generation != Gen || Self->Data.InboxSeq != Seq || Self->Data.OpenPostId != PostId)
		{
			return;
		}
		FData& D = Self->Data;
		Self->NoteAnswer(Answer, EWonderlandLffBudget::Read);
		if (Answer.IsOk())
		{
			D.Inbox = Inbox;
			D.InboxLoad = EWonderlandLffLoad::Loaded;
			D.InboxAnswer = FWonderlandLffAnswer();
			Self->NoteLanded(EWonderlandLffRead::Inbox, AskedAt);   // B35: the requesters, as of this read
		}
		else
		{
			Self->NoteReadFailed(EWonderlandLffRead::Inbox);
			D.InboxLoad = EWonderlandLffLoad::Failed;
			D.InboxAnswer = Answer;
		}
		Self->Changed.Broadcast();
	});
}

void FWonderlandLffModel::ForgetPost(const FString& PostId)
{
	// GONE FOR THIS VIEWER (deleted, closed to them, its author out of their sight): from every list, and the detail says so
	Data.Feed.RemoveAll([&PostId](const FWonderlandLffPost& Post) { return Post.PostId == PostId; });
	Data.MyPosts.RemoveAll([&PostId](const FWonderlandLffPost& Post) { return Post.PostId == PostId; });
	if (Data.OpenPostId == PostId)
	{
		Data.Detail = FWonderlandLffPostDetail();
		Data.DetailLoad = EWonderlandLffLoad::Failed;
		Data.DetailAnswer = FWonderlandLffAnswer();
		Data.DetailAnswer.Status = 404;
		Data.DetailAnswer.Problem = TEXT("post not found");
		Data.Inbox = FWonderlandLffPostRequests();
		Data.InboxLoad = EWonderlandLffLoad::Idle;
		Data.Confirm = EWonderlandLffConfirm::None;
		Data.ConfirmSubject.Reset();
	}
}

void FWonderlandLffModel::DismissVanished(const FString& RequestId)
{
	Data.Vanished.Remove(RequestId);
	Changed.Broadcast();
}

EWonderlandLffLoad FWonderlandLffModel::GetLoad(EWonderlandLffPane Pane) const
{
	switch (Pane)
	{
	case EWonderlandLffPane::Feed:       return Data.FeedLoad;
	case EWonderlandLffPane::MyPosts:    return Data.MineLoad;
	case EWonderlandLffPane::MyRequests: return Data.RequestsLoad;
	default:                             return EWonderlandLffLoad::Loaded;
	}
}

FString FWonderlandLffModel::PaneLine(EWonderlandLffPane Pane) const
{
	if (Data.bNeedsLive)
	{
		return FWonderlandSocialPreviewService::LffNeedsLive().Problem;
	}
	// B35: A WITHHELD LIST says "Updating…" -- never its rows, its count, "new activity" or "empty" (each describes what was read before the
	// open). A read that FAILED says why, and the list stays withheld: nothing falls back to what was read before.
	if (IsPaneWithheld(Pane))
	{
		const EWonderlandLffLoad Load = GetLoad(Pane);
		const FWonderlandLffAnswer& LastAnswer = Pane == EWonderlandLffPane::Feed ? Data.FeedAnswer
			: Pane == EWonderlandLffPane::MyPosts ? Data.MineAnswer : Data.RequestsAnswer;
		return Load == EWonderlandLffLoad::Failed ? WonderlandLff::ProblemLine(LastAnswer) : FString(WonderlandLffModelDetail::UpdatingLine);
	}
	switch (Pane)
	{
	case EWonderlandLffPane::Feed:
		if (Data.FeedLoad == EWonderlandLffLoad::Failed)
		{
			return WonderlandLff::ProblemLine(Data.FeedAnswer);
		}
		if (Data.Feed.Num() > 0)
		{
			return Data.bFeedNews ? FString(TEXT("There is new activity: REFRESH to see it.")) : FString();
		}
		if (Data.FeedLoad != EWonderlandLffLoad::Loaded)
		{
			return TEXT("Loading posts…");
		}
		if (HasAppliedFilters())
		{
			return TEXT("No open posts match these filters. CLEAR shows them all.");
		}
		return Data.Category.IsEmpty() ? FString(TEXT("No posts yet. Be the first: CREATE POST."))
			: FString::Printf(TEXT("No open posts in %s yet. Be the first: CREATE POST."), *WonderlandLffCategoryLabel(Data.Category));
	case EWonderlandLffPane::MyPosts:
		if (Data.MineLoad == EWonderlandLffLoad::Failed)
		{
			return WonderlandLff::ProblemLine(Data.MineAnswer);
		}
		if (Data.MyPosts.Num() > 0)
		{
			return FString();
		}
		if (Data.MineLoad != EWonderlandLffLoad::Loaded)
		{
			return TEXT("Loading your posts…");
		}
		return Data.bMineOpenOnly ? FString(TEXT("You have no open posts."))
			: FString(TEXT("You have no posts. CREATE POST to say who you are looking for."));
	case EWonderlandLffPane::MyRequests:
		if (Data.RequestsLoad == EWonderlandLffLoad::Failed)
		{
			return WonderlandLff::ProblemLine(Data.RequestsAnswer);
		}
		if (Data.MyRequests.Num() > 0 || Data.Vanished.Num() > 0)
		{
			return FString();
		}
		return Data.RequestsLoad != EWonderlandLffLoad::Loaded ? FString(TEXT("Loading your requests…"))
			: FString(TEXT("You have not asked to join a post yet. Find one in the FEED."));
	default:
		return FString();
	}
}

void FWonderlandLffModel::OpenPost(const FString& PostId)
{
	if (PostId.IsEmpty())
	{
		return;
	}
	if (PostId != Data.OpenPostId)
	{
		Data.OpenPostId = PostId;
		Data.Detail = FWonderlandLffPostDetail();
		Data.DetailLoad = EWonderlandLffLoad::Idle;
		Data.Inbox = FWonderlandLffPostRequests();
		Data.InboxLoad = EWonderlandLffLoad::Idle;
		if (Data.Confirm != EWonderlandLffConfirm::Leave)
		{
			Data.Confirm = EWonderlandLffConfirm::None;   // a close or delete was for the post that was open
			Data.ConfirmSubject.Reset();
		}
		Data.Note.Reset();   // a note is for one post
		++TextRevision;
	}
	if (MayAsk(EWonderlandLffBudget::Read))
	{
		ReadDetail(PostId);
	}
	else
	{
		Data.ActionLine = HeldLine(EWonderlandLffBudget::Read);
		Data.bStale = true;
	}
	Changed.Broadcast();
}

FString FWonderlandLffModel::DetailLine() const
{
	if (Data.OpenPostId.IsEmpty())
	{
		return TEXT("Choose a post to see it here.");
	}
	// B35: THE DETAIL ON HAND WAS READ BEFORE THE OPEN (or none yet): "Updating…", or why its read failed -- never the old detail
	if (IsDetailWithheld() && Data.DetailLoad != EWonderlandLffLoad::Failed)
	{
		return WonderlandLffModelDetail::UpdatingLine;
	}
	if (Data.DetailLoad == EWonderlandLffLoad::Failed)
	{
		return WonderlandLff::ProblemOf(Data.DetailAnswer) == EWonderlandLffProblem::NotFound ? FString(TEXT("This post is no longer available."))
			: WonderlandLff::ProblemLine(Data.DetailAnswer);
	}
	return HasDetail() ? FString() : FString(TEXT("Loading the post…"));
}

FString FWonderlandLffModel::InboxLine() const
{
	if (Data.InboxLoad == EWonderlandLffLoad::Failed)
	{
		return WonderlandLff::ProblemLine(Data.InboxAnswer);
	}
	// B35: requesters read before the open are not listed, and neither is "no requests" (also a statement about other people)
	if (IsInboxWithheld())
	{
		return WonderlandLffModelDetail::UpdatingLine;
	}
	if (Data.Inbox.PostId == Data.OpenPostId && Data.Inbox.Requests.Num() > 0)
	{
		return FString();
	}
	return Data.InboxLoad == EWonderlandLffLoad::Loaded ? FString(TEXT("No requests on this post yet.")) : FString(TEXT("Loading requests…"));
}

void FWonderlandLffModel::StartCreate()
{
	if (Data.Pane != EWonderlandLffPane::Form)
	{
		Data.PaneBeforeForm = Data.Pane;
	}
	// THE NEW POST'S DRAFT, as it was left; an edit in progress is kept for its own EDIT (m8), never overwritten here
	if (Data.bEditingForm)
	{
		Data.bEditingForm = false;
		++TextRevision;
	}
	Data.FormProblem.Reset();
	Data.Confirm = EWonderlandLffConfirm::None;
	Data.ConfirmSubject.Reset();
	Data.Pane = EWonderlandLffPane::Form;
	Changed.Broadcast();
}

bool FWonderlandLffModel::StartEdit()
{
	if (!HasDetail() || !Data.Detail.Post.bViewerIsOwner || Data.Detail.Post.Status != TEXT("OPEN"))
	{
		return false;   // the owner's, OPEN only (the server says the same)
	}
	const FWonderlandLffPost& Post = Data.Detail.Post;
	if (Data.Pane != EWonderlandLffPane::Form)
	{
		Data.PaneBeforeForm = Data.Pane;
	}
	// AN EDIT OF THIS SAME POST ALREADY IN PROGRESS is resumed as it was left; any other is filled from the post as the server holds it
	if (Data.EditDraft.EditingPostId != Post.PostId)
	{
		Data.EditDraft = FWonderlandLffDraft();
		Data.EditDraft.EditingPostId = Post.PostId;
		Data.EditDraft.Category = Post.Category;
		Data.EditDraft.Title = Post.Title;
		Data.EditDraft.Description = Post.Description;
		Data.EditDraft.ProjectLabel = Post.ProjectLabel;
		Data.EditDraft.Skills = FString::Join(Post.Skills, TEXT(", "));
		Data.EditDraft.OpenSlots = Post.OpenSlots;
	}
	Data.bEditingForm = true;
	++TextRevision;
	Data.FormProblem.Reset();
	Data.Confirm = EWonderlandLffConfirm::None;
	Data.ConfirmSubject.Reset();
	Data.Pane = EWonderlandLffPane::Form;
	Changed.Broadcast();
	return true;
}

void FWonderlandLffModel::CancelForm()
{
	// CANCEL DISCARDS the showing draft (leaving the form by FEED / MY POSTS / MY REQUESTS keeps it)
	ActiveDraft() = FWonderlandLffDraft();
	Data.bEditingForm = false;
	++TextRevision;
	Data.FormProblem.Reset();
	Data.Pane = Data.PaneBeforeForm == EWonderlandLffPane::Form ? EWonderlandLffPane::Feed : Data.PaneBeforeForm;
	Reload();
	Changed.Broadcast();
}

bool FWonderlandLffModel::SubmitForm()
{
	FWonderlandLffPostFields Fields;
	FString Why;
	if (!WonderlandLff::ValidateDraft(GetDraft(), Fields, Why))
	{
		Data.FormProblem = Why;   // NOTHING IS SENT: the player fixes it first
		Changed.Broadcast();
		return false;
	}
	Data.FormProblem.Reset();
	const FString Editing = Data.bEditingForm ? Data.EditDraft.EditingPostId : FString();
	Write(EWonderlandLffBudget::Post, [Fields, Editing](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done)
	{
		if (Editing.IsEmpty())
		{
			Svc.CreateLffPost(Fields, MoveTemp(Done));
		}
		else
		{
			Svc.EditLffPost(Editing, Fields, MoveTemp(Done));
		}
	}, Editing.IsEmpty() ? FString(TEXT("Your post is up.")) : FString(TEXT("Saved.")), [Editing](FWonderlandLffModel& Self, const FString& CreatedId)
	{
		// the draft that was sent goes; the other one (a new post's, or an edit's) stays as it was left
		if (Editing.IsEmpty())
		{
			Self.Data.Draft = FWonderlandLffDraft();
		}
		else if (Self.Data.EditDraft.EditingPostId == Editing)
		{
			Self.Data.EditDraft = FWonderlandLffDraft();
		}
		Self.Data.bEditingForm = false;
		++Self.TextRevision;
		Self.Data.Pane = EWonderlandLffPane::MyPosts;
		Self.ReadMine(false);
		Self.OpenPost(Editing.IsEmpty() ? CreatedId : Editing);
	});
	return true;
}

void FWonderlandLffModel::SetDraftCategory(const FString& Category)
{
	if (WonderlandLffIsCategory(Category))
	{
		ActiveDraft().Category = Category;
		Changed.Broadcast();
	}
}

void FWonderlandLffModel::AdjustSlots(int32 Delta)
{
	FWonderlandLffDraft& Draft = ActiveDraft();
	Draft.OpenSlots = FMath::Clamp(Draft.OpenSlots + Delta, WonderlandLff::SlotsMin, WonderlandLff::SlotsMax);
	Changed.Broadcast();
}

void FWonderlandLffModel::SetFieldText(EWonderlandLffField Field, const FString& Text)
{
	FWonderlandLffDraft& Draft = ActiveDraft();
	switch (Field)
	{
	case EWonderlandLffField::ProjectFilter: Data.ProjectFilter = Text; break;
	case EWonderlandLffField::SkillFilter:   Data.SkillFilter = Text; break;
	case EWonderlandLffField::Title:         Draft.Title = Text; break;
	case EWonderlandLffField::Description:   Draft.Description = Text; break;
	case EWonderlandLffField::Project:       Draft.ProjectLabel = Text; break;
	case EWonderlandLffField::Skills:        Draft.Skills = Text; break;
	case EWonderlandLffField::Note:          Data.Note = Text; break;
	}
}

FString FWonderlandLffModel::GetFieldText(EWonderlandLffField Field) const
{
	const FWonderlandLffDraft& Draft = GetDraft();
	switch (Field)
	{
	case EWonderlandLffField::ProjectFilter: return Data.ProjectFilter;
	case EWonderlandLffField::SkillFilter:   return Data.SkillFilter;
	case EWonderlandLffField::Title:         return Draft.Title;
	case EWonderlandLffField::Description:   return Draft.Description;
	case EWonderlandLffField::Project:       return Draft.ProjectLabel;
	case EWonderlandLffField::Skills:        return Draft.Skills;
	case EWonderlandLffField::Note:          return Data.Note;
	}
	return FString();
}

void FWonderlandLffModel::Write(EWonderlandLffBudget Kind, TFunction<void(IWonderlandSocialService&, FWonderlandLffWriteDone)> Send, const FString& OkLine,
	TFunction<void(FWonderlandLffModel&, const FString&)> OnOk)
{
	IWonderlandSocialService* Svc = Service();
	if (Svc == nullptr)
	{
		Data.ActionLine = TEXT("Social is not connected.");
		Changed.Broadcast();
		return;
	}
	// ONE CHANGE AT A TIME: a second press while the first is on its way would ask twice
	if (Data.bWriting)
	{
		return;
	}
	// A 429 OF THIS KIND still waiting: nothing of this kind is sent (other kinds are not held)
	if (!MayAsk(Kind))
	{
		Data.ActionLine = HeldLine(Kind);
		if (Data.Pane == EWonderlandLffPane::Form && Kind == EWonderlandLffBudget::Post)
		{
			Data.FormProblem = Data.ActionLine;
		}
		Changed.Broadcast();
		return;
	}
	Data.bWriting = true;
	Data.ActionLine = TEXT("Sending…");
	Data.Confirm = EWonderlandLffConfirm::None;
	Data.ConfirmSubject.Reset();
	Changed.Broadcast();
	const TWeakPtr<FWonderlandLffModel> Weak = AsShared();
	const int32 Gen = Generation;
	Send(*Svc, [Weak, Gen, Kind, OkLine, OnOk](const FWonderlandLffAnswer& Answer, const FString& CreatedId)
	{
		const TSharedPtr<FWonderlandLffModel> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Generation != Gen)
		{
			return;
		}
		Self->Data.bWriting = false;
		Self->NoteAnswer(Answer, Kind);
		if (Answer.IsOk())
		{
			Self->Data.ActionLine = OkLine;
			if (OnOk)
			{
				OnOk(*Self, CreatedId);
			}
		}
		else
		{
			Self->Data.ActionLine = WonderlandLff::ProblemLine(Answer);
			if (Self->Data.Pane == EWonderlandLffPane::Form)
			{
				Self->Data.FormProblem = Self->Data.ActionLine;   // the form keeps its draft and says why
			}
			// GONE MEANWHILE (the one 404): what is shown is read again, and a post that is gone says so
			if (WonderlandLff::ProblemOf(Answer) == EWonderlandLffProblem::NotFound && Self->Data.Pane != EWonderlandLffPane::Form)
			{
				Self->Reload();
			}
		}
		Self->Changed.Broadcast();
	});
}

bool FWonderlandLffModel::RequestToJoin()
{
	if (!HasDetail() || Data.Detail.Post.bViewerIsOwner)
	{
		return false;
	}
	FString Note;
	FString Why;
	if (!WonderlandLff::ValidateNote(Data.Note, Note, Why))
	{
		Data.ActionLine = Why;   // nothing is sent
		Changed.Broadcast();
		return false;
	}
	const FString PostId = Data.OpenPostId;
	Write(EWonderlandLffBudget::Invitation,
		[PostId, Note](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done) { Svc.SendLffRequest(PostId, Note, MoveTemp(Done)); },
		TEXT("Request sent. The owner decides."), [PostId](FWonderlandLffModel& Self, const FString& CreatedId)
	{
		if (Self.Data.OpenPostId == PostId)
		{
			Self.Data.Note.Reset();
			++Self.TextRevision;
			Self.ReadDetail(PostId);
		}
		Self.ReadRequests();   // the new request is known from here on (a later absence is a vanishing)
	});
	return true;
}

void FWonderlandLffModel::SendWithdraw(const FString& RequestId, const FString& OkLine)
{
	Write(EWonderlandLffBudget::Write,
		[RequestId](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done) { Svc.ActOnLff(TEXT("lff.request.withdraw"), RequestId, MoveTemp(Done)); },
		OkLine, [RequestId](FWonderlandLffModel& Self, const FString&)
	{
		// ONE'S OWN WITHDRAWAL IS NOT A VANISHING: the server lists a withdrawn request no more, and nothing may call it "no longer available"
		Self.Data.KnownRequests.Remove(RequestId);
		Self.Data.MyRequests.RemoveAll([&RequestId](const FWonderlandLffMyRequest& Request) { return Request.RequestId == RequestId; });
		if (!Self.Data.OpenPostId.IsEmpty())
		{
			Self.ReadDetail(Self.Data.OpenPostId);
		}
		Self.ReadRequests();
	});
}

void FWonderlandLffModel::Withdraw(const FString& RequestId)
{
	SendWithdraw(RequestId, TEXT("Request withdrawn."));
}

void FWonderlandLffModel::Accept(const FString& RequestId)
{
	Write(EWonderlandLffBudget::Write,
		[RequestId](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done) { Svc.ActOnLff(TEXT("lff.request.accept"), RequestId, MoveTemp(Done)); },
		TEXT("Accepted. Connect with them the usual way: LFF itself grants nothing."), [](FWonderlandLffModel& Self, const FString&)
	{
		if (!Self.Data.OpenPostId.IsEmpty())
		{
			Self.ReadDetail(Self.Data.OpenPostId);   // an accept that fills the last slot closes the post
		}
		if (Self.Data.Pane == EWonderlandLffPane::MyPosts)
		{
			Self.ReadMine(false);
		}
	});
}

void FWonderlandLffModel::Decline(const FString& RequestId)
{
	Write(EWonderlandLffBudget::Write,
		[RequestId](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done) { Svc.ActOnLff(TEXT("lff.request.decline"), RequestId, MoveTemp(Done)); },
		TEXT("Declined."), [](FWonderlandLffModel& Self, const FString&)
	{
		if (!Self.Data.OpenPostId.IsEmpty())
		{
			Self.ReadDetail(Self.Data.OpenPostId);
		}
	});
}

void FWonderlandLffModel::AskConfirm(EWonderlandLffConfirm What, const FString& RequestId)
{
	if (What == EWonderlandLffConfirm::Leave)
	{
		if (RequestId.IsEmpty())
		{
			return;
		}
		Data.Confirm = What;
		Data.ConfirmSubject = RequestId;
		Changed.Broadcast();
		return;
	}
	if (What == EWonderlandLffConfirm::None || !HasDetail() || !Data.Detail.Post.bViewerIsOwner)
	{
		return;
	}
	Data.Confirm = What;
	Data.ConfirmSubject = Data.OpenPostId;
	Changed.Broadcast();
}

void FWonderlandLffModel::CancelConfirm()
{
	Data.Confirm = EWonderlandLffConfirm::None;
	Data.ConfirmSubject.Reset();
	Changed.Broadcast();
}

void FWonderlandLffModel::ConfirmPending()
{
	const EWonderlandLffConfirm What = Data.Confirm;
	const FString Subject = Data.ConfirmSubject;
	if (What == EWonderlandLffConfirm::None || Subject.IsEmpty())
	{
		return;
	}
	if (What == EWonderlandLffConfirm::Leave)
	{
		SendWithdraw(Subject, TEXT("You left the post. Your slot is free again; to come back, ask again."));
		return;
	}
	// CLOSE / DELETE: only for the post they were asked on, still the open one and still the viewer's
	if (Subject != Data.OpenPostId || !HasDetail() || !Data.Detail.Post.bViewerIsOwner)
	{
		CancelConfirm();
		return;
	}
	const FString PostId = Subject;
	if (What == EWonderlandLffConfirm::Close)
	{
		Write(EWonderlandLffBudget::Write,
			[PostId](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done) { Svc.ActOnLff(TEXT("lff.post.close"), PostId, MoveTemp(Done)); },
			TEXT("Post closed. Nobody new can ask to join."), [PostId](FWonderlandLffModel& Self, const FString&)
		{
			if (Self.Data.OpenPostId == PostId)
			{
				Self.ReadDetail(PostId);
			}
			Self.ReadMine(false);
		});
		return;
	}
	Write(EWonderlandLffBudget::Write,
		[PostId](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done) { Svc.ActOnLff(TEXT("lff.post.delete"), PostId, MoveTemp(Done)); },
		TEXT("Post deleted, with every request to it."), [PostId](FWonderlandLffModel& Self, const FString&)
	{
		Self.Data.Feed.RemoveAll([&PostId](const FWonderlandLffPost& Post) { return Post.PostId == PostId; });
		Self.Data.MyPosts.RemoveAll([&PostId](const FWonderlandLffPost& Post) { return Post.PostId == PostId; });
		if (Self.Data.OpenPostId == PostId)
		{
			Self.Data.OpenPostId.Reset();
			Self.Data.Detail = FWonderlandLffPostDetail();
			Self.Data.DetailLoad = EWonderlandLffLoad::Idle;
			Self.Data.Inbox = FWonderlandLffPostRequests();
			Self.Data.InboxLoad = EWonderlandLffLoad::Idle;
		}
		if (Self.Data.EditDraft.EditingPostId == PostId)
		{
			Self.Data.EditDraft = FWonderlandLffDraft();   // an edit of a post that is gone has nothing to save into
		}
		Self.ReadMine(false);
	});
}

void FWonderlandLffModel::ReportOpenPost()
{
	if (!HasDetail() || Data.Detail.Post.bViewerIsOwner)
	{
		return;
	}
	const FString AuthorId = Data.Detail.Post.Author.UserId;
	const FString PostId = Data.OpenPostId;
	Write(EWonderlandLffBudget::Write,
		[AuthorId, PostId](IWonderlandSocialService& Svc, FWonderlandLffWriteDone Done) { Svc.ReportLffPost(AuthorId, PostId, MoveTemp(Done)); },
		TEXT("Report sent."), nullptr);
}

void FWonderlandLffModel::ReadProfile(const FString& UserId, TFunction<void(const FWonderlandSocialProfileView&)> OnCard)
{
	IWonderlandSocialService* Svc = Service();
	if (Svc == nullptr || UserId.IsEmpty())
	{
		return;
	}
	if (!MayAsk(EWonderlandLffBudget::Read))
	{
		Data.ActionLine = HeldLine(EWonderlandLffBudget::Read);
		Changed.Broadcast();
		return;
	}
	const TWeakPtr<FWonderlandLffModel> Weak = AsShared();
	const int32 Gen = Generation;
	const double AskedAt = FPlatformTime::Seconds();   // B35
	Svc->ReadProfile(UserId, [Weak, Gen, OnCard, AskedAt](const FWonderlandLffAnswer& Answer, const FWonderlandSocialProfileView& Card)
	{
		const TSharedPtr<FWonderlandLffModel> Self = Weak.Pin();
		if (!Self.IsValid() || Self->Generation != Gen)
		{
			return;
		}
		Self->NoteAnswer(Answer, EWonderlandLffBudget::Read);
		// B35: A CARD ASKED BEFORE THE HUB WAS OPENED AGAIN opens nothing: the person may have blocked the viewer or hidden from them since
		if (Self->Data.bOpenGate && AskedAt < Self->Data.OpenGateSeconds)
		{
			return;
		}
		if (Answer.IsOk())
		{
			if (OnCard)
			{
				OnCard(Card);
			}
			return;
		}
		// THE ONE ABSENCE: a person the viewer may not see answers as missing -- never why
		Self->Data.ActionLine = WonderlandLff::ProblemOf(Answer) == EWonderlandLffProblem::NotFound ? FString(TEXT("That profile is not available to you."))
			: WonderlandLff::ProblemLine(Answer);
		Self->Changed.Broadcast();
	});
}

FString FWonderlandLffModel::Describe() const
{
	// IDS, COUNTS AND STATES ONLY (the 10-07 log rule): a title, a description, a label, a skill, a filter or a note is the player's
	const auto LoadName = [](EWonderlandLffLoad Load) -> const TCHAR*
	{
		switch (Load)
		{
		case EWonderlandLffLoad::Loading: return TEXT("loading");
		case EWonderlandLffLoad::Loaded:  return TEXT("loaded");
		case EWonderlandLffLoad::Failed:  return TEXT("failed");
		default:                          return TEXT("idle");
		}
	};
	const auto PaneName = [](EWonderlandLffPane Pane) -> const TCHAR*
	{
		switch (Pane)
		{
		case EWonderlandLffPane::MyPosts:    return TEXT("MY POSTS");
		case EWonderlandLffPane::MyRequests: return TEXT("MY REQUESTS");
		case EWonderlandLffPane::Form:       return TEXT("FORM");
		default:                             return TEXT("FEED");
		}
	};
	// B35: A WITHHELD LIST IS SAID AS WITHHELD -- no id, no count, no state of anyone in it (what was read before the open is not described
	// either); the gate itself is stated: "none" (no surface opened since the last reset), "fresh", or "UPDATING" with the withheld parts.
	const auto Withheld = [&LoadName](EWonderlandLffLoad Load) { return FString::Printf(TEXT("WITHHELD (%s)"), LoadName(Load)); };
	FString FeedPart;
	if (IsReadWithheld(EWonderlandLffRead::Feed))
	{
		FeedPart = Withheld(Data.FeedLoad);
	}
	else
	{
		TArray<FString> FeedIds;
		for (const FWonderlandLffPost& Post : Data.Feed)
		{
			FeedIds.Add(Post.PostId);
		}
		FeedPart = FString::Printf(TEXT("%s %d [%s]%s pages %d%s"), LoadName(Data.FeedLoad), Data.Feed.Num(), *FString::Join(FeedIds, TEXT(",")),
			Data.FeedCursor.IsEmpty() ? TEXT("") : TEXT(" +more"), Data.FeedPages, Data.bFeedNews ? TEXT(" news") : TEXT(""));
	}
	const FString MinePart = IsReadWithheld(EWonderlandLffRead::Mine) ? Withheld(Data.MineLoad)
		: FString::Printf(TEXT("%s %d%s%s"), LoadName(Data.MineLoad), Data.MyPosts.Num(), Data.bMineOpenOnly ? TEXT(" open-only") : TEXT(""),
			Data.MineCursor.IsEmpty() ? TEXT("") : TEXT(" +more"));
	FString RequestsPart;
	if (IsReadWithheld(EWonderlandLffRead::Requests))
	{
		RequestsPart = Withheld(Data.RequestsLoad);
	}
	else
	{
		TArray<FString> RequestRows;
		for (const FWonderlandLffMyRequest& Request : Data.MyRequests)
		{
			RequestRows.Add(FString::Printf(TEXT("%s:%s"), *Request.RequestId, *Request.Status));
		}
		RequestsPart = FString::Printf(TEXT("%s [%s] vanished %d"), LoadName(Data.RequestsLoad), *FString::Join(RequestRows, TEXT(",")), Data.Vanished.Num());
	}
	FString OpenPart;
	if (Data.OpenPostId.IsEmpty())
	{
		OpenPart = FString::Printf(TEXT("none %s"), LoadName(Data.DetailLoad));
	}
	else if (IsDetailWithheld())
	{
		OpenPart = Withheld(Data.DetailLoad);
	}
	else
	{
		const FWonderlandLffPost& Open = Data.Detail.Post;
		const FString OpenState = HasDetail() ? FString::Printf(TEXT("%s%s%s"), *Open.Status, Open.bViewerIsOwner ? TEXT(" owner") : TEXT(""),
			Open.bHasViewerRequest ? *FString::Printf(TEXT(" request %s:%s"), *Open.ViewerRequestId, *Open.ViewerRequestStatus) : TEXT("")) : FString(LoadName(Data.DetailLoad));
		OpenPart = FString::Printf(TEXT("%s %s"), *Data.OpenPostId, *OpenState);
	}
	FString InboxPart;
	if (IsInboxWithheld())
	{
		InboxPart = Withheld(Data.InboxLoad);
	}
	else
	{
		TArray<FString> InboxRows;
		for (const FWonderlandLffIncomingRequest& Request : Data.Inbox.Requests)
		{
			InboxRows.Add(FString::Printf(TEXT("%s:%s"), *Request.RequestId, *Request.Status));
		}
		InboxPart = FString::Printf(TEXT("%s [%s]"), LoadName(Data.InboxLoad), *FString::Join(InboxRows, TEXT(",")));
	}
	FString GatePart = TEXT("none");
	if (Data.bOpenGate)
	{
		TArray<FString> Up;
		if (IsGateUp())
		{
			if (IsPaneWithheld(Data.Pane)) Up.Add(PaneName(Data.Pane));
			if (IsDetailWithheld()) Up.Add(TEXT("POST"));
			if (!IsDetailWithheld() && IsInboxWithheld() && HasDetail() && Data.Detail.Post.bViewerIsOwner) Up.Add(TEXT("INBOX"));
		}
		GatePart = Up.Num() > 0 ? FString::Printf(TEXT("UPDATING (%s)"), *FString::Join(Up, TEXT(", "))) : FString(TEXT("fresh"));
	}
	// THE CONFIRM'S SUBJECT is an id of the post or request it acts on: not named while the gate is up
	const FString ConfirmSubject = Data.ConfirmSubject.IsEmpty() ? FString(TEXT("-")) : IsGateUp() ? FString(TEXT("(withheld)")) : Data.ConfirmSubject;
	const FString Form = Data.bEditingForm ? FString::Printf(TEXT("editing %s"), *Data.EditDraft.EditingPostId) : FString(TEXT("new"));
	return FString::Printf(TEXT("pane %s | category %s | filters %s | feed %s | mine %s | requests %s | open %s | inbox %s | form %s | confirm %d %s | writing %s | needs live %s | stale %s | gate %s | line: %s"),
		PaneName(Data.Pane), Data.Category.IsEmpty() ? TEXT("ALL") : *Data.Category, HasAppliedFilters() ? TEXT("on") : TEXT("off"),
		*FeedPart, *MinePart, *RequestsPart, *OpenPart, *InboxPart,
		*Form, static_cast<int32>(Data.Confirm), *ConfirmSubject,
		Data.bWriting ? TEXT("yes") : TEXT("no"), Data.bNeedsLive ? TEXT("yes") : TEXT("no"), Data.bStale ? TEXT("yes") : TEXT("no"), *GatePart, *Data.ActionLine);
}

/* ================================================================================================ the view */

// Named, not anonymous: the module is one unity translation unit (and two files there `using namespace WonderWebLook` at file scope, so
// nothing here is called Line, Ink, Fail, Good, Sans or Mono unqualified).
namespace WonderlandLffLook
{
	FText LffText(const FString& S) { return FText::FromString(S); }

	const EWonderlandLffField AllFields[] = {
		EWonderlandLffField::ProjectFilter, EWonderlandLffField::SkillFilter, EWonderlandLffField::Title, EWonderlandLffField::Description,
		EWonderlandLffField::Project, EWonderlandLffField::Skills, EWonderlandLffField::Note};

	/** Where a vanished request is drawn: never its old title (security m1), the same words for a delete and a block. */
	const TCHAR* const VanishedTitle = TEXT("A post you asked to join");
}

SWonderlandSocialLffView::SWonderlandSocialLffView()
	: RowBrush(WonderlandUi::Srgb(14, 16, 24, 0.74f), 10.0f, WonderlandUi::Ivory(0.08f), 1.0f)
	, RowSelectedBrush(WonderlandUi::Srgb(32, 28, 16, 0.86f), 10.0f, WonderlandUi::Gold(0.70f), 1.0f)
	, PaneBrush(WonderlandUi::Srgb(4, 5, 8, 0.92f), 12.0f, WonderlandUi::Ivory(0.10f), 1.0f)
	, PillBrush(WonderlandUi::Srgb(40, 34, 18, 0.92f), 8.0f, WonderlandUi::Gold(0.50f), 1.0f)
	, ButtonNormal(WonderlandUi::Srgb(24, 26, 38, 0.92f), 7.0f, WonderlandUi::Ivory(0.24f), 1.0f)
	, ButtonHovered(WonderlandUi::Srgb(40, 34, 18, 0.96f), 7.0f, WonderlandUi::Gold(0.90f), 1.2f)
	, ButtonDisabled(WonderlandUi::Srgb(16, 17, 22, 0.70f), 7.0f, WonderlandUi::Ivory(0.08f), 1.0f)
{
}

SWonderlandSocialLffView::~SWonderlandSocialLffView()
{
	if (SlatePreTickHandle.IsValid() && FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().OnPreTick().Remove(SlatePreTickHandle);
	}
	if (Model.IsValid() && ModelChangedHandle.IsValid())
	{
		Model->OnChanged().Remove(ModelChangedHandle);
	}
}

void SWonderlandSocialLffView::Construct(const FArguments& InArgs)
{
	Model = InArgs._Model;
	ViewerId = InArgs._ViewerId;
	bDevelopmentPreview = InArgs._bDevelopmentPreview;
	OnAction = InArgs._OnAction;
	OnOpenProfileView = InArgs._OnOpenProfileView;
	NoBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
	ButtonStyle = FButtonStyle().SetNormal(ButtonNormal).SetHovered(ButtonHovered).SetPressed(ButtonHovered).SetDisabled(ButtonDisabled)
		.SetNormalPadding(FMargin(10.0f, 5.0f)).SetPressedPadding(FMargin(10.0f, 6.0f, 10.0f, 4.0f));
	QuietStyle = FButtonStyle().SetNormal(NoBrush).SetHovered(ButtonHovered).SetPressed(ButtonHovered).SetDisabled(NoBrush)
		.SetNormalPadding(FMargin(7.0f, 3.0f)).SetPressedPadding(FMargin(7.0f, 4.0f, 7.0f, 2.0f));
	// F-21: a change's rebuild runs at Slate's pre-tick, after the frame's input and before its layout (as the hub's)
	if (FSlateApplication::IsInitialized())
	{
		SlatePreTickHandle = FSlateApplication::Get().OnPreTick().AddSP(this, &SWonderlandSocialLffView::HandleSlatePreTick);
	}
	if (Model.IsValid())
	{
		ModelChangedHandle = Model->OnChanged().AddSP(this, &SWonderlandSocialLffView::RequestRebuild);
	}
	// THE BOXES, ONCE. Each keystroke goes to the model's draft (nothing is broadcast: typing never rebuilds anything). One line each: a
	// line break is refused everywhere in LFF, as in the message composer. THE CARET STAYS on the refocus a rebuild makes (M1):
	// IsCaretMovedWhenGainFocus off, or Slate jumps it to the end of the text (SlateEditableTextLayout HandleFocusReceived).
	const TWeakPtr<FWonderlandLffModel> WeakModel = Model;
	const auto MakeTextBox = [WeakModel](EWonderlandLffField Field, const FString& Hint) -> TSharedPtr<SEditableTextBox>
	{
		// ENTER in a filter box applies the filters (the server reads the feed again); in any other box it sends nothing
		const bool bFilter = Field == EWonderlandLffField::ProjectFilter || Field == EWonderlandLffField::SkillFilter;
		return SNew(SEditableTextBox).HintText(WonderlandLffLook::LffText(Hint)).Font(WonderlandUi::Sans(10))
			.IsCaretMovedWhenGainFocus(false)
			.OnTextChanged_Lambda([WeakModel, Field](const FText& Typed)
			{
				if (const TSharedPtr<FWonderlandLffModel> Pinned = WeakModel.Pin())
				{
					Pinned->SetFieldText(Field, Typed.ToString());
				}
			})
			.OnTextCommitted_Lambda([WeakModel, bFilter](const FText&, ETextCommit::Type How)
			{
				const TSharedPtr<FWonderlandLffModel> Pinned = WeakModel.Pin();
				if (bFilter && Pinned.IsValid() && How == ETextCommit::OnEnter)
				{
					Pinned->ApplyFilters();
				}
			});
	};
	ProjectFilterBox = MakeTextBox(EWonderlandLffField::ProjectFilter, TEXT("Project or activity (contains)"));
	SkillFilterBox = MakeTextBox(EWonderlandLffField::SkillFilter, TEXT("A skill (exact)"));
	TitleBox = MakeTextBox(EWonderlandLffField::Title, TEXT("What are you looking for?"));
	DescriptionBox = MakeTextBox(EWonderlandLffField::Description, TEXT("One paragraph about it (optional)"));
	ProjectBox = MakeTextBox(EWonderlandLffField::Project, TEXT("A project or activity label (optional)"));
	SkillsBox = MakeTextBox(EWonderlandLffField::Skills, TEXT("Skills, comma-separated (optional)"));
	NoteBox = MakeTextBox(EWonderlandLffField::Note, TEXT("A note to the owner (optional)"));
	ChildSlot
	[
		SAssignNew(ContentHost, SBorder).BorderImage(&NoBrush).Padding(0.0f)
	];
	Rebuild();
}

void SWonderlandSocialLffView::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	LastDrawnFrame = GFrameCounter;
	bEverDrawn = true;
	// DRAWN, SO SHOWN: the model reads when it is first on screen, and after a change it was told of while hidden
	if (Model.IsValid())
	{
		Model->NoteOnScreen(FPlatformTime::Seconds());
	}
}

void SWonderlandSocialLffView::SetContext(const FString& InViewerId, bool bInDevelopmentPreview)
{
	if (InViewerId != ViewerId || bInDevelopmentPreview != bDevelopmentPreview)
	{
		ViewerId = InViewerId;
		bDevelopmentPreview = bInDevelopmentPreview;
		RequestRebuild();
	}
}

void SWonderlandSocialLffView::HandleSlatePreTick(float DeltaTime)
{
	RebuildIfDue();
	// A REQUESTER'S CARD THAT ARRIVED IN AN ANSWER opens here, after the frame's input and before its layout (F-21), never in the answer --
	// and only while this view is ON SCREEN (drawn in the previous frame): a late answer after the hub closed opens nothing over the world.
	// DRAWN AT ALL is its own flag: frame 0 is a real frame (GFrameCounter is 0 all through the engine's first one), not "never drawn".
	if (bProfileOpenPending)
	{
		bProfileOpenPending = false;
		const FWonderlandSocialProfileView Card = PendingProfileCard;
		PendingProfileCard = FWonderlandSocialProfileView();
		const bool bOnScreen = bEverDrawn && GFrameCounter - LastDrawnFrame <= 1;
		if (bOnScreen)
		{
			OnOpenProfileView.ExecuteIfBound(Card);
		}
	}
}

void SWonderlandSocialLffView::FlushRebuild()
{
	RebuildIfDue();
}

void SWonderlandSocialLffView::RebuildIfDue()
{
	// B35: AN AGE RUNS OUT WITH NO ANSWER AND NO BROADCAST (a read late, held by a 429, or failing): what the model withholds NOW is compared
	// with what the last build saw, at every pre-tick -- before the frame's layout and paint -- so rows past their age are never painted
	if (Model.IsValid() && Model->GetWithheldMask() != BuiltWithheldMask)
	{
		bRebuildPending = true;
	}
	if (bRebuildPending)
	{
		Rebuild();
	}
}

float SWonderlandSocialLffView::QaListScrollOffset() const
{
	return ListScroll.IsValid() ? ListScroll->GetScrollOffset() : -1.0f;
}

void SWonderlandSocialLffView::QaSetListScrollOffset(float Offset)
{
	if (ListScroll.IsValid())
	{
		ListScroll->SetScrollOffset(Offset);
	}
}

TSharedPtr<SEditableTextBox> SWonderlandSocialLffView::BoxOf(EWonderlandLffField Field) const
{
	switch (Field)
	{
	case EWonderlandLffField::ProjectFilter: return ProjectFilterBox;
	case EWonderlandLffField::SkillFilter:   return SkillFilterBox;
	case EWonderlandLffField::Title:         return TitleBox;
	case EWonderlandLffField::Description:   return DescriptionBox;
	case EWonderlandLffField::Project:       return ProjectBox;
	case EWonderlandLffField::Skills:        return SkillsBox;
	case EWonderlandLffField::Note:          return NoteBox;
	}
	return nullptr;
}

void SWonderlandSocialLffView::SyncBoxes()
{
	if (!Model.IsValid() || SeenTextRevision == Model->GetTextRevision())
	{
		return;   // nothing replaced: what the boxes hold is what the player typed, and it stays exactly as it is
	}
	SeenTextRevision = Model->GetTextRevision();
	for (const EWonderlandLffField Field : WonderlandLffLook::AllFields)
	{
		const TSharedPtr<SEditableTextBox> Box = BoxOf(Field);
		const FString Want = Model->GetFieldText(Field);
		if (Box.IsValid() && Box->GetText().ToString() != Want)
		{
			Box->SetText(FText::FromString(Want));
		}
	}
}

TSharedRef<SWidget> SWonderlandSocialLffView::PlaceBox(EWonderlandLffField Field)
{
	const TSharedPtr<SEditableTextBox> Box = BoxOf(Field);
	if (!Box.IsValid() || PlacedBoxes.Contains(Box))
	{
		return SNew(SBox);   // a widget has one parent: never placed twice in one build
	}
	PlacedBoxes.Add(Box);
	return Box.ToSharedRef();
}

void SWonderlandSocialLffView::Rebuild()
{
	bRebuildPending = false;
	if (!ContentHost.IsValid())
	{
		return;
	}
	// WHAT THE PLAYER IS TYPING STAYS (the audit's risk 5; F-21): the boxes are re-slotted, not rebuilt, so their text stays; the one that
	// had the keyboard focus gets it back (its old path went with the old layout), its caret where it was (M1; a selection is cleared).
	TSharedPtr<SEditableTextBox> Focused;
	for (const EWonderlandLffField Field : WonderlandLffLook::AllFields)
	{
		const TSharedPtr<SEditableTextBox> Box = BoxOf(Field);
		if (Box.IsValid() && Box->HasAnyUserFocusOrFocusedDescendants())
		{
			Focused = Box;
			break;
		}
	}
	SyncBoxes();
	PlacedBoxes.Reset();
	bBuiltNeedsLive = false;
	BuiltPostCards = 0;
	BuiltPersonRows = 0;
	BuiltRequestRows = 0;
	BuiltAskLabel.Reset();
	// B35: WHAT IS WITHHELD, READ BEFORE BUILDING: should an age run out while this build runs, the next pre-tick sees a difference and builds
	// again (read after, a part built just before its age ran out would stay on screen)
	BuiltWithheldMask = Model.IsValid() ? Model->GetWithheldMask() : 0;
	// B35: THE SCROLL STAYS for the same pane and the same open post (the open surface's period rebuilds every few seconds; a list snapped
	// back to its top each time could not be read). Another pane, another post or the form starts at the top.
	const EWonderlandLffPane Pane = Model.IsValid() ? Model->GetPane() : EWonderlandLffPane::Feed;
	const FString OpenPostId = Model.IsValid() ? Model->GetOpenPostId() : FString();
	const float ListOffset = ListScroll.IsValid() && ListScrollPane == Pane ? ListScroll->GetScrollOffset() : 0.0f;
	const float DetailOffset = DetailScroll.IsValid() && DetailScrollPostId == OpenPostId ? DetailScroll->GetScrollOffset() : 0.0f;
	const float FormOffset = FormScroll.IsValid() ? FormScroll->GetScrollOffset() : 0.0f;
	ListScroll.Reset();
	DetailScroll.Reset();
	FormScroll.Reset();
	ContentHost->SetContent(MakeContent());
	if (ListScroll.IsValid())
	{
		ListScroll->SetScrollOffset(ListOffset);
	}
	if (DetailScroll.IsValid())
	{
		DetailScroll->SetScrollOffset(DetailOffset);
	}
	if (FormScroll.IsValid())
	{
		FormScroll->SetScrollOffset(FormOffset);
	}
	ListScrollPane = Pane;
	DetailScrollPostId = OpenPostId;
	if (Focused.IsValid() && PlacedBoxes.Contains(Focused) && FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetKeyboardFocus(Focused, EFocusCause::SetDirectly);
	}
}

FString SWonderlandSocialLffView::QaFieldText(EWonderlandLffField Field) const
{
	const TSharedPtr<SEditableTextBox> Box = BoxOf(Field);
	return Box.IsValid() ? Box->GetText().ToString() : FString();
}

bool SWonderlandSocialLffView::QaTypeInto(EWonderlandLffField Field, const FString& Typed)
{
	const TSharedPtr<SEditableTextBox> Box = BoxOf(Field);
	if (!Box.IsValid() || !Model.IsValid())
	{
		return false;
	}
	// as a keystroke lands: the box shows it, and its OnTextChanged writes the model's draft (written here too, should SetText not fire it)
	Box->SetText(FText::FromString(Typed));
	Model->SetFieldText(Field, Typed);
	return true;
}

bool SWonderlandSocialLffView::QaIsPlaced(EWonderlandLffField Field) const
{
	const TSharedPtr<SEditableTextBox> Box = BoxOf(Field);
	if (!Box.IsValid() || !PlacedBoxes.Contains(Box))
	{
		return false;
	}
	// ITS PARENT CHAIN REACHES THIS VIEW: it is in the tree this view shows now, not only remembered as placed (M2)
	const SWidget* const Self = this;
	TSharedPtr<SWidget> Up = Box->GetParentWidget();
	for (int32 Depth = 0; Up.IsValid() && Depth < 64; ++Depth)
	{
		if (Up.Get() == Self)
		{
			return true;
		}
		Up = Up->GetParentWidget();
	}
	return false;
}

FString SWonderlandSocialLffView::QaLines() const
{
	if (!Model.IsValid())
	{
		return TEXT("no model");
	}
	const bool bNeedsLive = bDevelopmentPreview || Model->NeedsLive();
	return FString::Printf(TEXT("%spane: %s | detail: %s | action: %s"), bNeedsLive ? TEXT("NEEDS A LIVE CONNECTION | ") : TEXT(""),
		*Model->PaneLine(Model->GetPane()), *Model->DetailLine(), *Model->GetActionLine());
}

void SWonderlandSocialLffView::OpenProfileOf(const FString& UserId)
{
	if (!Model.IsValid())
	{
		return;
	}
	// THE EXISTING profile.read, then the existing profile panel -- only while this view still lives (its own weak pointer). The answer
	// only keeps the card: the panel opens at the next pre-tick (F-21; HandleSlatePreTick), as every other change on this view lands.
	const TWeakPtr<SWonderlandSocialLffView> WeakView = StaticCastSharedRef<SWonderlandSocialLffView>(AsShared());
	Model->ReadProfile(UserId, [WeakView](const FWonderlandSocialProfileView& Card)
	{
		if (const TSharedPtr<SWonderlandSocialLffView> View = WeakView.Pin())
		{
			View->PendingProfileCard = Card;
			View->bProfileOpenPending = true;
		}
	});
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeTitle(const FString& Title)
{
	return SNew(STextBlock).Text(WonderlandLffLook::LffText(Title)).Font(WonderlandUi::Sans(9, true, 220)).ColorAndOpacity(WonderlandUi::Gold(0.80f));
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeLine(const FString& Text, bool bWarn)
{
	return SNew(SBox).Padding(FMargin(4.0f, 6.0f, 4.0f, 10.0f))
		[
			SNew(STextBlock).Text(WonderlandLffLook::LffText(Text)).Font(WonderlandUi::Sans(10, false, 40))
			.ColorAndOpacity(bWarn ? WonderlandUi::Coral(0.90f) : WonderlandUi::Dim()).AutoWrapText(true)
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeButton(const FString& Label, bool bAllowed, bool bQuiet, TFunction<void()> OnClick)
{
	return SNew(SBox).Padding(FMargin(3.0f, 0.0f))
		[
			SNew(SButton).ButtonStyle(bQuiet ? &QuietStyle : &ButtonStyle).IsFocusable(false).IsEnabled(bAllowed)
			.ToolTipText(WonderlandLffLook::LffText(bAllowed ? FString() : FString(TEXT("Not available to you"))))
			.OnClicked_Lambda([OnClick]()
			{
				if (OnClick)
				{
					OnClick();
				}
				return FReply::Handled();
			})
			[
				SNew(STextBlock).Text(WonderlandLffLook::LffText(Label)).Font(WonderlandUi::Sans(bQuiet ? 8 : 9, true, 150))
				.ColorAndOpacity(bQuiet ? WonderlandUi::Dim(bAllowed ? 1.0f : 0.35f) : WonderlandUi::Cream(bAllowed ? 0.92f : 0.35f))
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeFieldLabel(const FString& Label, EWonderlandLffField Field, int32 Max)
{
	// A COUNTER THAT FOLLOWS THE TYPING (read at paint from the model's draft: no rebuild), red past the bound
	const TWeakPtr<FWonderlandLffModel> WeakModel = Model;
	const bool bItems = Field == EWonderlandLffField::Skills;
	const auto Used = [WeakModel, Field, bItems]() -> int32
	{
		const TSharedPtr<FWonderlandLffModel> Pinned = WeakModel.Pin();
		if (!Pinned.IsValid())
		{
			return 0;
		}
		const FString Text = Pinned->GetFieldText(Field);
		return bItems ? WonderlandLff::SplitSkills(Text).Num() : WonderlandLff::CodePoints(Text.TrimStartAndEnd());
	};
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Bottom)
		[
			SNew(STextBlock).Text(WonderlandLffLook::LffText(Label)).Font(WonderlandUi::Sans(8, true, 140)).ColorAndOpacity(WonderlandUi::Dim())
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Bottom)
		[
			SNew(STextBlock).Font(WonderlandUi::Sans(8, false, 40))
			.Text_Lambda([Used, Max, bItems]() { return FText::FromString(FString::Printf(TEXT("%d / %d%s"), Used(), Max, bItems ? TEXT(" skills") : TEXT(""))); })
			.ColorAndOpacity_Lambda([Used, Max]() { return FSlateColor(Used() > Max ? WonderlandUi::Coral() : WonderlandUi::Dim()); })
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeConfirmRow(const FString& Question, const FString& ConfirmLabel)
{
	// A LASTING CHANGE WAITS FOR ITS OWN, EXPLICIT PRESS
	return SNew(SBorder).BorderImage(&RowSelectedBrush).Padding(FMargin(10.0f, 8.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(WonderlandLffLook::LffText(Question)).Font(WonderlandUi::Sans(10, false, 40)).ColorAndOpacity(WonderlandUi::Cream()).AutoWrapText(true)
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f).HAlign(HAlign_Right)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(ConfirmLabel, !Model->IsWriting(), false, [this]() { Model->ConfirmPending(); })]
				+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("CANCEL"), true, true, [this]() { Model->CancelConfirm(); })]
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeContent()
{
	if (!Model.IsValid())
	{
		return MakeLine(TEXT("The Looking For Feed is not available here."));
	}
	TSharedRef<SWidget> Body = SNew(SBox);
	if (bDevelopmentPreview || Model->NeedsLive())
	{
		bBuiltNeedsLive = true;
		Body = MakeNeedsLive();
	}
	else
	{
		switch (Model->GetPane())
		{
		case EWonderlandLffPane::Form:       Body = MakeForm(); break;
		case EWonderlandLffPane::MyPosts:    Body = MakeSplit(MakeMyPostsList()); break;
		case EWonderlandLffPane::MyRequests: Body = MakeSplit(MakeMyRequestsList()); break;
		default:                             Body = MakeSplit(MakeFeedList()); break;
		}
	}
	const TWeakPtr<FWonderlandLffModel> WeakModel = Model;
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()[MakeHeader()]
		// THE LAST ANSWER, for every pane (a 429 says how long to wait)
		+ SVerticalBox::Slot().AutoHeight().Padding(4.0f, 6.0f, 4.0f, 8.0f)
		[
			SNew(STextBlock).Font(WonderlandUi::Sans(9, false, 60)).ColorAndOpacity(WonderlandUi::Cream(0.80f)).AutoWrapText(true)
			.Text_Lambda([WeakModel]()
			{
				const TSharedPtr<FWonderlandLffModel> Pinned = WeakModel.Pin();
				return FText::FromString(Pinned.IsValid() ? Pinned->GetActionLine() : FString());
			})
		]
		+ SVerticalBox::Slot().FillHeight(1.0f)[Body];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeHeader()
{
	const EWonderlandLffPane Pane = Model->GetPane();
	const bool bLive = !bDevelopmentPreview && !Model->NeedsLive();
	const bool bIdle = bLive && !Model->IsWriting();
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
		[
			SNew(STextBlock).Text(WonderlandLffLook::LffText(TEXT("LOOKING FOR FEED"))).Font(WonderlandUi::Sans(10, true, 240)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
		];
	// THE PANES: the showing one is the plain button, the others quiet (as the hub's presence choices)
	const TPair<EWonderlandLffPane, const TCHAR*> Panes[] = {
		{EWonderlandLffPane::Feed, TEXT("FEED")}, {EWonderlandLffPane::MyPosts, TEXT("MY POSTS")}, {EWonderlandLffPane::MyRequests, TEXT("MY REQUESTS")}};
	for (const TPair<EWonderlandLffPane, const TCHAR*>& Entry : Panes)
	{
		const EWonderlandLffPane Which = Entry.Key;
		Row->AddSlot().AutoWidth().VAlign(VAlign_Center)[MakeButton(Entry.Value, bLive, Pane != Which, [this, Which]() { Model->SetPane(Which); })];
	}
	Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
	[
		MakeButton(TEXT("CREATE POST"), bIdle, Pane != EWonderlandLffPane::Form || Model->IsEditingForm(), [this]() { Model->StartCreate(); })
	];
	Row->AddSlot().AutoWidth().VAlign(VAlign_Center)[MakeButton(TEXT("REFRESH"), bLive, true, [this]() { Model->Reload(); })];
	return Row;
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeNeedsLive()
{
	// THE HONEST STATE (the contract: the preview shows NO LFF people and NO LFF posts): never an example post, never a made-up person
	return SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center).MaxDesiredWidth(560.0f)
		[
			SNew(STextBlock)
			.Text(WonderlandLffLook::LffText(TEXT("The Looking For Feed needs a live connection.\nSign in to Wonderland social to browse posts, ask to join and post your own. The DEVELOPMENT PREVIEW has no LFF people and no posts.")))
			.Font(WonderlandUi::Sans(12, false, 40)).ColorAndOpacity(WonderlandUi::Cream(0.80f)).Justification(ETextJustify::Center).AutoWrapText(true)
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeSplit(const TSharedRef<SWidget>& List)
{
	// THE MESSAGES TAB'S SHAPE: a list beside the open one
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth()
		[
			SNew(SBox).WidthOverride(390.0f)[List]
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(14.0f, 0.0f, 0.0f, 0.0f)
		[
			MakeDetail()
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeFeedList()
{
	// THE CATEGORIES: ALL or one of the six (a category is a token the server filters by)
	TSharedRef<SWrapBox> Categories = SNew(SWrapBox).UseAllottedSize(true).InnerSlotPadding(FVector2D(2.0, 4.0));
	const FString Current = Model->GetCategory();
	Categories->AddSlot()[MakeButton(TEXT("ALL"), true, !Current.IsEmpty(), [this]() { Model->SetCategory(FString()); })];
	for (const FString& Category : WonderlandLffCategories())
	{
		Categories->AddSlot()[MakeButton(WonderlandLffCategoryLabel(Category).ToUpper(), true, Current != Category, [this, Category]() { Model->SetCategory(Category); })];
	}
	TSharedRef<SScrollBox> List = SNew(SScrollBox);
	ListScroll = List;   // B35: its offset is kept across rebuilds (Rebuild)
	const FString PaneLine = Model->PaneLine(EWonderlandLffPane::Feed);
	if (!PaneLine.IsEmpty())
	{
		List->AddSlot()[MakeLine(PaneLine, Model->GetLoad(EWonderlandLffPane::Feed) == EWonderlandLffLoad::Failed)];
	}
	// B35: NO POST CARD (a title, an author's name) from a feed read before the hub was opened: the pane line says "Updating…" instead
	if (!Model->IsPaneWithheld(EWonderlandLffPane::Feed))
	{
		for (const FWonderlandLffPost& Post : Model->GetFeed())
		{
			List->AddSlot()[MakePostCard(Post)];
		}
	}
	if (Model->CanLoadMore())   // never while withheld (CanLoadMore)
	{
		List->AddSlot().Padding(0.0f, 6.0f)[MakeButton(TEXT("LOAD MORE"), true, true, [this]() { Model->LoadMore(); })];
	}
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()[Categories]
		// THE FILTERS GO TO THE SERVER (APPLY, or Enter in either box): it filters every page, never only the page on screen. "Has open
		// slots" needs no control here: the general feed lists OPEN posts only (r2); MY POSTS has OPEN ONLY.
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 4.0f, 0.0f)[PlaceBox(EWonderlandLffField::ProjectFilter)]
			+ SHorizontalBox::Slot().FillWidth(1.0f)[PlaceBox(EWonderlandLffField::SkillFilter)]
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 6.0f).HAlign(HAlign_Right)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("APPLY"), true, false, [this]() { Model->ApplyFilters(); })]
			+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("CLEAR"), Model->HasAppliedFilters(), true, [this]() { Model->ClearFilters(); })]
		]
		+ SVerticalBox::Slot().FillHeight(1.0f)[List];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeMyPostsList()
{
	const bool bOpenOnly = Model->IsMineOpenOnly();
	// B35: withheld until a read after the open lands -- no card, no count (one rule for every pane)
	const bool bWithheld = Model->IsPaneWithheld(EWonderlandLffPane::MyPosts);
	TSharedRef<SScrollBox> List = SNew(SScrollBox);
	ListScroll = List;
	List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 6.0f)
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
		[
			MakeTitle(bWithheld ? FString(TEXT("YOUR POSTS")) : FString::Printf(TEXT("YOUR POSTS  —  %d"), Model->GetMyPosts().Num()))
		]
		// THE OPEN-SLOTS FILTER (the server's hasOpenSlots): ALL, or OPEN ONLY
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("ALL"), true, bOpenOnly, [this]() { Model->SetMineOpenOnly(false); })]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("OPEN ONLY"), true, !bOpenOnly, [this]() { Model->SetMineOpenOnly(true); })]
	];
	const FString PaneLine = Model->PaneLine(EWonderlandLffPane::MyPosts);
	if (!PaneLine.IsEmpty())
	{
		List->AddSlot()[MakeLine(PaneLine, Model->GetLoad(EWonderlandLffPane::MyPosts) == EWonderlandLffLoad::Failed)];
	}
	if (!bWithheld)
	{
		for (const FWonderlandLffPost& Post : Model->GetMyPosts())
		{
			List->AddSlot()[MakePostCard(Post)];
		}
	}
	if (Model->CanLoadMoreMine())   // never while withheld (CanLoadMoreMine)
	{
		List->AddSlot().Padding(0.0f, 6.0f)[MakeButton(TEXT("LOAD MORE"), true, true, [this]() { Model->LoadMoreMine(); })];
	}
	return List;
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeMyRequestsList()
{
	TSharedRef<SScrollBox> List = SNew(SScrollBox);
	ListScroll = List;
	// B35: each row names another player's post (its title, its state): withheld until a read after the open lands -- no row, no tombstone,
	// no count; the pane line says "Updating…" (or why the read failed)
	const bool bWithheld = Model->IsPaneWithheld(EWonderlandLffPane::MyRequests);
	List->AddSlot().Padding(0.0f, 0.0f, 0.0f, 6.0f)
	[
		MakeTitle(bWithheld ? FString(TEXT("YOUR REQUESTS")) : FString::Printf(TEXT("YOUR REQUESTS  —  %d"), Model->GetMyRequests().Num()))
	];
	const FString PaneLine = Model->PaneLine(EWonderlandLffPane::MyRequests);
	if (!PaneLine.IsEmpty())
	{
		List->AddSlot()[MakeLine(PaneLine, Model->GetLoad(EWonderlandLffPane::MyRequests) == EWonderlandLffLoad::Failed)];
	}
	if (bWithheld)
	{
		return List;
	}
	const bool bIdle = !Model->IsWriting();
	for (const FWonderlandLffMyRequest& Request : Model->GetMyRequests())
	{
		const FString RequestId = Request.RequestId;
		const FString PostId = Request.PostId;
		const bool bAccepted = Request.Status == TEXT("ACCEPTED");
		// THE ROW SAYS WHERE IT STANDS; the connect actions live in the post's detail (OPEN), where there is room for them (m12)
		TSharedRef<SHorizontalBox> Actions = SNew(SHorizontalBox);
		if (Request.bHasPost)
		{
			Actions->AddSlot().AutoWidth()[MakeButton(Request.Status == TEXT("DECLINED") ? TEXT("OPEN · ASK AGAIN") : TEXT("OPEN"), true, false,
				[this, PostId]() { Model->OpenPost(PostId); })];
		}
		if (bAccepted)
		{
			// LEAVE frees the slot: it waits for CONFIRM (m7), the same word here and in the detail
			Actions->AddSlot().AutoWidth()[MakeButton(TEXT("LEAVE"), bIdle, true, [this, RequestId]() { Model->AskConfirm(EWonderlandLffConfirm::Leave, RequestId); })];
		}
		else if (Request.Status != TEXT("DECLINED"))
		{
			Actions->AddSlot().AutoWidth()[MakeButton(TEXT("WITHDRAW"), bIdle, true, [this, RequestId]() { Model->Withdraw(RequestId); })];
		}
		const FString When = WonderlandSocialHubLook::Ago(Request.UpdatedAtIso);
		const FString Title = Request.bHasPost ? Request.Post.Title : FString(TEXT("A post you can no longer see"));
		const bool bConfirming = Model->GetConfirm() == EWonderlandLffConfirm::Leave && Model->GetConfirmSubject() == RequestId;
		BuiltRequestRows += 1;
		List->AddSlot().Padding(0.0f, 3.0f)
		[
			SNew(SBorder).BorderImage(PostId == Model->GetOpenPostId() ? &RowSelectedBrush : &RowBrush).Padding(FMargin(10.0f, 8.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(STextBlock).Text(WonderlandLffLook::LffText(Title)).Font(WonderlandUi::Sans(11, true)).ColorAndOpacity(WonderlandUi::Cream()).AutoWrapText(true)
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 4.0f)
				[
					SNew(STextBlock).Text(WonderlandLffLook::LffText(When.IsEmpty() ? WonderlandLff::RequesterWord(Request.Status)
						: FString::Printf(TEXT("%s  ·  %s"), *WonderlandLff::RequesterWord(Request.Status), *When)))
					.Font(WonderlandUi::Sans(9, true, 100)).ColorAndOpacity(bAccepted ? WonderlandUi::Green() : WonderlandUi::Gold(0.85f))
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)[Actions]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
				[
					bConfirming ? MakeConfirmRow(TEXT("Leave this post? Your slot frees up; to come back you must ask again and be accepted."), TEXT("CONFIRM LEAVE"))
						: StaticCastSharedRef<SWidget>(SNew(SBox))
				]
			]
		];
	}
	// A REQUEST IT KNEW AND NO LONGER FINDS (the post deleted, or out of sight): the same words for both, never the old title, never why
	for (const FString& Gone : Model->GetVanished())
	{
		const FString RequestId = Gone;
		BuiltRequestRows += 1;
		List->AddSlot().Padding(0.0f, 3.0f)
		[
			SNew(SBorder).BorderImage(&RowBrush).Padding(FMargin(10.0f, 8.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(WonderlandLffLook::LffText(WonderlandLffLook::VanishedTitle)).Font(WonderlandUi::Sans(11, true)).ColorAndOpacity(WonderlandUi::Cream(0.60f))
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(WonderlandLffLook::LffText(TEXT("No longer available"))).Font(WonderlandUi::Sans(9, true, 100)).ColorAndOpacity(WonderlandUi::Dim())
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[MakeButton(TEXT("DISMISS"), true, true, [this, RequestId]() { Model->DismissVanished(RequestId); })]
			]
		];
	}
	return List;
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakePostCard(const FWonderlandLffPost& Post)
{
	BuiltPostCards += 1;
	const bool bOpen = Post.PostId == Model->GetOpenPostId();
	const FString PostId = Post.PostId;
	// what it is: the category, the project, the skills; who and when
	TArray<FString> About;
	About.Add(Post.CategoryLabel);
	if (!Post.ProjectLabel.IsEmpty())
	{
		About.Add(Post.ProjectLabel);
	}
	if (Post.Skills.Num() > 0)
	{
		About.Add(FString::Join(Post.Skills, TEXT(", ")));
	}
	const FString Posted = WonderlandSocialHubLook::Ago(Post.CreatedAtIso);
	const FString By = Post.bViewerIsOwner ? FString(TEXT("your post")) : FString::Printf(TEXT("by %s"), *Post.Author.DisplayName);
	const FString State = Post.Status == TEXT("OPEN") ? FString::Printf(TEXT("OPEN  ·  %d"), Post.OpenSlots) : Post.Status;
	const FString Mine = Post.bHasViewerRequest ? FString::Printf(TEXT("your request: %s"), *WonderlandLff::RequesterWord(Post.ViewerRequestStatus)) : FString();
	return SNew(SBox).Padding(FMargin(0.0f, 3.0f))
		[
			SNew(SButton).ButtonStyle(&QuietStyle).IsFocusable(false).ContentPadding(0.0f)
			.OnClicked_Lambda([this, PostId]() { Model->OpenPost(PostId); return FReply::Handled(); })
			[
				SNew(SBorder).BorderImage(bOpen ? &RowSelectedBrush : &RowBrush).Padding(FMargin(10.0f, 8.0f))
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Top)
						[
							SNew(STextBlock).Text(WonderlandLffLook::LffText(Post.Title)).Font(WonderlandUi::Sans(11, true)).ColorAndOpacity(WonderlandUi::Cream()).AutoWrapText(true)
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Top).Padding(8.0f, 0.0f, 0.0f, 0.0f)
						[
							SNew(SBorder).BorderImage(&PillBrush).Padding(FMargin(7.0f, 1.0f))
							[
								SNew(STextBlock).Text(WonderlandLffLook::LffText(State)).Font(WonderlandUi::Sans(8, true, 120))
								.ColorAndOpacity(Post.Status == TEXT("OPEN") ? WonderlandUi::Gold() : WonderlandUi::Dim())
							]
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(WonderlandLffLook::LffText(FString::Join(About, TEXT("  ·  ")))).Font(WonderlandUi::Sans(9, false, 40))
						.ColorAndOpacity(WonderlandUi::Cream(0.70f)).AutoWrapText(true)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(WonderlandLffLook::LffText(Posted.IsEmpty() ? By : FString::Printf(TEXT("%s  ·  %s"), *By, *Posted)))
						.Font(WonderlandUi::Sans(8, false, 40)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Visibility(Mine.IsEmpty() ? EVisibility::Collapsed : EVisibility::Visible)
						.Text(WonderlandLffLook::LffText(Mine)).Font(WonderlandUi::Sans(8, true, 100)).ColorAndOpacity(WonderlandUi::Gold(0.85f))
					]
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakePerson(const FWonderlandSocialPersonRow& Person, const FString& Second, const TSharedRef<SWidget>& Actions)
{
	// THE HUB'S PERSON ROW, smaller: avatar, name and handle, presence as the authority sent it, a second line, the actions
	const FWonderlandSocialPresence& P = Person.Presence;
	const FString Handle = Person.Handle.IsEmpty() || Person.Handle.StartsWith(TEXT("@")) ? Person.Handle : FString::Printf(TEXT("@%s"), *Person.Handle);
	BuiltPersonRows += 1;
	return SNew(SBox).Padding(FMargin(0.0f, 3.0f))
		[
			SNew(SBorder).BorderImage(&RowBrush).Padding(FMargin(10.0f, 7.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
				[
					SNew(SWonderlandSocialAvatar).Size(38.0f).Seed(Person.UserId).Initial(WonderlandSocialHubLook::Initial(Person.DisplayName))
					.Ring(WonderlandSocialHubLook::StateDot(P))
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						// the name wraps rather than being cut under the actions (m12)
						SNew(STextBlock).Text(WonderlandLffLook::LffText(Handle.IsEmpty() ? Person.DisplayName : FString::Printf(TEXT("%s   %s"), *Person.DisplayName, *Handle)))
						.Font(WonderlandUi::Sans(11, true)).ColorAndOpacity(WonderlandUi::Cream()).AutoWrapText(true)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(WonderlandLffLook::LffText(WonderlandSocialHubLook::PresenceLine(P))).Font(WonderlandUi::Sans(8, true, 80))
						.ColorAndOpacity(WonderlandUi::Cream(0.70f)).AutoWrapText(true)
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 2.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Visibility(Second.IsEmpty() ? EVisibility::Collapsed : EVisibility::Visible)
						.Text(WonderlandLffLook::LffText(Second)).Font(WonderlandUi::Sans(9, false, 40)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
				[
					Actions
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeConnectActions(const FWonderlandSocialPersonRow& Person)
{
	// THE EXISTING ACTIONS, by their own operation ids, each as the authority allowed it: an accept grants NOTHING (contract, "Connect after
	// accept"). Add Friend runs the friend-request rules, Message the other's message policy, Invite the party's friends-only rule.
	const FString UserId = Person.UserId;
	if (UserId.IsEmpty() || UserId == ViewerId)
	{
		return SNew(SBox);
	}
	const FWonderlandSocialActions& Can = Person.Presence.Can;
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("ADD FRIEND"), Can.bSendFriendRequest, false, [this, UserId]() { OnAction.ExecuteIfBound(TEXT("requests.send"), UserId); })]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("MESSAGE"), Can.bMessage, false, [this, UserId]() { OnAction.ExecuteIfBound(TEXT("conversations.open"), UserId); })]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("INVITE"), Can.bInviteToParty, false, [this, UserId]() { OnAction.ExecuteIfBound(TEXT("parties.invite"), UserId); })];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeDetail()
{
	// B35: A DETAIL READ BEFORE THE HUB WAS OPENED is not drawn -- not its author, the author's card (PROFILE), the accepted people or the
	// owner's requesters: the line says "Updating…", or why the read after the open failed
	if (!Model->HasDetail() || Model->IsDetailWithheld())
	{
		const FString Line = Model->DetailLine();
		const bool bWaiting = Line.StartsWith(TEXT("Loading")) || Line.Equals(WonderlandLffModelDetail::UpdatingLine, ESearchCase::CaseSensitive);
		return SNew(SBorder).BorderImage(&PaneBrush).Padding(14.0f)
			[
				MakeLine(Line, !Model->GetOpenPostId().IsEmpty() && !bWaiting)
			];
	}
	const FWonderlandLffPostDetail& Detail = Model->GetDetail();
	const FWonderlandLffPost& Post = Detail.Post;
	TSharedRef<SScrollBox> Body = SNew(SScrollBox);
	DetailScroll = Body;
	Body->AddSlot()
	[
		SNew(STextBlock).Text(WonderlandLffLook::LffText(Post.Title)).Font(WonderlandUi::Sans(15, true)).ColorAndOpacity(WonderlandUi::Cream()).AutoWrapText(true)
	];
	// WHAT IT IS AND WHERE IT STANDS: the category, the status, how many are looked for (and, to the owner only, how many slots are left)
	FString Meta = FString::Printf(TEXT("%s  ·  %s  ·  looking for %d"), *Post.CategoryLabel, *Post.Status, Post.OpenSlots);
	if (Post.AvailableSlots >= 0)
	{
		Meta += FString::Printf(TEXT(" (%d still open)"), Post.AvailableSlots);
	}
	const FString Posted = WonderlandSocialHubLook::Ago(Post.CreatedAtIso);
	if (!Posted.IsEmpty())
	{
		Meta += FString::Printf(TEXT("  ·  posted %s"), *Posted);
	}
	const FString Expiry = Post.Status == TEXT("OPEN") ? WonderlandSocialHubLook::ExpiresIn(Post.ExpiresAtIso) : FString();
	if (!Expiry.IsEmpty())
	{
		Meta += FString::Printf(TEXT("  ·  %s"), *Expiry);
	}
	Body->AddSlot().Padding(0.0f, 4.0f, 0.0f, 8.0f)
	[
		SNew(STextBlock).Text(WonderlandLffLook::LffText(Meta)).Font(WonderlandUi::Sans(9, true, 80)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
	];
	const auto Labelled = [](const FString& Label, const FString& Value)
	{
		return SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Top).Padding(0.0f, 1.0f, 10.0f, 0.0f)
			[
				SNew(STextBlock).Text(WonderlandLffLook::LffText(Label)).Font(WonderlandUi::Sans(8, true, 140)).ColorAndOpacity(WonderlandUi::Dim())
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f)
			[
				SNew(STextBlock).Text(WonderlandLffLook::LffText(Value)).Font(WonderlandUi::Sans(10)).ColorAndOpacity(WonderlandUi::Cream(0.90f)).AutoWrapText(true)
			];
	};
	if (!Post.ProjectLabel.IsEmpty())
	{
		Body->AddSlot().Padding(0.0f, 2.0f)[Labelled(TEXT("PROJECT / ACTIVITY"), Post.ProjectLabel)];
	}
	if (Post.Skills.Num() > 0)
	{
		Body->AddSlot().Padding(0.0f, 2.0f)[Labelled(TEXT("SKILLS"), FString::Join(Post.Skills, TEXT("  ·  ")))];
	}
	if (!Post.Description.IsEmpty())
	{
		Body->AddSlot().Padding(0.0f, 8.0f, 0.0f, 4.0f)
		[
			SNew(STextBlock).Text(WonderlandLffLook::LffText(Post.Description)).Font(WonderlandUi::Sans(11)).ColorAndOpacity(WonderlandUi::Cream()).AutoWrapText(true)
		];
	}
	// THE AUTHOR, always (a post is shown only to a viewer who may see its author): their card through the existing profile panel, and
	// REPORT through the existing report flow (the post as its subject)
	TSharedRef<SHorizontalBox> AuthorActions = SNew(SHorizontalBox);
	const FString AuthorPostId = Post.PostId;
	AuthorActions->AddSlot().AutoWidth()[MakeButton(TEXT("PROFILE"), Detail.bHasAuthorProfile, false, [this, AuthorPostId]()
	{
		// B35: THE CARD AS THE MODEL HOLDS IT AT THE PRESS (never one kept in this button), and only while that post's detail is not withheld:
		// a gate begun after this button was built, before the view's rebuild, opens no card
		if (Model.IsValid() && Model->HasDetail() && !Model->IsDetailWithheld() && Model->GetDetail().Post.PostId == AuthorPostId
			&& Model->GetDetail().bHasAuthorProfile)
		{
			const FWonderlandSocialProfileView Card = Model->GetDetail().AuthorProfile;   // a copy: opening the card may change what the model holds
			OnOpenProfileView.ExecuteIfBound(Card);
		}
	})];
	if (!Post.bViewerIsOwner)
	{
		AuthorActions->AddSlot().AutoWidth()[MakeButton(TEXT("REPORT"), Post.Author.Presence.Can.bReport && !Model->IsWriting(), true, [this]() { Model->ReportOpenPost(); })];
	}
	Body->AddSlot().Padding(0.0f, 10.0f, 0.0f, 2.0f)[MakeTitle(TEXT("POSTED BY"))];
	Body->AddSlot()[MakePerson(Post.Author, Post.bViewerIsOwner ? FString(TEXT("you")) : FString(), AuthorActions)];
	Body->AddSlot().Padding(0.0f, 12.0f, 0.0f, 0.0f)[Post.bViewerIsOwner ? MakeOwnerSection(Post) : MakeViewerSection(Detail)];
	// THE ACCEPTED LIST, for an accepted viewer (the owner's is the inbox's ACCEPTED rows): only those they may see; each person through the
	// existing connect actions
	if (Detail.bHasAccepted && !Post.bViewerIsOwner)
	{
		Body->AddSlot().Padding(0.0f, 12.0f, 0.0f, 4.0f)[MakeTitle(FString::Printf(TEXT("ACCEPTED  —  %d"), Detail.Accepted.Num()))];
		for (const FWonderlandSocialPersonRow& Person : Detail.Accepted)
		{
			Body->AddSlot()[MakePerson(Person, Person.UserId == ViewerId ? FString(TEXT("you")) : FString(), MakeConnectActions(Person))];
		}
	}
	return SNew(SBorder).BorderImage(&PaneBrush).Padding(14.0f)[Body];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeOwnerSection(const FWonderlandLffPost& Post)
{
	const bool bIdle = !Model->IsWriting();
	const bool bOpen = Post.Status == TEXT("OPEN");
	TSharedRef<SVerticalBox> Section = SNew(SVerticalBox);
	Section->AddSlot().AutoHeight()
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("EDIT"), bIdle && bOpen, false, [this]() { Model->StartEdit(); })]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("CLOSE POST"), bIdle && bOpen, false, [this]() { Model->AskConfirm(EWonderlandLffConfirm::Close); })]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("DELETE POST"), bIdle, true, [this]() { Model->AskConfirm(EWonderlandLffConfirm::Delete); })]
	];
	const EWonderlandLffConfirm Confirm = Model->GetConfirm();
	if ((Confirm == EWonderlandLffConfirm::Close || Confirm == EWonderlandLffConfirm::Delete) && Model->GetConfirmSubject() == Post.PostId)
	{
		const bool bClose = Confirm == EWonderlandLffConfirm::Close;
		Section->AddSlot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
		[
			MakeConfirmRow(bClose ? FString(TEXT("Close this post? Nobody new can ask to join. You and the people you accepted still see it."))
				: FString(TEXT("Delete this post and every request to it? This cannot be undone.")), bClose ? TEXT("CONFIRM CLOSE") : TEXT("CONFIRM DELETE"))
		];
	}
	// THE INBOX: pending requests to accept or decline, accepted people to connect with (through the existing actions); each requester's
	// PROFILE through the existing profile.read (m4)
	const FWonderlandLffPostRequests& Inbox = Model->GetInbox();
	// B35: REQUESTERS READ BEFORE THE HUB WAS OPENED are not listed (a requester may have blocked the owner since): no row, no count
	const bool bInboxWithheld = Model->IsInboxWithheld();
	Section->AddSlot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 4.0f)
	[
		MakeTitle(bInboxWithheld ? FString(TEXT("REQUESTS"))
			: FString::Printf(TEXT("REQUESTS  —  %d"), Inbox.PostId == Post.PostId ? Inbox.Requests.Num() : 0))
	];
	const FString InboxLine = Model->InboxLine();
	if (!InboxLine.IsEmpty())
	{
		Section->AddSlot().AutoHeight()[MakeLine(InboxLine)];
	}
	if (!bInboxWithheld && Inbox.PostId == Post.PostId)
	{
		for (const FWonderlandLffIncomingRequest& Request : Inbox.Requests)
		{
			const FString RequestId = Request.RequestId;
			const FString UserId = Request.Requester.UserId;
			const bool bPending = Request.Status == TEXT("PENDING");
			const FString When = WonderlandSocialHubLook::Ago(Request.CreatedAtIso);
			FString Second = Request.Status;
			if (!When.IsEmpty())
			{
				Second += FString::Printf(TEXT("  ·  asked %s"), *When);
			}
			if (!Request.Message.IsEmpty())
			{
				Second += FString::Printf(TEXT("  ·  \"%s\""), *Request.Message);
			}
			const TSharedRef<SWidget> Profile = MakeButton(TEXT("PROFILE"), Request.Requester.Presence.Can.bViewProfile, true, [this, UserId]() { OpenProfileOf(UserId); });
			TSharedRef<SWidget> Actions = bPending
				? StaticCastSharedRef<SWidget>(SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("ACCEPT"), bIdle && bOpen, false, [this, RequestId]() { Model->Accept(RequestId); })]
						+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("DECLINE"), bIdle, false, [this, RequestId]() { Model->Decline(RequestId); })]
					]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(0.0f, 4.0f, 0.0f, 0.0f)
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth()[Profile]
						+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("BLOCK"), Request.Requester.Presence.Can.bBlock, true,
							[this, UserId]() { OnAction.ExecuteIfBound(TEXT("blocks.add"), UserId); })]
					])
				: StaticCastSharedRef<SWidget>(SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right)[MakeConnectActions(Request.Requester)]
					+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Right).Padding(0.0f, 4.0f, 0.0f, 0.0f)[Profile]);
			Section->AddSlot().AutoHeight()[MakePerson(Request.Requester, Second, Actions)];
		}
	}
	return Section;
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeAskToJoin(const FString& Label)
{
	// ASK TO JOIN, with an optional note (0-200, one line): the owner decides
	BuiltAskLabel = Label;
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 4.0f)[MakeFieldLabel(TEXT("ASK TO JOIN  (a note is optional)"), EWonderlandLffField::Note, WonderlandLff::MessageMax)]
		+ SVerticalBox::Slot().AutoHeight()[PlaceBox(EWonderlandLffField::Note)]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f).HAlign(HAlign_Right)
		[
			MakeButton(Label, !Model->IsWriting(), false, [this]() { Model->RequestToJoin(); })
		];
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeViewerSection(const FWonderlandLffPostDetail& Detail)
{
	const FWonderlandLffPost& Post = Detail.Post;
	const bool bIdle = !Model->IsWriting();
	const bool bOpen = Post.Status == TEXT("OPEN");
	TSharedRef<SVerticalBox> Section = SNew(SVerticalBox);
	if (!Post.bHasViewerRequest)
	{
		Section->AddSlot().AutoHeight()[bOpen ? MakeAskToJoin(TEXT("REQUEST TO JOIN")) : MakeLine(TEXT("This post is not open."))];
		return Section;
	}
	const FString RequestId = Post.ViewerRequestId;
	const FString& Status = Post.ViewerRequestStatus;
	if (Status == TEXT("PENDING"))
	{
		Section->AddSlot().AutoHeight()[MakeLine(TEXT("Your request is PENDING: the owner decides."))];
		Section->AddSlot().AutoHeight().HAlign(HAlign_Right)[MakeButton(TEXT("WITHDRAW"), bIdle, true, [this, RequestId]() { Model->Withdraw(RequestId); })];
	}
	else if (Status == TEXT("ACCEPTED"))
	{
		// CONNECT AFTER ACCEPT: the existing actions, each with its own checks -- LFF itself grants nothing
		Section->AddSlot().AutoHeight()[MakeLine(TEXT("You were ACCEPTED. Connect the usual way: each action keeps its own rules, and LFF itself grants nothing."))];
		Section->AddSlot().AutoHeight().HAlign(HAlign_Right)[MakeConnectActions(Post.Author)];
		Section->AddSlot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f).HAlign(HAlign_Right)
		[
			MakeButton(TEXT("LEAVE"), bIdle, true, [this, RequestId]() { Model->AskConfirm(EWonderlandLffConfirm::Leave, RequestId); })
		];
		if (Model->GetConfirm() == EWonderlandLffConfirm::Leave && Model->GetConfirmSubject() == RequestId)
		{
			Section->AddSlot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
			[
				MakeConfirmRow(TEXT("Leave this post? Your slot frees up; to come back you must ask again and be accepted."), TEXT("CONFIRM LEAVE"))
			];
		}
	}
	else if (Status == TEXT("DECLINED"))
	{
		// NOT FINAL (m6): the server lets a declined player ask again, under its own rules; the owner decides again
		Section->AddSlot().AutoHeight()[MakeLine(TEXT("Your request was DECLINED. You may ask again; the owner decides."))];
		if (bOpen)
		{
			Section->AddSlot().AutoHeight()[MakeAskToJoin(TEXT("REQUEST AGAIN"))];
		}
	}
	else
	{
		Section->AddSlot().AutoHeight()[MakeLine(TEXT("Your request is NO LONGER AVAILABLE."))];
		Section->AddSlot().AutoHeight().HAlign(HAlign_Right)[MakeButton(TEXT("WITHDRAW"), bIdle, true, [this, RequestId]() { Model->Withdraw(RequestId); })];
	}
	return Section;
}

TSharedRef<SWidget> SWonderlandSocialLffView::MakeForm()
{
	const FWonderlandLffDraft& Draft = Model->GetDraft();
	const bool bEditing = Model->IsEditingForm();
	const bool bIdle = !Model->IsWriting();
	TSharedRef<SWrapBox> Categories = SNew(SWrapBox).UseAllottedSize(true).InnerSlotPadding(FVector2D(2.0, 4.0));
	for (const FString& Category : WonderlandLffCategories())
	{
		Categories->AddSlot()[MakeButton(WonderlandLffCategoryLabel(Category).ToUpper(), true, Draft.Category != Category, [this, Category]() { Model->SetDraftCategory(Category); })];
	}
	const TWeakPtr<FWonderlandLffModel> WeakModel = Model;
	TSharedRef<SScrollBox> Form = SNew(SScrollBox);
	FormScroll = Form;
	Form->AddSlot()[MakeTitle(bEditing ? TEXT("EDIT YOUR POST") : TEXT("CREATE A POST"))];
	Form->AddSlot().Padding(0.0f, 4.0f, 0.0f, 10.0f)
	[
		SNew(STextBlock).Text(WonderlandLffLook::LffText(TEXT("Say who you are looking for. Signed-in players who may see you find it in the feed while it is open; you choose whom to accept. A project here is a label only.")))
		.Font(WonderlandUi::Sans(9, false, 40)).ColorAndOpacity(WonderlandUi::Dim()).AutoWrapText(true)
	];
	Form->AddSlot()[SNew(STextBlock).Text(WonderlandLffLook::LffText(TEXT("CATEGORY"))).Font(WonderlandUi::Sans(8, true, 140)).ColorAndOpacity(WonderlandUi::Dim())];
	Form->AddSlot().Padding(0.0f, 4.0f, 0.0f, 10.0f)[Categories];
	Form->AddSlot()[MakeFieldLabel(TEXT("TITLE"), EWonderlandLffField::Title, WonderlandLff::TitleMax)];
	Form->AddSlot().Padding(0.0f, 3.0f, 0.0f, 10.0f)[PlaceBox(EWonderlandLffField::Title)];
	Form->AddSlot()[MakeFieldLabel(TEXT("DESCRIPTION  (one paragraph, optional)"), EWonderlandLffField::Description, WonderlandLff::DescriptionMax)];
	Form->AddSlot().Padding(0.0f, 3.0f, 0.0f, 10.0f)[PlaceBox(EWonderlandLffField::Description)];
	Form->AddSlot()[MakeFieldLabel(TEXT("PROJECT / ACTIVITY  (a label only, optional)"), EWonderlandLffField::Project, WonderlandLff::ProjectMax)];
	Form->AddSlot().Padding(0.0f, 3.0f, 0.0f, 10.0f)[PlaceBox(EWonderlandLffField::Project)];
	Form->AddSlot()[MakeFieldLabel(FString::Printf(TEXT("SKILLS  (comma-separated, each up to %d characters, optional)"), WonderlandLff::SkillMax), EWonderlandLffField::Skills, WonderlandLff::SkillsMax)];
	Form->AddSlot().Padding(0.0f, 3.0f, 0.0f, 10.0f)[PlaceBox(EWonderlandLffField::Skills)];
	Form->AddSlot()[SNew(STextBlock).Text(WonderlandLffLook::LffText(TEXT("OPEN SLOTS  (how many people)"))).Font(WonderlandUi::Sans(8, true, 140)).ColorAndOpacity(WonderlandUi::Dim())];
	Form->AddSlot().Padding(0.0f, 4.0f, 0.0f, 10.0f)
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[MakeButton(TEXT("-"), Draft.OpenSlots > WonderlandLff::SlotsMin, false, [this]() { Model->AdjustSlots(-1); })]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f)
		[
			SNew(STextBlock).Font(WonderlandUi::Sans(13, true)).ColorAndOpacity(WonderlandUi::Cream())
			.Text_Lambda([WeakModel]()
			{
				const TSharedPtr<FWonderlandLffModel> Pinned = WeakModel.Pin();
				return FText::AsNumber(Pinned.IsValid() ? Pinned->GetDraft().OpenSlots : 0);
			})
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)[MakeButton(TEXT("+"), Draft.OpenSlots < WonderlandLff::SlotsMax, false, [this]() { Model->AdjustSlots(1); })]
	];
	// WHY IT CANNOT BE SENT (checked here first; the server's own refusal lands here too), then the two choices
	if (!Model->GetFormProblem().IsEmpty())
	{
		Form->AddSlot()[MakeLine(Model->GetFormProblem(), true)];
	}
	Form->AddSlot().Padding(0.0f, 4.0f, 0.0f, 0.0f).HAlign(HAlign_Right)
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(bEditing ? TEXT("SAVE CHANGES") : TEXT("CREATE POST"), bIdle, false, [this]() { Model->SubmitForm(); })]
		+ SHorizontalBox::Slot().AutoWidth()[MakeButton(TEXT("CANCEL"), true, true, [this]() { Model->CancelForm(); })]
	];
	return SNew(SBorder).BorderImage(&PaneBrush).Padding(16.0f)[Form];
}

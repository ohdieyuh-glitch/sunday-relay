// wl.Qa.SocialLff -- LFF (the Looking For Feed) in the client: deterministic checks with fail-capable controls. No network: answers are
// fed by a stand-in service that holds each call until the check answers it, or refused by a throwaway live service on a dead loopback
// port (127.0.0.1:9; nothing listens, never a real server). Nothing here is drawn on screen: the hubs it builds are off-screen, and no
// synthetic post or person reaches a surface a player sees.
//
//   LP1-LP8   the strict parsers (feed, post, detail, the viewer's requests, the owner's inbox), each refusal beside an accepted control
//   LQ1-LQ5   filters go to the SERVER, percent-encoded ('Wonder Web+' -> 'Wonder%20Web%2B'), never filtered over a loaded page
//   LD1-LD3   dispatch: an unsafe id, an unknown action or a bad query is refused before sending; the preview answers "needs a live
//             connection" with no posts
//   LV1-LV5   the form's and the note's checks (lengths in code points, control characters refused, built from code points)
//   LS1-LS23  the state machine: loading, empty, error and permission states (503, 429 + Retry-After, 403, 401, unreachable, 404), an
//             older answer dropped, a vanished request kept by id only and replaced when listed again, a reset drops one player's state;
//             create / request / delete / accept (LS8-LS12), DECLINE (LS13), CLOSE (LS14), a 409 in the server's sentence (LS15), EDIT
//             (LS16), LOAD MORE (LS17), a 429 holding only its own kind (LS18, LS18B), MY POSTS open-only + paging (LS19), a requester's PROFILE
//             (LS20), REQUEST AGAIN after a decline (LS21), LEAVE with confirm (LS22), no fold of loaded pages on a change (LS23)
//   LG1-LG7   B35 (R16 privacy, SC1) the open gate: after BeginOpenGate a list read before the open is withheld ("Updating", no id in
//             Describe) until a read ASKED after it lands (LG1, LG3); a read asked before that lands after never lifts it (LG2); a failed
//             read keeps it withheld and says why (LG4); a further page never lifts it and LOAD MORE asks nothing (LG5); the open post,
//             the owner's inbox and a requester's card (LG6); as built by the view: no post card, no person row (LG7)
//   LG14      R3-01 the "lff read landed" line lists the post a feed page fed and its author
//   LG8-LG13  B35 the open surface's period and age: a read asked 4.5 s ago is withheld, 3.0 s ago drawn (LG8); re-read 2.0 s after the
//             last ask, one at a time (LG9); a failed read backs off and a 429 holds every periodic read, the part withheld (LG10); two
//             feed pages fold to page 1 on the period (LG11); the open post on the period, never replacing an inbox read on its way
//             (LG12); as built: an expired age alone rebuilds the view to no card and no person row, the scroll kept (LG13)
//   LH1-LH7   the hub: a draft survives a live refresh and the view's own rebuild IN A BOX PLACED IN THE NEW LAYOUT (LHC: the placement
//             check can fail), text typed through the widget itself survives (LH7), a reopened hub (the model's draft) with a fresh model
//             as the control; the sixth tab's name; the preview's honest state as BUILT, with a live control; REQUEST AGAIN as drawn (LH8);
//             a requester's PROFILE opened at the next pre-tick, never from the answer (LH9, F-21)
// WLQA LFF lines; ends `WLQA LFF END pass=N fail=M`. In its own file, like the other Social QA.
//
// wl.Qa.SocialLffScreen -- ON SCREEN in a running game: HU1/HUC the HUD is unchanged by the LFF tab (buttons counted on the game window,
// with a control), CR1/CR2/CRC the caret survives a rebuild (typed through Slate's own key routing; the control shows Slate's default
// would jump it), WS1 the machine's "welcome seen" is left as it was (WSC: the same reader sees a flip). WLQA LFFSCREEN lines.
#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "Framework/Application/SlateApplication.h"
#include "Framework/Text/TextLayout.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SWindow.h"
#include "WonderlandBeta.h"
#include "WonderlandSocialHubPanel.h"
#include "WonderlandSocialLffView.h"
#include "WonderlandSocialLive.h"
#include "WonderlandSocialService.h"
#include "WonderlandUiStyle.h"
#include "WonderlandUiSubsystem.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandSocialLffQa
{
	/** A STAND-IN SERVICE for the model's state machine: it records each LFF call and holds its answer until the check gives it. */
	class FLffQaService final : public IWonderlandSocialService
	{
	public:
		virtual const FWonderlandSocialSnapshot& GetSnapshot() const override { return Snapshot; }
		virtual FString GetSourceLine() const override { return TEXT("QA stand-in"); }
		virtual bool IsDevelopmentPreview() const override { return false; }
		virtual FString GetLastError() const override { return FString(); }
		virtual FWonderlandSocialActionResult Request(const FString& OperationId, const FString& SubjectId) override
		{
			return FWonderlandSocialActionResult{false, TEXT("QA stand-in"), false};
		}
		virtual FWonderlandSocialActionResult SendMessage(const FString& ConversationId, const FString& Body) override
		{
			return FWonderlandSocialActionResult{false, TEXT("QA stand-in"), false};
		}
		virtual void ReadLffFeed(const FWonderlandLffFeedQuery& Query, FWonderlandLffFeedDone Done) override
		{
			Calls.Add(Query.bMine ? TEXT("mine") : TEXT("feed"));
			LastQuery = Query;
			Feeds.Add(MoveTemp(Done));
		}
		virtual void ReadLffPost(const FString& PostId, FWonderlandLffPostDone Done) override
		{
			Calls.Add(FString::Printf(TEXT("post %s"), *PostId));
			Posts.Add(MoveTemp(Done));
		}
		virtual void ReadLffPostRequests(const FString& PostId, FWonderlandLffPostRequestsDone Done) override
		{
			Calls.Add(FString::Printf(TEXT("inbox %s"), *PostId));
			Inboxes.Add(MoveTemp(Done));
		}
		virtual void ReadLffMyRequests(FWonderlandLffMyRequestsDone Done) override
		{
			Calls.Add(TEXT("requests"));
			Mines.Add(MoveTemp(Done));
		}
		virtual void CreateLffPost(const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) override
		{
			Calls.Add(TEXT("create"));
			LastFields = Fields;
			Writes.Add(MoveTemp(Done));
		}
		virtual void EditLffPost(const FString& PostId, const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) override
		{
			Calls.Add(FString::Printf(TEXT("edit %s"), *PostId));
			LastFields = Fields;
			Writes.Add(MoveTemp(Done));
		}
		virtual void SendLffRequest(const FString& PostId, const FString& Message, FWonderlandLffWriteDone Done) override
		{
			Calls.Add(FString::Printf(TEXT("request %s"), *PostId));
			LastNote = Message;
			Writes.Add(MoveTemp(Done));
		}
		virtual void ActOnLff(const FString& OperationId, const FString& SubjectId, FWonderlandLffWriteDone Done) override
		{
			Calls.Add(FString::Printf(TEXT("%s %s"), *OperationId, *SubjectId));
			Writes.Add(MoveTemp(Done));
		}
		virtual void ReportLffPost(const FString& AuthorId, const FString& PostId, FWonderlandLffWriteDone Done) override
		{
			Calls.Add(FString::Printf(TEXT("report %s"), *PostId));
			Writes.Add(MoveTemp(Done));
		}
		virtual void ReadProfile(const FString& UserId, FWonderlandLffProfileDone Done) override
		{
			Calls.Add(FString::Printf(TEXT("profile %s"), *UserId));
			Profiles.Add(MoveTemp(Done));
		}

		// THE ANSWERS, given by the check. Each held call is taken out BEFORE it runs: an answer may ask again (the arrays grow under it).
		bool AnswerFeed(int32 Index, const FWonderlandLffAnswer& Answer, const FWonderlandLffFeedPage& Page)
		{
			if (!Feeds.IsValidIndex(Index)) return false;
			FWonderlandLffFeedDone Done = MoveTemp(Feeds[Index]);
			Feeds.RemoveAt(Index);
			if (Done) { Done(Answer, Page); }
			return true;
		}
		bool AnswerPost(int32 Index, const FWonderlandLffAnswer& Answer, const FWonderlandLffPostDetail& Detail)
		{
			if (!Posts.IsValidIndex(Index)) return false;
			FWonderlandLffPostDone Done = MoveTemp(Posts[Index]);
			Posts.RemoveAt(Index);
			if (Done) { Done(Answer, Detail); }
			return true;
		}
		bool AnswerInbox(int32 Index, const FWonderlandLffAnswer& Answer, const FWonderlandLffPostRequests& Inbox)
		{
			if (!Inboxes.IsValidIndex(Index)) return false;
			FWonderlandLffPostRequestsDone Done = MoveTemp(Inboxes[Index]);
			Inboxes.RemoveAt(Index);
			if (Done) { Done(Answer, Inbox); }
			return true;
		}
		bool AnswerMine(int32 Index, const FWonderlandLffAnswer& Answer, const FWonderlandLffMyRequests& Mine)
		{
			if (!Mines.IsValidIndex(Index)) return false;
			FWonderlandLffMyRequestsDone Done = MoveTemp(Mines[Index]);
			Mines.RemoveAt(Index);
			if (Done) { Done(Answer, Mine); }
			return true;
		}
		bool AnswerWrite(int32 Index, const FWonderlandLffAnswer& Answer, const FString& CreatedId)
		{
			if (!Writes.IsValidIndex(Index)) return false;
			FWonderlandLffWriteDone Done = MoveTemp(Writes[Index]);
			Writes.RemoveAt(Index);
			if (Done) { Done(Answer, CreatedId); }
			return true;
		}
		bool AnswerProfile(int32 Index, const FWonderlandLffAnswer& Answer, const FWonderlandSocialProfileView& Card)
		{
			if (!Profiles.IsValidIndex(Index)) return false;
			FWonderlandLffProfileDone Done = MoveTemp(Profiles[Index]);
			Profiles.RemoveAt(Index);
			if (Done) { Done(Answer, Card); }
			return true;
		}
		void Forget()
		{
			Calls.Reset();
			Feeds.Reset();
			Posts.Reset();
			Inboxes.Reset();
			Mines.Reset();
			Writes.Reset();
			Profiles.Reset();
		}

		FWonderlandSocialSnapshot Snapshot;
		TArray<FString> Calls;
		FWonderlandLffFeedQuery LastQuery;
		FWonderlandLffPostFields LastFields;
		FString LastNote;
		TArray<FWonderlandLffFeedDone> Feeds;
		TArray<FWonderlandLffPostDone> Posts;
		TArray<FWonderlandLffPostRequestsDone> Inboxes;
		TArray<FWonderlandLffMyRequestsDone> Mines;
		TArray<FWonderlandLffWriteDone> Writes;
		TArray<FWonderlandLffProfileDone> Profiles;
	};

	FWonderlandLffAnswer AnswerOk()
	{
		FWonderlandLffAnswer Answer;
		Answer.Status = 200;
		return Answer;
	}

	FWonderlandLffAnswer AnswerRefused(int32 Status, const FString& Problem, int32 RetryAfter = 0)
	{
		FWonderlandLffAnswer Answer;
		Answer.Status = Status;
		Answer.Problem = Problem;
		Answer.RetryAfterSeconds = RetryAfter;
		return Answer;
	}

	/** A person row as social-preview.ts row() makes it (presence from the one authority). */
	TSharedPtr<FJsonObject> PersonJson(const FString& UserId, const FString& Name)
	{
		TSharedPtr<FJsonObject> Can = MakeShared<FJsonObject>();
		Can->SetBoolField(TEXT("sendFriendRequest"), true);
		Can->SetBoolField(TEXT("message"), false);
		Can->SetBoolField(TEXT("inviteToParty"), false);
		Can->SetBoolField(TEXT("report"), true);
		TSharedPtr<FJsonObject> Presence = MakeShared<FJsonObject>();
		Presence->SetStringField(TEXT("userId"), UserId);
		Presence->SetStringField(TEXT("onlineState"), TEXT("OFFLINE"));
		Presence->SetStringField(TEXT("headline"), TEXT("OFFLINE"));
		Presence->SetField(TEXT("activityLabel"), MakeShared<FJsonValueNull>());
		Presence->SetField(TEXT("location"), MakeShared<FJsonValueNull>());
		Presence->SetObjectField(TEXT("can"), Can);
		TSharedPtr<FJsonObject> Row = MakeShared<FJsonObject>();
		Row->SetStringField(TEXT("userId"), UserId);
		Row->SetStringField(TEXT("displayName"), Name);
		Row->SetStringField(TEXT("handle"), FString::Printf(TEXT("@%s"), *Name.ToLower()));
		Row->SetStringField(TEXT("avatarRef"), FString());
		Row->SetObjectField(TEXT("presence"), Presence);
		return Row;
	}

	/** A profile card as resolveProfileFor makes it: rank and level PENDING (null), a Relay Dog. */
	TSharedPtr<FJsonObject> CardJson(const FString& UserId, const FString& Name)
	{
		TSharedPtr<FJsonObject> Progression = MakeShared<FJsonObject>();
		Progression->SetStringField(TEXT("source"), TEXT("PENDING"));
		Progression->SetField(TEXT("rank"), MakeShared<FJsonValueNull>());
		Progression->SetField(TEXT("level"), MakeShared<FJsonValueNull>());
		TSharedPtr<FJsonObject> Dog = MakeShared<FJsonObject>();
		Dog->SetStringField(TEXT("skinId"), TEXT("relay_og"));
		TSharedPtr<FJsonObject> Profile = MakeShared<FJsonObject>();
		Profile->SetStringField(TEXT("userId"), UserId);
		Profile->SetStringField(TEXT("displayName"), Name);
		Profile->SetObjectField(TEXT("progression"), Progression);
		Profile->SetObjectField(TEXT("relayDog"), Dog);
		TSharedPtr<FJsonObject> Card = MakeShared<FJsonObject>();
		Card->SetObjectField(TEXT("profile"), Profile);
		Card->SetObjectField(TEXT("presence"), PersonJson(UserId, Name)->GetObjectField(TEXT("presence")));
		Card->SetStringField(TEXT("relationship"), TEXT("NONE"));
		return Card;
	}

	/** An LffPostView as social-lff.ts postViewFor makes it (synthetic: never drawn). */
	TSharedPtr<FJsonObject> PostJson(const FString& PostId, const FString& Category)
	{
		TSharedPtr<FJsonObject> Post = MakeShared<FJsonObject>();
		Post->SetStringField(TEXT("postId"), PostId);
		Post->SetStringField(TEXT("category"), Category);
		Post->SetStringField(TEXT("categoryLabel"), WonderlandLffCategoryLabel(Category));
		Post->SetStringField(TEXT("title"), TEXT("QA post"));
		Post->SetStringField(TEXT("description"), FString());
		Post->SetStringField(TEXT("projectLabel"), FString());
		Post->SetArrayField(TEXT("skills"), TArray<TSharedPtr<FJsonValue>>());
		Post->SetNumberField(TEXT("openSlots"), 2.0);
		Post->SetField(TEXT("availableSlots"), MakeShared<FJsonValueNull>());
		Post->SetStringField(TEXT("status"), TEXT("OPEN"));
		Post->SetStringField(TEXT("createdAtIso"), TEXT("2026-10-12T09:00:00.000Z"));
		Post->SetStringField(TEXT("updatedAtIso"), TEXT("2026-10-12T09:00:00.000Z"));
		Post->SetStringField(TEXT("expiresAtIso"), TEXT("2026-10-26T09:00:00.000Z"));
		Post->SetNumberField(TEXT("version"), 1.0);
		Post->SetObjectField(TEXT("author"), PersonJson(TEXT("usr_qa_kai"), TEXT("Kai")));
		Post->SetBoolField(TEXT("viewerIsOwner"), false);
		Post->SetField(TEXT("viewerRequest"), MakeShared<FJsonValueNull>());
		return Post;
	}

	TSharedPtr<FJsonObject> FeedJson(const TArray<TSharedPtr<FJsonObject>>& Posts, const FString& NextCursor)
	{
		TArray<TSharedPtr<FJsonValue>> Values;
		for (const TSharedPtr<FJsonObject>& Post : Posts)
		{
			Values.Add(MakeShared<FJsonValueObject>(Post));
		}
		TSharedPtr<FJsonObject> Feed = MakeShared<FJsonObject>();
		Feed->SetArrayField(TEXT("posts"), Values);
		if (NextCursor.IsEmpty())
		{
			Feed->SetField(TEXT("nextCursor"), MakeShared<FJsonValueNull>());
		}
		else
		{
			Feed->SetStringField(TEXT("nextCursor"), NextCursor);
		}
		return Feed;
	}

	/** A post the model holds (as parsed), for feeding the stand-in's answers. */
	FWonderlandLffPost PostOf(const FString& PostId, bool bOwner = false)
	{
		FWonderlandLffPost Post;
		FString Problem;
		WonderlandParseLffPost(PostJson(PostId, TEXT("TEAMS")), Post, Problem);
		Post.bViewerIsOwner = bOwner;
		return Post;
	}

	/** A string of code points (QA builds every control character from its number, never from a literal). */
	FString Repeat(const FString& Piece, int32 Times)
	{
		FString Out;
		for (int32 Index = 0; Index < Times; ++Index)
		{
			Out += Piece;
		}
		return Out;
	}

	/** B35: a time strictly after every FPlatformTime read made before this call (spins at most one clock tick): an open stamped with it is
	 *  AFTER a read asked just before, whatever the clock's resolution. */
	double LffQaLater()
	{
		const double Before = FPlatformTime::Seconds();
		double Now = FPlatformTime::Seconds();
		while (Now <= Before)
		{
			Now = FPlatformTime::Seconds();
		}
		return Now;
	}

	FString CodePoint(uint32 Code)
	{
		FString Out;
		if (Code > 0xFFFF)
		{
			const uint32 V = Code - 0x10000;
			Out.AppendChar(static_cast<TCHAR>(0xD800 + (V >> 10)));
			Out.AppendChar(static_cast<TCHAR>(0xDC00 + (V & 0x3FF)));
		}
		else
		{
			Out.AppendChar(static_cast<TCHAR>(Code));
		}
		return Out;
	}

	FAutoConsoleCommand GQaSocialLff(
		TEXT("wl.Qa.SocialLff"),
		TEXT("QA: LFF (the Looking For Feed) in the client -- parsers, percent-encoded server filters, dispatch, the form's checks, the state machine and ")
		TEXT("its states, and drafts surviving a hub refresh; fed answers and off-screen hubs, with fail-capable controls. WLQA LFF lines."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			if (!WonderlandBeta::IsDeveloperSession())   // the reviewer's R2-09: QA fakes never run in a player's session (the candidate is Development)
			{
				UE_LOG(LogTemp, Display, TEXT("WLQA LFF refused: needs a developer session (-wldev)"));
				return;
			}
			int32 Passed = 0;
			int32 Failed = 0;
			// THE WHAT NEVER CARRIES A POST'S TEXT: ids, counts and states (the 10-07 log rule holds for QA lines too)
			auto Check = [&Passed, &Failed](const FString& Id, bool bOk, const FString& What)
			{
				(bOk ? Passed : Failed) += 1;
				UE_LOG(LogTemp, Display, TEXT("WLQA LFF %s %s -- %s"), *Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
			};

			// ======================================================================================== LP: the parsers
			{
				TSharedPtr<FJsonObject> Second = PostJson(TEXT("lffp_2"), TEXT("BUILDERS"));
				TSharedPtr<FJsonObject> Mine = MakeShared<FJsonObject>();
				Mine->SetStringField(TEXT("requestId"), TEXT("lffr_7"));
				Mine->SetStringField(TEXT("status"), TEXT("PENDING"));
				Second->SetObjectField(TEXT("viewerRequest"), Mine);
				FWonderlandLffFeedPage Page;
				FString Problem;
				const bool bParsed = WonderlandParseLffFeed(FeedJson({PostJson(TEXT("lffp_1"), TEXT("TEAMS")), Second}, TEXT("1760259600000.2")), Page, Problem);
				Check(TEXT("LP1"), bParsed && Page.Posts.Num() == 2 && Page.Posts[0].PostId == TEXT("lffp_1") && Page.Posts[0].OpenSlots == 2
					&& Page.Posts[0].AvailableSlots == -1 && Page.Posts[0].Author.UserId == TEXT("usr_qa_kai") && !Page.Posts[0].bHasViewerRequest
					&& Page.Posts[1].bHasViewerRequest && Page.Posts[1].ViewerRequestStatus == TEXT("PENDING") && Page.NextCursor == TEXT("1760259600000.2"),
					FString::Printf(TEXT("a feed page parses: 2 posts, slots, the owner-only count null, the author, the viewer's request, the cursor (%s)"), *Problem));
				// LP2 THE CONTROL: the same page with one category outside the six is REFUSED (a parser that took anything passes LP1 and fails here)
				TSharedPtr<FJsonObject> Unknown = PostJson(TEXT("lffp_3"), TEXT("TEAMS"));
				Unknown->SetStringField(TEXT("category"), TEXT("GUILDS"));
				FWonderlandLffFeedPage Refused;
				Problem.Reset();
				Check(TEXT("LP2"), !WonderlandParseLffFeed(FeedJson({PostJson(TEXT("lffp_1"), TEXT("TEAMS")), Unknown}, FString()), Refused, Problem)
					&& Refused.Posts.Num() == 0 && !Problem.IsEmpty(), FString::Printf(TEXT("control: a category outside the six refuses the page, nothing half-read kept (%s)"), *Problem));
				// LP3-LP5: no author, an unknown request status, slots out of 1-20, a skill that is not text
				FWonderlandLffPost Post;
				TSharedPtr<FJsonObject> NoAuthor = PostJson(TEXT("lffp_4"), TEXT("TEAMS"));
				NoAuthor->RemoveField(TEXT("author"));
				Check(TEXT("LP3"), !WonderlandParseLffPost(NoAuthor, Post, Problem), TEXT("a post without its author is refused (every visible post names its author)"));
				TSharedPtr<FJsonObject> Withdrawn = PostJson(TEXT("lffp_5"), TEXT("TEAMS"));
				TSharedPtr<FJsonObject> Gone = MakeShared<FJsonObject>();
				Gone->SetStringField(TEXT("requestId"), TEXT("lffr_8"));
				Gone->SetStringField(TEXT("status"), TEXT("WITHDRAWN"));
				Withdrawn->SetObjectField(TEXT("viewerRequest"), Gone);
				Check(TEXT("LP4"), !WonderlandParseLffPost(Withdrawn, Post, Problem), TEXT("a viewer request outside PENDING/ACCEPTED/DECLINED/NO_LONGER_AVAILABLE is refused"));
				TSharedPtr<FJsonObject> NoSlots = PostJson(TEXT("lffp_6"), TEXT("TEAMS"));
				NoSlots->SetNumberField(TEXT("openSlots"), 0.0);
				TSharedPtr<FJsonObject> TooMany = PostJson(TEXT("lffp_7"), TEXT("TEAMS"));
				TooMany->SetNumberField(TEXT("openSlots"), 21.0);
				TSharedPtr<FJsonObject> NumberSkill = PostJson(TEXT("lffp_8"), TEXT("TEAMS"));
				NumberSkill->SetArrayField(TEXT("skills"), TArray<TSharedPtr<FJsonValue>>{MakeShared<FJsonValueNumber>(7.0)});
				Check(TEXT("LP5"), !WonderlandParseLffPost(NoSlots, Post, Problem) && !WonderlandParseLffPost(TooMany, Post, Problem)
					&& !WonderlandParseLffPost(NumberSkill, Post, Problem) && WonderlandParseLffPost(PostJson(TEXT("lffp_9"), TEXT("DESIGNERS")), Post, Problem),
					TEXT("open slots 0 and 21 and a skill that is a number are refused; control: the same post with 2 slots parses"));
				// LP6: the detail -- the author's card and the accepted list; null accepted reads as none; a card that is not one is refused
				TSharedPtr<FJsonObject> Detail = PostJson(TEXT("lffp_1"), TEXT("TEAMS"));
				Detail->SetObjectField(TEXT("authorProfile"), CardJson(TEXT("usr_qa_kai"), TEXT("Kai")));
				Detail->SetArrayField(TEXT("accepted"), TArray<TSharedPtr<FJsonValue>>{MakeShared<FJsonValueObject>(PersonJson(TEXT("usr_qa_nova"), TEXT("Nova")))});
				FWonderlandLffPostDetail Parsed;
				const bool bDetail = WonderlandParseLffPostDetail(Detail, Parsed, Problem);
				TSharedPtr<FJsonObject> Plain = PostJson(TEXT("lffp_1"), TEXT("TEAMS"));
				Plain->SetField(TEXT("authorProfile"), MakeShared<FJsonValueNull>());
				Plain->SetField(TEXT("accepted"), MakeShared<FJsonValueNull>());
				FWonderlandLffPostDetail ParsedPlain;
				const bool bPlain = WonderlandParseLffPostDetail(Plain, ParsedPlain, Problem);
				TSharedPtr<FJsonObject> BadCard = PostJson(TEXT("lffp_1"), TEXT("TEAMS"));
				BadCard->SetStringField(TEXT("authorProfile"), TEXT("not a card"));
				FWonderlandLffPostDetail ParsedBad;
				Check(TEXT("LP6"), bDetail && Parsed.bHasAuthorProfile && Parsed.AuthorProfile.Profile.UserId == TEXT("usr_qa_kai") && Parsed.bHasAccepted
					&& Parsed.Accepted.Num() == 1 && bPlain && !ParsedPlain.bHasAuthorProfile && !ParsedPlain.bHasAccepted && !WonderlandParseLffPostDetail(BadCard, ParsedBad, Problem),
					TEXT("the detail's card and accepted list parse; null reads as none; control: a card that is a string is refused"));
				// LP7: the viewer's requests -- a pending one whose post is out of sight (null) reads NO_LONGER_AVAILABLE; CANCELLED is never theirs
				const auto RequestJson = [](const FString& RequestId, const FString& Status, const TSharedPtr<FJsonObject>& OfPost)
				{
					TSharedPtr<FJsonObject> Row = MakeShared<FJsonObject>();
					Row->SetStringField(TEXT("requestId"), RequestId);
					Row->SetStringField(TEXT("postId"), TEXT("lffp_1"));
					Row->SetStringField(TEXT("status"), Status);
					Row->SetStringField(TEXT("message"), FString());
					Row->SetStringField(TEXT("createdAtIso"), TEXT("2026-10-12T09:00:00.000Z"));
					Row->SetStringField(TEXT("updatedAtIso"), TEXT("2026-10-12T09:00:00.000Z"));
					if (OfPost.IsValid())
					{
						Row->SetObjectField(TEXT("post"), OfPost);
					}
					else
					{
						Row->SetField(TEXT("post"), MakeShared<FJsonValueNull>());
					}
					return Row;
				};
				const auto MineJson = [](const TArray<TSharedPtr<FJsonObject>>& Rows, bool bTruncated)
				{
					TArray<TSharedPtr<FJsonValue>> Values;
					for (const TSharedPtr<FJsonObject>& Row : Rows)
					{
						Values.Add(MakeShared<FJsonValueObject>(Row));
					}
					TSharedPtr<FJsonObject> Listed = MakeShared<FJsonObject>();
					Listed->SetArrayField(TEXT("requests"), Values);
					Listed->SetBoolField(TEXT("truncated"), bTruncated);
					return Listed;
				};
				FWonderlandLffMyRequests MyRequests;
				const bool bMine = WonderlandParseLffMyRequests(MineJson({RequestJson(TEXT("lffr_1"), TEXT("NO_LONGER_AVAILABLE"), nullptr),
					RequestJson(TEXT("lffr_2"), TEXT("ACCEPTED"), PostJson(TEXT("lffp_1"), TEXT("TEAMS")))}, true), MyRequests, Problem);
				FWonderlandLffMyRequests Cancelled;
				Check(TEXT("LP7"), bMine && MyRequests.Requests.Num() == 2 && !MyRequests.Requests[0].bHasPost && MyRequests.Requests[1].bHasPost
					&& MyRequests.bTruncated && !WonderlandParseLffMyRequests(MineJson({RequestJson(TEXT("lffr_3"), TEXT("CANCELLED"), nullptr)}, false), Cancelled, Problem),
					TEXT("the viewer's requests parse (a post out of sight reads null, truncated read); control: CANCELLED is refused (never shown to anybody)"));
				// LP8: the owner's inbox holds PENDING and ACCEPTED only
				const auto InboxJson = [](const FString& Status)
				{
					TSharedPtr<FJsonObject> Row = MakeShared<FJsonObject>();
					Row->SetStringField(TEXT("requestId"), TEXT("lffr_4"));
					Row->SetStringField(TEXT("status"), Status);
					Row->SetStringField(TEXT("message"), FString());
					Row->SetObjectField(TEXT("requester"), PersonJson(TEXT("usr_qa_nova"), TEXT("Nova")));
					TSharedPtr<FJsonObject> Inbox = MakeShared<FJsonObject>();
					Inbox->SetStringField(TEXT("postId"), TEXT("lffp_1"));
					Inbox->SetArrayField(TEXT("requests"), TArray<TSharedPtr<FJsonValue>>{MakeShared<FJsonValueObject>(Row)});
					return Inbox;
				};
				FWonderlandLffPostRequests Inbox;
				const bool bPending = WonderlandParseLffPostRequests(InboxJson(TEXT("PENDING")), Inbox, Problem);
				const bool bAccepted = WonderlandParseLffPostRequests(InboxJson(TEXT("ACCEPTED")), Inbox, Problem);
				Check(TEXT("LP8"), bPending && bAccepted && Inbox.Requests.Num() == 1 && Inbox.Requests[0].Requester.UserId == TEXT("usr_qa_nova")
					&& !WonderlandParseLffPostRequests(InboxJson(TEXT("DECLINED")), Inbox, Problem),
					TEXT("the owner's inbox parses PENDING and ACCEPTED; control: a DECLINED row is refused (never listed to the owner)"));
			}

			// ======================================================================================== LQ: filters go to the server, encoded
			{
				const FString Encoded = WonderlandLffEncodeQueryValue(TEXT("Wonder Web+"));
				Check(TEXT("LQ1"), Encoded == TEXT("Wonder%20Web%2B"), FString::Printf(TEXT("'Wonder Web+' is sent as '%s' (want 'Wonder%%20Web%%2B': a space is %%20, never '+')"), *Encoded));
				const FString Accented = WonderlandLffEncodeQueryValue(FString::Printf(TEXT("Caf%s/C++"), *CodePoint(0xE9)));
				const FString Plain = WonderlandLffEncodeQueryValue(TEXT("a-b_c.d~e9"));
				Check(TEXT("LQ2"), Accented == TEXT("Caf%C3%A9%2FC%2B%2B") && Plain == TEXT("a-b_c.d~e9"),
					FString::Printf(TEXT("UTF-8 bytes in upper-case hex ('%s'); control: the unreserved set passes unchanged ('%s')"), *Accented, *Plain));
				FWonderlandLffFeedQuery Query;
				Query.Category = TEXT("TEAMS");
				Query.ProjectLabel = TEXT(" Wonder Web+ ");
				Query.Skill = TEXT("C++");
				FString Path;
				FString Why;
				const bool bPath = WonderlandLffFeedPath(Query, Path, Why);
				Check(TEXT("LQ3"), bPath && Path == TEXT("/lff/posts?limit=50&category=TEAMS&projectLabel=Wonder%20Web%2B&skill=C%2B%2B"),
					FString::Printf(TEXT("the feed read carries category and both filters, trimmed and encoded: %s"), *Path));
				FWonderlandLffFeedQuery Lower;
				Lower.Category = TEXT("teams");
				FWonderlandLffFeedQuery Broken;
				Broken.Skill = FString::Printf(TEXT("Unreal%sEngine"), *CodePoint(0x0A));
				FWonderlandLffFeedQuery BadCursor;
				BadCursor.Cursor = TEXT("1/2");
				FWonderlandLffFeedQuery Lone;
				Lone.ProjectLabel = FString::Printf(TEXT("a%sb"), *CodePoint(0xD800));   // a high surrogate with no low one after it
				FWonderlandLffFeedQuery Next;
				Next.Cursor = TEXT("1760259600000.12");
				Next.bMine = true;
				Next.bHasOpenSlots = true;
				FString NextPath;
				const bool bNext = WonderlandLffFeedPath(Next, NextPath, Why);
				Check(TEXT("LQ4"), !WonderlandLffFeedPath(Lower, Path, Why) && !WonderlandLffFeedPath(Broken, Path, Why) && !WonderlandLffFeedPath(BadCursor, Path, Why)
					&& !WonderlandLffFeedPath(Lone, Path, Why) && bNext && NextPath == TEXT("/lff/posts?limit=50&mine=1&hasOpenSlots=1&cursor=1760259600000.12"),
					FString::Printf(TEXT("a category not the authority's token, a filter with a line break or a lone surrogate, and a cursor with '/' are refused before sending; control (own posts, open only, next page): %s"), *NextPath));
				// LQ5: THE MODEL SENDS THE FILTERS AND NEVER FILTERS THE PAGE ITSELF: a page whose posts do not mention the filter is shown whole
				TUniquePtr<FLffQaService> Fake = MakeUnique<FLffQaService>();
				FLffQaService* Svc = Fake.Get();
				const TSharedRef<FWonderlandLffModel> Model = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
				Model->SetFieldText(EWonderlandLffField::ProjectFilter, TEXT(" Wonder Web+ "));
				Model->SetFieldText(EWonderlandLffField::SkillFilter, TEXT("C++"));
				const bool bApplied = Model->ApplyFilters();
				const FWonderlandLffFeedQuery Sent = Svc->LastQuery;
				FWonderlandLffFeedPage Page;
				Page.Posts = {PostOf(TEXT("lffp_1")), PostOf(TEXT("lffp_2"))};
				Svc->AnswerFeed(0, AnswerOk(), Page);
				const int32 Shown = Model->GetFeed().Num();
				Model->ClearFilters();
				Check(TEXT("LQ5"), bApplied && Sent.ProjectLabel == TEXT("Wonder Web+") && Sent.Skill == TEXT("C++") && Shown == 2 && Svc->LastQuery.ProjectLabel.IsEmpty()
					&& Svc->LastQuery.Skill.IsEmpty() && Model->HasAppliedFilters() == false,
					FString::Printf(TEXT("APPLY sends both filters to the server (trimmed) and shows the server's page whole (%d of 2); CLEAR sends none"), Shown));
			}

			// ======================================================================================== LD: dispatch
			{
				TUniquePtr<FWonderlandSocialLiveService> Probe = MakeUnique<FWonderlandSocialLiveService>(TEXT("http://127.0.0.1:9"), TEXT("qa-lff"));
				bool bBadIdAnswered = false;
				FWonderlandLffAnswer BadId;
				Probe->ActOnLff(TEXT("lff.request.accept"), TEXT("lffr_1/../x"), [&bBadIdAnswered, &BadId](const FWonderlandLffAnswer& Answer, const FString&) { bBadIdAnswered = true; BadId = Answer; });
				bool bUnknownAnswered = false;
				FWonderlandLffAnswer Unknown;
				Probe->ActOnLff(TEXT("lff.request.nonsense"), TEXT("lffr_1"), [&bUnknownAnswered, &Unknown](const FWonderlandLffAnswer& Answer, const FString&) { bUnknownAnswered = true; Unknown = Answer; });
				bool bKnownAnsweredAtOnce = false;
				Probe->ActOnLff(TEXT("lff.request.accept"), TEXT("lffr_1"), [&bKnownAnsweredAtOnce](const FWonderlandLffAnswer&, const FString&) { bKnownAnsweredAtOnce = true; });
				Check(TEXT("LD1"), bBadIdAnswered && BadId.bRefusedHere && bUnknownAnswered && Unknown.bRefusedHere && Unknown.Problem.Contains(TEXT("not a Looking For Feed action"))
					&& !bKnownAnsweredAtOnce,
					TEXT("an unsafe id and an unknown action are refused before sending; control: a known action on a safe id is SENT (no answer at once)"));
				FWonderlandLffFeedQuery Bad;
				Bad.Category = TEXT("GUILDS");
				bool bBadQueryAnswered = false;
				Probe->ReadLffFeed(Bad, [&bBadQueryAnswered](const FWonderlandLffAnswer& Answer, const FWonderlandLffFeedPage&) { bBadQueryAnswered = Answer.bRefusedHere; });
				bool bGoodQueryAnsweredAtOnce = false;
				Probe->ReadLffFeed(FWonderlandLffFeedQuery(), [&bGoodQueryAnsweredAtOnce](const FWonderlandLffAnswer&, const FWonderlandLffFeedPage&) { bGoodQueryAnsweredAtOnce = true; });
				Check(TEXT("LD2"), bBadQueryAnswered && !bGoodQueryAnsweredAtOnce, TEXT("a feed read with a category outside the six is refused here; control: a plain read is sent"));
				Probe.Reset();   // cancels every request it started (to a dead port); no callback runs after this
				// LD3: THE PREVIEW HAS NO LFF: every call answers "needs a live connection", with nothing in it
				FWonderlandSocialPreviewService Preview;
				FWonderlandLffAnswer FeedAnswer;
				int32 PreviewPosts = -1;
				Preview.ReadLffFeed(FWonderlandLffFeedQuery(), [&FeedAnswer, &PreviewPosts](const FWonderlandLffAnswer& Answer, const FWonderlandLffFeedPage& Page) { FeedAnswer = Answer; PreviewPosts = Page.Posts.Num(); });
				FWonderlandLffAnswer WriteAnswer;
				Preview.CreateLffPost(FWonderlandLffPostFields(), [&WriteAnswer](const FWonderlandLffAnswer& Answer, const FString&) { WriteAnswer = Answer; });
				FWonderlandLffAnswer DetailAnswer;
				Preview.ReadLffPost(TEXT("lffp_1"), [&DetailAnswer](const FWonderlandLffAnswer& Answer, const FWonderlandLffPostDetail&) { DetailAnswer = Answer; });
				Check(TEXT("LD3"), FeedAnswer.bNeedsLive && PreviewPosts == 0 && WriteAnswer.bNeedsLive && DetailAnswer.bNeedsLive && !FeedAnswer.IsOk()
					&& WonderlandLff::ProblemOf(FeedAnswer) == EWonderlandLffProblem::NeedsLive,
					TEXT("the preview answers every LFF call 'needs a live connection' with no posts (never fake ones)"));
			}

			// ======================================================================================== LV: the form's and the note's checks
			{
				FWonderlandLffDraft Draft;
				Draft.Category = TEXT("BUILDERS");
				Draft.Title = TEXT("  Need a level designer  ");
				Draft.Skills = TEXT("Unreal, Level design ,, ");
				Draft.OpenSlots = 3;
				FWonderlandLffPostFields Fields;
				FString Why;
				const bool bValid = WonderlandLff::ValidateDraft(Draft, Fields, Why);
				Check(TEXT("LV1"), bValid && Fields.Title == TEXT("Need a level designer") && Fields.Skills.Num() == 2 && Fields.Skills[1] == TEXT("Level design")
					&& Fields.OpenSlots == 3 && Fields.Description.IsEmpty(), TEXT("a valid draft: trimmed, skills split on commas with empties dropped"));
				const auto Refuses = [](FWonderlandLffDraft Bad)
				{
					FWonderlandLffPostFields Ignored;
					FString Reason;
					return !WonderlandLff::ValidateDraft(Bad, Ignored, Reason) && !Reason.IsEmpty();
				};
				FWonderlandLffDraft NoCategory = Draft;
				NoCategory.Category.Reset();
				FWonderlandLffDraft NoTitle = Draft;
				NoTitle.Title = TEXT("   ");
				FWonderlandLffDraft LongTitle = Draft;
				LongTitle.Title = Repeat(TEXT("a"), 81);
				FWonderlandLffDraft EmojiTitle = Draft;
				EmojiTitle.Title = Repeat(CodePoint(0x1F600), 80);   // 80 characters, 160 UTF-16 units: the server counts code points
				FWonderlandLffDraft EmojiTooLong = Draft;
				EmojiTooLong.Title = Repeat(CodePoint(0x1F600), 81);
				Check(TEXT("LV2"), Refuses(NoCategory) && Refuses(NoTitle) && Refuses(LongTitle) && Refuses(EmojiTooLong) && !Refuses(EmojiTitle),
					TEXT("no category, a blank title, 81 characters and 81 emoji are refused; control: 80 emoji (160 UTF-16 units) are accepted"));
				bool bAllControls = true;
				// (no NUL here: an FString drops an appended NUL, and no text box can type one -- the server refuses it on its side)
				for (const uint32 Code : {0x0Au, 0x0Du, 0x09u, 0x1Bu, 0x7Fu, 0x85u, 0x2028u, 0x2029u})
				{
					const FString Bad = FString::Printf(TEXT("Need%sdesigner"), *CodePoint(Code));
					FWonderlandLffDraft InTitle = Draft;
					InTitle.Title = Bad;
					FWonderlandLffDraft InDescription = Draft;
					InDescription.Description = Bad;
					FWonderlandLffDraft InProject = Draft;
					InProject.ProjectLabel = Bad;
					FWonderlandLffDraft InSkills = Draft;
					InSkills.Skills = Bad;
					bAllControls = bAllControls && Refuses(InTitle) && Refuses(InDescription) && Refuses(InProject) && Refuses(InSkills);
				}
				FWonderlandLffDraft OtherScripts = Draft;
				OtherScripts.Title = FString::Printf(TEXT("Caf%s %s%s"), *CodePoint(0xE9), *CodePoint(0x6771), *CodePoint(0x4EAC));
				Check(TEXT("LV3"), bAllControls && !Refuses(OtherScripts),
					TEXT("LF, CR, TAB, ESC, DEL, C1 U+0085, U+2028 and U+2029 are refused in every field (built from code points); control: accented and CJK text is accepted"));
				FWonderlandLffDraft NineSkills = Draft;
				NineSkills.Skills = TEXT("a,b,c,d,e,f,g,h,i");
				FWonderlandLffDraft LongSkill = Draft;
				LongSkill.Skills = Repeat(TEXT("s"), 33);
				FWonderlandLffDraft NoSlots = Draft;
				NoSlots.OpenSlots = 0;
				FWonderlandLffDraft ManySlots = Draft;
				ManySlots.OpenSlots = 21;
				FWonderlandLffDraft EightSkills = Draft;
				EightSkills.Skills = TEXT("a,b,c,d,e,f,g,h");
				Check(TEXT("LV4"), Refuses(NineSkills) && Refuses(LongSkill) && Refuses(NoSlots) && Refuses(ManySlots) && !Refuses(EightSkills),
					TEXT("9 skills, a 33-character skill and 0 or 21 slots are refused; control: 8 skills are accepted"));
				FString Note;
				const bool bEmpty = WonderlandLff::ValidateNote(FString(), Note, Why) && Note.IsEmpty();
				const bool bFull = WonderlandLff::ValidateNote(Repeat(TEXT("n"), 200), Note, Why);
				Check(TEXT("LV5"), bEmpty && bFull && !WonderlandLff::ValidateNote(Repeat(TEXT("n"), 201), Note, Why)
					&& !WonderlandLff::ValidateNote(FString::Printf(TEXT("hi%sthere"), *CodePoint(0x0A)), Note, Why),
					TEXT("a note of 201 characters or with a line break is refused; controls: none and 200 are accepted"));
			}

			// ======================================================================================== LS: the state machine and its states
			{
				TUniquePtr<FLffQaService> Fake = MakeUnique<FLffQaService>();
				FLffQaService* Svc = Fake.Get();
				const TSharedRef<FWonderlandLffModel> Model = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
				const auto DetailOf = [](const FString& PostId, bool bOwner, const FString& Status)
				{
					FWonderlandLffPostDetail Detail;
					Detail.Post = PostOf(PostId, bOwner);
					Detail.Post.Status = Status;
					return Detail;
				};
				// a post opened and its detail answered; every call it made forgotten after
				const auto OpenWith = [&Model, Svc](const FString& PostId, const FWonderlandLffPostDetail& Detail)
				{
					Svc->Forget();
					Model->OpenPost(PostId);
					Svc->AnswerPost(Svc->Posts.Num() - 1, AnswerOk(), Detail);
					Svc->Forget();
				};
				const double Now = FPlatformTime::Seconds();
				// LS1: first on screen -> one feed read, said as loading; on screen again -> nothing more
				Model->NoteOnScreen(Now);
				const FString Loading = Model->PaneLine(EWonderlandLffPane::Feed);
				Model->NoteOnScreen(Now + 0.1);
				Check(TEXT("LS1"), Svc->Calls.Num() == 1 && Svc->Calls[0] == TEXT("feed") && Loading == TEXT("Loading posts…"),
					FString::Printf(TEXT("first shown: one feed read, the pane says loading; shown again: no second read (%d calls)"), Svc->Calls.Num()));
				// LS2: an empty page -> the empty line
				Svc->AnswerFeed(0, AnswerOk(), FWonderlandLffFeedPage());
				Check(TEXT("LS2"), Model->PaneLine(EWonderlandLffPane::Feed) == TEXT("No posts yet. Be the first: CREATE POST."), TEXT("an empty feed says: be the first"));
				// LS3: every refusal is said as itself; a 429 last (it then holds the READS for its Retry-After -- and only the reads)
				const auto LineAfter = [&Model, Svc](const FWonderlandLffAnswer& Answer)
				{
					Svc->Forget();
					Model->Reload();
					Svc->AnswerFeed(0, Answer, FWonderlandLffFeedPage());
					return Model->PaneLine(EWonderlandLffPane::Feed);
				};
				const FString Unavailable = LineAfter(AnswerRefused(503, TEXT("Wonderland social is unavailable")));
				const FString Forbidden = LineAfter(AnswerRefused(403, TEXT("not_permitted")));
				const FString SignedOut = LineAfter(AnswerRefused(401, TEXT("the server ended this session")));
				const FString Unreachable = LineAfter(AnswerRefused(0, TEXT("Wonderland social could not be reached")));
				const FString Limited = LineAfter(AnswerRefused(429, TEXT("Too many requests; try again in 7 s."), 7));
				Svc->Forget();
				Model->Reload();   // within the 7 s: refused here, nothing asked
				const bool bHeld = Svc->Calls.Num() == 0 && Model->RetryAfterLeft(EWonderlandLffBudget::Read) > 0;
				const bool bOthersFree = Model->RetryAfterLeft(EWonderlandLffBudget::Write) == 0 && Model->RetryAfterLeft(EWonderlandLffBudget::Post) == 0;
				Check(TEXT("LS3"), Unavailable.Contains(TEXT("unavailable")) && Forbidden.Contains(TEXT("isn't available to this session")) && SignedOut.Contains(TEXT("session ended"))
					&& Unreachable.Contains(TEXT("Can't reach")) && Limited.Contains(TEXT("Try again in 7 s")) && bHeld && bOthersFree,
					FString::Printf(TEXT("503 / 403 / 401 / unreachable / 429 each say their own line, the 429 with its Retry-After; then no read is asked until it passes (held %s), writes are not held (%s)"),
						bHeld ? TEXT("yes") : TEXT("NO"), bOthersFree ? TEXT("yes") : TEXT("NO")));
				TSet<FString> Distinct = {Unavailable, Forbidden, SignedOut, Unreachable, Limited};
				Check(TEXT("LSC"), Distinct.Num() == 5, TEXT("control: the five lines are five different lines (a mapping that said one thing for all would fail here)"));
				// LS4: AN OLDER READ'S ANSWER IS DROPPED: two category reads in flight, the newer answered first, then the older
				Model->Reset();
				Svc->Forget();
				Model->SetCategory(TEXT("TEAMS"));
				Model->SetCategory(TEXT("BUILDERS"));
				FWonderlandLffFeedPage Newer;
				Newer.Posts = {PostOf(TEXT("lffp_20"))};
				FWonderlandLffFeedPage Older;
				Older.Posts = {PostOf(TEXT("lffp_10"))};
				Svc->AnswerFeed(1, AnswerOk(), Newer);
				Svc->AnswerFeed(0, AnswerOk(), Older);
				Check(TEXT("LS4"), Model->GetFeed().Num() == 1 && Model->GetFeed()[0].PostId == TEXT("lffp_20") && Svc->LastQuery.Category == TEXT("BUILDERS"),
					TEXT("the newer read's page stays; the older read's late answer is dropped"));
				// LS5: a post that answers 404 is gone from the list, and the detail says so (never why)
				Svc->Forget();
				Model->OpenPost(TEXT("lffp_20"));
				Svc->AnswerPost(0, AnswerRefused(404, TEXT("post not found")), FWonderlandLffPostDetail());
				Check(TEXT("LS5"), Model->DetailLine() == TEXT("This post is no longer available.") && Model->GetFeed().Num() == 0 && Svc->Calls.Contains(TEXT("post lffp_20")),
					TEXT("a 404 on the open post: 'no longer available', and the post leaves the feed"));
				// LS6: A VANISHED REQUEST is kept by ID only and reads NO LONGER AVAILABLE -- never one the viewer withdrew themselves; and one
				// the server lists AGAIN (after an unblock) leaves the tombstones (security m1)
				Model->Reset();
				Svc->Forget();
				Model->SetPane(EWonderlandLffPane::MyRequests);
				FWonderlandLffMyRequest Kept;
				Kept.RequestId = TEXT("lffr_1");
				Kept.PostId = TEXT("lffp_1");
				Kept.Status = TEXT("PENDING");
				Kept.bHasPost = true;
				Kept.Post = PostOf(TEXT("lffp_1"));
				FWonderlandLffMyRequest Withdrawn = Kept;
				Withdrawn.RequestId = TEXT("lffr_2");
				Withdrawn.PostId = TEXT("lffp_2");
				Withdrawn.Post = PostOf(TEXT("lffp_2"));
				FWonderlandLffMyRequests First;
				First.Requests = {Kept, Withdrawn};
				Svc->AnswerMine(0, AnswerOk(), First);
				Model->Withdraw(TEXT("lffr_2"));
				const bool bWithdrawSent = Svc->Calls.Contains(TEXT("lff.request.withdraw lffr_2"));
				Svc->AnswerWrite(0, AnswerOk(), FString());
				Svc->AnswerMine(Svc->Mines.Num() - 1, AnswerOk(), FWonderlandLffMyRequests());
				const TArray<FString> Vanished = Model->GetVanished();
				Check(TEXT("LS6"), bWithdrawSent && Vanished.Num() == 1 && Vanished[0] == TEXT("lffr_1") && Model->GetMyRequests().Num() == 0,
					FString::Printf(TEXT("the request that vanished is kept by its id alone (%d); the one the viewer withdrew is not"), Vanished.Num()));
				Model->Reload();
				FWonderlandLffMyRequests Again;
				Again.Requests = {Kept};
				Svc->AnswerMine(Svc->Mines.Num() - 1, AnswerOk(), Again);
				Check(TEXT("LS6B"), Model->GetVanished().Num() == 0 && Model->GetMyRequests().Num() == 1,
					TEXT("a request the server lists again replaces its tombstone (no 'vanished' row beside the live one)"));
				// LS7: A RESET (a sign-out) DROPS ONE PLAYER'S STATE, and an answer asked before it lands on nothing
				Svc->Forget();
				Model->SetPane(EWonderlandLffPane::Feed);
				Model->SetFieldText(EWonderlandLffField::Title, TEXT("half-typed"));
				const int32 RevisionBefore = Model->GetTextRevision();
				Model->Reset();
				FWonderlandLffFeedPage Late;
				Late.Posts = {PostOf(TEXT("lffp_30"))};
				Svc->AnswerFeed(0, AnswerOk(), Late);
				Check(TEXT("LS7"), Model->GetFeed().Num() == 0 && Model->GetDraft().Title.IsEmpty() && Model->GetVanished().Num() == 0 && Model->GetTextRevision() > RevisionBefore,
					TEXT("after a reset: no feed, no draft, no vanished requests, the boxes told to empty; an answer asked before it is dropped"));
				// LS8: CREATE -- nothing is sent while the form is wrong; a valid one sends exactly the trimmed fields, then opens the new post
				Svc->Forget();
				Model->StartCreate();
				Model->SetFieldText(EWonderlandLffField::Title, TEXT("  Need a level designer "));
				const bool bRefused = !Model->SubmitForm();
				const int32 CallsWhileWrong = Svc->Calls.Num();
				const FString Problem = Model->GetFormProblem();
				Model->SetDraftCategory(TEXT("BUILDERS"));
				const bool bSent = Model->SubmitForm();
				const FString SentTitle = Svc->LastFields.Title;
				Svc->AnswerWrite(0, AnswerOk(), TEXT("lffp_9"));
				Check(TEXT("LS8"), bRefused && CallsWhileWrong == 0 && Problem == TEXT("Choose a category.") && bSent && SentTitle == TEXT("Need a level designer")
					&& Model->GetPane() == EWonderlandLffPane::MyPosts && Model->GetOpenPostId() == TEXT("lffp_9") && Svc->Calls.Contains(TEXT("post lffp_9"))
					&& Model->GetDraft().Title.IsEmpty(),
					TEXT("a draft without a category sends nothing and says why; a valid one sends the trimmed fields, opens the new post, empties the draft"));
				// LS9: REQUEST TO JOIN sends the note trimmed; a note with a line break sends nothing
				Svc->Forget();
				Model->SetPane(EWonderlandLffPane::Feed);
				OpenWith(TEXT("lffp_1"), DetailOf(TEXT("lffp_1"), false, TEXT("OPEN")));
				Model->SetFieldText(EWonderlandLffField::Note, FString::Printf(TEXT("hi%sthere"), *CodePoint(0x0A)));
				const bool bBadNote = !Model->RequestToJoin() && !Svc->Calls.Contains(TEXT("request lffp_1"));
				Model->SetFieldText(EWonderlandLffField::Note, TEXT("  I build maps  "));
				const bool bAsked = Model->RequestToJoin();
				Check(TEXT("LS9"), bBadNote && bAsked && Svc->Calls.Contains(TEXT("request lffp_1")) && Svc->LastNote == TEXT("I build maps"),
					TEXT("a note with a line break sends nothing; a good one is sent trimmed"));
				Svc->AnswerWrite(0, AnswerOk(), TEXT("lffr_9"));
				// LS10: DELETE waits for its own press; CANCEL sends nothing
				OpenWith(TEXT("lffp_5"), DetailOf(TEXT("lffp_5"), true, TEXT("OPEN")));
				Model->AskConfirm(EWonderlandLffConfirm::Delete);
				const bool bDeleteWaits = Svc->Calls.Num() == 0 && Model->GetConfirm() == EWonderlandLffConfirm::Delete && Model->GetConfirmSubject() == TEXT("lffp_5");
				Model->CancelConfirm();
				const bool bDeleteCancelled = Svc->Calls.Num() == 0 && Model->GetConfirm() == EWonderlandLffConfirm::None;
				Model->AskConfirm(EWonderlandLffConfirm::Delete);
				Model->ConfirmPending();
				Check(TEXT("LS10"), bDeleteWaits && bDeleteCancelled && Svc->Calls.Contains(TEXT("lff.post.delete lffp_5")),
					TEXT("DELETE asks nothing until CONFIRM; CANCEL clears it; CONFIRM sends lff.post.delete for the open post"));
				Svc->AnswerWrite(0, AnswerOk(), FString());
				// LS11: NO POST TEXT IN DESCRIBE (what the hub's QA line and the log carry), while the model holds it
				Svc->Forget();
				Model->Reset();
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const FString Planted = TEXT("qa-planted-title-7f3");
				FWonderlandLffFeedPage Secret;
				Secret.Posts = {PostOf(TEXT("lffp_40"))};
				Secret.Posts[0].Title = Planted;
				Secret.Posts[0].ProjectLabel = Planted;
				Svc->AnswerFeed(0, AnswerOk(), Secret);
				Model->SetFieldText(EWonderlandLffField::Note, Planted);
				Model->SetFieldText(EWonderlandLffField::SkillFilter, Planted);
				const FString Said = Model->Describe();
				Check(TEXT("LS11"), Model->GetFeed().Num() == 1 && Model->GetFeed()[0].Title == Planted && !Said.Contains(Planted) && Said.Contains(TEXT("lffp_40")),
					TEXT("Describe names the post by id and never its title, label, note or filter; control: the model DOES hold that title"));
				// LS12: ACCEPT sends lff.request.accept for that request, then reads the open post again (a fill closes it)
				OpenWith(TEXT("lffp_5"), DetailOf(TEXT("lffp_5"), true, TEXT("OPEN")));
				Model->Accept(TEXT("lffr_5"));
				Svc->AnswerWrite(0, AnswerOk(), FString());
				Check(TEXT("LS12"), Svc->Calls.Num() >= 2 && Svc->Calls[0] == TEXT("lff.request.accept lffr_5") && Svc->Calls.Contains(TEXT("post lffp_5")),
					TEXT("ACCEPT sends the request's accept, then the open post is read again"));
				// LS13: DECLINE sends lff.request.decline for that request, then reads the open post again (contract A4)
				OpenWith(TEXT("lffp_5"), DetailOf(TEXT("lffp_5"), true, TEXT("OPEN")));
				Model->Decline(TEXT("lffr_6"));
				const bool bDeclineSent = Svc->Calls.Num() == 1 && Svc->Calls[0] == TEXT("lff.request.decline lffr_6");
				Svc->AnswerWrite(0, AnswerOk(), FString());
				Check(TEXT("LS13"), bDeclineSent && Svc->Calls.Contains(TEXT("post lffp_5")) && Model->GetActionLine() == TEXT("Declined."),
					TEXT("DECLINE sends the request's decline (and nothing else), says Declined, and reads the open post again"));
				// LS14: CLOSE waits for its own press; CANCEL sends nothing; CONFIRM sends lff.post.close, then the post and MY POSTS are read again
				Svc->Forget();
				Model->AskConfirm(EWonderlandLffConfirm::Close);
				const bool bCloseWaits = Svc->Calls.Num() == 0 && Model->GetConfirm() == EWonderlandLffConfirm::Close && Model->GetConfirmSubject() == TEXT("lffp_5");
				Model->CancelConfirm();
				const bool bCloseCancelled = Svc->Calls.Num() == 0 && Model->GetConfirm() == EWonderlandLffConfirm::None;
				Model->AskConfirm(EWonderlandLffConfirm::Close);
				Model->ConfirmPending();
				const bool bCloseSent = Svc->Calls.Num() == 1 && Svc->Calls[0] == TEXT("lff.post.close lffp_5");
				Svc->AnswerWrite(0, AnswerOk(), FString());
				Check(TEXT("LS14"), bCloseWaits && bCloseCancelled && bCloseSent && Svc->Calls.Contains(TEXT("post lffp_5")) && Svc->Calls.Contains(TEXT("mine")),
					TEXT("CLOSE asks nothing until CONFIRM (control: CANCEL sends nothing); CONFIRM sends lff.post.close for the open post, then reads it and MY POSTS"));
				// LS15: A 409 (a cap, a closed post) is said in the SERVER'S OWN SENTENCE, in the form too, and the draft is kept
				Svc->Forget();
				Model->StartCreate();
				Model->SetDraftCategory(TEXT("TEAMS"));
				Model->SetFieldText(EWonderlandLffField::Title, TEXT("Need a team"));
				Model->SubmitForm();
				const FString Cap = TEXT("you already have 5 open posts: close one first");
				Svc->AnswerWrite(0, AnswerRefused(409, Cap), FString());
				Check(TEXT("LS15"), Model->GetActionLine() == Cap && Model->GetFormProblem() == Cap && !Model->GetActionLine().Contains(TEXT("Something went wrong"))
					&& Model->GetDraft().Title == TEXT("Need a team") && Model->GetPane() == EWonderlandLffPane::Form,
					TEXT("a 409 shows the server's own sentence (never 'something went wrong'), in the form, with the draft kept"));
				Model->CancelForm();
				// LS16: EDIT fills the form from the post; a CREATE POST in between keeps the edit for its own EDIT (m8); SAVE sends the trimmed
				// fields to edit <id>; control: EDIT is refused on a CLOSED post
				FWonderlandLffPostDetail OwnOpen = DetailOf(TEXT("lffp_5"), true, TEXT("OPEN"));
				OwnOpen.Post.Skills = {TEXT("Unreal"), TEXT("Blender")};
				OpenWith(TEXT("lffp_5"), OwnOpen);
				const bool bEditing = Model->StartEdit();
				const bool bFilled = Model->IsEditingForm() && Model->GetDraft().EditingPostId == TEXT("lffp_5") && Model->GetDraft().Title == TEXT("QA post")
					&& Model->GetDraft().Skills == TEXT("Unreal, Blender");
				Model->SetFieldText(EWonderlandLffField::Title, TEXT("  Edited title "));
				Model->StartCreate();
				const bool bNewDraft = !Model->IsEditingForm() && Model->GetDraft().Title.IsEmpty();
				Model->StartEdit();
				const bool bResumed = Model->IsEditingForm() && Model->GetDraft().Title == TEXT("  Edited title ");
				Svc->Forget();
				Model->SubmitForm();
				const bool bEditSent = Svc->Calls.Contains(TEXT("edit lffp_5")) && Svc->LastFields.Title == TEXT("Edited title") && Svc->LastFields.Skills.Num() == 2;
				Svc->AnswerWrite(0, AnswerOk(), FString());
				OpenWith(TEXT("lffp_6"), DetailOf(TEXT("lffp_6"), true, TEXT("CLOSED")));
				const bool bClosedRefused = !Model->StartEdit();
				Check(TEXT("LS16"), bEditing && bFilled && bNewDraft && bResumed && bEditSent && bClosedRefused,
					FString::Printf(TEXT("EDIT fills from the post (%s), CREATE POST keeps it (%s) and EDIT resumes it (%s), SAVE sends edit with the trimmed fields (%s); control: a CLOSED post refuses EDIT (%s)"),
						bFilled ? TEXT("yes") : TEXT("NO"), bNewDraft ? TEXT("yes") : TEXT("NO"), bResumed ? TEXT("yes") : TEXT("NO"), bEditSent ? TEXT("yes") : TEXT("NO"),
						bClosedRefused ? TEXT("yes") : TEXT("NO")));
				// LS17: LOAD MORE asks with the first page's cursor and the same category, shows a repeated post once, and a late page lands on nothing
				Model->Reset();
				Svc->Forget();
				Model->SetCategory(TEXT("TEAMS"));
				FWonderlandLffFeedPage PageOne;
				PageOne.Posts = {PostOf(TEXT("lffp_1")), PostOf(TEXT("lffp_2"))};
				PageOne.NextCursor = TEXT("1760259600000.2");
				Svc->AnswerFeed(0, AnswerOk(), PageOne);
				const bool bCanMore = Model->CanLoadMore();
				Model->LoadMore();
				const FWonderlandLffFeedQuery More = Svc->LastQuery;
				FWonderlandLffFeedPage PageTwo;
				PageTwo.Posts = {PostOf(TEXT("lffp_2")), PostOf(TEXT("lffp_3"))};
				PageTwo.NextCursor = TEXT("1760259600000.1");
				Svc->AnswerFeed(0, AnswerOk(), PageTwo);
				TArray<FString> Ids;
				for (const FWonderlandLffPost& Post : Model->GetFeed())
				{
					Ids.Add(Post.PostId);
				}
				const FString Shown = FString::Join(Ids, TEXT(","));
				Model->LoadMore();
				Model->SetCategory(TEXT("BUILDERS"));
				FWonderlandLffFeedPage LatePage;
				LatePage.Posts = {PostOf(TEXT("lffp_4"))};
				Svc->AnswerFeed(0, AnswerOk(), LatePage);
				const bool bLateDropped = !Model->GetFeed().ContainsByPredicate([](const FWonderlandLffPost& Post) { return Post.PostId == TEXT("lffp_4"); });
				Check(TEXT("LS17"), bCanMore && More.Cursor == TEXT("1760259600000.2") && More.Category == TEXT("TEAMS") && Shown == TEXT("lffp_1,lffp_2,lffp_3") && bLateDropped,
					FString::Printf(TEXT("LOAD MORE sends the cursor and the category; the pages join without a repeat (%s); a page asked before a category change is dropped"), *Shown));
				// LS18: A 429 HOLDS ONLY ITS OWN KIND: a refused create holds the next create (nothing sent), not a read or another write
				Model->Reset();
				Svc->Forget();
				Model->StartCreate();
				Model->SetDraftCategory(TEXT("TEAMS"));
				Model->SetFieldText(EWonderlandLffField::Title, TEXT("Need a team"));
				Model->SubmitForm();
				Svc->AnswerWrite(0, AnswerRefused(429, TEXT("Too many requests; try again in 60 s."), 60), FString());
				Svc->Forget();
				Model->SubmitForm();
				const bool bCreateHeld = Svc->Calls.Num() == 0 && Model->RetryAfterLeft(EWonderlandLffBudget::Post) > 0 && Model->GetActionLine().Contains(TEXT("Try again in"));
				Model->SetPane(EWonderlandLffPane::Feed);
				const bool bReadFree = Svc->Calls.Contains(TEXT("feed")) && Model->RetryAfterLeft(EWonderlandLffBudget::Read) == 0;
				Model->Withdraw(TEXT("lffr_9"));
				const bool bWriteFree = Svc->Calls.Contains(TEXT("lff.request.withdraw lffr_9"));
				Svc->AnswerWrite(0, AnswerOk(), FString());
				// a JOIN is the invitation budget's (routes budgetClassesOf): a create's 429 does not hold it
				OpenWith(TEXT("lffp_8"), DetailOf(TEXT("lffp_8"), false, TEXT("OPEN")));
				const bool bJoinFree = Model->RequestToJoin() && Svc->Calls.Contains(TEXT("request lffp_8"));
				Svc->AnswerWrite(0, AnswerOk(), TEXT("lffr_12"));
				Check(TEXT("LS18"), bCreateHeld && bReadFree && bWriteFree && bJoinFree,
					FString::Printf(TEXT("after a create's 429 the next create is held (%s); controls: a read (%s), another write (%s) and a join (%s) still go"),
						bCreateHeld ? TEXT("yes") : TEXT("NO"), bReadFree ? TEXT("yes") : TEXT("NO"), bWriteFree ? TEXT("yes") : TEXT("NO"), bJoinFree ? TEXT("yes") : TEXT("NO")));
				// LS18B: THE OTHER WAY: a join's 429 holds the next join (the invitation budget), and a create still goes (the post budget)
				Model->Reset();
				OpenWith(TEXT("lffp_8"), DetailOf(TEXT("lffp_8"), false, TEXT("OPEN")));
				Model->RequestToJoin();
				Svc->AnswerWrite(0, AnswerRefused(429, TEXT("Too many requests; try again in 30 s."), 30), FString());
				Svc->Forget();
				Model->RequestToJoin();
				const bool bJoinHeld = Svc->Calls.Num() == 0 && Model->RetryAfterLeft(EWonderlandLffBudget::Invitation) > 0;
				Model->StartCreate();
				Model->SetDraftCategory(TEXT("TEAMS"));
				Model->SetFieldText(EWonderlandLffField::Title, TEXT("Need a team"));
				Model->SubmitForm();
				const bool bCreateFree = Svc->Calls.Contains(TEXT("create")) && Model->RetryAfterLeft(EWonderlandLffBudget::Post) == 0;
				Check(TEXT("LS18B"), bJoinHeld && bCreateFree,
					FString::Printf(TEXT("after a join's 429 the next join is held (%s); control: a create still goes (%s)"),
						bJoinHeld ? TEXT("yes") : TEXT("NO"), bCreateFree ? TEXT("yes") : TEXT("NO")));
				// LS19: MY POSTS -- ALL, then OPEN ONLY (the server's hasOpenSlots), and its LOAD MORE keeps both
				Model->Reset();
				Svc->Forget();
				Model->SetPane(EWonderlandLffPane::MyPosts);
				const bool bAll = Svc->LastQuery.bMine && !Svc->LastQuery.bHasOpenSlots;
				Model->SetMineOpenOnly(true);
				const FWonderlandLffFeedQuery OpenOnly = Svc->LastQuery;
				FWonderlandLffFeedPage OwnPage;
				OwnPage.Posts = {PostOf(TEXT("lffp_7"), true)};
				OwnPage.NextCursor = TEXT("1760259600000.7");
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), OwnPage);
				Model->LoadMoreMine();
				const FWonderlandLffFeedQuery MoreMine = Svc->LastQuery;
				Check(TEXT("LS19"), bAll && OpenOnly.bMine && OpenOnly.bHasOpenSlots && Model->IsMineOpenOnly() && Model->GetMyPosts().Num() == 1 && MoreMine.bMine
					&& MoreMine.bHasOpenSlots && MoreMine.Cursor == TEXT("1760259600000.7"),
					TEXT("MY POSTS asks for all, OPEN ONLY asks hasOpenSlots, and its LOAD MORE keeps both with the cursor"));
				// LS20: A REQUESTER'S PROFILE through the existing profile.read: the card opens; a person the viewer may not see opens nothing
				Svc->Forget();
				FString Opened;
				Model->ReadProfile(TEXT("usr_qa_nova"), [&Opened](const FWonderlandSocialProfileView& OpenedCard) { Opened = OpenedCard.Profile.UserId; });
				const bool bProfileAsked = Svc->Calls.Contains(TEXT("profile usr_qa_nova"));
				FWonderlandSocialProfileView Card;
				Card.Profile.UserId = TEXT("usr_qa_nova");
				Svc->AnswerProfile(0, AnswerOk(), Card);
				FString OpenedHidden;
				Model->ReadProfile(TEXT("usr_qa_hidden"), [&OpenedHidden](const FWonderlandSocialProfileView& Hidden) { OpenedHidden = Hidden.Profile.UserId; });
				Svc->AnswerProfile(0, AnswerRefused(404, TEXT("profile not found")), FWonderlandSocialProfileView());
				Check(TEXT("LS20"), bProfileAsked && Opened == TEXT("usr_qa_nova") && OpenedHidden.IsEmpty() && Model->GetActionLine() == TEXT("That profile is not available to you."),
					TEXT("PROFILE on a requester reads profile.read and opens the card; control: a not-found opens nothing and says so"));
				// LS21: DECLINED IS NOT FINAL (m6): a declined viewer may ask again (the server decides under its own rules)
				FWonderlandLffPostDetail DeclinedDetail = DetailOf(TEXT("lffp_8"), false, TEXT("OPEN"));
				DeclinedDetail.Post.bHasViewerRequest = true;
				DeclinedDetail.Post.ViewerRequestId = TEXT("lffr_8");
				DeclinedDetail.Post.ViewerRequestStatus = TEXT("DECLINED");
				OpenWith(TEXT("lffp_8"), DeclinedDetail);
				Model->SetFieldText(EWonderlandLffField::Note, TEXT("I have more maps now"));
				const bool bAskedAgain = Model->RequestToJoin() && Svc->Calls.Contains(TEXT("request lffp_8"));
				Svc->AnswerWrite(0, AnswerOk(), TEXT("lffr_10"));
				Check(TEXT("LS21"), bAskedAgain, TEXT("after DECLINED, REQUEST AGAIN sends a new request to the post"));
				// LS22: LEAVE (an accepted player's withdrawal) waits for its own press, then withdraws that request
				Svc->Forget();
				Model->AskConfirm(EWonderlandLffConfirm::Leave, TEXT("lffr_11"));
				const bool bLeaveWaits = Svc->Calls.Num() == 0 && Model->GetConfirm() == EWonderlandLffConfirm::Leave && Model->GetConfirmSubject() == TEXT("lffr_11");
				Model->ConfirmPending();
				Check(TEXT("LS22"), bLeaveWaits && Svc->Calls.Contains(TEXT("lff.request.withdraw lffr_11")),
					TEXT("LEAVE asks nothing until CONFIRM, then withdraws exactly that request"));
				Svc->AnswerWrite(0, AnswerOk(), FString());
				// LS23: AN LFF CHANGE WITH TWO FEED PAGES ON SCREEN does not fold them back to page 1 (m10): it says there is new activity;
				// control: with one page, the same change reads the feed again
				Model->Reset();
				Svc->Forget();
				Model->NoteOnScreen(FPlatformTime::Seconds());
				FWonderlandLffFeedPage FirstPage;
				FirstPage.Posts = {PostOf(TEXT("lffp_1"))};
				FirstPage.NextCursor = TEXT("1760259600000.1");
				Svc->AnswerFeed(0, AnswerOk(), FirstPage);
				Model->LoadMore();
				FWonderlandLffFeedPage SecondPage;
				SecondPage.Posts = {PostOf(TEXT("lffp_2"))};
				Svc->AnswerFeed(0, AnswerOk(), SecondPage);
				Svc->Forget();
				Model->NoteOnScreen(FPlatformTime::Seconds());
				Model->HandleServerChange();
				const bool bNoFold = !Svc->Calls.Contains(TEXT("feed")) && Model->HasFeedNews() && Model->GetFeed().Num() == 2
					&& Model->PaneLine(EWonderlandLffPane::Feed).Contains(TEXT("new activity"));
				Model->Reload();
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), FirstPage);
				Svc->Forget();
				Model->NoteOnScreen(FPlatformTime::Seconds());
				Model->HandleServerChange();
				const bool bOnePageReads = Svc->Calls.Contains(TEXT("feed")) && !Model->HasFeedNews();
				Check(TEXT("LS23"), bNoFold && bOnePageReads,
					FString::Printf(TEXT("two pages on screen: a change says 'new activity' and reads no feed (%s); control: one page, the change reads it (%s)"),
						bNoFold ? TEXT("yes") : TEXT("NO"), bOnePageReads ? TEXT("yes") : TEXT("NO")));
				Model->Reset();
			}

			// ======================================================================================== LG: B35, the open gate (R16 privacy, SC1)
			{
				TUniquePtr<FLffQaService> Fake = MakeUnique<FLffQaService>();
				FLffQaService* Svc = Fake.Get();
				const TSharedRef<FWonderlandLffModel> Model = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
				const FString Updating = TEXT("Updating…");
				// LG1: A FEED READ BEFORE THE OPEN is withheld from the open on: "Updating…", Describe names no post and states the gate; the tab
				// was on screen, so the read after the open went at once. Controls: before the open the same model listed the post (gate none),
				// and after it the model still HOLDS it (only drawing waits)
				Model->NoteOnScreen(FPlatformTime::Seconds());
				FWonderlandLffFeedPage Cached;
				Cached.Posts = {PostOf(TEXT("lffp_70"))};
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), Cached);
				const FString BeforeOpen = Model->Describe();
				const bool bListedBefore = BeforeOpen.Contains(TEXT("lffp_70")) && BeforeOpen.Contains(TEXT("| gate none")) && !Model->IsPaneWithheld(EWonderlandLffPane::Feed);
				// LG14 (R3-01): the feed read's landed line lists the post it fed and that post's author (written after the page is in)
				const FString FedNote = Model->GetLastLandedNote();
				const FString FedAuthor = PostOf(TEXT("lffp_70")).Author.UserId;
				Check(TEXT("LG14"), FedNote.StartsWith(TEXT("feed ")) && FedNote.Contains(TEXT("posts lffp_70")) && !FedAuthor.IsEmpty() && FedNote.Contains(FedAuthor),
					FString::Printf(TEXT("the landed feed line lists the fed post and its author (%s): %s"), *FedAuthor, *FedNote));
				Svc->Forget();
				Model->BeginOpenGate(LffQaLater());
				const FString AfterOpen = Model->Describe();
				const bool bWithheld = Model->IsPaneWithheld(EWonderlandLffPane::Feed) && Model->IsGateUp() && Model->PaneLine(EWonderlandLffPane::Feed) == Updating
					&& !AfterOpen.Contains(TEXT("lffp_70")) && AfterOpen.Contains(TEXT("| gate UPDATING (FEED)"));
				Check(TEXT("LG1"), bListedBefore && bWithheld && Model->GetFeed().Num() == 1 && Svc->Calls.Contains(TEXT("feed")),
					FString::Printf(TEXT("after the open a feed read before it is withheld: 'Updating', no id in Describe, the gate stated (%s), and a read asked at once (%s); controls: listed before the open (%s), still held by the model (%d)"),
						bWithheld ? TEXT("yes") : TEXT("NO"), Svc->Calls.Contains(TEXT("feed")) ? TEXT("yes") : TEXT("NO"), bListedBefore ? TEXT("yes") : TEXT("NO"), Model->GetFeed().Num()));
				// LG3: THE READ ASKED AFTER THE OPEN LANDS: the gate lifts, the new page is listed
				FWonderlandLffFeedPage FreshPage;
				FreshPage.Posts = {PostOf(TEXT("lffp_71"))};
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), FreshPage);
				const FString Lifted = Model->Describe();
				Check(TEXT("LG3"), !Model->IsPaneWithheld(EWonderlandLffPane::Feed) && !Model->IsGateUp() && Lifted.Contains(TEXT("lffp_71")) && Lifted.Contains(TEXT("| gate fresh"))
					&& Model->PaneLine(EWonderlandLffPane::Feed).IsEmpty(),
					TEXT("a read asked after the open lands: the feed is listed again and the gate reads fresh"));
				// LG2: A READ ASKED BEFORE THE OPEN THAT LANDS AFTER IT never lifts the gate (it may predate a block); control: the read the next
				// NoteOnScreen asks does
				Svc->Forget();
				Model->NoteOnScreen(FPlatformTime::Seconds() - 10.0);   // last drawn ten seconds ago: the hub is closed
				Model->Reload();                                        // a read on its way while the hub is closed
				Model->BeginOpenGate(LffQaLater());                     // not on screen: nothing more is asked
				const int32 AskedByOpen = Svc->Calls.Num();
				FWonderlandLffFeedPage LatePage;
				LatePage.Posts = {PostOf(TEXT("lffp_72"))};
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), LatePage);
				const bool bLateWithheld = Model->GetFeed().Num() == 1 && Model->GetFeed()[0].PostId == TEXT("lffp_72") && Model->IsPaneWithheld(EWonderlandLffPane::Feed)
					&& Model->PaneLine(EWonderlandLffPane::Feed) == Updating && !Model->Describe().Contains(TEXT("lffp_72"));
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bAskedAgain = Svc->Calls.Num() == 2;
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), LatePage);
				const bool bLiftedAgain = !Model->IsPaneWithheld(EWonderlandLffPane::Feed) && Model->Describe().Contains(TEXT("lffp_72"));
				Check(TEXT("LG2"), AskedByOpen == 1 && bLateWithheld && bAskedAgain && bLiftedAgain,
					FString::Printf(TEXT("a read asked before the open lands after it and the feed stays withheld (%s); control: the read asked when the tab is next shown (%s) lifts it (%s)"),
						bLateWithheld ? TEXT("yes") : TEXT("NO"), bAskedAgain ? TEXT("yes") : TEXT("NO"), bLiftedAgain ? TEXT("yes") : TEXT("NO")));
				// LG4: THE READ AFTER THE OPEN FAILS: still withheld, the failure said -- never a fall back to what was read before; control: REFRESH
				Svc->Forget();
				Model->BeginOpenGate(LffQaLater());   // on screen (just shown): asked at once
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerRefused(503, TEXT("Wonderland social is unavailable")), FWonderlandLffFeedPage());
				const FString FailedLine = Model->PaneLine(EWonderlandLffPane::Feed);
				const FString FailedSaid = Model->Describe();
				const bool bFailWithheld = Model->IsPaneWithheld(EWonderlandLffPane::Feed) && FailedLine.Contains(TEXT("unavailable")) && Model->GetFeed().Num() == 1
					&& !FailedSaid.Contains(TEXT("lffp_72")) && FailedSaid.Contains(TEXT("feed WITHHELD (failed)"));
				Model->Reload();
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), LatePage);
				Check(TEXT("LG4"), bFailWithheld && !Model->IsPaneWithheld(EWonderlandLffPane::Feed),
					FString::Printf(TEXT("a failed read after the open keeps the feed withheld and says why (%s); control: REFRESH's read lifts it"), bFailWithheld ? TEXT("yes") : TEXT("NO")));
				// LG5: A FURTHER PAGE never lifts the gate (earlier pages may predate the open), and LOAD MORE asks nothing while withheld;
				// control: LOAD MORE was offered before the open
				Model->Reset();
				Svc->Forget();
				Model->NoteOnScreen(FPlatformTime::Seconds());
				FWonderlandLffFeedPage PageOne;
				PageOne.Posts = {PostOf(TEXT("lffp_73"))};
				PageOne.NextCursor = TEXT("1760259600000.3");
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), PageOne);
				const bool bMoreBefore = Model->CanLoadMore();
				Model->LoadMore();                                      // asked before the open
				Model->NoteOnScreen(FPlatformTime::Seconds() - 10.0);   // the hub closed
				Model->BeginOpenGate(LffQaLater());
				FWonderlandLffFeedPage PageTwo;
				PageTwo.Posts = {PostOf(TEXT("lffp_74"))};
				PageTwo.NextCursor = TEXT("1760259600000.2");
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), PageTwo);
				const bool bPageTwoWithheld = Model->GetFeed().Num() == 2 && Model->IsPaneWithheld(EWonderlandLffPane::Feed);
				Svc->Forget();
				Model->LoadMore();
				const bool bNoMore = !Model->CanLoadMore() && Svc->Calls.Num() == 0;
				Check(TEXT("LG5"), bMoreBefore && bPageTwoWithheld && bNoMore,
					FString::Printf(TEXT("a further page landing after the open keeps the feed withheld (%s); LOAD MORE asks nothing while withheld (%s); control: offered before the open (%s)"),
						bPageTwoWithheld ? TEXT("yes") : TEXT("NO"), bNoMore ? TEXT("yes") : TEXT("NO"), bMoreBefore ? TEXT("yes") : TEXT("NO")));
				// LG6: THE OPEN POST, ITS OWNER'S INBOX AND A REQUESTER'S CARD read before the open: withheld (no post id, no request id), the card
				// asked before it opens nothing; control: the reads the next NoteOnScreen asks lift both, and a card asked after opens
				Model->Reset();
				Svc->Forget();
				Model->OpenPost(TEXT("lffp_80"));
				FWonderlandLffPostDetail Own;
				Own.Post = PostOf(TEXT("lffp_80"), true);
				Svc->AnswerPost(Svc->Posts.Num() - 1, AnswerOk(), Own);
				FWonderlandLffIncomingRequest Asked;
				Asked.RequestId = TEXT("lffr_80");
				Asked.Status = TEXT("PENDING");
				Asked.Requester = Own.Post.Author;
				FWonderlandLffPostRequests Inbox;
				Inbox.PostId = TEXT("lffp_80");
				Inbox.Requests = {Asked};
				Svc->AnswerInbox(Svc->Inboxes.Num() - 1, AnswerOk(), Inbox);
				const FString BeforeGate = Model->Describe();
				const bool bShownBefore = BeforeGate.Contains(TEXT("lffp_80")) && BeforeGate.Contains(TEXT("lffr_80")) && !Model->IsDetailWithheld();
				FString CardOpened;
				Model->ReadProfile(TEXT("usr_qa_nova"), [&CardOpened](const FWonderlandSocialProfileView& OpenedCard) { CardOpened = OpenedCard.Profile.UserId; });
				Model->BeginOpenGate(LffQaLater());   // never shown since the reset: nothing asked
				FWonderlandSocialProfileView NovaCard;
				NovaCard.Profile.UserId = TEXT("usr_qa_nova");
				Svc->AnswerProfile(Svc->Profiles.Num() - 1, AnswerOk(), NovaCard);
				const FString WhileGated = Model->Describe();
				const bool bPostWithheld = Model->HasDetail() && Model->IsDetailWithheld() && Model->IsInboxWithheld() && Model->DetailLine() == Updating
					&& Model->InboxLine() == Updating && !WhileGated.Contains(TEXT("lffp_80")) && !WhileGated.Contains(TEXT("lffr_80"))
					&& WhileGated.Contains(TEXT("| gate UPDATING (FEED, POST)")) && CardOpened.IsEmpty();
				Svc->Forget();
				Model->NoteOnScreen(FPlatformTime::Seconds());
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), FWonderlandLffFeedPage());
				Svc->AnswerPost(Svc->Posts.Num() - 1, AnswerOk(), Own);
				Svc->AnswerInbox(Svc->Inboxes.Num() - 1, AnswerOk(), Inbox);
				const FString AfterReads = Model->Describe();
				Model->ReadProfile(TEXT("usr_qa_nova"), [&CardOpened](const FWonderlandSocialProfileView& OpenedCard) { CardOpened = OpenedCard.Profile.UserId; });
				Svc->AnswerProfile(Svc->Profiles.Num() - 1, AnswerOk(), NovaCard);
				const bool bPostFresh = !Model->IsDetailWithheld() && !Model->IsInboxWithheld() && AfterReads.Contains(TEXT("lffp_80")) && AfterReads.Contains(TEXT("lffr_80"))
					&& AfterReads.Contains(TEXT("| gate fresh")) && CardOpened == TEXT("usr_qa_nova");
				Check(TEXT("LG6"), bShownBefore && bPostWithheld && bPostFresh,
					FString::Printf(TEXT("an open post, its inbox and a requester's card read before the open are withheld and open nothing (%s); controls: shown before (%s), shown again and a card opens after reads asked after the open (%s)"),
						bPostWithheld ? TEXT("yes") : TEXT("NO"), bShownBefore ? TEXT("yes") : TEXT("NO"), bPostFresh ? TEXT("yes") : TEXT("NO")));
				// LG8: THE AGE RULE -- a feed whose landed read was asked 4.5 s ago is withheld (no answer, no 429 needed); control: at 3.0 s it
				// is drawn. QaShiftClock moves every kept time back, as if that long had passed (nothing is read meanwhile: no NoteOnScreen)
				Model->Reset();
				Svc->Forget();
				Model->BeginOpenGate(LffQaLater());
				Model->NoteOnScreen(FPlatformTime::Seconds());
				FWonderlandLffFeedPage AgedPage;
				AgedPage.Posts = {PostOf(TEXT("lffp_100"))};
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), AgedPage);
				const bool bFreshLanded = !Model->IsPaneWithheld(EWonderlandLffPane::Feed);
				Model->QaShiftClock(3.0);
				const FString AtThree = Model->Describe();
				const bool bDrawsAtThree = !Model->IsPaneWithheld(EWonderlandLffPane::Feed) && AtThree.Contains(TEXT("lffp_100")) && AtThree.Contains(TEXT("| gate fresh"));
				Model->QaShiftClock(1.5);
				const FString AtFourHalf = Model->Describe();
				const bool bWithheldAtFourHalf = Model->IsPaneWithheld(EWonderlandLffPane::Feed) && Model->PaneLine(EWonderlandLffPane::Feed) == Updating
					&& !AtFourHalf.Contains(TEXT("lffp_100")) && AtFourHalf.Contains(TEXT("| gate UPDATING (FEED)")) && Model->GetFeed().Num() == 1;
				Check(TEXT("LG8"), bFreshLanded && bDrawsAtThree && bWithheldAtFourHalf,
					FString::Printf(TEXT("a feed read asked 4.5 s ago is withheld, held by the model but not drawn or described (%s); control: asked 3.0 s ago it is drawn (%s)"),
						bWithheldAtFourHalf ? TEXT("yes") : TEXT("NO"), bDrawsAtThree ? TEXT("yes") : TEXT("NO")));
				// LG9: THE PERIOD -- on screen, a part is asked again 2.0 s after its last ask, ONE at a time; control: not at 1.0 s
				Svc->Forget();
				Model->NoteOnScreen(FPlatformTime::Seconds());   // 4.5 s since asked: due
				const bool bAskedOnce = Svc->Calls.Num() == 1 && Svc->Calls[0] == TEXT("feed");
				Model->NoteOnScreen(FPlatformTime::Seconds());   // that read on its way: nothing more
				const bool bOneAtATime = Svc->Calls.Num() == 1;
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), AgedPage);
				const bool bFreshAgain = !Model->IsPaneWithheld(EWonderlandLffPane::Feed);
				Svc->Forget();
				Model->QaShiftClock(1.0);
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bNotEarly = Svc->Calls.Num() == 0;
				Model->QaShiftClock(1.1);
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bDueAtTwo = Svc->Calls.Num() == 1 && Svc->Calls[0] == TEXT("feed");
				Check(TEXT("LG9"), bAskedOnce && bOneAtATime && bFreshAgain && bNotEarly && bDueAtTwo,
					FString::Printf(TEXT("an expired feed is asked again at once (%s) and only once while on its way (%s), its answer shows it (%s); asked again 2.1 s after (%s); control: not at 1.0 s (%s)"),
						bAskedOnce ? TEXT("yes") : TEXT("NO"), bOneAtATime ? TEXT("yes") : TEXT("NO"), bFreshAgain ? TEXT("yes") : TEXT("NO"), bDueAtTwo ? TEXT("yes") : TEXT("NO"),
						bNotEarly ? TEXT("yes") : TEXT("NO")));
				// LG10: A FAILED READ BACKS OFF (never once a frame): after a 503 nothing at 2.1 s, one at 4.1 s; a 429 holds every periodic read
				// while it waits and the feed stays withheld by its age, saying why -- never the old rows
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerRefused(503, TEXT("Wonderland social is unavailable")), FWonderlandLffFeedPage());
				Svc->Forget();
				Model->QaShiftClock(2.1);
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bBackedOff = Svc->Calls.Num() == 0;
				Model->QaShiftClock(2.0);
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bRetried = Svc->Calls.Num() == 1;
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerRefused(429, TEXT("Too many requests; try again in 60 s."), 60), FWonderlandLffFeedPage());
				Svc->Forget();
				Model->QaShiftClock(8.5);   // past the back-off (8 s after two failures), well inside the 429's 60 s
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bHeld = Svc->Calls.Num() == 0 && Model->IsPaneWithheld(EWonderlandLffPane::Feed)
					&& Model->PaneLine(EWonderlandLffPane::Feed).Contains(TEXT("Too many requests")) && !Model->Describe().Contains(TEXT("lffp_100"));
				Check(TEXT("LG10"), bBackedOff && bRetried && bHeld,
					FString::Printf(TEXT("after a failed read nothing is asked at 2.1 s (%s), one read at 4.1 s (%s); a 429 asks nothing while it waits and the feed is withheld, saying why (%s)"),
						bBackedOff ? TEXT("yes") : TEXT("NO"), bRetried ? TEXT("yes") : TEXT("NO"), bHeld ? TEXT("yes") : TEXT("NO")));
				// LG11: MORE THAN ONE PAGE: the period reads page 1 again (no cursor) and the further page folds -- privacy over m10; control:
				// both pages were shown before
				Model->Reset();
				Svc->Forget();
				Model->BeginOpenGate(LffQaLater());
				Model->NoteOnScreen(FPlatformTime::Seconds());
				FWonderlandLffFeedPage FirstOfTwo;
				FirstOfTwo.Posts = {PostOf(TEXT("lffp_110"))};
				FirstOfTwo.NextCursor = TEXT("1760259600000.9");
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), FirstOfTwo);
				Model->LoadMore();
				FWonderlandLffFeedPage SecondOfTwo;
				SecondOfTwo.Posts = {PostOf(TEXT("lffp_111"))};
				SecondOfTwo.NextCursor = TEXT("1760259600000.8");
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), SecondOfTwo);
				const bool bTwoPages = Model->GetFeed().Num() == 2 && !Model->IsPaneWithheld(EWonderlandLffPane::Feed);
				Svc->Forget();
				Model->QaShiftClock(2.1);
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bPageOneAsked = Svc->Calls.Num() == 1 && Svc->LastQuery.Cursor.IsEmpty();
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), FirstOfTwo);
				const bool bFolded = Model->GetFeed().Num() == 1 && Model->GetFeed()[0].PostId == TEXT("lffp_110") && !Model->IsPaneWithheld(EWonderlandLffPane::Feed);
				Check(TEXT("LG11"), bTwoPages && bPageOneAsked && bFolded,
					FString::Printf(TEXT("with two pages shown the period asks page 1 (%s) and the second page folds (%s); control: two pages before (%s)"),
						bPageOneAsked ? TEXT("yes") : TEXT("NO"), bFolded ? TEXT("yes") : TEXT("NO"), bTwoPages ? TEXT("yes") : TEXT("NO")));
				// LG12: THE OPEN POST IS READ ON THE PERIOD too, and its periodic answer never replaces an inbox read still on its way (a slow inbox
				// would never land); that inbox, landing, shows the requesters
				Model->Reset();
				Svc->Forget();
				Model->BeginOpenGate(LffQaLater());
				Model->OpenPost(TEXT("lffp_120"));
				Model->NoteOnScreen(FPlatformTime::Seconds());   // stale since the reset: the feed and the post
				FWonderlandLffPostDetail OwnTwelve;
				OwnTwelve.Post = PostOf(TEXT("lffp_120"), true);
				Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), FWonderlandLffFeedPage());
				Svc->AnswerPost(Svc->Posts.Num() - 1, AnswerOk(), OwnTwelve);   // its inbox is asked, and left on its way
				const int32 InboxesOnTheirWay = Svc->Inboxes.Num();
				const int32 PostsBefore = Svc->Posts.Num();
				Model->QaShiftClock(2.1);
				Model->NoteOnScreen(FPlatformTime::Seconds());
				const bool bPostReread = Svc->Posts.Num() == PostsBefore + 1;
				Svc->AnswerPost(Svc->Posts.Num() - 1, AnswerOk(), OwnTwelve);
				const bool bInboxNotReplaced = InboxesOnTheirWay == 1 && Svc->Inboxes.Num() == 1;
				FWonderlandLffPostRequests TwelveInbox;
				TwelveInbox.PostId = TEXT("lffp_120");
				Svc->AnswerInbox(0, AnswerOk(), TwelveInbox);
				const bool bInboxLanded = !Model->IsInboxWithheld() && !Model->IsDetailWithheld();
				Check(TEXT("LG12"), bPostReread && bInboxNotReplaced && bInboxLanded,
					FString::Printf(TEXT("the open post is read on the period (%s); its answer leaves the inbox read on its way alone (%s), which lands (%s)"),
						bPostReread ? TEXT("yes") : TEXT("NO"), bInboxNotReplaced ? TEXT("yes") : TEXT("NO"), bInboxLanded ? TEXT("yes") : TEXT("NO")));
				Model->Reset();
			}

			// ======================================================================================== LH: the hub, drafts across refreshes
			{
				SWonderlandSocialHubPanel::ETab Parsed = SWonderlandSocialHubPanel::ETab::Friends;
				SWonderlandSocialHubPanel::ETab Unparsed = SWonderlandSocialHubPanel::ETab::Friends;
				Check(TEXT("LH5"), SWonderlandSocialHubPanel::ParseTab(TEXT("LFF"), Parsed) && Parsed == SWonderlandSocialHubPanel::ETab::Lff
					&& FCString::Strcmp(SWonderlandSocialHubPanel::TabName(SWonderlandSocialHubPanel::ETab::Lff), TEXT("LFF")) == 0
					&& !SWonderlandSocialHubPanel::ParseTab(TEXT("lfg"), Unparsed),
					TEXT("the sixth tab parses from 'lff' (any case) and is named LFF; control: 'lfg' is no tab"));
				if (!FSlateApplication::IsInitialized())
				{
					Check(TEXT("LH1"), false, TEXT("no Slate in this session: the hub checks need a game with Slate"));
				}
				else
				{
					TUniquePtr<FLffQaService> Fake = MakeUnique<FLffQaService>();
					FLffQaService* Svc = Fake.Get();
					const TSharedRef<FWonderlandLffModel> Model = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
					FWonderlandSocialSnapshot Fed;
					Fed.ViewerId = TEXT("usr_qa_viewer");
					// an OFF-SCREEN hub (never drawn: no synthetic post reaches a screen) on the LFF tab
					const TSharedRef<SWonderlandSocialHubPanel> Hub = SNew(SWonderlandSocialHubPanel)
						.Snapshot(Fed).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Lff).Lff(Model);
					const TSharedPtr<SWonderlandSocialLffView> View = Hub->QaLffView();
					// LHC THE PLACEMENT CHECK'S CONTROL: on the FEED pane the title box is NOT in the layout, the filter box is
					const bool bFeedLayout = View.IsValid() && !View->QaIsPlaced(EWonderlandLffField::Title) && View->QaIsPlaced(EWonderlandLffField::ProjectFilter);
					Model->StartCreate();
					if (View.IsValid())
					{
						View->FlushRebuild();
					}
					const FString Typed = TEXT("Need a level designer");
					const bool bTyped = View.IsValid() && View->QaTypeInto(EWonderlandLffField::Title, Typed);
					// LH1: A LIVE REFRESH LANDS while the player types (SetSnapshot, as every 2-s event makes it): the same view, the same box, placed
					Hub->SetSnapshot(Fed, true, FString(), false);
					Hub->FlushRebuild();
					const TSharedPtr<SWonderlandSocialLffView> After = Hub->QaLffView();
					if (After.IsValid())
					{
						After->FlushRebuild();
					}
					Check(TEXT("LH1"), bTyped && After == View && After.IsValid() && After->QaFieldText(EWonderlandLffField::Title) == Typed
						&& After->QaIsPlaced(EWonderlandLffField::Title) && Model->GetDraft().Title == Typed,
						FString::Printf(TEXT("a draft survives a hub refresh: the same view (%s), its title box placed in the form and holding the text, the model too"),
							After == View ? TEXT("yes") : TEXT("NO")));
					Check(TEXT("LHC"), bFeedLayout, TEXT("control: on the FEED pane the title box is not placed (the placement check can fail)"));
					// LH2: A MODEL CHANGE (an answer: the slot count here) rebuilds the view -- the same box is re-slotted INTO THE NEW LAYOUT, not emptied
					Model->AdjustSlots(1);
					const bool bRebuildAsked = View.IsValid() && View->QaRebuildPending();
					if (View.IsValid())
					{
						View->FlushRebuild();
					}
					Check(TEXT("LH2"), bRebuildAsked && View.IsValid() && View->QaFieldText(EWonderlandLffField::Title) == Typed && View->QaIsPlaced(EWonderlandLffField::Title)
						&& Model->GetDraft().OpenSlots == 2,
						TEXT("the view's own rebuild (a model change) puts the same title box into the new layout, its text kept"));
					// LH7: TYPED THROUGH THE WIDGET (the box itself, not the model), then a rebuild: the text is still in the box now placed; and
					// leaving the form takes the box out of the tree (the walk up its parents no longer reaches the view)
					bool bWidgetTyped = false;
					if (View.IsValid() && View->QaBox(EWonderlandLffField::Description).IsValid())
					{
						View->QaBox(EWonderlandLffField::Description)->SetText(FText::FromString(TEXT("typed in the box")));
						bWidgetTyped = true;
					}
					Model->AdjustSlots(-1);
					if (View.IsValid())
					{
						View->FlushRebuild();
					}
					const bool bWidgetKept = bWidgetTyped && View->QaFieldText(EWonderlandLffField::Description) == TEXT("typed in the box")
						&& View->QaIsPlaced(EWonderlandLffField::Description);
					Model->SetPane(EWonderlandLffPane::Feed);
					if (View.IsValid())
					{
						View->FlushRebuild();
					}
					const bool bLeftTree = View.IsValid() && !View->QaIsPlaced(EWonderlandLffField::Title) && View->QaIsPlaced(EWonderlandLffField::ProjectFilter);
					Check(TEXT("LH7"), bWidgetKept && bLeftTree,
						FString::Printf(TEXT("text typed into the placed box survives a rebuild in that box (%s); off the form the title box is no longer in the tree (%s)"),
							bWidgetKept ? TEXT("yes") : TEXT("NO"), bLeftTree ? TEXT("yes") : TEXT("NO")));
					// LH3: THE HUB OPENED AGAIN (a new panel, a new view, as back from a profile): the draft comes back from the model
					Model->StartCreate();
					const TSharedRef<SWonderlandSocialHubPanel> Reopened = SNew(SWonderlandSocialHubPanel)
						.Snapshot(Fed).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Lff).Lff(Model);
					const TSharedPtr<SWonderlandSocialLffView> ReopenedView = Reopened->QaLffView();
					Check(TEXT("LH3"), ReopenedView.IsValid() && ReopenedView != View && ReopenedView->QaFieldText(EWonderlandLffField::Title) == Typed
						&& ReopenedView->QaIsPlaced(EWonderlandLffField::Title),
						TEXT("a reopened hub's new view shows the draft the model kept, in its placed title box"));
					// LH4 THE CONTROL: a hub over a FRESH model shows an empty box (so LH3 can fail)
					const TSharedRef<FWonderlandLffModel> Fresh = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
					Fresh->StartCreate();
					const TSharedRef<SWonderlandSocialHubPanel> Other = SNew(SWonderlandSocialHubPanel)
						.Snapshot(Fed).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Lff).Lff(Fresh);
					const TSharedPtr<SWonderlandSocialLffView> OtherView = Other->QaLffView();
					if (OtherView.IsValid())
					{
						OtherView->FlushRebuild();
					}
					const FString HubLine = Hub->Describe();
					Check(TEXT("LH4"), OtherView.IsValid() && OtherView->QaFieldText(EWonderlandLffField::Title).IsEmpty() && HubLine.Contains(TEXT("| lff pane FORM"))
						&& !HubLine.Contains(Typed),
						TEXT("control: a fresh model's hub has an empty title box; the hub's LFF line names the pane, never the typed title"));
					// LH6: THE PREVIEW, AS BUILT: the needs-live body and no post card (the preview service, as a developer session's); control: a
					// live model with one post builds its card
					TUniquePtr<FWonderlandSocialPreviewService> Preview = MakeUnique<FWonderlandSocialPreviewService>();
					FWonderlandSocialPreviewService* PreviewService = Preview.Get();
					const TSharedRef<FWonderlandLffModel> PreviewModel = MakeShared<FWonderlandLffModel>([PreviewService]() -> IWonderlandSocialService* { return PreviewService; });
					PreviewModel->NoteOnScreen(FPlatformTime::Seconds());
					const TSharedRef<SWonderlandSocialHubPanel> PreviewHub = SNew(SWonderlandSocialHubPanel)
						.Snapshot(FWonderlandSocialSnapshot()).bConnected(true).bDevelopmentPreview(true).InitialTab(SWonderlandSocialHubPanel::ETab::Lff).Lff(PreviewModel);
					const TSharedPtr<SWonderlandSocialLffView> PreviewView = PreviewHub->QaLffView();
					if (PreviewView.IsValid())
					{
						PreviewView->FlushRebuild();
					}
					const TSharedRef<FWonderlandLffModel> LiveModel = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
					Svc->Forget();
					LiveModel->NoteOnScreen(FPlatformTime::Seconds());
					FWonderlandLffFeedPage OnePost;
					OnePost.Posts = {PostOf(TEXT("lffp_50"))};
					Svc->AnswerFeed(Svc->Feeds.Num() - 1, AnswerOk(), OnePost);
					const TSharedRef<SWonderlandSocialHubPanel> LiveHub = SNew(SWonderlandSocialHubPanel)
						.Snapshot(Fed).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Lff).Lff(LiveModel);
					const TSharedPtr<SWonderlandSocialLffView> LiveView = LiveHub->QaLffView();
					if (LiveView.IsValid())
					{
						LiveView->FlushRebuild();
					}
					Check(TEXT("LH6"), PreviewModel->NeedsLive() && PreviewModel->GetFeed().Num() == 0 && PreviewView.IsValid() && PreviewView->QaBuiltNeedsLive()
						&& PreviewView->QaBuiltPostCards() == 0 && LiveView.IsValid() && !LiveView->QaBuiltNeedsLive() && LiveView->QaBuiltPostCards() == 1,
						FString::Printf(TEXT("the preview's LFF tab BUILT the needs-live body and %d post cards; control: a live model with one post built %d card"),
							PreviewView.IsValid() ? PreviewView->QaBuiltPostCards() : -1, LiveView.IsValid() ? LiveView->QaBuiltPostCards() : -1));
					// LH8: REQUEST AGAIN, AS DRAWN: a DECLINED request on an OPEN post builds the note box and the REQUEST AGAIN button; controls: a
					// PENDING one builds neither, and no request at all builds REQUEST TO JOIN
					const auto ShowDetail = [&Model, Svc, &View](const FString& PostId, const FString& RequestStatus)
					{
						FWonderlandLffPostDetail Detail;
						Detail.Post = PostOf(PostId);
						Detail.Post.bHasViewerRequest = !RequestStatus.IsEmpty();
						Detail.Post.ViewerRequestId = RequestStatus.IsEmpty() ? FString() : FString(TEXT("lffr_60"));
						Detail.Post.ViewerRequestStatus = RequestStatus;
						Svc->Forget();
						Model->OpenPost(PostId);
						Svc->AnswerPost(Svc->Posts.Num() - 1, AnswerOk(), Detail);
						Svc->Forget();
						if (View.IsValid())
						{
							View->FlushRebuild();
						}
					};
					Model->SetPane(EWonderlandLffPane::Feed);
					ShowDetail(TEXT("lffp_60"), TEXT("DECLINED"));
					const bool bAgainDrawn = View.IsValid() && View->QaIsPlaced(EWonderlandLffField::Note) && View->QaBuiltAskLabel() == TEXT("REQUEST AGAIN");
					ShowDetail(TEXT("lffp_61"), TEXT("PENDING"));
					const bool bPendingNoAsk = View.IsValid() && !View->QaIsPlaced(EWonderlandLffField::Note) && View->QaBuiltAskLabel().IsEmpty();
					ShowDetail(TEXT("lffp_62"), FString());
					const bool bFirstAsk = View.IsValid() && View->QaIsPlaced(EWonderlandLffField::Note) && View->QaBuiltAskLabel() == TEXT("REQUEST TO JOIN");
					Check(TEXT("LH8"), bAgainDrawn && bPendingNoAsk && bFirstAsk,
						FString::Printf(TEXT("DECLINED on an open post draws the note and REQUEST AGAIN (%s); controls: PENDING draws neither (%s), no request draws REQUEST TO JOIN (%s)"),
							bAgainDrawn ? TEXT("yes") : TEXT("NO"), bPendingNoAsk ? TEXT("yes") : TEXT("NO"), bFirstAsk ? TEXT("yes") : TEXT("NO")));
					// LH9: A REQUESTER'S PROFILE IS NEVER OPENED FROM THE ANSWER (F-21): the card is kept and opens at the next pre-tick while the view
					// was drawn ONE frame before (what a real pre-tick reads); controls: a not-found opens nothing, a view drawn TWO frames before
					// (the hub closed) opens nothing, a view never drawn opens nothing. Valid at any engine frame, frame 0 included; the never-drawn
					// control can only FAIL at frames 0-1 (every -ExecCmds run), the only frames where a never-drawn view's distance is <= 1
					int32 ProfileOpens = 0;
					FString ProfileOpened;
					const TSharedRef<FWonderlandLffModel> ProfileModel = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
					const TSharedRef<SWonderlandSocialHubPanel> ProfileHub = SNew(SWonderlandSocialHubPanel)
						.Snapshot(Fed).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Lff).Lff(ProfileModel)
						.OnOpenProfileView_Lambda([&ProfileOpens, &ProfileOpened](const FWonderlandSocialProfileView& OpenedCard)
						{
							ProfileOpens += 1;
							ProfileOpened = OpenedCard.Profile.UserId;
						});
					const TSharedPtr<SWonderlandSocialLffView> ProfileView = ProfileHub->QaLffView();
					bool bQueued = false;
					bool bOpenedAtPreTick = false;
					bool bNotFoundNothing = false;
					bool bClosedNothing = false;
					bool bNeverDrawnNothing = false;
					if (ProfileView.IsValid())
					{
						Svc->Forget();
						ProfileView->QaOpenProfileOf(TEXT("usr_qa_nova"));
						FWonderlandSocialProfileView NovaCard;
						NovaCard.Profile.UserId = TEXT("usr_qa_nova");
						Svc->AnswerProfile(Svc->Profiles.Num() - 1, AnswerOk(), NovaCard);
						bQueued = ProfileOpens == 0 && ProfileView->QaProfileOpenPending();
						ProfileView->QaNoteDrawn(true);   // the hub on screen: drawn ONE frame before this pre-tick, as a real pre-tick reads it
						ProfileView->QaRunPreTick();
						bOpenedAtPreTick = ProfileOpens == 1 && ProfileOpened == TEXT("usr_qa_nova") && !ProfileView->QaProfileOpenPending();
						ProfileView->QaOpenProfileOf(TEXT("usr_qa_hidden"));
						Svc->AnswerProfile(Svc->Profiles.Num() - 1, AnswerRefused(404, TEXT("profile not found")), FWonderlandSocialProfileView());
						ProfileView->QaRunPreTick();
						bNotFoundNothing = ProfileOpens == 1 && !ProfileView->QaProfileOpenPending();
						// THE HUB CLOSED before a readable card arrived: the queued open is dropped at the pre-tick, nothing opens over the world
						ProfileView->QaOpenProfileOf(TEXT("usr_qa_nova"));
						Svc->AnswerProfile(Svc->Profiles.Num() - 1, AnswerOk(), NovaCard);
						const bool bQueuedAgain = ProfileView->QaProfileOpenPending();
						ProfileView->QaNoteDrawn(false);   // drawn TWO frames before this pre-tick: the nearest distance that must drop
						ProfileView->QaRunPreTick();
						bClosedNothing = bQueuedAgain && ProfileOpens == 1 && !ProfileView->QaProfileOpenPending();
						// control: a view NEVER drawn opens nothing (at frames 0-1 only bEverDrawn tells it from "drawn last frame")
						ProfileView->QaOpenProfileOf(TEXT("usr_qa_nova"));
						Svc->AnswerProfile(Svc->Profiles.Num() - 1, AnswerOk(), NovaCard);
						const bool bQueuedThird = ProfileView->QaProfileOpenPending();
						ProfileView->QaNoteNeverDrawn();
						ProfileView->QaRunPreTick();
						bNeverDrawnNothing = bQueuedThird && ProfileOpens == 1 && !ProfileView->QaProfileOpenPending();
					}
					Check(TEXT("LH9"), bQueued && bOpenedAtPreTick && bNotFoundNothing && bClosedNothing && bNeverDrawnNothing,
						FString::Printf(TEXT("a requester's card is kept by the answer, not opened (%s), and opens at the next pre-tick while the hub is on screen (%s); controls: a not-found opens nothing (%s), a card arriving after the hub closed opens nothing (%s), a view never drawn opens nothing (%s) [engine frame %llu]"),
							bQueued ? TEXT("yes") : TEXT("NO"), bOpenedAtPreTick ? TEXT("yes") : TEXT("NO"), bNotFoundNothing ? TEXT("yes") : TEXT("NO"),
							bClosedNothing ? TEXT("yes") : TEXT("NO"), bNeverDrawnNothing ? TEXT("yes") : TEXT("NO"), GFrameCounter));
					// LG7 (B35): AS BUILT -- an off-screen hub whose model holds a feed and an open post read BEFORE the open builds no post card
					// and no person row and says "Updating"; controls: the same view built them before the open, and builds them again once the
					// reads asked after it have landed
					TUniquePtr<FLffQaService> GateFake = MakeUnique<FLffQaService>();
					FLffQaService* GateSvc = GateFake.Get();
					const TSharedRef<FWonderlandLffModel> GateModel = MakeShared<FWonderlandLffModel>([GateSvc]() -> IWonderlandSocialService* { return GateSvc; });
					const TSharedRef<SWonderlandSocialHubPanel> GateHub = SNew(SWonderlandSocialHubPanel)
						.Snapshot(Fed).bConnected(true).bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Lff).Lff(GateModel);
					const TSharedPtr<SWonderlandSocialLffView> GateView = GateHub->QaLffView();
					bool bGateBefore = false;
					bool bGateWithheld = false;
					bool bGateFresh = false;
					if (GateView.IsValid())
					{
						FWonderlandLffFeedPage GatePage;
						GatePage.Posts = {PostOf(TEXT("lffp_90"))};
						GateSvc->AnswerFeed(GateSvc->Feeds.Num() - 1, AnswerOk(), GatePage);   // the hub's first build asked it
						GateModel->OpenPost(TEXT("lffp_90"));
						FWonderlandLffPostDetail GateDetail;
						GateDetail.Post = PostOf(TEXT("lffp_90"));
						GateSvc->AnswerPost(GateSvc->Posts.Num() - 1, AnswerOk(), GateDetail);
						GateView->FlushRebuild();
						bGateBefore = GateView->QaBuiltPostCards() == 1 && GateView->QaBuiltPersonRows() >= 1;
						GateSvc->Forget();
						GateModel->BeginOpenGate(LffQaLater());
						GateModel->NoteOnScreen(FPlatformTime::Seconds());   // as the reopened tab's tick: asks now unless the open already did
						GateView->FlushRebuild();
						bGateWithheld = GateView->QaBuiltPostCards() == 0 && GateView->QaBuiltPersonRows() == 0 && GateView->QaLines().Contains(TEXT("Updating"));
						GateSvc->AnswerFeed(GateSvc->Feeds.Num() - 1, AnswerOk(), GatePage);
						GateSvc->AnswerPost(GateSvc->Posts.Num() - 1, AnswerOk(), GateDetail);
						GateView->FlushRebuild();
						bGateFresh = GateView->QaBuiltPostCards() == 1 && GateView->QaBuiltPersonRows() >= 1 && !GateView->QaLines().Contains(TEXT("Updating"));
					}
					Check(TEXT("LG7"), bGateBefore && bGateWithheld && bGateFresh,
						FString::Printf(TEXT("after the open the view built no post card and no person row and says Updating (%s); controls: built before the open (%s), and again after reads asked after it landed (%s)"),
							bGateWithheld ? TEXT("yes") : TEXT("NO"), bGateBefore ? TEXT("yes") : TEXT("NO"), bGateFresh ? TEXT("yes") : TEXT("NO")));
					// LG13 (B35): THE AGE RULE AS BUILT -- the same view, its reads 4.5 s old with no answer and no broadcast, rebuilds by itself
					// (the pre-tick's withheld check) to no post card and no person row; controls: a rebuild at 3.0 s still builds them, with the
					// list's scroll offset kept across that rebuild
					bool bAgeDrawnAtThree = false;
					bool bAgeScrollKept = false;
					bool bAgeWithheld = false;
					if (GateView.IsValid() && bGateFresh)
					{
						GateView->QaSetListScrollOffset(37.0f);
						GateModel->QaShiftClock(3.0);
						GateModel->AdjustSlots(0);   // a change that alters nothing drawn: only to rebuild at 3.0 s
						GateView->FlushRebuild();
						bAgeDrawnAtThree = GateView->QaBuiltPostCards() == 1 && GateView->QaBuiltPersonRows() >= 1;
						bAgeScrollKept = FMath::IsNearlyEqual(GateView->QaListScrollOffset(), 37.0f, 0.5f);
						GateModel->QaShiftClock(1.5);
						const bool bNothingAsked = !GateView->QaRebuildPending();
						GateView->FlushRebuild();
						bAgeWithheld = bNothingAsked && GateView->QaBuiltPostCards() == 0 && GateView->QaBuiltPersonRows() == 0
							&& GateView->QaLines().Contains(TEXT("Updating"));
					}
					Check(TEXT("LG13"), bAgeDrawnAtThree && bAgeScrollKept && bAgeWithheld,
						FString::Printf(TEXT("reads 4.5 s old: the view rebuilt by itself to no card and no person row (%s); controls: at 3.0 s a rebuild still drew them (%s), the list's scroll kept across it (%s)"),
							bAgeWithheld ? TEXT("yes") : TEXT("NO"), bAgeDrawnAtThree ? TEXT("yes") : TEXT("NO"), bAgeScrollKept ? TEXT("yes") : TEXT("NO")));
				}
			}

			UE_LOG(LogTemp, Display, TEXT("WLQA LFF END pass=%d fail=%d"), Passed, Failed);
		}));

	// ============================================================================================ wl.Qa.SocialLffScreen (on screen)

	/**
	 * ON SCREEN, in a running game (a few seconds; synthetic Slate events only, no OS input; does not quit):
	 *   HU1  HUD UNCHANGED: the game window's buttons, counted before opening the hub on LFF and after closing it, are the same number,
	 *        and the LFF view (when the hub draws it) lives INSIDE the hub; HUC (control): while the hub is open the same count is larger
	 *   CR1  THE CARET SURVIVES THE VIEW'S OWN REBUILD (M1): "ab" typed into the title, the caret put after "a", a model change rebuilds the
	 *        view at Slate's pre-tick, "X" typed -> "aXb"
	 *   CR2  the same refocus made directly on the LFF box keeps the caret too ("aXb")
	 *   CRC  control: a box with Slate's default (IsCaretMovedWhenGainFocus on) under that same refocus jumps to the end ("abX")
	 * Its LFF view runs on a stand-in service (no network) and is removed at the end. WLQA LFFSCREEN lines.
	 */
	struct FLffScreenRun
	{
		TWeakObjectPtr<UWorld> World;
		int32 Phase = 0;
		double At = 0.0;
		int32 Passed = 0;
		int32 Failed = 0;
		int32 ButtonsBefore = -1;
		int32 ButtonsOpen = -1;
		bool bInsideHub = false;
		bool bPendingAfterChange = false;
		/** Whether this machine had seen the welcome before the run: the run must leave that exactly as it was. */
		bool bWelcomeSeenBefore = false;
		TUniquePtr<FLffQaService> Fake;
		TSharedPtr<FWonderlandLffModel> Model;
		TSharedPtr<SWonderlandSocialLffView> View;
		TSharedPtr<SEditableTextBox> Control;
		TSharedPtr<SWidget> Layer;
	};
	TSharedPtr<FLffScreenRun> GLffScreenRun;

	void LffScreenCheck(FLffScreenRun& Run, const TCHAR* Id, bool bOk, const FString& What)
	{
		(bOk ? Run.Passed : Run.Failed) += 1;
		UE_LOG(LogTemp, Display, TEXT("WLQA LFFSCREEN %s %s -- %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *What);
	}

	UWonderlandUiSubsystem* LffScreenUi(UWorld* World)
	{
		APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	/** Every SButton under a widget (by type name, never a new FName). */
	int32 LffCountButtons(const TSharedRef<SWidget>& Widget, int32 Depth)
	{
		int32 Count = Widget->GetTypeAsString() == TEXT("SButton") ? 1 : 0;
		FChildren* Children = Depth < 256 ? Widget->GetAllChildren() : nullptr;
		for (int32 Index = 0; Children != nullptr && Index < Children->Num(); ++Index)
		{
			Count += LffCountButtons(Children->GetChildAt(Index), Depth + 1);
		}
		return Count;
	}

	int32 LffGameWindowButtons()
	{
		UGameViewportClient* Viewport = GEngine != nullptr ? GEngine->GameViewport.Get() : nullptr;
		const TSharedPtr<SWindow> Window = Viewport != nullptr ? Viewport->GetWindow() : nullptr;
		return Window.IsValid() ? LffCountButtons(Window.ToSharedRef(), 0) : -1;
	}

	/** Characters as the keyboard user types them, through Slate's own routing to the focused widget. */
	void LffType(const FString& Text)
	{
		const uint32 User = static_cast<uint32>(FSlateApplication::Get().GetUserIndexForKeyboard());
		for (const TCHAR Character : Text)
		{
			FSlateApplication::Get().ProcessKeyCharEvent(FCharacterEvent(Character, FModifierKeysState(), User, false));
		}
	}

	void LffScreenEnd()
	{
		if (GLffScreenRun.IsValid())
		{
			UGameViewportClient* Viewport = GEngine != nullptr ? GEngine->GameViewport.Get() : nullptr;
			if (Viewport != nullptr && GLffScreenRun->Layer.IsValid())
			{
				Viewport->RemoveViewportWidgetContent(GLffScreenRun->Layer.ToSharedRef());
			}
			if (FSlateApplication::IsInitialized())
			{
				FSlateApplication::Get().SetAllUserFocusToGameViewport();
			}
			// THE WELCOME IS NOT REMEMBERED BY A QA RUN (the run only closes it; DismissWelcome would mark it seen). WS1 reads the flag as the
			// game reads it (WonderlandBeta::HasSeenWelcome, from the disk each time) BEFORE anything is restored, so a run that changed it FAILS;
			// then it is put back by WonderlandBeta's own calls (no path is copied here).
			const bool bWelcomeBefore = GLffScreenRun->bWelcomeSeenBefore;
			const bool bWelcomeAfterRun = WonderlandBeta::HasSeenWelcome();
			LffScreenCheck(*GLffScreenRun, TEXT("WS1"), bWelcomeAfterRun == bWelcomeBefore,
				FString::Printf(TEXT("the machine's 'welcome seen' after the run (%s) is what it was before it (%s)"),
					bWelcomeAfterRun ? TEXT("seen") : TEXT("not seen"), bWelcomeBefore ? TEXT("seen") : TEXT("not seen")));
			// WSC THE CONTROL: the same reader DOES see a change -- the flag is flipped, read, and flipped back to where it was before the run
			if (bWelcomeBefore)
			{
				WonderlandBeta::ForgetWelcomeSeen();
			}
			else
			{
				WonderlandBeta::MarkWelcomeSeen();
			}
			const bool bFlippedSeen = WonderlandBeta::HasSeenWelcome();
			if (bWelcomeBefore)
			{
				WonderlandBeta::MarkWelcomeSeen();
			}
			else
			{
				WonderlandBeta::ForgetWelcomeSeen();
			}
			const bool bRestored = WonderlandBeta::HasSeenWelcome() == bWelcomeBefore;
			LffScreenCheck(*GLffScreenRun, TEXT("WSC"), bFlippedSeen != bWelcomeBefore && bRestored,
				FString::Printf(TEXT("control: the reader sees the flag flipped (%s) and back as it was before the run (%s)"),
					bFlippedSeen != bWelcomeBefore ? TEXT("yes") : TEXT("NO"), bRestored ? TEXT("yes") : TEXT("NO")));
			UE_LOG(LogTemp, Display, TEXT("WLQA LFFSCREEN END pass=%d fail=%d"), GLffScreenRun->Passed, GLffScreenRun->Failed);
		}
		GLffScreenRun.Reset();
	}

	bool LffScreenTick(float)
	{
		if (!GLffScreenRun.IsValid())
		{
			return false;
		}
		FLffScreenRun& Run = *GLffScreenRun;
		UWonderlandUiSubsystem* Ui = LffScreenUi(Run.World.Get());
		UGameViewportClient* Viewport = GEngine != nullptr ? GEngine->GameViewport.Get() : nullptr;
		const double Since = FPlatformTime::Seconds() - Run.At;
		const auto NextPhase = [&Run](int32 NewPhase) { Run.Phase = NewPhase; Run.At = FPlatformTime::Seconds(); };
		if (Ui == nullptr || Viewport == nullptr || !FSlateApplication::IsInitialized())
		{
			if (Since > 120.0)
			{
				LffScreenCheck(Run, TEXT("HU1"), false, TEXT("no world, UI, game viewport or Slate within 120 s"));
				LffScreenEnd();
				return false;
			}
			return true;
		}
		switch (Run.Phase)
		{
		case 0:
			if (Since >= 8.0)
			{
				Ui->CloseOverlay();   // closes the welcome for this run without remembering it as seen (DismissWelcome would)
				NextPhase(1);
			}
			break;
		case 1:
			if (Since >= 1.0)
			{
				Run.ButtonsBefore = LffGameWindowButtons();
				Ui->OpenSocialHub(TEXT("lff"));
				NextPhase(2);
			}
			break;
		case 2:
			if (Since >= 1.0)
			{
				Run.ButtonsOpen = LffGameWindowButtons();
				const TSharedPtr<SWonderlandSocialHubPanel> Hub = Ui->GetOpenSocialHubForQa();
				const bool bOnLff = Hub.IsValid() && Hub->GetTab() == SWonderlandSocialHubPanel::ETab::Lff;
				// the LFF view, when the hub draws it (a connected session), lives inside the hub; a hub that is not connected draws its sign-in
				const TSharedPtr<SWonderlandSocialLffView> LffView = Hub.IsValid() ? Hub->QaLffView() : nullptr;
				bool bInside = !LffView.IsValid();
				if (LffView.IsValid())
				{
					const SWidget* const HubWidget = Hub.Get();
					TSharedPtr<SWidget> Up = LffView->GetParentWidget();
					for (int32 Depth = 0; Up.IsValid() && Depth < 64 && !bInside; ++Depth)
					{
						bInside = Up.Get() == HubWidget;
						Up = Up->GetParentWidget();
					}
				}
				Run.bInsideHub = bOnLff && bInside;
				Ui->CloseOverlay();
				NextPhase(3);
			}
			break;
		case 3:
			if (Since >= 1.0)
			{
				const int32 ButtonsAfter = LffGameWindowButtons();
				LffScreenCheck(Run, TEXT("HU1"), Run.ButtonsBefore >= 0 && ButtonsAfter == Run.ButtonsBefore && Run.bInsideHub,
					FString::Printf(TEXT("the LFF tab leaves nothing on the game window: %d buttons before opening the hub on LFF, %d after closing it; its view lived inside the hub (%s). Not the A4 base-vs-LFF comparison"),
						Run.ButtonsBefore, ButtonsAfter, Run.bInsideHub ? TEXT("yes") : TEXT("NO")));
				LffScreenCheck(Run, TEXT("HUC"), Run.ButtonsOpen > Run.ButtonsBefore,
					FString::Printf(TEXT("control: while the hub was open the same count saw %d buttons (it does count them)"), Run.ButtonsOpen));
				// THE CARET CASE: an LFF view of its own over a stand-in service (the create form), and a default box, on top of the game
				Run.Fake = MakeUnique<FLffQaService>();
				FLffQaService* Svc = Run.Fake.Get();
				Run.Model = MakeShared<FWonderlandLffModel>([Svc]() -> IWonderlandSocialService* { return Svc; });
				Run.Model->StartCreate();
				SAssignNew(Run.View, SWonderlandSocialLffView).Model(Run.Model).ViewerId(TEXT("usr_qa_viewer"));
				SAssignNew(Run.Control, SEditableTextBox).Font(WonderlandUi::Sans(10));   // Slate's defaults: the caret jumps to the end on a focus
				Run.Layer = SNew(SBox).HAlign(HAlign_Center).VAlign(VAlign_Center)
					[
						SNew(SBox).WidthOverride(900.0f).HeightOverride(640.0f)
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().AutoHeight()[Run.Control.ToSharedRef()]
							+ SVerticalBox::Slot().FillHeight(1.0f)[Run.View.ToSharedRef()]
						]
					];
				Viewport->AddViewportWidgetContent(Run.Layer.ToSharedRef(), 500);
				NextPhase(4);
			}
			break;
		case 4:
			if (Since >= 0.5)
			{
				// CR1, part one: "ab" in the title, the caret after "a", then a model change (a server answer does the same)
				const TSharedPtr<SEditableTextBox> Title = Run.View->QaBox(EWonderlandLffField::Title);
				FSlateApplication::Get().SetKeyboardFocus(Title, EFocusCause::SetDirectly);
				LffType(TEXT("ab"));
				Title->GoTo(FTextLocation(0, 1));
				Run.Model->AdjustSlots(1);
				Run.bPendingAfterChange = Run.View->QaRebuildPending();
				NextPhase(5);
			}
			break;
		case 5:
			if (Since >= 0.3)
			{
				const TSharedPtr<SEditableTextBox> Title = Run.View->QaBox(EWonderlandLffField::Title);
				const bool bRebuilt = Run.bPendingAfterChange && !Run.View->QaRebuildPending();
				const bool bFocused = Title->HasAnyUserFocusOrFocusedDescendants();
				LffType(TEXT("X"));
				const FString AfterRebuild = Title->GetText().ToString();
				LffScreenCheck(Run, TEXT("CR1"), bRebuilt && bFocused && Run.View->QaIsPlaced(EWonderlandLffField::Title) && AfterRebuild == TEXT("aXb"),
					FString::Printf(TEXT("the caret survives the view's own rebuild (rebuilt at the pre-tick %s, focus kept %s): '%s' (want 'aXb')"),
						bRebuilt ? TEXT("yes") : TEXT("NO"), bFocused ? TEXT("yes") : TEXT("NO"), *AfterRebuild));
				// CRC THE CONTROL: Slate's default box under the same refocus (its inner text has the focus; the box is focused again)
				Run.Control->SetText(FText::GetEmpty());
				FSlateApplication::Get().SetKeyboardFocus(Run.Control, EFocusCause::SetDirectly);
				LffType(TEXT("ab"));
				Run.Control->GoTo(FTextLocation(0, 1));
				FSlateApplication::Get().SetKeyboardFocus(Run.Control, EFocusCause::SetDirectly);
				LffType(TEXT("X"));
				const FString Default = Run.Control->GetText().ToString();
				// CR2: the same direct refocus on the LFF box keeps its caret
				Title->SetText(FText::GetEmpty());
				FSlateApplication::Get().SetKeyboardFocus(Title, EFocusCause::SetDirectly);
				LffType(TEXT("ab"));
				Title->GoTo(FTextLocation(0, 1));
				FSlateApplication::Get().SetKeyboardFocus(Title, EFocusCause::SetDirectly);
				LffType(TEXT("X"));
				const FString Kept = Title->GetText().ToString();
				LffScreenCheck(Run, TEXT("CR2"), Kept == TEXT("aXb"), FString::Printf(TEXT("the LFF box refocused directly keeps its caret: '%s' (want 'aXb')"), *Kept));
				LffScreenCheck(Run, TEXT("CRC"), Default == TEXT("abX"),
					FString::Printf(TEXT("control: Slate's default box under the same refocus jumps the caret to the end: '%s' (want 'abX')"), *Default));
				LffScreenEnd();
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSocialLffScreen(
		TEXT("wl.Qa.SocialLffScreen"),
		TEXT("QA (on screen): the HUD is unchanged by the LFF tab (HU1, HUC control), and the LFF caret survives a rebuild (CR1, CR2; CRC control: ")
		TEXT("Slate's default jumps). Synthetic Slate events only; no OS input; does not quit. WLQA LFFSCREEN lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (!WonderlandBeta::IsDeveloperSession())   // the reviewer's R2-09
			{
				UE_LOG(LogTemp, Display, TEXT("WLQA LFFSCREEN refused: needs a developer session (-wldev)"));
				return;
			}
			if (GLffScreenRun.IsValid())
			{
				return;
			}
			GLffScreenRun = MakeShared<FLffScreenRun>();
			GLffScreenRun->World = World;
			GLffScreenRun->bWelcomeSeenBefore = WonderlandBeta::HasSeenWelcome();
			GLffScreenRun->At = FPlatformTime::Seconds();
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&LffScreenTick), 0.05f);
			UE_LOG(LogTemp, Display, TEXT("WLQA LFFSCREEN armed"));
		}));
}

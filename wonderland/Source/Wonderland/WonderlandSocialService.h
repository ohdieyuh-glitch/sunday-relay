// WONDERLAND SOCIAL — where the desktop client's social views come from.
//
// ONE INTERFACE, TWO SOURCES. Surfaces ask an IWonderlandSocialService and never know which is behind it:
//   - FWonderlandSocialPreviewService: the DEVELOPMENT PREVIEW the authority generated (UiArt/Social/social-preview.json).
//     Read-only: every action is refused with the reason, and every surface says DEVELOPMENT PREVIEW.
//   - (later) a Relay Bridge service over the native session's `social` capability, once the founder deploys it after RC8.
// Neither decides privacy. See WonderlandSocialTypes.h.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandSocialTypes.h"

class FJsonObject;

DECLARE_MULTICAST_DELEGATE(FOnWonderlandSocialChanged);

/** The answer to an action a surface asked for. Refusals carry the reason a person can read. */
struct FWonderlandSocialActionResult
{
	bool bOk = false;
	FString Reason;
	/** Asked of a server: the answer arrives later through OnAnswered. */
	bool bPending = false;
};

/** A server's answer to an action asked earlier: (operation, subject, answer). */
DECLARE_MULTICAST_DELEGATE_ThreeParams(FOnWonderlandSocialAnswered, const FString& /*OperationId*/, const FString& /*SubjectId*/, const FWonderlandSocialActionResult& /*Answer*/);

/** LFF: how one LFF call was answered. Ok only with HTTP 200 and no problem; the surfaces map the rest (WonderlandLff::ProblemOf). */
struct FWonderlandLffAnswer
{
	/** The HTTP status; 0 when no server answered (or none was asked). */
	int32 Status = 0;
	/** Empty when ok; else the server's words, or the client's own. */
	FString Problem;
	/** A 429's Retry-After, in seconds; 0 otherwise. */
	int32 RetryAfterSeconds = 0;
	/** The service cannot reach LFF at all (the DEVELOPMENT PREVIEW): LFF needs a live connection. Never fake posts instead. */
	bool bNeedsLive = false;
	/** Refused by the client before anything was sent (an id or a filter the routes would not take). */
	bool bRefusedHere = false;

	bool IsOk() const { return Status == 200 && Problem.IsEmpty() && !bNeedsLive && !bRefusedHere; }
};

/** LFF answers, each delivered once on the game thread (a preview's at once, inside the call). */
using FWonderlandLffFeedDone = TFunction<void(const FWonderlandLffAnswer&, const FWonderlandLffFeedPage&)>;
using FWonderlandLffPostDone = TFunction<void(const FWonderlandLffAnswer&, const FWonderlandLffPostDetail&)>;
using FWonderlandLffPostRequestsDone = TFunction<void(const FWonderlandLffAnswer&, const FWonderlandLffPostRequests&)>;
using FWonderlandLffMyRequestsDone = TFunction<void(const FWonderlandLffAnswer&, const FWonderlandLffMyRequests&)>;
/** A write's answer. CreatedId: the new post's id (create) or the new request's id (request to join); empty otherwise. */
using FWonderlandLffWriteDone = TFunction<void(const FWonderlandLffAnswer&, const FString& /*CreatedId*/)>;
/** One person's profile card, exactly as profile.read shows this viewer (the LFF owner's PROFILE on a requester). */
using FWonderlandLffProfileDone = TFunction<void(const FWonderlandLffAnswer&, const FWonderlandSocialProfileView&)>;

class WONDERLAND_API IWonderlandSocialService
{
public:
	virtual ~IWonderlandSocialService() = default;

	virtual const FWonderlandSocialSnapshot& GetSnapshot() const = 0;
	/** Where the views come from, in one line a surface can show ("DEVELOPMENT PREVIEW · synthetic people …"). */
	virtual FString GetSourceLine() const = 0;
	virtual bool IsDevelopmentPreview() const = 0;
	/** Why the service has nothing, if it has nothing. Empty when it is healthy. */
	virtual FString GetLastError() const = 0;

	/** A social action by id (the operation ids of the `social` capability, e.g. "messages.send"). */
	virtual FWonderlandSocialActionResult Request(const FString& OperationId, const FString& SubjectId) = 0;
	/** "messages.send": a message into a conversation. Its own call because it carries a body. */
	virtual FWonderlandSocialActionResult SendMessage(const FString& ConversationId, const FString& Body) = 0;

	// ---- LFF, THE LOOKING FOR FEED: its own bounded reads and writes (the lff.* rows), never the snapshot. Each carries what Request()
	// cannot (a body, a query, a typed answer), so each is its own call -- on BOTH services: the preview answers every one "needs a live
	// connection" and lists nobody. The text a player wrote (a title, a note) is never logged by any of them.
	/** GET /lff/posts: one page of the feed (or of the viewer's own posts), filtered by the server. */
	virtual void ReadLffFeed(const FWonderlandLffFeedQuery& Query, FWonderlandLffFeedDone Done) = 0;
	/** GET /lff/posts/:id: one post in detail (the author's card, the accepted list where the viewer may see it). */
	virtual void ReadLffPost(const FString& PostId, FWonderlandLffPostDone Done) = 0;
	/** GET /lff/posts/:id/requests: the owner's inbox for one of their posts. */
	virtual void ReadLffPostRequests(const FString& PostId, FWonderlandLffPostRequestsDone Done) = 0;
	/** GET /lff/requests: the viewer's own requests. */
	virtual void ReadLffMyRequests(FWonderlandLffMyRequestsDone Done) = 0;
	/** POST /lff/posts; CreatedId is the new post's id. */
	virtual void CreateLffPost(const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) = 0;
	/** POST /lff/posts/:id/edit with every field (the owner's, OPEN only: the server decides). */
	virtual void EditLffPost(const FString& PostId, const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) = 0;
	/** POST /lff/posts/:id/requests with an optional note; CreatedId is the new request's id. */
	virtual void SendLffRequest(const FString& PostId, const FString& Message, FWonderlandLffWriteDone Done) = 0;
	/** The id-only writes: "lff.post.close" / "lff.post.delete" (subject: a post), "lff.request.withdraw" / "lff.request.accept" /
	 *  "lff.request.decline" (subject: a request). */
	virtual void ActOnLff(const FString& OperationId, const FString& SubjectId, FWonderlandLffWriteDone Done) = 0;
	/** The EXISTING report flow (reports.file) with the post as its subject: reportedId = the author, subjectRef = the post id. */
	virtual void ReportLffPost(const FString& AuthorId, const FString& PostId, FWonderlandLffWriteDone Done) = 0;
	/** The EXISTING profile.read (GET /profiles/:id): a person's card as the authority shows it to this viewer, for a person the snapshot
	 *  does not carry (an LFF requester). Opened by the existing profile panel; a person the viewer may not see answers not-found. */
	virtual void ReadProfile(const FString& UserId, FWonderlandLffProfileDone Done) = 0;

	FOnWonderlandSocialChanged& OnChanged() { return Changed; }
	FOnWonderlandSocialAnswered& OnAnswered() { return Answered; }
	/** The server told this viewer of an LFF change (an lff.* or blocks.* event, or a reset): LFF surfaces read again. Events carry no content. */
	FSimpleMulticastDelegate& OnLffChanged() { return LffChanged; }

protected:
	FOnWonderlandSocialChanged Changed;
	FOnWonderlandSocialAnswered Answered;
	FSimpleMulticastDelegate LffChanged;
};

/** The generated preview, read-only. */
class WONDERLAND_API FWonderlandSocialPreviewService final : public IWonderlandSocialService
{
public:
	/** Load and validate the file. False (with GetLastError) on anything not exactly a social preview. */
	bool Load(const FString& Path);

	virtual const FWonderlandSocialSnapshot& GetSnapshot() const override { return Snapshot; }
	virtual FString GetSourceLine() const override;
	virtual bool IsDevelopmentPreview() const override { return true; }
	virtual FString GetLastError() const override { return LastError; }
	virtual FWonderlandSocialActionResult Request(const FString& OperationId, const FString& SubjectId) override;
	virtual FWonderlandSocialActionResult SendMessage(const FString& ConversationId, const FString& Body) override;
	// LFF IS NOT IN THE PREVIEW (contract: "the client preview service shows NO LFF people and NO LFF posts"): every call answers at once
	// that LFF needs a live connection, with nothing in it.
	virtual void ReadLffFeed(const FWonderlandLffFeedQuery& Query, FWonderlandLffFeedDone Done) override;
	virtual void ReadLffPost(const FString& PostId, FWonderlandLffPostDone Done) override;
	virtual void ReadLffPostRequests(const FString& PostId, FWonderlandLffPostRequestsDone Done) override;
	virtual void ReadLffMyRequests(FWonderlandLffMyRequestsDone Done) override;
	virtual void CreateLffPost(const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) override;
	virtual void EditLffPost(const FString& PostId, const FWonderlandLffPostFields& Fields, FWonderlandLffWriteDone Done) override;
	virtual void SendLffRequest(const FString& PostId, const FString& Message, FWonderlandLffWriteDone Done) override;
	virtual void ActOnLff(const FString& OperationId, const FString& SubjectId, FWonderlandLffWriteDone Done) override;
	virtual void ReportLffPost(const FString& AuthorId, const FString& PostId, FWonderlandLffWriteDone Done) override;
	virtual void ReadProfile(const FString& UserId, FWonderlandLffProfileDone Done) override;
	/** The one answer every LFF call gets from the preview. */
	static FWonderlandLffAnswer LffNeedsLive();

	/** The file's place in a package or an editor: <ProjectDir>/UiArt/Social/social-preview.json. */
	static FString DefaultPath();
	/** A preview scene's file: "party" (the viewer in a party) or anything else for the default. */
	static FString ScenePath(const FString& Scene);

private:
	FWonderlandSocialSnapshot Snapshot;
	FString LastError;
};

/** Strict parse of the preview (schema, the preview flag, every required field). Exposed for QA. */
WONDERLAND_API bool WonderlandParseSocialPreview(const TSharedPtr<FJsonObject>& Json, FWonderlandSocialSnapshot& Out, FString& OutProblem);
/** The same parse for either source: a preview (relay-wonderland-social-preview.v1, flagged) or a live view
 *  (relay-wonderland-social-view.v1, never flagged). Anything claiming to be the other is refused. */
WONDERLAND_API bool WonderlandParseSocialView(const TSharedPtr<FJsonObject>& Json, bool bExpectPreview, FWonderlandSocialSnapshot& Out, FString& OutProblem);

// ---- LFF's strict parsers (social-lff.ts's views; the `data` of each answer). Like the snapshot's: a field the contract requires that is
// missing or out of its vocabulary refuses the whole answer, and nothing half-read is kept. Exposed for QA (wl.Qa.SocialLff).
WONDERLAND_API bool WonderlandParseLffPost(const TSharedPtr<FJsonObject>& Json, FWonderlandLffPost& Out, FString& OutProblem);
WONDERLAND_API bool WonderlandParseLffFeed(const TSharedPtr<FJsonObject>& Json, FWonderlandLffFeedPage& Out, FString& OutProblem);
WONDERLAND_API bool WonderlandParseLffPostDetail(const TSharedPtr<FJsonObject>& Json, FWonderlandLffPostDetail& Out, FString& OutProblem);
WONDERLAND_API bool WonderlandParseLffMyRequests(const TSharedPtr<FJsonObject>& Json, FWonderlandLffMyRequests& Out, FString& OutProblem);
WONDERLAND_API bool WonderlandParseLffPostRequests(const TSharedPtr<FJsonObject>& Json, FWonderlandLffPostRequests& Out, FString& OutProblem);
/** One UserProfileView (profile.read's answer), by the snapshot's own strict profile parse. */
WONDERLAND_API bool WonderlandParseSocialProfileView(const TSharedPtr<FJsonObject>& Json, FWonderlandSocialProfileView& Out, FString& OutProblem);

/** LFF's six categories (social-lff.ts LFF_CATEGORIES), in the authority's order. */
WONDERLAND_API const TArray<FString>& WonderlandLffCategories();
WONDERLAND_API bool WonderlandLffIsCategory(const FString& Category);
/** The authority's words for a category (LFF_CATEGORY_LABELS), for a surface that has no view to read them from; empty for an unknown one. */
WONDERLAND_API FString WonderlandLffCategoryLabel(const FString& Category);
/**
 * A filter value for a query string, PERCENT-ENCODED: its UTF-8 bytes, each one outside RFC 3986's unreserved set (A-Z a-z 0-9 - . _ ~)
 * as %XX in upper-case hex. "Wonder Web+" -> "Wonder%20Web%2B" (a space is %20, never '+'). The routes decode an LFF filter value exactly
 * once (B3.1).
 */
WONDERLAND_API FString WonderlandLffEncodeQueryValue(const FString& Value);
/**
 * The feed read's path and query (under the social root), or false with why: a category outside the six, a cursor the feed could not
 * have given, or a filter holding a control character or a lone surrogate is refused before anything is sent. The live service sends
 * exactly this; QA reads it.
 */
WONDERLAND_API bool WonderlandLffFeedPath(const FWonderlandLffFeedQuery& Query, FString& OutPath, FString& OutProblem);

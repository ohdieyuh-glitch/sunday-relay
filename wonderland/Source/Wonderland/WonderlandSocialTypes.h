// WONDERLAND SOCIAL — the views the desktop client renders.
//
// THE CLIENT DECIDES NOTHING. Who may see whom, where somebody is, whether they can be joined or messaged: all of it is
// decided by the social authority (src/relay/social, TypeScript) and arrives here as VIEWS -- the same shapes the Relay
// Bridge returns over the desktop client's least-privilege `social` capability (relay-bridge/wonderland-social-scope.ts),
// and, until that is connected, the DEVELOPMENT PREVIEW the authority itself generates (UiArt/Social/social-preview.json).
// These structs mirror those views field for field. There is deliberately no privacy logic in C++: a field the authority
// withheld is simply absent (bHas... false), and a surface draws "hidden", never a guess.
//
// RANK AND LEVEL ARE PENDING (founder, 2026-10-01): typed, nullable, never filled from the cosmetic chakra tier or from an
// agent's Glicko rating. The Relay Dog's appearance tier is cosmetic and is drawn only as part of the Dog.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandVoice.h"

struct FWonderlandSocialLocation
{
	FString ServerId;
	/** PUBLIC_WORLD, PRIVATE_SERVER, GVE_ARENA, MISSION_SITE */
	FString ServerKind;
	FString ServerName;
	FString PlaceLabel;
	FString NationId;
};

/** What the viewer may do to a person, as the authority computed it. */
struct FWonderlandSocialActions
{
	bool bViewProfile = false;
	bool bMessage = false;
	bool bInviteToParty = false;
	bool bJoinParty = false;
	bool bInviteToServer = false;
	bool bJoinServer = false;
	bool bSendFriendRequest = false;
	bool bRemoveFriend = false;
	bool bMute = false;
	bool bBlock = false;
	bool bReport = false;
};

/** One person's presence as this viewer may see it (UserPresenceView). */
struct FWonderlandSocialPresence
{
	FString UserId;
	/** ONLINE, AWAY, BUSY, OFFLINE */
	FString OnlineState;
	/** The player's OWN presence choice -- AVAILABLE, AWAY, BUSY, APPEAR_OFFLINE -- present ONLY in their own (self) view (Second's
	 *  backend: every other viewer's presence of them has no such key). Empty = not told (an older backend): no choice is shown. */
	FString Availability;
	/** The founder's one-line headline: IN GVE, CREATING, WORKING WITH JULIUS, OFFLINE … */
	FString Headline;
	bool bHasActivity = false;
	FString ActivityLabel;
	bool bHasLocation = false;
	FWonderlandSocialLocation Location;
	FString PartyId;
	FString LastSeenIso;
	FWonderlandSocialActions Can;
	/** PRIVATE, FRIENDS_ONLY, BLOCKED, OFFLINE, or empty. */
	FString RestrictedReason;
};

struct FWonderlandSocialAgentRating
{
	FString Mode;
	double Rating = 0.0;
	double Deviation = 0.0;
	int32 BattleCount = 0;
	bool bProvisional = true;
};

/** A Compound AI Agent's public card: identity and public record, never configuration. */
struct FWonderlandSocialAgent
{
	FString AgentId;
	/** JULIUS or IMPORTED */
	FString Kind;
	FString DisplayName;
	FString SystemLabel;
	FString EmblemId;
	TArray<FWonderlandSocialAgentRating> Ratings;
};

struct FWonderlandSocialRelayDog
{
	FString SkinId;
	/** "#RRGGBB" or empty for the skin's own. */
	FString Primary;
	FString Secondary;
	FString Flame;
	/** COSMETIC chakra accent; never a rank. */
	FString AppearanceTier;
};

struct FWonderlandSocialCompanion
{
	FString CompanionId;
	/** LLM_COMPANION, JHINN_AGENT, SUB_AGENT_CUB, OTHER */
	FString Kind;
	FString DisplayName;
	FString Primary;
	FString Secondary;
};

struct FWonderlandSocialStat
{
	FString StatId;
	FString Label;
	FString Value;
	/** LEDGER, ARENA, PENDING */
	FString Source;
};

struct FWonderlandSocialProfile
{
	FString UserId;
	FString DisplayName;
	FString Handle;
	FString AvatarRef;
	FString NationId;
	FString ClanName;
	/** PENDING until a progression system exists; rank and level are then absent. */
	FString ProgressionSource = TEXT("PENDING");
	bool bHasPrimaryAgent = false;
	FWonderlandSocialAgent PrimaryAgent;
	FWonderlandSocialRelayDog RelayDog;
	bool bHasActiveCompanion = false;
	FWonderlandSocialCompanion ActiveCompanion;
	TArray<FWonderlandSocialAgent> ShowcaseAgents;
	TArray<FWonderlandSocialCompanion> ShowcaseCompanions;
	TArray<FWonderlandSocialStat> Stats;
	FString MemberSinceIso;
};

/** A profile as this viewer sees it (UserProfileView). */
struct FWonderlandSocialProfileView
{
	FWonderlandSocialProfile Profile;
	FWonderlandSocialPresence Presence;
	/** SELF, FRIEND, REQUEST_SENT, REQUEST_RECEIVED, NONE, BLOCKED, BLOCKED_BY */
	FString Relationship;
	TArray<FString> MutualFriendIds;
	bool bInParty = false;
	/** -1 when the viewer may not know. */
	int32 PartyMemberCount = -1;
	bool bPartyJoinable = false;
};

/** A person as a list row: Friends, Requests, Recent Players. */
struct FWonderlandSocialPersonRow
{
	FString UserId;
	FString DisplayName;
	FString Handle;
	FString AvatarRef;
	FWonderlandSocialPresence Presence;
};

/** A friend request, with the other person as a row (from them when incoming, to them when outgoing). */
struct FWonderlandSocialRequestRow
{
	FString RequestId;
	FWonderlandSocialPersonRow Person;
};

/** Somebody the viewer played with: who, where ("GVE: Tower Lane"), and when. */
struct FWonderlandSocialRecentRow
{
	FWonderlandSocialPersonRow Person;
	FString Context;
	FString ContextLabel;
	FString MetAtIso;
};

/** An invitation into a party: which party, from whom, until when. */
struct FWonderlandSocialPartyInviteRow
{
	FString InviteId;
	FString PartyId;
	FString PartyName;
	FString ExpiresAtIso;
	FWonderlandSocialPersonRow From;
};

/** A conversation in the viewer's inbox: who or what it is with, its last line, and how many the viewer has not read. */
struct FWonderlandSocialConversationRow
{
	FString ConversationId;
	/** DIRECT or PARTY */
	FString Kind;
	FString Title;
	/** The other person in a DIRECT conversation; empty for a party's. */
	FString OtherUserId;
	FString LastMessagePreview;
	FString LastMessageAtIso;
	int32 Unread = 0;
};

/** One message, in the order the authority sequenced it. */
struct FWonderlandSocialMessage
{
	FString MessageId;
	FString ConversationId;
	int64 Sequence = 0;
	FString SenderId;
	/** TEXT, or a reference kind (an invite, a shared place) the authority made. */
	FString Kind;
	FString Body;
	FString SentAtIso;
};

struct FWonderlandSocialPartyMember
{
	FString UserId;
	/** LEADER or MEMBER */
	FString Role;
	bool bSelfMuted = false;
};

/** A party as this viewer may see it (PartyView): its members, its leader, its rules, and what the viewer may do in it. */
struct FWonderlandSocialParty
{
	FString PartyId;
	FString Name;
	FString LeaderId;
	TArray<FWonderlandSocialPartyMember> Members;
	/** OPEN_TO_FRIENDS, INVITE_ONLY … as the leader set it */
	FString Privacy;
	/** LEADER_ONLY or ANY_MEMBER */
	FString InvitePermission;
	bool bViewerIsMember = false;
	bool bViewerIsLeader = false;
	bool bViewerMayInvite = false;
};

/** Everything a social surface has to draw, for one viewer. */
struct FWonderlandSocialSnapshot
{
	FString Schema;
	/** True for the generated preview: every surface says DEVELOPMENT PREVIEW and every action is refused. */
	bool bDevelopmentPreview = true;
	FString Note;
	FString ViewerId;
	FString GeneratedAtIso;
	FWonderlandSocialProfileView Self;
	TArray<FWonderlandSocialPersonRow> Friends;
	/** Friend requests to the viewer (Accept / Decline) and from the viewer (Cancel). */
	TArray<FWonderlandSocialRequestRow> IncomingRequests;
	TArray<FWonderlandSocialRequestRow> OutgoingRequests;
	/** People the viewer played with recently, newest first, with where. */
	TArray<FWonderlandSocialRecentRow> RecentPlayers;
	/** Invitations into a party, with the party's name and who sent them. */
	TArray<FWonderlandSocialPartyInviteRow> PartyInvites;
	/** The inbox, newest first, and each conversation's history oldest first, by conversation id. */
	TArray<FWonderlandSocialConversationRow> Conversations;
	TMap<FString, TArray<FWonderlandSocialMessage>> Messages;
	/** The viewer's own party, if they are in one. */
	bool bHasParty = false;
	FWonderlandSocialParty Party;
	/** Other parties this viewer may see (friends' parties). */
	TArray<FWonderlandSocialParty> VisibleParties;
	/** DEVELOPMENT PREVIEW only: the authority's scripted voice states, each with its label, for the voice panel. */
	TArray<TPair<FString, FWonderlandVoiceState>> VoiceStates;
	/** Every profile the viewer may open. A person the viewer may not see is ABSENT, not redacted. */
	TMap<FString, FWonderlandSocialProfileView> Profiles;
	/** User id -> display name, for chips (mutual friends) without opening a profile. */
	TMap<FString, FString> NamesById;
};

// ---- LFF, THE LOOKING FOR FEED (the private-Alpha launch gate, founder 2026-10-12; _qa_handoff/lff/LFF_ALPHA_CONTRACT_r1_20261012.md with
// its amendment r2/r2.1). Its OWN bounded reads under /lff (relay-bridge/wonderland-social-scope.ts, the lff.* rows), never part of the
// snapshot above: these mirror src/relay/social/social-lff.ts's views field for field. A post this viewer may not see is ABSENT -- the one
// "post not found" -- and the client never guesses at one. LFF grants nothing: after an accept, the people connect through the existing
// ADD FRIEND / MESSAGE / INVITE actions, each with its own checks.

/** One post as one viewer sees it (LffPostView). */
struct FWonderlandLffPost
{
	FString PostId;
	/** TEAMS, BUILDERS, AI_ENGINEERS, DESIGNERS, COMPETITORS, COLLABORATORS */
	FString Category;
	/** The authority's words for the category ("AI engineers"). */
	FString CategoryLabel;
	FString Title;
	/** '' when none. */
	FString Description;
	/** A free-text project or activity label, '' when none: never a link to a project, a repository or a server. */
	FString ProjectLabel;
	TArray<FString> Skills;
	/** How many people the owner is looking for (1-20). */
	int32 OpenSlots = 0;
	/** Slots still open: the OWNER's view only (a count of acceptances is a roster); -1 for everyone else. */
	int32 AvailableSlots = -1;
	/** OPEN, CLOSED, EXPIRED */
	FString Status;
	FString CreatedAtIso;
	FString UpdatedAtIso;
	FString ExpiresAtIso;
	int64 Version = 0;
	/** The author, always: a post is shown only to a viewer who may see its author. */
	FWonderlandSocialPersonRow Author;
	bool bViewerIsOwner = false;
	/** The viewer's own request on the post, if one is still theirs to see. */
	bool bHasViewerRequest = false;
	FString ViewerRequestId;
	/** PENDING, ACCEPTED, DECLINED, NO_LONGER_AVAILABLE */
	FString ViewerRequestStatus;
};

/** One post in detail (lff.post.get): the author's card exactly as profile.read would show it, and the accepted list for those it is for. */
struct FWonderlandLffPostDetail
{
	FWonderlandLffPost Post;
	bool bHasAuthorProfile = false;
	FWonderlandSocialProfileView AuthorProfile;
	/** The owner sees every accepted person; an accepted user those of them they may see; everyone else nothing (null on the wire). */
	bool bHasAccepted = false;
	TArray<FWonderlandSocialPersonRow> Accepted;
};

/** One page of the feed, newest first by server time. */
struct FWonderlandLffFeedPage
{
	TArray<FWonderlandLffPost> Posts;
	/** Pass it back for the next page; empty when this page is the last. */
	FString NextCursor;
};

/** What a feed read asks for. The server filters; the client never filters a loaded page (it would miss posts on other pages). */
struct FWonderlandLffFeedQuery
{
	/** One category, or empty for all. */
	FString Category;
	/** A substring of the project/activity label (any text: sent percent-encoded), or empty. */
	FString ProjectLabel;
	/** One whole skill, case-insensitive (any text: sent percent-encoded), or empty. */
	FString Skill;
	/** The viewer's own posts instead, CLOSED and EXPIRED ones included. */
	bool bMine = false;
	/** Only posts still OPEN ("has open slots": an open post always has one). The general feed is OPEN-only anyway, so this narrows only
	 *  the viewer's own posts (social-lff.ts LffFeedFilter.hasOpenSlots; sent as hasOpenSlots=1). */
	bool bHasOpenSlots = false;
	/** A cursor the feed gave, or empty for the first page. */
	FString Cursor;
	int32 Limit = 50;
};

/** One of the viewer's own requests (lff.requests.mine). */
struct FWonderlandLffMyRequest
{
	FString RequestId;
	FString PostId;
	/** PENDING, ACCEPTED, DECLINED, NO_LONGER_AVAILABLE */
	FString Status;
	/** The requester's own note to the owner. */
	FString Message;
	FString CreatedAtIso;
	FString UpdatedAtIso;
	/** The post as the requester may see it now; false when they may no longer see it. */
	bool bHasPost = false;
	FWonderlandLffPost Post;
};

struct FWonderlandLffMyRequests
{
	TArray<FWonderlandLffMyRequest> Requests;
	/** Older requests were left out of this answer. */
	bool bTruncated = false;
};

/** One request to the owner's own post (lff.requests.forPost). */
struct FWonderlandLffIncomingRequest
{
	FString RequestId;
	/** PENDING or ACCEPTED */
	FString Status;
	FString Message;
	FString CreatedAtIso;
	FString UpdatedAtIso;
	FWonderlandSocialPersonRow Requester;
};

struct FWonderlandLffPostRequests
{
	FString PostId;
	TArray<FWonderlandLffIncomingRequest> Requests;
};

/** The fields a player writes on a post, as the client sends them. The server validates every one of them again. */
struct FWonderlandLffPostFields
{
	FString Category;
	FString Title;
	FString Description;
	FString ProjectLabel;
	TArray<FString> Skills;
	int32 OpenSlots = 1;
};

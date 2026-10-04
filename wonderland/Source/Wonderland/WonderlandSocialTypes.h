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

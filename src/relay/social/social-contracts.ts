/**
 * WONDERLAND SOCIAL — the canonical contracts.
 *
 * FOUNDER, 2026-10-01: "Wonderland needs a full gamer social and communication layer" -- Friends, Parties, Messages,
 * Recent Players, Friend Requests, a gamer profile that leads with the player's Compound AI Agent and Relay Dog, and party
 * voice. "Do not implement this as UI-only mock state scattered across widgets."
 *
 * So this file is the one vocabulary every surface speaks: the Friends list, a conversation, a profile and a party all read
 * the SAME records through the SAME resolvers (social-presence.ts, social-privacy.ts), and none of them invents an activity
 * string or decides on its own what a viewer may see.
 *
 * TWO RULES CARRIED OVER FROM THE MULTIPLAYER SLICE (mission/multiplayer/multiplayer-contracts.ts), because they are the
 * rules that make a social system safe rather than merely functional:
 *
 *   1. WHAT A VIEWER MAY SEE IS AN ALLOWLIST, built per viewer. A field added to a record is private until somebody adds it to
 *      a view on purpose -- a line a reviewer sees. Views are constructed field by field, never by deleting private fields
 *      from a full record.
 *   2. SOME THINGS ARE NEVER IN A SOCIAL RECORD AT ALL (NEVER_SOCIAL_CONCERNS): credentials, prompts, the Project Brain,
 *      private mission data, provider keys. Not filtered on the way out -- absent.
 *
 * AND ONE RULE OF THIS PRODUCT'S OWN (src/relay/shared/relay-chakra.ts): "Relay has NO level ledger … a tier here is a
 * CHOSEN appearance … emphatically not an earned rank, and no surface may present it as one." So RANK and LEVEL are typed
 * here as PENDING and null (founder, 2026-10-01: not the chakra scale, not Glicko), and the Relay Dog's chosen chakra tier
 * is a cosmetic field on the Dog, never the player's rank.
 *
 * PURE. No sockets, no clock, no storage. Time is an injected ISO string. Persistence (032_wonderland_social.sql) and
 * transport (the Relay Bridge's verified-session routes and SSE) bind to these types; nothing here depends on them.
 */

import type { ChakraTier } from '../shared/relay-chakra';

/* ------------------------------------------------------------- versioning */

export const WONDERLAND_SOCIAL_SCHEMA_V1 = 'relay-wonderland-social.v1' as const;
export const WONDERLAND_SOCIAL_SCHEMA_VERSION = WONDERLAND_SOCIAL_SCHEMA_V1;

/** A Wonderland account id -- the same id as `relay_wonderland.players.player_id` and `WonderlandParticipant.userId`. */
export type SocialUserId = string;

/** One operation of the desktop client's `social` capability (the table: relay-bridge/wonderland-social-scope.ts). */
export type SocialOperationId =
  | 'snapshot.read'
  | 'profile.read'
  | 'presence.read'
  | 'presence.update_self'
  | 'privacy.read_self'
  | 'privacy.update_self'
  | 'friends.list'
  | 'friends.remove'
  | 'requests.list'
  | 'requests.send'
  | 'requests.accept'
  | 'requests.decline'
  | 'requests.cancel'
  | 'blocks.add'
  | 'blocks.remove'
  | 'mutes.set'
  | 'reports.file'
  | 'recent.list'
  | 'conversations.list'
  | 'conversations.open'
  | 'messages.list'
  | 'messages.send'
  | 'messages.read'
  | 'parties.read'
  | 'parties.create'
  | 'parties.join'
  | 'parties.leave'
  | 'parties.invite'
  | 'parties.remove_member'
  | 'parties.promote'
  | 'parties.rules'
  | 'parties.self_mute'
  | 'parties.voice_join'
  | 'party_invites.list'
  | 'party_invites.accept'
  | 'party_invites.decline'
  | 'showcase.read'
  | 'events.stream'
  | 'world.read'
  | 'world.join'
  | 'world.leave'
  | 'world.state'
  | 'world.invite';

/* --------------------------------------------------------------- presence */

/**
 * WHETHER SOMEBODY IS THERE. The connection plus the availability they chose. `AWAY` and `BUSY` are a person's own words;
 * `OFFLINE` is the absence of a connection (or what a viewer is shown when the subject's privacy, or a block, says so --
 * see social-presence.ts, where that substitution is made in exactly one place).
 */
export const SOCIAL_ONLINE_STATES = ['ONLINE', 'AWAY', 'BUSY', 'OFFLINE'] as const;
export type SocialOnlineState = (typeof SOCIAL_ONLINE_STATES)[number];

/** What a person can set for themselves. `APPEAR_OFFLINE` is shown to everybody as OFFLINE. */
export const SOCIAL_AVAILABILITY = ['AVAILABLE', 'AWAY', 'BUSY', 'APPEAR_OFFLINE'] as const;
export type SocialAvailability = (typeof SOCIAL_AVAILABILITY)[number];

/**
 * WHAT SOMEBODY IS DOING, in Wonderland's own terms (founder: "Creating software, Developing a game, Working with Julius,
 * Running a mission, Exploring Wonderland, In GVE, In a private server, In a party"). One closed vocabulary; the words a
 * surface shows come from `SOCIAL_ACTIVITY_LABELS`, never from the surface.
 */
export const SOCIAL_ACTIVITY_TYPES = [
  'EXPLORING',
  'CREATING_SOFTWARE',
  'DEVELOPING_GAME',
  'CREATING_CONTENT',
  'WORKING_WITH_JULIUS',
  'RUNNING_MISSION',
  'IN_GVE',
  'IN_PRIVATE_SERVER',
  'IN_PARTY',
  'IDLE',
] as const;
export type SocialActivityType = (typeof SOCIAL_ACTIVITY_TYPES)[number];

export const SOCIAL_ACTIVITY_LABELS: Readonly<Record<SocialActivityType, string>> = Object.freeze({
  EXPLORING: 'Exploring Wonderland',
  CREATING_SOFTWARE: 'Creating software',
  DEVELOPING_GAME: 'Developing a game',
  CREATING_CONTENT: 'Creating content',
  WORKING_WITH_JULIUS: 'Working with Julius',
  RUNNING_MISSION: 'Running a mission',
  IN_GVE: 'In GVE',
  IN_PRIVATE_SERVER: 'In a private server',
  IN_PARTY: 'In a party',
  IDLE: 'In Wonderland',
});

/** The kinds of place a person can be. A `PRIVATE_SERVER` is never named to somebody its owner has not allowed. */
export const SOCIAL_SERVER_KINDS = ['PUBLIC_WORLD', 'PRIVATE_SERVER', 'GVE_ARENA', 'MISSION_SITE'] as const;
export type SocialServerKind = (typeof SOCIAL_SERVER_KINDS)[number];

export const WONDERLAND_NATION_IDS = ['ICARUS', 'NOCTIS', 'TARTARUS'] as const;
export type WonderlandNationId = (typeof WONDERLAND_NATION_IDS)[number];

/** Where somebody is. Every field is visibility-sensitive; see SocialPrivacySettings.locationVisibility. */
export interface SocialLocation {
  readonly serverId: string;
  readonly serverKind: SocialServerKind;
  /** e.g. "Golden Arrival" or a private server's own name. */
  readonly serverName: string;
  /** A place inside the server, e.g. "Tower Lane". Never coordinates. */
  readonly placeLabel: string | null;
  readonly nationId: WonderlandNationId | null;
}

/**
 * THE ONE PRESENCE RECORD. Server-side truth about one person, written by the presence authority and read by nobody
 * directly: every surface receives a `UserPresenceView` made for its viewer by `resolvePresenceFor`.
 */
export interface UserPresence {
  readonly userId: SocialUserId;
  /** Connected at all. False is OFFLINE whatever the availability says. */
  readonly connected: boolean;
  readonly availability: SocialAvailability;
  readonly activity: SocialActivityType;
  /** Optional detail inside the activity, profile-safe by construction: "Platformer prototype", never a prompt or a path. */
  readonly activityDetail: string | null;
  readonly location: SocialLocation | null;
  readonly partyId: string | null;
  readonly lastSeenAtIso: string;
  readonly updatedAtIso: string;
}

/**
 * WHAT ONE VIEWER IS SHOWN OF ONE PERSON. Built field by field by `resolvePresenceFor`; the only presence any surface has.
 * `headline` is the single line every surface uses ("IN GVE", "CREATING", "OFFLINE" …) so two surfaces can never disagree.
 */
export interface UserPresenceView {
  readonly userId: SocialUserId;
  readonly onlineState: SocialOnlineState;
  readonly headline: SocialPresenceHeadline;
  /** Null when the viewer may not see activity. */
  readonly activityLabel: string | null;
  /** Null when the viewer may not see location. */
  readonly location: SocialLocation | null;
  /** The party id only when the viewer may see it (a fellow member, or a friend of an OPEN party). */
  readonly partyId: string | null;
  readonly lastSeenAtIso: string | null;
  readonly can: SocialActionAvailability;
  /** Why something is hidden or refused, for a tooltip -- never the subject's settings verbatim. */
  readonly restrictedReason: SocialRestrictedReason | null;
}

/** The founder's list of presence states, as one headline per person per viewer. */
export const SOCIAL_PRESENCE_HEADLINES = [
  'ONLINE',
  'IN WONDERLAND',
  'CREATING',
  'WORKING WITH JULIUS',
  'IN PRIVATE SERVER',
  'IN GVE',
  'IN MISSION',
  'IN PARTY',
  'AWAY',
  'BUSY',
  'OFFLINE',
] as const;
export type SocialPresenceHeadline = (typeof SOCIAL_PRESENCE_HEADLINES)[number];

export const SOCIAL_RESTRICTED_REASONS = ['PRIVATE', 'FRIENDS_ONLY', 'BLOCKED', 'OFFLINE'] as const;
export type SocialRestrictedReason = (typeof SOCIAL_RESTRICTED_REASONS)[number];

/** What a viewer can do to a person right now. One answer, computed once, shown everywhere. */
export interface SocialActionAvailability {
  readonly viewProfile: boolean;
  readonly message: boolean;
  readonly inviteToParty: boolean;
  readonly joinParty: boolean;
  readonly inviteToServer: boolean;
  readonly joinServer: boolean;
  readonly sendFriendRequest: boolean;
  readonly removeFriend: boolean;
  readonly mute: boolean;
  readonly block: boolean;
  readonly report: boolean;
}

/* ---------------------------------------------------------------- privacy */

export const SOCIAL_AUDIENCES = ['EVERYONE', 'FRIENDS', 'PARTY', 'NOBODY'] as const;
export type SocialAudience = (typeof SOCIAL_AUDIENCES)[number];

export const PARTY_PRIVACIES = ['OPEN_TO_FRIENDS', 'INVITE_ONLY', 'CLOSED'] as const;
export type PartyPrivacy = (typeof PARTY_PRIVACIES)[number];

/**
 * A PERSON'S OWN RULES ABOUT THEMSELVES. Defaults are the conservative ones: friends see where you are and what you are
 * doing, strangers see that you exist.
 */
export interface SocialPrivacySettings {
  readonly userId: SocialUserId;
  /** Who sees you online at all. Outside it you are OFFLINE. */
  readonly presenceVisibility: SocialAudience;
  /** Who sees what you are doing. */
  readonly activityVisibility: SocialAudience;
  /** Who sees which server/place you are in. A PRIVATE_SERVER additionally needs `privateServerVisibility`. */
  readonly locationVisibility: SocialAudience;
  readonly privateServerVisibility: SocialAudience;
  /** Who may send you a direct message. */
  readonly messagePolicy: SocialAudience;
  /** Who may send you a friend request: EVERYONE or NOBODY (FRIENDS is meaningless here and treated as NOBODY). */
  readonly friendRequestPolicy: SocialAudience;
  /** Who may join the server you are in (when its own rules allow it at all). */
  readonly serverJoinPolicy: SocialAudience;
  /** Whether you appear in other people's Recent Players. */
  readonly appearInRecentPlayers: boolean;
}

export function defaultPrivacySettings(userId: SocialUserId): SocialPrivacySettings {
  return {
    userId,
    presenceVisibility: 'EVERYONE',
    activityVisibility: 'FRIENDS',
    locationVisibility: 'FRIENDS',
    privateServerVisibility: 'NOBODY',
    messagePolicy: 'FRIENDS',
    friendRequestPolicy: 'EVERYONE',
    serverJoinPolicy: 'FRIENDS',
    appearInRecentPlayers: true,
  };
}

/* ---------------------------------------------------------- relationships */

/** A friendship is mutual and exists once, keyed by the ordered pair. */
export interface FriendRelationship {
  readonly userA: SocialUserId;
  readonly userB: SocialUserId;
  readonly sinceIso: string;
}

export const FRIEND_REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

export interface FriendRequest {
  readonly requestId: string;
  readonly fromUserId: SocialUserId;
  readonly toUserId: SocialUserId;
  readonly status: FriendRequestStatus;
  readonly createdAtIso: string;
  readonly resolvedAtIso: string | null;
}

/** One-way. `blockerId` blocked `blockedId`; the effects are symmetric for presence and messaging (social-privacy.ts). */
export interface SocialBlock {
  readonly blockerId: SocialUserId;
  readonly blockedId: SocialUserId;
  readonly sinceIso: string;
}

/** LOCAL to the muter: mutes voice and message notifications from somebody, changes nothing they can see. */
export interface SocialMute {
  readonly muterId: SocialUserId;
  readonly mutedId: SocialUserId;
  readonly voice: boolean;
  readonly messages: boolean;
}

export const SOCIAL_REPORT_REASONS = ['HARASSMENT', 'SPAM', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'CHEATING', 'OTHER'] as const;
export type SocialReportReason = (typeof SOCIAL_REPORT_REASONS)[number];

/** A report is filed, never acted on here: moderation is a backend concern (and is not over-built before the basic loop). */
export interface SocialReport {
  readonly reportId: string;
  readonly reporterId: SocialUserId;
  readonly reportedId: SocialUserId;
  readonly reason: SocialReportReason;
  readonly note: string;
  /** What the report is about, if anything: a message id or a conversation id. Never a copy of the content. */
  readonly subjectRef: string | null;
  readonly filedAtIso: string;
}

/** What one viewer is to one subject. Derived, never stored. */
export const SOCIAL_RELATIONSHIPS = ['SELF', 'FRIEND', 'REQUEST_SENT', 'REQUEST_RECEIVED', 'NONE', 'BLOCKED', 'BLOCKED_BY'] as const;
export type SocialRelationship = (typeof SOCIAL_RELATIONSHIPS)[number];

/** Somebody you played alongside. Kept by the person who saw them, never shown to the other side. */
export const RECENT_PLAYER_CONTEXTS = ['SESSION', 'PARTY', 'GVE', 'CHALLENGE'] as const;
export type RecentPlayerContext = (typeof RECENT_PLAYER_CONTEXTS)[number];

export interface RecentPlayerEntry {
  readonly ownerId: SocialUserId;
  readonly userId: SocialUserId;
  readonly context: RecentPlayerContext;
  /**
   * e.g. the session name or "GVE: Tower Lane". Profile-safe. For a PARTY meeting it is STORED as the party's id -- the label's
   * source -- and shown to each viewer through recentPlayersViewFor (social-parties.ts): the party's name only while that viewer
   * may see that party (never across a wall), else "Party". No stored label ever names a person.
   */
  readonly contextLabel: string;
  readonly metAtIso: string;
}

/* ---------------------------------------------------------------- profile */

/**
 * RANK AND LEVEL ARE PENDING, AND THEIR SHAPE IS NOT DECIDED HERE.
 *
 * FOUNDER, 2026-10-01: "Keep rank = PENDING, level = PENDING as typed nullable fields until we deliberately design
 * Wonderland's player progression system." And: "Do NOT use the seven Chakra tiers as the player's future rank/level scale"
 * (the chakra tier is cosmetic: relay-chakra.ts), and "Glicko-2 remains an AI Agent competitive rating and should not become
 * the player's Wonderland rank."
 *
 * So the only source is PENDING and both values are null by type. When the progression system is designed, this interface
 * is widened deliberately -- a type change every surface then has to meet -- rather than a placeholder scale being filled in.
 */
export const PROGRESSION_SOURCES = ['PENDING'] as const;
export type ProgressionSource = (typeof PROGRESSION_SOURCES)[number];

export interface PlayerProgression {
  readonly source: ProgressionSource;
  readonly rank: null;
  readonly level: null;
}

export const PENDING_PROGRESSION: PlayerProgression = Object.freeze({ source: 'PENDING', rank: null, level: null });

/** A Compound AI Agent as anybody may see it: identity and public record, never configuration. */
export const COMPOUND_AGENT_KINDS = ['JULIUS', 'IMPORTED'] as const;
export type CompoundAgentKind = (typeof COMPOUND_AGENT_KINDS)[number];

export interface PublicAgentRating {
  /** The arena mode, as `relay_wonderland.agent_ratings.mode`. */
  readonly mode: 'GOAL' | 'EVAL';
  readonly rating: number;
  readonly deviation: number;
  readonly battleCount: number;
  /** A provisional rating is shown as such. */
  readonly provisional: boolean;
}

export interface PublicCompoundAgentProfile {
  readonly agentId: string;
  readonly ownerId: SocialUserId;
  readonly kind: CompoundAgentKind;
  readonly displayName: string;
  /** e.g. "Julius 3.3" or an imported system's own name. */
  readonly systemLabel: string;
  /** An emblem the client knows how to draw, e.g. "julius-rings". Never a URL to fetch. */
  readonly emblemId: string;
  readonly ratings: readonly PublicAgentRating[];
}

/** The canonical skins (WonderlandRelaySkins.cpp registry). An unknown id renders Relay OG. */
export const RELAY_DOG_SKIN_IDS = ['relay_og', 'celestial_light', 'skeleton_flame', 'jack_flame', 'baal', 'shadow_flame'] as const;
export type RelayDogSkinId = (typeof RELAY_DOG_SKIN_IDS)[number];

/** A colour as `#RRGGBB`. */
export type SocialHexColour = string;

export interface PublicRelayDogProfile {
  readonly skinId: RelayDogSkinId;
  readonly primary: SocialHexColour | null;
  readonly secondary: SocialHexColour | null;
  /** Null = the skin's designed fire. */
  readonly flame: SocialHexColour | null;
  /**
   * COSMETIC: a CHOSEN accent for the Dog's eyes and collar (relay-chakra.ts). Never shown as, beside, or in place of the
   * player's rank -- the profile draws it only as part of the Dog.
   */
  readonly appearanceTier: ChakraTier | null;
}

export const COMPANION_KINDS = ['LLM_COMPANION', 'JHINN_AGENT', 'SUB_AGENT_CUB', 'OTHER'] as const;
export type CompanionKind = (typeof COMPANION_KINDS)[number];

export interface PublicCompanionProfile {
  readonly companionId: string;
  readonly ownerId: SocialUserId;
  readonly kind: CompanionKind;
  readonly displayName: string;
  readonly primary: SocialHexColour | null;
  readonly secondary: SocialHexColour | null;
}

/** A statistic shown on a profile, with where it came from. A number with no source is not shown. */
export interface PublicProfileStat {
  readonly statId: string;
  readonly label: string;
  readonly value: string;
  readonly source: 'LEDGER' | 'ARENA' | 'PENDING';
}

/**
 * THE GAMER PROFILE (founder: "a CHARACTER + AI LOADOUT PROFILE rather than a corporate account page"). The LEFT column of
 * the screen is `primaryAgent` + `relayDog`; everything else is the centre and right.
 */
export interface UserProfile {
  readonly userId: SocialUserId;
  readonly displayName: string;
  /** A short unique handle, e.g. "@kai". */
  readonly handle: string;
  /** An avatar the client knows how to draw ("generated:<seed>") or an approved image ref. Never a remote URL. */
  readonly avatarRef: string;
  readonly nationId: WonderlandNationId | null;
  readonly clanName: string | null;
  readonly progression: PlayerProgression;
  readonly primaryAgent: PublicCompoundAgentProfile | null;
  readonly relayDog: PublicRelayDogProfile;
  readonly activeCompanion: PublicCompanionProfile | null;
  /** Other agents and companions the owner CHOSE to show. Order is the owner's. */
  readonly showcaseAgents: readonly PublicCompoundAgentProfile[];
  readonly showcaseCompanions: readonly PublicCompanionProfile[];
  readonly stats: readonly PublicProfileStat[];
  readonly memberSinceIso: string;
}

/** A profile as one viewer sees it: the public card plus the viewer-specific presence, relationship and mutual friends. */
export interface UserProfileView {
  readonly profile: UserProfile;
  readonly presence: UserPresenceView;
  readonly relationship: SocialRelationship;
  /** Only friends of both; empty for a stranger who hides their friends, and always for a block. */
  readonly mutualFriendIds: readonly SocialUserId[];
  readonly partyStatus: { readonly inParty: boolean; readonly memberCount: number | null; readonly joinable: boolean };
}

/* ----------------------------------------------------------- conversations */

export const CONVERSATION_KINDS = ['DIRECT', 'GROUP', 'PARTY'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export interface Conversation {
  readonly conversationId: string;
  readonly kind: ConversationKind;
  readonly memberIds: readonly SocialUserId[];
  /** Null for DIRECT (the other person's name is the title). */
  readonly title: string | null;
  /** For PARTY conversations, the party they belong to. */
  readonly partyId: string | null;
  readonly createdAtIso: string;
  /** The highest message sequence in the conversation; 0 when empty. */
  readonly lastSequence: number;
  readonly lastMessageAtIso: string | null;
}

export const MESSAGE_KINDS = ['TEXT', 'PARTY_INVITE', 'SERVER_INVITE', 'SYSTEM'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MESSAGE_MAX_CHARS = 2000;

export interface Message {
  readonly messageId: string;
  readonly conversationId: string;
  /** 1, 2, 3 … per conversation: the order and the unread arithmetic. */
  readonly sequence: number;
  readonly senderId: SocialUserId;
  readonly kind: MessageKind;
  readonly body: string;
  /** For PARTY_INVITE: the invite id; for SERVER_INVITE: the server id. */
  readonly ref: string | null;
  readonly sentAtIso: string;
}

/** Per member: the last sequence they have read. Unread = lastSequence - lastReadSequence (own messages count as read). */
export interface ConversationReadState {
  readonly conversationId: string;
  readonly userId: SocialUserId;
  readonly lastReadSequence: number;
}

/* ------------------------------------------------------------------ party */

export const PARTY_MAX_MEMBERS = 8;
export const PARTY_INVITE_PERMISSIONS = ['LEADER_ONLY', 'ANY_MEMBER'] as const;
export type PartyInvitePermission = (typeof PARTY_INVITE_PERMISSIONS)[number];

export const PARTY_ROLES = ['LEADER', 'MEMBER'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export interface PartyMember {
  readonly userId: SocialUserId;
  readonly role: PartyRole;
  readonly joinedAtIso: string;
  /** The member muted their own microphone. Everybody sees it. (A LOCAL mute of somebody else lives in SocialMute.) */
  readonly selfMuted: boolean;
}

/** A persistent group, independent of being in the same server. */
export interface Party {
  readonly partyId: string;
  readonly name: string;
  readonly leaderId: SocialUserId;
  readonly members: readonly PartyMember[];
  readonly privacy: PartyPrivacy;
  readonly invitePermission: PartyInvitePermission;
  readonly createdAtIso: string;
  readonly version: number;
}

export const PARTY_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED'] as const;
export type PartyInviteStatus = (typeof PARTY_INVITE_STATUSES)[number];

export const PARTY_INVITE_TTL_MS = 30 * 60_000;

export interface PartyInvite {
  readonly inviteId: string;
  readonly partyId: string;
  readonly fromUserId: SocialUserId;
  readonly toUserId: SocialUserId;
  readonly status: PartyInviteStatus;
  readonly createdAtIso: string;
  readonly expiresAtIso: string;
}

/* ------------------------------------------------------------------ voice */

/**
 * THE VOICE CONNECTION AS THE UI SEES IT, whoever carries it. `UNAVAILABLE` is the honest state of a build with no voice
 * provider configured: the panel says VOICE TRANSPORT PENDING rather than showing a connection that does not exist.
 */
export const VOICE_CONNECTION_STATES = ['UNAVAILABLE', 'DISCONNECTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'FAILED'] as const;
export type VoiceConnectionState = (typeof VOICE_CONNECTION_STATES)[number];

export interface VoiceParticipantState {
  readonly userId: SocialUserId;
  readonly connected: boolean;
  /** Their own microphone is muted (by them). */
  readonly micMuted: boolean;
  /** They are speaking now. Only ever true while connected and not mic-muted. */
  readonly speaking: boolean;
  /** THIS viewer has muted them locally. */
  readonly mutedLocally: boolean;
}

export interface PartyVoiceState {
  readonly partyId: string | null;
  readonly connection: VoiceConnectionState;
  /** Which provider is carrying it, e.g. "local-harness", or null when none is configured. */
  readonly providerId: string | null;
  readonly participants: readonly VoiceParticipantState[];
  /**
   * Why the connection is where it is, for the panel's one status line: "VOICE TRANSPORT PENDING" while UNAVAILABLE, the
   * provider's reason while RECONNECTING or FAILED, null otherwise. Never a credential or a server address.
   */
  readonly detail: string | null;
}

/* -------------------------------------------------- what is never social */

/**
 * NEVER IN A SOCIAL RECORD (founder: "Do NOT expose credentials; private prompts; Project Brain private data; private
 * mission information; provider keys; hidden system information"). Named so a test can scan every view for them. The
 * multiplayer slice's own list is included: a social view is replicated to other people just as a session is.
 */
export const NEVER_SOCIAL_CONCERNS = [
  'accountCredentials',
  'sessionToken',
  'providerKey',
  'apiKey',
  'systemPrompt',
  'prompt',
  'agentConfig',
  'brainRef',
  'projectBrain',
  'missionContract',
  'missionPrivate',
  'projectFiles',
  'creationSource',
  'walletBalance',
  'spendingPolicy',
  'email',
  'coordinates',
] as const;

/**
 * WONDERLAND SOCIAL — the state every rule reads, and the relationship questions every rule asks.
 *
 * ONE STATE, NOT ONE PER WIDGET. The Friends list, a conversation, a profile and a party are views over this record; the
 * mutations in social-friends.ts, social-conversations.ts and social-parties.ts each take it and return the next one.
 * Immutable and pure, so the same sequence of commands gives the same state on every machine -- the property the
 * deterministic QA (social.test.ts) and, later, a server-side replay rely on.
 *
 * This is the DOMAIN layer. Persistence (033_wonderland_social.sql) stores the same records row by row; transport carries
 * commands in and views out. Neither is imported here.
 */

import {
  PARTY_MAX_MEMBERS,
  type Conversation,
  type ConversationReadState,
  type FriendRelationship,
  type FriendRequest,
  type Message,
  type Party,
  type PartyInvite,
  type RecentPlayerEntry,
  type SocialAudience,
  type SocialBlock,
  type SocialMute,
  type SocialPrivacySettings,
  type SocialRelationship,
  type SocialReport,
  type SocialUserId,
  type UserPresence,
  type UserProfile,
} from './social-contracts';
import type { LffCreation, LffHeldPost, LffJoinRequest, LffPost, LffPostSnapshot } from './social-lff';

/** Everything known about one account. */
export interface SocialUserRecord {
  readonly profile: UserProfile;
  readonly privacy: SocialPrivacySettings;
  readonly presence: UserPresence;
}

export interface SocialState {
  readonly users: Readonly<Record<SocialUserId, SocialUserRecord>>;
  readonly friendships: readonly FriendRelationship[];
  readonly requests: readonly FriendRequest[];
  readonly blocks: readonly SocialBlock[];
  readonly mutes: readonly SocialMute[];
  readonly reports: readonly SocialReport[];
  readonly recentPlayers: readonly RecentPlayerEntry[];
  readonly parties: Readonly<Record<string, Party>>;
  readonly partyInvites: readonly PartyInvite[];
  readonly conversations: Readonly<Record<string, Conversation>>;
  readonly messages: Readonly<Record<string, readonly Message[]>>;
  readonly readStates: readonly ConversationReadState[];
  /** LFF, the Looking For Feed (social-lff.ts): the posts, and the requests to join them. Never part of the snapshot. */
  readonly lffPosts: readonly LffPost[];
  readonly lffRequests: readonly LffJoinRequest[];
  /** When each player created posts, inside the rolling creation window only (social-lff.ts LFF_MAX_CREATED_PER_WINDOW). */
  readonly lffCreations: readonly LffCreation[];
  /**
   * MODERATION EVIDENCE (founder D-L5, contract r2.4; social-lff.ts rule 8): EVIDENCE posts that left every player surface -- their
   * owner deleted them, or retention reached them -- kept as last written, with every request on them, ordered by the post id's
   * serial. A held post is in NEITHER lffPosts NOR lffRequests, so every rule and every view reads it exactly as a deleted one; NO
   * player surface reads this list. Never part of the snapshot.
   */
  readonly lffHeld: readonly LffHeldPost[];
  /**
   * EVIDENCE SNAPSHOTS (social-lff.ts rule 8): for every post a qualifying report made evidence, the post as it read when that report
   * was filed, then after each later edit -- append-only, ordered by the post id's serial then seq, held or live alike. Its first
   * entry for a post IS the record that the post is evidence. NO player surface reads this list. Never part of the snapshot.
   */
  readonly lffSnapshots: readonly LffPostSnapshot[];
  /** Monotonic id source, so ids are deterministic in tests and replays. */
  readonly nextSerial: number;
}

export function emptySocialState(): SocialState {
  return {
    users: {},
    friendships: [],
    requests: [],
    blocks: [],
    mutes: [],
    reports: [],
    recentPlayers: [],
    parties: {},
    partyInvites: [],
    conversations: {},
    messages: {},
    readStates: [],
    lffPosts: [],
    lffRequests: [],
    lffCreations: [],
    lffHeld: [],
    lffSnapshots: [],
    nextSerial: 1,
  };
}

/** A deterministic id and the state that has consumed it. */
export function mintId(state: SocialState, prefix: string): { id: string; state: SocialState } {
  return { id: `${prefix}_${state.nextSerial}`, state: { ...state, nextSerial: state.nextSerial + 1 } };
}

/* ------------------------------------------------------------- questions */

/*
 * OWN KEYS ONLY (CORE, 10-07, MAIN JUJU's finding). `users`, `conversations` and `messages` are plain objects indexed by ids a
 * client can send (a path segment, a body field), and a plain object answers for keys it never stored: users["constructor"] is
 * Object.prototype.constructor, users["__proto__"] is Object.prototype itself. hasUser("toString") was TRUE, and the read after it
 * dereferenced a function (a TypeError, so a 500). Every read with such an id goes through these: undefined (or none) unless the
 * record is the map's OWN. Party lookups go through partyById below, by the same rule (WL-351-01: a party id `constructor` is a
 * clean 404 "party not found" on every party route, never a 500).
 */
export const hasUser = (state: SocialState, userId: SocialUserId): boolean => Object.hasOwn(state.users, userId);

export function userById(state: SocialState, userId: SocialUserId): SocialUserRecord | undefined {
  return Object.hasOwn(state.users, userId) ? state.users[userId] : undefined;
}

export function conversationById(state: SocialState, conversationId: string): Conversation | undefined {
  return Object.hasOwn(state.conversations, conversationId) ? state.conversations[conversationId] : undefined;
}

/** A conversation's messages by the same rule: none unless the list is the map's own. */
export function messagesOf(state: SocialState, conversationId: string): readonly Message[] {
  return Object.hasOwn(state.messages, conversationId) ? state.messages[conversationId] : [];
}

/**
 * An LFF post or join request by id, or undefined. Lists searched by their records' own ids, so a client-sent id such as
 * `constructor` or `__proto__` (it matches the route's id shape) is simply no record -- never something Object.prototype holds
 * (the own-keys rule above; social-own-keys.test.ts).
 */
export function lffPostById(state: SocialState, postId: string): LffPost | undefined {
  return state.lffPosts.find((p) => p.id === postId);
}

export function lffRequestById(state: SocialState, requestId: string): LffJoinRequest | undefined {
  return state.lffRequests.find((r) => r.id === requestId);
}

export function areFriends(state: SocialState, a: SocialUserId, b: SocialUserId): boolean {
  if (a === b) return false;
  return state.friendships.some((f) => (f.userA === a && f.userB === b) || (f.userA === b && f.userB === a));
}

export function hasBlocked(state: SocialState, blockerId: SocialUserId, blockedId: SocialUserId): boolean {
  return state.blocks.some((b) => b.blockerId === blockerId && b.blockedId === blockedId);
}

/** A block in EITHER direction ends privileged visibility both ways (founder: "A blocked player must not continue receiving
 *  privileged presence/location information"). */
export const blockedEitherWay = (state: SocialState, a: SocialUserId, b: SocialUserId): boolean =>
  hasBlocked(state, a, b) || hasBlocked(state, b, a);

export function pendingRequestBetween(state: SocialState, from: SocialUserId, to: SocialUserId): FriendRequest | undefined {
  return state.requests.find((r) => r.status === 'PENDING' && r.fromUserId === from && r.toUserId === to);
}

/** The party a user is in, if any. A user is in at most one party. */
export function partyOf(state: SocialState, userId: SocialUserId): Party | undefined {
  return Object.values(state.parties).find((p) => p.members.some((m) => m.userId === userId));
}

/**
 * The party with this id, or undefined. An OWN key only: a request's party id such as `constructor` or `__proto__` matches the
 * route's id shape ([A-Za-z0-9_-]{1,80}), and a plain `state.parties[id]` hands back what Object.prototype holds under that
 * name -- a TypeError (a 500, without no-store) where the answer is "party not found" (MAIN's internal review a6d5842c, m4).
 */
export function partyById(state: SocialState, partyId: string): Party | undefined {
  return Object.hasOwn(state.parties, partyId) ? state.parties[partyId] : undefined;
}

export const sharePartyWith = (state: SocialState, a: SocialUserId, b: SocialUserId): boolean => {
  const party = partyOf(state, a);
  return party !== undefined && party.members.some((m) => m.userId === b);
};

/** What the viewer is to the subject. */
export function relationshipOf(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): SocialRelationship {
  if (viewerId === subjectId) return 'SELF';
  if (hasBlocked(state, viewerId, subjectId)) return 'BLOCKED';
  if (hasBlocked(state, subjectId, viewerId)) return 'BLOCKED_BY';
  if (areFriends(state, viewerId, subjectId)) return 'FRIEND';
  if (pendingRequestBetween(state, viewerId, subjectId)) return 'REQUEST_SENT';
  if (pendingRequestBetween(state, subjectId, viewerId)) return 'REQUEST_RECEIVED';
  return 'NONE';
}

/**
 * WHETHER A SUBJECT'S AUDIENCE SETTING ADMITS THIS VIEWER. The one place an audience is interpreted; a block is checked
 * before this is ever asked.
 */
export function audienceAdmits(
  state: SocialState,
  audience: SocialAudience,
  viewerId: SocialUserId,
  subjectId: SocialUserId,
): boolean {
  if (viewerId === subjectId) return true;
  switch (audience) {
    case 'EVERYONE':
      return true;
    case 'FRIENDS':
      return areFriends(state, viewerId, subjectId);
    case 'PARTY':
      return sharePartyWith(state, viewerId, subjectId);
    case 'NOBODY':
      return false;
  }
}

/**
 * HIDDEN FROM THIS VIEWER by the subject's own choice (the founder, 10-04, P1 + P2): their presence audience leaves the viewer
 * out, or they appear offline. Not the same as offline -- someone who simply signed out is NOT hidden. Used where presence
 * would otherwise leak sideways: the live world view (P1) and the Recent Players read (P2).
 */
export function presenceHiddenFrom(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): boolean {
  if (viewerId === subjectId) return false;
  const subject = userById(state, subjectId);
  if (subject === undefined) return true;
  return subject.presence.availability === 'APPEAR_OFFLINE' || !audienceAdmits(state, subject.privacy.presenceVisibility, viewerId, subjectId);
}

/**
 * SEEN ONLINE BY THIS VIEWER: exactly when resolvePresenceFor shows the subject to the viewer as anything but OFFLINE -- connected,
 * not blocked either way, and not presenceHiddenFrom the viewer. Not a second visibility model: it is the presence authority's own
 * `online`, without the rest of the view, so the party rules below can ask it without recursing into the presence resolver
 * (social-party-visibility.test.ts holds the two equal for every viewer and subject).
 */
export function seenOnlineBy(state: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): boolean {
  const subject = userById(state, subjectId);
  if (subject === undefined || !subject.presence.connected) return false;
  if (viewerId === subjectId) return true;
  return !blockedEitherWay(state, viewerId, subjectId) && !presenceHiddenFrom(state, viewerId, subjectId);
}

/**
 * A PARTY SEEN FROM OUTSIDE IT (WL-351-02, the independent review of #351, 10-13). A viewer who is not a member sees a party -- in
 * the snapshot's visibleParties, a friend's presence and profile, parties.read, a Recent Players label -- and may join it, only
 * when ALL of these hold:
 *   - it is OPEN_TO_FRIENDS;
 *   - nobody in it is blocked either way with the viewer (the wall, as before);
 *   - its LEADER is seen online by the viewer (seenOnlineBy). An APPEAR_OFFLINE leader's party is not there, exactly as a
 *     signed-out leader's is not: the founder's "Appear offline looks identical to a real sign-out". (The reviewer's repro: Nova,
 *     hidden, started "Quiet", and every friend's next snapshot listed it, led by her.)
 *   - a FRIEND of the viewer is among the members the viewer sees online, so the roster shown always holds the reason the party
 *     is shown. A party listed for a friend who is hidden inside it would itself say "a friend of yours is in here";
 *   - it has ROOM (MAIN's ruling on r1's question 2, 10-13). A full party is not there for an outsider at all: shown as "not
 *     joinable" beside a visible roster with room, it would count the members hidden from them. Members still see it whole.
 * The roster an outsider sees is the members they see online (partyRosterFor): nobody hidden from them (P1: a member hidden from
 * strangers is no id, role, mute state or count to a stranger), and nobody offline either, so a member who goes Appear Offline
 * leaves it exactly as one who signs out does. Members see their own party whole, as before.
 */
export function outsiderSeesParty(state: SocialState, viewerId: SocialUserId, party: Party): boolean {
  if (party.privacy !== 'OPEN_TO_FRIENDS' || party.members.length >= PARTY_MAX_MEMBERS) return false;
  if (party.members.some((m) => m.userId === viewerId || blockedEitherWay(state, viewerId, m.userId))) return false;
  if (!seenOnlineBy(state, viewerId, party.leaderId)) return false;
  return party.members.some((m) => areFriends(state, viewerId, m.userId) && seenOnlineBy(state, viewerId, m.userId));
}

/**
 * THE MEMBERS OF A PARTY THIS VIEWER MAY SEE, and so may count. A member: everybody but whoever is blocked either way with them
 * (F1, 10-02, unchanged). An outsider: nobody unless outsiderSeesParty, and then only the members they see online.
 */
export function partyRosterFor(state: SocialState, viewerId: SocialUserId, party: Party): Party['members'] {
  if (party.members.some((m) => m.userId === viewerId)) {
    return party.members.filter((m) => m.userId === viewerId || !blockedEitherWay(state, viewerId, m.userId));
  }
  if (!outsiderSeesParty(state, viewerId, party)) return [];
  return party.members.filter((m) => seenOnlineBy(state, viewerId, m.userId));
}

export function friendIdsOf(state: SocialState, userId: SocialUserId): SocialUserId[] {
  return state.friendships
    .filter((f) => f.userA === userId || f.userB === userId)
    .map((f) => (f.userA === userId ? f.userB : f.userA))
    .sort();
}

export function isMuted(state: SocialState, muterId: SocialUserId, mutedId: SocialUserId, what: 'voice' | 'messages'): boolean {
  return state.mutes.some((m) => m.muterId === muterId && m.mutedId === mutedId && m[what]);
}

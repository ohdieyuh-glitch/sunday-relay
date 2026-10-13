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

import type {
  Conversation,
  ConversationReadState,
  FriendRelationship,
  FriendRequest,
  Message,
  Party,
  PartyInvite,
  RecentPlayerEntry,
  SocialAudience,
  SocialBlock,
  SocialMute,
  SocialPrivacySettings,
  SocialRelationship,
  SocialReport,
  SocialUserId,
  UserPresence,
  UserProfile,
} from './social-contracts';

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
 * record is the map's OWN. Party lookups are swept the same way on the voice branch (partyById), not here.
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

export function friendIdsOf(state: SocialState, userId: SocialUserId): SocialUserId[] {
  return state.friendships
    .filter((f) => f.userA === userId || f.userB === userId)
    .map((f) => (f.userA === userId ? f.userB : f.userA))
    .sort();
}

export function isMuted(state: SocialState, muterId: SocialUserId, mutedId: SocialUserId, what: 'voice' | 'messages'): boolean {
  return state.mutes.some((m) => m.muterId === muterId && m.mutedId === mutedId && m[what]);
}

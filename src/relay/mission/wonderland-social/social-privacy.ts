import {
  WONDERLAND_RECENT_PLAYERS_LIMIT,
  wonderlandServerIdOfInstance,
  wonderlandServerInstanceId,
  type WonderlandActivity,
  type WonderlandLocation,
  type WonderlandSocialState,
} from './social-contracts';
import { wonderlandPartyOf, wonderlandServerMembers } from './social-commands';
import { isWonderlandBlockedPair, isWonderlandVisibleTo, wonderlandRelationOf } from './social-relations';

/**
 * THE PRIVACY WALL — every read a player can make of other players, as a
 * projection over the durable social state.
 *
 * THE ONE RULE THE TESTS HOLD EVERY PROJECTION TO: for a viewer who may not see
 * a player, the projection with that player present is IDENTICAL — same keys,
 * same values, same order — to the projection with that player absent. Not
 * "the entry is redacted"; not "a count is decremented somewhere else"; the
 * same bytes. A redacted entry, a total, a capacity denominator, a "1 hidden"
 * badge or a different error code would each be presence inferred.
 *
 * THEREFORE, DELIBERATELY:
 *   - no projection carries a total, a hidden count, or a capacity;
 *   - "unavailable" is one shape for offline, hidden, blocked, stranger and
 *     unknown, so a lookup cannot tell them apart;
 *   - entries are sorted by player id, so arrival order says nothing;
 *   - the only free text that reaches another player is a display name from
 *     the account and a message body the sender typed to them.
 *
 * Pure: no clock, no store.
 */

export interface WonderlandRosterEntry {
  readonly playerId: string;
  /** From the account. Null renders Unknown — never a guessed name. */
  readonly displayName: string | null;
  readonly dogId: string | null;
  readonly location: WonderlandLocation | null;
  readonly activity: WonderlandActivity;
  readonly relation: 'SELF' | 'FRIEND' | 'PARTY' | 'STRANGER';
  /** Only in a private server's instance, and only for an entry the viewer may see. */
  readonly role: 'OWNER' | 'MEMBER' | null;
}

export type WonderlandRosterView =
  | { readonly available: true; readonly instanceId: string; readonly population: number; readonly players: readonly WonderlandRosterEntry[] }
  | { readonly available: false };

const UNAVAILABLE = Object.freeze({ available: false as const });

const byPlayerId = <T extends { readonly playerId: string }>(left: T, right: T): number =>
  (left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0);

/**
 * WHO THE VIEWER SEES IN THE INSTANCE THEY ARE STANDING IN (P1, NO INFERENCE).
 * A viewer who is not in the instance sees nothing of it here: a roster is what
 * you see around you, not a directory of somewhere else.
 */
export function projectWonderlandRoster(state: WonderlandSocialState, viewerId: string, instanceId: string): WonderlandRosterView {
  if (state.presence[viewerId]?.instanceId !== instanceId) return UNAVAILABLE;
  const server = (() => {
    const serverId = wonderlandServerIdOfInstance(instanceId);
    return serverId === null ? null : state.servers[serverId] ?? null;
  })();
  const players = Object.values(state.presence)
    .filter((presence) => presence.instanceId === instanceId && isWonderlandVisibleTo(state, viewerId, presence.playerId))
    .map((presence): WonderlandRosterEntry => {
      const relation = wonderlandRelationOf(state, viewerId, presence.playerId) as WonderlandRosterEntry['relation'];
      return Object.freeze({
        playerId: presence.playerId,
        displayName: state.profiles[presence.playerId]?.displayName ?? null,
        dogId: presence.dogId,
        location: presence.location,
        activity: presence.activity,
        relation,
        role: server === null ? null : server.ownerId === presence.playerId ? 'OWNER' : 'MEMBER',
      });
    })
    .sort(byPlayerId);
  return Object.freeze({ available: true as const, instanceId, population: players.length, players: Object.freeze(players) });
}

export interface WonderlandInstanceListing {
  readonly instanceId: string;
  /** Players the VIEWER may see there. Never a total, never a capacity. */
  readonly population: number;
}

/**
 * THE INSTANCE BROWSER (P1). Public instances count only the players the viewer
 * may see; a private server's instance is listed only to its members.
 */
export function projectWonderlandInstanceListing(
  state: WonderlandSocialState,
  viewerId: string,
  publicInstanceIds: readonly string[],
): readonly WonderlandInstanceListing[] {
  const own = Object.values(state.servers)
    .filter((server) => wonderlandServerMembers(server).includes(viewerId))
    .map((server) => wonderlandServerInstanceId(server.serverId));
  const ids = [...new Set([...publicInstanceIds.filter((id) => id.startsWith('public:')), ...own])].sort();
  return Object.freeze(ids.map((instanceId) => Object.freeze({
    instanceId,
    population: Object.values(state.presence)
      .filter((presence) => presence.instanceId === instanceId && isWonderlandVisibleTo(state, viewerId, presence.playerId)).length,
  })));
}

export type WonderlandPresenceView =
  | { readonly status: 'AVAILABLE'; readonly playerId: string; readonly instanceId: string; readonly location: WonderlandLocation | null; readonly activity: WonderlandActivity }
  | { readonly status: 'UNAVAILABLE' };

const PRESENCE_UNAVAILABLE = Object.freeze({ status: 'UNAVAILABLE' as const });

/**
 * WHERE IS THIS PLAYER — answered for friends and party-mates only.
 * A stranger's whereabouts are never answered by lookup (only by standing in
 * the same instance and seeing them, if they allow it). Offline, hidden,
 * blocked, stranger and unknown are one answer.
 */
export function projectWonderlandPresenceOf(state: WonderlandSocialState, viewerId: string, subjectId: string): WonderlandPresenceView {
  const relation = wonderlandRelationOf(state, viewerId, subjectId);
  if (relation !== 'SELF' && relation !== 'FRIEND' && relation !== 'PARTY') return PRESENCE_UNAVAILABLE;
  const presence = state.presence[subjectId];
  if (presence === undefined) return PRESENCE_UNAVAILABLE;
  return Object.freeze({
    status: 'AVAILABLE' as const, playerId: subjectId, instanceId: presence.instanceId,
    location: presence.location, activity: presence.activity,
  });
}

export interface WonderlandFriendView {
  readonly playerId: string;
  readonly displayName: string | null;
  readonly presence: WonderlandPresenceView;
}

export function projectWonderlandFriends(state: WonderlandSocialState, viewerId: string): {
  readonly friends: readonly WonderlandFriendView[];
  readonly incomingRequests: readonly string[];
  readonly outgoingRequests: readonly string[];
} {
  const friends = state.friendships
    .map((key) => key.split('|') as [string, string])
    .filter(([a, b]) => a === viewerId || b === viewerId)
    .map(([a, b]) => (a === viewerId ? b : a))
    .filter((friendId) => !isWonderlandBlockedPair(state, viewerId, friendId))
    .map((friendId) => Object.freeze({
      playerId: friendId,
      displayName: state.profiles[friendId]?.displayName ?? null,
      presence: projectWonderlandPresenceOf(state, viewerId, friendId),
    }))
    .sort(byPlayerId);
  const unblocked = (id: string): boolean => !isWonderlandBlockedPair(state, viewerId, id);
  return Object.freeze({
    friends: Object.freeze(friends),
    incomingRequests: Object.freeze(state.friendRequests.filter((r) => r.toId === viewerId).map((r) => r.fromId).filter(unblocked).sort()),
    outgoingRequests: Object.freeze(state.friendRequests.filter((r) => r.fromId === viewerId).map((r) => r.toId).filter(unblocked).sort()),
  });
}

export interface WonderlandRecentPlayer {
  readonly playerId: string;
  readonly displayName: string | null;
  readonly instanceId: string;
  readonly at: string;
}

/**
 * P2: RECENT PLAYERS, FILTERED AT READ TIME. A player now blocked in either
 * direction, or now hidden from strangers and a stranger to the viewer, is not
 * listed, whatever was true when the two met. (And a meeting the viewer could
 * not see was never recorded: see `encountersOnEnter`.)
 */
export function projectWonderlandRecentPlayers(
  state: WonderlandSocialState,
  viewerId: string,
  limit = WONDERLAND_RECENT_PLAYERS_LIMIT,
): readonly WonderlandRecentPlayer[] {
  return Object.freeze(state.encounters
    .filter((encounter) => encounter.playerId === viewerId && isWonderlandVisibleTo(state, viewerId, encounter.otherId))
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : left.otherId < right.otherId ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map((encounter) => Object.freeze({
      playerId: encounter.otherId,
      displayName: state.profiles[encounter.otherId]?.displayName ?? null,
      instanceId: encounter.instanceId,
      at: encounter.at,
    })));
}

export type WonderlandPartyView =
  | {
    readonly inParty: true;
    readonly partyId: string;
    readonly leaderId: string;
    readonly members: readonly { readonly playerId: string; readonly displayName: string | null; readonly presence: WonderlandPresenceView }[];
    /** Outgoing invitations, shown to the leader only. */
    readonly invited: readonly string[];
  }
  | { readonly inParty: false; readonly invitations: readonly { readonly partyId: string; readonly inviterId: string }[] };

/**
 * THE VIEWER'S PARTY. A blocked pair cannot share a party (the block cascade
 * ends it), and this projection does not trust that: a member blocked with the
 * viewer is filtered here too.
 */
export function projectWonderlandParty(state: WonderlandSocialState, viewerId: string): WonderlandPartyView {
  const party = wonderlandPartyOf(state, viewerId);
  if (party === null) {
    const invitations = state.partyInvites
      .filter((invite) => invite.inviteeId === viewerId && state.parties[invite.partyId] !== undefined)
      .filter((invite) => !state.parties[invite.partyId]!.memberIds.some((member) => isWonderlandBlockedPair(state, member, viewerId)))
      .map((invite) => Object.freeze({ partyId: invite.partyId, inviterId: invite.inviterId }))
      .sort((left, right) => (left.partyId < right.partyId ? -1 : 1));
    return Object.freeze({ inParty: false as const, invitations: Object.freeze(invitations) });
  }
  const members = party.memberIds
    .filter((member) => !isWonderlandBlockedPair(state, viewerId, member))
    .map((member) => Object.freeze({
      playerId: member,
      displayName: state.profiles[member]?.displayName ?? null,
      presence: projectWonderlandPresenceOf(state, viewerId, member),
    }));
  return Object.freeze({
    inParty: true as const,
    partyId: party.partyId,
    leaderId: party.leaderId,
    members: Object.freeze(members),
    invited: Object.freeze(party.leaderId === viewerId
      ? state.partyInvites.filter((invite) => invite.partyId === party.partyId).map((invite) => invite.inviteeId).sort()
      : []),
  });
}

export type WonderlandServerView =
  | {
    readonly available: true;
    readonly serverId: string;
    readonly name: string;
    readonly viewerRole: 'OWNER' | 'MEMBER';
    /** Members the viewer may see, the owner included only if visible. Never a count of the rest. */
    readonly members: readonly { readonly playerId: string; readonly displayName: string | null; readonly role: 'OWNER' | 'MEMBER' }[];
  }
  | { readonly available: false };

/**
 * A PRIVATE SERVER, AS ONE OF ITS MEMBERS SEES IT. The member list follows the
 * same visibility rule as a roster: a member hidden from strangers is absent
 * from a stranger's list — the owner's included (OWNER_NOT_EXEMPT).
 */
export function projectWonderlandServer(state: WonderlandSocialState, viewerId: string, serverId: string): WonderlandServerView {
  const server = state.servers[serverId];
  if (server === undefined || !wonderlandServerMembers(server).includes(viewerId)) return UNAVAILABLE;
  const members = wonderlandServerMembers(server)
    .filter((member) => isWonderlandVisibleTo(state, viewerId, member))
    .map((member) => Object.freeze({
      playerId: member,
      displayName: state.profiles[member]?.displayName ?? null,
      role: member === server.ownerId ? 'OWNER' as const : 'MEMBER' as const,
    }))
    .sort(byPlayerId);
  return Object.freeze({
    available: true as const,
    serverId,
    name: server.name,
    viewerRole: server.ownerId === viewerId ? 'OWNER' as const : 'MEMBER' as const,
    members: Object.freeze(members),
  });
}

/** The servers the viewer belongs to, and the invitations they may act on. */
export function projectWonderlandServers(state: WonderlandSocialState, viewerId: string): {
  readonly servers: readonly { readonly serverId: string; readonly name: string; readonly viewerRole: 'OWNER' | 'MEMBER' }[];
  readonly invitations: readonly { readonly serverId: string; readonly name: string }[];
} {
  const servers = Object.values(state.servers)
    .filter((server) => wonderlandServerMembers(server).includes(viewerId))
    .map((server) => Object.freeze({ serverId: server.serverId, name: server.name, viewerRole: server.ownerId === viewerId ? 'OWNER' as const : 'MEMBER' as const }))
    .sort((left, right) => (left.serverId < right.serverId ? -1 : 1));
  const invitations = state.serverInvites
    .filter((invite) => invite.inviteeId === viewerId)
    .map((invite) => state.servers[invite.serverId])
    .filter((server): server is NonNullable<typeof server> => server !== undefined && !isWonderlandBlockedPair(state, server.ownerId, viewerId))
    .map((server) => Object.freeze({ serverId: server.serverId, name: server.name }))
    .sort((left, right) => (left.serverId < right.serverId ? -1 : 1));
  return Object.freeze({ servers: Object.freeze(servers), invitations: Object.freeze(invitations) });
}

export interface WonderlandMessageView {
  readonly messageId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly body: string;
  readonly sentAt: string;
}

/**
 * DM: A CONVERSATION, HIDDEN FROM BOTH SIDES WHILE A BLOCK EXISTS. The history
 * is not deleted — an unblock shows it again — and nothing can be added during
 * the block (`SEND_MESSAGE` refuses and stores nothing).
 */
export function projectWonderlandConversation(state: WonderlandSocialState, viewerId: string, otherId: string): readonly WonderlandMessageView[] {
  if (viewerId === otherId || isWonderlandBlockedPair(state, viewerId, otherId)) return Object.freeze([]);
  return Object.freeze(state.messages
    .filter((m) => (m.fromId === viewerId && m.toId === otherId) || (m.fromId === otherId && m.toId === viewerId))
    .sort((left, right) => (left.sentAt < right.sentAt ? -1 : left.sentAt > right.sentAt ? 1 : left.messageId < right.messageId ? -1 : 1))
    .map((m) => Object.freeze({ messageId: m.messageId, fromId: m.fromId, toId: m.toId, body: m.body, sentAt: m.sentAt })));
}

/** The viewer's conversations, newest first, with every blocked counterpart left out. */
export function projectWonderlandInbox(state: WonderlandSocialState, viewerId: string): readonly { readonly otherId: string; readonly lastAt: string }[] {
  const last = new Map<string, string>();
  for (const message of state.messages) {
    const counterpart = message.fromId === viewerId ? message.toId : message.toId === viewerId ? message.fromId : null;
    if (counterpart === null || isWonderlandBlockedPair(state, viewerId, counterpart)) continue;
    const previous = last.get(counterpart);
    if (previous === undefined || message.sentAt > previous) last.set(counterpart, message.sentAt);
  }
  return Object.freeze([...last.entries()]
    .sort(([leftId, leftAt], [rightId, rightAt]) => (leftAt < rightAt ? 1 : leftAt > rightAt ? -1 : leftId < rightId ? -1 : 1))
    .map(([otherId, lastAt]) => Object.freeze({ otherId, lastAt })));
}

/**
 * VOICE (NO INFERENCE): who may hear whom in one channel. A listener hears a
 * speaker only when the listener may SEE the speaker — a voice with no Dog is
 * presence inferred — so a blocked pair is mutually inaudible and a player
 * hidden from strangers is inaudible to them. The trusted voice server enforces
 * this as per-listener hard mutes; the client is never asked to.
 */
export function wonderlandVoiceRouting(
  state: WonderlandSocialState,
  participantIds: readonly string[],
): readonly { readonly listenerId: string; readonly audibleSpeakerIds: readonly string[]; readonly mutedSpeakerIds: readonly string[] }[] {
  const participants = [...new Set(participantIds)].sort();
  return Object.freeze(participants.map((listenerId) => {
    const others = participants.filter((id) => id !== listenerId);
    return Object.freeze({
      listenerId,
      audibleSpeakerIds: Object.freeze(others.filter((speaker) => isWonderlandVisibleTo(state, listenerId, speaker))),
      mutedSpeakerIds: Object.freeze(others.filter((speaker) => !isWonderlandVisibleTo(state, listenerId, speaker))),
    });
  }));
}

/**
 * The voice roster a LISTENER is shown: the audible speakers only. The muted
 * list above is for the trusted server and never reaches a client, because a
 * client told "you cannot hear X" has just been told X is there.
 */
export function projectWonderlandVoiceRoster(state: WonderlandSocialState, listenerId: string, participantIds: readonly string[]): readonly string[] {
  if (!participantIds.includes(listenerId)) return Object.freeze([]);
  return wonderlandVoiceRouting(state, participantIds).find((row) => row.listenerId === listenerId)?.audibleSpeakerIds ?? Object.freeze([]);
}

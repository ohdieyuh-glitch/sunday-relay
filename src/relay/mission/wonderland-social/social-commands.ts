import {
  WONDERLAND_EMPTY_SOCIAL_STATE,
  WONDERLAND_PARTY_MAX_MEMBERS,
  WONDERLAND_SERVER_MAX_MEMBERS,
  isWonderlandActivity,
  isWonderlandEntityId,
  isWonderlandInstanceId,
  isWonderlandPlayerId,
  parseWonderlandLocation,
  parseWonderlandMessageBody,
  parseWonderlandServerName,
  parseWonderlandSocialSettings,
  wonderlandFriendKey,
  wonderlandServerIdOfInstance,
  WONDERLAND_DOG_ID,
  type WonderlandParty,
  type WonderlandPrivateServer,
  type WonderlandSocialCommand,
  type WonderlandSocialMutation,
  type WonderlandSocialOutcome,
  type WonderlandSocialRefusal,
  type WonderlandSocialState,
} from './social-contracts';
import { isWonderlandBlockedPair, isWonderlandVisibleTo } from './social-relations';
import { wonderlandLiveState } from './social-liveness';

/**
 * DECIDE, THEN APPLY — the whole of the social layer's write path.
 *
 * `decideWonderlandSocialCommand` reads the state and returns an outcome plus
 * the mutations that outcome implies; it changes nothing. `applyWonderland
 * SocialMutations` folds those mutations into a new state. The memory store and
 * the PostgreSQL store both call `decide` and then apply the SAME mutation list
 * (the PostgreSQL store as SQL), so the two stores cannot decide one command two
 * ways — the decision exists once.
 *
 * EVERY COMMAND NAMES ITS ACTOR, and the actor is the session's player, never a
 * field of the request. A command that acts on another player checks the
 * actor's authority over them before anything else.
 *
 * THE BLOCK CASCADE (P4, P5, PARTY, DM) lives in `BLOCK`, in one place, so that
 * "a block removes the friendship, ends the invitations, takes the blocked
 * member out of the owner's server, takes a non-leader blocker out of the party
 * and ejects whoever was removed from the instance they were standing in" is a
 * single reviewed list rather than a rule scattered across handlers.
 */

const refuse = (code: WonderlandSocialRefusal): { outcome: WonderlandSocialOutcome; mutations: readonly WonderlandSocialMutation[] } =>
  ({ outcome: { ok: false, code }, mutations: [] });
const done = (mutations: readonly WonderlandSocialMutation[]): { outcome: WonderlandSocialOutcome; mutations: readonly WonderlandSocialMutation[] } =>
  ({ outcome: { ok: true, code: mutations.length === 0 ? 'NO_CHANGE' : 'DONE' }, mutations: Object.freeze([...mutations]) });

export const wonderlandPartyOf = (state: WonderlandSocialState, playerId: string): WonderlandParty | null =>
  Object.values(state.parties).find((party) => party.memberIds.includes(playerId)) ?? null;

export const wonderlandServerMembers = (server: WonderlandPrivateServer): readonly string[] => [server.ownerId, ...server.memberIds];

/** Removing a member from a party: the next leader is the earliest remaining member; an empty party disbands. */
function partyDeparture(party: WonderlandParty, playerId: string): WonderlandSocialMutation[] {
  const remaining = party.memberIds.filter((id) => id !== playerId);
  if (remaining.length === 0) return [{ kind: 'PARTY_DISBANDED', partyId: party.partyId }];
  const mutations: WonderlandSocialMutation[] = [{ kind: 'PARTY_MEMBER_REMOVED', partyId: party.partyId, playerId }];
  if (party.leaderId === playerId) mutations.push({ kind: 'PARTY_LEADER_SET', partyId: party.partyId, leaderId: remaining[0]! });
  return mutations;
}

/** Leaving or being removed from a private server ends presence in its instance. */
function serverDeparture(state: WonderlandSocialState, server: WonderlandPrivateServer, playerId: string): WonderlandSocialMutation[] {
  const mutations: WonderlandSocialMutation[] = [{ kind: 'SERVER_MEMBER_REMOVED', serverId: server.serverId, playerId }];
  if (state.presence[playerId]?.instanceId === `server:${server.serverId}`) mutations.push({ kind: 'PRESENCE_CLEARED', playerId });
  return mutations;
}

/**
 * WHAT ENTERING AN INSTANCE RECORDS IN RECENT PLAYERS (the write half of P2).
 *
 * An encounter is recorded for a viewer only when the other player was VISIBLE
 * to that viewer at that moment. Read-time filtering alone is not enough: a
 * hidden player who later turns visible would otherwise surface, in a
 * stranger's Recent Players, as having been in the same instance at a time
 * nobody could see them — presence inferred after the fact.
 */
function encountersOnEnter(state: WonderlandSocialState, actorId: string, instanceId: string, at: string): WonderlandSocialMutation[] {
  const mutations: WonderlandSocialMutation[] = [];
  for (const other of Object.values(state.presence)) {
    if (other.playerId === actorId || other.instanceId !== instanceId) continue;
    if (isWonderlandVisibleTo(state, actorId, other.playerId)) {
      mutations.push({ kind: 'ENCOUNTER_RECORDED', encounter: { playerId: actorId, otherId: other.playerId, instanceId, at } });
    }
    if (isWonderlandVisibleTo(state, other.playerId, actorId)) {
      mutations.push({ kind: 'ENCOUNTER_RECORDED', encounter: { playerId: other.playerId, otherId: actorId, instanceId, at } });
    }
  }
  return mutations;
}

/**
 * THE BLOCK CASCADE. Everything a block ends, in one list.
 *
 *   - the friendship, and pending friend requests in both directions;
 *   - party invitations between the two, in both directions;
 *   - PARTY: a leader who blocks a member removes the member; a non-leader who
 *     blocks anyone in the party (the leader included) leaves it;
 *   - P4: the owner of a private server who blocks a member removes the member;
 *   - P5: a member who blocks the server's owner leaves the server;
 *   - private-server invitations between the owner and the other party;
 *   - whoever is removed from a server stops standing in its instance.
 *
 * Two NON-owner members of the same server both stay: neither has authority
 * over the other, and the projection makes them invisible and inaudible to
 * each other while they share it.
 */
function blockCascade(state: WonderlandSocialState, blockerId: string, blockedId: string, at: string): WonderlandSocialMutation[] {
  const mutations: WonderlandSocialMutation[] = [{ kind: 'BLOCK_ADDED', blockerId, blockedId, at }];
  if (state.friendships.includes(wonderlandFriendKey(blockerId, blockedId))) {
    mutations.push({ kind: 'FRIENDSHIP_REMOVED', a: blockerId, b: blockedId });
  }
  for (const request of state.friendRequests) {
    if ((request.fromId === blockerId && request.toId === blockedId) || (request.fromId === blockedId && request.toId === blockerId)) {
      mutations.push({ kind: 'FRIEND_REQUEST_REMOVED', fromId: request.fromId, toId: request.toId });
    }
  }
  for (const invite of state.partyInvites) {
    const party = state.parties[invite.partyId];
    if (party === undefined) continue;
    const blockerSide = party.memberIds.includes(blockerId) && invite.inviteeId === blockedId;
    const blockedSide = party.memberIds.includes(blockedId) && invite.inviteeId === blockerId;
    if (blockerSide || blockedSide) mutations.push({ kind: 'PARTY_INVITE_REMOVED', partyId: invite.partyId, inviteeId: invite.inviteeId });
  }
  const party = wonderlandPartyOf(state, blockerId);
  if (party !== null && party.memberIds.includes(blockedId)) {
    mutations.push(...partyDeparture(party, party.leaderId === blockerId ? blockedId : blockerId));
  }
  for (const server of Object.values(state.servers)) {
    if (server.ownerId === blockerId && server.memberIds.includes(blockedId)) mutations.push(...serverDeparture(state, server, blockedId)); // P4
    if (server.ownerId === blockedId && server.memberIds.includes(blockerId)) mutations.push(...serverDeparture(state, server, blockerId)); // P5
    for (const invite of state.serverInvites) {
      if (invite.serverId !== server.serverId) continue;
      if ((server.ownerId === blockerId && invite.inviteeId === blockedId) || (server.ownerId === blockedId && invite.inviteeId === blockerId)) {
        mutations.push({ kind: 'SERVER_INVITE_REMOVED', serverId: server.serverId, inviteeId: invite.inviteeId });
      }
    }
  }
  return mutations;
}

/**
 * DECIDE ONE COMMAND. Returns what happened and the mutations that make it so.
 * Pure and total: a malformed command is `INVALID`, never an exception.
 */
export function decideWonderlandSocialCommand(
  stored: WonderlandSocialState,
  actorId: string,
  command: WonderlandSocialCommand,
  at: string,
): { readonly outcome: WonderlandSocialOutcome; readonly mutations: readonly WonderlandSocialMutation[] } {
  if (!isWonderlandPlayerId(actorId)) return refuse('INVALID');
  // Decided as the world IS at the command's time: an expired presence is nobody
  // standing anywhere (`social-liveness.ts`), so an entry records no encounter
  // with them and their own stale heartbeat is told to enter again.
  const state = wonderlandLiveState(stored, at);
  const other = (id: unknown): 'INVALID' | 'SELF' | null => (!isWonderlandPlayerId(id) ? 'INVALID' : id === actorId ? 'SELF' : null);
  // A player EXISTS when the account layer has given them a profile. A command
  // aimed at anyone else is UNAVAILABLE — the answer a block gives — so a typed
  // id can neither store junk nor test whether an account exists.
  const unknown = (id: string): boolean => state.profiles[id] === undefined;

  switch (command.kind) {
    case 'SET_SETTINGS': {
      const parsed = parseWonderlandSocialSettings(command.settings);
      if (!parsed.ok) return refuse('INVALID');
      const current = state.settings[actorId];
      if (current?.visibility === parsed.settings.visibility) return done([]);
      return done([{ kind: 'SETTINGS_SET', playerId: actorId, settings: parsed.settings }]);
    }

    case 'FRIEND_REQUEST': {
      const bad = other(command.toId); if (bad !== null) return refuse(bad);
      if (unknown(command.toId) || isWonderlandBlockedPair(state, actorId, command.toId)) return refuse('UNAVAILABLE');
      if (state.friendships.includes(wonderlandFriendKey(actorId, command.toId))) return done([]);
      // Two people asking each other is a friendship, not two requests.
      if (state.friendRequests.some((request) => request.fromId === command.toId && request.toId === actorId)) {
        return done([
          { kind: 'FRIEND_REQUEST_REMOVED', fromId: command.toId, toId: actorId },
          { kind: 'FRIENDSHIP_ADDED', a: actorId, b: command.toId, at },
        ]);
      }
      if (state.friendRequests.some((request) => request.fromId === actorId && request.toId === command.toId)) return done([]);
      return done([{ kind: 'FRIEND_REQUEST_ADDED', fromId: actorId, toId: command.toId, at }]);
    }

    case 'FRIEND_ACCEPT': {
      const bad = other(command.fromId); if (bad !== null) return refuse(bad);
      if (!state.friendRequests.some((request) => request.fromId === command.fromId && request.toId === actorId)) return refuse('UNAVAILABLE');
      if (isWonderlandBlockedPair(state, actorId, command.fromId)) return refuse('UNAVAILABLE');
      return done([
        { kind: 'FRIEND_REQUEST_REMOVED', fromId: command.fromId, toId: actorId },
        { kind: 'FRIENDSHIP_ADDED', a: actorId, b: command.fromId, at },
      ]);
    }

    case 'FRIEND_DECLINE': {
      const bad = other(command.fromId); if (bad !== null) return refuse(bad);
      if (!state.friendRequests.some((request) => request.fromId === command.fromId && request.toId === actorId)) return done([]);
      return done([{ kind: 'FRIEND_REQUEST_REMOVED', fromId: command.fromId, toId: actorId }]);
    }

    case 'FRIEND_REMOVE': {
      const bad = other(command.otherId); if (bad !== null) return refuse(bad);
      if (!state.friendships.includes(wonderlandFriendKey(actorId, command.otherId))) return done([]);
      return done([{ kind: 'FRIENDSHIP_REMOVED', a: actorId, b: command.otherId }]);
    }

    case 'BLOCK': {
      const bad = other(command.targetId); if (bad !== null) return refuse(bad);
      if (state.blocks.some((block) => block.blockerId === actorId && block.blockedId === command.targetId)) return done([]);
      if (unknown(command.targetId)) return refuse('UNAVAILABLE');
      return done(blockCascade(state, actorId, command.targetId, at));
    }

    case 'UNBLOCK': {
      const bad = other(command.targetId); if (bad !== null) return refuse(bad);
      // An unblock restores nothing the block ended: no friendship, no party, no
      // server membership. It only stops hiding the two from each other.
      if (!state.blocks.some((block) => block.blockerId === actorId && block.blockedId === command.targetId)) return done([]);
      return done([{ kind: 'BLOCK_REMOVED', blockerId: actorId, blockedId: command.targetId }]);
    }

    case 'PARTY_CREATE': {
      if (!isWonderlandEntityId(command.partyId)) return refuse('INVALID');
      if (state.parties[command.partyId] !== undefined) return refuse('ID_TAKEN');
      if (wonderlandPartyOf(state, actorId) !== null) return refuse('ALREADY_IN_PARTY');
      return done([{ kind: 'PARTY_CREATED', partyId: command.partyId, leaderId: actorId, at }]);
    }

    case 'PARTY_INVITE': {
      const bad = other(command.inviteeId); if (bad !== null) return refuse(bad);
      const party = wonderlandPartyOf(state, actorId);
      if (party === null) return refuse('NOT_IN_PARTY');
      if (party.leaderId !== actorId) return refuse('NOT_PERMITTED');
      if (party.memberIds.includes(command.inviteeId)) return done([]);
      if (unknown(command.inviteeId)) return refuse('UNAVAILABLE');
      // Blocked with ANY member, in either direction: inviting them would put a
      // blocked pair in one party. One generic answer for every reason.
      if (party.memberIds.some((member) => isWonderlandBlockedPair(state, member, command.inviteeId))) return refuse('UNAVAILABLE');
      if (state.partyInvites.some((invite) => invite.partyId === party.partyId && invite.inviteeId === command.inviteeId)) return done([]);
      return done([{ kind: 'PARTY_INVITE_ADDED', partyId: party.partyId, inviteeId: command.inviteeId, inviterId: actorId, at }]);
    }

    case 'PARTY_JOIN': {
      if (!isWonderlandEntityId(command.partyId)) return refuse('INVALID');
      const party = state.parties[command.partyId];
      const invited = state.partyInvites.some((invite) => invite.partyId === command.partyId && invite.inviteeId === actorId);
      if (party === undefined || !invited) return refuse('UNAVAILABLE');
      if (party.memberIds.includes(actorId)) return done([]);
      if (party.memberIds.some((member) => isWonderlandBlockedPair(state, member, actorId))) return refuse('UNAVAILABLE');
      if (party.memberIds.length >= WONDERLAND_PARTY_MAX_MEMBERS) return refuse('PARTY_FULL');
      const mutations: WonderlandSocialMutation[] = [];
      const current = wonderlandPartyOf(state, actorId);
      if (current !== null) mutations.push(...partyDeparture(current, actorId));
      mutations.push({ kind: 'PARTY_INVITE_REMOVED', partyId: party.partyId, inviteeId: actorId });
      mutations.push({ kind: 'PARTY_MEMBER_ADDED', partyId: party.partyId, playerId: actorId });
      return done(mutations);
    }

    case 'PARTY_LEAVE': {
      const party = wonderlandPartyOf(state, actorId);
      if (party === null) return refuse('NOT_IN_PARTY');
      return done(partyDeparture(party, actorId));
    }

    case 'PARTY_KICK': {
      const bad = other(command.memberId); if (bad !== null) return refuse(bad);
      const party = wonderlandPartyOf(state, actorId);
      if (party === null) return refuse('NOT_IN_PARTY');
      if (party.leaderId !== actorId) return refuse('NOT_PERMITTED');
      if (!party.memberIds.includes(command.memberId)) return done([]);
      return done(partyDeparture(party, command.memberId));
    }

    case 'SERVER_CREATE': {
      if (!isWonderlandEntityId(command.serverId)) return refuse('INVALID');
      const name = parseWonderlandServerName(command.name);
      if (name === null) return refuse('INVALID');
      if (state.servers[command.serverId] !== undefined) return refuse('ID_TAKEN');
      return done([{ kind: 'SERVER_CREATED', serverId: command.serverId, ownerId: actorId, name, at }]);
    }

    case 'SERVER_INVITE': {
      const bad = other(command.inviteeId); if (bad !== null) return refuse(bad);
      if (!isWonderlandEntityId(command.serverId)) return refuse('INVALID');
      const server = state.servers[command.serverId];
      if (server === undefined || server.ownerId !== actorId) return refuse('NOT_PERMITTED');
      if (server.memberIds.includes(command.inviteeId)) return done([]);
      if (unknown(command.inviteeId) || isWonderlandBlockedPair(state, actorId, command.inviteeId)) return refuse('UNAVAILABLE');
      if (state.serverInvites.some((invite) => invite.serverId === server.serverId && invite.inviteeId === command.inviteeId)) return done([]);
      return done([{ kind: 'SERVER_INVITE_ADDED', serverId: server.serverId, inviteeId: command.inviteeId, at }]);
    }

    case 'SERVER_JOIN': {
      if (!isWonderlandEntityId(command.serverId)) return refuse('INVALID');
      const server = state.servers[command.serverId];
      const invited = state.serverInvites.some((invite) => invite.serverId === command.serverId && invite.inviteeId === actorId);
      // Unknown, uninvited, or blocked with the owner either way: one answer.
      if (server === undefined) return refuse('UNAVAILABLE');
      if (wonderlandServerMembers(server).includes(actorId)) return done([]);
      if (!invited || isWonderlandBlockedPair(state, server.ownerId, actorId)) return refuse('UNAVAILABLE');
      if (wonderlandServerMembers(server).length >= WONDERLAND_SERVER_MAX_MEMBERS) return refuse('SERVER_FULL');
      return done([
        { kind: 'SERVER_INVITE_REMOVED', serverId: server.serverId, inviteeId: actorId },
        { kind: 'SERVER_MEMBER_ADDED', serverId: server.serverId, playerId: actorId },
      ]);
    }

    case 'SERVER_LEAVE': {
      if (!isWonderlandEntityId(command.serverId)) return refuse('INVALID');
      const server = state.servers[command.serverId];
      if (server === undefined || !server.memberIds.includes(actorId)) {
        // The owner cannot leave their own server; they would have to close it.
        return refuse(server?.ownerId === actorId ? 'NOT_PERMITTED' : 'NOT_A_MEMBER');
      }
      return done(serverDeparture(state, server, actorId));
    }

    case 'SERVER_REMOVE_MEMBER': {
      const bad = other(command.memberId); if (bad !== null) return refuse(bad);
      if (!isWonderlandEntityId(command.serverId)) return refuse('INVALID');
      const server = state.servers[command.serverId];
      if (server === undefined || server.ownerId !== actorId) return refuse('NOT_PERMITTED');
      if (!server.memberIds.includes(command.memberId)) return done([]);
      return done(serverDeparture(state, server, command.memberId));
    }

    case 'ENTER_INSTANCE': {
      if (!isWonderlandInstanceId(command.instanceId)) return refuse('INVALID');
      const location = parseWonderlandLocation(command.location);
      if (location === 'INVALID' || !isWonderlandActivity(command.activity)) return refuse('INVALID');
      if (command.dogId !== null && (typeof command.dogId !== 'string' || !WONDERLAND_DOG_ID.test(command.dogId))) return refuse('INVALID');
      const serverId = wonderlandServerIdOfInstance(command.instanceId);
      if (serverId !== null) {
        const server = state.servers[serverId];
        if (server === undefined || !wonderlandServerMembers(server).includes(actorId)) return refuse('UNAVAILABLE');
      }
      const previous = state.presence[actorId];
      const presence = { playerId: actorId, instanceId: command.instanceId, location, activity: command.activity, dogId: command.dogId, updatedAt: at };
      const mutations: WonderlandSocialMutation[] = [{ kind: 'PRESENCE_SET', presence }];
      // A move within the same instance is not a new meeting.
      if (previous?.instanceId !== command.instanceId) mutations.push(...encountersOnEnter(state, actorId, command.instanceId, at));
      return done(mutations);
    }

    case 'UPDATE_PRESENCE': {
      const location = parseWonderlandLocation(command.location);
      if (location === 'INVALID' || !isWonderlandActivity(command.activity)) return refuse('INVALID');
      const previous = state.presence[actorId];
      if (previous === undefined) return refuse('NOT_IN_INSTANCE');
      return done([{ kind: 'PRESENCE_SET', presence: { ...previous, location, activity: command.activity, updatedAt: at } }]);
    }

    case 'LEAVE_INSTANCE': {
      if (state.presence[actorId] === undefined) return done([]);
      return done([{ kind: 'PRESENCE_CLEARED', playerId: actorId }]);
    }

    case 'SEND_MESSAGE': {
      const bad = other(command.toId); if (bad !== null) return refuse(bad);
      if (!isWonderlandEntityId(command.messageId)) return refuse('INVALID');
      const body = parseWonderlandMessageBody(command.body);
      if (body === null) return refuse('INVALID');
      if (state.messages.some((message) => message.messageId === command.messageId)) return refuse('ID_TAKEN');
      // Blocked either way, or a recipient hidden from strangers who is a
      // stranger to the sender: one answer, and nothing is stored, so nothing
      // written during a block can surface after it.
      const friends = state.friendships.includes(wonderlandFriendKey(actorId, command.toId));
      const hidden = (state.settings[command.toId]?.visibility ?? 'EVERYONE') === 'HIDDEN_FROM_STRANGERS';
      if (unknown(command.toId) || isWonderlandBlockedPair(state, actorId, command.toId) || (hidden && !friends)) return refuse('UNAVAILABLE');
      return done([{ kind: 'MESSAGE_SENT', message: { messageId: command.messageId, fromId: actorId, toId: command.toId, body, sentAt: at } }]);
    }

    default:
      return refuse('INVALID');
  }
}

/** APPLY MUTATIONS, IN ORDER. Total: a mutation naming something absent changes nothing. */
export function applyWonderlandSocialMutations(
  state: WonderlandSocialState,
  mutations: readonly WonderlandSocialMutation[],
): WonderlandSocialState {
  let next: WonderlandSocialState = state ?? WONDERLAND_EMPTY_SOCIAL_STATE;
  for (const mutation of mutations) next = applyOne(next, mutation);
  return next;
}

function applyOne(state: WonderlandSocialState, mutation: WonderlandSocialMutation): WonderlandSocialState {
  switch (mutation.kind) {
    case 'SETTINGS_SET':
      return { ...state, settings: { ...state.settings, [mutation.playerId]: mutation.settings } };
    case 'FRIEND_REQUEST_ADDED':
      return { ...state, friendRequests: [...state.friendRequests, { fromId: mutation.fromId, toId: mutation.toId, at: mutation.at }] };
    case 'FRIEND_REQUEST_REMOVED':
      return { ...state, friendRequests: state.friendRequests.filter((r) => !(r.fromId === mutation.fromId && r.toId === mutation.toId)) };
    case 'FRIENDSHIP_ADDED': {
      const key = wonderlandFriendKey(mutation.a, mutation.b);
      return state.friendships.includes(key) ? state : { ...state, friendships: [...state.friendships, key].sort() };
    }
    case 'FRIENDSHIP_REMOVED': {
      const key = wonderlandFriendKey(mutation.a, mutation.b);
      return { ...state, friendships: state.friendships.filter((existing) => existing !== key) };
    }
    case 'BLOCK_ADDED':
      return state.blocks.some((b) => b.blockerId === mutation.blockerId && b.blockedId === mutation.blockedId)
        ? state
        : { ...state, blocks: [...state.blocks, { blockerId: mutation.blockerId, blockedId: mutation.blockedId, at: mutation.at }] };
    case 'BLOCK_REMOVED':
      return { ...state, blocks: state.blocks.filter((b) => !(b.blockerId === mutation.blockerId && b.blockedId === mutation.blockedId)) };
    case 'PARTY_CREATED':
      return {
        ...state,
        parties: { ...state.parties, [mutation.partyId]: { partyId: mutation.partyId, leaderId: mutation.leaderId, memberIds: [mutation.leaderId], createdAt: mutation.at } },
      };
    case 'PARTY_MEMBER_ADDED': {
      const party = state.parties[mutation.partyId];
      if (party === undefined || party.memberIds.includes(mutation.playerId)) return state;
      return { ...state, parties: { ...state.parties, [party.partyId]: { ...party, memberIds: [...party.memberIds, mutation.playerId] } } };
    }
    case 'PARTY_MEMBER_REMOVED': {
      const party = state.parties[mutation.partyId];
      if (party === undefined) return state;
      return { ...state, parties: { ...state.parties, [party.partyId]: { ...party, memberIds: party.memberIds.filter((id) => id !== mutation.playerId) } } };
    }
    case 'PARTY_LEADER_SET': {
      const party = state.parties[mutation.partyId];
      if (party === undefined) return state;
      return { ...state, parties: { ...state.parties, [party.partyId]: { ...party, leaderId: mutation.leaderId } } };
    }
    case 'PARTY_DISBANDED': {
      const { [mutation.partyId]: _gone, ...parties } = state.parties;
      return { ...state, parties, partyInvites: state.partyInvites.filter((invite) => invite.partyId !== mutation.partyId) };
    }
    case 'PARTY_INVITE_ADDED':
      return { ...state, partyInvites: [...state.partyInvites, { partyId: mutation.partyId, inviteeId: mutation.inviteeId, inviterId: mutation.inviterId, at: mutation.at }] };
    case 'PARTY_INVITE_REMOVED':
      return { ...state, partyInvites: state.partyInvites.filter((i) => !(i.partyId === mutation.partyId && i.inviteeId === mutation.inviteeId)) };
    case 'SERVER_CREATED':
      return {
        ...state,
        servers: { ...state.servers, [mutation.serverId]: { serverId: mutation.serverId, ownerId: mutation.ownerId, name: mutation.name, memberIds: [], createdAt: mutation.at } },
      };
    case 'SERVER_MEMBER_ADDED': {
      const server = state.servers[mutation.serverId];
      if (server === undefined || wonderlandServerMembers(server).includes(mutation.playerId)) return state;
      return { ...state, servers: { ...state.servers, [server.serverId]: { ...server, memberIds: [...server.memberIds, mutation.playerId] } } };
    }
    case 'SERVER_MEMBER_REMOVED': {
      const server = state.servers[mutation.serverId];
      if (server === undefined) return state;
      return { ...state, servers: { ...state.servers, [server.serverId]: { ...server, memberIds: server.memberIds.filter((id) => id !== mutation.playerId) } } };
    }
    case 'SERVER_INVITE_ADDED':
      return { ...state, serverInvites: [...state.serverInvites, { serverId: mutation.serverId, inviteeId: mutation.inviteeId, at: mutation.at }] };
    case 'SERVER_INVITE_REMOVED':
      return { ...state, serverInvites: state.serverInvites.filter((i) => !(i.serverId === mutation.serverId && i.inviteeId === mutation.inviteeId)) };
    case 'PRESENCE_SET':
      return { ...state, presence: { ...state.presence, [mutation.presence.playerId]: mutation.presence } };
    case 'PRESENCE_CLEARED': {
      const { [mutation.playerId]: _gone, ...presence } = state.presence;
      return { ...state, presence };
    }
    case 'ENCOUNTER_RECORDED': {
      const { playerId, otherId } = mutation.encounter;
      // One row per ordered pair: the latest meeting replaces the earlier one.
      const kept = state.encounters.filter((e) => !(e.playerId === playerId && e.otherId === otherId));
      return { ...state, encounters: [...kept, mutation.encounter] };
    }
    case 'MESSAGE_SENT':
      return { ...state, messages: [...state.messages, mutation.message] };
    default:
      return state;
  }
}

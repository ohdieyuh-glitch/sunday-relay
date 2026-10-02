/**
 * WONDERLAND SOCIAL — parties.
 *
 * A PARTY IS A PERSISTENT GROUP, not "being in the same server" (founder). It has a leader, up to eight members, its own
 * privacy and invite rules, and a voice channel whose STATE lives in social-voice.ts. One party per person.
 *
 * The basic loop first (founder: "Do not overbuild moderation/admin systems before the basic party loop works"): start,
 * invite, accept/decline, join, leave, self-mute; and the leader's remove, promote, privacy and invite permission.
 * Every mutation names its actor and checks them first.
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import {
  PARTY_INVITE_TTL_MS,
  PARTY_MAX_MEMBERS,
  type Party,
  type PartyInvite,
  type PartyInvitePermission,
  type PartyPrivacy,
  type SocialUserId,
} from './social-contracts';
import { areFriends, blockedEitherWay, hasUser, mintId, partyOf, type SocialState } from './social-state';
import { recordPlayedTogether } from './social-friends';

const denied = (message: string) => fail<SocialState>(relayError('permission-denied', message));
const invalid = (message: string) => fail<SocialState>(relayError('validation-failed', message));
const missing = (what: string) => fail<SocialState>(relayError('not-found', `${what} not found`));

const putParty = (state: SocialState, party: Party): SocialState => ({ ...state, parties: { ...state.parties, [party.partyId]: party } });

function withoutParty(state: SocialState, partyId: string): SocialState {
  const parties = { ...state.parties };
  delete parties[partyId];
  return {
    ...state,
    parties,
    partyInvites: state.partyInvites.map((i) => (i.partyId === partyId && i.status === 'PENDING' ? { ...i, status: 'REVOKED' } : i)),
  };
}

/** START A PARTY with the actor as leader. Refused while they are already in one. */
export function createParty(
  state: SocialState,
  actorId: SocialUserId,
  input: { name?: string; privacy?: PartyPrivacy },
  atIso: string,
): RelayResult<{ state: SocialState; partyId: string }> {
  if (!hasUser(state, actorId)) return fail(relayError('not-found', 'user not found'));
  if (partyOf(state, actorId)) return fail(relayError('validation-failed', 'already in a party'));
  const minted = mintId(state, 'pty');
  const party: Party = {
    partyId: minted.id,
    name: (input.name ?? '').trim().slice(0, 40) || `${state.users[actorId].profile.displayName}'s party`,
    leaderId: actorId,
    members: [{ userId: actorId, role: 'LEADER', joinedAtIso: atIso, selfMuted: false }],
    privacy: input.privacy ?? 'INVITE_ONLY',
    invitePermission: 'LEADER_ONLY',
    createdAtIso: atIso,
    version: 1,
  };
  return ok({ state: putParty(minted.state, party), partyId: party.partyId });
}

function mayInvite(party: Party, actorId: SocialUserId): boolean {
  return party.leaderId === actorId || (party.invitePermission === 'ANY_MEMBER' && party.members.some((m) => m.userId === actorId));
}

/**
 * INVITE SOMEBODY. The inviter must be allowed to by the party's rule; the invitee must be a friend of the inviter, not
 * blocked either way, not in this party, and the party must have room. One pending invite per person per party.
 */
export function inviteToParty(
  state: SocialState,
  actorId: SocialUserId,
  partyId: string,
  toUserId: SocialUserId,
  atIso: string,
): RelayResult<{ state: SocialState; inviteId: string }> {
  const party = state.parties[partyId];
  if (party === undefined) return fail(relayError('not-found', 'party not found'));
  if (!hasUser(state, toUserId)) return fail(relayError('not-found', 'user not found'));
  if (!mayInvite(party, actorId)) return fail(relayError('permission-denied', 'you cannot invite to this party'));
  if (blockedEitherWay(state, actorId, toUserId)) return fail(relayError('permission-denied', 'this person cannot be invited'));
  if (!areFriends(state, actorId, toUserId)) return fail(relayError('permission-denied', 'only friends can be invited'));
  if (party.members.some((m) => m.userId === toUserId)) return fail(relayError('validation-failed', 'already in this party'));
  if (party.members.length >= PARTY_MAX_MEMBERS) return fail(relayError('validation-failed', 'the party is full'));
  if (state.partyInvites.some((i) => i.partyId === partyId && i.toUserId === toUserId && i.status === 'PENDING')) {
    return fail(relayError('validation-failed', 'an invite is already pending'));
  }
  const minted = mintId(state, 'pinv');
  const invite: PartyInvite = {
    inviteId: minted.id,
    partyId,
    fromUserId: actorId,
    toUserId,
    status: 'PENDING',
    createdAtIso: atIso,
    expiresAtIso: new Date(Date.parse(atIso) + PARTY_INVITE_TTL_MS).toISOString(),
  };
  return ok({ state: { ...minted.state, partyInvites: [...minted.state.partyInvites, invite] }, inviteId: invite.inviteId });
}

function settleInvite(state: SocialState, inviteId: string, status: PartyInvite['status']): SocialState {
  return { ...state, partyInvites: state.partyInvites.map((i) => (i.inviteId === inviteId ? { ...i, status } : i)) };
}

function addMember(state: SocialState, party: Party, userId: SocialUserId, atIso: string): RelayResult<SocialState> {
  let next = putParty(state, {
    ...party,
    members: [...party.members, { userId, role: 'MEMBER', joinedAtIso: atIso, selfMuted: false }],
    version: party.version + 1,
  });
  for (const member of party.members) {
    const recorded = recordPlayedTogether(next, member.userId, userId, 'PARTY', party.name, atIso);
    if (recorded.ok) next = recorded.value;
  }
  return ok(next);
}

/** ACCEPT. Only the invitee, only while pending and unexpired, only into a party with room, and not while in another party. */
export function acceptPartyInvite(state: SocialState, actorId: SocialUserId, inviteId: string, atIso: string): RelayResult<SocialState> {
  const invite = state.partyInvites.find((i) => i.inviteId === inviteId);
  if (invite === undefined || invite.status !== 'PENDING') return missing('pending party invite');
  if (invite.toUserId !== actorId) return denied('only the invited person can accept');
  if (Date.parse(atIso) > Date.parse(invite.expiresAtIso)) return ok(settleInvite(state, inviteId, 'EXPIRED'));
  const party = state.parties[invite.partyId];
  if (party === undefined) return ok(settleInvite(state, inviteId, 'REVOKED'));
  if (partyOf(state, actorId)) return invalid('leave your current party first');
  if (party.members.length >= PARTY_MAX_MEMBERS) return invalid('the party is full');
  if (party.members.some((m) => blockedEitherWay(state, actorId, m.userId))) return denied('you cannot join this party');
  return addMember(settleInvite(state, inviteId, 'ACCEPTED'), party, actorId, atIso);
}

export function declinePartyInvite(state: SocialState, actorId: SocialUserId, inviteId: string): RelayResult<SocialState> {
  const invite = state.partyInvites.find((i) => i.inviteId === inviteId);
  if (invite === undefined || invite.status !== 'PENDING') return missing('pending party invite');
  if (invite.toUserId !== actorId) return denied('only the invited person can decline');
  return ok(settleInvite(state, inviteId, 'DECLINED'));
}

/** Pending, unexpired invites to one person: the Parties tab's inbox. */
export function partyInvitesFor(state: SocialState, userId: SocialUserId, nowIso: string): PartyInvite[] {
  return state.partyInvites.filter(
    (i) => i.toUserId === userId && i.status === 'PENDING' && Date.parse(nowIso) <= Date.parse(i.expiresAtIso) && state.parties[i.partyId] !== undefined,
  );
}

/**
 * JOIN WITHOUT AN INVITE: only an OPEN_TO_FRIENDS party, only for a friend of some member, never across a block with any
 * member, and only with room.
 */
export function joinParty(state: SocialState, actorId: SocialUserId, partyId: string, atIso: string): RelayResult<SocialState> {
  const party = state.parties[partyId];
  if (party === undefined) return missing('party');
  if (partyOf(state, actorId)) return invalid('leave your current party first');
  if (party.privacy !== 'OPEN_TO_FRIENDS') return denied('this party is invite only');
  if (party.members.some((m) => blockedEitherWay(state, actorId, m.userId))) return denied('you cannot join this party');
  if (!party.members.some((m) => areFriends(state, actorId, m.userId))) return denied('only friends of the party can join');
  if (party.members.length >= PARTY_MAX_MEMBERS) return invalid('the party is full');
  return addMember(state, party, actorId, atIso);
}

/**
 * LEAVE. A leaving leader hands the party to the longest-standing member; the last member out ends it (pending invites are
 * revoked with it).
 */
export function leaveParty(state: SocialState, actorId: SocialUserId): RelayResult<SocialState> {
  const party = partyOf(state, actorId);
  if (party === undefined) return invalid('not in a party');
  const rest = party.members.filter((m) => m.userId !== actorId);
  if (rest.length === 0) return ok(withoutParty(state, party.partyId));
  if (party.leaderId !== actorId) return ok(putParty(state, { ...party, members: rest, version: party.version + 1 }));
  const heir = [...rest].sort((a, b) => (a.joinedAtIso < b.joinedAtIso ? -1 : a.joinedAtIso > b.joinedAtIso ? 1 : a.userId < b.userId ? -1 : 1))[0];
  return ok(
    putParty(state, {
      ...party,
      leaderId: heir.userId,
      members: rest.map((m) => (m.userId === heir.userId ? { ...m, role: 'LEADER' } : m)),
      version: party.version + 1,
    }),
  );
}

/** LEADER: remove a member (not themselves -- that is leaving). */
export function removePartyMember(state: SocialState, actorId: SocialUserId, partyId: string, memberId: SocialUserId): RelayResult<SocialState> {
  const party = state.parties[partyId];
  if (party === undefined) return missing('party');
  if (party.leaderId !== actorId) return denied('only the leader can remove a member');
  if (memberId === actorId) return invalid('the leader leaves rather than removing themselves');
  if (!party.members.some((m) => m.userId === memberId)) return missing('member');
  return ok(putParty(state, { ...party, members: party.members.filter((m) => m.userId !== memberId), version: party.version + 1 }));
}

/** LEADER: hand the party to another member. */
export function promotePartyLeader(state: SocialState, actorId: SocialUserId, partyId: string, memberId: SocialUserId): RelayResult<SocialState> {
  const party = state.parties[partyId];
  if (party === undefined) return missing('party');
  if (party.leaderId !== actorId) return denied('only the leader can promote');
  if (!party.members.some((m) => m.userId === memberId) || memberId === actorId) return invalid('promote another member of this party');
  return ok(
    putParty(state, {
      ...party,
      leaderId: memberId,
      members: party.members.map((m) => ({ ...m, role: m.userId === memberId ? 'LEADER' : 'MEMBER' })),
      version: party.version + 1,
    }),
  );
}

/** LEADER: privacy and who may invite. */
export function setPartyRules(
  state: SocialState,
  actorId: SocialUserId,
  partyId: string,
  rules: { privacy?: PartyPrivacy; invitePermission?: PartyInvitePermission; name?: string },
): RelayResult<SocialState> {
  const party = state.parties[partyId];
  if (party === undefined) return missing('party');
  if (party.leaderId !== actorId) return denied('only the leader can change the party rules');
  return ok(
    putParty(state, {
      ...party,
      privacy: rules.privacy ?? party.privacy,
      invitePermission: rules.invitePermission ?? party.invitePermission,
      name: rules.name !== undefined ? rules.name.trim().slice(0, 40) || party.name : party.name,
      version: party.version + 1,
    }),
  );
}

/** A member's own microphone. Everybody in the party sees it; it is not a local mute (see setMute in social-friends.ts). */
export function setSelfMuted(state: SocialState, actorId: SocialUserId, muted: boolean): RelayResult<SocialState> {
  const party = partyOf(state, actorId);
  if (party === undefined) return invalid('not in a party');
  return ok(
    putParty(state, {
      ...party,
      members: party.members.map((m) => (m.userId === actorId ? { ...m, selfMuted: muted } : m)),
      version: party.version + 1,
    }),
  );
}

/** What a party looks like to one of its members, or to a friend allowed to see it. Null otherwise. */
export interface PartyView {
  readonly partyId: string;
  readonly name: string;
  readonly leaderId: SocialUserId;
  readonly members: readonly { userId: SocialUserId; role: Party['members'][number]['role']; selfMuted: boolean }[];
  readonly privacy: PartyPrivacy;
  readonly invitePermission: PartyInvitePermission;
  readonly viewerIsMember: boolean;
  readonly viewerIsLeader: boolean;
  readonly viewerMayInvite: boolean;
}

export function partyViewFor(state: SocialState, viewerId: SocialUserId, partyId: string): PartyView | null {
  const party = state.parties[partyId];
  if (party === undefined) return null;
  const member = party.members.some((m) => m.userId === viewerId);
  const friendOfOpen =
    party.privacy === 'OPEN_TO_FRIENDS' &&
    party.members.some((m) => areFriends(state, viewerId, m.userId)) &&
    !party.members.some((m) => blockedEitherWay(state, viewerId, m.userId));
  if (!member && !friendOfOpen) return null;
  return {
    partyId: party.partyId,
    name: party.name,
    leaderId: party.leaderId,
    members: party.members.map((m) => ({ userId: m.userId, role: m.role, selfMuted: m.selfMuted })),
    privacy: party.privacy,
    invitePermission: party.invitePermission,
    viewerIsMember: member,
    viewerIsLeader: party.leaderId === viewerId,
    viewerMayInvite: member && mayInvite(party, viewerId) && party.members.length < PARTY_MAX_MEMBERS,
  };
}

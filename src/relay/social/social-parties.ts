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
  type RecentPlayerEntry,
  type SocialUserId,
} from './social-contracts';
import { areFriends, blockedEitherWay, hasUser, mintId, outsiderSeesParty, partyById, partyOf, partyRosterFor, type SocialState } from './social-state';
import { recentPlayersFor, recordPlayedTogether } from './social-friends';

const denied = (message: string) => fail<SocialState>(relayError('permission-denied', message));
const invalid = (message: string) => fail<SocialState>(relayError('validation-failed', message));
const missing = (what: string) => fail<SocialState>(relayError('not-found', `${what} not found`));
const isMember = (party: Party, userId: SocialUserId) => party.members.some((m) => m.userId === userId);

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

/**
 * A party nobody named is called this. It used to be "<leader's display name>'s party", which carried the leader's name to
 * wherever the party's name went -- recent-player labels, an heir's party, invites -- including past a wall (Second's R16 run,
 * 10-04: B, blocked by A, read "stub-alpha's party"). The client may still draw "<leader>'s party" from the leader it can see.
 */
export const DEFAULT_PARTY_NAME = 'Party';

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
    name: (input.name ?? '').trim().slice(0, 40) || DEFAULT_PARTY_NAME,
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
 * Somebody in the party (other than this person) has a block with them, either way: the party is behind their wall.
 * Every caller looks `party` up by partyById (an own key), so a request's `constructor` never arrives here as a "party" (m4).
 */
export function walledFromParty(state: SocialState, party: Party, userId: SocialUserId): boolean {
  return party.members.some((m) => m.userId !== userId && blockedEitherWay(state, userId, m.userId));
}

/**
 * THE ONE ANSWER to "this person cannot be invited" (founder, 10-04: every refusal across a wall reads exactly like the
 * stranger case). Not a friend, blocked either way with the inviter, or walled from anybody already in the party: the same
 * code, the same words, the same work (a pure check; nothing is written either way).
 */
export const NOT_INVITABLE = 'this person cannot be invited';

/**
 * INVITE SOMEBODY. The inviter must be allowed to by the party's rule; the invitee must be a friend of the inviter, not
 * blocked either way with the inviter or with ANY member (an invite never carries a party -- its name included -- across a
 * wall), not in this party, and the party must have room. One pending invite per person per party.
 */
export function inviteToParty(
  state: SocialState,
  actorId: SocialUserId,
  partyId: string,
  toUserId: SocialUserId,
  atIso: string,
): RelayResult<{ state: SocialState; inviteId: string }> {
  const party = partyById(state, partyId);
  // A NON-MEMBER LEARNS NOTHING OF A PARTY (the privacy attacker's B2, 10-07): a 403 here against join's 404 told an outsider
  // the party exists, and then whether somebody in it has a block with them. Outside the party = no such party.
  if (party === undefined || !isMember(party, actorId)) return fail(relayError('not-found', 'party not found'));
  if (!hasUser(state, toUserId)) return fail(relayError('not-found', 'user not found'));
  if (!mayInvite(party, actorId)) return fail(relayError('permission-denied', 'you cannot invite to this party'));
  const walled = blockedEitherWay(state, actorId, toUserId) || walledFromParty(state, party, toUserId);
  if (!areFriends(state, actorId, toUserId) || walled) return fail(relayError('permission-denied', NOT_INVITABLE));
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
    // the label's SOURCE, not its text: resolved for each viewer by recentPlayersViewFor, so it never crosses a wall
    const recorded = recordPlayedTogether(next, member.userId, userId, 'PARTY', party.partyId, atIso);
    if (recorded.ok) next = recorded.value;
  }
  return ok(next);
}

/**
 * WL-358-02: the founder's words for an invitee who cannot join the party right now (it has filled). No count, no reason: the
 * client shows a refusal's message as it is (WonderlandSocialLive.cpp ErrorMessageOf -> the hub's or profile's action line).
 */
export const PARTY_NOT_JOINABLE_NOW = "You can't join this party right now";

/** An invite that crosses a wall: its inviter, or anybody in its party, has a block with the invitee, either way. */
function inviteIsWalled(state: SocialState, invite: PartyInvite): boolean {
  const party = partyById(state, invite.partyId);
  return blockedEitherWay(state, invite.toUserId, invite.fromUserId) || (party !== undefined && walledFromParty(state, party, invite.toUserId));
}

/**
 * ACCEPT. Only the invitee, only while pending and unexpired, only into a party with room, and not while in another party.
 * FOUNDER RULING (a), 10-04: nobody joins a party that holds somebody they blocked or who blocked them -- and the refusal reads
 * exactly like an invite that is no longer there (a block revokes such invites: blockUser; this answers the same for any that
 * a later join brought behind a wall).
 * An invite is NOT refused for a member hidden from the invitee (FOUNDER RULING WL-358-01, 10-13: "Invites still work"; the
 * open-join is what that rule closes, outsiderSeesParty).
 * FOUNDER RULING WL-358-02 ("Generic message", 10-13 15:52:09Z): a party that has filled since the invite answers
 * PARTY_NOT_JOINABLE_NOW, not "the party is full" -- which told an invitee the party holds PARTY_MAX_MEMBERS, counting members
 * hidden from them (F-01 of the internal #358 review). It is a not-found, the shape (HTTP 404) of every other generic party
 * refusal (a missing invite, a walled one, a missing party), and the invite stays PENDING: once there is room it is accepted.
 */
export function acceptPartyInvite(state: SocialState, actorId: SocialUserId, inviteId: string, atIso: string): RelayResult<SocialState> {
  const invite = state.partyInvites.find((i) => i.inviteId === inviteId);
  if (invite === undefined || invite.status !== 'PENDING') return missing('pending party invite');
  if (invite.toUserId !== actorId) return denied('only the invited person can accept');
  if (inviteIsWalled(state, invite)) return missing('pending party invite');
  if (Date.parse(atIso) > Date.parse(invite.expiresAtIso)) return ok(settleInvite(state, inviteId, 'EXPIRED'));
  const party = partyById(state, invite.partyId);
  if (party === undefined) return ok(settleInvite(state, inviteId, 'REVOKED'));
  if (partyOf(state, actorId)) return invalid('leave your current party first');
  if (party.members.length >= PARTY_MAX_MEMBERS) return fail(relayError('not-found', PARTY_NOT_JOINABLE_NOW));
  return addMember(settleInvite(state, inviteId, 'ACCEPTED'), party, actorId, atIso);
}

export function declinePartyInvite(state: SocialState, actorId: SocialUserId, inviteId: string): RelayResult<SocialState> {
  const invite = state.partyInvites.find((i) => i.inviteId === inviteId);
  if (invite === undefined || invite.status !== 'PENDING') return missing('pending party invite');
  if (invite.toUserId !== actorId) return denied('only the invited person can decline');
  return ok(settleInvite(state, inviteId, 'DECLINED'));
}

/**
 * Pending, unexpired invites to one person: the Parties tab's inbox. Never one across a wall: its inviter's name, its party's
 * name and its existence stay on the other side (a block revokes them; this holds for any a later join walled).
 */
export function partyInvitesFor(state: SocialState, userId: SocialUserId, nowIso: string): PartyInvite[] {
  return state.partyInvites.filter(
    (i) => i.toUserId === userId && i.status === 'PENDING' && Date.parse(nowIso) <= Date.parse(i.expiresAtIso) && partyById(state, i.partyId) !== undefined
      && !inviteIsWalled(state, i),
  );
}

/**
 * JOIN WITHOUT AN INVITE: only a party the joiner sees from outside (outsiderSeesParty: OPEN_TO_FRIENDS, with room, never across
 * a block with any member, EVERY member -- the leader included -- seen online by the joiner (WL-358-01), a friend among them).
 * A party behind the joiner's wall answers exactly as a party that does not exist (founder ruling (a): the refusal is an
 * ordinary "can't join", and it names nothing -- not even that the party is there); so does one they cannot see (WL-351-02: an
 * Appear-Offline leader's open party is no more joinable by id than it is listed), and so does one holding a member hidden
 * from them (FOUNDER RULING WL-358-01, "Block open-join": the same way as a party holding a blocked member).
 */
export function joinParty(state: SocialState, actorId: SocialUserId, partyId: string, atIso: string): RelayResult<SocialState> {
  // The joiner's own state first: it says nothing about the party asked for.
  if (partyOf(state, actorId)) return invalid('leave your current party first');
  const party = partyById(state, partyId);
  // ONE ANSWER FOR EVERY "CAN'T JOIN" (the privacy attacker's B2, 10-07): walled answered 404 while invite-only, no friend and
  // full answered 403/400, so a removed player could tell a block-kick from an ordinary kick, and follow whether the blocker is
  // still in the party. Not there, behind a wall, invite only, no friend inside, unseen (WL-351-02), holding a member hidden from
  // the joiner (WL-358-01) or full: one ordinary refusal that names nothing.
  if (party === undefined || !outsiderSeesParty(state, actorId, party)) return missing('party');
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

/** The party two players are both in, if any. */
export function sharedPartyOf(state: SocialState, a: SocialUserId, b: SocialUserId) {
  const party = partyOf(state, a);
  return party !== undefined && party.members.some((m) => m.userId === b) ? party : undefined;
}

/**
 * F1, THE FOUNDER'S FINAL RULE (2026-10-02): "LEADER REMOVES, ELSE BLOCKER LEAVES". When A blocks B while they share a party:
 *   - A LEADS: B is removed from A's party and A stays leader (a leader already has kick authority);
 *   - otherwise: A, the blocker, leaves; B stays (an ordinary member must NEVER kick anyone merely by blocking them).
 * Normal party semantics otherwise (no forced dissolution). Nothing changes when they share no party. The caller asks A to
 * confirm first: blocks.add refuses a block inside a shared party without `confirmSharedParty`, and changes nothing.
 */
export function separateForBlock(state: SocialState, blockerId: SocialUserId, blockedId: SocialUserId): RelayResult<SocialState> {
  const shared = sharedPartyOf(state, blockerId, blockedId);
  if (shared === undefined) return ok(state);
  return shared.leaderId === blockerId ? removePartyMember(state, blockerId, shared.partyId, blockedId) : leaveParty(state, blockerId);
}

/** What the confirmation says, by the same rule (the founder's own words). */
export function sharedPartyBlockWarning(state: SocialState, blockerId: SocialUserId, blockedName: string): string | null {
  const party = partyOf(state, blockerId);
  if (party === undefined) return null;
  return party.leaderId === blockerId
    ? `Blocking ${blockedName} will also remove them from your party.`
    : `Blocking ${blockedName} will cause you to leave this party.`;
}

/**
 * RECONCILIATION. A block and a shared party should never coexist (blocks.add separates them; joins and invites across a
 * block are refused), but data from before the rule, a restore or a race could carry one. The privacy wall (partyViewFor,
 * the audience floor, the voice audience) already hides the pair from each other; this then resolves the membership by
 * the same rule, for every such pair. Pure; applied before every operation (applySocialOperation).
 */
export function reconcileBlockedParties(state: SocialState): SocialState {
  let next = state;
  for (const block of state.blocks) {
    if (sharedPartyOf(next, block.blockerId, block.blockedId) === undefined) continue;
    const separated = separateForBlock(next, block.blockerId, block.blockedId);
    if (separated.ok) next = separated.value;
  }
  return next;
}

/**
 * WHO A PARTY MEMBER MAY HEAR AND SEE IN PARTY VOICE: the party's members, minus anyone blocked either way with them.
 * The voice roster is built from this (through the party view), and a real provider's audio routing and tokens must be
 * minted from it: two players blocked either way never hear each other, even while the wall holds a brief coexistence.
 * A provider with ONE room per party (EOS) cannot route around a wall, so the voice route admits only a member walled from
 * nobody (relay-bridge/wonderland-social-routes.ts voiceAudienceIfAdmitted): for them this is the whole party.
 */
export function voiceAudienceFor(state: SocialState, viewerId: SocialUserId, partyId: string): SocialUserId[] {
  const party = partyById(state, partyId);
  if (party === undefined || !party.members.some((m) => m.userId === viewerId)) return [];
  return party.members.map((m) => m.userId).filter((id) => id === viewerId || !blockedEitherWay(state, viewerId, id));
}

/** LEADER: remove a member (not themselves -- that is leaving). */
export function removePartyMember(state: SocialState, actorId: SocialUserId, partyId: string, memberId: SocialUserId): RelayResult<SocialState> {
  const party = partyById(state, partyId);
  if (party === undefined || !isMember(party, actorId)) return missing('party');   // B2: outside the party = no such party
  if (party.leaderId !== actorId) return denied('only the leader can remove a member');
  if (memberId === actorId) return invalid('the leader leaves rather than removing themselves');
  if (!party.members.some((m) => m.userId === memberId)) return missing('member');
  return ok(putParty(state, { ...party, members: party.members.filter((m) => m.userId !== memberId), version: party.version + 1 }));
}

/** LEADER: hand the party to another member. */
export function promotePartyLeader(state: SocialState, actorId: SocialUserId, partyId: string, memberId: SocialUserId): RelayResult<SocialState> {
  const party = partyById(state, partyId);
  if (party === undefined || !isMember(party, actorId)) return missing('party');   // B2
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
  const party = partyById(state, partyId);
  if (party === undefined || !isMember(party, actorId)) return missing('party');   // B2
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

/**
 * What a party looks like to one of its members, or to an outsider who sees it (outsiderSeesParty). Null otherwise.
 * A block does not break a shared party (blockUser), so the view is where it is enforced: a member blocked either way with
 * the viewer is not in the viewer's roster at all -- no id, role or live mute (F1, 10-02) -- and `leaderId` is '' when the
 * leader is such a member. An outsider sees a party only when they see every member online (WL-358-01, outsiderSeesParty), so
 * a party holding a member hidden from them, appearing offline or signed out is no view, id, roster or count to them at all;
 * nor is a FULL party (WL-351-02 r2).
 */
export interface PartyView {
  readonly partyId: string;
  readonly name: string;
  /** '' when the leader is somebody blocked either way with the viewer. */
  readonly leaderId: SocialUserId;
  readonly members: readonly { userId: SocialUserId; role: Party['members'][number]['role']; selfMuted: boolean }[];
  readonly privacy: PartyPrivacy;
  readonly invitePermission: PartyInvitePermission;
  readonly viewerIsMember: boolean;
  readonly viewerIsLeader: boolean;
  readonly viewerMayInvite: boolean;
}

export function partyViewFor(state: SocialState, viewerId: SocialUserId, partyId: string): PartyView | null {
  const party = partyById(state, partyId);
  if (party === undefined) return null;
  const member = party.members.some((m) => m.userId === viewerId);
  if (!member && !outsiderSeesParty(state, viewerId, party)) return null;
  const seen = partyRosterFor(state, viewerId, party);
  return {
    partyId: party.partyId,
    name: party.name,
    leaderId: seen.some((m) => m.userId === party.leaderId) ? party.leaderId : '',
    members: seen.map((m) => ({ userId: m.userId, role: m.role, selfMuted: m.selfMuted })),
    privacy: party.privacy,
    invitePermission: party.invitePermission,
    viewerIsMember: member,
    viewerIsLeader: party.leaderId === viewerId,
    viewerMayInvite: member && mayInvite(party, viewerId) && party.members.length < PARTY_MAX_MEMBERS,
  };
}

/**
 * THE RECENT PLAYERS TAB, labelled for its viewer. A PARTY meeting's stored label is the party's id (its source); it is shown as
 * that party's name only while this viewer may see the party (partyViewFor: a member, or an outsider who sees it -- never across
 * a wall, never through a hidden leader), else as DEFAULT_PARTY_NAME. So no label names, or derives from, somebody behind the
 * viewer's wall, and a rename reaches only those who may see the party anyway (Second's R16 run, 10-04: B's entry for C read
 * "stub-alpha's party" after A blocked B, across restarts). Labels stored before this (a name, not an id) read as DEFAULT_PARTY_NAME.
 */
export function recentPlayersViewFor(state: SocialState, ownerId: SocialUserId): RecentPlayerEntry[] {
  return recentPlayersFor(state, ownerId).map((e) =>
    e.context === 'PARTY' ? { ...e, contextLabel: partyViewFor(state, ownerId, e.contextLabel)?.name ?? DEFAULT_PARTY_NAME } : e,
  );
}

/** Somebody who was in a party before a change and is not in it after (left, was removed, separated by a block, or it ended). */
export interface PartyDeparture {
  readonly partyId: string;
  readonly userId: SocialUserId;
}

/**
 * WHO LEFT WHICH PARTY between two states: every member of every party in `before` who is not a member of that same party in
 * `after` (a leave, a leader's removal, a block's F1 separation -- the leader removes / the blocker leaves -- a reconciliation of
 * a carried-in blocked pair, or the last member out). The stores hand this to their after-commit hook, so party voice can take
 * the departed out of that party's room server-side (relay-bridge/eos-voice.ts). Pure, in party then member order.
 */
export function partyDepartures(before: SocialState, after: SocialState): PartyDeparture[] {
  const out: PartyDeparture[] = [];
  for (const party of Object.values(before.parties)) {
    const stays = new Set(partyById(after, party.partyId)?.members.map((m) => m.userId) ?? []);
    for (const m of party.members) if (!stays.has(m.userId)) out.push({ partyId: party.partyId, userId: m.userId });
  }
  return out;
}

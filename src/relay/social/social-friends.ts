/**
 * WONDERLAND SOCIAL — friends, requests, blocks, mutes, reports and recent players.
 *
 * EVERY MUTATION NAMES ITS ACTOR and checks the actor before it changes anything (the multiplayer slice's rule): there is
 * no function here that befriends, blocks or reports "for" somebody, because that is the function a surface would one day
 * call with the wrong id. Pure; time is an injected ISO string; errors are values.
 */

import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import {
  type FriendRequest,
  type RecentPlayerContext,
  type RecentPlayerEntry,
  type SocialReportReason,
  type SocialUserId,
} from './social-contracts';
import {
  areFriends,
  blockedEitherWay,
  hasBlocked,
  hasUser,
  mintId,
  pendingRequestBetween,
  type SocialState,
} from './social-state';

const denied = (message: string) => fail<SocialState>(relayError('permission-denied', message));
const invalid = (message: string) => fail<SocialState>(relayError('validation-failed', message));
const missing = (what: string) => fail<SocialState>(relayError('not-found', `${what} not found`));

function bothExist(state: SocialState, a: SocialUserId, b: SocialUserId): RelayResult<true> {
  if (!hasUser(state, a) || !hasUser(state, b)) return fail(relayError('not-found', 'user not found'));
  if (a === b) return fail(relayError('validation-failed', 'a person cannot do this to themselves'));
  return ok(true);
}

function resolveRequest(state: SocialState, requestId: string, status: FriendRequest['status'], atIso: string): SocialState {
  return {
    ...state,
    requests: state.requests.map((r) => (r.requestId === requestId ? { ...r, status, resolvedAtIso: atIso } : r)),
  };
}

function befriend(state: SocialState, a: SocialUserId, b: SocialUserId, atIso: string): SocialState {
  if (areFriends(state, a, b)) return state;
  const [userA, userB] = a < b ? [a, b] : [b, a];
  return { ...state, friendships: [...state.friendships, { userA, userB, sinceIso: atIso }] };
}

/* -------------------------------------------------------------- requests */

/** The one refusal for "you cannot ask this person": a stranger who accepts no requests, and anybody across a wall. */
export const NOT_ACCEPTING_REQUESTS = 'this person is not accepting friend requests';

/**
 * SEND A FRIEND REQUEST. Refused to an existing friend, to somebody who accepts no requests, as a duplicate, and across a
 * block either way -- which answers EXACTLY as a stranger who accepts no requests (founder, 10-04: a refusal across a wall is
 * the stranger's; the blocked side is shown the blocker as such a stranger, social-presence.ts privateStrangerView). A
 * request crossing one already sent the other way IS the answer: the two become friends at once.
 */
export function sendFriendRequest(state: SocialState, actorId: SocialUserId, toUserId: SocialUserId, atIso: string): RelayResult<SocialState> {
  const exist = bothExist(state, actorId, toUserId);
  if (!exist.ok) return fail(exist.error);
  if (blockedEitherWay(state, actorId, toUserId)) return denied(NOT_ACCEPTING_REQUESTS);
  if (areFriends(state, actorId, toUserId)) return invalid('already friends');
  if (pendingRequestBetween(state, actorId, toUserId)) return invalid('a request is already pending');
  const crossing = pendingRequestBetween(state, toUserId, actorId);
  if (crossing) return ok(befriend(resolveRequest(state, crossing.requestId, 'ACCEPTED', atIso), actorId, toUserId, atIso));
  if (state.users[toUserId].privacy.friendRequestPolicy !== 'EVERYONE') return denied(NOT_ACCEPTING_REQUESTS);
  const minted = mintId(state, 'freq');
  const request: FriendRequest = {
    requestId: minted.id,
    fromUserId: actorId,
    toUserId,
    status: 'PENDING',
    createdAtIso: atIso,
    resolvedAtIso: null,
  };
  return ok({ ...minted.state, requests: [...minted.state.requests, request] });
}

function ownPending(state: SocialState, requestId: string): FriendRequest | undefined {
  return state.requests.find((r) => r.requestId === requestId && r.status === 'PENDING');
}

/**
 * Only the RECIPIENT accepts. A block placed since the request was sent makes it unacceptable (a block cancels it; a request
 * carried across one -- old data -- reads exactly like a request that is gone).
 */
export function acceptFriendRequest(state: SocialState, actorId: SocialUserId, requestId: string, atIso: string): RelayResult<SocialState> {
  const request = ownPending(state, requestId);
  if (request === undefined) return missing('pending friend request');
  if (request.toUserId !== actorId) return denied('only the recipient can accept a friend request');
  if (blockedEitherWay(state, request.fromUserId, request.toUserId)) return missing('pending friend request');
  return ok(befriend(resolveRequest(state, requestId, 'ACCEPTED', atIso), request.fromUserId, request.toUserId, atIso));
}

/** Only the recipient declines. The sender is not told it was declined -- it simply stops being pending. */
export function declineFriendRequest(state: SocialState, actorId: SocialUserId, requestId: string, atIso: string): RelayResult<SocialState> {
  const request = ownPending(state, requestId);
  if (request === undefined) return missing('pending friend request');
  if (request.toUserId !== actorId) return denied('only the recipient can decline a friend request');
  return ok(resolveRequest(state, requestId, 'DECLINED', atIso));
}

/** Only the SENDER cancels. */
export function cancelFriendRequest(state: SocialState, actorId: SocialUserId, requestId: string, atIso: string): RelayResult<SocialState> {
  const request = ownPending(state, requestId);
  if (request === undefined) return missing('pending friend request');
  if (request.fromUserId !== actorId) return denied('only the sender can cancel a friend request');
  return ok(resolveRequest(state, requestId, 'CANCELLED', atIso));
}

/** Incoming and outgoing pending requests for one person: the Friend Requests tab. */
export function pendingRequestsFor(state: SocialState, userId: SocialUserId): { incoming: FriendRequest[]; outgoing: FriendRequest[] } {
  const pending = state.requests.filter((r) => r.status === 'PENDING');
  return {
    // A request from somebody since blocked is not shown to the blocker.
    incoming: pending.filter((r) => r.toUserId === userId && !hasBlocked(state, userId, r.fromUserId)),
    outgoing: pending.filter((r) => r.fromUserId === userId),
  };
}

/* ------------------------------------------------------------ friendship */

export function removeFriend(state: SocialState, actorId: SocialUserId, friendId: SocialUserId): RelayResult<SocialState> {
  if (!areFriends(state, actorId, friendId)) return invalid('not friends');
  return ok({
    ...state,
    friendships: state.friendships.filter(
      (f) => !((f.userA === actorId && f.userB === friendId) || (f.userA === friendId && f.userB === actorId)),
    ),
  });
}

/* ----------------------------------------------------------------- block */

/**
 * BLOCK. Ends the friendship, withdraws pending friend requests both ways, REVOKES every pending party invite that would carry
 * one of the pair to the other (sent between them, either way and whichever of them invited; or to one of them into a party
 * the other is in), and from now on the presence authority shows each to the other as nothing more than a stranger
 * (social-presence.ts). A revoked invite stays revoked: unblocking restores nobody to a party (Second's R16 W7/W8, 10-04).
 * Party membership is NOT broken here: blocks.add separates a shared party first (F1, social-parties.ts separateForBlock),
 * and social-parties.ts refuses new invites and joins across the wall.
 */
export function blockUser(state: SocialState, actorId: SocialUserId, targetId: SocialUserId, atIso: string): RelayResult<SocialState> {
  const exist = bothExist(state, actorId, targetId);
  if (!exist.ok) return fail(exist.error);
  if (hasBlocked(state, actorId, targetId)) return ok(state);
  const withoutFriendship = areFriends(state, actorId, targetId) ? removeFriend(state, actorId, targetId) : ok(state);
  if (!withoutFriendship.ok) return withoutFriendship;
  const next = withoutFriendship.value;
  const isMember = (partyId: string, userId: SocialUserId) => next.parties[partyId]?.members.some((m) => m.userId === userId) ?? false;
  const crossesTheWall = (i: SocialState['partyInvites'][number]) =>
    (i.fromUserId === actorId && i.toUserId === targetId) ||
    (i.fromUserId === targetId && i.toUserId === actorId) ||
    (i.toUserId === actorId && isMember(i.partyId, targetId)) ||
    (i.toUserId === targetId && isMember(i.partyId, actorId));
  return ok({
    ...next,
    requests: next.requests.map((r) =>
      r.status === 'PENDING' &&
      ((r.fromUserId === actorId && r.toUserId === targetId) || (r.fromUserId === targetId && r.toUserId === actorId))
        ? { ...r, status: 'CANCELLED', resolvedAtIso: atIso }
        : r,
    ),
    partyInvites: next.partyInvites.map((i) => (i.status === 'PENDING' && crossesTheWall(i) ? { ...i, status: 'REVOKED' } : i)),
    blocks: [...next.blocks, { blockerId: actorId, blockedId: targetId, sinceIso: atIso }],
  });
}

export function unblockUser(state: SocialState, actorId: SocialUserId, targetId: SocialUserId): RelayResult<SocialState> {
  if (!hasBlocked(state, actorId, targetId)) return invalid('not blocked');
  return ok({ ...state, blocks: state.blocks.filter((b) => !(b.blockerId === actorId && b.blockedId === targetId)) });
}

/* ------------------------------------------------------------------ mute */

/** LOCAL: the muter stops hearing (voice) and/or being notified (messages). The muted person sees no difference. */
export function setMute(
  state: SocialState,
  actorId: SocialUserId,
  targetId: SocialUserId,
  mute: { voice: boolean; messages: boolean },
): RelayResult<SocialState> {
  const exist = bothExist(state, actorId, targetId);
  if (!exist.ok) return fail(exist.error);
  const others = state.mutes.filter((m) => !(m.muterId === actorId && m.mutedId === targetId));
  const keep = mute.voice || mute.messages;
  return ok({ ...state, mutes: keep ? [...others, { muterId: actorId, mutedId: targetId, ...mute }] : others });
}

/* ---------------------------------------------------------------- report */

/** Filed, never judged here. The note is capped; the content reported is referenced by id, never copied. */
export function fileReport(
  state: SocialState,
  actorId: SocialUserId,
  input: { reportedId: SocialUserId; reason: SocialReportReason; note: string; subjectRef: string | null },
  atIso: string,
): RelayResult<SocialState> {
  const exist = bothExist(state, actorId, input.reportedId);
  if (!exist.ok) return fail(exist.error);
  const minted = mintId(state, 'rep');
  return ok({
    ...minted.state,
    reports: [
      ...minted.state.reports,
      {
        reportId: minted.id,
        reporterId: actorId,
        reportedId: input.reportedId,
        reason: input.reason,
        note: input.note.slice(0, 1000),
        subjectRef: input.subjectRef,
        filedAtIso: atIso,
      },
    ],
  });
}

/* --------------------------------------------------------- recent players */

export const RECENT_PLAYERS_KEPT = 50;

/**
 * RECORD THAT TWO PEOPLE PLAYED TOGETHER, for both of them. Each side's list is their own; somebody who has opted out of
 * appearing in others' lists is not recorded in theirs, and nothing is recorded across a block. `admits`, when given, is asked
 * for each direction separately: (ownerId, userId) -> may userId land in ownerId's list (a world meeting asks the presence
 * authority whether the owner could see them online at all).
 */
export function recordPlayedTogether(
  state: SocialState,
  a: SocialUserId,
  b: SocialUserId,
  context: RecentPlayerContext,
  contextLabel: string,
  atIso: string,
  admits?: (ownerId: SocialUserId, userId: SocialUserId) => boolean,
): RelayResult<SocialState> {
  const exist = bothExist(state, a, b);
  if (!exist.ok) return fail(exist.error);
  if (blockedEitherWay(state, a, b)) return ok(state);
  const add = (list: readonly RecentPlayerEntry[], ownerId: SocialUserId, userId: SocialUserId): RecentPlayerEntry[] => {
    if (!state.users[userId].privacy.appearInRecentPlayers || (admits !== undefined && !admits(ownerId, userId))) return [...list];
    const others = list.filter((e) => !(e.ownerId === ownerId && e.userId === userId));
    const mine = [{ ownerId, userId, context, contextLabel, metAtIso: atIso }, ...others.filter((e) => e.ownerId === ownerId)].slice(0, RECENT_PLAYERS_KEPT);
    return [...others.filter((e) => e.ownerId !== ownerId), ...mine];
  };
  return ok({ ...state, recentPlayers: add(add(state.recentPlayers, a, b), b, a) });
}

/** The Recent Players tab: newest first, never anybody now blocked either way. */
export function recentPlayersFor(state: SocialState, ownerId: SocialUserId): RecentPlayerEntry[] {
  return state.recentPlayers
    .filter((e) => e.ownerId === ownerId && !blockedEitherWay(state, ownerId, e.userId))
    .sort((x, y) => (x.metAtIso < y.metAtIso ? 1 : x.metAtIso > y.metAtIso ? -1 : 0));
}

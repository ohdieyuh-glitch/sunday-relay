/**
 * WONDERLAND MULTIPLAYER, PHASE 1 — the shared presence layer (founder, 2026-10-02).
 *
 * Each player's Wonderland runs its world locally. What is SHARED is who is in which world context and where their
 * representation (their Relay Dog) stands and moves: players in the same context see each other in-world. This module is
 * that authority, pure, beside the social one:
 *   - CONTEXTS: a public world's shards (filled up to a capacity, then another opens) and private servers;
 *   - JOIN / LEAVE / TRANSITION: a public shard, a friend's context (THEIR server-join rule, decided by the ONE presence
 *     authority -- `resolvePresenceFor(...).can.joinServer`), an invitation, or the party leader's context;
 *   - AVATARS: each player's last reported representation (position, facing, speed, motion, skin), kept in memory only --
 *     movement is real-time state, not a record -- and dropped when its client stops reporting;
 *   - PRIVACY: a blocked pair never appear in each other's world view, in either direction, whatever context they share.
 *
 * IT IS NOT AUTHORITATIVE SIMULATION, and says so: a client reports where its own player is; nothing here checks physics,
 * collisions or rules of play. Experiences that need authority (competitive GvE, PvP, shared physics, economy) get
 * dedicated servers later; a context's `kind` and `authority` are the seam for that (AUTHORITY 'CLIENT_REPORTED' today).
 *
 * Pure: time is an injected millisecond count; nothing here touches the network or a clock.
 */

import type { SocialServerKind, SocialUserId } from './social-contracts';
import { resolvePresenceFor } from './social-presence';
import { hasBlocked, hasUser, partyOf, presenceHiddenFrom, userById, type SocialState } from './social-state';

export const WORLD_PUBLIC_CAPACITY = 32;
export const WORLD_PRIVATE_CAPACITY = 16;
/** A representation not reported for this long has left (its client crashed, quit or lost the network). */
export const WORLD_AVATAR_STALE_MS = 15_000;
/** Reports closer together than this are not stored (a client asked to report ~5 a second). */
export const WORLD_REPORT_MIN_INTERVAL_MS = 100;
export const WORLD_INVITE_TTL_MS = 10 * 60_000;
/** Coordinates beyond this are not a place in Wonderland (the world is a few km across; uu = cm). */
const WORLD_COORD_LIMIT = 10_000_000;

export const WORLD_MOTIONS = ['IDLE', 'WALK', 'RUN', 'JUMP', 'FALL', 'FLY'] as const;
export type WorldMotion = (typeof WORLD_MOTIONS)[number];

export interface WorldContext {
  readonly contextId: string;
  readonly kind: SocialServerKind;
  /** "Golden Arrival", "Rhea's Lab" -- what presence shows. */
  readonly serverName: string;
  /** Who owns a private server; null for a public shard. */
  readonly ownerId: SocialUserId | null;
  readonly capacity: number;
  /** Today every context is CLIENT_REPORTED; a dedicated-server experience will say SERVER_AUTHORITATIVE. */
  readonly authority: 'CLIENT_REPORTED' | 'SERVER_AUTHORITATIVE';
  readonly memberIds: readonly SocialUserId[];
}

export interface AvatarState {
  readonly userId: SocialUserId;
  readonly contextId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Degrees. */
  readonly yaw: number;
  /** uu/s along the ground. */
  readonly speed: number;
  readonly motion: WorldMotion;
  readonly skinId: string;
  readonly reportedAtMs: number;
}

export interface WorldInvite {
  readonly inviteId: string;
  readonly contextId: string;
  readonly fromUserId: SocialUserId;
  readonly toUserId: SocialUserId;
  readonly expiresAtMs: number;
}

export interface WorldState {
  readonly contexts: Readonly<Record<string, WorldContext>>;
  readonly avatars: Readonly<Record<SocialUserId, AvatarState>>;
  readonly invites: readonly WorldInvite[];
  readonly nextSerial: number;
  /**
   * Players a block just separated from a private server's owner (the founder, 10-04, P4/P5), until when their own world report
   * is ANSWERED with a view that has no context -- the client's sign of a removal, which it words "You can't stay in this
   * server." -- instead of refused with "Join a world first". Never names a block.
   */
  readonly removals?: Readonly<Record<SocialUserId, number>>;
  /**
   * THE TRANSPORT RING (r16reh18). Governed by TRANSPORT_RING_DESIGN_T1_v1.md (0a710c29) and v2 (c72f1ea8), as the reviewer ruled
   * them: T1 d63c15 (APPROVED WITH REQUIRED CHANGES) and T2 d786aa (PASS subject to the T2a delta made here). Per player, the last accepted position reports, oldest first, so a viewer whose polls are slower than the
   * reports, or who lost an answer, can be served the reports between two of its views instead of only the newest. In memory only,
   * like the avatar it belongs to: dropped with it, and a restart empties it. Absent until somebody reports.
   */
  readonly trails?: Readonly<Record<SocialUserId, readonly TrailSample[]>>;
  /**
   * PAIR FLOORS (T1 v1 section 2.2): floors[S][V] = the serial number of the last change to whether S's position may be shown to V.
   * None of S's ring entries at or below it is ever served to V. Set only for the (viewer, subject) pairs whose answer changed, so no
   * other viewer's answer moves (K13). Pruned below the oldest kept entry; dropped with either player's membership.
   */
  readonly floors?: Readonly<Record<SocialUserId, Readonly<Record<SocialUserId, number>>>>;
  /** JOIN EPOCHS (K3): joinedSeq[V] = the serial number of V's arrival in their current context. Nothing older is served to V. */
  readonly joinedSeq?: Readonly<Record<SocialUserId, number>>;
  /**
   * THE INTERNAL SERIAL NUMBER (K4, P6): the last one issued. Ring entries, floors and epochs are ordered by it, never by time:
   * request times are stamped at arrival, but operations run later, one at a time. Never served, never stored.
   */
  readonly seq?: number;
}

/** The ring keeps at most this many accepted reports per player (at the 100 ms store floor, at least 0.8 s of movement). */
export const WORLD_TRAIL_MAX_ENTRIES = 8;
/** ...and none older than this: an entry this old is dropped when the next report is stored, and is never served. */
export const WORLD_TRAIL_MAX_AGE_MS = 2_000;
/**
 * AT-LEAST-ONCE (T1 v1 section 2.5, P4): entries stored up to this long before the client's cursor are served again, so a report
 * stored in the cursor's millisecond, or one whose request arrived before the view's but ran after it, is not lost. Stored reports
 * are at least the 100 ms floor apart, so that is at most one repeat per figure; the client drops it by (userId, asOfMs - ageMs).
 */
export const WORLD_TRAIL_SLACK_MS = 100;

/**
 * ONE ACCEPTED REPORT IN A PLAYER'S RING: exactly the position fields the stored report already carries, when the server stored it,
 * where (`contextId`, checked again for every entry at serve time) and its serial number (`seq`). Neither of the last two is served.
 */
export interface TrailSample {
  readonly contextId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly motion: WorldMotion;
  readonly reportedAtMs: number;
  readonly seq: number;
}

/** One entry of a served trail: the position fields of the figure's own entry, and how old it is. No id, name, skin or serial. */
export interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly motion: WorldMotion;
  readonly ageMs: number;
}

/**
 * The ring's next internal serial number (world.seq). Taken inside the store's one-at-a-time queue, never from a clock. Not to be
 * confused with WorldState.nextSerial, the invitation-id counter (winv_<n>), which this does not touch.
 */
function nextRingSeq(world: WorldState): number {
  return (world.seq ?? 0) + 1;
}

/** An own-key read of a per-player map (the SS:83-90 rule: a plain object answers for keys it never stored). */
function own<T>(map: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;
}

/**
 * A REPORT ENTERS THE RING ONCE, AND IN ORDER. Stored reports are stamped by the server's clock and are at least the 100 ms floor
 * apart, so a resent report is a later, separate report or is not stored at all; this holds the ring to that whatever the caller:
 * a sample not strictly newer than the ring's newest (a duplicate, or out of order) is never admitted. Then the ring keeps only the
 * last WORLD_TRAIL_MAX_ENTRIES within WORLD_TRAIL_MAX_AGE_MS of the newest.
 */
export function appendToTrail(trail: readonly TrailSample[] | undefined, sample: TrailSample): readonly TrailSample[] {
  const ring = trail ?? [];
  const newest = ring[ring.length - 1];
  if (newest !== undefined && sample.reportedAtMs <= newest.reportedAtMs) return ring;
  return [...ring, sample].filter((e) => sample.reportedAtMs - e.reportedAtMs <= WORLD_TRAIL_MAX_AGE_MS).slice(-WORLD_TRAIL_MAX_ENTRIES);
}

/**
 * THE ONE DECISION whether a subject's position may be shown to a viewer who shares their context (WP:348-352, extracted unchanged):
 * not themself, no block either way, and not hidden by the subject's own presence choice (P1). worldViewFor serves figures by it, and
 * the pair floors are set wherever an operation changed its answer, so the two can never disagree.
 */
export function positionVisibleTo(social: SocialState, viewerId: SocialUserId, subjectId: SocialUserId): boolean {
  return subjectId !== viewerId && !hasBlocked(social, subjectId, viewerId) && !hasBlocked(social, viewerId, subjectId) && !presenceHiddenFrom(social, viewerId, subjectId);
}

/**
 * TEST-ONLY COUNTERS of one noteAudienceChange (T1 v2 section 4, R38): what the change cost. Never read by the server.
 *   membersCompared: user-record reference compares; rowsScanned: friendship and block rows and party records looked at;
 *   pairEvaluations: (viewer, subject) pairs whose answer was computed before and after; keyComputations: per-player audience keys
 *   (always 0: v2 computes none -- the prototype's key diff did, over every ring holder, on every state change).
 */
export interface AudienceChangeStats {
  membersCompared: number;
  rowsScanned: number;
  pairEvaluations: number;
  keyComputations: number;
}

/**
 * THE TOUCHED SET, FROM THE RECORDS THAT CHANGED (T1 v2 section 2; ruling d63c15 P2-1, P2-3). positionVisibleTo(V, S) reads only:
 * S's user record (whether it exists, its availability, its presence audience), the friendship between V and S, partyOf(V) and that
 * party's members (partyOf asks for a player's FIRST party, by insertion order), and the blocks between them. So a pair's answer can
 * change only if one of its two players is in this set:
 *   - U_users: every player whose user record OBJECT changed (created, removed, presence or privacy) -- among `among` when given (the
 *     members of the contexts: a non-member is in no pair), else among every record;
 *   - U_friend, U_block: both ends of every friendship and every block row added or removed;
 *   - U_party: every member, before AND after, of every party whose record changed, was created or was removed.
 * Ring or no ring: a viewer who has not reported yet is touched as much as anyone (the P2-1 back-fill). The cost is the change's: an
 * operation that leaves the users, friendships, blocks and parties containers as they were costs four reference compares.
 */
export function touchedPlayers(before: SocialState, after: SocialState, among?: Iterable<SocialUserId>, stats?: AudienceChangeStats): Set<SocialUserId> {
  const touched = new Set<SocialUserId>();
  if (before === after) return touched;
  if (before.users !== after.users) {
    const ids = among ?? new Set([...Object.keys(before.users), ...Object.keys(after.users)]);
    for (const id of ids) {
      if (stats !== undefined) stats.membersCompared += 1;
      if (own(before.users, id) !== own(after.users, id)) touched.add(id);
    }
  }
  const ends = <T>(was: readonly T[], now: readonly T[], key: (x: T) => string, pair: (x: T) => readonly [SocialUserId, SocialUserId]) => {
    if (was === now) return;
    if (stats !== undefined) stats.rowsScanned += was.length + now.length;
    const a = new Set(was.map(key));
    const b = new Set(now.map(key));
    for (const x of was) if (!b.has(key(x))) pair(x).forEach((id) => touched.add(id));
    for (const x of now) if (!a.has(key(x))) pair(x).forEach((id) => touched.add(id));
  };
  ends(before.friendships, after.friendships, (f) => `${f.userA}|${f.userB}`, (f) => [f.userA, f.userB]);
  ends(before.blocks, after.blocks, (b) => `${b.blockerId}>${b.blockedId}`, (b) => [b.blockerId, b.blockedId]);
  if (before.parties !== after.parties) {
    for (const id of new Set([...Object.keys(before.parties), ...Object.keys(after.parties)])) {
      if (stats !== undefined) stats.rowsScanned += 1;
      const was = own(before.parties, id);
      const now = own(after.parties, id);
      if (was === now) continue;
      for (const m of [...(was?.members ?? []), ...(now?.members ?? [])]) touched.add(m.userId);
    }
  }
  return touched;
}

/**
 * THE PAIR GATE, ONCE PER OPERATION (T1 v1 section 2.2, P3; v2 sections 2-4). With `before` the store's state before the operation's
 * reconciliation and `after` its outcome state, every touched player P in a context and every other member M there are checked both
 * ways (M sees P, P sees M): where positionVisibleTo changed either way, the subject's ring is floored FOR that viewer at a fresh
 * serial number, so nothing the subject stored before the change is ever served to that viewer. Nobody else's answer moves, so no
 * third party can time the change (K13). A change that moves no pair's answer floors nothing. No clock is read: serial order only (K4).
 * Cost: touchedPlayers' plus at most 2(c - 1) pair evaluations per touched member (c <= 32). Only a world is returned: the social
 * state, the audience told and eventOp are never touched. The same world when no pair changed.
 */
export function noteAudienceChange(world: WorldState, before: SocialState, after: SocialState, stats?: AudienceChangeStats): WorldState {
  // O(1) when no audience collection changed (a mute, a message, a read, a request): not a single context, ring or player is looked at
  if (before === after || (before.users === after.users && before.friendships === after.friendships && before.blocks === after.blocks && before.parties === after.parties)) return world;
  const contexts = Object.values(world.contexts);
  const members = before.users === after.users ? undefined : contexts.flatMap((c) => c.memberIds);
  const touched = touchedPlayers(before, after, members ?? [], stats);
  if (touched.size === 0) return world;
  const changed = new Map<string, readonly [SocialUserId, SocialUserId]>();
  const check = (viewerId: SocialUserId, subjectId: SocialUserId) => {
    // a floor only gates entries that exist: anything the subject stores later takes a larger serial number
    if ((own(world.trails, subjectId) ?? []).length === 0) return;
    if (stats !== undefined) stats.pairEvaluations += 1;
    if (positionVisibleTo(before, viewerId, subjectId) !== positionVisibleTo(after, viewerId, subjectId)) changed.set(`${subjectId}<-${viewerId}`, [subjectId, viewerId]);
  };
  for (const playerId of touched) {
    const context = contexts.find((c) => c.memberIds.includes(playerId));
    if (context === undefined) continue;
    for (const memberId of context.memberIds) {
      if (memberId === playerId) continue;
      check(memberId, playerId);
      check(playerId, memberId);
    }
  }
  if (changed.size === 0) return world;
  const fresh = nextRingSeq(world);
  // PROTOTYPE-SAFE (T2 d786aa R2): player ids are keys, so every map is built with Object.fromEntries or a computed-key literal --
  // both define OWN properties, so an id such as __proto__ is a floor like any other -- never by assignment, which would set the
  // object's prototype instead.
  const rows = new Map<SocialUserId, Record<SocialUserId, number>>();
  for (const [subjectId, viewerId] of changed.values()) rows.set(subjectId, { ...(rows.get(subjectId) ?? own(world.floors, subjectId) ?? {}), [viewerId]: fresh });
  const floors = Object.fromEntries([...Object.entries(world.floors ?? {}), ...rows]);
  return { ...world, seq: fresh, floors };
}

/** Floors of `subjectId` that exclude nothing any more (below the oldest entry it keeps) are dropped. */
function pruneFloors(floors: WorldState['floors'], subjectId: SocialUserId, oldestSeq: number): WorldState['floors'] {
  const mine = own(floors, subjectId);
  if (floors === undefined || mine === undefined) return floors;
  return { ...floors, [subjectId]: Object.fromEntries(Object.entries(mine).filter(([, f]) => f >= oldestSeq)) };
}

/** This player's ring, their floors (as subject AND as viewer) and their join epoch, gone: they left their context. */
function withoutRing(world: WorldState, userId: SocialUserId): WorldState {
  const strip = <T>(map: Readonly<Record<SocialUserId, T>> | undefined): Readonly<Record<SocialUserId, T>> | undefined =>
    map === undefined || !Object.hasOwn(map, userId) ? map : Object.fromEntries(Object.entries(map).filter(([id]) => id !== userId));
  if (world.trails === undefined && world.floors === undefined && world.joinedSeq === undefined) return world;
  const floors = world.floors === undefined ? undefined : Object.fromEntries(Object.entries(world.floors).filter(([id]) => id !== userId).map(([id, row]) => [id, strip(row) ?? {}]));
  return {
    ...world,
    ...(world.trails === undefined ? {} : { trails: strip(world.trails) }),
    ...(floors === undefined ? {} : { floors }),
    ...(world.joinedSeq === undefined ? {} : { joinedSeq: strip(world.joinedSeq) }),
  };
}

/**
 * How long a removed player's reports are answered with a context-less view. Long enough for a client that slept or hitched to
 * still learn it on its FIRST report back (Second's review of CORE aabfb10c, m5: at 60 s a late report read 404, the quiet
 * rejoin was refused by the wall, and the notice was lost). Any join clears it, and the sweep drops it after.
 */
export const WORLD_REMOVAL_NOTICE_MS = 15 * 60_000;

export function emptyWorldState(): WorldState {
  return { contexts: {}, avatars: {}, invites: [], nextSerial: 1 };
}

export type WorldResult<T> = { ok: true; value: T } | { ok: false; code: 'not-found' | 'permission-denied' | 'validation-failed' | 'full'; message: string };

const fail = <T>(code: 'not-found' | 'permission-denied' | 'validation-failed' | 'full', message: string): WorldResult<T> => ({ ok: false, code, message });

/** The context a player is in, if any. */
export function contextOf(world: WorldState, userId: SocialUserId): WorldContext | undefined {
  return Object.values(world.contexts).find((c) => c.memberIds.includes(userId));
}

function withoutMember(world: WorldState, userId: SocialUserId): WorldState {
  const contexts: Record<string, WorldContext> = {};
  for (const c of Object.values(world.contexts)) {
    const members = c.memberIds.filter((id) => id !== userId);
    // An empty PUBLIC shard closes; a private server stays (its owner may come back to it).
    if (members.length === 0 && c.ownerId === null) continue;
    contexts[c.contextId] = members.length === c.memberIds.length ? c : { ...c, memberIds: members };
  }
  const { [userId]: _gone, ...avatars } = world.avatars;
  // THE RING GOES WITH THE AVATAR (a leave, a move to another context, the stale sweep, a block's removal from a private server, a
  // sign-out's leave), with the player's floors and join epoch: positions stored in one stay are never served in another.
  return withoutRing({ ...world, contexts, avatars }, userId);
}

function withMember(world: WorldState, context: WorldContext, userId: SocialUserId): WorldState {
  const moved = world.removals?.[userId] === undefined ? world : { ...world, removals: Object.fromEntries(Object.entries(world.removals ?? {}).filter(([id]) => id !== userId)) };
  const left = withoutMember(moved, userId);
  const current = left.contexts[context.contextId] ?? context;
  // THE ARRIVING VIEWER'S EPOCH (K3, P2): an arrival changes what the newcomer may see of every member already there, with no act of
  // theirs, so nothing stored before it is ever served to the NEWCOMER, whatever cursor they send. Nobody else's answer moves: a
  // hidden arrival stays untold (P1; clearing the members' rings would show every member the moment somebody arrived, K12).
  const epoch = nextRingSeq(left);
  return {
    ...left,
    seq: epoch,
    joinedSeq: { ...(left.joinedSeq ?? {}), [userId]: epoch },
    contexts: { ...left.contexts, [context.contextId]: { ...current, memberIds: [...current.memberIds, userId] } },
  };
}

/** Members who are still reporting (or just joined and have not reported yet). */
function liveMembers(world: WorldState, context: WorldContext, nowMs: number): number {
  return context.memberIds.filter((id) => {
    const a = world.avatars[id];
    return a === undefined || nowMs - a.reportedAtMs <= WORLD_AVATAR_STALE_MS;
  }).length;
}

/** Drop representations whose clients stopped reporting, and their memberships (they rejoin when they return). */
/** Whether a player was just separated from a private server by a block and has not joined anywhere since. */
export function recentlyRemoved(world: WorldState, userId: SocialUserId, nowMs: number): boolean {
  return (world.removals?.[userId] ?? 0) > nowMs && contextOf(world, userId) === undefined;
}

export function sweepWorld(world: WorldState, nowMs: number): WorldState {
  let next = world;
  for (const a of Object.values(world.avatars)) {
    if (nowMs - a.reportedAtMs > WORLD_AVATAR_STALE_MS) next = withoutMember(next, a.userId);
  }
  const invites = next.invites.filter((i) => i.expiresAtMs > nowMs);
  if (invites.length !== next.invites.length) next = { ...next, invites };
  const removals = Object.entries(next.removals ?? {}).filter(([, until]) => until > nowMs);
  if (removals.length !== Object.keys(next.removals ?? {}).length) next = { ...next, removals: Object.fromEntries(removals) };
  return next;
}

export type WorldJoinTarget =
  | { readonly kind: 'PUBLIC'; readonly place: string; readonly placeName: string }
  | { readonly kind: 'PRIVATE'; readonly name: string }
  | { readonly kind: 'FRIEND'; readonly userId: SocialUserId }
  | { readonly kind: 'INVITE'; readonly inviteId: string }
  | { readonly kind: 'PARTY' };

const SAFE_PLACE = /^[a-z0-9_]{1,40}$/;

/** A public place's display name, derived from its safe id: golden_arrival -> "Golden Arrival". Never client text. */
export function publicPlaceName(place: string): string {
  return place
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A PRIVATE SERVER AND ITS OWNER'S WALL (Second's R16 review, 10-04): nobody walled from the owner -- either way -- enters it by
 * following a friend, by an invitation from someone inside, or with their party. A refusal reads like any other can't-join, and
 * an invitation to it is quietly never delivered, so neither the walled player nor the inviter learns of the block.
 */
function walledFromOwner(social: SocialState, context: WorldContext, userId: SocialUserId): boolean {
  return (
    context.kind === 'PRIVATE_SERVER' &&
    context.ownerId !== null &&
    context.ownerId !== userId &&
    (hasBlocked(social, context.ownerId, userId) || hasBlocked(social, userId, context.ownerId))
  );
}

/**
 * JOIN (or move to) a world context. The decision about ANOTHER player's context is the presence authority's, never
 * this module's: following a friend needs `can.joinServer` as `resolvePresenceFor` computes it for this viewer.
 */
export function joinWorld(world: WorldState, social: SocialState, actorId: SocialUserId, target: WorldJoinTarget, nowMs: number): WorldResult<{ world: WorldState; context: WorldContext }> {
  if (!hasUser(social, actorId)) return fail('not-found', 'no social record for this player');
  const swept = sweepWorld(world, nowMs);
  switch (target.kind) {
    case 'PUBLIC': {
      if (!SAFE_PLACE.test(target.place)) return fail('validation-failed', 'place must be a short lowercase id');
      // THE SERVER NAMES A PUBLIC WORLD, from its safe id (Second's R16 review, 10-04): the first joiner's client-sent placeName
      // used to become the shard's serverName for EVERY later joiner -- in their presence, their invites and the durable Recent
      // Players label -- so any client could plant free text (a person's name, a link) in other players' lists. Ignored now.
      const name = publicPlaceName(target.place);
      const shards = Object.values(swept.contexts)
        .filter((c) => c.ownerId === null && c.contextId.startsWith(`pub_${target.place}_`))
        .sort((a, b) => a.contextId.localeCompare(b.contextId, undefined, { numeric: true }));
      const current = contextOf(swept, actorId);
      if (current !== undefined && shards.some((s) => s.contextId === current.contextId)) return { ok: true, value: { world: swept, context: current } };
      const open = shards.find((s) => liveMembers(swept, s, nowMs) < s.capacity);
      const context: WorldContext = open ?? {
        contextId: `pub_${target.place}_${shards.length + 1}`,
        kind: 'PUBLIC_WORLD',
        serverName: name,
        ownerId: null,
        capacity: WORLD_PUBLIC_CAPACITY,
        authority: 'CLIENT_REPORTED',
        memberIds: [],
      };
      const next = withMember(swept, context, actorId);
      return { ok: true, value: { world: next, context: next.contexts[context.contextId] } };
    }
    case 'PRIVATE': {
      const contextId = `priv_${actorId}`;
      const existing = swept.contexts[contextId];
      const context: WorldContext = existing ?? {
        contextId,
        kind: 'PRIVATE_SERVER',
        // the owner's own name for it, else a neutral one: never "<displayName>'s server", which named the owner wherever the
        // location travelled (Second's R16 review, 10-04)
        serverName: target.name.trim().slice(0, 60) || 'Private server',
        ownerId: actorId,
        capacity: WORLD_PRIVATE_CAPACITY,
        authority: 'CLIENT_REPORTED',
        memberIds: [],
      };
      const next = withMember(swept, context, actorId);
      return { ok: true, value: { world: next, context: next.contexts[contextId] } };
    }
    case 'FRIEND': {
      const theirs = contextOf(swept, target.userId);
      const view = resolvePresenceFor(social, actorId, target.userId);
      // THE ONE RULE: their server-join policy and what this viewer may see, from the presence authority.
      if (theirs === undefined || view === null || !view.can.joinServer) return fail('permission-denied', 'You cannot join them there');
      if (hasBlocked(social, target.userId, actorId) || hasBlocked(social, actorId, target.userId)) return fail('permission-denied', 'You cannot join them there');
      if (walledFromOwner(social, theirs, actorId)) return fail('permission-denied', 'You cannot join them there');
      if (liveMembers(swept, theirs, nowMs) >= theirs.capacity) return fail('full', 'That world is full');
      const next = withMember(swept, theirs, actorId);
      return { ok: true, value: { world: next, context: next.contexts[theirs.contextId] } };
    }
    case 'INVITE': {
      const invite = swept.invites.find((i) => i.inviteId === target.inviteId && i.toUserId === actorId);
      const context = invite === undefined ? undefined : swept.contexts[invite.contextId];
      if (invite === undefined || context === undefined || walledFromOwner(social, context, actorId)) return fail('not-found', 'That invitation is no longer open');
      if (liveMembers(swept, context, nowMs) >= context.capacity) return fail('full', 'That world is full');
      const next = withMember({ ...swept, invites: swept.invites.filter((i) => i !== invite) }, context, actorId);
      return { ok: true, value: { world: next, context: next.contexts[context.contextId] } };
    }
    case 'PARTY': {
      const party = partyOf(social, actorId);
      const leaderContext = party === undefined ? undefined : contextOf(swept, party.leaderId);
      // A HIDDEN LEADER IS NOT FOLLOWED (the privacy attacker's B3, 10-07): this answered 200 with the leader's context id and
      // server name to any member -- a non-friend admitted by an open party included -- while the leader was HIDDEN from them
      // (P1: APPEAR_OFFLINE, or presence not shared with them; presenceHiddenFrom, the canon's own test). Such a leader, and one
      // behind the owner's wall, answer exactly as a leader in no world. Location / private-server visibility do NOT gate the
      // follow (a party follows its leader; the founder's question in SOCIAL_HARDENING_PR_PLAN), or no member could follow the
      // leader into the leader's own private server under the default privacy.
      if (party === undefined || leaderContext === undefined || presenceHiddenFrom(social, actorId, party.leaderId) || walledFromOwner(social, leaderContext, actorId)) {
        return fail('not-found', 'Your party leader is not in a world');
      }
      if (liveMembers(swept, leaderContext, nowMs) >= leaderContext.capacity && !leaderContext.memberIds.includes(actorId)) return fail('full', 'That world is full');
      const next = withMember(swept, leaderContext, actorId);
      return { ok: true, value: { world: next, context: next.contexts[leaderContext.contextId] } };
    }
  }
}

export function leaveWorld(world: WorldState, actorId: SocialUserId): WorldState {
  return withoutMember(world, actorId);
}

/** A BLOCK separates a private server's owner from a member inside it (the founder, 10-04, P4/P5): the member is out at once, and
 *  for WORLD_REMOVAL_NOTICE_MS their own reports are answered with a context-less view (see the world.state operation). */
export function removeFromPrivateServer(world: WorldState, userId: SocialUserId, nowMs: number): WorldState {
  const out = withoutMember(world, userId);
  return { ...out, removals: { ...(out.removals ?? {}), [userId]: nowMs + WORLD_REMOVAL_NOTICE_MS } };
}

/** INVITE a friend into the actor's current context: the presence authority's `can.inviteToServer` decides. */
export function inviteToWorld(world: WorldState, social: SocialState, actorId: SocialUserId, toUserId: SocialUserId, nowMs: number): WorldResult<{ world: WorldState; inviteId: string; delivered: boolean }> {
  const context = contextOf(world, actorId);
  if (context === undefined) return fail('not-found', 'You are not in a world');
  const view = resolvePresenceFor(social, actorId, toUserId);
  if (view === null || !view.can.inviteToServer) return fail('permission-denied', 'You cannot invite them');
  const inviteId = `winv_${world.nextSerial}`;
  // walled from this private server's owner: answered like any sent invitation, never stored, never delivered
  if (walledFromOwner(social, context, toUserId)) return { ok: true, value: { world: { ...world, nextSerial: world.nextSerial + 1 }, inviteId, delivered: false } };
  const invites = world.invites.filter((i) => !(i.toUserId === toUserId && i.contextId === context.contextId));
  return {
    ok: true,
    value: {
      world: { ...world, nextSerial: world.nextSerial + 1, invites: [...invites, { inviteId, contextId: context.contextId, fromUserId: actorId, toUserId, expiresAtMs: nowMs + WORLD_INVITE_TTL_MS }] },
      inviteId,
      delivered: true,
    },
  };
}

export interface AvatarReport {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly motion: WorldMotion;
  readonly skinId: string;
}

/** The actor's own representation, as their client reports it. Only ever their own; only inside their context. */
export function reportAvatar(world: WorldState, actorId: SocialUserId, report: AvatarReport, nowMs: number): WorldResult<WorldState> {
  const context = contextOf(world, actorId);
  if (context === undefined) return fail('not-found', 'Join a world first');
  for (const n of [report.x, report.y, report.z, report.yaw, report.speed]) {
    if (!Number.isFinite(n) || Math.abs(n) > WORLD_COORD_LIMIT) return fail('validation-failed', 'position out of range');
  }
  if (!(WORLD_MOTIONS as readonly string[]).includes(report.motion)) return fail('validation-failed', 'unknown motion');
  if (!/^[a-z0-9_]{1,40}$/.test(report.skinId)) return fail('validation-failed', 'unknown skin');
  const last = world.avatars[actorId];
  if (last !== undefined && last.contextId === context.contextId && nowMs - last.reportedAtMs < WORLD_REPORT_MIN_INTERVAL_MS) return { ok: true, value: world };
  const avatar: AvatarState = {
    userId: actorId,
    contextId: context.contextId,
    x: report.x,
    y: report.y,
    z: report.z,
    yaw: ((report.yaw % 360) + 360) % 360,
    speed: Math.max(0, report.speed),
    motion: report.motion,
    skinId: report.skinId,
    reportedAtMs: nowMs,
  };
  // the accepted report also enters the player's ring (a report inside the floor above was not accepted, so it never does); named
  // field by field, so a field added to the avatar one day does not enter the ring with it
  const seq = nextRingSeq(world);
  const sample: TrailSample = { contextId: avatar.contextId, x: avatar.x, y: avatar.y, z: avatar.z, yaw: avatar.yaw, speed: avatar.speed, motion: avatar.motion, reportedAtMs: avatar.reportedAtMs, seq };
  const trail = appendToTrail(own(world.trails, actorId), sample);
  // floors on this player that exclude nothing any more go (at most one per co-member is ever left)
  const floors = pruneFloors(world.floors, actorId, trail[0].seq);
  return { ok: true, value: { ...world, seq, avatars: { ...world.avatars, [actorId]: avatar }, trails: { ...(world.trails ?? {}), [actorId]: trail }, ...(floors === undefined ? {} : { floors }) } };
}

/** What one viewer sees of their context: who is there and where, minus anyone either side has blocked. */
export interface WorldView {
  readonly context: { readonly contextId: string; readonly kind: SocialServerKind; readonly serverName: string; readonly authority: WorldContext['authority']; readonly population: number; readonly capacity: number } | null;
  /** `trail` only when the viewer asked with a cursor and the ring holds reports for them (see worldViewFor). */
  readonly avatars: readonly (AvatarState & { readonly displayName: string; readonly ageMs: number; readonly trail?: readonly TrailPoint[] })[];
  /** Invitations into a world waiting for this viewer. */
  readonly invites: readonly { readonly inviteId: string; readonly fromUserId: SocialUserId; readonly fromName: string; readonly serverName: string; readonly expiresInMs: number }[];
  /** Only when the viewer asked with a cursor: the server time of this answer, which the client sends back as its next `sinceMs`. */
  readonly asOfMs?: number;
}

/**
 * THE TRAIL OF ONE FIGURE THE VIEWER IS ALREADY SHOWN (T1 v1 section 2.4). From the figure's ring, oldest first, the entries:
 *   - (b, c) after the GATE: S's floor for this viewer and the viewer's own join epoch, in serial order -- nothing stored before the
 *     last change to whether S may be shown to V, or before V arrived (no epoch: nothing at all);
 *   - (d) stored in the viewer's context (checked for every entry; the ring is also dropped on any move);
 *   - (e) newer than the client's echoed cursor less WORLD_TRAIL_SLACK_MS (at least once), and never older than
 *     WORLD_TRAIL_MAX_AGE_MS -- so a cursor of 0 or a forged old one reaches no further back than the bounded ring, and a future one
 *     reaches nothing -- and older than the figure's own entry, which already carries the newest report.
 * Each entry carries only the position fields of the figure's own entry, and its age. Privacy rests on the gate, never on the cursor.
 */
function trailFor(world: WorldState, contextId: string, viewerId: SocialUserId, figure: AvatarState, sinceMs: number, nowMs: number): TrailPoint[] {
  const epoch = own(world.joinedSeq, viewerId) ?? Number.POSITIVE_INFINITY;
  const floor = own(own(world.floors, figure.userId), viewerId) ?? 0;
  const gate = Math.max(epoch, floor);
  const lower = Math.max(sinceMs - WORLD_TRAIL_SLACK_MS, nowMs - WORLD_TRAIL_MAX_AGE_MS);
  return (own(world.trails, figure.userId) ?? [])
    .filter((e) => e.seq > gate)
    .filter((e) => e.contextId === contextId)
    .filter((e) => e.reportedAtMs > lower && e.reportedAtMs < figure.reportedAtMs)
    .map((e) => ({ x: e.x, y: e.y, z: e.z, yaw: e.yaw, speed: e.speed, motion: e.motion, ageMs: nowMs - e.reportedAtMs }));
}

/**
 * `sinceMs` (T1 v1 section 3; the world.state operation reads it from the URL query, a whole number): absent, or the viewer in no
 * context (the removal answer, P5), the answer is today's, byte for byte -- no `asOfMs`, no `trail`. Otherwise the answer adds
 * `asOfMs`, and each figure the viewer is shown -- through exactly today's decision, positionVisibleTo, nothing else -- carries a
 * `trail` when its gated ring holds reports after the cursor (trailFor). No figure the viewer is not shown carries anything: the
 * trail rides on the figure's own entry. A view writes nothing: no ring, floor, epoch or serial number moves.
 */
export function worldViewFor(world: WorldState, social: SocialState, viewerId: SocialUserId, nowMs: number, sinceMs?: number): WorldView {
  const context = contextOf(world, viewerId);
  const unwalled = (id: SocialUserId) => id !== viewerId && !hasBlocked(social, id, viewerId) && !hasBlocked(social, viewerId, id);
  // WHO IS SEEN IN THE WORLD (the founder, 10-04, P1): a player hiding their presence from this viewer -- appearing offline, or a
  // presence audience that leaves the viewer out -- is not shown: no figure, no name, not counted. Friends follow the player's own
  // settings, through the one presence rule. An invitation is the sender's own act, so it is judged by the wall alone.
  const visible = (id: SocialUserId) => positionVisibleTo(social, viewerId, id);
  const avatars =
    context === undefined
      ? []
      : context.memberIds
          .filter(visible)
          .map((id) => world.avatars[id])
          .filter((a): a is AvatarState => a !== undefined && nowMs - a.reportedAtMs <= WORLD_AVATAR_STALE_MS && a.contextId === context.contextId)
          .map((a) => {
            const entry = { ...a, displayName: userById(social, a.userId)?.profile.displayName ?? 'Player', ageMs: nowMs - a.reportedAtMs };
            if (sinceMs === undefined) return entry;
            const trail = trailFor(world, context.contextId, viewerId, a, sinceMs, nowMs);
            return trail.length === 0 ? entry : { ...entry, trail };
          });
  const invites = world.invites
    .filter((i) => i.toUserId === viewerId && i.expiresAtMs > nowMs && unwalled(i.fromUserId) && world.contexts[i.contextId] !== undefined && !walledFromOwner(social, world.contexts[i.contextId], viewerId))
    .map((i) => ({
      inviteId: i.inviteId,
      fromUserId: i.fromUserId,
      fromName: userById(social, i.fromUserId)?.profile.displayName ?? 'Player',
      serverName: world.contexts[i.contextId].serverName,
      expiresInMs: i.expiresAtMs - nowMs,
    }));
  // THE COUNT IS A ROSTER TOO: only the viewer and the live members they may see. Counting a member behind the viewer's wall
  // told them somebody hidden was there -- and that member leaving or arriving moved it (Second's R16 run, 10-04).
  const population = context === undefined ? 0 : liveMembers(world, { ...context, memberIds: context.memberIds.filter((id) => id === viewerId || visible(id)) }, nowMs);
  const view: WorldView = {
    context:
      context === undefined
        ? null
        : { contextId: context.contextId, kind: context.kind, serverName: context.serverName, authority: context.authority, population, capacity: context.capacity },
    avatars,
    invites,
  };
  return sinceMs === undefined || context === undefined ? view : { ...view, asOfMs: nowMs };
}

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
  return { ...world, contexts, avatars };
}

function withMember(world: WorldState, context: WorldContext, userId: SocialUserId): WorldState {
  const moved = world.removals?.[userId] === undefined ? world : { ...world, removals: Object.fromEntries(Object.entries(world.removals ?? {}).filter(([id]) => id !== userId)) };
  const left = withoutMember(moved, userId);
  const current = left.contexts[context.contextId] ?? context;
  return { ...left, contexts: { ...left.contexts, [context.contextId]: { ...current, memberIds: [...current.memberIds, userId] } } };
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
  return { ok: true, value: { ...world, avatars: { ...world.avatars, [actorId]: avatar } } };
}

/** What one viewer sees of their context: who is there and where, minus anyone either side has blocked. */
export interface WorldView {
  readonly context: { readonly contextId: string; readonly kind: SocialServerKind; readonly serverName: string; readonly authority: WorldContext['authority']; readonly population: number; readonly capacity: number } | null;
  readonly avatars: readonly (AvatarState & { readonly displayName: string; readonly ageMs: number })[];
  /** Invitations into a world waiting for this viewer. */
  readonly invites: readonly { readonly inviteId: string; readonly fromUserId: SocialUserId; readonly fromName: string; readonly serverName: string; readonly expiresInMs: number }[];
}

export function worldViewFor(world: WorldState, social: SocialState, viewerId: SocialUserId, nowMs: number): WorldView {
  const context = contextOf(world, viewerId);
  const unwalled = (id: SocialUserId) => id !== viewerId && !hasBlocked(social, id, viewerId) && !hasBlocked(social, viewerId, id);
  // WHO IS SEEN IN THE WORLD (the founder, 10-04, P1): a player hiding their presence from this viewer -- appearing offline, or a
  // presence audience that leaves the viewer out -- is not shown: no figure, no name, not counted. Friends follow the player's own
  // settings, through the one presence rule. An invitation is the sender's own act, so it is judged by the wall alone.
  const visible = (id: SocialUserId) => unwalled(id) && !presenceHiddenFrom(social, viewerId, id);
  const avatars =
    context === undefined
      ? []
      : context.memberIds
          .filter(visible)
          .map((id) => world.avatars[id])
          .filter((a): a is AvatarState => a !== undefined && nowMs - a.reportedAtMs <= WORLD_AVATAR_STALE_MS && a.contextId === context.contextId)
          .map((a) => ({ ...a, displayName: userById(social, a.userId)?.profile.displayName ?? 'Player', ageMs: nowMs - a.reportedAtMs }));
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
  return {
    context:
      context === undefined
        ? null
        : { contextId: context.contextId, kind: context.kind, serverName: context.serverName, authority: context.authority, population, capacity: context.capacity },
    avatars,
    invites,
  };
}

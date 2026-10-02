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
import { hasBlocked, partyOf, type SocialState } from './social-state';

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
}

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
  const left = withoutMember(world, userId);
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
export function sweepWorld(world: WorldState, nowMs: number): WorldState {
  let next = world;
  for (const a of Object.values(world.avatars)) {
    if (nowMs - a.reportedAtMs > WORLD_AVATAR_STALE_MS) next = withoutMember(next, a.userId);
  }
  const invites = next.invites.filter((i) => i.expiresAtMs > nowMs);
  return invites.length === next.invites.length ? next : { ...next, invites };
}

export type WorldJoinTarget =
  | { readonly kind: 'PUBLIC'; readonly place: string; readonly placeName: string }
  | { readonly kind: 'PRIVATE'; readonly name: string }
  | { readonly kind: 'FRIEND'; readonly userId: SocialUserId }
  | { readonly kind: 'INVITE'; readonly inviteId: string }
  | { readonly kind: 'PARTY' };

const SAFE_PLACE = /^[a-z0-9_]{1,40}$/;

/**
 * JOIN (or move to) a world context. The decision about ANOTHER player's context is the presence authority's, never
 * this module's: following a friend needs `can.joinServer` as `resolvePresenceFor` computes it for this viewer.
 */
export function joinWorld(world: WorldState, social: SocialState, actorId: SocialUserId, target: WorldJoinTarget, nowMs: number): WorldResult<{ world: WorldState; context: WorldContext }> {
  if (social.users[actorId] === undefined) return fail('not-found', 'no social record for this player');
  const swept = sweepWorld(world, nowMs);
  switch (target.kind) {
    case 'PUBLIC': {
      if (!SAFE_PLACE.test(target.place)) return fail('validation-failed', 'place must be a short lowercase id');
      const name = target.placeName.trim().slice(0, 60) || target.place;
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
        serverName: target.name.trim().slice(0, 60) || `${social.users[actorId].profile.displayName}'s server`,
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
      if (liveMembers(swept, theirs, nowMs) >= theirs.capacity) return fail('full', 'That world is full');
      const next = withMember(swept, theirs, actorId);
      return { ok: true, value: { world: next, context: next.contexts[theirs.contextId] } };
    }
    case 'INVITE': {
      const invite = swept.invites.find((i) => i.inviteId === target.inviteId && i.toUserId === actorId);
      const context = invite === undefined ? undefined : swept.contexts[invite.contextId];
      if (invite === undefined || context === undefined) return fail('not-found', 'That invitation is no longer open');
      if (liveMembers(swept, context, nowMs) >= context.capacity) return fail('full', 'That world is full');
      const next = withMember({ ...swept, invites: swept.invites.filter((i) => i !== invite) }, context, actorId);
      return { ok: true, value: { world: next, context: next.contexts[context.contextId] } };
    }
    case 'PARTY': {
      const party = partyOf(social, actorId);
      const leaderContext = party === undefined ? undefined : contextOf(swept, party.leaderId);
      if (party === undefined || leaderContext === undefined) return fail('not-found', 'Your party leader is not in a world');
      if (liveMembers(swept, leaderContext, nowMs) >= leaderContext.capacity && !leaderContext.memberIds.includes(actorId)) return fail('full', 'That world is full');
      const next = withMember(swept, leaderContext, actorId);
      return { ok: true, value: { world: next, context: next.contexts[leaderContext.contextId] } };
    }
  }
}

export function leaveWorld(world: WorldState, actorId: SocialUserId): WorldState {
  return withoutMember(world, actorId);
}

/** INVITE a friend into the actor's current context: the presence authority's `can.inviteToServer` decides. */
export function inviteToWorld(world: WorldState, social: SocialState, actorId: SocialUserId, toUserId: SocialUserId, nowMs: number): WorldResult<{ world: WorldState; inviteId: string }> {
  const context = contextOf(world, actorId);
  if (context === undefined) return fail('not-found', 'You are not in a world');
  const view = resolvePresenceFor(social, actorId, toUserId);
  if (view === null || !view.can.inviteToServer) return fail('permission-denied', 'You cannot invite them');
  const inviteId = `winv_${world.nextSerial}`;
  const invites = world.invites.filter((i) => !(i.toUserId === toUserId && i.contextId === context.contextId));
  return {
    ok: true,
    value: {
      world: { ...world, nextSerial: world.nextSerial + 1, invites: [...invites, { inviteId, contextId: context.contextId, fromUserId: actorId, toUserId, expiresAtMs: nowMs + WORLD_INVITE_TTL_MS }] },
      inviteId,
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
  const visible = (id: SocialUserId) => id !== viewerId && !hasBlocked(social, id, viewerId) && !hasBlocked(social, viewerId, id);
  const avatars =
    context === undefined
      ? []
      : context.memberIds
          .filter(visible)
          .map((id) => world.avatars[id])
          .filter((a): a is AvatarState => a !== undefined && nowMs - a.reportedAtMs <= WORLD_AVATAR_STALE_MS && a.contextId === context.contextId)
          .map((a) => ({ ...a, displayName: social.users[a.userId]?.profile.displayName ?? 'Player', ageMs: nowMs - a.reportedAtMs }));
  const invites = world.invites
    .filter((i) => i.toUserId === viewerId && i.expiresAtMs > nowMs && visible(i.fromUserId) && world.contexts[i.contextId] !== undefined)
    .map((i) => ({
      inviteId: i.inviteId,
      fromUserId: i.fromUserId,
      fromName: social.users[i.fromUserId]?.profile.displayName ?? 'Player',
      serverName: world.contexts[i.contextId].serverName,
      expiresInMs: i.expiresAtMs - nowMs,
    }));
  return {
    context:
      context === undefined
        ? null
        : { contextId: context.contextId, kind: context.kind, serverName: context.serverName, authority: context.authority, population: liveMembers(world, context, nowMs), capacity: context.capacity },
    avatars,
    invites,
  };
}
